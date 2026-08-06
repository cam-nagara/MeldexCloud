/* timer-standalone-app.js */
(function () {
  'use strict';

  const app = {
    path: '',
    lastSavedEtag: '',
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

  function setPath(path, etag) {
    app.path = String(path || '').replace(/\\/g, '/');
    app.lastSavedEtag = String(etag || '').trim();
    MeldexStandaloneFS.setCurrentPath?.(app.path);
    if (!qs('timer-title-label').value) {
      qs('timer-title-label').value = app.path ? titleFromPath(app.path) : 'タイマー';
    }
    qs('timer-path-label').textContent = app.path ? MeldexStandaloneFS.pathLabel(app.path) : '未保存';
    window.MeldexStandaloneTags?.setTargetPath?.(app.path);
    renderFileInfo();
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

  function restoreTimer(payload, path, etag) {
    app.sourcePayload = payload && typeof payload === 'object' ? payload : {};
    const timerState = payload?.timer && typeof payload.timer === 'object' ? payload.timer : payload;
    app.component.restoreState(timerState || {});
    setPath(path || '', etag || '');
    qs('timer-title-label').value = String(payload?.name || titleFromPath(path));
    applyTimerFileStyle();
    renderOptionPanel();
    setDirty(false);
  }

  function timerFileStyle() {
    const style = app.sourcePayload?.style;
    return style && typeof style === 'object' && !Array.isArray(style) ? style : {};
  }

  function timerColorValue(value, fallback) {
    const text = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
  }

  function applyTimerFileStyle() {
    const style = timerFileStyle();
    const root = qs('timer-root');
    if (!root?.style) return;
    ['--timer-bg', '--timer-fg', '--accent'].forEach(key => root.style.removeProperty(key));
    for (const key of ['--timer-bg', '--timer-fg', '--accent']) {
      const color = timerColorValue(style[key], '');
      if (color) root.style.setProperty(key, color);
    }
    app.component?._requestDrawTimer?.();
  }

  function renderFileInfo() {
    const path = qs('timer-option-file-path');
    const size = qs('timer-option-file-size');
    const updated = qs('timer-option-file-updated');
    if (path) path.textContent = app.path ? MeldexStandaloneFS.pathLabel(app.path) : '未保存';
    if (size) {
      const content = collectTimerFile();
      const bytes = typeof TextEncoder === 'function'
        ? new TextEncoder().encode(content).byteLength
        : unescape(encodeURIComponent(content)).length;
      size.textContent = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
    }
    if (updated) {
      const value = app.sourcePayload?.modified || app.sourcePayload?.updated_at || '';
      updated.textContent = value ? new Date(value).toLocaleString('ja-JP') : '保存後に記録';
    }
  }

  function renderCalendarProviderStatus(detail) {
    const status = detail || window.MeldexStandaloneTimerCalendarProvider?.getStatus?.() || {};
    const card = qs('timer-calendar-provider-state');
    if (!card) return;
    card.dataset.source = status.source || 'unconfigured';
    qs('timer-calendar-provider-reason').textContent = status.reason || 'カレンダーを利用できます';
    qs('timer-calendar-provider-action').textContent = status.nextAction || '';
    const sourceLabels = {
      sqlite: '提供元: Meldex本体',
      sqlite_missing: '提供元: Meldex本体（データ未作成）',
      sqlite_error: '提供元: Meldex本体（読取エラー）',
      dropbox: '提供元: Dropbox',
      dropbox_missing: '提供元: Dropbox（データ未作成）',
      offline_cache: '提供元: この端末の最終取得データ',
    };
    qs('timer-calendar-provider-source').textContent =
      sourceLabels[status.source] || `提供元: ${status.source || '未設定'}`;
    const error = qs('timer-calendar-provider-error');
    error.textContent = status.lastError ? `エラー詳細: ${status.lastError}` : '';
    error.hidden = !status.lastError;
  }

  function bindFileStyleControls() {
    qs('rp-detail')?.querySelectorAll('[data-timer-file-style]').forEach(input => {
      input.addEventListener('input', () => {
        const style = { ...timerFileStyle(), [input.dataset.timerFileStyle]: input.value };
        app.sourcePayload = { ...(app.sourcePayload || {}), style };
        applyTimerFileStyle();
        setDirty(true);
        localDrafts?.schedule?.();
        renderFileInfo();
      });
    });
  }

  function renderOptionPanel() {
    const detail = qs('rp-detail');
    if (!detail || !app.component || typeof detail.querySelector !== 'function') return;
    const style = timerFileStyle();
    const background = timerColorValue(style['--timer-bg'], '#1e1e1e');
    const foreground = timerColorValue(style['--timer-fg'], '#d4d4d4');
    const accent = timerColorValue(style['--accent'], '#569cd6');
    detail.innerHTML = `
      <section class="timer-option-section" data-e2e-id="timer-option-specific">
        <h3>タイマー設定</h3>
        <div data-timer-advanced-host></div>
      </section>
      <section class="timer-option-section" data-e2e-id="timer-option-calendar-provider">
        <h3>カレンダーのデータ提供元</h3>
        <div id="timer-calendar-provider-state" class="timer-calendar-state">
          <strong id="timer-calendar-provider-reason"></strong>
          <span id="timer-calendar-provider-action"></span>
          <span id="timer-calendar-provider-source"></span>
          <small id="timer-calendar-provider-error" hidden></small>
          <button class="gb-btn gb-btn-sm" type="button" data-timer-provider-refresh>再試行</button>
        </div>
      </section>
      <section class="timer-option-section" data-e2e-id="timer-option-file-info">
        <h3>ファイル情報</h3>
        <dl class="timer-option-grid">
          <dt>保存場所</dt><dd id="timer-option-file-path"></dd>
          <dt>ファイルサイズ</dt><dd id="timer-option-file-size"></dd>
          <dt>更新日時</dt><dd id="timer-option-file-updated"></dd>
        </dl>
      </section>
      <section class="timer-option-section" data-e2e-id="timer-option-file-style">
        <h3>ファイルスタイル</h3>
        <dl class="timer-option-grid">
          <dt>背景</dt><dd><input type="color" aria-label="タイマーの背景色" data-timer-file-style="--timer-bg" value="${background}"></dd>
          <dt>文字</dt><dd><input type="color" aria-label="タイマーの文字色" data-timer-file-style="--timer-fg" value="${foreground}"></dd>
          <dt>強調</dt><dd><input type="color" aria-label="タイマーの強調色" data-timer-file-style="--accent" value="${accent}"></dd>
        </dl>
      </section>`;
    const advancedHost = detail.querySelector('[data-timer-advanced-host]');
    if (advancedHost && typeof app.component._timerAdvancedHtml === 'function') {
      advancedHost.innerHTML = app.component._timerAdvancedHtml();
      app.component._timerAdvancedPanelRoot = function () {
        return this._timerAdvancedModal?.querySelector?.('[data-timer-advanced]')
          || detail.querySelector('[data-timer-advanced]')
          || this.el?.querySelector?.('[data-timer-advanced]')
          || null;
      };
      app.component._timerAdvancedBindEvents?.(advancedHost);
      app.component._timerAdvancedRenderCalendars?.();
      app.component._timerAdvancedRenderPresets?.();
      app.component._timerAdvancedSyncControls?.();
      app.component._timerAdvancedLoadCalendars?.();
    }
    detail.querySelector('[data-timer-provider-refresh]')?.addEventListener('click', () => {
      app.component?._timerAdvancedLoadCalendars?.();
    });
    bindFileStyleControls();
    renderFileInfo();
    renderCalendarProviderStatus();
    window.replaceIcons?.();
  }

  async function newTimer() {
    if (app.dirty && !(await cfConfirm('未保存の変更を破棄しますか？'))) return;
    await localDrafts?.discardCurrent?.();
    const content = await MeldexStandaloneFS.newContent('無題');
    restoreTimer(JSON.parse(content), '', '');
  }

  async function openPath(path) {
    if (!path) return;
    showLoading('タイマーを読み込んでいます...');
    try {
      const data = await MeldexStandaloneFS.readText(path);
      restoreTimer(JSON.parse(data.content || '{}'), path, data.etag);
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
      const baselineEtag = String(app.lastSavedEtag || '').trim();
      if (!baselineEtag) {
        throw new Error('現在のファイルの更新情報を確認できないため、上書きを中止しました。名前を付けて保存してください。');
      }
      const res = await MeldexStandaloneFS.writeText(app.path, collectTimerFile(), {
        if_match_etag: baselineEtag,
        skip_if_missing: true,
      });
      if (res?.skipped || res?.missing) {
        showStatus('保存先が見つかりません。名前を付けて保存してください', true);
        await saveTimerAs();
        return;
      }
      const nextEtag = String(res?.etag || '').trim();
      if (!nextEtag) {
        app.lastSavedEtag = '';
        throw new Error('保存後の更新情報を確認できないため、次の上書きを中止しました');
      }
      app.lastSavedEtag = nextEtag;
      setDirty(false);
      await localDrafts?.markSynced?.(app.lastSavedEtag);
      showStatus('保存しました');
    } finally {
      hideLoading();
    }
  }

  async function saveTimerAs() {
    const saved = await MeldexStandaloneFS.saveAs(collectTimerFile(), MeldexStandaloneFS.suggestedName(app.path, '無題.mel-timer'));
    if (!saved?.path) return false;
    const savedEtag = String(saved.etag || '').trim();
    setPath(saved.path, savedEtag);
    if (!savedEtag) {
      throw new Error('保存結果の更新情報を確認できないため、次の上書きを中止しました。もう一度名前を付けて保存してください。');
    }
    await localDrafts?.markSynced?.(savedEtag);
    setDirty(false);
    showStatus('保存しました');
    return true;
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
      if (oldPath && newPath && app.path === oldPath) setPath(newPath, app.lastSavedEtag);
    });
  }

  async function initLocalDrafts() {
    if (!window.MeldexStandaloneLocalDrafts) return;
    localDrafts = window.MeldexStandaloneLocalDrafts.create({
      appId: 'timer',
      getPath: () => app.path,
      getRevision: () => app.lastSavedEtag,
      capture: () => ({
        title: qs('timer-title-label')?.value || 'タイマー',
        content: collectTimerFile(),
      }),
      restore: snapshot => {
        restoreTimer(JSON.parse(snapshot?.content || '{}'), app.path, app.lastSavedEtag);
        qs('timer-title-label').value = snapshot?.title || 'タイマー';
        setDirty(true);
      },
      sync: async (snapshot, record) => {
        const baselineEtag = String(record.baseRevision || '').trim();
        if (!baselineEtag) {
          throw new Error('更新情報がないため、下書きの上書きを中止しました');
        }
        const result = await MeldexStandaloneFS.writeText(record.remotePath, snapshot.content || '', {
          if_match_etag: baselineEtag,
          skip_if_missing: true,
        });
        if (result?.missing || result?.skipped || result?.queued) {
          throw new Error(result?.queued ? '接続後に再試行します' : '保存先が見つかりません');
        }
        const nextEtag = String(result?.etag || '').trim();
        if (!nextEtag) {
          app.lastSavedEtag = '';
          throw new Error('保存後の更新情報を確認できないため、下書きの上書きを中止しました');
        }
        app.lastSavedEtag = nextEtag;
        setDirty(false);
      },
      onStatus: (status, message) => {
        const label = qs('timer-sync-status');
        if (label && ['waiting', 'local-saving', 'local-saved', 'saving', 'final-saving', 'pending', 'syncing', 'synced', 'conflict', 'error'].includes(status)) {
          label.textContent = message;
          label.dataset.status = status;
        }
      },
    });
    localDrafts.start();
    window.MeldexStandaloneCloseGuard?.register?.({
      appId: 'timer',
      saveAs: saveTimerAs,
      prepareClose: () => {
        document.activeElement?.blur?.();
        return true;
      },
    });
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
      if (event.target.closest('[data-timer-action]')) {
        setDirty(true);
        localDrafts?.schedule?.();
      }
    }, true);
  }

  function initOptionPanel() {
    window.MeldexStandaloneOptionPanel?.init({
      storagePrefix: 'meldex-timer',
      toggleButtonIds: ['timer-option-panel-button'],
      defaultWidth: 360,
    });
    renderOptionPanel();
  }

  function bindUi() {
    window.MeldexStandaloneTimerCalendarProvider?.install?.();
    mountTimer();
    initOptionPanel();
    bindMenus();
    bindTitleEditing();
    bindShortcuts();
    bindPathChanges();
    window.addEventListener('meldex:timer-calendar-provider-status', event => {
      renderCalendarProviderStatus(event.detail);
    });
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
