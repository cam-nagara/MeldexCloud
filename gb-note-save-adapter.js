/**
 * gb-note-save-adapter.js
 *
 * ノート固有のDOM→Markdown変換・フォーカス制御を、共通の
 * gb-document-save-coordinator.js への「アダプター」として分離する。
 * 計画書: app/docs/note-editor-regression-performance-conflict-plan-2026-08-01.md
 *   §4.1（アダプター契約） / §5 工程1
 *
 * 対象ホスト（工程1時点）:
 *   - メインパネルのノート本文（#page-content）
 *   - 詳細パネル内ノート（#dp-editable。gb-detail-panel.part03.js）
 * どちらも「path / frontmatter / lastSavedMd / lastSavedEtag を dataset に持つ
 * contenteditable要素」という同じ形をしているため、同一のアダプターで扱える。
 *
 * 実際のDOM→Markdown変換自体（_noteMarkdownFromEditor 等）は
 * gb-editor.part01.part01.js に残したままグローバル関数として呼び出す
 * （工程0の固定テスト群がこれらの関数の所在・実装を直接検証しているため、
 * 物理的な移設は行わず、委譲先として呼び出す形に留める）。
 *
 * 公開API: window.MeldexNoteSaveAdapter
 */
(function () {
  'use strict';
  if (window.MeldexNoteSaveAdapter) return;

  function _coordinator() {
    return window.MeldexDocumentSaveCoordinator;
  }

  // 修正7: 再起動/再読込後に restorePendingConflictIfAny() で復元された競合
  // （record.localMd が必ず空文字になるケース）を識別するための文書キー集合。
  // 復元時点ではコーディネーター側に「比較対象となる本当の未保存内容」を
  // 持たせられない（本文はメモリのみ保持する設計＝再起動で失われる。実際の
  // 未保存編集はドラフト復元系 MeldexDraftRecovery 側に別途隔離されている）。
  // 完全な統合（復元時にドラフト内容を引き当てて localMd として渡す）は
  // 将来課題とし、ここでは「サーバー再読込済み内容へフォールバックした値を
  // 本当の未保存内容であるかのように自動一致判定してしまう」誤爆だけを防ぐ。
  const _restoredConflictDocKeys = new Set();

  function documentKeyForPath(path) {
    const coordinator = _coordinator();
    return coordinator ? coordinator.documentKeyForPath(path) : String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  }

  function bindHostIdentity(hostEl, path, identity) {
    const coordinator = _coordinator();
    if (!coordinator || !path) return documentKeyForPath(path);
    const info = identity && typeof identity === 'object' ? identity : {};
    const documentKey = coordinator.bindDocumentIdentity?.(path, info)
      || coordinator.documentKeyForPath(path);
    if (hostEl?.dataset) {
      hostEl.dataset.documentKey = documentKey;
      if (info.asset_id || info.assetId) hostEl.dataset.assetId = String(info.asset_id || info.assetId);
      if (info.provider_id || info.providerId) hostEl.dataset.providerId = String(info.provider_id || info.providerId);
      const revision = info.transport_revision || info.transportRevision || info.etag || '';
      if (revision && coordinator.normalizeTransportRevision) {
        hostEl.dataset.lastSavedTransportRevision = coordinator.normalizeTransportRevision(
          coordinator.currentTransportName(),
          revision,
        );
      }
    }
    return documentKey;
  }

  // ノート本文の直列化（DOM→Markdown）。既存のグローバル関数へ委譲する。
  function serialize(hostEl) {
    return typeof window._noteMarkdownFromEditor === 'function'
      ? window._noteMarkdownFromEditor(hostEl)
      : '';
  }

  // 「未変更」判定: 直列化結果が自ホストの保存済みbaselineと完全一致するか。
  // 計画書§5工程1-4「現在revisionが保存済みbaselineと同じなら、blur時にMarkdown
  // 再変換、PUT、etag更新、履歴追加を一切行わない」の判定に使う。
  function isUnchanged(hostEl, md) {
    const prevSaved = (hostEl && hostEl.dataset && hostEl.dataset.lastSavedMd) || '';
    return md === prevSaved;
  }

  // 文書単位のarbiterへ「このホストは今この文書を表示している」ことだけを
  // 登録する（保存は起こさない）。パネルを開いた直後、まだ未編集の段階から
  // 登録しておくことで、他ホストの保存成功時にbaselineへ追従できるようにする
  // （計画書§5工程1-9・工程1-10）。
  function registerHost(hostEl, path) {
    const coordinator = _coordinator();
    if (!coordinator || !hostEl || !path) return;
    coordinator.registerParticipant(bindHostIdentity(hostEl, path, hostEl.dataset || {}), hostEl);
  }

  // ============================================================
  // 工程2-A: 「保留」を文書単位の競合状態へ接続する
  // 計画書§2.6・§5工程2-A（app/docs/note-editor-regression-performance-
  // conflict-plan-2026-08-01.md）
  // ============================================================

  function _safety() {
    return window.MeldexSaveSafety;
  }

  function _isElementUsableForFocus(el) {
    if (!el || !el.isConnected) return false;
    if (el.disabled) return false;
    if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false;
    return true;
  }

  // 409を受けた時、保存コーディネーターへ競合を報告する。同じ文書が既に
  // conflict-pending/resolving中であれば新しい世代を発行せず、既存の競合へ
  // 統合する（isNew:false）。呼び出し側（gb-editor.part01.part01.jsの
  // _handleNoteSaveFailure）はisNewの時だけ競合ダイアログを新規に開く
  // （計画書§5工程2-A項目2・6・7、§5工程2-B項目5〜7の「自己起因の古い応答」
  // 「同一文書ID・同じ競合世代への複数の409を1件へまとめる」に対応する）。
  //
  // MeldexSaveSafetyへの記録はここへ一本化する（呼び出し元がmarkConflictを
  // 別途呼ばないこと）。markConflict()は記録を丸ごと上書きするため、
  // recordConflictState()と両方呼ぶと拡張フィールド（pendingSince等）が
  // 呼ばれるたびにリセットされてしまう。コーディネーター未ロード時だけ、
  // 従来のpath-only記録へフォールバックする。
  function reportSaveFailureConflict(hostEl, path, md, error) {
    const coordinator = _coordinator();
    const safetyDetail = (error && (error.meldexMessage || error.message)) || '保存競合';
    if (!coordinator) {
      _safety()?.markConflict?.(path, safetyDetail);
      return null;
    }
    const documentKey = documentKeyForPath(path);
    // 修正7: ここは実際のライブ編集内容（md）を伴う本物の409報告なので、
    // 復元プレースホルダー扱い（自動一致判定スキップ）を解除する。
    _restoredConflictDocKeys.delete(documentKey);
    const lastRequest = coordinator.getLastRequest ? coordinator.getLastRequest(documentKey) : null;
    const detail = (error && error.meldexDetail && typeof error.meldexDetail === 'object') ? error.meldexDetail : null;
    const rawLocalEtag = (hostEl && hostEl.dataset && (
      hostEl.dataset.lastSavedTransportRevision || hostEl.dataset.lastSavedEtag
    )) || '';
    // 工程2-D項目2: 記録するetagを、現在の実行環境（Desktopサーバー経由 or
    // Cloud/スマホDropbox直接）で名前空間付けする。異なるtransportのtokenを
    // 誤って比較・流用しないための実行時ガード対象にする。
    const localEtag = (typeof coordinator.wrapTransportRevision === 'function')
      ? coordinator.wrapTransportRevision(coordinator.currentTransportName(), rawLocalEtag)
      : rawLocalEtag;
    const result = coordinator.reportConflict(documentKey, {
      path,
      localMd: md,
      localEtag,
      serverDetail: detail,
      focusTarget: (lastRequest && lastRequest.focusTarget) || null,
    });
    _safety()?.recordConflictState?.(path, {
      detail: safetyDetail,
      localMd: md,
      remoteEtag: (detail && detail.current_etag) || '',
      documentId: (detail && detail.document_id) || '',
      generation: result && result.generation,
      state: 'conflict-pending',
    });
    return result;
  }

  function isConflictPending(path) {
    const coordinator = _coordinator();
    return !!coordinator && !!coordinator.isConflictPending(documentKeyForPath(path));
  }

  function getConflictFocusTarget(path) {
    const coordinator = _coordinator();
    if (!coordinator) return null;
    const record = coordinator.getConflict(documentKeyForPath(path));
    return (record && record.focusTarget) || null;
  }

  // 上書き/再読込/別名保存の成功時、または正規化内容一致による自動解決時に呼ぶ。
  // 対象文書・競合世代が一致する場合だけ解除する（計画書§5工程2-A項目8）。
  function resolveConflict(path, generation) {
    const coordinator = _coordinator();
    const documentKey = documentKeyForPath(path);
    const resolved = coordinator ? coordinator.resolveConflict(documentKey, generation) : false;
    // 世代不一致・競合記録なしの場合は、永続記録や非モーダル表示も残す。
    // コーディネーターだけが解除を拒否しているのにUI側だけ消すと、未解決競合を
    // ユーザーが再確認できなくなる（計画書§5工程2-A項目8）。
    if (!resolved) return false;
    _safety()?.clearConflict?.(path);
    _hideConflictPendingBanner(documentKey);
    _restoredConflictDocKeys.delete(documentKey);
    return true;
  }

  function getConflictGeneration(path) {
    const record = _coordinator()?.getConflict?.(documentKeyForPath(path));
    return record ? record.generation : null;
  }

  // 修正7: この文書の競合が「再起動/再読込後にプレースホルダーとして復元された
  // もの」かどうかを返す（本当の未保存内容を伴わない）。呼び出し元
  // （gb-editor.part01.part01.js _showNoteConflictDialog）は、これが true の間は
  // サーバー最新内容との自動一致判定をスキップし、代わりにドラフト復元系への
  // 案内を表示する。
  function isRestoredConflict(path) {
    return _restoredConflictDocKeys.has(documentKeyForPath(path));
  }

  // 正規化後の内容が一致するかどうかを比較する（計画書§5工程2-A項目9）。
  // サーバー側（meldex_file_safety.canonical_text_for_conflict_compare）と
  // 同じく、.mdは改行コードの表記ゆれのみ吸収する最小正規化に留める。
  function contentMatchesNormalized(a, b) {
    const norm = (value) => String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return norm(a) === norm(b);
  }

  function autoResolveConflictAsMatch(path, hostEl, remoteContent, etag, generation) {
    // 取得開始後に別の解決処理が進んだ場合、古い取得結果でDOM/baselineを
    // 巻き戻さない。対象世代を解除できた時だけ表示も同期する。
    if (!resolveConflict(path, generation)) return false;
    syncResolvedBaseline(path, hostEl, remoteContent, etag);
    return true;
  }

  // ---- 「競合を保留中」非モーダル表示（計画書§2.6・§5工程2-A項目7） ----
  // 修正8: ボードノート/シナリオ等の他の編集面と同じ共通実装
  // （gb-conflict-pending-banner.js）へ委譲する。従来はノート専用に、同じ
  // 固定座標（position:fixed;right:16px;bottom:16px）へ描画する非モーダル表示を
  // 自前で再実装しており、ノートの競合とボードノート/シナリオの競合が同時に
  // 保留中になると2つの独立実装が同一座標へ重なって二重表示になっていた。
  // data-e2e-id はノート専用の既存値（note-conflict-pending-banner /
  // note-conflict-pending-review）を維持し、既存E2E
  // （gb-e2e-actions-note-micro.js）との互換性を保つ。共通実装が未読込の
  // 場合だけ従来の自前実装へフォールバックする。

  function _bannerId(documentKey) {
    return 'gb-note-conflict-pending-banner';
  }

  function _hideConflictPendingBanner(documentKey) {
    if (window.MeldexConflictPendingBanner) { window.MeldexConflictPendingBanner.hide(documentKey); return; }
    document.getElementById(_bannerId(documentKey))?.remove();
  }

  function _liveHostForPath(path) {
    const pc = document.getElementById('page-content');
    if (pc && pc.dataset && pc.dataset.path === path) return pc;
    const dp = document.getElementById('dp-editable');
    if (dp && dp.dataset && dp.dataset.path === path) return dp;
    return null;
  }

  function _confirmConflictReview(documentKey, path) {
    const coordinator = _coordinator();
    const record = coordinator ? coordinator.requestConflictReview(documentKey) : null;
    if (!record) return;
    _hideConflictPendingBanner(documentKey);
    const hostEl = _liveHostForPath(path);
    if (!hostEl || typeof window._showNoteConflictDialog !== 'function') {
      // 修正6: 対象ノートが表示されていない（別のノート/ビューを開いている）、
      // またはダイアログ関数が未読込の場合、従来はここで無言returnしていた。
      // 直前の requestConflictReview() 呼び出しで状態は既にRESOLVINGへ遷移して
      // いるため、放置するとダイアログを一切開けないままRESOLVINGに固着し、
      // 以後この文書へのネットワーク保存がすべてブロックされ続ける
      // （isConflictPendingはRESOLVINGも保留中として扱うため）。
      // 確認可能な状態（CONFLICT_PENDING）へ戻し、非モーダル表示も再表示して、
      // ユーザーに次の行動（対象ノートを開き直す）を促す。
      if (coordinator && typeof coordinator.restoreConflict === 'function') {
        coordinator.restoreConflict(documentKey, record);
      }
      _showConflictPendingBanner(documentKey, path);
      if (typeof window.showStatus === 'function') {
        window.showStatus('このノートを開いてから確認してください', true);
      }
      return;
    }
    const localMd = record.localMd || serialize(hostEl);
    window._showNoteConflictDialog(path, localMd, hostEl);
  }

  function _showConflictPendingBanner(documentKey, path) {
    if (window.MeldexConflictPendingBanner) {
      window.MeldexConflictPendingBanner.show(documentKey, {
        label: '競合を保留中',
        e2eId: 'note-conflict-pending-banner',
        confirmE2eId: 'note-conflict-pending-review',
        onConfirm: () => _confirmConflictReview(documentKey, path),
      });
      return;
    }
    // フォールバック（共通実装が未読込の場合のみ）。
    _hideConflictPendingBanner(documentKey);
    if (!document.body) return;
    const bar = document.createElement('div');
    bar.id = _bannerId(documentKey);
    bar.setAttribute('role', 'status');
    bar.dataset.e2eId = 'note-conflict-pending-banner';
    bar.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9500;display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;background:var(--bg2,#222);color:var(--fg,#eee);border:1px solid var(--border,#444);box-shadow:0 2px 10px rgba(0,0,0,.25);font-size:12px;';
    const label = document.createElement('span');
    label.textContent = '競合を保留中';
    const reviewBtn = document.createElement('button');
    reviewBtn.type = 'button';
    reviewBtn.className = 'gb-btn gb-btn-xs gb-btn-primary';
    reviewBtn.dataset.e2eId = 'note-conflict-pending-review';
    reviewBtn.textContent = '確認する';
    reviewBtn.addEventListener('click', () => _confirmConflictReview(documentKey, path));
    bar.append(label, reviewBtn);
    document.body.appendChild(bar);
  }

  // 競合パネルを閉じる（保留/Escape）たびに呼ぶ。実際にconflict-pendingが
  // 残っている場合だけ非モーダル表示を出す（直接呼び出し等でコーディネーター側に
  // 競合記録が無い場合は何も出さない）。
  function showConflictPendingBannerIfPending(path, hostEl) {
    const coordinator = _coordinator();
    const documentKey = documentKeyForPath(path);
    if (!coordinator || !coordinator.isConflictPending(documentKey)) return;
    _showConflictPendingBanner(documentKey, path);
  }

  function hideConflictPendingBanner(path) {
    _hideConflictPendingBanner(documentKeyForPath(path));
  }

  // 再起動/再読込後の状態復元（計画書§5工程2-A項目10）。ノートを開いた直後に
  // 呼ぶ。永続化された保留記録があれば、パネルを強制表示せず非モーダル表示
  // だけを再開する。
  function restorePendingConflictIfAny(hostEl, path) {
    const coordinator = _coordinator();
    const safety = _safety();
    if (!coordinator) return;
    const documentKey = documentKeyForPath(path);
    // 共通コーディネーターの汎用永続記録を最優先する。旧ノート専用記録が
    // 無くても、保留状態とネットワーク保存停止を再起動後に復元できる。
    const persisted = coordinator.getConflict?.(documentKey);
    if (persisted) {
      if (!persisted.localMd) _restoredConflictDocKeys.add(documentKey);
      _showConflictPendingBanner(documentKey, path);
      return;
    }
    if (!safety || typeof safety.getConflictState !== 'function') return;
    const record = safety.getConflictState(path);
    if (!record || record.state !== 'conflict-pending') return;
    const rawRestoreEtag = record.remoteEtag || (hostEl && hostEl.dataset && hostEl.dataset.lastSavedEtag) || '';
    const restoreEtag = (typeof coordinator.wrapTransportRevision === 'function')
      ? coordinator.wrapTransportRevision(coordinator.currentTransportName(), rawRestoreEtag)
      : rawRestoreEtag;
    coordinator.restoreConflict(documentKey, {
      generation: record.conflictGeneration || 1,
      localMd: '',
      localEtag: restoreEtag,
      serverDetail: null,
      focusTarget: null,
      path,
      pendingSince: record.pendingSince || Date.now(),
    });
    // 修正7: localMdが空（＝本当の未保存内容を持たないプレースホルダー復元）で
    // あることを記録する。呼び出し側の「確認する」導線がこの記録を見ずに
    // hostEl.serialize()（＝直前のopenPage()で読み込んだサーバー最新内容）を
    // localMdの代わりに使うと、直後の自動一致判定でほぼ確実に「一致」判定され、
    // 本当の未保存編集（ドラフト復元系に隔離されたまま）を確認する機会なく
    // 競合が自動解決されてしまう。
    _restoredConflictDocKeys.add(documentKey);
    _showConflictPendingBanner(documentKey, path);
  }

  // 保存成功後、同一文書を表示している他ホスト（例: メインパネルのノートと
  // 詳細パネル内ノート）のうち「自分自身は未編集」のものだけ、baselineを
  // 新しい保存結果へ追従させる。編集中（自分の直列化結果が自分のbaselineと
  // 異なる）ホストへは触れない（計画書§5工程1-10「片方が未編集なら他方の
  // 保存結果を追従する。双方が異なる未保存内容を持つ場合だけ、ローカル分岐
  // として扱う」）。
  function _renderSavedMarkdownIntoCleanHost(host, path, md) {
    if (typeof window.mdToHtml !== 'function') return false;
    const raw = String(md || '');
    const fmMatch = raw.match(/^(---\n[\s\S]*?\n---\n?)/);
    const frontmatter = fmMatch ? fmMatch[1] : '';
    const bodyMd = frontmatter ? raw.slice(frontmatter.length) : raw;
    const scrollTop = Number(host.scrollTop) || 0;
    const scrollLeft = Number(host.scrollLeft) || 0;
    let html = window.mdToHtml(bodyMd, { basePath: path });
    if (typeof window.applyAutoLinks === 'function') html = window.applyAutoLinks(html, path);
    host.dataset.frontmatter = frontmatter;
    host.innerHTML = html;
    host._noteEditRevision = (host._noteEditRevision || 0) + 1;
    host._noteEditSerializeCache = null;
    host._noteTocSignature = undefined;
    if (typeof window._dpApplyNoteFileStyle === 'function') window._dpApplyNoteFileStyle(host, frontmatter);
    if (typeof window._prepareEmbeddedMediaControls === 'function') window._prepareEmbeddedMediaControls(host);
    if (typeof window._maybeRefreshNoteTocAfterEdit === 'function') window._maybeRefreshNoteTocAfterEdit(host);
    host.scrollTop = scrollTop;
    host.scrollLeft = scrollLeft;
    return true;
  }

  function _syncSiblingBaselines(documentKey, sourceHostEl, path, md, etag, transportRevision) {
    const coordinator = _coordinator();
    if (!coordinator) return;
    const participants = coordinator.getParticipants(documentKey);
    participants.forEach((host) => {
      if (!host || host === sourceHostEl) return;
      if (!host.isConnected) return;
      if (!host.dataset || host.dataset.path !== path) return;
      if (host.dataset.loadFailed === '1') return;
      if (typeof window._dpIsPlaceholderOnly === 'function' && window._dpIsPlaceholderOnly(host)) return;
      // フォーカス中のホストへはnormalize()等の副作用を及ぼさない（キャレット保護）。
      // フォーカス中は保守的に「編集中の可能性あり」として扱い、追従を見送る。
      if (document.activeElement === host) return;
      let liveMd;
      try {
        liveMd = serialize(host);
      } catch (_) {
        return;
      }
      const ownBaseline = host.dataset.lastSavedMd || '';
      if (liveMd !== ownBaseline) return; // 自ホストに未保存編集がある → 触らない
      // baselineだけを新内容へ進めてDOMを古いまま残すと、次のblurで古いDOMが
      // 「新baselineからの編集」と判定され、新etag付きで直前の保存を巻き戻す。
      // 未編集・非フォーカスのホストは表示本文も同じ保存結果へ追従させる。
      if (!_renderSavedMarkdownIntoCleanHost(host, path, md)) return;
      host.dataset.lastSavedMd = md;
      host.dataset.lastSavedEtag = etag || '';
      if (coordinator.normalizeTransportRevision) {
        host.dataset.lastSavedTransportRevision = coordinator.normalizeTransportRevision(
          coordinator.currentTransportName(),
          transportRevision || etag || '',
        );
      }
    });
  }

  function syncResolvedBaseline(path, sourceHostEl, md, etag) {
    const coordinator = _coordinator();
    const documentKey = documentKeyForPath(path);
    if (sourceHostEl && sourceHostEl.dataset && sourceHostEl.dataset.path === path) {
      sourceHostEl.dataset.lastSavedMd = md;
      sourceHostEl.dataset.lastSavedEtag = etag || sourceHostEl.dataset.lastSavedEtag || '';
      if (coordinator?.normalizeTransportRevision) {
        sourceHostEl.dataset.lastSavedTransportRevision = coordinator.normalizeTransportRevision(
          coordinator.currentTransportName(),
          etag || sourceHostEl.dataset.lastSavedEtag || '',
        );
      }
    }
    _syncSiblingBaselines(documentKey, sourceHostEl, path, md, etag, etag);
  }

  /**
   * ノートの保存をコーディネーター経由で実行する。
   *
   * 呼び出し側（gb-editor.part01.part01.js / gb-detail-panel.part03.js）は、
   * 既に直列化済みの md（と、そのmdを算出する直前のbaseline比較）を渡す。
   * 実際にネットワークへ送るかどうか（single-flight/coalesce/合流）は
   * コーディネーターが判断する。
   *
   * @param {HTMLElement} hostEl path/frontmatter/lastSavedMd/lastSavedEtagをdatasetに持つ編集ホスト
   * @param {string} path 保存先パス
   * @param {string} md 直列化済みのMarkdown（フロントマター込み）
   * @param {{reason?:string, focusTarget?:*, extra?:object}} [opts]
   * @returns {Promise<any>} apiPutの応答（savedMd/savedPath/joined/coalescedを付加したもの）
   */
  function performSave(hostEl, path, md, opts) {
    const coordinator = _coordinator();
    if (!coordinator) {
      return Promise.reject(new Error('MeldexDocumentSaveCoordinator is not loaded'));
    }
    const documentKey = hostEl?.dataset?.documentKey || bindHostIdentity(hostEl, path, hostEl?.dataset || {});
    coordinator.registerParticipant(documentKey, hostEl);
    const options = opts || {};
    // 修正5: if_match_etagはこの performSave() 呼び出し時点のhostEl.dataset.
    // lastSavedEtagをここでクロージャへ固定する（path/mdと同じ扱い）。sendFnは
    // single-flight/coalesceにより実際の送信タイミングが遅延しうる
    // （進行中の保存の完了を待ってから送られる）。従来はsendFn内で
    // hostEl.dataset.lastSavedEtagを毎回ライブに読んでいたため、送信が遅延する
    // 間にhostElが（ノート切替や他の保存の成功で）別文書のetagを指すように
    // なっていた場合、その新しいetagをこの古い文書のPUTへ誤って付けてしまい、
    // 本来成功するはずの保存がfalse-positiveな409になり得た。
    const etagAtRequestTime = (hostEl && hostEl.dataset && hostEl.dataset.lastSavedEtag) || '';
    const transportRevisionAtRequestTime = (hostEl && hostEl.dataset && hostEl.dataset.lastSavedTransportRevision)
      || coordinator.normalizeTransportRevision?.(coordinator.currentTransportName(), etagAtRequestTime)
      || etagAtRequestTime;
    const sendFn = (previousResult) => {
      const chainedRevision = previousResult?.transport_revision || previousResult?.etag || '';
      const revisionForWrite = chainedRevision
        ? coordinator.normalizeTransportRevision(
            coordinator.currentTransportName(),
            chainedRevision,
          )
        : transportRevisionAtRequestTime;
      const guardedEtag = coordinator.revisionTokenForWrite
        ? coordinator.revisionTokenForWrite(revisionForWrite)
        : (chainedRevision || etagAtRequestTime);
      const extraWithRevision = Object.assign({
        if_match_etag: guardedEtag,
        transport_revision: revisionForWrite,
      }, options.extra || {});
      return window.apiPut(
        '/file?path=' + encodeURIComponent(path),
        typeof window._noteSavePayload === 'function'
          ? window._noteSavePayload(hostEl, md, extraWithRevision)
          : {
            content: md,
            if_match_etag: guardedEtag,
            transport_revision: revisionForWrite,
            skip_if_missing: true,
            ...(options.extra || {}),
          },
      );
    };
    return coordinator.requestSave(documentKey, hostEl, path, md, sendFn, {
      reason: options.reason || 'save',
      focusTarget: options.focusTarget || null,
    }).then((res) => {
      // 工程2-A項目4: conflict-pending中はコーディネーターがネットワーク送信
      // 自体をスキップして返す（res.conflictPending）。実際にサーバーへ何も
      // 送っていないため、baseline同期（他ホストへの追従）を一切行わない
      // ——ここで触ると「未送信の内容が保存された」ことになってしまう。
      if (res && res.conflictPending) return res;
      const savedMd = (res && res.savedMd != null) ? res.savedMd : md;
      _syncSiblingBaselines(
        documentKey,
        hostEl,
        path,
        savedMd,
        res && res.etag,
        res && res.transport_revision,
      );
      if (res?.etag && hostEl?.dataset && hostEl.dataset.path === path) {
        hostEl.dataset.lastSavedTransportRevision = coordinator.normalizeTransportRevision(
          coordinator.currentTransportName(),
          res.transport_revision || res.etag,
        );
      }
      if (res) coordinator.bindDocumentIdentity?.(path, res);
      return res;
    });
  }

  window.MeldexNoteSaveAdapter = {
    documentKeyForPath,
    bindHostIdentity,
    serialize,
    isUnchanged,
    registerHost,
    performSave,
    reportSaveFailureConflict,
    isConflictPending,
    getConflictFocusTarget,
    isElementUsableForFocus: _isElementUsableForFocus,
    resolveConflict,
    getConflictGeneration,
    isRestoredConflict,
    confirmConflictReview: _confirmConflictReview,
    contentMatchesNormalized,
    autoResolveConflictAsMatch,
    syncResolvedBaseline,
    showConflictPendingBannerIfPending,
    hideConflictPendingBanner,
    restorePendingConflictIfAny,
  };
})();
