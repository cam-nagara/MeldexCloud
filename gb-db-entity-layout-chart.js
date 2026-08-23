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
  const promise = Promise.resolve(
    typeof apiFetch === 'function' ? apiFetch('/pivot?path=' + encodeURIComponent(key)) : null
  ).catch((error) => {
    _elPivotCache.delete(key);
    throw error;
  });
  _elPivotCache.set(key, { at: now, promise });
  return promise;
}

/* 最新の列タイプ定義。マウント時に固定された ctx.propTypes ではなく、その場の
   getPropertyTypes を優先する（設定パネルで直前に追加・変更した列も候補へ出すため）。 */
function _elChartPropTypes(ctx) {
  if (typeof getPropertyTypes === 'function') {
    const fresh = getPropertyTypes(ctx.dbPath);
    if (fresh && Object.keys(fresh).length) return { ...ctx.propTypes, ...fresh };
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
        propTypes: ctx.propTypes,
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
    svg.appendChild(svgText(w / 2, h / 2, '軸を3つ以上選んでください', { fill: fg2, fontSize: 12, anchor: 'middle' }));
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
      const approxWidth = label.length * 6.5;
      let x = rawX;
      if (anchor === 'end') x = Math.max(approxWidth, rawX);
      else if (anchor === 'start') x = Math.min(w - approxWidth, rawX);
      else x = Math.max(approxWidth / 2, Math.min(w - approxWidth / 2, rawX));
      svg.appendChild(svgText(x, y + 3, label, { fill: 'currentColor', fontSize: 10, anchor }));
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
    wrap.appendChild(_elRenderRadarChart(axes, w, h, { showLabels: cfg.showLabels !== false }));
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
  };
  _elFetchPivotData(ctx.dbPath)
    .then(async (pivotData) => {
      if (!wrap.isConnected) return;
      if (!pivotData) {
        loading.textContent = 'チャートを読み込めませんでした';
        return;
      }
      const data = typeof prepareChartDataAsync === 'function'
        ? await prepareChartDataAsync(pivotData, chartConfig, ctx.dbPath, {})
        : prepareChartData(pivotData, chartConfig, ctx.dbPath, {});
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

  const title = document.createElement('div');
  title.className = 'el-popup-title';
  title.textContent = existingCell ? 'チャートの設定' : 'チャートセルを追加';
  popup.appendChild(title);

  const current = _elIsObj(existingCell?.chart) ? existingCell.chart : {};

  const typeRow = document.createElement('label');
  typeRow.className = 'el-popup-row';
  const typeLabel = document.createElement('span');
  typeLabel.textContent = '種類';
  typeRow.appendChild(typeLabel);
  const typeSelect = document.createElement('select');
  typeSelect.className = 'gb-input';
  typeSelect.dataset.e2eId = 'entity-layout-chart-type';
  EL_CHART_TYPES.forEach(item => {
    const option = document.createElement('option');
    option.value = item.type;
    option.textContent = item.label;
    typeSelect.appendChild(option);
  });
  typeSelect.value = current.chartType || 'bar';
  typeRow.appendChild(typeSelect);
  popup.appendChild(typeRow);

  const body = document.createElement('div');
  body.className = 'el-chart-popup-body';
  popup.appendChild(body);

  const buildBody = () => {
    body.replaceChildren();
    if (typeSelect.value === 'radar') {
      const hint = document.createElement('div');
      hint.className = 'el-popup-hint';
      hint.textContent = '軸にする数値列（3つ以上）';
      body.appendChild(hint);
      const numericProps = _elNumericChartProps(ctx);
      if (numericProps.length === 0) {
        const none = document.createElement('div');
        none.className = 'el-popup-hint';
        none.textContent = '数値・数式の列がありません';
        body.appendChild(none);
      }
      const selected = new Set((Array.isArray(current.axes) ? current.axes : []).map(a => a?.prop));
      numericProps.forEach(prop => {
        const row = document.createElement('label');
        row.className = 'el-chart-axis-row';
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = selected.has(prop);
        check.dataset.prop = prop;
        check.dataset.e2eId = 'entity-layout-chart-axis';
        row.appendChild(check);
        const span = document.createElement('span');
        span.textContent = prop;
        row.appendChild(span);
        body.appendChild(row);
      });
      const maxRow = document.createElement('label');
      maxRow.className = 'el-popup-row';
      const maxLabel = document.createElement('span');
      maxLabel.textContent = '最大値（空欄で自動）';
      maxRow.appendChild(maxLabel);
      const maxInput = document.createElement('input');
      maxInput.type = 'number';
      maxInput.min = '1';
      maxInput.dataset.e2eId = 'entity-layout-chart-axis-max';
      maxInput.value = current.axisMax > 0 ? String(current.axisMax) : '';
      maxRow.appendChild(maxInput);
      body.appendChild(maxRow);
      return;
    }
    const makeSelectRow = (labelText, e2eId, options, value) => {
      const row = document.createElement('label');
      row.className = 'el-popup-row';
      const span = document.createElement('span');
      span.textContent = labelText;
      row.appendChild(span);
      const select = document.createElement('select');
      select.className = 'gb-input';
      select.dataset.e2eId = e2eId;
      options.forEach(([optionValue, optionLabel]) => {
        const option = document.createElement('option');
        option.value = optionValue;
        option.textContent = optionLabel;
        select.appendChild(option);
      });
      select.value = value;
      row.appendChild(select);
      body.appendChild(row);
      return select;
    };
    const allProps = _elAllChartProps(ctx);
    const xSelect = makeSelectRow('横軸の列', 'entity-layout-chart-x',
      allProps.map(prop => [prop, prop]), current.xProperty || allProps[0] || '');
    const aggSelect = makeSelectRow('集計', 'entity-layout-chart-agg',
      EL_CHART_AGGREGATIONS.map(item => [item.value, item.label]), current.yAggregation || 'count');
    const numericProps = _elNumericChartProps(ctx);
    const ySelect = makeSelectRow('値の列（件数以外）', 'entity-layout-chart-y',
      [['', '（未選択）']].concat(numericProps.map(prop => [prop, prop])), current.yProperty || '');
    body._collect = () => ({
      xProperty: xSelect.value,
      yAggregation: aggSelect.value,
      yProperty: ySelect.value,
    });
  };
  typeSelect.addEventListener('change', buildBody);
  buildBody();

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'gb-btn gb-btn-sm gb-btn-primary primary';
  applyBtn.dataset.e2eId = 'entity-layout-chart-apply';
  applyBtn.textContent = existingCell ? '適用' : '追加';
  applyBtn.addEventListener('click', () => {
    const chartType = typeSelect.value;
    const chart = { chartType };
    if (chartType === 'radar') {
      chart.axes = Array.from(body.querySelectorAll('input[type="checkbox"][data-prop]'))
        .filter(check => check.checked)
        .map(check => ({ prop: check.dataset.prop }));
      const axisMax = parseFloat(body.querySelector('[data-e2e-id="entity-layout-chart-axis-max"]')?.value || '');
      if (Number.isFinite(axisMax) && axisMax > 0) chart.axisMax = axisMax;
      if (chart.axes.length < 3) {
        if (typeof showStatus === 'function') showStatus('レーダーには数値列を3つ以上選んでください', true);
        return;
      }
    } else {
      const collected = typeof body._collect === 'function' ? body._collect() : {};
      chart.xProperty = collected.xProperty || '';
      chart.yAggregation = collected.yAggregation || 'count';
      chart.yProperty = collected.yProperty || '';
      if (!chart.xProperty) {
        if (typeof showStatus === 'function') showStatus('横軸の列を選んでください', true);
        return;
      }
    }
    close();
    if (existingCell) {
      _elPersistCellPatch(ctx, existingCell, 'トピックレイアウト: チャート設定', (target) => {
        target.chart = chart;
      });
      ctx.rerender();
    } else {
      _elAddCell(ctx, { type: 'chart', w: 320, h: 240, chart }, 'チャート');
    }
  });
  popup.appendChild(applyBtn);

  const close = _elAttachPopupCommon(popup, anchorBtn);
}
