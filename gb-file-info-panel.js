/* gb-file-info-panel.js: フォルダとボードで共有するファイル情報パネル */
(function initMeldexFileInfoPanel(global) {
  'use strict';

  const renderRevisions = new WeakMap();
  const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico']);
  const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'webm']);
  const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac']);

  const escapeHtml = global.MeldexEscape.html;

  function iconHtml(name, size) {
    return typeof global.lucide === 'function' ? global.lucide(name, size || 16) : '';
  }

  function fileIcon(ext, kind, type) {
    if (kind === 'folder') return 'folder';
    if (type === 'board') return 'layoutDashboard';
    if (type === 'database' || type === 'smart-db') return 'db';
    if (type === 'scriptnote') return 'bookOpenText';
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

  function contextForPath(filePath, options) {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    const fileName = normalized.split('/').pop() || normalized;
    const dotIndex = fileName.lastIndexOf('.');
    const ext = dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : '';
    const folderPath = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '';
    const folderName = folderPath.split('/').pop() || folderPath;
    const kind = options?.kind === 'folder' ? 'folder' : 'file';
    const type = String(options?.type || '').trim();
    const lowerName = fileName.toLowerCase();
    const inferredTypeLabel = kind === 'folder'
      ? 'フォルダ'
      : type === 'database' || /(?:\.sheet|\.database)\.json$/.test(lowerName)
        ? 'シート'
        : type === 'smart-db' || /(?:\.smart|\.smart-db)\.json$/.test(lowerName)
          ? 'スマートシート'
          : type === 'scriptnote' || lowerName.endsWith('.scriptnote.json')
            ? 'シナリオ'
            : type === 'calendar'
              ? 'カレンダー'
              : type === 'csv'
                ? 'CSV'
            : type === 'board' || /(?:\.board\.(?:json|md)|\.mel-board|\.board)$/.test(lowerName)
              ? 'ボード'
              : ext === 'md'
                ? 'ノート'
                : ext === 'html' || ext === 'htm'
                  ? 'HTML'
                  : ext || 'ファイル';
    return {
      fileName,
      ext,
      folderPath,
      folderName,
      kind,
      type,
      typeLabel: String(options?.typeLabel || inferredTypeLabel),
    };
  }

  function metadataRowsHtml(meta, options) {
    if (!meta) return '';
    const rows = [];
    const isLinked = !!(options?.linked || meta?.linked || (options?.link_folder_path && options.link_folder_path !== options?.folderPath));
    const linkFolderPath = String(options?.link_folder_path || meta?.link_folder_path || '').trim();
    const linkedFolders = Array.isArray(meta?.linked_folders) ? meta.linked_folders : (Array.isArray(options?.linkedFolders) ? options.linkedFolders : []);

    let storageMethod = '通常のファイル';
    if (isLinked) {
      storageMethod = 'リンクファイル';
    } else if (linkedFolders.length > 0 || Number(meta?.links_count) > 0) {
      storageMethod = 'リンク元ファイル';
    }
    rows.push(['保存方式', storageMethod]);

    if (isLinked) {
      if (meta?.source_path || options?.sourcePath) {
        rows.push(['リンク元', meta?.source_path || options?.sourcePath]);
      }
      if (linkFolderPath) {
        rows.push(['このリンクの場所', linkFolderPath]);
      }
    } else if (linkedFolders.length > 0 || Number(meta?.links_count) > 0) {
      const count = linkedFolders.length || Number(meta?.links_count) || 0;
      rows.push(['登録先', `${count} 件`]);
    }

    const dateRow = (label, value) => {
      if (!value) return;
      const parsed = new Date(value);
      const text = Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString('ja-JP');
      rows.push([label, text]);
    };
    dateRow('作成日時', meta.created);
    dateRow('更新日時', meta.modified);
    if (meta.size != null) rows.push(['ファイルサイズ', formatFileSize(meta.size)]);
    if (meta._metadataLoadError && meta._metadataLoadStatus !== 404) rows.push(['詳細', '読み込めませんでした']);
    const brokenRow = meta._metadataLoadStatus === 404
      ? '<tr data-file-info-broken><td style="padding:4px 8px 4px 0;color:var(--fg2);white-space:nowrap;">状態</td>'
        + '<td style="padding:4px 0;"><span class="gb-badge" style="color:var(--danger);">リンク切れ</span>'
        + (typeof options?.onRelocate === 'function'
          ? ' <button type="button" class="btn-small" data-file-info-relocate>新しいファイルを選んで付け替える</button>'
          : '')
        + '</td></tr>'
      : '';
    return rows.map(([label, value]) => (
      `<tr><td style="padding:4px 8px 4px 0;color:var(--fg2);white-space:nowrap;">${escapeHtml(label)}</td>`
      + `<td style="padding:4px 0;">${escapeHtml(value)}</td></tr>`
    )).join('') + brokenRow;
  }

  function panelHtml(filePath, preloadedMeta, options) {
    const info = contextForPath(filePath, {
      ...options,
      kind: options?.kind || preloadedMeta?.kind,
    });
    const isLinked = !!(options?.linked || preloadedMeta?.linked || (options?.link_folder_path && options.link_folder_path !== info.folderPath));
    const linkFolderPath = String(options?.link_folder_path || preloadedMeta?.link_folder_path || info.folderPath || '').trim();
    const tagsHtml = options?.showTags === false
      ? ''
      : `<div data-global-tags-target-path="${escapeHtml(filePath)}"></div>`;
    const folderIdentity = 'file-info-folder-' + encodeURIComponent(filePath);
    const folderHtml = info.folderPath
      ? `<button type="button" class="auto-link" data-e2e-id="${escapeHtml(folderIdentity)}" data-path="${escapeHtml(info.folderPath)}" data-native-folder="true" style="padding:0;border:0;background:transparent;color:var(--accent);font:inherit;cursor:pointer;">${escapeHtml(info.folderName)}</button>`
      : '—';
    const linkActionsHtml = isLinked
      ? `<div class="file-info-link-actions" data-file-info-link-actions style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">`
        + `<button type="button" class="gb-btn gb-btn-sm" data-action="promoteCurrentFolderLink" data-e2e-id="file-info-promote-link" style="font-size:12px;">この場所をリンク元にする</button>`
        + `<button type="button" class="gb-btn gb-btn-sm" data-action="materializeCurrentFolderLink" data-e2e-id="file-info-materialize-link" style="font-size:12px;">実体化</button>`
        + `</div>`
      : '';
    return `<div style="padding:12px;" data-file-info-path="${escapeHtml(filePath)}">`
      + `<div style="font-size:15px;font-weight:bold;margin-bottom:12px;display:flex;align-items:center;gap:6px;">${iconHtml(fileIcon(info.ext, info.kind, info.type), 16)} ${escapeHtml(info.fileName)}</div>`
      + '<table style="font-size:13px;color:var(--fg2);width:100%;border-collapse:collapse;">'
      + '<tbody>'
      + `<tr><td style="padding:4px 8px 4px 0;color:var(--fg2);white-space:nowrap;">種類</td><td style="padding:4px 0;">${escapeHtml(info.typeLabel)}</td></tr>`
      + `<tr><td style="padding:4px 8px 4px 0;color:var(--fg2);white-space:nowrap;">フォルダ</td><td style="padding:4px 0;">${folderHtml}</td></tr>`
      + `<tr><td style="padding:4px 8px 4px 0;color:var(--fg2);white-space:nowrap;">パス</td><td style="padding:4px 0;word-break:break-all;font-size:11px;">${escapeHtml(filePath)}</td></tr>`
      + '</tbody>'
      + `<tbody data-file-info-metadata-rows>${metadataRowsHtml(preloadedMeta, { ...options, isLinked, linkFolderPath })}<tr data-file-info-loading><td style="padding:4px 8px 4px 0;color:var(--fg2);">詳細</td><td style="padding:4px 0;">読み込み中...</td></tr></tbody>`
      + '</table>'
      + linkActionsHtml
      // タグはメモ入力欄の下（埋め込み情報の主要項目と埋め込み情報グループの間）に配置する。
      // renderEditor は自分の描画先を空にするため、タグが巻き添えで消えないよう
      // 描画先を [data-file-embedded-primary] と [data-file-embedded-groups] の2つに分け、
      // タグはそのどちらの子要素でもない兄弟要素として置く。
      + `<div class="file-embedded-panel" data-file-embedded-metadata-path="${escapeHtml(filePath)}">`
      + '<div data-file-embedded-primary></div>'
      + tagsHtml
      + '<div data-file-embedded-groups></div>'
      + '</div>'
      + (info.kind === 'folder' ? `<div data-duplicate-folder-setting data-path="${escapeHtml(filePath)}"></div>` : '')
      + '</div>';
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
        _metadataLoadStatus: Number(error?.status) || 0,
      };
    }
  }

  function applyMetadata(root, filePath, meta, options) {
    const panel = findPanel(root, filePath);
    if (!panel) return false;
    const isLinked = !!(options?.linked || meta?.linked || (options?.link_folder_path && options.link_folder_path !== options?.folderPath));
    const linkFolderPath = String(options?.link_folder_path || meta?.link_folder_path || options?.folderPath || '').trim();
    const rows = panel.querySelector('[data-file-info-metadata-rows]');
    if (rows) rows.innerHTML = metadataRowsHtml(meta, { ...options, isLinked, linkFolderPath });
    rows?.querySelector('[data-file-info-relocate]')?.addEventListener('click', () => {
      if (options?.isCurrent?.() === false) return;
      options?.onRelocate?.();
    });

    const linkActionsHost = panel.querySelector('[data-file-info-link-actions]');
    if (linkActionsHost) {
      const promoteBtn = linkActionsHost.querySelector('[data-e2e-id="file-info-promote-link"]');
      const matBtn = linkActionsHost.querySelector('[data-e2e-id="file-info-materialize-link"]');
      if (promoteBtn) {
        promoteBtn.addEventListener('click', async () => {
          if (typeof global.promoteFolderLinkToSourceWithHistory === 'function') {
            await global.promoteFolderLinkToSourceWithHistory(filePath, linkFolderPath, options);
          }
        });
      }
      if (matBtn) {
        matBtn.addEventListener('click', async () => {
          if (typeof global.materializeFolderLinkWithHistory === 'function') {
            await global.materializeFolderLinkWithHistory(filePath, linkFolderPath, options);
          }
        });
      }
    }

    const embeddedPanel = [...panel.querySelectorAll('[data-file-embedded-metadata-path]')]
      .find(element => element.dataset.fileEmbeddedMetadataPath === filePath);
    const primaryHost = embeddedPanel?.querySelector('[data-file-embedded-primary]') || embeddedPanel;
    const groupsHost = embeddedPanel?.querySelector('[data-file-embedded-groups]') || null;
    global.MeldexEmbeddedMetadata?.renderEditor?.(primaryHost, groupsHost, filePath, meta);
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
    return applyMetadata(container, normalizedPath, meta, options);
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
    return applyMetadata(detailRoot, normalizedPath, meta, options);
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
