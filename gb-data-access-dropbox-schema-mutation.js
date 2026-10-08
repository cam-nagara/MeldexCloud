/* Dropboxシートの列名変更を、値・メタデータ・外部参照を含む1操作として扱う。 */
(function () {
  'use strict';

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function conflict(message, code) {
    const error = new Error(message);
    error.status = 409;
    error.code = code;
    return error;
  }

  function renameOwnReferences(frontmatter, oldName, newName) {
    const next = clone(frontmatter || {}) || {};
    const propertyTypes = next.property_types && typeof next.property_types === 'object'
      ? next.property_types
      : {};
    if (Object.prototype.hasOwnProperty.call(propertyTypes, oldName)
      && !Object.prototype.hasOwnProperty.call(propertyTypes, newName)) {
      propertyTypes[newName] = propertyTypes[oldName];
      delete propertyTypes[oldName];
    }
    const rewriter = window.GbDbSchemaMutation?.renameExactRefs;
    if (typeof rewriter === 'function') {
      rewriter(propertyTypes, oldName, newName);
      ['property_layout', 'property_layout_templates', 'calendar_mapping', 'view_config',
        'actions', 'validation', 'validation_rules']
        .forEach(key => rewriter(next[key], oldName, newName));
    }
    next.property_types = propertyTypes;
    window.GbDbSchemaMutation?.renameOwnRemoteRefs?.(next, oldName, newName);
    return next;
  }

  function renameStoreValues(store, oldName, newName) {
    const next = clone(store);
    let renamed = 0;
    Object.values(next?.rows || {}).forEach(row => {
      const frontmatter = row?.frontmatter;
      const properties = frontmatter?.properties;
      if (!properties || !Object.prototype.hasOwnProperty.call(properties, oldName)) return;
      if (Object.prototype.hasOwnProperty.call(properties, newName)) {
        throw conflict('同じ名前の列が既にあります', 'PROPERTY_NAME_CONFLICT');
      }
      const nextProperties = {};
      Object.entries(properties).forEach(([name, value]) => {
        nextProperties[name === oldName ? newName : name] = value;
      });
      frontmatter.properties = nextProperties;
      frontmatter.meldex_revision = Number(frontmatter.meldex_revision || 0) + 1;
      renamed += 1;
    });
    return { before: store, next, renamed };
  }

  async function prepareMarkdownWrites(adapter, request, notePath) {
    const entries = await adapter.listDirectoryEntries(request.dbPath).catch(() => []);
    const writes = [];
    for (const entry of entries) {
      const kind = entry?.handle?.kind || entry?.kind;
      if (kind !== 'file' || !String(entry.name || '').toLowerCase().endsWith('.md')
        || entry.name === adapter.basename(notePath)) continue;
      const path = adapter.joinPath(request.dbPath, entry.name);
      const parsed = await adapter.readFrontmatter(path);
      const properties = parsed.frontmatter?.properties;
      if (!properties || !Object.prototype.hasOwnProperty.call(properties, request.oldName)) continue;
      if (Object.prototype.hasOwnProperty.call(properties, request.newName)) {
        throw conflict('同じ名前の列が既にあります', 'PROPERTY_NAME_CONFLICT');
      }
      const nextFrontmatter = { ...parsed.frontmatter, properties: {} };
      Object.entries(properties).forEach(([name, value]) => {
        nextFrontmatter.properties[name === request.oldName ? request.newName : name] = value;
      });
      nextFrontmatter.meldex_revision = Number(nextFrontmatter.meldex_revision || 0) + 1;
      writes.push({ path, before: parsed, next: nextFrontmatter });
    }
    return writes;
  }

  async function prepareDependentWrites(adapter, request) {
    const rewriter = window.GbDbSchemaMutation?.renameDependentRefs;
    if (typeof rewriter !== 'function') return [];
    const databases = await adapter.listDatabases();
    const writes = [];
    for (const database of databases) {
      const dependentDbPath = adapter.normalize(database.path);
      if (dependentDbPath === request.dbPath) continue;
      const note = await adapter.folderFrontmatter(dependentDbPath);
      if (!note.path) continue;
      const rewritten = rewriter(note.frontmatter, {
        sourceDbPath: request.dbPath,
        dependentDbPath,
        oldName: request.oldName,
        newName: request.newName,
        propertyId: request.propertyId,
      });
      if (!rewritten?.changed) continue;
      rewritten.metadata.schema_revision = Number(note.frontmatter?.schema_revision || 0) + 1;
      writes.push({ path: note.path, before: note, next: rewritten.metadata, changed: rewritten.changed });
    }
    return writes;
  }

  function validateRequest(adapter, body, current) {
    const request = {
      dbPath: adapter.normalize(body?.db_path || body?.path || ''),
      oldName: String(body?.old_name || '').trim(),
      newName: String(body?.new_name || '').trim(),
      operationId: String(body?.operation_id || ''),
    };
    if (!request.dbPath || !request.oldName || !request.newName) {
      throw new Error('db_path, old_name, new_name は必須です');
    }
    request.currentRevision = Number(current.schema_revision || 0);
    request.operations = current.schema_operations && typeof current.schema_operations === 'object'
      ? { ...current.schema_operations }
      : {};
    const propertyIds = { ...(current.property_ids || {}) };
    const propertyTypes = current.property_types && typeof current.property_types === 'object'
      ? current.property_types
      : {};
    if (Object.prototype.hasOwnProperty.call(propertyTypes, request.oldName)
      && Object.prototype.hasOwnProperty.call(propertyTypes, request.newName)) {
      throw conflict('同じ名前の列が既にあります', 'PROPERTY_NAME_CONFLICT');
    }
    request.propertyId = String(body?.property_id || propertyIds[request.oldName] || adapter.makePropertyId());
    request.propertyIds = propertyIds;
    if (body?.expected_schema_revision != null
      && Number(body.expected_schema_revision) !== request.currentRevision) {
      throw conflict('列設定が別の画面または端末で更新されています', 'SCHEMA_REVISION_CONFLICT');
    }
    if (body?.property_id && propertyIds[request.oldName]
      && body.property_id !== propertyIds[request.oldName]) {
      throw conflict('列IDが一致しません', 'PROPERTY_ID_CONFLICT');
    }
    return request;
  }

  async function preparePlan(adapter, body) {
    const sourceNote = await adapter.folderFrontmatter(
      adapter.normalize(body?.db_path || body?.path || '')
    );
    const current = sourceNote.frontmatter || {};
    const operationId = String(body?.operation_id || '');
    const currentOperations = current.schema_operations && typeof current.schema_operations === 'object'
      ? current.schema_operations
      : {};
    if (operationId && currentOperations[operationId]) {
      return { replay: { ...currentOperations[operationId] } };
    }
    const request = validateRequest(adapter, body, current);
    if (!request.propertyIds[request.oldName]
      && request.propertyIds[request.newName] === request.propertyId) {
      return {
        replay: {
          ok: true, reconciled: true, renamed: 0, property_id: request.propertyId,
          property_ids: request.propertyIds, schema_revision: request.currentRevision,
          operation_id: request.operationId,
        },
      };
    }
    const mode = await adapter.sheetStoreMode(request.dbPath);
    const storeBefore = mode.enabled ? await adapter.ensureSheetStore(request.dbPath) : null;
    const storePlan = storeBefore
      ? renameStoreValues(storeBefore, request.oldName, request.newName)
      : null;
    const markdownWrites = storePlan
      ? []
      : await prepareMarkdownWrites(adapter, request, sourceNote.path);
    const nextMetadata = renameOwnReferences(current, request.oldName, request.newName);
    request.propertyIds[request.newName] = request.propertyId;
    delete request.propertyIds[request.oldName];
    nextMetadata.property_ids = request.propertyIds;
    const renamedConfig = nextMetadata.property_types?.[request.newName];
    if (renamedConfig && typeof renamedConfig === 'object') {
      renamedConfig.property_id = request.propertyId;
    }
    nextMetadata.schema_revision = request.currentRevision + 1;
    const dependentWrites = await prepareDependentWrites(adapter, request);
    return {
      request, sourceNote, current, nextMetadata, storePlan, markdownWrites, dependentWrites,
    };
  }

  function buildResult(plan) {
    const result = {
      ok: true,
      renamed: plan.storePlan?.renamed ?? plan.markdownWrites.length,
      property_id: plan.request.propertyId,
      property_ids: plan.request.propertyIds,
      schema_revision: plan.nextMetadata.schema_revision,
      operation_id: plan.request.operationId,
      dependent_references_updated: plan.dependentWrites.reduce(
        (total, write) => total + Number(write.changed || 0),
        0
      ),
    };
    if (plan.request.operationId) {
      plan.request.operations[plan.request.operationId] = { ...result };
      while (Object.keys(plan.request.operations).length > 50) {
        delete plan.request.operations[Object.keys(plan.request.operations)[0]];
      }
      plan.nextMetadata.schema_operations = plan.request.operations;
    }
    return result;
  }

  async function rollbackPlan(adapter, plan, completedValues, completedDependents) {
    const errors = [];
    try {
      await adapter.writeFrontmatter(
        plan.sourceNote.path,
        plan.current,
        plan.sourceNote.body || ''
      );
    } catch (error) {
      errors.push('元シート設定: ' + (error?.message || error));
    }
    for (const write of completedDependents.reverse()) {
      try {
        await adapter.writeFrontmatter(write.path, write.before.frontmatter, write.before.body || '');
      } catch (error) {
        errors.push(write.path + ': ' + (error?.message || error));
      }
    }
    if (plan.storePlan) {
      try {
        await adapter.writeSheetStore(plan.request.dbPath, plan.storePlan.before);
      } catch (error) {
        errors.push('シート本体: ' + (error?.message || error));
      }
    }
    for (const write of completedValues.reverse()) {
      try {
        await adapter.writeFrontmatter(write.path, write.before.frontmatter, write.before.body || '');
      } catch (error) {
        errors.push(write.path + ': ' + (error?.message || error));
      }
    }
    return errors;
  }

  async function executePlan(adapter, plan) {
    const completedValues = [];
    const completedDependents = [];
    const result = buildResult(plan);
    try {
      if (plan.storePlan) {
        await adapter.writeSheetStore(plan.request.dbPath, plan.storePlan.next);
      }
      for (const write of plan.markdownWrites) {
        await adapter.writeFrontmatter(write.path, write.next, write.before.body || '');
        completedValues.push(write);
      }
      for (const write of plan.dependentWrites) {
        await adapter.writeFrontmatter(write.path, write.next, write.before.body || '');
        completedDependents.push(write);
      }
      await adapter.writeFrontmatter(
        plan.sourceNote.path,
        plan.nextMetadata,
        plan.sourceNote.body || ''
      );
    } catch (error) {
      const rollbackErrors = await rollbackPlan(
        adapter,
        plan,
        completedValues,
        completedDependents
      );
      if (rollbackErrors.length) {
        const rollbackError = new Error(
          '列名変更に失敗し、変更済みデータの復元にも失敗しました: '
          + rollbackErrors.join(' / ')
        );
        rollbackError.rollbackIncomplete = true;
        rollbackError.cause = error;
        throw rollbackError;
      }
      throw error;
    }
    return result;
  }

  async function renameProperty(adapter, body) {
    const plan = await preparePlan(adapter, body);
    if (plan.replay) return plan.replay;
    return executePlan(adapter, plan);
  }

  window.MeldexDropboxSchemaMutation = Object.freeze({ renameProperty });
})();
