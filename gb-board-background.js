/* gb-board-background.js: board canvas background image/color controls */

const BD_BG_IMAGE_STYLE_KEY = '--bd-bg-image';
const BD_BG_IMAGE_FIT_STYLE_KEY = '--bd-bg-image-fit';
const BD_BG_IMAGE_SCALE_STYLE_KEY = '--bd-bg-image-scale';
const BD_DEFAULT_FONT_STYLE_KEY = '--bd-default-font-family';

function _bdNormalizeBackgroundFit(value) {
  const next = String(value || '').trim();
  // 'world' はボード要素と一緒にパン/ズーム/回転されるモード (bd-world 内に配置)
  return ['contain', 'cover', 'auto', 'repeat', 'world'].includes(next) ? next : 'contain';
}

function _bdNormalizeBackgroundScale(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(0.05, Math.min(20, n));
}

function _bdEnsureFileStyle() {
  if (!bd._fileStyle || typeof bd._fileStyle !== 'object' || Array.isArray(bd._fileStyle)) {
    bd._fileStyle = {};
  }
  return bd._fileStyle;
}

function bdLoadBoardBackgroundFromStyle() {
  const style = bd._fileStyle && typeof bd._fileStyle === 'object' ? bd._fileStyle : {};
  if (Object.prototype.hasOwnProperty.call(style, '--bd-bg')) {
    bd._bgColor = String(style['--bd-bg'] || '').trim();
  }
  bd._bgImage = String(style[BD_BG_IMAGE_STYLE_KEY] || '').trim();
  bd._bgImageFit = _bdNormalizeBackgroundFit(style[BD_BG_IMAGE_FIT_STYLE_KEY]);
  bd._bgImageScale = _bdNormalizeBackgroundScale(style[BD_BG_IMAGE_SCALE_STYLE_KEY]);
}

function bdApplyBoardFontVariables(canvasEl, worldEl) {
  if (typeof bd === 'undefined') return;
  const style = bd._fileStyle && typeof bd._fileStyle === 'object' ? bd._fileStyle : {};
  const raw = style[BD_DEFAULT_FONT_STYLE_KEY];
  const fontFamily = typeof normalizeFontFamilyValue === 'function'
    ? normalizeFontFamilyValue(raw)
    : String(raw || '').trim();
  const canvas = canvasEl
    || (typeof bdGetBoardElement === 'function' ? bdGetBoardElement('canvas') : null)
    || document.getElementById('bd-canvas');
  const world = worldEl
    || (typeof bdGetBoardElement === 'function' ? bdGetBoardElement('world') : null)
    || document.getElementById('bd-world');
  [canvas, world].forEach(el => {
    if (!el) return;
    if (fontFamily) el.style.setProperty(BD_DEFAULT_FONT_STYLE_KEY, fontFamily);
    else el.style.removeProperty(BD_DEFAULT_FONT_STYLE_KEY);
  });
}

function _bdBackgroundCssUrl(value) {
  const url = String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return url ? `url("${url}")` : '';
}

function _bdBackgroundImageName() {
  const raw = String(bd._bgImage || '');
  if (!raw) return '';
  const match = raw.match(/[?&]path=([^&]+)/);
  let decoded = match ? match[1] : raw;
  try { decoded = decodeURIComponent(decoded); } catch {}
  return decoded.split(/[\\/]/).pop() || decoded;
}

function _bdCanvasCssVar(canvas, key) {
  const inline = canvas?.style?.getPropertyValue?.(key)?.trim?.() || '';
  if (inline) return inline;
  try {
    return getComputedStyle(canvas).getPropertyValue(key).trim();
  } catch {
    return '';
  }
}

function _bdBoardThemeCssVar(canvas, key) {
  return _bdCanvasCssVar(canvas, key)
    || (typeof getCssVar === 'function' ? (getCssVar(key) || '').trim() : '');
}

function _bdApplyWorldBackgroundImage(imageUrl, scale) {
  const world = (typeof bdGetBoardElement === 'function' ? bdGetBoardElement('world') : null)
    || document.getElementById('bd-world');
  if (!world) return;
  let layer = world.querySelector(':scope > .bd-bg-world-image');
  if (!imageUrl) {
    if (layer) layer.remove();
    return;
  }
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'bd-bg-world-image';
    layer.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;z-index:-1;';
    // 画像の自然サイズで配置し、bd-world の transform(パン/ズーム/回転) に追従させる
    const img = document.createElement('img');
    img.draggable = false;
    img.style.cssText = 'display:block;user-select:none;pointer-events:none;';
    layer.appendChild(img);
    world.insertBefore(layer, world.firstChild);
  }
  const imgEl = layer.querySelector('img');
  if (imgEl && imgEl.src !== imageUrl) imgEl.src = imageUrl;
  const s = _bdNormalizeBackgroundScale(scale);
  layer.style.transform = `scale(${s})`;
}

function _bdRemoveWorldBackgroundImage() {
  const world = (typeof bdGetBoardElement === 'function' ? bdGetBoardElement('world') : null)
    || document.getElementById('bd-world');
  if (!world) return;
  const layer = world.querySelector(':scope > .bd-bg-world-image');
  if (layer) layer.remove();
}

function bdApplyCanvasBackground(canvasEl, fallbackColor) {
  const canvas = canvasEl
    || (typeof bdGetBoardElement === 'function' ? bdGetBoardElement('canvas') : null)
    || document.getElementById('bd-canvas');
  if (!canvas) return;

  const fileStyle = bd?._fileStyle && typeof bd._fileStyle === 'object' ? bd._fileStyle : {};
  const fileStyleBg = String(fileStyle['--bd-bg'] || '').trim();
  const resolvedFallback = fileStyleBg || ((fallbackColor === undefined || fallbackColor === null || fallbackColor === '')
    ? _bdBoardThemeBackgroundColor()
    : fallbackColor);
  const color = bd._bgColor || resolvedFallback || '';
  canvas.style.backgroundColor = color || 'var(--bg)';

  // ファイル固有値が未設定のときはボード専用テーマ値、なければ :root 値を参照
  const themeBgImage = String(fileStyle['--bd-bg-image'] || '').trim()
    || _bdBoardThemeCssVar(canvas, '--bd-bg-image');
  const themeBgFit = String(fileStyle['--bd-bg-image-fit'] || '').trim()
    || _bdBoardThemeCssVar(canvas, '--bd-bg-image-fit');
  const themeBgScale = String(fileStyle['--bd-bg-image-scale'] || '').trim()
    || _bdBoardThemeCssVar(canvas, '--bd-bg-image-scale');
  const rawImage = String(bd._bgImage || '').trim() || themeBgImage;
  const image = rawImage;
  const fit = _bdNormalizeBackgroundFit(bd._bgImageFit || themeBgFit);
  const scale = _bdNormalizeBackgroundScale(
    bd._bgImageScale !== undefined && bd._bgImageScale !== null && bd._bgImageScale !== ''
      ? bd._bgImageScale
      : themeBgScale
  );
  if (image && fit === 'world') {
    // ボード要素と一緒にパン/ズーム/回転する: bd-canvas の background-image は使わず、
    // bd-world の子要素として img を配置する (transform が連動する)。
    canvas.style.backgroundImage = '';
    canvas.style.backgroundPosition = '';
    canvas.style.backgroundRepeat = '';
    canvas.style.backgroundSize = '';
    _bdApplyWorldBackgroundImage(image, scale);
  } else if (image) {
    canvas.style.backgroundImage = _bdBackgroundCssUrl(image);
    canvas.style.backgroundPosition = 'center center';
    canvas.style.backgroundRepeat = fit === 'repeat' ? 'repeat' : 'no-repeat';
    canvas.style.backgroundSize = fit === 'repeat' ? 'auto' : fit;
    _bdRemoveWorldBackgroundImage();
  } else {
    canvas.style.backgroundImage = '';
    canvas.style.backgroundPosition = '';
    canvas.style.backgroundRepeat = '';
    canvas.style.backgroundSize = '';
    _bdRemoveWorldBackgroundImage();
  }

  const swatch = document.getElementById('bd-bg-swatch');
  if (swatch && typeof setColorSwatchValue === 'function') setColorSwatchValue(swatch, color || '');
  document.querySelectorAll('[data-bd-action="bg-image"]').forEach(btn => {
    btn.classList.toggle('active', !!image);
    btn.title = image ? `背景画像: ${_bdBackgroundImageName()}` : '背景画像';
  });
}

function _bdBoardThemeBackgroundColor() {
  const fileStyleBg = bd?._fileStyle && typeof bd._fileStyle === 'object'
    ? String(bd._fileStyle['--bd-bg'] || '').trim()
    : '';
  if (fileStyleBg) return fileStyleBg;
  if (!String(bd?.themeId || '').trim()) {
    const documentBg = typeof getCssVar === 'function' ? (getCssVar('--bd-bg') || '').trim() : '';
    if (documentBg) return documentBg;
  }
  if (typeof MeldexThemeManager === 'undefined' || typeof MeldexThemeManager.getActiveBoardTheme !== 'function') {
    return '';
  }
  const themeDef = MeldexThemeManager.getActiveBoardTheme(bd);
  return themeDef?.ui?.cssVars?.['--bd-bg'] || themeDef?.board?.backgroundColor || '';
}

function bdApplyBoardFileStyleAndTheme(canvasEl, worldEl) {
  const canvas = canvasEl
    || (typeof bdGetBoardElement === 'function' ? bdGetBoardElement('canvas') : null)
    || document.getElementById('bd-canvas');
  const world = worldEl
    || (typeof bdGetBoardElement === 'function' ? bdGetBoardElement('world') : null)
    || document.getElementById('bd-world');
  if (typeof applyFileStyleToPanel === 'function') {
    applyFileStyleToPanel(bd._fileStyle || {}, 'bd-canvas');
  }
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.applyBoardThemeRuntime === 'function') {
    MeldexThemeManager.applyBoardThemeRuntime(bd, canvas, world);
  }
  if (typeof bdApplyBoardFontVariables === 'function') {
    bdApplyBoardFontVariables(canvas, world);
  }
  bdApplyCanvasBackground(canvas);
}

function _bdApplyCurrentBoardBackground() {
  bdApplyCanvasBackground(null, _bdBoardThemeBackgroundColor());
}

function bdPickBoardBackgroundColor(anchorEl) {
  if (typeof openColorPalette !== 'function') return;
  openColorPalette(anchorEl, bd._bgColor || '', color => {
    bdSetBoardBackgroundColor(color || '');
  });
}

function bdSetBoardBackgroundColor(color) {
  if (typeof bdPushUndo === 'function') bdPushUndo();
  bd._bgColor = color || '';
  const style = _bdEnsureFileStyle();
  if (bd._bgColor) style['--bd-bg'] = bd._bgColor;
  else delete style['--bd-bg'];
  _bdApplyCurrentBoardBackground();
  if (typeof bdDirty === 'function') bdDirty();
  if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
  if (typeof bdMarkExtrasDirty === 'function') {
    bdMarkExtrasDirty({ minimap: true, boardUi: true }, 'bg-color');
    if (typeof bdScheduleBoardUpdates === 'function') bdScheduleBoardUpdates();
  }
}

function _bdBoardUploadDir() {
  const path = String(bd.path || '');
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.substring(0, idx) : '';
}

function _bdReadFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = event => resolve(event.target.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function _bdIsImageFile(file) {
  if (!file) return false;
  if (String(file.type || '').startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i.test(file.name || '');
}

async function bdSetBoardBackgroundImageFromFile(file) {
  if (!_bdIsImageFile(file)) {
    if (typeof showStatus === 'function') showStatus('画像ファイルを選択してください', true);
    return false;
  }
  if (!bd.path) {
    if (typeof showStatus === 'function') showStatus('ボードを保存してから背景画像を設定してください', true);
    return false;
  }
  try {
    const data = await _bdReadFileAsDataUrl(file);
    const res = await apiFetch('/upload-file?path=' + encodeURIComponent(_bdBoardUploadDir()), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ data, filename: file.name || 'background.png' }),
    });
    if (!res?.ok || !res.path) throw new Error('upload failed');
    const imageUrl = API_BASE + '/file-raw?path=' + encodeURIComponent(res.path);
    bdSetBoardBackgroundImage(imageUrl, bd._bgImageFit || 'contain');
    if (typeof showStatus === 'function') showStatus('背景画像を設定しました');
    return true;
  } catch (err) {
    if (typeof showStatus === 'function') showStatus('背景画像の設定に失敗しました', true);
    return false;
  }
}

function bdChooseBoardBackgroundImage() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (file) bdSetBoardBackgroundImageFromFile(file);
    input.remove();
  });
  input.style.display = 'none';
  document.body.appendChild(input);
  input.click();
}

function bdSetBoardBackgroundImage(url, fit, scale) {
  if (typeof bdPushUndo === 'function') bdPushUndo();
  bd._bgImage = String(url || '').trim();
  bd._bgImageFit = _bdNormalizeBackgroundFit(fit || bd._bgImageFit);
  bd._bgImageScale = _bdNormalizeBackgroundScale(scale !== undefined ? scale : bd._bgImageScale);
  const style = _bdEnsureFileStyle();
  if (bd._bgImage) {
    style[BD_BG_IMAGE_STYLE_KEY] = bd._bgImage;
    style[BD_BG_IMAGE_FIT_STYLE_KEY] = bd._bgImageFit;
    if (bd._bgImageFit === 'world' && bd._bgImageScale !== 1) {
      style[BD_BG_IMAGE_SCALE_STYLE_KEY] = String(bd._bgImageScale);
    } else {
      delete style[BD_BG_IMAGE_SCALE_STYLE_KEY];
    }
  } else {
    delete style[BD_BG_IMAGE_STYLE_KEY];
    delete style[BD_BG_IMAGE_FIT_STYLE_KEY];
    delete style[BD_BG_IMAGE_SCALE_STYLE_KEY];
  }
  _bdApplyCurrentBoardBackground();
  if (typeof bdDirty === 'function') bdDirty();
  if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
  if (typeof bdMarkExtrasDirty === 'function') {
    bdMarkExtrasDirty({ minimap: true, boardUi: true }, 'bg-image');
    if (typeof bdScheduleBoardUpdates === 'function') bdScheduleBoardUpdates();
  }
}

function bdSetBoardBackgroundImageFit(fit) {
  bdSetBoardBackgroundImage(bd._bgImage || '', fit, bd._bgImageScale);
}

function bdSetBoardBackgroundImageScale(scale) {
  bdSetBoardBackgroundImage(bd._bgImage || '', bd._bgImageFit || 'contain', scale);
}

function bdClearBoardBackgroundImage() {
  bdSetBoardBackgroundImage('', 'contain', 1);
}

function bdClearBoardBackground() {
  if (typeof bdPushUndo === 'function') bdPushUndo();
  bd._bgColor = '';
  bd._bgImage = '';
  bd._bgImageFit = 'contain';
  bd._bgImageScale = 1;
  const style = _bdEnsureFileStyle();
  delete style['--bd-bg'];
  delete style[BD_BG_IMAGE_STYLE_KEY];
  delete style[BD_BG_IMAGE_FIT_STYLE_KEY];
  delete style[BD_BG_IMAGE_SCALE_STYLE_KEY];
  _bdApplyCurrentBoardBackground();
  if (typeof bdDirty === 'function') bdDirty();
  if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
  if (typeof bdMarkExtrasDirty === 'function') {
    bdMarkExtrasDirty({ minimap: true, boardUi: true }, 'bg-clear');
    if (typeof bdScheduleBoardUpdates === 'function') bdScheduleBoardUpdates();
  }
}

document.addEventListener('click', event => {
  const btn = event.target?.closest?.('[data-bd-action]');
  if (!btn || !btn.closest?.('.gb-canvas-root')) return;
  if (btn.dataset.bdAction === 'bg-image') {
    event.preventDefault();
    bdChooseBoardBackgroundImage();
  } else if (btn.dataset.bdAction === 'bg-clear') {
    event.preventDefault();
    bdClearBoardBackground();
  }
});

if (typeof bdRefreshBoardToolbar === 'function') {
  const _bdRefreshBoardToolbarBase = bdRefreshBoardToolbar;
  bdRefreshBoardToolbar = function bdRefreshBoardToolbarWithBackground(...args) {
    const result = _bdRefreshBoardToolbarBase.apply(this, args);
    if (typeof bdApplyCanvasBackground === 'function') _bdApplyCurrentBoardBackground();
    return result;
  };
}
