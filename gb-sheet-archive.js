/* ==============================
   gb-sheet-archive.js: sheet archive management
   ============================== */

let _sheetArchiveModalState = null;

function _sheetArchiveCurrentPath(explicitPath) {
  if (explicitPath) return explicitPath;
  if (typeof state !== 'undefined' && state?.currentDbPath) return state.currentDbPath;
  if (typeof getCurrentFilePath === 'function') return getCurrentFilePath();
  return '';
}

function _sheetArchiveNum(root, selector, fallback) {
  const value = Number(root.querySelector(selector)?.value);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function _sheetArchiveText(value) {
  return String(value == null ? '' : value);
}

function _sheetArchiveBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1).replace(/\.0$/, '') + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '') + ' MB';
}

function _sheetArchiveButton(label, className) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className || 'gb-btn gb-btn-sm';
  btn.textContent = label;
  return btn;
}

function _sheetArchiveSetStatus(text, isError) {
  const el = _sheetArchiveModalState?.statusEl;
  if (!el) return;
  el.textContent = text || '';
  el.style.color = isError ? 'var(--red,#d16969)' : 'var(--fg2)';
}

function _sheetArchiveBeginBusy() {
  const st = _sheetArchiveModalState;
  if (!st) return;
  st.busyDepth = Number(st.busyDepth || 0) + 1;
  st.modal?.setAttribute('aria-busy', 'true');
  const controls = [
    ...(st.actionControls || []),
    ...(st.modal?.querySelectorAll('button') || []),
  ].filter(control => control.id !== 'sheet-archive-close' && control.dataset.e2eId !== 'sheet-archive-header-close');
  [...new Set(controls)].forEach(control => { control.disabled = true; });
}

function _sheetArchiveEndBusy() {
  const st = _sheetArchiveModalState;
  if (!st) return;
  st.busyDepth = Math.max(0, Number(st.busyDepth || 0) - 1);
  if (st.busyDepth) return;
  st.modal?.removeAttribute('aria-busy');
  const controls = [
    ...(st.actionControls || []),
    ...(st.modal?.querySelectorAll('button') || []),
  ].filter(control => control.id !== 'sheet-archive-close' && control.dataset.e2eId !== 'sheet-archive-header-close');
  [...new Set(controls)].forEach(control => { control.disabled = false; });
}

async function _sheetArchiveLoad(keepStatus = false) {
  const st = _sheetArchiveModalState;
  if (!st?.path) return;
  _sheetArchiveBeginBusy();
  try {
    const [status, policyRes] = await Promise.all([
      apiFetch('/sheet-archive/status?path=' + encodeURIComponent(st.path)),
      apiFetch('/sheet-archive/policy?path=' + encodeURIComponent(st.path)),
    ]);
    st.status = status;
    st.policy = policyRes.policy || status.policy || {};
    _sheetArchiveRenderStatus();
    if (!keepStatus) _sheetArchiveSetStatus('');
  } catch (error) {
    _sheetArchiveSetStatus(error?.message || 'アーカイブ情報を読み込めませんでした', true);
  } finally {
    _sheetArchiveEndBusy();
  }
}

function _sheetArchiveRenderStatus() {
  const st = _sheetArchiveModalState;
  if (!st) return;
  const status = st.status || {};
  const policy = st.policy || {};
  st.summaryEl.textContent =
    '表示中 ' + Number(status.active_count || 0).toLocaleString('ja-JP') +
    ' 件 / アーカイブ ' + Number(status.archived_entries || 0).toLocaleString('ja-JP') + ' 件';
  st.maxInput.value = Number(policy.max_active_entries || 0);
  st.daysInput.value = Number(policy.older_than_days || 0);
  st.limitInput.value = Number(policy.batch_limit || 500);
  _sheetArchiveRenderArchives(status.archives || []);
}

function _sheetArchiveRenderArchives(archives) {
  const st = _sheetArchiveModalState;
  if (!st) return;
  st.archiveList.innerHTML = '';
  if (!archives.length) {
    const empty = document.createElement('div');
    empty.className = 'gb-section-desc';
    empty.textContent = 'まだアーカイブはありません';
    st.archiveList.appendChild(empty);
    return;
  }
  archives.forEach((archive, index) => {
    const row = document.createElement('div');
    row.className = 'gb-field-row';
    row.style.cssText = 'align-items:center;border-bottom:1px solid var(--border);padding:6px 0;';

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;';
    const title = document.createElement('div');
    title.style.cssText = 'font-size:13px;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    title.textContent = _sheetArchiveText(archive.id);
    const meta = document.createElement('div');
    meta.className = 'gb-section-desc';
    meta.textContent = Number(archive.count || 0).toLocaleString('ja-JP') + '件 / ' + _sheetArchiveBytes(archive.bytes) + ' / ' + _sheetArchiveText(archive.created_at || '');
    info.appendChild(title);
    info.appendChild(meta);

    const restore = _sheetArchiveButton('復元');
    restore.dataset.e2eId = `sheet-archive-restore-${index}`;
    restore.addEventListener('click', () => _sheetArchiveRestore(archive.id));
    row.appendChild(info);
    row.appendChild(restore);
    st.archiveList.appendChild(row);
  });
}

function _sheetArchiveRenderCandidates(candidates, total) {
  const st = _sheetArchiveModalState;
  if (!st) return;
  st.candidateList.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'gb-section-desc';
  head.textContent = Number(total || candidates.length || 0).toLocaleString('ja-JP') + '件が候補です';
  st.candidateList.appendChild(head);
  candidates.slice(0, 20).forEach(item => {
    const row = document.createElement('div');
    row.className = 'gb-field-row';
    row.style.cssText = 'border-bottom:1px solid var(--border);padding:4px 0;';
    const name = document.createElement('span');
    name.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    name.textContent = item.name || item.file_name || item.id;
    const meta = document.createElement('span');
    meta.className = 'gb-section-desc';
    meta.textContent = item.modified || item.updated || item.created || '';
    row.appendChild(name);
    row.appendChild(meta);
    st.candidateList.appendChild(row);
  });
}

async function _sheetArchiveSavePolicy() {
  const st = _sheetArchiveModalState;
  if (!st) return;
  const body = {
    path: st.path,
    max_active_entries: _sheetArchiveNum(st.modal, '[data-sheet-archive-max]', 0),
    older_than_days: _sheetArchiveNum(st.modal, '[data-sheet-archive-days]', 0),
    batch_limit: _sheetArchiveNum(st.modal, '[data-sheet-archive-limit]', 500),
  };
  _sheetArchiveBeginBusy();
  try {
    const res = await apiPut('/sheet-archive/policy', body);
    st.policy = res.policy || body;
    _sheetArchiveSetStatus('アーカイブ条件を保存しました');
  } catch (error) {
    _sheetArchiveSetStatus(error?.message || 'アーカイブ条件を保存できませんでした', true);
  } finally {
    _sheetArchiveEndBusy();
  }
}

async function _sheetArchivePreviewCandidates() {
  const st = _sheetArchiveModalState;
  if (!st) return;
  const params = new URLSearchParams({
    path: st.path,
    max_active_entries: String(_sheetArchiveNum(st.modal, '[data-sheet-archive-max]', 0)),
    older_than_days: String(_sheetArchiveNum(st.modal, '[data-sheet-archive-days]', 0)),
    limit: String(_sheetArchiveNum(st.modal, '[data-sheet-archive-limit]', 500)),
  });
  _sheetArchiveSetStatus('候補を確認しています...');
  _sheetArchiveBeginBusy();
  try {
    const res = await apiFetch('/sheet-archive/candidates?' + params.toString());
    _sheetArchiveRenderCandidates(res.candidates || [], res.candidate_count || 0);
    _sheetArchiveSetStatus('');
  } catch (error) {
    _sheetArchiveSetStatus(error?.message || '候補確認に失敗しました', true);
  } finally {
    _sheetArchiveEndBusy();
  }
}

async function _sheetArchiveRun() {
  const st = _sheetArchiveModalState;
  if (!st) return;
  const ok = typeof cfConfirm === 'function'
    ? await cfConfirm('候補のエントリをアーカイブへ移します。元データは削除されず、検索と復元ができます。実行しますか？')
    : confirm('候補のエントリをアーカイブへ移します。実行しますか？');
  if (!ok) return;
  const body = {
    path: st.path,
    max_active_entries: _sheetArchiveNum(st.modal, '[data-sheet-archive-max]', 0),
    older_than_days: _sheetArchiveNum(st.modal, '[data-sheet-archive-days]', 0),
    limit: _sheetArchiveNum(st.modal, '[data-sheet-archive-limit]', 500),
  };
  _sheetArchiveSetStatus('アーカイブしています...');
  _sheetArchiveBeginBusy();
  try {
    const res = await apiPost('/sheet-archive/archive', body);
    _sheetArchiveSetStatus(Number(res.archived || 0).toLocaleString('ja-JP') + '件をアーカイブしました');
    await _sheetArchiveLoad(true);
    if (typeof selectDatabase === 'function') selectDatabase(st.path);
  } catch (error) {
    _sheetArchiveSetStatus(error?.message || 'アーカイブに失敗しました', true);
  } finally {
    _sheetArchiveEndBusy();
  }
}

async function _sheetArchiveRestore(archiveId) {
  const st = _sheetArchiveModalState;
  if (!st || !archiveId) return;
  const ok = typeof cfConfirm === 'function'
    ? await cfConfirm('このアーカイブのエントリを表示中のシートへ戻します。同名エントリは復元せず残します。')
    : confirm('このアーカイブのエントリを表示中のシートへ戻します。');
  if (!ok) return;
  _sheetArchiveSetStatus('復元しています...');
  _sheetArchiveBeginBusy();
  try {
    const res = await apiPost('/sheet-archive/restore', { path: st.path, archive_id: archiveId, limit: _sheetArchiveNum(st.modal, '[data-sheet-archive-limit]', 500) });
    const conflicts = Array.isArray(res.conflicts) ? res.conflicts.length : 0;
    _sheetArchiveSetStatus(Number(res.restored || 0).toLocaleString('ja-JP') + '件を復元しました' + (conflicts ? '（重複 ' + conflicts + '件）' : ''));
    await _sheetArchiveLoad(true);
    if (typeof selectDatabase === 'function') selectDatabase(st.path);
  } catch (error) {
    _sheetArchiveSetStatus(error?.message || '復元に失敗しました', true);
  } finally {
    _sheetArchiveEndBusy();
  }
}

async function _sheetArchiveSearch() {
  const st = _sheetArchiveModalState;
  if (!st) return;
  const q = st.searchInput.value.trim();
  st.searchResults.innerHTML = '';
  if (!q) return;
  _sheetArchiveSetStatus('アーカイブを検索しています...');
  _sheetArchiveBeginBusy();
  try {
    const params = new URLSearchParams({ path: st.path, q, limit: '50' });
    const res = await apiFetch('/sheet-archive/search?' + params.toString());
    const results = res.results || [];
    if (!results.length) {
      const empty = document.createElement('div');
      empty.className = 'gb-section-desc';
      empty.textContent = '一致するアーカイブはありません';
      st.searchResults.appendChild(empty);
    }
    results.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'gb-field-row';
      row.style.cssText = 'align-items:flex-start;border-bottom:1px solid var(--border);padding:6px 0;';
      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0;';
      const title = document.createElement('div');
      title.style.cssText = 'font-size:13px;color:var(--fg);font-weight:600;';
      title.textContent = item.name || item.file_name;
      const text = document.createElement('div');
      text.className = 'gb-section-desc';
      text.textContent = item.text || item.archive_id || '';
      info.appendChild(title);
      info.appendChild(text);
      const restore = _sheetArchiveButton('この件を復元');
      restore.dataset.e2eId = `sheet-archive-search-restore-${index}`;
      restore.addEventListener('click', () => _sheetArchiveRestoreOne(item));
      row.appendChild(info);
      row.appendChild(restore);
      st.searchResults.appendChild(row);
    });
    _sheetArchiveSetStatus(results.length + '件見つかりました');
  } catch (error) {
    _sheetArchiveSetStatus(error?.message || 'アーカイブ検索に失敗しました', true);
  } finally {
    _sheetArchiveEndBusy();
  }
}

async function _sheetArchiveRestoreOne(item) {
  const st = _sheetArchiveModalState;
  if (!st || !item?.archive_id) return;
  _sheetArchiveBeginBusy();
  try {
    const res = await apiPost('/sheet-archive/restore', {
      path: st.path,
      archive_id: item.archive_id,
      entry_names: [item.file_name || item.name],
      limit: 1,
    });
    _sheetArchiveSetStatus(Number(res.restored || 0).toLocaleString('ja-JP') + '件を復元しました');
    await _sheetArchiveLoad(true);
    if (typeof selectDatabase === 'function') selectDatabase(st.path);
  } catch (error) {
    _sheetArchiveSetStatus(error?.message || '復元に失敗しました', true);
  } finally {
    _sheetArchiveEndBusy();
  }
}

function showSheetArchiveModal(path) {
  const sheetPath = _sheetArchiveCurrentPath(path);
  if (!sheetPath) {
    if (typeof showStatus === 'function') showStatus('シートを開いてから実行してください', true);
    return;
  }
  if (_sheetArchiveModalState?.modalApi?.isOpen?.()) return _sheetArchiveModalState.overlay;
  if (typeof window.GBUI?.createModal !== 'function') {
    throw new Error('共通ダイアログを初期化できませんでした。');
  }
  document.querySelectorAll('.modal-overlay[data-sheet-archive]').forEach(el => el.remove());

  const body = document.createElement('div');
  body.className = 'gb-sheet-archive-body';
  body.dataset.e2eId = 'sheet-archive-body';

  const summary = document.createElement('div');
  summary.className = 'gb-section-desc';
  summary.dataset.e2eId = 'sheet-archive-summary';
  summary.textContent = '読み込み中...';

  const condition = document.createElement('section');
  condition.className = 'gb-section gb-section--boxed';
  condition.innerHTML = `
    <div class="gb-section-title">アーカイブ条件</div>
    <label class="gb-field-row"><span class="gb-label">表示に残す件数</span><input id="sheet-archive-max" data-sheet-archive-max data-e2e-id="sheet-archive-max" type="number" min="0" class="gb-input" style="width:110px;"><span class="gb-section-desc">0で件数条件なし</span></label>
    <label class="gb-field-row"><span class="gb-label">対象期間</span><input id="sheet-archive-days" data-sheet-archive-days data-e2e-id="sheet-archive-days" type="number" min="0" class="gb-input" style="width:110px;"><span class="gb-section-desc">日前より古いもの（0で期間条件なし）</span></label>
    <label class="gb-field-row"><span class="gb-label">1回の処理件数</span><input id="sheet-archive-limit" data-sheet-archive-limit data-e2e-id="sheet-archive-limit" type="number" min="1" class="gb-input" style="width:110px;"></label>
  `;
  const actionRow = document.createElement('div');
  actionRow.className = 'gb-field-row';
  actionRow.style.justifyContent = 'flex-start';
  const saveBtn = _sheetArchiveButton('条件を保存');
  saveBtn.dataset.e2eId = 'sheet-archive-save-policy';
  const previewBtn = _sheetArchiveButton('候補を確認');
  previewBtn.dataset.e2eId = 'sheet-archive-preview';
  const runBtn = _sheetArchiveButton('候補をアーカイブ', 'gb-btn gb-btn-sm gb-btn-primary');
  runBtn.dataset.e2eId = 'sheet-archive-run';
  actionRow.appendChild(saveBtn);
  actionRow.appendChild(previewBtn);
  actionRow.appendChild(runBtn);
  condition.appendChild(actionRow);

  const candidateList = document.createElement('div');
  candidateList.dataset.e2eId = 'sheet-archive-candidates';
  candidateList.style.cssText = 'max-height:160px;overflow:auto;';
  condition.appendChild(candidateList);

  const search = document.createElement('section');
  search.className = 'gb-section gb-section--boxed';
  const searchTitle = document.createElement('div');
  searchTitle.className = 'gb-section-title';
  searchTitle.textContent = 'アーカイブ検索';
  const searchRow = document.createElement('div');
  searchRow.className = 'gb-field-row';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'gb-input';
  searchInput.dataset.e2eId = 'sheet-archive-search-input';
  searchInput.placeholder = 'アーカイブ内を検索';
  searchInput.style.flex = '1';
  const searchBtn = _sheetArchiveButton('検索');
  searchBtn.dataset.e2eId = 'sheet-archive-search';
  searchRow.appendChild(searchInput);
  searchRow.appendChild(searchBtn);
  const searchResults = document.createElement('div');
  searchResults.dataset.e2eId = 'sheet-archive-search-results';
  searchResults.style.cssText = 'max-height:180px;overflow:auto;';
  search.appendChild(searchTitle);
  search.appendChild(searchRow);
  search.appendChild(searchResults);

  const archiveSection = document.createElement('section');
  archiveSection.className = 'gb-section gb-section--boxed';
  const archiveTitle = document.createElement('div');
  archiveTitle.className = 'gb-section-title';
  archiveTitle.textContent = '保存済みアーカイブ';
  const archiveList = document.createElement('div');
  archiveList.dataset.e2eId = 'sheet-archive-list';
  archiveList.style.cssText = 'max-height:190px;overflow:auto;';
  archiveSection.appendChild(archiveTitle);
  archiveSection.appendChild(archiveList);

  body.appendChild(summary);
  body.appendChild(condition);
  body.appendChild(search);
  body.appendChild(archiveSection);

  const footer = document.createElement('div');
  footer.className = 'gb-sheet-archive-footer';
  const statusEl = document.createElement('div');
  statusEl.className = 'gb-section-desc';
  statusEl.dataset.e2eId = 'sheet-archive-status';
  statusEl.style.cssText = 'flex:1;min-width:0;';
  const closeBtn = _sheetArchiveButton('閉じる');
  closeBtn.id = 'sheet-archive-close';
  closeBtn.dataset.e2eId = 'sheet-archive-close';
  footer.appendChild(statusEl);
  footer.appendChild(closeBtn);

  let modalApi = null;
  modalApi = window.GBUI.createModal({
    id: 'sheet-archive',
    title: 'シートアーカイブ管理',
    body,
    footer,
    variant: 'mobile-sheet',
    extraClass: 'gb-sheet-archive-modal',
    geometryKey: 'sheet-archive',
    initialFocus: '#sheet-archive-close',
    closeOnEsc: true,
    closeOnOverlay: true,
    onBeforeClose: () => Number(_sheetArchiveModalState?.busyDepth || 0) === 0,
    onClose: () => {
      if (_sheetArchiveModalState?.modalApi === modalApi) _sheetArchiveModalState = null;
    },
  });
  const overlay = modalApi.overlay;
  const modal = modalApi.modal;
  overlay.classList.add('modal-overlay', 'gb-sheet-archive-overlay');
  overlay.dataset.sheetArchive = '1';
  overlay.dataset.e2eId = 'sheet-archive-overlay';
  modal.dataset.e2eId = 'sheet-archive-dialog';
  const headerClose = modalApi.header.querySelector('.gb-modal-close');
  if (headerClose) headerClose.dataset.e2eId = 'sheet-archive-header-close';
  closeBtn.addEventListener('click', () => modalApi.close('button'));

  _sheetArchiveModalState = {
    modalApi,
    overlay,
    modal,
    path: sheetPath,
    summaryEl: summary,
    statusEl,
    maxInput: condition.querySelector('[data-sheet-archive-max]'),
    daysInput: condition.querySelector('[data-sheet-archive-days]'),
    limitInput: condition.querySelector('[data-sheet-archive-limit]'),
    candidateList,
    archiveList,
    searchInput,
    searchResults,
    closeBtn,
    busyDepth: 0,
    actionControls: [
      condition.querySelector('[data-sheet-archive-max]'),
      condition.querySelector('[data-sheet-archive-days]'),
      condition.querySelector('[data-sheet-archive-limit]'),
      saveBtn,
      previewBtn,
      runBtn,
      searchInput,
      searchBtn,
    ],
  };

  saveBtn.addEventListener('click', _sheetArchiveSavePolicy);
  previewBtn.addEventListener('click', _sheetArchivePreviewCandidates);
  runBtn.addEventListener('click', _sheetArchiveRun);
  searchBtn.addEventListener('click', _sheetArchiveSearch);
  searchInput.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && !ev.isComposing) _sheetArchiveSearch();
  });
  modalApi.open();
  _sheetArchiveLoad();
  return overlay;
}

if (typeof window !== 'undefined') {
  window.showSheetArchiveModal = showSheetArchiveModal;
}
