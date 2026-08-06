// フォルダ内共有台帳I/O層（フェーズ3a）+ 参加中ワークスペースの端末ローカル記録。
//
// gb-source-folder-registry.js のアカウントルート台帳I/O実装
// （_readRemoteRegistryWithMetadata / writeRegistry のrevベース楽観ロック、
// strict_conflict、not_found時overwrite、1回だけのリトライ）に厳密に合わせて、
// 共有ワークスペースフォルダ基準のフォルダ内台帳を読み書きする。
// パース/直列化は二重実装せず gb-workspace-shared-ledger.js
// （window.MeldexWorkspaceSharedLedger）へ委譲する。
//
// 【重要】このファイルはフェーズ3aの土台のみ。既存の読み込み経路
// （loadOutlinerRoots 等）にはまだ配線しない
// (app/docs/dropbox-folder-scoped-sharing-plan-2026-07-21.md §4.1・§4.4・§5.2)。
// 配線・複数台帳マージの実運用化はフェーズ3b以降で行う。

(function () {
  'use strict';

  if (window.MeldexWorkspaceLedgerIO) return;

  const JOINED_WORKSPACES_KEY = 'meldex-joined-workspaces-v1';
  const WORKSPACE_LEDGER_DOCUMENT_ID = 'workspace-source-folders';

  function _auth() {
    return window.MeldexDropboxAuth;
  }

  function _sharedLedger() {
    return window.MeldexWorkspaceSharedLedger;
  }

  // ------------------------------------------------------------------
  // Dropboxパス正規化（gb-source-folder-registry.js と同じ規約のローカル実装。
  // 既存ファイルへの依存を増やさないため複製する）
  // ------------------------------------------------------------------

  function normalizeDropboxPath(path) {
    const raw = String(path || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/');
    if (raw === '/') return '/';
    const normalized = raw.replace(/\/$/, '');
    if (!normalized) return '';
    return normalized.startsWith('/') ? normalized : ('/' + normalized);
  }

  function normalizeRelativePath(path) {
    return String(path || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+/g, '/')
      .replace(/^\.\//, '')
      .replace(/\/$/, '');
  }

  function normalizeNamespaceKind(value) {
    return value === 'team_root' ? 'team_root' : 'home';
  }

  function joinDropboxPath() {
    const parts = Array.from(arguments);
    const first = normalizeDropboxPath(parts.shift() || '');
    const rest = parts.map(normalizeRelativePath).filter(Boolean).join('/');
    if (!rest) return first;
    return first === '/' ? `/${rest}` : `${first}/${rest}`;
  }

  function _basename(path) {
    const normalized = normalizeDropboxPath(path) || normalizeRelativePath(path);
    const parts = normalized.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  }

  function _slug(text) {
    const raw = String(text || '')
      .trim()
      .toLowerCase()
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean)
      .join('-')
      .replace(/[^a-z0-9぀-ヿ㐀-鿿-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return raw || 'workspace';
  }

  // ------------------------------------------------------------------
  // A. フォルダ内台帳I/O
  // ------------------------------------------------------------------

  function workspaceLedgerDropboxPath(workspaceDropboxPath) {
    const sharedLedger = _sharedLedger();
    const relative = sharedLedger?.WORKSPACE_LEDGER_RELATIVE_PATH
      || 'MeldexShare/_meldex/source-folders.v1.json';
    return joinDropboxPath(normalizeDropboxPath(workspaceDropboxPath), relative);
  }

  async function _content(route, arg, init, namespaceKind) {
    const auth = _auth();
    if (!auth?.apiContent) throw new Error('Dropboxへ接続してください');
    return auth.apiContent(route, arg, init, { namespaceKind: normalizeNamespaceKind(namespaceKind) });
  }

  function _isWorkspaceLedgerNotFoundError(err) {
    return /not_found|path\/not_found/i.test(err?.message || '');
  }

  async function _readWorkspaceLedgerWithMetadata(workspaceDropboxPath, namespaceKind) {
    const response = await _content('files/download', {
      path: workspaceLedgerDropboxPath(workspaceDropboxPath),
    }, undefined, namespaceKind);
    const text = await response.text();
    let rev = '';
    try {
      const metadataText = response.headers?.get?.('dropbox-api-result') || '';
      const metadata = metadataText ? JSON.parse(metadataText) : null;
      rev = String(metadata?.rev || '');
    } catch {
      // dropbox-api-result ヘッダーが無い/壊れている場合はrev無しの
      // 通常アップロード（overwrite）にフォールバックする。
    }
    const sharedLedger = _sharedLedger();
    if (!sharedLedger?.parseWsLedger) throw new Error('MeldexWorkspaceSharedLedger が未読み込みです');
    return {
      roots: sharedLedger.parseWsLedger(JSON.parse(text)),
      rev,
    };
  }

  async function _managementWorkspaceLedgerRecord(workspaceDropboxPath, namespaceKind, options) {
    const provider = window.MeldexStorageAdapter?.getProvider?.();
    const resolver = window.MeldexDropboxManagementRootResolver;
    const kind = window.MeldexSystemStorage?.SystemStorageKind?.FOLDER_ASSOCIATIONS;
    if (!provider || !resolver?.resolveSharedWorkspaceTypedAdapter || !kind) {
      throw new Error('共有ワークスペース台帳の管理領域を安全に判定できません');
    }
    // 対象ワークスペース専用の共有アダプターを解決する（接続中ルート非依存。
    // 個人領域アダプターへのフォールバックは resolver 側で構造的に禁止）。
    // 読み取り系は allowUnjoined 相当で常に管理レコードを探す（非破壊で、
    // パスから導出したワークスペース配下しか見ないため joined ゲート不要）。
    const adapter = await resolver.resolveSharedWorkspaceTypedAdapter(provider, kind, {
      workspaceDropboxPath,
      namespaceKind,
      allowUnjoined: options?.allowUnjoined === true,
    });
    const record = await adapter.load(kind, WORKSPACE_LEDGER_DOCUMENT_ID);
    return { adapter, kind, record };
  }

  async function readWorkspaceLedger(workspaceDropboxPath, namespaceKind) {
    try {
      const managed = await _managementWorkspaceLedgerRecord(workspaceDropboxPath, namespaceKind, { allowUnjoined: true });
      if (managed?.record?.payload) {
        const sharedLedger = _sharedLedger();
        return sharedLedger.parseWsLedger(managed.record.payload);
      }
      const result = await _readWorkspaceLedgerWithMetadata(workspaceDropboxPath, namespaceKind);
      return result.roots;
    } catch (err) {
      // フォルダ内台帳がまだ作成されていない共有ワークスペースは
      // 「ソースフォルダが1件も登録されていない」正常な初期状態のため、
      // not_found はエラーにせず空配列として扱う。
      if (_isWorkspaceLedgerNotFoundError(err)) return [];
      throw err;
    }
  }

  // 「共有ワークスペースにする」導線用。roots が空でも「ファイル自体が無い
  // （未作成）」のか「ファイルはあるが中身を解釈できない（他バージョンの形式・
  // 想定外の内容）」のかを exists で区別できるようにする。この区別が無いと、
  // 呼び出し元が後者を「未作成」と誤判定して新規内容で全置換し、他メンバーの
  // 共有内容を黙って消す事故につながる（敵対的検証 2026-07-21 で実行再現済み）。
  // ネットワーク一時障害・JSON破損は throw のまま伝播させる（呼び出し元は中断する）。
  async function readWorkspaceLedgerStatus(workspaceDropboxPath, namespaceKind) {
    try {
      const managed = await _managementWorkspaceLedgerRecord(workspaceDropboxPath, namespaceKind, { allowUnjoined: true });
      if (managed?.record?.payload) {
        return { exists: true, roots: _sharedLedger().parseWsLedger(managed.record.payload) };
      }
      const result = await _readWorkspaceLedgerWithMetadata(workspaceDropboxPath, namespaceKind);
      return { exists: true, roots: result.roots };
    } catch (err) {
      if (_isWorkspaceLedgerNotFoundError(err)) return { exists: false, roots: [] };
      throw err;
    }
  }

  async function writeWorkspaceLedger(workspaceDropboxPath, roots, namespaceKind, options) {
    const sharedLedger = _sharedLedger();
    if (!sharedLedger?.serializeWsLedger) throw new Error('MeldexWorkspaceSharedLedger が未読み込みです');
    // 書き込みは「参加中（joined一覧との完全一致）」または「呼び出し元が
    // 明示した allowUnjoined（『このフォルダを共有ワークスペースにする』導線で
    // ユーザーが確認した直後の初回書き込み）」の二段ゲート。未参加＋非明示は
    // resolver が throw する。管理レコードの revision CAS（未作成時は
    // expectedRevision: null の create-only）はそのまま維持し、同時ワークスペース化は
    // 上書きではなく競合エラーになる。
    const managed = await _managementWorkspaceLedgerRecord(workspaceDropboxPath, namespaceKind, {
      allowUnjoined: options?.allowUnjoined === true,
    });
    const serialized = sharedLedger.serializeWsLedger(roots);
    await managed.adapter.save(managed.kind, WORKSPACE_LEDGER_DOCUMENT_ID, serialized, {
      expectedRevision: managed.record?.revision ?? null,
    });
    return serialized;
  }

  // ------------------------------------------------------------------
  // B. 参加中ワークスペースの記録（この端末ローカル、localStorage）
  //
  // どの共有ワークスペースをこの端末で「参加」しているかは端末固有の情報
  // （マウント位置は端末ごとに異なる）なので、Dropbox台帳には書かず
  // localStorage にのみ保持する。
  // ------------------------------------------------------------------

  function _readJoinedWorkspacesRaw() {
    try {
      const raw = localStorage.getItem(JOINED_WORKSPACES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // localStorageが使えない/壊れている場合は「未参加」として扱う。
      return [];
    }
  }

  function _writeJoinedWorkspacesRaw(list) {
    try {
      localStorage.setItem(JOINED_WORKSPACES_KEY, JSON.stringify(list));
    } catch {
      // プライベートブラウズ等でlocalStorageへ書けない場合は、この端末での
      // 参加記録が次回起動時に失われるだけで、Dropbox側の台帳には影響しない。
    }
  }

  function listJoinedWorkspaces() {
    return _readJoinedWorkspacesRaw().map((entry) => ({
      ...entry,
      namespaceKind: normalizeNamespaceKind(entry?.namespaceKind),
    }));
  }

  function _joinedWorkspaceId(dropboxPath) {
    return 'ws:' + _slug(normalizeDropboxPath(dropboxPath));
  }

  function addJoinedWorkspace(entry) {
    const dropboxPath = normalizeDropboxPath(entry?.dropboxPath);
    if (!dropboxPath) throw new Error('共有ワークスペースフォルダを選択してください');
    const list = _readJoinedWorkspacesRaw();
    const normalizedLower = dropboxPath.toLowerCase();
    const existingIndex = list.findIndex(
      (item) => (
        normalizeNamespaceKind(item?.namespaceKind) === normalizeNamespaceKind(entry?.namespaceKind)
        && normalizeDropboxPath(item?.dropboxPath).toLowerCase() === normalizedLower
      )
    );
    const existing = existingIndex >= 0 ? list[existingIndex] : null;
    let id = String(entry?.id || existing?.id || '').trim();
    if (!id) {
      // 記号・空白だけが違う別フォルダ（例: /Team A と /Team-A）は同じ短縮名に
      // なるため、既に別のフォルダが同じIDを使っていれば -2, -3… で一意化する。
      // IDが重複すると、離脱で両方の参加記録が消える・フォルダツリーの解決先が
      // 取り違えられる（後勝ちで上書き）実害があるため必須のガード。
      const base = _joinedWorkspaceId(dropboxPath);
      const usedByOthers = new Set(
        list.filter((item, index) => index !== existingIndex).map((item) => String(item?.id || '').trim())
      );
      id = base;
      for (let n = 2; usedByOthers.has(id); n += 1) id = `${base}-${n}`;
    }
    const name = String(entry?.name || existing?.name || _basename(dropboxPath) || dropboxPath).trim();
    const record = {
      id,
      dropboxPath,
      namespaceKind: normalizeNamespaceKind(entry?.namespaceKind || existing?.namespaceKind),
      name,
      joinedAt: existing?.joinedAt || new Date().toISOString(),
    };
    if (existingIndex >= 0) list[existingIndex] = record;
    else list.push(record);
    _writeJoinedWorkspacesRaw(list);
    return record;
  }

  function removeJoinedWorkspace(id) {
    const targetId = String(id || '').trim();
    if (!targetId) return false;
    const list = _readJoinedWorkspacesRaw();
    const nextList = list.filter((item) => item?.id !== targetId);
    if (nextList.length === list.length) return false;
    _writeJoinedWorkspacesRaw(nextList);
    return true;
  }

  // ------------------------------------------------------------------
  // C. 公開
  // ------------------------------------------------------------------

  window.MeldexWorkspaceLedgerIO = {
    workspaceLedgerDropboxPath,
    readWorkspaceLedger,
    readWorkspaceLedgerStatus,
    writeWorkspaceLedger,
    listJoinedWorkspaces,
    addJoinedWorkspace,
    removeJoinedWorkspace,
  };
})();
