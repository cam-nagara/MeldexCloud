/**
 * Meldex Settings, Theme & User Management
 * 設定モーダル、テーマ管理、ユーザー管理、Notion連携、ゴミ箱
 */

const MELDEX_AVATAR_BG_DEFAULT = '#000000';
const MELDEX_LLM_API_KEY_URLS = Object.freeze({
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://platform.claude.com/settings/keys',
  gemini: 'https://aistudio.google.com/app/apikey',
});
const MELDEX_WEBCLIP_GUIDE_PATH = 'MeldexHome/マニュアル/03_設定と連携/Chrome拡張機能の設定.md';
const MELDEX_DEFAULT_APPS_GUIDE_PATH = 'MeldexHome/マニュアル/04_サポート/Windows 既定アプリの設定.md';

function _settingsStorageLabel() {
  const mode = window.MeldexRuntimeAdapter?.getMode?.() || 'legacy';
  if (mode === 'dropbox') return 'Dropboxと接続中';
  if (mode === 'server') return 'Meldex共有サーバーに接続中';
  return 'このPCに保存';
}

function getMeldexSampleDownloadUrl() {
  const cfg = window.MeldexCloudRuntimeConfig || {};
  return String(cfg.samples?.downloadUrl || cfg.sampleDownloadUrl || '').trim();
}

function openMeldexSampleDownload() {
  const url = getMeldexSampleDownloadUrl() || 'https://github.com/cam-nagara/MeldexCloud/releases';
  window.open(url, '_blank', 'noopener');
}

function closeSettingsModalRestoringTheme() {
  const overlay = document.querySelector('.modal-overlay[data-settings-modal="1"]');
  if (!overlay) return;
  if (typeof restoreThemeSnapshot === 'function') restoreThemeSnapshot(window._settingsThemeSnapshot);
  overlay.remove();
}

function _setSettingsAvatarPreview(el, avatar) {
  if (!el) return;
  el.textContent = '';
  const src = String(avatar || '').trim();
  if (!src) return;
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
  el.appendChild(img);
}

function openMeldexSampleGuide() {
  closeSettingsModalRestoringTheme();
  if (!window.MeldexRuntimeAdapter?.isDropboxMode?.() && typeof openPage === 'function') {
    openPage('サンプルデータを取り込む', 'MeldexHome/マニュアル/01_はじめに/サンプルデータを取り込む.md', { fromExplorer: true, skipAutoAppLayout: true });
    return;
  }
  window.open('public-index.html#samples', '_blank', 'noopener');
}

function isWebClipperDesktopSetupAvailable() {
  try {
    const host = String(window.location.hostname || '').toLowerCase();
    const local = !host || host === 'localhost' || host === '127.0.0.1' || host === '::1';
    return window.location.protocol !== 'https:' || local;
  } catch {
    return true;
  }
}

function _shouldUseSettingsMobileLayout() {
  try {
    if (window.MeldexCloudMobileState?.mobile === true) return true;
    if (document.body?.dataset?.cloudMobile === '1' && window.innerWidth <= 1024) return true;
    if (window.matchMedia?.('(max-width: 1024px), (pointer: coarse)')?.matches) return true;
  } catch {}
  return window.innerWidth <= 768;
}

function _settingsLayoutZoom() {
  const zoom = typeof _getZoom === 'function'
    ? Number(_getZoom())
    : Number.parseFloat(document.documentElement?.style?.zoom || '1');
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

function _settingsModalViewportLimit(axis, margin, fallback) {
  const viewport = axis === 'height'
    ? (window.visualViewport?.height || window.innerHeight || document.documentElement?.clientHeight || 720)
    : (window.visualViewport?.width || window.innerWidth || document.documentElement?.clientWidth || 1024);
  const zoom = _settingsLayoutZoom();
  return Math.max(fallback, Math.floor((viewport - margin) / zoom));
}

function _settingsModalViewportStyle(isMobile) {
  const widthLimit = _settingsModalViewportLimit('width', isMobile ? 16 : 72, isMobile ? 240 : 320);
  const heightLimit = _settingsModalViewportLimit('height', isMobile ? 16 : 72, isMobile ? 240 : 320);
  const baseWidth = isMobile ? 560 : 980;
  const baseHeight = isMobile ? 600 : 720;
  return [
    'box-sizing:border-box',
    `width:min(${baseWidth}px, ${widthLimit}px)`,
    `max-width:${widthLimit}px`,
    `height:min(${baseHeight}px, ${heightLimit}px)`,
    `max-height:${heightLimit}px`,
  ].join(';') + ';';
}

function _normalizeAvatarBgColor(value) {
  const raw = String(value || '').trim();
  if (/^#[0-9a-f]{3}$/i.test(raw) || /^#[0-9a-f]{6}$/i.test(raw) || /^#[0-9a-f]{8}$/i.test(raw)) return raw;
  if (/^rgba?\(\s*[\d.\s%,]+\)$/i.test(raw) || /^hsla?\(\s*[\d.\s%,]+\)$/i.test(raw)) return raw;
  return MELDEX_AVATAR_BG_DEFAULT;
}

function _getAvatarBgColor() {
  return _normalizeAvatarBgColor(localStorage.getItem('meldex-avatar-bg'));
}

function _setAvatarBgColor(color) {
  const next = _normalizeAvatarBgColor(color);
  localStorage.setItem('meldex-avatar-bg', next);
  return next;
}

/* ==============================
   ルートフォルダ設定
   ============================== */
async function showSettingsModal(opts) {
  // opts: { panel: 'ユーザー' } で特定パネルを開ける
  opts = opts || {};
  try {
    window.MeldexDiagnostics?.recordOperation?.('設定を開く', {
      settingsPanel: opts.panel || '全般',
      cloudMode: window.MeldexRuntimeAdapter?.getMode?.() || 'legacy',
    });
  } catch {}
  try {
    if (document.getElementById('sidebar')?.classList?.contains('cloud-mobile-tree-screen-open')) {
      window.MeldexCloudMobile?.closeSidebar?.();
    }
  } catch {}
  // 「公開」は各アプリ(ノート/シナリオ/シート/ボード/スマートシート)のメニューボタンから
  // ファイル単位で設定するよう移行 (showPublishSettingsModal)。設定ダイアログには置かない。
  const settingsNavigationTabs = typeof getSettingsNavigationTabs === 'function'
    ? getSettingsNavigationTabs()
    : [
      { id: 'ユーザー・共同作業', desc: 'ユーザー名、ワークスペース、メンバー', icon: 'usersRound' },
      { id: '保存先・フォルダ', desc: 'ホームフォルダ、保存先、ソースフォルダ', icon: 'folder' },
      { id: '表示・起動', desc: '表示サイズ、見やすさ、起動時の動作', icon: 'monitorCog' },
      { id: 'テーマ', desc: 'テーマ、テーマカラー、フォント', icon: 'palette' },
      { id: 'ショートカット', desc: 'キーボード操作', icon: 'keyboard' },
      { id: 'AI・Discord', desc: 'AIキー、AI使用量、Discord連携', icon: 'bot' },
      { id: 'インポート', desc: '外部取り込み、Notion同期、拡張機能', icon: 'download' },
      { id: '導入・アプリ連携', desc: 'サンプル、ホーム画面追加、ファイル関連付け', icon: 'download' },
      { id: '履歴・引き継ぎ', desc: 'Undo、バージョン保存、設定移行', icon: 'history' },
      { id: 'ゴミ箱・データ保守', desc: 'ゴミ箱、バックアップ、内部データ', icon: 'database' },
      { id: 'フィードバック', desc: 'フィードバック、利用統計、診断', icon: 'messageSquareText' },
    ];
  const settingsTabGroups = [
    { label: '設定', tabs: settingsNavigationTabs.map(tab => tab.id) },
  ];
  const settingsTabs = settingsTabGroups.flatMap(group => group.tabs);
  const settingsTabLabel = (name) => typeof _settingsNavigationTabLabel === 'function' ? _settingsNavigationTabLabel(name) : name;
  const settingsTabDescription = (name) => typeof _settingsNavigationDescription === 'function' ? _settingsNavigationDescription(name) : '';
  const settingsTabIcon = (name) => typeof _settingsNavigationIcon === 'function' ? _settingsNavigationIcon(name) : 'circle';
  const defaultSettingsTab = typeof _settingsDefaultTabId === 'function' ? _settingsDefaultTabId() : (settingsTabs[0] || '全般');
  const requestedPanel = opts.panel ? (typeof resolveSettingsNavigationTarget === 'function' ? resolveSettingsNavigationTarget(opts.panel).tabId : _settingsCanonicalPanelName(opts.panel || '')) : '';
  _settingsThemeSetDirty(false);
  window._settingsOutlinerRootsDirty = false;
  // テーマ変更のキャンセル用にスナップショットを保存
  const _themeSnapshot = snapshotThemeVars();
  const _currentTheme = detectCurrentTheme();
  const _storageLabel = _settingsStorageLabel();
  const _workspaceState = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || null;
  const _serverConnection = window.MeldexRuntimeAdapter?.getServerConnection?.() || null;
  const _storageDetail = _serverConnection?.url
    ? _serverConnection.url
    : _workspaceState?.path
    ? `${_workspaceState.path}${_workspaceState.access ? ' / ' + _workspaceState.access : ''}`
    : '未接続';
  const _webClipperDesktopSetupAvailable = isWebClipperDesktopSetupAvailable();
  const _webClipperSetupDisabled = _webClipperDesktopSetupAvailable ? '' : ' disabled aria-disabled="true"';

  const o = document.createElement('div');
  o.className = 'modal-overlay';
  o.dataset.settingsModal = '1';
  const _isMobile = _shouldUseSettingsMobileLayout();
  const _settingsModalStyle = _settingsModalViewportStyle(_isMobile);
  o.innerHTML = `<div class="modal settings-modal" style="${_settingsModalStyle}">
    <h3 id="settings-header" style="flex-shrink:0;display:flex;align-items:center;gap:8px;">
      ${_isMobile ? '<button id="settings-back-btn" class="settings-back-btn" type="button" hidden title="設定一覧へ戻る" aria-label="設定一覧へ戻る" style="cursor:pointer;font-size:18px;width:44px;height:44px;border:1px solid var(--border);border-radius:8px;background:var(--bg3);color:var(--fg);">←</button>' : ''}
      <span id="settings-header-text" style="display:inline-flex;align-items:center;gap:8px;min-width:0;"><span class="ico ico-settings"></span><span>設定</span></span>
      <button id="settings-modal-close" class="settings-modal-close" type="button" title="設定を閉じる" aria-label="設定を閉じる" style="margin-left:auto;width:44px;height:44px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border);border-radius:8px;background:var(--bg3);color:var(--fg);">
        ${lucide('x',16)}
      </button>
    </h3>
    <style>
      .settings-modal .settings-sidebar-tab{border:1px solid transparent;background:transparent;color:var(--fg2);font-size:13px;}
      .settings-modal .settings-sidebar-tab:hover{background:var(--bg3);color:var(--fg);}
      .settings-modal .settings-sidebar-tab.active,.settings-modal .settings-sidebar-tab.gb-inner-tab-active{background:var(--accent);border-color:var(--accent);color:var(--ui-fg-strong);font-weight:600;}
      .settings-modal .settings-sidebar-tab svg{flex:0 0 auto;}
      .settings-modal .settings-sidebar-group-label{padding:10px 8px 4px;color:var(--fg2);font-size:11px;font-weight:700;letter-spacing:0;}
      .settings-modal .settings-sidebar-group:first-child .settings-sidebar-group-label{padding-top:0;}
      .settings-modal .settings-nav-group-label{padding:14px 12px 6px;color:var(--fg2);font-size:12px;font-weight:700;}
      .settings-modal .settings-nav-item{width:100%;display:grid;gap:3px;margin:0 0 6px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg2);color:var(--fg);text-align:left;font:inherit;cursor:pointer;}
      .settings-modal .settings-nav-item::after{content:attr(data-desc);display:block;color:var(--fg2);font-size:12px;line-height:1.25;}
      .settings-modal .settings-nav-item:hover,.settings-modal .settings-nav-item:focus-visible{border-color:var(--accent);background:color-mix(in srgb, var(--accent) 10%, var(--bg2));outline:none;}
      .settings-modal .settings-subtab-header{display:flex;gap:6px;align-items:center;padding:8px 0 10px;flex-wrap:wrap;border-bottom:1px solid var(--border);margin-bottom:10px;}
      .settings-modal .settings-subtab-header[hidden]{display:none!important;}
      .settings-modal .settings-subtab{height:30px;display:inline-flex;align-items:center;padding:0 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--fg2);font:inherit;cursor:pointer;}
      .settings-modal .settings-subtab:hover,.settings-modal .settings-subtab:focus-visible{border-color:var(--accent);color:var(--fg);outline:none;}
      .settings-modal .settings-subtab.active{border-color:var(--accent);background:color-mix(in srgb, var(--accent) 16%, var(--bg2));color:var(--fg);font-weight:700;}
      .settings-modal .settings-panel.settings-panel-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px;align-content:start;}
      .settings-modal .settings-panel.settings-panel-grid[hidden]{display:none!important;}
      .settings-modal .settings-panel-grid .gb-section{margin:0;}
      .settings-modal .settings-panel-grid .settings-section-wide{grid-column:1 / -1;}
      @media (max-width: 900px){
        .settings-modal .settings-panel.settings-panel-grid{display:block;}
        .settings-modal .settings-panel-grid .gb-section{margin-bottom:10px;}
      }
    </style>
    <!-- モバイル: セクションリスト -->
    ${_isMobile ? `<div id="settings-nav-list" style="overflow-y:auto;flex:1;">
      ${settingsTabGroups.map(group =>
        `<div class="settings-nav-group" data-settings-nav-group="${esc(group.label)}">
          <div class="settings-nav-group-label">${esc(group.label)}</div>
          ${group.tabs.map(t => `<button type="button" class="settings-nav-item" data-target="${t}" data-desc="${esc(settingsTabDescription(t))}" data-e2e-id="settings-mobile-tab-${esc(t)}">${settingsTabLabel(t)}</button>`).join('')}
        </div>`
      ).join('')}
    </div>` : ''}
    ${!_isMobile ? `<div class="settings-desktop-layout" style="display:flex;min-height:0;flex:1;overflow:hidden;border-top:1px solid var(--border);">
      <nav id="settings-tab-header" class="settings-sidebar" aria-label="設定カテゴリ" style="width:176px;flex:0 0 176px;padding:12px 10px 12px 0;margin-right:14px;border-right:1px solid var(--border);overflow-y:auto;">
      ${settingsTabGroups.map(group =>
        `<div class="settings-sidebar-group" data-settings-sidebar-group="${esc(group.label)}">
          <div class="settings-sidebar-group-label">${esc(group.label)}</div>
          ${group.tabs.map((t) =>
            `<button type="button" class="settings-tab settings-sidebar-tab gb-inner-tab${t===defaultSettingsTab?' gb-inner-tab-active active':''}" data-tab="${t}" data-e2e-id="settings-tab-${esc(t)}" data-action="switchSettingsTab(this)" title="${settingsTabLabel(t)}" style="width:100%;display:flex;align-items:center;gap:8px;margin:0 0 4px;padding:8px 10px;border-radius:6px;text-align:left;white-space:nowrap;cursor:pointer;">${lucide(settingsTabIcon(t),14)}<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;">${settingsTabLabel(t)}</span></button>`
          ).join('')}
        </div>`
      ).join('')}
      </nav>
      <div class="settings-desktop-panel" style="min-width:0;flex:1;display:flex;flex-direction:column;">` : ''}
    <!-- タブ内容 -->
    <div style="overflow-y:auto;flex:1;">
    <div id="settings-subtab-header" class="settings-subtab-header" hidden></div>
    <!-- 全般 -->
    <div class="settings-panel settings-panel-grid settings-panel-grid--general" data-panel="全般">
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('home',14)} ホームフォルダ ${fieldHelp('Meldexのデフォルトフォルダです。新規追加時のフォールバック先になります')}</div>
        <div class="gb-field-row" style="flex-wrap:nowrap;">
          <input id="modal-home-folder" type="text" class="gb-input" data-gb-path-input style="flex:1;" value="${esc(_homeFolderPath)}" readonly>
          <button class="gb-btn gb-btn-sm" data-action="_changeHomeFolder()">変更</button>
        </div>
      </section>
      <section class="gb-section gb-section--boxed settings-section-wide">
        <div class="gb-section-title">${lucide('folder',14)} ソースフォルダ ${fieldHelp('フォルダツリーに表示するフォルダを管理します')}</div>
        <div id="modal-outliner-roots"><div class="gb-section-desc">読み込み中...</div></div>
        <div>
          <button class="gb-btn gb-btn-sm" data-action="addOutlinerRootFromSettings()">+ フォルダを追加</button>
        </div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('archive',14)} サンプルデータ ${fieldHelp('ホームフォルダにサンプル作品を追加します。既にあるファイルは上書きしません')}</div>
        <div class="gb-field-row" style="justify-content:flex-start;flex-wrap:wrap;">
          <button type="button" class="gb-btn gb-btn-sm" data-action="window.MeldexSampleInstaller?.openPrompt?.({ force: true, trigger: 'settings-samples' })">${lucide('archive',14)} サンプルを追加</button>
          <button type="button" class="gb-btn gb-btn-sm" data-action="openMeldexSampleGuide()">${lucide('bookOpen',14)} 取り込み手順</button>
        </div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('server',14)} 保存の仕組み・共有サーバー ${fieldHelp('このPCのフォルダ、Dropbox、またはMeldex共有サーバーのどれに保存・接続するかを選びます')}</div>
        <div id="settings-storage-mode" class="gb-section-desc">現在: ${esc(_storageLabel)}</div>
        <div id="settings-storage-detail" class="gb-section-desc">接続先: ${esc(_storageDetail)}</div>
        <div class="gb-field-row" style="justify-content:flex-start;">
          <button class="gb-btn gb-btn-sm" data-action="closeSettingsModalRestoringTheme(); window.MeldexCloudBootstrap?.openSettingsFlow?.()">保存先を設定...</button>
        </div>
      </section>
      <section class="gb-section gb-section--boxed settings-section-wide">
        <div class="gb-section-title">${lucide('smartphone',14)} スマホ・タブレットからの接続 ${fieldHelp('このPCで開くURLと、同じネットワーク内で使える候補URLを表示します。通常は安全のためこのPC内だけに公開されるため、スマホから接続できない場合はブラウザ版Meldexまたは管理者が用意した共有URLを使ってください')}</div>
        <div class="gb-field-row" style="align-items:center;gap:8px;flex-wrap:wrap;">
          <code id="settings-mobile-primary-url" style="background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:4px 8px;user-select:all;min-width:220px;">読み込み中...</code>
          <button type="button" class="gb-btn gb-btn-sm" data-action="copySettingsMobilePrimaryUrl()">${lucide('copy',14)} URLをコピー</button>
          <button type="button" class="gb-btn gb-btn-sm" data-action="loadMobileAccessUrlsForSettings()">${lucide('refreshCw',14)} 更新</button>
        </div>
        <div id="settings-mobile-url-list" class="gb-section-desc">接続情報を取得中...</div>
      </section>
      <div id="settings-install-container">
        <section class="gb-section gb-section--boxed">
          <div class="gb-section-title">${lucide('download',14)} ホーム画面に追加</div>
          <div class="gb-section-desc">表示時に読み込みます…</div>
        </section>
      </div>
      <section class="gb-section gb-section--boxed settings-section-wide" id="settings-default-apps-section">
        <div class="gb-section-title">${lucide('fileCog',14)} ファイルを開くアプリ ${fieldHelp('Windowsでファイルをダブルクリックした時に、Meldexの単独アプリで開くようにします。Windowsが確認を必要とする場合は、既定アプリ画面を開きます')}</div>
        <div id="settings-default-apps-status" class="gb-section-desc">読み込み中...</div>
        <div class="gb-field-row" style="justify-content:flex-start;flex-wrap:wrap;margin-top:8px;">
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="settings-default-app-sheet" data-action="setMeldexDefaultApp" data-args='["sheet"]'>${lucide('table',14)} シート/CSVをMeldex Sheetにする</button>
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="settings-default-app-note" data-action="setMeldexDefaultApp" data-args='["note"]'>${lucide('fileText',14)} MarkdownをMeldex Noteにする</button>
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="settings-default-app-viewer" data-action="setMeldexDefaultApp" data-args='["viewer"]'>${lucide('image',14)} 画像/PDFをMeldex Viewerにする</button>
        </div>
        <div class="gb-field-row" style="justify-content:flex-start;flex-wrap:wrap;margin-top:8px;">
          <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-e2e-id="settings-default-app-refresh" data-action="loadDefaultAppAssociationsForSettings">${lucide('refreshCw',14)} 状態を更新</button>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-e2e-id="settings-default-app-guide" data-action="openDefaultAppsGuide">${lucide('bookOpen',14)} 手順を見る</button>
        </div>
      </section>
      <section class="gb-section gb-section--boxed settings-section-wide">
        <div class="gb-section-title">${lucide('archive',14)} 設定の引き継ぎ ${fieldHelp('このPCのMeldex設定保存先を確認し、別PCへ移す設定ZIPを作成・取り込みできます。LLM APIキーは含まれません')}</div>
        <div id="settings-transfer-location" class="gb-section-desc">読み込み中...</div>
        <div class="gb-field-row" style="justify-content:flex-start;flex-wrap:wrap;">
          <button type="button" class="gb-btn gb-btn-sm" data-action="openSettingsTransferLocation()">${lucide('folderOpen',14)} 設定保存先を開く</button>
          <button type="button" class="gb-btn gb-btn-sm" data-action="exportSettingsTransferBundle()">${uiTransferIcon('export',14) || lucide('upload',14)} 設定をエクスポート</button>
          <button type="button" class="gb-btn gb-btn-sm" data-action="document.getElementById('settings-transfer-import-input')?.click()">${uiTransferIcon('import',14) || lucide('download',14)} 設定をインポート</button>
          <input id="settings-transfer-import-input" type="file" accept=".zip,application/zip" hidden data-onchange="importSettingsTransferBundleFromFile(this)">
        </div>
        <div id="settings-transfer-status" class="gb-section-desc"></div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">表示サイズ</div>
        <label class="gb-field-row">
          <span class="gb-label">表示サイズ:</span>
          <select id="modal-ui-scale" class="gb-select">
            ${[67,75,80,90,100,110,125,150,175,200].map(v => { const cur = parseInt(localStorage.getItem('ui-scale') || '100'); return '<option value="'+v+'"'+(v===cur?' selected':'')+'>'+v+'%</option>'; }).join('')}
          </select>
        </label>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">表示オプション</div>
        <div class="gb-check-row" style="flex-direction:column;align-items:flex-start;">
          <label class="gb-check">
            <input type="checkbox" id="modal-statusbar-hidden" ${localStorage.getItem('meldex-statusbar-hidden') === '1' ? 'checked' : ''}>
            <span>ステータスバーを非表示にする</span>
          </label>
          <label class="gb-check">
            <input type="checkbox" id="modal-a11y-high-contrast" ${(window.MeldexAccessibility?.isPreferenceEnabled?.('highContrast') ?? (localStorage.getItem('meldex-a11y-high-contrast') === '1')) ? 'checked' : ''}>
            <span>ハイコントラスト表示</span>
          </label>
          <label class="gb-check">
            <input type="checkbox" id="modal-a11y-reduced-motion" ${(window.MeldexAccessibility?.isPreferenceEnabled?.('reducedMotion') ?? (localStorage.getItem('meldex-a11y-reduced-motion') === '1')) ? 'checked' : ''}>
            <span>アニメーションを減らす</span>
          </label>
          <label class="gb-check">
            <input type="checkbox" id="modal-a11y-colorblind-safe" ${(window.MeldexAccessibility?.isPreferenceEnabled?.('colorblindSafe') ?? (localStorage.getItem('meldex-a11y-colorblind-safe') === '1')) ? 'checked' : ''}>
            <span>色以外でも状態を見分けやすくする</span>
          </label>
        </div>
      </section>
      <section class="gb-section gb-section--boxed" id="settings-autostart-section">
        <div class="gb-section-title">自動起動</div>
        <label class="gb-check">
          <input type="checkbox" id="modal-autostart">
          <span>OS起動時にMeldexを自動起動する</span>
        </label>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">ヒストリー（Undo/Redo） ${fieldHelp('Ctrl+Z で戻る、Ctrl+Y でやり直し（テキスト編集外で有効）')}</div>
        <label class="gb-field-row">
          <span class="gb-label">最大アンドゥ回数</span>
          <input id="modal-history-max" type="number" class="gb-input" style="width:80px;" value="${getHistoryMax()}" min="1" max="200">
        </label>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">自動バージョン保存 ${fieldHelp('編集があった場合のみ保存します。古いものから自動削除されます')}</div>
        <label class="gb-field-row">
          <span class="gb-label">間隔</span>
          <select id="modal-version-interval" class="gb-select">
            <option value="0" ${getAutoInterval()===0?'selected':''}>オフ</option>
            <option value="600000" ${getAutoInterval()===600000?'selected':''}>10分</option>
            <option value="1800000" ${getAutoInterval()===1800000?'selected':''}>30分</option>
            <option value="3600000" ${getAutoInterval()===3600000?'selected':''}>1時間</option>
            <option value="7200000" ${getAutoInterval()===7200000?'selected':''}>2時間</option>
          </select>
        </label>
        <label class="gb-field-row">
          <span class="gb-label">自動バージョン最大保持数</span>
          <input id="modal-version-max" type="number" class="gb-input" style="width:80px;" value="${getMaxAutoVersions()}" min="1" max="200">
        </label>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">レイアウト ${fieldHelp('現在のパネル配置を単一レイアウトとして保存します。ファイル形式による自動切り替えは行いません')}</div>
        <div class="gb-field-row">
          <button class="gb-btn gb-btn-sm gb-btn-danger" data-action="cfConfirm('レイアウトを初期化しますか？').then(ok=>{if(ok)resetLayoutToDefault();})">レイアウトを初期化</button>
        </div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('table',14)} 履歴データのエクスポート ${fieldHelp('チャット履歴・注釈・スケジュールのイベント・ToDoをホームフォルダにシート形式でエクスポートします（読み取り専用コピー）')}</div>
        <div class="gb-field-row">
          <button id="btn-export-to-db" class="gb-btn gb-btn-sm" data-action="runExportToDb()">エクスポート実行</button>
          <span id="export-to-db-status" class="gb-section-desc"></span>
        </div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">全設定リセット ${fieldHelp('レイアウト・テーマ・フィルタ・表示設定など、この端末に保存された全ての設定を初期化します。ログイン情報もリセットされます')}</div>
        <button class="gb-btn gb-btn-sm gb-btn-danger" data-action="cfConfirm('すべての設定を初期化しますか？\\nテーマ・レイアウト・フィルタ等すべてがリセットされます。\\nページをリロードします。').then(ok=>{if(ok)resetAllSettings();})">全設定を初期化</button>
      </section>
      <div id="settings-cloud-link-card" class="settings-section-wide"></div>
    </div>
    <!-- テーマ -->
    <div class="settings-panel" data-panel="テーマ" data-settings-theme-lazy="1" hidden>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">テーマ</div>
        <div class="gb-section-desc">表示時に読み込みます…</div>
      </section>
    </div>
    <!-- LLM -->
    <div class="settings-panel" data-panel="LLM" hidden>
      <section class="gb-section gb-section--boxed">
        <div id="auto-tag-settings-container">
          <div class="gb-section-desc">自動タグ付け設定を読み込んでいます…</div>
        </div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('messagesSquare',14)} LLMチャット APIキー ${fieldHelp('キーを入れていない会社のAIは使えません。通常はこの端末だけに保存します。別端末へ持ち回る場合は、下のCloud保存を明示的に使ってください')}</div>
        <label class="gb-field-row">
          <span class="gb-label" style="min-width:140px;">Gemini (Google)</span>
          <input id="modal-gemini-key" type="password" class="gb-input" style="flex:1;" placeholder="AIza...">
          <button type="button" class="gb-btn gb-btn-icon settings-llm-key-visibility-btn" title="表示切替" aria-label="Gemini APIキーを表示/非表示" data-action="_toggleLlmKeyVisibility('modal-gemini-key', this)">${lucide('eye',16)}</button>
        </label>
        <label class="gb-field-row">
          <span class="gb-label" style="min-width:140px;">Claude (Anthropic)</span>
          <input id="modal-anthropic-key" type="password" class="gb-input" style="flex:1;" placeholder="sk-ant-...">
          <button type="button" class="gb-btn gb-btn-icon settings-llm-key-visibility-btn" title="表示切替" aria-label="Claude APIキーを表示/非表示" data-action="_toggleLlmKeyVisibility('modal-anthropic-key', this)">${lucide('eye',16)}</button>
        </label>
        <label class="gb-field-row">
          <span class="gb-label" style="min-width:140px;">ChatGPT (OpenAI)</span>
          <input id="modal-openai-key" type="password" class="gb-input" style="flex:1;" placeholder="sk-...">
          <button type="button" class="gb-btn gb-btn-icon settings-llm-key-visibility-btn" title="表示切替" aria-label="OpenAI APIキーを表示/非表示" data-action="_toggleLlmKeyVisibility('modal-openai-key', this)">${lucide('eye',16)}</button>
        </label>
        <div class="gb-field-row" style="align-items:center;gap:8px;flex-wrap:wrap;">
          <span class="gb-label" style="min-width:140px;">Cloud保存 ${fieldHelp('別端末へ持ち回る場合だけ使います。作成・更新・削除は管理者のみ可能です。共有相手へAPIキーを渡す用途ではなく、自分の別端末で読み込むための試験機能です')}</span>
          <input id="modal-llm-cloud-passphrase" type="password" class="gb-input" style="flex:1;min-width:220px;" placeholder="暗号化パスフレーズ">
          <button type="button" class="gb-btn gb-btn-sm" data-action="MeldexLlmKeys.saveCloudFromSettings()">${lucide('cloudUpload',14)} 暗号化して保存</button>
          <button type="button" class="gb-btn gb-btn-sm" data-action="MeldexLlmKeys.loadCloudFromSettings()">${lucide('cloudDownload',14)} 復号して読み込み</button>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-danger" data-action="MeldexLlmKeys.deleteCloudFromSettings()">${lucide('trash2',14)} Cloud保存を削除</button>
        </div>
        <div class="gb-section-desc">Cloud保存は暗号化して保存し、パスフレーズ自体は保存しません。</div>
        <div class="gb-section-desc" style="margin-top:10px;">
          AIへの送信について: 返答を作るため、チャット本文や必要なMeldex内の情報を、選んだAI会社のサーバーへ送ることがあります。${fieldHelp('OpenAI/Claudeは、あなたが同意しない限りAIの学習に使いません。Geminiの無料枠では、Googleの改善や人による確認に使われる場合があります')}
        </div>
        <div class="btn-row" style="justify-content:flex-start;gap:8px;margin-top:10px;flex-wrap:wrap;">
          <button type="button" class="gb-btn gb-btn-sm" role="link" data-e2e-id="settings-llm-openai-api-key-link" data-action="openExternalBrowserUrl" data-args='["${MELDEX_LLM_API_KEY_URLS.openai}"]'>${lucide('externalLink',14)} OpenAI APIキーを取得</button>
          <button type="button" class="gb-btn gb-btn-sm" role="link" data-e2e-id="settings-llm-anthropic-api-key-link" data-action="openExternalBrowserUrl" data-args='["${MELDEX_LLM_API_KEY_URLS.anthropic}"]'>${lucide('externalLink',14)} Claude APIキーを取得</button>
          <button type="button" class="gb-btn gb-btn-sm" role="link" data-e2e-id="settings-llm-gemini-api-key-link" data-action="openExternalBrowserUrl" data-args='["${MELDEX_LLM_API_KEY_URLS.gemini}"]'>${lucide('externalLink',14)} Gemini APIキーを取得</button>
        </div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('server',14)} ローカルLLM ${fieldHelp('Ollama / LM Studio などのOpenAI互換ローカルサーバーを使います。APIキーは使わず、接続先はこのPC内だけに制限されます')}</div>
        <label class="gb-field-row">
          <span class="gb-label" style="min-width:140px;">接続先URL</span>
          <input id="modal-local-llm-base-url" type="text" class="gb-input" style="flex:1;min-width:220px;" value="${esc(localStorage.getItem('chat-local-llm-base-url') || 'http://127.0.0.1:11434/v1')}" placeholder="http://127.0.0.1:11434/v1">
        </label>
        <label class="gb-field-row">
          <span class="gb-label" style="min-width:140px;">既定モデル</span>
          <input id="modal-local-llm-model" type="text" class="gb-input" style="flex:1;min-width:220px;" value="${esc(localStorage.getItem('chat-local-llm-model') || localStorage.getItem('chat-model:local_llm') || 'llama3.1')}" placeholder="llama3.1">
        </label>
        <div class="gb-field-row gb-check-help-row" style="align-items:center;">
          <label class="gb-field-row" style="align-items:center;margin:0;flex:0 1 auto;">
            <span class="gb-label" style="min-width:140px;">Meldex操作</span>
            <input id="modal-local-llm-mcp-enabled" type="checkbox" ${localStorage.getItem('chat-local-llm-mcp-enabled') === '0' ? '' : 'checked'}>
          </label>
          ${fieldHelp('チャットからMeldex内の読み取り・作成・更新ツールを使えるようにします')}
        </div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('terminal',14)} CLIチャット ${fieldHelp('PCに入っている Codex CLI / Claude Code / Gemini CLI を、Meldexのチャットから呼び出します。ターミナルで使えるのに未検出の場合は、Meldexを再起動してください')}</div>
        <div id="settings-cli-chat-container">
          <div class="gb-section-desc">表示時に読み込みます…</div>
        </div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('badgeInfo',14)} カスタムインストラクション ${fieldHelp('シートのフォームで、ユーザー情報・作品前提・回答方針を項目別に入力します。送信した内容はチャットのカスタムインストラクションに反映されます')}</div>
        <button type="button" class="gb-btn gb-btn-sm" data-action="ensureChatCustomInstructionSheet()">${lucide('clipboardList',14)} 入力フォームを開く</button>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('puzzle',14)} スキル ${fieldHelp('特定の作業や話題で使う指示をまとめて登録します。依頼内容が該当する時だけ、チャットが自動で参照します')}</div>
        <button type="button" class="gb-btn gb-btn-sm" data-action="ensureChatSkillsSheet()">${lucide('puzzle',14)} スキルを管理</button>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('brain',14)} ナレッジ ${fieldHelp('チャットの内容から記憶を作り、アイデア出しやプロット相談で自動的に活用します。通常は設定不要です')}</div>
        <div class="gb-field-row" style="justify-content:flex-start;">
          <button type="button" class="gb-btn gb-btn-sm" data-action="openKnowledgeHomeView('items')">${lucide('brain',14)} 記憶一覧を開く</button>
        </div>
        <div id="knowledge-automation-settings-container">
          <div class="gb-section-desc">表示時に読み込みます…</div>
        </div>
      </section>
    </div>
    <!-- LLMコスト -->
    <div class="settings-panel" data-panel="LLMコスト" hidden>
      <div id="chat-cost-settings-container">
        <section class="gb-section gb-section--boxed">
          <div class="gb-section-title">${lucide('walletCards',14)} AI使用量</div>
          <div class="gb-section-desc">表示時に読み込みます…</div>
        </section>
      </div>
    </div>
    <!-- Discord Bot -->
    <div class="settings-panel" data-panel="Discord Bot" hidden>
      <div id="discord-bot-settings-container">
        <section class="gb-section gb-section--boxed">
          <div class="gb-section-title">${lucide('bot',14)} Discord Bot</div>
          <div class="gb-section-desc">表示時に読み込みます…</div>
        </section>
      </div>
    </div>
    <!-- ユーザー -->
    <div class="settings-panel" data-panel="ユーザー" hidden>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">マイプロフィール</div>
        <div style="display:flex;gap:12px;align-items:flex-start;">
          <div id="settings-my-avatar" class="gb-avatar-lg" data-action="chooseAvatarIcon(this)" title="アイコンを変更">
            <span class="gb-avatar-initial">${esc((getUsername()||'?').charAt(0).toUpperCase())}</span>
          </div>
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;">
            <label class="gb-field" style="gap:2px;">
              <span class="gb-label">ユーザー名</span>
              <input id="modal-username" type="text" class="gb-input" style="font-weight:bold;" value="${esc(getUsername())}" placeholder="ユーザー名">
            </label>
            <div class="gb-section-desc">アイコンまたは画像を設定</div>
            <input type="file" id="avatar-upload-input" accept="image/*" hidden data-onchange="uploadAvatar(this)">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <button class="gb-btn gb-btn-xs" data-action="chooseAvatarIcon(document.getElementById('settings-my-avatar'))">アイコンを選択</button>
              <button class="gb-btn gb-btn-xs gb-btn-quiet" data-action="document.getElementById('avatar-upload-input').click()">画像をアップロード</button>
              <button class="gb-btn gb-btn-xs gb-btn-quiet" data-action="removeAvatar()">アイコンを削除</button>
              <button id="avatar-bg-color-btn" type="button" class="gb-color-swatch gb-color-swatch--field" data-color="${esc(_getAvatarBgColor())}" style="background-color:${esc(_getAvatarBgColor())};" title="アイコン背景色"></button>
            </div>
          </div>
        </div>
        <div id="settings-account-link-status"></div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('usersRound',14)} スタッフ</div>
        <div class="gb-section-desc">保存場所: <span id="settings-staff-location">（読み込み中）</span>
          <button type="button" class="gb-btn gb-btn-xs gb-btn-quiet" id="staff-registry-relocate-btn">変更</button>
        </div>
        <div id="settings-staff-list"><div class="gb-section-desc">このタブを開いた時に読み込みます</div></div>
        <div class="gb-field-row" style="justify-content:flex-start;margin-top:8px;">
          <button type="button" class="gb-btn gb-btn-sm" id="staff-registry-open-btn">${lucide('externalLink',14)} スタッフ管理シートを開く</button>
        </div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('lock',14)} 編集ロック中の項目</div>
        <div class="gb-section-desc">管理者はここから編集ロックを解除できます。</div>
        <div id="settings-file-lock-list"><div class="gb-section-desc">このタブを開いた時に読み込みます</div></div>
      </section>
    </div>
    <!-- ワークスペース -->
    <div class="settings-panel" data-panel="ワークスペース" hidden>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('usersRound',14)} ワークスペース</div>
        <div class="gb-section-desc">このタブを開いた時に読み込みます。</div>
      </section>
    </div>
    <!-- 取り込み -->
    <div class="settings-panel" data-panel="取り込み" hidden>
      <div id="external-import-settings-container">
        <section class="gb-section gb-section--boxed">
          <div class="gb-section-title">${lucide('download',14)} 外部ノート取り込み</div>
          <div class="gb-section-desc">表示時に読み込みます…</div>
        </section>
      </div>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('bookmark',14)} Xブックマーク保存</div>
        <div id="x-bookmarks-settings-container">
          <div class="gb-section-desc">表示時に読み込みます…</div>
        </div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('archive',14)} Xアカウントのポスト保存</div>
        <div id="x-account-posts-settings-container">
          <div class="gb-section-desc">表示時に読み込みます…</div>
        </div>
      </section>
    </div>
    <!-- 拡張機能 -->
    <div class="settings-panel" data-panel="拡張機能" hidden>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('blocks',14)} Web Clipper ${fieldHelp('Webページ・画像・選択テキストをブラウザから直接Meldexに保存できます。初期保存先はホームフォルダ内の「Web Clipper」フォルダです')}</div>
        ${_webClipperDesktopSetupAvailable ? '' : '<div class="gb-section-desc" style="color:var(--fg2);">この設定はデスクトップ版用です。クラウド版では、デスクトップ版を起動してから設定してください。</div>'}
        <div id="settings-webclip-status" class="gb-section-desc">表示時に確認します...</div>
        <label class="gb-field" style="margin-top:8px;">
          <span class="gb-label">ブラウザに読み込むフォルダ</span>
          <input id="settings-webclip-install-path" class="gb-input" type="text" readonly value="" placeholder="Web Clipperを準備すると表示されます">
        </label>
        <ol class="gb-section-desc" style="margin:8px 0 0 20px;padding:0;line-height:1.6;">
          <li><strong>Web Clipperを準備</strong>を押します。</li>
          <li><strong>読み込み用フォルダを開く</strong>を押します。</li>
          <li>使うブラウザで拡張機能画面を開き、上のフォルダを読み込みます。</li>
        </ol>
        <div class="gb-field-row" style="justify-content:flex-start;flex-wrap:wrap;margin-top:8px;">
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="settings-webclip-prepare" data-action="prepareWebClipperSetup"${_webClipperSetupDisabled}>${lucide('download',14)} Web Clipperを準備</button>
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="settings-webclip-open-folder" data-action="openWebClipperInstallFolder"${_webClipperSetupDisabled}>${lucide('folderOpen',14)} 読み込み用フォルダを開く</button>
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="settings-webclip-open-guide" data-action="openWebClipperGuide">${lucide('bookOpen',14)} 手順ノートを開く</button>
        </div>
        <div class="gb-section-desc" style="margin-top:10px;">ブラウザ側でデベロッパーモードをONにし、上のフォルダを読み込んでください。</div>
        <div class="gb-field-row" style="justify-content:flex-start;flex-wrap:wrap;margin-top:8px;">
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="settings-webclip-open-chrome" data-action="openWebClipperBrowser" data-args='["chrome"]'${_webClipperSetupDisabled}>${lucide('externalLink',14)} Chromeで開く</button>
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="settings-webclip-open-edge" data-action="openWebClipperBrowser" data-args='["edge"]'${_webClipperSetupDisabled}>${lucide('externalLink',14)} Edgeで開く</button>
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="settings-webclip-open-brave" data-action="openWebClipperBrowser" data-args='["brave"]'${_webClipperSetupDisabled}>${lucide('externalLink',14)} Braveで開く</button>
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="settings-webclip-open-vivaldi" data-action="openWebClipperBrowser" data-args='["vivaldi"]'${_webClipperSetupDisabled}>${lucide('externalLink',14)} Vivaldiで開く</button>
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="settings-webclip-open-opera" data-action="openWebClipperBrowser" data-args='["opera"]'${_webClipperSetupDisabled}>${lucide('externalLink',14)} Operaで開く</button>
        </div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title"><span class="ico ico-sync"></span> Notion同期</div>
        <div id="notion-sync-settings-container">
          <div class="gb-section-desc">表示時に読み込みます…</div>
        </div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">拡張機能 ${fieldHelp('追加機能に必要なパッケージをインストールします。すべての処理はPC上で完結し、画像がAIに学習されることはありません')}</div>
        <div id="ext-status"></div>
      </section>
    </div>
    <!-- ショートカット -->
    <div class="settings-panel" data-panel="ショートカット" hidden>
      <div id="shortcut-settings-container"></div>
    </div>
    <!-- ゴミ箱 -->
    <div class="settings-panel" data-panel="ゴミ箱" hidden>
      <div id="trash-settings-container">
        <section class="gb-section gb-section--boxed">
          <div class="gb-section-title">${lucide('trash2',14)} ゴミ箱</div>
          <div class="gb-section-desc">表示時に読み込みます…</div>
        </section>
      </div>
    </div>
    <!-- データベース -->
    <div class="settings-panel" data-panel="データベース" hidden>
      <div id="database-maintenance-container">
        <section class="gb-section gb-section--boxed">
          <div class="gb-section-title">${lucide('database',14)} データベースメンテナンス</div>
          <div class="gb-section-desc">表示時に読み込みます…</div>
        </section>
      </div>
    </div>
    <!-- フィードバック -->
    <div class="settings-panel" data-panel="フィードバック" hidden>
      <div id="feedback-form-container">
        <section class="gb-section gb-section--boxed">
          <div class="gb-section-title">${lucide('messageSquareText',14)} フィードバック</div>
          <div class="gb-section-desc">表示時に読み込みます…</div>
        </section>
      </div>
      <div id="feedback-settings-container">
        <section class="gb-section gb-section--boxed">
          <div class="gb-section-title">${lucide('send',14)} 送信設定</div>
          <div class="gb-section-desc">表示時に読み込みます…</div>
        </section>
      </div>
    </div>
    </div><!-- /overflow scroll -->
    ${!_isMobile ? '</div></div><!-- /settings desktop layout -->' : ''}
    <div class="btn-row" style="margin-top:12px;flex-shrink:0;">
      <button data-action="closeSettingsModalRestoringTheme()">キャンセル</button>
      <button class="primary" data-action="submitSettings()">保存</button>
    </div>
  </div>`;
  // キャンセル用スナップショットをグローバルに保持
  window._settingsThemeSnapshot = _themeSnapshot;
  document.body.appendChild(o);
  replaceIcons(o);
  if (typeof _tagSettingsNavigationSections === 'function') _tagSettingsNavigationSections(o);
  const settingsCloseBtn = o.querySelector('#settings-modal-close');
  settingsCloseBtn?.addEventListener('click', () => {
    closeSettingsModalRestoringTheme();
  });
  o.querySelector('#settings-back-btn')?.addEventListener('click', () => _backToSettingsList(o));
  o.querySelector('#staff-registry-open-btn')?.addEventListener('click', () => {
    window.MeldexUserRegistry?.openSheet?.();
  });
  // スタッフ管理シートの保存場所を変更する小型ダイアログ。テキスト入力のみの
  // cfPrompt を、列タイプ設定ダイアログの「一覧から選択」と同じ
  // GBFolderPicker.pickFolder を使えるモーダルに置き換える
  // （GBFolderPicker 未定義の環境では従来どおり cfPrompt にフォールバック）。
  function _openStaffRegistryRelocateDialog(initialPath) {
    if (typeof window.GBFolderPicker?.pickFolder !== 'function') {
      return cfPrompt('スタッフ管理シートの保存場所（フォルダパス）を入力してください:', initialPath || '');
    }
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.dataset.modalShell = 'off';
      overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="staff-registry-relocate-title" style="min-width:420px;">
        <h3 id="staff-registry-relocate-title">スタッフ管理シートの保存場所</h3>
        <div class="modal-body">
          <label for="staff-registry-relocate-input" style="display:block;margin-bottom:6px;">フォルダパス</label>
          <div class="db-picker-input-row">
            <input type="text" id="staff-registry-relocate-input" data-gb-path-input value="${esc(initialPath || '')}">
            <button type="button" class="db-picker-btn" id="staff-registry-relocate-pick-btn" title="一覧から選択" aria-label="一覧から選択">${lucide('folderTree', 14)}</button>
          </div>
        </div>
        <div class="btn-row">
          <button type="button" id="staff-registry-relocate-cancel-btn">キャンセル</button>
          <button type="button" class="primary" id="staff-registry-relocate-save-btn">保存</button>
        </div>
      </div>`;
      document.body.appendChild(overlay);
      replaceIcons(overlay);
      const input = overlay.querySelector('#staff-registry-relocate-input');
      let pickerOpen = false; // pickFolder のポップアップ側 Escape ハンドラ（capture）が
      // 先に走った直後でも、同じ Escape 押下でこちらまで閉じてしまわないようにするガード。
      const finish = (val) => {
        document.removeEventListener('keydown', onKeyDown);
        overlay.remove();
        resolve(val);
      };
      const onKeyDown = (e) => { if (e.key === 'Escape' && !pickerOpen) { e.preventDefault(); finish(null); } };
      document.addEventListener('keydown', onKeyDown);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });
      overlay.querySelector('#staff-registry-relocate-cancel-btn').addEventListener('click', () => finish(null));
      overlay.querySelector('#staff-registry-relocate-save-btn').addEventListener('click', () => finish(input.value));
      overlay.querySelector('#staff-registry-relocate-pick-btn').addEventListener('click', async () => {
        pickerOpen = true;
        const selection = await window.GBFolderPicker.pickFolder({
          title: '保存場所のフォルダを選択',
          initialPath: input.value,
        });
        pickerOpen = false;
        if (selection && selection.path) input.value = selection.path;
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(input.value); } });
      input.focus();
      input.select();
    });
  }

  o.querySelector('#staff-registry-relocate-btn')?.addEventListener('click', async () => {
    if (!window.MeldexUserRegistry) return;
    const current = await window.MeldexUserRegistry.getConfig().catch(() => ({ path: '' }));
    const next = await _openStaffRegistryRelocateDialog(current.path || '');
    if (!next || next === current.path) return;
    try {
      await window.MeldexUserRegistry.relocate(next);
      showStatus('スタッフ管理シートの保存場所を変更しました');
      if (typeof _renderStaffRegistrySettings === 'function') _renderStaffRegistrySettings();
    } catch (e) {
      showStatus('保存場所の変更に失敗しました: ' + (e?.message || e), true);
    }
  });
  o.querySelectorAll('.settings-nav-item[data-target]').forEach((item) => {
    item.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      _openSettingsSection(item.dataset.target, o);
    });
  });
  if (typeof bindSettingsThemePanel === 'function') bindSettingsThemePanel(o);
  // モバイル時: 全パネルを非表示にして、セクションリストのみ表示
  if (_isMobile) {
    o.querySelectorAll('.settings-panel').forEach(p => { p.hidden = true; });
    const btnRow = o.querySelector('.btn-row');
    if (btnRow) btnRow.hidden = true;
  }
  // マイプロフィールのアバターを読み込み（localStorageから即座に表示）
  const _cachedAv = localStorage.getItem('meldex-avatar');
  const _cachedAvBg = _getAvatarBgColor();
  const _avEl = document.getElementById('settings-my-avatar');
  if (_avEl) {
    _setSettingsAvatarPreview(_avEl, _cachedAv);
    _avEl.style.background = _cachedAvBg;
  }
  // アバター背景色ボタン
  const avBgBtn = document.getElementById('avatar-bg-color-btn');
  if (avBgBtn) {
    avBgBtn.addEventListener('click', () => {
      if (typeof openColorPalette === 'function') {
        openColorPalette(avBgBtn, _getAvatarBgColor(), (color) => {
          const nextColor = _setAvatarBgColor(color);
          avBgBtn.dataset.color = nextColor;
          avBgBtn.style.backgroundColor = nextColor;
          avBgBtn.style.backgroundImage = '';
          const av = document.getElementById('settings-my-avatar');
          if (av) av.style.background = nextColor;
          // ヘッダーのアバターにも反映
          document.querySelectorAll('.user-avatar-bg').forEach(el => { el.style.background = nextColor; });
          const hadAvatarSpec = !!localStorage.getItem('meldex-avatar-spec');
          if (typeof refreshAvatarIconColor === 'function') refreshAvatarIconColor(nextColor);
          if (!hadAvatarSpec && window.MeldexDropboxProfileSync?.afterLocalProfileChanged) {
            window.MeldexDropboxProfileSync.afterLocalProfileChanged({ avatarBg: nextColor }).catch(() => {});
          }
        });
      }
    });
  }
  // 指定パネルを開く
  if (requestedPanel) {
    if (typeof _openSettingsSection === 'function') {
      _openSettingsSection(opts.panel || requestedPanel);
    } else {
      const tab = o.querySelector(`.settings-tab[data-tab="${requestedPanel}"]`);
      if (tab && typeof switchSettingsTab === 'function') switchSettingsTab(tab);
      else if (tab) tab.click();
    }
  } else if (!_isMobile) {
    const tab = o.querySelector(`.settings-tab[data-tab="${defaultSettingsTab}"]`);
    if (tab && typeof switchSettingsTab === 'function') switchSettingsTab(tab);
    else if (tab) tab.click();
    else if (typeof _openSettingsSection === 'function') _openSettingsSection(defaultSettingsTab, o);
  }
  if (typeof _syncSettingsModalOverlayForPanel === 'function') _syncSettingsModalOverlayForPanel(o, requestedPanel || defaultSettingsTab);
}

async function loadStorageInfoForSettings() {
  const modeEl = document.getElementById('settings-storage-mode');
  const detailEl = document.getElementById('settings-storage-detail');
  if (!modeEl || !detailEl) return;
  const storageLabel = _settingsStorageLabel();
  const serverConnection = window.MeldexRuntimeAdapter?.getServerConnection?.() || null;
  try {
    const info = await window.MeldexStorageAdapter?.describeWorkspace?.();
    const displayPath = info?.path || info?.homePath || '';
    const permission = info?.permission ? ' / ' + info.permission : '';
    modeEl.textContent = '現在: ' + storageLabel;
    detailEl.textContent = '接続先: ' + (serverConnection?.url || (displayPath ? (displayPath + permission) : '未接続'));
  } catch {
    modeEl.textContent = '現在: ' + storageLabel;
    if (serverConnection?.url) detailEl.textContent = '接続先: ' + serverConnection.url;
  }
}

function _collectSettingsTransferUiConfig() {
  const config = {};
  const keys = typeof _settingsDialogStorageKeys === 'function' ? _settingsDialogStorageKeys() : [];
  keys.forEach(key => {
    const value = localStorage.getItem(key);
    if (value != null) config[key] = value;
  });
  return config;
}

function _settingsTransferSetStatus(message, isError) {
  const el = document.getElementById('settings-transfer-status');
  if (el) {
    el.textContent = message || '';
    el.style.color = isError ? 'var(--red)' : 'var(--fg2)';
  }
}

async function loadSettingsTransferStatusForSettings() {
  const locationEl = document.getElementById('settings-transfer-location');
  if (!locationEl) return;
  try {
    const res = await apiFetch('/settings-transfer/status');
    const items = res.items || {};
    const configExists = items.config_file?.exists ? 'あり' : '未作成';
    const dbExists = items.db_path?.exists ? 'あり' : '未作成';
    locationEl.textContent = `保存先: ${res.user_data_dir || ''} / 設定: ${configExists} / 内部データベース: ${dbExists}`;
  } catch (e) {
    locationEl.textContent = '設定保存先を取得できませんでした';
  }
}

function _defaultAppAssociationLabel(appId) {
  const labels = {
    sheet: 'Meldex Sheet',
    note: 'Meldex Note',
    viewer: 'Meldex Viewer',
  };
  return labels[appId] || 'Meldex';
}

function _setDefaultAppsSettingsStatus(message, isError) {
  const el = document.getElementById('settings-default-apps-status');
  if (!el) return;
  el.textContent = message || '';
  el.style.color = isError ? 'var(--red)' : 'var(--fg2)';
}

function _formatDefaultAppExtensions(app) {
  const rows = Array.isArray(app?.extensions) ? app.extensions : [];
  if (!rows.length) return '';
  const defaultCount = rows.filter(row => row?.default).length;
  const lockedCount = rows.filter(row => row?.user_choice_locked).length;
  const summary = `${defaultCount}/${rows.length}件がMeldex`;
  return lockedCount ? `${summary}、${lockedCount}件はWindows設定で確認が必要` : summary;
}

function _renderDefaultAppAssociations(data) {
  const el = document.getElementById('settings-default-apps-status');
  if (!el) return;
  if (!data?.supported) {
    el.textContent = 'Windows版のMeldexでのみ設定できます。';
    el.style.color = 'var(--fg2)';
    return;
  }
  const order = ['sheet', 'note', 'viewer'];
  const apps = data.apps || {};
  const lines = [];
  order.forEach(appId => {
    const app = apps[appId] || {};
    const label = app.label || _defaultAppAssociationLabel(appId);
    const target = app.target_exists ? '単独アプリあり' : '単独アプリが見つかりません';
    const summary = _formatDefaultAppExtensions(app) || '未確認';
    const note = app.note ? ` / ${app.note}` : '';
    lines.push(`${label}: ${summary}（${target}）${note}`);
  });
  el.textContent = lines.join('\n');
  el.style.whiteSpace = 'pre-wrap';
  el.style.color = 'var(--fg2)';
}

async function loadDefaultAppAssociationsForSettings() {
  try {
    const data = await apiFetch('/file-associations/status', { silentError: true });
    _renderDefaultAppAssociations(data);
  } catch (e) {
    _setDefaultAppsSettingsStatus('既定アプリの状態を取得できませんでした: ' + (e.userMessage || e.message || e), true);
  }
}

async function setMeldexDefaultApp(appId, event) {
  const button = event?.currentTarget;
  const label = _defaultAppAssociationLabel(appId);
  if (button) button.disabled = true;
  _setDefaultAppsSettingsStatus(label + ' をWindowsに登録しています...', false);
  try {
    const res = await apiPost('/file-associations/set-default', { app: appId, open_settings: true }, { silentError: true });
    const suffix = res?.settings_opened
      ? ' Windowsの既定アプリ画面を開きました。必要な拡張子でMeldexを選んでください。'
      : '';
    _setDefaultAppsSettingsStatus((res?.message || (label + ' を登録しました。')) + suffix, false);
    await loadDefaultAppAssociationsForSettings();
    if (typeof showStatus === 'function') showStatus(label + ' の既定アプリ設定を更新しました');
  } catch (e) {
    _setDefaultAppsSettingsStatus(label + ' を登録できませんでした: ' + (e.userMessage || e.message || e), true);
  } finally {
    if (button) button.disabled = false;
  }
}

function openDefaultAppsGuide() {
  closeSettingsModalRestoringTheme();
  if (typeof openPage === 'function') {
    openPage('Windows 既定アプリの設定', MELDEX_DEFAULT_APPS_GUIDE_PATH, { fromExplorer: true, skipAutoAppLayout: true });
  }
}

async function openSettingsTransferLocation() {
  try {
    const res = await apiPost('/settings-transfer/open-location', {});
    _settingsTransferSetStatus('設定保存先を開きました: ' + (res.path || ''), false);
  } catch (e) {
    _settingsTransferSetStatus('設定保存先を開けませんでした: ' + (e.message || e), true);
  }
}

async function exportSettingsTransferBundle() {
  _settingsTransferSetStatus('エクスポート準備中...', false);
  try {
    const res = await apiPost('/settings-transfer/export', {
      ui_config: _collectSettingsTransferUiConfig(),
    });
    if (res.cancelled) {
      _settingsTransferSetStatus('エクスポートをキャンセルしました', false);
      return;
    }
    _settingsTransferSetStatus('エクスポートしました: ' + (res.path || ''), false);
    if (typeof showStatus === 'function') showStatus('設定をエクスポートしました');
  } catch (e) {
    _settingsTransferSetStatus('エクスポートに失敗しました: ' + (e.message || e), true);
  }
}

function _arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function _settingsTransferAllowedUiConfigKey(key) {
  const normalized = String(key || '').trim();
  if (!normalized) return false;
  const keys = typeof _settingsDialogStorageKeys === 'function' ? _settingsDialogStorageKeys() : [];
  if (keys.map(String).includes(normalized)) return true;
  const prefixes = (typeof _UI_DYNAMIC_PREFIXES !== 'undefined' && Array.isArray(_UI_DYNAMIC_PREFIXES))
    ? _UI_DYNAMIC_PREFIXES
    : ['dbViewConfig:', 'validationRules:', 'entityTemplates:', 'chat-model:', 'chat-models:'];
  return prefixes.some(prefix => normalized.startsWith(prefix));
}

function _applyImportedSettingsTransferUiConfig(uiConfig) {
  if (!uiConfig || typeof uiConfig !== 'object') return 0;
  let count = 0;
  Object.entries(uiConfig).forEach(([key, value]) => {
    const normalizedKey = String(key || '').trim();
    if (!_settingsTransferAllowedUiConfigKey(normalizedKey)) return;
    if (value == null) localStorage.removeItem(normalizedKey);
    else localStorage.setItem(normalizedKey, String(value));
    count += 1;
  });
  if (typeof loadColorSettings === 'function') loadColorSettings();
  const scale = localStorage.getItem('ui-scale');
  if (scale && typeof applyUIScale === 'function') applyUIScale(parseInt(scale, 10) || 100);
  return count;
}

async function importSettingsTransferBundleFromFile(input) {
  const file = input?.files?.[0];
  if (!file) return;
  try {
    const ok = typeof cfConfirm === 'function'
      ? await cfConfirm('選択した設定ZIPをこのPCに取り込みますか？\n現在の設定は自動バックアップされます。取り込み後はMeldexの再起動を推奨します。')
      : window.confirm('選択した設定ZIPをこのPCに取り込みますか？');
    if (!ok) return;
    _settingsTransferSetStatus('インポート中...', false);
    const base64 = _arrayBufferToBase64(await file.arrayBuffer());
    const res = await apiPost('/settings-transfer/import', {
      name: file.name,
      content_base64: base64,
    });
    const appliedCount = _applyImportedSettingsTransferUiConfig(res.ui_config);
    await loadSettingsTransferStatusForSettings();
    const backup = res.backup_path ? ` / 取込前バックアップ: ${res.backup_path}` : '';
    _settingsTransferSetStatus(`インポートしました。反映したUI設定: ${appliedCount}件。Meldexを再起動してください。${backup}`, false);
    if (typeof showStatus === 'function') showStatus('設定をインポートしました。Meldexを再起動してください');
  } catch (e) {
    _settingsTransferSetStatus('インポートに失敗しました: ' + (e.message || e), true);
  } finally {
    if (input) input.value = '';
  }
}

async function _loadAutostartStateForSettings() {
  try {
    const res = await apiFetch('/autostart');
    const cb = document.getElementById('modal-autostart');
    const section = document.getElementById('settings-autostart-section');
    if (!res.supported) {
      if (section) section.hidden = true;
      return;
    }
    if (cb) cb.checked = res.enabled;
  } catch {}
}

async function _loadLlmConfigForSettings() {
  try {
    const serverCfg = await apiFetch('/chat/config').catch(() => null);
    const cfg = window.MeldexLlmKeys?.configShape
      ? await window.MeldexLlmKeys.configShape(serverCfg)
      : serverCfg;
    ['gemini', 'anthropic', 'openai'].forEach(p => {
      const input = document.getElementById('modal-' + (p === 'anthropic' ? 'anthropic' : p === 'openai' ? 'openai' : 'gemini') + '-key');
      const info = cfg?.providers?.[p];
      if (!input || !info?.configured) return;
      input.placeholder = info.localConfigured ? '●●●●●（この端末に保存済み）' : '●●●●●（旧ローカル設定あり）';
    });
  } catch {}
  if (typeof renderCliChatSettingsForSettings === 'function') {
    renderCliChatSettingsForSettings(document.querySelector('.modal-overlay[data-settings-modal="1"]') || document);
  }
}

function _toggleLlmKeyVisibility(inputId, button) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  if (button) {
    button.innerHTML = lucide(show ? 'eyeOff' : 'eye', 16);
    button.title = show ? '非表示にする' : '表示する';
  }
}

async function openExternalBrowserUrl(url, event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const raw = String(url || '').trim();
  let href = '';
  try {
    const parsed = new URL(raw, window.location.href);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('unsupported url');
    href = parsed.href;
  } catch {
    if (typeof showStatus === 'function') showStatus('リンクを開けませんでした', true);
    return;
  }
  try {
    if (typeof apiPost === 'function') {
      await apiPost('/open-external-url', { url: href });
      return;
    }
  } catch (err) {
    console.warn('openExternalBrowserUrl fallback:', err);
  }
  window.open?.(href, '_blank', 'noopener');
}

function _setWebClipperSetupStatus(message, isError) {
  const el = document.getElementById('settings-webclip-status');
  if (!el) return;
  el.textContent = message || '';
  el.style.color = isError ? 'var(--red)' : 'var(--fg2)';
}

function _setWebClipperSetupInfo(info) {
  const pathEl = document.getElementById('settings-webclip-install-path');
  if (pathEl) pathEl.value = info?.install_path || '';
  const prepared = !!info?.prepared;
  _setWebClipperSetupStatus(
    prepared
      ? '準備済みです。ブラウザ側でこのフォルダを読み込んでください。'
      : '未準備です。まず「Web Clipperを準備」を押してください。',
    false
  );
}

async function loadWebClipperSetupForSettings() {
  if (!document.getElementById('settings-webclip-status')) return;
  if (!isWebClipperDesktopSetupAvailable()) {
    _setWebClipperSetupStatus('クラウド版では設定できません。デスクトップ版を起動して設定してください。', false);
    return;
  }
  _setWebClipperSetupStatus('Web Clipperの準備状態を確認中...', false);
  try {
    const info = await apiFetch('/webclip/setup', { silentError: true });
    _setWebClipperSetupInfo(info);
  } catch (e) {
    _setWebClipperSetupStatus('Web Clipperの準備状態を取得できませんでした: ' + (e.message || e), true);
  }
}

async function prepareWebClipperSetup() {
  if (!isWebClipperDesktopSetupAvailable()) {
    _setWebClipperSetupStatus('クラウド版では設定できません。デスクトップ版を起動して設定してください。', false);
    return;
  }
  _setWebClipperSetupStatus('Web Clipperを準備中...', false);
  try {
    const info = await apiPost('/webclip/setup', {}, { silentError: true });
    _setWebClipperSetupInfo(info);
    if (typeof showStatus === 'function') showStatus(info.message || 'Web Clipperを準備しました');
  } catch (e) {
    _setWebClipperSetupStatus('Web Clipperの準備に失敗しました: ' + (e.message || e), true);
  }
}

async function ensureWebClipperSetupReadyForSettings() {
  let info = null;
  try {
    info = await apiFetch('/webclip/setup', { silentError: true });
  } catch {}
  if (!info?.prepared) {
    _setWebClipperSetupStatus('読み込み用フォルダを準備中...', false);
    info = await apiPost('/webclip/setup', {}, { silentError: true });
  }
  _setWebClipperSetupInfo(info);
  return info;
}

async function openWebClipperInstallFolder() {
  if (!isWebClipperDesktopSetupAvailable()) {
    _setWebClipperSetupStatus('クラウド版では設定できません。デスクトップ版を起動して設定してください。', false);
    return;
  }
  _setWebClipperSetupStatus('読み込み用フォルダを開いています...', false);
  try {
    const res = await apiPost('/webclip/open-folder', {}, { silentError: true });
    const pathEl = document.getElementById('settings-webclip-install-path');
    if (pathEl) pathEl.value = res.path || pathEl.value;
    _setWebClipperSetupStatus('読み込み用フォルダを開きました。ブラウザ側でこのフォルダを選んでください。', false);
  } catch (e) {
    _setWebClipperSetupStatus('読み込み用フォルダを開けませんでした: ' + (e.message || e), true);
  }
}

async function openWebClipperBrowser(browser) {
  if (!isWebClipperDesktopSetupAvailable()) {
    _setWebClipperSetupStatus('クラウド版では設定できません。デスクトップ版を起動して設定してください。', false);
    return;
  }
  const key = String(browser || '').trim();
  const labelMap = { chrome: 'Chrome', edge: 'Edge', brave: 'Brave', vivaldi: 'Vivaldi', opera: 'Opera' };
  if (!labelMap[key]) {
    _setWebClipperSetupStatus('対応していないブラウザです。Chrome / Edge / Brave / Vivaldi / Operaから選んでください。', true);
    return;
  }
  _setWebClipperSetupStatus((labelMap[key] || 'ブラウザ') + 'の拡張機能画面を開いています...', false);
  try {
    await ensureWebClipperSetupReadyForSettings();
    const res = await apiPost('/webclip/open-browser', { browser: key }, { silentError: true });
    const label = res.label || labelMap[key] || 'ブラウザ';
    const fallback = res.fallback ? ` 開かない場合は、アドレスバーに ${res.url} を入力してください。` : '';
    _setWebClipperSetupStatus(label + 'の拡張機能画面を開きました。' + fallback, false);
  } catch (e) {
    _setWebClipperSetupStatus('ブラウザを開けませんでした: ' + (e.message || e), true);
  }
}

function openWebClipperGuide() {
  closeSettingsModalRestoringTheme();
  if (typeof openPage === 'function') {
    openPage('Chrome拡張機能の設定', MELDEX_WEBCLIP_GUIDE_PATH, { fromExplorer: true, skipAutoAppLayout: true });
    return;
  }
  window.open('docs/meldex-web-clipper-install-explanation-page-2026-05-09.md', '_blank', 'noopener');
}

// --- フォルダツリールート管理 ---
let _outlinerRoots = [];

function _isDropboxBackedSourcePath(path, root) {
  if (root?.provider === 'dropbox' || root?.dropboxPath) return true;
  const normalized = String(path || '').replace(/\\/g, '/').toLowerCase();
  return normalized.includes('/dropbox/')
    || normalized.includes(' dropbox/')
    || normalized.endsWith('/dropbox')
    || normalized.includes('dropbox');
}

// フォルダツリー一覧の行バッジ（gb-settings-cloud-link.js）と同じ判定。
// パス文字列の緩い判定（_isDropboxBackedSourcePath）は使わない。まだフォルダの
// 実体を持たない「フォルダ追加直後の案内」だけがパス文字列の緩い判定を使い、
// 一覧上部の常設の注意文はこちらの厳密な判定に揃える。これにより、パスに
// 'dropbox' の文字列を含むだけの未登録フォルダ（行バッジは「この端末のみ」）に
// 対して、注意文だけが「端末間で共有されます」と矛盾した表示を出すことを防ぐ。
function _isDropboxProviderRoot(root) {
  return !!(root && (root.provider === 'dropbox' || root.dropboxPath));
}

function _sourceRootDisplayPath(root) {
  if (!root) return '';
  if (root.provider === 'dropbox' || root.dropboxPath) {
    const suffix = root.needsMapping ? '（このPCで場所を確認してください）' : '';
    return `Dropbox: ${root.dropboxPath || root.path || ''}${suffix}`;
  }
  return String(root.path || '');
}

function _createDropboxSourceFolderNotice() {
  const notice = document.createElement('div');
  notice.id = 'settings-dropbox-source-folder-notice';
  notice.className = 'gb-section-desc';
  notice.style.cssText = 'margin:0 0 8px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--fg2);line-height:1.5;';
  notice.innerHTML = 'Dropbox上のソースフォルダは端末間で共有されます。' + (typeof fieldHelp === 'function' ? fieldHelp('このPCで使う場合は、Dropboxアプリ側でも必要なフォルダをローカルで利用可能にしてください') : '');
