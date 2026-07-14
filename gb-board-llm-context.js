/* Meldex board LLM semantic context helpers. */

const BD_LLM_CONTEXT_START = '<!-- meldex-llm-context:start';
const BD_LLM_CONTEXT_END = 'meldex-llm-context:end -->';

function bdDefaultLlmSemantics() {
  return {
    enabled: true,
    profile: 'general',
    nodeRoles: {},
    edgeSemantics: {},
  };
}

function bdStripLlmContextBlock(raw) {
  return String(raw || '').replace(/<!--\s*meldex-llm-context:start[\s\S]*?meldex-llm-context:end\s*-->\s*/g, '').trimEnd() + '\n';
}

function _bdLlmYamlBlockLines(text) {
  if (typeof bdYamlTopLevelBlock === 'function') return bdYamlTopLevelBlock(text, 'llmSemantics');
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const start = lines.findIndex(line => line.trim() === 'llmSemantics:');
  if (start < 0) return [];
  const block = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^[A-Za-z_][A-Za-z0-9_-]*:\s*/.test(line)) break;
    block.push(line);
  }
  return block;
}

function _bdLlmSplitYamlPair(text) {
  const raw = String(text || '');
  let quote = '';
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && ch === '\\') {
      escaped = true;
      continue;
    }
    if ((ch === '"' || ch === "'") && (!quote || quote === ch)) {
      quote = quote ? '' : ch;
      continue;
    }
    if (ch === ':' && !quote) return [raw.slice(0, i).trim(), raw.slice(i + 1).trim()];
  }
  return null;
}

function _bdLlmYamlKey(key) {
  const raw = String(key || '');
  return /^[A-Za-z0-9_-]+$/.test(raw) ? raw : JSON.stringify(raw);
}

function _bdLlmUnquoteKey(key) {
  const raw = String(key || '').trim();
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try { return String(JSON.parse(raw)); } catch {}
  }
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
  return raw;
}

function _bdLlmPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function _bdLlmParseScalar(raw) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value) return '';
  if (value.startsWith('"') || value.startsWith('{') || value.startsWith('[')) {
    try { return JSON.parse(value); } catch {}
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  if (typeof bdYamlScalar === 'function') return bdYamlScalar(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function _bdLlmYamlScalar(value) {
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (Number.isFinite(value)) return String(value);
  if (Array.isArray(value) || _bdLlmPlainObject(value)) return JSON.stringify(value);
  return JSON.stringify(String(value == null ? '' : value));
}

function _bdLlmObjectMap(value) {
  const parsed = typeof value === 'string' ? _bdLlmParseScalar(value) : value;
  return _bdLlmPlainObject(parsed) ? parsed : {};
}

function _bdLlmRemapObjectKeys(map, keyMap, options = {}) {
  const src = _bdLlmObjectMap(map);
  const mappings = keyMap && typeof keyMap === 'object' ? keyMap : null;
  if (!mappings) return src;
  const mappedValues = new Set(Object.values(mappings).map(value => String(value || '')).filter(Boolean));
  const keepUnmapped = options.keepUnmapped === true;
  const result = {};
  Object.entries(src).forEach(([key, value]) => {
    const rawKey = String(key || '').trim();
    if (!rawKey) return;
    let mappedKey = '';
    if (Object.prototype.hasOwnProperty.call(mappings, rawKey)) mappedKey = String(mappings[rawKey] || '').trim();
    else if (mappedValues.has(rawKey)) mappedKey = rawKey;
    else if (keepUnmapped) mappedKey = rawKey;
    if (mappedKey) result[mappedKey] = value;
  });
  return result;
}

function bdNormalizeLoadedLlmSemantics(semantics, nodeIdMap) {
  const normalized = _bdNormalizeLlmSemantics(semantics, bdDefaultLlmSemantics());
  const hasNodeIdMap = nodeIdMap && typeof nodeIdMap === 'object' && Object.keys(nodeIdMap).length > 0;
  normalized.nodeRoles = hasNodeIdMap
    ? _bdLlmRemapObjectKeys(normalized.nodeRoles, nodeIdMap, { keepUnmapped: false })
    : _bdLlmObjectMap(normalized.nodeRoles);
  normalized.edgeSemantics = _bdLlmObjectMap(normalized.edgeSemantics);
  return normalized;
}

function _bdParseLlmSemanticsBlock(text) {
  const lines = _bdLlmYamlBlockLines(text);
  if (!lines.length) return null;
  const result = {};
  let section = '';
  let currentEdgeId = '';
  for (const line of lines) {
    if (!String(line || '').trim()) continue;
    const indent = (String(line).match(/^\s*/) || [''])[0].length;
    const pair = _bdLlmSplitYamlPair(String(line).trim());
    if (!pair) continue;
    const key = _bdLlmUnquoteKey(pair[0]);
    const rest = pair[1];
    if (indent === 2) {
      section = '';
      currentEdgeId = '';
      if (key === 'nodeRoles' || key === 'edgeSemantics') {
        section = key;
        result[key] = rest ? _bdLlmObjectMap(rest) : {};
      } else {
        result[key] = _bdLlmParseScalar(rest);
      }
      continue;
    }
    if (indent === 4 && section === 'nodeRoles') {
      result.nodeRoles = _bdLlmPlainObject(result.nodeRoles) ? result.nodeRoles : {};
      result.nodeRoles[key] = _bdLlmParseScalar(rest);
      continue;
    }
    if (indent === 4 && section === 'edgeSemantics') {
      result.edgeSemantics = _bdLlmPlainObject(result.edgeSemantics) ? result.edgeSemantics : {};
      currentEdgeId = key;
      result.edgeSemantics[key] = rest ? _bdLlmParseScalar(rest) : {};
      continue;
    }
    if (indent === 6 && section === 'edgeSemantics' && currentEdgeId) {
      result.edgeSemantics = _bdLlmPlainObject(result.edgeSemantics) ? result.edgeSemantics : {};
      const edge = _bdLlmPlainObject(result.edgeSemantics[currentEdgeId])
        ? result.edgeSemantics[currentEdgeId]
        : {};
      edge[key] = _bdLlmParseScalar(rest);
      result.edgeSemantics[currentEdgeId] = edge;
    }
  }
  return result;
}

function _bdNormalizeLlmSemantics(parsed, defaults) {
  const src = parsed && typeof parsed === 'object' ? parsed : {};
  return {
    ...defaults,
    ...src,
    enabled: src.enabled === false || String(src.enabled).trim() === 'false' ? false : true,
    profile: String(src.profile || defaults.profile || 'general'),
    nodeRoles: _bdLlmObjectMap(src.nodeRoles),
    edgeSemantics: _bdLlmObjectMap(src.edgeSemantics),
  };
}

function _bdAppendLlmMapLines(lines, key, map) {
  const entries = Object.entries(_bdLlmObjectMap(map))
    .filter(([entryKey, value]) => String(entryKey || '').trim() && value !== undefined && value !== null && value !== '');
  if (!entries.length) return;
  lines.push(`  ${key}:`);
  entries.forEach(([entryKey, value]) => {
    if (_bdLlmPlainObject(value)) {
      const props = Object.entries(value).filter(([, propValue]) => propValue !== undefined && propValue !== null && propValue !== '');
      if (!props.length) {
        lines.push(`    ${_bdLlmYamlKey(entryKey)}: {}`);
        return;
      }
      lines.push(`    ${_bdLlmYamlKey(entryKey)}:`);
      props.forEach(([propKey, propValue]) => {
        lines.push(`      ${_bdLlmYamlKey(propKey)}: ${_bdLlmYamlScalar(propValue)}`);
      });
      return;
    }
    lines.push(`    ${_bdLlmYamlKey(entryKey)}: ${_bdLlmYamlScalar(value)}`);
  });
}

function bdParseLlmSemanticsFrontmatter(fm) {
  const text = String(fm || '');
  const defaults = bdDefaultLlmSemantics();
  const blockParsed = _bdParseLlmSemanticsBlock(text);
  if (blockParsed && Object.keys(blockParsed).length) return _bdNormalizeLlmSemantics(blockParsed, defaults);
  if (typeof bdYamlNestedMap === 'function') {
    const parsed = bdYamlNestedMap(text, 'llmSemantics');
    if (parsed && Object.keys(parsed).length) {
      return _bdNormalizeLlmSemantics(parsed, defaults);
    }
  }
  const block = text.match(/llmSemantics:\n((?:\s+[A-Za-z0-9_-]+:.*\n?)*)/);
  if (!block) return defaults;
  const result = { ...defaults };
  block[1].replace(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/gm, (_, key, value) => {
    const v = String(value || '').trim().replace(/^"|"$/g, '');
    if (key === 'enabled') result.enabled = v !== 'false';
    else if (key === 'profile') result.profile = v || 'general';
  });
  return result;
}

function bdSerializeLlmSemanticsFrontmatter(semantics, options) {
  const src = semantics && typeof semantics === 'object' ? semantics : bdDefaultLlmSemantics();
  const opts = options || {};
  const nodeRoles = _bdLlmRemapObjectKeys(src.nodeRoles, opts.nodeIdMap, { keepUnmapped: !opts.nodeIdMap });
  const edgeSemantics = _bdLlmRemapObjectKeys(src.edgeSemantics, opts.edgeIdMap, { keepUnmapped: !opts.edgeIdMap });
  const lines = [
    'llmSemantics:',
    `  enabled: ${src.enabled === false ? 'false' : 'true'}`,
    `  profile: ${_bdLlmYamlScalar(src.profile || 'general')}`,
  ];
  _bdAppendLlmMapLines(lines, 'nodeRoles', nodeRoles);
  _bdAppendLlmMapLines(lines, 'edgeSemantics', edgeSemantics);
  return lines.join('\n') + '\n';
}

function bdLlmSemanticSlug(value) {
  const raw = String(value || '').trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return raw || 'item';
}

function bdEnsureConnectionSemanticIds(connections, nodeIdMap, semantics) {
  const used = new Set();
  const edgeSemantics = semantics && _bdLlmPlainObject(semantics.edgeSemantics) ? semantics.edgeSemantics : null;
  (connections || []).forEach((conn, index) => {
    const from = nodeIdMap && conn.from ? (nodeIdMap[conn.from] || conn.from) : conn.from;
    const to = nodeIdMap && conn.to ? (nodeIdMap[conn.to] || conn.to) : conn.to;
    const fallback = `edge-${bdLlmSemanticSlug(from)}-${bdLlmSemanticSlug(to)}-${index + 1}`;
    const oldId = String(conn.semanticId || '').trim();
    const baseId = bdLlmSemanticSlug(oldId || fallback);
    let nextId = baseId;
    let suffix = 2;
    while (used.has(nextId)) {
      nextId = `${baseId}-${suffix}`;
      suffix += 1;
    }
    used.add(nextId);
    if (oldId && oldId !== nextId && edgeSemantics && Object.prototype.hasOwnProperty.call(edgeSemantics, oldId)) {
      if (!Object.prototype.hasOwnProperty.call(edgeSemantics, nextId)) edgeSemantics[nextId] = edgeSemantics[oldId];
      delete edgeSemantics[oldId];
    }
    conn.semanticId = nextId;
  });
}

function bdBuildLlmContextPayload(boardState, options) {
  const nodeIdMap = options?.nodeIdMap || {};
  const hasNodeIdMap = Object.keys(nodeIdMap || {}).length > 0;
  const semantics = boardState.llmSemantics && typeof boardState.llmSemantics === 'object'
    ? boardState.llmSemantics
    : bdDefaultLlmSemantics();
  const nodes = (boardState.nodes || []).map((node, index) => {
    const stableId = hasNodeIdMap ? (nodeIdMap[node.id] || node.id || `n${index}`) : (node.id || `n${index}`);
    return {
      id: stableId,
      text: String(node.text || '').split('\n')[0].slice(0, 160),
      status: node.status || '',
      structure: node.structure || '',
      role: semantics.nodeRoles?.[node.id] || semantics.nodeRoles?.[stableId] || '',
      link: node.link || '',
    };
  });
  const edgeSemantics = semantics.edgeSemantics && typeof semantics.edgeSemantics === 'object'
    ? semantics.edgeSemantics
    : {};
  const connections = (boardState.connections || []).map((conn, index) => {
    const connId = conn.semanticId || `edge-${index + 1}`;
    const semanticInfo = _bdLlmObjectMap(edgeSemantics[connId]);
    const payloadConn = {
      id: connId,
      from: nodeIdMap[conn.from] || conn.from || '',
      to: nodeIdMap[conn.to] || conn.to || '',
      label: conn.label || '',
      style: conn.style || conn.pathType || '',
    };
    if (Object.keys(semanticInfo).length) payloadConn.semantics = semanticInfo;
    return payloadConn;
  }).filter(conn => conn.from || conn.to);
  return {
    version: 1,
    generatedBy: 'Meldex',
    profile: semantics.profile || 'general',
    nodes,
    connections,
  };
}

function bdBuildLlmContextMarkdown(boardState, options) {
  const semantics = boardState?.llmSemantics;
  if (semantics && semantics.enabled === false) return '';
  const payload = bdBuildLlmContextPayload(boardState || {}, options || {});
  return `\n${BD_LLM_CONTEXT_START}\n${JSON.stringify(payload, null, 2)}\n${BD_LLM_CONTEXT_END}\n`;
}
