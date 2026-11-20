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

// HTML ビューワーのナビゲーション。外部URLのiframe履歴は同一オリジン制約で
// 状態を安全に読めないため、Meldexから明示的に開いたURLだけを管理する。
function _gbMoveHtmlViewerHistory(delta) {
  const nextIndex = _gbHtmlViewerHistory.index + delta;
  if (nextIndex < 0 || nextIndex >= _gbHtmlViewerHistory.entries.length) {
    _gbUpdateHtmlViewerNavButtons();
    return false;
  }
  const nextUrl = _gbHtmlViewerHistory.entries[nextIndex];
  if (!_gbSetHtmlViewerSrc(nextUrl, null, { skipHistory: true })) return false;
  _gbHtmlViewerHistory.index = nextIndex;
  _gbUpdateHtmlViewerNavButtons();
  return true;
}
function htmlNavBack() { return _gbMoveHtmlViewerHistory(-1); }
function htmlNavForward() { return _gbMoveHtmlViewerHistory(1); }
function htmlNavigate(url) { if (!url) return; _gbSetHtmlViewerSrc(url); }
function htmlRefresh() { const f = _gbPrepareUntrustedIframe(document.getElementById('html-iframe')); if (f) try { f.contentWindow.location.reload(); } catch { f.src = f.src; } }
_gbUpdateHtmlViewerNavButtons();

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
    document.querySelectorAll('.gb-context-menu').forEach(m => {
      if (m._isPopupChildTarget?.(e.target)) return;
      if (m._popupChildSelector && e.target?.closest?.(m._popupChildSelector)) return;
      if (typeof m._requestClose === 'function') m._requestClose();
      else m.remove();
    });
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
    if (typeof m._requestClose === 'function') { hasDialogMenu = true; m._requestClose(); return; }
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
const _loadingGroups = new Map();
const _iframeLoadingTrackers = new Map();

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
    const current = Object.prototype.hasOwnProperty.call(options, 'loading')
      ? options.loading : options.key != null
        ? _loadingOperations.find(lease => lease.group.key === options.key)
        : _loadingOperations[_loadingOperations.length - 1];
    if (!current?.active) return;
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

// A lease belongs to one invocation; a keyed group is the one visible task.
// Repeated starts for the same target share its bar until every lease ends.
function showLoading(msg, opts) {
  const options = opts || {};
  const key = options.key ?? Symbol('loading');
  let group = _loadingGroups.get(key);
  if (!group) {
    const label = _loadingText(msg);
    const common = _commonLoadingProgress();
    group = { key, label, refs: 0, operation: common?.begin({
      kind: 'loading', label, mode: 'indeterminate', background: false,
      delayMs: 300, showInTray: true, priority: 40,
    }) || null };
    _loadingGroups.set(key, group);
  }
  group.refs++;
  const lease = {
    active: true, group,
    getState: () => group.operation?.getState() || { label: group.label },
    update: patch => { if (lease.active) { group.label = patch.label || group.label; group.operation?.update(patch); } },
    showNow: () => { if (lease.active) group.operation?.showNow(); },
  };
  _loadingOperations.push(lease);
  _loadingCount = _loadingOperations.length;
  _loadingMessage = group.label;
  if (!group.operation) {
    if (_loadingVisible) _renderLoadingUi(_loadingMessage);
    else if (!_loadingTimer) _loadingTimer = setTimeout(() => {
      _loadingTimer = null;
      if (_loadingCount > 0) _renderLoadingUi(_loadingMessage);
    }, 300);
  }
  return lease;
}

function hideLoading(lease) {
  // No-argument calls retain legacy stack semantics. An explicit missing or
  // already completed lease must never dismiss another invocation's task.
  const current = arguments.length ? lease : _loadingOperations[_loadingOperations.length - 1];
  if (!current?.active) return;
  const index = _loadingOperations.indexOf(current);
  if (index < 0) return;
  _loadingOperations.splice(index, 1);
  current.active = false;
  const group = current.group;
  if (--group.refs === 0) {
    _loadingGroups.delete(group.key);
    group.operation?.succeed({ dismissMs: 0 });
  }
  _loadingCount = _loadingOperations.length;
  _loadingMessage = _loadingOperations[_loadingCount - 1]?.group.label || '';
  if (_loadingCount === 0) {
    clearTimeout(_loadingTimer);
    _loadingTimer = null;
    if (_loadingVisible) _hideLoadingUi();
  } else if (_loadingVisible) _renderLoadingUi(_loadingMessage);
}

function hideLoadingMessage(msg) {
  const expected = _loadingText(msg);
  const current = [..._loadingOperations].reverse().find(lease => lease.getState()?.label === expected);
  if (!current) return false;
  hideLoading(current);
  return true;
}

function trackIframeLoading(iframe, msg, opts) {
  const options = opts || {};
  if (!iframe) return;
  // A replaced iframe with the same id is still the same visible loading slot.
  const key = iframe.id || iframe;
  _iframeLoadingTrackers.get(key)?.();
  if (options.silent || options.skipGlobalUi) return;
  const loading = showLoading(msg || 'ビューアを読み込み中...', { key });
  let done = false;
  let timer = null;
  const finish = () => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    iframe.removeEventListener('load', finish);
    iframe.removeEventListener('error', finish);
    if (_iframeLoadingTrackers.get(key) === finish) _iframeLoadingTrackers.delete(key);
    hideLoading(loading);
  };
  _iframeLoadingTrackers.set(key, finish);
  iframe.addEventListener('load', finish);
  iframe.addEventListener('error', finish);
  timer = setTimeout(finish, Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000);
}

// サーバーへの定期ハートビート（exe版: ブラウザ閉じたらサーバー自動終了用）
let _heartbeatTimer = null;
let _heartbeatInFlight = null;
let _webclipDirectoryRevision = null;

function _isHeartbeatCloudMode() {
  return window.MeldexRuntimeAdapter?.isBrowserDataMode?.()
    || document.body?.dataset?.cloudMode === 'dropbox'
    || document.body?.dataset?.cloudMode === 'browser';
}

// クイックメモ・Xブックマーク・Xアカウントの保存先シートへ、選んだシートテンプレートを
// 適用する（保存の完了は本体の定期確認で受け取る）。適用済みのシートは記録で飛ばされる。
let _importSheetChangesRevision = null;
function _applyImportSheetChangeTemplates(state) {
  const revision = typeof state?.revision === 'string' ? state.revision : '';
  if (!revision || revision === _importSheetChangesRevision) return;
  const applyMany = window.MeldexImportSheetTemplates?.applyMany;
  if (typeof applyMany !== 'function') return;
  _importSheetChangesRevision = revision;
  const byImporter = new Map();
  (Array.isArray(state.items) ? state.items : []).forEach(item => {
    if (!item?.importer || !item?.path) return;
    if (!byImporter.has(item.importer)) byImporter.set(item.importer, []);
    byImporter.get(item.importer).push(item.path);
  });
  byImporter.forEach((paths, importer) => {
    Promise.resolve(applyMany(importer, paths)).catch(error => {
      console.warn('[Meldex] インポート先シートへテンプレートを適用できませんでした', importer, error);
    });
  });
}

function _sendHeartbeat() {
  if (_heartbeatInFlight) return _heartbeatInFlight;
  _heartbeatInFlight = fetch('/api/heartbeat', { method: 'POST' })
    .then(response => response.ok ? response.json() : null)
    .then(async data => {
      _applyImportSheetChangeTemplates(data?.import_sheet_changes);
      const revision = data?.webclip_directory_revision;
      if (typeof revision !== 'string') return;
      const changedSheetPaths = Array.isArray(data?.webclip_changed_sheet_paths)
        ? data.webclip_changed_sheet_paths : [];
      const applyChangedSheetTemplates = async () => {
        if (!changedSheetPaths.length) return true;
        const applyMany = window.MeldexImportSheetTemplates?.applyMany;
        if (typeof applyMany !== 'function') return false;
        await applyMany('web-clipper', changedSheetPaths);
        return true;
      };
      if (_webclipDirectoryRevision === null) {
        if (!(await applyChangedSheetTemplates())) return;
        _webclipDirectoryRevision = revision;
        return;
      }
      if (_webclipDirectoryRevision === revision) return;
      const isCurrent = () => {
        const active = typeof document === 'undefined' ? null : document.activeElement;
        const input = active?.closest?.('input, textarea, [contenteditable="true"]');
        const controls = ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'hidden', 'image'];
        return !(active?.isContentEditable || input && !controls.includes(input.type));
      };
      // Recheck after asynchronous tree refresh, too: editing can start meanwhile.
      if (!isCurrent()) return;
      let result;
      if (typeof window.refreshFolderAfterExternalChange === 'function') {
        result = await window.refreshFolderAfterExternalChange({ isCurrent });
      } else if (typeof refreshOutliner === 'function') {
        result = await refreshOutliner({ force: true, coalesce: true, reason: 'webclip-directory-change' });
      } else return;
      if (result === false || Array.isArray(result) && result.some(row => row?.status === 'rejected')) return;
      if (!(await applyChangedSheetTemplates())) return;
      _webclipDirectoryRevision = revision;
    })
    .catch(() => {})
    .finally(() => { _heartbeatInFlight = null; });
  return _heartbeatInFlight;
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
