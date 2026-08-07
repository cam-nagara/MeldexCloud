(function () {
  'use strict';

  // Eagle風タグ管理: 階層ツリー、複数選択、D&D、自動タグプリセット、タグ検索。
  const UNCATEGORIZED_COLLAPSE_KEY = 'meldex-tag-management-uncategorized-collapsed';
  const DRAG_MIME = 'application/x-meldex-tag-tree';
  let _container = null;
  let _dragRows = [];
  let _fetchRevision = 0;
  let _groupOrderSaving = false;
  let _catalogRefreshTimer = 0;
  let _state = {
    tags: [],
    groups: [],
    presetNames: [],
    builtinPresets: [],
    selectedPresetNames: [],
    filterText: '',
    installingPresetId: '',
    builtinPresetsOpen: false,
    presetFiltersOpen: false,
    loading: false,
    error: '',
    syncWarning: '',
    mutationBlocked: false,
    conflictResolutionAvailable: false,
    conflictId: '',
    selectedKeys: [],
    anchorKey: '',
    flatRows: [],
    searchTag: null,
    searchResults: null,
    autoTagTargetPath: '',
    autoTagTargetRecursive: false,
    autoTagTargets: [],
    sourceFolder: '',
  };
  function api() { return window.MeldexGlobalTags || null; }
  function sourceFolderForPath(path) {
    return String(path && window.MeldexAutoTagSourceFolder?.(path) || '').trim();
  }
  function treeScopeKey() {
    return window.MeldexTagTreeRuntime?.normalizedScopeKey?.(_state.sourceFolder)
      || String(_state.sourceFolder || '__default__');
  }
  function resetTreeRenderLimit() {
    window.MeldexTagTreeRuntime?.resetRenderLimit?.(treeScopeKey());
  }
  function ic(name, size) { return typeof lucide === 'function' ? lucide(name, size || 14) : ''; }
  function esc(value) {
    if (typeof window.esc === 'function') return window.esc(value);
    return String(value == null ? '' : value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }
  function rowKey(kind, id) { return String(kind || '') + ':' + String(id || ''); }
  function safeKeyPart(value) { return String(value || '').replace(/[^\p{L}\p{N}_:-]+/gu, '-').replace(/^-+|-+$/g, '') || 'item'; }
  function selectedSet() { return new Set(_state.selectedKeys || []); }
  function isSelected(key) { return selectedSet().has(key); }
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

  function compareByOrder(a, b) {
    return Number(a?.sort_index || 0) - Number(b?.sort_index || 0)
      || String(a?.name || '').localeCompare(String(b?.name || ''), 'ja');
  }

  function orderedSiblingGroups(parentId) {
    const normalizedParent = parentId || null;
    return _state.groups
      .filter(group => (group.parent_id || null) === normalizedParent)
      .sort(compareByOrder);
  }

  function groupColor(group, groupsById) {
    return effectiveTagColor({ group_id: group?.id }, groupsById);
  }

  async function fetchAll() {
    if (!api()) return;
    const revision = ++_fetchRevision;
    const sourceFolder = _state.sourceFolder;
    _state.loading = true;
    _state.error = '';
    try {
      const [tagData, presetData] = await Promise.all([
        api().loadTagsCached ? api().loadTagsCached(sourceFolder) : api().loadTags(sourceFolder),
        api().loadAutoTagPresets
          ? api().loadAutoTagPresets(sourceFolder)
          : Promise.resolve({ preset_names: [], builtins: [] }),
      ]);
      if (revision !== _fetchRevision || sourceFolder !== _state.sourceFolder) return;
      _state.tags = Array.isArray(tagData?.tags) ? tagData.tags : [];
      _state.groups = Array.isArray(tagData?.groups) ? tagData.groups : [];
      _state.presetNames = Array.isArray(presetData?.preset_names)
        ? presetData.preset_names
        : (Array.isArray(tagData?.preset_names) ? tagData.preset_names : []);
      _state.builtinPresets = Array.isArray(presetData?.builtins) ? presetData.builtins : [];
      _state.syncWarning = String(tagData?.warning || '');
      _state.mutationBlocked = !!tagData?.mutation_blocked;
      _state.conflictResolutionAvailable = !!tagData?.conflict_resolution_available;
      _state.conflictId = String(tagData?.conflict_id || '');
      resetTreeRenderLimit();
      const available = new Set(_state.presetNames.map(name => String(name).toLocaleLowerCase('ja')));
      _state.selectedPresetNames = (_state.selectedPresetNames || [])
        .filter(name => available.has(String(name).toLocaleLowerCase('ja')));
      pruneSelection();
    } catch (err) {
      if (revision !== _fetchRevision || sourceFolder !== _state.sourceFolder) return;
      _state.error = err && (err.userMessage || err.message) ? (err.userMessage || err.message) : String(err);
    } finally {
      if (revision === _fetchRevision && sourceFolder === _state.sourceFolder) _state.loading = false;
    }
  }

  function filteredTags() {
    return window.MeldexTagPresetUI?.filteredTags?.(_state)
      || { all: _state.tags, visible: _state.tags };
  }

  function buildTreeData() {
    const filtered = filteredTags();
    const groupsById = Object.fromEntries(_state.groups.map(group => [group.id, { ...group, children: [], tags: [] }]));
    const roots = [];
    _state.groups.forEach(group => {
      const node = groupsById[group.id];
      if (group.parent_id && groupsById[group.parent_id]) groupsById[group.parent_id].children.push(node);
      else roots.push(node);
    });
    const uncategorized = [];
    filtered.visible.forEach(tag => {
      if (tag.group_id && groupsById[tag.group_id]) groupsById[tag.group_id].tags.push(tag);
      else uncategorized.push(tag);
    });
    const sortGroup = node => {
      node.children.sort(compareByOrder);
      node.tags.sort(compareByOrder);
      node.children.forEach(sortGroup);
    };
    roots.sort(compareByOrder);
    roots.forEach(sortGroup);
    uncategorized.sort(compareByOrder);
    if (_state.filterText || _state.selectedPresetNames.length || filtered.visible.length < _state.tags.length) {
      const hasContent = node => {
        node.children = node.children.filter(hasContent);
        return node.tags.length > 0 || node.children.length > 0;
      };
      for (let index = roots.length - 1; index >= 0; index -= 1) {
        if (!hasContent(roots[index])) roots.splice(index, 1);
      }
    }
    return { roots, uncategorized, groupsById, filtered };
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

  async function resolveDictionaryConflict(strategy, label) {
    if (!api()?.resolveTagDictionaryConflict) return;
    const confirmed = await confirmAsync(
      `${label}のタグ辞書を採用しますか？\n両方の内容は競合バックアップへ保存してから統一します。`,
    );
    if (!confirmed) return;
    try {
      const result = await api().resolveTagDictionaryConflict(
        strategy,
        _state.conflictId,
        _state.sourceFolder,
      );
      if (typeof showStatus === 'function') {
        showStatus(`タグ辞書を${label}の内容へ統一しました（競合バックアップ: ${result?.backup_path || '保存済み'}）`);
      }
      await refresh(false);
    } catch (err) {
      reportError(err, 'タグ辞書の同期競合を解消できませんでした');
    }
  }

  function render() {
    if (!_container) return;
    const activePanelTab = window.MeldexTagPanelTabs?.activeTab?.() || 'tag-tree';
    const reusableAutoTagSection = _container.querySelector?.('[data-tag-auto-run-section]');
    reusableAutoTagSection?.remove();
    _container.classList.add('gb-tag-management-panel');
    _container.setAttribute('aria-label', 'タグ管理');
    _container.dataset.tagPanelView = activePanelTab;
    _container.textContent = '';
    _container.style.display = 'flex';
    _container.style.flexDirection = 'column';
    _container.style.minHeight = '0';

    const panelTabs = window.MeldexTagPanelTabs?.createTabBar?.(() => render());
    if (panelTabs) _container.appendChild(panelTabs);

    const body = document.createElement('div');
    body.className = 'gb-tag-management-body';
    body.style.cssText = 'flex:1;min-height:0;overflow:auto;padding:8px;';
    body.dataset.tagPanelView = activePanelTab;
    _container.appendChild(body);
    if (_state.loading && !_state.tags.length && !_state.groups.length) {
      body.insertAdjacentHTML('beforeend', '<div class="gb-section-desc" style="padding:12px;">タグを読み込んでいます...</div>');
      return;
    }
    if (_state.error) {
      body.insertAdjacentHTML('beforeend', '<div class="gb-section-desc" style="padding:12px;color:var(--danger);">タグを読み込めませんでした: ' + esc(_state.error) + '</div>');
      if (_state.error && !_state.tags.length && !_state.groups.length) return;
    }
    if (_state.syncWarning) {
      const warning = document.createElement('div');
      warning.className = 'gb-section gb-section--boxed';
      warning.dataset.e2eId = 'tag-management-sync-warning';
      warning.style.cssText = 'padding:8px;margin-bottom:8px;color:var(--warning,#d8a22e);font-size:12px;line-height:1.5;';
      warning.textContent = _state.syncWarning;
      if (
        _state.mutationBlocked
        && _state.conflictResolutionAvailable
        && api()?.resolveTagDictionaryConflict
      ) {
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;';
        actions.append(
          textButton(
            'クラウド版を採用',
            'cloud',
            () => resolveDictionaryConflict('cloud', 'クラウド版'),
            'tag-management-resolve-cloud',
          ),
          textButton(
            'デスクトップ版を採用',
            'monitor',
            () => resolveDictionaryConflict('desktop', 'デスクトップ版'),
            'tag-management-resolve-desktop',
          ),
        );
        warning.appendChild(actions);
      }
      body.appendChild(warning);
    }

    const panelControls = renderPanelControls(activePanelTab);
    if (panelControls) body.appendChild(panelControls);
    if (activePanelTab === 'auto-tag') {
      mountAutoTagSection(reusableAutoTagSection);
      if (_state.builtinPresets.length) {
        body.appendChild(window.MeldexTagPresetUI.renderBuiltinPresets({
          state: _state,
          textButton,
          safeKeyPart,
          onInstall: installBuiltinPreset,
        }));
      }
      return;
    }

    const target = currentAutoTagTarget();
    window.MeldexTagPanelTabs?.setTreeContext?.({
      target,
      sourceFolder: _state.sourceFolder,
      tags: _state.tags,
      mutationBlocked: _state.mutationBlocked,
      warning: _state.syncWarning,
    });
    body.appendChild(window.MeldexTagPanelTabs?.createTargetStatus?.() || document.createTextNode(''));
    const filterSummary = document.createElement('div');
    filterSummary.dataset.tagTreeFilterSummary = '1';
    body.appendChild(filterSummary);
    const filterControls = renderTreeFilterControls();
    if (filterControls) body.appendChild(filterControls);
    body.appendChild(renderTreeToolbar());
    const dynamic = document.createElement('div');
    dynamic.dataset.tagTreeDynamic = '1';
    dynamic.setAttribute('role', 'tree');
    body.appendChild(dynamic);
    renderTreeDynamic(dynamic);
    bindDropTarget(dynamic, null, 'root');
    window.MeldexTagPanelTabs?.mountTree?.(body);
  }

  function syncTreeFilterControls(body, filtered) {
    const summaryHost = body?.querySelector('[data-tag-tree-filter-summary]');
    if (summaryHost) {
      summaryHost.replaceChildren(
        window.MeldexTagPresetUI?.renderFilterSummary?.(_state, filtered)
          || document.createTextNode(''),
      );
    }
    const details = body?.querySelector('[data-e2e-id="tag-management-preset-filter-section"]');
    const summary = details?.querySelector('summary');
    if (summary) {
      const selected = _state.selectedPresetNames || [];
      summary.textContent = selected.length
        ? `タグ一覧の絞り込み（${selected.join('＋')}）`
        : `タグ一覧の絞り込み（全${(_state.presetNames || []).length}プリセット）`;
    }
  }

  function renderTreeDynamic(host) {
    if (!host) return;
    window.MeldexTagGroupSummary?.ensure?.(() => {
      if (_container?.isConnected) refreshGroupSummaryCounts();
    });
    const { roots, uncategorized, groupsById, filtered } = buildTreeData();
    const flatRows = flattenTree(roots, uncategorized);
    const visibleTagCount = flatRows.filter(row => row.kind === 'tag').length;
    const runtime = window.MeldexTagTreeRuntime;
    const budget = runtime?.createBudget?.(treeScopeKey(), visibleTagCount)
      || { limit: Number.MAX_SAFE_INTEGER, total: visibleTagCount, rendered: 0, skipped: 0 };
    const build = () => {
      const fragment = document.createDocumentFragment();
      fragment.appendChild(renderBulkBar());
      fragment.appendChild(renderUncategorizedSection(uncategorized, groupsById, budget));
      roots.forEach(group => fragment.appendChild(renderGroupNode(group, groupsById, 0, budget)));
      const loadMore = runtime?.createLoadMoreButton?.(budget, () => refreshTreeContent());
      if (loadMore) fragment.appendChild(loadMore);
      if (!roots.length && !uncategorized.length) {
        const empty = document.createElement('div');
        empty.className = 'gb-section gb-section--boxed gb-tag-empty';
        empty.style.cssText = 'padding:10px;margin-top:8px;color:var(--fg2);font-size:12px;';
        empty.textContent = filtered.all.length
          ? '表示条件に一致するタグがありません。'
          : 'タグがありません。タグを追加するか、同梱プリセットを導入してください。';
        fragment.appendChild(empty);
      }
      if (_state.searchResults != null) {
        fragment.appendChild(window.MeldexTagManagementOverlays.renderSearchResults({
          results: _state.searchResults,
          tagName: _state.searchTag?.name || _state.searchTag || '',
          icon: ic,
          closeButton: () => iconButton('x', '結果を閉じる', () => {
            _state.searchTag = null;
            _state.searchResults = null;
            refreshTreeContent();
          }, '', 'tag-management-search-close'),
          emptyRow,
          onOpen: item => api()?.openTaggedTarget?.(item),
        }));
      }
      return fragment;
    };
    if (runtime?.replaceDynamic) runtime.replaceDynamic(host, build, 'tag-tree-dynamic');
    else host.replaceChildren(build());
    syncTreeFilterControls(host.closest('.gb-tag-management-body'), filtered);
  }

  function refreshTreeContent() {
    const body = _container?.querySelector('.gb-tag-management-body');
    const dynamic = body?.querySelector('[data-tag-tree-dynamic]');
    if (!dynamic) {
      render();
      return;
    }
    const scrollTop = body.scrollTop;
    renderTreeDynamic(dynamic);
    body.scrollTop = scrollTop;
    window.MeldexTagPanelTabs?.mountTree?.(body);
  }

  function normalizeAutoTagPath(value) {
    return window.MeldexTagPresetUI?.normalizeAutoTagTargetPath?.(value)
      || (typeof value === 'string' ? value.trim() : '');
  }

  function normalizeAutoTagTargets(rawTargets) {
    const seen = new Set();
    return (Array.isArray(rawTargets) ? rawTargets : []).map(item => {
      const path = normalizeAutoTagPath(item);
      const recursive = typeof item === 'object'
        ? (item?.recursive == null ? item?.type === 'folder' : !!item.recursive)
        : false;
      return { path, recursive };
    }).filter(item => {
      if (!item.path || seen.has(item.path)) return false;
      seen.add(item.path);
      return true;
    });
  }

  function currentAutoTagTarget() {
    let targets = normalizeAutoTagTargets(_state.autoTagTargets);
    if (!targets.length && _state.autoTagTargetPath) {
      targets = [{ path: _state.autoTagTargetPath, recursive: _state.autoTagTargetRecursive }];
    }
    if (!targets.length && typeof _folderSelectedItems !== 'undefined') {
      targets = normalizeAutoTagTargets(_folderSelectedItems);
    }
    if (!targets.length && typeof _folderSelected !== 'undefined' && _folderSelected?.path) {
      targets = normalizeAutoTagTargets([_folderSelected]);
    }
    if (!targets.length && typeof _folderPath !== 'undefined' && _folderPath) {
      targets = [{ path: String(_folderPath), recursive: true }];
    }
    const first = targets[0] || { path: '', recursive: false };
    return { path: first.path, recursive: first.recursive, targets };
  }

  function mountAutoTagSection(existing, force) {
    if (!_container) return;
    const target = currentAutoTagTarget();
    const section = window.MeldexTagPresetUI?.renderAutoTagExecutionSection?.({
      existing,
      path: target.path,
      recursive: target.recursive,
      targets: target.targets,
      mutationBlocked: _state.mutationBlocked,
      mutationWarning: _state.syncWarning,
      force: !!force,
    });
    if (!section) {
      existing?.remove();
      return;
    }
    const body = _container.querySelector('.gb-tag-management-body');
    if (body) body.appendChild(section);
    else _container.appendChild(section);
  }

  function setAutoTagTargets(targets) {
    const nextTargets = normalizeAutoTagTargets(targets);
    const currentSignature = JSON.stringify(normalizeAutoTagTargets(_state.autoTagTargets));
    const nextSignature = JSON.stringify(nextTargets);
    const first = nextTargets[0] || { path: '', recursive: false };
    const nextSourceFolder = first.path ? sourceFolderForPath(first.path) : '';
    const sourceChanged = nextSourceFolder !== _state.sourceFolder;
    const changed = currentSignature !== nextSignature
      || first.path !== _state.autoTagTargetPath
      || first.recursive !== _state.autoTagTargetRecursive;
    _state.autoTagTargets = nextTargets;
    _state.autoTagTargetPath = first.path;
    _state.autoTagTargetRecursive = first.recursive;
    _state.sourceFolder = nextSourceFolder;
    if (changed) window.MeldexTagGroupSummary?.invalidate?.();
    const resetButton = _container?.querySelector(
      '[data-e2e-id="tag-management-reset-target-tags"]',
    );
    if (resetButton) {
      resetButton.disabled = _state.mutationBlocked || !first.path;
    }
    if (sourceChanged) {
      resetTreeRenderLimit();
      _fetchRevision += 1;
      _state.tags = [];
      _state.groups = [];
      _state.presetNames = [];
      _state.builtinPresets = [];
      _state.selectedPresetNames = [];
      _state.selectedKeys = [];
      _state.searchTag = null;
      _state.searchResults = null;
      _state.error = '';
      _state.syncWarning = '';
      _state.mutationBlocked = false;
      _state.conflictResolutionAvailable = false;
      _state.conflictId = '';
      _state.loading = true;
    }
    if (!_container || !changed) return;
    if (sourceChanged) {
      render();
      refresh(false);
      return;
    }
    const activePanelTab = window.MeldexTagPanelTabs?.activeTab?.() || 'tag-tree';
    if (activePanelTab === 'tag-tree') {
      window.MeldexTagPanelTabs?.setTreeContext?.({
        target: currentAutoTagTarget(),
        sourceFolder: _state.sourceFolder,
        tags: _state.tags,
        mutationBlocked: _state.mutationBlocked,
        warning: _state.syncWarning,
      });
      window.MeldexTagGroupSummary?.ensure?.(() => {
        if (_container?.isConnected) refreshGroupSummaryCounts();
      });
      refreshGroupSummaryCounts();
    }
    const existing = _container.querySelector('[data-tag-auto-run-section]');
    if (activePanelTab === 'auto-tag') {
      mountAutoTagSection(existing);
    }
  }

  function setAutoTagTarget(path, recursive) {
    const nextPath = normalizeAutoTagPath(path);
    setAutoTagTargets(nextPath ? [{ path: nextPath, recursive: !!recursive }] : []);
  }

  function renderTreeFilterControls() {
    return window.MeldexTagPresetUI?.renderPresetControls?.({
      state: _state,
      onFilterInput(search, event) {
        if (event?.isComposing || search?.dataset?.composing === '1') return;
        const changed = _state.filterText !== search.value;
        _state.filterText = search.value;
        if (changed) resetTreeRenderLimit();
        const caret = search.selectionStart || 0;
        const rerender = () => {
          refreshTreeContent();
          const next = _container?.querySelector('[data-e2e-id="tag-management-filter"]');
          if (next) {
            next.focus();
            next.setSelectionRange(caret, caret);
          }
        };
        if (window.MeldexTagPanelTabs?.scheduleTreeFilterRender) {
          window.MeldexTagPanelTabs.scheduleTreeFilterRender(rerender);
        } else rerender();
      },
      onPresetToggle(name, checked) {
        const selected = new Set(_state.selectedPresetNames);
        if (checked) selected.add(name);
        else selected.delete(name);
        _state.selectedPresetNames = [...selected];
        resetTreeRenderLimit();
        refreshTreeContent();
      },
    });
  }

  function renderPanelControls(activePanelTab) {
    const controls = document.createElement('div');
    controls.className = 'gb-tag-management-controls';
    controls.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-bottom:6px;';
    const actionRow = document.createElement('div');
    actionRow.className = 'gb-tag-management-action-row';
    actionRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
    if (activePanelTab === 'tag-tree' && window.isTagDictionaryEditingAvailable?.() !== false) {
      if (window.isTagDictionarySheetOpenAvailable?.() === true) {
        actionRow.appendChild(textButton('タグ辞書シート', 'table-properties', () => (
          window.ensureAutoTagDictionarySheet?.(_state.autoTagTargetPath, _state.sourceFolder)
        ), 'tag-management-open-dictionary'));
      }
      const importCsv = textButton('CSV取込', 'upload', () => (
        window.importAutoTagDictionaryCsv?.(_state.autoTagTargetPath, _state.sourceFolder)
      ), 'tag-management-import-csv');
      importCsv.disabled = _state.mutationBlocked;
      actionRow.appendChild(importCsv);
      actionRow.appendChild(textButton('CSV書出', 'download', () => (
        window.exportAutoTagDictionaryCsv?.(_state.autoTagTargetPath, _state.sourceFolder)
      ), 'tag-management-export-csv'));
    }
    if (activePanelTab === 'auto-tag' && window.isAutoTagRuntimeAvailable?.() === true) {
      const autoTagFolder = textButton('現在のフォルダを自動タグ付け', 'sparkles', () => runAutoTagForCurrentFolder(), 'tag-management-auto-tag-folder');
      autoTagFolder.disabled = _state.mutationBlocked;
      actionRow.appendChild(autoTagFolder);
    }
    if (activePanelTab === 'auto-tag' && window.isAutoTagRuntimeAvailable?.() === true && window.MeldexAutoTagJobs?.startReset) {
      const resetTags = textButton('対象のタグを一括リセット', 'tags', () => resetCurrentTargetTags(), 'tag-management-reset-target-tags');
      resetTags.disabled = _state.mutationBlocked || !currentAutoTagTarget().path;
      resetTags.classList.add('gb-btn-danger');
      actionRow.appendChild(resetTags);
    }
    if (actionRow.childElementCount) controls.appendChild(actionRow);

    if (activePanelTab !== 'tag-tree') return controls.childElementCount ? controls : null;
    return controls;
  }

  function renderTreeToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'gb-tag-tree-toolbar';
    toolbar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 2px 4px;';
    const label = document.createElement('strong');
    label.className = 'gb-section-title';
    label.textContent = 'タグツリー';
    const addRootItem = iconButton(
      'plus',
      'タグまたは最上位グループを追加',
      event => openAddMenu(event.currentTarget, null),
      '',
      'tag-management-add',
      { menu: true },
    );
    addRootItem.disabled = _state.mutationBlocked;
    toolbar.append(label, addRootItem);
    return toolbar;
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
    bar.appendChild(textButton('選択解除', 'x', () => {
      _state.selectedKeys = [];
      refreshTreeContent();
    }, 'tag-management-bulk-clear'));
    return bar;
  }

  function renderUncategorizedSection(tags, groupsById, budget) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:6px;';
    const collapsed = isUncategorizedCollapsed();
    const head = treeRowBase('group', rowKey('group', '__uncategorized__'), 0);
    head.draggable = false;
    const caret = iconButton(collapsed ? 'chevron-right' : 'chevron-down', collapsed ? '展開' : '折りたたみ', () => {
      setUncategorizedCollapsed(!collapsed);
      refreshTreeContent();
    }, '', 'tag-management-uncategorized-toggle');
    caret.style.minWidth = '22px';
    head.appendChild(caret);
    head.appendChild(rowLabel('未分類', true));
    const uncategorizedSummary = window.MeldexTagGroupSummary?.get?.(_state.tags, _state.groups, '')
      || { assigned: 0, total: tags.length };
    head.appendChild(rowCount(uncategorizedSummary.total, uncategorizedSummary.assigned, '__uncategorized__'));
    head.appendChild(iconButton('plus', '未分類にタグを追加', () => onAddTag(null), '', 'tag-management-uncategorized-add-tag'));
    bindDropTarget(head, null, 'root');
    wrap.appendChild(head);
    if (!collapsed) {
      const box = document.createElement('div');
      box.style.cssText = 'margin-left:18px;display:flex;flex-direction:column;gap:2px;';
      if (!tags.length) box.appendChild(emptyRow('タグなし'));
      tags.forEach(tag => {
        if (!window.MeldexTagTreeRuntime?.takeTag
          || window.MeldexTagTreeRuntime.takeTag(budget)) {
          box.appendChild(renderTagRow(tag, groupsById, 0));
        }
      });
      wrap.appendChild(box);
    }
    return wrap;
  }

  function renderGroupNode(group, groupsById, depth, budget) {
    const wrap = document.createElement('div');
    wrap.style.marginLeft = (depth * 12) + 'px';
    const key = rowKey('group', group.id);
    const head = treeRowBase('group', key, depth);
    head.appendChild(iconButton(group.collapsed ? 'chevron-right' : 'chevron-down', group.collapsed ? '展開' : '折りたたみ', () => toggleGroupCollapsed(group), '', 'tag-management-group-toggle-' + safeKeyPart(group.id)));
    head.appendChild(rowLabel(group.name, true, groupColor(group, groupsById)));
    const summary = window.MeldexTagGroupSummary?.get?.(_state.tags, _state.groups, group.id)
      || { assigned: 0, total: countTagsRecursive(group) };
    head.appendChild(rowCount(summary.total, summary.assigned, group.id));
    const actions = document.createElement('span');
    actions.className = 'gb-tag-group-actions';
    const displayPreferences = window.MeldexTagDisplayPreferences;
    const explicitlyHidden = displayPreferences?.isGroupExplicitlyHidden?.(group.id, _state.sourceFolder) === true;
    actions.append(
      iconButton(
        explicitlyHidden ? 'eye-off' : 'eye',
        explicitlyHidden ? 'このタググループをメインパネルに表示' : 'このタググループをメインパネルで非表示',
        () => {
          displayPreferences?.toggleGroup?.(group.id, _state.sourceFolder);
          refreshTreeContent();
        },
        '',
        'tag-management-group-visibility-' + safeKeyPart(group.id),
      ),
      iconButton('plus', 'タグまたはサブグループを追加', event => openAddMenu(event.currentTarget, group.id), '', 'tag-management-group-add-' + safeKeyPart(group.id), { menu: true }),
      iconButton('ellipsis', 'グループの操作', event => openGroupMenu(event.currentTarget, group), '', 'tag-management-group-menu-' + safeKeyPart(group.id), { menu: true }),
    );
    head.appendChild(actions);
    head.addEventListener('click', event => {
      if (event.target.closest('button')) return;
      setSelectionFromEvent(event, key);
      refreshTreeContent();
    });
    bindRowKeyboard(head, event => {
      setSelectionFromEvent(event, key);
      refreshTreeContent();
    }, event => openGroupMenu(event.currentTarget, group));
    bindRowMenu(head, event => openGroupMenu(event.currentTarget, group));
    bindDragSource(head, 'group', group.id);
    bindDropTarget(head, group.id, 'group');
    wrap.appendChild(head);
    if (!group.collapsed) {
      const box = document.createElement('div');
      box.style.cssText = 'margin-left:18px;display:flex;flex-direction:column;gap:2px;';
      group.tags.forEach(tag => {
        if (!window.MeldexTagTreeRuntime?.takeTag
          || window.MeldexTagTreeRuntime.takeTag(budget)) {
          box.appendChild(renderTagRow(tag, groupsById, depth + 1));
        }
      });
      group.children.forEach(child => box.appendChild(
        renderGroupNode(child, groupsById, depth + 1, budget),
      ));
      if (!group.tags.length && !group.children.length) box.appendChild(emptyRow('空のグループ'));
      wrap.appendChild(box);
    }
    return wrap;
  }

  function renderTagRow(tag, groupsById) {
    const key = rowKey('tag', tag.id);
    const row = treeRowBase('tag', key, 0);
    const assignmentToggle = window.MeldexTagPanelTabs?.createTagToggle?.(tag);
    if (assignmentToggle) row.appendChild(assignmentToggle);
    else {
      const indent = document.createElement('span');
      indent.style.cssText = 'display:inline-block;flex:0 0 24px;width:24px;';
      row.appendChild(indent);
    }
    row.appendChild(api()?.createTagChip?.(tag, {
      groupsById,
      compact: true,
      className: 'gb-tag-tree-chip',
    }) || rowLabel(tag.name || '', false, effectiveTagColor(tag, groupsById)));
    if (Array.isArray(tag.aliases) && tag.aliases.length) {
      const aliasBadge = document.createElement('span');
      aliasBadge.className = 'gb-tag-alias-badge';
      aliasBadge.style.cssText = 'font-size:10px;color:var(--fg2);white-space:nowrap;';
      aliasBadge.textContent = '別名 ' + tag.aliases.length;
      aliasBadge.title = '別名: ' + tag.aliases.join(', ');
      row.appendChild(aliasBadge);
    }
    if (tag.auto_assign) {
      const autoBadge = document.createElement('span');
      autoBadge.className = 'gb-tag-auto-assign-badge';
      autoBadge.style.cssText = 'display:inline-flex;align-items:center;color:var(--green,#4bc995);';
      autoBadge.innerHTML = ic('sparkles', 11);
      autoBadge.title = '自動付与を許可';
      autoBadge.setAttribute('aria-label', '自動付与を許可');
      row.appendChild(autoBadge);
    }
    row.appendChild(rowCount(typeof tag.source_count === 'number' && tag.source_count > 0 ? tag.source_count : ''));
    row.appendChild(iconButton('ellipsis', 'タグの操作', event => openTagMenu(event.currentTarget, tag), '', 'tag-management-tag-menu-' + safeKeyPart(tag.id), { menu: true }));
    row.addEventListener('click', event => {
      if (event.target.closest('button, input, label')) return;
      setSelectionFromEvent(event, key);
      if (!event.ctrlKey && !event.metaKey && !event.shiftKey) applyTagFilter(tag);
      refreshTreeContent();
    });
    bindRowKeyboard(row, event => {
      setSelectionFromEvent(event, key);
      if (!event.ctrlKey && !event.metaKey && !event.shiftKey) applyTagFilter(tag);
      refreshTreeContent();
    }, event => openTagMenu(event.currentTarget, tag));
    bindRowMenu(row, event => openTagMenu(event.currentTarget, tag));
    bindDragSource(row, 'tag', tag.id);
    window.MeldexTagTreeDnD?.bindTagDropTarget?.(row, tag, tagDndOptions());
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

  function rowLabel(text, strong, color) {
    const label = document.createElement('span');
    label.className = 'gb-tag-tree-label';
    label.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg);' + (strong ? 'font-weight:600;' : '');
    if (color) {
      label.classList.add('gb-tag-tree-label--colored');
      label.style.setProperty('--gb-tag-color', color);
    }
    label.textContent = text || '';
    label.title = text || '';
    return label;
  }

  function updateRowCount(count, total, assigned) {
    if (assigned == null) {
      count.textContent = total == null ? '' : String(total);
      return count;
    }
    count.replaceChildren();
    const assignedEl = document.createElement('span');
    assignedEl.className = 'gb-tag-group-count-assigned';
    assignedEl.textContent = String(assigned);
    const separator = document.createElement('span');
    separator.textContent = '/';
    const totalEl = document.createElement('span');
    totalEl.textContent = String(total == null ? 0 : total);
    count.append(assignedEl, separator, totalEl);
    const selectedCount = typeof _folderSelectedItems !== 'undefined' && Array.isArray(_folderSelectedItems)
      ? _folderSelectedItems.filter(item => item?.path && item.type !== 'folder').length
      : 0;
    const targetDescription = selectedCount
      ? `選択中${selectedCount}件のいずれかに付いているタグ`
      : '現在のフォルダに付いているタグ';
    count.setAttribute('aria-label', `${targetDescription} ${assigned}件、グループ内 ${total == null ? 0 : total}件`);
    count.title = `${targetDescription}: ${assigned}/${total == null ? 0 : total}`;
    return count;
  }

  function rowCount(total, assigned, groupId) {
    const count = document.createElement('span');
    count.className = 'gb-section-desc gb-tag-group-count';
    if (groupId != null) count.dataset.tagGroupCountId = String(groupId);
    count.style.cssText = 'min-width:18px;text-align:right;';
    return updateRowCount(count, total, assigned);
  }

  function refreshGroupSummaryCounts() {
    const summaryApi = window.MeldexTagGroupSummary;
    if (!summaryApi?.get || !_container) return;
    _container.querySelectorAll('[data-tag-group-count-id]').forEach(count => {
      const storedId = String(count.dataset.tagGroupCountId || '');
      const groupId = storedId === '__uncategorized__' ? '' : storedId;
      const summary = summaryApi.get(_state.tags, _state.groups, groupId);
      updateRowCount(count, summary.total, summary.assigned);
    });
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
      document.querySelectorAll('.gb-tag-tree-row.is-drop-target, .gb-tag-tree-row.is-drop-before, .gb-tag-tree-row.is-drop-after')
        .forEach(clearDropTargetState);
    });
  }

  function clearDropTargetState(el) {
    el.classList.remove('is-drop-target', 'is-drop-before', 'is-drop-after');
    el.style.boxShadow = '';
    delete el.dataset.tagDropPlacement;
  }

  function groupDropPlacement(el, event, items, targetGroupId, targetKind) {
    if (targetKind !== 'group' || !targetGroupId) return 'inside';
    const groups = (items || []).filter(item => item?.kind === 'group' && item?.id !== targetGroupId);
    if (groups.length !== 1 || groups.length !== (items || []).length) return 'inside';
    const rect = el.getBoundingClientRect();
    if (!rect.height || !Number.isFinite(event?.clientY)) return 'inside';
    const ratio = (event.clientY - rect.top) / rect.height;
    if (ratio < 0.32) return 'before';
    if (ratio > 0.68) return 'after';
    return 'inside';
  }

  function bindDropTarget(el, targetGroupId, targetKind) {
    el.addEventListener('dragover', event => {
      const items = readDragItems(event);
      if (!items.length) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      clearDropTargetState(el);
      const placement = groupDropPlacement(el, event, items, targetGroupId, targetKind);
      el.dataset.tagDropPlacement = placement;
      el.classList.add(placement === 'before'
        ? 'is-drop-before'
        : (placement === 'after' ? 'is-drop-after' : 'is-drop-target'));
      if (placement === 'inside') el.style.boxShadow = 'inset 0 0 0 1px var(--accent)';
    });
    el.addEventListener('dragleave', () => clearDropTargetState(el));
    el.addEventListener('drop', async event => {
      const items = readDragItems(event);
      if (!items.length) return;
      event.preventDefault();
      event.stopPropagation();
      const placement = el.dataset.tagDropPlacement || groupDropPlacement(el, event, items, targetGroupId, targetKind);
      clearDropTargetState(el);
      if ((placement === 'before' || placement === 'after') && items.length === 1 && items[0]?.kind === 'group') {
        await moveGroupRelative(items[0].id, targetGroupId, placement);
      } else {
        await moveItemsToGroup(items, targetGroupId || null, targetKind);
      }
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

  function tagDndOptions() {
    return {
      getState: () => _state,
      getApi: api,
      readItems: readDragItems,
      render,
      reportError,
    };
  }

  function groupUpdatesForParent(items, targetGroupId) {
    const targetParentId = targetGroupId || null;
    const movingIds = new Set(
      (items || [])
        .filter(item => item?.kind === 'group' && item?.id)
        .map(item => String(item.id)),
    );
    if (!movingIds.size || (targetGroupId && movingIds.has(String(targetGroupId)))) return [];
    const movingGroups = _state.groups
      .filter(group => movingIds.has(String(group.id)))
      .sort(compareByOrder);
    if (movingGroups.length !== movingIds.size) return [];
    if (movingGroups.some(group => wouldCreateGroupCycle(group.id, targetParentId))) return null;
    const siblings = orderedSiblingGroups(targetParentId)
      .filter(group => !movingIds.has(String(group.id)));
    siblings.push(...movingGroups);
    return siblings.map((group, index) => ({
      id: group.id,
      parent_id: targetParentId,
      sort_index: (index + 1) * 10,
    })).filter(update => {
      const current = _state.groups.find(group => group.id === update.id);
      return (current?.parent_id || null) !== targetParentId
        || Number(current?.sort_index || 0) !== update.sort_index;
    });
  }

  async function moveGroupsToParent(items, targetGroupId) {
    if (!api() || _state.mutationBlocked || _groupOrderSaving) return false;
    const updates = groupUpdatesForParent(items, targetGroupId);
    if (updates === null) {
      if (typeof showStatus === 'function') showStatus('子グループの階層へは移動できません', true);
      return false;
    }
    if (!updates.length) return false;
    const sourceFolder = _state.sourceFolder;
    const previousGroups = _state.groups.map(group => ({ ...group }));
    const updatesById = new Map(updates.map(update => [String(update.id), update]));
    _state.groups = _state.groups.map(group => {
      const update = updatesById.get(String(group.id));
      return update ? { ...group, ...update } : group;
    });
    _groupOrderSaving = true;
    render();
    try {
      const result = await api().updateGroupOrder(updates, sourceFolder);
      if (sourceFolder !== _state.sourceFolder) return true;
      if (Array.isArray(result?.tags)) _state.tags = result.tags;
      if (Array.isArray(result?.groups)) _state.groups = result.groups;
      render();
      if (typeof showStatus === 'function') showStatus('タググループの所属階層と表示順を保存しました');
      return true;
    } catch (error) {
      if (sourceFolder === _state.sourceFolder) {
        _state.groups = previousGroups;
        render();
        reportError(error, 'タググループの所属階層と表示順を保存できませんでした');
      }
      return false;
    } finally {
      _groupOrderSaving = false;
    }
  }

  async function moveItemsToGroup(items, targetGroupId) {
    if (!api()) return;
    const unique = [];
    const seen = new Set();
    (items || []).forEach(item => {
      const key = rowKey(item.kind, item.id);
      if (!item.kind || !item.id || seen.has(key)) return;
      seen.add(key);
      unique.push(item);
    });
    if (
      unique.length
      && unique.every(item => item.kind === 'tag')
      && window.MeldexTagTreeDnD?.moveTagsToGroup
    ) {
      await window.MeldexTagTreeDnD.moveTagsToGroup(unique, targetGroupId, tagDndOptions());
      return;
    }
    if (unique.length && unique.every(item => item.kind === 'group')) {
      await moveGroupsToParent(unique, targetGroupId);
      return;
    }
    if (unique.length && typeof showStatus === 'function') {
      showStatus('タグとタググループは同時に移動できません', true);
    }
  }

  function wouldCreateGroupCycle(groupId, nextParentId) {
    const byId = Object.fromEntries(_state.groups.map(group => [group.id, group]));
    const seen = new Set();
    let cursor = nextParentId || null;
    while (cursor && !seen.has(cursor)) {
      if (cursor === groupId) return true;
      seen.add(cursor);
      cursor = byId[cursor]?.parent_id || null;
    }
    return false;
  }

  async function moveGroupRelative(groupId, targetGroupId, placement) {
    if (!api() || _state.mutationBlocked || _groupOrderSaving || groupId === targetGroupId) return;
    const sourceFolder = _state.sourceFolder;
    const group = _state.groups.find(item => item.id === groupId);
    const target = _state.groups.find(item => item.id === targetGroupId);
    if (!group || !target) return;
    const nextParentId = target.parent_id || null;
    if (wouldCreateGroupCycle(group.id, nextParentId)) {
      if (typeof showStatus === 'function') showStatus('子グループの階層へは移動できません', true);
      return;
    }
    const siblings = orderedSiblingGroups(nextParentId).filter(item => item.id !== group.id);
    const targetIndex = siblings.findIndex(item => item.id === target.id);
    if (targetIndex < 0) return;
    siblings.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, group);
    const previousGroups = _state.groups.map(item => ({ ...item }));
    const groupsById = new Map(_state.groups.map(item => [item.id, item]));
    const updates = [];
    for (let index = 0; index < siblings.length; index += 1) {
      const sibling = siblings[index];
      const sortIndex = (index + 1) * 10;
      const patch = {};
      if ((sibling.parent_id || null) !== nextParentId) patch.parent_id = nextParentId;
      if (Number(sibling.sort_index || 0) !== sortIndex) patch.sort_index = sortIndex;
      if (Object.keys(patch).length) {
        updates.push({ id: sibling.id, ...patch });
        Object.assign(groupsById.get(sibling.id), patch);
      }
    }
    if (!updates.length) return;
    _groupOrderSaving = true;
    _state.error = '';
    render();
    try {
      const result = await api().updateGroupOrder(updates, sourceFolder);
      if (sourceFolder !== _state.sourceFolder) return;
      if (Array.isArray(result?.tags)) _state.tags = result.tags;
      if (Array.isArray(result?.groups)) _state.groups = result.groups;
      render();
      if (typeof showStatus === 'function') showStatus('タググループの表示順を保存しました');
    } catch (err) {
      if (sourceFolder !== _state.sourceFolder) return;
      _state.groups = previousGroups;
      render();
      reportError(err, 'タググループの表示順を保存できませんでした');
    } finally {
      _groupOrderSaving = false;
    }
  }

  async function toggleGroupCollapsed(group) {
    const current = _state.groups.find(item => String(item?.id) === String(group?.id));
    const previous = !!(current || group)?.collapsed;
    const next = !previous;
    if (current) current.collapsed = next;
    group.collapsed = next;
    refreshTreeContent();
    try {
      const saved = await api().updateGroup(group.id, { collapsed: next }, _state.sourceFolder);
      if (saved && current) Object.assign(current, saved);
    } catch (err) {
      if (current) current.collapsed = previous;
      group.collapsed = previous;
      refreshTreeContent();
      reportError(err, 'グループを更新できませんでした');
    }
  }

  function groupPath(groupId) {
    const byId = new Map(_state.groups.map(group => [String(group.id), group]));
    const names = [];
    const seen = new Set();
    let cursor = String(groupId || '');
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const group = byId.get(cursor);
      if (!group) break;
      names.push(String(group.name || ''));
      cursor = String(group.parent_id || '');
    }
    return names.reverse().filter(Boolean).join(' > ');
  }

  function currentCatalogCandidates(kind) {
    if (kind === 'group') {
      return _state.groups.map(group => ({
        id: group.id,
        kind: 'group',
        name: group.name,
        aliases: [],
        group_path: groupPath(group.id),
      }));
    }
    return _state.tags.map(tag => ({
      id: tag.id,
      kind: 'tag',
      name: tag.name,
      aliases: tag.aliases || [],
      group_path: groupPath(tag.group_id),
    }));
  }

  async function addChoice(kind, defaultValue) {
    const suggestions = window.MeldexTagCatalogSuggestions;
    if (typeof suggestions?.open === 'function') {
      return suggestions.open({
        kind,
        defaultValue,
        current: currentCatalogCandidates(kind),
        sourceFolder: _state.sourceFolder,
        restoreFocus: document.activeElement,
      });
    }
    const label = kind === 'group' ? 'グループ名' : 'タグ名';
    const value = await promptAsync(label, defaultValue);
    return String(value || '').trim()
      ? { action: 'custom', value: String(value).trim() }
      : null;
  }

  function focusExistingChoice(choice) {
    const item = choice?.item;
    if (!item?.id) return;
    _state.selectedKeys = [rowKey(item.kind, item.id)];
    _state.anchorKey = _state.selectedKeys[0];
    refreshTreeContent();
    if (typeof showStatus === 'function') {
      showStatus(`「${item.name}」は現在のタグ辞書にあります`);
    }
  }

  async function onAddGroup(parentId) {
    try {
      const choice = await addChoice(
        'group',
        uniqueName('新しいグループ', _state.groups.filter(g => (g.parent_id || null) === (parentId || null)).map(g => g.name)),
      );
      if (!choice) return;
      if (choice.action === 'existing') {
        focusExistingChoice(choice);
        return;
      }
      if (choice.action === 'external') {
        await api().materializeExternalSuggestion(choice.item, _state.sourceFolder);
      } else {
        await api().createGroup({ name: choice.value, parent_id: parentId || null }, _state.sourceFolder);
      }
      await refresh(false);
    } catch (err) {
      reportError(err, 'グループを追加できませんでした');
    }
  }

  async function onAddTag(groupId) {
    try {
      const choice = await addChoice(
        'tag',
        uniqueName('新しいタグ', _state.tags.map(t => t.name)),
      );
      if (!choice) return;
      if (choice.action === 'existing') {
        focusExistingChoice(choice);
        return;
      }
      if (choice.action === 'external') {
        await api().materializeExternalSuggestion(choice.item, _state.sourceFolder);
      } else {
        await api().createTag({ name: choice.value, group_id: groupId || null }, _state.sourceFolder);
      }
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
    try { await api().updateGroup(group.id, { name: trimmed }, _state.sourceFolder); await refresh(false); }
    catch (err) { reportError(err, 'グループ名を変更できませんでした'); }
  }

  async function promptColorGroup(group) {
    const next = await promptAsync('グループの色 (#RRGGBB / 空欄で解除)', String(group.color || '').trim() || '#00b894');
    if (next == null) return;
    try { await api().updateGroup(group.id, { color: String(next || '').trim() }, _state.sourceFolder); await refresh(false); }
    catch (err) { reportError(err, '色を変更できませんでした'); }
  }

  async function promptRenameTag(tag) {
    const next = await promptAsync('タグ名', tag.name || '');
    const trimmed = String(next || '').trim();
    if (!trimmed || trimmed === tag.name) return;
    try { await api().updateTag(tag.id, { name: trimmed }, _state.sourceFolder); await refresh(false); }
    catch (err) { reportError(err, 'タグ名を変更できませんでした'); }
  }

  async function promptAliasesTag(tag) {
    const current = Array.isArray(tag.aliases) ? tag.aliases.join(', ') : '';
    const next = await promptAsync('別名（カンマまたは改行で区切ります）', current);
    if (next == null) return;
    try {
      await api().updateTag(tag.id, { aliases: String(next || '') }, _state.sourceFolder);
      await refresh(false);
    } catch (err) {
      reportError(err, '別名を更新できませんでした');
    }
  }

  async function toggleAutoAssignTag(tag) {
    try {
      await api().updateTag(tag.id, { auto_assign: !tag.auto_assign }, _state.sourceFolder);
      await refresh(false);
      if (typeof showStatus === 'function') {
        showStatus(tag.auto_assign ? '自動付与の許可を外しました' : '自動付与を許可しました');
      }
    } catch (err) {
      reportError(err, '自動付与の設定を更新できませんでした');
    }
  }

  async function onDeleteGroup(group) {
    if (!await confirmAsync('グループ「' + group.name + '」を削除しますか？\n直下のタグは未分類に戻ります。')) return;
    try { await api().deleteGroup(group.id, _state.sourceFolder); await refresh(false); }
    catch (err) { reportError(err, 'グループを削除できませんでした'); }
  }

  async function onDeleteTag(tag) {
    if (!await confirmAsync('タグ「' + tag.name + '」を削除しますか？\nこのタグを付けたファイルからもタグが外れます。')) return;
    try { await api().deleteTag(tag.id, _state.sourceFolder); await refresh(false); }
    catch (err) { reportError(err, 'タグを削除できませんでした'); }
  }

  async function onDeleteSelected() {
    const rows = selectedRows();
    if (!rows.length) return;
    if (!await confirmAsync(rows.length + '件のタグ/グループを削除しますか？')) return;
    let failed = 0;
    for (const row of rows.filter(item => item.kind === 'tag')) {
      try { await api().deleteTag(row.id, _state.sourceFolder); } catch (_) { failed += 1; }
    }
    for (const row of rows.filter(item => item.kind === 'group')) {
      try { await api().deleteGroup(row.id, _state.sourceFolder); } catch (_) { failed += 1; }
    }
    _state.selectedKeys = [];
    await refresh(false);
    if (typeof showStatus === 'function') showStatus(rows.length - failed + '件を削除しました' + (failed ? '（' + failed + '件失敗）' : ''), failed > 0);
  }

  function openAddMenu(anchor, groupId) {
    window.MeldexTagManagementOverlays.openMenu(anchor, [
      ['tag', 'タグを追加', () => onAddTag(groupId)],
      ['folder-plus', groupId ? 'サブグループを追加' : '最上位グループを追加', () => onAddGroup(groupId)],
    ], { icon: ic, escapeHtml: esc, safeKey: safeKeyPart });
  }

  function openGroupMenu(anchor, group) {
    window.MeldexTagManagementOverlays.openMenu(anchor, [
      ['pencil', '名前を変更', () => promptRenameGroup(group)],
      ['palette', '色を変更', () => promptColorGroup(group)],
      ['trash-2', '削除', () => onDeleteGroup(group), true],
    ], { icon: ic, escapeHtml: esc, safeKey: safeKeyPart });
  }

  function openTagMenu(anchor, tag) {
    window.MeldexTagManagementOverlays.openMenu(anchor, [
      ['filter', '現在のフォルダをこのタグで絞り込み', () => applyTagFilter(tag)],
      ['search', 'このタグの項目を全検索', () => showSearchForTag(tag)],
      ['pencil', '名前を変更', () => promptRenameTag(tag)],
      ['languages', '別名を編集', () => promptAliasesTag(tag)],
      ['sparkles', tag.auto_assign ? '自動付与の許可を外す' : '自動付与を許可', () => toggleAutoAssignTag(tag)],
      ['trash-2', '削除', () => onDeleteTag(tag), true],
    ], { icon: ic, escapeHtml: esc, safeKey: safeKeyPart });
  }

  async function showSearchForTag(tag) {
    if (!api()) return;
    const sourceFolder = _state.sourceFolder;
    try {
      _state.searchTag = tag;
      _state.searchResults = [];
      render();
      window.MeldexTagManagementOverlays.scrollSearchResultsIntoView(_container);
      const data = await api().searchByTag(tag, sourceFolder);
      if (sourceFolder !== _state.sourceFolder) return;
      _state.searchResults = Array.isArray(data?.results) ? data.results : [];
      render();
      window.MeldexTagManagementOverlays.scrollSearchResultsIntoView(_container);
    } catch (err) {
      if (sourceFolder !== _state.sourceFolder) return;
      _state.searchResults = [];
      reportError(err, 'タグ検索に失敗しました');
      render();
    }
  }

  async function installBuiltinPreset(item) {
    if (!item?.id || _state.installingPresetId) return;
    const sourceFolder = _state.sourceFolder;
    _state.installingPresetId = item.id;
    render();
    try {
      const payload = sourceFolder ? { source_folder: sourceFolder } : {};
      const startPath = '/auto-tag/presets/' + encodeURIComponent(item.id) + '/install';
      const result = typeof runBackgroundJob === 'function'
        ? await runBackgroundJob(startPath, payload, {
          onProgress(progress) {
            if (typeof showStatus === 'function' && progress?.message) showStatus(progress.message);
          },
        })
        : await api()?.installAutoTagPreset?.(item.id, {}, sourceFolder);
      api()?.invalidateTagsCatalogCache?.(sourceFolder);
      window.invalidateAutoTagBundleCache?.();
      await refresh(false);
      if (typeof showStatus === 'function') {
        showStatus(result?.message || `「${item.name}」を自動タグ辞書へ統合しました`);
      }
    } catch (error) {
      reportError(error, `「${item.name}」を導入できませんでした`);
    } finally {
      _state.installingPresetId = '';
      render();
    }
  }

  async function runAutoTagForCurrentFolder() {
    const path = typeof _folderPath !== 'undefined' ? _folderPath : '';
    const sourceFolder = _state.sourceFolder || sourceFolderForPath(path);
    return window.MeldexTagPresetUI?.runAutoTagForFolder?.(path, {
      confirmAsync,
      api: () => ({
        autoTag: payload => api().autoTag({
          ...(payload || {}),
          ...(sourceFolder ? { source_folder: sourceFolder } : {}),
        }),
      }),
      refresh,
      reportError,
    });
  }

  async function resetCurrentTargetTags() {
    const target = currentAutoTagTarget();
    if (!target.path || !target.targets.length) {
      if (typeof showStatus === 'function') showStatus('ファイルまたはフォルダを選択してください', true);
      return;
    }
    const label = target.targets.length > 1
      ? `${target.targets.length.toLocaleString('ja-JP')}件の選択項目`
      : (target.recursive ? 'フォルダ内すべてのファイル' : '選択ファイル');
    const message = `${label}から、手動タグと自動タグを含むすべてのタグを外します。\nこの操作は元に戻せません。続行しますか？`;
    const confirmed = typeof cfConfirm === 'function'
      ? await cfConfirm(message, { danger: true, okLabel: 'すべて外す' })
      : window.confirm(message);
    if (!confirmed) return;
    const targetPayload = target.targets.length > 1
      ? { targets: target.targets, label }
      : { path: target.path, recursive: target.recursive, label };
    try {
      await window.MeldexAutoTagJobs.startReset({
        ...targetPayload,
        source_folder: _state.sourceFolder || sourceFolderForPath(target.path),
        reset_mode: 'all',
      }, { label });
    } catch (error) {
      reportError(error, 'タグの一括リセットを開始できませんでした');
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

  function handleTagDictionaryChanged(event) {
    const detail = event?.detail || {};
    const changedSource = String(detail.source_folder || '').trim();
    if (changedSource !== String(_state.sourceFolder || '').trim()) return;
    if (Array.isArray(detail.result?.tags) && Array.isArray(detail.result?.groups)) {
      _state.tags = detail.result.tags;
      _state.groups = detail.result.groups;
      pruneSelection();
      render();
      return;
    }
    clearTimeout(_catalogRefreshTimer);
    _catalogRefreshTimer = setTimeout(() => {
      _catalogRefreshTimer = 0;
      void refresh(false);
    }, 80);
  }

  function handleTagSummaryChanged() {
    window.MeldexTagGroupSummary?.invalidate?.();
    window.MeldexTagGroupSummary?.ensure?.(() => {
      if (_container?.isConnected) refreshGroupSummaryCounts();
    });
    if (_container?.isConnected) refreshGroupSummaryCounts();
  }

  function renderTagManagementTab(container, options) {
    const nextContainer = container || null;
    const canReuse = !options?.force
      && nextContainer === _container
      && nextContainer?.dataset?.tagManagementMounted === '1'
      && !!nextContainer.querySelector?.('.gb-tag-management-body');
    _container = nextContainer;
    if (!_container) return;
    if (canReuse) {
      const existing = _container.querySelector('[data-tag-auto-run-section]');
      if ((window.MeldexTagPanelTabs?.activeTab?.() || 'tag-tree') === 'auto-tag') {
        mountAutoTagSection(existing);
      } else {
        existing?.remove();
      }
      return;
    }
    _container.dataset.tagManagementMounted = '1';
    if (!_state.tags.length && !_state.groups.length && !_state.error) {
      _state.loading = true;
      render();
      refresh(false);
    } else {
      render();
      refresh(false);
    }
  }

  window.addEventListener?.('meldex:tag-dictionary-changed', handleTagDictionaryChanged);
  window.addEventListener?.('meldex:target-tags-changed', handleTagSummaryChanged);
  document.addEventListener?.('meldex:auto-tag-job-finished', handleTagSummaryChanged);
  window.renderTagManagementTab = renderTagManagementTab;
  window.MeldexTagManagement = {
    render: () => render(),
    refresh,
    showSearchForTag,
    setAutoTagTarget,
    setAutoTagTargets,
    setContainer: container => { _container = container; },
    sourceFolder: () => _state.sourceFolder,
    targetContext: () => currentAutoTagTarget(),
    selectedRows,
  };
})();
