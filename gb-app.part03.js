// timeline-view(カレンダー)へのD&Dドロップ（ファイルから新規イベント作成）
{
  const tv = document.getElementById('timeline-view');
  if (tv) tv.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('application/x-meldex-node') && state.view === 'timeline') e.preventDefault();
  });
  if (tv) tv.addEventListener('drop', (e) => {
    if (state.view !== 'timeline') return;
    const cfData = e.dataTransfer.getData('application/x-meldex-node');
    if (!cfData) return;
    e.preventDefault();
    try {
      const { name, path } = JSON.parse(cfData);
      // 詳細パネルにイベント編集を表示（タイトルにファイル名、リンク付き）
      const now = new Date();
      const startVal = now.toISOString().substring(0, 16);
      const endH = new Date(now.getTime() + 3600000);
      const endVal = endH.toISOString().substring(0, 16);
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
  if (mv) mv.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('application/x-meldex-node')) {
      // Ctrl+ドラッグ時のみmain-viewsレベルで受け付け（ファイルを開く）
      // 通常時は各ビュー固有のdragoverに委ねる
      if (e.ctrlKey && state.view !== 'board') e.preventDefault();
    }
  });
  if (mv) mv.addEventListener('drop', (e) => {
    // Ctrl+ドロップ: ファイルをパネルで開く
    if (!e.ctrlKey) return; // 通常ドロップは各ビュー固有ハンドラに委ねる
    if (state.view === 'board') return;
    const cfData = e.dataTransfer.getData('application/x-meldex-node');
    if (!cfData) return;
    e.preventDefault();
    try {
      const { name, path, type } = JSON.parse(cfData);
      const navType = type === 'database' ? 'pivot' : type === 'board' ? 'board' : (type || 'page');
      navOpen({ type: navType, label: name, path });
    } catch {}
  });
}

// Phase D: HTMLビューワー(viewer.html)のiframe通信のみ残存
// canvas/calendarのpostMessageはPhase Cで直接関数呼び出しに変換済み
function _isTrustedEmbeddedMessage(e) {
  if (!e || e.origin !== window.location.origin) return false;
  const iframe = (typeof _getActiveIframe === 'function') ? _getActiveIframe() : document.getElementById('html-iframe');
  return !!(iframe?.contentWindow && e.source === iframe.contentWindow);
}

window.addEventListener('message', (e) => {
  if (!_isTrustedEmbeddedMessage(e)) return;
  const msg = e.data;
  if (!msg || !msg.type) return;
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
    }).catch(() => {});
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
  if (!openOpts.bridgeLoad) showLoading('ボードを読み込み中...');
  try {
    if (!openOpts.skipStateView) state.view = 'board';
    state.currentBoardPath = path;
    if (!openOpts.skipHistoryScope && typeof historySetScope === 'function') historySetScope('');
    if (!openOpts.skipShowView) showView('board');
    const currentTitleEl = document.getElementById('current-title');
    if (currentTitleEl && !openOpts.skipGlobalUi) currentTitleEl.textContent = label;
    if (!openOpts.skipSaveLastView) saveLastView({type:'board', label, path});
    if (!openOpts.skipNavPush) {
      const _navEntry = {type:'board', label, path};
      navPush(_navEntry);
    }
    if (!openOpts.skipRecent) addRecent(label, path, 'board');
    if (!openOpts.skipHighlight) highlightOutlinerNode(path);
    if (!openOpts.skipAutoVersion) startAutoVersion(path, 'file');
    if (typeof bdOpenBoard === 'function') await bdOpenBoard(label, path);
  } catch (err) {
    showStatus('ボード読み込みエラー: ' + (err.message || err), true);
  } finally { if (!openOpts.bridgeLoad) hideLoading(); }
}

function openMedia(label, path, type, opts) {
  const openOpts = opts || {};
  if (!openOpts.skipStateView) state.view = 'media';
  if (!openOpts.skipShowView) showView('media');
  const mediaTitleEl = document.getElementById('media-title');
  if (mediaTitleEl) mediaTitleEl.textContent = label;
  const currentTitleEl = document.getElementById('current-title');
  if (currentTitleEl && !openOpts.skipGlobalUi) currentTitleEl.textContent = label;
  if (!openOpts.skipSaveLastView) saveLastView({type:'media', label, path, mediaType: type});
  if (!openOpts.skipNavPush) {
    const _navEntry = {type:'media', label, path, mediaType: type};
    navPush(_navEntry);
  }
  if (!openOpts.skipRecent) addRecent(label, path, 'media');
  if (!openOpts.skipHighlight) highlightOutlinerNode(path);
  // 詳細パネルにファイル情報を表示
  if (!openOpts.skipGlobalUi && typeof _showFileInfoInDetailPanel === 'function') _showFileInfoInDetailPanel(path);
  // ビューワーペインを更新
  state.currentPagePath = path;
  const container = document.getElementById('media-content');
  const url = API_BASE + '/file-raw?path=' + encodeURIComponent(path);
  if (type === 'image') {
    openViewer('/viewer?file=' + encodeURIComponent(path), openOpts);
    return;
  } else if (!container) {
    return;
  } else if (type === 'video') {
    container.innerHTML = '<video src="' + esc(url) + '" controls style="max-width:100%;max-height:80vh;border-radius:4px;">動画を再生できません</video>';
  } else if (type === 'audio') {
    container.innerHTML = '<div style="text-align:center;padding:40px;">' + lucide('audio',48) + '<br><audio src="' + esc(url) + '" controls style="margin-top:16px;width:400px;">音声を再生できません</audio></div>';
  }
  if (!openOpts.skipGlobalUi) showStatus(type + ': ' + label);
}

function openCalendarFile(label, path, opts) {
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
  return selectDatabase(path, null, opts);
}

const _GB_UNTRUSTED_IFRAME_SANDBOX = 'allow-scripts allow-forms allow-popups allow-downloads';
const _GB_EXTERNAL_HTML_IFRAME_SANDBOX = _GB_UNTRUSTED_IFRAME_SANDBOX + ' allow-same-origin';

function _gbHtmlIframeSandboxForUrl(rawUrl) {
  const text = String(rawUrl || '').trim();
  if (!text) return _GB_UNTRUSTED_IFRAME_SANDBOX;
  try {
    const parsed = new URL(text, window.location.origin);
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
  if (!openOpts.skipStateView) state.view = 'html';
  if (!openOpts.skipShowView) showView('html');
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
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!modal.isConnected || modal.dataset.gbResizableModal === '1') return;
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
  if (node?.matches?.(_GB_RESIZABLE_MODAL_SELECTOR)) result.push(node);
  node?.querySelectorAll?.(_GB_RESIZABLE_MODAL_SELECTOR).forEach(modal => result.push(modal));
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
  const payload = JSON.stringify(body || {});
  try {
    fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
    return;
  } catch {}
  if (method === 'POST' && navigator.sendBeacon) {
    try {
      navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
    } catch {}
  }
}

window.addEventListener('beforeunload', (e) => {
  // ノート: 未保存の自動保存タイマーが残っている場合、即座に保存
  if (window._noteAutoSaveTimer) {
    clearTimeout(window._noteAutoSaveTimer);
    const pc = document.getElementById('page-content');
    const currentPath = pc?.dataset?.path;
    if (currentPath) {
      const md = htmlToMd(pc?.innerHTML || '');
      const fm = pc.dataset.frontmatter || '';
      const full = fm ? fm + md : md;
      _sendUnloadJson(API_BASE + '/file?path=' + encodeURIComponent(currentPath), 'POST', { content: full, skip_if_missing: true });
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
      _sendUnloadJson(url, isEntry ? 'PUT' : 'POST', body);
    }
  }
  // キャンバス: 未保存タイマーが残っている場合
  if (window._bdTimer && typeof bd !== 'undefined' && bd.dirty && bd.path && typeof bdToMd === 'function') {
    clearTimeout(window._bdTimer);
    if (typeof _bdCanSaveCurrentBoardPath !== 'function' || _bdCanSaveCurrentBoardPath(bd.path)) {
      _sendUnloadJson(API_BASE + '/file?path=' + encodeURIComponent(bd.path), 'POST', { content: bdToMd(), skip_if_missing: true });
    }
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
  let newIdx;
  if (idx === -1) {
    // 現在値がステップ外の場合、最も近いステップを探す
    newIdx = steps.reduce((best, v, i) => Math.abs(v - cur) < Math.abs(steps[best] - cur) ? i : best, 0);
  } else {
    newIdx = e.deltaY < 0 ? Math.min(idx + 1, steps.length - 1) : Math.max(idx - 1, 0);
  }
  if (steps[newIdx] !== cur) {
    const applied = applyUIScale(steps[newIdx]);
    if (applied !== cur) showStatus('表示サイズ: ' + applied + '%');
  }
}, { passive: false });

// モバイルツールメニュー（トップバー折りたたみ時）
function showMobileToolMenu(e) {
  document.querySelectorAll('.mobile-tool-menu').forEach(el => el.remove());
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
  menu.style.cssText = 'position:fixed;z-index:999;max-height:80vh;overflow-y:auto;';
  items.forEach(it => {
    if (!it) { const sep = document.createElement('div'); sep.style.cssText = 'height:1px;background:var(--border);margin:4px 0;'; menu.appendChild(sep); return; }
    const row = document.createElement('div');
    row.className = 'gb-context-menu-item';
    row.textContent = it.label;
    row.addEventListener('click', () => { menu.remove(); try { it.action(); } catch {} });
    menu.appendChild(row);
  });
  document.body.appendChild(menu);
  const btn = e.target.closest('button') || e.target;
  const br = btn.getBoundingClientRect();
  { const z = _getZoom(); menu.style.left = Math.max(4, Math.min(br.left / z, window.innerWidth / z - menu.offsetWidth - 4)) + 'px'; menu.style.top = (br.bottom / z + 2) + 'px'; }
  setTimeout(() => { document.addEventListener('pointerdown', function cl(ev) { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', cl); } }); }, 0);
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
  if (!e.target.closest('.gb-context-menu')) {
    document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
  }
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
  }
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
  if (_loadingCount === 0) {
    clearTimeout(_loadingTimer);
    _loadingTimer = null;
    _loadingMessage = '';
    _hideLoadingUi();
  }
}

function trackIframeLoading(iframe, msg, opts) {
  const options = opts || {};
  if (!iframe || options.bridgeLoad || options.silent) return;
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
  return window.MeldexRuntimeAdapter?.isDropboxMode?.() || document.body?.dataset?.cloudMode === 'dropbox';
}

function _sendHeartbeat() {
  fetch('/api/heartbeat', { method: 'POST' }).catch(() => {});
}

function _startHeartbeat() {
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
    _startHeartbeat();
    return;
  }
  if (document.hidden === true) _stopHeartbeat();
  else _startHeartbeat();
}

document.addEventListener('visibilitychange', _syncHeartbeatForVisibility);
if (document.body && typeof MutationObserver !== 'undefined') {
  new MutationObserver(_syncHeartbeatForVisibility).observe(document.body, {
    attributes: true,
    attributeFilter: ['data-cloud-mode'],
  });
}
_syncHeartbeatForVisibility();
