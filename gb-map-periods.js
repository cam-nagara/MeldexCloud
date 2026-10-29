/* Chapter/era membership is optional; viewing never changes the map document. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./gb-map-document.js') : root.MeldexMapDocument);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MeldexMapPeriods = api;
})(globalThis, function (D) {
  'use strict';
  const selected = app => (app.store.doc.periods || []).some(period => period.id === app.state.mapPeriodId) ? app.state.mapPeriodId : '';
  function choose(app, id) {
    id = (app.store.doc.periods || []).some(period => period.id === id) ? id : '';
    app.state.mapPeriodId = id;
    const tab = app._tab(); if (tab) tab.state.mapPeriodId = id;
    GBLayout.saveLayout();
  }
  function remove(doc, id) {
    if (!(doc.periods || []).some(period => period.id === id)) return false;
    doc.periods = doc.periods.filter(period => period.id !== id);
    for (const feature of doc.features) if (feature.period_ids?.includes(id)) {
      feature.period_ids = feature.period_ids.filter(key => key !== id);
      if (!feature.period_ids.length) delete feature.period_ids;
    }
  }
  function name(value, doc, except = '') {
    const result = value.trim();
    if (!result || [...result].length > 120) throw new Error('章・時代の名前は1〜120文字で入力してください');
    if ((doc.periods || []).some(period => period.id !== except && period.name === result)) throw new Error('同じ名前の章・時代があります');
    return result;
  }
  async function edit(app, rename = false) {
    app._commitInput(); if (app._inputDirty) throw new Error('入力内容を確認してください');
    const canEdit = app._editGuard(), original = app.store.doc;
    const target = (original.periods || []).find(period => period.id === selected(app));
    if (rename && !target) return;
    const value = await cfPrompt(rename ? '章・時代の名前を変更（120文字まで）' : '章・時代を追加（120文字まで）', target && rename ? target.name : '');
    if (value === null || value === undefined || !canEdit() || app._active === false) return;
    const access = await MeldexEntityDetail.resolveReadOnly(app.path, false);
    if (!canEdit() || app._active === false) return;
    if (access.readOnly) throw new Error(access.reason || 'このマップは編集できません');
    if (app.store.doc !== original) throw new Error('地図が変更されました。もう一度操作してください');
    const label = name(value, original, rename ? target.id : ''), id = rename ? target.id : D.id();
    if (app.update(doc => {
      if (rename) doc.periods.find(period => period.id === id).name = label;
      else { if ((doc.periods || []).length >= 100) throw new Error('章・時代は100件までです'); (doc.periods ||= []).push({ id, name: label }); }
    })) {
      choose(app, id); app._render();
    }
  }
  async function erase(app) {
    app._commitInput(); if (app._inputDirty) throw new Error('入力内容を確認してください');
    const canEdit = app._editGuard(), source = app.store.doc, id = selected(app), target = (source.periods || []).find(period => period.id === id);
    if (!target || !await cfConfirm(`「${target.name}」を削除しますか？ 図形は削除しません。この章・時代だけに割り当てた図形は、すべての章・時代で表示されます。`)) return;
    if (!canEdit() || app._active === false || app.store.doc !== source) return;
    const access = await MeldexEntityDetail.resolveReadOnly(app.path, false);
    if (!canEdit() || app._active === false || app.store.doc !== source) return;
    if (access.readOnly) throw new Error(access.reason || 'このマップは編集できません');
    if (app.update(doc => remove(doc, id))) { choose(app, ''); app._render(); }
  }
  function render(app) {
    const root = app.periodsRoot; root.replaceChildren();
    const id = selected(app);
    const tab = app._tab();
    if (app.state.mapPeriodId !== id || tab && tab.state.mapPeriodId !== id) choose(app, id);
    const label = document.createElement('label'); label.className = 'gb-map-field';
    const caption = document.createElement('span'); caption.textContent = '表示する章・時代';
    const select = document.createElement('select'); select.setAttribute('aria-label', '表示する章・時代'); select.add(new Option('すべて', ''));
    for (const period of app.store.doc.periods || []) select.add(new Option(period.name, period.id));
    select.value = id;
    select.onchange = () => {
      app._commitInput(); if (app._inputDirty) { select.value = id; app._message('入力内容を確認してください'); return; }
      choose(app, select.value); app._render();
    };
    label.append(caption, select); root.append(label, app._button('章・時代を追加', () => edit(app), { disabled: app.editingDisabled }),
      app._button('章・時代の名前を変更', () => edit(app, true), { disabled: app.editingDisabled || !id }),
      app._button('章・時代を削除', () => erase(app), { disabled: app.editingDisabled || !id }));
  }
  function inspector(app, root, feature) {
    if (!(app.store.doc.periods || []).length) return;
    const group = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = '表示する章・時代の割り当て'; group.appendChild(legend);
    const note = document.createElement('small'); note.textContent = '未選択はすべてに表示。新しい図形・生成・取り込みは、最初はすべてが対象です。'; group.appendChild(note);
    const canEdit = app._editGuard(feature.id);
    for (const period of app.store.doc.periods) {
      const label = document.createElement('label'); label.className = 'gb-map-field';
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = !!feature.period_ids?.includes(period.id); check.disabled = !canEdit(); check.setAttribute('aria-label', '表示対象: ' + period.name);
      check.onchange = () => {
        if (!group.isConnected || !canEdit()) return;
        app.update(doc => {
          const target = doc.features.find(item => item.id === feature.id), ids = new Set(target.period_ids || []);
          if (check.checked) ids.add(period.id); else ids.delete(period.id);
          if (ids.size) target.period_ids = [...ids]; else delete target.period_ids;
        }); app._render();
      };
      label.append(check, document.createTextNode(period.name)); group.appendChild(label);
    }
    root.appendChild(group);
  }
  return Object.freeze({ selected, choose, remove, render, inspector });
});
