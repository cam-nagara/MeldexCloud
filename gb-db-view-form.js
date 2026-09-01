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

function _dbFormControlSlug(value, fallback = 'control') {
  const raw = String(value || fallback).trim() || fallback;
  return raw
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

function _dbFormSetControlIdentity(el, cfg, prop, role, label) {
  if (!el) return '';
  const id = _dbFormControlIdentity(cfg, prop, role);
  el.id = id;
  el.dataset.e2eId = id;
  if (label && !el.getAttribute('aria-label')) el.setAttribute('aria-label', label);
  return id;
}

function _dbFormEditorLabel(text, controlId) {
  const label = document.createElement('label');
  label.className = 'gb-form-editor-label';
  if (controlId) label.setAttribute('for', controlId);
  label.textContent = text;
  return label;
}

function _dbFormDispatchSaveInput(el, handler) {
  if (!el || typeof handler !== 'function') return;
  ['change'].forEach(type => el.addEventListener(type, handler));
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
  const mkBtn = (label, active, fn, e2eId) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gb-btn gb-btn-sm' + (active ? ' active' : '');
    b.textContent = label;
    b.dataset.e2eId = e2eId;
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
    b.addEventListener('click', fn);
    return b;
  };
  toolbar.appendChild(mkBtn('編集', cfg.mode !== 'answer', () => {
    cfg.mode = 'edit'; saveActiveFormConfig(dbPath, cfg, ctx); renderDbFormView(ctx);
  }, 'db-form-view-edit'));
  toolbar.appendChild(mkBtn('回答プレビュー', cfg.mode === 'answer', () => {
    cfg.mode = 'answer'; saveActiveFormConfig(dbPath, cfg, ctx); renderDbFormView(ctx);
  }, 'db-form-view-answer'));
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
  const titleId = _dbFormSetControlIdentity(titleInput, cfg, 'header-title', 'input', 'フォームタイトル');
  side.appendChild(_dbFormEditorLabel('フォームタイトル', titleId));
  _dbFormDispatchSaveInput(titleInput, () => { cfg.headerTitle = titleInput.value; saveActiveFormConfig(dbPath, cfg, ctx); renderDbFormView(ctx); });
  side.appendChild(titleInput);
  const desc = document.createElement('textarea');
  desc.className = 'gb-input gb-textarea';
  desc.rows = 3;
  desc.placeholder = '説明';
  desc.value = cfg.headerDescription || '';
  const descId = _dbFormSetControlIdentity(desc, cfg, 'header-description', 'textarea', '説明');
  side.appendChild(_dbFormEditorLabel('説明', descId));
  _dbFormDispatchSaveInput(desc, () => { cfg.headerDescription = desc.value; saveActiveFormConfig(dbPath, cfg, ctx); });
  side.appendChild(desc);

  formProps.forEach(prop => {
    const type = propTypes[prop]?.type || 'text';
    if (DB_FORM_UNSUPPORTED_TYPES.has(type)) return;
    const row = document.createElement('div');
    row.className = 'gb-form-prop-row';
    const checked = cfg.fields.includes(prop);
    const label = document.createElement('label');
    label.className = 'gb-check gb-form-prop-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    _dbFormSetControlIdentity(cb, cfg, prop, 'field-enabled', 'フォーム項目に含める: ' + prop);
    const name = document.createElement('span');
    name.className = 'gb-form-prop-name';
    name.textContent = prop;
    const typeLabel = document.createElement('span');
    typeLabel.className = 'gb-form-type';
    typeLabel.textContent = type;
    label.appendChild(cb);
    label.appendChild(name);
    label.appendChild(typeLabel);
    row.appendChild(label);
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
  const entityNameLabel = _dbFormEditorLabel('トピック名にするフィールド', 'gb-form-entity-name-prop');
  const entityNameSelect = document.createElement('select');
  entityNameSelect.id = 'gb-form-entity-name-prop';
  entityNameSelect.className = 'gb-select gb-form-select';
  entityNameSelect.dataset.e2eId = _dbFormControlIdentity(cfg, 'entity-name', 'select');
  [''].concat(cfg.fields || []).forEach(prop => {
    const option = document.createElement('option');
    option.value = prop;
    option.textContent = prop || '(自動生成)';
    option.selected = (cfg.entityNameProp || '') === prop;
    entityNameSelect.appendChild(option);
  });
  entityNameSelect.addEventListener('change', e => {
    cfg.entityNameProp = e.target.value || '';
    saveActiveFormConfig(dbPath, cfg, ctx);
  });
  settings.appendChild(entityNameLabel);
  settings.appendChild(entityNameSelect);
  wrap.appendChild(settings);
  cfg.fields.forEach((prop, idx) => {
    const type = propTypes[prop]?.type || 'text';
    const row = document.createElement('div');
    row.className = 'gb-form-field-editor-row';
    row.dataset.formEditorProp = prop;
    row.dataset.e2eId = _dbFormControlIdentity(cfg, prop, 'editor-row');
    const head = document.createElement('div');
    head.className = 'gb-form-field-head';
    const headTitle = document.createElement('span');
    headTitle.className = 'gb-form-field-title';
    headTitle.textContent = cfg.labels[prop] || prop;
    head.appendChild(headTitle);
    const actions = document.createElement('div');
    actions.className = 'gb-form-field-actions';
    const btn = (icon, title, fn, role, disabled = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'gb-icon-btn';
      b.title = title;
      b.setAttribute('aria-label', title + ': ' + prop);
      b.dataset.e2eId = _dbFormControlIdentity(cfg, prop, role);
      b.disabled = !!disabled;
      b.innerHTML = typeof lucide === 'function' ? lucide(icon, 13) : title;
      b.addEventListener('click', fn);
      return b;
    };
    actions.appendChild(btn('arrowUp', '上へ', () => { if (idx > 0) { [cfg.fields[idx - 1], cfg.fields[idx]] = [cfg.fields[idx], cfg.fields[idx - 1]]; refresh(); } }, 'move-up', idx <= 0));
    actions.appendChild(btn('arrowDown', '下へ', () => { if (idx < cfg.fields.length - 1) { [cfg.fields[idx + 1], cfg.fields[idx]] = [cfg.fields[idx], cfg.fields[idx + 1]]; refresh(); } }, 'move-down', idx >= cfg.fields.length - 1));
    actions.appendChild(btn('x', '除外', () => { cfg.fields = cfg.fields.filter(p => p !== prop); refresh(); }, 'remove'));
    head.appendChild(actions);
    row.appendChild(head);

    const label = document.createElement('input');
    label.className = 'gb-input';
    label.value = cfg.labels[prop] || prop;
    const labelId = _dbFormSetControlIdentity(label, cfg, prop, 'label-input', '表示名: ' + prop);
    row.appendChild(_dbFormEditorLabel('表示名', labelId));
    _dbFormDispatchSaveInput(label, () => { cfg.labels[prop] = label.value.trim() || prop; saveActiveFormConfig(dbPath, cfg, ctx); });
    row.appendChild(label);
    const desc = document.createElement('input');
    desc.className = 'gb-input';
    desc.placeholder = '説明';
    desc.value = cfg.descriptions[prop] || '';
    const descId = _dbFormSetControlIdentity(desc, cfg, prop, 'description-input', '説明: ' + prop);
    row.appendChild(_dbFormEditorLabel('説明', descId));
    _dbFormDispatchSaveInput(desc, () => { cfg.descriptions[prop] = desc.value; saveActiveFormConfig(dbPath, cfg, ctx); });
    row.appendChild(desc);
    const placeholder = document.createElement('input');
    placeholder.className = 'gb-input';
    placeholder.placeholder = 'プレースホルダー';
    placeholder.value = cfg.placeholders[prop] || '';
    const placeholderId = _dbFormSetControlIdentity(placeholder, cfg, prop, 'placeholder-input', 'プレースホルダー: ' + prop);
    row.appendChild(_dbFormEditorLabel('プレースホルダー', placeholderId));
    _dbFormDispatchSaveInput(placeholder, () => { cfg.placeholders[prop] = placeholder.value; saveActiveFormConfig(dbPath, cfg, ctx); });
    row.appendChild(placeholder);
    const foot = document.createElement('label');
    foot.className = 'gb-check';
    const required = document.createElement('input');
    required.type = 'checkbox';
    required.checked = cfg.required.includes(prop);
    _dbFormSetControlIdentity(required, cfg, prop, 'required-checkbox', '必須: ' + prop);
    const requiredText = document.createElement('span');
    requiredText.textContent = '必須';
    const requiredType = document.createElement('span');
    requiredType.className = 'gb-form-type';
    requiredType.textContent = type;
    foot.appendChild(required);
    foot.appendChild(requiredText);
    foot.appendChild(requiredType);
    required.addEventListener('change', (e) => {
      if (e.target.checked && !cfg.required.includes(prop)) cfg.required.push(prop);
      if (!e.target.checked) cfg.required = cfg.required.filter(p => p !== prop);
      saveActiveFormConfig(dbPath, cfg, ctx);
    });
    row.appendChild(foot);
    wrap.appendChild(row);
  });
  const submitRow = document.createElement('div');
  submitRow.className = 'gb-form-submit-editor';
  const submitLabelField = document.createElement('label');
  submitLabelField.className = 'gb-form-submit-field';
  const submitLabelText = document.createElement('span');
  submitLabelText.textContent = '送信ボタン名';
  const submitLabel = document.createElement('input');
  submitLabel.className = 'gb-input';
  submitLabel.id = 'gb-form-submit-label';
  submitLabel.dataset.e2eId = _dbFormControlIdentity(cfg, 'submit-label', 'input');
  submitLabel.value = cfg.submitLabel || '送信';
  submitLabelField.appendChild(submitLabelText);
  submitLabelField.appendChild(submitLabel);
  const successField = document.createElement('label');
  successField.className = 'gb-form-submit-field';
  const successText = document.createElement('span');
  successText.textContent = '送信後メッセージ';
  const successMessage = document.createElement('input');
  successMessage.className = 'gb-input';
  successMessage.id = 'gb-form-success-message';
  successMessage.dataset.e2eId = _dbFormControlIdentity(cfg, 'success-message', 'input');
  successMessage.value = cfg.successMessage || '送信しました';
  successField.appendChild(successText);
  successField.appendChild(successMessage);
  submitRow.appendChild(submitLabelField);
  submitRow.appendChild(successField);
  submitLabel.addEventListener('change', e => { cfg.submitLabel = e.target.value || '送信'; saveActiveFormConfig(dbPath, cfg, ctx); });
  successMessage.addEventListener('change', e => { cfg.successMessage = e.target.value || '送信しました'; saveActiveFormConfig(dbPath, cfg, ctx); });
  wrap.appendChild(submitRow);
  return wrap;
}

function _dbFormControlIdentity(cfg, prop, role) {
  const base = String(cfg?.id || 'db-form')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'db-form';
  const propId = _dbFormControlSlug(prop || role || 'control', 'control');
  return `${base}-${propId}-${role || 'control'}`;
}

function _buildFormAnswerPanel(dbPath, cfg, propTypes, publicMode, options = {}) {
  const form = document.createElement('form');
  form.className = 'gb-form-answer';
  form.dataset.e2eId = _dbFormControlIdentity(cfg, 'answer', 'form');
  form.setAttribute('aria-label', cfg.headerTitle || 'フォーム回答');
  if (options.previewOnly) form.dataset.previewOnly = '1';
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitDbFormResponse(form, dbPath, cfg, propTypes, { previewOnly: !!options.previewOnly });
  });
  if (cfg.headerTitle) {
    const h = document.createElement('h2');
    h.id = _dbFormControlIdentity(cfg, 'answer-title', 'heading');
    h.textContent = cfg.headerTitle;
    form.setAttribute('aria-labelledby', h.id);
    form.appendChild(h);
  }
  if (cfg.headerDescription) {
    const p = document.createElement('p');
    p.className = 'gb-form-description';
    p.id = _dbFormControlIdentity(cfg, 'answer-description', 'description');
    p.textContent = cfg.headerDescription;
    form.setAttribute('aria-describedby', p.id);
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
  submit.dataset.e2eId = _dbFormControlIdentity(cfg, 'submit', 'button');
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
  row.dataset.e2eId = _dbFormControlIdentity(cfg, prop, 'row');
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
  } else if (type === 'link' || type === 'multi-link' || type === 'url') {
    input = document.createElement('input');
    input.type = 'text';
    input.placeholder = type === 'multi-link'
      ? '複数リンクはシート表示で1件ずつ追加できます'
      : 'Web URL、Meldex項目、ファイル、フォルダ';
    if (type === 'multi-link') input.readOnly = true;
  } else if (type === 'long-text') {
    input = document.createElement('textarea');
    input.rows = 4;
  } else if (type === 'select') {
    input = document.createElement('select');
    const empty = document.createElement('option');
    empty.value = '';
    input.appendChild(empty);
    (ptc.options || []).forEach(o => {
      const option = document.createElement('option');
      option.value = o;
      option.textContent = o;
      input.appendChild(option);
    });
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
  input.className = type === 'select' ? 'gb-select gb-form-select' : (type === 'long-text' ? 'gb-input gb-textarea' : 'gb-input');
  input.dataset.formType = type;
  input.dataset.e2eId = _dbFormControlIdentity(cfg, prop, type === 'long-text' ? 'textarea' : type);
  if (cfg.placeholders[prop]) input.placeholder = cfg.placeholders[prop];
  if (cfg.required.includes(prop)) input.required = true;
  row.appendChild(input);
  return row;
}

async function _collectDbFormFields(form, cfg, propTypes, options = {}) {
  const fields = {};
  for (const prop of cfg.fields) {
    const safeName = MeldexEscape.cssIdent(prop);
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
        // 添付先シートを渡すと、シートフォルダ内の添付フォルダへ元の名前で保存される。
        // 開いているシート自身の編集ロックに当たるため、自分のロックの識別子も添える。
        if (options.dbPath) fd.append('sheet_path', options.dbPath);
        const res = await fetch(API_BASE + '/media/upload', {
          method: 'POST',
          body: fd,
          headers: (typeof _attachmentUploadHeaders === 'function' ? _attachmentUploadHeaders() : undefined),
        });
        if (!res.ok) throw new Error('画像アップロード失敗: HTTP ' + res.status);
        const meta = await res.json();
        uploaded.push({
          id: (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'img_' + Date.now()),
          content_hash: meta.content_hash || meta.hash,
          filename: meta.filename || file.name,
          path: meta.path || '',
          kind: meta.kind || '',
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

function _showBetaFeedbackThanksDialog(cfg, deliveryMessage) {
  if (!_isBetaFeedbackFormConfig(cfg)) return;
  const message = deliveryMessage || cfg.thanksDialogMessage || '送信ありがとうございました。改善に役立てます。';
  if (typeof cfAlert === 'function') {
    const result = cfAlert(message, { okLabel: 'OK' });
    if (result?.catch) result.catch(() => {});
  } else if (typeof alert === 'function') {
    alert(message);
  }
}

function _betaFeedbackDeliveryMessage(result, isCloud) {
  const delivery = result?.delivery || {};
  if (delivery.status === 'sent') {
    const receipt = delivery.issueId ? `（受付番号: ${delivery.issueId}）` : '';
    return `開発者へ送信しました${receipt}`;
  }
  if (delivery.status === 'pending' || result?.queued) {
    return '端末内に保存しました。開発者への送信待ちです。オンライン復帰後に自動で再送します。';
  }
  if (delivery.status === 'failed') {
    return `端末内に保存しましたが、開発者への送信に失敗しました。${delivery.lastError || ''}`.trim();
  }
  if (result?.reason === 'debugger-not-configured') {
    return '端末内に保存しました。開発者への送信先が設定されていません。';
  }
  if (isCloud) return '端末内に保存しました。開発者への送信結果を確認できませんでした。送信履歴から再送できます。';
  return '端末内に保存しました。開発者への送信結果を確認できませんでした。';
}

function _customInstructionRelayErrorMessage(result) {
  if (result?.error === 'source-folder-required') return 'ソースフォルダを選択してから反映してください';
  return 'カスタムインストラクションに反映できませんでした';
}

async function submitDbFormResponse(form, dbPath, cfg, propTypes, options = {}) {
  const msg = form.querySelector('.gb-form-submit-message');
  try {
    const fields = await _collectDbFormFields(form, cfg, propTypes, { previewOnly: !!options.previewOnly, dbPath });
    if (cfg.betaFeedbackRelay && !fields['送信日']) {
      fields['送信日'] = new Date().toISOString().slice(0, 10);
    }
    const isBetaFeedback = _isBetaFeedbackFormConfig(cfg);
    const isCloudFeedback = isBetaFeedback && !!window.MeldexRuntimeAdapter?.isBrowserDataMode?.();
    if (isBetaFeedback) {
      const acceptedAt = new Date().toISOString();
      fields['送信元'] = isCloudFeedback ? 'Meldex Cloudフィードバックフォーム' : 'Meldexフィードバックフォーム';
      fields['送信状態'] = '送信待ち';
      fields['送信受付日時'] = acceptedAt;
      fields['対象バージョン'] = String(window.__meldexVersionCache?.version || '');
      fields['送信結果・失敗理由'] = '開発者への送信結果を確認しています。';
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
    const createResult = await apiPost('/entity/create', { parent_path: dbPath, name, properties: fields, source: 'form', reviewed: false });
    if (cfg.customInstructionsRelay && typeof applyChatCustomInstructionsFromForm === 'function') {
      const relay = await applyChatCustomInstructionsFromForm(fields, cfg);
      if (relay?.ok === false) throw new Error(_customInstructionRelayErrorMessage(relay));
    }
    let feedbackDelivery = null;
    if (isBetaFeedback && window.MeldexBetaFeedback?.maybeSendFeedbackForm) {
      feedbackDelivery = await window.MeldexBetaFeedback.maybeSendFeedbackForm({
        dbPath,
        entryPath: createResult?.path || '',
        entryId: createResult?.entry_id || '',
        formConfig: cfg,
        fields,
        name,
        source: 'local-form',
      });
    }
    const completionMessage = isBetaFeedback
      ? _betaFeedbackDeliveryMessage(feedbackDelivery, isCloudFeedback)
      : (cfg.successMessage || '送信しました');
    if (msg) msg.textContent = completionMessage;
    _showBetaFeedbackThanksDialog(cfg, completionMessage);
    form.reset();
    if (typeof selectDatabase === 'function') selectDatabase(dbPath, undefined, { silent: true });
  } catch (err) {
    if (msg) msg.textContent = err?.message || '送信に失敗しました';
    showStatus(err?.message || 'フォーム送信に失敗しました', true);
  }
}
