/* ==============================
   gb-db-chart.js: SVGチャートエンジン + チャートビューモード
   外部依存なし。SVGプリミティブでbar/pie/lineチャートを描画。
   ============================== */

/* --- カラーパレット --- */
const CHART_PALETTES = {
  default: ['#569cd6','#4ec9b0','#ce9178','#dcdcaa','#c586c0','#9cdcfe','#d7ba7d','#608b4e','#d16969','#b5cea8','#6a9955','#d4d4d4'],
  warm:    ['#d16969','#ce9178','#dcdcaa','#d7ba7d','#c586c0','#e06c75','#d19a66','#e5c07b','#f0a0a0','#cc7832','#e2b86b','#cf8e6d'],
  cool:    ['#569cd6','#4ec9b0','#9cdcfe','#6a9955','#b5cea8','#608b4e','#61afef','#56b6c2','#98c379','#7ec8e3','#5c6bc0','#00897b'],
};
const CHART_THEME_ACCENT_FALLBACK = '#569cd6';

/* --- SVGプリミティブ --- */

function _svgNS() { return 'http://www.w3.org/2000/svg'; }

function svgCreate(tag, attrs) {
  const el = document.createElementNS(_svgNS(), tag);
  if (attrs) Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

function svgRect(x, y, w, h, fill, rx) {
  return svgCreate('rect', { x, y, width: w, height: h, fill, rx: rx || 0 });
}

function svgLine(x1, y1, x2, y2, stroke, sw) {
  return svgCreate('line', { x1, y1, x2, y2, stroke, 'stroke-width': sw || 1 });
}

function svgText(x, y, text, opts) {
  const el = svgCreate('text', {
    x, y,
    fill: opts?.fill || 'var(--fg2)',
    'font-size': opts?.fontSize || '12',
    'text-anchor': opts?.anchor || 'middle',
    'dominant-baseline': opts?.baseline || 'auto',
  });
  if (opts?.transform) el.setAttribute('transform', opts.transform);
  el.textContent = text;
  return el;
}

function svgPath(d, fill, stroke) {
  const attrs = { d };
  if (fill) attrs.fill = fill;
  if (stroke) attrs.stroke = stroke;
  return svgCreate('path', attrs);
}

function svgGroup(x, y) {
  return svgCreate('g', { transform: 'translate(' + x + ',' + y + ')' });
}

/* --- チャート設定の取得/保存 --- */

function getChartConfig(dbPath, options = {}) {
  return getCurrentDbViewTypeSpecific(dbPath, 'chart', { ctx: options.ctx || null }) || {
    chartType: 'bar',
    xProperty: '',
    yAggregation: 'count',
    yProperty: null,
    showLabels: true,
    showLegend: true,
    palette: 'single',
    singleColor: '',
  };
}

function setChartConfig(dbPath, config, options = {}) {
  const chartConfig = { ...(config || {}) };
  delete chartConfig.propertyTypes;
  const label = options.historyLabel || options.label || '';
  setCurrentDbViewTypeSpecific(dbPath, 'chart', chartConfig, {
    ctx: options.ctx || null,
    historyLabel: label,
    detail: options.detail || '',
    skipHistory: options.skipHistory === true || !label,
  });
}

function _chartNumericProps(allProps, propTypes) {
  return allProps.filter(p => {
    const pt = propTypes[p]?.type;
    return pt === 'number' || pt === 'formula' || pt === 'rollup';
  });
}

function _normalizeChartConfig(config, allProps, dbPath) {
  const next = { ...(config || {}) };
  const propTypes = next.propertyTypes || (typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath) : {});
  next.showLabels = next.showLabels !== false;
  next.showLegend = next.showLegend !== false;
  if (next.palette !== 'single' && next.palette !== 'themeAccent' && !CHART_PALETTES[next.palette]) next.palette = 'single';
  next.singleColor = _chartNormalizeHexColor(next.singleColor) || '';
  if (!allProps.includes(next.xProperty)) next.xProperty = allProps[0] || '';
  const numProps = _chartNumericProps(allProps, propTypes);
  const numericAggs = ['sum', 'average', 'min', 'max', 'median'];
  if (!numericAggs.includes(next.yAggregation)) next.yAggregation = 'count';
  if (next.yAggregation !== 'count') {
    if (!numProps.length) {
      next.yAggregation = 'count';
      next.yProperty = null;
    } else if (!numProps.includes(next.yProperty)) {
      next.yProperty = numProps[0];
    }
  } else {
    next.yProperty = null;
  }
  next.propertyTypes = propTypes;
  return next;
}

function _chartNormalizeHexColor(value) {
  const text = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text;
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return '#' + text.slice(1).split('').map(ch => ch + ch).join('');
  }
  return '';
}

function _chartColorToHex(value, fallback = CHART_THEME_ACCENT_FALLBACK) {
  const hex = _chartNormalizeHexColor(value);
  if (hex) return hex;
  const match = String(value || '').match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (!match) return fallback;
  const toHex = (n) => Math.max(0, Math.min(255, Number(n) || 0)).toString(16).padStart(2, '0');
  return '#' + toHex(match[1]) + toHex(match[2]) + toHex(match[3]);
}

function _chartThemeAccentColor() {
  try {
    const cs = getComputedStyle(document.documentElement);
    return _chartColorToHex(cs.getPropertyValue('--accent') || '', CHART_THEME_ACCENT_FALLBACK);
  } catch {
    return CHART_THEME_ACCENT_FALLBACK;
  }
}

function _chartPaletteColors(chartConfig) {
  if (chartConfig?.palette === 'single') return [_chartNormalizeHexColor(chartConfig.singleColor) || _chartThemeAccentColor()];
  if (chartConfig?.palette === 'themeAccent') return [_chartThemeAccentColor()];
  return CHART_PALETTES[chartConfig?.palette] || CHART_PALETTES.default;
}

/* --- データ準備 --- */

/**
 * pivotDataからチャート用データを準備する
 * @returns {{ labels: string[], values: number[], colors: string[], total: number }}
 */
function prepareChartData(pivotData, chartConfig, dbPathOverride, options = {}) {
  if (!pivotData || !pivotData.entities) return { labels: [], values: [], colors: [], total: 0 };

  const entities = pivotData.entities;
  const dbPath = dbPathOverride || state.currentDbPath;
  const filterMode = options.filter ?? options.ctx?.filter;
  const entityNames = _chartFilteredEntityNames(pivotData, dbPath, options.ctx || null);
  const allProps = _collectChartProperties(entities, pivotData, dbPath);
  chartConfig = _normalizeChartConfig(chartConfig, allProps, dbPath);
  const xProp = chartConfig.xProperty;
  const yAgg = chartConfig.yAggregation || 'count';
  const palette = _chartPaletteColors(chartConfig);

  if (!xProp) return { labels: [], values: [], colors: [], total: 0 };

  // X軸プロパティの値でグルーピング
  const groups = Object.create(null);
  entityNames.forEach(en => {
    const vals = filterValues(entities[en][xProp] || [], undefined, filterMode);
    const key = vals.length > 0 ? String(vals[0].value ?? '') : '(空)';
    if (!Object.prototype.hasOwnProperty.call(groups, key)) groups[key] = [];
    groups[key].push(en);
  });

  const labels = _chartSortedLabels(Object.keys(groups));
  const values = [];

  if (yAgg === 'count') {
    // 各グループのエントリ数
    labels.forEach(label => values.push(groups[label].length));
  } else if (chartConfig.yProperty && ['sum', 'average', 'min', 'max', 'median'].includes(yAgg)) {
    // Y軸プロパティの集計
    const propTypes = chartConfig.propertyTypes || getPropertyTypes(dbPath);
    const yPtc = propTypes[chartConfig.yProperty] || null;
    labels.forEach(label => {
      const groupEntities = groups[label];
      // グループ内エントリだけのサブマップ
      const subMap = {};
      groupEntities.forEach(en => { subMap[en] = entities[en]; });
      const result = calcAggregation(chartConfig.yProperty, subMap, groupEntities, yAgg, yPtc, propTypes, filterMode);
      values.push(typeof result === 'number' ? result : parseFloat(result) || 0);
    });
  } else {
    labels.forEach(label => values.push(groups[label].length));
  }

  const colors = labels.map((_, i) => palette[i % palette.length]);
  const total = values.reduce((a, b) => a + b, 0);

  return { labels, values, colors, total };
}

async function prepareChartDataAsync(pivotData, chartConfig, dbPathOverride, options = {}) {
  if (!pivotData || !pivotData.entities) return { labels: [], values: [], colors: [], total: 0 };

  const entities = pivotData.entities;
  const dbPath = dbPathOverride || state.currentDbPath;
  const filterMode = options.filter ?? options.ctx?.filter;
  const entityNames = _chartFilteredEntityNames(pivotData, dbPath, options.ctx || null);
  const allProps = _collectChartProperties(entities, pivotData, dbPath);
  chartConfig = _normalizeChartConfig(chartConfig, allProps, dbPath);
  const propTypes = chartConfig.propertyTypes || getPropertyTypes(dbPath);
  const xProp = chartConfig.xProperty;
  const xPtc = propTypes?.[xProp] || null;
  const yAgg = chartConfig.yAggregation || 'count';
  const palette = _chartPaletteColors(chartConfig);

  if (!xProp) return { labels: [], values: [], colors: [], total: 0 };

  let rollupXValues = null;
  if (xPtc?.type === 'rollup' && typeof calcRollupColumn === 'function') {
    rollupXValues = await calcRollupColumn(entities, entityNames, xPtc, propTypes, dbPath, filterMode);
  }

  const groups = Object.create(null);
  entityNames.forEach(en => {
    let key = '';
    if (rollupXValues) {
      const rollupValue = rollupXValues.has(en) ? rollupXValues.get(en) : '';
      key = rollupValue == null || String(rollupValue).trim() === '' || String(rollupValue).trim() === '-' ? '(空)' : String(rollupValue);
    } else {
      const vals = filterValues(entities[en][xProp] || [], undefined, filterMode);
      key = vals.length > 0 ? String(vals[0].value ?? '') : '(空)';
    }
    if (!Object.prototype.hasOwnProperty.call(groups, key)) groups[key] = [];
    groups[key].push(en);
  });

  const labels = _chartSortedLabels(Object.keys(groups));
  const values = [];

  if (yAgg === 'count') {
    labels.forEach(label => values.push(groups[label].length));
  } else if (chartConfig.yProperty && ['sum', 'average', 'min', 'max', 'median'].includes(yAgg)) {
    const yPtc = propTypes[chartConfig.yProperty] || null;
    for (const label of labels) {
      const groupEntities = groups[label];
      const subMap = {};
      groupEntities.forEach(en => { subMap[en] = entities[en]; });
      const result = typeof calcAggregationAsync === 'function'
        ? await calcAggregationAsync(chartConfig.yProperty, subMap, groupEntities, yAgg, yPtc, propTypes, filterMode, { dbPath, sourceDbPath: dbPath })
        : calcAggregation(chartConfig.yProperty, subMap, groupEntities, yAgg, yPtc, propTypes, filterMode);
      values.push(typeof result === 'number' ? result : parseFloat(result) || 0);
    }
  } else {
    labels.forEach(label => values.push(groups[label].length));
  }

  const colors = labels.map((_, i) => palette[i % palette.length]);
  const total = values.reduce((a, b) => a + b, 0);

  return { labels, values, colors, total };
}

/* --- 棒グラフ --- */

function renderBarChart(data, w, h, options = {}) {
  if (data.labels.length === 0) {
    const svg = svgCreate('svg', { width: w, height: h, viewBox: '0 0 ' + w + ' ' + h });
    svg.appendChild(svgText(w / 2, h / 2, 'データなし', { fill: 'var(--fg2)', fontSize: '14' }));
    return svg;
  }

  const margin = { top: 20, right: 20, bottom: 80, left: 60 };
  const barCount = data.labels.length;
  const minBarW = 20;
  const barGap = 4;
  // コンテンツ幅: カテゴリ数が多い場合はSVG幅を拡張
  const neededCw = barCount * (minBarW + barGap) + barGap;
  const cw = Math.max(w - margin.left - margin.right, neededCw);
  const actualW = cw + margin.left + margin.right;
  const ch = h - margin.top - margin.bottom;

  const svg = svgCreate('svg', { width: actualW, height: h, viewBox: '0 0 ' + actualW + ' ' + h });
  const g = svgGroup(margin.left, margin.top);
  svg.appendChild(g);

  const scale = _chartValueScale(data.values);
  const barW = Math.max(minBarW, (cw - barGap * (barCount + 1)) / barCount);
  const showLabels = options.showLabels !== false;

  // Y軸グリッド線
  const gridSteps = _calcGridStepsRange(scale.min, scale.max);
  gridSteps.forEach(v => {
    const y = _chartValueToY(v, scale, ch);
    g.appendChild(svgLine(0, y, cw, y, 'var(--bg4)', 0.5));
    g.appendChild(svgText(-8, y + 4, _formatAxisVal(v), { anchor: 'end', fontSize: '11', fill: 'var(--fg2)' }));
  });

  // X軸ベースライン
  const zeroY = _chartValueToY(0, scale, ch);
  g.appendChild(svgLine(0, zeroY, cw, zeroY, 'var(--bg4)', 1));

  // バー描画
  data.labels.forEach((label, i) => {
    const x = barGap + i * (barW + barGap);
    const valY = _chartValueToY(data.values[i], scale, ch);
    const y = Math.min(valY, zeroY);
    const barH = Math.max(1, Math.abs(zeroY - valY));

    const rect = svgRect(x, y, barW, barH, data.colors[i], 3);
    const title = svgCreate('title');
    title.textContent = label + ': ' + _formatDisplayVal(data.values[i]);
    rect.appendChild(title);
    g.appendChild(rect);

    // 値ラベル
    if (showLabels && barH > 16 && data.values[i] >= 0) {
      g.appendChild(svgText(x + barW / 2, y - 4, _formatDisplayVal(data.values[i]), {
        fontSize: '11', fill: 'var(--fg)', anchor: 'middle',
      }));
    } else if (showLabels && barH > 16) {
      g.appendChild(svgText(x + barW / 2, y + barH + 12, _formatDisplayVal(data.values[i]), {
        fontSize: '11', fill: 'var(--fg)', anchor: 'middle',
      }));
    }

    // X軸ラベル（回転）
    const truncLabel = label.length > 12 ? label.slice(0, 11) + '…' : label;
    g.appendChild(svgText(x + barW / 2, ch + 8, truncLabel, {
      fontSize: '11', fill: 'var(--fg2)', anchor: 'end',
      transform: 'rotate(-40,' + (x + barW / 2) + ',' + (ch + 8) + ')',
    }));
  });

  return svg;
}

/* --- 円グラフ --- */

function renderPieChart(data, w, h, options = {}) {
  const svg = svgCreate('svg', { width: w, height: h, viewBox: '0 0 ' + w + ' ' + h });
  const positiveItems = data.labels.map((label, i) => ({
    label,
    value: data.values[i],
    color: data.colors[i],
  })).filter(item => item.value > 0);
  const positiveTotal = positiveItems.reduce((sum, item) => sum + item.value, 0);
  if (data.labels.length === 0 || positiveTotal === 0) {
    svg.appendChild(svgText(w / 2, h / 2, data.labels.length ? '正の値がありません' : 'データなし', { fill: 'var(--fg2)', fontSize: '14' }));
    return svg;
  }

  const showLabels = options.showLabels !== false;
  const showLegend = options.showLegend !== false;
  const cx = showLegend ? w * 0.4 : w / 2;
  const cy = h / 2;
  const r = Math.min(cx - 30, cy - 30);
  const legendX = cx + r + 40;

  if (positiveItems.length === 1) {
    const item = positiveItems[0];
    const circle = svgCreate('circle', { cx, cy, r, fill: item.color });
    const title = svgCreate('title');
    title.textContent = item.label + ': ' + _formatDisplayVal(item.value) + ' (100%)';
    circle.appendChild(title);
    svg.appendChild(circle);
    if (showLabels) {
      svg.appendChild(svgText(cx, cy, '100%', {
        fontSize: '11', fill: '#fff', anchor: 'middle', baseline: 'central',
      }));
    }
    if (showLegend) {
      svg.appendChild(svgRect(legendX, 14, 12, 12, item.color, 2));
      const truncLabel = item.label.length > 16 ? item.label.slice(0, 15) + '…' : item.label;
      svg.appendChild(svgText(legendX + 18, 24, truncLabel + ' (' + _formatDisplayVal(item.value) + ')', {
        fontSize: '11', fill: 'var(--fg2)', anchor: 'start',
      }));
    }
    return svg;
  }

  let startAngle = -Math.PI / 2;

  positiveItems.forEach(item => {
    const ratio = item.value / positiveTotal;
    const endAngle = startAngle + ratio * 2 * Math.PI;
    const largeArc = ratio > 0.5 ? 1 : 0;

    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);

    const d = 'M ' + cx + ' ' + cy + ' L ' + x1 + ' ' + y1 +
      ' A ' + r + ' ' + r + ' 0 ' + largeArc + ' 1 ' + x2 + ' ' + y2 + ' Z';
    const slice = svgPath(d, item.color);
    const title = svgCreate('title');
    title.textContent = item.label + ': ' + _formatDisplayVal(item.value) + ' (' + Math.round(ratio * 100) + '%)';
    slice.appendChild(title);
    svg.appendChild(slice);

    // スライスラベル（5%以上のみ）
    if (showLabels && ratio >= 0.05) {
      const midAngle = startAngle + (endAngle - startAngle) / 2;
      const lx = cx + r * 0.65 * Math.cos(midAngle);
      const ly = cy + r * 0.65 * Math.sin(midAngle);
      svg.appendChild(svgText(lx, ly, Math.round(ratio * 100) + '%', {
        fontSize: '11', fill: '#fff', anchor: 'middle', baseline: 'central',
      }));
    }

    startAngle = endAngle;
  });

  // 凡例
  if (showLegend) {
    const legendMaxItems = Math.min(positiveItems.length, Math.floor((h - 20) / 22));
    positiveItems.slice(0, legendMaxItems).forEach((item, i) => {
      const ly = 20 + i * 22;
      svg.appendChild(svgRect(legendX, ly - 6, 12, 12, item.color, 2));
      const truncLabel = item.label.length > 16 ? item.label.slice(0, 15) + '…' : item.label;
      svg.appendChild(svgText(legendX + 18, ly + 4, truncLabel + ' (' + _formatDisplayVal(item.value) + ')', {
        fontSize: '11', fill: 'var(--fg2)', anchor: 'start',
      }));
    });
  }

  return svg;
}

/* --- 折れ線グラフ --- */

function renderLineChart(data, w, h, options = {}) {
  const svg = svgCreate('svg', { width: w, height: h, viewBox: '0 0 ' + w + ' ' + h });
  if (data.labels.length === 0) {
    svg.appendChild(svgText(w / 2, h / 2, 'データなし', { fill: 'var(--fg2)', fontSize: '14' }));
    return svg;
  }

  const margin = { top: 20, right: 20, bottom: 80, left: 60 };
  const cw = w - margin.left - margin.right;
  const ch = h - margin.top - margin.bottom;
  const g = svgGroup(margin.left, margin.top);
  svg.appendChild(g);

  const scale = _chartValueScale(data.values);
  const n = data.labels.length;
  const showLabels = options.showLabels !== false;

  // Y軸グリッド線
  const gridSteps = _calcGridStepsRange(scale.min, scale.max);
  gridSteps.forEach(v => {
    const y = _chartValueToY(v, scale, ch);
    g.appendChild(svgLine(0, y, cw, y, 'var(--bg4)', 0.5));
    g.appendChild(svgText(-8, y + 4, _formatAxisVal(v), { anchor: 'end', fontSize: '11', fill: 'var(--fg2)' }));
  });

  // X軸ベースライン
  g.appendChild(svgLine(0, _chartValueToY(0, scale, ch), cw, _chartValueToY(0, scale, ch), 'var(--bg4)', 1));

  // データポイントの座標計算
  const points = data.labels.map((_, i) => {
    const x = n === 1 ? cw / 2 : (i / (n - 1)) * cw;
    const y = _chartValueToY(data.values[i], scale, ch);
    return { x, y };
  });

  // ライン描画
  if (points.length > 1) {
    const pathD = points.map((p, i) => (i === 0 ? 'M' : 'L') + ' ' + p.x + ' ' + p.y).join(' ');
    const line = svgPath(pathD, 'none', data.colors[0]);
    line.setAttribute('stroke-width', '2');
    line.setAttribute('fill', 'none');
    g.appendChild(line);
  }

  // ドット描画
  points.forEach((p, i) => {
    const circle = svgCreate('circle', { cx: p.x, cy: p.y, r: 4, fill: data.colors[0] });
    const title = svgCreate('title');
    title.textContent = data.labels[i] + ': ' + _formatDisplayVal(data.values[i]);
    circle.appendChild(title);
    g.appendChild(circle);
    if (showLabels) {
      g.appendChild(svgText(p.x, Math.max(10, p.y - 10), _formatDisplayVal(data.values[i]), {
        fontSize: '11', fill: 'var(--fg)', anchor: 'middle',
      }));
    }
  });

  // X軸ラベル
  const labelStep = Math.max(1, Math.ceil(n / 15));
  data.labels.forEach((label, i) => {
    if (i % labelStep !== 0 && i !== n - 1) return;
    const x = n === 1 ? cw / 2 : (i / (n - 1)) * cw;
    const truncLabel = label.length > 10 ? label.slice(0, 9) + '…' : label;
    g.appendChild(svgText(x, ch + 8, truncLabel, {
      fontSize: '11', fill: 'var(--fg2)', anchor: 'end',
      transform: 'rotate(-40,' + x + ',' + (ch + 8) + ')',
    }));
  });

  return svg;
}

/* --- ユーティリティ --- */

/** スタックオーバーフロー安全な最大値（spread演算子の代替） */
function _safeMax(arr, defaultVal) {
  if (arr.length === 0) return defaultVal || 0;
  let max = arr[0];
  for (let i = 1; i < arr.length; i++) { if (arr[i] > max) max = arr[i]; }
  return max;
}

function _safeMin(arr, defaultVal) {
  if (arr.length === 0) return defaultVal || 0;
  let min = arr[0];
  for (let i = 1; i < arr.length; i++) { if (arr[i] < min) min = arr[i]; }
  return min;
}

function _chartValueScale(values) {
  if (!values.length) return { min: 0, max: 1, range: 1 };
  let min = Math.min(0, _safeMin(values, 0));
  let max = Math.max(0, _safeMax(values, 0));
  if (min === max) {
    max = min + 1;
    min = Math.min(0, min);
  }
  return { min, max, range: max - min || 1 };
}

function _chartValueToY(value, scale, height) {
  return height - ((value - scale.min) / scale.range) * height;
}

function _calcGridStepsRange(minVal, maxVal) {
  const steps = [];
  const range = maxVal - minVal || 1;
  for (let i = 0; i <= 5; i++) {
    steps.push(minVal + (range * i / 5));
  }
  if (minVal < 0 && maxVal > 0) steps.push(0);
  return [...new Set(steps.map(v => Number(v.toFixed(6))))].sort((a, b) => a - b);
}

function _calcGridSteps(maxVal) {
  if (maxVal <= 0) return [0];
  const rawStep = maxVal / 5;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  let step;
  if (normalized <= 1) step = magnitude;
  else if (normalized <= 2) step = 2 * magnitude;
  else if (normalized <= 5) step = 5 * magnitude;
  else step = 10 * magnitude;

  const steps = [];
  for (let v = 0; v <= maxVal; v += step) {
    if (v > 0) steps.push(v);
  }
  return steps;
}

function _formatAxisVal(v) {
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 1000000) return sign + (abs / 1000000).toFixed(1) + 'M';
  if (abs >= 1000) return sign + (abs / 1000).toFixed(1) + 'K';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function _formatDisplayVal(v) {
  if (typeof v !== 'number') return String(v);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function _chartLabelSortValue(label) {
  const text = String(label ?? '').trim();
  if (!text || text === '(空)') return null;
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
    const n = Number(text);
    if (Number.isFinite(n)) return { type: 'number', value: n };
  }
  if (/^\d{4}[-/]\d{2}(?:[-/]\d{2})?/.test(text)) {
    const d = typeof parseLocalDate === 'function' ? parseLocalDate(text) : new Date(text);
    if (!Number.isNaN(d.getTime())) return { type: 'date', value: d.getTime() };
  }
  return null;
}

function _chartSortedLabels(labels) {
  return [...labels].sort((a, b) => {
    const av = _chartLabelSortValue(a);
    const bv = _chartLabelSortValue(b);
    if (av && bv && av.type === bv.type && av.value !== bv.value) return av.value - bv.value;
    if (av && !bv) return -1;
    if (!av && bv) return 1;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  });
}

/* --- メインレンダラ --- */

/**
 * チャートビューを描画する
 */
async function renderChart(ctx) {
  ctx = ctx || _currentPaneState();
  const container = typeof _dbViewSurfaceEl === 'function'
    ? _dbViewSurfaceEl(ctx, '.chart-view', 'chart-view')
    : ((ctx?.containerEl ? ctx.containerEl.querySelector('.chart-view') : null) || document.getElementById('chart-view') || document.querySelector('.chart-view'));
  if (!container) return;
  if (!_chartIsActiveView(ctx, container)) {
    _disconnectChartResizeObserver(container);
    return;
  }
  container.style.display = 'flex';
  container.innerHTML = '';

  const dbPath = ctx.dbPath || state.currentDbPath;
  const pivotData = ctx.pivotData || state.pivotData;
  if (!dbPath || !pivotData) {
    _disconnectChartResizeObserver(container);
    container.textContent = 'シートを選択してください';
    return;
  }

  let config = getChartConfig(dbPath, { ctx });
  const entities = pivotData.entities || {};
  if (Object.keys(entities).length === 0) {
    if (typeof _dbRenderEmptyStateWithCreate === 'function') {
      _dbRenderEmptyStateWithCreate(container, 'barChart', 'データがありません', 'エントリを追加するとチャートが表示されます', ctx);
    } else {
      renderEmptyState(container, 'barChart', 'データがありません', 'エントリを追加するとチャートが表示されます');
    }
    return;
  }
  const allProps = _collectChartProperties(entities, pivotData, dbPath);

  config = _normalizeChartConfig(config, allProps, dbPath);
  const savedConfig = getChartConfig(dbPath, { ctx });
  const configForSave = { ...config };
  delete configForSave.propertyTypes;
  if (JSON.stringify(configForSave) !== JSON.stringify(savedConfig)) {
    setChartConfig(dbPath, config, { ctx });
  }

  // 設定バー
  const bar = _buildChartSettingsBar(dbPath, config, allProps, ctx);
  container.appendChild(bar);

  // チャート描画エリア
  const chartArea = document.createElement('div');
  chartArea.className = 'chart-area';
  chartArea.style.overflowX = 'auto';
  chartArea.style.overflowY = 'hidden';
  container.appendChild(chartArea);

  // チャート描画（containerのサイズを使用 — chartAreaは新規要素でサイズ未確定のため）
  const data = typeof prepareChartDataAsync === 'function'
    ? await prepareChartDataAsync(pivotData, config, dbPath, { ctx, filter: ctx?.filter })
    : prepareChartData(pivotData, config, dbPath, { ctx, filter: ctx?.filter });
  if (!_chartIsActiveView(ctx, container)) {
    _disconnectChartResizeObserver(container);
    return;
  }
  const containerRect = container.getBoundingClientRect();
  const w = Math.max(containerRect.width - 32 || 600, 400);  // padding分を差し引く
  const h = Math.max(containerRect.height - 80 || 400, 300);  // settings bar分を差し引く

  let svg;
  const renderOptions = {
    showLabels: config.showLabels !== false,
    showLegend: config.showLegend !== false,
  };
  switch (config.chartType) {
    case 'pie':  svg = renderPieChart(data, w, h, renderOptions); break;
    case 'line': svg = renderLineChart(data, w, h, renderOptions); break;
    default:     svg = renderBarChart(data, w, h, renderOptions); break;
  }
  chartArea.appendChild(svg);

  // ResizeObserverでリサイズ時に再描画（containerを監視 — chartAreaは毎回再生成されるため）
  if (container._resizeTimer) clearTimeout(container._resizeTimer);
  if (container._resizeObs) container._resizeObs.disconnect();
  let resizeTimer = null;
  let lastW = containerRect.width, lastH = containerRect.height;
  if (typeof ResizeObserver !== 'function') return;
  container._resizeObs = new ResizeObserver(entries => {
    if (!_chartIsActiveView(ctx, container)) {
      _disconnectChartResizeObserver(container);
      return;
    }
    const entry = entries[0];
    if (!entry) return;
    const newW = entry.contentRect.width, newH = entry.contentRect.height;
    // サイズが実際に変化した場合のみ再描画（無限ループ防止）
    if (Math.abs(newW - lastW) < 2 && Math.abs(newH - lastH) < 2) return;
    lastW = newW; lastH = newH;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderChart(ctx), 200);
    container._resizeTimer = resizeTimer;
  });
  container._resizeObs.observe(container);
}

function _renderChartForDbPanels(dbPath, preferredCtx) {
  const targets = typeof _dbPaneContextsForPath === 'function'
    ? _dbPaneContextsForPath(dbPath)
    : [preferredCtx || (typeof _currentPaneState === 'function' ? _currentPaneState() : null)].filter(Boolean);
  if (preferredCtx && !targets.includes(preferredCtx)) targets.unshift(preferredCtx);
  (targets.length ? targets : [preferredCtx]).forEach(targetCtx => renderChart(targetCtx));
}

function _disconnectChartResizeObserver(container) {
  if (!container) return;
  if (container._resizeTimer) {
    clearTimeout(container._resizeTimer);
    container._resizeTimer = null;
  }
  if (container._resizeObs) {
    container._resizeObs.disconnect();
    container._resizeObs = null;
  }
}

function _chartIsActiveView(ctx, container) {
  const c = ctx || (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  const dbPath = c?.dbPath || (typeof state !== 'undefined' ? state.currentDbPath : '');
  if (!dbPath) return false;
  if (typeof _dbCurrentViewModeForContext === 'function') {
    try { return _dbCurrentViewModeForContext(c, dbPath) === 'chart'; } catch {}
  }
  if (typeof getCurrentViewMode === 'function') {
    try { return getCurrentViewMode(dbPath, { ctx: c }) === 'chart'; } catch {}
  }
  if (c && c.viewMode) return c.viewMode === 'chart';
  return !container || container.style.display !== 'none';
}

/**
 * チャートで使用可能なプロパティ一覧を収集
 */
function _chartPropertyAllowed(propName) {
  return !!propName && !String(propName).startsWith('_');
}

function _collectChartProperties(entities, pivotData, dbPath) {
  const propSet = new Set();
  const add = (propName) => {
    if (_chartPropertyAllowed(propName)) propSet.add(propName);
  };
  const props = Array.isArray(pivotData) ? pivotData : (pivotData?.properties || []);
  props.forEach(add);
  const propTypes = pivotData?.propertyTypes || (typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath) : {});
  Object.keys(propTypes || {}).forEach(add);
  Object.values(entities).forEach(entData => {
    Object.keys(entData).forEach(k => {
      add(k);
    });
  });
  const names = [...propSet];
  return typeof filterDeletedDbProperties === 'function' ? filterDeletedDbProperties(dbPath, names) : names;
}

function _chartFilteredEntityNames(pivotData, dbPath, ctx) {
  const entities = pivotData?.entities || {};
  let names = Object.keys(entities);
  const advFilters = typeof getAdvancedFilters === 'function' ? getAdvancedFilters(dbPath, { ctx }) : [];
  const filterMode = ctx?.filter;
  if (Array.isArray(advFilters) && advFilters.length > 0 && typeof _dbEntityPassesAdvancedFilters === 'function') {
    names = names.filter(name => _dbEntityPassesAdvancedFilters(entities[name], advFilters, filterMode));
  }
  const columnValueFilters = typeof getColumnValueFilters === 'function'
    ? getColumnValueFilters(dbPath, { ctx })
    : {};
  if (typeof _dbEntityPassesColumnValueFilters === 'function' && Object.keys(columnValueFilters).length) {
    names = names.filter(name => _dbEntityPassesColumnValueFilters(
      name,
      entities[name],
      columnValueFilters,
      dbPath,
      ctx,
      filterMode,
    ));
  }
  return names;
}

/**
 * チャート設定バーを構築
 */
function _buildChartSettingsBar(dbPath, config, allProps, ctx) {
  const bar = document.createElement('div');
  bar.className = 'chart-settings-bar';
  const chartScope = 'chart-' + ((ctx && ctx.paneId) || 'main');

  // チャートタイプ
  bar.appendChild(_chartLabel('タイプ'));
  const typeSelect = _chartSelect([
    { key: 'bar', label: '棒グラフ' },
    { key: 'pie', label: '円グラフ' },
    { key: 'line', label: '折れ線' },
  ], config.chartType, chartScope + '-type', 'チャートタイプ');
  typeSelect.addEventListener('change', () => {
    config.chartType = typeSelect.value;
    setChartConfig(dbPath, config, { ctx, label: 'シート表示: チャート設定', detail: 'タイプ' });
    _renderChartForDbPanels(dbPath, ctx);
  });
  bar.appendChild(typeSelect);

  // X軸プロパティ
  bar.appendChild(_chartLabel('X軸'));
  const xSelect = _chartSelect(
    allProps.map(p => ({ key: p, label: p })),
    config.xProperty,
    chartScope + '-x-property',
    'チャートX軸の列'
  );
  xSelect.addEventListener('change', () => {
    config.xProperty = xSelect.value;
    setChartConfig(dbPath, config, { ctx, label: 'シート表示: チャート設定', detail: 'X軸' });
    _renderChartForDbPanels(dbPath, ctx);
  });
  bar.appendChild(xSelect);

  // Y軸集計
  bar.appendChild(_chartLabel('Y軸'));
  const yAggOptions = [{ key: 'count', label: '件数' }];
  // 数値プロパティがあれば追加集計を表示
  const propTypes = config.propertyTypes || getPropertyTypes(dbPath);
  const numericAggs = [
    { key: 'sum', label: '合計' },
    { key: 'average', label: '平均' },
    { key: 'min', label: '最小' },
    { key: 'max', label: '最大' },
    { key: 'median', label: '中央値' },
  ];
  const numProps = _chartNumericProps(allProps, propTypes);
  const hasNumeric = numProps.length > 0;
  if (hasNumeric) numericAggs.forEach(a => yAggOptions.push(a));

  const yAggSelect = _chartSelect(yAggOptions, config.yAggregation, chartScope + '-y-aggregation', 'チャートY軸集計');
  yAggSelect.addEventListener('change', () => {
    config.yAggregation = yAggSelect.value;
    config.yProperty = config.yAggregation === 'count' ? null : (numProps.includes(config.yProperty) ? config.yProperty : (numProps[0] || null));
    setChartConfig(dbPath, config, { ctx, label: 'シート表示: チャート設定', detail: 'Y軸' });
    _renderChartForDbPanels(dbPath, ctx);
  });
  bar.appendChild(yAggSelect);

  // Y軸プロパティ（集計がcount以外の場合）
  if (config.yAggregation !== 'count' && hasNumeric) {
    bar.appendChild(_chartLabel('対象'));
    const yPropSelect = _chartSelect(
      numProps.map(p => ({ key: p, label: p })),
      config.yProperty || numProps[0] || '',
      chartScope + '-y-property',
      'チャートY軸対象の列'
    );
    yPropSelect.addEventListener('change', () => {
      config.yProperty = yPropSelect.value;
      setChartConfig(dbPath, config, { ctx, label: 'シート表示: チャート設定', detail: '対象' });
      _renderChartForDbPanels(dbPath, ctx);
    });
    bar.appendChild(yPropSelect);
  }

  // パレット選択
  bar.appendChild(_chartLabel('配色'));
  const paletteSelect = _chartSelect([
    { key: 'single', label: '単色' },
    { key: 'themeAccent', label: 'テーマカラー' },
    { key: 'default', label: 'デフォルト' },
    { key: 'warm', label: 'ウォーム' },
    { key: 'cool', label: 'クール' },
  ], config.palette || 'single', chartScope + '-palette', 'チャート配色');
  paletteSelect.addEventListener('change', () => {
    config.palette = paletteSelect.value;
    if (config.palette === 'single' && !_chartNormalizeHexColor(config.singleColor)) config.singleColor = _chartThemeAccentColor();
    setChartConfig(dbPath, config, { ctx, label: 'シート表示: チャート設定', detail: '配色' });
    _renderChartForDbPanels(dbPath, ctx);
  });
  bar.appendChild(paletteSelect);
  if ((config.palette || 'single') === 'single') {
    const singleColor = document.createElement('input');
    singleColor.type = 'color';
    singleColor.className = 'chart-color-input';
    singleColor.value = _chartNormalizeHexColor(config.singleColor) || _chartThemeAccentColor();
    singleColor.dataset.e2eId = chartScope + '-single-color';
    singleColor.setAttribute('aria-label', 'チャート単色カラー');
    singleColor.title = '単色カラー';
    singleColor.addEventListener('change', () => {
      config.palette = 'single';
      config.singleColor = _chartNormalizeHexColor(singleColor.value) || _chartThemeAccentColor();
      setChartConfig(dbPath, config, { ctx, label: 'シート表示: チャート設定', detail: '単色カラー' });
      _renderChartForDbPanels(dbPath, ctx);
    });
    bar.appendChild(singleColor);
  }

  const labelsToggle = _chartCheckbox('値ラベル', config.showLabels !== false, chartScope + '-show-labels', 'チャート値ラベル表示');
  labelsToggle.input.addEventListener('change', () => {
    config.showLabels = labelsToggle.input.checked;
    setChartConfig(dbPath, config, { ctx, label: 'シート表示: チャート設定', detail: '値ラベル' });
    _renderChartForDbPanels(dbPath, ctx);
  });
  bar.appendChild(labelsToggle.el);

  if (config.chartType === 'pie') {
    const legendToggle = _chartCheckbox('凡例', config.showLegend !== false, chartScope + '-show-legend', 'チャート凡例表示');
    legendToggle.input.addEventListener('change', () => {
      config.showLegend = legendToggle.input.checked;
      setChartConfig(dbPath, config, { ctx, label: 'シート表示: チャート設定', detail: '凡例' });
      _renderChartForDbPanels(dbPath, ctx);
    });
    bar.appendChild(legendToggle.el);
  }

  return bar;
}

function _chartLabel(text) {
  const span = document.createElement('span');
  span.className = 'chart-label';
  span.textContent = text;
  return span;
}

function _chartSelect(options, selectedValue, e2eId = '', label = '') {
  const sel = document.createElement('select');
  sel.className = 'chart-select';
  if (e2eId) sel.dataset.e2eId = e2eId;
  if (label) sel.setAttribute('aria-label', label);
  options.forEach(opt => {
    const o = document.createElement('option');
    o.value = opt.key;
    o.textContent = opt.label;
    if (opt.key === selectedValue) o.selected = true;
    sel.appendChild(o);
  });
  return sel;
}

function _chartCheckbox(text, checked, e2eId = '', label = '') {
  const wrap = document.createElement('label');
  wrap.className = 'chart-check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!checked;
  if (e2eId) input.dataset.e2eId = e2eId;
  if (label) input.setAttribute('aria-label', label);
  const span = document.createElement('span');
  span.textContent = text;
  wrap.appendChild(input);
  wrap.appendChild(span);
  return { el: wrap, input };
}
