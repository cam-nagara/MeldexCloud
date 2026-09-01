      }
    }
  }
}

function _applyPanelSize(el, pos, size) {
  if (pos === 'left' || pos === 'right') {
    el.style.width = size + 'px'; el.style.height = '';
  } else {
    el.style.height = size + 'px'; el.style.width = '';
  }
}

// プレビューコンテンツを生成
function _renderPreviewContent(item) {
  const frag = document.createDocumentFragment();
  // 画像・PDF → viewer.htmlをiframeで埋め込み
  const isPdf = item.name && item.name.toLowerCase().endsWith('.pdf');
  if (item.type === 'image' && item.external_reference) {
    const img = document.createElement('img');
    img.className = 'fp-img';
    img.src = _folderItemRawUrl(item);
    const imageHost = window.MeldexImageLoading?.createHost?.(img, { className: 'fp-image-host' });
    frag.appendChild(imageHost || img);
    window.MeldexImageLoading?.track?.(img, { host: imageHost, label: '画像を読み込んでいます', allowDetached: true });
  } else if (item.type === 'image' || isPdf) {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'width:100%;height:100%;min-height:300px;border:none;border-radius:4px;';
    if (isPdf) {
      iframe.src = '/viewer?pdf=' + encodeURIComponent(item.path) + '&embed=1';
    } else {
      iframe.src = _folderItemViewerUrl(item, true);
    }
    iframe.dataset.gbViewerCurrentUrl = iframe.src;
    if (typeof _gbBindViewerFastPathListeners === 'function') _gbBindViewerFastPathListeners(iframe);
    frag.appendChild(iframe);
  } else if (item.type === 'audio') {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.style.cssText = 'width:100%;margin-bottom:8px;';
    audio.src = _folderItemRawUrl(item);
    frag.appendChild(audio);
  } else if (item.type === 'video') {
    const video = document.createElement('video');
    video.controls = true;
    window.MeldexMediaPlayback?.prepare(video);
    video.style.cssText = 'width:100%;max-height:100%;margin-bottom:8px;border-radius:4px;object-fit:contain;';
    video.src = _folderItemRawUrl(item);
    frag.appendChild(video);
  } else if (['3d','psd','clip','document'].includes(item.type)) {
    const img = document.createElement('img');
    img.className = 'fp-img';
    img.src = '/api/thumbnail?path=' + encodeURIComponent(item.path) + '&size=512';
    img.onerror = () => {
      const icon = document.createElement('div');
      icon.style.cssText = 'text-align:center;margin:16px 0;color:var(--fg2);';
      icon.innerHTML = fileTypeIcon(item.type, 48);
      img.replaceWith(icon);
    };
    const imageHost = window.MeldexImageLoading?.createHost?.(img, { className: 'fp-image-host' });
    window.MeldexImageLoading?.track?.(img, { host: imageHost, label: 'プレビューを読み込んでいます', errorMode: 'silent', allowDetached: true });
    frag.appendChild(imageHost || img);
  } else {
    const icon = document.createElement('div');
    icon.style.cssText = 'text-align:center;margin:16px 0;color:var(--fg2);';
    icon.innerHTML = fileTypeIcon(item.type, 48);
    frag.appendChild(icon);
  }
  return frag;
}

// 詳細コンテンツを生成
function _renderDetailContent(item) {
  const frag = document.createDocumentFragment();

  // タイトル
  const title = document.createElement('div');
  title.className = 'fp-title';
  title.textContent = item.name;
  frag.appendChild(title);

  // メタデータ
  const meta = document.createElement('div');
  meta.className = 'fp-meta';
  const rows = [
    ['タイプ', FILE_TYPE_LABELS[item.type] || item.ext || 'unknown'],
    ['パス', item.path],
  ];
  if (item.external_reference && item.external_path) rows.push(['参照元', item.external_path]);
  if (item.size != null) rows.push(['ファイルサイズ', formatFileSize(item.size)]);
  if (item.modified) rows.push(['更新日時', item.modified.substring(0, 19).replace('T', ' ')]);
  if (item.type === 'image') rows.push(['解像度', '']); // onloadで更新
  rows.forEach(([k, v]) => {
    const row = document.createElement('div');
    row.className = 'fp-meta-row';
    const kSpan = document.createElement('span');
    kSpan.textContent = k;
    const vSpan = document.createElement('span');
    vSpan.style.textAlign = 'right';
    vSpan.style.wordBreak = 'break-all';
    vSpan.textContent = v;
    if (k === '解像度') vSpan.className = 'fp-img-dim';
    row.appendChild(kSpan);
    row.appendChild(vSpan);
    meta.appendChild(row);
  });
  frag.appendChild(meta);

  // アクションボタン
  const actions = document.createElement('div');
  actions.className = 'fp-actions';
  if (NATIVE_TYPES.has(item.type)) {
    const b = document.createElement('button');
    b.textContent = 'Meldexで開く';
    b.addEventListener('click', () => openFolderItem(item));
    actions.appendChild(b);
  }
  if (item.type !== 'folder') {
    const b = document.createElement('button');
    b.textContent = 'アプリで開く';
    b.addEventListener('click', () => openNative(item.path));
    actions.appendChild(b);
  }
  if (item.path && _folderCanCompress()) {
    const b = document.createElement('button');
    b.textContent = '圧縮';
    b.addEventListener('click', () => compressFolderItems([item]));
    actions.appendChild(b);
  }
  if (item.path && typeof _folderCanExtractArchive === 'function' && _folderCanExtractArchive(item)) {
    const b = document.createElement('button');
    b.textContent = '解凍';
    b.addEventListener('click', () => extractArchiveItem(item));
    actions.appendChild(b);
  }
  if (item.type === 'folder') {
    const b = document.createElement('button');
    b.innerHTML = lucide('play', 12) + ' スライドショー';
    b.addEventListener('click', () => openViewer('/viewer?folder=' + encodeURIComponent(item.path)));
    actions.appendChild(b);
  }
  if (item.name && item.name.toLowerCase().endsWith('.pdf')) {
    const b = document.createElement('button');
    b.innerHTML = lucide('play', 12) + ' PDFビューワー';
    b.addEventListener('click', () => openViewer('/viewer?pdf=' + encodeURIComponent(item.path)));
    actions.appendChild(b);
  }
  frag.appendChild(actions);

  if (item.path && typeof renderGlobalTagTargetEditor === 'function') {
    const tagBox = document.createElement('div');
    renderGlobalTagTargetEditor(tagBox, item.path, { compact: true, boxed: false });
    frag.appendChild(tagBox);
  }

  if (item.type === 'folder' && item.path) {
    const duplicateBox = document.createElement('div');
    duplicateBox.dataset.duplicateFolderSetting = '';
    duplicateBox.dataset.path = item.path;
    frag.appendChild(duplicateBox);
    setTimeout(() => window.MeldexDuplicateMonitor?.renderFolderTargetControls?.(duplicateBox), 0);
  }

  // 所属フォルダ
  if (item.path) {
    const sec = document.createElement('div');
    sec.style.marginTop = '12px';
    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:12px;color:var(--fg2);margin-bottom:4px;';
    lbl.textContent = '所属フォルダ:';
    sec.appendChild(lbl);
    const tags = document.createElement('div');
    tags.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
    sec.appendChild(tags);
    frag.appendChild(sec);
    loadFileFolderTags(item.path, tags);
  }
  return frag;
}

function showFolderPreview(item) {
  if (!item) return;
  // プレビュー/詳細タブ（#gb-preview-pane・#rp-detail）はメイン画面専用UI。独立した
  // 描画先（サブパネル等）が有効な間は、サブパネルにこれらのタブが無いため触らない
  // （ボードのリンクカード計画 Phase B-2 縮小スコープ）。
  if (typeof _folderIsIndependentSurface === 'function' && _folderIsIndependentSurface()) return;
  const selectedItems = typeof _folderSelectedItems !== 'undefined'
    ? (_folderSelectedItems || []).filter(selected => selected?.path)
    : [];
  const tagManagement = window.MeldexTagManagement;
  if (selectedItems.length && typeof tagManagement?.setAutoTagTargets === 'function') {
    tagManagement.setAutoTagTargets(selectedItems);
  } else {
    tagManagement?.setAutoTagTarget?.(item.path || '', item.type === 'folder');
  }

  // v5.0: プレビュータブにプレビュー表示
  const previewPane = document.getElementById('gb-preview-pane');
  if (previewPane && previewPane.closest('.gb-pane-content')) {
    // 白フラッシュ防止: 同種のコンテンツならsrc更新のみ
    const isPdf = item.name && item.name.toLowerCase().endsWith('.pdf');
    const existingIframe = previewPane.querySelector('iframe');
    if ((item.type === 'image' || isPdf) && existingIframe && !item.external_reference) {
      const newSrc = isPdf
        ? '/viewer?pdf=' + encodeURIComponent(item.path) + '&embed=1'
        : _folderItemViewerUrl(item, true);
      if (typeof _gbTryFastViewerSwitch === 'function') {
        _gbTryFastViewerSwitch(existingIframe, newSrc).then((ok) => {
          if (ok) existingIframe.dataset.gbViewerCurrentUrl = newSrc;
          else { existingIframe.dataset.gbViewerCurrentUrl = newSrc; existingIframe.src = newSrc; }
        });
      } else {
        existingIframe.src = newSrc;
      }
    } else {
      previewPane.innerHTML = '';
      previewPane.appendChild(_renderPreviewContent(item));
      window.MeldexMediaPlayback?.start(previewPane.querySelector('video'));
    }
  }

  // オプションパネル: ファイル選択時はエディタタブに統一表示（_showFileInfoInDetailPanel 経由）。
  // ビューワーiframe のメッセージ経由でも同じ関数が呼ばれるため、二重描画/フラッシュを防止する。
  // フォルダ選択時はビューワーiframe を経由しないので、従来の簡易表示を維持する。
  const detailPane = document.getElementById('rp-detail');
  if (detailPane && detailPane.closest('.gb-pane-content')) {
    if (item.type !== 'folder' && item.path && typeof _showFileInfoInDetailPanel === 'function') {
      _showFileInfoInDetailPanel(item.path, item, { autoTagTargets: selectedItems });
    } else {
      // フォルダ選択はバックリンクの対象から除外する（計画書§2.3）。この簡易表示
      // 経路は _showFileInfoInDetailPanel を通らないため、ここで明示的に選択対象を
      // クリアしないと前に選択していたファイルの古いバックリンクが残ってしまう。
      window.GBOptionTargetContext?.clear('folder-panel-select-folder');
      detailPane.innerHTML = '';
      const header = document.createElement('div');
      header.style.cssText = 'padding:8px 12px;border-bottom:1px solid var(--border);font-size:14px;font-weight:bold;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      header.textContent = item.name;
      detailPane.appendChild(header);
      const body = document.createElement('div');
      body.style.cssText = 'padding:12px;overflow-y:auto;flex:1;';
      body.appendChild(_renderDetailContent(item));
      detailPane.appendChild(body);
    }
  }
}

// パネル配置設定ドロップダウン
function showFolderPanelSettings() {
  document.querySelectorAll('.fv-panel-dropdown').forEach(el => el.remove());
  if (typeof showFolderDisplaySettings === 'function') showFolderDisplaySettings();
}

function _bindFolderPanelSettingsButton() {
  const btn = document.querySelector('[data-action="showFolderPanelSettings()"]');
  if (!btn || btn._folderPanelSettingsBound) return;
  btn._folderPanelSettingsBound = true;
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    showFolderPanelSettings();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _bindFolderPanelSettingsButton);
} else {
  _bindFolderPanelSettingsButton();
}

// リサイズハンドルの初期化
(function() {
  ['top','bottom','left','right'].forEach(pos => {
    const handle = document.getElementById('fv-resize-' + pos);
    if (!handle) return;
    const isV = pos === 'left' || pos === 'right';
    let startPos, startSize, panel;
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      panel = _panelEl(pos);
      if (!panel) return;
      startPos = isV ? e.clientX : e.clientY;
      startSize = isV ? panel.offsetWidth : panel.offsetHeight;
      handle.style.background = 'var(--accent)';
      // iframe がドラッグイベントを吸収するのを防止
      document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = 'none');
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
    function onMove(e) {
      const delta = (isV ? e.clientX : e.clientY) - startPos;
      const sign = (pos === 'right' || pos === 'bottom') ? -1 : 1;
      const newSize = Math.max(100, Math.min(800, startSize + delta * sign));
      if (isV) panel.style.width = newSize + 'px';
      else panel.style.height = newSize + 'px';
      savePanelSize();
    }
    function savePanelSize() {
      const cfg = _getFvPanelCfg();
      const size = isV ? panel.offsetWidth : panel.offsetHeight;
      // どのタイプのパネルかを判定
      if (panel._panelType === 'preview' || panel._panelType === 'both') cfg.previewSize = size;
      if (panel._panelType === 'detail') cfg.detailSize = size;
      _saveFvPanelCfg(cfg);
    }
    function onUp() {
      handle.style.background = '';
      document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = '');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      savePanelSize();
    }
  });
})();

function _refreshFolderLinkUi(filePath, folderPath, tagsContainer) {
  if (tagsContainer) loadFileFolderTags(filePath, tagsContainer);
  if (typeof loadOutliner === 'function') loadOutliner();
  if (folderPath && _folderPath === folderPath && typeof openFolder === 'function') {
    openFolder(folderPath.split('/').pop() || folderPath, folderPath, {
      skipNavPush: true,
      skipSaveLastView: true,
      skipHighlight: true,
      fromExplorer: true,
    });
  }
}

function _pushFolderLinkHistory(label, filePath, fileId, folderPath, folderId, tagsContainer, detail) {
  if (typeof historyPush !== 'function' || !fileId || (!folderPath && !folderId)) return false;
  const removePayload = { file_id: fileId };
  if (folderId) removePayload.folder_id = folderId;
  else removePayload.folder_path = folderPath;
  const addPayload = { file_path: filePath };
  if (folderId) addPayload.folder_id = folderId;
  else addPayload.folder_path = folderPath;
  historyPush(
    label,
    async () => {
      if (label.includes('登録')) await apiPost('/folder-links/remove', removePayload);
      else await apiPost('/folder-links/add', addPayload);
      _refreshFolderLinkUi(filePath, folderPath, tagsContainer);
    },
    async () => {
      if (label.includes('登録')) await apiPost('/folder-links/add', addPayload);
      else await apiPost('/folder-links/remove', removePayload);
      _refreshFolderLinkUi(filePath, folderPath, tagsContainer);
    },
    '',
    detail || ''
  );
  return true;
}

async function addFolderLinkWithHistory(filePath, folderPath, options = {}) {
  const folderId = options.folderId || '';
  const tagsContainer = options.tagsContainer || null;
  const payload = { file_path: filePath };
  if (folderId) payload.folder_id = folderId;
  else payload.folder_path = folderPath;
  const res = await apiPost('/folder-links/add', payload);
  const fileId = res?.file_id || options.fileId || '';
  const resolvedFolderPath = res?.folder_path || folderPath || '';
  const resolvedFolderId = res?.folder_id || folderId || '';
  if (typeof _folderInvalidateMembershipsForPath === 'function') _folderInvalidateMembershipsForPath(filePath);
  if (res?.created !== false) {
    _pushFolderLinkHistory(
      '所属フォルダリンク: 登録',
      filePath,
      fileId,
      resolvedFolderPath,
      resolvedFolderId,
      tagsContainer,
      (filePath || '') + ' → ' + (resolvedFolderPath || resolvedFolderId)
    );
  }
  _refreshFolderLinkUi(filePath, resolvedFolderPath, tagsContainer);
  return res;
}

async function removeFolderLinkWithHistory(filePath, fileId, folderPath, options = {}) {
  const folderId = options.folderId || '';
  const tagsContainer = options.tagsContainer || null;
  const payload = { file_id: fileId };
  if (folderId) payload.folder_id = folderId;
  else payload.folder_path = folderPath;
  const res = await apiPost('/folder-links/remove', payload);
  if (typeof _folderInvalidateMembershipsForPath === 'function') _folderInvalidateMembershipsForPath(filePath);
  if (res?.removed !== false) {
    _pushFolderLinkHistory(
      '所属フォルダリンク: 解除',
      filePath,
      fileId,
      folderPath || '',
      folderId,
      tagsContainer,
      (filePath || '') + ' ← ' + (folderPath || folderId)
    );
  }
  _refreshFolderLinkUi(filePath, folderPath || '', tagsContainer);
  return res;
}

async function loadFileFolderTags(filePath, container) {
  try {
    const folders = await apiFetch('/file-folders?path=' + encodeURIComponent(filePath));
    if (typeof _folderStoreMembershipsForPath === 'function') _folderStoreMembershipsForPath(filePath, folders);
    container.innerHTML = '';
    folders.forEach(f => {
      const tag = document.createElement('span');
      tag.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:10px;font-size:11px;background:rgba(255,255,255,0.08);color:var(--fg);cursor:pointer;';
      const name = f.folder.split('/').pop() || f.folder;
      tag.textContent = (f.type === 'link' ? '\u2197 ' : '') + name;
      tag.title = f.folder + '（クリックで開く）';
      tag.dataset.gbTooltip = f.folder + '（クリックで開く）';
      tag.addEventListener('click', () => openFolder(name, f.folder, { fromExplorer: true }));
      // リンクフォルダは解除ボタン付き
      if (f.type === 'link' && f.file_id) {
        const removeBtn = document.createElement('span');
        removeBtn.textContent = '\u00d7';
        removeBtn.style.cssText = 'cursor:pointer;color:var(--fg2);margin-left:2px;';
        removeBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await removeFolderLinkWithHistory(filePath, f.file_id, f.folder, { tagsContainer: container });
          showStatus('リンク解除しました');
        });
        tag.appendChild(removeBtn);
      }
      container.appendChild(tag);
    });

    // +ボタン
    const addBtn = document.createElement('span');
    addBtn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:10px;font-size:14px;background:rgba(255,255,255,0.05);color:var(--fg2);cursor:pointer;';
    addBtn.textContent = '+';
    addBtn.title = 'フォルダにリンク登録';
    addBtn.dataset.gbTooltip = 'このファイルを別フォルダにもリンク登録します';
    addBtn.addEventListener('click', () => showAddFolderLinkModal(filePath, container));
    container.appendChild(addBtn);
  } catch (e) {}
}

function showAddFolderLinkModal(filePath, tagsContainer) {
  if (typeof window.GBUI?.createModal !== 'function') {
    throw new Error('フォルダリンク登録を初期化できませんでした。');
  }
  const existing = document.querySelector('.folder-link-register-overlay');
  if (existing?._folderLinkModalApi?.isOpen?.()) {
    existing._folderLinkModalApi.modal.focus?.({ preventScroll: true });
    return existing._folderLinkModalApi;
  }
  const content = document.createElement('div');
  content.innerHTML = `
    <div style="margin-bottom:8px;color:var(--fg2);font-size:12px;">${esc(filePath.split('/').pop())}</div>
    <div class="field"><label>フォルダパス（直接入力またはツリーから選択）</label><input id="modal-link-folder" type="text" placeholder="例: 作品/『サンプル作品』/第1話登場"></div>
    <div id="modal-link-tree" style="max-height:250px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;padding:4px;margin-bottom:8px;background:var(--bg);font-size:12px;">
      <div style="color:var(--fg2);padding:4px;">読み込み中...</div>
    </div>
    <div class="gb-dialog-inline-status" data-folder-link-status role="status" aria-live="polite" hidden></div>`;
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'gb-btn gb-btn-sm';
  cancelButton.dataset.role = 'cancel';
  cancelButton.textContent = 'キャンセル';
  const submitButton = document.createElement('button');
  submitButton.type = 'button';
  submitButton.className = 'gb-btn gb-btn-sm gb-btn-primary primary';
  submitButton.dataset.role = 'submit';
  submitButton.textContent = '登録';
  let busy = false;
  const modalApi = window.GBUI.createModal({
    id: 'folder-link-register',
    title: 'フォルダにリンク登録',
    body: [...content.childNodes],
    footer: [cancelButton, submitButton],
    variant: 'standard',
    extraClass: 'folder-link-register-modal',
    geometryKey: 'folder-link-register',
    minWidth: '0',
    initialFocus: '#modal-link-folder',
    returnFocus: document.activeElement,
    closeLabel: 'フォルダリンク登録を閉じる',
    closeOnEsc: true,
    closeOnOverlay: true,
    onBeforeClose: reason => !busy || ['saved', 'test-cleanup'].includes(reason),
  });
  const o = modalApi.overlay;
  o.classList.add('modal-overlay', 'folder-link-register-overlay');
  o.dataset.e2eId = 'folder-link-register-overlay';
  o._folderLinkModalApi = modalApi;
  o._folderLinkFilePath = filePath;
  o._folderLinkTagsContainer = tagsContainer;
  o._setFolderLinkBusy = value => {
    busy = !!value;
    o.setAttribute('aria-busy', busy ? 'true' : 'false');
    cancelButton.disabled = busy;
    submitButton.disabled = busy;
    const closeButton = modalApi.header.querySelector('.gb-modal-close');
    if (closeButton) closeButton.disabled = busy;
    modalApi.body.querySelector('#modal-link-folder').disabled = busy;
  };
  cancelButton.addEventListener('click', () => modalApi.close('cancel'));
  submitButton.addEventListener('click', () => submitAddFolderLink(filePath, o));
  modalApi.open();
  // フォルダツリーを読み込み
  _loadFolderLinkTree(modalApi.body.querySelector('#modal-link-tree'));
  return modalApi;
}

async function _loadFolderLinkTree(container) {
  try {
    const roots = window.GBFolderPicker?.loadRoots
      ? await window.GBFolderPicker.loadRoots()
      : await apiFetch('/outliner-roots');
    container.innerHTML = '';
    if (window.GBFolderPicker?.loadRoots) {
      roots.forEach(root => {
        const rootEl = _createLinkTreeNode(root.name, root.path, root.rootPath || root.path, true, {
          sourceId: root.sourceId || '',
          rootKind: root.kind || root.rootKind || '',
          workspaceId: root.workspaceId || '',
        });
        container.appendChild(rootEl);
      });
      return;
    }
    // ホームフォルダを先頭に追加（ルートに含まれていない場合）
    if (_homeFolderPath) {
      const rootPaths = roots.filter(r => r.visible).map(r => r.path);
      if (!rootPaths.includes(_homeFolderPath)) {
        const homeLabel = typeof HOME_FOLDER_DISPLAY_LABEL !== 'undefined' ? HOME_FOLDER_DISPLAY_LABEL : 'ホームフォルダ';
        const homeEl = _createLinkTreeNode(homeLabel, _homeFolderPath, _homeFolderPath, true);
        container.appendChild(homeEl);
      }
    }
    for (const root of roots.filter(r => r.visible)) {
      const rootEl = _createLinkTreeNode(root.name, root.path, root.path, true);
      container.appendChild(rootEl);
    }
  } catch(e) {
    container.innerHTML = '<div style="color:var(--fg2);padding:4px;">ツリーの読み込みに失敗</div>';
  }
}

function _createLinkTreeNode(name, path, rootPath, isRoot, options = {}) {
  const div = document.createElement('div');
  div.style.marginLeft = isRoot ? '0' : '16px';

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:4px;padding:2px 4px;cursor:pointer;border-radius:3px;';
  row.onmouseenter = () => { row.style.background = 'var(--bg3)'; };
  row.onmouseleave = () => { row.style.background = ''; };

  const toggle = document.createElement('span');
  toggle.textContent = '\u25B6';
  toggle.style.cssText = 'font-size:9px;width:12px;text-align:center;flex-shrink:0;color:var(--fg2);cursor:pointer;';
  toggle.dataset.expanded = 'false';
  row.appendChild(toggle);

  const icon = document.createElement('span');
  icon.innerHTML = lucide('folder', 14);
  icon.style.cssText = 'flex-shrink:0;color:var(--fg2);';
  row.appendChild(icon);

  const label = document.createElement('span');
  label.textContent = name;
  label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  row.appendChild(label);

  div.appendChild(row);

  const childrenDiv = document.createElement('div');
  childrenDiv.style.display = 'none';
  childrenDiv.dataset.loaded = 'false';
  div.appendChild(childrenDiv);

  // 展開/折りたたみ処理
  async function _toggleExpand() {
    const expanded = toggle.dataset.expanded === 'true';
    if (expanded) {
      childrenDiv.style.display = 'none';
      toggle.textContent = '\u25B6';
      toggle.dataset.expanded = 'false';
    } else {
      childrenDiv.style.display = '';
      toggle.textContent = '\u25BC';
      toggle.dataset.expanded = 'true';
      if (childrenDiv.dataset.loaded === 'false') {
        childrenDiv.dataset.loaded = 'true';
        childrenDiv.innerHTML = '<div style="color:var(--fg2);padding:2px 16px;font-size:11px;">...</div>';
        try {
          const sourceParam = options.sourceId ? '&sourceId=' + encodeURIComponent(options.sourceId) : '';
          const items = await apiFetch('/browse?path=' + encodeURIComponent(path) + '&root=' + encodeURIComponent(rootPath) + '&folders_only=1&sort=name&order=asc' + sourceParam);
          childrenDiv.innerHTML = '';
          const folders = items.filter(it => it.type === 'folder');
          if (folders.length === 0) {
            childrenDiv.innerHTML = '<div style="color:var(--fg2);padding:2px 16px;font-size:11px;">（フォルダなし）</div>';
          } else {
            folders.forEach(f => {
              childrenDiv.appendChild(_createLinkTreeNode(f.name, f.path, rootPath, false, options));
            });
          }
        } catch(err) {
          childrenDiv.innerHTML = '<div style="color:var(--red);padding:2px 16px;font-size:11px;">エラー</div>';
        }
      }
    }
  }

  // 行クリック → パスをセット + 展開/折りたたみ
  row.addEventListener('click', async (e) => {
    e.stopPropagation();
    const input = document.getElementById('modal-link-folder');
    if (input) input.value = path;
    // 選択ハイライト
    document.querySelectorAll('#modal-link-tree .link-tree-selected').forEach(el => {
      el.classList.remove('link-tree-selected');
      el.style.background = '';
    });
    row.classList.add('link-tree-selected');
    row.style.background = 'rgba(86,156,214,0.2)';
    // 展開/折りたたみもトリガー
    await _toggleExpand();
  });

  return div;
}

async function submitAddFolderLink(filePath, overlay) {
  const activeOverlay = overlay || document.querySelector('.folder-link-register-overlay');
  const input = activeOverlay?.querySelector('#modal-link-folder');
  const folder = input?.value.trim() || '';
  if (!folder) { showStatus('フォルダパスを入力してください', true); return; }
  if (activeOverlay?.getAttribute('aria-busy') === 'true') return;
  const status = activeOverlay?.querySelector('[data-folder-link-status]');
  if (status) {
    status.hidden = true;
    status.textContent = '';
  }
  activeOverlay?._setFolderLinkBusy?.(true);
  try {
    await addFolderLinkWithHistory(filePath, folder, { tagsContainer: activeOverlay?._folderLinkTagsContainer });
    showStatus('リンク登録しました');
    activeOverlay?._folderLinkModalApi?.close?.('saved');
  } catch (e) {
    showStatus('リンク登録に失敗', true);
    if (status) {
      status.hidden = false;
      status.textContent = 'リンク登録に失敗しました。内容を確認して再試行してください。';
    }
  } finally {
    if (activeOverlay?.isConnected) activeOverlay._setFolderLinkBusy?.(false);
  }
}

function _getViewerParam(params, key) {
  const value = params.get(key) || '';
  return value ? String(value) : '';
}

function _inferViewerFileTypeFromPath(path) {
  const ext = String(path || '').split('?')[0].split('#')[0].split('.').pop().toLowerCase();
  if (!ext || ext === String(path || '').toLowerCase()) return '';
  if (['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'apng', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico', 'tif', 'tiff', 'heic', 'heif', 'psd', 'psb'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'avi', 'webm', 'mkv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'csv') return 'csv';
  if (ext === 'html' || ext === 'htm') return 'html';
  return '';
}

function _firstViewerFilesPath(filesValue) {
  if (!filesValue) return '';
  try {
    const files = JSON.parse(filesValue);
    if (Array.isArray(files)) return files[0] || '';
  } catch {}
  return String(filesValue).split(',').filter(Boolean)[0] || '';
}

function _inferViewerFileType(url) {
  const query = String(url || '').includes('?') ? String(url || '').substring(String(url || '').indexOf('?') + 1) : '';
  if (!query) return '';
  const params = new URLSearchParams(query);
  if (_getViewerParam(params, 'folder')) return 'folder';
  if (_getViewerParam(params, 'pdf')) return 'pdf';
  const filePath = _getViewerParam(params, 'file')
    || _firstViewerFilesPath(_getViewerParam(params, 'files'))
    || _getViewerParam(params, 'path')
    || String(url || '').split('?')[0];
  return _inferViewerFileTypeFromPath(filePath);
}

function _viewerPrimaryPathFromUrl(url) {
  const query = String(url || '').includes('?') ? String(url || '').substring(String(url || '').indexOf('?') + 1) : '';
  if (!query) return '';
  const params = new URLSearchParams(query);
  return _getViewerParam(params, 'file')
    || _getViewerParam(params, 'pdf')
    || _getViewerParam(params, 'folder')
    || _firstViewerFilesPath(_getViewerParam(params, 'files'))
    || '';
}

function _syncViewerInitialPathToOutliner(url, openOpts) {
  if (openOpts?.skipHighlight || typeof highlightOutlinerNode !== 'function') return;
  const filePath = _viewerPrimaryPathFromUrl(url);
  if (filePath) highlightOutlinerNode(filePath);
}

// === ビューワーiframeの高速切替（フルナビゲーションなしでの表示差し替え） ===
// viewer.html は初期化完了時に {type:'viewer-ready'} を親へ post し、親から
// {type:'viewer-open-request', requestId, url} を受けたらページ遷移なしで表示対象を
// 差し替え、{type:'viewer-open-ack', requestId} を返す（対応不能なら 'viewer-open-nack'）。
// これはビューワー担当と並行実装中の契約。この応答が来た場合のみ iframe.src の
// 再代入（=viewer.htmlのフルナビゲーション、スクリプト再実行を伴う重い処理）を回避する。
const _gbViewerFastPathState = new WeakMap(); // iframe要素 -> {ready, seq, bound}

function _gbViewerFastPathStateFor(iframe) {
  let st = _gbViewerFastPathState.get(iframe);
  if (!st) {
    st = { ready: false, seq: 0, bound: false };
    _gbViewerFastPathState.set(iframe, st);
  }
  return st;
}

function _gbIsViewerRouteUrl(url) {
  // 論理URL（/viewer?...）と解決済URL（/viewer.html?...、絶対URL含む）の両方を受け付ける。
  // 解決形を弾くと高速パスが一度も成立しない（rewriteInternalUrl後のURLが渡るため）。
  try {
    const u = new URL(String(url || '').trim(), window.location.origin);
    if (u.origin !== window.location.origin) return false;
    return u.pathname === '/viewer' || u.pathname === '/viewer.html' || u.pathname.endsWith('/viewer.html');
  } catch {
    return false;
  }
}

// このiframeにビューワーが生きているか（同一オリジンの直接プローブ）。
// 当初は viewer-ready メッセージ + load イベントのフラグ管理だったが、viewer-ready は
// スクリプト初期化完了時（loadより先）に届くことがあり、後から来る load がフラグを
// リセットして高速パスが一度も成立しなくなる競合があった（v0.7.139検証で実測）。
// 同一オリジンなので contentWindow を直接見るのが最も確実。open-request リスナーが
// まだ未登録の初期化途中でも、ackが250ms以内に来なければ従来のsrc差し替えへ落ちる。
function _gbViewerFrameLive(iframe) {
  try {
    return !!(iframe && iframe.contentWindow && iframe.contentWindow.MeldexViewerScene);
  } catch {
    return false;
  }
}

// requestId 採番用の状態を保持する（生成直後・高速切替直前のどちらから呼んでもよい）。
function _gbBindViewerFastPathListeners(iframe) {
  if (!iframe) return null;
  return _gbViewerFastPathStateFor(iframe);
}

// resolvedUrl へ、可能ならページ遷移なしで切り替える。250ms以内にackが来なければ
// false を返す（呼び出し側は従来どおり iframe.src の代入へフォールバックすること）。
function _gbTryFastViewerSwitch(iframe, resolvedUrl) {
  if (!iframe || !_gbIsViewerRouteUrl(resolvedUrl)) return Promise.resolve(false);
  const st = _gbBindViewerFastPathListeners(iframe);
  if (!st || !_gbViewerFrameLive(iframe)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const requestId = 'vreq-' + (++st.seq) + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    let settled = false;
    const timer = setTimeout(() => finish(false), 250);
    function finish(ok) {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      resolve(ok);
    }
    function onMessage(ev) {
      if (ev.source !== iframe.contentWindow) return;
      const data = ev.data;
      if (!data || data.requestId !== requestId) return;
      if (data.type === 'viewer-open-ack') finish(true);
      else if (data.type === 'viewer-open-nack') finish(false);
    }
    window.addEventListener('message', onMessage);
    try {
      iframe.contentWindow.postMessage({ type: 'viewer-open-request', requestId, url: resolvedUrl }, window.location.origin);
    } catch {
      finish(false);
    }
  });
}

function _gbNavigateViewerIframeSlow(iframe, url, resolvedUrl, openOpts) {
  if (typeof trackIframeLoading === 'function') {
    const inferredType = _inferViewerFileType(url);
    const loadingLabel = inferredType === 'pdf' ? 'PDFを読み込み中...' : 'ビューアを読み込み中...';
    if (!(inferredType === 'image' && !openOpts.forceViewerLoading)) {
      trackIframeLoading(iframe, loadingLabel, openOpts);
    }
  }
  // datasetには論理URL（openViewerへ渡された形）を保存する。タブ復帰時の実内容検証
  // （gb-pane-bridge.part02.part01.js の _gbVerifyAndFixMediaContainer）が期待値として
  // 論理URLを組み立てるため、解決済URLを入れると常に不一致→毎回開き直しになる。
  iframe.dataset.gbViewerCurrentUrl = url;
  iframe.src = resolvedUrl;
}

// メインビューワーiframe（#html-iframe）を対象URLへ開く。高速パスが使えれば
// フルナビゲーションなしで切替え、250ms以内に応答がない／非対応の場合のみ
// 従来どおり src 代入（+ローディング表示）にフォールバックする。
// 高速パス成功時はローディング表示を出さない。
function _gbOpenViewerIframe(iframe, url, resolvedUrl, openOpts) {
  if (!iframe) return;
  _gbBindViewerFastPathListeners(iframe);
  if (_gbViewerFrameLive(iframe) && _gbIsViewerRouteUrl(resolvedUrl)) {
    _gbTryFastViewerSwitch(iframe, resolvedUrl).then((ok) => {
      if (ok) {
        iframe.dataset.gbViewerCurrentUrl = url;
      } else {
        _gbNavigateViewerIframeSlow(iframe, url, resolvedUrl, openOpts);
      }
    });
    return;
  }
  _gbNavigateViewerIframeSlow(iframe, url, resolvedUrl, openOpts);
}

function _gbInitMainViewerIframeFastPath() {
  const iframe = document.getElementById('html-iframe');
  if (iframe) _gbBindViewerFastPathListeners(iframe);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _gbInitMainViewerIframeFastPath);
} else {
  _gbInitMainViewerIframeFastPath();
}

function openViewer(url, opts) {
  const openOpts = opts || {};
  if (!openOpts.skipShowView) showView('html');
  _syncViewerInitialPathToOutliner(url, openOpts);
  const iframe = document.getElementById('html-iframe');
  const resolvedUrl = window.MeldexResourceUrl?.rewriteInternalUrl?.(url) || url;
  if (iframe) {
    const preparedIframe = typeof _gbPrepareUntrustedIframe === 'function'
      ? _gbPrepareUntrustedIframe(iframe, resolvedUrl)
      : iframe;
    _gbOpenViewerIframe(preparedIframe || iframe, url, resolvedUrl, openOpts);
  }
  // ビューワー表示時に詳細パネルにファイル情報を表示
  if (!openOpts.skipGlobalUi) {
    const filePath = _viewerPrimaryPathFromUrl(url);
    if (filePath && typeof _showFileInfoInDetailPanel === 'function') {
      _showFileInfoInDetailPanel(filePath);
    }
  }
  // ステータスバー右側にビューワーのショートカット一覧を表示する。showView('media')→
  // showView('html') の順で走るとhtml分岐が空文字で上書きするため、ビューワーを開いた
  // 時点で直接反映して表示を確定させる（メインiframeでの表示時のみ）。
  if (!openOpts.skipGlobalUi && typeof updateMediaViewerShortcutStatusbar === 'function') {
    updateMediaViewerShortcutStatusbar();
  }
}

// フォルダビュー表示設定
function getFolderDisplayConfig() {
  try { return JSON.parse(localStorage.getItem('folder-display-config') || '{}'); } catch { return {}; }
}
function saveFolderDisplayConfig(cfg) { localStorage.setItem('folder-display-config', JSON.stringify(cfg)); }

function _fdSection(menu, title, actionNode, titleDataset) {
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 12px 4px;font-size:11px;font-weight:bold;color:var(--accent);cursor:default;';
  const label = document.createElement('span');
  label.textContent = title;
  if (titleDataset) Object.assign(label.dataset, titleDataset);
  head.appendChild(label);
  if (actionNode) {
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    head.appendChild(spacer);
    head.appendChild(actionNode);
  }
  menu.appendChild(head);
}

function _fdSep(menu) {
  const sep = document.createElement('div');
  sep.className = 'gb-context-menu-sep';
  menu.appendChild(sep);
}

function _fdCheckboxRow(label, checked, onChange, options = {}) {
  const row = document.createElement('div');
  row.className = 'gb-context-menu-item';
  row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 14px;cursor:pointer;font-size:13px;';
  if (options.dataset) {
    Object.keys(options.dataset).forEach(key => { row.dataset[key] = options.dataset[key]; });
  }
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!checked;
  input.style.flexShrink = '0';
  const text = document.createElement('span');
  text.textContent = label;
  text.style.overflow = 'hidden';
  text.style.textOverflow = 'ellipsis';
  text.style.whiteSpace = 'nowrap';
  row.appendChild(input);
  row.appendChild(text);
  input.addEventListener('change', () => onChange(input.checked));
  row.addEventListener('click', (event) => {
    event.stopPropagation();
    if (event.target === input) return;
    input.checked = !input.checked;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  return row;
}

function _fdSetArrayFilter(cfg, key, value, enabled) {
  const set = new Set((typeof _folderFilterArray === 'function' ? _folderFilterArray(cfg[key]) : []).map(v => String(v)));
  if (enabled) set.add(String(value));
  else set.delete(String(value));
  cfg[key] = Array.from(set);
  saveFolderDisplayConfig(cfg);
  renderFolderGrid();
}

function _fdButton(label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.style.cssText = 'font-size:11px;padding:2px 7px;background:var(--bg3);color:var(--fg2);border:1px solid var(--border);border-radius:4px;cursor:pointer;';
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return btn;
}

function _applyTreeLayoutMode(mode) {
  const resolved = mode === 'grid' ? 'grid' : 'list';
  const enabled = resolved === 'grid';
  document.getElementById('outliner-tree')?.classList.toggle('tree-grid-layout', enabled);
  document.getElementById('tree-scroll-container')?.classList.toggle('tree-grid-layout', enabled);
  return resolved;
}

function _treeThumbnailDisplaySize() {
  const thumbnails = window.GBOutlinerThumbnails;
  const enabled = typeof thumbnails?.isEnabled === 'function'
    ? thumbnails.isEnabled()
    : localStorage.getItem('gb:tree-thumbnails-enabled') !== '0';
  if (!enabled) return 'none';
  const mode = typeof thumbnails?.sizeMode === 'function'
    ? thumbnails.sizeMode()
    : (localStorage.getItem('gb:tree-thumbnail-size') || 'medium');
  return mode === 'small' ? 'sm' : (mode === 'large' ? 'lg' : 'md');
}

function _setTreeThumbnailDisplaySize(displaySize) {
  const thumbnails = window.GBOutlinerThumbnails;
  const enabled = displaySize !== 'none';
  const mode = displaySize === 'sm' ? 'small' : (displaySize === 'lg' ? 'large' : 'medium');
  if (typeof thumbnails?.setEnabled === 'function') thumbnails.setEnabled(enabled);
  else localStorage.setItem('gb:tree-thumbnails-enabled', enabled ? '1' : '0');
  if (enabled) {
    if (typeof thumbnails?.setSizeMode === 'function') thumbnails.setSizeMode(mode);
    else if (mode === 'medium') localStorage.removeItem('gb:tree-thumbnail-size');
    else localStorage.setItem('gb:tree-thumbnail-size', mode);
    if (typeof applyThumbnailSize === 'function') applyThumbnailSize(mode);
  }
  return { enabled, mode };
}

function _restoreTreeDisplaySettings() {
  _applyTreeLayoutMode(globalThis.localStorage?.getItem?.('tree-layout') || 'list');
}

let _treeDisplayRefreshRunning = false;
let _treeDisplayRefreshPending = false;
let _treeDisplayRefreshPromise = null;

function _refreshTreeAfterDisplaySettingsChange(reason) {
  _treeDisplayRefreshPending = true;
  if (_treeDisplayRefreshRunning) return _treeDisplayRefreshPromise;

  _treeDisplayRefreshRunning = true;
  const progress = window.MeldexOperationProgress?.begin?.({
    id: 'folder-tree-display-settings-refresh',
    kind: 'folder-tree-display-settings',
    label: 'フォルダツリーの表示設定を反映中…',
    message: '一覧・サムネイル・サブフォルダの表示を更新しています',
    mode: 'indeterminate',
    background: false,
    delayMs: 300,
    showInTray: true,
    priority: 40,
  }) || null;
  const fallbackLoading = !progress && typeof showLoading === 'function';
  if (fallbackLoading) showLoading('フォルダツリーの表示設定を反映中…');

  _treeDisplayRefreshPromise = (async () => {
    try {
      do {
        _treeDisplayRefreshPending = false;
        if (typeof loadOutliner === 'function') {
          await loadOutliner({
            force: true,
            reason: reason || 'tree-display-settings',
            suppressLoading: true,
          });
        }
      } while (_treeDisplayRefreshPending);
      progress?.succeed?.({ dismissMs: 0 });
      return true;
    } catch (error) {
      progress?.fail?.({ error, dismissMs: 0 });
      throw error;
    } finally {
      if (fallbackLoading && typeof hideLoading === 'function') hideLoading();
      _treeDisplayRefreshRunning = false;
      _treeDisplayRefreshPending = false;
      _treeDisplayRefreshPromise = null;
    }
  })();
  return _treeDisplayRefreshPromise;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _restoreTreeDisplaySettings, { once: true });
} else {
  _restoreTreeDisplaySettings();
}

function showFolderDisplaySettings(options) {
  const filterOnly = options?.filterOnly === true;
  const isTreeSurface = options?.surface === 'tree';
  // 既存メニューを閉じる
  document.querySelectorAll('.fd-dropdown').forEach(el => el.remove());

  const cfg = getFolderDisplayConfig();
  const btn = options?.triggerEl || document.querySelector(isTreeSurface
    ? '#btn-tree-display'
    : (filterOnly
      ? '[data-action="showFolderFilterSettings()"], #folder-filter-btn'
      : '[data-action="showFolderDisplaySettings()"], #folder-display-btn'));
  const rect = btn?.getBoundingClientRect?.() || { left: window.innerWidth / 2, bottom: window.innerHeight / 2 };

  const menu = document.createElement('div');
  menu.className = 'fd-dropdown gb-context-menu';
  menu.style.minWidth = '300px';
  menu.style.maxWidth = '360px';
  menu.style.maxHeight = 'min(78vh, 680px)';
  menu.style.overflowY = 'auto';
  if (!isTreeSurface) {
    const z = _getZoom();
    menu.style.left = (rect.left / z) + 'px';
    menu.style.top = (rect.bottom / z + 2) + 'px';
  }

  if (isTreeSurface) {
    const treeLayout = localStorage.getItem('tree-layout') || 'list';
    const treeThumbSize = _treeThumbnailDisplaySize();

    _fdSection(menu, 'ツリー表示形式');
    [
      { key: 'list', label: 'リスト', icon: 'list' },
      { key: 'grid', label: 'グリッド', icon: 'grid3x3' },
    ].forEach(item => {
      const row = document.createElement('div');
      row.className = 'gb-context-menu-item';
      row.innerHTML = radioMark(treeLayout === item.key) + (typeof lucide === 'function' ? lucide(item.icon, 14) + ' ' : '') + item.label;
      row.addEventListener('click', async () => {
        localStorage.setItem('tree-layout', item.key);
        _applyTreeLayoutMode(item.key);
        menu.remove();
        await _refreshTreeAfterDisplaySettingsChange('tree-layout');
      });
      menu.appendChild(row);
    });

    _fdSep(menu);
    _fdSection(menu, 'ツリーサムネイル');
    [
      { key: 'none', label: 'なし' },
      { key: 'sm', label: '小' },
      { key: 'md', label: '中' },
      { key: 'lg', label: '大' },
    ].forEach(it => {
      const row = document.createElement('div');
      row.className = 'gb-context-menu-item';
      row.innerHTML = radioMark(treeThumbSize === it.key) + it.label;
      row.addEventListener('click', () => {
        _setTreeThumbnailDisplaySize(it.key);
        _refreshTreeAfterDisplaySettingsChange('tree-thumbnail-size').catch(() => {});
        menu.remove();
      });
      menu.appendChild(row);
    });

    _fdSep(menu);
    _fdSection(menu, '詳細設定');
    const subfolderChecked = typeof isFolderSubfolderContentsEnabled === 'function' && isFolderSubfolderContentsEnabled();
    const subfolderRow = _fdCheckboxRow('サブフォルダの内容を表示', subfolderChecked, async (enabled) => {
      if (typeof setFolderSubfolderContentsEnabled === 'function') setFolderSubfolderContentsEnabled(enabled);
      if (typeof syncFolderSubfolderContentsButtons === 'function') syncFolderSubfolderContentsButtons();
      await _refreshTreeAfterDisplaySettingsChange('tree-subfolder-toggle');
    }, { dataset: { e2eId: 'tree-display-subfolder-contents-toggle' } });
    menu.appendChild(subfolderRow);

    document.body.appendChild(menu);
    if (btn?.getBoundingClientRect && typeof positionPopup === 'function') {
      positionPopup(menu, btn.getBoundingClientRect(), { prefer: 'below', gap: 4 });
    } else {
      const z = _getZoom();
      menu.style.left = (rect.left / z) + 'px';
      menu.style.top = (rect.bottom / z + 4) + 'px';
      if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
    }
    setTimeout(() => document.addEventListener('pointerdown', function closer(pointerEvent) {
      if (menu.contains(pointerEvent.target) || btn?.contains(pointerEvent.target)) return;
      document.removeEventListener('pointerdown', closer, true);
      menu.remove();
    }, true), 0);
    return;
  }

  const layoutItems = [
    { key: 'list', label: 'リスト', icon: 'list' },
    { key: 'grid', label: 'グリッド', icon: 'grid3x3' },
    { key: 'waterfall', label: 'ウォーターフォール', icon: 'layoutGrid' },
    { key: 'hflow', label: '横並び', icon: 'galleryHorizontal' },
  ];
  _fdSection(menu, '表示形式');
  layoutItems.forEach(item => {
    const row = document.createElement('div');
    row.className = 'gb-context-menu-item';
    row.innerHTML = radioMark(_folderLayout === item.key) + (typeof lucide === 'function' ? lucide(item.icon, 14) + ' ' : '') + item.label;
    row.addEventListener('click', () => {
      if (typeof setFolderLayout === 'function') setFolderLayout(item.key);
      else {
        _folderLayout = item.key;
        localStorage.setItem('folder-layout', item.key);
        renderFolderGrid();
      }
      menu.remove();
    });
    menu.appendChild(row);
  });

  _fdSep(menu);

  const thumbSize = cfg.thumbnailSize || (cfg.showThumb === false ? 'none' : 'md');
  _fdSection(menu, 'サムネイルサイズ');
  [
    { key: 'none', label: 'なし' },
    { key: 'sm', label: '小' },
    { key: 'md', label: '中' },
    { key: 'lg', label: '大' },
  ].forEach(it => {
    const row = document.createElement('div');
    row.className = 'gb-context-menu-item';
    row.innerHTML = radioMark(thumbSize === it.key) + it.label;
    row.addEventListener('click', () => {
      cfg.thumbnailSize = it.key;
      cfg.showThumb = it.key !== 'none';
      saveFolderDisplayConfig(cfg);
      renderFolderGrid();
      menu.remove();
    });
    menu.appendChild(row);
  });

  _fdSep(menu);

  const visibilityItems = [
    {key: 'showName', label: 'ファイル名'},
    {key: 'showSize', label: 'ファイルサイズ'},
    {key: 'showDate', label: '更新日時'},
    {key: 'showType', label: 'タイプ'},
    {key: 'showDimensions', label: '画像サイズ'},
    {key: 'showRating', label: '評価'},
    {key: 'showTags', label: 'タグ'},
  ];

  _fdSection(menu, '表示項目');
  visibilityItems.forEach(it => {
    const checked = cfg[it.key] !== false;
    const el = _fdCheckboxRow(it.label, checked, (next) => {
      cfg[it.key] = next;
      saveFolderDisplayConfig(cfg);
      renderFolderGrid();
    }, { dataset: { folderDisplayItem: it.key } });
    menu.appendChild(el);
  });

  const tagLimitRow = document.createElement('label');
  tagLimitRow.className = 'fd-tag-display-limit';
  tagLimitRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 14px;font-size:12px;color:var(--fg);';
  const tagLimitLabel = document.createElement('span');
  tagLimitLabel.textContent = 'タグ表示数';
  const tagLimitInput = document.createElement('input');
  tagLimitInput.type = 'number';
  tagLimitInput.min = '1';
  tagLimitInput.max = '999';
  tagLimitInput.step = '1';
  tagLimitInput.dataset.e2eId = 'folder-tag-display-limit';
  tagLimitInput.setAttribute('aria-label', 'ファイルカードのタグ表示数');
  const fallbackTagLimit = window.MeldexTagDisplayPreferences?.legacyLimit?.() || 10;
  tagLimitInput.value = String(window.MeldexTagDisplayPreferences?.normalizeLimit?.(
    cfg.tagDisplayLimit,
    fallbackTagLimit,
  ) || fallbackTagLimit);
  tagLimitInput.style.cssText = 'width:64px;padding:3px 5px;background:var(--bg);color:var(--fg);border:1px solid var(--ui-border,var(--border));border-radius:4px;';
  const saveTagLimit = () => {
    const next = window.MeldexTagDisplayPreferences?.normalizeLimit?.(
      tagLimitInput.value,
      fallbackTagLimit,
    ) || fallbackTagLimit;
    tagLimitInput.value = String(next);
    cfg.tagDisplayLimit = next;
    saveFolderDisplayConfig(cfg);
    window.dispatchEvent?.(new CustomEvent('meldex:folder-tag-display-limit-changed', {
      detail: { value: next },
    }));
  };
  tagLimitInput.addEventListener('change', saveTagLimit);
  tagLimitInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveTagLimit();
    }
  });
  tagLimitRow.append(tagLimitLabel, tagLimitInput);
  menu.appendChild(tagLimitRow);

  _fdSep(menu);
  _fdSection(menu, '詳細設定');
  const subfolderChecked = typeof isFolderSubfolderContentsEnabled === 'function' && isFolderSubfolderContentsEnabled();
  const subfolderRow = _fdCheckboxRow('サブフォルダの内容を表示', subfolderChecked, async (enabled) => {
    if (typeof setFolderSubfolderContentsEnabled === 'function') setFolderSubfolderContentsEnabled(enabled);
    if (typeof syncFolderSubfolderContentsButtons === 'function') syncFolderSubfolderContentsButtons();
    const folderPath = (typeof _folderToolbarCurrentPath === 'function') ? _folderToolbarCurrentPath() : (typeof _folderPath !== 'undefined' ? _folderPath : '');
    if (folderPath && typeof openFolder === 'function') {
      const label = document.getElementById('folder-title')?.textContent || folderPath;
      await openFolder(label, folderPath, {
        silent: true,
        skipShowView: true,
        skipNavPush: true,
        skipSaveLastView: true,
        skipHighlight: true,
        skipGlobalUi: true,
      });
    }
  }, { dataset: { e2eId: 'folder-display-subfolder-contents-toggle' } });
  menu.appendChild(subfolderRow);

  const filterStartIndex = menu.childNodes.length;
  _fdSep(menu);

  const resetBtn = _fdButton('解除', () => {
    if (typeof _clearFolderFilters === 'function') _clearFolderFilters();
    renderFolderGrid();
    menu.remove();
    showFolderFilterSettings();
  });
  resetBtn.dataset.folderFilterReset = 'true';
  _fdSection(menu, 'フィルタ', resetBtn);

  const searchRow = document.createElement('div');
  searchRow.style.cssText = 'padding:5px 12px;display:flex;flex-direction:column;gap:4px;';
  const searchLabel = document.createElement('label');
  searchLabel.textContent = 'ファイル名・パス';
  searchLabel.style.cssText = 'font-size:11px;color:var(--fg2);';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.value = cfg.filterText || '';
  searchInput.placeholder = '名前やパスで絞り込み';
  searchInput.dataset.folderFilter = 'text';
  searchInput.style.cssText = 'width:100%;box-sizing:border-box;padding:4px 6px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;font-size:12px;';
  searchInput.addEventListener('input', () => {
    cfg.filterText = searchInput.value;
    saveFolderDisplayConfig(cfg);
    renderFolderGrid();
    _scheduleFolderUnifiedSearch(searchInput.value);
  });
  searchRow.appendChild(searchLabel);
  const searchControls = document.createElement('div');
  searchControls.style.cssText = 'display:flex;align-items:center;gap:4px;';
  searchInput.style.flex = '1 1 auto';
  searchControls.appendChild(searchInput);
  window.MeldexUnifiedSearch?.button?.(searchControls, { e2eId: 'folder-panel-search-scope-trigger' });
  window.MeldexUnifiedSearch?.tagButton?.(searchControls, {
    e2eId: 'folder-panel-search-tag-trigger',
    sourceFolder: () => ((typeof _folderPath !== 'undefined' && window.MeldexAutoTagSourceFolder?.(_folderPath)) || ''),
    onChange: () => _scheduleFolderUnifiedSearch(searchInput.value),
  });
  searchRow.appendChild(searchControls);
  // 検索対象「画像の内容」が使えない理由・日本語クエリの注意を出す小さな
  // テキスト行（1-A追記）。_refreshFolderUnifiedSearch() がIDで参照する。
  const searchHint = document.createElement('div');
  searchHint.id = 'folder-panel-search-hint';
  searchHint.dataset.e2eId = 'folder-panel-search-hint';
  searchHint.style.cssText = 'display:none;font-size:11px;line-height:1.4;color:var(--fg2);';
  window.MeldexUnifiedSearch?.updateHint?.(searchHint, null, searchInput.value);
  searchRow.appendChild(searchHint);
  menu.appendChild(searchRow);

  const membershipsPromise = typeof _folderEnsureMemberships === 'function' ? _folderEnsureMemberships(_folderItems) : Promise.resolve(false);
  const tagsPromise = typeof _folderEnsureTags === 'function' ? _folderEnsureTags(_folderItems) : Promise.resolve(false);
  const choices = typeof _folderFilterChoices === 'function' ? _folderFilterChoices() : { types: [], exts: [], folders: [], tags: [] };
  const selectedTypes = new Set(typeof _folderFilterArray === 'function' ? _folderFilterArray(cfg.filterTypes) : []);
  const selectedExts = new Set((typeof _folderFilterArray === 'function' ? _folderFilterArray(cfg.filterExts) : []).map(ext => String(ext).toLowerCase()));
  const selectedFolders = new Set(typeof _folderFilterFolderKeys === 'function'
    ? _folderFilterFolderKeys(cfg)
    : ((typeof _folderFilterArray === 'function' ? _folderFilterArray(cfg.filterFolders) : []).map(folder => String(folder).replace(/\\/g, '/').replace(/\/+$/, ''))));
  const selectedTags = new Set(typeof _folderFilterTagKeys === 'function'
    ? _folderFilterTagKeys(cfg)
    : (typeof _folderFilterArray === 'function' ? _folderFilterArray(cfg.filterTags).map(tag => String(tag).toLowerCase()) : []));

  _fdSection(menu, '種類');
  const typeBox = document.createElement('div');
  typeBox.style.maxHeight = '150px';
  typeBox.style.overflowY = 'auto';
  if (choices.types.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:5px 14px;color:var(--fg2);font-size:12px;';
    empty.textContent = '項目がありません';
    typeBox.appendChild(empty);
  } else {
    choices.types.forEach(([type, label]) => {
      typeBox.appendChild(_fdCheckboxRow(label, selectedTypes.has(type), (enabled) => {
        _fdSetArrayFilter(cfg, 'filterTypes', type, enabled);
      }, { dataset: { folderFilterType: type } }));
    });
  }
  menu.appendChild(typeBox);

  _fdSection(menu, '拡張子');
  const extBox = document.createElement('div');
  extBox.style.maxHeight = '130px';
  extBox.style.overflowY = 'auto';
  if (choices.exts.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:5px 14px;color:var(--fg2);font-size:12px;';
    empty.textContent = '拡張子のある項目がありません';
    extBox.appendChild(empty);
  } else {
    choices.exts.forEach(([ext, label]) => {
      extBox.appendChild(_fdCheckboxRow(label, selectedExts.has(ext), (enabled) => {
        _fdSetArrayFilter(cfg, 'filterExts', ext, enabled);
      }, { dataset: { folderFilterExt: ext } }));
    });
  }
  menu.appendChild(extBox);

  _fdSection(menu, '所属フォルダ');
  const folderBox = document.createElement('div');
  folderBox.style.maxHeight = '150px';
  folderBox.style.overflowY = 'auto';
  if (!choices.folders || choices.folders.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:5px 14px;color:var(--fg2);font-size:12px;';
    empty.textContent = (typeof _folderMembershipsAreLoading === 'function' && _folderMembershipsAreLoading(_folderItems))
      ? '所属フォルダを読み込み中...'
      : '複数の所属フォルダはありません';
    folderBox.appendChild(empty);
  } else {
    choices.folders.forEach(([folder, label]) => {
      folderBox.appendChild(_fdCheckboxRow(label, selectedFolders.has(folder), (enabled) => {
        _fdSetArrayFilter(cfg, 'filterFolders', folder, enabled);
      }, { dataset: { folderFilterFolder: folder } }));
    });
  }
  menu.appendChild(folderBox);

  const tagModeLabel = { all: 'すべて含む', any: 'どれかを含む' };
  const tagSectionAction = document.createElement('div');
  tagSectionAction.style.cssText = 'display:flex;align-items:center;gap:4px;';
  const tagModeSelect = document.createElement('select');
  tagModeSelect.dataset.e2eId = 'folder-filter-tag-mode';
  tagModeSelect.setAttribute('aria-label', 'タグの判定方法');
  tagModeSelect.style.cssText = 'font-size:11px;padding:2px 4px;background:var(--bg3);color:var(--fg2);border:1px solid var(--border);border-radius:4px;';
  [['all', 'すべて含む'], ['any', 'どれかを含む']].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    tagModeSelect.appendChild(option);
  });
  tagModeSelect.value = (typeof _folderTagFilterMode === 'function') ? _folderTagFilterMode(cfg) : 'all';
  tagModeSelect.addEventListener('change', () => {
    const latestCfg = _saveFolderDisplayConfigPatch({ filterTagMode: tagModeSelect.value });
    renderFolderGrid();
    refreshTagSectionUi(latestCfg);
  });
  tagSectionAction.appendChild(tagModeSelect);
  const tagPickerBtn = window.GBTagPickerPanel?.createTriggerButton?.({
    title: 'タグツリーから選ぶ',
    icon: 'listTree',
    className: 'gb-btn gb-btn-xs gb-btn-quiet gb-btn-icon',
    e2eId: 'folder-filter-tag-picker-trigger',
    onOpen: (btn) => {
      const existingIds = new Set((choices.tags || []).map(([tag]) => String(tag).toLowerCase()));
      const latestCfg = getFolderDisplayConfig();
      window.GBTagPickerPanel.open({
        ownerKey: 'folder-filter',
        headerLabel: 'フォルダの絞り込みに使うタグ',
        sourceFolder: (typeof _folderPath !== 'undefined' && window.MeldexAutoTagSourceFolder?.(_folderPath)) || '',
        existingTagIds: existingIds,
        tagIds: _folderFilterArray(latestCfg.filterTags),
        matchMode: (typeof _folderTagFilterMode === 'function') ? _folderTagFilterMode(latestCfg) : 'all',
        onChange: (tagIds, mode) => {
          const nextCfg = _saveFolderDisplayConfigPatch({
            filterTags: tagIds.map(id => String(id).toLowerCase()),
            filterTagMode: mode,
          });
          if (typeof _folderEnsureTags === 'function') _folderEnsureTags(_folderItems, { rerender: true });
          renderFolderGrid();
          refreshTagSectionUi(nextCfg);
        },
      });
      window.GBTagPickerPanel.syncTriggerButton(btn, 'folder-filter');
    },
  });
  if (tagPickerBtn) tagSectionAction.appendChild(tagPickerBtn);
  _fdSection(menu, `タグ（${tagModeLabel[tagModeSelect.value] || 'すべて含む'}）`, tagSectionAction, { fdTagSectionTitle: '1' });

  const tagChips = document.createElement('div');
  tagChips.className = 'fd-tag-filter-chips';
  tagChips.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;padding:2px 12px 4px;';
  menu.appendChild(tagChips);

  const tagBox = document.createElement('div');
  tagBox.style.maxHeight = '150px';
  tagBox.style.overflowY = 'auto';
  if (!choices.tags || choices.tags.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:5px 14px;color:var(--fg2);font-size:12px;';
    empty.textContent = (typeof _folderTagsAreLoading === 'function' && _folderTagsAreLoading(_folderItems))
      ? 'タグを読み込み中...'
      : 'このフォルダ内にタグ付き項目はありません';
    tagBox.appendChild(empty);
  } else {
    choices.tags.forEach(([tag, label]) => {
      tagBox.appendChild(_fdCheckboxRow(label, selectedTags.has(String(tag).toLowerCase()), (enabled) => {
        _fdSetArrayFilter(cfg, 'filterTags', tag, enabled);
        refreshTagSectionUi(getFolderDisplayConfig());
      }, { dataset: { folderFilterTag: tag } }));
    });
  }
  menu.appendChild(tagBox);

  // ピッカーでの選択・チップの×・チェックボックスのどれで変えても、この3つの
  // 表示（見出しの判定方法／チップ／チェック状態）が食い違わないようにする。
  function refreshTagSectionUi(latestCfg) {
    const mode = (typeof _folderTagFilterMode === 'function') ? _folderTagFilterMode(latestCfg) : 'all';
    tagModeSelect.value = mode;
    const heading = menu.querySelector('[data-fd-tag-section-title]');
    if (heading) heading.textContent = `タグ（${tagModeLabel[mode] || 'すべて含む'}）`;
    const selectedNow = new Set(typeof _folderFilterTagKeys === 'function' ? _folderFilterTagKeys(latestCfg) : []);
    tagBox.querySelectorAll('[data-folder-filter-tag]').forEach(row => {
      const key = String(row.dataset.folderFilterTag || '').toLowerCase();
      const input = row.querySelector('input[type="checkbox"]');
      if (input) input.checked = selectedNow.has(key);
    });
    if (window.GBTagPickerPanel?.renderSelectedChips) {
      window.GBTagPickerPanel.renderSelectedChips(tagChips, {
        tagIds: Array.from(selectedNow),
        sourceFolder: (typeof _folderPath !== 'undefined' && window.MeldexAutoTagSourceFolder?.(_folderPath)) || '',
        onRemove: (id) => {
          _fdSetArrayFilter(getFolderDisplayConfig(), 'filterTags', id, false);
          refreshTagSectionUi(getFolderDisplayConfig());
        },
      });
    }
  }
  refreshTagSectionUi(cfg);

  _fdSection(menu, '更新期間');
  const periodRow = document.createElement('div');
  periodRow.style.cssText = 'padding:5px 12px;display:flex;flex-direction:column;gap:6px;';
  const select = document.createElement('select');
  select.dataset.folderFilter = 'modified-preset';
  select.style.cssText = 'width:100%;box-sizing:border-box;padding:4px 6px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;font-size:12px;';
  [
    ['all', 'すべて'],
    ['today', '今日更新'],
    ['7d', '7日以内'],
    ['30d', '30日以内'],
    ['90d', '90日以内'],
    ['custom', '期間指定'],
  ].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  });
  select.value = cfg.filterModifiedPreset || 'all';
  const customRow = document.createElement('div');
  customRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;';
  const from = document.createElement('input');
  from.type = 'date';
  from.value = cfg.filterModifiedFrom || '';
  from.dataset.folderFilter = 'modified-from';
  const to = document.createElement('input');
  to.type = 'date';
  to.value = cfg.filterModifiedTo || '';
  to.dataset.folderFilter = 'modified-to';
  [from, to].forEach(input => {
    input.style.cssText = 'min-width:0;padding:4px 6px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;font-size:12px;';
  });
  customRow.appendChild(from);
  customRow.appendChild(to);
  const syncCustomVisibility = () => { customRow.style.display = select.value === 'custom' ? 'grid' : 'none'; };
  select.addEventListener('change', () => {
    cfg.filterModifiedPreset = select.value;
    saveFolderDisplayConfig(cfg);
    syncCustomVisibility();
    renderFolderGrid();
  });
  from.addEventListener('change', () => {
    cfg.filterModifiedFrom = from.value;
    if ((cfg.filterModifiedPreset || 'all') !== 'custom') {
      cfg.filterModifiedPreset = 'custom';
      select.value = 'custom';
      syncCustomVisibility();
    }
    saveFolderDisplayConfig(cfg);
    renderFolderGrid();
  });
  to.addEventListener('change', () => {
    cfg.filterModifiedTo = to.value;
    if ((cfg.filterModifiedPreset || 'all') !== 'custom') {
      cfg.filterModifiedPreset = 'custom';
      select.value = 'custom';
      syncCustomVisibility();
    }
    saveFolderDisplayConfig(cfg);
    renderFolderGrid();
  });
  periodRow.appendChild(select);
  periodRow.appendChild(customRow);
  menu.appendChild(periodRow);
  syncCustomVisibility();
  if (filterOnly) {
    for (let i = 0; i < filterStartIndex; i += 1) menu.firstChild?.remove();
    if (menu.firstElementChild?.classList?.contains('gb-context-menu-sep')) {
      menu.firstElementChild.remove();
    }
  } else {
    while (menu.childNodes.length > filterStartIndex) menu.lastChild?.remove();
  }
  if (typeof attachMeldexDropdownCloseButton === 'function') {
    attachMeldexDropdownCloseButton(menu, {
      trigger: btn,
      close: () => menu.remove(),
    });
  }

  document.body.appendChild(menu);

  // 画面外補正
  clampPopupToViewport(menu);
  if (filterOnly) searchInput.focus({ preventScroll: true });
  if (filterOnly && membershipsPromise && typeof membershipsPromise.then === 'function') {
    membershipsPromise.then((changed) => {
      if (!changed) return;
      const latestCfg = getFolderDisplayConfig();
      if (typeof _folderHasActiveFolderFilter === 'function' && _folderHasActiveFolderFilter(latestCfg)) renderFolderGrid();
      if (document.body.contains(menu)) {
        menu.remove();
        showFolderFilterSettings();
      }
    }).catch(() => {});
  }
  if (filterOnly && tagsPromise && typeof tagsPromise.then === 'function') {
    tagsPromise.then((changed) => {
      if (!changed) return;
      const latestCfg = getFolderDisplayConfig();
      if (typeof _folderHasActiveTagFilter === 'function' && _folderHasActiveTagFilter(latestCfg)) renderFolderGrid();
      if (document.body.contains(menu)) {
        menu.remove();
        showFolderFilterSettings();
      }
    }).catch(() => {});
  }

  setTimeout(() => {
    const closer = (ev) => {
      if (!menu.contains(ev.target) && ev.target !== btn) { menu.remove(); document.removeEventListener('pointerdown', closer); }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

function showFolderFilterSettings() {
  return showFolderDisplaySettings({ filterOnly: true });
}

function showTreeDisplaySettings(event) {
  const eventTarget = event?.target?.closest?.('#btn-tree-display');
  const currentTarget = event?.currentTarget?.id === 'btn-tree-display' ? event.currentTarget : null;
  return showFolderDisplaySettings({
    surface: 'tree',
    triggerEl: eventTarget || currentTarget || document.getElementById('btn-tree-display'),
  });
}

function openFolderSlideshow() {
  if (!_folderPath) return;
  openViewer('/viewer?folder=' + encodeURIComponent(_folderPath));
}

async function openNative(path) {
  try {
    await apiPost('/open-native', { path });
    showStatus('ネイティブアプリで開きました');
  } catch (e) {
    showStatus('開けませんでした: ' + e.message, true);
  }
}

function _folderArchiveExtension(path) {
  const lower = String(path || '').split(/[?#]/)[0].toLowerCase();
  if (lower.endsWith('.tar.gz')) return '.tar.gz';
  if (lower.endsWith('.tar.bz2')) return '.tar.bz2';
  if (lower.endsWith('.tar.xz')) return '.tar.xz';
  const index = lower.lastIndexOf('.');
  return index >= 0 ? lower.slice(index) : '';
}

// クラウド版（端末内保存／Dropbox直結）はgb-archive-zip-engine.jsの自己完結ZIP
// エンジンで圧縮・解凍する。TAR系はデスクトップ版のみの対応のまま
// （クラウド版では解凍対象からZIP以外を除外する）。
function _folderArchiveCloudEngineReady() {
  return !!window.MeldexArchiveZipEngine;
}

function _folderCanCompress() {
  if (window.MeldexRuntimeAdapter?.isBrowserDataMode?.()) return _folderArchiveCloudEngineReady();
  return true;
}

function _folderCanExtractArchive(item) {
  const ext = _folderArchiveExtension(item?.path || item?.name || '');
  if (window.MeldexRuntimeAdapter?.isBrowserDataMode?.()) {
    return _folderArchiveCloudEngineReady() && ext === '.zip';
  }
  return ['.zip', '.tar', '.tar.gz', '.tgz', '.tar.bz2', '.tbz2', '.tar.xz', '.txz'].includes(ext);
}

async function compressFolderItems(items) {
  const targets = (Array.isArray(items) ? items : [items]).filter(item => item?.path);
  if (!targets.length) return;
  if (!_folderCanCompress()) {
    showStatus('圧縮機能を利用できません（お使いのブラウザが対応していない可能性があります）', true);
    return;
  }
  try {
    showStatus('圧縮しています...');
    const result = await apiPost('/archive/compress', { paths: targets.map(item => item.path) }, { silentError: true });
    if (_folderPath) await openFolder(_folderPath.split('/').pop(), _folderPath, { skipNavPush: true, skipSaveLastView: true, skipHighlight: true });
    showStatus('圧縮しました: ' + (result?.name || result?.path || 'ZIP'));
  } catch (err) {
    showStatus('圧縮に失敗しました: ' + (err?.userMessage || err?.message || err), true);
  }
}

async function extractArchiveItem(item) {
  if (!item?.path) return;
  if (!_folderCanExtractArchive(item)) {
    openNative(item.path);
    return;
  }
  return extractArchiveItems([item]);
}

async function extractArchiveItems(items) {
  const targets = (Array.isArray(items) ? items : [items])
    .filter(item => item?.path && _folderCanExtractArchive(item));
  if (!targets.length) return;
  const failures = [];
  const results = [];
  try {
    showStatus(targets.length > 1 ? `${targets.length}件を解凍しています...` : '解凍しています...');
    // 各圧縮ファイルを独立して最後まで展開する。1件の失敗で残りを止めない。
    for (const target of targets) {
      try {
        results.push(await apiPost('/archive/extract', { path: target.path }, { silentError: true }));
      } catch (error) {
        failures.push({ target, error });
      }
    }
    if (_folderPath) await openFolder(_folderPath.split('/').pop(), _folderPath, { skipNavPush: true, skipSaveLastView: true, skipHighlight: true });
    if (failures.length) {
      const first = failures[0];
      if (targets.length === 1) {
        const error = first.error;
        showStatus('解凍に失敗しました: ' + (error?.userMessage || error?.message || error), true);
      } else {
        showStatus(`${results.length}件を解凍、${failures.length}件に失敗しました: ${first.target.name || first.target.path}`, true);
      }
      return { ok: false, results, failures };
    }
    if (targets.length > 1) showStatus(`${targets.length}件をすべて解凍しました`);
    else showStatus('解凍しました: ' + (results[0]?.name || results[0]?.path || 'フォルダ'));
    return { ok: true, results, failures: [] };
  } catch (err) {
    showStatus('解凍に失敗しました: ' + (err?.userMessage || err?.message || err), true);
    return { ok: false, results, failures: failures.concat([{ target: null, error: err }]) };
  }
}

async function autoTagFolderTarget(item, options = {}) {
  const path = item?.path || (typeof _folderPath !== 'undefined' ? _folderPath : '');
  if (!path || !window.MeldexGlobalTags?.autoTag) return;
  const recursive = options.recursive ?? (item?.type === 'folder');
  try {
    showStatus('自動タグ付けを準備しています...');
    const sourceFolder = window.MeldexAutoTagSourceFolder?.(path) || '';
    const result = await window.MeldexGlobalTags.autoTag({
      path,
      recursive,
      ...(sourceFolder ? { source_folder: sourceFolder } : {}),
    });
    if (result?.background) {
      showStatus('自動タグ付けをバックグラウンドで開始しました');
      return;
    }
    if (result?.stopped) {
      showStatus('自動タグ付けを中断しました: ' + (result.warning || result.reason || ''), true);
      return;
    }
    if (typeof _folderRefreshTags === 'function') {
      await _folderRefreshTags(_folderItems, { rerender: true, all: true });
    }
    if (window.MeldexTagManagement?.refresh) window.MeldexTagManagement.refresh(false);
    showStatus((result?.total || 0) + '件に自動タグ付けしました');
  } catch (err) {
    showStatus('自動タグ付けに失敗しました: ' + (err?.userMessage || err?.message || err), true);
  }
}

function fvBulkCompress() {
  compressFolderItems(_folderSelectedItems);
}

function fvBulkAutoTag() {
  const items = (_folderSelectedItems || []).filter(item => item?.path);
  if (!items.length) return;
  if (!window.MeldexGlobalTags?.autoTag) {
    showStatus('自動タグ付けを初期化できませんでした', true);
    return;
  }
  const sourceFolder = window.MeldexAutoTagSourceFolder?.(items[0]?.path) || '';
  window.MeldexGlobalTags.autoTag({
    targets: items.map(item => ({ path: item.path, recursive: item.type === 'folder' })),
    label: `${items.length}件の選択項目`,
    ...(sourceFolder ? { source_folder: sourceFolder } : {}),
  }).then(result => {
    if (result?.background) {
      showStatus('選択項目の自動タグ付けをバックグラウンドで開始しました');
      return;
    }
    if (typeof _folderRefreshTags === 'function') {
      void _folderRefreshTags(_folderItems, { rerender: true, all: true }).catch(error => {
        console.warn('[Meldex] 自動タグ付け後のフォルダタグ更新に失敗しました', error);
      });
    }
    showStatus((result?.total || 0) + '件に自動タグ付けしました');
  }).catch(err => {
    showStatus('自動タグ付けに失敗しました: ' + (err?.userMessage || err?.message || err), true);
  });
}

// formatFileSize は meldex-core.js で定義済み

// === ビューワーペインへのD&D ===
(function() {
  function _initPreviewDrop() {
    const pane = document.getElementById('gb-preview-pane');
    if (!pane) return;
    pane.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; pane.style.outline = '2px solid var(--accent)'; });
    pane.addEventListener('dragleave', () => { pane.style.outline = ''; });
    pane.addEventListener('drop', (e) => {
      e.preventDefault();
      pane.style.outline = '';
      // ツリーノードからのドロップ
      const nodeData = e.dataTransfer.getData('application/x-meldex-node');
      if (nodeData) {
        try {
          const data = JSON.parse(nodeData);
          if (data.path) {
            const name = data.path.split(/[/\\]/).pop();
            const ext = name.split('.').pop().toLowerCase();
            const imgExts = ['jpg','jpeg','png','gif','bmp','webp','svg','ico'];
            const vidExts = ['mp4','webm','mov','avi','mkv'];
            const type = imgExts.includes(ext) ? 'image' : vidExts.includes(ext) ? 'video' : ext === 'pdf' ? 'pdf' : 'file';
            showFolderPreview({ name, path: data.path, type });
          }
        } catch {}
        return;
      }
      // OSファイルのドロップ（パス解決不可のためスキップ）
      // テキスト/URLのドロップ
      const text = e.dataTransfer.getData('text/plain');
      if (text && text.startsWith('/')) {
        const name = text.split(/[/\\]/).pop();
        showFolderPreview({ name, path: text, type: 'image' });
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _initPreviewDrop);
  else setTimeout(_initPreviewDrop, 1000);
})();
