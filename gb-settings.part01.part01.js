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
const MELDEX_WEBCLIP_GUIDE_PATH = '03_設定と連携/Chrome拡張機能の設定.md';
const MELDEX_DEFAULT_APPS_GUIDE_PATH = '04_サポート/Windows 既定アプリの設定.md';
const MELDEX_BROWSER_SETTINGS_TRANSFER_BACKUPS_KEY = 'meldex:settings-transfer-browser-backups:v1';
const MELDEX_BROWSER_SETTINGS_TRANSFER_MAX_FILE_BYTES = 64 * 1024 * 1024;

function _settingsStorageLabel() {
  const mode = window.MeldexRuntimeAdapter?.getMode?.() || 'legacy';
  if (mode === 'browser') return 'この端末内に保存';
  if (mode === 'dropbox') return 'Dropboxと接続中';
  return 'このPCに保存';
}

function _settingsStorageConnectionPath(info, workspaceState = null) {
  const state = workspaceState || window.MeldexRuntimeAdapter?.getWorkspaceState?.() || {};
  const rawPath = String(info?.path || info?.homePath || state?.path || '').trim();
  if (!rawPath) return '';
  const mode = window.MeldexRuntimeAdapter?.getMode?.() || 'legacy';
  const isDropbox = mode === 'dropbox' || info?.kind === 'dropbox' || state?.kind === 'dropbox';
  if (!isDropbox) return rawPath;
  const accountName = String(info?.accountName || state?.accountName || '').trim();
  const pathParts = rawPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return ['Dropbox', accountName, ...pathParts].filter(Boolean).join(' / ');
}

let _settingsModalController = null;

function closeSettingsModalWithReason(reason = 'settings-transition', targetOverlay) {
  const overlay = targetOverlay?.matches?.('[data-settings-modal="1"]')
    ? targetOverlay
    : document.querySelector('.modal-overlay[data-settings-modal="1"]');
  if (!overlay) return false;
  const bridge = overlay.__meldexRequestSettingsClose;
  if (typeof bridge === 'function') return bridge(reason);
  const controller = overlay.__meldexSettingsModalController || _settingsModalController;
  if (controller?.isOpen?.()) return controller.close(reason);
  const rawRemove = overlay.__meldexSettingsRawRemove;
  if (typeof rawRemove === 'function' && overlay.isConnected) {
    rawRemove();
    return true;
  }
  return false;
}

if (typeof window !== 'undefined') window.closeSettingsModalWithReason = closeSettingsModalWithReason;

function closeSettingsModalRestoringTheme() {
  const overlay = document.querySelector('.modal-overlay[data-settings-modal="1"]');
  if (!overlay) return;
  if (typeof restoreThemeSnapshot === 'function') restoreThemeSnapshot(window._settingsThemeSnapshot);
  closeSettingsModalWithReason('cancel', overlay);
}

async function openStorageSettingsFlow() {
  const bootstrap = window.MeldexCloudBootstrap;
  if (!bootstrap || typeof bootstrap.openSettingsFlow !== 'function') {
    if (typeof showStatus === 'function') showStatus('保存先の設定を開けませんでした。Meldexを再起動して、もう一度お試しください', true);
    return false;
  }
  closeSettingsModalRestoringTheme();
  try {
    await bootstrap.openSettingsFlow();
    return true;
  } catch (error) {
    const detail = error?.message || String(error || '不明なエラー');
    if (typeof showStatus === 'function') showStatus('保存先の設定を開けませんでした: ' + detail, true);
    return false;
  }
}

if (typeof window !== 'undefined') window.openStorageSettingsFlow = openStorageSettingsFlow;

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

// デスクトップの既定サイズはテーマプレビューまで見渡せる 1070×920。
// ユーザーがフチをドラッグして変えた大きさは gb-modal-shell.js が記憶し、
// 次に開いたときはそちらが優先される。モバイルは従来のコンパクト寸法を維持する。
const SETTINGS_MODAL_BASE_WIDTH = 1070;
const SETTINGS_MODAL_BASE_HEIGHT = 920;
const SETTINGS_MODAL_BASE_WIDTH_MOBILE = 560;
const SETTINGS_MODAL_BASE_HEIGHT_MOBILE = 560;

function _settingsModalViewportStyle(isMobile) {
  const widthLimit = _settingsModalViewportLimit('width', isMobile ? 16 : 72, isMobile ? 240 : 320);
  const heightLimit = _settingsModalViewportLimit('height', isMobile ? 16 : 72, isMobile ? 240 : 320);
  const baseWidth = isMobile ? SETTINGS_MODAL_BASE_WIDTH_MOBILE : SETTINGS_MODAL_BASE_WIDTH;
  const baseHeight = isMobile ? SETTINGS_MODAL_BASE_HEIGHT_MOBILE : SETTINGS_MODAL_BASE_HEIGHT;
  // max-width / max-height はここで指定しない。指定すると共通ダイアログ層
  // （gb-modal-shell.js）が画面内へ収める処理より強く効いてしまい、フチをドラッグして
  // 広げても途中で止まる。画面外へはみ出さないための上限は共通層が一手に引き受ける。
  return [
    'box-sizing:border-box',
    `width:min(${baseWidth}px, ${widthLimit}px)`,
    `height:min(${baseHeight}px, ${heightLimit}px)`,
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
  const _isMobile = _shouldUseSettingsMobileLayout();
  // 「公開」は各アプリ（ノート／シナリオ／シート／ボード）のメニューボタンから
  // ファイル単位で設定するよう移行 (showPublishSettingsModal)。設定ダイアログには置かない。
  const settingsNavigationTabs = typeof getSettingsNavigationTabs === 'function'
    ? getSettingsNavigationTabs()
    : [
      { id: 'ユーザー・共同作業', desc: 'プロフィール、ユーザー、ワークスペースの所属と権限', icon: 'usersRound' },
      { id: '保存先・フォルダ', desc: 'ホームフォルダ、保存先、ソースフォルダ', icon: 'folder' },
      { id: '表示・起動', desc: '表示サイズ、見やすさ、起動時の動作', icon: 'monitorCog' },
      { id: 'テーマ', desc: 'テーマ、テーマカラー、フォント', icon: 'palette' },
      { id: 'ショートカット', desc: 'キーボード操作', icon: 'keyboard' },
      { id: 'AI', desc: 'AIキー、AI使用量', icon: 'bot' },
      { id: 'インポート', desc: '外部取り込み、Notion同期', icon: 'download' },
      { id: 'Webクリップ', desc: 'Web Clipper、Xブックマーク、Xアカウント保存', icon: 'blocks' },
      { id: '拡張機能', desc: '追加機能の導入と状態確認', icon: 'puzzle' },
      { id: '導入・アプリ連携', desc: 'ホーム画面追加、ファイル関連付け', icon: 'download' },
      { id: '履歴・引き継ぎ', desc: 'Undo、バージョン保存、設定移行', icon: 'history' },
      { id: 'ゴミ箱・データ保守', desc: 'ゴミ箱、バックアップ、内部データ', icon: 'database' },
      { id: 'フィードバック', desc: 'フィードバック、利用統計、診断', icon: 'messageSquareText' },
    ];
  const settingsTabGroups = [
    { label: '設定', tabs: settingsNavigationTabs.map(tab => tab.id) },
  ];
  const settingsTabs = settingsTabGroups.flatMap(group => group.tabs);
  const settingsTabLabel = (name) => name === 'Web Clipper'
    ? name
    : (typeof _settingsNavigationTabLabel === 'function' ? _settingsNavigationTabLabel(name) : name);
  const settingsTabDescription = (name) => name === 'Web Clipper'
    ? 'ブラウザの共有からページを保存'
    : (typeof _settingsNavigationDescription === 'function' ? _settingsNavigationDescription(name) : '');
  const settingsTabIcon = (name) => name === 'Web Clipper'
    ? 'blocks'
    : (typeof _settingsNavigationIcon === 'function' ? _settingsNavigationIcon(name) : 'circle');
  const defaultSettingsTab = typeof _settingsDefaultTabId === 'function' ? _settingsDefaultTabId() : (settingsTabs[0] || '全般');
  const requestedPanel = opts.panel ? (typeof resolveSettingsNavigationTarget === 'function' ? resolveSettingsNavigationTarget(opts.panel).tabId : _settingsCanonicalPanelName(opts.panel || '')) : '';
  _settingsThemeSetDirty(false);
  window._settingsOutlinerRootsDirty = false;
  // テーマ変更のキャンセル用にスナップショットを保存
  const _themeSnapshot = snapshotThemeVars();
  const _currentTheme = detectCurrentTheme();
  const _storageLabel = _settingsStorageLabel();
  const _workspaceState = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || null;
  const _storageDetail = _settingsStorageConnectionPath(_workspaceState, _workspaceState) || '未接続';
  // 版履歴の共有移行は「このPCに貯まった版をDropboxの共有保存先へ移す」操作なので、
  // ローカルの版置き場を持たないクラウド版では出さない(押せても何もできないため)。
  const _sharedVersionMigrationAvailable = !(
    window.MeldexRuntimeAdapter?.isBrowserMode?.() || window.MeldexRuntimeAdapter?.isDropboxMode?.()
  );
  const _historySheetExportAvailable = !window.MeldexRuntimeAdapter?.isBrowserDataMode?.();
  const _webClipperDesktopSetupAvailable = isWebClipperDesktopSetupAvailable();
  const _webClipperSetupDisabled = _webClipperDesktopSetupAvailable ? '' : ' disabled aria-disabled="true"';
  const _treeThumbnailsAvailable = window.GBOutlinerThumbnails?.isAvailable?.()
    ?? document.body?.dataset?.cloudMode !== 'dropbox';
  const _treeThumbnailsEnabled = window.GBOutlinerThumbnails?.isEnabled?.()
    ?? localStorage.getItem('gb:tree-thumbnails-enabled') !== '0';
  const _thumbnailFitMode = typeof resolveThumbnailFitMode === 'function' ? resolveThumbnailFitMode() : (localStorage.getItem('gb:thumbnail-fit') === 'cover' ? 'cover' : 'contain');
  const _treeThumbnailSizeMode = typeof resolveThumbnailSizeMode === 'function' ? resolveThumbnailSizeMode() : (['small', 'large'].includes(localStorage.getItem('gb:tree-thumbnail-size')) ? localStorage.getItem('gb:tree-thumbnail-size') : 'medium');
  const _treeOpenClickMode = localStorage.getItem('gb:tree-open-click-mode') === 'double' ? 'double' : 'single';
  const _viewerWheelMode = localStorage.getItem('gb:viewer-wheel-mode') === 'nav' ? 'nav' : 'zoom';
  const _restorePointConfig = typeof getVersionConfig === 'function'
    ? getVersionConfig()
    : window.MeldexRestorePointPolicy?.normalize?.({});
  const _restorePointCadence = _restorePointConfig?.cadence || {};
  const _restorePointRetention = _restorePointConfig?.retention || { mode: 'forever', days: null };
  const _restorePointPolicyScope = window.MeldexRestorePointPolicySync?.currentScope?.()
    || { kind: 'personal', role: 'owner', readOnly: false };
  const _restorePointPolicyReadOnly = _restorePointPolicyScope.kind === 'workspace'
    && _restorePointPolicyScope.readOnly === true;

  let o = document.createElement('div');
  o.className = 'settings-build-root';
  const _settingsModalStyle = _settingsModalViewportStyle(_isMobile);
  o.innerHTML = `<div class="settings-content-host" style="${_settingsModalStyle}">
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
      .settings-modal .settings-sidebar-tab.active,.settings-modal .settings-sidebar-tab.gb-inner-tab-active{background:var(--accent);border-color:var(--accent);color:var(--ui-accent-fg, var(--ui-fg-strong));font-weight:600;}
      .settings-modal .settings-sidebar-tab svg{flex:0 0 auto;}
      .settings-modal .settings-sidebar-tree-node{margin:0 0 2px;}
      .settings-modal .settings-sidebar-subpages{padding-left:56px;}
      .settings-modal .settings-sidebar-subpage{width:100%;display:flex;align-items:center;gap:6px;margin:0 0 2px;padding:4px 8px;border:1px solid transparent;border-radius:4px;background:transparent;color:var(--fg2);font-size:12px;text-align:left;white-space:nowrap;cursor:pointer;}
      .settings-modal .settings-sidebar-subpage:hover{background:var(--bg3);color:var(--fg);}
      .settings-modal .settings-sidebar-subpage.active,.settings-modal .settings-sidebar-subpage.gb-inner-tab-active{background:var(--accent);border-color:var(--accent);color:var(--ui-accent-fg, var(--ui-fg-strong));font-weight:600;}
      .settings-modal .settings-sidebar-group-label{padding:10px 8px 4px;color:var(--fg2);font-size:11px;font-weight:700;letter-spacing:0;}
      .settings-modal .settings-sidebar-group:first-child .settings-sidebar-group-label{padding-top:0;}
      .settings-modal .settings-nav-group-label{padding:14px 12px 6px;color:var(--fg2);font-size:12px;font-weight:700;}
      .settings-modal .settings-nav-item{width:100%;display:grid;gap:3px;margin:0 0 6px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg2);color:var(--fg);text-align:left;font:inherit;cursor:pointer;}
      .settings-modal .settings-nav-item::after{content:attr(data-desc);display:block;color:var(--fg2);font-size:12px;line-height:1.25;}
      .settings-modal .settings-nav-item:hover,.settings-modal .settings-nav-item:focus-visible{border-color:var(--accent);background:color-mix(in srgb, var(--accent) 10%, var(--bg2));outline:none;}
      .settings-modal .settings-mobile-page-list{overflow-y:auto;flex:1;}
      .settings-modal .settings-mobile-page-list-title{padding:8px 12px;color:var(--fg2);font-size:12px;font-weight:700;}
      .settings-modal .settings-mobile-page-item{width:100%;min-height:44px;display:flex;align-items:center;margin:0 0 6px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg2);color:var(--fg);text-align:left;font:inherit;cursor:pointer;}
      .settings-modal .settings-mobile-page-item:hover,.settings-modal .settings-mobile-page-item:focus-visible{border-color:var(--accent);background:color-mix(in srgb, var(--accent) 10%, var(--bg2));outline:none;}
      .settings-modal .settings-subtab-header{display:none!important;}
      .settings-modal .settings-subtab-header[hidden]{display:none!important;}
      .settings-modal .settings-subtab{height:30px;display:inline-flex;align-items:center;padding:0 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--fg2);font:inherit;cursor:pointer;}
      .settings-modal .settings-subtab:hover,.settings-modal .settings-subtab:focus-visible{border-color:var(--accent);color:var(--fg);outline:none;}
      .settings-modal .settings-subtab.active{border-color:var(--accent);background:color-mix(in srgb, var(--accent) 16%, var(--bg2));color:var(--fg);font-weight:700;}
      /* 2列マルチカラム（masonry風）。grid だと非表示セクションの絞り込みで空セルができるため columns を使う */
      .settings-modal .settings-panel.settings-panel-grid{display:block;column-count:2;column-gap:12px;}
      .settings-modal .settings-panel.settings-panel-grid[hidden]{display:none!important;}
      .settings-modal .settings-panel-grid > *{break-inside:avoid;margin:0 0 10px;}
      .settings-modal .settings-panel-grid .settings-section-wide{column-span:all;}
      .settings-modal #settings-cloud-link-card:empty{display:none;}
      .settings-modal[data-settings-mobile-layout="1"] [data-settings-webclip-desktop]{display:none!important;}
      @media (max-width: 900px){
        .settings-modal .settings-panel.settings-panel-grid{column-count:1;}
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
    </div>
    <div id="settings-mobile-page-list" class="settings-mobile-page-list" hidden>
      <div id="settings-mobile-page-list-title" class="settings-mobile-page-list-title"></div>
      <div id="settings-mobile-page-list-items"></div>
    </div>` : ''}
    ${!_isMobile ? `<div class="settings-desktop-layout" style="display:flex;min-height:0;flex:1;overflow:hidden;border-top:1px solid var(--border);">
      <nav id="settings-tab-header" class="settings-sidebar" aria-label="設定カテゴリ" style="width:196px;flex:0 0 196px;padding:12px 10px 12px 0;margin-right:14px;border-right:1px solid var(--border);overflow-y:auto;">
      ${settingsNavigationTabs.map(tab => {
        const hasPages = Array.isArray(tab.pages) && tab.pages.length > 1;
        const isParentActive = tab.id === defaultSettingsTab;
        if (hasPages) {
          return `<div class="settings-sidebar-tree-node${isParentActive ? ' expanded' : ''}" data-tree-tab="${esc(tab.id)}">
            <button type="button" class="settings-tab settings-sidebar-tab settings-sidebar-parent-tab gb-inner-tab${isParentActive ? ' active' : ''}"
              data-tab="${esc(tab.id)}"
              data-e2e-id="settings-tab-${esc(tab.id)}"
              data-action="switchSettingsTab(this)"
              title="${esc(settingsTabLabel(tab.id))}"
              aria-expanded="${isParentActive ? 'true' : 'false'}"
              style="width:100%;display:flex;align-items:center;gap:6px;margin:0 0 2px;padding:6px 8px;border-radius:6px;text-align:left;white-space:nowrap;cursor:pointer;">
              <span class="settings-tree-chevron" style="display:inline-flex;width:12px;height:12px;align-items:center;justify-content:center;flex-shrink:0;">${lucide(isParentActive ? 'chevronDown' : 'chevronRight', 12)}</span>
              ${lucide(settingsTabIcon(tab.id), 14)}
              <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;flex:1;">${esc(settingsTabLabel(tab.id))}</span>
            </button>
            <div class="settings-sidebar-subpages" style="${isParentActive ? '' : 'display:none;'}">
              ${tab.pages.map(page => `
                <button type="button" class="settings-sidebar-subpage${(isParentActive && page.id === tab.pages[0]?.id) ? ' active gb-inner-tab-active' : ''}"
                  data-settings-tab="${esc(tab.id)}"
                  data-settings-page="${esc(page.id)}"
                  data-e2e-id="settings-subtab-${esc(tab.id)}-${esc(page.id)}"
                  data-action="selectSettingsTreeSubpage(this)"
                  title="${esc(page.label)}"
                  style="width:100%;display:flex;align-items:center;gap:6px;margin:0 0 2px;padding:4px 8px;border:1px solid transparent;border-radius:4px;background:transparent;color:var(--fg2);font-size:12px;text-align:left;white-space:nowrap;cursor:pointer;">
                  <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;">${esc(page.label)}</span>
                </button>
              `).join('')}
            </div>
          </div>`;
        } else {
          const pageId = tab.pages?.[0]?.id || '';
          return `<button type="button" class="settings-tab settings-sidebar-tab gb-inner-tab${isParentActive ? ' gb-inner-tab-active active' : ''}"
            data-tab="${esc(tab.id)}"
            data-settings-tab="${esc(tab.id)}"
            data-settings-page="${esc(pageId)}"
            data-e2e-id="settings-tab-${esc(tab.id)}"
            data-action="switchSettingsTab(this)"
            title="${esc(settingsTabLabel(tab.id))}"
            style="width:100%;display:flex;align-items:center;gap:6px;margin:0 0 2px;padding:6px 8px;border-radius:6px;text-align:left;white-space:nowrap;cursor:pointer;">
            <span style="display:inline-flex;width:12px;height:12px;flex-shrink:0;"></span>
            ${lucide(settingsTabIcon(tab.id), 14)}
            <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;flex:1;">${esc(settingsTabLabel(tab.id))}</span>
          </button>`;
        }
      }).join('')}
      </nav>
      <div class="settings-desktop-panel" style="min-width:0;flex:1;display:flex;flex-direction:column;">` : ''}
    <!-- タブ内容 -->
    <div class="settings-panel-scroll" style="min-width:0;overflow-x:hidden;overflow-y:auto;flex:1;">
    <div id="settings-subtab-header" class="settings-subtab-header" hidden></div>
    <!-- 全般 -->
    <div class="settings-panel settings-panel-grid settings-panel-grid--general" data-panel="全般">
      <section class="gb-section gb-section--boxed settings-section-wide" data-settings-view="storage">
        <div class="gb-section-title">${lucide('folder',14)} ソースフォルダ ${fieldHelp('フォルダツリーに表示するフォルダを管理します', { e2eId: 'settings-source-folders-help' })}</div>
        <div id="modal-outliner-roots"><div class="gb-section-desc">読み込み中...</div></div>
        <div>
          <button class="gb-btn gb-btn-sm" data-action="addOutlinerRootFromSettings()">+ フォルダを追加</button>
        </div>
      </section>
      <div id="settings-cloud-link-card" class="settings-section-wide" data-settings-view="storage"></div>
      <section class="gb-section gb-section--boxed settings-section-wide" data-settings-view="storage">
        <div class="gb-section-title">${lucide('home',14)} ホームフォルダ ${fieldHelp('Meldexのデフォルトフォルダです。新規追加時のフォールバック先になります。ソースフォルダが個人用のDropbox等なら、その直下のMeldexHomeへ自動的に揃います', { e2eId: 'settings-home-folder-help' })}</div>
        <div class="gb-field-row" style="flex-wrap:nowrap;">
          <input id="modal-home-folder" type="text" class="gb-input" data-gb-path-input style="flex:1;" value="${esc(_homeFolderPath)}" readonly>
          <button class="gb-btn gb-btn-sm" data-action="_changeHomeFolder()">変更</button>
        </div>
        <div id="home-folder-sharing-status" class="gb-section-desc" hidden></div>
      </section>
      <section class="gb-section gb-section--boxed settings-section-wide" data-settings-view="storage">
        <div class="gb-section-title">${lucide('camera',14)} スクリーンショット保存先 ${fieldHelp('撮影した画像を保存するフォルダです。初期値はホームフォルダ内の「スクリーンショット」です', { e2eId: 'settings-screenshot-folder-help' })}</div>
        <div class="gb-field-row" style="flex-wrap:nowrap;">
          <input id="modal-screenshot-folder" type="text" class="gb-input" data-gb-path-input style="flex:1;" value="${esc(localStorage.getItem('meldex-screenshot-folder') || ((_homeFolderPath || '').replace(/[\\/]$/, '') + '/スクリーンショット'))}" readonly>
          <button type="button" class="gb-btn gb-btn-sm" data-action="changeScreenshotFolder()">変更</button>
        </div>
      </section>
      <section class="gb-section gb-section--boxed settings-section-wide" data-settings-view="storage">
        <div class="gb-section-title">${lucide('hardDrive',14)} 保存の仕組み ${fieldHelp('共同ワークスペースはDropbox、この端末だけで使うデータは端末内へ保存します。NASはソースフォルダとして参照できます', { e2eId: 'settings-storage-mode-help' })}</div>
        <div id="settings-storage-mode" class="gb-section-desc">現在: ${esc(_storageLabel)}</div>
        <div id="settings-storage-detail" class="gb-section-desc">接続先: ${esc(_storageDetail)}</div>
        <div class="gb-field-row" style="justify-content:flex-start;">
          <button class="gb-btn gb-btn-sm" data-e2e-id="settings-storage-mode-open" data-action="openStorageSettingsFlow()">保存先を設定...</button>
        </div>
      </section>
      <section class="gb-section gb-section--boxed settings-section-wide" id="settings-default-apps-section" data-settings-view="setup">
        <div class="gb-section-title">${lucide('fileCog',14)} ファイルを開くアプリ ${fieldHelp('画像とPDFはMeldex Viewerを候補登録できます。シナリオ・シート・ボードはMeldex本体から開きます。既存のWindows既定アプリは自動で上書きしません', { e2eId: 'settings-default-apps-help' })}</div>
        <div id="settings-default-apps-status" class="gb-section-desc">読み込み中...</div>
        <div class="gb-field-row" style="justify-content:flex-start;flex-wrap:wrap;margin-top:8px;">
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="settings-default-app-viewer" data-action="setMeldexDefaultApp" data-args='["viewer"]'>${lucide('image',14)} 画像/PDFをMeldex Viewerにする</button>
        </div>
        <div class="gb-field-row" style="justify-content:flex-start;flex-wrap:wrap;margin-top:8px;">
          <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-e2e-id="settings-default-app-refresh" data-action="loadDefaultAppAssociationsForSettings">${lucide('refreshCw',14)} 状態を更新</button>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-e2e-id="settings-default-app-guide" data-action="openDefaultAppsGuide">${lucide('bookOpen',14)} 手順を見る</button>
        </div>
      </section>
      <div id="settings-install-container" data-settings-view="setup">
        <section class="gb-section gb-section--boxed">
          <div class="gb-section-title">${lucide('download',14)} ホーム画面に追加</div>
          <div class="gb-section-desc">表示時に読み込みます…</div>
        </section>
      </div>
      <section class="gb-section gb-section--boxed settings-section-wide" data-settings-view="transfer">
        <div class="gb-section-title">${lucide('archive',14)} 設定の引き継ぎ ${fieldHelp('このPCのMeldex設定保存先を確認し、別PCへ移す設定ZIPを作成・取り込みできます。LLM APIキーは含まれません', { e2eId: 'settings-transfer-help' })}</div>
        <div id="settings-transfer-location" class="gb-section-desc">読み込み中...</div>
        <div class="gb-field-row" style="justify-content:flex-start;flex-wrap:wrap;">
          <button id="settings-transfer-open-location" type="button" class="gb-btn gb-btn-sm" data-action="openSettingsTransferLocation()">${lucide('folderOpen',14)} 設定保存先を開く</button>
          <button type="button" class="gb-btn gb-btn-sm" data-action="exportSettingsTransferBundle()">${uiTransferIcon('export',14) || lucide('upload',14)} 設定をエクスポート</button>
          <button type="button" class="gb-btn gb-btn-sm" data-action="document.getElementById('settings-transfer-import-input')?.click()">${uiTransferIcon('import',14) || lucide('download',14)} 設定をインポート</button>
          <input id="settings-transfer-import-input" type="file" accept=".zip,application/zip" hidden data-onchange="importSettingsTransferBundleFromFile(this)">
        </div>
        <div id="settings-transfer-status" class="gb-section-desc"></div>
      </section>
      <section class="gb-section gb-section--boxed" data-settings-view="display">
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
          <label class="gb-check">
            <input type="checkbox" id="modal-paste-link-prompt-enabled" ${localStorage.getItem('meldex_suppress_folder_paste_link_choice') !== 'true' ? 'checked' : ''}>
            <span>貼り付け時にリンクファイルを案内</span>
          </label>
        </div>
        ${_treeThumbnailsAvailable ? `<div class="gb-check-help-row" style="margin-top:6px;">
          <label class="gb-check">
            <input type="checkbox" id="modal-tree-thumbnails-enabled" ${_treeThumbnailsEnabled ? 'checked' : ''}>
            <span>フォルダツリーにサムネイルを表示する</span>
          </label>
          ${fieldHelp('PNG・JPEG・PSD・動画など、端末にあるファイルに軽いプレビュー画像を表示します。オンライン上にのみあるファイルは自動取得しません。この端末だけの設定です', { e2eId: 'settings-thumbnail-preview-help' })}
        </div>` : ''}
        <label class="gb-field-row" style="margin-top:6px;">
          <span class="gb-label">サムネイルの表示方法 ${fieldHelp('フォルダツリーやシートの画像サムネイルに適用されます', { e2eId: 'settings-thumbnail-mode-help' })}</span>
          <select id="modal-thumbnail-fit" class="gb-select">
            <option value="cover" ${_thumbnailFitMode === 'cover' ? 'selected' : ''}>枠いっぱいに表示（はみ出た部分は切り抜き）</option>
            <option value="contain" ${_thumbnailFitMode === 'contain' ? 'selected' : ''}>全体を枠内に収める</option>
          </select>
        </label>
        <label class="gb-field-row" style="margin-top:6px;">
          <span class="gb-label">サムネイルのサイズ ${fieldHelp('フォルダツリーの画像サムネイルの大きさです', { e2eId: 'settings-thumbnail-size-help' })}</span>
          <select id="modal-tree-thumbnail-size" class="gb-select">
            <option value="small" ${_treeThumbnailSizeMode === 'small' ? 'selected' : ''}>小</option>
            <option value="medium" ${_treeThumbnailSizeMode === 'medium' ? 'selected' : ''}>中</option>
            <option value="large" ${_treeThumbnailSizeMode === 'large' ? 'selected' : ''}>大</option>
          </select>
        </label>
        <label class="gb-field-row" style="margin-top:6px;">
          <span class="gb-label">フォルダツリーの項目を開く操作 ${fieldHelp('クリックで開く場合も、Ctrl/Shiftクリックでの複数選択はそのまま使えます', { e2eId: 'settings-folder-open-action-help' })}</span>
          <select id="modal-tree-open-click-mode" class="gb-select">
            <option value="double" ${_treeOpenClickMode === 'double' ? 'selected' : ''}>ダブルクリックで開く</option>
            <option value="single" ${_treeOpenClickMode === 'single' ? 'selected' : ''}>クリックで開く</option>
          </select>
        </label>
        <label class="gb-field-row" style="margin-top:6px;">
          <span class="gb-label">ビューワーのマウスホイール操作 ${fieldHelp('画像・PDFビューワーを開いた時に、マウスホイールで何を操作するかです', { e2eId: 'settings-viewer-wheel-help' })}</span>
          <select id="modal-viewer-wheel-mode" class="gb-select">
            <option value="zoom" ${_viewerWheelMode === 'zoom' ? 'selected' : ''}>拡大・縮小</option>
            <option value="nav" ${_viewerWheelMode === 'nav' ? 'selected' : ''}>前後のファイルへ移動</option>
          </select>
        </label>
        <div class="gb-field-row" style="margin-top:6px;justify-content:flex-start;">
          <button type="button" class="gb-btn gb-btn-sm" data-action="showShellVerbSettings()">${lucide('mousePointerClick',14)} OS右クリックメニューを整理</button>
          ${fieldHelp('検出済みのOSコマンドから、フォルダツリーとフォルダパネルのメニュー上部に表示する項目を選べます', { e2eId: 'settings-os-commands-help' })}
        </div>
      </section>
      <section class="gb-section gb-section--boxed" data-settings-view="display">
        <div class="gb-section-title">表示サイズ</div>
        <label class="gb-field-row">
          <span class="gb-label">表示サイズ:</span>
          <select id="modal-ui-scale" class="gb-select">
            ${[67,75,80,90,100,110,125,150,175,200].map(v => { const cur = parseInt(localStorage.getItem('ui-scale') || '100'); return '<option value="'+v+'"'+(v===cur?' selected':'')+'>'+v+'%</option>'; }).join('')}
          </select>
        </label>
      </section>
      <section class="gb-section gb-section--boxed" id="settings-autostart-section" data-settings-view="display">
        <div class="gb-section-title">自動起動 ${fieldHelp('OSへのサインイン後、画面を開かず常駐アプリとバックグラウンド機能を開始します。いつでも解除できます。', { e2eId: 'settings-autostart-help' })}</div>
        <label class="gb-check">
          <input type="checkbox" id="modal-autostart">
          <span>OS起動時にMeldex常駐アプリを開始する</span>
        </label>
        <div id="modal-autostart-status" class="gb-field-help" role="status" aria-live="polite">自動起動の状態を確認しています</div>
      </section>
      <section class="gb-section gb-section--boxed" data-settings-view="history">
        <div class="gb-section-title">設定のバージョン ${fieldHelp('設定を保存する前の状態を自動で残し、変更内容の確認と復元ができます', { e2eId: 'settings-version-history-help' })}</div>
        <div class="gb-field-row">
          <button id="btn-open-settings-versions" class="gb-btn gb-btn-sm" data-action="openUiConfigVersionDialog()">設定の版を表示</button>
        </div>
      </section>
      <section class="gb-section gb-section--boxed" data-settings-view="history">
        <div class="gb-section-title">ヒストリー（Undo/Redo） ${fieldHelp('Ctrl+Z で戻る、Ctrl+Y でやり直し（テキスト編集外で有効）', { e2eId: 'settings-history-undo-help' })}</div>
        <label class="gb-field-row">
          <span class="gb-label">最大アンドゥ回数</span>
          <input id="modal-history-max" type="number" class="gb-input" style="width:80px;" value="${getHistoryMax()}" min="1" max="200">
        </label>
      </section>
      <section class="gb-section gb-section--boxed settings-section-wide" data-settings-view="history">
        <div class="gb-section-title">周期復元ポイント ${fieldHelp('通常の自動保存とは別に、設定した周期が到来し、保存済み内容が変わっている場合だけ復元ポイントを作成します', { e2eId: 'settings-history-auto-version-help' })}</div>
        ${_restorePointPolicyScope.kind === 'workspace'
          ? `<div class="gb-section-desc" role="status">共有ワークスペースの共通方針です。${_restorePointPolicyReadOnly ? '変更できるのは所有者または管理者です。現在は読み取り専用です。' : '所有者／管理者として変更できます。'}</div>`
          : '<div class="gb-section-desc">個人のDesktop／Cloudで共通の方針です。</div>'}
        <fieldset id="restore-point-policy-fields" style="border:0;padding:0;margin:0;min-width:0;" ${_restorePointPolicyReadOnly ? 'disabled aria-disabled="true"' : ''}>
        <label class="gb-check">
          <input id="modal-restore-point-enabled" type="checkbox" ${_restorePointConfig?.enabled !== false ? 'checked' : ''} data-onchange="updateRestorePointScheduleSettingsVisibility()">
          <span>周期復元ポイントを作成する</span>
        </label>
        <div id="restore-point-schedule-fields">
          <label class="gb-field-row">
            <span class="gb-label">周期</span>
            <select id="modal-restore-point-cadence" class="gb-select" data-onchange="updateRestorePointScheduleSettingsVisibility()">
              ${[['hourly','時間単位'],['daily','日単位'],['weekdays','曜日指定'],['weekly','週単位'],['monthly','月単位']].map(([value,label]) => `<option value="${value}" ${_restorePointCadence.kind === value ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
          </label>
          <label id="restore-point-interval-row" class="gb-field-row">
            <span class="gb-label">間隔</span>
            <input id="modal-restore-point-interval" type="number" class="gb-input" style="width:80px;" min="1" max="999" value="${Number(_restorePointCadence.interval || 1)}">
            <span id="restore-point-interval-unit" class="gb-section-desc">時間ごと</span>
          </label>
          <label id="restore-point-time-row" class="gb-field-row">
            <span class="gb-label">実行時刻</span>
            <input id="modal-restore-point-time" type="time" class="gb-input" value="${esc(_restorePointCadence.at || '00:00')}">
          </label>
          <fieldset id="restore-point-weekdays-row" style="border:0;padding:0;margin:8px 0;">
            <legend class="gb-label">曜日</legend>
            <div class="gb-field-row" style="flex-wrap:wrap;">
              ${['日','月','火','水','木','金','土'].map((label,index) => `<label class="gb-check"><input type="checkbox" data-restore-point-weekday="${index}" ${(Array.isArray(_restorePointCadence.weekdays) && _restorePointCadence.weekdays.includes(index)) ? 'checked' : ''}><span>${label}</span></label>`).join('')}
            </div>
          </fieldset>
          <label id="restore-point-month-day-row" class="gb-field-row">
            <span class="gb-label">実行日</span>
            <input id="modal-restore-point-month-day" type="number" class="gb-input" style="width:80px;" min="1" max="31" value="${Number(_restorePointCadence.dayOfMonth || 1)}">
            <span>日</span>
          </label>
          <label id="restore-point-last-day-row" class="gb-check">
            <input id="modal-restore-point-last-day" type="checkbox" ${_restorePointCadence.useLastDayOfMonth ? 'checked' : ''}>
            <span>月の最終日に実行する</span>
          </label>
          <label class="gb-field-row">
            <span class="gb-label">タイムゾーン</span>
            <input id="modal-restore-point-timezone" class="gb-input" value="${esc(_restorePointConfig?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')}">
          </label>
        </div>
        <div id="restore-point-next-run" class="gb-section-desc" role="status" aria-live="polite"></div>
        <div class="gb-section-title" style="margin-top:12px;">保持期間</div>
        <label class="gb-field-row">
          <span class="gb-label">保存する期間</span>
          <select id="modal-restore-point-retention-mode" class="gb-select" data-onchange="updateRestorePointScheduleSettingsVisibility()">
            <option value="forever" ${_restorePointRetention.mode !== 'days' ? 'selected' : ''}>無期限（自動削除しない）</option>
            <option value="days" ${_restorePointRetention.mode === 'days' ? 'selected' : ''}>指定日数</option>
          </select>
        </label>
        <label id="restore-point-retention-days-row" class="gb-field-row">
          <span class="gb-label">保持日数</span>
          <input id="modal-restore-point-retention-days" type="number" class="gb-input" style="width:100px;" min="1" max="36500" value="${Number(_restorePointRetention.days || 30)}">
          <span>日</span>
        </label>
        <div class="gb-section-desc">無期限では、手動・周期・LLM編集直前・復元直前など種類を問わずMeldexが自動削除することはありません。</div>
        </fieldset>
      </section>
      ${_sharedVersionMigrationAvailable ? `
      <section class="gb-section gb-section--boxed" data-settings-view="history">
        <div class="gb-section-title">バージョン履歴の共有 ${fieldHelp('Dropboxの中にあるファイル・フォルダの版履歴を、ダウンロード版とクラウド版で同じ一覧にします。このPCに貯まっていた履歴は、そのファイルの履歴を開いたときに自動で移りますが、ここでまとめて移すこともできます。元の履歴はこのPCにそのまま残ります', { e2eId: 'settings-shared-version-migration-help' })}</div>
        <div class="gb-field-row">
          <button id="btn-migrate-shared-versions" class="gb-btn gb-btn-sm" data-action="runSharedVersionMigration()">まとめて移す</button>
          <span id="migrate-shared-versions-status" class="gb-section-desc"></span>
        </div>
      </section>` : ''}
      <section class="gb-section gb-section--boxed" data-settings-view="history">
        <div class="gb-section-title">レイアウト ${fieldHelp('現在のパネル配置を単一レイアウトとして保存します。ファイル形式による自動切り替えは行いません', { e2eId: 'settings-history-layout-help' })}</div>
        <div class="gb-field-row">
          <button class="gb-btn gb-btn-sm gb-btn-danger" data-action="cfConfirm('レイアウトを初期化しますか？').then(ok=>{if(ok)resetLayoutToDefault();})">レイアウトを初期化</button>
        </div>
      </section>
      <section class="gb-section gb-section--boxed" data-settings-view="history">
        <div class="gb-section-title">${lucide('table',14)} 履歴データのエクスポート ${fieldHelp('チャット履歴・アノテート・スケジュールのイベント・ToDoをホームフォルダにシート形式でエクスポートします（読み取り専用コピー）', { e2eId: 'settings-history-export-help' })}</div>
        <div class="gb-field-row">
          ${_historySheetExportAvailable
            ? '<button id="btn-export-to-db" class="gb-btn gb-btn-sm" data-action="runExportToDb()">エクスポート実行</button><span id="export-to-db-status" class="gb-section-desc"></span>'
            : '<span id="export-to-db-status" class="gb-section-desc">Cloud版では履歴のシート書き出しをまだ利用できません。デスクトップ版の設定から実行してください。</span>'}
        </div>
      </section>
      <section class="gb-section gb-section--boxed settings-section-wide" data-settings-view="transfer">
        <div class="gb-section-title">表示・操作設定の初期化 ${fieldHelp('表示と操作の設定だけを初期化します。作品、ワークスペース、ソースフォルダ、下書き、共有登録、APIキーは保持します', { e2eId: 'settings-reset-all-help' })}</div>
        <button class="gb-btn gb-btn-sm gb-btn-danger" data-action="cfConfirm('表示と操作の設定を初期化しますか？\\n作品、ワークスペース、ソースフォルダ、下書き、共有登録、APIキーは削除しません。\\n成功後にページを再読み込みします。').then(ok=>{if(ok)resetAllSettings();})">表示・操作設定を初期化</button>
      </section>
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
        <div class="gb-section-title">${lucide('terminal',14)} CLIチャット ${fieldHelp('PCに入っている Codex CLI / Claude Code / Antigravity CLI を、Meldexのチャットから呼び出します。ターミナルで使えるのに未検出の場合は、Meldexを再起動してください')}</div>
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
    <!-- ユーザー -->
    <div class="settings-panel" data-panel="ユーザー" hidden>
      <section class="gb-section gb-section--boxed" data-settings-view="profile">
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
      <section class="gb-section gb-section--boxed" data-settings-view="users">
        <div class="gb-section-title">${lucide('usersRound',14)} ユーザー</div>
        <div class="gb-section-desc">アカウントユーザーと、制作管理だけに使うログイン不可の仮ユーザーを管理します。ワークスペースごとの所属とアクセス権限は「ワークスペース」で設定します。</div>
        <div class="gb-section-desc">保存場所: <span id="settings-staff-location">（読み込み中）</span>
          <button type="button" class="gb-btn gb-btn-xs gb-btn-quiet" id="staff-registry-relocate-btn">変更</button>
        </div>
        <div id="settings-staff-list"><div class="gb-section-desc">このタブを開いた時に読み込みます</div></div>
        <div class="gb-field-row" style="justify-content:flex-start;align-items:flex-end;margin-top:8px;">
          <label class="gb-field" style="margin:0;min-width:min(260px,100%);">
            <span class="gb-label">仮ユーザーの表示名</span>
            <input type="text" class="gb-input" id="settings-virtual-user-name" data-e2e-id="settings-virtual-user-name" autocomplete="off">
          </label>
          <button type="button" class="gb-btn gb-btn-sm" id="settings-virtual-user-add" data-e2e-id="settings-virtual-user-add">${lucide('userPlus',14)} 仮ユーザーを追加</button>
        </div>
        <div class="gb-field-row" style="justify-content:flex-start;margin-top:8px;">
          <button type="button" class="gb-btn gb-btn-sm" id="staff-registry-open-btn">${lucide('externalLink',14)} ユーザー管理シートを開く</button>
        </div>
      </section>
      <section class="gb-section gb-section--boxed" data-settings-view="users">
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
      ${window.MeldexMobileWebClipSettings?.render?.() || ''}
      <section class="gb-section gb-section--boxed" data-settings-view="web-clipper" data-settings-webclip-desktop="1">
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
      <section class="gb-section gb-section--boxed" data-settings-view="notion-sync">
        <div class="gb-section-title"><span class="ico ico-sync"></span> Notion同期</div>
        <div id="notion-sync-settings-container">
          <div class="gb-section-desc">表示時に読み込みます…</div>
        </div>
      </section>
      <section class="gb-section gb-section--boxed" data-settings-view="extensions">
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
      <div id="settings-tag-maintenance"></div>
      <div id="settings-duplicate-detection">
        <section class="gb-section gb-section--boxed">
          <div class="gb-section-title">${lucide('copy',14)} 重複ファイルの検出</div>
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
  const legacyModal = o.querySelector('.settings-content-host');
  const legacyHeader = legacyModal?.querySelector('#settings-header');
  const legacyActions = legacyModal?.querySelector(':scope > .btn-row:last-child');
  const bodyContent = document.createDocumentFragment();
  legacyHeader?.remove();
  legacyActions?.remove();
  while (legacyModal?.firstChild) bodyContent.appendChild(legacyModal.firstChild);
  const actionButtons = legacyActions ? Array.from(legacyActions.children) : [];
  const cancelSettingsButton = actionButtons[0] || null;
  const saveSettingsButton = actionButtons[1] || null;
  cancelSettingsButton?.removeAttribute('data-action');
  saveSettingsButton?.removeAttribute('data-action');
  if (cancelSettingsButton) cancelSettingsButton.dataset.e2eId = 'settings-dialog-cancel';
  if (saveSettingsButton) saveSettingsButton.dataset.e2eId = 'settings-dialog-save';
  [cancelSettingsButton, saveSettingsButton].filter(Boolean).forEach(button => {
    button.style.minWidth = '72px';
    button.style.whiteSpace = 'nowrap';
    button.style.minHeight = '44px';
  });
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let settingsSaveBusy = false;
  let suppressSettingsReturnFocus = false;
  const suppressedReturnFocusTarget = document.createElement('span');
  const dialog = window.GBUI.createModal({
    id: 'settings-dialog',
    title: '設定',
    titleId: 'settings-header-text',
    body: bodyContent,
    footer: actionButtons,
    variant: 'standard',
    extraClass: 'settings-modal',
    geometryKey: 'settings',
    minWidth: '0',
    initialFocus: () => _isMobile
      ? dialog.modal.querySelector('.settings-nav-item:not([disabled])')
      : dialog.modal.querySelector('.settings-tab.gb-inner-tab-active:not([disabled]), .settings-tab:not([disabled])'),
    returnFocus: () => suppressSettingsReturnFocus ? suppressedReturnFocusTarget : opener,
    onBeforeClose: reason => {
      if (settingsSaveBusy && reason !== 'complete') return false;
      if (reason !== 'complete' && typeof restoreThemeSnapshot === 'function') {
        restoreThemeSnapshot(window._settingsThemeSnapshot);
      }
      if (reason.startsWith('settings-transition')) suppressSettingsReturnFocus = true;
      return true;
    },
    onClose: () => {
      if (_settingsModalController === dialog) _settingsModalController = null;
    },
  });
  _settingsModalController = dialog;
  o = dialog.overlay;
  o.classList.add('modal-overlay');
  o.dataset.settingsModal = '1';
  o.dataset.e2eId = 'settings-dialog-overlay';
  o.__settingsDirtyControlIds = new Set();
  const markSettingsControlDirty = event => {
    const id = String(event?.target?.id || '');
    if (id) o.__settingsDirtyControlIds.add(id);
    event?.target?.removeAttribute?.('aria-invalid');
  };
  o.addEventListener('input', markSettingsControlDirty);
  o.addEventListener('change', markSettingsControlDirty);
  o.__meldexSettingsModalController = dialog;
  o.__meldexRequestSettingsClose = reason => {
    const closeReason = String(reason || 'settings-transition');
    if (dialog.isOpen()) return dialog.close(closeReason);
    const rawRemove = o.__meldexSettingsRawRemove;
    if (typeof rawRemove === 'function' && o.isConnected) {
      rawRemove();
      return true;
    }
    return false;
  };
  dialog.modal.classList.add('modal');
  dialog.modal.dataset.settingsMobileLayout = _isMobile ? '1' : '0';
  dialog.modal.dataset.e2eId = 'settings-dialog';
  dialog.modal.style.cssText = legacyModal?.style?.cssText || _settingsModalStyle;
  dialog.header.id = 'settings-header';
  dialog.header.style.cssText = 'flex-shrink:0;display:flex;align-items:center;gap:8px;';
  const titleNode = dialog.header.querySelector('.gb-modal-title');
  if (titleNode) {
    titleNode.innerHTML = '<span class="ico ico-settings"></span><span>設定</span>';
    titleNode.style.cssText = 'display:inline-flex;align-items:center;gap:8px;min-width:0;';
  }
  const commonClose = dialog.header.querySelector('.gb-modal-close');
  if (commonClose) {
    commonClose.id = 'settings-modal-close';
    commonClose.classList.add('settings-modal-close');
    commonClose.dataset.e2eId = 'settings-dialog-close';
    commonClose.title = '設定を閉じる';
    commonClose.setAttribute('aria-label', '設定を閉じる');
  }
  cancelSettingsButton?.addEventListener('click', () => dialog.close('cancel'));
  saveSettingsButton?.addEventListener('click', async () => {
    if (settingsSaveBusy || typeof submitSettings !== 'function') return;
    settingsSaveBusy = true;
    o.setAttribute('aria-busy', 'true');
    saveSettingsButton.disabled = true;
    if (cancelSettingsButton) cancelSettingsButton.disabled = true;
    if (commonClose) commonClose.disabled = true;
    let result = { ok: false };
    try {
      result = await submitSettings() || { ok: false };
    } finally {
      settingsSaveBusy = false;
      o.setAttribute('aria-busy', 'false');
    }
    if (result.ok === true) {
      if (dialog.isOpen()) closeSettingsModalWithReason('complete', o);
      return;
    }
    saveSettingsButton.disabled = false;
    if (cancelSettingsButton) cancelSettingsButton.disabled = false;
    if (commonClose) commonClose.disabled = false;
  });
  if (_isMobile) {
    const back = document.createElement('button');
    back.id = 'settings-back-btn';
    back.className = 'settings-back-btn';
    back.type = 'button';
    back.hidden = true;
    back.title = '設定一覧へ戻る';
    back.setAttribute('aria-label', '設定一覧へ戻る');
    back.style.cssText = 'cursor:pointer;font-size:18px;width:44px;height:44px;border:1px solid var(--border);border-radius:8px;background:var(--bg3);color:var(--fg);';
    back.textContent = '←';
    dialog.header.insertBefore(back, titleNode);
  }
  dialog.footer.classList.add('btn-row');
  dialog.footer.dataset.settingsDialogFooter = '1';
  dialog.footer.style.cssText = legacyActions?.style?.cssText || 'margin-top:12px;flex-shrink:0;';
  dialog.open();
  o.__meldexSettingsRawRemove = o.remove.bind(o);
  replaceIcons(o);
  if (typeof _tagSettingsNavigationSections === 'function') _tagSettingsNavigationSections(o);
  const settingsStateController = window.MeldexSettingsDialogController?.create?.({
    modal: dialog.modal,
    footer: dialog.footer,
    mobile: _isMobile,
    resolveTarget: (name, options) => resolveSettingsNavigationTarget(name, options),
    displayName: target => _settingsNavigationDisplayName(target.tabId, { pageId: target.pageId }),
    showTarget: target => _showSettingsNavigationTarget(dialog.modal, target),
    syncOverlay: tabId => _syncSettingsModalOverlayForPanel(dialog.modal, tabId),
    replaceIcons: root => replaceIcons(root),
  });
  const settingsCloseBtn = o.querySelector('#settings-modal-close');
  o.querySelector('#settings-back-btn')?.addEventListener('click', () => _backToSettingsList(o));
  o.querySelector('#staff-registry-open-btn')?.addEventListener('click', () => {
    window.MeldexUserRegistry?.openSheet?.();
  });
  function _openStaffRegistryRelocateDialog(initialPath, onSave) {
    return new Promise((resolve) => {
      const originalPath = String(initialPath || '').trim();
      const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const description = document.createElement('div');
      description.className = 'gb-section-desc';
      description.textContent = 'ユーザー管理シートの正本を置くフォルダを指定します。元の場所のデータは自動では移動・削除しません。';
      const label = document.createElement('label');
      label.htmlFor = 'staff-registry-relocate-input';
      label.textContent = 'フォルダパス';
      const row = document.createElement('div');
      row.className = 'db-picker-input-row';
      const input = document.createElement('input');
      input.id = 'staff-registry-relocate-input';
      input.className = 'gb-input';
      input.dataset.gbPathInput = '';
      input.dataset.e2eId = 'staff-registry-relocate-input';
      input.type = 'text';
      input.value = originalPath;
      input.style.minHeight = '44px';
      const pickButton = document.createElement('button');
      pickButton.id = 'staff-registry-relocate-pick-btn';
      pickButton.className = 'db-picker-btn';
      pickButton.dataset.e2eId = 'staff-registry-relocate-pick';
      pickButton.type = 'button';
      pickButton.title = '一覧から選択';
      pickButton.setAttribute('aria-label', '一覧から選択');
      pickButton.innerHTML = lucide('folderTree', 14);
      pickButton.hidden = typeof window.GBFolderPicker?.pickFolder !== 'function';
      row.append(input, pickButton);
      const status = document.createElement('div');
      status.className = 'gb-inline-dialog-status';
      status.dataset.e2eId = 'staff-registry-relocate-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.hidden = true;
      const cancel = document.createElement('button');
      cancel.id = 'staff-registry-relocate-cancel-btn';
      cancel.className = 'gb-btn gb-btn-sm';
      cancel.dataset.e2eId = 'staff-registry-relocate-cancel';
      cancel.type = 'button';
      cancel.textContent = 'キャンセル';
      const save = document.createElement('button');
      save.id = 'staff-registry-relocate-save-btn';
      save.className = 'gb-btn gb-btn-sm gb-btn-primary primary';
      save.dataset.e2eId = 'staff-registry-relocate-save';
      save.type = 'button';
      save.textContent = '保存場所を変更';
      let busy = false;
      let saved = false;
      const dialog = window.GBUI.createModal({
        id: 'staff-registry-relocate-dialog',
        titleId: 'staff-registry-relocate-title',
        title: 'ユーザー管理シートの保存場所',
        body: [description, label, row, status],
        footer: [cancel, save],
        variant: 'standard',
        extraClass: 'staff-registry-relocate-modal',
        geometryKey: 'staff-registry-relocate-dialog',
        minWidth: '0',
        initialFocus: input,
        returnFocus: opener,
        onBeforeClose: reason => !busy || reason === 'complete',
        onClose: () => resolve(saved),
      });
      dialog.overlay.dataset.staffRegistryRelocate = '1';
      dialog.overlay.dataset.e2eId = 'staff-registry-relocate-overlay';
      dialog.modal.dataset.e2eId = 'staff-registry-relocate-dialog';
      dialog.modal.style.width = 'min(520px, calc(100vw - 24px))';
      dialog.modal.style.minHeight = '330px';
      const closeButton = dialog.header.querySelector('.gb-modal-close');
      if (closeButton) closeButton.dataset.e2eId = 'staff-registry-relocate-close';
      const showMessage = (message, error = false) => {
        status.textContent = String(message || '');
        status.hidden = !status.textContent;
        status.dataset.statusKind = error ? 'error' : 'info';
      };
      const setBusy = next => {
        busy = !!next;
        dialog.overlay.setAttribute('aria-busy', busy ? 'true' : 'false');
        input.disabled = busy;
        pickButton.disabled = busy;
        cancel.disabled = busy;
        save.disabled = busy;
        if (closeButton) closeButton.disabled = busy;
      };
      const submit = async () => {
        const nextPath = input.value.trim();
        if (!nextPath) {
          showMessage('フォルダパスを入力してください', true);
          input.focus();
          return;
        }
        if (nextPath === originalPath) {
          saved = true;
          dialog.close('complete');
          return;
        }
        setBusy(true);
        showMessage('保存場所を変更しています…');
        try {
          await onSave(nextPath);
          saved = true;
          dialog.close('complete');
        } catch (error) {
          showMessage(error?.message || '保存場所の変更に失敗しました', true);
        } finally {
          if (dialog.modal.isConnected) setBusy(false);
        }
      };
      cancel.addEventListener('click', () => dialog.close('cancel'));
      save.addEventListener('click', submit);
      pickButton.addEventListener('click', async () => {
        setBusy(true);
        try {
          const selection = await window.GBFolderPicker.pickFolder({
            title: '保存場所のフォルダを選択',
            initialPath: input.value,
          });
          if (selection?.path) {
            input.value = selection.path;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        } catch (error) {
          showMessage(error?.message || 'フォルダ一覧を開けませんでした', true);
        } finally {
          if (dialog.modal.isConnected) setBusy(false);
        }
        input.focus({ preventScroll: true });
      });
      input.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        submit();
      });
      dialog.open();
      input.select();
    });
  }

  o.querySelector('#staff-registry-relocate-btn')?.addEventListener('click', async () => {
    if (!window.MeldexUserRegistry) return;
    const current = await window.MeldexUserRegistry.getConfig().catch(() => ({ path: '' }));
    await _openStaffRegistryRelocateDialog(current.path || '', async next => {
      await window.MeldexUserRegistry.relocate(next);
      showStatus('ユーザー管理シートの保存場所を変更しました');
      if (typeof _renderStaffRegistrySettings === 'function') _renderStaffRegistrySettings();
    });
  });
  o.querySelector('#settings-virtual-user-add')?.addEventListener('click', async () => {
    const input = o.querySelector('#settings-virtual-user-name');
    const name = String(input?.value || '').trim();
    if (!name) {
      input?.setAttribute('aria-invalid', 'true');
      input?.focus();
      showStatus('仮ユーザーの表示名を入力してください', true);
      return;
    }
    const button = o.querySelector('#settings-virtual-user-add');
    if (button) button.disabled = true;
    try {
      await window.MeldexUserRegistry?.addVirtualUser?.(name);
      if (input) input.value = '';
      await _renderStaffRegistrySettings();
      showStatus(`仮ユーザー「${name}」を追加しました`);
    } catch (error) {
      showStatus(error?.message || '仮ユーザーを追加できませんでした', true);
    } finally {
      if (button) button.disabled = false;
    }
  });
  o.querySelectorAll('.settings-nav-item[data-target]').forEach((item) => {
    item.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      settingsStateController?.open(item.dataset.target);
    });
  });
  if (typeof bindSettingsThemePanel === 'function') bindSettingsThemePanel(o);
  window.MeldexMobileWebClipSettings?.bind?.(o);
  // モバイル時: 全パネルを非表示にして、セクションリストのみ表示
  if (_isMobile) {
    o.querySelectorAll('.settings-panel').forEach(p => { p.hidden = true; });
    settingsStateController?.showCategories();
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
      _openSettingsSection(opts.panel || requestedPanel, o, { pageId: opts.pageId || '' });
    } else {
      const tab = o.querySelector(`.settings-tab[data-tab="${requestedPanel}"]`);
      if (tab && typeof switchSettingsTab === 'function') switchSettingsTab(tab);
      else if (tab) tab.click();
    }
  } else if (!_isMobile) {
    _openSettingsSection(defaultSettingsTab, o, { forcePage: true });
  }
  if (typeof _syncSettingsModalOverlayForPanel === 'function') _syncSettingsModalOverlayForPanel(o, requestedPanel || defaultSettingsTab);
}

async function loadStorageInfoForSettings() {
  const modeEl = document.getElementById('settings-storage-mode');
  const detailEl = document.getElementById('settings-storage-detail');
  if (!modeEl || !detailEl) return;
  const storageLabel = _settingsStorageLabel();
  try {
    const info = await window.MeldexStorageAdapter?.describeWorkspace?.();
    const workspaceState = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || null;
    const displayPath = _settingsStorageConnectionPath(info, workspaceState);
    modeEl.textContent = '現在: ' + storageLabel;
    detailEl.textContent = '接続先: ' + (displayPath || '未接続');
  } catch {
    modeEl.textContent = '現在: ' + storageLabel;
    detailEl.textContent = '接続先: 未接続';
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
  const openButton = document.getElementById('settings-transfer-open-location');
  if (_settingsTransferIsBrowserDataMode()) {
    locationEl.textContent = '保存先: このブラウザの端末内ストレージ / ZIPには表示・操作設定だけを含め、APIキーや作品データは含めません';
    if (openButton) {
      openButton.innerHTML = `${lucide('info',14)} 保存先について`;
      openButton.setAttribute('aria-label', 'ブラウザでの設定保存先について表示');
    }
    return;
  }
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

function collectRestorePointPolicyFromSettings() {
  const previous = typeof getVersionConfig === 'function' ? getVersionConfig() : {};
  const cadenceKind = document.getElementById('modal-restore-point-cadence')?.value || 'hourly';
  const weekdays = [...document.querySelectorAll('[data-restore-point-weekday]:checked')]
    .map(input => Number(input.dataset.restorePointWeekday)).filter(value => Number.isInteger(value));
  return window.MeldexRestorePointPolicy?.normalize?.({
    ...previous,
    schemaVersion: 2,
    enabled: document.getElementById('modal-restore-point-enabled')?.checked !== false,
    cadence: {
      kind: cadenceKind,
      interval: Number(document.getElementById('modal-restore-point-interval')?.value || 1),
      at: document.getElementById('modal-restore-point-time')?.value || '00:00',
      weekdays,
      dayOfMonth: Number(document.getElementById('modal-restore-point-month-day')?.value || 1),
      useLastDayOfMonth: Boolean(document.getElementById('modal-restore-point-last-day')?.checked),
      anchorDate: previous?.cadence?.anchorDate || new Date().toISOString().slice(0, 10),
    },
    timezone: document.getElementById('modal-restore-point-timezone')?.value || previous?.timezone,
    retention: {
      schemaVersion: 1,
      mode: document.getElementById('modal-restore-point-retention-mode')?.value || 'forever',
      days: Number(document.getElementById('modal-restore-point-retention-days')?.value || 30),
    },
  }) || previous;
}

function updateRestorePointScheduleSettingsVisibility() {
  const enabled = document.getElementById('modal-restore-point-enabled')?.checked !== false;
  const kind = document.getElementById('modal-restore-point-cadence')?.value || 'hourly';
  const fields = document.getElementById('restore-point-schedule-fields');
  if (fields) fields.hidden = !enabled;
  const setHidden = (id, hidden) => { const el = document.getElementById(id); if (el) el.hidden = hidden; };
  setHidden('restore-point-time-row', kind === 'hourly');
  setHidden('restore-point-weekdays-row', !['weekdays', 'weekly'].includes(kind));
  setHidden('restore-point-month-day-row', kind !== 'monthly');
  setHidden('restore-point-last-day-row', kind !== 'monthly');
  const intervalRow = document.getElementById('restore-point-interval-row');
  if (intervalRow) intervalRow.hidden = kind === 'weekdays';
  const unit = document.getElementById('restore-point-interval-unit');
  if (unit) unit.textContent = ({ hourly: '時間ごと', daily: '日ごと', weekly: '週ごと', monthly: 'か月ごと' })[kind] || '';
  const retentionMode = document.getElementById('modal-restore-point-retention-mode')?.value || 'forever';
  setHidden('restore-point-retention-days-row', retentionMode !== 'days');
  const nextRun = document.getElementById('restore-point-next-run');
  if (nextRun) {
    try {
      const config = collectRestorePointPolicyFromSettings();
      const next = window.MeldexRestorePointPolicy?.nextOccurrence?.(config, new Date());
      nextRun.textContent = !enabled ? '周期作成は無効です' : (next ? `次回予定: ${next.toLocaleString()}` : '次回予定を計算できません');
    } catch (error) {
      nextRun.textContent = '設定値を確認してください';
    }
  }
}

function _settingsTransferIsBrowserDataMode() {
  return Boolean(window.MeldexRuntimeAdapter?.isBrowserDataMode?.());
}

function _settingsTransferTextBytes(value) {
  return new TextEncoder().encode(String(value || ''));
}

function _settingsTransferTimestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function _exportBrowserSettingsTransferBundle() {
  const engine = window.MeldexArchiveZipEngine;
  const saver = window.MeldexExportSave;
  if (!engine?.buildZip || !saver?.saveBlob) {
    throw new Error('設定ZIPの作成機能を読み込めませんでした');
  }
  const uiConfig = _collectSettingsTransferUiConfig();
  const uiBytes = _settingsTransferTextBytes(JSON.stringify(uiConfig, null, 2));
  const manifest = {
    type: 'meldex-settings-transfer',
    format_version: 1,
    created_at: new Date().toISOString(),
    source: 'meldex-cloud-browser',
    excludes: ['LLM API keys', 'service tokens', '作品・ワークスペースデータ'],
    files: [{ name: 'client-ui-config.json', size: uiBytes.byteLength }],
  };
  const zipBytes = await engine.buildZip([
    { name: 'client-ui-config.json', data: uiBytes },
    { name: 'manifest.json', data: _settingsTransferTextBytes(JSON.stringify(manifest, null, 2)) },
  ]);
  const filename = `meldex-settings-${_settingsTransferTimestampForFilename()}.zip`;
  const result = await saver.saveBlob(new Blob([zipBytes], { type: 'application/zip' }), { filename });
  return { cancelled: Boolean(result?.cancelled), path: result?.path || result?.filename || filename };
}

function _backupBrowserSettingsTransferUiConfig() {
  const current = _collectSettingsTransferUiConfig();
  let rows = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(MELDEX_BROWSER_SETTINGS_TRANSFER_BACKUPS_KEY) || '[]');
    if (Array.isArray(parsed)) rows = parsed;
  } catch {}
  const createdAt = new Date().toISOString();
  rows.push({ id: `settings-before-import-${createdAt}`, created_at: createdAt, ui_config: current });
  localStorage.setItem(MELDEX_BROWSER_SETTINGS_TRANSFER_BACKUPS_KEY, JSON.stringify(rows.slice(-20)));
  return createdAt;
}

async function _importBrowserSettingsTransferBundle(file) {
  if (file.size > MELDEX_BROWSER_SETTINGS_TRANSFER_MAX_FILE_BYTES) {
    throw new Error('設定ZIPが大きすぎます（64MBまで）');
  }
  const engine = window.MeldexArchiveZipEngine;
  if (!engine?.parseZip || !engine?.extractMember) {
    throw new Error('設定ZIPの読み込み機能を読み込めませんでした');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = await engine.parseZip(bytes);
  const manifestInfo = parsed.members.get('manifest.json');
  const uiInfo = parsed.members.get('client-ui-config.json');
  if (!manifestInfo || manifestInfo.isDir || !uiInfo || uiInfo.isDir) {
    throw new Error('Meldex設定引き継ぎZIPに必要なファイルがありません');
  }
  const manifest = JSON.parse(new TextDecoder().decode(await engine.extractMember(bytes, manifestInfo)));
  if (manifest?.type !== 'meldex-settings-transfer') {
    throw new Error('Meldex設定引き継ぎZIPではありません');
  }
  const uiConfig = JSON.parse(new TextDecoder().decode(await engine.extractMember(bytes, uiInfo)));
  if (!uiConfig || typeof uiConfig !== 'object' || Array.isArray(uiConfig)) {
    throw new Error('表示・操作設定の形式が不正です');
  }
  const backupCreatedAt = _backupBrowserSettingsTransferUiConfig();
  return {
    ui_config: uiConfig,
    backup_path: `このブラウザの端末内バックアップ（${new Date(backupCreatedAt).toLocaleString()}）`,
  };
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
  const order = ['viewer'];
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
  window.MeldexPublicManual?.open?.(MELDEX_DEFAULT_APPS_GUIDE_PATH);
}

async function openSettingsTransferLocation() {
  if (_settingsTransferIsBrowserDataMode()) {
    _settingsTransferSetStatus('Cloud版の設定はこのブラウザの端末内ストレージに保存されます。場所をフォルダとして開くことはできません。', false);
    return;
  }
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
    const res = _settingsTransferIsBrowserDataMode()
      ? await _exportBrowserSettingsTransferBundle()
      : await apiPost('/settings-transfer/export', { ui_config: _collectSettingsTransferUiConfig() });
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
    const res = _settingsTransferIsBrowserDataMode()
      ? await _importBrowserSettingsTransferBundle(file)
      : await apiPost('/settings-transfer/import', {
          name: file.name,
          content_base64: _arrayBufferToBase64(await file.arrayBuffer()),
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
  const cb = document.getElementById('modal-autostart');
  const section = document.getElementById('settings-autostart-section');
  const status = document.getElementById('modal-autostart-status');
  // OS自動起動はデスクトップ専用。Cloudで未対応APIを待つと、
  // 読込失敗時に項目が残り、設定保存全体を中断してしまう。
  if (window.MeldexRuntimeAdapter?.isBrowserDataMode?.()) {
    if (section) section.hidden = true;
    return;
  }
  try {
    const res = await apiFetch('/autostart');
    if (!res.supported) {
      if (section) section.hidden = true;
      return;
    }
    if (cb) cb.checked = !!res.enabled || (!!res.setupRequired && !!res.recommendedEnabled);
    if (status) {
      if (res.setupRequired) status.textContent = '初回設定です。オンのまま保存すると、次回のOS起動時から常駐を開始します。';
      else if (res.enabled && res.verified === false) status.textContent = '登録を確認できません。オンのまま保存して修復してください。';
      else if (res.enabled) status.textContent = '有効です。次回のOS起動時に常駐を開始します。';
      else status.textContent = '無効です。必要な場合はオンにして保存してください。';
    }
  } catch {
    if (status) status.textContent = '状態を確認できませんでした。接続を確認してもう一度お試しください。';
  }
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
  window.MeldexPublicManual?.open?.(MELDEX_WEBCLIP_GUIDE_PATH);
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
