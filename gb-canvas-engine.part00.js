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

const BD_MANAGED_FRONTMATTER_KEYS = new Set([
  'type', 'positions', 'ids', 'sizes', 'parents', 'structures', 'statuses', 'bgcolors',
  'balloons', 'containers', 'links', 'linkTypes', 'transforms', 'canvasBg', 'style',
  'theme', 'numbering', 'xmind', 'statusDefs', 'groups', 'cardStyles', 'lineStyles',
  'depthStyles', 'boardUi', 'connections', 'llmSemantics', 'tails',
]);

function bdPreserveUnknownFrontmatter(fm) {
  const blocks = [];
  let current = null;
  String(fm || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').forEach(line => {
    const key = bdFrontmatterTopLevelKey(line);
    if (key !== null) {
      if (current?.keep) blocks.push(current.lines.join('\n'));
      current = { keep: !BD_MANAGED_FRONTMATTER_KEYS.has(key), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    } else if (/^[^\s#]/.test(line)) {
      blocks.push(line);
    }
  });
  if (current?.keep) blocks.push(current.lines.join('\n'));
  return blocks.map(block => block.replace(/\n+$/, '')).filter(Boolean).join('\n');
}

function bdFrontmatterTopLevelKey(line) {
  const text = String(line || '').replace(/\s+$/, '');
  if (!text || /^[\s#%]/.test(text)) return null;
  if (text[0] === '?') return '';
  let quote = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (quote === '"' && char === '\\') index += 1;
      else if (char === quote) {
        if (quote === "'" && text[index + 1] === "'") index += 1;
        else quote = '';
      }
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char !== ':' || (text[index + 1] && !/\s/.test(text[index + 1]))) continue;
    const raw = text.slice(0, index).trim();
    if (raw.startsWith('"') && raw.endsWith('"')) {
      try { return JSON.parse(raw); } catch { return raw.slice(1, -1); }
    }
    if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
    return raw;
  }
  return null;
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

// カードのしっぽ (tail) の読込値を検証・正規化する。startX/startY/endX/endY が数値でなければ
// 読み込み自体を無視する（壊れた/意図しない値でカードのしっぽを復元しない）。
// target は kind/id が両方揃っている場合のみ残す。
function bdNormalizeTailValue(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const startX = Number(raw.startX);
  const startY = Number(raw.startY);
  const endX = Number(raw.endX);
  const endY = Number(raw.endY);
  if (![startX, startY, endX, endY].every(Number.isFinite)) return null;
  const tail = { startX, startY, endX, endY, target: null };
  const target = raw.target;
  if (target && typeof target === 'object' && target.kind && target.id != null && String(target.id) !== '') {
    const normalizedTarget = { kind: String(target.kind), id: String(target.id) };
    ['offsetX', 'offsetY', 'offsetXRatio', 'offsetYRatio'].forEach(key => {
      const n = Number(target[key]);
      if (Number.isFinite(n)) normalizedTarget[key] = n;
    });
    tail.target = normalizedTarget;
  }
  return tail;
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

// 旧式ボード互換: フロントマター直下に `nodes:` をカード配列（各要素が
// id/text/x/y/w/h/color 等をフラットに持つ、YAML block style のリスト）として
// 直接持つスキーマの読み取り専用パーサ。現行の positions/sizes マップ方式や
// 本文見出し方式とは別の並存フォーマット（例: 同梱サンプル
// 「死霊探偵/キャラ相関図.board.md」）向け。
//
// bdYamlListObjects は各プロパティが1行で完結する前提（`from: n1, to: n2` 等の
// フロー形式や単一行スカラー）のため、この関数はそれとは別に、複数行にまたがる
// 折り畳みスカラー（引用符あり/なしいずれも）を先頭〜終端まで蓄積してから
// 1つの値へ畳み込む。畳み込み規則は本文見出しパーサ（bdParseMd の "# " 解析）と
// 揃え、空行は落として残りの行を単一の '\n' で結合する（段落ごとに改行1つ）。
function bdParseFrontmatterNodeList(fm) {
  const lines = bdYamlTopLevelBlock(fm, 'nodes');
  const items = [];
  let current = null;
  let openKey = '';
  let openLines = null;

  const finishOpen = () => {
    if (!current || !openKey || !openLines) return;
    const nonEmpty = openLines.filter(l => l.trim().length > 0);
    let value;
    if (!nonEmpty.length) {
      value = '';
    } else if (nonEmpty.length === 1) {
      value = bdYamlScalar(nonEmpty[0].trim());
    } else {
      const first = nonEmpty[0].trim();
      const last = nonEmpty[nonEmpty.length - 1].trim();
      const quoteChar = (first[0] === "'" || first[0] === '"') ? first[0] : '';
      if (quoteChar && last.endsWith(quoteChar)) {
        const folded = nonEmpty.map((l, i) => {
          let t = l.trim();
          if (i === 0 && t.startsWith(quoteChar)) t = t.slice(1);
          if (i === nonEmpty.length - 1 && t.endsWith(quoteChar)) t = t.slice(0, -1);
          if (quoteChar === "'") t = t.replace(/''/g, "'");
          return t;
        });
        value = folded.join('\n');
      } else {
        value = nonEmpty.map(l => l.trim()).join('\n');
      }
    }
    current[openKey] = value;
    openKey = ''; openLines = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    const itemMatch = line.match(/^-\s*(.*)$/);
    if (itemMatch) {
      finishOpen();
      current = {};
      items.push(current);
      const pair = itemMatch[1].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
      if (pair) { openKey = pair[1]; openLines = [pair[2]]; }
      continue;
    }
    if (!current) continue;
    const propMatch = line.match(/^  ([A-Za-z_][\w-]*):\s*(.*)$/);
    if (propMatch) {
      finishOpen();
      openKey = propMatch[1];
      openLines = [propMatch[2]];
      continue;
    }
    if (openLines) openLines.push(line);
  }
  finishOpen();
  return items.filter(item => Number.isFinite(+item.x) && Number.isFinite(+item.y));
}
