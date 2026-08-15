/* ==============================
   gb-tag-picker-panel.js — フィルタ・検索から開く「タグ選択」フロートパネル

   フィルタ（フォルダ表示）と検索（フォルダツリー上部・フォルダ表示の検索欄・
   コマンドパレット）の3系統・4か所から共通で開ける、条件用のタグ選択パネル。
   中身はタグ辞書全体の階層ツリーで、クリックのたびに条件のオン・オフが
   切り替わる（右パネルのタグツリーのようなファイルへの付け外しではない）。

   右パネルのタグツリー（gb-tag-management.js）とは別の実装。理由: 右パネル側は
   「開いているのは常に1本、そのファイルへの付け外し」というモジュール単位の
   状態を前提にしており、フロートパネルとタグタブを同時に開ける（意味が違う）
   要件と両立しない。表示に使う仕組み（複数列グリッド = .gb-tag-tree-grid /
   .gb-tag-tree-row、タグチップ = MeldexGlobalTags.createTagChip）とタグ階層の
   組み立てロジックは同一のものを直接使い、二重実装は避けている。

   骨組み（移動・8方向リサイズ・画面外補正・表示倍率対応・位置記憶・Escape・
   スマホのボトムシート化）は gb-float-panel-base.js を使う。
   ============================== */
(function () {
  'use strict';

  const PANEL_ID = 'gb-tag-picker-panel';
  const RECT_KEY = 'meldex:tag-picker-panel:rect:v1';
  const MIN_W = 260;
  const MIN_H = 280;
  const DEFAULT_W = 340;
  const DEFAULT_H = 460;
  const MARGIN = 8;
  const MOBILE_BREAKPOINT = 640;

  let _base = null;
  let _listEl = null;
  let _toolbarEl = null;
  let _titleEl = null;
  let _statusEl = null;

  // 現在パネルが向いているコンテキスト。開き直しのたびに丸ごと差し替える。
  let _ctx = {
    ownerKey: '',
    headerLabel: 'タグ',
    sourceFolder: '',
    existingTagIds: null, // Set<string> | null。指定時は含まれないタグを薄く表示
    tagIds: [],
    matchMode: 'all',
    onChange: null,
  };
  let _selected = new Set();
  let _catalog = { tags: [], groups: [] };
  let _loadRevision = 0;

  function icon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 14) : '';
  }

  function tagsApi() { return window.MeldexGlobalTags || null; }

  function compareTags(a, b) {
    return Number(a?.sort_index || 0) - Number(b?.sort_index || 0)
      || String(a?.name || '').localeCompare(String(b?.name || ''), 'ja');
  }

  // タグ辞書（フラットな tags[] + groups[]）を、既存のタグツリーと同じ
  // グループ階層＋未分類へ組み立てる。gb-tag-management.js の buildTreeData と
  // 同じ考え方（グループ→children/tags再帰構築、未分類は別枠）だが、こちら側は
  // フィルタ・選択状態を持たない単純な純関数として持つ（このパネル専用の
  // 読み取り専用ツリーのため、編集系状態と結合したくない）。
  function buildGroupTree(tags, groups) {
    const groupsById = Object.fromEntries((groups || []).map(g => [g.id, { ...g, children: [], tags: [] }]));
    const roots = [];
    (groups || []).forEach(g => {
      const node = groupsById[g.id];
      if (g.parent_id && groupsById[g.parent_id]) groupsById[g.parent_id].children.push(node);
      else roots.push(node);
    });
    const uncategorized = [];
    (tags || []).forEach(tag => {
      if (tag.group_id && groupsById[tag.group_id]) groupsById[tag.group_id].tags.push(tag);
      else uncategorized.push(tag);
    });
    const sortGroup = node => {
      node.children.sort(compareTags);
      node.tags.sort(compareTags);
      node.children.forEach(sortGroup);
    };
    roots.sort(compareTags);
    roots.forEach(sortGroup);
    uncategorized.sort(compareTags);
    return { roots, uncategorized, groupsById };
  }

  function isDimmed(tag) {
    if (!(_ctx.existingTagIds instanceof Set) || !_ctx.existingTagIds.size) return false;
    const id = String(tag?.id || '');
    const name = String(tag?.name || '').toLocaleLowerCase('ja');
    return !_ctx.existingTagIds.has(id) && !_ctx.existingTagIds.has(name);
  }

  function applyChipState(chip, tag) {
    const on = _selected.has(String(tag?.id || ''));
    chip.classList.toggle('gb-tag-tree-chip--condition-on', on);
    const label = chip.querySelector('.gb-tag-chip__label');
    label?.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function notifyChange() {
    if (typeof _ctx.onChange === 'function') {
      _ctx.onChange(Array.from(_selected), _ctx.matchMode);
    }
  }

  function toggleTag(tag, chip) {
    const id = String(tag?.id || '');
    if (!id) return;
    if (_selected.has(id)) _selected.delete(id);
    else _selected.add(id);
    if (chip) applyChipState(chip, tag);
    _renderStatus();
    notifyChange();
  }

  function renderTagRow(tag, groupsById) {
    const row = document.createElement('div');
    row.className = 'gb-tag-tree-row';
    row.dataset.tagTreeKind = 'tag';
    row.dataset.e2eId = 'tag-picker-tag-' + String(tag?.id || '').replace(/[^\p{L}\p{N}_-]+/gu, '-');
    const api = tagsApi();
    let chip = null;
    if (api?.createTagChip) {
      chip = api.createTagChip(tag, {
        groupsById,
        compact: true,
        className: 'gb-tag-tree-chip' + (isDimmed(tag) ? ' gb-tag-tree-chip--dim' : ''),
        title: tag?.name || '',
        onActivate: () => toggleTag(tag, chip),
        ariaLabel: (tag?.name || 'タグ') + 'を条件に含める',
      });
    }
    if (chip) {
      applyChipState(chip, tag);
      row.appendChild(chip);
    } else {
      const label = document.createElement('span');
      label.className = 'gb-tag-tree-label';
      label.textContent = tag?.name || '';
      row.appendChild(label);
    }
    return row;
  }

  function renderGroupSection(group, groupsById, depth) {
    const wrap = document.createElement('div');
    wrap.style.marginLeft = (depth * 12) + 'px';
    if (group) {
      const head = document.createElement('div');
      head.className = 'gb-tag-tree-row';
      head.dataset.tagTreeKind = 'group';
      const label = document.createElement('span');
      label.className = 'gb-tag-tree-label gb-tag-tree-label--colored';
      label.style.fontWeight = '600';
      const groupColor = /^#[0-9a-f]{6}$/i.test(String(group.color || '')) ? group.color : '';
      if (groupColor) label.style.setProperty('--gb-tag-color', groupColor);
      label.textContent = group.name || '';
      head.appendChild(label);
      wrap.appendChild(head);
    }
    const tags = group ? group.tags : null;
    if (tags && tags.length) {
      const grid = document.createElement('div');
      grid.className = 'gb-tag-tree-grid';
      grid.style.marginLeft = group ? '18px' : '0';
      tags.forEach(tag => grid.appendChild(renderTagRow(tag, groupsById)));
      wrap.appendChild(grid);
    }
    const children = group ? group.children : null;
    if (children && children.length) {
      const childrenBox = document.createElement('div');
      childrenBox.style.cssText = 'margin-left:18px;display:flex;flex-direction:column;gap:2px;';
      children.forEach(child => childrenBox.appendChild(renderGroupSection(child, groupsById, 0)));
      wrap.appendChild(childrenBox);
    }
    return wrap;
  }

  function _renderStatus() {
    if (!_statusEl) return;
    const count = _selected.size;
    _statusEl.textContent = count ? `${count}件選択中` : '未選択';
  }

  function _renderList() {
    if (!_listEl) return;
    _listEl.replaceChildren();
    const { roots, uncategorized, groupsById } = buildGroupTree(_catalog.tags, _catalog.groups);
    if (!_catalog.tags.length) {
      const empty = document.createElement('div');
      empty.className = 'gb-section-desc';
      empty.style.cssText = 'padding:12px;text-align:center;';
      empty.textContent = _loadRevision ? '（タグがありません）' : '読み込み中…';
      _listEl.appendChild(empty);
      return;
    }
    if (uncategorized.length) _listEl.appendChild(renderGroupSection({ name: '未分類', tags: uncategorized, children: [] }, groupsById, 0));
    roots.forEach(group => _listEl.appendChild(renderGroupSection(group, groupsById, 0)));
  }

  async function _loadCatalog() {
    const revision = ++_loadRevision;
    const api = tagsApi();
    if (!api?.loadTagsCached) return;
    try {
      const data = await api.loadTagsCached(_ctx.sourceFolder);
      if (revision !== _loadRevision) return;
      _catalog = { tags: Array.isArray(data?.tags) ? data.tags : [], groups: Array.isArray(data?.groups) ? data.groups : [] };
      _renderList();
    } catch (_) {
      if (revision !== _loadRevision) return;
      _renderList();
    }
  }

  function _setMode(mode) {
    _ctx.matchMode = mode === 'any' ? 'any' : 'all';
    _toolbarEl?.querySelectorAll('[data-tag-picker-mode]').forEach(btn => {
      const active = btn.dataset.tagPickerMode === _ctx.matchMode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    notifyChange();
  }

  function _buildToolbar(toolbar) {
    toolbar.className = 'gb-tag-picker-panel-toolbar';
    toolbar.dataset.e2eId = 'tag-picker-toolbar';
    const modeGroup = document.createElement('div');
    modeGroup.className = 'gb-tag-picker-mode-toggle';
    modeGroup.setAttribute('role', 'group');
    modeGroup.setAttribute('aria-label', 'タグの絞り込み条件');
    [['all', 'すべて含む'], ['any', 'どれかを含む']].forEach(([mode, label]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gb-tag-picker-mode-btn';
      btn.dataset.tagPickerMode = mode;
      btn.dataset.e2eId = 'tag-picker-mode-' + mode;
      btn.textContent = label;
      btn.addEventListener('click', () => _setMode(mode));
      modeGroup.appendChild(btn);
    });
    toolbar.appendChild(modeGroup);

    const status = document.createElement('span');
    status.className = 'gb-tag-picker-status';
    status.dataset.e2eId = 'tag-picker-status';
    toolbar.appendChild(status);
    _statusEl = status;

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'gb-btn gb-btn-sm gb-btn-quiet gb-tag-picker-clear-btn';
    clearBtn.dataset.e2eId = 'tag-picker-clear-all';
    clearBtn.textContent = 'すべて解除';
    clearBtn.addEventListener('click', () => {
      if (!_selected.size) return;
      _selected.clear();
      _renderList();
      _renderStatus();
      notifyChange();
    });
    toolbar.appendChild(clearBtn);
    _toolbarEl = toolbar;
  }

  function _buildHeader(header) {
    header.dataset.e2eId = 'tag-picker-float-panel-header';
    header.innerHTML = `
      <span class="gb-tag-picker-panel-icon"></span>
      <span class="gb-tag-picker-panel-title" data-e2e-id="tag-picker-float-panel-title"></span>
      <button type="button" class="gb-tag-picker-panel-btn" data-role="close"
              data-e2e-id="tag-picker-float-panel-close" title="閉じる" aria-label="閉じる"></button>
    `;
    header.querySelector('.gb-tag-picker-panel-icon').innerHTML = icon('tags', 16);
    header.querySelector('[data-role="close"]').innerHTML = icon('x', 14);
    header.querySelector('[data-role="close"]').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      close();
    });
    _titleEl = header.querySelector('.gb-tag-picker-panel-title');
  }

  function _buildBody(body) {
    const toolbar = document.createElement('div');
    _buildToolbar(toolbar);
    body.appendChild(toolbar);

    const list = document.createElement('div');
    list.className = 'gb-tag-picker-panel-list gb-tag-management-panel';
    list.setAttribute('role', 'tree');
    list.setAttribute('aria-label', 'タグ一覧');
    list.dataset.e2eId = 'tag-picker-list';
    body.appendChild(list);
    _listEl = list;
  }

  function _base_() {
    if (_base) return _base;
    _base = window.GBFloatPanelBase.create({
      id: PANEL_ID,
      className: 'gb-tag-picker-panel',
      dataE2eId: 'tag-picker-float-panel',
      ariaLabel: 'タグ選択',
      storageKey: RECT_KEY,
      minWidth: MIN_W,
      minHeight: MIN_H,
      defaultWidth: DEFAULT_W,
      defaultHeight: DEFAULT_H,
      margin: MARGIN,
      mobileSheet: true,
      mobileBreakpoint: MOBILE_BREAKPOINT,
      buildHeader: _buildHeader,
      buildBody: _buildBody,
      onClose: () => {
        _ctx.ownerKey = '';
        _listEl = null;
        _toolbarEl = null;
        _titleEl = null;
        _statusEl = null;
      },
    });
    return _base;
  }

  function _applyContext(options) {
    const opts = options || {};
    _ctx = {
      ownerKey: String(opts.ownerKey || ''),
      headerLabel: String(opts.headerLabel || 'タグ'),
      sourceFolder: String(opts.sourceFolder || ''),
      existingTagIds: opts.existingTagIds instanceof Set ? opts.existingTagIds : null,
      tagIds: Array.isArray(opts.tagIds) ? opts.tagIds.map(String) : [],
      matchMode: opts.matchMode === 'any' ? 'any' : 'all',
      onChange: typeof opts.onChange === 'function' ? opts.onChange : null,
    };
    _selected = new Set(_ctx.tagIds);
    if (_titleEl) _titleEl.textContent = _ctx.headerLabel;
    if (_toolbarEl) {
      _toolbarEl.querySelectorAll('[data-tag-picker-mode]').forEach(btn => {
        const active = btn.dataset.tagPickerMode === _ctx.matchMode;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }
    _renderStatus();
    _catalog = { tags: [], groups: [] };
    _loadRevision += 1;
    _renderList();
    _loadCatalog();
  }

  function isOpen() {
    return !!_base && _base.isOpen();
  }

  function currentOwnerKey() {
    return isOpen() ? _ctx.ownerKey : '';
  }

  // 同時に開くのは1つ。別の入口から開いたら対象を差し替えて開き直す。
  function open(options) {
    const base = _base_();
    const wasOpen = base.isOpen();
    base.open();
    _applyContext(options);
    if (!wasOpen) base.focus();
    return base.getElement();
  }

  function close() {
    return _base ? _base.close() : false;
  }

  function toggle(options) {
    if (isOpen() && currentOwnerKey() === String(options?.ownerKey || '')) {
      close();
      return false;
    }
    open(options);
    return true;
  }

  // 呼び出し元のトリガーボタンに開閉状態を反映する（クイックメモのレールボタンと
  // 同じパターン）。
  function syncTriggerButton(button, ownerKey) {
    if (!button) return;
    const active = isOpen() && currentOwnerKey() === String(ownerKey || '');
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  // ============================================================
  // 呼び出し元共通ヘルパー: 選択中タグのチップ表示（×で個別解除）
  // フィルタ側・検索3か所の計4箇所で同じ見せ方にするための共通部品。
  // ============================================================
  const _chipRowCatalogCache = new Map(); // sourceFolder -> {tags:[...]}

  async function _chipCatalog(sourceFolder) {
    const key = String(sourceFolder || '');
    if (_chipRowCatalogCache.has(key)) return _chipRowCatalogCache.get(key);
    const api = tagsApi();
    const data = api?.loadTagsCached ? await api.loadTagsCached(sourceFolder).catch(() => null) : null;
    const result = { tags: Array.isArray(data?.tags) ? data.tags : [] };
    _chipRowCatalogCache.set(key, result);
    return result;
  }

  function renderSelectedChips(container, options) {
    if (!container) return;
    const opts = options || {};
    const tagIds = Array.isArray(opts.tagIds) ? opts.tagIds.map(String) : [];
    container.replaceChildren();
    if (!tagIds.length) return;
    const api = tagsApi();
    const render = (tagsById) => {
      container.replaceChildren();
      tagIds.forEach(id => {
        const tag = tagsById.get(id) || { id, name: id };
        const chip = api?.createTagChip
          ? api.createTagChip(tag, {
            compact: true,
            className: 'gb-tag-picker-selected-chip',
            onRemove: () => { if (typeof opts.onRemove === 'function') opts.onRemove(id); },
            removeAriaLabel: (tag.name || 'タグ') + 'の条件を外す',
          })
          : null;
        if (chip) container.appendChild(chip);
      });
    };
    render(new Map(tagIds.map(id => [id, { id, name: id }])));
    _chipCatalog(opts.sourceFolder).then(data => {
      if (!container.isConnected) return;
      const tagsById = new Map((data.tags || []).map(tag => [String(tag.id || ''), tag]));
      render(tagsById);
    });
  }

  // フィルタ・検索の入口ボタン（「タグツリーから選ぶ」/検索欄横のタグアイコン）を
  // 共通の見た目で作る。フィルタ側は選択チップ（renderSelectedChips）で件数が
  // 分かるため、このボタン自体にはバッジを付けない。
  function createTriggerButton(options) {
    const opts = options || {};
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = opts.className || 'gb-btn gb-btn-sm gb-btn-icon';
    btn.title = opts.title || 'タグツリーから選ぶ';
    btn.setAttribute('aria-label', opts.title || 'タグツリーから選ぶ');
    if (opts.e2eId) btn.dataset.e2eId = opts.e2eId;
    btn.innerHTML = icon(opts.icon || 'listTree', 14);
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof opts.onOpen === 'function') opts.onOpen(btn);
    });
    return btn;
  }

  window.GBTagPickerPanel = Object.freeze({
    open,
    close,
    toggle,
    isOpen,
    currentOwnerKey,
    syncTriggerButton,
    renderSelectedChips,
    createTriggerButton,
  });
})();
