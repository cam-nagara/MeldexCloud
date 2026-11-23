/**
 * Meldex 汎用HTML出力エンジン (gb-export-html.js)
 *
 * 全エディタ共通の「自己完結型HTML」生成機能を提供する。
 * シナリオの exportCurrentScriptNoteAsHtml() を参考に、DOMクローン→クリーンアップ→
 * CSS収集→フォント埋め込み→HTML組み立ての共通パイプラインを実装する。
 */

const MeldexExportHtml = (() => {

  const INLINE_ASSET_MAX_BYTES = 50 * 1024 * 1024;
  // 公開（HTML出力）できる元ファイルの種類。本体側の PUBLISH_SOURCE_KINDS（meldex_api_shell.py）と
  // 同じ一覧でなければならない（tests/test_meldex_publish_source_kinds.py が食い違いを検出する）。
  const PUBLISH_SOURCE_KINDS = Object.freeze(['page', 'entity', 'database', 'csv', 'calendar', 'board', 'scriptnote', 'form-app']);
  const ASSET_BASE_TOKEN = '__MELDEX_ASSET_BASE__';

  function _assetExtension(blob, rawUrl) {
    const mime = String(blob?.type || '').toLowerCase().split(';', 1)[0];
    const byMime = {
      'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
      'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif',
      'image/bmp': 'bmp', 'image/x-icon': 'ico',
      'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
      'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg',
      'audio/flac': 'flac', 'audio/mp4': 'm4a',
      'font/woff2': 'woff2', 'font/woff': 'woff',
    };
    if (byMime[mime]) return byMime[mime];
    try {
      const pathname = new URL(String(rawUrl || ''), document.baseURI).pathname;
      const match = pathname.match(/\.([A-Za-z0-9]{1,8})$/);
      if (match) return match[1].toLowerCase();
    } catch {}
    return 'bin';
  }

  async function _sha256Hex(blob) {
    if (!globalThis.crypto?.subtle) {
      throw new Error('公開資産の整合性hashを計算できないため生成を停止しました');
    }
    const digest = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  }

  function createAssetCollector(options) {
    const configured = Number(options?.inlineLimitBytes);
    const inlineLimitBytes = Number.isFinite(configured) && configured >= 0
      ? configured
      : INLINE_ASSET_MAX_BYTES;
    const assets = [];
    const byName = new Map();
    return {
      assets,
      inlineLimitBytes,
      async addBlob(blob, rawUrl) {
        if (!blob) throw new Error('公開資産を読み込めませんでした');
        if (blob.size <= inlineLimitBytes) return _blobToDataUri(blob);
        const sha256 = await _sha256Hex(blob);
        const name = `${sha256}.${_assetExtension(blob, rawUrl)}`;
        if (!byName.has(name)) {
          const asset = Object.freeze({
            name,
            mime: String(blob.type || 'application/octet-stream'),
            size: Number(blob.size) || 0,
            sha256,
            blob,
          });
          byName.set(name, asset);
          assets.push(asset);
        }
        return `${ASSET_BASE_TOKEN}/${name}`;
      },
    };
  }

  function _getFormControlStaticText(node) {
    if (!node) return '';
    const tagName = node.tagName || '';
    if (tagName === 'SELECT') {
      const selected = node.selectedOptions?.[0];
      return selected?.textContent || node.value || '';
    }
    if (tagName === 'TEXTAREA') {
      return node.value || node.textContent || '';
    }
    if (tagName === 'INPUT') {
      const inputType = (node.type || '').toLowerCase();
      if (inputType === 'checkbox') return node.checked ? '☑' : '☐';
      if (inputType === 'radio') return node.checked ? '◉' : '○';
      return node.value || node.textContent || '';
    }
    return node.value || node.textContent || '';
  }

  // ================================================================
  // 1. DOMクローン + クリーンアップ
  // ================================================================

  /** 要素をクローンし、インタラクティブ属性を除去する
   * @param {HTMLElement} el
   * @param {Object} [opts]
   * @param {boolean} [opts.preserveFormControls=false]
   *   true の場合、input/textarea/select/button を span/disabled 化せずそのまま残す。
   *   公開フォームのようにユーザー入力を受け付ける必要がある HTML に使う。
   */
  // 元要素が祖先（パネル・ファイルテーマ）から受け継いでいる CSS 変数と文字設定、および
  // 本文の余白・行間を計算済みの値で複製へ固定する。出力には祖先が含まれないため。
  const CONTEXT_TEXT_PROPS = [
    'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
    'font-feature-settings', 'text-rendering', 'word-break', 'overflow-wrap', 'line-break',
  ];
  const CONTEXT_BOX_PROPS = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'];
  function applyComputedContext(originalEl, clone) {
    if (!originalEl || !clone?.style) return;
    const cs = getComputedStyle(originalEl);
    for (let i = 0; i < cs.length; i++) {
      const name = cs[i];
      if (!name || !name.startsWith('--')) continue;
      const value = cs.getPropertyValue(name).trim();
      if (value && !clone.style.getPropertyValue(name)) clone.style.setProperty(name, value);
    }
    [...CONTEXT_TEXT_PROPS, ...CONTEXT_BOX_PROPS].forEach(name => {
      const value = cs.getPropertyValue(name);
      if (value) clone.style.setProperty(name, value);
    });
    // 行間は、画面側の指定のされ方（倍率か px か）が組方向や要素で異なり、出力用CSSの
    // 上書きと組み合わさると子要素（コード・表・見出し等）でずれる。本文内の各要素の行間を
    // 画面の実測値で固定する（複製と元の要素数が一致する時だけ）。
    const sourceNodes = originalEl.querySelectorAll('*');
    const cloneNodes = clone.querySelectorAll('*');
    if (sourceNodes.length === cloneNodes.length) {
      sourceNodes.forEach((node, index) => {
        const value = getComputedStyle(node).lineHeight;
        if (value && value !== 'normal') cloneNodes[index].style.setProperty('line-height', value);
      });
    }
    const maxWidth = cs.getPropertyValue('max-width');
    if (maxWidth && maxWidth !== 'none') clone.style.setProperty('max-width', maxWidth);
  }

  // ================================================================
  // 1-b. 見た目の固定（公開HTMLを画面と1pxも違わない見た目にする）
  // ================================================================
  // 画面の見た目は、祖先のパネル・ファイルテーマ・表示倍率・状態クラス等の組み合わせで決まる。
  // 書き出しには祖先が無いため、CSSファイルを同梱するだけでは寸法・余白・文字が少しずつずれる。
  // 各要素の計算済みスタイルを、既定値と異なるものだけ style 属性へ写して固定する。
  // ::before / ::after は属性の目印を付けて、同じ値を公開HTMLのCSSとして書き出す。

  const FREEZE_SKIP_PROPS = new Set([
    'transition', 'transition-property', 'transition-duration', 'transition-delay', 'transition-timing-function',
    'transition-behavior', 'animation', 'animation-name', 'animation-duration', 'animation-delay',
    'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'animation-play-state',
    'animation-timing-function', 'animation-composition', 'animation-range-start', 'animation-range-end',
    'animation-timeline', 'cursor', 'pointer-events', 'user-select', '-webkit-user-select', 'caret-color',
    'will-change', 'view-transition-name', 'content-visibility', 'contain-intrinsic-size',
    'contain-intrinsic-width', 'contain-intrinsic-height', 'contain-intrinsic-block-size',
    'contain-intrinsic-inline-size', '-webkit-user-modify', '-webkit-user-drag', 'touch-action',
    'outline-color', 'outline-style', 'outline-width', 'outline-offset', 'interactivity',
  ]);
  const FREEZE_INHERITED_PROPS = new Set([
    'color', 'font-family', 'font-size', 'font-style', 'font-weight', 'font-variant', 'font-stretch',
    'font-feature-settings', 'font-variation-settings', 'font-kerning', 'font-optical-sizing',
    'font-variant-ligatures', 'font-variant-numeric', 'font-variant-east-asian', 'font-variant-caps',
    'font-variant-alternates', 'font-variant-position', 'font-palette', 'font-synthesis-weight',
    'font-synthesis-style', 'font-synthesis-small-caps', 'font-size-adjust', 'line-height', 'letter-spacing',
    'word-spacing', 'text-align', 'text-align-last', 'text-indent', 'text-transform', 'white-space',
    'white-space-collapse', 'text-wrap', 'text-wrap-mode', 'text-wrap-style', 'writing-mode', 'direction',
    'text-orientation', 'text-combine-upright', 'visibility', 'list-style-type', 'list-style-position',
    'list-style-image', 'word-break', 'overflow-wrap', 'line-break', 'hyphens', 'tab-size', 'quotes',
    'ruby-position', 'ruby-align', 'text-shadow', 'text-rendering', 'text-underline-position',
    'text-emphasis-style', 'text-emphasis-color', 'text-emphasis-position', 'text-size-adjust',
    '-webkit-text-stroke-width', '-webkit-text-stroke-color', '-webkit-text-fill-color',
    '-webkit-font-smoothing', '-webkit-locale', 'border-collapse', 'border-spacing', 'caption-side',
    'empty-cells', 'image-rendering', 'print-color-adjust', '-webkit-print-color-adjust', 'paint-order',
    'color-scheme', 'forced-color-adjust', 'math-depth', 'math-style', 'text-spacing-trim', 'text-autospace',
    'hanging-punctuation', 'orphans', 'widows', 'dominant-baseline', 'fill', 'fill-opacity', 'fill-rule',
    'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap',
    'stroke-linejoin', 'stroke-miterlimit', 'marker-start', 'marker-mid', 'marker-end', 'shape-rendering',
    'clip-rule', 'color-interpolation', 'color-interpolation-filters', 'color-rendering', 'text-anchor',
    'pointer-events', 'cursor', 'caret-color', 'speak', 'font-display',
  ]);
  const FREEZE_PSEUDOS = ['::before', '::after'];
  const FREEZE_MARKER_PROPS = [
    'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant-numeric',
    'text-combine-upright', 'unicode-bidi', 'direction', 'content', 'letter-spacing', 'white-space',
    'text-transform', 'line-height',
  ];
  const FREEZE_MARKER = 'data-mx-ps';
  let _freezeDefaultsFrame = null;
  const _freezeDefaults = new Map();

  function _freezeDefaultStyle(element, pseudo) {
    const ns = element.namespaceURI || '';
    const tag = String(element.localName || element.tagName || 'div').toLowerCase();
    const key = ns + '|' + tag + '|' + (pseudo || '');
    if (_freezeDefaults.has(key)) return _freezeDefaults.get(key);
    if (!_freezeDefaultsFrame || !_freezeDefaultsFrame.isConnected) {
      _freezeDefaultsFrame = document.createElement('iframe');
      _freezeDefaultsFrame.setAttribute('aria-hidden', 'true');
      _freezeDefaultsFrame.tabIndex = -1;
      _freezeDefaultsFrame.style.cssText = 'position:fixed;left:-10000px;top:0;width:10px;height:10px;border:0;visibility:hidden';
      document.body.appendChild(_freezeDefaultsFrame);
      _freezeDefaultsFrame.contentDocument.open();
      _freezeDefaultsFrame.contentDocument.write('<!DOCTYPE html><html><head><style>*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}</style></head><body></body></html>');
      _freezeDefaultsFrame.contentDocument.close();
    }
    const doc = _freezeDefaultsFrame.contentDocument;
    const probe = ns && ns !== 'http://www.w3.org/1999/xhtml' ? doc.createElementNS(ns, tag) : doc.createElement(tag);
    const host = ns === 'http://www.w3.org/2000/svg' && tag !== 'svg'
      ? doc.body.appendChild(doc.createElementNS(ns, 'svg'))
      : doc.body;
    host.appendChild(probe);
    const cs = _freezeDefaultsFrame.contentWindow.getComputedStyle(probe, pseudo || null);
    const values = new Map();
    for (let i = 0; i < cs.length; i++) values.set(cs[i], cs.getPropertyValue(cs[i]));
    probe.remove();
    if (host !== doc.body) host.remove();
    _freezeDefaults.set(key, values);
    return values;
  }

  // 論理プロパティ（block/inline）は物理プロパティの別名。両方を書くと後勝ちで食い違うため物理側だけ書く。
  const FREEZE_LOGICAL_RE = /^(border-(block|inline)|inset-(block|inline)|margin-(block|inline)|padding-(block|inline)|(min-|max-)?(block|inline)-size$|overflow-(block|inline)|scroll-(margin|padding)|overscroll-behavior-(block|inline)|contain-intrinsic)/;

  // 寸法と位置は「指定した値」で写す。計算済みの値（実際の寸法）を写すと、高さを固定したことで
  // 子の余白の相殺が止まる等、画面と組み方が変わる（箇条書きの後ろが2px詰まった実例がある）。
  const FREEZE_SPECIFIED_PROPS = new Set([
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'top', 'right', 'bottom', 'left', 'flex-basis',
  ]);

  function _specifiedValue(map, name) {
    if (!map) return null;
    try {
      const value = map.get(name);
      return value == null ? null : String(value);
    } catch { return null; }
  }

  let _freezeBase = null;
  function _freezeBaseDefaults() {
    if (!_freezeBase) _freezeBase = _freezeDefaultStyle(document.createElement('span'), '');
    return _freezeBase;
  }

  function _freezeDeclarations(cs, defaults, parentCs, isRoot, styleMap) {
    const parts = [];
    const noneStyle = side => cs.getPropertyValue(`border-${side}-style`) === 'none';
    const hasTransform = cs.getPropertyValue('transform') !== 'none'
      || cs.getPropertyValue('rotate') !== 'none' || cs.getPropertyValue('scale') !== 'none'
      || cs.getPropertyValue('translate') !== 'none';
    for (let i = 0; i < cs.length; i++) {
      const name = cs[i];
      if (!name || name.startsWith('--') || FREEZE_SKIP_PROPS.has(name) || FREEZE_LOGICAL_RE.test(name)) continue;
      const value = cs.getPropertyValue(name);
      if (value === '' || value == null) continue;
      const side = /^border-(top|right|bottom|left)-(color|width|style)$/.exec(name);
      if (side) {
        // 線が無い辺は色・幅を書かない。線がある辺は幅を必ず書く（省くと既定の太さ3pxになる）
        if (noneStyle(side[1])) { if (side[2] === 'style' && defaults.get(name) !== value) parts.push(name + ':' + value); continue; }
        if (side[2] !== 'color' || defaults.get(name) !== value) parts.push(name + ':' + value);
        continue;
      }
      if (/^column-rule-(color|width)$/.test(name) && cs.getPropertyValue('column-rule-style') === 'none') continue;
      if (name === 'row-rule-color' || name === 'row-rule-width') continue;
      if (name === 'text-decoration-color' && cs.getPropertyValue('text-decoration-line') === 'none') continue;
      if ((name === 'transform-origin' || name === 'perspective-origin') && !hasTransform
        && cs.getPropertyValue('perspective') === 'none') continue;
      if (styleMap && FREEZE_SPECIFIED_PROPS.has(name)) {
        const specified = _specifiedValue(styleMap, name);
        if (specified !== null) {
          if (specified === 'auto' || specified === 'none') {
            if (defaults.get(name) !== specified) parts.push(name + ':' + specified);
            continue;
          }
          parts.push(name + ':' + specified);
          continue;
        }
      }
      if (FREEZE_INHERITED_PROPS.has(name)) {
        // 受け継ぐ値は、親と同じなら書かない（親から同じ値を受け継ぐ）
        // ただし見出しセル（中央揃え）・太字の要素のように、ブラウザが要素ごとに既定値を持つものは
        // 親と同じでも書く（書かないと要素の既定値に戻る）
        if (!isRoot && parentCs && parentCs.getPropertyValue(name) === value
          && defaults.get(name) === _freezeBaseDefaults().get(name)) continue;
      } else if (defaults.get(name) === value) {
        continue;
      }
      parts.push(name + ':' + value);
    }
    return parts;
  }

  function _parseRgba(value) {
    const match = String(value || '').match(/rgba?\(([^)]+)\)/i);
    if (!match) return null;
    const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some(n => !Number.isFinite(n))) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }

  /** 画面の要素の「後ろに見えている色」（祖先の背景を重ねた色）。公開HTMLの下地にする。
      半透明の背景は下地の色と混ざって見えるため、下地が違うと色が変わる。 */
  function backdropColor(originalEl) {
    const layers = [];
    let node = originalEl?.parentElement || null;
    while (node) {
      const color = _parseRgba(getComputedStyle(node).backgroundColor);
      if (color && color.a > 0) {
        layers.push(color);
        if (color.a >= 1) break;
      }
      node = node.parentElement;
    }
    let base = { r: 255, g: 255, b: 255 };
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      base = {
        r: layer.r * layer.a + base.r * (1 - layer.a),
        g: layer.g * layer.a + base.g * (1 - layer.a),
        b: layer.b * layer.a + base.b * (1 - layer.a),
      };
    }
    return `rgb(${Math.round(base.r)}, ${Math.round(base.g)}, ${Math.round(base.b)})`;
  }

  /** 画面の要素とその中で使っている文字の太さを、埋め込むフォントの種類で返す */
  function usedFontWeights(originalEl) {
    const keys = new Set();
    if (!originalEl?.isConnected) return ['regular'];
    [originalEl, ...originalEl.querySelectorAll('*')].forEach(node => {
      const weight = parseInt(getComputedStyle(node).fontWeight, 10) || 400;
      keys.add(weight >= 650 ? 'bold' : weight >= 450 ? 'medium' : 'regular');
    });
    return ['regular', 'medium', 'bold'].filter(key => keys.has(key));
  }

  // ルビ（::before / ::after で親文字に重ねて描くもの）は、本物の要素として親文字の中に置く。縦書きの親文字は
  // inline のため、疑似要素の位置の基準がブラウザで違い、iPhone（Safari と同じ描画の仕組み）ではルビが親文字から
  // 離れて出ていた。画面（Chrome）で決まった位置を、行の太さの方向は親文字の中心から、文字の並ぶ方向は
  // 親文字の先頭から、の位置として置く。
  const FREEZE_RUBY_ATTR = 'data-mx-ruby-placed';
  const FREEZE_RUBY_SKIP = new Set(['content', 'position', 'left', 'right', 'top', 'bottom', 'inset', 'width', 'height',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'transform']);

  function _freezePlaceRuby(source, target, pcs, cs) {
    const px = value => parseFloat(value) || 0;
    const rect = source.getBoundingClientRect();
    const z = typeof _getZoom === 'function' ? (_getZoom() || 1) : 1;
    const spanW = rect.width / z;
    const spanH = rect.height / z;
    const w = px(pcs.width);
    const h = px(pcs.height);
    if (!(w > 0 && h > 0)) return false;
    const x = pcs.left !== 'auto' ? px(pcs.left) : spanW - px(pcs.right) - w;
    const y = pcs.top !== 'auto' ? px(pcs.top) : spanH - px(pcs.bottom) - h;
    const vertical = String(cs.writingMode || '').startsWith('vertical');
    const ruby = document.createElement('span');
    ruby.className = 'mx-export-ruby';
    ruby.setAttribute('aria-hidden', 'true');
    const raw = pcs.getPropertyValue('content');
    const text = /^["']/.test(raw) ? raw.slice(1, -1).replace(/\\(.)/g, '$1') : (source.getAttribute('data-ruby-rendered') || source.getAttribute('data-ruby') || '');
    ruby.textContent = text;
    const decls = [];
    for (let i = 0; i < pcs.length; i++) {
      const name = pcs[i];
      if (!name || name.startsWith('--') || FREEZE_SKIP_PROPS.has(name) || FREEZE_LOGICAL_RE.test(name) || FREEZE_RUBY_SKIP.has(name)) continue;
      const value = pcs.getPropertyValue(name);
      if (value) decls.push(name + ':' + value);
    }
    decls.push('position:absolute', 'margin:0', 'pointer-events:none', `width:${w}px`, `height:${h}px`);
    if (vertical) decls.push(`left:calc(50% + ${x - spanW / 2}px)`, `top:${y}px`);
    else decls.push(`left:${x}px`, `top:calc(50% + ${y - spanH / 2}px)`);
    ruby.setAttribute('style', decls.join(';'));
    target.setAttribute(FREEZE_RUBY_ATTR, vertical ? 'v' : 'h');
    const style = target.getAttribute('style') || '';
    if (!/(^|;)\s*position\s*:/.test(style) || /position\s*:\s*static/.test(style)) {
      target.setAttribute('style', (style ? style + ';' : '') + 'position:relative');
    }
    target.appendChild(ruby);
    return true;
  }

  /** 公開HTMLへ足すCSS（見た目を固定した書き出し用）。Safari と同じ描画の仕組み（WebKit）は縦書きの詰め（vpal）を
      正しく扱えないため、縦書き用の字形（vert）だけを使う。ルビの親文字は inline-block にして位置の基準を固定する。 */
  function frozenPublishCss() {
    return [
      `[${FREEZE_RUBY_ATTR}]::before, [${FREEZE_RUBY_ATTR}]::after { content: none !important; }`,
      '@supports (hanging-punctuation: first) {',
      '  [data-mx-vertical], [data-mx-vertical] * { font-feature-settings: "vert" 1 !important; }',
      `  [${FREEZE_RUBY_ATTR}="v"] { display: inline-block !important; }`,
      '}',
    ].join('\n');
  }

  /** 画面の要素 originalEl と、その複製 clone（cloneNode 直後の同じ構造）の見た目を固定する。
      戻り値は ::before / ::after 用のCSS。 */
  function freezeComputedStyles(originalEl, clone) {
    if (!originalEl || !clone) return '';
    const sources = [originalEl, ...originalEl.querySelectorAll('*')];
    const targets = [clone, ...clone.querySelectorAll('*')];
    if (sources.length !== targets.length) return '';
    const rules = [];
    let seq = 0;
    const computed = sources.map(node => getComputedStyle(node));
    const indexOf = new Map(sources.map((node, index) => [node, index]));
    sources.forEach((source, index) => {
      const target = targets[index];
      const cs = computed[index];
      const parentIndex = source === originalEl ? -1 : indexOf.get(source.parentElement);
      const parentCs = parentIndex >= 0 ? computed[parentIndex] : null;
      const styleMap = typeof source.computedStyleMap === 'function' ? source.computedStyleMap() : null;
      const decls = _freezeDeclarations(cs, _freezeDefaultStyle(source, ''), parentCs, index === 0, styleMap);
      if (index === 0) {
        // 根元の寸法は、計算済みの値（小数2桁程度に丸められる）ではなく実寸で固定する。
        // 丸めた幅だと端数が変わり、文字の折り返しや位置が1px未満ずつずれる。
        const rect = source.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && cs.boxSizing === 'border-box' && cs.display !== 'inline') {
          for (let d = decls.length - 1; d >= 0; d--) {
            if (/^(width|height|flex-basis|flex-grow|flex-shrink):/.test(decls[d])) decls.splice(d, 1);
          }
          // 表は高さを指定すると、セルの中の高さ100%の部品まで伸びて組み方が変わるため幅だけにする
          const tableBox = /table/.test(cs.display);
          decls.push('width:' + rect.width + 'px', 'flex:none');
          if (!tableBox) decls.push('height:' + rect.height + 'px');
        }
        // 祖先から受け継いでいた値（テーマの変数を含む）も根元へ固定する
        for (let i = 0; i < cs.length; i++) {
          const name = cs[i];
          if (name && name.startsWith('--')) decls.push(name + ':' + cs.getPropertyValue(name).trim());
        }
      }
      target.setAttribute('style', decls.join(';'));
      if (index === 0 && String(cs.writingMode || '').startsWith('vertical')) target.setAttribute('data-mx-vertical', '1');
      if (cs.display === 'list-item') {
        // ::marker（箇条書きの記号・番号）。縦書きの番号の縦中横など、書式を固定する
        const mcs = getComputedStyle(source, '::marker');
        const mdecls = FREEZE_MARKER_PROPS
          .map(name => [name, mcs.getPropertyValue(name)])
          .filter(([name, value]) => value && value !== cs.getPropertyValue(name)
            && !(name === 'content' && value === 'normal'))
          .map(([name, value]) => name + ':' + value);
        if (mdecls.length) {
          if (!target.hasAttribute(FREEZE_MARKER)) target.setAttribute(FREEZE_MARKER, String(++seq));
          rules.push(`[${FREEZE_MARKER}="${target.getAttribute(FREEZE_MARKER)}"]::marker{${mdecls.join(';')}}`);
        }
      }
      for (const pseudo of FREEZE_PSEUDOS) {
        const pcs = getComputedStyle(source, pseudo);
        const content = pcs.getPropertyValue('content');
        if (!content || content === 'none' || content === 'normal') continue;
        if (source.hasAttribute('data-ruby') && _freezePlaceRuby(source, target, pcs, cs)) continue;
        if (!target.hasAttribute(FREEZE_MARKER)) target.setAttribute(FREEZE_MARKER, String(++seq));
        const pdecls = _freezeDeclarations(pcs, _freezeDefaultStyle(source, pseudo), cs, false);
        if (!pdecls.some(d => d.startsWith('content:'))) pdecls.push('content:' + content);
        rules.push(`[${FREEZE_MARKER}="${target.getAttribute(FREEZE_MARKER)}"]${pseudo}{${pdecls.join(';')}}`);
      }
    });
    return rules.join('\n');
  }

  // アプリ本体と同じ基本リセット（gb-theme.css）。無いと引用・段落・見出し等にブラウザ既定の
  // 余白が付き、画面と配置が変わる。
  const APP_RESET_CSS = '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }';

  function cloneAndClean(el, opts) {
    const options = opts || {};
    const clone = el.cloneNode(true);
    if (options.freezeStyles) {
      // 構造を変える前に、画面の計算済みスタイルを複製へ固定する
      const pseudoCss = freezeComputedStyles(el, clone);
      if (Array.isArray(options.frozenCssOut)) options.frozenCssOut.push(pseudoCss);
      // チェックボックス等の状態は属性ではなく値で持つため、複製へ写す
      const sourceInputs = el.querySelectorAll('input');
      const cloneInputs = clone.querySelectorAll('input');
      if (sourceInputs.length === cloneInputs.length) {
        sourceInputs.forEach((input, index) => {
          if (input.checked) cloneInputs[index].setAttribute('checked', '');
          else cloneInputs[index].removeAttribute('checked');
        });
      }
    }
    const allNodes = [clone, ...clone.querySelectorAll('*')];
    // contenteditable 除去
    allNodes.forEach(node => {
      node.removeAttribute('contenteditable');
    });
    // data-action / data-sn-action / data-on* 除去
    allNodes.forEach(node => {
      node.removeAttribute('data-action');
      node.removeAttribute('data-sn-action');
      node.removeAttribute('data-args');
      node.removeAttribute('data-onchange');
      node.removeAttribute('data-oninput');
      node.removeAttribute('data-onkeydown');
      node.removeAttribute('data-onfocus');
    });
    // tabindex / draggable 除去
    allNodes.forEach(node => {
      node.removeAttribute('tabindex');
      node.removeAttribute('draggable');
    });
    // イベント属性除去
    allNodes.forEach(node => {
      Array.from(node.attributes || []).forEach(attr => {
        if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
      });
    });
    // canvasはcloneNodeでは描画面を複製しない。公開前に確定bitmapへ変換する。
    const sourceCanvases = [el, ...el.querySelectorAll('canvas')].filter(node => node?.tagName === 'CANVAS');
    const clonedCanvases = [clone, ...clone.querySelectorAll('canvas')].filter(node => node?.tagName === 'CANVAS');
    sourceCanvases.forEach((source, index) => {
      const target = clonedCanvases[index];
      if (!target) return;
      let dataUrl = '';
      try { dataUrl = source.toDataURL('image/png'); } catch {
        throw new Error('canvasを安全な画像へ確定できませんでした');
      }
      const image = document.createElement('img');
      image.src = dataUrl;
      image.alt = source.getAttribute('aria-label') || '';
      image.className = source.className || '';
      // 見た目を固定した複製では、固定した値（複製側の style）を引き継ぐ
      image.setAttribute('style', (options.freezeStyles ? target.getAttribute('style') : source.getAttribute('style')) || '');
      target.replaceWith(image);
    });
    // input / textarea / select をテキストに変換、button は無効化
    // preserveFormControls=true の場合はフォーム操作を残すためスキップ
    if (!options.preserveFormControls) {
      clone.querySelectorAll('input, textarea, select, button').forEach(node => {
        const inputType = String(node.type || '').toLowerCase();
        if (options.freezeStyles && node.tagName === 'INPUT' && (inputType === 'checkbox' || inputType === 'radio')) {
          // 見た目を画面と同じにするため、チェックボックスは操作できない状態で残す
          node.setAttribute('inert', '');
          node.setAttribute('tabindex', '-1');
          node.removeAttribute('name');
          node.removeAttribute('id');
          return;
        }
        if (node.tagName === 'BUTTON') {
          if (options.freezeStyles) node.setAttribute('inert', '');
          else node.setAttribute('disabled', 'disabled');
          node.style.pointerEvents = 'none';
        } else {
          const span = document.createElement('span');
          span.className = node.className;
          if (options.freezeStyles && node.getAttribute('style')) span.setAttribute('style', node.getAttribute('style'));
          span.textContent = _getFormControlStaticText(node);
          node.replaceWith(span);
        }
      });
    }
    return clone;
  }

  const PUBLISHED_DATA_ATTRIBUTE_ALLOWLIST = new Set(['data-publish-form', 'data-form-type']);
  // 表示用CSSの目印で、内部情報（パス・ID・トークン等）を含まない data 属性。すべての data 属性を
  // 消すと、完了タスクの装飾・シートのセル折り返し・ボードの図形書式・状態色などが出力で効かなくなる。
  // ルビの読みは本文の一部。値に内部パスやIDを持つ属性（data-path, data-entity-id 等）は含めない。
  const PUBLISHED_DISPLAY_DATA_ATTRIBUTES = new Set([
    'data-ruby', 'data-checked', 'data-cell-overflow', 'data-bd-role', 'data-status', 'data-status-kind',
    'data-note-status', 'data-chip-border', 'data-chip-bg', 'data-bd-group-color', 'data-shape', 'data-dir',
    'data-item-type', 'data-today', 'data-small-list', 'data-stage', 'data-cal-dow', 'data-editor-local-id',
    // 見た目の固定で ::before / ::after のCSSを結び付ける通し番号・ルビを置いた親文字・縦書きの根元
    'data-mx-ps', 'data-mx-ruby-placed', 'data-mx-vertical',
  ]);
  const PUBLISHED_FORBIDDEN_ELEMENTS = 'script,iframe,object,embed,base,meta,link,portal';

  function _safePublishedLink(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.startsWith('#')) return raw;
    try {
      const url = new URL(raw, document.baseURI);
      return ['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol) ? url.toString() : '';
    } catch { return ''; }
  }

  function sanitizePublishedClone(clone, options) {
    const opts = options || {};
    clone.querySelectorAll(PUBLISHED_FORBIDDEN_ELEMENTS).forEach(node => node.remove());
    const allNodes = [clone, ...clone.querySelectorAll('*')];
    allNodes.forEach(node => {
      Array.from(node.attributes || []).forEach(attr => {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on') || name === 'srcdoc') {
          node.removeAttribute(attr.name);
          return;
        }
        if (name === 'srcset') {
          node.removeAttribute(attr.name);
          return;
        }
        if (name.startsWith('data-') && !PUBLISHED_DISPLAY_DATA_ATTRIBUTES.has(name)
          && !(opts.preserveFormControls && PUBLISHED_DATA_ATTRIBUTE_ALLOWLIST.has(name))) {
          node.removeAttribute(attr.name);
          return;
        }
        if (name === 'href' && String(node.localName || '').toLowerCase() !== 'image') {
          const safe = _safePublishedLink(attr.value);
          if (safe) {
            node.setAttribute(attr.name, safe);
            if (node.tagName === 'A') node.setAttribute('rel', 'noopener noreferrer');
          } else node.removeAttribute(attr.name);
        }
      });
      const style = node.getAttribute?.('style') || '';
      if (/url\(\s*(["']?)(?!data:|__MELDEX_ASSET_BASE__\/)/i.test(style)) {
        throw new Error('公開HTMLに未埋込みのCSS資産が残っています');
      }
    });
    clone.querySelectorAll('img[src],image[href],image[xlink\\:href],video[src],audio[src],source[src],[poster]').forEach(node => {
      const attr = node.hasAttribute('src') ? 'src' : node.hasAttribute('poster') ? 'poster'
        : node.hasAttribute('href') ? 'href' : 'xlink:href';
      const value = String(node.getAttribute(attr) || '');
      if (!value.startsWith('data:')
        && !new RegExp(`^${ASSET_BASE_TOKEN}/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$`).test(value)) {
        throw new Error('公開HTMLに未埋込みのローカル資産が残っています');
      }
    });
    return clone;
  }

  // ================================================================
  // 2. ルビ変換
  // ================================================================

  /** span[data-ruby] → ネイティブ <ruby><rt> に変換 */
  function convertDataRuby(el) {
    el.querySelectorAll('[data-ruby]').forEach(node => {
      const rubyText = node.getAttribute('data-ruby');
      if (!rubyText) return;
      const baseText = node.textContent || '';
      const ruby = document.createElement('ruby');
      ruby.appendChild(document.createTextNode(baseText));
      const rt = document.createElement('rt');
      rt.textContent = rubyText;
      ruby.appendChild(rt);
      node.replaceWith(ruby);
    });
  }

  // ================================================================
  // 3. CSS変数の収集
  // ================================================================

  /** :root の CSS 変数を実値に解決して返す */
  function collectCssVars() {
    const rootStyle = getComputedStyle(document.documentElement);
    // 決め打ちの一覧だけでは、ノートの見出し色・太さ（--page-*）やファイルテーマ等の変数が
    // 出力から欠ける。計算済みのカスタムプロパティをすべて書き出す（一覧は互換のため残す）。
    const allDecls = [];
    for (let i = 0; i < rootStyle.length; i++) {
      const name = rootStyle[i];
      if (!name || !name.startsWith('--')) continue;
      const value = rootStyle.getPropertyValue(name).trim();
      if (value) allDecls.push(`${name}: ${value};`);
    }
    if (allDecls.length) return allDecls.join(' ');
    const varNames = [
      '--bg', '--bg2', '--bg3', '--bg4',
      '--fg', '--fg2', '--accent', '--accent2',
      '--border', '--selection',
      '--ui-header-fg', '--ui-header-bg',
      '--ui-header-font',
      '--ui-toolbar-fg', '--ui-toolbar-bg',
      '--ui-toolbar-font', '--ui-muted-font',
      '--ui-hover-fg', '--ui-hover-bg',
      '--ui-fg-strong',
      '--ui-selection-fg', '--ui-selection-bg',
      '--ui-range-fill-bg', '--ui-range-track-bg',
      '--ui-scrollbar-track-bg', '--ui-scrollbar-thumb-bg', '--ui-scrollbar-thumb-hover-bg',
      '--ui-font', '--ui-font-size',
      '--db-th-font', '--db-entity-font', '--db-cell-font',
      '--red', '--green', '--blue', '--yellow', '--orange', '--purple',
    ];
    return varNames
      .map(v => {
        const val = rootStyle.getPropertyValue(v).trim();
        return val ? `${v}: ${val};` : '';
      })
      .filter(Boolean)
      .join(' ');
  }

  // ================================================================
  // 4. フォント埋め込み
  // ================================================================

  /** 埋め込み可能な Noto Sans JP のウェイト定義（fonts/ に同梱済みのwoff2のみ） */
  const EXPORT_FONT_WEIGHTS = {
    regular: { file: 'fonts/NotoSansJP-Regular.woff2', weight: 400 },
    medium: { file: 'fonts/NotoSansJP-Medium.woff2', weight: 500 },
    bold: { file: 'fonts/NotoSansJP-Bold.woff2', weight: 700 },
  };

  /** Noto Sans JP を data URI で埋め込む。既定は Regular のみ。
      太字を使うビュー（エントリレイアウトのセル書式等）は weights: ['regular','bold'] を渡す。 */
  // ---- 使っている文字だけのフォント（どの端末でも画面と同じ字形にする） ----

  const SUBSET_TEXT_ATTRIBUTES = ['data-ruby', 'data-ruby-rendered', 'data-before', 'data-after', 'data-export-text'];

  /** 画面の要素の中で使っているフォントの指定（書体・太さ・斜体）と文字を集める */
  function collectFontUsage(rootEl) {
    const requests = new Map();
    const chars = new Set();
    if (!rootEl) return { requests: [], text: '' };
    const add = cs => {
      if (!cs) return;
      const family = cs.fontFamily || '';
      const weight = parseInt(cs.fontWeight, 10) || 400;
      const italic = cs.fontStyle === 'italic' || cs.fontStyle === 'oblique';
      const key = family + '|' + weight + '|' + italic;
      if (!requests.has(key)) requests.set(key, { family, weight, italic });
    };
    [rootEl, ...rootEl.querySelectorAll('*')].forEach(node => {
      add(getComputedStyle(node));
      for (const pseudo of ['::before', '::after']) {
        const pcs = getComputedStyle(node, pseudo);
        if (pcs.content && pcs.content !== 'none' && pcs.content !== 'normal') add(pcs);
      }
      SUBSET_TEXT_ATTRIBUTES.forEach(name => {
        const value = node.getAttribute?.(name);
        if (value) for (const ch of value) chars.add(ch);
      });
    });
    for (const ch of rootEl.textContent || '') chars.add(ch);
    return { requests: Array.from(requests.values()), text: Array.from(chars).join('') };
  }

  /** 使っている文字だけのフォントの @font-face を作る（デスクトップ版の本体で作る）。
      作れない環境（Cloud版・単独アプリ・本体が古い）では null を返し、呼び出し元は従来の埋め込みに戻る。 */
  async function subsetFontCss(rootEl) {
    if (typeof apiPost !== 'function') return null;
    if (typeof MeldexExportSave !== 'undefined' && MeldexExportSave.isBrowserDataContext?.()) return null;
    const usage = collectFontUsage(rootEl);
    if (!usage.requests.length) return null;
    try {
      const result = await apiPost('/export/font-subset', { fonts: usage.requests, text: usage.text }, { silentError: true, timeoutMs: 180000 });
      if (!result || typeof result.css !== 'string' || !result.css) return null;
      return result;
    } catch {
      return null;
    }
  }

  async function embedFont(weights, assetCollector) {
    const list = Array.isArray(weights) && weights.length ? weights : ['regular'];
    const parts = [];
    for (const key of list) {
      const def = EXPORT_FONT_WEIGHTS[key];
      if (!def) continue;
      try {
        const r = await fetch(def.file);
        if (!r.ok) continue;
        const blob = await r.blob();
        const source = assetCollector
          ? await assetCollector.addBlob(blob, def.file)
          : await _blobToDataUri(blob);
        parts.push(`@font-face { font-family: 'Noto Sans JP'; font-style: normal; font-weight: ${def.weight}; src: url('${source}') format('woff2'); }`);
      } catch { /* このウェイトはフォールバックフォントに任せる */ }
    }
    return parts.join('\n');
  }

  // ================================================================
  // 5. 完全静的化CSS
  // ================================================================

  function getStaticCss(options) {
    // 見た目を固定した公開HTMLでは、画面と同じに描いたチェックボックス・ボタンを隠したり
    // 不透明度を変えたりしない（操作は inert で止める）
    const frozen = !!options?.frozen;
    return `
/* 完全静的化: インタラクティブ要素を無効化 */
* { cursor: default !important; }
*:hover, *:focus, *:active { outline: none !important; }
*::selection { background: rgba(100,150,255,0.2); }
[contenteditable] { -webkit-user-modify: read-only; caret-color: transparent; }
${frozen ? '[inert] { pointer-events: none; }' : `input, textarea, select { display: none !important; }
button[disabled] { cursor: default !important; opacity: 1 !important; pointer-events: none; }`}
a { pointer-events: none; }
/* 印刷時の背景色保持 */
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`;
  }

  // ================================================================
  // 6. CSS取得ヘルパー
  // ================================================================

  function _resolveCssUrl(url, baseUrl) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    try {
      return new URL(raw, baseUrl ? new URL(baseUrl, document.baseURI) : document.baseURI).toString();
    } catch {
      return raw;
    }
  }

  function _withCacheBust(url) {
    const sep = String(url).includes('?') ? '&' : '?';
    return `${url}${sep}_=${Date.now()}`;
  }

  async function _inlineCssImports(cssText, baseUrl, seen, assetCollector) {
    const importRe = /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?[^;]*;/gi;
    let out = '';
    let last = 0;
    let match;
    while ((match = importRe.exec(cssText))) {
      out += cssText.slice(last, match.index);
      const importUrl = _resolveCssUrl(match[1], baseUrl);
      if (importUrl) out += await fetchCss(importUrl, seen, assetCollector) + '\n';
      last = match.index + match[0].length;
    }
    return _inlineCssUrls(out + cssText.slice(last), baseUrl, assetCollector);
  }

  async function _blobToDataUri(blob) {
    if (!blob || blob.size > INLINE_ASSET_MAX_BYTES) {
      throw new Error('公開資産がインライン上限50MBを超えています');
    }
    const reader = new FileReader();
    return new Promise((resolve, reject) => {
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('公開資産を読み込めませんでした'));
      reader.readAsDataURL(blob);
    });
  }

  async function _fetchAssetDataUri(rawUrl, baseUrl, assetCollector) {
    const raw = String(rawUrl || '').trim().replace(/^['"]|['"]$/g, '');
    if (!raw || raw.startsWith('data:')) return raw;
    if (raw.startsWith('#')) return raw;
    const resolved = _resolveCssUrl(raw, baseUrl);
    let response;
    try { response = await fetch(resolved, { cache: 'no-store' }); }
    catch { throw new Error('公開資産を取得できません: ' + raw.slice(0, 160)); }
    if (!response.ok) throw new Error('公開資産を取得できません (' + response.status + '): ' + raw.slice(0, 160));
    const blob = await response.blob();
    return assetCollector ? assetCollector.addBlob(blob, resolved) : _blobToDataUri(blob);
  }

  async function _inlineCssUrls(cssText, baseUrl, assetCollector) {
    const source = String(cssText || '');
    const pattern = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;
    let output = '';
    let last = 0;
    let match;
    while ((match = pattern.exec(source))) {
      output += source.slice(last, match.index);
      const raw = String(match[2] || '').trim();
      if (!raw || raw.startsWith('data:') || raw.startsWith('#')) output += match[0];
      else output += `url("${await _fetchAssetDataUri(raw, baseUrl, assetCollector)}")`;
      last = match.index + match[0].length;
    }
    return output + source.slice(last);
  }

  /** 外部CSSファイルを取得し、@import も自己完結用に展開する（キャッシュバイパス付き） */
  async function fetchCss(url, seen, assetCollector) {
    const resolvedUrl = _resolveCssUrl(url);
    if (!resolvedUrl) return '';
    const visited = seen || new Set();
    if (visited.has(resolvedUrl)) return '';
    visited.add(resolvedUrl);
    try {
      const res = await fetch(_withCacheBust(resolvedUrl), { cache: 'no-store' });
      if (!res.ok) throw new Error('公開用CSSを取得できません (' + res.status + '): ' + resolvedUrl);
      const cssText = await res.text();
      return await _inlineCssImports(cssText, resolvedUrl, visited, assetCollector);
    } catch (error) {
      throw error instanceof Error ? error : new Error('公開用CSSを取得できません: ' + resolvedUrl);
    }
  }

  // ================================================================
  // 7. 画像の data URI 化
  // ================================================================

  /** クローン内の画像・media・style URLを data URI に変換する。失敗は公開停止。 */
  async function embedImages(clone, assetCollector) {
    const assets = clone.querySelectorAll('img[src],image[href],image[xlink\\:href],video[src],audio[src],source[src],[poster]');
    for (const node of assets) {
      const attr = node.hasAttribute('src') ? 'src' : node.hasAttribute('poster') ? 'poster'
        : node.hasAttribute('href') ? 'href' : 'xlink:href';
      const src = node.getAttribute(attr);
      if (!src || src.startsWith('data:')) continue;
      node.setAttribute(attr, await _fetchAssetDataUri(src, document.baseURI, assetCollector));
    }
    clone.querySelectorAll('[srcset]').forEach(node => node.removeAttribute('srcset'));
    for (const node of [clone, ...clone.querySelectorAll('[style]')]) {
      const style = node.getAttribute?.('style') || '';
      if (/url\(/i.test(style)) node.setAttribute('style', await _inlineCssUrls(style, document.baseURI, assetCollector));
    }
  }

  // ================================================================
  // 8. HTML組み立て
  // ================================================================

  function buildHtml(title, bodyHtml, css, fontCss, extraHeadHtml, options) {
    const escHtml = MeldexEscape.html;
    const suppliedHead = String(extraHeadHtml || '');
    const csp = /Content-Security-Policy/i.test(suppliedHead) ? ''
      : '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; media-src data:">';
    return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="color-scheme" content="dark light">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="referrer" content="no-referrer">
${csp}
<title>${escHtml(title)}</title>
<style>
${fontCss}
${css}
${getStaticCss(options)}
</style>
${suppliedHead}
</head>
<body>
${bodyHtml}
</body>
</html>`;
  }

  // ================================================================
  // 9. 保存ダイアログ呼び出し
  // ================================================================

  function _publishSaveContext(ctx) {
    if (!ctx?.path || !ctx?.kind) return null;
    return {
      source_path: String(ctx.path),
      source_kind: String(ctx.kind),
      source_revision: String(ctx.board?.sourceRevision || ''),
      context_policy: ctx.kind === 'board' ? 'saved-active-board' : 'active-context-snapshot',
      view_id: String(ctx.viewId || ''),
    };
  }

  let _pendingPublishDialogOperation = null;

  function _newPublishOperationId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    globalThis.crypto?.getRandomValues?.(bytes);
    return 'publish-' + Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  }

  async function saveWithDialog(htmlOrPackage, title, publishCtx) {
    if (typeof MeldexExportSave !== 'undefined' && typeof MeldexExportSave.saveText === 'function') {
      const publicationPackage = htmlOrPackage && typeof htmlOrPackage === 'object' && typeof htmlOrPackage.html === 'string'
        ? htmlOrPackage
        : null;
      const html = publicationPackage ? publicationPackage.html : String(htmlOrPackage || '');
      const publishContext = _publishSaveContext(publishCtx);
      const operationKey = publishContext ? JSON.stringify({
        html,
        assets: (publicationPackage?.assets || []).map(asset => ({
          name: asset.name, size: asset.size, sha256: asset.sha256,
        })),
        publishContext,
      }) : '';
      if (publishContext && _pendingPublishDialogOperation?.key !== operationKey) {
        _pendingPublishDialogOperation = { key: operationKey, id: _newPublishOperationId() };
      }
      const options = {
        title,
        extension: '.html',
        ...(publishCtx ? {
          initialfile: defaultPublishHtmlName(publishCtx),
          initialdir: publishSourceFolder(publishCtx),
        } : {}),
        dialogTitle: 'HTMLとして保存',
        filetypes: [['HTMLファイル', '*.html'], ['すべてのファイル', '*.*']],
        bom: true,
        registerPublishPath: !!publishCtx,
        publishContext,
        operationId: publishContext ? _pendingPublishDialogOperation.id : '',
        okMessage: 'HTML として保存しました',
        errorMessage: 'HTML の保存に失敗しました',
      };
      const result = publicationPackage && typeof MeldexExportSave.savePublicationPackage === 'function'
        ? await MeldexExportSave.savePublicationPackage(publicationPackage, options)
        : await MeldexExportSave.saveText(html, options);
      if (result && publishContext) _pendingPublishDialogOperation = null;
      return result;
    }
    showStatus('保存ダイアログを初期化できませんでした', true);
    return false;
  }

  // ================================================================
  // 10. エディタ別の前処理 + エクスポート
  // ================================================================

  /** 汎用 exportToHtml: contentEl をクローンし自己完結HTML文字列を生成 */
  async function exportToHtml(contentEl, options) {
    const opts = options || {};
    const clone = cloneAndClean(contentEl);
    if (opts.inheritComputedContext) applyComputedContext(contentEl, clone);

    // ルビ変換（画面と同じ組み方を保つビューは data-ruby の表示をそのまま使う）
    if (!opts.keepDataRuby) convertDataRuby(clone);

    // エディタ固有の前処理コールバック
    if (typeof opts.preTransform === 'function') {
      opts.preTransform(clone);
    }

    // 画像の data URI 化
    if (opts.embedImages !== false) {
      await embedImages(clone);
    }
    sanitizePublishedClone(clone, { preserveFormControls: !!opts.preserveFormControls });

    // CSS
    const varDecls = collectCssVars();
    let cssText = (opts.appReset ? APP_RESET_CSS + '\n' : '') + `:root { ${varDecls} }\n`;
    cssText += `html, body {
  margin: 0; padding: 0;
  background: var(--bg, #1e1e1e);
  color: var(--fg, #d4d4d4);
  font-family: var(--ui-font, 'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic UI', 'Meiryo', sans-serif);
  font-size: var(--ui-font-size, 15px);
}\n`;

    // 追加CSSファイル
    if (opts.cssFiles) {
      for (const url of opts.cssFiles) {
        cssText += await fetchCss(url) + '\n';
      }
    }
    // 追加インラインCSS
    if (opts.extraCss) {
      cssText += await _inlineCssUrls(opts.extraCss, document.baseURI) + '\n';
    }

    // フォント埋め込み（fontWeights で太字等の追加ウェイトを指定できる）
    const fontCss = opts.embedFont !== false ? await embedFont(opts.fontWeights) : '';

    const title = opts.title || document.title || '無題';
    return buildHtml(title, clone.outerHTML, cssText, fontCss, opts.extraHeadHtml);
  }

  // ================================================================
  // 11. 各ビューのエクスポートエントリポイント
  // ================================================================

  async function exportCurrentView(viewType) {
    try {
      const builders = {
        page: _exportNotePage, database: _exportDatabase, csv: _exportCsv,
        calendar: _exportCalendar, board: _exportBoard, 'entity-layout': _exportEntityLayout,
      };
      if (!builders[viewType]) {
        showStatus('このビューのHTML出力は未対応です', true);
        return;
      }
      // HTMLの作成中は処理パネルに出す（ステータスバーには進捗を出さない。2026-11-21）。保存のダイアログの前に閉じる。
      const html = typeof runWithProgress === 'function'
        ? await runWithProgress('HTMLを作成しています', () => builders[viewType](), { kind: 'export-html' })
        : await builders[viewType]();
      if (!html) return;
      const title = _getViewTitle(viewType);
      await saveWithDialog(html, title, null);
    } catch (err) {
      showStatus('HTML出力に失敗しました: ' + (err?.message || err), true);
    }
  }

  async function publishCurrentView(viewType, opts) {
    const publishOpts = opts || {};
    let publishCtx = publishOpts.contextSnapshot
      || (typeof createPublishContextSnapshot === 'function' ? createPublishContextSnapshot(viewType) : null);
    if (!publishCtx || (typeof isPublishContextSnapshotCurrent === 'function' && !isPublishContextSnapshotCurrent(publishCtx, true))) {
      return false;
    }
    if ((publishCtx.kind === 'board' && !publishCtx.board || publishCtx.kind === 'form-app' && !publishCtx.formSourceId) && typeof preparePublishContextSnapshot === 'function') {
      publishCtx = await preparePublishContextSnapshot(publishCtx);
      if (!publishCtx) return false;
    }
    const kind = viewType || publishCtx.kind;
    if (!PUBLISH_SOURCE_KINDS.includes(kind) || kind !== publishCtx.kind) {
      showStatus('このビューは公開HTMLに未対応です', true);
      return false;
    }
    if (typeof MeldexPublicRuntime === 'undefined' || typeof MeldexPublicRuntime.buildPublishHtml !== 'function') {
      showStatus('公開HTMLランタイムを読み込めませんでした', true);
      return false;
    }
    let cfg = typeof getPublishConfigForContext === 'function' ? getPublishConfigForContext(publishCtx) : {};
    if (typeof assertPublishAllowedForContext === 'function' && !await assertPublishAllowedForContext(publishCtx)) {
      return false;
    }
    if (typeof assertPublishSourceRevisionCurrent === 'function' && !await assertPublishSourceRevisionCurrent(publishCtx)) {
      return false;
    }
    if (typeof isPublishContextSnapshotCurrent === 'function' && !isPublishContextSnapshotCurrent(publishCtx, true)) {
      return false;
    }
    const browserData = typeof MeldexExportSave !== 'undefined' && !!MeldexExportSave.isBrowserDataContext?.();
    let formTargetPath = '';
    let formIntake = null;
    if (kind === 'form-app' && browserData) {
      formTargetPath = String(publishOpts.targetPath || (!publishOpts.changePath && (cfg.html_vault_path || cfg.html_path)) || '');
      if (!formTargetPath) formTargetPath = await pickPublishTargetPath(publishCtx, cfg);
      if (!formTargetPath || !isPublishContextSnapshotCurrent(publishCtx, true)) return false;
      const app = _publishFormAppForPath(publishCtx.path);
      const channel = cfg.intake_channel || await MeldexCloudFormRelay.createChannel();
      app._update(doc => { doc.publish = { ...doc.publish, intake_channel: channel }; }, { history: false });
      if (!await app.flush()) return false;
      cfg = getPublishConfigForContext(publishCtx);
      const folderPath = formTargetPath.includes('/') ? formTargetPath.slice(0, formTargetPath.lastIndexOf('/')) : '';
      const folder = await MeldexStorageAdapter.getProvider().getMetadata(folderPath);
      if (!folder?.id) throw new Error('公開先フォルダの識別番号を確認できません');
      formIntake = { channel_id: channel.id, public_key: channel.publicKey, artifact_path: formTargetPath,
        folder_id: folder.id,
        generation: await MeldexCloudFormRelay.generation(cfg.form_source_id, cfg.form_submit_token),
        cloud_url: new URL(location.pathname, location.origin).href };
    }
    // 公開設定にコンテキスト由来の値を合成してランタイムへ渡す
    const mergedCfg = {
      ...cfg,
      title: _getViewTitle(kind),
      db_path: kind === 'board' ? '' : (publishCtx.path || cfg.db_path || ''),
      board_snapshot: publishCtx.board || null,
      form_source_id: publishCtx.formSourceId || '',
      form_app: kind === 'form-app' ? _publishFormAppForPath(publishCtx.path) : null,
      intake: formIntake,
    };
    // 公開用のHTMLの作成中は処理パネルに出す（ステータスバーには進捗を出さない。2026-11-21）。
    const buildPublication = async () => {
      if (kind === 'scriptnote') {
        // シナリオは HTML保存・画像と同じ静的スナップショットを公開する（設定の反映を一致させる）
        const pkg = await _buildScriptNotePublicationPackage(publishCtx, cfg);
        if (pkg) mergedCfg.title = pkg.title || mergedCfg.title;
        return pkg || false;
      }
      return typeof MeldexPublicRuntime.buildPublishPackage === 'function'
        ? await MeldexPublicRuntime.buildPublishPackage(kind, mergedCfg)
        : { html: await MeldexPublicRuntime.buildPublishHtml(kind, mergedCfg), assets: [] };
    };
    const publicationPackage = typeof runWithProgress === 'function'
      ? await runWithProgress('公開用のHTMLを作成しています', buildPublication, { kind: 'publish-html' })
      : await buildPublication();
    if (!publicationPackage) return false;
    const html = publicationPackage?.html;
    if (!html) return false;
    if (typeof isPublishContextSnapshotCurrent === 'function' && !isPublishContextSnapshotCurrent(publishCtx, true)) {
      return false;
    }
    if (typeof assertPublishAllowedForContext === 'function' && !await assertPublishAllowedForContext(publishCtx)) return false;
    if (typeof assertPublishSourceRevisionCurrent === 'function' && !await assertPublishSourceRevisionCurrent(publishCtx)) return false;
    let result = false;
    let targetPath = formTargetPath || String(publishOpts.targetPath || '');
    if (!targetPath && !cfg.html_path && !publishOpts.changePath) {
      // 未公開のファイルは、元のファイルと同じフォルダの「元の名前.html」へ保存する
      targetPath = defaultPublishHtmlPath(publishCtx);
    }
    if (!targetPath && browserData) {
      // Cloud版にはOSの保存ダイアログが無い。フォルダツリーで保存先フォルダを選ぶ。
      targetPath = publishOpts.changePath ? await pickPublishTargetPath(publishCtx, cfg) : String(cfg.html_path || '');
      if (!targetPath) return false;
    }
    if (targetPath) {
      const recordedEtag = targetPath === String(cfg.html_path || '') ? String(cfg.html_etag || '') : '';
      result = await savePublicationToTarget(targetPath, publicationPackage, publishCtx, recordedEtag);
    } else if (cfg.html_path && cfg.html_etag && !publishOpts.changePath && typeof MeldexExportSave !== 'undefined' && typeof MeldexExportSave.saveTextDirect === 'function') {
      const directOptions = {
        bom: true,
        allowRegister: false,
        ifMatchEtag: cfg.html_etag,
        publishContext: _publishSaveContext(publishCtx),
        okMessage: '公開HTMLを更新しました',
        errorMessage: '公開HTMLの更新に失敗しました',
      };
      result = typeof MeldexExportSave.savePublicationPackageDirect === 'function'
        ? await MeldexExportSave.savePublicationPackageDirect(cfg.html_path, publicationPackage, directOptions)
        : await MeldexExportSave.saveTextDirect(cfg.html_path, html, directOptions);
      if (result?.missing) {
        // 記録した公開HTMLが消されていた時は、同じ場所へ作り直す（同じ名前のファイルがあれば確認する）
        result = await savePublicationToTarget(String(cfg.html_vault_path || cfg.html_path), publicationPackage, publishCtx, '');
      }
    } else {
      result = await saveWithDialog(publicationPackage, mergedCfg.title, publishCtx);
    }
    if (result?.path
      && (typeof isPublishContextSnapshotCurrent !== 'function' || isPublishContextSnapshotCurrent(publishCtx, true))
      && typeof savePublishConfigForContext === 'function') {
      const next = {
        ...(cfg || {}),
        html_path: result.path,
        html_etag: result.etag || '',
        html_vault_path: result.vault_relative_path || (browserData ? result.path : ''),
        last_published_at: new Date().toISOString(),
      };
      await savePublishConfigForContext(publishCtx, next);
      if (kind === 'form-app') _publishFormAppForPath(publishCtx.path)?._scheduleResponseIntake?.();
    }
    if (result?.path) _reportPublishedLocation(result, browserData);
    return !!result;
  }

  // ---- 公開先（保存場所）の決め方 ----

  const PUBLISH_SOURCE_SUFFIX_RE = /(\.mel-[a-z0-9-]+|\.scriptnote\.json|\.[A-Za-z0-9]{1,8})$/i;

  function _splitDirAndName(path) {
    const normalized = String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const index = normalized.lastIndexOf('/');
    return index >= 0
      ? { dir: normalized.slice(0, index), name: normalized.slice(index + 1) }
      : { dir: '', name: normalized };
  }

  /** 公開HTMLの既定のファイル名（元のファイルの名前＋ .html） */
  function defaultPublishHtmlName(ctx) {
    const { name } = _splitDirAndName(ctx?.path);
    // シート・カレンダーはフォルダそのものが元ファイル。フォルダ名をそのまま使う。
    const folderKind = ctx?.kind === 'database' || ctx?.kind === 'calendar';
    const stem = (folderKind ? name : name.replace(PUBLISH_SOURCE_SUFFIX_RE, '')) || name || '公開';
    const safe = typeof MeldexExportSave !== 'undefined' && typeof MeldexExportSave.sanitizeTitle === 'function'
      ? MeldexExportSave.sanitizeTitle(stem, '公開')
      : stem;
    return safe + '.html';
  }

  /** 公開HTMLの既定の保存先（元のファイルと同じフォルダ。Meldexの保存先からの位置） */
  function defaultPublishHtmlPath(ctx) {
    if (!ctx?.path) return '';
    const { dir } = _splitDirAndName(ctx.path);
    const name = defaultPublishHtmlName(ctx);
    return dir ? dir + '/' + name : name;
  }

  /** 元のファイルがあるフォルダ（OSの保存ダイアログの開始位置） */
  function publishSourceFolder(ctx) {
    return _splitDirAndName(ctx?.path).dir;
  }

  /** フォルダツリーで保存先フォルダを選ぶ。ファイル名は記録済みの名前、無ければ既定の名前。 */
  async function pickPublishTargetPath(ctx, cfg) {
    if (!window.GBFolderPicker?.pickFolder) {
      showStatus('フォルダ選択を読み込めませんでした', true);
      return '';
    }
    const recorded = String(cfg?.html_vault_path || '');
    const initialFolder = recorded ? _splitDirAndName(recorded).dir : publishSourceFolder(ctx);
    const selection = await window.GBFolderPicker.pickFolder({
      title: '公開HTMLの保存先フォルダを選択',
      includeHome: true,
      includeSources: true,
      includeWorkspaces: true,
      initialPath: initialFolder,
      revealPath: initialFolder,
    });
    if (!selection?.path) return '';
    const fileName = _splitDirAndName(cfg?.html_path || '').name || defaultPublishHtmlName(ctx);
    const folder = String(selection.path).replace(/\\/g, '/').replace(/\/+$/, '');
    return folder ? folder + '/' + fileName : fileName;
  }

  function _confirmPublishOverwrite(path) {
    const name = _splitDirAndName(path).name || path;
    if (typeof showConfirmDialog !== 'function') return Promise.resolve(false);
    return new Promise(resolve => {
      try {
        showConfirmDialog(`「${name}」は既にあります。上書きしますか？`, () => resolve(true), () => resolve(false));
      } catch { resolve(false); }
    });
  }

  /** 決まった保存先へ公開HTMLを保存する。既にファイルがある時は上書きを確認する。 */
  async function savePublicationToTarget(targetPath, publicationPackage, publishCtx, recordedEtag) {
    if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.savePublicationToPath !== 'function') {
      showStatus('保存処理を初期化できませんでした', true);
      return false;
    }
    const publishContext = _publishSaveContext(publishCtx);
    const operationKey = JSON.stringify({ targetPath, html: publicationPackage?.html || '', publishContext });
    if (_pendingPublishDialogOperation?.key !== operationKey) {
      _pendingPublishDialogOperation = { key: operationKey, id: _newPublishOperationId() };
    }
    const result = await MeldexExportSave.savePublicationToPath(targetPath, publicationPackage, {
      bom: true,
      publishContext,
      operationId: _pendingPublishDialogOperation.id,
      ifMatchEtag: recordedEtag || '',
      okMessage: '公開HTMLを保存しました',
      errorMessage: '公開HTMLの保存に失敗しました',
      confirmOverwrite: _confirmPublishOverwrite,
    });
    if (result) _pendingPublishDialogOperation = null;
    return result;
  }

  function _reportPublishedLocation(result, browserData) {
    if (!browserData && result.inside_vault === false) {
      showStatus('Meldexの保存先（Dropbox）の外に保存しました。共有するにはDropboxの中へ保存し直してください', true);
    }
  }

  function _activeScriptNoteEditorForPath(path) {
    const editor = typeof _sn2GetActiveEditor === 'function' ? _sn2GetActiveEditor() : null;
    if (!editor?.doc) return null;
    const norm = value => String(value || '').replace(/\\/g, '/');
    if (path && norm(editor._path) !== norm(path)) return null;
    return editor;
  }

  async function _buildScriptNotePublicationPackage(publishCtx, cfg) {
    if (typeof buildScriptNoteExportDocument !== 'function') {
      showStatus('シナリオの公開HTMLを生成できませんでした', true);
      return null;
    }
    const editor = _activeScriptNoteEditorForPath(publishCtx?.path);
    if (!editor) {
      showStatus('公開対象のシナリオが表示されていないため公開を停止しました', true);
      return null;
    }
    const snapshot = await buildScriptNoteExportDocument(editor, {
      purpose: 'publish',
      embedFont: cfg?.embed_font !== false,
    });
    if (!snapshot?.html) {
      showStatus('公開できるシナリオ内容がありません', true);
      return null;
    }
    return { html: snapshot.html, assets: [], title: snapshot.title };
  }

  function _getViewTitle(viewType) {
    switch (viewType) {
      case 'form-app': {
        const context = typeof getCurrentPublishContext === 'function' ? getCurrentPublishContext() : null;
        const app = context?.path ? _publishFormAppForPath(context.path) : null;
        return app?.getConfig?.(app.ctx?.pivotData?.properties || [], app.ctx?.dbMetadata?.property_types || {})?.headerTitle || app?.store?.doc.formConfig?.headerTitle
          || app?.store?.doc.title || context?.label || 'フォーム';
      }
      case 'scriptnote': {
        const editor = _activeScriptNoteEditorForPath('');
        const stem = String(editor?._path || '').split('/').pop().replace(/(\.mel-scenario|\.scriptnote\.json)$/i, '');
        return String(editor?.doc?.title || stem || 'シナリオ');
      }
      case 'page': {
        const pc = (window.GBEditorHost?.surfaceElement?.('page-content') || document.getElementById('page-content'));
        const h1 = pc?.querySelector('h1, h2, h3');
        return h1?.textContent || pc?.dataset?.path?.split('/').pop()?.replace(/\.\w+$/, '') || 'ノート';
      }
      case 'entity': {
        const title = document.getElementById('entity-title')?.textContent?.trim();
        return title || state?.currentEntityPath?.split(/[\\/]/).pop()?.replace(/\.\w+$/, '') || 'トピック';
      }
      case 'database':
        return state?.currentDbPath?.split('/').pop() || 'シート';
      case 'csv':
        return (typeof _csvPath !== 'undefined' ? _csvPath : '').split('/').pop()?.replace(/\.\w+$/, '') || 'CSV';
      case 'calendar':
        return 'カレンダー';
      case 'board': {
        const path = (typeof bd !== 'undefined' && bd?.path) || '';
        return path.split('/').pop() || 'ボード';
      }
      case 'entity-layout': {
        const canvasEl = _findVisibleEntityLayoutCanvas();
        const grid = canvasEl?.closest('.entity-props-grid-container');
        const layoutName = grid?.querySelector('.el-tab.active .el-tab-label')?.textContent?.trim() || 'トピックレイアウト';
        const entityName = _entityLayoutEntityName(canvasEl);
        return entityName && entityName !== 'トピック' ? entityName + ' - ' + layoutName : layoutName;
      }
      default:
        return '無題';
    }
  }

  // --- エントリレイアウト ---

  /** 表示中のエントリレイアウトのキャンバス（等比フィット中の .el-canvas）を探す。
      書き出しメニュー（gb-db-entity-layout.js）が押された面の grid を
      window.__meldexEntityLayoutExportRoot に控えるため、複数面で同時に開いていても
      その面のキャンバスを優先する。 */
  function _findVisibleEntityLayoutCanvas() {
    const stashedRoot = window.__meldexEntityLayoutExportRoot;
    const scope = stashedRoot?.isConnected ? stashedRoot : document;
    const found = Array.from(scope.querySelectorAll('.el-viewport .el-canvas')).find(el => {
      if (!el.isConnected) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }) || null;
    if (found || scope === document) return found;
    return Array.from(document.querySelectorAll('.el-viewport .el-canvas')).find(el => {
      const rect = el.getBoundingClientRect();
      return el.isConnected && rect.width > 0 && rect.height > 0;
    }) || null;
  }

  /** 書き出し対象の面のエントリ名（サブパネル/右サイドバーはそれぞれのエントリ名を使う） */
  function _entityLayoutEntityName(canvasEl) {
    const surfaceRoot = canvasEl?.closest?.('[data-meldex-entity-detail]');
    const path = surfaceRoot?.dataset?.path || '';
    if (path) return path.split(/[\/]/).pop().replace(/\.\w+$/, '');
    return _getViewTitle('entity');
  }

  /** エントリレイアウトの編集チローム（削除/設定/リサイズ等）を静的出力から取り除く */
  function _stripEntityLayoutEditChrome(clone) {
    clone.querySelectorAll('.el-cell-remove, .el-cell-settings, .el-cell-resize').forEach(el => el.remove());
    clone.querySelectorAll('.el-cell.el-selected').forEach(el => el.classList.remove('el-selected'));
    clone.querySelectorAll('.el-cell.el-editable').forEach(el => el.classList.remove('el-editable'));
  }

  /** エントリレイアウト書き出しの共通オプション。PNG出力側（gb-export-image.js）と共有する。 */
  function entityLayoutExportOptions() {
    const canvasEl = _findVisibleEntityLayoutCanvas();
    if (!canvasEl) return null;
    const width = parseInt(canvasEl.style.width, 10) || canvasEl.offsetWidth || 1000;
    const height = parseInt(canvasEl.style.height, 10) || canvasEl.offsetHeight || 700;
    // セル書式で太字が使われている場合は Bold ウェイトも埋め込む（5.5節）
    const usesBold = !!canvasEl.querySelector('.el-cell[style*="font-weight"]');
    return {
      canvasEl,
      width,
      height,
      htmlOptions: {
        title: _getViewTitle('entity-layout'),
        cssFiles: ['gb-db-entity-layout.css', 'gb-tools.css', 'gb-ui.css'],
        extraCss: 'body { padding: 16px; } .el-canvas { position: relative; margin: 0 auto; }',
        fontWeights: usesBold ? ['regular', 'bold'] : ['regular'],
        preTransform: (clone) => {
          // 表示用の等比フィット transform: scale() を解除し、デザイン基準サイズのまま書き出す
          clone.style.transform = 'none';
          clone.style.position = 'relative';
          clone.style.width = width + 'px';
          clone.style.height = height + 'px';
          _stripEntityLayoutEditChrome(clone);
        },
      },
    };
  }

  async function _exportEntityLayout() {
    const opts = entityLayoutExportOptions();
    if (!opts) {
      showStatus('トピックレイアウトが表示されていません', true);
      return null;
    }
    return exportToHtml(opts.canvasEl, opts.htmlOptions);
  }

  // --- ノート ---
  // ノート本文の書き出し用スタイル。組方向を書き出し結果にも反映する。
  // 旧実装では #page-content にHTMLのインラインstyleがあり、ここで指定した余白等が
  // 実際には適用されていなかった（インラインstyleは外部CSSより優先されるため）。
  // レイアウトを外部CSSへ移したので、ここの指定が初めて効くようになっている。
  function noteExportCss(vertical) {
    if (!vertical) {
      return `
        #page-content, [id="page-content"] {
          padding: 16px 60px;
          line-height: 1.7;
          max-width: 900px;
          margin: 0 auto;
        }
        ruby { ruby-position: over; }
        rt { font-size: 0.55em; line-height: 1; color: inherit; opacity: 0.75; }
      `;
    }
    return `
        #page-content, [id="page-content"] {
          writing-mode: vertical-rl;
          text-orientation: mixed;
          font-feature-settings: "vert" 1, "vpal" 1;
          padding-block: 16px;
          padding-inline: 60px;
          line-height: 2.0;
          max-inline-size: 900px;
          margin-inline: auto;
          block-size: max-content;
          inline-size: auto;
          overflow: visible;
        }
        html, body { block-size: auto; }
        /* コードは縦組みにしない */
        #page-content pre, [id="page-content"] pre { writing-mode: horizontal-tb; }
        /* 番号は縦中横で正立させる */
        #page-content ol > li::marker, [id="page-content"] ol > li::marker { text-combine-upright: all; }
        ruby { ruby-position: inter-character; }
        rt { font-size: 0.55em; line-height: 1; color: inherit; opacity: 0.75; }
      `;
  }

  // ノートの HTML 保存・画像・公開で共通の出力設定（画面と同じ見た目にする）
  function noteExportOptions(pc, vertical, title) {
    return {
      title,
      cssFiles: ['gb-tools.css', 'gb-ui.css'],
      extraCss: noteExportCss(vertical),
      inheritComputedContext: true,
      keepDataRuby: true,
      appReset: true,
    };
  }

  async function _exportNotePage() {
    const pc = (window.GBEditorHost?.surfaceElement?.('page-content') || document.getElementById('page-content'));
    if (!pc) { showStatus('ノートが開かれていません', true); return null; }
    const vertical = !!(window.MeldexNoteWritingMode && window.MeldexNoteWritingMode.isVertical(pc));
    return exportToHtml(pc, noteExportOptions(pc, vertical, _getViewTitle('page')));
  }

  // --- データベース ---
  async function _exportDatabase() {
    const table = (window.GBEditorHost?.surfaceElement?.('pivot-table') || document.getElementById('pivot-table'));
    if (!table) { showStatus('シートが開かれていません', true); return null; }
    // テーブルの列幅を computed value で固定化
    // preTransform 実行前にオリジナルの測定値を収集する（クローンは未アタッチのため getComputedStyle が使えない）
    const origCells = table.querySelectorAll('th, td');
    const cellWidths = Array.from(origCells).map(cell => cell.getBoundingClientRect().width);
    // ステータスバッジの色もオリジナルから収集
    const origBadges = table.querySelectorAll('[class*="status-"]');
    const badgeStyles = Array.from(origBadges).map(badge => {
      const cs = getComputedStyle(badge);
      return { bg: cs.backgroundColor, color: cs.color };
    });
    const preTransform = (clone) => {
      const cloneCells = clone.querySelectorAll('th, td');
      cellWidths.forEach((w, i) => {
        if (cloneCells[i]) {
          cloneCells[i].style.width = w + 'px';
          cloneCells[i].style.minWidth = w + 'px';
        }
      });
      // ステータスバッジの色をインライン化（事前収集した値を使用）
      const cloneBadges = clone.querySelectorAll('[class*="status-"]');
      cloneBadges.forEach((badge, i) => {
        if (badgeStyles[i]) {
          badge.style.backgroundColor = badgeStyles[i].bg;
          badge.style.color = badgeStyles[i].color;
        }
      });
    };
    return exportToHtml(table, {
      title: _getViewTitle('database'),
      cssFiles: ['gb-tools.css', 'gb-ui.css'],
      extraCss: `
        table { border-collapse: collapse; table-layout: fixed; width: 100%; }
        th, td { border: 1px solid var(--border, #333); padding: 4px 8px; }
        thead { position: static; }
        body { padding: 16px; }
      `,
      preTransform,
      embedImages: false,
    });
  }

  // --- CSV ---
  async function _exportCsv() {
    const container = document.getElementById('csv-table-container');
    if (!container) { showStatus('CSVが開かれていません', true); return null; }
    const table = container.querySelector('table');
    if (!table) { showStatus('CSVテーブルが見つかりません', true); return null; }
    return exportToHtml(table, {
      title: _getViewTitle('csv'),
      extraCss: `
        table { border-collapse: collapse; table-layout: auto; }
        th, td { border: 1px solid var(--border, #333); padding: 4px 8px; white-space: pre-wrap; }
        thead th { background: var(--bg2, #252525); position: static; }
        body { padding: 16px; }
      `,
      embedImages: false,
    });
  }

  // --- カレンダー ---
  async function _exportCalendar() {
    const calIframe = document.querySelector('#calendar-container iframe, iframe[src*="calendar"]');
    const calRoot = document.querySelector('.gb-cal-root');
    if (!calIframe?.contentDocument && !calRoot) {
      showStatus('カレンダーの内容を取得できません', true);
      return null;
    }
    if (calRoot) {
      return exportToHtml(calRoot, {
        title: 'カレンダー',
        cssFiles: ['gb-tools.css', 'gb-ui.css'],
        extraCss: 'body { padding: 16px; }',
        embedImages: false,
      });
    }
    const calBody = calIframe.contentDocument.body;
    if (!calBody) { showStatus('カレンダーが読み込まれていません', true); return null; }
    // カレンダーiframe内のスタイルも取得
    let calCss = '';
    for (const sheet of calIframe.contentDocument.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          calCss += rule.cssText + '\n';
        }
      } catch { /* CORS制約の場合は無視 */ }
    }
    return exportToHtml(calBody, {
      title: 'カレンダー',
      extraCss: calCss + '\nbody { padding: 16px; }',
      embedImages: false,
    });
  }

  // --- ボード ---
  // 座標が負値を含む絶対配置カード + SVGオーバーレイという構造上、そのまま複製すると
  // 表示位置がずれる。PNG出力 (_bdExportImageBounds / _bdCreateExportStage, gb-canvas-features.part02.js)
  // と同じ「全カード・全ライン・全フレームの外接矩形を求めて原点(0,0)基準に平行移動する」
  // 方式を踏襲し、bounds計算は既存関数をそのまま再利用する（重複実装を避ける）。
  async function _exportBoard() {
    const canvasEl = document.getElementById('bd-canvas');
    if (!canvasEl) { showStatus('ボードが開かれていません', true); return null; }
    const bounds = (typeof _bdExportImageBounds === 'function') ? _bdExportImageBounds() : null;
    if (!bounds) { showStatus('ボードにトピックがありません', true); return null; }
    return exportToHtml(canvasEl, {
      title: _getViewTitle('board'),
      cssFiles: ['gb-tools.css', 'gb-ui.css'],
      extraCss: 'body { padding: 16px; }',
      preTransform: (clone) => {
        // #bd-canvas クローン自身を bounds サイズの静的コンテナ化する
        clone.style.position = 'relative';
        clone.style.flex = 'none';
        clone.style.width = bounds.width + 'px';
        clone.style.height = bounds.height + 'px';
        clone.style.overflow = 'hidden';
        const worldClone = clone.querySelector('[data-bd-role="world"]');
        if (!worldClone) return;
        // #bd-world クローンは現在のpan/zoomのtransformを引き継いでいるため上書きし、
        // bounds.x0/y0 分だけ平行移動して負座標のカードも可視領域に収める
        worldClone.style.position = 'absolute';
        worldClone.style.left = '0';
        worldClone.style.top = '0';
        worldClone.style.transformOrigin = '0 0';
        worldClone.style.transform = `translate(${-bounds.x0}px, ${-bounds.y0}px)`;
        worldClone.querySelectorAll('[data-bd-role="svg"]').forEach(svg => {
          svg.setAttribute('width', String(bounds.width));
          svg.setAttribute('height', String(bounds.height));
          svg.style.width = bounds.width + 'px';
          svg.style.height = bounds.height + 'px';
          svg.style.overflow = 'visible';
        });
        // 選択中カードのリサイズハンドル・選択枠・選択ハイライトは静的出力に不要なので除去
        const resizeLayer = worldClone.querySelector('[data-bd-role="resize-layer"]');
        if (resizeLayer) resizeLayer.innerHTML = '';
        clone.querySelectorAll('.bd-selected').forEach(el => el.classList.remove('bd-selected'));
      },
    });
  }

  // ================================================================
  // Public API
  // ================================================================

  return {
    PUBLISH_SOURCE_KINDS,
    freezeComputedStyles,
    frozenPublishCss,
    usedFontWeights,
    backdropColor,
    defaultPublishHtmlName,
    defaultPublishHtmlPath,
    pickPublishTargetPath,
    exportToHtml,
    exportCurrentView,
    publishCurrentView,
    cloneAndClean,
    sanitizePublishedClone,
    convertDataRuby,
    noteExportCss,
    noteExportOptions,
    applyComputedContext,
    APP_RESET_CSS,
    collectCssVars,
    createAssetCollector,
    ASSET_BASE_TOKEN,
    embedFont,
    collectFontUsage,
    subsetFontCss,
    embedImages,
    saveWithDialog,
    buildHtml,
    getStaticCss,
    fetchCss,
    inlineCssAssets: _inlineCssUrls,
    entityLayoutExportOptions,
  };

})();
