/* timer-standalone-app.js */
(function () {
  'use strict';

  const app = {
    path: '',
    component: null,
    dirty: false,
    sourcePayload: null,
  };
  let localDrafts = null;

  function qs(id) { return document.getElementById(id); }

  function titleFromPath(path) {
    const name = String(path || '').split('/').pop() || 'タイマー';
    return name.replace(/(\.mel-timer|\.timer\.json)$/i, '') || 'タイマー';
  }

  function setDirty(flag) {
    app.dirty = !!flag;
    document.title = (app.dirty ? '* ' : '') + 'Meldex Timer';
  }

  function setPath(path) {
    app.path = String(path || '').replace(/\\/g, '/');
    MeldexStandaloneFS.setCurrentPath?.(app.path);
    if (!qs('timer-title-label').value || app.path) {
      qs('timer-title-label').value = app.path ? titleFromPath(app.path) : 'タイマー';
    }
    qs('timer-path-label').textContent = app.path ? MeldexStandaloneFS.pathLabel(app.path) : '未保存';
    window.MeldexStandaloneTags?.setTargetPath?.(app.path);
  }

  function collectTimerFile() {
    const source = app.sourcePayload && typeof app.sourcePayload === 'object' ? app.sourcePayload : {};
    const sourceTimer = source.timer && typeof source.timer === 'object' ? source.timer : {};
    const payload = {
      ...source,
      type: 'meldex-timer',
      version: source.version || 1,
      name: String(qs('timer-title-label')?.value || '').trim() || titleFromPath(app.path),
      timer: { ...sourceTimer, ...(app.component?.getState?.() || {}) },
    };
    app.sourcePayload = payload;
    return JSON.stringify(payload, null, 2) + '\n';
  }

  function restoreTimer(payload, path) {
    app.sourcePayload = payload && typeof payload === 'object' ? payload : {};
    const timerState = payload?.timer && typeof payload.timer === 'object' ? payload.timer : payload;
    app.component.restoreState(timerState || {});
    setPath(path || '');
    qs('timer-title-label').value = String(payload?.name || titleFromPath(path));
    setDirty(false);
  }

  async function newTimer() {
    if (app.dirty && !(await cfConfirm('未保存の変更を破棄しますか？'))) return;
    await localDrafts?.discardCurrent?.();
    const content = await MeldexStandaloneFS.newContent('無題');
    restoreTimer(JSON.parse(content), '');
  }

  async function openPath(path) {
    if (!path) return;
    showLoading('タイマーを読み込んでいます...');
    try {
      const data = await MeldexStandaloneFS.readText(path);
      restoreTimer(JSON.parse(data.content || '{}'), path);
      showStatus('タイマーを読み込みました');
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

  async function openTimer() {
    if (app.dirty && !(await cfConfirm('未保存の変更を破棄して開きますか？'))) {
      MeldexStandaloneFS.discardQueuedOpen?.();
      return;
    }
    const selected = await MeldexStandaloneFS.openFile();
    if (selected?.path) {
      await localDrafts?.discardCurrent?.();
      await openPath(selected.path);
    }
  }

  async function saveTimer() {
    if (!app.path) {
      await saveTimerAs();
      return;
    }
    showLoading('タイマーを保存しています...');
    try {
      const res = await MeldexStandaloneFS.writeText(app.path, collectTimerFile(), { skip_if_missing: true });
      if (res?.skipped || res?.missing) {
        showStatus('保存先が見つかりません。名前を付けて保存してください', true);
        await saveTimerAs();
        return;
      }
      setDirty(false);
      await localDrafts?.markSynced?.(res?.etag || '');
      showStatus('保存しました');
    } finally {
      hideLoading();
    }
  }

  async function saveTimerAs() {
    const saved = await MeldexStandaloneFS.saveAs(collectTimerFile(), MeldexStandaloneFS.suggestedName(app.path, '無題.mel-timer'));
    if (!saved?.path) return;
    await localDrafts?.markSynced?.('');
    setPath(saved.path);
    setDirty(false);
    showStatus('保存しました');
  }

  function bindMenus() {
    attachStandaloneMenu(qs('timer-menu-button'), qs('timer-menu'));
    document.addEventListener('click', async event => {
      const action = event.target.closest('[data-timer-file-action]')?.dataset.timerFileAction;
      if (!action) return;
      if (action === 'new') await window.runStandaloneFileAction('新規作成', newTimer);
      if (action === 'open') await window.runStandaloneFileAction('タイマーを開くことが', openTimer);
      if (action === 'save') await window.runStandaloneFileAction('保存', saveTimer);
      if (action === 'saveAs') await window.runStandaloneFileAction('名前を付けて保存', saveTimerAs);
      if (action === 'workspace') window.MeldexStandaloneWorkspaceTree?.open?.();
    });
  }

  function bindTitleEditing() {
    qs('timer-title-label')?.addEventListener('input', () => setDirty(true));
  }

  function bindShortcuts() {
    document.addEventListener('keydown', async event => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        await window.runStandaloneFileAction('保存', saveTimer);
      } else if (key === 'o') {
        event.preventDefault();
        await window.runStandaloneFileAction('タイマーを開くことが', openTimer);
      } else if (key === 'n') {
        event.preventDefault();
        await window.runStandaloneFileAction('新規作成', newTimer);
      }
    });
  }

  function bindPathChanges() {
    window.addEventListener('meldex:file-path-renamed', event => {
      const oldPath = String(event?.detail?.oldPath || '').replace(/\\/g, '/');
      const newPath = String(event?.detail?.newPath || '').replace(/\\/g, '/');
      if (oldPath && newPath && app.path === oldPath) setPath(newPath);
    });
  }

  async function initLocalDrafts() {
    if (!window.MeldexStandaloneLocalDrafts) return;
    localDrafts = window.MeldexStandaloneLocalDrafts.create({
      appId: 'timer',
      getPath: () => app.path,
      capture: () => ({
        title: qs('timer-title-label')?.value || 'タイマー',
        content: collectTimerFile(),
      }),
      restore: snapshot => {
        restoreTimer(JSON.parse(snapshot?.content || '{}'), app.path);
        qs('timer-title-label').value = snapshot?.title || 'タイマー';
        setDirty(true);
      },
      sync: async (snapshot, record) => {
        const result = await MeldexStandaloneFS.writeText(record.remotePath, snapshot.content || '', {
          skip_if_missing: true,
        });
        if (result?.missing || result?.skipped || result?.queued) {
          throw new Error(result?.queued ? '接続後に再試行します' : '保存先が見つかりません');
        }
        setDirty(false);
      },
      onStatus: (status, message) => {
        const label = qs('timer-sync-status');
        if (label && ['saving', 'local-saved', 'pending', 'syncing', 'conflict', 'error'].includes(status)) {
          label.textContent = message;
          label.dataset.status = status;
        }
      },
    });
    localDrafts.start();
    await localDrafts.restoreLatest();
    localDrafts.flush();
  }

  function mountTimer() {
    app.component = new TimerComponent('timer-standalone-pane', 'timer-standalone-tab');
    qs('timer-root').appendChild(app.component.create());
    app.component.activate();
    requestAnimationFrame(() => app.component?._requestDrawTimer?.());
    qs('timer-root').addEventListener('input', () => setDirty(true), true);
    qs('timer-root').addEventListener('change', () => setDirty(true), true);
    qs('timer-root').addEventListener('click', event => {
      if (event.target.closest('[data-timer-action]')) setDirty(true);
    }, true);
  }

  function initOptionPanel() {
    window.MeldexStandaloneOptionPanel?.init({
      storagePrefix: 'meldex-timer',
      toggleButtonIds: ['timer-option-panel-button'],
      defaultWidth: 360,
    });
  }

  function bindUi() {
    mountTimer();
    initOptionPanel();
    bindMenus();
    bindTitleEditing();
    bindShortcuts();
    bindPathChanges();
  }

  async function initializeData() {
    await MeldexStandaloneFS.init();
    const initial = MeldexStandaloneFS.nativeInitialPath();
    if (!initial) await newTimer();
    else {
      try { await openPath(initial); }
      catch {
        await newTimer();
        showStatus('前回のタイマーを開けなかったため、新規タイマーで起動しました', true);
      }
    }
    await initLocalDrafts();
  }

  document.addEventListener('DOMContentLoaded', () => {
    window.MeldexStandaloneBoot = window.MeldexStandaloneBootstrap.create({
      appId: 'timer',
      bindUi,
      initialize: initializeData,
      onError: error => showStatus('タイマーの保存先へ接続できません: ' + (error.message || error) + '。操作すると再試行します。', true),
    });
    window.MeldexStandaloneBoot.start().catch(() => {});
  });
})();
