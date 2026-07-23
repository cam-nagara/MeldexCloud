/* ==============================
   gb-dnd-autoscroll.js — ドラッグ中の自動スクロール共通基盤

   目的（2026-07-19 ユーザー指示）: Meldex内のあらゆるドラッグ（並べ替え・移動）で
   - スクロール可能領域の端に近づいたら自動スクロールする
   - ポインタが端を超えても（領域の外へ出ても）スクロールを止めない
   - ドラッグ中にマウスホイールでスクロールできる

   対応範囲:
   - HTML5 DnD（draggable属性ベース）: document の dragover を監視して自動追従。
     端接近・端超え継続は全ドラッグで自動的に有効。
     ※ HTML5 DnD はドラッグ中の wheel イベントがページへ届かない仕様のため、
       ホイール対応が必要な場面は pointer events 実装へ移行して本APIを使う
   - pointer events 自前実装のドラッグ: beginPointerSession / updatePointer /
     endPointerSession を呼ぶだけで同じ挙動（+ホイール）になる

   公開API: window.MeldexDragAutoScroll
   ============================== */
(function () {
  'use strict';

  const EDGE = 32;            // 端とみなす幅(px)
  const MAX_SPEED = 24;       // 最大スクロール速度(px/frame)
  const MIN_SPEED = 2;
  const HTML5_IDLE_MS = 1500; // dragoverが途切れたらHTML5セッション終了とみなす
                              // （実ドラッグ中は~350ms間隔で発火し続ける。rAFが間引かれる
                              //   非表示ウィンドウでも1フレームは処理できる余裕を持たせる）

  let _session = null; // { kind: 'html5'|'pointer', x, y, lastEventAt, container, raf }
  // 直近セッションのスクロール対象。HTML5ドラッグはポインタがウィンドウ外へ出ると
  // dragover が途切れて一度セッションが終わることがあるため、すぐ再開した場合は
  // 前回の対象を引き継いで端超えスクロールを継続する
  let _lastContainer = null;
  let _lastContainerAt = 0;
  const RESUME_CONTAINER_MS = 2500;

  function _isScrollable(el, axis) {
    if (!(el instanceof Element)) return false;
    let cs;
    try { cs = getComputedStyle(el); } catch { return false; }
    if (axis === 'y') {
      return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1;
    }
    return (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1;
  }

  function _scrollableFrom(start) {
    let node = start instanceof Element ? start : null;
    while (node && node !== document.body && node !== document.documentElement) {
      if (_isScrollable(node, 'y') || _isScrollable(node, 'x')) return node;
      node = node.parentElement;
    }
    return null;
  }

  // 端からの距離（はみ出し分を含む）に比例した速度。端を超えるほど速くなり上限で頭打ち
  function _speedFor(dist) {
    return Math.min(MAX_SPEED, MIN_SPEED + Math.abs(dist) * 0.35);
  }

  function _axisDelta(pos, start, end) {
    if (end - start <= EDGE * 2) return 0; // 小さすぎる領域では暴れさせない
    if (pos < start + EDGE) return -_speedFor(start + EDGE - pos);
    if (pos > end - EDGE) return _speedFor(pos - (end - EDGE));
    return 0;
  }

  function _applyScroll(container, x, y) {
    if (!container?.isConnected) return false;
    const rect = container.getBoundingClientRect();
    let moved = false;
    if (_isScrollable(container, 'y')) {
      const dy = _axisDelta(y, rect.top, rect.bottom);
      if (dy) {
        const before = container.scrollTop;
        container.scrollTop = before + dy;
        moved = moved || container.scrollTop !== before;
      }
    }
    if (_isScrollable(container, 'x')) {
      const dx = _axisDelta(x, rect.left, rect.right);
      if (dx) {
        const before = container.scrollLeft;
        container.scrollLeft = before + dx;
        moved = moved || container.scrollLeft !== before;
      }
    }
    return moved;
  }

  function _pointInside(rect, x, y, margin = 0) {
    return x >= rect.left - margin && x <= rect.right + margin
      && y >= rect.top - margin && y <= rect.bottom + margin;
  }

  // ロック維持の余白: 端を超えて少し外へ出た程度ではスクロール対象を切り替えない
  const KEEP_LOCK_HALO = 140;

  // ポインタ直下のスクロール対象を基本としつつ、端を超えて領域の少し外へ出ている間は
  // 直近の対象（ロック）を保持してスクロールを継続する。ロックから大きく離れたら
  // 直下の対象へ切り替える（別のスクロール領域をまたぐドラッグ）
  function _evaluate(s) {
    const clampedX = Math.max(0, Math.min(window.innerWidth - 1, s.x));
    const clampedY = Math.max(0, Math.min(window.innerHeight - 1, s.y));
    let under = null;
    try { under = document.elementFromPoint(clampedX, clampedY); } catch {}
    const hovered = _scrollableFrom(under);
    let lock = s.container?.isConnected ? s.container : null;
    if (lock && !_pointInside(lock.getBoundingClientRect(), s.x, s.y, KEEP_LOCK_HALO)) lock = null;
    if (!lock) lock = hovered;
    else if (hovered && _pointInside(lock.getBoundingClientRect(), s.x, s.y)) lock = hovered; // ロック内では直下優先（入れ子スクロール対応）
    s.container = lock || null;
    if (s.container) {
      _lastContainer = s.container;
      _lastContainerAt = Date.now();
      _applyScroll(s.container, s.x, s.y);
    }
  }

  function _step() {
    const s = _session;
    if (!s) return;
    _evaluate(s);
    // アイドル判定は「適用の後」に行う。rAFが間引かれる環境（非表示ウィンドウ等）でも
    // イベント到着分のスクロールを最低1回は反映してから終了する
    if (s.kind === 'html5' && Date.now() - s.lastEventAt > HTML5_IDLE_MS) {
      _endSession('idle');
      return;
    }
    s.raf = requestAnimationFrame(_step);
  }

  function _ensureSession(kind, x, y) {
    if (_session && _session.kind !== kind) _endSession();
    if (_session) {
      _session.x = x;
      _session.y = y;
      _session.lastEventAt = Date.now();
      // イベント到着時にも1ステップ適用する（rAFが間引かれる非表示ウィンドウ等でも
      // 追従を保証し、通常時も応答を良くする）。連続スクロール自体は rAF ループが担う
      _evaluate(_session);
      return;
    }
    const resumed = (_lastContainer?.isConnected && Date.now() - _lastContainerAt <= RESUME_CONTAINER_MS)
      ? _lastContainer
      : null;
    _session = { kind, x, y, lastEventAt: Date.now(), container: resumed, raf: 0 };
    _evaluate(_session);
    _session.raf = requestAnimationFrame(_step);
  }

  function _endSession(reason) {
    if (!_session) return;
    if (_session.raf) cancelAnimationFrame(_session.raf);
    _session = null;
    // 明示的な終了（drop / dragend / pointer終了）では対象を引き継がない。
    // アイドル失効（イベント途切れ）だけを「継続中の中断」とみなして引き継ぐ
    if (reason !== 'idle') {
      _lastContainer = null;
      _lastContainerAt = 0;
    }
  }

  // ドラッグ中のホイール: ポインタ位置のスクロール対象（無ければ直近の対象）を送る。
  // HTML5 DnD 中は仕様上 wheel が届かないため、実質 pointer セッション用
  function _onWheel(e) {
    const s = _session;
    if (!s) return;
    const target = _scrollableFrom(e.target instanceof Element ? e.target : null)
      || (s.container?.isConnected ? s.container : null);
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    target.scrollTop += e.deltaY;
    target.scrollLeft += e.deltaX;
    s.lastEventAt = Date.now();
  }
  document.addEventListener('wheel', _onWheel, { capture: true, passive: false });

  // HTML5 DnD の自動追従
  document.addEventListener('dragover', (e) => {
    if (typeof e.clientX !== 'number' || typeof e.clientY !== 'number') return;
    _ensureSession('html5', e.clientX, e.clientY);
  }, true);
  const _endHtml5 = () => { if (_session?.kind === 'html5') _endSession(); };
  document.addEventListener('drop', _endHtml5, true);
  document.addEventListener('dragend', _endHtml5, true);

  window.MeldexDragAutoScroll = {
    // pointer events 自前実装のドラッグから呼ぶ
    beginPointerSession(x, y) { _ensureSession('pointer', x, y); },
    updatePointer(x, y) { _ensureSession('pointer', x, y); },
    endPointerSession() { if (_session?.kind === 'pointer') _endSession(); },
    // 検証用（E2E/デバッグ）: 現在のセッション情報
    _debugSession() {
      return _session ? { kind: _session.kind, x: _session.x, y: _session.y, container: _session.container } : null;
    },
  };
})();
