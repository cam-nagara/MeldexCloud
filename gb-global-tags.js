(function () {
  'use strict';

  // ====================================================================
  // グローバルタグ機能 (v2: タググループ対応)
  //   - API ラッパー (タグ / グループ / 対象ファイル別)
  //   - ファイル別タグ編集 UI (オプションパネル下部などに埋め込み)
  //   - タグ管理タブ本体は gb-tag-management.js 側で実装
  // ====================================================================

  let cache = [];
  let targetEditorSeq = 0;

  function icon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 14) : '';
  }

  function tagColor(value) {
    const color = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : '';
  }

  function effectiveTagColor(tag, groupsById) {
    // タグの実効色 = 所属グループの色を優先、なければタグ自身の色、なければアクセント
    if (tag && tag.group_id && groupsById && groupsById[tag.group_id]) {
      const groupColor = tagColor(groupsById[tag.group_id].color);
      if (groupColor) return groupColor;
    }
    const own = tagColor(tag && tag.color);
    return own || 'var(--accent)';
  }

  // ============================================================
  // API ラッパー (タグ)
  // ============================================================
  async function loadTags() {
    if (typeof apiFetch !== 'function') return { tags: [], groups: [] };
    return apiFetch('/global-tags', { silentError: true });
  }

  async function createTag(payload) {
    return apiPost('/global-tags', payload || {}, { silentError: true });
  }

  async function updateTag(tagId, payload) {
    return apiFetch('/global-tags/' + encodeURIComponent(tagId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
      silentError: true,
    });
  }

  async function deleteTag(tagId) {
    return apiFetch('/global-tags/' + encodeURIComponent(tagId), { method: 'DELETE', silentError: true });
  }

  // ============================================================
  // API ラッパー (タググループ)
  // ============================================================
  async function loadGroups() {
    if (typeof apiFetch !== 'function') return { groups: [], tags: [] };
    return apiFetch('/global-tag-groups', { silentError: true });
  }

  async function createGroup(payload) {
    return apiPost('/global-tag-groups', payload || {}, { silentError: true });
  }

  async function updateGroup(groupId, payload) {
    return apiFetch('/global-tag-groups/' + encodeURIComponent(groupId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
      silentError: true,
    });
  }

  async function deleteGroup(groupId) {
    return apiFetch('/global-tag-groups/' + encodeURIComponent(groupId), { method: 'DELETE', silentError: true });
  }

  // ============================================================
  // API ラッパー (タグプリセット / 自動タグ付け)
  // ============================================================
  async function loadPresets() {
    if (typeof apiFetch !== 'function') return { presets: [] };
    return apiFetch('/global-tag-presets', { silentError: true });
  }

  async function createPreset(payload) {
    return apiPost('/global-tag-presets', payload || {}, { silentError: true });
  }

  async function duplicatePreset(presetId, payload) {
    return apiPost('/global-tag-presets/' + encodeURIComponent(presetId) + '/duplicate', payload || {}, { silentError: true });
  }

  async function deletePreset(presetId) {
    return apiFetch('/global-tag-presets/' + encodeURIComponent(presetId), { method: 'DELETE', silentError: true });
  }

  async function saveCurrentPreset(presetId, payload) {
    return apiPost('/global-tag-presets/' + encodeURIComponent(presetId) + '/save-current', payload || {}, { silentError: true });
  }

  async function loadPreset(presetId, payload) {
    return apiPost('/global-tag-presets/' + encodeURIComponent(presetId) + '/load', payload || {}, { silentError: true });
  }

  async function autoTag(payload) {
    return apiPost('/global-tags/auto-tag', payload || {}, { silentError: true });
  }

  // ============================================================
  // API ラッパー (対象ファイル別タグ)
  // ============================================================
  function normalizeTargetPath(path) {
    return String(path || '').trim();
  }

  function targetTagsUrl(path) {
    return '/global-tags/target?path=' + encodeURIComponent(normalizeTargetPath(path));
  }

  function notifyTargetTagsChanged(path) {
    try {
      if (typeof _folderInvalidateTagsForPath === 'function') _folderInvalidateTagsForPath(path);
      const cfg = typeof getFolderDisplayConfig === 'function' ? getFolderDisplayConfig() : {};
      if (typeof _folderHasActiveTagFilter === 'function' && _folderHasActiveTagFilter(cfg) && typeof _folderEnsureTags === 'function') {
        _folderEnsureTags(typeof _folderItems !== 'undefined' ? _folderItems : [], { rerender: true });
      }
    } catch (_) {}
  }

  async function loadTargetTags(path) {
    if (typeof apiFetch !== 'function') return { tags: [] };
    return apiFetch(targetTagsUrl(path), { silentError: true });
  }

  async function addTargetTag(path, name) {
    const result = await apiPost('/global-tags/target', { path: normalizeTargetPath(path), name: String(name || '').trim() }, { silentError: true });
    notifyTargetTagsChanged(path);
    return result;
  }

  async function removeTargetTag(path, tag) {
    const tagKey = tag?.id || tag?.name || tag || '';
    const result = await apiFetch(targetTagsUrl(path) + '&tag=' + encodeURIComponent(tagKey), { method: 'DELETE', silentError: true });
    notifyTargetTagsChanged(path);
    return result;
  }

  async function searchByTag(tag) {
    const name = tag?.name || tag || '';
    if (!name) return { results: [] };
    return apiFetch('/global-tags/search?tag=' + encodeURIComponent(name), { silentError: true });
  }

  function openTaggedTarget(item) {
    if (!item?.path) return;
    if (typeof openFolderItem === 'function') {
      openFolderItem(item);
      return;
    }
    if (item.type === 'folder' && typeof openFolder === 'function') openFolder(item.name || item.path, item.path);
    else if (typeof openSearchResult === 'function') openSearchResult(item.path, item.type || '');
  }

  // ============================================================
  // ファイル別タグ編集 UI (オプションパネルのファイル詳細などに埋め込み)
  // ============================================================
  async function refreshTargetTagOptions(datalist) {
    if (!datalist) return;
    try {
      const data = await loadTags();
      cache = Array.isArray(data?.tags) ? data.tags : [];
      datalist.textContent = '';
      cache.forEach(tag => {
        const option = document.createElement('option');
        option.value = tag.name || '';
        datalist.appendChild(option);
      });
    } catch (_) {
      // 候補が取れなくても、タグの直接入力はそのまま使える。
    }
  }

  function buildTargetTagEditorUi(container, options) {
    const section = document.createElement('div');
    section.className = options?.boxed === false ? '' : 'gb-section gb-section--boxed';
    section.classList.add('gb-global-tags-target-editor');
    section.style.marginTop = options?.compact ? '8px' : '12px';

    const title = document.createElement('div');
    title.className = 'gb-section-title';
    title.innerHTML = icon('tags', 14) + ' タグ';
    section.appendChild(title);

    const chips = document.createElement('div');
    chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;';
    section.appendChild(chips);

    const row = document.createElement('div');
    row.className = 'gb-field-row';
    row.style.cssText = 'gap:4px;margin-top:6px;';
    const editorId = 'global-tags-target-editor-' + (++targetEditorSeq);
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'タグ名';
    input.className = 'gb-input';
    input.style.minWidth = '0';
    input.style.flex = '1';
    input.dataset.e2eId = editorId + '-input';
    input.dataset.globalTagsRole = 'target-input';
    input.setAttribute('aria-label', 'タグ名');
    const datalist = document.createElement('datalist');
    datalist.id = editorId + '-options';
    input.setAttribute('list', datalist.id);
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'gb-btn gb-btn-sm';
    add.dataset.e2eId = editorId + '-add';
    add.dataset.globalTagsRole = 'target-add';
    add.setAttribute('aria-label', 'タグを追加');
    add.innerHTML = icon('plus', 14) + ' 追加';
    row.append(input, add);
    section.appendChild(row);
    section.appendChild(datalist);

    const msg = document.createElement('div');
    msg.className = 'gb-section-desc';
    msg.style.marginTop = '4px';
    section.appendChild(msg);
    container.appendChild(section);
    return { chips, input, datalist, add, msg };
  }

  async function refreshTargetEditorTags(targetPath, ui, refresh) {
    ui.msg.textContent = 'タグを読み込んでいます...';
    try {
      const data = await loadTargetTags(targetPath);
      const tags = Array.isArray(data?.tags) ? data.tags : [];
      ui.chips.textContent = '';
      if (!tags.length) {
        const empty = document.createElement('span');
        empty.className = 'gb-section-desc';
        empty.textContent = 'タグはありません。';
        ui.chips.appendChild(empty);
      }
      // 実効色のために最新のグループ情報も取る
      let groupsById = {};
      try {
        const meta = await loadTags();
        const groups = Array.isArray(meta?.groups) ? meta.groups : [];
        groupsById = Object.fromEntries(groups.map(g => [g.id, g]));
      } catch (_) {}
      tags.forEach(tag => ui.chips.appendChild(targetTagChip(targetPath, tag, refresh, message => { ui.msg.textContent = message; }, groupsById)));
      ui.msg.textContent = '';
    } catch (err) {
      ui.msg.textContent = 'タグを読み込めませんでした: ' + (err.userMessage || err.message || err);
    }
  }

  function bindTargetTagEditor(targetPath, ui, refresh) {
    const addCurrent = async () => {
      const name = ui.input.value.trim();
      if (!name) return;
      try {
        await addTargetTag(targetPath, name);
        ui.input.value = '';
        await refresh();
        await refreshTargetTagOptions(ui.datalist);
        if (window.MeldexTagManagement && typeof window.MeldexTagManagement.refresh === 'function') {
          window.MeldexTagManagement.refresh();
        }
      } catch (err) {
        ui.msg.textContent = 'タグを追加できませんでした: ' + (err.userMessage || err.message || err);
      }
    };
    ui.add.addEventListener('click', addCurrent);
    ui.input.addEventListener('keydown', event => {
      if (event.key === 'Enter') addCurrent();
    });
  }

  function renderTargetTagEditor(container, path, options) {
    if (!container) return;
    const targetPath = normalizeTargetPath(path || container.dataset.globalTagsTargetPath);
    container.textContent = '';
    if (!targetPath) return;
    const ui = buildTargetTagEditorUi(container, options);
    const refresh = () => refreshTargetEditorTags(targetPath, ui, refresh);
    bindTargetTagEditor(targetPath, ui, refresh);
    refreshTargetTagOptions(ui.datalist);
    refresh();
  }

  function targetTagChip(path, tag, refresh, onError, groupsById) {
    const chip = document.createElement('span');
    chip.className = 'gb-tag-chip';
    chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;border:1px solid var(--border);border-radius:999px;padding:2px 6px;background:var(--bg3);font-size:12px;';
    const swatch = document.createElement('span');
    swatch.style.cssText = 'width:9px;height:9px;border-radius:50%;border:1px solid var(--border);';
    swatch.style.background = effectiveTagColor(tag, groupsById || {});
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'gb-btn gb-btn-xs gb-btn-quiet';
    name.style.padding = '0';
    const displayName = tag.name || '';
    name.textContent = displayName;
    name.title = 'このタグの項目を検索';
    name.setAttribute('aria-label', (displayName || 'タグ') + 'の項目を検索');
    const targetKey = normalizeTargetPath(path);
    const tagKey = String(tag?.id || tag?.name || 'tag');
    name.dataset.e2eId = `global-tags-target-search:${targetKey}:${tagKey}`;
    name.dataset.globalTagsRole = 'target-search';
    name.addEventListener('click', () => {
      // タグ管理タブが開いていればそちらで検索結果を表示、そうでなければ後方互換でメッセージ
      if (window.MeldexTagManagement && typeof window.MeldexTagManagement.showSearchForTag === 'function') {
        window.MeldexTagManagement.showSearchForTag(tag);
      } else {
        searchByTag(tag);
      }
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'gb-btn gb-btn-xs gb-btn-quiet';
    remove.style.padding = '0 2px';
    remove.title = 'タグを外す';
    remove.setAttribute('aria-label', (displayName || 'タグ') + 'を外す');
    remove.dataset.e2eId = `global-tags-target-remove:${targetKey}:${tagKey}`;
    remove.dataset.globalTagsRole = 'target-remove';
    remove.innerHTML = icon('x', 12) || '×';
    remove.addEventListener('click', async () => {
      try {
        await removeTargetTag(path, tag);
        await refresh();
      } catch (err) {
        if (typeof onError === 'function') onError('タグを外せませんでした: ' + (err.userMessage || err.message || err));
      }
    });
    chip.append(swatch, name, remove);
    return chip;
  }

  function hydrateTargetEditors(root) {
    const scope = root || document;
    scope.querySelectorAll?.('[data-global-tags-target-path]').forEach(el => {
      if (el.dataset.globalTagsHydrated === '1') return;
      el.dataset.globalTagsHydrated = '1';
      renderTargetTagEditor(el, el.dataset.globalTagsTargetPath || '', { compact: true });
    });
  }

  // ============================================================
  // エクスポート
  // ============================================================
  window.renderGlobalTagTargetEditor = renderTargetTagEditor;
  window.hydrateGlobalTagTargetEditors = hydrateTargetEditors;
  window.searchGlobalTagTargets = searchByTag;

  // タグ管理タブやファイル別エディタから使う API/ユーティリティ群を一括公開
  window.MeldexGlobalTags = {
    // タグ
    loadTags,
    createTag,
    updateTag,
    deleteTag,
    // グループ
    loadGroups,
    createGroup,
    updateGroup,
    deleteGroup,
    // プリセット / 自動タグ
    loadPresets,
    createPreset,
    duplicatePreset,
    deletePreset,
    saveCurrentPreset,
    loadPreset,
    autoTag,
    // 対象ファイル別
    loadTargetTags,
    addTargetTag,
    removeTargetTag,
    searchByTag,
    openTaggedTarget,
    // 色
    tagColor,
    effectiveTagColor,
  };
})();
