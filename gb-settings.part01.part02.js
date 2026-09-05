  return notice;
}

function _isWorkspaceOutlinerRoot(root) {
  // kind==='workspace' はコラボワークスペース（既存機能）、
  // origin が 'ws:' で始まるのはDropboxフォルダ単位共有②の参加中ワークスペース
  // （フェーズ3c）。workspaceId はクラウド側の合流結果にのみ付与されるため
  // 判定に使わない（デスクトップ側の合流結果には無く、それだけに頼ると
  // デスクトップだけソースフォルダ一覧に共有ワークスペースが紛れ込む）。
  return !!root && (root.kind === 'workspace' || typeof root.origin === 'string' && root.origin.startsWith('ws:'));
}

// ワークスペース由来ルートの控え（ソースフォルダ追加時の重複案内に使う）
let _settingsWorkspaceOutlinerRoots = [];

// クライアントが直近のGETで実際に見ていたソースフォルダ一覧（合流後スナップショット）の控え。
// 保存時にサーバーへ送り返し、台帳への削除印(tombstone)判定の基準として使わせる。
// 台帳にしか存在しないroot（他端末・クラウド版が追加したもの）を削除した場合でも、
// この控えに含まれているため正しく削除印を付けられる（保存前の設定ファイルの中身
// だけを基準にすると、台帳合流分の削除が検出できず次回読み込みで復活してしまう）。
let _outlinerRootsBaseline = [];

// ドラッグ&ドロップ並べ替え中の元インデックス（未ドラッグ時は-1）。
let _outlinerRootsDragIdx = -1;

// _outlinerRoots は行編集（visible/name変更）でオブジェクトを直接ミューテートするため、
// 参照を共有したまま控えると控え側まで書き換わってしまう。JSONの深いクローンで
// 独立させる。roots はサーバーが返すプレーンなJSON値のみを想定する。
function _cloneOutlinerRootsBaseline(roots) {
  try {
    return JSON.parse(JSON.stringify(Array.isArray(roots) ? roots : []));
  } catch {
    return [];
  }
}

function _splitOutlinerRootsForSettings(roots) {
  const list = Array.isArray(roots) ? roots : [];
  _settingsWorkspaceOutlinerRoots = list.filter(_isWorkspaceOutlinerRoot);
  return list.filter(root => !_isWorkspaceOutlinerRoot(root));
}

async function loadOutlinerRootsForSettings() {
  try {
    const roots = await apiFetch('/outliner-roots');
    _outlinerRootsBaseline = _cloneOutlinerRootsBaseline(roots);
    // ワークスペース由来のルートは設定のワークスペースタブで管理するため、ソースフォルダ一覧には含めない
    _outlinerRoots = _splitOutlinerRootsForSettings(roots);
    window._settingsOutlinerRootsLoadFailed = false;
  } catch (e) {
    window._settingsOutlinerRootsLoadFailed = true;
    if (typeof showStatus === 'function') showStatus('ソースフォルダ一覧を読み込めませんでした', true);
  }
  window._settingsOutlinerRootsDirty = false;
  window._settingsOutlinerRootsReordered = false;
  renderOutlinerRootsSettings();
}

function _markOutlinerRootsSettingsDirty() {
  window._settingsOutlinerRootsDirty = true;
}

// 共有導線（共有切替・場所確認・保管庫共有）の完了後に呼ぶ。loadOutlinerRootsForSettings()
// のようにサーバー応答で _outlinerRoots を丸ごと差し替えると、その導線を待つ間に
// ユーザーが行った未保存の編集（削除・改名・表示切替）が黙って捨てられ、未保存
// フラグ(dirty)まで false に戻ってしまう。ここではサーバー由来のフィールド
// （provider/dropboxPath/sourceId/id/needsMapping/mapped/localPath/path）だけを
// 既存のローカル行へマージし、name/visible とローカルの追加・削除はそのまま残す。
// dirtyフラグには一切触らない。
const _MERGE_SERVER_OUTLINER_ROOT_FIELDS = [
  'provider', 'dropboxPath', 'sourceId', 'id', 'needsMapping', 'mapped', 'localPath', 'path',
];

async function mergeServerOutlinerRootsIntoSettings() {
  const rawServerRoots = await apiFetch('/outliner-roots');
  const serverRoots = _splitOutlinerRootsForSettings(rawServerRoots);
  const byKey = new Map(serverRoots.map((r) => [_outlinerRootIdentityKey(r), r]));
  _outlinerRoots.forEach((local) => {
    const remote = byKey.get(_outlinerRootIdentityKey(local));
    if (!remote) return;
    _MERGE_SERVER_OUTLINER_ROOT_FIELDS.forEach((k) => {
      if (k in remote) local[k] = remote[k];
    });
  });
  // baseRootsの基準は loadOutlinerRootsForSettings と同じく未フィルタのサーバー応答
  // （ワークスペース由来のrootも含む）を使う。保存時の台帳削除印(tombstone)判定が
  // このrootの有無を基準にするため、フィルタ後の一覧だけを基準にすると
  // ワークスペースrootの扱いがずれる。
  _outlinerRootsBaseline = _cloneOutlinerRootsBaseline(rawServerRoots);
  renderOutlinerRootsSettings();
}

// 削除確認の待機中に一覧が再読み込みされると、_outlinerRoots が新しい配列
// （新しいオブジェクト参照）に丸ごと差し替わることがあり、閉じ込めた添字(i)や
// オブジェクト参照では別の行を消してしまう。sourceId/id、無ければ実パスの
// 正規化一致で同一フォルダを再特定する。
function _outlinerRootIdentityKey(root) {
  if (!root) return '';
  const id = root.sourceId || root.id;
  if (id) return 'id:' + id;
  const path = root.dropboxPath || root.localPath || root.path || '';
  return 'path:' + String(path).trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function _findOutlinerRootIndex(target) {
  const key = _outlinerRootIdentityKey(target);
  if (!key) return -1;
  return _outlinerRoots.findIndex(r => _outlinerRootIdentityKey(r) === key);
}

function renderOutlinerRootsSettings() {
  const container = document.getElementById('modal-outliner-roots');
  if (!container) return;
  container.innerHTML = '';
  if (window._settingsOutlinerRootsLoadFailed) {
    const msg = document.createElement('div');
    msg.className = 'gb-section-desc';
    msg.style.color = 'var(--red)';
    msg.textContent = 'ソースフォルダ一覧を読み込めませんでした。保存前に再読み込みしてください。';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'gb-btn gb-btn-sm';
    retry.textContent = '再読み込み';
    retry.addEventListener('click', loadOutlinerRootsForSettings);
    container.append(msg, retry);
    return;
  }
  if (_outlinerRoots.some(root => _isDropboxProviderRoot(root))) {
    container.appendChild(_createDropboxSourceFolderNotice());
  }
  _outlinerRoots.forEach((root, i) => {
    const row = document.createElement('div');
    row.className = 'or-row';
    row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:4px;font-size:12px;';
    const displayPath = _sourceRootDisplayPath(root);
    row.innerHTML = `
      <span class="or-drag-handle" draggable="true" data-e2e-id="settings-outliner-root-${i}-drag"
        role="button" tabindex="0" aria-label="${esc(root.name || 'ソースフォルダ')}を並べ替え"
        title="ドラッグして並べ替え" style="display:inline-flex;cursor:grab;color:var(--fg2);flex-shrink:0;">${lucide('gripVertical', 14)}</span>
      <label style="display:flex;align-items:center;gap:3px;cursor:pointer;" title="フォルダツリーに表示">
        <input type="checkbox" class="or-visible" data-e2e-id="settings-outliner-root-${i}-visible" aria-label="${esc(root.name || 'ソースフォルダ')}をフォルダツリーに表示" ${root.visible ? 'checked' : ''}>
      </label>
      <input type="text" class="or-name" value="${esc(root.name)}"
        data-e2e-id="settings-outliner-root-${i}-name" aria-label="ソースフォルダ名"
        style="width:80px;font-size:12px;padding:2px 4px;background:var(--bg2);color:var(--fg);border:1px solid var(--border);border-radius:3px;">
      <span class="or-path" style="flex:1;min-width:0;color:var(--fg2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(displayPath)}">${esc(displayPath)}</span>
      <button type="button" class="or-delete" data-e2e-id="settings-outliner-root-${i}-delete" aria-label="${esc(root.name || 'ソースフォルダ')}を登録解除" title="登録解除" style="font-size:11px;padding:1px 6px;color:var(--fg2);">${lucide('x', 12)}</button>
    `;
    row.querySelector('.or-visible').addEventListener('change', (e) => {
      _outlinerRoots[i].visible = e.target.checked;
      _markOutlinerRootsSettingsDirty();
    });
    row.querySelector('.or-name').addEventListener('change', (e) => {
      _outlinerRoots[i].name = e.target.value;
      _markOutlinerRootsSettingsDirty();
    });
    row.querySelector('.or-delete').addEventListener('click', async () => {
      // 共有中のフォルダは確認を挟む（委譲先: gb-settings-cloud-link.js）。
      // 確認待ちの間に一覧が再描画される場合があるため、削除は待機後に
      // パス/IDで再検索してから行う（固定添字だと別の行を消しかねない）。
      const proceed = await window.MeldexSettingsCloudLink?.confirmDeleteSourceFolder?.(root);
      if (proceed === false) return;
      const idx = _findOutlinerRootIndex(root);
      if (idx === -1) return;
      _outlinerRoots.splice(idx, 1);
      _markOutlinerRootsSettingsDirty();
      renderOutlinerRootsSettings();
    });
    // ドラッグ&ドロップによる並べ替え（ハンドルのみdraggable。行内のテキスト入力・
    // チェックボックスの通常操作を妨げないため）。
    const dragHandle = row.querySelector('.or-drag-handle');
    dragHandle.addEventListener('dragstart', (e) => {
      _outlinerRootsDragIdx = i;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', '');
      row.style.opacity = '0.4';
    });
    dragHandle.addEventListener('dragend', () => {
      _outlinerRootsDragIdx = -1;
      row.style.opacity = '';
      container.querySelectorAll('.or-row').forEach(r => { r.style.borderTop = ''; r.style.borderBottom = ''; });
    });
    row.addEventListener('dragover', (e) => {
      if (_outlinerRootsDragIdx < 0 || _outlinerRootsDragIdx === i) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = row.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const isTop = e.clientY < mid;
      row.style.borderTop = isTop ? '2px solid var(--accent)' : '';
      row.style.borderBottom = isTop ? '' : '2px solid var(--accent)';
    });
    row.addEventListener('dragleave', () => { row.style.borderTop = ''; row.style.borderBottom = ''; });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.style.borderTop = '';
      row.style.borderBottom = '';
      const from = _outlinerRootsDragIdx;
      _outlinerRootsDragIdx = -1;
      if (from < 0 || from === i) return;
      const rect = row.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      let insertAt = e.clientY < mid ? i : i + 1;
      if (from < insertAt) insertAt--;
      const moved = _outlinerRoots.splice(from, 1)[0];
      _outlinerRoots.splice(insertAt, 0, moved);
      _markOutlinerRootsSettingsDirty();
      window._settingsOutlinerRootsReordered = true;
      renderOutlinerRootsSettings();
    });
    // 状態カード側（gb-settings-cloud-link.js の _redecorateRootRowsOnce）が、状態
    // 取得のたびに全再構築せず行DOMを直接掛け直せるよう、行へrootの参照を持たせる。
    row.__msclRoot = root;
    window.MeldexSettingsCloudLink?.decorateRootRow?.(row, root);
    container.appendChild(row);
    // 長いパスは実効幅に収めて「先頭…末尾フォルダ名」形式で中略表示する（右省略だけだと
    // 末尾のフォルダ名が切れて読めなくなるため）。DOM接続後でないと実効幅が取れないため
    // appendChild の後で呼ぶ。
    if (typeof applyMiddleEllipsis === 'function') applyMiddleEllipsis(row.querySelector('.or-path'), displayPath);
  });
}

async function _changeHomeFolder() {
  // ホーム専用のタイトルと現在位置でOSフォルダ選択を開く。ソースフォルダ追加APIを
  // 流用すると用途名・開始位置・失敗契約が食い違うため、共通pick-folderを直接使う。
  let path = null;
  try {
    const query = new URLSearchParams({
      title: 'ホームフォルダを選択',
      initialdir: _homeFolderPath || '',
    });
    const res = await apiFetch('/pick-folder?' + query.toString(), { silentError: true });
    if (res?.path) path = res.path;
  } catch { path = await _promptFolderPath(); }
  if (path) {
    try {
      await apiPut('/home-folder', { path });
    } catch (e) {
      showStatus('ホームフォルダを変更できませんでした: ' + (e.userMessage || e.message || e), true);
      return;
    }
    _homeFolderPath = path;
    try {
      const res = await apiFetch('/home-folder');
      if (typeof setSystemLockedItems === 'function') setSystemLockedItems(res.locked_paths || []);
      if (typeof _ensureLocksLoaded === 'function') await _ensureLocksLoaded({ force: true }).catch(() => {});
    } catch {}
    const homeInput = document.getElementById('modal-home-folder');
    if (homeInput) homeInput.value = path;
    if (typeof renderHomeFolderTree === 'function') renderHomeFolderTree();
    showStatus('ホームフォルダを変更しました');
  }
}

async function changeScreenshotFolder() {
  if (!window.GBFolderPicker?.pickFolder) {
    showStatus('フォルダ選択を利用できません', true);
    return false;
  }
  const fallback = ((_homeFolderPath || '').replace(/[\\/]$/, '') + '/スクリーンショット');
  const current = localStorage.getItem('meldex-screenshot-folder') || fallback;
  const selected = await window.GBFolderPicker.pickFolder({
    title: 'スクリーンショット保存先を選択',
    confirmLabel: 'このフォルダを選択',
    revealPath: current,
    initialPath: current,
  });
  if (!selected?.path) return false;
  localStorage.setItem('meldex-screenshot-folder', selected.path);
  const input = document.getElementById('modal-screenshot-folder');
  if (input) input.value = selected.path;
  showStatus('スクリーンショット保存先を変更しました');
  return true;
}

async function _promptFolderPath() {
  return new Promise(resolve => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const input = document.createElement('input');
    input.id = 'prompt-folder-path';
    input.className = 'gb-input';
    input.dataset.e2eId = 'settings-home-folder-path-input';
    input.type = 'text';
    input.placeholder = 'D:\\...';
    input.style.cssText = 'width:100%;box-sizing:border-box;min-height:44px;';
    const cancel = document.createElement('button');
    cancel.id = 'prompt-folder-cancel';
    cancel.type = 'button';
    cancel.className = 'gb-btn gb-btn-sm';
    cancel.dataset.e2eId = 'settings-home-folder-path-cancel';
    cancel.textContent = 'キャンセル';
    const ok = document.createElement('button');
    ok.id = 'prompt-folder-ok';
    ok.type = 'button';
    ok.className = 'gb-btn gb-btn-sm gb-btn-primary primary';
    ok.dataset.e2eId = 'settings-home-folder-path-ok';
    ok.textContent = 'OK';
    let result = null;
    const dialog = window.GBUI.createModal({
      id: 'settings-home-folder-path-dialog',
      titleId: 'prompt-folder-title',
      title: 'フォルダのパスを入力',
      body: input,
      footer: [cancel, ok],
      variant: 'standard',
      extraClass: 'settings-folder-path-modal',
      geometryKey: 'settings-home-folder-path-dialog',
      minWidth: '0',
      initialFocus: input,
      returnFocus: opener,
      onClose: () => resolve(result),
    });
    dialog.overlay.dataset.settingsFolderPathPrompt = '1';
    dialog.overlay.dataset.e2eId = 'settings-home-folder-path-overlay';
    dialog.modal.dataset.e2eId = 'settings-home-folder-path-dialog';
    dialog.modal.style.width = 'min(500px, calc(100vw - 24px))';
    dialog.header.querySelector('.gb-modal-close')?.setAttribute('data-e2e-id', 'settings-home-folder-path-close');
    const submit = () => {
      result = input.value.trim() || null;
      dialog.close('submit');
    };
    cancel.addEventListener('click', () => dialog.close('cancel'));
    ok.addEventListener('click', submit);
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      submit();
    });
    dialog.open();
  });
}

async function addOutlinerRootFromSettings() {
  if (window._settingsOutlinerRootsLoadFailed) {
    showStatus('ソースフォルダ一覧を読み込んでから追加してください', true);
    return;
  }
  if (window.MeldexRuntimeAdapter?.isDropboxMode?.() && window.MeldexDropboxFolderPicker?.pickFolder
    && window.MeldexSourceFolderRegistry?.normalizeDropboxPath
    && window.MeldexSourceFolderRegistry?.sourceIdForDropboxPath
    && window.MeldexSourceFolderRegistry?.sourcePath) {
    await _addDropboxOutlinerRootFromSettings();
    return;
  }
  showStatus('フォルダ選択ダイアログを開いています...');
  try {
    const res = await apiFetch('/add-outliner-root', { method: 'POST' });
    if (res.ok && res.path) {
      _addOutlinerRootEntry(res.path, res.name);
    } else if (res.needManualInput) {
      await _addOutlinerRootManual();
    } else {
      showStatus('キャンセルされました');
    }
  } catch (e) {
    await _addOutlinerRootManual();
  }
}

async function _addOutlinerRootManual() {
  return new Promise(resolve => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const description = document.createElement('div');
    description.className = 'gb-section-desc';
    description.textContent = '追加したいフォルダの絶対パスを入力してください（例: D:\\Documents\\MyProject）';
    const input = document.createElement('input');
    input.id = 'manual-root-path';
    input.className = 'gb-input';
    input.dataset.e2eId = 'settings-source-folder-path-input';
    input.type = 'text';
    input.placeholder = 'D:\\...';
    input.style.cssText = 'width:100%;box-sizing:border-box;min-height:44px;';
    const errEl = document.createElement('div');
    errEl.id = 'manual-root-error';
    errEl.className = 'gb-inline-dialog-status';
    errEl.dataset.e2eId = 'settings-source-folder-path-status';
    errEl.setAttribute('role', 'status');
    errEl.setAttribute('aria-live', 'polite');
    errEl.hidden = true;
    const cancel = document.createElement('button');
    cancel.id = 'manual-root-cancel';
    cancel.type = 'button';
    cancel.className = 'gb-btn gb-btn-sm';
    cancel.dataset.e2eId = 'settings-source-folder-path-cancel';
    cancel.textContent = 'キャンセル';
    const submitButton = document.createElement('button');
    submitButton.id = 'manual-root-ok';
    submitButton.type = 'button';
    submitButton.className = 'gb-btn gb-btn-sm gb-btn-primary primary';
    submitButton.dataset.e2eId = 'settings-source-folder-path-submit';
    submitButton.textContent = '追加';
    let busy = false;
    const dialog = window.GBUI.createModal({
      id: 'settings-source-folder-path-dialog',
      titleId: 'settings-source-folder-path-title',
      title: 'ソースフォルダのパスを入力',
      body: [description, input, errEl],
      footer: [cancel, submitButton],
      variant: 'standard',
      extraClass: 'settings-source-folder-path-modal',
      geometryKey: 'settings-source-folder-path-dialog',
      minWidth: '0',
      initialFocus: input,
      returnFocus: opener,
      onBeforeClose: reason => !busy || reason === 'complete',
      onClose: () => resolve(),
    });
    dialog.overlay.dataset.settingsSourceFolderPathPrompt = '1';
    dialog.overlay.dataset.e2eId = 'settings-source-folder-path-overlay';
    dialog.modal.dataset.e2eId = 'settings-source-folder-path-dialog';
    dialog.modal.style.width = 'min(500px, calc(100vw - 24px))';
    const closeButton = dialog.header.querySelector('.gb-modal-close');
    if (closeButton) closeButton.dataset.e2eId = 'settings-source-folder-path-close';
    const showMessage = (message, error = false) => {
      errEl.textContent = String(message || '');
      errEl.hidden = !errEl.textContent;
      errEl.dataset.statusKind = error ? 'error' : 'info';
    };
    const setBusy = next => {
      busy = !!next;
      dialog.overlay.setAttribute('aria-busy', busy ? 'true' : 'false');
      input.disabled = busy;
      cancel.disabled = busy;
      submitButton.disabled = busy;
      if (closeButton) closeButton.disabled = busy;
    };
    const submit = async () => {
      const raw = input.value.trim();
      if (!raw) { showMessage('パスを入力してください', true); input.focus(); return; }
      setBusy(true);
      showMessage('ソースフォルダを追加しています…');
      try {
        const res = await apiFetch('/add-outliner-root', { method: 'POST', body: JSON.stringify({ path: raw }) });
        if (res.ok && res.path) {
          await _addOutlinerRootEntry(res.path, res.name);
          dialog.close('complete');
        } else {
          showMessage(res.error || 'フォルダが見つかりません', true);
        }
      } catch (e) {
        showMessage(e.message || 'エラーが発生しました', true);
      } finally {
        if (dialog.modal.isConnected) setBusy(false);
      }
    };
    cancel.addEventListener('click', () => dialog.close('cancel'));
    submitButton.addEventListener('click', submit);
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      submit();
    });
    dialog.open();
  });
}

async function _addOutlinerRootEntry(path, name, extra) {
  // 設定ダイアログの外から呼ばれた場合、サーバーから最新のルートを取得
  const inSettingsDialog = !!document.getElementById('modal-outliner-roots');
  const historyBefore = inSettingsDialog ? null : await captureOutlinerRootsSettingsSnapshot().catch(() => null);
  if (!inSettingsDialog) {
    try {
      const roots = await apiFetch('/outliner-roots');
      _outlinerRootsBaseline = _cloneOutlinerRootsBaseline(roots);
      _outlinerRoots = _splitOutlinerRootsForSettings(roots);
    } catch {
      showStatus('既存のソースフォルダ一覧を読み込めませんでした', true);
      return;
    }
  }
  if (_outlinerRoots.some(r => r.path === path)) {
    showStatus('既に登録されているフォルダです');
    return;
  }
  if ((_settingsWorkspaceOutlinerRoots || []).some(r => r.path === path)) {
    showStatus('このフォルダはワークスペースとして登録済みです。フォルダツリーのワークスペースセクションに表示されます');
    return;
  }
  _outlinerRoots.push({ ...(extra || {}), path, name, visible: true });
  if (inSettingsDialog) _markOutlinerRootsSettingsDirty();
  renderOutlinerRootsSettings();
  if (!inSettingsDialog) {
    if (!await saveOutlinerRoots()) {
      _outlinerRoots = _outlinerRoots.filter(r => r.path !== path);
      renderOutlinerRootsSettings();
      showStatus('フォルダ追加の保存に失敗しました', true);
      return;
    }
    try {
      if (typeof _syncSettingsVaultPathFromOutlinerRoots === 'function') {
        await _syncSettingsVaultPathFromOutlinerRoots(_outlinerRoots);
      } else {
        const firstVisible = _outlinerRoots.find(r => r.visible && r.path && r.path !== '.');
        if (firstVisible) await apiPut('/vault', { path: firstVisible.path });
      }
    } catch {}
    if (typeof loadOutliner === 'function') {
      try { await loadOutliner(); } catch {}
    }
    const historyAfter = await captureOutlinerRootsSettingsSnapshot().catch(() => null);
    pushOutlinerRootsSettingsHistory('設定: ソースフォルダ追加', historyBefore, historyAfter, name || path);
  }
  showStatus(_isDropboxBackedSourcePath(path, extra)
    ? 'フォルダを追加しました。Dropbox上のソースフォルダはオンラインアクセスと同期を許可してください。'
    : 'フォルダを追加しました');
}

async function saveOutlinerRoots() {
  if (window._settingsOutlinerRootsLoadFailed) return false;
  try {
    // baseRoots: 直近のGETで実際に見ていた一覧（合流後スナップショット）を送り返し、
    // サーバー側の台帳削除印(tombstone)判定の基準に使わせる（台帳のみに存在する
    // rootの削除が正しく検出されるようにするため）。
    await apiPut('/outliner-roots', { roots: _outlinerRoots, baseRoots: _outlinerRootsBaseline });
    // 保存成功後は基準を今回送った内容へ合わせる（次の保存操作が、今回削除済みの
    // rootを再び削除印の対象として誤検知しないように）。
    _outlinerRootsBaseline = _cloneOutlinerRootsBaseline(_outlinerRoots);
    return true;
  } catch (e) { return false; }
}

function _normalizeOutlinerRootSettings(root) {
  if (!root || !root.path) return null;
  return {
    path: String(root.path),
    id: root.id || root.sourceId || undefined,
    sourceId: root.sourceId || root.id || undefined,
    provider: root.provider || undefined,
    dropboxPath: root.dropboxPath || undefined,
    // namespaceKind省略時の巻き戻り防止（meldex_path_scope_fullwidth_plan_2026-07-31.md
    // 第2層タスク1対応）: このフィールドを欠かすと、設定ダイアログの保存・Undo/Redo
    // スナップショットを経由するたびに team_root 登録が home へ丸められてしまう
    // （受け側 gb-source-folder-registry.js の namespaceKind継承は「省略」時のみ効く
    // 保護であり、このフィールド自体を毎回落とし続ける入口を直さないと再発する）。
    namespaceKind: root.namespaceKind || undefined,
    needsMapping: root.needsMapping === true,
    name: String(root.name || root.path.split(/[\\/]/).pop() || root.path),
    visible: root.visible !== false,
  };
}

function _normalizeOutlinerRootsSettingsSnapshot(snapshot) {
  return {
    roots: (Array.isArray(snapshot?.roots) ? snapshot.roots : [])
      .filter(root => !_isWorkspaceOutlinerRoot(root))
      .map(_normalizeOutlinerRootSettings)
      .filter(Boolean),
    vaultPath: String(snapshot?.vaultPath || ''),
    vaultName: String(snapshot?.vaultName || ''),
  };
}

async function captureOutlinerRootsSettingsSnapshot() {
  const [roots, vault] = await Promise.all([
    apiFetch('/outliner-roots').catch(() => _outlinerRoots || []),
    apiFetch('/vault').catch(() => ({ path: (typeof state !== 'undefined' ? state.vaultPath : '') || '', name: '' })),
  ]);
  return _normalizeOutlinerRootsSettingsSnapshot({
    roots,
    vaultPath: vault?.path || '',
    vaultName: vault?.name || '',
  });
}

function _sameOutlinerRootsSettingsSnapshot(a, b) {
  try {
    return JSON.stringify(_normalizeOutlinerRootsSettingsSnapshot(a))
      === JSON.stringify(_normalizeOutlinerRootsSettingsSnapshot(b));
  } catch {
    return false;
  }
}

async function _addDropboxOutlinerRootFromSettings() {
  showStatus('Dropbox内フォルダを選択してください...');
  try {
    const registry = window.MeldexSourceFolderRegistry;
    const picked = await window.MeldexDropboxFolderPicker.pickFolder({
      title: 'ソースフォルダに追加するDropbox内フォルダを選択',
    });
    if (!picked?.path) {
      showStatus('キャンセルされました');
      return;
    }
    const dropboxPath = registry.normalizeDropboxPath(picked.path);
    if (!dropboxPath) throw new Error('Dropbox内フォルダを選択してください');
    const duplicate = _outlinerRoots.find(root => (
      root?.provider === 'dropbox' || root?.dropboxPath
    ) && registry.normalizeDropboxPath(root.dropboxPath || root.path).toLowerCase() === dropboxPath.toLowerCase());
    if (duplicate) {
      showStatus('既に登録されているフォルダです');
      return;
    }
    const usedIds = new Set(_outlinerRoots.map(root => root?.sourceId || root?.id).filter(Boolean));
    // namespaceKind: ピッカーがユーザーの選択（個人用/チーム共有）どおりに返す値を
    // そのまま使う。ここを省略すると sourceIdForDropboxPath() が team_root 用の
    // id接頭辞（team-root:）を付けずに採番してしまい、かつ後段の保存経路が
    // namespaceKindフィールドごと落としてhomeとして台帳へ書いてしまう
    // （meldex_path_scope_fullwidth_plan_2026-07-31.md 第2層の再発防止）。
    const namespaceKind = registry.normalizeNamespaceKind
      ? registry.normalizeNamespaceKind(picked.namespaceKind)
      : (picked.namespaceKind === 'team_root' ? 'team_root' : 'home');
    const sourceId = registry.sourceIdForDropboxPath(dropboxPath, usedIds, namespaceKind);
    const name = String(picked.name || dropboxPath.split('/').filter(Boolean).pop() || dropboxPath).trim();
    const root = {
      id: sourceId,
      sourceId,
      provider: 'dropbox',
      namespaceKind,
      dropboxPath,
      path: registry.sourcePath(sourceId, ''),
      name,
      visible: true,
      needsMapping: false,
    };
    await _addOutlinerRootEntry(root.path, root.name, root);
  } catch (err) {
    showStatus(err?.message || String(err), true);
  }
}

async function _restoreOutlinerRootsSettingsSnapshot(snapshot) {
  const normalized = _normalizeOutlinerRootsSettingsSnapshot(snapshot);
  await apiPut('/vault', { path: normalized.vaultPath || '' });
  // baseRoots: この呼び出し元（Undo/Redo）が最後に把握していた一覧を基準として送る
  // （saveOutlinerRootsと同じ理由。台帳合流分のrootをUndo/Redoで消す操作でも
  // 正しく削除印が付くようにするため）。
  await apiPut('/outliner-roots', { roots: normalized.roots, baseRoots: _outlinerRootsBaseline });
  _outlinerRootsBaseline = _cloneOutlinerRootsBaseline(normalized.roots);
  if (typeof state !== 'undefined') state.vaultPath = normalized.vaultPath || '';
  _outlinerRoots = normalized.roots.map(root => ({ ...root }));
  renderOutlinerRootsSettings();
  const workEl = document.getElementById('sb-work');
  if (workEl) {
    const label = normalized.vaultName || normalized.vaultPath.split(/[\\/]/).pop() || '';
    workEl.textContent = normalized.vaultPath ? ('ソースフォルダ: ' + label) : '';
  }
  if (typeof loadOutliner === 'function') {
    try { await loadOutliner(); } catch {}
  }
}

function pushOutlinerRootsSettingsHistory(label, beforeSnapshot, afterSnapshot, detail) {
  if (typeof historyPush !== 'function' || !beforeSnapshot || !afterSnapshot) return false;
  if (_sameOutlinerRootsSettingsSnapshot(beforeSnapshot, afterSnapshot)) return false;
  const before = _normalizeOutlinerRootsSettingsSnapshot(beforeSnapshot);
  const after = _normalizeOutlinerRootsSettingsSnapshot(afterSnapshot);
  historyPush(
    label || '設定: ソースフォルダ変更',
    () => _restoreOutlinerRootsSettingsSnapshot(before),
    () => _restoreOutlinerRootsSettingsSnapshot(after),
    'settings:source-folders',
    detail || ''
  );
  return true;
}

/* ==============================
   テーマプリセット
   ============================== */
// テーマ管理（gb-theme-manager.js）が持つ現行の定義から組み立てる。
// 以前はここに同じ名前の色一式を別途書き写しており、パステルの背景やライトの橙などが
// 現行定義とわずかに食い違っていた。テーマ管理が使えない状況でこちらへ落ちると、
// 同じ名前なのに少し違う色になる（クラウド版だけ見た目が違う、の再現経路）。
// 写しを持たず、常に現行定義から導くことで食い違いを構造的に無くす。
const THEME_PRESETS = (function () {
  const presets = { 'OSに合わせる': null }; // 特殊テーマ: OS設定に応じてダーク/ライトを自動切替
  try {
    const builtIns = window.MeldexThemeManager?.getBuiltInThemes?.() || [];
    builtIns.forEach((themeDef) => {
      const name = String(themeDef?.name || '').trim();
      const vars = themeDef?.ui?.cssVars;
      if (name && vars && typeof vars === 'object') presets[name] = { ...vars };
    });
  } catch { /* テーマ管理が無い環境では「OSに合わせる」だけになる */ }
  return presets;
})();

// 現在のテーマ名を推定（CSS変数の値で判定）
function detectCurrentTheme() {
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getDefaultThemeId === 'function') {
    return MeldexThemeManager.getDefaultThemeId();
  }
  // 「OSに合わせる」が設定されていればそれを返す
  if (localStorage.getItem('editor-theme-name') === 'OSに合わせる') return 'OSに合わせる';
  const curBg = getCssVar('--bg');
  const curAccent = getCssVar('--accent');
  for (const [name, preset] of Object.entries(THEME_PRESETS)) {
    if (!preset) continue; // null（OSに合わせる）はスキップ
    if (preset['--bg'] === curBg && preset['--accent'] === curAccent) return name;
  }
  return '';
}

// 現在のCSS変数のスナップショットを取得（キャンセル時の復元用）
// 既定のフォント一覧は gb-font-catalog.js を正本にする（写しを持つと環境ごとに
// 選択肢がずれる）。読み込まれていない場合だけ同梱フォントの1件へ落とす。
const UI_PRESET_FONTS = (globalThis.MeldexFontCatalog?.PRESET_FONTS || [
  { name: 'Noto Sans JP（デフォルト・同梱）', family: '' },
]).map(item => ({ ...item }));

// OS にインストールされていそうな代表的フォントの候補。
// 実際にインストールされているかは canvas 計測で判定し、インストール済みのものだけドロップダウンに追加する。
const _SYSTEM_FONT_CANDIDATES = [
  // macOS / iOS / iPadOS
  { name: 'Hiragino Kaku Gothic ProN', family: "'Hiragino Kaku Gothic ProN', sans-serif" },
  { name: 'Hiragino Kaku Gothic Pro', family: "'Hiragino Kaku Gothic Pro', sans-serif" },
  { name: 'Hiragino Sans', family: "'Hiragino Sans', sans-serif" },
  { name: 'Hiragino Maru Gothic ProN', family: "'Hiragino Maru Gothic ProN', sans-serif" },
  { name: 'Hiragino Mincho ProN', family: "'Hiragino Mincho ProN', serif" },
  { name: 'Helvetica Neue', family: "'Helvetica Neue', sans-serif" },
  { name: 'Helvetica', family: 'Helvetica, sans-serif' },
  { name: 'Avenir Next', family: "'Avenir Next', sans-serif" },
  { name: 'Avenir', family: 'Avenir, sans-serif' },
  { name: 'Optima', family: 'Optima, sans-serif' },
  { name: 'Palatino', family: 'Palatino, serif' },
  { name: 'Menlo', family: 'Menlo, monospace' },
  { name: 'Monaco', family: 'Monaco, monospace' },
  // Windows
  { name: 'Meiryo UI', family: "'Meiryo UI', sans-serif" },
  { name: 'MS PGothic', family: "'MS PGothic', sans-serif" },
  { name: 'MS Gothic', family: "'MS Gothic', monospace" },
  { name: 'MS PMincho', family: "'MS PMincho', serif" },
  { name: 'MS Mincho', family: "'MS Mincho', serif" },
  { name: 'Yu Mincho', family: "'Yu Mincho', serif" },
  { name: 'BIZ UDGothic', family: "'BIZ UDGothic', sans-serif" },
  { name: 'BIZ UDPGothic', family: "'BIZ UDPGothic', sans-serif" },
  { name: 'BIZ UDMincho', family: "'BIZ UDMincho', serif" },
  { name: 'BIZ UDPMincho', family: "'BIZ UDPMincho', serif" },
  { name: 'UD デジタル 教科書体 N-R', family: "'UD デジタル 教科書体 N-R', sans-serif" },
  { name: 'Consolas', family: 'Consolas, monospace' },
  { name: 'Calibri', family: 'Calibri, sans-serif' },
  { name: 'Cambria', family: 'Cambria, serif' },
  // Android / Linux / ChromeOS
  { name: 'Roboto', family: 'Roboto, sans-serif' },
  { name: 'Noto Sans CJK JP', family: "'Noto Sans CJK JP', sans-serif" },
  { name: 'Noto Serif CJK JP', family: "'Noto Serif CJK JP', serif" },
  { name: 'Noto Serif JP', family: "'Noto Serif JP', serif" },
  { name: 'Droid Sans', family: "'Droid Sans', sans-serif" },
  { name: 'Droid Serif', family: "'Droid Serif', serif" },
  // クロスプラットフォームの定番
  { name: 'Arial', family: 'Arial, sans-serif' },
  { name: 'Arial Black', family: "'Arial Black', sans-serif" },
  { name: 'Verdana', family: 'Verdana, sans-serif' },
  { name: 'Tahoma', family: 'Tahoma, sans-serif' },
  { name: 'Trebuchet MS', family: "'Trebuchet MS', sans-serif" },
  { name: 'Times New Roman', family: "'Times New Roman', serif" },
  { name: 'Times', family: 'Times, serif' },
  { name: 'Georgia', family: 'Georgia, serif' },
  { name: 'Garamond', family: 'Garamond, serif' },
  { name: 'Courier New', family: "'Courier New', monospace" },
  { name: 'Courier', family: 'Courier, monospace' },
  { name: 'Impact', family: 'Impact, sans-serif' },
];

function _extractPrimaryFontFamily(family) {
  if (!family) return '';
  const first = String(family).split(',')[0].trim();
  return first.replace(/^['"]|['"]$/g, '');
}

let _fontDetectionCtx = null;
function _isFontInstalled(fontFamily) {
  const primary = _extractPrimaryFontFamily(fontFamily);
  if (!primary) return false;
  if (!_fontDetectionCtx) {
    try {
      const canvas = document.createElement('canvas');
      _fontDetectionCtx = canvas.getContext('2d');
    } catch { return false; }
    if (!_fontDetectionCtx) return false;
  }
  const ctx = _fontDetectionCtx;
  const testString = 'mmmmmmmmmmlli1I0Oあいうえお日本語サンプル';
  const testSize = '72px';
  const baseFonts = ['monospace', 'sans-serif', 'serif'];
  for (const base of baseFonts) {
    ctx.font = `${testSize} ${base}`;
    const baseWidth = ctx.measureText(testString).width;
    ctx.font = `${testSize} "${primary}", ${base}`;
    const testWidth = ctx.measureText(testString).width;
    if (Math.abs(testWidth - baseWidth) > 0.01) return true;
  }
  return false;
}

function getDetectedSystemFonts() {
  const seen = new Set(UI_PRESET_FONTS.map(f => f && f.family).filter(Boolean));
  const detected = [];
  const catalog = globalThis.MeldexFontCatalog;
  if (globalThis.navigator?.userActivation?.isActive) void catalog?.refresh?.();
  const catalogFamilies = catalog?.getFamilies?.() || [];
  catalogFamilies.forEach(name => {
    const family = `${JSON.stringify(String(name || '').trim())}, sans-serif`;
    if (!name || seen.has(family)) return;
    detected.push({ name, family });
    seen.add(family);
  });
  for (const candidate of _SYSTEM_FONT_CANDIDATES) {
    if (!candidate || !candidate.family) continue;
    if (seen.has(candidate.family)) continue;
    try {
      if (_isFontInstalled(candidate.family)) {
        detected.push(candidate);
        seen.add(candidate.family);
      }
    } catch {}
  }
  detected.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  return detected;
}

function _renderFontOption(opt, current) {
  const sel = opt.family === current ? ' selected' : '';
  return `<option value="${esc(opt.family)}" style="font-family:${opt.family || 'inherit'};"${sel}>${esc(opt.name)}</option>`;
}

function getUIFontOptions() {
  const current = document.documentElement.style.getPropertyValue('--ui-font') || '';
  const preset = UI_PRESET_FONTS.map(f => _renderFontOption(f, current)).join('');
  const detected = getDetectedSystemFonts();
  const detectedHtml = detected.length
    ? `<optgroup label="システムフォント">${detected.map(f => _renderFontOption(f, current)).join('')}</optgroup>`
    : '';
  const known = UI_PRESET_FONTS.some(item => item.family === current) || detected.some(item => item.family === current);
  const currentHtml = current && !known
    ? `<option value="${esc(current)}" style="font-family:${esc(current)};" selected>${esc(current)}（現在の設定）</option>`
    : '';
  return preset + detectedHtml + currentHtml;
}

function getFontFamilyOptionItems() {
  const detected = getDetectedSystemFonts();
  return [
    { v: '', l: '共通フォント', style: 'font-family:inherit;' },
    ...UI_PRESET_FONTS
      .filter(f => f && f.family)
      .map(f => ({ v: f.family, l: f.name, style: `font-family:${f.family};` })),
    ...detected.map(f => ({ v: f.family, l: f.name, style: `font-family:${f.family};`, group: 'システムフォント' })),
  ];
}

function normalizeFontFamilyValue(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (['inherit', 'initial', 'unset', 'revert', 'revert-layer'].includes(lower)) return '';
  // CSS インジェクション防止のため危険な記号を排除。残りは OS フォント名として許容する。
  if (/[<>{};\\]/.test(raw)) return '';
  return raw;
}

function getFontFamilyOptions(currentValue) {
  const current = normalizeFontFamilyValue(currentValue);
  const items = getFontFamilyOptionItems();
  let out = '';
  let currentGroup = null;
  for (const item of items) {
    const grp = item.group || null;
    if (grp !== currentGroup) {
      if (currentGroup) out += '</optgroup>';
      if (grp) out += `<optgroup label="${esc(grp)}">`;
      currentGroup = grp;
    }
    const sel = item.v === current ? ' selected' : '';
    out += `<option value="${esc(item.v)}" style="${esc(item.style)}"${sel}>${esc(item.l)}</option>`;
  }
  if (currentGroup) out += '</optgroup>';
  if (current && !items.some(item => item.v === current)) {
    out += `<option value="${esc(current)}" style="font-family:${esc(current)};" selected>${esc(current)}（現在の設定）</option>`;
  }
  return out;
}

window.addEventListener('meldex:font-catalog-updated', () => {
  const select = document.getElementById('modal-font-family');
  if (select) {
    const current = normalizeFontFamilyValue(
      document.documentElement.style.getPropertyValue('--ui-font') || select.value
    );
    select.innerHTML = getUIFontOptions();
    select.value = current;
  }
  document.querySelectorAll('select.cs-font-select').forEach(fontSelect => {
    const current = normalizeFontFamilyValue(
      (typeof getCssVar === 'function' ? getCssVar(fontSelect.dataset.key) : '') || fontSelect.value
    );
    fontSelect.innerHTML = getFontFamilyOptions(current);
    fontSelect.value = current;
  });
});


// v0.5.130: Google Fonts 動的ロードを廃止。プリセットはローカル同梱フォントとシステムフォントのみ。
function loadGoogleFontForUI(_family) { /* no-op: retained as stub for backward-compat callers */ }

function _clampNoteContentMaxWidth(value) {
  let px = parseFloat(value);
  if (!Number.isFinite(px)) px = 1200;
  return Math.max(480, Math.min(3200, px));
}

// 本文の余白は gb-layout.part01.css（横書き）と gb-tools.part02.part02.css（縦書き）が
// 論理プロパティで一元管理する。ここで物理プロパティ（paddingLeft/Right）を書き込むと
// 縦書きで軸が入れ替わったときに横方向へ効き続けてしまうため、旧バージョンが書き込んだ
// インライン値が残っていれば剥がすだけにする。--page-margin-x / --page-content-max-width の
// 設定自体は applyNoteMargin() / applyNoteContentMaxWidth() が :root へ入れるので効く。
function _applyNoteContentHorizontalPadding(pc) {
  if (!pc || !pc.style) return;
  pc.style.removeProperty('padding-left');
  pc.style.removeProperty('padding-right');
}

function applyNoteMargin(px) {
  const pages = document.querySelectorAll
    ? Array.from(document.querySelectorAll('#page-content'))
    : [document.getElementById('page-content')].filter(Boolean);
  const parsed = Number(px);
  if (Number.isFinite(parsed) && parsed >= 0) {
    document.documentElement.style.setProperty('--page-margin-x', Math.max(0, parsed) + 'px');
  }
  pages.forEach(_applyNoteContentHorizontalPadding);
}

function applyNoteContentMaxWidth(px) {
  const pages = document.querySelectorAll
    ? Array.from(document.querySelectorAll('#page-content'))
    : [document.getElementById('page-content')].filter(Boolean);
  const root = document.documentElement;
  const current = root.style.getPropertyValue('--page-content-max-width');
  if (px != null || !current) {
    root.style.setProperty('--page-content-max-width', _clampNoteContentMaxWidth(px) + 'px');
  }
  pages.forEach(_applyNoteContentHorizontalPadding);
}

function isDesktopRootZoomDisabled() {
  // 旧WebView回避用の互換フック。ChromeアプリモードではMeldex内UI倍率を許可する。
  return false;
}

function isDesktopInteractionRecoveryMode() {
  return false;
}

// options.source に 'manual' / 'auto' を渡すと、その表示サイズが「ユーザー自身が
// 選んだ値」なのか「端末に合わせて自動で決めた値」なのかを記録する（gb-ui-scale.js）。
// 省略時は出どころの記録を変更しない。
function applyUIScale(pct, options) {
  let next = parseInt(pct, 10) || 100;
  next = Math.max(67, Math.min(200, next));
  const rootStyle = document.documentElement?.style;
  if (rootStyle?.setProperty) rootStyle.setProperty('--meldex-ui-zoom', String(next / 100));
  else if (rootStyle) rootStyle['--meldex-ui-zoom'] = String(next / 100);
  if (next === 100) {
    if (rootStyle?.removeProperty) rootStyle.removeProperty('zoom');
    else if (rootStyle) rootStyle.zoom = '';
  } else if (rootStyle) rootStyle.zoom = (next / 100);
  if (rootStyle) rootStyle.fontSize = ''; // font-sizeスケーリングの残骸をクリア
  if (typeof updateMeldexViewportSize === 'function') updateMeldexViewportSize();
  localStorage.setItem('ui-scale', String(next));
  if (options && options.source && window.MeldexUIScale) {
    window.MeldexUIScale.markSource(options.source);
  }
  return next;
}

function applyStatusbarHidden(hidden) {
  const on = hidden === true || hidden === '1' || hidden === 'true';
  document.body.dataset.statusbarHidden = on ? '1' : '0';
}

function _settingsCanonicalPanelName(name) {
  const raw = String(name || '');
  if (raw === '外観') return 'テーマ';
  if (raw === '詳細') return '全般';
  if (raw === 'ナレッジ層') return 'LLM';
  if (raw === 'コスト' || raw === 'LLM費用' || raw === 'LLMコスト管理' || raw === '利用料金' || raw === 'AI料金' || raw === 'AI使用量' || raw === 'AI API使用量') return 'LLMコスト';
  if (raw === 'アプリ情報' || raw === 'このアプリについて' || raw === 'About') return '';
  if (raw === '送信設定' || raw === 'クラッシュ送信設定' || raw === 'フィードバック・送信設定') return 'フィードバック';
  if (raw === '連携') return '拡張機能';
  if (raw === 'DB' || raw === 'データ保護' || raw === 'データベースメンテナンス') return 'データベース';
  return raw;
}

function _settingsPanelDisplayName(name, options) {
  if (typeof _settingsNavigationDisplayName === 'function') return _settingsNavigationDisplayName(name, options || {});
  const canonical = _settingsCanonicalPanelName(name);
  const labels = {
    'LLM': 'チャットAI',
    'LLMコスト': 'AI使用量',
  };
  return labels[canonical] || canonical;
}

function _settingsThemeSetDirty(value) {
  window._settingsThemeDirty = !!value;
}

function _settingsThemeMarkDirty() {
  _settingsThemeSetDirty(true);
}

function _settingsThemeIsDirty() {
  return !!window._settingsThemeDirty;
}

function snapshotThemeVars() {
  const snap = {};
  // ベース変数 + getAllStyleKeys() の全変数をスナップショット（キャンセル時に完全復元するため）
  const keys = new Set(['--bg','--bg2','--bg3','--bg4','--fg','--fg2','--accent','--accent2','--red','--green','--orange','--blue','--border','--selection','--ui-font','--ui-font-size','--page-hr-color','--ui-accent-fg']);
  if (typeof getAllStyleKeys === 'function') getAllStyleKeys().forEach(k => keys.add(k));
  if (typeof COMMON_INTEGRATED_APP_STYLE_KEYS !== 'undefined') COMMON_INTEGRATED_APP_STYLE_KEYS.forEach(k => keys.add(k));
  keys.forEach(k => { snap[k] = getCssVar(k); });
  snap.__editorThemeName = localStorage.getItem('editor-theme-name');
  if (typeof MeldexThemeManager !== 'undefined') {
    const defaultKey = MeldexThemeManager.DEFAULT_THEME_KEY;
    const customThemesKey = MeldexThemeManager.CUSTOM_THEMES_KEY;
    const colorSetKey = MeldexThemeManager.THEME_COLOR_SET_KEY;
    const uiAppsKey = MeldexThemeManager.THEME_UI_APPLICATIONS_KEY;
    const autoToneKey = MeldexThemeManager.THEME_UI_AUTO_TONE_KEY;
    const osAccentKey = MeldexThemeManager.THEME_OS_ACCENT_KEY;
    const standardPaletteKey = MeldexThemeManager.STANDARD_PALETTE_ADJUST_STORAGE_KEY || 'meldex-standard-palette-adjust';
    const colorSlotKey = typeof THEME_COLOR_SLOT_SETTINGS_KEY !== 'undefined' ? THEME_COLOR_SLOT_SETTINGS_KEY : 'meldex-theme-color-slot-settings';
    const colorExtraSlotKey = typeof THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY !== 'undefined' ? THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY : 'meldex-theme-color-extra-slot-settings';
    snap.__defaultThemeId = defaultKey ? localStorage.getItem(defaultKey) : null;
    snap.__customThemes = customThemesKey ? localStorage.getItem(customThemesKey) : null;
    snap.__themeColorSet = colorSetKey ? localStorage.getItem(colorSetKey) : null;
    snap.__themeColorSlots = localStorage.getItem(colorSlotKey);
    snap.__themeColorExtraSlots = localStorage.getItem(colorExtraSlotKey);
    snap.__themeUiApplications = uiAppsKey ? localStorage.getItem(uiAppsKey) : null;
    snap.__themeUiAutoTone = autoToneKey ? localStorage.getItem(autoToneKey) : null;
    snap.__themeOsAccent = osAccentKey ? localStorage.getItem(osAccentKey) : null;
    snap.__standardPaletteAdjust = localStorage.getItem(standardPaletteKey);
  }
  return snap;
}

function restoreThemeSnapshot(snap) {
  if (!snap) return;
  if (typeof MeldexThemeManager !== 'undefined') {
    const defaultKey = MeldexThemeManager.DEFAULT_THEME_KEY;
    const customThemesKey = MeldexThemeManager.CUSTOM_THEMES_KEY;
    const colorSetKey = MeldexThemeManager.THEME_COLOR_SET_KEY;
    const uiAppsKey = MeldexThemeManager.THEME_UI_APPLICATIONS_KEY;
    const autoToneKey = MeldexThemeManager.THEME_UI_AUTO_TONE_KEY;
    const osAccentKey = MeldexThemeManager.THEME_OS_ACCENT_KEY;
    const standardPaletteKey = MeldexThemeManager.STANDARD_PALETTE_ADJUST_STORAGE_KEY || 'meldex-standard-palette-adjust';
    const colorSlotKey = typeof THEME_COLOR_SLOT_SETTINGS_KEY !== 'undefined' ? THEME_COLOR_SLOT_SETTINGS_KEY : 'meldex-theme-color-slot-settings';
    const colorExtraSlotKey = typeof THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY !== 'undefined' ? THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY : 'meldex-theme-color-extra-slot-settings';
    if (customThemesKey && Object.prototype.hasOwnProperty.call(snap, '__customThemes')) {
      if (snap.__customThemes == null) localStorage.removeItem(customThemesKey);
      else localStorage.setItem(customThemesKey, snap.__customThemes);
    }
    if (defaultKey && Object.prototype.hasOwnProperty.call(snap, '__defaultThemeId')) {
      if (snap.__defaultThemeId == null) localStorage.removeItem(defaultKey);
      else localStorage.setItem(defaultKey, snap.__defaultThemeId);
    }
    if (colorSetKey && Object.prototype.hasOwnProperty.call(snap, '__themeColorSet')) {
      if (snap.__themeColorSet == null) localStorage.removeItem(colorSetKey);
      else localStorage.setItem(colorSetKey, snap.__themeColorSet);
    }
    if (Object.prototype.hasOwnProperty.call(snap, '__themeColorSlots')) {
      if (snap.__themeColorSlots == null) localStorage.removeItem(colorSlotKey);
      else localStorage.setItem(colorSlotKey, snap.__themeColorSlots);
    }
    if (Object.prototype.hasOwnProperty.call(snap, '__themeColorExtraSlots')) {
      if (snap.__themeColorExtraSlots == null) localStorage.removeItem(colorExtraSlotKey);
      else localStorage.setItem(colorExtraSlotKey, snap.__themeColorExtraSlots);
    }
    if (uiAppsKey && Object.prototype.hasOwnProperty.call(snap, '__themeUiApplications')) {
      if (snap.__themeUiApplications == null) localStorage.removeItem(uiAppsKey);
      else localStorage.setItem(uiAppsKey, snap.__themeUiApplications);
    }
    if (autoToneKey && Object.prototype.hasOwnProperty.call(snap, '__themeUiAutoTone')) {
      if (snap.__themeUiAutoTone == null) localStorage.removeItem(autoToneKey);
      else localStorage.setItem(autoToneKey, snap.__themeUiAutoTone);
    }
    if (osAccentKey && Object.prototype.hasOwnProperty.call(snap, '__themeOsAccent')) {
      if (snap.__themeOsAccent == null) localStorage.removeItem(osAccentKey);
      else localStorage.setItem(osAccentKey, snap.__themeOsAccent);
    }
    if (Object.prototype.hasOwnProperty.call(snap, '__standardPaletteAdjust')) {
      if (snap.__standardPaletteAdjust == null) localStorage.removeItem(standardPaletteKey);
      else localStorage.setItem(standardPaletteKey, snap.__standardPaletteAdjust);
    }
    const themeId = snap.__defaultThemeId || snap.__editorThemeName;
    if (themeId && typeof MeldexThemeManager.applyDefaultTheme === 'function') {
      MeldexThemeManager.applyDefaultTheme(themeId, {
        silent: true,
        resetThemeColorSet: false,
        preserveStoredThemeUi: true,
        skipHistory: true,
      });
    }
    if (Object.prototype.hasOwnProperty.call(snap, '__themeColorSlots')) {
      if (snap.__themeColorSlots == null) localStorage.removeItem(colorSlotKey);
      else localStorage.setItem(colorSlotKey, snap.__themeColorSlots);
    }
    if (Object.prototype.hasOwnProperty.call(snap, '__themeColorExtraSlots')) {
      if (snap.__themeColorExtraSlots == null) localStorage.removeItem(colorExtraSlotKey);
      else localStorage.setItem(colorExtraSlotKey, snap.__themeColorExtraSlots);
    }
    if (uiAppsKey && Object.prototype.hasOwnProperty.call(snap, '__themeUiApplications')) {
      if (snap.__themeUiApplications == null) localStorage.removeItem(uiAppsKey);
      else localStorage.setItem(uiAppsKey, snap.__themeUiApplications);
    }
    if (autoToneKey && Object.prototype.hasOwnProperty.call(snap, '__themeUiAutoTone')) {
      if (snap.__themeUiAutoTone == null) localStorage.removeItem(autoToneKey);
      else localStorage.setItem(autoToneKey, snap.__themeUiAutoTone);
    }
    if (typeof MeldexThemeManager.applyThemeUiApplications === 'function') {
      MeldexThemeManager.applyThemeUiApplications(MeldexThemeManager.getThemeUiApplications?.());
    }
  }
  const osAccentStyleKeys = (snap.__themeOsAccent === '1' && typeof MeldexThemeManager !== 'undefined' && Array.isArray(MeldexThemeManager.THEME_OS_ACCENT_STYLE_KEYS))
    ? MeldexThemeManager.THEME_OS_ACCENT_STYLE_KEYS
    : null;
  for (const [k, v] of Object.entries(snap)) {
    if (k.startsWith('__')) continue;
    if (osAccentStyleKeys && osAccentStyleKeys.includes(k)) continue;
    document.documentElement.style.setProperty(k, v);
  }
  if (Object.prototype.hasOwnProperty.call(snap, '__editorThemeName')) {
    if (snap.__editorThemeName == null) localStorage.removeItem('editor-theme-name');
    else localStorage.setItem('editor-theme-name', snap.__editorThemeName);
  }
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.applyOsAccentColorSetting === 'function' && Object.prototype.hasOwnProperty.call(snap, '__themeOsAccent')) {
    MeldexThemeManager.applyOsAccentColorSetting(snap.__themeOsAccent === '1');
  }
}

function _deriveUiStyleVarsFromBase(vars) {
  const src = vars || {};
  return {
    '--ui-header-fg': src['--ui-header-fg'] || src['--fg2'] || '#969696',
    '--ui-header-bg': src['--ui-header-bg'] || src['--bg3'] || '#2d2d2d',
    '--ui-toolbar-fg': src['--ui-toolbar-fg'] || src['--fg'] || '#d4d4d4',
    '--ui-toolbar-bg': src['--ui-toolbar-bg'] || src['--bg2'] || '#252525',
    '--ui-hover-fg': src['--ui-hover-fg'] || src['--fg'] || '#d4d4d4',
    '--ui-hover-bg': src['--ui-hover-bg'] || src['--bg4'] || '#3e3e3e',
    '--ui-accent-fg': src['--ui-accent-fg'] || '#ffffff',
    '--ui-fg-strong': src['--ui-fg-strong'] || '#ffffff',
    '--ui-selection-fg': src['--ui-selection-fg'] || src['--fg'] || '#ffffff',
    '--ui-selection-bg': src['--ui-selection-bg'] || src['--selection'] || '#264f78',
    '--ui-range-fill-bg': src['--ui-range-fill-bg'] || src['--accent'] || '#569cd6',
    '--ui-range-track-bg': src['--ui-range-track-bg'] || src['--border'] || '#333333',
  };
}

function applyThemePreset(name) {
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.applyDefaultTheme === 'function') {
    if (!name) return;
    MeldexThemeManager.applyDefaultTheme(name);
    showStatus(`テーマをプレビュー中`);
    return;
  }
  if (name === 'OSに合わせる') {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const actual = isDark ? 'ダーク' : 'ライト';
    applyThemePreset(actual);
    localStorage.setItem('editor-theme-name', 'OSに合わせる');
    showStatus(`テーマ「OSに合わせる」→ ${actual}`);
    return;
  }
  const preset = THEME_PRESETS[name];
  if (!preset) return;
  localStorage.setItem('editor-theme-name', name);
  // まず全CSS変数をリセット（前のテーマの残骸を消す）
  const resetKeys = getAllStyleKeys();
  if (typeof COMMON_INTEGRATED_APP_STYLE_KEYS !== 'undefined') {
    resetKeys.push(...COMMON_INTEGRATED_APP_STYLE_KEYS);
  }
  for (const k of resetKeys) {
    document.documentElement.style.removeProperty(k);
  }
  // プリセットの基本色を適用
  for (const [k, v] of Object.entries(preset)) {
    document.documentElement.style.setProperty(k, v);
  }
  for (const [k, v] of Object.entries(_deriveUiStyleVarsFromBase(preset))) {
    document.documentElement.style.setProperty(k, v);
  }
  showStatus(`テーマ「${name}」をプレビュー中`);
}
