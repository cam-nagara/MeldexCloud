// timeline-view(カレンダー)へのD&Dドロップ（ファイルから新規イベント作成）
function _appLocalDateTimeInputValue(date) {
  if (typeof formatLocalDateTime === 'function') return formatLocalDateTime(date);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function _appShouldHandleStandaloneCalendarDrop() {
  return state.view === 'timeline'
    && !state.currentDbPath
    && typeof _showCalEventInDetailPanel === 'function';
}

{
  const tv = document.getElementById('timeline-view');
  if (tv) tv.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('application/x-meldex-node') && _appShouldHandleStandaloneCalendarDrop()) e.preventDefault();
  });
  if (tv) tv.addEventListener('drop', (e) => {
    if (!_appShouldHandleStandaloneCalendarDrop()) return;
    const cfData = e.dataTransfer.getData('application/x-meldex-node');
    if (!cfData) return;
    e.preventDefault();
    try {
      const { name, path } = JSON.parse(cfData);
      // 詳細パネルにイベント編集を表示（タイトルにファイル名、リンク付き）
      const now = new Date();
      const startVal = _appLocalDateTimeInputValue(now);
      const endH = new Date(now.getTime() + 3600000);
      const endVal = _appLocalDateTimeInputValue(endH);
      if (typeof _showCalEventInDetailPanel === 'function') {
        _showCalEventInDetailPanel(
          { title: name, description: '[[' + name + ']](' + path + ')' },
          [], startVal, endVal, false
        );
      }
    } catch {}
  });
}

// main-viewsへのD&Dドロップ
// 通常ドロップ: 各ビュー固有のハンドラに委ねる（ノート→リンク挿入、キャンバス→ノード追加）
// Ctrl+ドロップ: ファイルをそのパネルで開く
{
  const mv = document.getElementById('main-views');
  // 注意: #sidebar は GBLayout のドッキング対象として #gb-layout-root（#main-views の
  // 子孫）へ組み込まれるため、フォルダツリー（お気に入り・最近使った項目・ワークスペースを
  // 含む #sidebar 全体）は実行時には #main-views の子孫になる。Ctrl+ドロップでパネルに
  // 開くこの機能は「ドロップ先がツリー以外のパネル領域」の場合だけに限定し、ツリー内へ
  // Ctrl+ドロップしても項目が開かないようにする（フォルダツリー改修 Phase 2 §2.5・§9）。
  const _isMainViewsSidebarDrop = (e) => !!e.target?.closest?.('#sidebar');
  if (mv) mv.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('application/x-meldex-node')) {
      // Ctrl+ドラッグ時のみmain-viewsレベルで受け付け（ファイルを開く）
      // 通常時は各ビュー固有のdragoverに委ねる
      if (e.ctrlKey && state.view !== 'board' && !_isMainViewsSidebarDrop(e)) e.preventDefault();
    }
  });
  if (mv) mv.addEventListener('drop', (e) => {
    // Ctrl+ドロップ: ファイルをパネルで開く
    if (!e.ctrlKey) return; // 通常ドロップは各ビュー固有ハンドラに委ねる
    if (state.view === 'board') return;
    if (_isMainViewsSidebarDrop(e)) return; // フォルダツリー（サイドバー）内へのCtrl+ドロップでは開かない
    const cfData = e.dataTransfer.getData('application/x-meldex-node');
    if (!cfData) return;
    e.preventDefault();
    try {
      const { name, path, type } = JSON.parse(cfData);
      const navType = typeof _normalizeOpenTypeForNav === 'function'
        ? _normalizeOpenTypeForNav(type)
        : (type === 'database' ? 'pivot' : type === 'board' ? 'board' : (type || 'page'));
      navOpen({ type: navType, label: name, path });
    } catch {}
  });
}

// Phase D: HTMLビューワー(viewer.html)のiframe通信のみ残存
// canvas/calendarのpostMessageはPhase Cで直接関数呼び出しに変換済み
function _getTrustedEmbeddedMessageIframe(e) {
  if (!e) return null;
  const candidates = [];
  const addCandidate = iframe => {
    if (iframe && !candidates.includes(iframe)) candidates.push(iframe);
  };
  addCandidate((typeof _getActiveIframe === 'function') ? _getActiveIframe() : null);
  addCandidate(document.getElementById('html-iframe'));
  document.querySelectorAll('iframe').forEach(addCandidate);
  for (const iframe of candidates) {
    if (!iframe?.contentWindow || e.source !== iframe.contentWindow) continue;
    const iframeSrc = iframe.getAttribute('src') || iframe.src || '';
    if (!_gbIsTrustedInternalViewerUrl(iframeSrc)) continue;
    if (e.origin === window.location.origin || e.origin === 'null') return iframe;
  }
  return null;
}

function _isTrustedEmbeddedMessage(e) {
  return !!_getTrustedEmbeddedMessageIframe(e);
}

function _syncViewerCurrentFileFromMessage(msg) {
  const path = typeof msg?.path === 'string' ? msg.path : '';
  if (!path) return false;
  state.currentPagePath = path;
  if (typeof highlightOutlinerNode === 'function') highlightOutlinerNode(path);
  if (typeof _showFileInfoInDetailPanel === 'function') _showFileInfoInDetailPanel(path);
  return true;
}

const _VIEWER_FOLDER_NAV_FILE_EXTS = new Set([
  '.png', '.apng', '.jpg', '.jpeg', '.jpe', '.jfif', '.gif', '.bmp', '.webp',
  '.svg', '.ico', '.avif', '.tif', '.tiff', '.heic', '.heif', '.psd', '.psb',
  '.pdf',
]);
const _viewerFolderNavDisplayableCache = new Map();

function _viewerFolderNavCleanPath(path) {
  return String(path || '').replace(/\\/g, '/').split('#')[0].split('?')[0].replace(/\/+$/, '');
}

function _viewerFolderNavExt(path) {
  const name = _viewerFolderNavCleanPath(path).split('/').pop() || '';
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index).toLowerCase() : '';
}

function _viewerFolderNavIsDisplayableFile(path) {
  return _VIEWER_FOLDER_NAV_FILE_EXTS.has(_viewerFolderNavExt(path));
}

function _viewerFolderNavParentPath(path) {
  const clean = _viewerFolderNavCleanPath(path);
  if (!clean) return '';
  if (!_viewerFolderNavIsDisplayableFile(clean)) return clean;
  const index = clean.lastIndexOf('/');
  return index >= 0 ? clean.slice(0, index) : '';
}

function _viewerFolderNavCurrentFolderFromMessage(msg) {
  const folderPath = _viewerFolderNavCleanPath(msg?.folderPath || '');
  if (folderPath) return folderPath;
  return _viewerFolderNavParentPath(msg?.currentPath || msg?.path || state.currentPagePath || '');
}

function _viewerFolderNavNodePath(node) {
  return _viewerFolderNavCleanPath(node?._nodeData?.path || node?.dataset?.path || '');
}

function _viewerFolderNavPathMatches(nodePath, targetPath) {
  if (typeof _outlinerHighlightPathMatches === 'function') return _outlinerHighlightPathMatches(nodePath, targetPath);
  const a = _viewerFolderNavCleanPath(nodePath).toLowerCase();
  const b = _viewerFolderNavCleanPath(targetPath).toLowerCase();
  return !!a && !!b && (a === b || a.endsWith('/' + b) || b.endsWith('/' + a));
}

function _viewerFolderNavIsFolderNode(node) {
  const data = node?._nodeData || {};
  if (!node || node.style?.display === 'none') return false;
  return data.type === 'folder' || data._isRoot === true;
}

function _viewerFolderNavFolderNodes() {
  const candidates = [...document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node')];
  return candidates.filter(node => _viewerFolderNavIsFolderNode(node) && _viewerFolderNavNodePath(node));
}

function _viewerFolderNavFindIndex(nodes, targetPath) {
  if (!targetPath) return -1;
  return nodes.findIndex(node => _viewerFolderNavPathMatches(_viewerFolderNavNodePath(node), targetPath));
}

function _viewerFolderNavDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function _viewerFolderNavEnsureNodeExpanded(node) {
  const toggle = node?.querySelector?.(':scope > .tree-node-row .tree-toggle');
  if (!toggle || toggle.dataset.expanded === undefined || toggle.dataset.expanded === 'true') return false;
  const childrenDiv = node.querySelector(':scope > .tree-children');
  toggle.click();
  for (let i = 0; i < 30; i++) {
    await _viewerFolderNavDelay(100);
    if (!childrenDiv) break;
    if (!childrenDiv.classList.contains('collapsed') && childrenDiv.dataset.loaded === 'true') break;
  }
  return true;
}

async function _viewerFolderNavEnsureAncestorsExpanded(node) {
  const ancestors = [];
  let parent = node?.parentElement?.closest?.('.tree-node') || null;
  while (parent) {
    ancestors.unshift(parent);
    parent = parent.parentElement?.closest?.('.tree-node') || null;
  }
  for (const ancestor of ancestors) {
    await _viewerFolderNavEnsureNodeExpanded(ancestor);
  }
}

async function _viewerFolderNavRevealCurrentFolder(folderPath) {
  if (!folderPath) return;
  if (typeof _autoExpandToPath === 'function') {
    try { await _autoExpandToPath(folderPath, true); } catch {}
  }
  if (typeof highlightOutlinerNode === 'function') {
    try { highlightOutlinerNode(folderPath, { noScroll: true }); } catch {}
  }
  await _viewerFolderNavDelay(50);
}

function _viewerFolderNavDisplayableFromBrowseItems(items) {
  const files = Array.isArray(items) ? items.filter(item => item && item.type !== 'folder') : [];
  const images = files.filter(item => item.type === 'image' || _viewerFolderNavIsDisplayableFile(item.path || item.name || ''))
    .filter(item => _viewerFolderNavExt(item.path || item.name || '') !== '.pdf');
  const pdfs = files.filter(item => _viewerFolderNavExt(item.path || item.name || '') === '.pdf');
  return {
    has: images.length > 0 || pdfs.length > 0,
    hasImage: images.length > 0,
    firstImage: images[0] || null,
    firstPdf: pdfs[0] || null,
  };
}

async function _viewerFolderNavDisplayableInFolder(folderPath) {
  const key = _viewerFolderNavCleanPath(folderPath);
  if (!key) return { has: false, hasImage: false, firstImage: null, firstPdf: null };
  if (_viewerFolderNavDisplayableCache.has(key)) return _viewerFolderNavDisplayableCache.get(key);
  const result = await apiFetch('/browse?path=' + encodeURIComponent(key) + '&all_files=true')
    .then(items => _viewerFolderNavDisplayableFromBrowseItems(items))
    .catch(() => ({ has: false, hasImage: false, firstImage: null, firstPdf: null }));
  _viewerFolderNavDisplayableCache.set(key, result);
  return result;
}

function _viewerFolderNavOpenTarget(folderPath, result) {
  const targetPath = result?.hasImage ? folderPath : (result?.firstPdf?.path || folderPath);
  if (typeof highlightOutlinerNode === 'function') highlightOutlinerNode(targetPath);
  if (result?.hasImage) {
    openViewer('/viewer?folder=' + encodeURIComponent(folderPath));
  } else if (result?.firstPdf?.path) {
    openViewer('/viewer?pdf=' + encodeURIComponent(result.firstPdf.path));
  }
}

async function _navigateViewerFolderByTreeOrder(direction, currentFolderPath) {
  await _viewerFolderNavRevealCurrentFolder(currentFolderPath);
  let cursorPath = currentFolderPath;
  for (let guard = 0; guard < 400; guard++) {
    const nodes = _viewerFolderNavFolderNodes();
    if (!nodes.length) break;
    let cursorIndex = _viewerFolderNavFindIndex(nodes, cursorPath);
    if (cursorIndex < 0) cursorIndex = direction > 0 ? -1 : nodes.length;
    const candidate = nodes[cursorIndex + direction];
    if (!candidate) break;
    await _viewerFolderNavEnsureAncestorsExpanded(candidate);
    const candidatePath = _viewerFolderNavNodePath(candidate);
    if (!candidatePath) {
      cursorPath = '';
      continue;
    }
    const result = await _viewerFolderNavDisplayableInFolder(candidatePath);
    if (result.has) {
      _viewerFolderNavOpenTarget(candidatePath, result);
      return true;
    }
    const expanded = await _viewerFolderNavEnsureNodeExpanded(candidate);
    if (expanded && direction < 0) continue;
    cursorPath = candidatePath;
  }
  return false;
}

function _handleViewerFolderNavRequest(msg) {
  const direction = Number(msg?.direction) < 0 ? -1 : 1;
  const currentFolderPath = _viewerFolderNavCurrentFolderFromMessage(msg);
  _navigateViewerFolderByTreeOrder(direction, currentFolderPath).then(moved => {
    if (!moved && typeof showStatus === 'function') {
      showStatus('画像またはPDFがあるフォルダがありません', true);
    }
  }).catch(error => {
    if (typeof showStatus === 'function') showStatus('フォルダ移動に失敗しました: ' + (error?.message || error || ''), true);
  });
}

window.addEventListener('message', (e) => {
  if (!_isTrustedEmbeddedMessage(e)) return;
  const msg = e.data;
  if (!msg || !msg.type) return;
  if (msg.type === 'viewer-current-file-changed') { _syncViewerCurrentFileFromMessage(msg); return; }
  if (msg.type === 'viewer-sheet-context-request' && window.MeldexViewerSheetContext) {
    window.MeldexViewerSheetContext.handleRequest(msg, e.source);
    return;
  }
  if (msg.type === 'viewer-sheet-row-nav-request' && window.MeldexViewerSheetContext) {
    window.MeldexViewerSheetContext.handleRowNavigation(msg, e.source);
    return;
  }
  if (msg.type === 'viewer-folder-nav-request') { _handleViewerFolderNavRequest(msg); return; }
  const reloadEmbeddedAnnotations = () => {
    const annotationView = (typeof _getAnnotationViewName === 'function') ? _getAnnotationViewName() : state.view;
    if (typeof _usesEmbeddedAnnotationSurface === 'function' && _usesEmbeddedAnnotationSurface(annotationView) && typeof _loadAnnotationsToIframe === 'function') {
      _loadAnnotationsToIframe();
    }
  };
  // HTMLビューワーiframeからのステータス通知
  if (msg.type === 'board-status') { showStatus(msg.message, msg.isError); }
  // ヒストリー更新通知
  if (msg.type === 'history-update') { renderHistoryList(); }
  // HTMLビューワーiframe内メモからの保存依頼
  if (msg.type === 'ann-save-stroke') {
    apiPost('/annotations', {
      target_path: msg.targetPath || ann.targetPath, type: msg.annType,
      data: msg.data, color: msg.color, opacity: msg.opacity, user: getUsername(),
    }).then(res => {
      if (res?.id && typeof _pushAnnotationCreateHistory === 'function') {
        _pushAnnotationCreateHistory(res.id, '注釈: 描画追加', msg.targetPath || ann.targetPath).catch(() => {});
      }
      if (typeof _dispatchEmbeddedAnnotationMessage === 'function') _dispatchEmbeddedAnnotationMessage({ type: 'ann-stroke-saved', annId: res.id, annClientId: msg.annClientId });
    }).catch((err) => {
      if (typeof _dispatchEmbeddedAnnotationMessage === 'function') {
        _dispatchEmbeddedAnnotationMessage({ type: 'ann-stroke-save-failed', annClientId: msg.annClientId });
      }
      if (typeof showStatus === 'function') showStatus('注釈の保存に失敗しました: ' + (err?.message || err || ''), true);
    });
  }
  if (msg.type === 'ann-delete') {
    if (msg.annId) {
      (async () => {
        const before = typeof _fetchAnnotationHistoryRow === 'function'
          ? await _fetchAnnotationHistoryRow(msg.annId).catch(() => null)
          : null;
        await apiDelete('/annotations/' + encodeURIComponent(msg.annId));
        if (typeof _pushAnnotationHistory === 'function') _pushAnnotationHistory('注釈: 削除', before, null, msg.annId);
        reloadEmbeddedAnnotations();
      })().catch(() => {});
    }
  }
  if (msg.type === 'ann-delete-note') {
    if (msg.annId && msg.data) {
      if (typeof _putAnnotationWithHistory === 'function') {
        _putAnnotationWithHistory(msg.annId, { data: msg.data }, '注釈: 削除', msg.annId)
          .then(reloadEmbeddedAnnotations)
          .catch(() => {});
      } else {
        apiPut('/annotations/' + encodeURIComponent(msg.annId), { data: msg.data }).then(reloadEmbeddedAnnotations).catch(() => {});
      }
    }
  }
  if (msg.type === 'ann-update-note') {
    if (msg.annId && (msg.data || msg.color)) {
      const body = msg.color ? { color: msg.color } : { data: msg.data };
      const label = msg.color ? '注釈: 色変更' : '注釈: 付箋更新';
      if (typeof _putAnnotationWithHistory === 'function') {
        _putAnnotationWithHistory(msg.annId, body, label, msg.annId).catch(() => {});
      } else {
        apiPut('/annotations/' + encodeURIComponent(msg.annId), body).catch(() => {});
      }
    }
  }
  if (msg.type === 'ann-create-note') {
    const annotationView = (typeof _getAnnotationViewName === 'function') ? _getAnnotationViewName() : state.view;
    const embedded = typeof _usesEmbeddedAnnotationSurface === 'function' && _usesEmbeddedAnnotationSurface(annotationView);
    if (!embedded && !msg.targetPath && typeof createNote === 'function') {
      const prevColor = ann.color;
      const prevOpacity = ann.opacity;
      if (msg.color) ann.color = msg.color;
      ann.opacity = 1;
      Promise.resolve(createNote(msg.x, msg.y, 'sticky')).finally(() => {
        ann.color = prevColor;
        ann.opacity = prevOpacity;
      });
      return;
    }
    const annClientId = msg.annClientId || ('pending-note-' + Date.now().toString(36));
    const noteData = { x: msg.x, y: msg.y, width: 180, height: 100, text: '', html: '', user: getUsername() };
    if (embedded && typeof _dispatchEmbeddedAnnotationMessage === 'function') {
      _dispatchEmbeddedAnnotationMessage({
        type: 'ann-add-note',
        item: {
          id: annClientId,
          type: 'comment',
          shape: 'sticky',
          data: noteData,
          color: msg.color || ann.color,
          opacity: 1,
          user: getUsername(),
          created: new Date().toISOString(),
        },
      });
    }
    apiPost('/annotations', {
      target_path: msg.targetPath || ann.targetPath,
      type: 'comment', shape: 'sticky',
      data: noteData, color: msg.color || ann.color, opacity: 1, user: getUsername(),
    }).then(res => {
      if (res?.id && typeof _pushAnnotationCreateHistory === 'function') {
        _pushAnnotationCreateHistory(res.id, '注釈: 付箋追加', msg.targetPath || ann.targetPath).catch(() => {});
      }
      if (embedded) reloadEmbeddedAnnotations();
      else renderNote(res.id, 'sticky', noteData, msg.color || ann.color, 1, getUsername(), res.created);
    }).catch(() => {
      if (embedded && typeof _dispatchEmbeddedAnnotationMessage === 'function') {
        _dispatchEmbeddedAnnotationMessage({ type: 'ann-remove-note', annId: annClientId });
      }
    });
  }
});

// Phase C: bdToMd/bdSave等のスタブは廃止 → gb-canvas-engine.js + gb-canvas-features.js に実装済み

function bdOpenBgPalette(event) {
  if (typeof openColorPalette !== 'function') return;
  const swatch = document.getElementById('bd-bg-swatch');
  const canvas = document.getElementById('bd-canvas');
  if (!swatch || !canvas) return;
  openColorPalette(swatch, (typeof bd !== 'undefined' && bd._bgColor) || '', function(v) {
    canvas.style.background = v;
    setColorSwatchValue(swatch, v);
    if (typeof bd !== 'undefined') bd._bgColor = v || '';
    if (typeof bdMarkExtrasDirty === 'function') {
      bdMarkExtrasDirty({ minimap: true, boardUi: true }, 'bg-palette');
      if (typeof bdScheduleBoardUpdates === 'function') bdScheduleBoardUpdates();
    }
  });
}

async function openBoard(label, path, opts) {
  const openOpts = opts || {};
  const showOpenLoading = !openOpts.silent
    && !openOpts.skipGlobalUi
    && typeof showLoading === 'function'
    && typeof hideLoading === 'function';
  const prevView = state.view;
  const prevBoardPath = state.currentBoardPath;
  const currentTitleEl = document.getElementById('current-title');
  const prevTitle = currentTitleEl ? currentTitleEl.textContent : '';
  const restorePreviousView = () => {
    state.currentBoardPath = prevBoardPath || null;
    if (currentTitleEl && !openOpts.skipGlobalUi) currentTitleEl.textContent = prevTitle;
    if (!openOpts.skipShowView && prevView && prevView !== 'board') showView(prevView);
    else if (!openOpts.skipStateView) state.view = prevView || '';
  };
  if (showOpenLoading) showLoading('ボードを読み込み中...');
  try {
    if (!openOpts.skipStateView) state.view = 'board';
    state.currentBoardPath = path;
    if (!openOpts.skipHistoryScope && typeof historySetScope === 'function') historySetScope('');
    if (!openOpts.skipShowView) showView('board');
    if (currentTitleEl && !openOpts.skipGlobalUi) currentTitleEl.textContent = label;
    const opened = typeof bdOpenBoard === 'function' ? await bdOpenBoard(label, path, openOpts) : true;
    if (opened === false) {
      restorePreviousView();
      return false;
    }
    if (!openOpts.skipSaveLastView) saveLastView({type:'board', label, path});
    if (!openOpts.skipNavPush) {
      const _navEntry = {type:'board', label, path};
      navPush(_navEntry);
    }
    if (!openOpts.skipRecent) addRecent(label, path, 'board');
    if (!openOpts.skipHighlight) highlightOutlinerNode(path);
    if (!openOpts.skipAutoVersion) startAutoVersion(path, 'file');
    return true;
  } catch (err) {
    restorePreviousView();
    showStatus('ボード読み込みエラー: ' + (err.message || err), true);
    return false;
  } finally {
    if (showOpenLoading) {
      hideLoading();
      if (typeof hideLoadingMessage === 'function') {
        hideLoadingMessage('ボードを読み込み中...');
      }
    }
  }
}

function openMedia(label, path, type, opts) {
  const openOpts = opts || {};
  // 画像/PDF/動画はビューワー（html-view の #html-iframe）で表示するため、media-view を
  // 経由する showView('media') は行わない（openViewer 側の showView('html') に一本化）。
  // media-view を一瞬マウントすると html-view が退避（DOM移動）され、iframe が強制
  // 再読み込みされて開き直しの高速パスが成立しなくなる（v0.7.139検証で実測）。
  const viewerRouted = (type === 'image' || type === 'pdf' || type === 'video');
  if (!openOpts.skipShowView) { if (!viewerRouted) showView('media'); }
  else if (!openOpts.skipStateView) state.view = 'media';
  const mediaTitleEl = document.getElementById('media-title');
  if (mediaTitleEl) mediaTitleEl.textContent = label;
  const currentTitleEl = document.getElementById('current-title');
  if (currentTitleEl && !openOpts.skipGlobalUi) currentTitleEl.textContent = label;
  if (!openOpts.skipSaveLastView) saveLastView({type:'media', label, path, mediaType: type});
  if (!openOpts.skipNavPush) {
    const _navEntry = {type:'media', label, path, mediaType: type, viewerUrl: openOpts.viewerUrl || ''};
    navPush(_navEntry);
  }
  if (!openOpts.skipRecent) addRecent(label, path, 'media');
  if (!openOpts.skipHighlight) highlightOutlinerNode(path);
  // 詳細パネルにファイル情報を表示
  if (!openOpts.skipGlobalUi && typeof _showFileInfoInDetailPanel === 'function') _showFileInfoInDetailPanel(path);
  // ビューワーペインを更新
  state.currentPagePath = path;
  const container = document.getElementById('media-content');
  const url = openOpts.rawUrl || (API_BASE + '/file-raw?path=' + encodeURIComponent(path));
  if (type === 'image') {
    openViewer(openOpts.viewerUrl || openOpts.rawUrl || ('/viewer?file=' + encodeURIComponent(path)), openOpts);
    return;
  } else if (type === 'pdf') {
    openViewer('/viewer?pdf=' + encodeURIComponent(path), openOpts);
    return;
  } else if (type === 'video') {
    // 動画も画像・PDFと同じくビューワー（viewer.html／#html-iframe）側へ統一する。
    // ビューワー側の動画対応は並行して実装中で、ここではルーティングのみ行う
    // （旧・#media-content への直接注入は廃止。共有コンテナのタブ間混入対策も
    // ビューワー経由に一本化することで簡素化される）。
    openViewer(openOpts.viewerUrl || openOpts.rawUrl || ('/viewer?file=' + encodeURIComponent(path)), openOpts);
    return;
  } else if (!container) {
    return;
  } else if (type === 'audio') {
    container.innerHTML = '<div style="text-align:center;padding:40px;">' + lucide('audio',48) + '<br><audio src="' + esc(url) + '" controls style="margin-top:16px;width:400px;">音声を再生できません</audio></div>';
    // タブ復帰時、共有コンテナ（media-content）の実内容が対象タブと一致しているか
    // 検証するための署名（gb-pane-bridge.part02.part01.js の _gbMediaTabExpectedSignature /
    // _gbVerifyAndFixMediaContainer 参照）。
    container.dataset.gbMediaPath = path;
    container.dataset.gbMediaKind = 'audio';
  } else {
    container.innerHTML = '<div class="gb-empty-state"><div class="gb-empty-message">このメディア形式は表示できません</div><div class="gb-empty-hint">' + esc(label || path || '') + '</div></div>';
    delete container.dataset.gbMediaPath;
    delete container.dataset.gbMediaKind;
    if (!openOpts.skipGlobalUi) showStatus('このメディア形式は表示できません: ' + (label || type || path), true);
    return;
  }
  if (!openOpts.skipGlobalUi) showStatus(type + ': ' + label);
}

function openCalendarFile(label, path, opts) {
  const openOpts = opts || {};
  const paneContext = openOpts.paneContext || openOpts.paneCtx || null;
  if (paneContext?.embedded || openOpts.skipViewPersistence) {
    return selectDatabase(path, paneContext, { ...openOpts, requestedViewMode: 'timeline' });
  }
  // カレンダーDBをタイムラインビュー（カレンダーモード）で開く
  const cfg = getDbViewConfig(path);
  const view = typeof _getCurrentDbViewConfigEntryFromConfig === 'function'
    ? _getCurrentDbViewConfigEntryFromConfig(cfg)
    : null;
  if (view) {
    if (typeof _ensureDbViewTypeSpecific === 'function') _ensureDbViewTypeSpecific(view, cfg);
    view.viewMode = 'timeline';
    cfg.currentViewIdx = Math.max(0, cfg.currentViewIdx || 0);
    saveDbViewConfig(path, cfg, { skipHistory: true });
  }
  return selectDatabase(path, paneContext, openOpts);
}

const _GB_UNTRUSTED_IFRAME_SANDBOX = 'allow-scripts allow-forms allow-popups allow-downloads';
const _GB_EXTERNAL_HTML_IFRAME_SANDBOX = _GB_UNTRUSTED_IFRAME_SANDBOX + ' allow-same-origin';
const _GB_TRUSTED_VIEWER_IFRAME_SANDBOX = _GB_UNTRUSTED_IFRAME_SANDBOX + ' allow-same-origin';

function _gbIsTrustedInternalViewerUrl(rawUrl) {
  const text = String(rawUrl || '').trim();
  if (!text) return false;
  try {
    const parsed = new URL(text, window.location.origin);
    const pathname = parsed.pathname.replace(/\/+$/, '').toLowerCase();
    return parsed.origin === window.location.origin && /\/viewer(?:\.html)?$/.test(pathname);
  } catch {
    return false;
  }
}

function _gbHtmlIframeSandboxForUrl(rawUrl) {
  const text = String(rawUrl || '').trim();
  if (!text) return _GB_UNTRUSTED_IFRAME_SANDBOX;
  try {
    const parsed = new URL(text, window.location.origin);
    if (_gbIsTrustedInternalViewerUrl(parsed.href)) {
      return _GB_TRUSTED_VIEWER_IFRAME_SANDBOX;
    }
    if (['http:', 'https:'].includes(parsed.protocol) && parsed.origin !== window.location.origin) {
      return _GB_EXTERNAL_HTML_IFRAME_SANDBOX;
    }
  } catch {}
  return _GB_UNTRUSTED_IFRAME_SANDBOX;
}

function _gbPrepareUntrustedIframe(iframe, rawUrl) {
  if (!iframe) return null;
  iframe.setAttribute('sandbox', _gbHtmlIframeSandboxForUrl(rawUrl || iframe.getAttribute('src') || iframe.src || ''));
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  return iframe;
}

function _gbNormalizeHtmlViewerUrl(rawUrl) {
  const text = String(rawUrl || '').trim();
  if (!text) return '';
  try {
    const parsed = new URL(text, window.location.origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function _gbSetHtmlViewerSrc(rawUrl, iframeEl, options) {
  const url = _gbNormalizeHtmlViewerUrl(rawUrl);
  if (!url) {
    if (typeof showStatus === 'function') showStatus('HTMLビューワーで開けないURLです', true);
    return false;
  }
  const iframe = _gbPrepareUntrustedIframe(iframeEl || document.getElementById('html-iframe'), url);
  if (iframe) iframe.src = url;
  const urlBar = options?.skipUrlBar ? null : document.getElementById('html-url-bar');
  if (urlBar) urlBar.value = url;
  return true;
}

_gbPrepareUntrustedIframe(document.getElementById('html-iframe'));

function openHtmlFile(label, path, opts) {
  const openOpts = opts || {};
  if (!openOpts.skipShowView) showView('html');
  else if (!openOpts.skipStateView) state.view = 'html';
  if (!openOpts.skipGlobalState) state.currentPagePath = path;
  const currentTitleEl = document.getElementById('current-title');
  if (currentTitleEl && !openOpts.skipGlobalUi) currentTitleEl.textContent = label;
  if (!openOpts.skipSaveLastView) saveLastView({type:'html', label, path});
  if (!openOpts.skipNavPush) {
    const _navEntry = {type:'html', label, path};
    navPush(_navEntry);
  }
  if (!openOpts.skipRecent) addRecent(label, path, 'html');
  if (!openOpts.skipHighlight) highlightOutlinerNode(path);
  const url = API_BASE + '/file-raw?path=' + encodeURIComponent(path);
  const iframe = openOpts.iframeEl || document.getElementById('html-iframe');
  if (typeof trackIframeLoading === 'function') {
    trackIframeLoading(iframe, 'HTMLを読み込み中...', openOpts);
  }
  _gbSetHtmlViewerSrc(url, iframe, { skipUrlBar: !!openOpts.iframeEl });
  if (!openOpts.skipGlobalUi) showStatus('HTML: ' + label);
}
/* LUCIDE, lucide(), fileTypeIcon() は meldex-core.js で定義済み */
function getUsername() {
  try { const cfg = JSON.parse(localStorage.getItem('meldex-user') || '{}'); return cfg.name || 'anonymous'; } catch { return 'anonymous'; }
}

// ビュー切り替え時のアノテーション再読み込みは showView 本体 (720-731行) で処理済み

// replaceIcons() は meldex-core.js で定義済み（DOMContentLoaded内で呼び出し）

// ダイアログのリサイズは gb-modal-shell.js の1系統に統合した（2026-08-07）。
// 以前はここにも独自のリサイズ機構があり、表示サイズ（拡大率）を考慮しない座標計算と
// max-width/max-height の上書きで、共通側と互いに打ち消し合っていた。
/* ==============================
   起動
   ============================== */
replaceIcons();
loadColorSettings();
updateColorScheme();
updateUserIcon();
// UIスケール復元
// ページ離脱時の未保存データ保護
function _sendUnloadJson(url, method, body) {
  let requestMethod = method || 'POST';
  let requestBody = body || {};
  if (requestMethod === 'PUT' && String(url || '').includes('/value?')) {
    requestMethod = 'POST';
    requestBody = { ...requestBody, _unload_update: true };
  }
  const payload = JSON.stringify(requestBody);
  const blob = new Blob([payload], { type: 'application/json' });
  if (requestMethod === 'POST' && navigator.sendBeacon) {
    try {
      if (navigator.sendBeacon(url, blob)) return true;
    } catch {}
  }
  try {
    fetch(url, {
      method: requestMethod,
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
    return payload.length <= 60000;
  } catch {}
  return false;
}

window.addEventListener('beforeunload', (e) => {
  let unloadSaveQueued = true;
  // ノート: 未保存の自動保存タイマーが残っている場合、即座に保存
  if (window._noteAutoSaveTimer) {
    clearTimeout(window._noteAutoSaveTimer);
    window._noteAutoSaveTimer = null;
    const pc = document.getElementById('page-content');
    const currentPath = pc?.dataset?.path;
    if (currentPath) {
      const md = htmlToMd(pc?.innerHTML || '');
      const fm = pc.dataset.frontmatter || '';
      const full = fm ? fm + md : md;
      const body = typeof _noteSavePayload === 'function'
        ? _noteSavePayload(pc, full)
        : { content: full, if_match_etag: pc?.dataset?.lastSavedEtag || '', skip_if_missing: true };
      const noteSaveQueued = _sendUnloadJson(API_BASE + '/file?path=' + encodeURIComponent(currentPath), 'POST', body);
      unloadSaveQueued = noteSaveQueued && unloadSaveQueued;
      if (!noteSaveQueued) {
        window._noteAutoSaveTimer = setTimeout(() => {
          if (typeof flushPendingEditorAutosave === 'function') flushPendingEditorAutosave();
        }, 500);
      }
    }
  }
  // entity-freetext: 未保存タイマーが残っている場合
  if (window._ftAutoSaveTimer) {
    clearTimeout(window._ftAutoSaveTimer);
    const ft = document.getElementById('entity-freetext');
    const ep = ft?.dataset?.entityPath;
    if (ep) {
      const md = htmlToMd(ft?.innerHTML || '');
      const isEntry = ep.endsWith('.md');
      const url = isEntry
        ? API_BASE + '/value?path=' + encodeURIComponent(ep)
        : API_BASE + '/file?path=' + encodeURIComponent(ep + '/_freetext.md');
      const body = isEntry ? { new_body: md, skip_if_missing: true } : { content: md, skip_if_missing: true };
      unloadSaveQueued = _sendUnloadJson(url, isEntry ? 'PUT' : 'POST', body) && unloadSaveQueued;
    }
  }
  // キャンバス: 未保存タイマーが残っている場合
  if (window._bdTimer && typeof bd !== 'undefined' && bd.dirty && bd.path && typeof bdToMd === 'function') {
    const canSaveBoardPath = typeof _bdCanSaveCurrentBoardPath !== 'function' || _bdCanSaveCurrentBoardPath(bd.path);
    if (!canSaveBoardPath) {
      unloadSaveQueued = false;
    } else {
      clearTimeout(window._bdTimer);
      const boardSaveQueued = _sendUnloadJson(API_BASE + '/file?path=' + encodeURIComponent(bd.path), 'POST', { content: bdToMd(), skip_if_missing: true });
      unloadSaveQueued = boardSaveQueued && unloadSaveQueued;
      if (!boardSaveQueued) window._bdTimer = setTimeout(bdSave, 500);
    }
  }
  if (!unloadSaveQueued) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ノート縦書き復元
// 復元も切替も MeldexNoteWritingMode.applyState() へ集約する（組方向へ追従するUIの配線が
// 1箇所に集まるため、目次レイアウトやセパレータのARIAが復元時だけ取り残されない）。
// 上の replaceIcons() は既に実行済みなので、ボタンのアイコンは applyState() が lucide() で埋め直す。
if (typeof MeldexNoteWritingMode !== 'undefined') MeldexNoteWritingMode.restoreFromStorage();
// ノート余白復元
if (typeof applyNoteMargin === 'function') applyNoteMargin();
if (typeof applyNoteContentMaxWidth === 'function') applyNoteContentMaxWidth();
// UIスケール復元
document.documentElement.style.fontSize = ''; // 旧font-sizeスケーリングをクリア
// 表示サイズの決め方（初回の自動判定・手動値の保全・過去の自動値の付け直し）は
// gb-ui-scale.js が一手に引き受ける。ここでは決まった値を適用するだけにする。
applyUIScale(window.MeldexUIScale
  ? window.MeldexUIScale.resolveStartupScale()
  : (parseInt(localStorage.getItem('ui-scale'), 10) || 100));

// ステータスバー表示状態復元
try {
  if (typeof applyStatusbarHidden === 'function') {
    applyStatusbarHidden(localStorage.getItem('meldex-statusbar-hidden') === '1');
  }
} catch (e) { console.warn('ステータスバー状態復元失敗:', e); }

// Ctrl+ホイールでUIスケール変更（pywebviewではブラウザネイティブzoomが無効のため自前実装）
document.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  // キャンバス・フォルダビュー等の独自ズームが処理する場合はスキップ
  const canvas = document.getElementById('bd-canvas');
  if (canvas && canvas.contains(e.target)) return;
  const folderGrid = document.getElementById('folder-grid');
  if (folderGrid && folderGrid.contains(e.target)) return;
  e.preventDefault();
  const steps = [67, 75, 80, 90, 100, 110, 125, 150, 175, 200];
  const cur = parseInt(localStorage.getItem('ui-scale') || '100', 10);
  const idx = steps.indexOf(cur);
  let newIdx;
  if (idx === -1) {
    // 現在値がステップ外の場合、最も近いステップを探す
    newIdx = steps.reduce((best, v, i) => Math.abs(v - cur) < Math.abs(steps[best] - cur) ? i : best, 0);
  } else {
    newIdx = e.deltaY < 0 ? Math.min(idx + 1, steps.length - 1) : Math.max(idx - 1, 0);
  }
  if (steps[newIdx] !== cur) {
    // Ctrl+ホイールは常にユーザー自身の操作なので「手動」として記録する
    const applied = applyUIScale(steps[newIdx], { source: 'manual' });
    if (applied !== cur) showStatus('表示サイズ: ' + applied + '%');
  }
}, { passive: false });

// モバイルツールメニュー（トップバー折りたたみ時）
function showMobileToolMenu(e) {
  document.querySelectorAll('.mobile-tool-menu').forEach(el => el.remove());
  const btn = e.target.closest('button') || e.target;
  const items = [
    { label: 'フォルダ', action: () => openToolTab('folder') },
    { label: 'ノート', action: () => openToolTab('page') },
    { label: 'シート', action: () => openToolTab('database') },
    { label: 'スマートシート', action: () => openToolTab('smart-db') },
    { label: 'ボード', action: () => openToolTab('board') },
    null,
    { label: 'ビューワー', action: () => toggleRightPanelTab('preview') },
    { label: 'オプション', action: () => toggleOptionPanel() },
    null,
    { label: '注釈ツール', action: () => toggleAnnotationToolbar() },
    { label: 'オーバーレイ', action: () => toggleOverlayVisibility() },
  ];
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu mobile-tool-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'ツールメニュー');
  menu.style.cssText = 'position:fixed;z-index:999;max-height:80vh;overflow-y:auto;';
  let menuClosed = false;
  let closeOnPointer = null;
  let closeOnKey = null;
  function closeMenu(restoreFocus = false) {
    if (menuClosed) return;
    menuClosed = true;
    document.removeEventListener('pointerdown', closeOnPointer, true);
    document.removeEventListener('keydown', closeOnKey, true);
    menu.remove();
    if (restoreFocus && typeof btn.focus === 'function') {
      try { btn.focus({ preventScroll: true }); } catch { btn.focus(); }
    }
  }
  function focusableItems() {
    return [...menu.querySelectorAll('.gb-context-menu-item')];
  }
  items.forEach(it => {
    if (!it) { const sep = document.createElement('div'); sep.className = 'gb-context-menu-sep'; sep.setAttribute('role', 'separator'); menu.appendChild(sep); return; }
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'gb-context-menu-item';
    row.setAttribute('role', 'menuitem');
    row.textContent = it.label;
    row.addEventListener('click', () => { closeMenu(false); try { it.action(); } catch {} });
    menu.appendChild(row);
  });
  document.body.appendChild(menu);
  const br = btn.getBoundingClientRect();
  if (typeof positionPopup === 'function') {
    positionPopup(menu, br, { prefer: 'bottom', gap: 2 });
  } else {
    { const z = _getZoom(); menu.style.left = Math.max(4, Math.min(br.left / z, window.innerWidth / z - menu.offsetWidth - 4)) + 'px'; menu.style.top = (br.bottom / z + 2) + 'px'; }
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  }
  closeOnPointer = function closeMobileToolMenuOnPointer(ev) {
    if (!menu.contains(ev.target)) closeMenu(false);
  };
  closeOnKey = function closeMobileToolMenuOnKey(ev) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closeMenu(true);
      return;
    }
    const rows = focusableItems();
    if (!rows.length) return;
    const currentIndex = Math.max(0, rows.indexOf(document.activeElement));
    let nextIndex = currentIndex;
    if (ev.key === 'ArrowDown') nextIndex = (currentIndex + 1) % rows.length;
    else if (ev.key === 'ArrowUp') nextIndex = (currentIndex - 1 + rows.length) % rows.length;
    else if (ev.key === 'Home') nextIndex = 0;
    else if (ev.key === 'End') nextIndex = rows.length - 1;
    else return;
    ev.preventDefault();
    rows[nextIndex]?.focus();
  };
  setTimeout(() => {
    if (menuClosed || !menu.isConnected) return;
    document.addEventListener('pointerdown', closeOnPointer, true);
    document.addEventListener('keydown', closeOnKey, true);
  }, 0);
  menu.querySelector('.gb-context-menu-item')?.focus();
}

// OS テーマ変更を監視
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (detectCurrentTheme() === 'OSに合わせる' || localStorage.getItem('editor-theme-name') === 'OSに合わせる') {
    applyThemePreset('OSに合わせる');
    saveColorSettings();
  }
});

// HTML ビューワーのナビゲーション
function htmlNavBack() { const f = document.getElementById('html-iframe'); if (f?.contentWindow) try { f.contentWindow.history.back(); } catch {} }
function htmlNavForward() { const f = document.getElementById('html-iframe'); if (f?.contentWindow) try { f.contentWindow.history.forward(); } catch {} }
function htmlNavigate(url) { if (!url) return; _gbSetHtmlViewerSrc(url); }
function htmlRefresh() { const f = _gbPrepareUntrustedIframe(document.getElementById('html-iframe')); if (f) try { f.contentWindow.location.reload(); } catch { f.src = f.src; } }

// ============================================================
// 最後のポインタ操作がフォルダツリー内かどうかを追跡
// gb-editor.js の Delete ハンドラが誤削除防止に使う
// ============================================================
document.addEventListener('pointerdown', (e) => {
  try {
    window._lastPointerInTree = !!(e.target && e.target.closest && e.target.closest('#outliner-tree'));
  } catch {}
}, true);

// ============================================================
// 共通コンテキストメニューの閉じる処理
// ============================================================
document.addEventListener('pointerdown', (e) => {
  // gb-mobile-tab-gesture-router.js のスマホ用タブ切替メニュー(.gb-mobile-tab-menu)は
  // 位置制御の都合で document.body 直下に付き、.gb-context-menu の子ではない。
  // ここで除外しないと、.gb-context-menu を内側に持つポップアップ（アイコン
  // ピッカー等）でタブ切替メニューの項目をタップするたびに「外側クリック」と
  // 誤判定され、切替と同時に親のコンテキストメニューごと消えてしまう
  // （2026-08-13 バグ報告で確認）。
  if (!e.target?.closest?.('.gb-context-menu') && !e.target?.closest?.('.gb-mobile-tab-menu')) {
    document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
  }
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const menus = document.querySelectorAll('.gb-context-menu');
  if (!menus.length) return;
  // ダイアログとして振る舞う要素（アイコンピッカー等）はrole="dialog"/"alertdialog"を
  // 持ち、自分自身のEscapeキー処理（document への capture 登録）で自分だけを閉じ、
  // フォーカス復帰やリスナー解除も自前で行う契約を持つ。
  //
  // このリスナーはページ読み込み時に document のbubbleフェーズへ登録されるため、
  // モーダルが開いた時に登録される最前面判定（gb-ui.js の onEscKey、
  // GBDialogKeyboard.topmostDialog 等）より必ず先に発火する。ここで無条件に
  // .gb-context-menu を全部 remove() してキー入力をそのまま素通しすると、背後の
  // 親ダイアログが「ピッカーはもう無い」と誤認して一緒に閉じてしまう
  // （アイコンピッカー Escape 早期消去バグ）。
  //
  // dialog ロールを持つメニューは、このキー入力をそのメニュー自身へ再ディスパッチ
  // して専用のクローズ処理（フォーカス復帰・リスナー解除を含む）に任せ、元の
  // キー入力はここで止めて後続の親ダイアログの Escape ハンドラへ渡さない。
  // 通常のコンテキストメニュー（role=dialog を持たない）は従来どおりここで閉じる
  // （main-menu 等の既存 Escape 挙動を変えない）。
  let hasDialogMenu = false;
  menus.forEach((m) => {
    const role = m.getAttribute('role');
    if (role === 'dialog' || role === 'alertdialog') {
      hasDialogMenu = true;
      m.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: false, cancelable: true }));
      // 専用ハンドラが未登録などで閉じられなかった場合の保険（通常は到達しない）
      if (m.isConnected) m.remove();
    } else {
      m.remove();
    }
  });
  if (hasDialogMenu) e.stopImmediatePropagation();
});

// ============================================================
// 空状態表示
// ============================================================
function renderEmptyState(container, icon, message, hint) {
  container.innerHTML = `
    <div class="gb-empty-state">
      <div class="gb-empty-icon">${typeof lucide === 'function' ? lucide(icon, 48) : ''}</div>
      <div class="gb-empty-message">${esc(message)}</div>
      ${hint ? `<div class="gb-empty-hint">${esc(hint)}</div>` : ''}
    </div>`;
}

// ============================================================
// ローディング表示
// ============================================================
let _loadingCount = 0;
let _loadingTimer = null;
let _loadingVisible = false;
let _loadingMessage = '';
const _loadingOperations = [];

function _commonLoadingProgress() {
  return window.MeldexOperationProgress && typeof window.MeldexOperationProgress.begin === 'function'
    ? window.MeldexOperationProgress
    : null;
}

function _loadingText(msg) {
  return String(msg || _loadingMessage || '読み込み中...');
}

function _setLoadingNodeContent(el, msg) {
  if (!el) return;
  const spinner = document.createElement('span');
  spinner.className = 'gb-spinner';
  const label = document.createElement('span');
  label.className = 'gb-loading-label';
  label.textContent = _loadingText(msg);
  el.replaceChildren(spinner, label);
}

function _ensureGlobalLoadingIndicator() {
  let el = document.getElementById('gb-global-loading');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'gb-global-loading';
  el.className = 'gb-global-loading';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.hidden = true;
  document.body.appendChild(el);
  return el;
}

function _renderLoadingUi(msg) {
  const text = _loadingText(msg);
  const statusEl = document.getElementById('sb-loading');
  if (statusEl) {
    _setLoadingNodeContent(statusEl, text);
    statusEl.style.display = '';
  }
  const floatingEl = _ensureGlobalLoadingIndicator();
  if (floatingEl) {
    _setLoadingNodeContent(floatingEl, text);
    floatingEl.hidden = false;
  }
  _loadingVisible = true;
}

function _hideLoadingUi() {
  const statusEl = document.getElementById('sb-loading');
  if (statusEl) {
    statusEl.replaceChildren();
    statusEl.style.display = 'none';
  }
  const floatingEl = document.getElementById('gb-global-loading');
  if (floatingEl) {
    floatingEl.replaceChildren();
    floatingEl.hidden = true;
  }
  _loadingVisible = false;
}

function _loadingPaintDelay() {
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    if (typeof requestAnimationFrame === 'function' && document.visibilityState !== 'hidden') {
      requestAnimationFrame(() => requestAnimationFrame(finish));
      setTimeout(finish, 80);
    } else {
      setTimeout(finish, 0);
    }
  });
}

async function showLoadingBeforeHeavyWork(sizeOrText, msg, opts) {
  const options = opts || {};
  const threshold = Number.isFinite(options.threshold) ? options.threshold : 200000;
  const size = typeof sizeOrText === 'number'
    ? sizeOrText
    : String(sizeOrText || '').length;
  if (size < threshold) return;
  if (_commonLoadingProgress()) {
    const current = _loadingOperations[_loadingOperations.length - 1];
    if (!current) return;
    _loadingMessage = _loadingText(msg);
    current.update({ label: _loadingMessage });
    current.showNow();
    await _loadingPaintDelay();
    return;
  }
  if (_loadingCount <= 0 && !_loadingVisible) return;
  _loadingMessage = _loadingText(msg);
  if (_loadingTimer) {
    clearTimeout(_loadingTimer);
    _loadingTimer = null;
  }
  _renderLoadingUi(_loadingMessage);
  await _loadingPaintDelay();
}

function showLoading(msg) {
  _loadingCount++;
  _loadingMessage = _loadingText(msg);
  const common = _commonLoadingProgress();
  if (common) {
    _loadingOperations.push(common.begin({
      kind: 'loading',
      label: _loadingMessage,
      mode: 'indeterminate',
      background: false,
      delayMs: 300,
      showInTray: true,
      priority: 40,
    }));
    return;
  }
  if (_loadingVisible) {
    _renderLoadingUi(_loadingMessage);
    return;
  }
  if (!_loadingTimer) {
    _loadingTimer = setTimeout(() => {
      _loadingTimer = null;
      if (_loadingCount > 0) _renderLoadingUi(_loadingMessage);
    }, 300);
  }
}

function hideLoading() {
  _loadingCount = Math.max(0, _loadingCount - 1);
  if (_commonLoadingProgress()) {
    const current = _loadingOperations.pop();
    current?.succeed({ dismissMs: 0 });
    if (_loadingCount === 0) _loadingMessage = '';
    return;
  }
  if (_loadingCount === 0) {
    clearTimeout(_loadingTimer);
    _loadingTimer = null;
    _loadingMessage = '';
    _hideLoadingUi();
  }
}

function hideLoadingMessage(msg) {
  const expected = _loadingText(msg);
  if (_commonLoadingProgress()) {
    for (let index = _loadingOperations.length - 1; index >= 0; index -= 1) {
      const operation = _loadingOperations[index];
      if (operation.getState()?.label !== expected) continue;
      _loadingOperations.splice(index, 1);
      operation.dispose();
      _loadingCount = Math.max(0, _loadingCount - 1);
      if (_loadingCount === 0) _loadingMessage = '';
      return true;
    }
    return false;
  }
  if (!_loadingVisible && !_loadingTimer) return false;
  if (_loadingMessage && _loadingMessage !== expected) return false;
  const floatingEl = document.getElementById('gb-global-loading');
  const visibleText = (floatingEl?.textContent || '').trim();
  if (visibleText && visibleText !== expected) return false;
  _loadingCount = 0;
  clearTimeout(_loadingTimer);
  _loadingTimer = null;
  _loadingMessage = '';
  _hideLoadingUi();
  return true;
}

function trackIframeLoading(iframe, msg, opts) {
  const options = opts || {};
  if (!iframe || options.silent || options.skipGlobalUi) return;
  if (typeof showLoading !== 'function' || typeof hideLoading !== 'function') return;
  showLoading(msg || 'ビューアを読み込み中...');
  let done = false;
  let timer = null;
  const finish = () => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    iframe.removeEventListener('load', finish);
    iframe.removeEventListener('error', finish);
    hideLoading();
  };
  iframe.addEventListener('load', finish);
  iframe.addEventListener('error', finish);
  timer = setTimeout(finish, Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000);
}

// サーバーへの定期ハートビート（exe版: ブラウザ閉じたらサーバー自動終了用）
let _heartbeatTimer = null;

function _isHeartbeatCloudMode() {
  return window.MeldexRuntimeAdapter?.isBrowserDataMode?.()
    || document.body?.dataset?.cloudMode === 'dropbox'
    || document.body?.dataset?.cloudMode === 'browser';
}

function _sendHeartbeat() {
  fetch('/api/heartbeat', { method: 'POST' }).catch(() => {});
}

function _startHeartbeat() {
  _sendHeartbeat();
  if (_heartbeatTimer) return;
  _heartbeatTimer = setInterval(_sendHeartbeat, 10000);
}

function _stopHeartbeat() {
  if (!_heartbeatTimer) return;
  clearInterval(_heartbeatTimer);
  _heartbeatTimer = null;
}

function _syncHeartbeatForVisibility() {
  if (_isHeartbeatCloudMode()) {
    _stopHeartbeat();
    return;
  }
  _startHeartbeat();
}

document.addEventListener('visibilitychange', _syncHeartbeatForVisibility);
if (document.body && typeof MutationObserver !== 'undefined') {
  new MutationObserver(_syncHeartbeatForVisibility).observe(document.body, {
    attributes: true,
    attributeFilter: ['data-cloud-mode'],
  });
}
_syncHeartbeatForVisibility();
