/* Auto-tag settings, model selection, dictionary Sheet, and run panel */
(function () {
  'use strict';

  const settingsState = new WeakMap();
  const runPanelState = new WeakMap();

  function atEsc(value) {
    if (typeof esc === 'function') return esc(String(value ?? ''));
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
  }

  function atIcon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 14) : '';
  }

  function atStatus(message, error) {
    if (typeof showStatus === 'function') showStatus(message, !!error);
  }

  function isAutoTagRuntimeAvailable() {
    const dropboxMode = window.MeldexRuntimeAdapter?.isDropboxMode?.()
      || document.body?.dataset?.cloudMode === 'dropbox';
    const serverMode = window.MeldexRuntimeAdapter?.isServerMode?.()
      || document.body?.dataset?.cloudMode === 'server';
    return !dropboxMode || !!serverMode;
  }

  function atRenderCloudUnavailable(host) {
    host.innerHTML = `
      <section class="at-cloud-unavailable" aria-labelledby="at-cloud-unavailable-title">
        <div class="at-cloud-unavailable-icon">${atIcon('monitor-down', 22)}</div>
        <div>
          <h3 id="at-cloud-unavailable-title">自動タグ付けはデスクトップ版で設定します</h3>
          <p>端末内の画像AIまたはログイン済みCLIを使うため、モデルの取得・辞書の準備・実行はデスクトップ版で行ってください。</p>
          <p class="at-cloud-unavailable-note">Cloud版では、付いているタグの確認と手動編集をそのまま利用できます。</p>
        </div>
      </section>
    `;
  }

  async function atLoadBundle() {
    const [settingsResult, modelsResult, dictionaryResult] = await Promise.all([
      apiFetch('/auto-tag/settings', { silentError: true }),
      apiFetch('/auto-tag/models', { silentError: true }),
      apiFetch('/auto-tag/dictionary', { silentError: true }),
    ]);
    return {
      settings: settingsResult?.settings || {},
      models: Array.isArray(modelsResult?.models) ? modelsResult.models : [],
      dictionary: dictionaryResult || { tags: [], groups: [], db_path: '' },
    };
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
    const installButton = model.local && !model.installed
      ? `<button type="button" class="gb-btn gb-btn-sm" data-at-install="${atEsc(model.id)}">${atIcon('download', 14)} モデルを入手</button>`
      : '';
    const guideLink = model.model_url
      ? `<button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-at-guide="${atEsc(model.model_url)}">${atIcon('externalLink', 14)} 公式配布元</button>`
      : '';
    return `
      <div class="at-detail-head">
        <div>
          <div class="at-detail-name">${atEsc(model.name)}</div>
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
        <div class="at-field-label">画像の判定方法</div>
        <div class="at-segments" role="group" aria-label="画像の判定方法">${atAiButtons(state)}</div>
        <p class="at-help">自動選択は端末内モデルを優先し、利用できない場合だけ設定済みCLIを使います。従量課金APIへは切り替えません。</p>
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
          <p>正式名、別名、ホワイトリスト、タググループと階層をMeldexのシートで管理します。</p>
          <div class="at-dictionary-counts">
            <span>タグ <strong>${Number(dictionary.tags?.length || 0).toLocaleString('ja-JP')}</strong></span>
            <span>グループ <strong>${Number(dictionary.groups?.length || 0).toLocaleString('ja-JP')}</strong></span>
            <span>自動付与 <strong>${Number((dictionary.tags || []).filter(tag => tag.auto_assign).length).toLocaleString('ja-JP')}</strong></span>
          </div>
          <div class="at-dictionary-actions">
            <button type="button" class="gb-btn gb-btn-sm" data-at-open-dictionary>${atIcon('externalLink', 14)} シートを開く</button>
            <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-at-import>${atIcon('upload', 14)} CSVを取り込む</button>
            <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-at-export>${atIcon('download', 14)} CSVを書き出す</button>
          </div>
          <input type="file" accept=".csv,text/csv" data-at-csv-input hidden>
          <p class="at-help">Eagleの group,color,tag 形式とMeldex拡張形式を読み込めます。</p>
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
    const saveState = host.querySelector('[data-at-save-state]');
    if (saveState) saveState.textContent = '保存しました';
    if (!options?.silent) atStatus('自動タグ付け設定を保存しました');
    return true;
  }

  async function atInstallModel(host, state, modelId, button) {
    button.disabled = true;
    button.textContent = '取得しています…';
    atStatus('公式配布元からモデルを取得しています。完了まで画面を閉じずにお待ちください');
    try {
      await apiPost('/auto-tag/models/' + encodeURIComponent(modelId) + '/install', {}, { silentError: true, timeoutMs: 300000 });
      const refreshed = await atLoadBundle();
      Object.assign(state, refreshed);
      atRenderSettingsBody(host, state);
      atStatus('モデルをインストールしました');
    } catch (error) {
      button.disabled = false;
      button.textContent = 'モデルを入手';
      atStatus('モデルを取得できませんでした: ' + (error?.userMessage || error?.message || error), true);
    }
  }

  function atDownloadDictionaryCsv(dictionary) {
    const rows = [['kind', 'name', 'parent', 'aliases', 'color', 'auto_assign', 'description', 'sort_index']];
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
    groups.forEach(group => rows.push(['group', group.name, pathFor(group.parent_id), '', group.color || '', '', group.description || '', group.sort_index || 0]));
    (dictionary.tags || []).forEach(tag => rows.push([
      'tag', tag.name, pathFor(tag.group_id), (tag.aliases || []).join('\n'), tag.color || '',
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

  async function atImportDictionaryCsv(host, state, file) {
    const csvText = await file.text();
    const result = await apiPost('/auto-tag/dictionary/import', { csv_text: csvText }, { silentError: true });
    state.dictionary = await apiFetch('/auto-tag/dictionary', { silentError: true });
    atRenderSettingsBody(host, state);
    atStatus(`${result?.imported || 0}件を自動タグ辞書へ取り込みました`);
    window.MeldexGlobalTags?.invalidateTagsCatalogCache?.();
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
      button.addEventListener('click', () => atInstallModel(host, state, button.dataset.atInstall, button));
    });
    host.querySelectorAll('[data-at-guide]').forEach(button => {
      button.addEventListener('click', () => {
        if (typeof openExternalBrowserUrl === 'function') openExternalBrowserUrl(button.dataset.atGuide);
      });
    });
    host.querySelector('[data-at-open-dictionary]')?.addEventListener('click', () => ensureAutoTagDictionarySheet());
    host.querySelector('[data-at-import]')?.addEventListener('click', () => host.querySelector('[data-at-csv-input]')?.click());
    host.querySelector('[data-at-export]')?.addEventListener('click', () => atDownloadDictionaryCsv(state.dictionary));
    host.querySelector('[data-at-csv-input]')?.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (!file) return;
      atImportDictionaryCsv(host, state, file).catch(error => atStatus('CSVを取り込めませんでした: ' + (error?.userMessage || error?.message || error), true));
      event.target.value = '';
    });
  }

  async function renderAutoTagSettings(root) {
    const scope = root?.querySelector ? root : document;
    const host = scope.querySelector('#auto-tag-settings-container') || document.querySelector('#auto-tag-settings-container');
    if (!host || host.dataset.atLoading === '1') return;
    if (!isAutoTagRuntimeAvailable()) {
      settingsState.delete(host);
      atRenderCloudUnavailable(host);
      return;
    }
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

  async function ensureAutoTagDictionarySheet() {
    if (!isAutoTagRuntimeAvailable()) {
      atStatus('自動タグ辞書の準備と編集はデスクトップ版で行ってください', true);
      return '';
    }
    const result = await apiPost('/auto-tag/dictionary/ensure', {}, { silentError: true });
    const dbPath = String(result?.db_path || '').trim();
    if (!dbPath) throw new Error('自動タグ辞書シートの場所を取得できませんでした');
    document.querySelector('.modal-overlay[data-settings-modal="1"]')?.remove();
    if (typeof refreshOutliner === 'function') refreshOutliner();
    if (typeof selectDatabase === 'function') await selectDatabase(dbPath, undefined, { silent: true });
    atStatus('自動タグ辞書シートを開きました');
    return dbPath;
  }

  async function importAutoTagDictionaryCsv() {
    if (!isAutoTagRuntimeAvailable()) {
      atStatus('自動タグ辞書のCSV取込はデスクトップ版で行ってください', true);
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
        const result = await apiPost('/auto-tag/dictionary/import', { csv_text: await file.text() }, { silentError: true });
        window.MeldexGlobalTags?.invalidateTagsCatalogCache?.();
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

  async function exportAutoTagDictionaryCsv() {
    if (!isAutoTagRuntimeAvailable()) {
      atStatus('自動タグ辞書のCSV書出はデスクトップ版で行ってください', true);
      return false;
    }
    const dictionary = await apiFetch('/auto-tag/dictionary', { silentError: true });
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
    const ready = atReadyLabel(model);
    state.readiness.className = 'at-run-ready at-ready--' + ready.kind;
    state.readiness.textContent = ready.text;
    state.runButton.disabled = !!model?.local && !model.ready && state.aiSelect.value !== 'auto';
  }

  async function atRunFromPanel(state) {
    state.runButton.disabled = true;
    const oldText = state.runButton.innerHTML;
    state.runButton.textContent = '実行中…';
    try {
      const result = await window.MeldexGlobalTags.autoTag({
        path: state.path,
        recursive: state.recursive,
        ai_id: state.aiSelect.value,
        model_id: state.modelSelect.value,
      });
      if (result?.stopped || result?.ok === false) {
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
    if (!host || !path || host.dataset.atRunLoading === '1') return;
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
      const bundle = await atLoadBundle();
      host.innerHTML = `
        <div class="at-run-head">
          <div><strong>${atIcon('sparkles', 14)} 自動タグ付け</strong><small>この実行だけのAI・モデルを選べます</small></div>
          <button type="button" class="gb-btn gb-btn-xs gb-btn-quiet" data-at-run-dictionary>${atIcon('tableProperties', 12)} タグ辞書</button>
        </div>
        <label><span>AI</span><select class="gb-input" data-at-run-ai>
          <option value="auto">自動選択</option><option value="local-wd">ローカル画像AI</option><option value="cli">CLI AI</option>
        </select></label>
        <label><span>モデル</span><select class="gb-input" data-at-run-model></select></label>
        <div class="at-run-footer"><span class="at-run-ready"></span><button type="button" class="gb-btn gb-btn-primary gb-btn-sm" data-at-run>${atIcon('sparkles', 14)} 実行</button></div>
      `;
      const state = {
        host,
        path,
        recursive: !!options?.recursive,
        settings: bundle.settings,
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
      state.runButton.addEventListener('click', () => atRunFromPanel(state));
      host.querySelector('[data-at-run-dictionary]')?.addEventListener('click', () => ensureAutoTagDictionarySheet());
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
  window.saveAutoTagSettingsFromSettingsDialog = saveAutoTagSettingsFromSettingsDialog;
  window.ensureAutoTagDictionarySheet = ensureAutoTagDictionarySheet;
  window.importAutoTagDictionaryCsv = importAutoTagDictionaryCsv;
  window.exportAutoTagDictionaryCsv = exportAutoTagDictionaryCsv;
  window.renderAutoTagRunPanel = renderAutoTagRunPanel;
  window.hydrateAutoTagRunPanels = hydrateAutoTagRunPanels;
})();
