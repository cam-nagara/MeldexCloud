/* gb-canvas-engine.part00.js: board frontmatter compatibility helpers */

function bdYamlScalar(raw) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value || value === 'null' || value === '~') return '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    const inner = value.slice(1, -1);
    return value.startsWith("'")
      ? inner.replace(/''/g, "'")
      : inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return value;
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
      if (rest.startsWith('{') || rest.startsWith('[')) {
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
