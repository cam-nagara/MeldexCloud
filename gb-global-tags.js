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
  const targetTagsLastResolved = new Map();
  const targetTagsLatestRequest = new Map();
  let targetTagsRequestSeq = 0;
  let targetEditorCatalogRefreshTimer = null;
  const TARGET_TAGS_CACHE_TTL_MS = 2000;
  const COMPACT_TAG_DISPLAY_LIMIT_KEY = 'meldex.compactTagDisplayLimit.v1';
  const DEFAULT_COMPACT_TAG_DISPLAY_LIMIT = 10;
  const MAX_COMPACT_TAG_DISPLAY_LIMIT = 999;
  let compactTagDisplayLimit = null;

  function normalizeCompactTagDisplayLimit(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) return DEFAULT_COMPACT_TAG_DISPLAY_LIMIT;
    return Math.max(1, Math.min(MAX_COMPACT_TAG_DISPLAY_LIMIT, parsed));
  }

  function getCompactTagDisplayLimit() {
    if (compactTagDisplayLimit != null) return compactTagDisplayLimit;
    try {
      compactTagDisplayLimit = normalizeCompactTagDisplayLimit(localStorage.getItem(COMPACT_TAG_DISPLAY_LIMIT_KEY));
    } catch {
      compactTagDisplayLimit = DEFAULT_COMPACT_TAG_DISPLAY_LIMIT;
    }
    return compactTagDisplayLimit;
  }

  function setCompactTagDisplayLimit(value) {
    const limit = normalizeCompactTagDisplayLimit(value);
    compactTagDisplayLimit = limit;
    try {
      localStorage.setItem(COMPACT_TAG_DISPLAY_LIMIT_KEY, String(limit));
    } catch (_) {
      // 端末内設定を保存できない環境でも、現在の画面には変更を反映する。
    }
    try {
      window.dispatchEvent(new CustomEvent('meldex:compact-tag-display-limit-changed', {
        detail: { limit },
      }));
    } catch (_) {
      // CustomEventを利用できない古い埋め込み環境でも設定値の保存は成功扱いにする。
    }
    return limit;
  }

  function icon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 14) : '';
  }

  function tagColor(value) {
    const color = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : '';
  }

  function effectiveTagColor(tag, groupsById) {
    // タグの実効色 = 所属グループから親へ遡った色を優先し、
    // グループに色がなければタグ自身の色、最後にアクセント色を使う。
    const visited = new Set();
    const groupForId = groupId => (
      groupsById instanceof Map ? groupsById.get(groupId) : groupsById?.[groupId]
    );
    let groupId = tag?.group_id || null;
    while (groupId && groupForId(groupId) && !visited.has(groupId)) {
      visited.add(groupId);
      const group = groupForId(groupId);
      const groupColor = tagColor(group.color);
      if (groupColor) return groupColor;
      groupId = group.parent_id || null;
    }
    const own = tagColor(tag && tag.color);
    return own || 'var(--accent)';
  }

  function compareCatalogRows(a, b) {
    return Number(a?.sort_index || 0) - Number(b?.sort_index || 0)
      || String(a?.name || '').localeCompare(String(b?.name || ''), 'ja');
  }

  function groupOrderMap(groups) {
    const rows = Array.isArray(groups) ? groups : [];
    const byParent = new Map();
    rows.forEach(group => {
      const parentId = group?.parent_id || '';
      if (!byParent.has(parentId)) byParent.set(parentId, []);
      byParent.get(parentId).push(group);
    });
    byParent.forEach(siblings => siblings.sort(compareCatalogRows));
    const order = new Map();
    const visited = new Set();
    let index = 0;
    const visit = group => {
      const id = String(group?.id || '');
      if (!id || visited.has(id)) return;
      visited.add(id);
      order.set(id, index++);
      (byParent.get(id) || []).forEach(visit);
    };
    (byParent.get('') || []).forEach(visit);
    rows.filter(group => !visited.has(String(group?.id || '')))
      .sort(compareCatalogRows)
      .forEach(visit);
    return order;
  }

  function sortTagsByGroupOrder(tags, groups) {
    const rows = Array.isArray(tags) ? [...tags] : [];
    const order = groupOrderMap(groups);
    const uncategorizedRank = order.size + 1;
    return rows.sort((a, b) => {
      const aRank = order.has(String(a?.group_id || '')) ? order.get(String(a.group_id)) : uncategorizedRank;
      const bRank = order.has(String(b?.group_id || '')) ? order.get(String(b.group_id)) : uncategorizedRank;
      return aRank - bRank || compareCatalogRows(a, b);
    });
  }

  function setDataset(element, values) {
    Object.entries(values || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') element.dataset[key] = String(value);
    });
  }

  function createTagChip(tag, options = {}) {
    const groupsById = options.groupsById || {};
    const displayName = String(options.label ?? tag?.name ?? '');
    const chip = document.createElement('span');
    chip.className = 'gb-tag-chip'
      + (options.compact ? ' gb-tag-chip--compact' : '')
      + (options.summary ? ' gb-tag-chip--summary' : '')
      + (options.onRemove ? ' gb-tag-chip--removable' : '')
      + (options.className ? ' ' + options.className : '');
    chip.style.setProperty('--gb-tag-color', options.summary ? 'var(--fg2)' : effectiveTagColor(tag, groupsById));
    chip.title = options.title || displayName;
    setDataset(chip, options.dataset);

    const label = document.createElement(typeof options.onActivate === 'function' ? 'button' : 'span');
    if (label.tagName === 'BUTTON') label.type = 'button';
    label.className = 'gb-tag-chip__label';
    label.textContent = displayName;
    label.title = options.labelTitle || options.title || displayName;
    if (options.ariaLabel) label.setAttribute('aria-label', options.ariaLabel);
    setDataset(label, options.labelDataset);
    if (typeof options.onActivate === 'function') {
      label.addEventListener('click', event => options.onActivate(event, tag));
    }
    chip.appendChild(label);

    if (typeof options.onRemove === 'function') {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'gb-tag-chip__remove';
      remove.title = options.removeTitle || 'タグを外す';
      remove.setAttribute('aria-label', options.removeAriaLabel || `${displayName || 'タグ'}を外す`);
      setDataset(remove, options.removeDataset);
      remove.innerHTML = icon('x', 12) || '×';
      remove.disabled = !!options.removeDisabled;
      remove.addEventListener('click', async event => {
        event.stopPropagation();
        if (remove.disabled) return;
        remove.disabled = true;
        try {
          await options.onRemove(event, tag);
        } finally {
          if (remove.isConnected) remove.disabled = !!options.removeDisabled;
        }
      });
      chip.appendChild(remove);
    }
    return chip;
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
    return apiFetch(withSourceQuery('/global-tags', sourceFolder), { silentError: true, timeoutMs: 120000 });
  }

  // シートの共通タグ列など、大量のセル描画で同一データを繰り返し参照する用途向けの
  // 短期キャッシュ付きラッパー。タグ/グループの変更操作（作成・更新・削除）で即座に破棄される。
  const _tagsCatalogCache = new Map(); // source_folder -> { at: number, promise: Promise }
  const _tagsCatalogLastResolved = new Map(); // source_folder -> 直近で解決済みの値
  // 明示的な辞書更新で失効するため、通常のフォルダ切替では再取得しない。
  const TAGS_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
  function invalidateTagsCatalogCache(sourceFolder) {
    if (arguments.length === 0) {
      _tagsCatalogCache.clear();
      _tagsCatalogLastResolved.clear();
      return;
    }
    const key = sourceCacheKey(sourceFolder);
    _tagsCatalogCache.delete(key);
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
  function notifyDictionaryChanged(reason, sourceFolder) {
    invalidateTagsCatalogCache(sourceFolder);
    notifyTagsCatalogChanged(reason || 'dictionary-sheet-updated', null, sourceFolder);
  }
  function publishTagsCatalogMutation(reason, result, sourceFolder) {
    const key = sourceCacheKey(sourceFolder);
    if (Array.isArray(result?.tags) && Array.isArray(result?.groups)) {
      _tagsCatalogLastResolved.set(key, result);
      _tagsCatalogCache.set(key, { at: Date.now(), promise: Promise.resolve(result) });
    } else _tagsCatalogCache.delete(key);
    notifyTagsCatalogChanged(reason, result, sourceFolder);
    return result;
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
      _tagsCatalogCache.delete(key);
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
    return publishTagsCatalogMutation('tag-created', result, sourceFolder);
  }

  async function updateTag(tagId, payload, sourceFolder) {
    const result = await apiFetch('/global-tags/' + encodeURIComponent(tagId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withSourcePayload(payload, sourceFolder)),
      silentError: true,
    });
    return publishTagsCatalogMutation('tag-updated', result, sourceFolder);
  }

  async function updateTagOrder(updates, sourceFolder) {
    const result = await apiFetch('/global-tags/order', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withSourcePayload({ updates }, sourceFolder)),
      silentError: true, timeoutMs: 120000,
    });
    return publishTagsCatalogMutation('tag-order-updated', result, sourceFolder);
  }

  async function deleteTag(tagId, sourceFolder) {
    const result = await apiFetch(withSourceQuery('/global-tags/' + encodeURIComponent(tagId), sourceFolder), { method: 'DELETE', silentError: true });
    return publishTagsCatalogMutation('tag-deleted', result, sourceFolder);
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
    return publishTagsCatalogMutation('group-created', result, sourceFolder);
  }

  async function materializeExternalSuggestion(candidate, sourceFolder) {
    const result = await apiPost(
      '/external-tag-catalog/materialize',
      withSourcePayload(
        {
          kind: candidate?.kind,
          catalog_id: candidate?.catalog_id,
          candidate,
        },
        sourceFolder,
      ),
      { silentError: true },
    );
    return publishTagsCatalogMutation(
      'external-catalog-materialized',
      result,
      sourceFolder,
    );
  }

  async function updateGroup(groupId, payload, sourceFolder) {
    const result = await apiFetch('/global-tag-groups/' + encodeURIComponent(groupId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withSourcePayload(payload, sourceFolder)),
      silentError: true,
    });
    return publishTagsCatalogMutation('group-updated', result, sourceFolder);
  }

  async function updateGroupOrder(updates, sourceFolder) {
    const result = await apiFetch('/global-tag-groups/order', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withSourcePayload({ updates }, sourceFolder)),
      silentError: true, timeoutMs: 120000,
    });
    return publishTagsCatalogMutation('group-order-updated', result, sourceFolder);
  }

  async function deleteGroup(groupId, sourceFolder) {
    const result = await apiFetch(withSourceQuery('/global-tag-groups/' + encodeURIComponent(groupId), sourceFolder), { method: 'DELETE', silentError: true });
    return publishTagsCatalogMutation('group-deleted', result, sourceFolder);
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

  function invalidateTargetTagsCache(path, sourceFolder) {
    const targetPath = normalizeTargetPath(path);
    if (!targetPath) {
      targetTagsCache.clear();
      targetTagsLastResolved.clear();
      targetTagsLatestRequest.clear();
      return;
    }
    const resolvedSourceFolder = normalizedSourceFolder(sourceFolder) || sourceFolderForTarget(targetPath);
    const key = targetTagsCacheKey(targetPath, resolvedSourceFolder);
    targetTagsCache.delete(key);
    targetTagsLastResolved.delete(key);
    targetTagsLatestRequest.delete(key);
  }

  function primeTargetTagsCache(path, rows, options) {
    const targetPath = normalizeTargetPath(path);
    if (!targetPath) return null;
    const sourceFolder = normalizedSourceFolder(options?.sourceFolder) || sourceFolderForTarget(targetPath);
    const tags = Array.isArray(rows) ? rows : (Array.isArray(rows?.tags) ? rows.tags : []);
    const data = {
      ...(rows && !Array.isArray(rows) && typeof rows === 'object' ? rows : {}),
      tags,
      _provisional: true,
    };
    const key = targetTagsCacheKey(targetPath, sourceFolder);
    const existing = targetTagsLastResolved.get(key);
    if (existing && existing._provisional === false) return existing;
    targetTagsLastResolved.set(key, data);
    return data;
  }

  function getCachedTargetTagsSync(path, options) {
    const targetPath = normalizeTargetPath(path);
    if (!targetPath) return null;
    const sourceFolder = normalizedSourceFolder(options?.sourceFolder) || sourceFolderForTarget(targetPath);
    return targetTagsLastResolved.get(targetTagsCacheKey(targetPath, sourceFolder)) || null;
  }

  function notifyTargetTagsChanged(path, sourceFolder) {
    invalidateTargetTagsCache(path, sourceFolder);
    try {
      window.dispatchEvent(new CustomEvent('meldex:target-tags-changed', {
        detail: {
          path: normalizeTargetPath(path),
          sourceFolder: normalizedSourceFolder(sourceFolder) || sourceFolderForTarget(path),
        },
      }));
    } catch (_) {
      // CustomEventを利用できない古い埋め込み環境でもタグ更新自体は成功扱いにする。
    }
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
    const requestRevision = ++targetTagsRequestSeq;
    targetTagsLatestRequest.set(key, requestRevision);
    const promise = apiFetch(targetTagsUrl(path, sourceFolder), { silentError: true })
      .then(data => {
        if (targetTagsLatestRequest.get(key) === requestRevision) {
          targetTagsLastResolved.set(key, { ...(data || {}), _provisional: false });
        }
        return data;
      })
      .catch(error => {
        if (targetTagsLatestRequest.get(key) === requestRevision) targetTagsCache.delete(key);
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
    return { chips, input, datalist, add, msg, osSyncRow, osSync, osSyncStatus, compact: options?.compact === true };
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

  function renderTargetEditorTagsData(targetPath, ui, refresh, data) {
    const tags = Array.isArray(data?.tags) ? data.tags : [];
    const provisional = !!data?._provisional;
    ui.mutationBlocked = provisional || !!data?.mutation_blocked;
    ui.input.disabled = ui.mutationBlocked;
    ui.add.disabled = ui.mutationBlocked;
    ui.chips.textContent = '';
    const cachedCatalog = getCachedTagsSync(sourceFolderForTarget(targetPath));
    const groups = Array.isArray(cachedCatalog?.groups) ? cachedCatalog.groups : [];
    const groupsById = Object.fromEntries(groups.map(group => [group.id, group]));
    const orderedTags = sortTagsByGroupOrder(tags, groups);
    if (!orderedTags.length) {
      const empty = document.createElement('span');
      empty.className = 'gb-section-desc';
      empty.textContent = 'タグはありません。';
      ui.chips.appendChild(empty);
    }
    const blockedReason = provisional
      ? '編集状態を確認しています'
      : (data?.warning || 'タグ辞書の同期競合を解消してからタグを編集してください。');
    orderedTags.forEach(tag => ui.chips.appendChild(targetTagChip(
      targetPath,
      tag,
      refresh,
      message => { ui.msg.textContent = message; },
      groupsById,
      ui.mutationBlocked,
      blockedReason,
      ui.compact,
    )));
    ui.msg.textContent = provisional
      ? '編集状態を確認しています...'
      : (ui.mutationBlocked ? blockedReason : '');
    renderOsTagSyncState(ui, provisional ? null : data?.os_sync);
    if (!cachedCatalog && !ui.catalogRefreshPending) {
      ui.catalogRefreshPending = true;
      loadTagsCached(sourceFolderForTarget(targetPath)).then(() => {
        ui.catalogRefreshPending = false;
        if (ui.chips.isConnected) renderTargetEditorTagsData(targetPath, ui, refresh, data);
      }).catch(() => {
        ui.catalogRefreshPending = false;
      });
    }
  }

  async function refreshTargetEditorTags(targetPath, ui, refresh, options) {
    const revision = (ui.refreshRevision || 0) + 1;
    ui.refreshRevision = revision;
    const immediate = options?.force ? null : getCachedTargetTagsSync(targetPath);
    if (immediate) renderTargetEditorTagsData(targetPath, ui, refresh, immediate);
    else ui.msg.textContent = 'タグを読み込んでいます...';
    try {
      const data = await loadTargetTags(targetPath, options);
      if (revision !== ui.refreshRevision || !ui.chips.isConnected) return;
      renderTargetEditorTagsData(targetPath, ui, refresh, data);
    } catch (err) {
      if (revision !== ui.refreshRevision || !ui.msg.isConnected) return;
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
        invalidateTargetTagsCache(targetPath, sourceFolder);
        const data = await apiPost('/global-tags/target/sync', withSourcePayload({
          path: normalizeTargetPath(targetPath),
        }, sourceFolder), { silentError: true });
        renderOsTagSyncState(ui, data?.os_sync);
        notifyTargetTagsChanged(targetPath, sourceFolder);
        await refresh({ force: true });
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

  function targetTagChip(path, tag, refresh, onError, groupsById, mutationBlocked, blockedReason, compact) {
    const displayName = tag.name || '';
    const targetKey = normalizeTargetPath(path);
    const tagKey = String(tag?.id || tag?.name || 'tag');
    return createTagChip(tag, {
      compact: compact === true,
      groupsById: groupsById || {},
      labelTitle: 'このタグの項目を検索',
      ariaLabel: (displayName || 'タグ') + 'の項目を検索',
      labelDataset: {
        e2eId: `global-tags-target-search:${targetKey}:${tagKey}`,
        globalTagsRole: 'target-search',
      },
      onActivate() {
        if (window.MeldexTagManagement && typeof window.MeldexTagManagement.showSearchForTag === 'function') {
          window.MeldexTagManagement.showSearchForTag(tag);
        } else {
          searchByTag(tag, sourceFolderForTarget(path));
        }
      },
      removeDisabled: !!mutationBlocked,
      removeTitle: mutationBlocked
        ? (blockedReason || 'タグ辞書の同期競合を解消してから編集してください')
        : 'タグを外す',
      removeDataset: {
        e2eId: `global-tags-target-remove:${targetKey}:${tagKey}`,
        globalTagsRole: 'target-remove',
      },
      async onRemove() {
        try {
          await removeTargetTag(path, tag);
          await refresh();
        } catch (err) {
          if (typeof onError === 'function') onError('タグを外せませんでした: ' + (err.userMessage || err.message || err));
        }
      },
    });
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
      const tags = sortTagsByGroupOrder(
        allTags.filter(tag => idSet.has(String(tag.id))),
        groups,
      );
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
    const displayName = tag.name || '';
    const tagKey = String(tag?.id || tag?.name || 'tag');
    return createTagChip(tag, {
      groupsById: groupsById || {},
      labelTitle: 'このタグの項目を検索',
      ariaLabel: (displayName || 'タグ') + 'の項目を検索',
      labelDataset: {
        e2eId: `global-tags-inline-search:${tagKey}`,
        globalTagsRole: 'inline-search',
      },
      onActivate() {
        if (window.MeldexTagManagement && typeof window.MeldexTagManagement.showSearchForTag === 'function') {
          window.MeldexTagManagement.showSearchForTag(tag);
        } else {
          searchByTag(tag);
        }
      },
      removeDisabled: !!mutationBlocked,
      removeTitle: mutationBlocked
        ? 'タグ辞書の同期競合を解消してから編集してください'
        : 'タグを外す',
      removeDataset: {
        e2eId: `global-tags-inline-remove:${tagKey}`,
        globalTagsRole: 'inline-remove',
      },
      onRemove() {
        try {
          const nextIds = (options.getIds() || []).filter(id => String(id) !== String(tag.id));
          options.setIds(nextIds);
          if (typeof options.onChange === 'function') options.onChange();
          refresh();
        } catch (err) {
          if (typeof onError === 'function') onError('タグを外せませんでした: ' + (err.userMessage || err.message || err));
        }
      },
    });
  }

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('meldex:tag-dictionary-changed', () => {
      clearTimeout(targetEditorCatalogRefreshTimer);
      targetEditorCatalogRefreshTimer = setTimeout(() => {
        document.querySelectorAll('[data-global-tags-target-path]').forEach(container => {
          renderTargetTagEditor(container, container.dataset.globalTagsTargetPath || '', { compact: true });
        });
      }, 80);
    });
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
    notifyDictionaryChanged,
    createTag,
    updateTag,
    updateTagOrder,
    deleteTag,
    // グループ
    loadGroups,
    createGroup,
    materializeExternalSuggestion,
    updateGroup,
    updateGroupOrder,
    deleteGroup,
    // プリセット / 自動タグ
    loadAutoTagPresets,
    installAutoTagPreset,
    resolveTagDictionaryConflict,
    autoTag,
    // 対象ファイル別
    loadTargetTags,
    primeTargetTagsCache,
    getCachedTargetTagsSync,
    invalidateTargetTagsCache,
    addTargetTag,
    removeTargetTag,
    searchByTag,
    openTaggedTarget,
    // コンパクト表示
    getCompactTagDisplayLimit,
    setCompactTagDisplayLimit,
    // 色
    tagColor,
    effectiveTagColor,
    groupOrderMap,
    sortTagsByGroupOrder,
    createTagChip,
  };
})();
