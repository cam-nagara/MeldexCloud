/**
 * gb-conflict-pending-banner.js
 *
 * ノート以外の編集面（ボード、CSV等）向けの、汎用「競合を保留中」非モーダル表示。
 * 計画書: app/docs/note-editor-regression-performance-conflict-plan-2026-08-01.md
 *   §5 工程2-C 項目4・5・9・10（「共通の状態表示用語」「対象文書のネットワーク保存だけ停止」）
 *
 * ノート本文の「競合を保留中」表示は gb-note-save-adapter.js が自前で持つ
 * （既存の note micro E2E がその実装・data-e2e-id に依存済みのため、統合はしない）。
 * このモジュールは、ノート以外の編集面が同じ文言・同じ配置規則で
 * 「保留中→確認する」導線を出すための共通実装を提供する。
 *
 * 公開API: window.MeldexConflictPendingBanner
 */
(function () {
  'use strict';
  if (window.MeldexConflictPendingBanner) return;

  function _bannerId(documentKey) {
    return 'gb-conflict-pending-banner-' + String(documentKey || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  function hide(documentKey) {
    document.getElementById(_bannerId(documentKey))?.remove();
  }

  function isShown(documentKey) {
    return !!document.getElementById(_bannerId(documentKey));
  }

  /**
   * @param {string} documentKey coordinator.documentKeyForPath() の戻り値
   * @param {{label?:string, e2eId?:string, confirmE2eId?:string, onConfirm?:Function}} [opts]
   */
  function show(documentKey, opts) {
    hide(documentKey);
    if (!document.body) return;
    const options = opts || {};
    const bar = document.createElement('div');
    bar.id = _bannerId(documentKey);
    bar.setAttribute('role', 'status');
    bar.dataset.e2eId = options.e2eId || 'conflict-pending-banner';
    bar.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9500;display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;background:var(--bg2,#222);color:var(--fg,#eee);border:1px solid var(--border,#444);box-shadow:0 2px 10px rgba(0,0,0,.25);font-size:12px;';
    const label = document.createElement('span');
    label.textContent = options.label || '競合を保留中';
    bar.appendChild(label);
    if (typeof options.onConfirm === 'function') {
      const reviewBtn = document.createElement('button');
      reviewBtn.type = 'button';
      reviewBtn.className = 'gb-btn gb-btn-xs gb-btn-primary';
      reviewBtn.dataset.e2eId = options.confirmE2eId || 'conflict-pending-review';
      reviewBtn.textContent = '確認する';
      reviewBtn.addEventListener('click', () => { options.onConfirm(); });
      bar.appendChild(reviewBtn);
    }
    document.body.appendChild(bar);
  }

  window.MeldexConflictPendingBanner = { show, hide, isShown };
})();
