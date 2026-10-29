/* A location remains a string candidate; map paths use the existing link metadata. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MeldexLocationData = api;
})(globalThis, function () {
  'use strict';
  const safePath = path => typeof path === 'string' && !!path && !path.includes('\0')
    && (!/^[a-z][a-z\d+.-]*:/i.test(path) || /^[a-z]:[\\/]/i.test(path));
  const pathKey = path => String(path || '').replace(/\\/g, '/').replace(/\/$/, '');
  function canonicalPath(path, vaultPath) {
    const value = pathKey(path), root = pathKey(vaultPath);
    if (root && value.toLocaleLowerCase().startsWith(root.toLocaleLowerCase() + '/')) return value.slice(root.length + 1);
    return value;
  }
  function parse(value, link = null) {
    if (typeof value !== 'string' || value.length > 65536) throw new Error('場所の値は64KB以下の文字列で指定してください');
    const loc = JSON.parse(value);
    if (!loc || loc.fileType !== 'meldex-location' || loc.schema_version !== 1) throw new Error('未対応の場所形式です');
    const world = loc.coordinate_system === 'world';
    if (!['world', 'local'].includes(loc.coordinate_system) || typeof loc.label !== 'string'
      || !Array.isArray(loc.point) || loc.point.length !== 2 || !loc.point.every(Number.isFinite)
      || (world ? Math.abs(loc.point[0]) > 180 || Math.abs(loc.point[1]) > 85.051129 : loc.point.some(n => Math.abs(n) > 1e7))
      || loc.map_id != null && (typeof loc.map_id !== 'string' || !loc.map_id)
      || loc.feature_id != null && (typeof loc.feature_id !== 'string' || !loc.feature_id)) throw new Error('場所の座標または地図の指定が不正です');
    if (loc.map_id) {
      if (!safePath(link?.path) || !link.path.toLowerCase().endsWith('.mel-map')) throw new Error('場所の参照先マップが必要です');
    } else if (!world || loc.feature_id || link?.path) throw new Error('創作座標には参照先マップを指定してください');
    return loc;
  }
  function encode(loc, link) { const value = JSON.stringify(loc); parse(value, link); return value; }
  function resolve(loc, link, doc, path) {
    if (loc.coordinate_system !== doc.coordinate_system) return null;
    if (loc.map_id && loc.map_id !== doc.meldex?.document_id) return null;
    if (loc.feature_id) {
      const feature = doc.features.find(f => f.id === loc.feature_id);
      if (!feature || !['pin', 'label'].includes(feature.kind)) return null;
      return feature.points[0].slice();
    }
    return loc.point.slice();
  }
  return Object.freeze({ parse, encode, resolve, safePath, pathKey, canonicalPath });
});
