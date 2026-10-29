/* Map documents own geometry; linked Meldex topics keep their own content. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./gb-map-world-terrain.js') : root.MeldexMapWorldTerrain);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MeldexMapDocument = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (T) {
  'use strict';
  // Immutable image strings are shared by history snapshots instead of copying
  // multi-megabyte base64 payloads for every small geometry edit.
  const clone = value => Array.isArray(value) ? value.map(clone)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value;
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const id = () => globalThis.crypto?.randomUUID?.() || 'map-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/;
  const isAvailable = () => !globalThis.MeldexRuntimeAdapter?.isBrowserDataMode?.();
  function create(title = '無題', coordinateSystem = 'local') {
    return { fileType: 'meldex-map', schema_version: 1, title,
      coordinate_system: coordinateSystem, canvas: { width: 2000, height: 1200 },
      basemap: coordinateSystem === 'world' ? 'osm' : 'blank',
      scale: { distance_per_unit: null, unit: 'km', north_degrees: 0 },
      layers: [{ id: 'places', name: '地点・経路', visible: true, locked: false, opacity: 1 }],
      features: [], terrain: null, background: null, view: null };
  }
  function parse(text) {
    if (typeof text === 'string' && text.length > 24 * 1024 * 1024) throw new Error('マップが大きすぎます（最大24MB）');
    const doc = typeof text === 'string' ? JSON.parse(text.replace(/^\uFEFF/, '')) : clone(text);
    const fail = message => { throw new Error(message || 'マップの定義が不正です'); };
    if (!object(doc) || doc.fileType !== 'meldex-map') fail('マップファイルではありません');
    if (doc.schema_version !== 1) fail('未対応のマップ形式です。対応するMeldexで開いてください');
    if (!['world', 'local'].includes(doc.coordinate_system) || typeof doc.title !== 'string') fail();
    if (!object(doc.canvas) || !['width', 'height'].every(key => finite(doc.canvas[key]) && doc.canvas[key] >= 128 && doc.canvas[key] <= 16384)) fail();
    if (!['osm', 'gsi', 'blank'].includes(doc.basemap) || doc.coordinate_system === 'local' && doc.basemap !== 'blank') fail();
    if (doc.basemap_style !== undefined && !['standard', 'pale'].includes(doc.basemap_style)) fail();
    if (!object(doc.scale) || !['km', 'm', 'mi', 'unit'].includes(doc.scale.unit)
      || !finite(doc.scale.north_degrees) || Math.abs(doc.scale.north_degrees) > 360
      || doc.scale.distance_per_unit !== null && (!finite(doc.scale.distance_per_unit) || doc.scale.distance_per_unit <= 0 || doc.scale.distance_per_unit > 1e9)) fail();
    if (!Array.isArray(doc.layers) || !doc.layers.length || doc.layers.length > 100) fail();
    const layers = new Set();
    for (const layer of doc.layers) {
      if (!object(layer) || typeof layer.id !== 'string' || !layer.id || layers.has(layer.id)
        || typeof layer.name !== 'string' || typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean'
        || !finite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1) fail();
      layers.add(layer.id);
    }
    const periods = doc.periods === undefined ? [] : doc.periods, periodIds = new Set();
    if (!Array.isArray(periods) || periods.length > 100) fail('章・時代の定義が不正です');
    for (const period of periods) {
      if (!object(period) || typeof period.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(period.id) || periodIds.has(period.id)
        || typeof period.name !== 'string' || !/[^\s\u001c-\u001f\u0085]/.test(period.name) || [...period.name].length > 120) fail('章・時代の定義が不正です');
      periodIds.add(period.id);
    }
    const pointOK = point => Array.isArray(point) && point.length === 2 && point.every(finite)
      && (doc.coordinate_system === 'world' ? Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 85.051129 : point.every(n => Math.abs(n) <= 1e7));
    if (!Array.isArray(doc.features) || doc.features.length > 10000) fail();
    const ids = new Set(); let points = 0;
    for (const feature of doc.features) {
      if (!object(feature) || typeof feature.id !== 'string' || !feature.id || ids.has(feature.id)
        || !['pin', 'route', 'region', 'label'].includes(feature.kind) || !layers.has(feature.layer_id)
        || !Array.isArray(feature.points) || !feature.points.every(pointOK)
        || feature.points.length < (feature.kind === 'region' ? 3 : feature.kind === 'route' ? 2 : 1)
        || ['pin', 'label'].includes(feature.kind) && feature.points.length !== 1
        || typeof feature.label !== 'string' || typeof feature.description !== 'string'
        || typeof feature.color !== 'string' || !/^#[\da-f]{6}$/i.test(feature.color)
        || !Array.isArray(feature.tags) || !feature.tags.every(tag => typeof tag === 'string')
        || !Array.isArray(feature.links) || !feature.links.every(link => object(link) && typeof link.path === 'string'
          && (!/^[a-z][a-z\d+.-]*:/i.test(link.path) || /^[a-z]:[\\/]/i.test(link.path)) && !link.path.includes('\0'))) fail();
      if (feature.period_ids !== undefined && (!Array.isArray(feature.period_ids) || feature.period_ids.length > 100
        || new Set(feature.period_ids).size !== feature.period_ids.length || !feature.period_ids.every(key => typeof key === 'string' && periodIds.has(key)))) fail('図形の章・時代の参照が不正です');
      if (feature.travel_plan !== undefined) {
        const p = feature.travel_plan;
        if (feature.kind !== 'route' || !object(p) || p.schema_version !== 1 || !['km', 'm', 'mi', 'unit'].includes(p.unit)
          || !finite(p.speed) || p.speed <= 0 || p.speed > 1e7 || !finite(p.daily_hours) || p.daily_hours <= 0 || p.daily_hours > 24
          || !Number.isInteger(p.rest_days) || p.rest_days < 0 || p.rest_days > 36500) fail('経路の移動条件が不正です');
      }
      ids.add(feature.id); points += feature.points.length;
    }
    if (points > 100000) fail('図形の頂点が多すぎます');
    if (doc.sheet_sources != null && (!Array.isArray(doc.sheet_sources) || doc.sheet_sources.length > 20
      || new Set(doc.sheet_sources.map(s => s?.id)).size !== doc.sheet_sources.length || !doc.sheet_sources.every(source => object(source)
        && typeof source.id === 'string' && !!source.id && typeof source.property === 'string' && !!source.property
        && typeof source.path === 'string' && !!source.path && !source.path.includes('\0')
        && (!/^[a-z][a-z\d+.-]*:/i.test(source.path) || /^[a-z]:[\\/]/i.test(source.path))))) fail('シートの場所の参照が不正です');
    for (const feature of doc.features) for (const link of feature.links) if (link.role === 'child-map' && !link.path.toLowerCase().endsWith('.mel-map')) fail('子地図にはマップを指定してください');
    if (doc.view !== null && (!object(doc.view) || !pointOK(doc.view.center) || !finite(doc.view.zoom) || doc.view.zoom < -10 || doc.view.zoom > 22)) fail();
    if (doc.saved_views !== undefined) {
      if (!Array.isArray(doc.saved_views) || doc.saved_views.length > 50) fail('保存した表示が不正です');
      const views = new Set();
      for (const v of doc.saved_views) {
        if (!object(v) || typeof v.id !== 'string' || !v.id || views.has(v.id) || typeof v.name !== 'string' || !/[^\s\u001c-\u001f\u0085]/.test(v.name) || [...v.name].length > 80
          || !pointOK(v.center) || !finite(v.zoom) || v.zoom < -10 || v.zoom > 22 || !Array.isArray(v.layer_ids) || v.layer_ids.length > 100
          || v.layer_ids.some(id => typeof id !== 'string' || !id) || new Set(v.layer_ids).size !== v.layer_ids.length
          || typeof v.filter !== 'string' || v.filter.length > 1000 || !['', 'pin', 'route', 'region', 'label'].includes(v.feature_kind)
          || typeof v.period_id !== 'string' || v.period_id.length > 128) fail('保存した表示が不正です');
        views.add(v.id);
      }
    }
    if (doc.terrain !== null) {
      const t = doc.terrain;
      if (doc.coordinate_system !== 'local' || !object(t) || !Number.isInteger(t.cols) || !Number.isInteger(t.rows)
        || t.cols < 8 || t.cols > 256 || t.rows < 8 || t.rows > 256 || !Array.isArray(t.heights)
        || t.heights.length !== t.cols * t.rows || !t.heights.every(n => finite(n) && n >= -1 && n <= 1)) fail();
    }
    if (doc.background !== null && (doc.coordinate_system !== 'local' || !object(doc.background)
      || typeof doc.background.data_url !== 'string' || doc.background.data_url.length > 20 * 1024 * 1024 || !IMAGE.test(doc.background.data_url))) fail();
    return doc;
  }
  function visibleInPeriod(feature, periodId) { return !periodId || !feature.period_ids?.length || feature.period_ids.includes(periodId); }
  function feature(kind, points, layerId, label = '') {
    return { id: id(), kind, points: clone(points), layer_id: layerId, label,
      color: '#3b82c4', icon: 'pin', tags: [], description: '', links: [] };
  }
  function distance(points, doc) {
    let result = 0;
    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i - 1], [x2, y2] = points[i];
      if (doc.coordinate_system === 'local') result += Math.hypot(x2 - x1, y2 - y1);
      else {
        const rad = Math.PI / 180;
        const a = Math.sin((y2 - y1) * rad / 2) ** 2 + Math.cos(y1 * rad) * Math.cos(y2 * rad) * Math.sin((x2 - x1) * rad / 2) ** 2;
        result += 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
      }
    }
    return doc.coordinate_system === 'world' ? result : result * (doc.scale.distance_per_unit || 1);
  }
  function distanceLabel(value, doc) {
    const unit = doc.coordinate_system === 'world' ? 'km' : doc.scale.distance_per_unit ? doc.scale.unit : '地図単位';
    if (unit === 'km' && value < 1) return (value * 1000).toLocaleString('ja-JP', { maximumFractionDigits: 1 }) + ' m';
    return value.toLocaleString('ja-JP', { maximumFractionDigits: 2 }) + ' ' + ({ unit: '単位' }[unit] || unit);
  }
  function drawPoints(feature, doc) {
    const points = clone(feature.points);
    if (doc.coordinate_system === 'world') for (let i = 1; i < points.length; i++) {
      while (points[i][0] - points[i - 1][0] > 180) points[i][0] -= 360;
      while (points[i][0] - points[i - 1][0] < -180) points[i][0] += 360;
    }
    if (feature.kind !== 'route' || feature.line_style !== 'curve' || points.length < 3) return points;
    const result = [points[0]];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[Math.max(0, i - 1)], b = points[i], c = points[i + 1], d = points[Math.min(points.length - 1, i + 2)];
      for (let step = 1; step <= 12; step++) {
        const t = step / 12;
        result.push([0, 1].map(axis => 0.5 * (2 * b[axis] + (-a[axis] + c[axis]) * t
          + (2 * a[axis] - 5 * b[axis] + 4 * c[axis] - d[axis]) * t * t
          + (-a[axis] + 3 * b[axis] - 3 * c[axis] + d[axis]) * t * t * t)));
      }
    }
    return result;
  }
  function scaleBar(distanceFor100px) {
    if (!(distanceFor100px > 0)) return { distance: 0, pixels: 0 };
    const power = 10 ** Math.floor(Math.log10(distanceFor100px));
    const normalized = distanceFor100px / power;
    const value = (normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1) * power;
    return { distance: value, pixels: 100 * value / distanceFor100px };
  }
  // Versioned deterministic terrain generation; saved cells preserve later edits.
  function generate(seed, template = 'continent', land = 0.45, roughness = 50) {
    return T.generate(seed, template, land, roughness);
  }
  class Store {
    constructor(doc, etag, write, changed = () => {}) {
      this.doc = parse(doc); this.etag = etag; this.write = write; this.changed = changed;
      this.revision = 0; this.savedRevision = 0; this.error = null; this.pending = null;
      this.undoStack = []; this.redoStack = [];
    }
    get dirty() { return this.revision !== this.savedRevision; }
    update(mutator, history = true) {
      const next = clone(this.doc);
      if (mutator(next) === false) return false;
      parse(next);
      if (JSON.stringify(next) === JSON.stringify(this.doc)) return false;
      if (history) { this.undoStack.push(clone(this.doc)); if (this.undoStack.length > 40) this.undoStack.shift(); this.redoStack = []; }
      this.doc = next; this.revision++; this.error = null; this.changed(this); return true;
    }
    restore(direction) {
      const source = direction === 'undo' ? this.undoStack : this.redoStack;
      const target = direction === 'undo' ? this.redoStack : this.undoStack;
      if (!source.length) return false;
      target.push(clone(this.doc));
      const next = source.pop();
      for (const key of ['title', 'display_title', 'meldex']) { if (this.doc[key] !== undefined) next[key] = clone(this.doc[key]); }
      this.doc = next; this.revision++; this.error = null; this.changed(this); return true;
    }
    async save() {
      if (this.pending) { await this.pending; return !this.error && (!this.dirty || this.save()); }
      if (!this.dirty) return true;
      const revision = this.revision, content = JSON.stringify(this.doc, null, 2), etag = this.etag;
      this.pending = (async () => {
        try {
          const result = await this.write(content, etag);
          if (!result?.etag) throw new Error('保存結果を確認できませんでした');
          this.etag = result.etag; this.savedRevision = revision; this.error = null;
        } catch (error) { this.error = error; }
      })();
      this.changed(this); await this.pending; this.pending = null; this.changed(this);
      return !this.error && (!this.dirty || this.save());
    }
  }
  return Object.freeze({ clone, id, create, parse, visibleInPeriod, feature, distance, distanceLabel, drawPoints, scaleBar, generate, Store, isAvailable });
});
