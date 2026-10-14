/**
 * gb-document-save-coordinator.js
 *
 * 文書単位（安定asset/provider identity。取得前だけ正規化パスへfallback）の
 * 保存を一元管理する共通コーディネーター。
 * 計画書: app/docs/note-editor-regression-performance-conflict-plan-2026-08-01.md
 *   §4.1 gb-document-save-coordinator.js の責務 / §5 工程1
 *
 * 工程1で実装する範囲:
 *   - 保存キー（文書ID相当。現状はノート等が持つ「正規化パス」をそのまま使う）
 *   - editorInstanceId 相当（ここでは呼び出し側が渡す host 参照そのものをキーにする）
 *   - single-flight 保存（同一内容の重複PUTを合流させる）
 *   - 保存中に発生した編集の「最新1件」coalesce（複数の追送を1件へまとめる）
 *   - 保存理由の記録（reason / focusTarget を doc ごとに直近分だけ保持）
 *   - 応答からの baseline 更新は行わない（呼び出し側 = アダプターの責務。
 *     ここでは「どの md を実際に送信したか」を savedMd として結果へ付与し、
 *     coalesce によって古い呼び出し元へ新しい応答が返っても baseline を
 *     巻き戻さないための材料を提供するに留める）
 *   - 文書単位の参加者（participant）登録。同一 documentKey を共有する
 *     複数の編集ホスト（例: メインパネルのノートと詳細パネル内ノート）が
 *     同じ single-flight ロックを共有できるようにする
 *   - clean/dirty/saving の文書単位状態機械。conflict-pending/resolving は
 *     計画書§4.1の「枠」として列挙するのみで、工程1では遷移させない
 *     （実際の競合検知・保留状態への遷移は工程2-Aで実装する）
 *
 * 工程1で実装しない範囲（後続工程に委ねる）:
 *   - 409応答の真偽判定・conflict-pending遷移（工程2-A）
 *   - サーバー側の同一内容409無害化（工程2-B）
 *   - ノート以外の編集面（ボード/シナリオ/CSV等）への配線（工程2-C）
 *   - Desktop/Cloud/スマートフォン間のtransport_revision分離（工程2-D）
 *
 * 工程2-Aで追加した範囲（§5工程2-A項目1〜11）:
 *   - 409（etag_conflict）を受けた文書をCONFLICT_PENDINGへ遷移させ、
 *     待機中のネットワーク保存（追送coalesce分）を破棄する（項目1）。
 *     このタイミング判定は _startSend() の失敗ハンドラ内で同期的に行う
 *     （_maybeFlushPending() による追送より先に確定させるため）。
 *   - 同じ文書が既にCONFLICT_PENDING/RESOLVING中に届いた後追いの409は、
 *     新しい競合世代（generation）を発行せず、既存レコードへ同一世代の
 *     まま統合する（項目2・6・7。「保留」後の再表示ループの根本対策）。
 *   - 保存前に必ずCONFLICT_PENDING/RESOLVING状態を確認し、pending/resolving
 *     中はネットワークPUTを一切開始しない（requestSave/flush内の入口で
 *     ガードする。項目4・5）。
 *   - 「確認する」導線から呼ぶrequestConflictReview()でRESOLVINGへ遷移し、
 *     resolveConflict()は対象の競合世代が一致する場合だけ状態を解除する
 *     （項目7・8）。
 *   - restoreConflict()で再起動/再読込後の状態復元を受け付ける（項目10）。
 *   - 本文そのものはこのモジュールが保持しない。呼び出し側（アダプター）が
 *     ローカルmdへの参照を渡すが、永続化（MeldexSaveSafety経由）は
 *     ハッシュ化した署名のみを保存する（項目3・4.1「本文は記録しない」）。
 *
 * 公開API: window.MeldexDocumentSaveCoordinator
 */
(function () {
  'use strict';
  if (window.MeldexDocumentSaveCoordinator) return;

  // 計画書§4.1「clean/dirty/saving/conflict-pending/resolvingの文書単位状態機械」。
  // conflict-pending/resolvingは工程2-Aから使用する。
  const STATES = Object.freeze({
    CLEAN: 'clean',
    DIRTY: 'dirty',
    SAVING: 'saving',
    CONFLICT_PENDING: 'conflict-pending',
    RESOLVING: 'resolving',
  });

  /** @type {Map<string, DocRecord>} */
  const docs = new Map();
  /** @type {Map<string, string>} path -> stable documentKey */
  const pathAliases = new Map();
  const CONFLICT_STORAGE_KEY = 'meldex-document-save-conflicts-v1';

  /**
   * @typedef {Object} ConflictRecord
   * @property {number} generation 文書の生涯で単調増加する競合世代番号
   * @property {string} localMd ローカルの未保存内容（本文そのもの。コーディネーター内メモリのみ）
   * @property {string} localEtag 競合発生時点でのローカルbaseline etag
   * @property {object|null} serverDetail サーバー409応答のdetail（current_etag/content_hash/document_id/updated_at等）
   * @property {*} focusTarget 競合発生直前にユーザーが移ろうとしていたフォーカス先
   * @property {string} path 表示・再取得用のパス
   * @property {number} pendingSince 最初にpendingへ入った時刻
   * @property {number} lastReportedAt 直近にこの世代へ409が報告された時刻
   */

  /**
   * @typedef {Object} DocRecord
   * @property {string} key
   * @property {string} state
   * @property {Set<any>} participants
   * @property {{md:string, path:string, promise:Promise<any>}|null} inFlight
   * @property {{md:string, path:string, hostRef:any, sendFn:Function}|null} pendingFollowUp
   * @property {Promise<any>|null} followUpPromise
   * @property {{reason:string, focusTarget:any, at:number}|null} lastRequest
   * @property {ConflictRecord|null} conflict
   * @property {number} conflictGenerationSeq
   * @property {string} transportRevision
   */

  function _normalizePath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  }

  // apiPut等が投げるエラーの共通契約（gb-save-safety.js enrichError参照）に基づき、
  // 409/etag_conflictを「本物の競合として扱うべき失敗」と判定する。将来ノート以外の
  // アダプター（工程2-C）が同じエラー契約を共有する前提の、コーディネーター側の
  // 唯一の判定箇所（重複実装を避ける）。
  function _looksLikeConflictError(err) {
    return !!err && (err.status === 409 || err.meldexCode === 'etag_conflict');
  }

  function _readPersistedConflicts() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CONFLICT_STORAGE_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function _writePersistedConflicts(records) {
    try {
      if (Object.keys(records).length) localStorage.setItem(CONFLICT_STORAGE_KEY, JSON.stringify(records));
      else localStorage.removeItem(CONFLICT_STORAGE_KEY);
    } catch {
      // private browsing / storage quota: in-memory safety remains available.
    }
  }

  function _persistableServerDetail(detail) {
    if (!detail || typeof detail !== 'object') return null;
    const out = {};
    [
      'code', 'path', 'expected_etag', 'current_etag', 'content_hash',
      'document_id', 'asset_id', 'provider_id', 'updated_at',
    ].forEach((key) => {
      if (detail[key] != null && typeof detail[key] !== 'object') out[key] = detail[key];
    });
    return Object.keys(out).length ? out : null;
  }

  function _persistConflict(doc) {
    if (!doc?.key) return;
    const records = _readPersistedConflicts();
    if (!doc.conflict) {
      delete records[doc.key];
      _writePersistedConflicts(records);
      return;
    }
    records[doc.key] = {
      generation: doc.conflict.generation,
      localEtag: doc.conflict.localEtag || '',
      serverDetail: _persistableServerDetail(doc.conflict.serverDetail),
      path: doc.conflict.path || '',
      pendingSince: doc.conflict.pendingSince || Date.now(),
      lastReportedAt: doc.conflict.lastReportedAt || Date.now(),
      state: STATES.CONFLICT_PENDING,
    };
    _writePersistedConflicts(records);
  }

  function _restorePersistedConflict(doc) {
    const record = _readPersistedConflicts()[doc.key];
    if (!record || record.state !== STATES.CONFLICT_PENDING) return;
    const generation = Math.max(1, Number(record.generation) || 1);
    doc.conflictGenerationSeq = Math.max(doc.conflictGenerationSeq, generation);
    doc.conflict = {
      generation,
      localMd: '',
      localEtag: record.localEtag || '',
      serverDetail: record.serverDetail || null,
      focusTarget: null,
      path: record.path || doc.key,
      pendingSince: record.pendingSince || Date.now(),
      lastReportedAt: record.lastReportedAt || Date.now(),
    };
    doc.state = STATES.CONFLICT_PENDING;
  }

  function _stableDocumentKey(path, identity) {
    const info = identity && typeof identity === 'object' ? identity : {};
    const explicit = String(
      info.document_key || info.documentKey || (typeof identity === 'string' ? identity : ''),
    ).trim();
    if (explicit) return explicit;
    const documentId = String(info.document_id || info.documentId || '').trim();
    if (documentId) return `document:${documentId}`;
    const assetId = String(info.asset_id || info.assetId || '').trim();
    if (assetId) return `asset:${assetId}`;
    const providerId = String(info.provider_id || info.providerId || '').trim();
    if (providerId) return `dropbox-item:${providerId}`;
    return _normalizePath(path);
  }

  function _mergeDocRecords(target, source) {
    if (!source || source === target) return target;
    source.participants.forEach((participant) => target.participants.add(participant));
    target.conflictGenerationSeq = Math.max(target.conflictGenerationSeq, source.conflictGenerationSeq);
    if (!target.conflict || (
      source.conflict && Number(source.conflict.lastReportedAt || 0) > Number(target.conflict.lastReportedAt || 0)
    )) target.conflict = source.conflict;
    if (!target.lastRequest || (
      source.lastRequest && Number(source.lastRequest.at || 0) > Number(target.lastRequest.at || 0)
    )) target.lastRequest = source.lastRequest;
    if (!target.transportRevision) target.transportRevision = source.transportRevision || '';
    if (!target.inFlight && source.inFlight) {
      target.inFlight = source.inFlight;
      target.pendingFollowUp = source.pendingFollowUp;
      target.followUpPromise = source.followUpPromise;
      target.state = source.state;
    } else if (target.conflict) {
      target.state = source.state === STATES.RESOLVING ? STATES.RESOLVING : STATES.CONFLICT_PENDING;
    }
    return target;
  }

  function _syncParticipantDocumentKeys(doc, documentKey) {
    doc?.participants?.forEach?.((participant) => {
      if (participant?.dataset) participant.dataset.documentKey = documentKey;
    });
  }

  function _consolidateDocumentKey(candidateKey, canonicalKey) {
    const candidate = String(candidateKey || '');
    const canonical = String(canonicalKey || candidate);
    if (!candidate || !canonical || candidate === canonical) return canonical;
    const source = docs.get(candidate);
    const target = docs.get(canonical);
    let merged = target || source;
    if (source) {
      if (target && target !== source) merged = _mergeDocRecords(target, source);
      merged.key = canonical;
      docs.set(canonical, merged);
      docs.delete(candidate);
      _syncParticipantDocumentKeys(merged, canonical);
    }
    pathAliases.forEach((value, path) => {
      if (value === candidate) pathAliases.set(path, canonical);
    });
    const records = _readPersistedConflicts();
    if (records[candidate]) {
      if (!records[canonical] || (
        Number(records[candidate].lastReportedAt || 0)
          > Number(records[canonical].lastReportedAt || 0)
      )) records[canonical] = records[candidate];
      delete records[candidate];
      _writePersistedConflicts(records);
    }
    return canonical;
  }

  function _canonicalKeyForRequest(candidateKey, path) {
    const normalizedPath = _normalizePath(path);
    if (!normalizedPath) return String(candidateKey || '');
    const mapped = pathAliases.get(normalizedPath);
    if (mapped) return _consolidateDocumentKey(candidateKey, mapped);
    const candidate = String(candidateKey || '');
    if (candidate && candidate !== normalizedPath) {
      pathAliases.set(normalizedPath, candidate);
      return candidate;
    }
    return normalizedPath;
  }

  function bindDocumentIdentity(path, identity) {
    const normalizedPath = _normalizePath(path);
    if (!normalizedPath) return '';
    const previousKey = pathAliases.get(normalizedPath) || normalizedPath;
    const stableKey = _stableDocumentKey(normalizedPath, identity);
    pathAliases.set(normalizedPath, stableKey);

    if (previousKey !== stableKey) _consolidateDocumentKey(previousKey, stableKey);

    const doc = _doc(stableKey);
    _syncParticipantDocumentKeys(doc, stableKey);
    // 読込応答より先にパス仮キーの空レコードが作られていた場合でも、
    // 安定IDキーで永続化されている保留競合を取りこぼさない。
    if (!doc.conflict) _restorePersistedConflict(doc);
    const revision = identity && typeof identity === 'object'
      ? (identity.transport_revision || identity.transportRevision || '')
      : '';
    if (revision) doc.transportRevision = normalizeTransportRevision(currentTransportName(), revision);
    return stableKey;
  }

  function rebindDocumentPath(oldPath, newPath, identity) {
    const oldNormalized = _normalizePath(oldPath);
    const oldKey = pathAliases.get(oldNormalized) || oldNormalized;
    const nextIdentity = identity || { document_key: oldKey };
    const nextKey = bindDocumentIdentity(newPath, nextIdentity);
    if (oldNormalized) pathAliases.set(oldNormalized, nextKey);
    return nextKey;
  }

  function rebindDocumentPathPrefix(oldPath, newPath) {
    const oldNormalized = _normalizePath(oldPath);
    const newNormalized = _normalizePath(newPath);
    if (!oldNormalized || !newNormalized || oldNormalized === newNormalized) return 0;
    const oldPrefix = oldNormalized + '/';
    let rebound = 0;
    Array.from(pathAliases.entries()).forEach(([path, documentKey]) => {
      if (path !== oldNormalized && !path.startsWith(oldPrefix)) return;
      const suffix = path === oldNormalized ? '' : path.slice(oldNormalized.length);
      pathAliases.set(newNormalized + suffix, documentKey);
      // 旧パスは遅延中応答や既存ホストが参照する可能性があるためaliasを残す。
      rebound += 1;
    });

    // asset/provider identityを取得できない外部Markdown等は正規化path自体が
    // documentKeyになる。folder move後もdocsと永続競合キーを新prefixへ実移管し、
    // 再起動後に旧パス側へ保留状態が孤立しないようにする。
    const fallbackKeys = new Set([
      ...Array.from(docs.keys()),
      ...Object.keys(_readPersistedConflicts()),
    ].filter(key => key === oldNormalized || key.startsWith(oldPrefix)));
    const persisted = _readPersistedConflicts();
    fallbackKeys.forEach((oldKey) => {
      const suffix = oldKey === oldNormalized ? '' : oldKey.slice(oldNormalized.length);
      const newKey = newNormalized + suffix;
      const oldDoc = docs.get(oldKey);
      if (oldDoc) {
        const existing = docs.get(newKey);
        const moved = existing && existing !== oldDoc ? _mergeDocRecords(existing, oldDoc) : oldDoc;
        moved.key = newKey;
        if (moved.conflict?.path === oldKey || moved.conflict?.path?.startsWith?.(oldPrefix)) {
          moved.conflict.path = newNormalized + moved.conflict.path.slice(oldNormalized.length);
        }
        docs.set(newKey, moved);
        docs.delete(oldKey);
      }
      if (persisted[oldKey]) {
        const record = { ...persisted[oldKey] };
        if (record.path === oldKey || record.path?.startsWith?.(oldPrefix)) {
          record.path = newNormalized + record.path.slice(oldNormalized.length);
        }
        if (!persisted[newKey]) persisted[newKey] = record;
        delete persisted[oldKey];
      }
      pathAliases.set(oldKey, newKey);
      pathAliases.set(newKey, newKey);
      rebound += 1;
    });
    _writePersistedConflicts(persisted);
    return rebound;
  }

  function documentKeyForPath(path, identity) {
    if (identity) return bindDocumentIdentity(path, identity);
    const normalized = _normalizePath(path);
    return pathAliases.get(normalized) || normalized;
  }

  // ==========================================================
  // 工程2-D項目2: transport adapter契約。
  // 計画書§2.8「document_idは環境をまたぐ文書識別子、transport_revisionは
  // 保存経路内だけで有効な不透明token…と役割を分ける。ローカルetagと
  // Dropbox revを文字列比較したり、一方を他方のif-matchへ流用したりしない」。
  //
  // Desktop（Python FastAPIサーバー経由の/api/file。meldex_file_safety.file_etag）
  // とCloud/スマートフォン（gb-storage-adapter.jsのDropbox rev/content_hash）は
  // 別々のプロセス/デプロイであるため、同一トークンが実行時に混ざることは
  // 通常無い。それでも将来、gb-document-save-coordinator.js/
  // gb-note-save-adapter.jsのような環境をまたいで共有されるコード（同じ
  // ConflictRecordの型を両環境で使う等）が、名前空間の異なるtokenを誤って
  // 比較・流用しないよう、ここで「不透明tokenへの名前空間付与」と
  // 「異なるtransportの比較を拒否する実行時ガード」を提供する。
  // ==========================================================
  const TRANSPORT_LOCAL_FS = 'local-etag';
  const TRANSPORT_BROWSER = 'browser-local';
  const TRANSPORT_DROPBOX = 'dropbox-rev';

  // 現在の実行環境から transport 名を判定する。Cloud/スマートフォン
  // /Windows単独版のDropbox直接書込経路は runtime adapter が
  // isDropboxMode()/isStandaloneCloud() 相当を提供する。判定できない場合は
  // Desktopサーバー経由（既定の/api/file）とみなす。
  function currentTransportName() {
    const runtime = window.MeldexRuntimeAdapter;
    if (runtime && typeof runtime.isDropboxMode === 'function' && runtime.isDropboxMode()) return TRANSPORT_DROPBOX;
    if (runtime && typeof runtime.isBrowserMode === 'function' && runtime.isBrowserMode()) return TRANSPORT_BROWSER;
    if (typeof document !== 'undefined' && document?.documentElement?.hasAttribute?.('data-standalone-cloud')) return TRANSPORT_DROPBOX;
    return TRANSPORT_LOCAL_FS;
  }

  // 既に名前空間付きのtokenはそのまま返す（二重ラップしない）。空文字は
  // そのまま空文字（未取得状態はtransportを問わず同じ意味を持つため）。
  function wrapTransportRevision(transport, token) {
    const raw = String(token || '');
    if (!raw) return '';
    if (raw.includes(':') && (
      raw.startsWith(TRANSPORT_LOCAL_FS + ':')
      || raw.startsWith(TRANSPORT_BROWSER + ':')
      || raw.startsWith(TRANSPORT_DROPBOX + ':')
    )) {
      return raw;
    }
    const ns = transport === TRANSPORT_DROPBOX
      ? TRANSPORT_DROPBOX
      : transport === TRANSPORT_BROWSER ? TRANSPORT_BROWSER : TRANSPORT_LOCAL_FS;
    return `${ns}:${raw}`;
  }

  function transportOfRevision(wrapped) {
    const raw = String(wrapped || '');
    if (raw.startsWith(TRANSPORT_DROPBOX + ':')) return TRANSPORT_DROPBOX;
    if (raw.startsWith(TRANSPORT_BROWSER + ':')) return TRANSPORT_BROWSER;
    if (raw.startsWith(TRANSPORT_LOCAL_FS + ':')) return TRANSPORT_LOCAL_FS;
    return '';
  }

  // 名前空間を剥がした素のtoken（サーバー/Dropboxへ実際に送る値）を返す。
  function unwrapTransportRevision(wrapped) {
    const raw = String(wrapped || '');
    const transport = transportOfRevision(raw);
    return transport ? raw.slice(transport.length + 1) : raw;
  }

  // 異なるtransportのtokenを比較・代用しようとした場合に例外を投げる実行時
  // ガード（計画書§5工程2-D項目2「実行時ガードで禁止する」）。どちらかが
  // 空文字/未ラップ（transport不明）の場合は判定不能として許容する
  // （既存の素のetag文字列を扱う既存コードとの後方互換のため）。
  function assertSameTransportRevision(a, b) {
    const ta = transportOfRevision(a);
    const tb = transportOfRevision(b);
    if (ta && tb && ta !== tb) {
      throw new Error(`MeldexDocumentSaveCoordinator: 異なる保存経路のrevisionを比較しようとしました（${ta} vs ${tb}）`);
    }
  }

  function normalizeTransportRevision(transport, revision) {
    if (revision && typeof revision === 'object') {
      return wrapTransportRevision(
        revision.transport || revision.kind || transport,
        revision.token || revision.revision || revision.etag || '',
      );
    }
    const raw = String(revision || '');
    return transportOfRevision(raw) ? raw : wrapTransportRevision(transport, raw);
  }

  // 実保存経路から必ず通す送信直前ガード。名前空間付きrevisionが現在の
  // transportと一致することをassertSameTransportRevision()で検査した後にだけ、
  // API/Dropboxへ渡せる素のtokenを返す。
  function revisionTokenForWrite(revision, expectedTransport) {
    if (!revision) return '';
    const transport = expectedTransport || currentTransportName();
    const wrapped = normalizeTransportRevision(transport, revision);
    assertSameTransportRevision(wrapped, wrapTransportRevision(transport, '__transport_guard__'));
    return unwrapTransportRevision(wrapped);
  }

  function _doc(documentKey) {
    let doc = docs.get(documentKey);
    if (!doc) {
      doc = {
        key: documentKey,
        state: STATES.CLEAN,
        participants: new Set(),
        inFlight: null,
        pendingFollowUp: null,
        followUpPromise: null,
        lastRequest: null,
        conflict: null,
        conflictGenerationSeq: 0,
        transportRevision: '',
      };
      docs.set(documentKey, doc);
      _restorePersistedConflict(doc);
    }
    return doc;
  }

  function registerParticipant(documentKey, hostRef) {
    if (!documentKey || !hostRef) return;
    _doc(documentKey).participants.add(hostRef);
  }

  function unregisterParticipant(documentKey, hostRef) {
    const doc = docs.get(documentKey);
    if (!doc) return;
    doc.participants.delete(hostRef);
  }

  function getParticipants(documentKey) {
    const doc = docs.get(documentKey);
    return doc ? Array.from(doc.participants) : [];
  }

  function getState(documentKey) {
    const doc = docs.get(documentKey);
    return doc ? doc.state : STATES.CLEAN;
  }

  function isSaving(documentKey) {
    const doc = docs.get(documentKey);
    return !!(doc && doc.inFlight);
  }

  // 「保存理由（入力停止、blurと移動先、タブ切替、終了前）の記録」（計画書§4.1）。
  // 直近1件だけを保持する軽量な記録に留める（永続化・履歴一覧化はスコープ外）。
  function markDirty(documentKey, hostRef, opts) {
    if (!documentKey) return;
    const doc = _doc(documentKey);
    if (hostRef) doc.participants.add(hostRef);
    if (doc.state !== STATES.SAVING) doc.state = STATES.DIRTY;
    doc.lastRequest = {
      reason: (opts && opts.reason) || 'edit',
      focusTarget: (opts && opts.focusTarget) || null,
      at: Date.now(),
    };
  }

  function _finishInFlight(doc, promiseRef) {
    if (doc.inFlight && doc.inFlight.promise === promiseRef) {
      doc.inFlight = null;
    }
    if (!doc.inFlight && !doc.pendingFollowUp && doc.state !== STATES.CONFLICT_PENDING && doc.state !== STATES.RESOLVING) {
      doc.state = STATES.CLEAN;
    }
  }

  function _startSend(doc, hostRef, path, md, sendFn, previousResult) {
    doc.state = STATES.SAVING;
    doc.participants.add(hostRef);
    // 同じ文書キュー内の追送だけは直前の成功応答を渡し、CAS revisionを
    // R0→R1へ連鎖させる。path/contentは各requestSave呼出時の固定値を維持する。
    const promise = Promise.resolve().then(() => sendFn(previousResult || null)).then(
      (res) => {
        _finishInFlight(doc, promise);
        _maybeFlushPending(doc, res, hostRef);
        return Object.assign({}, res, { savedMd: md, savedPath: path, joined: false });
      },
      (err) => {
        _finishInFlight(doc, promise);
        if (_looksLikeConflictError(err)) {
          // 工程2-A項目1: 409を受けた文書をconflict-pendingへ遷移させ、待機中の
          // ネットワーク保存（追送coalesce分）を破棄する。_maybeFlushPendingを
          // 呼ばず、この時点でpendingFollowUpを確実に捨てる（呼び出し元の
          // reportConflict()より前に、同期的にここで確定させる必要がある —
          // でないと_maybeFlushPendingが古いetagのまま2本目を送ってしまう）。
          doc.pendingFollowUp = null;
          doc.followUpPromise = null;
          doc.state = STATES.CONFLICT_PENDING;
        } else {
          _maybeFlushPending(doc);
        }
        throw err;
      },
    );
    doc.inFlight = { md, path, promise };
    return promise;
  }

  // 保存中に発生した編集を最新1件へcoalesceする（計画書§5工程1-2・工程1-6）。
  // 同時に複数回 requestSave が呼ばれても、進行中の保存が終わった直後に
  // 実行されるのは「最後に上書きされた1件」だけになる。
  function _maybeFlushPending(doc, previousResult, previousHostRef) {
    if (!doc.pendingFollowUp || doc.inFlight) return;
    const pending = doc.pendingFollowUp;
    doc.pendingFollowUp = null;
    doc.followUpPromise = null;
    // 直前の成功revisionを連鎖できるのは、同じ編集hostから来た連続編集だけ。
    // 別ペインは同じdocumentKeyでも独立した読込baselineを持つため、先行hostの
    // revisionを渡すと古い全文が最新revision付きで保存され、409を迂回してしまう。
    const chainedResult = previousHostRef && pending.hostRef === previousHostRef
      ? previousResult
      : null;
    _startSend(doc, pending.hostRef, pending.path, pending.md, pending.sendFn, chainedResult);
  }

  /**
   * 文書単位の保存を要求する（single-flight + coalesce）。
   *
   * - 進行中の保存が無ければ即座に送信する。
   * - 進行中の保存と「送信しようとしている内容」が完全一致するなら、
   *   2本目のPUTを発生させず進行中のPromiseへ合流する（計画書§5工程1-5）。
   * - 進行中の保存と内容が異なるなら、進行中の保存の完了を待ってから
   *   最新1件だけを追送する（同時に複数回呼ばれても追送は1件にcoalesceされる）。
   *
   * @param {string} documentKey 保存キー（正規化パス）
   * @param {*} hostRef 編集ホスト参照（アダプターが用意するDOM要素等。同一性比較にのみ使う）
   * @param {string} path サーバーへ送るパス（documentKeyの元になった値。表示用途にも使う）
   * @param {string} md 保存しようとしている内容（アダプターが直列化済みのもの）
   * @param {() => Promise<any>} sendFn 実際にネットワーク送信を行う関数（アダプターが提供）
   * @param {{reason?:string, focusTarget?:*}} [opts]
   * @returns {Promise<any>} 応答（savedMd/savedPath/joinedを付加したもの）
   */
  function requestSave(documentKey, hostRef, path, md, sendFn, opts) {
    if (!documentKey || typeof sendFn !== 'function') {
      return Promise.reject(new Error('MeldexDocumentSaveCoordinator.requestSave: documentKey/sendFn is required'));
    }
    documentKey = _canonicalKeyForRequest(documentKey, path);
    const doc = _doc(documentKey);
    doc.participants.add(hostRef);
    if (hostRef?.dataset) hostRef.dataset.documentKey = documentKey;
    doc.lastRequest = {
      reason: (opts && opts.reason) || 'save',
      focusTarget: (opts && opts.focusTarget) || null,
      at: Date.now(),
    };

    if (doc.state === STATES.CONFLICT_PENDING || doc.state === STATES.RESOLVING) {
      // 工程2-A項目4・5: 保存前に競合状態を必ず確認し、conflict-pending/resolving
      // 中はネットワークPUTを一切開始しない。ローカルrevision・IndexedDBドラフトは
      // 呼び出し側（アダプター）が別経路で継続更新するため、ここでは何も送らず
      // 「保留中でスキップした」ことだけを呼び出し元へ返す。
      return Promise.resolve({ ok: true, skipped: true, conflictPending: true, savedPath: path });
    }

    if (!doc.inFlight) {
      return _startSend(doc, hostRef, path, md, sendFn, null);
    }

    if (doc.inFlight.md === md && doc.inFlight.path === path) {
      // 同一内容の保存が既に進行中 → 2本目を送らず合流する。
      return doc.inFlight.promise.then((res) => Object.assign({}, res, { joined: true }));
    }

    // 内容が異なる → 「最新1件」スロットを上書きし、既存の待機者は同じPromiseへ合流する。
    doc.pendingFollowUp = { md, path, hostRef, sendFn };
    if (!doc.followUpPromise) {
      doc.followUpPromise = doc.inFlight.promise.catch(() => {}).then(() => {
        doc.followUpPromise = null;
        _maybeFlushPending(doc);
        // _maybeFlushPending は pendingFollowUp を doc.inFlight へ差し替えるだけなので、
        // ここで最終的な結果を待つには「今の doc.inFlight」を参照する必要がある。
        if (doc.inFlight) return doc.inFlight.promise;
        // 修正1（データ消失バグ）: doc.inFlight が立っていない＝_maybeFlushPending が
        // 何もflushしなかったことを意味する。この分岐に到達する経路は実質1つだけ:
        // 進行中の保存（R1）が409で失敗し、_startSendの失敗ハンドラが
        // doc.pendingFollowUp/doc.followUpPromise を同期的に破棄した場合
        // （このcoalesce済み追送＝この呼び出し元が待っていた「最新の追送」自体が
        // 送信されずに捨てられたということ）。
        // 従来はここで無条件に undefined を返しており、待機していた呼び出し元
        // （gb-note-save-adapter.js performSave等）は「res.savedMd/etagが無い
        // だけの成功応答」と誤認して baseline（lastSavedEtag）を空文字で上書きし、
        // MeldexDraftRecovery.markSynced() でIndexedDBドラフトまで削除していた。
        // 結果、追送しようとしていた内容がサーバーにもドラフトにも残らず完全消失する
        // （Node再現済み。app/tests/test_meldex_document_save_coordinator.py
        // DocumentSaveCoordinatorConflictPendingTests
        // .test_conflict_discarded_followup_does_not_resolve_as_silent_success）。
        // 既存の「conflict-pending中はネットワーク送信をスキップした」時の
        // 戻り値（requestSave冒頭の早期returnと同じ形）に揃えて返すことで、
        // 呼び出し元の `if (res && res.conflictPending) return res;` 系の
        // 既存ガードにそのまま乗せる（新しい分岐を呼び出し元へ増やさない）。
        if (doc.state === STATES.CONFLICT_PENDING || doc.state === STATES.RESOLVING) {
          return { ok: true, skipped: true, conflictPending: true, discarded: true, savedPath: path };
        }
        return undefined;
      });
    }
    const waitFor = doc.followUpPromise;
    return waitFor.then((res) => (res ? Object.assign({}, res, { coalesced: true }) : res));
  }

  // 計画書§5工程1-8「blur、タブ切替、閉じる操作は、新規の競合保存を起こさず
  // 進行中処理を待って最新revisionをflushする」に対応する別名エントリ。
  // 実装上の機構は requestSave と同一（single-flight/coalesceを共有する）。
  function flush(documentKey, hostRef, path, md, sendFn, opts) {
    return requestSave(documentKey, hostRef, path, md, sendFn, Object.assign({}, opts, { reason: (opts && opts.reason) || 'flush' }));
  }

  function _debugSnapshot(documentKey) {
    const doc = docs.get(documentKey);
    if (!doc) return null;
    return {
      key: doc.key,
      state: doc.state,
      participantCount: doc.participants.size,
      saving: !!doc.inFlight,
      hasPending: !!doc.pendingFollowUp,
      lastRequest: doc.lastRequest,
      conflict: doc.conflict,
    };
  }

  function isConflictPending(documentKey) {
    const doc = docs.get(documentKey);
    return !!doc && (doc.state === STATES.CONFLICT_PENDING || doc.state === STATES.RESOLVING);
  }

  function getConflict(documentKey) {
    const doc = docs.get(documentKey);
    return doc ? doc.conflict : null;
  }

  function getLastRequest(documentKey) {
    const doc = docs.get(documentKey);
    return doc ? doc.lastRequest : null;
  }

  /**
   * 409（本物/自己起因の別なし）を報告する。文書が既にCONFLICT_PENDING/RESOLVING
   * 中であれば、同じ競合世代へ統合するだけで新しい世代を発行しない
   * （計画書§5工程2-A項目2「同じ文書ID・同じ競合世代のパネルを再表示しない」）。
   *
   * @returns {{generation:number, isNew:boolean, record:ConflictRecord}}
   *   isNew=true のときだけ、呼び出し側は競合ダイアログを新規に開いてよい。
   */
  function reportConflict(documentKey, info) {
    const doc = _doc(documentKey);
    // 待機中の追送も念のためここで再度破棄する（_startSendの失敗ハンドラで
    // 既に破棄済みだが、reportConflictが直接呼ばれる経路にも同じ保証を持たせる）。
    doc.pendingFollowUp = null;
    doc.followUpPromise = null;
    const opts = info || {};
    if (doc.conflict) {
      doc.conflict.localMd = opts.localMd != null ? opts.localMd : doc.conflict.localMd;
      doc.conflict.localEtag = opts.localEtag || doc.conflict.localEtag;
      doc.conflict.serverDetail = opts.serverDetail || doc.conflict.serverDetail;
      doc.conflict.lastReportedAt = Date.now();
      if (doc.state !== STATES.RESOLVING) doc.state = STATES.CONFLICT_PENDING;
      _persistConflict(doc);
      return { generation: doc.conflict.generation, isNew: false, record: doc.conflict };
    }
    doc.conflictGenerationSeq += 1;
    doc.conflict = {
      generation: doc.conflictGenerationSeq,
      localMd: opts.localMd || '',
      localEtag: opts.localEtag || '',
      serverDetail: opts.serverDetail || null,
      focusTarget: opts.focusTarget || null,
      path: opts.path || documentKey,
      pendingSince: Date.now(),
      lastReportedAt: Date.now(),
    };
    doc.state = STATES.CONFLICT_PENDING;
    _persistConflict(doc);
    return { generation: doc.conflict.generation, isNew: true, record: doc.conflict };
  }

  // 「確認する」導線から呼ぶ。RESOLVINGへ遷移し、現在の競合レコードを返す
  // （呼び出し側はこれを使って最新版を再取得し、競合パネルを1回だけ開く。項目7）。
  function requestConflictReview(documentKey) {
    const doc = docs.get(documentKey);
    if (!doc || !doc.conflict) return null;
    // 同じ競合に対する確認処理を二重起動しない。複数のバナー/パネルや
    // 連打から同時に上書き・再読込が走ると、遅れて完了した方が新しい表示を
    // 巻き戻し得る。保留時は呼び出し側が restoreConflict() で
    // CONFLICT_PENDING へ戻してから、改めて確認できるようにする。
    if (doc.state === STATES.RESOLVING) return null;
    doc.state = STATES.RESOLVING;
    return doc.conflict;
  }

  // 上書き/再読込/別名保存の成功時、または正規化内容一致による自動解決時に呼ぶ。
  // generationを渡した場合、現在の競合世代と一致する時だけ解除する
  // （計画書§5工程2-A項目8「対象文書IDと競合世代が一致する場合だけ競合状態を解除する。
  // 無関係な保存成功で解除しない」）。
  function resolveConflict(documentKey, generation) {
    const doc = docs.get(documentKey);
    if (!doc || !doc.conflict) return false;
    if (generation != null && doc.conflict.generation !== generation) return false;
    doc.conflict = null;
    doc.state = doc.inFlight ? STATES.SAVING : STATES.CLEAN;
    _persistConflict(doc);
    return true;
  }

  // 再起動/再読込後の状態復元（計画書§5工程2-A項目10）。永続化された記録から
  // メモリ上の状態を再構築するだけで、競合パネルは開かない（呼び出し側が
  // 「競合を保留中」の非モーダル表示だけを出す）。
  function restoreConflict(documentKey, record) {
    if (!documentKey || !record) return null;
    const doc = _doc(documentKey);
    const generation = Number(record.generation) || 1;
    doc.conflictGenerationSeq = Math.max(doc.conflictGenerationSeq, generation);
    doc.conflict = {
      generation,
      localMd: record.localMd || '',
      localEtag: record.localEtag || '',
      serverDetail: record.serverDetail || null,
      focusTarget: record.focusTarget || null,
      path: record.path || documentKey,
      pendingSince: record.pendingSince || Date.now(),
      lastReportedAt: Date.now(),
    };
    doc.state = STATES.CONFLICT_PENDING;
    _persistConflict(doc);
    return doc.conflict;
  }

  window.MeldexDocumentSaveCoordinator = {
    STATES,
    documentKeyForPath,
    bindDocumentIdentity,
    rebindDocumentPath,
    rebindDocumentPathPrefix,
    currentTransportName,
    wrapTransportRevision,
    unwrapTransportRevision,
    transportOfRevision,
    assertSameTransportRevision,
    normalizeTransportRevision,
    revisionTokenForWrite,
    registerParticipant,
    unregisterParticipant,
    getParticipants,
    getState,
    isSaving,
    isConflictPending,
    getConflict,
    getLastRequest,
    reportConflict,
    requestConflictReview,
    resolveConflict,
    restoreConflict,
    markDirty,
    requestSave,
    flush,
    _debugSnapshot,
  };
})();
