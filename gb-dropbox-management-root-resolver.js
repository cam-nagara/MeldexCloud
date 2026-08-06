/* gb-dropbox-management-root-resolver.js
 *
 * 固有形式付随物廃止・管理データ一元化計画 Phase 4(Cloud/Dropbox共有の付随物廃止)。
 *
 * 計画書: app/docs/proprietary-format-sidecar-cleanup-plan-2026-07-31.md (§4.2 保存先解決)
 * 監査ノート: app/docs/proprietary-format-sidecar-cleanup-audit-2026-08-01/notes.md
 *
 * ## このモジュールの役割
 *
 * gb-system-storage.js の resolveSystemStorageAdapter() は環境種別(dropbox-personal /
 * dropbox-shared-workspace)を引数で受け取るだけで、「今このブラウザセッションが
 * 実際にどちらへ接続しているか」の判定はまだ配線されていない(Phase 1bのコメント
 * 参照)。このモジュールがその判定を1箇所に集約する。
 *
 * 判定方法: 現在接続中のDropboxルート(provider.getWorkspaceInfo().path)が、
 * 参加中の共有ワークスペース(gb-workspace-ledger-io.js の listJoinedWorkspaces())
 * のいずれかの workspaceDropboxPath と一致(またはその配下)であれば「共有
 * ワークスペース」、一致しなければ「個人領域」とみなす。
 *
 * 対象パスが指定された場合は、複数ソースの仮想パスを実Dropboxルートへ解決して
 * 文書単位で判定する。対象を持たない個人設定は常に個人管理領域へ保存する。
 *
 * ## 利用元
 *
 * - gb-data-access-dropbox-fileops-core.js(同一スコープ内から直接呼べるが、
 *   他モジュールとの利用方法を揃えるため window.MeldexDropboxManagementRootResolver
 *   経由で統一して呼ぶ)
 * - gb-file-lock-store.js / gb-active-lock-store.js(fileopsとは別IIFEスコープの
 *   ため、グローバル経由でしか共有できない)
 *
 * 依存: gb-system-storage-dropbox.js(必須)、gb-source-folder-registry.js /
 * gb-workspace-ledger-io.js(必須。未読込・例外・破損時は保存先不明として書込を拒否)。
 * Meldex.html / Meldex-dev.html では gb-system-storage-dropbox.js の直後、
 * gb-file-lock-store.js より前に読み込むこと。
 */
(function () {
  'use strict';

  if (window.MeldexDropboxManagementRootResolver) return;

  function _normalize(registry, value) {
    const text = String(value || '');
    if (registry && typeof registry.normalizeDropboxPath === 'function') {
      return String(registry.normalizeDropboxPath(text) || '').toLowerCase();
    }
    return text.toLowerCase();
  }

  function _classifyRoot(rootPath) {
    const ledgerIo = window.MeldexWorkspaceLedgerIO;
    if (!rootPath || !ledgerIo || typeof ledgerIo.listJoinedWorkspaces !== 'function') {
      return { kind: 'unknown', workspace: null };
    }
    let joined;
    try {
      joined = ledgerIo.listJoinedWorkspaces();
    } catch {
      return { kind: 'unknown', workspace: null };
    }
    if (!Array.isArray(joined)) return { kind: 'unknown', workspace: null };
    if (joined.some(ws => !ws || typeof ws !== 'object' || !String(ws.dropboxPath || '').trim())) {
      return { kind: 'unknown', workspace: null };
    }
    const registry = window.MeldexSourceFolderRegistry;
    try {
      const normalizedRoot = _normalize(registry, rootPath);
      if (!normalizedRoot) return { kind: 'unknown', workspace: null };
      const matched = joined.find((ws) => {
        const wsPath = _normalize(registry, ws.dropboxPath);
        return !!wsPath && (normalizedRoot === wsPath || normalizedRoot.startsWith(wsPath + '/'));
      }) || null;
      return matched
        ? { kind: 'shared', workspace: matched }
        : { kind: 'personal', workspace: null };
    } catch {
      return { kind: 'unknown', workspace: null };
    }
  }

  async function _connectedRootInfo(provider) {
    if (!provider || typeof provider.getWorkspaceInfo !== 'function') {
      throw new Error('Dropbox 共有フォルダが未接続です');
    }
    const info = await provider.getWorkspaceInfo();
    const rootPath = String((info && info.path) || '').trim();
    if (!rootPath) throw new Error('Dropbox 共有フォルダが未接続です');
    return { rootPath, namespaceKind: (info && info.namespaceKind) || 'home' };
  }

  async function _effectiveRootInfo(provider, targetPath) {
    const connected = await _connectedRootInfo(provider);
    const rawTarget = String(targetPath || '').trim();
    const registry = window.MeldexSourceFolderRegistry;
    if (!rawTarget || !registry || typeof registry.resolveDropboxLocation !== 'function') return connected;
    const location = registry.resolveDropboxLocation(rawTarget, connected.rootPath);
    const resolvedPath = String(location?.path || '').trim();
    if (!resolvedPath) throw new Error('対象文書のDropbox保存先を判定できません');
    return {
      rootPath: resolvedPath,
      namespaceKind: location?.namespaceKind || connected.namespaceKind,
      connectedRootPath: connected.rootPath,
    };
  }

  /**
   * 現在接続中の provider に対応する共通ストレージアダプターを返す。
   * 参加中の共有ワークスペードのルートに接続している場合は共有ワークスペース
   * アダプター、それ以外は個人領域アダプターを返す。
   */
  async function resolveAdapterForProvider(provider, options) {
    const dropboxAdapters = window.MeldexSystemStorageDropbox;
    if (!dropboxAdapters) throw new Error('gb-system-storage-dropbox.js が読み込まれていません');
    const { rootPath, namespaceKind, connectedRootPath } = await _effectiveRootInfo(provider, options?.targetPath);
    if (options?.personalOnly) {
      return dropboxAdapters.createPersonalAdapter({ accountBoundary: connectedRootPath || rootPath });
    }
    const classification = _classifyRoot(rootPath);
    if (classification.kind === 'unknown') throw _unknownRootError();
    const matched = classification.workspace;
    if (classification.kind === 'shared') {
      return dropboxAdapters.createSharedWorkspaceAdapter({
        workspaceDropboxPath: matched.dropboxPath,
        workspaceId: matched.id || matched.dropboxPath,
        namespaceKind: matched.namespaceKind || namespaceKind,
        compatibilityLockProvider: provider,
      });
    }
    return dropboxAdapters.createPersonalAdapter({ accountBoundary: connectedRootPath || rootPath });
  }

  /**
   * 現在接続中ルートが個人領域か共有ワークスペードかの判定結果だけを返す
   * (旧パス併読(interop)のために「今どのルートに接続しているか」が必要な
   * 呼び出し元向け。実際の管理データ保存先は resolveAdapterForProvider を使う)。
   */
  async function resolveConnectionInfo(provider) {
    const { rootPath, namespaceKind } = await _connectedRootInfo(provider);
    const classification = _classifyRoot(rootPath);
    const matched = classification.workspace;
    return {
      rootPath,
      namespaceKind,
      kind: classification.kind,
      isSharedWorkspace: classification.kind === 'shared',
      workspace: matched || null,
    };
  }

  function _unknownRootError() {
    const error = new Error('Dropboxの管理データ保存先を安全に判定できません');
    error.status = 503;
    error.code = 'management_root_unknown';
    error.meldexCode = 'management_root_unknown';
    return error;
  }

  // --- 管理スコープ解決(対象パス→保存先 + 正準パス変換) ------------------------
  //
  // 編集ロック・注釈のように「entryが対象文書パスを持ち、共有ワークスペードの
  // メンバー間で同じentryを見えるようにしたい」管理データは、保存先アダプター
  // だけでなく「entryへ書くパスの形」も管理ルートごとに揃える必要がある。
  // PC本体(meldex_active_locks.py の _convert_management_entry_path /
  // _encode_management_entry)が先行して固定した相互運用契約に合わせる:
  //
  // - 個人管理領域: Dropboxホーム同期ルートからの相対パス
  //   (= 絶対Dropboxパスの先頭スラッシュを除いた形)
  // - 共有ワークスペース管理領域: ワークスペードルートからの相対パス
  //
  // この契約を1箇所へ集約するため、スコープオブジェクトが保存先アダプターと
  // 正準パス変換(toCanonicalPath / toLocalPath)を併せて提供する。

  function _normalizeAbsolutePreserveCase(registry, value) {
    if (registry && typeof registry.normalizeDropboxPath === 'function') {
      return String(registry.normalizeDropboxPath(String(value || '')) || '');
    }
    const raw = String(value || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/');
    if (raw === '/') return '/';
    const normalized = raw.replace(/\/$/, '');
    if (!normalized) return '';
    return normalized.startsWith('/') ? normalized : ('/' + normalized);
  }

  function _absoluteForTarget(registry, connectedRootPath, localPath) {
    const raw = String(localPath || '').trim();
    if (registry && typeof registry.resolveDropboxLocation === 'function') {
      const location = registry.resolveDropboxLocation(raw, connectedRootPath);
      return _normalizeAbsolutePreserveCase(registry, location?.path || '');
    }
    const relative = raw.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    const base = _normalizeAbsolutePreserveCase(registry, connectedRootPath);
    if (!relative) return base;
    return base === '/' ? ('/' + relative) : (base + '/' + relative);
  }

  function _localPathForAbsolute(registry, connectedRootPath, absolutePath) {
    const absolute = _normalizeAbsolutePreserveCase(registry, absolutePath);
    const connectedRoot = _normalizeAbsolutePreserveCase(registry, connectedRootPath);
    const lower = absolute.toLowerCase();
    const rootLower = connectedRoot.toLowerCase();
    if (connectedRoot && lower === rootLower) return '';
    if (connectedRoot === '/') return absolute.replace(/^\/+/, '');
    if (connectedRoot && lower.startsWith(rootLower + '/')) return absolute.slice(connectedRoot.length + 1);
    if (registry && typeof registry.virtualPathFromDropboxPath === 'function') {
      try {
        const virtual = registry.virtualPathFromDropboxPath(absolute);
        if (virtual) return virtual;
      } catch {
        // 逆引きできない場合は下の素朴なフォールバックへ。
      }
    }
    return absolute.replace(/^\/+/, '');
  }

  function _scopeKeyForClassification(registry, classification) {
    if (classification.kind === 'shared') {
      return 'shared:' + _normalize(registry, classification.workspace?.dropboxPath);
    }
    return 'personal';
  }

  function _scopeFromClassification(provider, connected, classification) {
    const dropboxAdapters = window.MeldexSystemStorageDropbox;
    if (!dropboxAdapters) throw new Error('gb-system-storage-dropbox.js が読み込まれていません');
    const registry = window.MeldexSourceFolderRegistry;
    if (classification.kind === 'shared') {
      const workspace = classification.workspace;
      const wsRoot = _normalizeAbsolutePreserveCase(registry, workspace.dropboxPath);
      const wsRootLower = wsRoot.toLowerCase();
      return {
        scopeKey: _scopeKeyForClassification(registry, classification),
        kind: 'shared',
        workspace,
        adapter: dropboxAdapters.createSharedWorkspaceAdapter({
          workspaceDropboxPath: workspace.dropboxPath,
          workspaceId: workspace.id || workspace.dropboxPath,
          namespaceKind: workspace.namespaceKind || connected.namespaceKind,
          compatibilityLockProvider: provider,
        }),
        toCanonicalPath(localPath) {
          const absolute = _absoluteForTarget(registry, connected.rootPath, localPath);
          const lower = absolute.toLowerCase();
          if (lower === wsRootLower) return '';
          if (lower.startsWith(wsRootLower + '/')) return absolute.slice(wsRoot.length + 1);
          throw new Error('対象文書はこの共有ワークスペースの配下にありません: ' + String(localPath || ''));
        },
        toLocalPath(canonicalPath) {
          const relative = String(canonicalPath || '').replace(/^\/+/, '');
          const absolute = relative ? (wsRoot === '/' ? ('/' + relative) : (wsRoot + '/' + relative)) : wsRoot;
          return _localPathForAbsolute(registry, connected.rootPath, absolute);
        },
      };
    }
    return {
      scopeKey: 'personal',
      kind: 'personal',
      workspace: null,
      adapter: dropboxAdapters.createPersonalAdapter({ accountBoundary: connected.rootPath }),
      toCanonicalPath(localPath) {
        const absolute = _absoluteForTarget(registry, connected.rootPath, localPath);
        return absolute.replace(/^\/+/, '');
      },
      toLocalPath(canonicalPath) {
        const absolute = '/' + String(canonicalPath || '').replace(/^\/+/, '');
        return _localPathForAbsolute(registry, connected.rootPath, absolute);
      },
    };
  }

  /**
   * 対象文書パス(接続ルート相対、またはソース仮想パス)に対応する管理スコープを
   * 1件返す。スコープは保存先アダプターに加えて、entryへ書く正準パスへの変換
   * (toCanonicalPath)と表示用ローカルパスへの逆変換(toLocalPath)を提供する。
   */
  async function resolveManagementScopeForPath(provider, targetPath) {
    const connected = await _connectedRootInfo(provider);
    const registry = window.MeldexSourceFolderRegistry;
    const absolute = _absoluteForTarget(registry, connected.rootPath, targetPath);
    if (!absolute) throw new Error('対象文書のDropbox保存先を判定できません');
    const classification = _classifyRoot(absolute);
    if (classification.kind === 'unknown') throw _unknownRootError();
    const connectedClassification = _classifyRoot(connected.rootPath);
    if (connectedClassification.kind === 'unknown') throw _unknownRootError();
    const scope = _scopeFromClassification(provider, connected, classification);
    scope.isConnectedRootScope =
      scope.scopeKey === _scopeKeyForClassification(registry, connectedClassification);
    return scope;
  }

  /**
   * 現在の接続と登録済みソースフォルダから到達し得る管理スコープを、管理ルート
   * 単位で重複排除して返す(先頭は必ず接続中ルートのスコープ)。対象パスを
   * 一意に決められない操作(一覧、release-all、idだけを受け取る読取・削除)が、
   * 個人領域と共有ワークスペースの両方を漏れなく走査するために使う。
   * ソース台帳を読めない場合は、黙って個人領域だけへ縮退せずエラーにする
   * (読取専用の呼び出し元は捕捉して接続中スコープのみで継続してよい)。
   */
  async function resolveManagementScopesForProvider(provider) {
    const connected = await _connectedRootInfo(provider);
    const registry = window.MeldexSourceFolderRegistry;
    const scopes = [];
    const seen = new Set();
    const connectedClassification = _classifyRoot(connected.rootPath);
    if (connectedClassification.kind === 'unknown') throw _unknownRootError();
    const connectedKey = _scopeKeyForClassification(registry, connectedClassification);
    const push = (classification) => {
      const key = _scopeKeyForClassification(registry, classification);
      if (seen.has(key)) return;
      seen.add(key);
      const scope = _scopeFromClassification(provider, connected, classification);
      scope.isConnectedRootScope = key === connectedKey;
      scopes.push(scope);
    };
    push(connectedClassification);
    if (!registry || typeof registry.loadRegistry !== 'function') return scopes;
    let payload;
    try {
      payload = await registry.loadRegistry({ writeIfMissing: false });
    } catch (error) {
      const wrapped = new Error('ソースフォルダ台帳を読めないため、管理データの保存先一覧を確定できません');
      wrapped.code = 'management_scopes_unavailable';
      wrapped.meldexCode = 'management_scopes_unavailable';
      wrapped.cause = error;
      throw wrapped;
    }
    for (const root of Array.isArray(payload?.roots) ? payload.roots : []) {
      if (!root || root.deleted === true || !String(root.dropboxPath || '').trim()) continue;
      const classification = _classifyRoot(root.dropboxPath);
      if (classification.kind === 'unknown') throw _unknownRootError();
      push(classification);
    }
    return scopes;
  }

  /**
   * 指定した共有ワークスペースの型付き管理領域アダプターを返す（接続中ルート非依存）。
   *
   * resolveTypedAdapterForProvider の targetPath 経路は「接続中ルート相対」の
   * 意味論のため、個人vault接続中にワークスペースの絶対Dropboxパスを渡すと
   * 個人管理領域へ誤配し得る。共有ワークスペース台帳（workspace-source-folders）
   * のように「参加中だが接続中ではないワークスペース」を扱う呼び出し元は
   * こちらを使う。
   *
   * 安全境界:
   * - 参加中（joined）一覧との正規化済み完全一致でのみ解決する（prefix一致は
   *   不可。台帳はワークスペースルート直下にしか無いため、サブフォルダ指定は
   *   呼び出しバグとして弾く）
   * - 未参加のパスは options.allowUnjoined === true（「このフォルダを共有
   *   ワークスペースにする」導線で、ユーザーが明示選択・確認した直後の
   *   初回書き込み専用）のときだけ許可する
   * - どの分岐でも個人領域アダプターへはフォールバックしない（誤配の構造的排除）
   */
  async function resolveSharedWorkspaceTypedAdapter(provider, kind, options) {
    const contract = window.MeldexSystemStorage;
    if (!contract || !contract.isValidSystemStorageKind(kind)) {
      throw new Error(`未知の管理データ種別です: ${String(kind || '')}`);
    }
    const dropboxAdapters = window.MeldexSystemStorageDropbox;
    if (!dropboxAdapters) throw new Error('gb-system-storage-dropbox.js が読み込まれていません');
    const registry = window.MeldexSourceFolderRegistry;
    const requestedRaw = String(options?.workspaceDropboxPath || '').trim();
    const canonical = (registry && typeof registry.normalizeDropboxPath === 'function')
      ? String(registry.normalizeDropboxPath(requestedRaw) || '').trim()
      : requestedRaw;
    if (!canonical || canonical === '/') {
      throw new Error('共有ワークスペースのフォルダを指定してください');
    }
    const ledgerIo = window.MeldexWorkspaceLedgerIO;
    if (!ledgerIo || typeof ledgerIo.listJoinedWorkspaces !== 'function') {
      throw new Error('個人領域か共有ワークスペースか判定できないため書き込めません');
    }
    let joined;
    try {
      joined = ledgerIo.listJoinedWorkspaces();
    } catch {
      throw new Error('個人領域か共有ワークスペースか判定できないため書き込めません');
    }
    if (!Array.isArray(joined)) {
      throw new Error('個人領域か共有ワークスペースか判定できないため書き込めません');
    }
    const requestedKey = _normalize(registry, canonical);
    const matched = joined.find(
      (ws) => ws && typeof ws === 'object' && _normalize(registry, ws.dropboxPath) === requestedKey,
    ) || null;
    if (matched) {
      return dropboxAdapters.createSharedWorkspaceAdapter({
        workspaceDropboxPath: matched.dropboxPath,
        workspaceId: matched.id || matched.dropboxPath,
        namespaceKind: matched.namespaceKind || options?.namespaceKind || 'home',
        compatibilityLockProvider: provider,
      });
    }
    if (options?.allowUnjoined === true) {
      return dropboxAdapters.createSharedWorkspaceAdapter({
        workspaceDropboxPath: canonical,
        workspaceId: '',
        namespaceKind: options?.namespaceKind || 'home',
        compatibilityLockProvider: provider,
      });
    }
    throw new Error('参加していない共有ワークスペースの管理データには書き込めません');
  }

  async function resolveTypedAdapterForProvider(provider, kind, options) {
    const contract = window.MeldexSystemStorage;
    if (!contract || !contract.isValidSystemStorageKind(kind)) {
      throw new Error(`未知の管理データ種別です: ${String(kind || '')}`);
    }
    // プロフィール・ソース台帳・診断等は接続中の共有ルートとは無関係に
    // 個人管理領域へ置く。共有台帳が未読込／破損していても、この経路は
    // 共有判定へ依存させない。
    if (options?.personalOnly) {
      return resolveAdapterForProvider(provider, options);
    }
    const ledgerIo = window.MeldexWorkspaceLedgerIO;
    if (!ledgerIo || typeof ledgerIo.listJoinedWorkspaces !== 'function') {
      throw new Error('個人領域か共有ワークスペースか判定できないため書き込めません');
    }
    let joined;
    try {
      joined = ledgerIo.listJoinedWorkspaces();
    } catch {
      throw new Error('個人領域か共有ワークスペースか判定できないため書き込めません');
    }
    if (!Array.isArray(joined)) {
      throw new Error('個人領域か共有ワークスペースか判定できないため書き込めません');
    }
    return resolveAdapterForProvider(provider, options);
  }

  window.MeldexDropboxManagementRootResolver = {
    resolveAdapterForProvider,
    resolveConnectionInfo,
    resolveSharedWorkspaceTypedAdapter,
    resolveTypedAdapterForProvider,
    resolveManagementScopeForPath,
    resolveManagementScopesForProvider,
  };
})();
