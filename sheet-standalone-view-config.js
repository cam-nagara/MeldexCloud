/* sheet-standalone-view-config.js: 単独版の表示設定環境アダプター */
(function (global) {
  'use strict';

  const ALIAS_KEY = 'meldex-sheet-view-config-path-aliases-v1';

  function normalize(path) {
    let value = String(path || '').trim().replace(/\//g, '\\');
    if (/^[A-Za-z]:\\/.test(value)) value = value[0].toUpperCase() + value.slice(1);
    return value.replace(/\\+/g, '\\').replace(/\\$/, '').toLowerCase();
  }

  function hash(value) {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  }

  function readAliases() {
    try {
      const parsed = JSON.parse(localStorage.getItem(ALIAS_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function documentId(path) {
    const cloudId = global.MeldexStandaloneFS?.documentIdForPath?.(path)
      || global.MeldexStandaloneCloudRuntime?.documentIdForPath?.(path);
    if (cloudId) return `doc:${cloudId}`;
    const normalized = normalize(path);
    if (!normalized) return '';
    return readAliases()[normalized] || `path:${hash(normalized)}`;
  }

  function notifyMoved(oldPath, newPath) {
    const oldId = documentId(oldPath);
    const normalizedNew = normalize(newPath);
    if (!oldId || !normalizedNew) return false;
    const aliases = readAliases();
    aliases[normalizedNew] = oldId;
    localStorage.setItem(ALIAS_KEY, JSON.stringify(aliases));
    global.rebindPendingDbViewConfigBackendSave?.(oldPath, newPath, { isFolder: true });
    return true;
  }

  global.MeldexSheetViewConfigEnvironment = {
    fileId: documentId,
    put: (path, payload) => apiPut(path, payload),
    isWriteBlocked: (path, ctx) => typeof isProductionManagementWriteBlocked === 'function'
      && isProductionManagementWriteBlocked(path, ctx),
  };
  global.MeldexSheetViewConfigIdentity = Object.freeze({ documentId, notifyMoved, normalize });
})(typeof window !== 'undefined' ? window : globalThis);
