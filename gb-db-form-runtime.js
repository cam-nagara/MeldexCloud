/* Shared scalar inputs, record navigation and form-view rendering. */
(function () {
  'use strict';
  const model = () => globalThis.MeldexDbFormModel;
  const viewSessions = new WeakMap();
  const normalPath = path => String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
  function writable(root, dbPath, ctx) {
    return !!root?.isConnected && root.__MeldexRuntimeReadOnly !== true && !ctx?.destroyed && !ctx?.writeBlocked && ctx?.readOnly !== true && ctx?.access !== 'viewer'
      && !_cellUiRuntimeReadOnly(root)
      && !isProductionManagementWriteBlocked(dbPath, ctx);
  }
  async function canWrite(root, dbPath, path, ctx) {
    if (!writable(root, dbPath, ctx)) return false;
    const access = await globalThis.MeldexEntityDetail?.resolveReadOnly?.(path || dbPath, false);
    return writable(root, dbPath, ctx) && !access?.readOnly;
  }
  function validation(cfg, prop, value, ctx) {
    const sheetRules = typeof getValidationRules === 'function' ? getValidationRules(ctx.dbPath) : [];
    const rule = model().ruleFor(cfg, prop, sheetRules);
    const type = ctx.propTypes?.[prop]?.type || 'text';
    const error = model().validate(cfg.labels?.[prop] || prop, value, type, rule);
    if (error) return error;
    if (typeof _validateRangeCheck === 'function') {
      const properties = { ...(ctx.data.properties || {}), [prop]: [{ value, status: '採用' }] };
      for (const item of sheetRules.filter(item => item.enabled !== false && item.type === 'range_check'
        && [item.config?.property, item.config?.compareProperty].includes(prop))) {
        const result = _validateRangeCheck(item, { record: properties }, ['record'], ctx.dbPath, ctx.propTypes);
        if (result.length) return result[0].message;
      }
    }
    return '';
  }
  async function saveScalar(ctx, prop, value, candidate) {
    const path = ctx.entityPath;
    const dbPath = typeof _dbPathFromEntityPath === 'function' ? _dbPathFromEntityPath(path) : ctx.dbPath;
    if (ctx.readOnly || !_elCanMutateGrid(ctx.grid, ctx.options)
      || ctx.options?.beforeWrite && !await ctx.options.beforeWrite()
      || !await canWrite(ctx.grid, dbPath, path, ctx.options?.ctx)) {
      throw new Error('このトピックは読み取り専用です');
    }
    const blocked = typeof checkColumnEditable === 'function' ? checkColumnEditable(dbPath, prop, ctx.options?.ctx) : '';
    if (blocked) throw new Error(blocked);
    if (candidate) {
      const old = candidate.value;
      const result = await _apiPutValue(candidate, { new_value: value });
      noteRevision(ctx, result);
      candidate.value = value;
      if (typeof historyPush === 'function' && old !== value) {
        const restore = async next => { noteRevision(ctx, await _apiPutValue(candidate, { new_value: next })); candidate.value = next; ctx.rerender(); };
        historyPush('フォーム: ' + prop, () => restore(old), () => restore(value), '');
      }
      return candidate;
    }
    const result = await _apiPostValue(path, prop, value, '採用', '', undefined, { baseRevision: ctx.data.revision });
    noteRevision(ctx, result);
    const created = { property: prop, value, status: '採用', note: '', file: result.path || path,
      entry_path: result.new_path || path, candidate_index: result.candidate_index, entry_revision: result.revision };
    if (!ctx.data.properties) ctx.data.properties = {};
    if (!Array.isArray(ctx.data.properties[prop])) ctx.data.properties[prop] = [];
    ctx.data.properties[prop].push(created);
    if (typeof historyPush === 'function') {
      historyPush('フォーム: 項目を入力 ' + prop, async () => {
        noteRevision(ctx, await _apiPutValue(created, { _delete: true }));
        ctx.data.properties[prop] = ctx.data.properties[prop].filter(item => item !== created); ctx.rerender();
      }, async () => {
        const next = await _apiPostValue(path, prop, value, '採用', '');
        noteRevision(ctx, next);
        Object.assign(created, { candidate_index: next.candidate_index, entry_revision: next.revision, file: next.path || path });
        ctx.data.properties[prop].push(created); ctx.rerender();
      }, '');
    }
    return created;
  }
  function noteRevision(ctx, result) {
    if (result?.revision == null) return;
    ctx.data.revision = result.revision;
    Object.values(ctx.data.properties || {}).forEach(values => {
      if (Array.isArray(values)) values.forEach(value => { value.entry_revision = result.revision; });
    });
  }
  function renderField(body, cell, ctx) {
    if (!ctx.layout.formConfig || !model().supportsScalar(ctx.propTypes?.[cell.prop]?.type)) return false;
    const cfg = model().forLayout(ctx.layout);
    const prop = cell.prop;
    if (!cfg.fields.includes(prop)) return false;
    const values = ctx.data?.properties?.[prop] || [];
    const candidates = typeof filterValues === 'function' ? filterValues(values) : values;
    if (candidates.some(item => item.rich_html)) return false;
    let candidate = candidates[0] || null;
    const row = _buildFormInputRow(prop, cfg, ctx.propTypes?.[prop] || { type: 'text' });
    row.classList.add('gb-form-layout-field'); row.querySelector('.gb-form-input-label')?.remove();
    const input = row.querySelector('input,textarea,select');
    const type = input.dataset.formType;
    let savedValue = String(candidate?.value ?? '');
    if (type === 'select' && savedValue && ![...input.options].some(option => option.value === savedValue)) {
      const retained = document.createElement('option'); retained.value = savedValue; retained.textContent = savedValue + '（既存の値）'; input.appendChild(retained);
    }
    if (type === 'checkbox') input.checked = ['true', '1'].includes(savedValue);
    else input.value = type === 'date' && typeof _toInputDateValue === 'function'
      ? _toInputDateValue(savedValue, ctx.propTypes[prop]?.withTime) : savedValue;
    input.disabled = ctx.editMode || ctx.readOnly || !_elCanMutateGrid(ctx.grid, ctx.options)
      || !!checkColumnEditable(ctx.dbPath, prop, ctx.options?.ctx);
    const message = row.querySelector('.gb-form-field-error');
    const read = () => type === 'checkbox' ? String(input.checked) : input.value;
    // Compare the input representation; opening a legacy date/checkbox is not an edit.
    savedValue = read();
    let busy = false;
    const commit = async () => {
      if (busy || input.disabled || !row.isConnected || read() === savedValue) return;
      const value = read(), error = validation(cfg, prop, value, ctx);
      input.setCustomValidity(error); input.setAttribute('aria-invalid', String(!!error));
      message.textContent = error;
      if (error) return;
      busy = true; message.textContent = '保存しています…';
      let succeeded = false;
      const pending = saveScalar(ctx, prop, value, candidate);
      if (!ctx.grid._formPendingSaves) ctx.grid._formPendingSaves = new Set();
      ctx.grid._formPendingSaves.add(pending); ctx.grid.dataset.formHasPending = 'true';
      try {
        candidate = await pending; succeeded = true;
        savedValue = value; input.dataset.formDirty = String(read() !== savedValue);
        message.textContent = '保存しました';
        ctx.grid.querySelectorAll('.gb-form-layout-field').forEach(peer => peer._refreshFormField?.(prop, value, candidate));
      } catch (error) {
        message.textContent = '保存できません: ' + (error.userMessage || error.message || error);
        input.dataset.formDirty = 'true';
      } finally {
        busy = false; ctx.grid._formPendingSaves.delete(pending);
        if (!ctx.grid._formPendingSaves.size) delete ctx.grid.dataset.formHasPending;
        if (succeeded && row.isConnected && read() !== savedValue) queueMicrotask(commit);
      }
    };
    input.addEventListener('input', () => { input.dataset.formDirty = String(read() !== savedValue); });
    row._refreshFormField = (property, value, latest) => {
      if (property !== prop || busy || input.dataset.formDirty === 'true') return;
      candidate = latest; savedValue = value;
      if (type === 'checkbox') input.checked = value === 'true'; else input.value = value;
      input.setCustomValidity(''); input.removeAttribute('aria-invalid'); message.textContent = '';
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', event => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape' && !busy) {
        event.preventDefault(); event.stopPropagation();
        if (type === 'checkbox') input.checked = ['true', '1'].includes(savedValue); else input.value = savedValue;
        input.dataset.formDirty = 'false'; input.setCustomValidity(''); input.removeAttribute('aria-invalid'); message.textContent = '';
      }
      if (event.key === 'Enter' && input.tagName !== 'TEXTAREA') { event.preventDefault(); commit(); }
    });
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'gb-btn'; retry.textContent = '保存';
    retry.disabled = input.disabled; retry.setAttribute('aria-label', prop + 'を保存'); retry.addEventListener('click', commit);
    row.appendChild(retry); body.appendChild(row);
    if (candidates.length > 1) {
      const more = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = '候補一覧（' + candidates.length + '件）'; more.appendChild(summary);
      const list = document.createElement('div');
      renderEntityPropValuesInto(list, prop, ctx.data, ctx.entityPath, ctx.propTypes, { readOnly: true });
      more.appendChild(list); body.appendChild(more);
    }
    return true;
  }
  function applyNewLayout(form, layout, propTypes, dbPath, ctx) {
    const host = document.createElement('div'); host.className = 'el-host';
    const viewport = document.createElement('div'); viewport.className = 'el-viewport';
    const canvas = document.createElement('div'); canvas.className = 'el-canvas';
    canvas.style.width = layout.canvasSize.w + 'px'; canvas.style.height = layout.canvasSize.h + 'px';
    viewport.appendChild(canvas); host.appendChild(viewport);
    if (typeof _elApplyLayoutTheme === 'function') _elApplyLayoutTheme(canvas, layout);
    const rows = [...form.querySelectorAll('.gb-form-input-row')];
    const placed = new Map();
    const sync = event => {
      const source = event.target;
      for (const row of placed.get(source.name) || []) {
        const control = row.querySelector('input,textarea,select');
        if (!control || control === source || control.type === 'file') continue;
        control.value = source.value; control.checked = source.checked;
        control.setCustomValidity(source.validity.customError ? source.validationMessage : '');
        control.dataset.formDirty = 'true';
        row.querySelector('.gb-form-field-error').textContent = source.closest('.gb-form-input-row').querySelector('.gb-form-field-error').textContent;
      }
    };
    form.addEventListener('input', sync); form.addEventListener('change', sync);
    for (const cell of model().orderedCells(layout)) {
      if (cell.type !== 'field') {
        const element = _elBuildCellElement(cell, { grid: host, entityPath: '', dbPath, data: { properties: {} }, layout,
          editMode: false, readOnly: true, options: { readOnly: true, layoutDraft: { layout } }, propTypes, rerender() {} }, canvas);
        element.style.zIndex = String(layout.cells.indexOf(cell)); canvas.appendChild(element);
        continue;
      }
      let row = rows.find(row => row.dataset.formProp === cell.prop);
      if (!row) continue;
      const peers = placed.get(cell.prop) || [];
      if (peers.length && row.querySelector('input')?.type !== 'file') {
        row = _buildFormInputRow(cell.prop, model().forLayout(layout), propTypes[cell.prop]
          || { type: cell.columnType || 'text', options: cell.columnOptions || [] });
      } else if (peers.length) {
        // File inputs have one upload source; additional placements display the chosen names.
        row = document.createElement('div'); row.textContent = '画像は同じ項目の入力欄から追加してください';
        const source = peers[0].querySelector('input');
        source.addEventListener('change', () => { row.textContent = [...source.files].map(file => file.name).join('、') || '画像未選択'; });
      }
      peers.push(row); placed.set(cell.prop, peers);
      const element = document.createElement('div'); element.className = 'el-cell el-cell-field gb-form-new-cell';
      element.style.zIndex = String(layout.cells.indexOf(cell));
      for (const [key, value] of Object.entries({ left: cell.x, top: cell.y, width: cell.w, height: cell.h })) element.style[key] = value + 'px';
      _elApplyCellStyle(element, cell, { editMode: false });
      const content = document.createElement('div'); content.className = 'el-cell-content'; content.appendChild(row); element.appendChild(content); canvas.appendChild(element);
      if (!Object.prototype.hasOwnProperty.call(propTypes, cell.prop)) {
        const control = row.querySelector('input,textarea,select'); if (control) control.disabled = true;
        const add = document.createElement('button'); add.type = 'button'; add.className = 'gb-btn'; add.textContent = '列を追加';
        add.setAttribute('aria-label', '「' + cell.prop + '」列をシートに追加');
        const message = document.createElement('span'); message.setAttribute('role', 'status');
        row.append(add, message);
        add.addEventListener('click', async () => {
          if (!await canWrite(host, dbPath, dbPath, ctx)) return;
          add.disabled = true;
          try {
            const result = await _elAddMissingColumn({ grid: host, dbPath, options: { ctx } }, cell);
            if (result && host.isConnected) {
              Object.assign(propTypes, result.propertyTypes);
              peers.forEach(peer => {
                peer.querySelectorAll('input,textarea,select').forEach(input => { input.disabled = !!checkColumnEditable(dbPath, cell.prop, ctx); });
                peer.querySelectorAll('[data-form-add-column]').forEach(button => button.remove());
              });
              message.textContent = '';
            }
          } catch (error) { message.textContent = error.userMessage || error.message || String(error); }
          finally { add.disabled = false; }
        });
        add.dataset.formAddColumn = cell.prop;
      }
    }
    form.querySelector('button[type=submit]').before(host);
  }
  async function confirmLeave(root) {
    for (const popup of document.querySelectorAll('.gb-form-subform-editor')) {
      if (popup._formOwner && (popup._formOwner === root || root.contains(popup._formOwner))
        && popup._requestClose && !await popup._requestClose()) return false;
    }
    if ([root, ...root.querySelectorAll('form')].some(form => form._dbFormSubmitting)) {
      if (typeof showStatus === 'function') showStatus('送信完了までお待ちください');
      return false;
    }
    const hosts = [root, ...root.querySelectorAll('[data-form-has-pending]')];
    await Promise.allSettled(hosts.flatMap(host => [...(host._formPendingSaves || [])]));
    return !root.querySelector('[data-form-dirty="true"]') || await cfConfirm('保存できていない入力を破棄して切り替えますか？');
  }
  function renderView(root, dbPath, cfg, propTypes, ctx) {
    const owner = ctx?.containerEl || root;
    let session = viewSessions.get(owner);
    if (!session || session.dbPath !== dbPath) { session = { dbPath, path: '', continuous: false, created: new Map() }; viewSessions.set(owner, session); }
    const nav = document.createElement('div'); nav.className = 'gb-form-record-nav'; root.appendChild(nav);
    const select = document.createElement('select'); select.className = 'gb-select'; select.setAttribute('aria-label', '入力・閲覧するトピック');
    const fresh = document.createElement('option'); fresh.value = ''; fresh.textContent = '新規入力'; select.appendChild(fresh);
    const pivot = ctx?.pivotData || globalThis.state?.pivotData || { entities: {} };
    for (const name of Object.keys(pivot.entities || {})) {
      const option = document.createElement('option'); option.value = _entityPath(dbPath, name, pivot); option.textContent = name;
      select.appendChild(option);
    }
    for (const [path, name] of session.created) {
      if ([...select.options].some(option => normalPath(option.value) === normalPath(path))) continue;
      const option = document.createElement('option'); option.value = path; option.textContent = name; select.appendChild(option);
    }
    select.value = session.path;
    const change = async path => {
      if (!await confirmLeave(panel)) { select.value = session.path; return; }
      session.path = path; select.value = path; await renderRecord();
    };
    const button = (label, fn) => { const result = document.createElement('button'); result.type = 'button'; result.className = 'gb-btn'; result.textContent = label; result.addEventListener('click', fn); nav.appendChild(result); return result; };
    const previous = button('前のトピック', () => change(select.options[Math.max(1, select.selectedIndex - 1)]?.value || ''));
    nav.appendChild(select);
    const next = button('次のトピック', () => change(select.options[Math.min(select.options.length - 1, select.selectedIndex + 1)]?.value || ''));
    button('新規入力', () => change(''));
    const continuous = document.createElement('label');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = session.continuous;
    continuous.append(checkbox, document.createTextNode('続けて新規入力')); nav.appendChild(continuous);
    checkbox.addEventListener('change', () => { session.continuous = checkbox.checked; });
    select.addEventListener('change', () => change(select.value));
    const panel = document.createElement('div'); panel.className = 'gb-form-record-panel'; root.appendChild(panel);
    let generation = 0;
    async function renderRecord() {
      const current = ++generation;
      panel.replaceChildren();
      previous.disabled = select.selectedIndex <= 1; next.disabled = select.selectedIndex >= select.options.length - 1;
      if (!session.path) {
        const fields = cfg.fields.filter(prop => !checkColumnEditable(dbPath, prop, ctx));
        const effective = { ...cfg, fields, required: cfg.required.filter(prop => fields.includes(prop)), submitLabel: 'トピックを作成' };
        const layout = ctx?.formApp?.getLayout() || _elGetState(dbPath).layouts.find(item => item.id === cfg.layoutId);
        const displayTypes = { ...propTypes };
        (layout?.cells || []).forEach(cell => { if (cell.type === 'field' && !displayTypes[cell.prop]) displayTypes[cell.prop] = { type: cell.columnType || 'text', options: cell.columnOptions || [] }; });
        const form = _buildFormAnswerPanel(dbPath, effective, displayTypes, false, { canWrite: () => canWrite(panel, dbPath, dbPath, ctx), async onCreated(result) {
          const name = result.name || result.entity || (result.path || '').split(/[\\/]/).at(-1)?.replace(/\.md$/, '') || 'トピック';
          session.created.set(result.path, name);
          const option = document.createElement('option'); option.value = result.path; option.textContent = name; select.appendChild(option);
          session.path = session.continuous ? '' : result.path; select.value = session.path; await renderRecord();
        } });
        if (layout) applyNewLayout(form, layout, propTypes, dbPath, ctx);
        form.addEventListener('input', event => { if (event.target.matches('input,textarea,select')) event.target.dataset.formDirty = 'true'; });
        panel.appendChild(form);
        if (!writable(panel, dbPath, ctx)) form.querySelectorAll('input,textarea,select,button').forEach(control => { control.disabled = true; });
        return;
      }
      const path = session.path;
      panel.textContent = 'トピックを読み込んでいます…';
      try {
        const [data, access] = await Promise.all([apiFetch('/entity?path=' + encodeURIComponent(path)), MeldexEntityDetail.resolveReadOnly(path, false)]);
        if (!panel.isConnected || generation !== current) return;
        panel.replaceChildren();
        const layout = ctx?.formApp?.getLayout() || _elGetState(dbPath).layouts.find(item => item.id === cfg.layoutId);
        if (layout) _elRenderLayoutBody(panel, data, path, { propTypes, ctx, readOnly: access.readOnly || ctx?.readOnly, formLayout: ctx?.formApp?.getLayout() }, dbPath, layout.id, renderRecord);
        else {
          const hint = document.createElement('p'); hint.textContent = '既存トピックの編集には共通レイアウトを選択してください。'; panel.appendChild(hint);
          await MeldexEntityDetail.mount({ root: panel, path, surface: 'main', readOnly: access.readOnly }).ready;
        }
      } catch (error) {
        if (generation === current && panel.isConnected) {
          panel.textContent = '読み込めません: ' + (error.userMessage || error.message || error);
          const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '再読込'; retry.addEventListener('click', renderRecord); panel.appendChild(retry);
        }
      }
    }
    renderRecord();
  }
  globalThis.MeldexDbFormRuntime = { renderField, renderView, canWrite, writable, validation, saveScalar, confirmLeave, normalPath, applyNewLayout };
})();
