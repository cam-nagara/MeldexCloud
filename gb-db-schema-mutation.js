/* ==============================
   シート列スキーマの安定ID・競合制御・候補移行
   ============================== */
(function () {
  'use strict';

  const queues = new Map();
  let sequence = 0;

  function normalize(path) {
    if (typeof _dbNormalizePath === 'function') return _dbNormalizePath(path || '');
    return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
  }

  function newId(prefix) {
    sequence += 1;
    const value = globalThis.crypto?.randomUUID?.()
      || `${Date.now().toString(36)}-${sequence.toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix || 'schema'}_${value.replace(/-/g, '')}`;
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function renameFormulaRefs(formula, oldName, newName) {
    if (typeof formula !== 'string' || !oldName) return formula;
    const escapedName = String(oldName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp('prop\\(\\s*(["\\\'])' + escapedName + '\\1\\s*\\)', 'g');
    return formula.replace(pattern, (_match, quote) => {
      const literal = String(newName).replace(/\\/g, '\\\\').replace(new RegExp(quote, 'g'), '\\' + quote);
      return 'prop(' + quote + literal + quote + ')';
    });
  }

  function metadataForContext(ctx, dbPath) {
    if (ctx?.dbMetadata && normalize(ctx.dbPath) === normalize(dbPath)) return ctx.dbMetadata;
    if (typeof state !== 'undefined' && normalize(state.currentDbPath) === normalize(dbPath)) {
      return state.dbMetadata || null;
    }
    return null;
  }

  function ensurePropertyIds(dbPath, metadata, propertyTypes) {
    const target = metadata || {};
    const ids = { ...(target.property_ids || {}) };
    const types = propertyTypes || target.property_types || {};
    Object.keys(types).forEach(name => {
      const config = types[name] && typeof types[name] === 'object' ? types[name] : {};
      const id = String(config.property_id || ids[name] || '').trim() || newId('prop');
      ids[name] = id;
      config.property_id = id;
      types[name] = config;
    });
    target.property_ids = ids;
    target.property_types = types;
    target.schema_revision = Number.isInteger(Number(target.schema_revision))
      ? Number(target.schema_revision)
      : 0;
    return { metadata: target, propertyTypes: types, propertyIds: ids };
  }

  function contextTargets(dbPath) {
    const result = [];
    const add = value => {
      if (value && !result.includes(value) && normalize(value.dbPath) === normalize(dbPath)) result.push(value);
    };
    if (typeof _dbPaneContextsForPath === 'function') {
      _dbPaneContextsForPath(dbPath).forEach(add);
    }
    return result;
  }

  function applyMetadataResult(dbPath, result, payload) {
    const revision = Number(result?.schema_revision);
    contextTargets(dbPath).forEach(ctx => {
      if (!ctx.dbMetadata) ctx.dbMetadata = {};
      Object.assign(ctx.dbMetadata, clone(payload || {}));
      if (result?.property_ids) ctx.dbMetadata.property_ids = clone(result.property_ids);
      if (Number.isInteger(revision)) ctx.dbMetadata.schema_revision = revision;
    });
    if (typeof state !== 'undefined' && normalize(state.currentDbPath) === normalize(dbPath)) {
      if (!state.dbMetadata) state.dbMetadata = {};
      Object.assign(state.dbMetadata, clone(payload || {}));
      if (result?.property_ids) state.dbMetadata.property_ids = clone(result.property_ids);
      if (Number.isInteger(revision)) state.dbMetadata.schema_revision = revision;
    }
    return result;
  }

  function enqueue(dbPath, factory) {
    const key = normalize(dbPath);
    const previous = queues.get(key);
    const current = Promise.resolve(previous).catch(() => {}).then(factory);
    queues.set(key, current);
    current.finally(() => {
      if (queues.get(key) === current) queues.delete(key);
    }).catch(() => {});
    return current;
  }

  function isUnknownResultError(error) {
    const message = String(error?.message || '').toLowerCase();
    return error?.name === 'AbortError'
      || message.includes('timeout')
      || message.includes('タイムアウト')
      || message.includes('network')
      || message.includes('failed to fetch');
  }

  async function putIdempotent(path, body, reconcile) {
    const request = () => apiPut(path, body, { silentError: true, timeoutMs: 120000 });
    try {
      return await request();
    } catch (firstError) {
      if (!isUnknownResultError(firstError)) throw firstError;
      try {
        return await request();
      } catch (retryError) {
        if (!isUnknownResultError(retryError)) throw retryError;
        let reconciled = null;
        try {
          reconciled = await reconcile?.();
        } catch (reconcileError) {
          console.warn('列スキーマ変更結果の照合に失敗:', reconcileError);
        }
        if (reconciled) return reconciled;
        retryError.resultUnknown = true;
        throw retryError;
      }
    }
  }

  async function saveMetadata(dbPath, payload, ctx, options = {}) {
    return enqueue(dbPath, async () => {
      let metadata = metadataForContext(ctx, dbPath);
      if (!metadata) {
        metadata = await apiFetch('/db-metadata?path=' + encodeURIComponent(dbPath));
      }
      metadata = metadata || {};
      const expected = Number(metadata.schema_revision);
      const body = {
        ...clone(payload || {}),
        expected_schema_revision: Number.isInteger(expected) ? expected : 0,
        operation_id: options.operationId || newId('schema_op'),
      };
      const result = await putIdempotent(
        '/db-metadata?path=' + encodeURIComponent(dbPath),
        body,
        async () => {
          const current = await apiFetch('/db-metadata?path=' + encodeURIComponent(dbPath));
          return current?.schema_operations?.[body.operation_id] || null;
        }
      );
      return applyMetadataResult(dbPath, result || {}, payload);
    });
  }

  function renameExactRefs(value, oldName, newName) {
    if (!value || typeof value !== 'object') return value;
    const scalarKeys = new Set([
      'pairWith', 'cascadeFrom', 'relationProp', 'myProp',
      'compareProperty', 'relationProperty', 'matchRelation',
      'property', 'prop', 'groupBy', 'entityNameProp', 'startProp', 'endProp',
      'titleProp', 'colorProp', 'descriptionProp', 'locationProp', 'urlProp',
      'calendarIdProp', 'timeProp', 'rowProp', 'xProperty', 'yProperty',
      'colorProperty', 'parentProp', 'orderProp', 'labelProp', 'typeProp',
      'collapsedProp',
    ]);
    const arrayKeys = new Set([
      'copyProps', 'colOrder', 'pinnedCols', 'hiddenCols', 'fields',
      'required', 'cardProps', 'entryPropOrder',
    ]);
    Object.entries(value).forEach(([key, child]) => {
      if (scalarKeys.has(key) && child === oldName) value[key] = newName;
      else if (arrayKeys.has(key) && Array.isArray(child)) {
        value[key] = child.map(item => item === oldName ? newName : item);
      } else if (key === 'formula' && typeof child === 'string') {
        value[key] = renameFormulaRefs(child, oldName, newName);
      } else if (key === 'sortConfig' && child && typeof child === 'object') {
        if (child.key === oldName) child.key = newName;
        renameExactRefs(child, oldName, newName);
      } else if (child && typeof child === 'object') {
        renameExactRefs(child, oldName, newName);
      }
    });
    ['colWidths', 'countTypes', 'conditionalColors', 'cellDisplayByCol',
      'columnValueFilters', 'columnLocks', 'descriptions', 'placeholders', 'labels']
      .forEach(key => {
        const map = value[key];
        if (map && Object.prototype.hasOwnProperty.call(map, oldName)) {
          map[newName] = map[oldName];
          delete map[oldName];
        }
      });
    return value;
  }

  function renameOwnRemoteRefs(metadata, oldName, newName) {
    const propertyTypes = metadata?.property_types && typeof metadata.property_types === 'object'
      ? metadata.property_types
      : {};
    Object.values(propertyTypes).forEach(config => {
      if (!config || typeof config !== 'object') return;
      if (config.relationDb === '') {
        ['bidirectionalProp', 'cascadeKey'].forEach(key => {
          if (config[key] === oldName) config[key] = newName;
        });
      }
      const relationConfig = propertyTypes[config.relationProp];
      if (relationConfig?.relationDb === '' && config.targetProp === oldName) {
        config.targetProp = newName;
      }
      (config.actions || []).forEach(action => {
        if (action?.targetProp === oldName) action.targetProp = newName;
      });
      (config.sources || []).forEach(source => {
        if (source?.db) return;
        (source.matchRules || []).forEach(rule => {
          if (rule?.remoteProp === oldName) rule.remoteProp = newName;
        });
      });
    });
    return metadata;
  }

  function sameDbReference(reference, sourceDbPath, dependentDbPath) {
    const collapse = value => normalize(value).split('/').reduce((parts, part) => {
      if (!part || part === '.') return parts;
      if (part === '..' && parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else if (part !== '..' || !parts.length) parts.push(part);
      return parts;
    }, []).join('/');
    const target = collapse(reference);
    const source = collapse(sourceDbPath);
    const dependent = collapse(dependentDbPath);
    if (!target) return dependent === source;
    if (target === source) return true;
    return collapse([dependent, target].filter(Boolean).join('/')) === source;
  }

  function renameRemoteConfigRefs(config, propertyTypes, options) {
    let changed = 0;
    if (!config || typeof config !== 'object') return changed;
    if (sameDbReference(config.relationDb, options.sourceDbPath, options.dependentDbPath)) {
      ['bidirectionalProp', 'cascadeKey', 'targetProp'].forEach(key => {
        if (config[key] !== options.oldName) return;
        config[key] = options.newName;
        config[key + 'Id'] = options.propertyId;
        changed += 1;
      });
    }
    const relationConfig = propertyTypes?.[config.relationProp];
    if (relationConfig && sameDbReference(
      relationConfig.relationDb,
      options.sourceDbPath,
      options.dependentDbPath
    ) && config.targetProp === options.oldName) {
      config.targetProp = options.newName;
      config.targetPropId = options.propertyId;
      changed += 1;
    }
    (config.sources || []).forEach(source => {
      if (!sameDbReference(source?.db, options.sourceDbPath, options.dependentDbPath)) return;
      (source.matchRules || []).forEach(rule => {
        if (rule?.remoteProp !== options.oldName) return;
        rule.remoteProp = options.newName;
        rule.remotePropId = options.propertyId;
        changed += 1;
      });
    });
    return changed;
  }

  function renameRemoteValidationRefs(value, options) {
    let changed = 0;
    if (!value || typeof value !== 'object') return changed;
    if (Array.isArray(value)) {
      value.forEach(item => { changed += renameRemoteValidationRefs(item, options); });
      return changed;
    }
    const targetDb = value.targetDb || value.relationDb;
    if (targetDb && sameDbReference(targetDb, options.sourceDbPath, options.dependentDbPath)
      && value.targetProperty === options.oldName) {
      value.targetProperty = options.newName;
      value.targetPropertyId = options.propertyId;
      changed += 1;
    }
    Object.values(value).forEach(child => {
      if (child && typeof child === 'object') {
        changed += renameRemoteValidationRefs(child, options);
      }
    });
    return changed;
  }

  function renameDependentRefs(metadata, options) {
    const next = clone(metadata || {}) || {};
    const propertyTypes = next.property_types && typeof next.property_types === 'object'
      ? next.property_types
      : {};
    let changed = 0;
    Object.values(propertyTypes).forEach(config => {
      changed += renameRemoteConfigRefs(config, propertyTypes, options);
    });
    ['view_config', 'validation', 'validation_rules'].forEach(key => {
      changed += renameRemoteValidationRefs(next[key], options);
    });
    next.property_types = propertyTypes;
    return { metadata: next, changed };
  }

  async function renameRemote(options) {
    const dbPath = normalize(options?.dbPath);
    const ctx = options?.ctx || null;
    return enqueue(dbPath, async () => {
      const metadata = clone(metadataForContext(ctx, dbPath) || {}) || {};
      const propertyTypes = clone(options?.propertyTypes || metadata.property_types || {}) || {};
      const requestedPropertyId = String(
        options?.propertyId || metadata.property_ids?.[options.oldName] || ''
      ).trim();
      if (requestedPropertyId && propertyTypes[options.newName]) {
        propertyTypes[options.newName].property_id = requestedPropertyId;
      }
      const ensured = ensurePropertyIds(dbPath, metadata, propertyTypes);
      const propertyId = String(options?.propertyId || ensured.propertyIds[options.oldName] || '').trim()
        || newId('prop');
      const operationId = options?.operationId || newId('schema_rename');
      const body = {
        db_path: dbPath,
        old_name: options.oldName,
        new_name: options.newName,
        property_id: propertyId,
        expected_schema_revision: Number(ensured.metadata.schema_revision) || 0,
        operation_id: operationId,
      };
      const result = await putIdempotent('/db-property/rename', body, async () => {
        const current = await apiFetch('/db-metadata?path=' + encodeURIComponent(dbPath));
        if (current?.property_ids?.[options.newName] !== propertyId
          || current?.property_ids?.[options.oldName]) return null;
        return {
          ok: true,
          reconciled: true,
          property_id: propertyId,
          property_ids: current.property_ids,
          schema_revision: Number(current.schema_revision) || 0,
          operation_id: operationId,
        };
      });
      if (result?.fallback) return result;
      const payload = {
        property_ids: result?.property_ids || {
          ...ensured.propertyIds,
          [options.newName]: propertyId,
        },
      };
      delete payload.property_ids[options.oldName];
      applyMetadataResult(dbPath, result || {}, payload);
      return result;
    });
  }

  function commonOptionAnchors(oldValues, newValues) {
    const rows = oldValues.length + 1;
    const cols = newValues.length + 1;
    const dp = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (let i = oldValues.length - 1; i >= 0; i -= 1) {
      for (let j = newValues.length - 1; j >= 0; j -= 1) {
        dp[i][j] = oldValues[i] === newValues[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const pairs = [];
    let i = 0;
    let j = 0;
    while (i < oldValues.length && j < newValues.length) {
      if (oldValues[i] === newValues[j]) {
        pairs.push([i, j]);
        i += 1;
        j += 1;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1;
      else j += 1;
    }
    return pairs;
  }

  function optionRenameMap(oldOptions, nextOptions) {
    const oldValues = [...new Set((oldOptions || []).map(String).filter(Boolean))];
    const newValues = [...new Set((nextOptions || []).map(String).filter(Boolean))];
    const removed = oldValues.filter(value => !newValues.includes(value));
    const added = newValues.filter(value => !oldValues.includes(value));
    const mapping = new Map();
    const anchors = [[-1, -1], ...commonOptionAnchors(oldValues, newValues), [oldValues.length, newValues.length]];
    for (let index = 1; index < anchors.length; index += 1) {
      const [oldStart, newStart] = anchors[index - 1];
      const [oldEnd, newEnd] = anchors[index];
      const oldGap = oldValues.slice(oldStart + 1, oldEnd).filter(value => removed.includes(value));
      const newGap = newValues.slice(newStart + 1, newEnd).filter(value => added.includes(value));
      if (oldGap.length && oldGap.length === newGap.length) {
        oldGap.forEach((value, gapIndex) => mapping.set(value, newGap[gapIndex]));
      }
    }
    return { oldValues, newValues, removed, mapping };
  }

  function replaceMultiValue(rawValue, mapping) {
    const split = typeof splitMultiSelectValue === 'function'
      ? splitMultiSelectValue(rawValue)
      : String(rawValue || '').split(/[,、]/).map(value => value.trim()).filter(Boolean);
    let changed = false;
    const next = split.map(value => {
      if (!mapping.has(value)) return value;
      changed = true;
      return mapping.get(value);
    });
    return { changed, value: next.join(', ') };
  }

  function collectOptionWrites(options, analysis) {
    const usedRemoved = new Set();
    const writes = [];
    Object.values(options?.pivotData?.entities || {}).forEach(entityData => {
      (entityData?.[options.propName] || []).forEach(valueRef => {
        const raw = String(valueRef?.value ?? '');
        if ((options?.type || 'select') !== 'multi-select') {
          if (analysis.mapping.has(raw)) writes.push({ ref: valueRef, oldValue: raw, newValue: analysis.mapping.get(raw) });
          else if (analysis.removed.includes(raw)) usedRemoved.add(raw);
          return;
        }
        const replaced = replaceMultiValue(raw, analysis.mapping);
        if (replaced.changed) writes.push({ ref: valueRef, oldValue: raw, newValue: replaced.value });
        const tokens = typeof splitMultiSelectValue === 'function'
          ? splitMultiSelectValue(raw)
          : raw.split(/[,、]/).map(value => value.trim());
        analysis.removed.forEach(value => {
          if (tokens.includes(value) && !analysis.mapping.has(value)) usedRemoved.add(value);
        });
      });
    });
    return { usedRemoved, writes };
  }

  async function rollbackCandidateWrites(completed, updateKey, previousKey, refKey, originalError) {
    const failures = [];
    for (const write of [...completed].reverse()) {
      try {
        await _apiPutValue(write.ref, { [updateKey]: write[previousKey] });
        write.ref[refKey] = write[previousKey];
      } catch (rollbackError) {
        failures.push(rollbackError);
      }
    }
    if (!failures.length) return;
    const rollbackError = new Error(
      `候補値の復元に失敗しました（${failures.length}件）。再読み込みして保存状態を確認してください。`
    );
    rollbackError.cause = originalError;
    rollbackError.rollbackErrors = failures;
    throw rollbackError;
  }

  async function migrateSelectOptions(options) {
    const analysis = optionRenameMap(options?.oldOptions, options?.newOptions);
    const { usedRemoved, writes } = collectOptionWrites(options, analysis);
    const completed = [];
    try {
      for (const write of writes) {
        await _apiPutValue(write.ref, { new_value: write.newValue });
        completed.push(write);
        write.ref.value = write.newValue;
      }
    } catch (error) {
      await rollbackCandidateWrites(completed, 'new_value', 'oldValue', 'value', error);
      throw error;
    }
    const finalOptions = [...analysis.newValues];
    usedRemoved.forEach(value => {
      if (!finalOptions.includes(value)) finalOptions.push(value);
    });
    let rolledBack = false;
    return {
      options: finalOptions,
      migrated: writes.length,
      preserved: [...usedRemoved],
      renamed: Object.fromEntries(analysis.mapping),
      rollback: async () => {
        if (rolledBack) return;
        rolledBack = true;
        for (const write of [...completed].reverse()) {
          await _apiPutValue(write.ref, { new_value: write.oldValue });
          write.ref.value = write.oldValue;
        }
      },
    };
  }

  async function migrateStatuses(options) {
    const mapping = options?.mapping instanceof Map
      ? options.mapping
      : new Map(Object.entries(options?.mapping || {}));
    const removed = new Set(options?.removed || []);
    const usedRemoved = new Set();
    const writes = [];
    Object.values(options?.pivotData?.entities || {}).forEach(entityData => {
      Object.values(entityData || {}).forEach(values => {
        if (!Array.isArray(values)) return;
        values.forEach(valueRef => {
          const status = String(valueRef?.status || '採用');
          if (mapping.has(status)) writes.push({ ref: valueRef, oldStatus: status, newStatus: mapping.get(status) });
          else if (removed.has(status)) usedRemoved.add(status);
        });
      });
    });
    const completed = [];
    try {
      for (const write of writes) {
        await _apiPutValue(write.ref, { new_status: write.newStatus });
        completed.push(write);
        write.ref.status = write.newStatus;
      }
    } catch (error) {
      await rollbackCandidateWrites(completed, 'new_status', 'oldStatus', 'status', error);
      throw error;
    }
    let rolledBack = false;
    return {
      migrated: writes.length,
      preserved: [...usedRemoved],
      rollback: async () => {
        if (rolledBack) return;
        rolledBack = true;
        for (const write of [...completed].reverse()) {
          await _apiPutValue(write.ref, { new_status: write.oldStatus });
          write.ref.status = write.oldStatus;
        }
      },
    };
  }

  function resolveName(metadata, fallbackName, propertyId) {
    const id = String(propertyId || '').trim();
    if (!id) return fallbackName;
    const ids = metadata?.property_ids || {};
    return Object.keys(ids).find(name => ids[name] === id) || fallbackName;
  }

  window.GbDbSchemaMutation = {
    ensurePropertyIds,
    migrateSelectOptions,
    migrateStatuses,
    newId,
    renameDependentRefs,
    renameExactRefs,
    renameOwnRemoteRefs,
    renameRemote,
    resolveName,
    saveMetadata,
  };
})();
