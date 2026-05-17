/* gb-canvas-engine.part00.js: board frontmatter compatibility helpers */

function bdYamlScalar(raw) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value || value === 'null' || value === '~') return '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value.startsWith('{') && value.endsWith('}')) return bdYamlFlowMap(value);
  if (value.startsWith('[') && value.endsWith(']')) return bdYamlFlowList(value);
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    const inner = value.slice(1, -1);
    if (value.startsWith("'")) return inner.replace(/\\n/g, '\n').replace(/''/g, "'").replace(/\\'/g, "'");
    return inner
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\(["\\/bfnrt])/g, (_, ch) => ({
        '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t',
      }[ch] || ch));
  }
  return value;
}

function bdYamlSplitFlowItems(raw) {
  const parts = [];
  let buf = '';
  let quote = '';
  let depth = 0;
  const text = String(raw || '');
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      buf += ch;
      if ((quote === '"' || quote === "'") && ch === '\\' && i + 1 < text.length) {
        i += 1;
        buf += text[i];
        continue;
      }
      if (ch === quote) {
        if (quote === "'" && text[i + 1] === "'") {
          i += 1;
          buf += text[i];
          continue;
        }
        quote = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === '{' || ch === '[') {
      depth += 1;
      buf += ch;
      continue;
    }
    if (ch === '}' || ch === ']') {
      depth = Math.max(0, depth - 1);
      buf += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      parts.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

function bdYamlSplitFlowPair(raw) {
  let quote = '';
  let depth = 0;
  const text = String(raw || '');
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if ((quote === '"' || quote === "'") && ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) {
        if (quote === "'" && text[i + 1] === "'") {
          i += 1;
          continue;
        }
        quote = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '{' || ch === '[') {
      depth += 1;
      continue;
    }
    if (ch === '}' || ch === ']') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (ch === ':' && depth === 0) return [text.slice(0, i).trim(), text.slice(i + 1).trim()];
  }
  return null;
}

function bdYamlFlowMap(raw) {
  const inner = String(raw || '').trim().slice(1, -1).trim();
  if (!inner) return {};
  const result = {};
  bdYamlSplitFlowItems(inner).forEach(item => {
    const pair = bdYamlSplitFlowPair(item);
    if (!pair || !pair[0]) return;
    const keyValue = bdYamlScalar(pair[0]);
    const key = String(keyValue == null ? '' : keyValue).trim();
    if (!key) return;
    result[key] = bdYamlScalar(pair[1]);
  });
  return result;
}

function bdYamlFlowList(raw) {
  const inner = String(raw || '').trim().slice(1, -1).trim();
  if (!inner) return [];
  return bdYamlSplitFlowItems(inner).map(item => bdYamlScalar(item));
}

function bdNormalizeConnectionControlPoints(raw) {
  if (Array.isArray(raw) && raw.length === 2
      && raw[0] && raw[1]
      && Number.isFinite(+raw[0].dx) && Number.isFinite(+raw[0].dy)
      && Number.isFinite(+raw[1].dx) && Number.isFinite(+raw[1].dy)) {
    return [
      { dx: +raw[0].dx, dy: +raw[0].dy },
      { dx: +raw[1].dx, dy: +raw[1].dy },
    ];
  }
  if (Array.isArray(raw) && raw.length === 4 && raw.every(value => Number.isFinite(+value))) {
    return [
      { dx: +raw[0], dy: +raw[1] },
      { dx: +raw[2], dy: +raw[3] },
    ];
  }
  return null;
}

function bdYamlTopLevelBlock(fm, key) {
  const lines = String(fm || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const start = lines.findIndex(line => line.trim() === key + ':');
  if (start < 0) return [];
  const block = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^[A-Za-z_][A-Za-z0-9_-]*:\s*/.test(line)) break;
    block.push(line);
  }
  return block;
}

function bdYamlNestedMap(fm, key) {
  const result = {};
  let current = '';
  for (const line of bdYamlTopLevelBlock(fm, key)) {
    let match = line.match(/^    ([^:\n]+):\s*(.*)$/);
    if (match && current && result[current] && typeof result[current] === 'object') {
      result[current][match[1].trim()] = bdYamlScalar(match[2]);
      continue;
    }
    match = line.match(/^  ([^:\n]+):\s*(.*)$/);
    if (match) {
      current = match[1].trim();
      const rest = match[2].trim();
      result[current] = rest ? bdYamlScalar(rest) : {};
      continue;
    }
  }
  return result;
}

function bdYamlListObjects(fm, key) {
  const list = [];
  let current = null;
  let nestedKey = '';
  const assignPair = (target, pairText) => {
    const match = String(pairText || '').match(/^([^:\n]+):\s*(.*)$/);
    if (!match || !target) return;
    const prop = match[1].trim();
    const rest = match[2].trim();
    target[prop] = rest ? bdYamlScalar(rest) : {};
    nestedKey = rest ? '' : prop;
  };
  for (const line of bdYamlTopLevelBlock(fm, key)) {
    const item = line.match(/^\s*-\s*(.*)$/);
    if (item) {
      const rest = item[1].trim();
      const flowValue = bdYamlScalar(rest);
      if (flowValue && typeof flowValue === 'object' && !Array.isArray(flowValue)) {
        current = flowValue;
        nestedKey = '';
        list.push(current);
        continue;
      }
      if (Array.isArray(flowValue)) {
        current = null;
        nestedKey = '';
        continue;
      }
      current = {};
      nestedKey = '';
      list.push(current);
      assignPair(current, rest);
      continue;
    }
    if (!current) continue;
    let match = line.match(/^    ([^:\n]+):\s*(.*)$/);
    if (match && nestedKey) {
      if (!current[nestedKey] || typeof current[nestedKey] !== 'object') current[nestedKey] = {};
      current[nestedKey][match[1].trim()] = bdYamlScalar(match[2]);
      continue;
    }
    match = line.match(/^  ([^:\n]+):\s*(.*)$/);
    if (match) {
      assignPair(current, `${match[1]}: ${match[2]}`);
    }
  }
  return list;
}
