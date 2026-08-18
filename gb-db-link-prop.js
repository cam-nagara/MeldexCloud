/* gb-db-link-prop.js
   プロパティ型「リンク」（type: 'link'）— ワークスペース/ホームフォルダ/ソースフォルダ配下の
   Web、Meldex内、PC内ファイル・フォルダへのリンクを1セル1リンクで保持する。

   - candidate.valueにはtarget文字列を残し、candidate.linkへ版付きメタデータを置く。
     旧値は文字列だけでも読めるため、旧版との往復互換を維持する。
   - パス形式は auto-link の data-path（_resolveAutoLinkPath で解決される形式）と同じに正規化する。
     サイドバーD&D（application/x-meldex-node の path）はそのままの形式、
     GBFolderPicker の選択結果は toSourceRelativePath() で変換してから使う
   - セル描画・保存・D&D受理・開く動作をここに集約し、既存ファイルへの追記は薄い分岐に留める
*/

function _dbLinkNormalizeSlashes(path) {
  return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function _dbLinkBaseName(path) {
  const norm = _dbLinkNormalizeSlashes(path);
  const parts = norm.split('/').filter(Boolean);
  return parts[parts.length - 1] || norm;
}

function _dbLinkExt(path) {
  const base = _dbLinkBaseName(path);
  const idx = base.lastIndexOf('.');
  return idx > 0 ? base.slice(idx + 1).toLowerCase() : '';
}

// 拡張子なし = フォルダ扱い（既存 _openLinkInCurrentTab の規約と一貫。許容仕様）
function _dbLinkIsFolder(path) {
  const lower = String(path || '').toLowerCase();
  if (lower.endsWith('.scriptnote.json')) return false;
  return !_dbLinkExt(path);
}

const _DB_LINK_ICON_BY_EXT = {
  md: 'fileText', txt: 'fileText', rtf: 'fileText', doc: 'fileText', docx: 'fileText', pdf: 'fileText',
  json: 'braces',
  xls: 'fileSpreadsheet', xlsx: 'fileSpreadsheet', csv: 'fileSpreadsheet',
  ppt: 'presentation', pptx: 'presentation',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', bmp: 'image', ico: 'image', avif: 'image',
  mp4: 'film', webm: 'film', mov: 'film', avi: 'film', mkv: 'film',
  mp3: 'music', wav: 'music', ogg: 'music', flac: 'music', aac: 'music', m4a: 'music',
  html: 'globe', htm: 'globe',
  zip: 'fileArchive', rar: 'fileArchive', '7z': 'fileArchive',
  py: 'fileCode', js: 'fileCode', ts: 'fileCode',
};

function _dbLinkIconFor(path) {
  if (_dbLinkIsFolder(path)) return 'folder';
  const lower = String(path || '').toLowerCase();
  if (lower.endsWith('.scriptnote.json') || lower.endsWith('.mel-scenario')) return 'bookOpenText';
  if (lower.endsWith('.mel-board') || lower.endsWith('.board.md')) return 'layoutGrid';
  if (lower.endsWith('.mel-sheet')) return 'database';
  return _DB_LINK_ICON_BY_EXT[_dbLinkExt(path)] || 'file';
}

const _DB_LINK_KINDS = new Set(['web', 'meldex', 'local-file', 'local-folder']);
const _DB_LINK_EXECUTABLE_EXTS = new Set([
  'exe', 'com', 'bat', 'cmd', 'ps1', 'vbs', 'js', 'jse', 'wsf', 'wsh', 'msi', 'msp', 'scr', 'lnk', 'url',
]);

function _dbLinkInferKind(target) {
  const value = String(target || '').trim();
  if (/^https?:\/\//i.test(value)) return 'web';
  if (/^(?:[a-z]:[\\/]|\\\\)/i.test(value)) return _dbLinkIsFolder(value) ? 'local-folder' : 'local-file';
  return 'meldex';
}

function _dbLinkFallbackLabel(kind, target) {
  if (kind === 'web') {
    try {
      const url = new URL(target);
      const tail = url.pathname.split('/').filter(Boolean).pop();
      return tail ? decodeURIComponent(tail) : url.hostname;
    } catch (_) { return String(target || ''); }
  }
  return _dbLinkBaseName(target) || String(target || '');
}

function _dbLinkDescriptor(valueOrCandidate, fallbackKind) {
  const candidate = valueOrCandidate && typeof valueOrCandidate === 'object' ? valueOrCandidate : null;
  const target = String(candidate?.value ?? valueOrCandidate ?? '').trim();
  const metadata = candidate?.link && typeof candidate.link === 'object' ? candidate.link : {};
  const kind = _DB_LINK_KINDS.has(metadata.kind) ? metadata.kind
    : (_DB_LINK_KINDS.has(fallbackKind) ? fallbackKind : _dbLinkInferKind(target));
  return {
    version: 1,
    kind,
    target: String(metadata.target || target).trim(),
    label: String(metadata.label || '').trim() || _dbLinkFallbackLabel(kind, metadata.target || target),
  };
}

function _dbLinkIconForDescriptor(link) {
  if (link.kind === 'web') return 'externalLink';
  if (link.kind === 'local-folder') return 'folder';
  if (link.kind === 'local-file') return _dbLinkIconFor(link.target);
  return _dbLinkIconFor(link.target);
}

function _dbLinkIsCloudRuntime() {
  return !!window.MeldexRuntimeAdapter?.isBrowserDataMode?.();
}

function _dbLinkConfirm(message) {
  return new Promise(resolve => {
    if (typeof showConfirmDialog === 'function') {
      showConfirmDialog(message, () => resolve(true), () => resolve(false));
    } else resolve(false);
  });
}

async function _dbLinkOpen(link, sourceEl) {
  if (!link?.target) return false;
  if (link.kind === 'web') {
    window.open(link.target, '_blank', 'noopener');
    return true;
  }
  if (link.kind === 'meldex') {
    const paneId = sourceEl?.closest?.('.gb-pane')?.dataset?.paneId || '';
    if (typeof openLinkInRightSidebar === 'function') {
      openLinkInRightSidebar(link.target, link.label, { linkType: 'link', sourcePaneId: paneId });
      return true;
    }
    if (typeof openLink === 'function') {
      openLink(link.target, link.label);
      return true;
    }
    return false;
  }
  if (_dbLinkIsCloudRuntime()) {
    if (typeof showStatus === 'function') showStatus('このリンクはPC版で開けます');
    return false;
  }
  const dangerousLocalTarget = _DB_LINK_EXECUTABLE_EXTS.has(_dbLinkExt(link.target));
  if (dangerousLocalTarget) {
    const confirmed = await _dbLinkConfirm('次のPC内ファイルを実行しますか？\n' + link.target);
    if (!confirmed) return false;
  }
  try {
    await apiPost('/open-local-path', {
      path: link.target,
      kind: link.kind,
      confirmed_dangerous: dangerousLocalTarget,
    });
    return true;
  } catch (error) {
    if (typeof showStatus === 'function') showStatus('リンクを開けませんでした: ' + (error?.message || error), true);
    return false;
  }
}

// GBFolderPicker の選択結果（絶対パス基準）を auto-link data-path 相当の形式へ正規化
function _dbLinkPathFromPickerSelection(selection) {
  if (!selection) return '';
  if (typeof window !== 'undefined' && window.GBFolderPicker?.toSourceRelativePath) {
    const converted = window.GBFolderPicker.toSourceRelativePath(selection);
    if (converted) return _dbLinkNormalizeSlashes(converted);
  }
  return _dbLinkNormalizeSlashes(selection.path || '');
}

// サイドバーD&D（application/x-meldex-node）由来のノードをリンク値へ正規化。
// type: 'entity'（セル値・エントリ名のドラッグ）は対象外として弾く
function _dbLinkPathFromDndNode(node) {
  if (!node || !node.path || node.type === 'entity') return '';
  return _dbLinkNormalizeSlashes(node.path);
}

function _dbLinkDndAcceptable(e) {
  const types = e?.dataTransfer?.types;
  if (!types) return false;
  const list = Array.from(types);
  const hasOsFile = list.includes('Files') && Array.from(e?.dataTransfer?.files || []).some(file => file?.path);
  if (!(typeof MeldexDnD !== 'undefined' && MeldexDnD.hasDropKind(e, 'node'))
      && !list.includes('application/x-meldex-node') && !hasOsFile) return false;
  if (list.includes('text/x-meldex-rows')) return false; // 行並べ替えD&Dとは分離
  return true;
}

/* ==============================
   セル描画
   ============================== */
function createDbLinkValueElement(val, entityPath, propName, thumbSize, propTypeConfig, options) {
  void thumbSize;
  void propTypeConfig;
  const dbPath = options?.dbPath || (typeof _valueEditorDbPath === 'function' ? _valueEditorDbPath(entityPath) : '');
  const linkValue = _dbLinkDescriptor(val, propTypeConfig?.type === 'url' ? 'web' : '');
  const path = linkValue.target;

  const wrap = document.createElement('span');
  wrap.className = 'db-link-val';
  if (!path) return wrap;

  wrap.title = path;

  const icon = document.createElement('span');
  icon.className = 'db-link-val-icon';
  icon.innerHTML = lucide(_dbLinkIconForDescriptor(linkValue), 13);
  wrap.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'db-link-val-label';
  label.textContent = linkValue.label;
  wrap.appendChild(label);

  wrap.setAttribute('role', 'link');
  wrap.tabIndex = 0;
  wrap.setAttribute('aria-label', `${linkValue.label}を開く`);
  if (typeof _dbCellInteractiveE2eId === 'function') {
    wrap.dataset.e2eId = _dbCellInteractiveE2eId('link', entityPath, propName, path);
  } else {
    wrap.dataset.e2eId = `db-link-${String(entityPath)}-${String(propName)}`.replace(/[^A-Za-z0-9_-]+/g, '-');
  }
  wrap.addEventListener('click', (e) => {
    e.stopPropagation();
    _dbLinkOpen(linkValue, wrap);
  });
  wrap.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    _dbLinkOpen(linkValue, wrap);
  });

  void dbPath;
  return wrap;
}

/* ==============================
   保存（新規作成 / 既存置換 共通）
   ============================== */
async function _dbLinkCommitValue(args) {
  const {
    entityPath, propName, dbPath, ctx, existing, newPath, newLink, td,
    closeInlineEditorShell, refreshCellDisplayNow, restoreCellPos, anchorEl,
  } = args || {};
  const anchor = anchorEl || td || null;
  const oldValue = existing?.value || '';
  const oldLink = existing?.link && typeof existing.link === 'object' ? { ...existing.link } : null;
  const normalizedLink = _dbLinkDescriptor({ value: newPath, link: newLink });

  if (existing?.file) {
    if (oldValue === newPath && JSON.stringify(oldLink || {}) === JSON.stringify(normalizedLink)) {
      if (typeof closeInlineEditorShell === 'function') closeInlineEditorShell();
      return true;
    }
    try {
      if (typeof closeInlineEditorShell === 'function') closeInlineEditorShell();
      if (typeof _upsertLocalPivotValue === 'function') {
        _upsertLocalPivotValue(entityPath, propName, existing, newPath, {
          file: existing.file,
          property: existing.property || propName,
          candidate_index: existing.candidate_index,
          status: existing.status || '採用',
          note: existing.note || '',
        }, ctx);
      } else {
        existing.value = newPath;
      }
      existing.link = normalizedLink;
      // ローカルのみの反映（サーバ通信なし）を先に試みる。失敗時のフォールバック
      // （_refreshAfterCellEdit経由のselectDatabase全体リロード）は保存完了後に行う。
      // 保存前にリロードすると、サーバ側にまだ反映されていない古い値で上書きされてしまうため。
      const refreshedLocally = typeof refreshCellDisplayNow === 'function' ? refreshCellDisplayNow([], newPath) : false;
      if (typeof restoreCellPos === 'function') restoreCellPos();
      await _apiPutValue(existing, { new_value: newPath, new_link: normalizedLink });
      if (!refreshedLocally && typeof _refreshAfterCellEdit === 'function') _refreshAfterCellEdit(anchor, entityPath, propName);
      if (typeof _dbUndoValue === 'function') {
        _dbUndoValue('リンク: ' + oldValue + ' → ' + newPath, existing, oldValue, newPath, undefined, undefined, {
          dbPath, ctx, oldUpdates: { new_link: oldLink }, newUpdates: { new_link: normalizedLink },
        });
      }
      if (typeof showStatus === 'function') showStatus('リンクを設定しました');
    } catch (e) {
      if (typeof _upsertLocalPivotValue === 'function') {
        _upsertLocalPivotValue(entityPath, propName, existing, oldValue, {
          file: existing.file,
          property: existing.property || propName,
          candidate_index: existing.candidate_index,
          status: existing.status || '採用',
          note: existing.note || '',
        }, ctx);
      } else {
        existing.value = oldValue;
      }
      if (oldLink) existing.link = oldLink; else delete existing.link;
      if (typeof _refreshAfterCellEdit === 'function') _refreshAfterCellEdit(anchor, entityPath, propName);
      if (typeof showStatus === 'function') showStatus('保存に失敗: ' + (e?.message || e), true);
      return false;
    }
    return true;
  }

  // 既存値なし → 新規作成
  try {
    let optimisticValue = null;
    if (typeof _upsertLocalPivotValue === 'function') {
      optimisticValue = _upsertLocalPivotValue(entityPath, propName, null, newPath, {
        file: '', property: propName, candidate_index: null, status: '採用', note: '',
      }, ctx);
      if (optimisticValue) optimisticValue.link = normalizedLink;
    }
    const refreshedLocally = typeof refreshCellDisplayNow === 'function' ? refreshCellDisplayNow([], newPath) : false;
    if (typeof restoreCellPos === 'function') restoreCellPos();
    const result = await _apiPostValue(entityPath, propName, newPath, '採用', '', '', { link: normalizedLink });
    const filePath = result?.path || '';
    if (optimisticValue) {
      optimisticValue.file = filePath;
      optimisticValue.entry_path = entityPath;
      optimisticValue.candidate_index = result?.candidate_index;
      optimisticValue.property = propName;
    }
    if (!refreshedLocally && typeof _refreshAfterCellEdit === 'function') _refreshAfterCellEdit(anchor, entityPath, propName);
    if (filePath && typeof historyPush === 'function') {
      let currentRef = {
        file: filePath,
        entry_path: entityPath,
        property: result?.property || propName,
        candidate_index: result?.candidate_index,
      };
      const dbScope = typeof _dbScopeForPath === 'function'
        ? _dbScopeForPath(dbPath)
        : (typeof _dbScope === 'function' ? _dbScope(dbPath) : '');
      historyPush('リンク設定: ' + propName + '=' + newPath,
        async () => {
          await _apiPutValue(currentRef, { _delete: true });
          if (dbPath && typeof selectDatabase === 'function') await selectDatabase(dbPath, ctx, { silent: true });
        },
        async () => {
          const redo = await _apiPostValue(entityPath, propName, newPath, '採用', '', '', { link: normalizedLink });
          currentRef = {
            file: redo?.path || redo?.file || currentRef.file,
            entry_path: entityPath,
            property: redo?.property || propName,
            candidate_index: redo?.candidate_index,
          };
          if (dbPath && typeof selectDatabase === 'function') await selectDatabase(dbPath, ctx, { silent: true });
        },
        dbScope
      );
    }
    if (typeof showStatus === 'function') showStatus('リンクを設定しました');
    return true;
  } catch (e) {
    if (typeof showStatus === 'function') showStatus('保存に失敗: ' + (e?.message || e), true);
    if (typeof _refreshAfterCellEdit === 'function') _refreshAfterCellEdit(anchor, entityPath, propName);
    return false;
  }
}

function _dbLinkExistingValueFor(ctx, dbPath, entityName, propName) {
  const pivotData = (ctx && ctx.pivotData) || (typeof state !== 'undefined' ? state.pivotData : null);
  const entData = pivotData?.entities?.[entityName];
  const rawValues = Array.isArray(entData?.[propName]) ? entData[propName] : [];
  return (typeof getAdoptedValueForWrite === 'function' ? getAdoptedValueForWrite(rawValues) : null)
    || rawValues.find(v => v && v.file)
    || null;
}

async function _dbLinkFetchWebTitle(target) {
  if (!/^https?:\/\//i.test(String(target || ''))) return '';
  try {
    const result = await apiPost('/link/title', { url: String(target).trim() });
    return String(result?.title || '').trim();
  } catch (_) { return ''; }
}

function _dbLinkShowEditor(initial, anchorEl) {
  const current = _dbLinkDescriptor(initial || '');
  return new Promise(resolve => {
    if (!globalThis.GBUI?.createModal) {
      if (typeof showStatus === 'function') showStatus('リンク編集画面を開けません', true);
      resolve(null);
      return;
    }
    const body = document.createElement('div');
    body.className = 'db-link-editor-body';
    body.innerHTML = `
      <label>種類<select class="gb-select" data-link-kind>
        <option value="web">Web</option><option value="meldex">Meldex内</option>
        <option value="local-file">PC内ファイル</option><option value="local-folder">PC内フォルダ</option>
      </select></label>
      <label>リンク先<input class="gb-input" data-link-target autocomplete="off" spellcheck="false"></label>
      <label>表示名<input class="gb-input" data-link-label autocomplete="off"></label>
      <button type="button" class="gb-btn" data-link-browse>${lucide('folderOpen', 14)} PCから選択</button>
      <div class="db-link-editor-status" data-link-status role="status" aria-live="polite"></div>`;
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'gb-btn gb-btn-secondary';
    cancelButton.textContent = 'キャンセル';
    cancelButton.dataset.linkCancel = '1';
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'gb-btn gb-btn-primary';
    saveButton.textContent = '保存';
    saveButton.dataset.linkSave = '1';
    const kind = body.querySelector('[data-link-kind]');
    const target = body.querySelector('[data-link-target]');
    const label = body.querySelector('[data-link-label]');
    const browse = body.querySelector('[data-link-browse]');
    const status = body.querySelector('[data-link-status]');
    kind.value = current.kind;
    target.value = current.target;
    label.value = current.label;
    let result = null;
    let resolved = false;
    const modalApi = globalThis.GBUI.createModal({
      id: 'db-link-editor',
      title: 'リンクを編集',
      body,
      footer: [cancelButton, saveButton],
      variant: 'standard',
      extraClass: 'db-link-editor',
      geometryKey: 'sheet-link-editor',
      initialFocus: target,
      returnFocus: anchorEl || undefined,
      closeOnEsc: true,
      closeOnOverlay: true,
      onClose: () => {
        if (resolved) return;
        resolved = true;
        resolve(result);
      },
    });
    modalApi.modal.id = 'db-link-editor';
    modalApi.modal.dataset.e2eId = 'db-link-editor';
    let labelWasAutomatic = !current.label || current.label === _dbLinkFallbackLabel(current.kind, current.target);
    let submitting = false;
    const syncKindUi = () => {
      browse.hidden = kind.value === 'web';
      target.placeholder = kind.value === 'web' ? 'https://example.com' : 'リンク先を入力または選択';
    };
    const finish = (value, reason) => {
      result = value;
      modalApi.close(reason || 'programmatic');
    };
    const refreshWebLabel = async () => {
      if (kind.value !== 'web' || !/^https?:\/\//i.test(target.value.trim())) return;
      status.textContent = 'ページ名を取得しています…';
      const title = await _dbLinkFetchWebTitle(target.value);
      if (!modalApi.modal.isConnected) return;
      if (title && (labelWasAutomatic || !label.value.trim())) {
        label.value = title;
        labelWasAutomatic = true;
      }
      status.textContent = title ? '' : 'ページ名を取得できないため、URLから表示名を補います';
    };
    kind.addEventListener('change', () => {
      syncKindUi();
      if (labelWasAutomatic) label.value = _dbLinkFallbackLabel(kind.value, target.value);
    });
    target.addEventListener('input', event => {
      if (event.isComposing) return;
      if (/^https?:\/\//i.test(target.value.trim()) && kind.value !== 'web') {
        kind.value = 'web';
        syncKindUi();
      }
      if (labelWasAutomatic) label.value = _dbLinkFallbackLabel(kind.value, target.value);
    });
    target.addEventListener('change', refreshWebLabel);
    label.addEventListener('input', () => { labelWasAutomatic = !label.value.trim(); });
    browse.addEventListener('click', async () => {
      if (!window.GBFolderPicker?.pickFolder) return;
      const selection = await window.GBFolderPicker.pickFolder({
        selectFiles: kind.value !== 'local-folder', title: 'リンク先を選択',
      });
      if (!selection) return;
      const picked = kind.value.startsWith('local-')
        ? _dbLinkNormalizeSlashes(selection.path || '')
        : _dbLinkPathFromPickerSelection(selection);
      if (!picked) return;
      target.value = picked;
      if (kind.value.startsWith('local-')) kind.value = selection.isFile === false ? 'local-folder' : _dbLinkInferKind(picked);
      if (labelWasAutomatic) label.value = _dbLinkFallbackLabel(kind.value, picked);
      syncKindUi();
    });
    const submit = async event => {
      if (event?.isComposing || submitting) return;
      const targetValue = target.value.trim();
      if (!targetValue) { status.textContent = 'リンク先を入力してください'; target.focus(); return; }
      if (kind.value === 'web' && !/^https?:\/\//i.test(targetValue)) {
        status.textContent = 'Webリンクは http:// または https:// で入力してください'; target.focus(); return;
      }
      submitting = true;
      saveButton.disabled = true;
      if (kind.value === 'web' && (labelWasAutomatic || !label.value.trim())) {
        status.textContent = 'ページ名を取得しています…';
        const fetchedTitle = await _dbLinkFetchWebTitle(targetValue);
        if (fetchedTitle) label.value = fetchedTitle;
      }
      finish(_dbLinkDescriptor({ value: targetValue, link: {
        version: 1, kind: kind.value, target: targetValue, label: label.value.trim(),
      } }), 'save');
    };
    saveButton.addEventListener('click', submit);
    cancelButton.addEventListener('click', () => finish(null, 'cancel'));
    body.addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.target !== kind && !event.isComposing) {
        event.preventDefault();
        submit(event);
      }
    });
    syncKindUi();
    modalApi.open();
    requestAnimationFrame(() => target.select());
  });
}

/* ==============================
   セル編集起動（空セルクリック / startCellInlineAdd から呼ばれる）
   ============================== */
async function startDbLinkCellEdit(opts) {
  const {
    td, entityPath, entityName, propName, ctx, dbPath,
    cancel, closeInlineEditorShell, refreshCellDisplayNow, restoreCellPos,
  } = opts || {};
  const existing = _dbLinkExistingValueFor(ctx, dbPath, entityName, propName);
  const edited = await _dbLinkShowEditor(existing || '', td);
  if (!edited) {
    if (typeof cancel === 'function') cancel();
    return;
  }
  await _dbLinkCommitValue({
    entityPath, propName, dbPath, ctx, existing, newPath: edited.target, newLink: edited, td,
    closeInlineEditorShell, refreshCellDisplayNow, restoreCellPos,
  });
}

// 既存値がある状態からの「リンク先を変更」（値コンテキストメニューから呼ばれる）
async function startDbLinkCellPick(val, entityPath, propName, dbPath, ctx, anchorEl) {
  const lockMsg = typeof checkColumnEditable === 'function' ? checkColumnEditable(dbPath, propName) : null;
  if (lockMsg) { if (typeof showStatus === 'function') showStatus(lockMsg); return; }

  const edited = await _dbLinkShowEditor(val || '', anchorEl);
  if (!edited) return;
  await _dbLinkCommitValue({
    entityPath, propName, dbPath, ctx,
    existing: (val?.file ? val : null),
    newPath: edited.target,
    newLink: edited,
    anchorEl: anchorEl || null,
  });
}

/* ==============================
   サイドバーD&D受理（td単位）
   ============================== */
function decorateDbLinkCellDrop(td, entityName, propName, ctx, dbPath) {
  if (!td || td._dbLinkDropBound) return;
  td._dbLinkDropBound = true;
  const highlightOn = () => td.classList.add('db-link-drop-target');
  const highlightOff = () => td.classList.remove('db-link-drop-target');
  td.addEventListener('dragover', (e) => {
    if (!_dbLinkDndAcceptable(e)) return;
    e.preventDefault();
    e.stopPropagation();
    highlightOn();
  });
  td.addEventListener('dragleave', highlightOff);
  td.addEventListener('drop', async (e) => {
    if (!_dbLinkDndAcceptable(e)) return;
    e.preventDefault();
    e.stopPropagation();
    highlightOff();
    const osFile = Array.from(e.dataTransfer?.files || []).find(file => file?.path);
    const resolved = !osFile && typeof MeldexDnD !== 'undefined' ? await MeldexDnD.resolveDropData(e, 'node') : null;
    const node = resolved?.payload || (!osFile && typeof MeldexDnD !== 'undefined' ? MeldexDnD.parseMeldexNode(e) : null);
    const newPath = osFile ? _dbLinkNormalizeSlashes(osFile.path) : _dbLinkPathFromDndNode(node);
    if (!newPath) { if (resolved) MeldexDnD.failDrop(resolved); return; }
    const lockMsg = typeof checkColumnEditable === 'function' ? checkColumnEditable(dbPath, propName) : null;
    if (lockMsg) {
      if (typeof showStatus === 'function') showStatus(lockMsg);
      if (resolved) MeldexDnD.failDrop(resolved);
      return;
    }
    const existing = _dbLinkExistingValueFor(ctx, dbPath, entityName, propName);
    const entityPath = typeof _entityPath === 'function'
      ? _entityPath(dbPath, entityName, (ctx && ctx.pivotData) || (typeof state !== 'undefined' ? state.pivotData : null))
      : (_dbLinkNormalizeSlashes(dbPath) + '/' + entityName + '.md');
    const newLink = _dbLinkDescriptor({ value: newPath, link: {
      version: 1,
      kind: osFile ? (osFile.type || _dbLinkExt(newPath) ? 'local-file' : 'local-folder') : 'meldex',
      target: newPath,
      label: osFile?.name || _dbLinkBaseName(newPath),
    } });
    const saved = await _dbLinkCommitValue({ entityPath, propName, dbPath, ctx, existing, newPath, newLink, td });
    if (resolved && saved) MeldexDnD.completeDrop(resolved);
    else if (resolved) MeldexDnD.failDrop(resolved);
  });
}
