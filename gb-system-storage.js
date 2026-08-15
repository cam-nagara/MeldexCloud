/* gb-system-storage.js
 *
 * 固有形式付随物廃止・管理データ一元化計画 Phase 1b(共通契約モジュール、ブラウザ/JS側)。
 *
 * 計画書: app/docs/proprietary-format-sidecar-cleanup-plan-2026-07-31.md (§4 目標アーキテクチャ, Phase 1)
 * 監査ノート: app/docs/proprietary-format-sidecar-cleanup-audit-2026-08-01/notes.md
 * Phase 1a(正本・Python側契約): app/meldex_system_storage.py
 *
 * ## このモジュールの役割
 *
 * Phase 1aの meldex_system_storage.py と同じ封筒形式(meldex_system_storage 封筒 +
 * payload)・種別語彙(ハイフン区切り)・スキーマ版(schema_version=1)を
 * ブラウザ/JS側でも使うための共通契約を定義する。実際の保存先ごとの実装は
 * gb-system-storage-indexeddb.js(ブラウザローカル / IndexedDB)、
 * gb-system-storage-dropbox.js(Dropbox個人領域・共有ワークスペース)が担う。
 * 環境判定から具体的なアダプターを選ぶ resolveSystemStorageAdapter() は
 * このファイルに置く(Python側は別モジュール meldex_system_storage_resolver.py
 * だが、JS側は3ファイル構成の指示に合わせてここへ内包する)。
 *
 * ## Phase 1bの範囲(重要)
 *
 * このモジュール(と姉妹モジュール)は「層の新設」のみを行う。既存の注釈・
 * タグ・ロック等の呼び出し元をこの層へ載せ替える配線変更は、Phase 3
 * (ローカル/単独アプリ)・Phase 4(Cloud/Dropbox共有)で別途行う。
 * 既存ファイル(gb-active-lock-store.js 等)は変更しない。
 *
 * ## 秘密情報について(Phase 0引き継ぎ事項)
 *
 * `_meldex/secrets/llm-api-keys.v1.json` のようなAPIキー等の秘密情報は、
 * 本計画・本モジュールの移行対象に含めない(監査ノート§6.1-6)。
 *
 * ## 「meldex_system_storage」封筒と、ファイル内メタデータ「meldex」の違い(重要)
 *
 * 計画書§4.3の `meldex: {metadata_version, document_id}`(固有形式ファイル自身に
 * 埋め込む安定文書ID、Phase 2で実装予定)とは別物。混同しないこと
 * (meldex_system_storage.py と同じ注意書き)。
 */
(function () {
  'use strict';

  if (window.MeldexSystemStorage) return;

  // --- データ種別(計画書§4.2。Phase 1aの SystemStorageKind と同じ語彙) ---------

  const SystemStorageKind = Object.freeze({
    ANNOTATIONS: 'annotations',
    TAGS: 'tags',
    EDIT_LOCKS: 'edit-locks',
    VIEW_LOCKS: 'view-locks',
    REFERENCE_CONFIRMATIONS: 'reference-confirmations',
    VERSIONS: 'versions',
    CONFLICT_BACKUPS: 'conflict-backups',
    FOLDER_ASSOCIATIONS: 'folder-associations',
    PROFILES_WORKSPACE: 'profiles-workspace',
    AUDIT_INTEGRITY: 'audit-integrity',
    WORKSPACE_METADATA: 'workspace-metadata',
    IMPORT_CHECKPOINTS: 'import-checkpoints',
    ASSET_RECOVERY: 'asset-recovery',
    IDENTITY_CLAIMS: 'identity-claims',
    DIAGNOSTICS: 'diagnostics',
    // テーマなど、同じ人がどの環境で開いても同じであってほしい見た目の設定。
    // 個人管理領域だけで使用する(共有ワークスペースへ置くと他メンバーへ漏れる)。
    USER_PREFERENCES: 'user-preferences',
    // 自動割り当ての検討案は個人領域、採用済みベースライン・採用ジャーナル・
    // 能力設定・テンプレート・プロジェクト設定は共有ワークスペース領域へ置く。
    // Python 側 SystemStorageKind と同じ語彙・容量契約を使う。
    SCHEDULE_PROPOSALS: 'schedule-proposals',
    SCHEDULE_BASELINES: 'schedule-baselines',
    SCHEDULE_JOURNALS: 'schedule-journals',
    SCHEDULE_POLICIES: 'schedule-policies',
    SCHEDULE_TEMPLATES: 'schedule-templates',
    SCHEDULE_PROJECTS: 'schedule-projects',
    // Phase 5(既存付随物の自動移行)専用。meldex_system_storage.py と対称。
    MIGRATION_LEDGER: 'migration-ledger',
    MIGRATION_BACKUPS: 'migration-backups',
    // 可搬ナレッジ索引(gb-portable-knowledge-runtime.js)。接続中フォルダに限らず
    // 登録済み全ソースフォルダを横断するDropboxアカウント単位の機能のため、
    // 常に個人管理領域だけで使用する(共有ワークスペースへは置かない。個人限定の
    // ソースフォルダ内容が他メンバーへ漏れるのを防ぐため)。JS専用種別で、
    // 対応するPython(PC本体)側の実装は無い(isAvailable()がbrowser/dropbox
    // モード限定のため)。
    // artifacts: 文書ごとの内容アドレス方式の抽出済み断片(revisionが変われば
    // 別document_id。世代の掃除は現状未実装、従来動作のまま)。
    PORTABLE_KNOWLEDGE_ARTIFACTS: 'portable-knowledge-artifacts',
    // devices: 端末ごとの索引台帳(1端末=1文書。CASで安全に上書きする)。
    PORTABLE_KNOWLEDGE_DEVICES: 'portable-knowledge-devices',
  });

  const ALL_SYSTEM_STORAGE_KINDS = Object.freeze(Object.values(SystemStorageKind));

  function isValidSystemStorageKind(value) {
    return ALL_SYSTEM_STORAGE_KINDS.includes(value);
  }

  // 種別 → サブパスの対応。将来、値とサブフォルダ名を分けたくなった場合の
  // 唯一の変更箇所(meldex_system_storage.py の _KIND_SEGMENT_OVERRIDES と同じ思想)。
  const _KIND_SEGMENT_OVERRIDES = {};

  function kindSubpathSegment(kind) {
    if (!isValidSystemStorageKind(kind)) throw new SystemStorageError(`未知の種別です: ${kind}`);
    return Object.prototype.hasOwnProperty.call(_KIND_SEGMENT_OVERRIDES, kind) ? _KIND_SEGMENT_OVERRIDES[kind] : kind;
  }

  // --- document_id の安全性検査 ---------------------------------------------

  const _DOCUMENT_ID_RE = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,126}[A-Za-z0-9])?$/;

  function sanitizeDocumentId(value) {
    const text = String(value == null ? '' : value).trim();
    if (!_DOCUMENT_ID_RE.test(text)) {
      throw new SystemStorageError(
        `document_id は英数字・ハイフン・アンダースコアのみ(1〜128文字、先頭と末尾は英数字)で指定してください: ${JSON.stringify(value)}`,
      );
    }
    return text;
  }

  function documentRelativePath(kind, documentId) {
    const docId = sanitizeDocumentId(documentId);
    const segment = kindSubpathSegment(kind);
    return `${segment}/${docId}.json`;
  }

  // --- 禁止された旧付随物名の機械検査(計画書§4.1) -----------------------------

  const _FORBIDDEN_LEGACY_SEGMENTS = new Set(['_meldex', '.meldex', '_events', '自動タグ辞書']);

  function isForbiddenLegacySegment(name) {
    return _FORBIDDEN_LEGACY_SEGMENTS.has(String(name == null ? '' : name).trim());
  }

  function pathContainsForbiddenLegacySegment(pathLike) {
    const text = String(pathLike == null ? '' : pathLike).replace(/\\/g, '/');
    return text.split('/').filter(Boolean).some(isForbiddenLegacySegment);
  }

  // --- スキーマ版と移行フック -------------------------------------------------

  const CURRENT_SCHEMA_VERSION = 1;
  const _MIGRATIONS = new Map(); // kind -> Map(fromVersion -> hook)

  function registerSchemaMigration(kind, fromVersion, hook) {
    if (!_MIGRATIONS.has(kind)) _MIGRATIONS.set(kind, new Map());
    _MIGRATIONS.get(kind).set(Number(fromVersion), hook);
  }

  function applySchemaMigrations(kind, schemaVersion, payload) {
    let version = schemaVersion ? Number(schemaVersion) : CURRENT_SCHEMA_VERSION;
    if (version > CURRENT_SCHEMA_VERSION) {
      throw new SystemStorageError(
        `${kindSubpathSegment(kind)} の保存データの schema_version=${version} は、`
        + `このMeldexが扱える上限(schema_version=${CURRENT_SCHEMA_VERSION})より新しいため読み込めません`,
      );
    }
    const hooks = _MIGRATIONS.get(kind);
    let current = payload;
    while (version < CURRENT_SCHEMA_VERSION) {
      const hook = hooks ? hooks.get(version) : null;
      if (!hook) break; // 移行フック未登録の版はそのまま扱う
      current = hook(current);
      version += 1;
    }
    return { version, payload: current };
  }

  // --- 例外 --------------------------------------------------------------

  class SystemStorageError extends Error {
    constructor(message) {
      super(message);
      this.name = 'SystemStorageError';
    }
  }

  class SystemStorageNotFoundError extends SystemStorageError {
    constructor(message) {
      super(message);
      this.name = 'SystemStorageNotFoundError';
    }
  }

  class SystemStorageCorruptRecordError extends SystemStorageError {
    constructor(message) {
      super(message);
      this.name = 'SystemStorageCorruptRecordError';
    }
  }

  class SystemStorageWriteError extends SystemStorageError {
    constructor(message) {
      super(message);
      this.name = 'SystemStorageWriteError';
    }
  }

  class SystemStorageQuotaExceededError extends SystemStorageWriteError {
    constructor(message) {
      super(message);
      this.name = 'SystemStorageQuotaExceededError';
    }
  }

  class SystemStorageConflictError extends SystemStorageError {
    constructor({ kind, documentId, expectedRevision, currentRevision, conflictBackupDocumentId, message } = {}) {
      super(message || `${documentId} の保存内容が別の更新と競合しました`);
      this.name = 'SystemStorageConflictError';
      this.kind = kind;
      this.documentId = documentId;
      this.expectedRevision = expectedRevision == null ? null : expectedRevision;
      this.currentRevision = currentRevision == null ? null : currentRevision;
      this.conflictBackupDocumentId = conflictBackupDocumentId || null;
    }
  }

  // --- 容量上限・世代数・保管期限(定数+読み出し関数。強制はアダプター側) ------
  //
  // 値は meldex_system_storage.DEFAULT_RETENTION_POLICIES と同じ(初期見積り値。
  // 実運用でボトルネックが見えた場合は両側を合わせて調整すること)。

  const DEFAULT_RETENTION_POLICIES = Object.freeze({
    [SystemStorageKind.ANNOTATIONS]: { maxDocumentBytes: 2_000_000, maxTotalBytes: 200_000_000, maxGenerations: null, retentionDays: null },
    [SystemStorageKind.TAGS]: { maxDocumentBytes: 2_000_000, maxTotalBytes: 200_000_000, maxGenerations: null, retentionDays: null },
    [SystemStorageKind.EDIT_LOCKS]: { maxDocumentBytes: 200_000, maxTotalBytes: 20_000_000, maxGenerations: null, retentionDays: 1 },
    [SystemStorageKind.VIEW_LOCKS]: { maxDocumentBytes: 200_000, maxTotalBytes: 20_000_000, maxGenerations: null, retentionDays: 1 },
    [SystemStorageKind.REFERENCE_CONFIRMATIONS]: { maxDocumentBytes: 200_000, maxTotalBytes: 20_000_000, maxGenerations: null, retentionDays: 1 },
    [SystemStorageKind.VERSIONS]: { maxDocumentBytes: 50_000_000, maxTotalBytes: null, maxGenerations: 20, retentionDays: null },
    [SystemStorageKind.CONFLICT_BACKUPS]: { maxDocumentBytes: 50_000_000, maxTotalBytes: null, maxGenerations: null, retentionDays: 30 },
    [SystemStorageKind.FOLDER_ASSOCIATIONS]: { maxDocumentBytes: 1_000_000, maxTotalBytes: 50_000_000, maxGenerations: null, retentionDays: null },
    [SystemStorageKind.PROFILES_WORKSPACE]: { maxDocumentBytes: 1_000_000, maxTotalBytes: 50_000_000, maxGenerations: null, retentionDays: null },
    [SystemStorageKind.AUDIT_INTEGRITY]: { maxDocumentBytes: 10_000_000, maxTotalBytes: 500_000_000, maxGenerations: null, retentionDays: null },
    [SystemStorageKind.WORKSPACE_METADATA]: { maxDocumentBytes: 2_000_000, maxTotalBytes: 50_000_000, maxGenerations: null, retentionDays: null },
    [SystemStorageKind.IMPORT_CHECKPOINTS]: { maxDocumentBytes: 2_000_000, maxTotalBytes: 100_000_000, maxGenerations: null, retentionDays: null },
    [SystemStorageKind.ASSET_RECOVERY]: { maxDocumentBytes: 50_000_000, maxTotalBytes: null, maxGenerations: null, retentionDays: 30 },
    [SystemStorageKind.IDENTITY_CLAIMS]: { maxDocumentBytes: 2_000_000, maxTotalBytes: null, maxGenerations: null, retentionDays: null },
    [SystemStorageKind.DIAGNOSTICS]: { maxDocumentBytes: 10_000_000, maxTotalBytes: 200_000_000, maxGenerations: null, retentionDays: 30 },
    [SystemStorageKind.USER_PREFERENCES]: { maxDocumentBytes: 1_000_000, maxTotalBytes: 20_000_000, maxGenerations: null, retentionDays: null },
    [SystemStorageKind.SCHEDULE_PROPOSALS]: { maxDocumentBytes: 50_000_000, maxTotalBytes: 1_000_000_000, maxGenerations: null, retentionDays: null },
    [SystemStorageKind.SCHEDULE_BASELINES]: { maxDocumentBytes: 50_000_000, maxTotalBytes: 1_000_000_000, maxGenerations: null, retentionDays: null },
    [SystemStorageKind.SCHEDULE_JOURNALS]: { maxDocumentBytes: 2_000_000, maxTotalBytes: 100_000_000, maxGenerations: null, retentionDays: null },
    [SystemStorageKind.SCHEDULE_POLICIES]: { maxDocumentBytes: 1_000_000, maxTotalBytes: 10_000_000, maxGenerations: null, retentionDays: null },
    [SystemStorageKind.SCHEDULE_TEMPLATES]: { maxDocumentBytes: 5_000_000, maxTotalBytes: 100_000_000, maxGenerations: null, retentionDays: null },
    [SystemStorageKind.SCHEDULE_PROJECTS]: { maxDocumentBytes: 5_000_000, maxTotalBytes: 100_000_000, maxGenerations: null, retentionDays: null },
    [SystemStorageKind.MIGRATION_LEDGER]: { maxDocumentBytes: 2_000_000, maxTotalBytes: 50_000_000, maxGenerations: null, retentionDays: null },
    [SystemStorageKind.MIGRATION_BACKUPS]: { maxDocumentBytes: 50_000_000, maxTotalBytes: null, maxGenerations: null, retentionDays: 30 },
    // 断片は文書1件分のテキスト断片・構造(nodes/edges)を含むためANNOTATIONS等より
    // 大きく見積もる。世代掃除は無し(現状の仕様どおり。将来のGC課題は別途)。
    [SystemStorageKind.PORTABLE_KNOWLEDGE_ARTIFACTS]: { maxDocumentBytes: 8_000_000, maxTotalBytes: 2_000_000_000, maxGenerations: null, retentionDays: null },
    [SystemStorageKind.PORTABLE_KNOWLEDGE_DEVICES]: { maxDocumentBytes: 5_000_000, maxTotalBytes: 100_000_000, maxGenerations: null, retentionDays: null },
  });

  function retentionPolicyFor(kind) {
    const policy = DEFAULT_RETENTION_POLICIES[kind];
    if (!policy) throw new SystemStorageError(`未知の種別です: ${kind}`);
    return policy;
  }

  function checkDocumentSizeQuota(kind, payloadBytes, options) {
    const policy = (options && options.policy) || retentionPolicyFor(kind);
    if (policy.maxDocumentBytes != null && payloadBytes > policy.maxDocumentBytes) {
      throw new SystemStorageQuotaExceededError(
        `${kind} の1件あたりの保存上限(${policy.maxDocumentBytes}バイト)を超えています(実際: ${payloadBytes}バイト)`,
      );
    }
  }

  function checkTotalSizeQuota(kind, existingTotalBytes, incomingBytes, options) {
    const policy = (options && options.policy) || retentionPolicyFor(kind);
    if (policy.maxTotalBytes != null && (existingTotalBytes + incomingBytes) > policy.maxTotalBytes) {
      throw new SystemStorageQuotaExceededError(
        `${kind} 種別の合計保存上限(${policy.maxTotalBytes}バイト)を超えています`
        + `(既存 ${existingTotalBytes} + 今回 ${incomingBytes} バイト)`,
      );
    }
  }

  function selectDocumentsExceedingRetention(records, options) {
    const opts = options || {};
    if (!records || !records.length) return [];
    const policy = opts.policy || retentionPolicyFor(records[0].kind);
    const now = opts.now instanceof Date ? opts.now : new Date();
    const ordered = [...records].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    const doomed = new Set();
    if (policy.maxGenerations != null && ordered.length > policy.maxGenerations) {
      ordered.slice(policy.maxGenerations).forEach(record => doomed.add(record.documentId));
    }
    if (policy.retentionDays != null) {
      const cutoff = now.getTime() - policy.retentionDays * 24 * 60 * 60 * 1000;
      ordered.forEach((record) => {
        const updatedMs = Date.parse(record.updatedAt || '');
        if (Number.isFinite(updatedMs) && updatedMs < cutoff) doomed.add(record.documentId);
      });
    }
    return Array.from(doomed).sort();
  }

  // --- 保管期限を超えたバックアップの掃除(計画書§6.3、フェーズB徹底チェック(c)) --
  //
  // selectDocumentsExceedingRetention は判定のみのI/Oフリー関数で、これまで
  // 呼び出し元が無く30日保持の設計が実質無期限のまま放置されていた
  // (Python側 meldex_system_storage.run_retention_cleanup と対称の実装)。
  // 掃除対象は移行バックアップ(MIGRATION_BACKUPS)・競合バックアップ
  // (CONFLICT_BACKUPS)に限定する(理由はPython側と同じ。移行バックアップは
  // 「全target_pathの照合完了後にのみ」退避されるため常に照合済み、競合
  // バックアップは保存時のCAS競合スナップショットで追加の照合対象を持たない
  // ため、いずれも期限判定だけで安全に掃除できる)。

  const RETENTION_CLEANUP_KINDS = Object.freeze([
    SystemStorageKind.MIGRATION_BACKUPS,
    SystemStorageKind.CONFLICT_BACKUPS,
    SystemStorageKind.REFERENCE_CONFIRMATIONS,
  ]);

  async function runRetentionCleanup(adapter, options) {
    const opts = options || {};
    const kinds = opts.kinds || RETENTION_CLEANUP_KINDS;
    const now = opts.now instanceof Date ? opts.now : new Date();
    const deletedByKind = {};
    for (const kind of kinds) {
      let records = [];
      try {
        records = await adapter.listDocuments(kind);
      } catch {
        continue;
      }
      if (!records || !records.length) continue;
      const doomed = selectDocumentsExceedingRetention(records, { now });
      let deleted = 0;
      for (const documentId of doomed) {
        try {
          if (await adapter.delete(kind, documentId)) deleted += 1;
        } catch {
          // 個別ドキュメントの削除失敗は無視して他のドキュメントの掃除を続ける
          // (起動時保守の性質上、掃除の失敗を致命的にしないため)。
        }
      }
      if (deleted) deletedByKind[kind] = deleted;
    }
    return deletedByKind;
  }

  // --- レコード(封筒)とrevision計算 -----------------------------------------

  function nowIso() {
    return new Date().toISOString().replace(/\.(\d{3})\d*Z$/, '.$1Z');
  }

  function _canonicalJsonValue(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(_canonicalJsonValue);
    const out = {};
    Object.keys(value).sort().forEach((key) => { out[key] = _canonicalJsonValue(value[key]); });
    return out;
  }

  function canonicalJsonStringify(payload) {
    // meldex_system_storage.compute_revision の
    // json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    // と同じ「キーを再帰的にソートしたコンパクトJSON」を作る。JSON.stringify は
    // 既定で非ASCII文字をエスケープせず、区切り記号もコンパクト(",", ":"相当)
    // なので、キー順序だけ揃えれば同じ意味論になる。
    return JSON.stringify(_canonicalJsonValue(payload));
  }

  async function _sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function computeRevision(payload) {
    // 不透明な比較用トークン(内容ハッシュ)。真のDropbox revとは別物だが、
    // 「一致/不一致だけを見る」同じ意味論で設計してある
    // (gb-system-storage-dropbox.js は真のDropbox revをそのまま使う。
    // meldex_system_storage_dropbox.py のモジュールdocstringと同じ設計判断)。
    return _sha256Hex(canonicalJsonStringify(payload));
  }

  function recordToEnvelope(record) {
    return {
      meldex_system_storage: {
        schema_version: record.schemaVersion,
        kind: record.kind,
        document_id: record.documentId,
        revision: record.revision,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
        boundary: record.boundary,
      },
      payload: record.payload,
    };
  }

  function envelopeToJsonText(record) {
    return JSON.stringify(recordToEnvelope(record), null, 2);
  }

  function recordFromEnvelope(data, options) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new SystemStorageCorruptRecordError('管理データの形式が不正です(dict以外)');
    }
    const meta = data.meldex_system_storage;
    if (!meta || typeof meta !== 'object') {
      throw new SystemStorageCorruptRecordError('管理データに meldex_system_storage 封筒がありません');
    }
    const rawKind = String(meta.kind || '');
    if (!isValidSystemStorageKind(rawKind)) {
      throw new SystemStorageCorruptRecordError(`未知の種別です: ${rawKind}`);
    }
    let schemaVersion = Number(meta.schema_version);
    if (!Number.isFinite(schemaVersion)) schemaVersion = 0;
    const rawPayload = (data.payload && typeof data.payload === 'object' && !Array.isArray(data.payload)) ? data.payload : {};
    const migrated = applySchemaMigrations(rawKind, schemaVersion, rawPayload);
    const revisionOverride = options && Object.prototype.hasOwnProperty.call(options, 'revisionOverride') ? options.revisionOverride : undefined;
    return {
      kind: rawKind,
      documentId: String(meta.document_id || ''),
      schemaVersion: migrated.version,
      revision: revisionOverride !== undefined ? revisionOverride : String(meta.revision || ''),
      payload: migrated.payload,
      createdAt: String(meta.created_at || ''),
      updatedAt: String(meta.updated_at || ''),
      boundary: String(meta.boundary || ''),
    };
  }

  // --- 監査可能なエラー記録 ---------------------------------------------------
  //
  // Python版はファイルへ1行JSONを追記するが、ブラウザ側に等価な「デバッグログ
  // ファイル」は無い。かわりに CustomEvent で最良努力の記録を broadcast し、
  // 呼び出し側が渡した sink(関数)があれば追加で呼ぶ(sinkの失敗は本来の
  // 操作を失敗させない。Python版の「ログ書込失敗で本来の操作まで失敗させない」
  // と同じ方針)。

  function recordStorageAuditEvent(sink, { level, operation, kind, documentId, environment, message, detail } = {}) {
    const record = {
      level: String(level || 'info'),
      time: nowIso(),
      source: 'system_storage',
      operation: String(operation || ''),
      kind: typeof kind === 'string' ? kind : String(kind || ''),
      document_id: String(documentId || ''),
      environment: String(environment || ''),
      message: String(message || ''),
    };
    if (detail) record.detail = detail;
    try {
      window.dispatchEvent(new CustomEvent('meldex:system-storage-audit', { detail: record }));
    } catch { /* CustomEvent非対応環境(Node実行等)では通知を諦めるだけで、本来の操作は継続する */ }
    if (typeof sink === 'function') {
      try { sink(record); } catch { /* 監査sinkの失敗で本来の操作まで失敗させない */ }
    }
  }

  // --- 共通インターフェース(基底クラス) --------------------------------------
  //
  // JSには abc.ABC 相当の強制力は無いため、未実装メソッドは呼び出し時に
  // 例外を投げるだけの「契約のドキュメント化」として機能する。
  // 各メソッドの契約は meldex_system_storage.SystemStorageAdapter の
  // docstringと同じ:
  //
  // - save: 新規作成または上書き。expectedRevision を指定すると、現在保存
  //   されている内容の revision と一致する場合のみ書き込む(楽観的排他制御)。
  //   不一致なら書き込まずに SystemStorageConflictError を投げる。
  // - load: 存在しなければ null。破損していれば SystemStorageCorruptRecordError。
  // - listDocuments: 種別配下の全件を返す。個々の破損レコードは監査ログへ
  //   記録した上でスキップしてよい。
  // - delete: 存在すれば削除して true、無ければ false。
  // - describe: 秘密情報を含まない診断用メタデータ。

  class SystemStorageAdapter {
    async save(_kind, _documentId, _payload, _options) {
      throw new SystemStorageError('save() は未実装です');
    }

    async load(_kind, _documentId) {
      throw new SystemStorageError('load() は未実装です');
    }

    async listDocuments(_kind) {
      throw new SystemStorageError('listDocuments() は未実装です');
    }

    async listDocumentHeaders(_kind, _options) {
      throw new SystemStorageError('listDocumentHeaders() は未実装です');
    }

    async documentCollectionGeneration(_kind, _options) {
      throw new SystemStorageError('documentCollectionGeneration() は未実装です');
    }

    async delete(_kind, _documentId) {
      throw new SystemStorageError('delete() は未実装です');
    }

    describe() {
      throw new SystemStorageError('describe() は未実装です');
    }
  }

  class ReadOnlySystemStorageAdapter extends SystemStorageAdapter {
    constructor(inner) {
      super();
      this._inner = inner;
    }

    async save() {
      throw new SystemStorageWriteError('閲覧のみの権限のため保存できません');
    }

    async delete() {
      throw new SystemStorageWriteError('閲覧のみの権限のため削除できません');
    }

    async load(kind, documentId) {
      return this._inner.load(kind, documentId);
    }

    async listDocuments(kind) {
      return this._inner.listDocuments(kind);
    }

    async listDocumentHeaders(kind, options) {
      return this._inner.listDocumentHeaders(kind, options);
    }

    async documentCollectionGeneration(kind, options) {
      return this._inner.documentCollectionGeneration(kind, options);
    }

    describe() {
      return { ...this._inner.describe(), read_only: true };
    }
  }

  // --- 保存先解決(環境判定 → アダプター選択) ----------------------------------
  //
  // 計画書§4.2「環境、アカウント、ワークスペース、権限に応じた保存先解決」。
  // 管理領域のパス文字列は gb-system-storage-indexeddb.js /
  // gb-system-storage-dropbox.js だけが組み立て、このモジュールを含む他の
  // どのモジュールも直接組み立てない(計画書§4.1)。
  //
  // Phase 1bでは「層の新設」のみのため、実際の呼び出し元への配線はまだ無い。
  // ここでの環境判定・アダプター取得は将来の呼び出し元(Phase 3/4)が
  // 使うための土台であり、姉妹モジュールが未読み込みでも例外を投げるだけで
  // このファイル自体の読み込みは失敗しない。

  const StorageEnvironment = Object.freeze({
    // デスクトップ本体はPython(FastAPI)側で完結するため、JS側からは非対応。
    DESKTOP_LOCAL: 'desktop-local',
    DROPBOX_PERSONAL: 'dropbox-personal',
    DROPBOX_SHARED_WORKSPACE: 'dropbox-shared-workspace',
    BROWSER_LOCAL_INDEXEDDB: 'browser-local-indexeddb',
  });

  const _STORAGE_PERMISSIONS = new Set(['owner', 'editor', 'viewer']);

  function detectStorageEnvironment() {
    // Phase 0監査ノート§1.1の系統C/Dに対応するベストエフォート判定。
    // Dropbox接続済みのCloud静的版・スマホ/タブレットは系統D、
    // File System Access APIのローカル単独アプリは系統C。
    try {
      if (window.MeldexRuntimeAdapter && typeof window.MeldexRuntimeAdapter.isDropboxMode === 'function'
        && window.MeldexRuntimeAdapter.isDropboxMode()) {
        return StorageEnvironment.DROPBOX_PERSONAL;
      }
    } catch { /* 判定に失敗したらローカル既定へフォールバックする */ }
    return StorageEnvironment.BROWSER_LOCAL_INDEXEDDB;
  }

  function _buildAdapter(request) {
    const req = request || {};
    const environment = req.environment || detectStorageEnvironment();
    if (environment === StorageEnvironment.BROWSER_LOCAL_INDEXEDDB) {
      const factory = window.MeldexSystemStorageIndexedDB;
      if (!factory || typeof factory.createLocalBrowserAdapter !== 'function') {
        throw new SystemStorageError('gb-system-storage-indexeddb.js が読み込まれていません');
      }
      return factory.createLocalBrowserAdapter({
        boundary: req.boundary,
        auditSink: req.auditSink,
        preserveConflicts: req.preserveConflicts,
      });
    }
    if (environment === StorageEnvironment.DROPBOX_PERSONAL) {
      const factory = window.MeldexSystemStorageDropbox;
      if (!factory || typeof factory.createPersonalAdapter !== 'function') {
        throw new SystemStorageError('gb-system-storage-dropbox.js が読み込まれていません');
      }
      return factory.createPersonalAdapter({
        accountBoundary: req.accountBoundary,
        auditSink: req.auditSink,
      });
    }
    if (environment === StorageEnvironment.DROPBOX_SHARED_WORKSPACE) {
      const factory = window.MeldexSystemStorageDropbox;
      if (!factory || typeof factory.createSharedWorkspaceAdapter !== 'function') {
        throw new SystemStorageError('gb-system-storage-dropbox.js が読み込まれていません');
      }
      if (!req.workspaceDropboxPath) {
        throw new SystemStorageError('dropbox-shared-workspace環境には workspaceDropboxPath が必要です');
      }
      return factory.createSharedWorkspaceAdapter({
        workspaceDropboxPath: req.workspaceDropboxPath,
        workspaceId: req.workspaceId,
        namespaceKind: req.namespaceKind,
        auditSink: req.auditSink,
      });
    }
    throw new SystemStorageError(`${environment} 用のアダプターはPhase 1b(JS側)の対象外です(デスクトップ本体はPython側で完結します)`);
  }

  function resolveSystemStorageAdapter(request) {
    const req = request || {};
    const permission = String(req.permission || 'editor').trim().toLowerCase();
    if (!_STORAGE_PERMISSIONS.has(permission)) {
      throw new SystemStorageError(`未知の権限です: ${req.permission}`);
    }
    const adapter = _buildAdapter(req);
    return permission === 'viewer' ? new ReadOnlySystemStorageAdapter(adapter) : adapter;
  }

  // --- 公開 --------------------------------------------------------------

  window.MeldexSystemStorage = {
    SystemStorageKind,
    ALL_SYSTEM_STORAGE_KINDS,
    isValidSystemStorageKind,
    kindSubpathSegment,
    sanitizeDocumentId,
    documentRelativePath,
    isForbiddenLegacySegment,
    pathContainsForbiddenLegacySegment,
    CURRENT_SCHEMA_VERSION,
    registerSchemaMigration,
    applySchemaMigrations,
    SystemStorageError,
    SystemStorageNotFoundError,
    SystemStorageCorruptRecordError,
    SystemStorageWriteError,
    SystemStorageQuotaExceededError,
    SystemStorageConflictError,
    DEFAULT_RETENTION_POLICIES,
    retentionPolicyFor,
    checkDocumentSizeQuota,
    checkTotalSizeQuota,
    selectDocumentsExceedingRetention,
    RETENTION_CLEANUP_KINDS,
    runRetentionCleanup,
    nowIso,
    canonicalJsonStringify,
    computeRevision,
    recordToEnvelope,
    envelopeToJsonText,
    recordFromEnvelope,
    recordStorageAuditEvent,
    SystemStorageAdapter,
    ReadOnlySystemStorageAdapter,
    StorageEnvironment,
    detectStorageEnvironment,
    resolveSystemStorageAdapter,
  };
})();
