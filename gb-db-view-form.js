/* シート フォームビュー */

const DB_FORM_UNSUPPORTED_TYPES = new Set(['formula', 'rollup', 'button', 'chat']);
const DB_FORM_PUBLIC_HIDDEN_TYPES = new Set(['relation', 'multi-relation', 'user', 'multi-user', 'multi-source-relation']);

function makeDefaultFormViewConfig(props, propTypes) {
  const fields = (props || []).filter(p => !DB_FORM_UNSUPPORTED_TYPES.has(propTypes?.[p]?.type));
  return {
    fields,
    required: [],
    descriptions: {},
    placeholders: {},
    labels: {},
    entityNameProp: '',
    submitLabel: '送信',
    successMessage: '送信しました',
    headerTitle: '',
    headerDescription: '',
    mode: 'edit',
  };
}

function normalizeDbFormConfig(config, props, propTypes) {
  const allProps = Array.from(new Set([...(props || []), ...Object.keys(propTypes || {})]));
  const base = makeDefaultFormViewConfig(allProps, propTypes);
  const src = config && typeof config === 'object' ? config : {};
  const allowed = new Set(allProps.filter(p => !DB_FORM_UNSUPPORTED_TYPES.has(propTypes?.[p]?.type)));
  const fields = Array.isArray(src.fields) ? src.fields.filter(p => allowed.has(p)) : base.fields;
  return {
    ...base,
    ...src,
    fields,
    required: Array.isArray(src.required) ? src.required.filter(p => fields.includes(p)) : [],
    descriptions: src.descriptions && typeof src.descriptions === 'object' ? src.descriptions : {},
    placeholders: src.placeholders && typeof src.placeholders === 'object' ? src.placeholders : {},
    labels: src.labels && typeof src.labels === 'object' ? src.labels : {},
    entityNameProp: fields.includes(src.entityNameProp) ? src.entityNameProp : '',
  };
}

function _getActiveFormViewRecord(dbPath, ctx) {
  const idx = Number.isInteger(ctx?.currentViewIdx) ? ctx.currentViewIdx : getCurrentViewIdx(dbPath);
  const views = getSavedViews(dbPath);
  return { idx, views, view: idx >= 0 ? views[idx] : null };
}

function getActiveFormConfig(dbPath, props, propTypes, ctx) {
  const { view } = _getActiveFormViewRecord(dbPath, ctx);
  const cfg = view?.typeSpecific?.form?.formConfig || view?.formConfig || getDbViewConfig(dbPath).formConfig || null;
  return normalizeDbFormConfig(cfg, props, propTypes);
}

function saveActiveFormConfig(dbPath, formConfig, ctx) {
  const { idx, views } = _getActiveFormViewRecord(dbPath, ctx);
  if (idx >= 0 && views[idx]) {
    if (!views[idx].typeSpecific || typeof views[idx].typeSpecific !== 'object' || Array.isArray(views[idx].typeSpecific)) views[idx].typeSpecific = {};
    if (!views[idx].typeSpecific.form || typeof views[idx].typeSpecific.form !== 'object' || Array.isArray(views[idx].typeSpecific.form)) views[idx].typeSpecific.form = {};
    views[idx].typeSpecific.form.formConfig = formConfig;
    setSavedViews(dbPath, views, { label: 'シート表示: フォーム設定' });
  } else {
    setCurrentDbViewTypeSpecific(dbPath, 'form', { formConfig }, { ctx, historyLabel: 'シート表示: フォーム設定' });
  }
}

function _formContainer(ctx) {
  if (typeof _dbViewSurfaceEl === 'function') return _dbViewSurfaceEl(ctx, '.form-view', 'form-view');
  return (ctx?.containerEl ? ctx.containerEl.querySelector('.form-view') : null)
    || document.getElementById('form-view')
    || document.querySelector('.form-view');
}

function renderDbFormView(ctx) {
  ctx = ctx || _currentPaneState();
  const dbPath = ctx.dbPath || state.currentDbPath;
  const root = _formContainer(ctx);
  if (!root || !dbPath) return;
  root.style.display = 'flex';
  const pivot = ctx.pivotData || state.pivotData || { properties: [] };
  const propTypes = getPropertyTypes(dbPath) || {};
  const formProps = typeof filterDeletedDbProperties === 'function'
    ? filterDeletedDbProperties(dbPath, pivot.properties || [])
    : (pivot.properties || []);
  let cfg = getActiveFormConfig(dbPath, formProps, propTypes, ctx);
  root.innerHTML = '';
  root.classList.add('gb-form-view');

  const toolbar = document.createElement('div');
  toolbar.className = 'gb-form-toolbar';
  const mkBtn = (label, active, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gb-btn gb-btn-sm' + (active ? ' active' : '');
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  };
  toolbar.appendChild(mkBtn('編集', cfg.mode !== 'answer', () => {
    cfg.mode = 'edit'; saveActiveFormConfig(dbPath, cfg, ctx); renderDbFormView(ctx);
  }));
  toolbar.appendChild(mkBtn('回答プレビュー', cfg.mode === 'answer', () => {
    cfg.mode = 'answer'; saveActiveFormConfig(dbPath, cfg, ctx); renderDbFormView(ctx);
  }));
  root.appendChild(toolbar);

  if (cfg.mode === 'answer') {
    root.appendChild(_buildFormAnswerPanel(dbPath, cfg, propTypes, false, { previewOnly: !(cfg.customInstructionsRelay || cfg.betaFeedbackRelay) }));
    return;
  }

  const editor = document.createElement('div');
  editor.className = 'gb-form-editor';
  const side = document.createElement('div');
  side.className = 'gb-form-field-palette';
  const preview = document.createElement('div');
  preview.className = 'gb-form-preview';

  const titleInput = document.createElement('input');
  titleInput.className = 'gb-input gb-form-title-input';
  titleInput.placeholder = 'フォームタイトル';
  titleInput.value = cfg.headerTitle || '';
  titleInput.addEventListener('change', () => { cfg.headerTitle = titleInput.value; saveActiveFormConfig(dbPath, cfg, ctx); renderDbFormView(ctx); });
  side.appendChild(titleInput);
  const desc = document.createElement('textarea');
  desc.className = 'gb-input';
  desc.rows = 3;
  desc.placeholder = '説明';
  desc.value = cfg.headerDescription || '';
  desc.addEventListener('change', () => { cfg.headerDescription = desc.value; saveActiveFormConfig(dbPath, cfg, ctx); });
  side.appendChild(desc);

  formProps.forEach(prop => {
    const type = propTypes[prop]?.type || 'text';
    if (DB_FORM_UNSUPPORTED_TYPES.has(type)) return;
    const row = document.createElement('div');
    row.className = 'gb-form-prop-row';
    const checked = cfg.fields.includes(prop);
    row.innerHTML = `<label><input type="checkbox" ${checked ? 'checked' : ''}> ${esc(prop)} <span>${esc(type)}</span></label>`;
    const cb = row.querySelector('input');
    cb.addEventListener('change', () => {
      if (cb.checked && !cfg.fields.includes(prop)) cfg.fields.push(prop);
      if (!cb.checked) cfg.fields = cfg.fields.filter(p => p !== prop);
      saveActiveFormConfig(dbPath, cfg, ctx);
      renderDbFormView(ctx);
    });
    side.appendChild(row);
  });

  preview.appendChild(_buildFormEditorFields(dbPath, cfg, propTypes, () => {
    saveActiveFormConfig(dbPath, cfg, ctx);
    renderDbFormView(ctx);
  }, ctx));
  editor.appendChild(side);
  editor.appendChild(preview);
  root.appendChild(editor);
}

function _buildFormEditorFields(dbPath, cfg, propTypes, refresh, ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'gb-form-fields-editor';
  const settings = document.createElement('div');
  settings.className = 'gb-form-field-editor-row gb-form-config-editor';
  const entityNameOptions = [''].concat(cfg.fields || []).map(prop => {
    const selected = (cfg.entityNameProp || '') === prop ? ' selected' : '';
    return '<option value="' + esc(prop) + '"' + selected + '>' + esc(prop || '(自動生成)') + '</option>';
  }).join('');
  settings.innerHTML = `<label class="field"><span>エントリ名にするフィールド</span><select id="gb-form-entity-name-prop" class="gb-input">${entityNameOptions}</select></label>`;
  settings.querySelector('#gb-form-entity-name-prop')?.addEventListener('change', e => {
    cfg.entityNameProp = e.target.value || '';
    saveActiveFormConfig(dbPath, cfg, ctx);
  });
  wrap.appendChild(settings);
  cfg.fields.forEach((prop, idx) => {
    const type = propTypes[prop]?.type || 'text';
    const row = document.createElement('div');
    row.className = 'gb-form-field-editor-row';
    const head = document.createElement('div');
    head.className = 'gb-form-field-head';
    head.textContent = cfg.labels[prop] || prop;
    const actions = document.createElement('div');
    actions.className = 'gb-form-field-actions';
    const btn = (icon, title, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'gb-icon-btn';
      b.title = title;
      b.innerHTML = typeof lucide === 'function' ? lucide(icon, 13) : title;
      b.addEventListener('click', fn);
      return b;
    };
    actions.appendChild(btn('arrowUp', '上へ', () => { if (idx > 0) { [cfg.fields[idx - 1], cfg.fields[idx]] = [cfg.fields[idx], cfg.fields[idx - 1]]; refresh(); } }));
    actions.appendChild(btn('arrowDown', '下へ', () => { if (idx < cfg.fields.length - 1) { [cfg.fields[idx + 1], cfg.fields[idx]] = [cfg.fields[idx], cfg.fields[idx + 1]]; refresh(); } }));
    actions.appendChild(btn('x', '除外', () => { cfg.fields = cfg.fields.filter(p => p !== prop); refresh(); }));
    head.appendChild(actions);
    row.appendChild(head);

    const label = document.createElement('input');
    label.className = 'gb-input';
    label.value = cfg.labels[prop] || prop;
    label.addEventListener('change', () => { cfg.labels[prop] = label.value.trim() || prop; saveActiveFormConfig(dbPath, cfg, ctx); });
    row.appendChild(label);
    const desc = document.createElement('input');
    desc.className = 'gb-input';
    desc.placeholder = '説明';
    desc.value = cfg.descriptions[prop] || '';
    desc.addEventListener('change', () => { cfg.descriptions[prop] = desc.value; saveActiveFormConfig(dbPath, cfg, ctx); });
    row.appendChild(desc);
    const placeholder = document.createElement('input');
    placeholder.className = 'gb-input';
    placeholder.placeholder = 'プレースホルダー';
    placeholder.value = cfg.placeholders[prop] || '';
    placeholder.addEventListener('change', () => { cfg.placeholders[prop] = placeholder.value; saveActiveFormConfig(dbPath, cfg, ctx); });
    row.appendChild(placeholder);
    const foot = document.createElement('label');
    foot.className = 'gb-check';
    foot.innerHTML = `<input type="checkbox" ${cfg.required.includes(prop) ? 'checked' : ''}><span>必須</span><span class="gb-form-type">${esc(type)}</span>`;
    foot.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked && !cfg.required.includes(prop)) cfg.required.push(prop);
      if (!e.target.checked) cfg.required = cfg.required.filter(p => p !== prop);
      saveActiveFormConfig(dbPath, cfg, ctx);
    });
    row.appendChild(foot);
    wrap.appendChild(row);
  });
  const submitRow = document.createElement('div');
  submitRow.className = 'gb-form-submit-editor';
  submitRow.innerHTML = `<input class="gb-input" id="gb-form-submit-label" value="${esc(cfg.submitLabel || '送信')}"><input class="gb-input" id="gb-form-success-message" value="${esc(cfg.successMessage || '送信しました')}">`;
  submitRow.querySelector('#gb-form-submit-label').addEventListener('change', e => { cfg.submitLabel = e.target.value || '送信'; saveActiveFormConfig(dbPath, cfg, ctx); });
  submitRow.querySelector('#gb-form-success-message').addEventListener('change', e => { cfg.successMessage = e.target.value || '送信しました'; saveActiveFormConfig(dbPath, cfg, ctx); });
  wrap.appendChild(submitRow);
  return wrap;
}

function _buildFormAnswerPanel(dbPath, cfg, propTypes, publicMode, options = {}) {
  const form = document.createElement('form');
  form.className = 'gb-form-answer';
  if (options.previewOnly) form.dataset.previewOnly = '1';
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitDbFormResponse(form, dbPath, cfg, propTypes, { previewOnly: !!options.previewOnly });
  });
  if (cfg.headerTitle) {
    const h = document.createElement('h2');
    h.textContent = cfg.headerTitle;
    form.appendChild(h);
  }
  if (cfg.headerDescription) {
    const p = document.createElement('p');
    p.className = 'gb-form-description';
    p.textContent = cfg.headerDescription;
    form.appendChild(p);
  }
  cfg.fields.forEach(prop => {
    const type = propTypes[prop]?.type || 'text';
    if (DB_FORM_UNSUPPORTED_TYPES.has(type)) return;
    if (publicMode && DB_FORM_PUBLIC_HIDDEN_TYPES.has(type)) return;
    form.appendChild(_buildFormInputRow(prop, cfg, propTypes[prop] || { type: 'text' }));
  });
  const submit = document.createElement('button');
  submit.className = 'gb-btn primary';
  submit.type = 'submit';
  submit.textContent = cfg.submitLabel || '送信';
  form.appendChild(submit);
  const msg = document.createElement('div');
  msg.className = 'gb-form-submit-message';
  form.appendChild(msg);
  return form;
}

function _buildFormInputRow(prop, cfg, ptc) {
  const type = ptc?.type || 'text';
  const row = document.createElement('label');
  row.className = 'gb-form-input-row';
  row.dataset.formProp = prop;
  const title = document.createElement('span');
  title.className = 'gb-form-input-label';
  title.textContent = cfg.labels[prop] || prop;
  if (cfg.required.includes(prop)) title.dataset.required = '1';
  row.appendChild(title);
  if (cfg.descriptions[prop]) {
    const desc = document.createElement('span');
    desc.className = 'gb-form-input-desc';
    desc.textContent = cfg.descriptions[prop];
    row.appendChild(desc);
  }
  let input;
  if (type === 'checkbox') {
    input = document.createElement('input');
    input.type = 'checkbox';
  } else if (type === 'number') {
    input = document.createElement('input');
    input.type = 'number';
  } else if (type === 'date') {
    input = document.createElement('input');
    input.type = ptc.withTime ? 'datetime-local' : 'date';
  } else if (type === 'url') {
    input = document.createElement('input');
    input.type = 'url';
  } else if (type === 'long-text') {
    input = document.createElement('textarea');
    input.rows = 4;
  } else if (type === 'select') {
    input = document.createElement('select');
    input.innerHTML = '<option value=""></option>' + (ptc.options || []).map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
  } else if (type === 'multi-select') {
    input = document.createElement('input');
    input.type = 'text';
    input.placeholder = (ptc.options || []).join(', ');
  } else if (type === 'image') {
    input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*';
  } else {
    input = document.createElement('input');
    input.type = 'text';
  }
  input.name = prop;
  input.dataset.formType = type;
  if (cfg.placeholders[prop]) input.placeholder = cfg.placeholders[prop];
  if (cfg.required.includes(prop)) input.required = true;
  row.appendChild(input);
  return row;
}

async function _collectDbFormFields(form, cfg, propTypes, options = {}) {
  const fields = {};
  for (const prop of cfg.fields) {
    const safeName = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(prop) : String(prop).replace(/(["\\])/g, '\\$1');
    const input = form.querySelector(`[name="${safeName}"]`);
    if (!input) continue;
    const type = propTypes[prop]?.type || 'text';
    if (type === 'checkbox') {
      fields[prop] = input.checked ? 'true' : 'false';
    } else if (type === 'image') {
      if (options.previewOnly) {
        fields[prop] = Array.from(input.files || []).map(file => file.name).join(', ');
        continue;
      }
      const uploaded = [];
      for (const file of Array.from(input.files || [])) {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(API_BASE + '/media/upload', { method: 'POST', body: fd });
        if (!res.ok) throw new Error('画像アップロード失敗: HTTP ' + res.status);
        const meta = await res.json();
        uploaded.push({
          id: (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'img_' + Date.now()),
          content_hash: meta.content_hash || meta.hash,
          filename: meta.filename || file.name,
          src: meta.src,
          thumb: meta.thumb,
          url: meta.url,
          thumb_url: meta.thumb_url,
          width: meta.width || null,
          height: meta.height || null,
          size: meta.size || file.size,
          added_at: new Date().toISOString(),
        });
      }
      fields[prop] = stringifyImagePropertyValue(uploaded);
    } else {
      fields[prop] = input.value || '';
    }
  }
  return fields;
}

function _isBetaFeedbackFormConfig(cfg) {
  return !!(
    cfg?.betaFeedbackRelay
    || String(cfg?.id || '') === 'meldex-beta-feedback-form'
    || String(cfg?.headerTitle || '').includes('フィードバック')
  );
}

function _showBetaFeedbackThanksDialog(cfg) {
  if (!_isBetaFeedbackFormConfig(cfg)) return;
  const message = cfg.thanksDialogMessage || '送信ありがとうございました。改善に役立てます。';
  if (typeof cfAlert === 'function') {
    const result = cfAlert(message, { okLabel: 'OK' });
    if (result?.catch) result.catch(() => {});
  } else if (typeof alert === 'function') {
    alert(message);
  }
}

function _customInstructionRelayErrorMessage(result) {
  if (result?.error === 'source-folder-required') return 'ソースフォルダを選択してから反映してください';
  return 'カスタムインストラクションに反映できませんでした';
}

async function submitDbFormResponse(form, dbPath, cfg, propTypes, options = {}) {
  const msg = form.querySelector('.gb-form-submit-message');
  try {
    const fields = await _collectDbFormFields(form, cfg, propTypes, { previewOnly: !!options.previewOnly });
    if (cfg.betaFeedbackRelay && !fields['送信日']) {
      fields['送信日'] = new Date().toISOString().slice(0, 10);
    }
    for (const prop of cfg.required || []) {
      const type = propTypes[prop]?.type || 'text';
      if (type === 'checkbox') {
        if (fields[prop] !== 'true') throw new Error(prop + ' は必須です');
      } else if (!String(fields[prop] || '').trim()) {
        throw new Error(prop + ' は必須です');
      }
    }
    const nameProp = cfg.entityNameProp || '';
    const name = (nameProp && fields[nameProp]) ? fields[nameProp] : 'フォーム送信 ' + new Date().toLocaleString('ja-JP');
    if (options.previewOnly) {
      if (msg) msg.textContent = '回答プレビューです。実データは作成されません。';
      const previewResult = { previewOnly: true };
      return { ...previewResult, fields, name };
    }
    if (cfg.customInstructionsRelay && typeof applyChatCustomInstructionsFromForm === 'function') {
      const validation = await applyChatCustomInstructionsFromForm(fields, cfg, { validateOnly: true, silent: true });
      if (validation?.ok === false) throw new Error(_customInstructionRelayErrorMessage(validation));
    }
    await apiPost('/entity/create', { parent_path: dbPath, name, properties: fields, source: 'form', reviewed: false });
    if (cfg.customInstructionsRelay && typeof applyChatCustomInstructionsFromForm === 'function') {
      const relay = await applyChatCustomInstructionsFromForm(fields, cfg);
      if (relay?.ok === false) throw new Error(_customInstructionRelayErrorMessage(relay));
    }
    if (window.MeldexBetaFeedback?.maybeSendFeedbackForm) {
      window.MeldexBetaFeedback.maybeSendFeedbackForm({ dbPath, formConfig: cfg, fields, name, source: 'local-form' }).catch(() => {});
    }
    if (msg) msg.textContent = cfg.successMessage || '送信しました';
    _showBetaFeedbackThanksDialog(cfg);
    form.reset();
    if (typeof selectDatabase === 'function') selectDatabase(dbPath, undefined, { silent: true });
  } catch (err) {
    if (msg) msg.textContent = err?.message || '送信に失敗しました';
    showStatus(err?.message || 'フォーム送信に失敗しました', true);
  }
}
