(function () {
  'use strict';

  // ========================================================================
  // タグ管理タブ (Eagle 風 Phase 1 MVP)
  //   - タググループの CRUD・階層（親子）
  //   - グループの折りたたみ・色付け
  //   - タグの作成・編集・削除・グループ移動
  //   - タグの項目検索 (結果は本タブ内に表示)
  //   - エクスプローラーがアクティブな時のみオプションパネル内に表示される
  // ========================================================================

  const UNCATEGORIZED_COLLAPSE_KEY = 'meldex-tag-management-uncategorized-collapsed';

  let _container = null;
  let _state = {
    tags: [],
    groups: [],
    loading: false,
    error: '',
    searchTag: null,
    searchResults: null,
  };
  // 現在開いているコンテキストメニューの外側クリックハンドラ解除関数
  let _activeMenuCleanup = null;

  // ========================================================================
  // 共通ユーティリティ
  // ========================================================================
  function api() { return window.MeldexGlobalTags || null; }
  function ic(name, size) { return typeof lucide === 'function' ? lucide(name, size || 14) : ''; }
  function esc(value) {
    if (typeof window.esc === 'function') return window.esc(value);
    return String(value == null ? '' : value).replace(/[&<>"]/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  }

  function isUncategorizedCollapsed() {
    try { return localStorage.getItem(UNCATEGORIZED_COLLAPSE_KEY) === '1'; } catch (_) { return false; }
  }
  function setUncategorizedCollapsed(v) {
    try { localStorage.setItem(UNCATEGORIZED_COLLAPSE_KEY, v ? '1' : '0'); } catch (_) {}
  }

  function reportError(err, fallback) {
    const msg = err && (err.userMessage || err.message) ? (err.userMessage || err.message) : (fallback || String(err || ''));
    if (typeof showStatus === 'function') showStatus(msg, true);
    return msg;
  }

  function confirmAsync(message) {
    if (typeof cfConfirm === 'function') return cfConfirm(message);
    return Promise.resolve(window.confirm(message));
  }

  function effectiveTagColor(tag, groupsById) {
    if (api() && typeof api().effectiveTagColor === 'function') return api().effectiveTagColor(tag, groupsById);
    if (tag && tag.group_id && groupsById && groupsById[tag.group_id]) {
      const gc = String(groupsById[tag.group_id].color || '').trim();
      if (/^#[0-9a-f]{6}$/i.test(gc)) return gc;
    }
    const own = String(tag && tag.color || '').trim();
    return /^#[0-9a-f]{6}$/i.test(own) ? own : 'var(--accent)';
  }

  // ========================================================================
  // データロード
  // ========================================================================
  async function fetchAll() {
    if (!api()) return;
    _state.loading = true;
    _state.error = '';
    try {
      const data = await api().loadTags();
      _state.tags = Array.isArray(data?.tags) ? data.tags : [];
      _state.groups = Array.isArray(data?.groups) ? data.groups : [];
    } catch (err) {
      _state.error = err && (err.userMessage || err.message) ? (err.userMessage || err.message) : String(err);
    } finally {
      _state.loading = false;
    }
  }

  // ========================================================================
  // ツリー構築
  // ========================================================================
  function buildTreeData() {
    const groupsById = Object.fromEntries(_state.groups.map(g => [g.id, { ...g, children: [], tags: [] }]));
    const roots = [];
    _state.groups.forEach(g => {
      const node = groupsById[g.id];
      if (g.parent_id && groupsById[g.parent_id]) groupsById[g.parent_id].children.push(node);
      else roots.push(node);
    });
    const uncategorized = [];
    _state.tags.forEach(tag => {
      if (tag.group_id && groupsById[tag.group_id]) groupsById[tag.group_id].tags.push(tag);
      else uncategorized.push(tag);
    });
    // ソート（name が欠落していても落ちないよう防御）
    const safeName = (v) => String(v == null ? '' : v);
    const sortNodes = (arr) => {
      arr.sort((a, b) => (a.sort_index || 0) - (b.sort_index || 0) || safeName(a.name).localeCompare(safeName(b.name), 'ja'));
      arr.forEach(n => sortNodes(n.children));
    };
    sortNodes(roots);
    Object.values(groupsById).forEach(n => n.tags.sort((a, b) => (a.sort_index || 0) - (b.sort_index || 0) || safeName(a.name).localeCompare(safeName(b.name), 'ja')));
    uncategorized.sort((a, b) => safeName(a.name).localeCompare(safeName(b.name), 'ja'));
    return { roots, uncategorized, groupsById };
  }

  // ========================================================================
  // レンダリング
  // ========================================================================
  function render() {
    if (!_container) return;
    _container.textContent = '';

    // ヘッダー (ツールバー)
    const header = document.createElement('div');
    header.className = 'gb-section';
    header.style.cssText = 'padding:8px;display:flex;flex-wrap:wrap;align-items:center;gap:6px;border-bottom:1px solid var(--border);';

    const addGroupBtn = document.createElement('button');
    addGroupBtn.type = 'button';
    addGroupBtn.className = 'gb-btn gb-btn-sm';
    addGroupBtn.innerHTML = ic('folder-plus', 14) + ' グループ追加';
    addGroupBtn.title = '新しいタググループを追加';
    addGroupBtn.addEventListener('click', () => onAddGroup(null));
    header.appendChild(addGroupBtn);

    const addTagBtn = document.createElement('button');
    addTagBtn.type = 'button';
    addTagBtn.className = 'gb-btn gb-btn-sm';
    addTagBtn.innerHTML = ic('plus', 14) + ' タグ追加';
    addTagBtn.title = '新しいタグを未分類に追加';
    addTagBtn.addEventListener('click', () => onAddTag(null));
    header.appendChild(addTagBtn);

    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'gb-btn gb-btn-sm gb-btn-quiet';
    refreshBtn.innerHTML = ic('refresh-cw', 14);
    refreshBtn.title = '再読み込み';
    refreshBtn.addEventListener('click', () => refresh());
    header.appendChild(refreshBtn);

    _container.appendChild(header);

    // 本体
    const body = document.createElement('div');
    body.style.cssText = 'padding:8px;';

    if (_state.loading) {
      const msg = document.createElement('div');
      msg.className = 'gb-section-desc';
      msg.textContent = 'タグを読み込んでいます…';
      body.appendChild(msg);
      _container.appendChild(body);
      return;
    }
    if (_state.error) {
      const msg = document.createElement('div');
      msg.className = 'gb-section-desc';
      msg.style.color = 'var(--danger)';
      msg.textContent = 'タグを読み込めませんでした: ' + _state.error;
      body.appendChild(msg);
      _container.appendChild(body);
      return;
    }

    const { roots, uncategorized, groupsById } = buildTreeData();

    // 未分類セクション (仮想グループ)
    body.appendChild(renderUncategorizedSection(uncategorized, groupsById));

    // ルートグループ群
    roots.forEach(node => body.appendChild(renderGroupNode(node, groupsById, 0)));

    if (!roots.length && !uncategorized.length) {
      const empty = document.createElement('div');
      empty.className = 'gb-section-desc';
      empty.style.cssText = 'margin-top:8px;text-align:center;';
      empty.textContent = 'タグがありません。「+ タグ追加」または「+ グループ追加」から始めてください。';
      body.appendChild(empty);
    }

    // 検索結果
    if (_state.searchResults != null) {
      body.appendChild(renderSearchResults());
    }

    _container.appendChild(body);
  }

  function renderUncategorizedSection(tags, groupsById) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:6px;';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:4px;padding:4px;border-radius:4px;cursor:pointer;';
    head.addEventListener('mouseenter', () => head.style.background = 'var(--bg3)');
    head.addEventListener('mouseleave', () => head.style.background = '');
    const collapsed = isUncategorizedCollapsed();
    const caret = document.createElement('span');
    caret.style.cssText = 'width:14px;display:inline-flex;justify-content:center;color:var(--fg2);';
    caret.innerHTML = ic(collapsed ? 'chevron-right' : 'chevron-down', 14);
    head.appendChild(caret);
    const label = document.createElement('span');
    label.style.cssText = 'flex:1;font-weight:600;color:var(--fg);';
    label.textContent = '未分類';
    head.appendChild(label);
    const count = document.createElement('span');
    count.className = 'gb-section-desc';
    count.textContent = tags.length + '件';
    head.appendChild(count);
    head.addEventListener('click', (e) => {
      // ボタンクリック以外でトグル
      if (e.target.closest('button')) return;
      setUncategorizedCollapsed(!collapsed);
      render();
    });
    // 「+ タグ」ボタン
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'gb-btn gb-btn-xs gb-btn-quiet';
    addBtn.innerHTML = ic('plus', 12);
    addBtn.title = '未分類にタグを追加';
    addBtn.addEventListener('click', (e) => { e.stopPropagation(); onAddTag(null); });
    head.appendChild(addBtn);
    wrap.appendChild(head);

    if (!collapsed) {
      const list = document.createElement('div');
      list.style.cssText = 'margin-left:18px;display:flex;flex-direction:column;gap:2px;';
      if (!tags.length) {
        const empty = document.createElement('div');
        empty.className = 'gb-section-desc';
        empty.style.cssText = 'padding:2px 4px;';
        empty.textContent = '（タグなし）';
        list.appendChild(empty);
      } else {
        tags.forEach(tag => list.appendChild(renderTagRow(tag, groupsById)));
      }
      wrap.appendChild(list);
    }
    return wrap;
  }

  function renderGroupNode(node, groupsById, depth) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-left:' + (depth * 12) + 'px;margin-bottom:2px;';

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:4px;padding:4px;border-radius:4px;cursor:pointer;';
    head.addEventListener('mouseenter', () => head.style.background = 'var(--bg3)');
    head.addEventListener('mouseleave', () => head.style.background = '');

    const caret = document.createElement('span');
    caret.style.cssText = 'width:14px;display:inline-flex;justify-content:center;color:var(--fg2);';
    caret.innerHTML = ic(node.collapsed ? 'chevron-right' : 'chevron-down', 14);
    head.appendChild(caret);

    const swatch = document.createElement('span');
    const groupColor = String(node.color || '').trim();
    swatch.style.cssText = 'width:10px;height:10px;border-radius:2px;border:1px solid var(--border);' +
      (/^#[0-9a-f]{6}$/i.test(groupColor) ? ('background:' + groupColor + ';') : 'background:var(--bg3);');
    head.appendChild(swatch);

    const label = document.createElement('span');
    label.style.cssText = 'flex:1;font-weight:600;color:var(--fg);';
    label.textContent = node.name;
    head.appendChild(label);

    const count = document.createElement('span');
    count.className = 'gb-section-desc';
    const totalTags = countTagsRecursive(node);
    count.textContent = totalTags + '件';
    head.appendChild(count);

    // アクションボタン群
    const actions = document.createElement('span');
    actions.style.cssText = 'display:inline-flex;gap:2px;';

    const addChildGroup = document.createElement('button');
    addChildGroup.type = 'button';
    addChildGroup.className = 'gb-btn gb-btn-xs gb-btn-quiet';
    addChildGroup.innerHTML = ic('folder-plus', 12);
    addChildGroup.title = 'サブグループを追加';
    addChildGroup.addEventListener('click', (e) => { e.stopPropagation(); onAddGroup(node.id); });
    actions.appendChild(addChildGroup);

    const addTagToGroup = document.createElement('button');
    addTagToGroup.type = 'button';
    addTagToGroup.className = 'gb-btn gb-btn-xs gb-btn-quiet';
    addTagToGroup.innerHTML = ic('plus', 12);
    addTagToGroup.title = 'このグループにタグを追加';
    addTagToGroup.addEventListener('click', (e) => { e.stopPropagation(); onAddTag(node.id); });
    actions.appendChild(addTagToGroup);

    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'gb-btn gb-btn-xs gb-btn-quiet';
    more.innerHTML = ic('more-horizontal', 12);
    more.title = 'グループの操作';
    more.addEventListener('click', (e) => { e.stopPropagation(); openGroupMenu(more, node); });
    actions.appendChild(more);
    head.appendChild(actions);

    head.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      toggleGroupCollapsed(node);
    });

    wrap.appendChild(head);

    if (!node.collapsed) {
      const childBox = document.createElement('div');
      childBox.style.cssText = 'margin-left:18px;display:flex;flex-direction:column;gap:2px;';
      // タグ
      node.tags.forEach(tag => childBox.appendChild(renderTagRow(tag, groupsById)));
      // 子グループ
      node.children.forEach(child => childBox.appendChild(renderGroupNode(child, groupsById, depth + 1)));
      // 空表示
      if (!node.tags.length && !node.children.length) {
        const empty = document.createElement('div');
        empty.className = 'gb-section-desc';
        empty.style.cssText = 'padding:2px 4px;';
        empty.textContent = '（空のグループ）';
        childBox.appendChild(empty);
      }
      wrap.appendChild(childBox);
    }
    return wrap;
  }

  function countTagsRecursive(node) {
    let n = (node.tags || []).length;
    (node.children || []).forEach(child => { n += countTagsRecursive(child); });
    return n;
  }

  function renderTagRow(tag, groupsById) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 4px;border-radius:4px;';
    row.addEventListener('mouseenter', () => row.style.background = 'var(--bg3)');
    row.addEventListener('mouseleave', () => row.style.background = '');

    const swatch = document.createElement('span');
    swatch.style.cssText = 'width:10px;height:10px;border-radius:50%;border:1px solid var(--border);';
    swatch.style.background = effectiveTagColor(tag, groupsById);

    const name = document.createElement('span');
    name.style.cssText = 'flex:1;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    name.textContent = tag.name || '';

    const count = document.createElement('span');
    count.className = 'gb-section-desc';
    if (typeof tag.source_count === 'number' && tag.source_count > 0) count.textContent = tag.source_count + '';

    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'gb-btn gb-btn-xs gb-btn-quiet';
    more.innerHTML = ic('more-horizontal', 12);
    more.title = 'タグの操作';
    more.addEventListener('click', (e) => { e.stopPropagation(); openTagMenu(more, tag); });

    row.append(swatch, name, count, more);
    return row;
  }

  function renderSearchResults() {
    const wrap = document.createElement('div');
    wrap.className = 'gb-section gb-section--boxed';
    wrap.style.cssText = 'margin-top:12px;';
    const title = document.createElement('div');
    title.className = 'gb-section-title';
    title.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:6px;';
    const label = document.createElement('span');
    const tagName = _state.searchTag?.name || _state.searchTag || '';
    const results = Array.isArray(_state.searchResults) ? _state.searchResults : [];
    label.innerHTML = ic('search', 14) + ' 「' + esc(tagName) + '」の項目（' + results.length + '件）';
    title.appendChild(label);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'gb-btn gb-btn-xs gb-btn-quiet';
    closeBtn.innerHTML = ic('x', 12);
    closeBtn.title = '結果を閉じる';
    closeBtn.addEventListener('click', () => {
      _state.searchTag = null;
      _state.searchResults = null;
      render();
    });
    title.appendChild(closeBtn);
    wrap.appendChild(title);
    if (!results.length) {
      const empty = document.createElement('div');
      empty.className = 'gb-section-desc';
      empty.style.cssText = 'margin-top:6px;';
      empty.textContent = '該当する項目はありません。';
      wrap.appendChild(empty);
    } else {
      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:2px;margin-top:6px;';
      results.slice(0, 200).forEach(item => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gb-btn gb-btn-sm gb-btn-quiet';
        btn.style.cssText = 'display:flex;justify-content:flex-start;align-items:center;gap:6px;text-align:left;width:100%;min-width:0;';
        if (typeof fileTypeIcon === 'function') {
          const iconWrap = document.createElement('span');
          iconWrap.innerHTML = fileTypeIcon(item.type || 'unknown', 14);
          iconWrap.style.flex = '0 0 auto';
          btn.appendChild(iconWrap);
        }
        const text = document.createElement('span');
        text.style.cssText = 'min-width:0;display:flex;flex-direction:column;gap:1px;';
        const itemName = document.createElement('span');
        itemName.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        itemName.textContent = item.name || item.path || '';
        const itemPath = document.createElement('span');
        itemPath.className = 'gb-section-desc';
        itemPath.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        itemPath.textContent = item.path || '';
        text.append(itemName, itemPath);
        btn.appendChild(text);
        btn.addEventListener('click', () => {
          if (api() && typeof api().openTaggedTarget === 'function') api().openTaggedTarget(item);
        });
        list.appendChild(btn);
      });
      if (results.length > 200) {
        const more = document.createElement('div');
        more.className = 'gb-section-desc';
        more.style.cssText = 'margin-top:4px;';
        more.textContent = 'ほか ' + (results.length - 200) + ' 件';
        list.appendChild(more);
      }
      wrap.appendChild(list);
    }
    return wrap;
  }

  // ========================================================================
  // 操作: グループ
  // ========================================================================
  async function toggleGroupCollapsed(node) {
    if (!api()) return;
    try {
      await api().updateGroup(node.id, { collapsed: !node.collapsed });
      await refresh();
    } catch (err) {
      reportError(err, 'グループを更新できませんでした');
    }
  }

  async function onAddGroup(parentId) {
    if (!api()) return;
    // ダイアログを出さず即作成 → インライン編集対応のために一旦は「無題」で作成
    try {
      let baseName = '無題のグループ';
      let name = baseName;
      let n = 2;
      const sameParent = _state.groups.filter(g => (g.parent_id || null) === (parentId || null));
      while (sameParent.some(g => g.name === name)) {
        name = baseName + ' ' + n;
        n += 1;
      }
      const res = await api().createGroup({ name, parent_id: parentId || null });
      if (res && res.groups) {
        _state.groups = res.groups;
        _state.tags = Array.isArray(res.tags) ? res.tags : _state.tags;
      } else {
        await refresh(false);
      }
      render();
      // 直後に名前変更プロンプトを開く（インライン入力代替）
      const created = res?.group;
      if (created) promptRenameGroup(created);
    } catch (err) {
      reportError(err, 'グループを追加できませんでした');
    }
  }

  function promptRenameGroup(group) {
    const next = window.prompt('グループ名', group.name || '');
    if (next == null) return;
    const trimmed = String(next).trim();
    if (!trimmed || trimmed === group.name) return;
    api().updateGroup(group.id, { name: trimmed }).then(() => refresh(false)).catch(err => reportError(err, 'グループ名を変更できませんでした'));
  }

  function promptColorGroup(group) {
    const current = String(group.color || '').trim() || '#00b894';
    const next = window.prompt('グループの色 (#RRGGBB / 空欄で解除)', current);
    if (next == null) return;
    const trimmed = String(next).trim();
    api().updateGroup(group.id, { color: trimmed }).then(() => refresh(false)).catch(err => reportError(err, '色を変更できませんでした'));
  }

  async function promptMoveGroup(group) {
    const options = [{ id: '', label: '（ルート）' }];
    _state.groups
      .filter(g => g.id !== group.id)
      .forEach(g => options.push({ id: g.id, label: groupPath(g) }));
    const lines = options.map((o, i) => (i + 1) + '. ' + o.label);
    const raw = window.prompt('移動先の親グループ番号を選んでください:\n' + lines.join('\n'), '');
    if (raw == null) return;
    const idx = parseInt(String(raw).trim(), 10) - 1;
    if (!(idx >= 0 && idx < options.length)) return;
    const target = options[idx].id || null;
    try {
      await api().updateGroup(group.id, { parent_id: target });
      await refresh();
    } catch (err) {
      reportError(err, 'グループを移動できませんでした');
    }
  }

  function groupPath(group) {
    const segs = [];
    let cur = group;
    const byId = Object.fromEntries(_state.groups.map(g => [g.id, g]));
    let safety = 32;
    while (cur && safety-- > 0) {
      segs.unshift(cur.name);
      cur = cur.parent_id ? byId[cur.parent_id] : null;
    }
    return segs.join(' / ');
  }

  async function onDeleteGroup(group) {
    const directTags = _state.tags.filter(t => t.group_id === group.id).length;
    const directChildren = _state.groups.filter(g => g.parent_id === group.id).length;
    const msg = '「' + group.name + '」を削除しますか？\n' +
      '・このグループ直下のタグ ' + directTags + '件 は未分類に戻ります。\n' +
      '・直下のサブグループ ' + directChildren + '個 は親階層に昇格します。';
    const ok = await confirmAsync(msg);
    if (!ok) return;
    try {
      await api().deleteGroup(group.id);
      await refresh();
    } catch (err) {
      reportError(err, 'グループを削除できませんでした');
    }
  }

  function openGroupMenu(anchor, group) {
    closeAnyMenu();
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu gb-tag-management-menu';
    menu.style.cssText = 'position:fixed;z-index:10000;background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:4px;min-width:160px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
    const items = [
      { icon: 'pencil', label: '名前を変更', action: () => promptRenameGroup(group) },
      { icon: 'palette', label: '色を変更', action: () => promptColorGroup(group) },
      { icon: 'move', label: '親グループを変更', action: () => promptMoveGroup(group) },
      { icon: 'trash-2', label: '削除', action: () => onDeleteGroup(group), danger: true },
    ];
    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'gb-context-menu-item';
      row.style.cssText = 'padding:6px 10px;cursor:pointer;display:flex;align-items:center;gap:6px;border-radius:3px;' +
        (item.danger ? 'color:var(--danger);' : '');
      row.innerHTML = ic(item.icon, 13) + ' ' + esc(item.label);
      row.addEventListener('mouseenter', () => row.style.background = 'var(--bg3)');
      row.addEventListener('mouseleave', () => row.style.background = '');
      row.addEventListener('click', () => { closeAnyMenu(); item.action(); });
      menu.appendChild(row);
    });
    document.body.appendChild(menu);
    if (typeof positionPopup === 'function') positionPopup(menu, anchor.getBoundingClientRect());
    else if (typeof clampPopupToViewport === 'function') {
      const r = anchor.getBoundingClientRect();
      menu.style.left = r.left + 'px';
      menu.style.top = (r.bottom + 4) + 'px';
      clampPopupToViewport(menu);
    }
    bindMenuOutsideClick(menu);
  }

  function bindMenuOutsideClick(menu) {
    // 既存の外側クリックハンドラを解除
    if (typeof _activeMenuCleanup === 'function') {
      try { _activeMenuCleanup(); } catch (_) {}
      _activeMenuCleanup = null;
    }
    setTimeout(() => {
      const onOut = (e) => { if (!menu.contains(e.target)) closeAnyMenu(); };
      document.addEventListener('mousedown', onOut, true);
      _activeMenuCleanup = () => document.removeEventListener('mousedown', onOut, true);
    }, 0);
  }

  function closeAnyMenu() {
    if (typeof _activeMenuCleanup === 'function') {
      try { _activeMenuCleanup(); } catch (_) {}
      _activeMenuCleanup = null;
    }
    document.querySelectorAll('.gb-tag-management-menu').forEach(el => el.remove());
  }

  // ========================================================================
  // 操作: タグ
  // ========================================================================
  async function onAddTag(groupId) {
    if (!api()) return;
    try {
      let baseName = '無題のタグ';
      let name = baseName;
      let n = 2;
      while (_state.tags.some(t => t.name === name)) {
        name = baseName + ' ' + n;
        n += 1;
      }
      const res = await api().createTag({ name, group_id: groupId || null });
      if (res && res.tags) {
        _state.tags = res.tags;
        _state.groups = Array.isArray(res.groups) ? res.groups : _state.groups;
      } else {
        await refresh(false);
      }
      render();
      const created = res?.tag;
      if (created) promptRenameTag(created);
    } catch (err) {
      reportError(err, 'タグを追加できませんでした');
    }
  }

  function promptRenameTag(tag) {
    const next = window.prompt('タグ名', tag.name || '');
    if (next == null) return;
    const trimmed = String(next).trim();
    if (!trimmed || trimmed === tag.name) return;
    api().updateTag(tag.id, { name: trimmed }).then(() => refresh(false)).catch(err => reportError(err, 'タグ名を変更できませんでした'));
  }

  async function promptMoveTag(tag) {
    const options = [{ id: '', label: '（未分類）' }];
    _state.groups.forEach(g => options.push({ id: g.id, label: groupPath(g) }));
    const lines = options.map((o, i) => (i + 1) + '. ' + o.label);
    const raw = window.prompt('移動先のグループ番号を選んでください:\n' + lines.join('\n'), '');
    if (raw == null) return;
    const idx = parseInt(String(raw).trim(), 10) - 1;
    if (!(idx >= 0 && idx < options.length)) return;
    const target = options[idx].id || null;
    try {
      await api().updateTag(tag.id, { group_id: target });
      await refresh();
    } catch (err) {
      reportError(err, 'タグを移動できませんでした');
    }
  }

  async function onDeleteTag(tag) {
    const ok = await confirmAsync('タグ「' + tag.name + '」を削除しますか？\nこのタグを付けたファイルからもタグが外れます。');
    if (!ok) return;
    try {
      await api().deleteTag(tag.id);
      await refresh();
    } catch (err) {
      reportError(err, 'タグを削除できませんでした');
    }
  }

  function openTagMenu(anchor, tag) {
    closeAnyMenu();
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu gb-tag-management-menu';
    menu.style.cssText = 'position:fixed;z-index:10000;background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:4px;min-width:180px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
    const items = [
      { icon: 'search', label: 'このタグの項目を検索', action: () => showSearchForTag(tag) },
      { icon: 'pencil', label: '名前を変更', action: () => promptRenameTag(tag) },
      { icon: 'move', label: 'グループを変更', action: () => promptMoveTag(tag) },
      { icon: 'trash-2', label: '削除', action: () => onDeleteTag(tag), danger: true },
    ];
    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'gb-context-menu-item';
      row.style.cssText = 'padding:6px 10px;cursor:pointer;display:flex;align-items:center;gap:6px;border-radius:3px;' +
        (item.danger ? 'color:var(--danger);' : '');
      row.innerHTML = ic(item.icon, 13) + ' ' + esc(item.label);
      row.addEventListener('mouseenter', () => row.style.background = 'var(--bg3)');
      row.addEventListener('mouseleave', () => row.style.background = '');
      row.addEventListener('click', () => { closeAnyMenu(); item.action(); });
      menu.appendChild(row);
    });
    document.body.appendChild(menu);
    if (typeof positionPopup === 'function') positionPopup(menu, anchor.getBoundingClientRect());
    else if (typeof clampPopupToViewport === 'function') {
      const r = anchor.getBoundingClientRect();
      menu.style.left = r.left + 'px';
      menu.style.top = (r.bottom + 4) + 'px';
      clampPopupToViewport(menu);
    }
    bindMenuOutsideClick(menu);
  }

  // ========================================================================
  // 検索
  // ========================================================================
  async function showSearchForTag(tag) {
    if (!api()) return;
    try {
      _state.searchTag = tag;
      _state.searchResults = [];
      render();
      const data = await api().searchByTag(tag);
      _state.searchResults = Array.isArray(data?.results) ? data.results : [];
      render();
    } catch (err) {
      _state.searchResults = [];
      reportError(err, 'タグ検索に失敗しました');
      render();
    }
  }

  // ========================================================================
  // ライフサイクル
  // ========================================================================
  async function refresh(showLoading) {
    if (showLoading !== false) {
      _state.loading = true;
      render();
    }
    await fetchAll();
    render();
  }

  function renderTagManagementTab(container) {
    _container = container || null;
    if (!_container) return;
    // 初回は「読み込み中」を出してフェッチ完了後に一度だけ描画する。
    // 空の _state でレンダリングして「タグがありません」が一瞬出る挙動を避ける。
    if (!_state.tags.length && !_state.groups.length && !_state.error) {
      _state.loading = true;
      render();
      refresh(false);
    } else {
      render();
      refresh(false);
    }
  }

  // ========================================================================
  // エクスポート
  // ========================================================================
  window.renderTagManagementTab = renderTagManagementTab;
  window.MeldexTagManagement = {
    render: () => render(),
    refresh: refresh,
    showSearchForTag,
    setContainer: (c) => { _container = c; },
  };
})();
