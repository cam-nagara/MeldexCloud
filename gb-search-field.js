/*
 * gb-search-field.js — 一覧の絞り込みに使う共通の検索欄（UI共通ルール 4.0「検索欄」, 2026-11-21）。
 *
 * MeldexSearchField.create(options) → { element, input, getValue(), setValue(v), clear(), focus(), matches(text) }
 *   placeholder  入力欄の薄い文字（既定「検索」）
 *   ariaLabel    読み上げ用の名前（既定は placeholder）
 *   e2eId        data-e2e-id（入力欄に付ける）
 *   onInput(q)   入力が変わるたびに呼ぶ（同期。重い処理は呼び出し側で間引く）
 *   onEscape()   入力が空の時の Esc（入力があれば Esc は入力を消すだけ）
 *
 * 状態の不変条件（UI共通ルール §19「状態変化で寸法を変えない」）:
 *   - 消去ボタンは常に場所を取り、入力の有無では表示（visibility）だけを切り替える。
 *   - 焦点・ホバーでは枠の色だけを変え、太さ・余白・高さは変えない。
 */
(function (global) {
  'use strict';

  const STYLE_ID = 'meldex-search-field-style';

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
:root{--meldex-search-field-height:24px;--meldex-search-field-radius:4px;--meldex-search-field-font-size:12px;--meldex-search-field-icon-size:14px;}
.meldex-search-field{position:relative;display:flex;align-items:center;box-sizing:border-box;height:var(--meldex-search-field-height);min-height:var(--meldex-search-field-height);border:1px solid var(--border);border-radius:var(--meldex-search-field-radius);background:var(--bg, transparent);color:var(--fg);padding:0 2px 0 6px;gap:4px;flex:0 0 auto;}
.meldex-search-field:focus-within{border-color:var(--accent);}
.meldex-search-field-icon{display:inline-flex;align-items:center;justify-content:center;width:var(--meldex-search-field-icon-size);height:var(--meldex-search-field-icon-size);color:var(--fg2);flex:0 0 auto;pointer-events:none;}
.meldex-search-field-input{flex:1 1 auto;min-width:0;height:100%;box-sizing:border-box;margin:0;padding:0;border:0 !important;outline:none !important;box-shadow:none !important;background:transparent !important;color:inherit;font:inherit;font-size:var(--meldex-search-field-font-size);line-height:1;}
.meldex-search-field-input::-webkit-search-cancel-button{display:none;}
.meldex-search-field-clear{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;min-width:18px;min-height:18px;margin:0;padding:0;border:0;border-radius:3px;background:transparent;color:var(--fg2);cursor:pointer;flex:0 0 auto;visibility:hidden;}
.meldex-search-field.has-value .meldex-search-field-clear{visibility:visible;}
.meldex-search-field-clear:hover{background:var(--bg3, rgba(127,127,127,.12));color:var(--fg);}
`;
    document.head.appendChild(style);
  }

  function icon(name, size) {
    return typeof global.lucide === 'function' ? global.lucide(name, size) : '';
  }

  // 大文字小文字・全角半角・ひらがなカタカナの違いを無視して比べる。
  function normalize(text) {
    let value = String(text ?? '');
    try { value = value.normalize('NFKC'); } catch (_) { /* 古い環境 */ }
    value = value.toLowerCase();
    return value.replace(/[ぁ-ゖ]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60));
  }

  function matches(text, query) {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const target = normalize(text);
    return terms.every(term => target.includes(term));
  }

  function create(options = {}) {
    ensureStyle();
    const element = document.createElement('div');
    element.className = 'meldex-search-field';
    element.setAttribute('role', 'search');
    const searchIcon = document.createElement('span');
    searchIcon.className = 'meldex-search-field-icon';
    searchIcon.setAttribute('aria-hidden', 'true');
    searchIcon.innerHTML = icon('search', 14);
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'meldex-search-field-input';
    input.placeholder = options.placeholder || '検索';
    input.setAttribute('aria-label', options.ariaLabel || options.placeholder || '検索');
    input.autocomplete = 'off';
    input.spellcheck = false;
    if (options.e2eId) input.dataset.e2eId = options.e2eId;
    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'meldex-search-field-clear';
    clearButton.setAttribute('aria-label', '検索の文字を消す');
    clearButton.title = '検索の文字を消す';
    clearButton.tabIndex = -1;
    clearButton.innerHTML = icon('x', 12) || '×';
    element.append(searchIcon, input, clearButton);

    const sync = () => {
      element.classList.toggle('has-value', input.value !== '');
      try { options.onInput?.(input.value); } catch (error) { console.error('[search-field] onInput failed', error); }
    };
    input.addEventListener('input', sync);
    input.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || event.isComposing) return;
      if (input.value) {
        event.preventDefault();
        event.stopPropagation();
        input.value = '';
        sync();
      } else if (typeof options.onEscape === 'function') {
        event.preventDefault();
        event.stopPropagation();
        options.onEscape();
      }
    });
    clearButton.addEventListener('mousedown', event => event.preventDefault());
    clearButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      input.value = '';
      sync();
      input.focus();
    });

    return {
      element,
      input,
      getValue: () => input.value,
      setValue: value => { input.value = String(value ?? ''); sync(); },
      clear: () => { input.value = ''; sync(); },
      focus: () => input.focus({ preventScroll: true }),
      matches: text => matches(text, input.value),
    };
  }

  global.MeldexSearchField = { create, matches, normalize };
})(typeof window !== 'undefined' ? window : globalThis);
