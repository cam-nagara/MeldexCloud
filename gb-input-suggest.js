/*
 * gb-input-suggest.js — 入力中に候補を出す共通部品（UI共通ルール 4.0「候補付きの入力欄」, 2026-11-27）。
 *
 * MeldexInputSuggest.attach(field, options) → { refresh(), close(), isOpen(), destroy() }
 *   field          input または textarea
 *   getSuggestions(value, caret) → null または { from, to, items: [{ label, detail?, insert, caret? }] }
 *                  from〜to を insert で置き換える。caret は insert の先頭からの位置（省略時は末尾）。
 *   ariaLabel      候補一覧の読み上げ名（既定「候補」）
 *   limit          表示する最大件数（既定 40）
 *
 * 操作: ↑↓で選ぶ／Enter・Tabで確定／Escで閉じる／クリックで確定。日本語入力の変換中は出さない。
 * 見た目は共通メニュー（.gb-context-menu / .gb-context-menu-item）、位置は positionPopup。
 * ブラウザ標準の候補リスト（datalist）は使わない。
 */
(function (global) {
  'use strict';

  let seq = 0;
  const STYLE_ID = 'meldex-input-suggest-style';

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.meldex-input-suggest{max-height:240px;overflow-y:auto;min-width:200px;max-width:min(420px,calc(100vw - 16px));}
.meldex-input-suggest-item{display:flex;align-items:baseline;gap:8px;cursor:pointer;}
.meldex-input-suggest-item.active{background:var(--ui-bg-control-active, var(--bg3));}
.meldex-input-suggest-label{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--ui-font-mono, monospace);}
.meldex-input-suggest-detail{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ui-fg-muted, var(--fg2));font-size:11px;}
`;
    document.head.appendChild(style);
  }

  function attach(field, options = {}) {
    if (!field || field.__meldexInputSuggest) return field?.__meldexInputSuggest || null;
    ensureStyle();
    const listId = 'meldex-input-suggest-' + (++seq);
    let popup = null;
    let state = null; // { from, to, items, active }
    let composing = false;

    function close() {
      if (popup) popup.remove();
      popup = null;
      state = null;
      field.removeAttribute('aria-activedescendant');
      field.setAttribute('aria-expanded', 'false');
    }

    function accept(index) {
      if (!state) return false;
      const item = state.items[index];
      if (!item) return false;
      const value = field.value;
      const insert = String(item.insert ?? item.label ?? '');
      field.value = value.slice(0, state.from) + insert + value.slice(state.to);
      const caret = state.from + (Number.isFinite(item.caret) ? item.caret : insert.length);
      close();
      field.focus();
      try { field.setSelectionRange(caret, caret); } catch (_) { /* 選択位置を持たない入力 */ }
      field.dispatchEvent(new Event('input', { bubbles: true }));
      options.onAccept?.(item);
      return true;
    }

    function setActive(index) {
      if (!state || !popup) return;
      const count = state.items.length;
      state.active = (index + count) % count;
      popup.querySelectorAll('[role="option"]').forEach((el, i) => {
        const on = i === state.active;
        el.classList.toggle('active', on);
        el.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on) {
          field.setAttribute('aria-activedescendant', el.id);
          el.scrollIntoView?.({ block: 'nearest' });
        }
      });
    }

    function render(result) {
      const items = (result?.items || []).slice(0, options.limit || 40);
      if (!items.length) { close(); return; }
      state = { from: result.from, to: result.to, items, active: 0 };
      if (!popup) {
        popup = document.createElement('div');
        popup.className = 'gb-context-menu meldex-input-suggest';
        popup.id = listId;
        popup.setAttribute('role', 'listbox');
        popup.setAttribute('aria-label', options.ariaLabel || '候補');
        // 候補を押してもフォーカスを入力欄から外さない。
        popup.addEventListener('pointerdown', event => event.preventDefault());
        document.body.appendChild(popup);
      }
      popup.replaceChildren();
      items.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'gb-context-menu-item meldex-input-suggest-item';
        row.id = listId + '-' + index;
        row.setAttribute('role', 'option');
        const label = document.createElement('span');
        label.className = 'meldex-input-suggest-label';
        label.textContent = item.label;
        row.appendChild(label);
        if (item.detail) {
          const detail = document.createElement('span');
          detail.className = 'meldex-input-suggest-detail';
          detail.textContent = item.detail;
          row.appendChild(detail);
        }
        row.addEventListener('click', () => accept(index));
        popup.appendChild(row);
      });
      field.setAttribute('aria-expanded', 'true');
      setActive(0);
      if (typeof global.positionPopup === 'function') global.positionPopup(popup, field.getBoundingClientRect(), { prefer: 'below' });
    }

    function refresh() {
      if (composing || document.activeElement !== field) { close(); return; }
      const caret = field.selectionStart ?? field.value.length;
      if (field.selectionEnd != null && field.selectionEnd !== caret) { close(); return; }
      let result = null;
      try { result = options.getSuggestions?.(field.value, caret) || null; } catch (_) { result = null; }
      render(result);
    }

    function onKeydown(event) {
      if (!state || event.isComposing) return;
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive(state.active + 1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(state.active - 1); }
      else if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        accept(state.active);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    }

    const onInput = event => { if (!event.isComposing) refresh(); };
    const onCompositionStart = () => { composing = true; close(); };
    const onCompositionEnd = () => { composing = false; refresh(); };
    const onBlur = () => close();
    const onClickField = () => { if (state) refresh(); };

    field.setAttribute('aria-autocomplete', 'list');
    field.setAttribute('aria-controls', listId);
    field.setAttribute('aria-expanded', 'false');
    field.addEventListener('keydown', onKeydown);
    field.addEventListener('input', onInput);
    field.addEventListener('compositionstart', onCompositionStart);
    field.addEventListener('compositionend', onCompositionEnd);
    field.addEventListener('blur', onBlur);
    field.addEventListener('click', onClickField);

    const api = {
      refresh,
      close,
      isOpen: () => !!state,
      destroy() {
        close();
        field.removeEventListener('keydown', onKeydown);
        field.removeEventListener('input', onInput);
        field.removeEventListener('compositionstart', onCompositionStart);
        field.removeEventListener('compositionend', onCompositionEnd);
        field.removeEventListener('blur', onBlur);
        field.removeEventListener('click', onClickField);
        delete field.__meldexInputSuggest;
      },
    };
    field.__meldexInputSuggest = api;
    return api;
  }

  global.MeldexInputSuggest = Object.freeze({ attach });
})(window);
