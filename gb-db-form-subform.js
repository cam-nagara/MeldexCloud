/* A repeating block is a filtered related sheet, never a second copy of its rows. */
(function () {
  'use strict';
  const api = () => globalThis.MeldexDbFormRuntime;
  const normalize = path => typeof _dbNormalizePath === 'function' ? _dbNormalizePath(path) : api().normalPath(path);
  function canonicalPath(path) {
    const base = typeof state !== 'undefined' ? state.vaultPath : '';
    const resolved = globalThis.GBPathUtils?.resolveForClipboard?.(path, base) || path;
    const value = normalize(resolved);
    return /^[A-Za-z]:\//.test(value) || value.startsWith('//') ? value.toLowerCase() : value;
  }
  function targetsParent(childPath, relation, parentPath) {
    const target = typeof _dbResolveRelationDbPath === 'function' ? _dbResolveRelationDbPath(childPath, relation) : relation.relationDb || childPath;
    // The parent is an actual API path; only the relation target is a configured path.
    const parent = parentPath;
    return canonicalPath(target) === canonicalPath(parent);
  }
  function resolve(config, types) {
    const find = column => column?.id
      ? Object.keys(types).find(name => String(types[name]?.property_id || '') === String(column.id)) || ''
      : column?.name || '';
    return { ...config, relationProp: config.relationColumn ? find(config.relationColumn) : config.relationProp,
      fields: config.columns ? config.columns.map(find).filter(Boolean) : config.fields || [] };
  }
  function parentTokens(ctx) {
    return new Set([ctx.data?.entry_id, ctx.data?.id, ctx.data?.entity,
      String(ctx.entityPath || '').split(/[\\/]/).at(-1)?.replace(/\.md$/, '')].filter(Boolean).map(String));
  }
  function matches(values, tokens) {
    return (Array.isArray(values) ? values : []).filter(item => ['採用', '掲載済み'].includes(item?.status || '採用'))
      .some(item => String(item?.value || '').split(',').some(value => tokens.has(value.trim())));
  }
  function button(label, run) {
    const element = document.createElement('button'); element.type = 'button'; element.className = 'gb-btn';
    element.textContent = label; element.addEventListener('click', event => { event.stopPropagation(); run(event); }); return element;
  }
  function settings(anchor, cell, ctx) {
    _elCloseEditPopups();
    const popup = document.createElement('div'); popup.className = 'gb-context-menu el-edit-popup gb-form-subform-settings';
    popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', '繰り返し項目の設定');
    const current = cell.subform || {};
    const title = document.createElement('input'); title.value = current.title || '繰り返し項目';
    const path = document.createElement('input'); path.value = current.dbPath || ''; path.placeholder = '関連シートのパス';
    for (const [label, input] of [['見出し', title], ['関連シート', path]]) {
      const row = document.createElement('label'); row.textContent = label; input.className = 'gb-input'; input.setAttribute('aria-label', label); row.appendChild(input); popup.appendChild(row);
    }
    if (typeof _attachDbPicker === 'function') _attachDbPicker(path, ctx.dbPath);
    const relation = document.createElement('select'); relation.className = 'gb-select'; relation.setAttribute('aria-label', '親トピックを参照する列');
    const fields = document.createElement('div'); fields.className = 'gb-form-subform-columns';
    const message = document.createElement('p'); message.setAttribute('role', 'status');
    let types = null, loadedPath = '', generation = 0;
    const load = async () => {
      const value = path.value.trim(), sequence = ++generation; types = null; loadedPath = ''; relation.replaceChildren(); fields.replaceChildren();
      try {
        const metadata = await apiFetch('/db-metadata?path=' + encodeURIComponent(value), { silentError: true });
        if (!popup.isConnected || sequence !== generation || path.value.trim() !== value) return;
        types = metadata.property_types || {}; loadedPath = value;
        const empty = document.createElement('option'); empty.value = ''; empty.textContent = '親を参照するリレーション列を選択'; relation.appendChild(empty);
        Object.entries(types).forEach(([name, config]) => {
          if (['relation', 'multi-relation'].includes(config.type) && !config.bidirectional
            && targetsParent(value, config, ctx.dbPath)) {
            const option = document.createElement('option'); option.value = name; option.textContent = name; relation.appendChild(option);
          }
          const label = document.createElement('label');
          const input = document.createElement('input'); input.type = 'checkbox'; input.value = name;
          input.checked = (current.fields || []).includes(name); label.append(input, document.createTextNode(name)); fields.appendChild(label);
        });
        const resolved = resolve(current, types);
        relation.value = resolved.relationProp || '';
        fields.querySelectorAll('input').forEach(input => { input.checked = resolved.fields.includes(input.value); });
        message.textContent = '親シートを参照する単方向のリレーション列を使います。行は関連シートへ保存します。';
      } catch (error) { if (sequence === generation) message.textContent = '読み込めません: ' + (error.message || error); }
    };
    popup.append(button('列を読み込む', load), relation, fields, message);
    path.addEventListener('change', () => { types = null; generation++; message.textContent = '「列を読み込む」で設定を確認してください'; });
    const apply = button('適用', () => {
      if (!types || loadedPath !== path.value.trim() || !relation.value) { message.textContent = '関連シートと親参照列を確認してください'; return; }
      const selected = [...fields.querySelectorAll('input:checked')].map(input => input.value).filter(name => name !== relation.value);
      if (!selected.length) { message.textContent = '表示する列を1つ以上選んでください'; return; }
      if (!_elCanMutateGrid(ctx.grid, ctx.options)) return;
      ctx.persist('フォーム: 繰り返し項目の設定', '', layout => {
        const target = layout.cells.find(item => item.id === cell.id);
        if (target) {
          const column = name => ({ id: types[name]?.property_id || '', name });
          target.subform = { ...target.subform, title: title.value.trim(), dbPath: loadedPath,
            relationProp: relation.value, fields: selected,
            relationColumn: column(relation.value), columns: selected.map(column) };
        }
      });
      close(); ctx.rerender();
    });
    apply.classList.add('gb-btn-primary');
    const close = _elAttachPopupCommon(popup, anchor, { id: 'form-subform-settings', actions: [apply] });
    if (path.value) load();
  }
  function render(cell, ctx) {
    const root = document.createElement('div'); root.className = 'el-cell-content gb-form-subform';
    let cfg = cell.subform || {};
    const heading = document.createElement('strong'); heading.textContent = cfg.title || '繰り返し項目'; root.appendChild(heading);
    const body = document.createElement('div'); root.appendChild(body);
    if (!cfg.dbPath || !(cfg.relationProp || cfg.relationColumn) || !(cfg.fields?.length || cfg.columns?.length)) { body.textContent = '設定から関連シート・親参照列・表示列を指定してください'; return root; }
    if (ctx.options?.layoutDraft || !ctx.entityPath) { body.textContent = (cfg.fields || cfg.columns.map(column => column.name)).join(' / ') + '（トピックの表示時に関連行を読み込みます）'; return root; }
    let loading = false;
    const load = async () => {
      if (loading) return; loading = true; body.textContent = '関連行を読み込んでいます…';
      try {
        const [pivot, metadata, access] = await Promise.all([
          apiFetch('/pivot?path=' + encodeURIComponent(cfg.dbPath), { silentError: true }),
          apiFetch('/db-metadata?path=' + encodeURIComponent(cfg.dbPath), { silentError: true }),
          MeldexEntityDetail.resolveReadOnly(cfg.dbPath, false),
        ]);
        if (!root.isConnected) return;
        cfg = resolve(cfg, metadata.property_types || {});
        if (!cfg.fields.length) throw new Error('表示列が見つかりません。配置編集から確認してください');
        const relation = metadata.property_types?.[cfg.relationProp];
        if (!relation || !['relation', 'multi-relation'].includes(relation.type)
          || !targetsParent(cfg.dbPath, relation, ctx.dbPath)) throw new Error('親参照列の設定が変わりました。配置編集から確認してください');
        body.replaceChildren();
        const table = document.createElement('table'); table.className = 'gb-form-subform-table';
        const header = table.createTHead().insertRow();
        ['トピック', ...cfg.fields, '操作'].forEach(name => { const th = document.createElement('th'); th.textContent = name; header.appendChild(th); });
        const rows = table.createTBody(), tokens = parentTokens(ctx);
        const related = Object.entries(pivot.entities || {}).filter(([, values]) => matches(values[cfg.relationProp], tokens));
        related.forEach(([name, values]) => {
          const tr = rows.insertRow(); tr.insertCell().textContent = name;
          cfg.fields.forEach(prop => { tr.insertCell().textContent = (values[prop] || []).filter(item => ['採用', '掲載済み'].includes(item.status || '採用')).map(item => item.value || '').join(' / '); });
          tr.insertCell().appendChild(button('行を開く', () => openRow(_entityPath(cfg.dbPath, name, pivot), name, metadata.property_types, access.readOnly)));
        });
        body.appendChild(table);
        if (!related.length) { const empty = document.createElement('p'); empty.textContent = '関連行はありません'; body.appendChild(empty); }
        const canAdd = !ctx.readOnly && !access.readOnly && !relation.bidirectional && !ctx.editMode
          && api().writable(ctx.grid, cfg.dbPath, ctx.options?.ctx);
        if (canAdd) body.appendChild(button('行を追加', () => openNew(metadata.property_types)));
        body.appendChild(button('関連行を再読込', load));
      } catch (error) {
        if (root.isConnected) { body.textContent = '関連行を読み込めません: ' + (error.message || error); body.appendChild(button('再試行', load)); }
      } finally { loading = false; }
    };
    async function popup(anchor, label) {
      for (const previous of document.querySelectorAll('.gb-form-subform-editor')) {
        if (previous._requestClose && !await previous._requestClose()) return null;
      }
      _elCloseEditPopups();
      const panel = document.createElement('div'); panel.className = 'gb-context-menu el-edit-popup gb-form-subform-editor';
      panel._formOwner = ctx.grid;
      panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', label);
      const close = _elAttachPopupCommon(panel, anchor || root, {
        beforeClose: () => api().confirmLeave(panel),
        onClose: load,
        childSelector: '.gb-fmt-popup,.gb-palette,.gb-palette-popup,.status-dropdown,.cell-inline-dd,.user-dropdown,.gb-user-picker-dd,[aria-modal="true"]',
      });
      return { panel, close };
    }
    async function openNew(types) {
      const opened = await popup(root, '繰り返し項目の行を追加');
      if (!opened) return;
      const name = ctx.data?.entry_id || ctx.data?.id || ctx.data?.entity;
      const formCfg = { fields: [...cfg.fields, cfg.relationProp], required: [cfg.relationProp], labels: {}, descriptions: {}, placeholders: {}, entityNameProp: cfg.fields[0], submitLabel: '行を追加' };
      opened.panel.appendChild(_buildFormAnswerPanel(cfg.dbPath, formCfg, types, false, {
        fixedFields: { [cfg.relationProp]: String(name || '') },
        canWrite: async () => !ctx.readOnly && await api().canWrite(ctx.grid, ctx.dbPath, ctx.entityPath, ctx.options?.ctx)
          && await api().canWrite(opened.panel, cfg.dbPath, cfg.dbPath, null),
        onCreated() { opened.close(); load(); },
      }));
    }
    async function openRow(path, name, types, readOnly) {
      const opened = await popup(root, '繰り返し項目: ' + name);
      if (!opened) return;
      const host = document.createElement('div'); opened.panel.appendChild(host);
      try {
        const [data, access] = await Promise.all([apiFetch('/entity?path=' + encodeURIComponent(path)), MeldexEntityDetail.resolveReadOnly(path, readOnly || ctx.readOnly)]);
        if (!host.isConnected) return;
        const layout = { formConfig: { fields: cfg.fields }, cells: cfg.fields.map(prop => ({ type: 'field', prop })) };
        const childCtx = { grid: host, data, entityPath: path, dbPath: cfg.dbPath, propTypes: types, layout,
          editMode: false, readOnly: access.readOnly, options: { readOnly: access.readOnly,
            beforeWrite: () => !ctx.readOnly && api().canWrite(ctx.grid, ctx.dbPath, ctx.entityPath, ctx.options?.ctx) }, rerender() {} };
        cfg.fields.forEach(prop => {
          const field = document.createElement('div'); field.className = 'gb-form-subform-row-field';
          const label = document.createElement('strong'); label.textContent = prop; field.appendChild(label);
          if (!api().renderField(field, { prop }, childCtx)) renderEntityPropValuesInto(field, prop, data, path, types, { readOnly: access.readOnly });
          host.appendChild(field);
        });
      } catch (error) { if (host.isConnected) host.textContent = '読み込めません: ' + (error.message || error); }
    }
    requestAnimationFrame(load);
    return root;
  }
  globalThis.MeldexDbFormSubform = { render, settings, matches, parentTokens, resolve, targetsParent };
})();
