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
  const targetTagsCache = new Map();
  const TARGET_TAGS_CACHE_TTL_MS = 2000;

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
  function normalizedSourceFolder(value) {
    return String(value || '').trim();
  }

  function sourceCacheKey(value) {
    return normalizedSourceFolder(value) || '__default__';
  }

  function sourceFolderForTarget(path) {
    return normalizedSourceFolder(window.MeldexAutoTagSourceFolder?.(path));
  }

  function withSourceQuery(path, sourceFolder) {
    const source = normalizedSourceFolder(sourceFolder);
    if (!source) return path;
    return path + (path.includes('?') ? '&' : '?') + 'source_folder=' + encodeURIComponent(source);
  }

  function withSourcePayload(payload, sourceFolder) {
    const source = normalizedSourceFolder(sourceFolder);
    return source ? { ...(payload || {}), source_folder: source } : { ...(payload || {}) };
  }

  async function loadTags(sourceFolder) {
    if (typeof apiFetch !== 'function') return { tags: [], groups: [] };
    return apiFetch(withSourceQuery('/global-tags', sourceFolder), { silentError: true });
  }

  // シートの共通タグ列など、大量のセル描画で同一データを繰り返し参照する用途向けの
  // 短期キャッシュ付きラッパー。タグ/グループの変更操作（作成・更新・削除）で即座に破棄される。
  const _tagsCatalogCache = new Map(); // source_folder -> { at: number, promise: Promise }
  const _tagsCatalogLastResolved = new Map(); // source_folder -> 直近で解決済みの値
  const TAGS_CATALOG_CACHE_TTL_MS = 3000;
  function invalidateTagsCatalogCache(sourceFolder) {
    if (arguments.length === 0) {
      _tagsCatalogCache.clear();
      _tagsCatalogLastResolved.clear();
      return;
    }
    const key = sourceCacheKey(sourceFolder);
    _tagsCatalogCache.delete(key);
    _tagsCatalogLastResolved.delete(key);
  }
  function notifyTagsCatalogChanged(reason, result, sourceFolder) {
    try {
      window.dispatchEvent(new CustomEvent('meldex:tag-dictionary-changed', {
        detail: {
          reason: String(reason || ''),
          result: result || null,
          source_folder: normalizedSourceFolder(sourceFolder),
        },
      }));
    } catch {}
  }
  function loadTagsCached(sourceFolder) {
    const key = sourceCacheKey(sourceFolder);
    const cached = _tagsCatalogCache.get(key);
    if (cached && (Date.now() - cached.at) < TAGS_CATALOG_CACHE_TTL_MS) {
      return cached.promise;
    }
    const promise = loadTags(sourceFolder).then(data => {
      _tagsCatalogLastResolved.set(key, data);
      return data;
    }).catch(err => {
      invalidateTagsCatalogCache(sourceFolder);
      throw err;
    });
    _tagsCatalogCache.set(key, { at: Date.now(), promise });
    return promise;
  }
  // 同期参照用: 直近で解決済みのタグカタログ（未取得なら null）。フィルタ適用など
  // 「非同期を待てない場面で、できれば最新値を使いたい」用途向けのベストエフォート参照。
  function getCachedTagsSync(sourceFolder) {
    return _tagsCatalogLastResolved.get(sourceCacheKey(sourceFolder)) || null;
  }

  // 複数条件フィルタ向け: 共通タグ列の「含む/含まない」に入力された文字列がタグ名の
  // 完全一致であれば、保存値（タグID）に変換する。キャッシュ未取得やヒット無しの場合は
  // 入力をそのまま返す（IDそのものを直接入力した場合や、キャッシュ未温まりでも
  // クラッシュせず、単に一致しない = 0件として扱われるだけの安全側フォールバック）。
  function resolveCommonTagsFilterValueSync(dbPath, propName, rawValue) {
    const text = String(rawValue || '').trim();
    if (!text) return rawValue;
    try {
      const ptc = typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath)?.[propName] : null;
      if (!ptc || ptc.type !== 'common-tags') return rawValue;
    } catch { return rawValue; }
    const cached = getCachedTagsSync(sourceFolderForTarget(dbPath));
    const allTags = Array.isArray(cached?.tags) ? cached.tags : [];
    const match = allTags.find(tag => String(tag.name || '').trim().toLowerCase() === text.toLowerCase());
    return match ? String(match.id) : rawValue;
  }

  async function createTag(payload, sourceFolder) {
    const result = await apiPost('/global-tags', withSourcePayload(payload, sourceFolder), { silentError: true });
    invalidateTagsCatalogCache(sourceFolder);
    notifyTagsCatalogChanged('tag-created', result, sourceFolder);
    return result;
  }

  async function updateTag(tagId, payload, sourceFolder) {
    const result = await apiFetch('/global-tags/' + encodeURIComponent(tagId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withSourcePayload(payload, sourceFolder)),
      silentError: true,
    });
    invalidateTagsCatalogCache(sourceFolder);
    notifyTagsCatalogChanged('tag-updated', result, sourceFolder);
    return result;
  }

  async function deleteTag(tagId, sourceFolder) {
    const result = await apiFetch(withSourceQuery('/global-tags/' + encodeURIComponent(tagId), sourceFolder), { method: 'DELETE', silentError: true });
    invalidateTagsCatalogCache(sourceFolder);
    notifyTagsCatalogChanged('tag-deleted', result, sourceFolder);
    return result;
  }

  // ============================================================
  // API ラッパー (タググループ)
  // ============================================================
  async function loadGroups(sourceFolder) {
    if (typeof apiFetch !== 'function') return { groups: [], tags: [] };
    return apiFetch(withSourceQuery('/global-tag-groups', sourceFolder), { silentError: true });
  }

  async function createGroup(payload, sourceFolder) {
    const result = await apiPost('/global-tag-groups', withSourcePayload(payload, sourceFolder), { silentError: true });
    invalidateTagsCatalogCache(sourceFolder);
    notifyTagsCatalogChanged('group-created', result, sourceFolder);
    return result;
  }

  async function updateGroup(groupId, payload, sourceFolder) {
    const result = await apiFetch('/global-tag-groups/' + encodeURIComponent(groupId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withSourcePayload(payload, sourceFolder)),
      silentError: true,
    });
    invalidateTagsCatalogCache(sourceFolder);
    notifyTagsCatalogChanged('group-updated', result, sourceFolder);
    return result;
  }

  async function deleteGroup(groupId, sourceFolder) {
    const result = await apiFetch(withSourceQuery('/global-tag-groups/' + encodeURIComponent(groupId), sourceFolder), { method: 'DELETE', silentError: true });
    invalidateTagsCatalogCache(sourceFolder);
    notifyTagsCatalogChanged('group-deleted', result, sourceFolder);
    return result;
  }

  // ============================================================
  // API ラッパー (自動タグ辞書のプリセット所属 / 自動タグ付け)
  // ============================================================
  async function loadAutoTagPresets(sourceFolder) {
    if (typeof apiFetch !== 'function') return { preset_names: [], builtins: [] };
    return apiFetch(withSourceQuery('/auto-tag/presets', sourceFolder), { silentError: true });
  }

  async function installAutoTagPreset(presetId, payload, sourceFolder) {
    const result = await apiPost(
      '/auto-tag/presets/' + encodeURIComponent(presetId) + '/install',
      withSourcePayload(payload, sourceFolder),
      { silentError: true },
    );
    invalidateTagsCatalogCache(sourceFolder);
    notifyTagsCatalogChanged('preset-installed', result, sourceFolder);
    return result;
  }

  async function resolveTagDictionaryConflict(strategy, conflictId, sourceFolder) {
    const result = await apiPost(
      '/auto-tag/dictionary/resolve',
      withSourcePayload({
        strategy: String(strategy || ''),
        conflict_id: String(conflictId || ''),
      }, sourceFolder),
      { silentError: true },
    );
    invalidateTagsCatalogCache(sourceFolder);
    notifyTagsCatalogChanged('dictionary-conflict-resolved', result, sourceFolder);
    return result;
  }

  async function autoTag(payload) {
    if (window.MeldexAutoTagJobs?.start) {
      return window.MeldexAutoTagJobs.start(payload || {});
    }
    const result = await apiPost('/global-tags/auto-tag', payload || {}, { silentError: true });
    invalidateTagsCatalogCache(payload?.source_folder);
    return result;
  }

  // ============================================================
  // API ラッパー (対象ファイル別タグ)
  // ============================================================
  function normalizeTargetPath(path) {
    return String(path || '').trim();
  }

  function targetTagsUrl(path, sourceFolder) {
    return withSourceQuery(
      '/global-tags/target?path=' + encodeURIComponent(normalizeTargetPath(path)),
      sourceFolder,
    );
  }

  function targetTagsCacheKey(path, sourceFolder) {
    return sourceCacheKey(sourceFolder) + '\n' + normalizeTargetPath(path);
  }

  function notifyTargetTagsChanged(path, sourceFolder) {
    targetTagsCache.delete(targetTagsCacheKey(path, sourceFolder));
    try {
      if (typeof _folderInvalidateTagsForPath === 'function') _folderInvalidateTagsForPath(path);
      const cfg = typeof getFolderDisplayConfig === 'function' ? getFolderDisplayConfig() : {};
      const needsFolderRefresh = cfg.showTags !== false
        || (typeof _folderHasActiveTagFilter === 'function' && _folderHasActiveTagFilter(cfg));
      if (needsFolderRefresh && typeof _folderEnsureTags === 'function') {
        _folderEnsureTags(typeof _folderItems !== 'undefined' ? _folderItems : [], { rerender: true });
      }
    } catch (_) {}
  }

  async function loadTargetTags(path, options) {
    if (typeof apiFetch !== 'function') return { tags: [] };
    const sourceFolder = normalizedSourceFolder(options?.sourceFolder) || sourceFolderForTarget(path);
    const key = targetTagsCacheKey(path, sourceFolder);
    const cached = targetTagsCache.get(key);
    if (!options?.force && cached && (Date.now() - cached.at) < TARGET_TAGS_CACHE_TTL_MS) {
      return cached.promise;
    }
    const promise = apiFetch(targetTagsUrl(path, sourceFolder), { silentError: true }).catch(error => {
      targetTagsCache.delete(key);
      throw error;
    });
    targetTagsCache.set(key, { at: Date.now(), promise });
    return promise;
  }

  async function addTargetTag(path, name) {
    const sourceFolder = sourceFolderForTarget(path);
    const result = await apiPost('/global-tags/target', withSourcePayload({
      path: normalizeTargetPath(path),
      name: String(name || '').trim(),
    }, sourceFolder), { silentError: true });
    notifyTargetTagsChanged(path, sourceFolder);
    return result;
  }

  async function removeTargetTag(path, tag) {
    const tagKey = tag?.id || tag?.name || tag || '';
    const sourceFolder = sourceFolderForTarget(path);
    const result = await apiFetch(targetTagsUrl(path, sourceFolder) + '&tag=' + encodeURIComponent(tagKey), { method: 'DELETE', silentError: true });
    notifyTargetTagsChanged(path, sourceFolder);
    return result;
  }

  async function searchByTag(tag, sourceFolder) {
    const name = tag?.name || tag || '';
    if (!name) return { results: [] };
    return apiFetch(withSourceQuery('/global-tags/search?tag=' + encodeURIComponent(name), sourceFolder), { silentError: true });
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
  async function refreshTargetTagOptions(datalist, targetPath) {
    if (!datalist) return;
    try {
      const data = await loadTagsCached(sourceFolderForTarget(targetPath));
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

    const osSyncRow = document.createElement('div');
    osSyncRow.style.cssText = 'display:none;align-items:center;gap:6px;flex-wrap:wrap;margin-top:6px;';
    const osSync = document.createElement('button');
    osSync.type = 'button';
    osSync.className = 'gb-btn gb-btn-sm gb-btn-quiet';
    osSync.dataset.globalTagsRole = 'os-sync';
    osSync.setAttribute('aria-label', 'OSタグを再同期');
    osSync.innerHTML = icon('refreshCw', 14) + ' OSタグを再同期';
    const osSyncStatus = document.createElement('span');
    osSyncStatus.className = 'gb-section-desc';
    osSyncRow.append(osSync, osSyncStatus);
    section.appendChild(osSyncRow);
    container.appendChild(section);
    return { chips, input, datalist, add, msg, osSyncRow, osSync, osSyncStatus };
  }

  function renderOsTagSyncState(ui, state) {
    if (!ui?.osSyncRow) return;
    const applicable = !!state?.applicable;
    ui.osSyncRow.style.display = applicable ? 'flex' : 'none';
    if (!applicable) return;
    ui.osSync.disabled = !!ui.mutationBlocked || !state?.supported;
    if (state?.warning) {
      ui.osSyncStatus.textContent = state.warning;
    } else if (state?.supported) {
      ui.osSyncStatus.textContent = state.mode === 'explicit-only'
        ? '必要なときだけWindowsの画像タグと照合します'
        : 'Windowsの画像タグと同期済み';
    } else {
      ui.osSyncStatus.textContent = 'この画像形式ではOSタグを利用できません';
    }
  }

  async function refreshTargetEditorTags(targetPath, ui, refresh, options) {
    ui.msg.textContent = 'タグを読み込んでいます...';
    try {
      const data = await loadTargetTags(targetPath, options);
      const tags = Array.isArray(data?.tags) ? data.tags : [];
      ui.mutationBlocked = !!data?.mutation_blocked;
      ui.input.disabled = ui.mutationBlocked;
      ui.add.disabled = ui.mutationBlocked;
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
        const meta = await loadTagsCached(sourceFolderForTarget(targetPath));
        const groups = Array.isArray(meta?.groups) ? meta.groups : [];
        groupsById = Object.fromEntries(groups.map(g => [g.id, g]));
      } catch (_) {}
      tags.forEach(tag => ui.chips.appendChild(targetTagChip(
        targetPath,
        tag,
        refresh,
        message => { ui.msg.textContent = message; },
        groupsById,
        ui.mutationBlocked,
      )));
      ui.msg.textContent = ui.mutationBlocked
        ? (data?.warning || 'タグ辞書の同期競合を解消してからタグを編集してください。')
        : '';
      renderOsTagSyncState(ui, data?.os_sync);
    } catch (err) {
      renderTargetEditorError(ui.msg, 'タグを読み込めませんでした', err, () => refresh({ force: true }));
    }
  }

  function renderTargetEditorError(host, label, error, retry) {
    if (!host) return;
    host.replaceChildren();
    const text = document.createElement('span');
    text.textContent = label + ': ' + (error?.userMessage || error?.message || error);
    host.appendChild(text);
    if (typeof retry !== 'function') return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gb-btn gb-btn-xs gb-btn-quiet';
    button.style.marginLeft = '6px';
    button.textContent = '再試行';
    button.setAttribute('aria-label', 'タグを再読み込み');
    button.addEventListener('click', () => retry());
    host.appendChild(button);
  }

  function bindTargetTagEditor(targetPath, ui, refresh) {
    const addCurrent = async () => {
      if (ui.mutationBlocked) return;
      const name = ui.input.value.trim();
      if (!name) return;
      ui.add.disabled = true;
      try {
        await addTargetTag(targetPath, name);
        ui.input.value = '';
        await refresh();
        await refreshTargetTagOptions(ui.datalist, targetPath);
        if (window.MeldexTagManagement && typeof window.MeldexTagManagement.refresh === 'function') {
          window.MeldexTagManagement.refresh();
        }
      } catch (err) {
        renderTargetEditorError(ui.msg, 'タグを追加できませんでした', err, refresh);
      } finally {
        ui.add.disabled = !!ui.mutationBlocked;
      }
    };
    ui.add.addEventListener('click', addCurrent);
    ui.input.addEventListener('keydown', event => {
      if (event.key === 'Enter') addCurrent();
    });
    ui.osSync.addEventListener('click', async () => {
      if (ui.mutationBlocked) return;
      ui.osSync.disabled = true;
      ui.osSyncStatus.textContent = 'OSタグを照合しています...';
      try {
        const sourceFolder = sourceFolderForTarget(targetPath);
        targetTagsCache.delete(targetTagsCacheKey(targetPath, sourceFolder));
        const data = await apiPost('/global-tags/target/sync', withSourcePayload({
          path: normalizeTargetPath(targetPath),
        }, sourceFolder), { silentError: true });
        renderOsTagSyncState(ui, data?.os_sync);
        await refresh();
        notifyTargetTagsChanged(targetPath, sourceFolder);
      } catch (err) {
        ui.osSyncStatus.textContent = 'OSタグを再同期できませんでした: ' + (err.userMessage || err.message || err);
      } finally {
        ui.osSync.disabled = !!ui.mutationBlocked;
      }
    });
  }

  function renderTargetTagEditor(container, path, options) {
    if (!container) return;
    const targetPath = normalizeTargetPath(path || container.dataset.globalTagsTargetPath);
    container.textContent = '';
    if (!targetPath) return;
    const ui = buildTargetTagEditorUi(container, options);
    const refresh = options => refreshTargetEditorTags(targetPath, ui, refresh, options);
    bindTargetTagEditor(targetPath, ui, refresh);
    refreshTargetTagOptions(ui.datalist, targetPath);
    refresh();
  }

  function targetTagChip(path, tag, refresh, onError, groupsById, mutationBlocked) {
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
        searchByTag(tag, sourceFolderForTarget(path));
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
    remove.disabled = !!mutationBlocked;
    if (mutationBlocked) remove.title = 'タグ辞書の同期競合を解消してから編集してください';
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
  // 汎用タグエディタ（get/set コールバック対象向け）
  //   ボードのカード・シートの行・クイックメモなど、ファイルパスを持たず
  //   データ本体へタグID配列を直接埋め込む対象向け。表示は buildTargetTagEditorUi を共用する。
  //   options: { getIds(): string[], setIds(ids: string[]): void, onChange?(): void, compact?: boolean, boxed?: boolean }
  // ============================================================
  function renderInlineTagEditor(container, options) {
    if (!container) return;
    if (typeof options?.getIds !== 'function' || typeof options?.setIds !== 'function') return;
    container.textContent = '';
    const ui = buildTargetTagEditorUi(container, options);
    const refresh = () => refreshInlineTagEditorTags(options, ui, refresh);
    bindInlineTagEditor(options, ui, refresh);
    refreshTargetTagOptions(ui.datalist);
    refresh();
  }

  async function refreshInlineTagEditorTags(options, ui, refresh) {
    ui.msg.textContent = 'タグを読み込んでいます...';
    try {
      const data = await loadTagsCached();
      const allTags = Array.isArray(data?.tags) ? data.tags : [];
      ui.mutationBlocked = !!data?.mutation_blocked;
      ui.input.disabled = ui.mutationBlocked;
      ui.add.disabled = ui.mutationBlocked;
      const groups = Array.isArray(data?.groups) ? data.groups : [];
      const groupsById = Object.fromEntries(groups.map(g => [g.id, g]));
      const idSet = new Set((options.getIds() || []).map(id => String(id)));
      const tags = allTags.filter(tag => idSet.has(String(tag.id)));
      ui.chips.textContent = '';
      if (!tags.length) {
        const empty = document.createElement('span');
        empty.className = 'gb-section-desc';
        empty.textContent = 'タグはありません。';
        ui.chips.appendChild(empty);
      }
      tags.forEach(tag => ui.chips.appendChild(inlineTagChip(
        tag,
        options,
        refresh,
        message => { ui.msg.textContent = message; },
        groupsById,
        ui.mutationBlocked,
      )));
      ui.msg.textContent = ui.mutationBlocked
        ? (data?.warning || 'タグ辞書の同期競合を解消してからタグを編集してください。')
        : '';
    } catch (err) {
      ui.msg.textContent = 'タグを読み込めませんでした: ' + (err.userMessage || err.message || err);
    }
  }

  function inlineTagChip(tag, options, refresh, onError, groupsById, mutationBlocked) {
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
    const tagKey = String(tag?.id || tag?.name || 'tag');
    name.dataset.e2eId = `global-tags-inline-search:${tagKey}`;
    name.dataset.globalTagsRole = 'inline-search';
    name.addEventListener('click', () => {
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
    remove.dataset.e2eId = `global-tags-inline-remove:${tagKey}`;
    remove.dataset.globalTagsRole = 'inline-remove';
    remove.innerHTML = icon('x', 12) || '×';
    remove.disabled = !!mutationBlocked;
    if (mutationBlocked) remove.title = 'タグ辞書の同期競合を解消してから編集してください';
    remove.addEventListener('click', () => {
      try {
        const nextIds = (options.getIds() || []).filter(id => String(id) !== String(tag.id));
        options.setIds(nextIds);
        if (typeof options.onChange === 'function') options.onChange();
        refresh();
      } catch (err) {
        if (typeof onError === 'function') onError('タグを外せませんでした: ' + (err.userMessage || err.message || err));
      }
    });
    chip.append(swatch, name, remove);
    return chip;
  }

  function bindInlineTagEditor(options, ui, refresh) {
    const addCurrent = async () => {
      if (ui.mutationBlocked) return;
      const name = ui.input.value.trim();
      if (!name) return;
      try {
        const data = await loadTagsCached();
        const allTags = Array.isArray(data?.tags) ? data.tags : [];
        let tag = allTags.find(t => String(t.name || '').trim().toLowerCase() === name.toLowerCase());
        if (!tag) {
          try {
            const created = await createTag({ name });
            tag = created?.tag || null;
          } catch (createErr) {
            // 競合(同名タグが既に作成済み)などで失敗した場合は再取得してフォールバック
            const retryData = await loadTagsCached();
            tag = (Array.isArray(retryData?.tags) ? retryData.tags : []).find(t => String(t.name || '').trim().toLowerCase() === name.toLowerCase());
            if (!tag) throw createErr;
          }
        }
        if (!tag?.id) return;
        const ids = new Set((options.getIds() || []).map(id => String(id)));
        ids.add(String(tag.id));
        options.setIds([...ids]);
        ui.input.value = '';
        if (typeof options.onChange === 'function') options.onChange();
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

  // ============================================================
  // エクスポート
  // ============================================================
  window.renderGlobalTagTargetEditor = renderTargetTagEditor;
  window.hydrateGlobalTagTargetEditors = hydrateTargetEditors;
  window.searchGlobalTagTargets = searchByTag;
  window.renderInlineTagEditor = renderInlineTagEditor;

  // タグ管理タブやファイル別エディタから使う API/ユーティリティ群を一括公開
  window.MeldexGlobalTags = {
    // タグ
    loadTags,
    loadTagsCached,
    getCachedTagsSync,
    resolveCommonTagsFilterValueSync,
    invalidateTagsCatalogCache,
    createTag,
    updateTag,
    deleteTag,
    // グループ
    loadGroups,
    createGroup,
    updateGroup,
    deleteGroup,
    // プリセット / 自動タグ
    loadAutoTagPresets,
    installAutoTagPreset,
    resolveTagDictionaryConflict,
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
