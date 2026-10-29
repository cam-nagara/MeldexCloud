/* 重複ファイル一覧の表示整形。
 * ラベル・パス表示・グループの選択・絞り込み・ページ表示を持ち、
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
      return `<div class="dup-item-thumb" data-meldex-image-host><img src="${esc(src)}" alt="${esc(name)}" loading="lazy" decoding="async" data-dup-image data-meldex-content-image></div>`;
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
    const selectedLabel = automatic && isExisting(file) ? (checked ? '既存ファイル（選択中）' : '既存ファイル') : (checked ? '残す' : '選択');
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

  function groupHtml(group, groupIndex, automatic, options = {}) {
    const type = TYPE_LABELS[group.type] || TYPE_LABELS.exact_file;
    const initialIndex = options.selected ?? selectedIndex(group, automatic);
    const offset = options.offset || 0;
    const end = Math.min(group.files.length, offset + (options.limit || group.files.length));
    const items = group.files.slice(offset, end).map((file, index) => (
      itemHtml(file, groupIndex, offset + index, offset + index === initialIndex, automatic)
    )).join('');
    return `<section class="dup-group" data-group="${groupIndex}">
      <div class="dup-group-header">
        <label class="dup-group-include"><input type="checkbox" data-dup-include data-group="${groupIndex}"
          ${options.included === false ? '' : 'checked'} aria-label="グループ ${groupIndex + 1}を一括整理の対象にする">整理対象</label>
        <span class="gb-badge ${type[1]}">${type[0]}</span>
        <span class="dup-group-title">グループ ${groupIndex + 1}</span>
        <span class="dup-group-count">${group.files.length}件</span>
        <span class="dup-group-spacer"></span>
        <button type="button" class="gb-btn gb-btn-xs gb-btn-primary" data-dup-resolve data-group="${groupIndex}"
          data-e2e-id="duplicate-resolve-group-${groupIndex}"
          aria-label="グループ ${groupIndex + 1} の選択したファイルを残す">選択したファイルを残す</button>
      </div>
      <div class="dup-group-choice">残すファイル: ${esc(fileName(group.files[initialIndex]))}</div>
      <div class="dup-group-body">${items}</div>
      ${group.files.length > end - offset ? `<div class="dup-file-pager">
        <button type="button" class="gb-btn gb-btn-xs" data-dup-files="-1" data-group="${groupIndex}" ${offset ? '' : 'disabled'} aria-label="グループ ${groupIndex + 1}の前のファイル">前へ</button>
        <span>${offset + 1}–${end} / ${group.files.length}件</span>
        <button type="button" class="gb-btn gb-btn-xs" data-dup-files="1" data-group="${groupIndex}" ${end < group.files.length ? '' : 'disabled'} aria-label="グループ ${groupIndex + 1}の次のファイル">次へ</button>
      </div>` : ''}
    </section>`;
  }

  // 同じ既存ファイルを含む完全一致の通知は、一つの判断へまとめる。
  // 類似画像の関係には推移律がないため、完全一致だけを結合する。
  function consolidateGroups(groups) {
    const owners = new Map();
    const merged = [];
    for (const group of groups) {
      if (group.type === 'similar_image') { merged.push(group); continue; }
      const matches = new Set(group.files.map(file => owners.get(group.type + ':' + filePath(file))).filter(Boolean));
      const target = matches.values().next().value || { ...group, files: [] };
      if (!matches.size) merged.push(target);
      const files = new Map(target.files.map(file => [filePath(file), file]));
      for (const source of [...matches, group]) {
        for (const file of source.files) {
          const prior = files.get(filePath(file));
          files.set(filePath(file), prior && isExisting(prior) ? prior : file);
        }
        if (source !== target && matches.has(source)) source._mergedInto = target;
      }
      target.files = [...files.values()];
      target.files.forEach(file => owners.set(group.type + ':' + filePath(file), target));
    }
    return merged.filter(group => !group._mergedInto);
  }

  function createResultView(overlay, groups, automatic, onRender) {
    const PAGE_SIZE = 10;
    const FILE_PAGE_SIZE = 12;
    const states = groups.map(group => ({ selected: selectedIndex(group, automatic), included: true,
      resolved: false, failed: false, removed: new Set(), offset: 0 }));
    const results = overlay.querySelector('[data-dup-results]');
    const tools = overlay.querySelector('[data-dup-result-tools]');
    tools.hidden = false;
    tools.innerHTML = `<div class="dup-result-filters">
      <input type="search" class="gb-input" data-dup-search placeholder="ファイル名・保存場所で検索" aria-label="重複ファイルを検索">
      <select class="gb-select" data-dup-type aria-label="重複の種類"><option value="">すべての種類</option>
        ${Object.entries(TYPE_LABELS).map(([key, label]) => `<option value="${key}">${label[0]}</option>`).join('')}</select>
      <select class="gb-select" data-dup-state aria-label="整理状況"><option value="">すべての状況</option><option value="pending">未整理</option><option value="resolved">整理済み</option></select>
      <select class="gb-select" data-dup-selection aria-label="整理対象を一括変更"><option value="">整理対象を一括変更</option>
        <option value="all-on">すべてを対象にする</option><option value="all-off">すべてを対象外にする</option>
        <option value="filtered-on">絞り込み結果を対象にする</option><option value="filtered-off">絞り込み結果を対象外にする</option></select>
      <label class="dup-compact-toggle"><input type="checkbox" data-dup-compact ${groups.length > 20 ? 'checked' : ''}>コンパクト表示</label>
    </div><div class="dup-result-navigation">
      <span data-dup-page-summary role="status"></span>
      <label><input type="checkbox" data-dup-page-include>このページを整理対象にする</label>
      <span class="dup-group-spacer"></span>
      <button type="button" class="gb-btn gb-btn-sm" data-dup-page="-1" aria-label="前の重複グループ">前へ</button>
      <button type="button" class="gb-btn gb-btn-sm" data-dup-page="1" aria-label="次の重複グループ">次へ</button>
    </div><div class="gb-section-desc">各グループで残すファイルを選びます。一括整理は、検索やページ外を含む「整理対象」の全グループに適用されます。</div>`;
    let page = 0;
    let visible = [];
    let filtered = [];
    overlay.classList.toggle('dup-results-compact', groups.length > 20);
    const searchText = groups.map(group => group.files.map(file => fileName(file) + ' ' + fileLocation(file) + ' ' + filePath(file)).join(' ').toLocaleLowerCase());
    const view = { states, busy: false, render, updateSummary, recordRemoved };
    function recordRemoved(results) {
      const removed = new Set(results.filter(result => result.status === 'replaced').map(result => result.path));
      states.forEach((state, index) => {
        groups[index].files.forEach(file => { if (removed.has(filePath(file))) state.removed.add(filePath(file)); });
        const remaining = groups[index].files.map((file, fileIndex) => ({ file, fileIndex }))
          .filter(({ file }) => !state.removed.has(filePath(file)));
        if (state.removed.has(filePath(groups[index].files[state.selected])) && remaining.length) state.selected = remaining[0].fileIndex;
        if (remaining.length <= 1) state.resolved = true;
      });
    }
    function updateSummary() {
      const count = states.filter(state => state.included && !state.resolved).length;
      const button = overlay.querySelector('[data-dup-resolve-all]');
      button.textContent = `選択した${count.toLocaleString('ja-JP')}グループをまとめて整理`;
      button.disabled = view.busy || count === 0;
      button.hidden = groups.length < 2;
      const pending = visible.filter(index => !states[index].resolved);
      const toggle = tools.querySelector('[data-dup-page-include]');
      toggle.checked = pending.length > 0 && pending.every(index => states[index].included);
      toggle.indeterminate = !toggle.checked && pending.some(index => states[index].included);
      toggle.disabled = view.busy || !pending.length;
      tools.querySelector('[data-dup-selection]').disabled = view.busy;
      if (!view.busy && states.some(state => state.resolved || state.failed)) {
        const resolved = states.filter(state => state.resolved).length;
        overlay.querySelector('[data-dup-status]').textContent = `整理済み ${resolved.toLocaleString('ja-JP')} / ${groups.length.toLocaleString('ja-JP')}グループ`
          + (states.some(state => state.failed && !state.resolved) ? '（失敗したファイルは再試行できます）' : '');
      }
    }
    function render() {
      const query = tools.querySelector('[data-dup-search]').value.trim().toLocaleLowerCase();
      const type = tools.querySelector('[data-dup-type]').value;
      const status = tools.querySelector('[data-dup-state]').value;
      filtered = groups.map((_, index) => index).filter(index => (!query || searchText[index].includes(query))
        && (!type || groups[index].type === type)
        && (!status || states[index].resolved === (status === 'resolved')));
      page = Math.max(0, Math.min(page, Math.ceil(filtered.length / PAGE_SIZE) - 1));
      visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      results.innerHTML = visible.map(index => groupHtml(groups[index], index, automatic,
        { ...states[index], limit: FILE_PAGE_SIZE })).join('')
        || '<div class="gb-empty-placeholder">条件に合う重複グループはありません</div>';
      for (const index of visible) {
        const state = states[index];
        const element = results.querySelector(`.dup-group[data-group="${index}"]`);
        element.classList.toggle('dup-group-resolved', state.resolved);
        const button = element.querySelector('[data-dup-resolve]');
        button.disabled = view.busy || state.resolved;
        if (state.resolved) button.textContent = '整理済み';
        else if (state.failed) button.textContent = '失敗したファイルを再試行';
        element.querySelector('[data-dup-include]').disabled = view.busy || state.resolved;
        element.querySelectorAll('[data-dup-item]').forEach(item => {
          const disabled = view.busy || state.resolved || state.removed.has(filePath(groups[index].files[Number(item.dataset.index)]));
          item.setAttribute('aria-disabled', String(disabled));
          item.querySelector('[data-dup-radio]').disabled = disabled;
        });
      }
      tools.querySelector('[data-dup-page-summary]').textContent = filtered.length
        ? `${(page * PAGE_SIZE + 1).toLocaleString('ja-JP')}–${Math.min((page + 1) * PAGE_SIZE, filtered.length).toLocaleString('ja-JP')} / ${filtered.length.toLocaleString('ja-JP')}グループ`
        : '0グループ';
      tools.querySelector('[data-dup-page="-1"]').disabled = page === 0;
      tools.querySelector('[data-dup-page="1"]').disabled = (page + 1) * PAGE_SIZE >= filtered.length;
      updateSummary();
      onRender();
    }
    tools.addEventListener('input', event => {
      if (event.target.matches('[data-dup-search]')) { page = 0; render(); }
    });
    tools.addEventListener('change', event => {
      if (event.target.matches('[data-dup-compact]')) overlay.classList.toggle('dup-results-compact', event.target.checked);
      if (event.target.matches('[data-dup-type],[data-dup-state]')) { page = 0; render(); }
      if (event.target.matches('[data-dup-selection]') && !view.busy) {
        const action = event.target.value;
        const targets = action.startsWith('all-') ? states.map((_, index) => index) : filtered;
        if (action) targets.filter(index => !states[index].resolved).forEach(index => { states[index].included = action.endsWith('-on'); });
        event.target.value = '';
        render();
      }
      if (event.target.matches('[data-dup-page-include]') && !view.busy) {
        visible.filter(index => !states[index].resolved).forEach(index => { states[index].included = event.target.checked; });
        render();
      }
    });
    overlay.addEventListener('click', event => {
      const pager = event.target.closest('[data-dup-page]');
      const files = event.target.closest('[data-dup-files]');
      if (pager) { page += Number(pager.dataset.dupPage); render(); }
      if (files) { states[Number(files.dataset.group)].offset += Number(files.dataset.dupFiles) * FILE_PAGE_SIZE; render(); }
    });
    overlay.addEventListener('change', event => {
      if (event.target.matches('[data-dup-include]') && !view.busy) {
        states[Number(event.target.dataset.group)].included = event.target.checked;
        updateSummary();
      }
    });
    render();
    return view;
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
    consolidateGroups,
    createResultView,
  };
})(window);
