/* gb-db-link-prop.js
   プロパティ型「リンク」（type: 'link'）— ワークスペース/ホームフォルダ/ソースフォルダ配下の
   任意ファイル・フォルダへのリンクを1セル1リンクで保持する。

   - 値はパス文字列単体（既存セル値の慣習に乗せる。JSON化しない）
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
  if (!list.includes('application/x-meldex-node')) return false;
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
  const path = String(val?.value || '').trim();

  const wrap = document.createElement('span');
  wrap.className = 'db-link-val';
  wrap.style.cssText = 'display:inline-flex;align-items:center;gap:4px;max-width:100%;min-height:16px;';
  if (!path) return wrap;

  wrap.style.cursor = 'pointer';
  wrap.title = path;

  const icon = document.createElement('span');
  icon.style.cssText = 'display:inline-flex;flex-shrink:0;color:var(--fg2);';
  icon.innerHTML = lucide(_dbLinkIconFor(path), 13);
  wrap.appendChild(icon);

  const label = document.createElement('span');
  label.textContent = _dbLinkBaseName(path) || path;
  label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--accent2);text-decoration:underline dotted;font-size:12px;';
  wrap.appendChild(label);

  wrap.addEventListener('click', (e) => {
    e.stopPropagation();
    const paneId = wrap.closest?.('.gb-pane')?.dataset?.paneId || '';
    if (typeof openLinkInFloatPanel === 'function') {
      openLinkInFloatPanel(path, _dbLinkBaseName(path), { linkType: 'link', sourcePaneId: paneId });
    }
  });
  wrap.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    if (typeof openLink === 'function') openLink(path, _dbLinkBaseName(path));
  });

  void dbPath;
  return wrap;
}

/* ==============================
   保存（新規作成 / 既存置換 共通）
   ============================== */
async function _dbLinkCommitValue(args) {
  const {
    entityPath, propName, dbPath, ctx, existing, newPath, td,
    closeInlineEditorShell, refreshCellDisplayNow, restoreCellPos, anchorEl,
  } = args || {};
  const anchor = anchorEl || td || null;
  const oldValue = existing?.value || '';

  if (existing?.file) {
    if (oldValue === newPath) {
      if (typeof closeInlineEditorShell === 'function') closeInlineEditorShell();
      return;
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
      // ローカルのみの反映（サーバ通信なし）を先に試みる。失敗時のフォールバック
      // （_refreshAfterCellEdit経由のselectDatabase全体リロード）は保存完了後に行う。
      // 保存前にリロードすると、サーバ側にまだ反映されていない古い値で上書きされてしまうため。
      const refreshedLocally = typeof refreshCellDisplayNow === 'function' ? refreshCellDisplayNow([], newPath) : false;
      if (typeof restoreCellPos === 'function') restoreCellPos();
      await _apiPutValue(existing, { new_value: newPath });
      if (!refreshedLocally && typeof _refreshAfterCellEdit === 'function') _refreshAfterCellEdit(anchor, entityPath, propName);
      if (typeof _dbUndoValue === 'function') {
        _dbUndoValue('リンク: ' + oldValue + ' → ' + newPath, existing, oldValue, newPath, undefined, undefined, { dbPath, ctx });
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
      if (typeof _refreshAfterCellEdit === 'function') _refreshAfterCellEdit(anchor, entityPath, propName);
      if (typeof showStatus === 'function') showStatus('保存に失敗: ' + (e?.message || e), true);
    }
    return;
  }

  // 既存値なし → 新規作成
  try {
    let optimisticValue = null;
    if (typeof _upsertLocalPivotValue === 'function') {
      optimisticValue = _upsertLocalPivotValue(entityPath, propName, null, newPath, {
        file: '', property: propName, candidate_index: null, status: '採用', note: '',
      }, ctx);
    }
    const refreshedLocally = typeof refreshCellDisplayNow === 'function' ? refreshCellDisplayNow([], newPath) : false;
    if (typeof restoreCellPos === 'function') restoreCellPos();
    const result = await _apiPostValue(entityPath, propName, newPath, '採用', '');
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
          const redo = await _apiPostValue(entityPath, propName, newPath, '採用', '');
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
  } catch (e) {
    if (typeof showStatus === 'function') showStatus('保存に失敗: ' + (e?.message || e), true);
    if (typeof _refreshAfterCellEdit === 'function') _refreshAfterCellEdit(anchor, entityPath, propName);
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

/* ==============================
   セル編集起動（空セルクリック / startCellInlineAdd から呼ばれる）
   ============================== */
async function startDbLinkCellEdit(opts) {
  const {
    td, entityPath, entityName, propName, ctx, dbPath,
    cancel, closeInlineEditorShell, refreshCellDisplayNow, restoreCellPos,
  } = opts || {};
  if (typeof window === 'undefined' || !window.GBFolderPicker || typeof window.GBFolderPicker.pickFolder !== 'function') {
    if (typeof showStatus === 'function') showStatus('リンク選択機能を利用できません（フォルダツリーが読み込まれていません）', true);
    if (typeof cancel === 'function') cancel();
    return;
  }
  const existing = _dbLinkExistingValueFor(ctx, dbPath, entityName, propName);

  let selection = null;
  try {
    selection = await window.GBFolderPicker.pickFolder({
      selectFiles: true,
      title: 'リンク先を選択',
    });
  } catch (e) {
    if (typeof showStatus === 'function') showStatus('リンク選択に失敗しました: ' + (e?.message || e), true);
    if (typeof cancel === 'function') cancel();
    return;
  }
  if (!selection) {
    if (typeof cancel === 'function') cancel();
    return;
  }
  const newPath = _dbLinkPathFromPickerSelection(selection);
  if (!newPath) {
    if (typeof showStatus === 'function') showStatus('リンク先を解決できませんでした', true);
    if (typeof cancel === 'function') cancel();
    return;
  }
  await _dbLinkCommitValue({
    entityPath, propName, dbPath, ctx, existing, newPath, td,
    closeInlineEditorShell, refreshCellDisplayNow, restoreCellPos,
  });
}

// 既存値がある状態からの「リンク先を変更」（値コンテキストメニューから呼ばれる）
async function startDbLinkCellPick(val, entityPath, propName, dbPath, ctx, anchorEl) {
  if (typeof window === 'undefined' || !window.GBFolderPicker || typeof window.GBFolderPicker.pickFolder !== 'function') {
    if (typeof showStatus === 'function') showStatus('リンク選択機能を利用できません', true);
    return;
  }
  const lockMsg = typeof checkColumnEditable === 'function' ? checkColumnEditable(dbPath, propName) : null;
  if (lockMsg) { if (typeof showStatus === 'function') showStatus(lockMsg); return; }

  let selection = null;
  try {
    selection = await window.GBFolderPicker.pickFolder({
      selectFiles: true,
      title: 'リンク先を選択',
    });
  } catch (e) {
    if (typeof showStatus === 'function') showStatus('リンク選択に失敗しました: ' + (e?.message || e), true);
    return;
  }
  if (!selection) return;
  const newPath = _dbLinkPathFromPickerSelection(selection);
  if (!newPath) {
    if (typeof showStatus === 'function') showStatus('リンク先を解決できませんでした', true);
    return;
  }
  await _dbLinkCommitValue({
    entityPath, propName, dbPath, ctx,
    existing: (val?.file ? val : null),
    newPath,
    anchorEl: anchorEl || null,
  });
}

/* ==============================
   サイドバーD&D受理（td単位）
   ============================== */
function decorateDbLinkCellDrop(td, entityName, propName, ctx, dbPath) {
  if (!td || td._dbLinkDropBound) return;
  td._dbLinkDropBound = true;
  const highlightOn = () => { td.style.outline = '2px solid var(--accent)'; td.style.outlineOffset = '-2px'; };
  const highlightOff = () => { td.style.outline = ''; td.style.outlineOffset = ''; };
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
    const node = typeof MeldexDnD !== 'undefined' ? MeldexDnD.parseMeldexNode(e) : null;
    const newPath = _dbLinkPathFromDndNode(node);
    if (!newPath) return;
    const lockMsg = typeof checkColumnEditable === 'function' ? checkColumnEditable(dbPath, propName) : null;
    if (lockMsg) { if (typeof showStatus === 'function') showStatus(lockMsg); return; }
    const existing = _dbLinkExistingValueFor(ctx, dbPath, entityName, propName);
    const entityPath = typeof _entityPath === 'function'
      ? _entityPath(dbPath, entityName, (ctx && ctx.pivotData) || (typeof state !== 'undefined' ? state.pivotData : null))
      : (_dbLinkNormalizeSlashes(dbPath) + '/' + entityName + '.md');
    await _dbLinkCommitValue({ entityPath, propName, dbPath, ctx, existing, newPath, td });
  });
}
