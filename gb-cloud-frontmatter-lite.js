/* gb-cloud-frontmatter-lite.js: クラウド静的版（Dropboxブラウザ完結版）共通のYAML-lite
   フロントマター読み書き。Python `meldex_frontmatter.write_frontmatter` と相互互換な
   『1行1キー、値はJSON.stringify』形式。
   利用元: gb-production-management.part01/02.js、gb-staff-registry-cloud-twin.js
   `gb-data-access-dropbox-expanded.js` / `gb-data-access-dropbox-chat.js` の
   `_yamlLiteObject` 系は別方式（ブロックスカラー対応）のため統合対象外。 */
(function () {
  'use strict';

  function isNotFoundError(error) {
    const name = String(error?.name || '').toLowerCase();
    const code = String(error?.code || error?.status || error?.error_summary || '').toLowerCase();
    const message = String(error?.message || error || '').toLowerCase();
    return name === 'notfounderror' || code === '404' || code.includes('not_found')
      || /(^|\b)(missing|not[ _-]?found)(\b|:)/.test(message)
      || /(?:フォルダ|ファイル).*(?:見つかりません|存在しません)/.test(message);
  }

  function isWriteAccessError(error) {
    const status = Number(error?.status || 0);
    const name = String(error?.name || '');
    const message = String(error?.message || error || '');
    return [401, 403, 405, 507].includes(status)
      || /^(NotAllowedError|NoModificationAllowedError|QuotaExceededError)$/i.test(name)
      || /閲覧専用|書き込めません|書き込みを停止|Dropbox\s*容量|quota|write capability/i.test(message);
  }

  function yamlPair(text) {
    const match = String(text || '').match(/^([^:#][^:]*):(?:\s*(.*))?$/);
    if (!match) return null;
    return { key: match[1].trim(), raw: match[2] == null ? '' : match[2].trim() };
  }

  function yamlSplitInline(text) {
    const parts = [];
    let quote = '';
    let depth = 0;
    let start = 0;
    const value = String(text || '');
    for (let i = 0; i < value.length; i += 1) {
      const ch = value[i];
      if (quote) {
        if (ch === quote && value[i - 1] !== '\\') quote = '';
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '{' || ch === '[') depth += 1;
      else if (ch === '}' || ch === ']') depth -= 1;
      else if (ch === ',' && depth === 0) {
        parts.push(value.slice(start, i).trim());
        start = i + 1;
      }
    }
    parts.push(value.slice(start).trim());
    return parts.filter(Boolean);
  }

  function yamlInline(text) {
    if (text.startsWith('[') && text.endsWith(']')) {
      const body = text.slice(1, -1).trim();
      return body ? yamlSplitInline(body).map(yamlScalar) : [];
    }
    if (text.startsWith('{') && text.endsWith('}')) {
      const body = text.slice(1, -1).trim();
      const out = {};
      if (!body) return out;
      yamlSplitInline(body).forEach((part) => {
        const pair = yamlPair(part);
        if (pair) out[pair.key] = yamlScalar(pair.raw);
      });
      return out;
    }
    return undefined;
  }

  function yamlScalar(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    try { return JSON.parse(text); } catch {}
    if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
      const inline = yamlInline(text);
      if (inline !== undefined) return inline;
    }
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (text === 'null') return null;
    if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
    return text.replace(/^['"]|['"]$/g, '');
  }

  function yamlLite(text) {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map(line => ({ indent: (line.match(/^\s*/) || [''])[0].length, text: line.trim() }))
      .filter(line => line.text && !line.text.startsWith('#'));
    function parseBlock(index, indent) {
      if (index >= lines.length) return { value: {}, index };
      if (lines[index].indent < indent) return { value: {}, index };
      return lines[index].text.startsWith('- ')
        ? parseArray(index, lines[index].indent)
        : parseObject(index, indent);
    }
    function parseObject(index, indent) {
      const out = {};
      while (index < lines.length && lines[index].indent >= indent) {
        const line = lines[index];
        if (line.indent < indent || line.text.startsWith('- ')) break;
        if (line.indent > indent) { index += 1; continue; }
        const pair = yamlPair(line.text);
        if (!pair) { index += 1; continue; }
        index += 1;
        if (pair.raw) out[pair.key] = yamlScalar(pair.raw);
        else {
          const nested = parseBlock(index, indent + 2);
          out[pair.key] = nested.value;
          index = nested.index;
        }
      }
      return { value: out, index };
    }
    function parseArray(index, indent) {
      const out = [];
      while (index < lines.length && lines[index].indent === indent && lines[index].text.startsWith('- ')) {
        const item = lines[index].text.slice(2).trim();
        index += 1;
        let value;
        if (!item) {
          const nested = parseBlock(index, indent + 2);
          value = nested.value;
          index = nested.index;
        } else if (item.startsWith('{') || item.startsWith('[')) {
          value = yamlScalar(item);
        } else if (yamlPair(item)) {
          const first = yamlPair(item);
          value = {};
          value[first.key] = first.raw ? yamlScalar(first.raw) : {};
          const nested = parseObject(index, indent + 2);
          value = { ...value, ...(nested.value || {}) };
          index = nested.index;
        } else {
          value = yamlScalar(item);
        }
        out.push(value);
      }
      return { value: out, index };
    }
    return parseBlock(0, 0).value || {};
  }

  function frontmatterText(frontmatter, body) {
    const lines = ['---'];
    Object.entries(frontmatter || {}).forEach(([key, value]) => {
      if (!key || key.startsWith('_')) return;
      lines.push(`${key}: ${JSON.stringify(value == null ? '' : value)}`);
    });
    lines.push('---', '');
    return lines.join('\n') + String(body || '');
  }

  async function readFrontmatter(provider, path) {
    let text = '';
    try {
      text = await provider.readText(path);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
    const match = String(text).match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) return { frontmatter: {}, body: text };
    return { frontmatter: yamlLite(match[1]), body: text.slice(match[0].length) };
  }

  window.MeldexCloudFrontmatterLite = {
    isNotFoundError,
    isWriteAccessError,
    yamlPair,
    yamlSplitInline,
    yamlInline,
    yamlScalar,
    yamlLite,
    frontmatterText,
    readFrontmatter,
  };
})();
