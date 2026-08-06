/* gb-file-info-panel.js: フォルダとボードで共有するファイル情報パネル */
(function initMeldexFileInfoPanel(global) {
  'use strict';

  const renderRevisions = new WeakMap();
  const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico']);
  const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'webm']);
  const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac']);

  function escapeHtml(value) {
    if (typeof global.esc === 'function') return global.esc(String(value == null ? '' : value));
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function iconHtml(name, size) {
    return typeof global.lucide === 'function' ? global.lucide(name, size || 16) : '';
  }

  function fileIcon(ext) {
    if (IMAGE_EXTS.has(ext)) return 'image';
    if (VIDEO_EXTS.has(ext)) return 'clapperboard';
    if (AUDIO_EXTS.has(ext)) return 'audio';
    if (ext === 'md') return 'fileText';
    if (ext === 'json') return 'db';
    if (ext === 'board' || ext === 'mel-board') return 'layoutDashboard';
    if (ext === 'pdf') return 'fileText';
    if (ext === 'html' || ext === 'htm') return 'codeXml';
    return 'file';
  }

  function formatFileSize(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) return '';
    if (value < 1024) return value + ' B';
    if (value < 1048576) return (value / 1024).toFixed(1) + ' KB';
    if (value < 1073741824) return (value / 1048576).toFixed(1) + ' MB';
    return (value / 1073741824).toFixed(1) + ' GB';
  }

  function contextForPath(filePath) {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    const fileName = normalized.split('/').pop() || normalized;
    const dotIndex = fileName.lastIndexOf('.');
    const ext = dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : '';
    const folderPath = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '';
    const folderName = folderPath.split('/').pop() || folderPath;
    const typeLabel = ext === 'md'
      ? 'ノート'
      : ext === 'json'
        ? 'シナリオ／シート'
        : ext === 'board' || ext === 'mel-board'
          ? 'ボード'
          : ext === 'html' || ext === 'htm'
            ? 'HTML'
            : ext || 'ファイル';
    return { fileName, ext, folderPath, folderName, typeLabel };
  }

  function metadataRowsHtml(meta) {
    if (!meta) return '';
    const rows = [];
    const dateRow = (label, value) => {
      if (!value) return;
      const parsed = new Date(value);
      const text = Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString('ja-JP');
      rows.push([label, text]);
    };
    dateRow('作成日時', meta.created);
    dateRow('更新日時', meta.modified);
    if (meta.size != null) rows.push(['ファイルサイズ', formatFileSize(meta.size)]);
    if (meta._metadataLoadError) rows.push(['詳細', '読み込めませんでした']);
    return rows.map(([label, value]) => (
      `<tr><td style="padding:4px 8px 4px 0;color:var(--fg2);white-space:nowrap;">${escapeHtml(label)}</td>`
      + `<td style="padding:4px 0;">${escapeHtml(value)}</td></tr>`
    )).join('');
  }

  function panelHtml(filePath, preloadedMeta, options) {
    const info = contextForPath(filePath);
    const tagsHtml = options?.showTags === false
      ? ''
      : `<div data-global-tags-target-path="${escapeHtml(filePath)}"></div>`;
    const folderIdentity = 'file-info-folder-' + encodeURIComponent(filePath);
    const folderHtml = info.folderPath
      ? `<button type="button" class="auto-link" data-e2e-id="${escapeHtml(folderIdentity)}" data-path="${escapeHtml(info.folderPath)}" data-native-folder="true" style="padding:0;border:0;background:transparent;color:var(--accent);font:inherit;cursor:pointer;">${escapeHtml(info.folderName)}</button>`
      : '—';
    return `<div style="padding:12px;" data-file-info-path="${escapeHtml(filePath)}">`
      + `<div style="font-size:15px;font-weight:bold;margin-bottom:12px;display:flex;align-items:center;gap:6px;">${iconHtml(fileIcon(info.ext), 16)} ${escapeHtml(info.fileName)}</div>`
      + '<table style="font-size:13px;color:var(--fg2);width:100%;border-collapse:collapse;">'
      + '<tbody>'
      + `<tr><td style="padding:4px 8px 4px 0;color:var(--fg2);white-space:nowrap;">種類</td><td style="padding:4px 0;">${escapeHtml(info.typeLabel)}</td></tr>`
      + `<tr><td style="padding:4px 8px 4px 0;color:var(--fg2);white-space:nowrap;">フォルダ</td><td style="padding:4px 0;">${folderHtml}</td></tr>`
      + `<tr><td style="padding:4px 8px 4px 0;color:var(--fg2);white-space:nowrap;">パス</td><td style="padding:4px 0;word-break:break-all;font-size:11px;">${escapeHtml(filePath)}</td></tr>`
      + '</tbody>'
      + `<tbody data-file-info-metadata-rows>${metadataRowsHtml(preloadedMeta)}<tr data-file-info-loading><td style="padding:4px 8px 4px 0;color:var(--fg2);">詳細</td><td style="padding:4px 0;">読み込み中...</td></tr></tbody>`
      + `</table><div class="file-embedded-panel" data-file-embedded-metadata-path="${escapeHtml(filePath)}"></div>`
      + `${tagsHtml}</div>`;
  }

  function findPanel(root, filePath) {
    if (!root) return null;
    return [...root.querySelectorAll('[data-file-info-path]')]
      .find(element => element.dataset.fileInfoPath === filePath) || null;
  }

  async function loadMetadata(filePath, preloadedMeta) {
    const preloaded = preloadedMeta && typeof preloadedMeta === 'object' ? preloadedMeta : null;
    if (preloaded && preloaded.embedded !== undefined) return preloaded;
    if (typeof global.apiFetch !== 'function') return preloaded;
    try {
      const fetched = await global.apiFetch('/file-meta?path=' + encodeURIComponent(filePath), { silentError: true });
      return fetched ? { ...(preloaded || {}), ...fetched } : preloaded;
    } catch (error) {
      return {
        ...(preloaded || {}),
        _metadataLoadError: error?.userMessage || error?.message || String(error),
      };
    }
  }

  function applyMetadata(root, filePath, meta) {
    const panel = findPanel(root, filePath);
    if (!panel) return false;
    const rows = panel.querySelector('[data-file-info-metadata-rows]');
    if (rows) rows.innerHTML = metadataRowsHtml(meta);
    const embeddedHost = [...panel.querySelectorAll('[data-file-embedded-metadata-path]')]
      .find(element => element.dataset.fileEmbeddedMetadataPath === filePath);
    global.MeldexEmbeddedMetadata?.renderEditor?.(embeddedHost, filePath, meta);
    return true;
  }

  function hydrateTags(root, options) {
    if (options?.showTags === false) return;
    if (typeof global.hydrateGlobalTagTargetEditors === 'function') {
      global.hydrateGlobalTagTargetEditors(root);
    }
  }

  async function renderInto(container, filePath, options) {
    if (!container) return false;
    const normalizedPath = String(filePath || '').trim();
    if (!normalizedPath) {
      container.innerHTML = '<div class="gb-empty-placeholder">ファイルが選択されていません</div>';
      return false;
    }
    const revision = (renderRevisions.get(container) || 0) + 1;
    renderRevisions.set(container, revision);
    const metadataPromise = loadMetadata(normalizedPath, options?.preloadedMeta);
    container.innerHTML = panelHtml(normalizedPath, options?.preloadedMeta, options);
    hydrateTags(container, options);
    const meta = await metadataPromise;
    if (renderRevisions.get(container) !== revision || options?.isCurrent?.() === false) return false;
    return applyMetadata(container, normalizedPath, meta);
  }

  async function showInDetailPanel(filePath, options) {
    const normalizedPath = String(filePath || '').trim();
    if (!normalizedPath || typeof global.showDetailPanel !== 'function') return false;
    const metadataPromise = loadMetadata(normalizedPath, options?.preloadedMeta);
    if (typeof global._dpSavePending === 'function' && !await global._dpSavePending()) return false;
    if (options?.isCurrent?.() === false) return false;
    await global.showDetailPanel(panelHtml(normalizedPath, options?.preloadedMeta, options));
    if (options?.isCurrent?.() === false) return false;
    const detailRoot = global.document.getElementById('rp-detail') || global.document;
    hydrateTags(detailRoot, options);
    const meta = await metadataPromise;
    if (options?.isCurrent?.() === false) return false;
    return applyMetadata(detailRoot, normalizedPath, meta);
  }

  function renderEmbedded(container, target) {
    if (!container) return false;
    const title = String(target?.label || target?.name || '埋め込みファイル');
    const type = String(target?.typeLabel || target?.type || '埋め込みデータ');
    const source = String(target?.source || target?.path || '');
    const dimensions = Number(target?.width) > 0 && Number(target?.height) > 0
      ? `${Math.round(target.width)} × ${Math.round(target.height)} px`
      : '';
    container.innerHTML = `<div style="padding:12px;" data-file-info-embedded="true">`
      + `<div style="font-size:15px;font-weight:bold;margin-bottom:12px;">${escapeHtml(title)}</div>`
      + '<table style="font-size:13px;color:var(--fg2);width:100%;border-collapse:collapse;"><tbody>'
      + `<tr><td style="padding:4px 8px 4px 0;white-space:nowrap;">種類</td><td style="padding:4px 0;">${escapeHtml(type)}</td></tr>`
      + (dimensions ? `<tr><td style="padding:4px 8px 4px 0;white-space:nowrap;">画像サイズ</td><td style="padding:4px 0;">${escapeHtml(dimensions)}</td></tr>` : '')
      + (source ? `<tr><td style="padding:4px 8px 4px 0;white-space:nowrap;">参照先</td><td style="padding:4px 0;word-break:break-all;font-size:11px;">${escapeHtml(source)}</td></tr>` : '')
      + '</tbody></table></div>';
    return true;
  }

  function cancel(container) {
    if (!container) return;
    renderRevisions.set(container, (renderRevisions.get(container) || 0) + 1);
  }

  global.MeldexFileInfoPanel = Object.freeze({
    renderInto,
    showInDetailPanel,
    renderEmbedded,
    cancel,
    contextForPath,
  });
})(window);
