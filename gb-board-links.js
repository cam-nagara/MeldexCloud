/* gb-board-links.js: Board linked file creation and preview helpers */

function _bdCurrentBoardPath() {
  const directPath = String((typeof bd !== 'undefined' && bd.path) || '').trim();
  if (directPath) return directPath;
  const statePath = String((typeof state !== 'undefined' && state.currentBoardPath) || '').trim();
  if (statePath) return statePath;
  try {
    const paneId = typeof GBLayout !== 'undefined' ? GBLayout.activePane : '';
    const tab = paneId && typeof GBTabs !== 'undefined' ? GBTabs.getActiveTab(paneId) : null;
    if (tab?.type === 'board') return String(tab.state?.boardPath || tab.path || '').trim();
  } catch {}
  return '';
}

function _bdBoardDir(boardPath) {
  return String(boardPath || _bdCurrentBoardPath() || '').replace(/\\/g, '/').split('/').slice(0, -1).join('/');
}

function _bdEnsureBoardPathForLinkCreation() {
  const boardPath = _bdCurrentBoardPath();
  if (!boardPath) return '';
  if (typeof bd !== 'undefined' && !bd.path) {
    bd.path = boardPath;
    if (!bd._loadedBoardPath) bd._loadedBoardPath = boardPath;
  }
  return boardPath;
}

function _bdResolveOpenType(type) {
  if (type === 'database' || type === 'sheet') return 'pivot';
  if (type === 'scenario') return 'scriptnote';
  if (type === 'image' || type === 'video' || type === 'audio') return 'media';
  if (type === 'pdf') return 'pdf';
  if (type === 'document') return 'document';
  return type || 'page';
}

function _bdIsExternalUrl(path) {
  return /^(https?:\/\/|mailto:|tel:)/i.test(String(path || '').trim());
}

function _bdIsExternalActionUrl(path) {
  return /^(mailto:|tel:)/i.test(String(path || '').trim());
}

function _bdIsExternalBrowserUrl(path) {
  return /^https?:\/\//i.test(String(path || '').trim());
}

function _bdOpenExternalBrowserUrl(path) {
  const url = String(path || '').trim();
  if (!_bdIsExternalBrowserUrl(url)) return false;
  if (typeof openExternalBrowserUrl === 'function') {
    openExternalBrowserUrl(url);
    return true;
  }
  if (typeof apiPost === 'function') {
    apiPost('/open-external-url', { url }, { silentError: true })
      .catch(() => window.open?.(url, '_blank', 'noopener'));
    return true;
  }
  window.open?.(url, '_blank', 'noopener');
  return true;
}

function _bdOpenExternalActionUrl(path) {
  const url = String(path || '').trim();
  if (!_bdIsExternalActionUrl(url)) return false;
  try {
    const opened = typeof window !== 'undefined' && typeof window.open === 'function'
      ? window.open(url, '_blank', 'noopener')
      : null;
    if (opened !== false) return true;
  } catch {}
  try {
    if (typeof window !== 'undefined') {
      window.location.href = url;
      return true;
    }
  } catch {}
  return false;
}

const _BD_LINK_OPENABLE_TYPES = new Set(['page', 'entity', 'scriptnote', 'database', 'pivot', 'tree', 'gallery', 'kanban', 'timeline', 'gantt', 'chart', 'graph', 'html', 'folder', 'calendar', 'csv', 'media', 'board']);
const _BD_DEFAULT_OPEN_TARGET_KEY = 'gb:board-default-open-target:v1';
const _BD_VALID_OPEN_TARGETS = new Set(['main', 'right-sidebar']);
const _bdResolvedLinkTypeCache = new Map();
const _bdPreviewSummaryCache = new Map();
let _bdLinkOpenSeq = 0;
let _bdLinkedSelectionSyncSeq = 0;

// ボードのリンクカード計画 (2026-08-13) Phase C: 「カードを選ぶと右サイドバーに表示する」の
// オン/オフを端末へ保存するキー。既定の開き先設定 (_BD_DEFAULT_OPEN_TARGET_KEY) と
// 同じ localStorage の仕組みに倣う。保存が無ければオン (true) 扱い。
const _BD_SELECT_AUTO_SUBPANEL_KEY = 'gb:board-select-open-subpanel:v1';
// 短時間に連続で選択が変わる操作 (キーボードでの移動等) を1回にまとめ、かつクリックが
// ドラッグへ変わる猶予を確保するための待ち時間。ドラッグは数十ms以内にクリック判定閾値
// (4px) を超えて bdIsBoardPointerBusy() が真になるため、これより長くしておけば発火時点の
// 再判定でドラッグ中の誤発火を防げる。
const _BD_SELECT_AUTO_SUBPANEL_DEBOUNCE_MS = 250;
let _bdSelectAutoSubpanelSeq = 0;
let _bdSelectAutoSubpanelTimer = null;

function _bdNormalizeOpenTarget(target) {
  const next = String(target || '').trim().toLowerCase();
  // 旧保存値は読み取り時にだけ正規化し、以後は right-sidebar を保存する。
  if (next === 'float' || next === 'sidebar') return 'right-sidebar';
  return _BD_VALID_OPEN_TARGETS.has(next) ? next : 'right-sidebar';
}

function _bdGetDefaultOpenTarget() {
  try {
    const saved = window.localStorage?.getItem(_BD_DEFAULT_OPEN_TARGET_KEY);
    const normalized = _bdNormalizeOpenTarget(saved);
    if (saved && saved !== normalized) window.localStorage?.setItem(_BD_DEFAULT_OPEN_TARGET_KEY, normalized);
    return normalized;
  } catch {
    return 'right-sidebar';
  }
}

function _bdSetDefaultOpenTarget(target) {
  const next = _bdNormalizeOpenTarget(target);
  try {
    window.localStorage?.setItem(_BD_DEFAULT_OPEN_TARGET_KEY, next);
  } catch {
    return false;
  }
  try {
    window.dispatchEvent(new CustomEvent('meldex:board-open-target-changed', {
      detail: { target: next },
    }));
  } catch {}
  return true;
}

function _bdResolveOpenInput(nodeOrPath, options) {
  const opts = options || {};
  if (nodeOrPath && typeof nodeOrPath === 'object') {
    const node = nodeOrPath;
    const path = String(node.link || node.imageSourcePath || node.img || '').trim();
    return {
      path,
      label: String(opts.label || node.text || path.split(/[/\\]/).pop() || path).trim(),
      linkType: String(opts.linkType || node.linkType || (node.img ? 'image' : '')).trim(),
    };
  }
  const path = String(nodeOrPath || '').trim();
  return {
    path,
    label: String(opts.label || path.split(/[/\\]/).pop() || path).trim(),
    linkType: String(opts.linkType || '').trim(),
  };
}

function _bdIsStandaloneBoardSurface() {
  return typeof window !== 'undefined' && !!window.MeldexBoardStandalone;
}

function _bdIsCloudMobileBoardSurface() {
  return typeof window !== 'undefined'
    && !!window.MeldexCloudMobile?.isMobileEditingUiEnabled?.();
}

function _bdAvailableOpenTargets() {
  if (_bdIsStandaloneBoardSurface()) {
    return [{ value: 'main', label: 'ビューワー' }];
  }
  if (_bdIsCloudMobileBoardSurface()) {
    return [
      { value: 'right-sidebar', label: 'サイドドロワー' },
      { value: 'main', label: 'メインパネル' },
    ];
  }
  return [
    { value: 'right-sidebar', label: '右サイドバー' },
    { value: 'main', label: 'メインパネル' },
  ];
}

function _bdShouldResolveLinkedType(path, explicitType) {
  if (String(explicitType || '').trim()) return false;
  const nextPath = String(path || '').trim();
  if (!nextPath || /^[a-z][a-z0-9+.-]*:\/\//i.test(nextPath)) return false;
  const ext = _bdLinkExt(nextPath);
  return !ext || ['md', 'json'].includes(ext);
}

async function _bdFetchLinkedType(path) {
  const key = String(path || '').trim();
  if (!key) return '';
  if (_bdResolvedLinkTypeCache.has(key)) return _bdResolvedLinkTypeCache.get(key);
  let type = '';
  try {
    if (typeof apiFetch === 'function') {
      const result = await apiFetch('/check-type?path=' + encodeURIComponent(key));
      type = String(result?.type || '').trim();
    } else if (typeof fetch === 'function' && typeof API_BASE !== 'undefined') {
      const resp = await fetch(API_BASE + '/check-type?path=' + encodeURIComponent(key));
      if (resp.ok) {
        const result = await resp.json();
        type = String(result?.type || '').trim();
      }
    }
  } catch {
    type = '';
  }
  if (type === 'unknown') type = '';
  _bdResolvedLinkTypeCache.set(key, type);
  return type;
}

async function _bdResolveLinkedEntryAsync(path, label, linkType) {
  if (typeof GBLinkRouter !== 'undefined' && typeof GBLinkRouter.resolveAsync === 'function') {
    const common = await GBLinkRouter.resolveAsync(path, { label, linkType });
    if (common?.external) {
      return { type: 'html', label: common.label, path: common.path, urlExternal: true };
    }
    return common;
  }
  const inferred = _bdInferLinkType(path, linkType);
  if (inferred || !_bdShouldResolveLinkedType(path, linkType)) {
    return _bdResolveLinkedEntry(path, label, inferred || linkType);
  }
  const resolved = await _bdFetchLinkedType(path);
  return _bdResolveLinkedEntry(path, label, resolved || linkType);
}

function _bdIsCurrentLinkedSelection(path) {
  if (typeof bd === 'undefined' || !(bd.selected instanceof Set) || bd.selected.size !== 1) return false;
  const selectedId = [...bd.selected][0];
  const node = bd.nodes.find(v => v.id === selectedId);
  return !!node && String(node.link || '') === String(path || '');
}

function bdCancelLinkedSelectionSync() {
  _bdLinkedSelectionSyncSeq += 1;
}

function _bdGetSelectAutoSubpanelEnabled() {
  try {
    const stored = window.localStorage?.getItem(_BD_SELECT_AUTO_SUBPANEL_KEY);
    return stored == null ? true : stored !== '0';
  } catch {
    return true;
  }
}

function _bdSetSelectAutoSubpanelEnabled(value) {
  const next = value !== false;
  try {
    window.localStorage?.setItem(_BD_SELECT_AUTO_SUBPANEL_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

if (typeof window !== 'undefined') {
  window.MeldexBoardSelectAutoSubpanel = Object.freeze({
    key: _BD_SELECT_AUTO_SUBPANEL_KEY,
    isEnabled: _bdGetSelectAutoSubpanelEnabled,
    setEnabled: _bdSetSelectAutoSubpanelEnabled,
  });
}

function _bdBoardPointerBusy() {
  try {
    return typeof window.bdIsBoardPointerBusy === 'function' && window.bdIsBoardPointerBusy();
  } catch {
    return false;
  }
}

// gb-subpanel.js の GBSubPanel.open() はモバイルのサイドドロワー環境では reveal の値に
// 関わらずドロワーを開く (フォーカスを奪う)。Phase C の自動表示はモバイルでは発火させない。
function _bdIsMobileDrawerSurface() {
  const drawer = typeof window !== 'undefined' ? window.MeldexCloudMobileSideDrawer : null;
  return !!(drawer && typeof drawer.isEnabled === 'function' && drawer.isEnabled());
}

// ボードのリンクカード計画 (2026-08-13) Phase C: bdSelect() から呼ばれる。カードを1枚だけ
// 選んだ時、右サイドバー（サブパネル）が開いていれば、その中身を選んだカードのリンク先へ
// 自動で差し替える。「開く」ボタン (Phase B-0) と違い reveal:false で呼ぶため、閉じている
// 右サイドバーを勝手に開くことはない (gb-subpanel.js の GBSubPanel.open 側の分担)。
// nodeId が空 (複数選択・全解除) のときは予約の取り消しだけ行う。
function bdRequestLinkedSelectionAutoSubpanel(nodeId) {
  const seq = ++_bdSelectAutoSubpanelSeq;
  if (_bdSelectAutoSubpanelTimer != null) {
    clearTimeout(_bdSelectAutoSubpanelTimer);
    _bdSelectAutoSubpanelTimer = null;
  }
  if (!nodeId) return;
  if (!_bdGetSelectAutoSubpanelEnabled()) return;
  if (typeof GBSubPanel === 'undefined' || typeof GBSubPanel.open !== 'function') return;
  if (_bdIsStandaloneBoardSurface() || _bdIsMobileDrawerSurface()) return;
  _bdSelectAutoSubpanelTimer = window.setTimeout(() => {
    _bdSelectAutoSubpanelTimer = null;
    _bdFireSelectAutoSubpanel(seq, nodeId);
  }, _BD_SELECT_AUTO_SUBPANEL_DEBOUNCE_MS);
}

async function _bdFireSelectAutoSubpanel(seq, nodeId) {
  if (seq !== _bdSelectAutoSubpanelSeq) return; // その後さらに選択が変わった
  if (!_bdGetSelectAutoSubpanelEnabled()) return; // 待機中にオプションがオフへ変わった
  if (typeof bd === 'undefined' || !(bd.selected instanceof Set) || bd.selected.size !== 1) return;
  if ([...bd.selected][0] !== nodeId) return; // 複数選択・別カード選択済み
  if (bd.editing) return; // カードの文字を編集中
  if (_bdBoardPointerBusy()) return; // ドラッグ・リサイズ・範囲選択・パン中
  const node = bd.nodes?.find(candidate => candidate?.id === nodeId);
  if (!node) return;
  const resolved = typeof MeldexBoardInfoPanel !== 'undefined' && typeof MeldexBoardInfoPanel.resolveTarget === 'function'
    ? MeldexBoardInfoPanel.resolveTarget(node)
    : null;
  if (!resolved || resolved.kind !== 'file' || !resolved.path) return; // リンクを持たないカード
  if (typeof GBSubPanel === 'undefined' || typeof GBSubPanel.open !== 'function') return;
  const current = typeof GBSubPanel.getCurrentTarget === 'function' ? GBSubPanel.getCurrentTarget() : null;
  if (current && current.path === resolved.path) return; // 同じカードの再選択では再読み込みしない
  if (typeof openLinkedPathInRightPane !== 'function') return;
  await openLinkedPathInRightPane(resolved.path, node.text || '', {
    linkType: resolved.type || '',
    reveal: false,
  });
}

function _bdFindBoardPaneId() {
  if (typeof GBLayout === 'undefined' || typeof GBTabs === 'undefined') return '';
  const activePaneId = GBLayout.activePane;
  const activeTab = activePaneId ? GBTabs.getActiveTab(activePaneId) : null;
  if (activePaneId && activeTab?.type === 'board') return activePaneId;
  const allPanes = GBLayout.getAllPanes(GBLayout.root);
  return allPanes.find(pane => (pane.tabs || []).some(tab => tab.type === 'board' && (!bd.path || tab.path === bd.path)))?.id || '';
}

function _bdFindSidePane(boardPaneId, options) {
  if (typeof GBLayout === 'undefined') return '';
  const opts = options || {};
  const isTargetPane = pane => pane?.id !== boardPaneId && !_bdIsUtilityPane(pane);
  if (opts.preferRight) {
    const rightPaneId = _bdFindPaneRightOfBoard(boardPaneId, isTargetPane);
    if (rightPaneId || opts.rightOnly) return rightPaneId;
  }
  const allPanes = _bdAllVisiblePanes();
  return allPanes.find(isTargetPane)?.id || '';
}

function _bdFindPaneByTabType(type, boardPaneId, options) {
  if (!type || typeof GBLayout === 'undefined') return '';
  const opts = options || {};
  const allPanes = _bdAllVisiblePanes();
  const hasTypeTab = pane => pane?.id !== boardPaneId && (pane.tabs || []).some(tab => tab.type === type);
  if (opts.preferRight) {
    const rightPaneId = _bdFindPaneRightOfBoard(boardPaneId, hasTypeTab);
    if (rightPaneId || opts.rightOnly) return rightPaneId;
  }
  const activeMatch = allPanes.find(pane => pane.id !== boardPaneId && (pane.tabs || [])[pane.activeTabIndex]?.type === type);
  if (activeMatch) return activeMatch.id;
  const anyMatch = allPanes.find(hasTypeTab);
  return anyMatch?.id || '';
}

function _bdAllVisiblePanes() {
  if (typeof GBLayout === 'undefined' || typeof GBLayout.getAllPanes !== 'function') return [];
  try { return GBLayout.getAllPanes(GBLayout.root, { activeOnly: true }); } catch {}
  return GBLayout.getAllPanes(GBLayout.root);
}

function _bdPaneActiveType(pane) {
  return (pane?.tabs || [])[pane?.activeTabIndex]?.type || '';
}

function _bdIsUtilityPane(pane) {
  const utilityTypes = new Set(['outliner', 'detail', 'preview', 'chat', 'history', 'annotation', 'sticky', 'search', 'version', 'calendar']);
  return utilityTypes.has(_bdPaneActiveType(pane));
}

function _bdPaneRect(paneId) {
  const el = typeof GBLayout !== 'undefined' ? GBLayout.paneMap?.[paneId]?.el : null;
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return rect;
}

function _bdVerticalOverlap(a, b) {
  return Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
}

function _bdFindPaneRightOfBoard(boardPaneId, predicate) {
  const boardRect = _bdPaneRect(boardPaneId);
  if (!boardRect) return '';
  const candidates = _bdAllVisiblePanes()
    .filter(pane => predicate(pane))
    .map(pane => ({ pane, rect: _bdPaneRect(pane.id) }))
    .filter(item => item.rect && item.rect.left >= boardRect.right - 2 && _bdVerticalOverlap(boardRect, item.rect) > 0)
    .sort((a, b) => (a.rect.left - boardRect.right) - (b.rect.left - boardRect.right));
  return candidates[0]?.pane?.id || '';
}

function _bdInferLinkType(path, explicitType) {
  const rawType = String(explicitType || '').trim();
  if (rawType) return rawType;
  const lower = String(path || '').trim().toLowerCase();
  if (_bdIsExternalUrl(lower)) return 'html';
  const ext = _bdLinkExt(lower);
  if (lower.endsWith('.mel-scenario') || lower.endsWith('.scriptnote.json') || lower.endsWith('.scenario.json')) return 'scriptnote';
  if (lower.endsWith('.mel-board') || lower.endsWith('.board.json') || lower.endsWith('.canvas.json') || ext === 'board') return 'board';
  if (lower.endsWith('.mel-sheet')) return 'database';
  if (lower.endsWith('.mel-timer') || lower.endsWith('.timer.json')) return 'unsupported';
  if (ext === 'md' || ext === 'txt') return 'page';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'csv') return 'csv';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (_bdLinkMediaType(ext)) return _bdLinkMediaType(ext);
  return '';
}

function _bdResolveLinkedEntry(path, label, linkType) {
  if (typeof GBLinkRouter !== 'undefined' && typeof GBLinkRouter.resolve === 'function') {
    const common = GBLinkRouter.resolve(path, { label, linkType });
    if (common?.external) {
      return { type: 'html', label: common.label, path: common.path, urlExternal: true };
    }
    return common;
  }
  const nextPath = String(path || '').trim();
  const nextLabel = String(label || nextPath.split(/[/\\]/).pop() || nextPath).trim() || nextPath;
  const rawType = String(linkType || '').trim();
  const explicitType = rawType ? _bdResolveOpenType(rawType) : '';
  const explicitMediaType = ['image', 'video', 'audio'].includes(rawType) ? rawType : '';
  const lower = nextPath.toLowerCase();
  const ext = _bdLinkExt(nextPath);
  if (_bdIsExternalUrl(nextPath)) return { type: 'html', label: nextLabel, path: nextPath, urlExternal: true };
  if (explicitType === 'scriptnote') return { type: 'scriptnote', label: nextLabel, path: nextPath };
  if (explicitType === 'board') return { type: 'board', label: nextLabel, path: nextPath };
  if (explicitType === 'timer' || explicitType === 'unsupported') return { type: 'unsupported', retired: true, retiredType: 'timer', label: nextLabel, path: nextPath };
  if (explicitType === 'csv') return { type: 'csv', label: nextLabel, path: nextPath };
  if (explicitType === 'html') return { type: 'html', label: nextLabel, path: nextPath };
  if (explicitType === 'entity') return { type: 'entity', label: nextLabel, path: nextPath };
  if (['pivot', 'tree', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form'].includes(explicitType)) return { type: explicitType, label: nextLabel, path: nextPath };
  if (explicitType === 'folder') return { type: 'folder', label: nextLabel, path: nextPath };
  if (explicitType === 'calendar') return { type: 'timeline', label: nextLabel, path: nextPath, calendarFile: true };
  if (explicitType === 'pdf' || (explicitType === 'document' && ext === 'pdf')) {
    return { type: 'media', mediaType: 'pdf', label: nextLabel, path: nextPath };
  }
  if (explicitType === 'document') return { type: 'page', label: nextLabel, path: nextPath };
  if (explicitType === 'page') return { type: 'page', label: nextLabel, path: nextPath };
  if (explicitType === 'media') {
    return { type: 'media', mediaType: explicitMediaType || _bdLinkMediaType(ext) || 'file', label: nextLabel, path: nextPath };
  }
  if (lower.endsWith('.mel-scenario') || lower.endsWith('.scriptnote.json') || lower.endsWith('.scenario.json')) return { type: 'scriptnote', label: nextLabel, path: nextPath };
  if (lower.endsWith('.mel-board') || lower.endsWith('.board.json') || lower.endsWith('.canvas.json')) return { type: 'board', label: nextLabel, path: nextPath };
  if (ext === 'board') return { type: 'board', label: nextLabel, path: nextPath };
  if (lower.endsWith('.mel-sheet')) return { type: 'database', label: nextLabel, path: nextPath };
  if (lower.endsWith('.mel-timer') || lower.endsWith('.timer.json')) return { type: 'unsupported', retired: true, retiredType: 'timer', label: nextLabel, path: nextPath };
  if (ext === 'csv') return { type: 'csv', label: nextLabel, path: nextPath };
  if (ext === 'html' || ext === 'htm') return { type: 'html', label: nextLabel, path: nextPath };
  if (['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'apng', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext)) return { type: 'media', mediaType: 'image', label: nextLabel, path: nextPath };
  if (['mp4', 'mov', 'avi', 'webm', 'mkv', 'ogv'].includes(ext)) return { type: 'media', mediaType: 'video', label: nextLabel, path: nextPath };
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext)) return { type: 'media', mediaType: 'audio', label: nextLabel, path: nextPath };
  if (ext === 'pdf') return { type: 'media', mediaType: 'pdf', label: nextLabel, path: nextPath };
  if (ext === 'md' || ext === 'json' || !ext) return { type: 'page', label: nextLabel, path: nextPath };
  return { type: 'page', label: nextLabel, path: nextPath };
}

function _bdTabStateForLinkedEntry(entry) {
  const state = {};
  if (!entry || typeof entry !== 'object') return state;
  if (entry.mediaType) state.mediaType = entry.mediaType;
  if (entry.calendarFile) state.calendarFile = true;
  if (entry.urlExternal) state.urlExternal = true;
  if (entry.type === 'scriptnote') {
    state.scenarioPath = entry.path || '';
    state.label = entry.label || '';
  } else if (entry.type === 'board') {
    state.boardPath = entry.path || '';
    state.label = entry.label || '';
  }
  return state;
}

function _bdBoardHistoryEntry(tab) {
  const boardPath = String(
    (typeof bd !== 'undefined' && bd.path)
    || tab?.state?.boardPath
    || tab?.path
    || '',
  ).trim();
  const entry = {
    type: 'board',
    path: boardPath,
    boardPath,
    label: String(tab?.label || (typeof bd !== 'undefined' && bd.label) || boardPath.split(/[/\\]/).pop() || boardPath),
  };
  if (typeof bd !== 'undefined' && boardPath && String(bd.path || '') === boardPath) {
    entry.selectedNodeIds = bd.selected instanceof Set ? [...bd.selected] : [];
    entry.boardView = {
      zoom: Number(bd.zoom) || 1,
      panX: Number(bd.panX) || 0,
      panY: Number(bd.panY) || 0,
      rotation: Number(bd.rotation) || 0,
    };
  }
  return entry;
}

function _bdNavigationEntryForTab(tab) {
  if (!tab) return null;
  if (tab.type === 'board') return _bdBoardHistoryEntry(tab);
  return {
    type: tab.type,
    path: tab.path,
    label: tab.label || tab.path,
    ...(tab.state || {}),
  };
}

function _bdSeedTabNavigation(tab, origin, destination) {
  if (!tab || !origin?.type || !destination?.type) return;
  if (!Array.isArray(tab.navHistory)) tab.navHistory = [];
  if (!Number.isInteger(tab.navIndex)) tab.navIndex = tab.navHistory.length - 1;
  tab.navHistory.splice(tab.navIndex + 1);
  const top = tab.navHistory[tab.navHistory.length - 1];
  if (!top || top.type !== origin.type || top.path !== origin.path) tab.navHistory.push(origin);
  const current = tab.navHistory[tab.navHistory.length - 1];
  if (!current || current.type !== destination.type || current.path !== destination.path) {
    tab.navHistory.push(destination);
  }
  if (tab.navHistory.length > 50) tab.navHistory.splice(0, tab.navHistory.length - 50);
  tab.navIndex = tab.navHistory.length - 1;
}

function _bdAddLinkedTabToExactPane(targetPaneId, entry, tabState) {
  if (typeof GBTabs === 'undefined' || typeof GBLayout === 'undefined') return null;
  const targetPane = GBLayout.findNode(GBLayout.root, targetPaneId)?.node || null;
  if (!targetPane) return null;
  if (typeof GBLayout.isPaneLocked === 'function' && GBLayout.isPaneLocked(targetPaneId) && (targetPane.tabs || []).length > 0) {
    if (typeof showStatus === 'function') showStatus('ロック中のパネルには新しいタブを追加できません', true);
    return null;
  }
  const tab = typeof GBTabs.createTab === 'function'
    ? GBTabs.createTab(entry.label, entry.type, entry.path, tabState)
    : {
      id: 'tab-' + Date.now().toString(36),
      type: entry.type,
      label: entry.label || '(無題)',
      path: entry.path || '',
      icon: typeof GBTabs.tabIcon === 'function' ? GBTabs.tabIcon(entry.type) : 'page',
      state: tabState || {},
    };
  targetPane.tabs = targetPane.tabs || [];
  targetPane.tabs.push(tab);
  targetPane.activeTabIndex = targetPane.tabs.length - 1;
  if (typeof GBLayout.revealPane === 'function') GBLayout.revealPane(targetPaneId, { deferRender: true });
  if (typeof GBLayout.render === 'function') GBLayout.render();
  if (typeof GBLayout.saveLayout === 'function') GBLayout.saveLayout();
  return tab.id || null;
}

// 表示中のタブそのものを開き先へ切り替える。切り替えられた場合はそのタブIDを返す。
// ロック中のパネル、タブが1つも無いパネル、固定タブは対象外（従来どおり新しいタブを足す）。
function _bdRetargetActiveTabInPane(targetPaneId, targetPane, entry, tabState) {
  if (typeof GBTabs === 'undefined' || typeof GBTabs.updateTab !== 'function') return '';
  if (typeof GBLayout?.isPaneLocked === 'function' && GBLayout.isPaneLocked(targetPaneId)) return '';
  const tabs = targetPane?.tabs || [];
  if (!tabs.length) return '';
  const index = Math.min(Math.max(targetPane.activeTabIndex || 0, 0), tabs.length - 1);
  const activeTab = tabs[index];
  if (!activeTab || activeTab.pinned) return '';
  if (activeTab.path && activeTab.path !== entry.path) {
  const dbTypes = new Set(['database', 'pivot', 'tree', 'gallery', 'kanban', 'timeline', 'gantt', 'chart', 'graph', 'form']);
    if (dbTypes.has(activeTab.type) && typeof _navPushWithViewState === 'function') {
      const paneCtx = typeof getPaneContext === 'function' ? getPaneContext(targetPaneId) : null;
      _navPushWithViewState({
        ...(paneCtx || {}),
        paneId: targetPaneId,
        dbPath: activeTab.path,
        currentViewIdx: paneCtx?.currentViewIdx ?? activeTab.state?.viewIdx,
      }, entry.type === 'entity' ? entry.label : null);
    } else if (typeof _forcedNavPush === 'function') {
      _forcedNavPush(_bdNavigationEntryForTab(activeTab), targetPaneId);
    }
  }
  const updated = GBTabs.updateTab(
    targetPaneId,
    activeTab.id,
    { label: entry.label, type: entry.type, path: entry.path, state: tabState },
    { activate: true },
  );
  if (!updated) return '';
  if (typeof _forcedNavPush === 'function') {
    _forcedNavPush({
      type: entry.type,
      path: entry.path,
      label: entry.label,
      ...(tabState || {}),
    }, targetPaneId);
  }
  if (typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.refreshPaneAfterTabSwitch === 'function') {
    GBPaneBridge.refreshPaneAfterTabSwitch(targetPaneId);
  }
  return activeTab.id;
}

function _bdActivateNavEntryInPane(targetPaneId, entry, options) {
  if (!entry || !entry.type) return false;
  if (entry.urlExternal && _bdOpenExternalActionUrl(entry.path)) return true;
  if (!targetPaneId || typeof GBTabs === 'undefined' || typeof GBLayout === 'undefined' || typeof navOpen !== 'function') {
    if (typeof navOpen === 'function') {
      navOpen(entry);
      return true;
    }
    return false;
  }
  const targetPane = GBLayout.findNode(GBLayout.root, targetPaneId)?.node || null;
  const existingTab = targetPane?.tabs?.find(tab => tab.type === entry.type && tab.path === entry.path) || null;
  const tabState = _bdTabStateForLinkedEntry(entry);
  if (existingTab) existingTab.state = { ...(existingTab.state || {}), ...tabState };
  if (!targetPane) return false;
  const forceTargetPane = options?.forceTargetPane === true;
  const preserveActivePane = options?.preserveActivePane === true;
  if (!preserveActivePane) {
    if (typeof GBLayout.revealPane === 'function') {
      GBLayout.revealPane(targetPaneId, { activate: true, deferRender: true });
    }
    if (typeof GBLayout.setActivePane === 'function' && GBLayout.activePane !== targetPaneId) {
      GBLayout.setActivePane(targetPaneId, { sync: true });
    }
  }
  const activeTab = (targetPane.tabs || [])[targetPane.activeTabIndex || 0] || null;
  const historyOrigin = options?.historyOrigin
    || (activeTab?.type === 'board' ? _bdBoardHistoryEntry(activeTab) : null);
  // 開いているタブを開き先へ切り替える（新しいタブを増やさない）。
  // 同じシートを何度も開くとタブが際限なく増えるため、メインパネルで開く経路で使う。
  if (!existingTab && options?.reuseActiveTab === true) {
    const reusedTabId = _bdRetargetActiveTabInPane(targetPaneId, targetPane, entry, tabState);
    if (reusedTabId) {
      if (!preserveActivePane && typeof GBLayout.setActivePane === 'function') GBLayout.setActivePane(targetPaneId, { sync: true });
      return true;
    }
  }
  const tabId = existingTab ? existingTab.id : (
    forceTargetPane
      ? _bdAddLinkedTabToExactPane(targetPaneId, entry, tabState)
      : GBTabs.addTab(targetPaneId, entry.label, entry.type, entry.path, tabState, { preserveActivePane })
  );
  if (!tabId) return false;
  const openedTab = (targetPane.tabs || []).find(tab => tab.id === tabId) || existingTab;
  if (historyOrigin && openedTab) _bdSeedTabNavigation(openedTab, historyOrigin, {
    type: entry.type,
    path: entry.path,
    label: entry.label,
    ...tabState,
  });
  if (tabId) GBTabs.activateTab(targetPaneId, tabId, { preserveActivePane });
  if (!preserveActivePane && typeof GBLayout.setActivePane === 'function') GBLayout.setActivePane(targetPaneId, { sync: true });
  return true;
}

async function bdOpenLinkedPath(path, label, options) {
  const opts = options || {};
  const standaloneType = _bdResolveOpenType(_bdInferLinkType(path, opts.linkType));
  return MeldexBoardOpenTarget.open(path, opts.target, {
    ...opts,
    label,
    linkType: opts.linkType || standaloneType,
  });
}

async function bdOpenLinkedPathInCurrentPane(path, label, linkType) {
  if (!path) return;
  const entry = await _bdResolveLinkedEntryAsync(path, label, linkType);
  if (entry.urlExternal && _bdOpenExternalActionUrl(entry.path)) return;
  if (typeof navOpen === 'function') {
    navOpen(entry);
    return;
  }
  if (typeof openLink === 'function') openLink(path, label);
}

function _bdCollectPanesFromRoot(root, out) {
  if (!root) return;
  if (root.type === 'pane') {
    out.push(root);
    return;
  }
  if (Array.isArray(root.children)) root.children.forEach(child => _bdCollectPanesFromRoot(child, out));
  if (Array.isArray(root.groups)) root.groups.forEach(group => _bdCollectPanesFromRoot(group?.root, out));
}

function _bdFindRightSidebarPaneByTabType(tabType) {
  if (!tabType || typeof GBLayout === 'undefined' || !GBLayout.root) return null;
  let found = null;
  function walk(node) {
    if (!node || found) return;
    if (node.type === 'panelset' && node.meldexRole === 'right-sidebar' && Array.isArray(node.groups)) {
      for (const group of node.groups) {
        const panes = [];
        _bdCollectPanesFromRoot(group?.root, panes);
        for (const pane of panes) {
          const tabIdx = (pane.tabs || []).findIndex(tab => tab.type === tabType);
          if (tabIdx >= 0) {
            found = { panelset: node, group, pane, tab: pane.tabs[tabIdx], tabIdx };
            return;
          }
        }
      }
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
    if (Array.isArray(node.groups)) node.groups.forEach(group => walk(group?.root));
  }
  walk(GBLayout.root);
  return found;
}

function _bdRevealRightSidebarTool(tabType) {
  const match = _bdFindRightSidebarPaneByTabType(tabType);
  if (!match) {
    if (typeof toggleRightPanelTab === 'function') {
      toggleRightPanelTab(tabType);
      return _bdFindRightSidebarPaneByTabType(tabType)?.pane?.id || '';
    }
    return '';
  }
  match.panelset.activeGroupId = match.group.id;
  match.pane.activeTabIndex = match.tabIdx;
  if (match.panelset.collapsed && typeof GBLayout?.setNodeCollapsed === 'function') {
    GBLayout.setNodeCollapsed(match.panelset.id, false, {
      skipActivePaneCallback: true,
    });
  }
  if (typeof GBTabs !== 'undefined' && typeof GBTabs.activateTab === 'function') {
    GBTabs.activateTab(match.pane.id, match.tab.id, { preserveActivePane: true });
  }
  // 表示グループの切り替えはタブのアクティブ化だけでは画面へ反映されない。
  // 再描画しないと対象の区画がDOMに載らず、内容を書き込んでも見えないままになる。
  if (typeof GBLayout?.render === 'function') GBLayout.render();
  if (typeof GBLayout?.saveLayout === 'function') GBLayout.saveLayout({ immediate: true });
  return match.pane.id || '';
}

// 右サイドバーの区画を「必ず見える状態」にする共通の入口。
// ボードのリンク計画 (2026-08-13) Phase B-0: これまで開く処理は呼び出し側任せで、
// ボードのリンクとエントリ詳細が別々の方法で開こうとしていた。GBSubPanel.open() が
// この1つを呼ぶようにして、開く経路が増えても開き忘れが起きないようにする。
// 2つ目の実装を作らないため、中身は上の _bdRevealRightSidebarTool をそのまま使う。
if (typeof window !== 'undefined') {
  window.MeldexRightSidebarReveal = {
    reveal(tabType) {
      try {
        return _bdRevealRightSidebarTool(String(tabType || 'subpanel'));
      } catch {
        return '';
      }
    },
  };
}

// 右サイドバーのビューワー区画。退避領域に置かれたままなら表示できないので null を返す。
function _bdVisibleRightSidebarPreviewPane() {
  const pane = document.getElementById('gb-preview-pane');
  if (!pane || !pane.isConnected) return null;
  const shown = pane.offsetParent !== null || pane.getClientRects().length > 0;
  return shown ? pane : null;
}

function _bdMainPaneIdForLinkedOpen() {
  if (typeof GBPaneDefaultLayout !== 'undefined' && typeof GBPaneDefaultLayout.resolveMainPaneId === 'function') {
    const paneId = GBPaneDefaultLayout.resolveMainPaneId({ contentOnly: true });
    if (paneId) return paneId;
  }
  return (typeof GBLayout !== 'undefined' ? GBLayout.activePane : '') || '';
}

async function openLinkedPathInMainPane(path, label, options) {
  const opts = options || {};
  if (!path) return false;
  const entry = opts.entry || await _bdResolveLinkedEntryAsync(path, label, opts.linkType);
  if (entry.urlExternal && _bdOpenExternalActionUrl(entry.path)) return true;
  const paneId = _bdMainPaneIdForLinkedOpen();
  if (!paneId) {
    if (typeof navOpen === 'function') {
      navOpen(entry);
      return true;
    }
    return false;
  }
  // メインパネルで開くときは、表示中のタブをそのまま開き先へ切り替える（タブを増やさない）
  return _bdActivateNavEntryInPane(paneId, entry, {
    forceTargetPane: true,
    preserveActivePane: false,
    reuseActiveTab: true,
  });
}

async function openLinkedPathInRightSidebar(path, label, options) {
  return openLinkedPathInRightPane(path, label, options);
}

async function openLinkedPathInRightPane(path, label, options) {
  const opts = options || {};
  const entry = opts.entry || await _bdResolveLinkedEntryAsync(path, label, opts.linkType);
  if (entry.urlExternal && _bdOpenExternalActionUrl(entry.path)) return true;
  if (entry.urlExternal && _bdIsExternalBrowserUrl(entry.path)) return _bdOpenExternalBrowserUrl(entry.path);
  // サブパネル内からは、別のサブパネルを開くUI（右サイドバーで開く）を
  // 使用できない（計画書「右サイドバー操作の制限」節）。外部URL（mailto/tel）は対象外
  // なので上の早期returnより後で判定する。sourceEl（呼び出し元のDOM要素）または
  // sourcePaneId を明示的なヒントとして優先し、無ければフォーカス位置で判定する。
  if (typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.guardRightSidebarTool === 'function') {
    const source = opts.sourceEl || (opts.sourcePaneId || undefined);
    if (!GBPaneBridge.guardRightSidebarTool('subpanel', source)) return false;
  }
  // 右サイドバーで開く = 新しい右サイドバー常設「サブパネル」（GBSubPanel）で表示する。
  // 対応対象に含まれない拡張子は、既存の解決結果(entry.type)に関わらず
  // GBLinkRouter の判定を優先し、汎用ビューワー（ノート扱い）へ誤って
  // フォールバックさせず「未対応形式」としてサブパネル側にエラー表示させる。
  if (typeof GBSubPanel !== 'undefined' && typeof GBSubPanel.open === 'function') {
    // 右サイドバーを開く処理は GBSubPanel.open() が必ず行う（Phase B-0 で共通化）。
    // ここで先に呼ぶと二重に走るため、呼び出し側からは外している。
    const targetPath = entry.path || path || '';
    // entry.type は _bdResolveLinkedEntryAsync の最終フォールバック（拡張子不明→'page'）を
    // 経ている場合があるため、ここでは opts.linkType（呼び出し元が実際に渡した明示ヒント）
    // だけを判定材料にする。entry.type を渡すと常に recognized=true になってしまう。
    const recognized = typeof GBLinkRouter !== 'undefined' && typeof GBLinkRouter.isRecognizedPath === 'function'
      ? GBLinkRouter.isRecognizedPath(targetPath, opts.linkType)
      : true;
    return GBSubPanel.open({
      type: recognized ? entry.type : 'unsupported',
      path: targetPath,
      label: entry.label || label || '',
      state: { ..._bdTabStateForLinkedEntry(entry), ...(opts.state || {}) },
    }, { reveal: opts.reveal !== false });
  }
  if (typeof navOpen === 'function') {
    navOpen(entry);
    return true;
  }
  return false;
}

async function _bdOpenAtTarget(path, label, linkType, target, options) {
  const opts = { ...(options || {}), linkType };
  const normalized = _bdNormalizeOpenTarget(target);
  const mapped = _bdIsStandaloneBoardSurface() ? 'main' : normalized;
  if (mapped === 'main') return openLinkedPathInMainPane(path, label, opts);
  if (typeof window !== 'undefined' && typeof window.openLinkedPathInRightSidebar === 'function') {
    return window.openLinkedPathInRightSidebar(path, label, opts);
  }
  return openLinkedPathInRightPane(path, label, opts);
}

async function copyBoardLinkedPath(path) {
  const targetPath = String(path || '').trim();
  if (!targetPath) {
    if (typeof showStatus === 'function') showStatus('パスをコピーできませんでした', true);
    return false;
  }
  const vaultPath = typeof state !== 'undefined' ? String(state?.vaultPath || '') : '';
  const clipboardPath = window.GBPathUtils?.resolveForClipboard
    ? window.GBPathUtils.resolveForClipboard(targetPath, vaultPath)
    : targetPath;
  try {
    await navigator.clipboard.writeText(clipboardPath);
    if (typeof showStatus === 'function') showStatus('パスをコピーしました');
    return true;
  } catch {
    if (typeof showStatus === 'function') showStatus('パスをコピーできませんでした', true);
    return false;
  }
}

const MeldexBoardOpenTarget = Object.freeze({
  key: _BD_DEFAULT_OPEN_TARGET_KEY,
  getDefault: _bdGetDefaultOpenTarget,
  setDefault: _bdSetDefaultOpenTarget,
  getAvailableTargets: _bdAvailableOpenTargets,
  availableTargets: _bdAvailableOpenTargets,
  copyPath: copyBoardLinkedPath,
  resolve(nodeOrPath, options) {
    return _bdResolveOpenInput(nodeOrPath, options);
  },
  async open(nodeOrPath, explicitTarget, options) {
    const resolved = _bdResolveOpenInput(nodeOrPath, options);
    if (!resolved.path) return false;
    const seq = ++_bdLinkOpenSeq;
    const target = explicitTarget == null || explicitTarget === ''
      ? _bdGetDefaultOpenTarget()
      : _bdNormalizeOpenTarget(explicitTarget);
    const entry = await _bdResolveLinkedEntryAsync(resolved.path, resolved.label, resolved.linkType);
    if (seq !== _bdLinkOpenSeq) return false;
    return _bdOpenAtTarget(resolved.path, resolved.label, resolved.linkType, target, {
      ...(options || {}),
      entry,
    });
  },
  showMenu(nodeOrPath, anchorElement, options) {
    const resolved = _bdResolveOpenInput(nodeOrPath, options);
    if (!resolved.path || !anchorElement) return false;
    const rect = anchorElement.getBoundingClientRect?.();
    return showLinkedOpenTargetMenu({
      currentTarget: anchorElement,
      clientX: rect?.right || 0,
      clientY: rect?.bottom || 0,
      preventDefault() {},
      stopPropagation() {},
    }, resolved.path, resolved.label, {
      ...(options || {}),
      linkType: resolved.linkType,
    });
  },
});

if (typeof window !== 'undefined') {
  window.MeldexBoardOpenTarget = MeldexBoardOpenTarget;
  window.openLinkedPathInRightSidebar = openLinkedPathInRightSidebar;
  window.openLinkedPathInRightPane = openLinkedPathInRightPane;
}

// 右サイドバー(ビューワータブ)にエントリのプロパティ一覧＋本文を描画する。
// フルページ/サブパネル/モバイルドロワーと同じ共有レンダラ renderEntityPropsGridInto を使う。
async function _bdRenderEntityIntoRightPane(entityPath, label, pane) {
  if (!entityPath || !pane || typeof apiFetch !== 'function' || typeof renderEntityPropsGridInto !== 'function') return false;
  try {
    await pane._meldexEntityDetailController?.dispose?.();
    pane.innerHTML = '<div class="gb-preview-entity-loading" style="padding:12px;color:var(--fg2)">トピックを読み込み中...</div>';
    const data = await apiFetch('/entity?path=' + encodeURIComponent(entityPath));
    if (!data) return false;
    if (window.MeldexEntityDetail?.mount) {
      const controller = window.MeldexEntityDetail.mount({
        root: pane,
        path: entityPath,
        surface: 'right-sidebar',
        data,
      });
      return await controller.ready;
    }
    pane.replaceChildren();
    pane.dataset.path = entityPath;
    // ビューワー区画は「ファイルを選択すると…」の案内を中央に置くため中央寄せになっている。
    // 実際の内容を出すときに中央寄せのままだと、幅が足りない分だけ左右へはみ出すので上詰めに戻す。
    pane.style.alignItems = 'stretch';
    pane.style.justifyContent = 'flex-start';
    const root = document.createElement('div');
    root.className = 'gb-preview-entity';
    root.style.cssText = 'padding:10px 12px;width:100%;min-width:0;';

    const parentDb = String(entityPath).replace(/\\/g, '/').replace(/\/[^/]+$/, '');
    if (parentDb) {
      const parent = document.createElement('button');
      parent.type = 'button';
      parent.className = 'gb-subpanel-link-button';
      parent.style.cssText = 'margin-bottom:8px;';
      parent.textContent = '← ' + (parentDb.split('/').pop() || parentDb);
      parent.title = parentDb;
      parent.addEventListener('click', () => { if (typeof selectDatabase === 'function') selectDatabase(parentDb); });
      root.appendChild(parent);
    }

    const title = document.createElement('h2');
    title.className = 'gb-preview-entity-title';
    title.style.cssText = 'font-size:15px;margin:0 0 8px;';
    title.textContent = (data && data.entity) || label || (String(entityPath).split(/[/\\]/).pop() || '').replace(/\.md$/i, '');
    root.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'gb-preview-entity-props';
    root.appendChild(grid);
    renderEntityPropsGridInto(grid, data, entityPath, { parentDb });

    const raw = String((data && data.page_content) || '');
    const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, '');
    if (body.trim()) {
      const note = document.createElement('div');
      note.className = 'gb-preview-entity-note';
      note.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid var(--border);';
      if (typeof mdToHtml === 'function') {
        const html = mdToHtml(body, { basePath: entityPath });
        note.innerHTML = typeof applyAutoLinks === 'function' ? applyAutoLinks(html, entityPath) : html;
      } else {
        note.textContent = body;
      }
      root.appendChild(note);
    }

    pane.appendChild(root);
    if (typeof replaceIcons === 'function') replaceIcons();
    return true;
  } catch (e) {
    return false;
  }
}

function _bdOpenEntryInRightSidebar(label, path, type) {
  openLinkedPathInRightSidebar(path, label, { linkType: type });
}

function _bdStandaloneViewerUrl(entry) {
  const path = entry?.path || '';
  const mediaType = entry?.mediaType || _bdLinkMediaType(_bdLinkExt(path));
  if (entry?.type === 'media' || mediaType) {
    if (mediaType === 'pdf' || _bdLinkExt(path) === 'pdf') return 'viewer.html?pdf=' + encodeURIComponent(path);
    if (mediaType === 'image') return 'viewer.html?file=' + encodeURIComponent(path);
  }
  if (entry?.type === 'html' && entry?.urlExternal) return path;
  return '';
}

function _bdStandaloneUrlForEntry(entry) {
  if (!entry?.path) return '';
  const viewerUrl = _bdStandaloneViewerUrl(entry);
  if (viewerUrl) return viewerUrl;
  if (entry.type === 'page') return 'note-standalone.html?open=' + encodeURIComponent(entry.path);
  if (entry.type === 'scriptnote') {
    const query = new URLSearchParams({
      single: '1',
      open: 'scriptnote',
      path: entry.path,
      label: entry.label || String(entry.path).split(/[/\\]/).pop() || '',
    });
    return 'Meldex.html?' + query.toString();
  }
  if (['pivot', 'tree', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form'].includes(entry.type)) {
    return 'sheet-standalone.html?open=' + encodeURIComponent(entry.path);
  }
  if (entry.type === 'board') return 'board-standalone.html?open=' + encodeURIComponent(entry.path);
  return '';
}

function _bdOpenStandaloneUrl(url) {
  if (!url) return false;
  if (typeof _open_app_window_js === 'function') {
    _open_app_window_js(url);
    return true;
  }
  window.open(url, '_blank', 'width=1100,height=780,menubar=no,toolbar=no,location=no');
  return true;
}

async function openLinkedPathStandalone(path, label, options) {
  const opts = options || {};
  const entry = opts.entry || await _bdResolveLinkedEntryAsync(path, label, opts.linkType);
  const url = _bdStandaloneUrlForEntry(entry);
  if (!url) {
    if (typeof showStatus === 'function') showStatus('この種類は単独アプリで開けません', true);
    return false;
  }
  return _bdOpenStandaloneUrl(url);
}

function canOpenLinkedPathStandalone(path, linkType) {
  const entry = _bdResolveLinkedEntry(path, path, _bdInferLinkType(path, linkType));
  return !!_bdStandaloneUrlForEntry(entry);
}

function showLinkedOpenTargetMenu(e, path, label, options) {
  const opts = options || {};
  const targetPath = String(path || '').trim();
  if (!targetPath) return false;
  e?.preventDefault?.();
  e?.stopPropagation?.();
  document.querySelectorAll('.gb-context-menu').forEach(menu => menu.remove());
  // サブパネル内では、右サイドバーで開く（別サブパネルを開くUI）を
  // 表示しない（計画書「右サイドバー操作の制限」節）。
  const anchorEl = e?.currentTarget || e?.target || null;
  const canUseRightSidebar = typeof GBPaneBridge === 'undefined' || typeof GBPaneBridge.canUseRightSidebarTools !== 'function'
    || typeof GBPaneBridge.surfaceOf !== 'function'
    || GBPaneBridge.canUseRightSidebarTools(GBPaneBridge.surfaceOf(anchorEl));
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu gb-linked-open-target-menu';
  menu.style.zIndex = '10080';
  const closeMenu = () => menu.remove();
  const addItem = (labelText, icon, action, disabled) => {
    const item = document.createElement('div');
    item.className = 'gb-context-menu-item' + (disabled ? ' disabled' : '');
    if (disabled) {
      item.style.opacity = '0.5';
      item.style.cursor = 'default';
      item.setAttribute('aria-disabled', 'true');
    }
    item.innerHTML = (typeof lucide === 'function' ? lucide(icon, 14) : '') + ' ' + labelText;
    if (!disabled) {
      item.addEventListener('click', () => {
        closeMenu();
        action();
      });
    }
    menu.appendChild(item);
  };
  if (_bdIsStandaloneBoardSurface()) {
    addItem('ビューワーで開く', 'layers-2', () => openLinkedPathInMainPane(targetPath, label, opts));
  } else if (_bdIsCloudMobileBoardSurface()) {
    if (canUseRightSidebar && !_bdIsExternalBrowserUrl(targetPath)) addItem('サイドドロワーで開く', 'layers-2', () => openLinkedPathInRightSidebar(targetPath, label, { ...opts, sourceEl: anchorEl }));
    addItem('メインパネルで開く', 'panelTop', () => openLinkedPathInMainPane(targetPath, label, opts));
  } else {
    addItem('メインパネルで開く', 'panelTop', () => openLinkedPathInMainPane(targetPath, label, opts));
    if (canUseRightSidebar && !_bdIsExternalBrowserUrl(targetPath)) {
      addItem('右サイドバーで開く', 'panelRight', () => openLinkedPathInRightSidebar(targetPath, label, { ...opts, sourceEl: anchorEl }));
    }
  }
  if (_bdIsExternalBrowserUrl(targetPath)) {
    addItem('既定のブラウザで開く', 'externalLink', () => _bdOpenExternalBrowserUrl(targetPath));
  }
  if (!_bdIsStandaloneBoardSurface()) {
    addItem('単独アプリで開く', 'externalLink', () => openLinkedPathStandalone(targetPath, label, opts), !canOpenLinkedPathStandalone(targetPath, opts.linkType));
  }
  // board-standalone.html にはフォルダツリーが無いため typeof ガードで非表示にする。
  if (typeof window.revealPathInFolderTree === 'function' && !_bdIsExternalBrowserUrl(targetPath)) {
    addItem('フォルダツリーに表示', 'folderTree', () => window.revealPathInFolderTree(targetPath));
  }
  addItem('パスをコピー', 'clipboard', () => copyBoardLinkedPath(targetPath));
  document.body.appendChild(menu);
  if (e?.currentTarget && typeof positionPopup === 'function') {
    positionPopup(menu, e.currentTarget.getBoundingClientRect());
  } else {
    const z = typeof _getZoom === 'function' ? _getZoom() : 1;
    menu.style.left = ((e?.clientX || 0) / z) + 'px';
    menu.style.top = ((e?.clientY || 0) / z) + 'px';
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  }
  setTimeout(() => {
    const closer = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('pointerdown', closer, true);
      }
    };
    document.addEventListener('pointerdown', closer, true);
  }, 0);
  return true;
}

async function bdCreateLinkedFileCardAt(x, y, type) {
  const boardPath = _bdEnsureBoardPathForLinkCreation();
  if (!boardPath) {
    showStatus('先にボードを保存してください', true);
    return null;
  }
  if (typeof bdAddLinkCardAt !== 'function') {
    showStatus('リンクトピック追加機能を読み込めませんでした', true);
    return null;
  }
  try {
    const res = await apiPost('/outliner/add', { type, label: '無題', parent: _bdBoardDir(boardPath) });
    const nodeData = res?.node || {};
    const label = nodeData.name || nodeData.label || '無題';
    const path = nodeData.path || '';
    if (!path) throw new Error('path missing');
    const linkType = nodeData.type || type;
    const node = bdAddLinkCardAt(x, y, path, label, { w: 200, linkType });
    return node;
  } catch (error) {
    const detail = error?.message ? ': ' + error.message : '';
    showStatus('リンクトピック作成に失敗しました' + detail, true);
    return null;
  }
}

function _bdFileIcon(ext, path, linkType) {
  const name = String(path || '').split(/[/\\]/).pop().toLowerCase();
  const byType = (t, fallback) =>
    typeof uiTypeIconName === 'function' ? (uiTypeIconName(t) || fallback) : fallback;
  const explicitType = _bdResolveOpenType(_bdInferLinkType(path, linkType));
  if (_bdIsExternalUrl(path)) return 'globe';
  if (explicitType === 'scriptnote') return byType('scriptnote', 'bookOpenText');
  if (explicitType === 'board') return byType('board', 'presentation');
  if (explicitType === 'timer' || explicitType === 'unsupported') return 'fileQuestion';
  if (['pivot', 'tree', 'gallery', 'kanban', 'timeline', 'chart', 'graph'].includes(explicitType)) return byType('database', 'db');
  if (explicitType === 'csv') return 'table';
  if (explicitType === 'html') return 'globe';
  if (explicitType === 'folder') return byType('folder', 'folder');
  if (explicitType === 'calendar') return byType('calendar', 'calendar');
  // 複合拡張子（アプリ種別）を優先判定
  if (name.endsWith('.mel-scenario') || name.endsWith('.scriptnote.json')) return byType('scriptnote', 'bookOpenText');
  if (name.endsWith('.mel-board') || name.endsWith('.board.json') || name.endsWith('.canvas.json')) return byType('board', 'presentation');
  if (name.endsWith('.mel-sheet')) return byType('database', 'db');
  if (name.endsWith('.mel-timer') || name.endsWith('.timer.json')) return 'fileQuestion';
  const nextExt = String(ext || '').toLowerCase();
  if (['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'apng', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(nextExt)) return 'image';
  if (['mp4', 'mov', 'avi', 'webm', 'mkv', 'ogv'].includes(nextExt)) return 'clapperboard';
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(nextExt)) return 'audioLines';
  if (nextExt === 'md') return byType('page', 'fileText');
  if (nextExt === 'csv') return 'table';
  if (nextExt === 'board') return byType('board', 'presentation');
  if (nextExt === 'mel-board') return byType('board', 'presentation');
  if (nextExt === 'mel-sheet') return byType('database', 'db');
  if (nextExt === 'mel-scenario') return byType('scriptnote', 'bookOpenText');
  if (nextExt === 'mel-timer') return 'fileQuestion';
  if (nextExt === 'json') return 'fileText';
  if (nextExt === 'pdf') return 'fileText';
  return 'file';
}

function _bdLinkExt(path) {
  const fileName = String(path || '').split(/[/\\]/).pop() || '';
  return fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
}

function _bdLinkMediaType(ext) {
  if (['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'apng', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'avi', 'webm', 'mkv', 'ogv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  return '';
}

function _bdSandboxedExternalIframe(src, style) {
  return `<iframe src="${_bdEscAttr(src)}" sandbox="allow-scripts allow-forms allow-popups allow-downloads" referrerpolicy="no-referrer" style="${_bdEscAttr(style)}"></iframe>`;
}

function _bdStripFrontmatter(text) {
  if (!text.startsWith('---')) return text;
  const end = text.indexOf('\n---', 3);
  return end >= 0 ? text.substring(end + 4).trim() : text;
}

function _bdStripMarkdown(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/[*_~`]+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function _bdBoardTextPreview(text) {
  const lines = String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line);
  const titles = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^#\s+/.test(lines[i])) titles.push(lines[i].replace(/^#\s+/, ''));
    if (titles.length >= 4) break;
  }
  return titles.join('\n');
}

function _bdScriptNoteJsonPreview(json) {
  if (!Array.isArray(json?.rows)) return '';
  return (json.rows || [])
    .slice(0, 8)
    .map(row => {
      const role = String(row?.role || row?.character || row?.pageSetting || '').trim();
      const body = String(row?.text || row?.body || '').split('\n')[0].trim();
      if (!body) return '';
      return role ? `${role}: ${body}` : body;
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function bdBuildPreviewSummary(path, rawText, linkType) {
  const nextPath = String(path || '');
  const ext = nextPath.split('.').pop().toLowerCase();
  const openType = _bdResolveOpenType(_bdInferLinkType(nextPath, linkType));
  let text = String(rawText || '');
  if (ext === 'json') {
    try {
      const json = JSON.parse(text);
      const scriptPreview = openType === 'scriptnote' || json.fileType === 'meldex-scriptnote'
        ? _bdScriptNoteJsonPreview(json)
        : '';
      if (scriptPreview) return scriptPreview;
      if (Array.isArray(json.rows)) {
        return _bdScriptNoteJsonPreview(json);
      }
      if (Array.isArray(json.nodes)) {
        return (json.nodes || [])
          .slice(0, 6)
          .map(node => node.name || node.text || '')
          .filter(Boolean)
          .join('\n');
      }
      return Object.keys(json).slice(0, 10).join(', ');
    } catch {
      return _bdStripMarkdown(text).slice(0, 240);
    }
  }
  if (openType !== 'scriptnote' && (openType === 'board' || ext === 'board' || /^---[\s\S]*?\ntype:\s*board\b/m.test(text))) {
    return _bdBoardTextPreview(text).slice(0, 240);
  }
  text = _bdStripMarkdown(_bdStripFrontmatter(text));
  return text.slice(0, 240);
}

function bdActivatePreviewPane(options = {}) {
  const preserveActivePane = options.preserveActivePane === true;
  try {
    if (typeof GBTabs !== 'undefined' && typeof GBTabs.findPaneWithTab === 'function') {
      const existing = GBTabs.findPaneWithTab('preview', '');
      if (existing) {
        if (typeof GBTabs.activateTab === 'function') GBTabs.activateTab(existing.paneId, existing.tabId, { preserveActivePane });
        if (!preserveActivePane && typeof GBLayout !== 'undefined' && typeof GBLayout.setActivePane === 'function') {
          GBLayout.setActivePane(existing.paneId);
        }
        return true;
      }
    }
    if (preserveActivePane) return false;
    if (typeof toggleRightPanelTab === 'function') toggleRightPanelTab('preview');
  } catch {}
  return true;
}

let _bdPreviewRequestSeq = 0;

function _bdPreviewCacheSet(key, summary) {
  _bdPreviewSummaryCache.set(key, summary);
  if (_bdPreviewSummaryCache.size > 80) {
    const firstKey = _bdPreviewSummaryCache.keys().next().value;
    if (firstKey) _bdPreviewSummaryCache.delete(firstKey);
  }
}

function _bdLinkedPreviewCardHtml(filePath, fileName, ext, linkType, summary, loading) {
  const body = loading
    ? '<span class="gb-spinner"></span><span>読み込み中...</span>'
    : esc(summary || '(空)');
  return `
      <div class="bd-preview-card">
        <div class="bd-preview-title">${_bdIcon(_bdFileIcon(ext, filePath, linkType), 14)} <span>${esc(fileName)}</span></div>
        <div class="bd-preview-path">${esc(filePath)}</div>
        <div class="bd-preview-body">${body}</div>
      </div>`;
}

function bdCancelLinkedSelectionPreview() {
  _bdPreviewRequestSeq += 1;
  const pane = document.getElementById('gb-preview-pane');
  if (pane?.dataset?.previewMode === 'board-link') {
    pane.dataset.previewRequestToken = String(_bdPreviewRequestSeq);
  }
}

async function bdRenderLinkedPreview(filePath, pane, linkType) {
  if (!filePath || !pane) return false;
  const fileName = filePath.split(/[/\\]/).pop();
  const ext = _bdLinkExt(filePath);
  const explicitMediaType = ['image', 'video', 'audio'].includes(String(linkType || '').trim())
    ? String(linkType || '').trim()
    : '';
  const mediaType = explicitMediaType || _bdLinkMediaType(ext);
  const pdf = ext === 'pdf';
  const html = ext === 'html' || ext === 'htm';
  const externalUrl = _bdIsExternalUrl(filePath);
  const requestToken = String(++_bdPreviewRequestSeq);
  pane.dataset.previewPath = filePath;
  pane.dataset.previewMode = 'board-link';
  pane.dataset.previewRequestToken = requestToken;
  const isCurrentRequest = () => pane.isConnected
    && pane.dataset.previewPath === filePath
    && pane.dataset.previewRequestToken === requestToken;
  if (mediaType === 'image' || pdf) {
    if (mediaType === 'image' && /^data:image\//i.test(filePath)) {
      pane.innerHTML = `<img src="${_bdEscAttr(filePath)}" alt="${_bdEscAttr(fileName)}" data-meldex-content-image style="width:100%;height:100%;border-radius:6px;background:var(--bg);object-fit:contain;">`;
      window.MeldexImageLoading?.trackAll?.(pane, { host: pane });
      return true;
    }
    const src = pdf
      ? '/viewer?pdf=' + encodeURIComponent(filePath) + '&embed=1'
      : '/viewer?file=' + encodeURIComponent(filePath) + '&embed=1';
    pane.innerHTML = `<iframe src="${_bdEscAttr(src)}" style="width:100%;height:100%;border:none;border-radius:6px;background:var(--bg);"></iframe>`;
    return true;
  }
  if (mediaType === 'video') {
    pane.innerHTML = `<video src="${_bdEscAttr(API_BASE + '/file-raw?path=' + encodeURIComponent(filePath))}" controls autoplay playsinline style="width:100%;height:100%;max-height:100%;border-radius:6px;background:#000;object-fit:contain;"></video>`;
    window.MeldexMediaPlayback?.start(pane.querySelector('video'));
    return true;
  }
  if (mediaType === 'audio') {
    pane.innerHTML = `<div class="bd-preview-card"><div class="bd-preview-title">${_bdIcon('audioLines', 14)} <span>${esc(fileName)}</span></div><div class="bd-preview-path">${esc(filePath)}</div><audio src="${_bdEscAttr(API_BASE + '/file-raw?path=' + encodeURIComponent(filePath))}" controls style="width:100%;margin-top:8px;"></audio></div>`;
    return true;
  }
  if (_bdIsExternalActionUrl(filePath)) {
    pane.innerHTML = _bdLinkedPreviewCardHtml(filePath, fileName, ext, linkType, filePath, false);
    return true;
  }
  if (externalUrl || html) {
    const src = externalUrl ? filePath : API_BASE + '/file-raw?path=' + encodeURIComponent(filePath);
    pane.innerHTML = _bdSandboxedExternalIframe(src, 'width:100%;height:100%;border:none;border-radius:6px;background:#fff;');
    return true;
  }
  const cacheKey = filePath + '\n' + String(linkType || '');
  const cachedSummary = _bdPreviewSummaryCache.get(cacheKey);
  pane.innerHTML = _bdLinkedPreviewCardHtml(filePath, fileName, ext, linkType, cachedSummary || '', !cachedSummary);
  try {
    const resp = await fetch(API_BASE + '/file?path=' + encodeURIComponent(filePath));
    if (!resp.ok) throw new Error('preview');
    const data = await resp.json();
    const summary = bdBuildPreviewSummary(filePath, data.content || '', linkType);
    _bdPreviewCacheSet(cacheKey, summary);
    if (!isCurrentRequest()) return false;
    pane.innerHTML = _bdLinkedPreviewCardHtml(filePath, fileName, ext, linkType, summary, false);
    return true;
  } catch {
    if (!isCurrentRequest()) return false;
    pane.innerHTML = `<div class="bd-preview-card"><div class="bd-preview-title">${_bdIcon(_bdFileIcon(ext, filePath, linkType), 14)} <span>${esc(fileName)}</span></div><div class="bd-preview-path">${esc(filePath)}</div></div>`;
    return true;
  }
}

async function bdShowLinkedSelectionPreview(path, linkType) {
  if (!path) return;
  bdActivatePreviewPane({ preserveActivePane: true });
  const pane = document.getElementById('gb-preview-pane');
  if (!pane || !pane.closest('.gb-pane-content')) return;
  await bdRenderLinkedPreview(String(path), pane, linkType);
}
