(function () {
  'use strict';

  const STORAGE_KEY = 'meldex-knowledge-automation-settings-v1';

  function _esc(value) {
    if (typeof esc === 'function') return esc(value);
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function _icon(name, size = 14) {
    return typeof lucide === 'function' ? lucide(name, size) : '';
  }

  function _readRaw() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  function _hasSavedSettings() {
    try { return localStorage.getItem(STORAGE_KEY) !== null; }
    catch { return false; }
  }

  function _defaultProvider() {
    try { return localStorage.getItem('chat-provider') || 'anthropic'; }
    catch { return 'anthropic'; }
  }

  function _normalizeSettings(raw) {
    const sourceTargets = Array.isArray(raw?.targets?.sources) ? raw.targets.sources : [];
    return {
      version: 1,
      enabled: Object.prototype.hasOwnProperty.call(raw || {}, 'enabled') ? raw.enabled === true : true,
      provider: String(raw?.provider || _defaultProvider()),
      model: String(raw?.model || ''),
      trigger: String(raw?.trigger || 'after_chat'),
      writePolicy: String(raw?.writePolicy || 'admin_auto'),
      targets: {
        home: {
          enabled: raw?.targets?.home?.enabled === true,
          path: String(raw?.targets?.home?.path || ''),
        },
        sources: sourceTargets.map(item => ({
          enabled: item?.enabled === true,
          name: String(item?.name || ''),
          path: String(item?.path || ''),
        })).filter(item => item.path),
      },
      updatedAt: String(raw?.updatedAt || ''),
    };
  }

  function loadKnowledgeAutomationSettings() {
    return _normalizeSettings(_readRaw());
  }

  function saveKnowledgeAutomationSettings(settings) {
    const normalized = _normalizeSettings(settings);
    normalized.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  async function _loadTargetFolders() {
    const [homeRes, sourceRoots] = await Promise.all([
      typeof apiFetch === 'function' ? apiFetch('/home-folder').catch(() => null) : Promise.resolve(null),
      typeof apiFetch === 'function' ? apiFetch('/outliner-roots').catch(() => []) : Promise.resolve([]),
    ]);
    const homePath = String(homeRes?.path || (typeof _homeFolderPath !== 'undefined' ? _homeFolderPath : '') || '');
    const sources = (Array.isArray(sourceRoots) ? sourceRoots : [])
      .map((root, index) => ({
        type: 'source',
        index,
        name: String(root?.name || `ソースフォルダ ${index + 1}`),
        path: String(root?.path || ''),
        visible: root?.visible !== false,
      }))
      .filter(root => root.path);
    return { homePath, sources };
  }

  function _sourceEnabled(settings, path) {
    if (!_hasSavedSettings()) return true;
    return settings.targets.sources.some(item => item.path === path && item.enabled);
  }

  function _renderTargetRows(container, settings, folders) {
    const rows = [];
    if (folders.homePath) {
      rows.push(`
        <label class="gb-check knowledge-auto-target-row">
          <input type="checkbox" id="knowledge-auto-target-home" data-setting="knowledge-auto-target-home" data-knowledge-auto-target="home" data-path="${_esc(folders.homePath)}" ${(!_hasSavedSettings() || settings.targets.home.enabled) ? 'checked' : ''}>
          <span style="min-width:88px;">ホームフォルダ</span>
          <span class="gb-section-desc" title="${_esc(folders.homePath)}">${_esc(folders.homePath)}</span>
        </label>
      `);
    } else {
      rows.push('<div class="gb-section-desc">ホームフォルダが未設定です。</div>');
    }
    if (folders.sources.length) {
      folders.sources.forEach((source, index) => {
        rows.push(`
          <label class="gb-check knowledge-auto-target-row">
            <input type="checkbox" id="knowledge-auto-target-source-${index}" data-setting="knowledge-auto-target-source-${index}" data-knowledge-auto-target="source" data-index="${index}" data-name="${_esc(source.name)}" data-path="${_esc(source.path)}" ${_sourceEnabled(settings, source.path) ? 'checked' : ''}>
            <span style="min-width:88px;">${_esc(source.name)}</span>
            <span class="gb-section-desc" title="${_esc(source.path)}">${_esc(source.path)}${source.visible ? '' : '（非表示）'}</span>
          </label>
        `);
      });
    } else {
      rows.push('<div class="gb-section-desc">ソースフォルダが未設定です。</div>');
    }
    container.innerHTML = rows.join('');
  }

  function _buildPanel(settings) {
    return `
      <label class="gb-check">
        <input type="checkbox" id="knowledge-auto-enabled" data-setting="knowledge-auto-enabled" ${settings.enabled ? 'checked' : ''}>
        <span>自動ナレッジ抽出を有効にする</span>
      </label>
      <label class="gb-field-row">
        <span class="gb-label" style="min-width:140px;">実行LLM</span>
        <select id="knowledge-auto-provider" class="gb-select" data-setting="knowledge-auto-provider" style="width:150px;">
          <option value="anthropic" ${settings.provider === 'anthropic' ? 'selected' : ''}>Claude</option>
          <option value="openai" ${settings.provider === 'openai' ? 'selected' : ''}>GPT</option>
          <option value="gemini" ${settings.provider === 'gemini' ? 'selected' : ''}>Gemini</option>
        </select>
        <input id="knowledge-auto-model" type="text" class="gb-input" data-setting="knowledge-auto-model" style="flex:1;min-width:160px;" value="${_esc(settings.model)}" placeholder="未指定ならチャット設定に従う">
      </label>
      <label class="gb-field-row">
        <span class="gb-label" style="min-width:140px;">実行タイミング</span>
        <select id="knowledge-auto-trigger" class="gb-select" data-setting="knowledge-auto-trigger" style="flex:1;">
          <option value="after_chat" ${settings.trigger === 'after_chat' ? 'selected' : ''}>チャット応答後</option>
          <option value="manual_review" ${settings.trigger === 'manual_review' ? 'selected' : ''}>手動レビュー時</option>
          <option value="idle" ${settings.trigger === 'idle' ? 'selected' : ''}>アイドル時</option>
        </select>
      </label>
      <label class="gb-field-row">
        <span class="gb-label" style="min-width:140px;">反映方法</span>
        <select id="knowledge-auto-write-mode" class="gb-select" data-setting="knowledge-auto-write-mode" style="flex:1;">
          <option value="admin_auto" ${settings.writePolicy === 'admin_auto' ? 'selected' : ''}>管理者端末で自動反映</option>
          <option value="admin_approval" ${settings.writePolicy === 'admin_approval' ? 'selected' : ''}>管理者承認後</option>
          <option value="draft_only" ${settings.writePolicy === 'draft_only' ? 'selected' : ''}>候補だけ作成</option>
        </select>
      </label>
      <div class="gb-section-desc">自動抽出の対象を選択します。ソースフォルダごとの指定に加えて、ホームフォルダも対象にできます。</div>
      <div id="knowledge-auto-target-list" style="display:flex;flex-direction:column;gap:4px;margin-top:4px;">
        <div class="gb-section-desc">対象フォルダを読み込み中...</div>
      </div>
      <div class="gb-field-row" style="justify-content:flex-start;margin-top:8px;">
        <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="knowledge-auto-open-view" data-knowledge-auto-open-view>${_icon('folderOpen', 14)} ナレッジフォルダを開く</button>
      </div>
    `;
  }

  async function renderKnowledgeAutomationSettings(root = document) {
    const container = root.querySelector?.('#knowledge-automation-settings-container')
      || document.getElementById('knowledge-automation-settings-container');
    if (!container) return;
    const settings = loadKnowledgeAutomationSettings();
    container.innerHTML = _buildPanel(settings);
    const targetList = container.querySelector('#knowledge-auto-target-list');
    const folders = await _loadTargetFolders();
    if (!container.isConnected || !targetList) return;
    _renderTargetRows(targetList, settings, folders);
    container.querySelector('[data-knowledge-auto-open-view]')?.addEventListener('click', () => {
      if (typeof openKnowledgeHomeView === 'function') openKnowledgeHomeView('items');
    });
    if (typeof replaceIcons === 'function') replaceIcons(container);
  }

  function captureKnowledgeAutomationSettings(root = document) {
    const scope = root.querySelector?.('#knowledge-automation-settings-container')
      || document.getElementById('knowledge-automation-settings-container');
    if (!scope) return loadKnowledgeAutomationSettings();
    const homeInput = scope.querySelector('[data-knowledge-auto-target="home"]');
    const sourceInputs = [...scope.querySelectorAll('[data-knowledge-auto-target="source"]')];
    const previous = loadKnowledgeAutomationSettings();
    return {
      enabled: scope.querySelector('#knowledge-auto-enabled')?.checked === true,
      provider: scope.querySelector('#knowledge-auto-provider')?.value || _defaultProvider(),
      model: scope.querySelector('#knowledge-auto-model')?.value?.trim() || '',
      trigger: scope.querySelector('#knowledge-auto-trigger')?.value || 'after_chat',
      writePolicy: scope.querySelector('#knowledge-auto-write-mode')?.value || 'admin_approval',
      targets: {
        home: {
          enabled: homeInput ? homeInput.checked === true : previous.targets.home.enabled,
          path: homeInput?.dataset?.path || previous.targets.home.path || '',
        },
        sources: sourceInputs.length
          ? sourceInputs.map(input => ({
              enabled: input.checked === true,
              name: input.dataset.name || '',
              path: input.dataset.path || '',
            })).filter(item => item.path)
          : previous.targets.sources,
      },
    };
  }

  function saveKnowledgeAutomationSettingsFromModal(root = document) {
    const scope = root.querySelector?.('#knowledge-automation-settings-container')
      || document.getElementById('knowledge-automation-settings-container');
    if (!scope) return loadKnowledgeAutomationSettings();
    return saveKnowledgeAutomationSettings(captureKnowledgeAutomationSettings(root));
  }

  window.MeldexKnowledgeAutomationSettings = {
    STORAGE_KEY,
    hasSaved: _hasSavedSettings,
    load: loadKnowledgeAutomationSettings,
    save: saveKnowledgeAutomationSettings,
    render: renderKnowledgeAutomationSettings,
    capture: captureKnowledgeAutomationSettings,
    saveFromModal: saveKnowledgeAutomationSettingsFromModal,
  };
  window.renderKnowledgeAutomationSettings = renderKnowledgeAutomationSettings;
  window.saveKnowledgeAutomationSettingsFromModal = saveKnowledgeAutomationSettingsFromModal;
})();
