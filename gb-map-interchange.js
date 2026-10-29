/* Offline, bounded interchange. Parsing is pure; adoption is one document edit. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./gb-map-document.js') : root.MeldexMapDocument);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MeldexMapInterchange = api;
})(globalThis, function (D) {
  'use strict';
  const MAX_TEXT = 8 * 1024 * 1024, MAX_POINTS = 100000;
  const fail = message => { throw new Error(message); };
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const text = value => typeof value === 'string' ? value : '';
  const normalize = p => [((p[0] + 180) % 360 + 360) % 360 - 180, Math.max(-85.051129, Math.min(85.051129, p[1]))];
  function checked(plan) {
    const doc = D.create('取込プレビュー', plan.coordinate_system);
    doc.features = plan.features;
    D.parse(doc);
    if (!plan.features.length) fail('取り込める地点・経路・領域がありません');
    return plan;
  }
  function properties(f, props = {}) {
    f.label = text(props.name) || text(props.title);
    f.description = text(props.description) || text(props.desc);
    if (/^#[\da-f]{6}$/i.test(text(props.color))) f.color = props.color;
    if (Array.isArray(props.tags) && props.tags.every(tag => typeof tag === 'string')) f.tags = props.tags.slice();
    return f;
  }
  function csvRows(source) {
    const rows = []; let row = [], cell = '', quoted = false, ended = false;
    const pushCell = () => { row.push(cell); cell = ''; ended = false; };
    const pushRow = () => { pushCell(); if (row.some(value => value !== '')) rows.push(row); row = []; if (rows.length > 10001) fail('CSVは1万地点以下にしてください'); };
    for (let i = 0; i < source.length; i++) {
      const char = source[i];
      if (quoted) {
        if (char === '"') { if (source[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; ended = true; } }
        else cell += char;
      } else if (char === ',') pushCell();
      else if (char === '\r' || char === '\n') { if (char === '\r' && source[i + 1] === '\n') i++; pushRow(); }
      else if (char === '"' && !cell && !ended) quoted = true;
      else { if (ended || char === '"') fail('CSVの引用符が不正です'); cell += char; }
    }
    if (quoted) fail('CSVの引用符が閉じられていません');
    if (cell || row.length || ended) pushRow();
    return rows;
  }
  function readCSV(source, system) {
    const rows = csvRows(source), headers = rows.shift()?.map(value => value.trim().toLowerCase());
    if (!headers || new Set(headers).size !== headers.length) fail('CSVの見出しがないか、重複しています');
    const aliases = { name: ['name', '名前', '名称'], longitude: ['longitude', 'lng', 'lon', '経度'], latitude: ['latitude', 'lat', '緯度'],
      x: ['x'], y: ['y'], description: ['description', '説明'], tags: ['tags', 'タグ'], color: ['color', '色'] };
    const column = key => {
      const indices = aliases[key].map(alias => headers.indexOf(alias)).filter(i => i >= 0);
      if (indices.length > 1) fail('CSVに同じ意味の列が重複しています: ' + key);
      return indices[0] ?? -1;
    };
    const columns = Object.fromEntries(Object.keys(aliases).map(key => [key, column(key)]));
    const world = columns.longitude >= 0 && columns.latitude >= 0, local = columns.x >= 0 && columns.y >= 0;
    if (world === local || world !== (system === 'world') || world && (columns.x >= 0 || columns.y >= 0)
      || local && (columns.longitude >= 0 || columns.latitude >= 0)) fail('座標列が地図と一致しません。現実地図は longitude,latitude、創作地図は x,y を指定してください');
    const features = rows.map((row, index) => {
      if (row.length !== headers.length) fail(`CSVの${index + 2}行目の列数が一致しません`);
      const get = key => columns[key] < 0 ? '' : row[columns[key]];
      const point = (world ? ['longitude', 'latitude'] : ['x', 'y']).map(key => {
        const value = get(key).trim(); if (!value || !Number.isFinite(Number(value))) fail(`CSVの${index + 2}行目の座標が不正です`); return Number(value);
      });
      let tags = [];
      if (get('tags').trim().startsWith('[')) {
        try { tags = JSON.parse(get('tags')); } catch (_) { fail(`CSVの${index + 2}行目のタグが不正です`); }
        if (!Array.isArray(tags) || !tags.every(tag => typeof tag === 'string')) fail('タグは文字列の配列で指定してください');
      } else tags = get('tags').split('|').map(tag => tag.trim()).filter(Boolean);
      return properties(D.feature('pin', [point], 'places'), { name: get('name'), description: get('description'), color: get('color'), tags });
    });
    return { coordinate_system: system, features };
  }
  function readGeoJSON(source) {
    const data = JSON.parse(source);
    if (!data || typeof data !== 'object' || own(data, 'crs')) fail('WGS84のGeoJSONを指定してください');
    const entries = data.type === 'FeatureCollection' ? data.features : [data];
    if (!Array.isArray(entries) || entries.length > 10000) fail('GeoJSONの地物数が不正です');
    const features = []; let points = 0;
    const add = (kind, coordinates, props) => {
      if (!Array.isArray(coordinates)) fail('GeoJSONの座標が不正です');
      const pairs = coordinates.map(p => {
        if (!Array.isArray(p) || p.length < 2 || p.length > 3 || !p.every(Number.isFinite)) fail('GeoJSONの座標が不正です');
        return p.slice(0, 2);
      });
      points += pairs.length;
      if (points > MAX_POINTS || features.length >= 10000) fail('地物または頂点が多すぎます');
      features.push(properties(D.feature(kind, pairs, 'places'), props));
    };
    const geometry = (value, props) => {
      if (!value || typeof value !== 'object') fail('空のGeoJSON地物には対応していません');
      if (own(value, 'crs')) fail('WGS84以外のcrs指定は取り込めません');
      const c = value.coordinates;
      if (value.type === 'Point') add(props?.meldex_kind === 'label' ? 'label' : 'pin', [c], props);
      else if (value.type === 'LineString') add('route', c, props);
      else if (value.type === 'Polygon') {
        if (!Array.isArray(c) || c.length !== 1) fail('穴のある領域は現在取り込めません');
        const ring = c[0];
        if (!Array.isArray(ring) || ring.length < 4 || !Array.isArray(ring[0]) || !Array.isArray(ring[ring.length - 1])
          || ring[0].length !== ring[ring.length - 1].length || !ring[0].every((n, i) => n === ring[ring.length - 1][i])) fail('領域の輪郭が閉じられていません');
        add('region', ring.slice(0, -1), props);
      } else if (['MultiPoint', 'MultiLineString', 'MultiPolygon'].includes(value.type)) {
        if (!Array.isArray(c) || c.length > 10000) fail('GeoJSONの座標が不正です');
        for (const coordinates of c) geometry({ type: value.type.slice(5), coordinates }, props);
      } else fail('未対応のGeoJSON図形です: ' + text(value.type));
    };
    for (const entry of entries) {
      if (entry && typeof entry === 'object' && own(entry, 'crs')) fail('WGS84以外のcrs指定は取り込めません');
      if (entry?.type === 'Feature') geometry(entry.geometry, entry.properties || {});
      else if (data.type !== 'FeatureCollection') geometry(entry, {});
      else fail('FeatureCollectionにはFeatureを指定してください');
    }
    return { coordinate_system: 'world', features };
  }
  function readGPX(source) {
    if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(source)) fail('DTDや外部実体を含むGPXは取り込めません');
    const xml = new DOMParser().parseFromString(source, 'application/xml'), root = xml.documentElement;
    const ns = root?.namespaceURI;
    if (xml.getElementsByTagName('parsererror').length || root?.localName !== 'gpx' || !['1.0', '1.1'].includes(root.getAttribute('version'))
      || !['http://www.topografix.com/GPX/1/1', 'http://www.topografix.com/GPX/1/0'].includes(ns)) fail('GPX 1.0または1.1のファイルを指定してください');
    const children = (node, name) => Array.from(node.children).filter(child => child.localName === name && child.namespaceURI === ns);
    const value = (node, name) => children(node, name)[0]?.textContent || '';
    const features = []; let count = 0;
    const point = node => ['lon', 'lat'].map(key => {
      const raw = node.getAttribute(key); if (!raw?.trim() || !Number.isFinite(Number(raw))) fail('GPXの座標が不正です'); return Number(raw);
    });
    const add = (nodes, owner) => {
      if (!nodes.length) return;
      count += nodes.length;
      if (count > MAX_POINTS || features.length >= 10000) fail('地点または頂点が多すぎます');
      features.push(properties(D.feature(nodes.length === 1 ? 'pin' : 'route', nodes.map(point), 'places'), { name: value(owner, 'name'), description: value(owner, 'desc') }));
    };
    for (const node of children(root, 'wpt')) add([node], node);
    for (const node of children(root, 'rte')) add(children(node, 'rtept'), node);
    for (const node of children(root, 'trk')) for (const segment of children(node, 'trkseg')) add(children(segment, 'trkpt'), node);
    return { coordinate_system: 'world', features };
  }
  function read(source, format, system) {
    if (typeof source !== 'string' || source.length > MAX_TEXT) fail('8MB以下のファイルを指定してください');
    if (!['local', 'world'].includes(system)) fail('地図の座標系が不正です');
    source = source.replace(/^\uFEFF/, '');
    if (format === 'csv') return checked(readCSV(source, system));
    if (system !== 'world') fail('GeoJSON・GPXは「現実の地図」で取り込んでください');
    if (format === 'geojson' || format === 'json') return checked(readGeoJSON(source));
    if (format === 'gpx') return checked(readGPX(source));
    fail('CSV・GeoJSON・GPXを指定してください');
  }
  const escapeXML = value => String(value).replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]);
  function write(input, format) {
    const doc = D.parse(input), world = doc.coordinate_system === 'world';
    if (format !== 'csv' && !world) fail('GeoJSON・GPXは現実地図の座標だけを書き出せます');
    if (format === 'csv') {
      const quote = value => '"' + String(value).replace(/"/g, '""') + '"';
      const safe = value => /^[\s]*[=+\-@\t\r]/.test(value) ? "'" + value : value;
      const features = doc.features.filter(f => ['pin', 'label'].includes(f.kind));
      if (!features.length) fail('CSVへ書き出せる地点・文字がありません');
      const rows = [['name', ...(world ? ['longitude', 'latitude'] : ['x', 'y']), 'description', 'tags', 'color'],
        ...features.map(f => [safe(f.label), ...f.points[0], safe(f.description), JSON.stringify(f.tags), f.color])];
      return { text: '\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n', extension: '.csv', mime: 'text/csv', omitted: doc.features.length - features.length };
    }
    let count = 0;
    const path = f => {
      count += f.kind === 'route' && f.line_style === 'curve' && f.points.length >= 3 ? 1 + 12 * (f.points.length - 1) : f.points.length;
      if (count > MAX_POINTS) fail('書き出す頂点が多すぎます。図形を減らしてください');
      return D.drawPoints(f, doc).map(normalize);
    };
    if (format === 'geojson') {
      const features = doc.features.map(f => {
        let coordinates = path(f), type = 'LineString';
        if (['pin', 'label'].includes(f.kind)) { type = 'Point'; coordinates = coordinates[0]; }
        else if (f.kind === 'region') {
          type = 'Polygon';
          const unwrapped = D.drawPoints(f, doc);
          const area = unwrapped.reduce((sum, p, i) => { const q = unwrapped[(i + 1) % unwrapped.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
          if (area < 0) coordinates.reverse();
          coordinates = [[...coordinates, coordinates[0].slice()]];
        }
        return { type: 'Feature', properties: { name: f.label, description: f.description, tags: f.tags, color: f.color, meldex_kind: f.kind }, geometry: { type, coordinates } };
      });
      return { text: JSON.stringify({ type: 'FeatureCollection', features }, null, 2), extension: '.geojson', mime: 'application/geo+json', omitted: 0 };
    }
    if (format === 'gpx') {
      const name = f => '<name>' + escapeXML(f.label) + '</name><desc>' + escapeXML(f.description) + '</desc>';
      const pt = (tag, p, body = '') => `<${tag} lat="${p[1]}" lon="${p[0]}">${body}</${tag}>`;
      const waypoints = doc.features.filter(f => ['pin', 'label'].includes(f.kind)).map(f => pt('wpt', path(f)[0], name(f)));
      const tracks = doc.features.filter(f => f.kind === 'route').map(f => '<trk>' + name(f) + '<trkseg>' + path(f).map(p => pt('trkpt', p)).join('') + '</trkseg></trk>');
      if (!waypoints.length && !tracks.length) fail('GPXへ書き出せる地点・経路がありません');
      return { text: '<?xml version="1.0" encoding="UTF-8"?>\n<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="Meldex">' + waypoints.join('') + tracks.join('') + '</gpx>', extension: '.gpx', mime: 'application/gpx+xml', omitted: doc.features.filter(f => f.kind === 'region').length };
    }
    fail('未対応の書き出し形式です');
  }
  return Object.freeze({ read, write });
});
