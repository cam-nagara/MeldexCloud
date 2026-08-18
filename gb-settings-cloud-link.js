/**
 * Meldex 設定画面: 「Dropboxで共有」状態カード + ソースフォルダ一覧の共有バッジ
 *
 * デスクトップ版・クラウド版どちらの設定画面からも呼び出される。
 * - デスクトップ版: GET /api/dropbox-link/status でこのPC上のDropbox同期フォルダ検出状況と
 *   共有済みソースフォルダ件数を表示し、未検出時はフォルダを指定して同期先を設定できるようにする。
 * - クラウド版: window.MeldexDropboxAuth.getCurrentAccount() で接続中アカウント名を表示する
 *   （クラウド版のソースフォルダは常にDropbox上にあるため、状態確認のAPIは呼ばない）。
 *
 * window.MeldexSettingsCloudLink として公開する:
 *   - renderStatusCard(container): 状態カードを描画
 *   - decorateRootRow(rowEl, root): 設定画面のソースフォルダ一覧の各行へ共有状態バッジを付与
 *   - confirmSourceFolderLocation(root): 「場所を確認」導線（フォルダツリー側のバッジからも呼ばれる）
 *   - confirmShareSourceFolder(root) / showMoveFolderIntoSyncRootInstructions(root):
 *     「この端末のみ」バッジからの共有導線
 *   - confirmDeleteSourceFolder(root): 共有中・場所未確認・状態未取得のソースフォルダ削除時の確認
 *     （gb-settings側から呼ばれる。純ローカルの行だけ確認なしで削除できる）
 */
(function () {
  'use strict';

  if (window.MeldexSettingsCloudLink) return;

  // デスクトップ版のみ使用。GET /api/dropbox-link/status の結果をキャッシュし、
  // ソースフォルダ一覧の行バッジ判定（decorateRootRow）で使い回す（行ごとにAPIを叩かない）。
  let _statusCache = null;
  let _statusCacheOk = false;

  // 直近にバッジを掛け直した時点の状態カード内容（JSON化した指紋）。
  // renderStatusCard は候補change・sync-root指定などで連続して呼ばれるため、
  // 内容が変わっていない呼び出しでは行の掛け直しを省略する。
  let _lastRedecorateFingerprint = null;

  function _isCloudMode() {
    return !!window.MeldexRuntimeAdapter?.isDropboxMode?.();
  }

  function _isBrowserMode() {
    return !!window.MeldexRuntimeAdapter?.isBrowserMode?.();
  }

  function _injectStyles() {
    if (document.getElementById('mscl-styles')) return;
    const style = document.createElement('style');
    style.id = 'mscl-styles';
    style.textContent = `
      .mscl-root-badge{display:inline-flex;align-items:center;margin-left:6px;padding:1px 7px;border-radius:10px;font-size:11px;line-height:1.6;white-space:nowrap;border:1px solid var(--border);color:var(--fg2);background:var(--bg3);}
      .mscl-root-badge--shared{color:var(--green);border-color:var(--green);}
      .mscl-root-badge--needs-mapping{color:var(--orange);border-color:var(--orange);cursor:pointer;}
      .mscl-root-badge--needs-mapping:hover{background:var(--bg4);}
      .mscl-root-badge--local-only[role="button"]{cursor:pointer;}
      .mscl-root-badge--local-only[role="button"]:hover{background:var(--bg4);}
      .mscl-status-card .mscl-candidate-row,.mscl-status-card .mscl-vault-optin{margin-top:8px;align-items:center;flex-wrap:wrap;}
    `;
    document.head.appendChild(style);
  }

  function _normPath(value) {
    return String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  }

  function _pathBasename(value) {
    const normalized = String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const parts = normalized.split('/').filter(Boolean);
    return parts[parts.length - 1] || normalized;
  }

  function _errorText(e) {
    return (e && (e.userMessage || e.message)) ? String(e.userMessage || e.message) : String(e || '');
  }

  // UI共通ルール: 説明文はツールチップに集約する。この関数は共通ヘルパー
  // fieldHelp() を安全に呼び出すラッパー（この file 専用の手作りNode実行
  // テストハーネスの一部が fieldHelp をスタブしていないため、未定義時は
  // 何も出さずに済ませる。実アプリでは meldex-core.js 経由で常に定義済み）。
  function _cloudLinkHelp(text) {
    return typeof fieldHelp === 'function' ? fieldHelp(text) : '';
  }

  /* ==============================
     状態カード
     ============================== */

  async function renderStatusCard(container) {
    if (!container) return;
    _injectStyles();
    try {
      if (_isCloudMode()) {
        await _renderCloudStatusCard(container);
      } else if (_isBrowserMode()) {
        _renderBrowserStatusCard(container);
      } else {
        await _renderDesktopStatusCard(container);
      }
    } catch (e) {
      // 取得できない場合は静かに非表示にする（設定画面の他の項目は普通に使えるようにする）
      container.innerHTML = '';
    }
  }

  async function _renderCloudStatusCard(container) {
    let accountLabel = '';
    try {
      const account = await window.MeldexDropboxAuth?.getCurrentAccount?.(false);
      accountLabel = String(account?.name?.display_name || account?.email || '').trim();
    } catch {}

    const card = document.createElement('section');
    card.className = 'gb-section gb-section--boxed settings-section-wide mscl-status-card';
    const title = document.createElement('div');
    title.className = 'gb-section-title';
    title.innerHTML = `${lucide('cloud', 14)} Dropbox`;
    const line1 = document.createElement('div');
    line1.className = 'gb-section-desc';
    line1.textContent = accountLabel ? `Dropbox: 接続済み（${accountLabel}）` : 'Dropbox: 接続済み';
    const line2 = document.createElement('div');
    line2.className = 'gb-section-desc';
    line2.innerHTML = `ソースフォルダはこのDropboxにつないだすべての端末で共通です。 ${_cloudLinkHelp('デスクトップ版MeldexはDropboxアプリ経由で同じフォルダを開けます。')}`;
    card.append(title, line1, line2);

    _appendWorkspaceJoinSection(card, container);
    window.MeldexOfflineShell?.renderSettings?.(card);

    container.innerHTML = '';
    container.appendChild(card);
  }

  function _renderBrowserStatusCard(container) {
    const card = document.createElement('section');
    card.className = 'gb-section gb-section--boxed settings-section-wide mscl-status-card';
    const title = document.createElement('div');
    title.className = 'gb-section-title';
    title.innerHTML = `${lucide('hardDrive', 14)} この端末内に保存`;
    const line1 = document.createElement('div');
    line1.className = 'gb-section-desc';
    line1.textContent = 'アカウントなしで使用中です。ワークスペースとファイルは、このブラウザの端末内ストレージに保存されます。';
    const line2 = document.createElement('div');
    line2.className = 'gb-section-desc';
    line2.textContent = 'Dropboxへ接続しても、現在の端末内データは自動で移動・削除されません。';
    const row = document.createElement('div');
    row.className = 'gb-field-row';
    row.style.cssText = 'justify-content:flex-start;flex-wrap:wrap;gap:8px;margin-top:8px;';
    const connect = document.createElement('button');
    connect.type = 'button';
    connect.className = 'gb-btn gb-btn-sm';
    connect.textContent = 'Dropboxに接続する';
    connect.addEventListener('click', () => {
      if (typeof closeSettingsModalRestoringTheme === 'function') closeSettingsModalRestoringTheme();
      window.MeldexCloudBootstrap?.connectDropbox?.();
    });
    row.appendChild(connect);
    card.append(title, line1, line2, row);
    window.MeldexOfflineShell?.renderSettings?.(card);
    container.replaceChildren(card);
  }

  /* ==============================
     共有ワークスペースへの参加／作成（クラウド版の状態カード専用）
     ============================== */

  function _workspaceLedgerIO() {
    return window.MeldexWorkspaceLedgerIO;
  }

  function _folderPicker() {
    return window.MeldexDropboxFolderPicker;
  }

  async function _confirmYesNo(message) {
    if (typeof cfConfirm === 'function') return cfConfirm(message);
    if (typeof confirm === 'function') return confirm(message);
    return true;
  }

  // 「共有ワークスペースに参加」「このフォルダを共有ワークスペースにする」の
  // 2ボタンと、参加中の共有ワークスペース一覧をカード末尾へ追加する。
  function _appendWorkspaceJoinSection(card, container) {
    const btnRow = document.createElement('div');
    btnRow.className = 'gb-field-row mscl-workspace-join-row';
    btnRow.style.cssText = 'justify-content:flex-start;flex-wrap:wrap;gap:8px;margin-top:8px;';

    const joinBtn = document.createElement('button');
    joinBtn.type = 'button';
    joinBtn.className = 'gb-btn gb-btn-sm';
    joinBtn.textContent = '共有ワークスペースに参加';
    joinBtn.addEventListener('click', () => _joinSharedWorkspace(container, joinBtn));

    const makeBtn = document.createElement('button');
    makeBtn.type = 'button';
    makeBtn.className = 'gb-btn gb-btn-sm';
    makeBtn.textContent = 'このフォルダを共有ワークスペースにする';
    makeBtn.addEventListener('click', () => _makeOrJoinSharedWorkspace(container, makeBtn));

    btnRow.append(joinBtn, makeBtn);
    card.appendChild(btnRow);
    card.appendChild(_buildJoinedWorkspaceList(container));
  }

  function _buildJoinedWorkspaceList(container) {
    const ledgerIO = _workspaceLedgerIO();
    const list = ledgerIO?.listJoinedWorkspaces ? ledgerIO.listJoinedWorkspaces() : [];

    const wrap = document.createElement('div');
    wrap.className = 'mscl-joined-workspace-list';
    wrap.style.cssText = 'margin-top:10px;';

    const heading = document.createElement('div');
    heading.className = 'gb-section-desc';
    heading.style.cssText = 'font-weight:600;';
    heading.textContent = '参加中の共有ワークスペース';
    wrap.appendChild(heading);

    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'gb-section-desc';
      empty.textContent = '参加中の共有ワークスペースはありません';
      wrap.appendChild(empty);
      return wrap;
    }

    list.forEach((ws) => {
      const row = document.createElement('div');
      row.className = 'gb-field-row mscl-joined-workspace-row';
      row.style.cssText = 'justify-content:space-between;align-items:center;margin-top:4px;gap:8px;';

      const label = document.createElement('span');
      label.className = 'gb-section-desc';
      label.textContent = ws?.name || ws?.dropboxPath || '';

      const leaveBtn = document.createElement('button');
      leaveBtn.type = 'button';
      leaveBtn.className = 'gb-btn gb-btn-sm gb-btn-quiet';
      leaveBtn.textContent = '離脱';
      leaveBtn.addEventListener('click', () => _leaveSharedWorkspace(container, ws, leaveBtn));

      row.append(label, leaveBtn);
      wrap.appendChild(row);
    });
    return wrap;
  }

  async function _joinSharedWorkspace(container, btn) {
    const picker = _folderPicker();
    const ledgerIO = _workspaceLedgerIO();
    if (!picker?.pickFolder || !ledgerIO?.addJoinedWorkspace || !ledgerIO?.readWorkspaceLedgerStatus) {
      if (typeof showStatus === 'function') showStatus('参加できませんでした: この端末では利用できません', true);
      return;
    }
    if (btn) btn.disabled = true;
    try {
      const picked = await picker.pickFolder({ title: '参加する共有ワークスペースフォルダを選択', mode: 'workspace' });
      if (!picked || !picked.path) return;
      if (picked.path === '/') {
        if (typeof showStatus === 'function') showStatus('Dropbox全体は共有ワークスペースにできません。中のフォルダを選択してください', true);
        return;
      }

      // 選択画面の絞り込みは検索結果に頼るため取りこぼしがあり得る。参加を記録する前に、
      // そのフォルダが本当に共有ワークスペースかをここで必ず確かめる。読み取りに失敗した
      // ときは「未登録」と決めつけず中断する（「共有ワークスペースにする」導線と同じ作法）。
      let joinStatus = null;
      try {
        joinStatus = await ledgerIO.readWorkspaceLedgerStatus(picked.path, picked.namespaceKind);
      } catch (e) {
        if (typeof showStatus === 'function') showStatus('共有状態を確認できませんでした: ' + _errorText(e), true);
        return;
      }
      if (!joinStatus?.exists) {
        if (typeof showStatus === 'function') {
          showStatus(`「${picked.name}」は共有ワークスペースではありません。共有ワークスペースとして作られたフォルダを選んでください`, true);
        }
        return;
      }

      try {
        ledgerIO.addJoinedWorkspace({
          dropboxPath: picked.path,
          name: picked.name,
          namespaceKind: picked.namespaceKind,
        });
      } catch (e) {
        if (typeof showStatus === 'function') showStatus('参加できませんでした: ' + _errorText(e), true);
        return;
      }
      if (typeof showStatus === 'function') showStatus(`「${picked.name}」に参加しました`);
      if (typeof loadOutliner === 'function') {
        try { await loadOutliner(); } catch { /* フォルダツリーの再読込に失敗しても参加自体は完了しているため処理を止めない */ }
      }
      await renderStatusCard(container);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // 選択したフォルダがまだ共有ワークスペースでなければ、確認の上で新規に
  // 共有ワークスペース化してから参加する。既に共有ワークスペースとして
  // 登録済みの場合は、確認なしで参加のみ行う（作成処理は行わない）。
  async function _makeOrJoinSharedWorkspace(container, btn) {
    const picker = _folderPicker();
    const ledgerIO = _workspaceLedgerIO();
    if (!picker?.pickFolder || !ledgerIO?.readWorkspaceLedgerStatus || !ledgerIO?.writeWorkspaceLedger || !ledgerIO?.addJoinedWorkspace) {
      if (typeof showStatus === 'function') showStatus('共有ワークスペースにできませんでした: この端末では利用できません', true);
      return;
    }
    if (btn) btn.disabled = true;
    try {
      const picked = await picker.pickFolder({ title: '共有ワークスペースにするDropbox内フォルダを選択' });
      if (!picked || !picked.path) return;
      if (picked.path === '/') {
        // Dropbox全体を1つの共有ソース化すると全データが共有対象になる。
        // ほぼ確実に選択ミスなので明示的に拒否する（デスクトップ側APIと同じガード）。
        if (typeof showStatus === 'function') showStatus('Dropbox全体は共有ワークスペースにできません。中のフォルダを選択してください', true);
        return;
      }

      // 【データ保護】共有状態の読み取りに失敗した場合はここで必ず中断する。
      // 一時的な通信障害を「未登録」と誤判定して書き込むと、他メンバーの
      // 登録済みソースフォルダを全置換で消してしまう（敵対的検証 2026-07-21 で
      // 実行再現された事故経路）。「無い」と断定できるのは not_found だけ
      // （readWorkspaceLedgerStatus が exists:false で返す）。
      let ledgerStatus = null;
      try {
        ledgerStatus = await ledgerIO.readWorkspaceLedgerStatus(picked.path, picked.namespaceKind);
      } catch (e) {
        if (typeof showStatus === 'function') showStatus('共有状態を確認できませんでした: ' + _errorText(e), true);
        return;
      }
      const existingRoots = Array.isArray(ledgerStatus?.roots) ? ledgerStatus.roots : [];
      const alreadyWorkspace = existingRoots.some((r) => r && !r.deleted);

      if (!alreadyWorkspace) {
        if (ledgerStatus?.exists && existingRoots.length === 0) {
          // ファイルは実在するのに1件も解釈できない＝壊れているか、より新しい
          // バージョンのMeldexが書いた形式の可能性。上書きすると他メンバーの
          // 共有内容を消しかねないため、作成扱いにせず中断する。
          if (typeof showStatus === 'function') showStatus('このフォルダの共有情報を読み取れませんでした。壊れているか、新しいバージョンのMeldexで作成された可能性があるため、上書きを避けて処理を中止しました', true);
          return;
        }
        const proceed = await _confirmYesNo(
          `「${picked.name}」を共有ワークスペースにします。このフォルダ全体が1つの共有ソースフォルダとして、参加した他のメンバーと共有されます。よろしいですか？`
        );
        if (!proceed) return;

        try {
          // 全ソースが削除済み（削除の記録だけが残っている）場合は、フォルダ自身の
          // 削除記録を取り除いてから登録し直す（削除記録を残したまま追加だけ
          // スキップすると、「共有ワークスペースにしました」と表示されるのに
          // フォルダツリーへ何も出ない空振りになる）。
          const nextRoots = existingRoots.filter((r) => String(r?.relPath || '') !== '');
          nextRoots.push({ provider: 'dropbox', relPath: '', name: picked.name });
          // まだ参加（joined）していないフォルダへの初回書き込みは、直前の確認
          // ダイアログでユーザーが明示同意したこの1回だけ allowUnjoined で許可する
          await ledgerIO.writeWorkspaceLedger(picked.path, nextRoots, picked.namespaceKind, { allowUnjoined: true });
        } catch (e) {
          if (typeof showStatus === 'function') showStatus('共有ワークスペースにできませんでした: ' + _errorText(e), true);
          return;
        }

        try {
          ledgerIO.addJoinedWorkspace({
            dropboxPath: picked.path,
            name: picked.name,
            namespaceKind: picked.namespaceKind,
          });
        } catch (e) {
          if (typeof showStatus === 'function') showStatus('参加できませんでした: ' + _errorText(e), true);
          return;
        }
        if (typeof showStatus === 'function') showStatus(`「${picked.name}」を共有ワークスペースにしました`);
      } else {
        try {
          ledgerIO.addJoinedWorkspace({
            dropboxPath: picked.path,
            name: picked.name,
            namespaceKind: picked.namespaceKind,
          });
        } catch (e) {
          if (typeof showStatus === 'function') showStatus('参加できませんでした: ' + _errorText(e), true);
          return;
        }
        if (typeof showStatus === 'function') showStatus(`「${picked.name}」に共有ワークスペースとして参加しました`);
      }

      if (typeof loadOutliner === 'function') {
        try { await loadOutliner(); } catch { /* フォルダツリーの再読込に失敗しても登録自体は完了しているため処理を止めない */ }
      }
      await renderStatusCard(container);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function _leaveSharedWorkspace(container, ws, btn) {
    const ledgerIO = _workspaceLedgerIO();
    const label = ws?.name || ws?.dropboxPath || 'このワークスペース';
    const proceed = await _confirmYesNo(
      `「${label}」から離脱しますか？このワークスペースのフォルダがフォルダツリーから消えます（Dropbox上のフォルダ自体は消えません）`
    );
    if (!proceed) return;
    if (btn) btn.disabled = true;
    try {
      ledgerIO?.removeJoinedWorkspace?.(ws?.id);
    } catch (e) {
      if (typeof showStatus === 'function') showStatus('離脱できませんでした: ' + _errorText(e), true);
      if (btn) btn.disabled = false;
      return;
    }
    if (typeof loadOutliner === 'function') {
      try { await loadOutliner(); } catch { /* フォルダツリーの再読込に失敗しても離脱自体は完了しているため処理を止めない */ }
    }
    await renderStatusCard(container);
  }

  // 同期フォルダが見つかっている（自動検出・手動指定いずれか、または複数候補が
  // 未選択のambiguousな状態も含む）場合の本文行と「指定し直す…」導線を組み立てる。
  function _appendSyncRootFoundLines(card, container, status, sharedCount) {
    const line1 = document.createElement('div');
    line1.className = 'gb-section-desc';
    if (status.activeSyncRoot) {
      line1.textContent = status.syncRootSource === 'manual'
        ? `Dropboxの同期フォルダ: ${status.activeSyncRoot}（手動で指定）`
        : `Dropboxアプリ: 検出済み（${status.activeSyncRoot}）`;
    } else {
      line1.textContent = 'Dropboxアプリ: 検出済み（同期フォルダを下から選んでください）';
    }
    const line2 = document.createElement('div');
    line2.className = 'gb-section-desc';
    line2.textContent = sharedCount
      ? `共有ソースフォルダ: ${sharedCount}件（ブラウザ版Meldexと共通）`
      : '共有中のソースフォルダはまだありません';
    card.append(line1, line2);
    if (!status.activeSyncRoot) return;

    // 自動検出・手動指定のどちらでも、間違えた場合に選び直せる導線を常設する
    const redoRow = document.createElement('div');
    redoRow.className = 'gb-field-row';
    redoRow.style.cssText = 'justify-content:flex-start;margin-top:6px;';
    const redoBtn = document.createElement('button');
    redoBtn.type = 'button';
    redoBtn.className = 'gb-btn gb-btn-sm gb-btn-quiet';
    redoBtn.textContent = '指定し直す…';
    redoBtn.addEventListener('click', () => _specifyDropboxSyncRoot(container, redoBtn));
    redoRow.appendChild(redoBtn);
    card.appendChild(redoRow);
  }

  function _appendSyncRootNotFoundPrompt(card, container) {
    const line1 = document.createElement('div');
    line1.className = 'gb-section-desc';
    line1.innerHTML = `Dropboxアプリが見つかりません。 ${_cloudLinkHelp('Dropboxの中にデータを置くと、ブラウザ版Meldexや他のPCと共有できます。')}`;
    card.appendChild(line1);

    const btnRow = document.createElement('div');
    btnRow.className = 'gb-field-row';
    btnRow.style.cssText = 'justify-content:flex-start;margin-top:6px;';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gb-btn gb-btn-sm';
    btn.textContent = 'フォルダを指定…';
    btn.addEventListener('click', () => _specifyDropboxSyncRoot(container, btn));
    btnRow.appendChild(btn);
    card.appendChild(btnRow);
  }

  function _statusCacheFingerprint() {
    try { return JSON.stringify(_statusCache); } catch { return null; }
  }

  // 状態取得の完了直後に一覧のバッジを描き直す。状態は同期フォルダ指定・場所確認・
  // 共有切替の直後にも変わるため、初回限りではなく取得成功のたびに呼ばれる
  // （内容が変わっていない場合はフィンガープリント比較で掛け直しを省略する）。
  //
  // サーバーから読み直す（loadOutlinerRootsForSettings）と、状態取得の待ち時間中に
  // ユーザーが行った未保存の編集（削除・改名・表示切替）が黙って捨てられ、未保存
  // フラグまで false に戻ってしまう。また renderOutlinerRootsSettings() による全再構築も、
  // 名前入力中にフォーカス・キャレットが飛ぶため避ける。行DOM（renderOutlinerRootsSettings
  // 側で row.__msclRoot に控えられたroot）を走査し、バッジ部分だけを decorateRootRow で
  // 掛け直す。行にrootを紐付けられない場合（一覧が空・読み込み失敗表示中等）だけ、
  // メモリ上の一覧をそのまま描き直す従来経路にフォールバックする。
  function _redecorateRootRowsOnce() {
    const container = document.getElementById('modal-outliner-roots');
    if (!container) return;
    const fingerprint = _statusCacheFingerprint();
    if (fingerprint !== null && fingerprint === _lastRedecorateFingerprint) return;
    _lastRedecorateFingerprint = fingerprint;
    const rows = Array.from(container.children || []).filter((row) => row && row.__msclRoot);
    if (!rows.length) {
      if (typeof renderOutlinerRootsSettings === 'function') {
        try { renderOutlinerRootsSettings(); } catch { /* 描き直しの失敗は状態カードの表示を妨げない */ }
      }
      return;
    }
    rows.forEach((row) => {
      try { decorateRootRow(row, row.__msclRoot); } catch { /* 1行の失敗で他行の描き直しを止めない */ }
    });
  }

  async function _renderDesktopStatusCard(container) {
    let status = null;
    try {
      status = await apiFetch('/dropbox-link/status', { silentError: true });
    } catch (e) {
      _statusCache = null;
      _statusCacheOk = false;
      container.innerHTML = '';
      return;
    }
    _statusCache = status;
    _statusCacheOk = true;
    // ソースフォルダ一覧の描画は状態取得と並行して走るため、初回はバッジ判定の
    // 時点で状態が未取得（decorateRootRow が何も付けずに戻る）になる。また
    // 同期フォルダ指定・場所確認・共有切替の直後は状態の中身自体が変わる
    // （場所を確認済みになる、needsMappingが外れる等）。初回限りではなく、
    // 状態取得が成功するたびに掛け直す（フィンガープリントが同じ場合は内部で
    // 省略される）。
    _redecorateRootRowsOnce();

    const card = document.createElement('section');
    card.className = 'gb-section gb-section--boxed settings-section-wide mscl-status-card';
    const title = document.createElement('div');
    title.className = 'gb-section-title';
    title.innerHTML = `${lucide('cloud', 14)} Dropbox`;
    card.appendChild(title);

    const sharedCount = Array.isArray(status?.roots) ? status.roots.length : 0;

    // 分岐は「自動検出できたか(detected)」ではなく「同期フォルダが有効か」で行う。
    // 手動指定（フォルダを指定…）で成功した場合、候補は0件（detected:false）のまま
    // activeSyncRoot だけが決まることがあるため、detected と activeSyncRoot の
    // どちらかが真であれば「見つかっている」側として扱う。これにより、自動検出に
    // 失敗しても手動指定が成功していれば「見つかりません」を再表示しない。
    // （複数候補が未選択のambiguousな状態は detected:true / activeSyncRoot:null で
    // 表現され、その場合も「見つかっている」側で「下から選んでください」を出す）
    if (status?.detected || status?.activeSyncRoot) {
      _appendSyncRootFoundLines(card, container, status, sharedCount);
    } else {
      _appendSyncRootNotFoundPrompt(card, container);
    }

    const explain = document.createElement('div');
    explain.className = 'gb-section-desc';
    explain.style.marginTop = '6px';
    explain.innerHTML = `Dropboxの中に置いたソースフォルダは、同じDropboxにつないだブラウザ版Meldexや他のPCにも自動で表示されます。 ${_cloudLinkHelp('共有の設定はDropbox内に保存されます。')}`;
    card.appendChild(explain);

    await _appendDesktopWorkspaceJoinSection(card, container);

    const candidates = Array.isArray(status?.candidates) ? status.candidates : [];
    if (candidates.length > 1) {
      card.appendChild(_buildCandidateSwitchRow(container, status, candidates));
    }

    container.innerHTML = '';
    container.appendChild(card);

    await _maybeAppendVaultOptIn(card, container, status);
  }

  function _candidateLabel(candidate) {
    const kind = candidate?.account_kind === 'business' ? 'Business' : '個人';
    const team = candidate?.is_team ? '（チーム）' : '';
    return `${kind}${team}: ${candidate?.local_root || ''}`;
  }

  function _buildCandidateSwitchRow(container, status, candidates) {
    const row = document.createElement('div');
    row.className = 'gb-field-row mscl-candidate-row';
    const label = document.createElement('span');
    label.className = 'gb-label';
    label.textContent = '同期フォルダ:';
    const select = document.createElement('select');
    select.className = 'gb-select';
    candidates.forEach((candidate) => {
      const opt = document.createElement('option');
      opt.value = candidate.local_root;
      opt.textContent = _candidateLabel(candidate);
      if (candidate.local_root === status.activeSyncRoot) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', async () => {
      const value = select.value;
      select.disabled = true;
      try {
        await apiPut('/dropbox-link/sync-root', { localRoot: value });
        if (typeof showStatus === 'function') showStatus('同期フォルダを切り替えました');
      } catch (e) {
        if (typeof showStatus === 'function') showStatus('切り替えできませんでした: ' + _errorText(e), true);
      }
      await renderStatusCard(container);
    });
    row.append(label, select);
    return row;
  }

  async function _specifyDropboxSyncRoot(container, btn) {
    if (btn) btn.disabled = true;
    if (typeof showStatus === 'function') showStatus('フォルダ選択ダイアログを開いています...');
    let path = null;
    try {
      const res = await apiFetch('/add-outliner-root', { method: 'POST' });
      if (res.ok && res.path) path = res.path;
      else if (res.needManualInput && typeof _promptFolderPath === 'function') path = await _promptFolderPath();
      else if (typeof showStatus === 'function') showStatus('キャンセルされました');
    } catch (e) {
      if (typeof _promptFolderPath === 'function') path = await _promptFolderPath();
    }
    if (path) {
      try {
        await apiPut('/dropbox-link/sync-root', { localRoot: path });
        if (typeof showStatus === 'function') showStatus('Dropbox同期フォルダを設定しました');
      } catch (e) {
        if (typeof showStatus === 'function') showStatus('Dropbox同期フォルダを設定できませんでした: ' + _errorText(e), true);
      }
    }
    if (btn) btn.disabled = false;
    await renderStatusCard(container);
  }

  function _sameLocalPath(root, targetPath) {
    if (!root) return false;
    const target = _normPath(targetPath);
    const candidatePaths = [];
    if (root.localPath) candidatePaths.push(root.localPath);
    if (!(root.provider === 'dropbox' || root.dropboxPath) && root.path) candidatePaths.push(root.path);
    return candidatePaths.some((p) => _normPath(p) === target);
  }

  async function _maybeAppendVaultOptIn(card, container, status) {
    if (!status?.activeSyncRoot) return;
    let vault = null;
    try {
      vault = await apiFetch('/vault', { silentError: true });
    } catch {
      return;
    }
    const vaultPath = String(vault?.path || '').trim();
    if (!vaultPath) return;
    const syncNorm = _normPath(status.activeSyncRoot);
    const vaultNorm = _normPath(vaultPath);
    const underSyncRoot = vaultNorm === syncNorm || vaultNorm.startsWith(syncNorm + '/');
    if (!underSyncRoot) return;
    const alreadyShared = (Array.isArray(status.roots) ? status.roots : [])
      .some((r) => r?.localPath && _normPath(r.localPath) === vaultNorm);
    if (alreadyShared) return;
    if (card.isConnected === false) return; // 再描画中に古いカードへ追加しない

    const wrap = document.createElement('div');
    wrap.className = 'gb-field-row mscl-vault-optin';
    const label = document.createElement('span');
    label.className = 'gb-section-desc';
    label.textContent = `メインの保存先「${vault?.name || _pathBasename(vaultPath)}」もDropboxの中にあります`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gb-btn gb-btn-sm';
    btn.textContent = '他の端末とも共有する';
    btn.addEventListener('click', () => _optInVaultSharing(container, vaultPath, vault, btn));
    wrap.append(label, btn);
    card.appendChild(wrap);
  }

  async function _optInVaultSharing(container, vaultPath, vault, btn) {
    if (btn) btn.disabled = true;
    try {
      const roots = await apiFetch('/outliner-roots');
      const already = (Array.isArray(roots) ? roots : []).some((r) => _sameLocalPath(r, vaultPath));
      const nextRoots = Array.isArray(roots) ? roots.slice() : [];
      if (!already) nextRoots.push({ path: vaultPath, name: vault?.name || _pathBasename(vaultPath), visible: true });
      await apiPut('/outliner-roots', { roots: nextRoots });
      if (typeof showStatus === 'function') showStatus('保存先をDropboxで共有しました');
      // サーバーから丸ごと読み直す（loadOutlinerRootsForSettings）と、設定ダイアログ内の
      // 未保存の編集（削除・改名・表示切替）が黙って捨てられ、未保存フラグまで戻って
      // しまう。サーバー由来のフィールドだけをメモリ上の一覧へマージする。
      if (typeof mergeServerOutlinerRootsIntoSettings === 'function') {
        try { await mergeServerOutlinerRootsIntoSettings(); } catch {}
      }
    } catch (e) {
      if (typeof showStatus === 'function') showStatus('共有を開始できませんでした: ' + _errorText(e), true);
    }
    if (btn) btn.disabled = false;
    await renderStatusCard(container);
  }

  /* ==============================
     共有ワークスペースへの参加／ワークスペース化（デスクトップ版の状態カード専用）

     クラウド版の _joinSharedWorkspace 等（ブラウザから直接Dropbox APIを叩く
     クライアント側モジュール経由）とは別経路。デスクトップ版はネイティブの
     フォルダ選択ダイアログ + サーバー側の
     /api/dropbox-link/pick-workspace-folder・/join-workspace・
     /joined-workspaces・/leave-workspace を使う。
     ============================== */

  // フォルダ選択→（ネイティブダイアログ失敗時は）手入力フォールバックの一連の
  // 流れをボタン1・ボタン2で共通化する。戻り値は成功時 { ok:true, path, name }、
  // 選択できなかった場合は null。
  async function _desktopPickWorkspaceFolder() {
    let res = null;
    try {
      res = await apiFetch('/dropbox-link/pick-workspace-folder', { method: 'POST' });
    } catch (e) {
      res = null;
    }
    if (res?.ok && res.path) return res;
    if (res?.needManualInput && typeof _promptFolderPath === 'function') {
      const manualPath = await _promptFolderPath();
      if (!manualPath) return null;
      try {
        // apiFetch は Content-Type ヘッダを自動付与しない。文字列bodyのみだと
        // ブラウザのfetchはデフォルトで text/plain を付けるため、FastAPI側の
        // dict Body解析が失敗し422になる（test_meldex_smart_sheet_filter_save_content_type.py
        // に記録された既知の失敗パターンと同じ）。明示的にJSONヘッダを付ける。
        const validated = await apiFetch('/dropbox-link/pick-workspace-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: manualPath }),
        });
        if (validated?.ok && validated.path) return validated;
        if (typeof showStatus === 'function') showStatus(validated?.error || 'フォルダが見つかりません', true);
      } catch (e) {
        if (typeof showStatus === 'function') showStatus('フォルダを確認できませんでした: ' + _errorText(e), true);
      }
      return null;
    }
    if (typeof showStatus === 'function') showStatus('キャンセルされました');
    return null;
  }

  async function _desktopCallJoinWorkspace(localPath, createIfEmpty) {
    return apiFetch('/dropbox-link/join-workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ localPath, createIfEmpty: !!createIfEmpty }),
    });
  }

  async function _afterDesktopWorkspaceChange(container) {
    if (typeof loadOutliner === 'function') {
      try { await loadOutliner(); } catch { /* フォルダツリーの再読込に失敗しても参加/離脱自体は完了しているため処理を止めない */ }
    }
    await renderStatusCard(container);
  }

  async function _desktopJoinWorkspace(container, btn) {
    if (btn) btn.disabled = true;
    try {
      if (typeof showStatus === 'function') showStatus('フォルダ選択ダイアログを開いています...');
      const picked = await _desktopPickWorkspaceFolder();
      if (!picked) return;
      try {
        const res = await _desktopCallJoinWorkspace(picked.path, false);
        if (typeof showStatus === 'function') showStatus(`「${res?.workspace?.name || picked.name || ''}」に参加しました`);
      } catch (e) {
        if (typeof showStatus === 'function') showStatus('参加できませんでした: ' + _errorText(e), true);
        return;
      }
      await _afterDesktopWorkspaceChange(container);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function _desktopMakeWorkspace(container, btn) {
    if (btn) btn.disabled = true;
    try {
      if (typeof showStatus === 'function') showStatus('フォルダ選択ダイアログを開いています...');
      const picked = await _desktopPickWorkspaceFolder();
      if (!picked) return;

      const label = picked.name || _pathBasename(picked.path) || 'このフォルダ';
      const proceed = await _confirmYesNo(
        `「${label}」を共有ワークスペースにします。このフォルダ全体が1つの共有ソースフォルダとして、参加した他のメンバーと共有されます。よろしいですか？`
      );
      if (!proceed) return;

      try {
        const res = await _desktopCallJoinWorkspace(picked.path, true);
        if (typeof showStatus === 'function') showStatus(`「${res?.workspace?.name || label}」を共有ワークスペースにしました`);
      } catch (e) {
        if (typeof showStatus === 'function') showStatus('共有ワークスペースにできませんでした: ' + _errorText(e), true);
        return;
      }
      await _afterDesktopWorkspaceChange(container);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function _desktopLeaveWorkspace(container, ws, btn) {
    const label = ws?.name || ws?.dropboxPath || 'このワークスペース';
    const proceed = await _confirmYesNo(
      `「${label}」から離脱しますか？このワークスペースのフォルダがフォルダツリーから消えます（Dropbox上のフォルダ自体は消えません）`
    );
    if (!proceed) return;
    if (btn) btn.disabled = true;
    try {
      await apiFetch('/dropbox-link/leave-workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ws?.id }),
      });
      if (typeof showStatus === 'function') showStatus(`「${label}」から離脱しました`);
    } catch (e) {
      if (typeof showStatus === 'function') showStatus('離脱できませんでした: ' + _errorText(e), true);
      if (btn) btn.disabled = false;
      return;
    }
    await _afterDesktopWorkspaceChange(container);
  }

  async function _buildDesktopJoinedWorkspaceList(container) {
    const wrap = document.createElement('div');
    wrap.className = 'mscl-joined-workspace-list';
    wrap.style.cssText = 'margin-top:10px;';

    const heading = document.createElement('div');
    heading.className = 'gb-section-desc';
    heading.style.cssText = 'font-weight:600;';
    heading.textContent = '参加中の共有ワークスペース';
    wrap.appendChild(heading);

    let list = [];
    try {
      const res = await apiFetch('/dropbox-link/joined-workspaces', { silentError: true });
      list = Array.isArray(res?.workspaces) ? res.workspaces : [];
    } catch (e) {
      list = [];
    }

    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'gb-section-desc';
      empty.textContent = '参加中の共有ワークスペースはありません';
      wrap.appendChild(empty);
      return wrap;
    }

    list.forEach((ws) => {
      const row = document.createElement('div');
      row.className = 'gb-field-row mscl-joined-workspace-row';
      row.style.cssText = 'justify-content:space-between;align-items:center;margin-top:4px;gap:8px;';

      const label = document.createElement('span');
      label.className = 'gb-section-desc';
      label.textContent = ws?.name || ws?.dropboxPath || '';

      const leaveBtn = document.createElement('button');
      leaveBtn.type = 'button';
      leaveBtn.className = 'gb-btn gb-btn-sm gb-btn-quiet';
      leaveBtn.textContent = '離脱';
      leaveBtn.addEventListener('click', () => _desktopLeaveWorkspace(container, ws, leaveBtn));

      row.append(label, leaveBtn);
      wrap.appendChild(row);
    });
    return wrap;
  }

  // 「共有ワークスペースに参加」「このフォルダを共有ワークスペースにする」の
  // 2ボタンと、参加中の共有ワークスペース一覧をデスクトップ版の状態カード末尾へ追加する。
  async function _appendDesktopWorkspaceJoinSection(card, container) {
    const btnRow = document.createElement('div');
    btnRow.className = 'gb-field-row mscl-workspace-join-row';
    btnRow.style.cssText = 'justify-content:flex-start;flex-wrap:wrap;gap:8px;margin-top:8px;';

    const joinBtn = document.createElement('button');
    joinBtn.type = 'button';
    joinBtn.className = 'gb-btn gb-btn-sm';
    joinBtn.textContent = '共有ワークスペースに参加';
    joinBtn.addEventListener('click', () => _desktopJoinWorkspace(container, joinBtn));

    const makeBtn = document.createElement('button');
    makeBtn.type = 'button';
    makeBtn.className = 'gb-btn gb-btn-sm';
    makeBtn.textContent = 'このフォルダを共有ワークスペースにする';
    makeBtn.addEventListener('click', () => _desktopMakeWorkspace(container, makeBtn));

    btnRow.append(joinBtn, makeBtn);
    card.appendChild(btnRow);
    card.appendChild(await _buildDesktopJoinedWorkspaceList(container));
  }

  /* ==============================
     ソースフォルダ一覧の行バッジ
     ============================== */

  // 状態カードのAPI応答（/dropbox-link/status の unsharedLocalFolders）から、
  // このrootが「同期フォルダ配下だが未共有」の一覧に載っているかを調べる。
  // sourceId優先、無ければ実パス(localPath/path)の正規化一致で照合する。
  function _pendingShareEntryFor(root) {
    const list = Array.isArray(_statusCache?.unsharedLocalFolders) ? _statusCache.unsharedLocalFolders : [];
    if (!list.length) return null;
    const sourceId = root?.sourceId || root?.id;
    const targetPath = root?.localPath || root?.path || '';
    const targetNorm = targetPath ? _normPath(targetPath) : '';
    return list.find((entry) => {
      if (sourceId && entry?.sourceId && entry.sourceId === sourceId) return true;
      if (targetNorm && entry?.localPath && _normPath(entry.localPath) === targetNorm) return true;
      return false;
    }) || null;
  }

  // 共有設定を実際に読めている場合だけ、dropbox provider root の実際の共有状態
  // （/dropbox-link/status の roots[].state）を返す。共有設定が未ダウンロード
  // （オンラインのみ・初回同期前）の間は null を返し、呼び出し側を
  // 「常にshared扱い」の従来判定へフォールバックさせる（全件が誤ってlocal-only
  // 表示になることを防ぐ）。一覧に該当フォルダが無い場合も同様にnullを返す。
  function _rootSyncStateFor(root) {
    if (!_statusCache?.ledger?.found) return null;
    const list = Array.isArray(_statusCache.roots) ? _statusCache.roots : [];
    const sourceId = root?.sourceId || root?.id;
    const dropboxKey = root?.dropboxPath ? _normPath(root.dropboxPath) : '';
    const match = list.find((r) => {
      if (sourceId && r?.sourceId && r.sourceId === sourceId) return true;
      if (dropboxKey && r?.dropboxPath && _normPath(r.dropboxPath) === dropboxKey) return true;
      return false;
    });
    return match ? match.state : null;
  }

  // 非dropbox-provider（プレーンなローカルパス）rootのバッジを判定する。
  // 同期フォルダ配下にあり、まだ共有設定へ登録されていないフォルダはクリックで
  // 共有を提案できる。配下でない場合は移動手順を案内する（検出済みの同期フォルダ
  // が無ければ案内のしようがないため非クリックのまま）。
  function _localOnlyBadgeSpec(root) {
    if (_pendingShareEntryFor(root)) {
      return {
        kind: 'local-only',
        label: 'この端末のみ',
        title: 'このPCだけで使うフォルダです。クリックすると他の端末とも共有できます',
        clickable: true,
        action: 'share',
      };
    }
    const syncRoot = _statusCache?.activeSyncRoot || '';
    return {
      kind: 'local-only',
      label: 'この端末のみ',
      title: syncRoot
        ? `このPCだけで使うフォルダです。Dropboxの同期フォルダ（${syncRoot}）の中にフォルダを移動すると、他の端末とも共有できます`
        : 'このPCだけで使うフォルダです。Dropboxの中に置くと他の端末とも共有できます',
      clickable: !!syncRoot,
      action: 'move-instructions',
    };
  }

  function _rootBadgeSpec(root) {
    if (_isCloudMode()) {
      return {
        kind: 'shared',
        label: '共有中',
        title: 'このフォルダはDropboxを通じて他の端末・ブラウザ版Meldexと共有されています',
        clickable: false,
      };
    }
    if (!_statusCacheOk) return null; // 状態未取得の間はバッジを出さない
    const isDropboxBacked = !!(root && (root.provider === 'dropbox' || root.dropboxPath));
    if (!isDropboxBacked) return _localOnlyBadgeSpec(root);
    if (root.needsMapping) {
      return {
        kind: 'needs-mapping',
        label: '場所を確認',
        title: '他の端末で追加されたフォルダです。このPCでの場所を確認すると開けるようになります。'
          + 'このPCにフォルダがまだ同期されていない場合は、Dropboxアプリで「オフラインで使用」を有効にすると開けるようになります',
        clickable: true,
      };
    }
    // サーバー算出の共有状態を反映する。共有設定を実際に読めていて、かつ一覧上に
    // このフォルダが見つかり、まだ共有(shared)に達していない場合だけ降格する
    // （未共有のフォルダに「共有中」を出さない）。
    const syncState = _rootSyncStateFor(root);
    if (syncState && syncState !== 'shared') {
      return {
        kind: 'local-only',
        label: 'この端末のみ',
        title: 'このフォルダはまだ他の端末に反映されていません。もう一度保存すると共有されます',
        clickable: false,
      };
    }
    return {
      kind: 'shared',
      label: '共有中',
      title: 'このフォルダはDropboxを通じて他の端末・ブラウザ版Meldexと共有されています',
      clickable: false,
    };
  }

  function decorateRootRow(rowEl, root) {
    if (!rowEl) return;
    _injectStyles();
    const existing = rowEl.querySelector('.mscl-root-badge');
    if (existing) existing.remove();
    const spec = _rootBadgeSpec(root);
    if (!spec) return;

    const badge = document.createElement('span');
    badge.className = 'mscl-root-badge mscl-root-badge--' + spec.kind;
    badge.textContent = spec.label;
    badge.title = spec.title;
    badge.dataset.gbTooltip = spec.title;

    if (spec.clickable) {
      badge.tabIndex = 0;
      badge.setAttribute('role', 'button');
      const activate = (e) => {
        e.preventDefault?.();
        e.stopPropagation?.();
        if (spec.kind === 'needs-mapping') return confirmSourceFolderLocation(root);
        if (spec.action === 'share') return confirmShareSourceFolder(root);
        if (spec.action === 'move-instructions') return showMoveFolderIntoSyncRootInstructions(root);
        return undefined;
      };
      badge.addEventListener('click', activate);
      badge.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') activate(e);
      });
    }

    const deleteBtn = rowEl.querySelector('.or-delete');
    if (deleteBtn) rowEl.insertBefore(badge, deleteBtn);
    else rowEl.appendChild(badge);
  }

  /* ==============================
     「場所を確認」導線
     ============================== */

  async function confirmSourceFolderLocation(root) {
    const sourceId = root?.sourceId || root?.id;
    if (!sourceId) {
      if (typeof showStatus === 'function') showStatus('ソースフォルダの情報が見つかりません', true);
      return;
    }
    if (typeof showStatus === 'function') showStatus('フォルダ選択ダイアログを開いています...');
    let path = null;
    try {
      const res = await apiFetch('/add-outliner-root', { method: 'POST' });
      if (res.ok && res.path) {
        path = res.path;
      } else if (res.needManualInput && typeof _promptFolderPath === 'function') {
        path = await _promptFolderPath();
      } else {
        if (typeof showStatus === 'function') showStatus('キャンセルされました');
        return;
      }
    } catch (e) {
      if (typeof _promptFolderPath === 'function') path = await _promptFolderPath();
    }
    if (!path) return;
    try {
      await apiPut('/source-folder-local-mappings', { sourceId, localPath: path });
      if (typeof showStatus === 'function') showStatus('このPCでの場所を確認しました');
    } catch (e) {
      if (typeof showStatus === 'function') showStatus('場所を確認できませんでした: ' + _errorText(e), true);
      return;
    }
    if (typeof loadOutliner === 'function') {
      try { await loadOutliner(); } catch {}
    }
    // サーバーから丸ごと読み直す（loadOutlinerRootsForSettings）と、設定ダイアログ内の
    // 未保存の編集（削除・改名・表示切替）が黙って捨てられ、未保存フラグまで戻って
    // しまう。サーバー由来のフィールドだけをメモリ上の一覧へマージする。
    if (typeof mergeServerOutlinerRootsIntoSettings === 'function' && document.getElementById('modal-outliner-roots')) {
      try { await mergeServerOutlinerRootsIntoSettings(); } catch {}
    }
    // 状態カードが開いていればバッジ判定も更新する
    const card = document.getElementById('settings-cloud-link-card');
    if (card) {
      try { await renderStatusCard(card); } catch {}
    }
  }

  /* ==============================
     「この端末のみ」バッジからの共有導線
     ============================== */

  // 同期フォルダ配下にあるが未共有のフォルダを、既存の保存経路
  // （GET /outliner-roots → PUT /outliner-roots）で共有する。共有設定への
  // 書き込みを直接呼ばない — サーバー側の保存処理が、同期フォルダ配下の
  // ローカルrootを自動的にdropbox providerへ昇格させ共有設定へ登録するため、
  // 内容を変更せずに保存し直すだけで共有が始まる。
  async function _shareLocalOnlyRoot(root) {
    const targetPath = root?.path || root?.localPath || '';
    // 設定ダイアログに未保存の編集がある状態でここへ進むと、下のGET結果は
    // その編集を反映していないまま保存し直されてしまい、末尾の一覧再読み込みが
    // 未保存の削除・改名・表示切替を黙って捨ててしまう。先に保存させる。
    if (window._settingsOutlinerRootsDirty) {
      if (typeof showStatus === 'function') showStatus('先に設定を保存してから、もう一度お試しください', true);
      return;
    }
    if (typeof showStatus === 'function') showStatus('共有を開始しています...');
    try {
      const roots = await apiFetch('/outliner-roots');
      const list = Array.isArray(roots) ? roots : [];
      if (!list.some((r) => _sameLocalPath(r, targetPath))) {
        // 設定ダイアログ内で追加してまだ保存していない場合はここに来る。
        // 他端末分の共有設定を巻き込んで消さないよう、ここでは保存を試みない。
        if (typeof showStatus === 'function') showStatus('先に設定を保存してから、もう一度お試しください', true);
        return;
      }
      await apiPut('/outliner-roots', { roots: list });
      if (typeof showStatus === 'function') showStatus('このフォルダを他の端末とも共有します');
    } catch (e) {
      if (typeof showStatus === 'function') showStatus('共有を開始できませんでした: ' + _errorText(e), true);
      return;
    }
    if (typeof loadOutlinerRootsForSettings === 'function' && document.getElementById('modal-outliner-roots')) {
      try { await loadOutlinerRootsForSettings(); } catch {}
    }
    if (typeof loadOutliner === 'function') {
      try { await loadOutliner(); } catch {}
    }
    const card = document.getElementById('settings-cloud-link-card');
    if (card) {
      try { await renderStatusCard(card); } catch {}
    }
  }

  async function confirmShareSourceFolder(root) {
    const label = root?.name || _pathBasename(root?.path || root?.localPath || '') || 'このフォルダ';
    if (typeof cfConfirm === 'function') {
      const proceed = await cfConfirm(
        `「${label}」を他の端末とも共有しますか？ Dropboxを通じて、ブラウザ版Meldexや他のPCにも表示されるようになります。`
      );
      if (!proceed) return;
    }
    await _shareLocalOnlyRoot(root);
  }

  async function showMoveFolderIntoSyncRootInstructions(root) {
    const syncRoot = _statusCache?.activeSyncRoot || '';
    const label = root?.name || _pathBasename(root?.path || root?.localPath || '') || 'このフォルダ';
    const message = syncRoot
      ? `「${label}」を他の端末とも共有するには、フォルダをDropboxの同期フォルダ（${syncRoot}）の中に移動し、Meldexでソースフォルダのパスを変更してください。`
      : `「${label}」を他の端末とも共有するには、Dropboxの同期フォルダの中にフォルダを移動してください。`;
    if (typeof cfAlert === 'function') await cfAlert(message);
  }

  /* ==============================
     ソースフォルダ削除時の確認
     ============================== */

  // 削除確認の要否を「共有中バッジか」から切り離して判定する。バッジ表示（
  // _rootBadgeSpec）は「見た目としてどう見せるか」のためのもので、「場所を確認」
  // 待ちの行（needsMapping）や、共有設定がまだ読めていない行（unknown）はバッジ上は
  // shared と表示されないが、削除すれば他端末・クラウド版の一覧からも消える点は
  // 共有中の行と同じ。確認要否はこの3区分＋純ローカルで別に持つ。
  //
  // 注意: needsMapping の判定順序は _rootBadgeSpec 側（内部で絶対に動かさないこと。
  // 動かすと「場所を確認」導線が壊れる）と同じ意味で使うが、本関数はバッジ表示とは
  // 独立した専用の述語として持つ。
  function _rootDeletionScope(root) {
    if (_isCloudMode()) return 'shared';
    if (root?.needsMapping) return 'remote'; // 他端末が登録し、このPCで未確認
    const isDropboxBacked = !!(root && (root.provider === 'dropbox' || root.dropboxPath));
    if (!isDropboxBacked) return 'local';
    if (!_statusCacheOk) return 'unknown'; // 状態が取れていない＝安全側で確認
    return _rootSyncStateFor(root) === 'shared' ? 'shared' : 'local';
  }

  const _ROOT_DELETION_CONFIRM_MESSAGES = {
    shared: (label) => `「${label}」を一覧から外しますか？ 他の端末やクラウド版の一覧からも表示されなくなります（フォルダの中身は削除されません）。`,
    remote: (label) => `「${label}」は他の端末で追加されたフォルダです。一覧から外すと、他の端末やクラウド版の一覧からも表示されなくなります（フォルダの中身は削除されません）。`,
    unknown: (label) => `「${label}」は他の端末と共有されている可能性があります。一覧から外しますか？（フォルダの中身は削除されません）`,
  };

  async function confirmDeleteSourceFolder(root) {
    const scope = _rootDeletionScope(root);
    if (scope === 'local') return true;
    if (typeof cfConfirm !== 'function') return true;
    const label = root?.name || _pathBasename(root?.path || root?.localPath || root?.dropboxPath || '') || 'このフォルダ';
    const buildMessage = _ROOT_DELETION_CONFIRM_MESSAGES[scope] || _ROOT_DELETION_CONFIRM_MESSAGES.shared;
    // 確定ボタンは「登録解除」を明示指定する（cfConfirmは既定でメッセージ文中の「削除」を
    // 検出してボタンラベルを自動決定するため、指定しないとメッセージ中の「削除されません」に
    // 反応して「削除」ボタンになってしまう）。
    return await cfConfirm(buildMessage(label), { okLabel: '登録解除' });
  }

  window.MeldexSettingsCloudLink = {
    renderStatusCard,
    decorateRootRow,
    confirmSourceFolderLocation,
    confirmShareSourceFolder,
    showMoveFolderIntoSyncRootInstructions,
    confirmDeleteSourceFolder,
  };
})();
