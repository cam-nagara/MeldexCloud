  return notice;
}

function _isWorkspaceOutlinerRoot(root) {
  return !!root && (root.kind === 'workspace' || !!root.workspaceId);
}

// ワークスペース由来ルートの控え（ソースフォルダ追加時の重複案内に使う）
let _settingsWorkspaceOutlinerRoots = [];

function _splitOutlinerRootsForSettings(roots) {
  const list = Array.isArray(roots) ? roots : [];
  _settingsWorkspaceOutlinerRoots = list.filter(_isWorkspaceOutlinerRoot);
  return list.filter(root => !_isWorkspaceOutlinerRoot(root));
}

async function loadOutlinerRootsForSettings() {
  try {
    const roots = await apiFetch('/outliner-roots');
    // ワークスペース由来のルートは設定のワークスペースタブで管理するため、ソースフォルダ一覧には含めない
    _outlinerRoots = _splitOutlinerRootsForSettings(roots);
    window._settingsOutlinerRootsLoadFailed = false;
  } catch (e) {
    window._settingsOutlinerRootsLoadFailed = true;
    if (typeof showStatus === 'function') showStatus('ソースフォルダ一覧を読み込めませんでした', true);
  }
  window._settingsOutlinerRootsDirty = false;
  renderOutlinerRootsSettings();
}

function _markOutlinerRootsSettingsDirty() {
  window._settingsOutlinerRootsDirty = true;
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
  if (_outlinerRoots.some(root => _isDropboxBackedSourcePath(root?.path, root))) {
    container.appendChild(_createDropboxSourceFolderNotice());
  }
  _outlinerRoots.forEach((root, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:4px;font-size:12px;';
    const displayPath = _sourceRootDisplayPath(root);
    row.innerHTML = `
      <label style="display:flex;align-items:center;gap:3px;cursor:pointer;" title="フォルダツリーに表示">
        <input type="checkbox" class="or-visible" data-e2e-id="settings-outliner-root-${i}-visible" aria-label="${esc(root.name || 'ソースフォルダ')}をフォルダツリーに表示" ${root.visible ? 'checked' : ''}>
      </label>
      <input type="text" class="or-name" value="${esc(root.name)}"
        data-e2e-id="settings-outliner-root-${i}-name" aria-label="ソースフォルダ名"
        style="width:80px;font-size:12px;padding:2px 4px;background:var(--bg2);color:var(--fg);border:1px solid var(--border);border-radius:3px;">
      <span style="flex:1;color:var(--fg2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(displayPath)}">${esc(displayPath)}</span>
      <button type="button" class="or-delete" data-e2e-id="settings-outliner-root-${i}-delete" aria-label="${esc(root.name || 'ソースフォルダ')}を削除" title="削除" style="font-size:11px;padding:1px 6px;color:var(--fg2);">${lucide('x', 12)}</button>
    `;
    row.querySelector('.or-visible').addEventListener('change', (e) => {
      _outlinerRoots[i].visible = e.target.checked;
      _markOutlinerRootsSettingsDirty();
    });
    row.querySelector('.or-name').addEventListener('change', (e) => {
      _outlinerRoots[i].name = e.target.value;
      _markOutlinerRootsSettingsDirty();
    });
    row.querySelector('.or-delete').addEventListener('click', () => {
      _outlinerRoots.splice(i, 1);
      _markOutlinerRootsSettingsDirty();
      renderOutlinerRootsSettings();
    });
    container.appendChild(row);
  });
}

async function _changeHomeFolder() {
  // フォルダ選択ダイアログ（tkinter失敗時はパス手入力）
  let path = null;
  try {
    const res = await apiFetch('/add-outliner-root', { method: 'POST' });
    if (res.ok && res.path) path = res.path;
    else if (res.needManualInput) path = await _promptFolderPath();
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
    window.MeldexSampleInstaller?.schedulePostSetupPrompt?.({ trigger: 'home-folder-changed', homePath: path });
  }
}

async function _promptFolderPath() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10001;';
    overlay.innerHTML = `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:20px;width:500px;max-width:90vw;">
      <div style="font-size:14px;font-weight:bold;color:var(--fg);margin-bottom:12px;">フォルダのパスを入力</div>
      <input id="prompt-folder-path" type="text" placeholder="D:\\..." style="width:100%;box-sizing:border-box;font-size:13px;padding:6px 10px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;margin-bottom:12px;">
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="prompt-folder-cancel" style="font-size:12px;padding:4px 12px;">キャンセル</button>
        <button id="prompt-folder-ok" class="primary" style="font-size:12px;padding:4px 12px;">OK</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#prompt-folder-path');
    input.focus();
    const close = v => { overlay.remove(); resolve(v); };
    overlay.querySelector('#prompt-folder-cancel').addEventListener('click', () => close(null));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    const submit = () => { const v = input.value.trim(); close(v || null); };
    overlay.querySelector('#prompt-folder-ok').addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') close(null); });
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
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10001;';
  overlay.innerHTML = `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:20px;width:500px;max-width:90vw;">
    <div style="font-size:14px;font-weight:bold;color:var(--fg);margin-bottom:12px;">ソースフォルダのパスを入力</div>
    <div style="font-size:12px;color:var(--fg2);margin-bottom:8px;">追加したいフォルダの絶対パスを入力してください（例: D:\\Documents\\MyProject）</div>
    <input id="manual-root-path" type="text" placeholder="D:\\..." style="width:100%;box-sizing:border-box;font-size:13px;padding:6px 10px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;margin-bottom:12px;">
    <div id="manual-root-error" style="font-size:11px;color:var(--red);margin-bottom:8px;display:none;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button id="manual-root-cancel" style="font-size:12px;padding:4px 12px;">キャンセル</button>
      <button id="manual-root-ok" class="primary" style="font-size:12px;padding:4px 12px;">追加</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const input = overlay.querySelector('#manual-root-path');
  const errEl = overlay.querySelector('#manual-root-error');
  input.focus();
  return new Promise(resolve => {
    const close = () => { overlay.remove(); resolve(); };
    overlay.querySelector('#manual-root-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    const submit = async () => {
      const raw = input.value.trim();
      if (!raw) { errEl.textContent = 'パスを入力してください'; errEl.style.display = ''; return; }
      try {
        const res = await apiFetch('/add-outliner-root', { method: 'POST', body: JSON.stringify({ path: raw }) });
        if (res.ok && res.path) {
          _addOutlinerRootEntry(res.path, res.name);
          overlay.remove(); resolve();
        } else {
          errEl.textContent = res.error || 'フォルダが見つかりません'; errEl.style.display = '';
        }
      } catch (e) {
        errEl.textContent = e.message || 'エラーが発生しました'; errEl.style.display = '';
      }
    };
    overlay.querySelector('#manual-root-ok').addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') close(); });
  });
}

async function _addOutlinerRootEntry(path, name, extra) {
  // 設定ダイアログの外から呼ばれた場合、サーバーから最新のルートを取得
  const inSettingsDialog = !!document.getElementById('modal-outliner-roots');
  const historyBefore = inSettingsDialog ? null : await captureOutlinerRootsSettingsSnapshot().catch(() => null);
  if (!inSettingsDialog) {
    try {
      const roots = await apiFetch('/outliner-roots');
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
    await apiPut('/outliner-roots', { roots: _outlinerRoots });
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
    const sourceId = registry.sourceIdForDropboxPath(dropboxPath, usedIds);
    const name = String(picked.name || dropboxPath.split('/').filter(Boolean).pop() || dropboxPath).trim();
    const root = {
      id: sourceId,
      sourceId,
      provider: 'dropbox',
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
  await apiPut('/outliner-roots', { roots: normalized.roots });
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
const THEME_PRESETS = {
  'OSに合わせる': null, // 特殊テーマ: OS設定に応じてダーク/ライトを自動切替
  'ダーク': {
    '--bg':'#1e1e1e','--bg2':'#252525','--bg3':'#2d2d2d','--bg4':'#3e3e3e',
    '--fg':'#d4d4d4','--fg2':'#969696','--accent':'#569cd6','--accent2':'#4ec9b0',
    '--red':'#f44747','--green':'#6a9955','--orange':'#ce9178','--blue':'#6fa8dc',
    '--border':'#333333','--selection':'#264f78',
    '--db-th-fg':'#969696','--db-th-bg':'#2d2d2d','--db-entity-fg':'#d4d4d4','--db-entity-bg':'#1e1e1e',
    '--db-cell-fg':'#d4d4d4','--db-grid-border':'var(--border)','--db-active-color':'var(--editor-caret-color)',
    '--page-title-fg':'#d4d4d4','--page-h1-fg':'#569cd6','--page-h2-fg':'#569cd6','--page-h3-fg':'#d4d4d4',
    '--page-text-fg':'#d4d4d4','--page-text-bg':'#252525','--page-link-fg':'var(--accent2)',
    '--page-hr-color':'var(--border)','--page-quote-fg':'#969696','--page-quote-border':'var(--border)',
  },
  'ライト': {
    '--bg':'#ffffff','--bg2':'#f5f5f5','--bg3':'#ebebeb','--bg4':'#d4d4d4',
    '--fg':'#1e1e1e','--fg2':'#555555','--accent':'#0055aa','--accent2':'#007050',
    '--red':'#c62828','--green':'#2e7d32','--orange':'#d84315','--blue':'#1565c0',
    '--border':'#c0c0c0','--selection':'#bbdefb',
    '--db-th-fg':'#555555','--db-th-bg':'#ebebeb','--db-entity-fg':'#1e1e1e','--db-entity-bg':'#ffffff',
    '--db-cell-fg':'#1e1e1e','--db-grid-border':'var(--border)','--db-active-color':'var(--editor-caret-color)',
    '--page-title-fg':'#1e1e1e','--page-h1-fg':'#0055aa','--page-h2-fg':'#0055aa','--page-h3-fg':'#1e1e1e',
    '--page-text-fg':'#1e1e1e','--page-text-bg':'#f5f5f5','--page-link-fg':'var(--accent2)',
    '--page-hr-color':'var(--border)','--page-quote-fg':'#555555','--page-quote-border':'var(--border)',
  },
  'パステル': {
    '--bg':'#fdf9f6','--bg2':'#f5f0ff','--bg3':'#e8f4f0','--bg4':'#fce8ec',
    '--fg':'#4a4458','--fg2':'#7a7090','--accent':'#9b59b6','--accent2':'#1abc9c',
    '--red':'#e74c8b','--green':'#2ecc71','--orange':'#f39c12','--blue':'#3498db',
    '--border':'#e0c8f0','--selection':'#d5e8ff',
    '--db-th-fg':'#6a5090','--db-th-bg':'#e8f0d8','--db-entity-fg':'#5a4870','--db-entity-bg':'#fdf6f0',
    '--db-cell-fg':'#4a4458','--db-grid-border':'var(--border)','--db-active-color':'var(--editor-caret-color)',
    '--page-title-fg':'#5a4870','--page-h1-fg':'#e74c8b','--page-h2-fg':'#3498db','--page-h3-fg':'#2ecc71',
    '--page-text-fg':'#4a4458','--page-text-bg':'#fff8f0','--page-link-fg':'var(--accent2)',
    '--page-hr-color':'var(--border)','--page-quote-fg':'#9b59b6','--page-quote-border':'var(--border)',
  },
  'アースカラー': {
    '--bg':'#1a1a14','--bg2':'#22221a','--bg3':'#2e2c22','--bg4':'#3e3a2e',
    '--fg':'#d4c8a8','--fg2':'#b0a488','--accent':'#d4a030','--accent2':'#7aa030',
    '--red':'#d06050','--green':'#90b870','--orange':'#d07830','--blue':'#6898b0',
    '--border':'#3a3628','--selection':'#4a4228',
    '--db-th-fg':'#b0a488','--db-th-bg':'#2e2c22','--db-entity-fg':'#d4c8a8','--db-entity-bg':'#1a1a14',
    '--db-cell-fg':'#d4c8a8','--db-grid-border':'var(--border)','--db-active-color':'var(--editor-caret-color)',
    '--page-title-fg':'#d4c8a8','--page-h1-fg':'#d4a030','--page-h2-fg':'#d4a030','--page-h3-fg':'#d4c8a8',
    '--page-text-fg':'#d4c8a8','--page-text-bg':'#22221a','--page-link-fg':'var(--accent2)',
    '--page-hr-color':'var(--border)','--page-quote-fg':'#b0a488','--page-quote-border':'var(--border)',
  },
};

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
const UI_PRESET_FONTS = [
  { name: 'Noto Sans JP（デフォルト・同梱）', family: '' },
  { name: 'Segoe UI', family: "'Segoe UI', sans-serif" },
  { name: 'Yu Gothic UI', family: "'Yu Gothic UI', sans-serif" },
  { name: 'Meiryo', family: "'Meiryo', sans-serif" },
  { name: 'Noto Sans JP', family: "'Noto Sans JP', sans-serif" },
];

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

let _detectedSystemFontsCache = null;
function getDetectedSystemFonts() {
  if (_detectedSystemFontsCache) return _detectedSystemFontsCache;
  const seen = new Set(UI_PRESET_FONTS.map(f => f && f.family).filter(Boolean));
  const detected = [];
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
  _detectedSystemFontsCache = detected;
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
  if (!detected.length) return preset;
  const detectedHtml = detected.map(f => _renderFontOption(f, current)).join('');
  return preset + `<optgroup label="システムフォント">${detectedHtml}</optgroup>`;
}

let _fontFamilyOptionItemsCache = null;

function getFontFamilyOptionItems() {
  if (!_fontFamilyOptionItemsCache) {
    const detected = getDetectedSystemFonts();
    _fontFamilyOptionItemsCache = [
      { v: '', l: '共通フォント', style: 'font-family:inherit;' },
      ...UI_PRESET_FONTS
        .filter(f => f && f.family)
        .map(f => ({ v: f.family, l: f.name, style: `font-family:${f.family};` })),
      ...detected.map(f => ({ v: f.family, l: f.name, style: `font-family:${f.family};`, group: 'システムフォント' })),
    ];
  }
  return _fontFamilyOptionItemsCache;
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
  return out;
}


// v0.5.130: Google Fonts 動的ロードを廃止。プリセットはローカル同梱フォントとシステムフォントのみ。
function loadGoogleFontForUI(_family) { /* no-op: retained as stub for backward-compat callers */ }

function _noteContentHorizontalPaddingCss() {
  return 'max(var(--page-margin-x, 50px), calc((100% - var(--page-content-max-width, 1200px)) / 2))';
}

function _clampNoteContentMaxWidth(value) {
  let px = parseFloat(value);
  if (!Number.isFinite(px)) px = 1200;
  return Math.max(480, Math.min(3200, px));
}

function _applyNoteContentHorizontalPadding(pc) {
  if (!pc) return;
  const padding = _noteContentHorizontalPaddingCss();
  pc.style.paddingLeft = pc.style.paddingRight = padding;
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

function applyUIScale(pct) {
  let next = parseInt(pct, 10) || 100;
  next = Math.max(67, Math.min(200, next));
  if (next === 100) document.documentElement.style.removeProperty('zoom');
  else document.documentElement.style.zoom = (next / 100);
  document.documentElement.style.fontSize = ''; // font-sizeスケーリングの残骸をクリア
  if (typeof updateMeldexViewportSize === 'function') updateMeldexViewportSize();
  localStorage.setItem('ui-scale', String(next));
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
  if (raw === 'Discord' || raw === 'Discord連携' || raw === 'Discord Bot連携') return 'Discord Bot';
  if (raw === 'アプリ情報' || raw === 'このアプリについて' || raw === 'About') return '';
  if (raw === '送信設定' || raw === 'クラッシュ送信設定' || raw === 'フィードバック・送信設定') return 'フィードバック';
  if (raw === '連携') return '拡張機能';
  if (raw === 'DB' || raw === 'データ保護' || raw === 'データベースメンテナンス') return 'データベース';
  return raw;
}

function _settingsPanelDisplayName(name) {
  const canonical = _settingsCanonicalPanelName(name);
  const labels = {
    'LLM': 'チャットAI',
    'LLMコスト': 'AI使用量',
    'Discord Bot': 'Discord連携',
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
  const keys = new Set(['--bg','--bg2','--bg3','--bg4','--fg','--fg2','--accent','--accent2','--red','--green','--orange','--blue','--border','--selection','--ui-font','--ui-font-size','--page-hr-color']);
  if (typeof getAllStyleKeys === 'function') getAllStyleKeys().forEach(k => keys.add(k));
  if (typeof COMMON_INTEGRATED_APP_STYLE_KEYS !== 'undefined') COMMON_INTEGRATED_APP_STYLE_KEYS.forEach(k => keys.add(k));
  keys.forEach(k => { snap[k] = getCssVar(k); });
  snap.__editorThemeName = localStorage.getItem('editor-theme-name');
  if (typeof MeldexThemeManager !== 'undefined') {
    const defaultKey = MeldexThemeManager.DEFAULT_THEME_KEY;
    const colorSetKey = MeldexThemeManager.THEME_COLOR_SET_KEY;
    const uiAppsKey = MeldexThemeManager.THEME_UI_APPLICATIONS_KEY;
    const autoToneKey = MeldexThemeManager.THEME_UI_AUTO_TONE_KEY;
    const osAccentKey = MeldexThemeManager.THEME_OS_ACCENT_KEY;
    const colorSlotKey = typeof THEME_COLOR_SLOT_SETTINGS_KEY !== 'undefined' ? THEME_COLOR_SLOT_SETTINGS_KEY : 'meldex-theme-color-slot-settings';
    const colorExtraSlotKey = typeof THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY !== 'undefined' ? THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY : 'meldex-theme-color-extra-slot-settings';
    snap.__defaultThemeId = defaultKey ? localStorage.getItem(defaultKey) : null;
    snap.__themeColorSet = colorSetKey ? localStorage.getItem(colorSetKey) : null;
    snap.__themeColorSlots = localStorage.getItem(colorSlotKey);
    snap.__themeColorExtraSlots = localStorage.getItem(colorExtraSlotKey);
    snap.__themeUiApplications = uiAppsKey ? localStorage.getItem(uiAppsKey) : null;
    snap.__themeUiAutoTone = autoToneKey ? localStorage.getItem(autoToneKey) : null;
    snap.__themeOsAccent = osAccentKey ? localStorage.getItem(osAccentKey) : null;
  }
  return snap;
}

function restoreThemeSnapshot(snap) {
  if (!snap) return;
  if (typeof MeldexThemeManager !== 'undefined') {
    const defaultKey = MeldexThemeManager.DEFAULT_THEME_KEY;
    const colorSetKey = MeldexThemeManager.THEME_COLOR_SET_KEY;
    const uiAppsKey = MeldexThemeManager.THEME_UI_APPLICATIONS_KEY;
    const autoToneKey = MeldexThemeManager.THEME_UI_AUTO_TONE_KEY;
    const osAccentKey = MeldexThemeManager.THEME_OS_ACCENT_KEY;
    const colorSlotKey = typeof THEME_COLOR_SLOT_SETTINGS_KEY !== 'undefined' ? THEME_COLOR_SLOT_SETTINGS_KEY : 'meldex-theme-color-slot-settings';
    const colorExtraSlotKey = typeof THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY !== 'undefined' ? THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY : 'meldex-theme-color-extra-slot-settings';
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
