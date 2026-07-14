/**
 * gb-file-lock-badge.js — ツールバータイトル直前の編集ロックバッジ
 *
 * 手動編集ロック（isItemLocked / gb-outliner.part01.part01.js）中のファイルを
 * 開いているあいだ、各ツールのタイトル欄（ノート/シート/CSV/ボード/シナリオ/
 * フォルダパネル）の直前に鍵アイコンのバッジを表示する。
 *
 * 公開API（window.MeldexFileLockBadge）:
 *   apply(titleEl, path) : titleEl の直前にバッジを挿入/更新/除去する。冪等。
 *                          path が空ならバッジと紐付けを除去する。
 *   refreshAll()         : apply 済みの全タイトルのバッジを再評価する
 *                          （編集ロックの切替・解除・ポーリング後に呼ぶ）。
 */
(function () {
  if (typeof window === 'undefined') return;

  function _normalizePath(path) {
    return String(path || '').trim();
  }

  function _lockIconMarkup() {
    if (typeof lucide === 'function') return lucide('lock', 13);
    return '<span aria-hidden="true">🔒</span>';
  }

  function _removeBadgeFor(titleEl) {
    const badge = titleEl._fileLockBadgeEl;
    if (badge && badge.parentNode) badge.remove();
    titleEl._fileLockBadgeEl = null;
  }

  function _syncBadge(titleEl, path) {
    const locked = typeof isItemLocked === 'function' ? !!isItemLocked(path) : false;
    if (!locked) { _removeBadgeFor(titleEl); return; }
    let badge = titleEl._fileLockBadgeEl;
    if (badge && (badge.parentNode !== titleEl.parentNode || badge.nextElementSibling !== titleEl)) {
      badge.remove();
      badge = null;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'tb-lock-badge';
      try { titleEl.insertAdjacentElement('beforebegin', badge); }
      catch (_) { return; }
      titleEl._fileLockBadgeEl = badge;
    }
    const reason = typeof getItemLockReason === 'function' ? String(getItemLockReason(path) || '').trim() : '';
    const label = '編集ロック中' + (reason ? ': ' + reason : '');
    badge.innerHTML = _lockIconMarkup();
    badge.title = label;
    badge.setAttribute('aria-label', label);
  }

  function apply(titleEl, path) {
    if (!titleEl) return;
    const normalized = _normalizePath(path);
    if (!normalized) {
      delete titleEl.dataset.lockBadgePath;
      _removeBadgeFor(titleEl);
      return;
    }
    titleEl.dataset.lockBadgePath = normalized;
    try { _syncBadge(titleEl, normalized); } catch (_) {}
    // ロックキャッシュが未ロードの場合、ロード完了後に全バッジを再評価する。
    if (typeof _ensureLocksLoaded === 'function') {
      Promise.resolve(_ensureLocksLoaded()).then(refreshAll).catch(() => {});
    }
  }

  function refreshAll() {
    document.querySelectorAll('[data-lock-badge-path]').forEach(titleEl => {
      const path = titleEl.dataset.lockBadgePath || '';
      if (!path) return;
      try { _syncBadge(titleEl, path); } catch (_) {}
    });
  }

  window.MeldexFileLockBadge = { apply, refreshAll };
})();
