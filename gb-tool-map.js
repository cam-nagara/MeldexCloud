/* First-class map tab, using the shared guarded file API and panel lifecycle. */
class MapAppComponent extends ToolComponent {
  create() {
    this.el = document.createElement('section'); this.el.className = 'gb-map-app';
    this.el.setAttribute('aria-label', 'マップ'); this.el.dataset.e2eId = 'map-app'; this.el._gbMapApp = this;
    this._generation = 0; this._draftOwner = MeldexMapDocument.id(); this._activeLayer = 'places';
    this._beforeUnload = event => { if (this.store?.dirty || this._inputDirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', this._beforeUnload);
    this.el.addEventListener('keydown', event => { if (this.handleKeyDown(event)) { event.preventDefault(); event.stopPropagation(); } });
    return this.el;
  }
  // サブパネル等のレイアウト外の仮想ペインでも自分のタブを見つける。
  _tab() { return (GBLayout.findNode(GBLayout.root, this.paneId)?.node || GBLayout.paneMap?.[this.paneId]?.node)?.tabs?.find(t => t.id === this.tabId); }
  get editingDisabled() { return this.readOnly || !!this.state.mapBrowseMode; }
  _saveViewState() {
    const tab = this._tab(); if (tab) tab.state = { ...tab.state, ...this.state };
    GBLayout.saveLayout();
  }
  _layerVisible(layer) { return this.state.mapLayerVisibility?.[layer.id] ?? layer.visible; }
  _toggleBrowseMode() {
    this._commitInput(); if (this._inputDirty) { this._message('入力内容を確認してください'); return; }
    this.state.mapBrowseMode = !this.state.mapBrowseMode;
    this.state.mapViewport = { center: this.view.xy(this.view.map.getCenter()), zoom: this.view.map.getZoom() };
    this._generatorPreview?.destroy(); this._settlementsPreview?.destroy(); this._climatePreview?.destroy(); this._worldPreview?.destroy();this._terrainPreview?.destroy(); this._interchange?.destroy();
    this.view.destroy(); this._build(); this._render(); this._saveViewState();
    this._message(this.readOnly ? 'このマップは読み取り専用です。地点や図形は編集できません。'
      : this.state.mapBrowseMode ? '閲覧モードです。地点の移動・作図・編集を停止しています。' : '作図モードです。地点や図形を編集できます。');
  }
  activate() {
    super.activate();
    const path = this._tab()?.path || this.state.mapPath;
    if (path && path !== this.path) this.ready = this.load(path);
    else if (!path && !this.store) {
      this.el.replaceChildren();
      const message = document.createElement('p'); message.textContent = this._tab()?.state?.pendingCreate ? 'マップを作成しています…' : 'マップを作成するか、フォルダツリーから開いてください。';
      this.el.append(message);
      if (!this._tab()?.state?.pendingCreate) this.el.append(this._button('マップを作成', () => addPanelMenuTool('map', { paneId: this.paneId })));
    }
    this.view?._resize();
    this._syncDetailPanel();
    if (this.paneId === GBLayout.activePane && typeof historySetScope === 'function') historySetScope(this._historyScope());
  }
  async load(path, options = {}) {
    if (!MeldexMapDocument.isAvailable()) { this.el.textContent = 'マップ初期版はデスクトップ版本体で開いてください。'; return false; }
    if (this.store && !options.ignoreDraft && !await this.flush()) return false;
    if (this.store?.dirty && options.ignoreDraft) {
      // The reload confirmation promises to retain the unsaved draft. A new
      // owner prevents the clean loaded store from deleting that draft key.
      const ignored = this._ignoredDraftKeys ||= new Set();
      ignored.add(this._draftKey());
      if (this._recoveredKey) ignored.add(this._recoveredKey);
      this._draftOwner = MeldexMapDocument.id(); this._recoveredKey = null;
    }
    const generation = ++this._generation;
    const storageScope = this._draftScope();
    this._sheetSignature = null; this._sheetCache = new Map(); this._directParents = [];
    clearTimeout(this._saveTimer); this._generatorPreview?.destroy(); this._settlementsPreview?.destroy(); this._climatePreview?.destroy(); this._worldPreview?.destroy();this._terrainPreview?.destroy(); this._interchange?.destroy(); this.view?.destroy(); MeldexMapChrome.destroy(this); this.view = null; this.store = null; this.path = path;
    this.el.textContent = 'マップを読み込んでいます…';
    try {
      const [loaded, access] = await Promise.all([apiFetch('/file?path=' + encodeURIComponent(path)), MeldexEntityDetail.resolveReadOnly(path, false)]);
      if (generation !== this._generation || !this.el) return false;
      if ((!storageScope && !access.readOnly) || storageScope !== this._draftScope()) throw new Error('保存先を確認できません。元の保存先でマップを開き直してください');
      const doc = MeldexMapDocument.parse(loaded.content);
      this._draftStorageScope = storageScope;
      this._draftLegacyIdentity = 'legacy:' + loaded.etag;
      this._draftKeys = new Set();
      this.readOnly = !!access.readOnly;
      const target = path;
      this.store = new MeldexMapDocument.Store(doc, loaded.etag, async (content, etag) => {
        const actual = this.path;
        try {
          const write = (async () => {
            const requireScope = () => { if (!storageScope || storageScope !== this._draftScope()) throw new Error('保存先が切り替わりました。元の保存先へ戻るか、マップを書き出してください'); };
            requireScope();
            const access = await MeldexEntityDetail.resolveReadOnly(actual, false);
            if (access.readOnly) throw new Error('マップは読み取り専用です');
            requireScope();
            const result = await apiPut('/file?path=' + encodeURIComponent(actual), { content, if_match_etag: etag }, { silentError: true });
            await window.GbBacklinks?.requestUpdate?.(actual);
            return result;
          })();
          return await (window.MeldexDiagnostics?.watchSheetTask?.('map.save', actual, write, { label: 'マップの保存' }) || write);
        } catch (error) {
          this._message('マップを保存できません: ' + (error.userMessage || error.message));
          window.MeldexDiagnostics?.recordSheetIncident?.('save-failed', {
            op: 'map.save', endpoint: '/file', method: 'PUT', sheet: actual,
            status: Number(error.status || error.httpStatus || 0), errorType: String(error.name || 'Error').slice(0,60),
          });
          throw error;
        }
      }, () => this._changed());
      const cached = !options.ignoreDraft && !this.readOnly && await this._readDraft();
      if (cached && await cfConfirm('保存できていないマップの下書きを復元しますか？')) {
        if (generation !== this._generation || this.path !== target || storageScope !== this._draftScope()) return false;
        this.store.doc = MeldexMapDocument.parse(cached.doc); this.store.etag = cached.etag;
        this.store.revision++; this._recoveredKey = cached.key;
      }
      if (generation !== this._generation || !this.el || storageScope !== this._draftScope()) return false;
      this.state = { ...this.state, mapPath: path, label: doc.display_title || doc.title };
      if (this._tab()) this._tab().state = { ...this._tab().state, ...this.state };
      this._activeLayer = this.store.doc.layers[0].id; this._selected = null; this._selection = new Set(); this._inputDirty = false;
      this._inspectorShown = false;
      this._build(); this._render(); this._changed();
      this._convertLegacyTerrain(generation).catch(error => this._message('旧方式の地形を変換できませんでした: ' + (error.userMessage || error.message)));
      MeldexMapRelations.findParents(this).catch(() => {});
      this._syncDetailPanel();
      if (typeof addRecent === 'function') addRecent(this.state.label, path, 'map');
      return true;
    } catch (error) {
      if (generation !== this._generation || !this.el) return false;
      this.view?.destroy(); this.view = null; this.store = null;
      this.el.replaceChildren();
      const message = document.createElement('p'); message.textContent = 'マップを開けません: ' + (error.userMessage || error.message);
      this.el.append(message, this._button('再読込', () => this.load(path)));
      return false;
    }
  }
  _button(label, action, options = {}) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'gb-btn'; button.textContent = label;
    button.dataset.mapAction = options.id || label; button.disabled = !!options.disabled;
    button.addEventListener('click', async event => { try { await action(event); } catch (error) { this._message(error.userMessage || error.message); } });
    return button;
  }
  _message(text) { if (this.message) this.message.textContent = text; if (typeof showStatus === 'function') showStatus(text); }
  _historyScope(path = this.path || this._tab()?.path || this.state.mapPath) {
    return path ? 'map:' + String(path).replace(/\\/g, '/') : '';
  }
  _hasCommonHistory() {
    return !!this._historyScope() && typeof historyPush === 'function'
      && typeof historyUndo === 'function' && typeof historyRedo === 'function'
      && typeof historyCanUndo === 'function' && typeof historyCanRedo === 'function';
  }
  _historyTarget(scope) {
    if (typeof getComponentInstance === 'function' && typeof _meldexActiveTabForPane === 'function') {
      const tab = _meldexActiveTabForPane();
      const active = tab?.type === 'map' ? getComponentInstance(tab.id) : null;
      if (active?.store && active._historyScope?.() === scope) return active;
    }
    if (this.el?.isConnected && this.store && this._historyScope() === scope) return this;
    if (typeof getComponentInstance === 'function' && typeof _meldexFindTabForHistoryScope === 'function') {
      const match = _meldexFindTabForHistoryScope(scope);
      const target = match ? getComponentInstance(match.tabId) : null;
      if (target?.store && target._historyScope?.() === scope) return target;
    }
    return null;
  }
  _restoreHistorySnapshot(snapshot, scope) {
    const target = this._historyTarget(scope);
    if (!target) return false;
    if (target !== this) return target._restoreHistorySnapshot(snapshot, scope);
    const next = MeldexMapDocument.parse(MeldexMapDocument.clone(snapshot));
    for (const key of ['title', 'display_title', 'meldex']) {
      if (this.store.doc[key] !== undefined) next[key] = MeldexMapDocument.clone(this.store.doc[key]);
    }
    this.store.doc = next;
    this.store.revision++;
    this.store.error = null;
    this.store.changed(this.store);
    this._inputDirty = false;
    this.view?.cancel();
    this._buildSettingsRefresh();
    this._render();
    return true;
  }
  _draftScope() {
    const runtime = window.MeldexRuntimeAdapter;
    const workspace = runtime?.getWorkspaceState?.();
    const mode = runtime?.getMode?.() || 'legacy';
    const kind = workspace?.kind || mode;
    if (mode === 'dropbox' || kind === 'dropbox') return mode === 'dropbox' && kind === 'dropbox' && workspace?.accountId && workspace?.securityScopeId
      ? JSON.stringify(['dropbox', workspace.accountId, workspace.securityScopeId]) : null;
    const root = workspace?.path || (typeof state !== 'undefined' && state.vaultPath);
    return root ? JSON.stringify([mode, kind, String(root).replace(/\\/g, '/')]) : null;
  }
  _draftIdentity() { return this.store?.doc?.meldex?.document_id || this._draftLegacyIdentity || null; }
  _draftPrefix() { return 'meldex-map-draft:v2:' + encodeURIComponent(JSON.stringify([this._draftStorageScope, this._draftIdentity(), this.path])) + ':'; }
  _draftKey() { return this._draftPrefix() + this._draftOwner; }
  async _readDraft() {
    try {
      const scope = this._draftStorageScope, identity = this._draftIdentity(), prefix = this._draftPrefix();
      if (!scope || !identity || scope !== this._draftScope()) return null;
      const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(key => key?.startsWith(prefix) && !this._ignoredDraftKeys?.has(key));
      const large = await MeldexMapDocument.drafts.list(prefix).catch(() => []);
      if (scope !== this._draftScope() || identity !== this._draftIdentity() || prefix !== this._draftPrefix()) return null;
      return [...keys.map(key => { try { return { ...JSON.parse(localStorage.getItem(key)), key }; } catch (_) { return null; } }),
        ...large.filter(draft => draft.key?.startsWith(prefix) && !this._ignoredDraftKeys?.has(draft.key))]
        .filter(draft => { try { return draft && draft.scope === scope && draft.documentId === identity
          && (MeldexMapDocument.parse(draft.doc).meldex?.document_id || this._draftLegacyIdentity) === identity
          && typeof draft.etag === 'string'; } catch (_) { return false; } })
        .sort((a, b) => b.time - a.time)[0] || null;
    } catch (_) { return null; }
  }
  _changed() {
    const store = this.store;
    if (!store || !this.el) return;
    if (store.dirty) {
      const draft={doc:store.doc,etag:store.etag,time:Date.now(),key:this._draftKey(),scope:this._draftStorageScope,documentId:this._draftIdentity()};
      (this._draftKeys ||= new Set()).add(draft.key);
      // Avoid serializing a known-large atlas into the small synchronous store
      // only to hit its quota. The durable transaction is still awaited by flush.
      const atlas = store.doc.atlas;
      const large = (store.doc.background?.data_url?.length || 0) + (atlas ?
        Object.values(atlas.modes || {}).reduce((sum, shapes) => sum + shapes.reduce((n, shape) => n + shape.path.length, 0), 0) : 0) > 1024 * 1024;
      let written = false;
      if (!large) try { localStorage.setItem(draft.key, JSON.stringify(draft)); this._draftFailed = false; written = true; } catch (_) {}
      if (!written) {
        // Serialize writes and deletes so an older in-flight copy cannot
        // overwrite a newer edit or reappear after a successful file save.
        this._draftPending=(this._draftPending || Promise.resolve()).then(()=>MeldexMapDocument.drafts.put(draft.key,draft))
          .then(()=>{if(this.store!==store||store.doc!==draft.doc||!store.dirty)return;this._draftFailed=false;try{localStorage.setItem(draft.key,JSON.stringify({indexedDB:true,time:draft.time}));}catch(_){};})
          .catch(()=>{if(this.store!==store||store.doc!==draft.doc||!store.dirty)return;this._draftFailed=true;if(this.saveStatus)this.saveStatus.textContent+='（下書きの保全にも失敗しました。マップを書き出してください）';});
      }
    } else {
      const keys=[...new Set([this._draftKey(),this._recoveredKey,...(this._draftKeys || [])])].filter(key=>key&&!this._ignoredDraftKeys?.has(key));
      try { keys.forEach(key=>localStorage.removeItem(key)); } catch (_) {}
      this._draftPending=(this._draftPending || Promise.resolve()).then(()=>Promise.all(keys.map(key=>MeldexMapDocument.drafts.remove(key)))).catch(()=>{});
      this._recoveredKey = null;
      this._draftKeys?.clear();
    }
    if (this.saveStatus) {
      let status = store.error ? '保存できません: ' + (store.error.userMessage || store.error.message)
        : store.pending ? '保存しています…' : this.readOnly ? '読み取り専用' : store.dirty ? '未保存' : '保存済み';
      if (this._draftFailed && store.dirty) status += '（下書きの保全にも失敗しました。マップを書き出してください）';
      if (this.saveStatus.textContent !== status) this.saveStatus.textContent = status;
      if (this.saveStatus.title !== status) this.saveStatus.title = status;
      this.saveStatus.classList.toggle('error', !!store.error || !!this._draftFailed && store.dirty);
    }
    for (const host of [this.optionsRoot,this.inspector].filter(Boolean)) {
      let notice=host.querySelector(':scope > .gb-inline-error');
      if(!notice&&(store.error||this._draftFailed&&store.dirty)) { notice=GBUI.createInlineError({onRetry:()=>this.flush()});host.prepend(notice); }
      if(notice) {
        const message=store.error ? '保存できません: '+String(store.error.userMessage||store.error.message||'').replace(/[。．.\s]+$/,'')+'。未保存の編集を保持しています。保存先を確認して再試行してください'
          : this._draftFailed&&store.dirty ? '下書きを保全できません。マップを書き出してください' : '';
        notice.setMessage(message);notice.setBusy(!!store.pending);
      }
    }
    const commonHistory = this._hasCommonHistory();
    const scope = commonHistory ? this._historyScope() : '';
    if (this.undoButton) this.undoButton.disabled = this.editingDisabled || !(commonHistory ? historyCanUndo(scope) : store.undoStack.length);
    if (this.redoButton) this.redoButton.disabled = this.editingDisabled || !(commonHistory ? historyCanRedo(scope) : store.redoStack.length);
    clearTimeout(this._saveTimer);
    if (store.dirty && !store.pending && !store.error && !this.readOnly) this._saveTimer = setTimeout(() => { if (this.store === store) store.save(); }, 800);
  }
  update(mutator, history = true, label = 'マップを編集') {
    if (this.editingDisabled || !this.store) return false;
    try {
      if (!history || !this._hasCommonHistory()) return this.store.update(mutator, history);
      const before = MeldexMapDocument.clone(this.store.doc);
      if (!this.store.update(mutator, false)) return false;
      const scope = this._historyScope();
      if (label === 'マップを編集') label = this._historyLabel(before, this.store.doc);
      historyPush(label,
        () => this._restoreHistorySnapshot(before, scope),
        undefined,
        scope);
      return true;
    }
    catch (error) { this._message(error.message); return false; }
  }
  // 履歴名を変更内容から決める（ほとんどの操作が既定名「マップを編集」で登録されていたため）。
  _historyLabel(before, after) {
    const same = key => JSON.stringify(before?.[key] ?? null) === JSON.stringify(after?.[key] ?? null);
    const beforeFeatures = before?.features || [], afterFeatures = after?.features || [];
    const name = feature => feature?.label ? '「' + String(feature.label).slice(0, 20) + '」' : '';
    if (afterFeatures.length > beforeFeatures.length) {
      const added = afterFeatures.find(f => !beforeFeatures.some(b => b.id === f.id));
      return 'マップ: ' + (({ pin: '地点', route: '経路', region: '領域', label: '地名' })[added?.kind] || '地点・図形') + 'を追加';
    }
    if (afterFeatures.length < beforeFeatures.length) return 'マップ: 地点・図形を削除';
    if (!same('features')) {
      const changed = afterFeatures.filter(f => JSON.stringify(f) !== JSON.stringify(beforeFeatures.find(b => b.id === f.id)));
      if (changed.length > 1) return 'マップ: ' + changed.length + '件の地点・図形を変更';
      const previous = beforeFeatures.find(b => b.id === changed[0]?.id);
      if (changed[0] && previous && JSON.stringify(changed[0].points) !== JSON.stringify(previous.points)) return 'マップ: ' + name(changed[0]) + '位置を変更';
      return 'マップ: ' + name(changed[0]) + '内容を変更';
    }
    if (!same('layers')) return 'マップ: レイヤーを変更';
    if (!same('scale')) return 'マップ: 縮尺・方位を変更';
    if (!same('atlas') || !same('terrain')) return 'マップ: 地形を変更';
    if (!same('background')) return 'マップ: 背景を変更';
    if (!same('periods')) return 'マップ: 時代・章を変更';
    if (!same('display')) return 'マップ: 表示を変更';
    if (!same('title')) return 'マップ: 名前を変更';
    return 'マップを編集';
  }
  _editGuard(featureId = null) {
    const store = this.store, generation = this._generation, system = store?.doc.coordinate_system;
    return () => {
      if (!store || this.store !== store || this._generation !== generation || this.editingDisabled || store.doc.coordinate_system !== system) return false;
      if (!featureId) return true;
      const feature = store.doc.features.find(f => f.id === featureId);
      return !!feature && !store.doc.layers.find(l => l.id === feature.layer_id)?.locked;
    };
  }
  _action(action) {
    const doc = this.store.doc, layer = doc.layers.find(l => l.id === this._activeLayer);
    if (this.editingDisabled) return;
    if (action.source && action.source !== doc.features) { this.view._features(); this._message('地図が変更されたため操作を取り消しました'); return; }
    if(action.type==='atlas-stroke'){MeldexMapTerrainControls.paint(this,action).catch(e=>this._message(e.message));return;}
    if (action.type === 'transform') {
      const editable = action.changes.filter(change => doc.features.some(f => f.id === change.id && !doc.layers.find(l => l.id === f.layer_id)?.locked));
      this.update(next => { for (const change of editable) next.features.find(f => f.id === change.id).points = MeldexMapDocument.clone(change.points); });
    } else if (action.type === 'erase') {
      this._deleteSelected(action.ids); return;
    } else if (action.type === 'terrain') {
      this.update(next => { next.terrain = action.terrain; delete next.atlas; next.schema_version=1; delete next.terrain.environment; delete next.terrain.presentation; });
      this._buildSettingsRefresh();
    }
    else if (action.type === 'add') {
      if (!layer || layer.locked) { this._message('編集ロック中のレイヤーには追加できません'); return; }
      const feature = MeldexMapDocument.feature(action.kind, action.points, layer.id,
        ({ pin: '地点', route: '経路', region: '領域', label: '地名' })[action.kind]);
      feature.icon = action.icon || 'pin'; feature.color = this.colorInput.value;
      if(action.kind==='route'){const kind=action.role||this.view.routeKind||'major';feature.cartography={role:kind==='major'?'road':kind==='other'?'':kind,rank:kind==='major'?'major':'minor'};feature.line_style='curve';if(kind==='river')feature.color='#427f9f';if(kind==='railway')feature.color='#555b60';if(kind==='shipping')feature.color='#628798';}
      if (this.update(next => next.features.push(feature))) { this._selected = feature.id; this._selection = new Set([feature.id]); this._inspectorShown = true; }
    } else if (['move', 'vertex'].includes(action.type)) {
      const feature = doc.features.find(f => f.id === action.id);
      if (!feature || doc.layers.find(l => l.id === feature.layer_id)?.locked) return;
      this.update(next => {
        const target = next.features.find(f => f.id === action.id);
        if (action.type === 'vertex') target.points[action.index] = action.point;
        else target.points = [action.point];
      });
    }
    this._render();
    if (action.type === 'add') MeldexMapChrome.details(this, 'map-selection');
    if (action.edit) this._editName(this._selected);
  }
  _select(id) { this._selectMany(id ? [id] : [], id); }
  _selectMany(ids, active = null) {
    this._selection = new Set(ids.filter(id => this.store.doc.features.some(f => f.id === id)));
    this._selected = active && this._selection.has(active) ? active : [...this._selection].at(-1) || null;
    this._inspectorShown = !!this._selected;
    this.view.selectedIds = new Set(this._selection); this.view.selectedId = this._selected; this.view._features(); this._renderPlaces(); this._renderInspector();
    MeldexMapChrome.details(this, this._selected ? 'map-selection' : 'map-settings');
  }
  _editName(id) {
    this._select(id); if (!id || !this._editGuard(id)()) return;
    let input = this.inspector.querySelector('[aria-label="名前"]');
    if (input && !input.getClientRects().length) this.inspectorToggle?.click();
    input = this.inspector.querySelector('[aria-label="名前"]'); input?.focus(); input?.select();
  }
  async _deleteSelected(ids = [...(this._selection || [])]) {
    if (this.editingDisabled) return;
    const source = this.store.doc, canEdit = this._editGuard();
    const allowed = new Set(source.features.filter(f => ids.includes(f.id) && !source.layers.find(l => l.id === f.layer_id)?.locked).map(f => f.id));
    if (!allowed.size) return;
    if (!canEdit() || this.store.doc !== source) return;
    if (this.update(doc => { doc.features = doc.features.filter(f => !allowed.has(f.id)); }, true, 'マップの項目を削除')) { this._selectMany([]); this._render(); }
  }
  _duplicateSelected() {
    if (this.editingDisabled) return;
    const D = MeldexMapDocument, source = this.store.doc, features = source.features.filter(f => this._selection?.has(f.id) && !source.layers.find(l => l.id === f.layer_id)?.locked);
    const delta = MeldexMapInteraction.rotate([20, 20], -this.view.rotation), zoom = this.view.map.getZoom();
    const copies = features.map(f => ({ ...D.clone(f), id: D.id(), label: f.label + ' コピー', points: f.points.map(p => this.view.xy(this.view.map.unproject(this.view.map.project(this.view.latlng(p), zoom).add(L.point(...delta)), zoom))) }));
    D.parse(JSON.stringify({ ...source, features: source.features.concat(copies) }, null, 2));
    if (this.update(doc => doc.features.push(...copies))) { this._selectMany(copies.map(f => f.id)); this._render(); }
  }
  async _command(name) {
    try {
      this._commitInput(); if (this._inputDirty) { this._message('入力内容を確認してください'); return; }
      if (name === 'delete') await this._deleteSelected(); else if (name === 'duplicate') this._duplicateSelected();
    } catch (error) { this._message(error.message); }
  }
  _navigateSelection(key, additive = false) {
    const f = this.store.doc.features.find(f => f.id === this._selected), center = feature => { const p = feature.points.map(p => this.view.screenPoint(p)); return [p.reduce((s, p) => s + p[0], 0) / p.length, p.reduce((s, p) => s + p[1], 0) / p.length]; };
    const origin = f ? center(f) : [0, 0]; let best = null, distance = Infinity;
    for (const next of this.store.doc.features.filter(f => this.view._visible(f) && f.id !== this._selected)) {
      const p = center(next), x = p[0] - origin[0], y = p[1] - origin[1];
      if (f && !({ ArrowLeft: x < 0, ArrowRight: x > 0, ArrowUp: y < 0, ArrowDown: y > 0 })[key]) continue;
      const d = Math.hypot(x, y); if (d < distance) { best = next; distance = d; }
    }
    if (best) { this._selectMany(additive ? [...this._selection, best.id] : [best.id], best.id); this.view.focus(best); }
  }
  _editFeature(mutator) {
    const id = this._selected, layer = this.store.doc.layers.find(l => l.id === this.store.doc.features.find(f => f.id === id)?.layer_id);
    if (!layer || layer.locked) { this._message('編集ロック中のレイヤーは変更できません'); return; }
    this.update(doc => { const feature = doc.features.find(f => f.id === id); if (feature) mutator(feature); });
    this._inputDirty = false; this._render();
  }
  _setTool(tool) {
    if(this.store.doc.atlas&&(!this.store.doc.atlas.surface||this.store.doc.atlas.locked)&&['land','sea'].includes(tool)){this._message('Azgaarの地形は「世界地図を生成」で更新してください。地点・図形は通常どおり編集できます。');return;}
    if (this.editingDisabled && !['select', 'measure'].includes(tool)) return;
    this.view.setTool(tool, this.symbolInput.value);
    if (tool !== 'select') { this._inspectorShown = false; this._renderInspector(); this.sidebar.hidden = true; this.sidebarToggle?.setAttribute('aria-pressed', 'false'); }
    this.toolButtons.forEach((button, key) => button.setAttribute('aria-pressed', String(key === tool)));
    this._message(({ select: this.editingDisabled ? '地点や図形を選択します。閲覧中は移動しません。' : '地点や図形を選択します。地点はドラッグで移動できます。', pin: '地図をクリックして地点を置きます。',
      label: '地図をクリックして地名を置きます。', symbol: '地図をクリックして記号を置きます。',
      route: '経路の各点をクリックし、「確定」で完了します。', region: '領域の頂点をクリックし、「確定」で閉じます。',
      river:'ドラッグして川をベクターで描きます。描いた後に「周囲の地形を合わせる」で谷を作れます。', measure: '計測する各点をクリックしてください。', land: this.store.doc.atlas?'ドラッグして選択中の地形を描きます。':'ドラッグして陸地を描きます。', sea: 'ドラッグして海を描きます。', erase: '消す図形をなぞります。元に戻すで復旧できます。' })[tool]);
    this.view._features();
    MeldexMapChrome.refresh(this);
  }
  _render() {
    if (!this.store || !this.view) return;
    // Adoption / Redo can replace a legacy terrain while its brush is active.
    if(this.store.doc.atlas&&(!this.store.doc.atlas.surface||this.store.doc.atlas.locked)&&['land','sea'].includes(this.view.tool))this._setTool('select');
    if (!this.store.doc.layers.some(layer => layer.id === this._activeLayer)) this._activeLayer = this.store.doc.layers[0].id;
    this.view.elementVisibility=this.state.mapElementVisibility||null;
    this.view.periodId = MeldexMapPeriods.selected(this);
    this.view.setRotation(this.state.mapRotation || 0, false);
    this.view.filter = typeof this.state.mapSearch === 'string' ? this.state.mapSearch.trim().toLocaleLowerCase() : '';
    this.view.featureKind = this.state.mapFeatureKind || '';
    this.view.layerVisibility = this.state.mapLayerVisibility || {};
    const viewport = this.state.mapViewport;
    this._selection = new Set([...(this._selection || [])].filter(id => this.store.doc.features.some(f => f.id === id)));
    this.view.selectedIds = new Set(this._selection); this.view.selectedId = this._selected;
    // Tab viewport is only reused in the coordinate system that captured it.
    this.view.setDocument({ ...this.store.doc, view: viewport && this.state.mapViewSystem === this.store.doc.coordinate_system ? viewport : this.store.doc.view }, this.editingDisabled);
    this._renderZoom();
    MeldexMapPeriods.render(this); this._renderLayers(); this._renderPlaces(); this._renderInspector(); this._changed();
    MeldexMapSavedViews.render(this);
    this.breadcrumbs.replaceChildren(); MeldexMapRelations.breadcrumbs(this, this.breadcrumbs);
    this.sheetSources.replaceChildren(); MeldexMapRelations.sources(this, this.sheetSources);
    MeldexMapRelations.refresh(this).catch(error => { this.sheetStatus.textContent = error.message; });
    for(const key of ['land','sea']){const b=this.toolButtons.get(key);if(b){b.disabled=this.editingDisabled||!!this.store.doc.atlas&&(!this.store.doc.atlas.surface||!!this.store.doc.atlas.locked);if(this.store.doc.atlas)b.title=this.store.doc.atlas.locked?'地形をロックしています':'ドラッグして地形を描きます';else b.title=b.getAttribute('aria-label')||key;}}
    this.localControls.forEach(el => { el.hidden = this.store.doc.coordinate_system !== 'local'; });
    this.worldControls.forEach(el => { el.hidden = this.store.doc.coordinate_system !== 'world'; });
    MeldexMapChrome.refresh(this);
  }
  _build() {
    if (this._mapParking) MeldexMapChrome.destroy(this);
    this.el.replaceChildren(); this.localControls = []; this.worldControls = []; this.toolButtons = new Map();
    const toolbar = document.createElement('div'); toolbar.className = 'gb-map-toolbar'; this.el.appendChild(toolbar);
    this.browseButton = this._button('閲覧モード', () => this._toggleBrowseMode()); this.browseButton.setAttribute('aria-pressed', String(!!this.state.mapBrowseMode)); toolbar.appendChild(this.browseButton);
    this.breadcrumbs = document.createElement('nav'); this.breadcrumbs.setAttribute('aria-label', '親子地図'); toolbar.appendChild(this.breadcrumbs);
    toolbar.append(this._button('新規', () => addPanelMenuTool('map', { paneId: this.paneId })), this._button('保存', () => this.flush(), { disabled: this.readOnly }),
      this._button('再読込', () => this.reload()), this._button('マップを書き出す', () => this.exportDocument()),
      this._button('データ入出力', () => MeldexMapControls.interchange(this)));
    this.undoButton = this._button('元に戻す', () => this.restore('undo')); this.undoButton.setAttribute('data-undo-button', '');
    this.redoButton = this._button('やり直す', () => this.restore('redo')); this.redoButton.setAttribute('data-redo-button', '');
    toolbar.append(this.undoButton, this.redoButton, this._button('全体表示', () => this.view.fit()));
    const exportPNG = this._button('PNG', async () => {
      const blob = await this.view.exportPNG(); if (!blob) throw new Error('画像を作成できませんでした');
      await MeldexExportSave.saveBlob(blob, { filename: this.state.label + '.png', extension: '.png' });
    }); toolbar.appendChild(exportPNG); this.localControls.push(exportPNG);
    const packageExport = this._button('持ち出しパッケージ', () => MeldexMapPackage.show(this));
    toolbar.appendChild(packageExport); this.localControls.push(packageExport);
    this.sidebarToggle = this._button('一覧・設定', () => {
      this.sidebar.hidden = !this.sidebar.hidden; this.sidebarToggle.setAttribute('aria-pressed', String(!this.sidebar.hidden));
    }); this.sidebarToggle.setAttribute('aria-pressed', 'true'); toolbar.appendChild(this.sidebarToggle);
    this.inspectorToggle = this._button('選択項目', () => { this._inspectorShown = !this._inspectorShown; this._renderInspector(); }); toolbar.appendChild(this.inspectorToggle);
    this.saveStatus = document.createElement('span'); this.saveStatus.className = 'gb-map-save-status'; this.saveStatus.setAttribute('role', 'status'); toolbar.appendChild(this.saveStatus);
    const tools = document.createElement('div'); tools.className = 'gb-map-tools'; tools.setAttribute('aria-label', '地図の編集ツール'); this.el.appendChild(tools);
    for (const [tool, label] of [['select', '選択'], ['pin', '地点'], ['route', '経路'], ['river','川（フリーハンド）'], ['region', '領域'], ['label', '文字'], ['symbol', '記号'], ['land', '陸地'], ['sea', '海'], ['erase', '消しゴム'], ['measure', '計測']]) {
      const button = this._button(label, () => this._setTool(tool), { id: tool, disabled: this.editingDisabled && !['select', 'measure'].includes(tool) });
      button.setAttribute('aria-pressed', String(tool === 'select')); this.toolButtons.set(tool, button); tools.appendChild(button);
      if (['land', 'sea'].includes(tool)) this.localControls.push(button);
    }
    this.symbolInput = document.createElement('select'); this.symbolInput.setAttribute('aria-label', '記号の種類');
    this.symbolInput.disabled = this.editingDisabled;
    for (const [value, label] of [['pin', '● 地点'], ['city', '◆ 都市'], ['castle', '♜ 城'], ['mountain', '▲ 山'], ['forest', '♠ 森林'], ['port', '⚓ 港']]) this.symbolInput.add(new Option(label, value));
    this.symbolInput.onchange = () => this._setTool('symbol'); tools.appendChild(this.symbolInput);
    this.colorInput = document.createElement('input'); this.colorInput.type = 'color'; this.colorInput.value = '#3b82c4'; this.colorInput.setAttribute('aria-label', '追加する図形の色'); tools.appendChild(this.colorInput);
    this.colorInput.disabled = this.editingDisabled;
    this.finishButton = this._button('確定', () => this.view.finish()); this.finishButton.disabled = true;
    tools.append(this.finishButton, this._button('取消', () => this.view.cancel()));
    const body = document.createElement('div'); body.className = 'gb-map-body'; this.el.appendChild(body);
    const sidebar = this.sidebar = document.createElement('aside'); sidebar.className = 'gb-map-sidebar'; sidebar.setAttribute('aria-label', '地図の設定と地点一覧'); body.appendChild(sidebar);
    this.settings = document.createElement('div'); this.settings.className = 'gb-map-settings'; sidebar.appendChild(this.settings); this._buildSettings();
    this.periodsRoot = document.createElement('div'); this.periodsRoot.className = 'gb-map-periods'; sidebar.appendChild(this.periodsRoot);
    this.savedViewsRoot = document.createElement('div'); sidebar.appendChild(this.savedViewsRoot);
    const layerTitle = document.createElement('h3'); layerTitle.textContent = 'レイヤー'; sidebar.append(layerTitle, this._button('レイヤー追加', () => {
      const id = MeldexMapDocument.id(); this.update(doc => doc.layers.push({ id, name: '新しいレイヤー', visible: true, locked: false, opacity: 1 })); this._activeLayer = id; this._renderLayers();
    }, { disabled: this.editingDisabled }));
    this.layerList = document.createElement('div'); sidebar.appendChild(this.layerList);
    const placeTitle = document.createElement('h3'); placeTitle.textContent = '地点・図形'; sidebar.appendChild(placeTitle);
    this.search = document.createElement('input'); this.search.type = 'search'; this.search.placeholder = '名前・タグ・説明を検索'; this.search.setAttribute('aria-label', '地図内を検索');
    this.search.maxLength = 1000; this.search.value = this.state.mapSearch || '';
    this.kindFilter = document.createElement('select'); this.kindFilter.setAttribute('aria-label', '図形の種類で絞り込む');
    for (const [key, label] of [['', 'すべての種類'], ['pin', '地点・記号'], ['route', '経路'], ['region', '領域'], ['label', '文字']]) this.kindFilter.add(new Option(label, key));
    this.kindFilter.value = this.state.mapFeatureKind || '';
    const filter = () => {
      this.state.mapSearch = this.search.value; this.state.mapFeatureKind = this.kindFilter.value; this._saveViewState();
      this.view.filter = this.search.value.trim().toLocaleLowerCase(); this.view.featureKind = this.kindFilter.value;
      this.view._features(); this._renderPlaces();
    };
    this.search.oninput = filter; this.kindFilter.onchange = filter; sidebar.append(this.search, this.kindFilter);
    this.placeList = document.createElement('div'); this.placeList.className = 'gb-map-places'; sidebar.appendChild(this.placeList);
    this.sheetSources = document.createElement('div'); sidebar.appendChild(this.sheetSources);
    this.sheetStatus = document.createElement('p'); this.sheetStatus.className = 'gb-map-sheet-status'; this.sheetStatus.setAttribute('role', 'status'); sidebar.appendChild(this.sheetStatus);
    const surface = document.createElement('div'); surface.className = 'gb-map-surface'; surface.setAttribute('aria-label', '地図'); body.appendChild(surface);
    this.inspector = document.createElement('aside'); this.inspector.className = 'gb-map-inspector'; this.inspector.setAttribute('aria-label', '選択項目'); body.appendChild(this.inspector);
    const status = document.createElement('div'); status.className = 'gb-map-status'; this.el.appendChild(status);
    const zoomBar = document.createElement('div'); zoomBar.className = 'gb-map-viewbar'; this.el.insertBefore(zoomBar, status);
    this.zoomSlider = document.createElement('input'); this.zoomSlider.type = 'range'; this.zoomSlider.setAttribute('aria-label', 'ズーム倍率');
    this.zoomLabel = document.createElement('output'); this.zoomLabel.setAttribute('aria-label', '現在の倍率');
    this.zoomSlider.oninput = () => this.view.zoomAt(this.store.doc.coordinate_system === 'world' ? Number(this.zoomSlider.value) : Math.log2(Number(this.zoomSlider.value) / 100));
    this.rotationSlider = document.createElement('input'); Object.assign(this.rotationSlider, { type: 'range', min: -180, max: 180, step: 1 }); this.rotationSlider.setAttribute('aria-label', '表示の回転');
    this.rotationSlider.oninput = () => this.view.setRotation(Number(this.rotationSlider.value));
    this.rotationLabel = document.createElement('output');
    zoomBar.append(this._button('−', () => this.view.stepZoom(-1), { id: 'zoom-out' }), this.zoomSlider, this.zoomLabel, this._button('＋', () => this.view.stepZoom(1), { id: 'zoom-in' }),
      this._button('100%', () => this.view.zoom100()), this._button('全体', () => this.view.fit()), this.rotationSlider, this.rotationLabel, this._button('回転リセット', () => this.view.setRotation(0)));
    this.message = document.createElement('span'); this.message.setAttribute('role', 'status');
    this.position = document.createElement('span'); status.append(this.message, this.position);
    const previousView=this.view;
    this.view = new MeldexMapView(surface, {
      action: action => this._action(action), select: id => this._select(id), message: text => this._message(text),
      selection: (ids, active) => this._selectMany(ids, active), edit: id => this._editName(id), command: name => this._command(name),
      rotation: degrees => { this.state.mapRotation = degrees; this._saveViewState(); this._renderZoom(); }, zoom: () => this._renderZoom(),
      draft: (count, distance) => { this.finishButton.disabled = count < (this.view?.tool === 'region' ? 3 : 2); if (count) this.message.textContent = `${count}点 ・ ${distance}`; MeldexMapChrome.refresh(this); },
      position: point => { this.position.textContent = point.map(n => n.toFixed(this.store.doc.coordinate_system === 'world' ? 5 : 1)).join(', '); },
      view: view => { this._viewport = view; this.state.mapViewport = view; this.state.mapViewSystem = this.store.doc.coordinate_system; this._saveViewState(); },
      period: id => {
        MeldexMapPeriods.choose(this, id); this._render();
        this._message('表示する章・時代を「' + ((this.store.doc.periods || []).find(period => period.id === id)?.name || 'すべて') + '」へ切り替えました');
      },
      reveal: feature => {
        this.state.mapSearch = ''; this.state.mapFeatureKind = '';
        (this.state.mapLayerVisibility ||= {})[feature.layer_id] = true;
        this.search.value = ''; this.kindFilter.value = ''; this._saveViewState(); this._render();
        this._message('移動先の地点・図形を表示するため、絞り込みとレイヤー表示を調整しました。');
      },
      sheetPlace: async place => {
        try {
          if (place.topicRef && !place.path) { await window.MeldexTopicPlacementUI?.showDetail?.({ topicRef: place.topicRef, label: place.name }); return; }
          if (!place.path) throw new Error('元のトピックのパスを取得できません');
          await navOpen({ type: 'entity', path: place.path, label: place.name });
        } catch (error) { this._message(error.userMessage || error.message); }
      },
    });
    if(previousView)for(const key of ['routeKind','terrainKind','terrainStrength','brushSize'])if(previousView[key]!==undefined)this.view[key]=previousView[key];
    MeldexMapChrome.decorate(this);
    this._message('地図の種類を選び、地点や地形を追加してください。');
  }
  _buildSettings() { MeldexMapControls.settings(this); }
  _renderZoom() {
    if (!this.zoomSlider || !this.view?.map) return;
    const v = this.view, world = this.store.doc.coordinate_system === 'world', z = v.map.getZoom();
    this.zoomSlider.min = world ? v.map.getMinZoom() : 100 * 2 ** v.map.getMinZoom(); this.zoomSlider.max = world ? v.map.getMaxZoom() : 100 * 2 ** v.map.getMaxZoom(); this.zoomSlider.step = world ? .01 : .1;
    this.zoomSlider.value = world ? z : 100 * 2 ** z; this.zoomLabel.textContent = world ? 'Z ' + z.toFixed(2) : (100 * 2 ** z).toLocaleString('ja-JP', { maximumFractionDigits: 1 }) + '%';
    this.rotationSlider.value = v.rotation; this.rotationLabel.textContent = Math.round(v.rotation) + '°';
  }
  _renderLayers() { MeldexMapControls.layers(this); MeldexMapChrome.identifyControls(this); }
  // マップの方式はAzgaar方式に統一した。旧方式の格子地形だけを持つ地図は、開いた時に変換前の版を保存してから変換する。
  // 版を保存できない時は変換しない（元データを失わないため）。画像を背景にした地図は対象外。
  async _convertLegacyTerrain(generation) {
    const doc = this.store?.doc;
    if (!doc || this.readOnly || this.editingDisabled || doc.coordinate_system !== 'local' || !doc.terrain || doc.atlas || doc.background) return false;
    const store = this.store, path = this.path, label = '旧方式の地形（Azgaar方式へ変換する前）';
    // 変換できるかを先に確かめる（変換できない地図で、開くたびに版だけが増えないように）。
    const atlas = MeldexMapAzgaar.fromLegacyTerrain(doc);
    // 取り消しで旧方式へ戻した地図を開き直した時などに、同じ変換前の版を重ねて作らない。
    let existing = [];
    try { const listed = await apiFetch('/version/list?path=' + encodeURIComponent(path)); existing = listed?.versions || listed?.items || (Array.isArray(listed) ? listed : []); } catch {}
    if (!existing.some(item => item?.label === label)) {
      try { await apiPost('/version/save', { path, label, auto: false }); }
      catch (error) { this._message('変換前の版を保存できないため、旧方式のまま開きました'); return false; }
    }
    if (generation !== this._generation || this.store !== store || store.doc !== doc) return false;
    if (!this.update(next => { next.atlas = atlas; next.terrain = null; }, true, 'マップ: Azgaar方式へ変換')) return false;
    this._buildSettingsRefresh?.(); this._render();
    this._message('旧方式の地形をAzgaar方式へ変換しました（変換前の状態はバージョンに保存しました）');
    return true;
  }
  _renderPlaces() { MeldexMapControls.places(this); window.CommentBadges?.refreshMap?.(this)?.catch?.(() => {}); }
  // アノテート（コメント）の対象。選択中の地点・図形があればそれへ、無ければマップ全体へ付ける。
  annotationContext() {
    if (!this.path) return null;
    const feature = this.store?.doc?.features?.find(item => item.id === this._selected);
    if (!feature) return { targetKind: 'none', filePath: this.path, targetRef: null, snapshot: '' };
    return { targetKind: 'map_feature', filePath: this.path, targetRef: { file: this.path, featureId: feature.id },
      snapshot: String(feature.label || '名前なし').slice(0, 120) };
  }
  addAnnotation(anchorEl) {
    const context = this.annotationContext();
    if (!context || !window.CommentBadges?.addCommentHere) return false;
    window.CommentBadges.addCommentHere(context, { anchorEl: anchorEl || this.inspector || this.el, retainOnFailure: true });
    return true;
  }
  // アノテート一覧から地点・図形へ移動する。
  revealAnnotationTarget(ref = {}) {
    const id = ref.featureId;
    const feature = id && this.store?.doc?.features?.find(item => item.id === id);
    if (!feature) return false;
    this._select(feature.id); this.view?.focus?.(feature);
    return true;
  }
  _renderInspector() {
    MeldexMapControls.inspector(this);
    this.inspector.hidden = false;
    MeldexMapChrome.details(this);
  }
  _syncDetailPanel() {
    const path = this.path || this._tab()?.path || this.state.mapPath;
    if (this._skipDetailSync || !this._isDetailOwner()) return;
    // 作成途中（まだファイルが無い）の時は、前に開いたファイルのプロパティを出し続けない。
    if (!path) { window.GBOptionTargetContext?.clear?.('map-new'); return; }
    if (typeof _syncDetailPanel === 'function') return Promise.resolve(_syncDetailPanel(this.state.label || 'マップ', path, 'map')).then(() => MeldexMapChrome.details(this));
    window.GBOptionTargetContext?.set({ path, kind: 'map', fileType: 'map' }, 'map-open');
  }
  _isDetailOwner() {
    const owner = window.GBEditorHost?.get?.();
    if (owner?.surface === 'subpanel') return owner.component === this;
    return this.paneId === GBLayout.activePane;
  }
  async restore(direction) {
    this._commitInput();
    if (this.editingDisabled || !this.store) return false;
    if (this._hasCommonHistory()) {
      const restored = await (direction === 'undo' ? historyUndo(this._historyScope()) : historyRedo(this._historyScope()));
      return restored;
    }
    if (!this.store.restore(direction)) return false;
    this._inputDirty = false; this.view.cancel(); this._buildSettingsRefresh(); this._render();
    return true;
  }
  _commitInput() { const input = document.activeElement; if ((this.el?.contains(input) || this.optionsRoot?.contains(input) || this.inspector?.contains(input)) && input.matches('input,textarea,select')) input.blur(); }
  async flush() {
    this._commitInput(); clearTimeout(this._saveTimer);
    if (!this.store) return true;
    if (this._inputDirty) { this._message('入力内容を確認してから保存してください'); return false; }
    if (!this.editingDisabled && this._viewport) this.update(doc => { doc.view = this._viewport; }, false);
    clearTimeout(this._saveTimer);
    const store = this.store, hadChanges = store.dirty || !!store.error, saved = await store.save();
    await this._draftPending;
    // A user can keep typing while a save is in flight. Do not close the tab
    // over an input that has not yet reached its change/blur commit boundary.
    const clean = saved && this.store === store && !store.dirty && !this._inputDirty;
    if (clean && hadChanges) this._message('マップを保存しました');
    return clean;
  }
  async reload() {
    this._commitInput();
    if (this.store?.dirty && !await this.flush()) {
      if (!await cfConfirm('未保存の編集は下書きに残ります。画面を保存先の最新版に切り替えますか？')) return false;
      return this.load(this.path, { ignoreDraft: true });
    }
    return this.load(this.path);
  }
  async exportDocument() {
    this._commitInput();
    return MeldexExportSave.saveText(JSON.stringify(this.store.doc, null, 2), { initialfile: this.state.label + '.mel-map', extension: '.mel-map', mime: 'application/json' });
  }
  handleKeyDown(event) {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || !this.store || !this.view) return false;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { this.flush(); return true; }
    if (MeldexMapInteraction.editableTarget(event.target) || event.target.closest?.('button,.leaflet-control')) return false;
    const actual = typeof _normalizeKeyEvent === 'function' ? _normalizeKeyEvent(event) : '';
    const matches = (id, fallback) => {
      const key = typeof getShortcutKey === 'function' ? getShortcutKey(id) : fallback;
      return !!key && actual === (typeof _normalizeKeyDef === 'function' ? _normalizeKeyDef(key) : key);
    };
    if (matches('global.undo', 'ctrl+z')) { this.restore('undo'); return true; }
    if (matches('global.redo', 'ctrl+y') || matches('global.redo2', 'ctrl+shift+z')) { this.restore('redo'); return true; }
    if (event.key === 'Escape') {
      if (this.view.draft.length || this.view._painting) this.view.cancel();
      else if (this.view.tool !== 'select') this._setTool('select');
      else this._selectMany([]);
      return true;
    }
    if (event.key === 'Enter' && this.view?.draft.length) { this.view.finish(); return true; }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.startsWith('Arrow')) { this._navigateSelection(event.key, event.shiftKey); return true; }
    const commands = [
      ['board.search', 'ctrl+f', () => { this.sidebar.hidden = false; this.sidebarToggle?.setAttribute('aria-pressed', 'true'); this._mapNavigatorTab?.('places'); this.search.focus(); this.search.select(); }],
      ['board.delete', 'delete', () => this._command('delete')],
      ['board.selectAll', 'ctrl+a', () => this._selectMany(this.store.doc.features.filter(f => this.view._visible(f)).map(f => f.id))],
      ['board.deselectAll', 'ctrl+d', () => this._selectMany([])],
      ['board.edit', 'f2', () => this._editName(this._selected)],
      ['board.zoomIn', 'ctrl+=', () => this.view.stepZoom(1)], ['board.zoomOut', 'ctrl+-', () => this.view.stepZoom(-1)],
      ['board.zoomFit', 'ctrl+0', () => this.view.fit()], ['board.zoom100', 'ctrl+1', () => this.view.zoom100()],
    ];
    for (const [id, key, run] of commands) if (matches(id, key)) { run(); return true; }
    return false;
  }
  onPathRename(oldPath, newPath, options) {
    if (!this.store || !this.path) return;
    const next = _mapRenamedPath(this.path, oldPath, newPath);
    if (next !== this.path) { this.path = next; this.state.mapPath = next; }
    if (this.path === newPath && options?.label != null) {
      this.state.label = this.store.doc.title = options.label;
      if (this.store.doc.display_title != null || options.titleOnly) this.store.doc.display_title = options.label;
      if (options.etag && !this.store.pending) this.store.etag = options.etag;
    }
    for (const feature of this.store.doc.features) for (const link of feature.links) link.path = _mapRenamedPath(link.path, oldPath, newPath);
    for (const source of this.store.doc.sheet_sources || []) source.path = _mapRenamedPath(source.path, oldPath, newPath);
    for (const parent of this.state.mapTrail || []) parent.path = _mapRenamedPath(parent.path, oldPath, newPath);
    this._changed(); this._renderInspector(); MeldexMapChrome.refresh(this);
  }
  getState() { return { ...this.state, mapPath: this.path || this.state.mapPath || '' }; }
  getDetailContent() { return this.path ? { type: 'map', path: this.path } : null; }
  destroy(options = {}) {
    if (!options.skipFlush && (this.store?.dirty || this.store?.pending || this._inputDirty)) return false;
    ++this._generation; clearTimeout(this._saveTimer); this._generatorPreview?.destroy(); this._settlementsPreview?.destroy(); this._climatePreview?.destroy(); this._worldPreview?.destroy();this._terrainPreview?.destroy(); this._interchange?.destroy(); this.view?.destroy(); MeldexMapChrome.destroy(this);
    window.removeEventListener('beforeunload', this._beforeUnload); super.destroy(); return true;
  }
}

function _meldexMapHistoryTarget(scope) {
  const editor = window.GBEditorHost?.get?.()?.component;
  if (editor instanceof MapAppComponent && editor.store && editor._historyScope() === scope) return editor;
  if (typeof getComponentInstance === 'function' && typeof _meldexActiveTabForPane === 'function') {
    const tab = _meldexActiveTabForPane();
    const active = tab?.type === 'map' ? getComponentInstance(tab.id) : null;
    if (active?.store && active._historyScope?.() === scope) return active;
  }
  if (typeof getComponentInstance === 'function' && typeof _meldexFindTabForHistoryScope === 'function') {
    const match = _meldexFindTabForHistoryScope(scope);
    const target = match ? getComponentInstance(match.tabId) : null;
    if (target?.store && target._historyScope?.() === scope) return target;
  }
  let found = null;
  if (typeof forEachComponent === 'function') forEachComponent(c => {
    if (c instanceof MapAppComponent && c.store && c.el?.isConnected && c._historyScope() === scope) found = c;
  });
  return found;
}

window.MeldexMapHistorySnapshots = {
  capture(scope) {
    const target = _meldexMapHistoryTarget(scope);
    return target?.store ? MeldexMapDocument.clone(target.store.doc) : null;
  },
  restore(snapshot, scope) {
    const target = _meldexMapHistoryTarget(scope);
    return target ? target._restoreHistorySnapshot(snapshot, scope) : false;
  },
};

registerToolComponent('map', { cls: MapAppComponent, icon: 'map', label: 'マップ', multi: true, requiresViewLock: true });
async function openMapApp(path, label, options = {}) {
  if (!MeldexMapDocument.isAvailable()) { showStatus('マップ初期版はデスクトップ版本体で開いてください。', true); return false; }
  path = MeldexLocationData.canonicalPath(path, state.vaultPath);
  const trail = Array.isArray(options.mapTrail) ? options.mapTrail : [];
  const paneId = options.paneId || (typeof getScriptNoteTargetPaneId === 'function' ? getScriptNoteTargetPaneId() : GBLayout.activePane);
  const tabId = GBTabs.addTab(paneId, label || 'マップ', 'map', path, { mapPath: path, label: label || 'マップ', mapTrail: trail }, options);
  if (!tabId) return false;
  if (typeof navPush === 'function' && !options.skipNavPush) navPush({ type: 'map', path, label: label || 'マップ' }, paneId);
  if (!options.skipSaveLastView && typeof saveLastView === 'function') saveLastView({ type: 'map', path, label: label || 'マップ' });
  let component = getComponentInstance(tabId);
  for (let frame = 0; !component && frame < 60; frame++) {
    await new Promise(resolve => requestAnimationFrame(resolve));
    component = getComponentInstance(tabId);
  }
  if (!component) throw new Error('マップの表示準備を完了できませんでした');
  if (component) {
    component.state.mapTrail = trail;
    const tab = component._tab(); if (tab) tab.state.mapTrail = trail;
    if (component.breadcrumbs) { component.breadcrumbs.replaceChildren(); MeldexMapRelations.breadcrumbs(component, component.breadcrumbs); }
  }
  const ready = await (component?.ready || true);
  if (ready) {
    component.state.mapTrail = trail;
    const tab = component._tab(); if (tab) tab.state.mapTrail = trail;
    component.breadcrumbs?.replaceChildren();
    if (component.breadcrumbs) MeldexMapRelations.breadcrumbs(component, component.breadcrumbs);
    GBLayout.saveLayout();
  }
  if (ready && component?.store && !trail.length) {
    await MeldexMapRelations.findParents(component).catch(() => {});
  }
  return ready;
}
