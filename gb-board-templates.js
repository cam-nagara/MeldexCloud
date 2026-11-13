/* gb-board-templates.js: ボードのファイル単位テンプレート（保存・適用・選択画面）。
 *
 * - 初期搭載テンプレートは gb-board-template-library.js、選択画面は gb-template-picker.js。
 * - 自分のテンプレートは個人設定（Dropboxの個人領域）へ、使えない環境では端末内へ保存する。
 * - 適用は1回の取り消しで元に戻せる。既存のトピックは削除しない
 *   （内容のあるボードには「スタイルだけ適用」か「内容を横に追加」を選ぶ）。
 */
(function initMeldexBoardTemplates(global) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const DOCUMENT = 'board-templates';
  const STORAGE_KEY = 'meldex-board-templates-v1';
  const MAX_TEMPLATES = 80;
  const NODE_OVERRIDE_KEYS = [
    'bgColor', 'bgOpacity', 'textColor', 'borderColor', 'borderOpacity', 'borderWidth', 'borderRadius',
    'fontSize', 'fontBold', 'fontItalic', 'textStrokeColor', 'textStrokeWidth', 'shape',
    'cloudBumpWidth', 'cloudBumpHeight', 'cloudSideWidth', 'cloudOffset', 'cloudSubWidthRatio', 'cloudSubHeightRatio',
  ];
  const LINE_KEYS = ['label', 'styleRef', 'arrow', 'style', 'pathType', 'width', 'color', 'colorOpacity'];

  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function lib() { return global.MeldexBoardTemplateLibrary; }
  function status(message, isError) { if (typeof global.showStatus === 'function') global.showStatus(message, !!isError); }

  function boardState() {
    try { if (typeof bd !== 'undefined' && bd && Array.isArray(bd.nodes)) return bd; } catch (_) { /* no board */ }
    return null;
  }

  function newId(prefix) {
    if (global.crypto?.randomUUID) return `${prefix}-${global.crypto.randomUUID()}`;
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  // ---------------------------------------------------------------
  //  検証
  // ---------------------------------------------------------------
  function validateTemplate(value) {
    if (!value || typeof value !== 'object') throw new Error('不正なボードテンプレートです');
    if (value.schemaVersion !== SCHEMA_VERSION) throw new Error('未対応のボードテンプレートです');
    const id = String(value.id || '').trim();
    const name = String(value.name || '').trim();
    if (!id || !name) throw new Error('ボードテンプレートの名前またはIDがありません');
    const nodes = Array.isArray(value.content?.nodes) ? value.content.nodes : [];
    const keys = new Set();
    nodes.forEach(node => {
      const key = String(node?.key || '');
      if (!key || keys.has(key)) throw new Error('ボードテンプレートのトピック構成が壊れています');
      if (![node.x, node.y, node.w, node.h].filter(item => item != null).every(item => Number.isFinite(Number(item)))) {
        throw new Error('ボードテンプレートの座標または大きさが不正です');
      }
      keys.add(key);
    });
    nodes.forEach(node => {
      const parent = String(node?.parent || '');
      if (parent && !keys.has(parent)) throw new Error(`親トピックが見つかりません: ${parent}`);
      const seen = new Set([String(node.key)]);
      let current = parent;
      while (current) {
        if (seen.has(current)) throw new Error('ボードテンプレートの親子関係が循環しています');
        seen.add(current);
        current = String(nodes.find(item => String(item?.key || '') === current)?.parent || '');
      }
    });
    (Array.isArray(value.content?.lines) ? value.content.lines : []).forEach(line => {
      if (!keys.has(String(line?.from || '')) || !keys.has(String(line?.to || ''))) {
        throw new Error('ボードテンプレートの接続先が見つかりません');
      }
    });
    (Array.isArray(value.content?.groups) ? value.content.groups : []).forEach(group => {
      if (!Array.isArray(group?.nodeKeys) || group.nodeKeys.some(key => !keys.has(String(key)))) {
        throw new Error('ボードテンプレートのグループ参照が壊れています');
      }
    });
    return { ...clone(value), id, name, builtin: false };
  }

  function validateList(list) {
    if (!Array.isArray(list)) throw new Error('ボードテンプレート一覧が不正です');
    const result = list.map(validateTemplate);
    if (new Set(result.map(item => item.id)).size !== result.length) throw new Error('ボードテンプレートのIDが重複しています');
    return result;
  }

  // ---------------------------------------------------------------
  //  保存先（個人設定 → 端末内）
  // ---------------------------------------------------------------
  async function loadLibrary() {
    let remote = { available: false };
    if (typeof global.apiFetch === 'function') {
      remote = await global.apiFetch(`/personal-preferences/${DOCUMENT}`, { silentError: true }).catch(error => {
        const code = Number(error?.status || error?.statusCode || error?.response?.status);
        if (code === 404 || code === 401 || code === 0 || !code) return { available: false };
        throw error;
      });
    }
    if (remote?.available) {
      if (remote.payload && remote.payload.schemaVersion !== SCHEMA_VERSION) throw new Error('未対応のボードテンプレート一覧です');
      return { remote: true, revision: remote.revision || null, payload: remote.payload || {}, templates: validateList(remote.payload?.templates || []) };
    }
    const raw = global.localStorage?.getItem(STORAGE_KEY);
    let saved = { templates: [] };
    try { saved = JSON.parse(raw || '{"templates":[]}'); } catch (_) { throw new Error('端末内のボードテンプレート一覧を読み取れません'); }
    return { remote: false, storageRevision: raw, payload: saved, templates: validateList(saved.templates || []) };
  }

  async function persistLibrary(library, templates) {
    if (library?.failed) throw new Error('テンプレート一覧を読み込めていないため保存できません。開き直してください');
    const list = templates.slice(0, MAX_TEMPLATES);
    if (library.remote) {
      const result = await global.apiFetch(`/personal-preferences/${DOCUMENT}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: { ...library.payload, schemaVersion: SCHEMA_VERSION, templates: list }, expectedRevision: library.revision || null }),
      });
      if (!result?.ok) throw new Error('テンプレートを保存できませんでした。一覧を開き直してください');
      library.revision = result.revision;
    } else {
      const write = () => {
        if ((global.localStorage.getItem(STORAGE_KEY) ?? null) !== (library.storageRevision ?? null)) {
          throw new Error('テンプレート一覧が別の画面で変更されています。開き直してください');
        }
        const text = JSON.stringify({ ...library.payload, schemaVersion: SCHEMA_VERSION, templates: list });
        global.localStorage.setItem(STORAGE_KEY, text);
        library.storageRevision = text;
      };
      if (global.navigator?.locks?.request) await global.navigator.locks.request(STORAGE_KEY, write); else write();
    }
    library.templates = list;
    return list;
  }

  // ---------------------------------------------------------------
  //  現在のボード → テンプレート
  // ---------------------------------------------------------------
  function fileStyleValue(board, key) {
    const style = board._fileStyle && typeof board._fileStyle === 'object' ? board._fileStyle : {};
    return style[key] != null ? String(style[key]) : '';
  }

  function captureStyle(board) {
    const doc = board.topicViewDocument;
    const groupStyles = Array.isArray(doc?.groupStyles) ? doc.groupStyles : [];
    return {
      cardStyles: clone(board.cardStyles || []),
      lineStyles: clone(board.lineStyles || []),
      depthStyles: clone(typeof global.bdEnsureDepthStyles === 'function' ? global.bdEnsureDepthStyles() : (board.depthStyles || [])),
      groupStyles: clone(groupStyles),
      activeCardStyle: board.activeCardStyle || '',
      activeLineStyle: board.activeLineStyle || '',
      activeGroupStyle: doc?.activeGroupStyleId || '',
      bgColor: board._bgColor || fileStyleValue(board, '--bd-bg'),
      fontFamily: fileStyleValue(board, '--bd-default-font-family'),
      showShadow: !!board._showShadow,
      gapSiblings: Number.isFinite(+board.gapSiblings) ? +board.gapSiblings : null,
      gapLevels: Number.isFinite(+board.gapLevels) ? +board.gapLevels : null,
    };
  }

  function captureContent(board) {
    const nodes = (board.nodes || []).filter(node => node && node.id && !node.contained);
    if (!nodes.length) return { nodes: [], lines: [], groups: [] };
    const keyOf = new Map(nodes.map((node, index) => [node.id, `n${index}`]));
    const minX = Math.min(...nodes.map(node => +node.x || 0));
    const minY = Math.min(...nodes.map(node => +node.y || 0));
    const depthOf = node => {
      let depth = 0; let cur = node; const seen = new Set();
      while (cur?.parent && keyOf.has(cur.parent) && !seen.has(cur.id)) {
        seen.add(cur.id); depth += 1; cur = nodes.find(item => item.id === cur.parent);
      }
      return depth;
    };
    const outNodes = nodes.map(node => {
      const overrides = {};
      NODE_OVERRIDE_KEYS.forEach(key => { if (node[key] !== undefined && node[key] !== null) overrides[key] = clone(node[key]); });
      return {
        key: keyOf.get(node.id),
        text: String(node.text || ''),
        parent: node.parent && keyOf.has(node.parent) ? keyOf.get(node.parent) : '',
        depth: depthOf(node),
        x: Math.round((+node.x || 0) - minX),
        y: Math.round((+node.y || 0) - minY),
        w: +node.w || 0,
        h: +node.h || 0,
        structure: node.structure || '',
        autoStyle: !!node._autoStyle,
        cardStyle: node._userCardStyle ? (node.cardStyle || '') : '',
        collapsed: !!node.collapsed,
        overrides,
      };
    });
    const parentPairs = new Set(nodes.filter(node => node.parent && keyOf.has(node.parent)).map(node => `${node.parent}->${node.id}`));
    const lines = (board.connections || []).filter(conn => keyOf.has(conn.from) && keyOf.has(conn.to)
      && !parentPairs.has(`${conn.from}->${conn.to}`) && !parentPairs.has(`${conn.to}->${conn.from}`))
      .map(conn => {
        const line = { from: keyOf.get(conn.from), to: keyOf.get(conn.to) };
        LINE_KEYS.forEach(key => { if (conn[key] !== undefined && conn[key] !== null && conn[key] !== '') line[key] = clone(conn[key]); });
        return line;
      });
    const groups = (board.groups || []).map(group => ({
      name: String(group.name || 'グループ'),
      nodeKeys: (group.nodeIds || []).filter(id => keyOf.has(id)).map(id => keyOf.get(id)),
      styleRef: group.styleRef || '',
      styleOverrides: clone(group.styleOverrides || {}),
    })).filter(group => group.nodeKeys.length);
    return { nodes: outNodes, lines, groups };
  }

  function captureTemplate(board, options = {}) {
    if (!board) throw new Error('ボードが開かれていません');
    return {
      schemaVersion: SCHEMA_VERSION,
      id: newId('board-template'),
      name: String(options.name || '').trim() || 'マイテンプレート',
      description: String(options.description || '').trim(),
      category: 'custom',
      categoryLabel: 'マイテンプレート',
      createdAt: new Date().toISOString(),
      style: captureStyle(board),
      content: options.includeContent === false ? { nodes: [], lines: [], groups: [] } : captureContent(board),
    };
  }

  // ---------------------------------------------------------------
  //  テンプレート → ボード
  // ---------------------------------------------------------------
  function isBoardEditable(board) {
    if (!board?.path) return false;
    if (board.readOnly || board.readonly || board.isReadOnly) return false;
    if (typeof global._bdIsBoardWritablePath === 'function' && !global._bdIsBoardWritablePath(board.path)) return false;
    return true;
  }

  function hasContent(board) {
    return (board?.nodes || []).length > 0;
  }

  function setFileStyle(board, key, value) {
    const style = board._fileStyle && typeof board._fileStyle === 'object' ? { ...board._fileStyle } : {};
    if (value == null || value === '') delete style[key]; else style[key] = String(value);
    board._fileStyle = Object.keys(style).length ? style : null;
  }

  function applyStyle(board, template) {
    const library = lib();
    const style = template.style || {};
    const cardStyles = clone(library.cardStylesFor(template));
    const lineStyles = clone(library.lineStylesFor(template));
    const depthStyles = clone(library.depthStylesFor(template));
    board.cardStyles = cardStyles;
    board.lineStyles = lineStyles;
    board.depthStyles = typeof global.bdNormalizeDepthStyles === 'function' ? global.bdNormalizeDepthStyles(depthStyles) : depthStyles;
    board.activeDepthStylePreset = style.depthPresetId || '';
    board.activeCardStyle = cardStyles.some(item => item.id === style.activeCardStyle) ? style.activeCardStyle : (cardStyles[0]?.id || '');
    board.activeLineStyle = lineStyles.some(item => item.id === style.activeLineStyle) ? style.activeLineStyle : (lineStyles[0]?.id || '');
    // テンプレートの見た目を、全ボード共通の既定値や旧版の初期スタイル投入で上書きさせない。
    board._stylePresetSeedVersion = typeof global.BD_STYLE_PRESET_VERSION === 'number'
      ? global.BD_STYLE_PRESET_VERSION
      : (typeof BD_STYLE_PRESET_VERSION === 'number' ? BD_STYLE_PRESET_VERSION : board._stylePresetSeedVersion);
    board._globalStyleDefaultsApplied = true;
    const cardIds = new Set(cardStyles.map(item => item.id));
    const lineIds = new Set(lineStyles.map(item => item.id));
    (board.nodes || []).forEach(node => {
      if (node.cardStyle && !cardIds.has(node.cardStyle)) { node.cardStyle = ''; delete node._userCardStyle; }
    });
    (board.connections || []).forEach(conn => {
      if (conn.styleRef && !lineIds.has(conn.styleRef)) conn.styleRef = '';
    });
    board._bgColor = style.bgColor || '';
    setFileStyle(board, '--bd-bg', style.bgColor || '');
    setFileStyle(board, '--bd-default-font-family', style.fontFamily || '');
    setFileStyle(board, '--bd-shadow', style.showShadow ? '1' : '');
    board._showShadow = !!style.showShadow;
    board.gapSiblings = Number.isFinite(+style.gapSiblings) && style.gapSiblings !== null ? +style.gapSiblings : null;
    board.gapLevels = Number.isFinite(+style.gapLevels) && style.gapLevels !== null ? +style.gapLevels : null;
    setFileStyle(board, '--bd-gap-siblings', board.gapSiblings);
    setFileStyle(board, '--bd-gap-levels', board.gapLevels);
    const groupStyles = clone(library.groupStylesFor(template)).map(item => { delete item.builtin; return item; });
    if (board.topicViewDocument && global.MeldexBoardGroups?.normalizeGroupStyles) {
      const doc = { ...board.topicViewDocument, groupStyles };
      doc.activeGroupStyleId = groupStyles.some(item => item.groupStyleId === style.activeGroupStyle)
        ? style.activeGroupStyle : (groupStyles[0]?.groupStyleId || null);
      board.topicViewDocument = global.MeldexBoardGroups.normalizeGroupStyles(doc);
      const groupIds = new Set(groupStyles.map(item => item.groupStyleId));
      (board.groups || []).forEach(group => { if (group.styleRef && !groupIds.has(group.styleRef)) group.styleRef = null; });
    }
  }

  function visualStyleFor(template, styleRef) {
    return clone(lib().groupStylesFor(template).find(item => item.groupStyleId === styleRef)?.visualStyle || {});
  }

  function contentOrigin(board, nodes, mode) {
    const minX = Math.min(...nodes.map(node => node.x));
    const minY = Math.min(...nodes.map(node => node.y));
    if (mode === 'append' && hasContent(board)) {
      const right = Math.max(...board.nodes.map(node => (+node.x || 0) + (+node.w || 160)));
      const top = Math.min(...board.nodes.map(node => +node.y || 0));
      return { x: right + 200 - minX, y: top - minY };
    }
    const center = typeof global.bdGetCanvasCenterWorld === 'function' ? global.bdGetCanvasCenterWorld() : { x: 120, y: 120 };
    const width = Math.max(...nodes.map(node => node.x + node.w)) - minX;
    const height = Math.max(...nodes.map(node => node.y + node.h)) - minY;
    return { x: Math.round(center.x - width / 2 - minX), y: Math.round(center.y - height / 2 - minY) };
  }

  function applyContent(board, template, mode) {
    const nodes = lib().layout(template);
    if (!nodes.length) return [];
    const origin = contentOrigin(board, nodes, mode);
    const idOf = new Map();
    const created = [];
    const rootStructure = new Map();
    nodes.forEach(spec => {
      const opts = {
        parent: '',
        structure: spec.structure || '',
        _autoStyle: !!spec.autoStyle,
        w: spec.w,
      };
      if (spec.cardStyle) { opts.cardStyle = spec.cardStyle; opts._userCardStyle = true; }
      const node = typeof global.bdCreateNodeWithStyle === 'function'
        ? global.bdCreateNodeWithStyle(spec.text, origin.x + spec.x, origin.y + spec.y, opts)
        : global.bdNode(spec.text, origin.x + spec.x, origin.y + spec.y, spec.w, spec.h, opts);
      if (!spec.autoStyle) node._autoStyle = false;
      if (spec.cardStyle) { node.cardStyle = spec.cardStyle; node._userCardStyle = true; }
      Object.entries(spec.overrides || {}).forEach(([key, value]) => { if (NODE_OVERRIDE_KEYS.includes(key)) node[key] = clone(value); });
      if (spec.collapsed) node.collapsed = true;
      idOf.set(spec.key, node.id);
      created.push({ spec, node });
    });
    created.forEach(({ spec, node }) => {
      if (spec.parent && idOf.has(spec.parent)) node.parent = idOf.get(spec.parent);
    });
    board.nodes.push(...created.map(item => item.node));
    const byId = new Map(board.nodes.map(node => [node.id, node]));
    const rootOf = node => { let cur = node; const seen = new Set(); while (cur?.parent && byId.has(cur.parent) && !seen.has(cur.id)) { seen.add(cur.id); cur = byId.get(cur.parent); } return cur; };
    created.forEach(({ node }) => {
      if (!node.parent) return;
      const root = rootOf(node);
      if (!rootStructure.has(root.id)) rootStructure.set(root.id, root.structure || '');
      const conn = typeof global.bdCreateStructureConnection === 'function'
        ? global.bdCreateStructureConnection(node.parent, node.id, rootStructure.get(root.id))
        : { id: global.bdId(), from: node.parent, to: node.id, arrow: '' };
      board.connections.push(conn);
    });
    (template.content?.lines || []).forEach(line => {
      if (!idOf.has(line.from) || !idOf.has(line.to)) return;
      const extra = {};
      LINE_KEYS.forEach(key => { if (line[key] !== undefined && key !== 'styleRef') extra[key] = clone(line[key]); });
      const conn = typeof global.bdCreateConnectionWithStyle === 'function'
        ? global.bdCreateConnectionWithStyle(idOf.get(line.from), idOf.get(line.to), extra)
        : { id: global.bdId(), from: idOf.get(line.from), to: idOf.get(line.to), ...extra };
      if (line.styleRef) conn.styleRef = line.styleRef;
      if (line.label) conn.label = String(line.label);
      board.connections.push(conn);
    });
    if (!Array.isArray(board.groups)) board.groups = [];
    const docStyles = new Set((board.topicViewDocument?.groupStyles || []).map(item => item.groupStyleId));
    (template.content?.groups || []).forEach(group => {
      const nodeIds = (group.nodeKeys || []).filter(key => idOf.has(key)).map(key => idOf.get(key));
      if (!nodeIds.length) return;
      const useRef = group.styleRef && docStyles.has(group.styleRef);
      board.groups.push({
        id: typeof global.bdId === 'function' ? global.bdId() : newId('group'),
        name: String(group.name || 'グループ'),
        nodeIds,
        styleRef: useRef ? group.styleRef : null,
        styleOverrides: useRef ? clone(group.styleOverrides || {}) : { ...visualStyleFor(template, group.styleRef), ...clone(group.styleOverrides || {}) },
      });
    });
    return created.map(item => item.node);
  }

  function refreshBoard(board, createdNodes) {
    if (typeof global.bdApplyBoardFileStyleAndTheme === 'function') global.bdApplyBoardFileStyleAndTheme();
    (board.nodes || []).filter(node => node._autoStyle && !node.parent).forEach(root => {
      if (typeof global.bdApplyAutoStyle === 'function') global.bdApplyAutoStyle(root.id);
    });
    if (typeof global.bdRequestFullRender === 'function') global.bdRequestFullRender('board-template');
    else if (typeof global.bdRender === 'function') global.bdRender();
    if (typeof global._bdRelayoutAllStructureTrees === 'function' && board.autoAlign !== false) global._bdRelayoutAllStructureTrees();
    if (typeof global.bdMarkExtrasDirty === 'function') global.bdMarkExtrasDirty({ minimap: true, boardUi: true, frames: true }, 'board-template');
    if (typeof global.bdDirty === 'function') global.bdDirty();
    if (typeof global.bdRefreshBoardOptionPanels === 'function') global.bdRefreshBoardOptionPanels();
    if (typeof global.refreshDetailPanel === 'function') { try { global.refreshDetailPanel(); } catch (_) { /* optional */ } }
    global.MeldexBoardImmersive?.updateEmptyGuide?.();
    if (createdNodes?.length && typeof global.bdFitAll === 'function') setTimeout(() => global.bdFitAll(), 260);
  }

  // mode: 'full'（見た目＋内容） / 'style'（見た目だけ） / 'append'（見た目はそのまま、内容だけ横に追加）
  function applyTemplate(template, mode = 'full', options = {}) {
    const board = options.board || boardState();
    if (!board) throw new Error('ボードを開いてから適用してください');
    if (!isBoardEditable(board)) throw new Error('このボードは編集できないため、テンプレートを適用できません');
    if (!['full', 'style', 'append'].includes(mode)) throw new Error('未対応のテンプレート適用方法です');
    if (mode === 'full' && hasContent(board)) throw new Error('内容のあるボードには「スタイルだけ適用」か「内容を追加」を選んでください');
    const prepared = validateTemplate({ ...clone(template), schemaVersion: template?.schemaVersion ?? SCHEMA_VERSION });
    const working = clone(board);
    if (!working || typeof working !== 'object') throw new Error('ボードの作業コピーを作成できませんでした');
    if (board.editing && typeof global.bdFinishEdit === 'function') global.bdFinishEdit();
    const label = mode === 'style' ? 'テンプレートのスタイルを適用' : mode === 'append' ? 'テンプレートの内容を追加' : 'テンプレートを適用';
    if (mode !== 'append') applyStyle(working, prepared);
    const created = mode === 'style' ? [] : applyContent(working, prepared, mode);
    const mutableKeys = [
      'nodes', 'connections', 'groups', 'cardStyles', 'lineStyles', 'depthStyles',
      'activeDepthStylePreset', 'activeCardStyle', 'activeLineStyle', '_stylePresetSeedVersion',
      '_globalStyleDefaultsApplied', '_bgColor', '_fileStyle', '_showShadow', 'gapSiblings',
      'gapLevels', 'topicViewDocument',
    ];
    if (typeof global.bdPushUndo === 'function') global.bdPushUndo(`${label}: ${template.name}`);
    mutableKeys.forEach(key => {
      if (Object.prototype.hasOwnProperty.call(working, key)) board[key] = clone(working[key]);
      else delete board[key];
    });
    refreshBoard(board, created);
    return { created: created.length };
  }

  // ---------------------------------------------------------------
  //  選択画面
  // ---------------------------------------------------------------
  function toPickerItem(template) {
    const nodes = template.content?.nodes || [];
    return {
      ...template,
      renderThumbnail: (host, opts) => lib().renderThumbnail(template, host, opts),
      details: host => {
        const list = document.createElement('ul');
        const add = text => { const li = document.createElement('li'); li.textContent = text; list.appendChild(li); };
        add(nodes.length ? `トピック ${nodes.length} 件` : 'トピックなし（見た目だけ）');
        if (template.content?.groups?.length) add(`グループ ${template.content.groups.length} 件`);
        const presetId = template.style?.depthPresetId;
        const preset = presetId && global.MeldexBoardDepthPresets?.find ? global.MeldexBoardDepthPresets.find(presetId) : null;
        add(`階層別スタイル: ${preset?.name || (template.style?.depthStyles ? 'テンプレート独自' : '標準')}`);
        if (template.style?.fontFamily) add(`フォント: ${template.style.fontFamily}`);
        if (template.style?.bgColor) add(`背景色: ${template.style.bgColor}`);
        host.appendChild(list);
      },
    };
  }

  async function askName(defaultName) {
    if (typeof global.cfPrompt === 'function') return global.cfPrompt('テンプレート名', defaultName);
    return global.prompt?.('テンプレート名', defaultName) ?? null;
  }

  async function askConfirm(message, options) {
    if (typeof global.cfConfirm === 'function') return global.cfConfirm(message, options);
    return !!global.confirm?.(message);
  }

  async function chooseApplyMode(template) {
    const board = boardState();
    if (!hasContent(board)) return 'full';
    if (!(template.content?.nodes || []).length) return 'style';
    if (typeof global.GBUI?.createModal !== 'function') return 'style';
    return new Promise(resolve => {
      let result = null;
      const body = document.createElement('p');
      body.textContent = 'このボードには既に内容があります。既存のトピックは削除しません。どのように適用しますか？';
      const mk = (label, value, primary) => {
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = primary ? 'gb-btn gb-btn-primary' : 'gb-btn'; btn.textContent = label;
        btn.dataset.e2eId = `board-template-mode-${value || 'cancel'}`;
        btn.addEventListener('click', () => { result = value; modal.close(value || 'cancel'); });
        return btn;
      };
      const modal = global.GBUI.createModal({
        id: 'board-template-apply-mode', title: `「${template.name}」を適用`, body,
        footer: [mk('キャンセル', null), mk('内容を横に追加', 'append'), mk('スタイルだけ適用', 'style', true)],
        variant: 'standard', onClose: () => resolve(result),
      });
      modal.open();
    });
  }

  async function open(options = {}) {
    if (!global.MeldexTemplatePicker) throw new Error('テンプレート選択画面を読み込めませんでした');
    let library = null;
    const loadItems = async () => {
      // 読めない時は空の一覧で表示だけ続け、保存操作は読み直してから行う（空で上書きしない）。
      library = await loadLibrary().catch(error => { status(error.message, true); return { failed: true, remote: false, templates: [], payload: {} }; });
      return [...lib().builtinTemplates(), ...library.templates].map(toPickerItem);
    };
    const board = boardState();
    const editable = isBoardEditable(board);
    return global.MeldexTemplatePicker.open({
      id: 'board-templates',
      title: 'ボードテンプレート',
      loadItems,
      selectedId: options.selectedId || lib().defaultTemplateId(),
      emptyText: 'テンプレートはありません',
      primaryAction: {
        label: hasContent(board) ? '適用…' : 'このテンプレートで始める',
        when: () => editable,
        run: async (item) => {
          const mode = await chooseApplyMode(item);
          if (!mode) return false;
          const result = applyTemplate(item, mode);
          status(mode === 'style' ? `「${item.name}」のスタイルを適用しました`
            : `「${item.name}」を適用しました（トピック ${result.created} 件）`);
          return true;
        },
      },
      itemActions: [
        { label: '名前を変更', when: item => !item.builtin, e2eId: 'board-templates-rename', run: async (item, ctx) => {
          const name = String(await askName(item.name) || '').trim();
          if (!name || name === item.name) return false;
          if (library.templates.some(other => other.name === name && other.id !== item.id)) throw new Error('同名のテンプレートがあります');
          await persistLibrary(library, library.templates.map(other => other.id === item.id ? { ...other, name } : other));
          await ctx.refresh();
          ctx.select(item.id);
          ctx.setStatus('名前を変更しました');
          return false;
        } },
        { label: '削除', danger: true, when: item => !item.builtin, e2eId: 'board-templates-delete', run: async (item, ctx) => {
          if (!await askConfirm(`テンプレート「${item.name}」を削除しますか？\nこのテンプレートから作ったボードは変わりません。`)) return false;
          await persistLibrary(library, library.templates.filter(other => other.id !== item.id));
          await ctx.refresh();
          ctx.setStatus('削除しました');
          return false;
        } },
      ],
    });
  }

  async function createFromCurrent(library) {
    const current = boardState();
    if (!current) throw new Error('ボードを開いてから作成してください');
    const base = String(current.path || '').split(/[\\/]/).pop().replace(/\.(mel-board|board\.md|md)$/i, '') || 'マイテンプレート';
    const name = String(await askName(base) || '').trim();
    if (!name) return null;
    if (library.templates.some(other => other.name === name)) throw new Error('同名のテンプレートがあります');
    const includeContent = hasContent(current)
      ? await askConfirm('トピックの構成もテンプレートに含めますか？', { okLabel: '構成も含める', cancelLabel: '見た目だけ保存', danger: false })
      : false;
    const template = validateTemplate(captureTemplate(current, { name, includeContent }));
    await persistLibrary(library, [...library.templates, template]);
    return template;
  }

  async function registerCurrent() {
    const library = await loadLibrary();
    const template = await createFromCurrent(library);
    if (template) status(`ボードテンプレート「${template.name}」を${library.remote ? '個人設定' : 'この端末'}に保存しました`);
    return template;
  }

  global.MeldexBoardTemplates = Object.freeze({
    SCHEMA_VERSION,
    open,
    registerCurrent,
    captureTemplate,
    applyTemplate,
    validateTemplate,
    loadLibrary,
    isBoardEditable,
  });
}(typeof globalThis !== 'undefined' ? globalThis : window));
