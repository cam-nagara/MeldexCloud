/* Travel is a transparent estimate from geometry and user-specified conditions. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./gb-map-document.js') : root.MeldexMapDocument);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MeldexMapTravel = api;
})(globalThis, function (D) {
  'use strict';
  const unit = doc => doc.coordinate_system === 'world' ? 'km' : doc.scale.unit;
  function estimate(doc, feature, settings) {
    if (feature?.kind !== 'route') throw new Error('経路を選択してください');
    if (doc.coordinate_system === 'local' && !doc.scale.distance_per_unit) throw new Error('旅程を計算するには縮尺を設定してください');
    const { speed, daily_hours, rest_days } = settings;
    if (!Number.isFinite(speed) || speed <= 0 || speed > 1e7 || !Number.isFinite(daily_hours) || daily_hours <= 0 || daily_hours > 24
      || !Number.isInteger(rest_days) || rest_days < 0 || rest_days > 36500 || settings.unit !== unit(doc)) throw new Error('移動条件と距離の単位を確認してください');
    const distance = D.distance(D.drawPoints(feature, doc), doc), hours = distance / speed;
    if (!Number.isFinite(hours)) throw new Error('旅程の概算が大きすぎます');
    const movingDays = Math.max(hours > 0 ? 1 : 0, Math.ceil(hours / daily_hours - 1e-10));
    if (!Number.isSafeInteger(movingDays) || !Number.isSafeInteger(movingDays + rest_days)) throw new Error('旅程の概算が大きすぎます。移動条件と縮尺を確認してください');
    return { distance, hours, movingDays, totalDays: movingDays + rest_days, unit: settings.unit };
  }
  function inspector(app, root, feature, locked) {
    if (feature.kind !== 'route' || feature.cartography?.role === 'border') return;
    const section = document.createElement('section'); section.setAttribute('aria-label', '旅程の概算');
    const heading = document.createElement('h4'); heading.textContent = '旅程の概算'; section.appendChild(heading);
    const doc = app.store.doc, currentUnit = unit(doc), plan = feature.travel_plan, compatible = plan?.unit === currentUnit;
    const hint = document.createElement('p'); hint.textContent = '速度と1日の移動時間を入力してください。地形・天候・道路の状況は自動で補正しません。'; section.appendChild(hint);
    const fields = {};
    const input = (key, label, value, min, max, step) => {
      const wrap = document.createElement('label'); wrap.className = 'gb-map-field'; const caption = document.createElement('span'); caption.textContent = label;
      const control = document.createElement('input'); Object.assign(control, { type: 'number', min, max, step, required: true, value }); control.setAttribute('aria-label', label);
      fields[key] = control; wrap.append(caption, control); section.appendChild(wrap);
      control.oninput = () => { output.textContent = '条件を変更しました。「概算する」で更新してください。'; };
    };
    input('speed', '移動速度（' + (currentUnit === 'unit' ? '任意単位' : currentUnit) + '/時）', compatible ? plan.speed : '', .000001, 1e7, 'any');
    input('daily_hours', '1日の移動時間（時間）', compatible ? plan.daily_hours : '', .000001, 24, 'any');
    input('rest_days', '休息日数（日）', compatible ? plan.rest_days : 0, 0, 36500, 1);
    const output = document.createElement('p'); output.setAttribute('role', 'status');
    const conditions = () => ({ schema_version: 1, unit: currentUnit, ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, Number(v.value)])) });
    const calculate = () => {
      if (!Object.values(fields).every(c => c.reportValidity())) return null;
      try {
        const settings = conditions(), result = estimate(app.store.doc, app.store.doc.features.find(f => f.id === feature.id), settings);
        output.textContent = `距離 ${D.distanceLabel(result.distance, app.store.doc)} ・ 移動 ${result.hours.toLocaleString('ja-JP', { maximumFractionDigits: 1 })}時間 ・ 移動${result.movingDays}日 + 休息${settings.rest_days}日 = 合計${result.totalDays}日（概算）`;
        return settings;
      } catch (error) { output.textContent = error.message; return null; }
    };
    section.append(app._button('概算する', calculate), app._button('移動条件を経路に保存', async () => {
      const settings = calculate(); if (!settings) return;
      const canEdit = app._editGuard(feature.id), store = app.store, original = store.doc;
      if (!canEdit()) return;
      const access = await MeldexEntityDetail.resolveReadOnly(app.path, false);
      if (!section.isConnected || !canEdit() || store.doc !== original || app._selected !== feature.id) return;
      if (access.readOnly) { output.textContent = access.reason || 'この経路は編集できません'; return; }
      if (JSON.stringify(conditions()) !== JSON.stringify(settings)) { output.textContent = '条件が変わりました。もう一度保存してください。'; return; }
      const candidate = D.clone(original); candidate.features.find(f => f.id === feature.id).travel_plan = { ...(feature.travel_plan || {}), ...settings };
      D.parse(JSON.stringify(candidate, null, 2));
      app._editFeature(next => { next.travel_plan = { ...(next.travel_plan || {}), ...settings }; });
    }, { disabled: locked }), output);
    if (compatible) calculate(); else output.textContent = plan ? '距離の単位が変わりました。速度を入力し直してください。' : '移動条件を入力してください。';
    if (doc.coordinate_system === 'local' && !doc.scale.distance_per_unit) output.textContent = '旅程を計算するには縮尺を設定してください';
    root.appendChild(section);
  }
  return Object.freeze({ unit, estimate, inspector });
});
