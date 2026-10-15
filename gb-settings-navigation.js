/* Meldex settings navigation model */

const MELDEX_SETTINGS_DEFAULT_TAB_ID = 'ユーザー・共同作業';

const MELDEX_SETTINGS_NAVIGATION = Object.freeze([
  {
    id: 'ユーザー・共同作業',
    desc: 'プロフィール、ユーザー、ワークスペースの所属と権限',
    icon: 'usersRound',
    pages: [
      { id: 'profile', label: 'プロフィール', panels: ['ユーザー'], view: 'profile', commitMode: 'draft-save' },
      { id: 'users', label: 'ユーザー', panels: ['ユーザー'], view: 'users', commitMode: 'immediate-safe' },
      { id: 'workspace', label: 'ワークスペース', panels: ['ワークスペース'], view: 'workspace', commitMode: 'immediate-safe' },
    ],
  },
  {
    id: '保存先・フォルダ',
    desc: 'ホームフォルダ、ソースフォルダ、Dropbox',
    icon: 'folder',
    pages: [
      { id: 'storage', label: '保存先・フォルダ', panels: ['全般'], view: 'storage', commitMode: 'draft-save' },
    ],
  },
  {
    id: '表示・起動',
    desc: '表示サイズ、見やすさ、起動時の動作',
    icon: 'monitorCog',
    pages: [
      { id: 'display', label: '表示・起動', panels: ['全般'], view: 'display', commitMode: 'draft-save' },
    ],
  },
  {
    id: 'テーマ',
    desc: 'テーマカラー、アクセント、詳細設定、プレビュー',
    icon: 'palette',
    pages: [
      { id: 'theme', label: 'テーマ', panels: ['テーマ'], view: 'theme', commitMode: 'draft-save' },
    ],
  },
  {
    id: 'ショートカット',
    desc: 'キーボード操作、検索、スコープ別のキー設定',
    icon: 'keyboard',
    pages: [
      { id: 'shortcuts', label: 'ショートカット', panels: ['ショートカット'], view: 'shortcuts', commitMode: 'immediate-safe' },
    ],
  },
  {
    id: 'AI',
    desc: '自動タグ付け、AIキー、ローカルLLM、CLI、AI使用量',
    icon: 'bot',
    pages: [
      { id: 'auto-tag', label: '自動タグ付け', panels: ['LLM'], view: 'auto-tag', commitMode: 'draft-save' },
      { id: 'ai-keys', label: 'AIキー', panels: ['LLM'], view: 'ai-keys', commitMode: 'draft-save' },
      { id: 'local-llm', label: 'ローカルLLM', panels: ['LLM'], view: 'local-llm', commitMode: 'draft-save' },
      { id: 'cli', label: 'CLI', panels: ['LLM'], view: 'cli', commitMode: 'draft-save' },
      { id: 'memory', label: '記憶・指示', panels: ['LLM'], view: 'memory', commitMode: 'draft-save' },
      { id: 'ai-usage', label: 'AI使用量', panels: ['LLMコスト'], view: 'ai-usage', commitMode: 'immediate-safe' },
    ],
  },
  {
    id: 'インポート',
    desc: '外部ノート、Notion同期、定期実行の予定と結果',
    icon: 'download',
    pages: [
      { id: 'external-import', label: '外部取り込み', panels: ['取り込み'], view: 'external-import', commitMode: 'immediate-safe' },
      { id: 'notion-sync', label: 'Notion同期', panels: ['拡張機能'], view: 'notion-sync', commitMode: 'immediate-safe' },
      { id: 'import-schedules', label: '定期実行', panels: ['取り込み'], view: 'import-schedules', commitMode: 'immediate-safe' },
    ],
  },
  {
    id: 'Webクリップ',
    desc: 'Web Clipper、Xブックマーク、Xアカウント保存',
    icon: 'blocks',
    pages: [
      { id: 'web-clipper', label: 'Web Clipper', panels: ['拡張機能'], view: 'web-clipper', commitMode: 'immediate-safe' },
      { id: 'x-bookmarks', label: 'Xブックマーク', panels: ['取り込み'], view: 'x-bookmarks', commitMode: 'immediate-safe' },
      { id: 'x-account-posts', label: 'Xアカウント保存', panels: ['取り込み'], view: 'x-account-posts', commitMode: 'immediate-safe' },
    ],
  },
  {
    id: '拡張機能',
    desc: '追加機能の導入と状態確認',
    icon: 'puzzle',
    pages: [
      { id: 'extensions', label: '拡張機能', panels: ['拡張機能'], view: 'extensions', commitMode: 'immediate-safe' },
    ],
  },
  {
    id: '導入・アプリ連携',
    desc: 'Meldex本体、クイックメモ、ファイル関連付け、RenderList',
    icon: 'download',
    pages: [
      { id: 'setup', label: 'Meldex本体', panels: ['全般'], view: 'setup', commitMode: 'immediate-safe' },
      { id: 'quick-memo-setup', label: 'クイックメモ', panels: ['全般'], view: 'quick-memo-setup', commitMode: 'immediate-safe' },
      { id: 'file-associations', label: 'ファイル関連付け', panels: ['全般'], view: 'file-associations', commitMode: 'immediate-safe' },
      { id: 'renderlist', label: 'RenderList', panels: ['全般'], view: 'renderlist', commitMode: 'immediate-safe' },
    ],
  },
  {
    id: '履歴・引き継ぎ',
    desc: 'Undo、バージョン保存、レイアウト復元、設定移行',
    icon: 'history',
    pages: [
      { id: 'history', label: '履歴・復元', panels: ['全般'], view: 'history', commitMode: 'draft-save' },
      { id: 'transfer', label: '引き継ぎ・初期化', panels: ['全般'], view: 'transfer', commitMode: 'immediate-destructive' },
    ],
  },
  {
    id: 'ゴミ箱・データ保守',
    desc: 'ゴミ箱、バックアップ、保持期間、内部データ',
    icon: 'database',
    pages: [
      { id: 'trash', label: 'ゴミ箱', panels: ['ゴミ箱'], view: 'trash', commitMode: 'immediate-destructive' },
      { id: 'database', label: 'データ保守', panels: ['データベース'], view: 'database', commitMode: 'immediate-destructive' },
      { id: 'duplicates', label: '重複検出', panels: ['データベース'], view: 'duplicates', commitMode: 'immediate-safe' },
    ],
  },
  {
    id: 'フィードバック',
    desc: '不具合・要望の報告、送信設定、診断・更新、管理',
    icon: 'messageSquareText',
    pages: [
      { id: 'feedback', label: '報告・送信設定', panels: ['フィードバック'], view: 'feedback', commitMode: 'immediate-safe' },
      { id: 'diagnostics', label: '診断・更新', panels: ['フィードバック'], view: 'diagnostics', commitMode: 'immediate-safe' },
      { id: 'feedback-management', label: 'フォーム・受信箱の管理', panels: ['フィードバック'], view: 'feedback-management', commitMode: 'immediate-safe' },
    ],
  },
]);

const MELDEX_SETTINGS_NAVIGATION_ALIASES = Object.freeze({
  '全般': { tabId: '保存先・フォルダ', pageId: 'storage' },
  '詳細': { tabId: '保存先・フォルダ', pageId: 'storage' },
  'ユーザー': { tabId: 'ユーザー・共同作業', pageId: 'users' },
  'スタッフ': { tabId: 'ユーザー・共同作業', pageId: 'users' },
  'プロフィール': { tabId: 'ユーザー・共同作業', pageId: 'profile' },
  'ワークスペース': { tabId: 'ユーザー・共同作業', pageId: 'workspace' },
  'メンバー・権限': { tabId: 'ユーザー・共同作業', pageId: 'workspace' },
  '接続・共有サーバー': { tabId: '保存先・フォルダ', pageId: 'storage' },
  '外観': { tabId: 'テーマ', pageId: 'theme' },
  '文字': { tabId: 'テーマ', pageId: 'font' },
  'フォント': { tabId: 'テーマ', pageId: 'font' },
  'チャットAI': { tabId: 'AI', pageId: 'ai-keys' },
  'LLM': { tabId: 'AI', pageId: 'ai-keys' },
  '自動タグ付け': { tabId: 'AI', pageId: 'auto-tag' },
  '自動タグ辞書': { tabId: 'AI', pageId: 'auto-tag' },
  'ナレッジ層': { tabId: 'AI', pageId: 'memory' },
  'コスト': { tabId: 'AI', pageId: 'ai-usage' },
  'LLM費用': { tabId: 'AI', pageId: 'ai-usage' },
  'LLMコスト': { tabId: 'AI', pageId: 'ai-usage' },
  'LLMコスト管理': { tabId: 'AI', pageId: 'ai-usage' },
  '利用料金': { tabId: 'AI', pageId: 'ai-usage' },
  'AI料金': { tabId: 'AI', pageId: 'ai-usage' },
  'AI使用量': { tabId: 'AI', pageId: 'ai-usage' },
  'AI API使用量': { tabId: 'AI', pageId: 'ai-usage' },
  '取り込み': { tabId: 'インポート', pageId: 'external-import' },
  '外部取り込み': { tabId: 'インポート', pageId: 'external-import' },
  'Notion同期': { tabId: 'インポート', pageId: 'notion-sync' },
  'Xブックマーク': { tabId: 'Webクリップ', pageId: 'x-bookmarks' },
  'Xアカウント保存': { tabId: 'Webクリップ', pageId: 'x-account-posts' },
  'Web Clipper': { tabId: 'Webクリップ', pageId: 'web-clipper' },
  'ウェブクリップ': { tabId: 'Webクリップ', pageId: 'web-clipper' },
  'Chrome拡張機能': { tabId: 'Webクリップ', pageId: 'web-clipper' },
  'Meldex本体': { tabId: '導入・アプリ連携', pageId: 'setup' },
  'クイックメモ': { tabId: '導入・アプリ連携', pageId: 'quick-memo-setup' },
  'ファイル関連付け': { tabId: '導入・アプリ連携', pageId: 'file-associations' },
  '定期実行': { tabId: 'インポート', pageId: 'import-schedules' },
  '診断・更新': { tabId: 'フィードバック', pageId: 'diagnostics' },
  'フォーム・受信箱の管理': { tabId: 'フィードバック', pageId: 'feedback-management' },
  '連携': { tabId: 'Webクリップ', pageId: 'web-clipper' },
  '拡張機能': { tabId: '拡張機能', pageId: 'extensions' },
  'ゴミ箱': { tabId: 'ゴミ箱・データ保守', pageId: 'trash' },
  'DB': { tabId: 'ゴミ箱・データ保守', pageId: 'database' },
  'データ保守': { tabId: 'ゴミ箱・データ保守', pageId: 'database' },
  'データ保護': { tabId: 'ゴミ箱・データ保守', pageId: 'database' },
  'データベース': { tabId: 'ゴミ箱・データ保守', pageId: 'database' },
  'データベースメンテナンス': { tabId: 'ゴミ箱・データ保守', pageId: 'database' },
  '送信設定': { tabId: 'フィードバック', pageId: 'feedback' },
  'クラッシュ送信設定': { tabId: 'フィードバック', pageId: 'feedback' },
  'フィードバック・送信設定': { tabId: 'フィードバック', pageId: 'feedback' },
  'フィードバック・診断': { tabId: 'フィードバック', pageId: 'feedback' },
});

function _settingsAutoTagPageVisible() {
  if (typeof window.isAutoTagRuntimeAvailable === 'function') {
    return window.isAutoTagRuntimeAvailable();
  }
  const standalone = /(?:^|\/)[^/?#]*-standalone\.html$/i.test(location.pathname || '');
  const cloudMode = window.MeldexRuntimeAdapter?.isPwaMode?.()
    || ['browser', 'dropbox'].includes(document.body?.dataset?.cloudMode || '');
  if (standalone) return false;
  const cloudStatic = Boolean(window.MeldexCloudRuntimeConfig?.cloudPublicUrl)
    && String(window.MeldexCloudRuntimeConfig?.version?.variant || '').includes('cloud');
  return !cloudMode && !cloudStatic;
}

function _settingsNavigationRuntimeTabs() {
  const autoTagVisible = _settingsAutoTagPageVisible();
  const desktop = _settingsDesktopFeaturesAvailable();
  const desktopPages = new Set(['local-llm', 'extensions', 'file-associations', 'renderlist', 'import-schedules', 'feedback-management', 'notion-sync', 'x-account-posts', 'duplicates']);
  return MELDEX_SETTINGS_NAVIGATION.map(tab => ({
    ...tab,
    desc: !desktop && tab.id === 'AI' ? 'AIキー、管理者AI、記憶・指示、AI使用量'
      : !desktop && tab.id === '導入・アプリ連携' ? 'Meldex本体、クイックメモの追加・起動'
      : !desktop && tab.id === 'インポート' ? '外部ノート・Googleデータの取り込み'
      : !desktop && tab.id === 'Webクリップ' ? 'Web Clipper、Xブックマークの共通設定'
      : !desktop && tab.id === 'ゴミ箱・データ保守' ? '削除したファイルの復元、タグのメンテナンス'
      : !desktop && tab.id === 'フィードバック' ? '不具合・要望の報告、送信設定、診断・更新' : tab.desc,
    pages: tab.pages.filter(page => (page.id !== 'auto-tag' || autoTagVisible) && (desktop || !desktopPages.has(page.id)))
      .map(page => !desktop && page.id === 'cli' ? { ...page, label: '管理者AI', commitMode: 'immediate-safe' } : page),
  })).filter(tab => tab.pages.length);
}

function _settingsDesktopFeaturesAvailable() {
  const mode = window.MeldexRuntimeAdapter?.getMode?.() || document.body?.dataset?.cloudMode || '';
  const cloudStatic = Boolean(window.MeldexCloudRuntimeConfig?.cloudPublicUrl)
    && String(window.MeldexCloudRuntimeConfig?.version?.variant || '').includes('cloud');
  return !window.MeldexRuntimeAdapter?.isPwaMode?.() && !['browser', 'dropbox'].includes(mode) && !cloudStatic;
}

function _settingsNavigationFindTab(tabId) {
  return _settingsNavigationRuntimeTabs().find(tab => tab.id === tabId) || null;
}

function _settingsNavigationFindPage(tab, pageId) {
  if (!tab) return null;
  return tab.pages.find(page => page.id === pageId || page.label === pageId) || tab.pages[0] || null;
}

function getSettingsNavigationTabs() {
  return _settingsNavigationRuntimeTabs();
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
  return target.pageLabel && target.pageLabel !== target.tabId && target.tab?.pages?.length > 1
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
    // 現行HTMLが明示した所属先を優先し、旧HTMLだけを順序で補完する。
    // 項目追加によるインデックスずれで別画面へ混ざる事故を防ぐ。
    if (child.dataset.settingsView) return;
    const view = views[index];
    if (!view) return;
    child.dataset.settingsView = Array.isArray(view) ? view.join(' ') : String(view);
  });
}

function _tagSettingsNavigationSections(root = document) {
  const scope = root?.querySelector ? root : document;
  // 旧HTMLとの互換用フォールバック。現行HTMLは data-settings-view を正とする。
  _settingsTagDirectChildren(scope.querySelector('.settings-panel[data-panel="全般"]'), [
    'storage',   // 0 ソースフォルダ
    'storage',   // 1 #settings-cloud-link-card（Dropbox 状態カード）
    'storage',   // 2 ホームフォルダ
    'storage',   // 3 スクリーンショット保存先
    'storage',   // 4 保存の仕組み
    'file-associations', // 5 ファイルを開くアプリ
    'setup',     // 6 ホーム画面に追加（#settings-install-container）
    'transfer',  // 7 設定の引き継ぎ
    'display',   // 8 表示オプション
    'display',   // 9 表示サイズ
    'display',   // 10 自動起動
    'history',   // 11 ヒストリー（Undo/Redo）
    'history',   // 12 自動バージョン保存
    'history',   // 13 レイアウト
    'history',   // 14 履歴データのエクスポート
    'transfer',  // 15 全設定リセット
  ]);
  _settingsTagDirectChildren(scope.querySelector('.settings-panel[data-panel="LLM"]'), [
    'auto-tag',
    'ai-keys',
    'local-llm',
    'cli',
    'memory',
    'memory',
    'memory',
    'memory',
  ]);
  _settingsTagDirectChildren(scope.querySelector('.settings-panel[data-panel="ユーザー"]'), [
    'profile',
    'users',
    'users',
  ]);
  _settingsTagDirectChildren(scope.querySelector('.settings-panel[data-panel="取り込み"]'), [
    'external-import',
    'x-bookmarks',
    'x-account-posts',
  ]);
  _settingsTagDirectChildren(scope.querySelector('.settings-panel[data-panel="拡張機能"]'), [
    'web-clipper',
    'notion-sync',
    'extensions',
  ]);
  _settingsTagDirectChildren(scope.querySelector('.settings-panel[data-panel="データベース"]'), [
    'database',
    'database',
    'duplicates',
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
    if (target.view === 'theme' && panel.dataset.panel === 'テーマ' && typeof settingsThemeSyncSimpleModeVisibility === 'function') settingsThemeSyncSimpleModeVisibility(panel);
  });
}
