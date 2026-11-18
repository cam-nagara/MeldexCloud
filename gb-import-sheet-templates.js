(function (global) {
  'use strict';

  const STORAGE_KEY = 'meldex.import-sheet-templates.v1';
  const APPLIED_KEY = 'meldex.import-sheet-templates.applied.v1';
  const PREFERENCE_DOCUMENT = 'import-sheet-templates';
  const DEFINITIONS = Object.freeze({
    'quick-memo': {
      label: 'クイックメモ',
      description: 'クイックメモの保存先シートへ、選択したシートテンプレートを追加適用します。',
    },
    'web-clipper': {
      label: 'Web Clipper',
      description: 'Web Clipperの保存先シートへ、保存通知を受けた時に選択したシートテンプレートを追加適用します。',
    },
    'x-bookmarks': {
      label: 'Xブックマーク',
      description: 'Xブックマークの保存先シートへ、保存完了時に選択したシートテンプレートを追加適用します。',
    },
    'x-account-posts': {
      label: 'Xアカウント',
      description: '各Xアカウントの保存先シートへ、保存完了時に選択したシートテンプレートを追加適用します。',
    },
  });
  let sharedLoadPromise = null;

  function readJson(key, fallback) {
    try {
      const parsed = JSON.parse(global.localStorage?.getItem(key) || 'null');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function selections() {
    return readJson(STORAGE_KEY, {});
  }

  function writeSelections(value) {
    global.localStorage?.setItem(STORAGE_KEY, JSON.stringify(value || {}));
  }

  function appliedRecords() {
    return readJson(APPLIED_KEY, {});
  }

  function writeAppliedRecords(value) {
    global.localStorage?.setItem(APPLIED_KEY, JSON.stringify(value || {}));
  }

  function normalizeImporter(importer) {
    const key = String(importer || '').trim();
    return Object.prototype.hasOwnProperty.call(DEFINITIONS, key) ? key : '';
  }

  function getSelection(importer) {
    const key = normalizeImporter(importer);
    return key ? String(selections()[key] || '') : '';
  }

  function templates() {
    if (typeof global.getAllTemplates !== 'function') return [];
    try {
      return global.getAllTemplates().filter(item => item && item.id && item.name);
    } catch (_) {
      return [];
    }
  }

  function hashTemplate(template) {
    const text = JSON.stringify({
      id: template?.id || '',
      name: template?.name || '',
      properties: template?.properties || [],
      colOrder: template?.colOrder || [],
      colWidths: template?.colWidths || {},
      enabledModes: template?.enabledModes || [],
      savedViews: template?.savedViews || [],
      entityTemplates: template?.entityTemplates || [],
    });
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${template?.id || ''}:${(hash >>> 0).toString(36)}`;
  }

  function clearAppliedFor(importer) {
    const key = normalizeImporter(importer);
    if (!key) return;
    const records = appliedRecords();
    if (records[key]) {
      delete records[key];
      writeAppliedRecords(records);
    }
  }

  function renderAll() {
    global.document?.querySelectorAll?.('[data-import-sheet-template]')?.forEach(mount);
  }

  function syncMountedSelections() {
    global.document?.querySelectorAll?.('[data-import-sheet-template]')?.forEach(host => {
      const key = normalizeImporter(host.dataset.importSheetTemplate);
      const select = host.querySelector?.('[data-import-sheet-template-select]');
      if (!key || !select) return;
      const selectedId = getSelection(key);
      if (selectedId && ![...select.options].some(option => option.value === selectedId)) {
        const selectedTemplate = templates().find(template => String(template.id) === selectedId);
        const option = global.document.createElement('option');
        option.value = selectedId;
        option.textContent = selectedTemplate
          ? `${selectedTemplate.name}${selectedTemplate.builtin === false ? '（カスタム）' : ''}`
          : '利用できないテンプレート';
        select.appendChild(option);
        if (!selectedTemplate) {
          statusFor(host, '共有設定のテンプレートがこの端末にありません。別のテンプレートを選択してください。', true);
        }
      }
      select.value = selectedId;
    });
  }

  async function saveSharedSelections(changedImporter) {
    if (typeof global.apiFetch !== 'function') return { shared: false };
    const changedKey = normalizeImporter(changedImporter);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const current = await global.apiFetch(`/personal-preferences/${PREFERENCE_DOCUMENT}`, { silentError: true });
        const remoteSelections = current?.payload?.selections;
        const localSelections = selections();
        const mergedSelections = remoteSelections && typeof remoteSelections === 'object' && !Array.isArray(remoteSelections)
          ? { ...remoteSelections }
          : {};
        if (changedKey) mergedSelections[changedKey] = String(localSelections[changedKey] || '');
        else Object.assign(mergedSelections, localSelections);
        const payload = { schemaVersion: 1, selections: mergedSelections };
        const body = { payload };
        if (current?.available !== false) body.expectedRevision = current?.revision || null;
        const result = await global.apiFetch(`/personal-preferences/${PREFERENCE_DOCUMENT}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          silentError: true,
        });
        if (result?.ok !== false) return { shared: true, revision: result?.revision || null };
      } catch (error) {
        if (attempt > 0) return { shared: false, error };
      }
    }
    return { shared: false };
  }

  async function loadSharedSelections() {
    if (sharedLoadPromise) return sharedLoadPromise;
    sharedLoadPromise = (async () => {
      if (typeof global.apiFetch !== 'function') return { shared: false };
      try {
        const result = await global.apiFetch(`/personal-preferences/${PREFERENCE_DOCUMENT}`, { silentError: true });
        const remote = result?.payload?.selections;
        if (remote && typeof remote === 'object' && !Array.isArray(remote)) {
          const next = { ...selections() };
          Object.keys(DEFINITIONS).forEach(key => {
            if (Object.prototype.hasOwnProperty.call(remote, key)) next[key] = String(remote[key] || '');
          });
          writeSelections(next);
          syncMountedSelections();
        }
        return { shared: result?.available !== false, revision: result?.revision || null };
      } catch (error) {
        return { shared: false, error };
      }
    })();
    return sharedLoadPromise;
  }

  async function save(importer, templateId, options = {}) {
    const key = normalizeImporter(importer);
    if (!key) throw new Error('インポート種別が不正です');
    const id = String(templateId || '');
    if (id && !templates().some(template => String(template.id) === id)) {
      throw new Error('選択したシートテンプレートが見つかりません');
    }
    const before = typeof global.captureLocalStorageSettings === 'function'
      ? global.captureLocalStorageSettings([STORAGE_KEY, APPLIED_KEY])
      : null;
    const next = { ...selections(), [key]: id };
    writeSelections(next);
    clearAppliedFor(key);
    if (before && options.skipHistory !== true && typeof global.pushLocalStorageSettingsHistory === 'function') {
      global.pushLocalStorageSettingsHistory(
        `${DEFINITIONS[key].label}: インポート先テンプレート`,
        before,
        global.captureLocalStorageSettings([STORAGE_KEY, APPLIED_KEY]),
        id || 'テンプレートなし',
        () => {
          syncMountedSelections();
          void saveSharedSelections(key);
        }
      );
    }
    syncMountedSelections();
    return saveSharedSelections(key);
  }

  async function apply(importer, path, options = {}) {
    const key = normalizeImporter(importer);
    const dbPath = String(path || '').trim();
    if (!key || !dbPath) return { applied: false, reason: 'target-missing' };
    await loadSharedSelections();
    const templateId = getSelection(key);
    if (!templateId) return { applied: false, reason: 'not-configured' };
    const template = templates().find(item => String(item.id) === templateId);
    if (!template) return { applied: false, reason: 'template-missing', templateId };
    const fingerprint = hashTemplate(template);
    const records = appliedRecords();
    const perImporter = records[key] && typeof records[key] === 'object' ? records[key] : {};
    if (!options.force && perImporter[dbPath] === fingerprint) {
      return { applied: false, reason: 'already-applied', templateId, path: dbPath };
    }
    if (typeof global.applyDbTemplate !== 'function') throw new Error('シートテンプレート機能を利用できません');
    const result = global.applyDbTemplate(dbPath, template, { overwrite: false });
    if (result?.backendSavePromise) await result.backendSavePromise;
    records[key] = { ...perImporter, [dbPath]: fingerprint };
    writeAppliedRecords(records);
    return {
      applied: true,
      templateId,
      templateName: template.name,
      path: dbPath,
      added: Array.isArray(result?.applied) ? result.applied.length : 0,
      skipped: Array.isArray(result?.skipped) ? result.skipped.length : 0,
    };
  }

  async function resolveCurrentTargets(importer) {
    const key = normalizeImporter(importer);
    if (key === 'quick-memo' && typeof global.apiFetch === 'function') {
      const config = await global.apiFetch('/quick-memo/config', { silentError: true });
      return [config?.quick_memo_folder].filter(Boolean);
    }
    if (key === 'x-bookmarks') {
      return [global.document?.getElementById?.('x-bookmarks-save-dir')?.value || 'Xブックマーク'];
    }
    if (key === 'x-account-posts') {
      const usernames = [...(global.document?.querySelectorAll?.('[data-action="sync"][data-username]') || [])]
        .map(button => String(button.dataset.username || '').trim()).filter(Boolean);
      return [...new Set(usernames.map(username => `Xアカウント/@${username}`))];
    }
    if (key === 'web-clipper') {
      const metadata = global.state?.dbMetadata;
      return metadata?.webclip_sheet === true && global.state?.currentDbPath ? [global.state.currentDbPath] : [];
    }
    return [];
  }

  async function applyCurrent(importer) {
    const targets = await resolveCurrentTargets(importer);
    if (!targets.length) return { applied: 0, targets: 0 };
    const results = [];
    for (const path of targets.slice(0, 16)) results.push(await apply(importer, path, { force: true }));
    return { applied: results.filter(result => result.applied).length, targets: targets.length, results };
  }

  async function applyMany(importer, paths) {
    const targets = [...new Set((Array.isArray(paths) ? paths : [])
      .map(path => String(path || '').trim()).filter(Boolean))].slice(0, 32);
    const results = [];
    for (const path of targets) {
      try {
        results.push(await apply(importer, path));
      } catch (error) {
        results.push({ applied: false, reason: 'apply-failed', path, error });
      }
    }
    return {
      applied: results.filter(result => result.applied).length,
      failed: results.filter(result => result.reason === 'apply-failed').length,
      targets: targets.length,
      results,
    };
  }

  function statusFor(host, message, isError) {
    const status = host.querySelector('[data-import-sheet-template-status]');
    if (!status) return;
    status.textContent = String(message || '');
    status.style.color = isError ? 'var(--danger, var(--red))' : 'var(--fg2)';
  }

  function mount(host) {
    if (!host || host.dataset.importSheetTemplateMounted === '1') return;
    const key = normalizeImporter(host.dataset.importSheetTemplate);
    if (!key) return;
    host.dataset.importSheetTemplateMounted = '1';
    host.innerHTML = `
      <div class="gb-section-title">インポート先のシートテンプレート</div>
      <div class="gb-section-desc">${DEFINITIONS[key].description} 既存の列や値は上書きしません。</div>
      <div class="gb-field-row" style="justify-content:flex-start;align-items:center;flex-wrap:wrap;margin-top:8px;">
        <select class="gb-select" data-import-sheet-template-select data-e2e-id="import-sheet-template-select-${key}" aria-label="${DEFINITIONS[key].label}のシートテンプレート"></select>
        <button type="button" class="gb-btn gb-btn-sm" data-import-sheet-template-apply data-e2e-id="import-sheet-template-apply-${key}">現在の保存先にも適用</button>
      </div>
      <div class="gb-section-desc" data-import-sheet-template-status role="status" aria-live="polite"></div>
    `;
    const select = host.querySelector('[data-import-sheet-template-select]');
    const current = getSelection(key);
    const options = ['<option value="">テンプレートを追加適用しない</option>'];
    templates().forEach(template => {
      const option = global.document.createElement('option');
      option.value = String(template.id);
      option.textContent = `${template.name}${template.builtin === false ? '（カスタム）' : ''}`;
      options.push(option.outerHTML);
    });
    if (current && !templates().some(template => String(template.id) === current)) {
      const missing = global.document.createElement('option');
      missing.value = current;
      missing.textContent = '利用できないテンプレート';
      options.push(missing.outerHTML);
      statusFor(host, '選択済みのテンプレートがこの端末にありません。別のテンプレートを選択してください。', true);
    }
    select.innerHTML = options.join('');
    select.value = current;
    select.addEventListener('change', async () => {
      select.disabled = true;
      try {
        const saved = await save(key, select.value);
        statusFor(host, saved.shared ? '設定を保存し、端末間で共有しました。' : '設定をこの端末に保存しました。', false);
      } catch (error) {
        statusFor(host, `設定を保存できませんでした: ${error?.message || error}`, true);
      } finally {
        select.disabled = false;
      }
    });
    host.querySelector('[data-import-sheet-template-apply]')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const result = await applyCurrent(key);
        statusFor(host, result.targets
          ? `${result.targets}個の保存先にテンプレートを適用しました。`
          : '現在の保存先シートがまだありません。次のインポート時に自動適用します。', false);
      } catch (error) {
        statusFor(host, `テンプレートを適用できませんでした: ${error?.message || error}`, true);
      } finally {
        button.disabled = false;
      }
    });
    void loadSharedSelections();
  }

  async function ensureForOpenedSheet(dbPath, metadata) {
    let importer = '';
    if (metadata?.webclip_sheet === true) importer = 'web-clipper';
    else if (metadata?.x_account_username) importer = 'x-account-posts';
    if (!importer) return { applied: false, reason: 'not-import-sheet' };
    return apply(importer, dbPath);
  }

  function start() {
    renderAll();
    void loadSharedSelections();
    if (typeof global.MutationObserver === 'function' && global.document?.body) {
      new global.MutationObserver(records => {
        records.forEach(record => record.addedNodes.forEach(node => {
          if (node?.matches?.('[data-import-sheet-template]')) mount(node);
          node?.querySelectorAll?.('[data-import-sheet-template]').forEach(mount);
        }));
      }).observe(global.document.body, { childList: true, subtree: true });
    }
  }

  global.MeldexImportSheetTemplates = Object.freeze({
    apply,
    applyMany,
    applyCurrent,
    definitions: () => ({ ...DEFINITIONS }),
    ensureForOpenedSheet,
    getSelection,
    loadSharedSelections,
    mount,
    save,
  });

  if (global.document?.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})(window);
