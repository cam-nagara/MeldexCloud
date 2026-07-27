// フォルダ内共有台帳（共有ワークスペースフォルダの中に置く相対パス台帳）の
// データ層の土台。
//
// gb-source-folder-registry.js が扱うアカウントルート台帳（絶対Dropbox
// パス、/MeldexSettings 配下）とは別に、共有ワークスペースフォルダ自身の中に
// 置く台帳（<共有フォルダ>/MeldexShare/_meldex/source-folders.v1.json）を扱う。
//
// フォルダ内台帳のソースフォルダは、メンバーごとにDropbox上のマウント位置
// （絶対パス）が異なるため、共有フォルダ基準の相対パスで保存する。
//
// このファイルはフェーズ1（土台）のみを実装する。複数台帳のマージ・書き戻し・
// 参加フロー等はフェーズ2以降で別途実装する
// (app/docs/dropbox-folder-scoped-sharing-plan-2026-07-21.md §4.3〜4.4)。
// 命名・timestamp形式・provider規約は gb-source-folder-registry.js に合わせる。

(function () {
  'use strict';

  if (window.MeldexWorkspaceSharedLedger) return;

  const WORKSPACE_SHARE_DIR = 'MeldexShare';
  const WORKSPACE_LEDGER_RELATIVE_PATH = 'MeldexShare/_meldex/source-folders.v1.json';
  const SCHEMA_VERSION = 1;
  const WORKSPACE_SOURCE_ID_PREFIX = 'wsrc:';
  const ORIGIN = 'ws';

  function _now() {
    return new Date().toISOString();
  }

  function isSafeWsRelPath(raw) {
    let text = String(raw == null ? '' : raw).trim().replace(/\\/g, '/');
    if (text.indexOf(':') !== -1) return false;
    text = text.replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
    if (!text || text === '.') return true;
    const segments = text.split('/');
    for (const segment of segments) {
      if (segment === '..') return false;
    }
    return true;
  }

  function normalizeWsRelPath(raw) {
    let text = String(raw == null ? '' : raw).trim().replace(/\\/g, '/');
    if (text.indexOf(':') !== -1) throw new Error('relPath に : は使えません');
    text = text.replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
    if (!text || text === '.') return '';
    const segments = [];
    for (const segment of text.split('/')) {
      if (segment === '..') throw new Error('relPath に .. は使えません');
      if (segment === '' || segment === '.') continue;
      segments.push(segment);
    }
    return segments.join('/');
  }

  function _slug(text) {
    let raw = String(text || '')
      .trim()
      .toLowerCase()
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '');
    raw = raw.replace(/[^a-z0-9぀-ヿ㐀-鿿]+/g, '-');
    raw = raw.replace(/-+/g, '-').replace(/^-|-$/g, '');
    return raw || 'root';
  }

  function workspaceSourceId(relPath, existingIds) {
    const used = new Set(existingIds || []);
    const normalized = relPath ? normalizeWsRelPath(relPath) : '';
    const slug = normalized ? _slug(normalized) : 'root';
    const base = `${WORKSPACE_SOURCE_ID_PREFIX}${slug}`;
    if (!used.has(base)) return base;
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${base}-${index}`;
      if (!used.has(candidate)) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
  }

  function normalizeWsSourceRoot(entry, existingIds) {
    if (!entry || typeof entry !== 'object') return null;
    let provider = String(entry.provider || '').trim();
    const hasRelKey = Object.prototype.hasOwnProperty.call(entry, 'relPath')
      || Object.prototype.hasOwnProperty.call(entry, 'path');
    if (!provider) provider = hasRelKey ? 'dropbox' : '';
    if (provider !== 'dropbox') return null;
    let rawRel = entry.relPath;
    if (rawRel == null) rawRel = entry.path;
    if (rawRel == null) rawRel = '';
    let relPath;
    try {
      relPath = normalizeWsRelPath(rawRel);
    } catch (err) {
      return null;
    }
    const id = String(entry.id || '').trim() || workspaceSourceId(relPath, existingIds);
    let name = String(entry.name || '').trim();
    if (!name) {
      if (relPath) {
        const parts = relPath.split('/');
        name = parts[parts.length - 1] || relPath;
      } else {
        name = '(このフォルダ)';
      }
    }
    const timestamp = _now();
    const normalized = {
      id,
      provider: 'dropbox',
      relPath,
      name,
      visible: entry.visible !== false,
      origin: ORIGIN,
      createdAt: entry.createdAt || timestamp,
      updatedAt: entry.updatedAt || timestamp,
    };
    if (Object.prototype.hasOwnProperty.call(entry, 'deleted')) {
      normalized.deleted = entry.deleted === true;
    }
    return normalized;
  }

  function _joinRelSegments(base, relPath) {
    const trimmedBase = String(base || '').replace(/\/+$/, '');
    if (!relPath) return trimmedBase || '/';
    return trimmedBase ? `${trimmedBase}/${relPath}` : `/${relPath}`;
  }

  function resolveWsSourceDropboxPath(workspaceDropboxPath, relPath) {
    const normalizedRel = normalizeWsRelPath(relPath);
    return _joinRelSegments(workspaceDropboxPath, normalizedRel);
  }

  function parseWsLedger(data) {
    let payload = data;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch (err) {
        return [];
      }
    }
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.roots)) return [];
    const existingIds = new Set();
    const roots = [];
    for (const raw of payload.roots) {
      const normalized = normalizeWsSourceRoot(raw, existingIds);
      if (!normalized) continue;
      existingIds.add(normalized.id);
      roots.push(normalized);
    }
    return roots;
  }

  function serializeWsLedger(roots) {
    const existingIds = new Set();
    const normalizedRoots = [];
    for (const raw of Array.isArray(roots) ? roots : []) {
      const normalized = normalizeWsSourceRoot(raw, existingIds);
      if (!normalized) continue;
      existingIds.add(normalized.id);
      normalizedRoots.push(normalized);
    }
    return {
      version: SCHEMA_VERSION,
      updatedAt: _now(),
      roots: normalizedRoots,
    };
  }

  // -------------------------------------------------------------------
  // フェーズ2: 複数台帳マージ（純粋ロジックの土台）
  //
  // §4.3「複数台帳のマージ（single→multi）」に対応する。ここで組み立てる
  // 統合 root 一覧は、既存の読み込み経路（loadOutlinerRoots 等）にはまだ
  // 配線しない（配線はフェーズ3以降）。Python版 (meldex_workspace_shared_
  // ledger.py) と同一セマンティクスを維持する。
  // -------------------------------------------------------------------

  function _joinDropboxPath(base, rel) {
    let normalizedBase = String(base == null ? '' : base).trim().replace(/\\/g, '/');
    normalizedBase = normalizedBase.replace(/\/+/g, '/');
    if (normalizedBase && normalizedBase !== '/') {
      normalizedBase = normalizedBase.replace(/\/+$/, '');
    }
    if (!normalizedBase) {
      normalizedBase = '/';
    } else if (normalizedBase.charAt(0) !== '/') {
      normalizedBase = `/${normalizedBase}`;
    }

    const relClean = String(rel == null ? '' : rel).trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!relClean) return normalizedBase;
    if (normalizedBase === '/') return `/${relClean}`;
    return `${normalizedBase}/${relClean}`;
  }

  function writeTargetForRoot(root) {
    if (!root || typeof root !== 'object') return 'account';
    return String(root.writeTarget || 'account');
  }

  function _mergeWsRootsInto(merged, seenKeys, workspaces) {
    for (const workspace of Array.isArray(workspaces) ? workspaces : []) {
      if (!workspace || typeof workspace !== 'object') continue;
      const wsId = String(workspace.id || '').trim();
      const wsDropboxPath = String(workspace.dropboxPath || '').trim();
      const namespaceKind = workspace.namespaceKind === 'team_root' ? 'team_root' : 'home';
      if (!wsId || !wsDropboxPath) continue;
      const rawRoots = workspace.roots;
      if (!Array.isArray(rawRoots)) continue;
      const existingIds = new Set();
      for (const rawRoot of rawRoots) {
        const normalized = normalizeWsSourceRoot(rawRoot, existingIds);
        if (!normalized) continue;
        existingIds.add(normalized.id);
        if (normalized.deleted) continue;
        const resolved = _joinDropboxPath(wsDropboxPath, normalized.relPath || '');
        const key = `${namespaceKind}:${resolved.toLowerCase()}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        merged.push({
          id: normalized.id,
          provider: 'dropbox',
          namespaceKind,
          name: normalized.name,
          visible: normalized.visible,
          relPath: normalized.relPath,
          origin: `ws:${wsId}`,
          writeTarget: `ws:${wsId}`,
          workspaceId: wsId,
          workspaceDropboxPath: wsDropboxPath,
          resolvedDropboxPath: resolved,
          createdAt: normalized.createdAt,
          updatedAt: normalized.updatedAt,
        });
      }
    }
  }

  function _mergeAccountRootsInto(merged, seenKeys, accountRoots) {
    for (const accountRoot of Array.isArray(accountRoots) ? accountRoots : []) {
      if (!accountRoot || typeof accountRoot !== 'object') continue;
      if (accountRoot.deleted) continue;
      const dropboxPath = accountRoot.dropboxPath;
      if (!dropboxPath) continue;
      const resolved = _joinDropboxPath(String(dropboxPath), '');
      const namespaceKind = accountRoot.namespaceKind === 'team_root' ? 'team_root' : 'home';
      const key = `${namespaceKind}:${resolved.toLowerCase()}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const entry = Object.assign({}, accountRoot, {
        origin: 'account',
        writeTarget: 'account',
        resolvedDropboxPath: resolved,
      });
      merged.push(entry);
    }
  }

  function mergeSourceRoots(accountRoots, workspaces) {
    const merged = [];
    const seenKeys = new Set();
    _mergeWsRootsInto(merged, seenKeys, workspaces);
    _mergeAccountRootsInto(merged, seenKeys, accountRoots);
    return merged;
  }

  window.MeldexWorkspaceSharedLedger = {
    WORKSPACE_SHARE_DIR,
    WORKSPACE_LEDGER_RELATIVE_PATH,
    SCHEMA_VERSION,
    ORIGIN,
    isSafeWsRelPath,
    normalizeWsRelPath,
    workspaceSourceId,
    normalizeWsSourceRoot,
    resolveWsSourceDropboxPath,
    parseWsLedger,
    serializeWsLedger,
    mergeSourceRoots,
    writeTargetForRoot,
  };
})();
