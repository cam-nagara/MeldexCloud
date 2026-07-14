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
      provider: String(raw?.provider || ''),
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
    if (!_hasSavedSettings() || !settings.targets.sources.length) return true;
    return settings.targets.sources.some(item => item.path === path && item.enabled);
  }

  function _aiExtractionEnabled(settings) {
    return !!String(settings?.provider || '').trim();
  }

  function _selectedProvider(settings) {
    return String(settings?.provider || _defaultProvider() || 'anthropic');
  }

  function _targetHomeChecked(settings) {
    if (!_hasSavedSettings()) return true;
    if (settings.targets.home.enabled) return true;
    return !settings.targets.home.path && !settings.targets.sources.length;
  }

  function _renderTargetRows(container, settings, folders) {
    const rows = [];
    if (folders.homePath) {
      rows.push(`
        <label class="gb-check knowledge-auto-target-row">
          <input type="checkbox" id="knowledge-auto-target-home" data-setting="knowledge-auto-target-home" data-knowledge-auto-target="home" data-path="${_esc(folders.homePath)}" ${_targetHomeChecked(settings) ? 'checked' : ''}>
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
    container.dataset.knowledgeAutoTargetsLoaded = '1';
  }

  function _buildPanel(settings) {
    const aiEnabled = _aiExtractionEnabled(settings);
    const selectedProvider = _selectedProvider(settings);
    return `
      <input type="hidden" id="knowledge-auto-enabled" data-setting="knowledge-auto-enabled" value="1">
      <input type="hidden" id="knowledge-auto-trigger" data-setting="knowledge-auto-trigger" value="after_chat">
      <input type="hidden" id="knowledge-auto-write-mode" data-setting="knowledge-auto-write-mode" value="admin_auto">
      <div class="knowledge-auto-simple-status">
        <div>
          <div class="knowledge-auto-simple-title">${_icon('checkCircle2', 14)} 自動で記憶し、チャットで活用します</div>
          <div class="gb-section-desc">通常は設定不要です。チャットの中で出た決定・好み・ルールは、次の相談や創作提案に自動で使われます。</div>
        </div>
        <span class="gb-pill">常時ON</span>
      </div>
      <label class="gb-check knowledge-auto-ai-toggle">
        <input type="checkbox" id="knowledge-auto-llm-enabled" data-setting="knowledge-auto-llm-enabled" ${aiEnabled ? 'checked' : ''}>
        <span>AIで詳しく抽出する</span>
      </label>
      <div class="gb-section-desc">ONにした場合だけ、チャット内容を選んだAIへ送り、より細かい記憶候補を抽出します。OFFでも端末内の軽い抽出は動きます。</div>
      <div class="knowledge-auto-ai-panel" data-knowledge-auto-ai-panel ${aiEnabled ? '' : 'hidden'}>
        <label class="gb-field-row">
          <span class="gb-label" style="min-width:140px;">使うAI</span>
          <select id="knowledge-auto-provider" class="gb-select" data-setting="knowledge-auto-provider" style="width:150px;">
            <option value="anthropic" ${selectedProvider === 'anthropic' ? 'selected' : ''}>Claude</option>
            <option value="openai" ${selectedProvider === 'openai' ? 'selected' : ''}>GPT</option>
            <option value="gemini" ${selectedProvider === 'gemini' ? 'selected' : ''}>Gemini</option>
          </select>
          <input id="knowledge-auto-model" type="text" class="gb-input" data-setting="knowledge-auto-model" style="flex:1;min-width:160px;" value="${_esc(settings.model)}" placeholder="空欄なら標準モデル">
        </label>
      </div>
      <details class="knowledge-auto-details">
        <summary>${_icon('slidersHorizontal', 14)} 対象フォルダを確認する</summary>
        <div class="gb-section-desc">通常はすべて対象です。特定のフォルダだけ除外したい場合に変更します。</div>
        <div id="knowledge-auto-target-list" style="display:flex;flex-direction:column;gap:4px;margin-top:4px;">
          <div class="gb-section-desc">対象フォルダを読み込み中...</div>
        </div>
      </details>
      <div class="gb-field-row" style="justify-content:flex-start;margin-top:8px;">
        <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="knowledge-auto-open-view" data-knowledge-auto-open-view>${_icon('brain', 14)} 記憶一覧を開く</button>
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
    const aiToggle = container.querySelector('#knowledge-auto-llm-enabled');
    const aiPanel = container.querySelector('[data-knowledge-auto-ai-panel]');
    aiToggle?.addEventListener('change', () => {
      if (aiPanel) aiPanel.hidden = aiToggle.checked !== true;
    });
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
    const targetList = scope.querySelector('#knowledge-auto-target-list');
    const targetsLoaded = targetList?.dataset?.knowledgeAutoTargetsLoaded === '1';
    const aiEnabled = scope.querySelector('#knowledge-auto-llm-enabled')?.checked === true;
    return {
      enabled: true,
      provider: aiEnabled ? (scope.querySelector('#knowledge-auto-provider')?.value || _defaultProvider()) : '',
      model: aiEnabled ? (scope.querySelector('#knowledge-auto-model')?.value?.trim() || '') : '',
      trigger: scope.querySelector('#knowledge-auto-trigger')?.value || 'after_chat',
      writePolicy: scope.querySelector('#knowledge-auto-write-mode')?.value || 'admin_auto',
      targets: {
        home: {
          enabled: homeInput ? homeInput.checked === true : (!targetsLoaded && _targetHomeChecked(previous)),
          path: homeInput?.dataset?.path || (!targetsLoaded ? previous.targets.home.path : ''),
        },
        sources: sourceInputs.length
          ? sourceInputs.map(input => ({
              enabled: input.checked === true,
              name: input.dataset.name || '',
              path: input.dataset.path || '',
            })).filter(item => item.path)
          : (targetsLoaded ? [] : previous.targets.sources),
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
