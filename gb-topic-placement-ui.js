(function initMeldexTopicPlacementUi(global) {
  'use strict';

  const MIME = 'application/x-meldex-topic-transfer-id';
  const viewsByPath = new Map();
  const failedRefreshes = new Map();
  const placementChannel = typeof BroadcastChannel === 'function'
    ? new BroadcastChannel('meldex-topic-placement-v1') : null;

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function normalizePath(value) {
    return String(value || '').trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '');
  }

  function topicKey(value) {
    return JSON.stringify([String(value?.sourceId || ''), String(value?.topicId || '')]);
  }

  function mutationId(prefix) {
    return `${prefix || 'topic-placement'}:${global.crypto?.randomUUID?.() || Date.now().toString(36)}`;
  }

  function checkpointId(value) {
    return String(value?.checkpointId || value?.revision || value || '');
  }

  function rememberView(detail) {
    const path = normalizePath(detail?.dbPath || detail?.legacyPath);
    if (!path || !detail?.viewDocument) return;
    const previous = viewsByPath.get(path);
    const legacyRefsByName = new Map(previous?.legacyRefsByName || []);
    (detail.topicRecords || []).forEach((record) => {
      const legacyName = String(record?.legacyPath || '').replace(/\\/g, '/').split('/').pop();
      const ref = record?.topicRef || (record?.topicId && detail.sourceId
        ? { sourceId: detail.sourceId, topicId: record.topicId } : null);
      if (legacyName && ref?.sourceId && ref?.topicId
        && (!record.originDocumentId || record.originDocumentId === detail.viewDocument.documentId)) {
        legacyRefsByName.set(legacyName.replace(/\.[^.]+$/, ''), clone(ref));
      }
    });
    viewsByPath.set(path, {
      sourceId: String(detail.sourceId || ''),
      path,
      archiveRelativePath: String(detail.archiveRelativePath || ''),
      document: clone(detail.viewDocument),
      checkpoint: clone(detail.checkpoint || {}),
      records: clone(detail.topicRecords || []),
      legacyRefsByName,
      readOnly: detail.readOnly === true,
      updatedAt: Date.now(),
    });
  }

  function recordKey(record, fallbackSourceId) {
    return topicKey(record?.topicRef || {
      sourceId: fallbackSourceId, topicId: record?.topicId,
    });
  }

  function sheetColumns(document, placements) {
    const views = Array.isArray(document?.sheetViews) ? document.sheetViews : [];
    const preferredIds = new Set((placements || []).map(item => String(item.viewId || '')));
    const view = views.find(item => preferredIds.has(String(item.viewId || item.sheetViewId || '')))
      || views.find(item => String(item.viewId || item.sheetViewId || '')
        === String(document?.activeSheetViewId || document?.activeView || ''))
      || views[0];
    return Array.isArray(view?.columns) ? view.columns : [];
  }

  function propertyForColumn(record, placement, column) {
    const values = record?.propertyValuesByFamilyId || {};
    const targetFamilyId = String(column?.propertyFamilyId || '');
    if (targetFamilyId && Object.prototype.hasOwnProperty.call(values, targetFamilyId)) {
      return values[targetFamilyId]?.value;
    }
    const sourceFamilyId = String(column?.sourcePropertyFamilyId || '');
    if (sourceFamilyId && Object.prototype.hasOwnProperty.call(values, sourceFamilyId)) {
      return values[sourceFamilyId]?.value;
    }
    const binding = (placement?.columnBindings || []).find(item =>
      String(item?.targetPropertyFamilyId || '') === targetFamilyId);
    if (binding && Object.prototype.hasOwnProperty.call(values, binding.sourcePropertyFamilyId)) {
      return values[binding.sourcePropertyFamilyId]?.value;
    }
    // propertyValuesByFamilyId が存在するTopicRecordではfamily/bindingだけを正本にする。
    // 同名列fallbackは旧record（typed map自体が無い）を読む互換経路に限定する。
    if (record && Object.prototype.hasOwnProperty.call(record, 'propertyValuesByFamilyId')) {
      return undefined;
    }
    const name = String(column?.name || column?.columnId || '');
    return Object.prototype.hasOwnProperty.call(record?.properties || {}, name)
      ? record.properties[name] : undefined;
  }

  function effectivePropertyFamilyId(record, placement, column) {
    const values = record?.propertyValuesByFamilyId || {};
    const targetFamilyId = String(column?.propertyFamilyId || '');
    if (targetFamilyId && Object.prototype.hasOwnProperty.call(values, targetFamilyId)) {
      return targetFamilyId;
    }
    const sourceFamilyId = String(column?.sourcePropertyFamilyId || '');
    if (sourceFamilyId && Object.prototype.hasOwnProperty.call(values, sourceFamilyId)) {
      return sourceFamilyId;
    }
    const binding = (placement?.columnBindings || []).find(item =>
      String(item?.targetPropertyFamilyId || '') === targetFamilyId
      && Object.prototype.hasOwnProperty.call(values, item?.sourcePropertyFamilyId));
    return String(binding?.sourcePropertyFamilyId || targetFamilyId || '');
  }

  function uniqueEntityName(base, topicRef, entities) {
    const title = String(base || '無題').trim() || '無題';
    if (!Object.prototype.hasOwnProperty.call(entities, title)) return title;
    if (topicKey(entities[title]?.topicRef) === topicKey(topicRef)) return title;
    const suffix = String(topicRef?.topicId || '').slice(0, 6) || 'topic';
    let candidate = `${title} · ${suffix}`;
    let number = 2;
    while (Object.prototype.hasOwnProperty.call(entities, candidate)
      && topicKey(entities[candidate]?.topicRef) !== topicKey(topicRef)) {
      candidate = `${title} · ${suffix}-${number++}`;
    }
    return candidate;
  }

  function projectSheetPivot(dbPath, pivotData, preferredViewId) {
    const view = viewsByPath.get(normalizePath(dbPath));
    if (!view || !pivotData?.entities) return pivotData;
    const previousProjection = pivotData._topicPlacementProjection || {};
    const baseProperties = Array.isArray(previousProjection.baseProperties)
      ? previousProjection.baseProperties
      : [...(pivotData.properties || [])];
    Object.keys(pivotData.entities).forEach((name) => {
      if (pivotData.entities[name]?._topicCanonicalOnly === true) delete pivotData.entities[name];
    });
    const requestedViewId = String(preferredViewId || view.document?.activeSheetViewId
      || view.document?.activeView || '');
    const placements = (view.document?.placements || []).filter(item => item?.surface === 'sheet'
      && (!requestedViewId || String(item.viewId || '') === requestedViewId));
    const placementKeys = new Set(placements.map(item => topicKey(item.topicRef)));
    for (const [name, ref] of view.legacyRefsByName || []) {
      if (!placementKeys.has(topicKey(ref))) delete pivotData.entities[name];
    }
    const records = new Map((view.records || []).map(record => [recordKey(record, view.sourceId), record]));
    const columns = columnsForDocument(view.document, requestedViewId);
    const propertyNames = columns.map(column => String(column?.name || column?.columnId || '')).filter(Boolean);
    pivotData.properties = [...new Set([...baseProperties, ...propertyNames])];
    placements.forEach((placement) => {
      const ref = placement.topicRef;
      const record = records.get(topicKey(ref));
      if (!record) return;
      const legacyName = [...(view.legacyRefsByName || [])].find(([, knownRef]) =>
        topicKey(knownRef) === topicKey(ref))?.[0];
      const name = legacyName || uniqueEntityName(record.title || ref.topicId, ref, pivotData.entities);
      const entity = { topicRef: clone(ref), _topicPlacementId: placement.placementId,
        _topicViewId: placement.viewId,
        _topicCanonicalOnly: !legacyName, _topicDbPath: normalizePath(dbPath),
        _topicReadOnly: view.readOnly === true };
      columns.forEach((column) => {
        const columnName = String(column?.name || column?.columnId || '');
        const value = propertyForColumn(record, placement, column);
        if (!columnName) return;
        entity[columnName] = [{
          value: value === undefined ? '' : clone(value), status: '採用', note: '',
          topicRef: clone(ref), _topicCanonicalOnly: !legacyName,
          _topicDbPath: normalizePath(dbPath),
          _topicReadOnly: view.readOnly === true,
          _topicPropertyFamilyId: effectivePropertyFamilyId(record, placement, column),
          _topicColumnId: column.columnId || column.id || columnName,
          _topicColumnName: columnName,
          _topicColumnType: column.columnType || column.type || 'text',
        }];
      });
      pivotData.entities[name] = entity;
    });
    pivotData._topicPlacementProjection = {
      documentId: view.document.documentId, viewId: requestedViewId,
      baseProperties, propertyNames, updatedAt: view.updatedAt,
    };
    return pivotData;
  }

  function rerenderProjectedSheets(path) {
    const contexts = Object.values(global.getAllPanes?.() || {});
    const current = global._currentPaneState?.();
    if (current && !contexts.includes(current)) contexts.push(current);
    contexts.forEach((ctx) => {
      if (!ctx?.pivotData || normalizePath(ctx.dbPath) !== normalizePath(path)) return;
      projectSheetPivot(path, ctx.pivotData, ctx.currentViewId);
      const mode = ctx.viewMode || 'pivot';
      if (mode === 'gallery') global.renderGallery?.(ctx);
      else if (mode === 'kanban') global.renderKanban?.(ctx);
      else if (mode === 'gantt') global.renderGantt?.(ctx);
      else if (['timeline', 'calendar', 'tasks', 'shifts'].includes(mode)) global.renderTimeline?.(ctx);
      else if (mode === 'chart') global.renderChart?.(ctx);
      else if (mode === 'graph') global.renderGraph?.(ctx);
      else global.renderPivot?.(ctx);
    });
  }

  global.addEventListener?.('meldex:topic-records-updated', (event) => {
    rememberView(event.detail);
    rerenderProjectedSheets(event.detail?.dbPath || event.detail?.legacyPath);
  });

  function recordRef(view, entityName, entityData) {
    if (entityData?.topicRef?.sourceId && entityData?.topicRef?.topicId) return clone(entityData.topicRef);
    const name = String(entityName || '');
    const record = (view?.records || []).find(item => {
      const legacy = String(item?.legacyPath || '').replace(/\\/g, '/').split('/').pop() || '';
      const stem = legacy.replace(/\.[^.]+$/, '');
      return legacy === name || stem === name;
    });
    return record?.topicId ? { sourceId: view.sourceId, topicId: String(record.topicId) } : null;
  }

  function findPlacement(document, topicRef, preferredViewId, preferredPlacementId) {
    const key = topicKey(topicRef);
    const placements = Array.isArray(document?.placements) ? document.placements : [];
    if (preferredPlacementId) {
      return clone(placements.find(item => String(item?.placementId || '')
        === String(preferredPlacementId) && topicKey(item?.topicRef) === key) || null);
    }
    if (preferredViewId) {
      return clone(placements.find(item => topicKey(item?.topicRef) === key
        && String(item.viewId || '') === String(preferredViewId)) || null);
    }
    return clone(placements.find(item => topicKey(item?.topicRef) === key) || null);
  }

  function sheetSource(dbPath, entityName, entityData, preferredViewId) {
    const view = viewsByPath.get(normalizePath(dbPath));
    if (!view) return null;
    const topicRef = recordRef(view, entityName, entityData);
    if (!topicRef) return null;
    const placement = findPlacement(
      view.document, topicRef, entityData?._topicViewId || preferredViewId,
      entityData?._topicPlacementId,
    );
    if (!placement) return null;
    const record = (view.records || []).find(item => String(item?.topicId || '') === topicRef.topicId) || null;
    return {
      topicRef, placement, record: clone(record), path: normalizePath(dbPath),
      document: clone(view.document), revision: checkpointId(view.checkpoint),
      label: String(entityName || record?.title || 'トピック'), surface: 'sheet',
      readOnly: view.readOnly === true,
    };
  }

  function treeSource(nodeData) {
    if (nodeData?.type !== 'entity') return null;
    const dbPath = normalizePath(nodeData._dbPath
      || String(nodeData.path || '').replace(/[\\/][^\\/]+$/, ''));
    return sheetSource(dbPath, nodeData.name, nodeData.entityData);
  }

  function liveBoardState() {
    try { return typeof bd !== 'undefined' ? bd : global.bd; } catch (_) { return global.bd; }
  }

  function boardContextForElement(element) {
    const pane = element?.closest?.('.gb-pane');
    const paneId = pane?.dataset?.paneId || '';
    const tab = paneId ? global.GBTabs?.getActiveTab?.(paneId) : null;
    const component = tab?.id && typeof global.getComponentInstance === 'function'
      ? global.getComponentInstance(tab.id) : null;
    const live = liveBoardState();
    const tabPath = normalizePath(tab?.state?.boardPath || tab?.path || component?.state?.boardPath);
    const activeState = component?._active && normalizePath(live?.path || live?.boardPath) === tabPath
      ? live : null;
    const boardState = activeState || component?._bdDump?.bd
      || (normalizePath(live?.path || live?.boardPath) === tabPath ? live : null);
    const canvas = component?.el?.querySelector?.('[data-bd-role="canvas"]')
      || pane?.querySelector?.('[data-bd-role="canvas"]') || null;
    return { pane, paneId, tab, component, boardState, canvas, path: tabPath };
  }

  function boardSource(node, boardState, boardPath) {
    const state = boardState || liveBoardState();
    const path = normalizePath(boardPath || state?.path || state?.boardPath || '');
    const view = viewsByPath.get(path);
    const document = view?.document || state?.topicViewDocument;
    const topicRef = node?.topicRef;
    if (!document || !topicRef?.sourceId || !topicRef?.topicId) return null;
    const preferredViewId = state?.activeBoardViewId || document.activeBoardViewId;
    const placement = findPlacement(document, topicRef, preferredViewId);
    if (!placement) return null;
    return {
      topicRef: clone(topicRef), placement, record: (view?.records || []).find(
        item => String(item?.topicId || '') === String(topicRef.topicId)
      ) || null,
      path, document: clone(document), revision: checkpointId(view?.checkpoint),
      label: String(node?.text || '').split('\n')[0] || 'トピック', surface: 'board',
      readOnly: view?.readOnly === true,
    };
  }

  async function fetchView(documentId) {
    if (typeof global.apiFetch !== 'function') throw new Error('トピック配置APIへ接続できません');
    return global.apiFetch(`/topic-views/${encodeURIComponent(documentId)}`, { silentError: true });
  }

  async function registeredTarget(selection, preferredViewId) {
    const resourceType = selection?.type === 'board' ? 'board' : 'sheet';
    const path = normalizePath(selection?.path || selection?.legacyPath);
    const cached = viewsByPath.get(path);
    if (cached?.document && global.MeldexTopicViewPicker?.blockFromDocument) {
      const snapshot = await fetchView(cached.document.documentId);
      if (snapshot?.readOnly) throw new Error('選択した移動先は読み取り専用です');
      const block = await global.MeldexTopicViewPicker.blockFromDocument(
        snapshot.viewDocument, resourceType,
        { ...selection, sourceId: cached.sourceId, path },
        cached.archiveRelativePath, preferredViewId,
      );
      return {
        sourceId: cached.sourceId, documentId: block.documentId, viewId: block.viewId,
        surface: resourceType, revision: checkpointId(snapshot.checkpoint),
        document: snapshot.viewDocument, path, label: selection.name || block.fallback?.title || '移動先',
      };
    }
    const block = await global.MeldexTopicViewPicker?.resolveSelection?.(selection, resourceType);
    if (!block?.documentId || !block?.viewId) throw new Error('移動先のトピックビューを準備できません');
    const snapshot = await fetchView(block.documentId);
    if (snapshot?.readOnly) throw new Error('選択した移動先は読み取り専用です');
    return {
      sourceId: block.sourceId,
      documentId: block.documentId,
      viewId: block.viewId,
      surface: resourceType,
      revision: checkpointId(snapshot.checkpoint),
      document: snapshot.viewDocument,
      path: block.legacyPath || selection.path || '',
      label: selection.name || block.fallback?.title || '移動先',
    };
  }

  async function pickTarget() {
    if (!global.GBFolderPicker?.pickFolder) throw new Error('移動先選択を開けません');
    const selection = await global.GBFolderPicker.pickFolder({
      title: '移動先のシートまたはボードを選択', selectFiles: true,
      fileTypes: ['database', 'board'], includeHome: false,
      includeSources: true, includeWorkspaces: false,
      emptyText: '移動先にできるシートまたはボードがありません。',
    });
    return selection ? registeredTarget(selection) : null;
  }

  function columnsForDocument(document, viewId) {
    const views = document?.sheetViews || [];
    const requested = String(viewId || document?.activeSheetViewId || document?.activeView || '');
    const view = views.find(item => String(item?.viewId || item?.sheetViewId || '') === requested)
      || views[0] || {};
    const types = document?.legacySheet?.propertyTypes || {};
    return (Array.isArray(view.columns) ? view.columns : []).map((column, index) => {
      const raw = typeof column === 'string' ? { columnId: column, name: column } : (column || {});
      const name = String(raw.name || raw.label || raw.columnId || raw.propertyId || `列${index + 1}`);
      const config = types[name] || {};
      return global.MeldexTopicPropertyFamily.normalizeColumn({
        ...clone(config), ...clone(raw), name,
        columnId: String(raw.columnId || raw.propertyId || name),
        columnType: raw.columnType || raw.type || config.type || 'text',
        propertyFamilyId: raw.propertyFamilyId || config.propertyFamilyId
          || global.MeldexTopicPropertyFamily.legacyPropertyFamilyId(document.documentId, name),
      });
    });
  }

  function bindingDialog(value, candidates) {
    if (!global.GBUI?.createModal) return Promise.resolve({ decision: 'cancel' });
    return new Promise(resolve => {
      const body = document.createElement('div');
      const message = document.createElement('p');
      message.textContent = `「${value.displayName}」（${value.columnType}）と同名・同タイプの列があります。`;
      const select = document.createElement('select');
      select.className = 'gb-select';
      select.setAttribute('aria-label', '共通化する既存列');
      candidates.forEach(candidate => {
        const option = document.createElement('option');
        option.value = candidate.propertyFamilyId || candidate.columnId;
        const origin = candidate.legacyPath || candidate.documentId || candidate.columnId;
        const count = Number(candidate.existingValueCount || 0);
        option.textContent = `${candidate.name} / ${candidate.columnType} / ${origin} / 値${count}件`;
        select.appendChild(option);
      });
      const help = document.createElement('p');
      help.textContent = '共通化すると、この値を選択した移動先の列へ表示します。別の列として保持した場合、値はトピック内に残り、この場所では非表示です。';
      body.append(message, select, help);
      const commonize = document.createElement('button');
      commonize.type = 'button'; commonize.className = 'gb-btn gb-btn-primary';
      commonize.textContent = '既存の列と共通化';
      const separate = document.createElement('button');
      separate.type = 'button'; separate.className = 'gb-btn';
      separate.textContent = '同名の別の列として保持';
      const cancel = document.createElement('button');
      cancel.type = 'button'; cancel.className = 'gb-btn'; cancel.textContent = 'キャンセル';
      let settled = false;
      const modal = global.GBUI.createModal({
        id: 'topic-column-binding-dialog', title: '同名・同タイプの列を確認', body,
        footer: [cancel, separate, commonize], variant: 'mobile-sheet',
        onClose: () => { if (!settled) resolve({ decision: 'cancel' }); },
      });
      const finish = decision => {
        settled = true;
        modal.close('submit');
        resolve({ decision, candidateId: select.value });
      };
      commonize.addEventListener('click', () => finish('commonize'));
      separate.addEventListener('click', () => finish('keep-separate'));
      cancel.addEventListener('click', () => finish('cancel'));
      modal.open();
    });
  }

  async function ensureView(dbPath) {
    const path = normalizePath(dbPath);
    if (viewsByPath.has(path)) return viewsByPath.get(path);
    const result = await global.GbTopicLiveBridge?.migrateOpenedSheet?.(dbPath, { reason: 'column-confirm' });
    if (result?.detail) rememberView(result.detail);
    return viewsByPath.get(path) || null;
  }

  function renamedSheetViews(document, oldName, newName, familyId, currentColumn) {
    const views = clone(document.sheetViews || []);
    views.forEach(view => {
      if (!Array.isArray(view.columns)) return;
      view.columns = view.columns.map(raw => {
        const column = typeof raw === 'string'
          ? { ...clone(currentColumn || {}), columnId: raw, name: raw }
          : clone(raw);
        const name = String(column.name || column.label || column.columnId || '');
        if (name !== oldName) return column;
        column.name = newName;
        if (column.label === oldName) column.label = newName;
        if (familyId) {
          if (familyId !== currentColumn?.propertyFamilyId) {
            column.sourcePropertyFamilyId = currentColumn?.propertyFamilyId || '';
          }
          column.propertyFamilyId = familyId;
        }
        return column;
      });
    });
    return views;
  }

  async function renameColumn(options) {
    const view = await ensureView(options.dbPath);
    const baseCheckpointId = checkpointId(view?.checkpoint);
    if (!view?.document || !baseCheckpointId) {
      throw new Error('列の共通化候補を確認できないため、列名を変更しませんでした');
    }
    const currentColumns = columnsForDocument(
      view.document, options.viewId || options.ctx?.currentViewId,
    );
    const current = currentColumns.find(column => column.name === options.oldName);
    if (!current) throw new Error('変更する列の型と安定IDを確認できません');
    const params = new URLSearchParams({
      name: options.newName,
      column_type: current.columnType,
      document_id: view.document.documentId,
    });
    const response = await global.apiFetch(`/topic-property-families/candidates?${params}`, { silentError: true });
    const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
    let familyId = current.propertyFamilyId;
    if (candidates.length) {
      const decision = await bindingDialog({
        displayName: options.newName, columnType: current.columnType,
      }, candidates);
      if (decision.decision === 'cancel') return false;
      if (decision.decision === 'commonize') {
        familyId = candidates.find(item => (item.propertyFamilyId || item.columnId) === decision.candidateId)?.propertyFamilyId;
      }
    }
    const expectedSheetViews = renamedSheetViews(
      view.document, options.oldName, options.newName, familyId, current,
    );
    const patchMutationId = mutationId('column-rename');
    await options.rename();
    try {
      const result = await global.apiFetch(`/topic-views/${encodeURIComponent(view.document.documentId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, silentError: true,
        body: JSON.stringify({
          baseCheckpointId,
          mutationId: patchMutationId,
          changes: { sheetViews: expectedSheetViews },
        }),
      });
      view.document = clone(result.viewDocument);
      view.checkpoint = clone(result.checkpoint);
      return true;
    } catch (error) {
      // 応答喪失時に無条件でlegacy側を戻すと、保存済みcanonical viewと分裂する。
      // 現在のcheckpointを読み直し、保存済みか未保存かを確定できた場合だけ続行する。
      try {
        const currentSnapshot = await global.apiFetch(
          `/topic-views/${encodeURIComponent(view.document.documentId)}/snapshot`,
          { silentError: true },
        );
        if (JSON.stringify(currentSnapshot?.viewDocument?.sheetViews || [])
            === JSON.stringify(expectedSheetViews)) {
          view.document = clone(currentSnapshot.viewDocument);
          view.checkpoint = clone(currentSnapshot.checkpoint);
          return true;
        }
        if (checkpointId(currentSnapshot?.checkpoint) !== baseCheckpointId) {
          const unknown = new Error('列名変更と列定義の保存結果が競合しています');
          unknown.resultUnknown = true;
          throw unknown;
        }
      } catch (verificationError) {
        if (verificationError?.resultUnknown) throw verificationError;
        const unknown = new Error('列定義の保存結果を確認できません');
        unknown.resultUnknown = true;
        throw unknown;
      }
      try {
        await options.rollback?.();
      } catch (rollbackError) {
        const combined = new Error(
          `列定義と実シートの復元結果を確認できません: ${rollbackError?.message || rollbackError}`,
        );
        combined.resultUnknown = true;
        throw combined;
      }
      throw error;
    }
  }

  async function columnBindings(record, targetDocument, targetViewId) {
    if (!record || targetDocument?.defaultSurface !== 'sheet') return [];
    const columns = columnsForDocument(targetDocument, targetViewId);
    const values = Object.values(record.propertyValuesByFamilyId || {});
    const bindings = [];
    const boundTargets = new Set();
    for (const value of values) {
      if (columns.some(column => column.propertyFamilyId === value.propertyFamilyId)) continue;
      const sourceColumn = {
        columnId: value.propertyFamilyId, propertyFamilyId: value.propertyFamilyId,
        name: value.displayName || value.propertyFamilyId, columnType: value.columnType,
        typeConfig: value.typeConfig || {},
      };
      const candidates = columns.filter(column => !boundTargets.has(column.propertyFamilyId)
        && column.normalizedName
        === global.MeldexTopicPropertyFamily.normalizeColumn(sourceColumn).normalizedName
        && global.MeldexTopicPropertyFamily.compatibleTypes(sourceColumn, column));
      if (!candidates.length) continue;
      const choice = await bindingDialog(value, candidates);
      if (choice.decision === 'cancel') return null;
      if (choice.decision !== 'commonize') continue;
      const targetColumn = candidates.find(candidate => (candidate.propertyFamilyId || candidate.columnId) === choice.candidateId);
      bindings.push({
        sourcePropertyFamilyId: value.propertyFamilyId,
        targetPropertyFamilyId: targetColumn.propertyFamilyId,
        sourceColumn, targetColumn, confirmed: true,
      });
      boundTargets.add(targetColumn.propertyFamilyId);
    }
    return bindings;
  }

  const client = global.MeldexTopicPlacement?.createClient?.({
    isOnline: () => global.navigator?.onLine !== false,
    prepare: payload => global.apiFetch('/topic-placements/prepare', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), silentError: true,
    }),
    commit: payload => global.apiFetch('/topic-placements/commit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), silentError: true,
    }),
  });

  async function refreshView(documentId, path, sourceId) {
    if (!documentId || typeof global.apiFetch !== 'function') return null;
    const snapshot = await global.apiFetch(
      `/topic-views/${encodeURIComponent(documentId)}/snapshot`, { silentError: true },
    );
    const previous = viewsByPath.get(normalizePath(path));
    const detail = {
      sourceId: String(sourceId || previous?.sourceId || ''),
      dbPath: path,
      legacyPath: path,
      archiveRelativePath: previous?.archiveRelativePath || '',
      viewDocument: snapshot.viewDocument,
      checkpoint: snapshot.checkpoint,
      topicRecords: (snapshot.topics || []).map(item => item?.record && ({
        ...item.record, topicRef: item.topicRef,
      })).filter(Boolean),
      readOnly: snapshot.readOnly === true,
    };
    global.dispatchEvent?.(new CustomEvent('meldex:topic-records-updated', { detail }));
    return detail;
  }

  function uniqueRefreshTargets(items) {
    return (items || []).filter((item, index, rows) => item?.documentId && item?.path
      && rows.findIndex(other => String(other?.documentId || '') === String(item.documentId)) === index);
  }

  async function refreshAffectedViews(items, options) {
    const settings = options || {};
    const targets = uniqueRefreshTargets(items);
    const settled = await Promise.allSettled(targets.map(item => refreshView(
      item.documentId, item.path, item.sourceId,
    )));
    const failures = settled.map((result, index) => result.status === 'rejected' && ({
      target: clone(targets[index]),
      message: String(result.reason?.message || result.reason || '再読込に失敗しました'),
    })).filter(Boolean);
    if (settings.broadcast !== false) {
      targets.forEach(item => placementChannel?.postMessage({ kind: 'refresh-topic-view', ...item }));
    }
    if (!failures.length) return { ok: true, targets: clone(targets), failures: [] };
    const retryId = mutationId('topic-refresh');
    failedRefreshes.set(retryId, clone(targets));
    const detail = {
      retryId, reason: String(settings.reason || 'topic-refresh'),
      failures: clone(failures), targets: clone(targets), saved: settings.saved === true,
    };
    global.dispatchEvent?.(new CustomEvent('meldex:topic-placement-refresh-failed', { detail }));
    if (settings.notify !== false) {
      const prefix = settings.saved === true ? '保存は完了しましたが、' : '';
      global.showStatus?.(`${prefix}${failures.length}画面を更新できませんでした。更新ボタンまたは再試行で最新状態を取得してください`, true);
    }
    return { ok: false, retryId, targets: clone(targets), failures };
  }

  async function retryRefresh(retryId) {
    const targets = failedRefreshes.get(String(retryId || ''));
    if (!targets) return { ok: false, state: 'missing' };
    const result = await refreshAffectedViews(targets, {
      reason: 'topic-refresh-retry', saved: true, broadcast: true,
    });
    if (result.ok) {
      failedRefreshes.delete(String(retryId));
      global.showStatus?.('保存済みのトピック表示を更新しました');
    }
    return result;
  }

  async function updateProjectedValue(valueRef, updates) {
    const ref = valueRef?.topicRef;
    const dbPath = normalizePath(valueRef?._topicDbPath);
    const view = viewsByPath.get(dbPath);
    if (!ref?.sourceId || !ref?.topicId || !view) {
      throw new Error('リンク複製したトピックの保存先を確認できません');
    }
    if (valueRef?._topicReadOnly === true || view.readOnly === true) {
      throw new Error('このトピック表示は読み取り専用です');
    }
    const loaded = await global.apiFetch(
      `/topic-stores/${encodeURIComponent(ref.sourceId)}/topics/${encodeURIComponent(ref.topicId)}`,
      { silentError: true },
    );
    const record = loaded.topic;
    const familyId = String(valueRef._topicPropertyFamilyId || '');
    if (!familyId) throw new Error('この列の共有列IDを確認できません');
    const typed = clone(record.propertyValuesByFamilyId || {});
    const order = [...(record.propertyValueOrder || [])];
    const properties = clone(record.properties || {});
    const columnName = String(valueRef.property || valueRef._topicColumnName || valueRef._topicColumnId || '');
    if (updates?._delete) {
      delete typed[familyId];
      delete properties[columnName];
      const index = order.indexOf(familyId);
      if (index >= 0) order.splice(index, 1);
    } else {
      const nextValue = updates?.new_value !== undefined ? updates.new_value : valueRef.value;
      typed[familyId] = {
        ...(typed[familyId] || {}), propertyFamilyId: familyId,
        displayName: columnName, columnType: valueRef._topicColumnType || 'text',
        typeConfig: clone(typed[familyId]?.typeConfig || {}), value: clone(nextValue),
        origins: clone(typed[familyId]?.origins || [{
          sourceId: ref.sourceId, documentId: view.document.documentId,
          columnId: valueRef._topicColumnId || columnName, columnName,
        }]),
        revision: Number(typed[familyId]?.revision || 0) + 1,
      };
      properties[columnName] = clone(nextValue);
      if (!order.includes(familyId)) order.push(familyId);
    }
    const saved = await global.apiFetch(
      `/topic-stores/${encodeURIComponent(ref.sourceId)}/topics/${encodeURIComponent(ref.topicId)}`,
      {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, silentError: true,
        body: JSON.stringify({ mutationId: mutationId('topic-value'), baseRevision: record.revision,
          changes: { propertyValuesByFamilyId: typed, propertyValueOrder: order, properties } }),
      },
    );
    const affected = [];
    for (const [path, cached] of viewsByPath.entries()) {
      if (!(cached.document?.placements || []).some(item => topicKey(item.topicRef) === topicKey(ref))) continue;
      affected.push({ documentId: cached.document.documentId, path, sourceId: cached.sourceId });
    }
    const refresh = await refreshAffectedViews(affected, {
      reason: 'topic-value-updated', saved: true,
    });
    return { ...saved, revision: saved?.record?.revision, refresh };
  }

  async function renameProjectedTopic(entity, title) {
    const ref = entity?.topicRef;
    if (!ref?.sourceId || !ref?.topicId) throw new Error('トピックIDを確認できません');
    const view = viewsByPath.get(normalizePath(entity?._topicDbPath));
    if (entity?._topicReadOnly === true || view?.readOnly === true) {
      throw new Error('このトピック表示は読み取り専用です');
    }
    const loaded = await global.apiFetch(
      `/topic-stores/${encodeURIComponent(ref.sourceId)}/topics/${encodeURIComponent(ref.topicId)}`,
      { silentError: true },
    );
    const saved = await global.apiFetch(
      `/topic-stores/${encodeURIComponent(ref.sourceId)}/topics/${encodeURIComponent(ref.topicId)}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, silentError: true,
        body: JSON.stringify({ mutationId: mutationId('topic-title'),
          baseRevision: loaded.topic.revision, changes: { title } }) },
    );
    const affected = [];
    for (const [path, cached] of viewsByPath.entries()) {
      if ((cached.document?.placements || []).some(item => topicKey(item.topicRef) === topicKey(ref))) {
        affected.push({ documentId: cached.document.documentId, path, sourceId: cached.sourceId });
      }
    }
    const refresh = await refreshAffectedViews(affected, {
      reason: 'topic-title-updated', saved: true,
    });
    return { ...saved, refresh };
  }

  async function updateProjectedBoardText(node, text) {
    const ref = node?.topicRef;
    if (!ref?.sourceId || !ref?.topicId) throw new Error('トピックIDを確認できません');
    if (node?._topicReadOnly === true) throw new Error('このトピック表示は読み取り専用です');
    const loaded = await global.apiFetch(
      `/topic-stores/${encodeURIComponent(ref.sourceId)}/topics/${encodeURIComponent(ref.topicId)}`,
      { silentError: true },
    );
    const [title, ...noteLines] = String(text || '').split('\n');
    const saved = await global.apiFetch(
      `/topic-stores/${encodeURIComponent(ref.sourceId)}/topics/${encodeURIComponent(ref.topicId)}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, silentError: true,
        body: JSON.stringify({ mutationId: mutationId('topic-board-text'),
          baseRevision: loaded.topic.revision, changes: { title: title || '無題', note: noteLines.join('\n') } }) },
    );
    const affected = [];
    for (const [path, cached] of viewsByPath.entries()) {
      if ((cached.document?.placements || []).some(item => topicKey(item.topicRef) === topicKey(ref))) {
        affected.push({ documentId: cached.document.documentId, path, sourceId: cached.sourceId });
      }
    }
    const refresh = await refreshAffectedViews(affected, {
      reason: 'topic-board-text-updated', saved: true,
    });
    return { ...saved, refresh };
  }

  placementChannel && (placementChannel.onmessage = event => {
    const detail = event?.data;
    if (detail?.kind === 'refresh-topic-view' && detail.documentId && detail.path) {
      void refreshAffectedViews([detail], {
        reason: 'cross-window-topic-refresh', saved: true, broadcast: false,
      });
    }
  });

  async function execute(source, operation, explicitTarget, options) {
    const executeOptions = options || {};
    if (!client || !source?.topicRef
        || (['move', 'detach'].includes(operation) && !source?.placement)) {
      throw new Error('このトピックの配置情報を確認できません');
    }
    if (source.readOnly === true) throw new Error('このトピック表示は読み取り専用です');
    let target = explicitTarget || null;
    if (operation === 'duplicate' && !target) {
      target = {
        documentId: source.placement.documentId, viewId: source.placement.viewId,
        surface: source.placement.surface, revision: source.revision, document: source.document,
        path: source.path, label: source.label,
      };
    } else if (!target && operation !== 'detach') {
      target = await pickTarget();
      if (!target) return { ok: false, state: 'cancelled' };
    }
    const bindings = operation === 'detach' ? []
      : Array.isArray(executeOptions.columnBindings) ? clone(executeOptions.columnBindings)
        : await columnBindings(source.record, target.document, target.viewId);
    if (bindings === null) return { ok: false, state: 'cancelled' };
    if (target) target.columnBindings = clone(bindings);
    const baseRevisions = {};
    if (source.placement?.documentId) baseRevisions[source.placement.documentId] = source.revision;
    if (target) baseRevisions[target.documentId] = target.revision;
    const request = {
      operation, operationId: executeOptions.operationId || mutationId(operation), topicRef: source.topicRef,
      sourcePlacement: ['move', 'detach'].includes(operation) ? source.placement : null,
      target: target ? { documentId: target.documentId, viewId: target.viewId,
        surface: target.surface, position: clone(target.position || null) } : null,
      columnBindings: bindings, baseRevisions,
    };
    if (operation === 'detach') {
      const usage = await global.apiFetch(`/topics/${encodeURIComponent(source.topicRef.sourceId)}/${encodeURIComponent(source.topicRef.topicId)}/usages`, { silentError: true });
      const count = (usage?.usages || []).filter(item => item.kind === 'placement').length;
      request.currentPlacementCount = count;
      if (count <= 1 && executeOptions.allowOrphan !== true) {
        const confirmed = await global.cfConfirm?.('最後の登録先から外すと、トピックはどこにも表示されなくなります。続行しますか？');
        if (!confirmed) return { ok: false, state: 'cancelled' };
        request.allowOrphan = true;
      } else if (count <= 1) {
        request.allowOrphan = true;
      }
    }
    const result = await client.execute(request);
    if (!result.ok) {
      global.showStatus?.(result.message || 'トピックの配置を変更できませんでした', true);
      return result;
    }
    if (result.noOp === true) {
      global.showStatus?.(`${source.label}は既にこの場所へ登録されています`);
      return result;
    }
    const refreshTargets = [
      ...(source.placement?.documentId ? [{ documentId: source.placement.documentId, path: source.path,
        sourceId: source.topicRef.sourceId }] : []),
      ...(target ? [{ documentId: target.documentId, path: target.path,
        sourceId: target.sourceId || source.topicRef.sourceId }] : []),
    ].filter((item, index, items) => item.documentId && item.path
      && items.findIndex(other => other.documentId === item.documentId) === index);
    const label = ({ move: '移動', 'link-duplicate': 'リンク複製', duplicate: '複製', detach: 'この場所から外す' })[operation];
    const refresh = await refreshAffectedViews(refreshTargets, {
      reason: `topic-placement-${operation}`, saved: true,
    });
    if (refresh.ok) global.showStatus?.(`${source.label}を${label}しました`);
    if (!executeOptions.skipHistory) {
      global.dispatchEvent?.(new CustomEvent('meldex:topic-placement-committed', {
        detail: { operation, source: clone(source), target: clone(target), result: clone(result) },
      }));
    }
    return { ...result, refresh };
  }

  function usageTarget(row) {
    const target = row?.target || row?.location || {};
    const path = row?.kind === 'placement'
      ? (target.sourceQualifiedPath || target.legacyPath || target.relativePath || target.path || target.href)
      : (target.href || target.legacyPath || target.relativePath || target.path);
    const href = String(path || '').trim();
    if (!href || /[\u0000-\u001f\u007f]/.test(href)) return null;
    const scheme = href.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase() || '';
    if (scheme && !['http', 'https', 'mailto', 'source'].includes(scheme)) return null;
    const router = global.GBLinkRouter;
    if (typeof router?.resolve !== 'function') return null;
    const resolved = router.resolve(href, {
      label: row?.label, linkType: target.linkType || (row?.kind === 'placement' ? target.surface : ''),
    });
    return resolved?.recognized !== false && resolved?.type !== 'unsupported' ? resolved : null;
  }

  function usageCanOpen(row) {
    return typeof global.openLink === 'function' && !!usageTarget(row);
  }

  function openUsage(row) {
    const resolved = usageTarget(row);
    if (resolved && typeof global.openLink === 'function') {
      return global.openLink(resolved.path,
        row?.label || resolved.label || String(resolved.path).split(/[\\/]/).pop(),
        { linkType: resolved.type });
    }
    global.showStatus?.('登録先のファイルを現在のソースで確認できません', true);
    return false;
  }

  async function showDetail(source) {
    if (!source?.topicRef || !global.MeldexTopicDetail?.mount) throw new Error('トピック詳細を開けません');
    const ref = source.topicRef;
    const [topic, usage] = await Promise.all([
      global.apiFetch(`/topic-stores/${encodeURIComponent(ref.sourceId)}/topics/${encodeURIComponent(ref.topicId)}`, { silentError: true }),
      global.apiFetch(`/topics/${encodeURIComponent(ref.sourceId)}/${encodeURIComponent(ref.topicId)}/usages`, { silentError: true }),
    ]);
    const record = topic?.topic || topic?.record || topic;
    const body = document.createElement('div');
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'gb-btn'; close.textContent = '閉じる';
    const modal = global.GBUI.createModal({
      id: 'topic-detail-dialog', title: record?.title || source.label || 'トピック詳細',
      body, footer: [close], variant: 'mobile-sheet',
    });
    close.addEventListener('click', () => modal.close('close'));
    global.MeldexTopicDetail.mount(body, {
      topicRef: ref, ...clone(record), currentColumns: columnsForDocument(
        source.document, source.placement?.viewId,
      ),
      usageIndex: { topicRef: ref, revision: 0, partial: usage?.coverage !== 'complete',
        usages: (usage?.usages || []).map(item => ({ ...item,
          available: item.available !== false && usageCanOpen(item) })) },
    }, {
      onOpenUsage: openUsage,
      readOnly: source.readOnly === true,
      sourceFolder: global.MeldexAutoTagSourceFolder?.(source.path) || '',
      onUpdateValue: async (row, nextValue) => updateProjectedValue({
        topicRef: ref,
        _topicDbPath: source.path,
        _topicPropertyFamilyId: row.id,
        _topicColumnName: row.label,
        _topicColumnType: row.type,
        property: row.label,
        value: row.value,
      }, { new_value: nextValue }),
    });
    modal.open();
  }

  function menuItems(source) {
    if (!source) return [];
    const invoke = (operation, target) => execute(source, operation, target).catch(error => {
      global.showStatus?.(String(error?.message || error), true);
    });
    return [
      { icon: 'move', label: '移動...', action: () => invoke('move') },
      { icon: 'copy', label: 'リンク複製...', action: () => invoke('link-duplicate') },
      { icon: 'copyPlus', label: '複製', action: () => invoke('duplicate') },
      { icon: 'unlink', label: 'この場所から外す', action: () => invoke('detach') },
      { icon: 'list', label: 'トピック詳細', action: () => showDetail(source).catch(error => global.showStatus?.(String(error?.message || error), true)) },
    ];
  }

  function transferSource(source) {
    return {
      topicRef: clone(source.topicRef),
      documentId: String(source.placement?.documentId || ''),
      placementId: String(source.placement?.placementId || ''),
      viewId: String(source.placement?.viewId || ''),
      surface: String(source.placement?.surface || source.surface || ''),
      baseRevision: String(source.revision || ''),
      path: normalizePath(source.path),
      label: String(source.label || 'トピック').slice(0, 256),
    };
  }

  async function resolveTransferredSource(value) {
    const ref = value?.topicRef;
    const documentId = String(value?.documentId || '');
    if (!ref?.sourceId || !ref?.topicId || !documentId) {
      throw new Error('ドラッグ元のトピックIDを確認できません');
    }
    const snapshot = await global.apiFetch(
      `/topic-views/${encodeURIComponent(documentId)}/snapshot`, { silentError: true },
    );
    const revision = checkpointId(snapshot?.checkpoint);
    if (String(value.baseRevision || '') !== revision) {
      const error = new Error('ドラッグ開始後に元のシートまたはボードが更新されました');
      error.status = 409;
      throw error;
    }
    if (snapshot?.readOnly) throw new Error('ドラッグ元は読み取り専用です');
    const placement = (snapshot?.viewDocument?.placements || []).find(item => (
      String(item?.placementId || '') === String(value.placementId || '')
      && topicKey(item?.topicRef) === topicKey(ref)
    ));
    if (!placement) throw new Error('ドラッグ元の登録が現在の保存内容と一致しません');
    const loaded = await global.apiFetch(
      `/topic-stores/${encodeURIComponent(ref.sourceId)}/topics/${encodeURIComponent(ref.topicId)}`,
      { silentError: true },
    );
    return {
      topicRef: clone(ref), placement: clone(placement),
      record: clone(loaded?.topic || loaded?.record || loaded),
      path: normalizePath(value.path), document: clone(snapshot.viewDocument), revision,
      label: String(value.label || loaded?.topic?.title || 'トピック'),
      surface: String(placement.surface || value.surface || ''), readOnly: false,
    };
  }

  function sourceFromElement(element) {
    const boardCard = element?.closest?.('.bd-node');
    if (boardCard) {
      const context = boardContextForElement(boardCard);
      const node = context.boardState?.nodes?.find(
        item => String(item.id) === String(boardCard.dataset.cardId),
      );
      return node ? boardSource(node, context.boardState, context.path) : null;
    }
    const treeNode = element?.closest?.('.tree-node')?._nodeData;
    if (treeNode?.type === 'entity') return treeSource(treeNode);
    const row = element?.closest?.('[data-entity-name]');
    if (row) {
      const entityName = row.dataset.entityName;
      const paneState = global._dbPaneContextFromEvent?.(row) || global.state;
      return sheetSource(
        paneState?.dbPath || global.state?.currentDbPath, entityName,
        paneState?.pivotData?.entities?.[entityName], paneState?.currentViewId,
      );
    }
    return null;
  }

  function sourcesFromElement(element) {
    const boardCard = element?.closest?.('.bd-node');
    if (boardCard) {
      const context = boardContextForElement(boardCard);
      const node = context.boardState?.nodes?.find(
        item => String(item.id) === String(boardCard.dataset.cardId),
      );
      if (!node) return [];
      const selected = context.boardState?.selected;
      const nodes = selected instanceof Set && selected.has(node.id) && selected.size > 1
        ? (context.boardState.nodes || []).filter(item => selected.has(item.id)) : [node];
      return nodes.map(item => boardSource(item, context.boardState, context.path)).filter(Boolean);
    }
    const row = element?.closest?.('[data-entity-name]');
    if (row) {
      const paneState = global._dbPaneContextFromEvent?.(row) || global.state;
      const entityName = row.dataset.entityName;
      const selected = paneState?._selectedEntities;
      const names = selected instanceof Set && selected.has(entityName) && selected.size > 1
        ? [...selected] : [entityName];
      return names.map(name => sheetSource(
        paneState?.dbPath || global.state?.currentDbPath, name,
        paneState?.pivotData?.entities?.[name], paneState?.currentViewId,
      )).filter(Boolean);
    }
    const source = sourceFromElement(element);
    return source ? [source] : [];
  }

  async function targetFromDrop(element) {
    const treeNode = element?.closest?.('.tree-node')?._nodeData;
    if (treeNode && ['database', 'board'].includes(treeNode.type)) return registeredTarget(treeNode);
    const subpanel = element?.closest?.('.gb-subpanel');
    if (subpanel) {
      const current = global.GBSubPanel?.getCurrentTarget?.();
      const sheetTypes = new Set(['database', 'pivot', 'gallery', 'kanban', 'timeline',
        'calendar', 'tasks', 'shifts', 'chart', 'graph']);
      const type = current?.type === 'board' ? 'board'
        : (sheetTypes.has(current?.type) ? 'database' : '');
      if (type && current?.path) {
        return registeredTarget({ path: current.path, name: current.label, type },
          current.state?.currentViewId || current.state?.activeBoardViewId || '');
      }
    }
    const pane = element?.closest?.('.gb-pane');
    const tab = pane?.dataset?.paneId ? global.GBTabs?.getActiveTab?.(pane.dataset.paneId) : null;
    if (tab && ['database', 'board'].includes(tab.type)) {
      const paneState = global.getPaneContext?.(pane.dataset.paneId);
      const boardContext = tab.type === 'board' ? boardContextForElement(element) : null;
      const preferredViewId = tab.viewId || tab.currentViewId || paneState?.currentViewId
        || boardContext?.boardState?.activeBoardViewId || '';
      const result = await registeredTarget(
        { path: tab.path, name: tab.label, type: tab.type }, preferredViewId,
      );
      if (tab.type === 'board') result._dropCanvas = boardContext?.canvas;
      return result;
    }
    return null;
  }

  function installDragAndDrop() {
    document.addEventListener('dragstart', event => {
      const sources = sourcesFromElement(event.target);
      if (!sources.length || !event.dataTransfer) return;
      const payload = { sources: sources.map(transferSource) };
      const nonce = global.MeldexDnD?.beginCrossWindowDrag?.(
        event.dataTransfer, payload, 'topic',
      );
      if (!nonce) return;
      event.dataTransfer.effectAllowed = 'copyMove';
    }, true);
    document.addEventListener('dragover', event => {
      if (!global.MeldexDnD?.hasDropKind?.(event, 'topic')) return;
      const route = global.MeldexDnD?.resolveTargetRoute?.(event);
      if (route?.kind === 'topic-placement') event.preventDefault();
    }, true);
    document.addEventListener('drop', async event => {
      if (!global.MeldexDnD?.hasDropKind?.(event, 'topic')) return;
      const route = global.MeldexDnD?.resolveTargetRoute?.(event);
      // note編集領域・linkセル・panel chromeは既存node receiverへ渡す。
      if (route?.kind !== 'topic-placement') return;
      const resolved = await global.MeldexDnD.resolveDropData(event, 'topic');
      if (!resolved) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      try {
        const offered = Array.isArray(resolved.payload?.sources) ? resolved.payload.sources : [];
        if (offered.length !== 1) {
          throw new Error(`複数選択${offered.length}件の配置は安全な一括保存を利用できないため変更しませんでした`);
        }
        const source = await resolveTransferredSource(offered[0]);
        const target = await targetFromDrop(event.target);
        if (!source || !target) throw new Error('トピックの移動先を確認できません');
        if (target.surface === 'board' && typeof global.bdClientToCanvasLocal === 'function') {
          target.position = global.bdClientToCanvasLocal(event.clientX, event.clientY, target._dropCanvas);
        }
        delete target._dropCanvas;
        const operation = event.ctrlKey || event.metaKey ? 'link-duplicate' : 'move';
        const result = await execute(source, operation, target);
        if (!result?.ok) throw new Error(result?.message || '配置を保存できませんでした');
        global.MeldexDnD.completeDrop(resolved);
      } catch (error) {
        global.MeldexDnD.failDrop(resolved);
        global.showStatus?.(`トピックの配置を変更できませんでした: ${error?.message || error}`, true);
      }
    }, true);
  }

  if (typeof document !== 'undefined') installDragAndDrop();
  global.MeldexTopicPlacementUI = Object.freeze({
    MIME, rememberView, sheetSource, treeSource, boardSource, menuItems, execute, showDetail, pickTarget,
    renameColumn, projectSheetPivot, refreshView, updateProjectedValue, renameProjectedTopic,
    updateProjectedBoardText, usageTarget, usageCanOpen, openUsage, retryRefresh,
    sourcesFromElement, transferSource, resolveTransferredSource,
  });
})(typeof window !== 'undefined' ? window : globalThis);
