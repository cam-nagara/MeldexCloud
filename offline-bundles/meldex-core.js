/* meldex-core.part01.js */
/**
 * Meldex Core Library
 * 共通ユーティリティ・アイコン・テーマ・API通信
 * Meldex.html, calendar.html, canvas.html 等から共有利用
 *
 * 使い方: <script src="meldex-core.js"></script>
 * グローバルに関数・定数を公開（Meldex.htmlとの互換性のため）
 */

// ============================================================
// API通信
// ============================================================
const API_BASE = window.MeldexRuntimeAdapter?.getApiBaseUrl?.() || '/api';
const API_FETCH_BROWSE_CACHE_TTL_MS = 2500;
const API_FETCH_TIMEOUT_MS = 15000; // fetch()がハングし続け、フォルダツリー等が無限ロードになるのを防ぐ上限
const _apiFetchBrowseCache = new Map();
const _apiFetchBrowseInFlight = new Map();
let _apiFetchBrowseCacheGeneration = 0;

function _apiFetchMethod(opts) {
  return String(opts?.method || 'GET').toUpperCase();
}

function _apiFetchClonePayload(payload) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(payload); } catch {}
  }
  try { return JSON.parse(JSON.stringify(payload)); } catch { return payload; }
}

function _apiFetchBrowseCacheKey(path, opts) {
  if (_apiFetchMethod(opts) !== 'GET' || opts?.body != null || opts?.skipBrowseCache === true || opts?.cache === 'reload' || opts?.signal) return '';
  try {
    const url = new URL(API_BASE.replace(/\/+$/, '') + path, window.location.origin || 'http://localhost');
    const apiBasePath = new URL(API_BASE, window.location.origin || 'http://localhost').pathname.replace(/\/+$/, '');
    if (url.pathname !== apiBasePath + '/browse') return '';
    const params = [...url.searchParams.entries()]
      .sort(([ak, av], [bk, bv]) => (ak + '=' + av).localeCompare(bk + '=' + bv));
    return url.pathname + '?' + params.map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value)).join('&');
  } catch {
    return '';
  }
}

function _apiFetchInvalidateBrowseCache() {
  _apiFetchBrowseCacheGeneration += 1;
  _apiFetchBrowseCache.clear();
  _apiFetchBrowseInFlight.clear();
}

async function apiFetch(path, opts) {
  const cacheKey = _apiFetchBrowseCacheKey(path, opts);
  const cacheGeneration = _apiFetchBrowseCacheGeneration;
  if (!cacheKey && _apiFetchMethod(opts) !== 'GET') _apiFetchInvalidateBrowseCache();
  if (cacheKey) {
    const cached = _apiFetchBrowseCache.get(cacheKey);
    if (cached && Date.now() - cached.at < API_FETCH_BROWSE_CACHE_TTL_MS) {
      return _apiFetchClonePayload(cached.payload);
    }
    _apiFetchBrowseCache.delete(cacheKey);
    const inFlight = _apiFetchBrowseInFlight.get(cacheKey);
    if (inFlight) return _apiFetchClonePayload(await inFlight);
  }
  let requestPromise = null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_FETCH_TIMEOUT_MS);
  try {
    requestPromise = (async () => {
      const fetchOpts = opts ? { ...opts, signal: controller.signal } : { signal: controller.signal };
      const res = await fetch(API_BASE.replace(/\/+$/, '') + path, fetchOpts);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return await res.json();
    })();
    if (cacheKey) _apiFetchBrowseInFlight.set(cacheKey, requestPromise);
    const payload = await requestPromise;
    if (cacheKey && cacheGeneration === _apiFetchBrowseCacheGeneration) {
      _apiFetchBrowseCache.set(cacheKey, { at: Date.now(), payload: _apiFetchClonePayload(payload) });
      while (_apiFetchBrowseCache.size > 80) {
        const firstKey = _apiFetchBrowseCache.keys().next().value;
        if (!firstKey) break;
        _apiFetchBrowseCache.delete(firstKey);
      }
    }
    return _apiFetchClonePayload(payload);
  } catch (e) {
    if (e.name === 'AbortError') {
      // タイムアウト/中断はエラートースト表示せず、コンソールログのみに留める（呼び出し元は再試行等で処理する）
      try { console.warn('[apiFetch] timed out or aborted:', path); } catch {}
      const err = new Error('リクエストがタイムアウトしました');
      err.name = 'AbortError';
      err.isTimeout = true;
      throw err;
    }
    if (!opts?.silentError && typeof showStatus === 'function') showStatus('エラー: ' + e.message, true);
    throw e;
  } finally {
    clearTimeout(timeoutId);
    if (cacheKey && _apiFetchBrowseInFlight.get(cacheKey) === requestPromise) _apiFetchBrowseInFlight.delete(cacheKey);
  }
}

async function apiPut(path, body) {
  return apiFetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function apiPost(path, body, options = {}) {
  return apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(options || {}),
  });
}

async function apiDelete(path) {
  return apiFetch(path, { method: 'DELETE' });
}

// OSネイティブの「ファイルを開く」ダイアログを表示し、選択されたパスを返す（キャンセル時は空文字列）
async function openFileDialog(title, initialdir, filetypes) {
  const resp = await apiPost('/open-file-dialog', { title, initialdir, filetypes });
  return resp?.path || '';
}

// ============================================================
// ユーティリティ
// ============================================================
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// UI共通ルール: 外部から取り込む操作は download、外部へ出す操作は upload を使う。
const UI_TRANSFER_ICON_NAMES = Object.freeze({
  import: 'download',
  export: 'upload',
});
function uiTransferIconName(kind) {
  return UI_TRANSFER_ICON_NAMES[kind] || '';
}
function uiTransferIcon(kind, size) {
  const name = uiTransferIconName(kind);
  return name && typeof lucide === 'function' ? lucide(name, size || 14) : '';
}

// DOM 要素の安全な値設定ヘルパー（要素が未レンダリング時に null 参照で落ちないように）
function _safeSetValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
  return el;
}
function _safeSetText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
  return el;
}
function _safeSetHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
  return el;
}
function _safeSetDisplay(id, display) {
  const el = document.getElementById(id);
  if (el) el.style.display = display;
  return el;
}
function _safeSetSrc(id, src) {
  const el = document.getElementById(id);
  if (el) el.src = src;
  return el;
}

// ポップアップメニューをビューポート内に収める共通ユーティリティ
// CSS zoom 補正値を取得（zoom: 1.25 → 1.25）
function _getZoom() {
  return parseFloat(document.documentElement.style.zoom) || 1;
}

let _meldexViewportRefreshRaf = 0;
function _isMeldexDesktopRootZoomDisabled() {
  // 旧WebView回避用の互換フック。ChromeアプリモードではMeldex内UI倍率を許可する。
  return false;
}
function _clearMeldexRootZoomForDesktop(root) {
  // 互換フック。デスクトップ起動でもroot zoomは維持する。
}
function _setMeldexRootStyleProperty(root, name, value) {
  const next = String(value);
  if (root.style.getPropertyValue(name) !== next) {
    root.style.setProperty(name, next);
  }
}
function updateMeldexViewportSize() {
  const root = document.documentElement;
  if (!root) return;
  _clearMeldexRootZoomForDesktop(root);
  const zoom = Math.max(0.1, Number(_getZoom()) || 1);
  const innerHeight = Math.max(1, Math.round(
    window.innerHeight || document.documentElement?.clientHeight || 1
  ));
  _setMeldexRootStyleProperty(root, '--meldex-layout-zoom', String(zoom));
  _setMeldexRootStyleProperty(root, '--meldex-inverse-layout-zoom', String(1 / zoom));
  _setMeldexRootStyleProperty(root, '--meldex-window-inner-height', innerHeight + 'px');
}
function scheduleMeldexViewportSizeUpdate() {
  if (_meldexViewportRefreshRaf) return;
  const requestFrame = window.requestAnimationFrame
    ? window.requestAnimationFrame.bind(window)
    : ((fn) => setTimeout(fn, 0));
  _meldexViewportRefreshRaf = requestFrame(() => {
    _meldexViewportRefreshRaf = 0;
    updateMeldexViewportSize();
  });
}
updateMeldexViewportSize();
window.addEventListener('resize', scheduleMeldexViewportSizeUpdate, { passive: true });
window.addEventListener('orientationchange', scheduleMeldexViewportSizeUpdate, { passive: true });
window.visualViewport?.addEventListener('resize', scheduleMeldexViewportSizeUpdate, { passive: true });
document.addEventListener('DOMContentLoaded', scheduleMeldexViewportSizeUpdate, { once: true });
window.addEventListener('load', scheduleMeldexViewportSizeUpdate, { once: true });

function clampPopupToViewport(el) {
  const z = _getZoom();
  const vw = window.innerWidth / z, vh = window.innerHeight / z;
  const MARGIN = 4;
  // ポップアップ自体がビューポートより大きければ先にサイズを制限（スクロール可能に）
  const raw0 = el.getBoundingClientRect();
  const w0 = raw0.width / z, h0 = raw0.height / z;
  if (h0 > vh - MARGIN * 2) {
    el.style.maxHeight = (vh - MARGIN * 2) + 'px';
    el.style.overflowY = 'auto';
  }
  if (w0 > vw - MARGIN * 2) {
    el.style.maxWidth = (vw - MARGIN * 2) + 'px';
    el.style.overflowX = 'auto';
  }
  // サイズ制限後の実測
  const raw = el.getBoundingClientRect();
  const r = { left: raw.left / z, right: raw.right / z, top: raw.top / z, bottom: raw.bottom / z, width: raw.width / z, height: raw.height / z };
  const usesRight = el.style.right && !el.style.left;
  if (r.right > vw - MARGIN) {
    if (usesRight) el.style.right = MARGIN + 'px';
    else el.style.left = Math.max(MARGIN, vw - r.width - MARGIN) + 'px';
  }
  if (r.bottom > vh - MARGIN) el.style.top = Math.max(MARGIN, vh - r.height - MARGIN) + 'px';
  if (r.left < MARGIN) {
    if (usesRight) el.style.right = Math.max(MARGIN, vw - r.width - MARGIN) + 'px';
    else el.style.left = MARGIN + 'px';
  }
  if (r.top < MARGIN) el.style.top = MARGIN + 'px';
  // 再計算して二段階クランプ（重要: 右端に寄せた後に左がはみ出るケース）
  const raw2 = el.getBoundingClientRect();
  const r2 = { left: raw2.left / z, right: raw2.right / z, top: raw2.top / z, bottom: raw2.bottom / z, width: raw2.width / z, height: raw2.height / z };
  if (r2.left < MARGIN && !usesRight) el.style.left = MARGIN + 'px';
  if (r2.top < MARGIN) el.style.top = MARGIN + 'px';
}

// D&D 時のカーソル追従プレビュー（ドラッグ画像）を低不透明度にするヘルパー。
// 既定のドラッグ画像は半透明でドロップインジケータを隠しやすく、
// さらに OS カーソル（特に窓外ドロップ時の禁止マーク）と重なって見づらいため、
// クローンをラッパー div で包み、カーソル位置から padding ぶんオフセットして配置する。
function setLowOpacityDragImage(e, sourceEl, opacity) {
  if (!e || !e.dataTransfer || typeof e.dataTransfer.setDragImage !== 'function') return;
  if (!sourceEl || !(sourceEl instanceof HTMLElement)) return;
  try {
    const rect = sourceEl.getBoundingClientRect();
    const pad = 18; // カーソルと可視プレビューの離隔（px）
    const clone = sourceEl.cloneNode(true);
    clone.classList.remove('dragging');
    clone.style.margin = '0';
    clone.style.boxShadow = 'none';
    clone.style.position = 'absolute';
    clone.style.left = pad + 'px';
    clone.style.top = pad + 'px';
    clone.style.width = rect.width + 'px';
    clone.style.height = rect.height + 'px';
    // ラッパーの opacity を効かせて clone 側の background/color-mix に干渉されずに透過
    const wrap = document.createElement('div');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.cssText = [
      'position:fixed',
      'top:-10000px',
      'left:-10000px',
      'width:' + (rect.width + pad) + 'px',
      'height:' + (rect.height + pad) + 'px',
      'opacity:' + (opacity != null ? opacity : 0.35) + ' !important',
      'pointer-events:none',
      'background:transparent',
      'overflow:visible',
    ].join(';');
    wrap.appendChild(clone);
    document.body.appendChild(wrap);
    // カーソルホットポイントをラッパーの (0,0) に指定 → 可視部分は pad だけオフセット
    e.dataTransfer.setDragImage(wrap, 0, 0);
    // dragstart 完了後にラッパーを破棄（Chrome が snapshot を取った後に消す）
    setTimeout(() => { try { wrap.remove(); } catch {} }, 0);
  } catch {}
}
if (typeof window !== 'undefined') window.setLowOpacityDragImage = setLowOpacityDragImage;

// 窓外ドロップ判定ヘルパー: dragend 時の screenX/Y と現在のウィンドウ境界を比較し、
// 外側なら true を返す。ESC キャンセル時は screenX/Y が 0,0 になるので除外。
function isDragDroppedOutsideWindow(e) {
  if (!e) return false;
  if (e.dataTransfer && e.dataTransfer.dropEffect !== 'none') return false;
  if (e.screenX === 0 && e.screenY === 0) return false;
  const winLeft = window.screenX != null ? window.screenX : (window.screenLeft || 0);
  const winTop = window.screenY != null ? window.screenY : (window.screenTop || 0);
  const winRight = winLeft + (window.outerWidth || window.innerWidth || 0);
  const winBottom = winTop + (window.outerHeight || window.innerHeight || 0);
  return e.screenX < winLeft || e.screenX > winRight
      || e.screenY < winTop || e.screenY > winBottom;
}
if (typeof window !== 'undefined') window.isDragDroppedOutsideWindow = isDragDroppedOutsideWindow;

// 単一タブ窓として items を URL で開く共通ヘルパー（タブ/ツリー/folder-view 共用）。
// items: [{ name, path, type }] 形式。type はURL復元側が処理できる名称に正規化する。
// 単一窓モード（?single=1）で開くことで、新規窓ではサイドバー等が隠れ、
// その item の内容だけが表示される。
function _singleTabOpenTypeForItem(item) {
  const type = item?.type || '';
  if (typeof _normalizeOpenTypeForNav === 'function') return _normalizeOpenTypeForNav(type);
  if (type === 'database') return 'pivot';
  if (type === 'scenario') return 'scriptnote';
  return type || 'page';
}
function buildSingleTabWindowUrl(item) {
  if (!item || !item.path) return '';
  const openType = _singleTabOpenTypeForItem(item);
  if (window.MeldexResourceUrl?.appEntry) {
    return window.MeldexResourceUrl.appEntry({
      single: 1,
      open: openType,
      path: item.path,
      label: item.name || '',
    });
  }
  return '/Meldex.html?single=1&open=' + encodeURIComponent(openType)
    + '&path=' + encodeURIComponent(item.path)
    + '&label=' + encodeURIComponent(item.name || '');
}
function openItemsAsSingleTabWindows(items) {
  if (!Array.isArray(items)) return 0;
  let opened = 0;
  items.forEach((it) => {
    const url = buildSingleTabWindowUrl(it);
    if (!url) return;
    if (typeof _open_app_window_js === 'function') _open_app_window_js(url);
    else window.open(url, '_blank', 'width=1000,height=700,menubar=no,toolbar=no,location=no');
    opened += 1;
  });
  return opened;
}
if (typeof window !== 'undefined') {
  window.buildSingleTabWindowUrl = buildSingleTabWindowUrl;
  window.openItemsAsSingleTabWindows = openItemsAsSingleTabWindows;
}

// ホバー開閉サブメニューを独立ポップアップとして表示するヘルパー
// 親メニューの overflow/スクロールや zoom 環境でも見切れない
// panelEl は最初は hidden（display:none）で、class '.gb-context-menu' を付けておくこと
// （closeTreeContextMenu 等の一括削除対象になる）
function attachHoverSubmenu(triggerEl, panelEl) {
  let hideTimer = null;
  const clearHide = () => { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } };
  const show = () => {
    clearHide();
    if (panelEl.parentElement !== document.body) document.body.appendChild(panelEl);
    panelEl.style.position = 'fixed';
    panelEl.style.zIndex = '10002';
    panelEl.style.left = ''; panelEl.style.right = ''; panelEl.style.top = '';
    panelEl.style.maxWidth = ''; panelEl.style.maxHeight = '';
    panelEl.style.overflowX = ''; panelEl.style.overflowY = '';
    panelEl.style.display = 'block';
    const rect = triggerEl.getBoundingClientRect();
    const z = _getZoom();
    panelEl.style.left = (rect.right / z) + 'px';
    panelEl.style.top = (rect.top / z - 4) + 'px';
    clampPopupToViewport(panelEl);
    // 右端で見切れる場合は trigger の左側に反転
    const pr = panelEl.getBoundingClientRect();
    const vw = window.innerWidth / z;
    if (pr.right / z > vw - 4) {
      panelEl.style.left = Math.max(4, (rect.left / z) - (pr.width / z)) + 'px';
      clampPopupToViewport(panelEl);
    }
  };
  const hide = () => {
    clearHide();
    hideTimer = setTimeout(() => { panelEl.style.display = 'none'; }, 200);
  };
  triggerEl.addEventListener('mouseenter', show);
  triggerEl.addEventListener('mouseleave', hide);
  panelEl.addEventListener('mouseenter', clearHide);
  panelEl.addEventListener('mouseleave', hide);
}

// 全てのポップアップ要素にclampPopupToViewportを自動適用する安全網
// body直下に追加された position:fixed/absolute の要素を監視し自動クランプ
(function _setupAutoClampObserver() {
  const POPUP_SELECTORS = [
    '.gb-context-menu', '.status-dropdown', '.ab-dropdown', '.cell-inline-dd',
    '.modal-overlay', '.tree-menu', '.dd-menu', '.color-picker-popup',
    '.stamp-picker', '.col-header-menu', '.cal-popover',
    '.gb-fmt-popup', '.gb-palette-popup', '.bd-style-manager-popup',
    '.db-picker-popup', '.gb-dock-popup', '.cmd-palette'
  ];
  const observed = new WeakSet();
  const pending = new WeakSet();
  const shouldAutoClamp = (el) => {
    if (!(el instanceof HTMLElement)) return false;
    // modal-overlayは全画面なのでクランプ不要
    if (el.classList.contains('modal-overlay')) return false;
    // クランプ対象クラスに一致するか
    try {
      if (el.matches(POPUP_SELECTORS.join(','))) {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' || cs.position === 'absolute') return true;
      }
    } catch {}
    return false;
  };
  const scheduleClamp = (node) => {
    if (!(node instanceof HTMLElement) || pending.has(node)) return;
    pending.add(node);
    requestAnimationFrame(() => {
      pending.delete(node);
      if (!node.isConnected) {
        if (resizeObserver) resizeObserver.unobserve(node);
        return;
      }
      if (shouldAutoClamp(node)) clampPopupToViewport(node);
    });
  };
  const observePopup = (node) => {
    if (!shouldAutoClamp(node)) return;
    scheduleClamp(node);
    if (!resizeObserver || observed.has(node)) return;
    observed.add(node);
    resizeObserver.observe(node);
  };
  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver((entries) => {
        entries.forEach(entry => scheduleClamp(entry.target));
      })
    : null;
  const observer = new MutationObserver((records) => {
    for (const rec of records) {
      for (const node of rec.addedNodes) {
        observePopup(node);
        if (node instanceof HTMLElement) {
          node.querySelectorAll?.(POPUP_SELECTORS.join(','))?.forEach(observePopup);
        }
      }
    }
  });
  const startObserver = () => observer.observe(document.body, { childList: true });
  if (document.body) startObserver();
  else document.addEventListener('DOMContentLoaded', startObserver);
})();

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

let _saveDialogQueue = [];
let _saveDialogActive = false;

function _isSaveSuccessStatusMessage(msg, isError, options) {
  if (isError || options?.skipSaveDialog || options?.passiveSave) return false;
  if (!options?.showSaveDialog) return false;
  const text = String(msg || '');
  if (!text.includes('保存')) return false;
  if (/失敗|キャンセル|中止|できません|未保存|保存する|保存先|保存ダイアログ/.test(text)) return false;
  if (/既に保存済み/.test(text)) return false;
  return /保存しました|保存完了/.test(text);
}

function _drainSaveDialogQueue() {
  if (_saveDialogActive) return;
  const item = _saveDialogQueue[0];
  if (!item) return;
  if (typeof cfAlert !== 'function') {
    item.retries = (item.retries || 0) + 1;
    if (item.retries <= 20) {
      setTimeout(_drainSaveDialogQueue, 50);
      return;
    }
    _saveDialogQueue.shift();
    if (typeof alert === 'function') {
      alert(item.message);
      item.resolve(true);
    } else {
      item.resolve(false);
    }
    _drainSaveDialogQueue();
    return;
  }
  _saveDialogActive = true;
  _saveDialogQueue.shift();
  Promise.resolve(cfAlert(item.message, { okLabel: item.options?.okLabel || 'OK' }))
    .catch(() => {})
    .finally(() => {
      _saveDialogActive = false;
      _drainSaveDialogQueue();
      item.resolve(true);
    });
}

function _queueSaveDialog(message, options = {}) {
  const text = String(message || '保存しました');
  return new Promise(resolve => {
    _saveDialogQueue.push({ message: text, options, resolve, retries: 0 });
    _drainSaveDialogQueue();
  });
}

function showSaveDialog(message, options = {}) {
  const text = String(message || '保存しました');
  if (options.status !== false) showStatus(text, false, { skipSaveDialog: true });
  return _queueSaveDialog(text, options);
}

let _mobileStatusToastTimer = 0;
function _isMobileStatusToastNeeded() {
  const status = document.getElementById('status-bar');
  if (!status) return false;
  const width = Math.min(window.innerWidth || 0, document.documentElement?.clientWidth || window.innerWidth || 0);
  if (width > 0 && width <= 768) return true;
  try {
    return getComputedStyle(status).display === 'none';
  } catch {
    return false;
  }
}

function _showMobileStatusToast(text, isError) {
  if (!text || !document.body || !_isMobileStatusToastNeeded()) return;
  let toast = document.getElementById('gb-mobile-status-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'gb-mobile-status-toast';
    toast.setAttribute('aria-atomic', 'true');
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.dataset.statusKind = isError ? 'error' : 'success';
  toast.setAttribute('role', isError ? 'alert' : 'status');
  toast.setAttribute('aria-live', isError ? 'assertive' : 'polite');
  toast.classList.add('is-visible');
  clearTimeout(_mobileStatusToastTimer);
  _mobileStatusToastTimer = setTimeout(() => {
    if (toast.textContent === text) toast.classList.remove('is-visible');
  }, isError ? 5000 : 3500);
}

function showStatus(msg, isError, options) {
  const el = document.getElementById('sb-msg');
  const text = String(msg || '');
  if (!el) {
    console.log((isError ? 'ERROR: ' : '') + text);
    if (_isSaveSuccessStatusMessage(text, isError, options)) _queueSaveDialog(text);
    return;
  }
  el.textContent = text;
  el.style.color = isError ? 'var(--red)' : 'var(--fg2)';
  if (text) {
    el.dataset.statusKind = isError ? 'error' : 'success';
    el.setAttribute('aria-label', (isError ? 'エラー: ' : '状態: ') + text);
  } else {
    delete el.dataset.statusKind;
    el.removeAttribute('aria-label');
  }
  _showMobileStatusToast(text, !!isError);
  if (isError) {
    setTimeout(() => {
      if (el.textContent === text) {
        el.textContent = '';
        delete el.dataset.statusKind;
        el.removeAttribute('aria-label');
      }
    }, 5000);
  } else if (_isSaveSuccessStatusMessage(text, isError, options)) {
    _queueSaveDialog(text);
  }
}

function getCssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function rgbToHex(rgb) {
  if (!rgb || rgb.startsWith('#')) return rgb || '#000000';
  const m = rgb.match(/(\d+)/g);
  if (!m || m.length < 3) return '#000000';
  return '#' + m.slice(0,3).map(n => parseInt(n).toString(16).padStart(2,'0')).join('');
}

// ============================================================
// 定数
// ============================================================
const FILE_TYPE_LABELS = {
  folder: 'フォルダ', database: 'シート', pivot: 'シート', page: 'ノート', scenario: '旧シナリオ', scriptnote: 'シナリオ', board: 'ボード', calendar: 'カレンダー',
  entity: 'ページ', 'smart-db': 'スマートシート', chat: 'チャット',
  image: '画像', video: '動画', audio: '音声', html: 'HTML', csv: 'CSV',
  psd: 'Photoshop', clip: 'CLIP STUDIO', '3d': '3D', document: '文書',
  archive: 'アーカイブ', app: 'アプリ', unknown: 'ファイル',
};

const NATIVE_TYPES = new Set(['page','board','calendar','image','video','audio','html','csv','database','entity','folder','scriptnote','smart-db','scenario','chat']);

const PALETTE_COLORS = [
  '#ffffff','#d4d4d4','#ababab','#808080','#545454','#2b2b2b','#000000',
  '#cf9b9b','#cfc39b','#b4cf9b','#9bcfaa','#9bcccf','#9ba4cf','#b89bcf','#cf9bbd',
  '#9e4f4f','#9e8c4f','#759e4f','#4f9e65','#4f9a9e','#4f5e9e','#7c4f9e','#9e4f84',
  '#4f2828','#4f4628','#3b4f28','#284f33','#284d4f','#282f4f','#3e284f','#4f2842',
];

const PALETTE_BG_COLORS = [
  '#544040','#544940','#545040','#445440','#40544c','#404c54','#434054','#504054',
  '#493232','#493d32','#494632','#394932','#32493f','#323d49','#393249','#463249',
  '#3d2c2c','#3d342c','#3d3a2c','#313d2c','#2c3d35','#2c343d','#312c3d','#3a2c3d',
];

// ============================================================
// Lucide Icons (ISC License)
// ============================================================
const LUCIDE = {
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  moreHorizontal: '<circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/><circle cx="5" cy="12" r="1" fill="currentColor"/>',
  moreVertical: '<circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="5" r="1" fill="currentColor"/><circle cx="12" cy="19" r="1" fill="currentColor"/>',
  folderPen: '<path d="M8.4 10.6a2 2 0 0 1 3 3L6 19l-4 1 1-4Z"/><path d="M2 11.5V5a2 2 0 0 1 2-2h3.9a2 2 0 0 0 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9.5"/>',
  folderTree: '<path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M3 5a2 2 0 0 0 2 2h3"/><path d="M3 3v13a2 2 0 0 0 2 2h3"/>',
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  page: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  db: '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
  scenario: '<path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/>',
  sync: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  filePlus: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/><path d="M12 18v-6"/>',
  menu: '<path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h16"/>',
  mousePointer: '<path d="M12.586 12.586 19 19"/><path d="M3.688 3.037a.497.497 0 0 0-.651.651l6.5 15.999a.501.501 0 0 0 .947-.062l1.569-6.083a2 2 0 0 1 1.448-1.479l6.124-1.579a.5.5 0 0 0 .063-.947z"/>',
  creditCard: '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
  spline: '<circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><path d="M5 17A12 12 0 0 1 17 5"/>',
  funnel: '<path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"/>',
  panelLeft: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  panelRight: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  type: '<path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/>',
  typeOutline: '<path d="M14 16.5a.5.5 0 0 0 .5.5h.5a2 2 0 0 1 0 4H9a2 2 0 0 1 0-4h.5a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5V8a2 2 0 0 1-4 0V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 1-4 0v-.5a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5Z"/>',
  trash2: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  command: '<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0 0-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  entry: '<rect x="2" y="6" width="20" height="12" rx="2"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  table: '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/><path d="M8 7h6"/>',
  board: '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M12 8v4"/><path d="M8 16l4-4"/><path d="M16 16l-4-4"/>',
  brush: '<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>',
  penTool: '<path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z"/><path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18"/><path d="m2.3 2.3 7.286 7.286"/><circle cx="11" cy="11" r="2"/>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  fileText: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  disc: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2"/>',
  fileQuestion: '<path d="M12 17h.01"/><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M9.1 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3"/>',
  layoutGrid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  layoutList: '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
  externalLink: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  columns: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  refreshCw: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  rotateCcw: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  minus: '<path d="M5 12h14"/>',
  arrowLeftS: '<path d="m15 18-6-6 6-6"/>',
  arrowRightS: '<path d="m9 18 6-6-6-6"/>',
  hash: '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
  checkSquare: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  tags: '<path d="m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4L17 19"/><path d="M9.586 5.586A2 2 0 0 0 8.172 5H3a1 1 0 0 0-1 1v5.172a2 2 0 0 0 .586 1.414L8.29 18.29a2.426 2.426 0 0 0 3.42 0l3.58-3.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="6.5" cy="9.5" r=".5" fill="currentColor"/>',
  link2: '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>',
  alignLeft: '<line x1="21" x2="3" y1="6" y2="6"/><line x1="15" x2="3" y1="12" y2="12"/><line x1="17" x2="3" y1="18" y2="18"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  sigma: '<path d="M18 6H7.5l4.244 6L7.5 18H18"/>',
  messageSquare: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
  highlighter: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  eraser: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  lasso: '<path d="M7 22a5 5 0 0 1-2-4"/><path d="M7 16.93c.96.43 1.96.74 2.99.91"/><path d="M3.34 14A6.8 6.8 0 0 1 2 10c0-4.42 4.48-8 10-8s10 3.58 10 8-4.48 8-10 8a12 12 0 0 1-3.34-.46"/>',
  stickyNote: '<path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/>',
  clipboardList: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  crosshair: '<circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/>',
  save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
  folderOpen: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  gitBranch: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  // Phase 1: テンプレート/チャート用アイコン
  barChart2: '<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>',
  layoutTemplate: '<rect width="18" height="7" x="3" y="3" rx="1"/><rect width="9" height="7" x="3" y="14" rx="1"/><rect width="5" height="7" x="16" y="14" rx="1"/>',
  lightbulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  mapPin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  bookOpen: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  package: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7"/><path d="m7.5 4.27 9 5.15"/>',
  skull: '<circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><path d="M8 20v2h8v-2"/><path d="m12.5 17-.5-1-.5 1h1z"/><path d="M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20"/>',
  alertTriangle: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  rows3: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  layoutDashboard: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  databaseSearch: '<ellipse cx="12" cy="5.5" rx="9" ry="3.5"/><path d="M3 12a9 3.5 0 0 0 5.16 3.18"/><path d="M3 5.5v13c0 1.93 4.03 3.5 9 3.5"/><path d="M21 5.5v4"/><circle cx="17.5" cy="16.5" r="3.5"/><path d="m21 20-1.5-1.5"/>',
  presentation: '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>',
  messagesSquare: '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4c0-1.1.9-2 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
  galleryThumbnails: '<rect width="18" height="14" x="3" y="3" rx="2"/><path d="M4 21h1"/><path d="M9 21h1"/><path d="M14 21h1"/><path d="M19 21h1"/>',
  clapperboard: '<path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  // v5.23: アイコン統一で追加
  settings2: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  slidersHorizontal: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  messageCircle: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  unlock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  circleAlert: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  circleX: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronUp: '<path d="m18 15-6-6-6 6"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  starOff: '<path d="M8.34 8.34 2 9.27l5 4.87L5.82 21 12 17.77 18.18 21l-.59-3.43"/><path d="M18.42 12.76 22 9.27l-6.91-1L12 2l-1.44 2.91"/><line x1="2" x2="22" y1="2" y2="22"/>',
  gripVertical: '<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
  maximize2: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/>',
  minimize2: '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" x2="21" y1="10" y2="3"/><line x1="3" x2="10" y1="21" y2="14"/>',
  square: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
  circle: '<circle cx="12" cy="12" r="10"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  helpCircle: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/>',
  circleDot: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>',
  circlePlus: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  ellipsis: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  arrowUpDown: '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  tvMinimal: '<rect width="18" height="14" x="3" y="3" rx="2"/><path d="M4 21h1"/><path d="M9 21h1"/><path d="M14 21h1"/><path d="M19 21h1"/>',
  lockOpen: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  // アイコン整備 v0.5.130（icon-implementation-plan §1）
  bookOpenText: '<path d="M12 7v14"/><path d="M16 12h2"/><path d="M16 8h2"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/><path d="M6 12h2"/><path d="M6 8h2"/>',
  folderDot: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><circle cx="12" cy="13" r="1"/>',
  folderOpenDot: '<path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/><circle cx="14" cy="15" r="1"/>',
  alignHorizontalJustifyStart: '<rect width="6" height="14" x="6" y="5" rx="2"/><rect width="6" height="10" x="16" y="7" rx="2"/><path d="M2 2v20"/>',
  alignHorizontalJustifyCenter: '<rect width="6" height="14" x="2" y="5" rx="2"/><rect width="6" height="10" x="16" y="7" rx="2"/><path d="M12 2v20"/>',
  alignHorizontalJustifyEnd: '<rect width="6" height="14" x="2" y="5" rx="2"/><rect width="6" height="10" x="12" y="7" rx="2"/><path d="M22 2v20"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  arrowDown: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  folderPlus: '<path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  // ツールバー統一 v0.5.131 (toolbar-unification-plan §4-2)
  bold: '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>',
  italic: '<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>',
  underline: '<path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" x2="20" y1="20" y2="20"/>',
  strikethrough: '<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/>',
  list: '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
  listOrdered: '<line x1="10" x2="21" y1="6" y2="6"/><line x1="10" x2="21" y1="12" y2="12"/><line x1="10" x2="21" y1="18" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  quote: '<path d="M16 3a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2v-4a2 2 0 0 1 2-2V5a4 4 0 0 0-4 4v6a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"/><path d="M8 3a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6v-4a2 2 0 0 1 2-2V5a4 4 0 0 0-4 4v6a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"/>',
  heading: '<path d="M6 12h12"/><path d="M6 20V4"/><path d="M18 20V4"/>',
  wrapText: '<line x1="3" y1="6" x2="21" y2="6"/><path d="M3 12h15a3 3 0 1 1 0 6h-4"/><polyline points="16 16 14 18 16 20"/><line x1="3" y1="18" x2="10" y2="18"/>',
  calendarPlus: '<path d="M8 2v4"/><path d="M16 2v4"/><path d="M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8"/><path d="M3 10h18"/><path d="M16 19h6"/><path d="M19 16v6"/>',
  listChecks: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  zoomIn: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>',
  zoomOut: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  timer: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
  calendarDays: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>',
  calendarRange: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M3 10h18"/><path d="M8 2v4"/><path d="M17 14h-6"/><path d="M13 18H7"/><path d="M7 14h.01"/><path d="M17 18h.01"/>',
  bookmarkPlus: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/><line x1="12" x2="12" y1="7" y2="13"/><line x1="15" x2="9" y1="10" y2="10"/>',
  clipboardCheck: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  // 書式系追加 v0.5.147（書字方向・インデント・引用の専用アイコン）
  textAlignStart: '<path d="M15 12H3"/><path d="M17 18H3"/><path d="M21 6H3"/>',
  kanban: '<path d="M6 5v11"/><path d="M12 5v6"/><path d="M18 5v14"/>',
  indentIncrease: '<polyline points="3 8 7 12 3 16"/><line x1="21" x2="11" y1="12" y2="12"/><line x1="21" x2="11" y1="6" y2="6"/><line x1="21" x2="11" y1="18" y2="18"/>',
  textQuote: '<path d="M17 6H3"/><path d="M21 12H8"/><path d="M21 18H8"/><path d="M3 12v6"/>',
  pipette: '<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>',
};
// gb-icon-assets.js (hasLucideName) が独自アイコン (page / db / scenario 等) を
// 解決できるよう、curated LUCIDE を window に公開する。これが無いと
// GBIconAssets.render() がテキストフォールバックに落ちてボタンアイコンが壊れる。
if (typeof window !== 'undefined') window.LUCIDE = LUCIDE;

function lucide(name, size) {
  size = size || 14;
  let paths = LUCIDE[name];
  if (paths == null && typeof window !== 'undefined' && window.LUCIDE_FULL) {
    paths = window.LUCIDE_FULL[name];
  }
  paths = paths || '';
  return `<svg data-icon="${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;">${paths}</svg>`;
}

// メニュー選択状態アイコン
function radioMark(selected) {
  return selected ? '<span style="color:var(--accent);">' + lucide('check', 12) + '</span> ' : '　';
}

// サブメニュー展開矢印（▸の代替）
function submenuArrow() {
  return '<span style="float:right;opacity:0.5;margin-left:8px;line-height:1;">' + lucide('chevronRight', 10) + '</span>';
}

const UI_TYPE_ICONS = {
  folder: 'folder',
  database: 'db',
  entity: 'entry',
  page: 'page',
  scenario: 'scenario',
  scriptnote: 'bookOpenText',
  board: 'presentation',
  calendar: 'calendar',
  'smart-db': 'databaseSearch',
  preview: 'tvMinimal',
  detail: 'slidersHorizontal',
  info: 'info',
  chat: 'messagesSquare',
  tags: 'tags',
  annotation: 'stickyNote',
  sticky: 'clipboardList',
  history: 'history',
  media: 'galleryThumbnails',
  html: 'globe',
  csv: 'table',
  pivot: 'db',
  gallery: 'db',
  kanban: 'db',
  timeline: 'db',
  chart: 'db',
  graph: 'db',
  compare: 'columns',
  outliner: 'folderTree',
  welcome: 'folder',
};

function uiTypeIconName(type) {
  return UI_TYPE_ICONS[type] || '';
}

function fileTypeIcon(type, size) {
  const map = {
    image: 'image', video: 'video', audio: 'audio',
    psd: 'brush', clip: 'penTool', '3d': 'box', document: 'fileText',
    archive: 'archive', app: 'settings', unknown: 'fileQuestion',
  };
  return lucide(uiTypeIconName(type) || map[type] || 'fileQuestion', size || 36);
}

function replaceIcons(root) {
  const scope = root?.querySelectorAll ? root : document;
  scope.querySelectorAll('.ico').forEach(el => {
    const cls = el.className;
    let name = '';
    if (cls.includes('ico-folderTree')) name = 'folderTree';
    else if (cls.includes('ico-folderPen')) name = 'folderPen';
    else if (cls.includes('ico-folderOpen')) name = 'folderOpen';
    else if (cls.includes('ico-folder')) name = 'folder';
    else if (cls.includes('ico-page')) name = 'page';
    else if (cls.includes('ico-db')) name = 'db';
    else if (cls.includes('ico-scenario')) name = 'scenario';
    else if (cls.includes('ico-databaseSearch')) name = 'databaseSearch';
    else if (cls.includes('ico-command')) name = 'command';
    else if (cls.includes('ico-search')) name = 'search';
    else if (cls.includes('ico-bookOpenText')) name = 'bookOpenText';
    else if (cls.includes('ico-book')) name = 'book';
    else if (cls.includes('ico-download')) name = 'download';
    else if (cls.includes('ico-globe')) name = 'globe';
    else if (cls.includes('ico-upload')) name = 'upload';
    else if (cls.includes('ico-board')) name = 'presentation';
    else if (cls.includes('ico-preview') || cls.includes('ico-tvMinimal')) name = 'tvMinimal';
    else if (cls.includes('ico-detail')) name = 'slidersHorizontal';
    else if (cls.includes('ico-info')) name = 'info';
    else if (cls.includes('ico-settings2') || cls.includes('ico-slidersHorizontal')) name = 'slidersHorizontal';
    else if (cls.includes('ico-gear') || cls.includes('ico-settings')) name = 'settings';
    else if (cls.includes('ico-sync')) name = 'sync';
    else if (cls.includes('ico-panelRight')) name = 'panelRight';
    else if (cls.includes('ico-panelLeft')) name = 'panelLeft';
    else if (cls.includes('ico-layoutGrid')) name = 'layoutDashboard';
    else if (cls.includes('ico-layoutList')) name = 'layoutList';
    else if (cls.includes('ico-externalLink')) name = 'externalLink';
    else if (cls.includes('ico-filter')) name = 'filter';
    else if (cls.includes('ico-copy')) name = 'copy';
    else if (cls.includes('ico-arrowUpDown')) name = 'arrowUpDown';
    else if (cls.includes('ico-arrowUp')) name = 'arrowUp';
    else if (cls.includes('ico-arrowDown')) name = 'arrowDown';
    else if (cls.includes('ico-play')) name = 'play';
    else if (cls.includes('ico-refreshCw')) name = 'refreshCw';
    else if (cls.includes('ico-minus')) name = 'minus';
    else if (cls.includes('ico-columns3') || cls.includes('ico-columns')) name = 'columns';
    else if (cls.includes('ico-clock')) name = 'clock';
    else if (cls.includes('ico-arrowLeftS')) name = 'arrowLeftS';
    else if (cls.includes('ico-arrowRightS')) name = 'arrowRightS';
    else if (cls.includes('ico-pencil')) name = 'pencil';
    else if (cls.includes('ico-highlighter')) name = 'highlighter';
    else if (cls.includes('ico-lasso')) name = 'lasso';
    else if (cls.includes('ico-square')) name = 'square';
    else if (cls.includes('ico-eraser')) name = 'eraser';
    else if (cls.includes('ico-stickyNote')) name = 'stickyNote';
    else if (cls.includes('ico-clipboardList')) name = 'clipboardList';
    else if (cls.includes('ico-trash2')) name = 'trash2';
    else if (cls.includes('ico-crosshair')) name = 'crosshair';
    else if (cls.includes('ico-save')) name = 'save';
    else if (cls.includes('ico-bot')) name = 'bot';
    else if (cls.includes('ico-users')) name = 'users';
    else if (cls.includes('ico-user')) name = 'user';
    else if (cls.includes('ico-messagesSquare') || cls.includes('ico-messageSquare')) name = 'messagesSquare';
    else if (cls.includes('ico-paperclip')) name = 'paperclip';
    else if (cls.includes('ico-mic')) name = 'mic';
    else if (cls.includes('ico-fileText')) name = 'fileText';
    else if (cls.includes('ico-calendarPlus')) name = 'calendarPlus';
    else if (cls.includes('ico-calendarDays')) name = 'calendarDays';
    else if (cls.includes('ico-calendarRange')) name = 'calendarRange';
    else if (cls.includes('ico-calendar')) name = 'calendar';
    else if (cls.includes('ico-arrowRight')) name = 'arrowRight';
    else if (cls.includes('ico-arrowLeft')) name = 'arrowLeft';
    else if (cls.includes('ico-filePlus')) name = 'filePlus';
    else if (cls.includes('ico-plus')) name = 'plus';
    else if (cls.includes('ico-eyeOff')) name = 'eyeOff';
    else if (cls.includes('ico-eye')) name = 'eye';
    else if (cls.includes('ico-camera')) name = 'camera';
    else if (cls.includes('ico-gitBranch')) name = 'gitBranch';
    else if (cls.includes('ico-history')) name = 'history';
    else if (cls.includes('ico-x')) name = 'x';
    else if (cls.includes('ico-chevronDown')) name = 'chevronDown';
    else if (cls.includes('ico-chevronRight')) name = 'chevronRight';
    else if (cls.includes('ico-chevronLeft')) name = 'chevronLeft';
    else if (cls.includes('ico-lightbulb')) name = 'lightbulb';
    else if (cls.includes('ico-menu')) name = 'menu';
    else if (cls.includes('ico-checkSquare')) name = 'checkSquare';
    else if (cls.includes('ico-unlock')) name = 'unlock';
    else if (cls.includes('ico-lock')) name = 'lock';
    else if (cls.includes('ico-alignLeft')) name = 'alignLeft';
    else if (cls.includes('ico-helpCircle')) name = 'helpCircle';
    // ツールバー統一 v0.5.131 (toolbar-unification-plan §4-2)
    else if (cls.includes('ico-bold')) name = 'bold';
    else if (cls.includes('ico-italic')) name = 'italic';
    else if (cls.includes('ico-underline')) name = 'underline';
    else if (cls.includes('ico-strikethrough')) name = 'strikethrough';
    else if (cls.includes('ico-listOrdered')) name = 'listOrdered';
    else if (cls.includes('ico-list')) name = 'list';
    else if (cls.includes('ico-quote')) name = 'quote';
    else if (cls.includes('ico-heading')) name = 'heading';
    else if (cls.includes('ico-wrapText')) name = 'wrapText';
    else if (cls.includes('ico-listChecks')) name = 'listChecks';
    else if (cls.includes('ico-zoomIn')) name = 'zoomIn';
    else if (cls.includes('ico-zoomOut')) name = 'zoomOut';
    else if (cls.includes('ico-maximize')) name = 'maximize';
    else if (cls.includes('ico-timer')) name = 'timer';
    else if (cls.includes('ico-layoutTemplate')) name = 'layoutTemplate';
    else if (cls.includes('ico-rows3')) name = 'rows3';
    else if (cls.includes('ico-bookmarkPlus')) name = 'bookmarkPlus';
    else if (cls.includes('ico-bookmark')) name = 'bookmark';
    else if (cls.includes('ico-clipboardCheck')) name = 'clipboardCheck';
    else if (cls.includes('ico-disc')) name = 'disc';
    else if (cls.includes('ico-funnel')) name = 'funnel';
    else if (cls.includes('ico-type')) name = 'type';
    else if (cls.includes('ico-table')) name = 'table';
    // v0.5.147 書字方向・インデント・引用
    else if (cls.includes('ico-textAlignStart')) name = 'textAlignStart';
    else if (cls.includes('ico-kanban')) name = 'kanban';
    else if (cls.includes('ico-indentIncrease')) name = 'indentIncrease';
    else if (cls.includes('ico-textQuote')) name = 'textQuote';
    if (name) {
      // ツールバー内のアイコンは 16px に統一 (toolbar-unification-plan §2-2)
      const inToolbar = el.closest('.gb-toolbar, .tb-icon-btn, .tb-text-btn');
      const iconSize = inToolbar ? 16 : 18;
      el.innerHTML = lucide(name, iconSize);
      // ツールバー外の旧互換アイコンだけインラインサイズを補完する
      if (!inToolbar) {
        el.style.width = '18px';
        el.style.height = '18px';
        el.style.display = 'inline-block';
      }
    }
  });
}

// ============================================================
// テーマ
// ============================================================

// 親ウィンドウ（Meldex）からテーマを継承
function inheritParentTheme() {
  try {
    const parentComputed = window.parent.getComputedStyle(window.parent.document.documentElement);
    const themeVars = ['--bg', '--bg2', '--bg3', '--bg4', '--fg', '--fg2', '--accent', '--accent2', '--border', '--red', '--green', '--orange', '--blue', '--selection', '--ui-header-fg', '--ui-header-bg', '--ui-header-font', '--ui-toolbar-fg', '--ui-toolbar-bg', '--ui-toolbar-font', '--ui-muted-font', '--ui-hover-fg', '--ui-hover-bg', '--ui-fg-strong', '--ui-selection-fg', '--ui-selection-bg', '--ui-range-fill-bg', '--ui-range-track-bg', '--db-th-font', '--db-entity-font', '--db-cell-font'];
    themeVars.forEach(v => {
      const val = parentComputed.getPropertyValue(v).trim();
      if (val) document.documentElement.style.setProperty(v, val);
    });
  } catch(e) { /* cross-origin or same window */ }
}

// テーマをAPI経由で取得（iframe以外の単独起動用）
// テーマは editor-theme-name で管理されているため、meldex-theme-vars は不要
async function loadThemeFromServer() {
  try {
    const manager = window.MeldexThemeManager;
    if (!manager?.applyDefaultTheme) return;
    const themeId = typeof manager.getDefaultThemeId === 'function'
      ? manager.getDefaultThemeId()
      : (localStorage.getItem('meldex-default-theme-id') || localStorage.getItem('editor-theme-name') || '');
    manager.applyDefaultTheme(themeId, { silent: true, preserveStoredThemeUi: true, skipHistory: true });
  } catch (error) {
    try { console.warn('テーマを復元できませんでした', error); } catch {}
  }
}

// ============================================================
// 初期化ヘルパー
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  // 親がMeldexならテーマ継承、単独起動ならlocalStorageから復元
  if (window.parent !== window) {
    inheritParentTheme();
  } else {
    loadThemeFromServer();
  }
  // アイコン置換
  replaceIcons();
});

/* meldex-core.part02.js */
function closeColHeaderMenu() {
  document.querySelectorAll('.gb-context-menu').forEach(el => el.remove());
}

function _normalizeCoreAnnotationOpacity(value, fallback = 1) {
  const opacity = Number(value);
  if (!Number.isFinite(opacity)) return fallback;
  return Math.max(0, Math.min(1, opacity));
}

function _coreAnnotationDistanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  if (!dx && !dy) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function _coreAnnotationElementHit(el, x, y, tolerance = 10) {
  try {
    const point = new DOMPoint(x, y);
    if (typeof el.isPointInStroke === 'function' && el.isPointInStroke(point)) return true;
    if (typeof el.isPointInFill === 'function' && el.isPointInFill(point)) return true;
  } catch {}
  if (el?.tagName?.toLowerCase?.() === 'rect') {
    const rx = Number(el.getAttribute('x')) || 0;
    const ry = Number(el.getAttribute('y')) || 0;
    const rw = Number(el.getAttribute('width')) || 0;
    const rh = Number(el.getAttribute('height')) || 0;
    return x >= rx - tolerance && x <= rx + rw + tolerance && y >= ry - tolerance && y <= ry + rh + tolerance;
  }
  if (typeof el.getTotalLength === 'function' && typeof el.getPointAtLength === 'function') {
    try {
      const total = el.getTotalLength();
      const step = Math.max(4, total / 80);
      for (let pos = 0; pos <= total; pos += step) {
        const a = el.getPointAtLength(pos);
        const b = el.getPointAtLength(Math.min(total, pos + step));
        if (_coreAnnotationDistanceToSegment(x, y, a.x, a.y, b.x, b.y) <= tolerance) return true;
      }
    } catch {}
  }
  const points = (el.getAttribute('points') || '').trim().split(/\s+/)
    .map(pair => pair.split(',').map(Number))
    .filter(pair => Number.isFinite(pair[0]) && Number.isFinite(pair[1]));
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (b && _coreAnnotationDistanceToSegment(x, y, a[0], a[1], b[0], b[1]) <= tolerance) return true;
  }
  return false;
}

// ============================================================
// iframe内蔵メモエンジン
// ============================================================

/**
 * initIframeMarkup(): iframe内にメモオーバーレイを設置
 * 親からpostMessageでツール状態を受信し、描画結果を親に送信
 * 親側は ann-markup-sync / ann-markup-save で同期
 */
function initIframeMarkup(scrollContainer) {
  const _svgNS = 'http://www.w3.org/2000/svg';
  const _widthDefaults = { pen: 3, marker: 12, eraser: 14 };
  function _loadToolWidths() {
    try {
      const saved = JSON.parse(localStorage.getItem('meldex-ann-tool-widths') || '{}');
      return {
        pen: Math.max(1, Math.min(16, Number(saved.pen) || _widthDefaults.pen)),
        marker: Math.max(4, Math.min(40, Number(saved.marker) || _widthDefaults.marker)),
        eraser: Math.max(4, Math.min(48, Number(saved.eraser) || _widthDefaults.eraser)),
      };
    } catch { return { ..._widthDefaults }; }
  }
  let _ann = { active: false, tool: 'pen', color: '#c48080', opacity: 1, widths: _loadToolWidths(), drawing: false, path: [], pressures: [], targetPath: '' };

  // オーバーレイSVG作成
  const host = scrollContainer || document.body;
  const boardWorld = (host?.id === 'bd-canvas' || host?.dataset?.bdRole === 'canvas')
    ? (host.querySelector('[data-bd-role="world"]') || host.querySelector('#bd-world'))
    : null;
  const wrapper = boardWorld || host;
  const boardMode = !!boardWorld || wrapper?.id === 'bd-world' || wrapper?.dataset?.bdRole === 'world';
  if (host._annBridge) return host._annBridge;
  if (wrapper._annBridge) {
    if (host !== wrapper) host._annBridge = wrapper._annBridge;
    return wrapper._annBridge;
  }
  wrapper.style.position = wrapper.style.position || 'relative';
  const svg = document.createElementNS(_svgNS, 'svg');
  svg.id = 'iframe-ann-overlay';
  svg.setAttribute('style', 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:9999;pointer-events:none;overflow:visible;');
  const hitRect = document.createElementNS(_svgNS, 'rect');
  hitRect.setAttribute('width', '100%'); hitRect.setAttribute('height', '100%');
  hitRect.setAttribute('fill', 'transparent');
  svg.appendChild(hitRect);
  const layer = document.createElementNS(_svgNS, 'g');
  layer.id = 'iframe-ann-layer';
  svg.appendChild(layer);
  const notesLayer = document.createElement('div');
  notesLayer.className = 'ann-note-layer';
  notesLayer.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:10000;';
  wrapper.appendChild(svg);
  wrapper.appendChild(notesLayer);

  // SVGサイズ更新
  let _surfaceBounds = { left: 0, top: 0, width: 1, height: 1 };
  function _computeSurfaceBounds() {
    if (!boardMode) {
      return {
        left: 0,
        top: 0,
        width: Math.max(wrapper.scrollWidth || 0, wrapper.clientWidth || 0, 1),
        height: Math.max(wrapper.scrollHeight || 0, wrapper.clientHeight || 0, 1),
      };
    }
    const viewportW = Math.max(host.clientWidth || 0, host.offsetWidth || 0, 1);
    const viewportH = Math.max(host.clientHeight || 0, host.offsetHeight || 0, 1);
    const zoom = (typeof bd !== 'undefined') ? Math.max(0.1, bd.zoom || 1) : 1;
    const panX = (typeof bd !== 'undefined') ? (Number(bd.panX) || 0) : 0;
    const panY = (typeof bd !== 'undefined') ? (Number(bd.panY) || 0) : 0;
    let visibleLeft = -panX / zoom;
    let visibleTop = -panY / zoom;
    let visibleRight = visibleLeft + viewportW / zoom;
    let visibleBottom = visibleTop + viewportH / zoom;
    if (typeof host.getBoundingClientRect === 'function') {
      try {
        const r = host.getBoundingClientRect();
        const pts = [
          _boardClientToWorld(r.left, r.top),
          _boardClientToWorld(r.right, r.top),
          _boardClientToWorld(r.right, r.bottom),
          _boardClientToWorld(r.left, r.bottom),
        ].filter(pt => Number.isFinite(pt?.x) && Number.isFinite(pt?.y));
        if (pts.length) {
          visibleLeft = Math.min(...pts.map(pt => pt.x));
          visibleTop = Math.min(...pts.map(pt => pt.y));
          visibleRight = Math.max(...pts.map(pt => pt.x));
          visibleBottom = Math.max(...pts.map(pt => pt.y));
        }
      } catch (_) {}
    }
    const pad = 256;
    const left = Math.floor(Math.min(0, visibleLeft) - pad);
    const top = Math.floor(Math.min(0, visibleTop) - pad);
    const right = Math.ceil(Math.max(wrapper.scrollWidth || 0, wrapper.clientWidth || 0, visibleRight, viewportW / zoom) + pad);
    const bottom = Math.ceil(Math.max(wrapper.scrollHeight || 0, wrapper.clientHeight || 0, visibleBottom, viewportH / zoom) + pad);
    return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
  }
  function _applyNotePosition(note, data) {
    if (!note || !data) return;
    note.style.left = ((Number(data.x) || 0) - _surfaceBounds.left) + 'px';
    note.style.top = ((Number(data.y) || 0) - _surfaceBounds.top) + 'px';
  }
  function _boardClientToWorld(clientX, clientY) {
    const targetCanvas = host || wrapper;
    if (!targetCanvas) return { x: clientX, y: clientY };
    const local = (typeof bdClientToCanvasLocal === 'function')
      ? bdClientToCanvasLocal(clientX, clientY, targetCanvas)
      : (() => {
          const r = targetCanvas.getBoundingClientRect();
          return { x: clientX - r.left, y: clientY - r.top };
        })();
    let lx = local.x;
    let ly = local.y;
    if (typeof bd !== 'undefined' && bd.rotation) {
      const cx = targetCanvas.clientWidth / 2;
      const cy = targetCanvas.clientHeight / 2;
      lx -= cx;
      ly -= cy;
      const rad = -bd.rotation * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rx = lx * cos - ly * sin;
      const ry = lx * sin + ly * cos;
      lx = rx + cx;
      ly = ry + cy;
    }
    const zoom = (typeof bd !== 'undefined') ? Math.max(0.1, bd.zoom || 1) : 1;
    const panX = (typeof bd !== 'undefined') ? (Number(bd.panX) || 0) : 0;
    const panY = (typeof bd !== 'undefined') ? (Number(bd.panY) || 0) : 0;
    return { x: (lx - panX) / zoom, y: (ly - panY) / zoom };
  }
  function _updateSize() {
    _surfaceBounds = _computeSurfaceBounds();
    svg.style.left = _surfaceBounds.left + 'px';
    svg.style.top = _surfaceBounds.top + 'px';
    svg.style.width = _surfaceBounds.width + 'px';
    svg.style.height = _surfaceBounds.height + 'px';
    svg.setAttribute('viewBox', `${_surfaceBounds.left} ${_surfaceBounds.top} ${_surfaceBounds.width} ${_surfaceBounds.height}`);
    hitRect.setAttribute('x', _surfaceBounds.left);
    hitRect.setAttribute('y', _surfaceBounds.top);
    hitRect.setAttribute('width', _surfaceBounds.width);
    hitRect.setAttribute('height', _surfaceBounds.height);
    notesLayer.style.left = _surfaceBounds.left + 'px';
    notesLayer.style.top = _surfaceBounds.top + 'px';
    notesLayer.style.width = svg.style.width;
    notesLayer.style.height = svg.style.height;
    notesLayer.querySelectorAll('.ann-note-embedded').forEach(note => _applyNotePosition(note, note._annData));
  }
  const _resizeObs = new ResizeObserver(_updateSize);
  _resizeObs.observe(wrapper);
  if (host !== wrapper) _resizeObs.observe(host);
  _updateSize();

  // 描画関数
  function _pathD(pts) {
    if (pts.length < 2) return '';
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) d += ` L ${pts[i][0]} ${pts[i][1]}`;
    return d;
  }

  function _rectData(pts) {
    const a = pts?.[0] || [0, 0], b = pts?.[pts.length - 1] || a;
    const x1 = Number(a[0]) || 0, y1 = Number(a[1]) || 0, x2 = Number(b[0]) || 0, y2 = Number(b[1]) || 0;
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
  }

  function _applyRectEl(el, data, color, opacity, preview) {
    const normalizedOpacity = _normalizeMarkupOpacity(opacity, 1);
    el.setAttribute('x', Number(data?.x) || 0);
    el.setAttribute('y', Number(data?.y) || 0);
    el.setAttribute('width', Math.max(1, Number(data?.width) || 0));
    el.setAttribute('height', Math.max(1, Number(data?.height) || 0));
    el.setAttribute('fill', color);
    el.setAttribute('fill-opacity', String(normalizedOpacity * (preview ? 0.2 : 0.4)));
    el.setAttribute('stroke', color);
    el.setAttribute('stroke-width', '1');
    el.setAttribute('stroke-opacity', String(normalizedOpacity));
    if (preview) el.setAttribute('stroke-dasharray', '4,4');
    else el.removeAttribute('stroke-dasharray');
    return el;
  }

  function _toLocalCoords(clientX, clientY) {
    if (boardMode) {
      return _boardClientToWorld(clientX, clientY);
    }
    const r = wrapper.getBoundingClientRect();
    return { x: clientX - r.left + wrapper.scrollLeft, y: clientY - r.top + wrapper.scrollTop };
  }

  function _parentMessageTargetOrigin() {
    try {
      const origin = window.location?.origin || '';
      return origin && origin !== 'null' ? origin : '*';
    } catch {
      return '*';
    }
  }

  function _postToParent(message) {
    if (typeof window !== 'undefined' && window.parent) window.parent.postMessage(message, _parentMessageTargetOrigin());
  }

  function _drawWidth(tool, pressures, width) {
    const normalized = tool === 'stroke' ? 'pen' : tool;
    const base = Math.max(1, Number(width) || _ann.widths?.[normalized] || _widthDefaults[normalized] || 3);
    if (normalized === 'pen' && Array.isArray(pressures) && pressures.length) {
      const avg = pressures.reduce((a, b) => a + (Number(b) || 0), 0) / pressures.length;
      return Math.max(1, base * (0.5 + Math.max(0, Math.min(1, avg))));
    }
    return base;
  }

  function _normalizeMarkupOpacity(value, fallback = 1) {
    return _normalizeCoreAnnotationOpacity(value, fallback);
  }

  let _annLastSaveFailureAt = 0;
  function _reportMarkupSaveFailure(error, message = '注釈の保存に失敗しました') {
    const now = Date.now();
    if (typeof showStatus === 'function' && now - _annLastSaveFailureAt > 1500) {
      showStatus(message, true);
      _annLastSaveFailureAt = now;
    }
    try { console.warn(message, error); } catch {}
  }

  function _markupElementHit(el, x, y, tolerance = 10) {
    return _coreAnnotationElementHit(el, x, y, tolerance);
  }

  function _safeAnnotationHtml(html) {
    if (typeof _sanitizeAnnotationHtml === 'function') return _sanitizeAnnotationHtml(html);
    const template = document.createElement('template');
    template.innerHTML = html || '';
    template.content.querySelectorAll('script,style,iframe,object,embed').forEach(el => el.remove());
    template.content.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(attr => {
        if (/^on/i.test(attr.name) || attr.name === 'href' || attr.name === 'src') el.removeAttribute(attr.name);
      });
    });
    return template.innerHTML;
  }

  function _parseMarkupAnnotationData(item, message = '一部の注釈データを読み込めませんでした') {
    const raw = item?.data;
    if (raw == null || raw === '') return {};
    if (typeof raw !== 'string') return raw || {};
    try {
      return JSON.parse(raw) || {};
    } catch (error) {
      _reportMarkupSaveFailure(error, message);
      return null;
    }
  }

  function _annotationUser() {
    if (typeof getUsername === 'function') return getUsername();
    try { return JSON.parse(localStorage.getItem('meldex-user') || '{}').name || 'anonymous'; }
    catch { return 'anonymous'; }
  }

  function _saveBoardAnnotation(payload, onSaved, onError) {
    if (!boardMode || typeof apiPost !== 'function') return false;
    apiPost('/annotations', payload).then((res) => {
      if (res?.id && typeof _pushAnnotationCreateHistory === 'function') {
        const label = payload?.shape === 'sticky' || payload?.type === 'comment' ? '注釈: 付箋追加' : '注釈: 描画追加';
        _pushAnnotationCreateHistory(res.id, label, payload?.target_path || _ann.targetPath).catch(() => {});
      }
      onSaved?.(res);
    }).catch((error) => {
      _reportMarkupSaveFailure(error);
      onError?.(error);
    });
    return true;
  }

  function _updateBoardAnnotation(annId, payload, onSaved, onError) {
    if (!boardMode || !annId || typeof apiPut !== 'function') return false;
    const handleSaved = (res) => { onSaved?.(res); };
    const handleError = (error) => {
      _reportMarkupSaveFailure(error);
      onError?.(error);
    };
    if (typeof _putAnnotationWithHistory === 'function') {
      const label = Object.prototype.hasOwnProperty.call(payload || {}, 'color') ? '注釈: 色変更' : '注釈: 付箋更新';
      Promise.resolve(_putAnnotationWithHistory(annId, payload, label, annId)).then(handleSaved).catch(handleError);
    } else {
      apiPut('/annotations/' + encodeURIComponent(annId), payload).then(handleSaved).catch(handleError);
    }
    return true;
  }

  function _deleteBoardAnnotation(annId, onDeleted, onError) {
    if (!boardMode || !annId || typeof apiDelete !== 'function') return false;
    (async () => {
      const before = typeof _fetchAnnotationHistoryRow === 'function'
        ? await _fetchAnnotationHistoryRow(annId).catch(() => null)
        : null;
      await apiDelete('/annotations/' + encodeURIComponent(annId));
      if (typeof _pushAnnotationHistory === 'function') _pushAnnotationHistory('注釈: 削除', before, null, annId);
      onDeleted?.();
    })().catch((error) => {
      _reportMarkupSaveFailure(error, '注釈を削除できませんでした');
      onError?.(error);
    });
    return true;
  }

  function _noteText(editor) {
    return (editor?.innerText || '').replace(/\u00a0/g, ' ').trimEnd();
  }

  function _notePayload(data, editor, note) {
    return {
      ...data,
      text: _noteText(editor),
      html: _safeAnnotationHtml(editor?.innerHTML || ''),
      width: Math.max(120, Math.round(note.offsetWidth || data.width || 180)),
      height: Math.max(60, Math.round(note.offsetHeight || data.height || 100)),
    };
  }

  function _applyNoteColor(note, color) {
    const next = color || '#c48080';
    note.style.background = next;
    note.style.setProperty('--ann-note-color', next);
    note.style.setProperty('--ann-note-scroll-thumb', `color-mix(in srgb, ${next} 72%, var(--bg) 28%)`);
    note.style.setProperty('--ann-note-scroll-track', `color-mix(in srgb, ${next} 22%, transparent)`);
  }

  function _userIconHtml(username) {
    if (typeof getUserAvatarHtml === 'function') return getUserAvatarHtml(username || 'anonymous', 16);
    return typeof lucide === 'function' ? lucide('userRound', 12) : esc((username || '?').charAt(0).toUpperCase());
  }

  function _syncNoteInteractivity() {
    notesLayer.style.pointerEvents = 'none';
    notesLayer.querySelectorAll('.ann-note').forEach(note => {
      note.style.pointerEvents = _ann.active ? 'auto' : 'none';
    });
  }

  function _confirmEmbeddedNoteDelete(onOk) {
    const message = 'この付箋を削除しますか？';
    if (typeof showConfirmDialog === 'function') {
      showConfirmDialog(message, onOk);
      return;
    }
    if (typeof window.confirm !== 'function' || window.confirm(message)) onOk?.();
  }

  function _normalizeEmbeddedNoteIcon(button, size) {
    const svgIcon = button?.querySelector?.('svg');
    if (!svgIcon) return;
    svgIcon.setAttribute('width', String(size));
    svgIcon.setAttribute('height', String(size));
    svgIcon.style.width = size + 'px';
    svgIcon.style.height = size + 'px';
    svgIcon.style.display = 'block';
    svgIcon.style.flex = '0 0 ' + size + 'px';
  }

  function _createNoteEditor(data, scheduleSave, noteId) {
    const editor = document.createElement('div');
    editor.className = 'ann-note-editor';
    editor.contentEditable = 'true';
    if (noteId) editor.dataset.e2eId = `embedded-annotation-note-${noteId}-editor`;
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-multiline', 'true');
    if (data.html) editor.innerHTML = _safeAnnotationHtml(data.html);
    else editor.textContent = data.text || '';
    editor.addEventListener('input', scheduleSave);
    editor.addEventListener('blur', scheduleSave);
    editor.addEventListener('mouseup', () => _scheduleNoteSelectionPopup(editor, scheduleSave));
    editor.addEventListener('pointerup', () => _scheduleNoteSelectionPopup(editor, scheduleSave));
    editor.addEventListener('keyup', (event) => {
      if (event.shiftKey || ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'a', 'A'].includes(event.key)) {
        _scheduleNoteSelectionPopup(editor, scheduleSave);
      }
    });
    return editor;
  }

  let _noteSelectionPopupTimer = 0;

  function _scheduleNoteSelectionPopup(editor, scheduleSave) {
    clearTimeout(_noteSelectionPopupTimer);
    _noteSelectionPopupTimer = window.setTimeout(() => _showNoteSelectionPopup(editor, scheduleSave), 40);
  }

  function _noteSelectionRange(editor) {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    const root = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    if (!root || !editor.contains(root)) return null;
    const rects = Array.from(range.getClientRects()).filter(rect => rect.width || rect.height);
    const rect = rects[0] || range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return null;
    return { range, rect };
  }

  function _restoreNoteSelection(range) {
    const selection = window.getSelection?.();
    if (!selection || !range) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function _noteSelectionValues(range) {
    let el = range?.startContainer || null;
    if (el && el.nodeType !== Node.ELEMENT_NODE) el = el.parentElement;
    const computed = el ? getComputedStyle(el) : null;
    const queryState = command => {
      try { return !!document.queryCommandState(command); } catch { return false; }
    };
    const queryValue = command => {
      try { return document.queryCommandValue(command) || ''; } catch { return ''; }
    };
    const fontWeight = computed?.fontWeight || '';
    return {
      textColor: queryValue('foreColor') || computed?.color || '',
      fontSize: parseInt(computed?.fontSize || '', 10) || '',
      fontFamily: computed?.fontFamily || '',
      fontWeight: queryState('bold') || fontWeight === 'bold' || Number(fontWeight) >= 600 ? 'bold' : '',
      fontStyle: queryState('italic') || computed?.fontStyle === 'italic' ? 'italic' : '',
      bgColor: computed && !/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/i.test(computed.backgroundColor || '') ? computed.backgroundColor : '',
      leftAccent: /inset/i.test(computed?.boxShadow || ''),
      accentColor: computed?.textDecorationColor || '',
      underline: queryState('underline') || /underline/.test(computed?.textDecorationLine || computed?.textDecoration || ''),
      strike: queryState('strikeThrough') || /line-through/.test(computed?.textDecorationLine || computed?.textDecoration || ''),
    };
  }

  function _setNoteCommandState(command, enabled) {
    try {
      const current = !!document.queryCommandState(command);
      if (current !== !!enabled && typeof document.execCommand === 'function') document.execCommand(command, false, null);
    } catch {}
  }

  function _wrapNoteSelectionStyle(styles) {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const entries = Object.entries(styles || {});
    const clearKeys = entries.filter(([, value]) => value === '').map(([key]) => key);
    if (clearKeys.length) _clearNoteSelectionStyles(range, clearKeys);
    const setEntries = entries.filter(([, value]) => value != null && value !== '');
    if (!setEntries.length) return;
    const span = document.createElement('span');
    setEntries.forEach(([key, value]) => { span.style[key] = value; });
    if (!span.getAttribute('style')) return;
    try {
      range.surroundContents(span);
    } catch {
      const fragment = range.extractContents();
      span.appendChild(fragment);
      range.insertNode(span);
    }
    const nextRange = document.createRange();
    nextRange.selectNodeContents(span);
    selection.removeAllRanges();
    selection.addRange(nextRange);
  }

  function _clearNoteSelectionStyles(range, styleKeys) {
    if (!range || !styleKeys?.length) return;
    const roots = new Set();
    const addElement = (node) => {
      const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      if (el) roots.add(el);
    };
    addElement(range.startContainer);
    addElement(range.endContainer);
    const common = range.commonAncestorContainer?.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer?.parentElement;
    if (common) {
      const walker = document.createTreeWalker(common, NodeFilter.SHOW_ELEMENT);
      for (let el = walker.currentNode; el; el = walker.nextNode()) {
        try {
          if (range.intersectsNode(el)) roots.add(el);
        } catch {}
      }
    }
    roots.forEach(el => {
      styleKeys.forEach(key => {
        try { el.style[key] = ''; } catch {}
      });
      if (!el.getAttribute('style')) el.removeAttribute('style');
    });
  }

  function _applyNoteSelectionFormat(range, prop, value) {
    _restoreNoteSelection(range);
    if (prop === 'fontWeight') _setNoteCommandState('bold', value === 'bold');
    else if (prop === 'fontStyle') _setNoteCommandState('italic', value === 'italic');
    else if (prop === 'underline') _setNoteCommandState('underline', !!value);
    else if (prop === 'strike') _setNoteCommandState('strikeThrough', !!value);
    else if (prop === 'textColor') { try { document.execCommand('foreColor', false, value || '#333333'); } catch {} }
    else if (prop === 'bgColor') _wrapNoteSelectionStyle({ backgroundColor: value || '' });
    else if (prop === 'leftAccent') _wrapNoteSelectionStyle(value ? { boxShadow: 'inset 3px 0 0 currentColor', paddingLeft: '6px' } : { boxShadow: '', paddingLeft: '' });
    else if (prop === 'accentColor') _wrapNoteSelectionStyle({ textDecorationColor: value || '' });
    else if (prop === 'fontSize') {
      const size = Number(value);
      if (Number.isFinite(size) && size > 0) _wrapNoteSelectionStyle({ fontSize: Math.max(8, Math.min(96, size)) + 'px' });
    } else if (prop === 'fontFamily' && value) {
      _wrapNoteSelectionStyle({ fontFamily: value });
    }
  }

  function _showNoteSelectionPopup(editor, scheduleSave) {
    if (typeof openFormatPopup !== 'function') return;
    const info = _noteSelectionRange(editor);
    if (!info) return;
    const savedRange = info.range.cloneRange();
    const anchor = { getBoundingClientRect: () => info.rect };
    const values = _noteSelectionValues(info.range);
    // 文字色スウォッチのコントラスト背景に付箋本体の色 (--ann-note-color) を渡す。
    const noteEl = editor.closest?.('.ann-note');
    const noteColor = noteEl
      ? (noteEl.style.getPropertyValue('--ann-note-color')
         || noteEl.style.backgroundColor
         || getComputedStyle(noteEl).backgroundColor
         || '').trim()
      : '';
    if (noteColor) values.bgColor = noteColor;
    openFormatPopup(anchor, {
      positionAnchor: anchor,
      className: 'gb-fmt-popup--annotation-note',
      fields: ['textColor', 'fontSize', 'fontFamily', 'bold', 'italic', 'bgColor', 'leftAccent', 'accentColor', 'strike', 'underline'],
      values,
      onChange(prop, value) {
        _applyNoteSelectionFormat(savedRange, prop, value);
        scheduleSave();
      },
    });
  }

  function _installNoteResize(note, data, persist) {
    ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach(dir => {
      const handle = document.createElement('span');
      handle.className = 'ann-note-resize-handle';
      handle.dataset.dir = dir;
      handle.addEventListener('pointerdown', (e) => {
        if (!_ann.active) return;
        e.preventDefault();
        e.stopPropagation();
        note.classList.add('ann-note-selected');
        const startPt = _toLocalCoords(e.clientX, e.clientY);
        const start = { x: startPt.x, y: startPt.y, left: note.offsetLeft, top: note.offsetTop, width: note.offsetWidth, height: note.offsetHeight };
        const minW = 120, minH = 60;
        const onMove = (ev) => {
          const pt = _toLocalCoords(ev.clientX, ev.clientY);
          const dx = pt.x - start.x;
          const dy = pt.y - start.y;
          let left = start.left, top = start.top, width = start.width, height = start.height;
          if (dir.includes('e')) width = start.width + dx;
          if (dir.includes('s')) height = start.height + dy;
          if (dir.includes('w')) { width = start.width - dx; left = start.left + dx; }
          if (dir.includes('n')) { height = start.height - dy; top = start.top + dy; }
          if (width < minW) { if (dir.includes('w')) left -= minW - width; width = minW; }
          if (height < minH) { if (dir.includes('n')) top -= minH - height; height = minH; }
          note.style.left = left + 'px';
          note.style.top = top + 'px';
          note.style.width = width + 'px';
          note.style.height = height + 'px';
          data.x = left + _surfaceBounds.left;
          data.y = top + _surfaceBounds.top;
          data.width = Math.max(minW, Math.round(width));
          data.height = Math.max(minH, Math.round(height));
        };
        const onUp = () => {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          data.width = Math.max(minW, Math.round(note.offsetWidth));
          data.height = Math.max(minH, Math.round(note.offsetHeight));
          persist();
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
      });
      note.appendChild(handle);
    });
  }

  function _isEmbeddedStandaloneNoteItem(item, data) {
    if (!item || data?.deleted) return false;
    const type = String(item.type || '');
    const shape = String(item.shape || data?.shape || '');
    const hasPosition = data && (data.x != null || data.y != null || data.width != null || data.height != null);
    if (type === 'comment') {
      return shape === 'sticky' || data?.noteType === 'sticky' || hasPosition;
    }
    return type === 'note' || type === 'sticky';
  }

  function _renderNote(item, data) {
    if (!data) return null;
    const note = document.createElement('div');
    note.className = 'ann-note ann-note-embedded ' + (item.shape || 'sticky');
    note.dataset.annId = item.id || '';
    note._annData = data;
    _applyNotePosition(note, data);
    note.style.width = (data.width || 180) + 'px';
    note.style.height = (data.height || 100) + 'px';
    _applyNoteColor(note, item.color || '#c48080');
    note.style.opacity = item.opacity ?? 1;
    note.style.pointerEvents = _ann.active ? 'auto' : 'none';
    note.addEventListener('pointerdown', (e) => {
      // 右クリック/中クリックが bd-canvas の pointerdown ハンドラまで伝播すると
      // ボード側の右クリックメニュー (bdContextMenu) が付箋メニューと重なって
      // 出てしまうため、付箋内のポインター押下は親へ伝播させない。
      if (e.button !== 0) e.stopPropagation();
      notesLayer.querySelectorAll('.ann-note-selected').forEach(el => el.classList.remove('ann-note-selected'));
      note.classList.add('ann-note-selected');
    });

    const header = document.createElement('div');
    header.className = 'ann-note-header';
    const dateStr = item.created ? String(item.created).substring(0, 16).replace('T', ' ') : '';
    const displayUser = (item.user && item.user !== 'anonymous') ? item.user : (data.user || (typeof getUsername === 'function' ? getUsername() : item.user || 'anonymous'));
    const headerLabel = document.createElement('span');
    headerLabel.className = 'ann-note-user';
    const userIcon = document.createElement('span');
    userIcon.className = 'ann-user-icon';
    userIcon.innerHTML = _userIconHtml(displayUser);
    const userText = document.createElement('span');
    userText.className = 'ann-user-name';
    userText.textContent = `${displayUser || ''}${dateStr ? ' ' + dateStr : ''}`.trim();
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'ann-note-delete-btn';
    deleteBtn.dataset.annDelete = '1';
    deleteBtn.dataset.e2eId = `embedded-annotation-note-${item.id || 'pending'}-delete`;
    deleteBtn.setAttribute('aria-label', '注釈を削除');
    deleteBtn.title = '削除';
    deleteBtn.innerHTML = lucide('x', 12);
    _normalizeEmbeddedNoteIcon(deleteBtn, 12);
    headerLabel.appendChild(userIcon);
    headerLabel.appendChild(userText);
    header.appendChild(headerLabel);
    header.appendChild(deleteBtn);
    note.tabIndex = -1;
    note.setAttribute('aria-haspopup', 'menu');
    note.appendChild(header);

    let saveTimer = null;
    let editor = null;
    const persist = () => {
      const next = _notePayload(data, editor, note);
      Object.assign(data, next);
      if (boardMode && String(item.id || '').startsWith('pending-note-')) {
        item._pendingData = next;
        return;
      }
      if (_updateBoardAnnotation(item.id, { data: next })) return;
      _postToParent({ type: 'ann-update-note', annId: item.id, data: next });
    };
    const scheduleSave = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persist, 400);
    };
    editor = _createNoteEditor(data, scheduleSave, item.id);
    note.appendChild(editor);

    let dragState = null;
    const onHeaderDragMove = (e) => {
      if (!dragState) return;
      e.preventDefault();
      const pt = _toLocalCoords(e.clientX, e.clientY);
      data.x = dragState.x + (pt.x - dragState.startX);
      data.y = dragState.y + (pt.y - dragState.startY);
      _applyNotePosition(note, data);
    };
    const onHeaderDragEnd = () => {
      if (!dragState) return;
      dragState = null;
      document.removeEventListener('pointermove', onHeaderDragMove);
      document.removeEventListener('pointerup', onHeaderDragEnd);
      document.removeEventListener('pointercancel', onHeaderDragEnd);
      persist();
    };
    header.addEventListener('pointerdown', (e) => {
      // 削除 (x) / メニュー (…) ボタン上ではドラッグ開始しない
      if (!_ann.active || e.target.closest('[data-ann-delete],button,.ann-note-resize-handle,.gb-fmt-popup')) return;
      e.preventDefault();
      e.stopPropagation();
      const pt = _toLocalCoords(e.clientX, e.clientY);
      dragState = { startX: pt.x, startY: pt.y, x: data.x || 0, y: data.y || 0 };
      document.addEventListener('pointermove', onHeaderDragMove, { passive: false });
      document.addEventListener('pointerup', onHeaderDragEnd);
      document.addEventListener('pointercancel', onHeaderDragEnd);
    });
    _installNoteResize(note, data, persist);
    if (typeof AnnotationStickyTail !== 'undefined') {
      AnnotationStickyTail.install(note, { data, persist, getColor: () => item.color || '#c48080' });
    }

    const _deleteEmbeddedNote = () => {
      const payload = _notePayload(data, editor, note);
      payload.deleted = true;
      payload.deletedAt = new Date().toISOString();
      if (boardMode && String(item.id || '').startsWith('pending-note-')) {
        item._pendingData = payload;
        note.remove();
        return;
      }
      if (_updateBoardAnnotation(item.id, { data: payload }, () => note.remove())) return;
      note.remove();
      _postToParent({ type: 'ann-delete-note', annId: item.id, data: payload });
    };

    deleteBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
    deleteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _confirmEmbeddedNoteDelete(_deleteEmbeddedNote);
    });

    // 右クリックメニュー (色変更 / フキダシしっぽ / 削除)
    function _showEmbeddedNoteContextMenu(ev) {
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      document.querySelectorAll('._note-ctx-menu').forEach(m => m.remove());
      const restoreTarget = ev?.currentTarget instanceof HTMLElement ? ev.currentTarget : null;
      const fallbackRect = (restoreTarget || note).getBoundingClientRect();
      const clientX = Number.isFinite(ev?.clientX) ? ev.clientX : fallbackRect.left + Math.min(32, Math.max(8, fallbackRect.width / 2));
      const clientY = Number.isFinite(ev?.clientY) ? ev.clientY : fallbackRect.top + Math.min(32, Math.max(8, fallbackRect.height / 2));
      const menu = document.createElement('div');
      menu.className = 'gb-context-menu _note-ctx-menu embedded-annotation-note-context-menu annotation-note-context-menu';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', '注釈付箋メニュー');
      menu.style.position = 'fixed';
      menu.style.zIndex = '210';
      const hasTail = !!note.querySelector('.ann-tail,.ann-tail-shape');
      let closeTimer = 0;
      let tailOpen = false;
      let tailTrig = null;
      let tailPanel = null;

      const removeMenus = () => document.querySelectorAll('._note-ctx-menu').forEach(m => m.remove());
      const menuItems = (root) => [...root.querySelectorAll('button.gb-context-menu-item:not(.disabled)')];
      const focusMenuItem = (items, index) => {
        if (!items.length) return;
        const next = ((index % items.length) + items.length) % items.length;
        items[next].focus();
      };
      const closeMenu = (restoreFocus = false) => {
        clearTimeout(closeTimer);
        document.removeEventListener('pointerdown', onGlobalPointerDown, true);
        document.removeEventListener('keydown', onGlobalKeyDown, true);
        tailTrig?.setAttribute('aria-expanded', 'false');
        removeMenus();
        if (restoreFocus && restoreTarget?.isConnected) restoreTarget.focus?.();
      };
      const hideTailPanel = () => {
        clearTimeout(closeTimer);
        tailOpen = false;
        tailTrig?.setAttribute('aria-expanded', 'false');
        if (tailPanel) {
          tailPanel.hidden = true;
          tailPanel.style.display = 'none';
        }
      };
      const showTailPanel = () => {
        clearTimeout(closeTimer);
        if (!tailPanel) return;
        if (!tailPanel.isConnected) document.body.appendChild(tailPanel);
        tailOpen = true;
        tailTrig?.setAttribute('aria-expanded', 'true');
        tailPanel.hidden = false;
        tailPanel.style.display = 'block';
        if (typeof window.positionPopup === 'function') {
          window.positionPopup(tailPanel, tailTrig.getBoundingClientRect(), { prefer: 'right', gap: 2, avoidRect: menu.getBoundingClientRect() });
        } else {
          const rect = tailTrig.getBoundingClientRect();
          tailPanel.style.left = rect.right + 2 + 'px';
          tailPanel.style.top = rect.top + 'px';
          if (typeof window.clampPopupToViewport === 'function') window.clampPopupToViewport(tailPanel);
        }
      };
      const scheduleTailClose = () => {
        clearTimeout(closeTimer);
        closeTimer = setTimeout(() => {
          if (!tailPanel?.matches(':hover') && !tailTrig?.matches(':hover') && !tailPanel?.contains(document.activeElement)) hideTailPanel();
        }, 140);
      };
      function onGlobalPointerDown(e2) {
        const inAny = menu.contains(e2.target) || !!tailPanel?.contains(e2.target);
        if (!inAny) closeMenu(false);
      }
      function onGlobalKeyDown(e2) {
        if (e2.key === 'Escape') {
          e2.preventDefault();
          e2.stopPropagation();
          closeMenu(true);
        }
      }
      const handleMenuKeydown = (e2, root, onArrowLeft = null) => {
        const items = menuItems(root);
        const currentIndex = items.indexOf(document.activeElement);
        if (e2.key === 'ArrowDown') {
          e2.preventDefault();
          focusMenuItem(items, currentIndex + 1);
        } else if (e2.key === 'ArrowUp') {
          e2.preventDefault();
          focusMenuItem(items, currentIndex - 1);
        } else if (e2.key === 'Home') {
          e2.preventDefault();
          focusMenuItem(items, 0);
        } else if (e2.key === 'End') {
          e2.preventDefault();
          focusMenuItem(items, items.length - 1);
        } else if (e2.key === 'ArrowLeft' && onArrowLeft) {
          e2.preventDefault();
          onArrowLeft();
        }
      };
      const createMenuButton = ({ label, icon, action, danger = false, role = 'menuitem', checked = null }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'gb-context-menu-item' + (danger ? ' danger' : '');
        button.dataset.action = action;
        button.setAttribute('role', role);
        if (checked != null) button.setAttribute('aria-checked', checked ? 'true' : 'false');
        const iconSlot = document.createElement('span');
        iconSlot.className = 'menu-icon';
        iconSlot.setAttribute('aria-hidden', 'true');
        iconSlot.innerHTML = typeof window.lucide === 'function' && icon ? window.lucide(icon, 16) : '';
        const labelSlot = document.createElement('span');
        labelSlot.textContent = label;
        button.appendChild(iconSlot);
        button.appendChild(labelSlot);
        return button;
      };
      const persistTailState = () => {
        const payload = _notePayload(data, editor, note);
        if (item.id && !String(item.id).startsWith('pending-note-') && typeof apiPut === 'function') {
          if (!_updateBoardAnnotation(item.id, { data: payload })) {
            apiPut('/annotations/' + encodeURIComponent(item.id), { data: payload })
              .catch(error => _reportMarkupSaveFailure(error));
          }
        } else {
          item._pendingData = payload;
        }
      };
      const applyTailOperation = (isRemove) => {
        const hasTailMod = (typeof AnnotationStickyTail !== 'undefined');
        if (isRemove) {
          if (hasTailMod && note._annTailCtx) {
            delete note._annTailCtx.data.tail;
            delete note._annTailCtx.data.tailX;
            delete note._annTailCtx.data.tailY;
          }
          note.querySelectorAll(':scope > .ann-tail, :scope > .ann-tail-line, :scope > .ann-tail-shape, :scope > .ann-tail-handle').forEach(el => el.remove());
          delete data.tail;
          delete data.tailX;
          delete data.tailY;
        } else if (hasTailMod && !note.querySelector('.ann-tail,.ann-tail-shape')) {
          const w = note.offsetWidth || data.width || 180;
          const h = note.offsetHeight || data.height || 100;
          const newTail = {
            startX: w / 2,
            startY: h / 2,
            endX: w / 2,
            endY: h + 40,
            target: null,
          };
          data.tail = newTail;
          delete data.tailX;
          delete data.tailY;
          if (note._annTailCtx) {
            note._annTailCtx.data.tail = newTail;
            delete note._annTailCtx.data.tailX;
            delete note._annTailCtx.data.tailY;
          }
          AnnotationStickyTail.setTail(note, newTail, null);
        }
        persistTailState();
      };

      const colorItem = createMenuButton({ label: '色を変更', icon: 'palette', action: 'color' });
      colorItem.addEventListener('click', () => {
        closeMenu(false);
        if (typeof window.openColorPalette === 'function') {
          window.openColorPalette(note, item.color || '', (newColor) => {
            item.color = newColor || item.color;
            _applyNoteColor(note, item.color);
            if (boardMode && String(item.id || '').startsWith('pending-note-')) return;
            if (_updateBoardAnnotation(item.id, { color: item.color })) return;
            _postToParent({ type: 'ann-update-note', annId: item.id, color: item.color });
          });
        }
      });
      menu.appendChild(colorItem);

      tailTrig = createMenuButton({ label: 'フキダシのしっぽ', icon: 'messageSquare', action: 'tail' });
      tailTrig.classList.add('has-submenu');
      tailTrig.setAttribute('aria-haspopup', 'menu');
      tailTrig.setAttribute('aria-expanded', 'false');
      tailPanel = document.createElement('div');
      tailPanel.className = 'gb-context-menu _note-ctx-menu embedded-annotation-note-tail-menu annotation-note-tail-menu';
      tailPanel.setAttribute('role', 'menu');
      tailPanel.setAttribute('aria-label', 'フキダシのしっぽ');
      tailPanel.hidden = true;
      tailPanel.style.position = 'fixed';
      tailPanel.style.zIndex = '211';
      tailPanel.style.display = 'none';
      [['追加する', false], ['削除する', true]].forEach(([label, isRemove]) => {
        const tailButton = createMenuButton({ label, action: isRemove ? 'tail-remove' : 'tail-add', role: 'menuitemradio', checked: hasTail === isRemove });
        tailButton.addEventListener('click', () => {
          closeMenu(false);
          applyTailOperation(isRemove);
        });
        tailPanel.appendChild(tailButton);
      });
      tailTrig.addEventListener('mouseenter', showTailPanel);
      tailTrig.addEventListener('mouseleave', scheduleTailClose);
      tailTrig.addEventListener('click', () => tailOpen ? hideTailPanel() : showTailPanel());
      tailTrig.addEventListener('keydown', (e2) => {
        if (e2.key === 'ArrowRight' || e2.key === 'Enter' || e2.key === ' ') {
          e2.preventDefault();
          showTailPanel();
          requestAnimationFrame(() => focusMenuItem(menuItems(tailPanel), 0));
        }
      });
      tailPanel.addEventListener('mouseenter', () => clearTimeout(closeTimer));
      tailPanel.addEventListener('mouseleave', scheduleTailClose);
      tailPanel.addEventListener('keydown', (e2) => handleMenuKeydown(e2, tailPanel, () => {
        hideTailPanel();
        tailTrig.focus();
      }));
      menu.appendChild(tailTrig);

      const deleteItem = createMenuButton({ label: '削除', icon: 'trash2', action: 'delete', danger: true });
      deleteItem.addEventListener('click', () => {
        closeMenu(false);
        _confirmEmbeddedNoteDelete(_deleteEmbeddedNote);
      });
      menu.appendChild(deleteItem);
      document.body.appendChild(menu);
      if (restoreTarget && restoreTarget.classList?.contains('note-more-btn') && typeof window.positionPopup === 'function') {
        window.positionPopup(menu, restoreTarget.getBoundingClientRect(), { prefer: 'below', gap: 2 });
      } else if (typeof window.positionPopup === 'function') {
        window.positionPopup(menu, { left: clientX, right: clientX, top: clientY, bottom: clientY }, { prefer: 'below', gap: 2 });
      } else {
        const z = (typeof window._getZoom === 'function') ? window._getZoom() : (parseFloat(document.documentElement.style.zoom) || 1);
        menu.style.left = (clientX / z) + 'px';
        menu.style.top = (clientY / z) + 'px';
        if (typeof window.clampPopupToViewport === 'function') window.clampPopupToViewport(menu);
      }
      menu.addEventListener('keydown', (e2) => handleMenuKeydown(e2, menu));
      setTimeout(() => {
        document.addEventListener('pointerdown', onGlobalPointerDown, true);
        document.addEventListener('keydown', onGlobalKeyDown, true);
        requestAnimationFrame(() => menuItems(menu)[0]?.focus());
      }, 0);
    }

    // ヘッダー右端の「…」ボタン: 右クリックと同じメニューを開く
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'note-more-btn';
    moreBtn.dataset.annMore = '1';
    moreBtn.dataset.e2eId = `embedded-annotation-note-${item.id || 'pending'}-menu`;
    moreBtn.setAttribute('aria-label', '注釈メニュー');
    moreBtn.title = 'メニュー';
    moreBtn.innerHTML = lucide('moreHorizontal', 16);
    _normalizeEmbeddedNoteIcon(moreBtn, 16);
    moreBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
    moreBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _showEmbeddedNoteContextMenu(e);
    });
    note.appendChild(moreBtn);

    note.addEventListener('contextmenu', _showEmbeddedNoteContextMenu);
    if (typeof window.addLongPressHandler === 'function') {
      window.addLongPressHandler(note, _showEmbeddedNoteContextMenu);
    }

    notesLayer.appendChild(note);
    return note;
  }

  // ポインターイベント
  svg.addEventListener('pointerdown', (e) => {
    if (!_ann.active) return;
    if (boardMode && e.button !== 0) return;
    _updateSize();
    if (_ann.tool === 'sticky') {
      const pt = _toLocalCoords(e.clientX, e.clientY);
      const annClientId = 'pending-note-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
      const noteData = { x: pt.x, y: pt.y, width: 180, height: 100, text: '', html: '', user: _annotationUser() };
      let item = null;
      let note = null;
      if (_saveBoardAnnotation({
        target_path: _ann.targetPath,
        type: 'comment',
        shape: 'sticky',
        data: noteData,
        color: _ann.color,
        opacity: _ann.opacity,
        user: _annotationUser(),
      }, (res) => {
        if (!item || !note) return;
        item.id = res?.id || item.id;
        note.dataset.annId = item.id || '';
        if (item._pendingData && item.id) _updateBoardAnnotation(item.id, { data: item._pendingData });
      }, () => { note?.remove(); })) {
        item = {
          id: annClientId,
          type: 'comment',
          shape: 'sticky',
          color: _ann.color,
          opacity: _ann.opacity,
          user: _annotationUser(),
          created: new Date().toISOString(),
        };
        note = _renderNote(item, noteData);
        return;
      }
      _postToParent({ type: 'ann-create-note', x: pt.x, y: pt.y, color: _ann.color, targetPath: _ann.targetPath, annClientId });
      return;
    }
    if (_ann.tool === 'eraser') {
      const pt = _toLocalCoords(e.clientX, e.clientY);
      const x = pt.x;
      const y = pt.y;
      // ヒットテスト
      const els = Array.from(layer.querySelectorAll('path, polygon, rect')).reverse();
      const tolerance = Math.max(8, _ann.widths?.eraser || _widthDefaults.eraser);
      for (const el of els) {
        if (_markupElementHit(el, x, y, tolerance)) {
          const annId = el.dataset.annId;
          if (annId) {
            if (_deleteBoardAnnotation(annId, () => el.remove())) return;
            el.remove();
            _postToParent({ type: 'ann-delete', annId });
            return;
          }
          el.remove();
          return;
        }
      }
      return;
    }
    _ann.drawing = true;
    const pt = _toLocalCoords(e.clientX, e.clientY);
    _ann.path = [[pt.x, pt.y]];
    _ann.pressures = [e.pressure || 0.5];
    try { svg.setPointerCapture?.(e.pointerId); } catch (_) {}
  });

  svg.addEventListener('pointermove', (e) => {
    if (!_ann.drawing) return;
    const pt = _toLocalCoords(e.clientX, e.clientY);
    _ann.path.push([pt.x, pt.y]);
    _ann.pressures.push(e.pressure || 0.5);
    let preview = layer.querySelector('.ann-preview');
    const previewTag = _ann.tool === 'lasso' ? 'polygon' : (_ann.tool === 'rect' ? 'rect' : 'path');
    if (!preview || preview.tagName.toLowerCase() !== previewTag) {
      preview?.remove();
      preview = document.createElementNS(_svgNS, previewTag);
      preview.classList.add('ann-preview');
      layer.appendChild(preview);
    }
    if (_ann.tool === 'rect') {
      _applyRectEl(preview, _rectData(_ann.path), _ann.color, _ann.opacity, true);
    } else if (_ann.tool === 'lasso') {
      preview.setAttribute('points', _ann.path.map(p => p.join(',')).join(' '));
      preview.setAttribute('fill', _ann.color); preview.setAttribute('fill-opacity', '0.2');
      preview.setAttribute('stroke', _ann.color); preview.setAttribute('stroke-dasharray', '4,4');
    } else {
      preview.setAttribute('d', _pathD(_ann.path));
      preview.setAttribute('fill', 'none'); preview.setAttribute('stroke', _ann.color);
      preview.setAttribute('stroke-width', _drawWidth(_ann.tool, _ann.pressures, _ann.widths?.[_ann.tool]));
      preview.setAttribute('stroke-opacity', _ann.tool === 'marker' ? String(_normalizeMarkupOpacity(_ann.opacity, 1) * 0.5) : String(_normalizeMarkupOpacity(_ann.opacity, 1)));
      preview.setAttribute('stroke-linecap', 'round'); preview.setAttribute('stroke-linejoin', 'round');
    }
  });

  svg.addEventListener('pointerup', (e) => {
    if (!_ann.drawing) return;
    _ann.drawing = false;
    layer.querySelector('.ann-preview')?.remove();
    if (_ann.path.length < 2) return;
    const type = _ann.tool === 'rect' ? 'rect' : (_ann.tool === 'lasso' ? 'lasso' : (_ann.tool === 'marker' ? 'marker' : 'stroke'));
    const annClientId = 'ann-client-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const strokeData = type === 'rect' ? _rectData(_ann.path) : { points: _ann.path, pressures: _ann.pressures };
    if (type !== 'lasso' && type !== 'rect') strokeData.width = _ann.widths?.[_ann.tool === 'marker' ? 'marker' : 'pen'];
    const savedEl = type === 'rect' ? _renderRect(strokeData, _ann.color, _ann.opacity, null) : _renderStroke(type, _ann.path, _ann.pressures, _ann.color, _ann.opacity, null, strokeData.width);
    savedEl.dataset.annClientId = annClientId;
    if (_saveBoardAnnotation({
      target_path: _ann.targetPath,
      type,
      data: strokeData,
      color: _ann.color,
      opacity: _ann.opacity,
      user: _annotationUser(),
    }, (res) => {
      if (res?.id) savedEl.dataset.annId = res.id;
    }, () => { savedEl.remove(); })) {
      _ann.path = []; _ann.pressures = [];
      return;
    }
    // 親に保存依頼
    _postToParent({
      type: 'ann-save-stroke',
      annType: type,
      data: strokeData,
      color: _ann.color, opacity: _ann.opacity, targetPath: _ann.targetPath,
      annClientId,
    });
    // 確定描画
    _ann.path = []; _ann.pressures = [];
  });

  function _renderStroke(type, points, pressures, color, opacity, annId, width) {
    const normalizedOpacity = _normalizeMarkupOpacity(opacity, 1);
    let el;
    if (type === 'lasso') {
      el = document.createElementNS(_svgNS, 'polygon');
      el.setAttribute('points', points.map(p => p.join(',')).join(' '));
      el.setAttribute('fill', color); el.setAttribute('fill-opacity', normalizedOpacity * 0.4);
      el.setAttribute('stroke', color); el.setAttribute('stroke-width', '1');
    } else {
      el = document.createElementNS(_svgNS, 'path');
      el.setAttribute('d', _pathD(points));
      el.setAttribute('fill', 'none'); el.setAttribute('stroke', color);
      el.setAttribute('stroke-width', _drawWidth(type, pressures, width));
      el.setAttribute('stroke-opacity', type === 'marker' ? String(normalizedOpacity * 0.5) : String(normalizedOpacity));
      el.setAttribute('stroke-linecap', 'round'); el.setAttribute('stroke-linejoin', 'round');
    }
    if (annId) el.dataset.annId = annId;
    layer.appendChild(el);
    return el;
  }

  function _renderRect(data, color, opacity, annId) {
    const el = _applyRectEl(document.createElementNS(_svgNS, 'rect'), data, color, opacity, false);
    if (annId) el.dataset.annId = annId;
    layer.appendChild(el);
    return el;
  }

  function _handleMessage(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === 'ann-set-state') {
      _ann.active = msg.active;
      _ann.tool = msg.tool || 'pen';
      _ann.color = msg.color || '#c48080';
      _ann.opacity = msg.opacity ?? 1;
      _ann.widths = { ..._ann.widths, ...(msg.widths || {}) };
      _ann.targetPath = msg.targetPath || '';
      svg.style.pointerEvents = _ann.active ? 'auto' : 'none';
      svg.style.cursor = _ann.active ? (_ann.tool === 'eraser' ? 'not-allowed' : _ann.tool === 'sticky' ? 'cell' : 'crosshair') : '';
      if (_ann.active) svg.style.outline = '2px solid rgba(86,156,214,0.3)';
      else svg.style.outline = '';
      hitRect.setAttribute('pointer-events', _ann.active ? 'all' : 'none');
      _updateSize();
      _syncNoteInteractivity();
    }
    if (msg.type === 'ann-set-opacity') {
      const opacity = _normalizeMarkupOpacity(msg.opacity, _ann.opacity ?? 1);
      _ann.opacity = opacity;
      svg.style.opacity = opacity;
      notesLayer.style.opacity = opacity;
    }
    if (msg.type === 'ann-set-visibility') {
      svg.style.visibility = msg.visible ? '' : 'hidden';
      notesLayer.style.visibility = msg.visible ? '' : 'hidden';
    }
    if (msg.type === 'ann-add-note') {
      const item = msg.item || {};
      const data = _parseMarkupAnnotationData(item);
      if (!data) return;
      const annId = item.id || msg.annId || '';
      if (annId && [...notesLayer.querySelectorAll('.ann-note-embedded')].some(note => note.dataset.annId === annId)) return;
      _renderNote({ ...item, id: annId, shape: item.shape || 'sticky' }, data || {});
    }
    if (msg.type === 'ann-remove-note') {
      const annId = msg.annId || '';
      [...notesLayer.querySelectorAll('.ann-note-embedded')].forEach(note => {
        if (!annId || note.dataset.annId === annId) note.remove();
      });
    }
    if (msg.type === 'ann-load') {
      layer.innerHTML = '';
      notesLayer.innerHTML = '';
      (msg.items || []).forEach(item => {
        const data = _parseMarkupAnnotationData(item);
        if (!data) return;
        if (_isEmbeddedStandaloneNoteItem(item, data)) {
          _renderNote(item, data || {});
        } else if (item.type === 'comment' || item.type === 'note' || item.type === 'sticky') {
          return;
        } else if (item.type === 'rect' && data?.width != null && data?.height != null) {
          _renderRect(data, item.color, item.opacity, item.id);
        } else if (data?.points) {
          _renderStroke(item.type, data.points, data.pressures || [], item.color, item.opacity, item.id, data.width);
        }
      });
      _syncNoteInteractivity();
      _updateSize();
    }
    if (msg.type === 'ann-stroke-saved') {
      // 親が保存したストロークにIDを付与
      let targetEl = null;
      if (msg.annClientId) {
        targetEl = Array.from(layer.querySelectorAll('path[data-ann-client-id], polygon[data-ann-client-id], rect[data-ann-client-id]'))
          .find(el => el.dataset.annClientId === msg.annClientId) || null;
      }
      const els = layer.querySelectorAll('path:not([data-ann-id]), polygon:not([data-ann-id]), rect:not([data-ann-id])');
      if (!targetEl && els.length > 0) targetEl = els[els.length - 1];
      if (targetEl && msg.annId) {
        targetEl.dataset.annId = msg.annId;
        delete targetEl.dataset.annClientId;
      }
    }
    if (msg.type === 'ann-stroke-save-failed') {
      let targetEl = null;
      if (msg.annClientId) {
        targetEl = Array.from(layer.querySelectorAll('path[data-ann-client-id], polygon[data-ann-client-id], rect[data-ann-client-id]'))
          .find(el => el.dataset.annClientId === msg.annClientId) || null;
      }
      if (targetEl) targetEl.remove();
    }
  }

  function _isTrustedParentMessageEvent(ev) {
    if (!ev) return false;
    if (typeof window !== 'undefined' && window.parent && ev.source !== window.parent) return false;
    try {
      const origin = window.location?.origin || '';
      if (origin && origin !== 'null' && ev.origin !== origin) return false;
    } catch {
      return false;
    }
    return true;
  }

  // 親からのpostMessageで同期
  window.addEventListener('message', (ev) => {
    if (!_isTrustedParentMessageEvent(ev)) return;
    const msg = ev.data;
    _handleMessage(msg);
  });

  const bridge = { svg, layer, notesLayer, ann: _ann, handleMessage: _handleMessage, updateSize: _updateSize };
  const e2eBridgeEnabled = (() => {
    if (typeof window === 'undefined') return false;
    if (window.GBE2EActions) return true;
    try {
      const params = new URLSearchParams(window.location?.search || '');
      return params.get('smoke') === '1' || params.get('e2e') === '1';
    } catch {
      return false;
    }
  })();
  if (e2eBridgeEnabled) {
    bridge.renderEmbeddedNoteForE2E = (options = {}) => {
      const item = {
        id: options.id || ('e2e-embedded-note-' + Date.now().toString(36)),
        type: 'comment',
        shape: 'sticky',
        color: options.color || _ann.color || '#c48080',
        opacity: options.opacity ?? _ann.opacity ?? 1,
        user: options.user || _annotationUser(),
        created: options.created || new Date().toISOString(),
      };
      const data = {
        x: Number(options.x) || 120,
        y: Number(options.y) || 120,
        width: Number(options.width) || 180,
        height: Number(options.height) || 100,
        text: options.text || '',
        html: options.html || '',
        user: item.user,
      };
      return _renderNote(item, data);
    };
  }
  wrapper._annBridge = bridge;
  if (host !== wrapper) host._annBridge = bridge;
  return bridge;
}

// ============================================================
// スタンドアロンメモ（viewer.html等で使用）
// ============================================================

function initStandaloneMarkup(container, getTargetPath) {
  const _svgNS = 'http://www.w3.org/2000/svg';
  const _ann = { active: false, tool: 'pen', color: PALETTE_COLORS[7] || '#c48080', opacity: 1, drawing: false, path: [], pressures: [] };
  let _loadAnnotationsSeq = 0;

  const svg = document.createElementNS(_svgNS, 'svg');
  svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:10;pointer-events:none;overflow:visible;';
  const hitRect = document.createElementNS(_svgNS, 'rect');
  hitRect.setAttribute('width', '100%'); hitRect.setAttribute('height', '100%');
  hitRect.setAttribute('fill', 'transparent'); hitRect.setAttribute('pointer-events', 'none');
  svg.appendChild(hitRect);
  const layer = document.createElementNS(_svgNS, 'g');
  svg.appendChild(layer);
  container.style.position = 'relative';
  container.appendChild(svg);

  function _pathD(pts) {
    if (pts.length < 2) return '';
    return 'M ' + pts[0][0] + ' ' + pts[0][1] + pts.slice(1).map(p => ' L ' + p[0] + ' ' + p[1]).join('');
  }
  function _toCoords(cx, cy) {
    const r = svg.getBoundingClientRect();
    return {
      x: cx - r.left + (container.scrollLeft || 0),
      y: cy - r.top + (container.scrollTop || 0),
    };
  }
  function _getUser() { try { return JSON.parse(localStorage.getItem('meldex-user') || '{}').name || 'anonymous'; } catch { return 'anonymous'; } }

  function _saNormalizeOpacity(value, fallback = 1) {
    return _normalizeCoreAnnotationOpacity(value, fallback);
  }

  let _saLastSaveFailureAt = 0;
  function _saReportSaveFailure(error, message = '注釈の保存に失敗しました') {
    const now = Date.now();
    if (typeof showStatus === 'function' && now - _saLastSaveFailureAt > 1500) {
      showStatus(message, true);
      _saLastSaveFailureAt = now;
    }
    try { console.warn(message, error); } catch {}
  }

  async function _saUpdateAnnotation(annId, payload) {
    if (!annId || typeof apiPut !== 'function') return null;
    return apiPut('/annotations/' + encodeURIComponent(annId), payload);
  }

  async function _saDeleteAnnotation(annId) {
    if (!annId || typeof apiDelete !== 'function') return null;
    return apiDelete('/annotations/' + encodeURIComponent(annId));
  }

  async function _saDeleteNoteElement(note) {
    const annId = note?.dataset?.annId || '';
    try {
      if (annId) await _saDeleteAnnotation(annId);
      note?.remove();
    } catch (error) {
      _saReportSaveFailure(error, '付箋を削除できませんでした');
    }
  }

  function _saElementHit(el, x, y, tolerance = 10) {
    return _coreAnnotationElementHit(el, x, y, tolerance);
  }

  function _renderStroke(type, points, pressures, color, opacity, annId) {
    const normalizedOpacity = _saNormalizeOpacity(opacity, 1);
    let el;
    if (type === 'lasso') {
      el = document.createElementNS(_svgNS, 'polygon');
      el.setAttribute('points', points.map(p => p.join(',')).join(' '));
      el.setAttribute('fill', color); el.setAttribute('fill-opacity', normalizedOpacity * 0.4);
      el.setAttribute('stroke', color); el.setAttribute('stroke-width', '1');
    } else {
      el = document.createElementNS(_svgNS, 'path');
      el.setAttribute('d', _pathD(points));
      el.setAttribute('fill', 'none'); el.setAttribute('stroke', color);
      const isPen = type === 'stroke';
      if (isPen && pressures.length > 0) {
/* meldex-core.part03.js */
        const avgP = pressures.reduce((a, b) => a + b, 0) / pressures.length;
        el.setAttribute('stroke-width', Math.max(1, avgP * 8));
      } else {
        el.setAttribute('stroke-width', isPen ? '3' : '12');
      }
      el.setAttribute('stroke-opacity', type === 'marker' ? String(normalizedOpacity * 0.5) : String(normalizedOpacity));
      el.setAttribute('stroke-linecap', 'round'); el.setAttribute('stroke-linejoin', 'round');
    }
    if (annId) el.dataset.annId = annId;
    layer.appendChild(el);
    return el;
  }
  function _saRectData(pts) {
    const a = pts?.[0] || [0, 0], b = pts?.[pts.length - 1] || a;
    const x1 = Number(a[0]) || 0, y1 = Number(a[1]) || 0, x2 = Number(b[0]) || 0, y2 = Number(b[1]) || 0;
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
  }
  function _saApplyRect(el, data, color, opacity, preview) {
    const normalizedOpacity = _saNormalizeOpacity(opacity, 1);
    el.setAttribute('x', Number(data?.x) || 0); el.setAttribute('y', Number(data?.y) || 0);
    el.setAttribute('width', Math.max(1, Number(data?.width) || 0)); el.setAttribute('height', Math.max(1, Number(data?.height) || 0));
    el.setAttribute('fill', color); el.setAttribute('fill-opacity', String(normalizedOpacity * (preview ? 0.2 : 0.4)));
    el.setAttribute('stroke', color); el.setAttribute('stroke-width', '1'); el.setAttribute('stroke-opacity', String(normalizedOpacity));
    if (preview) el.setAttribute('stroke-dasharray', '4,4'); else el.removeAttribute('stroke-dasharray');
    return el;
  }
  function _renderRect(data, color, opacity, annId) {
    const el = _saApplyRect(document.createElementNS(_svgNS, 'rect'), data, color, opacity, false);
    if (annId) el.dataset.annId = annId;
    layer.appendChild(el);
    return el;
  }

  function _saCurrentTargetPath() {
    return typeof getTargetPath === 'function' ? String(getTargetPath() || '') : '';
  }

  function _saParseAnnotationData(item, message = '一部の注釈データを読み込めませんでした') {
    const raw = item?.data;
    if (raw == null || raw === '') return {};
    if (typeof raw !== 'string') return raw || {};
    try {
      return JSON.parse(raw) || {};
    } catch (error) {
      _saReportSaveFailure(error, message);
      return null;
    }
  }

  function _syncStandaloneNoteInteractivity() {
    container.querySelectorAll('.sa-note').forEach(n => {
      n.style.pointerEvents = _ann.active ? 'auto' : 'none';
    });
  }

  function _saNotePayload(data, textarea, note) {
    const width = Math.max(
      120,
      Math.round(Math.max(note.offsetWidth || 0, (textarea.offsetWidth || 0) + 16, Number(data.width) || 180))
    );
    const height = Math.max(
      60,
      Math.round(Math.max(note.offsetHeight || 0, (textarea.offsetHeight || 0) + 16, Number(data.height) || 100))
    );
    return { ...data, text: textarea.value, width, height };
  }

  function _applyStandaloneNoteSize(note, textarea, data) {
    const width = Math.max(120, Number(data.width) || 180);
    const height = Math.max(60, Number(data.height) || 100);
    note.style.width = width + 'px';
    note.style.minHeight = height + 'px';
    textarea.style.height = Math.max(40, height - 16) + 'px';
  }

  svg.addEventListener('pointerdown', async (e) => {
    if (!_ann.active) return;
    const pt = _toCoords(e.clientX, e.clientY);
    if (_ann.tool === 'sticky') {
      const targetPath = _saCurrentTargetPath();
      if (!targetPath) {
        _saReportSaveFailure(new Error('missing target path'), '注釈の保存先を確認できませんでした');
        return;
      }
      const noteData = { x: pt.x, y: pt.y, width: 180, height: 100, text: '' };
      try {
        const res = await apiPost('/annotations', { target_path: targetPath, type: 'comment', shape: 'sticky', data: noteData, color: _ann.color, opacity: _ann.opacity, user: _getUser() });
        if (_saCurrentTargetPath() !== targetPath) return;
        _renderNote(res.id, noteData, _ann.color);
      } catch (error) { _saReportSaveFailure(error, '付箋作成に失敗しました'); }
      return;
    }
    if (_ann.tool === 'eraser') {
      const els = Array.from(layer.querySelectorAll('path, polygon, rect')).reverse();
      for (const el of els) {
        if (el.classList.contains('ann-preview')) continue;
        if (_saElementHit(el, pt.x, pt.y, 10)) {
          try {
            if (el.dataset.annId) await _saDeleteAnnotation(el.dataset.annId);
            el.remove();
          } catch (error) {
            _saReportSaveFailure(error, '注釈を削除できませんでした');
          }
          break;
        }
      }
      for (const n of container.querySelectorAll('.sa-note')) {
        const r = n.getBoundingClientRect(); const cr = container.getBoundingClientRect();
        const nx = r.left - cr.left, ny = r.top - cr.top;
        if (pt.x >= nx - 5 && pt.x <= nx + r.width + 5 && pt.y >= ny - 5 && pt.y <= ny + r.height + 5) {
          await _saDeleteNoteElement(n);
          break;
        }
      }
      return;
    }
    const targetPath = _saCurrentTargetPath();
    if (!targetPath) {
      _saReportSaveFailure(new Error('missing target path'), '注釈の保存先を確認できませんでした');
      return;
    }
    _ann.drawing = true;
    _ann.targetPath = targetPath;
    _ann.path = [[pt.x, pt.y]]; _ann.pressures = [e.pressure || 0.5];
    svg.setPointerCapture(e.pointerId);
  });

  svg.addEventListener('pointermove', (e) => {
    if (!_ann.drawing) return;
    const pt = _toCoords(e.clientX, e.clientY);
    _ann.path.push([pt.x, pt.y]); _ann.pressures.push(e.pressure || 0.5);
    let preview = layer.querySelector('.ann-preview');
    const previewTag = _ann.tool === 'lasso' ? 'polygon' : (_ann.tool === 'rect' ? 'rect' : 'path');
    if (!preview || preview.tagName.toLowerCase() !== previewTag) { preview?.remove(); preview = document.createElementNS(_svgNS, previewTag); preview.classList.add('ann-preview'); layer.appendChild(preview); }
    if (_ann.tool === 'rect') {
      _saApplyRect(preview, _saRectData(_ann.path), _ann.color, _ann.opacity, true);
    } else if (_ann.tool === 'lasso') {
      preview.setAttribute('points', _ann.path.map(p => p.join(',')).join(' '));
      preview.setAttribute('fill', _ann.color); preview.setAttribute('fill-opacity', '0.2');
      preview.setAttribute('stroke', _ann.color); preview.setAttribute('stroke-width', '1'); preview.setAttribute('stroke-dasharray', '4,4');
    } else {
      preview.setAttribute('d', _pathD(_ann.path)); preview.setAttribute('fill', 'none'); preview.setAttribute('stroke', _ann.color);
      preview.setAttribute('stroke-width', _ann.tool === 'pen' ? '3' : '12');
      preview.setAttribute('stroke-opacity', _ann.tool === 'marker' ? String(_saNormalizeOpacity(_ann.opacity, 1) * 0.5) : String(_saNormalizeOpacity(_ann.opacity, 1))); preview.setAttribute('stroke-linecap', 'round');
    }
  });

  svg.addEventListener('pointerup', async () => {
    if (!_ann.drawing) return;
    _ann.drawing = false;
    layer.querySelector('.ann-preview')?.remove();
    if (_ann.path.length < 2) {
      _ann.path = []; _ann.pressures = []; _ann.targetPath = '';
      return;
    }
    const type = _ann.tool === 'rect' ? 'rect' : (_ann.tool === 'lasso' ? 'lasso' : (_ann.tool === 'marker' ? 'marker' : 'stroke'));
    const data = type === 'rect' ? _saRectData(_ann.path) : { points: _ann.path, pressures: _ann.pressures };
    const targetPath = _ann.targetPath || _saCurrentTargetPath();
    if (!targetPath || _saCurrentTargetPath() !== targetPath) {
      _ann.path = []; _ann.pressures = []; _ann.targetPath = '';
      return;
    }
    try {
      const res = await apiPost('/annotations', { target_path: targetPath, type, data, color: _ann.color, opacity: _ann.opacity, user: _getUser() });
      if (_saCurrentTargetPath() !== targetPath) return;
      if (type === 'rect') _renderRect(data, _ann.color, _ann.opacity, res.id);
      else _renderStroke(type, _ann.path, _ann.pressures, _ann.color, _ann.opacity, res.id);
    } catch (error) { _saReportSaveFailure(error); }
    finally { _ann.path = []; _ann.pressures = []; _ann.targetPath = ''; }
  });

  function _isStandaloneNoteAnnotation(item, data) {
    if (!item || data?.deleted) return false;
    const type = String(item.type || '');
    const shape = String(item.shape || data?.shape || '');
    const hasPosition = data && (data.x != null || data.y != null || data.width != null || data.height != null);
    if (type === 'comment') {
      return shape === 'sticky' || data?.noteType === 'sticky' || hasPosition;
    }
    return type === 'note' || type === 'sticky';
  }

  function _renderNote(annId, data, color) {
    const note = document.createElement('div');
    note.className = 'sa-note'; note.dataset.annId = annId;
    note.style.cssText = `position:absolute;left:${data.x}px;top:${data.y}px;width:${data.width||180}px;min-height:${data.height||100}px;background:${color};color:#333;padding:8px;border-radius:4px;font-size:12px;cursor:move;z-index:12;border:1px solid rgba(0,0,0,0.15);`;
    const textarea = document.createElement('textarea');
    textarea.value = data.text || '';
    textarea.style.cssText = 'width:100%;height:80px;background:transparent;border:none;color:#333;font-size:12px;resize:both;outline:none;';
    note.style.pointerEvents = _ann.active ? 'auto' : 'none';
    _applyStandaloneNoteSize(note, textarea, data);
    textarea.onblur = async () => {
      const previousData = { ...data };
      const previousStyle = {
        width: note.style.width,
        minHeight: note.style.minHeight,
        textareaHeight: textarea.style.height,
      };
      Object.assign(data, _saNotePayload(data, textarea, note));
      try {
        await _saUpdateAnnotation(annId, { data: { ...data } });
      } catch (error) {
        Object.keys(data).forEach(key => { delete data[key]; });
        Object.assign(data, previousData);
        note.style.width = previousStyle.width;
        note.style.minHeight = previousStyle.minHeight;
        textarea.style.height = previousStyle.textareaHeight;
        textarea.value = previousData.text || '';
        _saReportSaveFailure(error);
      }
    };
    note.appendChild(textarea);
    let dx = 0, dy = 0;
    note.addEventListener('pointerdown', (e) => {
      if (_ann.active && _ann.tool === 'eraser') {
        e.preventDefault();
        e.stopPropagation();
        _saDeleteNoteElement(note);
        return;
      }
      if (e.target === textarea) return; e.preventDefault();
      const rect = note.getBoundingClientRect();
      dx = e.clientX - rect.left; dy = e.clientY - rect.top;
      const previous = {
        x: data.x || 0,
        y: data.y || 0,
        text: data.text || '',
        width: data.width,
        height: data.height,
        left: note.style.left,
        top: note.style.top,
        noteWidth: note.style.width,
        noteMinHeight: note.style.minHeight,
        textareaHeight: textarea.style.height,
      };
      const onMove = (e2) => {
        const pt = _toCoords(e2.clientX - dx, e2.clientY - dy);
        note.style.left = pt.x + 'px';
        note.style.top = pt.y + 'px';
      };
      const onUp = async () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        Object.assign(data, _saNotePayload(data, textarea, note), {
          x: parseFloat(note.style.left) || 0,
          y: parseFloat(note.style.top) || 0,
        });
        try {
          await _saUpdateAnnotation(annId, { data: { ...data } });
        } catch (error) {
          data.x = previous.x;
          data.y = previous.y;
          data.text = previous.text;
          data.width = previous.width;
          data.height = previous.height;
          note.style.left = previous.left;
          note.style.top = previous.top;
          note.style.width = previous.noteWidth;
          note.style.minHeight = previous.noteMinHeight;
          textarea.style.height = previous.textareaHeight;
          textarea.value = previous.text;
          _saReportSaveFailure(error);
        }
      };
      document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp);
    });
    container.appendChild(note);
  }

  async function loadAnnotations(targetPath) {
    const requestSeq = ++_loadAnnotationsSeq;
    const requestedTarget = String(targetPath || '');
    layer.innerHTML = ''; container.querySelectorAll('.sa-note').forEach(n => n.remove());
    if (!requestedTarget) return;
    try {
      const items = await apiFetch('/annotations?target=' + encodeURIComponent(requestedTarget));
      const activeTarget = typeof getTargetPath === 'function' ? String(getTargetPath() || '') : requestedTarget;
      if (requestSeq !== _loadAnnotationsSeq || activeTarget !== requestedTarget) return;
      items.forEach(item => {
        const data = _saParseAnnotationData(item);
        if (!data) return;
        if (_isStandaloneNoteAnnotation(item, data)) _renderNote(item.id, data, item.color);
        else if (item.type === 'comment' || item.type === 'note' || item.type === 'sticky') return;
        else if (item.type === 'rect' && data?.width != null && data?.height != null) _renderRect(data, item.color, item.opacity, item.id);
        else if (data.points) _renderStroke(item.type, data.points, data.pressures || [], item.color, item.opacity, item.id);
      });
      _syncStandaloneNoteInteractivity();
    } catch (error) {
      if (requestSeq === _loadAnnotationsSeq) _saReportSaveFailure(error, '注釈を読み込めませんでした');
    }
  }

  function toggle(active) {
    if (active === undefined) active = !_ann.active;
    _ann.active = active;
    svg.style.pointerEvents = active ? 'auto' : 'none';
    svg.style.cursor = active ? (_ann.tool === 'eraser' ? 'not-allowed' : _ann.tool === 'sticky' ? 'cell' : 'crosshair') : '';
    svg.style.outline = active ? '2px solid rgba(86,156,214,0.3)' : '';
    hitRect.setAttribute('pointer-events', active ? 'all' : 'none');
    _syncStandaloneNoteInteractivity();
  }
  function setTool(tool) { _ann.tool = tool; if (_ann.active) svg.style.cursor = tool === 'eraser' ? 'not-allowed' : tool === 'sticky' ? 'cell' : 'crosshair'; }
  function setColor(c) { _ann.color = c; }
  function setOpacity(o) {
    const opacity = _saNormalizeOpacity(o, 1);
    _ann.opacity = opacity;
    svg.style.opacity = opacity;
    container.querySelectorAll('.sa-note').forEach(n => { n.style.opacity = opacity; });
  }
  function destroy() { svg.remove(); container.querySelectorAll('.sa-note').forEach(n => n.remove()); }

  return { svg, layer, ann: _ann, toggle, loadAnnotations, setTool, setColor, setOpacity, destroy };
}

const STANDALONE_MARKUP_TOOLBAR_CSS = `
.sa-markup-toolbar {
  position: fixed;
  z-index: 55;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  border-bottom: 1px solid var(--border, #333);
  background: var(--ui-popup-bg, var(--bg2, #252525));
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  bottom: 60px;
  left: 50%;
  transform: translateX(-50%);
}
.sa-markup-toolbar .sa-tb-btn,
.sa-markup-toolbar .sa-markup-color-btn,
.sa-markup-toolbar .sa-markup-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  min-width: 28px;
  height: 28px;
  min-height: 28px;
  padding: 0;
  border: 1px solid var(--border, #333);
  border-radius: 4px;
  background: transparent;
  color: var(--fg, #d4d4d4);
  cursor: pointer;
}
.sa-markup-toolbar .sa-tb-btn:hover,
.sa-markup-toolbar .sa-markup-color-btn:hover,
.sa-markup-toolbar .sa-markup-close-btn:hover {
  background: var(--bg3, #2d2d2d);
  border-color: var(--accent, #569cd6);
}
.sa-markup-toolbar .sa-tb-btn.active,
.sa-markup-toolbar .sa-tb-btn[aria-pressed="true"] {
  background: var(--accent, #569cd6);
  border-color: var(--accent, #569cd6);
  color: #fff;
}
.sa-markup-toolbar .sa-tb-btn svg {
  width: 18px;
  height: 18px;
}
.sa-markup-toolbar .sa-markup-close-btn svg {
  width: 14px;
  height: 14px;
}
.sa-markup-color-swatch {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border, #333);
  border-radius: 999px;
  pointer-events: none;
}
.sa-markup-palette {
  position: fixed;
  z-index: 56;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  width: 188px;
  padding: 6px;
  border: 1px solid var(--border, #333);
  border-radius: 6px;
  background: var(--ui-popup-bg, var(--bg2, #252525));
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}
.sa-markup-color-dot {
  width: 24px;
  min-width: 24px;
  height: 24px;
  min-height: 24px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 999px;
  cursor: pointer;
}
@media (max-width: 640px) {
  .sa-markup-toolbar {
    left: 8px;
    right: 8px;
    bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    transform: none;
    justify-content: center;
    flex-wrap: wrap;
    gap: 6px;
    max-width: calc(100vw - 16px);
    padding: 6px;
  }
  .sa-markup-toolbar .sa-tb-btn,
  .sa-markup-toolbar .sa-markup-color-btn,
  .sa-markup-toolbar .sa-markup-close-btn {
    width: 44px;
    min-width: 44px;
    height: 44px;
    min-height: 44px;
  }
  .sa-markup-toolbar .sa-tb-btn svg {
    width: 20px;
    height: 20px;
  }
  .sa-markup-toolbar .sa-markup-close-btn svg {
    width: 18px;
    height: 18px;
  }
  .sa-markup-palette {
    width: min(260px, calc(100vw - 16px));
    gap: 6px;
    padding: 8px;
  }
  .sa-markup-color-dot {
    width: 44px;
    min-width: 44px;
    height: 44px;
    min-height: 44px;
  }
}`;

function _ensureStandaloneMarkupToolbarStyles() {
  if (document.getElementById('meldex-standalone-markup-toolbar-styles')) return;
  const style = document.createElement('style');
  style.id = 'meldex-standalone-markup-toolbar-styles';
  style.textContent = STANDALONE_MARKUP_TOOLBAR_CSS;
  document.head.appendChild(style);
}

function createMarkupToolbar(markup, parentEl) {
  _ensureStandaloneMarkupToolbarStyles();
  let tb = parentEl.querySelector('.sa-markup-toolbar');
  if (tb) return tb;
  tb = document.createElement('div');
  tb.className = 'sa-toolbar sa-markup-toolbar';
  tb.dataset.markupToolbar = '1';
  tb.setAttribute('role', 'toolbar');
  tb.setAttribute('aria-label', '注釈ツールバー');
  let palette = null;
  let closePaletteTimer = null;
  let paletteOutsideHandler = null;
  let paletteKeyHandler = null;
  const closePalette = () => {
    if (closePaletteTimer) clearTimeout(closePaletteTimer);
    closePaletteTimer = null;
    if (paletteOutsideHandler) document.removeEventListener('pointerdown', paletteOutsideHandler, true);
    if (paletteKeyHandler) document.removeEventListener('keydown', paletteKeyHandler, true);
    paletteOutsideHandler = null;
    paletteKeyHandler = null;
    palette?.remove();
    palette = null;
    colorBtn?.setAttribute?.('aria-expanded', 'false');
  };
  const updateToolButtons = (selectedBtn) => {
    tb.querySelectorAll('.sa-tb-btn').forEach(b => {
      const active = b === selectedBtn;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  };
  [{ name:'pen',icon:'pencil',title:'ペン' },{ name:'marker',icon:'highlighter',title:'マーカー' },{ name:'lasso',icon:'lasso',title:'投げ縄' },{ name:'rect',icon:'square',title:'矩形塗り' },{ name:'eraser',icon:'eraser',title:'消しゴム' },{ name:'sticky',icon:'stickyNote',title:'付箋' }].forEach(t => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sa-tb-btn' + (t.name === 'pen' ? ' active' : '');
    btn.dataset.tool = t.name; btn.title = t.title; btn.setAttribute('aria-label', t.title); btn.setAttribute('aria-pressed', t.name === 'pen' ? 'true' : 'false'); btn.innerHTML = lucide(t.icon, 18);
    btn.onclick = () => { markup.setTool(t.name); updateToolButtons(btn); };
    tb.appendChild(btn);
  });
  const colorBtn = document.createElement('button');
  colorBtn.type = 'button';
  colorBtn.className = 'sa-markup-color-btn';
  colorBtn.title = '色';
  colorBtn.setAttribute('aria-label', '注釈色');
  colorBtn.setAttribute('aria-haspopup', 'dialog');
  colorBtn.setAttribute('aria-expanded', 'false');
  const colorSwatch = document.createElement('span');
  colorSwatch.className = 'sa-markup-color-swatch';
  colorSwatch.style.background = markup.ann.color || PALETTE_COLORS[0];
  colorBtn.appendChild(colorSwatch);
  colorBtn.onclick = () => {
    if (palette) { closePalette(); return; }
    palette = document.createElement('div');
    palette.className = 'sa-palette sa-markup-palette';
    palette.setAttribute('role', 'dialog');
    palette.setAttribute('aria-label', '注釈色');
    PALETTE_COLORS.forEach(c => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'sa-markup-color-dot';
      dot.title = c;
      dot.setAttribute('aria-label', `注釈色 ${c}`);
      dot.style.background = c;
      dot.onclick = () => { markup.setColor(c); colorSwatch.style.background = c; closePalette(); };
      palette.appendChild(dot);
    });
    document.body.appendChild(palette);
    colorBtn.setAttribute('aria-expanded', 'true');
    positionPopup(palette, colorBtn.getBoundingClientRect(), { prefer: 'right', gap: 8, avoidRect: tb.getBoundingClientRect() });
    paletteKeyHandler = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); closePalette(); colorBtn.focus(); } };
    paletteOutsideHandler = (ev) => { if (!palette?.contains(ev.target) && !colorBtn.contains(ev.target)) closePalette(); };
    closePaletteTimer = setTimeout(() => {
      document.addEventListener('pointerdown', paletteOutsideHandler, true);
      document.addEventListener('keydown', paletteKeyHandler, true);
    }, 0);
  };
  tb.appendChild(colorBtn);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'sa-markup-close-btn';
  closeBtn.innerHTML = lucide('x', 14); closeBtn.title = '閉じる'; closeBtn.setAttribute('aria-label', '閉じる');
  closeBtn.onclick = () => { closePalette(); markup.toggle(false); tb.style.display = 'none'; const trigger = document.getElementById('btn-markup'); trigger?.classList.remove('active'); trigger?.setAttribute?.('aria-pressed', 'false'); };
  tb.appendChild(closeBtn);
  parentEl.appendChild(tb);
  return tb;
}

// === ポップアップ位置制御（共通ヘルパー） ===
// pywebview/WebView2環境ではwindow.innerWidth/Heightが不正確な場合があるため
// document.documentElement.clientWidth/Heightを使用する
function _popupCssRect(rect, z) {
  if (!rect) return null;
  const left = Number(rect.left);
  const right = Number(rect.right);
  const top = Number(rect.top);
  const bottom = Number(rect.bottom);
  if (![left, right, top, bottom].every(Number.isFinite)) return null;
  return { left: left / z, right: right / z, top: top / z, bottom: bottom / z };
}

function _popupClampValue(value, min, max) {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

function _popupRectsOverlap(a, b, gap = 0) {
  if (!a || !b) return false;
  return !(
    a.right <= b.left - gap
    || a.left >= b.right + gap
    || a.bottom <= b.top - gap
    || a.top >= b.bottom + gap
  );
}

function _popupCandidateRect(left, top, width, height) {
  return { left, top, right: left + width, bottom: top + height };
}

function _fitPopupAroundAvoidRect(baseLeft, baseTop, pw, ph, vw, vh, gap, avoid) {
  if (!avoid) return { left: baseLeft, top: baseTop };
  const maxLeft = vw - pw - gap;
  const maxTop = vh - ph - gap;
  const xNearAnchor = _popupClampValue(baseLeft, gap, maxLeft);
  const yNearAnchor = _popupClampValue(baseTop, gap, maxTop);
  const candidates = [
    { left: xNearAnchor, top: avoid.bottom + gap, side: 'below', space: vh - avoid.bottom - gap },
    { left: xNearAnchor, top: avoid.top - ph - gap, side: 'above', space: avoid.top - gap },
    { left: avoid.right + gap, top: yNearAnchor, side: 'right', space: vw - avoid.right - gap },
    { left: avoid.left - pw - gap, top: yNearAnchor, side: 'left', space: avoid.left - gap },
  ];

  for (const candidate of candidates) {
    const left = _popupClampValue(candidate.left, gap, maxLeft);
    const top = _popupClampValue(candidate.top, gap, maxTop);
    const rect = _popupCandidateRect(left, top, pw, ph);
    const fitsViewport = left >= gap && top >= gap && rect.right <= vw - gap && rect.bottom <= vh - gap;
    if (fitsViewport && !_popupRectsOverlap(rect, avoid, 0)) return { left, top };
  }

  const vertical = candidates
    .filter(c => c.side === 'below' || c.side === 'above')
    .filter(c => c.space >= 72)
    .sort((a, b) => b.space - a.space)[0];
  if (vertical) {
    const left = _popupClampValue(vertical.left, gap, maxLeft);
    const top = vertical.side === 'above'
      ? Math.max(gap, avoid.top - Math.min(ph, vertical.space) - gap)
      : avoid.bottom + gap;
    return { left, top, maxHeight: Math.max(72, vertical.space) };
  }

  const horizontal = candidates
    .filter(c => c.side === 'right' || c.side === 'left')
    .filter(c => c.space >= 72)
    .sort((a, b) => b.space - a.space)[0];
  if (horizontal) {
    const left = horizontal.side === 'left'
      ? Math.max(gap, avoid.left - Math.min(pw, horizontal.space) - gap)
      : avoid.right + gap;
    const top = _popupClampValue(horizontal.top, gap, maxTop);
    return { left, top, maxWidth: Math.max(72, horizontal.space) };
  }

  return {
    left: _popupClampValue(baseLeft, gap, maxLeft),
    top: _popupClampValue(baseTop, gap, maxTop),
  };
}

function positionPopup(popup, anchorRect, options = {}) {
  const z = _getZoom();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const gap = options.gap ?? 4;
  const preferDirection = options.prefer || 'below'; // 'below' | 'right'
  // anchorRectはgetBoundingClientRect()由来（viewport pixels）なのでCSS座標に変換
  const ar = _popupCssRect(anchorRect, z);
  const avoid = _popupCssRect(options.avoidRect, z);
  if (!ar) return;
  // 非表示でDOMに追加して測定
  popup.style.maxHeight = '';
  popup.style.maxWidth = '';
  popup.style.overflowY = '';
  popup.style.overflowX = '';
  popup.style.visibility = 'hidden';
  if (!popup.parentNode) document.body.appendChild(popup);
  const pw = popup.offsetWidth;
  const ph = popup.offsetHeight;
  let left, top;
  if (preferDirection === 'right') {
    // 右に表示、収まらなければ左
    left = ar.right + gap;
    if (left + pw > vw) left = Math.max(gap, ar.left - pw - gap);
    if (left + pw > vw) left = Math.max(gap, vw - pw - gap);
    top = ar.top;
  } else {
    // 下に表示
    left = ar.left;
    top = ar.bottom + gap;
  }
  // 右端チェック
  if (left + pw > vw) left = Math.max(gap, vw - pw - gap);
  // 下端チェック
  const spaceBelow = vh - ar.bottom - gap;
  const spaceAbove = ar.top - gap;
  if (top + ph > vh) {
    if (ph <= spaceAbove) {
      top = ar.top - ph - gap;
    } else if (spaceBelow >= spaceAbove) {
      top = ar.bottom + gap;
      popup.style.maxHeight = Math.max(120, spaceBelow) + 'px';
      popup.style.overflowY = 'auto';
    } else {
      top = gap;
      popup.style.maxHeight = Math.max(120, spaceAbove) + 'px';
      popup.style.overflowY = 'auto';
    }
  }
  // 上端チェック
  if (top < gap) top = gap;
  if (avoid) {
    const fitted = _fitPopupAroundAvoidRect(left, top, pw, ph, vw, vh, gap, avoid);
    left = fitted.left;
    top = fitted.top;
    if (fitted.maxHeight != null) {
      popup.style.maxHeight = fitted.maxHeight + 'px';
      popup.style.overflowY = 'auto';
    }
    if (fitted.maxWidth != null) {
      popup.style.maxWidth = fitted.maxWidth + 'px';
      popup.style.overflowX = 'auto';
    }
  }
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
  popup.style.visibility = 'visible';
  // 最終安全策: clampPopupToViewportで確実にビューポート内に収める
  clampPopupToViewport(popup);
}

// ============================================================
// 長押し検知ヘルパー: iPad など contextmenu が安定しない環境向けに、
// タッチ/ペン入力の長押しで handler を発火させる。マウスは触らない
// （従来の contextmenu で右クリックメニューがそのまま使える）。
//
// 使い方:
//   addLongPressHandler(el, (ev) => { myMenuFn(ev, ...); });
//   ev は clientX/Y/target/currentTarget/preventDefault/stopPropagation を
//   持つ合成オブジェクト。既存の contextmenu ハンドラにそのまま渡せる。
// ============================================================
function addLongPressHandler(el, handler, opts = {}) {
  const DURATION = opts.duration ?? opts.delayMs ?? 500;
  const MOVE_THRESHOLD = opts.moveThreshold ?? opts.moveTolerance ?? 10;
  let timer = null;
  let startX = 0, startY = 0;
  let fired = false;
  let touchStartEv = null;

  const cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };

  el.addEventListener('pointerdown', (e) => {
    // タッチと Apple Pencil 等のペン入力のみ対象。マウスは無視
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    if (e.button !== 0 && e.button !== undefined && e.button !== -1) return;
    cancel();
    fired = false;
    startX = e.clientX;
    startY = e.clientY;
    touchStartEv = e;
    timer = setTimeout(() => {
      timer = null;
      fired = true;
      handler({
        clientX: startX,
        clientY: startY,
        target: touchStartEv?.target || el,
        currentTarget: el,
        pointerType: touchStartEv?.pointerType || 'touch',
        preventDefault: () => {},
        stopPropagation: () => {},
      });
    }, DURATION);
  });

  el.addEventListener('pointermove', (e) => {
    if (!timer) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (dx * dx + dy * dy > MOVE_THRESHOLD * MOVE_THRESHOLD) cancel();
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => {
    el.addEventListener(ev, cancel);
  });

  // 長押し発火後の click / contextmenu は同ノードの他リスナーも含めて抑止
  // （stopPropagation だと同ノードの bubble リスナーが走る可能性があるため
  //  stopImmediatePropagation を使う）
  el.addEventListener('click', (e) => {
    if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; }
  }, true);
  el.addEventListener('contextmenu', (e) => {
    if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; }
  }, true);
}

function _isNativeContextMenuSurface(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return !!target.closest('#html-view, #html-iframe');
}

// Meldex 全域でブラウザ標準右クリックメニューを抑止（input / textarea / HTMLビューワー は除外）。
// 旧 gb-editor.part04.js のルビハンドラ冒頭にあった同処理をここへ移管（capture phase）。
document.addEventListener('contextmenu', (e) => {
  if (_isNativeContextMenuSurface(e.target)) return;
  if (!e.target.matches('input, textarea')) e.preventDefault();
}, true);

// ============================================================
// 確認ダイアログ（モーダル）
// ============================================================
let _showConfirmDialogSeq = 0;
function showConfirmDialog(message, onOk, onCancel) {
  const focusReturnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialogId = 'show-confirm-dialog-' + (++_showConfirmDialogSeq);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.e2eId = 'show-confirm-dialog-overlay';
  overlay.dataset.confirmDialog = '1';

  const modal = document.createElement('div');
  modal.className = 'modal show-confirm-dialog';
  modal.dataset.e2eId = 'show-confirm-dialog';
  modal.setAttribute('role', 'alertdialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', '確認');
  modal.setAttribute('aria-describedby', dialogId + '-body');
  modal.tabIndex = -1;

  const body = document.createElement('div');
  body.id = dialogId + '-body';
  body.className = 'modal-body show-confirm-dialog-body';
  body.dataset.e2eId = 'show-confirm-dialog-body';
  body.textContent = String(message ?? '');

  const buttonRow = document.createElement('div');
  buttonRow.className = 'btn-row show-confirm-dialog-actions';
  buttonRow.dataset.e2eId = 'show-confirm-dialog-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'cancel-btn';
  cancelBtn.dataset.e2eId = 'show-confirm-dialog-cancel';
  cancelBtn.textContent = 'キャンセル';

  const okBtn = document.createElement('button');
  okBtn.type = 'button';
  okBtn.className = 'primary ok-btn';
  okBtn.dataset.e2eId = 'show-confirm-dialog-ok';
  okBtn.textContent = 'OK';

  buttonRow.append(cancelBtn, okBtn);
  modal.append(body, buttonRow);
  overlay.appendChild(modal);

  let closed = false;
  const restoreFocus = () => {
    if (focusReturnTarget?.isConnected && typeof focusReturnTarget.focus === 'function') {
      try { focusReturnTarget.focus({ preventScroll: true }); } catch (_) { focusReturnTarget.focus(); }
    }
  };
  const queueFocusRestore = () => {
    setTimeout(() => {
      const active = document.activeElement;
      if (!active || !active.isConnected || active === document.body || active === document.documentElement || active === focusReturnTarget) {
        restoreFocus();
      }
    }, 0);
  };
  const close = (confirmed) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
    restoreFocus();
    queueFocusRestore();
    if (confirmed) {
      if (onOk) onOk();
    } else if (onCancel) {
      onCancel();
    }
  };
  function onKeyDown(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    close(false);
  }

  okBtn.addEventListener('click', () => close(true));
  cancelBtn.addEventListener('click', () => close(false));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
  document.addEventListener('keydown', onKeyDown);
  document.body.appendChild(overlay);
  window.GBModalShell?.enhanceOverlay?.(overlay);
  setTimeout(() => {
    try { okBtn.focus({ preventScroll: true }); } catch (_) { okBtn.focus(); }
  }, 0);
  return overlay;
}

// ============================================================
// contentEditable外クリック時の即時blur（2回クリック問題の回避）
// ============================================================
// WebView2/Chromiumでは、contentEditable要素にフォーカスがある状態で
// その外をクリックすると、最初のクリックがフォーカス解除に消費され、
// ターゲットのクリックハンドラが動作しない。
// capture phaseでblurを先に実行することで、1回のクリックで操作可能にする。
function _focusedContentEditableHost(active = document.activeElement) {
  if (!active || active === document.body || active === document.documentElement) return null;
  if (active.contentEditable === 'true' || active.contentEditable === 'plaintext-only' || active.isContentEditable) {
    return active.closest?.('[contenteditable="true"], [contenteditable="plaintext-only"], [contenteditable]:not([contenteditable="false"])') || active;
  }
  return null;
}

document.addEventListener('pointerdown', (e) => {
  const focused = _focusedContentEditableHost();
  if (focused && !focused.contains(e.target)) focused.blur();
}, true);

// Export for ES module usage (optional)
if (typeof window !== 'undefined') {
  window.CF = {
    API_BASE, apiFetch, apiPost, apiPut,
    esc, formatFileSize, showStatus, getCssVar, rgbToHex,
    LUCIDE, lucide, fileTypeIcon, replaceIcons,
    FILE_TYPE_LABELS, NATIVE_TYPES, PALETTE_COLORS, PALETTE_BG_COLORS,
    inheritParentTheme, loadThemeFromServer,
    positionPopup,
    initIframeMarkup, initStandaloneMarkup, createMarkupToolbar,
  };
}

function enableCheckboxDragToggle(container, scopeSelector) {
  if (!container || container._cbDragToggleInstalled) return;
  container._cbDragToggleInstalled = true;
  container.addEventListener('pointerdown', (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb || cb.disabled) return;
    if (scopeSelector && !cb.closest(scopeSelector)) return;
    const newState = !cb.checked;
    cb.checked = newState;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    container._cbDragState = { checked: newState };
    e.preventDefault();
    const onUp = () => {
      delete container._cbDragState;
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
    };
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
  });
  container.addEventListener('pointerover', (e) => {
    if (!container._cbDragState) return;
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb || cb.disabled) return;
    if (scopeSelector && !cb.closest(scopeSelector)) return;
    if (cb.checked === container._cbDragState.checked) return;
    cb.checked = container._cbDragState.checked;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
document.addEventListener('DOMContentLoaded', () => {
  enableCheckboxDragToggle(document.body, '.modal-overlay');
}, { once: true });
