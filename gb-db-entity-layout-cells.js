/* gb-db-entity-layout-cells.js: エントリレイアウトのセル内容の描画とセル設定UI。
   - field: 列キャプション（ユーザー設定アイコン or 列タイプアイコン + 列名）+ 値（列一覧と同じ
     既存の値エディタ createTypedValueElement / createValueElement を共通ヘルパー経由で再利用）。
   - label: 自由テキスト（編集モードでダブルクリックすると直接編集）。
   - divider: 罫線（縦横はセルの縦横比で自動判定。色は設定で変更可）。
   - image: アップロード画像（/media/upload、シートの添付フォルダへ保存）または
     アイコンセット（GBIconAssets の Lucide/Noto絵文字）。HTML書き出しの embedImages() と
     噛み合うよう、常に <img> タグとして描画する（アイコンはSVGデータURIへラスタライズ）。
   - セルの文字書式は既存の汎用書式ポップアップ（openFormatPopup）をそのまま流用する。
   - 配色テーマ: レイアウト単位の --el-* ローカルCSS変数。未設定時は Meldex 現在のテーマへ
     追従する（var() フォールバック）。ユーザーが色を選んだトークンだけ固定される。
   - 編集モード中はセル内容を不活性にし、ドラッグ操作と値編集が競合しないようにする（CSS側）。
   chart セルは Phase D で追加する。 */
'use strict';

/* 列のキャプション用アイコンHTML。ユーザーが列に設定したアイコン（property_types[prop].icon、
   GBIconAssets の spec 文字列）があればそれを優先し、無ければ列タイプのアイコンを出す。 */
function _elPropIconHtml(propName, propTypes, size) {
  const px = size || 14;
  const userIcon = propTypes?.[propName]?.icon;
  if (userIcon && typeof GBIconAssets !== 'undefined' && GBIconAssets?.render) {
    return '<span class="el-prop-icon" aria-hidden="true">' + GBIconAssets.render(userIcon, px) + '</span>';
  }
  if (typeof lucide === 'function' && typeof getPropertyTypeIcon === 'function') {
    return '<span class="el-prop-icon" aria-hidden="true">'
      + lucide(getPropertyTypeIcon(propTypes?.[propName]?.type), px) + '</span>';
  }
  return '';
}

/* field セル: 列キャプション + 値エディタ。値の描画は列一覧（renderEntityPropsGridInto）と
   同じ共通ヘルパー renderEntityPropValuesInto を使い、見た目と編集挙動を揃える。 */
function _elBuildFieldCellContent(cell, ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'el-cell-content';
  const propName = String(cell.prop || '');

  const caption = document.createElement('div');
  caption.className = 'el-cell-caption';
  caption.innerHTML = _elPropIconHtml(propName, ctx.propTypes, 13);
  const captionText = document.createElement('span');
  captionText.className = 'el-cell-caption-text';
  captionText.textContent = propName || '(列未設定)';
  caption.appendChild(captionText);
  wrap.appendChild(caption);

  const body = document.createElement('div');
  body.className = 'el-cell-body cell-values';
  if (propName && ctx.data?.properties && Object.prototype.hasOwnProperty.call(ctx.data.properties, propName)) {
    if (typeof renderEntityPropValuesInto === 'function') {
      renderEntityPropValuesInto(body, propName, ctx.data, ctx.entityPath, ctx.propTypes, { readOnly: ctx.readOnly === true });
    } else {
      const values = Array.isArray(ctx.data.properties[propName]) ? ctx.data.properties[propName] : [];
      values.forEach(val => {
        const div = document.createElement('div');
        div.className = 'cell-value';
        div.textContent = val?.value != null ? String(val.value) : '';
        body.appendChild(div);
      });
    }
  } else if (propName) {
    const missing = document.createElement('div');
    missing.className = 'el-cell-missing';
    missing.textContent = 'この列はシートにありません: ' + propName;
    body.appendChild(missing);
  }
  wrap.appendChild(body);
  return wrap;
}

/* label セル: 固定テキスト（見出し・キャプション）。編集はダブルクリック（canvas側で配線）。 */
function _elBuildLabelCellContent(cell, ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'el-cell-content el-cell-label-content';
  const body = document.createElement('div');
  body.className = 'el-cell-body el-label-text';
  body.textContent = String(cell.text || '');
  if (!cell.text && ctx.editMode) {
    body.classList.add('el-label-empty');
    body.textContent = 'ダブルクリックで編集';
  }
  wrap.appendChild(body);
  return wrap;
}

/* divider セル: 罫線。横長なら水平線、縦長なら垂直線として描く。 */
function _elBuildDividerCellContent(cell, ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'el-cell-content el-cell-divider-content';
  const line = document.createElement('div');
  line.className = 'el-divider-line ' + (cell.w >= cell.h ? 'el-divider-h' : 'el-divider-v');
  if (cell.lineColor) line.style.background = cell.lineColor;
  wrap.appendChild(line);
  return wrap;
}

/* アイコンspecを <img src> 用のSVGデータURIへラスタライズする。
   色は描画時点のキャンバス実効色（テーマ）を焼き込む（書き出しでもそのまま使えるようにするため）。 */
function _elIconDataUri(spec, color) {
  if (typeof GBIconAssets === 'undefined' || !GBIconAssets?.parseSpec) return '';
  const parsed = GBIconAssets.parseSpec(spec);
  const esc = MeldexEscape.xml;
  if (parsed?.type === 'noto') {
    const emoji = parsed.emoji || (GBIconAssets.codeToEmoji ? GBIconAssets.codeToEmoji(parsed.code) : '') || '?';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">'
      + '<text x="64" y="78" text-anchor="middle" dominant-baseline="middle" '
      + 'font-family="Meldex Noto Emoji, Noto Color Emoji, Segoe UI Emoji, Apple Color Emoji, sans-serif" '
      + 'font-size="100">' + esc(emoji) + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  if (parsed?.type === 'lucide' && typeof lucide === 'function') {
    let markup = lucide(parsed.name, 96) || '';
    if (!markup) return '';
    if (!markup.includes('xmlns=')) markup = markup.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    // 単体SVG化すると currentColor が黒へ落ちるため、実効色を明示的に焼き込む
    markup = markup.replace(/currentColor/g, esc(color || '#9aa0a6'));
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
  }
  return '';
}

/* image セル: source 'upload'（シート添付フォルダの画像）/ 'icon'（アイコンセット）。
   いずれも <img> として描画する（HTML書き出しの embedImages() 対象にするため。背景画像方式は使わない）。 */
function _elBuildImageCellContent(cell, ctx, canvasEl) {
  const wrap = document.createElement('div');
  wrap.className = 'el-cell-content el-cell-image-content';
  const image = _elIsObj(cell.image) ? cell.image : {};
  let src = '';
  if (image.source === 'icon' && image.spec) {
    const effectiveFg = image.color
      || (canvasEl ? getComputedStyle(canvasEl).color : '') || '#9aa0a6';
    src = _elIconDataUri(image.spec, effectiveFg);
  } else if (typeof image.dataUri === 'string' && image.dataUri.startsWith('data:')) {
    // テンプレートへ同梱された画像（gb-db-template-entity-layouts.js）。パスが無くてもそのまま表示できる
    src = image.dataUri;
  } else if (image.path || image.url) {
    src = (typeof fileRawUrl === 'function' && image.path) ? fileRawUrl(image.path) : (image.url || '');
  }
  if (!src) {
    const empty = document.createElement('div');
    empty.className = 'el-cell-placeholder';
    empty.textContent = ctx.editMode ? '画像未設定（歯車ボタンで選択）' : '';
    wrap.appendChild(empty);
    return wrap;
  }
  const img = document.createElement('img');
  img.className = 'el-cell-image';
  img.src = src;
  img.alt = String(image.alt || cell.type || '');
  img.draggable = false;
  img.style.objectFit = image.fit === 'cover' ? 'cover' : 'contain';
  wrap.appendChild(img);
  window.MeldexImageLoading?.track?.(img, { host: wrap, label: '画像を読み込んでいます', allowDetached: true });
  return wrap;
}

/* セル内容のディスパッチ。未実装タイプはタイプ名のプレースホルダを出す
   （通常は到達しない。テンプレート適用等で先行データが来ても壊れないための保険）。 */
function _elBuildCellContent(cell, ctx, canvasEl) {
  if (cell.type === 'field') return _elBuildFieldCellContent(cell, ctx);
  if (cell.type === 'label') return _elBuildLabelCellContent(cell, ctx);
  if (cell.type === 'divider') return _elBuildDividerCellContent(cell, ctx);
  if (cell.type === 'image') return _elBuildImageCellContent(cell, ctx, canvasEl);
  if (cell.type === 'chart' && typeof _elBuildChartCellContent === 'function') {
    return _elBuildChartCellContent(cell, ctx, canvasEl);
  }
  const placeholder = document.createElement('div');
  placeholder.className = 'el-cell-content el-cell-placeholder';
  placeholder.textContent = cell.type;
  return placeholder;
}

/* --- セルの見た目（書式）の適用 --- */

/* cell.style（openFormatPopup と同じプロパティ名で保存）をセル要素へ反映する。 */
function _elApplyCellStyle(el, cell) {
  const s = _elIsObj(cell.style) ? cell.style : {};
  if (s.bgColor) el.style.background = s.bgColor;
  if (s.textColor) el.style.color = s.textColor;
  if (s.fontSize) el.style.fontSize = _elClampNum(s.fontSize, 6, 200, 13) + 'px';
  if (s.fontFamily) el.style.fontFamily = s.fontFamily;
  if (s.fontWeight) el.style.fontWeight = s.fontWeight;
  if (s.fontStyle) el.style.fontStyle = s.fontStyle;
  const deco = [];
  if (s.underline) deco.push('underline');
  if (s.strike) deco.push('line-through');
  if (deco.length) el.style.textDecoration = deco.join(' ');
  if (Number(s.textStrokeWidth) > 0) {
    el.style.webkitTextStroke = Number(s.textStrokeWidth) + 'px ' + (s.textStrokeColor || 'currentColor');
  }
  if (s.textAlign) el.style.textAlign = s.textAlign;
}

/* 長文の自動フィット（要望10）: セルに収まらない場合、切り詰めずにフォントサイズを
   段階的に縮小して収める。下限(8px)でも収まらない場合はスクロール（CSS側のoverflow）が最終手段。 */
function _elAutoFitCellText(el, cell) {
  if (cell.style?.autoFit === false) return;
  if (cell.type !== 'field' && cell.type !== 'label') return;
  const body = el.querySelector('.el-cell-body');
  if (!body || !body.isConnected || body.clientHeight === 0) return;
  body.style.fontSize = '';
  const base = parseFloat(getComputedStyle(body).fontSize) || 13;
  let size = base;
  let guard = 60;
  while (guard-- > 0 && size > 8
    && (body.scrollHeight > body.clientHeight + 1 || body.scrollWidth > body.clientWidth + 1)) {
    size -= 1;
    body.style.fontSize = size + 'px';
  }
}

/* --- セル設定（書式ポップアップ / 画像ソース / 罫線色） --- */

const EL_FORMAT_FIELDS = [
  'textColor', 'fontSize', 'fontFamily', 'bold', 'italic', 'underline',
  'textStrokeColor', 'textStrokeWidth', 'bgColor', 'textAlign',
];

function _elOpenCellFormatPopup(anchorEl, cell, ctx, cellEl) {
  if (typeof openFormatPopup !== 'function') {
    if (typeof showStatus === 'function') showStatus('書式設定を利用できません', true);
    return;
  }
  const values = { ..._elIsObj(cell.style) ? cell.style : {} };
  // カラーパレットのドラッグは中間色ごとに onChange が飛ぶため、永続化（+取り消し履歴）は
  // 300msのデバウンスで1回にまとめる。画面への反映だけライブで行う。
  let persistTimer = null;
  const flushPersist = () => {
    persistTimer = null;
    if (!ctx.grid?.isConnected) return;
    const drawer = ctx.grid.closest?.('#cloud-mobile-side-drawer');
    if (drawer && !drawer.classList.contains('open')) return;
    const blocked = (typeof _elCanMutateGrid === 'function' && !_elCanMutateGrid(ctx.grid, ctx.options))
      || (typeof _cellUiRuntimeReadOnly === 'function' && _cellUiRuntimeReadOnly(ctx.grid));
    if (blocked) {
      // 表示中に容量停止へ変わった場合も、ライブ反映済みの書式下書きを捨てない。
      // 同じ画面で解除された時だけ保存を再開し、画面を閉じた場合は破棄する。
      persistTimer = setTimeout(flushPersist, 120);
      return;
    }
    const snapshot = { ..._elIsObj(cell.style) ? cell.style : {} };
    _elPersistCellPatch(ctx, cell, 'エントリレイアウト: セル書式', (target) => {
      target.style = snapshot;
    });
  };
  openFormatPopup(anchorEl, {
    fields: EL_FORMAT_FIELDS,
    values,
    onReset: () => {
      if (typeof _elCanMutateGrid === 'function' && !_elCanMutateGrid(ctx.grid, ctx.options)) return;
      if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
      _elPersistCellPatch(ctx, cell, 'エントリレイアウト: セル書式リセット', (target) => { target.style = {}; });
      ctx.rerender();
    },
    onChange: (prop, value) => {
      if (typeof _elCanMutateGrid === 'function' && !_elCanMutateGrid(ctx.grid, ctx.options)) return;
      if (value === '' || value == null || value === false) delete cell.style?.[prop];
      else { if (!_elIsObj(cell.style)) cell.style = {}; cell.style[prop] = value; }
      // ポップアップを開いたまま即時反映（再描画はしない）
      if (cellEl?.isConnected) {
        cellEl.removeAttribute('style');
        cellEl.style.left = cell.x + 'px';
        cellEl.style.top = cell.y + 'px';
        cellEl.style.width = cell.w + 'px';
        cellEl.style.height = cell.h + 'px';
        _elApplyCellStyle(cellEl, cell);
        _elAutoFitCellText(cellEl, cell);
      }
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(flushPersist, 300);
    },
  });
}

/* セル1件へのパッチを永続化する共通ヘルパー */
function _elPersistCellPatch(ctx, cell, label, mutator) {
  if (typeof _elCanMutateGrid === 'function' && !_elCanMutateGrid(ctx.grid, ctx.options)) return null;
  return ctx.persist(label, cell.type, (layout) => {
    const target = layout.cells.find(c => c.id === cell.id);
    if (!target) return false;
    mutator(target);
  });
}

/* 画像ソースを切り替えるときは、以前テンプレートへ同梱された dataUri を持ち越さない。
   dataUri は表示時に path/url より優先されるため、残すとアップロード後も古い画像が出続ける。 */
function _elMergeImagePatch(currentImage, imagePatch) {
  const next = { ..._elIsObj(currentImage) ? currentImage : {}, ..._elIsObj(imagePatch) ? imagePatch : {} };
  if (Object.prototype.hasOwnProperty.call(imagePatch || {}, 'source')
    && !Object.prototype.hasOwnProperty.call(imagePatch || {}, 'dataUri')) {
    delete next.dataUri;
  }
  return next;
}

/* 画像セルのソース設定ポップアップ（アップロード / アイコン / 表示方法） */
function _elShowImageCellPopup(anchorBtn, ctx, existingCell) {
  _elCloseEditPopups();
  const popup = document.createElement('div');
  popup.className = 'gb-context-menu el-edit-popup el-image-popup';
  popup.dataset.e2eId = 'entity-layout-image-popup';

  const title = document.createElement('div');
  title.className = 'el-popup-title';
  title.textContent = existingCell ? '画像セルの設定' : '画像セルを追加';
  popup.appendChild(title);

  const applyImage = (imagePatch) => {
    if (typeof _elCanMutateGrid === 'function' && !_elCanMutateGrid(ctx.grid, ctx.options)) return;
    if (existingCell) {
      _elPersistCellPatch(ctx, existingCell, 'エントリレイアウト: 画像変更', (target) => {
        target.image = _elMergeImagePatch(target.image, imagePatch);
      });
    } else {
      _elAddCell(ctx, { type: 'image', w: 180, h: 180, image: { fit: 'contain', ...imagePatch } }, '画像');
      return;
    }
    ctx.rerender();
  };

  const uploadBtn = document.createElement('button');
  uploadBtn.type = 'button';
  uploadBtn.className = 'el-tab-menu-item';
  uploadBtn.dataset.e2eId = 'entity-layout-image-upload';
  uploadBtn.innerHTML = (typeof lucide === 'function' ? lucide('image', 13) : '') + '<span>画像をアップロード</span>';
  uploadBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (typeof _elCanMutateGrid === 'function' && !_elCanMutateGrid(ctx.grid, ctx.options)) return;
      close();
      try {
        const meta = await _elUploadLayoutImage(file, ctx);
        if (typeof _elCanMutateGrid === 'function' && !_elCanMutateGrid(ctx.grid, ctx.options)) return;
        applyImage({ source: 'upload', path: meta.path || '', url: meta.url || '', spec: '', alt: meta.filename || file.name });
        if (typeof showStatus === 'function') showStatus('画像を設定しました');
      } catch (error) {
        if (typeof showStatus === 'function') showStatus('画像のアップロードに失敗しました: ' + (error?.message || error), true);
      }
    });
    input.click();
  });
  popup.appendChild(uploadBtn);

  const iconBtn = document.createElement('button');
  iconBtn.type = 'button';
  iconBtn.className = 'el-tab-menu-item';
  iconBtn.dataset.e2eId = 'entity-layout-image-icon';
  iconBtn.innerHTML = (typeof lucide === 'function' ? lucide('palette', 13) : '') + '<span>アイコンから選ぶ</span>';
  iconBtn.addEventListener('click', () => {
    if (typeof GBIconAssets === 'undefined' || !GBIconAssets?.openPicker) return;
    close();
    GBIconAssets.openPicker({
      anchorEl: anchorBtn,
      title: '画像セルのアイコン',
      current: existingCell?.image?.spec || '',
      onSelect: (spec) => {
        applyImage({ source: 'icon', spec: spec || '', path: '', url: '' });
      },
    });
  });
  popup.appendChild(iconBtn);

  if (existingCell) {
    const fitBtn = document.createElement('button');
    fitBtn.type = 'button';
    fitBtn.className = 'el-tab-menu-item';
    fitBtn.dataset.e2eId = 'entity-layout-image-fit';
    const cover = existingCell.image?.fit === 'cover';
    fitBtn.innerHTML = (typeof lucide === 'function' ? lucide('maximize', 13) : '') + '<span>'
      + (cover ? '全体を表示（余白あり）に切替' : 'セル全体に敷き詰めに切替') + '</span>';
    fitBtn.addEventListener('click', () => {
      close();
      applyImage({ fit: cover ? 'contain' : 'cover' });
    });
    popup.appendChild(fitBtn);
  }

  const close = _elAttachPopupCommon(popup, anchorBtn);
}

/* レイアウト用画像のアップロード。画像型列と同じ /media/upload（sheet_pathスコープ）を使い、
   シートの添付フォルダへ保存する。 */
async function _elUploadLayoutImage(file, ctx) {
  const fd = new FormData();
  fd.append('file', file);
  if (ctx.dbPath) fd.append('sheet_path', ctx.dbPath);
  const headers = typeof _attachmentUploadHeaders === 'function' ? _attachmentUploadHeaders() : undefined;
  const base = typeof API_BASE !== 'undefined' ? API_BASE : '/api';
  const res = await fetch(base + '/media/upload', { method: 'POST', body: fd, headers });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const meta = await res.json();
  if (!meta || meta.ok === false) throw new Error(meta?.error || 'アップロードに失敗しました');
  return meta;
}

/* 罫線セルの色設定 */
function _elShowDividerColorPopup(anchorBtn, ctx, cell) {
  if (typeof openColorPalette !== 'function') return;
  openColorPalette(anchorBtn, cell.lineColor || '', (color) => {
    if (typeof _elCanMutateGrid === 'function' && !_elCanMutateGrid(ctx.grid, ctx.options)) return;
    _elPersistCellPatch(ctx, cell, 'エントリレイアウト: 罫線の色', (target) => {
      if (color) target.lineColor = color;
      else delete target.lineColor;
    });
    ctx.rerender();
  });
}

/* セルの設定入口（歯車ボタン）。タイプ別に適切な設定UIを開く。 */
function _elOpenCellSettings(anchorBtn, cell, ctx, cellEl) {
  if (cell.type === 'image') {
    _elShowImageCellPopup(anchorBtn, ctx, cell);
    return;
  }
  if (cell.type === 'divider') {
    _elShowDividerColorPopup(anchorBtn, ctx, cell);
    return;
  }
  if (cell.type === 'chart') {
    if (typeof _elShowChartCellPopup === 'function') _elShowChartCellPopup(anchorBtn, ctx, cell);
    return;
  }
  _elOpenCellFormatPopup(anchorBtn, cell, ctx, cellEl);
}

/* --- レイアウト単位の配色テーマ（要望9） --- */

const EL_THEME_TOKENS = [
  { key: 'bg', label: '背景色', cssVar: '--el-bg', fallback: '--bg2' },
  { key: 'fg', label: '文字色', cssVar: '--el-fg', fallback: '--fg' },
  { key: 'fg2', label: '補助文字色', cssVar: '--el-fg2', fallback: '--fg2' },
  { key: 'accent', label: 'アクセント色', cssVar: '--el-accent', fallback: '--accent' },
  { key: 'border', label: '枠線色', cssVar: '--el-border', fallback: '--border' },
];

function _elShowThemePopup(anchorBtn, ctx) {
  _elCloseEditPopups();
  const popup = document.createElement('div');
  popup.className = 'gb-context-menu el-edit-popup el-theme-popup';
  popup.dataset.e2eId = 'entity-layout-theme-popup';

  const title = document.createElement('div');
  title.className = 'el-popup-title';
  title.textContent = 'レイアウトの配色';
  popup.appendChild(title);

  const rootStyle = getComputedStyle(document.documentElement);
  EL_THEME_TOKENS.forEach(token => {
    const row = document.createElement('div');
    row.className = 'el-popup-row';
    const label = document.createElement('span');
    label.textContent = token.label;
    row.appendChild(label);
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'el-theme-swatch';
    swatch.dataset.e2eId = 'entity-layout-theme-' + token.key;
    swatch.setAttribute('aria-label', token.label + 'を選択');
    const current = () => ctx.layout.theme?.[token.key]
      || rootStyle.getPropertyValue(token.fallback).trim() || '#888888';
    swatch.style.background = current();
    swatch.addEventListener('click', () => {
      if (typeof openColorPalette !== 'function') return;
      openColorPalette(swatch, current(), (color) => {
        if (typeof _elCanMutateGrid === 'function' && !_elCanMutateGrid(ctx.grid, ctx.options)) return;
        if (!color) return;
        swatch.style.background = color;
        ctx.persist('エントリレイアウト: 配色', token.label, (layout) => {
          if (!_elIsObj(layout.theme)) layout.theme = {};
          layout.theme[token.key] = color;
        });
        // 開いたまま即時反映
        const canvas = ctx.grid?.querySelector?.('.el-canvas');
        if (canvas) canvas.style.setProperty(token.cssVar, color);
        if (!_elIsObj(ctx.layout.theme)) ctx.layout.theme = {};
        ctx.layout.theme[token.key] = color;
      });
    });
    row.appendChild(swatch);
    popup.appendChild(row);
  });

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'gb-btn gb-btn-sm';
  resetBtn.dataset.e2eId = 'entity-layout-theme-reset';
  resetBtn.textContent = 'アプリのテーマに合わせる';
  resetBtn.addEventListener('click', () => {
    if (typeof _elCanMutateGrid === 'function' && !_elCanMutateGrid(ctx.grid, ctx.options)) return;
    close();
    ctx.persist('エントリレイアウト: 配色リセット', '', (layout) => { layout.theme = null; });
    ctx.rerender();
  });
  popup.appendChild(resetBtn);

  const close = _elAttachPopupCommon(popup, anchorBtn);
}

/* レイアウト単位の配色テーマ（Phase C で編集UIを実装）。theme が保存されていれば
   キャンバスルートへスコープしたローカルCSS変数として適用する。 */
function _elApplyLayoutTheme(canvas, layout) {
  const theme = layout?.theme;
  if (!theme || typeof theme !== 'object') return;
  const map = { bg: '--el-bg', fg: '--el-fg', fg2: '--el-fg2', accent: '--el-accent', border: '--el-border' };
  Object.entries(map).forEach(([key, cssVar]) => {
    const value = theme[key];
    if (typeof value === 'string' && value) canvas.style.setProperty(cssVar, value);
  });
}

/* 編集ツールバーへ追加するセル種別ボタン（見出し/罫線/画像 + 配色。チャートは Phase D）。 */
function _elEditToolbarExtraItems(ctx) {
  const items = [];
  const make = (e2eId, icon, label, onClick, popup) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gb-btn gb-btn-sm';
    btn.dataset.e2eId = e2eId;
    if (popup) btn.setAttribute('aria-haspopup', popup);
    btn.innerHTML = (typeof lucide === 'function' ? lucide(icon, 13) : '') + '<span>' + label + '</span>';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(btn);
    });
    items.push(btn);
    return btn;
  };
  make('entity-layout-add-label', 'heading', '見出し', () => {
    _elAddCell(ctx, { type: 'label', text: '見出し', w: 200, h: 40 }, '見出し');
  });
  make('entity-layout-add-divider', 'minus', '罫線', () => {
    _elAddCell(ctx, { type: 'divider', w: 300, h: 24 }, '罫線');
  });
  make('entity-layout-add-image', 'image', '画像', (btn) => {
    _elShowImageCellPopup(btn, ctx, null);
  }, 'dialog');
  if (typeof _elShowChartCellPopup === 'function') {
    make('entity-layout-add-chart', 'barChart2', 'チャート', (btn) => {
      _elShowChartCellPopup(btn, ctx, null);
    }, 'dialog');
  }
  make('entity-layout-theme-btn', 'palette', '配色', (btn) => {
    _elShowThemePopup(btn, ctx);
  }, 'dialog');
  return items;
}
