/* gb-sheet-view-config-main-adapter.js: Meldex本体の表示設定環境アダプター */
(function (global) {
  'use strict';
  global.MeldexSheetViewConfigEnvironment = {
    fileId: (path) => (typeof _pathToFileId === 'function' ? _pathToFileId(path) : ''),
    put: (path, payload) => apiPut(path, payload),
    isWriteBlocked: (path, ctx) => typeof isProductionManagementWriteBlocked === 'function'
      && isProductionManagementWriteBlocked(path, ctx),
  };
})(typeof window !== 'undefined' ? window : globalThis);
