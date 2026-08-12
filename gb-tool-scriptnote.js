/* ==============================
   gb-tool-scriptnote.js: シナリオエディタ v2 (軽量段落ベース)
   シナリオエンジンに依存しない、Word方式の段落エディタ
   ============================== */

function _sn2IsFreshBlankDoc(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  return Array.isArray(parsed.rows) && parsed.rows.length === 0
    && Array.isArray(parsed.characters) && parsed.characters.length === 0
    && (!Array.isArray(parsed.scenarioTypes) || parsed.scenarioTypes.length === 0)
    && Array.isArray(parsed.notes) && parsed.notes.length === 0
    && !parsed?.source?.importedFrom;
}

function _sn2ExpandDefaultFileStyle(parsed) {
  if (!_sn2IsFreshBlankDoc(parsed)) return;
  if (typeof _getDefaultFileStyle !== 'function') return;
  const defaults = _getDefaultFileStyle('scriptnote');
  const style = (typeof _filterScriptnoteFileStyle === 'function')
    ? _filterScriptnoteFileStyle(defaults)
    : {};
  if (!Object.keys(style).length) return;
  const current = (typeof _filterScriptnoteFileStyle === 'function')
    ? _filterScriptnoteFileStyle(parsed.editor || {})
    : {};
  const hasExplicitStyle = Object.entries(current).some(([key, value]) => {
    if (key === 'wrapMode' && value === true) return false;
    return true;
  });
  if (hasExplicitStyle) return;
  parsed.editor = parsed.editor || {};
  Object.assign(parsed.editor, JSON.parse(JSON.stringify(style)));
}

const SN2_TEMPLATE_STORAGE_KEY = 'sn2-templates';
const SN2_TEMPLATE_ORDER_STORAGE_KEY = 'sn2-templates-order';
const SN2_FILTER_PRESETS_STORAGE_KEY = 'sn2-filter-presets';
const SN2_FILTER_PRESETS_ORDER_STORAGE_KEY = 'sn2-filter-presets-order';
const SN2_TOOL_STORAGE_HISTORY_SCOPE = 'settings:scriptnote';

function _snToolStorageHistoryKeys(keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  return [...new Set(list.filter(Boolean))];
}

function _snToolCaptureStorageHistory(keys) {
  if (typeof captureLocalStorageSettings !== 'function') return null;
  if (typeof isLocalStorageSettingsHistorySuppressed === 'function'
    && isLocalStorageSettingsHistorySuppressed()) return null;
  return captureLocalStorageSettings(_snToolStorageHistoryKeys(keys));
}

function _snToolStorageHistoryDetail(keys) {
  const labels = {
    [SN2_TEMPLATE_STORAGE_KEY]: 'テンプレート',
    [SN2_TEMPLATE_ORDER_STORAGE_KEY]: 'テンプレートの並び順',
    [SN2_FILTER_PRESETS_STORAGE_KEY]: 'フィルタプリセット',
    [SN2_FILTER_PRESETS_ORDER_STORAGE_KEY]: 'フィルタプリセットの並び順',
  };
  return _snToolStorageHistoryKeys(keys).map(key => labels[key] || key).join(' / ');
}

function _snToolRefreshStorageAfterHistory(keys) {
  const changed = new Set(_snToolStorageHistoryKeys(keys));
  if (typeof forEachComponent !== 'function') return;
  forEachComponent(component => {
    if (!component || typeof component._refreshTemplateSelect !== 'function') return;
    const templateChanged = changed.has(SN2_TEMPLATE_STORAGE_KEY) || changed.has(SN2_TEMPLATE_ORDER_STORAGE_KEY);
    const filterChanged = changed.has(SN2_FILTER_PRESETS_STORAGE_KEY) || changed.has(SN2_FILTER_PRESETS_ORDER_STORAGE_KEY);
    if (templateChanged) component._refreshTemplateSelect();
    if (filterChanged && typeof component._refreshFilterPresets === 'function') {
      component._refreshFilterPresets();
    }
  });
}

function _snToolPushStorageHistory(label, beforeSnapshot, keys, detail) {
  if (!beforeSnapshot || typeof historyPush !== 'function'
    || typeof captureLocalStorageSettings !== 'function'
    || typeof restoreLocalStorageSettings !== 'function'
    || typeof _normalizeLocalStorageSettingsSnapshots !== 'function') return false;
  const keyList = _snToolStorageHistoryKeys(keys);
  const snapshots = _normalizeLocalStorageSettingsSnapshots(beforeSnapshot, captureLocalStorageSettings(keyList));
  let beforeKey = '';
  let afterKey = '';
  try {
    beforeKey = JSON.stringify(snapshots.before);
    afterKey = JSON.stringify(snapshots.after);
  } catch {}
  if (beforeKey && beforeKey === afterKey) return false;
  historyPush(
    label || 'シナリオ: プリセット変更',
    () => restoreLocalStorageSettings(snapshots.before, _snToolRefreshStorageAfterHistory),
    () => restoreLocalStorageSettings(snapshots.after, _snToolRefreshStorageAfterHistory),
    SN2_TOOL_STORAGE_HISTORY_SCOPE,
    detail || _snToolStorageHistoryDetail(keyList)
  );
  return true;
}

function _snToolReadJsonObject(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function _snToolReadJsonArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item) : [];
  } catch { return []; }
}

function _snToolPresetNames(storageKey, orderKey) {
  const data = _snToolReadJsonObject(storageKey);
  const keys = Object.keys(data);
  const ordered = _snToolReadJsonArray(orderKey).filter(name => Object.prototype.hasOwnProperty.call(data, name));
  return [...ordered, ...keys.filter(name => !ordered.includes(name))];
}

function _snToolFilteredPresetOrder(names, data) {
  const seen = new Set();
  return names.filter(name => typeof name === 'string' && name
    && (!data || Object.prototype.hasOwnProperty.call(data, name))
    && !seen.has(name) && seen.add(name));
}

function _snToolWriteStorageAtomically(entries) {
  const changes = entries.map(([key, value]) => ({ key, value: String(value), before: localStorage.getItem(key) }));
  const written = [];
  try {
    changes.forEach(change => {
      localStorage.setItem(change.key, change.value);
      written.push(change);
    });
  } catch (error) {
    for (let index = written.length - 1; index >= 0; index--) {
      const change = written[index];
      try {
        if (change.before === null) localStorage.removeItem(change.key);
        else localStorage.setItem(change.key, change.before);
      } catch (rollbackError) {
        console.error(`プリセット設定 ${change.key} のロールバックに失敗しました:`, rollbackError);
      }
    }
    throw error;
  }
}

function _snToolWritePresetOrder(orderKey, names, data) {
  localStorage.setItem(orderKey, JSON.stringify(_snToolFilteredPresetOrder(names, data)));
}

function _snToolClone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function _snToolUniquePresetName(base, names) {
  const existing = new Set(names);
  let name = `${base || 'プリセット'} のコピー`;
  let index = 2;
  while (existing.has(name)) name = `${base || 'プリセット'} のコピー${index++}`;
  return name;
}

class ScriptNoteComponent extends ToolComponent {
  constructor(paneId, tabId) {
    super(paneId, tabId);
    this._editor = null;
    this._toolbarBound = false;
  }

  create() {
    this.el = document.createElement('div');
    this.el.className = 'gb-se-root gb-scriptnote-root';
    this.el.innerHTML = ScriptNoteComponent._buildHTML();
    // SEP WebSocket の参照カウントを増やす（最初のコンポーネントで接続開始）
    if (typeof _sn2SepAcquire === 'function') _sn2SepAcquire();
    return this.el;
  }

  static _buildHTML() {
    return `
<div id="se-toolbar" class="gb-toolbar">
  <button type="button" class="tb-icon-btn tool-menu-btn" title="メニュー" aria-label="メニュー" data-action="showToolMenu(event,'scriptnote')"><span class="ico ico-menu"></span></button>
  <button type="button" class="tb-icon-btn" title="フォルダツリーで表示" aria-label="フォルダツリーで表示" data-action="revealCurrentInFolderTree('scriptnote', event)"><span class="ico ico-folderTree"></span></button>
  <input id="title-input" class="title-input tb-file-title tb-file-title--input" placeholder="シナリオタイトル" aria-label="シナリオタイトル" value="">
  <select id="scenario-note-layout-select" class="tb-select sn2-toolbar-layout-select" title="テンプレート" aria-label="テンプレート">
    <option value="manga">マンガシナリオ</option>
    <option value="drama">ドラマ・映画シナリオ</option>
    <option value="afureko">アフレコシナリオ</option>
    <option value="stage">舞台シナリオ</option>
  </select>
  <button type="button" class="tb-icon-btn" data-sn-action="saveTemplate" title="現在の設定をテンプレートとして登録" aria-label="現在の設定をテンプレートとして登録"><span class="ico ico-save"></span></button>
  <button type="button" class="tb-icon-btn" data-sn-action="manageTemplates" title="テンプレートを管理" aria-label="テンプレートを管理"><span class="ico ico-listChecks"></span></button>
  <div class="sep"></div>
  <button type="button" class="tb-icon-btn" data-sn-action="undo" title="元に戻す (Ctrl+Z)" aria-label="元に戻す" data-undo-button><span class="ico ico-undo2"></span></button>
  <button type="button" class="tb-icon-btn" data-sn-action="redo" title="やり直し (Ctrl+Y)" aria-label="やり直し" data-redo-button><span class="ico ico-redo2"></span></button>
  <div class="sep"></div>
  <button type="button" class="tb-icon-btn active" data-sn-action="horizontal" id="btn-horizontal" title="横書き" aria-label="横書き"><span class="ico ico-textAlignStart"></span></button>
  <button type="button" class="tb-icon-btn" data-sn-action="vertical" id="btn-vertical" title="縦書き" aria-label="縦書き"><span class="ico ico-kanban"></span></button>
  <button type="button" class="tb-icon-btn" data-sn-action="wrap" id="btn-wrap" title="折返し" aria-label="折返し"><span class="ico ico-wrapText"></span></button>
  <button type="button" class="tb-icon-btn" data-sn-action="mergeDisplay" id="btn-merge-display" title="前行と同じタイプ/ガター値を省略表示（まとめて表示）" aria-label="まとめ表示"><span class="ico ico-rows3"></span></button>
  <div class="sep"></div>
  <button type="button" class="tb-text-btn" data-sn-action="addColumn" title="列を追加"><span class="ico ico-plus"></span>列</button>
  <div class="tb-spacer"></div>
  <button type="button" class="tb-icon-btn" data-sn-action="filter" id="btn-filter" title="タイプ/採用状況でフィルタ" aria-label="タイプ/採用状況でフィルタ"><span class="ico ico-funnel"></span></button>
  <select id="sn-filter-preset" class="tb-select sn2-toolbar-filter-preset" title="フィルタプリセット" aria-label="フィルタプリセット"><option value="__all__">すべて表示</option></select>
  <div class="sep"></div>
  <button type="button" class="tb-icon-btn" data-sn-action="saveFilter" title="現在のフィルタを登録" aria-label="現在のフィルタを登録"><span class="ico ico-save"></span></button>
  <button type="button" class="tb-icon-btn" data-sn-action="manageFilters" title="フィルタプリセットを管理" aria-label="フィルタプリセットを管理"><span class="ico ico-listChecks"></span></button>
  <button type="button" class="tb-icon-btn" data-sn-action="reload" title="ファイルを再読み込み" aria-label="ファイルを再読み込み"><span class="ico ico-refreshCw"></span></button>
  <button type="button" class="tb-icon-btn" data-sn-action="search" title="テキスト列を検索・置換" aria-label="テキスト列を検索・置換"><span class="ico ico-search"></span></button>
  <button type="button" class="tb-icon-btn gb-toolbar-option-panel-btn" data-sn-action="detail" id="btn-detail" title="オプションを開く" aria-label="オプションを開く"><span class="ico ico-slidersHorizontal"></span></button>
</div>
<div class="sn2-main" style="display:flex;flex:1;overflow:hidden;min-height:0;">
  <div id="scenario-note-surface" style="display:flex;flex:1;overflow:hidden;"></div>
</div>`;
  }

  activate() {
    super.activate();
    this._bindToolbar();
    const paneInfo = (typeof GBLayout !== 'undefined')
      ? GBLayout.findNode?.(GBLayout.root, this.paneId)
      : null;
    const ownTab = paneInfo?.node?.tabs?.find?.(tab => tab.id === this.tabId)
      || paneInfo?.node?.tabs?.[paneInfo?.node?.activeTabIndex]
      || null;
    if (ownTab?.type === 'scriptnote') {
      this.state.scenarioPath = ownTab.state?.scenarioPath || ownTab.path || this.state.scenarioPath || '';
      this.state.label = ownTab.state?.label || ownTab.label || this.state.label || '';
    }
    const isPaneActive = this.paneId === (typeof GBLayout !== 'undefined' ? GBLayout.activePane : this.paneId);
    // ヒストリースコープ設定
    if (this._editor?._path && typeof historySetScope === 'function') {
      historySetScope(this._editor._historyScope());
    }
    if (this.state.scenarioPath) {
      if (!this._editor?.doc || this._editor?._path !== this.state.scenarioPath) {
        const passiveLoadOpts = {
          bridgeLoad: true,
          skipNavPush: true,
          skipRecent: true,
          skipAutoVersion: true,
          skipSaveLastView: true,
          silent: true,
          skipStatus: true,
        };
        this._loadScenario(this.state.scenarioPath, isPaneActive ? {} : passiveLoadOpts);
        return;
      }
    } else if (!this._editor?.doc) {
      // scenarioPath が空でも、単独版の「新規シナリオ」等で既にドキュメントが
      // メモリ上にロード済みの場合は空状態で上書きしない（未保存の新規文書を保持する）。
      this._renderEmptyState();
    }
    // 詳細パネルをシナリオエディタ用に切り替え（非アクティブペインではスキップ）
    if (this._skipDetailSync !== true && this._editor) this._syncDetailPanel();
  }

  deactivate() {
    super.deactivate();
    if (this._editor) this._editor.flush();
    // 注: 詳細パネルのタブはdeactivate時に消さない（別ペインからの操作を可能にする）
    // destroy()時のみ_restoreDetailPanel()を呼ぶ
  }

  destroy() {
    if (this._editor) { this._editor.flush(); this._editor.destroy(); this._editor = null; }
    this._restoreDetailPanel();
    // SEP WebSocket の参照カウントを減らす（最後のコンポーネント破棄で WS を閉じる）
    if (typeof _sn2SepRelease === 'function') _sn2SepRelease();
    super.destroy();
  }

  // 遷移前flush契約（計画書「閲覧・編集・保存」節）。gb-subpanel.js /
  // gb-subpanel.js が対象置換・戻る/進む・閉じる・メインパネル昇格の前に
  // getComponentInstance(tabId).flush() として汎用的に呼び出す。保留中の
  // 自動保存タイマーを即座に実行し、保存の成否(true/false)を返す。
  // 実体は ScriptNoteEditor.prototype.flush()（DOM同期→dirtyならsave()）で、
  // 保存共通契約(gb-document-save-coordinator.js)経由の保存キューに乗る。
  async flush() {
    if (!this._editor) return true;
    return this._editor.flush();
  }

  handleKeyDown(e) {
    // 軽量エディタはブラウザデフォルト動作を活用するため、ここでは何もしない
    return false;
  }

  restoreState(s) {
    super.restoreState(s);
    if (!s) return;
    this.state.scenarioPath = s.scenarioPath || '';
    this.state.label = s.label || '';
    this.state.noteLayoutMode = s.noteLayoutMode || '';
  }

  getState() {
    // getState は _beforeRender から呼ばれるため、保存は行わずDOM同期のみ
    if (this._editor) this._editor._syncAllFromDom();
    return {
      scenarioPath: this.state.scenarioPath || '',
      label: this.state.label || '',
      noteLayoutMode: this._editor?.doc?.layoutMode || this.state.noteLayoutMode || '',
    };
  }

  _hasLoadedScenarioPath(path) {
    return !!(path && this._editor?.doc && this._editor._path === path);
  }

  _hasRenderedScriptNoteDom() {
    const host = this.el?.querySelector?.('#scenario-note-surface') || null;
    return !!host?.querySelector?.('.sn2-editor');
  }

  _renderEmptyState() {
    const host = this.el?.querySelector('#scenario-note-surface');
    if (!host) return;
    host.innerHTML = `
      <div class="sn2-scroll" style="display:flex;flex:1;align-items:center;justify-content:center;">
        <div style="max-width:420px;padding:24px 28px;border:1px solid var(--border);border-radius:10px;background:var(--bg2);color:var(--fg2);line-height:1.7;">
          <div style="font-size:16px;font-weight:700;color:var(--fg);margin-bottom:8px;">シナリオファイル未読込</div>
          <div style="font-size:13px;">左上のメニューから「開く...」を実行してください。</div>
        </div>
      </div>`;
  }

  _syncDetailPanel() {
    // タブシェルが未生成の場合は確保する（初回起動時の保険）
    const rpDetail = document.getElementById('rp-detail');
    if (rpDetail && typeof _ensureDetailTabShell === 'function') _ensureDetailTabShell(rpDetail);
    const container = document.getElementById('detail-tab-sn2-main');
    if (!container) return;
    if (this._editor) window._detailScriptNoteTabId = this.tabId;
    // 他エディタのタブを非表示
    if (typeof showBoardTabs === 'function') showBoardTabs(false);
    if (typeof showCalendarDetailTabs === 'function') showCalendarDetailTabs(false);
    if (typeof showNoteTabs === 'function') showNoteTabs(false);
    if (typeof showFileInfoTab === 'function') showFileInfoTab(true);
    const scenarioPath = this._editor?._path || this.state.scenarioPath || '';
    if (scenarioPath && typeof renderFileInfoDetailTab === 'function') {
      void renderFileInfoDetailTab(scenarioPath, null, { type: 'scriptnote', typeLabel: 'シナリオ' });
    }
    if (typeof showDbTabs === 'function') showDbTabs(false);
    if (typeof showPublishDetailTab === 'function') showPublishDetailTab(false);
    if (typeof showFileStyleTab === 'function') showFileStyleTab(true);
    if (typeof renderFileStyleTab === 'function') renderFileStyleTab('scriptnote');
    // シナリオ用タブを追加
    this._ensureScriptnoteDetailTabs();
    // シナリオ専用コンテナにシナリオパネルを描画
    if (this._editor) {
      let panel = container.querySelector('.sn2-detail-wrap');
      if (!panel) {
        panel = document.createElement('div');
        panel.className = 'sn2-detail-wrap';
        panel.style.cssText = 'flex:1;overflow:hidden;display:flex;flex-direction:column;';
        container.appendChild(panel);
      }
      panel.style.display = 'flex';
      const activeTab = this._editor._detailActiveTab || 'roles';
      if (activeTab === 'style') {
        if (typeof renderFileStyleTab === 'function') renderFileStyleTab('scriptnote');
      } else if (activeTab === 'ruby' && typeof this._editor.renderRubyPanel === 'function') {
        this._editor.renderRubyPanel(panel);
      } else if (activeTab === 'theme' && typeof this._editor.renderThemePanel === 'function') {
        this._editor.renderThemePanel(panel);
      } else if (activeTab === 'rowset' && typeof this._editor.renderRowsetPanel === 'function') {
        this._editor.renderRowsetPanel(panel);
      } else {
        this._editor.renderDetailPanel(panel);
      }
    }
    // シナリオのアクティブタブに切り替え
    const activeTab = this._editor?._detailActiveTab || 'roles';
    if (typeof switchDetailTab === 'function') switchDetailTab(activeTab === 'style' ? 'file-style' : 'sn2-' + activeTab);
  }

  _ensureScriptnoteDetailTabs() {
    const tabBar = document.getElementById('detail-tab-bar');
    if (!tabBar) return;
    tabBar.querySelectorAll('.detail-tab-scriptnote').forEach(el => el.remove());
    const styleTab = tabBar.querySelector('[data-detail-tab="file-style"]');
    if (styleTab && !styleTab.dataset.scriptnoteBound) {
      styleTab.dataset.scriptnoteBound = '1';
      styleTab.addEventListener('click', () => {
        if (!document.querySelector('.detail-tab-scriptnote')) return;
        const comp = (typeof getActiveScriptNoteComponent === 'function') ? getActiveScriptNoteComponent() : null;
        if (!comp?._editor || typeof comp._syncDetailPanel !== 'function') return;
        comp._editor._detailActiveTab = 'style';
        comp._syncDetailPanel();
      });
    }
    const tabs = [
      { id: 'sn2-roles', label: 'タイプ管理' },
      { id: '__style__', label: 'テーマ' },
      { id: 'sn2-theme', label: '表示' },
      { id: 'sn2-ruby', label: 'ルビ' },
      { id: 'sn2-rowset', label: '行セット' },
    ];
    tabs.forEach(t => {
      if (t.id === '__style__') {
        if (styleTab) tabBar.appendChild(styleTab);
        return;
      }
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'gb-inner-tab detail-tab detail-tab-scriptnote';
      el.dataset.detailTab = t.id;
      el.setAttribute('role', 'tab');
      el.setAttribute('aria-selected', 'false');
      el.textContent = t.label;
      el.dataset.action = `switchDetailTab('${t.id}')`;
      el.addEventListener('click', () => {
        const comp = (typeof getActiveScriptNoteComponent === 'function') ? getActiveScriptNoteComponent() : this;
        if (!comp?._editor || typeof comp._syncDetailPanel !== 'function') return;
        comp._editor._detailActiveTab = t.id === 'sn2-ruby' ? 'ruby' : t.id === 'sn2-theme' ? 'theme' : t.id === 'sn2-rowset' ? 'rowset' : 'roles';
        comp._syncDetailPanel();
      });
      tabBar.appendChild(el);
    });
  }

  _hideScriptnoteDetailTabs() {
    document.querySelectorAll('.detail-tab-scriptnote').forEach(el => el.remove());
  }

  _restoreDetailPanel() {
    const ownsDetail = window._detailScriptNoteTabId === this.tabId;
    if (!ownsDetail) return;
    this._hideScriptnoteDetailTabs();
    if (ownsDetail) window._detailScriptNoteTabId = '';
    if (ownsDetail && typeof showFileStyleTab === 'function') showFileStyleTab(false);
    const container = document.getElementById('detail-tab-sn2-main');
    if (!container) return;
    const wrap = container.querySelector('.sn2-detail-wrap');
    if (wrap) wrap.remove();
    container.style.display = 'none';
  }

  _openDetailPanel() {
    // 詳細パネルが閉じている場合のみ開く（toggleで閉じてしまうのを防ぐ）
    let isHidden = true;
    try {
      const cfg = JSON.parse(localStorage.getItem('detail-panel-cfg') || '{}');
      isHidden = !cfg.visible;
    } catch (e) {}
    const rpDetail = document.getElementById('rp-detail');
    const paneContent = rpDetail?.closest?.('.gb-pane-content') || null;
    const paneRect = paneContent?.getBoundingClientRect?.() || null;
    const paneStyle = paneContent && window.getComputedStyle ? getComputedStyle(paneContent) : null;
    const hasVisibleDetailPane = !!(paneContent
      && paneRect
      && paneRect.width > 0
      && paneRect.height > 0
      && paneStyle?.display !== 'none'
      && paneStyle?.visibility !== 'hidden');
    if (isHidden || !hasVisibleDetailPane) {
      try {
        const cfg = JSON.parse(localStorage.getItem('detail-panel-cfg') || '{}');
        cfg.visible = true;
        localStorage.setItem('detail-panel-cfg', JSON.stringify(cfg));
      } catch (e) {}
      if (typeof openRightPanelTab === 'function') openRightPanelTab('detail', this.paneId);
      else if (typeof toggleOptionPanel === 'function') toggleOptionPanel();
      else if (typeof toggleDetailPanel === 'function') toggleDetailPanel();
    }
    this._syncDetailPanel();
  }

  _refreshTemplateSelect() {
    const sel = this.el?.querySelector('#scenario-note-layout-select');
    if (!sel) return;
    // 既存のカスタムオプションを除去
    sel.querySelectorAll('option[value^="custom:"]').forEach(o => o.remove());
    _snToolPresetNames(SN2_TEMPLATE_STORAGE_KEY, SN2_TEMPLATE_ORDER_STORAGE_KEY).forEach(name => {
      const opt = document.createElement('option');
      opt.value = 'custom:' + name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    // 現在のlayoutModeに合わせて選択
    if (this._editor?.doc?.layoutMode) sel.value = this._editor.doc.layoutMode;
  }

  _showTitleRenameModal() {
    const titleInput = this.el?.querySelector('#title-input');
    if (!titleInput || !this._editor?.doc) {
      if (typeof showStatus === 'function') showStatus('タイトルを変更できませんでした', true);
      return false;
    }
    this._showNameModal({
      title: 'タイトルを変更',
      label: 'タイトル',
      placeholder: 'シナリオタイトル',
      value: titleInput.value || this._editor.doc.title || '',
      okText: '変更',
      onSubmit: name => {
        titleInput.value = name;
        titleInput.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      },
    });
    return true;
  }

  _showToolbarSelectModal({ sourceSelector, title, label, okText = '適用', dialog = 'toolbar-select' }) {
    const source = this.el?.querySelector(sourceSelector);
    if (!source) {
      if (typeof showStatus === 'function') showStatus(`${label || '項目'}を選択できませんでした`, true);
      return false;
    }
    const owner = document.activeElement;
    const selectId = `sn2-${dialog}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-select`;
    const options = [...source.options].map(opt => (
      `<option value="${esc(opt.value)}">${esc(opt.textContent || opt.label || opt.value)}</option>`
    )).join('');
    const content = document.createElement('div');
    content.innerHTML = `<label class="sn2-preset-field" for="${selectId}"><span class="sn2-preset-label">${esc(label)}</span><select id="${selectId}" class="gb-select sn2-toolbar-modal-select">${options}</select></label>`;
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button'; cancelButton.className = 'gb-btn gb-btn-sm cancel-btn'; cancelButton.textContent = 'キャンセル';
    const okButton = document.createElement('button');
    okButton.type = 'button'; okButton.className = 'gb-btn gb-btn-sm gb-btn-primary primary ok-btn'; okButton.textContent = okText;
    const modalApi = window.GBUI.createModal({
      id: 'scriptnote-toolbar-select', title, body: [...content.childNodes], footer: [cancelButton, okButton],
      variant: 'standard', geometryKey: 'scriptnote-toolbar-select', minWidth: '0', initialFocus: '.sn2-toolbar-modal-select',
      returnFocus: owner, closeLabel: `${title}を閉じる`, closeOnEsc: true, closeOnOverlay: true,
    });
    const overlay = modalApi.overlay;
    const panel = modalApi.modal;
    overlay.dataset.sn2Dialog = dialog;
    overlay.dataset.e2eId = 'scriptnote-toolbar-select-overlay';
    panel.dataset.e2eId = 'scriptnote-toolbar-select-dialog';
    panel.classList.add('sn2-preset-modal', 'sn2-toolbar-select-modal');
    modalApi.body.classList.add('sn2-preset-modal-body');
    modalApi.footer.classList.add('sn2-preset-modal-actions');
    const select = panel.querySelector('.sn2-toolbar-modal-select');
    if (select) select.value = source.value;
    const apply = () => {
      if (!select) return;
      source.value = select.value;
      source.dispatchEvent(new Event('change', { bubbles: true }));
      modalApi.close('apply');
    };
    cancelButton.addEventListener('click', () => modalApi.close('cancel'));
    okButton.addEventListener('click', apply);
    modalApi.open();
    return true;
  }

  _showTemplateSelectModal() {
    this._refreshTemplateSelect();
    return this._showToolbarSelectModal({
      sourceSelector: '#scenario-note-layout-select',
      title: 'テンプレート選択',
      label: 'テンプレート',
      dialog: 'toolbar-template-select',
    });
  }

  _showFilterPresetSelectModal() {
    this._refreshFilterPresets();
    return this._showToolbarSelectModal({
      sourceSelector: '#sn-filter-preset',
      title: 'フィルタプリセット',
      label: 'フィルタプリセット',
      dialog: 'toolbar-filter-preset',
    });
  }

  _bindToolbar() {
    if (this._toolbarBound || !this.el) return;
    this._toolbarBound = true;
    this.el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-sn-action]');
      if (!btn) return;
      const action = btn.dataset.snAction;
      if (action === 'detail') { this._openDetailPanel(); return; }
      if (action === 'undo') { if (this._editor) this._editor.undo(); return; }
      if (action === 'redo') { if (this._editor) this._editor.redo(); return; }
      if (action === 'horizontal' || action === 'vertical') {
        if (!this._editor?.doc) return;
        this._editor._pushUndo('表示方向変更');
        if (typeof MeldexRubyPresentation !== 'undefined' && typeof MeldexRubyPresentation.updateDocument === 'function') {
          MeldexRubyPresentation.updateDocument(this._editor.doc, { writingMode: action });
        } else {
          this._editor.doc.editor.viewMode = action;
          if (this._editor.doc.rubyPresentation && typeof this._editor.doc.rubyPresentation === 'object') {
            this._editor.doc.rubyPresentation.writingMode = action;
          }
        }
        this._editor._render();
        this._editor._markDirty();
        this.el.querySelector('#btn-horizontal')?.classList.toggle('active', action === 'horizontal');
        this.el.querySelector('#btn-vertical')?.classList.toggle('active', action === 'vertical');
        return;
      }
      if (action === 'wrap') {
        if (!this._editor?.doc) return;
        this._editor._pushUndo('折り返し切替');
        this._editor.doc.editor.wrapMode = !this._editor.doc.editor.wrapMode;
        btn.classList.toggle('active', !!this._editor.doc.editor.wrapMode);
        this._editor._render();
        this._editor._markDirty();
        return;
      }
      if (action === 'mergeDisplay') {
        if (!this._editor?.doc) return;
        if (!this._editor.doc.editor) this._editor.doc.editor = {};
        this._editor._pushUndo('まとめ表示切替');
        this._editor.doc.editor.mergeDisplay = !this._editor.doc.editor.mergeDisplay;
        btn.classList.toggle('active', !!this._editor.doc.editor.mergeDisplay);
        this._editor._render();
        this._editor._markDirty();
        // 詳細パネルのテーマタブチェックボックスも同期
        const detailCb = document.querySelector('input[data-setting="mergeDisplay"]');
        if (detailCb) detailCb.checked = !!this._editor.doc.editor.mergeDisplay;
        return;
      }
      if (action === 'addColumn') {
        if (!this._editor) return;
        this._editor._addCustomColumn();
        return;
      }
      if (action === 'filter') {
        if (!this._editor) return;
        this._editor._showFilterMenu(btn);
        return;
      }
      if (action === 'search') {
        if (!this._editor) return;
        this._editor._showSearchReplacePopup?.(btn);
        return;
      }
      if (action === 'reload') {
        if (!this._editor?._path) return;
        const savedDetailTab = this._editor._detailActiveTab;
        const reloadPath = this._editor._path;
        (async () => {
          const coordinator = window.MeldexDocumentSaveCoordinator;
          const documentKey = coordinator?.documentKeyForPath?.(reloadPath) || reloadPath;
          if (coordinator?.isConflictPending?.(documentKey)) {
            await this._editor._reviewConflict?.(reloadPath, documentKey);
            return;
          }
          if (this._editor?._saveTimer) {
            clearTimeout(this._editor._saveTimer);
            this._editor._saveTimer = null;
          }
          if (this._editor?._dirty && typeof this._editor.save === 'function') {
            const saved = await this._editor.save();
            if (!saved || this._editor?._dirty) {
              showStatus('未保存の変更があるため再読込を中止しました', true);
              return;
            }
          }
          await this._loadScenario(reloadPath, { skipNavPush: true, skipRecent: true, skipAutoVersion: true });
          if (savedDetailTab && this._editor) this._editor._detailActiveTab = savedDetailTab;
        })();
        return;
      }
      if (action === 'saveFilter') {
        this._addFilterPreset({ allowOverwrite: true });
        return;
      }
      if (action === 'manageFilters') {
        this._showPresetManager('filter');
        return;
      }
      if (action === 'saveTemplate') {
        this._addTemplatePreset({ allowOverwrite: true });
        return;
      }
      if (action === 'manageTemplates') {
        this._showPresetManager('template');
        return;
      }
    });
    const noteLayoutSel = this.el.querySelector('#scenario-note-layout-select');
    if (noteLayoutSel) {
      this._refreshTemplateSelect();
      noteLayoutSel.addEventListener('change', () => {
        const val = noteLayoutSel.value;
        this.state.noteLayoutMode = val;
        if (!this._editor?.doc) return;
        this._editor._pushUndo('レイアウト変更');
        if (val.startsWith('custom:')) {
          // カスタムテンプレート適用
          try {
            const templates = _snToolReadJsonObject(SN2_TEMPLATE_STORAGE_KEY);
            const tpl = templates[val.slice(7)];
            if (tpl) {
              const result = globalThis.GBScriptNoteRoleModel?.applyTemplate
                ? globalThis.GBScriptNoteRoleModel.applyTemplate(this._editor.doc, tpl)
                : null;
              if (!result) {
                if (tpl.layoutMode) this._editor.doc.layoutMode = tpl.layoutMode;
                if (tpl.editor) Object.assign(this._editor.doc.editor, JSON.parse(JSON.stringify(tpl.editor)));
                if (tpl.rubyPresentation && typeof tpl.rubyPresentation === 'object') {
                  this._editor.doc.rubyPresentation = JSON.parse(JSON.stringify(tpl.rubyPresentation));
                }
              }
              if (typeof showStatus === 'function' && result?.message) showStatus(result.message);
            }
          } catch {}
        } else {
          this._editor.doc.layoutMode = val;
          if (this._editor.doc.editor?.countConfig) delete this._editor.doc.editor.countConfig;
        }
        this._editor._calcCache = null;
        this._editor._render();
        this._editor._markDirty();
        this._syncDetailPanel();
      });
    }
    const titleInput = this.el.querySelector('#title-input');
    if (titleInput) titleInput.addEventListener('change', async () => {
      if (this._editor?.doc) {
        this._editor._pushUndo('タイトル変更');
        this._editor.doc.title = titleInput.value;
        this._editor._markDirty();
        // タイトル変更をファイル名にも反映
        const newTitle = titleInput.value.trim();
        const oldPath = this._editor._path;
        if (newTitle && oldPath) {
          try {
            const res = await apiPost('/outliner/rename', { old_path: oldPath, new_name: newTitle, type: 'scriptnote' });
            if (res?.new_path) {
              // エディタのパスとレジストリを更新
              if (typeof _sn2Editors !== 'undefined') {
                delete _sn2Editors[oldPath];
                _sn2Editors[res.new_path] = this._editor;
                if (this._editor._historyScopeId) _sn2Editors[this._editor._historyScopeId] = this._editor;
              }
              this._editor._path = res.new_path;
              this.state.scenarioPath = res.new_path;
              window.dispatchEvent(new CustomEvent('meldex:file-path-renamed', {
                detail: { oldPath, newPath: res.new_path, type: 'scriptnote' },
              }));
              window.MeldexFileLockBadge?.apply?.(titleInput, res.new_path);
              if (typeof renameAppPathReferences === 'function') {
                renameAppPathReferences(oldPath, res.new_path, { label: newTitle, fileId: res.file_id, type: 'scriptnote' });
              }
              // タブ名を更新
              if (typeof GBTabs !== 'undefined' && this.tabId) GBTabs.setTabLabel?.(this.tabId, newTitle);
              // フォルダツリーのノード名を更新
              if (typeof _renameTreeNode === 'function') _renameTreeNode(oldPath, res.new_path, newTitle, res.file_id);
            }
          } catch (e) {
            // リネーム失敗はタイトル変更自体には影響させない（保存時にファイル名は旧名のまま）
            if (typeof showStatus === 'function') showStatus('ファイル名の変更に失敗: ' + (e.message || e), true);
          }
        }
      }
    });
    // フィルタプリセットのドロップダウン
    const filterPresetSel = this.el.querySelector('#sn-filter-preset');
    if (filterPresetSel) {
      this._refreshFilterPresets();
      filterPresetSel.addEventListener('change', () => {
        const val = filterPresetSel.value;
        if (!this._editor) { filterPresetSel.value = '__all__'; return; }
        if (val === '__all__') {
          // フィルタ解除（すべて表示）
          this._editor._filterRoles = null;
          this._editor._hideRoles = null;
          this._editor._filterStatuses = null;
          this._editor._hideStatuses = null;
          this._editor._render();
          this.el.querySelector('#btn-filter')?.classList.remove('active');
          this._activeFilterPreset = '__all__';
          filterPresetSel.value = '__all__';
          return;
        }
        const presets = _snToolReadJsonObject(SN2_FILTER_PRESETS_STORAGE_KEY);
        const preset = presets[val];
        if (preset) {
          // 新形式: { visible: [...]|null, hidden: [...] }、旧形式: [...] (whitelist のみ)
          if (Array.isArray(preset)) {
            this._editor._filterRoles = new Set(preset);
            this._editor._hideRoles = null;
            this._editor._filterStatuses = null;
            this._editor._hideStatuses = null;
          } else {
            this._editor._filterRoles = preset.visible ? new Set(preset.visible) : null;
            this._editor._hideRoles = (preset.hidden && preset.hidden.length) ? new Set(preset.hidden) : null;
            this._editor._filterStatuses = Object.prototype.hasOwnProperty.call(preset, 'visibleStatuses') && preset.visibleStatuses !== null
              ? new Set(preset.visibleStatuses || [])
              : null;
            this._editor._hideStatuses = (preset.hiddenStatuses && preset.hiddenStatuses.length) ? new Set(preset.hiddenStatuses) : null;
          }
          if (!this._editor.doc?.editor?.statusEnabled) {
            this._editor._filterStatuses = null;
            this._editor._hideStatuses = null;
          }
          this._editor._render();
          const hasAny = !!this._editor._filterRoles
            || !!(this._editor._hideRoles && this._editor._hideRoles.size)
            || (!!this._editor.doc?.editor?.statusEnabled && !!this._editor._filterStatuses)
            || (!!this._editor.doc?.editor?.statusEnabled && !!(this._editor._hideStatuses && this._editor._hideStatuses.size));
          this.el.querySelector('#btn-filter')?.classList.toggle('active', hasAny);
          this._activeFilterPreset = val;
          filterPresetSel.value = val; // 選択中のプリセット名を維持
        }
      });
    }
  }

  _showNameModal({ title, label, placeholder, value = '', okText = '登録', onSubmit, returnFocus, onClose }) {
    const owner = returnFocus || document.activeElement;
    const inputId = `sn2-preset-name-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-input`;
    const content = document.createElement('div');
    content.innerHTML = `<div class="sn2-preset-status" role="status" aria-live="polite"></div><label class="sn2-preset-field" for="${inputId}"><span class="sn2-preset-label">${esc(label)}</span><input id="${inputId}" type="text" class="gb-input sn2-preset-name" placeholder="${esc(placeholder || '')}" value="${esc(value)}"></label>`;
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button'; cancelButton.className = 'gb-btn gb-btn-sm cancel-btn'; cancelButton.textContent = 'キャンセル';
    const okButton = document.createElement('button');
    okButton.type = 'button'; okButton.className = 'gb-btn gb-btn-sm gb-btn-primary primary ok-btn'; okButton.textContent = okText;
    let busy = false;
    const modalApi = window.GBUI.createModal({
      id: 'scriptnote-name', title, body: [...content.childNodes], footer: [cancelButton, okButton],
      variant: 'standard', geometryKey: 'scriptnote-name', minWidth: '0', initialFocus: '.sn2-preset-name',
      returnFocus: owner, closeLabel: `${title}を閉じる`, closeOnEsc: true, closeOnOverlay: true,
      onBeforeClose: () => !busy,
      onClose: reason => onClose?.(reason),
    });
    const overlay = modalApi.overlay;
    const panel = modalApi.modal;
    overlay.dataset.sn2Dialog = 'preset-name';
    overlay.dataset.e2eId = 'scriptnote-name-overlay';
    panel.dataset.e2eId = 'scriptnote-name-dialog';
    panel.classList.add('sn2-preset-modal');
    modalApi.body.classList.add('sn2-preset-modal-body');
    modalApi.footer.classList.add('sn2-preset-modal-actions');
    const input = panel.querySelector('.sn2-preset-name');
    const status = panel.querySelector('.sn2-preset-status');
    const setBusy = next => {
      busy = next;
      panel.setAttribute('aria-busy', next ? 'true' : 'false');
      okButton.disabled = next;
      cancelButton.disabled = next;
    };
    const submit = async () => {
      if (busy) return;
      const name = input.value.trim();
      if (!name) return;
      setBusy(true);
      status.textContent = '';
      try {
        const accepted = await onSubmit?.(name);
        if (accepted === false) { setBusy(false); return; }
        setBusy(false);
        modalApi.close('submit');
      } catch (error) {
        console.error('プリセット名の保存に失敗しました:', error);
        status.textContent = '保存できませんでした。入力内容を保ったまま再試行できます。';
        if (typeof showStatus === 'function') showStatus('保存できませんでした。もう一度お試しください', true);
        setBusy(false);
      }
    };
    okButton.addEventListener('click', submit);
    cancelButton.addEventListener('click', () => modalApi.close('cancel'));
    input.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      submit();
    });
    modalApi.open();
    input.select();
    return true;
  }

  _managedPresetConfig(kind) {
    const template = kind === 'template';
    return {
      kind,
      storageKey: template ? SN2_TEMPLATE_STORAGE_KEY : SN2_FILTER_PRESETS_STORAGE_KEY,
      orderKey: template ? SN2_TEMPLATE_ORDER_STORAGE_KEY : SN2_FILTER_PRESETS_ORDER_STORAGE_KEY,
      title: template ? 'テンプレート管理' : 'フィルタプリセット管理',
      itemLabel: template ? 'テンプレート' : 'フィルタプリセット',
      emptyText: template ? '登録済みテンプレートはありません' : '登録済みフィルタプリセットはありません',
    };
  }

  _reservedPresetName(kind, name) {
    if (kind === 'template') return name.startsWith('custom:') || ['manga', 'drama', 'afureko', 'stage'].includes(name);
    return name === '__all__' || name === '__delete__' || name === '__custom__' || name === 'すべて表示';
  }

  _currentFilterPresetValue() {
    if (!this._editor) return null;
    const filterRoles = this._editor._filterRoles;
    const hideRoles = this._editor._hideRoles;
    const filterStatuses = this._editor._filterStatuses;
    const hideStatuses = this._editor._hideStatuses;
    const hasFilter = !!filterRoles;
    const hasHide = !!(hideRoles && hideRoles.size);
    const hasStatusFilter = !!filterStatuses;
    const hasStatusHide = !!(hideStatuses && hideStatuses.size);
    if (!hasFilter && !hasHide && !hasStatusFilter && !hasStatusHide) return null;
    return {
      visible: hasFilter ? [...filterRoles] : null,
      hidden: hasHide ? [...hideRoles] : [],
      visibleStatuses: hasStatusFilter ? [...filterStatuses] : null,
      hiddenStatuses: hasStatusHide ? [...hideStatuses] : [],
    };
  }

  _savePresetValue(kind, name, value, { allowOverwrite = false, label, onSaved } = {}) {
    const cfg = this._managedPresetConfig(kind);
    const data = _snToolReadJsonObject(cfg.storageKey);
    if (this._reservedPresetName(kind, name)) { if (typeof showStatus === 'function') showStatus('この名前は予約済みです', true); return false; }
    if (!allowOverwrite && Object.prototype.hasOwnProperty.call(data, name)) { if (typeof showStatus === 'function') showStatus('同じ名前がすでにあります', true); return false; }
    const beforeStorage = _snToolCaptureStorageHistory([cfg.storageKey, cfg.orderKey]);
    const order = _snToolPresetNames(cfg.storageKey, cfg.orderKey);
    data[name] = _snToolClone(value);
    if (!order.includes(name)) order.push(name);
    _snToolWriteStorageAtomically([
      [cfg.storageKey, JSON.stringify(data)],
      [cfg.orderKey, JSON.stringify(_snToolFilteredPresetOrder(order, data))],
    ]);
    _snToolPushStorageHistory(label, beforeStorage, [cfg.storageKey, cfg.orderKey], name);
    this._refreshManagedPresetUi(kind);
    onSaved?.();
    return true;
  }

  _addTemplatePreset(options = {}) {
    if (!this._editor?.doc) return false;
    return this._showNameModal({
      title: options.title || 'テンプレート登録',
      label: 'テンプレート名',
      placeholder: 'マイテンプレート',
      okText: options.okText || '登録',
      onClose: options.onClose,
      onSubmit: name => {
        const value = globalThis.GBScriptNoteRoleModel?.createTemplate
          ? globalThis.GBScriptNoteRoleModel.createTemplate(this._editor.doc)
          : {
            layoutMode: this._editor.doc.layoutMode,
            editor: _snToolClone(this._editor.doc.editor || {}),
            scenarioTypes: _snToolClone(this._editor.doc.scenarioTypes || []),
            rubyPresentation: _snToolClone(this._editor.doc.rubyPresentation || {}),
          };
        const saved = this._savePresetValue('template', name, value, {
          allowOverwrite: options.allowOverwrite,
          label: 'シナリオ: テンプレート登録',
          onSaved: options.onSaved,
        });
        if (saved && typeof showStatus === 'function') showStatus(`テンプレート「${name}」を登録しました`);
        return saved;
      },
    });
  }

  _addFilterPreset(options = {}) {
    const value = this._currentFilterPresetValue();
    if (!value) { if (typeof showStatus === 'function') showStatus('フィルタが未設定です'); return false; }
    return this._showNameModal({
      title: options.title || 'フィルタプリセット登録',
      label: 'プリセット名',
      placeholder: 'キャラのみ',
      okText: options.okText || '登録',
      onClose: options.onClose,
      onSubmit: name => {
        const saved = this._savePresetValue('filter', name, value, {
          allowOverwrite: options.allowOverwrite,
          label: 'シナリオ: フィルタプリセット登録',
          onSaved: options.onSaved,
        });
        if (saved && typeof showStatus === 'function') showStatus(`フィルタプリセット「${name}」を登録しました`);
        return saved;
      },
    });
  }

  _showPresetManager(kind) {
    const cfg = this._managedPresetConfig(kind);
    const owner = document.activeElement;
    const content = document.createElement('div');
    content.innerHTML = `<div class="sn2-preset-manager-status" role="status" aria-live="polite"></div>
      <button type="button" class="tb-text-btn sn2-preset-manager-add" data-pm-add aria-label="${esc(cfg.itemLabel)}を追加"><span class="ico ico-plus"></span>追加</button>
      <div class="sn2-preset-manager-list" data-pm-list></div>`;
    const closeButton = document.createElement('button');
    closeButton.type = 'button'; closeButton.className = 'gb-btn gb-btn-sm cancel-btn'; closeButton.textContent = '閉じる';
    let busy = false, childOpen = false;
    const modalApi = window.GBUI.createModal({
      id: 'scriptnote-preset-manager', title: cfg.title, body: [...content.childNodes], footer: [closeButton],
      variant: 'standard', geometryKey: 'scriptnote-preset-manager', minWidth: '0', initialFocus: '[data-pm-add]',
      returnFocus: owner, closeLabel: `${cfg.title}を閉じる`, closeOnEsc: true, closeOnOverlay: true,
      onBeforeClose: () => !busy && !childOpen,
    });
    const overlay = modalApi.overlay;
    const panel = modalApi.modal;
    overlay.dataset.sn2Dialog = 'preset-manager';
    overlay.dataset.e2eId = 'scriptnote-preset-manager-overlay';
    panel.dataset.e2eId = 'scriptnote-preset-manager-dialog';
    panel.classList.add('sn2-preset-manager-modal');
    modalApi.body.classList.add('sn2-preset-manager-body');
    modalApi.footer.classList.add('sn2-preset-modal-actions');
    const list = panel.querySelector('[data-pm-list]');
    const status = panel.querySelector('.sn2-preset-manager-status');
    const addButton = panel.querySelector('[data-pm-add]');
    const render = () => {
      const names = _snToolPresetNames(cfg.storageKey, cfg.orderKey);
      list.innerHTML = '';
      if (!names.length) {
        const empty = document.createElement('div');
        empty.className = 'sn2-preset-manager-empty';
        empty.textContent = cfg.emptyText;
        list.appendChild(empty);
        return;
      }
      names.forEach((name, index) => {
        const row = document.createElement('div');
        row.className = 'sn2-preset-manager-row';
        row.dataset.pmName = name;
        const title = document.createElement('div');
        title.className = 'sn2-preset-manager-title';
        title.textContent = name;
        const tools = document.createElement('div');
        tools.className = 'sn2-preset-manager-tools';
        [['copy', '複製', 'ico-copy'], ['up', '上へ', 'ico-arrowUp'], ['down', '下へ', 'ico-arrowDown'], ['delete', '削除', 'ico-trash2']].forEach(([action, titleText, icon]) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = action === 'delete' ? 'tb-icon-btn sn2-preset-manager-btn sn2-preset-manager-btn--delete' : 'tb-icon-btn sn2-preset-manager-btn';
          btn.dataset.pmAction = action;
          btn.title = titleText;
          btn.setAttribute('aria-label', `${titleText}: ${name}`);
          btn.disabled = (action === 'up' && index === 0) || (action === 'down' && index === names.length - 1);
          btn.innerHTML = `<span class="ico ${icon}"></span>`;
          tools.appendChild(btn);
        });
        row.append(title, tools);
        list.appendChild(row);
      });
      if (typeof replaceIcons === 'function') replaceIcons(list);
      if (busy) list.querySelectorAll('button').forEach(button => { button.disabled = true; });
    };
    const setBusy = next => {
      busy = next;
      panel.setAttribute('aria-busy', next ? 'true' : 'false');
      addButton.disabled = next;
      closeButton.disabled = next;
      if (next) list.querySelectorAll('button').forEach(button => { button.disabled = true; });
      else render();
    };
    const showMutationFailure = error => {
      console.error(`${cfg.itemLabel}の更新に失敗しました:`, error);
      status.textContent = '保存できませんでした。内容を保ったまま再試行できます。';
      if (typeof showStatus === 'function') showStatus('保存できませんでした。もう一度お試しください', true);
    };
    addButton.addEventListener('click', () => {
      if (busy || childOpen) return;
      childOpen = true;
      const opts = {
        allowOverwrite: false, okText: '追加', onSaved: render, title: cfg.itemLabel + '追加',
        onClose: () => { childOpen = false; },
      };
      const opened = kind === 'template' ? this._addTemplatePreset(opts) : this._addFilterPreset(opts);
      if (opened === false) childOpen = false;
    });
    list.addEventListener('click', async event => {
      const btn = event.target.closest('[data-pm-action]');
      const name = btn?.closest('[data-pm-name]')?.dataset.pmName;
      if (!btn || !name || busy || childOpen) return;
      const action = btn.dataset.pmAction;
      let deleteResult = false;
      if (action === 'copy') {
        childOpen = true;
        const opened = this._duplicateManagedPreset(kind, name, render, () => { childOpen = false; });
        if (opened === false) childOpen = false;
      }
      try {
        if (action === 'up' || action === 'down') {
          this._moveManagedPreset(kind, name, action === 'up' ? -1 : 1, render);
          const movedRow = [...list.querySelectorAll('[data-pm-name]')].find(item => item.dataset.pmName === name);
          const sameAction = movedRow?.querySelector(`[data-pm-action="${action}"]`);
          const oppositeAction = movedRow?.querySelector(`[data-pm-action="${action === 'up' ? 'down' : 'up'}"]`);
          const focusTarget = !sameAction?.disabled ? sameAction : (!oppositeAction?.disabled ? oppositeAction : movedRow?.querySelector('[data-pm-action="copy"]'));
          focusTarget?.focus?.();
        }
        if (action === 'delete') {
          setBusy(true);
          deleteResult = await this._deleteManagedPreset(kind, name, render);
          status.textContent = '';
        }
      } catch (error) {
        showMutationFailure(error);
      } finally {
        if (action === 'delete') {
          setBusy(false);
          const sameRow = [...list.querySelectorAll('[data-pm-name]')].find(item => item.dataset.pmName === name);
          const focusTarget = deleteResult
            ? list.querySelector('[data-pm-action]') || addButton
            : sameRow?.querySelector('[data-pm-action="delete"]') || addButton;
          focusTarget?.focus?.();
        }
      }
    });
    closeButton.addEventListener('click', () => modalApi.close('close'));
    render();
    if (typeof replaceIcons === 'function') replaceIcons(overlay);
    modalApi.open();
    return true;
  }

  _duplicateManagedPreset(kind, name, onSaved, onClose) {
    const cfg = this._managedPresetConfig(kind);
    const data = _snToolReadJsonObject(cfg.storageKey);
    if (!Object.prototype.hasOwnProperty.call(data, name)) return false;
    let savedCopyName = '';
    const returnFocus = () => {
      const manager = document.querySelector('[data-e2e-id="scriptnote-preset-manager-dialog"]');
      const targetName = savedCopyName || name;
      const row = [...(manager?.querySelectorAll('[data-pm-name]') || [])]
        .find(item => item.dataset.pmName === targetName);
      return row?.querySelector('[data-pm-action="copy"]') || manager?.querySelector('[data-pm-add]');
    };
    return this._showNameModal({
      title: cfg.itemLabel + '複製',
      label: cfg.itemLabel + '名',
      placeholder: name,
      value: _snToolUniquePresetName(name, Object.keys(data)),
      okText: '複製',
      returnFocus,
      onClose,
      onSubmit: copyName => {
        const beforeStorage = _snToolCaptureStorageHistory([cfg.storageKey, cfg.orderKey]);
        const nextData = _snToolReadJsonObject(cfg.storageKey);
        if (!Object.prototype.hasOwnProperty.call(nextData, name)) return false;
        if (this._reservedPresetName(kind, copyName) || Object.prototype.hasOwnProperty.call(nextData, copyName)) {
          if (typeof showStatus === 'function') showStatus('この名前は使えません', true);
          return false;
        }
        const order = _snToolPresetNames(cfg.storageKey, cfg.orderKey).filter(item => item !== copyName);
        order.splice(Math.max(0, order.indexOf(name)) + 1, 0, copyName);
        nextData[copyName] = _snToolClone(nextData[name]);
        _snToolWriteStorageAtomically([
          [cfg.storageKey, JSON.stringify(nextData)],
          [cfg.orderKey, JSON.stringify(_snToolFilteredPresetOrder(order, nextData))],
        ]);
        _snToolPushStorageHistory('シナリオ: ' + cfg.itemLabel + '複製', beforeStorage, [cfg.storageKey, cfg.orderKey], copyName);
        this._refreshManagedPresetUi(kind);
        savedCopyName = copyName;
        onSaved?.();
        if (typeof showStatus === 'function') showStatus(`${cfg.itemLabel}「${copyName}」を複製しました`);
        return true;
      },
    });
  }

  _moveManagedPreset(kind, name, dir, onSaved) {
    const cfg = this._managedPresetConfig(kind);
    const data = _snToolReadJsonObject(cfg.storageKey);
    const order = _snToolPresetNames(cfg.storageKey, cfg.orderKey);
    const index = order.indexOf(name);
    const nextIndex = index + dir;
    if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return;
    const beforeStorage = _snToolCaptureStorageHistory([cfg.storageKey, cfg.orderKey]);
    [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
    _snToolWritePresetOrder(cfg.orderKey, order, data);
    _snToolPushStorageHistory('シナリオ: ' + cfg.itemLabel + '並べ替え', beforeStorage, [cfg.storageKey, cfg.orderKey], name);
    this._refreshManagedPresetUi(kind);
    onSaved?.();
  }

  async _deleteManagedPreset(kind, name, onSaved) {
    const cfg = this._managedPresetConfig(kind);
    if (!Object.prototype.hasOwnProperty.call(_snToolReadJsonObject(cfg.storageKey), name)) return false;
    if (typeof cfConfirm === 'function' && !await cfConfirm(`プリセット「${name}」を削除しますか？`, { danger: true, okLabel: '削除' })) return false;
    if (typeof cfConfirm !== 'function' && typeof confirm === 'function' && !confirm(`プリセット「${name}」を削除しますか？`)) return false;
    const data = _snToolReadJsonObject(cfg.storageKey);
    if (!Object.prototype.hasOwnProperty.call(data, name)) return false;
    const beforeStorage = _snToolCaptureStorageHistory([cfg.storageKey, cfg.orderKey]);
    const order = _snToolPresetNames(cfg.storageKey, cfg.orderKey);
    delete data[name];
    _snToolWriteStorageAtomically([
      [cfg.storageKey, JSON.stringify(data)],
      [cfg.orderKey, JSON.stringify(_snToolFilteredPresetOrder(order, data))],
    ]);
    if (kind === 'filter' && this._activeFilterPreset === name) this._clearActiveFilterPreset();
    const deleteLabel = kind === 'template' ? 'シナリオ: テンプレート削除' : 'シナリオ: フィルタプリセット削除';
    _snToolPushStorageHistory(deleteLabel, beforeStorage, [cfg.storageKey, cfg.orderKey], name);
    this._refreshManagedPresetUi(kind);
    onSaved?.();
    if (typeof showStatus === 'function') showStatus(`${cfg.itemLabel}「${name}」を削除しました`);
    return true;
  }

  _clearActiveFilterPreset() {
    if (!this._editor) return;
    this._editor._filterRoles = null;
    this._editor._hideRoles = null;
    this._editor._filterStatuses = null;
    this._editor._hideStatuses = null;
    this._editor._render();
    this.el?.querySelector('#btn-filter')?.classList.remove('active');
    this._activeFilterPreset = '__all__';
  }

  _refreshManagedPresetUi(kind) {
    if (kind === 'template') this._refreshTemplateSelect();
    else this._refreshFilterPresets();
  }

  _refreshFilterPresets() {
    const sel = this.el?.querySelector('#sn-filter-preset');
    if (!sel) return;
    const presets = _snToolReadJsonObject(SN2_FILTER_PRESETS_STORAGE_KEY);
    while (sel.options.length > 1) sel.remove(1);
    _snToolPresetNames(SN2_FILTER_PRESETS_STORAGE_KEY, SN2_FILTER_PRESETS_ORDER_STORAGE_KEY).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    if (this._activeFilterPreset && Object.prototype.hasOwnProperty.call(presets, this._activeFilterPreset)) sel.value = this._activeFilterPreset;
    else sel.value = '__all__';
  }

  _syncTabStateFromScenario() {
    const path = this._editor?._path || this.state.scenarioPath || '';
    const label = this.state.label || this._editor?.doc?.title || (path ? path.split('/').pop().replace(/\.\w+$/, '') : '');
    if (path) this.state.scenarioPath = path;
    if (label) this.state.label = label;
    if (typeof GBTabs !== 'undefined' && this.tabId && label) {
      GBTabs.setTabLabel?.(this.tabId, label);
    }
    if (typeof GBLayout === 'undefined' || !this.paneId || !this.tabId) return;
    const paneInfo = GBLayout.findNode?.(GBLayout.root, this.paneId);
    const tab = paneInfo?.node?.tabs?.find?.(item => item.id === this.tabId) || null;
    if (!tab) return;
    if (path) tab.path = path;
    if (label) tab.label = label;
    tab.state = {
      ...(tab.state || {}),
      scenarioPath: path,
      label,
      noteLayoutMode: this.state.noteLayoutMode || tab.state?.noteLayoutMode || '',
    };
    GBLayout.saveLayout?.();
  }

  async _loadScenario(path, options = {}) {
    const nextPath = path || '';
    const coordinator = window.MeldexDocumentSaveCoordinator;
    const documentKey = coordinator && nextPath ? coordinator.documentKeyForPath(nextPath) : nextPath;
    // 競合確認からの明示的な再読込だけが保留状態を解除できる。
    // 通常のタブ再表示・別パネルでの同一ファイル読込では、他の編集面が保持する
    // 未保存競合を勝手に解決しない。
    const conflictGeneration = Object.prototype.hasOwnProperty.call(options, 'conflictGeneration')
      ? options.conflictGeneration
      : null;
    const loadSeq = (this._loadSeq || 0) + 1;
    this._loadSeq = loadSeq;
    const isStaleLoad = () => this._loadSeq !== loadSeq;
    const previousPath = this._editor?._path || this.state.scenarioPath || '';
    const previousLabel = this.state.label || this._editor?.doc?.title || (previousPath ? previousPath.split('/').pop().replace(/\.\w+$/, '') : '');
    const fallbackLabel = nextPath ? nextPath.split('/').pop().replace(/\.\w+$/, '') : '';
    const showGlobalLoading = !options.silent && !options.skipGlobalUi
      && typeof showLoading === 'function' && typeof hideLoading === 'function';
    if (showGlobalLoading) showLoading('シナリオを読み込み中...');
    try {
      const data = await apiFetch('/file?path=' + encodeURIComponent(nextPath));
      if (isStaleLoad()) return false;
      const content = data.content || '{}';
      if (showGlobalLoading && typeof showLoadingBeforeHeavyWork === 'function') {
        await showLoadingBeforeHeavyWork(content, '大きいシナリオを描画中...');
        if (isStaleLoad()) return false;
      }
      const parsed = JSON.parse(content);
      _sn2ExpandDefaultFileStyle(parsed);

      if (typeof isScriptNoteFileDoc === 'function' && !isScriptNoteFileDoc(parsed)) {
        throw new Error('シナリオ形式ファイルではありません。旧シナリオからインポートしてください。');
      }

      const host = this.el?.querySelector?.('#scenario-note-surface');
      if (!host) throw new Error('シナリオエディタの表示先が見つかりません');

      // エディタ初期化
      if (!this._editor) {
        this._editor = new ScriptNoteEditor(host);
      } else {
        this._editor.host = host;
      }
      const loaded = this._editor.loadDoc(parsed, nextPath, data.etag || '', conflictGeneration, data);
      if (!loaded) {
        throw new Error('競合状態が更新されたため、再読込を中止しました');
      }
      this.state.scenarioPath = nextPath;
      this.state.label = parsed.title || fallbackLabel;

      // UI反映
      const titleInput = this.el?.querySelector?.('#title-input');
      if (titleInput) titleInput.value = parsed.title || '';
      window.MeldexFileLockBadge?.apply?.(titleInput, nextPath);
      const layoutSel = this.el?.querySelector?.('#scenario-note-layout-select');
      if (layoutSel) layoutSel.value = parsed.layoutMode || 'manga';
      this.state.noteLayoutMode = parsed.layoutMode || 'manga';
      this._syncTabStateFromScenario();
      // ボタン状態同期
      const vm = parsed.editor?.viewMode || 'horizontal';
      const wm = parsed.editor?.wrapMode ?? true;
      const md = !!parsed.editor?.mergeDisplay;
      this.el?.querySelector('#btn-horizontal')?.classList.toggle('active', vm === 'horizontal');
      this.el?.querySelector('#btn-vertical')?.classList.toggle('active', vm === 'vertical');
      this.el?.querySelector('#btn-wrap')?.classList.toggle('active', !!wm);
      this.el?.querySelector('#btn-merge-display')?.classList.toggle('active', md);

      // ナビゲーション登録
      if (!options.skipSaveLastView && typeof saveLastView === 'function') {
        saveLastView({ type: 'scriptnote', label: this.state.label || nextPath.split('/').pop(), path: nextPath });
      }
      if (!options.skipNavPush && typeof navPush === 'function') {
        const _navEntry = { type: 'scriptnote', label: this.state.label || nextPath.split('/').pop(), path: nextPath };
        navPush(_navEntry);
      }
      if (!options.skipRecent && typeof addRecent === 'function') {
        addRecent(this.state.label || nextPath.split('/').pop(), nextPath, 'scriptnote');
      }
      if (!options.skipAutoVersion && typeof startAutoVersion === 'function') startAutoVersion(nextPath, 'file');
      // ヒストリースコープ設定
      if (typeof historySetScope === 'function') historySetScope(this._editor._historyScope());
      if (this._skipDetailSync !== true && this._active) this._syncDetailPanel();
      // 注釈フローティング UI を再評価（targetPath を新ファイルに合わせ、ボタン表示を更新）
      // showView 経由ではコンポーネントタイプは早期 return するため、ここで明示的に呼ぶ
      if (typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.mountFloatingAnnotationUi === 'function') {
        GBPaneBridge.mountFloatingAnnotationUi();
      }
      if (this.el) delete this.el.dataset.loadFailed;
      if (!options.skipStatus && typeof showStatus === 'function') showStatus('シナリオを読み込みました');
      return true;
    } catch (err) {
      if (this.el) this.el.dataset.loadFailed = '1';
      if (!this._editor?.doc) {
        this.state.scenarioPath = '';
        this.state.label = '';
        this._renderEmptyState();
        this._syncTabStateFromScenario();
      } else {
        this.state.scenarioPath = this._editor._path || previousPath;
        this.state.label = this._editor.doc?.title || previousLabel;
        this.state.noteLayoutMode = this._editor.doc?.layoutMode || this.state.noteLayoutMode || '';
        this._syncTabStateFromScenario();
      }
      if (!options.skipStatus && typeof showStatus === 'function') showStatus('シナリオの読み込みに失敗: ' + err.message, true);
      return false;
    } finally {
      if (showGlobalLoading) {
        hideLoading();
        if (typeof hideLoadingMessage === 'function') {
          hideLoadingMessage('シナリオを読み込み中...');
          hideLoadingMessage('大きいシナリオを描画中...');
        }
      }
    }
  }
}

registerToolComponent('scriptnote', { cls: ScriptNoteComponent, icon: 'bookOpenText', label: 'シナリオ', multi: true, requiresViewLock: true });
