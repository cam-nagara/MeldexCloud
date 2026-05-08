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

function bdParseLlmSemanticsFrontmatter(fm) {
  const text = String(fm || '');
  const defaults = bdDefaultLlmSemantics();
  if (typeof bdYamlNestedMap === 'function') {
    const parsed = bdYamlNestedMap(text, 'llmSemantics');
    if (parsed && Object.keys(parsed).length) {
      return {
        ...defaults,
        ...parsed,
        nodeRoles: parsed.nodeRoles && typeof parsed.nodeRoles === 'object' ? parsed.nodeRoles : {},
        edgeSemantics: parsed.edgeSemantics && typeof parsed.edgeSemantics === 'object' ? parsed.edgeSemantics : {},
      };
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

function bdSerializeLlmSemanticsFrontmatter(semantics) {
  const src = semantics && typeof semantics === 'object' ? semantics : bdDefaultLlmSemantics();
  const profile = String(src.profile || 'general').replace(/"/g, '\\"');
  let out = 'llmSemantics:\n';
  out += `  enabled: ${src.enabled === false ? 'false' : 'true'}\n`;
  out += `  profile: "${profile}"\n`;
  return out;
}

function bdLlmSemanticSlug(value) {
  const raw = String(value || '').trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return raw || 'item';
}

function bdEnsureConnectionSemanticIds(connections, nodeIdMap) {
  (connections || []).forEach((conn, index) => {
    if (conn.semanticId) return;
    const from = nodeIdMap && conn.from ? (nodeIdMap[conn.from] || conn.from) : conn.from;
    const to = nodeIdMap && conn.to ? (nodeIdMap[conn.to] || conn.to) : conn.to;
    conn.semanticId = `edge-${bdLlmSemanticSlug(from)}-${bdLlmSemanticSlug(to)}-${index + 1}`;
  });
}

function bdBuildLlmContextPayload(boardState, options) {
  const nodeIdMap = options?.nodeIdMap || {};
  const semantics = boardState.llmSemantics && typeof boardState.llmSemantics === 'object'
    ? boardState.llmSemantics
    : bdDefaultLlmSemantics();
  const nodes = (boardState.nodes || []).map((node, index) => {
    const stableId = nodeIdMap[node.id] || `n${index}`;
    return {
      id: stableId,
      text: String(node.text || '').split('\n')[0].slice(0, 160),
      status: node.status || '',
      structure: node.structure || '',
      role: semantics.nodeRoles?.[stableId] || '',
      link: node.link || '',
    };
  });
  const connections = (boardState.connections || []).map((conn, index) => ({
    id: conn.semanticId || `edge-${index + 1}`,
    from: nodeIdMap[conn.from] || conn.from || '',
    to: nodeIdMap[conn.to] || conn.to || '',
    label: conn.label || '',
    style: conn.style || conn.pathType || '',
  })).filter(conn => conn.from || conn.to);
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
