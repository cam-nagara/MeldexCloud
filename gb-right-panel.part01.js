/**
 * Meldex Right Panel
 * チャット（LLM/チーム）、注釈、付箋、ヒストリー、カレンダータブ
 */

/* ==============================
   右パネル制御（3カラム）
   ============================== */
function toggleRightPanel() {
  const panel = document.getElementById('right-panel');
  const handle = document.getElementById('right-resize-handle');
  const isOpen = panel.classList.contains('open');
  if (isOpen) {
    saveSplitContent();
    panel.classList.remove('open');
    handle.classList.remove('visible');
    _updateRabActiveState(null);
  } else {
    panel.classList.add('open');
    handle.classList.add('visible');
    const savedW = localStorage.getItem('right-panel-width');
    if (savedW) panel.style.width = savedW + 'px';
  }
}

function _normalizeRightPanelTabName(tabName) {
  return tabName === 'sticky' ? 'annotation' : tabName;
}

let _lastRpAnnotationCurrentTarget = '';
const _RP_ANNOTATION_LIST_QUERY = 'limit=0';

function _isRpAnnotationConcreteTarget(value) {
  const target = String(value || '').trim();
  if (!target) return false;
  return !['unknown', 'undefined', 'null', 'viewer'].includes(target.toLowerCase());
}

function _rememberRpAnnotationCurrentTarget(target) {
  const nextTarget = String(target || '').trim();
  if (!_isRpAnnotationConcreteTarget(nextTarget)) return '';
  _lastRpAnnotationCurrentTarget = nextTarget;
  const panel = document.getElementById('rp-annotation');
  const search = document.getElementById('rp-ann-search');
  if (panel) panel.dataset.currentTarget = nextTarget;
  if (search) search.dataset.currentTarget = nextTarget;
  return nextTarget;
}

function _resolveRpAnnotationCurrentTarget() {
  const panel = document.getElementById('rp-annotation');
  const search = document.getElementById('rp-ann-search');
  const targetFilter = _readRpAnnotationTargetFilter(search);
  const candidates = [
    targetFilter?.targetPath,
    (typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.getCurrentAnnotationTarget === 'function')
      ? GBPaneBridge.getCurrentAnnotationTarget()
      : '',
    (typeof getAnnotationTarget === 'function') ? getAnnotationTarget() : '',
    search?.dataset?.currentTarget,
    panel?.dataset?.currentTarget,
    _lastRpAnnotationCurrentTarget,
  ];
  for (const candidate of candidates) {
    if (_isRpAnnotationConcreteTarget(candidate)) return _rememberRpAnnotationCurrentTarget(candidate);
  }
  return '';
}

// フロートパネル／サブパネル内では、右サイドバー補助操作（オプション/ビューワー/
// バージョン管理/チャット/タイマー/ヒストリー/注釈/タグ/サブパネル）を使用できない。
// source は明示的な呼び出し元（DOM要素／paneId）。省略時はフォーカス位置で判定する。
function _rightSidebarToolAllowed(tabName, source) {
  if (typeof GBPaneBridge === 'undefined' || typeof GBPaneBridge.guardRightSidebarTool !== 'function') return true;
  return GBPaneBridge.guardRightSidebarTool(tabName, source);
}

function openRightPanelTab(tabName, source) {
  tabName = _normalizeRightPanelTabName(tabName);
  if (!_rightSidebarToolAllowed(tabName, source)) return;
  const panel = document.getElementById('right-panel');
  const handle = document.getElementById('right-resize-handle');
  // パネルを開く
  if (!panel.classList.contains('open')) {
    panel.classList.add('open');
    handle.classList.add('visible');
    const savedW = localStorage.getItem('right-panel-width');
    if (savedW) panel.style.width = savedW + 'px';
  }
  // source は既にこの呼び出しで判定済みなので、内部呼び出しにもそのまま引き継ぐ
  // （引き継がないと switchRightTab 側がフォーカス位置で独自に再判定してしまう）。
  switchRightTab(tabName, source);
  _updateRabActiveState(tabName);
}

// 右アクティブバーからのトグル: 同じタブなら閉じる、違うタブなら開く
function toggleRightPanelTab(tabName, source) {
  tabName = _normalizeRightPanelTabName(tabName);
  if (!_rightSidebarToolAllowed(tabName, source)) return;
  const panel = document.getElementById('right-panel');
  const handle = document.getElementById('right-resize-handle');
  const isOpen = panel.classList.contains('open');
  // 現在アクティブなタブを取得
  const activeTab = document.querySelector('.rp-tab.active')?.dataset.rpTab;
  if (isOpen && activeTab === tabName) {
    // 同じタブが開いている → 閉じる
    panel.classList.remove('open');
    handle.classList.remove('visible');
    _updateRabActiveState(null);
  } else {
    // 開く or 別タブに切替
    if (!isOpen) {
      panel.classList.add('open');
      handle.classList.add('visible');
      const savedW = localStorage.getItem('right-panel-width');
      if (savedW) panel.style.width = savedW + 'px';
    }
    // source は既にこの呼び出しで判定済みなので、内部呼び出しにもそのまま引き継ぐ。
    switchRightTab(tabName, source);
    _updateRabActiveState(tabName);
  }
}

// 右アクティブバーのボタンのactive状態を更新
function _updateRabActiveState(activeTab) {
  document.querySelectorAll('#activity-bar-right button').forEach(btn => {
    btn.classList.remove('active');
    btn.setAttribute('aria-pressed', 'false');
  });
  const target = activeTab ? document.getElementById('rab-' + activeTab) : null;
  if (target) {
    target.classList.add('active');
    target.setAttribute('aria-pressed', 'true');
  }
}

function switchRightTab(tabName, source) {
  if (tabName === 'sticky') tabName = 'annotation';
  if (!_rightSidebarToolAllowed(tabName, source)) return;
  // タブ切り替え
  document.querySelectorAll('.rp-tab').forEach(t => {
    const active = t.dataset.rpTab === tabName;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.rp-content').forEach(c => {
    c.classList.toggle('active', c.id === 'rp-' + tabName);
  });
  // タブ固有の初期化
  if (tabName === 'chat') {
    // チャットモジュール未ロード時は静かに離脱（ReferenceError 防止）
    if (typeof _chatState === 'undefined' || typeof updateChatModels !== 'function' || typeof switchChatMode !== 'function') {
      return;
    }
    const savedProvider = localStorage.getItem('chat-provider');
    const savedModel = localStorage.getItem('chat-model');
    if (savedProvider) { _chatState.provider = savedProvider; if (typeof _safeSetValue === 'function') _safeSetValue('chat-provider', savedProvider); }
    updateChatModels();
    if (savedModel) {
      const modelSel = document.getElementById('chat-model');
      // モデルがリストに存在する場合のみ復元
      if (modelSel && [...modelSel.options].some(o => o.value === savedModel)) {
        _chatState.model = savedModel; modelSel.value = savedModel;
      }
    }
    const restoring = typeof GBChatRestore !== 'undefined' && typeof GBChatRestore.restoreOnOpen === 'function'
      ? GBChatRestore.restoreOnOpen()
      : false;
    if (!restoring && !(typeof GBChatRestore !== 'undefined' && typeof GBChatRestore.isRestoreSuspended === 'function' && GBChatRestore.isRestoreSuspended())) {
      switchChatMode(localStorage.getItem('chat-mode') || _chatMode || 'team');
    }
    apiFetch('/chat/config').then(async cfg => {
      const p = _chatState.provider;
      const info = cfg.providers?.[p];
      const localConfigured = await window.MeldexLlmKeys?.hasProvider?.(p).catch(() => false);
      if (info && !info.configured && !localConfigured && typeof chatAddSystem === 'function') {
        chatAddSystem('APIキーが未設定です。設定ダイアログからAPIキーを入力してください。');
      }
      if (typeof _chatRefreshApiKeyState === 'function') _chatRefreshApiKeyState().catch(() => {});
    }).catch(() => {});
  } else if (tabName === 'calendar') {
    // Phase C: CalendarComponentを直接マウント
    const rpCal = document.getElementById('rp-calendar');
    if (rpCal && !rpCal._calComponent) {
      const CalendarCtor = window.CalendarComponent || (typeof CalendarComponent !== 'undefined' ? CalendarComponent : null);
      if (!CalendarCtor) return;
      const comp = new CalendarCtor('rp-calendar', 'rp-cal-tab');
      comp.create();
      comp.mount(rpCal);
      comp.activate();
      rpCal._calComponent = comp;
    } else if (rpCal?._calComponent) {
      rpCal._calComponent.activate();
    }
  } else if (tabName === 'annotation') {
    loadRpAnnotationList();
  } else if (tabName === 'tags') {
    const tagsPanel = document.getElementById('rp-tags');
    if (tagsPanel && typeof renderTagManagementTab === 'function') renderTagManagementTab(tagsPanel);
  } else if (tabName === 'history') {
    renderHistoryList();
  } else if (tabName === 'detail') {
    const rpDetail = document.getElementById('rp-detail');
    if (rpDetail && typeof _ensureDetailTabShell === 'function') _ensureDetailTabShell(rpDetail);
  }
}

// 右パネル: 注釈一覧（コメントはスレッド形式、他タイプは従来の簡易リスト）
// Phase 2e-i: コメントを target_kind + target_ref でグルーピングし、解決/削除を操作可能に
async function loadRpAnnotationList() {
  const list = document.getElementById('rp-ann-list');
  if (!list) return;
  list.innerHTML = '<div style="padding:12px;text-align:center;color:var(--fg2);font-size:12px;">読み込み中...</div>';
  const viewMode = document.getElementById('rp-ann-view')?.value || localStorage.getItem('rp-ann-view-mode') || 'preview';
  const sortMode = document.getElementById('rp-ann-sort')?.value || localStorage.getItem('rp-ann-sort-mode') || 'modified-desc';
  const typeFilter = document.getElementById('rp-ann-type')?.value || '';
  const scopeFilter = document.getElementById('rp-ann-scope')?.value || 'current';
  const statusFilter = document.getElementById('rp-ann-status')?.value || 'open';
  const userFilter = document.getElementById('rp-ann-user')?.value || '';
  const searchEl = document.getElementById('rp-ann-search');
  const searchQuery = searchEl?.value?.toLowerCase() || '';
  let targetFilter = _readRpAnnotationTargetFilter(searchEl);
  const currentTarget = scopeFilter === 'current' ? _resolveRpAnnotationCurrentTarget() : '';
  const currentTargetCandidates = scopeFilter === 'current' ? _rpAnnotationCurrentTargetCandidates(currentTarget) : [];
  if (scopeFilter === 'current' && !currentTarget) {
    _renderRpAnnotationEmptyState(list, {
      unresolved: true,
      scope: scopeFilter,
      status: statusFilter,
      type: typeFilter,
    });
    return;
  }
  if (scopeFilter === 'current' && currentTarget && !targetFilter?.targetPath) {
    targetFilter = { targetPath: currentTarget, targetPathCandidates: currentTargetCandidates };
  }
  try {
    let items = [];
    if (scopeFilter === 'current' && currentTargetCandidates.length) {
      const byId = new Map();
      for (const candidate of currentTargetCandidates) {
        const rows = await apiFetch('/annotations?' + _RP_ANNOTATION_LIST_QUERY + '&target=' + encodeURIComponent(candidate));
        (rows || []).forEach(row => {
          if (row?.id && !byId.has(row.id)) byId.set(row.id, row);
        });
      }
      items = [...byId.values()];
    } else {
      items = await apiFetch('/annotations?' + _RP_ANNOTATION_LIST_QUERY);
    }
    const norm = (items || []).map(_normalizeAnnotationRow);
    _populateRpAnnotationUsers(norm, userFilter);
    // 状態フィルタ
    let filtered = norm.filter(a => {
      if (statusFilter === 'open') return !a.deleted && !a.orphan && !a.resolved;
      if (statusFilter === 'resolved') return !a.deleted && !!a.resolved && !a.orphan;
      if (statusFilter === 'orphan') return !a.deleted && !!a.orphan;
      if (statusFilter === 'deleted') return !!a.deleted;
      return true;
    });
    if (typeFilter) {
      filtered = filtered.filter(a => a.uiKind === typeFilter);
    }
    if (userFilter) {
      filtered = filtered.filter(a => String(a.user || '') === userFilter);
    }
    if (targetFilter) {
      filtered = filtered.filter(a => _rpAnnotationMatchesTargetFilter(a, targetFilter));
    }
    // 検索
    if (searchQuery) {
      filtered = filtered.filter(a =>
        (a.body || '').toLowerCase().includes(searchQuery) ||
        (a.data?.text || '').toLowerCase().includes(searchQuery) ||
        _stripRpAnnotationHtml(a.data?.html || '').toLowerCase().includes(searchQuery) ||
        (a.target_path || '').toLowerCase().includes(searchQuery) ||
        (a.target_ref?.file || '').toLowerCase().includes(searchQuery) ||
        (a.target_file_name || '').toLowerCase().includes(searchQuery) ||
        (a.target_snapshot || '').toLowerCase().includes(searchQuery) ||
        (a.user || '').toLowerCase().includes(searchQuery)
      );
    }
    _sortRpAnnotations(filtered, sortMode);
    if (filtered.length === 0) {
      _renderRpAnnotationEmptyState(list, {
        target: currentTarget,
        scope: scopeFilter,
        status: statusFilter,
        type: typeFilter,
        query: searchQuery,
      });
      return;
    }
    list.innerHTML = '';
    if (viewMode === 'list') _renderRpAnnotationListView(list, filtered);
    else _renderRpAnnotationPreviewView(list, filtered);
  } catch (e) {
    list.innerHTML = '<div style="padding:12px;color:var(--red);font-size:12px;">読み込み失敗</div>';
  }
}

function _readRpAnnotationTargetFilter(searchEl) {
  const raw = searchEl?.dataset?.targetFilter || '';
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function _rpNormalizeAnnotationPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function _rpSameAnnotationPath(a, b) {
  const left = _rpNormalizeAnnotationPath(a);
  const right = _rpNormalizeAnnotationPath(b);
  if (!left || !right) return false;
  return left === right;
}

function _rpAnnotationTargetCandidates(target) {
  const raw = _rpNormalizeAnnotationPath(target);
  if (!raw) return [];
  const candidates = [raw];
  const hasExactCandidate = (value) => {
    const normalized = _rpNormalizeAnnotationPath(value);
    return candidates.some(item => _rpNormalizeAnnotationPath(item) === normalized);
  };
  const roots = [];
  try {
    if (typeof _homeFolderPath !== 'undefined' && _homeFolderPath) roots.push(_homeFolderPath);
  } catch {}
  try {
    if (typeof state !== 'undefined' && state?.vaultPath) roots.push(state.vaultPath);
  } catch {}
  for (const rootValue of roots) {
    const root = _rpNormalizeAnnotationPath(rootValue);
    if (!root || raw === root || !raw.startsWith(root + '/')) continue;
    const relative = raw.slice(root.length + 1);
    if (relative && !hasExactCandidate(relative)) {
      candidates.push(relative);
    }
  }
  return candidates;
}

function _rpIsCalendarPanelTarget(target) {
  const value = String(target || '').trim().toLowerCase();
  return value === 'calendar:panel' || value === '_calendar' || value.endsWith('.calendar.json');
}

function _rpCalendarTargetCandidates() {
  const candidates = new Set(['_calendar']);
  document.querySelectorAll('.gb-cal-content .gb-cal-day-event[data-event-id], .gb-cal-content .gb-cal-clock-event-slice[data-event-id]').forEach(el => {
    const cid = String(el?.dataset?.calendarId || '').trim();
    if (cid) candidates.add(cid);
  });
  return [...candidates];
}

function _rpAnnotationCurrentTargetCandidates(currentTarget) {
  if (_rpIsCalendarPanelTarget(currentTarget)) return _rpCalendarTargetCandidates();
  return _rpAnnotationTargetCandidates(currentTarget);
}

function _rpTargetContainerFilter(kind, ref) {
  if (kind === 'note_line' || kind === 'scriptnote_line') return { kind, id: ref?.lineId || '' };
  if (kind === 'board_card') return { kind, id: ref?.cardId || '' };
  if (kind === 'board_line') return { kind, id: ref?.lineId || '' };
  if (kind === 'sheet_cell') return { kind, entryId: ref?.entryId || '', colId: ref?.colId || '' };
  if (kind === 'calendar_event') return { kind, id: ref?.eventId || ref?.id || '' };
  return null;
}

function _rpRefMatches(filterRef, actualRef) {
  if (!filterRef || !actualRef) return false;
  return Object.entries(filterRef).every(([key, value]) => {
    if (key === 'file') return true;
    if (value == null || value === '') return true;
    return String(actualRef[key] || '') === String(value);
  });
}

function _rpAnnotationMatchesTargetFilter(annotation, filter) {
  const ref = annotation.target_ref || {};
  const targetPath = ref.file || annotation.target_path || '';
  const targetCandidates = Array.isArray(filter.targetPathCandidates) && filter.targetPathCandidates.length
    ? filter.targetPathCandidates
    : (filter.targetPath ? [filter.targetPath] : []);
  if (targetCandidates.length && !targetCandidates.some(candidate => _rpSameAnnotationPath(targetPath, candidate))) return false;
  if (!filter.targetKind) return true;
  if (annotation.target_kind === filter.targetKind) {
    return _rpRefMatches(filter.targetRef, ref);
  }
  if (annotation.target_kind === 'text_range' && ref.container) {
    const containerFilter = _rpTargetContainerFilter(filter.targetKind, filter.targetRef || {});
    return _rpRefMatches(containerFilter, ref.container);
  }
  return false;
}

function _renderRpAnnotationEmptyState(list, options = {}) {
  if (!list) return;
  list.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding:12px;color:var(--fg2);font-size:12px;display:flex;flex-direction:column;gap:8px;line-height:1.6;';
  const title = document.createElement('div');
  title.style.cssText = 'color:var(--fg);font-weight:600;';
  title.textContent = options.unresolved ? '現在の対象を特定できません' : '該当する注釈がありません';
  wrap.appendChild(title);

  const detail = document.createElement('div');
  const targetText = options.target ? options.target : '未特定';
  const statusText = ({
    open: '未解決',
    resolved: '解決済み',
    orphan: '孤児',
    deleted: '削除済み',
    all: 'すべて',
  })[options.status || 'open'] || (options.status || '未解決');
  const typeText = options.type || 'すべて';
  detail.textContent = `現在対象: ${targetText} / スコープ: ${options.scope || 'current'} / 状態: ${statusText} / 種類: ${typeText}`;
  wrap.appendChild(detail);
  if (options.query) {
    const query = document.createElement('div');
    query.textContent = `検索語: ${options.query}`;
    wrap.appendChild(query);
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'rp-ann-empty-all-btn';
  btn.textContent = '全ファイル・全状態で表示';
  btn.setAttribute('aria-label', '全ファイル・全状態で表示');
  btn.dataset.e2eId = 'rp-ann-empty-all';
  btn.style.cssText = 'align-self:flex-start;padding:5px 10px;border:1px solid var(--border);border-radius:4px;background:var(--bg3);color:var(--fg);cursor:pointer;';
  btn.addEventListener('click', () => {
    const scope = document.getElementById('rp-ann-scope');
    const status = document.getElementById('rp-ann-status');
    const search = document.getElementById('rp-ann-search');
    if (scope) scope.value = 'all';
    if (status) status.value = 'all';
    if (search) {
      search.value = '';
      delete search.dataset.targetFilter;
      delete search.dataset.currentTarget;
    }
    loadRpAnnotationList();
  });
  wrap.appendChild(btn);
  list.appendChild(wrap);
}

// /annotations 行の正規化: data / target_ref を JSON.parse、フラグを bool 化
function _normalizeAnnotationRow(a) {
  const out = Object.assign({}, a);
  try { out.data = typeof a.data === 'string' ? JSON.parse(a.data) : (a.data || {}); } catch { out.data = {}; }
  try { out.target_ref = a.target_ref ? (typeof a.target_ref === 'string' ? JSON.parse(a.target_ref) : a.target_ref) : null; } catch { out.target_ref = null; }
  out.orphan = !!a.orphan;
  out.resolved = !!a.resolved;
  out.type = a.type || out.data?.type || '';
  out.shape = a.shape || out.data?.shape || '';
  out.body = (a.body != null && a.body !== '') ? a.body : (out.data?.text || '');
  out.deleted = !!out.data?.deleted;
  out.created_at = a.created_at || a.created || '';
  out.modified_at = a.modified_at || a.modified || out.created_at;
  out.uiKind = _rpAnnotationUiKind(out);
  return out;
}

function _rpAnnotationUiKind(a) {
  const type = a?.type || '';
  const data = a?.data || {};
  if (type === 'sticky') return 'sticky';
  const isSticky = ['comment', 'note', 'sticky'].includes(type)
    && ((a.shape || '') === 'sticky' || data.noteType === 'sticky' || data.x != null || data.y != null || data.width != null || data.height != null);
  if (isSticky) return 'sticky';
  if (type === 'comment' || type === 'note') return 'comment';
  if (type === 'marker') return 'marker';
  if (type === 'lasso') return 'lasso';
  if (type === 'rect') return 'rect';
  return 'stroke';
}

function _rpAnnotationTypeLabel(kind) {
  return ({
    stroke: 'ストローク',
    marker: 'マーカー',
    lasso: '投げ縄',
    rect: '矩形塗り',
    comment: 'コメント',
    sticky: '付箋',
  })[kind] || kind || '注釈';
}

function _rpAnnotationIcon(kind, size) {
  const icon = ({ stroke: 'pencil', marker: 'highlighter', lasso: 'lasso', rect: 'square', comment: 'messageSquareText', sticky: 'stickyNote' })[kind] || 'messageSquare';
  return typeof lucide === 'function' ? lucide(icon, size || 14) : '';
}

function _stripRpAnnotationHtml(html) {
  if (!html) return '';
  const el = document.createElement('div');
  el.innerHTML = html;
  return el.textContent || '';
}

function _rpAnnotationPreviewText(a) {
  const text = a.body || a.data?.text || _stripRpAnnotationHtml(a.data?.html || '');
  return text || _rpAnnotationTypeLabel(a.uiKind);
}

function _rpAnnotationTime(a, key) {
  const raw = key === 'created' ? a.created_at : (a.modified_at || a.created_at);
  if (!raw) return '';
  try { return new Date(raw).toLocaleString('ja'); } catch { return String(raw).substring(0, 16).replace('T', ' '); }
}

function _sortRpAnnotations(items, sortMode) {
  const str = v => String(v || '').toLowerCase();
  const time = v => Date.parse(v || '') || 0;
  const comparators = {
    'modified-desc': (a, b) => time(b.modified_at || b.created_at) - time(a.modified_at || a.created_at),
    'created-desc': (a, b) => time(b.created_at) - time(a.created_at),
    'created-asc': (a, b) => time(a.created_at) - time(b.created_at),
    'path-asc': (a, b) => str(a.target_path || a.target_file_name).localeCompare(str(b.target_path || b.target_file_name), 'ja'),
    'type-asc': (a, b) => _rpAnnotationTypeLabel(a.uiKind).localeCompare(_rpAnnotationTypeLabel(b.uiKind), 'ja'),
    'user-asc': (a, b) => str(a.user).localeCompare(str(b.user), 'ja'),
  };
  items.sort(comparators[sortMode] || comparators['modified-desc']);
}

function _populateRpAnnotationUsers(items, selected) {
  const sel = document.getElementById('rp-ann-user');
  if (!sel) return;
  const users = [...new Set((items || []).map(a => a.user).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'ja'));
  sel.innerHTML = '<option value="">全ユーザー</option>';
  users.forEach(user => {
    const opt = document.createElement('option');
    opt.value = user;
    opt.textContent = user;
    sel.appendChild(opt);
  });
  if (selected && users.includes(selected)) sel.value = selected;
}

function _renderRpAnnotationListView(container, items) {
  items.forEach(a => container.appendChild(_buildRpAnnotationListItem(a)));
}

function _renderRpAnnotationPreviewView(container, items) {
  items.forEach(a => container.appendChild(_buildRpAnnotationPreviewCard(a)));
}

function _rpAnnotationMeta(a) {
  const rawPath = a.target_ref?.file || a.target_path || '';
  const path = a.target_file_name || rawPath.split('/').pop() || '(不明)';
  const time = _rpAnnotationTime(a, 'modified') || _rpAnnotationTime(a, 'created');
  const flags = [a.resolved ? '解決済み' : '', a.orphan ? '孤児' : '', a.deleted ? '削除済み' : ''].filter(Boolean);
  return `${path} ・ ${a.user || ''}${time ? ' ・ ' + time : ''}${flags.length ? ' ・ ' + flags.join(' ・ ') : ''}`;
}

function _buildRpAnnotationListItem(a) {
  const row = document.createElement('div');
  row.className = 'rp-ann-row';
  row.addEventListener('click', () => _jumpFromRpAnnotation(a));
  const text = _rpAnnotationPreviewText(a);
  row.innerHTML = `
    <span class="rp-ann-row-icon">${_rpAnnotationIcon(a.uiKind, 14)}</span>
    <span class="rp-ann-row-main">
      <span class="rp-ann-row-title">${esc(text.substring(0, 120))}</span>
      <span class="rp-ann-row-meta">${esc(_rpAnnotationTypeLabel(a.uiKind) + ' ・ ' + _rpAnnotationMeta(a))}</span>
    </span>
    <span class="rp-ann-row-actions"></span>`;
  row.querySelector('.rp-ann-row-icon').style.color = a.color || 'var(--fg2)';
  _appendRpAnnotationActions(row.querySelector('.rp-ann-row-actions'), a);
  return row;
}

function _buildRpAnnotationPreviewCard(a) {
  const card = document.createElement('div');
  card.className = 'rp-ann-preview-card';
  card.addEventListener('click', () => _jumpFromRpAnnotation(a));
  const head = document.createElement('div');
  head.className = 'rp-ann-preview-head';
  head.innerHTML = `<span>${_rpAnnotationIcon(a.uiKind, 14)} ${esc(_rpAnnotationTypeLabel(a.uiKind))}</span><span class="rp-ann-preview-actions"></span>`;
  _appendRpAnnotationActions(head.querySelector('.rp-ann-preview-actions'), a);
  const body = document.createElement('div');
  body.className = 'rp-ann-preview-body';
  body.appendChild(_buildRpAnnotationPreviewBody(a));
  const meta = document.createElement('div');
  meta.className = 'rp-ann-preview-meta';
  meta.textContent = _rpAnnotationMeta(a);
  card.append(head, body, meta);
  return card;
}

function _buildRpAnnotationPreviewBody(a) {
  if (['stroke', 'marker', 'lasso', 'rect'].includes(a.uiKind)) return _buildRpStrokePreview(a);
  if (a.uiKind === 'sticky') return _buildRpStickyPreview(a);
  const el = document.createElement('div');
  el.className = 'rp-ann-comment-preview';
  el.textContent = _rpAnnotationPreviewText(a) || '(空)';
  return el;
}

function _buildRpStickyPreview(a) {
  const note = document.createElement('div');
  note.className = 'rp-ann-sticky-preview';
  note.style.background = a.color || '#c48080';
  const html = a.data?.html || '';
  if (html && typeof _sanitizeAnnotationHtml === 'function') note.innerHTML = _sanitizeAnnotationHtml(html);
  else note.textContent = a.data?.text || a.body || '(空)';
  return note;
}

function _buildRpStrokePreview(a) {
  const points = Array.isArray(a.data?.points) ? a.data.points : [];
  const wrap = document.createElement('div');
  wrap.className = 'rp-ann-stroke-preview';
  if (a.uiKind === 'rect') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 120 58');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '16');
    rect.setAttribute('y', '10');
    rect.setAttribute('width', '88');
    rect.setAttribute('height', '38');
    rect.setAttribute('fill', a.color || '#ffeb3b');
    rect.setAttribute('fill-opacity', '0.22');
    rect.setAttribute('stroke', a.color || '#ffeb3b');
    rect.setAttribute('stroke-width', '2');
    svg.appendChild(rect);
    wrap.appendChild(svg);
    return wrap;
  }
  if (points.length < 2) {
    wrap.textContent = _rpAnnotationTypeLabel(a.uiKind);
    return wrap;
  }
  const xs = points.map(p => Number(p[0]) || 0);
  const ys = points.map(p => Number(p[1]) || 0);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const scaled = points.map(p => [
    8 + (((Number(p[0]) || 0) - minX) / w) * 104,
    8 + (((Number(p[1]) || 0) - minY) / h) * 42,
  ]);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 120 58');
  svg.setAttribute('aria-hidden', 'true');
  if (a.uiKind === 'lasso') {
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', scaled.map(p => p.map(v => v.toFixed(1)).join(',')).join(' '));
    poly.setAttribute('fill', a.color || '#ffeb3b');
    poly.setAttribute('fill-opacity', '0.22');
    poly.setAttribute('stroke', a.color || '#ffeb3b');
    poly.setAttribute('stroke-width', '2');
    svg.appendChild(poly);
  } else {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M ' + scaled.map(p => p.map(v => v.toFixed(1)).join(' ')).join(' L '));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', a.color || '#ffeb3b');
    path.setAttribute('stroke-width', a.uiKind === 'marker' ? '9' : '4');
    path.setAttribute('stroke-opacity', a.uiKind === 'marker' ? '0.5' : String(a.opacity || 1));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
  }
  wrap.appendChild(svg);
  return wrap;
}

function _appendRpAnnotationActions(container, a) {
  if (!container) return;
  if (a.uiKind === 'comment') {
    const editBtn = _rpAnnotationActionButton('pencil', '編集');
    editBtn.dataset.rpAnnAction = 'edit';
    editBtn.dataset.annId = a.id || '';
    editBtn.dataset.testid = `rp-ann-edit-${a.id || 'unknown'}`;
    editBtn.addEventListener('click', (ev) => { ev.stopPropagation(); _editCommentFromPanel(a); });
    container.appendChild(editBtn);
    const resolveBtn = _rpAnnotationActionButton('check', a.resolved ? '未解決に戻す' : '解決にする');
    resolveBtn.dataset.rpAnnAction = 'resolve';
    resolveBtn.dataset.annId = a.id || '';
    resolveBtn.dataset.testid = `rp-ann-resolve-${a.id || 'unknown'}`;
    resolveBtn.addEventListener('click', (ev) => { ev.stopPropagation(); _toggleResolveComment(a); });
    container.appendChild(resolveBtn);
  }
  const delBtn = _rpAnnotationActionButton('trash2', _rpCanDeleteAnnotation(a) ? '削除' : 'ソースフォルダの管理者だけが削除できます');
  delBtn.dataset.rpAnnAction = 'delete';
  delBtn.dataset.annId = a.id || '';
  delBtn.dataset.testid = `rp-ann-delete-${a.id || 'unknown'}`;
  delBtn.disabled = !_rpCanDeleteAnnotation(a);
  delBtn.addEventListener('click', (ev) => { ev.stopPropagation(); _deleteAnnotationFromPanel(a); });
  container.appendChild(delBtn);
}

function _rpAnnotationActionButton(icon, title) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'rp-ann-action-btn';
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.innerHTML = typeof lucide === 'function' ? lucide(icon, 12) : '';
  return btn;
}

(function installRightPanelTabKeyboardActivation() {
  document.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const tab = event.target?.closest?.('.rp-tab[role="tab"][data-action]');
    if (!tab) return;
    event.preventDefault();
    tab.click();
  });
})();

function _rpAnnotationCenter(a) {
  const data = a?.data || {};
  if (a?.uiKind === 'sticky') return { x: (Number(data.x) || 0) + (Number(data.width) || 0) / 2, y: (Number(data.y) || 0) + (Number(data.height) || 0) / 2 };
  if (a?.uiKind === 'rect' && data.width != null && data.height != null) {
    return { x: (Number(data.x) || 0) + (Number(data.width) || 0) / 2, y: (Number(data.y) || 0) + (Number(data.height) || 0) / 2 };
  }
  const points = Array.isArray(data.points) ? data.points : [];
  if (points.length) {
    const xs = points.map(p => Number(p[0]) || 0);
    const ys = points.map(p => Number(p[1]) || 0);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  }
  return null;
}

function _flashRpAnnotationElement(a) {
  const safeId = (window.CSS && CSS.escape) ? CSS.escape(String(a.id || '')) : String(a.id || '').replace(/"/g, '\\"');
  const target = safeId ? document.querySelector(`[data-ann-id="${safeId}"]`) : null;
  if (!target) return;
  const prevOutline = target.style.outline;
  const prevFilter = target.style.filter;
  target.style.outline = target instanceof SVGElement ? prevOutline : '2px solid var(--annotation-accent, var(--accent))';
  target.style.filter = 'drop-shadow(0 0 6px var(--annotation-accent, var(--accent)))';
  setTimeout(() => {
    target.style.outline = prevOutline;
    target.style.filter = prevFilter;
  }, 1600);
}

function _scrollToRpAnnotationGeometry(a) {
  const center = _rpAnnotationCenter(a);
  if (!center) return;
  const sc = (typeof _annScrollContainer !== 'undefined' && _annScrollContainer)
    ? _annScrollContainer
    : document.getElementById('page-content');
  if (sc && typeof sc.scrollTo === 'function') {
    sc.scrollTo({
      left: Math.max(0, center.x - sc.clientWidth / 2),
      top: Math.max(0, center.y - sc.clientHeight / 2),
      behavior: 'smooth',
    });
  }
  _flashRpAnnotationElement(a);
}

function _jumpFromRpAnnotation(a) {
  if (a.uiKind === 'comment') {
    _jumpToCommentTarget(a);
    return;
  }
  const targetPath = a.target_ref?.file || a.target_path || '';
  if (!targetPath) {
    showStatus('注釈の対象ファイルが見つかりません', true);
    return;
  }
  if (typeof jumpToAnnotation === 'function') jumpToAnnotation(targetPath);
  setTimeout(() => _scrollToRpAnnotationGeometry(a), 450);
}

async function _editCommentFromPanel(c) {
  const text = await cfPrompt('コメント本文を編集:', c.body || '');
  if (text == null) return;
  try {
    const body = {
      body: text,
      data: { ...(c.data || {}), type: c.type || c.data?.type || 'comment', text },
    };
    if (typeof _putAnnotationWithHistory === 'function') {
      await _putAnnotationWithHistory(c.id, body, '注釈: コメント更新', c.id);
    } else {
      await apiPut('/annotations/' + encodeURIComponent(c.id), body);
    }
    _invalidateCommentBadgesFor(c);
    loadRpAnnotationList();
  } catch { showStatus('保存に失敗', true); }
}

async function _deleteAnnotationFromPanel(a) {
  if (!_rpCanDeleteAnnotation(a)) {
    showStatus('注釈の削除はソースフォルダの管理者だけが行えます', true);
    return;
  }
  if (typeof cfConfirm === 'function' && !await cfConfirm('この注釈を削除しますか？')) return;
  try {
    const before = typeof _fetchAnnotationHistoryRow === 'function'
      ? await _fetchAnnotationHistoryRow(a.id).catch(() => null)
      : null;
    await apiDelete('/annotations/' + encodeURIComponent(a.id));
    if (typeof _pushAnnotationHistory === 'function') _pushAnnotationHistory('注釈: 削除', before, null, a.id);
    const safeId = (window.CSS && CSS.escape) ? CSS.escape(String(a.id)) : String(a.id).replace(/["\\]/g, '\\$&');
    document.querySelectorAll(`[data-ann-id="${safeId}"]`).forEach(el => el.remove());
    _invalidateCommentBadgesFor(a);
    loadRpAnnotationList();
    showStatus('削除しました');
  } catch { showStatus('削除に失敗', true); }
}

// コメントを target_kind + アンカーキー でグルーピング
function _renderCommentGroups(container, comments) {
  const groups = new Map(); // key → { label, items: [] }
  comments.forEach(c => {
    const { key, label } = _commentGroupKey(c);
    if (!groups.has(key)) groups.set(key, { label, items: [] });
    groups.get(key).items.push(c);
  });
  // 更新日時の新しいグループを上に
  const sorted = Array.from(groups.entries()).sort((a, b) => {
    const ta = Math.max(...a[1].items.map(x => Date.parse(x.updated_at || x.created_at || '') || 0));
    const tb = Math.max(...b[1].items.map(x => Date.parse(x.updated_at || x.created_at || '') || 0));
    return tb - ta;
  });
  sorted.forEach(([key, g]) => {
    const grp = document.createElement('div');
    grp.style.cssText = 'margin-bottom:10px;border:1px solid var(--border);border-radius:4px;overflow:hidden;background:var(--bg2);';
    const header = document.createElement('div');
    header.className = 'rp-ann-group-header';
    header.style.cssText = 'padding:6px 8px;background:var(--bg3);font-size:11px;color:var(--fg2);display:flex;align-items:center;gap:6px;cursor:pointer;';
    header.innerHTML = `<span style="flex:1;color:var(--fg);">${esc(g.label)}</span><span>${g.items.length}件</span>`;
    header.addEventListener('click', () => _jumpToCommentTarget(g.items[0]));
    grp.appendChild(header);
    // 作成日時昇順（スレッド順）
    g.items.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    g.items.forEach(c => grp.appendChild(_buildCommentItem(c)));
    container.appendChild(grp);
  });
}

function _commentGroupKey(c) {
  const kind = c.target_kind || 'none';
  const ref = c.target_ref || {};
  const file = (ref.file || c.target_path || '').split('/').pop() || '(未紐付)';
  const snap = (c.target_snapshot || '').slice(0, 40);
  const orphanPrefix = c.orphan ? '🗑 ' : '';
  if (kind === 'note_line' || kind === 'scriptnote_line') {
    const key = `${kind}:${ref.file || ''}:${ref.lineId || ''}`;
    const label = `${orphanPrefix}${_kindLabel(kind)} · ${file}` + (snap ? ` · "${snap}"` : '');
    return { key, label };
  }
  if (kind === 'board_card') {
    const key = `board_card:${ref.file || ''}:${ref.cardId || ''}`;
    return { key, label: `${orphanPrefix}カード · ${file}` + (snap ? ` · "${snap}"` : '') };
  }
  if (kind === 'board_line') {
    const key = `board_line:${ref.file || ''}:${ref.lineId || ''}`;
    return { key, label: `${orphanPrefix}ライン · ${file}` + (snap ? ` · "${snap}"` : '') };
  }
  if (kind === 'sheet_cell') {
    const key = `sheet_cell:${ref.file || ''}:${ref.entryId || ''}:${ref.colId || ''}`;
    return { key, label: `${orphanPrefix}セル · ${file}` + (snap ? ` · "${snap}"` : '') };
  }
  if (kind === 'calendar_event') {
    // Audit-P1 H-6: カレンダーイベントコメントをグルーピング
    const key = `calendar_event:${ref.file || ''}:${ref.eventId || ''}`;
    return { key, label: `${orphanPrefix}イベント · ${file}` + (snap ? ` · "${snap}"` : '') };
  }
  if (kind === 'text_range') {
    const cont = ref.container || null;
    const cKey = cont ? `${cont.kind}:${cont.id || cont.entryId || ''}:${cont.colId || ''}` : 'doc';
    const key = `text_range:${ref.file || ''}:${cKey}:${ref.startOffset || 0}-${ref.endOffset || 0}`;
    const snip = (ref.snippet || snap || '').slice(0, 40);
    return { key, label: `${orphanPrefix}選択範囲 · ${file}` + (snip ? ` · "${snip}"` : '') };
  }
  // none / legacy
  const key = `none:${c.id}`;
  return { key, label: `${orphanPrefix}未紐付コメント` };
}

function _kindLabel(kind) {
  return ({
    note_line: 'ノート行', scriptnote_line: 'シナリオ行',
    board_card: 'カード', sheet_cell: 'セル', text_range: '選択範囲',
    board_line: 'ライン',
    calendar_event: 'イベント',
  })[kind] || kind;
}

// 1コメントの描画（本文 + 著者/時刻 + 操作ボタン）
function _buildCommentItem(c) {
  const el = document.createElement('div');
  el.style.cssText = 'padding:6px 8px;border-top:1px solid var(--border);font-size:12px;';
  if (c.resolved) el.style.opacity = '0.6';
  const time = c.created_at ? new Date(c.created_at).toLocaleString('ja') : '';
  const bodyHtml = esc(c.body || '(空)').replace(/\n/g, '<br>');
  const canDelete = _rpCanDeleteAnnotation(c);
  el.innerHTML = `
    <div style="color:var(--fg);white-space:pre-wrap;margin-bottom:4px;">${bodyHtml}</div>
    <div style="display:flex;align-items:center;gap:6px;color:var(--fg2);font-size:10px;">
      <span style="flex:1;">${esc(c.user || '')} · ${time}${c.resolved ? ' · 解決済み' : ''}${c.orphan ? ' · 孤児' : ''}${c.deleted ? ' · 削除済み' : ''}</span>
      <button class="rp-ann-edit" data-rp-ann-action="inline-edit" data-e2e-id="rp-ann-inline-edit-${esc(c.id || 'unknown')}" title="編集" aria-label="編集" style="background:transparent;border:none;cursor:pointer;color:var(--fg2);padding:2px;"><span class="ico ico-pencil" style="width:12px;height:12px;"></span></button>
      <button class="rp-ann-resolve" data-rp-ann-action="inline-resolve" data-e2e-id="rp-ann-inline-resolve-${esc(c.id || 'unknown')}" title="${c.resolved ? '未解決に戻す' : '解決にする'}" aria-label="${c.resolved ? '未解決に戻す' : '解決にする'}" style="background:transparent;border:none;cursor:pointer;color:var(--fg2);padding:2px;"><span class="ico ico-check" style="width:12px;height:12px;"></span></button>
      <button class="rp-ann-delete" data-rp-ann-action="inline-delete" data-e2e-id="rp-ann-inline-delete-${esc(c.id || 'unknown')}" title="${canDelete ? '削除' : 'ソースフォルダの管理者だけが削除できます'}" aria-label="${canDelete ? '削除' : 'ソースフォルダの管理者だけが削除できます'}" ${canDelete ? '' : 'disabled'} style="background:transparent;border:none;cursor:${canDelete ? 'pointer' : 'not-allowed'};color:var(--fg2);padding:2px;opacity:${canDelete ? '1' : '0.45'};"><span class="ico ico-trash2" style="width:12px;height:12px;"></span></button>
    </div>`;
  el.querySelector('.rp-ann-edit').addEventListener('click', (ev) => { ev.stopPropagation(); _editCommentInline(el, c); });
  el.querySelector('.rp-ann-resolve').addEventListener('click', (ev) => { ev.stopPropagation(); _toggleResolveComment(c); });
  el.querySelector('.rp-ann-delete').addEventListener('click', (ev) => { ev.stopPropagation(); _deleteComment(c); });
  return el;
}

function _rpCanDeleteAnnotation(c) {
  const file = c?.target_ref?.file || c?.target_path || '';
  const role = typeof getMyRoleForPath === 'function' ? getMyRoleForPath(file) : '';
  return role === 'owner' || role === 'admin';
}

function _editCommentInline(el, c) {
  const curBody = c.body || '';
  const ta = document.createElement('textarea');
  ta.className = 'rp-ann-inline-edit-textarea';
  ta.value = curBody;
  ta.style.cssText = 'width:100%;min-height:60px;padding:4px;font-size:12px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;resize:vertical;font-family:inherit;box-sizing:border-box;';
  const bar = document.createElement('div');
  bar.className = 'rp-ann-inline-edit-actions';
  bar.style.cssText = 'display:flex;gap:4px;margin-top:4px;justify-content:flex-end;';
  bar.innerHTML = `<button class="rp-ann-cancel" data-rp-ann-inline-action="cancel" data-e2e-id="rp-ann-inline-cancel-${esc(c.id || 'unknown')}" aria-label="キャンセル" style="font-size:11px;padding:2px 8px;background:var(--bg3);color:var(--fg2);border:1px solid var(--border);border-radius:3px;cursor:pointer;">キャンセル</button>
    <button class="rp-ann-save" data-rp-ann-inline-action="save" data-e2e-id="rp-ann-inline-save-${esc(c.id || 'unknown')}" aria-label="保存" style="font-size:11px;padding:2px 8px;background:var(--accent);color:var(--ui-fg-strong);border:none;border-radius:3px;cursor:pointer;">保存</button>`;
  el.innerHTML = '';
  el.appendChild(ta);
  el.appendChild(bar);
  ta.focus();
  bar.querySelector('.rp-ann-cancel').addEventListener('click', () => loadRpAnnotationList());
  bar.querySelector('.rp-ann-save').addEventListener('click', async () => {
    try {
      const body = {
        body: ta.value,
        data: { ...(c.data || {}), type: c.type || c.data?.type || 'comment', text: ta.value },
      };
      if (typeof _putAnnotationWithHistory === 'function') {
        await _putAnnotationWithHistory(c.id, body, '注釈: コメント更新', c.id);
      } else {
        await apiPut('/annotations/' + encodeURIComponent(c.id), body);
      }
      _invalidateCommentBadgesFor(c);
      loadRpAnnotationList();
    } catch (e) { showStatus('保存に失敗', true); }
  });
}

// コメント対象ファイルのバッジキャッシュを無効化 + 開いているエディタのバッジを再描画
function _invalidateCommentBadgesFor(c) {
  if (typeof CommentBadges === 'undefined') return;
  const file = c?.target_ref?.file || c?.target_path || '';
  if (!file) return;
  CommentBadges.invalidate(file);
  // ノート
  try {
    const pc = document.getElementById('page-content');
    if (pc && pc.dataset.path === file) CommentBadges.refreshNote(file, pc);
  } catch {}
