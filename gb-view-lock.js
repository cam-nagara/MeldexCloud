/**
 * gb-view-lock.js — 表示ロック（view lock）
 *
 * 計画書 `docs/annotation_unification_plan.md` §4.4 / §8 を実装する。
 *
 * 要点:
 * - 各ビュー（ノート / シナリオ / シート全サブビュー / カレンダー / ビューワー等）で、
 *   注釈レイヤの座標系が崩れる操作（フィルタ・折り畳み・viewMode 切替等）を
 *   「ロック」状態のあいだブロックする。スクロールは注釈レイヤ側で追従するため許可する。
 * - ブロック時はユーザー指示 §8.4 の確認ダイアログを出し、「はい」で解除 + 操作を通す。
 * - 表示ロックは既定OFF。ユーザーがロックアイコンを押した時点の表示状態を
 *   view_lock.state に保存する。注釈ストロークの一筆目では自動ロックしない。
 * - ロック状態はサーバ (view_lock テーブル) にペイン単位 (view_key = target_path#pane_id) で永続化。
 * - ボード (Canvas) は座標系が内部に閉じているため requiresViewLock=false。
 *
 * 公開 API（window.ViewLock）:
 *   isSupported(type)          : ツールタイプが view_lock 対象か
 *   viewKey(target, paneId)    : "target#paneId" の view_key
 *   get(viewKey)               : サーバから view_lock を取得（キャッシュ込み）
 *   invalidate(viewKey?)       : キャッシュ無効化
 *   isLocked(viewKey)          : 同期判定（キャッシュ経由）。未取得なら false
 *   engage(viewKey, kind, getState)
 *                              : 互換API。既定OFF維持のため自動ロックせず true を返す。
 *   guardAction(viewKey, kind) : ロック中の表示変更操作を通す前に呼ぶ。解除ダイアログ表示。
 *                                true=操作通過、false=キャンセル。
 *   toggle(viewKey, kind, getState)
 *                              : ロック切替（UI アイコンから）。
 *   bindHudIcon(hostEl, target, paneId, kind, getState)
 *                              : ビューヘッダーに差し込むロックアイコンを生成・更新する。
 *   guardScrollContainer(containerEl, viewKey, kind)
 *                              : 互換API。スクロールはロック中も許可し、現在位置だけ記録する。
 */
(function () {
  if (typeof window === 'undefined') return;

  // 対応タイプ（計画書 §8.2）
  // board は false（Canvas 内部座標）、outliner/chat/annotation/history/detail/search は対象外。
  const SUPPORTED_TYPES = new Set([
    'page', 'scriptnote', 'db', 'calendar', 'media', 'folder', 'compare',
  ]);

  // サーバ応答キャッシュ
  const _cache = new Map(); // viewKey → { locked, state, target_kind, ts }
  const _inflight = new Map(); // viewKey → Promise
  let _hudHostSeq = 0;
  let _hudIconSeq = 0;

  function isSupported(type) {
    return SUPPORTED_TYPES.has(String(type || ''));
  }

  function viewKey(target, paneId) {
    const t = String(target || '').trim();
    const p = String(paneId || '').trim();
    if (!t) return '';
    return p ? (t + '#' + p) : t;
  }

  function invalidate(key) {
    if (key) { _cache.delete(key); _inflight.delete(key); }
    else { _cache.clear(); _inflight.clear(); }
  }

  async function get(vk) {
    if (!vk) return null;
    const cached = _cache.get(vk);
    if (cached) return cached;
    if (_inflight.has(vk)) return _inflight.get(vk);
    const p = (async () => {
      try {
        const raw = await apiFetch('/view-lock?view_key=' + encodeURIComponent(vk));
        const entry = {
          view_key: vk,
          locked: !!raw?.locked,
          state: raw?.state || {},
          target_kind: raw?.target_kind || '',
          target_path: raw?.target_path || '',
          pane_id: raw?.pane_id || '',
          locked_at: raw?.locked_at || '',
          locked_by: raw?.locked_by || '',
        };
        _cache.set(vk, entry);
        return entry;
      } catch (_) {
        return { view_key: vk, locked: false, state: {}, target_kind: '' };
      } finally {
        _inflight.delete(vk);
      }
    })();
    _inflight.set(vk, p);
    return p;
  }

  // 同期判定。キャッシュに載っていれば即返す。未取得なら false（安全側）。
  function isLocked(vk) {
    if (!vk) return false;
    const e = _cache.get(vk);
    return !!(e && e.locked);
  }

  async function putLock(vk, target, paneId, kind, locked, state, user) {
    if (!vk) return false;
    try {
      await apiPut('/view-lock', {
        view_key: vk,
        target_path: target || '',
        pane_id: paneId || '',
        target_kind: kind || '',
        locked: locked ? 1 : 0,
        state: state || {},
        locked_by: user || (typeof getUsername === 'function' ? getUsername() : ''),
      });
      invalidate(vk);
      // 新しい状態をキャッシュに入れ直す
      _cache.set(vk, {
        view_key: vk,
        locked: !!locked,
        state: state || {},
        target_kind: kind || '',
        target_path: target || '',
        pane_id: paneId || '',
        locked_at: locked ? new Date().toISOString() : '',
        locked_by: user || '',
      });
      _notifyChange(vk);
      return true;
    } catch (_) {
      return false;
    }
  }

  // 互換API。表示ロックはユーザーが明示的にロックアイコンから有効化する。
  // 注釈ストロークの一筆目では自動ロックも確認ダイアログも出さない。
  async function engage(vk, kind, getState) {
    if (!vk) return true; // view_key が取れないビューはガード対象外
    await get(vk);
    return true;
  }

  // §8.4 ロック中の操作ブロック。解除を促し、解除したら true。キャンセルなら false。
  async function guardAction(vk, kind) {
    if (!vk) return true;
    if (!isLocked(vk)) {
      // キャッシュに無い場合は非同期取得。ここは同期判定なので false 相当＝通過扱い
      const e = await get(vk);
      if (!e?.locked) return true;
    }
    const ok = await cfConfirm(
      'このビューは注釈のため表示ロックされています。表示ロックを解除すると既存の注釈位置がズレる可能性があります（注釈自体は削除されません）。表示ロックを解除しますか？'
    );
    if (!ok) return false;
    const cur = _cache.get(vk) || {};
    const target = cur.target_path || (vk.split('#')[0] || '');
    const paneId = cur.pane_id || (vk.split('#')[1] || '');
    const unlocked = await putLock(vk, target, paneId, kind || cur.target_kind, false, cur.state || {});
    if (!unlocked && isLocked(vk)) {
      if (typeof showStatus === 'function') showStatus('表示ロック解除に失敗しました', true);
      return false;
    }
    return true;
  }

  // ロック切替（UI アイコンから）
  async function toggle(vk, kind, getState) {
    if (!vk) return;
    await get(vk);
    const cur = _cache.get(vk) || {};
    if (cur.locked) {
      const ok = await cfConfirm(
        'このビューの表示ロックを解除します。解除後はフィルタ・折り畳み・表示モード等の変更が自由に行えますが、既存の注釈位置がズレる可能性があります。解除しますか？'
      );
      if (!ok) return;
      const target = cur.target_path || (vk.split('#')[0] || '');
      const paneId = cur.pane_id || (vk.split('#')[1] || '');
      const unlocked = await putLock(vk, target, paneId, kind, false, cur.state || {});
      if (!unlocked && isLocked(vk)) {
        if (typeof showStatus === 'function') showStatus('表示ロック解除に失敗しました', true);
        return;
      }
    } else {
      const target = cur.target_path || (vk.split('#')[0] || '');
      const paneId = cur.pane_id || (vk.split('#')[1] || '');
      const state = (typeof getState === 'function' ? getState() : {}) || {};
      const locked = await putLock(vk, target, paneId, kind, true, state);
      if (!locked) {
        if (typeof showStatus === 'function') showStatus('表示ロックに失敗しました', true);
        return;
      }
    }
    // UI の更新は呼び出し側（bindHudIcon）が _cache を読み直して反映する
    _notifyChange(vk);
  }

  // 変更通知
  const _subs = new Map(); // vk → Set<fn>
  function subscribe(vk, fn) {
    if (!_subs.has(vk)) _subs.set(vk, new Set());
    _subs.get(vk).add(fn);
    return () => { _subs.get(vk)?.delete(fn); };
  }
  function _notifyChange(vk) {
    _subs.get(vk)?.forEach(fn => { try { fn(); } catch (_) {} });
  }

  function _ensureHudHostIdentity(hostEl) {
    const current = hostEl.dataset.viewLockHostId || '';
    const shared = current && Array.from(document.querySelectorAll('[data-view-lock-host-id]'))
      .some(el => el !== hostEl && el.dataset?.viewLockHostId === current);
    if (!current || shared) {
      _hudHostSeq += 1;
      hostEl.dataset.viewLockHostId = `vl-host-${_hudHostSeq}`;
    }
    return String(hostEl.dataset.viewLockHostId || 'vl-host').replace(/[^\w-]/g, '_');
  }

  function _assignHudIconIdentity(btn, hostKey, target, paneId, kind, vk) {
    _hudIconSeq += 1;
    btn.dataset.viewLockIconId = `vl-icon-${_hudIconSeq}`;
    const targetKey = String(target || vk || 'target').replace(/[^\w-]/g, '_').slice(0, 80) || 'target';
    const iconKey = String(btn.dataset.viewLockIconId).replace(/[^\w-]/g, '_');
    btn.dataset.e2eId = `view-lock-${kind || 'view'}-${paneId || 'global'}-${targetKey}-${hostKey}-${iconKey}`;
  }

  function _resolveHudContainer(hostEl) {
    if (!hostEl) return null;
    const directToolbar = hostEl.querySelector(':scope > .gb-toolbar, :scope > .smart-db-toolbar, :scope > [id$="-toolbar"]');
    if (directToolbar) return directToolbar;
    const first = hostEl.firstElementChild;
    if (!first) return hostEl;
    const cs = getComputedStyle(first);
    if (cs.display.includes('flex') && cs.position !== 'absolute' && cs.position !== 'fixed') return first;
    return hostEl;
  }

  // ビュー右上のロックアイコンを生成して hostEl に配置。
  //   kind       : target_kind（'page'|'scriptnote'|'db'|'calendar'|'media' 等）
  //   getState   : 現在の表示状態を返す関数（scrollX/scrollY/viewMode 等）
  function bindHudIcon(hostEl, target, paneId, kind, getState) {
    if (!hostEl) return null;
    const vk = viewKey(target, paneId);
    if (!vk) return null;
    const hostIsButton = hostEl.matches?.('button.vl-lock-icon');
    const containerEl = hostIsButton ? (hostEl.parentElement || hostEl) : (_resolveHudContainer(hostEl) || hostEl);
    let btn = hostIsButton ? hostEl : hostEl.querySelector('.vl-lock-icon');
    if (!btn) {
      btn = document.createElement('button');
      btn.className = 'vl-lock-icon';
      btn.type = 'button';
      btn.style.cssText = 'position:static;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;background:var(--bg2);color:var(--fg2);border:1px solid var(--border);border-radius:4px;cursor:pointer;opacity:0.85;';
      btn.title = '表示ロック';
    }
    if (!hostIsButton && btn.parentElement !== containerEl) containerEl.appendChild(btn);
    btn.type = 'button';
    btn.disabled = false;
    btn.style.opacity = '';
    const identityHost = hostIsButton ? containerEl : hostEl;
    const hostKey = _ensureHudHostIdentity(identityHost);
    _assignHudIconIdentity(btn, hostKey, target, paneId, kind, vk);
    if (btn._viewLockClickHandler) {
      btn.removeEventListener('click', btn._viewLockClickHandler);
    }
    if (typeof btn._viewLockUnsubscribe === 'function') {
      try { btn._viewLockUnsubscribe(); } catch (_) {}
      btn._viewLockUnsubscribe = null;
    }
    btn._viewLockClickHandler = (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      toggle(vk, kind, getState);
    };
    btn.addEventListener('click', btn._viewLockClickHandler);
    const render = () => {
      const entry = _cache.get(vk);
      const locked = !!(entry && entry.locked);
      btn.innerHTML = typeof lucide === 'function'
        ? lucide(locked ? 'lock' : 'unlock', 14)
        : (locked ? '🔒' : '🔓');
      btn.title = locked
        ? '表示ロック中です（クリックで解除）'
        : '表示ロックを有効にする';
      btn.style.color = locked ? 'var(--accent)' : 'var(--fg2)';
    };
    render();
    // 初期取得後に再描画
    get(vk).then(render).catch(() => {});
    btn._viewLockUnsubscribe = subscribe(vk, render);
    return { el: btn, viewKey: vk, refresh: render };
  }

  // 旧API名との互換用。スクロールは注釈レイヤ側で追従できるため、ロック中も止めない。
  // ここでは現在位置だけ記録し、表示状態の変更ガードは installInteractionInterceptor に委ねる。
  function guardScrollContainer(containerEl, vk, kind) {
    if (!containerEl || !vk) return;
    containerEl._vlGuardedKey = vk;
    containerEl._vlGuardedKind = kind || '';
    containerEl._vlScrollLockPassthrough = true;
    const remember = containerEl._vlRememberScrollHandler || (() => {
      containerEl._vlLastScrollState = {
        scrollTop: containerEl.scrollTop || 0,
        scrollLeft: containerEl.scrollLeft || 0,
      };
    });
    if (!containerEl._vlRememberScrollHandler) {
      containerEl._vlRememberScrollHandler = remember;
      containerEl.addEventListener('scroll', remember, { passive: true });
    }
    remember();
  }

  // 計画書 §8.4: ロック中の表示状態を変える操作を「入力段階でブロック」するため、
  // document の capture フェーズで click/change/beforeinput/paste をインターセプトする。
  //   - ガード対象: アクティブビュー内部、関連ツールバー、明示的な data-vl-guard 要素。
  //   - テキスト入力や contenteditable も、キャッシュ未取得時は一旦止めてからロック状態を確認する。
  let _interceptInstalled = false;
  function installInteractionInterceptor(getActiveInfo, getScrollContainerEl) {
    if (_interceptInstalled) return;
    _interceptInstalled = true;
    const editableInputSel = 'textarea, input:not([type]), input[type=text], input[type=search], input[type=url], input[type=email], input[type=password], input[type=number], input[type=date], input[type=datetime-local], input[type=month], input[type=time], input[type=week], input[type=color]';
    const editableSel = `${editableInputSel}, [contenteditable="true"], [contenteditable="plaintext-only"], [contenteditable]:not([contenteditable="false"]), [role="textbox"]`;
    const interactiveSel = `button, select, input[type=checkbox], input[type=radio], input[type=range], input[type=button], input[type=submit], a[href], [role="button"], [data-vl-guard], ${editableSel}`;
    const pointerGuardSel = '.gb-split-handle, .gb-resize-handle, .resize-handle, .sidebar-resizer, [data-resize-handle], [data-vl-guard-pointer]';
    const toolbarSel = '#app-toolbar, .gb-toolbar, .gb-pane-toolbar, .gb-tool-header, [data-vl-toolbar]';
    const excludeSel = '.vl-lock-icon, .gb-tabs, .gb-tab, .gb-pane-header, .gb-dock-handle, .cf-modal, .modal, .gb-context-menu, .cf-confirm, .cf-prompt, ._inline-comment-input, ._note-ctx-menu, #ann-overlay, #ann-toolbar, #right-panel, .gb-right-panel';
    const isElementNode = (node) => {
      const ctor = (typeof Element !== 'undefined') ? Element : null;
      return !!node && (!ctor || node instanceof ctor) && typeof node.closest === 'function';
    };
    const isInstance = (el, name) => {
      const ctor = (typeof window !== 'undefined' && window[name]) || globalThis?.[name];
      return typeof ctor === 'function' && el instanceof ctor;
    };
    const isEditableHost = (el) => {
      if (!el) return false;
      if (el.isContentEditable) return true;
      const attr = typeof el.getAttribute === 'function' ? el.getAttribute('contenteditable') : null;
      return !!attr && String(attr).toLowerCase() !== 'false';
    };
    const readValue = (el) => {
      if (!el) return undefined;
      if (isInstance(el, 'HTMLInputElement') && (el.type === 'checkbox' || el.type === 'radio')) return !!el.checked;
      if (isInstance(el, 'HTMLInputElement') || isInstance(el, 'HTMLSelectElement') || isInstance(el, 'HTMLTextAreaElement')) return el.value;
      if (isEditableHost(el)) return typeof el.innerHTML === 'string' ? el.innerHTML : el.textContent;
      return undefined;
    };
    const writeValue = (el, value) => {
      if (value === undefined || !el) return;
      if (isInstance(el, 'HTMLInputElement') && (el.type === 'checkbox' || el.type === 'radio')) el.checked = !!value;
      else if (isInstance(el, 'HTMLInputElement') || isInstance(el, 'HTMLSelectElement') || isInstance(el, 'HTMLTextAreaElement')) el.value = value;
      else if (isEditableHost(el)) {
        if (typeof el.innerHTML === 'string') el.innerHTML = String(value);
        else el.textContent = String(value);
      }
    };
    const resolveGuardElement = (target, eventType) => {
      if (!isElementNode(target)) return null;
      if (eventType === 'pointerdown') return target.closest(`${pointerGuardSel}, ${interactiveSel}`);
      return target.closest(interactiveSel);
    };
    const isStructuralPointerGuard = (el) => !!(el && typeof el.matches === 'function' && el.matches(pointerGuardSel));
    const isInGuardArea = (target, info, el, eventType) => {
      if (!isElementNode(target) || !info?.viewKey) return false;
      if (el && typeof el.matches === 'function' && el.matches('[data-vl-guard], [data-vl-guard-pointer]')) return true;
      if (eventType === 'pointerdown' && isStructuralPointerGuard(el)) return true;
      const scEl = (typeof getScrollContainerEl === 'function') ? getScrollContainerEl() : null;
      if (scEl && typeof scEl.contains === 'function' && scEl.contains(target)) return true;
      const activePane = document.querySelector?.('.gb-pane-active, .gb-pane.is-active, .gb-pane[data-active="true"]');
      if (activePane && typeof activePane.contains === 'function' && activePane.contains(target)) return true;
      const toolbar = target.closest(toolbarSel);
      return !!toolbar;
    };
    const rememberValue = (e) => {
      const t = e.target;
      if (!isElementNode(t) || t.closest(excludeSel)) return;
      const info = (typeof getActiveInfo === 'function') ? getActiveInfo() : null;
      if (!info || !info.viewKey) return;
      const el = resolveGuardElement(t, 'remember');
      if (!el || !isInGuardArea(t, info, el, 'remember')) return;
      const cached = _cache.get(info.viewKey);
      if (cached && !cached.locked) {
        delete el._vlPrevValue;
        return;
      }
      const value = readValue(el);
      if (value !== undefined) el._vlPrevValue = value;
    };
    const handler = (e) => {
      try {
        const t = e.target;
        if (!isElementNode(t)) return;
        if (t.closest(excludeSel)) return;
        const info = (typeof getActiveInfo === 'function') ? getActiveInfo() : null;
        if (!info || !info.viewKey) return;
        const el = resolveGuardElement(t, e.type);
        if (!el) return;
        if (e.type === 'pointerdown' && !isStructuralPointerGuard(el)) return;
        if (!isInGuardArea(t, info, el, e.type)) return;
        const cached = _cache.get(info.viewKey);
        if (cached && !cached.locked) {
          delete el._vlPrevValue;
          return;
        }
        const prevValue = el._vlPrevValue !== undefined ? el._vlPrevValue : readValue(el);
        e.preventDefault(); e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        guardAction(info.viewKey, info.kind).then((ok) => {
          try {
            if (!ok) {
              writeValue(el, prevValue);
              return;
            }
            if (e.type === 'change') {
              el.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (e.type === 'click' && el.isConnected && typeof el.click === 'function') {
              el.click();
            }
          } catch (_) {}
          finally {
            delete el._vlPrevValue;
          }
        });
      } catch (_) {}
    };
    document.addEventListener('pointerdown', rememberValue, { capture: true });
    document.addEventListener('focusin', rememberValue, { capture: true });
    document.addEventListener('keydown', rememberValue, { capture: true });
    document.addEventListener('pointerdown', handler, { capture: true });
    document.addEventListener('click', handler, { capture: true });
    document.addEventListener('change', handler, { capture: true });
    document.addEventListener('beforeinput', handler, { capture: true });
    document.addEventListener('paste', handler, { capture: true });
  }

  window.ViewLock = {
    SUPPORTED_TYPES,
    isSupported,
    viewKey,
    get,
    invalidate,
    isLocked,
    engage,
    guardAction,
    toggle,
    bindHudIcon,
    guardScrollContainer,
    installInteractionInterceptor,
    subscribe,
  };
})();
