/* Annotation snapshots are described as readable text in main and standalone views. */
(function (global) {
  'use strict';

function format(snapshot) {
  if (!snapshot) return '';
  if (Array.isArray(snapshot)) snapshot = { targets: { annotations: snapshot } };
  const lines = [];
  for (const rows of Object.values(snapshot.targets || {})) for (const row of rows) {
    let data = row.data || {};
    try { if (typeof data === 'string') data = JSON.parse(data); } catch { data = {}; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
    const kind = data.highlight || row.type === 'highlight' ? 'ハイライト'
      : row.shape === 'sticky' || data.noteType === 'sticky' ? '付箋'
      : ({comment:'コメント',note:'付箋',sticky:'付箋',screenshot:'スクリーンショット',stroke:'線',pen:'ペン',
          marker:'マーカー',rect:'矩形','rect-line':'矩形の線','ellipse-line':'楕円の線','ellipse-fill':'楕円塗り',
          polyline:'折れ線',lasso:'投げ縄'})[row.type] || '描画';
    const text = String(row.body || data.text || '').replace(/\r\n?/g,'\n');
    const area = ['x','y','width','height'].filter(key => data[key] != null).map(key => Number(data[key]).toFixed(1)).join(', ');
    const points = Array.isArray(data.points) ? data.points.filter(Array.isArray).map(point => point.map(value => Number(value).toFixed(1)).join(',')).join(' / ') : '';
    lines.push(`${kind} [${String(row.id).slice(0,8)}] ${text} ／色 ${row.color || '指定なし'} ／濃さ ${row.opacity ?? 1}`
      + (data.pageIndex != null ? ` ／${data.pageIndex+1}ページ` : '') + (area ? ` ／範囲 ${area}` : '')
      + (points ? ` ／線の位置 ${points}` : '') + (data.boxes ? ' ／文字の範囲 '+JSON.stringify(data.boxes) : '')
      + (data.textAnchor ? ' ／文字の位置 '+data.textAnchor.start+'〜'+data.textAnchor.end : ''));
  }
  return '\n\nアノテート ('+lines.length+'件)\n'+(lines.join('\n') || 'なし')+'\n';
}


  global.MeldexAnnotationSnapshotText = Object.freeze({ format });
})(window);
