/**
 * gb-view-lock.js — 表示ロック（view lock）
 *
 * 計画書 `docs/annotation_unification_plan.md` §4.4 / §8 を実装する。
 *
 * 要点:
 * - 各ビュー（ノート / シナリオ / シート全サブビュー / カレンダー / ビューワー等）で、
 *   アノテートレイヤの座標系が崩れる操作（フィルタ・折り畳み・viewMode 切替等）を
 *   「ロック」状態のあいだブロックする。スクロールはアノテートレイヤ側で追従するため許可する。
 * - ブロック時はユーザー指示 §8.4 の確認ダイアログを出し、「はい」で解除 + 操作を通す。
 * - 表示ロックは既定OFF。ユーザーがロックアイコンを押した時点の表示状態を
 *   view_lock.state に保存する。アノテートストロークの一筆目では自動ロックしない。
 * - ロック状態はサーバ (view_lock テーブル) にペイン単位 (view_key = target_path#pane_id) で永続化。
 * - ボード (Canvas) は座標系が内部に閉じているため requiresViewLock=false。
 *
 * 公開 API（window.ViewLock）:
 *   isSupported(type)          : ツールタイプが view_lock 対象か
 *   viewKey(target, paneId)    : "target#paneId" の view_key
 *   get(viewKey)               : サーバから view_lock を取得（キャッシュ込み）
 *   invalidate(viewKey?)       : キャッシュ無効化
 *   isLocked(viewKey)          : 同期判定（キャッシュ経由）。未取得・取得失敗は true
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
  const _cache = new Map(); // viewKey → { status, locked, state, target_kind, ts }
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

  async function get(vk, { retry = false } = {}) {
    if (!vk) return null;
    const cached = _cache.get(vk);
    if (cached && (cached.status !== 'error' || !retry)) return cached;
    if (_inflight.has(vk)) return _inflight.get(vk);
    const p = (async () => {
      try {
        const raw = await apiFetch('/view-lock?view_key=' + encodeURIComponent(vk));
        const entry = {
          view_key: vk,
          status: raw?.locked ? 'locked' : 'unlocked',
          locked: !!raw?.locked,
          state: raw?.state || {},
          target_kind: raw?.target_kind || '',
          target_path: raw?.target_path || '',
          pane_id: raw?.pane_id || '',
          locked_at: raw?.locked_at || '',
          locked_by: raw?.locked_by || '',
        };
        _cache.set(vk, entry);
        _notifyChange(vk);
        return entry;
      } catch (error) {
        const entry = {
          view_key: vk,
          status: 'error',
          locked: true,
          state: {},
          target_kind: '',
          error: String(error?.message || error || 'view lock fetch failed'),
        };
        _cache.set(vk, entry);
        _notifyChange(vk);
        return entry;
      } finally {
        _inflight.delete(vk);
      }
    })();
    _inflight.set(vk, p);
    return p;
  }

  // 同期判定。状態を確認できない間は fail-closed として編集を止める。
  function isLocked(vk) {
    if (!vk) return false;
    const e = _cache.get(vk);
    return !e || e.status === 'error' || !!e.locked;
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
        status: locked ? 'locked' : 'unlocked',
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
  // アノテートストロークの一筆目では自動ロックも確認ダイアログも出さない。
  async function engage(vk, kind, getState) {
    if (!vk) return true; // view_key が取れないビューはガード対象外
    await get(vk);
    return true;
  }

  // §8.4 ロック中の操作ブロック。解除を促し、解除したら true。キャンセルなら false。
  async function guardAction(vk, kind) {
    if (!vk) return true;
    // A failed startup/auth/network request must not block this view forever.
    // Retry on the next explicit action, remaining fail-closed until it succeeds.
    const entry = await get(vk, { retry: true });
    if (entry?.status === 'error') {
      if (typeof showStatus === 'function') showStatus('表示ロックを確認できません。通信状態を確認して再試行してください', true);
      return false;
    }
    if (!entry?.locked) return true;
    const ok = await cfConfirm(
      'このビューはアノテートのため表示ロックされています。表示ロックを解除すると既存のアノテート位置がズレる可能性があります（アノテート自体は削除されません）。表示ロックを解除しますか？'
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
    const loaded = await get(vk, { retry: true });
    if (loaded?.status === 'error') {
      if (typeof showStatus === 'function') showStatus('表示ロックを確認できません。再試行してください', true);
      return;
    }
    const cur = _cache.get(vk) || {};
    if (cur.locked) {
      const ok = await cfConfirm(
        'このビューの表示ロックを解除します。解除後はフィルタ・折り畳み・表示モード等の変更が自由に行えますが、既存のアノテート位置がズレる可能性があります。解除しますか？'
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

  function _viewLockIconMarkup(locked) {
    if (typeof lucide === 'function') return lucide(locked ? 'lock' : 'unlock', 14);
    return `<span class="ico ico-${locked ? 'lock' : 'unlock'}" aria-hidden="true"></span>`;
  }

  function _resolveHudContainer(hostEl) {
    if (!hostEl) return null;
    const directToolbar = hostEl.querySelector(':scope > .gb-toolbar, :scope > [id$="-toolbar"]');
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
      btn.title = '表示ロック';
    }
    if (!hostIsButton && btn.parentElement !== containerEl) containerEl.appendChild(btn);
    btn.type = 'button';
    btn.disabled = false;
    btn.setAttribute('aria-disabled', 'false');
    btn.classList.remove('vl-lock-icon-disabled');
    btn.style.color = '';
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
    btn._viewLockClickHandler = async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (_cache.get(vk)?.status === 'error') {
        // The error icon promises a retry, not a change to the lock state.
        await get(vk, { retry: true });
        render();
        return;
      }
      await toggle(vk, kind, getState);
      render();
    };
    btn.addEventListener('click', btn._viewLockClickHandler);
    const render = () => {
      const entry = _cache.get(vk);
      const status = entry?.status || 'unknown';
      const locked = !!(entry && entry.locked);
      btn.innerHTML = _viewLockIconMarkup(locked);
      btn.title = status === 'error'
        ? '表示ロック状態を取得できません（クリックで再試行）'
        : status === 'unknown'
          ? '表示ロック状態を確認中です'
          : locked
        ? '表示ロック中です（クリックで解除）'
        : '表示ロックを有効にする';
      btn.setAttribute('aria-label', locked ? '表示ロックを解除' : '表示ロックを有効にする');
      if (status === 'error') btn.setAttribute('aria-label', '表示ロック状態を再取得');
      btn.setAttribute('aria-pressed', locked ? 'true' : 'false');
      btn.setAttribute('aria-busy', status === 'unknown' ? 'true' : 'false');
      btn.dataset.viewLockState = locked ? 'locked' : 'unlocked';
      if (status === 'error' || status === 'unknown') btn.dataset.viewLockState = status;
      btn.classList.toggle('vl-lock-icon-locked', locked);
      btn.classList.toggle('vl-lock-icon-error', status === 'error');
      btn.style.color = '';
    };
    render();
    // 初期取得後に再描画
    get(vk).then(render).catch(() => {});
    btn._viewLockUnsubscribe = subscribe(vk, render);
    return { el: btn, viewKey: vk, refresh: render };
  }

  // 旧API名との互換用。スクロールはアノテートレイヤ側で追従できるため、ロック中も止めない。
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
    const pendingInputs = new WeakMap();
    const replayedFormInputs = new WeakSet();
    let replayingInput = false;
    const toolbarSel = '#app-toolbar, .gb-toolbar, .gb-pane-toolbar, .gb-tool-header, [data-vl-toolbar]';
    const excludeSel = '.vl-lock-icon, .gb-tabs, .gb-tab, .gb-pane-header, .gb-dock-handle, .cf-modal, .modal, .gb-context-menu, .cf-confirm, .cf-prompt, ._inline-comment-input, ._note-ctx-menu, #ann-overlay, #ann-toolbar, #right-panel, .gb-right-panel, #rp-chat, .gb-tool-chat';
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
    const captureInputReplay = (e, el) => {
      if (e.type !== 'beforeinput' && e.type !== 'paste') return null;
      const data = e.type === 'paste'
        ? String(e.clipboardData?.getData?.('text/plain') || '')
        : String(e.data ?? '');
      const hasTextValue = typeof el?.value === 'string';
      if (hasTextValue) {
        const start = Number.isInteger(el.selectionStart) ? el.selectionStart : el.value.length;
        const end = Number.isInteger(el.selectionEnd) ? el.selectionEnd : start;
        return { kind: 'value', data, start, end, inputType: e.inputType || (e.type === 'paste' ? 'insertFromPaste' : 'insertText') };
      }
      if (isEditableHost(el) && typeof window.getSelection === 'function') {
        const selection = window.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
        return { kind: 'contenteditable', data, range, inputType: e.inputType || (e.type === 'paste' ? 'insertFromPaste' : 'insertText') };
      }
      return null;
    };
    const dispatchInput = (el, replay) => {
      const init = { bubbles: true, inputType: replay.inputType, data: replay.data };
      const InputCtor = (typeof window.InputEvent === 'function') ? window.InputEvent : (typeof InputEvent === 'function' ? InputEvent : Event);
      el.dispatchEvent(new InputCtor('input', init));
    };
    const valueSegmenter = typeof Intl?.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
    const valueDeleteBoundary = (value, index, direction) => {
      if (valueSegmenter) {
        const part = valueSegmenter.segment(value).containing(direction < 0 ? index - 1 : index);
        return part ? (direction < 0 ? part.index : part.index + part.segment.length) : index;
      }
      const character = direction < 0 ? Array.from(value.slice(0, index)).at(-1) || '' : Array.from(value.slice(index))[0] || '';
      return index + direction * character.length;
    };
    const replayInput = (el, replay) => {
      if (!el?.isConnected || !replay) return;
      if (replay.kind === 'value') {
        if (isInstance(el, 'HTMLInputElement') && el.type === 'number' && isNativeFormInput(el)) {
          // Number inputs hide their caret from selectionStart/selectionEnd.
          // Let the browser retain its selection, including select-all and a middle caret.
          const previousFocus = document.activeElement;
          // Coalesce the browser's blur changes until all approved keystrokes are restored.
          const holdChange = event => event.stopImmediatePropagation();
          el.addEventListener('change', holdChange, true);
          replayingInput = true;
          try {
            el.focus({ preventScroll: true });
            const command = replay.inputType === 'deleteContentBackward' ? 'delete'
              : replay.inputType === 'deleteContentForward' ? 'forwardDelete' : 'insertText';
            if (!document.execCommand(command, false, command === 'insertText' ? replay.data : null)) {
              throw new Error('Native number input could not be replayed');
            }
          } finally {
            if (previousFocus !== el) {
              if (previousFocus?.isConnected) previousFocus.focus?.({ preventScroll: true });
              if (document.activeElement === el) el.blur();
            }
            replayingInput = false;
            el.removeEventListener('change', holdChange, true);
          }
          return { end: el.value.length };
        }
        const value = String(el.value || '');
        if (replay.start === replay.end && replay.inputType === 'deleteContentBackward') {
          replay.start = valueDeleteBoundary(value, replay.start, -1);
        } else if (replay.start === replay.end && replay.inputType === 'deleteContentForward') {
          replay.end = valueDeleteBoundary(value, replay.end, 1);
        }
        if (typeof el.setRangeText === 'function') el.setRangeText(replay.data, replay.start, replay.end, 'end');
        else el.value = value.slice(0, replay.start) + replay.data + value.slice(replay.end);
        dispatchInput(el, replay);
        return { end: Number.isInteger(el.selectionStart) ? el.selectionStart : replay.start + replay.data.length };
      }
      const range = replay.range;
      if (!range || !range.commonAncestorContainer?.isConnected) return;
      const command = ({ insertText: 'insertText', insertFromPaste: 'insertText',
        insertParagraph: 'insertParagraph', insertLineBreak: 'insertLineBreak',
        deleteContentBackward: 'delete', deleteContentForward: 'forwardDelete' })[replay.inputType];
      if (command && typeof document.execCommand === 'function') {
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        // Let the browser perform structural edits and emit their real input event.
        // A replay must not start another asynchronous lock check.
        replayingInput = true;
        try { document.execCommand(command, false, command === 'insertText' ? replay.data : null); }
        finally { replayingInput = false; }
        return;
      }
      range.deleteContents();
      const textNode = document.createTextNode(replay.data);
      range.insertNode(textNode);
      // 通常の文字入力と同じくテキスト内へ置く。親要素の位置だと、
      // inputを読む行頭の「/」などが入力済みの文字を検出できない。
      range.setStart(textNode, textNode.length);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      dispatchInput(el, replay);
    };
    const resolveGuardElement = (target, eventType) => {
      if (!isElementNode(target)) return null;
      if (eventType === 'pointerdown') return target.closest(`${pointerGuardSel}, ${interactiveSel}`);
      return target.closest(interactiveSel);
    };
    // Form controls use the browser's native Tab order. Replaying a synthetic
    // key cannot move focus or emit the change event for a restored value.
    const isNativeFormInput = el => !!el?.closest?.('.gb-form-input-row')
      && (isInstance(el, 'HTMLInputElement') || isInstance(el, 'HTMLTextAreaElement') || isInstance(el, 'HTMLSelectElement'));
    const commitReplayedFormInput = el => {
      if (!el?.isConnected || !replayedFormInputs.has(el)) return;
      replayedFormInputs.delete(el);
      // Keep this event inside the normal lock/write checks; permission may
      // have changed again since the text was restored.
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const blurReplayedFormInput = event => {
      const el = resolveGuardElement(event.target, 'focusout');
      if (isNativeFormInput(el) && !pendingInputs.has(el)) commitReplayedFormInput(el);
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
      // 押した・選んだ時点で、編集可否を先に読んでおく（打ち始めた時に確認を待たせない。待つ間の打鍵は後から戻すが、
      // その間のクリックなどとの順番が崩れることがあった。2026-11-25）。
      if (!_cache.has(info.viewKey)) get(info.viewKey).catch(() => {});
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
    // 確認の間に押した確定のキー（Enter・Tab・Escape）を、打った文字の順番どおりに届ける。
    const releaseHeldKeys = (pendingInput, el, upTo, ok) => {
      const held = pendingInput.heldKeys || [];
      while (held.length && held[0].after <= upTo) {
        const key = held.shift();
        if (!ok) continue;
        const target = key.target?.isConnected ? key.target : el;
        if (!target?.isConnected) continue;
        const event = new KeyboardEvent('keydown', key.init);
        // keyCode/which は作成時の指定が無視されるので、古い判定（keyCode === 13 など）のために付け直す。
        try { Object.defineProperty(event, 'keyCode', { get: () => key.init.keyCode }); Object.defineProperty(event, 'which', { get: () => key.init.keyCode }); } catch (_) {}
        target.dispatchEvent(event);
        // 画面の処理が受け取らなかった Enter は、ブラウザーの通常の動き（改行・段落）を代わりに行う
        // （作り直したキーの出来事では、ブラウザーは改行を入れない）。
        if (event.defaultPrevented || key.init.key !== 'Enter') continue;
        if (isInstance(el, 'HTMLTextAreaElement') && typeof el.setRangeText === 'function') {
          el.setRangeText('\n', el.selectionStart, el.selectionEnd, 'end');
          dispatchInput(el, { inputType: 'insertLineBreak', data: null });
        } else if (isEditableHost(el) && typeof document.execCommand === 'function') {
          replayingInput = true;
          try { document.execCommand(key.init.shiftKey ? 'insertLineBreak' : 'insertParagraph', false, null); }
          finally { replayingInput = false; }
        }
      }
    };
    const handler = (e) => {
      if (replayingInput) return;
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
        if (cached && !cached.locked && !pendingInputs.has(el)) {
          delete el._vlPrevValue;
          return;
        }
        const prevValue = el._vlPrevValue !== undefined ? el._vlPrevValue : readValue(el);
        const inputReplay = captureInputReplay(e, el);
        let pendingInput = null;
        if (inputReplay) {
          pendingInput = pendingInputs.get(el);
          if (!pendingInput || pendingInput.viewKey !== info.viewKey) {
            pendingInput = { viewKey: info.viewKey, count: 0, origin: null, end: null };
            pendingInputs.set(el, pendingInput);
          }
          pendingInput.count++;
          var inputOrder = (pendingInput.queued = (pendingInput.queued || 0) + 1);
        }
        // ロック状態の初回取得中にドラッグ開始を失わない。解除・確認が
        // 成功し、同じポインターを押し続けている場合だけ開始を再配信する。
        let pointerEnded = false;
        let latestPointer = e;
        const pointerEnd = event => { if (event.pointerId === e.pointerId) pointerEnded = true; };
        const pointerMove = event => { if (event.pointerId === e.pointerId) latestPointer = event; };
        const replayPointer = e.type === 'pointerdown' && typeof PointerEvent === 'function';
        if (replayPointer) {
          document.addEventListener('pointerup', pointerEnd, true);
          document.addEventListener('pointercancel', pointerEnd, true);
          document.addEventListener('pointermove', pointerMove, true);
        }
        const cleanupPointer = () => {
          if (!replayPointer) return;
          document.removeEventListener('pointerup', pointerEnd, true);
          document.removeEventListener('pointercancel', pointerEnd, true);
          document.removeEventListener('pointermove', pointerMove, true);
        };
        e.preventDefault(); e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        const allowed = pendingInput
          ? (pendingInput.allowed || (pendingInput.allowed = guardAction(info.viewKey, info.kind)))
          : guardAction(info.viewKey, info.kind);
        allowed.then((ok) => {
          try {
            if (!ok) {
              writeValue(el, prevValue);
              return;
            }
            if (e.type === 'change') {
              el.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (e.type === 'click' && el.isConnected && getActiveInfo()?.viewKey === info.viewKey) {
              // セルなど編集ホスト内の場所を押した場合、ホスト全体へのclickに
              // 置き換えると最初のセル選択が失われる。接続中の元の対象へ戻す。
              const target = t.isConnected && el.contains?.(t) && typeof t.click === 'function' ? t : el;
              if (typeof target.click === 'function') target.click();
            } else if (inputReplay) {
              if (getActiveInfo()?.viewKey !== info.viewKey) return;
              // Several keystrokes can arrive while the same lock request is pending.
              // Their live ranges all point before the first replayed character.
              // Continue at the previous replay's end only for that same selection;
              // a selection deliberately moved elsewhere keeps its own position.
              const origin = pendingInput.origin;
              if (inputReplay.kind === 'contenteditable') {
                const same = origin?.kind === 'contenteditable'
                  && inputReplay.range?.compareBoundaryPoints(0, origin.range) === 0
                  && inputReplay.range?.compareBoundaryPoints(2, origin.range) === 0;
                if (same && pendingInput.end) inputReplay.range = pendingInput.end.cloneRange();
                else pendingInput.origin = { kind: inputReplay.kind, range: inputReplay.range?.cloneRange() };
              } else {
                const same = origin?.kind === 'value' && origin.start === inputReplay.start && origin.end === inputReplay.end;
                if (same && pendingInput.end !== null) inputReplay.start = inputReplay.end = pendingInput.end;
                else pendingInput.origin = { kind: inputReplay.kind, start: inputReplay.start, end: inputReplay.end };
              }
              const replayed = replayInput(el, inputReplay);
              if (inputReplay.kind === 'value' && isNativeFormInput(el)) replayedFormInputs.add(el);
              // 打った順を保つ: この文字までに押された確定のキーを、ここで届ける。
              releaseHeldKeys(pendingInput, el, inputOrder, true);
              const selection = window.getSelection?.();
              pendingInput.end = inputReplay.kind === 'contenteditable'
                ? (selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : inputReplay.range?.cloneRange())
                : (Number.isInteger(el.selectionStart) ? el.selectionStart : (replayed?.end ?? inputReplay.start + inputReplay.data.length));
            } else if (replayPointer && !pointerEnded && el.isConnected && getActiveInfo()?.viewKey === info.viewKey) {
              const init = event => ({ bubbles: true, cancelable: true, pointerId: e.pointerId,
                pointerType: e.pointerType, isPrimary: e.isPrimary, button: 0, buttons: 1,
                clientX: event.clientX, clientY: event.clientY });
              el.dispatchEvent(new PointerEvent('pointerdown', init(e)));
              if (latestPointer !== e) document.dispatchEvent(new PointerEvent('pointermove', init(latestPointer)));
            }
          } catch (_) {}
        }).catch(() => {}).finally(() => {
          if (pendingInput && --pendingInput.count === 0 && pendingInputs.get(el) === pendingInput) {
            pendingInputs.delete(el);
            // 残りの確定のキーを届ける（拒否された時は捨てる）。
            Promise.resolve(pendingInput.allowed).then(ok => {
              releaseHeldKeys(pendingInput, el, Infinity, ok);
              if (ok && getActiveInfo()?.viewKey === pendingInput.viewKey && document.activeElement !== el) commitReplayedFormInput(el);
            }).catch(() => {});
          }
          cleanupPointer();
          delete el._vlPrevValue;
        });
      } catch (_) {}
    };
    // 打った文字が編集可否の確認を待っている間の確定のキー（Enter・Tab・Escape）も待たせる。先に届くと、
    // 画面の処理が文字の無いまま確定し、後から戻った文字が行き場を失っていた（シートのセル。2026-11-25）。
    const COMMIT_KEYS = new Set(['Enter', 'Tab', 'Escape']);
    const holdCommitKey = (e) => {
      if (replayingInput || !e.isTrusted || !COMMIT_KEYS.has(e.key) || e.isComposing) return;
      const t = e.target;
      if (!isElementNode(t)) return;
      const el = resolveGuardElement(t, 'keydown');
      const pendingInput = el ? pendingInputs.get(el) : null;
      if (!pendingInput) return;
      if (e.key === 'Tab' && isNativeFormInput(el)) return;
      e.preventDefault(); e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      (pendingInput.heldKeys ||= []).push({ after: pendingInput.queued || 0, target: t, init: { key: e.key, code: e.code, keyCode: e.keyCode,
        shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, bubbles: true, cancelable: true } });
    };
    document.addEventListener('keydown', holdCommitKey, { capture: true });
    document.addEventListener('pointerdown', rememberValue, { capture: true });
    document.addEventListener('focusin', rememberValue, { capture: true });
    document.addEventListener('keydown', rememberValue, { capture: true });
    document.addEventListener('pointerdown', handler, { capture: true });
    document.addEventListener('click', handler, { capture: true });
    document.addEventListener('focusout', blurReplayedFormInput, { capture: true });
    document.addEventListener('change', event => replayedFormInputs.delete(event.target), { capture: true });
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
