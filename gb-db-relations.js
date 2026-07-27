/* 双方向リレーション同期 */

const _dbMetadataCache = {};

function _cloneJsonSafe(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function _invalidateDbMetadataCache(dbPath) {
  if (!dbPath) return;
  delete _dbMetadataCache[dbPath];
}

async function _getDbMetadataCached(dbPath, force) {
  if (!dbPath) return { property_types: {} };
  const cached = _dbMetadataCache[dbPath];
  if (!force && cached) {
    const fresh = typeof _dbCacheIsFresh === 'function'
      ? _dbCacheIsFresh(cached, 'metadata')
      : Date.now() - (cached.timestamp || 0) < 30000;
    if (fresh) return _cloneJsonSafe(cached.data || cached);
  }
  let meta = { property_types: {} };
  try {
    meta = await apiFetch('/db-metadata?path=' + encodeURIComponent(dbPath));
  } catch (err) {
    throw new Error('DBメタデータ取得に失敗しました: ' + dbPath);
  }
  if (!meta || typeof meta !== 'object') meta = { property_types: {} };
  if (!meta.property_types) meta.property_types = {};
  _dbMetadataCache[dbPath] = typeof _dbCacheWrap === 'function'
    ? _dbCacheWrap(meta)
    : { data: _cloneJsonSafe(meta), timestamp: Date.now() };
  return _cloneJsonSafe(meta);
}

async function _saveDbPropertyTypesForPath(dbPath, propertyTypes) {
  if (!dbPath) return;
  const nextTypes = _cloneJsonSafe(propertyTypes || {});
  await apiPut('/db-metadata?path=' + encodeURIComponent(dbPath), {
    property_types: nextTypes,
  });
  const cachedEntry = _dbMetadataCache[dbPath] || {};
  const cached = cachedEntry.data || cachedEntry;
  const nextCached = { ...cached, property_types: nextTypes };
  _dbMetadataCache[dbPath] = typeof _dbCacheWrap === 'function'
    ? _dbCacheWrap(nextCached)
    : { data: _cloneJsonSafe(nextCached), timestamp: Date.now() };
  const cfg = getDbViewConfig(dbPath);
  cfg.propertyTypes = nextTypes;
  saveDbViewConfig(dbPath, cfg);
  if (dbPath === state.currentDbPath && state.dbMetadata) {
    state.dbMetadata.property_types = _cloneJsonSafe(nextTypes);
  }
}

async function _setDbPropertyTypeForPath(dbPath, propName, typeConfig) {
  if (!dbPath || !propName) return;
  const meta = await _getDbMetadataCached(dbPath, true);
  const nextTypes = { ...(meta.property_types || {}) };
  nextTypes[propName] = _cloneJsonSafe(typeConfig);
  await _saveDbPropertyTypesForPath(dbPath, nextTypes);
}

function _getBidirectionalRelationConfig(sourceDbPath, propName, ptc) {
  if (!ptc || !ptc.bidirectional) return null;
  const remoteDbPath = (ptc.relationDb === '' ? sourceDbPath : ptc.relationDb) || '';
  const remotePropName = (ptc.bidirectionalProp || propName || '').trim();
  if (!remoteDbPath || !remotePropName) return null;
  return { remoteDbPath, remotePropName };
}

function _sameBidirectionalConfig(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.remoteDbPath === b.remoteDbPath && a.remotePropName === b.remotePropName;
}

function _warnBidirectionalDisableSkipped(message) {
  const text = '双方向リレーション解除を一部スキップ: ' + message;
  if (typeof showStatus === 'function') showStatus(text, true);
  else console.warn(text);
}

async function _disableBidirectionalRelationConfig(sourceDbPath, propName, prevConfig, nextConfig) {
  const prev = _getBidirectionalRelationConfig(sourceDbPath, propName, prevConfig);
  const next = _getBidirectionalRelationConfig(sourceDbPath, propName, nextConfig);
  if (!prev || _sameBidirectionalConfig(prev, next)) return;
  const meta = await _getDbMetadataCached(prev.remoteDbPath, true);
  const nextTypes = { ...(meta.property_types || {}) };
  const remoteCfg = nextTypes[prev.remotePropName];
  const expectedRelationDb = prev.remoteDbPath === sourceDbPath ? '' : sourceDbPath;
  if (!remoteCfg) {
    _warnBidirectionalDisableSkipped('参照先の列が見つかりません: ' + prev.remotePropName);
    return;
  }
  if ((remoteCfg.bidirectionalProp || '') !== propName) {
    _warnBidirectionalDisableSkipped('参照先の列の対応元が一致しません: ' + prev.remotePropName);
    return;
  }
  if ((remoteCfg.relationDb || '') !== expectedRelationDb) {
    _warnBidirectionalDisableSkipped('参照先の列の参照先シートが一致しません: ' + prev.remotePropName);
    return;
  }
  const updated = { ...remoteCfg };
  delete updated.bidirectional;
  delete updated.bidirectionalProp;
  nextTypes[prev.remotePropName] = updated;
  await _saveDbPropertyTypesForPath(prev.remoteDbPath, nextTypes);
}

async function _ensureBidirectionalRelationConfig(sourceDbPath, propName, config) {
  const resolved = _getBidirectionalRelationConfig(sourceDbPath, propName, {
    ...config,
    bidirectionalProp: (config.bidirectionalProp || propName || '').trim(),
  });
  if (!resolved) return config;
  if (resolved.remoteDbPath === sourceDbPath && resolved.remotePropName === propName) {
    throw new Error('同一シートで双方向リレーションを使う場合は、参照先側に別名の対応列を指定してください');
  }
  const meta = await _getDbMetadataCached(resolved.remoteDbPath, true);
  const nextTypes = { ...(meta.property_types || {}) };
  const existing = nextTypes[resolved.remotePropName];
  const expectedRelationDb = resolved.remoteDbPath === sourceDbPath ? '' : sourceDbPath;
  if (existing && existing.type && existing.type !== 'relation' && existing.type !== 'multi-relation') {
    throw new Error('参照先シート側の対応列がリレーション型ではありません: ' + resolved.remotePropName);
  }
  if (existing && existing.bidirectional && (existing.bidirectionalProp || '') !== propName) {
    throw new Error('参照先シート側の対応列が別の双方向リレーションに使われています: ' + resolved.remotePropName);
  }
  if (existing && (existing.relationDb || '') !== expectedRelationDb) {
    throw new Error('参照先シート側の対応列が別の参照先シートを向いています: ' + resolved.remotePropName);
  }
  const remoteConfig = {
    ...(existing || {}),
    type: existing?.type || 'multi-relation',
    relationDb: expectedRelationDb,
    bidirectional: true,
    bidirectionalProp: propName,
  };
  if (JSON.stringify(existing || {}) !== JSON.stringify(remoteConfig)) {
    nextTypes[resolved.remotePropName] = remoteConfig;
    await _saveDbPropertyTypesForPath(resolved.remoteDbPath, nextTypes);
  }
  return {
    ...config,
    bidirectional: true,
    bidirectionalProp: resolved.remotePropName,
  };
}

function _splitRelationIdsForSync(value) {
  return String(value || '').split(',').map(s => s.trim()).filter(Boolean);
}

async function _getRelationEntityId(dbPath, entityPath) {
  if (!dbPath || !entityPath) return '';
  const entityName = typeof _getPivotEntityName === 'function'
    ? _getPivotEntityName(entityPath)
    : (entityPath.split('/').pop() || '').replace(/\.md$/, '');
  const map = await _getRelationMap(dbPath);
  return map.nameToId[entityName] || entityName;
}

function _relationEntityPathFromMap(dbPath, entityName, map) {
  if (!dbPath || !entityName) return '';
  return map?.new_format ? dbPath + '/' + entityName + '.md' : dbPath + '/' + entityName;
}

function _bidirectionalValueSnapshot(val) {
  if (!val) return { existed: false };
  return {
    existed: true,
    file: val.file || '',
    entry_path: val.entry_path || '',
    property: val.property || '',
    candidate_index: val.candidate_index,
    value: val.value || '',
    status: val.status || '採用',
    note: val.note || '',
    rich_html: val.rich_html || '',
  };
}

function _bidirectionalValueObjFromSnapshot(snapshot, propName, entityPath) {
  return {
    file: snapshot.file,
    entry_path: snapshot.entry_path || entityPath,
    property: snapshot.property || propName,
    candidate_index: snapshot.candidate_index,
    value: snapshot.value,
    status: snapshot.status,
    note: snapshot.note,
    rich_html: snapshot.rich_html,
  };
}

async function _restoreBidirectionalValueSnapshot(entityPath, propName, snapshot, changeKind, createdResult) {
  if (snapshot?.existed) {
    if (changeKind === 'deleted' || !snapshot.file) {
      await _apiPostValue(entityPath, propName, snapshot.value, snapshot.status || '採用', snapshot.note || '', snapshot.rich_html || '');
      return;
    }
    await _apiPutValue(_bidirectionalValueObjFromSnapshot(snapshot, propName, entityPath), {
      new_value: snapshot.value,
      new_status: snapshot.status || '採用',
      new_note: snapshot.note || '',
      new_rich_html: snapshot.rich_html || '',
    });
    return;
  }
  if (changeKind === 'created' && createdResult) {
    await _apiPutValue({
      file: createdResult.path || createdResult.file || entityPath,
      entry_path: entityPath,
      property: createdResult.property || propName,
      candidate_index: createdResult.candidate_index,
    }, { _delete: true });
  }
}

async function _syncBidirectionalRemoteValue(remoteDbPath, targetId, remotePropName, sourceId, adding) {
  const map = await _getRelationMap(remoteDbPath);
  const targetName = map.idToName[targetId] || (map.entities?.[targetId] ? targetId : '');
  const entData = map.entities?.[targetName];
  if (!targetName || !entData) {
    if (!adding) return null;
    throw new Error('参照先エントリが見つかりません: ' + targetId);
  }
  const meta = await _getDbMetadataCached(remoteDbPath, true);
  const remotePtc = meta.property_types?.[remotePropName] || {};
  const isSingle = remotePtc.type === 'relation';
  const targetPath = _relationEntityPathFromMap(remoteDbPath, targetName, map);
  const vals = entData[remotePropName] || [];
  // 採用/掲載済み値のみを編集対象にする。以前は vals[0] をそのまま書き換えていたため、
  // 先頭が案/ボツ候補だった場合にその値を破壊していた。
  const adoptedVals = vals.filter(v => {
    const status = v?.status || '採用';
    return status === '採用' || status === '掲載済み';
  });
  const currentVal = adoptedVals[0];
  const currentIds = _splitRelationIdsForSync(currentVal?.value || '');
  if (adding && isSingle) {
    const conflictingIds = currentIds.filter(id => id && id !== sourceId);
    if (conflictingIds.length) {
      throw new Error('参照先エントリは既に別エントリに紐づいています: ' + targetName);
    }
  }
  let nextIds = currentIds.slice();
  if (adding) {
    if (isSingle) nextIds = [sourceId];
    else if (!nextIds.includes(sourceId)) nextIds.push(sourceId);
  } else {
    nextIds = nextIds.filter(id => id !== sourceId);
  }
  if (currentVal && nextIds.join(', ') === currentIds.join(', ')) return null;
  if (!currentVal && !adding) return null;
  const snapshot = _bidirectionalValueSnapshot(currentVal);
  let changeKind = 'none';
  let createdResult = null;
  if (currentVal) {
    if (nextIds.length === 0) {
      changeKind = 'deleted';
      await _apiPutValue(currentVal, { _delete: true });
    } else {
      changeKind = 'updated';
      await _apiPutValue(currentVal, { new_value: nextIds.join(', ') });
    }
  } else if (adding) {
    changeKind = 'created';
    createdResult = await _apiPostValue(targetPath, remotePropName, sourceId, '採用', '');
  }
  _relationCache[remoteDbPath] = null;
  return {
    undo: () => _restoreBidirectionalValueSnapshot(targetPath, remotePropName, snapshot, changeKind, createdResult),
  };
}

async function _applyBidirectionalRelationSync({ sourceDbPath, entityPath, propName, ptc, oldValue, newValue }) {
  const cfg = _getBidirectionalRelationConfig(sourceDbPath, propName, ptc);
  if (!cfg || oldValue === newValue) return null;
  const sourceId = await _getRelationEntityId(sourceDbPath, entityPath);
  if (!sourceId) return null;
  const oldIds = _splitRelationIdsForSync(oldValue);
  const newIds = _splitRelationIdsForSync(newValue);
  const removed = oldIds.filter(id => !newIds.includes(id));
  const added = newIds.filter(id => !oldIds.includes(id));
  const rollbackOps = [];
  try {
    for (const targetId of removed) {
      const op = await _syncBidirectionalRemoteValue(cfg.remoteDbPath, targetId, cfg.remotePropName, sourceId, false);
      if (op?.undo) rollbackOps.push(op.undo);
    }
    for (const targetId of added) {
      const op = await _syncBidirectionalRemoteValue(cfg.remoteDbPath, targetId, cfg.remotePropName, sourceId, true);
      if (op?.undo) rollbackOps.push(op.undo);
    }
  } catch (err) {
    for (let i = rollbackOps.length - 1; i >= 0; i -= 1) {
      try {
        await rollbackOps[i]();
      } catch (rollbackErr) {
        console.warn('[db-relations] rollback failed:', rollbackErr);
      }
    }
    throw err;
  }
  return {
    ...cfg,
    sourceId,
    undo: async () => {
      for (let i = rollbackOps.length - 1; i >= 0; i -= 1) {
        await rollbackOps[i]();
      }
    },
  };
}
