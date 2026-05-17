/* gb-theme-migration.js: theme system compatibility helpers */
(function (global) {
  'use strict';

  const LEGACY_THEME_NAMES = {
    'ダーク（デフォルト）': 'builtin-dark',
    'ダークカスタム': 'builtin-dark',
    'ダーク': 'builtin-dark',
    'ライトカスタム': 'builtin-light',
    'ライト': 'builtin-light',
    'パステルカスタム': 'builtin-pastel',
    'パステル': 'builtin-pastel',
    'アースカラーカスタム': 'builtin-earth',
    'アースカラー': 'builtin-earth',
    'ネイビー': 'builtin-dark',
    'セピア': 'builtin-earth',
    'フォレスト': 'builtin-earth',
    'ローズ': 'builtin-pastel',
    'ガーリー': 'builtin-pastel',
    'グレースケール': 'builtin-dark',
    'レインボーブランチ': 'builtin-dark',
    'レインボー': 'builtin-dark',
    'OSに合わせる': 'OSに合わせる',
  };
  const LEGACY_THEME_ID_MAP = {
    'custom-dark': 'builtin-dark',
    'custom-light': 'builtin-light',
    'custom-pastel': 'builtin-pastel',
    'custom-earth': 'builtin-earth',
    'custom-navy': 'builtin-dark',
    'custom-sepia': 'builtin-earth',
    'custom-forest': 'builtin-earth',
    'custom-rose': 'builtin-pastel',
    'custom-girly': 'builtin-pastel',
    'custom-grayscale': 'builtin-dark',
    'custom-rainbow': 'builtin-dark',
    'custom-gaming': 'builtin-dark',
    'builtin-board-dark': 'builtin-dark',
    'builtin-board-light': 'builtin-light',
    'builtin-board-navy': 'builtin-dark',
    'builtin-board-sepia': 'builtin-earth',
    'builtin-board-forest': 'builtin-earth',
    'builtin-board-rose': 'builtin-pastel',
    'builtin-girly': 'builtin-pastel',
    'builtin-rainbow': 'builtin-dark',
    'builtin-grayscale': 'builtin-dark',
  };

  const _legacyBoardPalettes = {
    boardDark: {
      oldId: 'builtin-board-dark',
      name: '旧ボード ダーク',
      fallbackId: 'builtin-dark',
      colors: ['#569cd6', '#6a9955', '#ce9178', '#f44747', '#4ec9b0', '#6fa8dc', '#d4d4d4', '#555555'],
      board: { backgroundColor: '#1e1e1e', nodeBgColor: '#3e3e3e', nodeTextColor: '#d4d4d4', nodeBorderColor: '#555555', lineColor: '#569cd6' },
    },
    boardLight: {
      oldId: 'builtin-board-light',
      name: '旧ボード ライト',
      fallbackId: 'builtin-light',
      colors: ['#2563eb', '#2e7d32', '#d84315', '#c62828', '#007050', '#1565c0', '#555555', '#c0c0c0'],
      board: { backgroundColor: '#ffffff', nodeBgColor: '#f0f0f0', nodeTextColor: '#333333', nodeBorderColor: '#c0c0c0', lineColor: '#2563eb' },
    },
    boardNavy: {
      oldId: 'builtin-board-navy',
      name: '旧ボード ネイビー',
      fallbackId: 'builtin-dark',
      colors: ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#a371f7', '#39c5cf', '#c9d1d9', '#30363d'],
      board: { backgroundColor: '#0d1117', nodeBgColor: '#161b22', nodeTextColor: '#c9d1d9', nodeBorderColor: '#30363d', lineColor: '#58a6ff' },
    },
    boardSepia: {
      oldId: 'builtin-board-sepia',
      name: '旧ボード セピア',
      fallbackId: 'builtin-earth',
      colors: ['#b8860b', '#8a6010', '#507830', '#a85818', '#305878', '#c6ad86', '#5c4b37', '#e8dcc8'],
      board: { backgroundColor: '#f4ecd8', nodeBgColor: '#e8dcc8', nodeTextColor: '#5c4b37', nodeBorderColor: '#c6ad86', lineColor: '#b8860b' },
    },
    boardForest: {
      oldId: 'builtin-board-forest',
      name: '旧ボード フォレスト',
      fallbackId: 'builtin-earth',
      colors: ['#4caf50', '#90b870', '#6898b0', '#d4a030', '#d06050', '#5d7a5d', '#c8e6c8', '#2d4a2d'],
      board: { backgroundColor: '#1a2e1a', nodeBgColor: '#2d4a2d', nodeTextColor: '#c8e6c8', nodeBorderColor: '#5d7a5d', lineColor: '#4caf50' },
    },
    boardRose: {
      oldId: 'builtin-board-rose',
      name: '旧ボード ローズ',
      fallbackId: 'builtin-pastel',
      colors: ['#e91e8c', '#b050b0', '#64a0ff', '#ff8fa3', '#69f0ae', '#7a4c7a', '#e8c8e8', '#4a2d4a'],
      board: { backgroundColor: '#2d1b2e', nodeBgColor: '#4a2d4a', nodeTextColor: '#e8c8e8', nodeBorderColor: '#7a4c7a', lineColor: '#e91e8c' },
    },
  };

  function normalizeThemeNameKey(value) {
    return String(value || '').replace(/\s+/g, '').trim();
  }

  function normalizeThemeId(value) {
    if (!value) return '';
    const raw = String(value);
    const normalizedName = normalizeThemeNameKey(raw);
    return LEGACY_THEME_ID_MAP[raw] || LEGACY_THEME_NAMES[raw] || LEGACY_THEME_NAMES[normalizedName] || raw;
  }

  function migrateThemeId(value) {
    return normalizeThemeId(value);
  }

  function migrateEditorThemeStorage(defaultKey) {
    const oldValue = localStorage.getItem('editor-theme-name');
    const current = localStorage.getItem(defaultKey);
    if (!oldValue || current) return current || '';
    const next = normalizeThemeId(oldValue);
    if (next) localStorage.setItem(defaultKey, next);
    return next;
  }

  function migrateBoardState(board, boardUi) {
    if (!board) return;
    if (!board.themeId && boardUi?.themeId) board.themeId = normalizeThemeId(boardUi.themeId);
    if (board.themeId) board.themeId = normalizeThemeId(board.themeId);
    if (!board.themeId && board.grayscale) board.themeId = 'builtin-dark';
    if (Object.prototype.hasOwnProperty.call(board, 'grayscale')) delete board.grayscale;
  }

  global.MeldexThemeMigration = {
    LEGACY_THEME_ID_MAP,
    _legacyBoardPalettes,
    normalizeThemeId,
    migrateThemeId,
    migrateEditorThemeStorage,
    migrateBoardState,
  };
})(window);
