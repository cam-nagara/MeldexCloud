/* Live board bridge for the additive TopicViewDocument frontmatter contract. */
(function initMeldexBoardTopicIntegration(global) {
  'use strict';

  const FIELD = 'topicViewDocument';
  const REFS_FIELD = 'topicRefs';
  const COMMON_GROUP_TEMPLATES_KEY = 'meldex-board-group-templates-common-v1';
  const openBoards = new Set();
  let topicRecordListenerInstalled = false;

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function hashText(value) {
    let hash = 2166136261;
    const text = String(value || '').replace(/\\/g, '/').toLowerCase();
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function parseScalar(raw) {
    const value = typeof global.bdYamlScalar === 'function' ? global.bdYamlScalar(raw) : String(raw || '').trim();
    if (value && typeof value === 'object') return value;
    try { return JSON.parse(String(value || '')); } catch (_) { return null; }
  }

  function parseFrontmatter(frontmatter) {
    const text = String(frontmatter || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const documentMatch = text.match(/^topicViewDocument:\s*(.+)$/m);
    const topicViewDocument = documentMatch ? parseScalar(documentMatch[1]) : null;
    const topicRefsByNodeKey = {};
    const lines = typeof global.bdYamlTopLevelBlock === 'function'
      ? global.bdYamlTopLevelBlock(text, REFS_FIELD)
      : [];
    lines.forEach((line) => {
      const match = line.match(/^\s+(n\d+):\s*(.*)$/);
      if (!match) return;
      const parsed = parseScalar(match[2]);
      if (parsed?.sourceId && parsed?.topicId) topicRefsByNodeKey[match[1]] = parsed;
    });
    return { topicViewDocument, topicRefsByNodeKey };
  }

  function legacyTopicRef(node, path) {
    return {
      sourceId: 'local-vault',
      topicId: `legacy-board:${hashText(path)}:${encodeURIComponent(String(node?.id || 'topic'))}`,
    };
  }

  function ensureTopicRefs(board, parsed, path) {
    const byKey = parsed?.topicRuntime?.topicRefsByNodeKey || {};
    (board.nodes || []).forEach((node, index) => {
      const saved = byKey[`n${index}`];
      if (saved?.sourceId && saved?.topicId) node.topicRef = clone(saved);
      else if (!node.topicRef?.sourceId || !node.topicRef?.topicId) node.topicRef = legacyTopicRef(node, path);
    });
  }

  function legacyGroupsToView(board) {
    const byId = new Map((board.nodes || []).map((node) => [node.id, node.topicRef]));
    return (board.groups || []).map((group, index) => ({
      ...clone(group),
      groupId: String(group.groupId || group.id || `group-${index + 1}`),
      name: String(group.name || 'グループ'),
      topicRefs: (group.topicRefs || group.nodeIds || []).map((value) => (
        value?.sourceId ? value : byId.get(value)
      )).filter(Boolean).map(clone),
      styleRef: group.styleRef || null,
      styleOverrides: clone(group.styleOverrides || group.style || {}),
      locked: !!group.locked,
      collapsed: !!group.collapsed,
      x: Number(group.x) || 0,
      y: Number(group.y) || 0,
      w: Number(group.w) || undefined,
      h: Number(group.h) || undefined,
    }));
  }

  function legacyLinesToView(board) {
    const refs = Object.fromEntries((board.nodes || []).map((node) => [node.id, node.topicRef]));
    return (board.connections || []).map((line) => {
      if (!global.MeldexBoardOutlineEndpoints) return clone(line);
      return global.MeldexBoardOutlineEndpoints.normalizeLine(line, refs);
    });
  }

  function normalizeTopicDocument(document, board, path) {
    const refs = (board?.nodes || [])
      .map((node) => clone(node.topicRef))
      .filter((ref) => ref?.sourceId && ref?.topicId);
    const source = clone(document || {});
    const membership = clone(source.membership || {});
    if (!Array.isArray(membership.manualTopicRefs)) {
      membership.manualTopicRefs = clone(Array.isArray(membership.topicRefs) ? membership.topicRefs : refs);
    }
    membership.mode = ['manual', 'query', 'hybrid'].includes(membership.mode)
      ? membership.mode : 'manual';
    if (membership.mode === 'manual' && !Object.prototype.hasOwnProperty.call(membership, 'queryDefinition')) {
      membership.queryDefinition = null;
    }
    const prepared = {
      ...source,
      schemaVersion: source.schemaVersion || 1,
      documentId: source.documentId || `legacy-board-document:${hashText(path)}`,
      defaultSurface: 'board',
      membership,
      sheetViews: Array.isArray(source.sheetViews) ? source.sheetViews : [],
      boardViews: Array.isArray(source.boardViews) ? source.boardViews : [],
      relationSets: Array.isArray(source.relationSets) ? source.relationSets : [],
      topicLayouts: Array.isArray(source.topicLayouts) ? source.topicLayouts : [],
      lastCompleteSnapshot: Object.prototype.hasOwnProperty.call(source, 'lastCompleteSnapshot')
        ? source.lastCompleteSnapshot : null,
    };
    const boardNormalized = global.MeldexBoardTopicViews.normalizeDocument(prepared);
    return global.MeldexTopicViewDocument?.normalizeDocument
      ? global.MeldexTopicViewDocument.normalizeDocument(boardNormalized)
      : boardNormalized;
  }

  function runtimeForCapture(board) {
    return {
      nodes: board.nodes || [],
      groups: legacyGroupsToView(board),
      lines: legacyLinesToView(board),
      hiddenTopicRefs: clone(board.hiddenTopicRefs || []),
      collapsedTopicRefs: (board.nodes || []).filter((node) => node.collapsed).map((node) => clone(node.topicRef)),
      styleOverrides: clone(board.topicStyleOverrides || {}),
      camera: { pan: { x: Number(board.panX) || 0, y: Number(board.panY) || 0 },
        zoom: Number(board.zoom) || 1, rotation: Number(board.rotation) || 0 },
    };
  }

  function createDocument(board, path) {
    const normalized = normalizeTopicDocument({
      schemaVersion: 1,
      documentId: `legacy-board-document:${hashText(path)}`,
      defaultSurface: 'board',
      membership: {
        mode: 'manual',
        manualTopicRefs: (board.nodes || []).map((node) => clone(node.topicRef)),
        queryDefinition: null,
      },
      sources: [{ sourceId: 'local-vault' }],
      sheetViews: [],
      relationSets: [],
      boardViews: [],
      topicLayouts: [],
      lastCompleteSnapshot: null,
    }, board, path);
    normalized.boardViews[0] = global.MeldexBoardTopicViews.captureViewState(
      normalized.boardViews[0], runtimeForCapture(board),
    );
    return normalized;
  }

  function activeView(board) {
    const document = board.topicViewDocument;
    return document?.boardViews?.find((view) => view.boardViewId === board.activeBoardViewId)
      || document?.boardViews?.[0] || null;
  }

  function captureRuntime(board) {
    if (!global.MeldexBoardTopicViews) return null;
    if (!board.topicViewDocument) board.topicViewDocument = createDocument(board, board.path);
    const document = normalizeTopicDocument(board.topicViewDocument, board, board.path);
    const index = document.boardViews.findIndex((view) => view.boardViewId === board.activeBoardViewId);
    const targetIndex = index >= 0 ? index : 0;
    document.boardViews[targetIndex] = global.MeldexBoardTopicViews.captureViewState(
      document.boardViews[targetIndex], runtimeForCapture(board),
    );
    document.membership = document.membership || { mode: 'manual' };
    document.membership.manualTopicRefs = (board.nodes || []).map((node) => clone(node.topicRef));
    board.topicViewDocument = document;
    board.activeBoardViewId = document.boardViews[targetIndex].boardViewId;
    return document.boardViews[targetIndex];
  }

  function topicKey(value) {
    const ref = value?.topicRef || value;
    return JSON.stringify([String(ref?.sourceId || ''), String(ref?.topicId || '')]);
  }

  function canonicalRef(sourceId, topicId) {
    return { sourceId: String(sourceId || ''), topicId: String(topicId || '') };
  }

  function replaceTopicRef(value, replacements) {
    const replacement = replacements.get(topicKey(value));
    return replacement ? clone(replacement) : clone(value);
  }

  function replaceDocumentTopicRefs(document, replacements) {
    const next = clone(document || {});
    const membership = next.membership;
    if (Array.isArray(membership?.manualTopicRefs)) {
      membership.manualTopicRefs = membership.manualTopicRefs.map((ref) => replaceTopicRef(ref, replacements));
    }
    (next.boardViews || []).forEach((view) => {
      const positions = {};
      Object.entries(view.positionsByTopicRef || {}).forEach(([savedKey, position]) => {
        let savedRef = position?.topicRef;
        if (!savedRef) {
          try {
            const pair = JSON.parse(savedKey);
            if (Array.isArray(pair) && pair.length === 2) savedRef = canonicalRef(pair[0], pair[1]);
          } catch (_) {}
        }
        const topicRef = replaceTopicRef(savedRef, replacements);
        const key = topicKey(topicRef);
        if (!key || key === '["",""]') return;
        positions[key] = { ...clone(position), topicRef };
      });
      view.positionsByTopicRef = positions;
      (view.groups || []).forEach((group) => {
        group.topicRefs = (group.topicRefs || []).map((ref) => replaceTopicRef(ref, replacements));
      });
      (view.lines || []).forEach((line) => {
        ['fromTopicRef', 'toTopicRef'].forEach((field) => {
          if (line[field]) line[field] = replaceTopicRef(line[field], replacements);
        });
        ['fromEndpoint', 'toEndpoint'].forEach((field) => {
          if (line[field]?.targetKind === 'topic') {
            line[field].targetRef = replaceTopicRef(line[field].targetRef, replacements);
          }
        });
      });
      view.hiddenTopicRefs = (view.hiddenTopicRefs || []).map((ref) => replaceTopicRef(ref, replacements));
      view.collapsedTopicRefs = (view.collapsedTopicRefs || []).map((ref) => replaceTopicRef(ref, replacements));
    });
    (next.relationSets || []).forEach((relationSet) => {
      (relationSet.edges || []).forEach((edge) => {
        if (edge.parentTopicRef) edge.parentTopicRef = replaceTopicRef(edge.parentTopicRef, replacements);
        if (edge.childTopicRef) edge.childTopicRef = replaceTopicRef(edge.childTopicRef, replacements);
      });
    });
    (next.topicLayouts || []).forEach((layout) => {
      if (layout.topicRef) layout.topicRef = replaceTopicRef(layout.topicRef, replacements);
    });
    return next;
  }

  function recordText(record) {
    const title = String(record?.title || '無題');
    return typeof record?.note === 'string' && record.note ? `${title}\n${record.note}` : title;
  }

  function updateBoardRecordDisplays(board, detail) {
    const sourceId = String(detail?.sourceId || '');
    const byRef = new Map((detail?.topicRecords || []).map((record) => [
      topicKey(canonicalRef(sourceId, record?.topicId)), record,
    ]));
    let changed = false;
    (board.nodes || []).forEach((node) => {
      const record = byRef.get(topicKey(node.topicRef));
      if (!record) return;
      const nextText = recordText(record);
      if (node.text !== nextText) { node.text = nextText; changed = true; }
    });
    return changed;
  }

  function canonicalizeBoard(board, detail) {
    const sourceId = String(detail?.sourceId || '');
    const mapping = detail?.legacyNodeTopicIds || {};
    const replacements = new Map();
    (board.nodes || []).forEach((node) => {
      const topicId = String(mapping[node.id] || '');
      if (!sourceId || !topicId) return;
      replacements.set(topicKey(node.topicRef), canonicalRef(sourceId, topicId));
      node.topicRef = canonicalRef(sourceId, topicId);
    });
    if (replacements.size) {
      board.topicViewDocument = replaceDocumentTopicRefs(board.topicViewDocument, replacements);
      board.hiddenTopicRefs = (board.hiddenTopicRefs || []).map((ref) => replaceTopicRef(ref, replacements));
      applyView(board, activeView(board));
    }
    const displayChanged = updateBoardRecordDisplays(board, detail);
    if (replacements.size || displayChanged) redraw();
    return { replacementCount: replacements.size, displayChanged };
  }

  function installTopicRecordListener() {
    if (topicRecordListenerInstalled || typeof global.addEventListener !== 'function') return;
    topicRecordListenerInstalled = true;
    global.addEventListener('meldex:topic-records-updated', (event) => {
      for (const board of openBoards) {
        if (!board || board._topicBridgeDestroyed || !board.path) continue;
        const sourceId = String(event?.detail?.sourceId || '');
        if (!(board.nodes || []).some((node) => String(node.topicRef?.sourceId || '') === sourceId)) continue;
        canonicalizeBoard(board, event?.detail || {});
      }
    });
  }

  function installSaveHook(board) {
    if (typeof global.bdSave !== 'function') return false;
    if (global.bdSave._meldexTopicSaveHook) {
      global.bdSave._meldexTopicBoard = board;
      return true;
    }
    const original = global.bdSave;
    const wrapped = async function meldexTopicAwareBoardSave() {
      const current = wrapped._meldexTopicBoard;
      const savedPath = current?.path || '';
      const result = await original.apply(this, arguments);
      if (result === true && savedPath && !current?._topicBridgeDestroyed
          && !current?.readOnly && !current?.readonly && !current?.isReadOnly) {
        global.GbTopicLiveBridge?.scheduleAfterSave?.(savedPath, { reason: 'board-save' });
      }
      return result;
    };
    wrapped._meldexTopicSaveHook = true;
    wrapped._meldexTopicBoard = board;
    global.bdSave = wrapped;
    return true;
  }

  function viewGroupsToLegacy(board, groups) {
    const nodeByRef = new Map((board.nodes || []).map((node) => [topicKey(node.topicRef), node.id]));
    return (groups || []).map((group) => ({
      ...clone(group), id: group.groupId, groupId: group.groupId,
      nodeIds: (group.topicRefs || []).map((ref) => nodeByRef.get(topicKey(ref))).filter(Boolean),
    }));
  }

  function viewLinesToLegacy(board, lines) {
    const nodeByRef = new Map((board.nodes || []).map((node) => [topicKey(node.topicRef), node.id]));
    return (lines || []).map((line) => {
      const result = clone(line);
      ['from', 'to'].forEach((side) => {
        const endpoint = result[`${side}Endpoint`];
        if (!endpoint) return;
        delete result[side]; delete result[`${side}Point`]; delete result[`${side}Anchor`];
        if (endpoint.targetKind === 'point') result[`${side}Point`] = clone(endpoint.targetRef);
        else if (endpoint.targetKind === 'topic') {
          result[side] = nodeByRef.get(topicKey(endpoint.targetRef)) || '';
        } else if (endpoint.targetKind === 'group') {
          result[side] = typeof endpoint.targetRef === 'string'
            ? endpoint.targetRef : endpoint.targetRef?.groupId || '';
        }
        if (global.MeldexBoardOutlineEndpoints) {
          result[`${side}Anchor`] = endpoint.legacyAnchor
            || global.MeldexBoardOutlineEndpoints.outlineToLegacyAnchor(endpoint.outlinePosition);
        }
      });
      return result;
    });
  }

  function applyView(board, view) {
    if (!view || !global.MeldexBoardTopicViews) return;
    const next = global.MeldexBoardTopicViews.applyViewState(view, { nodes: board.nodes || [] });
    board.nodes = next.nodes;
    board.groups = viewGroupsToLegacy(board, view.groups);
    board.connections = viewLinesToLegacy(board, view.lines);
    board.hiddenTopicRefs = clone(view.hiddenTopicRefs || []);
    board.topicStyleOverrides = clone(view.styleOverrides || {});
    board.panX = Number(view.camera?.pan?.x) || 0;
    board.panY = Number(view.camera?.pan?.y) || 0;
    board.zoom = Number(view.camera?.zoom) || 1;
    board.rotation = Number(view.camera?.rotation) || 0;
    board.activeBoardViewId = view.boardViewId;
  }

  function hydrate(board, parsed, path) {
    if (!global.MeldexBoardTopicViews) return;
    board._topicBridgeDestroyed = false;
    openBoards.add(board);
    installTopicRecordListener();
    installSaveHook(board);
    ensureTopicRefs(board, parsed, path);
    board.topicViewDocument = parsed?.topicRuntime?.topicViewDocument
      ? normalizeTopicDocument(parsed.topicRuntime.topicViewDocument, board, path)
      : createDocument(board, path);
    board.activeBoardViewId = board.topicViewDocument.activeBoardViewId
      || board.topicViewDocument.boardViews[0].boardViewId;
    applyView(board, activeView(board));
    const bridge = global.GbTopicLiveBridge;
    if (bridge?.migrateOpenedSheet) {
      const expectedPath = path;
      board._topicMigrationPromise = bridge.migrateOpenedSheet(path, {
        owner: board,
        readOnly: !!(board.readOnly || board.readonly || board.isReadOnly),
        reason: 'board-open',
      }).then((result) => {
        if (!result?.ok || board._topicBridgeDestroyed || board.path !== expectedPath) return result;
        canonicalizeBoard(board, result.detail || {});
        return result;
      }).catch(() => ({ ok: false, status: 'fallback' }));
    } else {
      board._topicMigrationPromise = Promise.resolve({ ok: false, status: 'offline' });
    }
  }

  function destroy(board) {
    if (!board) return;
    board._topicBridgeDestroyed = true;
    openBoards.delete(board);
    global.GbTopicLiveBridge?.destroyOwner?.(board);
  }

  function serializeFrontmatter(board) {
    captureRuntime(board);
    let output = '';
    if ((board.nodes || []).some((node) => node.topicRef?.sourceId && node.topicRef?.topicId)) {
      output += `${REFS_FIELD}:\n`;
      (board.nodes || []).forEach((node, index) => {
        if (node.topicRef?.sourceId && node.topicRef?.topicId) {
          output += `  n${index}: ${JSON.stringify(JSON.stringify(node.topicRef))}\n`;
        }
      });
    }
    if (board.topicViewDocument) {
      const document = clone(board.topicViewDocument);
      document.activeBoardViewId = board.activeBoardViewId;
      output += `${FIELD}: ${JSON.stringify(JSON.stringify(document))}\n`;
    }
    return output;
  }

  function redraw() {
    global.bdRender?.();
    global.bdDrawConns?.();
    global.bdDrawFrames?.();
    global.bdTransform?.();
    global.bdSyncBoardUi?.(false);
  }

  function switchView(board, boardViewId, options) {
    captureRuntime(board);
    const target = board.topicViewDocument.boardViews.find((view) => view.boardViewId === boardViewId);
    if (!target) return false;
    if (!options?.skipUndo) global.bdPushUndo?.('ボードビューを切り替え');
    applyView(board, target);
    global.bdDirty?.();
    redraw();
    return true;
  }

  function shuffle(board) {
    const view = captureRuntime(board);
    if (!view || !global.MeldexBoardShuffle) return false;
    const selected = new Set(board.selected || []);
    const hidden = new Set((view.hiddenTopicRefs || []).map(topicKey));
    const items = (board.nodes || []).map((node) => ({ ...node, topicRef: clone(node.topicRef),
      editable: !node.readOnly, hidden: hidden.has(topicKey(node.topicRef)), visible: true }));
    const plan = global.MeldexBoardShuffle.planShuffle({
      items,
      selectedTopicRefs: items.filter((node) => selected.has(node.id)).map((node) => node.topicRef),
    });
    if (!plan.changed) return false;
    global.bdPushUndo?.('トピックをシャッフル');
    const index = board.topicViewDocument.boardViews.findIndex((item) => item.boardViewId === view.boardViewId);
    board.topicViewDocument.boardViews[index] = global.MeldexBoardShuffle.applyToBoardView(view, plan);
    applyView(board, board.topicViewDocument.boardViews[index]);
    global.bdDirty?.();
    redraw();
    return true;
  }

  function readCommonGroupTemplates() {
    try {
      const parsed = JSON.parse(global.localStorage?.getItem(COMMON_GROUP_TEMPLATES_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function writeCommonGroupTemplates(values) {
    global.localStorage?.setItem(COMMON_GROUP_TEMPLATES_KEY, JSON.stringify(values || []));
  }

  function groupTemplateLibraries(board) {
    const embedded = board?.topicViewDocument?.groupTemplateLibraries || {};
    const common = readCommonGroupTemplates();
    return {
      file: clone(Array.isArray(embedded.file) ? embedded.file : []),
      common: clone(common.length ? common : (Array.isArray(embedded.common) ? embedded.common : [])),
    };
  }

  function setGroupTemplateLibraries(board, libraries, changedScope) {
    const normalized = global.MeldexBoardGroups.normalizeLibraries(libraries);
    if (changedScope === 'common') {
      writeCommonGroupTemplates(normalized.common);
      return;
    }
    const existing = clone(board.topicViewDocument.groupTemplateLibraries || {});
    board.topicViewDocument.groupTemplateLibraries = { ...existing, file: clone(normalized.file) };
    global.bdDirty?.();
  }

  function createTemplateId() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    return `group-template-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function showGroupMessage(message, error) {
    global.showStatus?.(String(message || ''), !!error);
  }

  function createGroupUiController(board, options) {
    const groupsApi = global.MeldexBoardGroups;
    const readOnly = !!(board?.readOnly || board?.readonly || board?.isReadOnly);
    const active = () => activeView(board);
    const selectedGroup = (groupId) => (active()?.groups || []).find((group) => group.groupId === groupId) || null;
    const rejectReadOnly = () => ({ ok: false, reason: 'read-only' });
    const commitView = (view, label) => {
      if (readOnly) return false;
      const index = board.topicViewDocument.boardViews.findIndex((item) => item.boardViewId === view.boardViewId);
      if (index < 0) return false;
      global.bdPushUndo?.(label);
      board.topicViewDocument.boardViews[index] = view;
      applyView(board, view);
      global.bdDirty?.();
      redraw();
      return true;
    };
    const attempt = (callback) => {
      try { return callback(); }
      catch (error) {
        showGroupMessage(error?.message || 'グループを更新できません', true);
        return { ok: false, error };
      }
    };
    return {
      readOnly,
      listGroups: () => clone(active()?.groups || []),
      getGroup: (groupId) => clone(selectedGroup(groupId)),
      updateGroup(groupId, changes) {
        if (readOnly) return rejectReadOnly();
        return attempt(() => {
          const view = groupsApi.updateGroup(active(), groupId, changes);
          return { ok: commitView(view, 'グループ設定を変更'), group: clone(selectedGroup(groupId)) };
        });
      },
      listTemplates() {
        const libraries = groupTemplateLibraries(board);
        return ['file', 'common'].flatMap((scope) => libraries[scope].map((template) => ({ scope, ...clone(template) })));
      },
      getTemplate(scope, templateId) {
        return this.listTemplates().find((template) => template.scope === scope && template.templateId === templateId) || null;
      },
      saveGroupTemplate(scope, groupId, name) {
        if (readOnly) return rejectReadOnly();
        return attempt(() => {
          const group = selectedGroup(groupId);
          if (!group) throw new Error('グループが見つかりません');
          const saved = groupsApi.saveTemplate(groupTemplateLibraries(board), scope, group, {
            idFactory: options?.idFactory || createTemplateId,
            name: String(name || group.name || 'グループテンプレート').trim(),
          });
          setGroupTemplateLibraries(board, saved.libraries, scope);
          showGroupMessage('グループテンプレートを保存しました');
          return { ok: true, template: saved.template };
        });
      },
      renameTemplate(scope, templateId, name) {
        if (readOnly) return rejectReadOnly();
        return attempt(() => {
          const libraries = groupsApi.updateTemplate(groupTemplateLibraries(board), scope, templateId, { name: String(name || '').trim() });
          setGroupTemplateLibraries(board, libraries, scope);
          return { ok: true };
        });
      },
      deleteTemplate(scope, templateId) {
        if (readOnly) return rejectReadOnly();
        return attempt(() => {
          const libraries = groupsApi.removeTemplate(groupTemplateLibraries(board), scope, templateId);
          setGroupTemplateLibraries(board, libraries, scope);
          return { ok: true };
        });
      },
      duplicateTemplate(scope, templateId) {
        if (readOnly) return rejectReadOnly();
        return attempt(() => {
          const source = this.getTemplate(scope, templateId);
          const saved = groupsApi.duplicateTemplate(groupTemplateLibraries(board), scope, templateId, {
            idFactory: options?.idFactory || createTemplateId,
            name: `${source?.name || 'グループ'} のコピー`,
          });
          setGroupTemplateLibraries(board, saved.libraries, scope);
          return { ok: true, template: saved.template };
        });
      },
      applyGroupTemplate(scope, templateId, groupId) {
        if (readOnly) return rejectReadOnly();
        return attempt(() => {
          const template = this.getTemplate(scope, templateId);
          if (!template) throw new Error('グループテンプレートが見つかりません');
          const view = groupsApi.applyTemplate(active(), groupId, template);
          return { ok: commitView(view, 'グループテンプレートを適用') };
        });
      },
    };
  }

  function groupStyleField(root, labelText, key, value, type, onChange) {
    const label = document.createElement('label'); label.textContent = labelText;
    const input = document.createElement('input'); input.type = type || 'text';
    if (type === 'checkbox') input.checked = !!value;
    else input.value = value == null ? '' : String(value);
    input.dataset.groupStyleField = key;
    input.addEventListener('change', () => onChange(type === 'checkbox' ? input.checked : input.value));
    label.appendChild(input); root.appendChild(label);
  }

  function mountGroupControls(root, board, options) {
    if (!root?.appendChild || !global.MeldexBoardGroups) return null;
    const controller = createGroupUiController(board, options);
    if (controller.readOnly) return null;
    root.querySelectorAll?.('[data-bd-group-manager]').forEach((element) => element.remove());
    const details = document.createElement('details');
    details.className = 'bd-topic-view-overflow bd-group-manager';
    details.dataset.bdGroupManager = 'true';
    const summary = document.createElement('summary'); summary.textContent = 'グループ'; details.appendChild(summary);
    const panel = document.createElement('div'); panel.className = 'bd-topic-view-overflow-menu'; details.appendChild(panel);
    const groupSelect = document.createElement('select'); groupSelect.setAttribute('aria-label', '編集するグループ');
    const templateSelect = document.createElement('select'); templateSelect.setAttribute('aria-label', 'グループテンプレート');
    const templateName = document.createElement('input'); templateName.placeholder = 'テンプレート名';
    const scopeSelect = document.createElement('select');
    [['file', 'このファイル'], ['common', '共通']].forEach(([value, label]) => {
      const option = document.createElement('option'); option.value = value; option.textContent = label; scopeSelect.appendChild(option);
    });
    const optionsHost = document.createElement('div');
    const refreshOptions = () => {
      const group = controller.getGroup(groupSelect.value);
      if (!group) { optionsHost.replaceChildren(); return; }
      const section = global.MeldexBoardGroups.renderOptionsTab(optionsHost, group, {
        onChange: (groupId, changes) => { controller.updateGroup(groupId, changes); refreshAll(); },
      });
      const applyStyle = (key, value) => {
        const current = controller.getGroup(group.groupId);
        controller.updateGroup(group.groupId, {
          styleOverrides: { ...(current?.styleOverrides || {}), [key]: value },
        });
      };
      [['背景色', 'background', group.styleOverrides?.background, 'color'],
        ['透明度', 'opacity', group.styleOverrides?.opacity, 'number'],
        ['枠色', 'borderColor', group.styleOverrides?.borderColor, 'color'],
        ['枠幅', 'borderWidth', group.styleOverrides?.borderWidth, 'number'],
        ['線種', 'borderStyle', group.styleOverrides?.borderStyle, 'text'],
        ['角丸', 'borderRadius', group.styleOverrides?.borderRadius, 'number'],
        ['影', 'shadow', group.styleOverrides?.shadow, 'text'],
        ['内側余白', 'padding', group.styleOverrides?.padding, 'number'],
        ['ラベルサイズ', 'labelFontSize', group.styleOverrides?.labelFontSize, 'number']]
        .forEach(([label, key, value, type]) => groupStyleField(section, label, key, value, type, (next) => applyStyle(key, next)));
      groupStyleField(section, 'ロック', 'locked', group.locked, 'checkbox', (value) => controller.updateGroup(group.groupId, { locked: value }));
      groupStyleField(section, '折りたたむ', 'collapsed', group.collapsed, 'checkbox', (value) => controller.updateGroup(group.groupId, { collapsed: value }));
    };
    const refreshTemplates = () => {
      templateSelect.replaceChildren();
      controller.listTemplates().forEach((template) => {
        const option = document.createElement('option');
        option.value = `${template.scope}:${template.templateId}`;
        option.textContent = `${template.scope === 'file' ? 'ファイル' : '共通'}: ${template.name}`;
        templateSelect.appendChild(option);
      });
      const selected = controller.listTemplates().find((template) => `${template.scope}:${template.templateId}` === templateSelect.value);
      templateName.value = selected?.name || templateName.value;
    };
    const refreshAll = () => {
      const selectedId = groupSelect.value;
      groupSelect.replaceChildren();
      controller.listGroups().forEach((group) => {
        const option = document.createElement('option'); option.value = group.groupId; option.textContent = group.name;
        groupSelect.appendChild(option);
      });
      if (controller.getGroup(selectedId)) groupSelect.value = selectedId;
      refreshTemplates(); refreshOptions();
    };
    const selectedTemplate = () => {
      const [scope, ...parts] = String(templateSelect.value || '').split(':');
      return { scope, templateId: parts.join(':') };
    };
    const button = (text, action) => {
      const element = document.createElement('button'); element.type = 'button'; element.textContent = text;
      element.addEventListener('click', async () => { await action(); refreshAll(); }); panel.appendChild(element);
    };
    panel.append(groupSelect, optionsHost, scopeSelect, templateName, templateSelect);
    groupSelect.addEventListener('change', refreshOptions);
    templateSelect.addEventListener('change', () => { templateName.value = controller.getTemplate(selectedTemplate().scope, selectedTemplate().templateId)?.name || ''; });
    button('現在値を保存', () => controller.saveGroupTemplate(scopeSelect.value, groupSelect.value, templateName.value));
    button('適用', () => { const value = selectedTemplate(); controller.applyGroupTemplate(value.scope, value.templateId, groupSelect.value); });
    button('名前変更', () => { const value = selectedTemplate(); controller.renameTemplate(value.scope, value.templateId, templateName.value); });
    button('複製', () => { const value = selectedTemplate(); controller.duplicateTemplate(value.scope, value.templateId); });
    button('削除', async () => {
      const value = selectedTemplate();
      const template = controller.getTemplate(value.scope, value.templateId);
      if (!template) return;
      const confirmed = typeof global.cfConfirm === 'function'
        ? await global.cfConfirm(`グループテンプレート「${template.name}」を削除しますか？`)
        : false;
      if (confirmed) controller.deleteTemplate(value.scope, value.templateId);
    });
    root.appendChild(details);
    refreshAll();
    return { root: details, controller, refresh: refreshAll };
  }

  function mountToolbar(board) {
    const boardRoot = global._bdToolbarRoot?.();
    const root = boardRoot?.nodeType === 1
      ? (boardRoot.querySelector?.('[data-bd-role="toolbar-top"]') || boardRoot)
      : null;
    const views = global.MeldexBoardTopicViews;
    if (!root || !views || !board.topicViewDocument) return null;
    root.querySelectorAll('[data-bd-topic-view-controls]').forEach((element) => element.remove());
    let toolbar = null;
    const controller = views.createController({
      getDocument: () => board.topicViewDocument,
      setDocument: (document) => { board.topicViewDocument = document; },
      pushUndo: (label) => global.bdPushUndo?.(label),
      onChange: (_document, result) => {
        const nextId = result?.activeBoardViewId || board.activeBoardViewId;
        if (nextId) switchView(board, nextId, { skipUndo: true });
        global.bdDirty?.();
        toolbar?.refresh?.();
      },
    });
    toolbar = views.attachToolbar(root, controller, {
      getDocument: () => board.topicViewDocument,
      getActiveBoardViewId: () => board.activeBoardViewId,
      setActiveBoardViewId: (id) => { switchView(board, id); toolbar?.refresh?.(); },
    });
    global.MeldexBoardShuffle?.attachShuffleAction(toolbar?.root, () => shuffle(board));
    toolbar.groupControls = mountGroupControls(root, board);
    return toolbar;
  }

  global.MeldexBoardTopicIntegration = Object.freeze({
    parseFrontmatter, hydrate, canonicalizeBoard, captureRuntime, serializeFrontmatter,
    switchView, shuffle, mountToolbar, createGroupUiController, mountGroupControls,
    installSaveHook, destroy,
  });
}(typeof globalThis !== 'undefined' ? globalThis : window));
