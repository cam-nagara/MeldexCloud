/* ==============================
   gb-db-core.js: シート共通 helper

   gb-database.js / gb-db-props.js から共有される基礎 helper を分離。
   panel-local state と互換 global state の境界をここで吸収する。
   ============================== */

const DB_CACHE_TTL_MS = {
  relation: 30000,
  metadata: 30000,
  rollup: 30000,
};

function _dbCacheTtl(kind) {
  return DB_CACHE_TTL_MS[kind] || DB_CACHE_TTL_MS.relation;
}

function _dbCacheIsFresh(entry, kind) {
  return !!entry && Date.now() - (entry.timestamp || 0) < _dbCacheTtl(kind);
}

function _dbCloneJsonSafe(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function _dbCacheWrap(data) {
  return { data: _dbCloneJsonSafe(data), timestamp: Date.now() };
}

// 列のロック設定を取得: 'none' | 'admin' | 'locked'
function getColumnLock(dbPath, propName) {
  const cfg = getDbViewConfig(dbPath);
  return (cfg.columnLocks && cfg.columnLocks[propName]) || 'none';
}

function setColumnLock(dbPath, propName, lock, options = {}) {
  const cfg = getDbViewConfig(dbPath);
  if (!cfg.columnLocks) cfg.columnLocks = {};
  if (lock === 'none') {
    delete cfg.columnLocks[propName];
    if (Object.keys(cfg.columnLocks).length === 0) delete cfg.columnLocks;
  } else {
    cfg.columnLocks[propName] = lock;
  }
  saveDbViewConfig(dbPath, cfg, {
    historyLabel: options.label || 'シート表示: 列ロック',
    historyDetail: options.detail || propName || '',
    skipHistory: options.skipHistory === true,
  });
}

function _isAdminUser(filePath) {
  if (typeof getMyRoleForPath === 'function') return getMyRoleForPath(filePath || '') === 'owner';
  if (typeof _myTeamRole !== 'undefined') return _myTeamRole === 'owner';
  return false;
}

function checkColumnEditable(dbPath, propName) {
  const ptc = dbPath ? getPropertyTypes(dbPath)[propName] : null;
  if (ptc && ptc.source) return 'この列は自動入力（読み取り専用）です';
  const lock = getColumnLock(dbPath, propName);
  if (lock === 'locked') return 'この列はロックされています';
  if (lock === 'admin' && !_isAdminUser(dbPath)) return 'この列は管理者のみ編集できます';
  return null;
}

function _isNewFormatDb() {
  return !!(state.pivotData && state.pivotData.new_format);
}

function _dbNormalizePath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

// 制作管理の各シートは列名と型設定を契約として相互参照しているため、既存列の
// 削除・改名・型変更を許可しない。ヴォールト相対パスだけでなく、ソースフォルダ名やドライブ名を含む
// 絶対パスでも末尾の「制作管理/シート/<シート名>」を同じように判定する。
function isProductionManagementSheetPath(path) {
  const parts = _dbNormalizePath(path).split('/').filter(Boolean);
  if (parts.length < 3) return false;
  const sheetIndex = parts.length - 3;
  return parts[sheetIndex] === '制作管理'
    && parts[sheetIndex + 1] === 'シート'
    && !!parts[sheetIndex + 2];
}

// スタッフ管理シート（正本）の列保護レベルを判定する。
// 返り値: 'all'（制作管理シート・従来動作を維持、全列ロック）/
//         'required'（正本シートの必須列。名前・型変更と削除のみ拒否、
//         管理者追加の任意列は自由に削除・改名・型変更できる）/ null（無保護）。
// 置き場所が設定で変更できる正本シートは固定パスパターンでは判定できないため、
// primeConfigCache() でウォームアップ済みの設定キャッシュに対する dbPath の
// 一致で判定する（バックエンド側は meldex_registry マーカーで同等の判定をする。
// 計画書§5.1・§5.2参照）。
function getSchemaProtectionLevel(dbPath, propName) {
  const targetPath = dbPath || (typeof state !== 'undefined' ? state.currentDbPath : '') || '';
  if (isProductionManagementSheetPath(targetPath)) return 'all';
  if (typeof window === 'undefined') return null;
  if (window.MeldexUserRegistry?.isRegistryPathSync?.(targetPath)) {
    return window.MeldexStaffRegistrySchema?.isRequiredProperty?.(propName) ? 'required' : null;
  }
  return null;
}

function _dbDeleteCalendarSyncWarningMessage(responses) {
  const items = Array.isArray(responses) ? responses : [responses];
  const warningCount = items.filter(item => {
    if (!item || typeof item !== 'object') return false;
    return item.calendar_sync_warning === true || item.value?.calendar_sync_warning === true;
  }).length;
  if (!warningCount) return '';
  const subject = warningCount === 1 ? 'タスクの削除自体' : `${warningCount}件のタスク削除自体`;
  return `${subject}は完了しましたが、スケジュールとの同期に失敗しました。スケジュールを再読み込みし、残っている予定を確認してください。`;
}

// 制作管理の表示設定はローカルで変更できる一方、Cloud の閲覧専用・容量制限中、
// または埋め込み先ファイルの編集ロック中はバックエンドへ書き込まない。
function isProductionManagementWriteBlocked(dbPath, ctx) {
  if (!isProductionManagementSheetPath(dbPath)) return false;
  const availability = typeof window !== 'undefined'
    ? window.MeldexProductionUiAvailability?.current?.()
    : null;
  if (availability?.blocked) return true;
  if (ctx) return !!ctx.writeBlocked;
  // 古い表示操作には ctx を引き回さない呼び出しも残る。通常ペインと埋め込みが
  // 同じシートを開いている場合に先頭の通常ペインだけを見て保存を許可しないよう、
  // パスに結び付く全コンテキストのうち一つでもロック中なら書き込みを止める。
  return _dbPaneContextsForPath(dbPath).some(candidate => !!candidate?.writeBlocked);
}

function showProductionManagementSchemaLockedStatus() {
  if (typeof showStatus === 'function') {
    showStatus('制作管理に必要な列の名前・種類・設定は変更できません。表示順、列幅、フィルタ、並べ替え、非表示は変更できます', true);
  }
}

// 旧版で既に削除扱いになった制作管理列も復帰できるよう、読み込んだ表示設定から
// 列削除の tombstone だけを除去する。非表示・順序・ソート等の表示設定は触らない。
function repairProductionManagementDbViewConfig(dbPath, cfg) {
  if (!isProductionManagementSheetPath(dbPath) || !cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return false;
  if (!Object.prototype.hasOwnProperty.call(cfg, 'deletedProps')) return false;
  delete cfg.deletedProps;
  return true;
}

function _dbPathContains(path, rootPath) {
  const p = _dbNormalizePath(path);
  const root = _dbNormalizePath(rootPath);
  return !!root && (p === root || p.startsWith(root + '/'));
}

function _dbIsAbsolutePath(path) {
  const normalized = _dbNormalizePath(path);
  return /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('/');
}

// 作品フォルダー内のシートで使われている「設定/用語」のような参照先は、
// vault 相対として送ると複数ルート環境で別の場所へ解決される。編集中シートと
// 作品フォルダーがともに絶対パスで、実際に包含関係にある場合だけ絶対化する。
// それ以外の従来の vault 相対パス／Cloud パスは形式を変えずに維持する。
function _dbResolveConfiguredRelationPath(sourceDbPath, relationDbPath) {
  const relationPath = _dbNormalizePath(String(relationDbPath || '').trim());
  if (!relationPath || _dbIsAbsolutePath(relationPath)) return relationPath;
  const sourcePath = _dbNormalizePath(sourceDbPath);
  if (!_dbIsAbsolutePath(sourcePath) || typeof getWorkFolder !== 'function') return relationPath;
  let workFolder = '';
  try { workFolder = _dbNormalizePath(getWorkFolder()); } catch { workFolder = ''; }
  if (!_dbIsAbsolutePath(workFolder) || !_dbPathContains(sourcePath, workFolder)) return relationPath;
  return `${workFolder}/${relationPath.replace(/^\/+/, '')}`;
}

function _dbCanonicalizeRelationDbPathForSave(sourceDbPath, relationDbPath) {
  if (relationDbPath === '') return '';
  return _dbResolveConfiguredRelationPath(sourceDbPath, relationDbPath);
}

function _dbResolveRelationDbPath(sourceDbPath, propTypeConfig) {
  const ptc = propTypeConfig || {};
  if (ptc.relationDb === '' && ptc.relationDb !== undefined) return sourceDbPath || '';
  if (ptc.relationDb) return _dbResolveConfiguredRelationPath(sourceDbPath, ptc.relationDb);
  const target = String(ptc.target || '').trim();
  if (!target) return '';
  if (target.includes('/') || target.includes('\\')) return _dbResolveConfiguredRelationPath(sourceDbPath, target);
  const source = String(sourceDbPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const base = source.includes('/') ? source.replace(/\/[^/]*$/, '') : '';
  return base ? `${base}/${target}` : target;
}

function _dbFormatInfoFromPivotData(pivotData) {
  if (pivotData && Object.prototype.hasOwnProperty.call(pivotData, 'new_format')) {
    return { known: true, newFormat: !!pivotData.new_format };
  }
  return { known: false, newFormat: false };
}

function _dbFormatInfoForPath(dbPath, pivotData) {
  const explicit = _dbFormatInfoFromPivotData(pivotData);
  if (explicit.known) return explicit;
  const target = _dbNormalizePath(dbPath);
  if (typeof state !== 'undefined') {
    const current = _dbNormalizePath(state.currentDbPath);
    const currentInfo = _dbFormatInfoFromPivotData(state.pivotData);
    if (currentInfo.known && (!target || target === current)) return currentInfo;
  }
  const ctx = target && typeof _dbFindPaneContextForPath === 'function'
    ? _dbFindPaneContextForPath(target)
    : null;
  const ctxInfo = _dbFormatInfoFromPivotData(ctx?.pivotData);
  if (ctxInfo.known) return ctxInfo;
  return { known: false, newFormat: _isNewFormatDb() };
}

function _dbFormatInfoForValueFile(filePath) {
  const target = _dbNormalizePath(filePath);
  let best = null;
  const consider = (dbPath, pivotData) => {
    const root = _dbNormalizePath(dbPath);
    if (!root || !_dbPathContains(target, root)) return;
    const info = _dbFormatInfoFromPivotData(pivotData);
    if (!info.known) return;
    if (!best || root.length > best.root.length) best = { root, ...info };
  };
  if (typeof state !== 'undefined') consider(state.currentDbPath, state.pivotData);
  if (typeof getAllPanes === 'function') {
    try {
      const panes = getAllPanes() || {};
      Object.values(panes).forEach(ctx => consider(ctx?.dbPath, ctx?.pivotData));
    } catch {}
  }
  return best || { known: false, newFormat: _isNewFormatDb() };
}

function _dbIsNewFormat(dbPath, pivotData) {
  return _dbFormatInfoForPath(dbPath, pivotData).newFormat;
}

function _entityPath(dbPath, entityName, pivotData) {
  return _dbIsNewFormat(dbPath, pivotData) ? dbPath + '/' + entityName + '.md' : dbPath + '/' + entityName;
}

function _stampPivotValueEntityPaths(dbPath, pivotData) {
  if (!dbPath || !pivotData?.entities) return pivotData;
  Object.entries(pivotData.entities).forEach(([entityName, entityData]) => {
    const entryPath = _dbNormalizePath(_entityPath(dbPath, entityName, pivotData));
    if (!entryPath || !entityData || typeof entityData !== 'object') return;
    Object.values(entityData).forEach(values => {
      if (!Array.isArray(values)) return;
      values.forEach(value => {
        if (value && typeof value === 'object') value.entry_path = entryPath;
      });
    });
  });
  return pivotData;
}

function _resolveEntityPathFromValObj(val) {
  if (!val) return state.currentEntityPath || '';
  if (val.entry_path || val.entity_path || val.folder_path) {
    return _dbNormalizePath(val.entry_path || val.entity_path || val.folder_path);
  }
  if (!val.file) return state.currentEntityPath || '';
  const f = String(val.file).replace(/\\/g, '/');
  const parts = f.split('/');
  const leaf = parts[parts.length - 1] || '';
  if (!leaf.endsWith('.md')) return f;
  const stem = leaf.replace(/\.md$/, '');
  const format = _dbFormatInfoForValueFile(f);
  if (format.known) {
    if (!format.newFormat && stem.includes('_')) {
      parts.pop();
      return parts.join('/');
    }
    return f;
  }
  if (!_isNewFormatDb() && stem.includes('_')) {
    parts.pop();
    return parts.join('/');
  }
  return f;
}

function _dbPathFromEntityPath(entityPath) {
  const p = String(entityPath || '').replace(/\\/g, '/');
  if (!p) return '';
  const parts = p.split('/');
  if (parts.length < 2) return '';
  parts.pop();
  return parts.join('/');
}

function _dbEntityNameFromPath(entityPath) {
  const p = String(entityPath || '').replace(/\\/g, '/');
  const leaf = p.split('/').filter(Boolean).pop() || '';
  return leaf.replace(/\.md$/i, '');
}

function _dbRewriteEntityValuePaths(entityData, oldPath, newPath) {
  if (!entityData || !oldPath || !newPath || oldPath === newPath) return;
  Object.values(entityData).forEach(values => {
    if (!Array.isArray(values)) return;
    values.forEach(value => {
      if (!value) return;
      if (String(value.file || '').replace(/\\/g, '/') === oldPath) value.file = newPath;
      if (String(value.entry_path || '').replace(/\\/g, '/') === oldPath) value.entry_path = newPath;
      if (String(value.entity_path || '').replace(/\\/g, '/') === oldPath) value.entity_path = newPath;
      if (String(value.folder_path || '').replace(/\\/g, '/') === oldPath) value.folder_path = newPath;
    });
  });
}

function _dbNotifyCalendarEntryRenamed(dbPath, oldPath, newPath, oldName, newName) {
  try {
    if (!window.GbDbCalendarSync || typeof window.GbDbCalendarSync.onEntryRenamed !== 'function') return;
    Promise.resolve(window.GbDbCalendarSync.onEntryRenamed(dbPath, oldPath, newPath, oldName, newName)).catch(() => {});
  } catch {}
}

function _dbApplyEntityRenameInfo(info) {
  if (!info?.auto_generated) return;
  const oldPath = String(info.old_path || '').replace(/\\/g, '/');
  const newPath = String(info.new_path || '').replace(/\\/g, '/');
  const oldName = String(info.old_name || _dbEntityNameFromPath(oldPath) || '');
  const newName = String(info.new_name || _dbEntityNameFromPath(newPath) || '');
  if (!oldName || !newName || oldName === newName) return;
  const dbPath = _dbPathFromEntityPath(newPath || oldPath) || state.currentDbPath || '';
  const ctx = typeof _currentPaneState === 'function' ? _currentPaneState() : null;
  const targets = [];
  const addTarget = (target) => {
    if (target && !targets.includes(target)) targets.push(target);
  };
  addTarget(ctx);
  if (typeof state !== 'undefined') addTarget(state);
  targets.forEach(target => {
    const entities = target?.pivotData?.entities;
    if (!entities) return;
    if (Object.prototype.hasOwnProperty.call(entities, oldName)) {
      entities[newName] = entities[oldName] || {};
      delete entities[oldName];
    }
    if (entities[newName]) _dbRewriteEntityValuePaths(entities[newName], oldPath, newPath);
    if (Array.isArray(target._lastEntityNames)) {
      target._lastEntityNames = target._lastEntityNames.map(name => name === oldName ? newName : name);
    }
    if (target._selectedEntities?.has?.(oldName)) {
      target._selectedEntities.delete(oldName);
      target._selectedEntities.add(newName);
    }
  });
  if (typeof _dbApplyEntityRenameLocally === 'function') {
    try { _dbApplyEntityRenameLocally(ctx, dbPath, oldName, newName); } catch {}
  }
  _dbNotifyCalendarEntryRenamed(dbPath, oldPath, newPath, oldName, newName);
  try {
    document.querySelectorAll(`tr[data-entity-name="${CSS.escape(oldName)}"]`).forEach(row => {
      row.dataset.entityName = newName;
      row.querySelectorAll('.entity-name-label').forEach(label => { label.textContent = newName; });
      row.querySelectorAll('[data-entity-name]').forEach(el => { el.dataset.entityName = newName; });
    });
  } catch {}
}

function _dbApplyAutoTaskRenameResult(res) {
  _dbApplyEntityRenameInfo(res?.auto_renamed_entry);
}

function applyDbAutoEntityRenameResponse(res) {
  _dbApplyEntityRenameInfo(res?.auto_renamed_entry);
  const entries = Array.isArray(res?.renamed_entries) ? res.renamed_entries : [];
  entries.forEach(info => _dbApplyEntityRenameInfo(info));
}

function _markDbAutoVersionDirty(dbPath) {
  if (typeof markAutoVersionDirty !== 'function') return;
  try {
    if (typeof _autoVersionType === 'undefined' || typeof _autoVersionPath === 'undefined') return;
    if (_autoVersionType !== 'db') return;
    if (dbPath && typeof _sameVersionTargetPath === 'function' && !_sameVersionTargetPath(_autoVersionPath, dbPath)) return;
    markAutoVersionDirty();
  } catch {}
}

// ツールバー再読み込みがセル保存中に /pivot を読み直すと、保存前の entry_revision が
// 画面へ戻り、次の保存が「他端末で更新」と誤判定される。値保存をシート単位で追跡し、
// 再読み込み側が保存完了まで待てるようにする。
const _dbPendingValueMutations = new Map();
const _dbEntryMutationChains = new Map();
const _dbEntryRevisionCache = new Map();

function _dbTrackValueMutation(dbPath, promise) {
  const tracked = Promise.resolve(promise);
  _dbPendingValueMutations.set(tracked, _dbNormalizePath(dbPath || ''));
  tracked.finally(() => { _dbPendingValueMutations.delete(tracked); }).catch(() => {});
  return tracked;
}

async function waitForPendingDbValueMutations(dbPath) {
  const target = _dbNormalizePath(dbPath || '');
  // 1つの保存完了直後にカスケード・双方向リレーション保存が続くため、
  // 空になった直後も1タスク待ってから再確認する。
  for (let pass = 0; pass < 50; pass += 1) {
    const pending = [..._dbPendingValueMutations.entries()]
      .filter(([, path]) => !target || path === target)
      .map(([promise]) => promise);
    if (pending.length) {
      await Promise.allSettled(pending);
      continue;
    }
    await new Promise(resolve => setTimeout(resolve, 0));
    const hasMore = [..._dbPendingValueMutations.values()].some(path => !target || path === target);
    if (!hasMore) return true;
  }
  return false;
}

function _dbLatestEntryRevision(entityPath, fallbackValue) {
  const normalizedEntityPath = _dbNormalizePath(entityPath);
  const cached = Number(_dbEntryRevisionCache.get(normalizedEntityPath));
  if (Number.isInteger(cached) && cached >= 0) return cached;
  const revisions = [
    fallbackValue?.entry_revision,
    fallbackValue?.revision,
    fallbackValue?._revision,
  ];
  const dbPath = _dbPathFromEntityPath(normalizedEntityPath) || '';
  const entityName = _dbEntityNameFromPath(normalizedEntityPath);
  const considerPivot = (pivotData) => {
    const revision = Number(pivotData?.entities?.[entityName]?._revision);
    if (Number.isInteger(revision) && revision >= 0) revisions.push(revision);
  };
  if (typeof _dbPaneContextsForPath === 'function') {
    _dbPaneContextsForPath(dbPath).forEach(ctx => considerPivot(ctx?.pivotData));
  }
  if (!dbPath || _dbNormalizePath(state.currentDbPath || '') === _dbNormalizePath(dbPath)) {
    considerPivot(state.pivotData);
  }
  const known = revisions
    .map(value => Number(value))
    .filter(value => Number.isInteger(value) && value >= 0);
  return known.length ? Math.max(...known) : null;
}

function _dbQueueEntryMutation(entityPath, dbPath, mutationFactory) {
  const key = _dbNormalizePath(entityPath) || `db:${_dbNormalizePath(dbPath)}`;
  const previous = _dbEntryMutationChains.get(key);
  const queued = Promise.resolve(previous)
    .catch(() => {})
    .then(() => mutationFactory());
  const tracked = _dbTrackValueMutation(dbPath, queued);
  _dbEntryMutationChains.set(key, tracked);
  tracked.finally(() => {
    if (_dbEntryMutationChains.get(key) === tracked) _dbEntryMutationChains.delete(key);
  }).catch(() => {});
  return tracked;
}

function _dbPropagateEntryRevision(entityPath, revision) {
  const nextRevision = Number(revision);
  if (!Number.isInteger(nextRevision) || nextRevision < 0 || !entityPath) return;
  const normalizedEntityPath = _dbNormalizePath(entityPath);
  _dbEntryRevisionCache.set(normalizedEntityPath, nextRevision);
  const dbPath = _dbPathFromEntityPath(normalizedEntityPath) || '';
  const entityName = normalizedEntityPath.replace(/\.md$/i, '').split('/').pop() || '';
  if (!entityName) return;
  const pivots = [];
  const addPivot = (pivotData) => {
    if (pivotData?.entities && !pivots.includes(pivotData)) pivots.push(pivotData);
  };
  if (typeof _dbPaneContextsForPath === 'function') {
    _dbPaneContextsForPath(dbPath).forEach(ctx => addPivot(ctx?.pivotData));
  }
  if (!dbPath || _dbNormalizePath(state.currentDbPath || '') === _dbNormalizePath(dbPath)) {
    addPivot(state.pivotData);
  }
  pivots.forEach(pivotData => {
    const entityData = pivotData.entities?.[entityName];
    if (!entityData) return;
    entityData._revision = nextRevision;
    Object.values(entityData).forEach(values => {
      if (!Array.isArray(values)) return;
      values.forEach(value => {
        if (value && typeof value === 'object') value.entry_revision = nextRevision;
      });
    });
  });
}

async function _apiPutValue(valObj, updates) {
  const queuedEntityPath = _resolveEntityPathFromValObj(valObj);
  const mutationDbPath = _dbPathFromEntityPath(queuedEntityPath) || state.currentDbPath || '';
  return _dbQueueEntryMutation(queuedEntityPath, mutationDbPath, async () => {
    const body = { ...updates };
    delete body.__source;
    const requestedRevision = Number(body.baseRevision);
    const latestRevision = _dbLatestEntryRevision(queuedEntityPath, valObj);
    const usableRevisions = [requestedRevision, latestRevision]
      .filter(value => Number.isInteger(value) && value >= 0);
    if (usableRevisions.length) body.baseRevision = Math.max(...usableRevisions);
    if (valObj.candidate_index != null) {
      body.property = valObj.property;
      body.candidate_index = valObj.candidate_index;
    }
    const res = await apiPut('/value?path=' + encodeURIComponent(queuedEntityPath || valObj.file), body);
    _dbApplyAutoTaskRenameResult(res);
    if (res?.new_path) valObj.file = _dbNormalizePath(res.new_path);
    if (res?.property) valObj.property = res.property;
    if (res?.candidate_index != null) valObj.candidate_index = res.candidate_index;
    if (res?.revision != null) valObj.entry_revision = Number(res.revision);
    const entityPath = _resolveEntityPathFromValObj(valObj);
    if (res?.revision != null) _dbPropagateEntryRevision(entityPath, res.revision);
    const dbPath = _dbPathFromEntityPath(entityPath) || state.currentDbPath || '';
    const nextValue = updates._delete ? '' : (updates.new_value != null ? updates.new_value : valObj.value);
    _markDbAutoVersionDirty(dbPath);
    try {
      if (typeof clearRollupCache === 'function' && dbPath) clearRollupCache(dbPath);
    } catch {}
    try {
      if (window.GbDbCalendarSync && typeof window.GbDbCalendarSync.onValueSaved === 'function') {
        window.GbDbCalendarSync.onValueSaved({
          dbPath,
          entityPath,
          propName: valObj.property || '',
          newValue: nextValue,
          oldValue: valObj.value,
          status: updates.new_status || valObj.status,
          source: updates.__source || '',
        });
      }
    } catch {}
    try {
      const ptc = dbPath && valObj.property && typeof getPropertyTypes === 'function'
        ? getPropertyTypes(dbPath)?.[valObj.property]
        : null;
      if (ptc?.type === 'image') apiPost('/media/rebuild-refs', {}).catch(() => {});
    } catch {}
    if (updates.new_rich_html !== undefined) {
      if (updates.new_rich_html) valObj.rich_html = updates.new_rich_html;
      else delete valObj.rich_html;
    } else if (updates.new_value != null) {
      delete valObj.rich_html;
    }
    return res;
  });
}

// _apiPutValue は書き込みに使ったオブジェクト自身へ新しい entry_revision 等を書き戻す。
// セル編集UIの一部は「保存中に表示済みの値を書き換えない」ため saveRef = { ...val } のような
// コピーを作って書き込みに使うが、コピーへ返ってきたリビジョンを val 側へ反映し忘れると、
// 直後に登録される取り消し（Undo）クロージャが val の古いリビジョンで書き込みを行い、
// サーバー側のリビジョン競合チェックに409で弾かれる。コピーを使う呼び出し側は、保存成功後に
// 必ずこのヘルパーで saveRef → 取り消しクロージャが参照する側のオブジェクトへ同期すること。
function _syncValueRefAfterSave(saveRef, target) {
  if (!saveRef || !target || saveRef === target) return;
  if (saveRef.file !== undefined) target.file = saveRef.file;
  if (saveRef.entry_path !== undefined) target.entry_path = saveRef.entry_path;
  if (saveRef.entity_path !== undefined) target.entity_path = saveRef.entity_path;
  if (saveRef.folder_path !== undefined) target.folder_path = saveRef.folder_path;
  if (saveRef.property !== undefined) target.property = saveRef.property;
  if (saveRef.candidate_index !== undefined) target.candidate_index = saveRef.candidate_index;
  if (saveRef.entry_revision !== undefined) target.entry_revision = saveRef.entry_revision;
}

async function _apiPostValue(entityPath, propName, value, status, note, richHtml, extra) {
  const mutationDbPath = _dbPathFromEntityPath(entityPath) || state.currentDbPath || '';
  return _dbQueueEntryMutation(entityPath, mutationDbPath, async () => {
    const key = entityPath.endsWith('.md') ? 'entry_path' : 'folder_path';
    const body = { [key]: entityPath, property: propName, value, status, note: note || '' };
    if (richHtml) body.rich_html = richHtml;
    if (extra && typeof extra === 'object') {
      if (Array.isArray(extra.relations)) body.relations = extra.relations;
      if (Array.isArray(extra.published_in)) body.published_in = extra.published_in;
      if (extra.created) body.created = extra.created;
      const baseRevision = Number(extra.baseRevision ?? extra.base_revision ?? extra.entryRevision ?? extra.revision);
      if (Number.isInteger(baseRevision) && baseRevision >= 0) body.baseRevision = baseRevision;
    }
    const latestRevision = _dbLatestEntryRevision(entityPath);
    const requestedRevision = Number(body.baseRevision);
    const usableRevisions = [requestedRevision, latestRevision]
      .filter(revision => Number.isInteger(revision) && revision >= 0);
    if (usableRevisions.length) body.baseRevision = Math.max(...usableRevisions);
    const res = await apiPost('/value', body);
    _dbApplyAutoTaskRenameResult(res);
    const savedEntityPath = res?.new_path || entityPath;
    if (res?.revision != null) _dbPropagateEntryRevision(savedEntityPath, res.revision);
    const dbPath = _dbPathFromEntityPath(entityPath) || state.currentDbPath || '';
    _markDbAutoVersionDirty(dbPath);
    try {
      if (typeof clearRollupCache === 'function' && dbPath) clearRollupCache(dbPath);
    } catch {}
    try {
      if (window.GbDbCalendarSync && typeof window.GbDbCalendarSync.onValueSaved === 'function') {
        window.GbDbCalendarSync.onValueSaved({
          dbPath,
          entityPath,
          propName,
          newValue: value,
          oldValue: '',
          status,
        });
      }
    } catch {}
    try {
      const ptc = dbPath && propName && typeof getPropertyTypes === 'function'
        ? getPropertyTypes(dbPath)?.[propName]
        : null;
      if (ptc?.type === 'image') apiPost('/media/rebuild-refs', {}).catch(() => {});
    } catch {}
    return res;
  });
}

function _isEntityCreateNameConflict(error) {
  const raw = [
    String(error?.status || ''),
    error?.meldexCode || '',
    error?.message || '',
    error?.userMessage || '',
    JSON.stringify(error?.payload || error?.meldexDetail || {}),
  ].join('\n');
  return Number(error?.status || 0) === 409
    && /既に存在|同名|file_exists|already exists|HTTP\s+409/i.test(raw);
}

function _entityDefaultName(baseName, index) {
  const base = String(baseName || '無題').trim() || '無題';
  return index <= 1 ? base : base + index;
}

const _dbPendingEntityCreates = new Map();

function _dbPendingEntityCreateKey(dbPath, entityName) {
  return _dbNormalizePath(dbPath) + '\n' + String(entityName || '');
}

function _dbNextLocalEntityName(dbPath, existingNames, baseName) {
  const used = new Set((existingNames || []).map(name => String(name || '')).filter(Boolean));
  const dbKey = _dbNormalizePath(dbPath);
  _dbPendingEntityCreates.forEach((_value, key) => {
    const splitAt = key.indexOf('\n');
    if (splitAt < 0 || key.slice(0, splitAt) !== dbKey) return;
    const name = key.slice(splitAt + 1);
    if (name) used.add(name);
  });
  let index = 1;
  let candidate = _entityDefaultName(baseName, index);
  while (used.has(candidate)) {
    index += 1;
    candidate = _entityDefaultName(baseName, index);
  }
  return candidate;
}

function _dbRegisterPendingEntityCreate(dbPath, entityName, createPromise) {
  const key = _dbPendingEntityCreateKey(dbPath, entityName);
  const tracked = Promise.resolve(createPromise)
    .then(result => {
      const settled = Promise.resolve(result);
      _dbPendingEntityCreates.set(key, { promise: settled, result, settled: true });
      setTimeout(() => {
        const current = _dbPendingEntityCreates.get(key);
        if (current?.result === result) _dbPendingEntityCreates.delete(key);
      }, 15000);
      return result;
    })
    .catch(error => {
      _dbPendingEntityCreates.delete(key);
      throw error;
    });
  _dbPendingEntityCreates.set(key, { promise: tracked, result: null, settled: false });
  return tracked;
}

// 作成APIが未完了の楽観的エントリを /pivot 取得結果へ再マージする
// （取得時点でサーバーに存在しないエントリが、遅延再描画で一時的に消えるのを防ぐ）
function _dbMergePendingEntityCreates(dbPath, pivotData) {
  if (!pivotData || typeof pivotData !== 'object') return;
  if (!pivotData.entities || typeof pivotData.entities !== 'object') return;
  const dbKey = _dbNormalizePath(dbPath);
  _dbPendingEntityCreates.forEach((value, key) => {
    if (value?.settled) return;
    const splitAt = key.indexOf('\n');
    if (splitAt < 0 || key.slice(0, splitAt) !== dbKey) return;
    const name = key.slice(splitAt + 1);
    if (name && !(name in pivotData.entities)) pivotData.entities[name] = {};
  });
}

async function _dbResolveEntityPathForRename(dbPath, entityName) {
  const pending = _dbPendingEntityCreates.get(_dbPendingEntityCreateKey(dbPath, entityName));
  if (!pending) return _entityPath(dbPath, entityName);
  const created = await pending.promise;
  return created?.path || _entityPath(dbPath, created?.name || entityName);
}

function _shouldRunFrontendAutoFillOnCreate(response) {
  if (!response || typeof response !== 'object') return true;
  return !(response.autofill_applied === true || response.backend_autofill === true || response.new_format === true);
}

async function _apiCreateEntityWithUniqueName(dbPath, existingNames, options = {}) {
  const used = new Set((existingNames || []).map(name => String(name || '')));
  // 進行中（未完了）の作成名も衝突候補へ含める。連続クリック時に再試行同士が
  // 同じ候補名へ収束し、409 が連鎖して「同名エントリが多数」に至るのを防ぐ。
  const dbKey = _dbNormalizePath(dbPath);
  _dbPendingEntityCreates.forEach((_value, key) => {
    const splitAt = key.indexOf('\n');
    if (splitAt < 0 || key.slice(0, splitAt) !== dbKey) return;
    const name = key.slice(splitAt + 1);
    if (name) used.add(name);
  });
  const bodyExtra = options.body && typeof options.body === 'object' ? options.body : {};
  const baseName = String(options.baseName || options.name || '無題').trim() || '無題';
  let index = 1;
  let lastError = null;
  for (let attempt = 0; attempt < 50; attempt++) {
    let name = String(options.name || '').trim();
    if (!name || used.has(name) || attempt > 0) {
      do {
        name = _entityDefaultName(baseName, index);
        index += 1;
      } while (used.has(name));
    }
    used.add(name);
    try {
      const response = await apiPost(
        '/entity/create',
        { ...bodyExtra, parent_path: dbPath, name },
        // 大きなシートや Dropbox 上では作成時のシート全体スナップショット等で
        // 既定の 15 秒を超えることがある。ブラウザ側の打ち切りで実際は成功した作成が
        // 失敗扱いになり行が消えるのを防ぐため、作成には十分長い上限を与える。
        { silentError: true, timeoutMs: 120000 }
      );
      const path = (response && (response.path || response.entry_path)) || `${dbPath}/${name}.md`;
      return { response, name, path };
    } catch (error) {
      lastError = error;
      if (_isEntityCreateNameConflict(error)) continue;
      if (!options.silentError && typeof showStatus === 'function') {
        const text = window.MeldexErrorMessages?.toStatusText?.(error, { path: '/entity/create' }) || error.message || String(error);
        showStatus('エントリ作成に失敗: ' + text, true);
      }
      throw error;
    }
  }
  const error = lastError || new Error('同名エントリが多数存在するため作成できません');
  if (!options.silentError && typeof showStatus === 'function') {
    showStatus('エントリ作成に失敗: 同名エントリが多数存在します', true);
  }
  throw error;
}

let _dbSelectedColumns = { dbPath: '', props: [], anchor: '' };

function _currentPivotTable(ctx) {
  const cur = ctx || (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  const tableId = (cur && cur.tableId) || 'pivot-table';
  return (typeof _paneEl === 'function' ? _paneEl(cur, '#' + tableId) : null)
    || document.getElementById(tableId)
    || document.getElementById('pivot-table');
}

function _currentPivotRows(ctx) {
  const table = _currentPivotTable(ctx);
  return table ? Array.from(table.querySelectorAll('tbody tr:not(.new-entity-row):not(.new-entity-spacer-row):not(.db-virtual-spacer-row):not(.group-header-row)')) : [];
}

function _getSelectedColumns(dbPath) {
  return _dbSelectedColumns.dbPath === dbPath ? [..._dbSelectedColumns.props] : [];
}

function _setSelectedColumns(dbPath, props, anchor) {
  _dbSelectedColumns = {
    dbPath,
    props: [...new Set((props || []).filter(Boolean))],
    anchor: anchor || ((props || [])[0] || ''),
  };
}

function _dbFindPaneContextForPath(dbPath) {
  const target = _dbNormalizePath(dbPath);
  if (typeof getAllPanes === 'function') {
    try {
      const panes = getAllPanes() || {};
      for (const ctx of Object.values(panes)) {
        if (ctx && (!target || _dbNormalizePath(ctx.dbPath) === target)) return ctx;
      }
    } catch {}
  }
  // 制作管理の埋め込みシートは、アクティブペインを汚染しないため GBLayout の
  // ペインレジストリへ意図的に登録していない。DOM に紐付けた ctx も明示的な
  // dbPath が一致する場合だけ候補に含め、再描画後も列型情報を正しく参照する。
  if (typeof document !== 'undefined') {
    const embeds = document.querySelectorAll?.('.gb-production-sheet-embed') || [];
    for (const embed of embeds) {
      const ctx = embed?._dbPaneContext;
      if (ctx && (!target || _dbNormalizePath(ctx.dbPath) === target)) return ctx;
    }
  }
  return null;
}

// dbPath を「アクティブタブ」として表示しているパネルがGBLayout上に存在するかを
// state.currentDbPath に頼らず直接確認する（v0.7.056、パネル取り違えバグ修正）。
// 取り消し・やり直し適用直後、対象タブへの切替（GBTabs.activateTab）はDOM上の
// コンテナ付け替えを同期的に終えるが、そのタブ自身の再読み込み
// （_ensureLegacyTabContent 内の非同期 selectDatabase 呼び出し）はマイクロタスクへ
// キューされるため、state.currentDbPath の更新は1テンポ遅れる。
// _refreshDbViewConfigAfterHistory() 等が state.currentDbPath だけを見て
// 「対象タブは表示中でない」と誤判定し、再描画を黙ってスキップするのを防ぐ。
function _dbFindActiveTabPaneForPath(dbPath) {
  const target = _dbNormalizePath(dbPath);
  if (!target || typeof GBLayout === 'undefined' || !GBLayout.root || typeof GBLayout.getAllPanes !== 'function') return null;
  const sheetTabTypes = new Set(['database', 'pivot', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form']);
  const panes = GBLayout.getAllPanes(GBLayout.root) || [];
  for (const pane of panes) {
    const tab = pane.tabs?.[pane.activeTabIndex];
    if (tab && sheetTabTypes.has(tab.type) && tab.path && _dbNormalizePath(tab.path) === target) return pane.id;
  }
  return null;
}

function _dbPaneContextsForPath(dbPath) {
  const contexts = [];
  const target = _dbNormalizePath(dbPath);
  const add = (ctx) => {
    if (!ctx || contexts.includes(ctx)) return;
    if (target && _dbNormalizePath(ctx.dbPath) !== target) return;
    contexts.push(ctx);
  };
  if (typeof getAllPanes === 'function') {
    try {
      Object.values(getAllPanes() || {}).forEach(add);
    } catch {}
  }
  if (typeof document !== 'undefined') {
    try {
      document.querySelectorAll('.gb-production-sheet-embed').forEach(embed => add(embed?._dbPaneContext));
    } catch {}
  }
  if (typeof _currentPaneState === 'function') add(_currentPaneState());
  return contexts;
}

function _dbPaneContextFromEvent(eventOrElement, options = {}) {
  const fallbackDbPath = typeof state !== 'undefined' ? state.currentDbPath : '';
  const dbPath = options.dbPath || fallbackDbPath || '';
  const target = eventOrElement?.currentTarget || eventOrElement?.target || eventOrElement;
  const embeddedEl = target?.closest?.('.gb-production-sheet-embed');
  const embeddedCtx = embeddedEl?._dbPaneContext;
  if (embeddedCtx && (!dbPath || _dbNormalizePath(embeddedCtx.dbPath) === _dbNormalizePath(dbPath))) {
    return embeddedCtx;
  }
  const paneEl = target?.closest?.('.gb-pane[data-pane-id]') || target?.closest?.('.gb-pane');
  const paneId = paneEl?.dataset?.paneId || '';
  if (paneId && typeof getPaneContext === 'function') {
    const ctx = getPaneContext(paneId);
    if (ctx) return ctx;
  }
  const active = typeof _currentPaneState === 'function' ? _currentPaneState() : null;
  if (active && (!dbPath || active.dbPath === dbPath || !active.dbPath)) return active;
  return _dbFindPaneContextForPath(dbPath) || active || null;
}

function _dbCurrentViewModeForContext(ctx, dbPath) {
  const raw = dbPath && typeof getCurrentViewMode === 'function'
    ? getCurrentViewMode(dbPath, { ctx })
    : (ctx?.viewMode || (typeof state !== 'undefined' ? state.view : '') || 'pivot');
  return ['calendar', 'tasks', 'shifts'].includes(raw) ? 'timeline' : (raw || 'pivot');
}

function _renderCurrentDbView(ctx, dbPath) {
  const mode = _dbCurrentViewModeForContext(ctx, dbPath);
  if (mode === 'gallery' && typeof renderGallery === 'function') renderGallery(ctx);
  else if (mode === 'kanban' && typeof renderKanban === 'function') renderKanban(ctx);
  else if (mode === 'timeline' && typeof renderTimeline === 'function') renderTimeline(ctx);
  else if (mode === 'chart' && typeof renderChart === 'function') renderChart(ctx);
  else if (mode === 'graph' && typeof renderGraph === 'function') renderGraph(ctx);
  else if (mode === 'form' && typeof renderDbFormView === 'function') renderDbFormView(ctx);
  else if (typeof renderPivot === 'function') renderPivot(ctx);
}

function _dbRenderEmptyStateWithCreate(container, icon, message, hint, ctx, options = {}) {
  if (!container) return;
  const dbPath = options.dbPath || ctx?.dbPath || (typeof state !== 'undefined' ? state.currentDbPath : '');
  if (typeof renderEmptyState === 'function') {
    renderEmptyState(container, icon, message, hint);
  } else {
    container.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'gb-empty-state';
    const msg = document.createElement('div');
    msg.className = 'gb-empty-message';
    msg.textContent = message || '';
    empty.appendChild(msg);
    if (hint) {
      const hintEl = document.createElement('div');
      hintEl.className = 'gb-empty-hint';
      hintEl.textContent = hint;
      empty.appendChild(hintEl);
    }
    container.appendChild(empty);
  }
  if (!dbPath) return;
  const emptyHost = container.querySelector('.gb-empty-state') || container;
  if (emptyHost.querySelector('.db-empty-create-entry-btn')) return;
  const actions = document.createElement('div');
  actions.className = 'gb-empty-actions';
  actions.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:8px;margin-top:14px;';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'gb-btn primary db-empty-create-entry-btn';
  btn.dataset.e2eId = options.e2eId || 'db-empty-create-entry';
  btn.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:7px 12px;';
  btn.innerHTML = (typeof lucide === 'function' ? lucide('plus', 14) : '+') + '<span>エントリを追加</span>';
  btn.addEventListener('click', async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (btn.disabled) return;
    btn.disabled = true;
    const label = btn.querySelector('span');
    if (label) label.textContent = '作成中...';
    const renderCtx = ctx
      || (typeof _dbFindPaneContextForPath === 'function' ? _dbFindPaneContextForPath(dbPath) : null)
      || (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
    let created = null;
    try {
      if (typeof _dbCreateEntityOptimistic === 'function') {
        created = _dbCreateEntityOptimistic(renderCtx, dbPath, { baseName: options.baseName || '無題' });
        const saved = await created.promise;
        if (saved.name !== created.name && typeof _dbRenameOptimisticEntityLocally === 'function') {
          _dbRenameOptimisticEntityLocally(created.renderCtx || renderCtx, dbPath, created.name, saved.name);
        }
        if (typeof _dbScheduleEntityCreatePostSync === 'function') {
          _dbScheduleEntityCreatePostSync(dbPath, [{ name: saved.name, path: saved.path, response: saved.response }], created.renderCtx || renderCtx);
        }
      } else if (typeof apiPost === 'function') {
        await apiPost('/entity/create', { parent_path: dbPath, name: options.baseName || '無題' });
        if (typeof selectDatabase === 'function') await selectDatabase(dbPath, renderCtx, { silent: true, skipRecent: true, skipNavPush: true });
      }
      if (typeof showStatus === 'function') showStatus('エントリを追加しました');
    } catch (e) {
      // タイムアウト等でも実際は作成済みのことがあるため、撤去前に確認する
      const recovered = created && typeof _dbRecoverEntityCreateAfterError === 'function'
        ? await _dbRecoverEntityCreateAfterError(created.renderCtx || renderCtx, dbPath, created)
        : null;
      if (recovered) {
        if (typeof showStatus === 'function') showStatus('エントリを追加しました');
      } else {
        // 楽観的に追加した未保存エントリを表示から取り除く
        if (created && typeof _dbRemoveCreatedEntitiesLocally === 'function') {
          _dbRemoveCreatedEntitiesLocally(created.renderCtx || renderCtx, dbPath, [created.name]);
        }
        if (typeof showStatus === 'function') showStatus('エントリ作成に失敗: ' + (e?.message || e), true);
        if (label) label.textContent = 'エントリを追加';
        btn.disabled = false;
      }
    }
  });
  actions.appendChild(btn);
  emptyHost.appendChild(actions);
}
