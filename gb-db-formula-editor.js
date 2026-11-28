/*
 * gb-db-formula-editor.js — シートの数式タイプの列設定（2026-11-27 全面見直し）。
 *
 * 利用者報告: 列の多いシート（約80列）で、数式の入力欄が幅14pxに潰れ、右に列名のボタンが何十行も並んで
 * 使い物にならなかった（設定欄の共通の「項目名と値を1行に並べる」形に、入力欄・ボタン群・見本をまとめて
 * 入れていたため）。表計算ソフトの数式バーを手本に、次の形へ作り直した。
 *   - 数式の入力欄は1行の全幅。下端のつまみで高さを広げられる。
 *   - 列は「列を挿入」から検索して選ぶ。入力中も prop(" に続けて列名の候補が出る。
 *   - 関数は「関数を挿入」から分類つきの一覧で選ぶ。入力中も関数名の候補が出る。
 *   - カーソルのある関数の引数の並びを入力欄の下に出す（今の引数を強調）。
 *   - 結果は入力に合わせて自動で計算し、読める大きさで出す。エラーは何文字目かと日本語の説明つき。
 *
 * 部品: 候補 = MeldexInputSuggest、一覧の枠 = MeldexFilterPopup、検索欄 = MeldexSearchField、補足 = fieldHelp。
 * 保存は従来どおり列設定の自動保存（#pt-formula-src の値）に任せる。
 */
(function (global) {
  'use strict';

  const FUNCTIONS = [
    { group: '論理', name: 'if', args: ['条件', '真のとき', '偽のとき'], desc: '条件で値を分ける' },
    { group: '論理', name: 'and', args: ['条件1', '条件2'], desc: 'すべて真なら真' },
    { group: '論理', name: 'or', args: ['条件1', '条件2'], desc: 'どれかが真なら真' },
    { group: '論理', name: 'not', args: ['条件'], desc: '真と偽を入れ替える' },
    { group: '論理', name: 'empty', args: ['値'], desc: '空なら真' },
    { group: '文字', name: 'contains', args: ['文字列', '探す文字'], desc: '文字を含むか' },
    { group: '文字', name: 'replace', args: ['文字列', '置き換える文字', '新しい文字'], desc: '文字を置き換える' },
    { group: '文字', name: 'concat', args: ['値1', '値2', '…'], desc: '文字をつなげる' },
    { group: '文字', name: 'length', args: ['文字列'], desc: '文字数' },
    { group: '文字', name: 'format', args: ['値', '"書式"'], desc: '表示形式を整える（例 "#,##0.00"）' },
    { group: '数値', name: 'round', args: ['数値'], desc: '四捨五入' },
    { group: '数値', name: 'floor', args: ['数値'], desc: '切り捨て' },
    { group: '数値', name: 'ceil', args: ['数値'], desc: '切り上げ' },
    { group: '数値', name: 'abs', args: ['数値'], desc: '絶対値' },
    { group: '数値', name: 'mod', args: ['割られる数', '割る数'], desc: '割った余り' },
    { group: '数値', name: 'min', args: ['値1', '値2', '…'], desc: '最小値' },
    { group: '数値', name: 'max', args: ['値1', '値2', '…'], desc: '最大値' },
    { group: '数値', name: 'toNumber', args: ['値'], desc: '数値にする' },
    { group: '日付', name: 'now', args: [], desc: '今の日時' },
    { group: '日付', name: 'year', args: ['日時'], desc: '年' },
    { group: '日付', name: 'month', args: ['日時'], desc: '月' },
    { group: '日付', name: 'day', args: ['日時'], desc: '日' },
    { group: '日付', name: 'dateBetween', args: ['日時1', '日時2', '"days"'], desc: '2つの日時の差（日数・月数など）' },
    { group: '日付', name: 'dateAdd', args: ['日時', '数', '"days"'], desc: '日時を進める' },
    { group: '日付', name: 'dateSubtract', args: ['日時', '数', '"days"'], desc: '日時を戻す' },
    { group: 'その他', name: 'prop', args: ['"列名"'], desc: '列の値' },
    { group: 'その他', name: 'let', args: ['名前', '値', '式'], desc: '値に名前を付けて式で使う' },
    { group: 'その他', name: 'lets', args: ['名前1', '値1', '…', '式'], desc: '複数の値に名前を付ける' },
  ];
  const BY_NAME = new Map(FUNCTIONS.map(fn => [fn.name, fn]));
  const GROUPS = ['論理', '文字', '数値', '日付', 'その他'];

  const HELP = '列の値を使って計算します。列は prop("列名") で書き、「列」「関数」から選んで入れられます。入力中も候補が出ます（↑↓で選んでEnter）。';

  function escHtml(value) {
    if (typeof global.esc === 'function') return global.esc(value);
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function icon(name, size) {
    return typeof global.lucide === 'function' ? global.lucide(name, size) : '';
  }

  function propLiteral(name) {
    return typeof global._formulaPropLiteral === 'function'
      ? global._formulaPropLiteral(name, '"')
      : String(name || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function signatureText(fn) {
    return fn.name + '(' + fn.args.join(', ') + ')';
  }

  function matches(text, query) {
    if (global.MeldexSearchField?.matches) return global.MeldexSearchField.matches(text, query);
    return String(text).toLowerCase().includes(String(query).toLowerCase());
  }

  function html(current) {
    const help = typeof global.fieldHelp === 'function' ? global.fieldHelp(HELP) : '';
    return `<div class="pt-formula-editor" data-e2e-id="pt-formula-editor">
      <div class="pt-formula-head">
        <label class="pt-formula-label" for="pt-formula-src">数式 ${help}</label>
        <span class="pt-formula-head-actions">
          <button type="button" class="gb-btn gb-btn-sm pt-formula-insert" data-e2e-id="pt-formula-insert-prop" aria-haspopup="dialog" aria-expanded="false">${icon('columns', 14)}<span>列</span></button>
          <button type="button" class="gb-btn gb-btn-sm pt-formula-insert" data-e2e-id="pt-formula-insert-fn" aria-haspopup="dialog" aria-expanded="false">${icon('sigma', 14)}<span>関数</span></button>
        </span>
      </div>
      <textarea id="pt-formula-src" class="pt-formula-textarea" rows="5" spellcheck="false" autocomplete="off" aria-describedby="pt-formula-signature pt-formula-result">${escHtml(current?.formula || '')}</textarea>
      <div id="pt-formula-signature" class="pt-formula-signature" aria-live="polite"></div>
      <pre id="pt-formula-preview" class="pt-formula-preview" aria-label="数式の色分け表示"></pre>
      <div class="pt-formula-result-box">
        <span class="pt-formula-result-label">結果</span>
        <div id="pt-formula-result" class="pt-formula-result" aria-live="polite"></div>
      </div>
    </div>`;
  }

  // ---- 字句の解析（候補・引数表示・不明な列の確認に使う） ----
  function tokens(src) {
    if (typeof global.formulaTokenize !== 'function') return null;
    try { return global.formulaTokenize(src); } catch (_) { return null; }
  }

  // 文字列の途中か（前にある " の数で判断。\" は数えない）
  function insideString(before) {
    let inside = false;
    for (let i = 0; i < before.length; i++) {
      if (before[i] === '\\' && inside) { i++; continue; }
      if (before[i] === '"') inside = !inside;
    }
    return inside;
  }

  // カーソル位置を囲む関数呼び出しと、何番目の引数か。
  function enclosingCall(src, caret) {
    const toks = tokens(src.slice(0, caret)) || tokensLenient(src.slice(0, caret));
    const stack = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.type === 'op' && t.value === '(') {
        const prev = toks[i - 1];
        stack.push({ name: prev && prev.type === 'id' ? prev.value : '', arg: 0 });
      } else if (t.type === 'op' && t.value === ')') {
        stack.pop();
      } else if (t.type === 'op' && t.value === ',' && stack.length) {
        stack[stack.length - 1].arg += 1;
      }
    }
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].name) return stack[i];
    }
    return null;
  }

  // 閉じていない文字列があっても、手前までの字句を返す。
  function tokensLenient(src) {
    let text = src;
    if (insideString(text)) text += '"';
    return tokens(text) || [];
  }

  function referencedProps(src) {
    const toks = tokens(src);
    if (!toks) return [];
    const names = [];
    for (let i = 0; i + 2 < toks.length; i++) {
      if (toks[i].type === 'id' && toks[i].value === 'prop' && toks[i + 1].value === '(' && toks[i + 2].type === 'str') {
        names.push(toks[i + 2].value);
      }
    }
    return names;
  }

  function unknownFunctionPos(src, name) {
    const toks = tokens(src) || [];
    const hit = toks.find((t, i) => t.type === 'id' && t.value === name && toks[i + 1]?.value === '(');
    return hit ? hit.pos : null;
  }

  // ---- エラーの日本語化 ----
  function translateError(message) {
    const text = String(message || '');
    let m;
    if (text === 'Unterminated string') return '「"」が閉じていません';
    if (text === 'Invalid number') return '数値の書き方が正しくありません';
    if (text === 'Unexpected end') return '式が途中で終わっています';
    if (text === 'Expected ,') return '「,」で区切ってください';
    if ((m = /^Expected (.+) but got (.+)$/.exec(text))) {
      return m[2] === 'EOF' ? `「${m[1]}」が足りません` : `「${m[1]}」が必要なところに「${m[2]}」があります`;
    }
    if ((m = /^Unexpected token: (.*)$/.exec(text))) return `「${m[1]}」はここに書けません`;
    if ((m = /^Unknown function: (.*)$/.exec(text))) return `関数「${m[1]}」はありません`;
    if ((m = /^Circular formula reference: (.*)$/.exec(text))) return `数式の列「${m[1]}」が自分自身を参照しています`;
    return text;
  }

  // ---- 色分け表示（エラーの位置に印） ----
  function tokenClass(token) {
    if (token.type === 'str') return 'string';
    if (token.type === 'num') return 'number';
    if (token.type === 'bool') return 'boolean';
    if (token.type === 'id') return 'identifier';
    return 'operator';
  }

  function highlight(src, errorPos) {
    const hasError = Number.isFinite(errorPos);
    const mark = (text) => '<span class="pt-formula-error-mark">' + (text ? escHtml(text) : '&nbsp;') + '</span>';
    const plain = (from, to) => {
      if (to <= from) return '';
      if (hasError && errorPos >= from && errorPos < to) {
        return escHtml(src.slice(from, errorPos)) + mark(src[errorPos]) + escHtml(src.slice(errorPos + 1, to));
      }
      return escHtml(src.slice(from, to));
    };
    const toks = tokens(src);
    let out = '';
    if (!toks) {
      out = plain(0, src.length);
    } else {
      let cursor = 0;
      toks.forEach(token => {
        const start = Number.isFinite(token.pos) ? token.pos : cursor;
        const end = Number.isFinite(token.end) ? token.end : start + String(token.value || '').length;
        out += plain(cursor, start);
        const inner = hasError && errorPos >= start && errorPos < end ? mark(src.slice(start, end)) : escHtml(src.slice(start, end));
        out += '<span class="pt-formula-token pt-formula-token-' + tokenClass(token) + '">' + inner + '</span>';
        cursor = end;
      });
      out += plain(cursor, src.length);
    }
    if (hasError && errorPos >= src.length) out += mark('');
    return out;
  }

  // ---- 一覧から選ぶ（列・関数） ----
  function openPicker(anchor, kind, ctl) {
    if (!global.MeldexFilterPopup?.open) return;
    const textarea = ctl.textarea;
    const selection = { start: textarea.selectionStart ?? textarea.value.length, end: textarea.selectionEnd ?? textarea.value.length };
    const content = document.createElement('div');
    content.className = 'pt-formula-picker-body';
    const list = document.createElement('div');
    list.className = 'pt-formula-picker-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', kind === 'prop' ? '列' : '関数');

    const pick = (insertText, caretOffset) => {
      global.MeldexFilterPopup.close(false);
      ctl.insert(insertText, selection, caretOffset);
    };

    const itemButton = (labelText, detailText, attrs, onPick) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gb-context-menu-item pt-formula-picker-item';
      button.setAttribute('role', 'option');
      Object.entries(attrs).forEach(([key, value]) => button.setAttribute(key, value));
      const label = document.createElement('span');
      label.className = 'pt-formula-picker-label';
      label.textContent = labelText;
      button.appendChild(label);
      if (detailText) {
        const detail = document.createElement('span');
        detail.className = 'pt-formula-picker-detail';
        detail.textContent = detailText;
        button.appendChild(detail);
      }
      button.addEventListener('click', onPick);
      return button;
    };

    const renderList = (query) => {
      list.replaceChildren();
      if (kind === 'prop') {
        const props = ctl.getProps().filter(name => matches(name, query));
        props.forEach(name => list.appendChild(itemButton(name, '', { 'data-formula-prop': name }, () => pick('prop("' + propLiteral(name) + '")'))));
        if (!props.length) list.appendChild(emptyRow(query ? '一致する列はありません' : '列はありません'));
        return;
      }
      let shown = 0;
      GROUPS.forEach(group => {
        const fns = FUNCTIONS.filter(fn => fn.group === group && matches(fn.name + ' ' + fn.desc + ' ' + fn.args.join(' '), query));
        if (!fns.length) return;
        const head = document.createElement('div');
        head.className = 'gb-context-menu-label pt-formula-picker-group';
        head.textContent = group;
        list.appendChild(head);
        fns.forEach(fn => {
          shown += 1;
          list.appendChild(itemButton(signatureText(fn), fn.desc, { 'data-formula-fn': fn.name }, () => pick(fn.name + '()', fn.name.length + 1)));
        });
      });
      if (!shown) list.appendChild(emptyRow('一致する関数はありません'));
    };

    const emptyRow = (text) => {
      const row = document.createElement('div');
      row.className = 'gb-context-menu-label pt-formula-picker-empty';
      row.textContent = text;
      return row;
    };

    const search = global.MeldexSearchField?.create
      ? global.MeldexSearchField.create({
        placeholder: kind === 'prop' ? '列を検索' : '関数を検索（例: 日数、切り捨て）',
        e2eId: kind === 'prop' ? 'pt-formula-prop-search' : 'pt-formula-fn-search',
        onInput: renderList,
      })
      : null;
    if (search) {
      content.appendChild(search.element);
      search.input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.isComposing) {
          event.preventDefault();
          list.querySelector('.pt-formula-picker-item')?.click();
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          list.querySelector('.pt-formula-picker-item')?.focus();
        }
      });
    }
    list.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const items = [...list.querySelectorAll('.pt-formula-picker-item')];
      const index = items.indexOf(document.activeElement);
      if (index < 0) return;
      event.preventDefault();
      const next = event.key === 'ArrowDown' ? items[index + 1] : items[index - 1];
      if (next) next.focus();
      else if (event.key === 'ArrowUp') search?.input.focus();
    });
    content.appendChild(list);
    renderList('');
    const popup = global.MeldexFilterPopup.open(anchor, kind === 'prop' ? '列を挿入' : '関数を挿入', content);
    popup?.classList.add('pt-formula-picker');
    search?.input.focus();
  }

  // ---- 入力中の候補 ----
  function suggestions(ctl, value, caret) {
    const before = value.slice(0, caret);
    const propMatch = /prop\(\s*"((?:[^"\\]|\\.)*)$/.exec(before);
    if (propMatch) {
      const partial = propMatch[1].replace(/\\(.)/g, '$1');
      const props = ctl.getProps();
      const starts = props.filter(name => partial && matches(name.slice(0, partial.length), partial));
      const rest = props.filter(name => !starts.includes(name) && matches(name, partial));
      const items = [...starts, ...rest];
      if (items.length === 1 && items[0] === partial && value.slice(caret).startsWith('")')) return null;
      const from = caret - propMatch[1].length;
      let to = caret;
      const after = value.slice(caret);
      const closing = /^(?:(?:[^"\\\n]|\\.)*)"\s*\)?/.exec(after);
      if (closing) to = caret + closing[0].length;
      return { from, to, items: items.map(name => ({ label: name, insert: propLiteral(name) + '")' })) };
    }
    if (insideString(before)) return null;
    const idMatch = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(before);
    if (!idMatch) return null;
    const partial = idMatch[1];
    const lower = partial.toLowerCase();
    const fns = FUNCTIONS.filter(fn => fn.name.toLowerCase().startsWith(lower) && fn.name !== partial);
    if (!fns.length) return null;
    const after = value.slice(caret);
    const tail = /^[A-Za-z0-9_]*/.exec(after)[0];
    const hasParen = after.slice(tail.length).startsWith('(');
    return {
      from: caret - partial.length,
      to: caret + tail.length,
      items: fns.map(fn => ({
        label: fn.name,
        detail: fn.desc,
        insert: hasParen ? fn.name : fn.name + '()',
        caret: fn.name.length + 1,
      })),
    };
  }

  function bind(root, options = {}) {
    const textarea = root?.querySelector?.('#pt-formula-src');
    if (!textarea || textarea.dataset.formulaEditorBound) return null;
    textarea.dataset.formulaEditorBound = '1';
    const preview = root.querySelector('#pt-formula-preview');
    const result = root.querySelector('#pt-formula-result');
    const signature = root.querySelector('#pt-formula-signature');
    let timer = 0;

    const ctl = {
      textarea,
      getProps: () => (typeof options.getProps === 'function' ? options.getProps() : []).map(String),
      insert(text, selection, caretOffset) {
        const start = selection?.start ?? textarea.selectionStart ?? textarea.value.length;
        const end = selection?.end ?? textarea.selectionEnd ?? start;
        const selected = textarea.value.slice(start, end);
        let insertText = text;
        let caret = start + (Number.isFinite(caretOffset) ? caretOffset : text.length);
        // 関数を選んだ時に選択中の文字があれば、それを最初の引数にする（表計算ソフトと同じ）。
        if (Number.isFinite(caretOffset) && selected && text.endsWith('()')) {
          insertText = text.slice(0, -1) + selected + ')';
          caret = start + insertText.length;
        }
        textarea.value = textarea.value.slice(0, start) + insertText + textarea.value.slice(end);
        textarea.focus();
        textarea.setSelectionRange(caret, caret);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      },
    };

    function updateSignature() {
      if (!signature) return;
      const caret = textarea.selectionStart ?? textarea.value.length;
      const call = enclosingCall(textarea.value, caret);
      const fn = call ? BY_NAME.get(call.name) : null;
      if (!fn) { signature.replaceChildren(); return; }
      const parts = [document.createTextNode(fn.name + '(')];
      const lastIndex = fn.args.length - 1;
      fn.args.forEach((arg, index) => {
        if (index) parts.push(document.createTextNode(', '));
        const span = document.createElement('span');
        span.className = 'pt-formula-signature-arg';
        const variadicHit = fn.args[lastIndex] === '…' && index === lastIndex - 1 && call.arg >= index;
        if (call.arg === index || variadicHit) span.classList.add('active');
        span.textContent = arg;
        parts.push(span);
      });
      parts.push(document.createTextNode(')'));
      const desc = document.createElement('span');
      desc.className = 'pt-formula-signature-desc';
      desc.textContent = fn.desc;
      parts.push(desc);
      signature.replaceChildren(...parts);
    }

    function evaluateNow() {
      timer = 0;
      const src = textarea.value || '';
      const outcome = src.trim() && typeof options.evaluate === 'function' ? options.evaluate(src) : null;
      let errorPos = null;
      if (result) {
        result.classList.remove('is-error', 'is-warning');
        if (!src.trim()) {
          result.textContent = '';
        } else if (!outcome) {
          result.textContent = '';
        } else if (outcome.message) {
          result.textContent = outcome.message;
        } else if (outcome.error) {
          const unknownFn = /^Unknown function: (.*)$/.exec(outcome.error);
          errorPos = Number.isFinite(outcome.errorPos) ? outcome.errorPos : (unknownFn ? unknownFunctionPos(src, unknownFn[1]) : null);
          const where = Number.isFinite(errorPos) ? (errorPos + 1) + '文字目: ' : '';
          result.textContent = 'エラー（' + where + translateError(outcome.error) + '）';
          result.classList.add('is-error');
        } else {
          const known = new Set(ctl.getProps());
          const missing = referencedProps(src).filter(name => !known.has(name));
          const value = outcome.value === '' || outcome.value == null ? '（空）' : String(outcome.value);
          const label = outcome.entityLabel ? outcome.entityLabel + ' → ' : '';
          result.textContent = label + value;
          if (missing.length) {
            const warn = document.createElement('div');
            warn.className = 'pt-formula-result-warning';
            warn.textContent = [...new Set(missing)].map(name => '列「' + name + '」がありません').join('／');
            result.appendChild(warn);
            result.classList.add('is-warning');
          }
        }
      }
      if (preview) preview.innerHTML = highlight(src, errorPos);
    }

    function scheduleEvaluate() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(evaluateNow, 150);
    }

    root.querySelector('[data-e2e-id="pt-formula-insert-prop"]')?.addEventListener('click', event => openPicker(event.currentTarget, 'prop', ctl));
    root.querySelector('[data-e2e-id="pt-formula-insert-fn"]')?.addEventListener('click', event => openPicker(event.currentTarget, 'fn', ctl));
    global.MeldexInputSuggest?.attach(textarea, {
      ariaLabel: '数式の候補',
      getSuggestions: (value, caret) => suggestions(ctl, value, caret),
    });
    textarea.addEventListener('input', () => { updateSignature(); scheduleEvaluate(); });
    ['keyup', 'click', 'focus'].forEach(type => textarea.addEventListener(type, updateSignature));
    evaluateNow();
    return { evaluateNow, updateSignature };
  }

  global.MeldexFormulaEditor = Object.freeze({
    html,
    bind,
    translateError,
    highlight,
    functions: () => FUNCTIONS.map(fn => ({ ...fn, args: [...fn.args] })),
  });
})(window);
