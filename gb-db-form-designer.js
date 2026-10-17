/* Form-view binding and the shared layout/input designer. */
(function () {
  'use strict';
  const model = () => globalThis.MeldexDbFormModel;
  const clone = value => JSON.parse(JSON.stringify(value));
  const button = (label, run) => {
    const element = document.createElement('button'); element.type = 'button'; element.className = 'gb-btn';
    element.textContent = label; element.addEventListener('click', event => { event.stopPropagation(); run(event); }); return element;
  };
  function appendRules(root, cfg, property, type, save) {
    const group = document.createElement('div'); group.className = 'gb-form-rules';
    if (!Array.isArray(cfg.rules)) cfg.rules = [];
    for (const [key, label] of (type === 'number'
      ? [['min', '最小値'], ['max', '最大値']]
      : ['text', 'long-text'].includes(type) ? [['minLength', '最小文字数'], ['maxLength', '最大文字数']] : [])) {
      const row = document.createElement('label'); row.textContent = label;
      const input = document.createElement('input'); input.type = 'number'; input.className = 'gb-input';
      input.step = 'any';
      input.setAttribute('aria-label', label + ': ' + property);
      if (key.endsWith('Length')) { input.min = '0'; input.step = '1'; }
      input.value = cfg.rules.find(rule => rule.property === property)?.[key] ?? '';
      input.addEventListener('change', () => {
        let rule = cfg.rules.find(rule => rule.property === property);
        if (!rule) { rule = { property }; cfg.rules.push(rule); }
        if (input.value === '') delete rule[key]; else rule[key] = Number(input.value);
        const invalid = rule.min !== undefined && rule.max !== undefined && rule.min > rule.max
          || rule.minLength !== undefined && rule.maxLength !== undefined && rule.minLength > rule.maxLength;
        group.querySelectorAll('input').forEach(control => control.setCustomValidity(invalid ? '最小値は最大値以下にしてください' : ''));
        if (invalid) { input.reportValidity(); return; }
        save();
      });
      row.appendChild(input); group.appendChild(row);
    }
    root.appendChild(group);
  }
  function settings(anchor, ctx) {
    _elCloseEditPopups();
    const popup = document.createElement('div'); popup.className = 'gb-context-menu el-edit-popup gb-form-settings';
    popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', 'フォームの入力設定とTab順');
    const cfg = model().forLayout(ctx.layout);
    const title = document.createElement('p'); title.textContent = '上から順にTab移動します。入力設定はフォームビューと共通です。'; popup.appendChild(title);
    const content = document.createElement('div'); popup.appendChild(content);
    const render = () => {
      content.replaceChildren(_buildFormEditorFields(ctx.dbPath, cfg, ctx.propTypes, render, null, () => {}));
    };
    render();
    const close = _elAttachPopupCommon(popup, anchor);
    popup.appendChild(button('適用', () => {
      if (!popup.querySelectorAll('input:invalid').length && _elCanMutateGrid(ctx.grid, ctx.options)) {
        ctx.persist('フォーム: 入力設定とTab順', '', layout => { layout.formConfig = clone(cfg); });
        close(); ctx.rerender();
      }
    }));
    popup.appendChild(button('キャンセル', close));
    if (typeof positionPopup === 'function') positionPopup(popup, anchor.getBoundingClientRect(), { gap: 4 });
  }
  function arrangeMenu(anchor, ctx, canvas) {
    const actions = [['left','左揃え'],['center','左右中央揃え'],['right','右揃え'],['top','上揃え'],['middle','上下中央揃え'],['bottom','下揃え'],
      ['horizontal','横に等間隔'],['vertical','縦に等間隔'],['width','同じ幅'],['height','同じ高さ'],
      ['group','グループ化'],['ungroup','グループ解除'],['lock','配置をロック'],['unlock','配置ロックを解除']];
    _elCloseEditPopups();
    const popup = document.createElement('div'); popup.className = 'gb-context-menu el-edit-popup'; popup.setAttribute('role', 'menu');
    const selected = [...canvas.querySelectorAll('.el-cell.el-selected')].map(cell => cell.dataset.cellId);
    for (const [action, label] of actions) {
      const item = button(label, () => {
        if (!_elCanMutateGrid(ctx.grid, ctx.options)) return;
        ctx.persist('トピックレイアウト: ' + label, '', layout => {
          layout.cells = model().arrange(layout.cells, selected, action, _elGenId('group'));
        });
        close(); ctx.rerender();
      });
      item.className = 'el-tab-menu-item'; item.setAttribute('role', 'menuitem'); item.disabled = !selected.length;
      popup.appendChild(item);
    }
    const close = _elAttachPopupCommon(popup, anchor);
  }
  function addTools(bar, ctx) {
    const input = button('入力設定・Tab順', () => settings(input, ctx)); bar.appendChild(input);
    const arrange = button('配置を整える', () => arrangeMenu(arrange, ctx, ctx.grid.querySelector('.el-canvas')));
    bar.appendChild(arrange);
    const subform = button('繰り返し項目', () => _elAddCell(ctx, {
      type: 'subform', w: 700, h: 300, subform: { dbPath: '', relationProp: '', fields: [] },
    }, '繰り返し項目'));
    bar.appendChild(subform);
  }
  function buildViewSelector(root, dbPath, cfg, propTypes, ctx) {
    if (ctx?.formApp) return;
    if (cfg.betaFeedbackRelay || cfg.customInstructionsRelay) return;
    if (!MeldexDbFormRuntime.writable(root, dbPath, ctx)) return;
    const row = document.createElement('div'); row.className = 'gb-form-binding';
    const label = document.createElement('label'); label.textContent = '共通レイアウト';
    const select = document.createElement('select'); select.className = 'gb-select'; select.setAttribute('aria-label', '共通レイアウト');
    const layouts = _elGetState(dbPath).layouts;
    for (const item of [{ id: '', name: '従来の自動配置フォーム' }, ...layouts]) {
      const option = document.createElement('option'); option.value = item.id; option.textContent = item.name; option.selected = cfg.layoutId === item.id;
      select.appendChild(option);
    }
    const bind = async (id, confirmed = false) => {
      if (!confirmed && !await MeldexDbFormRuntime.confirmLeave(root)) { select.value = cfg.layoutId || ''; return; }
      const layout = _elGetState(dbPath).layouts.find(item => item.id === id);
      const next = layout ? { ...cfg, ...model().forLayout(layout), layoutId: id } : { ...cfg, layoutId: '' };
      saveActiveFormConfig(dbPath, next, ctx); renderDbFormView(ctx);
    };
    select.addEventListener('change', () => bind(select.value)); label.appendChild(select); row.appendChild(label);
    row.appendChild(button('プリセットから追加', async event => {
      const anchor = event.currentTarget;
      if (!await MeldexDbFormRuntime.confirmLeave(root)) return;
      const known = new Set(layouts.map(layout => layout.id));
      const data = { properties: Object.fromEntries(Object.keys(propTypes).map(name => [name, []])) };
      _elShowAddLayoutMenu(anchor, { grid: root, dbPath, entityPath: '', pivotData: data, options: { ctx }, layoutId: 'columns', rerender() {
        const added = _elGetState(dbPath).layouts.find(layout => !known.has(layout.id));
        if (added) bind(added.id, true);
      } });
    }));
    row.appendChild(button('現在の項目から配置を作成', async () => {
      if (!await MeldexDbFormRuntime.confirmLeave(root)) return;
      let id;
      _elMutateState(dbPath, 'フォーム: 共通レイアウトを作成', '', state => {
        id = _elGenId('form');
        const fields = cfg.fields || [];
        state.layouts.push(_elNormalizeLayout({ id, name: _elMakeDuplicateName('フォーム', state.layouts),
          canvasSize: { w: 1000, h: Math.max(700, fields.length * 140 + 40) }, formConfig: clone(cfg),
          cells: fields.map((prop, index) => ({ id: _elGenId('field'), type: 'field', prop, x: 20, y: 20 + index * 140, w: 940, h: 120 })),
        }));
      }, { ctx });
      bind(id, true);
    }));
    if (cfg.layoutId) row.appendChild(button('配置を編集', async () => {
      if (!await MeldexDbFormRuntime.confirmLeave(root)) return;
      const editor = document.createElement('div'); editor.className = 'gb-form-layout-editor'; root.replaceChildren(row, editor);
      row.querySelectorAll('button').forEach(control => { control.disabled = true; }); select.disabled = true;
      row.appendChild(button('配置編集を終了', () => renderDbFormView(ctx)));
      const session = { editMode: true };
      const render = () => {
        editor.replaceChildren();
        const layout = _elGetState(dbPath).layouts.find(item => item.id === cfg.layoutId);
        if (!layout) { renderDbFormView(ctx); return; }
        const data = { properties: Object.fromEntries(Object.keys(propTypes).map(name => [name, []])) };
        _elRenderLayoutBody(editor, data, '', { propTypes, ctx, layoutDraft: { layout, session, persist(mutator) {
          return _elMutateState(dbPath, 'フォーム: 配置編集', '', state => {
            const target = state.layouts.find(item => item.id === layout.id); return target ? mutator(target) : false;
          }, { ctx, onRestore: () => { if (editor.isConnected) render(); } });
        } } }, dbPath, layout.id, render);
      }; render();
    }));
    root.appendChild(row);
  }
  globalThis.MeldexDbFormDesigner = { appendRules, settings, addTools, buildViewSelector };
})();
