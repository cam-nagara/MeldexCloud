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
  const _RAW_DATA_ACTION_ALLOWLIST = new Set([
    "document.querySelectorAll('#uf-all,#uf-adopted,#uf-nobotsu').forEach(b=>b.classList.remove('primary'));this.classList.add('primary');",
    "cfConfirm('レイアウトを初期化しますか？').then(ok=>{if(ok)resetLayoutToDefault();})",
    "cfConfirm('表示と操作の設定を初期化しますか？\\n作品、ワークスペース、ソースフォルダ、下書き、共有登録、APIキーは削除しません。\\n成功後にページを再読み込みします。').then(ok=>{if(ok)resetAllSettings();})",
    "apiPost('/caldav/sync-to-ics').then(r=>showStatus('同期完了: '+r.synced+'件'))",
    "apiPost('/caldav/sync-from-ics',{user:(typeof getUsername==='function'?getUsername():'')}).then(r=>showStatus('取込: '+r.imported+'件, 更新: '+r.updated+'件'))",
    "document.getElementById('settings-transfer-import-input')?.click()",
  ]);

  function parseAction(actionStr) {
    if (!actionStr) return null;
    const actionName = '([a-zA-Z_$][a-zA-Z0-9_$]*)(?:\\.([a-zA-Z_$][a-zA-Z0-9_$]*))*';
    const match = actionStr.match(new RegExp('^(' + actionName + ')\\((.*)\\)$'));
    if (match) {
      return { fn: match[1], argsStr: match[match.length - 1], isCall: true };
    }
    // 引数なし: "functionName" のみ
    const matchSimple = actionStr.match(new RegExp('^(' + actionName + ')$'));
    if (matchSimple) {
      return { fn: matchSimple[1], argsStr: '', isCall: false };
    }
    return null;
  }

  function _resolveActionFunction(fnName) {
    const parts = String(fnName || '').split('.').filter(Boolean);
    if (!parts.length || parts.some(part => _BLOCKED_ACTION_NAMES.has(part))) return null;
    let cursor = window;
    for (const part of parts) {
      cursor = cursor?.[part];
      if (cursor == null) return null;
    }
    return typeof cursor === 'function' ? cursor : null;
  }

  function _parseActionToken(token, element, event) {
    if (token === 'event' || token === 'e') return event;
    if (token === 'this') return element;
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
    if (/^['"].*['"]$/.test(token)) return token.slice(1, -1);
    const datasetMatch = token.match(/^this\.dataset\.([a-zA-Z_$][a-zA-Z0-9_$]*)$/);
    if (datasetMatch) return element?.dataset?.[datasetMatch[1]];
    const closestMatch = token.match(/^this\.closest\((['"])([^'"]+)\1\)$/);
    if (closestMatch) return element?.closest?.(closestMatch[2]) || null;
    const fn = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(token) ? _resolveActionFunction(token) : null;
    if (fn) return fn;
    return token;
  }

  function _executeKnownRawDataAction(actionStr, element, event) {
    const closestRemove = actionStr.match(/^this\.closest\((['"])([^'"]+)\1\)\.remove\(\)$/);
    if (closestRemove) {
      element?.closest?.(closestRemove[2])?.remove?.();
      return true;
    }
    if (actionStr === 'this.parentElement.remove()') {
      element?.parentElement?.remove?.();
      return true;
    }
    if (!_RAW_DATA_ACTION_ALLOWLIST.has(actionStr)) return false;
    executeRawHandler(actionStr, element, event);
    return true;
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
      const fn = _resolveActionFunction(parsed.fn);
      if (typeof fn === 'function') {
        const argsStr = parsed.argsStr.trim();
        if (!argsStr) {
          if (parsed.isCall) fn();
          else fn(event);
          return;
        }
        if (/[;{}]/.test(argsStr) || /=>/.test(argsStr) || /\)\s*\./.test(actionStr)) {
          if (_executeKnownRawDataAction(actionStr, element, event)) return;
          console.warn('gb-events blocked complex data-action:', actionStr);
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
          args.push(_parseActionToken(token, element, event));
        }
        // 末尾に event を付けて呼び出す。余剰引数は無視されるので後方互換。
        // 関数側が event を参照したい場合は arity を 1 増やすだけで受け取れる
        fn(...args, event);
        return;
      }
    }

    // パースできない複雑な式は、静的に把握している既存UI操作だけ実行する。
    if (!_executeKnownRawDataAction(actionStr, element, event)) {
      console.warn('gb-events blocked unknown data-action:', actionStr);
    }
  }

  function _eventElementTarget(event) {
    const rawTarget = event?.target;
    if (rawTarget instanceof Element) return rawTarget;
    if (rawTarget && rawTarget.parentElement instanceof Element) return rawTarget.parentElement;
    return null;
  }

  function _isDisabledActionTarget(element) {
    if (!element) return false;
    return element.disabled === true
      || element.hasAttribute('disabled')
      || element.getAttribute('aria-disabled') === 'true'
      || element.getAttribute('data-cloud-disabled') === '1';
  }

  // === click イベント委譲 ===
  document.addEventListener('click', (e) => {
    const baseTarget = _eventElementTarget(e);
    const target = baseTarget?.closest('[data-action]');
    if (!target) return;
    if (_isDisabledActionTarget(target)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
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
    const target = _eventElementTarget(e)?.closest('[data-onchange]');
    if (!target) return;
    executeRawHandler(target.dataset.onchange, target, e);
  });

  // === input イベント委譲 ===
  document.addEventListener('input', (e) => {
    const target = _eventElementTarget(e)?.closest('[data-oninput]');
    if (!target) return;
    executeRawHandler(target.dataset.oninput, target, e);
  });

  // === keydown イベント委譲 ===
  document.addEventListener('keydown', (e) => {
    const target = _eventElementTarget(e)?.closest('[data-onkeydown]');
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
    const target = _eventElementTarget(e)?.closest('[data-onfocus]');
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

  function _hasSharedTooltip() {
    return !!(window.GBTooltip
      && typeof window.GBTooltip.showFor === 'function'
      && typeof window.GBTooltip.hide === 'function');
  }

  function _sharedTooltipVisible() {
    const tip = document.getElementById('gb-tooltip');
    return !!(tip && !tip.hidden && tip.classList.contains('is-visible'));
  }

  function _showTip(el, text, e) {
    if (_hasSharedTooltip()) {
      // 共有ツールチップ側の除外対象（タブ・チャットMarkdownリンク等のカスタム
      // リンク種）は、この旧 title 経路からも表示しない（抑止契約の迂回防止）
      if (typeof window.GBTooltip.isEligible === 'function' && !window.GBTooltip.isEligible(el)) return;
      window.GBTooltip.showFor(el, text);
      return;
    }
    if (!_tipEl) {
      _tipEl = document.createElement('div');
      _tipEl.className = 'gb-tooltip';
      _tipEl.setAttribute('role', 'tooltip');
      _tipEl.setAttribute('aria-hidden', 'true');
      _tipEl.hidden = true;
      document.body.appendChild(_tipEl);
    }
    _tipEl.textContent = text;
    _tipEl.classList.remove('visible');
    _tipEl.classList.remove('is-visible');
    _tipEl.hidden = false;
    _tipEl.setAttribute('aria-hidden', 'false');
    const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1);
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const x = Math.max(4, Math.min(e.clientX / z + 12, vw - _tipEl.offsetWidth - 8));
    const y = e.clientY / z + 20;
    _tipEl.style.left = x + 'px';
    _tipEl.style.top = Math.max(4, y + 24 > vh ? e.clientY / z - 28 : y) + 'px';
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(_tipEl);
    _tipEl.classList.add('visible');
    _tipEl.classList.add('is-visible');
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
    const visible = !!(_tipEl && _tipEl.classList.contains('visible')) || _sharedTooltipVisible();
    clearTimeout(_tipTimer);
    _tipTimer = null;
    if (_hasSharedTooltip()) window.GBTooltip.hide();
    if (_tipEl) {
      _tipEl.classList.remove('visible');
      _tipEl.classList.remove('is-visible');
      _tipEl.hidden = true;
      _tipEl.setAttribute('aria-hidden', 'true');
    }
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
    const el = _eventElementTarget(e)?.closest('[title]');
    if (!el || el === _tipTarget) return;
    _queueTip(el, e);
  });
  document.addEventListener('pointermove', (e) => {
    if (!_tipTarget && !_tipTimer) return;
    const next = _eventElementTarget(e)?.closest('[data-_title], [title]');
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
    const el = _eventElementTarget(e)?.closest('[data-_title]');
    if (el && el !== _tipSuppressedTarget) _restoreTipTitle(el);
    _hideTip();
  });
  document.addEventListener('pointerdown', () => _hideTip(true));

})();
