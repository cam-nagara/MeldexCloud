/* Auto-tag settings, model selection, dictionary Sheet, and run panel */
(function () {
  'use strict';

  const settingsState = new WeakMap();
  const runPanelState = new WeakMap();
  const loadBundleCache = new Map();
  const LOAD_BUNDLE_CACHE_TTL_MS = 5000;

  function atEsc(value) {
    if (typeof esc === 'function') return esc(String(value ?? ''));
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
  }

  function atIcon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 14) : '';
  }

  function atFieldHelp(text) {
    if (typeof fieldHelp === 'function') return fieldHelp(text);
    return `<span class="gb-field-help" tabindex="0" data-gb-tooltip="${atEsc(text)}">?</span>`;
  }

  function atNormalizedPath(value) {
    return String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLocaleLowerCase();
  }

  function atCurrentPath() {
    if (typeof _folderPath !== 'undefined' && _folderPath) return String(_folderPath);
    if (typeof _tabs !== 'undefined' && typeof _activeTabId !== 'undefined') {
      const active = _tabs.find(tab => tab?.id === _activeTabId);
      if (active?.path) return String(active.path);
    }
    if (typeof state !== 'undefined') {
      return String(
        state.currentEntityPath
        || state.currentPagePath
        || state.currentDbPath
        || state.currentBoardPath
        || '',
      );
    }
    return '';
  }

  function atSourceFolderForPath(targetPath) {
    const candidates = [targetPath, atCurrentPath()].map(atNormalizedPath).filter(Boolean);
    const options = typeof _chatSourceOptions === 'function' ? _chatSourceOptions() : [];
    let match = null;
    options.forEach(option => {
      const rawRoot = String(option?.path || '').trim();
      const root = atNormalizedPath(rawRoot);
      if (!root) return;
      if (candidates.some(path => path === root || path.startsWith(root + '/'))) {
        if (!match || root.length > match.normalized.length) match = { path: rawRoot, normalized: root };
      }
    });
    if (match) return match.path;
    const vault = typeof state !== 'undefined' ? String(state?.vaultPath || '').trim() : '';
    if (vault) return vault;
    const chatSource = typeof _chatSourceFolderValue === 'function'
      ? String(_chatSourceFolderValue() || '').trim()
      : '';
    return chatSource.startsWith('workspace:') ? '' : chatSource;
  }

  function atDictionaryApiPath(path, targetPath, sourceFolderOverride) {
    const sourceFolder = String(sourceFolderOverride || '').trim() || atSourceFolderForPath(targetPath);
    if (!sourceFolder) return path;
    return path + (path.includes('?') ? '&' : '?') + 'source_folder=' + encodeURIComponent(sourceFolder);
  }

  function atDictionaryPayload(payload, targetPath, sourceFolderOverride) {
    const sourceFolder = String(sourceFolderOverride || '').trim() || atSourceFolderForPath(targetPath);
    return sourceFolder ? { ...(payload || {}), source_folder: sourceFolder } : { ...(payload || {}) };
  }

  function atPresetNames(dictionary) {
    const fromApi = Array.isArray(dictionary?.preset_names) ? dictionary.preset_names : [];
    const names = fromApi.length
      ? fromApi
      : [...new Set((dictionary?.tags || []).flatMap(tag => tag.presets || ['標準']))];
    return names.filter(Boolean).sort((left, right) => String(left).localeCompare(String(right), 'ja'));
  }

  function atSelectedPresetNames(settings, dictionary) {
    const available = atPresetNames(dictionary);
    const selected = Array.isArray(settings?.preset_names) ? settings.preset_names : [];
    const valid = selected.filter(name => available.includes(name));
    return valid.length ? valid : available.slice(0, 1);
  }

  const AT_CLI_CATALOG_LIMIT = 2000;

  function atSelectedAutoTagCount(dictionary, selectedNames) {
    const selected = new Set((selectedNames || []).map(name => String(name)));
    return (dictionary?.tags || []).filter(tag => {
      if (!tag?.auto_assign) return false;
      const presets = Array.isArray(tag.presets) && tag.presets.length ? tag.presets : ['標準'];
      return presets.some(name => selected.has(String(name)));
    }).length;
  }

  function atPresetOptionsHtml(dictionary, selectedNames, prefix) {
    const selected = new Set(selectedNames || []);
    return atPresetNames(dictionary).map((name, index) => {
      const tagCount = atSelectedAutoTagCount(dictionary, [name]);
      const localOnlyHelp = tagCount > AT_CLI_CATALOG_LIMIT
        ? atFieldHelp(`${tagCount.toLocaleString('ja-JP')}件の有効タグがあります。CLI AIの2,000件上限を超えるため、ローカル画像AIで使ってください。`)
        : '';
      return `
        <label class="at-preset-option" for="${prefix}-${index}">
          <input id="${prefix}-${index}" type="checkbox" data-e2e-id="${prefix}-${index}" data-at-preset="${atEsc(name)}" ${selected.has(name) ? 'checked' : ''}>
          <span>${atEsc(name)}${localOnlyHelp}</span>
        </label>
      `;
    }).join('');
  }

  function atStatus(message, error) {
    if (typeof showStatus === 'function') showStatus(message, !!error);
  }

  function isAutoTagRuntimeAvailable() {
    const standalonePage = /(?:^|\/)[^/?#]*-standalone\.html$/i.test(location.pathname || '')
      || /(?:^|\/)quick-memo\.html$/i.test(location.pathname || '')
      || document.documentElement?.dataset?.standaloneApp;
    if (standalonePage) return false;
    const dropboxMode = window.MeldexRuntimeAdapter?.isDropboxMode?.()
      || document.body?.dataset?.cloudMode === 'dropbox';
    const serverMode = window.MeldexRuntimeAdapter?.isServerMode?.()
      || document.body?.dataset?.cloudMode === 'server';
    if (serverMode) return true;
    const cloudStatic = Boolean(window.MeldexCloudRuntimeConfig?.cloudPublicUrl)
      && String(window.MeldexCloudRuntimeConfig?.version?.variant || '').includes('cloud');
    return !dropboxMode && !cloudStatic;
  }

  function isTagDictionaryEditingAvailable() {
    return typeof window.apiFetch === 'function' || typeof window.apiPost === 'function';
  }

  function isTagDictionarySheetOpenAvailable() {
    return isTagDictionaryEditingAvailable()
      && isAutoTagRuntimeAvailable()
      && typeof window.selectDatabase === 'function';
  }

  function invalidateAutoTagBundleCache() {
    loadBundleCache.clear();
  }

  async function atLoadBundle(targetPath, options) {
    const cacheKey = atSourceFolderForPath(targetPath) || '__default__';
    const cached = loadBundleCache.get(cacheKey);
    if (!options?.force && cached && (Date.now() - cached.at) < LOAD_BUNDLE_CACHE_TTL_MS) {
      return cached.promise;
    }
    const promise = (async () => {
      const dictionaryPromise = apiFetch(
        atDictionaryApiPath('/auto-tag/dictionary', targetPath),
        { silentError: true },
      ).catch(error => ({
        tags: [],
        groups: [],
        preset_names: ['標準'],
        load_error: error?.userMessage || error?.message || String(error),
      }));
      const [settingsResult, modelsResult, dictionaryResult] = await Promise.all([
        apiFetch('/auto-tag/settings', { silentError: true }),
        apiFetch('/auto-tag/models', { silentError: true }),
        dictionaryPromise,
      ]);
      return {
        settings: settingsResult?.settings || {},
        models: Array.isArray(modelsResult?.models) ? modelsResult.models : [],
        dictionary: dictionaryResult || { tags: [], groups: [], db_path: '' },
      };
    })().catch(error => {
      loadBundleCache.delete(cacheKey);
      throw error;
    });
    loadBundleCache.set(cacheKey, { at: Date.now(), promise });
    return promise;
  }

  function atModelForState(state) {
    const ai = state.settings.ai_id || 'auto';
    const selectedId = ai === 'cli' ? state.settings.cli_model_id : state.settings.model_id;
    return state.models.find(model => model.id === selectedId)
      || state.models.find(model => ai === 'cli' ? model.ai_id === 'cli' : model.ai_id === 'local-wd')
      || state.models[0]
      || null;
  }

  function atVisibleModels(state) {
    const ai = state.settings.ai_id || 'auto';
    if (ai === 'cli') return state.models.filter(model => model.ai_id === 'cli');
    return state.models.filter(model => model.ai_id === 'local-wd');
  }

  function atReadyLabel(model) {
    if (!model) return { text: '利用できるモデルがありません', kind: 'error' };
    if (!model.local) return { text: 'CLI設定を確認して利用', kind: 'neutral' };
    if (model.ready) return { text: 'インストール済み', kind: 'ready' };
    if (model.installed && !model.runtime_ready) return { text: '実行環境が必要', kind: 'warn' };
    return { text: '未インストール', kind: 'warn' };
  }

  function atAiButtons(state) {
    const current = state.settings.ai_id || 'auto';
    const items = [
      ['auto', '自動選択'],
      ['local-wd', 'ローカル画像AI'],
      ['cli', 'CLI AI'],
    ];
    return items.map(([id, label]) => `
      <button type="button" class="at-segment${current === id ? ' is-active' : ''}" data-at-ai="${id}"
        aria-pressed="${current === id ? 'true' : 'false'}">${atEsc(label)}</button>
    `).join('');
  }

  function atModelCards(state) {
    const selected = atModelForState(state);
    return atVisibleModels(state).map(model => {
      const ready = atReadyLabel(model);
      return `
        <button type="button" class="at-model-card${selected?.id === model.id ? ' is-selected' : ''}"
          data-at-model="${atEsc(model.id)}" aria-pressed="${selected?.id === model.id ? 'true' : 'false'}">
          <span class="at-model-check">${selected?.id === model.id ? atIcon('check', 13) : ''}</span>
          <span class="at-model-main">
            <span class="at-model-name">${atEsc(model.name)}</span>
            <span class="at-model-sub">${atEsc(model.summary)}</span>
          </span>
          <span class="at-model-meta">
            <span class="at-model-badges"><span>${atEsc(model.accuracy)}</span><span>${atEsc(model.speed)}</span></span>
            <span class="at-ready at-ready--${ready.kind}">${atEsc(ready.text)}</span>
          </span>
        </button>
      `;
    }).join('');
  }

  function atModelDetails(state) {
    const model = atModelForState(state);
    if (!model) return '<div class="gb-section-desc">利用可能なモデルがありません。</div>';
    const guide = (model.install_guide || []).map(item => `<li>${atEsc(item)}</li>`).join('');
    const ready = atReadyLabel(model);
    const installing = state.installing?.modelId === model.id;
    const installButton = model.local && !model.installed
      ? `<button type="button" class="gb-btn gb-btn-sm" data-at-install="${atEsc(model.id)}" ${installing ? 'disabled' : ''}>${atIcon('download', 14)} ${installing ? '取得しています…' : 'モデルを入手'}</button>`
      : '';
    const guideLink = model.model_url
      ? `<button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-at-guide="${atEsc(model.model_url)}">${atIcon('externalLink', 14)} 公式配布元</button>`
      : '';
    let installState = '';
    if (installing) {
      installState = `<p class="at-install-state at-install-state--working" data-at-install-state role="status" aria-live="polite">${atEsc(state.installing.message || 'モデルを取得しています…')}</p>`;
    } else if (state.installNotice?.modelId === model.id) {
      const kind = state.installNotice.error ? 'error' : 'ready';
      installState = `<p class="at-install-state at-install-state--${kind}" data-at-install-state role="status" aria-live="polite">${atEsc(state.installNotice.message)}</p>`;
    } else if (model.local && model.installed && !model.runtime_ready) {
      installState = '<p class="at-install-state at-install-state--warn" data-at-install-state role="status">モデルファイルは取得済みです。現在のMeldexには画像AIの実行環境がないため、Meldexを更新または実行環境を導入して再起動してください。</p>';
    }
    return `
      <div class="at-detail-head">
        <div>
          <div class="at-detail-name">${atEsc(model.name)}${!model.local ? atFieldHelp('CLI AIは画像ごとに外部CLI処理を待つため、大量画像には時間がかかります。大量処理にはローカル画像AIを推奨します。') : ''}</div>
          <div class="at-ready at-ready--${ready.kind}">${atEsc(ready.text)}</div>
        </div>
        <div class="at-detail-size">${atEsc(model.size || '')}</div>
      </div>
      <h4>特徴</h4>
      <p>${atEsc(model.summary)}</p>
      <h4>得意分野</h4>
      <p>${atEsc(model.strengths || '')}</p>
      <h4>入手・設定方法</h4>
      <ol class="at-guide-list">${guide}</ol>
      ${model.local ? `<div class="at-install-path">${atIcon('folder', 12)} ${atEsc(model.install_path || '')}</div>` : ''}
      <div class="at-detail-actions">${installButton}${guideLink}</div>
      ${installState}
    `;
  }

  function atRenderSettingsBody(host, state) {
    const settings = state.settings;
    const dictionary = state.dictionary;
    const selected = atModelForState(state);
    host.innerHTML = `
      <div class="at-settings-head">
        <div>
          <h3>自動タグ付け</h3>
          <p>画像や文書から候補を作り、自動タグ辞書で許可したタグだけを付けます。</p>
        </div>
        <label class="at-switch-row">
          <input type="checkbox" data-at-setting="enabled" ${settings.enabled ? 'checked' : ''}>
          <span>自動タグ付けを有効にする</span>
        </label>
      </div>
      <div class="at-field-block">
        <div class="at-field-label">画像の判定方法 ${atFieldHelp('CLI AIは1枚ずつ外部CLIの処理を待つため少数画像向けです。大量画像には、高速で端末内処理できるローカル画像AIを推奨します。')}</div>
        <div class="at-segments" role="group" aria-label="画像の判定方法">${atAiButtons(state)}</div>
        <p class="at-help">自動選択は端末内モデルを優先し、利用できない場合だけ設定済みCLIを使います。従量課金APIへは切り替えません。</p>
      </div>
      <div class="at-field-block">
        <div class="at-field-label">自動タグプリセット ${atFieldHelp('複数選択すると、選んだプリセットに含まれるタグをまとめて候補として使います。プリセットは自動タグ辞書シートの「プリセット」列で設定します。')}</div>
        <div class="at-preset-options" role="group" aria-label="既定の自動タグプリセット">
          ${atPresetOptionsHtml(dictionary, atSelectedPresetNames(settings, dictionary), 'at-setting-preset')}
        </div>
        <p class="at-help">CLI AIでは、選んだプリセットに含まれる有効タグの合計が2,000件までです。標準プリセットの更新や独自タグ追加で1,000件を少し超えても利用できます。上限を超える組み合わせにはローカル画像AIを使ってください。</p>
      </div>
      <div class="at-model-layout">
        <div>
          <div class="at-field-label">使用するモデル</div>
          <div class="at-model-list">${atModelCards(state)}</div>
        </div>
        <aside class="at-model-detail" aria-label="モデルの詳細">${atModelDetails(state)}</aside>
      </div>
      <div class="at-lower-grid">
        <div class="at-device-block">
          <label class="at-field-label" for="at-device-select">処理デバイス</label>
          <select id="at-device-select" class="gb-input" data-at-setting="device">
            <option value="auto" ${settings.device === 'auto' ? 'selected' : ''}>自動</option>
            <option value="gpu" ${settings.device === 'gpu' ? 'selected' : ''}>GPU</option>
            <option value="cpu" ${settings.device === 'cpu' ? 'selected' : ''}>CPU</option>
          </select>
          <details class="at-thresholds">
            <summary>判定の詳細設定</summary>
            <label>一般タグのしきい値
              <input class="gb-input" type="number" min="0" max="1" step="0.01" data-at-setting="general_threshold" value="${atEsc(settings.general_threshold)}">
            </label>
            <label>キャラクターのしきい値
              <input class="gb-input" type="number" min="0" max="1" step="0.01" data-at-setting="character_threshold" value="${atEsc(settings.character_threshold)}">
            </label>
          </details>
          <label class="at-adult-option">
            <input type="checkbox" data-at-setting="allow_adult_local" ${settings.allow_adult_local ? 'checked' : ''}>
            <span><strong>成人向け画像も端末内だけで解析する</strong><small>ローカル画像AIでのみ利用できます。CLI AIの安全制限は変更しません。</small></span>
          </label>
        </div>
        <div class="at-dictionary-card">
          <div class="at-dictionary-title">${atIcon('tableProperties', 16)} 自動タグ辞書</div>
          <p>正式名、別名、ホワイトリスト、プリセット所属、タググループと階層は1つの辞書シートで管理します。</p>
          ${dictionary.load_error ? `<p class="at-help at-help--warn">辞書を読み込めませんでした。対象のソースフォルダを開いてから再試行してください。</p>` : ''}
          <div class="at-dictionary-counts">
            <span>タグ <strong>${Number(dictionary.tags?.length || 0).toLocaleString('ja-JP')}</strong></span>
            <span>グループ <strong>${Number(dictionary.groups?.length || 0).toLocaleString('ja-JP')}</strong></span>
            <span>自動付与 <strong>${Number((dictionary.tags || []).filter(tag => tag.auto_assign).length).toLocaleString('ja-JP')}</strong></span>
          </div>
          <div class="at-dictionary-actions">
            <button type="button" class="gb-btn gb-btn-sm" data-at-open-dictionary>${atIcon('externalLink', 14)} シートを開く</button>
          </div>
          <p class="at-help">プリセットの導入・CSV取込・CSV書出は、右側のタグパネルで行います。</p>
        </div>
      </div>
      <div class="at-settings-footer">
        <span data-at-save-state>選択中: ${atEsc(selected?.name || 'なし')}</span>
        <button type="button" class="gb-btn gb-btn-primary" data-at-save>${atIcon('save', 14)} 設定を保存</button>
      </div>
    `;
    atBindSettings(host, state);
  }

  function atReadSettings(host, state) {
    const next = { ...state.settings };
    host.querySelectorAll('[data-at-setting]').forEach(input => {
      const key = input.dataset.atSetting;
      next[key] = input.type === 'checkbox'
        ? input.checked
        : input.type === 'number' ? Number(input.value) : input.value;
    });
    const presetInputs = [...host.querySelectorAll('[data-at-preset]')];
    if (presetInputs.length) {
      next.preset_names = presetInputs.filter(input => input.checked).map(input => input.dataset.atPreset);
      if (!next.preset_names.length) next.preset_names = [presetInputs[0].dataset.atPreset];
    }
    return next;
  }

  async function atSaveSettingsHost(host, state, options) {
    state.settings = atReadSettings(host, state);
    const result = await apiFetch('/auto-tag/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.settings),
      silentError: true,
    });
    state.settings = result?.settings || state.settings;
    invalidateAutoTagBundleCache();
    const saveState = host.querySelector('[data-at-save-state]');
    if (saveState) saveState.textContent = '保存しました';
    if (!options?.silent) atStatus('自動タグ付け設定を保存しました');
    return true;
  }

  async function atInstallModel(host, state, modelId) {
    state.installing = {
      modelId,
      message: '公式配布元へ接続しています…',
    };
    state.installNotice = null;
    atRenderSettingsBody(host, state);
    atStatus('公式配布元からモデルを取得しています。ほかの操作をしても取得は続きます');
    try {
      const startPath = '/auto-tag/models/' + encodeURIComponent(modelId) + '/install';
      const result = typeof runBackgroundJob === 'function'
        ? await runBackgroundJob(startPath, {}, {
          onProgress(progress) {
            if (state.installing?.modelId !== modelId) return;
            state.installing.message = progress?.message || 'モデルを取得しています…';
            const installState = host.querySelector('[data-at-install-state]');
            if (installState) installState.textContent = state.installing.message;
          },
        })
        : await apiPost(startPath, {}, { silentError: true, timeoutMs: 300000 });
      invalidateAutoTagBundleCache();
      const refreshed = await atLoadBundle(null, { force: true });
      Object.assign(state, refreshed);
      state.installing = null;
      const installedModel = state.models.find(model => model.id === modelId) || result?.model;
      state.installNotice = {
        modelId,
        error: false,
        message: installedModel?.runtime_ready === false
          ? 'モデルの取得は完了しました。画像AIの実行環境を導入したMeldexで再起動すると利用できます。'
          : 'モデルの取得と利用準備が完了しました。',
      };
      atRenderSettingsBody(host, state);
      atStatus(state.installNotice.message);
    } catch (error) {
      const message = 'モデルを取得できませんでした: ' + (error?.userMessage || error?.message || error);
      state.installing = null;
      state.installNotice = { modelId, error: true, message };
      atRenderSettingsBody(host, state);
      atStatus(message, true);
    }
  }

  function atDownloadDictionaryCsv(dictionary) {
    const rows = [['kind', 'name', 'presets', 'parent', 'aliases', 'color', 'auto_assign', 'description', 'sort_index']];
    const groups = Array.isArray(dictionary.groups) ? dictionary.groups : [];
    const byId = Object.fromEntries(groups.map(group => [group.id, group]));
    const pathFor = id => {
      const names = [];
      const seen = new Set();
      while (id && byId[id] && !seen.has(id)) {
        seen.add(id);
        names.unshift(byId[id].name || '');
        id = byId[id].parent_id;
      }
      return names.join(' > ');
    };
    groups.forEach(group => rows.push(['group', group.name, '', pathFor(group.parent_id), '', group.color || '', '', group.description || '', group.sort_index || 0]));
    (dictionary.tags || []).forEach(tag => rows.push([
      'tag', tag.name, (tag.presets || ['標準']).join('\n'), pathFor(tag.group_id), (tag.aliases || []).join('\n'), tag.color || '',
      tag.auto_assign ? 'true' : 'false', tag.description || '', tag.sort_index || 0,
    ]));
    const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const csv = '\ufeff' + rows.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'meldex-auto-tag-dictionary.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function atBindSettings(host, state) {
    host.querySelectorAll('[data-at-ai]').forEach(button => {
      button.addEventListener('click', () => {
        state.settings = atReadSettings(host, state);
        state.settings.ai_id = button.dataset.atAi;
        atRenderSettingsBody(host, state);
      });
    });
    host.querySelectorAll('[data-at-model]').forEach(button => {
      button.addEventListener('click', () => {
        state.settings = atReadSettings(host, state);
        const model = state.models.find(item => item.id === button.dataset.atModel);
        if (model?.ai_id === 'cli') state.settings.cli_model_id = model.id;
        else if (model) state.settings.model_id = model.id;
        atRenderSettingsBody(host, state);
      });
    });
    host.querySelector('[data-at-save]')?.addEventListener('click', () => {
      atSaveSettingsHost(host, state).catch(error => atStatus('設定を保存できませんでした: ' + (error?.userMessage || error?.message || error), true));
    });
    host.querySelectorAll('[data-at-install]').forEach(button => {
      button.addEventListener('click', () => atInstallModel(host, state, button.dataset.atInstall));
    });
    host.querySelectorAll('[data-at-guide]').forEach(button => {
      button.addEventListener('click', () => {
        if (typeof openExternalBrowserUrl === 'function') openExternalBrowserUrl(button.dataset.atGuide);
      });
    });
    host.querySelector('[data-at-open-dictionary]')?.addEventListener('click', () => ensureAutoTagDictionarySheet());
  }

  async function renderAutoTagSettings(root) {
    const scope = root?.querySelector ? root : document;
    const host = scope.querySelector('#auto-tag-settings-container') || document.querySelector('#auto-tag-settings-container');
    if (!host || host.dataset.atLoading === '1') return;
    if (!isAutoTagRuntimeAvailable()) {
      settingsState.delete(host);
      host.hidden = true;
      host.replaceChildren();
      return;
    }
    host.hidden = false;
    host.dataset.atLoading = '1';
    host.innerHTML = '<div class="at-loading">自動タグ付け設定を読み込んでいます…</div>';
    try {
      const state = await atLoadBundle();
      settingsState.set(host, state);
      atRenderSettingsBody(host, state);
    } catch (error) {
      host.innerHTML = `<div class="at-error">設定を読み込めませんでした。${atEsc(error?.userMessage || error?.message || error)}</div>`;
    } finally {
      delete host.dataset.atLoading;
    }
  }

  async function saveAutoTagSettingsFromSettingsDialog(root, options) {
    const scope = root?.querySelector ? root : document;
    const host = scope.querySelector('#auto-tag-settings-container') || document.querySelector('#auto-tag-settings-container');
    const state = host ? settingsState.get(host) : null;
    if (!host || !state) return true;
    return atSaveSettingsHost(host, state, options);
  }

  async function ensureAutoTagDictionarySheet(targetPath, sourceFolder) {
    if (!isTagDictionaryEditingAvailable()) {
      atStatus('タグ辞書を編集できる保存先へ接続してください', true);
      return '';
    }
    const result = await apiPost(
      '/auto-tag/dictionary/ensure',
      atDictionaryPayload({}, targetPath, sourceFolder),
      { silentError: true },
    );
    const dbPath = String(result?.db_path || '').trim();
    if (!dbPath) throw new Error('自動タグ辞書シートの場所を取得できませんでした');
    if (!isTagDictionarySheetOpenAvailable()) {
      atStatus('タグ辞書を準備しました');
      return dbPath;
    }
    document.querySelector('.modal-overlay[data-settings-modal="1"]')?.remove();
    if (typeof refreshOutliner === 'function') refreshOutliner();
    if (typeof selectDatabase === 'function') await selectDatabase(dbPath, undefined, { silent: true });
    atStatus('自動タグ辞書シートを開きました');
    return dbPath;
  }

  async function importAutoTagDictionaryCsv(targetPath, sourceFolder) {
    if (!isTagDictionaryEditingAvailable()) {
      atStatus('タグ辞書を編集できる保存先へ接続してください', true);
      return false;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.hidden = true;
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      try {
        const file = input.files?.[0];
        if (!file) return;
        const payload = atDictionaryPayload({
          csv_text: await file.text(),
          preset_name: String(file.name || '').replace(/\.csv$/i, '') || '標準',
        }, targetPath, sourceFolder);
        const result = typeof runBackgroundJob === 'function'
          ? await runBackgroundJob('/auto-tag/dictionary/import', payload, {
            onProgress(progress) {
              const message = progress?.message
                || (typeof formatJobProgress === 'function'
                  ? formatJobProgress(progress, { unit: '件', defaultPhase: 'タグ辞書へ取込中' })
                  : 'タグ辞書へ取り込んでいます…');
              atStatus(message);
            },
          })
          : await apiPost('/auto-tag/dictionary/import', payload, { silentError: true, timeoutMs: 300000 });
        window.MeldexGlobalTags?.invalidateTagsCatalogCache?.(sourceFolder || atSourceFolderForPath(targetPath));
        invalidateAutoTagBundleCache();
        await window.MeldexTagManagement?.refresh?.(false);
        atStatus(`${result?.imported || 0}件を自動タグ辞書へ取り込みました`);
      } catch (error) {
        atStatus('CSVを取り込めませんでした: ' + (error?.userMessage || error?.message || error), true);
      } finally {
        input.remove();
      }
    }, { once: true });
    input.click();
  }

  async function exportAutoTagDictionaryCsv(targetPath, sourceFolder) {
    if (!isTagDictionaryEditingAvailable()) {
      atStatus('タグ辞書を読み込める保存先へ接続してください', true);
      return false;
    }
    const dictionary = await apiFetch(
      atDictionaryApiPath('/auto-tag/dictionary', targetPath, sourceFolder),
      { silentError: true },
    );
    atDownloadDictionaryCsv(dictionary || {});
    atStatus('自動タグ辞書をCSVへ書き出しました');
  }

  function atRunModelOptions(state) {
    const aiId = state.aiSelect.value;
    const models = state.models.filter(model => {
      if (aiId === 'local-wd') return model.ai_id === 'local-wd';
      if (aiId === 'cli') return model.ai_id === 'cli';
      return model.ai_id === 'local-wd';
    });
    const preferred = aiId === 'cli' ? state.settings.cli_model_id : state.settings.model_id;
    state.modelSelect.innerHTML = models.map(model => `<option value="${atEsc(model.id)}">${atEsc(model.name)}</option>`).join('');
    state.modelSelect.value = models.some(model => model.id === preferred) ? preferred : (models[0]?.id || '');
    atUpdateRunReadiness(state);
  }

  function atUpdateRunReadiness(state) {
    const model = state.models.find(item => item.id === state.modelSelect.value);
    const presetNames = [...state.host.querySelectorAll('[data-at-run-preset]')]
      .filter(input => input.checked)
      .map(input => input.dataset.atRunPreset);
    const tagCount = atSelectedAutoTagCount(state.dictionary, presetNames);
    const usesCli = state.aiSelect.value === 'cli'
      || (state.aiSelect.value === 'auto' && (!model?.local || !model.ready));
    if (usesCli && tagCount > AT_CLI_CATALOG_LIMIT) {
      state.readiness.className = 'at-run-ready at-ready--error';
      state.readiness.textContent = `CLI上限超過（${tagCount.toLocaleString('ja-JP')}件 / 2,000件）`;
      state.runButton.disabled = true;
      state.runButton.title = 'プリセットを減らすか、ローカル画像AIを選んでください';
      return;
    }
    const ready = atReadyLabel(model);
    state.readiness.className = 'at-run-ready at-ready--' + ready.kind;
    state.readiness.textContent = ready.text;
    state.runButton.disabled = !!model?.local && !model.ready && state.aiSelect.value !== 'auto';
    state.runButton.removeAttribute('title');
  }

  function atNormalizeRunTargets(path, options) {
    const seen = new Set();
    const rawTargets = Array.isArray(options?.targets) && options.targets.length
      ? options.targets
      : [{ path, recursive: options?.recursive }];
    return rawTargets.map(item => ({
      path: String(item?.path || item || '').trim(),
      recursive: typeof item === 'object' ? !!item?.recursive : false,
    })).filter(item => {
      if (!item.path || seen.has(item.path)) return false;
      seen.add(item.path);
      return true;
    });
  }

  async function atRunFromPanel(state) {
    state.runButton.disabled = true;
    const oldText = state.runButton.innerHTML;
    state.runButton.textContent = '実行中…';
    try {
      const presetInputs = [...state.host.querySelectorAll('[data-at-run-preset]')];
      const presetNames = presetInputs.filter(input => input.checked)
        .map(input => input.dataset.atRunPreset);
      if (presetInputs.length && !presetNames.length) {
        atStatus('自動タグプリセットを1つ以上選択してください', true);
        return;
      }
      const model = state.models.find(item => item.id === state.modelSelect.value);
      const usesCli = state.aiSelect.value === 'cli'
        || (state.aiSelect.value === 'auto' && (!model?.local || !model.ready));
      const tagCount = atSelectedAutoTagCount(state.dictionary, presetNames);
      if (usesCli && tagCount > AT_CLI_CATALOG_LIMIT) {
        atStatus(`CLI AIで使える有効タグは2,000件までです（現在${tagCount.toLocaleString('ja-JP')}件）。プリセットを減らすか、ローカル画像AIを選んでください。`, true);
        return;
      }
      const targetPayload = state.targets.length > 1
        ? { targets: state.targets, label: state.label || `${state.targets.length}件の選択項目` }
        : { path: state.path, recursive: state.recursive };
      const result = await window.MeldexGlobalTags.autoTag({
        ...targetPayload,
        source_folder: atSourceFolderForPath(state.path),
        ai_id: state.aiSelect.value,
        model_id: state.modelSelect.value,
        preset_names: presetNames,
      });
      if (result?.background) {
        atStatus('自動タグ付けをバックグラウンドで開始しました');
      } else if (result?.stopped || result?.ok === false) {
        atStatus('自動タグ付けを中断しました: ' + (result.warning || result.reason || ''), true);
      } else {
        atStatus(`${result?.total || 0}件に自動タグ付けしました`);
        if (typeof hydrateGlobalTagTargetEditors === 'function') hydrateGlobalTagTargetEditors(document.getElementById('rp-detail') || document);
      }
    } catch (error) {
      atStatus('自動タグ付けに失敗しました: ' + (error?.userMessage || error?.message || error), true);
    } finally {
      state.runButton.innerHTML = oldText;
      atUpdateRunReadiness(state);
    }
  }

  async function renderAutoTagRunPanel(host, path, options) {
    const targets = atNormalizeRunTargets(path, options);
    const firstTarget = targets[0] || { path: '', recursive: false };
    if (!host || !firstTarget.path || host.dataset.atRunLoading === '1') return;
    if (!isAutoTagRuntimeAvailable()) {
      host.hidden = true;
      host.replaceChildren();
      return;
    }
    host.hidden = false;
    host.dataset.atRunLoading = '1';
    host.classList.add('at-run-panel');
    host.innerHTML = '<div class="at-loading">自動タグ付けを準備しています…</div>';
    try {
      const bundle = await atLoadBundle(firstTarget.path);
      host.innerHTML = `
        <div class="at-run-head">
          <div><strong>${atIcon('sparkles', 14)} 自動タグ付け</strong><small>この実行だけのAI・モデルを選べます</small></div>
          <button type="button" class="gb-btn gb-btn-xs gb-btn-quiet" data-e2e-id="tag-auto-run-dictionary" data-at-run-dictionary>${atIcon('tableProperties', 12)} タグ辞書</button>
        </div>
        <label><span>AI ${atFieldHelp('CLI AIは少数画像向けです。数百件以上では、処理時間が大幅に長くなるためローカル画像AIを推奨します。')}</span><select class="gb-input" data-e2e-id="tag-auto-run-ai" data-at-run-ai>
          <option value="auto">自動選択</option><option value="local-wd">ローカル画像AI</option><option value="cli">CLI AI</option>
        </select></label>
        <label><span>モデル</span><select class="gb-input" data-e2e-id="tag-auto-run-model" data-at-run-model></select></label>
        <details class="at-run-presets" open>
          <summary>自動タグプリセット（複数選択可）</summary>
          <div class="at-preset-options" role="group" aria-label="今回使う自動タグプリセット">
            ${atPresetOptionsHtml(bundle.dictionary, atSelectedPresetNames(bundle.settings, bundle.dictionary), 'at-run-preset')
              .replaceAll('data-at-preset=', 'data-at-run-preset=')}
          </div>
        </details>
        <div class="at-run-footer"><span class="at-run-ready"></span><button type="button" class="gb-btn gb-btn-primary gb-btn-sm" data-e2e-id="tag-auto-run-execute" data-at-run>${atIcon('sparkles', 14)} 実行</button></div>
      `;
      const state = {
        host,
        path: firstTarget.path,
        recursive: firstTarget.recursive,
        targets,
        label: String(options?.label || ''),
        settings: bundle.settings,
        dictionary: bundle.dictionary,
        models: bundle.models,
        aiSelect: host.querySelector('[data-at-run-ai]'),
        modelSelect: host.querySelector('[data-at-run-model]'),
        readiness: host.querySelector('.at-run-ready'),
        runButton: host.querySelector('[data-at-run]'),
      };
      state.aiSelect.value = bundle.settings.ai_id || 'auto';
      atRunModelOptions(state);
      state.aiSelect.addEventListener('change', () => atRunModelOptions(state));
      state.modelSelect.addEventListener('change', () => atUpdateRunReadiness(state));
      host.querySelectorAll('[data-at-run-preset]').forEach(input => {
        input.addEventListener('change', () => atUpdateRunReadiness(state));
      });
      state.runButton.addEventListener('click', () => atRunFromPanel(state));
      host.querySelector('[data-at-run-dictionary]')?.addEventListener('click', () => (
        ensureAutoTagDictionarySheet(state.path, atSourceFolderForPath(state.path))
      ));
      runPanelState.set(host, state);
    } catch (error) {
      host.innerHTML = `<div class="at-error">自動タグ付けを準備できませんでした。${atEsc(error?.userMessage || error?.message || error)}</div>`;
    } finally {
      delete host.dataset.atRunLoading;
    }
  }

  function hydrateAutoTagRunPanels(root) {
    const scope = root?.querySelectorAll ? root : document;
    scope.querySelectorAll('[data-auto-tag-run-path]').forEach(host => {
      renderAutoTagRunPanel(host, host.dataset.autoTagRunPath, {
        recursive: host.dataset.autoTagRunRecursive === '1',
      });
    });
  }

  window.renderAutoTagSettings = renderAutoTagSettings;
  window.isAutoTagRuntimeAvailable = isAutoTagRuntimeAvailable;
  window.isTagDictionaryEditingAvailable = isTagDictionaryEditingAvailable;
  window.isTagDictionarySheetOpenAvailable = isTagDictionarySheetOpenAvailable;
  window.saveAutoTagSettingsFromSettingsDialog = saveAutoTagSettingsFromSettingsDialog;
  window.ensureAutoTagDictionarySheet = ensureAutoTagDictionarySheet;
  window.importAutoTagDictionaryCsv = importAutoTagDictionaryCsv;
  window.exportAutoTagDictionaryCsv = exportAutoTagDictionaryCsv;
  window.invalidateAutoTagBundleCache = invalidateAutoTagBundleCache;
  window.renderAutoTagRunPanel = renderAutoTagRunPanel;
  window.hydrateAutoTagRunPanels = hydrateAutoTagRunPanels;
  window.MeldexAutoTagSourceFolder = atSourceFolderForPath;
})();
