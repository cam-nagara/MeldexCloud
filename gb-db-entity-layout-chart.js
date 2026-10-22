/* gb-db-entity-layout-chart.js: エントリレイアウトの chart セル（棒/円/折れ線/レーダー）。
   - bar/pie/line: 既存チャートエンジン（gb-db-chart.js の renderBarChart/renderPieChart/
     renderLineChart。いずれもサイズ引数式でコンテナ非依存）をセルサイズで再利用する。
     データはチャートビューと同じ集計（prepareChartDataAsync）を、/pivot をその場で
     取得して通す（エントリ画面ではシート全体のデータを持っていないため）。
   - radar: このエントリの数値列（数式列も formulaEvalForEntity で評価可）を軸にした
     レーダーチャートを、既存のSVGプリミティブ（svgCreate/svgText等）で新規描画する。
   - 設定UIはセルの歯車ボタン（_elOpenCellSettings 経由）と編集ツールバーの「チャート」から開く。 */
'use strict';

const EL_CHART_TYPES = [
  { type: 'bar', label: '棒グラフ' },
  { type: 'pie', label: '円グラフ' },
  { type: 'line', label: '折れ線' },
  { type: 'radar', label: 'レーダー' },
];

const EL_CHART_AGGREGATIONS = [
  { value: 'count', label: '件数' },
  { value: 'sum', label: '合計' },
  { value: 'average', label: '平均' },
  { value: 'min', label: '最小' },
  { value: 'max', label: '最大' },
  { value: 'median', label: '中央値' },
];

/* /pivot の短期キャッシュ（同一レイアウト内の複数チャートセルで重複取得しないため） */
const _elPivotCache = new Map();
const EL_PIVOT_CACHE_MS = 10000;

function _elFetchPivotData(dbPath) {
  const key = String(dbPath || '');
  const cached = _elPivotCache.get(key);
  const now = Date.now();
  if (cached && now - cached.at < EL_PIVOT_CACHE_MS) return cached.promise;
  const promise = Promise.resolve().then(() =>
    typeof apiFetch === 'function' ? apiFetch('/pivot?path=' + encodeURIComponent(key)) : null
  ).catch((error) => {
    if (_elPivotCache.get(key)?.promise === promise) _elPivotCache.delete(key);
    throw error;
  });
  _elPivotCache.set(key, { at: now, promise });
  return promise;
}

function _elInvalidatePivotData(dbPath) {
  _elPivotCache.delete(String(dbPath || ''));
}

/* 最新の列タイプ定義。マウント時に固定された ctx.propTypes ではなく、その場の
   getPropertyTypes を優先する（設定パネルで直前に追加・変更した列も候補へ出すため）。 */
function _elChartPropTypes(ctx) {
  if (typeof getPropertyTypes === 'function') {
    const fresh = getPropertyTypes(ctx.dbPath, ctx.options?.ctx);
    if (fresh && typeof fresh === 'object') return fresh;
  }
  return ctx.propTypes || {};
}

/* このエントリの列値を数値として解決する（レーダーの軸値）。数式列は実行時評価。 */
function _elEntityNumericValue(propName, ctx) {
  const ptc = _elChartPropTypes(ctx)[propName];
  if (ptc?.type === 'formula' && typeof formulaEvalForEntity === 'function') {
    try {
      // formulaEvalForEntity は { value, error } を返す（他の全呼び出し元と同じ受け方にする）
      const result = formulaEvalForEntity(ptc.formula, ctx.data?.properties || {}, {
        propTypes: _elChartPropTypes(ctx),
        dbPath: ctx.dbPath,
      });
      if (result?.error) return 0;
      const n = Number(result?.value);
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }
  const rawValues = ctx.data?.properties?.[propName] || [];
  const values = typeof filterValues === 'function' ? filterValues(rawValues) : rawValues;
  const raw = values[0]?.value;
  const n = parseFloat(String(raw ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/* レーダーチャートの描画（axes: [{label, value, max}]）。
   既存チャートエンジンと同じSVGプリミティブを使い、目盛リング・スポーク・多角形を描く。 */
function _elRenderRadarChart(axes, w, h, options = {}) {
  const svg = svgCreate('svg', { width: w, height: h, viewBox: '0 0 ' + w + ' ' + h });
  const list = (axes || []).filter(a => a && a.label);
  const accent = typeof _chartThemeAccentColor === 'function' ? _chartThemeAccentColor() : '#7c9cff';
  const fg2 = options.mutedColor || 'rgba(128,128,128,0.55)';
  if (list.length < 3) {
    svg.appendChild(svgText(w / 2, h / 2, '軸を3つ以上選んでください', { fill: fg2, fontSize: 13, anchor: 'middle' }));
    return svg;
  }
  const cx = w / 2;
  const cy = h / 2;
  const labelMargin = options.showLabels === false ? 8 : 22;
  const radius = Math.max(20, Math.min(w, h) / 2 - labelMargin);
  const angleAt = (i) => (Math.PI * 2 * i) / list.length - Math.PI / 2;
  const pointAt = (i, ratio) => [cx + Math.cos(angleAt(i)) * radius * ratio, cy + Math.sin(angleAt(i)) * radius * ratio];

  // 目盛リング（25/50/75/100%）とスポーク
  [0.25, 0.5, 0.75, 1].forEach(ratio => {
    const points = list.map((_a, i) => pointAt(i, ratio).map(v => Math.round(v * 10) / 10).join(',')).join(' ');
    svg.appendChild(svgCreate('polygon', { points, fill: 'none', stroke: fg2, 'stroke-width': ratio === 1 ? 1 : 0.5, opacity: ratio === 1 ? 0.8 : 0.45 }));
  });
  list.forEach((_a, i) => {
    const [x, y] = pointAt(i, 1);
    svg.appendChild(svgLine(cx, cy, x, y, fg2, 0.5));
  });

  // 値の多角形
  const valuePoints = list.map((axis, i) => {
    const max = Number(axis.max) > 0 ? Number(axis.max) : 1;
    const ratio = Math.max(0, Math.min(1, Number(axis.value || 0) / max));
    return pointAt(i, ratio).map(v => Math.round(v * 10) / 10).join(',');
  }).join(' ');
  svg.appendChild(svgCreate('polygon', {
    points: valuePoints,
    fill: accent,
    'fill-opacity': 0.28,
    stroke: accent,
    'stroke-width': 2,
    'stroke-linejoin': 'round',
    class: 'el-radar-polygon',
  }));

  // 軸ラベル（値付き）。SVGの左右端で見切れないよう描画位置をクランプする
  if (options.showLabels !== false) {
    list.forEach((axis, i) => {
      const [rawX, y] = pointAt(i, 1.06 + 10 / radius);
      const anchor = Math.abs(rawX - cx) < radius * 0.25 ? 'middle' : (rawX < cx ? 'end' : 'start');
      const label = String(axis.label).slice(0, 8) + (options.showValues === false ? '' : ' ' + (Math.round(Number(axis.value || 0) * 10) / 10));
      const approxWidth = label.length * 8.5;
      let x = rawX;
      if (anchor === 'end') x = Math.max(approxWidth, rawX);
      else if (anchor === 'start') x = Math.min(w - approxWidth, rawX);
      else x = Math.max(approxWidth / 2, Math.min(w - approxWidth / 2, rawX));
      svg.appendChild(svgText(x, Math.max(16, Math.min(h - 4, y + 3)), label, { fill: 'currentColor', fontSize: 13, anchor }));
    });
  }
  return svg;
}

/* chart セルの内容を描画する。radar は同期、bar/pie/line は /pivot 取得後に差し込む。 */
function _elBuildChartCellContent(cell, ctx, canvasEl) {
  const wrap = document.createElement('div');
  wrap.className = 'el-cell-content el-cell-chart-content';
  const cfg = _elIsObj(cell.chart) ? cell.chart : {};
  const w = Math.max(80, cell.w - 16);
  const h = Math.max(60, cell.h - 16);

  if (!cfg.chartType) {
    const empty = document.createElement('div');
    empty.className = 'el-cell-placeholder';
    empty.textContent = ctx.editMode ? 'チャート未設定（歯車ボタンで設定）' : '';
    wrap.appendChild(empty);
    return wrap;
  }

  if (cfg.chartType === 'radar' || cfg.dataSource === 'entry') {
    const missing = (Array.isArray(cfg.axes) ? cfg.axes : []).filter(axis => !_elNumericChartProps(ctx).includes(axis.prop));
    if (missing.length) {
      const hint = document.createElement('div'); hint.className = 'el-cell-placeholder';
      hint.textContent = '参照する数値列が見つかりません: ' + missing.map(axis => axis.prop).join('、');
      wrap.appendChild(hint); return wrap;
    }
  }

  if (cfg.chartType === 'radar') {
    const rawAxes = (Array.isArray(cfg.axes) ? cfg.axes : []).map(axis => ({
      prop: String(axis?.prop || ''),
      label: axis?.label || String(axis?.prop || ''),
      explicitMax: Number(axis?.max) > 0 ? Number(axis.max) : 0,
      value: _elEntityNumericValue(String(axis?.prop || ''), ctx),
    }));
    // 最大値の優先順位: 軸ごとの指定 > レイアウト共通の指定 > 全軸の実測最大（共通スケールで偏りを防ぐ）
    const sharedMax = Number(cfg.axisMax) > 0 ? Number(cfg.axisMax) : 0;
    const autoMax = Math.max(1, ...rawAxes.map(a => a.value));
    const axes = rawAxes.map(axis => ({
      label: axis.label,
      value: axis.value,
      max: axis.explicitMax || sharedMax || autoMax,
    }));
    wrap.appendChild(_elRenderRadarChart(axes, w, h, { showLabels: cfg.showLabels !== false, showValues: cfg.showValues !== false }));
    return wrap;
  }

  if (cfg.dataSource === 'entry') {
    const axes = Array.isArray(cfg.axes) ? cfg.axes : [];
    const palette = typeof _chartPaletteColors === 'function' ? _chartPaletteColors(cfg) : ['#7c9cff'];
    const values = axes.map(axis => _elEntityNumericValue(axis.prop, ctx));
    const data = { labels: axes.map(axis => axis.label || axis.prop), values,
      colors: axes.map((_, i) => palette[i % palette.length]), total: values.reduce((sum, value) => sum + value, 0) };
    const svg = cfg.chartType === 'pie' ? renderPieChart(data, w, h, cfg)
      : cfg.chartType === 'line' ? renderLineChart(data, w, h, cfg) : renderBarChart(data, w, h, cfg);
    if (svg) wrap.appendChild(svg);
    return wrap;
  }

  const loading = document.createElement('div');
  loading.className = 'el-cell-placeholder';
  loading.textContent = '読み込み中…';
  wrap.appendChild(loading);
  const chartConfig = {
    chartType: cfg.chartType,
    xProperty: cfg.xProperty || '',
    yAggregation: cfg.yAggregation || 'count',
    yProperty: cfg.yProperty || '',
    showLabels: cfg.showLabels !== false,
    showLegend: cfg.showLegend !== false,
    palette: cfg.palette || 'default',
    propertyTypes: _elChartPropTypes(ctx),
  };
  _elFetchPivotData(ctx.dbPath)
    .then(async (pivotData) => {
      if (!wrap.isConnected) return;
      if (!pivotData) {
        loading.textContent = 'チャートを読み込めませんでした';
        return;
      }
      const chartOptions = { ctx: ctx.options?.ctx || ctx };
      const data = typeof prepareChartDataAsync === 'function'
        ? await prepareChartDataAsync(pivotData, chartConfig, ctx.dbPath, chartOptions)
        : prepareChartData(pivotData, chartConfig, ctx.dbPath, chartOptions);
      if (!wrap.isConnected) return;
      wrap.replaceChildren();
      if (!data || !Array.isArray(data.labels) || data.labels.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'el-cell-placeholder';
        empty.textContent = 'データがありません（歯車ボタンで列を設定）';
        wrap.appendChild(empty);
        return;
      }
      let svg = null;
      if (chartConfig.chartType === 'pie' && typeof renderPieChart === 'function') svg = renderPieChart(data, w, h, chartConfig);
      else if (chartConfig.chartType === 'line' && typeof renderLineChart === 'function') svg = renderLineChart(data, w, h, chartConfig);
      else if (typeof renderBarChart === 'function') svg = renderBarChart(data, w, h, chartConfig);
      if (svg) wrap.appendChild(svg);
    })
    .catch(() => {
      if (!wrap.isConnected) return;
      loading.textContent = 'チャートを読み込めませんでした';
    });
  return wrap;
}

function _elRefreshLayoutCharts(ctx) {
  _elInvalidatePivotData(ctx.dbPath);
  for (const element of ctx.grid.querySelectorAll('.el-cell-chart')) {
    const cell = ctx.layout?.cells.find(item => item.id === element.dataset.cellId);
    if (cell) element.replaceChildren(_elBuildChartCellContent(cell, ctx, element.parentElement));
  }
}

/* --- chart セルの設定ポップアップ --- */

function _elNumericChartProps(ctx) {
  const types = _elChartPropTypes(ctx);
  return Object.keys(ctx.data?.properties || {})
    .concat(Object.keys(types))
    .filter((prop, index, list) => list.indexOf(prop) === index)
    // rollup はエントリ画面にその場の再計算経路が無く、保存済みの古い生値を拾ってしまうため
    // レーダー軸候補には含めない（number と formula のみ）
    .filter(prop => ['number', 'formula'].includes(types[prop]?.type));
}

function _elAllChartProps(ctx) {
  const types = _elChartPropTypes(ctx);
  return Object.keys(ctx.data?.properties || {})
    .concat(Object.keys(types))
    .filter((prop, index, list) => list.indexOf(prop) === index);
}

function _elShowChartCellPopup(anchorBtn, ctx, existingCell) {
  _elCloseEditPopups();
  const popup = document.createElement('div');
  popup.className = 'gb-context-menu el-edit-popup el-chart-popup';
  popup.dataset.e2eId = 'entity-layout-chart-popup';
  popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', 'チャートのデータ・表示設定');
  const title = document.createElement('div'); title.className = 'el-popup-title';
  title.textContent = existingCell ? 'チャートのデータ・表示設定' : 'チャートセルを追加'; popup.appendChild(title);
  const draft = JSON.parse(JSON.stringify(_elIsObj(existingCell?.chart) ? existingCell.chart : {}));
  const selectRow = (root, label, id, choices, value) => {
    const row = document.createElement('label'); row.className = 'el-popup-row';
    const text = document.createElement('span'); text.textContent = label;
    const select = document.createElement('select'); select.className = 'gb-input'; select.dataset.e2eId = id; select.setAttribute('aria-label', label);
    choices.forEach(([key, name]) => select.add(new Option(name, key)));
    select.value = value; row.append(text, select); root.appendChild(row); return select;
  };
  const type = selectRow(popup, '種類', 'entity-layout-chart-type', EL_CHART_TYPES.map(item => [item.type,item.label]), draft.chartType || 'bar');
  const source = selectRow(popup, 'データの範囲', 'entity-layout-chart-source', [['entry','このトピックの数値列'],['sheet','シート全体を集計']],
    draft.chartType === 'radar' ? 'entry' : draft.dataSource || (existingCell ? 'sheet' : 'entry'));
  const hint = document.createElement('p'); hint.className = 'el-popup-hint';
  hint.textContent = '参照するのはシートの列です。同じ列を置いた入力セルの値が使われます。上から順に表示します。'; popup.appendChild(hint);
  const body = document.createElement('div'); body.className = 'el-chart-popup-body'; popup.appendChild(body);
  let collect = () => ({});
  const build = () => {
    Object.assign(draft, collect()); body.replaceChildren();
    const radar = type.value === 'radar';
    if (radar) source.value = 'entry'; source.disabled = radar;
    hint.textContent = source.value === 'entry'
      ? '参照する数値列を選びます。現在のトピックの値（新規入力では入力中の値）を、上から順に表示します。'
      : '参照先シートの保存済みトピックを集計します。分類の列でグループを分け、値の列を指定した方法で集計します。';
    if (source.value === 'entry') {
      const numeric = _elNumericChartProps(ctx);
      const saved = new Map((draft.axes || []).map(axis => [axis.prop,axis]));
      const order = [...new Set([...(draft.axes || []).map(axis => axis.prop), ...numeric])];
      const heading = document.createElement('div'); heading.className = 'el-chart-axis-settings el-popup-hint';
      for (const text of ['参照する列', '表示名', radar ? '最大値' : '', '順序', '']) { const span = document.createElement('span'); span.textContent = text; heading.appendChild(span); }
      body.appendChild(heading);
      const list = document.createElement('div'); body.appendChild(list);
      order.forEach(prop => {
        const axis = saved.get(prop) || { prop };
        const row = document.createElement('div'); row.className = 'el-chart-axis-settings';
        const label = document.createElement('label');
        const check = document.createElement('input'); check.type = 'checkbox'; check.checked = saved.has(prop);
        check.dataset.prop = prop; check.dataset.e2eId = 'entity-layout-chart-axis';
        label.append(check, document.createTextNode(prop + (numeric.includes(prop) ? '' : '（数値列なし）')));
        const caption = document.createElement('input'); caption.type = 'text'; caption.value = axis.label || ''; caption.placeholder = prop; caption.setAttribute('aria-label', '表示名: ' + prop);
        const max = document.createElement('input'); max.type = 'number'; max.min = '0'; max.step = 'any'; max.value = axis.max > 0 ? axis.max : ''; max.placeholder = '自動'; max.disabled = !radar; max.setAttribute('aria-label', '軸の最大値: ' + prop);
        row.append(label, caption, max);
        for (const [text, up] of [['↑',true],['↓',false]]) {
          const move = document.createElement('button'); move.type = 'button'; move.className = 'gb-btn'; move.textContent = text; move.setAttribute('aria-label', prop + (up ? 'を前へ' : 'を後へ'));
          move.addEventListener('click', () => { if (up && row.previousElementSibling) list.insertBefore(row,row.previousElementSibling); else if (!up && row.nextElementSibling) list.insertBefore(row.nextElementSibling,row); }); row.appendChild(move);
        }
        row._axis = () => ({ ...axis, prop, label: caption.value.trim(), max: Number(max.value) || 0 });
        list.appendChild(row);
      });
      if (!numeric.length) { const empty = document.createElement('p'); empty.textContent = '数値・数式の列をシートに追加してください。'; body.appendChild(empty); }
      const maxRow = document.createElement('label'); maxRow.className = 'el-popup-row'; maxRow.textContent = '全軸の最大値（空欄で自動）';
      const max = document.createElement('input'); max.type = 'number'; max.min = '0'; max.step = 'any'; max.value = draft.axisMax > 0 ? draft.axisMax : ''; max.dataset.e2eId = 'entity-layout-chart-axis-max'; maxRow.appendChild(max);
      if (radar) body.appendChild(maxRow);
      collect = () => ({ axes: [...list.children].filter(row => row.querySelector('input[type=checkbox]').checked).map(row => row._axis()), axisMax: Number(max.value) || 0 });
    } else {
      const all = _elAllChartProps(ctx), numeric = _elNumericChartProps(ctx);
      const x = selectRow(body, '分類・横軸の列', 'entity-layout-chart-x', [['','（未選択）'], ...all.map(prop => [prop,prop])], draft.xProperty || '');
      const agg = selectRow(body, '集計', 'entity-layout-chart-agg', EL_CHART_AGGREGATIONS.map(item => [item.value,item.label]), draft.yAggregation || 'count');
      const y = selectRow(body, '値・縦軸の列', 'entity-layout-chart-y', [['','（未選択）'], ...numeric.map(prop => [prop,prop])], draft.yProperty || '');
      const toggle = () => { y.disabled = agg.value === 'count'; }; agg.addEventListener('change',toggle); toggle();
      collect = () => ({ xProperty:x.value, yAggregation:agg.value, yProperty:y.value });
    }
  };
  type.addEventListener('change',build); source.addEventListener('change',build); build();
  const flags = {};
  for (const [key,label] of [['showLabels','ラベルを表示'],['showValues','レーダーの値を表示'],['showLegend','凡例を表示（円グラフ）']]) {
    const row = document.createElement('label'); row.className = 'el-chart-axis-row';
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = draft[key] !== false; flags[key] = check;
    row.append(check,document.createTextNode(label)); popup.appendChild(row);
  }
  const palette = selectRow(popup, '配色（棒・円・折れ線）', 'entity-layout-chart-palette', [['default','標準'],['warm','暖色'],['cool','寒色'],['themeAccent','テーマ色']], draft.palette || 'default');
  // Preserve saved palettes that may have been created by another chart editor/version.
  if (!palette.value && draft.palette) { palette.add(new Option(draft.palette,draft.palette)); palette.value = draft.palette; }
  const error = document.createElement('p'); error.setAttribute('role','status'); popup.appendChild(error);
  const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'gb-btn gb-btn-primary primary';
  apply.dataset.e2eId = 'entity-layout-chart-apply'; apply.textContent = existingCell ? '適用' : '追加';
  const close = _elAttachPopupCommon(popup, anchorBtn, { actions: [apply] });
  apply.addEventListener('click', () => {
    if ([...popup.querySelectorAll('input')].some(input => !input.checkValidity())) { error.textContent = '最大値は0以上の数値で指定してください'; return; }
    const chart = { ...draft, ...collect(), chartType:type.value, dataSource:source.value, palette:palette.value };
    Object.entries(flags).forEach(([key,check]) => { chart[key] = check.checked; });
    if (chart.dataSource === 'entry' && (chart.axes.length < (chart.chartType === 'radar' ? 3 : 1) || chart.axes.some(axis => !_elNumericChartProps(ctx).includes(axis.prop)))) {
      error.textContent = chart.chartType === 'radar' ? 'レーダーには有効な数値列を3つ以上選んでください' : '有効な数値列を1つ以上選んでください'; return;
    }
    if (chart.dataSource === 'sheet' && (!chart.xProperty || (chart.yAggregation !== 'count' && !chart.yProperty))) { error.textContent = '分類の列と、件数以外では値の列を選んでください'; return; }
    close();
    if (existingCell) { _elPersistCellPatch(ctx, existingCell, 'トピックレイアウト: チャート設定', target => { target.chart = chart; }); ctx.rerender(); }
    else _elAddCell(ctx, { type:'chart', w:320, h:240, chart }, 'チャート');
  });
}
