/* ==============================
   gb-tool-components.js: 全ToolComponentアダプター（v5.0 Phase B）

   各コンポーネントは既存モジュールの関数を呼び出す薄いアダプター。
   Phase C以降で段階的に内部ロジックを移行する。
   ============================== */

function _paneStateRead(key, fallbackValue) {
  if (typeof GBPaneState !== 'undefined' && typeof GBPaneState.read === 'function') {
    return GBPaneState.read(null, key, fallbackValue);
  }
  return fallbackValue;
}

function _renderLegacyToolRedirect(container, toolType, label, hint) {
  container.innerHTML = `<div class="gb-empty-state" style="padding:24px;">
    <div class="gb-empty-message">${label}</div>
    <div class="gb-empty-hint">${hint}</div>
    <div style="margin-top:12px;">
      <button type="button" class="gb-btn gb-btn-primary" data-action="focus-legacy-tool">既存ペインを表示</button>
    </div>
  </div>`;
  container.querySelector('[data-action="focus-legacy-tool"]')?.addEventListener('click', () => {
    const existing = (typeof GBTabs !== 'undefined' && typeof GBTabs.findPaneWithTab === 'function')
      ? GBTabs.findPaneWithTab(toolType, '')
      : null;
    if (existing && typeof GBTabs.activateTab === 'function') {
      GBTabs.activateTab(existing.paneId, existing.tabId);
    } else if (typeof showStatus === 'function') {
      showStatus(`${label}の既存ペインが見つかりません`, true);
    }
  });
}

// === OutlinerComponent ===
class OutlinerComponent extends ToolComponent {
  create() {
    this.el = document.createElement('div');
    this.el.className = 'gb-tool-outliner';
    this.el.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;';
    _renderLegacyToolRedirect(this.el, 'outliner', 'フォルダツリー', '固定IDを持つ既存ツリーを複製せず、既存ペインを再利用します。');
    return this.el;
  }

  activate() {
    super.activate();
    if (typeof loadOutliner === 'function') loadOutliner();
  }

  getDetailContent() { return null; }
}

// === DatabaseComponent ===
class DatabaseComponent extends ToolComponent {
  create() {
    this.el = document.createElement('div');
    this.el.className = 'gb-tool-database';
    this.el.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;';
    return this.el;
  }

  activate() {
    super.activate();
    if (this.state.dbPath && typeof selectDatabase === 'function') {
      selectDatabase(this.state.dbPath);
    }
  }

  restoreState(s) {
    super.restoreState(s);
    if (s && s.dbPath) this.state.dbPath = s.dbPath;
  }

  getState() {
    return { dbPath: this.state.dbPath || _paneStateRead('dbPath', '') };
  }

  getDetailContent() {
    // アクティブエントリの情報を返す
    const entityPath = _paneStateRead('entityPath', '');
    if (entityPath) {
      return { type: 'entity', path: entityPath };
    }
    return null;
  }
}

// === EditorComponent ===
class EditorComponent extends ToolComponent {
  create() {
    this.el = document.createElement('div');
    this.el.className = 'gb-tool-editor';
    this.el.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;';
    return this.el;
  }

  activate() {
    super.activate();
    if (this.state.pagePath && typeof openPage === 'function') {
      openPage(this.state.label || '', this.state.pagePath);
    }
  }

  restoreState(s) {
    super.restoreState(s);
    if (s) {
      this.state.pagePath = s.pagePath || '';
      this.state.label = s.label || '';
    }
  }

  getState() {
    return {
      pagePath: this.state.pagePath || _paneStateRead('pagePath', ''),
      label: this.state.label || '',
    };
  }
}

// === CanvasComponent → gb-tool-canvas.js に移行済み (Phase C) ===

// === CalendarComponent → gb-tool-calendar.js + gb-tool-calendar-views.js に移行済み (Phase C) ===

// === ChatComponent ===
class ChatComponent extends ToolComponent {
  create() {
    this.el = document.createElement('div');
    this.el.className = 'gb-tool-chat';
    this.el.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;';
    _renderLegacyToolRedirect(this.el, 'chat', 'チャット', '既存のチャットペインを使う構成に揃え、重複IDのクローンを作りません。');
    return this.el;
  }
}

// === AnnotationComponent ===
class AnnotationComponent extends ToolComponent {
  create() {
    this.el = document.createElement('div');
    this.el.className = 'gb-tool-annotation';
    this.el.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;';
    return this.el;
  }

  activate() {
    super.activate();
    if (typeof loadAnnotations === 'function') loadAnnotations();
  }
}

// === HistoryComponent ===
class HistoryComponent extends ToolComponent {
  create() {
    this.el = document.createElement('div');
    this.el.className = 'gb-tool-history';
    this.el.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;';
    return this.el;
  }

  activate() {
    super.activate();
    if (typeof renderHistoryList === 'function') renderHistoryList();
  }
}

// === DetailComponent ===
class DetailComponent extends ToolComponent {
  create() {
    this.el = document.createElement('div');
    this.el.className = 'gb-tool-detail';
    this.el.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;';
    return this.el;
  }

  activate() {
    super.activate();
    // アクティブペインのコンテンツに応じて詳細を表示
    this._updateFromActivePane();
  }

  _updateFromActivePane() {
    const activeTab = GBTabs.getActiveTab(GBLayout.activePane);
    if (!activeTab) return;
    const component = getComponentInstance(activeTab.id);
    if (component && typeof component.getDetailContent === 'function') {
      const detail = component.getDetailContent();
      if (detail && this.el) {
        // 詳細コンテンツをレンダリング
      }
    }
  }
}

// === FolderComponent ===
class FolderComponent extends ToolComponent {
  create() {
    this.el = document.createElement('div');
    this.el.className = 'gb-tool-folder';
    this.el.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;';
    return this.el;
  }

  activate() {
    super.activate();
    if (this.state.folderPath && typeof openFolder === 'function') {
      openFolder(this.state.label || '', this.state.folderPath);
    }
  }

  restoreState(s) {
    super.restoreState(s);
    if (s) {
      this.state.folderPath = s.folderPath || '';
      this.state.label = s.label || '';
    }
  }

  getState() {
    return { folderPath: this.state.folderPath, label: this.state.label };
  }
}

// === MediaComponent ===
class MediaComponent extends ToolComponent {
  create() {
    this.el = document.createElement('div');
    this.el.className = 'gb-tool-media';
    this.el.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:auto;align-items:center;justify-content:center;background:var(--preview-bg,var(--content-bg,var(--bg)));padding:16px;';
    return this.el;
  }

  activate() {
    super.activate();
    if (this.state.mediaPath && typeof openMedia === 'function') {
      openMedia(this.state.label || '', this.state.mediaPath, this.state.mediaType || 'image');
    }
  }

  restoreState(s) {
    super.restoreState(s);
    if (s) {
      this.state.mediaPath = s.mediaPath || '';
      this.state.mediaType = s.mediaType || 'image';
      this.state.label = s.label || '';
    }
  }

  getState() {
    return { mediaPath: this.state.mediaPath, mediaType: this.state.mediaType, label: this.state.label };
  }
}

// === CompareComponent ===
class CompareComponent extends ToolComponent {
  create() {
    this.el = document.createElement('div');
    this.el.className = 'gb-tool-compare';
    this.el.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;';
    return this.el;
  }
}

// === SearchComponent ===
class SearchComponent extends ToolComponent {
  create() {
    this.el = document.createElement('div');
    this.el.className = 'gb-tool-search';
    this.el.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:auto;padding:12px;';
    this.el.innerHTML = `<div class="gb-empty-state" style="padding:24px;">
      <div class="gb-empty-icon">${typeof lucide === 'function' ? lucide('search', 42) : ''}</div>
      <div class="gb-empty-message">検索</div>
      <button type="button" class="gb-btn gb-btn-sm" data-gb-open-vault-search data-e2e-id="search-empty-open-vault-search">検索を開く</button>
    </div>`;
    this.el.querySelector('[data-gb-open-vault-search]')?.addEventListener('click', () => {
      if (typeof openSearchPanel === 'function') openSearchPanel();
    });
    return this.el;
  }
}

// === VersionComponent ===
class VersionComponent extends ToolComponent {
  destroy() {
    this._destroyed = true;
    super.destroy();
  }

  create() {
    this.el = document.createElement('div');
    this.el.className = 'gb-tool-version';
    this.el.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;';
    return this.el;
  }

  _getTabPath() {
    // tabId からタブオブジェクトを探してパスを取得
    if (typeof GBLayout !== 'undefined') {
      const allPanes = GBLayout.getAllPanes(GBLayout.root);
      for (const pane of allPanes) {
        const tab = (pane.tabs || []).find(t => t.id === this.tabId);
        if (tab) return tab.path || '';
      }
    }
    return '';
  }

  activate() {
    super.activate();
    const path = this._getTabPath() || this.state.versionPath || '';
    const vType = this.state.versionType || 'file';
    if (path) {
      this._loadVersions(path, vType);
    } else {
      this.el.innerHTML = `<div class="gb-empty-state" style="padding:24px;">
        <div class="gb-empty-icon">${typeof lucide === 'function' ? lucide('gitBranch', 48) : ''}</div>
        <div class="gb-empty-message">バージョン管理</div>
        <div class="gb-empty-hint">ファイルまたはフォルダを開いてからバージョン管理を使用してください</div>
      </div>`;
    }
  }

  async _loadVersions(path, vType) {
    const loadSeq = (this._loadSeq || 0) + 1;
    this._loadSeq = loadSeq;
    this.state.versionPath = path;
    this.state.versionType = vType;
    if (!this.el || this._destroyed) return;
    this.el.innerHTML = '<div class="gb-history-loading" style="padding:16px;color:var(--fg2);">読み込み中...</div>';
    const isFolder = vType === 'folder';
    const isDb = vType === 'db';
    const timelineKind = this.state.timelineKind || 'named,auto,edit';
    const timelineActorKind = this.state.timelineActorKind || '';
    // ファイル編集中(file/db)はファイルバージョンのみ、フォルダ選択中はフォルダバージョンのみを取得・表示する
    let versions = [];
    let folderVersions = [];
    let timeline = { entries: [] };
    const folderPath = isFolder ? path : '';
    if (isFolder) {
      try {
        folderVersions = await apiFetch('/version/list-folder?path=' + encodeURIComponent(path));
      } catch {}
    } else {
      try {
        versions = await apiFetch((isDb ? '/version/list-db' : '/version/list') + '?path=' + encodeURIComponent(path));
      } catch {}
    }
    try {
      const params = new URLSearchParams({ target_path: path, kinds: timelineKind, limit: '200' });
      if (timelineActorKind) params.set('actor_kind', timelineActorKind);
      timeline = await apiFetch('/version-panel/timeline?' + params.toString());
    } catch {}
    if (this._destroyed || this._loadSeq !== loadSeq || !this.el) return;
    this._timelineEntries = Array.isArray(timeline?.entries) ? timeline.entries : [];
    this.el.innerHTML = this._buildHtml(path, vType, versions, folderPath, folderVersions, this._timelineEntries);
    this._bindVersionActions();
  }

  async _runVersionAction(action, path, versionName, vType) {
    const calls = {
      showFolderFiles: () => showFolderVersionFiles(path, versionName),
      restoreFolder: () => restoreFolderVersion(path, versionName),
      deleteFolder: () => deleteFolderVersion(path, versionName),
      promoteFolder: () => this._promoteFolderVersion(path, versionName),
      timelineShowFolderFiles: () => showFolderVersionFiles(path, versionName),
      timelineRestoreFolder: () => restoreFolderVersion(path, versionName),
      timelineDeleteFolder: () => deleteFolderVersion(path, versionName),
      timelinePromoteFolder: () => this._promoteFolderVersion(path, versionName),
      saveFolder: () => saveFolderVersion(path),
      saveCurrent: () => (this.state.versionType === 'folder' ? saveFolderVersion(path) : saveManualVersion(path, vType)),
      preview: () => previewVersion(path, versionName, vType),
      compare: () => compareVersion(path, versionName, vType),
      restore: () => restoreVersion(path, versionName, vType),
      delete: () => deleteVersion(path, versionName, vType),
      timelinePreview: () => previewVersion(path, versionName, vType),
      timelineCompare: () => compareVersion(path, versionName, vType),
      timelineRestore: () => restoreVersion(path, versionName, vType),
      timelineDelete: () => deleteVersion(path, versionName, vType),
      save: () => saveManualVersion(path, vType),
      refresh: () => this._loadVersions(this.state.versionPath || path, this.state.versionType || vType),
    };
    const fn = calls[action];
    if (!fn) return;
    const result = fn();
    if (result && typeof result.then === 'function') await result;
    const reloadActions = new Set([
      'save', 'saveCurrent', 'restore', 'delete', 'saveFolder', 'restoreFolder', 'deleteFolder', 'promoteFolder',
      'timelineRestore', 'timelineDelete', 'timelineRestoreFolder', 'timelineDeleteFolder', 'timelinePromoteFolder',
    ]);
    if (reloadActions.has(action)) {
      const reloadPath = this.state.versionPath || path;
      const reloadType = this.state.versionType || vType || 'file';
      if (reloadPath) await this._loadVersions(reloadPath, reloadType);
    }
  }

  async _promoteFolderVersion(path, versionName) {
    const defaultLabel = '保存_' + new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
    const label = await cfPrompt('スナップショット名:', defaultLabel);
    if (label === null) return;
    await apiPost('/version/promote', { path, version: versionName, type: 'folder', label });
    showStatus('スナップショットにしました');
  }

  _previewEditEntry(entry) {
    if (!entry) return;
    const time = this._formatTimelineDate(entry);
    const oldValue = entry.old_value || entry.old_status || '';
    const newValue = entry.new_value || entry.new_status || '';
    const summary = entry.body_diff_summary || '';
    const o = document.createElement('div');
    o.className = 'modal-overlay';
    o.style.zIndex = '110';
    o.innerHTML = `<div class="gb-modal" style="min-width:560px;max-width:80vw;">
      <header class="gb-modal-header">
        <h3 class="gb-modal-title">${typeof lucide === 'function' ? lucide('pencilLine', 14) : ''} 変更レコード</h3>
        <button class="gb-modal-close" data-version-preview-close>${typeof lucide === 'function' ? lucide('x', 14) : 'x'}</button>
      </header>
      <div class="gb-modal-body" style="font-size:12px;line-height:1.5;">
        <div class="gb-section-desc" style="margin-bottom:8px;">${esc(time)} / ${esc(entry.user || '')}${entry.actor_model ? ' / ' + esc(entry.actor_model) : ''}</div>
        <div style="margin-bottom:8px;"><b>${esc(entry.action || '')}</b> ${esc(entry.entity_name || '')}${entry.property_name ? ' / ' + esc(entry.property_name) : ''}</div>
        ${summary ? `<pre style="white-space:pre-wrap;background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:8px;">${esc(summary)}</pre>` : ''}
        ${oldValue || newValue ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div><div class="gb-section-desc">変更前</div><pre style="white-space:pre-wrap;background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:8px;min-height:64px;">${esc(oldValue)}</pre></div>
          <div><div class="gb-section-desc">変更後</div><pre style="white-space:pre-wrap;background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:8px;min-height:64px;">${esc(newValue)}</pre></div>
        </div>` : ''}
      </div>
      <footer class="gb-modal-footer"><button class="gb-btn gb-btn-sm" data-version-preview-close>閉じる</button></footer>
    </div>`;
    o.querySelectorAll('[data-version-preview-close]').forEach(btn => btn.addEventListener('click', () => o.remove()));
    o.addEventListener('click', e => { if (e.target === o) o.remove(); });
    document.body.appendChild(o);
  }

  _bindVersionActions() {
    if (!this.el) return;
    this.el.querySelectorAll('[data-version-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const { versionAction, versionPath, versionName, versionType } = btn.dataset;
        if (versionAction === 'previewEdit') {
          const index = parseInt(btn.dataset.versionEntryIndex || '-1', 10);
          this._previewEditEntry(this._timelineEntries?.[index]);
          return;
        }
        this._runVersionAction(versionAction, versionPath || '', versionName || '', versionType || this.state.versionType || 'file');
      });
    });
    this.el.querySelectorAll('[data-version-filter]').forEach(input => {
      input.addEventListener('change', () => {
        if (input.dataset.versionFilter === 'kind') this.state.timelineKind = input.value || 'named,auto,edit';
        if (input.dataset.versionFilter === 'actor') this.state.timelineActorKind = input.value || '';
        const reloadPath = this.state.versionPath || this._getTabPath() || '';
        if (reloadPath) this._loadVersions(reloadPath, this.state.versionType || 'file');
      });
    });
  }

  _getFolderPath(path, vType) {
    if (vType === 'db') return path; // DBのパスはフォルダ
    if (vType === 'folder') return path;
    // ファイルパスの親フォルダ
    const idx = path.lastIndexOf('/');
    return idx > 0 ? path.substring(0, idx) : '';
  }

  _formatVersionDate(version) {
    if (typeof _versionDisplayDate === 'function') return _versionDisplayDate(version);
    const value = String(version?.created || version?.modified || '');
    return value ? value.substring(0, 19).replace('T', ' ') : '';
  }

  _formatTimelineDate(entry) {
    const value = String(entry?.timestamp || entry?.created || entry?.modified || '');
    return value ? value.substring(0, 19).replace('T', ' ') : '';
  }

  _versionSelectOption(value, label, current) {
    return `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(label)}</option>`;
  }

  _timelineIcon(entry) {
    if (entry.type === 'named') return 'tag';
    if (entry.type === 'auto') return 'history';
    return entry.actor_kind === 'llm' ? 'bot' : 'pencilLine';
  }

  _timelineLabel(entry) {
    if (entry.type === 'named') return entry.label ? `スナップショット「${entry.label}」` : 'スナップショット';
    if (entry.type === 'auto') return entry.label && entry.label !== '自動復元ポイント' ? `自動復元ポイント: ${entry.label}` : '自動復元ポイント';
    return entry.label || entry.body_diff_summary || entry.action || '変更レコード';
  }

  _timelineActions(entry, index) {
    if (entry.type === 'edit') {
      const editId = ['version-edit-preview', entry.id || index, entry.path || this.state.versionPath || '']
        .map(value => this._versionE2eToken(value))
        .filter(Boolean)
        .join('-');
      return `<button class="gb-btn gb-btn-xs" data-e2e-id="${esc(editId)}" data-version-action="previewEdit" data-version-entry-index="${index}" title="詳細">${typeof lucide === 'function' ? lucide('eye', 12) : '表示'}</button>`;
    }
    const path = entry.path || this.state.versionPath || '';
    const version = entry.snapshot_version || '';
    const type = entry.version_type || entry.snapshot_kind || this.state.versionType || 'file';
    if (type === 'folder') {
      return `<button class="gb-btn gb-btn-xs" ${this._versionButtonAttrs('timelineShowFolderFiles', path, version, 'folder')} title="一覧">${typeof lucide === 'function' ? lucide('eye', 12) : '一覧'}</button>
        ${entry.type === 'auto' ? `<button class="gb-btn gb-btn-xs" ${this._versionButtonAttrs('timelinePromoteFolder', path, version, 'folder')} title="スナップショットにする">${typeof lucide === 'function' ? lucide('bookmarkPlus', 12) : '保存'}</button>` : ''}
        <button class="gb-btn gb-btn-xs gb-btn-warn" ${this._versionButtonAttrs('timelineRestoreFolder', path, version, 'folder')} title="復元">${typeof lucide === 'function' ? lucide('rotateCcw', 12) : '復元'}</button>
        ${entry.type === 'named' ? `<button class="gb-btn gb-btn-xs gb-btn-danger" ${this._versionButtonAttrs('timelineDeleteFolder', path, version, 'folder')} title="削除">${typeof lucide === 'function' ? lucide('trash2', 12) : '削除'}</button>` : ''}`;
    }
    return `<button class="gb-btn gb-btn-xs" ${this._versionButtonAttrs('timelinePreview', path, version, type)} title="表示">${typeof lucide === 'function' ? lucide('eye', 12) : '表示'}</button>
      <button class="gb-btn gb-btn-xs" ${this._versionButtonAttrs('timelineCompare', path, version, type)} title="比較">${typeof lucide === 'function' ? lucide('gitCompare', 12) : '比較'}</button>
      <button class="gb-btn gb-btn-xs gb-btn-warn" ${this._versionButtonAttrs('timelineRestore', path, version, type)} title="復元">${typeof lucide === 'function' ? lucide('rotateCcw', 12) : '復元'}</button>
      ${entry.type === 'named' ? `<button class="gb-btn gb-btn-xs gb-btn-danger" ${this._versionButtonAttrs('timelineDelete', path, version, type)} title="削除">${typeof lucide === 'function' ? lucide('trash2', 12) : '削除'}</button>` : ''}`;
  }

  _buildTimelineHtml(path, vType, timelineEntries) {
    const entries = Array.isArray(timelineEntries) ? timelineEntries : [];
    const kind = this.state.timelineKind || 'named,auto,edit';
    const actor = this.state.timelineActorKind || '';
    const rows = entries.length ? entries.map((entry, index) => {
      const time = this._formatTimelineDate(entry);
      const actorBadge = entry.actor_kind === 'llm'
        ? `<span class="gb-badge gb-badge-auto">${typeof lucide === 'function' ? lucide('bot', 11) : ''}${esc(entry.actor_model || 'LLM')}</span>`
        : entry.actor_kind ? `<span class="gb-badge gb-badge-manual">${esc(entry.user || entry.actor_kind)}</span>` : '';
      const typeBadge = entry.type === 'named'
        ? '<span class="gb-badge gb-badge-manual">スナップショット</span>'
        : entry.type === 'auto'
          ? '<span class="gb-badge gb-badge-auto">自動</span>'
          : '<span class="gb-badge gb-badge-manual">変更</span>';
      return `<div class="gb-history-row gb-history-row-compact" style="align-items:center;">
        <span style="width:18px;display:inline-flex;align-items:center;justify-content:center;color:var(--fg2);">${typeof lucide === 'function' ? lucide(this._timelineIcon(entry), 14) : ''}</span>
        ${typeBadge}
        <span class="gb-history-label" title="${esc(entry.label || '')}"><span style="color:var(--fg2);">${esc(time)}</span> ${esc(this._timelineLabel(entry))}</span>
        ${actorBadge}
        <div class="gb-history-actions">${this._timelineActions(entry, index)}</div>
      </div>`;
    }).join('') : '<div class="gb-section-desc" style="padding:8px 0;">タイムラインに表示する項目がありません</div>';

    return `<section class="gb-version-timeline" style="margin-bottom:10px;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
        <button class="gb-btn gb-btn-xs gb-btn-primary" ${this._versionButtonAttrs('saveCurrent', path, '', vType)}>${typeof lucide === 'function' ? lucide('bookmarkPlus', 12) : '+'} スナップショットを作成</button>
        <span style="margin-left:auto;color:var(--fg2);display:inline-flex;align-items:center;gap:4px;">${typeof lucide === 'function' ? lucide('filter', 12) : ''}</span>
        <select data-e2e-id="version-timeline-kind-filter" data-version-filter="kind" style="font-size:12px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;padding:2px 4px;">
          ${this._versionSelectOption('named,auto,edit', '全て', kind)}
          ${this._versionSelectOption('named', 'スナップショット', kind)}
          ${this._versionSelectOption('auto', '復元ポイント', kind)}
          ${this._versionSelectOption('edit', '変更ログ', kind)}
        </select>
        <select data-e2e-id="version-timeline-actor-filter" data-version-filter="actor" style="font-size:12px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;padding:2px 4px;">
          ${this._versionSelectOption('', '全主体', actor)}
          ${this._versionSelectOption('human', '人間', actor)}
          ${this._versionSelectOption('llm', 'LLM', actor)}
        </select>
      </div>
      <div class="gb-history-list">${rows}</div>
    </section>`;
  }

  _versionE2eToken(value) {
    return String(value == null ? '' : value)
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  _versionButtonAttrs(action, path, versionName = '', vType = '') {
    const id = ['version', vType, path, versionName, action]
      .map(value => this._versionE2eToken(value))
      .filter(Boolean)
      .join('-');
    let attrs = `data-e2e-id="${esc(id)}" data-version-action="${esc(action)}"`;
    if (path != null) attrs += ` data-version-path="${esc(path)}"`;
    if (versionName) attrs += ` data-version-name="${esc(versionName)}"`;
    if (vType) attrs += ` data-version-type="${esc(vType)}"`;
    return attrs;
  }

  _buildHtml(path, vType, versions, folderPath, folderVersions, timelineEntries) {
    const safePath = esc(path);
    const fileName = path.split('/').pop() || path;
    const isFolder = vType === 'folder';

    // フォルダバージョンセクション（フォルダ選択中のみ表示）
    let folderSection = '';
    if (isFolder && folderPath) {
      const safeFolderPath = esc(folderPath);
      const folderName = folderPath.split('/').pop() || folderPath;
      let folderListHtml = '';
      if (!folderVersions || !folderVersions.length) {
        folderListHtml = '<div class="gb-section-desc" style="padding:8px 0;">フォルダバージョンがありません</div>';
      } else {
        folderVersions.forEach(v => {
          const dt = this._formatVersionDate(v);
          const label = v.label ? ' — ' + esc(v.label) : '';
          const fileCount = v.file_count || 0;
          const totalSize = v.total_size ? formatFileSize(v.total_size) : '';
          const badge = v.auto ? '<span class="gb-badge gb-badge-auto">自動</span>' : '<span class="gb-badge gb-badge-manual">手動</span>';
          folderListHtml += `<div class="gb-history-row gb-history-row-compact">
            ${badge}
            <span class="gb-history-label">${dt}${label}</span>
            <span class="gb-history-size">${fileCount}ファイル${totalSize ? ', ' + totalSize : ''}</span>
            <div class="gb-history-actions">
              <button class="gb-btn gb-btn-xs" ${this._versionButtonAttrs('showFolderFiles', folderPath, v.name, 'folder')}>一覧</button>
              ${v.auto ? `<button class="gb-btn gb-btn-xs" ${this._versionButtonAttrs('promoteFolder', folderPath, v.name, 'folder')}>${typeof lucide === 'function' ? lucide('bookmarkPlus', 12) : ''}</button>` : ''}
              <button class="gb-btn gb-btn-xs gb-btn-warn" ${this._versionButtonAttrs('restoreFolder', folderPath, v.name, 'folder')}>復元</button>
              ${v.auto ? '' : `<button class="gb-btn gb-btn-xs gb-btn-danger" ${this._versionButtonAttrs('deleteFolder', folderPath, v.name, 'folder')}>${lucide('x', 12)}</button>`}
            </div>
          </div>`;
        });
      }
      folderSection = `<details class="gb-version-section" open>
        <summary class="gb-version-section-header">${typeof lucide === 'function' ? lucide('folder', 14) : ''} フォルダバージョン（${esc(folderName)}）</summary>
        <div class="gb-version-section-body">
          <div style="margin-bottom:8px;">
            <button class="gb-btn gb-btn-xs gb-btn-primary" ${this._versionButtonAttrs('saveFolder', folderPath, '', 'folder')}>+ フォルダ版を保存</button>
          </div>
          ${folderListHtml}
        </div>
      </details>`;
    }

    // 個別ファイルバージョンセクション
    let fileListHtml = '';
    if (!versions.length) {
      fileListHtml = '<div class="gb-section-desc" style="padding:8px 0;">バージョンがありません</div>';
    } else {
      versions.forEach(v => {
        const dt = this._formatVersionDate(v);
        const badge = v.auto ? '<span class="gb-badge gb-badge-auto">自動</span>' : '<span class="gb-badge gb-badge-manual">手動</span>';
        const label = v.label ? ' — ' + esc(v.label) : '';
        fileListHtml += `<div class="gb-history-row gb-history-row-compact">
          ${badge}<span class="gb-history-label">${dt}${label}</span>
          <span class="gb-history-size">${formatFileSize(v.size)}</span>
          <div class="gb-history-actions">
            <button class="gb-btn gb-btn-xs" ${this._versionButtonAttrs('preview', path, v.name, vType)}>表示</button>
            <button class="gb-btn gb-btn-xs" ${this._versionButtonAttrs('compare', path, v.name, vType)}>比較</button>
            <button class="gb-btn gb-btn-xs gb-btn-warn" ${this._versionButtonAttrs('restore', path, v.name, vType)}>復元</button>
            <button class="gb-btn gb-btn-xs gb-btn-danger" ${this._versionButtonAttrs('delete', path, v.name, vType)}>${lucide('x', 12)}</button>
          </div>
        </div>`;
      });
    }
    const fileSection = `<details class="gb-version-section" open>
      <summary class="gb-version-section-header">${typeof lucide === 'function' ? lucide('file', 14) : ''} ファイルバージョン（${esc(fileName)}）</summary>
      <div class="gb-version-section-body">
        <div style="margin-bottom:8px;">
          <button class="gb-btn gb-btn-xs gb-btn-primary" ${this._versionButtonAttrs('save', path, '', vType)}>+ 保存</button>
        </div>
        ${fileListHtml}
      </div>
    </details>`;

    return `<div class="gb-version-panel" style="overflow:auto;flex:1;padding:8px;">
      <div class="gb-version-panel-header" style="display:flex;align-items:center;gap:6px;padding-bottom:8px;border-bottom:1px solid var(--border);margin-bottom:8px;">
        ${typeof lucide === 'function' ? lucide('gitBranch', 16) : ''}
        <span style="font-weight:bold;font-size:13px;">バージョン管理</span>
        <button class="gb-btn gb-btn-xs gb-btn-quiet" ${this._versionButtonAttrs('refresh', path, '', vType)} title="更新">${typeof lucide === 'function' ? lucide('refreshCw', 12) : '↻'}</button>
      </div>
      ${this._buildTimelineHtml(path, vType, timelineEntries)}
      ${folderSection}
      ${isFolder ? '' : fileSection}
    </div>`;
  }

  getState() {
    return {
      versionPath: this.state.versionPath || '',
      versionType: this.state.versionType || 'file',
      timelineKind: this.state.timelineKind || 'named,auto,edit',
      timelineActorKind: this.state.timelineActorKind || '',
    };
  }

  restoreState(s) {
    super.restoreState(s);
    if (s) {
      this.state.versionPath = s.versionPath || '';
      this.state.versionType = s.versionType || 'file';
      this.state.timelineKind = s.timelineKind || 'named,auto,edit';
      this.state.timelineActorKind = s.timelineActorKind || '';
    }
  }
}

// === コンポーネントレジストリ登録 ===
// Audit-P2 H-7: requiresViewLock は計画書 §8.2 に基づく。
registerToolComponent('outliner',   { cls: OutlinerComponent, icon: 'folderTree', label: 'フォルダ', multi: false });
registerToolComponent('db',         { cls: DatabaseComponent, icon: 'db', label: 'シート', multi: true, requiresViewLock: true });
registerToolComponent('page',       { cls: EditorComponent, icon: 'page', label: 'ページ', multi: true, requiresViewLock: true });
// CanvasComponent は gb-tool-canvas.js で登録済み (Phase C)。計画書 §8.2 より requiresViewLock=false。
// CalendarComponent は gb-tool-calendar.js で登録済み (Phase C)。requiresViewLock=true。
registerToolComponent('chat',       { cls: ChatComponent, icon: 'messagesSquare', label: 'チャット', multi: false });
registerToolComponent('annotation', { cls: AnnotationComponent, icon: 'stickyNote', label: '注釈', multi: false });
registerToolComponent('history',    { cls: HistoryComponent, icon: 'history', label: 'ヒストリー', multi: false });
registerToolComponent('detail',     { cls: DetailComponent, icon: 'slidersHorizontal', label: 'オプション', multi: false });
registerToolComponent('folder',     { cls: FolderComponent, icon: 'folder', label: 'フォルダビュー', multi: true, requiresViewLock: true });
registerToolComponent('media',      { cls: MediaComponent, icon: 'galleryThumbnails', label: 'メディア', multi: true, requiresViewLock: true });
registerToolComponent('compare',    { cls: CompareComponent, icon: 'columns', label: '比較', multi: true, requiresViewLock: true });
registerToolComponent('search',     { cls: SearchComponent, icon: 'search', label: '検索', multi: false });
registerToolComponent('version',    { cls: VersionComponent, icon: 'gitBranch', label: 'バージョン管理', multi: true });
