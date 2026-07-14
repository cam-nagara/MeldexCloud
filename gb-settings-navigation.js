/* Meldex settings navigation model */

const MELDEX_SETTINGS_DEFAULT_TAB_ID = 'ユーザー・共同作業';

const MELDEX_SETTINGS_NAVIGATION = Object.freeze([
  {
    id: 'ユーザー・共同作業',
    desc: 'ユーザー名、アイコン、ワークスペース、メンバー、編集ロック',
    icon: 'usersRound',
    pages: [
      { id: 'profile', label: 'プロフィール', panels: ['ユーザー'], view: 'profile' },
      { id: 'workspace', label: 'ワークスペース', panels: ['ワークスペース'], view: 'workspace' },
      { id: 'members', label: 'メンバー・権限', panels: ['ワークスペース', 'ユーザー'], view: 'members' },
    ],
  },
  {
    id: '保存先・フォルダ',
    desc: 'ホームフォルダ、保存先、ソースフォルダ、スマホ接続',
    icon: 'folder',
    pages: [
      { id: 'storage', label: '保存先・フォルダ', panels: ['全般'], view: 'storage' },
    ],
  },
  {
    id: '表示・起動',
    desc: '表示サイズ、見やすさ、起動時の動作',
    icon: 'monitorCog',
    pages: [
      { id: 'display', label: '表示・起動', panels: ['全般'], view: 'display' },
    ],
  },
  {
    id: 'テーマ',
    desc: 'テーマ、テーマカラー、フォント、アプリ別テーマ',
    icon: 'palette',
    pages: [
      { id: 'theme', label: 'テーマ', panels: ['テーマ'], view: 'theme' },
      { id: 'color', label: 'テーマカラー', panels: ['テーマ'], view: 'theme' },
      { id: 'font', label: 'フォント', panels: ['テーマ'], view: 'theme' },
      { id: 'state', label: '状態・装飾', panels: ['テーマ'], view: 'theme' },
      { id: 'apps', label: 'アプリ別', panels: ['テーマ'], view: 'theme' },
    ],
  },
  {
    id: 'ショートカット',
    desc: 'キーボード操作、検索、スコープ別のキー設定',
    icon: 'keyboard',
    pages: [
      { id: 'shortcuts', label: 'ショートカット', panels: ['ショートカット'], view: 'shortcuts' },
    ],
  },
  {
    id: 'AI・Discord',
    desc: 'AIキー、ローカルLLM、CLI、AI使用量、Discord連携',
    icon: 'bot',
    pages: [
      { id: 'ai-keys', label: 'AIキー', panels: ['LLM'], view: 'ai-keys' },
      { id: 'local-llm', label: 'ローカルLLM', panels: ['LLM'], view: 'local-llm' },
      { id: 'cli', label: 'CLI', panels: ['LLM'], view: 'cli' },
      { id: 'memory', label: '記憶・指示', panels: ['LLM'], view: 'memory' },
      { id: 'ai-usage', label: 'AI使用量', panels: ['LLMコスト'], view: 'ai-usage' },
      { id: 'discord', label: 'Discord連携', panels: ['Discord Bot'], view: 'discord' },
    ],
  },
  {
    id: 'インポート',
    desc: '外部ノート、Xブックマーク、Web Clipper、Notion同期、拡張機能',
    icon: 'download',
    pages: [
      { id: 'external-import', label: '外部取り込み', panels: ['取り込み'], view: 'external-import' },
      { id: 'x-bookmarks', label: 'Xブックマーク', panels: ['取り込み'], view: 'x-bookmarks' },
      { id: 'web-clipper', label: 'Web Clipper', panels: ['拡張機能'], view: 'web-clipper' },
      { id: 'notion-sync', label: 'Notion同期', panels: ['拡張機能'], view: 'notion-sync' },
      { id: 'extensions', label: '拡張機能', panels: ['拡張機能'], view: 'extensions' },
    ],
  },
  {
    id: '導入・アプリ連携',
    desc: 'サンプル、ホーム画面追加、ファイル関連付け',
    icon: 'download',
    pages: [
      { id: 'setup', label: '導入・アプリ連携', panels: ['全般'], view: 'setup' },
    ],
  },
  {
    id: '履歴・引き継ぎ',
    desc: 'Undo、バージョン保存、レイアウト復元、設定移行',
    icon: 'history',
    pages: [
      { id: 'history', label: '履歴・復元', panels: ['全般'], view: 'history' },
      { id: 'transfer', label: '引き継ぎ・初期化', panels: ['全般'], view: 'history' },
    ],
  },
  {
    id: 'ゴミ箱・データ保守',
    desc: 'ゴミ箱、バックアップ、保持期間、内部データ',
    icon: 'database',
    pages: [
      { id: 'trash', label: 'ゴミ箱', panels: ['ゴミ箱'], view: 'trash' },
      { id: 'database', label: 'データ保守', panels: ['データベース'], view: 'database' },
    ],
  },
  {
    id: 'フィードバック',
    desc: 'フィードバック、利用統計、診断、更新確認',
    icon: 'messageSquareText',
    pages: [
      { id: 'feedback', label: 'フィードバック', panels: ['フィードバック'], view: 'feedback' },
    ],
  },
]);

const MELDEX_SETTINGS_NAVIGATION_ALIASES = Object.freeze({
  '全般': { tabId: '保存先・フォルダ', pageId: 'storage' },
  '詳細': { tabId: '保存先・フォルダ', pageId: 'storage' },
  'ユーザー': { tabId: 'ユーザー・共同作業', pageId: 'profile' },
  'プロフィール': { tabId: 'ユーザー・共同作業', pageId: 'profile' },
  'ワークスペース': { tabId: 'ユーザー・共同作業', pageId: 'workspace' },
  'メンバー・権限': { tabId: 'ユーザー・共同作業', pageId: 'members' },
  '外観': { tabId: 'テーマ', pageId: 'theme' },
  '文字': { tabId: 'テーマ', pageId: 'font' },
  'フォント': { tabId: 'テーマ', pageId: 'font' },
  'チャットAI': { tabId: 'AI・Discord', pageId: 'ai-keys' },
  'LLM': { tabId: 'AI・Discord', pageId: 'ai-keys' },
  'ナレッジ層': { tabId: 'AI・Discord', pageId: 'memory' },
  'コスト': { tabId: 'AI・Discord', pageId: 'ai-usage' },
  'LLM費用': { tabId: 'AI・Discord', pageId: 'ai-usage' },
  'LLMコスト': { tabId: 'AI・Discord', pageId: 'ai-usage' },
  'LLMコスト管理': { tabId: 'AI・Discord', pageId: 'ai-usage' },
  '利用料金': { tabId: 'AI・Discord', pageId: 'ai-usage' },
  'AI料金': { tabId: 'AI・Discord', pageId: 'ai-usage' },
  'AI使用量': { tabId: 'AI・Discord', pageId: 'ai-usage' },
  'AI API使用量': { tabId: 'AI・Discord', pageId: 'ai-usage' },
  'Discord': { tabId: 'AI・Discord', pageId: 'discord' },
  'Discord Bot': { tabId: 'AI・Discord', pageId: 'discord' },
  'Discord連携': { tabId: 'AI・Discord', pageId: 'discord' },
  'Discord Bot連携': { tabId: 'AI・Discord', pageId: 'discord' },
  '取り込み': { tabId: 'インポート', pageId: 'external-import' },
  '外部取り込み': { tabId: 'インポート', pageId: 'external-import' },
  'Xブックマーク': { tabId: 'インポート', pageId: 'x-bookmarks' },
  '連携': { tabId: 'インポート', pageId: 'web-clipper' },
  '拡張機能': { tabId: 'インポート', pageId: 'extensions' },
  'ゴミ箱': { tabId: 'ゴミ箱・データ保守', pageId: 'trash' },
  'DB': { tabId: 'ゴミ箱・データ保守', pageId: 'database' },
  'データ保護': { tabId: 'ゴミ箱・データ保守', pageId: 'database' },
  'データベース': { tabId: 'ゴミ箱・データ保守', pageId: 'database' },
  'データベースメンテナンス': { tabId: 'ゴミ箱・データ保守', pageId: 'database' },
  '送信設定': { tabId: 'フィードバック', pageId: 'feedback' },
  'クラッシュ送信設定': { tabId: 'フィードバック', pageId: 'feedback' },
  'フィードバック・送信設定': { tabId: 'フィードバック', pageId: 'feedback' },
  'フィードバック・診断': { tabId: 'フィードバック', pageId: 'feedback' },
});

function _settingsNavigationFindTab(tabId) {
  return MELDEX_SETTINGS_NAVIGATION.find(tab => tab.id === tabId) || null;
}

function _settingsNavigationFindPage(tab, pageId) {
  if (!tab) return null;
  return tab.pages.find(page => page.id === pageId || page.label === pageId) || tab.pages[0] || null;
}

function getSettingsNavigationTabs() {
  return MELDEX_SETTINGS_NAVIGATION;
}

function _settingsDefaultTabId() {
  return MELDEX_SETTINGS_DEFAULT_TAB_ID;
}

function resolveSettingsNavigationTarget(name, options = {}) {
  const raw = String(name || '').trim();
  const alias = MELDEX_SETTINGS_NAVIGATION_ALIASES[raw];
  const tabId = options.tabId || alias?.tabId || raw || MELDEX_SETTINGS_DEFAULT_TAB_ID;
  const tab = _settingsNavigationFindTab(tabId) || _settingsNavigationFindTab(MELDEX_SETTINGS_DEFAULT_TAB_ID);
  const pageId = options.pageId || alias?.pageId || '';
  const page = _settingsNavigationFindPage(tab, pageId);
  return {
    tab,
    tabId: tab?.id || MELDEX_SETTINGS_DEFAULT_TAB_ID,
    page,
    pageId: page?.id || '',
    pageLabel: page?.label || tab?.id || '',
    panels: Array.isArray(page?.panels) ? page.panels.slice() : [],
    view: page?.view || '',
  };
}

function _settingsLegacyPanelsForName(name, options = {}) {
  const target = typeof name === 'object' && name
    ? name
    : resolveSettingsNavigationTarget(name, options);
  return Array.isArray(target.panels) ? target.panels.slice() : [];
}

function _settingsNavigationDisplayName(name, options = {}) {
  const target = resolveSettingsNavigationTarget(name, options);
  return target.pageLabel && target.tab?.pages?.length > 1
    ? `${target.tabId} / ${target.pageLabel}`
    : target.tabId;
}

function _settingsNavigationTabLabel(name) {
  const target = resolveSettingsNavigationTarget(name);
  return target.tabId;
}

function _settingsNavigationDescription(name) {
  const target = resolveSettingsNavigationTarget(name);
  return target.tab?.desc || '';
}

function _settingsNavigationIcon(name) {
  const target = resolveSettingsNavigationTarget(name);
  return target.tab?.icon || 'circle';
}

function _settingsTagDirectChildren(panel, views) {
  if (!panel || !Array.isArray(views)) return;
  Array.from(panel.children).forEach((child, index) => {
    const view = views[index];
    if (!view) return;
    child.dataset.settingsView = Array.isArray(view) ? view.join(' ') : String(view);
  });
}

function _tagSettingsNavigationSections(root = document) {
  const scope = root?.querySelector ? root : document;
  _settingsTagDirectChildren(scope.querySelector('.settings-panel[data-panel="全般"]'), [
    'storage',
    'storage',
    'setup',
    'storage',
    'storage',
    'setup',
    'setup',
    'history',
    'display',
    'display',
    'display',
    'history',
    'history',
    'history',
    'history',
    'history',
  ]);
  _settingsTagDirectChildren(scope.querySelector('.settings-panel[data-panel="LLM"]'), [
    'ai-keys',
    'local-llm',
    'cli',
    'memory',
    'memory',
  ]);
  _settingsTagDirectChildren(scope.querySelector('.settings-panel[data-panel="ユーザー"]'), [
    'profile',
    'members',
  ]);
  _settingsTagDirectChildren(scope.querySelector('.settings-panel[data-panel="取り込み"]'), [
    'external-import',
    'x-bookmarks',
  ]);
  _settingsTagDirectChildren(scope.querySelector('.settings-panel[data-panel="拡張機能"]'), [
    'web-clipper',
    'notion-sync',
    'extensions',
  ]);
}

function _applySettingsNavigationView(root, target) {
  const modal = root?.classList?.contains?.('settings-modal')
    ? root
    : root?.querySelector?.('.settings-modal')
      || root?.closest?.('.modal-overlay')?.querySelector?.('.settings-modal')
      || document.querySelector('.modal-overlay[data-settings-modal="1"] .settings-modal');
  if (!modal || !target) return;
  const visiblePanels = new Set(_settingsLegacyPanelsForName(target));
  modal.querySelectorAll('.settings-panel').forEach(panel => {
    const showPanel = visiblePanels.has(panel.dataset.panel);
    panel.hidden = !showPanel;
    panel.style.display = '';
    if (!showPanel) return;
    panel.querySelectorAll('[data-settings-view]').forEach(section => {
      const views = String(section.dataset.settingsView || '').split(/\s+/).filter(Boolean);
      const showSection = !views.length || views.includes(target.view);
      section.hidden = !showSection;
      section.style.display = showSection ? '' : 'none';
    });
  });
}
