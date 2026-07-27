/* gb-settings.part04.js */
  if (typeof saveAutoTagSettingsFromSettingsDialog === 'function') {
    const autoTagSaveOk = await saveAutoTagSettingsFromSettingsDialog(settingsOverlay, { silent: true });
    if (autoTagSaveOk === false) return;
  }

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
      await _removeOldTeamNameFromAllRoots(oldUsername);
    }
    const avatar = localStorage.getItem('meldex-avatar') || '';
    if (window.MeldexDropboxProfileSync?.afterLocalProfileChanged) {
      await window.MeldexDropboxProfileSync.afterLocalProfileChanged({ displayName: username, avatar });
    } else {
      await apiPost('/team/sync', { name: username, avatar }).catch(() => {});
    }
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

  const localLlmBaseUrl = document.getElementById('modal-local-llm-base-url')?.value?.trim() || '';
  if (localLlmBaseUrl) localStorage.setItem('chat-local-llm-base-url', localLlmBaseUrl);
  else localStorage.removeItem('chat-local-llm-base-url');
  const localLlmModel = document.getElementById('modal-local-llm-model')?.value?.trim() || '';
  if (localLlmModel) {
    localStorage.setItem('chat-local-llm-model', localLlmModel);
    localStorage.setItem('chat-model:local_llm', localLlmModel);
  } else {
    localStorage.removeItem('chat-local-llm-model');
  }
  const localLlmMcpEnabled = document.getElementById('modal-local-llm-mcp-enabled');
  if (localLlmMcpEnabled) localStorage.setItem('chat-local-llm-mcp-enabled', localLlmMcpEnabled.checked ? '1' : '0');
  if (typeof loadProviderModels === 'function') {
    loadProviderModels('local_llm', { force: true }).catch(() => {});
  }
  if (typeof _chatRefreshApiKeyState === 'function') _chatRefreshApiKeyState().catch(() => {});

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

    await _syncSettingsVaultPathFromOutlinerRoots(_outlinerRoots);

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

// 名前変更時、既定フォルダだけでなく可視の全ソースフォルダのチームファイルからも
// 旧名エントリを削除する（複数ソースフォルダ運用で、フォルダごとに残る
// 旧名ゴーストエントリを防ぐ）。1件の失敗でループ全体を止めない。
async function _removeOldTeamNameFromAllRoots(oldUsername) {
  await apiPost('/team/remove', { name: oldUsername }).catch((e) => {
    console.warn('[settings] /team/remove failed (default folder)', e);
  });
  let roots = [];
  try {
    roots = await apiFetch('/outliner-roots');
  } catch (e) {
    console.warn('[settings] /outliner-roots fetch failed while cleaning up old team name', e);
    return;
  }
  const visibleRoots = (Array.isArray(roots) ? roots : []).filter(r => r?.visible && r?.path);
  for (const root of visibleRoots) {
    try {
      await apiPost('/team/remove', { name: oldUsername, folder: root.path });
    } catch (e) {
      console.warn('[settings] /team/remove failed for root', root.path, e);
    }
  }
}

function _isSettingsLocalVaultPath(path) {
  const value = String(path || '').trim();
  if (!value || value === '.') return false;
  if (/^__[^/\\]+__/.test(value)) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  if (/^\\\\[^\\]/.test(value)) return true;
  if (value.startsWith('/')) return true;
  return false;
}

async function _syncSettingsVaultPathFromOutlinerRoots(roots) {
  const localVisible = Array.isArray(roots)
    ? roots.find(root => root && root.visible && _isSettingsLocalVaultPath(root.path))
    : null;
  const nextPath = localVisible ? String(localVisible.path || '').trim() : '';
  const currentVaultPath = (typeof state !== 'undefined' ? state.vaultPath : '') || '';
  if (nextPath === currentVaultPath) return true;
  await apiPut('/vault', { path: nextPath });
  if (typeof state !== 'undefined') state.vaultPath = nextPath;
  return true;
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
  // モデル世代交代時はここ（既定値とcodexの代表候補）を更新して新バージョンとしてリリースする。
  const defaultModels = {
    codex: 'CLI既定（推奨）',
    claude_code: 'Claude Code',
    gemini_cli: 'Gemini CLI',
  };
  // モデル入力欄のdatalist代表候補。自由入力も引き続き可能。
  const modelCandidates = {
    codex: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
    claude_code: ['sonnet', 'opus', 'haiku'],
    gemini_cli: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  };
  const modelTitles = {
    codex: 'CLIへ渡すモデル名（空欄はCLI自身の既定モデルを使います）',
    claude_code: 'CLIへ渡すモデル名（例: sonnet / opus / haiku。空欄はCLI側の既定モデルを使います）',
    gemini_cli: 'CLIへ渡すモデル名（空欄はCLI側の既定モデルを使います）',
  };
  return order.map(key => {
    const item = providers[key] || {};
    const label = item.label || labels[key] || key;
    const command = item.command || (key === 'claude_code' ? 'claude' : key === 'gemini_cli' ? 'gemini' : 'codex');
    const placeholderModel = defaultModels[key] || label;
    const rawModel = String(item.model || '').trim();
    // valueは実設定値のみ（未設定・プレースホルダ既定ラベルと同じ場合は空欄）にし、
    // ラベルはplaceholder属性へ回す。value側にも既定ラベルを入れてしまうと、datalistの
    // 絞り込み候補がその文字列でフィルタされ、他候補がほぼ見えなくなる不具合があった。
    const modelValue = (!rawModel || rawModel === placeholderModel) ? '' : rawModel;
    const available = item.available !== false;
    const compatible = item.compatible !== false;
    const statusText = !available
      ? '未検出'
      : !compatible
        ? '更新必要'
        : item.version
          ? `v${item.version}`
          : '検出済み';
    const statusColor = available && compatible ? 'var(--accent)' : 'var(--red)';
    const compatibilityMessage = String(item.compatibility_message || '').trim();
    const datalistId = `settings-cli-chat-${_settingsCliEsc(key)}-model-list`;
    const datalistOptions = (modelCandidates[key] || []).map(value => `<option value="${_settingsCliEsc(value)}"></option>`).join('');
    return `
      <div class="settings-cli-chat-row" data-provider="${_settingsCliEsc(key)}" style="display:grid;grid-template-columns:minmax(105px,.9fr) minmax(110px,1fr) minmax(110px,1fr) 72px;gap:8px;align-items:center;margin-top:8px;">
        <label class="gb-check" style="min-width:0;">
          <input type="checkbox" data-e2e-id="settings-cli-chat-${_settingsCliEsc(key)}-enabled" data-cli-chat-field="enabled" ${item.enabled === false ? '' : 'checked'}>
          <span>${_settingsCliEsc(label)}</span>
        </label>
        <input class="gb-input" data-e2e-id="settings-cli-chat-${_settingsCliEsc(key)}-command" data-cli-chat-field="command" value="${_settingsCliEsc(command)}" placeholder="${_settingsCliEsc(command)}">
        <input class="gb-input" list="${datalistId}" data-e2e-id="settings-cli-chat-${_settingsCliEsc(key)}-model" data-cli-chat-field="model" value="${_settingsCliEsc(modelValue)}" placeholder="${_settingsCliEsc(placeholderModel)}" title="${_settingsCliEsc(modelTitles[key] || 'CLIへ渡すモデル名')}">
        <datalist id="${datalistId}">${datalistOptions}</datalist>
        <span style="font-size:11px;color:${statusColor};white-space:nowrap;">${_settingsCliEsc(statusText)}</span>
        ${compatibilityMessage ? `<div class="gb-section-desc" style="grid-column:1/-1;color:${compatible ? 'var(--fg2)' : 'var(--red)'};">${_settingsCliEsc(compatibilityMessage)}</div>` : ''}
      </div>`;
  }).join('');
}

function _renderCliChatSettingsContainer(container, config) {
  if (!container) return;
  container.innerHTML = `
    <div class="gb-check-help-row" style="margin-top:4px;">
      <label class="gb-check">
        <input id="settings-cli-chat-enabled" type="checkbox" ${config?.enabled === false ? '' : 'checked'}>
        <span>CLIチャットを有効にする</span>
      </label>
      ${fieldHelp('コマンド名は、ターミナルで実行する名前と同じにしてください。例: codex / claude / gemini')}
    </div>
    <div style="margin-top:4px;">${_settingsCliProviderRows(config)}</div>
    <div class="btn-row" style="justify-content:flex-start;gap:8px;margin-top:10px;flex-wrap:wrap;">
      <button type="button" class="gb-btn gb-btn-sm" id="settings-cli-chat-refresh">${_settingsCliIcon('refreshCw',14)} 状態を更新</button>
      <button type="button" class="gb-btn gb-btn-sm" id="settings-cli-chat-save">${_settingsCliIcon('save',14)} CLIチャット設定を保存</button>
    </div>
    <div id="settings-cli-chat-status" class="gb-section-desc" style="margin-top:6px;"></div>
    <div id="settings-workspace-cli-relay-container"></div>
  `;
  container.querySelector('#settings-cli-chat-refresh')?.addEventListener('click', () => renderCliChatSettingsForSettings(container.closest('.modal-overlay') || document));
  container.querySelector('#settings-cli-chat-save')?.addEventListener('click', () => saveCliChatSettingsFromSettingsDialog(container.closest('.modal-overlay') || document));
  if (typeof renderWorkspaceCliRelaySettingsForSettings === 'function') {
    renderWorkspaceCliRelaySettingsForSettings(container.closest('.modal-overlay') || document);
  }
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
    const model = row.querySelector('[data-cli-chat-field="model"]')?.value?.trim() || '';
    providers[key] = { enabled, command, model };
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
    if (typeof saveWorkspaceCliRelaySettingsFromSettingsDialog === 'function') {
      const relayOk = await saveWorkspaceCliRelaySettingsFromSettingsDialog(container.closest('.modal-overlay') || document, { silent: true, skipReload: true });
      if (relayOk === false) return false;
    }
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
  let partial = false;
  let partialFailed = 0;
  try {
    const data = await apiFetch('/trash');
    items = Array.isArray(data?.items) ? data.items : [];
    const warnings = Array.isArray(data?.warnings) ? data.warnings : [];
    const reportedFailed = Number(data?.failed);
    const safeReportedFailed = Number.isFinite(reportedFailed) ? Math.max(0, Math.floor(reportedFailed)) : 0;
    partial = data?.partial === true || warnings.length > 0 || safeReportedFailed > 0;
    partialFailed = partial ? Math.min(9999, Math.max(1, warnings.length, safeReportedFailed)) : 0;
  } catch (e) {
    loadError = e;
    if (typeof showStatus === 'function') showStatus('ゴミ箱の読み込みに失敗しました', true);
  }

  function renderList() {
    if (loadError) {
      return `<div style="padding:16px;color:var(--red);text-align:center;">ゴミ箱の読み込みに失敗しました: ${esc(loadError.message || loadError)}</div>`;
    }
    const partialMessage = items.length
      ? `一部の保存元を読み込めませんでした（失敗 ${partialFailed}件）。表示中の項目は操作できます。通信状態とDropboxのアクセス権を確認し、少し待ってからゴミ箱を開き直してください。`
      : `保存元を読み込めなかったため、ゴミ箱が空かどうか確認できませんでした（失敗 ${partialFailed}件）。通信状態とDropboxのアクセス権を確認し、少し待ってからゴミ箱を開き直してください。`;
    const partialHtml = partial
      ? `<div role="alert" style="padding:10px 12px;color:var(--orange);background:color-mix(in srgb,var(--orange) 10%,var(--bg2));border-bottom:1px solid var(--border);line-height:1.5;">${esc(partialMessage)}</div>`
      : '';
    if (items.length === 0) {
      return partialHtml || '<div style="padding:16px;color:var(--fg2);text-align:center;">ゴミ箱は空です</div>';
    }
    let html = partialHtml;
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
          <button data-action="trashRestore" data-args='${esc(JSON.stringify([i]))}' style="font-size:11px;padding:1px 6px;background:var(--bg3);color:var(--accent);border:1px solid var(--border);border-radius:3px;cursor:pointer;">復元</button>
          <button data-action="trashDelete" data-args='${esc(JSON.stringify([i]))}' style="font-size:11px;padding:1px 6px;background:var(--bg3);color:var(--red);border:1px solid var(--border);border-radius:3px;cursor:pointer;">削除</button>
        </div>`;
    });
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
        <div class="gb-section-desc">Dropbox側で削除するとMeldexから復元できません。 ${fieldHelp('Dropbox内のソースフォルダを使う場合、ゴミ箱の中身も同期対象です。')}</div>
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
      const ok = typeof cfConfirm === 'function'
        ? await cfConfirm('期限切れのゴミ箱項目を削除しますか？この操作は元に戻せません。')
        : confirm('期限切れのゴミ箱項目を削除しますか？この操作は元に戻せません。');
      if (!ok) return;
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
        <label class="gb-field-row"><span class="gb-label">操作履歴</span><input id="settings-db-audit-ttl" type="number" min="0" class="gb-input" style="width:90px;" value="${Number(settings.db_audit_log_ttl_days ?? 90)}"><span class="gb-section-desc">日（0で無期限）</span></label>
        <div class="gb-field-row"><span class="gb-label">カレンダーログ</span><span class="gb-section-desc">削除しない</span></div>
        <div class="gb-field-row"><span class="gb-label">LLM利用ログ</span><span class="gb-section-desc">削除しない</span></div>
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
        calendar_log_ttl_days: 0,
        chat_usage_log_ttl_days: 0,
      });
      statusEl.textContent = '保持期間を保存しました';
    });
    container.querySelector('#settings-db-backup')?.addEventListener('click', async () => {
      const res = await apiPost('/data-protection/db-backup', {});
      statusEl.textContent = res.ok ? 'バックアップを作成しました: ' + res.path : 'バックアップはスキップされました';
    });
    container.querySelector('#settings-db-cleanup')?.addEventListener('click', async () => {
      const ok = typeof cfConfirm === 'function'
        ? await cfConfirm('保持期間を過ぎたデータベースログを削除しますか？この操作は元に戻せません。')
        : confirm('保持期間を過ぎたデータベースログを削除しますか？この操作は元に戻せません。');
      if (!ok) return;
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
  const scope = root?.querySelector ? root : document;
  if (scope?.matches?.('#chat-cost-settings-container')) return scope;
  return scope.querySelector('#chat-cost-settings-container');
}

function _chatCostNumber(container, id, fallback) {
  const value = String(container?.querySelector?.('#' + id)?.value ?? '').trim();
  if (!value) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function _chatCostFallbackStatus() {
  return {
    settings: { ...CHAT_COST_DEFAULTS, pricing_last_reviewed: '' },
    totals: { day: { cost_usd: 0 }, month: { cost_usd: 0 } },
  };
}

async function _chatCostLoadBudgetStatus(timeoutMs = 4500) {
  if (typeof apiFetch !== 'function') return _chatCostFallbackStatus();
  let timer = 0;
  const timeout = new Promise((resolve) => {
    timer = window.setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const status = await Promise.race([apiFetch('/chat/budget'), timeout]);
    return status && typeof status === 'object' ? status : _chatCostFallbackStatus();
  } catch (_err) {
    return _chatCostFallbackStatus();
  } finally {
    if (timer) window.clearTimeout(timer);
  }
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
    const status = await _chatCostLoadBudgetStatus();
    const settings = status.settings || {};
    const totals = status.totals || {};
    const modeOptions = value => ['hard', 'warn', 'off'].map(mode => {
      const label = mode === 'hard' ? 'ハード停止' : mode === 'warn' ? '警告のみ' : '無効';
      return `<option value="${mode}" ${String(value || 'hard') === mode ? 'selected' : ''}>${label}</option>`;
    }).join('');
    container.innerHTML = `
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('gauge',14)} AI API使用量 ${fieldHelp('Meldex本体の課金ではありません。登録したAI APIキーで各社APIを使った場合の推定使用量です。')}</div>
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
          <button type="button" class="gb-btn gb-btn-sm" id="chat-budget-save">${lucide('save',14)} 保存</button>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-danger" id="chat-budget-reset">${lucide('rotateCcw',14)} 使用量履歴をリセット</button>
        </div>
        <div id="chat-budget-status" class="gb-section-desc"></div>
      </section>`;
    const statusEl = container.querySelector('#chat-budget-status');
    container.querySelector('#chat-budget-save')?.addEventListener('click', () => saveChatCostSettingsFromSettingsDialog(container, { silent: false }));
    container.querySelector('#chat-budget-reset')?.addEventListener('click', async () => {
      const ok = typeof cfConfirm === 'function' ? await cfConfirm('LLM使用量履歴をリセットしますか？', { danger: true, okLabel: 'リセット' }) : confirm('LLM使用量履歴をリセットしますか？');
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
  'meldex-a11y-high-contrast', 'meldex-a11y-reduced-motion', 'meldex-a11y-colorblind-safe', 'meldex-a11y-browser-warning-dismissed',
  'meldex-avatar', 'meldex-avatar-spec', 'meldex-avatar-bg',
  'note-vertical', 'note-heading-indent', 'note-toc-visible',
  // カレンダー / チャット
  'gb-cal-start-day', 'gb:clock-enabled', 'gb:outliner-filter-shared', 'chat-provider', 'chat-model', 'chat-allow-web-search', 'chat-auto-compress', 'chat-allow-code-execution', 'chat-recommendations-enabled', 'chat-reasoning-level', 'chat-param-preset', 'chat-temperature', 'chat-max-tokens', 'chat-top-p', 'chat-custom-about', 'chat-custom-instructions', 'chat-local-llm-base-url', 'chat-local-llm-model', 'chat-local-llm-mcp-enabled', 'meldex-wheel-speed',
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
  'dbViewConfig:', 'validationRules:', 'entityTemplates:', 'chat-model:', 'chat-models:', 'chat-custom-about:', 'chat-custom-instructions:',
];
const _SETTINGS_PROFILE_KEYS = ['meldex-user', 'meldex-avatar', 'meldex-avatar-spec', 'meldex-avatar-bg'];

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
  if (keys.some(key => _SETTINGS_PROFILE_KEYS.includes(key))) {
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
