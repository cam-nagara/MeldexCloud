/* scenario-standalone-app.js */
(function () {
  'use strict';

  const app = {
    path: '',
    component: null,
    dirty: false,
  };

  function qs(id) { return document.getElementById(id); }

  function titleFromPath(path) {
    const name = String(path || '').split('/').pop() || '新規シナリオ';
    return name.replace(/(\.mel-scenario|\.scriptnote\.json)$/i, '') || '新規シナリオ';
  }

  function setDirty(flag) {
    app.dirty = !!flag;
    document.title = (app.dirty ? '* ' : '') + 'Meldex Scenario';
  }

  function setPath(path) {
    app.path = String(path || '').replace(/\\/g, '/');
    MeldexStandaloneFS.setCurrentPath?.(app.path);
    state.currentPagePath = app.path;
    qs('scenario-title-label').textContent = app.path ? titleFromPath(app.path) : '新規シナリオ';
    qs('scenario-path-label').textContent = app.path ? MeldexStandaloneFS.pathLabel(app.path) : '未保存';
    if (app.component) {
      app.component.state.scenarioPath = app.path;
      app.component.state.label = titleFromPath(app.path);
      if (app.component._editor) app.component._editor._path = app.path;
    }
  }

  function editor() {
    return app.component?._editor || null;
  }

  function collectJson() {
    const ed = editor();
    if (!ed?.doc) return '{}\n';
    ed._syncAllFromDom?.();
    return JSON.stringify(ed.collectDoc(), null, 2) + '\n';
  }

  function loadParsed(parsed, path) {
    if (typeof isScriptNoteFileDoc === 'function' && !isScriptNoteFileDoc(parsed)) {
      throw new Error('シナリオ形式ファイルではありません');
    }
    const host = app.component.el.querySelector('#scenario-note-surface');
    if (!app.component._editor) app.component._editor = new ScriptNoteEditor(host);
    app.component._editor.host = host;
    app.component._editor.loadDoc(parsed, path || '');
    app.component.state.scenarioPath = path || '';
    app.component.state.label = parsed.title || titleFromPath(path);
    const titleInput = app.component.el.querySelector('#title-input');
    if (titleInput) titleInput.value = parsed.title || '';
    const layoutSel = app.component.el.querySelector('#scenario-note-layout-select');
    if (layoutSel) layoutSel.value = parsed.layoutMode || 'manga';
    app.component.activate();
    setPath(path || '');
    setDirty(false);
  }

  async function newScenario() {
    if ((app.dirty || editor()?._dirty) && !(await cfConfirm('未保存の変更を破棄しますか？'))) return;
    const content = await MeldexStandaloneFS.newContent('無題');
    loadParsed(JSON.parse(content), '');
  }

  async function openPath(path) {
    if (!path) return;
    showLoading('シナリオを読み込んでいます...');
    try {
      const data = await MeldexStandaloneFS.readText(path);
      const parsed = JSON.parse(data.content || '{}');
      loadParsed(parsed, path);
      showStatus('シナリオを読み込みました');
    } catch (error) {
      if (MeldexStandaloneFS.currentPath?.() !== path) {
        await MeldexStandaloneFS.releaseEditLock?.(path);
        MeldexStandaloneFS.discardRememberedPath?.(path);
      }
      throw error;
    } finally {
      hideLoading();
    }
  }

  async function openScenario() {
    if ((app.dirty || editor()?._dirty) && !(await cfConfirm('未保存の変更を破棄して開きますか？'))) {
      MeldexStandaloneFS.discardQueuedOpen?.();
      return;
    }
    const selected = await MeldexStandaloneFS.openFile();
    if (selected?.path) await openPath(selected.path);
  }

  async function saveScenario() {
    if (!editor()?.doc) return;
    const json = collectJson();
    if (!app.path) {
      await saveScenarioAs();
      return;
    }
    showLoading('シナリオを保存しています...');
    try {
      const res = await MeldexStandaloneFS.writeText(app.path, json, { skip_if_missing: true });
      if (res?.skipped || res?.missing) {
        showStatus('保存先が見つかりません。名前を付けて保存してください', true);
        await saveScenarioAs();
        return;
      }
      editor()._dirty = false;
      setDirty(false);
      showStatus('保存しました');
    } finally {
      hideLoading();
    }
  }

  async function saveScenarioAs() {
    if (!editor()?.doc) return;
    const suggested = MeldexStandaloneFS.suggestedName(app.path, '無題.mel-scenario');
    const saved = await MeldexStandaloneFS.saveAs(collectJson(), suggested);
    if (!saved?.path) return;
    setPath(saved.path);
    editor()._dirty = false;
    setDirty(false);
    showStatus('保存しました');
  }

  function bindDirtyObserver() {
    const root = qs('scenario-root');
    root.addEventListener('input', () => setDirty(true), true);
    root.addEventListener('change', () => setDirty(true), true);
  }

  function bindPathChanges() {
    window.addEventListener('meldex:file-path-renamed', event => {
      const oldPath = String(event?.detail?.oldPath || '').replace(/\\/g, '/');
      const newPath = String(event?.detail?.newPath || '').replace(/\\/g, '/');
      if (oldPath && newPath && app.path === oldPath) setPath(newPath);
    });
  }

  function bindMenus() {
    attachStandaloneMenu(qs('scenario-menu-button'), qs('scenario-menu'));
    document.addEventListener('click', async event => {
      const action = event.target.closest('[data-scenario-action]')?.dataset.scenarioAction;
      if (!action) return;
      if (action === 'new') await window.runStandaloneFileAction('新規作成', newScenario);
      if (action === 'open') await window.runStandaloneFileAction('シナリオを開くことが', openScenario);
      if (action === 'save') await window.runStandaloneFileAction('保存', saveScenario);
      if (action === 'saveAs') await window.runStandaloneFileAction('名前を付けて保存', saveScenarioAs);
      if (action === 'sendBmanga') await window.MeldexBManga?.sendActiveScenario?.();
      if (action === 'undo') editor()?.undo?.();
      if (action === 'redo') editor()?.redo?.();
    });
  }

  function bindShortcuts() {
    document.addEventListener('keydown', async event => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        await window.runStandaloneFileAction('保存', saveScenario);
      } else if (key === 'o') {
        event.preventDefault();
        await window.runStandaloneFileAction('シナリオを開くことが', openScenario);
      } else if (key === 'n') {
        event.preventDefault();
        await window.runStandaloneFileAction('新規作成', newScenario);
      } else if (key === 'z' && event.shiftKey) {
        event.preventDefault();
        editor()?.redo?.();
      } else if (key === 'z') {
        event.preventDefault();
        editor()?.undo?.();
      } else if (key === 'y') {
        event.preventDefault();
        editor()?.redo?.();
      }
    }, true);
  }

  function mountComponent() {
    app.component = new ScriptNoteComponent('scenario-standalone-pane', 'scenario-standalone-tab');
    app.component._skipDetailSync = true;
    qs('scenario-root').appendChild(app.component.create());
    app.component.activate();
  }

  async function init() {
    await MeldexStandaloneFS.init();
    mountComponent();
    bindMenus();
    bindShortcuts();
    bindDirtyObserver();
    bindPathChanges();
    const initial = MeldexStandaloneFS.nativeInitialPath();
    if (!initial) await newScenario();
    else {
      try { await openPath(initial); }
      catch {
        await newScenario();
        showStatus('前回のシナリオを開けなかったため、新規シナリオで起動しました', true);
      }
    }
  }

  window.getActiveScriptNoteComponent = function () {
    return app.component;
  };

  document.addEventListener('DOMContentLoaded', () => {
    init().catch(error => showStatus('シナリオの初期化に失敗: ' + (error.message || error), true));
  });
})();
