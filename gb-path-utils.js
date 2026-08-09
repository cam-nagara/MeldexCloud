/* gb-path-utils.js: パスをコピー機能向けの共通パスユーティリティ
 *
 * 「パスをコピー」はフォルダツリー・フォルダビュー・ツールメニュー・シートのエントリメニューの
 * 4箇所にあり、コピー結果をドライブレター付きのフル絶対パスへ統一するために使う。
 * vault相対パスを state.vaultPath（絶対パス）と結合し、Windowsのネイティブ表記（\区切り）へ
 * 変換する。ロジックは元々 gb-outliner.part02.part01.js のツリー用ヘルパーにのみ実装されていた
 * ものを、他の3箇所でも使えるよう共通化したもの。
 *
 * basename/ellipsizePath は用途が別で、欄内に収まらない長いパス/URLをUI表示用に中略する
 * ヘルパー（「先頭…末尾ファイル名」形式）。読み取り専用表示と編集可能な入力欄への適用も
 * このモジュールで一元管理し、元の完全値を変更せず表示だけを短縮する。
 *
 * 依存なし。window.GBPathUtils として公開する。未ロード時に備え、呼び出し側は
 * `window.GBPathUtils?.resolveForClipboard?.(path, base) ?? path` の形でフォールバックすること。
 */
(function (global) {
  'use strict';

  const TEXT_AUTO_SELECTOR = [
    '[data-gb-path-display]',
    'span[class*="path"]',
    'span[class*="url"]',
    'div[class*="path"]',
    'div[class*="url"]',
    'p[class*="path"]',
    'p[class*="url"]',
    'code[class*="path"]',
    'code[class*="url"]',
    'a[class*="path"]',
    'a[class*="url"]',
    'span[id*="path"]',
    'span[id*="url"]',
    'div[id*="path"]',
    'div[id*="url"]',
    'p[id*="path"]',
    'p[id*="url"]',
    'code[id*="path"]',
    'code[id*="url"]',
    'span[title]',
    'div[title]',
    'p[title]',
    'code[title]',
  ].join(',');
  const INPUT_AUTO_SELECTOR = [
    'input[data-gb-path-input]',
    'input[type="url"]',
    'input[data-field="path"]',
    'input[id*="path"]',
    'input[id*="url"]',
    'input[class*="path"]',
    'input[class*="url"]',
    'input[aria-label*="パス"]',
    'input[aria-label*="URL"]',
    'input[placeholder*="URL"]',
    'input[placeholder*="URI"]',
    'input[placeholder*="://"]',
  ].join(',');
  const _textBindings = new WeakMap();
  const _inputBindings = new WeakMap();
  let _ellipsisMeasureCtx = null;
  let _resizeObserver = null;
  let _mutationObserver = null;

  // ドライブレター（C:\ や C:/）・UNCパス（\\server\share）・先頭/（Dropbox仮想パス等）・
  // URL/URIを絶対パスとみなす。URLをvaultPathへ誤結合しないため、schemeもここで扱う。
  function isAbsolute(path) {
    const value = String(path || '');
    return /^[a-zA-Z]:[\\/]/.test(value)
      || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
      || /^[/\\]{2}/.test(value)
      || value.startsWith('/');
  }

  function join(base, rel) {
    const left = String(base || '').replace(/[\\/]+$/, '');
    const right = String(rel || '').replace(/^[\\/]+/, '');
    if (!left) return right;
    if (!right) return left;
    return left + '/' + right;
  }

  // Windows形式（ドライブレター/UNC）のときだけ / を \ に正規化する。
  // 先頭/の仮想パス（Dropboxクラウドモード等）はそのまま返す。
  // ドライブレターの直後は \ と / の両方があり得る（vaultPath は \ 形式、サーバーの相対パスは / 形式のため、
  // join 後は混在する）。どちらでも Windows パスとみなして全区切りを \ へ揃える。
  function toNativeClipboard(path) {
    const value = String(path || '');
    if (/^[a-zA-Z]:[\\/]/.test(value)) return value.replace(/\//g, '\\');
    if (/^[/\\]{2}/.test(value)) return '\\\\' + value.replace(/^[/\\]+/, '').replace(/\//g, '\\');
    return value;
  }

  // path が絶対ならそのまま、相対なら basePath（絶対のときのみ）と結合してから
  // クリップボード用のネイティブ表記へ変換する。basePath が使えない場合は元の path のまま
  // ネイティブ表記化する（安全フォールバック。クラウド/Dropboxモードで vaultPath が
  // 空・仮想パスの場合を含む）。
  function resolveForClipboard(path, basePath) {
    const value = String(path || '');
    if (!value) return value;
    if (value.startsWith('#')) return value;
    const resolved = (!isAbsolute(value) && basePath && isAbsolute(String(basePath)))
      ? join(basePath, value)
      : value;
    return toNativeClipboard(resolved);
  }

  async function copyToClipboard(path, basePath) {
    const value = resolveForClipboard(path, basePath);
    if (!value) return false;
    if (global.navigator?.clipboard?.writeText) {
      try {
        await global.navigator.clipboard.writeText(value);
        return true;
      } catch (_) {
        // 非HTTPSの埋め込み面などではClipboard APIが拒否されるため、選択コピーへフォールバックする。
      }
    }
    if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.setAttribute('aria-hidden', 'true');
    textarea.style.cssText = 'position:fixed;left:-10000px;top:0;opacity:0;pointer-events:none';
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try { copied = document.execCommand('copy') === true; } catch (_) { copied = false; }
    textarea.remove();
    return copied;
  }

  // パス/URLの末尾セグメント（ファイル名相当）を返す。区切りは / と \ の両対応。
  // 末尾の区切り文字は無視する。URL形式の場合はクエリ・ハッシュを除いた部分で判定してよい。
  function basename(path) {
    let value = String(path == null ? '' : path);
    const hashIdx = value.indexOf('#');
    if (hashIdx >= 0) value = value.slice(0, hashIdx);
    const queryIdx = value.indexOf('?');
    if (queryIdx >= 0) value = value.slice(0, queryIdx);
    value = value.replace(/[\\/]+$/, '');
    if (!value) return '';
    const idx = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
    return idx >= 0 ? value.slice(idx + 1) : value;
  }

  // 長いパス/URLをUI表示用に中略する。maxChars以内ならそのまま返す。
  // 超過時は「先頭部分…末尾ファイル名」の形式にする（末尾のファイル名=basename()は必ず残す）。
  // ファイル名自体が長くて収まらない場合は「…」+ファイル名の末尾側を優先して maxChars に収める。
  // maxChars が不正（数値でない・1以下）なら中略せず元の文字列をそのまま返す（安全フォールバック）。
  function ellipsizePath(path, maxChars) {
    const value = String(path == null ? '' : path);
    const max = Number(maxChars);
    if (!Number.isFinite(max) || max <= 1) return value;
    if (value.length <= max) return value;

    const ELLIPSIS = '…';
    const name = basename(value);
    const availableForName = max - ELLIPSIS.length;
    if (name.length > availableForName) {
      // ファイル名だけでも収まらない → 「…」+ファイル名の末尾側を優先する
      return ELLIPSIS + name.slice(name.length - availableForName);
    }
    const headLen = availableForName - name.length;
    return value.slice(0, headLen) + ELLIPSIS + name;
  }

  function _looksLikePathOrUrl(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text || text.length < 4) return false;
    if (/^(?:https?:\/\/|file:\/\/|[a-z]:[\\/]|\\\\|\/(?!\/))/i.test(text)) return true;
    if (!/[\\/]/.test(text) || /\s[\\/]|[\\/]\s/.test(text)) return false;
    return text.split(/[\\/]+/).filter(Boolean).length >= 2;
  }

  function _measureWidth(text, font) {
    if (!_ellipsisMeasureCtx && typeof document !== 'undefined') {
      _ellipsisMeasureCtx = document.createElement('canvas').getContext('2d');
    }
    if (!_ellipsisMeasureCtx) return -1;
    _ellipsisMeasureCtx.font = font;
    return _ellipsisMeasureCtx.measureText(text).width;
  }

  function _fontFor(el) {
    const style = global.getComputedStyle?.(el);
    if (!style) return '12px sans-serif';
    return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  }

  function _fitToElement(el, fullText, widthOverride) {
    const text = String(fullText == null ? '' : fullText);
    const style = global.getComputedStyle?.(el);
    const width = Number.isFinite(widthOverride) ? widthOverride : el?.clientWidth;
    if (!width || !style || text.length < 2) return text;
    const paddingX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const available = Math.max(0, width - paddingX);
    const font = _fontFor(el);
    if (_measureWidth(text, font) <= available) return text;
    let lo = 2;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (_measureWidth(ellipsizePath(text, mid), font) <= available) lo = mid;
      else hi = mid - 1;
    }
    const fitted = ellipsizePath(text, lo);
    return _measureWidth(fitted, font) <= available ? fitted : '…';
  }

  function _ensureResizeObserver() {
    if (_resizeObserver || typeof global.ResizeObserver !== 'function') return _resizeObserver;
    _resizeObserver = new global.ResizeObserver(entries => {
      entries.forEach(entry => {
        const target = entry.target;
        if (_textBindings.has(target)) _refreshMiddleEllipsisText(target);
        if (_inputBindings.has(target)) _refreshMiddleEllipsisInput(target);
      });
    });
    return _resizeObserver;
  }

  function _refreshMiddleEllipsisText(el) {
    const binding = _textBindings.get(el);
    if (!binding) return;
    const rendered = _fitToElement(el, binding.fullText);
    binding.rendered = rendered;
    if (el.textContent !== rendered) el.textContent = rendered;
    if (binding.fullText) el.title = binding.fullText;
    else el.removeAttribute('title');
  }

  function applyMiddleEllipsis(el, fullText) {
    if (!el || el.childElementCount > 0) return;
    let binding = _textBindings.get(el);
    if (!binding) {
      binding = { fullText: '', rendered: '' };
      _textBindings.set(el, binding);
      el.dataset.gbMiddleEllipsisBound = 'text';
      _ensureResizeObserver()?.observe(el);
    }
    binding.fullText = String(fullText == null ? '' : fullText);
    _refreshMiddleEllipsisText(el);
  }

  function _hideInputOverlay(binding) {
    binding.overlay.hidden = true;
    binding.input.classList.remove('gb-middle-ellipsis-input-active');
  }

  function _refreshMiddleEllipsisInput(input) {
    const binding = _inputBindings.get(input);
    if (!binding) return;
    const fullText = String(input.value == null ? '' : input.value);
    if (fullText) input.title = fullText;
    else input.removeAttribute('title');
    if (!fullText || document.activeElement === input || !input.clientWidth) {
      _hideInputOverlay(binding);
      return;
    }
    const style = global.getComputedStyle?.(input);
    if (style) {
      binding.wrapper.style.setProperty('--gb-middle-input-padding-left', style.paddingLeft || '0px');
      binding.wrapper.style.setProperty('--gb-middle-input-padding-right', style.paddingRight || '0px');
      binding.wrapper.style.setProperty('--gb-middle-input-color', style.color || 'currentColor');
      binding.wrapper.style.setProperty('--gb-middle-input-font-size', style.fontSize || 'inherit');
      binding.wrapper.style.setProperty('--gb-middle-input-font-family', style.fontFamily || 'inherit');
      binding.wrapper.style.setProperty('--gb-middle-input-font-weight', style.fontWeight || 'inherit');
    }
    const rendered = _fitToElement(input, fullText);
    if (!rendered || rendered === fullText) {
      _hideInputOverlay(binding);
      return;
    }
    binding.overlay.textContent = rendered;
    binding.overlay.hidden = false;
    input.classList.add('gb-middle-ellipsis-input-active');
  }

  function bindMiddleEllipsisInput(input) {
    if (!input || input.tagName !== 'INPUT') return null;
    const type = String(input.type || 'text').toLowerCase();
    if (!['text', 'url'].includes(type) || input.closest?.('[contenteditable="true"]')) return null;
    const current = _inputBindings.get(input);
    if (current) {
      _refreshMiddleEllipsisInput(input);
      return current;
    }
    const parent = input.parentNode;
    if (!parent) return null;
    const wrapper = document.createElement('span');
    wrapper.className = 'gb-middle-ellipsis-input-wrap';
    wrapper.dataset.gbMiddleEllipsisBound = 'input';
    const overlay = document.createElement('span');
    overlay.className = 'gb-middle-ellipsis-input-overlay';
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    parent.insertBefore(wrapper, input);
    wrapper.append(input, overlay);
    const binding = {
      input,
      wrapper,
      overlay,
      onFocus: () => _hideInputOverlay(binding),
      onRefresh: () => _refreshMiddleEllipsisInput(input),
    };
    _inputBindings.set(input, binding);
    input.addEventListener('focus', binding.onFocus);
    input.addEventListener('blur', binding.onRefresh);
    input.addEventListener('input', binding.onRefresh);
    input.addEventListener('change', binding.onRefresh);
    _ensureResizeObserver()?.observe(input);
    _refreshMiddleEllipsisInput(input);
    return binding;
  }

  function _unbindElement(el) {
    if (_textBindings.has(el)) {
      _resizeObserver?.unobserve(el);
      _textBindings.delete(el);
    }
    if (el.matches?.('.gb-middle-ellipsis-input-wrap')) {
      const input = el.querySelector('input');
      const binding = input ? _inputBindings.get(input) : null;
      if (binding) {
        _resizeObserver?.unobserve(input);
        input.removeEventListener('focus', binding.onFocus);
        input.removeEventListener('blur', binding.onRefresh);
        input.removeEventListener('input', binding.onRefresh);
        input.removeEventListener('change', binding.onRefresh);
        _inputBindings.delete(input);
      }
    }
  }

  function _fullTextForAutoElement(el) {
    if (el.dataset?.gbFullValue != null) return el.dataset.gbFullValue;
    if (el.matches?.('a') && el.getAttribute('href')) return el.getAttribute('href');
    const titledValue = el.getAttribute?.('title') || '';
    return _looksLikePathOrUrl(titledValue) ? titledValue : (el.textContent || '');
  }

  function autoBindMiddleEllipsis(root) {
    if (!root?.querySelectorAll) return;
    const inputs = [];
    const texts = [];
    if (root.matches?.(INPUT_AUTO_SELECTOR)) inputs.push(root);
    if (root.matches?.(TEXT_AUTO_SELECTOR)) texts.push(root);
    root.querySelectorAll(INPUT_AUTO_SELECTOR).forEach(el => inputs.push(el));
    root.querySelectorAll(TEXT_AUTO_SELECTOR).forEach(el => texts.push(el));
    inputs.forEach(input => bindMiddleEllipsisInput(input));
    texts.forEach(el => {
      if (el.childElementCount > 0) return;
      const visibleText = el.textContent || '';
      const fullText = _fullTextForAutoElement(el);
      const directValue = el.matches?.('.value-url, [data-gb-path-display]');
      if (_looksLikePathOrUrl(visibleText) || (directValue && _looksLikePathOrUrl(fullText))) {
        applyMiddleEllipsis(el, fullText);
      }
    });
  }

  function _startAutoBinding() {
    if (!document.body || _mutationObserver) return;
    autoBindMiddleEllipsis(document);
    _mutationObserver = new MutationObserver(records => {
      records.forEach(record => {
        if (record.type === 'childList') {
          const target = record.target?.nodeType === 1 ? record.target : null;
          if (target && _textBindings.has(target)) {
            const binding = _textBindings.get(target);
            if (target.textContent !== binding.rendered) applyMiddleEllipsis(target, target.textContent);
          }
          record.addedNodes.forEach(node => {
            if (node.nodeType === 1) autoBindMiddleEllipsis(node);
          });
          record.removedNodes.forEach(node => {
            if (node.nodeType !== 1) return;
            _unbindElement(node);
            node.querySelectorAll?.('[data-gb-middle-ellipsis-bound]').forEach(_unbindElement);
          });
        }
      });
    });
    _mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _startAutoBinding, { once: true });
    else _startAutoBinding();
  }

  global.GBPathUtils = {
    isAbsolute,
    join,
    toNativeClipboard,
    resolveForClipboard,
    copyToClipboard,
    basename,
    ellipsizePath,
    fitToElement: _fitToElement,
    applyMiddleEllipsis,
    bindMiddleEllipsisInput,
    refreshMiddleEllipsisInput: _refreshMiddleEllipsisInput,
    autoBindMiddleEllipsis,
  };
  global.applyMiddleEllipsis = applyMiddleEllipsis;
})(window);
