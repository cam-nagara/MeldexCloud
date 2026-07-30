/* scenario-standalone-app.js */
(function () {
  'use strict';

  const app = {
    path: '',
    component: null,
    dirty: false,
  };
  let localDrafts = null;

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
    qs('scenario-title-label').value = app.path ? titleFromPath(app.path) : '新規シナリオ';
    qs('scenario-path-label').textContent = app.path ? MeldexStandaloneFS.pathLabel(app.path) : '未保存';
    window.MeldexStandaloneTags?.setTargetPath?.(app.path);
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
    qs('scenario-title-label').value = parsed.title || titleFromPath(path);
    setDirty(false);
  }

  async function newScenario() {
    if ((app.dirty || editor()?._dirty) && !(await cfConfirm('未保存の変更を破棄しますか？'))) return;
    await localDrafts?.discardCurrent?.();
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
    if (selected?.path) {
      await localDrafts?.discardCurrent?.();
      await openPath(selected.path);
    }
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
      await localDrafts?.markSynced?.(res?.etag || '');
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
    await localDrafts?.markSynced?.('');
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
      if (action === 'workspace') window.MeldexStandaloneWorkspaceTree?.open?.();
      if (action === 'exportPng') await window.runStandaloneFileAction('PNG出力', exportPng);
      if (action === 'exportHtml') await window.runStandaloneFileAction('HTML出力', exportHtml);
      if (action === 'exportMarkdown') await window.runStandaloneFileAction('Markdown出力', exportMarkdown);
      if (action === 'clipstudio') await window.runStandaloneFileAction('CLIP STUDIO PAINTへの送信', sendToClipStudio);
      if (action === 'sendBmanga') await window.MeldexBManga?.sendActiveScenario?.();
      if (action === 'undo') editor()?.undo?.();
      if (action === 'redo') editor()?.redo?.();
    });
  }

  function bindTitleEditing() {
    const headerTitle = qs('scenario-title-label');
    headerTitle?.addEventListener('input', () => {
      const value = headerTitle.value;
      const documentTitle = app.component?.el?.querySelector('#title-input');
      if (documentTitle && documentTitle.value !== value) {
        documentTitle.value = value;
        documentTitle.dispatchEvent(new Event('input', { bubbles: true }));
      }
      setDirty(true);
    });
    app.component?.el?.addEventListener('input', event => {
      if (event.target?.id !== 'title-input') return;
      if (headerTitle && headerTitle.value !== event.target.value) headerTitle.value = event.target.value;
    });
  }

  // 本体のシナリオエディタは複数パネル（GBLayout）前提で「アクティブなパネルの
  // シナリオエディタ」を探索するが、単独版は常にこの1インスタンスだけなので
  // 単独版用に上書きする（gb-scriptnote-format.js / gb-export-image.js /
  // gb-scriptnote-clipstudio.js の PNG・HTML・Markdown出力・CLIP STUDIO送信は
  // すべてこの関数経由でエディタを取得するため、これだけでまとめて有効化できる）。
  //
  // _getScriptNoteEditorForFileStyle 等のファイルスタイル（オプションパネル「テーマ」
  // タブ）共通基盤は本体では gb-note-enhance.js（ノート機能拡張ファイル）内に同居して
  // 定義されているが、単独版シナリオはノートエディタ本体を同梱しないため未定義になる。
  // gb-note-enhance.js 全体（スラッシュコマンド等ノート専用の大きな機能を含む）を
  // 同梱するのは過剰なため、シナリオの「テーマ」タブが必要とする5つの定義だけを
  // 本体(gb-note-enhance.part01.js)と同一内容でここに用意する。
  // 本体側でこの一覧が変わった場合は追随が必要（app/AGENT_INBOX.md に記録済み）。
  const SN2_FILE_STYLE_KEYS = [
    'borderColor', 'borderWidth', 'baseTextColor', 'baseTextBold', 'baseTextItalic',
    'baseTextFontFamily', 'baseTextFontSize', 'baseTextLineHeight', 'baseTextLetterSpacing',
    'baseTextLineHeightH', 'baseTextLineHeightV', 'baseTextLetterSpacingH', 'baseTextLetterSpacingV',
    'rubyFontSize', 'rubyOffset', 'spreadBorderColor', 'spreadBorderWidth', 'wrapMode',
    'hoverBgColor', 'caretColor', 'caretWidth', 'dragSelectColor', 'selectionColor',
    'selectionTextColor', 'dropIndicatorColor', 'dropIndicatorWidth', 'themeId',
    '__themeName', '__themeSourceId', '__useOsAccentColor',
    '--theme-palette-0', '--theme-palette-1', '--theme-palette-2', '--theme-palette-3',
    '--theme-palette-4', '--theme-palette-5', '--theme-palette-6', '--theme-palette-7',
    '--theme-palette-8', '--theme-palette-9',
  ];

  function initActiveEditorBridge() {
    window._sn2GetActiveEditor = function () {
      const ed = app.component?._editor;
      return ed?.doc ? ed : null;
    };
    window._getScriptNoteEditorForFileStyle = window._sn2GetActiveEditor;
    window._SCRIPTNOTE_FILE_STYLE_DEFAULTS = window._SCRIPTNOTE_FILE_STYLE_DEFAULTS || { wrapMode: true };
    window._isScriptnoteFileStyleKey = window._isScriptnoteFileStyleKey || function (key) {
      const value = String(key || '').trim();
      return SN2_FILE_STYLE_KEYS.includes(value) || value.startsWith('--') || /^__[A-Za-z0-9_-]+$/.test(value);
    };
    window._filterScriptnoteFileStyle = window._filterScriptnoteFileStyle || function (style) {
      if (!style || typeof style !== 'object' || Array.isArray(style)) return {};
      const next = {};
      Object.entries(style).forEach(([key, value]) => {
        if (!window._isScriptnoteFileStyleKey(key)) return;
        if (value === undefined || value === null || value === '') return;
        next[key] = value;
      });
      return next;
    };
  }

  async function exportPng() {
    if (typeof MeldexExportImage === 'undefined') {
      showStatus('PNG出力エンジンを読み込めませんでした', true);
      return;
    }
    await MeldexExportImage.exportCurrentView('scriptnote');
  }

  async function exportHtml() {
    if (typeof exportCurrentScriptNoteAsHtml !== 'function') {
      showStatus('HTML出力エンジンを読み込めませんでした', true);
      return;
    }
    await exportCurrentScriptNoteAsHtml();
  }

  async function exportMarkdown() {
    if (typeof exportCurrentScriptNoteAsMarkdown !== 'function') {
      showStatus('Markdown出力エンジンを読み込めませんでした', true);
      return;
    }
    await exportCurrentScriptNoteAsMarkdown();
  }

  async function sendToClipStudio() {
    if (typeof sn2CopyForClipStudio !== 'function') {
      showStatus('CLIP STUDIO連携を読み込めませんでした', true);
      return;
    }
    sn2CopyForClipStudio();
  }

  // CLIP STUDIO送信はデスクトップ前提の機能のため、Cloud/PWA版では非表示にする
  // （要判断#3の決定）。
  function updateClipStudioMenuVisibility() {
    const item = qs('scenario-menu-clipstudio');
    if (!item) return;
    const isCloud = window.MeldexStandaloneCloud?.isCloudMode?.() === true;
    item.hidden = isCloud;
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

  async function initLocalDrafts() {
    if (!window.MeldexStandaloneLocalDrafts) return;
    localDrafts = window.MeldexStandaloneLocalDrafts.create({
      appId: 'scenario',
      getPath: () => app.path,
      capture: () => ({
        title: qs('scenario-title-label')?.value || '新規シナリオ',
        content: collectJson(),
      }),
      restore: snapshot => {
        const parsed = JSON.parse(snapshot?.content || '{}');
        loadParsed(parsed, app.path);
        qs('scenario-title-label').value = snapshot?.title || parsed.title || titleFromPath(app.path);
        setDirty(true);
      },
      sync: async (snapshot, record) => {
        const result = await MeldexStandaloneFS.writeText(record.remotePath, snapshot.content || '', {
          skip_if_missing: true,
        });
        if (result?.missing || result?.skipped || result?.queued) {
          throw new Error(result?.queued ? '接続後に再試行します' : '保存先が見つかりません');
        }
        editor()._dirty = false;
        setDirty(false);
      },
      onStatus: (status, message) => {
        const label = qs('scenario-sync-status');
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

  function mountComponent() {
    app.component = new ScriptNoteComponent('scenario-standalone-pane', 'scenario-standalone-tab');
    qs('scenario-root').appendChild(app.component.create());
    app.component.activate();
  }

  // スマホ幅（≤820px）で優先操作だけを常時表示し、残りを「その他」ボトムシートへ畳む
  // （計画書: standalone-mobile-toolbar_plan_2026-07-20.md §4）。
  // #se-toolbar は本体共用の gb-tool-scriptnote.js が生成するため、生成側は無改変のまま
  // ここから後付けで設定する（mountComponent() 完了後＝ #se-toolbar 生成後に呼ぶ）。
  function initMobileToolbar() {
    const toolbar = qs('se-toolbar');
    if (toolbar && !qs('scenario-count-columns-toggle')) {
      const button = document.createElement('button');
      button.id = 'scenario-count-columns-toggle';
      button.type = 'button';
      button.className = 'tb-icon-btn scenario-mobile-count-toggle';
      button.dataset.e2eId = 'scenario-count-columns-toggle';
      button.innerHTML = '<span class="ico ico-columns3" aria-hidden="true"></span>';
      const update = () => {
        const visible = editor()?.doc?.editor?.visibleStandardColumns?._gutter !== false
          || editor()?.doc?.editor?.visibleStandardColumns?._gutter2 !== false;
        button.setAttribute('aria-pressed', visible ? 'true' : 'false');
        button.title = visible ? 'ページとコマを隠す' : 'ページとコマを表示';
        button.setAttribute('aria-label', button.title);
      };
      button.addEventListener('click', () => {
        const ed = editor();
        if (!ed?.doc) return;
        ed.doc.editor ||= {};
        ed.doc.editor.visibleStandardColumns ||= {};
        const next = ed.doc.editor.visibleStandardColumns._gutter === false
          && ed.doc.editor.visibleStandardColumns._gutter2 === false;
        ed._pushUndo?.('ページ・コマ列の表示変更');
        ed.doc.editor.visibleStandardColumns._gutter = next;
        ed.doc.editor.visibleStandardColumns._gutter2 = next;
        ed._markDirty?.();
        ed._render?.();
        setDirty(true);
        update();
      });
      toolbar.insertBefore(button, toolbar.firstChild);
      update();
    }
    window.MeldexStandaloneMobileToolbar?.setup({
      toolbar: '#se-toolbar',
      priority: ['#scenario-count-columns-toggle', '[data-sn-action="undo"]', '[data-sn-action="redo"]', '#btn-horizontal', '#btn-vertical', '#btn-filter', '[data-sn-action="search"]'],
      keep: ['#title-input'],
      sheetTitle: 'その他',
    });
  }

  function initOptionPanel() {
    window.MeldexStandaloneOptionPanel?.init({
      storagePrefix: 'meldex-scenario',
      toggleButtonIds: ['scenario-option-panel-button'],
      defaultWidth: 360,
    });
  }

  function bindUi() {
    initActiveEditorBridge();
    mountComponent();
    initMobileToolbar();
    initOptionPanel();
    bindMenus();
    bindTitleEditing();
    bindShortcuts();
    bindDirtyObserver();
    bindPathChanges();
    updateClipStudioMenuVisibility();
  }

  async function initializeData() {
    await MeldexStandaloneFS.init();
    const initial = MeldexStandaloneFS.nativeInitialPath();
    if (!initial) await newScenario();
    else {
      try { await openPath(initial); }
      catch {
        await newScenario();
        showStatus('前回のシナリオを開けなかったため、新規シナリオで起動しました', true);
      }
    }
    await initLocalDrafts();
  }

  window.getActiveScriptNoteComponent = function () {
    return app.component;
  };

  document.addEventListener('DOMContentLoaded', () => {
    window.MeldexStandaloneBoot = window.MeldexStandaloneBootstrap.create({
      appId: 'scenario',
      bindUi,
      initialize: initializeData,
      onError: error => showStatus('シナリオの保存先へ接続できません: ' + (error.message || error) + '。操作すると再試行します。', true),
    });
    window.MeldexStandaloneBoot.start().catch(() => {});
  });
})();
