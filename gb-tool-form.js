/* First-class Meldex form. Definitions belong to this tab; records to its sheet. */
class FormAppComponent extends ToolComponent {
  create() {
    this.el = document.createElement('section');
    this.el.className = 'gb-form-app';
    this.el.setAttribute('aria-label', 'フォーム');
    this.el.dataset.e2eId = 'form-app';
    this._draftOwner = globalThis.crypto?.randomUUID?.() || _elGenId('form-draft');
    this.el.addEventListener('keydown', event => {
      if (this.handleKeyDown(event)) { event.preventDefault(); event.stopPropagation(); }
    });
    this._generation = 0;
    this._beforeUnload = event => {
      if (this.store?.dirty || this.el.querySelector('[data-form-dirty="true"],[data-form-has-pending]')
        || [...this.el.querySelectorAll('form')].some(form => form._dbFormSubmitting)) {
        event.preventDefault(); event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', this._beforeUnload);
    return this.el;
  }
  _tab() { return GBLayout.findNode(GBLayout.root, this.paneId)?.node?.tabs?.find(tab => tab.id === this.tabId); }
  activate() {
    super.activate();
    if (this.paneId === GBLayout.activePane && typeof historySetScope === 'function') historySetScope('');
    const tab = this._tab();
    const path = tab?.path || this.state.formPath;
    if (path && path !== this.path) this.ready = this.load(path);
    else if (!path && !this.store) {
      this.el.textContent = tab?.state?.pendingCreate ? '作成しています…' : 'フォームを新規作成するか、フォルダツリーから開いてください。';
      if (!tab?.state?.pendingCreate) this.el.appendChild(this._button('フォームを作成', async () => {
        const home = await apiFetch('/home-folder');
        const result = await apiPost('/outliner/add', { type: 'form-app', label: '無題', parent: home.path });
        GBTabs.updateTab(this.paneId, this.tabId, { path: result.node.path, label: result.node.label, state: { formPath: result.node.path } });
        this.ready = this.load(result.node.path); await this.ready;
        if (typeof loadOutliner === 'function') loadOutliner();
      }));
    }
  }
  async load(path, options = {}) {
    const generation = ++this._generation;
    if (this.path && path !== this.path && !await this.flush()) return false;
    if (this.store?.pending) await this.store.pending;
    if (generation !== this._generation || !this.el) return false;
    clearTimeout(this._saveTimer);
    if (options.discardDraft) this._removeOwnDraft();
    this.path = path;
    this.store = null;
    this.el.textContent = 'フォームを読み込んでいます…';
    try {
      const [loaded, access] = await Promise.all([
        apiFetch('/file?path=' + encodeURIComponent(path)), MeldexEntityDetail.resolveReadOnly(path, false),
      ]);
      if (generation !== this._generation || !this.el) return false;
      const doc = MeldexFormDocument.parse(loaded.content);
      this._mode = null;
      this._pendingSheetSwitch = false;
      this._referenceRenames = [];
      this.definitionReadOnly = !!access.readOnly;
      const store = this.store = new MeldexFormDocument.Store(doc, loaded.etag, async (content, etag) => {
        const target = this.path;
        const access = await MeldexEntityDetail.resolveReadOnly(target, false);
        if (access.readOnly) throw new Error('フォームは読み取り専用です');
        return apiPut('/file?path=' + encodeURIComponent(target), { content, if_match_etag: etag });
      }, () => this._changed());
      const cached = this._readDraft();
      const recover = cached && !this.definitionReadOnly && await cfConfirm('保存できていないフォームの下書きを復元しますか？');
      if (generation !== this._generation || !this.el) return false;
      if (recover) {
        // Preserve its base revision, so recovery cannot overwrite remote edits.
        store.doc = MeldexFormDocument.parse(cached.doc);
        store.etag = cached.etag; store.revision++;
        this._recoveredDraft = cached.recovery;
      }
      this.state = { ...this.state, formPath: path, label: doc.display_title || doc.title };
      if (this._tab()) this._tab().state = { ...this._tab().state, ...this.state };
      if (typeof addRecent === 'function') addRecent(this.state.label, path, 'form-app');
      if (recover && JSON.stringify(store.doc.sheet) !== JSON.stringify(doc.sheet)) {
        this._pendingSheetSwitch = true;
        if (await store.save()) this._pendingSheetSwitch = false;
        if (generation !== this._generation || this.store !== store) return false;
      }
      if (this._pendingSheetSwitch) this._blockSheetSwitch(store.doc.sheet.path);
      else await this._loadSheet();
      if (generation !== this._generation) return false;
      this._render(); this._changed();
      if (this.store.dirty && !this.definitionReadOnly && !this._pendingSheetSwitch) {
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this.store.save(), 250);
      }
      return true;
    } catch (error) {
      if (generation !== this._generation || !this.el) return false;
      this.el.replaceChildren();
      const message = document.createElement('p'); message.textContent = 'フォームを開けません: ' + (error.userMessage || error.message);
      this.el.append(message, this._button('再読込', () => this.load(path)));
      return false;
    }
  }
  _draftPrefix() { return 'meldex-form-draft:' + this.path; }
  _draftKey() { return this._draftPrefix() + ':' + (this._draftOwner || this.tabId); }
  _removeOwnDraft() {
    try {
      localStorage.removeItem(this._draftKey());
      const recovered = this._recoveredDraft;
      if (recovered && localStorage.getItem(recovered.key) === recovered.raw) localStorage.removeItem(recovered.key);
    } catch (_) { /* Keep the recovery copy when storage is unavailable. */ }
    this._recoveredDraft = null;
  }
  _readDraft() {
    const candidates = [];
    try {
      const live = new Set();
      if (typeof forEachComponent === 'function') forEachComponent(component => {
        if (component !== this && component.path === this.path && component.el) live.add(component._draftKey?.());
      });
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (live.has(key) || key !== this._draftPrefix() && !key?.startsWith(this._draftPrefix() + ':')) continue;
        try {
          const raw = localStorage.getItem(key), draft = JSON.parse(raw);
          if (!draft?.doc || !draft.etag) continue;
          const doc = MeldexFormDocument.parse(draft.doc);
          if (doc.meldex?.document_id && this.store.doc.meldex?.document_id
            && doc.meldex.document_id !== this.store.doc.meldex.document_id) continue;
          candidates.push({ ...draft, recovery: { key, raw } });
        } catch (_) { /* Ignore malformed entries independently. */ }
      }
    } catch (_) { /* A malformed recovery entry never replaces the file. */ }
    return candidates.find(draft => draft.recovery.key === this._draftKey())
      || candidates.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0] || null;
  }
  _changed() {
    if (!this.store) return;
    try {
      if (this.store.dirty) localStorage.setItem(this._draftKey(), JSON.stringify({ doc: this.store.doc, etag: this.store.etag, savedAt: Date.now() }));
      else this._removeOwnDraft();
    } catch (_) { /* beforeunload and flush still guard the in-memory draft. */ }
    if (this.status) this.status.textContent = this.store.error
      ? '保存できません: ' + (this.store.error.userMessage || this.store.error.message)
      : this.store.pending ? '保存しています…' : this.store.dirty ? '未保存の変更があります' : '保存済み';
    if (this.retry) this.retry.hidden = !this.store.error;
    if (this.exportDraft) this.exportDraft.disabled = !this.store.dirty;
    if (this.status && this._sourceMoved) this.status.textContent += ' — 参照先シートが移動しました。入力を確認して再読込してください。';
  }
  _update(mutator, options = {}) {
    if (this.definitionReadOnly || !this.store) return false;
    const before = MeldexFormDocument.clone(this.store.doc);
    if (!this.store.update(mutator)) return false;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.store.save(), 250);
    if (options.history !== false && typeof historyPush === 'function') {
      const owner = this.store;
      const after = MeldexFormDocument.clone(this.store.doc);
      const restore = async snapshot => {
        if (!this.el || this.store !== owner) throw new Error('フォームを開き直したため、この操作は取り消せません');
        if (!await this._leave() || this.store !== owner) throw new Error('フォームの入力を確認してから取り消してください');
        const restored = MeldexFormDocument.clone(snapshot);
        restored.title = owner.doc.title;
        if (owner.doc.display_title != null) restored.display_title = owner.doc.display_title;
        if (owner.doc.meldex) restored.meldex = MeldexFormDocument.clone(owner.doc.meldex);
        for (const [from, to] of this._referenceRenames || []) restored.sheet.path = _mapRenamedPath(restored.sheet.path, from, to);
        const previousPath = this.ctx.dbPath;
        if (!this._update(doc => { Object.keys(doc).forEach(key => delete doc[key]); Object.assign(doc, restored); }, { history: false }))
          throw new Error('フォームを変更できません');
        this._mode = restored.formConfig?.mode;
        if (previousPath !== restored.sheet.path) {
          this._pendingSheetSwitch = true;
          clearTimeout(this._saveTimer);
          const saved = await this._saveDefinitionAndSheet();
          if (this.store !== owner) throw new Error('フォームを開き直したため、この操作は取り消せません');
          if (!saved) {
            this._blockSheetSwitch(restored.sheet.path); this._render();
            throw new Error(this.sheetError);
          }
          return;
        }
        if (this._designRender && previousPath === restored.sheet.path) this._designRender(); else this._render();
      };
      historyPush('フォーム: 定義を編集', () => restore(before), () => restore(after), '', this.state.label || 'フォーム');
    }
    return true;
  }
  async _loadSheet() {
    this.sheetError = '';
    this._sourceMoved = false;
    const source = this.store.doc.sheet;
    if (this.ctx) { this.ctx.destroyed = true; this.ctx.writeBlocked = true; }
    this.ctx = { paneId: this.paneId, tabId: this.tabId, containerEl: this.el, dbPath: source.path, filter: 'disabled', formApp: this };
    const ctx = this.ctx;
    if (!source.path) return;
    try {
      let path = source.path;
      if (source.id) {
        const resolved = await apiFetch('/file-path?id=' + encodeURIComponent(source.id), { silentError: true }).catch(() => null);
        if (resolved?.path) path = resolved.path;
      }
      const [metadata, pivot, access] = await Promise.all([
        apiFetch('/db-metadata?path=' + encodeURIComponent(path)),
        apiFetch('/pivot?path=' + encodeURIComponent(path)),
        MeldexEntityDetail.resolveReadOnly(path, false),
      ]);
      if (this.ctx !== ctx || ctx.destroyed) return;
      ctx.dbPath = path; ctx.dbMetadata = metadata; ctx.pivotData = pivot; ctx.readOnly = !!access.readOnly;
      if (typeof _stampPivotValueEntityPaths === 'function') _stampPivotValueEntityPaths(path, pivot);
    } catch (error) { if (this.ctx === ctx) this.sheetError = '参照先シートを開けません: ' + (error.userMessage || error.message); }
  }
  getLayout() { return this.store?.doc.layout; }
  getConfig(props, propTypes) {
    const doc = this.store.doc, layout = doc.layout;
    const cfg = { ...doc.formConfig, ...(layout ? MeldexDbFormModel.forLayout(layout, doc.formConfig) : {}) };
    return normalizeDbFormConfig({ ...cfg, layoutId: layout?.id || '', mode: this._mode || (this.definitionReadOnly ? 'entry' : doc.formConfig?.mode) || 'entry' },
      [...props, ...MeldexDbFormModel.layoutFields(layout)], propTypes);
  }
  saveConfig(config, options = {}) {
    this._mode = config.mode;
    if (options.shared === false) return true;
    if (this.definitionReadOnly) return true;
    const previous = { ...this.store.doc.formConfig, mode: config.mode, layoutId: config.layoutId };
    return this._update(doc => {
      doc.formConfig = MeldexFormDocument.clone(config);
      if (doc.layout) {
        doc.layout.formConfig = MeldexDbFormModel.normalize(config, MeldexDbFormModel.layoutFields(doc.layout));
        delete doc.layout.formConfig.mode; delete doc.layout.formConfig.layoutId;
      }
    }, { history: JSON.stringify(previous) !== JSON.stringify(config) });
  }
  _button(label, run) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'gb-btn'; button.textContent = label;
    button.dataset.e2eId = `form-${this.tabId}-${label}`;
    button.addEventListener('click', async event => {
      try { await run(event); } catch (error) { showStatus(error.userMessage || error.message, true); }
    }); return button;
  }
  async _leave() { return !this.el || await MeldexDbFormRuntime.confirmLeave(this.el); }
  _blockSheetSwitch(path) {
    if (this.ctx) { this.ctx.destroyed = true; this.ctx.writeBlocked = true; }
    this.ctx = { dbPath: path, writeBlocked: true };
    this.sheetError = '保存先の変更を保存できませんでした。「保存を再試行」で保存してから入力してください。';
  }
  async _saveDefinitionAndSheet() {
    const store = this.store, generation = this._generation;
    const saved = !store || await store.save();
    if (saved && this.store === store && this._generation === generation && this._pendingSheetSwitch) {
      this._pendingSheetSwitch = false;
      await this._loadSheet();
      if (this.store === store && this._generation === generation) this._render();
    }
    return saved;
  }
  async _chooseSheet() {
    const select = this.sheetSelect;
    const path = select.value;
    const store = this.store, generation = this._generation;
    const current = () => this.store === store && this._generation === generation && this.el;
    if (path === this.ctx.dbPath) return;
    if (!await this._leave()) { select.value = this.ctx.dbPath; return; }
    if (!current()) return;
    if (this.definitionReadOnly) return;
    const controls = [...select.closest('.gb-form-app-toolbar').querySelectorAll('button,select')]
      .map(control => [control, control.disabled]);
    controls.forEach(([control]) => { control.disabled = true; });
    this.surface.inert = true;
    try {
      const id = path ? await apiFetch('/file-id?path=' + encodeURIComponent(path), { silentError: true }).catch(() => null) : null;
      if (!current()) return;
      this._update(doc => { doc.sheet = { ...doc.sheet, path, id: id?.file_id || '' }; });
      clearTimeout(this._saveTimer);
      this._pendingSheetSwitch = true;
      const saved = await this._saveDefinitionAndSheet();
      if (!current()) return;
      if (!saved) {
        this._blockSheetSwitch(path);
        this._render();
      }
    } finally {
      controls.forEach(([control, disabled]) => { control.disabled = disabled; });
      if (current() && this.surface) this.surface.inert = false;
    }
  }
  async _fillSheets(select) {
    try {
      const data = await apiFetch('/databases');
      if (!select.isConnected) return;
      const items = Array.isArray(data) ? data : data.databases || [];
      items.filter(item => item.type !== 'calendar').forEach(item => {
        if ([...select.options].some(option => option.value === item.path)) return;
        const option = document.createElement('option'); option.value = item.path; option.textContent = item.name + ' — ' + (item.relPath || item.path);
        select.appendChild(option);
      });
      select.value = this.ctx.dbPath || '';
    } catch (error) { this.status.textContent = 'シート一覧を取得できません: ' + error.message; }
  }
  async _presetOptions(select) {
    const choices = [];
    const add = (name, items, layouts = false) => {
      const group = document.createElement('optgroup'); group.label = name;
      items.forEach(item => {
        const option = document.createElement('option'); option.value = String(choices.length); option.textContent = layouts ? item.name : item.layout.name;
        choices.push({ item, layout: layouts }); group.appendChild(option);
      });
      select.appendChild(group);
    };
    select._templateChoices = choices;
    add('標準テンプレート', MeldexDbTopicLayoutPresets.getTemplates());
    add('シートのレイアウト', this.ctx.dbMetadata?.view_config?.entityLayouts || [], true);
    try {
      const library = await MeldexDbTopicLayoutStyle.loadSharedTemplateLibrary();
      if (select.isConnected && select._templateChoices === choices) add('ユーザーテンプレート', library.templates || []);
    } catch (_) { /* Built-in and sheet layouts remain available offline. */ }
  }
  async _usePreset(select) {
    if (select.value === '') return;
    const choice = select._templateChoices?.[Number(select.value)]; select.value = '';
    const store = this.store, generation = this._generation;
    if (!choice || !await this._leave() || store !== this.store || generation !== this._generation || this.definitionReadOnly) return;
    this._mode = 'entry';
    let layout;
    if (choice.layout) layout = _elNormalizeLayout(MeldexFormDocument.clone(choice.item));
    else {
      const columns = Object.entries(getPropertyTypes(this.ctx.dbPath, this.ctx)).map(([name, column]) => ({ ...column, name, id: column.property_id || '' }));
      layout = _elNormalizeLayout(MeldexDbTopicLayoutStyle.importTemplate(choice.item, [], columns).layout);
    }
    layout.formConfig = MeldexDbFormModel.forLayout(layout);
    this._update(doc => { doc.layout = layout; doc.formConfig = { ...doc.formConfig, ...layout.formConfig, mode: 'entry' }; });
    this._render();
  }
  async _automaticLayout() {
    const store = this.store, generation = this._generation;
    if (!await this._leave() || store !== this.store || generation !== this._generation) return;
    const fields = this.getConfig(this.ctx.pivotData?.properties || [], getPropertyTypes(this.ctx.dbPath, this.ctx)).fields;
    this._update(doc => {
      doc.layout = _elNormalizeLayout({ id: _elGenId('form'), name: 'フォーム', canvasSize: { w: 1000, h: Math.max(700, fields.length * 140 + 40) },
        cells: fields.map((prop, index) => ({ id: _elGenId('field'), type: 'field', prop, x: 20, y: 20 + index * 140, w: 940, h: 120 })) });
      doc.layout.formConfig = MeldexDbFormModel.forLayout(doc.layout, doc.formConfig);
    }); this._render();
  }
  async registerTemplate() {
    this._commitFocusedControl();
    const store = this.store;
    if (!store) return;
    // A definition snapshot deliberately excludes the destination sheet and response values.
    const fields = this.getConfig(this.ctx.pivotData?.properties || [], getPropertyTypes(this.ctx.dbPath, this.ctx)).fields;
    const layout = MeldexFormDocument.clone(this.getLayout() || {
      id: _elGenId('form'), canvasSize: { w: 1000, h: Math.max(700, fields.length * 140 + 40) },
      cells: fields.map((prop, i) => ({ id: _elGenId('field'), type: 'field', prop, x: 20, y: 20 + i * 140, w: 940, h: 120 })),
    });
    layout.formConfig = MeldexDbFormModel.forLayout(layout, store.doc.formConfig);
    const columns = Object.entries(getPropertyTypes(this.ctx.dbPath, this.ctx)).map(([name, column]) => ({ ...column, name, id: column.property_id || '' }));
    // Keep stable column identities even when the source uses an automatic layout.
    layout.cells.filter(cell => cell.type === 'field').forEach(cell => { cell.columnId = columns.find(column => column.name === cell.prop)?.id || cell.columnId || ''; });
    const name = document.createElement('input'); name.className = 'gb-input'; name.setAttribute('aria-label', 'テンプレート名'); name.value = store.doc.title || layout.name || 'フォーム';
    const body = document.createElement('div');
    body.appendChild(GBUI.createField({ label: 'テンプレート名', input: name }));
    const hint = document.createElement('p'); hint.textContent = '配置・書式・入力設定を登録します。他のフォームの「テンプレートを適用」から選べます。入力済みの値や参照先シートは含みません。'; body.appendChild(hint);
    const status = document.createElement('p'); status.setAttribute('role', 'status'); body.appendChild(status);
    const save = document.createElement('button'); save.type = 'button'; save.className = 'gb-btn gb-btn-primary'; save.textContent = '登録';
    let busy = false;
    const modal = GBUI.createModal({ id: 'form-register-template', title: 'テンプレートに登録', body, footer: [save], initialFocus: name,
      onBeforeClose: () => !busy });
    save.addEventListener('click', async () => {
      if (busy) return;
      if (!name.value.trim()) { status.textContent = 'テンプレート名を入力してください'; name.focus(); return; }
      busy = true; save.disabled = true; name.disabled = true;
      try {
        layout.name = name.value.trim();
        const template = MeldexDbTopicLayoutStyle.exportTemplate(layout, columns);
        const result = await MeldexDbTopicLayoutStyle.saveSharedTemplateToLibrary(template);
        if (!result.saved) throw new Error('同名のテンプレートがあります。別の名前で登録してください');
        status.textContent = result.shared === false ? 'この端末に登録しました。共有先が利用できるときに他の端末へ同期できます。' : 'テンプレートに登録しました';
        if (this.store === store && this.el?.isConnected) {
          const select = this.el.querySelector('[data-form-templates]');
          if (select) { select.replaceChildren(new Option(this.getLayout() ? '現在の配置: ' + this.getLayout().name : 'テンプレートを選択', '')); this._presetOptions(select); }
        }
      } catch (error) { status.textContent = error.userMessage || error.message; }
      finally { busy = false; save.disabled = false; name.disabled = false; }
    });
    modal.open();
  }
  async _design() {
    const owner = this.store, version = this._generation;
    if (!await this._leave() || owner !== this.store || version !== this._generation || !this.getLayout()) return;
    const root = this.surface, session = { editMode: true }, store = this.store, generation = this._generation;
    const render = () => {
      _elCloseEditPopups();
      root.replaceChildren(this._button('配置編集を終了', () => this._render()));
      const editor = document.createElement('div'); root.appendChild(editor);
      const layout = this.getLayout();
      const types = getPropertyTypes(this.ctx.dbPath, this.ctx);
      _elRenderLayoutBody(editor, { properties: Object.fromEntries(Object.keys(types).map(name => [name, []])) }, '', {
        ctx: this.ctx, propTypes: types, layoutDraft: { layout, session, persist: mutator => {
          if (!editor.isConnected || store !== this.store || generation !== this._generation) return false;
          return this._update(doc => mutator(doc.layout));
        } },
      }, this.ctx.dbPath, layout.id, render);
    }; this._designRender = render; render();
  }
  _render() {
    if (!this.el || !this.store) return;
    if (this._designRender) _elCloseEditPopups();
    this._designRender = null;
    this.el.replaceChildren();
    const bar = document.createElement('div'); bar.className = 'gb-form-app-toolbar'; this.el.appendChild(bar);
    const menu = this._button('メニュー', event => showToolMenu(event, 'form-app', this));
    menu.classList.add('tool-menu-btn'); menu.setAttribute('aria-label', 'メニュー'); menu.setAttribute('aria-haspopup', 'menu'); menu.innerHTML = lucide('menu', 16); bar.appendChild(menu);
    const source = document.createElement('label'); source.textContent = '参照先シート';
    const select = document.createElement('select'); select.className = 'gb-select'; select.setAttribute('aria-label', '参照先シート');
    select.dataset.e2eId = `form-${this.tabId}-source-sheet`;
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'シートを選択'; select.appendChild(empty);
    if (this.ctx.dbPath) {
      const option = document.createElement('option'); option.value = this.ctx.dbPath;
      option.textContent = this.ctx.dbMetadata?.display_title || this.ctx.dbPath.split(/[\\/]/).pop(); select.appendChild(option); select.value = option.value;
    }
    this.sheetSelect = select; source.appendChild(select); bar.appendChild(source);
    select.disabled = this.definitionReadOnly; select.addEventListener('change', () => this._chooseSheet().catch(error => showStatus(error.message, true)));
    this._fillSheets(select);
    if (this.ctx.dbPath && !this.sheetError) {
      bar.appendChild(this._button('シートを開く', () => navOpen({ type: 'database', path: this.ctx.dbPath, label: select.selectedOptions[0]?.textContent }, { newTab: true })));
      const templateLabel = document.createElement('label'); templateLabel.textContent = 'テンプレートを適用';
      const presets = document.createElement('select'); presets.className = 'gb-select'; presets.setAttribute('aria-label', 'テンプレートを適用'); presets.dataset.formTemplates = '1';
      presets.dataset.e2eId = `form-${this.tabId}-layout`;
      const current = document.createElement('option'); current.value = ''; current.textContent = this.getLayout() ? '現在の配置: ' + this.getLayout().name : 'テンプレートを選択'; presets.appendChild(current);
      presets.disabled = this.definitionReadOnly; presets.addEventListener('change', () => this._usePreset(presets).catch(error => showStatus(error.message, true))); templateLabel.appendChild(presets); bar.appendChild(templateLabel); this._presetOptions(presets);
      const automatic = this._button('現在の列から配置を作成', () => this._automaticLayout()); automatic.disabled = this.definitionReadOnly; bar.appendChild(automatic);
      const design = this._button('配置を編集', () => this._design()); design.disabled = this.definitionReadOnly || !this.getLayout(); bar.appendChild(design);
    }
    bar.appendChild(this._button('再読込', async () => {
      if (!await this._leave()) return;
      if (this.store.dirty && !await cfConfirm('未保存のフォーム定義を破棄して読み直しますか？')) return;
      await this.load(this.path, { discardDraft: true });
    }));
    const saveBar = document.createElement('div'); saveBar.className = 'gb-form-app-save'; this.el.appendChild(saveBar);
    this.status = document.createElement('span'); this.status.setAttribute('role', 'status'); saveBar.appendChild(this.status);
    this.retry = this._button('保存を再試行', () => this._saveDefinitionAndSheet()); saveBar.appendChild(this.retry);
    this.exportDraft = this._button('下書きを書き出す', () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(this.store.doc, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url;
      link.download = (GBPathUtils.displayTitle.storageName(this.store.doc.title || 'フォーム')) + '.mel-form';
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }); saveBar.appendChild(this.exportDraft);
    if (this.definitionReadOnly) saveBar.appendChild(document.createTextNode('（フォーム定義は読み取り専用）'));
    this.surface = document.createElement('div'); this.surface.className = 'form-view gb-form-app-surface'; this.el.appendChild(this.surface);
    if (this.sheetError || !this.ctx.dbPath) {
      const hint = document.createElement('p'); hint.textContent = this.sheetError || '入力先のシートを選択してください。入力したトピックはシートへ保存され、配置と入力設定はこのフォームに保存されます。'; this.surface.appendChild(hint);
    } else renderDbFormView(this.ctx);
    this._changed();
  }
  async flush() {
    this._commitFocusedControl();
    if (!await this._leave()) return false;
    clearTimeout(this._saveTimer);
    return this._saveDefinitionAndSheet();
  }
  async reload() {
    if (!await this.flush()) return false;
    return this.load(this.path);
  }
  handleKeyDown(event) {
    if (event.isComposing || event.keyCode === 229) return false;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      this.saveDefinition(); return true;
    }
    return false;
  }
  saveDefinition() {
    this._commitFocusedControl();
    clearTimeout(this._saveTimer);
    return this._saveDefinitionAndSheet();
  }
  _commitFocusedControl() {
    const control = document.activeElement;
    if (this.el?.contains(control) && control.matches('input,textarea,select,[contenteditable=true]')) control.blur();
  }
  onPathRename(oldPath, newPath, options) {
    if (!this.path || !this.store) return;
    (this._referenceRenames ||= []).push([oldPath, newPath]);
    const path = _mapRenamedPath(this.path, oldPath, newPath);
    if (path !== this.path) {
      const oldKey = this._draftKey(); this.path = path; this.state.formPath = path;
      if (this.store.dirty) { this._changed(); try { localStorage.removeItem(oldKey); } catch (_) {} }
    }
    if (this.path === newPath && options?.label != null) {
      this.state.label = options.label;
      this.store.doc.title = options.label;
      if (this.store.doc.display_title != null || options.titleOnly) this.store.doc.display_title = options.label;
      if (options.etag && !this.store.pending) this.store.etag = options.etag;
      this._changed();
    }
    const source = this.store.doc.sheet.path;
    const movedSource = _mapRenamedPath(source, oldPath, newPath);
    if (source && source !== movedSource) {
      this._update(doc => { doc.sheet.path = movedSource; }, { history: false });
      // Keep any typed values on screen, but never write them to the old path.
      if (this.ctx) this.ctx.writeBlocked = true;
      this._sourceMoved = true; this._changed();
    }
  }
  destroy(options = {}) {
    if (!options.skipFlush && (this.store?.dirty || this.store?.pending
      || this.el?.querySelector('[data-form-dirty="true"],[data-form-has-pending]'))) return false;
    ++this._generation; clearTimeout(this._saveTimer);
    window.removeEventListener('beforeunload', this._beforeUnload);
    if (this.ctx) this.ctx.destroyed = true;
    super.destroy(); return true;
  }
}
registerToolComponent('form-app', { cls: FormAppComponent, icon: 'clipboardList', label: 'フォーム', multi: true, requiresViewLock: true });

async function openFormApp(path, label, options = {}) {
  const paneId = options.paneId || (typeof getScriptNoteTargetPaneId === 'function' ? getScriptNoteTargetPaneId() : GBLayout.activePane);
  const tabId = GBTabs.addTab(paneId, label || 'フォーム', 'form-app', path, { formPath: path, label: label || 'フォーム' }, options);
  if (!tabId) return false;
  if (typeof navPush === 'function' && !options.skipNavPush) navPush({ type: 'form-app', path, label: label || 'フォーム' }, paneId);
  if (!options.skipSaveLastView && typeof saveLastView === 'function') saveLastView({ type: 'form-app', path, label: label || 'フォーム' });
  const component = getComponentInstance(tabId);
  if (component?.ready) return component.ready;
  return true;
}
