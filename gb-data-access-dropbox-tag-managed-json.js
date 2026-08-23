/* Dropbox-static: タグ台帳(auto-tag-dictionary)・割当ストア(global-tags)・その
   復旧データの管理領域JSON永続化層。

   2026-08-14期、gb-data-access-dropbox-tags.js の1000行制限（Meldex開発ルール
   「新規ファイルは1000行以内に設計する」）を機能追加で超えたため、責務単位
   （管理領域JSONの読み書きプリミティブ）で切り出した。window上の
   __MeldexPwaDataAccessInternals から直接読むのは gb-data-access-dropbox-tags.js
   と同じ。挙動は変えていない（移動のみ）。

   公開: window.MeldexDropboxManagedJson = { read, write, writeMerged, list, remove, provider } */
(function () {
  'use strict';
  const internals = window.__MeldexPwaDataAccessInternals;
  if (!internals) return;
  const { _readJsonSafe, _listDirectoryEntries } = internals;

  // タグ台帳(auto-tag-dictionary)・割当ストア(global-tags)・その復旧データは、
  // 常に「接続中ルート」の管理スコープへ置く(2026-08-04 完成監査の設計判断)。
  //
  // /global-tags/target 等が受け取る対象文書パス(共有ソースの仮想パスを含む)で
  // 管理ルートを解決してはならない: 台帳・割当は全対象を1ドキュメントで持つ
  // 単一ストアのため、対象パスごとにスコープを切り替えると同じストアの複製が
  // 個人領域と共有領域へ分岐し(どちらも「全体」を自称する)、さらに割当が参照
  // するタグidの定義(台帳)と別スコープへ割れて参照整合が壊れる。旧実装
  // (`.meldex/global-tags.json` を接続中ルート直下へ置く)の可視性の意味論
  // (共有ワークスペースへ接続中はメンバー間で共有・個人接続では個人のみ)を
  // そのまま新管理領域へ引き継ぐ。ここへ渡す第2引数は種別判定用の旧論理パス
  // であり、管理ルート解決へは渡さない。
  function managedDocumentId(path) {
    const value = String(path || '').replaceAll('\\', '/').replace(/^\/+/, '');
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    const label = value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '').slice(-72) || 'root';
    return `${label}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }
  function managedKindForPath(path) {
    const systemStorage = window.MeldexSystemStorage;
    if (!systemStorage) throw new Error('Dropbox管理データストレージを先に読み込んでください');
    const value = String(path || '').replaceAll('\\', '/').replace(/^\/+/, '');
    const recovery = value.startsWith('.meldex/asset-recovery/')
      || value.startsWith('.meldex/auto-tag-recovery/')
      || value.startsWith('.meldex/global-tag-recovery/');
    return recovery ? systemStorage.SystemStorageKind.ASSET_RECOVERY : systemStorage.SystemStorageKind.TAGS;
  }
  async function managedAdapter(provider, _logicalPath) {
    const resolver = window.MeldexDropboxManagementRootResolver;
    if (!resolver || typeof resolver.resolveAdapterForProvider !== 'function') {
      throw new Error('Dropbox管理データ保存先を安全に判定できません');
    }
    return resolver.resolveAdapterForProvider(provider);
  }
  async function readManagedJson(provider, path, fallbackValue) {
    const adapter = await managedAdapter(provider, path);
    const record = await adapter.load(managedKindForPath(path), managedDocumentId(path));
    if (record) {
      const payload = record.payload;
      if (!payload || typeof payload !== 'object'
        || payload.legacy_path !== String(path)
        || !Object.prototype.hasOwnProperty.call(payload, 'value')) {
        throw new Error(`管理データが破損しています: ${String(path)}`);
      }
      return structuredClone(payload.value);
    }
    // 旧付随物は移行期間中の読取専用フォールバック。
    return _readJsonSafe(provider, path, fallbackValue);
  }
  async function writeManagedJsonMerged(provider, path, updater, fallbackValue) {
    const adapter = await managedAdapter(provider, path);
    const kind = managedKindForPath(path);
    const documentId = managedDocumentId(path);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await adapter.load(kind, documentId);
      if (current && (current.payload?.legacy_path !== String(path)
        || !Object.prototype.hasOwnProperty.call(current.payload || {}, 'value'))) {
        throw new Error(`管理データが破損しています: ${String(path)}`);
      }
      const base = current
        ? structuredClone(current.payload.value)
        : await _readJsonSafe(provider, path, structuredClone(fallbackValue));
      const next = await updater(base);
      try {
        const saved = await adapter.save(kind, documentId, {
          legacy_path: String(path),
          value: next,
        }, { expectedRevision: current ? current.revision : null });
        return structuredClone(saved.payload.value);
      } catch (error) {
        if (error?.name !== 'SystemStorageConflictError'
          && error?.code !== 'system_storage_conflict') throw error;
      }
    }
    throw new Error(`管理データの同時更新を解決できませんでした: ${String(path)}`);
  }
  async function writeManagedJson(provider, path, value) {
    return writeManagedJsonMerged(provider, path, () => value, {});
  }
  async function listManagedEntries(provider, directory, includeLegacy = true) {
    const adapter = await managedAdapter(provider, directory);
    const prefix = `${String(directory || '').replace(/\/+$/g, '')}/`;
    const records = await adapter.listDocuments(managedKindForPath(prefix));
    const managed = records
      .filter(record => String(record?.payload?.legacy_path || '').startsWith(prefix))
      .map(record => {
        const path = String(record.payload.legacy_path);
        return { name: path.slice(prefix.length), path };
      })
      .filter(entry => entry.name && !entry.name.includes('/'));
    if (!includeLegacy || typeof _listDirectoryEntries !== 'function') return managed;
    let legacy = [];
    try {
      legacy = await _listDirectoryEntries(provider, directory);
    } catch {
      return managed;
    }
    const byName = new Map(managed.map(entry => [entry.name, entry]));
    (Array.isArray(legacy) ? legacy : []).forEach(entry => {
      const name = String(entry?.name || '');
      if (name && !byName.has(name)) byName.set(name, { ...entry, name });
    });
    return [...byName.values()];
  }
  async function removeManagedEntry(provider, path) {
    const adapter = await managedAdapter(provider, path);
    return adapter.delete(managedKindForPath(path), managedDocumentId(path));
  }
  function managedProvider(provider) {
    return {
      writeJson: (path, value) => writeManagedJson(provider, path, value),
      writeText: async (path, text) => {
        let value;
        try { value = JSON.parse(String(text)); } catch {
          throw new Error('管理データはJSON形式で保存する必要があります');
        }
        return writeManagedJson(provider, path, value);
      },
      writeJsonMerged: (path, updater, options) => writeManagedJsonMerged(
        provider,
        path,
        updater,
        options?.fallbackValue ?? {},
      ),
    };
  }
  window.MeldexDropboxManagedJson = {
    read: readManagedJson, write: writeManagedJson, writeMerged: writeManagedJsonMerged,
    list: listManagedEntries, remove: removeManagedEntry, provider: managedProvider,
  };
})();
