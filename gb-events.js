/* ==============================
   gb-events.js: Meldex.htmlのインラインイベントハンドラ代替（v5.0 Phase D）
   data-action属性をaddEventListenerで処理
   ============================== */

(function() {
  'use strict';

  // === data-action のイベント委譲 ===
  // data-action="functionName(args)" を解析して実行

  // 新方式 data-args 経路でブロックする予約名。window[name] がプロトタイプ汚染や
  // 任意コード実行の入口になり得る識別子を明示的に弾く
  const _BLOCKED_ACTION_NAMES = new Set(['constructor', 'eval', 'Function', '__proto__', 'prototype']);

  function parseAction(actionStr) {
    if (!actionStr) return null;
    const match = actionStr.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\((.*)\)$/);
    if (match) {
      return { fn: match[1], argsStr: match[2], isCall: true };
    }
    // 引数なし: "functionName" のみ
    const matchSimple = actionStr.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)$/);
    if (matchSimple) {
      return { fn: matchSimple[1], argsStr: '', isCall: false };
    }
    return null;
  }

  function executeAction(actionStr, element, event) {
    if (!actionStr) return;

    // 新方式: data-action="foo" + data-args='[1,"x",true]' or '{"k":1}'
    // JSON で引数をエンコードし、文字列埋め込みパースを避ける
    if (element && element.dataset && element.dataset.args !== undefined) {
      const fnName = actionStr.trim();
      if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(fnName) && !_BLOCKED_ACTION_NAMES.has(fnName)) {
        const fn = window[fnName];
        if (typeof fn === 'function') {
          const raw = element.dataset.args;
          let parsedArgs;
          let parseOk = true;
          try {
            parsedArgs = raw ? JSON.parse(raw) : undefined;
          } catch (err) {
            console.warn('gb-events data-args parse error:', err, raw);
            parseOk = false;
          }
          if (parseOk) {
            if (Array.isArray(parsedArgs)) fn(...parsedArgs, event);
            else if (parsedArgs !== undefined) fn(parsedArgs, event);
            else fn(event);
            return;
          }
          // パース失敗時は return せず、既存の parseAction 経路にフォールバック
        }
      }
    }

    // シンプルなケース: functionName() or functionName('arg') をパース
    const parsed = parseAction(actionStr);
    if (parsed) {
      const fn = window[parsed.fn];
      if (typeof fn === 'function') {
        const argsStr = parsed.argsStr.trim();
        if (!argsStr) {
          if (parsed.isCall) fn();
          else fn(event);
          return;
        }
        // 引数にネストした関数呼び出しやthisがある場合はraw実行にフォールバック
        if (argsStr.includes('(') || argsStr.includes('=>') || argsStr.includes('this')) {
          executeRawHandler(actionStr, element, event);
          return;
        }
        // シンプルな引数をパース（クォート内カンマを考慮）
        const args = [];
        const argTokens = [];
        let cur = '', inStr = null, esc = false;
        for (const ch of argsStr) {
          if (esc) { cur += ch; esc = false; continue; }
          if (ch === '\\') { cur += ch; esc = true; continue; }
          if (inStr) { cur += ch; if (ch === inStr) inStr = null; continue; }
          if (ch === '"' || ch === "'") { cur += ch; inStr = ch; continue; }
          if (ch === ',') { argTokens.push(cur.trim()); cur = ''; continue; }
          cur += ch;
        }
        if (cur.trim() !== '') argTokens.push(cur.trim());
        for (const token of argTokens) {
          if (token === 'event' || token === 'e') args.push(event);
          else if (token === 'true') args.push(true);
          else if (token === 'false') args.push(false);
          else if (/^-?\d+(\.\d+)?$/.test(token)) args.push(Number(token));
          else if (/^['"].*['"]$/.test(token)) args.push(token.slice(1, -1));
          else if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(token) && typeof window[token] === 'function') args.push(window[token]);
          else args.push(token); // 文字列としてそのまま渡す（evalは使わない）
        }
        // 末尾に event を付けて呼び出す。余剰引数は無視されるので後方互換。
        // 関数側が event を参照したい場合は arity を 1 増やすだけで受け取れる
        fn(...args, event);
        return;
      }
    }

    // パースできない複雑な式はraw実行（new Function経由）
    executeRawHandler(actionStr, element, event);
  }

  function _eventElementTarget(event) {
    const rawTarget = event?.target;
    if (rawTarget instanceof Element) return rawTarget;
    if (rawTarget && rawTarget.parentElement instanceof Element) return rawTarget.parentElement;
    return null;
  }

  // === click イベント委譲 ===
  document.addEventListener('click', (e) => {
    const baseTarget = _eventElementTarget(e);
    const target = baseTarget?.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action) {
      executeAction(action, target, e);
    }
  });

  // === 汎用ハンドラ実行（this参照・複数文・関数呼び出しすべてに対応）===
  function executeRawHandler(handler, element, event) {
    if (!handler) return;
    try {
      const fn = new Function('event', handler);
      fn.call(element, event);
    } catch (err) {
      // 開発時のデバッグ用
      console.warn('gb-events handler error:', err, handler);
    }
  }

  // === change イベント委譲 ===
  document.addEventListener('change', (e) => {
    const target = e.target.closest('[data-onchange]');
    if (!target) return;
    executeRawHandler(target.dataset.onchange, target, e);
  });

  // === input イベント委譲 ===
  document.addEventListener('input', (e) => {
    const target = e.target.closest('[data-oninput]');
    if (!target) return;
    executeRawHandler(target.dataset.oninput, target, e);
  });

  // === keydown イベント委譲 ===
  document.addEventListener('keydown', (e) => {
    const target = e.target.closest('[data-onkeydown]');
    if (!target) return;
    if (e.isComposing || e.keyCode === 229) return;
    // data-onkeydown は複雑な条件式が多い（if文等）
    // 安全のためFunction経由で実行
    const handler = target.dataset.onkeydown;
    if (handler) {
      try {
        const fn = new Function('event', handler);
        fn.call(target, e);
      } catch {}
    }
  });

  // === focus イベント委譲 ===
  document.addEventListener('focus', (e) => {
    const target = e.target.closest('[data-onfocus]');
    if (!target) return;
    const handler = target.dataset.onfocus;
    if (handler) {
      try {
        const fn = new Function('event', handler);
        fn.call(target, e);
      } catch {}
    }
  }, true); // focusはキャプチャフェーズで捕捉

  // === カスタムツールチップ（ネイティブtitle属性を置換） ===
  let _tipEl = null, _tipTimer = null, _tipTarget = null, _tipSuppressedTarget = null;
  function _showTip(el, text, e) {
    if (!_tipEl) { _tipEl = document.createElement('div'); _tipEl.className = 'gb-tooltip'; document.body.appendChild(_tipEl); }
    _tipEl.textContent = text;
    _tipEl.classList.remove('visible');
    const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1);
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const x = Math.max(4, Math.min(e.clientX / z + 12, vw - _tipEl.offsetWidth - 8));
    const y = e.clientY / z + 20;
    _tipEl.style.left = x + 'px';
    _tipEl.style.top = Math.max(4, y + 24 > vh ? e.clientY / z - 28 : y) + 'px';
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(_tipEl);
    _tipEl.classList.add('visible');
  }

  function _restoreTipTitle(el) {
    if (!el?.dataset?._title) return;
    el.setAttribute('title', el.dataset._title);
    delete el.dataset._title;
  }

  function _isTipSuppressed(el) {
    if (!_tipSuppressedTarget) return false;
    if (!document.documentElement.contains(_tipSuppressedTarget)) {
      _tipSuppressedTarget = null;
      return false;
    }
    return el === _tipSuppressedTarget || _tipSuppressedTarget.contains(el);
  }

  function _clearTipSuppression() {
    if (!_tipSuppressedTarget) return;
    const prev = _tipSuppressedTarget;
    _tipSuppressedTarget = null;
    _restoreTipTitle(prev);
  }

  function _hideTip(restoreTitle = false, suppressUntilLeave = false) {
    const prev = _tipTarget;
    const visible = !!(_tipEl && _tipEl.classList.contains('visible'));
    clearTimeout(_tipTimer);
    _tipTimer = null;
    if (_tipEl) _tipEl.classList.remove('visible');
    if (suppressUntilLeave && visible && prev && document.documentElement.contains(prev)) {
      if (_tipSuppressedTarget && _tipSuppressedTarget !== prev) _restoreTipTitle(_tipSuppressedTarget);
      _tipSuppressedTarget = prev;
    } else if (restoreTitle) {
      _restoreTipTitle(prev);
    }
    _tipTarget = null;
  }

  function _queueTip(el, e) {
    if (!el) return;
    if (_tipSuppressedTarget && !_tipSuppressedTarget.contains(el)) _clearTipSuppression();
    if (_isTipSuppressed(el)) return;
    _hideTip(true);
    _tipTarget = el;
    // title属性を退避してネイティブツールチップを抑制
    if (!el.dataset._title) { el.dataset._title = el.getAttribute('title'); el.removeAttribute('title'); }
    const text = el.dataset._title;
    if (!text) {
      _restoreTipTitle(el);
      _tipTarget = null;
      return;
    }
    _tipTimer = setTimeout(() => _showTip(el, text, e), 400);
  }

  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest('[title]');
    if (!el || el === _tipTarget) return;
    _queueTip(el, e);
  });
  document.addEventListener('pointermove', (e) => {
    if (!_tipTarget && !_tipTimer) return;
    const next = e.target.closest('[data-_title], [title]');
    if (_tipEl && _tipEl.classList.contains('visible')) {
      _hideTip(false, true);
      if (next) _queueTip(next, e);
      return;
    }
    if (!next) {
      _hideTip(true);
      return;
    }
    if (_tipTarget && next !== _tipTarget && !_tipTarget.contains(next)) {
      _hideTip(true);
      _queueTip(next, e);
    }
  });
  document.addEventListener('pointerout', (e) => {
    if (_tipSuppressedTarget && (!(e.relatedTarget instanceof Node) || !_tipSuppressedTarget.contains(e.relatedTarget))) {
      _clearTipSuppression();
    }
    const el = e.target.closest('[data-_title]');
    if (el && el !== _tipSuppressedTarget) _restoreTipTitle(el);
    _hideTip();
  });
  document.addEventListener('pointerdown', () => _hideTip(true));

})();
