(function () {
  'use strict';

  // Eagle風タグ管理: 階層ツリー、複数選択、D&D、プリセット、タグ検索/フォルダ絞り込み。
  const UNCATEGORIZED_COLLAPSE_KEY = 'meldex-tag-management-uncategorized-collapsed';
  const DRAG_MIME = 'application/x-meldex-tag-tree';

  let _container = null;
  let _activeMenuCleanup = null;
  let _activeMenuTrigger = null;
  let _activeMenuId = 0;
  let _dragRows = [];
  let _state = {
    tags: [],
    groups: [],
    presets: [],
    activePresetId: '',
    loading: false,
    error: '',
    selectedKeys: [],
    anchorKey: '',
    flatRows: [],
    searchTag: null,
    searchResults: null,
  };

  function api() { return window.MeldexGlobalTags || null; }
  function ic(name, size) { return typeof lucide === 'function' ? lucide(name, size || 14) : ''; }
  function esc(value) {
    if (typeof window.esc === 'function') return window.esc(value);
    return String(value == null ? '' : value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }
  function rowKey(kind, id) { return String(kind || '') + ':' + String(id || ''); }
  function safeKeyPart(value) { return String(value || '').replace(/[^\p{L}\p{N}_:-]+/gu, '-').replace(/^-+|-+$/g, '') || 'item'; }
  function selectedSet() { return new Set(_state.selectedKeys || []); }
  function isSelected(key) { return selectedSet().has(key); }
  function focusTrigger(el) {
    if (typeof focusMeldexDropdownTrigger === 'function') focusMeldexDropdownTrigger(el);
    else if (el?.focus) {
      try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
    }
  }
  function forceTriggerFocus(el) {
    if (!el?.isConnected || typeof el.focus !== 'function') return;
    try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
  }
  function cssZoom() {
    try { return typeof _getZoom === 'function' ? (_getZoom() || 1) : 1; } catch (_) { return 1; }
  }
  function isUncategorizedCollapsed() {
    try { return localStorage.getItem(UNCATEGORIZED_COLLAPSE_KEY) === '1'; } catch (_) { return false; }
  }
  function setUncategorizedCollapsed(value) {
    try { localStorage.setItem(UNCATEGORIZED_COLLAPSE_KEY, value ? '1' : '0'); } catch (_) {}
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
  function promptAsync(message, value) {
    if (typeof cfPrompt === 'function') return cfPrompt(message, value || '');
    return Promise.resolve(window.prompt(message, value || ''));
  }
  function effectiveTagColor(tag, groupsById) {
    if (api() && typeof api().effectiveTagColor === 'function') return api().effectiveTagColor(tag, groupsById);
    const groupColor = tag?.group_id && groupsById?.[tag.group_id]?.color ? String(groupsById[tag.group_id].color).trim() : '';
    const own = String(tag?.color || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(groupColor)) return groupColor;
    return /^#[0-9a-f]{6}$/i.test(own) ? own : 'var(--accent)';
  }

  async function fetchAll() {
    if (!api()) return;
    _state.loading = true;
    _state.error = '';
    try {
      const [tagData, presetData] = await Promise.all([
        api().loadTags(),
        api().loadPresets ? api().loadPresets() : Promise.resolve({ presets: [] }),
      ]);
      _state.tags = Array.isArray(tagData?.tags) ? tagData.tags : [];
      _state.groups = Array.isArray(tagData?.groups) ? tagData.groups : [];
      _state.presets = Array.isArray(presetData?.presets) ? presetData.presets : [];
      _state.activePresetId = presetData?.active_preset_id || presetData?.activePresetId || '';
      pruneSelection();
    } catch (err) {
      _state.error = err && (err.userMessage || err.message) ? (err.userMessage || err.message) : String(err);
    } finally {
      _state.loading = false;
    }
  }

  function buildTreeData() {
    const groupsById = Object.fromEntries(_state.groups.map(group => [group.id, { ...group, children: [], tags: [] }]));
    const roots = [];
    _state.groups.forEach(group => {
      const node = groupsById[group.id];
      if (group.parent_id && groupsById[group.parent_id]) groupsById[group.parent_id].children.push(node);
      else roots.push(node);
    });
    const uncategorized = [];
    _state.tags.forEach(tag => {
      if (tag.group_id && groupsById[tag.group_id]) groupsById[tag.group_id].tags.push(tag);
      else uncategorized.push(tag);
    });
    const sortByIndexName = (a, b) => (a.sort_index || 0) - (b.sort_index || 0)
      || String(a.name || '').localeCompare(String(b.name || ''), 'ja');
    const sortGroup = node => {
      node.children.sort(sortByIndexName);
      node.tags.sort(sortByIndexName);
      node.children.forEach(sortGroup);
    };
    roots.sort(sortByIndexName);
    roots.forEach(sortGroup);
    uncategorized.sort(sortByIndexName);
    return { roots, uncategorized, groupsById };
  }

  function flattenTree(roots, uncategorized) {
    const rows = [];
    if (!isUncategorizedCollapsed()) {
      uncategorized.forEach(tag => rows.push({ key: rowKey('tag', tag.id), kind: 'tag', item: tag }));
    }
    const walk = group => {
      rows.push({ key: rowKey('group', group.id), kind: 'group', item: group });
      if (group.collapsed) return;
      group.tags.forEach(tag => rows.push({ key: rowKey('tag', tag.id), kind: 'tag', item: tag }));
      group.children.forEach(walk);
    };
    roots.forEach(walk);
    _state.flatRows = rows;
    return rows;
  }

  function pruneSelection() {
    const valid = new Set([
      ..._state.tags.map(tag => rowKey('tag', tag.id)),
      ..._state.groups.map(group => rowKey('group', group.id)),
    ]);
    _state.selectedKeys = (_state.selectedKeys || []).filter(key => valid.has(key));
    if (!valid.has(_state.anchorKey)) _state.anchorKey = _state.selectedKeys[0] || '';
  }

  function selectedRows() {
    const byKey = new Map([
      ..._state.tags.map(tag => [rowKey('tag', tag.id), { kind: 'tag', id: tag.id, item: tag }]),
      ..._state.groups.map(group => [rowKey('group', group.id), { kind: 'group', id: group.id, item: group }]),
    ]);
    return (_state.selectedKeys || []).map(key => byKey.get(key)).filter(Boolean);
  }

  function setSelectionFromEvent(event, key) {
    const keys = (_state.flatRows || []).map(row => row.key);
    if (event?.shiftKey && _state.anchorKey && keys.includes(_state.anchorKey) && keys.includes(key)) {
      const start = keys.indexOf(_state.anchorKey);
      const end = keys.indexOf(key);
      const [from, to] = start < end ? [start, end] : [end, start];
      const base = (event.ctrlKey || event.metaKey) ? selectedSet() : new Set();
      keys.slice(from, to + 1).forEach(itemKey => base.add(itemKey));
      _state.selectedKeys = Array.from(base);
    } else if (event?.ctrlKey || event?.metaKey) {
      const set = selectedSet();
      if (set.has(key)) set.delete(key);
      else set.add(key);
      _state.selectedKeys = Array.from(set);
      _state.anchorKey = key;
    } else {
      _state.selectedKeys = [key];
      _state.anchorKey = key;
    }
  }

  function applyTagFilter(tag) {
    if (!tag) return;
    if (typeof applyFolderTagFilter === 'function' && applyFolderTagFilter(tag) !== false) {
      if (typeof showStatus === 'function') showStatus('タグで絞り込み: ' + (tag.name || ''));
      return;
    }
    showSearchForTag(tag);
  }

  function render() {
    if (!_container) return;
    _container.classList.add('gb-tag-management-panel');
    _container.setAttribute('aria-label', 'タグ管理');
    _container.textContent = '';
    _container.style.display = 'flex';
    _container.style.flexDirection = 'column';
    _container.style.minHeight = '0';

    _container.appendChild(renderHeader());

    const body = document.createElement('div');
    body.className = 'gb-tag-management-body';
    body.style.cssText = 'flex:1;min-height:0;overflow:auto;padding:8px;';
    if (_state.loading) {
      body.innerHTML = '<div class="gb-section-desc" style="padding:12px;">タグを読み込んでいます...</div>';
      _container.appendChild(body);
      return;
    }
    if (_state.error) {
      body.innerHTML = '<div class="gb-section-desc" style="padding:12px;color:var(--danger);">タグを読み込めませんでした: ' + esc(_state.error) + '</div>';
      _container.appendChild(body);
      return;
    }

    const { roots, uncategorized, groupsById } = buildTreeData();
    flattenTree(roots, uncategorized);
    body.appendChild(renderBulkBar());
    body.appendChild(renderUncategorizedSection(uncategorized, groupsById));
    roots.forEach(group => body.appendChild(renderGroupNode(group, groupsById, 0)));
    bindDropTarget(body, null, 'root');

    if (!roots.length && !uncategorized.length) {
      const empty = document.createElement('div');
      empty.className = 'gb-section gb-section--boxed gb-tag-empty';
      empty.style.cssText = 'padding:10px;margin-top:8px;color:var(--fg2);font-size:12px;';
      empty.textContent = 'タグがありません。タグを追加するか、標準タグ集プリセットを読み込んでください。';
      body.appendChild(empty);
    }
    if (_state.searchResults != null) body.appendChild(renderSearchResults());
    _container.appendChild(body);
  }

  function renderHeader() {
    const header = document.createElement('div');
    header.className = 'gb-section gb-tag-management-header';
    header.style.cssText = 'padding:8px;display:flex;flex-direction:column;gap:6px;border-bottom:1px solid var(--border);flex-shrink:0;';

    const top = document.createElement('div');
    top.style.cssText = 'display:flex;align-items:center;gap:6px;';
    const title = document.createElement('div');
    title.className = 'gb-section-title';
    title.style.cssText = 'flex:1;min-width:0;display:flex;align-items:center;gap:6px;';
    title.innerHTML = ic('tags', 15) + '<span>タグ</span>';
    top.appendChild(title);
    const refreshBtn = iconButton('refresh-cw', '再読み込み', () => refresh(), '', 'tag-management-refresh');
    top.appendChild(refreshBtn);
    header.appendChild(top);

    const presetRow = document.createElement('div');
    presetRow.className = 'gb-tag-management-preset-row';
    presetRow.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) repeat(5,28px);gap:4px;align-items:center;';
    const presetSelect = document.createElement('select');
    presetSelect.className = 'gb-select gb-tag-management-preset-select';
    presetSelect.style.cssText = 'min-width:0;font-size:12px;padding:3px 6px;';
    presetSelect.dataset.e2eId = 'tag-management-preset-select';
    presetSelect.dataset.tagManagementRole = 'preset-select';
    presetSelect.setAttribute('aria-label', 'タグプリセットを選択');
    if (!_state.presets.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'プリセットなし';
      presetSelect.appendChild(option);
    } else {
      _state.presets.forEach(preset => {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = (preset.builtin ? '標準: ' : '') + preset.name;
        presetSelect.appendChild(option);
      });
      presetSelect.value = _state.activePresetId || (_state.presets[0]?.id || '');
    }
    presetSelect.title = 'タグプリセットを選択して読み込み';
    presetSelect.addEventListener('change', () => {
      if (presetSelect.value) loadPreset(presetSelect.value);
    });
    presetRow.appendChild(presetSelect);
    presetRow.appendChild(iconButton('plus', 'プリセットを追加', onAddPreset, '', 'tag-management-preset-add'));
    presetRow.appendChild(iconButton('copy', 'プリセットを複製', () => onDuplicatePreset(presetSelect.value), '', 'tag-management-preset-duplicate'));
    presetRow.appendChild(iconButton('save', '現在のタグツリーをプリセットへ保存', () => onSavePreset(presetSelect.value), '', 'tag-management-preset-save'));
    presetRow.appendChild(iconButton('download', 'プリセットを読み込み', () => presetSelect.value && loadPreset(presetSelect.value), '', 'tag-management-preset-load'));
    presetRow.appendChild(iconButton('trash-2', 'プリセットを削除', () => onDeletePreset(presetSelect.value), 'danger', 'tag-management-preset-delete'));
    header.appendChild(presetRow);

    const actionRow = document.createElement('div');
    actionRow.className = 'gb-tag-management-action-row';
    actionRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
    actionRow.appendChild(textButton('グループ追加', 'folder-plus', () => onAddGroup(null), 'tag-management-add-group'));
    actionRow.appendChild(textButton('タグ追加', 'plus', () => onAddTag(null), 'tag-management-add-tag'));
    actionRow.appendChild(textButton('現在のフォルダを自動タグ付け', 'sparkles', () => runAutoTagForCurrentFolder(), 'tag-management-auto-tag-folder'));
    header.appendChild(actionRow);
    return header;
  }

  function textButton(label, icon, onClick, role) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gb-btn gb-btn-sm gb-tag-text-btn';
    btn.innerHTML = ic(icon, 13) + ' ' + esc(label);
    btn.setAttribute('aria-label', label);
    if (role) {
      btn.dataset.e2eId = role;
      btn.dataset.tagManagementRole = role;
    }
    btn.addEventListener('click', onClick);
    return btn;
  }

  function iconButton(icon, title, onClick, tone, role, options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gb-btn gb-btn-xs gb-btn-quiet gb-btn-icon gb-tag-icon-btn';
    btn.style.cssText = 'min-width:28px;min-height:26px;padding:2px 6px;' + (tone === 'danger' ? 'color:var(--danger);' : '');
    btn.innerHTML = ic(icon, 13);
    btn.title = title;
    btn.setAttribute('aria-label', title);
    if (role) {
      btn.dataset.e2eId = role;
      btn.dataset.tagManagementRole = role;
    }
    if (options?.menu) {
      btn.setAttribute('aria-haspopup', 'menu');
      btn.setAttribute('aria-expanded', 'false');
    }
    btn.addEventListener('click', event => { event.stopPropagation(); onClick(event); });
    return btn;
  }

  function renderBulkBar() {
    const bar = document.createElement('div');
    const count = _state.selectedKeys.length;
    bar.className = 'gb-tag-bulk-bar';
    bar.dataset.e2eId = 'tag-management-bulk-bar';
    bar.style.cssText = 'display:' + (count > 1 ? 'flex' : 'none') + ';align-items:center;gap:6px;margin-bottom:8px;padding:6px;background:var(--bg3);border:1px solid var(--border);border-radius:6px;';
    const label = document.createElement('span');
    label.style.cssText = 'flex:1;font-size:12px;color:var(--fg2);';
    label.textContent = count + '件選択中';
    bar.appendChild(label);
    bar.appendChild(textButton('削除', 'trash-2', onDeleteSelected, 'tag-management-bulk-delete'));
    bar.appendChild(textButton('選択解除', 'x', () => { _state.selectedKeys = []; render(); }, 'tag-management-bulk-clear'));
    return bar;
  }

  function renderUncategorizedSection(tags, groupsById) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:6px;';
    const collapsed = isUncategorizedCollapsed();
    const head = treeRowBase('group', rowKey('group', '__uncategorized__'), 0);
    head.draggable = false;
    const caret = iconButton(collapsed ? 'chevron-right' : 'chevron-down', collapsed ? '展開' : '折りたたみ', () => {
      setUncategorizedCollapsed(!collapsed);
      render();
    }, '', 'tag-management-uncategorized-toggle');
    caret.style.minWidth = '22px';
    head.appendChild(caret);
    const swatch = document.createElement('span');
    swatch.style.cssText = 'width:10px;height:10px;border-radius:2px;border:1px solid var(--border);background:var(--bg3);';
    head.appendChild(swatch);
    head.appendChild(rowLabel('未分類', true));
    head.appendChild(rowCount(tags.length));
    head.appendChild(iconButton('plus', '未分類にタグを追加', () => onAddTag(null), '', 'tag-management-uncategorized-add-tag'));
    bindDropTarget(head, null, 'root');
    wrap.appendChild(head);
    if (!collapsed) {
      const box = document.createElement('div');
      box.style.cssText = 'margin-left:18px;display:flex;flex-direction:column;gap:2px;';
      if (!tags.length) box.appendChild(emptyRow('タグなし'));
      tags.forEach(tag => box.appendChild(renderTagRow(tag, groupsById, 0)));
      wrap.appendChild(box);
    }
    return wrap;
  }

  function renderGroupNode(group, groupsById, depth) {
    const wrap = document.createElement('div');
    wrap.style.marginLeft = (depth * 12) + 'px';
    const key = rowKey('group', group.id);
    const head = treeRowBase('group', key, depth);
    head.appendChild(iconButton(group.collapsed ? 'chevron-right' : 'chevron-down', group.collapsed ? '展開' : '折りたたみ', () => toggleGroupCollapsed(group), '', 'tag-management-group-toggle-' + safeKeyPart(group.id)));
    const swatch = document.createElement('span');
    const color = String(group.color || '').trim();
    swatch.style.cssText = 'width:10px;height:10px;border-radius:2px;border:1px solid var(--border);' + (/^#[0-9a-f]{6}$/i.test(color) ? 'background:' + color + ';' : 'background:var(--bg3);');
    head.appendChild(swatch);
    head.appendChild(rowLabel(group.name, true));
    head.appendChild(rowCount(countTagsRecursive(group)));
    head.appendChild(iconButton('folder-plus', 'サブグループを追加', () => onAddGroup(group.id), '', 'tag-management-group-add-group-' + safeKeyPart(group.id)));
    head.appendChild(iconButton('plus', 'このグループにタグを追加', () => onAddTag(group.id), '', 'tag-management-group-add-tag-' + safeKeyPart(group.id)));
    head.appendChild(iconButton('more-horizontal', 'グループの操作', event => openGroupMenu(event.currentTarget, group), '', 'tag-management-group-menu-' + safeKeyPart(group.id), { menu: true }));
    head.addEventListener('click', event => {
      if (event.target.closest('button')) return;
      setSelectionFromEvent(event, key);
      render();
    });
    bindRowKeyboard(head, event => {
      setSelectionFromEvent(event, key);
      render();
    }, event => openGroupMenu(event.currentTarget, group));
    bindRowMenu(head, event => openGroupMenu(event.currentTarget, group));
    bindDragSource(head, 'group', group.id);
    bindDropTarget(head, group.id, 'group');
    wrap.appendChild(head);
    if (!group.collapsed) {
      const box = document.createElement('div');
      box.style.cssText = 'margin-left:18px;display:flex;flex-direction:column;gap:2px;';
      group.tags.forEach(tag => box.appendChild(renderTagRow(tag, groupsById, depth + 1)));
      group.children.forEach(child => box.appendChild(renderGroupNode(child, groupsById, depth + 1)));
      if (!group.tags.length && !group.children.length) box.appendChild(emptyRow('空のグループ'));
      wrap.appendChild(box);
    }
    return wrap;
  }

  function renderTagRow(tag, groupsById) {
    const key = rowKey('tag', tag.id);
    const row = treeRowBase('tag', key, 0);
    const swatch = document.createElement('span');
    swatch.style.cssText = 'width:10px;height:10px;border-radius:50%;border:1px solid var(--border);background:' + effectiveTagColor(tag, groupsById) + ';';
    const indent = document.createElement('span');
    indent.style.cssText = 'display:inline-block;flex:0 0 24px;width:24px;';
    row.appendChild(indent);
    row.appendChild(swatch);
    row.appendChild(rowLabel(tag.name || '', false));
    row.appendChild(rowCount(typeof tag.source_count === 'number' && tag.source_count > 0 ? tag.source_count : ''));
    row.appendChild(iconButton('more-horizontal', 'タグの操作', event => openTagMenu(event.currentTarget, tag), '', 'tag-management-tag-menu-' + safeKeyPart(tag.id), { menu: true }));
    row.addEventListener('click', event => {
      if (event.target.closest('button')) return;
      setSelectionFromEvent(event, key);
      if (!event.ctrlKey && !event.metaKey && !event.shiftKey) applyTagFilter(tag);
      render();
    });
    bindRowKeyboard(row, event => {
      setSelectionFromEvent(event, key);
      if (!event.ctrlKey && !event.metaKey && !event.shiftKey) applyTagFilter(tag);
      render();
    }, event => openTagMenu(event.currentTarget, tag));
    bindRowMenu(row, event => openTagMenu(event.currentTarget, tag));
    bindDragSource(row, 'tag', tag.id);
    return row;
  }

  function treeRowBase(kind, key) {
    const row = document.createElement('div');
    row.className = 'gb-tag-tree-row';
    row.dataset.tagTreeKey = key;
    row.dataset.tagTreeKind = kind;
    row.dataset.e2eId = 'tag-management-row-' + safeKeyPart(key);
    row.setAttribute('role', 'treeitem');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-selected', isSelected(key) ? 'true' : 'false');
    row.style.cssText = 'display:flex;align-items:center;gap:5px;min-height:28px;padding:2px 4px;border-radius:5px;cursor:pointer;user-select:none;';
    if (isSelected(key)) {
      row.style.background = 'rgba(86,156,214,0.22)';
      row.style.outline = '1px solid rgba(86,156,214,0.55)';
    }
    row.addEventListener('mouseenter', () => { if (!isSelected(key)) row.style.background = 'var(--bg3)'; });
    row.addEventListener('mouseleave', () => { if (!isSelected(key)) row.style.background = ''; });
    return row;
  }

  function bindRowKeyboard(row, activate, openMenuForRow) {
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        activate(event);
      } else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
        event.preventDefault();
        event.stopPropagation();
        openMenuForRow(event);
      }
    });
  }

  function bindRowMenu(row, openMenuForRow) {
    row.addEventListener('contextmenu', event => {
      if (event.target?.closest?.('button')) return;
      event.preventDefault();
      event.stopPropagation();
      openMenuForRow(event);
    });
    if (typeof addLongPressHandler === 'function') {
      addLongPressHandler(row, event => {
        if (event.target?.closest?.('button')) return;
        event.preventDefault?.();
        event.stopPropagation?.();
        openMenuForRow(event);
      });
    }
  }

  function rowLabel(text, strong) {
    const label = document.createElement('span');
    label.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg);' + (strong ? 'font-weight:600;' : '');
    label.textContent = text || '';
    label.title = text || '';
    return label;
  }

  function rowCount(value) {
    const count = document.createElement('span');
    count.className = 'gb-section-desc';
    count.style.cssText = 'min-width:18px;text-align:right;';
    count.textContent = value == null ? '' : String(value);
    return count;
  }

  function emptyRow(text) {
    const div = document.createElement('div');
    div.className = 'gb-section-desc';
    div.style.cssText = 'padding:4px 8px;';
    div.textContent = '（' + text + '）';
    return div;
  }

  function countTagsRecursive(group) {
    let count = (group.tags || []).length;
    (group.children || []).forEach(child => { count += countTagsRecursive(child); });
    return count;
  }

  function bindDragSource(row, kind, id) {
    row.draggable = true;
    row.addEventListener('dragstart', event => {
      const key = rowKey(kind, id);
      if (!isSelected(key)) {
        _state.selectedKeys = [key];
        _state.anchorKey = key;
      }
      _dragRows = selectedRows().map(item => ({ kind: item.kind, id: item.id }));
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(DRAG_MIME, JSON.stringify({ items: _dragRows }));
      event.dataTransfer.setData('text/plain', _dragRows.map(item => item.id).join(','));
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      _dragRows = [];
      row.classList.remove('dragging');
      document.querySelectorAll('.gb-tag-tree-row.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
    });
  }

  function bindDropTarget(el, targetGroupId, targetKind) {
    el.addEventListener('dragover', event => {
      const items = readDragItems(event);
      if (!items.length) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      el.classList.add('is-drop-target');
      el.style.boxShadow = 'inset 0 0 0 1px var(--accent)';
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('is-drop-target');
      el.style.boxShadow = '';
    });
    el.addEventListener('drop', async event => {
      const items = readDragItems(event);
      if (!items.length) return;
      event.preventDefault();
      event.stopPropagation();
      el.classList.remove('is-drop-target');
      el.style.boxShadow = '';
      await moveItemsToGroup(items, targetGroupId || null, targetKind);
    });
  }

  function readDragItems(event) {
    try {
      const raw = event?.dataTransfer?.getData?.(DRAG_MIME) || '';
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed?.items)) return parsed.items;
    } catch (_) {}
    return _dragRows || [];
  }

  async function moveItemsToGroup(items, targetGroupId) {
    if (!api()) return;
    let moved = 0;
    let failed = 0;
    const unique = [];
    const seen = new Set();
    (items || []).forEach(item => {
      const key = rowKey(item.kind, item.id);
      if (!item.kind || !item.id || seen.has(key)) return;
      seen.add(key);
      unique.push(item);
    });
    for (const item of unique) {
      try {
        if (item.kind === 'tag') {
          await api().updateTag(item.id, { group_id: targetGroupId || null });
          moved += 1;
        } else if (item.kind === 'group' && item.id !== targetGroupId) {
          await api().updateGroup(item.id, { parent_id: targetGroupId || null });
          moved += 1;
        }
      } catch (_) {
        failed += 1;
      }
    }
    await refresh(false);
    if (typeof showStatus === 'function') {
      const suffix = failed ? '（' + failed + '件失敗）' : '';
      showStatus(moved ? moved + '件の所属階層を移動しました' + suffix : '移動できるタグがありません', failed > 0 && moved === 0);
    }
  }

  async function toggleGroupCollapsed(group) {
    try {
      await api().updateGroup(group.id, { collapsed: !group.collapsed });
      await refresh(false);
    } catch (err) {
      reportError(err, 'グループを更新できませんでした');
    }
  }

  async function onAddGroup(parentId) {
    try {
      const name = await promptAsync('グループ名', uniqueName('新しいグループ', _state.groups.filter(g => (g.parent_id || null) === (parentId || null)).map(g => g.name)));
      if (!String(name || '').trim()) return;
      await api().createGroup({ name: String(name).trim(), parent_id: parentId || null });
      await refresh(false);
    } catch (err) {
      reportError(err, 'グループを追加できませんでした');
    }
  }

  async function onAddTag(groupId) {
    try {
      const name = await promptAsync('タグ名', uniqueName('新しいタグ', _state.tags.map(t => t.name)));
      if (!String(name || '').trim()) return;
      await api().createTag({ name: String(name).trim(), group_id: groupId || null });
      await refresh(false);
    } catch (err) {
      reportError(err, 'タグを追加できませんでした');
    }
  }

  function uniqueName(base, names) {
    const used = new Set((names || []).map(name => String(name || '').toLowerCase()));
    let name = base;
    let index = 2;
    while (used.has(name.toLowerCase())) {
      name = base + ' ' + index;
      index += 1;
    }
    return name;
  }

  async function promptRenameGroup(group) {
    const next = await promptAsync('グループ名', group.name || '');
    const trimmed = String(next || '').trim();
    if (!trimmed || trimmed === group.name) return;
    try { await api().updateGroup(group.id, { name: trimmed }); await refresh(false); }
    catch (err) { reportError(err, 'グループ名を変更できませんでした'); }
  }

  async function promptColorGroup(group) {
    const next = await promptAsync('グループの色 (#RRGGBB / 空欄で解除)', String(group.color || '').trim() || '#00b894');
    if (next == null) return;
    try { await api().updateGroup(group.id, { color: String(next || '').trim() }); await refresh(false); }
    catch (err) { reportError(err, '色を変更できませんでした'); }
  }

  async function promptRenameTag(tag) {
    const next = await promptAsync('タグ名', tag.name || '');
    const trimmed = String(next || '').trim();
    if (!trimmed || trimmed === tag.name) return;
    try { await api().updateTag(tag.id, { name: trimmed }); await refresh(false); }
    catch (err) { reportError(err, 'タグ名を変更できませんでした'); }
  }

  async function onDeleteGroup(group) {
    if (!await confirmAsync('グループ「' + group.name + '」を削除しますか？\n直下のタグは未分類に戻ります。')) return;
    try { await api().deleteGroup(group.id); await refresh(false); }
    catch (err) { reportError(err, 'グループを削除できませんでした'); }
  }

  async function onDeleteTag(tag) {
    if (!await confirmAsync('タグ「' + tag.name + '」を削除しますか？\nこのタグを付けたファイルからもタグが外れます。')) return;
    try { await api().deleteTag(tag.id); await refresh(false); }
    catch (err) { reportError(err, 'タグを削除できませんでした'); }
  }

  async function onDeleteSelected() {
    const rows = selectedRows();
    if (!rows.length) return;
    if (!await confirmAsync(rows.length + '件のタグ/グループを削除しますか？')) return;
    let failed = 0;
    for (const row of rows.filter(item => item.kind === 'tag')) {
      try { await api().deleteTag(row.id); } catch (_) { failed += 1; }
    }
    for (const row of rows.filter(item => item.kind === 'group')) {
      try { await api().deleteGroup(row.id); } catch (_) { failed += 1; }
    }
    _state.selectedKeys = [];
    await refresh(false);
    if (typeof showStatus === 'function') showStatus(rows.length - failed + '件を削除しました' + (failed ? '（' + failed + '件失敗）' : ''), failed > 0);
  }

  function openGroupMenu(anchor, group) {
    openMenu(anchor, [
      ['pencil', '名前を変更', () => promptRenameGroup(group)],
      ['palette', '色を変更', () => promptColorGroup(group)],
      ['folder-plus', 'サブグループを追加', () => onAddGroup(group.id)],
      ['plus', 'タグを追加', () => onAddTag(group.id)],
      ['trash-2', '削除', () => onDeleteGroup(group), true],
    ]);
  }

  function openTagMenu(anchor, tag) {
    openMenu(anchor, [
      ['filter', '現在のフォルダをこのタグで絞り込み', () => applyTagFilter(tag)],
      ['search', 'このタグの項目を全検索', () => showSearchForTag(tag)],
      ['pencil', '名前を変更', () => promptRenameTag(tag)],
      ['trash-2', '削除', () => onDeleteTag(tag), true],
    ]);
  }

  function openMenu(anchor, rows) {
    closeAnyMenu({ restoreFocus: false });
    _activeMenuTrigger = anchor || null;
    const menu = document.createElement('div');
    const menuId = 'tag-management-menu-' + (++_activeMenuId);
    menu.id = menuId;
    menu.className = 'gb-context-menu gb-tag-management-menu';
    menu.dataset.e2eId = 'tag-management-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'タグ操作メニュー');
    menu.setAttribute('tabindex', '-1');
    menu.style.cssText = 'position:fixed;z-index:10000;background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:4px;min-width:190px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
    if (anchor?.setAttribute) {
      anchor.setAttribute('aria-haspopup', 'menu');
      anchor.setAttribute('aria-expanded', 'true');
      anchor.setAttribute('aria-controls', menuId);
    }
    rows.forEach(([icon, label, action, danger]) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'gb-context-menu-item' + (danger ? ' danger' : '');
      row.dataset.e2eId = 'tag-management-menu-item-' + safeKeyPart(label);
      row.setAttribute('role', 'menuitem');
      row.setAttribute('aria-label', label);
      row.innerHTML = '<span class="menu-icon" aria-hidden="true">' + ic(icon, 13) + '</span><span class="gb-context-menu-item-label">' + esc(label) + '</span>';
      row.addEventListener('click', () => { closeAnyMenu({ restoreFocus: false }); action(); });
      menu.appendChild(row);
    });
    document.body.appendChild(menu);
    if (typeof attachMeldexDropdownCloseButton === 'function') {
      attachMeldexDropdownCloseButton(menu, {
        trigger: anchor,
        close: () => closeAnyMenu({ restoreFocus: true }),
        attr: 'data-e2e-id="tag-management-menu-close" data-tag-management-role="menu-close"',
      });
    }
    if (typeof positionPopup === 'function') positionPopup(menu, anchor.getBoundingClientRect());
    else {
      const rect = anchor.getBoundingClientRect();
      const z = cssZoom();
      menu.style.left = (rect.left / z) + 'px';
      menu.style.top = (rect.bottom / z + 4) + 'px';
      if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
    }
    bindMenuOutsideClick(menu, anchor);
    const firstItem = menu.querySelector('.gb-context-menu-item');
    setTimeout(() => focusTrigger(firstItem || menu), 0);
  }

  function bindMenuOutsideClick(menu, trigger) {
    if (typeof _activeMenuCleanup === 'function') _activeMenuCleanup();
    const onOut = event => { if (!menu.contains(event.target)) closeAnyMenu({ restoreFocus: true }); };
    const onKey = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeAnyMenu({ restoreFocus: true });
    };
    document.addEventListener('mousedown', onOut, true);
    document.addEventListener('keydown', onKey, true);
    _activeMenuCleanup = () => {
      document.removeEventListener('mousedown', onOut, true);
      document.removeEventListener('keydown', onKey, true);
      if (trigger?.setAttribute) trigger.setAttribute('aria-expanded', 'false');
      trigger?.removeAttribute?.('aria-controls');
    };
  }

  function closeAnyMenu(options = {}) {
    const trigger = _activeMenuTrigger;
    if (typeof _activeMenuCleanup === 'function') {
      try { _activeMenuCleanup(); } catch (_) {}
      _activeMenuCleanup = null;
    }
    document.querySelectorAll('.gb-tag-management-menu').forEach(el => el.remove());
    if (options.restoreFocus && trigger?.isConnected) {
      focusTrigger(trigger);
      forceTriggerFocus(trigger);
      setTimeout(() => forceTriggerFocus(trigger), 0);
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => forceTriggerFocus(trigger));
    }
    _activeMenuTrigger = null;
  }

  async function showSearchForTag(tag) {
    if (!api()) return;
    try {
      _state.searchTag = tag;
      _state.searchResults = [];
      render();
      scrollSearchResultsIntoView();
      const data = await api().searchByTag(tag);
      _state.searchResults = Array.isArray(data?.results) ? data.results : [];
      render();
      scrollSearchResultsIntoView();
    } catch (err) {
      _state.searchResults = [];
      reportError(err, 'タグ検索に失敗しました');
      render();
    }
  }

  function scrollSearchResultsIntoView() {
    const scroll = () => {
      const results = _container?.querySelector?.('[data-e2e-id="tag-management-search-results"]');
      if (!results?.scrollIntoView) return;
      try { results.scrollIntoView({ block: 'end', inline: 'nearest' }); }
      catch (_) { results.scrollIntoView(); }
    };
    scroll();
    setTimeout(scroll, 0);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(scroll);
  }

  function renderSearchResults() {
    const wrap = document.createElement('div');
    wrap.className = 'gb-section gb-section--boxed';
    wrap.dataset.e2eId = 'tag-management-search-results';
    wrap.style.cssText = 'margin-top:12px;';
    const results = Array.isArray(_state.searchResults) ? _state.searchResults : [];
    const tagName = _state.searchTag?.name || _state.searchTag || '';
    const title = document.createElement('div');
    title.className = 'gb-section-title';
    title.style.cssText = 'display:flex;align-items:center;gap:6px;';
    title.innerHTML = '<span style="flex:1;">' + ic('search', 14) + ' 「' + esc(tagName) + '」の項目（' + results.length + '件）</span>';
    title.appendChild(iconButton('x', '結果を閉じる', () => { _state.searchTag = null; _state.searchResults = null; render(); }, '', 'tag-management-search-close'));
    wrap.appendChild(title);
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:2px;margin-top:6px;';
    if (!results.length) list.appendChild(emptyRow('該当する項目はありません'));
    results.slice(0, 200).forEach((item, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gb-btn gb-btn-sm gb-btn-quiet';
      btn.dataset.e2eId = 'tag-management-search-result-' + String(index + 1);
      btn.dataset.tagManagementRole = 'search-result';
      btn.style.cssText = 'justify-content:flex-start;text-align:left;width:100%;min-width:0;';
      btn.textContent = item.name || item.path || '';
      btn.title = item.path || '';
      btn.setAttribute('aria-label', (item.name || item.path || '項目') + 'を開く');
      btn.addEventListener('click', () => api()?.openTaggedTarget?.(item));
      list.appendChild(btn);
    });
    wrap.appendChild(list);
    return wrap;
  }

  async function onAddPreset() {
    try {
      const name = await promptAsync('プリセット名', uniqueName('タグプリセット', _state.presets.map(p => p.name)));
      if (!String(name || '').trim()) return;
      await api().createPreset({ name: String(name).trim() });
      await refresh(false);
    } catch (err) {
      reportError(err, 'プリセットを追加できませんでした');
    }
  }

  async function onDuplicatePreset(presetId) {
    if (!presetId) return;
    const current = _state.presets.find(p => p.id === presetId);
    try {
      const name = await promptAsync('複製後のプリセット名', uniqueName((current?.name || 'タグプリセット') + ' コピー', _state.presets.map(p => p.name)));
      if (!String(name || '').trim()) return;
      await api().duplicatePreset(presetId, { name: String(name).trim() });
      await refresh(false);
    } catch (err) {
      reportError(err, 'プリセットを複製できませんでした');
    }
  }

  async function onDeletePreset(presetId) {
    if (!presetId) return;
    const current = _state.presets.find(p => p.id === presetId);
    if (!await confirmAsync('プリセット「' + (current?.name || presetId) + '」を削除しますか？')) return;
    try {
      await api().deletePreset(presetId);
      await refresh(false);
    } catch (err) {
      reportError(err, 'プリセットを削除できませんでした');
    }
  }

  async function onSavePreset(presetId) {
    if (!presetId) return;
    const current = _state.presets.find(p => p.id === presetId);
    if (!await confirmAsync('現在のタグツリーを「' + (current?.name || presetId) + '」へ保存しますか？')) return;
    try {
      await api().saveCurrentPreset(presetId);
      await refresh(false);
      if (typeof showStatus === 'function') showStatus('タグプリセットを保存しました');
    } catch (err) {
      reportError(err, 'プリセットを保存できませんでした');
    }
  }

  async function loadPreset(presetId) {
    if (!presetId) return;
    const current = _state.presets.find(p => p.id === presetId);
    if (!await confirmAsync('タグツリーを「' + (current?.name || presetId) + '」に切り替えますか？')) return;
    try {
      const data = await api().loadPreset(presetId);
      _state.tags = Array.isArray(data?.tags) ? data.tags : [];
      _state.groups = Array.isArray(data?.groups) ? data.groups : [];
      _state.presets = Array.isArray(data?.presets) ? data.presets : _state.presets;
      _state.activePresetId = data?.active_preset_id || presetId;
      _state.selectedKeys = [];
      render();
      if (typeof showStatus === 'function') showStatus('タグプリセットを読み込みました');
    } catch (err) {
      reportError(err, 'プリセットを読み込めませんでした');
    }
  }

  async function runAutoTagForCurrentFolder() {
    const path = typeof _folderPath !== 'undefined' ? _folderPath : '';
    if (!path) {
      if (typeof showStatus === 'function') showStatus('フォルダを開いてから実行してください', true);
      return;
    }
    if (!await confirmAsync('現在のフォルダ内のファイルへ自動タグ付けを実行しますか？\n画像はCLIで目視判定します。')) return;
    try {
      if (typeof showStatus === 'function') showStatus('自動タグ付けを実行しています...');
      const result = await api().autoTag({ path, recursive: false });
      if (result?.stopped) {
        if (typeof showStatus === 'function') showStatus('自動タグ付けを中断しました: ' + (result.warning || result.reason || ''), true);
      } else if (typeof showStatus === 'function') {
        showStatus((result?.total || 0) + '件に自動タグ付けしました');
      }
      await refresh(false);
      if (typeof renderFolderGrid === 'function') renderFolderGrid();
    } catch (err) {
      reportError(err, '自動タグ付けに失敗しました');
    }
  }

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
    if (!_state.tags.length && !_state.groups.length && !_state.error) {
      _state.loading = true;
      render();
      refresh(false);
    } else {
      render();
      refresh(false);
    }
  }

  window.renderTagManagementTab = renderTagManagementTab;
  window.MeldexTagManagement = {
    render: () => render(),
    refresh,
    showSearchForTag,
    setContainer: container => { _container = container; },
    selectedRows,
  };
})();
