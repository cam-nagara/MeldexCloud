    'Wordとして保存': 'download',
    'シナリオ形式として保存': 'download',
    '勤怠CSVとして保存': 'download',
    '辞書ファイルを出力': 'download',
    'シフト、実績、作業予定を書き出す': 'download',
    'PNG画像として保存': 'image',
    '画像（PNG）として保存': 'image',
    'SVG画像として保存': 'image',
    'B-MANGAへ送信': 'send',
    'CLIP STUDIO PAINTへ送信': 'send',
    'アーカイブ管理': 'archive',
    'シートに変換': 'db',
    'シートから一括読込': 'db',
    'テンプレート': 'layoutTemplate',
    'シートテンプレート': 'layoutTemplate',
    'ノートテンプレート': 'layoutTemplate',
    '新規トピックのノートテンプレート': 'layoutTemplate',
    'テンプレートに登録': 'bookmarkPlus',
    '現在のノートからテンプレートを作成': 'layoutTemplate',
    '現在のシナリオからテンプレートを作成': 'layoutTemplate',
    '現在のシートからテンプレートを作成': 'layoutTemplate',
    '現在のボードからテンプレートを作成': 'layoutTemplate',
    'シート横断検索': 'databaseSearch',
    '整合性検証': 'shieldCheck',
    '検証ルール管理': 'listChecks',
    '列の表示と順序': 'columns',
    '列を追加': 'columns',
    '行を追加': 'rows3',
    '公開設定': 'globe',
    '公開を更新': 'refreshCw',
    '新規イベント': 'calendarPlus',
    '同期設定': 'calendarSync',
    '新規リンクトピック: ノート': 'link2',
    '新規リンクトピック: シート': 'link2',
    '新規リンクトピック: ボード': 'link2',
    '既存ファイルへのリンクトピック': 'link2',
    'ツール': 'wrench',
    '重複画像を検出': 'scanSearch',
    'このフォルダで重複検出': 'scanSearch',
    '画像インデックスを作成': 'fileSearch',
    'このフォルダのインデックス作成': 'fileSearch',
    'この階層を閉じる': 'chevronsDownUp',
    'リネーム': 'pencil',
    'パスを変更': 'folderPen',
    'ワークスペースの管理': 'settings',
    'システム保護': 'shield',
    'プロパティ': 'info',
    'チャットを開く': 'messageSquare',
    '比較': 'columns',
  });
  // 色見本が先頭に付く行（色設定）は色見本をアイコンとして扱う。読み込み中の一時表示は付けない。
  const ICONLESS = Object.freeze(new Set(['(なし)', '（なし）', '設定する', '解除する', 'OS メニュー 読み込み中']));

  function normalizeLabel(label) {
    let text = String(label ?? '').replace(/\s+/g, ' ').trim();
    text = text.replace(/^[✓✔]\s*/, '');
    text = text.replace(/(?:\.\.\.|…)$/, '').trim();
    text = text.replace(/\s*[（(][^（）()]*(?:件|枚)[）)]$/, '').trim();
    return text;
  }

  function resolve(label) {
    const key = normalizeLabel(label);
    if (!key || ICONLESS.has(key)) return '';
    return ICONS[key] || '';
  }

  // 既に描画済みのメニューで、アイコンの無い項目へ対応表のアイコンを足す。
  // 位置合わせの共通処理（positionPopup / clampPopupToViewport）から呼ばれる。何度呼んでもよい。
  function decorate(menu) {
    if (!menu?.querySelectorAll || typeof lucide !== 'function') return;
    if (!menu.matches?.('.gb-context-menu, .ab-dropdown') && !menu.querySelector?.('.gb-context-menu-item')) return;
    menu.querySelectorAll('.gb-context-menu-item, .ab-dropdown-item').forEach((row) => {
      if (row.dataset.menuIconResolved === '1') return;
      row.dataset.menuIconResolved = '1';
      if (row.querySelector('svg, img, .menu-icon, [data-icon], .gb-color-swatch')) return;
      const labelEl = row.querySelector('.menu-label');
      const name = resolve(labelEl ? labelEl.textContent : row.textContent);
      if (!name) return;
      const icon = document.createElement('span');
      icon.className = 'menu-icon';
      icon.dataset.menuIconSource = 'shared';
      icon.innerHTML = lucide(name, 14);
      row.insertBefore(icon, row.firstChild);
    });
  }

  if (typeof window !== 'undefined') {
    window.MeldexMenuIcons = Object.freeze({ icons: ICONS, iconless: ICONLESS, normalizeLabel, resolve, decorate });
  }
})();

// アノテートの塗りの透け具合（2026-11-27）。以前の塗り（投げ縄・矩形塗り・円形塗り）は、保存した
// 不透明度に0.4（描画中は0.2）を掛けて必ず半透明で描いていた。新しい塗りは data.opacityModel に
// 'color-alpha-v1' を持ち、色そのものの不透明度（共通カラーパレットで選ぶ）だけで描く。
// 印のない既存の塗りは、以前と同じ見た目のまま描く（読む時に解釈し、保存し直さない）。
const MELDEX_ANNOTATION_OPACITY_MODEL = 'color-alpha-v1';
const _MELDEX_ANNOTATION_FILL_TYPES = new Set(['lasso', 'rect', 'ellipse-fill']);
function _annotationUsesColorAlpha(data) {
  return !!data && typeof data === 'object' && data.opacityModel === MELDEX_ANNOTATION_OPACITY_MODEL;
}
function _annotationFillOpacity(data, opacity, preview) {
  const value = _normalizeCoreAnnotationOpacity(opacity, 1);
  return _annotationUsesColorAlpha(data) ? value : value * (preview ? 0.2 : 0.4);
}
function _annotationColorAlpha(color) {
  if (typeof parseColorToHexAlpha === 'function') return parseColorToHexAlpha(color).alpha;
  const match = /^#(?:[0-9a-f]{6})([0-9a-f]{2})$/i.exec(String(color || '').trim());
  return match ? parseInt(match[1], 16) / 255 : 1;
}
function _annotationColorWithAlpha(color, alpha) {
  const value = Math.max(0, Math.min(1, Number(alpha)));
  if (typeof parseColorToHexAlpha === 'function' && typeof hexAlphaToRgba === 'function') {
    const parsed = parseColorToHexAlpha(color);
    if (/^#[0-9a-f]{6}$/i.test(parsed.hex)) return hexAlphaToRgba(parsed.hex.toLowerCase(), Math.round(value * 1000) / 1000);
  }
  return color;
}
function _parseCoreAnnotationData(row) {
  const raw = row?.data;
  if (raw && typeof raw === 'object') return raw;
  try { const parsed = JSON.parse(raw || '{}'); return parsed && typeof parsed === 'object' ? parsed : {}; } catch { return {}; }
}
// 描いた後の色の変更（右クリックの「色...」）で、パレットに最初に出す色。今の見た目の透け具合を色に含める。
function _annotationRecolorInitialColor(row) {
  const data = _parseCoreAnnotationData(row);
  const opacity = _normalizeCoreAnnotationOpacity(row?.opacity, 1);
  const color = row?.color || '#c48080';
  if (row?.type === 'marker') return _annotationColorWithAlpha(color, _annotationColorAlpha(color) * opacity * 0.5);
  // 以前の文字のハイライトは色を42%に薄めて描いていた
  if (row?.type === 'highlight' && !_annotationUsesColorAlpha(data)) return _annotationColorWithAlpha(color, _annotationColorAlpha(color) * 0.42);
  if (_MELDEX_ANNOTATION_FILL_TYPES.has(row?.type) && !_annotationUsesColorAlpha(data)) {
    return _annotationColorWithAlpha(color, _annotationColorAlpha(color) * opacity * 0.4);
  }
  return color;
}
// 色の変更で保存する差分。以前のマーカーは通常の線（stroke）へ、以前の塗りは色の不透明度で描く形へ移す
// （保存し直すのは利用者が色を変えたこの時だけ）。どちらも見た目の透け具合は色に引き継ぐ。
function _annotationRecolorUpdate(row, color) {
  const data = _parseCoreAnnotationData(row);
  if (row?.type === 'marker') return { type: 'stroke', color, opacity: 1, data: { ...data, opacityModel: MELDEX_ANNOTATION_OPACITY_MODEL } };
  if (row?.type === 'highlight' && !_annotationUsesColorAlpha(data)) {
    return { color, opacity: 1, data: { ...data, opacityModel: MELDEX_ANNOTATION_OPACITY_MODEL } };
  }
  if (_MELDEX_ANNOTATION_FILL_TYPES.has(row?.type) && !_annotationUsesColorAlpha(data)) {
    return { color, opacity: 1, data: { ...data, opacityModel: MELDEX_ANNOTATION_OPACITY_MODEL } };
  }
  return { color };
}
// 色を選んでいる間の見た目（保存は閉じた時）。row は色を変えた後の行。
function _paintAnnotationRecolorPreview(el, row) {
  if (!el || !row) return;
  const data = _parseCoreAnnotationData(row);
  const opacity = _normalizeCoreAnnotationOpacity(row.opacity, 1);
  const parts = el.matches?.('path,polygon,rect,ellipse') ? [el] : [...(el.querySelectorAll?.('path,polygon,rect,ellipse') || [])];
  parts.forEach(part => {
    part.setAttribute('stroke', row.color);
    part.setAttribute('stroke-opacity', String(row.type === 'marker' ? opacity * 0.5 : opacity));
    const fill = part.getAttribute('fill');
    if (fill && fill !== 'none') {
      part.setAttribute('fill', row.color);
      part.setAttribute('fill-opacity', String(_annotationFillOpacity(data, opacity, false)));
    }
  });
}
if (typeof window !== 'undefined') {
  Object.assign(window, { MELDEX_ANNOTATION_OPACITY_MODEL, _annotationUsesColorAlpha, _annotationFillOpacity,
    _annotationColorWithAlpha, _annotationRecolorInitialColor, _annotationRecolorUpdate, _paintAnnotationRecolorPreview });
}
