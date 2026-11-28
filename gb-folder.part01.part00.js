/**
 * Folder view link and membership helpers.
 */

let _folderMembershipCache = new Map();
let _folderMembershipLoading = new Set();
let _folderTagCache = new Map();
let _folderTagLoading = new Set();
let _folderRenderSeq = 0;
const FOLDER_PANEL_RENDER_CHUNK_SIZE = 80;
const WEB_PREVIEWABLE_IMAGE = new Set(['image']);
let _folderPath = '';
let _folderItems = [];
const _folderPendingMovePaths = new Set();
const _folderPendingPasteMoves = new Set();
let _folderBrowseIncomplete = null;
let _folderUnifiedSearchPaths = new Set();
let _folderUnifiedSearchSeq = 0;
let _folderUnifiedSearchTimer = 0;

function _folderSearchHintEl() {
  return document.getElementById('folder-panel-search-hint');
}

function _refreshFolderUnifiedSearch(query) {
  const text = String(query || '').trim();
  const seq = ++_folderUnifiedSearchSeq;
  const folderPath = _folderPath;
  _folderUnifiedSearchPaths = new Set();
  const hasTagCondition = (window.MeldexUnifiedSearch?.readTagCondition?.().tagIds || []).length > 0;
  // クエリの言語チェックだけは通信を待たず即時に出す。使えない理由は
  // 検索結果が返ってから追加で反映する。
  window.MeldexUnifiedSearch?.updateHint?.(_folderSearchHintEl(), null, text);
  if ((!text && !hasTagCondition) || !window.MeldexUnifiedSearch?.search) return Promise.resolve();
  const scopes = window.MeldexUnifiedSearch.active();
  if (!hasTagCondition && !scopes.some(scope => scope !== 'name')) return Promise.resolve();
  return window.MeldexUnifiedSearch.search(text, { path: folderPath || '', limit: 100 })
    .then(data => {
      if (seq !== _folderUnifiedSearchSeq || folderPath !== _folderPath) return;
      _folderUnifiedSearchPaths = new Set((data.results || []).map(item => String(item.path || '').replace(/\\/g, '/').toLowerCase()));
      if (typeof renderFolderGrid === 'function') renderFolderGrid();
      window.MeldexUnifiedSearch?.updateHint?.(_folderSearchHintEl(), data, text);
    })
    .catch(error => {
      if (seq !== _folderUnifiedSearchSeq || folderPath !== _folderPath) return;
      // 前回の検索結果を残したままにしない。名前の一致だけで描き直し、失敗を原因つきで出す。
      _folderUnifiedSearchPaths = new Set();
      if (typeof renderFolderGrid === 'function') renderFolderGrid();
      window.MeldexUnifiedSearch?.updateHint?.(_folderSearchHintEl(), null, text);
      _folderReportFailure('フォルダ内を検索できませんでした（名前の一致だけを表示しています）', error);
    });
}

// 失敗の理由を、利用者向けの短い文に整える。フォルダツリー側の整形があればそれに揃える。
function _folderFailureReason(error) {
  if (typeof _outlinerFailureReason === 'function') return _outlinerFailureReason(error);
  if (!error) return '';
  if (error.name === 'AbortError') return '中断されました';
  if (error instanceof TypeError || error instanceof ReferenceError) return '予期しないエラーが発生しました';
  return String(error?.message || '').replace(/^HTTP\s*\d+\s*:\s*/i, '').trim().slice(0, 120);
}

function _folderReportFailure(message, error) {
  const reason = _folderFailureReason(error);
  showStatus(reason ? `${message}：${reason}` : message, true);
}

// 右クリックメニュー項目の実行。非同期の処理も待ち、失敗を原因つきで表示する。
async function _folderRunMenuAction(fn, label) {
  try {
    return await fn();
  } catch (error) {
    if (typeof console !== 'undefined') console.error('[folder menu] 実行に失敗', error);
    _folderReportFailure(label ? `「${label}」を実行できませんでした` : '操作を実行できませんでした', error);
    return undefined;
  }
}

// 複数項目の複製。部分失敗も成功件数・失敗件数・最初の原因を表示する。
async function _folderDuplicateItems(items, refresh) {
  const result = await _outlinerDuplicateItems(items, { refresh });
  if (result.ok > 0 && typeof refresh === 'function') {
    // ツリーも複製したフォルダの子だけを差分で反映する（以前はツリーに出るのが次の読み直しまで遅れていた）
    const treeSync = typeof folderToolbarSyncTree === 'function'
      ? folderToolbarSyncTree((items || []).map(target => _folderDirectParentKey(target.path))).catch(() => null)
      : null;
    // 確定した複製を既に描けた面は、そのカードを消して再読込しない。履歴用のrefreshは上で保持する。
    const reflected = result.created?.length > 0 && result.created.every(path =>
      result.panelReflectedPaths?.includes(path) && typeof _folderPath !== 'undefined'
      && typeof _folderDropPathsEqual === 'function' && _folderDropPathsEqual(_folderPath, _folderDirectParentKey(path))
      && _folderItems.some(item => _folderDropPathsEqual(item.path, path)));
    if (!reflected) {
      try { await refresh(); } catch (error) { console.error('[folder duplicate] 表示の更新に失敗', error); }
    }
    await treeSync;
  }
  const reason = result.failed ? _folderFailureReason(result.error) : '';
  const suffix = reason ? `：${reason}` : '';
  if (!result.failed) showStatus(`${result.ok} 件を複製しました`);
  else if (!result.ok) showStatus(`複製に失敗しました${suffix}`, true);
  else showStatus(`${result.ok} 件を複製しました。${result.failed} 件は失敗しました${suffix}`, true);
  return result;
}

function _scheduleFolderUnifiedSearch(query) {
  clearTimeout(_folderUnifiedSearchTimer);
  _folderUnifiedSearchTimer = setTimeout(() => {
    _folderUnifiedSearchTimer = 0;
    _refreshFolderUnifiedSearch(query);
  }, 240);
}

function _folderSearchRowHasTagCondition() {
  return (window.MeldexUnifiedSearch?.readTagCondition?.().tagIds || []).length > 0;
}

window.addEventListener('meldex:search-scopes-changed', () => {
  const cfg = typeof getFolderDisplayConfig === 'function' ? getFolderDisplayConfig() : {};
  const query = String(cfg.filterText || '');
  if (query.trim() || _folderSearchRowHasTagCondition()) _scheduleFolderUnifiedSearch(query);
});
let _folderSelected = null;
let _folderSelectedItems = []; // 複数選択
let _folderLayout = localStorage.getItem('folder-layout') || 'waterfall';
let _folderVisibleItems = [];
// パネル表示状態は_getFvPanelCfg()で管理（旧_folderPreviewVisibleは廃止）
const _savedFolderThumbnailPx = parseInt(localStorage.getItem('folder-thumbnail-size-px') || '', 10);
let _folderZoom = Number.isFinite(_savedFolderThumbnailPx)
  ? Math.max(48, Math.min(1000, _savedFolderThumbnailPx)) / 120
  : parseFloat(localStorage.getItem('folder-zoom') || '1');
// フォルダの表示は「面」ごとに状態を持つ（2026-11-24）。面 = メインのフォルダパネル（#folder-grid）と、
// サブパネル等の独立した描画先（openFolder の containerEl）。
// _folderPath / _folderItems / _folderSelected などの変数は「今つないでいる面」の状態で、面を切り替える時に
// 前の面の状態を退避し、次の面の状態を戻す（描画先のDOMには触らない）。これでメインとサブパネルが
// 別々のフォルダ・選択・スクロール・大きなフォルダの表示を同時に持てる。
// - 利用者が操作している面（_folderInteractionSurface）: クリック・右クリック・ドラッグ・ドロップ・フォーカスで切り替わる。
//   キー操作・ツールバー・切り取り／貼り付け・削除は、この面の状態へ作用する。
// - 一時的につなぐ（_folderEnterSurface / _folderOnSurface）: 操作中でない面の読み込みの続き・描画の続き・
//   スクロールの追従などが、自分の面の状態で動くための入口。処理の区切りで操作中の面へ戻る。
// _folderRenderContainerOverride は「今つないでいる面の描画先」（null = メイン）。#folder-item-count・
// #folder-layout-select・一括操作バー・プレビューなどメイン専用のUIは、メインをつないでいる時だけ触る。
let _folderRenderContainerOverride = null;
const _folderSurfaceStates = new Map();   // 描画先の要素（メインは 'main'）→ 退避した状態
const _folderSurfaceLoadSeq = new Map();  // 描画先の要素（メインは 'main'）→ 最後に始めた読み込みの番号
let _folderInteractionSurface = null;     // 利用者が操作している面の描画先（null = メイン）
let _folderSurfaceLeaveQueued = false;

function _folderSurfaceKey(override) { return override || 'main'; }

function _folderCurrentSurface() { return _folderRenderContainerOverride || null; }

function _folderCaptureSurfaceState() {
  return {
    path: _folderPath, items: _folderItems, selected: _folderSelected, selectedItems: _folderSelectedItems,
    visibleItems: _folderVisibleItems, browseIncomplete: _folderBrowseIncomplete,
    unifiedSearchPaths: _folderUnifiedSearchPaths, layout: _folderLayout, zoom: _folderZoom, renderSeq: _folderRenderSeq,
    waterfallOb: typeof _waterfallResizeOb !== 'undefined' ? _waterfallResizeOb : null,
    waterfallRaf: typeof _waterfallLayoutRaf !== 'undefined' ? _waterfallLayoutRaf : 0,
    waterfallWidth: typeof _waterfallObservedWidth !== 'undefined' ? _waterfallObservedWidth : 0,
    large: globalThis.MeldexFolderLarge?.swapState ? globalThis.MeldexFolderLarge.swapState(null) : null,
  };
}

function _folderApplySurfaceState(saved) {
  const state = saved || {};
  _folderPath = state.path || '';
  _folderItems = Array.isArray(state.items) ? state.items : [];
  _folderSelected = state.selected || null;
  _folderSelectedItems = Array.isArray(state.selectedItems) ? state.selectedItems : [];
  _folderVisibleItems = Array.isArray(state.visibleItems) ? state.visibleItems : [];
  _folderBrowseIncomplete = state.browseIncomplete || null;
  _folderUnifiedSearchPaths = state.unifiedSearchPaths || new Set();
  // 新しい面の表示形式・大きさは、開く時にそのフォルダの保存値で決まる（それまでは直前の値のまま）
  if (state.layout) _folderLayout = state.layout;
  if (Number.isFinite(state.zoom)) _folderZoom = state.zoom;
  _folderRenderSeq = state.renderSeq || 0;
  if (typeof _waterfallResizeOb !== 'undefined') {
    _waterfallResizeOb = state.waterfallOb || null;
    _waterfallLayoutRaf = state.waterfallRaf || 0;
    _waterfallObservedWidth = state.waterfallWidth || 0;
  }
  globalThis.MeldexFolderLarge?.swapState?.(state.large || null);
  // 表示設定（フォルダごと）の「現在のフォルダ」も、つないでいる面へ合わせる
  globalThis.MeldexFolderDisplaySettings?.bind?.(_folderPath);
}

// 退避してある面の後始末（タイマー・監視を止める）。
function _folderDisposeSurfaceState(saved) {
  if (!saved) return;
  try { saved.waterfallOb?.disconnect?.(); } catch {}
  try { globalThis.MeldexFolderLarge?.disposeState?.(saved.large); } catch {}
}

// 面をつなぎ替える（状態の入れ替えだけ。DOMには触らない）。つなげたら true。
function _folderBindSurface(override) {
  const next = override || null;
  const current = _folderRenderContainerOverride || null;
  if (next === current) return true;
  if (next && !next.isConnected) return false;
  if (current && !current.isConnected) {
    // 今の面の描画先は外された（サブパネルを閉じた等）。状態は捨てる。
    _folderDisposeSurfaceState(_folderCaptureSurfaceState());
    _folderSurfaceLoadSeq.delete(current);
    if (_folderInteractionSurface === current) _folderInteractionSurface = null;
  } else {
    _folderSurfaceStates.set(_folderSurfaceKey(current), _folderCaptureSurfaceState());
  }
  const key = _folderSurfaceKey(next);
  const saved = _folderSurfaceStates.get(key) || null;
  _folderSurfaceStates.delete(key);
  _folderRenderContainerOverride = next;
  _folderApplySurfaceState(saved);
  return true;
}

// 外された描画先の状態を捨てる。
function _folderPruneSurfaces() {
  for (const [key, saved] of [..._folderSurfaceStates]) {
    if (key === 'main' || key.isConnected) continue;
    _folderDisposeSurfaceState(saved);
    _folderSurfaceStates.delete(key);
    _folderSurfaceLoadSeq.delete(key);
    if (_folderInteractionSurface === key) _folderInteractionSurface = null;
  }
}

// 描画先を明示的に手放す（サブパネルが内容を片付ける時）。
function _folderReleaseSurface(element) {
  if (!element) return;
  if (_folderInteractionSurface === element) _folderInteractionSurface = null;
  if (_folderRenderContainerOverride === element) {
    _folderDisposeSurfaceState(_folderCaptureSurfaceState());
    const saved = _folderSurfaceStates.get('main') || null;
    _folderSurfaceStates.delete('main');
    _folderRenderContainerOverride = null;
    _folderApplySurfaceState(saved);
  } else {
    _folderDisposeSurfaceState(_folderSurfaceStates.get(element));
    _folderSurfaceStates.delete(element);
  }
  _folderSurfaceLoadSeq.delete(element);
  if ((_folderRenderContainerOverride || null) !== (_folderInteractionSurface || null)) _folderBindSurface(_folderInteractionSurface);
  if (typeof _updateFolderBulkBar === 'function') _updateFolderBulkBar();
}

// 利用者が操作する面を切り替える。以後のキー操作・ツールバー・貼り付け・削除はこの面へ作用する。
function _folderActivateSurface(override) {
  const next = override && override.isConnected ? override : null;
  const changed = (_folderInteractionSurface || null) !== next || (_folderRenderContainerOverride || null) !== next;
  _folderInteractionSurface = next;
  _folderBindSurface(next);
  if (changed) {
    if (!next && _folderPath) {
      const select = document.getElementById('folder-layout-select');
      if (select) select.value = _folderLayout;
      if (typeof syncFolderLayoutControl === 'function') syncFolderLayoutControl();
    }
    if (typeof _updateFolderBulkBar === 'function') _updateFolderBulkBar();
  }
  return true;
}

function _folderLeaveSurface() {
  if (_folderInteractionSurface && !_folderInteractionSurface.isConnected) _folderInteractionSurface = null;
  if ((_folderRenderContainerOverride || null) === (_folderInteractionSurface || null)) return;
  _folderBindSurface(_folderInteractionSurface);
}

// 操作中でない面の処理の続きが、自分の面の状態で動くための入口。今の処理の区切り（呼び出しの連なりが
// 終わった所）で、操作中の面へ自動で戻る。描画先が外されていたら false（続きは捨てる）。
function _folderEnterSurface(override) {
  const next = override || null;
  if (next && !next.isConnected) { _folderPruneSurfaces(); return false; }
  if ((_folderRenderContainerOverride || null) === next) return true;
  if (!_folderBindSurface(next)) return false;
  if (!_folderSurfaceLeaveQueued) {
    _folderSurfaceLeaveQueued = true;
    const leave = () => { _folderSurfaceLeaveQueued = false; _folderLeaveSurface(); };
    if (typeof queueMicrotask === 'function') queueMicrotask(leave); else Promise.resolve().then(leave);
  }
  return true;
}

// fn をその面の状態で実行し、終わったらすぐ元の面へ戻す。描画先が外されていたら実行しない。
function _folderOnSurface(override, fn) {
  const next = override || null;
  if (next && !next.isConnected) { _folderPruneSurfaces(); return undefined; }
  const previous = _folderRenderContainerOverride || null;
  if (previous === next) return fn();
  if (!_folderBindSurface(next)) return undefined;
  try { return fn(); }
  finally {
    if ((_folderRenderContainerOverride || null) === next) {
      _folderBindSurface(previous && !previous.isConnected ? _folderInteractionSurface : previous);
    }
  }
}

// メインのフォルダパネルが開いているフォルダ（サブパネル等の面をつないでいる間も、メインの面の値を返す）。
function _folderMainPath() {
  if (!_folderRenderContainerOverride) return _folderPath;
  return _folderSurfaceStates.get('main')?.path || '';
}

// 「今つないでいる面を読み直す」openFolder へ渡す指定。サブパネル等の面なら、その描画先と、メインの画面
// （表示の切替・履歴・タイトル）へ触らない指定を返す。メインの面なら空（従来どおり）。
function _folderSurfaceOpts() {
  const element = _folderResolveRenderOverride();
  return element ? { containerEl: element, skipShowView: true, skipGlobalUi: true, skipNavPush: true,
    skipSaveLastView: true, skipHighlight: true, silent: true } : {};
}

// イベントの対象が載っている面の描画先。メインは null、フォルダの面の外は undefined。
function _folderSurfaceOfTarget(target) {
  const element = target && target.nodeType === 1 ? target : target?.parentElement;
  if (!element || typeof element.closest !== 'function') return undefined;
  const independent = element.closest('.gb-subpanel-folder-root');
  if (independent) {
    return independent === _folderRenderContainerOverride || _folderSurfaceStates.has(independent) ? independent : undefined;
  }
  return element.closest('#folder-view') ? null : undefined;
}

// 表示しているすべての面（今つないでいる面 → 他の面）で fn を実行する。
function _folderForEachSurface(fn) {
  _folderPruneSurfaces();
  const bound = _folderRenderContainerOverride || null;
  const others = [..._folderSurfaceStates.keys()].map(key => (key === 'main' ? null : key));
  fn();
  others.forEach(element => { if (element !== bound) _folderOnSurface(element, fn); });
}

function _folderSamePathLoose(left, right) {
  const a = _normalizeFolderPathForCompare(left || '').toLowerCase();
  const b = _normalizeFolderPathForCompare(right || '').toLowerCase();
  if (a === b) return true;
  if (!a || !b) return false;
  return a.endsWith('/' + b) || b.endsWith('/' + a);
}

// 開いている他の面（今つないでいない面）のうち、変わったフォルダを表示している面を読み直す。
// folderPaths を省くと、他の面をすべて読み直す。続けて呼ばれた分は1回にまとめる。
let _folderOtherSurfaceRefreshTimer = 0;
let _folderOtherSurfaceRefreshPaths = null;
function _folderNotifyFoldersChanged(folderPaths) {
  if (!_folderSurfaceStates.size) return;
  if (!Array.isArray(folderPaths)) _folderOtherSurfaceRefreshPaths = 'all';
  else if (_folderOtherSurfaceRefreshPaths !== 'all') {
    _folderOtherSurfaceRefreshPaths = _folderOtherSurfaceRefreshPaths || [];
    folderPaths.forEach(path => { if (path !== undefined && path !== null) _folderOtherSurfaceRefreshPaths.push(String(path)); });
  }
  const origin = _folderRenderContainerOverride || null;
  clearTimeout(_folderOtherSurfaceRefreshTimer);
  _folderOtherSurfaceRefreshTimer = setTimeout(() => {
    _folderOtherSurfaceRefreshTimer = 0;
    const wanted = _folderOtherSurfaceRefreshPaths;
    _folderOtherSurfaceRefreshPaths = null;
    _folderRefreshOtherSurfaces(wanted === 'all' ? null : wanted, origin);
  }, 120);
}

function _folderRefreshOtherSurfaces(folderPaths, origin) {
  _folderPruneSurfaces();
  const skip = origin === undefined ? (_folderRenderContainerOverride || null) : origin;
  const surfaces = [_folderRenderContainerOverride || null];
  for (const key of _folderSurfaceStates.keys()) surfaces.push(key === 'main' ? null : key);
  surfaces.filter(element => element !== skip).forEach(element => {
    if (!element && !document.getElementById('folder-grid')?.isConnected) return;
    _folderOnSurface(element, () => {
      const path = _folderPath;
      if (!path) return;
      if (Array.isArray(folderPaths) && !folderPaths.some(changed => _folderSamePathLoose(changed, path))) return;
      if (globalThis.MeldexFolderLarge?.active?.()) { globalThis.MeldexFolderLarge.refresh(); return; }
      if (typeof openFolder !== 'function') return;
      const label = element ? (String(path).split('/').filter(Boolean).pop() || path)
        : (document.getElementById('folder-title')?.textContent || path);
      Promise.resolve(openFolder(label, path, {
        containerEl: element, keepInteractionSurface: true, silent: true,
        skipNavPush: true, skipShowView: true, skipSaveLastView: true, skipHighlight: true, skipGlobalUi: true,
      })).catch(error => console.warn('[folder] 他の面の読み直しに失敗しました', error));
    });
  });
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function'
    && typeof window !== 'undefined' && !window.__gbFolderSurfaceInteractionGuard) {
  window.__gbFolderSurfaceInteractionGuard = true;
  // 操作した面をつなぐ。カードやツールバーの処理より先に動くよう、キャプチャで受ける。
  const activate = event => {
    if (!_folderSurfaceStates.size && !_folderRenderContainerOverride) return; // 面が1つだけの間は何もしない
    const surface = _folderSurfaceOfTarget(event.target);
    if (surface === undefined) return;
    if (surface === (_folderInteractionSurface || null) && surface === (_folderRenderContainerOverride || null)) return;
    _folderActivateSurface(surface);
  };
  ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu', 'dragstart', 'dragenter', 'dragover', 'drop', 'focusin', 'touchstart']
    .forEach(type => document.addEventListener(type, activate, true));
}
const HOME_FOLDER_DISPLAY_LABEL = 'ホームフォルダ';

function _folderScheduleRenderFrame(callback) {
  if (typeof requestAnimationFrame === 'function' && document.visibilityState !== 'hidden') {
    requestAnimationFrame(callback);
    return;
  }
  setTimeout(callback, 0);
}

function _folderPanelRenderChunkSize(total) {
  return total > FOLDER_PANEL_RENDER_CHUNK_SIZE ? FOLDER_PANEL_RENDER_CHUNK_SIZE : Math.max(1, total || 1);
}

function _normalizeFolderPathForCompare(path) {
  return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function _folderDndPathKey(path) {
  const value = String(path || '').replace(/\\/g, '/').replace(/\/+/g, '/');
  const prefix = value.startsWith('/') ? '/' : '';
  const segments = [];
  value.split('/').forEach(segment => {
    if (!segment || segment === '.') return;
    if (segment === '..') {
      if (segments.length && segments[segments.length - 1] !== '..') segments.pop();
      else if (!prefix) segments.push(segment);
      return;
    }
    segments.push(segment);
  });
  return (prefix + segments.join('/')).replace(/\/+$/, '').toLowerCase();
}

function _folderDndPathIsAncestor(parentPath, childPath) {
  const parentKey = _folderDndPathKey(parentPath);
  const childKey = _folderDndPathKey(childPath);
  return !!parentKey && !!childKey && parentKey !== childKey && childKey.startsWith(parentKey + '/');
}

function _folderDragItemsForStart(primaryItem, selectedItems) {
  const primaryKey = _folderDndPathKey(primaryItem?.path);
  const candidates = (selectedItems || []).filter(item => item?.path);
  const withoutPrimaryAncestors = candidates.filter(item => {
    const key = _folderDndPathKey(item.path);
    return key === primaryKey || !_folderDndPathIsAncestor(item.path, primaryItem?.path);
  });
  const seen = new Set();
  return withoutPrimaryAncestors.filter(item => {
    const key = _folderDndPathKey(item.path);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return !withoutPrimaryAncestors.some(parent => parent !== item && _folderDndPathIsAncestor(parent.path, item.path));
  });
}

function _isHomeFolderPath(path) {
  try {
    return !!_homeFolderPath && _normalizeFolderPathForCompare(path) === _normalizeFolderPathForCompare(_homeFolderPath);
  } catch {
    return false;
  }
}

function _folderDisplayLabel(label, path) {
  if (_isHomeFolderPath(path)) return HOME_FOLDER_DISPLAY_LABEL;
  return String(label || '').trim();
}

function _folderItemRawUrl(item) {
  if (item?.archive_path && item?.archive_member) {
    return '/api/archive/file?path=' + encodeURIComponent(item.archive_path)
      + '&member=' + encodeURIComponent(item.archive_member);
  }
  if (item?.external_reference) {
    return item.external_raw_url || ('/api/external-reference/raw?path=' + encodeURIComponent(item.path));
  }
  return '/api/file-raw?path=' + encodeURIComponent(item.path);
}

function _folderItemThumbnailUrl(item, size = 384) {
  return '/api/thumbnail?path=' + encodeURIComponent(item.path) + '&size=' + encodeURIComponent(size);
}

function _folderItemViewerUrl(item, embed) {
  const suffix = embed ? '&embed=1' : '';
  if (item?.archive_path && item?.archive_member) {
    return '/viewer?archive=' + encodeURIComponent(item.archive_path)
      + '&member=' + encodeURIComponent(item.archive_member) + suffix;
  }
  return '/viewer?file=' + encodeURIComponent(item.path) + suffix;
}

function _syncFolderPanelPathToOutliner(path, opts) {
  if (!path || typeof highlightOutlinerNode !== 'function') return;
  highlightOutlinerNode(path, opts || {});
}

function _folderMembershipKey(path) {
  return _normalizeFolderPathForCompare(path);
}

function _folderNormalizeMemberships(rows) {
  const source = Array.isArray(rows) ? rows : (Array.isArray(rows?.folders) ? rows.folders : []);
  return source.map(row => {
    if (typeof row === 'string') return { folder: _folderMembershipKey(row), type: '' };
    return {
      folder: _folderMembershipKey(row?.folder || row?.path || row?.folder_path || ''),
      type: String(row?.type || ''),
      file_id: row?.file_id || '',
      added_at: row?.added_at || '',
    };
  }).filter(row => row.folder);
}

function _folderStoreMembershipsForPath(path, rows) {
  const key = _folderMembershipKey(path);
  if (!key) return [];
  const normalized = _folderNormalizeMemberships(rows);
  _folderMembershipCache.set(key, normalized);
  (_folderItems || []).forEach(item => {
    if (_folderMembershipKey(item?.path) === key) item._folderMemberships = normalized;
  });
  return normalized;
}

function _folderInvalidateMembershipsForPath(path) {
  const key = _folderMembershipKey(path);
  if (!key) return;
  _folderMembershipCache.delete(key);
  (_folderItems || []).forEach(item => {
    if (_folderMembershipKey(item?.path) === key) delete item._folderMemberships;
  });
}

function _folderItemMemberships(item) {
  const key = _folderMembershipKey(item?.path);
  if (!key) return [];
  if (Array.isArray(item?._folderMemberships)) return item._folderMemberships;
  if (_folderMembershipCache.has(key)) {
    item._folderMemberships = _folderMembershipCache.get(key);
    return item._folderMemberships;
  }
  return [];
}

function _folderMembershipsAreLoading(items) {
  return (items || []).some(item => _folderMembershipLoading.has(_folderMembershipKey(item?.path)));
}

function _folderWaitForMembershipLoads(items) {
  return new Promise(resolve => {
    let ticks = 0;
    const check = () => {
      if (!_folderMembershipsAreLoading(items) || ticks >= 200) {
        resolve(true);
        return;
      }
      ticks += 1;
      setTimeout(check, 50);
    };
    check();
  });
}

function _folderHasActiveFolderFilter(cfg) {
  return _folderFilterArray(cfg?.filterFolders).length > 0;
}

function _folderTagKey(path) {
  return _folderMembershipKey(path);
}

function _folderNormalizeTags(rows) {
  const source = Array.isArray(rows) ? rows : (Array.isArray(rows?.tags) ? rows.tags : []);
  return source.map(row => {
    if (typeof row === 'string') return { id: '', name: String(row || '') };
    return {
      id: String(row?.id || ''),
      name: String(row?.name || ''),
      color: String(row?.color || ''),
      group_id: row?.group_id || null,
      sort_index: Number(row?.sort_index || 0),
    };
  }).filter(row => row.id || row.name);
}

function _folderStoreTagsForPath(path, rows) {
  const key = _folderTagKey(path);
  if (!key) return [];
  const normalized = _folderNormalizeTags(rows);
  _folderTagCache.set(key, normalized);
  window.MeldexGlobalTags?.primeTargetTagsCache?.(path, normalized);
  (_folderItems || []).forEach(item => {
    if (_folderTagKey(item?.path) === key) item._folderTags = normalized;
  });
  return normalized;
}

function _folderInvalidateTagsForPath(path) {
  const key = _folderTagKey(path);
  if (!key) return;
  _folderTagCache.delete(key);
  window.MeldexGlobalTags?.invalidateTargetTagsCache?.(path);
  (_folderItems || []).forEach(item => {
    if (_folderTagKey(item?.path) === key) delete item._folderTags;
  });
}

function _folderInvalidateTagsForItems(items, options = {}) {
  const rows = Array.isArray(items) ? items : [];
  if (options.all === true) {
    _folderTagCache.clear();
    window.MeldexGlobalTags?.invalidateTargetTagsCache?.();
    rows.forEach(item => {
      if (item) delete item._folderTags;
    });
    return;
  }
  rows.forEach(item => _folderInvalidateTagsForPath(item?.path));
}

async function _folderRefreshTags(items, options = {}) {
  const rows = Array.isArray(items) ? items : [];
  if (_folderTagsAreLoading(rows)) await _folderWaitForTagLoads(rows);
  _folderInvalidateTagsForItems(rows, { all: options.all === true });
  return _folderEnsureTags(rows, { rerender: options.rerender === true });
}

function _folderItemTags(item) {
  const key = _folderTagKey(item?.path);
  if (!key) return [];
  if (Array.isArray(item?._folderTags)) return item._folderTags;
  if (_folderTagCache.has(key)) {
    item._folderTags = _folderTagCache.get(key);
    return item._folderTags;
  }
  return [];
}

function _folderTagsAreLoading(items) {
  return (items || []).some(item => _folderTagLoading.has(_folderTagKey(item?.path)));
}

function _folderWaitForTagLoads(items) {
  return new Promise(resolve => {
    let ticks = 0;
    const check = () => {
      if (!_folderTagsAreLoading(items) || ticks >= 200) {
        resolve(true);
        return;
      }
      ticks += 1;
      setTimeout(check, 50);
    };
    check();
  });
}

function _folderHasActiveTagFilter(cfg) {
  return _folderFilterArray(cfg?.filterTags).length > 0;
}

function _folderTagResultKey(path, sourceFolder) {
  const normalized = _folderTagKey(path);
  const source = _folderTagKey(sourceFolder);
  if (!normalized || !source) return normalized;
  if (normalized === source) return '.';
  return normalized.startsWith(source + '/') ? normalized.slice(source.length + 1) : normalized;
}

async function _folderEnsureTagsIndividually(targets) {
  let changed = false;
  for (let i = 0; i < targets.length; i += 8) {
    const batch = targets.slice(i, i + 8);
    await Promise.all(batch.map(async target => {
      try {
        const data = await apiFetch('/global-tags/target?path=' + encodeURIComponent(target.path), { silentError: true });
        _folderStoreTagsForPath(target.path, data?.tags || []);
        changed = true;
      } catch {
        _folderTagCache.set(target.key, []);
      } finally {
        _folderTagLoading.delete(target.key);
      }
    }));
  }
  return changed;
}

function _folderEnsureTags(items, options = {}) {
  const currentPath = _folderPath;
  const targets = [];
  const seen = new Set();
  (items || []).forEach(item => {
    const key = _folderTagKey(item?.path);
    if (!key || seen.has(key)) return;
    seen.add(key);
    if (_folderTagCache.has(key)) {
      item._folderTags = _folderTagCache.get(key);
      return;
    }
    if (!_folderTagLoading.has(key)) targets.push({ key, path: item.path });
  });
  if (targets.length === 0) {
    return _folderTagsAreLoading(items) ? _folderWaitForTagLoads(items) : Promise.resolve(false);
  }
  targets.forEach(target => _folderTagLoading.add(target.key));
  const tagSurface = _folderCurrentSurface();
  return (async () => {
    let changed = false;
    try {
      const data = await apiFetch(
        '/global-tags/search?tag=&path=' + encodeURIComponent(currentPath),
        { silentError: true },
      );
      if (!Array.isArray(data?.results)) throw new Error('タグ一覧の形式が不正です');
      const byPath = new Map();
      data.results.forEach(result => {
        byPath.set(_folderTagKey(result?.path), result?.tags || []);
      });
      targets.forEach(target => {
        const resultKey = _folderTagResultKey(target.path, data.source_folder);
        _folderStoreTagsForPath(target.path, byPath.get(resultKey) || []);
        _folderTagLoading.delete(target.key);
      });
      changed = true;
    } catch {
      changed = await _folderEnsureTagsIndividually(targets);
    }
    // 読み込みを頼んだ面（メイン／サブパネル）をつなぎ直してから描き直す
    if (changed && options.rerender && _folderEnterSurface(tagSurface) && _folderPath === currentPath) {
      renderFolderGrid({
        preserveSelectedPaths: (_folderSelectedItems || []).map(item => item?.path).filter(Boolean),
      });
    }
    return changed;
  })();
}

function _folderEnsureMemberships(items, options = {}) {
  const currentPath = _folderPath;
  const targets = [];
  const seen = new Set();
  (items || []).forEach(item => {
    const key = _folderMembershipKey(item?.path);
    if (!key || seen.has(key)) return;
    seen.add(key);
    if (_folderMembershipCache.has(key)) {
      item._folderMemberships = _folderMembershipCache.get(key);
      return;
    }
    if (!_folderMembershipLoading.has(key)) targets.push({ key, path: item.path });
  });
  if (targets.length === 0) {
    return _folderMembershipsAreLoading(items) ? _folderWaitForMembershipLoads(items) : Promise.resolve(false);
  }
  targets.forEach(target => _folderMembershipLoading.add(target.key));
  const membershipSurface = _folderCurrentSurface();
  return (async () => {
    let changed = false;
    for (let i = 0; i < targets.length; i += 8) {
      const batch = targets.slice(i, i + 8);
      await Promise.all(batch.map(async target => {
        try {
          const folders = await apiFetch('/file-folders?path=' + encodeURIComponent(target.path));
          _folderStoreMembershipsForPath(target.path, folders);
          changed = true;
        } catch {
          _folderMembershipCache.set(target.key, []);
        } finally {
          _folderMembershipLoading.delete(target.key);
        }
      }));
    }
    if (changed && options.rerender && _folderEnterSurface(membershipSurface) && _folderPath === currentPath) renderFolderGrid();
    return changed;
  })();
}

function _folderFilterFolderKeys(cfg) {
  return _folderFilterArray(cfg?.filterFolders).map(_folderMembershipKey).filter(Boolean);
}

function _folderMatchesFolderFilter(item, selectedFolders) {
  if (!selectedFolders || selectedFolders.size === 0) return true;
  return _folderItemMemberships(item).some(row => selectedFolders.has(_folderMembershipKey(row.folder)));
}

function _folderFilterTagKeys(cfg) {
  return _folderFilterArray(cfg?.filterTags).map(value => String(value || '').toLowerCase()).filter(Boolean);
}

// タグの判定方法（すべて含む=AND / どれかを含む=OR）。既定は「すべて含む」。
// 2026-08系のタグ選択フロートパネル導入までは常にOR固定だった。タグを2件以上
// 保存していた既存フィルタだけ結果が変わる（CHANGELOGへ明記）。
function _folderTagFilterMode(cfg) {
  return (cfg && cfg.filterTagMode === 'any') ? 'any' : 'all';
}

function _folderMatchesTagFilter(item, selectedTags, mode) {
  if (!selectedTags || selectedTags.size === 0) return true;
  const itemKeys = new Set();
  _folderItemTags(item).forEach(tag => {
    const id = String(tag.id || '').toLowerCase();
    const name = String(tag.name || '').toLowerCase();
    if (id) itemKeys.add(id);
    if (name) itemKeys.add(name);
  });
  if (mode === 'any') {
    for (const key of selectedTags) {
      if (itemKeys.has(key)) return true;
    }
    return false;
  }
  for (const key of selectedTags) {
    if (!itemKeys.has(key)) return false;
  }
  return true;
}

function _folderTagLabel(value) {
  const key = String(value || '').toLowerCase();
  for (const item of _folderItems || []) {
    for (const tag of _folderItemTags(item)) {
      if (String(tag.id || '').toLowerCase() === key || String(tag.name || '').toLowerCase() === key) {
        return tag.name || value;
      }
    }
  }
  return value;
}

function _folderMembershipFolderLabel(folder) {
  const normalized = _folderMembershipKey(folder);
  if (!normalized) return '';
  if (_isHomeFolderPath(normalized)) return HOME_FOLDER_DISPLAY_LABEL;
  const parts = normalized.split('/').filter(Boolean);
  const name = parts[parts.length - 1] || normalized;
  return name === normalized ? normalized : `${name} - ${normalized}`;
}

function _folderDragPayloadItemsFromEvent(event, payloadOverride) {
  let payload = payloadOverride || null;
  try {
    if (!payload) {
      const raw = event?.dataTransfer?.getData?.('application/x-meldex-node') || '';
      payload = raw ? JSON.parse(raw) : null;
    }
  } catch {
    payload = null;
  }
  if (!payload) {
    payload = window._gbOutlinerDragPayload || window._gbFolderViewDragPayload || null;
  }
  const rows = Array.isArray(payload?.items) ? payload.items : (payload?.path ? [payload] : []);
  const sourceSurface = payload?.sourceSurface || '';
  const seen = new Set();
  return rows.map(row => ({
    name: row?.name || '',
    path: row?.path || '',
    type: row?.type || 'file',
    sourceSurface: row?.sourceSurface || sourceSurface || 'main',
  })).filter(row => {
    const key = _folderMembershipKey(row.path);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function _folderCanAcceptLinkDrop(event, targetItem) {
  if (!event?.altKey || !targetItem?.path) return false;
  if (targetItem.type !== 'folder' && targetItem.type !== 'database') return false;
  if (typeof isItemLocked === 'function' && isItemLocked(targetItem.path)) return false;
  const types = Array.from(event?.dataTransfer?.types || []);
  return types.includes('application/x-meldex-node')
    || (typeof MeldexDnD !== 'undefined' && MeldexDnD.hasDropKind(event, 'node'));
}

async function _folderCreateLinksFromDrop(event, targetItem, payloadOverride) {
  const targetPath = targetItem?.path || '';
  const targetKey = _folderMembershipKey(targetPath);
  const items = _folderDragPayloadItemsFromEvent(event, payloadOverride)
    .filter(row => _folderMembershipKey(row.path) !== targetKey);
  if (!targetPath || items.length === 0) {
    showStatus('リンク登録できる項目がありません', true);
    return 0;
  }
  // 複数選択のリンクも一括登録でまとめて作る（一括登録の API は複数件を1回で扱い、取り消しも1つ）。
  let result;
  try {
    result = typeof addFolderLinksBatchWithHistory === 'function'
      ? await addFolderLinksBatchWithHistory(items, targetPath)
      : await apiPost('/folder-links/batch/add', { items: items.map(source => ({ file_path: source.path })), folder_path: targetPath });
  } catch {
    showStatus('リンク登録に失敗しました', true);
    return 0;
  }
  items.forEach(source => _folderInvalidateMembershipsForPath(source.path));
  const ok = result?.created_count || 0;
  const failed = result?.failed_count || 0;
  if (ok > 0 && typeof _folderEnsureMemberships === 'function') {
    _folderEnsureMemberships(_folderItems, { rerender: _folderHasActiveFolderFilter(getFolderDisplayConfig()) });
  }
  const suffix = failed > 0 ? `（${failed} 件失敗）` : '';
  showStatus(ok > 0 ? `${ok} 件を「${targetItem.name || targetPath}」にも表示しました${suffix}` : (failed ? 'リンク登録に失敗しました' : 'すでに表示されています'), failed > 0 && ok === 0);
  return ok;
}

function _folderCanAcceptOsDrop(event, targetItem) {
  if (!event?.dataTransfer || !targetItem?.path) return false;
  if (targetItem.type !== 'folder' && targetItem.type !== 'database') return false;
  if (typeof isItemLocked === 'function' && isItemLocked(targetItem.path)) return false;
  const types = Array.from(event.dataTransfer.types || []);
  return types.includes('Files') && !types.includes('application/x-meldex-node');
}

async function _folderUploadDroppedFile(file, parentPath) {
  if (typeof _uploadOutlinerDroppedFile === 'function') return _uploadOutlinerDroppedFile(file, parentPath);
  try {
    const [result] = await MeldexDnD.uploadFiles([file], parentPath, { source: 'folder-drop' });
    return result?.ok ? result : {
      ok: false,
      name: file?.name || 'ファイル',
      error: result?.error || '取り込みに失敗しました',
    };
  } catch (error) {
    return { ok: false, name: file?.name || 'ファイル', error: error?.userMessage || error?.message || String(error) };
  }
}

function _folderReadFileEntry(entry) {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function _folderReadDirectoryEntries(entry) {
  const reader = entry.createReader();
  const rows = [];
  while (true) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) return rows;
    rows.push(...batch);
  }
}

async function _folderReadOsDropNode(entry) {
  if (entry.isFile) return { kind: 'file', name: entry.name, file: await _folderReadFileEntry(entry) };
  if (!entry.isDirectory) return null;
  const children = [];
  for (const child of await _folderReadDirectoryEntries(entry)) {
    const node = await _folderReadOsDropNode(child);
    if (node) children.push(node);
  }
  return { kind: 'folder', name: entry.name, children };
}

async function _folderOsDropNodes(dataTransfer) {
  const entries = Array.from(dataTransfer?.items || [])
    .filter(item => item.kind === 'file')
    .map(item => item.webkitGetAsEntry?.())
    .filter(Boolean);
  if (entries.length) {
    const nodes = [];
    for (const entry of entries) {
      const node = await _folderReadOsDropNode(entry);
      if (node) nodes.push(node);
    }
    return nodes;
  }
  return Array.from(dataTransfer?.files || []).map(file => ({ kind: 'file', name: file.name, file }));
}

function _folderCountOsDropFiles(nodes) {
  return nodes.reduce((count, node) => count + (node.kind === 'file' ? 1 : _folderCountOsDropFiles(node.children || [])), 0);
}

async function _folderImportOsFiles(nodes, parentPath, result, progress) {
  if (!nodes.length) return;
  let uploaded = [];
  try {
    uploaded = await MeldexDnD.uploadFiles(
      nodes.map(node => node.file),
      parentPath,
      { source: 'folder-drop', silentError: true },
    );
  } catch (error) {
    uploaded = nodes.map(node => ({ ok: false, name: node.name, error }));
  }
  nodes.forEach((node, index) => {
    const item = uploaded[index] || { ok: false, name: node.name, error: '取り込み結果を確認できませんでした' };
    if (item.ok) result.ok += 1;
    else { result.failed += 1; result.failures.push(item); }
    progress?.updateOperation?.(result.ok + result.failed);
  });
  const successful = uploaded.map((item, index) => ({ item, file: nodes[index]?.file }))
    .filter(row => row.item?.ok);
  if (successful.length) result.savedGroups.push({
    parentPath,
    saved: successful.map(row => row.item),
    files: successful.map(row => row.file),
  });
}

async function _folderImportOsNode(node, parentPath, result, progress) {
  if (node.kind === 'folder') {
    try {
      const created = await apiPost('/outliner/add', { type: 'folder', label: node.name, parent: parentPath });
      const childParent = created?.node?.path || [parentPath, created?.node?.label || node.name].filter(Boolean).join('/');
      if (created?.node?.path) {
        result.savedGroups.push({ parentPath, saved: [{ item: created.node, path: created.node.path }], files: [] });
      }
      const children = node.children || [];
      await _folderImportOsFiles(children.filter(child => child.kind === 'file'), childParent, result, progress);
      for (const child of children.filter(item => item.kind === 'folder')) {
        await _folderImportOsNode(child, childParent, result, progress);
      }
    } catch (error) {
      const skipped = _folderCountOsDropFiles(node.children || []);
      result.failed += Math.max(1, skipped);
      result.failures.push({ name: node.name, error });
      progress?.updateOperation?.(result.ok + result.failed);
    }
    return;
  }
  const uploaded = await _folderUploadDroppedFile(node.file, parentPath);
  if (uploaded.ok) {
    result.ok += 1;
    result.savedGroups.push({ parentPath, saved: [uploaded], files: [node.file] });
  }
  else { result.failed += 1; result.failures.push(uploaded); }
  progress?.updateOperation?.(result.ok + result.failed);
}

function _folderLocalPathKey(value) {
  let normalized = String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const provider = window.MeldexStorageAdapter?.getProvider?.();
  const browserData = window.MeldexRuntimeAdapter?.isBrowserDataMode?.();
  const base = String(typeof state !== 'undefined' ? state.vaultPath || '' : '').replace(/\\/g, '/');
  // Dropboxの名前空間・ブラウザの仮想パスは、ローカル保存先へ結合しない。
  if (normalized && !provider?._dropboxLocation && !browserData && /^(?:[a-z]:\/|\/)/i.test(base)
      && !/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(normalized)) {
    normalized = base.replace(/\/+$/, '') + '/' + normalized;
  }
  return /^[a-z]:(?:\/|$)/i.test(normalized) || normalized.startsWith('//') ? normalized.toLowerCase() : normalized;
}

function _folderDropPathsEqual(left, right) {
  const provider = window.MeldexStorageAdapter?.getProvider?.();
  const cloudKey = window.__MeldexPwaDataAccessInternals?._folderLinkPathKey;
  if (left && right && provider?._dropboxLocation && cloudKey) {
    const key = cloudKey(provider, left);
    return !!key && key === cloudKey(provider, right);
  }
  return !!left && !!right && _folderLocalPathKey(left) === _folderLocalPathKey(right);
}

function _folderStageCreateTreePreview(parentPath, type, label) {
  const container = _folderVisibleOutlinerChildren(parentPath);
  if (!container || container.dataset.virtual === 'true' || typeof _createOutlinerPendingCreateNode !== 'function') return () => {};
  const node = _createOutlinerPendingCreateNode(type, label);
  container.appendChild(node);
  return () => node.remove();
}

function _folderPasteMovePending(path) {
  return [..._folderPendingPasteMoves].some(pending => _folderDropPathsEqual(path, pending));
}

function _folderStagePasteMove(item, destination) {
  if (!item?.path || !_folderDropPathsEqual(_folderPath, destination)) return () => {};
  const path = destination.replace(/\/+$/, '') + '/' + item.path.replace(/\\/g, '/').split('/').pop();
  if (_folderItems.some(existing => _folderDropPathsEqual(existing.path, path))) return () => {};
  const pending = { ...item, path, file_id: undefined, assetId: undefined, asset_id: undefined };
  _folderPendingPasteMoves.add(path);
  _folderItems.push(pending);
  const render = () => renderFolderGrid({ preserveSelectedPaths: _folderSelectedItems.map(selected => selected.path) });
  render();
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    _folderPendingPasteMoves.delete(path);
    _folderItems = _folderItems.filter(existing => existing !== pending);
    render();
  };
}

function _folderDroppedFileFallbackItem(saved, file) {
  if (saved?.item?.path) {
    return { ...saved.item, name: saved.item.name || saved.item.label || String(saved.item.path).split(/[/\\]/).pop() };
  }
  const path = String(saved?.path || '').replace(/\\/g, '/');
  const filename = String(saved?.name || file?.name || path.split('/').pop() || 'ファイル');
  const lower = filename.toLowerCase();
  const suffix = (lower.match(/(\.[^.]+)$/) || [])[1] || '';
  const imageExt = new Set(['.png','.apng','.jpg','.jpeg','.jpe','.jfif','.gif','.bmp','.webp','.svg','.ico','.avif','.tif','.tiff','.heic','.heif','.psd','.psb']);
  const videoExt = new Set(['.mp4','.webm','.mov','.avi','.mkv']);
  const audioExt = new Set(['.mp3','.wav','.ogg','.flac','.m4a','.aac']);
  let type = 'unknown';
  let name = filename;
  if (imageExt.has(suffix) || String(file?.type || '').startsWith('image/')) type = 'image';
  else if (videoExt.has(suffix) || String(file?.type || '').startsWith('video/')) type = 'video';
  else if (audioExt.has(suffix) || String(file?.type || '').startsWith('audio/')) type = 'audio';
  else if (suffix === '.csv') { type = 'csv'; name = filename.slice(0, -suffix.length); }
  else if (suffix === '.md') { type = lower.endsWith('.board.md') ? 'board' : 'page'; name = filename.slice(0, -suffix.length); }
  else if (['.html','.htm'].includes(suffix)) type = 'html';
  else if (['.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.txt','.rtf'].includes(suffix)) type = 'document';
  else if (['.zip','.rar','.7z','.tar','.gz'].includes(suffix)) type = 'archive';
  return { name, type, path, ext: suffix, size: file?.size, modified: new Date().toISOString(), type_resolved: type !== 'unknown' };
}

function _folderVisibleOutlinerChildren(parentPath) {
  if (typeof _homeFolderPath !== 'undefined' && _folderDropPathsEqual(parentPath, _homeFolderPath)) {
    const home = document.getElementById('body-home');
    if (home) return home;
  }
  if (typeof _findTreeNodeByPath !== 'function') return null;
  const parentNode = _findTreeNodeByPath(parentPath) || Array.from(document.querySelectorAll(
    '#outliner-tree .tree-node, #body-home .tree-node, #body-workspaces .tree-node'
  )).find(node => _folderDropPathsEqual(node._nodeData?.path, parentPath));
  if (!parentNode) {
    return (typeof _homeFolderPath !== 'undefined' && _folderDropPathsEqual(parentPath, _homeFolderPath))
      ? document.getElementById('body-home')
      : null;
  }
  const children = parentNode.querySelector(':scope > .tree-children');
  if (!children || children.dataset.loaded === 'false') return null;
  const toggle = parentNode.querySelector(':scope > .tree-node-row > .tree-toggle');
  if (children.classList.contains('collapsed') || (toggle && toggle.dataset.expanded !== 'true')) return null;
  return children;
}

function _folderInsertDroppedItemsIntoOutliner(parentPath, items) {
  const container = _folderVisibleOutlinerChildren(parentPath);
  if (!container || !items.length || typeof createTreeNodeFromBrowse !== 'function') return;
  const existing = container._virtualState?.allItems || Array.from(container.children || []).map(node => node._nodeData).filter(Boolean);
  const fresh = items.filter(item => (typeof _findTreeNodeByPath !== 'function' || !_findTreeNodeByPath(item.path))
    && !existing.some(current => _folderDropPathsEqual(current.path, item.path)));
  if (!fresh.length) return;
  const virtual = window.GBOutlinerVirtualRender;
  if (virtual?.isVirtualContainer?.(container)) {
    virtual.dropInto(container, fresh);
    return;
  }
  fresh.forEach(item => {
    const node = createTreeNodeFromBrowse(item);
    const pendingCopy = typeof isOutlinerCopyPendingPath === 'function' && isOutlinerCopyPendingPath(item.path);
    if (!pendingCopy && typeof _insertOutlinerCreateNode === 'function') _insertOutlinerCreateNode(container, node, null);
    else container.appendChild(node);
    if (typeof _registerTreeNode === 'function') _registerTreeNode(node);
  });
}

function _folderApplySavedDropResults(parentPath, savedResults, files, options = {}) {
  const rows = (savedResults || []).map((saved, index) =>
    _folderDroppedFileFallbackItem(saved, files?.[index])).filter(item => item.path);
  if (!rows.length) return 0;
  if (typeof _folderNotifyFoldersChanged === 'function') _folderNotifyFoldersChanged([parentPath]);
  if (_folderDropPathsEqual(_folderPath, parentPath)) {
    const pathKey = value => {
      const normalized = String(value || '').replace(/\\/g, '/');
      const provider = window.MeldexStorageAdapter?.getProvider?.();
      const cloudKey = window.__MeldexPwaDataAccessInternals?._folderLinkPathKey;
      if (provider?._dropboxLocation && cloudKey) return cloudKey(provider, value) || 'unresolved:' + normalized;
      return _folderLocalPathKey(value);
    };
    const byPath = new Map(_folderItems.map(item => [pathKey(item?.path), item]));
    rows.forEach(item => {
      const key = pathKey(item.path);
      const existing = byPath.get(key);
      byPath.set(key, existing ? { ...existing, ...item, path: existing.path } : item);
    });
    _folderItems = [...byPath.values()];
    if (typeof registerFileTypes === 'function') registerFileTypes(rows);
    if (typeof renderFolderGrid === 'function') {
      const selectedPaths = Array.isArray(options?.selectPaths)
        ? options.selectPaths.map(path => byPath.get(pathKey(path))?.path || path)
        : (_folderSelectedItems || []).map(item => item?.path).filter(Boolean);
      renderFolderGrid({ preserveSelectedPaths: selectedPaths });
    }
  }
  _folderInsertDroppedItemsIntoOutliner(parentPath, rows);
  return rows.length;
}

async function _folderImportOsDrop(event, targetItem) {
  if (!_folderCanAcceptOsDrop(event, targetItem)) return 0;
  if (targetItem?.type === 'database' && typeof MeldexSheetEntryAttachments !== 'undefined') {
    return MeldexSheetEntryAttachments.intakeDropToSheet(targetItem.path, event);
  }
  const nodes = await _folderOsDropNodes(event.dataTransfer);
  const total = _folderCountOsDropFiles(nodes);
  if (!total && !nodes.some(node => node.kind === 'folder')) {
    showStatus('取り込めるファイルまたはフォルダがありません', true);
    return 0;
  }
  const progress = window.MeldexImportProgress;
  const result = { ok: 0, failed: 0, failures: [], savedGroups: [] };
  const progressToken = progress?.beginOperation?.('ファイルを取り込み中', total || null, { delayMs: 0, kind: 'external-file-intake' });
  const boundProgress = { updateOperation: count => progress?.updateOperation?.(count, null, progressToken) };
  const reservation = typeof historyReserve === 'function' ? historyReserve('フォルダ: ファイル取り込み', '') : null;
  try {
    await _folderImportOsFiles(nodes.filter(node => node.kind === 'file'), targetItem.path, result, boundProgress);
    for (const node of nodes.filter(item => item.kind === 'folder')) {
      await _folderImportOsNode(node, targetItem.path, result, boundProgress);
    }
  } finally {
    const created = result.savedGroups.flatMap(group => group.saved.map((saved, index) => _folderDroppedFileFallbackItem(saved, group.files[index])))
      .filter(item => item.path).map(item => ({ ...item, kind: item.type === 'folder' ? 'folder' : 'file' }));
    const normalize = path => String(path).replace(/\\/g, '/').replace(/\/+$/, '');
    const topLevel = created.filter(item => !created.some(parent => parent !== item && parent.kind === 'folder' && normalize(item.path).startsWith(normalize(parent.path) + '/')));
    if (topLevel.length) {
      const register = () => _pushCreatedOutlinerItemsHistory(topLevel, 'フォルダ: ファイル取り込み', '');
      if (reservation) reservation.capture(register); else register();
    }
    reservation?.cancel();
    progress?.finishOperation?.(progressToken, { failed: result.failed, summary: `${result.ok}件保存・${result.failed}件失敗`, details: result.failures });
  }
  result.savedGroups.forEach(group => _folderApplySavedDropResults(group.parentPath, group.saved, group.files));
  const first = result.failures[0];
  const reason = String(first?.error?.userMessage || first?.error?.message || first?.error || '');
  showStatus(result.failed
    ? `${result.ok}件を取り込み、${result.failed}件は失敗しました${reason ? `（${reason}）` : ''}`
    : `${result.ok}件を取り込みました`, result.failed > 0 && result.ok === 0);
  return result.ok;
}

function _folderCanAcceptMoveDrop(event, targetItem) {
  if (!event || event.altKey || !targetItem?.path) return false;
  if (targetItem.type !== 'folder' && targetItem.type !== 'database') return false;
  if (typeof isItemLocked === 'function' && isItemLocked(targetItem.path)) return false;
  return Array.from(event.dataTransfer?.types || []).includes('application/x-meldex-node')
    || (typeof MeldexDnD !== 'undefined' && MeldexDnD.hasDropKind(event, 'node'));
}

async function _folderMoveItemsFromDrop(event, targetItem, payloadOverride) {
  // ドロップの内容はイベントが続いている間に読む（待った後では読めない）。
  const dropped = _folderDragPayloadItemsFromEvent(event, payloadOverride);
  let targetPath = targetItem?.path || '';
  const targetKey = _folderMembershipKey(targetPath);
  const items = dropped.filter(source => {
    const sourceKey = _folderMembershipKey(source.path);
    return sourceKey && sourceKey !== targetKey && !targetKey.startsWith(sourceKey + '/');
  });
  if (!targetPath || items.length === 0) {
    showStatus('移動できる項目がありません', true);
    return 0;
  }
  // 複数選択もまとめて移動する（1件ずつ移動し、成功した分を1つの取り消しにまとめる。フォルダツリーへのドロップと同じ）。
  // 以前は複数選択を全部断っていた（2026-11-22 M-014 フォルダパネル網羅テスト。マニュアルは「まとめて挿入できます」）。
  // シートへのドロップ: Altキー押下時、またはエントリ以外のファイル/ボード/画像等は
  // シート全ファイル取込（MeldexSheetEntryAttachments）へルーティングしてエントリ化する。
  if (targetItem?.type === 'database') {
    const nonEntries = items.filter(source => !(window.MeldexSheetAttachments?.itemFitsInSheet?.(source) ?? false));
    if (event?.altKey || nonEntries.length > 0) {
      if (typeof MeldexSheetEntryAttachments !== 'undefined') {
        return MeldexSheetEntryAttachments.intakeDropToSheet(targetPath, event, { payloadOverride });
      }
    }
  }
  // シートの中に置けるのはエントリだけ。ボード等を落とすと
  // 「シートの中にボードがある」状態になるため、ドロップ時点で止める。
  if (targetItem?.type === 'database') {
    const rejected = items.filter(source => !(window.MeldexSheetAttachments?.itemFitsInSheet?.(source) ?? true));
    if (rejected.length) {
      const first = rejected[0]?.name || rejected[0]?.path || '対象';
      showStatus(
        'シートの中にはエントリだけを置けます（' + first +
        (rejected.length > 1 ? ' ほか ' + (rejected.length - 1) + ' 件' : '') + '）',
        true
      );
      return 0;
    }
  }
  const progress = window.MeldexImportProgress;
  const progressToken = progress?.beginOperation?.('ファイルを移動中', items.length, { delayMs: 0, kind: 'file-move' });
  const pendingPaths = items.filter(source => source.sourceSurface !== 'sheet-image' && _folderIsDirectChildOfCurrent(source.path))
    .map(source => _folderMembershipKey(source.path));
  const pendingSelection = _folderSelectedItems.map(item => item.path);
  let ok = 0;
  const failures = [];
  const movedItems = [];
  // 取り消しの枠はドロップの時点で取る（画面の読み直しの後に記録していたので、その間の Ctrl+Z が
  // 前の操作を取り消していた。フォルダツリーの削除・改名と同じ型: 2026-11-22 M-014 フォルダパネル網羅テスト）。
  const moveReservation = typeof historyReserve === 'function'
    ? historyReserve(`フォルダパネル: ${items.length} 件を移動`, '', `→ ${targetPath}`)
    : null;
  try {
  pendingPaths.forEach(path => _folderPendingMovePaths.add(path));
  if (pendingPaths.length) renderFolderGrid({ preserveSelectedPaths: pendingSelection });
  // 移動先のフォルダの名前の変更がまだ保存中なら、終わるのを待って新しい場所へ移動する。
  if (targetPath && typeof _outlinerAwaitPendingRenameForTarget === 'function') {
    try { targetPath = await _outlinerAwaitPendingRenameForTarget(targetPath); }
    catch (error) {
      const reason = String(error?.message || '移動先の名前の変更を確認できません');
      progress?.finishOperation?.(progressToken, { failed: items.length, label: '移動できませんでした', summary: reason });
      showStatus(reason, true);
      return 0;
    }
  }
  // 件数が多い時は、まとめての移動（/outliner/move-batch）へ分けて送る。結果は1件ずつ受け取る。
  const mover = _folderCreateMover(items, targetPath, { minimum: 2, skip: source => source.sourceSurface === 'sheet-image' });
  // 表示への反映は、まとめて送った分は塊ごとに1回（1件ごとに描き直すと件数の2乗で遅くなる）
  let unappliedMoves = [];
  const applyMovesToView = source => {
    if (!unappliedMoves.length || (mover.batched && !mover.isChunkEnd(source))) return;
    const moves = unappliedMoves;
    unappliedMoves = [];
    _folderApplyCommittedMoves(moves);
  };
  try {
    for (const source of items) {
      try {
        if (!mover.batched && typeof _outlinerAwaitPendingRename === 'function') await _outlinerAwaitPendingRename(source);
        const copySource = source.sourceSurface === 'sheet-image';
        const post = dest => (copySource ? apiPost('/outliner/save-as', {
          path: source.path,
          dest_folder: dest,
        }) : mover.post(source, dest));
        let res;
        try { res = await post(targetPath); }
        catch (error) {
          // 画面に残っていた移動先の場所が古かった（直前に名前の変更・移動があった）時は、今の場所で1回だけやり直す。
          const current = error?.status === 404 && typeof resolveCurrentAppPath === 'function' ? resolveCurrentAppPath(targetPath) : targetPath;
          if (current === targetPath) throw error;
          targetPath = current;
          res = await post(targetPath);
        }
        // The move is committed. A detached view cannot turn it into a failed
        // file operation or keep the other editors bound to the old path.
        const oldPath = source.path;
        ok += 1;
        if (!copySource) movedItems.push({
          oldPath,
          newPath: res?.new_path || oldPath,
          currentPath: res?.new_path || oldPath,
          name: res?.new_name || source.name,
          type: source.type,
          fileId: res?.file_id || source.file_id,
        });
        if (!copySource) {
          _folderPendingMovePaths.delete(_folderMembershipKey(oldPath));
          unappliedMoves.push(movedItems[movedItems.length - 1]);
          applyMovesToView(source);
        }
        if (!copySource && res?.new_path && typeof renameAppPathReferences === 'function') {
          try { renameAppPathReferences(oldPath, res.new_path, {
            preserveMountedViews: true, label: res.new_name || source.name,
            fileId: res.file_id,
            type: source.type || 'file',
          }); } catch (error) { console.warn('[Meldex] 移動後のパス更新に失敗しました', error); }
        }
        if (!copySource && typeof handleRelocateResponse === 'function') {
          try { handleRelocateResponse(res); }
          catch (error) { console.warn('[Meldex] 移動後の表示更新に失敗しました', error); }
        }
      } catch (error) {
        _folderPendingMovePaths.delete(_folderMembershipKey(source.path));
        // 失敗した項目を一覧へ戻す。まとめて送った分は、塊の終わりに1回だけ描き直す
        if (!mover.batched) renderFolderGrid({ preserveSelectedPaths: pendingSelection });
        else if (mover.isChunkEnd(source)) { applyMovesToView(source); renderFolderGrid({ preserveSelectedPaths: pendingSelection }); }
        failures.push({ name: source.name || source.path, error });
      }
      progress?.updateOperation?.(ok + failures.length, null, progressToken);
    }
    // 送ったのに結果を受け取っていない項目（通常は無い）も、移動済みなら履歴と表示へ入れる
    mover.unclaimed().forEach(({ source, res }) => {
      ok += 1;
      movedItems.push({ oldPath: source.path, newPath: res?.new_path || source.path, currentPath: res?.new_path || source.path,
        name: res?.new_name || source.name, type: source.type, fileId: res?.file_id || source.file_id });
      unappliedMoves.push(movedItems[movedItems.length - 1]);
    });
    if (unappliedMoves.length) { const moves = unappliedMoves; unappliedMoves = []; _folderApplyCommittedMoves(moves); }
  } finally {
    const destLabel = targetItem?.name || String(targetPath).split('/').pop() || targetPath;
    progress?.finishOperation?.(progressToken, {
      failed: failures.length,
      label: failures.length ? `「${destLabel}」への移動` : `${ok}件を「${destLabel}」へ移動しました`,
      summary: failures.length ? `${ok}件を移動・${failures.length}件は移動できませんでした（元の場所に残っています）` : '',
      details: failures,
    });
  }
  if (movedItems.length && !mover.batched) _folderApplyCommittedMoves(movedItems);
  // 応答を受け取れなかった塊があった時は、実際の状態が分からないので一覧を読み直す
  if (mover.uncertain && _folderPath && typeof openFolder === 'function') {
    try { await openFolder(_folderPath.split('/').pop() || _folderPath, _folderPath, { ..._folderSurfaceOpts(), silent: true, skipNavPush: true, skipShowView: true, skipSaveLastView: true, skipHighlight: true, skipGlobalUi: true }); }
    catch (error) { console.warn('[folder move] 一覧の読み直しに失敗しました', error); }
  }
  // パネルを先に描き直し、ツリーは移動元と移動先のフォルダだけを差分で反映する（並行）。全体の読み直しを待つと
  // 移動の反映が 0.4秒前後かかっていた（2026-11-22 M-014 フォルダパネル網羅テスト）。差分にできなければ全体を読み直す。
  const treeFolders = [targetPath, ...movedItems.map(moved => _folderDirectParentKey(moved.oldPath))];
  const treeSync = typeof folderToolbarSyncTree === 'function'
    ? folderToolbarSyncTree(treeFolders)
    : (typeof refreshOutliner === 'function' ? refreshOutliner({ force: true, reason: 'folder-panel-drop-move' }) : null);
  // パネルは確定した移動を上で1件ずつ反映済み。ここで一覧を全部読み直すと、移動の途中の古い一覧で
  // 移動したはずの項目が元の場所に戻って見えたり、次のドラッグの最中に行の並びが変わったりしていた
  // （2026-11-24 利用者の報告）。読み直しはしない。
  try { await treeSync; } catch (error) { console.warn('[folder move] ツリーの反映に失敗しました', error); }
  if (failures.length) {
    const first = failures[0];
    const reason = String(first.error?.userMessage || first.error?.message || '');
    showStatus(`${ok}件を移動、${failures.length}件は失敗しました${reason ? `（${reason}）` : ''}`, true);
  } else {
    showStatus(`${ok}件を「${targetItem.name || targetPath}」へ移動しました`);
  }
  const registerMoves = () => window.MeldexFileMoveHistory?.register?.(movedItems, {
    batchMinimum: 2,
    label: `フォルダパネル: ${movedItems.length} 件を移動`,
    detail: `→ ${targetPath}`,
    refresh: async () => {
      // 取り消し・やり直しの後も、ツリーは移動元と移動先のフォルダだけを差分で直す（全体の読み直しは
      // 保存先が多いと数秒かかり、その間「取り消しています」のまま止まって見えていた: 2026-11-24 利用者の報告）。
      const historyFolders = [targetPath, ...movedItems.map(moved => _folderDirectParentKey(moved.oldPath))];
      if (typeof folderToolbarSyncTree === 'function') await folderToolbarSyncTree(historyFolders);
      else if (typeof refreshOutliner === 'function') await refreshOutliner({ force: true, reason: 'folder-panel-move-history' });
      if (_folderPath && typeof openFolder === 'function') {
        await openFolder(document.getElementById('folder-title')?.textContent || _folderPath, _folderPath, { ...(typeof _folderSurfaceOpts === 'function' ? _folderSurfaceOpts() : {}),
          silent: true, skipNavPush: true, skipShowView: true, skipSaveLastView: true, skipHighlight: true, skipGlobalUi: true,
        });
      }
    },
  });
  if (moveReservation) moveReservation.capture(registerMoves); else registerMoves();
  return ok;
  } finally {
    const hadPending = pendingPaths.some(path => _folderPendingMovePaths.has(path));
    pendingPaths.forEach(path => _folderPendingMovePaths.delete(path));
    if (hadPending) renderFolderGrid({ preserveSelectedPaths: pendingSelection });
    moveReservation?.cancel();
  }
}

// ---- 多数の項目の移動をまとめて送る（2026-11-24） ----
// 移動は1件ずつ /outliner/move を送っていたので、数千件を選んで移動すると要求が件数ぶん出ていた。
// 件数が多い時は /outliner/move-batch へ FOLDER_MOVE_BATCH_CHUNK 件ずつ送る。サーバーは1件ずつ同じ移動の処理を通して
// 1件ごとに確定し、結果を項目ごとに返す（ある項目の失敗は他へ影響しない）。
// 呼び出し側の「1件ずつ結果を受け取って履歴・表示へ反映する」流れは変えない。post(項目, 移動先) が返す結果は
// 1件の移動と同じ形で、まとめて送った分は届いた結果から1件ずつ返す。
// Cloud（Dropbox）にはまとめての移動が無いので、従来どおり1件ずつ送る。
const FOLDER_MOVE_BATCH_MIN = 20;
const FOLDER_MOVE_BATCH_CHUNK = 100;
let _folderMoveBatchUnsupported = false;
const _folderMoveBatchStats = { batchRequests: 0, singleRequests: 0 };

function _folderMoveBatchError(entry) {
  const detail = entry?.detail;
  const text = typeof detail === 'string' ? detail
    : String(detail?.message || detail?.detail || (detail ? JSON.stringify(detail) : '') || '移動できませんでした');
  const error = new Error(text);
  error.status = Number(entry?.status) || 500;
  error.userMessage = text;
  error.payload = { detail };
  return error;
}

// sources: 移動する項目（path を持つ。順番に post する）。destFolder: 移動先。
// options.skip(source): true の項目はまとめて送らない（呼び出し側が自分で断る・別の処理をする項目）。
function _folderCreateMover(sources, destFolder, options = {}) {
  const single = (source, dest) => {
    _folderMoveBatchStats.singleRequests += 1;
    return apiPost('/outliner/move', { path: source.path, dest_folder: dest, conflict_policy: 'error' });
  };
  const eligible = (Array.isArray(sources) ? sources : []).filter(source => source?.path && !(options.skip && options.skip(source)));
  const minimum = Number.isInteger(options.minimum) && options.minimum >= 2 ? options.minimum : FOLDER_MOVE_BATCH_MIN;
  const batched = eligible.length >= minimum && !_folderMoveBatchUnsupported
    && !window.MeldexRuntimeAdapter?.isDropboxMode?.() && typeof apiPost === 'function';
  if (!batched) {
    return { batched: false, uncertain: false, post: single, isChunkEnd: () => true, unclaimed: () => [] };
  }
  const entries = new Map(); // 項目 → { promise, resolve, reject, sent, claimed, chunkEnd }
  eligible.forEach(source => {
    const entry = { source, sent: false, claimed: false, chunkEnd: false, result: null };
    entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
    entry.promise.then(value => { entry.result = { ok: true, value }; }, error => { entry.result = { ok: false, error }; });
    entries.set(source, entry);
  });
  let cursor = 0;
  const mover = { batched: true, uncertain: false };
  const sendNextChunk = async () => {
    const chunk = eligible.slice(cursor, cursor + FOLDER_MOVE_BATCH_CHUNK);
    cursor += chunk.length;
    if (!chunk.length) return;
    chunk.forEach(source => { entries.get(source).sent = true; });
    entries.get(chunk[chunk.length - 1]).chunkEnd = true;
    // 名前の変更が保存中の項目は、終わるのを待って新しい場所で送る（1件の移動と同じ）
    if (typeof _outlinerPendingRenames !== 'undefined' && _outlinerPendingRenames.size && typeof _outlinerAwaitPendingRename === 'function') {
      for (const source of chunk) {
        try { await _outlinerAwaitPendingRename(source); }
        catch (error) { entries.get(source).failedBeforeSend = error; }
      }
    }
    const sendable = chunk.filter(source => !entries.get(source).failedBeforeSend);
    chunk.filter(source => entries.get(source).failedBeforeSend).forEach(source => entries.get(source).reject(entries.get(source).failedBeforeSend));
    if (!sendable.length) return;
    let payload;
    try {
      _folderMoveBatchStats.batchRequests += 1;
      payload = await apiPost('/outliner/move-batch', {
        items: sendable.map(source => ({ path: source.path })), dest_folder: destFolder, conflict_policy: 'error',
      }, { silentError: true });
    } catch (error) {
      if ([404, 405].includes(Number(error?.status))) {
        // まとめての移動が無い本体（古い版）: 1件ずつ送る
        _folderMoveBatchUnsupported = true;
        for (const source of sendable) {
          try { entries.get(source).resolve(await single(source, destFolder)); }
          catch (singleError) { entries.get(source).reject(singleError); }
        }
        return;
      }
      // 応答を受け取れなかった（通信の中断・時間切れ）。一部は移動済みかもしれないので、呼び出し側が一覧を読み直す。
      mover.uncertain = true;
      const uncertain = new Error('移動の結果を確認できませんでした。一覧を読み直して状態を確認してください'
        + (error?.message ? `（${error.message}）` : ''));
      uncertain.status = Number(error?.status) || 0;
      uncertain.userMessage = uncertain.message;
      sendable.forEach(source => entries.get(source).reject(uncertain));
      return;
    }
    const results = Array.isArray(payload?.results) ? payload.results : [];
    if (results.length !== sendable.length) {
      mover.uncertain = true;
      const mismatch = new Error('移動の結果を確認できませんでした。一覧を読み直して状態を確認してください');
      mismatch.userMessage = mismatch.message;
      sendable.forEach(source => entries.get(source).reject(mismatch));
      return;
    }
    sendable.forEach((source, index) => {
      const result = results[index];
      if (result?.ok) entries.get(source).resolve(result.value || { ok: true, new_path: result.new_path, new_name: result.new_name, file_id: result.file_id });
      else entries.get(source).reject(_folderMoveBatchError(result));
    });
  };
  mover.post = (source, dest) => {
    const entry = entries.get(source);
    if (!entry || dest !== destFolder) return single(source, dest);
    entry.claimed = true;
    if (!entry.sent) {
      // この項目が入る塊まで送る（前の塊の応答を待たずに次を送ることは無い: 呼び出し側は順番に await する）
      const run = async () => { while (!entry.sent && cursor < eligible.length) await sendNextChunk(); };
      run().catch(error => entry.reject(error));
    }
    return entry.promise;
  };
  // 塊の最後の項目か（表示への反映を塊ごとに1回にまとめる合図）
  mover.isChunkEnd = source => { const entry = entries.get(source); return !entry || entry.chunkEnd; };
  // 送ったのに呼び出し側が結果を受け取らなかった項目（通常は無い）。成功していたら履歴へ入れるために返す。
  mover.unclaimed = () => [...entries.values()].filter(entry => entry.sent && !entry.claimed && entry.result?.ok)
    .map(entry => ({ source: entry.source, res: entry.result.value }));
  return mover;
}

function _folderDirectParentKey(path) {
  const normalized = _normalizeFolderPathForCompare(path);
  const slash = normalized.lastIndexOf('/');
  return slash >= 0 ? normalized.slice(0, slash) : '';
}

// 保存済みの移動の結果を先に表示へ反映する。一覧の再取得を待たず、失敗した項目は残す。
// 多数の項目の移動の結果を塊（100 件）ごとに表示へ反映する時の、一覧の描き直しの間引き。
// 従来の描き方（件数がしきい値以下）は全項目のカードを作り直すので、塊ごとに描き直すと件数の2乗で遅くなる
// （2,000 件の貼り付けで、画面側の処理 58 秒のうち 26 秒がカードの作り直しだった。2026-11-25 実測）。
// 項目のデータ（_folderItems）は塊ごとにすぐ更新し、描き直しだけを間引く: 件数が多いほど間隔を空け
// （1件 4ms の見積もり。300 件で 1.2 秒、3,000 件で 12 秒）、待っている間に来た分は最後に1回で描く。
// 進み具合は右下の処理パネルに出続ける。操作の最後の読み直しは、従来どおりすぐ行われる。
const _folderCommittedRender = { lastEnd: 0, lastCost: 0, timer: null };
const FOLDER_COMMITTED_RENDER_ALWAYS_BELOW = 300;   // この件数以下は、従来どおり毎回すぐ描く
const FOLDER_COMMITTED_RENDER_MAX_WAIT_MS = 15000;

function _folderRenderAfterCommittedMoves(bulk) {
  const state = _folderCommittedRender;
  const now = () => ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
  const run = () => {
    if (state.timer) { clearTimeout(state.timer); state.timer = null; }
    if (globalThis.MeldexFolderLarge?.active?.()) { globalThis.MeldexFolderLarge.refresh(); return; }
    // 選択は、描く時点のものを保つ
    const preserve = _folderSelectedItems.map(item => item.path);
    const started = now();
    renderFolderGrid({ preserveSelectedPaths: preserve });
    state.lastEnd = now();
    state.lastCost = state.lastEnd - started;
  };
  const count = _folderItems.length;
  const interval = Math.min(FOLDER_COMMITTED_RENDER_MAX_WAIT_MS, Math.max(state.lastCost * 8, count * 4));
  const wait = state.lastEnd + interval - now();
  // 少数の移動（1件のドラッグなど）は、件数が多いフォルダでも従来どおりすぐ描く。間引くのは、まとめての移動の塊だけ
  if (!bulk || count <= FOLDER_COMMITTED_RENDER_ALWAYS_BELOW || wait <= 0) { run(); return; }
  if (!state.timer) state.timer = setTimeout(run, wait);
}

function _folderApplyCommittedMoves(moves) {
  // 他の面（メイン／サブパネル）が移動元・移動先のフォルダを表示していれば、そちらは読み直す
  if (typeof _folderSurfaceStates !== 'undefined' && _folderSurfaceStates.size && Array.isArray(moves) && moves.length) {
    const touched = new Set();
    moves.forEach(move => { touched.add(_folderDirectParentKey(move.oldPath)); touched.add(_folderDirectParentKey(move.newPath)); });
    _folderNotifyFoldersChanged([...touched]);
  }
  if (globalThis.MeldexFolderLarge?.active?.()) { globalThis.MeldexFolderLarge.refresh(); return; }
  if (!_folderPath || !Array.isArray(moves) || !moves.length) return;
  const key = value => _normalizeFolderPathForCompare(value).toLowerCase();
  const matches = (a, b) => a === b || (!!a && !!b && (a.endsWith('/' + b) || b.endsWith('/' + a)));
  let changed = false;
  // 比べる形（区切り・大文字小文字をそろえた形）は、項目ごとに1回だけ作る（移動ごとに全項目を作り直さない）
  const itemKeys = _folderItems.map(item => key(item.path));
  for (const move of moves) {
    const oldKey = key(move.oldPath), newKey = key(move.newPath);
    const index = itemKeys.findIndex(itemKey => matches(itemKey, oldKey) || matches(itemKey, newKey));
    if (index < 0) {
      if (move.item && _folderIsDirectChildOfCurrent(move.newPath)) {
        _folderItems.push({ ...move.item, path: move.newPath, name: move.name || move.item.name });
        itemKeys.push(newKey);
        changed = true;
      }
      continue;
    }
    const original = _folderItems[index];
    if (_folderIsDirectChildOfCurrent(move.newPath)) {
      _folderItems[index] = { ...original, path: move.newPath, name: move.name || original.name };
      itemKeys[index] = newKey;
    } else {
      _folderItems.splice(index, 1);
      itemKeys.splice(index, 1);
    }
    changed = true;
  }
  if (changed) _folderRenderAfterCommittedMoves(moves.length >= FOLDER_MOVE_BATCH_MIN);
}

// 開いているフォルダの直下の項目か。フォルダはツリーから開くと絶対パス、項目は保存先の相対パスで持つことがあるので、
// 片方が相対パスの時は末尾の一致で同じフォルダとみなす（以前は一致せず、ツリーから開いたフォルダでは
// マニュアルの並べ替えのドラッグが何もしなかった: 2026-11-22 M-014 フォルダパネル網羅テスト）。
function _folderIsDirectChildOfCurrent(path) {
  const parent = _folderDirectParentKey(path).toLowerCase();
  const current = _normalizeFolderPathForCompare(_folderPath || '').toLowerCase();
  if (parent === current) return true;
  if (!parent || !current) return false;
  return current.endsWith('/' + parent) || parent.endsWith('/' + current);
}

function _folderManualDropIntent(event, targetElement, targetItem) {
  if (!event || !targetElement || !targetItem?.path || event.altKey) return null;
  if (typeof getSortForFolder !== 'function' || getSortForFolder(_folderPath || '').sort !== 'manual') return null;
  const sources = _folderDragPayloadItemsFromEvent(event).filter(source => (
    _folderIsDirectChildOfCurrent(source.path) && source.path !== targetItem.path
  ));
  if (!sources.length || !_folderIsDirectChildOfCurrent(targetItem.path)) return null;
  const rect = targetElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  let position;
  // フォルダ・シートは表示形式によらず横幅いっぱいの行で描く（.fv-folder-list-item）。行の形のものは上下で前後を決める
  // （横の位置で決めると、行の左寄りに落としただけで「中へ移動」ではなく並べ替えになっていた）。
  if (_folderIsListLayout() || targetElement.classList?.contains('fv-folder-list-item')) {
    const ratio = (event.clientY - rect.top) / rect.height;
    if ((targetItem.type === 'folder' || targetItem.type === 'database') && ratio > 0.28 && ratio < 0.72) return null;
    position = ratio < 0.5 ? 'before' : 'after';
  } else {
    const ratio = (event.clientX - rect.left) / rect.width;
    if ((targetItem.type === 'folder' || targetItem.type === 'database') && ratio > 0.28 && ratio < 0.72) return null;
    position = ratio < 0.5 ? 'before' : 'after';
  }
  return { position, sources };
}

function _folderClearManualDropIndicators() {
  document.querySelectorAll('.fv-item.fv-manual-before,.fv-item.fv-manual-after').forEach(element => {
    element.classList.remove('fv-manual-before', 'fv-manual-after');
  });
}

function _folderApplyManualDrop(intent, targetItem) {
  if (!intent || !targetItem?.name) return false;
  const directItems = (_folderItems || []).filter(item => _folderIsDirectChildOfCurrent(item?.path));
  const ordered = typeof _sortItemsByManualOrder === 'function'
    ? _sortItemsByManualOrder([...directItems], _folderPath || '')
    : [...directItems];
  const sourceNames = new Set(intent.sources.map(source => source.name).filter(Boolean));
  const movedNames = ordered.filter(item => sourceNames.has(item?.name)).map(item => item.name);
  const remaining = ordered.map(item => item?.name).filter(name => name && !sourceNames.has(name));
  const targetIndex = remaining.indexOf(targetItem.name);
  if (!movedNames.length || targetIndex < 0) return false;
  const insertIndex = targetIndex + (intent.position === 'after' ? 1 : 0);
  remaining.splice(insertIndex, 0, ...movedNames);
  const historyKeys = [
    typeof SORT_SETTINGS_KEY !== 'undefined' ? SORT_SETTINGS_KEY : 'outliner-sort',
    typeof MANUAL_ORDER_KEY !== 'undefined' ? MANUAL_ORDER_KEY : 'outliner-manual-order',
  ];
  const before = typeof captureOutlinerSettingsHistory === 'function' ? captureOutlinerSettingsHistory(historyKeys) : null;
  if (setManualOrder(_folderPath || '', remaining) === false) {
    showStatus('並び順を保存できませんでした：この端末の保存領域に書き込めません', true);
    return false;
  }
  setSortSetting(_folderPath || '', 'manual', 'asc');
  if (typeof pushOutlinerSettingsHistory === 'function') {
    pushOutlinerSettingsHistory('フォルダ: マニュアル並び替え', before, targetItem.name, historyKeys);
  }
  const selectedPaths = (_folderSelectedItems || []).map(item => item?.path).filter(Boolean);
  renderFolderGrid({ preserveSelectedPaths: selectedPaths });
  if (typeof refreshOutliner === 'function') void refreshOutliner({ force: true, reason: 'folder-panel-manual-sort' });
  else if (typeof loadOutliner === 'function') void loadOutliner({ force: true, reason: 'folder-panel-manual-sort' });
  showStatus('並び順を変更しました');
  return true;
}

const FOLDER_SUBFOLDER_CONTENTS_KEY = 'gb:folder-include-subfolders';

function isFolderSubfolderContentsEnabled() {
  try { return localStorage.getItem(FOLDER_SUBFOLDER_CONTENTS_KEY) === '1'; } catch { return false; }
}

function setFolderSubfolderContentsEnabled(enabled) {
  try { localStorage.setItem(FOLDER_SUBFOLDER_CONTENTS_KEY, enabled ? '1' : '0'); } catch {}
  if (typeof syncFolderSubfolderContentsButtons === 'function') syncFolderSubfolderContentsButtons();
}

function canShowContainedFiles(item) {
  const type = String(item?.type || '').toLowerCase();
  if (['database','sheet','page','note','board','scriptnote','scenario','form-app','calendar','schedule','map'].includes(type)) return true;
  const path = String(item?.path || '').toLowerCase();
  return ['.md','.mel-board','.board.md','.mel-scenario','.scriptnote.json','.mel-form','.mel-map']
    .some(suffix => path.endsWith(suffix));
}

async function showContainedFiles(item) {
  if (!item?.path || !canShowContainedFiles(item)) return false;
  try {
    const query = '/contained-files?path=' + encodeURIComponent(item.path)
      + '&type=' + encodeURIComponent(item.type || '');
    const result = await apiFetch(query, { foreground: true });
    const label = (item.name || String(item.path).split(/[\\/]/).pop() || 'ファイル') + ' 内のファイル';
    await openFolder(label, item.path, {
      items: Array.isArray(result?.items) ? result.items : [],
      skipHighlight: true,
      skipSaveLastView: true,
      skipNavPush: true,
    });
    if (!result?.items?.length) showStatus('このファイルが参照する表示可能なファイルはありません');
    return true;
  } catch (error) {
    showStatus(error?.message || 'ファイル内のファイルを表示できませんでした', true);
    return false;
  }
}

async function _folderFetchBrowseItems(path, options = {}) {
  const direct = await apiFetch('/browse?path=' + encodeURIComponent(path) + '&detail=true&all_files=true&form_hierarchy=true');
  if (options.isCurrent?.() === false) return [];
  if (!isFolderSubfolderContentsEnabled()) return direct;
  const result = [...direct];
  const seenItems = new Set(direct.map(item => _normalizeFolderPathForCompare(item?.path)).filter(Boolean));
  const queue = direct.filter(item => item?.type === 'folder' && item.path).map(item => item.path);
  const visited = new Set([_normalizeFolderPathForCompare(path)]);
  let failedCount = 0;
  while (queue.length && visited.size < 5000) {
    if (options.isCurrent?.() === false) return [];
    const folderPath = queue.shift();
    const key = _normalizeFolderPathForCompare(folderPath);
    if (!key || visited.has(key)) continue;
    visited.add(key);
    try {
      const children = await apiFetch('/browse?path=' + encodeURIComponent(folderPath) + '&detail=true&all_files=true&form_hierarchy=true');
      if (options.isCurrent?.() === false) return [];
      children.forEach(child => {
        if (child?.type === 'folder' && child.path) queue.push(child.path);
        else if (child?.path) {
          const childKey = _normalizeFolderPathForCompare(child.path);
          if (!seenItems.has(childKey)) {
            seenItems.add(childKey);
            result.push({ ...child, _subfolderContent: true, _subfolderParentPath: folderPath });
          }
        }
      });
    } catch (error) {
      failedCount += 1;
      console.warn('サブフォルダの読み込みに失敗しました', folderPath, error);
    }
  }
  // 明示的に再帰表示を有効にした時だけ、配下の主要アプリ文書が内包・参照する
  // 画像・動画等も仮想リンクとして加える。HTTPは一括し、通常表示の負荷は増やさない。
  // サブフォルダ内容表示は遅延ロードされる任意機能。機能チャンクがまだ
  // 到着していなくても、通常のフォルダ一覧そのものは必ず表示する。
  const containedTargets = typeof canShowContainedFiles === 'function'
    ? result.filter(item => canShowContainedFiles(item) && item?.path)
    : [];
  if (containedTargets.length) {
    try {
      const contained = await apiPost('/contained-files/batch', {
        targets: containedTargets.map(item => ({ path: item.path, type: item.type || '' })),
      }, { foreground: true });
      if (options.isCurrent?.() === false) return [];
      (contained?.items || []).forEach(child => {
        if (!child?.path) return;
        result.push({
          ...child,
          linked: true,
          contained_reference: true,
          _subfolderContent: true,
          _subfolderParentPath: child.contained_by || path,
        });
      });
      if (contained?.failed?.length) failedCount += contained.failed.length;
      if (contained?.truncated) queue.push('__contained_files_truncated__');
    } catch (error) {
      failedCount += 1;
      console.warn('ファイル内の参照ファイル読み込みに失敗しました', error);
    }
  }
  result._folderBrowseIncomplete = (failedCount || queue.length)
    ? { failedCount, truncated: queue.length > 0 } : null;
  return result;
}
