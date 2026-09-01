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

  function normalizePath(value) {
    return String(value || '').trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '');
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
    const membershipRefs = Array.isArray(membership.manualTopicRefs)
      ? membership.manualTopicRefs
      : (Array.isArray(membership.topicRefs) ? membership.topicRefs : refs);
    // 旧ボードや保存途中の文書には、削除済みカードに対応するnull/空TopicRefが
    // membershipへ残ることがある。厳格な共通契約へ渡す前に、安定IDが揃う参照だけへ
    // 収斂させる（タイトル等から別Topicを捏造しない）。
    membership.manualTopicRefs = clone(membershipRefs.filter(
      (ref) => ref && typeof ref === 'object'
        && typeof ref.sourceId === 'string' && ref.sourceId.trim()
        && typeof ref.topicId === 'string' && ref.topicId.trim(),
    ));
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
    const normalized = global.MeldexTopicViewDocument?.normalizeDocument
      ? global.MeldexTopicViewDocument.normalizeDocument(boardNormalized)
      : boardNormalized;
    // 新規カードを作成した直後の初回保存では、ライン端点が安定TopicRefへ移行する前の
    // node id文字列で保存された版がある。ノード側のTopicRefを確定した後なら安全に対応付け
    // できるため、読込時に全ビューのライン端点を同じ正規化経路へ通して再描画可能にする。
    if (global.MeldexBoardOutlineEndpoints) {
      const refsByLegacyId = Object.fromEntries((board?.nodes || [])
        .filter(node => node?.id && node?.topicRef?.sourceId && node?.topicRef?.topicId)
        .map(node => [node.id, node.topicRef]));
      (normalized.boardViews || []).forEach((view) => {
        view.lines = (view.lines || []).map(line => (
          global.MeldexBoardOutlineEndpoints.normalizeLine(line, refsByLegacyId)
        ));
      });
    }
    return normalized;
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
      boardViews: [{
        boardViewId: `board-view:${hashText(path)}`, name: '既定ビュー', relationSetId: null,
        positionsByTopicRef: {}, groups: [], lines: [], hiddenTopicRefs: [], collapsedTopicRefs: [],
        styleOverrides: {}, camera: { pan: { x: 0, y: 0 }, zoom: 1, rotation: 0 },
      }],
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
    // hydrate後に追加されたカードにも、ビューとラインを保存する前に安定TopicRefを付与する。
    // これが無いと初回保存だけ端点targetRefが一時的なnode idのまま残り、再読込時に
    // viewLinesToLegacyが接続元・接続先を解決できない。
    ensureTopicRefs(board, null, board.path);
    if (!global.MeldexBoardTopicViews) return null;
    if (!board.topicViewDocument) board.topicViewDocument = createDocument(board, board.path);
    const document = normalizeTopicDocument(board.topicViewDocument, board, board.path);
    if (!document.boardViews.length) {
      document.membership = document.membership || { mode: 'manual' };
      document.membership.manualTopicRefs = (board.nodes || []).map((node) => clone(node.topicRef));
      board.topicViewDocument = document;
      board.activeBoardViewId = null;
      return null;
    }
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
    const byRef = new Map((detail?.topicRecords || []).map((record) => [
      topicKey(record?.topicRef || canonicalRef(detail?.sourceId, record?.topicId)), record,
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

  function reconcileBoardPlacements(board, detail) {
    if (!detail?.viewDocument || normalizePath(board.path) !== normalizePath(detail.dbPath || detail.legacyPath)) {
      return false;
    }
    const document = normalizeTopicDocument(detail.viewDocument, board, board.path);
    const activeId = board.activeBoardViewId || document.activeBoardViewId
      || document.boardViews?.[0]?.boardViewId;
    const placements = (document.placements || []).filter(item => item?.surface === 'board'
      && (!activeId || String(item.viewId) === String(activeId)));
    const allowed = new Set(placements.map(item => topicKey(item.topicRef)));
    const records = new Map((detail.topicRecords || []).map(record => [
      topicKey(record?.topicRef || canonicalRef(detail.sourceId, record?.topicId)), record,
    ]));
    const existing = new Map((board.nodes || []).filter(node => node?.topicRef)
      .map(node => [topicKey(node.topicRef), node]));
    const unbound = (board.nodes || []).filter(node => !node?.topicRef);
    const nodes = [];
    placements.forEach((placement, index) => {
      const key = topicKey(placement.topicRef);
      const record = records.get(key);
      const position = placement.position || placement.boardPosition || {};
      let node = existing.get(key);
      if (!node) {
        const id = `topic-${hashText(key)}`;
        const x = Number.isFinite(+position.x) ? +position.x : 40 + (index % 5) * 180;
        const y = Number.isFinite(+position.y) ? +position.y : 40 + Math.floor(index / 5) * 100;
        node = typeof global.bdNode === 'function'
          ? global.bdNode(recordText(record), x, y, position.w, position.h, { id, topicRef: clone(placement.topicRef) })
          : { id, text: recordText(record), x, y, w: position.w || 160, h: position.h || 0,
            topicRef: clone(placement.topicRef) };
      } else {
        node.topicRef = clone(placement.topicRef);
        if (record) node.text = recordText(record);
        if (Number.isFinite(+position.x)) node.x = +position.x;
        if (Number.isFinite(+position.y)) node.y = +position.y;
      }
      node._topicCanonicalOnly = (record?.originDocumentId
        && record.originDocumentId !== document.documentId)
        || (record?.topicRef?.sourceId && record.topicRef.sourceId !== detail.sourceId);
      node._topicReadOnly = detail.readOnly === true;
      nodes.push(node);
    });
    board.nodes = [...unbound, ...nodes];
    board.topicViewDocument = document;
    board.activeBoardViewId = activeId;
    applyView(board, activeView(board));
    return true;
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
    const placementsChanged = reconcileBoardPlacements(board, detail);
    const displayChanged = updateBoardRecordDisplays(board, detail);
    if (replacements.size || placementsChanged || displayChanged) redraw();
    return { replacementCount: replacements.size, placementsChanged, displayChanged };
  }

  function installTopicRecordListener() {
    if (topicRecordListenerInstalled || typeof global.addEventListener !== 'function') return;
    topicRecordListenerInstalled = true;
    global.addEventListener('meldex:topic-records-updated', (event) => {
      for (const board of openBoards) {
        if (!board || board._topicBridgeDestroyed || !board.path) continue;
        const sourceId = String(event?.detail?.sourceId || '');
        const samePath = normalizePath(board.path) === normalizePath(
          event?.detail?.dbPath || event?.detail?.legacyPath,
        );
        if (!samePath && !(board.nodes || []).some((node) => String(node.topicRef?.sourceId || '') === sourceId)) continue;
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
      if (current?.readOnly || current?.readonly || current?.isReadOnly) {
        global.showStatus?.('読み取り専用のボードは保存できません', true);
        return false;
      }
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
    const readOnly = !!(board?.readOnly || board?.readonly || board?.isReadOnly);
    if (!readOnly) captureRuntime(board);
    const target = board.topicViewDocument.boardViews.find((view) => view.boardViewId === boardViewId);
    if (!target) return false;
    if (!readOnly && !options?.skipUndo) global.bdPushUndo?.('ボードビューを切り替え');
    applyView(board, target);
    if (!readOnly) global.bdDirty?.();
    redraw();
    return true;
  }

  function shuffle(board) {
    if (board?.readOnly || board?.readonly || board?.isReadOnly) return false;
    const view = captureRuntime(board);
    if (!view || !global.MeldexBoardShuffle) return false;
    const selected = new Set(board.selected || []);
    const hidden = new Set((view.hiddenTopicRefs || []).map(topicKey));
    const items = (board.nodes || []).map((node) => ({ ...node, topicRef: clone(node.topicRef),
      editable: !node.readOnly, locked: node.locked === true,
      hidden: hidden.has(topicKey(node.topicRef)), visible: true }));
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

  function setGroupTemplateLibraries(board, libraries, changedScope, historyLabel) {
    const normalized = global.MeldexBoardGroups.normalizeLibraries(libraries);
    if (changedScope === 'common') {
      const before = global.captureLocalStorageSettings?.([COMMON_GROUP_TEMPLATES_KEY]);
      writeCommonGroupTemplates(normalized.common);
      const after = global.captureLocalStorageSettings?.([COMMON_GROUP_TEMPLATES_KEY]);
      global.pushLocalStorageSettingsHistory?.(
        historyLabel || '共通グループテンプレートを変更',
        before,
        after,
        '全ボード共通のテンプレート設定',
        redraw,
      );
      return;
    }
    global.bdPushUndo?.(historyLabel || 'グループテンプレートを変更');
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
    const commitDocument = (documentValue, label) => {
      if (readOnly) return false;
      global.bdPushUndo?.(label);
      board.topicViewDocument = groupsApi.normalizeGroupStyles(documentValue);
      const view = activeView(board);
      if (view) applyView(board, view);
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
      listGroupStyles: () => clone(groupsApi.normalizeGroupStyles(board.topicViewDocument).groupStyles),
      getGroupStyle: (groupStyleId) => clone(groupsApi.normalizeGroupStyles(board.topicViewDocument).groupStyles
        .find(style => style.groupStyleId === groupStyleId) || null),
      createGroupStyle(name, groupId) {
        if (readOnly) return rejectReadOnly();
        return attempt(() => {
          const group = selectedGroup(groupId);
          const saved = groupsApi.createGroupStyle(board.topicViewDocument, {
            name: String(name || 'グループスタイル').trim(),
            visualStyle: group ? groupsApi.resolveGroupStyle(board.topicViewDocument, group) : {},
          }, options?.idFactory || createTemplateId);
          commitDocument(saved.document, 'グループスタイルを作成');
          return { ok: true, groupStyle: saved.groupStyle };
        });
      },
      updateGroupStyle(groupStyleId, changes) {
        if (readOnly) return rejectReadOnly();
        return attempt(() => ({ ok: commitDocument(
          groupsApi.updateGroupStyle(board.topicViewDocument, groupStyleId, changes), 'グループスタイルを変更',
        ) }));
      },
      duplicateGroupStyle(groupStyleId) {
        if (readOnly) return rejectReadOnly();
        return attempt(() => {
          const saved = groupsApi.duplicateGroupStyle(board.topicViewDocument, groupStyleId, {}, options?.idFactory || createTemplateId);
          commitDocument(saved.document, 'グループスタイルを複製');
          return { ok: true, groupStyle: saved.groupStyle };
        });
      },
      setActiveGroupStyle(groupStyleId) {
        if (readOnly) return rejectReadOnly();
        return attempt(() => {
          const next = groupsApi.normalizeGroupStyles(board.topicViewDocument);
          if (!next.groupStyles.some(style => style.groupStyleId === groupStyleId)) throw new Error('グループスタイルが見つかりません');
          next.activeGroupStyleId = groupStyleId;
          return { ok: commitDocument(next, '既定グループスタイルを変更') };
        });
      },
      applyGroupStyle(groupStyleId, groupId) {
        if (readOnly) return rejectReadOnly();
        return attempt(() => ({ ok: commitView(groupsApi.applyGroupStyle(active(), groupId, groupStyleId), 'グループスタイルを適用') }));
      },
      clearGroupOverrides(groupId) {
        if (readOnly) return rejectReadOnly();
        return attempt(() => ({ ok: commitView(groupsApi.updateGroup(active(), groupId, { styleOverrides: {} }), 'グループの個別上書きを解除') }));
      },
      promoteGroupOverrides(groupId) {
        if (readOnly) return rejectReadOnly();
        return attempt(() => {
          const group = selectedGroup(groupId);
          if (!group?.styleRef) throw new Error('先に名前付きグループスタイルを適用してください');
          const style = this.getGroupStyle(group.styleRef);
          const nextDoc = groupsApi.updateGroupStyle(board.topicViewDocument, group.styleRef, {
            visualStyle: { ...(style?.visualStyle || {}), ...(group.styleOverrides || {}) },
          });
          commitDocument(nextDoc, '個別上書きをグループスタイルへ反映');
          return { ok: commitView(groupsApi.updateGroup(active(), groupId, { styleOverrides: {} }), 'グループの個別上書きを解除') };
        });
      },
      removeGroupStyle(groupStyleId, mode, replacementId) {
        if (readOnly) return rejectReadOnly();
        return attempt(() => {
          const result = groupsApi.removeGroupStyle(board.topicViewDocument, groupStyleId, { mode, replacementId });
          if (result.confirmationRequired) return { ok: false, ...result };
          return { ok: commitDocument(result.document, 'グループスタイルを削除'), ...result };
        });
      },
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
          setGroupTemplateLibraries(board, saved.libraries, scope, 'グループテンプレートを保存');
          showGroupMessage('グループテンプレートを保存しました');
          return { ok: true, template: saved.template };
        });
      },
      renameTemplate(scope, templateId, name) {
        if (readOnly) return rejectReadOnly();
        return attempt(() => {
          const libraries = groupsApi.updateTemplate(groupTemplateLibraries(board), scope, templateId, { name: String(name || '').trim() });
          setGroupTemplateLibraries(board, libraries, scope, 'グループテンプレート名を変更');
          return { ok: true };
        });
      },
      deleteTemplate(scope, templateId) {
        if (readOnly) return rejectReadOnly();
        return attempt(() => {
          const libraries = groupsApi.removeTemplate(groupTemplateLibraries(board), scope, templateId);
          setGroupTemplateLibraries(board, libraries, scope, 'グループテンプレートを削除');
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
          setGroupTemplateLibraries(board, saved.libraries, scope, 'グループテンプレートを複製');
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
    const input = document.createElement('input'); input.type = type === 'opacity-percent' ? 'number' : (type || 'text');
    if (type === 'checkbox') input.checked = !!value;
    else if (type === 'opacity-percent') {
      input.min = '0'; input.max = '100'; input.step = '1';
      input.value = String(Math.round((value == null ? 1 : Math.max(0, Math.min(1, Number(value) || 0))) * 100));
    } else input.value = value == null ? '' : String(value);
    input.dataset.groupStyleField = key;
    input.addEventListener('change', () => onChange(type === 'checkbox'
      ? input.checked
      : type === 'opacity-percent'
        ? Math.max(0, Math.min(100, Number(input.value) || 0)) / 100
        : input.value));
    label.appendChild(input); root.appendChild(label);
  }

  function mountGroupControls(root, board, options) {
    if (!root?.appendChild || !global.MeldexBoardGroups) return null;
    const controller = createGroupUiController(board, options);
    if (controller.readOnly) return null;
    const panelMode = options?.panel === true;
    root.querySelectorAll?.('[data-bd-group-manager]').forEach((element) => element.remove());
    const details = document.createElement(panelMode ? 'section' : 'details');
    details.className = panelMode
      ? 'bd-group-manager bd-group-manager--panel'
      : 'bd-topic-view-overflow bd-group-manager';
    details.dataset.bdGroupManager = 'true';
    details.dataset.e2eId = 'board-group-manager';
    if (!panelMode) {
      const summary = document.createElement('summary'); summary.textContent = 'グループ'; details.appendChild(summary);
    }
    const panel = document.createElement('div');
    panel.className = panelMode ? 'bd-group-manager-panel' : 'bd-topic-view-overflow-menu';
    details.appendChild(panel);
    const labeledControl = (labelText, control) => {
      const label = document.createElement('label');
      label.className = 'bd-group-manager-field';
      const caption = document.createElement('span'); caption.textContent = labelText;
      label.append(caption, control);
      return label;
    };
    const groupSelect = document.createElement('select'); groupSelect.setAttribute('aria-label', '編集するグループ');
    groupSelect.dataset.e2eId = 'board-group-manager-group';
    const templateSelect = document.createElement('select'); templateSelect.setAttribute('aria-label', 'グループテンプレート');
    templateSelect.dataset.e2eId = 'board-group-manager-template';
    const templateName = document.createElement('input'); templateName.placeholder = 'テンプレート名';
    templateName.dataset.e2eId = 'board-group-manager-template-name';
    const scopeSelect = document.createElement('select');
    scopeSelect.setAttribute('aria-label', 'テンプレートの保存範囲');
    scopeSelect.dataset.e2eId = 'board-group-manager-scope';
    [['file', 'このファイル'], ['common', '共通']].forEach(([value, label]) => {
      const option = document.createElement('option'); option.value = value; option.textContent = label; scopeSelect.appendChild(option);
    });
    const optionsHost = document.createElement('div');
    const styleManager = document.createElement('fieldset');
    styleManager.className = 'bd-group-style-manager';
    styleManager.dataset.bdGroupStyleManager = 'true';
    const styleLegend = document.createElement('legend'); styleLegend.textContent = 'グループスタイル'; styleManager.appendChild(styleLegend);
    const styleSelect = document.createElement('select'); styleSelect.setAttribute('aria-label', '名前付きグループスタイル');
    styleSelect.dataset.e2eId = 'board-group-style-select';
    const styleName = document.createElement('input'); styleName.placeholder = 'グループスタイル名';
    styleName.dataset.e2eId = 'board-group-style-name';
    const styleFields = document.createElement('div'); styleFields.className = 'bd-group-style-fields';
    const styleActions = document.createElement('div'); styleActions.className = 'bd-group-style-actions';
    styleManager.append(
      labeledControl('スタイル', styleSelect),
      labeledControl('名前', styleName),
      styleFields,
      styleActions,
    );
    const templateManager = document.createElement('fieldset');
    templateManager.className = 'bd-group-template-manager';
    const templateLegend = document.createElement('legend'); templateLegend.textContent = 'グループテンプレート';
    const templateActions = document.createElement('div'); templateActions.className = 'bd-group-template-actions';
    templateManager.append(
      templateLegend,
      labeledControl('保存範囲', scopeSelect),
      labeledControl('名前', templateName),
      labeledControl('テンプレート', templateSelect),
      templateActions,
    );
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
        ['背景不透明度', 'backgroundOpacity', group.styleOverrides?.backgroundOpacity, 'opacity-percent'],
        ['透明度', 'opacity', group.styleOverrides?.opacity, 'number'],
        ['枠色', 'borderColor', group.styleOverrides?.borderColor, 'color'],
        ['枠線不透明度', 'borderOpacity', group.styleOverrides?.borderOpacity, 'opacity-percent'],
        ['枠幅', 'borderWidth', group.styleOverrides?.borderWidth, 'number'],
        ['線種', 'borderStyle', group.styleOverrides?.borderStyle, 'text'],
        ['角丸', 'borderRadius', group.styleOverrides?.borderRadius, 'number'],
        ['影', 'shadow', group.styleOverrides?.shadow, 'text'],
        ['内側余白', 'padding', group.styleOverrides?.padding, 'number'],
        ['ラベル色', 'labelColor', group.styleOverrides?.labelColor, 'color'],
        ['ラベルサイズ', 'labelFontSize', group.styleOverrides?.labelFontSize, 'number'],
        ['ラベルフォント', 'labelFontFamily', group.styleOverrides?.labelFontFamily, 'text'],
        ['ラベル太字', 'labelBold', group.styleOverrides?.labelBold, 'checkbox']]
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
    const refreshStyles = () => {
      const previous = styleSelect.value;
      styleSelect.replaceChildren();
      controller.listGroupStyles().forEach(style => {
        const option = document.createElement('option'); option.value = style.groupStyleId;
        option.textContent = `${board.topicViewDocument.activeGroupStyleId === style.groupStyleId ? '★ ' : ''}${style.name}`;
        styleSelect.appendChild(option);
      });
      if (controller.getGroupStyle(previous)) styleSelect.value = previous;
      const selected = controller.getGroupStyle(styleSelect.value);
      styleName.value = selected?.name || '';
      styleFields.replaceChildren();
      if (!selected) return;
      const updateVisual = (key, value) => controller.updateGroupStyle(selected.groupStyleId, {
        visualStyle: { ...(controller.getGroupStyle(selected.groupStyleId)?.visualStyle || {}), [key]: value },
      });
      [['背景色', 'background', 'color'], ['背景不透明度', 'backgroundOpacity', 'opacity-percent'], ['透明度', 'opacity', 'number'], ['枠色', 'borderColor', 'color'], ['枠線不透明度', 'borderOpacity', 'opacity-percent'],
        ['枠幅', 'borderWidth', 'number'], ['線種', 'borderStyle', 'text'], ['角丸', 'borderRadius', 'number'],
        ['影', 'shadow', 'text'], ['内側余白', 'padding', 'number'], ['ラベル色', 'labelColor', 'color'],
        ['ラベルサイズ', 'labelFontSize', 'number'], ['ラベルフォント', 'labelFontFamily', 'text'],
        ['ラベル太字', 'labelBold', 'checkbox']]
        .forEach(([label, key, type]) => groupStyleField(styleFields, label, key, selected.visualStyle?.[key], type,
          value => { updateVisual(key, value); refreshAll(); }));
    };
    const refreshAll = () => {
      const selectedId = groupSelect.value;
      groupSelect.replaceChildren();
      controller.listGroups().forEach((group) => {
        const option = document.createElement('option'); option.value = group.groupId; option.textContent = group.name;
        groupSelect.appendChild(option);
      });
      if (controller.getGroup(selectedId)) groupSelect.value = selectedId;
      refreshTemplates(); refreshStyles(); refreshOptions();
    };
    const selectedTemplate = () => {
      const [scope, ...parts] = String(templateSelect.value || '').split(':');
      return { scope, templateId: parts.join(':') };
    };
    const button = (text, e2eId, action) => {
      const element = document.createElement('button'); element.type = 'button'; element.textContent = text;
      element.dataset.e2eId = e2eId;
      element.addEventListener('click', async () => { await action(); refreshAll(); }); templateActions.appendChild(element);
    };
    panel.append(labeledControl('編集するグループ', groupSelect), optionsHost, styleManager, templateManager);
    groupSelect.addEventListener('change', refreshOptions);
    templateSelect.addEventListener('change', () => { templateName.value = controller.getTemplate(selectedTemplate().scope, selectedTemplate().templateId)?.name || ''; });
    styleSelect.addEventListener('change', refreshStyles);
    const styleButton = (text, e2eId, action) => {
      const element = document.createElement('button'); element.type = 'button'; element.textContent = text;
      element.dataset.e2eId = e2eId;
      element.addEventListener('click', async () => { await action(); refreshAll(); });
      styleActions.appendChild(element);
    };
    styleButton('作成', 'board-group-style-create', () => controller.createGroupStyle(styleName.value || 'グループスタイル', groupSelect.value));
    styleButton('適用', 'board-group-style-apply', () => controller.applyGroupStyle(styleSelect.value, groupSelect.value));
    styleButton('既定', 'board-group-style-default', () => controller.setActiveGroupStyle(styleSelect.value));
    styleButton('名前変更', 'board-group-style-rename', () => controller.updateGroupStyle(styleSelect.value, { name: styleName.value }));
    styleButton('複製', 'board-group-style-duplicate', () => controller.duplicateGroupStyle(styleSelect.value));
    styleButton('上書きを反映', 'board-group-style-promote', () => controller.promoteGroupOverrides(groupSelect.value));
    styleButton('上書きを解除', 'board-group-style-clear-overrides', () => controller.clearGroupOverrides(groupSelect.value));
    styleButton('削除', 'board-group-style-delete', async () => {
      const style = controller.getGroupStyle(styleSelect.value);
      if (!style) return;
      const affected = controller.removeGroupStyle(style.groupStyleId);
      if (affected?.confirmationRequired) {
        const confirmed = typeof global.cfConfirm === 'function'
          ? await global.cfConfirm(`グループスタイル「${style.name}」を削除します。使用中の${affected.affectedGroupCount}件は現在の見た目を個別値として保持しますか？`)
          : false;
        if (confirmed) controller.removeGroupStyle(style.groupStyleId, 'preserve');
      }
    });
    button('現在値を保存', 'board-group-template-save', () => controller.saveGroupTemplate(scopeSelect.value, groupSelect.value, templateName.value));
    button('適用', 'board-group-template-apply', () => { const value = selectedTemplate(); controller.applyGroupTemplate(value.scope, value.templateId, groupSelect.value); });
    button('名前変更', 'board-group-template-rename', () => { const value = selectedTemplate(); controller.renameTemplate(value.scope, value.templateId, templateName.value); });
    button('複製', 'board-group-template-duplicate', () => { const value = selectedTemplate(); controller.duplicateTemplate(value.scope, value.templateId); });
    button('削除', 'board-group-template-delete', async () => {
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

  function teardownMixedSheetView(board) {
    try { board?._mixedSheetViewHost?.destroy?.(); } catch {}
    if (board) board._mixedSheetViewHost = null;
    const root = global._bdToolbarRoot?.();
    root?.querySelector?.('[data-bd-mixed-sheet-host]')?.remove();
    root?.querySelector?.('[data-bd-mixed-view-empty]')?.remove();
    root?.querySelector?.('[data-bd-role="canvas"]')?.removeAttribute('hidden');
  }

  function showMixedViewEmptyState(board) {
    const root = global._bdToolbarRoot?.();
    const canvas = root?.querySelector?.('[data-bd-role="canvas"]');
    if (!root || !canvas) return false;
    teardownMixedSheetView(board);
    canvas.hidden = true;
    const empty = document.createElement('section');
    empty.className = 'bd-mixed-view-empty-host'; empty.dataset.bdMixedViewEmpty = 'true';
    empty.setAttribute('role', 'status');
    empty.innerHTML = '<strong>ビューがありません</strong><span>上の＋からテーブル、ツリー、またはボードを追加してください。</span>';
    root.appendChild(empty);
    return true;
  }

  function switchMixedView(board, ref, options) {
    if (!board?.topicViewDocument || !ref?.surface || !ref?.viewId) return false;
    const readOnly = !!(board.readOnly || board.readonly || board.isReadOnly);
    const documentValue = normalizeTopicDocument(board.topicViewDocument, board, board.path);
    const exists = ref.surface === 'board'
      ? documentValue.boardViews.some(view => view.boardViewId === ref.viewId)
      : documentValue.sheetViews.some(view => view.viewId === ref.viewId);
    if (!exists) return false;
    if (ref.surface === 'board') {
      teardownMixedSheetView(board);
      documentValue.activeViewRef = { surface: 'board', viewId: ref.viewId };
      documentValue.activeBoardViewId = ref.viewId;
      board.topicViewDocument = documentValue;
      return switchView(board, ref.viewId, options);
    }
    if (!readOnly && board.activeBoardViewId && documentValue.boardViews.length) captureRuntime(board);
    board.topicViewDocument.activeViewRef = { surface: 'sheet', viewId: ref.viewId };
    board.topicViewDocument.activeSheetViewId = ref.viewId;
    const root = global._bdToolbarRoot?.();
    const canvas = root?.querySelector?.('[data-bd-role="canvas"]');
    if (!root || !canvas) return false;
    teardownMixedSheetView(board);
    canvas.hidden = true;
    const hostElement = document.createElement('section');
    hostElement.className = 'bd-mixed-sheet-host'; hostElement.dataset.bdMixedSheetHost = 'true';
    hostElement.setAttribute('aria-label', 'シートビュー');
    const status = document.createElement('div'); status.className = 'bd-mixed-sheet-status'; status.textContent = 'シートビューを読み込んでいます';
    const mountPoint = document.createElement('div'); mountPoint.className = 'bd-mixed-sheet-mount';
    hostElement.append(status, mountPoint); root.appendChild(hostElement);
    if (!global.MeldexTopicViewHost?.TopicViewHost) {
      status.textContent = 'シート表示ホストを利用できません'; return false;
    }
    const runtimeId = `mixed-view:${board.topicViewDocument.documentId}:${ref.viewId}`;
    const host = new global.MeldexTopicViewHost.TopicViewHost({
      root: hostElement,
      onStatus: (_block, state, reason) => {
        status.dataset.status = state;
        status.textContent = state === 'ready' ? '' : (reason || (state === 'loading' ? 'シートビューを読み込んでいます' : 'シートビューを表示できません'));
        status.hidden = state === 'ready';
      },
    });
    board._mixedSheetViewHost = host;
    const sourceId = board.topicViewDocument.membership?.manualTopicRefs?.[0]?.sourceId || 'local-vault';
    host.register({
      blockId: runtimeId, resourceType: 'sheet', sourceId,
      documentId: board.topicViewDocument.documentId, viewId: ref.viewId,
      legacyPath: board.path || '', display: { interaction: readOnly ? 'read-only' : 'editable' },
    }, hostElement, { runtimeBlockId: runtimeId, mountPoint });
    host.setVisibilityForTest?.(runtimeId, true);
    if (!readOnly) global.bdDirty?.();
    return true;
  }

  function mountToolbar(board) {
    const boardRoot = global._bdToolbarRoot?.();
    const desktopRoot = boardRoot?.nodeType === 1
      ? (boardRoot.querySelector?.('[data-bd-role="toolbar-top"]') || boardRoot)
      : null;
    const mobileRoot = global.document?.getElementById?.('cloud-mobile-boardbar') || null;
    const views = global.MeldexBoardTopicViews;
    const readOnly = !!(board.readOnly || board.readonly || board.isReadOnly);
    const roots = [...new Set([desktopRoot, mobileRoot].filter(Boolean))];
    if (!roots.length || !views || !board.topicViewDocument) return null;
    roots.forEach((root) => {
      root.querySelectorAll('[data-bd-topic-view-controls]').forEach((element) => element.remove());
    });
    const toolbars = [];
    const refreshToolbars = () => toolbars.forEach((item) => item?.refresh?.());
    const controller = views.createController({
      readOnly,
      getDocument: () => board.topicViewDocument,
      setDocument: (document) => { board.topicViewDocument = document; },
      pushUndo: (label) => global.bdPushUndo?.(label),
      onChange: (_document, result) => {
        const nextRef = result?.activeViewRef
          || (result?.activeBoardViewId ? { surface: 'board', viewId: result.activeBoardViewId } : board.topicViewDocument.activeViewRef);
        if (nextRef) switchMixedView(board, nextRef, { skipUndo: true });
        else showMixedViewEmptyState(board);
        global.bdDirty?.();
        refreshToolbars();
      },
    });
    roots.forEach((root) => {
      const attached = views.attachToolbar(root, controller, {
        readOnly,
        getDocument: () => board.topicViewDocument,
        getActiveBoardViewId: () => board.activeBoardViewId,
        setActiveBoardViewId: (id) => { switchView(board, id); refreshToolbars(); },
        getActiveViewRef: () => board.topicViewDocument.activeViewRef
          || { surface: 'board', viewId: board.activeBoardViewId },
        setActiveViewRef: (ref) => { switchMixedView(board, ref); refreshToolbars(); },
      });
      if (!attached) return;
      if (root === mobileRoot) {
        attached.root.dataset.bdTopicViewMobile = '1';
        root.prepend(attached.root);
      }
      toolbars.push(attached);
    });
    const toolbar = toolbars.find((item) => item.root?.parentElement === desktopRoot) || toolbars[0];
    if (!toolbar) return null;
    if (!readOnly) global.MeldexBoardShuffle?.attachShuffleAction(toolbar.root, () => shuffle(board));
    desktopRoot?.querySelectorAll?.('[data-bd-group-manager]').forEach(element => element.remove());
    const groupPanel = global.document?.getElementById?.('detail-tab-board-group-style') || null;
    toolbar.groupControls = groupPanel ? mountGroupControls(groupPanel, board, { panel: true }) : null;
    global.showBoardTabs?.({ groupStyle: !readOnly });
    toolbar.toolbars = toolbars;
    return toolbar;
  }

  global.MeldexBoardTopicIntegration = Object.freeze({
    parseFrontmatter, hydrate, canonicalizeBoard, captureRuntime, serializeFrontmatter,
    switchView, switchMixedView, teardownMixedSheetView, showMixedViewEmptyState, shuffle, mountToolbar, createGroupUiController, mountGroupControls,
    installSaveHook, destroy,
  });
}(typeof globalThis !== 'undefined' ? globalThis : window));
