/* ==============================
   gb-cal-ics-subscribe.js: iPhone向けICS購読（読み取り専用）

   Cloud外部カレンダー連携 Phase 5・案A（app/docs/production-management-ux-improvement-plan-2026-08-04.md §6.5）。
   Meldexのカレンダー（表示対象イベント）を .ics としてDropboxの管理領域へ
   書き出し、Dropboxの共有リンクを「照会（購読）カレンダー」としてiPhone等へ
   登録してもらう。書き出しは既存の /cal/sync/ical/export（gb-data-access-dropbox
   -expanded.part02.js の _handleCalendar）が返すiCal本文を再利用し、iCal生成
   ロジックを重複させない。

   共有リンク自動作成は Dropbox API sharing.write スコープに依存する（gb-config.js
   参照）。このスコープは2026-08-04に新規追加したため、既存の接続セッションは
   再接続するまで持たない。作成に失敗した場合は例外を投げるので、呼び出し側
   （gb-tool-calendar-sync.js）はファイルパスを示す手動作成の案内へフォールバックする。
   ============================== */
(function () {
  'use strict';

  const ICS_RELATIVE_PATH = '_calendar/meldex-subscribe.ics';
  const AUTO_REFRESH_FLAG_KEY = 'meldex-cal-ics-subscription-enabled';

  function _dropboxAuth() {
    const auth = window.MeldexDropboxAuth;
    if (!auth) throw new Error('gb-dropbox-auth.js が読み込まれていません');
    return auth;
  }

  function _rootResolver() {
    const resolver = window.MeldexDropboxManagementRootResolver;
    if (!resolver) throw new Error('gb-dropbox-management-root-resolver.js が読み込まれていません');
    return resolver;
  }

  function _joinDropboxPath(root, relative) {
    const base = String(root || '').replace(/\/+$/, '');
    const rel = String(relative || '').replace(/^\/+/, '');
    return `${base}/${rel}`;
  }

  // ============================================================
  // .ics 書き出し（既存の /cal/sync/ical/export を再利用する）
  // ============================================================

  async function refreshIcsFile() {
    if (!window.MeldexDataAccess?.requestJson) throw new Error('Cloud保存APIが初期化されていません');
    const exported = await window.MeldexDataAccess.requestJson('/cal/sync/ical/export');
    if (!exported?.content) throw new Error('カレンダーの書き出しに失敗しました');
    const provider = window.MeldexStorageAdapter?.getProvider?.();
    if (!provider) throw new Error('Dropbox provider が未初期化です');
    const internals = window.__MeldexPwaDataAccessInternals;
    if (internals?._directoryHandle) await internals._directoryHandle(provider, '_calendar', true);
    await provider.writeText(ICS_RELATIVE_PATH, String(exported.content || ''));
    return { ok: true, path: ICS_RELATIVE_PATH, bytes: exported.content.length };
  }

  // ============================================================
  // Dropbox 共有リンク（sharing.write スコープが必要。無ければ例外を投げる）
  // ============================================================

  function _toDirectDownloadUrl(shareUrl) {
    try {
      const url = new URL(shareUrl);
      url.searchParams.set('dl', '1');
      return url.toString();
    } catch {
      return shareUrl;
    }
  }

  function _toWebcalUrl(directUrl) {
    return directUrl.replace(/^https?:\/\//i, 'webcal://');
  }

  async function _absoluteIcsPath(provider) {
    const { rootPath, namespaceKind } = await _rootResolver().resolveConnectionInfo(provider);
    return { path: _joinDropboxPath(rootPath, ICS_RELATIVE_PATH), namespaceKind };
  }

  async function _existingSharedLink(path, namespaceKind) {
    const result = await _dropboxAuth().apiRpc(
      'sharing/list_shared_links',
      { path, direct_only: true },
      { namespaceKind },
    );
    const link = (result?.links || [])[0];
    return link?.url || '';
  }

  async function _createSharedLink(path, namespaceKind) {
    const result = await _dropboxAuth().apiRpc(
      'sharing/create_shared_link_with_settings',
      { path, settings: { requested_visibility: 'public' } },
      { namespaceKind },
    );
    return result?.url || '';
  }

  async function createSubscriptionLink() {
    await refreshIcsFile();
    const provider = window.MeldexStorageAdapter?.getProvider?.();
    if (!provider) throw new Error('Dropbox provider が未初期化です');
    const { path, namespaceKind } = await _absoluteIcsPath(provider);
    let shareUrl = '';
    try {
      shareUrl = await _existingSharedLink(path, namespaceKind);
      if (!shareUrl) shareUrl = await _createSharedLink(path, namespaceKind);
    } catch (err) {
      const message = String(err?.message || err || '');
      const scopeIssue = /scope|permission|not_authorized/i.test(message);
      const wrapped = new Error(
        scopeIssue
          ? 'Dropboxの共有権限が不足しています。設定でDropbox接続を一度解除し、再接続してください（購読リンクの自動作成には追加の権限が必要です）'
          : `Dropbox共有リンクの作成に失敗しました: ${message}`,
      );
      wrapped.cause = err;
      wrapped.code = scopeIssue ? 'missing_scope' : 'link_create_failed';
      wrapped.manualPath = path;
      throw wrapped;
    }
    try { localStorage.setItem(AUTO_REFRESH_FLAG_KEY, '1'); } catch {}
    const direct = _toDirectDownloadUrl(shareUrl);
    return {
      ok: true,
      relativePath: ICS_RELATIVE_PATH,
      absolutePath: path,
      shareUrl,
      directUrl: direct,
      webcalUrl: _toWebcalUrl(direct),
    };
  }

  function isAutoRefreshEnabled() {
    try { return localStorage.getItem(AUTO_REFRESH_FLAG_KEY) === '1'; } catch { return false; }
  }

  // コミット前レビュー指摘 #4: この関数自体は「購読用ファイルの自動更新が有効なら
  // 書き出し直す」だけの単発処理。呼び出し元（gb-tool-calendar-sync.js の
  // _googleCalAutoSync / _microsoftCalAutoSync 成功後フック）が5分間隔で叩くため、
  // 同一実行が重ならないよう多重実行ガードを持つ。
  let _icsAutoRefreshInFlight = false;

  async function autoRefreshIfEnabled() {
    if (!isAutoRefreshEnabled()) return { ok: true, skipped: true };
    if (_icsAutoRefreshInFlight) return { ok: true, skipped: true, inFlight: true };
    _icsAutoRefreshInFlight = true;
    try {
      return await refreshIcsFile();
    } catch (err) {
      console.warn('[MeldexCalIcsSubscribe] 購読用.icsファイルの自動更新に失敗しました:', err);
      return { ok: false, error: err?.message || String(err) };
    } finally {
      _icsAutoRefreshInFlight = false;
    }
  }

  window.MeldexCalIcsSubscribe = {
    ICS_RELATIVE_PATH,
    refreshIcsFile,
    createSubscriptionLink,
    isAutoRefreshEnabled,
    autoRefreshIfEnabled,
  };
})();
