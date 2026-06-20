/* ==============================
   gb-tool-scriptnote.js: シナリオエディタ v2 (軽量段落ベース)
   シナリオエンジンに依存しない、Word方式の段落エディタ
   ============================== */

function _sn2IsFreshBlankDoc(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  return Array.isArray(parsed.rows) && parsed.rows.length === 0
    && Array.isArray(parsed.characters) && parsed.characters.length === 0
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
const SN2_FILTER_PRESETS_STORAGE_KEY = 'sn2-filter-presets';
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
    [SN2_FILTER_PRESETS_STORAGE_KEY]: 'フィルタプリセット',
  };
  return _snToolStorageHistoryKeys(keys).map(key => labels[key] || key).join(' / ');
}

function _snToolRefreshStorageAfterHistory(keys) {
  const changed = new Set(_snToolStorageHistoryKeys(keys));
  if (typeof forEachComponent !== 'function') return;
  forEachComponent(component => {
    if (!component || typeof component._refreshTemplateSelect !== 'function') return;
    if (changed.has(SN2_TEMPLATE_STORAGE_KEY)) component._refreshTemplateSelect();
    if (changed.has(SN2_FILTER_PRESETS_STORAGE_KEY) && typeof component._refreshFilterPresets === 'function') {
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
  <button class="tb-icon-btn tool-menu-btn" title="メニュー" data-action="showToolMenu(event,'scriptnote')"><span class="ico ico-menu"></span></button>
  <button class="tb-icon-btn" title="フォルダツリーで表示" data-action="revealCurrentInFolderTree('scriptnote', event)"><span class="ico ico-folderTree"></span></button>
  <input id="title-input" class="title-input tb-file-title tb-file-title--input" placeholder="シナリオタイトル" value="">
  <select id="scenario-note-layout-select" class="tb-select" style="max-width:160px;" title="テンプレート">
    <option value="manga">マンガシナリオ</option>
    <option value="drama">ドラマ・映画シナリオ</option>
    <option value="afureko">アフレコシナリオ</option>
    <option value="stage">舞台シナリオ</option>
  </select>
  <button class="tb-icon-btn" data-sn-action="saveTemplate" title="現在の設定をテンプレートとして登録"><span class="ico ico-save"></span></button>
  <div class="sep"></div>
  <button class="tb-icon-btn active" data-sn-action="horizontal" id="btn-horizontal" title="横書き"><span class="ico ico-textAlignStart"></span></button>
  <button class="tb-icon-btn" data-sn-action="vertical" id="btn-vertical" title="縦書き"><span class="ico ico-kanban"></span></button>
  <button class="tb-icon-btn" data-sn-action="wrap" id="btn-wrap" title="折返し"><span class="ico ico-wrapText"></span></button>
  <button class="tb-icon-btn" data-sn-action="mergeDisplay" id="btn-merge-display" title="前行と同じタイプ/ガター値を省略表示（まとめて表示）"><span class="ico ico-rows3"></span></button>
  <div class="sep"></div>
  <button class="tb-text-btn" data-sn-action="addColumn" title="列を追加"><span class="ico ico-plus"></span>列</button>
  <div class="tb-spacer"></div>
  <button class="tb-icon-btn" data-sn-action="filter" id="btn-filter" title="タイプ/採用状況でフィルタ"><span class="ico ico-funnel"></span></button>
  <select id="sn-filter-preset" class="tb-select" style="max-width:140px;" title="フィルタプリセット"><option value="__all__">すべて表示</option></select>
  <div class="sep"></div>
  <button class="tb-icon-btn" data-sn-action="saveFilter" title="現在のフィルタを登録"><span class="ico ico-save"></span></button>
  <button class="tb-icon-btn" data-sn-action="reload" title="ファイルを再読み込み"><span class="ico ico-refreshCw"></span></button>
  <button class="tb-icon-btn" data-sn-action="search" title="テキスト列を検索・置換"><span class="ico ico-search"></span></button>
  <button class="tb-icon-btn gb-toolbar-option-panel-btn" data-sn-action="detail" id="btn-detail" title="オプションを開く"><span class="ico ico-slidersHorizontal"></span></button>
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
    } else {
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
      const el = document.createElement('div');
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
    if (isHidden) {
      if (typeof toggleOptionPanel === 'function') toggleOptionPanel();
      else if (typeof toggleDetailPanel === 'function') toggleDetailPanel();
    }
    this._syncDetailPanel();
  }

  _refreshTemplateSelect() {
    const sel = this.el?.querySelector('#scenario-note-layout-select');
    if (!sel) return;
    // 既存のカスタムオプションを除去
    sel.querySelectorAll('option[value^="custom:"]').forEach(o => o.remove());
    // localStorageからカスタムテンプレートを読み込んで追加
    try {
      const templates = JSON.parse(localStorage.getItem(SN2_TEMPLATE_STORAGE_KEY)) || {};
      Object.keys(templates).forEach(name => {
        const opt = document.createElement('option');
        opt.value = 'custom:' + name;
        opt.textContent = name;
        sel.appendChild(opt);
      });
    } catch {}
    // 現在のlayoutModeに合わせて選択
    if (this._editor?.doc?.layoutMode) sel.value = this._editor.doc.layoutMode;
  }

  _bindToolbar() {
    if (this._toolbarBound || !this.el) return;
    this._toolbarBound = true;
    this.el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-sn-action]');
      if (!btn) return;
      const action = btn.dataset.snAction;
      if (action === 'detail') { this._openDetailPanel(); return; }
      if (action === 'horizontal' || action === 'vertical') {
        if (!this._editor?.doc) return;
        this._editor._pushUndo('表示方向変更');
        this._editor.doc.editor.viewMode = action;
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
        if (!this._editor) return;
        const filterRoles = this._editor._filterRoles;
        const hideRoles = this._editor._hideRoles;
        const filterStatuses = this._editor._filterStatuses;
        const hideStatuses = this._editor._hideStatuses;
        const hasFilter = !!filterRoles;
        const hasHide = !!(hideRoles && hideRoles.size);
        const hasStatusFilter = !!filterStatuses;
        const hasStatusHide = !!(hideStatuses && hideStatuses.size);
        if (!hasFilter && !hasHide && !hasStatusFilter && !hasStatusHide) { if (typeof showStatus === 'function') showStatus('フィルタが未設定です'); return; }
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `<div class="modal" style="min-width:280px;"><h3>フィルタプリセット登録</h3>
          <div class="modal-body" style="padding:12px 16px;"><label>プリセット名<input type="text" id="sn2-fp-name" style="width:100%;padding:4px 6px;margin-top:4px;" placeholder="キャラのみ"></label></div>
          <div class="btn-row" style="display:flex;gap:8px;justify-content:flex-end;padding:8px 16px 16px;">
            <button type="button" class="cancel-btn">キャンセル</button><button type="button" class="primary ok-btn">登録</button>
          </div></div>`;
        const doSaveFp = () => {
          const name = overlay.querySelector('#sn2-fp-name').value.trim();
          if (!name) return;
          // 予約名は登録不可（組み込みプリセット「すべて表示」と衝突するため）
          if (name === '__delete__' || name === '__all__' || name === 'すべて表示') {
            if (typeof showStatus === 'function') showStatus('この名前は予約済みです', true);
            return;
          }
          overlay.remove();
          const beforeStorage = _snToolCaptureStorageHistory([SN2_FILTER_PRESETS_STORAGE_KEY]);
          const presets = JSON.parse(localStorage.getItem(SN2_FILTER_PRESETS_STORAGE_KEY) || '{}');
          // 新形式: { visible: [...] | null, hidden: [...] }
          // visible が null なら whitelist 未設定 (全タイプ表示)、hidden は blacklist
          presets[name] = {
            visible: hasFilter ? [...filterRoles] : null,
            hidden: hasHide ? [...hideRoles] : [],
            visibleStatuses: hasStatusFilter ? [...filterStatuses] : null,
            hiddenStatuses: hasStatusHide ? [...hideStatuses] : [],
          };
          localStorage.setItem(SN2_FILTER_PRESETS_STORAGE_KEY, JSON.stringify(presets));
          _snToolPushStorageHistory(
            'シナリオ: フィルタプリセット登録',
            beforeStorage,
            [SN2_FILTER_PRESETS_STORAGE_KEY],
            name
          );
          this._refreshFilterPresets();
          if (typeof showStatus === 'function') showStatus(`フィルタプリセット「${name}」を登録しました`);
        };
        overlay.querySelector('.ok-btn').addEventListener('click', doSaveFp);
        overlay.querySelector('.cancel-btn').addEventListener('click', () => overlay.remove());
        overlay.querySelector('#sn2-fp-name').addEventListener('keydown', ev => { if (ev.key === 'Enter') doSaveFp(); });
        document.body.appendChild(overlay);
        overlay.querySelector('#sn2-fp-name').focus();
        return;
      }
      if (action === 'saveTemplate') {
        if (!this._editor?.doc) return;
        // テンプレート名入力（モーダル）
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `<div class="modal" style="min-width:320px;"><h3>テンプレート登録</h3>
          <div class="modal-body" style="padding:12px 16px;"><label>テンプレート名<input type="text" id="sn2-tpl-name" style="width:100%;padding:4px 6px;margin-top:4px;" placeholder="マイテンプレート"></label></div>
          <div class="btn-row" style="display:flex;gap:8px;justify-content:flex-end;padding:8px 16px 16px;">
            <button type="button" class="cancel-btn">キャンセル</button><button type="button" class="primary ok-btn">登録</button>
          </div></div>`;
        const doSave = () => {
          const name = overlay.querySelector('#sn2-tpl-name').value.trim();
          if (!name) return;
          overlay.remove();
          const key = SN2_TEMPLATE_STORAGE_KEY;
          const beforeStorage = _snToolCaptureStorageHistory([key]);
          let templates = {};
          try { templates = JSON.parse(localStorage.getItem(key)) || {}; } catch {}
          templates[name] = {
            layoutMode: this._editor.doc.layoutMode,
            editor: JSON.parse(JSON.stringify(this._editor.doc.editor || {})),
            characters: JSON.parse(JSON.stringify(this._editor.doc.characters || [])),
          };
          localStorage.setItem(key, JSON.stringify(templates));
          _snToolPushStorageHistory(
            'シナリオ: テンプレート登録',
            beforeStorage,
            [key],
            name
          );
          this._refreshTemplateSelect();
          if (typeof showStatus === 'function') showStatus(`テンプレート「${name}」を登録しました`);
        };
        overlay.querySelector('.ok-btn').addEventListener('click', doSave);
        overlay.querySelector('.cancel-btn').addEventListener('click', () => overlay.remove());
        overlay.querySelector('#sn2-tpl-name').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') doSave(); });
        document.body.appendChild(overlay);
        overlay.querySelector('#sn2-tpl-name').focus();
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
          const key = SN2_TEMPLATE_STORAGE_KEY;
          try {
            const templates = JSON.parse(localStorage.getItem(key)) || {};
            const tpl = templates[val.slice(7)];
            if (tpl) {
              if (tpl.layoutMode) this._editor.doc.layoutMode = tpl.layoutMode;
              if (tpl.editor) Object.assign(this._editor.doc.editor, JSON.parse(JSON.stringify(tpl.editor)));
              if (tpl.characters) this._editor.doc.characters = JSON.parse(JSON.stringify(tpl.characters));
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
        if (val === '__delete__') {
          // 削除メニューを開く前に選択を元に戻す（削除不可のすべて表示にフォールバック）
          filterPresetSel.value = this._activeFilterPreset || '__all__';
          this._showDeleteFilterPresetMenu(filterPresetSel);
          return;
        }
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
        const presets = JSON.parse(localStorage.getItem(SN2_FILTER_PRESETS_STORAGE_KEY) || '{}');
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

  _refreshFilterPresets() {
    const sel = this.el?.querySelector('#sn-filter-preset');
    if (!sel) return;
    const presets = JSON.parse(localStorage.getItem(SN2_FILTER_PRESETS_STORAGE_KEY) || '{}');
    // 既存オプションを除去（最初のplaceholderは残す）
    while (sel.options.length > 1) sel.remove(1);
    Object.keys(presets).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    if (Object.keys(presets).length) {
      const delOpt = document.createElement('option');
      delOpt.value = '__delete__';
      delOpt.textContent = '── プリセット削除 ──';
      delOpt.style.color = 'var(--red, #c44)';
      sel.appendChild(delOpt);
    }
  }

  _showDeleteFilterPresetMenu(anchor) {
    const presets = JSON.parse(localStorage.getItem(SN2_FILTER_PRESETS_STORAGE_KEY) || '{}');
    const names = Object.keys(presets);
    if (!names.length) return;
    const popup = document.createElement('div');
    popup.className = 'sn2-header-popup';
    popup.style.cssText = 'position:fixed;z-index:10000;min-width:140px;max-height:300px;overflow-y:auto;';
    names.forEach(name => {
      const btn = document.createElement('button');
      btn.className = 'sn2-header-popup-btn';
      btn.textContent = '✕ ' + name;
      btn.style.cssText = 'display:block;width:100%;text-align:left;padding:4px 8px;border:none;background:none;color:var(--fg);cursor:pointer;font-size:12px;';
      btn.addEventListener('click', async () => {
        if (typeof cfConfirm === 'function' && !await cfConfirm(`プリセット「${name}」を削除しますか？`)) return;
        const beforeStorage = _snToolCaptureStorageHistory([SN2_FILTER_PRESETS_STORAGE_KEY]);
        delete presets[name];
        localStorage.setItem(SN2_FILTER_PRESETS_STORAGE_KEY, JSON.stringify(presets));
        _snToolPushStorageHistory(
          'シナリオ: フィルタプリセット削除',
          beforeStorage,
          [SN2_FILTER_PRESETS_STORAGE_KEY],
          name
        );
        this._refreshFilterPresets();
        btn.remove();
        if (!popup.querySelector('button')) popup.remove();
        if (typeof showStatus === 'function') showStatus(`プリセット「${name}」を削除しました`);
      });
      popup.appendChild(btn);
    });
    document.body.appendChild(popup);
    if (typeof positionPopup === 'function') positionPopup(popup, anchor.getBoundingClientRect());
    const close = (ev) => { if (!popup.contains(ev.target)) { popup.remove(); document.removeEventListener('pointerdown', close); } };
    setTimeout(() => document.addEventListener('pointerdown', close), 0);
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
      if (isStaleLoad()) return;
      const content = data.content || '{}';
      if (showGlobalLoading && typeof showLoadingBeforeHeavyWork === 'function') {
        await showLoadingBeforeHeavyWork(content, '大きいシナリオを描画中...');
        if (isStaleLoad()) return;
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
      this._editor.loadDoc(parsed, nextPath);
      this.state.scenarioPath = nextPath;
      this.state.label = parsed.title || fallbackLabel;

      // UI反映
      const titleInput = this.el?.querySelector?.('#title-input');
      if (titleInput) titleInput.value = parsed.title || '';
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
      if (!options.skipStatus && typeof showStatus === 'function') showStatus('シナリオを読み込みました');
    } catch (err) {
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
    } finally {
      if (showGlobalLoading) hideLoading();
    }
  }
}

registerToolComponent('scriptnote', { cls: ScriptNoteComponent, icon: 'bookOpenText', label: 'シナリオ', multi: true, requiresViewLock: true });
