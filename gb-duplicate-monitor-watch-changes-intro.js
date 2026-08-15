/* インポート・機能生成ファイル保護計画 Phase 6-2
   (app/docs/import-and-feature-file-protection-plan-2026-08-12.md §7 6-1):
   重複検出設定「フォルダの変更をすぐ確認」(watch_changes) は、Meldex外
   (エクスプローラー等)での移動・改名にタグ・注釈・版履歴・リンクを追従
   させる監視の起動条件でもある。既定は引き続きオフのまま(黙って常時監視を
   始めない)だが、その意味を利用者が分かる形で可視提示するための一回限りの
   案内を、gb-duplicate-monitor.js から分離した小さな補助モジュールとして
   提供する(1ファイル1000行以内の方針に沿った分割)。 */
(function () {
  'use strict';

  function shouldShow(settings, watcherAvailable) {
    return !!watcherAvailable && !settings?.watch_changes && !settings?.watch_changes_intro_seen;
  }

  function html(settings, watcherAvailable) {
    if (!shouldShow(settings, watcherAvailable)) return '';
    return `
      <div class="dup-watch-changes-intro" data-dup-watch-changes-intro role="status">
        エクスプローラーなど、Meldexの外で行った移動・改名にもタグ・注釈・版履歴・リンクを追従させるには、変更監視が必要です。
        <div class="dup-watch-changes-intro-actions">
          <button type="button" class="gb-btn gb-btn-sm primary" data-dup-watch-changes-enable data-e2e-id="duplicate-setting-watch-changes-intro-enable">変更監視を有効にする</button>
          <button type="button" class="gb-btn gb-btn-sm" data-dup-watch-changes-dismiss data-e2e-id="duplicate-setting-watch-changes-intro-dismiss">今は使わない</button>
        </div>
      </div>`;
  }

  function bind(host, { apiFetch, onSaved, onError }) {
    if (!host) return;
    host.querySelector('[data-dup-watch-changes-enable]')?.addEventListener('click', async () => {
      try {
        await apiFetch('/duplicate-detection/settings', {
          method: 'PUT',
          body: JSON.stringify({ watch_changes: true, watch_changes_intro_seen: true }),
        });
        await onSaved?.();
      } catch (error) {
        onError?.('変更監視を有効にできませんでした', error);
      }
    });
    host.querySelector('[data-dup-watch-changes-dismiss]')?.addEventListener('click', async () => {
      try {
        await apiFetch('/duplicate-detection/settings', {
          method: 'PUT',
          body: JSON.stringify({ watch_changes_intro_seen: true }),
        });
        await onSaved?.();
      } catch (error) {
        onError?.('案内を閉じられませんでした', error);
      }
    });
  }

  window.MeldexDuplicateWatchChangesIntro = { shouldShow, html, bind };
})();
