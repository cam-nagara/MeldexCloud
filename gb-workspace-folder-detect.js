/* gb-workspace-folder-detect.js — Dropbox上のフォルダが「共有ワークスペース」かどうかを判定する。
 *
 * 共有ワークスペースにすると、そのフォルダ直下に管理用の目印ファイルが作られる。
 * この目印の有無だけが「Meldexで作られた共有ワークスペースである」ことの根拠になる。
 * 参加先を選ぶ画面が目印を見ずに全フォルダを並べていたため、ワークスペースではない
 * ただのフォルダにも「参加」できてしまっていた（2026-08-07 修正）。
 */
(function (global) {
  'use strict';

  if (global.MeldexWorkspaceFolderDetect) return;

  // 現行の目印。共有ワークスペース化のときに必ず書かれる。
  const MARKER_PRIMARY = 'MeldexShare/system/v1/folder-associations/workspace-source-folders.json';
  // 旧形式の目印。読み取り互換のためだけに見る（新規には作られない）。
  const MARKER_LEGACY = 'MeldexShare/_meldex/source-folders.v1.json';
  const MARKERS = [MARKER_PRIMARY, MARKER_LEGACY];

  // 目印ファイルの名前（拡張子なし）。Dropboxのファイル名検索に使う。
  const MARKER_QUERIES = ['workspace-source-folders', 'source-folders.v1'];

  function _auth() {
    return global.MeldexDropboxAuth;
  }

  function _normalizeNamespaceKind(value) {
    return value === 'team_root' ? 'team_root' : 'home';
  }

  function _normalizePath(path) {
    const raw = String(path || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/');
    if (!raw || raw === '/') return '/';
    const trimmed = raw.replace(/\/$/, '');
    return trimmed.startsWith('/') ? trimmed : '/' + trimmed;
  }

  function _joinPath(base, relative) {
    const normalized = _normalizePath(base);
    return normalized === '/' ? '/' + relative : normalized + '/' + relative;
  }

  function _isNotFound(err) {
    return /not_found/i.test(err && err.message ? err.message : '');
  }

  /**
   * 指定した1つのフォルダが共有ワークスペースかどうかを確かめる。
   * 通信障害と「目印が無い」を取り違えないよう、確認できたかどうかも返す。
   * @returns {Promise<{workspace: boolean, checked: boolean, error: Error|null}>}
   */
  async function isWorkspaceFolder(path, namespaceKind) {
    const auth = _auth();
    if (!auth || !auth.apiRpc) return { workspace: false, checked: false, error: new Error('Dropboxへ接続してください') };
    const target = _normalizePath(path);
    if (target === '/') return { workspace: false, checked: true, error: null };
    const kind = _normalizeNamespaceKind(namespaceKind);
    let lastError = null;
    for (const marker of MARKERS) {
      try {
        await auth.apiRpc('files/get_metadata', { path: _joinPath(target, marker) }, { namespaceKind: kind });
        return { workspace: true, checked: true, error: null };
      } catch (err) {
        // 目印が無いだけなら次の形式を試す。それ以外は確認できなかったものとして扱う。
        if (!_isNotFound(err)) lastError = err;
      }
    }
    return lastError
      ? { workspace: false, checked: false, error: lastError }
      : { workspace: false, checked: true, error: null };
  }

  function _matchFilePath(match) {
    const outer = match && match.metadata;
    const inner = outer && outer.metadata ? outer.metadata : outer;
    if (!inner) return '';
    return String(inner.path_display || inner.path_lower || '');
  }

  function _workspaceRootFromMarkerPath(markerPath) {
    const normalized = _normalizePath(markerPath);
    const lower = normalized.toLowerCase();
    for (const marker of MARKERS) {
      const suffix = '/' + marker.toLowerCase();
      if (lower.endsWith(suffix)) return normalized.slice(0, normalized.length - suffix.length) || '/';
    }
    return '';
  }

  async function _searchMarker(query, basePath, namespaceKind) {
    const auth = _auth();
    const kind = _normalizeNamespaceKind(namespaceKind);
    const scope = _normalizePath(basePath);
    const roots = [];
    let payload = await auth.apiRpc('files/search_v2', {
      query,
      options: {
        path: scope === '/' ? '' : scope,
        max_results: 1000,
        file_status: 'active',
        filename_only: true,
      },
    }, { namespaceKind: kind });
    while (payload) {
      (payload.matches || []).forEach((match) => {
        const root = _workspaceRootFromMarkerPath(_matchFilePath(match));
        if (root) roots.push(root);
      });
      if (!payload.has_more || !payload.cursor) break;
      payload = await auth.apiRpc('files/search/continue_v2', { cursor: payload.cursor }, { namespaceKind: kind });
    }
    return roots;
  }

  /**
   * 指定フォルダより下にある共有ワークスペースの位置をまとめて調べる。
   * 検索の索引が追いつかず取りこぼす可能性があるため、これは一覧の絞り込み専用。
   * 「このフォルダに参加してよいか」の最終判定には isWorkspaceFolder を使う。
   * @returns {Promise<{roots: string[], searched: boolean, error: Error|null}>}
   */
  async function findWorkspaceRootsUnder(basePath, namespaceKind) {
    const auth = _auth();
    if (!auth || !auth.apiRpc) return { roots: [], searched: false, error: new Error('Dropboxへ接続してください') };
    try {
      const results = await Promise.all(
        MARKER_QUERIES.map((query) => _searchMarker(query, basePath, namespaceKind))
      );
      const unique = new Set();
      results.forEach((list) => list.forEach((root) => unique.add(root)));
      return { roots: Array.from(unique), searched: true, error: null };
    } catch (err) {
      return { roots: [], searched: false, error: err };
    }
  }

  global.MeldexWorkspaceFolderDetect = {
    MARKERS,
    MARKER_QUERIES,
    isWorkspaceFolder,
    findWorkspaceRootsUnder,
    workspaceRootFromMarkerPath: _workspaceRootFromMarkerPath,
  };
})(typeof window !== 'undefined' ? window : globalThis);
