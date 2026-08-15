    menu.appendChild(item);
  }
  function addSep() {
    const s = document.createElement('div');
    s.className = 'ab-dropdown-sep';
    menu.appendChild(s);
  }

  // 新規作成 サブメニュー
  const newItem = document.createElement('div');
  newItem.className = 'ab-dropdown-item';
  newItem.innerHTML = lucide('plus', 16) + ' 新規作成' + submenuArrow();
  newItem.style.position = 'relative';
  const subMenu = document.createElement('div');
  subMenu.className = 'ab-dropdown ab-sub-menu';
  subMenu.style.cssText = 'display:none;min-width:160px;';
  [
    ['フォルダ', 'folder', 'folder'],
    ['ノート', 'page', 'page'],
    ['シート', 'db', 'database'],
    ['ボード', 'presentation', 'board'],
    ['スマートシート', 'databaseSearch', 'smart-db'],
  ].forEach(([label, icon, type]) => {
    const si = document.createElement('div');
    si.className = 'ab-dropdown-item';
    si.innerHTML = lucide(icon, 16) + ' ' + label;
    si.addEventListener('click', (ev) => { ev.stopPropagation(); closeMenu(); showAddOutlinerItem(type); });
    subMenu.appendChild(si);
  });
  attachHoverSubmenu(newItem, subMenu);
  newItem.appendChild(subMenu);
  menu.appendChild(newItem);
  addSep();

  addItem('削除済みファイル', 'trash2', () => showTrashModal());
  addSep();
  addItem('設定', 'settings', () => showSettingsModal());

  document.body.appendChild(menu);
  const btn = _resolveAppBarButton(e);
  if (btn && typeof positionPopup === 'function') positionPopup(menu, btn.getBoundingClientRect());
  else if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  const onPointerDown = (ev) => {
    if (_isAppBarDropdownTarget(ev.target, menu, btn)) return;
    closeMenu();
  };
  const onClick = (ev) => {
    if (_isAppBarDropdownTarget(ev.target, menu, btn)) return;
    closeMenu();
  };
  const onFocusIn = (ev) => {
    if (_isAppBarDropdownTarget(ev.target, menu, btn)) return;
    closeMenu();
  };
  const onKeyDown = (ev) => {
    if (ev.key === 'Escape') closeMenu();
  };
  menu._cleanupActivityMenu = () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('keydown', onKeyDown, true);
    menu._cleanupActivityMenu = null;
  };
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('keydown', onKeyDown, true);
}

// パネルメニュー経由はメニューを開いたペインに新規タブを追加する（C案）
// → 既に他のパネルセットに同種のタブがあっても、新しく追加できる
const _openPanelMenuItem = (type, paneId) => {
  if (type === 'outliner' && window.MeldexCloudMobile?.toggleSidebarDrawer?.()) {
    return;
  }
  if (type === 'version') {
    if (typeof addPanelMenuVersion === 'function') addPanelMenuVersion({ paneId });
  } else if (typeof addPanelMenuTool === 'function') {
    addPanelMenuTool(type, { paneId });
  }
};

function _bindPanelMenuItem(row, action) {
  let touchHandled = false;
  const run = (ev) => {
    ev?.preventDefault?.();
    ev?.stopPropagation?.();
    action();
  };
  row.addEventListener('pointerup', (ev) => {
    if (ev.pointerType === 'mouse') return;
    touchHandled = true;
    run(ev);
  });
  row.addEventListener('click', (ev) => {
    if (touchHandled) {
      touchHandled = false;
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    run(ev);
  });
}

const PANEL_MENU_SECTIONS = [{
  title: '',
  items: [
    { label: 'フォルダ', icon: 'folder', type: 'folder', open: (paneId) => _openPanelMenuItem('folder', paneId) },
    { label: 'ノート', icon: 'page', type: 'page', open: (paneId) => _openPanelMenuItem('page', paneId) },
    { label: 'シナリオ', icon: 'bookOpenText', type: 'scriptnote', open: (paneId) => _openPanelMenuItem('scriptnote', paneId) },
    { label: 'シート', icon: 'db', type: 'database', open: (paneId) => _openPanelMenuItem('database', paneId) },
    { label: 'ボード', icon: 'presentation', type: 'board', open: (paneId) => _openPanelMenuItem('board', paneId) },
    { label: 'スケジュール', icon: 'calendar', type: 'calendar', open: (paneId) => _openPanelMenuItem('calendar', paneId) },
    { label: 'スマートシート', icon: 'databaseSearch', type: 'smart-db', open: (paneId) => _openPanelMenuItem('smart-db', paneId) },
  ],
}];

function showPanelMenu(e, options) {
  e?.preventDefault?.();
  e?.stopPropagation?.();
  e?.stopImmediatePropagation?.();
  const existing = document.querySelector('.ab-dropdown.ab-panel-menu');
  if (existing) {
    if (typeof existing._cleanupPanelMenu === 'function') existing._cleanupPanelMenu();
    _removeAppBarDropdowns();
    return;
  }
  _removeAppBarDropdowns();
  document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'ab-dropdown ab-panel-menu';
  menu.style.cssText = 'position:fixed;z-index:999;min-width:240px;';
  const targetPaneId = options?.paneId || (typeof GBLayout !== 'undefined' ? GBLayout.activePane : '');

  const closeMenu = () => {
    _removeAppBarDropdowns();
  };

  PANEL_MENU_SECTIONS.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) {
      const sep = document.createElement('div');
      sep.className = 'ab-dropdown-sep';
      menu.appendChild(sep);
    }
    if (section.title) {
      const title = document.createElement('div');
      title.style.cssText = 'padding:6px 12px 4px;font-size:11px;color:var(--fg2);text-transform:uppercase;letter-spacing:0.04em;';
      title.textContent = section.title;
      menu.appendChild(title);
    }
    section.items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'ab-dropdown-item';
      row.innerHTML = lucide(item.icon, 16) + ' ' + item.label;
      _bindPanelMenuItem(row, () => {
        closeMenu();
        item.open(targetPaneId);
      });
      menu.appendChild(row);
    });
  });

  document.body.appendChild(menu);
  const btn = _resolveAppBarButton(e);
  if (btn && typeof positionPopup === 'function') positionPopup(menu, btn.getBoundingClientRect());
  else if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  const onPointerDown = (ev) => {
    if (_isAppBarDropdownTarget(ev.target, menu, btn)) return;
    closeMenu();
  };
  const onClick = (ev) => {
    if (_isAppBarDropdownTarget(ev.target, menu, btn)) return;
    closeMenu();
  };
  const onFocusIn = (ev) => {
    if (_isAppBarDropdownTarget(ev.target, menu, btn)) return;
    closeMenu();
  };
  const onKeyDown = (ev) => {
    if (ev.key === 'Escape') closeMenu();
  };
  menu._cleanupPanelMenu = () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('keydown', onKeyDown, true);
    menu._cleanupPanelMenu = null;
  };
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('keydown', onKeyDown, true);
}

/* ==============================
   インポート / エクスポート メニュー
   ============================== */
function _showDropdownMenu(e, items, btnSelector) {
  const existing = document.querySelector('.ab-dropdown.ab-io-menu');
  if (existing) { existing.remove(); return; }
  const menu = document.createElement('div');
  menu.className = 'ab-dropdown ab-io-menu';
  items.forEach(item => {
    if (item === '---') {
      const s = document.createElement('div'); s.className = 'ab-dropdown-sep'; menu.appendChild(s); return;
    }
    const el = document.createElement('div');
    el.className = 'ab-dropdown-item';
    el.innerHTML = lucide(item[1], 16) + ' ' + item[0];
    el.addEventListener('click', () => { menu.remove(); item[2](); });
    menu.appendChild(el);
  });
  document.body.appendChild(menu);
  const btn = (e && e.target) ? e.target.closest('button') : document.querySelector(btnSelector);
  const rect = btn ? btn.getBoundingClientRect() : { right: window.innerWidth - 100, bottom: 40 };
  { const z = _getZoom(); menu.style.right = ((window.innerWidth - rect.right) / z) + 'px'; menu.style.top = (rect.bottom / z + 2) + 'px'; }
  requestAnimationFrame(() => {
    const z = _getZoom(); const mr = menu.getBoundingClientRect();
    if (mr.bottom > window.innerHeight) menu.style.top = ((window.innerHeight - mr.height - 4) / z) + 'px';
  });
  setTimeout(() => {
    document.addEventListener('pointerdown', function closer(ev) {
      if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', closer, true); }
    }, true);
  }, 0);
}

/* ==============================
   ルートフォルダ全体検索
   ============================== */
/* ==============================
   フォルダツリー ファイル名検索
   ============================== */
const MeldexUnifiedSearch = (() => {
  const STORAGE_KEY = 'meldex-search-scopes-v1';
  const LEGACY_KEY = 'search-scopes';
  const TAG_CONDITION_KEY = 'meldex-search-tag-condition-v1';
  const defaults = { name: true, content: true, clip: false, tags: false, memo: false };
  const labels = { name: '名前', content: 'ファイル内文字列', clip: '画像の内容', tags: 'タグ', memo: 'メモ' };

  // 検索側のタグ条件（複数タグ・厳密照合・すべて/どれか）。3つの検索入口
  // （フォルダツリー上部・フォルダ表示の検索欄・コマンドパレット）は同じ
  // MeldexUnifiedSearch を経由するため、この状態も共有する（1-A）。
  // フィルタ側の filterTags（フォルダ表示専用・フォルダ内実在タグのみ）とは
  // 別物。検索文字列には混ぜず、正式なタグ条件として扱う（1-C, 2-F）。
  function readTagCondition() {
    try {
      const raw = JSON.parse(localStorage.getItem(TAG_CONDITION_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        const tagIds = Array.isArray(raw.tagIds) ? raw.tagIds.map(String).filter(Boolean) : [];
        const tagMode = raw.tagMode === 'any' ? 'any' : 'all';
        return { tagIds, tagMode };
      }
    } catch {}
    return { tagIds: [], tagMode: 'all' };
  }

  function writeTagCondition(value) {
    const next = {
      tagIds: Array.isArray(value?.tagIds) ? [...new Set(value.tagIds.map(String).filter(Boolean))] : [],
      tagMode: value?.tagMode === 'any' ? 'any' : 'all',
    };
    try { localStorage.setItem(TAG_CONDITION_KEY, JSON.stringify(next)); } catch {}
    window.dispatchEvent(new CustomEvent('meldex:search-tag-condition-changed', { detail: next }));
    return next;
  }

  function available(key) {
    if (key !== 'clip') return true;
    // Cloud静的版にはテキスト埋め込みを生成するローカルCLIPモデルがない。
    // 設定値自体は端末間で壊さず保持し、Cloudでは操作を見せず検索要求から除く。
    return !(window.MeldexRuntimeAdapter?.isBrowserDataMode?.()
      || document.body?.dataset?.cloudMode === 'dropbox'
      || document.body?.dataset?.cloudMode === 'browser');
  }

  function read() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY) || 'null'); } catch {}
    const next = { ...defaults };
    if (raw && typeof raw === 'object') Object.keys(next).forEach(key => { if (key in raw) next[key] = !!raw[key]; });
    if (!Object.values(next).some(Boolean)) next.name = true;
    return next;
  }

  function write(value) {
    const next = { ...defaults, ...(value || {}) };
    if (!Object.values(next).some(Boolean)) next.name = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('meldex:search-scopes-changed', { detail: next }));
    return next;
  }

  function active() { return Object.entries(read()).filter(([key, enabled]) => enabled && available(key)).map(([key]) => key); }

  function request(path, options) {
    const isBrowserCloud = window.MeldexRuntimeAdapter?.isBrowserDataMode?.()
      || document.body?.dataset?.cloudMode === 'dropbox'
      || document.body?.dataset?.cloudMode === 'browser';
    if (isBrowserCloud && window.MeldexDataAccess?.requestJson) {
      return window.MeldexDataAccess.requestJson(path, options || {});
    }
    if (typeof apiFetch === 'function') return apiFetch(path, options);
    return Promise.resolve({ results: [], scopes: active(), unavailable: [] });
  }

  async function search(query, options = {}) {
    const q = String(query || '').trim();
    const tagCondition = readTagCondition();
    // 文字列が空でも、タグ条件だけが入っていれば検索を通す（2-F）。
    if (!q && !tagCondition.tagIds.length) return { results: [], scopes: active(), unavailable: [] };
    const params = new URLSearchParams({ q, scopes: active().join(','), limit: String(options.limit || 50) });
    if (options.path) params.set('path', options.path);
    if (tagCondition.tagIds.length) {
      params.set('tag_ids', tagCondition.tagIds.join(','));
      params.set('tag_mode', tagCondition.tagMode);
    }
    return request('/search-unified?' + params.toString(), { silentError: true });
  }

  // CLIPのトークナイザは英語のBPEなので、非ASCIIを渡すと意味を持たない断片に
  // なる（実測: 日本語直と英訳で識別度が大きく変わる）。判定は「ASCII以外を
  // 含むか」程度の軽いものでよい（1-A追記）。
  const NON_ASCII_RE = /[^\x00-\x7F]/;

  // 検索対象「画像の内容」が使えない理由・日本語クエリの注意を、3つの検索UI
  // （コマンドパレット・フォルダツリー検索・フォルダパネル検索）で共通に出す
  // ためのヒント文言。data は search() の戻り値（unavailable[] を含む）。
  // data が無くても、非ASCIIクエリの注意だけは即時に出せる。
  function describeHints(data, query) {
    const hints = [];
    const q = String(query || '');
    if (q && active().includes('clip') && NON_ASCII_RE.test(q)) {
      hints.push('画像の内容検索は英語で入力してください（例: a red circle）');
    }
    const clipIssue = (data?.unavailable || []).find(item => item?.source === 'clip' && item.message);
    if (clipIssue) hints.push(String(clipIssue.message));
    return hints;
  }

  // ヒント文言をDOM要素へ反映する（無ければ非表示）。3つの検索UIはそれぞれ
  // DOM構造が異なるため、要素の生成・配置は呼び出し側が行い、ここでは
  // 表示内容の更新だけを共通化する。
  function updateHint(el, data, query) {
    const hints = describeHints(data, query);
    if (el) {
      el.textContent = hints.join(' ／ ');
      el.style.display = hints.length ? '' : 'none';
    }
    return hints;
  }

  function show(anchor) {
    document.querySelectorAll('.meldex-search-scope-popup').forEach(node => node._removeSearchScope?.() || node.remove());
    const popup = document.createElement('div');
    popup.className = 'meldex-search-scope-popup';
    popup.dataset.e2eId = 'search-scope-popup';
    popup.style.cssText = 'position:fixed;z-index:1300;min-width:210px;padding:8px;background:var(--bg2);color:var(--fg);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.24);';
    const state = read();
    Object.entries(labels).forEach(([key, label]) => {
      if (!available(key)) return;
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px;cursor:pointer;';
      const input = document.createElement('input');
      input.type = 'checkbox'; input.checked = state[key]; input.dataset.searchScope = key;
      input.addEventListener('change', () => {
        state[key] = input.checked;
        const saved = write(state);
        popup.querySelectorAll('[data-search-scope]').forEach(box => { box.checked = !!saved[box.dataset.searchScope]; });
      });
      row.append(input, document.createTextNode(label)); popup.appendChild(row);
    });
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'gb-btn gb-btn-sm gb-btn-icon'; close.title = '閉じる';
    close.setAttribute('aria-label', '検索対象設定を閉じる'); close.innerHTML = typeof lucide === 'function' ? lucide('x', 14) : '×';
    const remove = () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true); popup.remove(); };
    popup._removeSearchScope = remove;
    const outside = event => { if (!popup.contains(event.target) && event.target !== anchor) remove(); };
    const escape = event => { if (event.key === 'Escape') remove(); };
    close.style.cssText = 'display:block;margin:6px 4px 0 auto;'; close.addEventListener('click', remove);
    popup.appendChild(close); document.body.appendChild(popup);
    if (anchor?.getBoundingClientRect && typeof positionPopup === 'function') positionPopup(popup, anchor.getBoundingClientRect());
    else if (anchor?.getBoundingClientRect) { const rect = anchor.getBoundingClientRect(); popup.style.left = rect.left + 'px'; popup.style.top = (rect.bottom + 4) + 'px'; }
    setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape, true); }, 0);
    return popup;
  }

  function button(anchorParent, options = {}) {
    if (!anchorParent || anchorParent.querySelector?.('[data-search-scope-trigger]')) return null;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.dataset.searchScopeTrigger = 'true'; btn.dataset.e2eId = options.e2eId || 'search-scope-trigger';
    btn.className = options.className || 'gb-btn gb-btn-sm gb-btn-icon'; btn.title = '検索対象'; btn.setAttribute('aria-label', '検索対象を設定');
    btn.innerHTML = typeof lucide === 'function' ? lucide('slidersHorizontal', 14) : '⚙';
    btn.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); show(btn); });
    anchorParent.appendChild(btn); return btn;
  }

  const TAG_BUTTON_OWNER_KEY = 'unified-search';

  // 検索欄の横に置く、タグ選択フロートパネルを開くボタン（2-D）。フォルダツリー
  // 上部・フォルダ表示の検索欄・コマンドパレットの3か所で同じ見た目・同じ状態を使う。
  function tagButton(anchorParent, options = {}) {
    if (!anchorParent || anchorParent.querySelector?.('[data-search-tag-trigger]')) return null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.searchTagTrigger = 'true';
    btn.dataset.e2eId = options.e2eId || 'search-tag-trigger';
    btn.className = options.className || 'gb-btn gb-btn-sm gb-btn-icon';
    btn.title = 'タグで絞り込み';
    btn.setAttribute('aria-label', '検索に使うタグを選ぶ');

    const syncBadge = () => {
      const cond = readTagCondition();
      btn.replaceChildren();
      const iconSpan = document.createElement('span');
      iconSpan.className = 'gb-search-tag-trigger-icon';
      iconSpan.innerHTML = typeof lucide === 'function' ? lucide('listTree', 14) : '🏷';
      btn.appendChild(iconSpan);
      if (cond.tagIds.length) {
        const badge = document.createElement('span');
        badge.className = 'gb-search-tag-trigger-badge';
        badge.textContent = String(cond.tagIds.length);
        btn.appendChild(badge);
      }
      window.GBTagPickerPanel?.syncTriggerButton?.(btn, TAG_BUTTON_OWNER_KEY);
    };
    syncBadge();
    window.addEventListener('meldex:search-tag-condition-changed', syncBadge);

    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!window.GBTagPickerPanel?.open) return;
      const cond = readTagCondition();
      window.GBTagPickerPanel.open({
        ownerKey: TAG_BUTTON_OWNER_KEY,
        headerLabel: '検索に使うタグ',
        sourceFolder: typeof options.sourceFolder === 'function' ? (options.sourceFolder() || '') : String(options.sourceFolder || ''),
        tagIds: cond.tagIds,
        matchMode: cond.tagMode,
        onChange: (tagIds, mode) => {
          writeTagCondition({ tagIds, tagMode: mode });
          if (typeof options.onChange === 'function') options.onChange(tagIds, mode);
        },
      });
    });
    anchorParent.appendChild(btn);
    return btn;
  }

  return {
    STORAGE_KEY, defaults, read, write, active, available, search, show, button,
    TAG_CONDITION_KEY, readTagCondition, writeTagCondition, tagButton,
    describeHints, updateHint,
  };
})();
window.MeldexUnifiedSearch = MeldexUnifiedSearch;

let _treeSearchQuery = '';
let _treeUnifiedSearchPaths = new Set();
let _treeUnifiedSearchSeq = 0;
let _treeUnifiedSearchTimer = 0;

// 検索対象「画像の内容」が使えない理由・日本語クエリの注意を出す小さな
// テキスト行。検索バー（#sidebar-search-bar）の直後に一度だけ作る（1-A追記）。
function _ensureTreeSearchHintEl() {
  const existing = document.getElementById('tree-search-hint');
  if (existing) return existing;
  const bar = document.getElementById('sidebar-search-bar');
  if (!bar?.parentElement) return null;
  const hint = document.createElement('div');
  hint.id = 'tree-search-hint';
  hint.dataset.e2eId = 'tree-search-hint';
  hint.style.cssText = 'display:none;padding:2px 8px 6px;font-size:11px;line-height:1.4;color:var(--fg2);flex-shrink:0;';
  bar.insertAdjacentElement('afterend', hint);
  return hint;
}

function doTreeNameSearch() {
  const input = document.getElementById('sidebar-search-input');
  const q = (input?.value || '').trim().toLowerCase();
  const hasTagCondition = (MeldexUnifiedSearch.readTagCondition?.().tagIds || []).length > 0;
  const clearBtn = document.getElementById('btn-tree-search-clear');
  if (clearBtn) clearBtn.style.display = (q || hasTagCondition) ? '' : 'none';
  _treeSearchQuery = q;
  const seq = ++_treeUnifiedSearchSeq;
  _treeUnifiedSearchPaths = new Set();
  applyTreeNameSearch();
  const scopes = MeldexUnifiedSearch.active();
  // クエリの言語チェックだけは通信を待たず即時に出す。使えない理由は
  // 検索結果が返ってから追加で反映する。
  MeldexUnifiedSearch.updateHint?.(_ensureTreeSearchHintEl(), null, q);
  // タグ条件だけでも検索を通す（文字列は空でよい。2-F）。
  if ((q && scopes.some(scope => scope !== 'name')) || hasTagCondition) {
    clearTimeout(_treeUnifiedSearchTimer);
    _treeUnifiedSearchTimer = setTimeout(() => {
      _treeUnifiedSearchTimer = 0;
      MeldexUnifiedSearch.search(q, { limit: 100 }).then(data => {
        if (seq !== _treeUnifiedSearchSeq) return;
        _treeUnifiedSearchPaths = new Set((data.results || []).map(item => String(item.path || '').replace(/\\/g, '/').toLowerCase()));
        applyTreeNameSearch();
        MeldexUnifiedSearch.updateHint?.(_ensureTreeSearchHintEl(), data, q);
      }).catch(() => {});
    }, 240);
  } else {
    clearTimeout(_treeUnifiedSearchTimer);
    _treeUnifiedSearchTimer = 0;
  }
  if (typeof saveCurrentLayoutFilterState === 'function') saveCurrentLayoutFilterState();
}

function clearTreeNameSearch() {
  const input = document.getElementById('sidebar-search-input');
  if (input) input.value = '';
  // タグ条件が残っている場合は、文字列だけ消してタグ条件検索を続ける
  // （doTreeNameSearch() が hasTagCondition を見て判断する。2-F）。
  doTreeNameSearch();
}

function applyTreeNameSearch() {
  const q = _treeSearchQuery;
  const hasTagCondition = (MeldexUnifiedSearch.readTagCondition?.().tagIds || []).length > 0;
  const includeName = MeldexUnifiedSearch.read().name;
  const includeEntities = typeof _getTreeSearchIncludeEntities === 'function'
    ? _getTreeSearchIncludeEntities()
    : localStorage.getItem('tree-search-include-entities') === 'true';
  const allNodes = document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node, #body-workspaces .tree-node');

  if (!q && !hasTagCondition) {
    // 検索クリア: グローバルフィルタのみ適用状態に戻す
    applyGlobalFilter();
    return;
  }

  // パス1: マッチするノードにフラグを立てる。文字列が空（タグ条件だけ）の
  // 場合、空文字はどの名前にも一致してしまうため名前マッチは行わず、
  // 統一検索が返したパス一致だけで判定する。
  allNodes.forEach(node => {
    const d = node._nodeData;
    const baseVisible = node.dataset.baseVisible !== '0';
    if (!d || !baseVisible) {
      node._searchMatch = false;
      return;
    }
    const nameMatch = !!(q && includeName && d.name && d.name.toLowerCase().includes(q));
    const pathMatch = _treeUnifiedSearchPaths.has(String(d.path || '').replace(/\\/g, '/').toLowerCase());
    // フォルダ/ルートは名前マッチのみ
    if (d.type === 'folder' || d._isRoot || d.type === 'database') {
      node._searchMatch = nameMatch || pathMatch;
      return;
    }
    // エントリ: 設定次第
    if (d.type === 'entity') {
      node._searchMatch = includeEntities && (nameMatch || pathMatch);
      return;
    }
    // ファイル: 名前マッチ
    node._searchMatch = nameMatch || pathMatch;
  });

  // パス2: マッチしたノードの祖先フォルダも表示
  allNodes.forEach(node => {
    if (node._searchMatch) {
      let parent = node.parentElement?.closest('.tree-node');
      while (parent) {
        if (parent.dataset.baseVisible !== '0') parent._searchAncestor = true;
        parent = parent.parentElement?.closest('.tree-node');
      }
    }
  });

  // パス3: 表示/非表示を設定 + マッチした子を持つフォルダを展開
  allNodes.forEach(node => {
    const d = node._nodeData;
    const baseVisible = node.dataset.baseVisible !== '0';
    if (!d || !baseVisible) {
      node.style.display = 'none';
      delete node._searchMatch;
      delete node._searchAncestor;
      return;
    }
    if (node._searchMatch || node._searchAncestor) {
      node.style.display = '';
      // 祖先フォルダが閉じていれば開く
      if (node._searchAncestor && (d.type === 'folder' || d.type === 'database' || d._isRoot)) {
        const toggle = node.querySelector(':scope > .tree-node-row .tree-toggle');
        const childrenDiv = node.querySelector(':scope > .tree-children');
        if (toggle && childrenDiv && toggle.dataset.expanded === 'false') {
          // まだロードされていないフォルダは展開（遅延ロード発火）
          toggle.click();
        } else if (childrenDiv) {
          childrenDiv.classList.remove('collapsed');
        }
      }
    } else {
      node.style.display = 'none';
    }
    delete node._searchMatch;
    delete node._searchAncestor;
  });
  window.GBOutlinerVirtualRender?.refreshAllFilters();
}

function _installTreeSearchScopeTrigger() {
  const input = document.getElementById('sidebar-search-input');
  if (!input?.parentElement) return;
  MeldexUnifiedSearch.button(input.parentElement, { e2eId: 'tree-search-scope-trigger' });
  MeldexUnifiedSearch.tagButton?.(input.parentElement, { e2eId: 'tree-search-tag-trigger' });
  _ensureTreeSearchHintEl();
}
queueMicrotask(_installTreeSearchScopeTrigger);
document.addEventListener('DOMContentLoaded', _installTreeSearchScopeTrigger, { once: true });
window.addEventListener('meldex:search-scopes-changed', () => {
  if (_treeSearchQuery) doTreeNameSearch();
});
window.addEventListener('meldex:search-tag-condition-changed', () => {
  doTreeNameSearch();
});

const _vaultSearchPanelUi = {
  homeParent: null,
  homeNextSibling: null,
  anchor: null,
  trigger: null,
  resizeObserver: null,
  repositionHandler: null,
  sidebarOptions: null,
};

function _rememberVaultSearchPanelHome(panel) {
  if (_vaultSearchPanelUi.homeParent || !panel?.parentNode) return;
  _vaultSearchPanelUi.homeParent = panel.parentNode;
  _vaultSearchPanelUi.homeNextSibling = panel.nextSibling;
}

function _snapshotVaultSearchSidebarOptions() {
  if (_vaultSearchPanelUi.sidebarOptions) return;
  _vaultSearchPanelUi.sidebarOptions = {
    folderOnly: !!document.getElementById('sp-folder-only')?.checked,
    replace: !!document.getElementById('sp-show-replace')?.checked,
  };
}

function _stopMainVaultSearchPanelTracking() {
  _vaultSearchPanelUi.resizeObserver?.disconnect();
  _vaultSearchPanelUi.resizeObserver = null;
  const handler = _vaultSearchPanelUi.repositionHandler;
  if (handler) {
    window.removeEventListener('resize', handler);
    window.visualViewport?.removeEventListener('resize', handler);
  }
  _vaultSearchPanelUi.repositionHandler = null;
}

function _restoreVaultSearchPanelHome(panel) {
  _stopMainVaultSearchPanelTracking();
  const parent = _vaultSearchPanelUi.homeParent;
  const next = _vaultSearchPanelUi.homeNextSibling;
  if (parent && panel.parentNode !== parent) {
    if (next?.parentNode === parent) parent.insertBefore(panel, next);
    else parent.appendChild(panel);
  }
  panel.classList.remove('search-panel-main-popup');
  delete panel.dataset.searchSurface;
  ['left', 'top', 'maxHeight', 'maxWidth', 'overflowX', 'overflowY', 'visibility'].forEach(name => {
    panel.style.removeProperty(name.replace(/[A-Z]/g, match => '-' + match.toLowerCase()));
  });
  const saved = _vaultSearchPanelUi.sidebarOptions;
  if (saved) {
    const folderOnly = document.getElementById('sp-folder-only');
    if (folderOnly) folderOnly.checked = saved.folderOnly;
    _setVaultSearchReplaceMode(saved.replace);
  }
  _vaultSearchPanelUi.sidebarOptions = null;
  _vaultSearchPanelUi.anchor = null;
  _vaultSearchPanelUi.trigger = null;
}

function _positionMainVaultSearchPanel() {
  const panel = document.getElementById('search-panel');
  const anchor = _vaultSearchPanelUi.anchor;
  if (!panel?.classList.contains('search-panel-main-popup') || !anchor?.isConnected) return;
  const rect = anchor.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    closeSearchPanel({ restoreFocus: false });
    return;
  }
  const zoom = typeof _getZoom === 'function' ? _getZoom() : 1;
  const gap = 4;
  const top = rect.bottom / zoom + gap;
  panel.style.visibility = 'hidden';
  panel.style.maxWidth = Math.max(160, rect.right / zoom - gap) + 'px';
  panel.style.left = Math.max(gap, rect.right / zoom - panel.offsetWidth) + 'px';
  panel.style.top = top + 'px';
  panel.style.maxHeight = Math.max(120, window.innerHeight / zoom - top - gap) + 'px';
  panel.style.visibility = 'visible';
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(panel);
}

function _startMainVaultSearchPanelTracking(anchor) {
  _stopMainVaultSearchPanelTracking();
  const reposition = () => _positionMainVaultSearchPanel();
  _vaultSearchPanelUi.repositionHandler = reposition;
  window.addEventListener('resize', reposition, { passive: true });
  window.visualViewport?.addEventListener('resize', reposition, { passive: true });
  if (typeof ResizeObserver === 'function') {
    _vaultSearchPanelUi.resizeObserver = new ResizeObserver(reposition);
    _vaultSearchPanelUi.resizeObserver.observe(anchor);
  }
}

function _openMainVaultSearchPanel(panel, options) {
  _rememberVaultSearchPanelHome(panel);
  const alreadyMain = panel.dataset.searchSurface === 'main';
  if (!alreadyMain) _snapshotVaultSearchSidebarOptions();
  _vaultSearchPanelUi.anchor = options.anchor;
  if (!alreadyMain || !_vaultSearchPanelUi.trigger) _vaultSearchPanelUi.trigger = options.trigger || null;
  document.body.appendChild(panel);
  panel.dataset.searchSurface = 'main';
  panel.classList.add('search-panel-main-popup', 'open');
  _startMainVaultSearchPanelTracking(options.anchor);
  _positionMainVaultSearchPanel();
}

function _focusVaultSearchQuery() {
  const query = document.getElementById('sp-query');
  if (!query) return;
  try { query.focus({ preventScroll: true }); }
  catch (_) { query.focus(); }
}

function openSearchPanel(options = {}) {
  const panel = document.getElementById('search-panel');
  if (!panel) return;
  _rememberVaultSearchPanelHome(panel);
  if (options.surface === 'main' && options.anchor) {
    _openMainVaultSearchPanel(panel, options);
  } else {
    _restoreVaultSearchPanelHome(panel);
    const sidebar = document.getElementById('sidebar');
    if (sidebar?.style.display === 'none') toggleSidebar();
    delete panel.dataset.searchPath;
    panel.classList.add('open');
  }
  _focusVaultSearchQuery();
}

function closeSearchPanel(options = {}) {
  const panel = document.getElementById('search-panel');
  if (!panel) return;
  const trigger = panel.dataset.searchSurface === 'main' ? _vaultSearchPanelUi.trigger : null;
  panel.classList.remove('open');
  delete panel.dataset.searchPath;
  _restoreVaultSearchPanelHome(panel);
  if (options.restoreFocus !== false && trigger?.isConnected && !trigger.disabled) trigger.focus();
}

function _setVaultSearchReplaceMode(enabled) {
  const replaceToggle = document.getElementById('sp-show-replace');
  const replaceRow = document.getElementById('sp-replace-row');
  if (replaceToggle) replaceToggle.checked = !!enabled;
  if (replaceRow) replaceRow.style.display = enabled ? 'flex' : 'none';
}

function openVaultSearchReplacePanel(scopePath, options = {}) {
  openSearchPanel(options);
  const panel = document.getElementById('search-panel');
  const path = String(scopePath || '').trim();
  if (path) panel.dataset.searchPath = path;
  else delete panel.dataset.searchPath;
  const folderOnly = document.getElementById('sp-folder-only');
  if (folderOnly) folderOnly.checked = !!path;
  _setVaultSearchReplaceMode(true);
  _focusVaultSearchQuery();
  if (options.surface === 'main') _positionMainVaultSearchPanel();
}

function _visibleFolderSearchToolbar() {
  const candidates = Array.from(document.querySelectorAll('#folder-toolbar, .folder-toolbar'));
  return candidates.find(toolbar => {
    const rect = toolbar.getBoundingClientRect();
    return toolbar.isConnected && rect.width > 0 && rect.height > 0 && getComputedStyle(toolbar).display !== 'none';
  }) || document.getElementById('folder-toolbar');
}

function openCurrentToolbarSearchReplace(tool, options = {}) {
  const normalized = String(tool || '').toLowerCase();
  if (normalized === 'page' || normalized === 'note') {
    if (typeof openFileSearch === 'function') openFileSearch('replace');
    return;
  }
  if (normalized === 'board') {
    if (typeof bdOpenFindBar === 'function') bdOpenFindBar('replace');
    return;
  }
  if (normalized === 'database' || normalized === 'db' || normalized === 'sheet') {
    if (typeof openDbFindReplace === 'function') openDbFindReplace('replace');
    return;
  }
  if (normalized === 'scriptnote' || normalized === 'scenario') {
    const editor = typeof _sn2GetActiveEditor === 'function' ? _sn2GetActiveEditor() : null;
    const searchButton = editor?.host?.closest?.('.gb-se-root')?.querySelector?.('[data-sn-action="search"]') || null;
    if (typeof editor?._showSearchReplacePopup === 'function') editor._showSearchReplacePopup(searchButton);
    return;
  }
  if (normalized === 'folder') {
    const folderPath = (typeof _folderPath !== 'undefined' && _folderPath) ? _folderPath : '';
    const toolbar = _visibleFolderSearchToolbar();
    const trigger = options.trigger || toolbar?.querySelector('button[aria-label="検索と置換"]') || null;
    openVaultSearchReplacePanel(folderPath, { surface: 'main', anchor: toolbar, trigger });
    return;
  }
  if (typeof openFileSearch === 'function') openFileSearch('replace');
}

function _selectedSearchFolderPath() {
  const panel = document.getElementById('search-panel');
  const scopedPath = panel?.dataset?.searchPath || '';
  if (scopedPath) return scopedPath;
  if (!treeSelection.lastClicked || !treeSelection.lastClicked._nodeData) return '';
  const nd = treeSelection.lastClicked._nodeData;
  if (nd.type === 'folder' || nd.type === 'database') return nd.path || '';
  const path = String(nd.path || '').replace(/\\/g, '/');
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(0, slash) : '';
}

async function doVaultSearch() {
  const q = document.getElementById('sp-query').value;
  if (!q) return;
  const caseSensitive = document.getElementById('sp-case').checked;
  const useRegex = document.getElementById('sp-regex').checked;
  const folderOnly = document.getElementById('sp-folder-only').checked;
  const searchPath = folderOnly ? _selectedSearchFolderPath() : '';

  document.getElementById('sp-status').textContent = '検索中...';
  document.getElementById('sp-results').innerHTML = '';

  try {
    const params = new URLSearchParams({ q, case: caseSensitive, regex: useRegex });
    if (searchPath) params.set('path', searchPath);
    const data = await apiFetch('/search?' + params.toString());
    if (data.error) {
      const container = document.getElementById('sp-results');
      renderEmptyState(container, 'search', data.error, '検索語を確認してください');
      document.getElementById('sp-status').textContent = data.error;
      return;
    }
    renderSearchResults(data, q, caseSensitive, useRegex);
  } catch (e) {
    document.getElementById('sp-status').textContent = '検索エラー';
  }
}

function renderSearchResults(data, query, caseSensitive, useRegex) {
  const results = data.results || [];
  const container = document.getElementById('sp-results');
  if (results.length === 0) {
    renderEmptyState(container, 'search', '見つかりませんでした', '別のキーワードで検索してください');
    document.getElementById('sp-status').textContent = '0件';
    return;
  }

  let html = '';
  results.forEach(file => {
    const resultAttrs = `data-search-result-path="${esc(file.path)}" data-search-result-type="${esc(file.type)}"`;
    html += `<div class="sp-file" ${resultAttrs}>${esc(file.name)} <span style="font-weight:normal;color:var(--fg2);font-size:11px;">(${file.matches.length}件)</span></div>`;
    file.matches.slice(0, 20).forEach(m => {
      const text = m.text || '';
      const highlighted = highlightMatch(text, query, caseSensitive, useRegex);
      const lineInfo = m.field ? `${m.field}:${m.line}` : `L${m.line}`;
      html += `<div class="sp-match" ${resultAttrs}><span class="sp-line">${lineInfo}</span>${highlighted}</div>`;
    });
    if (file.matches.length > 20) {
      html += `<div class="sp-match" style="color:var(--fg2);font-style:italic;">...他 ${file.matches.length - 20}件</div>`;
    }
  });
  container.innerHTML = html;
  _bindVaultSearchResultClicks(container);
  document.getElementById('sp-status').textContent = `${data.total}件（${results.length}ファイル）`;
}

function _bindVaultSearchResultClicks(container) {
  if (!container || container._vaultSearchResultClickBound) return;
  container._vaultSearchResultClickBound = true;
  container.addEventListener('click', (e) => {
    const target = e.target.closest?.('[data-search-result-path]');
    if (!target || !container.contains(target)) return;
    e.preventDefault();
    openSearchResult(target.dataset.searchResultPath || '', target.dataset.searchResultType || '');
  });
}

function highlightMatch(text, query, caseSensitive, useRegex) {
  const source = String(text || '');
  const flags = caseSensitive ? 'g' : 'gi';
  try {
    if (useRegex) {
      const re = new RegExp(query, flags);
      let out = '';
      let lastIndex = 0;
      let match;
      while ((match = re.exec(source)) !== null) {
        const start = match.index;
        const matched = match[0] || '';
        const end = start + matched.length;
        if (end === start) {
          re.lastIndex += 1;
          continue;
        }
        out += esc(source.slice(lastIndex, start));
        out += `<span class="sp-highlight">${esc(source.slice(start, end))}</span>`;
        lastIndex = end;
      }
      return out + esc(source.slice(lastIndex));
    }
    const escaped = esc(source);
    const qEsc = esc(query);
    return escaped.replace(new RegExp(qEsc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags),
      m => `<span class="sp-highlight">${m}</span>`);
  } catch { return esc(source); }
}

function _searchResultLabel(path) {
  return String(path || '').split('/').pop()
    .replace(/\.mel-sheet$/i, '')
    .replace(/\.mel-board$/i, '')
    .replace(/\.mel-scenario$/i, '')
    .replace(/\.mel-timer$/i, '')
    .replace(/\.smart-db\.json$/i, '')
    .replace(/\.scriptnote\.json$/i, '')
    .replace(/\.timer\.json$/i, '')
    .replace(/\.scenario\.json$/i, '')
    .replace(/\.board\.md$/i, '')
    .replace(/\.\w+$/, '');
}

function _searchResultKind(path, type) {
  const lower = String(path || '').toLowerCase();
  if (type === 'smart-db' || lower.endsWith('.mel-sheet') || lower.endsWith('.smart-db.json')) return 'smart-db';
  if (type === 'scriptnote' || type === 'scenario' || lower.endsWith('.mel-scenario') || lower.endsWith('.scriptnote.json') || lower.endsWith('.scenario.json')) return 'scriptnote';
  if (type === 'timer' || lower.endsWith('.mel-timer') || lower.endsWith('.timer.json')) return 'timer';
  if (type === 'csv' || lower.endsWith('.csv')) return 'csv';
  if (type === 'board' || lower.endsWith('.mel-board') || lower.endsWith('.board.md')) return 'board';
  if (type === 'database') return 'database';
  return type || 'page';
}

function openSearchResult(path, type) {
  const _expOpts = { fromExplorer: true };
  const kind = _searchResultKind(path, type);
  const label = _searchResultLabel(path);
  if (kind === 'folder' && typeof openFolder === 'function') openFolder(label, path, _expOpts);
  else if (kind === 'image' || kind === 'video' || kind === 'audio') {
    if (typeof openMedia === 'function') openMedia(label, path, kind, _expOpts);
  }
  else if (kind === 'document' && String(path || '').toLowerCase().endsWith('.pdf')) openViewer('/viewer?pdf=' + encodeURIComponent(path));
  else if (kind === 'scriptnote') { if (typeof openScenarioInScriptNote === 'function') openScenarioInScriptNote(path, label, _expOpts); }
  else if (kind === 'board') openBoard(label, path, _expOpts);
  else if (kind === 'csv' && typeof openCsvFile === 'function') openCsvFile(label, path, _expOpts);
  else if (kind === 'smart-db' && typeof openSmartDbFile === 'function') openSmartDbFile(label, path, _expOpts);
  else if (kind === 'database' && typeof selectDatabase === 'function') selectDatabase(path, null, _expOpts);
  else openPage(label, path, _expOpts);
}

async function doVaultReplace(all) {
  const q = document.getElementById('sp-query').value;
  const r = document.getElementById('sp-replace').value;
  if (!q) return;
  if (!await cfConfirm(`${all ? '全ファイルの全一致箇所' : '各ファイルの最初の一致箇所'}を置換しますか？\n\n「${q}」→「${r}」`)) return;

  const caseSensitive = document.getElementById('sp-case').checked;
  const useRegex = document.getElementById('sp-regex').checked;
  const folderOnly = document.getElementById('sp-folder-only').checked;
  const searchPath = folderOnly ? _selectedSearchFolderPath() : '';

  // まず検索して対象ファイルを取得
  const params = new URLSearchParams({ q, case: caseSensitive, regex: useRegex, full_scan: '1' });
  if (searchPath) params.set('path', searchPath);
  const data = await apiFetch('/search?' + params.toString());
  if (data.error) {
    document.getElementById('sp-status').textContent = data.error;
    showStatus(data.error, true);
    return;
  }
  let totalCount = 0;
  const failures = [];

  for (const file of (data.results || [])) {
    try {
      const res = await apiPut('/replace', { path: file.path, search: q, replace: r, case: caseSensitive, regex: useRegex, all });
      totalCount += res.count || 0;
    } catch (e) {
      failures.push({ path: file.path, message: e.message || String(e) });
    }
  }

  const statusText = failures.length
    ? `${totalCount}箇所を置換しました。${failures.length}ファイルで失敗しました: ${failures.slice(0, 3).map(f => f.path).join(', ')}`
    : `${totalCount}箇所を置換しました`;
  showStatus(statusText, failures.length > 0);
  document.getElementById('sp-status').textContent = statusText;
  await doVaultSearch(); // 結果を更新
  document.getElementById('sp-status').textContent = statusText;

  // 開いているファイルを再読み込み（置換結果を反映）
  try {
    const lastView = JSON.parse(localStorage.getItem('lastView') || '{}');
    if (lastView.type === 'page' && lastView.path) openPage(lastView.label || '', lastView.path);
    else if ((lastView.type === 'scriptnote' || lastView.type === 'scenario') && lastView.path && typeof openScenarioInScriptNote === 'function') {
      openScenarioInScriptNote(lastView.path, lastView.label || lastView.path.split('/').pop().replace(/\.\w+$/, ''));
    }
    else if (lastView.type === 'entity' && lastView.entityPath) selectEntity(lastView.entityPath);
    else if ((lastView.type === 'pivot' || lastView.type === 'database') && lastView.dbPath && typeof selectDatabase === 'function') {
      await selectDatabase(lastView.dbPath, null, { skipNavPush: true, skipRecent: true, skipAutoVersion: true });
    }
  } catch {}
}

// フォルダツリーへのファイルD&D
