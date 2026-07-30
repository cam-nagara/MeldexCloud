/* タグの表示範囲と、画面ごとに分離した表示件数を管理する。 */
(() => {
  const VISIBILITY_KEY = 'meldex.tagGroupVisibility.v1';
  const LEGACY_LIMIT_KEY = 'meldex.compactTagDisplayLimit.v1';
  const DEFAULT_LIMIT = 10;
  const MAX_LIMIT = 999;

  function normalizeLimit(value, fallback = DEFAULT_LIMIT) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return normalizeLimit(fallback, DEFAULT_LIMIT);
    return Math.max(1, Math.min(MAX_LIMIT, parsed));
  }

  function legacyLimit() {
    try {
      return normalizeLimit(localStorage.getItem(LEGACY_LIMIT_KEY), DEFAULT_LIMIT);
    } catch (_) {
      return DEFAULT_LIMIT;
    }
  }

  function scopeKey(sourceFolder) {
    return window.MeldexTagTreeRuntime?.normalizedScopeKey?.(sourceFolder)
      || String(sourceFolder || '__default__').trim().replace(/\\/g, '/').replace(/\/+$/g, '').toLocaleLowerCase('ja')
      || '__default__';
  }

  function readVisibility() {
    try {
      const parsed = JSON.parse(localStorage.getItem(VISIBILITY_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function hiddenSet(sourceFolder) {
    const values = readVisibility()[scopeKey(sourceFolder)];
    return new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean));
  }

  function saveHiddenSet(sourceFolder, hidden) {
    const stored = readVisibility();
    const key = scopeKey(sourceFolder);
    const values = [...hidden].sort();
    if (values.length) stored[key] = values;
    else delete stored[key];
    try {
      localStorage.setItem(VISIBILITY_KEY, JSON.stringify(stored));
    } catch (_) {
      // 保存不能な埋め込み環境でも現在の描画更新は続ける。
    }
    window.dispatchEvent?.(new CustomEvent('meldex:tag-group-visibility-changed', {
      detail: { sourceFolder: String(sourceFolder || ''), hiddenGroupIds: values },
    }));
    return values;
  }

  function isGroupExplicitlyHidden(groupId, sourceFolder) {
    return hiddenSet(sourceFolder).has(String(groupId || ''));
  }

  function toggleGroup(groupId, sourceFolder) {
    const id = String(groupId || '');
    const hidden = hiddenSet(sourceFolder);
    if (hidden.has(id)) hidden.delete(id);
    else hidden.add(id);
    saveHiddenSet(sourceFolder, hidden);
    return !hidden.has(id);
  }

  function groupVisibleWithIndex(groupId, byId, hidden) {
    let id = String(groupId || '');
    const visited = new Set();
    while (id && !visited.has(id)) {
      if (hidden.has(id)) return false;
      visited.add(id);
      id = String(byId.get(id)?.parent_id || '');
    }
    return true;
  }

  function isGroupVisible(groupId, groups, sourceFolder) {
    const hidden = hiddenSet(sourceFolder);
    const byId = new Map((Array.isArray(groups) ? groups : []).map(group => [String(group?.id || ''), group]));
    return groupVisibleWithIndex(groupId, byId, hidden);
  }

  function filterVisibleTags(tags, groups, sourceFolder) {
    const hidden = hiddenSet(sourceFolder);
    const byId = new Map((Array.isArray(groups) ? groups : []).map(group => [String(group?.id || ''), group]));
    return (Array.isArray(tags) ? tags : []).filter(tag => {
      const groupId = String(tag?.group_id || '');
      return !groupId || groupVisibleWithIndex(groupId, byId, hidden);
    });
  }

  function folderTagDisplayLimit() {
    try {
      const cfg = JSON.parse(localStorage.getItem('folder-display-config') || '{}');
      return normalizeLimit(cfg?.tagDisplayLimit, legacyLimit());
    } catch (_) {
      return legacyLimit();
    }
  }

  function sheetTagDisplayLimit(dbPath) {
    try {
      const cfg = typeof getDbViewConfig === 'function' && dbPath ? getDbViewConfig(dbPath) : null;
      return normalizeLimit(cfg?.commonTagsDisplayLimit, legacyLimit());
    } catch (_) {
      return legacyLimit();
    }
  }

  window.MeldexTagDisplayPreferences = {
    DEFAULT_LIMIT,
    MAX_LIMIT,
    normalizeLimit,
    legacyLimit,
    scopeKey,
    hiddenSet,
    isGroupExplicitlyHidden,
    isGroupVisible,
    toggleGroup,
    filterVisibleTags,
    folderTagDisplayLimit,
    sheetTagDisplayLimit,
  };
})();
