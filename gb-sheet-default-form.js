/* A form-owned sheet opens its topics with the same live form definition. */
(function () {
  'use strict';
  let sequence = 0;
  const normal = path => String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
  async function mount(grid, data, path, metadata, options) {
    if (!metadata?.default_form_path) return null;
    const wrapper = document.createElement('section'); wrapper.className = 'meldex-sheet-topic-form';
    grid.before(wrapper); wrapper.appendChild(grid);
    const tabs = document.createElement('div'); tabs.className = 'el-tabbar'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'トピックの表示');
    wrapper.prepend(tabs);
    const panel = document.createElement('div'); panel.className = 'meldex-sheet-topic-form-panel'; wrapper.appendChild(panel);
    panel.setAttribute('role', 'tabpanel'); grid.setAttribute('role', 'tabpanel');
    const id = 'sheet-topic-form-' + (++sequence); panel.id = id; grid.id ||= id + '-columns';
    const formTab = document.createElement('button'), columnsTab = document.createElement('button');
    for (const [button, label, target] of [[formTab, 'フォーム', panel], [columnsTab, '列一覧', grid]]) {
      button.type = 'button'; button.className = 'el-tab'; button.textContent = label; button.setAttribute('role', 'tab');
      button.id = target.id + '-tab'; button.setAttribute('aria-controls', target.id); target.setAttribute('aria-labelledby', button.id); tabs.appendChild(button);
    }
    const show = form => {
      grid.hidden = form; panel.hidden = !form;
      for (const [button, selected] of [[formTab, form], [columnsTab, !form]]) {
        button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; button.classList.toggle('active', selected);
      }
    };
    columnsTab.addEventListener('click', async () => {
      if (columnsTab.getAttribute('aria-selected') === 'true') return;
      if (!await MeldexDbFormRuntime.confirmLeave(panel)) return;
      renderEntityPropsGridInto(grid, data, path, { ...options, propTypes: metadata.property_types });
      show(false);
    });
    formTab.addEventListener('click', async () => {
      if (formTab.getAttribute('aria-selected') === 'true') return;
      if (options.beforeWrite && !await options.beforeWrite()) return;
      await render(true); show(true);
    });
    tabs.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const target = event.key === 'Home' ? formTab : event.key === 'End' ? columnsTab : event.target === formTab ? columnsTab : formTab;
      target.click(); target.focus();
    });
    show(true);
    let renderGeneration = 0;
    const render = async (refreshRecord = false) => {
      const generation = ++renderGeneration;
      panel.replaceChildren(document.createTextNode('フォームを読み込んでいます…'));
      try {
        const [loaded, record] = await Promise.all([apiFetch('/file?path=' + encodeURIComponent(metadata.default_form_path)),
          refreshRecord ? apiFetch('/entity?path=' + encodeURIComponent(path)) : null]);
        if (!panel.isConnected || generation !== renderGeneration) return;
        if (record) Object.assign(data, record);
        const doc = MeldexFormDocument.parse(loaded.content);
        if (normal(doc.sheet.path) !== normal(options.parentDb)) {
          const ids = await Promise.all([doc.sheet.path, options.parentDb].map(value => apiFetch('/file-id?path=' + encodeURIComponent(value))));
          if (!ids[0]?.file_id || ids[0].file_id !== ids[1]?.file_id) throw new Error('フォームの参照先シートが変更されています');
        }
        if (!panel.isConnected || generation !== renderGeneration) return;
        const types = metadata.property_types || {};
        const config = normalizeDbFormConfig({ ...doc.formConfig, mode: 'entry' }, Object.keys(types), types);
        const layout = doc.layout ? _elNormalizeLayout(doc.layout) : _elNormalizeLayout({ name: doc.title,
          canvasSize: { w: 700, h: Math.max(200, config.fields.length * 160 + 20) },
          cells: config.fields.map((prop, index) => ({ id: 'field-' + index, type: 'field', prop, x: 20, y: index * 160 + 10, w: 640, h: 150 })) });
        layout.formConfig = MeldexDbFormModel.forLayout(layout, doc.formConfig);
        panel.replaceChildren();
        _elRenderLayoutBody(panel, data, path, { ...options, formLayout: layout, propTypes: types }, options.parentDb, layout.id, render);
        if (!doc.layout) {
          // The automatic layout has no authored coordinates to preserve.
          // Keep its inputs and save controls inside narrow topic panels.
          const canvas = panel.querySelector('.el-canvas');
          if (canvas) {
            Object.assign(canvas.style, { width: '100%', height: 'auto', display: 'grid', gap: '10px', padding: '10px', boxSizing: 'border-box' });
            canvas.querySelectorAll('.el-cell').forEach(cell => Object.assign(cell.style,
              { position: 'relative', left: '0', top: '0', width: '100%', minWidth: '0' }));
          }
        }
      } catch (error) {
        if (!panel.isConnected || generation !== renderGeneration) return;
        panel.textContent = 'フォームを開けません: ' + (error.userMessage || error.message);
        const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'gb-btn'; retry.textContent = '再試行';
        retry.addEventListener('click', () => render(true)); panel.appendChild(retry);
      }
    };
    await render();
    return { flush: () => MeldexDbFormRuntime.confirmLeave(panel) };
  }
  window.MeldexSheetDefaultForm = Object.freeze({ mount });
})();
