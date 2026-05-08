/* gb-settings.js: flattened split script for static cloud hosting. */
/* Source chunk: gb-settings.part01.js */
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

function getMeldexSampleDownloadUrl() {
  const cfg = window.MeldexCloudRuntimeConfig || {};
  return String(cfg.samples?.downloadUrl || cfg.sampleDownloadUrl || '').trim();
}

function openMeldexSampleDownload() {
  const url = getMeldexSampleDownloadUrl() || 'https://github.com/cam-nagara/MeldexCloud/releases';
  window.open(url, '_blank', 'noopener');
}

function openMeldexSampleGuide() {
  document.querySelector('.modal-overlay[data-settings-modal="1"]')?.remove();
  if (!window.MeldexRuntimeAdapter?.isDropboxMode?.() && typeof openPage === 'function') {
    openPage('サンプルデータを取り込む', 'MeldexHome/マニュアル/01_はじめに/サンプルデータを取り込む.md', { fromExplorer: true, skipAutoAppLayout: true });
    return;
  }
  window.open('public-index.html#samples', '_blank', 'noopener');
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
  // opts: { panel: 'ユーザー', teamFolder: 'D:/...' } で特定パネル・フォルダを開ける
  opts = opts || {};
  // 「公開」は各アプリ(ノート/シナリオ/シート/ボード/スマートシート)のメニューボタンから
  // ファイル単位で設定するよう移行 (showPublishSettingsModal)。設定ダイアログには置かない。
  const settingsTabs = ['全般','テーマ','LLM','LLMコスト','Discord Bot','ユーザー','拡張機能','ショートカット','ゴミ箱','データベース','フィードバック'];
  const settingsTabLabels = {
    'LLM': 'チャットAI',
    'LLMコスト': 'AI使用量',
    'Discord Bot': 'Discord連携',
  };
  const settingsTabIcons = {
    '全般': 'settings',
    'テーマ': 'palette',
    'LLM': 'bot',
    'LLMコスト': 'coins',
    'Discord Bot': 'messageCircle',
    'ユーザー': 'user',
    '拡張機能': 'blocks',
    'ショートカット': 'keyboard',
    'ゴミ箱': 'trash2',
    'データベース': 'database',
    'フィードバック': 'messageSquareText',
  };
  const settingsTabLabel = (name) => settingsTabLabels[name] || name;
  const settingsTabIcon = (name) => settingsTabIcons[name] || 'circle';
  const requestedPanel = _settingsCanonicalPanelName(opts.panel || '');
  _settingsThemeSetDirty(false);
  window._settingsOutlinerRootsDirty = false;
  // テーマ変更のキャンセル用にスナップショットを保存
  const _themeSnapshot = snapshotThemeVars();
  const _currentTheme = detectCurrentTheme();
  const _storageMode = window.MeldexRuntimeAdapter?.getMode?.() === 'dropbox' ? 'Dropbox 共有モード' : 'PC 単独モード';
  const _workspaceState = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || null;
  const _storageDetail = _workspaceState?.path
    ? `${_workspaceState.path}${_workspaceState.access ? ' / ' + _workspaceState.access : ''}`
    : '未接続';

  const o = document.createElement('div');
  o.className = 'modal-overlay';
  o.dataset.settingsModal = '1';
  const _isMobile = window.innerWidth <= 768;
  const _settingsModalStyle = _isMobile
    ? 'width:min(560px, calc(100vw - 16px));height:min(600px, calc(100vh - 16px));'
    : 'width:min(980px, calc(100vw - 48px));height:min(720px, calc(100vh - 64px));';
  o.innerHTML = `<div class="modal settings-modal" style="${_settingsModalStyle}">
    <h3 id="settings-header" style="flex-shrink:0;display:flex;align-items:center;gap:8px;">
      ${_isMobile ? '<span id="settings-back-btn" class="settings-back-btn" style="display:none;cursor:pointer;font-size:18px;" data-action="_backToSettingsList()">←</span>' : ''}
      <span id="settings-header-text" style="display:inline-flex;align-items:center;gap:8px;min-width:0;"><span class="ico ico-settings"></span><span>設定</span></span>
      <button id="settings-modal-close" class="settings-modal-close" type="button" title="設定を閉じる" aria-label="設定を閉じる" style="margin-left:auto;width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border);border-radius:6px;background:var(--bg3);color:var(--fg);">
        ${lucide('x',16)}
      </button>
    </h3>
    <style>
      .settings-modal .settings-sidebar-tab{border:1px solid transparent;background:transparent;color:var(--fg2);font-size:13px;}
      .settings-modal .settings-sidebar-tab:hover{background:var(--bg3);color:var(--fg);}
      .settings-modal .settings-sidebar-tab.active,.settings-modal .settings-sidebar-tab.gb-inner-tab-active{background:var(--accent);border-color:var(--accent);color:var(--ui-fg-strong);font-weight:600;}
      .settings-modal .settings-sidebar-tab svg{flex:0 0 auto;}
    </style>
    <!-- モバイル: セクションリスト -->
    ${_isMobile ? `<div id="settings-nav-list" style="overflow-y:auto;flex:1;">
      ${settingsTabs.map(t =>
        `<div class="settings-nav-item" data-target="${t}" data-action="_openSettingsSection('${t}')">${settingsTabLabel(t)}</div>`
      ).join('')}
    </div>` : ''}
    ${!_isMobile ? `<div class="settings-desktop-layout" style="display:flex;min-height:0;flex:1;overflow:hidden;border-top:1px solid var(--border);">
      <nav id="settings-tab-header" class="settings-sidebar" aria-label="設定カテゴリ" style="width:176px;flex:0 0 176px;padding:12px 10px 12px 0;margin-right:14px;border-right:1px solid var(--border);overflow-y:auto;">
      ${settingsTabs.map((t,i) =>
        `<button type="button" class="settings-tab settings-sidebar-tab gb-inner-tab${i===0?' gb-inner-tab-active active':''}" data-tab="${t}" data-action="switchSettingsTab(this)" title="${settingsTabLabel(t)}" style="width:100%;display:flex;align-items:center;gap:8px;margin:0 0 4px;padding:8px 10px;border-radius:6px;text-align:left;white-space:nowrap;cursor:pointer;">${lucide(settingsTabIcon(t),14)}<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;">${settingsTabLabel(t)}</span></button>`
      ).join('')}
      </nav>
      <div class="settings-desktop-panel" style="min-width:0;flex:1;display:flex;flex-direction:column;">` : ''}
    <!-- タブ内容 -->
    <div style="overflow-y:auto;flex:1;">
    <!-- 全般 -->
    <div class="settings-panel" data-panel="全般">
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('home',14)} ホームフォルダ</div>
        <div class="gb-section-desc">Meldexのデフォルトフォルダです。新規追加時のフォールバック先になります。</div>
        <div class="gb-field-row" style="flex-wrap:nowrap;">
          <input id="modal-home-folder" type="text" class="gb-input" style="flex:1;" value="${esc(_homeFolderPath)}" readonly>
          <button class="gb-btn gb-btn-sm" data-action="_changeHomeFolder()">変更</button>
        </div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('folder',14)} ソースフォルダ</div>
        <div class="gb-section-desc">フォルダツリーに表示するフォルダを管理します。</div>
        <div id="modal-outliner-roots"><div class="gb-section-desc">読み込み中...</div></div>
        <div>
          <button class="gb-btn gb-btn-sm" data-action="addOutlinerRootFromSettings()">+ フォルダを追加</button>
        </div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('archive',14)} サンプルデータ</div>
        <div class="gb-section-desc">サンプル作品は本体とは別配布です。ZIPを展開し、できた「サンプル」フォルダをソースフォルダ内へ置くか、ソースフォルダとして追加してください。</div>
        <div class="gb-field-row" style="justify-content:flex-start;flex-wrap:wrap;">
          <button type="button" class="gb-btn gb-btn-sm" data-action="openMeldexSampleDownload()">${lucide('download',14)} サンプルをダウンロード</button>
          <button type="button" class="gb-btn gb-btn-sm" data-action="openMeldexSampleGuide()">${lucide('bookOpen',14)} 取り込み手順</button>
          <button type="button" class="gb-btn gb-btn-sm" data-action="addOutlinerRootFromSettings()">${lucide('folderPlus',14)} ソースフォルダに追加</button>
        </div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">保存モード</div>
        <div class="gb-section-desc">MeldexをこのPCだけで使うか、Dropbox共有モードで使うかを設定します。</div>
        <div id="settings-storage-mode" class="gb-section-desc">現在: ${esc(_storageMode)}</div>
        <div id="settings-storage-detail" class="gb-section-desc">接続先: ${esc(_storageDetail)}</div>
        <div class="gb-field-row" style="justify-content:flex-start;">
          <button class="gb-btn gb-btn-sm" data-action="document.querySelector('.modal-overlay[data-settings-modal=&quot;1&quot;]')?.remove(); window.MeldexCloudBootstrap?.openSettingsFlow?.()">Dropbox / 保存モード設定...</button>
        </div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('smartphone',14)} スマホ・タブレットからの接続</div>
        <div class="gb-section-desc">このPCで開くURLと、同じネットワーク内で使える候補URLを表示します。標準のPC単独版は安全のためこのPC内だけに公開されるため、スマホから接続できない場合はCloud版PWAまたは管理者が用意した共有URLを使ってください。</div>
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
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('archive',14)} 設定の引き継ぎ</div>
        <div class="gb-section-desc">このPCのMeldex設定保存先を確認し、別PCへ移す設定ZIPを作成・取り込みできます。LLM APIキーは含まれません。</div>
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
            <input type="checkbox" id="modal-a11y-high-contrast" ${localStorage.getItem('meldex-a11y-high-contrast') === '1' ? 'checked' : ''}>
            <span>ハイコントラスト表示</span>
          </label>
          <label class="gb-check">
            <input type="checkbox" id="modal-a11y-reduced-motion" ${localStorage.getItem('meldex-a11y-reduced-motion') === '1' ? 'checked' : ''}>
            <span>アニメーションを減らす</span>
          </label>
          <label class="gb-check">
            <input type="checkbox" id="modal-a11y-colorblind-safe" ${localStorage.getItem('meldex-a11y-colorblind-safe') === '1' ? 'checked' : ''}>
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
        <div class="gb-section-title">ヒストリー（Undo/Redo）</div>
        <label class="gb-field-row">
          <span class="gb-label">最大アンドゥ回数</span>
          <input id="modal-history-max" type="number" class="gb-input" style="width:80px;" value="${getHistoryMax()}" min="1" max="200">
        </label>
        <div class="gb-section-desc">Ctrl+Z で戻る、Ctrl+Y でやり直し（テキスト編集外で有効）</div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">自動バージョン保存</div>
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
        <div class="gb-section-desc">編集があった場合のみ保存。古いものから自動削除されます</div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">レイアウト</div>
        <div class="gb-section-desc">現在のパネル配置を単一レイアウトとして保存します。ファイル形式による自動切り替えは行いません。</div>
        <div class="gb-field-row">
          <button class="gb-btn gb-btn-sm gb-btn-danger" data-action="cfConfirm('レイアウトを初期化しますか？').then(ok=>{if(ok)resetLayoutToDefault();})">レイアウトを初期化</button>
        </div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('table',14)} 履歴データのエクスポート</div>
        <div class="gb-section-desc">チャット履歴・注釈・カレンダーイベント・タスクをホームフォルダにシート形式でエクスポートします（読み取り専用コピー）。</div>
        <div class="gb-field-row">
          <button id="btn-export-to-db" class="gb-btn gb-btn-sm" data-action="runExportToDb()">エクスポート実行</button>
          <span id="export-to-db-status" class="gb-section-desc"></span>
        </div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">全設定リセット</div>
        <div class="gb-section-desc">レイアウト・テーマ・フィルタ・表示設定など、localStorageに保存された全ての設定を初期化します。ログイン情報もリセットされます。</div>
        <button class="gb-btn gb-btn-sm gb-btn-danger" data-action="cfConfirm('すべての設定を初期化しますか？\\nテーマ・レイアウト・フィルタ等すべてがリセットされます。\\nページをリロードします。').then(ok=>{if(ok)resetAllSettings();})">全設定を初期化</button>
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
        <div class="gb-section-title">${lucide('messagesSquare',14)} LLMチャット APIキー</div>
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
          <span class="gb-label" style="min-width:140px;">GPT (OpenAI)</span>
          <input id="modal-openai-key" type="password" class="gb-input" style="flex:1;" placeholder="sk-...">
          <button type="button" class="gb-btn gb-btn-icon settings-llm-key-visibility-btn" title="表示切替" aria-label="OpenAI APIキーを表示/非表示" data-action="_toggleLlmKeyVisibility('modal-openai-key', this)">${lucide('eye',16)}</button>
        </label>
        <div class="gb-section-desc">キーを入れていない会社のAIは使えません。通常はこの端末だけに保存します。Cloudで別端末へ持ち回る場合は、下のCloud保存を明示的に使ってください。</div>
        <div class="gb-field-row" style="align-items:center;gap:8px;flex-wrap:wrap;">
          <span class="gb-label" style="min-width:140px;">Cloud保存</span>
          <input id="modal-llm-cloud-passphrase" type="password" class="gb-input" style="flex:1;min-width:220px;" placeholder="暗号化パスフレーズ">
          <button type="button" class="gb-btn gb-btn-sm" data-action="MeldexLlmKeys.saveCloudFromSettings()">${lucide('cloudUpload',14)} 暗号化して保存</button>
          <button type="button" class="gb-btn gb-btn-sm" data-action="MeldexLlmKeys.loadCloudFromSettings()">${lucide('cloudDownload',14)} 復号して読み込み</button>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-danger" data-action="MeldexLlmKeys.deleteCloudFromSettings()">${lucide('trash2',14)} Cloud保存を削除</button>
        </div>
        <div class="gb-section-desc">Cloud保存はAES-GCMで暗号化し、パスフレーズ自体は保存しません。作成・更新・削除は管理者のみ可能です。共有相手へAPIキーを渡す用途ではなく、自分の別端末で復号するためのBETA機能です。</div>
        <div class="gb-section-desc" style="margin-top:10px;">
          AIへの送信について: 返答を作るため、チャット本文や必要なMeldex内の情報を、選んだAI会社のサーバーへ送ることがあります。OpenAI/Claudeは、あなたが同意しない限りAIの学習に使いません。Geminiの無料枠では、Googleの改善や人による確認に使われる場合があります。
        </div>
        <div class="btn-row" style="justify-content:flex-start;gap:8px;margin-top:10px;flex-wrap:wrap;">
          <button type="button" class="gb-btn gb-btn-sm" role="link" data-e2e-id="settings-llm-openai-api-key-link" data-action="openExternalBrowserUrl" data-args='["${MELDEX_LLM_API_KEY_URLS.openai}"]'>${lucide('externalLink',14)} OpenAI APIキーを取得</button>
          <button type="button" class="gb-btn gb-btn-sm" role="link" data-e2e-id="settings-llm-anthropic-api-key-link" data-action="openExternalBrowserUrl" data-args='["${MELDEX_LLM_API_KEY_URLS.anthropic}"]'>${lucide('externalLink',14)} Claude APIキーを取得</button>
          <button type="button" class="gb-btn gb-btn-sm" role="link" data-e2e-id="settings-llm-gemini-api-key-link" data-action="openExternalBrowserUrl" data-args='["${MELDEX_LLM_API_KEY_URLS.gemini}"]'>${lucide('externalLink',14)} Gemini APIキーを取得</button>
        </div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('terminal',14)} CLIチャット</div>
        <div class="gb-section-desc">PCに入っている Codex CLI / Claude Code / Gemini CLI を、Meldexのチャットから呼び出します。ターミナルで使えるのに未検出の場合は、Meldexを再起動してください。</div>
        <div id="settings-cli-chat-container">
          <div class="gb-section-desc">表示時に読み込みます…</div>
        </div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('badgeInfo',14)} カスタムインストラクション</div>
        <div class="gb-section-desc">シートのフォームで、ユーザー情報・作品前提・回答方針を項目別に入力します。送信した内容はチャットのカスタムインストラクションに反映されます。</div>
        <button type="button" class="gb-btn gb-btn-sm" data-action="ensureChatCustomInstructionSheet()">${lucide('clipboardList',14)} 入力フォームを開く</button>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('brain',14)} 自動ナレッジ</div>
        <div class="gb-field-row" style="justify-content:flex-start;">
          <button type="button" class="gb-btn gb-btn-sm" data-action="openKnowledgeHomeView('items')">${lucide('brain',14)} 記憶継承を開く</button>
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
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">チームメンバー</div>
        <div class="gb-section-desc">同じソースフォルダを開いているMeldexユーザーが自動的に表示されます</div>
        <div id="settings-user-list"><div class="gb-section-desc">このタブを開いた時に読み込みます</div></div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('lock',14)} 編集ロック中の項目</div>
        <div class="gb-section-desc">管理者はここから編集ロックを解除できます。</div>
        <div id="settings-file-lock-list"><div class="gb-section-desc">このタブを開いた時に読み込みます</div></div>
      </section>
    </div>
    <!-- 拡張機能 -->
    <div class="settings-panel" data-panel="拡張機能" hidden>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title"><span class="ico ico-sync"></span> Notion同期</div>
        <div id="notion-sync-settings-container">
          <div class="gb-section-desc">表示時に読み込みます…</div>
        </div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">Chrome拡張機能（Web Clipper）</div>
        <div class="gb-section-desc">Webページ・画像・テキストをブラウザから直接Meldexに保存できます。初期保存先はホームフォルダ内の <code>Web Clipper</code> フォルダです。</div>
        <div class="gb-section-desc">meldex-extension フォルダをChrome拡張機能として読み込んでください</div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">拡張機能</div>
        <div class="gb-section-desc">追加機能に必要なパッケージをインストールします。すべての処理はPC上で完結し、画像がAIに学習されることはありません。</div>
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
      <button data-action="restoreThemeSnapshot(window._settingsThemeSnapshot);this.closest('.modal-overlay')?.remove()">キャンセル</button>
      <button class="primary" data-action="submitSettings()">保存</button>
    </div>
  </div>`;
  // キャンセル用スナップショットをグローバルに保持
  window._settingsThemeSnapshot = _themeSnapshot;
  document.body.appendChild(o);
  replaceIcons(o);
  const settingsCloseBtn = o.querySelector('#settings-modal-close');
  settingsCloseBtn?.addEventListener('click', () => {
    restoreThemeSnapshot(window._settingsThemeSnapshot);
    o.remove();
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
    if (_cachedAv) _avEl.innerHTML = `<img src="${_cachedAv}" style="width:100%;height:100%;object-fit:cover;">`;
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
          if (typeof refreshAvatarIconColor === 'function') refreshAvatarIconColor(nextColor);
        });
      }
    });
  }
  // チームフォーカスフォルダが指定されていればセット
  if (opts.teamFolder) _settingsTeamFocusFolder = opts.teamFolder;
  else _settingsTeamFocusFolder = '';
  // 指定パネルを開く
  if (requestedPanel) {
    if (_isMobile && typeof _openSettingsSection === 'function') {
      _openSettingsSection(requestedPanel);
    } else {
      const tab = o.querySelector(`.settings-tab[data-tab="${requestedPanel}"]`);
      if (tab) tab.click();
    }
  } else if (!_isMobile && typeof _scheduleSettingsPanelInitialization === 'function') {
    _scheduleSettingsPanelInitialization('全般', o);
  }
  if (typeof _syncSettingsModalOverlayForPanel === 'function') _syncSettingsModalOverlayForPanel(o, requestedPanel || '全般');
}

async function loadStorageInfoForSettings() {
  const modeEl = document.getElementById('settings-storage-mode');
  const detailEl = document.getElementById('settings-storage-detail');
  if (!modeEl || !detailEl) return;
  const storageMode = window.MeldexRuntimeAdapter?.getMode?.() === 'dropbox' ? 'Dropbox 共有モード' : 'PC 単独モード';
  try {
    const info = await window.MeldexStorageAdapter?.describeWorkspace?.();
    const displayPath = info?.path || info?.homePath || '';
    const permission = info?.permission ? ' / ' + info.permission : '';
    modeEl.textContent = '現在: ' + storageMode;
    detailEl.textContent = '接続先: ' + (displayPath ? (displayPath + permission) : '未接続');
  } catch {
    modeEl.textContent = '現在: ' + storageMode;
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

function _applyImportedSettingsTransferUiConfig(uiConfig) {
  if (!uiConfig || typeof uiConfig !== 'object') return 0;
  let count = 0;
  Object.entries(uiConfig).forEach(([key, value]) => {
    if (!key) return;
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
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

// --- フォルダツリールート管理 ---
let _outlinerRoots = [];

function _isDropboxBackedSourcePath(path) {
  const normalized = String(path || '').replace(/\\/g, '/').toLowerCase();
  return normalized.includes('/dropbox/')
    || normalized.includes(' dropbox/')
    || normalized.endsWith('/dropbox')
    || normalized.includes('dropbox');
}

function _createDropboxSourceFolderNotice() {
  const notice = document.createElement('div');
  notice.id = 'settings-dropbox-source-folder-notice';
  notice.className = 'gb-section-desc';
  notice.style.cssText = 'margin:0 0 8px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--fg2);line-height:1.5;';
  notice.textContent = 'Dropbox上のソースフォルダは、Dropboxアプリ側でオンラインアクセスと同期を許可し、必要なフォルダをローカルで利用可能にしてください。オンラインのみのままだと、フォルダやファイルの初回読み込みが重くなることがあります。';
  return notice;
}

async function loadOutlinerRootsForSettings() {
  try {
    _outlinerRoots = await apiFetch('/outliner-roots');
  } catch (e) { _outlinerRoots = []; }
  window._settingsOutlinerRootsDirty = false;
  renderOutlinerRootsSettings();
}

function _markOutlinerRootsSettingsDirty() {
  window._settingsOutlinerRootsDirty = true;
}

function renderOutlinerRootsSettings() {
  const container = document.getElementById('modal-outliner-roots');
  if (!container) return;
  container.innerHTML = '';
  if (_outlinerRoots.some(root => _isDropboxBackedSourcePath(root?.path))) {
    container.appendChild(_createDropboxSourceFolderNotice());
  }
  _outlinerRoots.forEach((root, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:4px;font-size:12px;';
    row.innerHTML = `
      <label style="display:flex;align-items:center;gap:3px;cursor:pointer;" title="フォルダツリーに表示">
        <input type="checkbox" class="or-visible" data-e2e-id="settings-outliner-root-${i}-visible" aria-label="${esc(root.name || 'ソースフォルダ')}をフォルダツリーに表示" ${root.visible ? 'checked' : ''}>
      </label>
      <input type="text" class="or-name" value="${esc(root.name)}"
        data-e2e-id="settings-outliner-root-${i}-name" aria-label="ソースフォルダ名"
        style="width:80px;font-size:12px;padding:2px 4px;background:var(--bg2);color:var(--fg);border:1px solid var(--border);border-radius:3px;">
      <span style="flex:1;color:var(--fg2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(root.path)}">${esc(root.path)}</span>
      <button type="button" class="or-delete" data-e2e-id="settings-outliner-root-${i}-delete" aria-label="${esc(root.name || 'ソースフォルダ')}を削除" title="削除" style="font-size:11px;padding:1px 6px;color:var(--fg2);">${lucide('x', 12)}</button>
    `;
    row.querySelector('.or-visible').addEventListener('change', (e) => {
      _outlinerRoots[i].visible = e.target.checked;
      _markOutlinerRootsSettingsDirty();
    });
    row.querySelector('.or-name').addEventListener('change', (e) => {
      _outlinerRoots[i].name = e.target.value;
      _markOutlinerRootsSettingsDirty();
    });
    row.querySelector('.or-delete').addEventListener('click', () => {
      _outlinerRoots.splice(i, 1);
      _markOutlinerRootsSettingsDirty();
      renderOutlinerRootsSettings();
    });
    container.appendChild(row);
  });
}

async function _changeHomeFolder() {
  // フォルダ選択ダイアログ（tkinter失敗時はパス手入力）
  let path = null;
  try {
    const res = await apiFetch('/add-outliner-root', { method: 'POST' });
    if (res.ok && res.path) path = res.path;
    else if (res.needManualInput) path = await _promptFolderPath();
  } catch { path = await _promptFolderPath(); }
  if (path) {
    await apiPut('/home-folder', { path });
    _homeFolderPath = path;
    try {
      const res = await apiFetch('/home-folder');
      if (typeof setSystemLockedItems === 'function') setSystemLockedItems(res.locked_paths || []);
      if (typeof _ensureLocksLoaded === 'function') await _ensureLocksLoaded({ force: true }).catch(() => {});
    } catch {}
    document.getElementById('modal-home-folder').value = path;
    renderHomeFolderTree();
    showStatus('ホームフォルダを変更しました');
  }
}

async function _promptFolderPath() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10001;';
    overlay.innerHTML = `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:20px;width:500px;max-width:90vw;">
      <div style="font-size:14px;font-weight:bold;color:var(--fg);margin-bottom:12px;">フォルダのパスを入力</div>
      <input id="prompt-folder-path" type="text" placeholder="D:\\..." style="width:100%;box-sizing:border-box;font-size:13px;padding:6px 10px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;margin-bottom:12px;">
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="prompt-folder-cancel" style="font-size:12px;padding:4px 12px;">キャンセル</button>
        <button id="prompt-folder-ok" class="primary" style="font-size:12px;padding:4px 12px;">OK</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#prompt-folder-path');
    input.focus();
    const close = v => { overlay.remove(); resolve(v); };
    overlay.querySelector('#prompt-folder-cancel').addEventListener('click', () => close(null));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    const submit = () => { const v = input.value.trim(); close(v || null); };
    overlay.querySelector('#prompt-folder-ok').addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') close(null); });
  });
}

async function addOutlinerRootFromSettings() {
  showStatus('フォルダ選択ダイアログを開いています...');
  try {
    const res = await apiFetch('/add-outliner-root', { method: 'POST' });
    if (res.ok && res.path) {
      _addOutlinerRootEntry(res.path, res.name);
    } else if (res.needManualInput) {
      await _addOutlinerRootManual();
    } else {
      showStatus('キャンセルされました');
    }
  } catch (e) {
    await _addOutlinerRootManual();
  }
}

async function _addOutlinerRootManual() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10001;';
  overlay.innerHTML = `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:20px;width:500px;max-width:90vw;">
    <div style="font-size:14px;font-weight:bold;color:var(--fg);margin-bottom:12px;">ソースフォルダのパスを入力</div>
    <div style="font-size:12px;color:var(--fg2);margin-bottom:8px;">追加したいフォルダの絶対パスを入力してください（例: D:\\Documents\\MyProject）</div>
    <input id="manual-root-path" type="text" placeholder="D:\\..." style="width:100%;box-sizing:border-box;font-size:13px;padding:6px 10px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;margin-bottom:12px;">
    <div id="manual-root-error" style="font-size:11px;color:var(--red);margin-bottom:8px;display:none;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button id="manual-root-cancel" style="font-size:12px;padding:4px 12px;">キャンセル</button>
      <button id="manual-root-ok" class="primary" style="font-size:12px;padding:4px 12px;">追加</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const input = overlay.querySelector('#manual-root-path');
  const errEl = overlay.querySelector('#manual-root-error');
  input.focus();
  return new Promise(resolve => {
    const close = () => { overlay.remove(); resolve(); };
    overlay.querySelector('#manual-root-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    const submit = async () => {
      const raw = input.value.trim();
      if (!raw) { errEl.textContent = 'パスを入力してください'; errEl.style.display = ''; return; }
      try {
        const res = await apiFetch('/add-outliner-root', { method: 'POST', body: JSON.stringify({ path: raw }) });
        if (res.ok && res.path) {
          _addOutlinerRootEntry(res.path, res.name);
          overlay.remove(); resolve();
        } else {
          errEl.textContent = res.error || 'フォルダが見つかりません'; errEl.style.display = '';
        }
      } catch (e) {
        errEl.textContent = e.message || 'エラーが発生しました'; errEl.style.display = '';
      }
    };
    overlay.querySelector('#manual-root-ok').addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') close(); });
  });
}

async function _addOutlinerRootEntry(path, name) {
  // 設定ダイアログの外から呼ばれた場合、サーバーから最新のルートを取得
  const inSettingsDialog = !!document.getElementById('modal-outliner-roots');
  const historyBefore = inSettingsDialog ? null : await captureOutlinerRootsSettingsSnapshot().catch(() => null);
  if (!inSettingsDialog) {
    try { _outlinerRoots = await apiFetch('/outliner-roots'); } catch { _outlinerRoots = []; }
  }
  if (_outlinerRoots.some(r => r.path === path)) {
    showStatus('既に登録されているフォルダです');
    return;
  }
  _outlinerRoots.push({ path, name, visible: true });
  if (inSettingsDialog) _markOutlinerRootsSettingsDirty();
  renderOutlinerRootsSettings();
  if (!inSettingsDialog) {
    if (!await saveOutlinerRoots()) {
      _outlinerRoots = _outlinerRoots.filter(r => r.path !== path);
      renderOutlinerRootsSettings();
      showStatus('フォルダ追加の保存に失敗しました', true);
      return;
    }
    // 最初の可視ルートをvault_pathに同期
    const firstVisible = _outlinerRoots.find(r => r.visible && r.path && r.path !== '.');
    if (firstVisible) {
      try { await apiPut('/vault', { path: firstVisible.path }); } catch {}
    }
    if (typeof loadOutliner === 'function') {
      try { await loadOutliner(); } catch {}
    }
    const historyAfter = await captureOutlinerRootsSettingsSnapshot().catch(() => null);
    pushOutlinerRootsSettingsHistory('設定: ソースフォルダ追加', historyBefore, historyAfter, name || path);
  }
  showStatus(_isDropboxBackedSourcePath(path)
    ? 'フォルダを追加しました。Dropbox上のソースフォルダはオンラインアクセスと同期を許可してください。'
    : 'フォルダを追加しました');
}

async function saveOutlinerRoots() {
  try {
    await apiPut('/outliner-roots', { roots: _outlinerRoots });
    return true;
  } catch (e) { return false; }
}

function _normalizeOutlinerRootSettings(root) {
  if (!root || !root.path) return null;
  return {
    path: String(root.path),
    name: String(root.name || root.path.split(/[\\/]/).pop() || root.path),
    visible: root.visible !== false,
  };
}

function _normalizeOutlinerRootsSettingsSnapshot(snapshot) {
  return {
    roots: (Array.isArray(snapshot?.roots) ? snapshot.roots : [])
      .map(_normalizeOutlinerRootSettings)
      .filter(Boolean),
    vaultPath: String(snapshot?.vaultPath || ''),
    vaultName: String(snapshot?.vaultName || ''),
  };
}

async function captureOutlinerRootsSettingsSnapshot() {
  const [roots, vault] = await Promise.all([
    apiFetch('/outliner-roots').catch(() => _outlinerRoots || []),
    apiFetch('/vault').catch(() => ({ path: (typeof state !== 'undefined' ? state.vaultPath : '') || '', name: '' })),
  ]);
  return _normalizeOutlinerRootsSettingsSnapshot({
    roots,
    vaultPath: vault?.path || '',
    vaultName: vault?.name || '',
  });
}

function _sameOutlinerRootsSettingsSnapshot(a, b) {
  try {
    return JSON.stringify(_normalizeOutlinerRootsSettingsSnapshot(a))
      === JSON.stringify(_normalizeOutlinerRootsSettingsSnapshot(b));
  } catch {
    return false;
  }
}

async function _restoreOutlinerRootsSettingsSnapshot(snapshot) {
  const normalized = _normalizeOutlinerRootsSettingsSnapshot(snapshot);
  await apiPut('/vault', { path: normalized.vaultPath || '' });
  await apiPut('/outliner-roots', { roots: normalized.roots });
  if (typeof state !== 'undefined') state.vaultPath = normalized.vaultPath || '';
  _outlinerRoots = normalized.roots.map(root => ({ ...root }));
  renderOutlinerRootsSettings();
  const workEl = document.getElementById('sb-work');
  if (workEl) {
    const label = normalized.vaultName || normalized.vaultPath.split(/[\\/]/).pop() || '';
    workEl.textContent = normalized.vaultPath ? ('ソースフォルダ: ' + label) : '';
  }
  if (typeof loadOutliner === 'function') {
    try { await loadOutliner(); } catch {}
  }
}

function pushOutlinerRootsSettingsHistory(label, beforeSnapshot, afterSnapshot, detail) {
  if (typeof historyPush !== 'function' || !beforeSnapshot || !afterSnapshot) return false;
  if (_sameOutlinerRootsSettingsSnapshot(beforeSnapshot, afterSnapshot)) return false;
  const before = _normalizeOutlinerRootsSettingsSnapshot(beforeSnapshot);
  const after = _normalizeOutlinerRootsSettingsSnapshot(afterSnapshot);
  historyPush(
    label || '設定: ソースフォルダ変更',
    () => _restoreOutlinerRootsSettingsSnapshot(before),
    () => _restoreOutlinerRootsSettingsSnapshot(after),
    'settings:source-folders',
    detail || ''
  );
  return true;
}

/* ==============================
   テーマプリセット
   ============================== */
const THEME_PRESETS = {
  'OSに合わせる': null, // 特殊テーマ: OS設定に応じてダーク/ライトを自動切替
  'ダーク': {
    '--bg':'#1e1e1e','--bg2':'#252525','--bg3':'#2d2d2d','--bg4':'#3e3e3e',
    '--fg':'#d4d4d4','--fg2':'#969696','--accent':'#569cd6','--accent2':'#4ec9b0',
    '--red':'#f44747','--green':'#6a9955','--orange':'#ce9178','--blue':'#6fa8dc',
    '--border':'#333333','--selection':'#264f78',
    '--db-th-fg':'#969696','--db-th-bg':'#2d2d2d','--db-entity-fg':'#d4d4d4','--db-entity-bg':'#1e1e1e',
    '--db-cell-fg':'#d4d4d4','--db-grid-border':'var(--border)','--db-active-color':'var(--editor-caret-color)',
    '--page-title-fg':'#d4d4d4','--page-h1-fg':'#569cd6','--page-h2-fg':'#569cd6','--page-h3-fg':'#d4d4d4',
    '--page-text-fg':'#d4d4d4','--page-text-bg':'#252525','--page-link-fg':'var(--accent2)',
    '--page-hr-color':'var(--border)','--page-quote-fg':'#969696','--page-quote-border':'var(--border)',
  },
  'ライト': {
    '--bg':'#ffffff','--bg2':'#f5f5f5','--bg3':'#ebebeb','--bg4':'#d4d4d4',
    '--fg':'#1e1e1e','--fg2':'#555555','--accent':'#0055aa','--accent2':'#007050',
    '--red':'#c62828','--green':'#2e7d32','--orange':'#d84315','--blue':'#1565c0',
    '--border':'#c0c0c0','--selection':'#bbdefb',
    '--db-th-fg':'#555555','--db-th-bg':'#ebebeb','--db-entity-fg':'#1e1e1e','--db-entity-bg':'#ffffff',
    '--db-cell-fg':'#1e1e1e','--db-grid-border':'var(--border)','--db-active-color':'var(--editor-caret-color)',
    '--page-title-fg':'#1e1e1e','--page-h1-fg':'#0055aa','--page-h2-fg':'#0055aa','--page-h3-fg':'#1e1e1e',
    '--page-text-fg':'#1e1e1e','--page-text-bg':'#f5f5f5','--page-link-fg':'var(--accent2)',
    '--page-hr-color':'var(--border)','--page-quote-fg':'#555555','--page-quote-border':'var(--border)',
  },
  'パステル': {
    '--bg':'#fdf9f6','--bg2':'#f5f0ff','--bg3':'#e8f4f0','--bg4':'#fce8ec',
    '--fg':'#4a4458','--fg2':'#7a7090','--accent':'#9b59b6','--accent2':'#1abc9c',
    '--red':'#e74c8b','--green':'#2ecc71','--orange':'#f39c12','--blue':'#3498db',
    '--border':'#e0c8f0','--selection':'#d5e8ff',
    '--db-th-fg':'#6a5090','--db-th-bg':'#e8f0d8','--db-entity-fg':'#5a4870','--db-entity-bg':'#fdf6f0',
    '--db-cell-fg':'#4a4458','--db-grid-border':'var(--border)','--db-active-color':'var(--editor-caret-color)',
    '--page-title-fg':'#5a4870','--page-h1-fg':'#e74c8b','--page-h2-fg':'#3498db','--page-h3-fg':'#2ecc71',
    '--page-text-fg':'#4a4458','--page-text-bg':'#fff8f0','--page-link-fg':'var(--accent2)',
    '--page-hr-color':'var(--border)','--page-quote-fg':'#9b59b6','--page-quote-border':'var(--border)',
  },
  'アースカラー': {
    '--bg':'#1a1a14','--bg2':'#22221a','--bg3':'#2e2c22','--bg4':'#3e3a2e',
    '--fg':'#d4c8a8','--fg2':'#b0a488','--accent':'#d4a030','--accent2':'#7aa030',
    '--red':'#d06050','--green':'#90b870','--orange':'#d07830','--blue':'#6898b0',
    '--border':'#3a3628','--selection':'#4a4228',
    '--db-th-fg':'#b0a488','--db-th-bg':'#2e2c22','--db-entity-fg':'#d4c8a8','--db-entity-bg':'#1a1a14',
    '--db-cell-fg':'#d4c8a8','--db-grid-border':'var(--border)','--db-active-color':'var(--editor-caret-color)',
    '--page-title-fg':'#d4c8a8','--page-h1-fg':'#d4a030','--page-h2-fg':'#d4a030','--page-h3-fg':'#d4c8a8',
    '--page-text-fg':'#d4c8a8','--page-text-bg':'#22221a','--page-link-fg':'var(--accent2)',
    '--page-hr-color':'var(--border)','--page-quote-fg':'#b0a488','--page-quote-border':'var(--border)',
  },
};

// 現在のテーマ名を推定（CSS変数の値で判定）
function detectCurrentTheme() {
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getDefaultThemeId === 'function') {
    return MeldexThemeManager.getDefaultThemeId();
  }
  // 「OSに合わせる」が設定されていればそれを返す
  if (localStorage.getItem('editor-theme-name') === 'OSに合わせる') return 'OSに合わせる';
  const curBg = getCssVar('--bg');
  const curAccent = getCssVar('--accent');
  for (const [name, preset] of Object.entries(THEME_PRESETS)) {
    if (!preset) continue; // null（OSに合わせる）はスキップ
    if (preset['--bg'] === curBg && preset['--accent'] === curAccent) return name;
  }
  return '';
}

// 現在のCSS変数のスナップショットを取得（キャンセル時の復元用）
const UI_PRESET_FONTS = [
  { name: 'Noto Sans JP（デフォルト・同梱）', family: '' },
  { name: 'Segoe UI', family: "'Segoe UI', sans-serif" },
  { name: 'Yu Gothic UI', family: "'Yu Gothic UI', sans-serif" },
  { name: 'Meiryo', family: "'Meiryo', sans-serif" },
  { name: 'Noto Sans JP', family: "'Noto Sans JP', sans-serif" },
];

// OS にインストールされていそうな代表的フォントの候補。
// 実際にインストールされているかは canvas 計測で判定し、インストール済みのものだけドロップダウンに追加する。
const _SYSTEM_FONT_CANDIDATES = [
  // macOS / iOS / iPadOS
  { name: 'Hiragino Kaku Gothic ProN', family: "'Hiragino Kaku Gothic ProN', sans-serif" },
  { name: 'Hiragino Kaku Gothic Pro', family: "'Hiragino Kaku Gothic Pro', sans-serif" },
  { name: 'Hiragino Sans', family: "'Hiragino Sans', sans-serif" },
  { name: 'Hiragino Maru Gothic ProN', family: "'Hiragino Maru Gothic ProN', sans-serif" },
  { name: 'Hiragino Mincho ProN', family: "'Hiragino Mincho ProN', serif" },
  { name: 'Helvetica Neue', family: "'Helvetica Neue', sans-serif" },
  { name: 'Helvetica', family: 'Helvetica, sans-serif' },
  { name: 'Avenir Next', family: "'Avenir Next', sans-serif" },
  { name: 'Avenir', family: 'Avenir, sans-serif' },
  { name: 'Optima', family: 'Optima, sans-serif' },
  { name: 'Palatino', family: 'Palatino, serif' },
  { name: 'Menlo', family: 'Menlo, monospace' },
  { name: 'Monaco', family: 'Monaco, monospace' },
  // Windows
  { name: 'Meiryo UI', family: "'Meiryo UI', sans-serif" },
  { name: 'MS PGothic', family: "'MS PGothic', sans-serif" },
  { name: 'MS Gothic', family: "'MS Gothic', monospace" },
  { name: 'MS PMincho', family: "'MS PMincho', serif" },
  { name: 'MS Mincho', family: "'MS Mincho', serif" },
  { name: 'Yu Mincho', family: "'Yu Mincho', serif" },
  { name: 'BIZ UDGothic', family: "'BIZ UDGothic', sans-serif" },
  { name: 'BIZ UDPGothic', family: "'BIZ UDPGothic', sans-serif" },
  { name: 'BIZ UDMincho', family: "'BIZ UDMincho', serif" },
  { name: 'BIZ UDPMincho', family: "'BIZ UDPMincho', serif" },
  { name: 'UD デジタル 教科書体 N-R', family: "'UD デジタル 教科書体 N-R', sans-serif" },
  { name: 'Consolas', family: 'Consolas, monospace' },
  { name: 'Calibri', family: 'Calibri, sans-serif' },
  { name: 'Cambria', family: 'Cambria, serif' },
  // Android / Linux / ChromeOS
  { name: 'Roboto', family: 'Roboto, sans-serif' },
  { name: 'Noto Sans CJK JP', family: "'Noto Sans CJK JP', sans-serif" },
  { name: 'Noto Serif CJK JP', family: "'Noto Serif CJK JP', serif" },
  { name: 'Noto Serif JP', family: "'Noto Serif JP', serif" },
  { name: 'Droid Sans', family: "'Droid Sans', sans-serif" },
  { name: 'Droid Serif', family: "'Droid Serif', serif" },
  // クロスプラットフォームの定番
  { name: 'Arial', family: 'Arial, sans-serif' },
  { name: 'Arial Black', family: "'Arial Black', sans-serif" },
  { name: 'Verdana', family: 'Verdana, sans-serif' },
  { name: 'Tahoma', family: 'Tahoma, sans-serif' },
  { name: 'Trebuchet MS', family: "'Trebuchet MS', sans-serif" },
  { name: 'Times New Roman', family: "'Times New Roman', serif" },
  { name: 'Times', family: 'Times, serif' },
  { name: 'Georgia', family: 'Georgia, serif' },
  { name: 'Garamond', family: 'Garamond, serif' },
  { name: 'Courier New', family: "'Courier New', monospace" },
  { name: 'Courier', family: 'Courier, monospace' },
  { name: 'Impact', family: 'Impact, sans-serif' },
];

function _extractPrimaryFontFamily(family) {
  if (!family) return '';
  const first = String(family).split(',')[0].trim();
  return first.replace(/^['"]|['"]$/g, '');
}

let _fontDetectionCtx = null;
function _isFontInstalled(fontFamily) {
  const primary = _extractPrimaryFontFamily(fontFamily);
  if (!primary) return false;
  if (!_fontDetectionCtx) {
    try {
      const canvas = document.createElement('canvas');
      _fontDetectionCtx = canvas.getContext('2d');
    } catch { return false; }
    if (!_fontDetectionCtx) return false;
  }
  const ctx = _fontDetectionCtx;
  const testString = 'mmmmmmmmmmlli1I0Oあいうえお日本語サンプル';
  const testSize = '72px';
  const baseFonts = ['monospace', 'sans-serif', 'serif'];
  for (const base of baseFonts) {
    ctx.font = `${testSize} ${base}`;
    const baseWidth = ctx.measureText(testString).width;
    ctx.font = `${testSize} "${primary}", ${base}`;
    const testWidth = ctx.measureText(testString).width;
    if (Math.abs(testWidth - baseWidth) > 0.01) return true;
  }
  return false;
}

let _detectedSystemFontsCache = null;
function getDetectedSystemFonts() {
  if (_detectedSystemFontsCache) return _detectedSystemFontsCache;
  const seen = new Set(UI_PRESET_FONTS.map(f => f && f.family).filter(Boolean));
  const detected = [];
  for (const candidate of _SYSTEM_FONT_CANDIDATES) {
    if (!candidate || !candidate.family) continue;
    if (seen.has(candidate.family)) continue;
    try {
      if (_isFontInstalled(candidate.family)) {
        detected.push(candidate);
        seen.add(candidate.family);
      }
    } catch {}
  }
  detected.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  _detectedSystemFontsCache = detected;
  return detected;
}

function _renderFontOption(opt, current) {
  const sel = opt.family === current ? ' selected' : '';
  return `<option value="${esc(opt.family)}" style="font-family:${opt.family || 'inherit'};"${sel}>${esc(opt.name)}</option>`;
}

function getUIFontOptions() {
  const current = document.documentElement.style.getPropertyValue('--ui-font') || '';
  const preset = UI_PRESET_FONTS.map(f => _renderFontOption(f, current)).join('');
  const detected = getDetectedSystemFonts();
  if (!detected.length) return preset;
  const detectedHtml = detected.map(f => _renderFontOption(f, current)).join('');
  return preset + `<optgroup label="システムフォント">${detectedHtml}</optgroup>`;
}

let _fontFamilyOptionItemsCache = null;

function getFontFamilyOptionItems() {
  if (!_fontFamilyOptionItemsCache) {
    const detected = getDetectedSystemFonts();
    _fontFamilyOptionItemsCache = [
      { v: '', l: '共通フォント', style: 'font-family:inherit;' },
      ...UI_PRESET_FONTS
        .filter(f => f && f.family)
        .map(f => ({ v: f.family, l: f.name, style: `font-family:${f.family};` })),
      ...detected.map(f => ({ v: f.family, l: f.name, style: `font-family:${f.family};`, group: 'システムフォント' })),
    ];
  }
  return _fontFamilyOptionItemsCache;
}

function normalizeFontFamilyValue(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (['inherit', 'initial', 'unset', 'revert', 'revert-layer'].includes(lower)) return '';
  // CSS インジェクション防止のため危険な記号を排除。残りは OS フォント名として許容する。
  if (/[<>{};\\]/.test(raw)) return '';
  return raw;
}

function getFontFamilyOptions(currentValue) {
  const current = normalizeFontFamilyValue(currentValue);
  const items = getFontFamilyOptionItems();
  let out = '';
  let currentGroup = null;
  for (const item of items) {
    const grp = item.group || null;
    if (grp !== currentGroup) {
      if (currentGroup) out += '</optgroup>';
      if (grp) out += `<optgroup label="${esc(grp)}">`;
      currentGroup = grp;
    }
    const sel = item.v === current ? ' selected' : '';
    out += `<option value="${esc(item.v)}" style="${esc(item.style)}"${sel}>${esc(item.l)}</option>`;
  }
  if (currentGroup) out += '</optgroup>';
  return out;
}


// v0.5.130: Google Fonts 動的ロードを廃止。プリセットはローカル同梱フォントとシステムフォントのみ。
function loadGoogleFontForUI(_family) { /* no-op: retained as stub for backward-compat callers */ }

function _noteContentHorizontalPaddingCss() {
  return 'max(var(--page-margin-x, 50px), calc((100% - var(--page-content-max-width, 1200px)) / 2))';
}

function _clampNoteContentMaxWidth(value) {
  let px = parseFloat(value);
  if (!Number.isFinite(px)) px = 1200;
  return Math.max(480, Math.min(3200, px));
}

function _applyNoteContentHorizontalPadding(pc) {
  if (!pc) return;
  const padding = _noteContentHorizontalPaddingCss();
  pc.style.paddingLeft = pc.style.paddingRight = padding;
}

function applyNoteMargin(px) {
  const pages = document.querySelectorAll
    ? Array.from(document.querySelectorAll('#page-content'))
    : [document.getElementById('page-content')].filter(Boolean);
  const parsed = Number(px);
  if (Number.isFinite(parsed) && parsed >= 0) {
    document.documentElement.style.setProperty('--page-margin-x', Math.max(0, parsed) + 'px');
  }
  pages.forEach(_applyNoteContentHorizontalPadding);
}

function applyNoteContentMaxWidth(px) {
  const pages = document.querySelectorAll
    ? Array.from(document.querySelectorAll('#page-content'))
    : [document.getElementById('page-content')].filter(Boolean);
  const root = document.documentElement;
  const current = root.style.getPropertyValue('--page-content-max-width');
  if (px != null || !current) {
    root.style.setProperty('--page-content-max-width', _clampNoteContentMaxWidth(px) + 'px');
  }
  pages.forEach(_applyNoteContentHorizontalPadding);
}

function isDesktopRootZoomDisabled() {
  // 旧WebView回避用の互換フック。ChromeアプリモードではMeldex内UI倍率を許可する。
  return false;
}

function isDesktopInteractionRecoveryMode() {
  return false;
}

function applyUIScale(pct) {
  let next = parseInt(pct, 10) || 100;
  next = Math.max(67, Math.min(200, next));
  if (next === 100) document.documentElement.style.removeProperty('zoom');
  else document.documentElement.style.zoom = (next / 100);
  document.documentElement.style.fontSize = ''; // font-sizeスケーリングの残骸をクリア
  if (typeof updateMeldexViewportSize === 'function') updateMeldexViewportSize();
  localStorage.setItem('ui-scale', String(next));
  return next;
}

function applyStatusbarHidden(hidden) {
  const on = hidden === true || hidden === '1' || hidden === 'true';
  document.body.dataset.statusbarHidden = on ? '1' : '0';
}

function _settingsCanonicalPanelName(name) {
  const raw = String(name || '');
  if (raw === '外観') return 'テーマ';
  if (raw === '詳細') return '全般';
  if (raw === 'ナレッジ層') return 'LLM';
  if (raw === 'コスト' || raw === 'LLM費用' || raw === 'LLMコスト管理' || raw === '利用料金' || raw === 'AI料金' || raw === 'AI使用量' || raw === 'AI API使用量') return 'LLMコスト';
  if (raw === 'Discord' || raw === 'Discord連携' || raw === 'Discord Bot連携') return 'Discord Bot';
  if (raw === 'アプリ情報' || raw === 'このアプリについて' || raw === 'About') return '';
  if (raw === '送信設定' || raw === 'クラッシュ送信設定' || raw === 'フィードバック・送信設定') return 'フィードバック';
  if (raw === '連携') return '拡張機能';
  if (raw === 'DB' || raw === 'データ保護' || raw === 'データベースメンテナンス') return 'データベース';
  return raw;
}

function _settingsPanelDisplayName(name) {
  const canonical = _settingsCanonicalPanelName(name);
  const labels = {
    'LLM': 'チャットAI',
    'LLMコスト': 'AI使用量',
    'Discord Bot': 'Discord連携',
  };
  return labels[canonical] || canonical;
}

function _settingsThemeSetDirty(value) {
  window._settingsThemeDirty = !!value;
}

function _settingsThemeMarkDirty() {
  _settingsThemeSetDirty(true);
}

function _settingsThemeIsDirty() {
  return !!window._settingsThemeDirty;
}

function snapshotThemeVars() {
  const snap = {};
  // ベース変数 + getAllStyleKeys() の全変数をスナップショット（キャンセル時に完全復元するため）
  const keys = new Set(['--bg','--bg2','--bg3','--bg4','--fg','--fg2','--accent','--accent2','--red','--green','--orange','--blue','--border','--selection','--ui-font','--ui-font-size','--page-hr-color']);
  if (typeof getAllStyleKeys === 'function') getAllStyleKeys().forEach(k => keys.add(k));
  if (typeof COMMON_INTEGRATED_APP_STYLE_KEYS !== 'undefined') COMMON_INTEGRATED_APP_STYLE_KEYS.forEach(k => keys.add(k));
  keys.forEach(k => { snap[k] = getCssVar(k); });
  snap.__editorThemeName = localStorage.getItem('editor-theme-name');
  if (typeof MeldexThemeManager !== 'undefined') {
    const defaultKey = MeldexThemeManager.DEFAULT_THEME_KEY;
    const colorSetKey = MeldexThemeManager.THEME_COLOR_SET_KEY;
    const uiAppsKey = MeldexThemeManager.THEME_UI_APPLICATIONS_KEY;
    const autoToneKey = MeldexThemeManager.THEME_UI_AUTO_TONE_KEY;
    const osAccentKey = MeldexThemeManager.THEME_OS_ACCENT_KEY;
    const colorSlotKey = typeof THEME_COLOR_SLOT_SETTINGS_KEY !== 'undefined' ? THEME_COLOR_SLOT_SETTINGS_KEY : 'meldex-theme-color-slot-settings';
    const colorExtraSlotKey = typeof THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY !== 'undefined' ? THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY : 'meldex-theme-color-extra-slot-settings';
    snap.__defaultThemeId = defaultKey ? localStorage.getItem(defaultKey) : null;
    snap.__themeColorSet = colorSetKey ? localStorage.getItem(colorSetKey) : null;
    snap.__themeColorSlots = localStorage.getItem(colorSlotKey);
    snap.__themeColorExtraSlots = localStorage.getItem(colorExtraSlotKey);
    snap.__themeUiApplications = uiAppsKey ? localStorage.getItem(uiAppsKey) : null;
    snap.__themeUiAutoTone = autoToneKey ? localStorage.getItem(autoToneKey) : null;
    snap.__themeOsAccent = osAccentKey ? localStorage.getItem(osAccentKey) : null;
  }
  return snap;
}

function restoreThemeSnapshot(snap) {
  if (!snap) return;
  if (typeof MeldexThemeManager !== 'undefined') {
    const defaultKey = MeldexThemeManager.DEFAULT_THEME_KEY;
    const colorSetKey = MeldexThemeManager.THEME_COLOR_SET_KEY;
    const uiAppsKey = MeldexThemeManager.THEME_UI_APPLICATIONS_KEY;
    const autoToneKey = MeldexThemeManager.THEME_UI_AUTO_TONE_KEY;
    const osAccentKey = MeldexThemeManager.THEME_OS_ACCENT_KEY;
    const colorSlotKey = typeof THEME_COLOR_SLOT_SETTINGS_KEY !== 'undefined' ? THEME_COLOR_SLOT_SETTINGS_KEY : 'meldex-theme-color-slot-settings';
    const colorExtraSlotKey = typeof THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY !== 'undefined' ? THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY : 'meldex-theme-color-extra-slot-settings';
    if (defaultKey && Object.prototype.hasOwnProperty.call(snap, '__defaultThemeId')) {
      if (snap.__defaultThemeId == null) localStorage.removeItem(defaultKey);
      else localStorage.setItem(defaultKey, snap.__defaultThemeId);
    }
    if (colorSetKey && Object.prototype.hasOwnProperty.call(snap, '__themeColorSet')) {
      if (snap.__themeColorSet == null) localStorage.removeItem(colorSetKey);
      else localStorage.setItem(colorSetKey, snap.__themeColorSet);
    }
    if (Object.prototype.hasOwnProperty.call(snap, '__themeColorSlots')) {
      if (snap.__themeColorSlots == null) localStorage.removeItem(colorSlotKey);
      else localStorage.setItem(colorSlotKey, snap.__themeColorSlots);
    }
    if (Object.prototype.hasOwnProperty.call(snap, '__themeColorExtraSlots')) {
      if (snap.__themeColorExtraSlots == null) localStorage.removeItem(colorExtraSlotKey);
      else localStorage.setItem(colorExtraSlotKey, snap.__themeColorExtraSlots);
    }
    if (uiAppsKey && Object.prototype.hasOwnProperty.call(snap, '__themeUiApplications')) {
      if (snap.__themeUiApplications == null) localStorage.removeItem(uiAppsKey);
      else localStorage.setItem(uiAppsKey, snap.__themeUiApplications);
    }
    if (autoToneKey && Object.prototype.hasOwnProperty.call(snap, '__themeUiAutoTone')) {
      if (snap.__themeUiAutoTone == null) localStorage.removeItem(autoToneKey);
      else localStorage.setItem(autoToneKey, snap.__themeUiAutoTone);
    }
    if (osAccentKey && Object.prototype.hasOwnProperty.call(snap, '__themeOsAccent')) {
      if (snap.__themeOsAccent == null) localStorage.removeItem(osAccentKey);
      else localStorage.setItem(osAccentKey, snap.__themeOsAccent);
    }
    const themeId = snap.__defaultThemeId || snap.__editorThemeName;
    if (themeId && typeof MeldexThemeManager.applyDefaultTheme === 'function') {
      MeldexThemeManager.applyDefaultTheme(themeId, {
        silent: true,
        resetThemeColorSet: false,
        preserveStoredThemeUi: true,
        skipHistory: true,
      });
    }
    if (Object.prototype.hasOwnProperty.call(snap, '__themeColorSlots')) {
      if (snap.__themeColorSlots == null) localStorage.removeItem(colorSlotKey);
      else localStorage.setItem(colorSlotKey, snap.__themeColorSlots);
    }
    if (Object.prototype.hasOwnProperty.call(snap, '__themeColorExtraSlots')) {
      if (snap.__themeColorExtraSlots == null) localStorage.removeItem(colorExtraSlotKey);
      else localStorage.setItem(colorExtraSlotKey, snap.__themeColorExtraSlots);
    }
    if (uiAppsKey && Object.prototype.hasOwnProperty.call(snap, '__themeUiApplications')) {
      if (snap.__themeUiApplications == null) localStorage.removeItem(uiAppsKey);
      else localStorage.setItem(uiAppsKey, snap.__themeUiApplications);
    }
    if (autoToneKey && Object.prototype.hasOwnProperty.call(snap, '__themeUiAutoTone')) {
      if (snap.__themeUiAutoTone == null) localStorage.removeItem(autoToneKey);
      else localStorage.setItem(autoToneKey, snap.__themeUiAutoTone);
    }
    if (typeof MeldexThemeManager.applyThemeUiApplications === 'function') {
      MeldexThemeManager.applyThemeUiApplications(MeldexThemeManager.getThemeUiApplications?.());
    }
  }
  const osAccentStyleKeys = (snap.__themeOsAccent === '1' && typeof MeldexThemeManager !== 'undefined' && Array.isArray(MeldexThemeManager.THEME_OS_ACCENT_STYLE_KEYS))
    ? MeldexThemeManager.THEME_OS_ACCENT_STYLE_KEYS
    : null;
  for (const [k, v] of Object.entries(snap)) {
    if (k.startsWith('__')) continue;
    if (osAccentStyleKeys && osAccentStyleKeys.includes(k)) continue;
    document.documentElement.style.setProperty(k, v);
  }
  if (Object.prototype.hasOwnProperty.call(snap, '__editorThemeName')) {
    if (snap.__editorThemeName == null) localStorage.removeItem('editor-theme-name');
    else localStorage.setItem('editor-theme-name', snap.__editorThemeName);
  }
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.applyOsAccentColorSetting === 'function' && Object.prototype.hasOwnProperty.call(snap, '__themeOsAccent')) {
    MeldexThemeManager.applyOsAccentColorSetting(snap.__themeOsAccent === '1');
  }
}

function _deriveUiStyleVarsFromBase(vars) {
  const src = vars || {};
  return {
    '--ui-header-fg': src['--ui-header-fg'] || src['--fg2'] || '#969696',
    '--ui-header-bg': src['--ui-header-bg'] || src['--bg3'] || '#2d2d2d',
    '--ui-toolbar-fg': src['--ui-toolbar-fg'] || src['--fg'] || '#d4d4d4',
    '--ui-toolbar-bg': src['--ui-toolbar-bg'] || src['--bg2'] || '#252525',
    '--ui-hover-fg': src['--ui-hover-fg'] || src['--fg'] || '#d4d4d4',
    '--ui-hover-bg': src['--ui-hover-bg'] || src['--bg4'] || '#3e3e3e',
    '--ui-fg-strong': src['--ui-fg-strong'] || '#ffffff',
    '--ui-selection-fg': src['--ui-selection-fg'] || src['--fg'] || '#ffffff',
    '--ui-selection-bg': src['--ui-selection-bg'] || src['--selection'] || '#264f78',
    '--ui-range-fill-bg': src['--ui-range-fill-bg'] || src['--accent'] || '#569cd6',
    '--ui-range-track-bg': src['--ui-range-track-bg'] || src['--border'] || '#333333',
  };
}

function applyThemePreset(name) {
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.applyDefaultTheme === 'function') {
    if (!name) return;
    MeldexThemeManager.applyDefaultTheme(name);
    showStatus(`テーマをプレビュー中`);
    return;
  }
  if (name === 'OSに合わせる') {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const actual = isDark ? 'ダーク' : 'ライト';
    applyThemePreset(actual);
    localStorage.setItem('editor-theme-name', 'OSに合わせる');
    showStatus(`テーマ「OSに合わせる」→ ${actual}`);
    return;
  }
  const preset = THEME_PRESETS[name];
  if (!preset) return;
  localStorage.setItem('editor-theme-name', name);
  // まず全CSS変数をリセット（前のテーマの残骸を消す）
  const resetKeys = getAllStyleKeys();
  if (typeof COMMON_INTEGRATED_APP_STYLE_KEYS !== 'undefined') {
    resetKeys.push(...COMMON_INTEGRATED_APP_STYLE_KEYS);
  }
  for (const k of resetKeys) {
    document.documentElement.style.removeProperty(k);
  }
  // プリセットの基本色を適用
  for (const [k, v] of Object.entries(preset)) {
    document.documentElement.style.setProperty(k, v);
  }
  for (const [k, v] of Object.entries(_deriveUiStyleVarsFromBase(preset))) {
    document.documentElement.style.setProperty(k, v);
  }
  showStatus(`テーマ「${name}」をプレビュー中`);
}


/* Source chunk: gb-settings.part02.js */
/* gb-settings.part02.js */
/* ==============================
   カスタムテーマ（完全版 — タブ式統一UI）
   ============================== */
const COLOR_SETTINGS_KEY = 'editor-theme';
const THEME_COLOR_SET_THEME_KEY = '_theme-color-set';
const THEME_OS_ACCENT_THEME_KEY = '_theme-use-os-accent';
const THEME_COLOR_SLOT_SETTINGS_KEY = 'meldex-theme-color-slot-settings';
const THEME_COLOR_SLOT_SETTINGS_THEME_KEY = '_theme-color-slot-settings';
const THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY = 'meldex-theme-color-extra-slot-settings';
const THEME_COLOR_EXTRA_SLOT_SETTINGS_THEME_KEY = '_theme-color-extra-slot-settings';
const STANDARD_PALETTE_THEME_KEY = '_standard-palette-adjust';
const STANDARD_PALETTE_ADJUST_STORAGE_KEY = 'meldex-standard-palette-adjust';
const THEME_UI_CUSTOM_COLOR_PREFIX = 'color:';
const THEME_STYLE_LEFT_ACCENT_WIDTH = '6px';
const THEME_STYLE_UNDERLINE_WIDTH = '2px';
const SETTINGS_THEME_COMMON_BODY_BG_KEY = '--content-bg';
const SETTINGS_THEME_COMMON_BODY_BG_LINKED_KEYS = Object.freeze([
  '--page-text-bg',
  '--sn2-page-bg',
  '--db-row-bg',
  '--db-entity-bg',
  '--bd-bg',
]);
const COMMON_THEME_SURFACE_STYLE_KEYS = new Set(['--page-text-bg', '--sn2-page-bg', '--db-row-bg', '--fv-panel-bg', '--cal-content-bg', '--preview-bg', '--detail-bg', '--chat-bg', '--timer-bg', '--history-bg', '--annotation-bg', '--search-bg', '--version-bg']);
const COMMON_THEME_SCROLLBAR_STYLE_KEYS = new Set(['--cal-scroll-thumb', '--cal-scroll-thumb-hover']);

// getCssVar, rgbToHex は meldex-core.js で定義済み

// PALETTE_COLORS, PALETTE_BG_COLORS は meldex-core.js で定義済み

// カスタムカラー管理・calcBgColor・parseColorToHexAlpha・hexAlphaToRgba は gb-color-palette.js に統合済み

function _runSettingsWithoutLocalStorageHistory(fn) {
  if (typeof window === 'undefined') return typeof fn === 'function' ? fn() : undefined;
  window.__meldexSuppressLocalStorageSettingsHistory = Number(window.__meldexSuppressLocalStorageSettingsHistory || 0) + 1;
  try {
    return typeof fn === 'function' ? fn() : undefined;
  } finally {
    window.__meldexSuppressLocalStorageSettingsHistory = Math.max(0, Number(window.__meldexSuppressLocalStorageSettingsHistory || 0) - 1);
  }
}

// スウォッチ+不透明度から背景色を更新
function updateBgFromSwatchAlpha(key) {
  const swatch = document.querySelector(`.cs-swatch[data-key="${key}"]`);
  const slider = document.querySelector(`.cs-alpha[data-key="${key}"]`);
  if (!swatch || !slider) return;
  const hex = swatch.dataset.hex || '#000000';
  const alpha = parseFloat(slider.value) / 100;
  const val = hexAlphaToRgba(hex, alpha);
  setColorSetting(key, val);
  setColorSwatchValue(swatch, val);
}

function syncCsSwatches(root) {
  (root || document).querySelectorAll('.cs-swatch[data-key]').forEach((swatch) => {
    const key = swatch.dataset.key;
    if (!key) return;
    const color = getCssVar(key);
    setColorSwatchValue(swatch, color);
    if (swatch.dataset.hex !== undefined) {
      swatch.dataset.hex = parseColorToHexAlpha(color).hex;
    }
  });
}

// セクション別 カスタムテーマの項目定義
const UI_STYLE_SECTIONS = {
  '共通': [
    { label: '共通本文背景色', bg:'--content-bg', text:'本文背景' },
    { label: 'アプリ基礎背景色', bg:'--bg', text:'アプリ基礎' },
    { label: 'サブ背景色', bg:'--bg2', text:'パネル背景' },
    { label: '強調背景色', bg:'--bg3', text:'ダイアログ/ホバー領域背景' },
    { label: 'ポップアップ', bg:'--ui-popup-bg', text:'ポップアップ背景' },
    { label: 'ツールチップ', fg:'--ui-tooltip-fg', bg:'--ui-tooltip-bg', text:'ツールチップ' },
    { label: 'ツールチップ枠線', line:'--ui-tooltip-border', text:'━━' },
    { label: 'スクロールバー背景', bg:'--ui-scrollbar-track-bg', text:'スクロール背景' },
    { label: 'スクロールバーつまみ', bg:'--ui-scrollbar-thumb-bg', text:'スクロールバー' },
    { label: 'スクロールバーホバー', bg:'--ui-scrollbar-thumb-hover-bg', text:'スクロールバーホバー' },
    { label: 'パネルタブバー', bg:'--ui-pane-tabbar-bg', text:'タブバー' },
    { label: 'パネルタブ選択背景', bg:'--ui-pane-tab-active-bg', text:'選択タブ' },
    { label: '折りたたみ/ドックバー', bg:'--ui-collapsed-tabbar-bg', text:'折りたたみ' },
    { label: 'ボタン', fg:'--ui-fg-default', bg:'--ui-bg-control', text:'ボタン' },
    { label: 'ボタンホバー', fg:'--ui-hover-fg', bg:'--ui-bg-control-hover', text:'ホバー' },
    { label: 'ボタン選択', fg:'--ui-fg-strong', bg:'--ui-accent', text:'選択' },
    { label: '通常文字', fg:'--fg', bg:'--ui-text-bg', bold:'--ui-text-bold', italic:'--ui-text-italic', fontSize:'--ui-text-font-size', text:'通常テキスト', font:'--ui-font' },
    { label: 'サブテキスト', fg:'--fg2', bold:'--ui-muted-bold', italic:'--ui-muted-italic', fontSize:'--ui-muted-font-size', text:'サブテキスト', font:'--ui-muted-font' },
    { label: 'ヘッダー', fg:'--ui-header-fg', bg:'--ui-header-bg', text:'ヘッダー', font:'--ui-header-font' },
    { label: 'ツールバー', fg:'--ui-toolbar-fg', bg:'--ui-toolbar-bg', text:'ツールバー', font:'--ui-toolbar-font' },
    { label: 'ホバー', fg:'--ui-hover-fg', bg:'--ui-hover-bg', text:'ホバー' },
    { label: 'パネル内タブバー', bg:'--ui-inner-tabbar-bg', line:'--ui-inner-tabbar-border', width:'--ui-inner-tabbar-border-width', text:'タブバー' },
    { label: 'パネル内タブ 通常', fg:'--ui-inner-tab-fg', bg:'--ui-inner-tab-bg', bold:'--ui-inner-tab-font-weight', fontSize:'--ui-inner-tab-font-size', text:'タブ', font:'--ui-inner-tab-font' },
    { label: 'パネル内タブ ホバー', fg:'--ui-inner-tab-hover-fg', bg:'--ui-inner-tab-hover-bg', text:'ホバー' },
    { label: 'パネル内タブ 選択', fg:'--ui-inner-tab-active-fg', bg:'--ui-inner-tab-active-bg', bold:'--ui-inner-tab-active-font-weight', line:'--ui-inner-tab-active-underline', width:'--ui-inner-tab-underline-width', text:'選択中' },
    { label: 'パネル内タブ 選択背景濃度', numbers:[{ label:'濃度', key:'--ui-inner-tab-active-bg-alpha', min:0, max:100, step:1, unit:'%', slider:true, fallback:14 }], text:'14%' },
    { label: 'パネル内タブ サイズ', numbers:[{ label:'高さ', key:'--ui-inner-tab-height', min:18, max:56, step:1, unit:'px', fallback:28 }, { label:'左右余白', key:'--ui-inner-tab-padding-x', min:0, max:40, step:1, unit:'px', fallback:12 }], text:'タブ' },
    { label: '強調文字', fg:'--ui-fg-strong', previewBg:'--ui-accent', text:'強調文字' },
    { label: 'スライダー', previewType:'slider', fg:'--ui-range-fill-bg', fgLabel:'塗り', bg:'--ui-range-track-bg', bgLabel:'残り', text:'スライダー' },
    { label: 'アクセント', fg:'--accent', bg:'--accent-bg', text:'アクセント' },
    { label: 'リンク', fg:'--accent2', text:'リンク色' },
    { label: 'ボーダー', line:'--border', text:'━━' },
    { label: 'カーソル', fg:'--editor-caret-color', width:'--editor-caret-width', text:'┃' },
    { label: 'フォーカス枠', line:'--a11y-focus-ring', text:'━━' },
    { label: '選択', fg:'--ui-selection-fg', bg:'--ui-selection-bg', text:'選択行' },
    { label: 'エラー・警告', fg:'--red', text:'エラー' },
  ],
  'フォルダ': [
    { label: 'カード', fg:'--fv-item-fg', bg:'--fv-item-bg', text:'フォルダカード', font:'--fv-font-family' },
    { label: 'カード枠線', line:'--fv-item-border', text:'━━' },
    { label: 'ホバー', fg:'--fv-item-hover-fg', bg:'--fv-item-hover-bg', line:'--fv-item-hover-border', text:'ホバー' },
    { label: '選択', fg:'--fv-item-selected-fg', bg:'--fv-item-selected-bg', line:'--fv-item-selected-border', text:'選択中' },
    { label: 'メタ情報', fg:'--fv-meta-fg', bg:null, text:'更新日時' },
    { label: 'アイコン', fg:'--fv-icon-fg', bg:null, text:'アイコン' },
  ],
  'ノート': [
    { label: 'タイトル', fg:'--page-title-fg', bold:'--page-title-bold', italic:'--page-title-italic', bg:'--page-title-bg', text:'ページタイトル', font:'--page-title-font' },
    { label: '見出し H1', fg:'--page-h1-fg', bold:'--page-h1-bold', italic:'--page-h1-italic', bg:'--page-h1-bg', text:'見出し1', font:'--page-h1-font' },
    { label: '見出し H2', fg:'--page-h2-fg', bold:'--page-h2-bold', italic:'--page-h2-italic', bg:'--page-h2-bg', text:'見出し2', font:'--page-h2-font' },
    { label: '見出し H3', fg:'--page-h3-fg', bold:'--page-h3-bold', italic:'--page-h3-italic', bg:'--page-h3-bg', text:'見出し3', font:'--page-h3-font' },
    { label: '見出し H4', fg:'--page-h4-fg', bold:'--page-h4-bold', italic:'--page-h4-italic', bg:'--page-h4-bg', text:'見出し4', font:'--page-h4-font' },
    { label: '見出し H5', fg:'--page-h5-fg', bold:'--page-h5-bold', italic:'--page-h5-italic', bg:'--page-h5-bg', text:'見出し5', font:'--page-h5-font' },
    { label: '見出し H6', fg:'--page-h6-fg', bold:'--page-h6-bold', italic:'--page-h6-italic', bg:'--page-h6-bg', text:'見出し6', font:'--page-h6-font' },
    { label: '本文', fg:'--page-text-fg', bold:'--page-text-bold', italic:'--page-text-italic', text:'本文テキスト', font:'--page-text-font' },
    { label: '引用ブロック', fg:'--page-quote-fg', bold:'--page-quote-bold', italic:'--page-quote-italic', bg:'--page-quote-bg', text:'引用テキスト', bgType:'rgba' },
    { label: '引用線', line:'--page-quote-border', text:'━━' },
  ],
  'シナリオ': [
    { label: '基本テキスト', fg:'--sn2-base-text-color', bold:'--sn2-base-text-bold', italic:'--sn2-base-text-italic', fontSize:'--sn2-base-text-font-size', font:'--sn2-base-text-font-family', text:'基本テキスト' },
    { label: '枠線', line:'--sn2-border-color', width:'--sn2-border-width', text:'━━' },
    { label: '見開き区切り', line:'--sn2-spread-border-color', width:'--sn2-spread-border-width', text:'━━' },
    { label: 'ホバー', bg:'--sn2-hover-bg', text:'ホバー' },
    { label: 'テキスト選択', fg:'--sn2-selection-fg', bg:'--sn2-selection-color', text:'選択テキスト' },
    { label: 'ドラッグ選択', bg:'--sn2-drag-select-color', text:'ドラッグ選択' },
    { label: 'ドロップ', line:'--sn2-drop-color', width:'--sn2-drop-width', text:'━━' },
    { label: 'カーソル', fg:'--sn2-caret-color', width:'--sn2-caret-width', text:'┃' },
    { label: 'ルビ', numbers:[
      { label:'サイズ',   key:'--sn2-ruby-size',   min:0.3, max:1.5, step:0.05, unit:'em', fallback:0.5 },
      { label:'オフセット', key:'--sn2-ruby-offset', min:-8, max:8,   step:1,    unit:'px', fallback:0 },
    ], text:'ルビ' },
  ],
  'シート': [
    { label: 'ヘッダー', fg:'--db-th-fg', bold:'--db-th-bold', italic:'--db-th-italic', bg:'--db-th-bg', text:'プロパティ名', font:'--db-th-font' },
    { label: 'エントリ列', fg:'--db-entity-fg', bold:'--db-entity-bold', italic:'--db-entity-italic', bg:'--db-entity-bg', text:'キャラ名', font:'--db-entity-font' },
    { label: 'セル', fg:'--db-cell-fg', bold:'--db-cell-bold', italic:'--db-cell-italic', bg:'--db-cell-bg', text:'候補値テキスト', bgType:'rgba', font:'--db-cell-font' },
    { label: '選択', fg:'--db-selection-fg', bg:'--db-selection-color', text:'選択セル' },
    { label: 'アクティブセル枠', line:'--db-active-color', width:'--db-active-width', text:'━━' },
    { label: 'テーブル罫線', line:'--db-grid-border', toggle:'--db-show-grid', toggleOn:'1px', toggleOff:'0px', text:'━━' },
    { label: '採用ステータス', bg:'--db-status-adopted-color', text:'採用ステータス色' },
    { label: 'ソースバッジ 1', bg:'--db-msr-badge-1-bg', text:'1' },
    { label: 'ソースバッジ 2', bg:'--db-msr-badge-2-bg', text:'2' },
    { label: 'ソースバッジ 3', bg:'--db-msr-badge-3-bg', text:'3' },
    { label: 'ソースバッジ 4', bg:'--db-msr-badge-4-bg', text:'4' },
  ],
  'ボード': [
    { label: 'ボード背景', bg:'--bd-bg', text:'ボード背景' },
    { label: '影', bg:'--bd-shadow-color', text:'カードの影' },
    { label: '標準フォント', font:'--bd-default-font-family', text:'カードテキスト' },
    { label: '選択', fg:'--bd-selection-fg', bg:'--bd-selection-color', text:'選択テキスト' },
    { label: '矩形選択', bg:'--bd-select-rect-color', text:'矩形選択' },
    { label: 'グループ', line:'--bd-group-color', text:'━━' },
    { label: 'アンカー', line:'--bd-anchor-color', text:'━━' },
    { label: 'カーソル', fg:'--bd-caret-color', width:'--bd-caret-width', text:'┃' },
    { label: 'カード隙間', numbers:[
      { label:'同階層', key:'--bd-gap-siblings', min:0, max:400, step:1, unit:'px', fallback:10 },
      { label:'階層間',  key:'--bd-gap-levels',  min:0, max:600, step:1, unit:'px', fallback:30 },
    ], text:'隙間' },
  ],
  'カレンダー': [
    { label: '全体', fg: '--cal-fg', bg: '--cal-bg', text: 'カレンダー', font: '--cal-font-family' },
    { label: 'ツールバー', fg: '--cal-toolbar-fg', bg: '--cal-toolbar-bg', text: 'ツールバー' },
    { label: 'サイドバー', fg: '--cal-sidebar-fg', bg: '--cal-sidebar-bg', text: 'サイドバー' },
    { label: 'コンテンツ', fg: '--cal-fg', text: 'カレンダー面' },
    { label: '右パネル', fg: '--cal-panel-fg', bg: '--cal-panel-bg', text: 'オプション' },
    { label: '見出し', fg: '--cal-header-fg', bg: '--cal-header-bg', text: '曜日見出し' },
    { label: '土曜', fg: '--cal-saturday-fg', text: '土' },
    { label: '日曜', fg: '--cal-sunday-fg', text: '日' },
    { label: 'セル', fg: '--cal-fg', bg: '--cal-cell-bg', text: '予定セル' },
    { label: 'セルホバー', fg: '--cal-cell-hover-fg', bg: '--cal-cell-hover-bg', text: 'ホバー' },
    { label: '今日', fg: '--cal-today-fg', bg: '--cal-today-bg', text: '今日' },
    { label: '時刻', fg: '--cal-time-fg', text: '13:00' },
    { label: '罫線', line: '--cal-grid-line', text: '━━' },
    { label: 'イベント', fg: '--cal-event-fg', bg: '--cal-event-bg', line: '--cal-event-border', text: 'イベント' },
    { label: 'イベント配置', numbers: [{ label: '右余白', key: '--cal-event-create-gap', min: 0, max: 80, step: 1, unit: 'px', fallback: 18 }], text: '18px' },
    { label: '現在時刻バー', fg: '--cal-now-line-color', text: '━━' },
    { label: '入力欄', fg: '--cal-input-fg', bg: '--cal-input-bg', text: '入力欄' },
    { label: '操作ボタン', fg: '--cal-control-fg', bg: '--cal-control-bg', line: '--cal-control-border', text: 'ボタン' },
    { label: '補助表示', fg: '--cal-muted-fg', bg: '--cal-avatar-bg', text: '補助表示' },
    { label: 'アクセント', fg: '--cal-accent-fg', bg: '--cal-accent', text: '選択' },
    { label: 'タスク列', bg: '--cal-task-column-bg', text: '列' },
    { label: 'タスク見出し', fg: '--cal-task-fg', bg: '--cal-task-header-bg', text: '見出し' },
    { label: 'タスク', fg: '--cal-task-fg', bg: '--cal-task-bg', line: '--cal-task-border', text: 'タスク' },
    { label: '優先度: 緊急', bg: '--cal-task-priority-urgent-bg', text: '緊急' },
    { label: '優先度: 高', bg: '--cal-task-priority-high-bg', text: '高' },
    { label: '優先度: 中', bg: '--cal-task-priority-medium-bg', text: '中' },
    { label: '打刻', fg: '--cal-clock-fg', bg: '--cal-clock-bg', text: '打刻' },
    { label: 'ミニカレンダー選択', fg: '--cal-mini-selected-fg', bg: '--cal-mini-selected-bg', text: '選択日' },
  ],
  'フォルダツリー': [
    { label: 'パネル', fg:'--outliner-fg', bg:'--outliner-bg', line:'--outliner-border', text:'フォルダツリー' },
    { label: '見出し', fg:'--outliner-section-fg', bg:'--outliner-section-bg', text:'見出し' },
    { label: '項目', fg:'--outliner-item-fg', bg:'--outliner-item-bg', text:'項目' },
    { label: '項目ホバー', fg:'--outliner-item-hover-fg', bg:'--outliner-item-hover-bg', text:'ホバー' },
    { label: '項目選択', fg:'--outliner-item-selected-fg', bg:'--outliner-item-selected-bg', text:'選択中' },
    { label: '補助表示', fg:'--outliner-muted-fg', text:'補助' },
    { label: 'ドラッグ/アクセント', line:'--outliner-accent', text:'━━' },
  ],
  'ビューワー': [
    { label: 'パネル', fg:'--preview-fg', line:'--preview-border', text:'ビューワー' },
    { label: 'カード背景', bg:'--preview-card-bg', text:'カード' },
    { label: '本文', fg:'--preview-fg', text:'本文' },
    { label: '補助表示', fg:'--preview-muted-fg', text:'パス' },
    { label: 'ホバー', bg:'--preview-hover-bg', text:'ホバー' },
    { label: 'アクセント', line:'--preview-accent', text:'━━' },
  ],
  'オプション': [
    { label: 'パネル', fg:'--detail-fg', line:'--detail-border', text:'オプション' },
    { label: 'セクション背景', bg:'--detail-panel-bg', text:'セクション' },
    { label: '補助表示', fg:'--detail-muted-fg', text:'補助' },
    { label: 'ホバー', bg:'--detail-hover-bg', text:'ホバー' },
    { label: '選択', fg:'--detail-active-fg', bg:'--detail-active-bg', text:'選択中' },
    { label: 'アクセント', line:'--detail-accent', text:'━━' },
  ],
  'チャット': [
    { label: 'パネル', fg:'--chat-fg', line:'--chat-border', text:'チャット' },
    { label: 'ツール領域', bg:'--chat-panel-bg', text:'ツール' },
    { label: 'メッセージ', fg:'--chat-fg', bg:'--chat-message-bg', text:'メッセージ' },
    { label: '入力欄', fg:'--chat-input-fg', bg:'--chat-input-bg', text:'入力欄' },
    { label: '補助表示', fg:'--chat-muted-fg', text:'補助' },
    { label: 'ホバー', bg:'--chat-hover-bg', text:'ホバー' },
    { label: '選択/送信', fg:'--chat-active-fg', bg:'--chat-active-bg', line:'--chat-accent', text:'送信' },
  ],
  'タイマー': [
    { label: 'パネル', fg:'--timer-fg', line:'--timer-border', text:'タイマー' },
    { label: '設定パネル', bg:'--timer-panel-bg', text:'設定' },
    { label: '表示部', bg:'--timer-display-bg', text:'00:05:00' },
    { label: '補助表示', fg:'--timer-muted-fg', text:'補助' },
    { label: 'ホバー', bg:'--timer-hover-bg', text:'ホバー' },
    { label: '実行中/操作', fg:'--timer-active-fg', bg:'--timer-active-bg', line:'--timer-accent', text:'開始' },
  ],
  'ヒストリー': [
    { label: 'パネル', fg:'--history-fg', line:'--history-border', text:'ヒストリー' },
    { label: '行背景', bg:'--history-row-bg', text:'履歴行' },
    { label: '補助表示', fg:'--history-muted-fg', text:'時刻' },
    { label: 'ホバー', bg:'--history-hover-bg', text:'ホバー' },
    { label: '強調', fg:'--history-active-fg', bg:'--history-active-bg', line:'--history-accent', text:'強調' },
  ],
  '注釈': [
    { label: 'パネル', fg:'--annotation-fg', line:'--annotation-border', text:'注釈' },
    { label: 'カード背景', bg:'--annotation-card-bg', text:'カード' },
    { label: '補助表示', fg:'--annotation-muted-fg', text:'補助' },
    { label: 'ホバー', bg:'--annotation-hover-bg', text:'ホバー' },
    { label: '付箋', fg:'--annotation-note-fg', bg:'--annotation-note-bg', text:'付箋' },
    { label: 'ツール/アクセント', line:'--annotation-accent', text:'━━' },
  ],
  '検索': [
    { label: 'パネル', fg:'--search-fg', line:'--search-border', text:'検索' },
    { label: '結果背景', bg:'--search-panel-bg', text:'結果' },
    { label: '補助表示', fg:'--search-muted-fg', text:'補助' },
    { label: 'ホバー', bg:'--search-hover-bg', text:'ホバー' },
    { label: '選択/アクセント', fg:'--search-active-fg', bg:'--search-active-bg', line:'--search-accent', text:'選択' },
  ],
  'バージョン管理': [
    { label: 'パネル', fg:'--version-fg', line:'--version-border', text:'バージョン管理' },
    { label: '行背景', bg:'--version-row-bg', text:'バージョン' },
    { label: '補助表示', fg:'--version-muted-fg', text:'時刻' },
    { label: 'ホバー', bg:'--version-hover-bg', text:'ホバー' },
    { label: '保存/復元', fg:'--version-active-fg', bg:'--version-active-bg', line:'--version-accent', text:'保存' },
  ],
  '補助パネル': [
    { label: 'フォルダツリー', fg:'--outliner-fg', bg:'--outliner-bg', line:'--outliner-border', text:'フォルダツリー' },
    { label: 'フォルダツリー項目', fg:'--outliner-item-fg', bg:'--outliner-item-bg', text:'項目' },
    { label: 'ビューワー', fg:'--preview-fg', line:'--preview-border', text:'ビューワー' },
    { label: 'ビューワーカード', bg:'--preview-card-bg', text:'カード' },
    { label: 'オプション', fg:'--detail-fg', line:'--detail-border', text:'オプション' },
    { label: 'チャット本文', fg:'--chat-fg', line:'--chat-border', text:'チャット' },
    { label: 'チャット入力', fg:'--chat-input-fg', bg:'--chat-input-bg', text:'入力欄' },
    { label: 'タイマー', fg:'--timer-fg', line:'--timer-border', text:'タイマー' },
    { label: 'ヒストリー', fg:'--history-fg', line:'--history-border', text:'ヒストリー' },
    { label: '注釈', fg:'--annotation-fg', line:'--annotation-border', text:'注釈' },
    { label: '検索', fg:'--search-fg', line:'--search-border', text:'検索' },
    { label: 'バージョン管理', fg:'--version-fg', line:'--version-border', text:'バージョン管理' },
    { label: '補助パネルアクセント', line:'--preview-accent', text:'━━' },
  ],
};

const CS_TAB_NAMES = Object.keys(UI_STYLE_SECTIONS);
const COMMON_INTEGRATED_APP_STYLE_KEYS = new Set([
  ...COMMON_THEME_SURFACE_STYLE_KEYS,
  ...COMMON_THEME_SCROLLBAR_STYLE_KEYS,
  '--fv-item-border', '--fv-item-hover-bg', '--fv-item-selected-fg', '--fv-item-selected-bg',
  '--page-link-fg', '--page-link-bold', '--page-link-italic',
  '--page-hr-color', '--page-quote-border',
  '--page-selection-fg', '--page-selection-color', '--page-caret-color', '--page-caret-width',
  '--sn2-border-color', '--sn2-border-width', '--sn2-spread-border-color', '--sn2-spread-border-width',
  '--sn2-hover-bg', '--sn2-selection-fg', '--sn2-selection-color', '--sn2-caret-color', '--sn2-caret-width',
  '--db-border-color', '--db-selection-fg', '--db-selection-color',
  '--db-active-color', '--db-active-width', '--db-grid-border', '--db-show-grid',
  '--bd-selection-fg', '--bd-selection-color', '--bd-caret-color', '--bd-caret-width',
]);

function _styleBaseKeyForExtras(d) {
  if (!d || d.line || /カーソル|選択|背景|ボーダー|枠線|罫線|区切り|引用線/.test(d.label || '')) return '';
  const source = d.base || d.fg || d.bg || d.font || '';
  if (!source || !String(source).startsWith('--')) return '';
  const base = String(source)
    .replace(/-(?:fg|color|bg|font|bold|italic|font-size)$/i, '')
    .replace(/-text$/i, '-text');
  return base === '--' || !/^--[a-z0-9]/i.test(base) ? '' : base;
}

function _extraStyleKeys(d) {
  const base = _styleBaseKeyForExtras(d);
  if (!base) return [];
  return [
    d.bg || `${base}-bg`,
    d.font || `${base}-font`,
    d.fontSize || `${base}-font-size`,
    d.stroke || `${base}-stroke-color`,
    d.strokeWidth || `${base}-stroke-width`,
    d.leftAccent || `${base}-left-accent`,
    d.underline || `${base}-underline`,
    d.accent || `${base}-accent-color`,
  ].filter(Boolean);
}

function normalizeStyleSettingValue(key, value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return raw;
  const name = String(key || '');
  if (/-left-accent$/i.test(name) && raw === '3px') return THEME_STYLE_LEFT_ACCENT_WIDTH;
  if (/-underline$/i.test(name) && raw.toLowerCase() === 'underline') return THEME_STYLE_UNDERLINE_WIDTH;
  return raw;
}

function settingsThemeStyleSettingTargetKeys(key) {
  const target = String(key || '').trim();
  if (target === SETTINGS_THEME_COMMON_BODY_BG_KEY) {
    return [SETTINGS_THEME_COMMON_BODY_BG_KEY, ...SETTINGS_THEME_COMMON_BODY_BG_LINKED_KEYS];
  }
  if (target === '--ui-accent') {
    return ['--ui-accent', '--accent'];
  }
  return target ? [target] : [];
}

function applySettingsThemeStyleSetting(key, value, options = {}) {
  const targetKeys = settingsThemeStyleSettingTargetKeys(key);
  const raw = String(value == null ? '' : value).trim();
  targetKeys.forEach(targetKey => {
    const next = normalizeStyleSettingValue(targetKey, raw);
    if (next) document.documentElement.style.setProperty(targetKey, next);
    else document.documentElement.style.removeProperty(targetKey);
  });
  if (targetKeys.includes('--bd-bg') && typeof _bdApplyCurrentBoardBackground === 'function') {
    _bdApplyCurrentBoardBackground();
  }
  if (options.markDirty !== false && typeof _settingsThemeMarkDirty === 'function') {
    _settingsThemeMarkDirty();
  }
  return raw;
}

function getAllStyleKeys() {
  const keys = new Set();
  for (const defs of Object.values(UI_STYLE_SECTIONS)) {
    defs.forEach(d => {
      if(d.fg) keys.add(d.fg); if(d.bg) keys.add(d.bg);
      if(d.bold) keys.add(d.bold); if(d.italic) keys.add(d.italic);
      if(d.line) keys.add(d.line); if(d.toggle) keys.add(d.toggle);
      if(d.width) keys.add(d.width); if(d.font) keys.add(d.font);
      if(d.fontSize) keys.add(d.fontSize);
      if(Array.isArray(d.numbers)) d.numbers.forEach(n => { if(n?.key) keys.add(n.key); });
      _extraStyleKeys(d).forEach(k => keys.add(k));
    });
  }
  keys.add('--page-margin-x');
  keys.add('--page-content-max-width');
  // ボード固有設定（UI_STYLE_SECTIONS では表現しきれないキー）
  keys.add('--bd-shadow');
  keys.add('--bd-bg-image');
  keys.add('--bd-bg-image-fit');
  keys.add('--bd-bg-image-scale');
  keys.add('--bd-auto-align');
  return [...keys];
}

function loadColorSettings() {
  try {
    const saved = localStorage.getItem(COLOR_SETTINGS_KEY);
    let appliedThemeColorSet = false;
    const themeColorSetKey = typeof MeldexThemeManager !== 'undefined' ? MeldexThemeManager.THEME_COLOR_SET_KEY : '';
    const osAccentKey = typeof MeldexThemeManager !== 'undefined' ? MeldexThemeManager.THEME_OS_ACCENT_KEY : '';
    const storedThemeColorSet = themeColorSetKey ? localStorage.getItem(themeColorSetKey) : null;
    const storedOsAccent = osAccentKey ? localStorage.getItem(osAccentKey) : null;
    const storedThemeColorSlots = localStorage.getItem(THEME_COLOR_SLOT_SETTINGS_KEY);
    const storedThemeColorExtraSlots = localStorage.getItem(THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY);
    const storedStandardPaletteAdjust = localStorage.getItem(STANDARD_PALETTE_ADJUST_STORAGE_KEY);
    if (saved) {
      const s = JSON.parse(saved);
      for (const [k, v] of Object.entries(s)) {
        if (COMMON_INTEGRATED_APP_STYLE_KEYS.has(k)) continue;
        if (k.startsWith('--')) applySettingsThemeStyleSetting(k, normalizeStyleSettingValue(k, v), { markDirty: false });
      }
      if (!storedThemeColorSet && Object.prototype.hasOwnProperty.call(s, THEME_COLOR_SET_THEME_KEY) && typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.setThemeColorSet === 'function') {
        _runSettingsWithoutLocalStorageHistory(() => {
          MeldexThemeManager.setThemeColorSet(s[THEME_COLOR_SET_THEME_KEY], { save: true });
        });
        appliedThemeColorSet = true;
      }
      if (!storedThemeColorSlots && Object.prototype.hasOwnProperty.call(s, THEME_COLOR_SLOT_SETTINGS_THEME_KEY)) {
        saveThemeColorSlotSettings(s[THEME_COLOR_SLOT_SETTINGS_THEME_KEY], { skipHistory: true });
      }
      if (!storedThemeColorExtraSlots && Object.prototype.hasOwnProperty.call(s, THEME_COLOR_EXTRA_SLOT_SETTINGS_THEME_KEY)) {
        saveThemeColorExtraSlotSettings(s[THEME_COLOR_EXTRA_SLOT_SETTINGS_THEME_KEY], { skipHistory: true });
      }
      if (!storedStandardPaletteAdjust && Object.prototype.hasOwnProperty.call(s, STANDARD_PALETTE_THEME_KEY) && typeof setStandardPaletteAdjust === 'function') {
        _runSettingsWithoutLocalStorageHistory(() => {
          setStandardPaletteAdjust(s[STANDARD_PALETTE_THEME_KEY]);
        });
      }
      if (storedOsAccent == null && Object.prototype.hasOwnProperty.call(s, THEME_OS_ACCENT_THEME_KEY) && typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.setUseOsAccentColor === 'function') {
        MeldexThemeManager.setUseOsAccentColor(!!s[THEME_OS_ACCENT_THEME_KEY], { skipHistory: true });
      }
    }
    if (storedOsAccent != null && typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.setUseOsAccentColor === 'function') {
      MeldexThemeManager.setUseOsAccentColor(storedOsAccent === '1', { skipHistory: true });
    }
    if (!appliedThemeColorSet && typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.setThemeColorSet === 'function') {
      if (storedThemeColorSet) MeldexThemeManager.setThemeColorSet(JSON.parse(storedThemeColorSet), { save: true, skipHistory: true });
    }
    if (localStorage.getItem(THEME_COLOR_SLOT_SETTINGS_KEY) && typeof _syncThemeColorSetFromPalette === 'function') _syncThemeColorSetFromPalette();
  } catch {}
}

function saveColorSettings() {
  const s = {};
  for (const k of getAllStyleKeys()) {
    if (COMMON_INTEGRATED_APP_STYLE_KEYS.has(k)) continue;
    const v = document.documentElement.style.getPropertyValue(k);
    if (v) s[k] = v;
  }
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getThemeColorSet === 'function') {
    const useOsAccent = typeof MeldexThemeManager.getUseOsAccentColor === 'function'
      ? MeldexThemeManager.getUseOsAccentColor()
      : false;
    if (!useOsAccent) s[THEME_COLOR_SET_THEME_KEY] = MeldexThemeManager.getThemeColorSet();
    s[THEME_OS_ACCENT_THEME_KEY] = useOsAccent;
  }
  const colorSlots = getThemeColorSlotSettings();
  if (colorSlots.some(Boolean)) s[THEME_COLOR_SLOT_SETTINGS_THEME_KEY] = colorSlots;
  const extraSlots = getThemeColorExtraSlotSettings();
  if (Object.keys(extraSlots).length) s[THEME_COLOR_EXTRA_SLOT_SETTINGS_THEME_KEY] = extraSlots;
  if (typeof getStandardPaletteAdjust === 'function') s[STANDARD_PALETTE_THEME_KEY] = getStandardPaletteAdjust();
  try { localStorage.setItem(COLOR_SETTINGS_KEY, JSON.stringify(s)); } catch {}
  // テーマの明暗に応じてcolor-schemeを切替（スピナー等のブラウザUIに影響）
  updateColorScheme();
}

function updateColorScheme() {
  const bg = getCssVar('--bg') || '#1e1e1e';
  const r = parseInt(bg.slice(1,3),16)||0, g = parseInt(bg.slice(3,5),16)||0, b = parseInt(bg.slice(5,7),16)||0;
  const isLight = (r*0.299 + g*0.587 + b*0.114) > 128;
  document.documentElement.classList.toggle('light-theme', isLight);
}

// テーマの明暗に応じたキャラ色パレットを生成
function getRelativeLuminance(hex) {
  if (!hex || !hex.startsWith('#')) return 0;
  const r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
  const srgb = c => c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4);
  return 0.2126*srgb(r) + 0.7152*srgb(g) + 0.0722*srgb(b);
}

function generateThemedPalette(isDark) {
  // 1段目: 白→黒のグレー段階（7色、透明色の後に並ぶ）
  const grays = ['#ffffff','#e6e6e6','#b3b3b3','#808080','#4d4d4d','#1a1a1a','#000000'];
  // 虹色の基本色相（赤→紫、8色）
  const hues = [0, 25, 50, 100, 160, 210, 260, 300];
  const colors = [...grays], bg = [];
  const rows = isDark
    ? [{s:40,l:65},{s:45,l:45},{s:40,l:35}]  // ダーク系: 明→中→暗
    : [{s:50,l:55},{s:55,l:45},{s:50,l:35}];  // ライト系: 中→やや暗→暗
  const bgRows = isDark
    ? [{s:20,l:28},{s:20,l:22},{s:18,l:18}]
    : [{s:15,l:80},{s:15,l:70},{s:12,l:60}];

  for (const row of rows) {
    for (const h of hues) {
      colors.push(hslToHex(h, row.s, row.l));
    }
  }
  for (const row of bgRows) {
    for (const h of hues) {
      bg.push(hslToHex(h, row.s, row.l));
    }
  }
  return { colors, bg };
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1-l);
  const f = n => { const k = (n + h/30) % 12; return l - a * Math.max(-1, Math.min(k-3, 9-k, 1)); };
  return '#' + [f(0),f(8),f(4)].map(v => Math.round(v*255).toString(16).padStart(2,'0')).join('');
}

// プレビューを実際の見出しサイズで表示するためのマップ（ノートタブ用）
const STYLE_PREVIEW_FONT_SIZES = {
  'タイトル': 28,
  '見出し H1': 24,
  '見出し H2': 20,
  '見出し H3': 16,
  '見出し H4': 16,
  '見出し H5': 14,
  '見出し H6': 13,
};

const SETTINGS_THEME_PREVIEW_AUTO_VAR_TARGETS = Object.freeze({
  '--fv-item-fg': { targetId: 'folder-panel-folder', stateId: 'normal', index: 0 },
  '--fv-item-bg': { targetId: 'folder-panel-folder', stateId: 'normal', index: 0 },
  '--fv-item-border': { targetId: 'folder-panel-folder', stateId: 'normal', index: 0 },
  '--fv-item-hover-fg': { targetId: 'folder-panel-folder', stateId: 'hover', index: 0 },
  '--fv-item-hover-bg': { targetId: 'folder-panel-folder', stateId: 'hover', index: 0 },
  '--fv-item-hover-border': { targetId: 'folder-panel-folder', stateId: 'hover', index: 0 },
  '--fv-item-selected-fg': { targetId: 'folder-panel-folder', stateId: 'selected', index: 0 },
  '--fv-item-selected-bg': { targetId: 'folder-panel-folder', stateId: 'selected', index: 0 },
  '--fv-item-selected-border': { targetId: 'folder-panel-folder', stateId: 'selected', index: 0 },
  '--outliner-item-fg': { targetId: 'folder-tree-folder', stateId: 'normal', index: 0 },
  '--outliner-item-bg': { targetId: 'folder-tree-folder', stateId: 'normal', index: 0 },
  '--outliner-item-hover-fg': { targetId: 'folder-tree-folder', stateId: 'hover', index: 0 },
  '--outliner-item-hover-bg': { targetId: 'folder-tree-folder', stateId: 'hover', index: 0 },
  '--outliner-item-selected-fg': { targetId: 'folder-tree-folder', stateId: 'selected', index: 0 },
  '--outliner-item-selected-bg': { targetId: 'folder-tree-folder', stateId: 'selected', index: 0 },
  '--outliner-accent': { targetId: 'folder-tree-folder', stateId: 'selected', index: 0 },
});

function _settingsThemePreviewRowKeys(d) {
  return [d?.fg, d?.bg, d?.line]
    .map(key => String(key || '').trim())
    .filter(Boolean);
}

function _settingsThemePreviewAutoTargetFromKnownVars(keys) {
  for (const key of keys || []) {
    const hit = SETTINGS_THEME_PREVIEW_AUTO_VAR_TARGETS[key];
    if (hit) return { ...hit };
  }
  return null;
}

function _settingsThemePreviewAutoTargetFromThemeVars(keys) {
  if (!keys?.length || typeof MeldexThemeManager === 'undefined' || !Array.isArray(MeldexThemeManager.THEME_UI_TARGETS)) {
    return null;
  }
  const rowKeys = new Set(keys);
  for (const target of MeldexThemeManager.THEME_UI_TARGETS) {
    if (!target?.vars) continue;
    for (const stateId of ['normal', 'hover', 'selected']) {
      const vars = target.vars[stateId] || {};
      const stateKeys = Object.values(vars).flatMap(value => Array.isArray(value) ? value : [value]).filter(Boolean);
      if (stateKeys.some(key => rowKeys.has(key))) {
        return { targetId: target.id, stateId, index: 0 };
      }
    }
  }
  return null;
}

function _settingsThemePreviewAutoTargetForRow(d) {
  const label = String(d?.label || '').trim();
  const heading = label.match(/^見出し H([1-6])$/);
  if (heading) return { targetId: 'note-heading', stateId: 'normal', index: parseInt(heading[1], 10) - 1 };
  if (/目次/.test(label)) return { targetId: 'note-toc-item', stateId: 'normal', index: 0 };
  const keys = _settingsThemePreviewRowKeys(d);
  return _settingsThemePreviewAutoTargetFromKnownVars(keys)
    || _settingsThemePreviewAutoTargetFromThemeVars(keys);
}

function _settingsThemePreviewAutoMixCss(toneColor, amount, slotIndex, fallbackColor) {
  const percent = Math.max(0, Math.min(100, parseInt(amount ?? 30, 10) || 0));
  return `color-mix(in srgb, var(--theme-palette-${slotIndex}, ${fallbackColor}) ${100 - percent}%, ${toneColor} ${percent}%)`;
}

function _settingsThemePreviewAutoColor(value, sequentialIndex) {
  const normalized = String(value == null ? 'none' : value).trim();
  if (!normalized || normalized === 'none') return '';
  const colors = getCurrentThemeColorSet();
  const paletteLength = Math.max(1, colors.length || 0);
  const seqIndex = Math.max(0, parseInt(sequentialIndex, 10) || 0) % paletteLength;
  const seqFallback = colors[seqIndex] || colors[0] || '#ef4444';
  if (normalized === 'auto') return `var(--theme-palette-${seqIndex}, ${seqFallback})`;
  if (normalized === 'auto-light') return _settingsThemePreviewAutoMixCss('white', _themeUiAutoTone()?.light, seqIndex, seqFallback);
  if (normalized === 'auto-dark') return _settingsThemePreviewAutoMixCss('black', _themeUiAutoTone()?.dark, seqIndex, seqFallback);
  if (normalized === 'os-accent') return 'var(--theme-os-accent, AccentColor)';
  const custom = _themeUiCustomColor(normalized);
  if (custom) return custom;
  const paletteIndex = parseInt(normalized, 10);
  if (Number.isInteger(paletteIndex) && paletteIndex >= 0) {
    const fallback = colors[paletteIndex % paletteLength] || seqFallback;
    return `var(--theme-palette-${paletteIndex}, ${fallback})`;
  }
  return '';
}

function _settingsThemePreviewAutoStyleForRow(d) {
  const target = _settingsThemePreviewAutoTargetForRow(d);
  if (!target || typeof MeldexThemeManager === 'undefined' || typeof MeldexThemeManager.getThemeUiApplications !== 'function') {
    return {};
  }
  const stateId = target.stateId || 'normal';
  const state = MeldexThemeManager.getThemeUiApplications()?.[target.targetId]?.[stateId] || {};
  return {
    fg: _settingsThemePreviewAutoColor(state.fg, target.index),
    bg: _settingsThemePreviewAutoColor(state.bg, target.index),
    underline: _settingsThemePreviewAutoColor(state.underline, target.index),
  };
}

function _settingsThemePreviewExtraKey(d, prop, suffix) {
  if (d?.[prop]) return d[prop];
  const base = _styleBaseKeyForExtras(d);
  return base ? `${base}${suffix}` : '';
}

function _settingsThemePreviewActiveFlag(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  if (/^0(?:\.0+)?(?:px|em|rem|%)?$/.test(v)) return false;
  return !!v && v !== '0' && v !== 'none' && v !== 'normal' && v !== 'false';
}

function _settingsThemePreviewStyle(d) {
  if (Array.isArray(d?.numbers) && d.numbers.length) {
    return /選択背景/.test(d.label || '')
      ? 'background:var(--ui-inner-tab-active-bg);color:var(--ui-inner-tab-active-fg);'
      : 'background:var(--ui-inner-tab-bg);color:var(--ui-inner-tab-fg);';
  }
  const autoStyle = _settingsThemePreviewAutoStyleForRow(d);
  const pvBg = autoStyle.bg || (d.previewBg ? `var(${d.previewBg})` : (d.bg ? `var(${d.bg})` : 'var(--bg)'));
  const pvFg = autoStyle.fg || (d.fg ? `var(${d.fg})` : d.line ? `var(${d.line})` : 'var(--fg)');
  const strokeKey = _settingsThemePreviewExtraKey(d, 'stroke', '-stroke-color');
  const strokeWidthKey = _settingsThemePreviewExtraKey(d, 'strokeWidth', '-stroke-width');
  const leftAccentKey = _settingsThemePreviewExtraKey(d, 'leftAccent', '-left-accent');
  const underlineKey = _settingsThemePreviewExtraKey(d, 'underline', '-underline');
  const accentKey = _settingsThemePreviewExtraKey(d, 'accent', '-accent-color');
  const hasLeftAccent = leftAccentKey && _settingsThemePreviewActiveFlag(getCssVar(leftAccentKey));
  const hasUnderline = underlineKey && _settingsThemePreviewActiveFlag(getCssVar(underlineKey));
  const lineWidth = d.width ? `var(${d.width}, 3px)` : '3px';
  const autoAccent = autoStyle.underline || '';
  const fallbackAccent = d.line ? `var(${d.line})` : pvFg;
  const accent = accentKey ? `var(${accentKey}, ${autoAccent || fallbackAccent})` : (autoAccent || fallbackAccent);
  const shadows = [];
  const parts = [
    `background:${pvBg}`,
    `color:${pvFg}`,
  ];
  if (d.bold) parts.push(`font-weight:var(${d.bold})`);
  if (d.italic) parts.push(`font-style:var(${d.italic})`);
  if (autoAccent && d.line) {
    parts.push(`border-bottom:${lineWidth} solid ${autoAccent}`);
  } else if (d.line) {
    parts.push(`border-bottom:${lineWidth} solid var(${d.line})`);
  }
  if (d.font) parts.push(`font-family:var(${d.font}, inherit)`);
  if (strokeKey || strokeWidthKey) {
    parts.push(
      `-webkit-text-stroke-color:${strokeKey ? `var(${strokeKey})` : 'transparent'}`,
      `-webkit-text-stroke-width:${strokeWidthKey ? `var(${strokeWidthKey}, 0px)` : '0px'}`,
      'paint-order:stroke fill'
    );
  }
  if (hasLeftAccent) {
    shadows.push(`-${THEME_STYLE_LEFT_ACCENT_WIDTH} 0 0 0 ${accent}`);
    parts.push(`padding-left:${THEME_STYLE_LEFT_ACCENT_WIDTH}`);
  }
  if (hasUnderline) {
    parts.push(`border-bottom:${THEME_STYLE_UNDERLINE_WIDTH} solid ${accent}`);
  }
  if (shadows.length) parts.push(`box-shadow:${shadows.join(',')}`);
  const previewSize = STYLE_PREVIEW_FONT_SIZES[d.label];
  if (d.fontSize) parts.push(`font-size:var(${d.fontSize}${previewSize ? `, ${previewSize}px` : ''})`, 'line-height:1.3');
  else if (previewSize) parts.push(`font-size:${previewSize}px`, 'line-height:1.3');
  return `${parts.join(';')};`;
}

function _settingsThemeStylePreviewPanels(root) {
  const base = root || document;
  const direct = base?.closest?.('[data-settings-theme-style-panel]');
  if (direct) return [direct];
  const panels = Array.from(base?.querySelectorAll?.('[data-settings-theme-style-panel]') || []);
  const rendered = panels.filter(panel => panel.dataset?.settingsThemeStyleRendered !== '0');
  if (rendered.length) return rendered;
  const visible = panels.filter(panel => !panel.hidden);
  if (visible.length) return visible;
  return base?.matches?.('[data-settings-theme-style-panel]') ? [base] : [];
}

function _refreshSettingsThemeStylePreviewPanel(panel) {
  if (!panel || !panel.querySelectorAll) return;
  const panelName = panel.dataset?.settingsThemeStylePanel || '';
  const rawDefs = UI_STYLE_SECTIONS?.[panelName] || [];
  const defs = typeof _filterCommonDuplicates === 'function'
    ? _filterCommonDuplicates(rawDefs, panelName)
    : rawDefs;
  panel.querySelectorAll('.cs-row-preview[data-style-preview-label]').forEach(preview => {
    const label = preview.dataset.stylePreviewLabel || '';
    const def = defs.find(item => String(item?.label || '') === label);
    if (def) preview.setAttribute('style', _settingsThemePreviewStyle(def));
  });
}

function refreshSettingsThemeStylePreviews(root) {
  _settingsThemeStylePreviewPanels(root).forEach(_refreshSettingsThemeStylePreviewPanel);
}

function _bindSettingsThemeStylePreviewRefreshEvents() {
  if (typeof window === 'undefined' || window.__settingsThemeStylePreviewRefreshBound) return;
  window.__settingsThemeStylePreviewRefreshBound = true;
  const refreshOpenEditor = () => {
    const editor = document.getElementById('settings-theme-editor');
    if (editor && typeof refreshSettingsThemeStylePreviews === 'function') {
      refreshSettingsThemeStylePreviews(editor);
    }
  };
  window.addEventListener('meldex-theme-ui-applications-change', refreshOpenEditor);
  window.addEventListener('meldex-theme-ui-auto-tone-change', refreshOpenEditor);
  window.addEventListener('meldex-theme-color-set-change', refreshOpenEditor);
  window.addEventListener('meldex-theme-change', refreshOpenEditor);
}

_bindSettingsThemeStylePreviewRefreshEvents();

function _settingsThemeE2eId(...parts) {
  return parts
    .map(part => String(part == null ? '' : part).trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('-');
}

function _settingsThemeE2eFallbackText(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  const ascii = text.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (ascii) return ascii;
  return Array.from(text).map(ch => ch.charCodeAt(0).toString(16)).join('-');
}

function _settingsThemePreviewE2eId(d) {
  const numberKeys = Array.isArray(d?.numbers) ? d.numbers.map(item => item?.key || '').filter(Boolean).join('_') : '';
  return _settingsThemeE2eId(
    'settings-theme-style-preview',
    d?.fg,
    d?.bg,
    d?.line,
    d?.font,
    d?.bold,
    d?.italic,
    d?.fontSize,
    d?.width,
    numberKeys,
    _settingsThemeE2eFallbackText(d?.label || d?.text)
  );
}

// 行レンダリング（全タブ共通）
function renderStyleRow(d) {
  const fgVal = d.fg ? getCssVar(d.fg) : '';
  const bgVal = d.bg ? getCssVar(d.bg) : '';
  const lineVal = d.line ? getCssVar(d.line) : '';
  const boldVal = d.bold ? getCssVar(d.bold) : '';
  const italicVal = d.italic ? getCssVar(d.italic) : '';
  const isBgOnly = !!(d.bg && !d.fg && !d.bold && !d.italic && !d.font && !d.fontSize && !d.line && !d.width);

  if (Array.isArray(d.numbers) && d.numbers.length) {
    const previewStyle = _settingsThemePreviewStyle(d);
    const controls = d.numbers.map(n => {
      const raw = getCssVar(n.key);
      const m = String(raw || '').match(/-?\d+(?:\.\d+)?/);
      const value = m ? parseFloat(m[0]) : (n.fallback ?? n.value ?? n.min ?? 0);
      const unit = n.unit || '';
      const attrs = `data-number-key="${esc(n.key)}" data-unit="${esc(unit)}" min="${esc(n.min ?? '')}" max="${esc(n.max ?? '')}" step="${esc(n.step ?? 1)}"`;
      const controlId = _settingsThemeE2eId('settings-theme-number', n.key);
      const range = n.slider ? `<input type="range" class="cs-alpha cs-number-range" value="${esc(value)}" ${attrs} data-e2e-id="${esc(controlId + '-range')}" data-oninput="setNumericStyleSetting(this)">` : '';
      return `<div class="cs-row-group cs-row-group--number">
        <span class="cs-row-group-label">${esc(n.label || '')}</span>
        ${range}
        <input type="number" class="cs-width-input cs-number-input" value="${esc(value)}" ${attrs} data-e2e-id="${esc(controlId + '-input')}" data-oninput="setNumericStyleSetting(this)" data-onchange="setNumericStyleSetting(this)">
        <span class="cs-number-unit">${esc(unit)}</span>
      </div>`;
    }).join('');
    const previewId = _settingsThemePreviewE2eId(d);
    return `<div class="cs-row">
      <span class="cs-row-label">${esc(d.label)}</span>
      <span class="cs-row-preview" data-e2e-id="${esc(previewId)}" data-style-preview-label="${esc(d.label || '')}" style="${esc(previewStyle)}">${esc(d.text || d.label || '数値')}</span>
      ${controls}
    </div>`;
  }

  if (isBgOnly) {
    const swatchValue = bgVal || 'transparent';
    return `<div class="cs-row">
      <span class="cs-row-label">${d.label}</span>
      <div class="cs-swatch" style="background:${swatchValue};"
        data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-swatch', d.bg))}" data-key="${d.bg}" data-action="openCsPalette(this,'${d.bg}')"></div>
    </div>`;
  }

  const previewStyle = _settingsThemePreviewStyle(d);

  // 文字スタイル系の行（fg+bold+italic を持つ）はクリックで書式ポップアップを開けるようにする
  const isStyleRow = !!(d.fg && d.bold && d.italic);
  const previewLabelAttr = ` data-style-preview-label="${esc(d.label || '')}"`;
  const previewId = _settingsThemePreviewE2eId(d);
  const previewAttrs = isStyleRow
    ? `${previewLabelAttr} data-e2e-id="${esc(previewId)}" data-style-label="${esc(d.label)}" data-action="openStylePreviewPopup(this)" tabindex="0" role="button" title="クリックで書式設定"`
    : `${previewLabelAttr} data-e2e-id="${esc(previewId)}"`;
  const previewClass = isStyleRow ? 'cs-row-preview cs-row-preview--clickable' : 'cs-row-preview';

  let row = `<div class="cs-row">
    <span class="cs-row-label">${d.label}</span>
    <span class="${previewClass}"${previewAttrs} style="${esc(previewStyle)}">${d.text}</span>`;

  // 線色タイプ
  if (d.line) {
    const hex = lineVal.startsWith('#') ? lineVal : rgbToHex(lineVal);
    row += `<div class="cs-row-group">
      <span class="cs-row-group-label">線色</span>
      <div class="cs-swatch" style="background:${hex};"
        data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-swatch', d.line))}" data-key="${d.line}" data-action="openCsPalette(this,'${d.line}')"></div>
    </div>`;
    if (d.toggle) {
      const isOn = getCssVar(d.toggle) !== d.toggleOff;
      row += `<button class="cs-toggle${isOn?' active':''}" data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-toggle-line', d.toggle))}" data-key="${d.toggle}" data-on="${d.toggleOn}" data-off="${d.toggleOff}" data-action="toggleLineVisibility(this)">表示</button>`;
    }
    if (d.width) {
      const curW = getCssVar(d.width);
      row += `<div class="cs-row-group">
        <span class="cs-row-group-label">太さ</span>
        <input type="number" min="0" max="10" step="1" value="${parseInt(curW)||1}" data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-line-width', d.width))}" data-key="${d.width}" class="cs-width-input"
          data-onchange="document.documentElement.style.setProperty(this.dataset.key, this.value+'px');if(typeof _settingsThemeMarkDirty==='function')_settingsThemeMarkDirty()">px</div>`;
    }
    row += '</div>';
    return row;
  }

  // 文字色スウォッチ
  if (d.fg) {
    const hex = fgVal.startsWith('#') ? fgVal : rgbToHex(fgVal);
    row += `<div class="cs-row-group">
      <span class="cs-row-group-label">${d.fgLabel || '文字'}</span>
      <div class="cs-swatch" style="background:${hex};"
        data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-swatch', d.fg))}" data-key="${d.fg}" data-action="openCsPalette(this,'${d.fg}')"></div>
    </div>`;
  }

  // 太字トグル
  if (d.bold) {
    const isB = boldVal === 'bold';
    row += `<button class="cs-toggle cs-toggle-bold${isB?' active':''}" data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-bold', d.bold))}" data-key="${d.bold}" data-val="bold" data-action="toggleCsStyle(this)">B</button>`;
  }

  // 斜体トグル
  if (d.italic) {
    const isI = italicVal === 'italic';
    row += `<button class="cs-toggle cs-toggle-italic${isI?' active':''}" data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-italic', d.italic))}" data-key="${d.italic}" data-val="italic" data-action="toggleCsStyle(this)">I</button>`;
  }

  if (d.font) {
    const fontVal = getCssVar(d.font);
    row += `<div class="cs-row-group">
      <span class="cs-row-group-label">フォント</span>
      <select class="gb-select gb-select-sm cs-font-select" data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-font', d.font))}" data-key="${d.font}"
        data-onchange="setThemeFontSetting(this.dataset.key, this.value)">
        ${typeof getFontFamilyOptions === 'function' ? getFontFamilyOptions(fontVal) : ''}
      </select>
    </div>`;
  }

  // 背景色スウォッチ
  if (d.bg) {
    if (d.bgType === 'rgba') {
      // スウォッチ + 不透明度スライダー（rgba/transparent対応）
      const { hex: bgHex, alpha: bgAlpha } = parseColorToHexAlpha(bgVal);
      const pct = Math.round(bgAlpha * 100);
      row += `<div class="cs-row-group">
        <span class="cs-row-group-label">背景</span>
        <div class="cs-swatch" style="background:${bgVal};"
          data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-swatch', d.bg))}" data-key="${d.bg}" data-hex="${bgHex}" data-rgba="1" data-action="openCsPaletteRgba(this,'${d.bg}')"></div>
        <input type="range" min="0" max="100" value="${pct}" class="cs-alpha" data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-alpha', d.bg))}" data-key="${d.bg}"
          data-oninput="this.nextElementSibling.textContent=this.value+'%';updateBgFromSwatchAlpha('${d.bg}')">
        <span class="cs-alpha-val">${pct}%</span>
      </div>`;
    } else {
      const hex = bgVal.startsWith('#') ? bgVal : rgbToHex(bgVal);
      row += `<div class="cs-row-group">
      <span class="cs-row-group-label">${d.bgLabel || '背景'}</span>
      <div class="cs-swatch" style="background:${hex};"
          data-e2e-id="${esc(_settingsThemeE2eId('settings-theme-swatch', d.bg))}" data-key="${d.bg}" data-action="openCsPalette(this,'${d.bg}')"></div>
      </div>`;
    }
  }

  row += '</div>';
  return row;
}

function getCurrentThemeColorSet() {
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getThemeColorSet === 'function') {
    return MeldexThemeManager.getThemeColorSet();
  }
  return ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
}

function normalizeThemeColorSlotSettings(raw) {
  const src = Array.isArray(raw) ? raw : (Array.isArray(raw?.slots) ? raw.slots : []);
  const out = [];
  for (let i = 0; i < 8; i += 1) {
    const item = src[i];
    const color = _themeUiNormalizeHexColor(typeof item === 'string' ? item : item?.color);
    out.push(color ? { color, applyAdjust: item?.applyAdjust !== false } : null);
  }
  return out;
}

function getThemeColorSlotSettings() {
  try {
    return normalizeThemeColorSlotSettings(JSON.parse(localStorage.getItem(THEME_COLOR_SLOT_SETTINGS_KEY) || 'null'));
  } catch {
    return normalizeThemeColorSlotSettings(null);
  }
}

function _refreshThemePaletteSettingsAfterHistory() {
  const nextPalette = typeof _syncThemeColorSetFromPalette === 'function'
    ? _syncThemeColorSetFromPalette()
    : getCurrentThemeColorSet();
  const root = document.getElementById('settings-theme-editor') || document;
  if (typeof _settingsThemePaletteMatrixRender === 'function') _settingsThemePaletteMatrixRender(root);
  if (typeof syncThemeColorSetSwatches === 'function') syncThemeColorSetSwatches(root, nextPalette);
  if (typeof refreshSettingsThemeStylePreviews === 'function') refreshSettingsThemeStylePreviews(root);
}

function saveThemeColorSlotSettings(slots, options) {
  const next = normalizeThemeColorSlotSettings(slots);
  const opts = options || {};
  const compact = next.map(slot => slot ? { color: slot.color, applyAdjust: slot.applyAdjust !== false } : null);
  const before = (typeof captureLocalStorageSettings === 'function')
    ? captureLocalStorageSettings([THEME_COLOR_SLOT_SETTINGS_KEY])
    : null;
  try {
    if (compact.some(Boolean)) localStorage.setItem(THEME_COLOR_SLOT_SETTINGS_KEY, JSON.stringify(compact));
    else localStorage.removeItem(THEME_COLOR_SLOT_SETTINGS_KEY);
  } catch {}
  if (before && opts.skipHistory !== true && typeof pushLocalStorageSettingsHistory === 'function') {
    pushLocalStorageSettingsHistory(
      '設定: テーマカラースロット変更',
      before,
      captureLocalStorageSettings([THEME_COLOR_SLOT_SETTINGS_KEY]),
      '',
      _refreshThemePaletteSettingsAfterHistory
    );
  }
  return next;
}

// 拡張スロット: 行1・2・4 (行3は themeColorSlotSettings) の個別色上書き。
// 形式: { "1-1": "#rrggbb", "2-0": "#rrggbb", "4-7": "#rrggbb", ... }
// キー: `${row}-${col}` (row 1/2/4, col 0-7)。行1 col 0 は透明固定のため保存しない。
function normalizeThemeColorExtraSlotSettings(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!/^[124]-[0-7]$/.test(key)) continue;
    if (key === '1-0') continue;
    const color = _themeUiNormalizeHexColor(typeof value === 'string' ? value : value?.color);
    if (color) out[key] = color;
  }
  return out;
}

function getThemeColorExtraSlotSettings() {
  try {
    return normalizeThemeColorExtraSlotSettings(JSON.parse(localStorage.getItem(THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY) || 'null'));
  } catch {
    return {};
  }
}

function saveThemeColorExtraSlotSettings(slots, options) {
  const next = normalizeThemeColorExtraSlotSettings(slots);
  const opts = options || {};
  const before = (typeof captureLocalStorageSettings === 'function')
    ? captureLocalStorageSettings([THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY])
    : null;
  try {
    if (Object.keys(next).length) localStorage.setItem(THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY, JSON.stringify(next));
    else localStorage.removeItem(THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY);
  } catch {}
  if (before && opts.skipHistory !== true && typeof pushLocalStorageSettingsHistory === 'function') {
    pushLocalStorageSettingsHistory(
      '設定: テーマカラー拡張スロット変更',
      before,
      captureLocalStorageSettings([THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY]),
      '',
      _refreshThemePaletteSettingsAfterHistory
    );
  }
  return next;
}

function _getExtraSlotOverride(row, col) {
  const key = `${row}-${col}`;
  if (key === '1-0') return null;
  const slots = getThemeColorExtraSlotSettings();
  return slots[key] || null;
}

function _settingsThemeGeneratedColorSet(adjust) {
  if (typeof getStandardPaletteSwatches === 'function') {
    const swatches = getStandardPaletteSwatches(adjust).filter(swatch => swatch.row === 3).map(swatch => swatch.color);
    if (swatches.length) return swatches.slice(0, 8);
  }
  return getCurrentThemeColorSet().slice(0, 8);
}

function computeThemeColorSetFromSlots(adjust, slots) {
  const fallbackAdjust = typeof getStandardPaletteAdjust === 'function' ? getStandardPaletteAdjust() : null;
  const currentAdjust = typeof normalizeStandardPaletteAdjust === 'function'
    ? normalizeStandardPaletteAdjust(adjust || fallbackAdjust)
    : (adjust || {});
  const generated = _settingsThemeGeneratedColorSet(currentAdjust);
  const slotSettings = normalizeThemeColorSlotSettings(slots || getThemeColorSlotSettings());
  return generated.map((color, index) => {
    const slot = slotSettings[index];
    if (!slot) return color;
    if (slot.applyAdjust === false || typeof adjustStandardPaletteColor !== 'function') return slot.color;
    return adjustStandardPaletteColor(slot.color, currentAdjust);
  });
}

function renderSettingsThemePaletteEditor() {
  const editorId = 'settings-theme-palette-editor';
  const rowsHtml = `<div class="cs-theme-palette-matrix" data-theme-palette-matrix></div>`;
  const slider = (key, label, min, max) => `
    <label class="cs-theme-palette-slider-row" data-theme-palette-slider-row="${key}">
      <span class="cs-theme-palette-slider-label">${esc(label)}</span>
      <input type="range" min="${min}" max="${max}" step="1" data-e2e-id="settings-theme-palette-slider-${key}" data-theme-palette-slider="${key}">
      <input type="number" min="${min}" max="${max}" step="1" class="gb-input-sm cs-theme-palette-slider-num" data-e2e-id="settings-theme-palette-slider-num-${key}" data-theme-palette-slider-num="${key}">
    </label>`;
  const osAccent = typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getUseOsAccentColor === 'function'
    ? MeldexThemeManager.getUseOsAccentColor()
    : false;
  const actionsHtml = `<div class="cs-theme-palette-slider-actions">
    <button type="button" class="cs-toggle${osAccent ? ' active' : ''}" data-e2e-id="settings-theme-palette-os-accent-toggle" data-theme-os-accent-toggle title="リンク色・スライダー・カーソルなどの基本アクセント色をOSのアクセントカラーに合わせる">OSアクセント</button>
    <button type="button" class="cs-toggle" data-e2e-id="settings-theme-palette-reset" data-theme-palette-reset title="色相・彩度・明度・明暗比の調整値をリセット">調整をリセット</button>
  </div>`;
  const slidersHtml = `<div class="cs-theme-palette-sliders">
    ${slider('hueStart', '色相 始', '-360', '360')}
    ${slider('hueEnd', '色相 終', '-360', '360')}
    ${slider('saturation', '彩度', '0', '100')}
    ${slider('brightness', '明度', '-100', '100')}
    ${slider('contrast', '明暗比', '0', '100')}
    ${actionsHtml}
  </div>`;
  return `<div id="${editorId}" class="cs-theme-palette-editor">
    ${rowsHtml}
    ${slidersHtml}
  </div>`;
}

function renderThemeColorSetEditor(colorsOverride, options = {}) {
  const hasScopedOsAccent = Object.prototype.hasOwnProperty.call(options || {}, 'osAccent');
  const osAccent = hasScopedOsAccent
    ? !!options.osAccent
    : (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getUseOsAccentColor === 'function'
    ? MeldexThemeManager.getUseOsAccentColor()
    : false);
  const osAccentColor = Object.prototype.hasOwnProperty.call(options || {}, 'osAccentColor')
    ? options.osAccentColor
    : (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getOsAccentColor === 'function'
    ? MeldexThemeManager.getOsAccentColor()
    : 'var(--theme-os-accent, AccentColor)');
  const osAccentSwatchColor = osAccentColor || (Array.isArray(colorsOverride) && colorsOverride[0]) || 'var(--theme-os-accent, AccentColor)';
  const osAccentSwatchTitle = osAccentColor ? `OSアクセント: ${osAccentColor}` : 'OSアクセント: 取得待ち';
  const colors = osAccent
    ? [osAccentSwatchColor]
    : (Array.isArray(colorsOverride) ? colorsOverride : getCurrentThemeColorSet());
  const swatches = osAccent
    ? `<button type="button" class="cs-swatch cs-theme-color-swatch cs-theme-color-swatch--os" data-e2e-id="settings-theme-color-os-swatch" data-theme-os-accent-swatch title="${esc(osAccentSwatchTitle)}" style="background:${esc(colors[0])};"></button>`
    : colors.map((color, index) => (
      `<button type="button" class="cs-swatch cs-theme-color-swatch" data-e2e-id="settings-theme-color-slot-${index}" data-theme-color-slot="${index}" title="テーマカラー ${index + 1}" style="background:${esc(color)};"></button>`
    )).join('');
  const label = options.hideLabel ? '' : '<span class="cs-row-label">テーマカラー</span>';
  return `<div class="cs-row cs-theme-color-set-row">
    ${label}
    <div class="cs-row-group cs-theme-color-set">${swatches}</div>
    <button type="button" class="cs-toggle${osAccent ? ' active' : ''}" data-e2e-id="settings-theme-color-os-accent-toggle" data-theme-os-accent-toggle title="リンク色・スライダー・カーソルなどの基本アクセント色をOSのアクセントカラーに合わせる">OSアクセント</button>
    ${osAccent ? '' : '<button type="button" class="cs-toggle" data-e2e-id="settings-theme-color-reset" data-theme-color-reset>既定</button>'}
  </div>`;
}

function _themeUiNormalizeHexColor(color) {
  const raw = String(color == null ? '' : color).trim();
  const short = raw.match(/^#([0-9a-f]{3})$/i);
  if (short) return '#' + short[1].split('').map(ch => ch + ch).join('').toLowerCase();
  const full = raw.match(/^#([0-9a-f]{6})$/i);
  return full ? '#' + full[1].toLowerCase() : '';
}

function _themeUiCustomValue(color) {
  const hex = _themeUiNormalizeHexColor(color);
  return hex ? THEME_UI_CUSTOM_COLOR_PREFIX + hex : '';
}

function _themeUiCustomColor(value) {
  const raw = String(value == null ? '' : value).trim();
  if (raw.startsWith(THEME_UI_CUSTOM_COLOR_PREFIX)) return _themeUiNormalizeHexColor(raw.slice(THEME_UI_CUSTOM_COLOR_PREFIX.length));
  return _themeUiNormalizeHexColor(raw);
}

function _themeUiSelectOptions(value) {
  const items = _themeUiOptionItems(value);
  const current = String(value || 'none');
  return items.map(item => {
    if (item.group) return `<option value="" disabled>${esc(item.label)}</option>`;
    const customAttr = item.custom ? ' data-theme-ui-custom-option="1"' : '';
    return `<option value="${esc(item.value)}"${current === String(item.value) ? ' selected' : ''}${customAttr}>${esc(item.label)}</option>`;
  }).join('');
}

function _themeUiAutoTone() {
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getThemeUiAutoTone === 'function') {
    return MeldexThemeManager.getThemeUiAutoTone();
  }
  return { light: 30, dark: 30 };
}

function _themeUiAutoToneVars(tone) {
  const light = Math.max(0, Math.min(100, parseInt(tone?.light ?? 30, 10) || 0));
  const dark = Math.max(0, Math.min(100, parseInt(tone?.dark ?? 30, 10) || 0));
  return `--theme-ui-auto-light-base:${100 - light}%;--theme-ui-auto-light-percent:${light}%;--theme-ui-auto-dark-base:${100 - dark}%;--theme-ui-auto-dark-percent:${dark}%;`;
}

function _themeUiAutoSwatch(kind) {
  if (kind === 'light') return 'color-mix(in srgb, var(--theme-slot-color,var(--accent)) var(--theme-ui-auto-light-base,70%), white var(--theme-ui-auto-light-percent,30%))';
  if (kind === 'dark') return 'color-mix(in srgb, var(--theme-slot-color,var(--accent)) var(--theme-ui-auto-dark-base,70%), black var(--theme-ui-auto-dark-percent,30%))';
  return 'var(--theme-slot-color,var(--accent))';
}

function _themeUiOptionItems(value) {
  const colors = getCurrentThemeColorSet();
  const osAccent = typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getUseOsAccentColor === 'function'
    ? MeldexThemeManager.getUseOsAccentColor()
    : false;
  const customColor = _themeUiCustomColor(value) || '#ef4444';
  const items = [
    { value: 'none', label: 'なし', swatch: '' },
    { value: 'auto', label: '自動', swatch: _themeUiAutoSwatch('auto') },
    { value: 'auto-light', label: '自動（明）', swatch: _themeUiAutoSwatch('light') },
    { value: 'auto-dark', label: '自動（暗）', swatch: _themeUiAutoSwatch('dark') },
    { value: 'os-accent', label: 'OSアクセント', swatch: 'var(--theme-os-accent, AccentColor)', title: 'OSのアクセントカラー' },
    { value: _themeUiCustomValue(customColor), label: '指定カラー', swatch: customColor, title: 'カラーパレットから指定', custom: true },
  ];
  if (osAccent) return items;
  items.push({ group: true, label: 'テーマカラー' });
  colors.forEach((color, index) => {
    items.push({
      value: String(index),
      label: `テーマ${index + 1}`,
      swatch: `var(--theme-palette-${index}, ${color})`,
      title: color,
    });
  });
  return items;
}

function _themeUiOptionForValue(value) {
  const current = String(value || 'none');
  const items = _themeUiOptionItems(current);
  const osAccent = typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getUseOsAccentColor === 'function'
    ? MeldexThemeManager.getUseOsAccentColor()
    : false;
  if (osAccent && /^\d+$/.test(current)) return items.find(item => !item.group && item.value === 'os-accent') || items.find(item => !item.group);
  return items.find(item => !item.group && item.value === current) || items.find(item => !item.group);
}

function _themeUiSwatchHtml(item) {
  if (!item?.swatch) return '<span class="cs-theme-ui-option-swatch cs-theme-ui-option-swatch--none"></span>';
  return `<span class="cs-theme-ui-option-swatch" style="background:${esc(item.swatch)};"></span>`;
}

function _themeUiPickerContent(value) {
  const item = _themeUiOptionForValue(value);
  return `<span class="cs-theme-ui-picker-main">${_themeUiSwatchHtml(item)}<span class="cs-theme-ui-picker-label">${esc(item.label)}</span></span><span class="cs-theme-ui-picker-arrow">▼</span>`;
}

function _themeUiE2eId(...parts) {
  return parts
    .map(part => String(part == null ? '' : part).trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('-');
}

function _renderThemeUiPicker(target, state, prop, value) {
  const propLabel = target?.propLabels?.[prop.id] || prop.label;
  const stateLabel = target?.stateLabels?.[state.id] || state.label;
  const label = `${target.label} ${stateLabel} ${propLabel}`;
  const baseId = _themeUiE2eId(target.id, state.id, prop.id);
  const items = _themeUiOptionItems(value);
  const options = items.map(item => item.group
    ? `<div class="cs-theme-ui-option-group" role="presentation">${esc(item.label)}</div>`
    : `<button type="button" class="cs-theme-ui-option" role="option" data-e2e-id="${esc(_themeUiE2eId('theme-ui-option', baseId, item.value))}" data-theme-ui-option-value="${esc(item.value)}"${item.custom ? ' data-theme-ui-custom-color="1"' : ''} aria-selected="${String(item.value) === String(value)}" title="${esc(item.title || item.label)}">${_themeUiSwatchHtml(item)}<span>${esc(item.label)}</span></button>`
  ).join('');
  return `<div class="cs-theme-ui-picker-wrap">
    <select class="gb-select cs-theme-ui-select cs-theme-ui-native" data-e2e-id="${esc(_themeUiE2eId('theme-ui-native', baseId))}" data-theme-ui-setting="${esc(target.id)}|${esc(state.id)}|${esc(prop.id)}" aria-label="${esc(label)}" tabindex="-1">${_themeUiSelectOptions(value)}</select>
    <button type="button" class="cs-theme-ui-picker" data-e2e-id="${esc(_themeUiE2eId('theme-ui-picker', baseId))}" data-theme-ui-picker aria-haspopup="listbox" aria-expanded="false" title="${esc(label)}">${_themeUiPickerContent(value)}</button>
    <div class="cs-theme-ui-picker-menu" data-theme-ui-menu role="listbox" hidden>${options}</div>
  </div>`;
}

function renderThemeUiAutoToneControls() {
  const tone = _themeUiAutoTone();
  const control = (kind, label, value) => `<label class="cs-theme-ui-tone-control">
    <span>${label}</span>
    <input type="range" min="0" max="100" step="1" value="${value}" data-e2e-id="theme-ui-auto-tone-${kind}" data-theme-ui-auto-tone="${kind}">
    <input type="number" min="0" max="100" step="1" value="${value}" class="gb-input-sm cs-theme-ui-tone-number" data-e2e-id="theme-ui-auto-tone-input-${kind}" data-theme-ui-auto-tone-input="${kind}">
    <span class="cs-theme-ui-tone-value" data-theme-ui-auto-tone-value="${kind}">${value}%</span>
  </label>`;
  return `<div class="cs-theme-ui-tone-controls">
    ${control('light', '自動（明）', tone.light)}
    ${control('dark', '自動（暗）', tone.dark)}
  </div>`;
}

function _themeUiTargetHasPropForState(target, stateId, propId) {
  if (!target?.vars) return !Array.isArray(target?.props) || target.props.includes(propId);
  return Object.prototype.hasOwnProperty.call(target.vars?.[stateId] || {}, propId);
}

function _themeUiPropsForRenderTarget(target, props) {
  const baseIds = Array.isArray(target?.props) ? target.props : props.map(prop => prop.id);
  if (!target?.vars) return props.filter(prop => baseIds.includes(prop.id));
  const ids = new Set();
  Object.values(target.vars || {}).forEach(vars => {
    Object.keys(vars || {}).forEach(id => { if (baseIds.includes(id)) ids.add(id); });
  });
  return props.filter(prop => ids.has(prop.id));
}

function renderThemeUiApplicationEditor(options = {}) {
  if (typeof MeldexThemeManager === 'undefined') return '';
  const targetIds = Array.isArray(options.targetIds) ? new Set(options.targetIds) : null;
  const targetGroup = options.group || '';
  const targets = (MeldexThemeManager.THEME_UI_TARGETS || []).filter(target => {
    if (targetIds) return targetIds.has(target.id);
    if (targetGroup) return target.group === targetGroup;
    return true;
  });
  const states = MeldexThemeManager.THEME_UI_STATES || [];
  const props = MeldexThemeManager.THEME_UI_PROPS || [];
  const cfg = typeof MeldexThemeManager.getThemeUiApplications === 'function'
    ? MeldexThemeManager.getThemeUiApplications()
    : {};
  const groups = targets.map(target => {
    const targetProps = _themeUiPropsForRenderTarget(target, props);
    const targetStates = Array.isArray(target.states) ? states.filter(state => target.states.includes(state.id)) : states;
    const rowStyle = `--theme-ui-prop-count:${targetProps.length};`;
    const header = `<div class="cs-theme-ui-row cs-theme-ui-row--header" style="${esc(rowStyle)}">
      <span class="cs-theme-ui-state"></span>
      ${targetProps.map(prop => `<span class="cs-theme-ui-column-label">${esc(target.propLabels?.[prop.id] || prop.label)}</span>`).join('')}
    </div>`;
    const rows = targetStates.map(state => {
      const selects = targetProps.map(prop => {
        if (!_themeUiTargetHasPropForState(target, state.id, prop.id)) return '<span class="cs-theme-ui-empty"></span>';
        const value = cfg?.[target.id]?.[state.id]?.[prop.id] || 'none';
        return _renderThemeUiPicker(target, state, prop, value);
      }).join('');
      return `<div class="cs-theme-ui-row" style="${esc(rowStyle)}"><span class="cs-theme-ui-state">${esc(target.stateLabels?.[state.id] || state.label)}</span>${selects}</div>`;
    }).join('');
    return `<details class="cs-theme-ui-target"><summary>${esc(target.label)}</summary>${header}${rows}</details>`;
  }).join('');
  const label = options.hideLabel ? '' : '<span class="cs-row-label">テーマカラーの自動適用設定</span>';
  const targetIdAttr = targets.map(target => target.id).join(',');
  const resetScope = targetGroup ? `group-${targetGroup}` : (targetIdAttr || 'all');
  const reset = options.showReset === false ? '' : `<button type="button" class="cs-toggle" data-e2e-id="${esc(_themeUiE2eId('theme-ui-reset', resetScope))}" data-theme-ui-reset>適用設定を既定に戻す</button>`;
  return `<div class="cs-row cs-theme-ui-editor">
    ${label}
    <div class="cs-theme-ui-grid" data-theme-ui-target-ids="${esc(targetIdAttr)}" style="${esc(_themeUiAutoToneVars(_themeUiAutoTone()))}">
      ${groups}
      ${reset}
    </div>
  </div>`;
}

function syncThemeColorSetSwatches(root, colors) {
  const palette = Array.isArray(colors) ? colors : getCurrentThemeColorSet();
  const osAccentColor = typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getOsAccentColor === 'function'
    ? MeldexThemeManager.getOsAccentColor()
    : 'var(--theme-os-accent, AccentColor)';
  (root || document).querySelectorAll('[data-theme-os-accent-swatch]').forEach(btn => {
    btn.style.background = osAccentColor || 'transparent';
    btn.title = osAccentColor ? `OSアクセント: ${osAccentColor}` : 'OSアクセント: 取得待ち';
  });
  (root || document).querySelectorAll('[data-theme-color-slot]').forEach(btn => {
    const index = parseInt(btn.dataset.themeColorSlot, 10);
    const color = palette[index] || palette[0] || '#ef4444';
    btn.style.background = color;
    btn.title = `テーマカラー ${index + 1}: ${color}`;
  });
}

function syncThemeOsAccentToggle(root) {
  const enabled = typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getUseOsAccentColor === 'function'
    ? MeldexThemeManager.getUseOsAccentColor()
    : false;
  (root || document).querySelectorAll('[data-theme-os-accent-toggle]').forEach(btn => {
    btn.classList.toggle('active', enabled);
    btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  });
}

function _settingsThemePaletteMatrixRender(root) {
  const container = root?.querySelector?.('[data-theme-palette-matrix]');
  if (!container) return;
  container.innerHTML = '';
  const adjust = typeof getStandardPaletteAdjust === 'function' ? getStandardPaletteAdjust() : null;
  const swatches = typeof getStandardPaletteSwatches === 'function' ? getStandardPaletteSwatches(adjust) : [];
  const themeColors = computeThemeColorSetFromSlots(adjust);
  const slotSettings = getThemeColorSlotSettings();
  const extraSlots = getThemeColorExtraSlotSettings();
  const rowDefs = [
    { row: 1, label: '' },
    { row: 2, label: '自動（明）' },
    { row: 3, label: 'テーマカラー' },
    { row: 4, label: '自動（暗）' },
  ];
  rowDefs.forEach(def => {
    const items = def.row === 3
      ? themeColors.map((color, index) => ({ color, title: color, row: 3, index, themeSlot: true }))
      : swatches.filter(s => s.row === def.row);
    if (def.row !== 1 && !items.length) return;
    const rowEl = document.createElement('div');
    rowEl.className = 'cs-theme-palette-row';
    const labelEl = document.createElement('span');
    labelEl.className = 'cs-theme-palette-row-label';
    labelEl.textContent = def.label;
    rowEl.appendChild(labelEl);
    const swatchesEl = document.createElement('div');
    swatchesEl.className = 'cs-theme-palette-row-swatches';
    if (def.row === 1) {
      const transBtn = document.createElement('button');
      transBtn.type = 'button';
      transBtn.className = 'cs-theme-palette-swatch is-transparent';
      transBtn.dataset.color = 'transparent';
      transBtn.dataset.e2eId = 'settings-theme-palette-row-1-col-0';
      transBtn.dataset.paletteRow = '1';
      transBtn.dataset.paletteCol = '0';
      transBtn.title = '透明';
      swatchesEl.appendChild(transBtn);
    }
    items.forEach((info) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cs-theme-palette-swatch';
      btn.dataset.paletteRow = String(def.row);
      if (info.themeSlot) {
        // 行3: 既存のテーマカラースロット (0-7)
        const slot = slotSettings[info.index];
        btn.dataset.themePaletteSlot = String(info.index);
        btn.dataset.paletteCol = String(info.index);
        btn.dataset.e2eId = `settings-theme-palette-row-3-slot-${info.index}`;
        btn.dataset.color = info.color;
        btn.classList.toggle('is-custom', !!slot);
        btn.classList.toggle('is-adjust-disabled', !!slot && slot.applyAdjust === false);
        btn.title = `テーマカラー ${info.index + 1}: ${info.color}${slot ? (slot.applyAdjust === false ? ' / 色調整なし' : ' / 色調整あり') : ''}`;
        btn.style.background = info.color;
      } else {
        // 行1・2・4: 拡張スロット (色上書きのみ)
        // getStandardPaletteSwatches で行1/2/4 は info.index を持つ (行1 は col=1..7, 行2/4 は 0..7)
        const actualCol = Number.isInteger(info.index) ? info.index : 0;
        const override = _getExtraSlotOverride(def.row, actualCol);
        const displayColor = override || info.color;
        btn.dataset.paletteCol = String(actualCol);
        btn.dataset.themePaletteExtraSlot = `${def.row}-${actualCol}`;
        btn.dataset.e2eId = `settings-theme-palette-row-${def.row}-col-${actualCol}`;
        btn.dataset.color = displayColor;
        btn.classList.toggle('is-custom', !!override);
        btn.title = `${info.title || info.color}${override ? ` / カスタム: ${override}` : ''}`;
        btn.style.background = displayColor;
      }
      swatchesEl.appendChild(btn);
    });
    rowEl.appendChild(swatchesEl);
    container.appendChild(rowEl);
  });
}

function _settingsThemePaletteSyncSliders(root) {
  if (!root) return;
  const adjust = typeof getStandardPaletteAdjust === 'function' ? getStandardPaletteAdjust() : {};
  ['hueStart', 'hueEnd', 'saturation', 'brightness', 'contrast'].forEach(key => {
    const value = adjust[key];
    const slider = root.querySelector(`[data-theme-palette-slider="${key}"]`);
    const num = root.querySelector(`[data-theme-palette-slider-num="${key}"]`);
    if (slider) slider.value = String(value);
    if (num) num.value = String(value);
  });
  if (globalThis.GBUI && typeof globalThis.GBUI.refreshRangeFills === 'function') {
    globalThis.GBUI.refreshRangeFills(root);
  }
}

function _syncThemeColorSetFromPalette() {
  if (typeof getStandardPaletteAdjust !== 'function' || typeof getStandardPaletteSwatches !== 'function') return;
  if (typeof MeldexThemeManager === 'undefined' || typeof MeldexThemeManager.setThemeColorSet !== 'function') return;
  const adjust = getStandardPaletteAdjust();
  const next = computeThemeColorSetFromSlots(adjust);
  try { MeldexThemeManager.setThemeColorSet(next, { save: true, skipHistory: true }); } catch {}
  // 明暗比はテーマカラーの自動（明）/（暗）トーンにも反映する
  if (typeof MeldexThemeManager.setThemeUiAutoTone === 'function') {
    try {
      MeldexThemeManager.setThemeUiAutoTone('light', adjust.contrast, { skipHistory: true });
      MeldexThemeManager.setThemeUiAutoTone('dark', adjust.contrast, { skipHistory: true });
    } catch {}
  }
  const themeEditor = typeof document !== 'undefined' ? document.getElementById('settings-theme-editor') : null;
  if (themeEditor && typeof refreshSettingsThemeStylePreviews === 'function') {
    refreshSettingsThemeStylePreviews(themeEditor);
  }
  return next;
}

let _settingsThemeColorSlotPopup = null;
let _settingsThemeColorSlotOutsideHandler = null;

function closeSettingsThemeColorSlotPopup() {
  if (_settingsThemeColorSlotPopup) {
    _settingsThemeColorSlotPopup.remove();
    _settingsThemeColorSlotPopup = null;
  }
  if (_settingsThemeColorSlotOutsideHandler) {
    document.removeEventListener('pointerdown', _settingsThemeColorSlotOutsideHandler, true);
    _settingsThemeColorSlotOutsideHandler = null;
  }
}

function _settingsThemePositionColorSlotPopup(popup, anchor) {
  if (typeof positionPopup === 'function') {
    positionPopup(popup, anchor.getBoundingClientRect());
    return;
  }
  const rect = anchor.getBoundingClientRect();
  const z = (typeof _getZoom === 'function') ? _getZoom() : 1;
  popup.style.left = `${rect.left / z}px`;
  popup.style.top = `${(rect.bottom / z) + 4}px`;
}

function _settingsThemeSlotSlider(labelText, min, max, value, onChange) {
  const row = document.createElement('div');
  row.className = 'gb-palette-slider-row';
  const label = document.createElement('label');
  label.textContent = labelText;
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(min);
  slider.max = String(max);
  slider.value = String(value);
  const number = document.createElement('input');
  number.type = 'number';
  number.className = 'gb-slider-val';
  number.min = String(min);
  number.max = String(max);
  number.value = String(value);
  const apply = (raw, notify = true) => {
    const next = Math.max(min, Math.min(max, parseInt(raw, 10) || 0));
    slider.value = String(next);
    number.value = String(next);
    globalThis.GBUI?.refreshRangeFill?.(slider);
    if (notify) onChange(next);
  };
  slider.addEventListener('input', () => apply(slider.value));
  number.addEventListener('change', () => apply(number.value));
  row.append(label, slider, number);
  return { row, slider, number, apply };
}

function openSettingsThemeColorSlotPopup(anchor, index, root) {
  if (!anchor || !Number.isInteger(index) || index < 0) return;
  if (typeof closeColorPalette === 'function') closeColorPalette();
  closeSettingsThemeColorSlotPopup();
  const panelRoot = root || anchor.closest?.('#settings-theme-palette-editor') || document;
  const slots = getThemeColorSlotSettings();
  const palette = computeThemeColorSetFromSlots();
  const slot = slots[index];
  let applyAdjust = slot ? slot.applyAdjust !== false : true;
  let hsb = typeof _hexToHsb === 'function'
    ? _hexToHsb(slot?.color || palette[index] || '#ef4444')
    : { h: 0, s: 50, b: 90 };

  const popup = document.createElement('div');
  popup.className = 'gb-palette gb-palette-popup cs-theme-color-slot-popup';

  const title = document.createElement('div');
  title.className = 'gb-palette-section-heading';
  title.textContent = `テーマカラー ${index + 1}`;
  popup.appendChild(title);

  const pickerRow = document.createElement('div');
  pickerRow.className = 'gb-palette-picker-row';
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.title = '色を選択';
  const preview = document.createElement('span');
  preview.className = 'cs-theme-color-slot-preview';
  pickerRow.append(picker, preview);
  popup.appendChild(pickerRow);

  const sliderSection = document.createElement('div');
  sliderSection.className = 'gb-palette-sliders';
  const currentSlotColor = () => typeof _hsbToHex === 'function' ? _hsbToHex(hsb.h, hsb.s, hsb.b) : (picker.value || '#ef4444');
  const currentEffectiveSlotColor = () => {
    const color = currentSlotColor();
    const adjust = typeof getStandardPaletteAdjust === 'function' ? getStandardPaletteAdjust() : null;
    return applyAdjust && typeof adjustStandardPaletteColor === 'function'
      ? adjustStandardPaletteColor(color, adjust)
      : color;
  };
  const refreshSlotPreview = () => {
    const color = currentSlotColor();
    const effective = currentEffectiveSlotColor();
    picker.value = color;
    preview.style.background = effective;
    preview.title = applyAdjust ? `${color} → ${effective}` : color;
  };
  const writeSlot = () => {
    const color = currentSlotColor();
    const nextSlots = getThemeColorSlotSettings();
    nextSlots[index] = { color, applyAdjust };
    saveThemeColorSlotSettings(nextSlots);
    const nextPalette = _syncThemeColorSetFromPalette() || computeThemeColorSetFromSlots();
    _settingsThemePaletteMatrixRender(panelRoot);
    syncThemeColorSetSwatches(panelRoot, nextPalette);
    if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
    refreshSlotPreview();
  };
  const onSlider = () => writeSlot();
  const hSlider = _settingsThemeSlotSlider('色相', 0, 360, hsb.h, value => { hsb.h = value; onSlider(); });
  const sSlider = _settingsThemeSlotSlider('彩度', 0, 100, hsb.s, value => { hsb.s = value; onSlider(); });
  const bSlider = _settingsThemeSlotSlider('明度', 0, 100, hsb.b, value => { hsb.b = value; onSlider(); });
  sliderSection.append(hSlider.row, sSlider.row, bSlider.row);
  popup.appendChild(sliderSection);

  const optionRow = document.createElement('div');
  optionRow.className = 'cs-theme-color-slot-options';
  const applyLabel = document.createElement('label');
  const applyInput = document.createElement('input');
  applyInput.type = 'checkbox';
  applyInput.checked = applyAdjust;
  applyLabel.append(applyInput, document.createTextNode(' 色調整を反映'));
  applyInput.addEventListener('change', () => {
    applyAdjust = applyInput.checked;
    writeSlot();
  });
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'gb-btn-close';
  resetBtn.textContent = '自動に戻す';
  resetBtn.addEventListener('click', () => {
    const nextSlots = getThemeColorSlotSettings();
    nextSlots[index] = null;
    saveThemeColorSlotSettings(nextSlots);
    const nextPalette = _syncThemeColorSetFromPalette() || computeThemeColorSetFromSlots();
    _settingsThemePaletteMatrixRender(panelRoot);
    syncThemeColorSetSwatches(panelRoot, nextPalette);
    if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
    closeSettingsThemeColorSlotPopup();
  });
  optionRow.append(applyLabel, resetBtn);
  popup.appendChild(optionRow);

  if (typeof attachMeldexDropdownCloseButton === 'function') {
    attachMeldexDropdownCloseButton(popup, {
      trigger: anchor,
      close: closeSettingsThemeColorSlotPopup,
      rowClassName: 'gb-palette-close-row',
      className: 'gb-btn-close meldex-dropdown-close-btn',
    });
  } else {
    const closeRow = document.createElement('div');
    closeRow.className = 'gb-palette-close-row';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'gb-btn-close';
    closeBtn.type = 'button';
    closeBtn.textContent = '閉じる';
    closeBtn.addEventListener('click', closeSettingsThemeColorSlotPopup);
    closeRow.appendChild(closeBtn);
    popup.appendChild(closeRow);
  }

  const syncControls = () => {
    hSlider.apply(hsb.h, false);
    sSlider.apply(hsb.s, false);
    bSlider.apply(hsb.b, false);
    refreshSlotPreview();
  };
  picker.addEventListener('input', () => {
    if (typeof _hexToHsb === 'function') hsb = _hexToHsb(picker.value);
    syncControls();
    writeSlot();
  });

  document.body.appendChild(popup);
  _settingsThemeColorSlotPopup = popup;
  syncControls();
  _settingsThemePositionColorSlotPopup(popup, anchor);
  _settingsThemeColorSlotOutsideHandler = ev => {
    if (_settingsThemeColorSlotPopup && !_settingsThemeColorSlotPopup.contains(ev.target) && ev.target !== anchor) {
      closeSettingsThemeColorSlotPopup();
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', _settingsThemeColorSlotOutsideHandler, true), 0);
}


/* Source chunk: gb-settings.part03.js */
/* gb-settings.part03.js */
function openSettingsThemeExtraSlotPopup(anchor, row, col, root) {
  if (!anchor || !Number.isInteger(row) || !Number.isInteger(col)) return;
  if (typeof closeColorPalette === 'function') closeColorPalette();
  closeSettingsThemeColorSlotPopup();
  const panelRoot = root || anchor.closest?.('#settings-theme-palette-editor') || document;
  const currentColor = anchor.dataset.color || '#888888';
  let hsb = typeof _hexToHsb === 'function' ? _hexToHsb(currentColor) : { h: 0, s: 50, b: 90 };

  const popup = document.createElement('div');
  popup.className = 'gb-palette gb-palette-popup cs-theme-color-slot-popup';

  const title = document.createElement('div');
  title.className = 'gb-palette-section-heading';
  const rowLabel = row === 1 ? 'グレー' : row === 2 ? '自動（明）' : '自動（暗）';
  title.textContent = `${rowLabel} ${col + 1}`;
  popup.appendChild(title);

  const pickerRow = document.createElement('div');
  pickerRow.className = 'gb-palette-picker-row';
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.title = '色を選択';
  const preview = document.createElement('span');
  preview.className = 'cs-theme-color-slot-preview';
  pickerRow.append(picker, preview);
  popup.appendChild(pickerRow);

  const sliderSection = document.createElement('div');
  sliderSection.className = 'gb-palette-sliders';
  const currentSlotColor = () => typeof _hsbToHex === 'function' ? _hsbToHex(hsb.h, hsb.s, hsb.b) : (picker.value || '#888888');
  const refreshPreview = () => {
    const c = currentSlotColor();
    picker.value = c;
    preview.style.background = c;
    preview.title = c;
  };
  const writeOverride = () => {
    const c = currentSlotColor();
    const next = getThemeColorExtraSlotSettings();
    next[`${row}-${col}`] = c;
    saveThemeColorExtraSlotSettings(next);
    _settingsThemePaletteMatrixRender(panelRoot);
    if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
    refreshPreview();
  };
  const hSlider = _settingsThemeSlotSlider('色相', 0, 360, hsb.h, value => { hsb.h = value; writeOverride(); });
  const sSlider = _settingsThemeSlotSlider('彩度', 0, 100, hsb.s, value => { hsb.s = value; writeOverride(); });
  const bSlider = _settingsThemeSlotSlider('明度', 0, 100, hsb.b, value => { hsb.b = value; writeOverride(); });
  sliderSection.append(hSlider.row, sSlider.row, bSlider.row);
  popup.appendChild(sliderSection);

  const optionRow = document.createElement('div');
  optionRow.className = 'cs-theme-color-slot-options';
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'gb-btn-close';
  resetBtn.textContent = '自動に戻す';
  resetBtn.addEventListener('click', () => {
    const next = getThemeColorExtraSlotSettings();
    delete next[`${row}-${col}`];
    saveThemeColorExtraSlotSettings(next);
    _settingsThemePaletteMatrixRender(panelRoot);
    if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
    closeSettingsThemeColorSlotPopup();
  });
  optionRow.appendChild(resetBtn);
  popup.appendChild(optionRow);

  if (typeof attachMeldexDropdownCloseButton === 'function') {
    attachMeldexDropdownCloseButton(popup, {
      trigger: anchor,
      close: closeSettingsThemeColorSlotPopup,
      rowClassName: 'gb-palette-close-row',
      className: 'gb-btn-close meldex-dropdown-close-btn',
    });
  } else {
    const closeRow = document.createElement('div');
    closeRow.className = 'gb-palette-close-row';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'gb-btn-close';
    closeBtn.type = 'button';
    closeBtn.textContent = '閉じる';
    closeBtn.addEventListener('click', closeSettingsThemeColorSlotPopup);
    closeRow.appendChild(closeBtn);
    popup.appendChild(closeRow);
  }

  const syncControls = () => {
    hSlider.apply(hsb.h, false);
    sSlider.apply(hsb.s, false);
    bSlider.apply(hsb.b, false);
    refreshPreview();
  };
  picker.addEventListener('input', () => {
    if (typeof _hexToHsb === 'function') hsb = _hexToHsb(picker.value);
    syncControls();
    writeOverride();
  });

  document.body.appendChild(popup);
  _settingsThemeColorSlotPopup = popup;
  syncControls();
  _settingsThemePositionColorSlotPopup(popup, anchor);
  _settingsThemeColorSlotOutsideHandler = ev => {
    if (_settingsThemeColorSlotPopup && !_settingsThemeColorSlotPopup.contains(ev.target) && ev.target !== anchor) {
      closeSettingsThemeColorSlotPopup();
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', _settingsThemeColorSlotOutsideHandler, true), 0);
}

function _bindSettingsThemePaletteEditor(root) {
  if (!root || typeof getStandardPaletteAdjust !== 'function') return;
  _settingsThemePaletteMatrixRender(root);
  _settingsThemePaletteSyncSliders(root);

  const onAdjust = (key, value) => {
    if (_settingsThemeIsReadonlyElement(root)) {
      _settingsThemePromptDuplicateForEdit();
      _settingsThemePaletteSyncSliders(root);
      return;
    }
    const adjust = getStandardPaletteAdjust();
    adjust[key] = parseInt(value, 10);
    setStandardPaletteAdjust(adjust);
    _settingsThemePaletteMatrixRender(root);
    _settingsThemePaletteSyncSliders(root);
    _syncThemeColorSetFromPalette();
    if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
  };

  root.querySelectorAll('[data-theme-palette-slider]').forEach(slider => {
    slider.addEventListener('input', () => {
      const key = slider.dataset.themePaletteSlider;
      onAdjust(key, slider.value);
    });
  });
  root.querySelectorAll('[data-theme-palette-slider-num]').forEach(num => {
    num.addEventListener('change', () => {
      const key = num.dataset.themePaletteSliderNum;
      onAdjust(key, num.value);
    });
  });
  if (!root._settingsThemePaletteSlotClickBound) {
    root._settingsThemePaletteSlotClickBound = true;
    root.addEventListener('click', ev => {
      const slotBtn = ev.target?.closest?.('[data-theme-palette-slot]');
      if (slotBtn && root.contains(slotBtn)) {
        if (_settingsThemeIsReadonlyElement(slotBtn)) {
          _settingsThemePromptDuplicateForEdit();
          return;
        }
        openSettingsThemeColorSlotPopup(slotBtn, parseInt(slotBtn.dataset.themePaletteSlot, 10), root);
        return;
      }
      const extraBtn = ev.target?.closest?.('[data-theme-palette-extra-slot]');
      if (extraBtn && root.contains(extraBtn)) {
        if (_settingsThemeIsReadonlyElement(extraBtn)) {
          _settingsThemePromptDuplicateForEdit();
          return;
        }
        const [row, col] = String(extraBtn.dataset.themePaletteExtraSlot || '').split('-').map(n => parseInt(n, 10));
        if (Number.isInteger(row) && Number.isInteger(col)) {
          openSettingsThemeExtraSlotPopup(extraBtn, row, col, root);
        }
      }
    });
  }
  root.querySelector('[data-theme-palette-reset]')?.addEventListener('click', () => {
    if (_settingsThemeIsReadonlyElement(root)) {
      _settingsThemePromptDuplicateForEdit();
      return;
    }
    if (typeof resetStandardPaletteAdjust === 'function') resetStandardPaletteAdjust();
    _settingsThemePaletteMatrixRender(root);
    _settingsThemePaletteSyncSliders(root);
    _syncThemeColorSetFromPalette();
    if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
  });
}

function bindThemeColorSetEditor(root) {
  if (!root || typeof MeldexThemeManager === 'undefined' || typeof MeldexThemeManager.setThemeColorSet !== 'function') return;
  const scopedFilePanel = root.closest?.('[data-file-theme-panel]');
  if (scopedFilePanel?.dataset?.fileThemePanel) return;
  _bindSettingsThemePaletteEditor(root);
  root.querySelectorAll('[data-theme-color-slot]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (_settingsThemeIsReadonlyElement(btn)) {
        _settingsThemePromptDuplicateForEdit();
        return;
      }
      const index = parseInt(btn.dataset.themeColorSlot, 10);
      openSettingsThemeColorSlotPopup(btn, index, root);
    });
  });
  root.querySelector('[data-theme-color-reset]')?.addEventListener('click', () => {
    if (_settingsThemeIsReadonlyElement(root)) {
      _settingsThemePromptDuplicateForEdit();
      return;
    }
    const next = typeof MeldexThemeManager.resetThemeColorSet === 'function' ? MeldexThemeManager.resetThemeColorSet() : null;
    if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
    syncThemeColorSetSwatches(root, next);
    if (typeof refreshSettingsThemeStylePreviews === 'function') refreshSettingsThemeStylePreviews(root);
  });
  root.querySelector('[data-theme-os-accent-toggle]')?.addEventListener('click', () => {
    if (_settingsThemeIsReadonlyElement(root)) {
      _settingsThemePromptDuplicateForEdit();
      return;
    }
    const current = typeof MeldexThemeManager.getUseOsAccentColor === 'function' ? MeldexThemeManager.getUseOsAccentColor() : false;
    if (typeof MeldexThemeManager.setUseOsAccentColor === 'function') {
      MeldexThemeManager.setUseOsAccentColor(!current);
    }
    if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
    if (root.closest?.('#settings-theme-editor') && typeof _refreshSettingsThemePanel === 'function') {
      _refreshSettingsThemePanel();
      return;
    }
    syncThemeOsAccentToggle(root);
    syncCsSwatches(root);
    syncThemeColorSetSwatches(root);
  });
}

function _closeThemeUiPickers(root, exceptWrap) {
  (root || document).querySelectorAll('.cs-theme-ui-picker-wrap').forEach(wrap => {
    if (exceptWrap && wrap === exceptWrap) return;
    const menu = wrap.querySelector('[data-theme-ui-menu]');
    const btn = wrap.querySelector('[data-theme-ui-picker]');
    if (menu) menu.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
}

function _syncThemeUiPicker(wrap, value) {
  if (!wrap) return;
  const select = wrap.querySelector('[data-theme-ui-setting]');
  _syncThemeUiNativeSelect(select, value);
  _syncThemeUiCustomOption(wrap, value);
  const btn = wrap.querySelector('[data-theme-ui-picker]');
  if (btn) btn.innerHTML = _themeUiPickerContent(value);
  wrap.querySelectorAll('[data-theme-ui-option-value]').forEach(opt => {
    opt.setAttribute('aria-selected', String(opt.dataset.themeUiOptionValue || '') === String(value || 'none') ? 'true' : 'false');
  });
}

function _syncThemeUiNativeSelect(select, value) {
  if (!select) return;
  const current = String(value || 'none');
  select.querySelectorAll('option[data-theme-ui-custom-option]').forEach(opt => {
    if (opt.value !== current) opt.remove();
  });
  if (_themeUiCustomColor(current) && !Array.from(select.options).some(opt => opt.value === current)) {
    const opt = document.createElement('option');
    opt.value = current;
    opt.textContent = '指定カラー';
    opt.dataset.themeUiCustomOption = '1';
    select.appendChild(opt);
  }
  select.value = current;
}

function _syncThemeUiCustomOption(wrap, value) {
  const opt = wrap?.querySelector?.('[data-theme-ui-custom-color]');
  if (!opt) return;
  const color = _themeUiCustomColor(value) || '#ef4444';
  const nextValue = _themeUiCustomValue(color);
  opt.dataset.themeUiOptionValue = nextValue;
  opt.title = `カラーパレットから指定: ${color}`;
  const swatch = opt.querySelector('.cs-theme-ui-option-swatch');
  if (swatch) swatch.style.background = color;
}

function _syncThemeUiAutoToneControls(root, tone) {
  const next = tone || _themeUiAutoTone();
  (root || document).querySelectorAll('.cs-theme-ui-grid').forEach(grid => {
    grid.style.setProperty('--theme-ui-auto-light-base', `${100 - next.light}%`);
    grid.style.setProperty('--theme-ui-auto-light-percent', `${next.light}%`);
    grid.style.setProperty('--theme-ui-auto-dark-base', `${100 - next.dark}%`);
    grid.style.setProperty('--theme-ui-auto-dark-percent', `${next.dark}%`);
  });
  ['light', 'dark'].forEach(kind => {
    (root || document).querySelectorAll(`[data-theme-ui-auto-tone="${kind}"]`).forEach(input => { input.value = String(next[kind]); globalThis.GBUI?.refreshRangeFill?.(input); });
    (root || document).querySelectorAll(`[data-theme-ui-auto-tone-input="${kind}"]`).forEach(input => { input.value = String(next[kind]); });
    (root || document).querySelectorAll(`[data-theme-ui-auto-tone-value="${kind}"]`).forEach(el => { el.textContent = `${next[kind]}%`; });
  });
}

function bindThemeUiAutoToneControls(root) {
  if (!root || typeof MeldexThemeManager === 'undefined' || typeof MeldexThemeManager.setThemeUiAutoTone !== 'function') return;
  const apply = (kind, raw) => {
    const next = MeldexThemeManager.setThemeUiAutoTone(kind, raw);
    if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
    _syncThemeUiAutoToneControls(root, next);
    if (typeof refreshSettingsThemeStylePreviews === 'function') refreshSettingsThemeStylePreviews(root);
  };
  root.querySelectorAll('[data-theme-ui-auto-tone]').forEach(input => {
    input.addEventListener('input', () => apply(input.dataset.themeUiAutoTone, input.value));
  });
  root.querySelectorAll('[data-theme-ui-auto-tone-input]').forEach(input => {
    input.addEventListener('change', () => apply(input.dataset.themeUiAutoToneInput, input.value));
  });
  _syncThemeUiAutoToneControls(root);
}

function bindThemeUiApplicationEditor(root) {
  if (!root || typeof MeldexThemeManager === 'undefined') return;
  bindThemeUiAutoToneControls(root);
  root.querySelectorAll('[data-theme-ui-setting]').forEach(select => {
    select.addEventListener('change', () => {
      const [targetId, stateId, propId] = String(select.dataset.themeUiSetting || '').split('|');
      if (typeof MeldexThemeManager.setThemeUiApplication === 'function') {
        MeldexThemeManager.setThemeUiApplication(targetId, stateId, propId, select.value);
      }
      if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
      _syncThemeUiPicker(select.closest('.cs-theme-ui-picker-wrap'), select.value);
      if (typeof refreshSettingsThemeStylePreviews === 'function') {
        refreshSettingsThemeStylePreviews(select.closest('[data-settings-theme-style-panel]') || root);
      }
    });
  });
  root.querySelectorAll('[data-theme-ui-picker]').forEach(btn => {
    const wrap = btn.closest('.cs-theme-ui-picker-wrap');
    const select = wrap?.querySelector('[data-theme-ui-setting]');
    const applyPickerValue = value => {
      if (!select) return;
      _syncThemeUiNativeSelect(select, value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    if (typeof bindMeldexDropdownKeySwitch === 'function') {
      bindMeldexDropdownKeySwitch(btn, {
        getItems: () => Array.from(wrap?.querySelectorAll('[data-theme-ui-option-value]:not([data-theme-ui-custom-color])') || [])
          .map(option => ({ value: option.dataset.themeUiOptionValue || 'none', option })),
        getCurrentValue: () => select?.value || 'none',
        onSelect: item => applyPickerValue(item.value),
        getFreshTrigger: () => wrap?.querySelector('[data-theme-ui-picker]'),
      });
    }
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const menu = wrap?.querySelector('[data-theme-ui-menu]');
      if (!wrap || !menu) return;
      const opening = menu.hidden;
      _closeThemeUiPickers(root, opening ? wrap : null);
      menu.hidden = !opening;
      btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
    });
    btn.addEventListener('keydown', (ev) => {
      if (!['Enter', ' ', 'ArrowDown'].includes(ev.key)) return;
      ev.preventDefault();
      btn.click();
      const first = btn.closest('.cs-theme-ui-picker-wrap')?.querySelector('[data-theme-ui-option-value]');
      first?.focus?.();
    });
  });
  root.querySelectorAll('[data-theme-ui-option-value]').forEach(opt => {
    opt.addEventListener('click', (ev) => {
      ev.preventDefault();
      const wrap = opt.closest('.cs-theme-ui-picker-wrap');
      const select = wrap?.querySelector('[data-theme-ui-setting]');
      if (!select) return;
      const applyValue = value => {
        _syncThemeUiNativeSelect(select, value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      };
      if (opt.dataset.themeUiCustomColor === '1') {
        const current = _themeUiCustomColor(select.value) || _themeUiCustomColor(opt.dataset.themeUiOptionValue) || '#ef4444';
        _closeThemeUiPickers(root);
        if (typeof openColorPalette === 'function') {
          const anchor = wrap.querySelector('[data-theme-ui-picker]') || opt;
          openColorPalette(anchor, current, color => {
            const custom = _themeUiCustomValue(color);
            if (custom) applyValue(custom);
          });
        } else {
          applyValue(_themeUiCustomValue(current) || 'none');
        }
        return;
      }
      applyValue(opt.dataset.themeUiOptionValue || 'none');
      _closeThemeUiPickers(root);
      if (typeof focusMeldexDropdownTrigger === 'function') focusMeldexDropdownTrigger(() => wrap.querySelector('[data-theme-ui-picker]'));
    });
    opt.addEventListener('keydown', (ev) => {
      if (!['Enter', ' '].includes(ev.key)) return;
      ev.preventDefault();
      opt.click();
    });
  });
  if (!root._themeUiPickerDismissBound) {
    root._themeUiPickerDismissBound = true;
    root.addEventListener('click', ev => {
      if (ev.target?.closest?.('.cs-theme-ui-picker-wrap')) return;
      _closeThemeUiPickers(root);
    });
  }
  root.querySelector('[data-theme-ui-reset]')?.addEventListener('click', () => {
    if (typeof MeldexThemeManager.resetThemeUiAutoTone === 'function') MeldexThemeManager.resetThemeUiAutoTone();
    const grid = root.querySelector('.cs-theme-ui-grid');
    const targetIds = String(grid?.dataset?.themeUiTargetIds || '').split(',').map(v => v.trim()).filter(Boolean);
    if (targetIds.length && typeof MeldexThemeManager.resetThemeUiApplicationTargets === 'function') {
      MeldexThemeManager.resetThemeUiApplicationTargets(targetIds);
    } else if (typeof MeldexThemeManager.resetThemeUiApplications === 'function') {
      MeldexThemeManager.resetThemeUiApplications();
    }
    if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
    const panel = root.closest('.settings-panel') || root;
    if (typeof _refreshSettingsThemePanel === 'function') _refreshSettingsThemePanel();
    else {
      panel.querySelectorAll('[data-theme-ui-setting]').forEach(select => {
        select.value = 'none';
        _syncThemeUiPicker(select.closest('.cs-theme-ui-picker-wrap'), select.value);
      });
      _syncThemeUiAutoToneControls(panel);
      if (typeof refreshSettingsThemeStylePreviews === 'function') refreshSettingsThemeStylePreviews(panel);
    }
  });
}

function syncThemeUiApplicationSelectors(root) {
  if (!root || typeof MeldexThemeManager === 'undefined' || typeof MeldexThemeManager.getThemeUiApplications !== 'function') return;
  const cfg = MeldexThemeManager.getThemeUiApplications();
  root.querySelectorAll('[data-theme-ui-setting]').forEach(select => {
    const [targetId, stateId, propId] = String(select.dataset.themeUiSetting || '').split('|');
    const value = cfg?.[targetId]?.[stateId]?.[propId] || 'none';
    _syncThemeUiNativeSelect(select, value);
    _syncThemeUiPicker(select.closest('.cs-theme-ui-picker-wrap'), value);
  });
  _syncThemeUiAutoToneControls(root);
}

function openColorSettings() {
  document.querySelector('.modal-overlay')?.remove();
  if (typeof showSettingsModal === 'function') {
    showSettingsModal({ panel: 'テーマ' });
    return;
  }
  if (typeof showStatus === 'function') showStatus('設定ダイアログを初期化できませんでした', true);
}

function switchCsTab(btn, name) {
  // パレットを閉じる
  closeColorPalette();
  // タブボタン切替 (gb-inner-tab-active クラス、旧インライン style は防御的にクリア)
  btn.closest('.modal').querySelectorAll('.cs-tab').forEach(t => {
    t.classList.remove('active');
    t.classList.remove('gb-inner-tab-active');
    t.style.background = '';
    t.style.color = '';
    t.style.borderBottomColor = '';
  });
  btn.classList.add('active');
  btn.classList.add('gb-inner-tab-active');
  // コンテンツ切替 (hidden 属性)
  btn.closest('.modal').querySelectorAll('.cs-tab-content').forEach(c => {
    c.hidden = c.dataset.tab !== name;
    c.style.display = '';
  });
}

function openCsPalette(swatchEl, key) {
  if (_settingsThemeIsReadonlyElement(swatchEl)) {
    _settingsThemePromptDuplicateForEdit();
    return;
  }
  openColorPalette(swatchEl, getCssVar(key), (color) => {
    setColorSetting(key, color);
    updateCsSwatch(key, color);
  });
}

// プレビュークリックでカラー設定タブの行に対応する書式ポップアップを開く。
// シナリオエディタのタイプ管理ポップアップと同パターン（openFormatPopup を流用）。
function openStylePreviewPopup(previewEl) {
  if (!previewEl || typeof openFormatPopup !== 'function') return;
  if (_settingsThemeIsReadonlyElement(previewEl)) {
    _settingsThemePromptDuplicateForEdit();
    return;
  }
  const label = previewEl.dataset.styleLabel;
  if (!label) return;
  let def = null;
  for (const list of Object.values(UI_STYLE_SECTIONS)) {
    const found = list.find(item => item.label === label);
    if (found) { def = found; break; }
  }
  if (!def) return;
  const fields = [];
  if (def.fg) fields.push('textColor');
  if (def.bg) fields.push('bgColor');
  if (def.bold) fields.push('bold');
  if (def.italic) fields.push('italic');
  const values = {
    textColor: def.fg ? getCssVar(def.fg) : '',
    bgColor: def.bg ? getCssVar(def.bg) : '',
    fontWeight: def.bold && getCssVar(def.bold) === 'bold' ? 'bold' : '',
    fontStyle: def.italic && getCssVar(def.italic) === 'italic' ? 'italic' : '',
  };
  openFormatPopup(previewEl, {
    fields,
    values,
    onChange(prop, value) {
      if (prop === 'textColor' && def.fg) {
        setColorSetting(def.fg, value);
        updateCsSwatch(def.fg, value);
      } else if (prop === 'bgColor' && def.bg) {
        setColorSetting(def.bg, value);
        updateCsSwatch(def.bg, value);
      } else if (prop === 'fontWeight' && def.bold) {
        setColorSetting(def.bold, value === 'bold' ? 'bold' : 'normal');
        const btn = document.querySelector(`.cs-toggle[data-key="${def.bold}"]`);
        if (btn) btn.classList.toggle('active', value === 'bold');
      } else if (prop === 'fontStyle' && def.italic) {
        setColorSetting(def.italic, value === 'italic' ? 'italic' : 'normal');
        const btn = document.querySelector(`.cs-toggle[data-key="${def.italic}"]`);
        if (btn) btn.classList.toggle('active', value === 'italic');
      }
    },
  });
}

function openCsPaletteRgba(swatchEl, key) {
  if (_settingsThemeIsReadonlyElement(swatchEl)) {
    _settingsThemePromptDuplicateForEdit();
    return;
  }
  const curHex = swatchEl.dataset.hex || '#000000';
  const slider = document.querySelector(`.cs-alpha[data-key="${key}"]`);
  const curAlpha = slider ? parseFloat(slider.value) / 100 : 1;
  const curColor = hexAlphaToRgba(curHex, curAlpha);
  // パレットはα非対応になったため純hexか'transparent'を返す。αは外部スライダーで維持する。
  openColorPalette(swatchEl, curColor, (color) => {
    const sw = document.querySelector(`.cs-swatch[data-key="${key}"]`);
    const sl = document.querySelector(`.cs-alpha[data-key="${key}"]`);
    if (color === 'transparent') {
      if (sl) { sl.value = 0; globalThis.GBUI?.refreshRangeFill?.(sl); if (sl.nextElementSibling) sl.nextElementSibling.textContent = '0%'; }
      if (sw) setColorSwatchValue(sw, 'transparent');
      setColorSetting(key, 'transparent');
    } else {
      if (sw) sw.dataset.hex = color;
      updateBgFromSwatchAlpha(key);
    }
  });
}

function updateCsSwatch(key, color) {
  const keys = typeof settingsThemeStyleSettingTargetKeys === 'function'
    ? settingsThemeStyleSettingTargetKeys(key)
    : [key];
  keys.forEach(targetKey => {
    document.querySelectorAll(`.cs-swatch[data-key="${targetKey}"]`).forEach(swatch => {
      setColorSwatchValue(swatch, color);
    });
  });
}

function toggleLineVisibility(btn) {
  if (_settingsThemeIsReadonlyElement(btn)) {
    _settingsThemePromptDuplicateForEdit();
    return;
  }
  const key = btn.dataset.key;
  const onVal = btn.dataset.on;
  const offVal = btn.dataset.off;
  const cur = getCssVar(key);
  const isOn = cur !== offVal;
  document.documentElement.style.setProperty(key, isOn ? offVal : onVal);
  if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
  btn.classList.toggle('active', !isOn);
  // 旧経路が残したインライン style をクリア (CSS の .cs-toggle.active を効かせる)
  btn.style.background = '';
  btn.style.color = '';
}

function toggleCsStyle(btn) {
  if (_settingsThemeIsReadonlyElement(btn)) {
    _settingsThemePromptDuplicateForEdit();
    return;
  }
  const key = btn.dataset.key;
  const val = btn.dataset.val;
  const cur = getCssVar(key);
  const isActive = cur === val;
  document.documentElement.style.setProperty(key, isActive ? 'normal' : val);
  if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
  btn.classList.toggle('active', !isActive);
  btn.style.background = '';
  btn.style.color = '';
}

function setColorSetting(key, color) {
  const value = typeof normalizeStyleSettingValue === 'function' ? normalizeStyleSettingValue(key, color) : color;
  if (typeof applySettingsThemeStyleSetting === 'function') {
    applySettingsThemeStyleSetting(key, value);
    return;
  }
  if (value) document.documentElement.style.setProperty(key, value);
  else document.documentElement.style.removeProperty(key);
  if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
}

function setThemeFontSetting(key, value) {
  setColorSetting(key, value || '');
  if (key === '--ui-font') {
    const uiFont = document.getElementById('modal-font-family');
    if (uiFont) uiFont.value = value || '';
  }
}

function _styleNumericValueFromCss(key, fallback) {
  const raw = typeof getCssVar === 'function' ? getCssVar(key) : '';
  const m = String(raw || '').match(/-?\d+(?:\.\d+)?/);
  if (m) return parseFloat(m[0]);
  return fallback;
}

function _styleNumericFormat(value) {
  if (!Number.isFinite(value)) return '';
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function syncNumericStyleSettingInputs(key, value) {
  if (!key) return;
  const next = value == null ? _styleNumericValueFromCss(key, '') : value;
  const display = next === '' ? '' : _styleNumericFormat(Number(next));
  document.querySelectorAll('[data-number-key]').forEach(input => {
    if (input.dataset.numberKey !== key) return;
    input.value = display;
    if (input.type === 'range') globalThis.GBUI?.refreshRangeFill?.(input);
  });
}

function setNumericStyleSetting(input) {
  if (!input) return;
  if (_settingsThemeIsReadonlyElement(input)) {
    _settingsThemePromptDuplicateForEdit();
    syncNumericStyleSettingInputs(input.dataset.numberKey || input.dataset.key || '');
    return;
  }
  const key = input.dataset.numberKey || input.dataset.key || '';
  if (!key.startsWith('--')) return;
  const min = input.min === '' ? NaN : parseFloat(input.min);
  const max = input.max === '' ? NaN : parseFloat(input.max);
  let value = parseFloat(input.value);
  if (!Number.isFinite(value)) {
    syncNumericStyleSettingInputs(key);
    return;
  }
  if (Number.isFinite(min)) value = Math.max(min, value);
  if (Number.isFinite(max)) value = Math.min(max, value);
  const formatted = _styleNumericFormat(value);
  document.documentElement.style.setProperty(key, formatted + (input.dataset.unit || ''));
  syncNumericStyleSettingInputs(key, value);
  if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
  // ボードのレイアウト関連キーはファイル固有値が未設定のとき即時再レイアウト
  if ((key === '--bd-gap-siblings' || key === '--bd-gap-levels')
    && typeof bd !== 'undefined'
    && (!bd._fileStyle || bd._fileStyle[key] === undefined)
    && typeof _bdRelayoutAllStructureTrees === 'function') {
    _bdRelayoutAllStructureTrees();
  }
}

function _settingsColorHistoryKeys() {
  const keys = [
    COLOR_SETTINGS_KEY,
    'editor-theme-name',
    THEME_COLOR_SLOT_SETTINGS_KEY,
    THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY,
    STANDARD_PALETTE_ADJUST_STORAGE_KEY,
  ];
  if (typeof GB_CUSTOM_COLORS_KEY !== 'undefined') keys.push(GB_CUSTOM_COLORS_KEY);
  if (typeof MeldexThemeManager !== 'undefined') {
    [
      MeldexThemeManager.DEFAULT_THEME_KEY,
      MeldexThemeManager.CUSTOM_THEMES_KEY,
      MeldexThemeManager.THEME_COLOR_SET_KEY,
      MeldexThemeManager.THEME_OS_ACCENT_KEY,
      MeldexThemeManager.THEME_UI_APPLICATIONS_KEY,
      MeldexThemeManager.THEME_UI_AUTO_TONE_KEY,
    ].forEach(key => { if (key) keys.push(key); });
  }
  return [...new Set(keys)];
}

function _refreshSettingsColorAfterHistory() {
  if (typeof loadColorSettings === 'function') loadColorSettings();
  if (typeof updateColorScheme === 'function') updateColorScheme();
  const root = document.getElementById('settings-theme-editor') || document;
  if (typeof syncCsSwatches === 'function') syncCsSwatches(root);
  if (typeof syncThemeColorSetSwatches === 'function') syncThemeColorSetSwatches(root);
  if (typeof refreshSettingsThemeStylePreviews === 'function') refreshSettingsThemeStylePreviews(root);
}

function _captureSettingsColorHistory() {
  return typeof captureLocalStorageSettings === 'function'
    ? captureLocalStorageSettings(_settingsColorHistoryKeys())
    : null;
}

function _pushSettingsColorHistory(label, beforeSnapshot, detail) {
  if (!beforeSnapshot || typeof pushLocalStorageSettingsHistory !== 'function') return false;
  return pushLocalStorageSettingsHistory(
    label,
    beforeSnapshot,
    _captureSettingsColorHistory(),
    detail || '',
    _refreshSettingsColorAfterHistory
  );
}

function applyColorSettings() {
  const before = _captureSettingsColorHistory();
  saveColorSettings();
  localStorage.removeItem('editor-theme-name');
  if (typeof MeldexThemeManager !== 'undefined') localStorage.removeItem(MeldexThemeManager.DEFAULT_THEME_KEY);
  _pushSettingsColorHistory('設定: 色設定を適用', before);
  document.querySelector('.modal-overlay').remove();
  showStatus('色設定を適用しました');
}

async function saveCurrentAsCustomTheme() {
  if (typeof MeldexThemeManager === 'undefined' || typeof MeldexThemeManager.createCustomThemeFromCurrent !== 'function') {
    showStatus('テーマシステムを初期化できませんでした', true);
    return;
  }
  const name = await cfPrompt('カスタムテーマ名', 'カスタムテーマ');
  if (name === null) return;
  const theme = MeldexThemeManager.createCustomThemeFromCurrent(name);
  if (!theme) {
    showStatus('テーマ名を入力してください', true);
    return;
  }
  MeldexThemeManager.applyDefaultTheme(theme.id, { silent: true });
  saveColorSettings();
  document.querySelector('.modal-overlay')?.remove();
  openColorSettings();
  showStatus('カスタムテーマを作成しました');
}

async function deleteCurrentCustomTheme() {
  if (typeof MeldexThemeManager === 'undefined' || typeof MeldexThemeManager.deleteCustomTheme !== 'function') {
    showStatus('テーマシステムを初期化できませんでした', true);
    return;
  }
  const id = MeldexThemeManager.getDefaultThemeId();
  const theme = MeldexThemeManager.getCustomThemes().find(t => t.id === id);
  if (!theme) {
    showStatus('削除できるカスタムテーマが選択されていません', true);
    return;
  }
  if (!await cfConfirm('カスタムテーマ「' + theme.name + '」を削除しますか？')) return;
  MeldexThemeManager.deleteCustomTheme(id);
  MeldexThemeManager.applyDefaultTheme('builtin-dark', { silent: true, resetThemeColorSet: true });
  document.querySelector('.modal-overlay')?.remove();
  openColorSettings();
  showStatus('カスタムテーマを削除しました');
}

function exportEditorTheme() {
  const theme = { _type: 'editor-theme', _version: 3 };
  for (const k of getAllStyleKeys()) {
    const v = document.documentElement.style.getPropertyValue(k);
    if (v) theme[k] = v;
  }
  for (const k of getAllStyleKeys()) {
    if (!theme[k]) { const v = getCssVar(k); if (v) theme[k] = v; }
  }
  theme['_custom-colors'] = getCustomColors();
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getThemeColorSet === 'function') {
    theme[THEME_COLOR_SET_THEME_KEY] = MeldexThemeManager.getThemeColorSet();
    const colorSlots = getThemeColorSlotSettings();
    if (colorSlots.some(Boolean)) theme[THEME_COLOR_SLOT_SETTINGS_THEME_KEY] = colorSlots;
    const extraSlots = getThemeColorExtraSlotSettings();
    if (Object.keys(extraSlots).length) theme[THEME_COLOR_EXTRA_SLOT_SETTINGS_THEME_KEY] = extraSlots;
    if (typeof getStandardPaletteAdjust === 'function') theme[STANDARD_PALETTE_THEME_KEY] = getStandardPaletteAdjust();
    if (typeof MeldexThemeManager.getUseOsAccentColor === 'function') {
      theme[THEME_OS_ACCENT_THEME_KEY] = MeldexThemeManager.getUseOsAccentColor();
    }
  }
  if (typeof MeldexThemeManager !== 'undefined') {
    theme.defaultThemeId = MeldexThemeManager.getDefaultThemeId();
    theme.customThemes = MeldexThemeManager.getCustomThemes();
    if (typeof bd !== 'undefined') theme.activeBoardThemeId = bd.themeId || '';
  }

  if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveText !== 'function') {
    showStatus('保存ダイアログを初期化できませんでした', true);
    return;
  }
  MeldexExportSave.saveText(JSON.stringify(theme, null, 2), {
    filename: 'Meldex_テーマ.json',
    extension: '.json',
    dialogTitle: 'テーマとして保存',
    filetypes: [['JSONファイル', '*.json'], ['すべてのファイル', '*.*']],
    okMessage: 'テーマを保存しました',
    errorMessage: 'テーマの保存に失敗しました',
  });
}

function importEditorTheme() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json';
  inp.onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => {
      try {
        const theme = JSON.parse(ev.target.result);
        const hasThemeColorSet = Object.prototype.hasOwnProperty.call(theme, THEME_COLOR_SET_THEME_KEY);
        for (const [k, v] of Object.entries(theme)) {
          if (!k.startsWith('--')) continue;
          if (typeof applySettingsThemeStyleSetting === 'function') {
            applySettingsThemeStyleSetting(k, v, { markDirty: false });
          } else {
            document.documentElement.style.setProperty(k, v);
          }
        }
        if (theme['_custom-colors'] && Array.isArray(theme['_custom-colors'])) {
          try { localStorage.setItem(GB_CUSTOM_COLORS_KEY, JSON.stringify(theme['_custom-colors'])); } catch {}
        }
        if (Object.prototype.hasOwnProperty.call(theme, THEME_COLOR_SLOT_SETTINGS_THEME_KEY)) {
          saveThemeColorSlotSettings(theme[THEME_COLOR_SLOT_SETTINGS_THEME_KEY]);
        }
        if (Object.prototype.hasOwnProperty.call(theme, THEME_COLOR_EXTRA_SLOT_SETTINGS_THEME_KEY)) {
          saveThemeColorExtraSlotSettings(theme[THEME_COLOR_EXTRA_SLOT_SETTINGS_THEME_KEY]);
        }
        if (Object.prototype.hasOwnProperty.call(theme, STANDARD_PALETTE_THEME_KEY) && typeof setStandardPaletteAdjust === 'function') {
          setStandardPaletteAdjust(theme[STANDARD_PALETTE_THEME_KEY]);
        }
        if (typeof MeldexThemeManager !== 'undefined') {
          if (Array.isArray(theme.customThemes)) MeldexThemeManager.saveCustomThemes(theme.customThemes);
          if (theme.defaultThemeId) MeldexThemeManager.applyDefaultTheme(theme.defaultThemeId, { silent: true });
        }
        if (hasThemeColorSet && typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.setThemeColorSet === 'function') {
          MeldexThemeManager.setThemeColorSet(theme[THEME_COLOR_SET_THEME_KEY], { save: true });
        } else if (Object.prototype.hasOwnProperty.call(theme, THEME_COLOR_SLOT_SETTINGS_THEME_KEY) && typeof _syncThemeColorSetFromPalette === 'function') {
          _syncThemeColorSetFromPalette();
        }
        if (Object.prototype.hasOwnProperty.call(theme, THEME_OS_ACCENT_THEME_KEY) && typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.setUseOsAccentColor === 'function') {
          MeldexThemeManager.setUseOsAccentColor(!!theme[THEME_OS_ACCENT_THEME_KEY]);
        }
        saveColorSettings();
        showStatus('テーマを読み込みました');
        document.querySelector('.modal-overlay')?.remove();
        openColorSettings();
      } catch (err) { showStatus('テーマ読み込み失敗: ' + err.message, true); }
    };
    r.readAsText(f, 'UTF-8');
  };
  inp.click();
}

async function resetColorSettings() {
  if (!await cfConfirm('カスタムテーマをデフォルトに戻しますか？')) return;
  const before = _captureSettingsColorHistory();
  for (const k of getAllStyleKeys()) document.documentElement.style.removeProperty(k);
  localStorage.removeItem(COLOR_SETTINGS_KEY);
  localStorage.removeItem('editor-theme-name');
  localStorage.removeItem(THEME_COLOR_SLOT_SETTINGS_KEY);
  localStorage.removeItem(THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY);
  localStorage.removeItem(STANDARD_PALETTE_ADJUST_STORAGE_KEY);
  if (typeof resetStandardPaletteAdjust === 'function') resetStandardPaletteAdjust({ skipHistory: true });
  if (typeof MeldexThemeManager !== 'undefined') localStorage.removeItem(MeldexThemeManager.DEFAULT_THEME_KEY);
  if (typeof MeldexThemeManager !== 'undefined') localStorage.removeItem(MeldexThemeManager.THEME_OS_ACCENT_KEY);
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.resetThemeColorSet === 'function') MeldexThemeManager.resetThemeColorSet({ skipHistory: true });
  _pushSettingsColorHistory('設定: 色設定リセット', before);
  showStatus('色設定をリセットしました');
  document.querySelector('.modal-overlay').remove();
}

// ユーザー管理（ソースフォルダ別チーム表示）
let _settingsTeamFocusFolder = '';  // 設定ダイアログで選択中のフォルダ（外部から指定可能）

async function loadUserListForSettings() {
  const el = document.getElementById('settings-user-list');
  if (!el) return;
  el.innerHTML = '';
  const myName = getUsername();
  try {
    const roots = await apiFetch('/outliner-roots').catch(() => []);
    const visibleRoots = roots.filter(r => r.visible && r.path);
    if (visibleRoots.length === 0) {
      // ソースフォルダなし
      el.innerHTML = '<div style="color:var(--fg2);">ソースフォルダが設定されていません</div>';
      return;
    }
    // フォーカスフォルダが指定されていればそれだけ表示、なければ全フォルダ
    const foldersToShow = _settingsTeamFocusFolder
      ? visibleRoots.filter(r => r.path === _settingsTeamFocusFolder)
      : visibleRoots;
    if (foldersToShow.length === 0 && _settingsTeamFocusFolder) {
      // 指定フォルダが見つからない場合は全表示
      foldersToShow.push(...visibleRoots);
    }
    for (const root of foldersToShow) {
      // フォルダヘッダー
      const header = document.createElement('div');
      header.style.cssText = 'font-size:12px;font-weight:bold;color:var(--accent);padding:8px 0 4px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:4px;';
      header.innerHTML = lucide('folder', 13) + ' ' + esc(root.name || root.path.split(/[/\\]/).pop());
      el.appendChild(header);
      // メンバー一覧
      try {
        const members = await apiFetch('/team?folder=' + encodeURIComponent(root.path));
        if (members.length === 0) {
          const empty = document.createElement('div');
          empty.style.cssText = 'color:var(--fg2);padding:4px 0;font-size:11px;';
          empty.textContent = 'メンバーなし';
          el.appendChild(empty);
          continue;
        }
        _renderTeamMemberRows(el, members, myName, root.path);
      } catch {
        const err = document.createElement('div');
        err.style.cssText = 'color:var(--fg2);padding:4px 0;font-size:11px;';
        err.textContent = '読み込みエラー';
        el.appendChild(err);
      }
    }
  } catch { el.innerHTML = '<div style="color:var(--fg2);">読み込みエラー</div>'; }
}

async function loadFileLockListForSettings() {
  const el = document.getElementById('settings-file-lock-list');
  if (!el) return;
  el.innerHTML = '<div class="gb-section-desc">読み込み中...</div>';
  try {
    if (typeof _ensureRoleLoaded === 'function') await _ensureRoleLoaded();
    if (typeof _ensureLocksLoaded === 'function') await _ensureLocksLoaded({ force: true });
    const data = await apiFetch('/file-lock');
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    if (!entries.length) {
      el.innerHTML = '<div class="gb-section-desc">編集ロック中の項目はありません</div>';
      return;
    }
    const canUnlock = typeof isFileLockOwner === 'function' && isFileLockOwner();
    el.innerHTML = '';
    for (const entry of entries) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);';
      const body = document.createElement('div');
      body.style.cssText = 'flex:1;min-width:0;';
      const path = document.createElement('div');
      path.style.cssText = 'font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      path.textContent = entry.path || entry.normalized_path || '';
      path.title = path.textContent;
      body.appendChild(path);
      const meta = document.createElement('div');
      meta.className = 'gb-section-desc';
      const parts = [];
      if (entry.lock_reason) parts.push('理由: ' + entry.lock_reason);
      if (entry.locked_by) parts.push('設定者: ' + entry.locked_by);
      if (entry.locked_at) parts.push(String(entry.locked_at).replace('T', ' ').substring(0, 16));
      meta.textContent = parts.join(' / ') || '理由なし';
      body.appendChild(meta);
      row.appendChild(body);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gb-btn gb-btn-xs';
      btn.textContent = canUnlock ? '解除' : '閲覧のみ';
      btn.disabled = !canUnlock;
      btn.addEventListener('click', async () => {
        if (!canUnlock) return;
        try {
          await apiFetch('/file-lock?path=' + encodeURIComponent(entry.path || ''), { method: 'DELETE' });
          if (typeof _ensureLocksLoaded === 'function') await _ensureLocksLoaded({ force: true });
          if (typeof refreshOutliner === 'function') await refreshOutliner();
          await loadFileLockListForSettings();
          showStatus('編集ロックを解除しました');
        } catch {
          showStatus('編集ロック解除に失敗しました', true);
        }
      });
      row.appendChild(btn);
      el.appendChild(row);
    }
  } catch {
    el.innerHTML = '<div style="color:var(--fg2);">読み込みエラー</div>';
  }
}

function _renderTeamMemberRows(container, members, myName, folderPath) {
  const roleLabels = { owner: '管理者', editor: '編集者', viewer: '閲覧者' };
  for (const m of members) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);';
    // アバター
    const av = document.createElement('div');
    av.style.cssText = 'width:24px;height:24px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;';
    if (m.has_avatar) {
      const avatarSrc = window.MeldexDataAccess?.team?.avatarUrl?.(m.name || 'anonymous', { folder: folderPath }) || `${API_BASE}/team/avatar/${encodeURIComponent(m.name)}?folder=${encodeURIComponent(folderPath)}&t=${Date.now()}`;
      av.innerHTML = `<img src="${esc(avatarSrc)}" style="width:100%;height:100%;object-fit:cover;">`;
    } else {
      av.innerHTML = `<span style="font-size:11px;font-weight:bold;color:var(--fg2);">${esc((m.name||'?').charAt(0).toUpperCase())}</span>`;
    }
    row.appendChild(av);
    // 名前
    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = 'flex:1 1 0;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    nameSpan.textContent = m.name + (m.name === myName ? '（自分）' : '');
    nameSpan.title = nameSpan.textContent;
    row.appendChild(nameSpan);
    // ロール
    const role = m.role || 'editor';
    const sel = document.createElement('select');
    sel.className = 'gb-select';
    sel.style.cssText = 'font-size:11px;padding:1px 4px;width:78px;flex-shrink:0;';
    for (const [val, label] of Object.entries(roleLabels)) {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = label;
      if (val === role) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', async () => {
      try {
        await apiPost('/team/role', { name: m.name, role: sel.value, folder: folderPath });
        if (m.name === myName) {
          _myTeamRoles[folderPath] = sel.value;
          _myTeamRole = sel.value;
        }
        showStatus(`${m.name} を${roleLabels[sel.value]}に変更しました`);
      } catch (e) { showStatus('ロール変更に失敗しました', true); }
    });
    row.appendChild(sel);
    // 最終アクセス
    if (m.last_seen) {
      const ts = document.createElement('span');
      ts.style.cssText = 'font-size:10px;color:var(--fg2);white-space:nowrap;flex-shrink:0;';
      ts.textContent = m.last_seen.replace('T', ' ').substring(0, 16);
      row.appendChild(ts);
    }
    container.appendChild(row);
  }
}

// ユーザー編集モーダル（管理者用）
// _showEditUserModal, addUserFromSettings, removeUserFromSettings, doLogout は廃止
// （チーム方式に移行 — ユーザー管理はマイプロフィールのみ）

// アバターアップロード
function _avatarPreviewHtml(dataUrl) {
  return `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover;">`;
}

async function _saveAvatarDataUrl(dataUrl, iconSpec) {
  localStorage.setItem('meldex-avatar', dataUrl);
  if (iconSpec) localStorage.setItem('meldex-avatar-spec', iconSpec);
  else localStorage.removeItem('meldex-avatar-spec');
  updateUserIcon();
  const preview = document.getElementById('settings-my-avatar');
  if (preview) preview.innerHTML = _avatarPreviewHtml(dataUrl);
  try { await apiPost('/team/sync', { name: getUsername(), avatar: dataUrl }); } catch {}
}

async function chooseAvatarIcon(anchorEl) {
  if (typeof GBIconAssets === 'undefined') {
    document.getElementById('avatar-upload-input')?.click();
    return;
  }
  GBIconAssets.openPicker({
    title: 'ユーザーアイコン',
    className: 'avatar-icon-picker',
    anchorEl: anchorEl || document.getElementById('settings-my-avatar'),
    current: localStorage.getItem('meldex-avatar-spec') || '',
    includeLucide: true,
    includeNoto: true,
    onSelect: async (spec) => {
      const normalized = GBIconAssets.normalizeSpec(spec);
      const dataUrl = GBIconAssets.toAvatarDataUrl(normalized, {
        bg: typeof _getAvatarBgColor === 'function' ? _getAvatarBgColor() : '#000000',
        fg: '#d4d4d4',
      });
      await _saveAvatarDataUrl(dataUrl, normalized);
      showStatus('アイコンを更新しました');
    },
  });
}

async function refreshAvatarIconColor(color) {
  const spec = localStorage.getItem('meldex-avatar-spec');
  if (!spec || typeof GBIconAssets === 'undefined') return;
  const bg = typeof _normalizeAvatarBgColor === 'function' ? _normalizeAvatarBgColor(color) : (color || '#000000');
  const dataUrl = GBIconAssets.toAvatarDataUrl(spec, { bg, fg: '#d4d4d4' });
  await _saveAvatarDataUrl(dataUrl, spec);
}

async function uploadAvatar(input) {
  const file = input.files?.[0];
  if (!file) return;
  // 画像を128x128にリサイズしてからチームファイルに同期
  const img = new Image();
  img.onload = async () => {
    const canvas = document.createElement('canvas');
    const size = 128;
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    // 中央トリミング
    const s = Math.min(img.width, img.height);
    const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
    ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
    const dataUrl = canvas.toDataURL('image/png');
    try {
      // localStorageにキャッシュ
      await _saveAvatarDataUrl(dataUrl, '');
      showStatus('アイコンを更新しました');
    } catch(e) { showStatus('アイコンの処理に失敗しました', true); }
    URL.revokeObjectURL(objUrl);
  };
  const objUrl = URL.createObjectURL(file);
  img.src = objUrl;
  input.value = '';
}

async function removeAvatar() {
  try {
    localStorage.removeItem('meldex-avatar');
    localStorage.removeItem('meldex-avatar-spec');
    await apiPost('/team/sync', { name: getUsername(), avatar: '' });
    // チームファイルからアバター削除完了
    showStatus('アイコンを削除しました');
    updateUserIcon();
    const preview = document.getElementById('settings-my-avatar');
    if (preview) {
      preview.style.background = typeof _getAvatarBgColor === 'function' ? _getAvatarBgColor() : '#000000';
      preview.innerHTML = `<span style="font-size:20px;font-weight:bold;color:var(--fg2);">${getUsername().charAt(0).toUpperCase()}</span>`;
    }
  } catch(e) {}
}

// ユーザーアイコンを更新
function updateUserIcon() {
  const el = document.getElementById('btn-' + 'user');
  const localName = getUsername();
  if (el) {
    el.title = localName || 'ユーザー';
    // localStorageのアバターを即座に表示
    const cachedAvatar = localStorage.getItem('meldex-avatar');
    if (cachedAvatar) {
      el.innerHTML = `<img src="${cachedAvatar}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;">`;
    } else {
      const ch = (localName || '?').charAt(0).toUpperCase();
      const avBg = typeof _getAvatarBgColor === 'function' ? _getAvatarBgColor() : '#000000';
      el.innerHTML = `<span class="user-avatar-bg" style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:${avBg};font-size:12px;font-weight:bold;color:var(--fg2);">${esc(ch)}</span>`;
    }
  }
  if (typeof updateLeftChromeUser === 'function') updateLeftChromeUser();
}

// ユーザーアバターHTML（チャットフキダシ用）
function getUserAvatarHtml(username, size) {
  size = size || 20;
  const fallbackChar = (typeof esc === 'function' ? esc((username || '?').charAt(0).toUpperCase()) : String((username || '?').charAt(0).toUpperCase()).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const baseStyle = `display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;flex-shrink:0;`;
  const rawSrc = window.MeldexDataAccess?.team?.avatarUrl?.(username || 'anonymous', {}) || `${API_BASE}/team/avatar/${encodeURIComponent(username)}?t=0`;
  const src = typeof esc === 'function' ? esc(rawSrc) : String(rawSrc).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<span style="${baseStyle}">
    <img src="${src}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex';">
    <span style="display:none;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;background:var(--bg4);font-size:${Math.round(size*0.55)}px;font-weight:bold;color:var(--fg2);">${fallbackChar}</span>
  </span>`;
}

// 旧認証関数（generatePassword, addUser, removeUser, doLogout）は廃止済み

function _syncSettingsModalOverlayForPanel(modalOrOverlay, panelName) {
  const overlay = modalOrOverlay?.classList?.contains?.('modal-overlay')
    ? modalOrOverlay
    : modalOrOverlay?.closest?.('.modal-overlay') || document.querySelector('.modal-overlay[data-settings-modal="1"]');
  if (!overlay) return;
  const canonical = typeof _settingsCanonicalPanelName === 'function' ? _settingsCanonicalPanelName(panelName || '') : panelName;
  const isThemePanel = canonical === 'テーマ';
  overlay.classList.toggle('no-dim', isThemePanel);
  overlay.dataset.settingsPreviewMode = isThemePanel ? 'theme' : '';
}

function _ensureSettingsThemePanelVisible(panelName, root) {
  const canonical = typeof _settingsCanonicalPanelName === 'function' ? _settingsCanonicalPanelName(panelName || '') : panelName;
  if (canonical !== 'テーマ' || typeof ensureSettingsThemePanel !== 'function') return;
  const scope = root?.closest?.('.modal') || root || document;
  const panel = scope.querySelector?.('.settings-panel[data-panel="テーマ"]');
  if (panel) ensureSettingsThemePanel(panel);
}

const _SETTINGS_PANEL_INIT_DATA_KEYS = {
  '全般': 'settingsInitGeneral',
  'テーマ': 'settingsInitTheme',
  'LLM': 'settingsInitLlm',
  'LLMコスト': 'settingsInitChatCost',
  'Discord Bot': 'settingsInitDiscordBot',
  'フィードバック': 'settingsInitFeedbackForm',
  'ユーザー': 'settingsInitUsers',
  '拡張機能': 'settingsInitExtensions',
  'ショートカット': 'settingsInitShortcuts',
  'ゴミ箱': 'settingsInitTrash',
  'データベース': 'settingsInitDatabaseMaintenance',
};

function _scheduleSettingsPanelInitialization(panelName, root, options = {}) {
  const canonical = typeof _settingsCanonicalPanelName === 'function' ? _settingsCanonicalPanelName(panelName || '') : panelName;
  const key = _SETTINGS_PANEL_INIT_DATA_KEYS[canonical];
  if (!key) return;
  const overlay = root?.classList?.contains?.('modal-overlay')
    ? root
    : root?.closest?.('.modal-overlay') || document.querySelector('.modal-overlay[data-settings-modal="1"]');
  const modal = overlay?.querySelector?.('.modal') || root?.closest?.('.modal');
  if (!modal || modal.dataset[key] === '1') return;
  modal.dataset[key] = '1';
  const run = () => {
    if (!modal.isConnected) return;
    if (canonical === '全般') {
      if (typeof loadOutlinerRootsForSettings === 'function') loadOutlinerRootsForSettings();
      if (typeof loadStorageInfoForSettings === 'function') loadStorageInfoForSettings();
      if (typeof loadMobileAccessUrlsForSettings === 'function') loadMobileAccessUrlsForSettings();
      if (typeof loadSettingsTransferStatusForSettings === 'function') loadSettingsTransferStatusForSettings();
      if (typeof _loadAutostartStateForSettings === 'function') _loadAutostartStateForSettings();
      return;
    }
    if (canonical === 'テーマ') {
      _ensureSettingsThemePanelVisible(canonical, modal);
      return;
    }
    if (canonical === 'LLM') {
      if (typeof _loadLlmConfigForSettings === 'function') _loadLlmConfigForSettings();
      if (typeof renderKnowledgeAutomationSettings === 'function') renderKnowledgeAutomationSettings(modal);
      return;
    }
    if (canonical === 'LLMコスト') {
      if (typeof renderChatCostSettings === 'function') renderChatCostSettings(modal);
      return;
    }
    if (canonical === 'Discord Bot') {
      if (typeof renderDiscordBotSettings === 'function') renderDiscordBotSettings(modal);
      return;
    }
    if (canonical === 'フィードバック' && typeof renderMeldexFeedbackPanel === 'function') {
      renderMeldexFeedbackPanel(modal);
      if (typeof renderMeldexFeedbackSettingsPanel === 'function') renderMeldexFeedbackSettingsPanel(modal);
      return;
    }
    if (canonical === 'ユーザー') {
      if (typeof loadUserListForSettings === 'function') loadUserListForSettings();
      if (typeof loadFileLockListForSettings === 'function') loadFileLockListForSettings();
      return;
    }
    if (canonical === '拡張機能' && typeof _loadExtensionStatus === 'function') {
      if (typeof renderNotionSyncSettings === 'function') renderNotionSyncSettings(modal);
      _loadExtensionStatus();
      return;
    }
    if (canonical === 'ショートカット') {
      const container = modal.querySelector('#shortcut-settings-container');
      if (container && typeof renderShortcutSettings === 'function') renderShortcutSettings(container);
      return;
    }
    if (canonical === 'ゴミ箱') {
      if (typeof renderTrashSettings === 'function') renderTrashSettings(modal);
      return;
    }
    if (canonical === 'データベース') {
      if (typeof renderDatabaseMaintenanceSettings === 'function') renderDatabaseMaintenanceSettings(modal);
      return;
    }
  };
  if (options.immediate === true) {
    run();
    return;
  }
  const defer = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (fn) => setTimeout(fn, 0);
  defer(() => setTimeout(run, 0));
}

function switchSettingsTab(el) {
  const tabName = typeof _settingsCanonicalPanelName === 'function' ? _settingsCanonicalPanelName(el.dataset.tab) : el.dataset.tab;
  // タブヘッダー (gb-inner-tab-active クラス切替、旧インライン style をクリア)
  el.parentElement.querySelectorAll('.settings-tab').forEach(t => {
    const active = t.dataset.tab === tabName;
    t.classList.toggle('gb-inner-tab-active', active);
    t.classList.toggle('active', active);
    t.style.borderBottomColor = '';
    t.style.color = '';
    t.style.fontWeight = '';
  });
  // パネル (hidden 属性で切替)
  el.closest('.modal').querySelectorAll('.settings-panel').forEach(p => {
    p.hidden = p.dataset.panel !== tabName;
    p.style.display = '';
  });
  _ensureSettingsThemePanelVisible(tabName, el);
  _syncSettingsModalOverlayForPanel(el, tabName);
  _scheduleSettingsPanelInitialization(tabName, el);
}

// モバイル: セクションドリルダウン
function _openSettingsSection(panelName) {
  const modal = document.querySelector('.modal-overlay .modal');
  if (!modal) return;
  panelName = typeof _settingsCanonicalPanelName === 'function' ? _settingsCanonicalPanelName(panelName) : panelName;
  const navList = document.getElementById('settings-nav-list');
  if (navList) navList.hidden = true;
  modal.querySelectorAll('.settings-panel').forEach(p => {
    p.hidden = p.dataset.panel !== panelName;
    p.style.display = '';
  });
  _ensureSettingsThemePanelVisible(panelName, modal);
  _syncSettingsModalOverlayForPanel(modal, panelName);
  _scheduleSettingsPanelInitialization(panelName, modal);
  const btnRow = modal.querySelector('.btn-row');
  if (btnRow) btnRow.hidden = false;
  const backBtn = document.getElementById('settings-back-btn');
  if (backBtn) backBtn.hidden = false;
  const headerText = document.getElementById('settings-header-text');
  if (headerText) {
    headerText.textContent = typeof _settingsPanelDisplayName === 'function'
      ? _settingsPanelDisplayName(panelName)
      : panelName;
  }
}
function _backToSettingsList() {
  const modal = document.querySelector('.modal-overlay .modal');
  if (!modal) return;
  modal.querySelectorAll('.settings-panel').forEach(p => { p.hidden = true; p.style.display = ''; });
  const btnRow = modal.querySelector('.btn-row');
  if (btnRow) btnRow.hidden = true;
  const navList = document.getElementById('settings-nav-list');
  if (navList) navList.hidden = false;
  const backBtn = document.getElementById('settings-back-btn');
  if (backBtn) backBtn.hidden = true;
  const headerText = document.getElementById('settings-header-text');
  if (headerText) headerText.innerHTML = '<span class="ico ico-settings"></span> 設定';
  _syncSettingsModalOverlayForPanel(modal, '');
  replaceIcons(modal);
}

async function _loadExtensionStatus() {
  const el = document.getElementById('ext-status');
  if (!el) return;
  el.innerHTML = '<span style="color:var(--fg2);">読み込み中...</span>';
  try {
    const status = await apiFetch('/extensions/status');
    const exts = [
      { key: 'pillow', name: 'Pillow（画像処理）', desc: '重複画像検出に必要', size: '~3MB', installed: status.pillow },
      { key: 'clip', name: 'CLIP（画像類似検索）', desc: 'テキストで画像を検索。Pillowも同時にインストールされます', size: '~2GB', installed: status.clip },
      { key: 'caldav', name: 'CalDAV（カレンダー同期）', desc: 'iPhone/Thunderbird等とカレンダーを双方向同期', size: '~5MB', installed: status.caldav },
    ];
    el.innerHTML = exts.map(ext => `<div style="display:flex;align-items:center;gap:10px;padding:8px;margin-bottom:6px;border:1px solid var(--border);border-radius:4px;background:var(--bg2);">
      <div style="flex:1;">
        <div style="font-weight:bold;font-size:13px;color:var(--fg);">${ext.name}</div>
        <div style="font-size:11px;color:var(--fg2);">${ext.desc}</div>
        <div style="font-size:11px;color:var(--fg2);">サイズ: ${ext.size}</div>
      </div>
      ${ext.installed
        ? `<span style="color:var(--green);font-size:12px;font-weight:bold;">${lucide('check', 12)} インストール済み</span>`
        : `<button data-action="_installExtension('${ext.key}', this)" style="padding:4px 14px;font-size:12px;background:var(--accent);color:var(--ui-fg-strong);border:none;border-radius:4px;cursor:pointer;">インストール</button>`
      }
    </div>`).join('');

    // CalDAVが有効なら接続情報を表示
    if (status.caldav) {
      try {
        const info = await apiFetch('/caldav/info');
        el.innerHTML += `<div style="padding:8px;margin-top:8px;border:1px solid var(--accent);border-radius:4px;background:var(--bg2);">
          <div style="font-weight:bold;font-size:13px;color:var(--accent);margin-bottom:6px;">CalDAV接続情報</div>
          <div style="font-size:12px;color:var(--fg);margin-bottom:4px;">URL: <code style="background:var(--bg);padding:2px 6px;border-radius:3px;user-select:all;">${esc(info.url)}</code></div>
          <div style="font-size:11px;color:var(--fg2);margin-bottom:2px;">iPhone: ${esc(info.instructions.iphone)}</div>
          <div style="font-size:11px;color:var(--fg2);margin-bottom:2px;">Thunderbird: ${esc(info.instructions.thunderbird)}</div>
          <div style="font-size:11px;color:var(--fg2);">Google: ${esc(info.instructions.google)}</div>
          <div style="margin-top:6px;display:flex;gap:6px;">
            <button data-action="apiPost('/caldav/sync-to-ics').then(r=>showStatus('同期完了: '+r.synced+'件'))" style="font-size:11px;padding:3px 10px;background:var(--bg3);color:var(--fg2);border:1px solid var(--border);border-radius:3px;cursor:pointer;">シート → CalDAV同期</button>
            <button data-action="apiPost('/caldav/sync-from-ics').then(r=>showStatus('取込: '+r.imported+'件, 更新: '+r.updated+'件'))" style="font-size:11px;padding:3px 10px;background:var(--bg3);color:var(--fg2);border:1px solid var(--border);border-radius:3px;cursor:pointer;">CalDAV → シート同期</button>
          </div>
        </div>`;
      } catch {}
    }
  } catch {
    el.innerHTML = '<span style="color:var(--red);">ステータスの取得に失敗しました</span>';
  }
}

async function _installExtension(key, btn) {
  btn.disabled = true;
  btn.textContent = 'インストール中...';
  btn.style.background = 'var(--bg4)';
  btn.style.color = 'var(--fg2)';
  try {
    const res = await apiPost('/extensions/install', { extension: key });
    if (res.ok) {
      btn.innerHTML = lucide('check', 12) + ' 完了（再起動で有効）';
      btn.style.background = 'var(--green)';
      btn.style.color = '#fff';
      showStatus(res.message);
    } else {
      btn.textContent = '失敗';
      btn.style.background = 'var(--red)';
      btn.style.color = '#fff';
      showStatus('インストール失敗: ' + res.error, true);
    }
  } catch (e) {
    btn.textContent = 'エラー';
    btn.style.background = 'var(--red)';
    btn.style.color = '#fff';
    showStatus('インストールエラー: ' + (e.message || e), true);
  }
}

const SETTINGS_RESET_HISTORY_SESSION_KEY = 'meldex:settings-reset-history';

function _captureAllLocalStorageSettings(extraKeys = []) {
  if (typeof captureLocalStorageSettings !== 'function') return null;
  const keys = new Set(Array.isArray(extraKeys) ? extraKeys.filter(Boolean) : []);
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) keys.add(key);
    }
  } catch {}
  return captureLocalStorageSettings([...keys]);
}

async function _captureSettingsResetSnapshot(extraStorageKeys = []) {
  const [sourceFolders, uiConfig] = await Promise.all([
    typeof captureOutlinerRootsSettingsSnapshot === 'function'
      ? captureOutlinerRootsSettingsSnapshot().catch(() => null)
      : Promise.resolve(null),
    typeof apiFetch === 'function'
      ? apiFetch('/ui-config').catch(() => ({}))
      : Promise.resolve({}),
  ]);
  return {
    storage: _captureAllLocalStorageSettings(extraStorageKeys),
    sourceFolders,
    uiConfig: uiConfig || {},
  };
}

async function _restoreSettingsResetSnapshot(snapshot) {
  if (!snapshot) return false;
  const storageSnapshot = snapshot.storage;
  if (storageSnapshot && typeof restoreLocalStorageSettings === 'function') {
    restoreLocalStorageSettings(storageSnapshot, keys => {
      if (typeof _restoreSettingsDialogStorageAfterHistory === 'function') {
        _restoreSettingsDialogStorageAfterHistory(keys);
      }
    });
  }
  if (typeof apiPut === 'function') {
    try { await apiPut('/ui-config', snapshot.uiConfig || {}); } catch {}
  }
  if (snapshot.sourceFolders && typeof _restoreOutlinerRootsSettingsSnapshot === 'function') {
    await _restoreOutlinerRootsSettingsSnapshot(snapshot.sourceFolders);
  } else if (typeof loadOutliner === 'function') {
    try { await loadOutliner(); } catch {}
  }
  return true;
}

async function _registerPendingSettingsResetHistory() {
  let raw = '';
  try { raw = sessionStorage.getItem(SETTINGS_RESET_HISTORY_SESSION_KEY) || ''; } catch {}
  if (!raw) return;
  try { sessionStorage.removeItem(SETTINGS_RESET_HISTORY_SESSION_KEY); } catch {}
  let payload = null;
  try { payload = JSON.parse(raw); } catch {}
  const before = payload?.before;
  if (!before || typeof historyPush !== 'function') return;
  const beforeKeys = before.storage?.keys || Object.keys(before.storage?.storage || {});
  const after = await _captureSettingsResetSnapshot(beforeKeys);
  let beforeStorage = before.storage;
  let afterStorage = after.storage;
  if (typeof _normalizeLocalStorageSettingsSnapshots === 'function') {
    const normalized = _normalizeLocalStorageSettingsSnapshots(before.storage, after.storage);
    beforeStorage = normalized.before;
    afterStorage = normalized.after;
  }
  const undoSnapshot = { ...before, storage: beforeStorage };
  const redoSnapshot = { ...after, storage: afterStorage };
  historyPush(
    '設定: 全設定初期化',
    () => _restoreSettingsResetSnapshot(undoSnapshot),
    () => _restoreSettingsResetSnapshot(redoSnapshot),
    'settings:reset',
    'リセット前の設定を復元'
  );
}

function _schedulePendingSettingsResetHistoryRegistration() {
  let attempts = 0;
  const run = () => {
    if (typeof historyPush !== 'function' && attempts < 20) {
      attempts += 1;
      setTimeout(run, 250);
      return;
    }
    _registerPendingSettingsResetHistory().catch(() => {});
  };
  setTimeout(run, 250);
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _schedulePendingSettingsResetHistoryRegistration, { once: true });
  } else {
    _schedulePendingSettingsResetHistoryRegistration();
  }
}

async function resetAllSettings() {
  const beforeReset = await _captureSettingsResetSnapshot();
  try {
    sessionStorage.setItem(SETTINGS_RESET_HISTORY_SESSION_KEY, JSON.stringify({ before: beforeReset, at: Date.now() }));
  } catch {}
  localStorage.clear();
  // サーバー側の設定もクリア
  try { await apiPut('/outliner-roots', { roots: [] }); } catch {}
  try { await apiPut('/ui-config', {}); } catch {}
  try { await apiPut('/vault', { path: '' }); } catch {}
  location.reload();
}

async function submitSettings() {
  showLoading('設定を保存中...');
  try {
  const settingsOverlay = document.querySelector('.modal-overlay[data-settings-modal="1"]');
  const settingsHistoryBefore = typeof _captureSettingsDialogStorageSnapshot === 'function'
    ? _captureSettingsDialogStorageSnapshot()
    : null;
  // select の change が未発火でも、保存前に共通フォントをテーマ変数へ確定する。
  const fontFamily = document.getElementById('modal-font-family')?.value || '';
  if (typeof settingsThemeApplyCommonFont === 'function') settingsThemeApplyCommonFont(fontFamily);

  // テーマ編集があれば、設定ダイアログの保存ボタンでも選択中テーマへ反映する。
  if (typeof settingsThemeSaveFromSettingsDialog === 'function') {
    const themeSaveOk = await settingsThemeSaveFromSettingsDialog({ skipRefresh: true });
    if (themeSaveOk === false) return;
  }

  if (typeof savePublishSettingsFromPanel === 'function') {
    const publishSaveOk = await savePublishSettingsFromPanel(settingsOverlay);
    if (publishSaveOk === false) return;
  }

  if (typeof saveDiscordBotSettingsFromSettingsDialog === 'function') {
    const discordSaveOk = await saveDiscordBotSettingsFromSettingsDialog({ silent: true, skipRender: true });
    if (discordSaveOk === false) return;
  }

  if (typeof saveChatCostSettingsFromSettingsDialog === 'function') {
    const chatCostSaveOk = await saveChatCostSettingsFromSettingsDialog(settingsOverlay, { silent: true });
    if (chatCostSaveOk === false) return;
  }

  // テーマをlocalStorageに保存
  saveColorSettings();

/* Source chunk: gb-settings.part04.js */
/* gb-settings.part04.js */
  // 表示サイズ（zoom）
  try {
    const uiScale = document.getElementById('modal-ui-scale')?.value;
    if (uiScale) applyUIScale(parseInt(uiScale) || 100);
  } catch (e) { console.warn('UIスケール適用失敗:', e); }

  const filterSharedCb = document.getElementById('modal-outliner-filter-shared');
  if (filterSharedCb) {
    if (typeof setOutlinerFilterShared === 'function') setOutlinerFilterShared(filterSharedCb.checked);
    else localStorage.setItem('gb:outliner-filter-shared', filterSharedCb.checked ? '1' : '0');
  }

  const statusbarHiddenCb = document.getElementById('modal-statusbar-hidden');
  if (statusbarHiddenCb) {
    if (statusbarHiddenCb.checked) localStorage.setItem('meldex-statusbar-hidden', '1');
    else localStorage.removeItem('meldex-statusbar-hidden');
    if (typeof applyStatusbarHidden === 'function') applyStatusbarHidden(statusbarHiddenCb.checked);
  }
  [
    ['modal-a11y-high-contrast', 'highContrast'],
    ['modal-a11y-reduced-motion', 'reducedMotion'],
    ['modal-a11y-colorblind-safe', 'colorblindSafe'],
  ].forEach(([id, pref]) => {
    const cb = document.getElementById(id);
    if (!cb) return;
    if (window.MeldexAccessibility?.setPreference) {
      window.MeldexAccessibility.setPreference(pref, cb.checked);
    }
  });

  // 自動起動設定
  const autostartCb = document.getElementById('modal-autostart');
  const autostartSection = document.getElementById('settings-autostart-section');
  if (autostartCb && !autostartSection?.hidden) {
    await apiPost('/autostart', { enabled: autostartCb.checked });
  }

  // バージョン管理設定
  const vInterval = parseInt(document.getElementById('modal-version-interval')?.value || '3600000');
  const vMax = parseInt(document.getElementById('modal-version-max')?.value || '30');
  saveVersionConfig({ autoInterval: vInterval, maxAuto: vMax });
  // タイマーを再設定
  if (_autoVersionPath) startAutoVersion(_autoVersionPath, _autoVersionType);

  // ユーザー名保存 + チームプロフィール同期
  const username = document.getElementById('modal-username')?.value?.trim();
  if (username) {
    const oldUsername = getUsername();
    localStorage.setItem('meldex-user', JSON.stringify({ name: username }));
    // チームファイルのメンバー名を更新
    if (oldUsername && oldUsername !== username) {
      await apiPost('/team/remove', { name: oldUsername }).catch(() => {});
    }
    const avatar = localStorage.getItem('meldex-avatar') || '';
    await apiPost('/team/sync', { name: username, avatar }).catch(() => {});
  }

  // LLM APIキー保存
  const chatKeys = {};
  const gk = document.getElementById('modal-gemini-key')?.value;
  const ak = document.getElementById('modal-anthropic-key')?.value;
  const ok = document.getElementById('modal-openai-key')?.value;
  if (gk && !gk.startsWith('●')) chatKeys.GEMINI_API_KEY = gk;
  if (ak && !ak.startsWith('●')) chatKeys.ANTHROPIC_API_KEY = ak;
  if (ok && !ok.startsWith('●')) chatKeys.OPENAI_API_KEY = ok;
  if (Object.keys(chatKeys).length > 0) {
    if (!window.MeldexLlmKeys?.setMany) throw new Error('APIキー保存ストアを初期化できませんでした');
    await window.MeldexLlmKeys.setMany(chatKeys);
    if (typeof loadProviderModels === 'function') {
      ['gemini', 'anthropic', 'openai'].forEach(provider => {
        loadProviderModels(provider, { force: true }).catch(() => {});
      });
    }
    if (typeof _chatRefreshApiKeyState === 'function') _chatRefreshApiKeyState().catch(() => {});
  }

  if (typeof saveCliChatSettingsFromSettingsDialog === 'function') {
    const cliChatSaveOk = await saveCliChatSettingsFromSettingsDialog(settingsOverlay, { silent: true, skipReload: true, backgroundChatRefresh: true });
    if (cliChatSaveOk === false) return;
  }

  const allowWebSearchCb = document.getElementById('modal-chat-allow-web-search');
  if (allowWebSearchCb) localStorage.setItem('chat-allow-web-search', allowWebSearchCb.checked ? '1' : '0');
  const autoCompressCb = document.getElementById('modal-chat-auto-compress');
  if (autoCompressCb) localStorage.setItem('chat-auto-compress', autoCompressCb.checked ? '1' : '0');
  const allowCodeExecutionCb = document.getElementById('modal-chat-allow-code-execution');
  if (allowCodeExecutionCb) localStorage.setItem('chat-allow-code-execution', allowCodeExecutionCb.checked ? '1' : '0');
  const reasoningLevelEl = document.getElementById('modal-chat-reasoning-level');
  if (reasoningLevelEl) localStorage.setItem('chat-reasoning-level', reasoningLevelEl.value || 'off');
  const paramPresetEl = document.getElementById('modal-chat-param-preset');
  if (paramPresetEl) localStorage.setItem('chat-param-preset', paramPresetEl.value || 'standard');
  ['temperature', 'max-tokens', 'top-p'].forEach(key => {
    const input = document.getElementById('modal-chat-' + key);
    if (!input) return;
    const value = input.value?.trim() || '';
    if (value) localStorage.setItem('chat-' + key, value);
    else localStorage.removeItem('chat-' + key);
  });
  [
    ['modal-chat-custom-about', 'chat-custom-about'],
    ['modal-chat-custom-instructions', 'chat-custom-instructions'],
  ].forEach(([id, key]) => {
    const input = document.getElementById(id);
    if (!input) return;
    const value = input.value?.trim() || '';
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  });
  const sourceFolderForInstruction = typeof _chatSourceFolderValue === 'function' ? _chatSourceFolderValue() : '';
  if (sourceFolderForInstruction) {
    const suffix = ':' + encodeURIComponent(sourceFolderForInstruction);
    [
      ['modal-chat-source-custom-about', 'chat-custom-about' + suffix],
      ['modal-chat-source-custom-instructions', 'chat-custom-instructions' + suffix],
    ].forEach(([id, key]) => {
      const input = document.getElementById(id);
      if (!input) return;
      const value = input.value?.trim() || '';
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    });
  }
  if (typeof saveKnowledgeAutomationSettingsFromModal === 'function') {
    saveKnowledgeAutomationSettingsFromModal(document);
  }

  // ヒストリー設定
  const histMax = parseInt(document.getElementById('modal-history-max')?.value || '50');
  setHistoryMax(Math.max(1, Math.min(200, histMax)));

  const sourceFoldersDirty = !!window._settingsOutlinerRootsDirty;
  const sourceFolderHistoryBefore = sourceFoldersDirty && typeof captureOutlinerRootsSettingsSnapshot === 'function'
    ? await captureOutlinerRootsSettingsSnapshot().catch(() => null)
    : null;

  // フォルダツリールートを保存
  if (sourceFoldersDirty) {
    if (!await saveOutlinerRoots()) {
      throw new Error('フォルダツリールートの保存に失敗しました');
    }

    // 最初の可視ルートをルートフォルダパスとして同期（後方互換）
    const firstVisible = _outlinerRoots.find(r => r.visible && r.path && r.path !== '.');
    if (firstVisible) {
      const currentVaultPath = state.vaultPath || '';
      if (firstVisible.path !== currentVaultPath) {
        await apiPut('/vault', { path: firstVisible.path });
        state.vaultPath = firstVisible.path;
      }
    }

    if (sourceFolderHistoryBefore && typeof pushOutlinerRootsSettingsHistory === 'function'
      && typeof captureOutlinerRootsSettingsSnapshot === 'function') {
      const sourceFolderHistoryAfter = await captureOutlinerRootsSettingsSnapshot().catch(() => null);
      pushOutlinerRootsSettingsHistory('設定: ソースフォルダ保存', sourceFolderHistoryBefore, sourceFolderHistoryAfter);
    }
    window._settingsOutlinerRootsDirty = false;
  }

    // UI設定をサーバーにも永続保存
    if (settingsHistoryBefore && typeof _pushSettingsDialogStorageHistory === 'function') {
      _pushSettingsDialogStorageHistory('設定: 共通設定保存', settingsHistoryBefore);
    }
    _saveUiConfigToServer();

    // ダイアログを閉じて、保存完了を先にユーザーへ返す。
    // フォルダツリー再読込などの重い後処理は閉じる動作をブロックしない。
    settingsOverlay?.remove();
    showStatus('設定を保存しました', false, { showSaveDialog: true });
    // ユーザー表示を更新（ユーザー名変更 / アバター設定を反映）
    try { if (typeof updateUserIcon === 'function') updateUserIcon(); } catch {}
    try { if (typeof updateLeftChromeUser === 'function') updateLeftChromeUser(); } catch {}
    // フォルダツリーを再読み込み
    try {
      const outlinerReload = typeof loadOutliner === 'function' ? loadOutliner() : null;
      outlinerReload?.catch?.(() => {});
    } catch {}
  } catch (err) {
    console.error('設定保存エラー:', err);
    showStatus('設定の保存に失敗: ' + (err?.message || err), true);
    document.querySelector('.modal-overlay[data-settings-modal="1"]')?.remove();
  } finally {
    hideLoading();
  }
}

function _settingsCliEsc(value) {
  return typeof esc === 'function'
    ? esc(value)
    : String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _settingsCliIcon(name, size) {
  return typeof lucide === 'function' ? lucide(name, size || 14) : '';
}

function _settingsCliProviderRows(config) {
  const providers = config?.providers || {};
  const order = ['codex', 'claude_code', 'gemini_cli'];
  const labels = {
    codex: 'Codex CLI',
    claude_code: 'Claude Code',
    gemini_cli: 'Gemini CLI',
  };
  return order.map(key => {
    const item = providers[key] || {};
    const label = item.label || labels[key] || key;
    const command = item.command || (key === 'claude_code' ? 'claude' : key === 'gemini_cli' ? 'gemini' : 'codex');
    const available = item.available !== false;
    const statusText = available ? '検出済み' : '未検出';
    const statusColor = available ? 'var(--accent)' : 'var(--red)';
    return `
      <div class="settings-cli-chat-row" data-provider="${_settingsCliEsc(key)}" style="display:grid;grid-template-columns:minmax(115px,1fr) minmax(120px,1fr) 72px;gap:8px;align-items:center;margin-top:8px;">
        <label class="gb-check" style="min-width:0;">
          <input type="checkbox" data-e2e-id="settings-cli-chat-${_settingsCliEsc(key)}-enabled" data-cli-chat-field="enabled" ${item.enabled === false ? '' : 'checked'}>
          <span>${_settingsCliEsc(label)}</span>
        </label>
        <input class="gb-input" data-e2e-id="settings-cli-chat-${_settingsCliEsc(key)}-command" data-cli-chat-field="command" value="${_settingsCliEsc(command)}" placeholder="${_settingsCliEsc(command)}">
        <span style="font-size:11px;color:${statusColor};white-space:nowrap;">${_settingsCliEsc(statusText)}</span>
      </div>`;
  }).join('');
}

function _renderCliChatSettingsContainer(container, config) {
  if (!container) return;
  container.innerHTML = `
    <label class="gb-check" style="margin-top:4px;">
      <input id="settings-cli-chat-enabled" type="checkbox" ${config?.enabled === false ? '' : 'checked'}>
      <span>CLIチャットを有効にする</span>
    </label>
    <div class="gb-section-desc" style="margin-top:6px;">コマンド名は、ターミナルで実行する名前と同じにしてください。例: <code>codex</code> / <code>claude</code> / <code>gemini</code></div>
    <div style="margin-top:4px;">${_settingsCliProviderRows(config)}</div>
    <div class="btn-row" style="justify-content:flex-start;gap:8px;margin-top:10px;flex-wrap:wrap;">
      <button type="button" class="gb-btn gb-btn-sm" id="settings-cli-chat-refresh">${_settingsCliIcon('refreshCw',14)} 状態を更新</button>
      <button type="button" class="gb-btn gb-btn-sm" id="settings-cli-chat-save">${_settingsCliIcon('save',14)} CLIチャット設定を保存</button>
    </div>
    <div id="settings-cli-chat-status" class="gb-section-desc" style="margin-top:6px;"></div>
  `;
  container.querySelector('#settings-cli-chat-refresh')?.addEventListener('click', () => renderCliChatSettingsForSettings(container.closest('.modal-overlay') || document));
  container.querySelector('#settings-cli-chat-save')?.addEventListener('click', () => saveCliChatSettingsFromSettingsDialog(container.closest('.modal-overlay') || document));
  if (typeof replaceIcons === 'function') replaceIcons(container);
}

async function renderCliChatSettingsForSettings(root) {
  const scope = root?.querySelector ? root : document;
  const container = scope.querySelector('#settings-cli-chat-container') || document.getElementById('settings-cli-chat-container');
  if (!container) return;
  container.innerHTML = '<div class="gb-section-desc">CLIチャット設定を読み込み中...</div>';
  try {
    const config = await apiFetch('/cli-chat/config');
    _renderCliChatSettingsContainer(container, config);
  } catch (e) {
    container.innerHTML = `<div class="gb-section-desc" style="color:var(--red);">CLIチャット設定を読み込めませんでした: ${_settingsCliEsc(e?.message || e)}</div>`;
  }
}

async function saveCliChatSettingsFromSettingsDialog(root, options = {}) {
  const scope = root?.querySelector ? root : document;
  const container = scope.querySelector('#settings-cli-chat-container') || document.getElementById('settings-cli-chat-container');
  if (!container || !container.querySelector('[data-provider]')) return true;
  const providers = {};
  container.querySelectorAll('[data-provider]').forEach(row => {
    const key = row.dataset.provider || '';
    if (!key) return;
    const enabled = row.querySelector('[data-cli-chat-field="enabled"]')?.checked !== false;
    const command = row.querySelector('[data-cli-chat-field="command"]')?.value?.trim() || '';
    providers[key] = { enabled, command };
  });
  const body = {
    cli_chat_enabled: document.getElementById('settings-cli-chat-enabled')?.checked !== false,
    cli_chat_providers: providers,
  };
  const status = container.querySelector('#settings-cli-chat-status');
  try {
    if (status) {
      status.textContent = '保存中...';
      status.style.color = 'var(--fg2)';
    }
    await apiPut('/cli-chat/config', body);
    if (status) {
      status.textContent = '保存しました。未検出のままならMeldexを再起動してください。';
      status.style.color = 'var(--fg2)';
    }
    if (typeof window.GBChatCli?.loadChatConfig === 'function') {
      const reload = window.GBChatCli.loadChatConfig().catch(() => {});
      if (!options.backgroundChatRefresh) await reload;
    }
    if (typeof _chatRefreshApiKeyState === 'function') _chatRefreshApiKeyState().catch(() => {});
    if (!options.skipReload) {
      await renderCliChatSettingsForSettings(container.closest('.modal-overlay') || document);
    }
    if (!options.silent && typeof showStatus === 'function') showStatus('CLIチャット設定を保存しました');
    return true;
  } catch (e) {
    if (status) {
      status.textContent = '保存に失敗しました: ' + (e?.message || e);
      status.style.color = 'var(--red)';
    }
    if (!options.silent && typeof showStatus === 'function') showStatus('CLIチャット設定の保存に失敗しました', true);
    return false;
  }
}

/* Notion同期 → gb-notion-sync.js に分離 */
/* ==============================
   ゴミ箱
   ============================== */
function openTrashFromFolderTree() {
  if (typeof showTrashModal === 'function') showTrashModal();
}

async function showTrashModal() {
  const o = document.createElement('div');
  o.className = 'modal-overlay';

  let items = [];
  let loadError = null;
  try {
    const data = await apiFetch('/trash');
    items = data.items || [];
  } catch (e) {
    loadError = e;
    if (typeof showStatus === 'function') showStatus('ゴミ箱の読み込みに失敗しました', true);
  }

  function renderList() {
    let html = '';
    if (loadError) {
      html = `<div style="padding:16px;color:var(--red);text-align:center;">ゴミ箱の読み込みに失敗しました: ${esc(loadError.message || loadError)}</div>`;
    } else if (items.length === 0) {
      html = '<div style="padding:16px;color:var(--fg2);text-align:center;">ゴミ箱は空です</div>';
    } else {
      items.forEach((it, i) => {
        const icon = it.type === 'folder' ? lucide('folder', 18) : lucide('page', 18);
        const info = it.type === 'folder' ? `（${it.size}件）` : '';
        const delDate = it.deleted_at ? new Date(it.deleted_at).toLocaleString('ja-JP') : '';
        const origPath = it.original_path || '';
        const rootName = it.trash_root_name || '';
        html += `<div style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-bottom:1px solid var(--border);font-size:13px;">
          <span>${icon}</span>
          <div style="flex:1;overflow:hidden;min-width:0;">
            <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(it.name)}${info}</div>
            <div style="font-size:11px;color:var(--fg2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${rootName ? esc(rootName) + ' / ' : ''}${origPath ? '元: '+esc(origPath) : ''}${delDate ? ' | '+delDate : ''}</div>
          </div>
          <button data-action="trashRestore(${i})" style="font-size:11px;padding:1px 6px;background:var(--bg3);color:var(--accent);border:1px solid var(--border);border-radius:3px;cursor:pointer;">復元</button>
          <button data-action="trashDelete(${i})" style="font-size:11px;padding:1px 6px;background:var(--bg3);color:var(--red);border:1px solid var(--border);border-radius:3px;cursor:pointer;">削除</button>
        </div>`;
      });
    }
    return html;
  }

  o.innerHTML = `<div class="modal" style="min-width:450px;">
    <h3>${lucide('trash2',16)} ゴミ箱</h3>
    <div id="trash-list" style="max-height:400px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;">${renderList()}</div>
    <div class="btn-row" style="margin-top:12px;">
      <button data-action="trashEmpty()" style="color:var(--red);">ゴミ箱を空にする</button>
      <span style="flex:1;"></span>
      <button data-action="this.closest('.modal-overlay').remove()">閉じる</button>
    </div>
  </div>`;
  document.body.appendChild(o);

  // グローバル関数として公開（data-action属性から呼ぶため）
  window._trashItems = items;
  window._trashModal = o;
}

async function trashRestore(idx) {
  const item = window._trashItems?.[idx];
  const name = item?.name;
  if (!name) return;
  try {
    const res = await apiPost('/trash/restore', { name, ...(item.trash_root ? { trash_root: item.trash_root } : {}) });
    showStatus(`「${name}」を復元しました → ${res.restored_to}`);
    window._trashItems.splice(idx, 1);
    await loadOutliner();
    window._trashModal?.remove();
    showTrashModal();
  } catch (e) {
    showStatus('復元に失敗しました: ' + (e.message || e), true);
  }
}

async function trashDelete(idx) {
  const item = window._trashItems?.[idx];
  const name = item?.name;
  if (!name) return;
  if (!await cfConfirm(`「${name}」を完全に削除しますか？この操作は取り消せません。`)) return;
  try {
    await apiPost('/trash/delete', { name, ...(item.trash_root ? { trash_root: item.trash_root } : {}) });
    showStatus(`「${name}」を完全に削除しました`);
    window._trashItems.splice(idx, 1);
    window._trashModal?.remove();
    showTrashModal();
  } catch (e) {
    showStatus('完全削除に失敗しました: ' + (e.message || e), true);
  }
}

async function trashEmpty() {
  if (!await cfConfirm('ゴミ箱を空にしますか？この操作は取り消せません。')) return;
  try {
    await apiPost('/trash/empty', {});
    showStatus('ゴミ箱を空にしました');
    window._trashModal?.remove();
    showTrashModal();
  } catch (e) {
    showStatus('ゴミ箱を空にできませんでした: ' + (e.message || e), true);
  }
}

function _formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024 * 1024) return (value / 1024 / 1024 / 1024).toFixed(1) + ' GB';
  if (value >= 1024 * 1024) return (value / 1024 / 1024).toFixed(1) + ' MB';
  if (value >= 1024) return (value / 1024).toFixed(1) + ' KB';
  return value + ' B';
}

async function _loadDataProtectionStatus() {
  return apiFetch('/data-protection/status');
}

async function renderTrashSettings(root) {
  const container = (root?.querySelector ? root : document).querySelector('#trash-settings-container');
  if (!container) return;
  container.innerHTML = `<section class="gb-section gb-section--boxed"><div class="gb-section-title">${lucide('trash2',14)} ゴミ箱</div><div class="gb-section-desc">読み込み中...</div></section>`;
  try {
    const status = await _loadDataProtectionStatus();
    const settings = status.settings || {};
    const retention = Number(settings.trash_retention_days ?? 30);
    const trashRoots = Array.isArray(status.trash?.roots) ? status.trash.roots : [];
    const trashPathHtml = trashRoots.length
      ? trashRoots.map(root => `<div class="gb-section-desc" style="word-break:break-all;">${esc(root.path || '')}: ${root.items || 0}件 / ${_formatBytes(root.bytes || 0)}</div>`).join('')
      : '<div class="gb-section-desc">ゴミ箱フォルダはまだ作成されていません。</div>';
    container.innerHTML = `
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('trash2',14)} ゴミ箱の保持</div>
        <label class="gb-field-row">
          <span class="gb-label">保持日数</span>
          <select id="settings-trash-retention" class="gb-select">
            ${[[7,'7日'],[30,'30日'],[90,'90日'],[0,'無期限']].map(([value, label]) => `<option value="${value}" ${retention === value ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
        <div class="gb-section-desc">現在: ${status.trash?.items || 0}件 / ${_formatBytes(status.trash?.bytes || 0)}</div>
        ${trashPathHtml}
        <div class="gb-section-desc">Dropbox内のソースフォルダを使う場合、_trash フォルダも同期対象です。Dropbox側で削除するとMeldexから復元できません。</div>
        <div class="gb-field-row" style="justify-content:flex-start;">
          <button type="button" class="gb-btn gb-btn-sm" id="settings-trash-save">保持日数を保存</button>
          <button type="button" class="gb-btn gb-btn-sm" id="settings-trash-cleanup">期限切れを削除</button>
          <button type="button" class="gb-btn gb-btn-sm" id="settings-trash-open">復元一覧を開く</button>
        </div>
        <div id="settings-trash-status" class="gb-section-desc"></div>
      </section>`;
    const statusEl = container.querySelector('#settings-trash-status');
    container.querySelector('#settings-trash-save')?.addEventListener('click', async () => {
      const next = Number(container.querySelector('#settings-trash-retention')?.value || 30);
      await apiPut('/data-protection/settings', { trash_retention_days: next });
      statusEl.textContent = '保持日数を保存しました';
    });
    container.querySelector('#settings-trash-cleanup')?.addEventListener('click', async () => {
      const next = Number(container.querySelector('#settings-trash-retention')?.value || 30);
      const res = await apiPost('/data-protection/trash-cleanup', { trash_retention_days: next });
      statusEl.textContent = `削除: ${res.deleted || 0}件 / 残り ${_formatBytes(res.bytes || 0)}`;
    });
    container.querySelector('#settings-trash-open')?.addEventListener('click', () => showTrashModal());
  } catch (error) {
    container.innerHTML = `<section class="gb-section gb-section--boxed"><div class="gb-section-title">${lucide('triangleAlert',14)} ゴミ箱</div><div class="gb-section-desc">読み込みに失敗しました: ${esc(error.message || error)}</div></section>`;
  }
}

async function renderDatabaseMaintenanceSettings(root) {
  const container = (root?.querySelector ? root : document).querySelector('#database-maintenance-container');
  if (!container) return;
  container.innerHTML = `<section class="gb-section gb-section--boxed"><div class="gb-section-title">${lucide('database',14)} データベースメンテナンス</div><div class="gb-section-desc">読み込み中...</div></section>`;
  try {
    const status = await _loadDataProtectionStatus();
    const settings = status.settings || {};
    const tables = status.tables || {};
    container.innerHTML = `
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('database',14)} 整合性とバックアップ</div>
        <div class="gb-section-desc">整合性: ${esc(status.integrity?.message || '')}</div>
        <div class="gb-section-desc">バックアップ先: ${esc(status.backupDir || '')}</div>
        <div class="gb-section-desc">最終バックアップ: ${esc(settings.last_db_backup_at || '未実行')}</div>
        <div class="gb-field-row" style="justify-content:flex-start;">
          <button type="button" class="gb-btn gb-btn-sm" id="settings-db-backup">今すぐバックアップ</button>
          <button type="button" class="gb-btn gb-btn-sm" id="settings-db-cleanup">TTLクリーンアップ</button>
          <button type="button" class="gb-btn gb-btn-sm" id="settings-db-export">バックアップを別フォルダへエクスポート</button>
        </div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('clock',14)} 保持期間</div>
        <label class="gb-field-row"><span class="gb-label">操作履歴</span><input id="settings-db-audit-ttl" type="number" min="0" class="gb-input" style="width:90px;" value="${Number(settings.db_audit_log_ttl_days || 90)}"><span class="gb-section-desc">日（0で無期限）</span></label>
        <label class="gb-field-row"><span class="gb-label">カレンダーログ</span><input id="settings-db-calendar-ttl" type="number" min="0" class="gb-input" style="width:90px;" value="${Number(settings.calendar_log_ttl_days || 365)}"><span class="gb-section-desc">日</span></label>
        <label class="gb-field-row"><span class="gb-label">LLM利用ログ</span><input id="settings-db-chat-ttl" type="number" min="0" class="gb-input" style="width:90px;" value="${Number(settings.chat_usage_log_ttl_days || 365)}"><span class="gb-section-desc">日</span></label>
        <button type="button" class="gb-btn gb-btn-sm" id="settings-db-ttl-save">保持期間を保存</button>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('table',14)} 現在の件数</div>
        <div class="gb-section-desc">操作履歴: ${tables.db_audit_log || 0} / カレンダー: ${tables.cal_time_entries || 0} / LLM利用: ${tables.chat_usage_log || 0} / 検索ベクトル: ${tables.vault_vec_items || 0}</div>
        <div id="settings-db-maintenance-status" class="gb-section-desc"></div>
      </section>`;
    const statusEl = container.querySelector('#settings-db-maintenance-status');
    container.querySelector('#settings-db-ttl-save')?.addEventListener('click', async () => {
      await apiPut('/data-protection/settings', {
        db_audit_log_ttl_days: Number(container.querySelector('#settings-db-audit-ttl')?.value || 90),
        calendar_log_ttl_days: Number(container.querySelector('#settings-db-calendar-ttl')?.value || 365),
        chat_usage_log_ttl_days: Number(container.querySelector('#settings-db-chat-ttl')?.value || 365),
      });
      statusEl.textContent = '保持期間を保存しました';
    });
    container.querySelector('#settings-db-backup')?.addEventListener('click', async () => {
      const res = await apiPost('/data-protection/db-backup', {});
      statusEl.textContent = res.ok ? 'バックアップを作成しました: ' + res.path : 'バックアップはスキップされました';
    });
    container.querySelector('#settings-db-cleanup')?.addEventListener('click', async () => {
      const res = await apiPost('/data-protection/db-cleanup', {});
      statusEl.textContent = 'クリーンアップ完了: ' + JSON.stringify(res.deleted || {});
    });
    container.querySelector('#settings-db-export')?.addEventListener('click', async () => {
      const destination = await cfPrompt('バックアップのエクスポート先フォルダ', status.backupDir || '');
      if (!destination) return;
      const res = await apiPost('/data-protection/export-backup', { destination });
      statusEl.textContent = res.ok ? 'エクスポートしました: ' + res.path : 'エクスポートできませんでした';
    });
  } catch (error) {
    container.innerHTML = `<section class="gb-section gb-section--boxed"><div class="gb-section-title">${lucide('triangleAlert',14)} データベースメンテナンス</div><div class="gb-section-desc">読み込みに失敗しました: ${esc(error.message || error)}</div></section>`;
  }
}

function _formatUsd(value) {
  const number = Number(value || 0);
  return '$' + number.toFixed(number >= 1 ? 2 : 4) + '（' + _formatApproxJpyFromUsd(number) + '）';
}

const CHAT_COST_USD_JPY_APPROX_RATE = 156;

function _formatApproxJpyFromUsd(value) {
  const amount = Number(value || 0) * CHAT_COST_USD_JPY_APPROX_RATE;
  if (!Number.isFinite(amount) || amount === 0) return '約0円';
  if (Math.abs(amount) < 1) {
    return '約' + amount.toFixed(2).replace(/\.?0+$/, '') + '円';
  }
  return '約' + Math.round(amount).toLocaleString('ja-JP') + '円';
}

const CHAT_COST_DEFAULTS = {
  monthly_budget_usd: 300,
  daily_budget_usd: 30,
  session_budget_usd: 100,
  max_concurrent_requests: 60,
  max_tool_iterations: 300,
  max_retry_attempts: 60,
  large_context_warning_tokens: 4800000,
  large_context_block_tokens: 6000000,
};

function _chatCostRoot(root) {
  return (root?.querySelector ? root : document).querySelector('#chat-cost-settings-container');
}

function _chatCostNumber(container, id, fallback) {
  const value = container?.querySelector?.('#' + id)?.value;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

async function saveChatCostSettingsFromSettingsDialog(root, options = {}) {
  const container = _chatCostRoot(root);
  if (!container || !container.querySelector('#chat-budget-monthly')) return true;
  const statusEl = container.querySelector('#chat-budget-status');
  try {
    await apiPut('/chat/budget', {
      monthly_budget_usd: _chatCostNumber(container, 'chat-budget-monthly', CHAT_COST_DEFAULTS.monthly_budget_usd),
      daily_budget_usd: _chatCostNumber(container, 'chat-budget-daily', CHAT_COST_DEFAULTS.daily_budget_usd),
      session_budget_usd: _chatCostNumber(container, 'chat-budget-session', CHAT_COST_DEFAULTS.session_budget_usd),
      monthly_mode: container.querySelector('#chat-budget-monthly-mode')?.value || 'hard',
      daily_mode: container.querySelector('#chat-budget-daily-mode')?.value || 'hard',
      session_mode: container.querySelector('#chat-budget-session-mode')?.value || 'hard',
      max_concurrent_requests: _chatCostNumber(container, 'chat-budget-concurrency', CHAT_COST_DEFAULTS.max_concurrent_requests),
      max_tool_iterations: _chatCostNumber(container, 'chat-budget-tool-iterations', CHAT_COST_DEFAULTS.max_tool_iterations),
      max_retry_attempts: _chatCostNumber(container, 'chat-budget-retry-attempts', CHAT_COST_DEFAULTS.max_retry_attempts),
      large_context_warning_tokens: _chatCostNumber(container, 'chat-budget-large-warning', CHAT_COST_DEFAULTS.large_context_warning_tokens),
      large_context_block_tokens: _chatCostNumber(container, 'chat-budget-large-block', CHAT_COST_DEFAULTS.large_context_block_tokens),
    });
    if (statusEl) statusEl.textContent = '保存しました';
    if (typeof chatRefreshUsageBanner === 'function') chatRefreshUsageBanner();
    if (!options.silent && typeof showStatus === 'function') {
      showStatus('AI使用量設定を保存しました', false, { showSaveDialog: true });
    }
    return true;
  } catch (error) {
    if (statusEl) statusEl.textContent = '保存に失敗しました: ' + (error?.message || error);
    if (!options.silent && typeof showStatus === 'function') showStatus('AI使用量設定の保存に失敗しました: ' + (error?.message || error), true);
    return false;
  }
}

async function renderChatCostSettings(root) {
  const container = (root?.querySelector ? root : document).querySelector('#chat-cost-settings-container');
  if (!container) return;
  container.innerHTML = `<section class="gb-section gb-section--boxed"><div class="gb-section-title">${lucide('walletCards',14)} AI使用量</div><div class="gb-section-desc">読み込み中...</div></section>`;
  try {
    const status = await apiFetch('/chat/budget');
    const settings = status.settings || {};
    const totals = status.totals || {};
    const modeOptions = value => ['hard', 'warn', 'off'].map(mode => {
      const label = mode === 'hard' ? 'ハード停止' : mode === 'warn' ? '警告のみ' : '無効';
      return `<option value="${mode}" ${String(value || 'hard') === mode ? 'selected' : ''}>${label}</option>`;
    }).join('');
    container.innerHTML = `
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('gauge',14)} AI API使用量</div>
        <div class="gb-section-desc">Meldex本体の課金ではありません。登録したAI APIキーで各社APIを使った場合の推定使用量です。</div>
        <div class="gb-section-desc">今日: ${_formatUsd(totals.day?.cost_usd)} / 今月: ${_formatUsd(totals.month?.cost_usd)}</div>
        <div class="gb-section-desc">AI API単価表レビュー日: ${esc(settings.pricing_last_reviewed || '')}</div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('shieldAlert',14)} 予算上限</div>
        <label class="gb-field-row"><span class="gb-label">月次</span><input id="chat-budget-monthly" type="number" min="0" step="0.1" class="gb-input" style="width:100px;" value="${Number(settings.monthly_budget_usd ?? CHAT_COST_DEFAULTS.monthly_budget_usd)}"><select id="chat-budget-monthly-mode" class="gb-select">${modeOptions(settings.monthly_mode)}</select></label>
        <label class="gb-field-row"><span class="gb-label">日次</span><input id="chat-budget-daily" type="number" min="0" step="0.1" class="gb-input" style="width:100px;" value="${Number(settings.daily_budget_usd ?? CHAT_COST_DEFAULTS.daily_budget_usd)}"><select id="chat-budget-daily-mode" class="gb-select">${modeOptions(settings.daily_mode)}</select></label>
        <label class="gb-field-row"><span class="gb-label">1チャット</span><input id="chat-budget-session" type="number" min="0" step="0.1" class="gb-input" style="width:100px;" value="${Number(settings.session_budget_usd ?? CHAT_COST_DEFAULTS.session_budget_usd)}"><select id="chat-budget-session-mode" class="gb-select">${modeOptions(settings.session_mode)}</select></label>
        <label class="gb-field-row"><span class="gb-label">同時実行</span><input id="chat-budget-concurrency" type="number" min="1" max="120" step="1" class="gb-input" style="width:80px;" value="${Number(settings.max_concurrent_requests ?? CHAT_COST_DEFAULTS.max_concurrent_requests)}"><span class="gb-section-desc">件まで</span></label>
        <label class="gb-field-row"><span class="gb-label">ツールループ</span><input id="chat-budget-tool-iterations" type="number" min="5" max="600" step="1" class="gb-input" style="width:80px;" value="${Number(settings.max_tool_iterations ?? CHAT_COST_DEFAULTS.max_tool_iterations)}"><span class="gb-section-desc">回まで</span></label>
        <label class="gb-field-row"><span class="gb-label">リトライ</span><input id="chat-budget-retry-attempts" type="number" min="0" max="120" step="1" class="gb-input" style="width:80px;" value="${Number(settings.max_retry_attempts ?? CHAT_COST_DEFAULTS.max_retry_attempts)}"><span class="gb-section-desc">回まで</span></label>
        <label class="gb-field-row"><span class="gb-label">長文警告</span><input id="chat-budget-large-warning" type="number" min="0" step="1000" class="gb-input" style="width:120px;" value="${Number(settings.large_context_warning_tokens ?? CHAT_COST_DEFAULTS.large_context_warning_tokens)}"><span class="gb-section-desc">tokens</span></label>
        <label class="gb-field-row"><span class="gb-label">長文停止</span><input id="chat-budget-large-block" type="number" min="0" step="1000" class="gb-input" style="width:120px;" value="${Number(settings.large_context_block_tokens ?? CHAT_COST_DEFAULTS.large_context_block_tokens)}"><span class="gb-section-desc">tokens</span></label>
        <div class="gb-field-row" style="justify-content:flex-start;">
          <button type="button" class="gb-btn gb-btn-sm" id="chat-budget-save">保存</button>
          <button type="button" class="gb-btn gb-btn-sm" id="chat-budget-reset">使用量履歴をリセット</button>
        </div>
        <div id="chat-budget-status" class="gb-section-desc"></div>
      </section>`;
    const statusEl = container.querySelector('#chat-budget-status');
    container.querySelector('#chat-budget-save')?.addEventListener('click', () => saveChatCostSettingsFromSettingsDialog(container, { silent: false }));
    container.querySelector('#chat-budget-reset')?.addEventListener('click', async () => {
      const ok = typeof cfConfirm === 'function' ? await cfConfirm('LLM使用量履歴をリセットしますか？') : confirm('LLM使用量履歴をリセットしますか？');
      if (!ok) return;
      await apiPost('/chat/usage/reset', {});
      statusEl.textContent = '使用量履歴をリセットしました';
      if (typeof renderChatCostSettings === 'function') renderChatCostSettings(root);
      if (typeof chatRefreshUsageBanner === 'function') chatRefreshUsageBanner();
    });
  } catch (error) {
    container.innerHTML = `<section class="gb-section gb-section--boxed"><div class="gb-section-title">${lucide('triangleAlert',14)} AI使用量</div><div class="gb-section-desc">読み込みに失敗しました: ${esc(error.message || error)}</div></section>`;
  }
}

/* ==============================
   履歴データのエクスポート
   ============================== */
async function runExportToDb() {
  const btn = document.getElementById('btn-export-to-db');
  const status = document.getElementById('export-to-db-status');
  if (btn) btn.disabled = true;
  if (status) status.textContent = 'エクスポート中...';
  try {
    const res = await apiPost('/export-to-db', {});
    const r = res.results || {};
    // propertyTypes と colOrder を各シートに自動設定
    for (const key of Object.keys(r)) {
      const info = r[key];
      if (!info.dbPath) continue;
      const existing = getDbViewConfig(info.dbPath);
      const cfg = { ...existing };
      // propertyTypes は常に上書き（サーバー側の型定義が正）
      if (info.propertyTypes) cfg.propertyTypes = info.propertyTypes;
      // colOrder / colWidths はユーザーカスタマイズを尊重
      if (info.colOrder && !existing.colOrder) {
        cfg.colOrder = info.colOrder;
        const view = typeof _getCurrentDbViewConfigEntryFromConfig === 'function'
          ? _getCurrentDbViewConfigEntryFromConfig(cfg)
          : null;
        if (view && !Array.isArray(view.colOrder)) view.colOrder = [...info.colOrder];
      }
      saveDbViewConfig(info.dbPath, cfg);
    }
    // サマリー表示
    const lines = [];
    if (r.chat) lines.push('チャット ' + r.chat.count + '件');
    if (r.annotations) lines.push('注釈 ' + r.annotations.count + '件');
    if (r.cal_events) lines.push('イベント ' + r.cal_events.count + '件');
    if (r.tasks) lines.push('タスク ' + r.tasks.count + '件');
    const summary = lines.join('、');
    if (status) status.textContent = 'エクスポート完了: ' + summary;
    showStatus('エクスポート完了: ' + summary);
    // ホームフォルダツリーをリロード
    if (typeof renderHomeFolderTree === 'function') renderHomeFolderTree();
  } catch (e) {
    if (status) status.textContent = 'エラー: ' + (e.message || e);
    showStatus('エクスポートに失敗しました', true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// UI設定のサーバー永続保存（localStorageの主要設定をサーバーにバックアップ）
const _UI_CONFIG_KEYS = [
  // UI設定
  'editor-theme', 'editor-theme-name', 'ui-scale', 'meldex-user', 'meldex-statusbar-hidden',
  'note-vertical', 'note-heading-indent', 'note-toc-visible',
  // カレンダー / チャット
  'gb-cal-start-day', 'gb:clock-enabled', 'gb:outliner-filter-shared', 'chat-provider', 'chat-model', 'chat-allow-web-search', 'chat-auto-compress', 'chat-allow-code-execution', 'chat-reasoning-level', 'chat-param-preset', 'chat-temperature', 'chat-max-tokens', 'chat-top-p', 'chat-custom-about', 'chat-custom-instructions', 'meldex-wheel-speed',
  'meldex-knowledge-automation-settings-v1',
  // カスタマイズ
  'meldex-custom-shortcuts', 'meldex-custom-colors', 'meldex-standard-palette-adjust', 'meldex-theme-color-set', 'meldex-theme-color-slot-settings', 'meldex-theme-ui-applications', 'meldex-theme-ui-auto-tone',
  'file-theme-presets', 'gb:hidden-shell-verbs',
];

// 構造化データのキー（ユーザーが時間をかけて構築するデータ）
const _UI_STRUCTURED_KEYS = [
  'gb:workspaces', 'gb:workspace-active', 'gb:layout',
  'gb:app-layouts', 'gb:app-layout-active', 'gb:layout-source',
  'gb:canvas-bg',
  'meldex-favorites', 'outliner-sort', 'outliner-manual-order',
  'outliner-locked-items', 'outliner-node-colors', 'outliner-work-folder', 'outliner-work-folder-id',
  'global-filter', 'gb:outliner-filter-shared-state', 'main-calendar-path', 'main-calendar-id',
  'outliner-expanded', '_file-id-migrated',
  'smartDbs', 'customDbTemplates',
  'version-config', 'history-max', 'folder-display-config',
];
// dbViewConfig:* 等の動的キーのプレフィックス
const _UI_DYNAMIC_PREFIXES = [
  'dbViewConfig:', 'validationRules:', 'entityTemplates:', 'chat-model:', 'chat-models:',
];

function _settingsDialogStorageKeys() {
  const keys = [..._UI_CONFIG_KEYS, ..._UI_STRUCTURED_KEYS];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && _UI_DYNAMIC_PREFIXES.some(p => key.startsWith(p))) keys.push(key);
    }
  } catch {}
  return [...new Set(keys)];
}

function _captureSettingsDialogStorageSnapshot() {
  return typeof captureLocalStorageSettings === 'function'
    ? captureLocalStorageSettings(_settingsDialogStorageKeys())
    : null;
}

function _restoreSettingsDialogStorageAfterHistory(keys) {
  if (!Array.isArray(keys)) return;
  if (keys.includes('ui-scale') && typeof applyUIScale === 'function') {
    applyUIScale(parseInt(localStorage.getItem('ui-scale') || '100', 10) || 100);
  }
  if (keys.includes('meldex-statusbar-hidden') && typeof applyStatusbarHidden === 'function') {
    applyStatusbarHidden(localStorage.getItem('meldex-statusbar-hidden') === '1');
  }
  if (keys.some(key => key === 'editor-theme' || key === 'editor-theme-name' || key.startsWith('meldex-theme-'))) {
    if (typeof loadColorSettings === 'function') loadColorSettings();
  }
  if (keys.includes('meldex-user')) {
    if (typeof updateUserIcon === 'function') updateUserIcon();
    if (typeof updateLeftChromeUser === 'function') updateLeftChromeUser();
  }
}

function _pushSettingsDialogStorageHistory(label, beforeSnapshot) {
  if (!beforeSnapshot || typeof pushLocalStorageSettingsHistory !== 'function') return false;
  return pushLocalStorageSettingsHistory(
    label || '設定: 共通設定保存',
    beforeSnapshot,
    _captureSettingsDialogStorageSnapshot(),
    '',
    _restoreSettingsDialogStorageAfterHistory
  );
}

function _saveUiConfigToServer() {
  const config = {};
  // 固定キー
  [..._UI_CONFIG_KEYS, ..._UI_STRUCTURED_KEYS].forEach(key => {
    const v = localStorage.getItem(key);
    if (v != null) config[key] = v;
  });
  // 動的キー（dbViewConfig:パス 等）
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (_UI_DYNAMIC_PREFIXES.some(p => key.startsWith(p))) {
      config[key] = localStorage.getItem(key);
    }
  }
  apiPut('/ui-config', config).catch(() => {});
}

// ページ読み込み時にサーバーからUI設定を復元（localStorageが空の場合のみ）
async function _restoreUiConfigFromServer() {
  try {
    const config = await apiFetch('/ui-config', { silentError: true });
    if (!config || typeof config !== 'object') return;
    let restored = false;
    for (const [key, val] of Object.entries(config)) {
      if (key === 'folder-files-hidden') continue;
      if (localStorage.getItem(key) == null && val != null) {
        localStorage.setItem(key, val);
        restored = true;
      }
    }
    if (restored) {
      // 復元した設定を適用
      if (typeof loadColorSettings === 'function') loadColorSettings();
      const scale = localStorage.getItem('ui-scale');
      if (scale && typeof applyUIScale === 'function') applyUIScale(parseInt(scale) || 100);
    }
  } catch {}
}
_restoreUiConfigFromServer();

/* showNotionSyncModal / saveNotionToken / doNotionSync 等は gb-notion-sync.js に移動 */

/* Source chunk: gb-settings.part05.js */
/* gb-settings.part05.js: appearance tab theme editor integration */

function _settingsThemeAction(iconName, fallback, label, action, danger) {
  const icon = typeof lucide === 'function' ? lucide(iconName, 14) : fallback;
  return `<button type="button" class="bd-detail-style-action${danger ? ' bd-detail-style-action--danger' : ''}" data-action="${action}" title="${esc(label)}" aria-label="${esc(label)}">${icon}</button>`;
}

function _settingsThemeCommonFontValue() {
  const raw = document.documentElement.style.getPropertyValue('--ui-font')
    || getComputedStyle(document.documentElement).getPropertyValue('--ui-font')
    || '';
  return typeof normalizeFontFamilyValue === 'function' ? normalizeFontFamilyValue(raw) : raw.trim();
}

function _renderSettingsThemeCommonFontSection() {
  const options = typeof getUIFontOptions === 'function' ? getUIFontOptions() : '';
  return `<section class="gb-section gb-section--detail settings-theme-font-section">
    <div class="gb-section-title">共通フォント</div>
    <label class="gb-field-row">
      <span class="gb-label">フォント:</span>
      <select id="modal-font-family" class="gb-select" data-onchange="settingsThemeCommonFontChanged(this.value)" style="max-width:220px;">${options}</select>
    </label>
  </section>`;
}

function renderSettingsAppearancePanel(currentTheme, options = {}) {
  const themeOptions = typeof MeldexThemeManager !== 'undefined'
    ? MeldexThemeManager.themeOptionsHtml(currentTheme)
    : Object.keys(THEME_PRESETS).map(n => '<option value="' + esc(n) + '"' + (n === currentTheme ? ' selected' : '') + '>' + esc(n) + '</option>').join('');
  return `
    <section class="gb-section gb-section--boxed">
      <div class="gb-section-title">${lucide('palette', 14)} テーマ</div>
      <div class="gb-field-row" style="align-items:center;">
        <select id="modal-theme-preset" data-onchange="settingsThemeSelect(this.value)" class="gb-select" style="flex:1;min-width:180px;">
          ${themeOptions}
        </select>
        <span class="bd-detail-style-row" style="width:auto;flex:0 0 auto;">
          ${_settingsThemeAction('plus', '+', '新規カスタムテーマを作成', 'settingsThemeCreate()')}
          ${_settingsThemeAction('copy', '複製', '選択中テーマを複製', 'settingsThemeDuplicate()')}
          ${_settingsThemeAction('pencil', '名前', 'テーマ名を変更', 'settingsThemeRename()')}
          ${_settingsThemeAction('rotateCcw', '戻す', 'デフォルトに戻す', 'settingsThemeReset()')}
          ${_settingsThemeAction('save', '保存', 'デフォルトとして保存', 'settingsThemeSave()')}
          ${_settingsThemeAction('trash2', '削除', 'カスタムテーマを削除', 'settingsThemeDelete()', true)}
          ${_settingsThemeAction(typeof uiTransferIconName === 'function' ? uiTransferIconName('import') : 'download', '読込', 'テーマをインポート', 'settingsThemeImport()')}
          ${_settingsThemeAction(typeof uiTransferIconName === 'function' ? uiTransferIconName('export') : 'upload', '保存', 'テーマをエクスポート', 'settingsThemeExport()')}
        </span>
      </div>
      ${_renderSettingsThemeCommonFontSection()}
    </section>
    <section class="gb-section gb-section--boxed">
      <div class="gb-section-title">テーマカラー</div>
      ${typeof renderSettingsThemePaletteEditor === 'function' ? renderSettingsThemePaletteEditor() : renderThemeColorSetEditor(null, { hideLabel: true })}
    </section>
    <section class="gb-section gb-section--boxed">
      <div class="gb-section-title">テーマ設定</div>
      ${renderSettingsThemeEditor(options.activeStyleTab, {
        deferStyleRows: options.deferStyleRows,
        renderedStyleTab: options.renderedStyleTab,
      })}
    </section>`;
}

function ensureSettingsThemePanel(panel, options = {}) {
  const root = panel?.matches?.('.settings-panel[data-panel="テーマ"]')
    ? panel
    : panel?.querySelector?.('.settings-panel[data-panel="テーマ"]');
  if (!root) return;
  const selectedId = options.selectedId || root.dataset.settingsThemeSelectedId || _settingsThemeCurrentId();
  const activeStyleTab = options.activeStyleTab || root.dataset.settingsThemeActiveStyleTab || _settingsThemeActiveStyleTab(root);
  const hasRenderedStyleTab = Object.prototype.hasOwnProperty.call(options, 'renderedStyleTab');
  const renderedStyleTab = hasRenderedStyleTab
    ? String(options.renderedStyleTab || '')
    : (root.querySelector?.('[data-settings-theme-style-panel][data-settings-theme-style-rendered="1"]')?.dataset?.settingsThemeStylePanel || '');
  const hasDeferStyleRows = Object.prototype.hasOwnProperty.call(options, 'deferStyleRows');
  const deferStyleRows = options.deferStyleRows === true
    || (!hasDeferStyleRows && root.dataset.settingsThemeRendered !== '1' && !renderedStyleTab);
  if (options.force !== true && root.dataset.settingsThemeRendered === '1' && root.querySelector('#settings-theme-editor')) return;
  root.innerHTML = renderSettingsAppearancePanel(selectedId, {
    activeStyleTab,
    deferStyleRows,
    renderedStyleTab,
  });
  root.dataset.settingsThemeRendered = '1';
  root.dataset.settingsThemeSelectedId = selectedId || '';
  root.dataset.settingsThemeActiveStyleTab = activeStyleTab || '';
  bindSettingsThemePanel(root);
  if (typeof replaceIcons === 'function') replaceIcons(root);
}

function _settingsThemeCurrentId() {
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getDefaultThemeId === 'function') {
    return MeldexThemeManager.getDefaultThemeId();
  }
  return detectCurrentTheme();
}

function _settingsThemeCurrent() {
  if (typeof MeldexThemeManager === 'undefined') return null;
  return MeldexThemeManager.getThemeById(_settingsThemeCurrentId());
}

function _settingsThemeIsCustom(id) {
  if (typeof MeldexThemeManager === 'undefined') return false;
  const themeId = id || _settingsThemeCurrentId();
  return MeldexThemeManager.getCustomThemes().some(t => t.id === themeId);
}

const SETTINGS_THEME_STYLE_TABS = [
  '共通', 'フォルダ', 'ノート', 'シナリオ', 'シート', 'ボード', 'カレンダー',
  '補助パネル',
];
const SETTINGS_THEME_STYLE_AUTO_TARGETS = {
  'フォルダ': ['style-folder', 'folder-panel-folder'],
  'ノート': ['style-note', 'note-heading', 'note-toc-item'],
  'シナリオ': ['style-scriptnote', 'scriptnote-type-dialogue', 'scriptnote-type-action', 'scriptnote-type-heading', 'scriptnote-type-summary', 'scriptnote-type-break'],
  'シート': ['style-sheet'],
  'ボード': ['style-board'],
  'カレンダー': ['style-calendar'],
  '補助パネル': ['style-outliner', 'folder-tree-folder', 'style-preview', 'style-detail', 'style-chat', 'style-timer', 'style-history', 'style-annotation', 'style-search', 'style-version'],
};

function _settingsThemeStyleTabNames() {
  return SETTINGS_THEME_STYLE_TABS.filter(name => Array.isArray(UI_STYLE_SECTIONS?.[name]));
}

function _settingsThemeSubsection(title, body) {
  if (!body) return '';
  return `<section class="gb-section gb-section--detail settings-theme-subsection">
    <div class="gb-section-title">${esc(title)}</div>
    ${body}
  </section>`;
}

function _settingsThemePxValue(key, fallback) {
  const raw = getCssVar(key) || fallback || '';
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : parseFloat(fallback) || 0;
}

function _renderSettingsThemeNoteLayoutRows() {
  const margin = _settingsThemePxValue('--page-margin-x', '50px');
  const maxWidth = _settingsThemePxValue('--page-content-max-width', '1200px');
  return _settingsThemeSubsection('レイアウト', `<label class="gb-field-row settings-theme-note-layout-row">
    <span class="gb-label">左右余白</span>
    <input id="settings-note-margin-x" type="number" min="0" max="300" step="1" class="gb-input-sm settings-theme-note-margin-input" value="${esc(margin)}" data-onchange="settingsThemeNoteMarginChanged(this.value)">
    <span class="gb-label">px</span>
  </label>
  <label class="gb-field-row settings-theme-note-layout-row">
    <span class="gb-label">内容最大幅</span>
    <input id="settings-note-content-max-width" type="number" min="480" max="3200" step="10" class="gb-input-sm settings-theme-note-width-input" value="${esc(maxWidth)}" data-onchange="settingsThemeNoteContentMaxWidthChanged(this.value)">
    <span class="gb-label">px</span>
  </label>`);
}

function _renderSettingsThemeStyleAutoRows(name) {
  const targetIds = SETTINGS_THEME_STYLE_AUTO_TARGETS[name];
  if (!targetIds) return '';
  return _settingsThemeSubsection('テーマカラーの自動適用設定', renderThemeUiApplicationEditor({ hideLabel: true, targetIds, showReset: false }));
}

// 共通タブと重複するため、個別パネルタブから除外するラベル
const _COMMON_DUPLICATE_STYLE_LABELS = new Set(['カーソル', 'ホバー', '選択', 'テキスト選択']);

function _filterCommonDuplicates(defs, name) {
  if (!Array.isArray(defs)) return [];
  if (name === '共通') return defs;
  return defs.filter(d => !_COMMON_DUPLICATE_STYLE_LABELS.has(String(d?.label || '').trim()));
}

function _renderSettingsThemeBoardExtras() {
  const shadowRaw = (getCssVar('--bd-shadow') || '').trim();
  const shadowOn = shadowRaw !== '' && shadowRaw !== '0';
  const autoAlignRaw = (getCssVar('--bd-auto-align') || '').trim();
  // defaultOn: 値未設定時はオン扱い
  const autoAlignOn = autoAlignRaw !== '0';
  const fitRaw = (getCssVar('--bd-bg-image-fit') || '').trim() || 'contain';
  const fits = [
    ['contain', '全体表示'],
    ['cover', '埋める'],
    ['auto', '原寸'],
    ['repeat', 'タイル'],
    ['world', 'ボード連動'],
  ];
  const imageRaw = (getCssVar('--bd-bg-image') || '').trim();
  // /file-raw?path=... 形式なら path クエリをデコード、通常のパスなら末尾セグメントを取り出す
  const imageName = (() => {
    if (!imageRaw) return '';
    const match = imageRaw.match(/[?&]path=([^&]+)/);
    let decoded = match ? match[1] : imageRaw;
    try { decoded = decodeURIComponent(decoded); } catch {}
    return decoded.split(/[\\/]/).pop() || decoded;
  })();
  const scaleRaw = (getCssVar('--bd-bg-image-scale') || '').trim();
  const scaleVal = Number.isFinite(parseFloat(scaleRaw)) && parseFloat(scaleRaw) > 0 ? parseFloat(scaleRaw) : 1;
  const fitOptions = fits.map(([v, lbl]) =>
    `<option value="${esc(v)}"${v === fitRaw ? ' selected' : ''}>${esc(lbl)}</option>`).join('');
  const body = `
    <label class="gb-field-row">
      <span class="gb-label" style="min-width:100px;">影</span>
      <input type="checkbox" data-onchange="settingsThemeBoardToggleShadow(this)"${shadowOn ? ' checked' : ''}>
    </label>
    <label class="gb-field-row">
      <span class="gb-label" style="min-width:100px;">自動整列</span>
      <input type="checkbox" data-onchange="settingsThemeBoardToggleAutoAlign(this)"${autoAlignOn ? ' checked' : ''}>
    </label>
    <div class="gb-field-row" style="align-items:center;gap:6px;flex-wrap:wrap;">
      <span class="gb-label" style="min-width:100px;">背景画像</span>
      <button type="button" class="bd-detail-style-action" data-action="settingsThemeBoardChooseBgImage()" title="画像を選択">選択</button>
      <button type="button" class="bd-detail-style-action bd-detail-style-action--danger" data-action="settingsThemeBoardClearBgImage()" title="背景画像をクリア"${imageRaw ? '' : ' disabled'}>クリア</button>
      <span class="gb-section-desc" style="flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(imageRaw)}">${esc(imageName || '（未設定）')}</span>
    </div>
    <label class="gb-field-row">
      <span class="gb-label" style="min-width:100px;">画像表示</span>
      <select class="gb-select" data-onchange="settingsThemeBoardSetBgFit(this.value)" style="max-width:180px;">
        ${fitOptions}
      </select>
    </label>
    <label class="gb-field-row"${fitRaw === 'world' ? '' : ' hidden'}>
      <span class="gb-label" style="min-width:100px;">画像スケール</span>
      <input type="number" min="0.05" max="20" step="0.05" class="gb-input-sm" value="${esc(scaleVal)}" data-onchange="settingsThemeBoardSetBgScale(this.value)">
    </label>`;
  const html = _settingsThemeSubsection('ボード固有設定', body);
  // 再描画時に特定セクションを識別できるようマーカー属性を付ける
  return html.replace('<section class="gb-section gb-section--detail settings-theme-subsection"',
    '<section class="gb-section gb-section--detail settings-theme-subsection" data-settings-theme-board-extras="1"');
}

function _renderSettingsThemeStyleRows(name) {
  const defs = _filterCommonDuplicates(UI_STYLE_SECTIONS?.[name] || [], name);
  const styleRows = defs.map(d => renderStyleRow(d)).join('');
  const styleSection = _settingsThemeSubsection('書式設定', styleRows);
  if (name === '共通') {
    return _settingsThemeSubsection('テーマカラーの自動適用設定', renderThemeUiApplicationEditor({ hideLabel: true, group: 'ui' }))
      + styleSection;
  }
  const autoRows = _renderSettingsThemeStyleAutoRows(name);
  if (name === 'ノート') return autoRows + _renderSettingsThemeNoteLayoutRows() + styleSection;
  if (name === 'ボード') return autoRows + styleSection + _renderSettingsThemeBoardExtras();
  return autoRows + styleSection;
}

// ----- ボード固有設定のハンドラ（テーマタブ） -----
function _settingsThemeBoardReadonlyCheck(el) {
  if (typeof _settingsThemeIsReadonlyElement === 'function' && _settingsThemeIsReadonlyElement(el)) {
    if (typeof _settingsThemePromptDuplicateForEdit === 'function') _settingsThemePromptDuplicateForEdit();
    return true;
  }
  return false;
}

function _settingsThemeBoardSetVar(key, value) {
  if (value == null || value === '') document.documentElement.style.removeProperty(key);
  else document.documentElement.style.setProperty(key, String(value));
  if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
  if (typeof _bdApplyCurrentBoardBackground === 'function') _bdApplyCurrentBoardBackground();
}

function settingsThemeBoardToggleShadow(input) {
  if (_settingsThemeBoardReadonlyCheck(input)) { input.checked = !input.checked; return; }
  // '1'/'0' の2値で保存（saveColorSettings は空文字を保存しないため）。
  // bd._fileStyle 側は '1'/'' を使う既存仕様に注意。どちらも on=真、それ以外=偽で評価される。
  _settingsThemeBoardSetVar('--bd-shadow', input.checked ? '1' : '0');
  // キャンバスの bd-shadow-on クラスは bd._showShadow から付けられる。
  // ファイル側で明示指定 (キーが存在) されている場合はファイルを優先、未指定のみテーマ追従。
  if (typeof bd !== 'undefined' && (!bd._fileStyle || bd._fileStyle['--bd-shadow'] === undefined)) {
    bd._showShadow = !!input.checked;
    const canvas = document.getElementById('bd-canvas');
    if (canvas) canvas.classList.toggle('bd-shadow-on', !!input.checked);
  }
}

function settingsThemeBoardToggleAutoAlign(input) {
  if (_settingsThemeBoardReadonlyCheck(input)) { input.checked = !input.checked; return; }
  _settingsThemeBoardSetVar('--bd-auto-align', input.checked ? '1' : '0');
  // ファイル側が未設定のときはテーマに追従させる
  if (typeof bd !== 'undefined' && (!bd._fileStyle || bd._fileStyle['--bd-auto-align'] === undefined)) {
    bd.autoAlign = !!input.checked;
    if (bd.autoAlign && typeof _bdRelayoutAllStructureTrees === 'function') _bdRelayoutAllStructureTrees();
  }
}

function settingsThemeBoardSetBgFit(value) {
  const allowed = ['contain', 'cover', 'auto', 'repeat', 'world'];
  const next = allowed.includes(value) ? value : 'contain';
  _settingsThemeBoardSetVar('--bd-bg-image-fit', next);
  // スケール行の表示切替
  const panel = document.querySelector('[data-settings-theme-style-panel="ボード"]');
  if (panel) {
    const scaleRow = panel.querySelector('input[data-onchange^="settingsThemeBoardSetBgScale"]')?.closest('.gb-field-row');
    if (scaleRow) scaleRow.hidden = next !== 'world';
  }
}

function settingsThemeBoardSetBgScale(value) {
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) return;
  const clamped = Math.max(0.05, Math.min(20, n));
  _settingsThemeBoardSetVar('--bd-bg-image-scale', String(clamped));
}

function settingsThemeBoardChooseBgImage() {
  const panel = document.querySelector('[data-settings-theme-style-panel="ボード"]');
  if (panel && _settingsThemeBoardReadonlyCheck(panel)) return;
  if (typeof bd === 'undefined' || !bd?.path) {
    if (typeof showStatus === 'function') showStatus('ボードを開いてから背景画像を設定してください', true);
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (file) {
      try {
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve, reject) => {
          reader.onload = e => resolve(e.target.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const dir = (() => {
          const p = String(bd.path || '');
          const i = p.lastIndexOf('/');
          return i >= 0 ? p.substring(0, i) : '';
        })();
        const res = await apiFetch('/upload-file?path=' + encodeURIComponent(dir), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: dataUrl, filename: file.name || 'background.png' }),
        });
        if (!res?.ok || !res.path) throw new Error('upload failed');
        const url = API_BASE + '/file-raw?path=' + encodeURIComponent(res.path);
        _settingsThemeBoardSetVar('--bd-bg-image', url);
        // パネル再描画
        _settingsThemeRefreshBoardExtras();
        if (typeof showStatus === 'function') showStatus('背景画像を設定しました');
      } catch {
        if (typeof showStatus === 'function') showStatus('背景画像の設定に失敗しました', true);
      }
    }
    input.remove();
  });
  document.body.appendChild(input);
  input.click();
}

function settingsThemeBoardClearBgImage() {
  const panel = document.querySelector('[data-settings-theme-style-panel="ボード"]');
  if (panel && _settingsThemeBoardReadonlyCheck(panel)) return;
  _settingsThemeBoardSetVar('--bd-bg-image', '');
  _settingsThemeBoardSetVar('--bd-bg-image-scale', '');
  _settingsThemeRefreshBoardExtras();
}

function _settingsThemeRefreshBoardExtras() {
  const panel = document.querySelector('[data-settings-theme-style-panel="ボード"]');
  if (!panel) return;
  const section = panel.querySelector('[data-settings-theme-board-extras="1"]');
  if (!section) return;
  const next = _renderSettingsThemeBoardExtras();
  const tmp = document.createElement('div');
  tmp.innerHTML = next;
  const replacement = tmp.firstElementChild;
  if (replacement) section.replaceWith(replacement);
}

function _settingsThemeStylePanelPlaceholder(name) {
  return `<div class="gb-section-desc" data-settings-theme-style-placeholder="1">${esc(name)} の設定は対象を切り替えた時に読み込みます。</div>`;
}

function _renderSettingsThemeStyleTabs(activeStyleTab, options = {}) {
  const names = _settingsThemeStyleTabNames();
  const activeName = names.includes(activeStyleTab) ? activeStyleTab : names[0];
  const renderedStyleTab = activeName;
  const optionsHtml = names.map(name =>
    `<option value="${esc(name)}"${name === activeName ? ' selected' : ''}>${esc(name)}</option>`
  ).join('');
  const panels = names.map((name, idx) => `
    <div data-settings-theme-style-panel="${esc(name)}" data-settings-theme-style-rendered="${name === renderedStyleTab ? '1' : '0'}"${name === activeName ? '' : ' hidden'}>
      ${name === renderedStyleTab ? _renderSettingsThemeStyleRows(name) : (name === activeName ? _settingsThemeStylePanelPlaceholder(name) : '')}
    </div>`).join('');
  return `<label class="gb-field-row settings-theme-style-selector" style="align-items:center;margin-bottom:8px;">
    <span class="gb-label">対象:</span>
    <select class="gb-select" data-settings-theme-style-select data-onchange="switchSettingsThemeStyleTab(this)" style="max-width:240px;">${optionsHtml}</select>
  </label>${panels}`;
}

function renderSettingsThemeEditor(activeStyleTab, options = {}) {
  const theme = _settingsThemeCurrent();
  const builtIn = !!theme && !_settingsThemeIsCustom(theme.id);
  const rows = _renderSettingsThemeStyleTabs(activeStyleTab, options);
  return `<div id="settings-theme-editor" data-readonly="0" data-builtin="${builtIn ? '1' : '0'}" data-theme-id="${esc(theme?.id || '')}">${rows}</div>`;
}

function switchSettingsThemeStyleTab(btn) {
  const editor = btn?.closest?.('#settings-theme-editor');
  const name = btn?.dataset?.settingsThemeStyleTabBtn || btn?.value || '';
  if (!editor || !name) return;
  const select = editor.querySelector('[data-settings-theme-style-select]');
  if (select && select.value !== name) select.value = name;
  editor.querySelectorAll('[data-settings-theme-style-tab-btn]').forEach(tab => {
    const active = tab.dataset.settingsThemeStyleTabBtn === name;
    tab.classList.toggle('gb-inner-tab-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  let activePanel = null;
  editor.querySelectorAll('[data-settings-theme-style-panel]').forEach(panel => {
    const active = panel.dataset.settingsThemeStylePanel === name;
    panel.hidden = !active;
    if (active) activePanel = panel;
  });
  if (activePanel && activePanel.dataset.settingsThemeStyleRendered !== '1') {
    activePanel.innerHTML = _renderSettingsThemeStyleRows(name);
    activePanel.dataset.settingsThemeStyleRendered = '1';
    _bindSettingsThemeStylePanel(activePanel);
    if (typeof replaceIcons === 'function') replaceIcons(activePanel);
  }
  const themePanel = editor.closest('.settings-panel[data-panel="テーマ"]');
  if (themePanel) themePanel.dataset.settingsThemeActiveStyleTab = name;
}

function _bindSettingsThemeStylePanel(root) {
  if (!root || root.dataset.settingsThemeStyleBound === '1') return;
  if (root.querySelector?.('[data-settings-theme-style-placeholder="1"]')) return;
  if (root.dataset.settingsThemeStyleRendered === '0') return;
  root.dataset.settingsThemeStyleBound = '1';
  syncCsSwatches(root);
  syncThemeUiApplicationSelectors(root);
  bindThemeUiApplicationEditor(root);
}

function bindSettingsThemePanel(root) {
  const panel = root || document;
  const editor = panel.querySelector?.('#settings-theme-editor');
  if (!editor) return;
  const activeStylePanel = editor.querySelector('[data-settings-theme-style-panel]:not([hidden])');
  syncCsSwatches(editor);
  syncThemeColorSetSwatches(panel);
  if (typeof syncThemeOsAccentToggle === 'function') syncThemeOsAccentToggle(panel);
  // テーマカラーセクションはテーマ設定エディタの外側にあるため panel 単位でバインドする
  bindThemeColorSetEditor(panel);
  if (activeStylePanel) _bindSettingsThemeStylePanel(activeStylePanel);
  _settingsThemeRefreshActionStates(panel);
}

function settingsThemeApplyCommonFont(value, options = {}) {
  const family = typeof normalizeFontFamilyValue === 'function' ? normalizeFontFamilyValue(value) : String(value || '').trim();
  const current = _settingsThemeCommonFontValue();
  if (current === family) return family;
  if (family) document.documentElement.style.setProperty('--ui-font', family);
  else document.documentElement.style.removeProperty('--ui-font');
  const uiFont = document.getElementById('modal-font-family');
  if (uiFont) uiFont.value = family;
  try { loadGoogleFontForUI(family); } catch {}
  if (options.markDirty !== false && typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
  return family;
}

function settingsThemeCommonFontChanged(value) {
  settingsThemeApplyCommonFont(value);
}

function settingsThemeNoteMarginChanged(value) {
  let px = parseFloat(value);
  if (!Number.isFinite(px)) px = 50;
  px = Math.max(0, Math.min(300, px));
  document.documentElement.style.setProperty('--page-margin-x', px + 'px');
  if (typeof applyNoteMargin === 'function') applyNoteMargin();
  if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
  const input = document.getElementById('settings-note-margin-x');
  if (input) input.value = String(px);
}

function settingsThemeNoteContentMaxWidthChanged(value) {
  const px = typeof _clampNoteContentMaxWidth === 'function'
    ? _clampNoteContentMaxWidth(value)
    : Math.max(480, Math.min(3200, parseFloat(value) || 1200));
  document.documentElement.style.setProperty('--page-content-max-width', px + 'px');
  if (typeof applyNoteContentMaxWidth === 'function') applyNoteContentMaxWidth(px);
  if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
  const input = document.getElementById('settings-note-content-max-width');
  if (input) input.value = String(px);
}

function _settingsThemeRefreshActionStates(root) {
  const custom = _settingsThemeIsCustom();
  const setDisabled = (action, disabled) => {
    (root || document).querySelectorAll(`[data-action="${action}"]`).forEach(btn => { btn.disabled = disabled; });
  };
  setDisabled('settingsThemeRename()', !custom);
  setDisabled('settingsThemeSave()', !custom);
  setDisabled('settingsThemeDelete()', !custom);
}

function _settingsThemeRun(message, fn) {
  try {
    return fn();
  } catch (err) {
    console.warn('[settings theme]', message, err);
    showStatus(message + (err?.message ? ': ' + err.message : ''), true);
    return undefined;
  }
}

function _settingsThemeActiveStyleTab(root) {
  const select = (root || document).querySelector?.('[data-settings-theme-style-select]');
  if (select?.value) return select.value;
  const active = (root || document).querySelector?.('[data-settings-theme-style-tab-btn].gb-inner-tab-active');
  return active?.dataset?.settingsThemeStyleTabBtn || '';
}

function _refreshSettingsThemePanel(selectedId, options = {}) {
  const panel = document.querySelector('.settings-panel[data-panel="テーマ"]') || document.querySelector('.settings-panel[data-panel="外観"]');
  if (!panel) return;
  const activeStyleTab = options.activeStyleTab || panel.dataset.settingsThemeActiveStyleTab || _settingsThemeActiveStyleTab(panel);
  const activePanel = Array.from(panel.querySelectorAll?.('[data-settings-theme-style-panel]') || [])
    .find(candidate => candidate.dataset.settingsThemeStylePanel === activeStyleTab);
  const activeRendered = activePanel?.dataset?.settingsThemeStyleRendered === '1';
  ensureSettingsThemePanel(panel, {
    force: true,
    selectedId: selectedId || _settingsThemeCurrentId(),
    activeStyleTab,
    deferStyleRows: !activeRendered,
    renderedStyleTab: activeRendered ? activeStyleTab : '',
  });
}

function _settingsThemeIsReadonlyElement(el) {
  const editor = el?.closest?.('#settings-theme-editor') || document.querySelector('#settings-theme-editor');
  return editor?.dataset.readonly === '1';
}

async function _settingsThemePromptDuplicateForEdit() {
  if (!await cfConfirm('組み込みテーマには上書き保存できません。複製して保存しますか？')) return null;
  return settingsThemeDuplicate(true);
}

function settingsThemeSelect(id) {
  if (!id) return;
  const activeStyleTab = _settingsThemeActiveStyleTab(document);
  applyThemePreset(id);
  if (typeof _settingsThemeSetDirty === 'function') _settingsThemeSetDirty(false);
  _refreshSettingsThemePanel(id, { activeStyleTab });
}

async function settingsThemeCreate(options = {}) {
  if (typeof MeldexThemeManager === 'undefined') return false;
  const opts = options && typeof options === 'object' ? options : {};
  const name = await cfPrompt('カスタムテーマ名', opts.defaultName || 'カスタムテーマ');
  if (name === null) return false;
  const theme = _settingsThemeRun('カスタムテーマを作成できませんでした', () => MeldexThemeManager.createCustomThemeFromCurrent(name));
  if (theme === undefined) return false;
  if (!theme) { showStatus('テーマ名を入力してください', true); return false; }
  MeldexThemeManager.applyDefaultTheme(theme.id, { silent: true, resetThemeColorSet: false });
  if (typeof _settingsThemeSetDirty === 'function') _settingsThemeSetDirty(false);
  if (!opts.skipRefresh) _refreshSettingsThemePanel(theme.id);
  if (!opts.silent) showStatus('カスタムテーマを作成しました');
  return theme;
}

async function settingsThemeDuplicate(autoName) {
  if (typeof MeldexThemeManager === 'undefined') return null;
  const source = _settingsThemeCurrent();
  if (!source) return null;
  let name = `${source.name} コピー`;
  if (!autoName) {
    const input = await cfPrompt('複製後のテーマ名', name);
    if (input === null) return null;
    name = input;
  }
  const theme = _settingsThemeRun('カスタムテーマを複製できませんでした', () => MeldexThemeManager.createCustomThemeFromTheme(source.id, name));
  if (!theme) return null;
  MeldexThemeManager.applyDefaultTheme(theme.id, { silent: true, resetThemeColorSet: false });
  if (typeof _settingsThemeSetDirty === 'function') _settingsThemeSetDirty(false);
  _refreshSettingsThemePanel(theme.id);
  showStatus('カスタムテーマを複製しました');
  return theme;
}

async function settingsThemeRename() {
  if (typeof MeldexThemeManager === 'undefined') return;
  const id = _settingsThemeCurrentId();
  const theme = MeldexThemeManager.getCustomThemes().find(t => t.id === id);
  if (!theme) { showStatus('組み込みテーマは名前を変更できません', true); return; }
  const name = await cfPrompt('テーマ名', theme.name);
  if (name === null) return;
  const renamed = _settingsThemeRun('テーマ名を変更できませんでした', () => MeldexThemeManager.renameCustomTheme(id, name));
  if (renamed === undefined) return;
  if (!renamed) { showStatus('テーマ名を入力してください', true); return; }
  _refreshSettingsThemePanel(renamed.id);
}

function settingsThemeReset() {
  if (typeof MeldexThemeManager === 'undefined') return;
  const id = _settingsThemeCurrentId();
  if (typeof THEME_COLOR_SLOT_SETTINGS_KEY !== 'undefined') localStorage.removeItem(THEME_COLOR_SLOT_SETTINGS_KEY);
  if (typeof THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY !== 'undefined') localStorage.removeItem(THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY);
  MeldexThemeManager.applyDefaultTheme(id, { silent: true, resetThemeColorSet: true });
  if (typeof _settingsThemeSetDirty === 'function') _settingsThemeSetDirty(false);
  _refreshSettingsThemePanel(id);
  showStatus('デフォルトに戻しました');
}

function settingsThemeSave(options = {}) {
  if (typeof MeldexThemeManager === 'undefined') return false;
  const opts = options && typeof options === 'object' ? options : {};
  const id = _settingsThemeCurrentId();
  if (!_settingsThemeIsCustom(id)) {
    showStatus('組み込みテーマはデフォルトとして保存できません。新規カスタムテーマを作成してください', true);
    return false;
  }
  const saved = _settingsThemeRun('デフォルトとして保存できませんでした', () => MeldexThemeManager.updateCustomThemeFromCurrent(id));
  if (saved === undefined) return false;
  if (!saved) { showStatus('デフォルトとして保存できませんでした', true); return false; }
  try { localStorage.removeItem(MeldexThemeManager.THEME_COLOR_SET_KEY); } catch {}
  if (typeof _settingsThemeSetDirty === 'function') _settingsThemeSetDirty(false);
  if (!opts.skipRefresh) _refreshSettingsThemePanel(saved.id);
  if (!opts.silent) showStatus('デフォルトとして保存しました', false, { showSaveDialog: true });
  return true;
}

async function settingsThemeSaveFromSettingsDialog(options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  if (typeof _settingsThemeIsDirty === 'function' && !_settingsThemeIsDirty()) return true;
  if (typeof MeldexThemeManager === 'undefined') return true;
  if (_settingsThemeIsCustom()) return settingsThemeSave({ silent: true, skipRefresh: !!opts.skipRefresh });
  const current = _settingsThemeCurrent();
  const created = await settingsThemeCreate({
    silent: true,
    skipRefresh: !!opts.skipRefresh,
    defaultName: `${current?.name || 'テーマ'} カスタム`,
  });
  return !!created;
}

async function settingsThemeDelete() {
  if (typeof MeldexThemeManager === 'undefined') return;
  const id = _settingsThemeCurrentId();
  const theme = MeldexThemeManager.getCustomThemes().find(t => t.id === id);
  if (!theme) { showStatus('削除できるカスタムテーマが選択されていません', true); return; }
  if (!await cfConfirm('カスタムテーマ「' + theme.name + '」を削除しますか？')) return;
  if (!_settingsThemeRun('カスタムテーマを削除できませんでした', () => MeldexThemeManager.deleteCustomTheme(id))) return;
  MeldexThemeManager.applyDefaultTheme('builtin-dark', { silent: true, resetThemeColorSet: true });
  if (typeof _settingsThemeSetDirty === 'function') _settingsThemeSetDirty(false);
  _refreshSettingsThemePanel('builtin-dark');
  showStatus('カスタムテーマを削除しました');
}

function settingsThemeExport() {
  if (typeof MeldexThemeManager === 'undefined') return;
  const theme = MeldexThemeManager.getThemeById(_settingsThemeCurrentId());
  const payload = { _type: 'meldex-theme', _version: 5, theme };
  if (typeof MeldexThemeManager.getUseOsAccentColor === 'function') {
    payload.useOsAccentColor = MeldexThemeManager.getUseOsAccentColor();
    if (typeof MeldexThemeManager.setThemeOsAccentOnTheme === 'function') {
      MeldexThemeManager.setThemeOsAccentOnTheme(theme, payload.useOsAccentColor);
    }
  }
  if (typeof getStandardPaletteAdjust === 'function' && typeof MeldexThemeManager.setThemeStandardPaletteAdjustOnTheme === 'function') {
    MeldexThemeManager.setThemeStandardPaletteAdjustOnTheme(theme, getStandardPaletteAdjust());
  }
  if (typeof getThemeColorSlotSettings === 'function' && typeof MeldexThemeManager.setThemeColorSlotSettingsOnTheme === 'function') {
    MeldexThemeManager.setThemeColorSlotSettingsOnTheme(theme, getThemeColorSlotSettings());
  }
  if (typeof getThemeColorExtraSlotSettings === 'function' && typeof MeldexThemeManager.setThemeColorExtraSlotSettingsOnTheme === 'function') {
    MeldexThemeManager.setThemeColorExtraSlotSettingsOnTheme(theme, getThemeColorExtraSlotSettings());
  }
  if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveText !== 'function') {
    showStatus('保存ダイアログを初期化できませんでした', true);
    return;
  }
  MeldexExportSave.saveText(JSON.stringify(payload, null, 2), {
    filename: _settingsThemeExportFilename(theme),
    extension: '.json',
    dialogTitle: 'テーマとして保存',
    filetypes: [['JSONファイル', '*.json'], ['すべてのファイル', '*.*']],
    okMessage: 'テーマを保存しました',
    errorMessage: 'テーマの保存に失敗しました',
  });
}

function _settingsThemeExportFilename(theme) {
  const raw = String(theme?.name || theme?.id || 'テーマ').trim() || 'テーマ';
  const safe = raw.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'テーマ';
  return `Meldex_${safe}_テーマ.json`;
}

function _settingsThemeImportPayload(payload) {
  if (typeof MeldexThemeManager === 'undefined') return null;
  let imported = null;
  const withPayloadSettings = theme => {
    if (!theme || typeof theme !== 'object') return theme;
    const next = { ...theme, ui: { ...(theme.ui || {}) } };
    if (Object.prototype.hasOwnProperty.call(payload || {}, 'useOsAccentColor')) {
      next.ui.useOsAccentColor = !!payload.useOsAccentColor;
    }
    return next;
  };
  if (Object.prototype.hasOwnProperty.call(payload || {}, 'useOsAccentColor') && typeof MeldexThemeManager.setUseOsAccentColor === 'function') {
    MeldexThemeManager.setUseOsAccentColor(!!payload.useOsAccentColor);
  }
  if (Array.isArray(payload?.customThemes)) {
    payload.customThemes.forEach(theme => { imported = MeldexThemeManager.importCustomTheme(withPayloadSettings(theme)); });
  } else {
    imported = MeldexThemeManager.importCustomTheme(withPayloadSettings(payload?.theme || payload));
  }
  if (imported) {
    MeldexThemeManager.applyDefaultTheme(imported.id, { silent: true, resetThemeColorSet: false });
    if (typeof _settingsThemeSetDirty === 'function') _settingsThemeSetDirty(false);
  }
  return imported;
}

function settingsThemeImport() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,application/json';
  inp.onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => {
      try {
        const imported = _settingsThemeImportPayload(JSON.parse(ev.target.result));
        if (!imported) throw new Error('テーマが見つかりません');
        _refreshSettingsThemePanel(imported.id);
        showStatus('テーマを読み込みました');
      } catch (err) {
        showStatus('テーマ読み込み失敗: ' + err.message, true);
      }
    };
    r.readAsText(f, 'UTF-8');
  };
  inp.click();
}

/* Source chunk: gb-settings.part06.js */
/* gb-settings.part06.js: Discord knowledge bot settings */

let _discordBotSettingsCache = null;

function _discordBotEsc(value) {
  return typeof esc === 'function'
    ? esc(value)
    : String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _discordBotIcon(name, size) {
  return typeof lucide === 'function' ? lucide(name, size || 14) : '';
}

function _discordBotDefaultBot() {
  return {
    bot_id: '',
    bot_name: 'Meldex Knowledge Bot',
    application_id: '',
    icon_url: '',
    enabled: false,
    paused: true,
    default_source_folder: '',
    slash_command_prefix: 'meldex',
    search_only: true,
    llm_response_enabled: false,
    llm_provider: '',
    llm_model: '',
    monthly_budget_jpy: 0,
    requests_per_minute: 10,
    daily_message_limit: 200,
    system_prompt: '',
    has_token: false,
    has_llm_api_key: false,
  };
}

async function renderDiscordBotSettings(root) {
  const scope = root?.querySelector ? root : document;
  const container = scope.querySelector('#discord-bot-settings-container') || document.getElementById('discord-bot-settings-container');
  if (!container) return;
  container.innerHTML = `<section class="gb-section gb-section--boxed"><div class="gb-section-title">${_discordBotIcon('bot',14)} Discord Bot</div><div class="gb-section-desc">読み込み中...</div></section>`;
  try {
    _discordBotSettingsCache = await apiFetch('/discord-bot/settings');
    _renderDiscordBotSettingsContainer(container, _discordBotSettingsCache);
  } catch (e) {
    container.innerHTML = `<section class="gb-section gb-section--boxed"><div class="gb-section-title">${_discordBotIcon('triangleAlert',14)} Discord Bot</div><div class="gb-section-desc">読み込みに失敗しました: ${_discordBotEsc(e.message)}</div></section>`;
  }
}

function _renderDiscordBotSettingsContainer(container, settings) {
  const bots = Array.isArray(settings?.bots) ? settings.bots : [];
  container.innerHTML = `
    <section class="gb-section gb-section--boxed">
      <div class="gb-section-title">${_discordBotIcon('bot',14)} Discord Bot 常駐</div>
      <label class="gb-check">
        <input id="discord-bot-master-enabled" type="checkbox" ${settings?.master_enabled ? 'checked' : ''}>
        <span>このPCでDiscord Botを起動する</span>
      </label>
      <div class="gb-section-desc">Bot TokenとLLM APIキーはこの端末内で暗号化保存します。APIレスポンスには復号値を返しません。</div>
      <div class="gb-section-desc">暗号化方式: ${_discordBotEsc(settings?.encryption_backend || '')}</div>
      <div class="gb-field-row" style="justify-content:flex-start;gap:8px;flex-wrap:wrap;">
        <button type="button" class="gb-btn gb-btn-sm" id="discord-bot-add">${_discordBotIcon('plus',14)} Bot追加</button>
        <button type="button" class="gb-btn gb-btn-sm" id="discord-bot-template">${_discordBotIcon('fileJson',14)} テンプレート読込</button>
        <button type="button" class="gb-btn gb-btn-sm" id="discord-bot-refresh">${_discordBotIcon('refreshCw',14)} 状態更新</button>
      </div>
    </section>
    <div id="discord-bot-list" style="display:flex;flex-direction:column;gap:10px;">
      ${bots.map((bot, index) => _discordBotCardHtml(bot, index)).join('') || _discordBotCardHtml(_discordBotDefaultBot(), 0)}
    </div>
    <section class="gb-section gb-section--boxed">
      <div class="gb-section-title">${_discordBotIcon('search',14)} 公開ナレッジ検索テスト</div>
      <div class="gb-field-row" style="align-items:flex-start;">
        <input id="discord-bot-test-query" class="gb-input" style="flex:1;" placeholder="検索語">
        <button type="button" class="gb-btn gb-btn-sm" id="discord-bot-test-run">検索</button>
      </div>
      <pre id="discord-bot-test-output" class="gb-code-block" style="white-space:pre-wrap;max-height:180px;overflow:auto;"></pre>
    </section>
    <div id="discord-bot-settings-status" class="gb-section-desc"></div>
  `;
  _bindDiscordBotSettings(container);
  if (typeof replaceIcons === 'function') replaceIcons(container);
}

function _discordBotCardHtml(bot, index) {
  const id = _discordBotEsc(bot.bot_id || '');
  const tokenPlaceholder = bot.has_token ? '保存済み（変更時のみ入力）' : 'Bot Token';
  const llmKeyPlaceholder = bot.has_llm_api_key ? '保存済み（変更時のみ入力）' : 'LLM APIキー（任意）';
  return `
    <section class="gb-section gb-section--boxed discord-bot-card" data-bot-id="${id}">
      <div class="gb-section-title" style="justify-content:space-between;gap:8px;">
        <span>${_discordBotIcon('bot',14)} Bot ${index + 1}</span>
        <span class="gb-section-desc" data-discord-runtime="${id}">${_discordBotEsc(bot.last_error || '')}</span>
      </div>
      <div class="gb-field-row">
        <label class="gb-field" style="flex:1;min-width:180px;">
          <span class="gb-label">名前</span>
          <input class="gb-input" data-e2e-id="discord-bot-${index}-bot-name" data-discord-field="bot_name" value="${_discordBotEsc(bot.bot_name || '')}" placeholder="Meldex Knowledge Bot">
        </label>
        <label class="gb-field" style="width:140px;">
          <span class="gb-label">Slash名</span>
          <input class="gb-input" data-e2e-id="discord-bot-${index}-slash-command" data-discord-field="slash_command_prefix" value="${_discordBotEsc(bot.slash_command_prefix || 'meldex')}" placeholder="meldex">
        </label>
      </div>
      <div class="gb-field-row">
        <label class="gb-field" style="flex:1;min-width:180px;">
          <span class="gb-label">Application ID</span>
          <input class="gb-input" data-e2e-id="discord-bot-${index}-application-id" data-discord-field="application_id" value="${_discordBotEsc(bot.application_id || '')}" placeholder="1234567890">
        </label>
        <label class="gb-field" style="flex:1;min-width:180px;">
          <span class="gb-label">Bot Token</span>
          <input class="gb-input" type="password" data-e2e-id="discord-bot-${index}-token" data-discord-field="token" placeholder="${_discordBotEsc(tokenPlaceholder)}" autocomplete="off">
        </label>
      </div>
      <label class="gb-field">
        <span class="gb-label">既定ソースフォルダ</span>
        <input class="gb-input" data-e2e-id="discord-bot-${index}-default-source-folder" data-discord-field="default_source_folder" value="${_discordBotEsc(bot.default_source_folder || '')}" placeholder="未指定時は現在のソースフォルダ">
      </label>
      <div class="gb-field-row" style="align-items:flex-start;">
        <label class="gb-check"><input type="checkbox" data-e2e-id="discord-bot-${index}-enabled" data-discord-field="enabled" ${bot.enabled ? 'checked' : ''}><span>有効</span></label>
        <label class="gb-check"><input type="checkbox" data-e2e-id="discord-bot-${index}-paused" data-discord-field="paused" ${bot.paused ? 'checked' : ''}><span>一時停止</span></label>
        <label class="gb-check"><input type="checkbox" data-e2e-id="discord-bot-${index}-search-only" data-discord-field="search_only" ${bot.search_only ? 'checked' : ''}><span>検索のみ</span></label>
        <label class="gb-check"><input type="checkbox" data-e2e-id="discord-bot-${index}-llm-response" data-discord-field="llm_response_enabled" ${bot.llm_response_enabled ? 'checked' : ''}><span>LLM応答</span></label>
      </div>
      <div class="gb-field-row">
        <label class="gb-field" style="width:150px;">
          <span class="gb-label">LLM</span>
          <select class="gb-select" data-e2e-id="discord-bot-${index}-llm-provider" data-discord-field="llm_provider">
            ${['','anthropic','openai','gemini'].map(v => `<option value="${v}" ${String(bot.llm_provider || '') === v ? 'selected' : ''}>${v || '未使用'}</option>`).join('')}
          </select>
        </label>
        <label class="gb-field" style="flex:1;">
          <span class="gb-label">モデル</span>
          <input class="gb-input" data-e2e-id="discord-bot-${index}-llm-model" data-discord-field="llm_model" value="${_discordBotEsc(bot.llm_model || '')}" placeholder="claude-3-5-haiku-latest">
        </label>
        <label class="gb-field" style="flex:1;">
          <span class="gb-label">LLM APIキー</span>
          <input class="gb-input" type="password" data-e2e-id="discord-bot-${index}-llm-api-key" data-discord-field="llm_api_key" placeholder="${_discordBotEsc(llmKeyPlaceholder)}" autocomplete="off">
        </label>
      </div>
      <div class="gb-field-row">
        <label class="gb-field" style="width:130px;">
          <span class="gb-label">円/月</span>
          <input class="gb-input" type="number" min="0" step="100" data-e2e-id="discord-bot-${index}-monthly-budget" data-discord-field="monthly_budget_jpy" value="${_discordBotEsc(bot.monthly_budget_jpy || 0)}">
        </label>
        <label class="gb-field" style="width:130px;">
          <span class="gb-label">回/分</span>
          <input class="gb-input" type="number" min="1" max="120" data-e2e-id="discord-bot-${index}-requests-per-minute" data-discord-field="requests_per_minute" value="${_discordBotEsc(bot.requests_per_minute || 10)}">
        </label>
        <label class="gb-field" style="width:130px;">
          <span class="gb-label">回/日</span>
          <input class="gb-input" type="number" min="1" data-e2e-id="discord-bot-${index}-daily-message-limit" data-discord-field="daily_message_limit" value="${_discordBotEsc(bot.daily_message_limit || 200)}">
        </label>
      </div>
      <label class="gb-field">
        <span class="gb-label">公開応答用システムプロンプト</span>
        <textarea class="gb-input" rows="3" data-e2e-id="discord-bot-${index}-system-prompt" data-discord-field="system_prompt" placeholder="未入力なら既定ルールのみ">${_discordBotEsc(bot.system_prompt || '')}</textarea>
      </label>
      <div class="gb-field-row" style="justify-content:flex-start;gap:8px;flex-wrap:wrap;">
        <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="discord-bot-${index}-invite" data-discord-action="invite">${_discordBotIcon('externalLink',14)} 招待URL</button>
        <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="discord-bot-${index}-start" data-discord-action="start">${_discordBotIcon('play',14)} 起動</button>
        <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="discord-bot-${index}-stop" data-discord-action="stop">${_discordBotIcon('square',14)} 停止</button>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-danger" data-e2e-id="discord-bot-${index}-delete" data-discord-action="delete">${_discordBotIcon('trash2',14)} 削除</button>
      </div>
    </section>
  `;
}

function _bindDiscordBotSettings(container) {
  container.querySelector('#discord-bot-add')?.addEventListener('click', () => {
    const list = container.querySelector('#discord-bot-list');
    list?.insertAdjacentHTML('beforeend', _discordBotCardHtml(_discordBotDefaultBot(), container.querySelectorAll('.discord-bot-card').length));
    const card = list?.lastElementChild;
    if (card) _bindDiscordBotCard(card);
    if (typeof replaceIcons === 'function') replaceIcons(container);
  });
  container.querySelector('#discord-bot-template')?.addEventListener('click', applyDiscordBotTemplate);
  container.querySelector('#discord-bot-refresh')?.addEventListener('click', refreshDiscordBotRuntimeStatus);
  container.querySelector('#discord-bot-test-run')?.addEventListener('click', runDiscordBotTestSearch);
  container.querySelectorAll('.discord-bot-card').forEach(card => _bindDiscordBotCard(card));
}

function _bindDiscordBotCard(card) {
  card.querySelectorAll('[data-discord-action]').forEach(btn => {
    if (btn.dataset.discordBound === '1') return;
    btn.dataset.discordBound = '1';
    btn.addEventListener('click', () => _handleDiscordBotAction(btn));
  });
}

function _discordBotNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _discordBotPayloadFromCard(card) {
  const value = name => card.querySelector(`[data-discord-field="${name}"]`)?.value?.trim?.() || '';
  const checked = name => !!card.querySelector(`[data-discord-field="${name}"]`)?.checked;
  return {
    bot_id: card.dataset.botId || '',
    bot_name: value('bot_name'),
    application_id: value('application_id'),
    token: value('token'),
    default_source_folder: value('default_source_folder'),
    slash_command_prefix: value('slash_command_prefix') || 'meldex',
    enabled: checked('enabled'),
    paused: checked('paused'),
    search_only: checked('search_only'),
    llm_response_enabled: checked('llm_response_enabled'),
    llm_provider: value('llm_provider'),
    llm_model: value('llm_model'),
    llm_api_key: value('llm_api_key'),
    monthly_budget_jpy: _discordBotNumber(value('monthly_budget_jpy'), 0),
    requests_per_minute: _discordBotNumber(value('requests_per_minute'), 10),
    daily_message_limit: _discordBotNumber(value('daily_message_limit'), 200),
    system_prompt: value('system_prompt'),
  };
}

function _discordBotSettingsPayload() {
  const bots = Array.from(document.querySelectorAll('#discord-bot-list .discord-bot-card'))
    .map(_discordBotPayloadFromCard)
    .filter(_discordBotPayloadIsMeaningful);
  return {
    master_enabled: !!document.getElementById('discord-bot-master-enabled')?.checked,
    bots,
  };
}

function _discordBotPayloadIsMeaningful(bot) {
  const base = _discordBotDefaultBot();
  if (bot.bot_id || bot.token || bot.llm_api_key) return true;
  if (bot.application_id || bot.default_source_folder || bot.icon_url || bot.system_prompt) return true;
  if (bot.bot_name && bot.bot_name !== base.bot_name) return true;
  if ((bot.slash_command_prefix || 'meldex') !== base.slash_command_prefix) return true;
  if (bot.enabled || !bot.paused || !bot.search_only || bot.llm_response_enabled) return true;
  if (bot.llm_provider || bot.llm_model) return true;
  if (Number(bot.monthly_budget_jpy || 0) !== 0) return true;
  if (Number(bot.requests_per_minute || 10) !== 10) return true;
  if (Number(bot.daily_message_limit || 200) !== 200) return true;
  return false;
}

async function saveDiscordBotSettingsFromSettingsDialog(options = {}) {
  const container = document.getElementById('discord-bot-settings-container');
  if (!container) return true;
  try {
    const payload = _discordBotSettingsPayload();
    const result = await apiPost('/discord-bot/settings', payload);
    _discordBotSettingsCache = result;
    if (!options.skipRender) _renderDiscordBotSettingsContainer(container, result);
    if (!options.silent) showStatus('Discord Bot設定を保存しました');
    return true;
  } catch (e) {
    if (!options.silent) showStatus('Discord Bot設定の保存に失敗: ' + e.message, true);
    return false;
  }
}

async function applyDiscordBotTemplate() {
  const template = await apiFetch('/discord-bot/template');
  _discordBotSettingsCache = { master_enabled: false, encryption_backend: _discordBotSettingsCache?.encryption_backend || '', bots: template.bots || [] };
  const container = document.getElementById('discord-bot-settings-container');
  if (container) _renderDiscordBotSettingsContainer(container, _discordBotSettingsCache);
}

async function refreshDiscordBotRuntimeStatus() {
  const container = document.getElementById('discord-bot-settings-container');
  const statusEl = document.getElementById('discord-bot-settings-status');
  try {
    const status = await apiFetch('/discord-bot/status');
    (status.bots || []).forEach(bot => {
      const el = container?.querySelector?.(`[data-discord-runtime="${_discordBotEsc(bot.bot_id)}"]`);
      if (!el) return;
      const runtime = bot.runtime || {};
      el.textContent = runtime.running ? 'running' : (runtime.status || 'stopped');
      if (runtime.error) el.textContent += ' / ' + runtime.error;
    });
    if (statusEl) statusEl.textContent = status.dependency?.available ? 'discord.py 利用可' : (status.dependency?.error || 'discord.py 未検出');
  } catch (e) {
    if (statusEl) statusEl.textContent = '状態取得に失敗: ' + e.message;
  }
}

async function _handleDiscordBotAction(btn) {
  const card = btn.closest('.discord-bot-card');
  if (!card) return;
  const action = btn.dataset.discordAction;
  const statusEl = document.getElementById('discord-bot-settings-status');
  const payload = _discordBotPayloadFromCard(card);
  try {
    if (action === 'delete') {
      if (payload.bot_id) await apiFetch('/discord-bot/bots/' + encodeURIComponent(payload.bot_id), { method: 'DELETE' });
      card.remove();
      return;
    }
    if (action === 'start' || action === 'invite' || !payload.bot_id || payload.token || payload.llm_api_key) {
      const saved = await apiPost('/discord-bot/bots', payload);
      card.dataset.botId = saved.bot?.bot_id || '';
      payload.bot_id = card.dataset.botId;
      card.querySelectorAll('input[type="password"]').forEach(input => { input.value = ''; });
    }
    if (action === 'invite') {
      const data = await apiPost('/discord-bot/invite-url', { bot_id: payload.bot_id, application_id: payload.application_id });
      if (data.url) window.open(data.url, '_blank', 'noopener');
      return;
    }
    if (action === 'start' || action === 'stop') {
      const data = await apiPost('/discord-bot/bots/' + encodeURIComponent(payload.bot_id) + '/' + action, {});
      if (statusEl) statusEl.textContent = data.error || data.status || '';
      await refreshDiscordBotRuntimeStatus();
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = e.message;
  }
}

async function runDiscordBotTestSearch() {
  const output = document.getElementById('discord-bot-test-output');
  const query = document.getElementById('discord-bot-test-query')?.value || '';
  const firstCard = document.querySelector('#discord-bot-list .discord-bot-card');
  const botId = firstCard?.dataset?.botId || '';
  const sourceFolder = firstCard?.querySelector?.('[data-discord-field="default_source_folder"]')?.value || '';
  if (output) output.textContent = '検索中...';
  try {
    const result = await apiPost('/discord-bot/test-search', { bot_id: botId, source_folder: sourceFolder, query });
    if (output) output.textContent = result.message || JSON.stringify(result.items || [], null, 2);
  } catch (e) {
    if (output) output.textContent = e.message;
  }
}
