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
  if (!openOpts.skipShowView) showView('media');
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
  } else if (!container) {
    return;
  } else if (type === 'video') {
    container.innerHTML = '<video src="' + esc(url) + '" controls autoplay playsinline style="max-width:100%;max-height:80vh;border-radius:4px;">動画を再生できません</video>';
    window.MeldexMediaPlayback?.start(container.querySelector('video'));
  } else if (type === 'audio') {
    container.innerHTML = '<div style="text-align:center;padding:40px;">' + lucide('audio',48) + '<br><audio src="' + esc(url) + '" controls style="margin-top:16px;width:400px;">音声を再生できません</audio></div>';
  } else {
    container.innerHTML = '<div class="gb-empty-state"><div class="gb-empty-message">このメディア形式は表示できません</div><div class="gb-empty-hint">' + esc(label || path || '') + '</div></div>';
    if (!openOpts.skipGlobalUi) showStatus('このメディア形式は表示できません: ' + (label || type || path), true);
    return;
  }
  if (!openOpts.skipGlobalUi) showStatus(type + ': ' + label);
}

function openCalendarFile(label, path, opts) {
  const openOpts = opts || {};
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
  return selectDatabase(path, openOpts.paneContext || openOpts.paneCtx || null, openOpts);
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

function _gbSetHtmlViewerSrc(rawUrl) {
  const url = _gbNormalizeHtmlViewerUrl(rawUrl);
  if (!url) {
    if (typeof showStatus === 'function') showStatus('HTMLビューワーで開けないURLです', true);
    return false;
  }
  const iframe = _gbPrepareUntrustedIframe(document.getElementById('html-iframe'), url);
  if (iframe) iframe.src = url;
  const urlBar = document.getElementById('html-url-bar');
  if (urlBar) urlBar.value = url;
  return true;
}

_gbPrepareUntrustedIframe(document.getElementById('html-iframe'));

function openHtmlFile(label, path, opts) {
  const openOpts = opts || {};
  if (!openOpts.skipShowView) showView('html');
  else if (!openOpts.skipStateView) state.view = 'html';
  state.currentPagePath = path;
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
  if (typeof trackIframeLoading === 'function') {
    trackIframeLoading(document.getElementById('html-iframe'), 'HTMLを読み込み中...', openOpts);
  }
  _gbSetHtmlViewerSrc(url);
  if (!openOpts.skipGlobalUi) showStatus('HTML: ' + label);
}
/* LUCIDE, lucide(), fileTypeIcon() は meldex-core.js で定義済み */
function getUsername() {
  try { const cfg = JSON.parse(localStorage.getItem('meldex-user') || '{}'); return cfg.name || 'anonymous'; } catch { return 'anonymous'; }
}

// ビュー切り替え時のアノテーション再読み込みは showView 本体 (720-731行) で処理済み

// replaceIcons() は meldex-core.js で定義済み（DOMContentLoaded内で呼び出し）

const _GB_RESIZABLE_MODAL_SELECTOR = '.modal, .gb-modal, .link-modal, .gb-cal-modal';
const _GB_MODAL_RESIZE_DIRECTIONS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

function _gbClampModalValue(value, min, max) {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

function _gbModalMinSize(modal) {
  const cs = getComputedStyle(modal);
  const minWidth = Math.max(240, parseFloat(cs.minWidth) || 0);
  const minHeight = Math.max(160, parseFloat(cs.minHeight) || 0);
  return { minWidth, minHeight };
}

function _gbIsMobileDialogSheetModal(modal) {
  if (!modal) return false;
  const overlay = modal.closest?.('.modal-overlay, .gb-modal-overlay, .gb-cal-modal-overlay, .link-modal-overlay');
  return overlay?.dataset?.mobileDialogSheetActive === '1'
    || modal.dataset.mobileDialogSheet === '1'
    || modal.classList?.contains('gb-mobile-dialog-sheet');
}

function _gbClampModalForNarrowViewport(modal) {
  if (!modal || window.innerWidth > 768) return;
  const gap = 8;
  const zoom = Math.max(0.1, (typeof _getZoom === 'function'
    ? Number(_getZoom())
    : Number.parseFloat(document.documentElement.style.zoom || '1')) || 1);
  const viewportWidth = window.innerWidth / zoom;
  const viewportHeight = (window.visualViewport?.height || window.innerHeight) / zoom;
  modal.style.minWidth = '0';
  modal.style.width = Math.max(240, viewportWidth - gap * 2) + 'px';
  modal.style.maxWidth = Math.max(240, viewportWidth - gap * 2) + 'px';
  modal.style.maxHeight = Math.max(160, viewportHeight - gap * 2) + 'px';
}

function _gbClearResizableModalState(modal) {
  if (!modal) return;
  if (modal.dataset?.gbResizableModal) delete modal.dataset.gbResizableModal;
  modal.classList?.remove('gb-modal-resizable');
  modal.querySelectorAll?.(':scope > .gb-modal-shell-edge').forEach(edge => edge.remove());
}

function _gbStartModalResize(event, modal, direction) {
  if (!modal || (event.button != null && event.button !== 0)) return;
  event.preventDefault();
  event.stopPropagation();
  const handle = event.currentTarget;
  try { handle?.setPointerCapture?.(event.pointerId); } catch (_) {}

  const rect = modal.getBoundingClientRect();
  const start = {
    x: event.clientX,
    y: event.clientY,
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
  const { minWidth, minHeight } = _gbModalMinSize(modal);
  const gap = 8;
  document.body.classList.add('gb-modal-resizing');

  function onMove(moveEvent) {
    moveEvent.preventDefault();
    const dx = moveEvent.clientX - start.x;
    const dy = moveEvent.clientY - start.y;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    let left = start.left;
    let top = start.top;
    let right = start.right;
    let bottom = start.bottom;

    if (direction.includes('e')) {
      right = _gbClampModalValue(start.right + dx, start.left + minWidth, viewportW - gap);
    }
    if (direction.includes('w')) {
      left = _gbClampModalValue(start.left + dx, gap, start.right - minWidth);
    }
    if (direction.includes('s')) {
      bottom = _gbClampModalValue(start.bottom + dy, start.top + minHeight, viewportH - gap);
    }
    if (direction.includes('n')) {
      top = _gbClampModalValue(start.top + dy, gap, start.bottom - minHeight);
    }

    modal.style.left = left + 'px';
    modal.style.top = top + 'px';
    modal.style.width = Math.max(minWidth, right - left) + 'px';
    modal.style.height = Math.max(minHeight, bottom - top) + 'px';
  }

  function onUp() {
    try { handle?.releasePointerCapture?.(event.pointerId); } catch (_) {}
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
    document.body.classList.remove('gb-modal-resizing');
  }

  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('pointercancel', onUp, true);
}

function _gbInstallModalResizeEdges(modal) {
  if (!modal || modal.dataset.gbResizableModal === '1') return;
  if (_gbIsMobileDialogSheetModal(modal)) {
    _gbClearResizableModalState(modal);
    return;
  }
  modal.dataset.gbResizableModal = '1';
  modal.classList.add('gb-modal-resizable');
  modal.style.boxSizing = 'border-box';
  modal.style.position = 'absolute';
  modal.style.right = 'auto';
  modal.style.bottom = 'auto';
  modal.style.margin = '0';
  modal.style.transform = 'none';
  modal.style.maxWidth = 'calc(100vw - 16px)';
  modal.style.maxHeight = 'calc(100vh - 16px)';
  _gbClampModalForNarrowViewport(modal);

  _GB_MODAL_RESIZE_DIRECTIONS.forEach(direction => {
    const edge = document.createElement('div');
    edge.className = `gb-modal-shell-edge gb-modal-shell-edge-${direction}`;
    edge.dataset.modalResize = direction;
    edge.addEventListener('pointerdown', event => _gbStartModalResize(event, modal, direction));
    modal.appendChild(edge);
  });
}

function _gbPrepareResizableModal(modal) {
  if (!modal || modal.dataset.gbResizableModal === '1') return;
  if (_gbIsMobileDialogSheetModal(modal)) {
    _gbClearResizableModalState(modal);
    return;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!modal.isConnected || modal.dataset.gbResizableModal === '1') return;
      if (_gbIsMobileDialogSheetModal(modal)) {
        _gbClearResizableModalState(modal);
        return;
      }
      _gbClampModalForNarrowViewport(modal);
      const rect = modal.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const gap = 8;
      const width = Math.min(rect.width, window.innerWidth - gap * 2);
      const height = Math.min(rect.height, window.innerHeight - gap * 2);
      const left = _gbClampModalValue(rect.left, gap, window.innerWidth - width - gap);
      const top = _gbClampModalValue(rect.top, gap, window.innerHeight - height - gap);
      modal.style.left = left + 'px';
      modal.style.top = top + 'px';
      modal.style.width = width + 'px';
      modal.style.height = height + 'px';
      _gbInstallModalResizeEdges(modal);
    });
  });
}

function _gbFindResizableModals(node) {
  const result = [];
  if (node?.matches?.(_GB_RESIZABLE_MODAL_SELECTOR) && !_gbIsMobileDialogSheetModal(node)) result.push(node);
  node?.querySelectorAll?.(_GB_RESIZABLE_MODAL_SELECTOR).forEach(modal => {
    if (!_gbIsMobileDialogSheetModal(modal)) result.push(modal);
  });
  return result;
}

// モーダル表示後にサイズを固定し、4辺+4隅でリサイズできるようにする
function _gbResizableModalMutationFilter(mutation) {
  return Array.from(mutation.addedNodes || []).some(node => {
    if (node?.nodeType !== 1) return false;
    return node.matches?.(_GB_RESIZABLE_MODAL_SELECTOR) || !!node.querySelector?.(_GB_RESIZABLE_MODAL_SELECTOR);
  });
}
function _gbResizableModalMutationCallback(mutations) {
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (node.nodeType !== 1) continue;
      _gbFindResizableModals(node).forEach(_gbPrepareResizableModal);
    }
  }
}
if (window.GBMutationBus) {
  window.GBMutationBus.subscribe('gb-app-resizable-modals', {
    filter: _gbResizableModalMutationFilter,
    callback: _gbResizableModalMutationCallback,
    throttle: 30,
  });
} else {
  new MutationObserver(_gbResizableModalMutationCallback).observe(document.body, { childList: true, subtree: true });
}
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
if (localStorage.getItem('note-vertical') === '1') {
  document.getElementById('page-content')?.classList.add('vertical-writing');
  const btn = document.getElementById('btn-note-vertical');
  if (btn) {
    // 上の replaceIcons() は既に実行済みなので、ここで lucide() を直接呼んで SVG を埋め込む
    btn.innerHTML = (typeof lucide === 'function') ? lucide('textAlignStart', 16) : '<span class="ico ico-textAlignStart"></span>';
    btn.title = '横書きに戻す';
    btn.classList.add('active');
  }
}
// ノート余白復元
if (typeof applyNoteMargin === 'function') applyNoteMargin();
if (typeof applyNoteContentMaxWidth === 'function') applyNoteContentMaxWidth();
// UIスケール復元
document.documentElement.style.fontSize = ''; // 旧font-sizeスケーリングをクリア
{
  const saved = localStorage.getItem('ui-scale');
  if (saved !== null) {
    // ユーザーが手動設定済み（または前回の自動設定値） → そのまま適用
    const s = parseInt(saved, 10) || 100;
    applyUIScale(s);
  } else {
    // 初回起動: 画面サイズから最適スケールを自動決定
    const autoScale = _detectOptimalScale();
    applyUIScale(autoScale);
    localStorage.setItem('ui-scale', String(autoScale));
  }
}

// ステータスバー表示状態復元
try {
  if (typeof applyStatusbarHidden === 'function') {
    applyStatusbarHidden(localStorage.getItem('meldex-statusbar-hidden') === '1');
  }
} catch (e) { console.warn('ステータスバー状態復元失敗:', e); }

function _detectOptimalScale() {
  const w = window.screen.width;
  const dpr = window.devicePixelRatio || 1;
  const isTouch = navigator.maxTouchPoints > 0;

  // スマホ（幅768px以下）: 100%のまま（レスポンシブCSSに任せる）
  if (w <= 768) return 100;
  // タブレット + タッチデバイス（幅769〜1366px）: タッチ操作のためやや拡大
  if (w <= 1366 && isTouch) return 110;
  // 高解像度デスクトップ（4K等、OS側のスケーリングが低い場合）
  if (w >= 2560 && dpr <= 1.5) return 125;
  // 通常デスクトップ
  return 100;
}

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
