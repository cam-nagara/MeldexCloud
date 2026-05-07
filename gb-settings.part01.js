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

