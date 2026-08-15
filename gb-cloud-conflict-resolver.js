(function () {
  if (window.MeldexCloudConflictResolver) return;

  // 計画書 app/docs/note-editor-regression-performance-conflict-plan-2026-08-01.md
  // §5 工程2-D項目8「gb-cloud-conflict-resolver.jsの『後回し』とノート競合の
  // 『保留』を共通状態へ接続する。時間制localStorageでバナーだけ消す処理を
  // 解決扱いにせず…ユーザーが『確認する』を選ぶまで同じ競合世代のモーダルを
  // 自動表示しない」。
  //
  // 旧実装は単一のグローバル時間制フラグ（SNOOZE_KEY/SNOOZE_MS=1時間）
  // だけで、対象となった競合の識別情報を一切記録しなかった。このため
  // 1時間経過後は「まだ未解決の同じ競合」に対しても定期監視が無条件で
  // バナー/通知を再表示していた（§9で明示的に禁止されるパターン）。
  //
  // 新実装は「後回しにした時点の競合集合（パス+更新日時の組）から
  // 決定的に計算した競合世代ID」を期限なしで記録する。同じ世代の間は
  // 再表示を抑止し、集合が変化（新規競合の出現・解消・再更新）した時だけ
  // 新しい世代とみなして再び表示する。本文は一切記録しない
  // （§2.8「両本文は原本、IndexedDBドラフト、競合コピー、解消前バックアップ
  // で保全する」）。
  const ACKNOWLEDGED_KEY = 'meldex-cloud-conflict-acknowledged-generation';
  const ACKNOWLEDGEMENT_PENDING_KEY = 'meldex-cloud-conflict-acknowledgement-pending';
  const SHARED_ACK_DOCUMENT_ID = 'cloud-conflict-acknowledgement-v1';
  const BINARY_FULL_HASH_MAX_BYTES = 5 * 1024 * 1024;
  let _sharedAcknowledgedGeneration = '';
  let _acknowledgementScope = '';
  let _overlay = null;
  let _conflicts = [];
  let _selectedPath = '';
  let _detailRequestSeq = 0;
  let _conflictTotal = 0;
  let _conflictTruncated = false;
  let _restoreFocusTo = null;
  let _keyHandler = null;

  function _api() {
    return window.MeldexDataAccess;
  }

  // 「シートをマージ」はデスクトップ版のみ実装済み（meldex_conflict_copies.py の
  // 行単位マージ）。ブラウザ直結のデータアクセス（Dropbox直結 / ローカル
  // ファイルシステムAPI直結、gb-data-access.part02.js の isBrowserDataMode()
  // が true になる経路）では /cloud/conflict-resolve がクライアント側実装
  // （gb-data-access-dropbox-fileops.part01.part02.js）に置き換わり、
  // keep_original / keep_conflict しか受け付けないため merge_sqlite_sheet は
  // 常に失敗する。押しても機能しないボタンを残さない（見えるボタンはその環境で
  // 実際に機能すること、というUI共通ルール）。「Meldex共有サーバーに接続」
  // （server）は実サーバー側のPython APIを叩くため対象外（デスクトップと同じ
  // マージが使える）。
  function _isSqliteSheetMergeSupportedHere() {
    return !(
      window.MeldexRuntimeAdapter?.isBrowserDataMode?.()
      || document.body?.dataset?.cloudMode === 'dropbox'
      || document.body?.dataset?.cloudMode === 'browser'
    );
  }

  function _setStatus(text, isError) {
    const el = _overlay?.querySelector?.('.cloud-conflict-status');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? 'var(--red, #f48771)' : '';
  }

  function _el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = String(text);
    return element;
  }

  function _basename(path) {
    const normalized = String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const index = normalized.lastIndexOf('/');
    return index >= 0 ? normalized.slice(index + 1) : normalized;
  }

  // パス表示欄への反映。長いパスは実効幅に収めて「先頭…末尾ファイル名」形式で中略する。
  function _applyPathEllipsis(el, text) {
    if (typeof applyMiddleEllipsis === 'function') applyMiddleEllipsis(el, text);
    else el.textContent = text;
  }

  // 競合集合（パス+更新日時）から決定的な世代IDを作る。内容そのものではなく
  // メタデータのみを使う（本文を永続化しない、という既存方針を維持するため）。
  // 集合が1件でも変化（新規出現・解消・再更新でmodifiedが変わる）すれば
  // 別の世代IDになり、後回し状態は自動的に無効化される。
  function conflictGenerationId(conflicts) {
    const items = Array.isArray(conflicts?.items) ? conflicts.items : (Array.isArray(_conflicts) ? _conflicts : []);
    const signature = items
      .map((item) => `${String(item?.path || '')}::${String(item?.modified || '')}`)
      .sort()
      .join('|');
    const count = Number(conflicts?.count ?? conflicts?.total ?? items.length) || items.length;
    const truncated = conflicts ? !!conflicts.truncated : _conflictTruncated;
    return `${_acknowledgementScope || 'unscoped'}:${count}:${truncated ? 'truncated' : 'complete'}:${signature}`;
  }

  function _scopedLocalKey(baseKey) {
    return _acknowledgementScope ? `${baseKey}:${_acknowledgementScope}` : '';
  }

  function _readAcknowledgedGeneration() {
    const key = _scopedLocalKey(ACKNOWLEDGED_KEY);
    if (!key) return '';
    try { return localStorage.getItem(key) || ''; } catch { return ''; }
  }

  function _writeScopedLocal(baseKey, value) {
    const key = _scopedLocalKey(baseKey);
    if (!key) return;
    try {
      if (value) localStorage.setItem(key, String(value));
      else localStorage.removeItem(key);
    } catch {}
  }

  async function _sharedAcknowledgementAdapter(provider) {
    const resolver = window.MeldexDropboxManagementRootResolver;
    if (!provider || typeof resolver?.resolveAdapterForProvider !== 'function') return null;
    return resolver.resolveAdapterForProvider(provider);
  }

  async function hydrateAcknowledgement(provider) {
    const storage = window.MeldexSystemStorage;
    const adapter = await _sharedAcknowledgementAdapter(provider);
    if (!adapter || !storage?.SystemStorageKind?.PROFILES_WORKSPACE) {
      _acknowledgementScope = '';
      _sharedAcknowledgedGeneration = '';
      return '';
    }
    const description = adapter.describe?.() || {};
    _acknowledgementScope = String(
      description.boundary || description.management_root || description.environment || '',
    );
    const record = await adapter.load(
      storage.SystemStorageKind.PROFILES_WORKSPACE,
      SHARED_ACK_DOCUMENT_ID,
    );
    _sharedAcknowledgedGeneration = String(record?.payload?.generation || '');
    let pending = '';
    try {
      pending = localStorage.getItem(_scopedLocalKey(ACKNOWLEDGEMENT_PENDING_KEY)) || '';
    } catch {}
    if (pending && pending !== _sharedAcknowledgedGeneration) {
      const persisted = await _persistSharedAcknowledgement(pending, provider);
      if (persisted) _writeScopedLocal(ACKNOWLEDGEMENT_PENDING_KEY, '');
    }
    return _sharedAcknowledgedGeneration;
  }

  async function _persistSharedAcknowledgement(generation, provider) {
    const storage = window.MeldexSystemStorage;
    const adapter = await _sharedAcknowledgementAdapter(provider);
    if (!generation || !adapter || !storage?.SystemStorageKind?.PROFILES_WORKSPACE) return false;
    const kind = storage.SystemStorageKind.PROFILES_WORKSPACE;
    const current = await adapter.load(kind, SHARED_ACK_DOCUMENT_ID);
    if (String(current?.payload?.generation || '') === generation) {
      _sharedAcknowledgedGeneration = generation;
      _writeScopedLocal(ACKNOWLEDGEMENT_PENDING_KEY, '');
      return true;
    }
    try {
      await adapter.save(kind, SHARED_ACK_DOCUMENT_ID, {
        generation,
        acknowledged_at: new Date().toISOString(),
      }, {
        expectedRevision: current?.revision ?? null,
      });
      _sharedAcknowledgedGeneration = generation;
      _writeScopedLocal(ACKNOWLEDGEMENT_PENDING_KEY, '');
      return true;
    } catch (error) {
      // 別端末が先に同じ世代を承認した競合だけを成功として吸収する。
      // 異なる世代なら古い端末から上書きせず、次回監視時に再取得する。
      const ConflictError = storage.SystemStorageConflictError;
      if (typeof ConflictError !== 'function' || !(error instanceof ConflictError)) throw error;
      const refreshed = await adapter.load(kind, SHARED_ACK_DOCUMENT_ID);
      if (String(refreshed?.payload?.generation || '') === generation) {
        _sharedAcknowledgedGeneration = generation;
        _writeScopedLocal(ACKNOWLEDGEMENT_PENDING_KEY, '');
        return true;
      }
      return false;
    }
  }

  // 現在報告されている競合集合(conflicts)が、既に「後回し」で承認済みの
  // 世代と一致するかどうかを判定する。conflictsを省略した場合は判定できない
  // ため常にfalse(=通常どおり表示)を返す（未移行の呼び出し元が誤って
  // 抑止させないための安全側デフォルト）。
  function isAcknowledged(conflicts) {
    const current = conflictGenerationId(conflicts);
    if (!current) return false;
    return _readAcknowledgedGeneration() === current || _sharedAcknowledgedGeneration === current;
  }

  // 後方互換名。引数無しの旧呼び出し（存在すれば）は判定できないためfalseを返す。
  function isSnoozed(conflicts) {
    return conflicts !== undefined ? isAcknowledged(conflicts) : false;
  }

  function _hideConflictBanner() {
    const bar = document.getElementById('cloud-mode-banner');
    if (bar?.dataset?.cloudBannerKind === 'health-conflict') bar.remove();
  }

  function _currentConflictsSnapshot() {
    return { items: _conflicts, count: _conflictTotal || _conflicts.length, truncated: _conflictTruncated };
  }

  // 「後回し」＝現在の競合集合を承認済み世代として記録する。競合を解決した
  // ことにはしない（§2.6）。呼び出し元は別途、非モーダルな「確認待ち」表示
  // （gb-cloud-bootstrap.jsの_applyCloudHealth）を出し続けること。
  function acknowledge(conflictsInput) {
    const conflicts = conflictsInput || _currentConflictsSnapshot();
    const generation = conflictGenerationId(conflicts);
    let persistence = Promise.resolve(false);
    if (generation) _writeScopedLocal(ACKNOWLEDGED_KEY, generation);
    if (generation) {
      _writeScopedLocal(ACKNOWLEDGEMENT_PENDING_KEY, generation);
      const provider = window.MeldexStorageAdapter?.getProvider?.();
      persistence = _persistSharedAcknowledgement(generation, provider).then((persisted) => {
        if (!persisted && typeof showStatus === 'function') {
          showStatus('後回し状態はこの端末だけに保存されました。共有は次回再試行します', true);
        }
        return persisted;
      }).catch(() => {
        if (typeof showStatus === 'function') {
          showStatus('後回し状態はこの端末だけに保存されました。共有は次回再試行します', true);
        }
        return false;
      });
    }
    close();
    _hideConflictBanner();
    if (typeof showStatus === 'function') showStatus('競合解消を後回しにしました');
    return persistence;
  }

  // 後方互換名（既存呼び出し・E2Eからの参照を壊さない）。
  function snooze(conflictsInput) {
    return acknowledge(conflictsInput);
  }

  function _appendInlineDiff(container, text, otherText) {
    const current = String(text ?? '');
    const other = String(otherText ?? '');
    if (current === other) {
      container.appendChild(document.createTextNode(current));
      return;
    }
    let prefix = 0;
    const minLen = Math.min(current.length, other.length);
    while (prefix < minLen && current[prefix] === other[prefix]) prefix += 1;

    let suffix = 0;
    const currentRest = current.length - prefix;
    const otherRest = other.length - prefix;
    while (
      suffix < currentRest &&
      suffix < otherRest &&
      current[current.length - suffix - 1] === other[other.length - suffix - 1]
    ) {
      suffix += 1;
    }

    if (prefix > 0) container.appendChild(document.createTextNode(current.slice(0, prefix)));
    const changed = current.slice(prefix, current.length - suffix);
    const changedSpan = _el('span', 'cloud-conflict-inline-diff', changed || ' ');
    container.appendChild(changedSpan);
    if (suffix > 0) container.appendChild(document.createTextNode(current.slice(current.length - suffix)));
  }

  function _clearDetail(message) {
    const originalPane = _overlay?.querySelector?.('[data-conflict-pane="original"]');
    const conflictPane = _overlay?.querySelector?.('[data-conflict-pane="conflict"]');
    if (!originalPane || !conflictPane) return;
    originalPane.textContent = '';
    conflictPane.textContent = '';
    if (message) {
      originalPane.appendChild(_el('div', 'cloud-conflict-empty', message));
      conflictPane.appendChild(_el('div', 'cloud-conflict-empty', message));
    }
  }

  function _clearMeta(message) {
    ['original', 'conflict'].forEach((name) => {
      const card = _overlay?.querySelector?.(`[data-conflict-meta="${name}"]`);
      if (!card) return;
      card.textContent = '';
      if (message) card.appendChild(_el('div', 'cloud-conflict-meta-label', message));
    });
  }

  function _renderLines(container, text, otherText, options = {}) {
    container.textContent = '';
    const lines = String(text || '').split(/\r?\n/);
    const otherLines = String(otherText || '').split(/\r?\n/);
    const maxLines = Math.min(Math.max(lines.length, otherLines.length), 2500);
    for (let index = 0; index < maxLines; index += 1) {
      const line = _el('div', 'cloud-conflict-line');
      const currentLine = lines[index] == null ? '' : lines[index];
      const otherLine = otherLines[index] == null ? '' : otherLines[index];
      const different = currentLine !== otherLine;
      if (different) line.classList.add('is-different');
      line.appendChild(_el('span', 'cloud-conflict-line-no', String(index + 1)));
      const textNode = _el('span', 'cloud-conflict-line-text');
      if (different) _appendInlineDiff(textNode, currentLine, otherLine);
      else textNode.textContent = currentLine;
      line.appendChild(textNode);
      container.appendChild(line);
    }
    if (Math.max(lines.length, otherLines.length) > maxLines) {
      container.appendChild(_el('div', 'cloud-conflict-empty', '表示が長いため一部を省略しています'));
    }
    if (options.truncated) {
      container.appendChild(_el('div', 'cloud-conflict-empty', 'ファイルが大きいため、本文プレビューの一部だけを表示しています'));
    }
  }

  async function _sha256Hex(bytes) {
    try {
      if (!globalThis.crypto?.subtle) return '';
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (_) {
      return '';
    }
  }

  function _hexPreview(bytes, limit) {
    const max = Math.min(bytes.length, limit || 512);
    const rows = [];
    for (let offset = 0; offset < max; offset += 16) {
      const chunk = bytes.slice(offset, Math.min(offset + 16, max));
      const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ');
      const ascii = Array.from(chunk).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
      rows.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(47, ' ')}  ${ascii}`);
    }
    if (bytes.length > max) rows.push(`... ${bytes.length - max} bytes 省略`);
    return rows.join('\n');
  }

  async function _binarySideSummary(side, label) {
    if (!side?.exists || !side?.path) return `${label}\nファイルなし`;
    const knownSize = Number(side?.size || 0);
    if (knownSize > BINARY_FULL_HASH_MAX_BYTES) {
      return [
        label,
        `ファイル: ${side.path}`,
        `Content-Type: ${side?.mime || side?.content_type || '不明'}`,
        `ファイルサイズ: ${knownSize} bytes`,
        'SHA-256: 大きいため省略',
        '',
        '大きな非テキストファイルのため、本文と先頭バイトの読み込みを省略しています。',
      ].join('\n');
    }
    const response = await fetch(API_BASE + '/file-raw?path=' + encodeURIComponent(side.path));
    if (!response.ok) throw new Error(`${label}を読み込めませんでした: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const hash = await _sha256Hex(bytes);
    return [
      label,
      `ファイル: ${side.path}`,
      `Content-Type: ${response.headers.get('content-type') || '不明'}`,
      `ファイルサイズ: ${bytes.length} bytes`,
      `SHA-256: ${hash || '計算不可'}`,
      '',
      '先頭バイト（最大512 bytes）:',
      _hexPreview(bytes, 512) || '(空ファイル)',
    ].join('\n');
  }

  async function _renderBinaryDetail(detail, requestSeq) {
    const [originalText, conflictText] = await Promise.all([
      _binarySideSummary(detail.original, '元ファイル'),
      _binarySideSummary(detail.conflict, '競合コピー'),
    ]);
    if (!_overlay || requestSeq !== _detailRequestSeq) return;
    _renderLines(
      _overlay.querySelector('[data-conflict-pane="original"]'),
      originalText,
      conflictText
    );
    _renderLines(
      _overlay.querySelector('[data-conflict-pane="conflict"]'),
      conflictText,
      originalText
    );
    _setStatus('非テキスト形式のため、メタデータ・SHA-256・先頭バイトで比較しています');
  }

  function _renderConflictList() {
    const list = _overlay.querySelector('.cloud-conflict-list');
    list.textContent = '';
    if (!_conflicts.length) {
      list.appendChild(_el('div', 'cloud-conflict-empty', '競合コピーはありません'));
      return;
    }
    if (_conflictTruncated || _conflictTotal > _conflicts.length) {
      list.appendChild(_el('div', 'cloud-conflict-empty', `表示中: ${_conflicts.length}件 / 検出: ${_conflictTotal || _conflicts.length}件`));
    }
    _conflicts.forEach((item) => {
      const button = _el('button', 'cloud-conflict-list-item');
      button.type = 'button';
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', item.path === _selectedPath ? 'true' : 'false');
      button.setAttribute('aria-label', `${item.name || _basename(item.path)} ${item.path || ''}`.trim());
      if (item.path === _selectedPath) button.classList.add('active');
      button.appendChild(_el('span', 'cloud-conflict-list-name', item.name || _basename(item.path)));
      const pathEl = _el('span', 'cloud-conflict-list-path');
      button.appendChild(pathEl);
      button.addEventListener('click', () => selectConflict(item.path));
      list.appendChild(button);
      // DOM接続後でないと実効幅が取れないため appendChild の後で呼ぶ
      _applyPathEllipsis(pathEl, item.path || '');
    });
  }

  function _setMeta(card, label, side) {
    card.textContent = '';
    card.appendChild(_el('div', 'cloud-conflict-meta-label', label));
    const pathEl = _el('div', 'cloud-conflict-meta-path');
    card.appendChild(pathEl);
    // DOM接続後でないと実効幅が取れないため appendChild の後で呼ぶ
    _applyPathEllipsis(pathEl, side?.path || 'なし');
    const detail = side?.exists === false
      ? '元ファイルが見つかりません'
      : `${side?.modified || '更新日時不明'} / ${Number(side?.size || 0)} bytes`;
    card.appendChild(_el('div', 'cloud-conflict-meta-label', detail));
  }

  function _setResolveButtonState(detail, busy = false) {
    const keepOriginal = _overlay?.querySelector?.('[data-conflict-action="keep_original"]');
    const keepConflict = _overlay?.querySelector?.('[data-conflict-action="keep_conflict"]');
    const mergeSqlite = _overlay?.querySelector?.('[data-conflict-action="merge_sqlite_sheet"]');
    const loading = !detail;
    if (keepOriginal) {
      keepOriginal.disabled = busy || loading || detail?.original?.exists === false;
      keepOriginal.title = detail?.original?.exists === false ? '元ファイルが見つからないため選択できません' : '';
    }
    if (keepConflict) {
      keepConflict.disabled = busy || loading || detail?.conflict?.exists === false;
      keepConflict.title = '';
    }
    if (mergeSqlite) {
      mergeSqlite.disabled = busy || loading || !detail?.sqlite_sheet_mergeable || detail?.conflict?.exists === false;
      mergeSqlite.title = detail?.sqlite_sheet_mergeable ? 'SQLiteシートを行単位でマージします' : 'SQLiteシートの競合コピーでのみ使えます';
    }
  }

  function _applyConflictPayload(payload) {
    _conflicts = Array.isArray(payload?.items) ? payload.items : [];
    _conflictTotal = Number(payload?.count || _conflicts.length) || _conflicts.length;
    _conflictTruncated = !!payload?.truncated || _conflictTotal > _conflicts.length;
  }

  async function selectConflict(path) {
    _selectedPath = String(path || '');
    _renderConflictList();
    _setStatus('読み込み中...');
    _setResolveButtonState(null);
    _clearMeta('読み込み中...');
    _clearDetail('読み込み中...');
    const requestSeq = ++_detailRequestSeq;
    try {
      const detail = await _api().requestJson(`/cloud/conflict-detail?path=${encodeURIComponent(_selectedPath)}`);
      if (!_overlay || requestSeq !== _detailRequestSeq) return;
      const originalMeta = _overlay.querySelector('[data-conflict-meta="original"]');
      const conflictMeta = _overlay.querySelector('[data-conflict-meta="conflict"]');
      _setMeta(originalMeta, '元ファイル', detail.original);
      _setMeta(conflictMeta, '競合コピー', detail.conflict);
      if (!detail.text_like) {
        _clearDetail('非テキスト形式の比較情報を読み込み中...');
        await _renderBinaryDetail(detail, requestSeq);
      } else {
        _renderLines(
          _overlay.querySelector('[data-conflict-pane="original"]'),
          detail.original?.content || '',
          detail.conflict?.content || '',
          { truncated: !!detail.original?.truncated }
        );
        _renderLines(
          _overlay.querySelector('[data-conflict-pane="conflict"]'),
          detail.conflict?.content || '',
          detail.original?.content || '',
          { truncated: !!detail.conflict?.truncated }
        );
        const truncated = detail.original?.truncated || detail.conflict?.truncated;
        _setStatus(truncated ? '大きなファイルのため一部プレビューです' : (detail.original?.exists === false ? '元ファイルなし: 競合コピーを残すと通常名へ戻します' : ''));
      }
      _setResolveButtonState(detail);
    } catch (err) {
      if (!_overlay || requestSeq !== _detailRequestSeq) return;
      _clearMeta('詳細を読み込めませんでした');
      _clearDetail('詳細を読み込めませんでした');
      _setStatus(err?.message || String(err), true);
      _setResolveButtonState(null);
    }
  }

  async function _resolve(action) {
    if (!_selectedPath) return;
    const targetPath = _selectedPath;
    const button = _overlay?.querySelector?.(`[data-conflict-action="${action}"]`);
    if (button?.disabled) return;
    const label = action === 'keep_original' ? '元ファイル' : (action === 'merge_sqlite_sheet' ? 'シートのマージ結果' : '競合コピー');
    const ok = await _confirmResolve(label);
    if (!ok) return;
    _setStatus('解消中...');
    _setResolveButtonState(null, true);
    try {
      await _api().requestJson('/cloud/conflict-resolve', {
        method: 'POST',
        body: { conflict_path: targetPath, action },
      });
      if (_conflictTotal > 0) _conflictTotal = Math.max(0, _conflictTotal - 1);
      _conflicts = _conflicts.filter((item) => item.path !== targetPath);
      if (!_overlay) {
        if (!_conflictTruncated && _conflictTotal <= 0) _hideConflictBanner();
        if (typeof loadOutliner === 'function') loadOutliner().catch(() => {});
        return;
      }
      if (_conflictTruncated && !_conflicts.length) {
        _setStatus('残りの競合を再検索中...');
        const payload = await _api().requestJson('/cloud/conflicts?limit=50');
        _applyConflictPayload(payload);
      }
      _selectedPath = _conflicts.find(item => item.path === _selectedPath)?.path || _conflicts[0]?.path || '';
      _renderConflictList();
      if (_selectedPath) await selectConflict(_selectedPath);
      else {
        _overlay.querySelector('[data-conflict-pane="original"]').textContent = '';
        _overlay.querySelector('[data-conflict-pane="conflict"]').textContent = '';
        if (_conflictTruncated || _conflictTotal > 0) {
          _setStatus('表示分を解消しました。残りの競合を再検索してください', true);
        } else {
          _setStatus('すべての競合を解消しました');
          _hideConflictBanner();
        }
      }
      if (typeof loadOutliner === 'function') loadOutliner().catch(() => {});
    } catch (err) {
      if (_overlay) {
        _setStatus(err?.message || String(err), true);
        if (_selectedPath) selectConflict(_selectedPath).catch(() => {});
      } else if (typeof showStatus === 'function') {
        showStatus('競合解消に失敗しました: ' + (err?.message || String(err)), true);
      }
    }
  }

  async function _confirmResolve(label) {
    const message = `${label}を残して競合を解消します。解消前のファイルはMeldexの管理領域へ保存されます。続行しますか？`;
    if (typeof window.cfConfirm === 'function') {
      return !!await window.cfConfirm(message, { danger: true, okLabel: '解消', cancelLabel: 'キャンセル' });
    }
    return typeof window.confirm === 'function' ? !!window.confirm(message) : false;
  }

  function _buildShell() {
    const overlay = _el('div', 'cloud-conflict-resolver-overlay');
    const dialog = _el('section', 'cloud-conflict-resolver');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'cloud-conflict-title');
    dialog.setAttribute('aria-describedby', 'cloud-conflict-status');
    dialog.tabIndex = -1;

    const header = _el('div', 'cloud-conflict-header');
    const title = _el('div', 'cloud-conflict-title', 'Dropbox 競合解消');
    title.id = 'cloud-conflict-title';
    header.appendChild(title);
    const status = _el('div', 'cloud-conflict-status', '');
    status.id = 'cloud-conflict-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    header.appendChild(status);
    const closeBtn = _el('button', 'cloud-conflict-btn', '閉じる');
    closeBtn.type = 'button';
    closeBtn.dataset.conflictClose = '1';
    closeBtn.setAttribute('aria-label', '競合解消を閉じる');
    closeBtn.title = '閉じる';
    closeBtn.addEventListener('click', close);
    header.appendChild(closeBtn);

    const body = _el('div', 'cloud-conflict-body');
    const list = _el('div', 'cloud-conflict-list');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', '競合コピー一覧');
    body.appendChild(list);

    const detail = _el('div', 'cloud-conflict-detail');
    const meta = _el('div', 'cloud-conflict-meta');
    const originalMeta = _el('div', 'cloud-conflict-meta-card');
    originalMeta.dataset.conflictMeta = 'original';
    const conflictMeta = _el('div', 'cloud-conflict-meta-card');
    conflictMeta.dataset.conflictMeta = 'conflict';
    meta.appendChild(originalMeta);
    meta.appendChild(conflictMeta);

    const compare = _el('div', 'cloud-conflict-compare');
    const originalPane = _el('section', 'cloud-conflict-pane');
    originalPane.setAttribute('aria-labelledby', 'cloud-conflict-original-title');
    const originalTitle = _el('div', 'cloud-conflict-pane-title', '元ファイル');
    originalTitle.id = 'cloud-conflict-original-title';
    originalPane.appendChild(originalTitle);
    const originalCode = _el('pre', 'cloud-conflict-code');
    originalCode.dataset.conflictPane = 'original';
    originalCode.setAttribute('aria-label', '元ファイルの内容');
    originalPane.appendChild(originalCode);
    const conflictPane = _el('section', 'cloud-conflict-pane');
    conflictPane.setAttribute('aria-labelledby', 'cloud-conflict-copy-title');
    const conflictTitle = _el('div', 'cloud-conflict-pane-title', '競合コピー');
    conflictTitle.id = 'cloud-conflict-copy-title';
    conflictPane.appendChild(conflictTitle);
    const conflictCode = _el('pre', 'cloud-conflict-code');
    conflictCode.dataset.conflictPane = 'conflict';
    conflictCode.setAttribute('aria-label', '競合コピーの内容');
    conflictPane.appendChild(conflictCode);
    compare.appendChild(originalPane);
    compare.appendChild(conflictPane);
    detail.appendChild(meta);
    detail.appendChild(compare);
    body.appendChild(detail);

    const footer = _el('div', 'cloud-conflict-footer');
    const deferBtn = _el('button', 'cloud-conflict-btn', '後回し');
    deferBtn.type = 'button';
    deferBtn.setAttribute('aria-label', '競合解消を後回しにする');
    deferBtn.addEventListener('click', () => snooze());
    const keepOriginalBtn = _el('button', 'cloud-conflict-btn', '元ファイルを残す');
    keepOriginalBtn.type = 'button';
    keepOriginalBtn.dataset.conflictAction = 'keep_original';
    keepOriginalBtn.setAttribute('aria-label', '元ファイルを残して競合を解消');
    keepOriginalBtn.addEventListener('click', () => _resolve('keep_original'));
    const mergeSqliteBtn = _isSqliteSheetMergeSupportedHere() ? _el('button', 'cloud-conflict-btn', 'シートをマージ') : null;
    if (mergeSqliteBtn) {
      mergeSqliteBtn.type = 'button';
      mergeSqliteBtn.dataset.conflictAction = 'merge_sqlite_sheet';
      mergeSqliteBtn.setAttribute('aria-label', 'SQLiteシートをマージして競合を解消');
      mergeSqliteBtn.addEventListener('click', () => _resolve('merge_sqlite_sheet'));
    }
    const keepConflictBtn = _el('button', 'cloud-conflict-btn primary', '競合コピーを残す');
    keepConflictBtn.type = 'button';
    keepConflictBtn.dataset.conflictAction = 'keep_conflict';
    keepConflictBtn.setAttribute('aria-label', '競合コピーを残して競合を解消');
    keepConflictBtn.addEventListener('click', () => _resolve('keep_conflict'));
    footer.appendChild(deferBtn);
    footer.appendChild(keepOriginalBtn);
    if (mergeSqliteBtn) footer.appendChild(mergeSqliteBtn);
    footer.appendChild(keepConflictBtn);

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) close();
    });
    return overlay;
  }

  async function open(seed) {
    if (_overlay) close();
    _restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    _overlay = _buildShell();
    document.body.appendChild(_overlay);
    _keyHandler = (event) => {
      if (event.key === 'Escape' && _overlay) {
        if (document.querySelector('.modal-overlay .gb-confirm')) return;
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', _keyHandler);
    _overlay.querySelector('.cloud-conflict-resolver')?.focus?.({ preventScroll: true });
    _setStatus('競合を検索中...');
    _setResolveButtonState(null);
    _clearMeta('競合を選択してください');
    _clearDetail('競合を選択してください');
    try {
      const payload = seed?.items ? seed : await _api().requestJson('/cloud/conflicts?limit=50');
      _applyConflictPayload(payload);
      _renderConflictList();
      const initialPath = _conflicts[0]?.path || '';
      if (initialPath) await selectConflict(initialPath);
      else _setStatus('競合コピーはありません');
    } catch (err) {
      _clearDetail('競合一覧を読み込めませんでした');
      _setStatus(err?.message || String(err), true);
    }
  }

  function close() {
    const focusTarget = _restoreFocusTo;
    if (_keyHandler) document.removeEventListener('keydown', _keyHandler);
    _keyHandler = null;
    if (_overlay) _overlay.remove();
    _overlay = null;
    _restoreFocusTo = null;
    _conflicts = [];
    _selectedPath = '';
    _conflictTotal = 0;
    _conflictTruncated = false;
    _detailRequestSeq += 1;
    if (focusTarget?.isConnected) {
      if (typeof focusMeldexDropdownTrigger === 'function') focusMeldexDropdownTrigger(focusTarget);
      else focusTarget.focus?.({ preventScroll: true });
    }
  }

  window.MeldexCloudConflictResolver = {
    open,
    close,
    snooze,
    acknowledge,
    isSnoozed,
    isAcknowledged,
    hydrateAcknowledgement,
    conflictGenerationId,
  };
})();
