/* gb-scriptnote-ruby-presentation.js: Meldex Scenario ruby presentation model */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'meldex-scriptnote-ruby-presentation-defaults-v2';
  const VERSION = 2;
  const DEFAULTS = Object.freeze({
    version: VERSION,
    writingMode: 'horizontal',
    sizePercent: 50,
    gapEm: 0,
    letterSpacingEm: -1,
    lineHeight: 1.8,
    align: 'center',
    smallKana: 'keep',
    fontPreset: 'inherit',
    defaultStyle: 'group',
  });
  const LIMITS = Object.freeze({
    sizePercent: Object.freeze({ min: 5, max: 200 }),
    gapEm: Object.freeze({ min: -2, max: 4 }),
    letterSpacingEm: Object.freeze({ min: -2, max: 3 }),
    lineHeight: Object.freeze({ min: 0.5, max: 5 }),
  });
  const FONT_PRESETS = Object.freeze({
    inherit: 'inherit',
    'sans-jp': '"Noto Sans JP", "Yu Gothic UI", "Yu Gothic", sans-serif',
    'serif-jp': '"Noto Serif JP", "Yu Mincho", serif',
    'gothic-jp': '"BIZ UDPGothic", "Meiryo", sans-serif',
  });
  // 旧CSSの承認済み実測値。14pxの親文字span（交差方向は横14px／縦18px）へ
  // `100% - legacyOffsetPx` で置いた座標を、新しい仮想親文字端基準の
  // gapEmへ一度だけ変換してB-MANGA連携へ渡す。
  const LEGACY_TRANSFER_METRICS = Object.freeze({
    baseEmPx: 14,
    horizontalCrossSizePx: 14,
    verticalCrossSizePx: 18,
  });
  const SMALL_KANA = Object.freeze({
    'ぁ': 'あ', 'ぃ': 'い', 'ぅ': 'う', 'ぇ': 'え', 'ぉ': 'お',
    'っ': 'つ', 'ゃ': 'や', 'ゅ': 'ゆ', 'ょ': 'よ', 'ゎ': 'わ',
    'ゕ': 'か', 'ゖ': 'け',
    'ァ': 'ア', 'ィ': 'イ', 'ゥ': 'ウ', 'ェ': 'エ', 'ォ': 'オ',
    'ッ': 'ツ', 'ャ': 'ヤ', 'ュ': 'ユ', 'ョ': 'ヨ', 'ヮ': 'ワ',
    'ヵ': 'カ', 'ヶ': 'ケ',
  });

  function plain(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function clone(value) {
    if (!value || typeof value !== 'object') return value;
    return JSON.parse(JSON.stringify(value));
  }

  function finite(value, fallback, min, max) {
    if (value === undefined || value === null || String(value).trim() === '') return fallback;
    const number = typeof value === 'number' ? value : Number(String(value ?? '').trim());
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  function oneOf(value, allowed, fallback) {
    const normalized = String(value || '').trim();
    return allowed.includes(normalized) ? normalized : fallback;
  }

  function safeFontPreset(value) {
    const normalized = String(value || '').trim();
    if (!normalized || /[\\/:]/.test(normalized) || /^[a-z]:/i.test(normalized)) return 'inherit';
    return Object.prototype.hasOwnProperty.call(FONT_PRESETS, normalized) ? normalized : 'inherit';
  }

  function normalize(value, fallback = DEFAULTS) {
    const source = plain(value);
    const base = { ...DEFAULTS, ...plain(fallback) };
    const result = {
      ...source,
      version: VERSION,
      writingMode: oneOf(source.writingMode, ['horizontal', 'vertical'], base.writingMode),
      sizePercent: finite(source.sizePercent, base.sizePercent, LIMITS.sizePercent.min, LIMITS.sizePercent.max),
      gapEm: finite(source.gapEm, base.gapEm, LIMITS.gapEm.min, LIMITS.gapEm.max),
      letterSpacingEm: finite(source.letterSpacingEm, base.letterSpacingEm, LIMITS.letterSpacingEm.min, LIMITS.letterSpacingEm.max),
      lineHeight: finite(source.lineHeight, base.lineHeight, LIMITS.lineHeight.min, LIMITS.lineHeight.max),
      align: oneOf(source.align, ['center', 'start'], base.align),
      smallKana: oneOf(source.smallKana, ['keep', 'fullsize'], base.smallKana),
      fontPreset: safeFontPreset(source.fontPreset || base.fontPreset),
      defaultStyle: oneOf(source.defaultStyle, ['group', 'mono', 'jukugo'], base.defaultStyle),
    };
    if (source.compatibility && typeof source.compatibility === 'object') {
      const compatibility = plain(source.compatibility);
      result.compatibility = {
        legacySizeEm: finite(compatibility.legacySizeEm, 0.55, 0.05, 2),
        legacyOffsetPx: finite(compatibility.legacyOffsetPx, 3.5, -100, 100),
        useLegacySize: compatibility.useLegacySize === true,
        useLegacyGap: compatibility.useLegacyGap === true,
      };
    }
    return result;
  }

  function readStoredDefaults() {
    try {
      if (!global.localStorage) return { ...DEFAULTS };
      const parsed = JSON.parse(global.localStorage.getItem(STORAGE_KEY) || '{}');
      const normalized = normalize(parsed);
      delete normalized.compatibility;
      return normalized;
    } catch (_) {
      return { ...DEFAULTS };
    }
  }

  function writeStoredDefaults(value) {
    const normalized = normalize(value);
    delete normalized.compatibility;
    try { global.localStorage?.setItem(STORAGE_KEY, JSON.stringify(normalized)); } catch (_) {}
    return normalized;
  }

  function legacyPresentation(doc, defaults) {
    const editor = plain(doc?.editor);
    const explicitSize = editor.rubyFontSize !== undefined && editor.rubyFontSize !== null && editor.rubyFontSize !== '';
    const explicitOffset = editor.rubyOffset !== undefined && editor.rubyOffset !== null && editor.rubyOffset !== '';
    const hasContent = Array.isArray(doc?.rows) && doc.rows.some(row => String(row?.text || '').length > 0);
    if (!explicitSize && !explicitOffset && !hasContent) return null;
    const legacySizeEm = finite(editor.rubyFontSize, 0.55, 0.05, 2);
    const legacyOffsetPx = finite(editor.rubyOffset, 3.5, -100, 100);
    return normalize({
      ...defaults,
      writingMode: editor.viewMode === 'vertical' ? 'vertical' : 'horizontal',
      sizePercent: legacySizeEm * 100,
      gapEm: 0,
      // ルビ表示設定を保存していない既存文書は、既定値の変更（-1.0）に
      // 引きずられて見た目が変わらないよう従来の字間0を固定する。
      letterSpacingEm: 0,
      lineHeight: 1,
      compatibility: {
        legacySizeEm,
        legacyOffsetPx,
        useLegacySize: true,
        useLegacyGap: true,
      },
    }, defaults);
  }

  function ensureDocument(doc, options = {}) {
    if (!doc || typeof doc !== 'object') return normalize(options.defaults || readStoredDefaults());
    const defaults = normalize(options.defaults || readStoredDefaults());
    let presentation;
    const hasPresentation = doc.rubyPresentation && typeof doc.rubyPresentation === 'object';
    if (hasPresentation) {
      presentation = normalize(doc.rubyPresentation, defaults);
    } else {
      presentation = legacyPresentation(doc, defaults) || normalize({
        ...defaults,
        writingMode: doc.editor?.viewMode === 'vertical' ? 'vertical' : defaults.writingMode,
      });
    }
    doc.rubyPresentation = presentation;
    if (!doc.editor || typeof doc.editor !== 'object') doc.editor = {};
    doc.editor.viewMode = presentation.writingMode;
    return presentation;
  }

  function updateDocument(doc, patch) {
    const current = ensureDocument(doc);
    const nextSource = { ...current, ...plain(patch) };
    if (current.compatibility) {
      nextSource.compatibility = { ...current.compatibility };
      if (Object.prototype.hasOwnProperty.call(patch || {}, 'sizePercent')) nextSource.compatibility.useLegacySize = false;
      if (Object.prototype.hasOwnProperty.call(patch || {}, 'gapEm')) nextSource.compatibility.useLegacyGap = false;
      if (!nextSource.compatibility.useLegacySize && !nextSource.compatibility.useLegacyGap) delete nextSource.compatibility;
    }
    const next = normalize(nextSource);
    doc.rubyPresentation = next;
    if (!doc.editor || typeof doc.editor !== 'object') doc.editor = {};
    doc.editor.viewMode = next.writingMode;
    return next;
  }

  function cssValues(value) {
    const presentation = normalize(value);
    const compatibility = plain(presentation.compatibility);
    const legacySize = compatibility.useLegacySize === true;
    const legacyGap = compatibility.useLegacyGap === true;
    return {
      size: (legacySize ? compatibility.legacySizeEm : presentation.sizePercent / 100) + 'em',
      gap: presentation.gapEm + 'em',
      legacyOffset: legacyGap ? compatibility.legacyOffsetPx + 'px' : '',
      gapMode: legacyGap ? 'legacy' : 'relative',
      // 負の字間はJIS配置側の詰め寄せで表現し、素のCSS letter-spacingへは
      // 渡さない（文字が原点へ重なって潰れるため）。フォールバック表示は
      // 0em（ベタ相当）で止める。
      letterSpacing: Math.max(0, presentation.letterSpacingEm) + 'em',
      lineHeight: String(presentation.lineHeight),
      fontFamily: FONT_PRESETS[presentation.fontPreset] || 'inherit',
    };
  }

  function legacyGapEm(value, writingMode = null) {
    const source = plain(value);
    const compatibility = plain(source.compatibility);
    if (compatibility.useLegacyGap !== true) {
      return normalize(source).gapEm;
    }
    if (compatibility.legacyGapEm !== undefined && compatibility.legacyGapEm !== null
      && String(compatibility.legacyGapEm).trim() !== '') {
      return finite(compatibility.legacyGapEm, 0, LIMITS.gapEm.min, LIMITS.gapEm.max);
    }
    const baseEm = finite(
      compatibility.legacyBaseEmPx,
      LEGACY_TRANSFER_METRICS.baseEmPx,
      0.001,
      1000,
    );
    const mode = oneOf(writingMode || source.writingMode, ['horizontal', 'vertical'], 'horizontal');
    const defaultCrossSize = mode === 'vertical'
      ? LEGACY_TRANSFER_METRICS.verticalCrossSizePx
      : LEGACY_TRANSFER_METRICS.horizontalCrossSizePx;
    const crossSize = finite(
      compatibility.legacyCrossSizePx,
      defaultCrossSize,
      0.001,
      1000,
    );
    const offset = finite(compatibility.legacyOffsetPx, 3.5, -100, 100);
    return finite(((crossSize - baseEm) * 0.5 - offset) / baseEm, 0, LIMITS.gapEm.min, LIMITS.gapEm.max);
  }

  function toTransferPresentation(value, fallback = DEFAULTS) {
    const source = plain(value);
    const presentation = normalize(source, fallback);
    const compatibility = plain(source.compatibility);
    return {
      writingMode: presentation.writingMode,
      sizePercent: compatibility.useLegacySize === true
        ? finite(compatibility.legacySizeEm, 0.55, 0.05, 2) * 100
        : presentation.sizePercent,
      gapEm: compatibility.useLegacyGap === true
        ? legacyGapEm(source, presentation.writingMode)
        : presentation.gapEm,
      letterSpacingEm: presentation.letterSpacingEm,
      lineHeight: presentation.lineHeight,
      align: presentation.align,
      smallKana: presentation.smallKana,
      fontPreset: presentation.fontPreset,
      defaultStyle: presentation.defaultStyle,
    };
  }

  // 負の字間は延べ幅を縮めない（ベタ組が下限）。負値の詰め寄せは
  // distributedStarts の condense 補間で行い、隣接衝突判定が実占有幅を
  // 見失わないようにする。
  function rubyExtent(rubyEm, count, letterSpacing) {
    if (count <= 1) return rubyEm;
    const pitch = rubyEm * Math.max(1, 1 + Number(letterSpacing || 0));
    return rubyEm + pitch * (count - 1);
  }

  // 字間マイナス値の詰め寄せ係数。-2.0でベタ組（文字が隣接）へ到達する。
  function condenseRatio(letterSpacing) {
    return Math.min(1, Math.max(0, -Number(letterSpacing || 0) / 2));
  }

  // 配置済みのstartsを、ベタ組クラスタ（中付き=親中央 / 肩付き=親先頭）へ
  // condense比率で線形補間する。文字順は保たれ、ベタ組より詰まらない。
  function condenseStarts(starts, options) {
    const t = Math.min(1, Math.max(0, Number(options.condense || 0)));
    if (!(t > 0) || starts.length <= 1) return starts;
    const rubyEm = Math.max(0, Number(options.rubyEm || 0));
    // 肩付きの自動圧縮などで既にベタ組以下へ詰まっている配置は広げない
    // （ベタ組へ向けた補間が拡大方向に働き、収まりを壊すため）。
    if (starts[1] - starts[0] <= rubyEm + 1e-6) return starts;
    const betaFirst = options.align === 'start'
      ? Number(options.parentStart || 0)
      : (Number(options.parentStart || 0) + Number(options.parentEnd || 0)) * 0.5 - rubyEm * starts.length * 0.5;
    return starts.map((start, index) => start + t * (betaFirst + rubyEm * index - start));
  }

  function isJapaneseRubyText(text) {
    const chars = Array.from(String(text || '')).filter(char => !/\s/u.test(char));
    if (!chars.length) return false;
    return chars.every(char => (
      /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\u{20000}-\u{2fa1f}]/u.test(char)
      || '々〆〻'.includes(char)
    ));
  }

  function distributedStarts(options) {
    const parentStart = Number(options.parentStart || 0);
    const parentEnd = Number(options.parentEnd || 0);
    const rubyEm = Math.max(0, Number(options.rubyEm || 0));
    const count = Math.max(0, Math.trunc(Number(options.count || 0)));
    if (!count) return [];
    const parentSpan = Math.max(0, parentEnd - parentStart);
    const parentCenter = (parentStart + parentEnd) * 0.5;
    if (count === 1) {
      return [options.align === 'start' ? parentStart : parentCenter - rubyEm * 0.5];
    }
    const naturalSpan = options.targetExtent == null
      ? rubyExtent(rubyEm, count, options.letterSpacing)
      : Math.max(rubyEm, Number(options.targetExtent));
    if (options.align === 'start') {
      const step = (naturalSpan - rubyEm) / (count - 1);
      return condenseStarts(Array.from({ length: count }, (_, index) => parentStart + step * index), options);
    }
    if (options.groupStyle && naturalSpan < parentSpan - 1e-9) {
      if (options.jisGroupDistribution) {
        let outer = (parentSpan - naturalSpan) / (2 * count);
        if (options.maxOuterSpace != null) {
          outer = Math.min(outer, Math.max(0, Number(options.maxOuterSpace)));
        }
        const step = (parentSpan - 2 * outer - rubyEm) / (count - 1);
        return condenseStarts(Array.from({ length: count }, (_, index) => parentStart + outer + step * index), options);
      }
      const first = parentCenter - naturalSpan * 0.5;
      const step = (naturalSpan - rubyEm) / (count - 1);
      return condenseStarts(Array.from({ length: count }, (_, index) => first + step * index), options);
    }
    const span = Math.max(parentSpan, naturalSpan);
    const first = parentCenter - span * 0.5;
    const step = (span - rubyEm) / (count - 1);
    return condenseStarts(Array.from({ length: count }, (_, index) => first + step * index), options);
  }

  function createRubyLayoutInfo(options) {
    const presentation = normalize(options.presentation);
    const compatibility = plain(presentation.compatibility);
    const ratio = compatibility.useLegacySize === true
      ? compatibility.legacySizeEm
      : presentation.sizePercent / 100;
    const baseEm = Math.max(0.001, Number(options.baseEm || 0));
    const rubyEm = baseEm * Math.max(0.05, ratio);
    const text = String(options.rubyText || '');
    const count = Array.from(text).length;
    const parentStart = Number(options.parentStart || 0);
    const parentEnd = Number(options.parentEnd || parentStart);
    const style = oneOf(options.style, ['group', 'mono', 'jukugo'], presentation.defaultStyle);
    const align = style === 'mono' ? 'center' : presentation.align;
    const extent = rubyExtent(rubyEm, count, presentation.letterSpacingEm);
    return {
      parentStart,
      parentEnd,
      parentSpan: Math.max(0, parentEnd - parentStart),
      parentCenter: (parentStart + parentEnd) * 0.5,
      baseEm,
      rubyEm,
      count,
      text,
      style,
      align,
      extent,
      minExtent: rubyExtent(rubyEm, count, 0),
      effectiveLetterSpacing: presentation.letterSpacingEm,
      condense: condenseRatio(presentation.letterSpacingEm),
      gapPx: presentation.gapEm * baseEm,
    };
  }

  function rubyRange(info) {
    const actual = Math.max(info.parentSpan, info.extent);
    if (info.align === 'start') return [info.parentStart, info.parentStart + actual];
    return [info.parentCenter - actual * 0.5, info.parentCenter + actual * 0.5];
  }

  function letterSpacingForExtent(target, rubyEm, count, minimum = 0) {
    if (count <= 1 || rubyEm < 1e-9) return 0;
    const pitch = (target - rubyEm) / (count - 1);
    return Math.max(minimum, pitch / rubyEm - 1);
  }

  function shrinkRuby(info, cut) {
    if (info.extent <= 1e-9 || cut <= 1e-9) return;
    const scale = Math.max(0.6, (info.extent - cut) / info.extent);
    info.rubyEm *= scale;
    info.extent *= scale;
    info.minExtent *= scale;
  }

  function fitStartRubyBefore(info, nextParentStart) {
    const available = Math.max(0, Number(nextParentStart) - info.parentStart);
    if (info.extent <= available + 1e-6) return;
    shrinkRuby(info, info.extent - available);
    info.extent = Math.max(info.rubyEm, Math.min(info.extent, available));
    info.effectiveLetterSpacing = letterSpacingForExtent(info.extent, info.rubyEm, info.count, -0.9);
  }

  function resolveRubyOverlaps(infos) {
    const ordered = Array.from(infos || []).sort((a, b) => a.parentStart - b.parentStart);
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const current = ordered[index];
      const next = ordered[index + 1];
      if (current.style === 'jukugo' && current.groupId === next.groupId) continue;
      const currentHigh = rubyRange(current)[1];
      const nextLow = rubyRange(next)[0];
      if (currentHigh <= nextLow + 1e-6) continue;
      if (current.align === 'start') {
        fitStartRubyBefore(current, next.parentStart);
        continue;
      }
      const needed = 2 * (currentHigh - nextLow);
      const currentOverflow = Math.max(0, current.extent - current.parentSpan);
      const nextOverflow = Math.max(0, next.extent - next.parentSpan);
      const totalOverflow = currentOverflow + nextOverflow;
      if (totalOverflow < 1e-9) continue;
      const currentRoom = Math.max(0, current.extent - current.minExtent);
      const nextRoom = Math.max(0, next.extent - next.minExtent);
      let currentCut = Math.min(needed * currentOverflow / totalOverflow, currentRoom);
      let nextCut = Math.min(needed * nextOverflow / totalOverflow, nextRoom);
      let left = needed - currentCut - nextCut;
      if (left > 1e-6) {
        const extra = Math.min(left, currentRoom - currentCut);
        currentCut += extra;
        left -= extra;
      }
      if (left > 1e-6) {
        const extra = Math.min(left, nextRoom - nextCut);
        nextCut += extra;
        left -= extra;
      }
      current.extent -= currentCut;
      next.extent -= nextCut;
      current.effectiveLetterSpacing = letterSpacingForExtent(current.extent, current.rubyEm, current.count);
      next.effectiveLetterSpacing = letterSpacingForExtent(next.extent, next.rubyEm, next.count);
      if (left > 1e-6) {
        shrinkRuby(current, left * currentOverflow / totalOverflow);
        shrinkRuby(next, left * nextOverflow / totalOverflow);
      }
    }
    return ordered;
  }

  function finalizeRubyLayout(info) {
    const starts = distributedStarts({
      parentStart: info.parentStart,
      parentEnd: info.parentEnd,
      rubyEm: info.rubyEm,
      count: info.count,
      letterSpacing: info.effectiveLetterSpacing,
      align: info.align,
      targetExtent: info.extent,
      groupStyle: info.style === 'group',
      jisGroupDistribution: info.style === 'group' && isJapaneseRubyText(info.text),
      maxOuterSpace: info.baseEm * 0.5,
      condense: info.condense,
    });
    if (!starts.length) return null;
    const step = starts.length > 1 ? starts[1] - starts[0] : info.rubyEm;
    return {
      inlineStartPx: starts[0] - info.parentStart,
      extentPx: starts[starts.length - 1] + info.rubyEm - starts[0],
      fontSizePx: info.rubyEm,
      letterSpacingPx: step - info.rubyEm,
      gapPx: info.gapPx,
    };
  }

  function fullsizeKana(text) {
    return Array.from(String(text || ''), char => SMALL_KANA[char] || char).join('');
  }

  function refreshRubyNodes(editorOrRoot) {
    const editor = editorOrRoot?.doc ? editorOrRoot : null;
    const root = editor?.host || editorOrRoot;
    if (!root?.querySelectorAll) return;
    const presentation = editor ? ensureDocument(editor.doc) : null;
    const smallKana = presentation?.smallKana || root.dataset?.rubySmallKana || 'keep';
    const defaultStyle = presentation?.defaultStyle || 'group';
    root.querySelectorAll('[data-ruby]').forEach(node => {
      const source = node.getAttribute('data-ruby') || '';
      node.setAttribute('data-ruby-rendered', smallKana === 'fullsize' ? fullsizeKana(source) : source);
      const sourceKind = node.getAttribute('data-ruby-style-source');
      const currentStyle = node.getAttribute('data-ruby-style');
      if (sourceKind === 'default' || !['group', 'mono', 'jukugo'].includes(currentStyle)) {
        node.setAttribute('data-ruby-style', defaultStyle);
        node.setAttribute('data-ruby-style-source', 'default');
      }
    });
  }

  function applyToEditor(editor, scroll) {
    if (!editor?.doc) return null;
    const presentation = ensureDocument(editor.doc);
    const target = scroll || editor.host?.querySelector?.('.sn2-scroll');
    if (!target) return presentation;
    const css = cssValues(presentation);
    target.style.setProperty('--sn2-ruby-size', css.size);
    target.style.setProperty('--sn2-ruby-gap', css.gap);
    target.style.setProperty('--sn2-ruby-letter-spacing', css.letterSpacing);
    target.style.setProperty('--sn2-ruby-line-height', css.lineHeight);
    target.style.setProperty('--sn2-ruby-font-family', css.fontFamily);
    if (css.legacyOffset) target.style.setProperty('--sn2-ruby-offset', css.legacyOffset);
    else target.style.removeProperty('--sn2-ruby-offset');
    target.dataset.rubyGapMode = css.gapMode;
    target.dataset.rubyAlign = presentation.align;
    target.dataset.rubySmallKana = presentation.smallKana;
    target.dataset.rubyFontPreset = presentation.fontPreset;
    target.dataset.rubyDefaultStyle = presentation.defaultStyle;
    refreshRubyNodes(editor);
    return presentation;
  }

  function setGlobalDefaults(patch) {
    const next = writeStoredDefaults({ ...readStoredDefaults(), ...plain(patch) });
    try {
      global.dispatchEvent?.(new CustomEvent('meldex:ruby-presentation-defaults-change', { detail: clone(next) }));
    } catch (_) {}
    return next;
  }

  global.MeldexRubyPresentation = Object.freeze({
    VERSION,
    STORAGE_KEY,
    DEFAULTS,
    LIMITS,
    FONT_PRESETS,
    LEGACY_TRANSFER_METRICS,
    normalize,
    ensureDocument,
    updateDocument,
    getGlobalDefaults: readStoredDefaults,
    setGlobalDefaults,
    cssValues,
    legacyGapEm,
    toTransferPresentation,
    applyToEditor,
    refreshRubyNodes,
    fullsizeKana,
    isJapaneseRubyText,
    condenseRatio,
    distributedStarts,
    createRubyLayoutInfo,
    resolveRubyOverlaps,
    finalizeRubyLayout,
  });
})(typeof window !== 'undefined' ? window : globalThis);
