/* gb-scheduler-settings-ui.js: no-code scheduler template and classification editor. */
(function () {
  'use strict';

  const EFFECT_ROLES = Object.freeze([
    ['display', '表示のみ'], ['duration_add', '工数を加算'], ['duration_multiply', '工数を倍率調整'],
    ['assignee_candidates', '担当候補'], ['required_skills', '必要スキル'], ['required_equipment', '必要設備'],
    ['priority_adjust', '優先度を調整'], ['work_order', '作業順'], ['dependencies', '依存関係'],
    ['parallel_allowed', '並行可否'], ['minimum_slot', '最小作業枠'], ['split_allowed', '分割可否'],
  ]);

  const Api = () => window.MeldexSchedulerProposals;
  const clone = value => structuredClone(value == null ? {} : value);
  const id = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  function status(message, error = false) {
    if (typeof showStatus === 'function') showStatus(message, error);
    else console[error ? 'error' : 'log'](message);
  }

  function icon(name) {
    const element = document.createElement('span');
    element.className = 'gb-scheduler-icon';
    if (typeof lucide === 'function') element.innerHTML = lucide(name, 14);
    return element;
  }

  function button(label, iconName, handler, options = {}) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `gb-btn gb-btn-sm gb-scheduler-button${options.primary ? ' gb-btn-primary' : ''}`;
    element.append(icon(iconName), document.createTextNode(label));
    element.disabled = !!options.disabled;
    if (options.e2eId) element.dataset.e2eId = options.e2eId;
    element.addEventListener('click', handler);
    return element;
  }

  function field(labelText, control, help) {
    const label = document.createElement('label');
    label.className = 'gb-scheduler-field';
    const caption = document.createElement('span');
    caption.className = 'gb-scheduler-field-label';
    caption.textContent = labelText;
    if (help && typeof fieldHelp === 'function') {
      caption.insertAdjacentHTML('beforeend', ` ${fieldHelp(help)}`);
      const helpControl = caption.querySelector('.gb-field-help:last-child');
      if (helpControl && control.dataset.e2eId) helpControl.dataset.e2eId = `${control.dataset.e2eId}-help`;
    }
    label.append(caption, control);
    return label;
  }

  function input(value, e2eId) {
    const element = document.createElement('input');
    element.type = 'text'; element.value = String(value || ''); element.className = 'gb-input gb-input-sm';
    if (e2eId) element.dataset.e2eId = e2eId;
    return element;
  }

  function select(options, value, e2eId) {
    const element = document.createElement('select');
    element.className = 'gb-select gb-select-sm';
    options.forEach(([key, label]) => {
      const option = document.createElement('option'); option.value = key; option.textContent = label; element.appendChild(option);
    });
    element.value = value == null ? '' : String(value);
    if (e2eId) element.dataset.e2eId = e2eId;
    return element;
  }

  function normalizeTemplate(raw) {
    const template = clone(raw);
    template.classifications = Array.isArray(template.classifications) ? template.classifications : [];
    template.generationRules = Array.isArray(template.generationRules) ? template.generationRules : [];
    template.classifications.forEach((item, index) => {
      item.order = Number.isInteger(item.order) ? item.order : index;
      item.status = item.status === 'archived' ? 'archived' : 'active';
      item.options = Array.isArray(item.options) ? item.options : [];
      item.options.forEach((option, optionIndex) => {
        option.order = Number.isInteger(option.order) ? option.order : optionIndex;
        option.status = option.status === 'archived' ? 'archived' : 'active';
        option.parentOptionIds = Array.isArray(option.parentOptionIds) ? option.parentOptionIds : [];
      });
    });
    return template;
  }

  function move(items, index, delta) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return false;
    [items[index], items[target]] = [items[target], items[index]];
    items.forEach((item, order) => { item.order = order; });
    return true;
  }

  function renderOptionRows(host, state, classification, renderEditor) {
    const heading = document.createElement('div'); heading.className = 'gb-scheduler-editor-heading';
    const title = document.createElement('strong'); title.textContent = '選択肢';
    const add = button('選択肢を追加', 'plus', () => {
      classification.options.push({ id: id('option'), name: '新しい選択肢', status: 'active', order: classification.options.length, parentOptionIds: [] });
      state.dirty = true; renderEditor();
    }, { disabled: state.readOnly, e2eId: `scheduler-option-add-${classification.id}` });
    heading.append(title, add); host.appendChild(heading);
    if (!classification.options.length) {
      const empty = document.createElement('p'); empty.className = 'gb-scheduler-panel-status'; empty.textContent = '選択肢はありません'; host.appendChild(empty);
      return;
    }
    const parent = state.draft.classifications.find(item => item.id === classification.parentClassificationId);
    classification.options.forEach((option, index) => {
      const row = document.createElement('div'); row.className = `gb-scheduler-option-row${option.status === 'archived' ? ' is-archived' : ''}`;
      const optionKey = `${classification.id}-${option.id}`;
      const name = input(option.name, `scheduler-option-name-${optionKey}`); name.disabled = state.readOnly;
      name.addEventListener('input', () => { option.name = name.value; state.dirty = true; });
      row.appendChild(field('名前', name));
      const numericRoles = new Set(['duration_add', 'duration_multiply', 'priority_adjust', 'work_order', 'minimum_slot']);
      const booleanRoles = new Set(['parallel_allowed', 'split_allowed']);
      const listRoles = new Set(['assignee_candidates', 'required_skills', 'required_equipment', 'dependencies']);
      let effectValue;
      if (booleanRoles.has(classification.effectRole)) {
        effectValue = select([['', '未設定'], ['true', '許可する'], ['false', '許可しない']], option.effectValue === true ? 'true' : option.effectValue === false ? 'false' : '', `scheduler-option-effect-${optionKey}`);
        effectValue.addEventListener('change', () => { option.effectValue = effectValue.value === '' ? null : effectValue.value === 'true'; state.dirty = true; });
      } else {
        const displayValue = Array.isArray(option.effectValue) ? option.effectValue.join('、') : (option.effectValue ?? '');
        effectValue = input(displayValue, `scheduler-option-effect-${optionKey}`);
        if (numericRoles.has(classification.effectRole)) { effectValue.type = 'number'; effectValue.step = '0.1'; }
        else if (listRoles.has(classification.effectRole)) effectValue.placeholder = '候補を「、」で区切る';
        effectValue.addEventListener('input', () => {
          option.effectValue = numericRoles.has(classification.effectRole)
            ? (effectValue.value === '' ? null : Number(effectValue.value))
            : listRoles.has(classification.effectRole)
              ? effectValue.value.split(/[、,\n]/).map(value => value.trim()).filter(Boolean)
              : effectValue.value;
          state.dirty = true;
        });
      }
      effectValue.disabled = state.readOnly || classification.effectRole === 'display';
      row.appendChild(field('割り当てへの値', effectValue, 'この選択肢を選んだとき、割り当て計算へ渡す値です'));
      if (parent) {
        const parentValues = select([['', 'すべての親選択肢'], ...parent.options.filter(item => item.status !== 'archived').map(item => [item.id, item.name])], option.parentOptionIds[0] || '', `scheduler-option-parent-${optionKey}`);
        parentValues.disabled = state.readOnly;
        parentValues.addEventListener('change', () => { option.parentOptionIds = parentValues.value ? [parentValues.value] : []; state.dirty = true; });
        row.appendChild(field('親の選択肢', parentValues, '親分類の値に応じて、この選択肢を表示します'));
      }
      const actions = document.createElement('div'); actions.className = 'gb-scheduler-inline-actions';
      actions.append(
        button('上へ', 'arrowUp', () => { if (move(classification.options, index, -1)) { state.dirty = true; renderEditor(); } }, { disabled: state.readOnly || index === 0, e2eId: `scheduler-option-up-${optionKey}` }),
        button('下へ', 'arrowDown', () => { if (move(classification.options, index, 1)) { state.dirty = true; renderEditor(); } }, { disabled: state.readOnly || index === classification.options.length - 1, e2eId: `scheduler-option-down-${optionKey}` }),
        button(option.status === 'archived' ? '再有効化' : 'アーカイブ', option.status === 'archived' ? 'archiveRestore' : 'archive', () => {
          option.status = option.status === 'archived' ? 'active' : 'archived'; state.dirty = true; renderEditor();
        }, { disabled: state.readOnly, e2eId: `scheduler-option-archive-${optionKey}` }),
      );
      row.appendChild(actions); host.appendChild(row);
    });
  }

  function renderClassifications(host, state, renderEditor) {
    const heading = document.createElement('div'); heading.className = 'gb-scheduler-editor-heading';
    const title = document.createElement('strong'); title.textContent = '分類';
    const add = button('分類を追加', 'plus', () => {
      state.draft.classifications.push({ id: id('classification'), name: '新しい分類', status: 'active', order: state.draft.classifications.length, effectRole: 'display', parentClassificationId: null, options: [] });
      state.dirty = true; renderEditor();
    }, { disabled: state.readOnly, e2eId: 'scheduler-classification-add' });
    heading.append(title, add); host.appendChild(heading);
    state.draft.classifications.forEach((classification, index) => {
      const card = document.createElement('section'); card.className = `gb-scheduler-classification-card${classification.status === 'archived' ? ' is-archived' : ''}`;
      card.dataset.e2eId = `scheduler-classification-${index}`;
      const name = input(classification.name, `scheduler-classification-name-${index}`); name.disabled = state.readOnly;
      name.addEventListener('input', () => { classification.name = name.value; state.dirty = true; });
      const role = select(EFFECT_ROLES, classification.effectRole || 'display', `scheduler-effect-role-${index}`); role.disabled = state.readOnly;
      role.addEventListener('change', () => { classification.effectRole = role.value; state.dirty = true; });
      const parent = select([['', '親分類なし'], ...state.draft.classifications.filter(item => item.id !== classification.id && item.status !== 'archived').map(item => [item.id, item.name])], classification.parentClassificationId || '', `scheduler-classification-parent-${index}`);
      parent.disabled = state.readOnly;
      parent.addEventListener('change', () => { classification.parentClassificationId = parent.value || null; state.dirty = true; renderEditor(); });
      card.append(field('分類名', name), field('割り当てへの効果', role), field('親分類', parent, '親分類の選択に応じて選択肢を絞り込みます'));
      const actions = document.createElement('div'); actions.className = 'gb-scheduler-inline-actions';
      actions.append(
        button('上へ', 'arrowUp', () => { if (move(state.draft.classifications, index, -1)) { state.dirty = true; renderEditor(); } }, { disabled: state.readOnly || index === 0, e2eId: `scheduler-classification-up-${classification.id}` }),
        button('下へ', 'arrowDown', () => { if (move(state.draft.classifications, index, 1)) { state.dirty = true; renderEditor(); } }, { disabled: state.readOnly || index === state.draft.classifications.length - 1, e2eId: `scheduler-classification-down-${classification.id}` }),
        button(classification.status === 'archived' ? '再有効化' : 'アーカイブ', classification.status === 'archived' ? 'archiveRestore' : 'archive', () => {
          classification.status = classification.status === 'archived' ? 'active' : 'archived'; state.dirty = true; renderEditor();
        }, { disabled: state.readOnly, e2eId: `scheduler-classification-archive-${classification.id}` }),
      );
      card.appendChild(actions);
      const optionsHost = document.createElement('div'); optionsHost.className = 'gb-scheduler-options';
      renderOptionRows(optionsHost, state, classification, renderEditor); card.appendChild(optionsHost); host.appendChild(card);
    });
  }

  function renderGenerationRules(host, state, renderEditor) {
    const heading = document.createElement('div'); heading.className = 'gb-scheduler-editor-heading';
    const title = document.createElement('strong'); title.textContent = '生成規則';
    const add = button('生成規則を追加', 'plus', () => {
      state.draft.generationRules.push({ id: id('generation-rule'), name: '新しい生成規則', status: 'active', classificationId: '', optionId: '', taskName: '' });
      state.dirty = true; renderEditor();
    }, { disabled: state.readOnly, e2eId: 'scheduler-generation-rule-add' });
    heading.append(title, add); host.appendChild(heading);
    if (!state.draft.generationRules.length) {
      const empty = document.createElement('p'); empty.className = 'gb-scheduler-panel-status'; empty.textContent = '生成規則はありません'; host.appendChild(empty); return;
    }
    state.draft.generationRules.forEach((rule, index) => {
      const row = document.createElement('section'); row.className = `gb-scheduler-generation-rule${rule.status === 'archived' ? ' is-archived' : ''}`;
      const name = input(rule.name, `scheduler-generation-name-${index}`);
      const classification = select([['', '分類を選択'], ...state.draft.classifications.filter(item => item.status !== 'archived').map(item => [item.id, item.name])], rule.classificationId || '', `scheduler-generation-classification-${rule.id}`);
      const selectedClassification = state.draft.classifications.find(item => item.id === classification.value);
      const option = select([['', '選択肢を選択'], ...(selectedClassification?.options || []).filter(item => item.status !== 'archived').map(item => [item.id, item.name])], rule.optionId || '', `scheduler-generation-option-${rule.id}`);
      const taskName = input(rule.taskName, `scheduler-generation-task-name-${index}`); taskName.placeholder = '作成するタスク名';
      [name, classification, option, taskName].forEach(control => { control.disabled = state.readOnly; });
      name.addEventListener('input', () => { rule.name = name.value; state.dirty = true; });
      classification.addEventListener('change', () => { rule.classificationId = classification.value; rule.optionId = ''; state.dirty = true; renderEditor(); });
      option.addEventListener('change', () => { rule.optionId = option.value; state.dirty = true; });
      taskName.addEventListener('input', () => { rule.taskName = taskName.value; state.dirty = true; });
      row.append(field('規則名', name), field('分類', classification), field('選択肢', option), field('作成するタスク名', taskName));
      row.appendChild(button(rule.status === 'archived' ? '再有効化' : 'アーカイブ', rule.status === 'archived' ? 'archiveRestore' : 'archive', () => {
        rule.status = rule.status === 'archived' ? 'active' : 'archived'; state.dirty = true; renderEditor();
      }, { disabled: state.readOnly, e2eId: `scheduler-generation-archive-${rule.id}` }));
      host.appendChild(row);
    });
  }

  async function render(host, component) {
    host.replaceChildren();
    const loading = document.createElement('p'); loading.className = 'gb-scheduler-panel-status'; loading.textContent = 'テンプレートを読み込み中…'; host.appendChild(loading);
    try {
      const [result, caps] = await Promise.all([Api().listTemplates(true), Api().loadCapabilities()]);
      let templates = result.templates || [];
      const writable = caps.allowed?.['scheduler.settings.manage'] !== false && caps.policy?.writable !== false;
      const selector = select([], '', 'scheduler-template-selector');
      const editor = document.createElement('div'); editor.className = 'gb-scheduler-template-editor';
      const toolbar = document.createElement('div'); toolbar.className = 'gb-scheduler-proposal-actions';
      let state = null;
      let archiveToggle = null;

      const refill = selectedId => {
        selector.replaceChildren();
        templates.forEach(template => {
          const option = document.createElement('option'); option.value = template.id;
          option.textContent = `${template.name}${template.status === 'archived' ? '（アーカイブ）' : ''}`; selector.appendChild(option);
        });
        selector.value = templates.some(item => item.id === selectedId) ? selectedId : (templates[0]?.id || '');
      };

      const refresh = async selectedId => {
        templates = (await Api().listTemplates(true)).templates || [];
        state = null; refill(selectedId); renderEditor();
      };

      const renderEditor = () => {
        const source = templates.find(item => item.id === selector.value);
        if (!state || state.sourceId !== source?.id) {
          state = { sourceId: source?.id || '', draft: normalizeTemplate(source), readOnly: !writable || !source || source.builtIn === true, dirty: false };
        }
        editor.replaceChildren();
        if (!source) return;
        if (archiveToggle) archiveToggle.disabled = !writable || source.builtIn === true;
        const notice = document.createElement('p'); notice.className = 'gb-scheduler-panel-status';
        notice.textContent = source.builtIn ? '組み込みテンプレートは読み取り専用です。複製すると編集できます。' : '分類・選択肢・生成規則を編集できます。';
        const name = input(state.draft.name, 'scheduler-template-name'); name.disabled = state.readOnly;
        name.addEventListener('input', () => { state.draft.name = name.value; state.dirty = true; });
        const classificationHost = document.createElement('div'); classificationHost.className = 'gb-scheduler-classifications';
        renderClassifications(classificationHost, state, renderEditor);
        const rulesHost = document.createElement('div'); rulesHost.className = 'gb-scheduler-generation-rules';
        renderGenerationRules(rulesHost, state, renderEditor);
        const save = button('テンプレートを保存', 'check', async () => {
          if (!state.draft.name.trim()) return name.focus();
          save.disabled = true;
          try {
            const updated = await Api().patchTemplate({
              id: source.id, storageRevision: source.storageRevision,
              patch: { name: state.draft.name.trim(), classifications: state.draft.classifications, generationRules: state.draft.generationRules },
            });
            status('テンプレートを保存しました'); await refresh(updated.template.id);
          } catch (error) { save.disabled = false; status(Api().errorMessage(error), true); }
        }, { primary: true, disabled: state.readOnly, e2eId: 'scheduler-template-save' });
        editor.append(notice, field('テンプレート名', name), classificationHost, rulesHost, save);
      };

      refill(templates[0]?.id || '');
      selector.addEventListener('change', () => { state = null; renderEditor(); });
      toolbar.append(
        button('追加', 'plus', async () => {
          try { const created = await Api().createTemplate({ name: '新しいテンプレート', classifications: [], generationRules: [], savedViews: [] }); await refresh(created.template.id); }
          catch (error) { status(Api().errorMessage(error), true); }
        }, { disabled: !writable, e2eId: 'scheduler-template-add' }),
        button('複製', 'copy', async () => {
          try { const cloned = await Api().cloneTemplate(selector.value); await refresh(cloned.template.id); }
          catch (error) { status(Api().errorMessage(error), true); }
        }, { disabled: !writable || !templates.length, e2eId: 'scheduler-template-clone' }),
        archiveToggle = button('アーカイブ／再有効化', 'archiveRestore', async () => {
          const current = templates.find(item => item.id === selector.value);
          if (!current || current.builtIn) return;
          try {
            const resultValue = current.status === 'archived'
              ? await Api().patchTemplate({ id: current.id, storageRevision: current.storageRevision, patch: { status: 'active' } })
              : await Api().archiveTemplate(current.id, current.storageRevision);
            await refresh(resultValue.template.id);
          } catch (error) { status(Api().errorMessage(error), true); }
        }, { disabled: !writable, e2eId: 'scheduler-template-archive-toggle' }),
      );
      const open = button('表で詳しく編集', 'tableProperties', () => component?._selectProductionTab?.('targets'), { e2eId: 'scheduler-template-open-table' });
      host.replaceChildren(field('テンプレート', selector), toolbar, editor, open); renderEditor();
    } catch (error) {
      loading.textContent = Api().errorMessage(error); loading.classList.add('is-error');
    }
  }

  window.MeldexSchedulerSettingsUi = Object.freeze({ render, _internal: { normalizeTemplate, move } });
})();
