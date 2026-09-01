/* 重複ファイル一覧の表示整形。
 * ラベル・パス表示・バッジ・グループHTMLの組み立てだけを持ち、
 * 監視やスキャンの制御は gb-duplicate-monitor.js 側に残す（責務単位の分離）。
 * esc() は meldex-core のものを呼び出し時に参照する。
 */
(function (global) {
  'use strict';

  const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff', 'tif', 'ico', 'svg']);
  const TYPE_LABELS = {
    exact_file: ['完全同一ファイル', 'gb-badge-danger'],
    exact_image: ['同一画像', 'gb-badge-danger'],
    similar_image: ['類似画像', 'gb-badge-warn'],
  };

  function safeText(value) {
    return String(value == null ? '' : value);
  }
  function filePath(file) {
    return safeText(file?.rel_path || file?.path || file?.file_path);
  }

  function fileName(file) {
    const path = filePath(file).replace(/\\/g, '/');
    return safeText(file?.name || path.split('/').pop() || '名前なし');
  }
  function fileLocation(file) {
    const path = filePath(file).replace(/\\/g, '/');
    const slash = path.lastIndexOf('/');
    return safeText(file?.location || file?.folder || (slash >= 0 ? path.slice(0, slash) : 'ソースフォルダ'));
  }

  // 画面へ出すパスは、ドライブ名や共有名を落としてから扱う。保存先の登録内容に
  // よっては絶対パスが返ってくるため、表示側で必ず均す。
  function pathParts(value) {
    const path = safeText(value)
      .replace(/\\/g, '/')
      .replace(/^[A-Za-z]:\/+/, '')
      .replace(/^\/\/[^/]+\/[^/]+\/?/, '')
      .replace(/^\/+/, '');
    return path.split('/').filter(Boolean);
  }

  // 末尾 depth 階層までに詰める（切ったことが分かるよう先頭に … を付ける）。
  function displayPath(value, depth) {
    const parts = pathParts(value);
    const limit = depth || 3;
    return parts.length > limit ? '…/' + parts.slice(-limit).join('/') : parts.join('/');
  }

  function targetHtml(folderPath) {
    const parts = pathParts(folderPath);
    if (!parts.length) return '';
    const shown = parts.slice(-3);
    const name = shown[shown.length - 1];
    const parent = (parts.length > 3 ? '…/' : '') + shown.slice(0, -1).join('/');
    return `${lucide('folder', 12)}<span class="dup-progress-target-name">${esc(name)}</span>`
      + (shown.length > 1 ? `<span class="dup-progress-target-parent">${esc(parent)}</span>` : '');
  }

  function isImage(file) {
    if (typeof file?.is_image === 'boolean') return file.is_image;
    const extension = fileName(file).split('.').pop().toLowerCase();
    return IMAGE_EXTENSIONS.has(extension);
  }

  function isExisting(file) {
    return file?.existing === true
      || file?.is_existing === true
      || file?.origin === 'existing'
      || file?.role === 'existing';
  }

  function modifiedText(value) {
    if (!value) return '更新日時不明';
    const numeric = Number(value);
    const date = new Date(Number.isFinite(numeric) ? (numeric < 1e12 ? numeric * 1000 : numeric) : value);
    if (Number.isNaN(date.getTime())) return '更新日時不明';
    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  function normalizeType(type) {
    if (TYPE_LABELS[type]) return type;
    if (type === 'exact') return 'exact_file';
    if (type === 'similar') return 'similar_image';
    return 'exact_file';
  }

  function normalizeGroup(group) {
    let files = Array.isArray(group?.files)
      ? group.files
      : (Array.isArray(group?.images) ? group.images : (Array.isArray(group?.items) ? group.items : []));
    if (!files.length && Array.isArray(group?.paths)) {
      files = group.paths.map(path => ({ path }));
    }
    return {
      ...group,
      type: normalizeType(group?.match_type || group?.result_type || group?.type),
      files,
    };
  }

  function normalizeGroups(payload) {
    let groups = Array.isArray(payload?.groups)
      ? payload.groups
      : (payload?.group ? [payload.group] : []);
    if (!groups.length && Array.isArray(payload?.paths)) groups = [payload];
    return groups.map(normalizeGroup).filter(group => group.files.length > 1);
  }

  function selectedIndex(group, automatic) {
    if (automatic) {
      const existingIndex = group.files.findIndex(isExisting);
      if (existingIndex >= 0) return existingIndex;
    }
    const recommendedIndex = group.files.findIndex(file => file?.recommended === true);
    return recommendedIndex >= 0 ? recommendedIndex : 0;
  }

  function itemVisual(file) {
    const path = filePath(file);
    const name = fileName(file);
    if (isImage(file)) {
      const src = global.MeldexSheetAttachments?.thumbUrlForPath
        ? global.MeldexSheetAttachments.thumbUrlForPath(path, 180)
        : '/api/thumbnail?path=' + encodeURIComponent(path.replace(/\\/g, '/')) + '&size=180';
      return `<div class="dup-item-thumb" data-meldex-image-host><img src="${src}" alt="${esc(name)}" data-dup-image data-meldex-content-image></div>`;
    }
    return `<div class="dup-item-thumb dup-item-file-icon" aria-hidden="true">${lucide('file', 32)}</div>`;
  }

  function itemHtml(file, groupIndex, fileIndex, checked, automatic) {
    const path = filePath(file);
    const hasSize = file?.size !== undefined && file?.size !== null && Number.isFinite(Number(file.size));
    const size = hasSize
      ? (typeof formatFileSize === 'function' ? formatFileSize(Number(file.size)) : `${Number(file.size)} bytes`)
      : 'サイズ不明';
    const dimension = isImage(file) && file?.width
      ? `${Number(file.width)}×${Number(file.height)}`
      : '';
    const selectedLabel = automatic && isExisting(file) ? '既存ファイル（初期選択）' : (checked ? '残す' : '選択');
    return `<div class="dup-item${checked ? ' dup-item-selected' : ''}" role="button" tabindex="0"
      aria-pressed="${checked ? 'true' : 'false'}" aria-label="${esc(fileName(file))}を残す"
      data-dup-item data-group="${groupIndex}" data-index="${fileIndex}" data-path="${esc(path)}"
      data-existing="${isExisting(file) ? '1' : '0'}"
      data-e2e-id="duplicate-item-${groupIndex}-${fileIndex}">
      ${itemVisual(file)}
      <div class="dup-item-info">
        <div class="dup-item-name" title="${esc(path)}">${esc(fileName(file))}</div>
        <div class="dup-item-location" title="${esc(fileLocation(file))}">${esc(fileLocation(file))}</div>
        <div class="dup-item-meta">${dimension ? `${dimension} / ` : ''}${esc(size)}</div>
        <div class="dup-item-meta">${esc(modifiedText(file?.modified || file?.mtime || file?.updated_at))}</div>
        <div class="dup-item-radio">
          <input type="radio" name="dup-keep-${groupIndex}" value="${fileIndex}" ${checked ? 'checked' : ''}
            data-dup-radio data-group="${groupIndex}" data-index="${fileIndex}"
            data-e2e-id="duplicate-keep-${groupIndex}-${fileIndex}"
            aria-label="${esc(fileName(file))}を残す">
          <span class="${automatic && isExisting(file) ? 'dup-item-rec-label' : 'dup-item-keep-label'}">${selectedLabel}</span>
        </div>
      </div>
    </div>`;
  }

  function groupHtml(group, groupIndex, automatic) {
    const type = TYPE_LABELS[group.type] || TYPE_LABELS.exact_file;
    const initialIndex = selectedIndex(group, automatic);
    const items = group.files.map((file, fileIndex) => (
      itemHtml(file, groupIndex, fileIndex, fileIndex === initialIndex, automatic)
    )).join('');
    return `<section class="dup-group" data-group="${groupIndex}">
      <div class="dup-group-header">
        <span class="gb-badge ${type[1]}">${type[0]}</span>
        <span class="dup-group-title">グループ ${groupIndex + 1}</span>
        <span class="dup-group-count">${group.files.length}件</span>
        <span class="dup-group-spacer"></span>
        <button type="button" class="gb-btn gb-btn-xs gb-btn-primary" data-dup-resolve data-group="${groupIndex}"
          data-e2e-id="duplicate-resolve-group-${groupIndex}"
          aria-label="グループ ${groupIndex + 1} の選択したファイルを残す">選択したファイルを残す</button>
      </div>
      <div class="dup-group-body">${items}</div>
    </section>`;
  }

  global.MeldexDuplicateFormat = {
    safeText,
    filePath,
    fileName,
    fileLocation,
    pathParts,
    displayPath,
    targetHtml,
    isImage,
    isExisting,
    modifiedText,
    normalizeType,
    normalizeGroup,
    normalizeGroups,
    selectedIndex,
    itemVisual,
    itemHtml,
    groupHtml,
  };
})(window);
