/* note-standalone-markdown.js */
(function (root) {
  'use strict';

  const FRONT_COMMENT = 'meldex-front-matter:';
  const STATE_COMMENT = 'meldex-document-state:';
  const USER_COMMENT = 'meldex-markdown-comment:';
  const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const BLOCK_TAGS = new Set(['blockquote', 'details', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'ol', 'p', 'pre', 'table', 'ul']);
  const DROP_TAGS = new Set(['base', 'embed', 'iframe', 'link', 'meta', 'object', 'script', 'style', 'svg']);

  function utf8Bytes(value) {
    const bytes = [];
    for (const char of String(value || '')) {
      const cp = char.codePointAt(0);
      if (cp <= 0x7f) bytes.push(cp);
      else if (cp <= 0x7ff) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
      else if (cp <= 0xffff) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
    return bytes;
  }

  function encodeData(value) {
    const bytes = utf8Bytes(value);
    let output = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i];
      const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
      const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
      const bits = (a << 16) | (b << 8) | c;
      output += BASE64_CHARS[(bits >> 18) & 63];
      output += BASE64_CHARS[(bits >> 12) & 63];
      output += i + 1 < bytes.length ? BASE64_CHARS[(bits >> 6) & 63] : '=';
      output += i + 2 < bytes.length ? BASE64_CHARS[bits & 63] : '=';
    }
    return output;
  }

  function decodeData(value) {
    const input = String(value || '').replace(/\s+/g, '');
    if (!input || input.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(input)) return '';
    const bytes = [];
    for (let i = 0; i < input.length; i += 4) {
      const a = BASE64_CHARS.indexOf(input[i]);
      const b = BASE64_CHARS.indexOf(input[i + 1]);
      const c = input[i + 2] === '=' ? 0 : BASE64_CHARS.indexOf(input[i + 2]);
      const d = input[i + 3] === '=' ? 0 : BASE64_CHARS.indexOf(input[i + 3]);
      if (a < 0 || b < 0 || c < 0 || d < 0) return '';
      const bits = (a << 18) | (b << 12) | (c << 6) | d;
      bytes.push((bits >> 16) & 0xff);
      if (input[i + 2] !== '=') bytes.push((bits >> 8) & 0xff);
      if (input[i + 3] !== '=') bytes.push(bits & 0xff);
    }
    let output = '';
    for (let i = 0; i < bytes.length;) {
      const a = bytes[i++];
      if (a < 0x80) output += String.fromCodePoint(a);
      else if ((a & 0xe0) === 0xc0 && i < bytes.length) {
        output += String.fromCodePoint(((a & 0x1f) << 6) | (bytes[i++] & 0x3f));
      } else if ((a & 0xf0) === 0xe0 && i + 1 < bytes.length) {
        output += String.fromCodePoint(((a & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
      } else if ((a & 0xf8) === 0xf0 && i + 2 < bytes.length) {
        output += String.fromCodePoint(((a & 7) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
      }
    }
    return output;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function decodeEntities(value) {
    return String(value || '').replace(/&(?:#(\d+)|#x([0-9a-f]+)|amp|lt|gt|quot|apos|nbsp|#39);/gi, (match, decimal, hex) => {
      if (decimal) return String.fromCodePoint(Math.min(0x10ffff, Number(decimal)));
      if (hex) return String.fromCodePoint(Math.min(0x10ffff, parseInt(hex, 16)));
      const named = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&nbsp;': '\u00a0' };
      return named[match.toLowerCase()] || match;
    });
  }

  function splitDocument(value) {
    const text = String(value || '');
    const offset = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    const firstBreak = text.indexOf('\n', offset);
    const firstLineEnd = firstBreak < 0 ? text.length : firstBreak;
    const firstLine = text.slice(offset, firstLineEnd).replace(/\r$/, '');
    if (firstLine !== '---' || firstBreak < 0) {
      return { frontMatter: '', body: text, hasFrontMatter: false };
    }
    let cursor = firstBreak + 1;
    while (cursor <= text.length) {
      const nextBreak = text.indexOf('\n', cursor);
      const lineEnd = nextBreak < 0 ? text.length : nextBreak;
      const line = text.slice(cursor, lineEnd).replace(/\r$/, '');
      if (/^(?:---|\.\.\.)[ \t]*$/.test(line)) {
        const frontEnd = nextBreak < 0 ? lineEnd : nextBreak + 1;
        return {
          frontMatter: text.slice(0, frontEnd),
          body: text.slice(frontEnd),
          hasFrontMatter: true,
        };
      }
      if (nextBreak < 0) break;
      cursor = nextBreak + 1;
    }
    return { frontMatter: '', body: text, hasFrontMatter: false };
  }

  function lineEndingCode(value) {
    if (value === '\r\n') return 'r';
    if (value === '\r') return 'c';
    return 'n';
  }

  function lineEndingFromCode(value) {
    if (value === 'r') return '\r\n';
    if (value === 'c') return '\r';
    return '\n';
  }

  function prepareBody(value) {
    const body = String(value || '');
    const endings = body.match(/\r\n|\r|\n/g) || [];
    const codes = endings.map(lineEndingCode);
    if (!codes.some(code => code !== 'n')) return { body, state: null };
    const counts = { n: 0, r: 0, c: 0 };
    codes.forEach(code => { counts[code]++; });
    let preferred = codes[0] || 'n';
    for (const code of ['r', 'n', 'c']) {
      if (counts[code] > counts[preferred]) preferred = code;
    }
    const mixed = codes.some(code => code !== codes[0]);
    return {
      body: body.replace(/\r\n|\r/g, '\n'),
      state: { version: 1, preferred, endings: mixed ? codes.join('') : '' },
    };
  }

  function parseDocumentState(value) {
    try {
      const parsed = JSON.parse(decodeData(value));
      if (parsed?.version !== 1 || !/^[nrc]$/.test(parsed.preferred || '')) return null;
      if (parsed.endings && !/^[nrc]+$/.test(parsed.endings)) return null;
      return { preferred: parsed.preferred, endings: parsed.endings || '' };
    } catch {
      return null;
    }
  }

  function restoreBody(value, state) {
    const body = String(value || '').replace(/\r\n|\r/g, '\n');
    if (!state) return body;
    const count = (body.match(/\n/g) || []).length;
    const exact = state.endings && state.endings.length === count ? state.endings : '';
    let index = 0;
    return body.replace(/\n/g, () => lineEndingFromCode(exact ? exact[index++] : state.preferred));
  }

  function isEscaped(text, index) {
    let slashes = 0;
    for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) slashes++;
    return slashes % 2 === 1;
  }

  function findUnescaped(text, needle, start) {
    let index = text.indexOf(needle, start);
    while (index >= 0) {
      if (!isEscaped(text, index)) return index;
      index = text.indexOf(needle, index + needle.length);
    }
    return -1;
  }

  function safeContentUrl(destination, kind) {
    let value = String(destination || '').trim();
    if (value.startsWith('<') && value.endsWith('>')) value = value.slice(1, -1).trim();
    else {
      const titleStart = value.search(/[ \t]+(?=["'])/);
      if (titleStart >= 0) value = value.slice(0, titleStart);
    }
    value = value.replace(/\\([()])/g, '$1');
    if (!value || /[\u0000-\u001f\u007f]/.test(value)) return '';
    const scheme = value.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase() || '';
    if (!scheme) return value.startsWith('//') ? '' : value;
    if (kind === 'image') return ['http', 'https'].includes(scheme) ? value : '';
    return ['http', 'https', 'mailto', 'tel'].includes(scheme) ? value : '';
  }

  function parseLinkAt(text, start, image) {
    const labelStart = start + (image ? 2 : 1);
    const labelEnd = findUnescaped(text, ']', labelStart);
    if (labelEnd < 0 || text[labelEnd + 1] !== '(') return null;
    let depth = 1;
    let angle = false;
    for (let i = labelEnd + 2; i < text.length; i++) {
      if (isEscaped(text, i)) continue;
      if (text[i] === '<' && depth === 1) angle = true;
      else if (text[i] === '>' && angle) angle = false;
      else if (!angle && text[i] === '(') depth++;
      else if (!angle && text[i] === ')' && --depth === 0) {
        return { label: text.slice(labelStart, labelEnd), destination: text.slice(labelEnd + 2, i), end: i + 1 };
      }
    }
    return null;
  }

  function renderInline(text) {
    const source = String(text || '');
    let html = '';
    let i = 0;
    while (i < source.length) {
      if (source.startsWith('<!--', i)) {
        const end = source.indexOf('-->', i + 4);
        if (end >= 0) {
          const raw = source.slice(i, end + 3);
          html += `<!--${USER_COMMENT}${encodeData(raw)}-->`;
          i = end + 3;
          continue;
        }
      }
      if (source[i] === '\\' && i + 1 < source.length) {
        const raw = source.slice(i, i + 2);
        html += `<span data-md-escape="${encodeData(raw)}">${escapeHtml(source[i + 1])}</span>`;
        i += 2;
        continue;
      }
      if (source[i] === '`') {
        let ticks = 1;
        while (source[i + ticks] === '`') ticks++;
        const marker = '`'.repeat(ticks);
        const end = findUnescaped(source, marker, i + ticks);
        if (end >= 0) {
          html += `<code data-md-marker="${marker}">${escapeHtml(source.slice(i + ticks, end))}</code>`;
          i = end + ticks;
          continue;
        }
      }
      const isImage = source.startsWith('![', i);
      if (isImage || source[i] === '[') {
        const parsed = parseLinkAt(source, i, isImage);
        if (parsed) {
          const url = safeContentUrl(parsed.destination, isImage ? 'image' : 'link');
          const data = encodeData(parsed.destination);
          if (isImage) {
            const alt = parsed.label.replace(/\\([\]\\])/g, '$1');
            html += url
              ? `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" data-md-alt="${encodeData(parsed.label)}" data-md-destination="${data}">`
              : `<span role="img" data-md-image="1" data-md-alt="${encodeData(parsed.label)}" data-md-destination="${data}">${escapeHtml(alt)}</span>`;
          } else {
            const inner = renderInline(parsed.label);
            html += url
              ? `<a href="${escapeAttr(url)}" rel="noopener noreferrer" data-md-destination="${data}">${inner}</a>`
              : `<span data-md-link="1" data-md-destination="${data}">${inner}</span>`;
          }
          i = parsed.end;
          continue;
        }
      }
      const markers = source.startsWith('***', i)
        ? [['***', 'strong-em']]
        : source.startsWith('___', i)
          ? [['___', 'strong-em']]
          : source.startsWith('**', i)
            ? [['**', 'strong']]
            : source.startsWith('__', i)
              ? [['__', 'strong']]
              : source.startsWith('~~', i)
                ? [['~~', 'strike']]
                : source[i] === '*' || source[i] === '_' ? [[source[i], 'em']] : [];
      if (markers.length) {
        const [marker, type] = markers[0];
        const end = findUnescaped(source, marker, i + marker.length);
        if (end > i + marker.length) {
          const inner = renderInline(source.slice(i + marker.length, end));
          if (type === 'strong-em') html += `<strong data-md-marker="${marker}"><em>${inner}</em></strong>`;
          else if (type === 'strong') html += `<strong data-md-marker="${marker}">${inner}</strong>`;
          else if (type === 'strike') html += `<s data-md-marker="${marker}">${inner}</s>`;
          else html += `<em data-md-marker="${marker}">${inner}</em>`;
          i = end + marker.length;
          continue;
        }
      }
      let end = i + 1;
      while (end < source.length && !'\\`[!*_~<'.includes(source[end])) end++;
      html += escapeHtml(source.slice(i, end));
      i = end;
    }
    return html;
  }

  function parseTableRow(line) {
    let text = String(line || '').trim();
    if (text.startsWith('|')) text = text.slice(1);
    if (text.endsWith('|') && !isEscaped(text, text.length - 1)) text = text.slice(0, -1);
    const cells = [];
    let cell = '';
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '|' && !isEscaped(text, i)) {
        cells.push(cell.trim());
        cell = '';
      } else cell += text[i];
    }
    cells.push(cell.trim());
    return cells;
  }

  function isTableSeparator(line) {
    const cells = parseTableRow(line);
    return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell.trim()));
  }

  function hasUnescapedPipe(line) {
    const text = String(line || '');
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '|' && !isEscaped(text, i)) return true;
    }
    return false;
  }

  function isTableStart(header, separator) {
    if (!hasUnescapedPipe(header) || !isTableSeparator(separator)) return false;
    return parseTableRow(header).length === parseTableRow(separator).length;
  }

  function renderTable(lines, start) {
    const header = parseTableRow(lines[start]);
    const separator = lines[start + 1];
    const rows = [{ source: lines[start], cells: header, header: true }];
    let end = start + 2;
    while (end < lines.length && /\|/.test(lines[end]) && lines[end].trim()) {
      rows.push({ source: lines[end], cells: parseTableRow(lines[end]), header: false });
      end++;
    }
    let html = `<table data-md-table="1" data-md-separator="${encodeData(separator)}"><thead>`;
    rows.forEach((row, index) => {
      if (index === 1) html += '</thead><tbody>';
      const tag = row.header ? 'th' : 'td';
      html += `<tr data-md-source="${encodeData(row.source)}" data-md-cells="${encodeData(JSON.stringify(row.cells))}">`;
      row.cells.forEach(cell => { html += `<${tag}>${renderInline(cell)}</${tag}>`; });
      html += '</tr>';
    });
    if (rows.length === 1) html += '</thead><tbody>';
    html += '</tbody></table>';
    return { html, end };
  }

  function listMatch(line) {
    const match = String(line || '').match(/^(\s*)([-+*]|\d+[.)])([ \t]+)(.*)$/);
    if (!match) return null;
    return { indent: match[1], marker: match[2], spacing: match[3], content: match[4], type: /^\d/.test(match[2]) ? 'ol' : 'ul' };
  }

  function renderListRange(items, start, indentLength) {
    let index = start;
    let html = '';
    while (index < items.length && items[index].indent.length === indentLength) {
      const type = items[index].type;
      html += `<${type} data-md-list="1">`;
      while (index < items.length && items[index].indent.length === indentLength && items[index].type === type) {
        const item = items[index++];
        html += `<li data-md-indent="${encodeData(item.indent)}" data-md-marker="${encodeData(item.marker)}" data-md-spacing="${encodeData(item.spacing)}">${renderInline(item.content)}`;
        while (index < items.length && items[index].indent.length > indentLength) {
          const nested = renderListRange(items, index, items[index].indent.length);
          html += nested.html;
          index = nested.end;
        }
        html += '</li>';
      }
      html += `</${type}>`;
    }
    return { html, end: index };
  }

  function renderList(lines, start) {
    const items = [];
    let end = start;
    while (end < lines.length) {
      const item = listMatch(lines[end]);
      if (!item) break;
      items.push(item);
      end++;
    }
    const rendered = renderListRange(items, 0, items[0].indent.length);
    return { html: rendered.html, end: start + rendered.end };
  }

  function renderQuote(lines, start) {
    let end = start;
    let html = '<blockquote data-md-quote="1">';
    while (end < lines.length) {
      const match = lines[end].match(/^(\s*(?:>\s*)+)([\s\S]*)$/);
      if (!match) break;
      html += `<div data-md-quote-prefix="${encodeData(match[1])}">${renderInline(match[2])}</div>`;
      end++;
    }
    return { html: html + '</blockquote>', end };
  }

  function renderLines(lines) {
    let html = '';
    for (let i = 0; i < lines.length;) {
      const line = lines[i];
      const fence = line.match(/^(\s*)((?:`{3,})|(?:~{3,}))(.*)$/);
      if (fence) {
        const code = [];
        let end = i + 1;
        let close = '';
        const closePattern = new RegExp('^\\s*' + fence[2][0] + '{' + fence[2].length + ',}\\s*$');
        while (end < lines.length) {
          if (closePattern.test(lines[end])) { close = lines[end++]; break; }
          code.push(lines[end++]);
        }
        const lang = fence[3].trim();
        html += `<pre data-md-open="${encodeData(line)}" data-md-close="${encodeData(close)}" data-md-code-lines="${code.length}"${lang ? ` data-lang="${escapeAttr(lang)}"` : ''}><code>${escapeHtml(code.join('\n'))}</code></pre>`;
        i = end;
        continue;
      }
      if (line.includes('<!--')) {
        const startAt = line.indexOf('<!--');
        let raw = line;
        let end = i + 1;
        while (raw.indexOf('-->', startAt + 4) < 0 && end < lines.length) raw += '\n' + lines[end++];
        if (startAt === 0 && raw.endsWith('-->')) {
          html += `<!--${USER_COMMENT}${encodeData(raw)}-->`;
          i = end;
          continue;
        }
      }
      const detailsOpen = line.match(/^\s*<details(?:\s+open)?\s*>\s*$/i);
      if (detailsOpen) {
        let depth = 1;
        let end = i + 1;
        for (; end < lines.length; end++) {
          if (/^\s*<details(?:\s+open)?\s*>\s*$/i.test(lines[end])) depth++;
          if (/^\s*<\/details>\s*$/i.test(lines[end]) && --depth === 0) break;
        }
        const hasClose = end < lines.length;
        const inner = lines.slice(i + 1, hasClose ? end : lines.length);
        html += `<details${/\sopen\s*>/i.test(line) ? ' open' : ''} data-md-open="${encodeData(line)}" data-md-close="${encodeData(hasClose ? lines[end] : '')}" data-md-has-inner="${inner.length ? '1' : '0'}">${renderLines(inner)}</details>`;
        i = hasClose ? end + 1 : lines.length;
        continue;
      }
      const summary = line.match(/^(\s*<summary>)([\s\S]*)(<\/summary>\s*)$/i);
      if (summary) {
        html += `<summary data-md-prefix="${encodeData(summary[1])}" data-md-suffix="${encodeData(summary[3])}">${renderInline(summary[2])}</summary>`;
        i++;
        continue;
      }
      if (i + 1 < lines.length && isTableStart(line, lines[i + 1])) {
        const table = renderTable(lines, i);
        html += table.html;
        i = table.end;
        continue;
      }
      if (listMatch(line)) {
        const list = renderList(lines, i);
        html += list.html;
        i = list.end;
        continue;
      }
      if (/^\s*>/.test(line)) {
        const quote = renderQuote(lines, i);
        if (quote.end > i) {
          html += quote.html;
          i = quote.end;
          continue;
        }
      }
      const heading = line.match(/^(\s{0,3}#{1,6}[ \t]+)(.*)$/);
      if (heading) {
        const level = heading[1].trimStart().match(/^#+/)[0].length;
        html += `<h${level} data-md-prefix="${encodeData(heading[1])}">${renderInline(heading[2])}</h${level}>`;
        i++;
        continue;
      }
      if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        html += `<hr data-md-source="${encodeData(line)}">`;
        i++;
        continue;
      }
      if (line.trim() === '') {
        html += `<div data-md-blank="${encodeData(line)}"><br></div>`;
        i++;
        continue;
      }
      html += `<div data-md-paragraph-line="1">${renderInline(line)}</div>`;
      i++;
    }
    return html;
  }

  function toHtml(value) {
    const parts = value && typeof value === 'object'
      ? { frontMatter: String(value.frontMatter || ''), body: String(value.body || '') }
      : splitDocument(value);
    const prepared = prepareBody(parts.body);
    const front = parts.frontMatter ? `<!--${FRONT_COMMENT}${encodeData(parts.frontMatter)}-->` : '';
    const state = prepared.state ? `<!--${STATE_COMMENT}${encodeData(JSON.stringify(prepared.state))}-->` : '';
    return front + state + renderLines(prepared.body.split('\n'));
  }

  function parseAttributes(raw) {
    const attrs = Object.create(null);
    const pattern = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let match;
    while ((match = pattern.exec(raw))) {
      attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
    }
    return attrs;
  }

  function findTagEnd(html, start) {
    let quote = '';
    for (let i = start; i < html.length; i++) {
      const char = html[i];
      if (quote) {
        if (char === quote) quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '>') return i;
    }
    return -1;
  }

  function parseHtml(html) {
    const documentNode = { type: 'root', children: [] };
    const stack = [documentNode];
    let cursor = 0;
    const append = node => stack[stack.length - 1].children.push(node);
    while (cursor < html.length) {
      if (html.startsWith('<!--', cursor)) {
        const end = html.indexOf('-->', cursor + 4);
        if (end < 0) { append({ type: 'text', value: html.slice(cursor) }); break; }
        append({ type: 'comment', value: html.slice(cursor + 4, end) });
        cursor = end + 3;
        continue;
      }
      if (html[cursor] !== '<') {
        const end = html.indexOf('<', cursor);
        append({ type: 'text', value: decodeEntities(html.slice(cursor, end < 0 ? html.length : end)) });
        cursor = end < 0 ? html.length : end;
        continue;
      }
      const end = findTagEnd(html, cursor + 1);
      if (end < 0) { append({ type: 'text', value: decodeEntities(html.slice(cursor)) }); break; }
      const raw = html.slice(cursor + 1, end);
      const close = raw.match(/^\s*\/\s*([a-z0-9:-]+)/i);
      if (close) {
        const tag = close[1].toLowerCase();
        for (let i = stack.length - 1; i > 0; i--) {
          if (stack[i].tag === tag) { stack.length = i; break; }
        }
        cursor = end + 1;
        continue;
      }
      const open = raw.match(/^\s*([a-z0-9:-]+)([\s\S]*)$/i);
      if (!open) {
        append({ type: 'text', value: decodeEntities(html.slice(cursor, end + 1)) });
        cursor = end + 1;
        continue;
      }
      const tag = open[1].toLowerCase();
      const node = { type: 'element', tag, attrs: parseAttributes(open[2]), children: [] };
      append(node);
      if (!VOID_TAGS.has(tag) && !/\/\s*$/.test(open[2])) stack.push(node);
      cursor = end + 1;
    }
    return documentNode;
  }

  function attr(node, name) {
    return node?.attrs?.[name] ?? '';
  }

  function hasAttr(node, name) {
    return !!node?.attrs && Object.hasOwn(node.attrs, name);
  }

  function textContent(node) {
    if (!node) return '';
    if (node.type === 'text') return node.value;
    if (node.type === 'comment') return '';
    return (node.children || []).map(textContent).join('');
  }

  function commentMarkdown(node) {
    if (node.type !== 'comment' || !node.value.startsWith(USER_COMMENT)) return '';
    return decodeData(node.value.slice(USER_COMMENT.length));
  }

  function inlineFromNode(node) {
    if (node.type === 'text') return node.value;
    if (node.type === 'comment') return commentMarkdown(node);
    if (node.type !== 'element' || DROP_TAGS.has(node.tag)) return '';
    if (node.tag === 'br') return '\n';
    if (attr(node, 'data-md-escape')) return decodeData(attr(node, 'data-md-escape'));
    const children = inlineFromNodes(node.children.filter(child => child.type !== 'element' || !['ul', 'ol'].includes(child.tag)));
    if (node.tag === 'strong' || node.tag === 'b') {
      const marker = attr(node, 'data-md-marker') || '**';
      if ((marker === '***' || marker === '___') && node.children.length === 1 && node.children[0].tag === 'em') {
        return marker + inlineFromNodes(node.children[0].children) + marker;
      }
      return marker + children + marker;
    }
    if (node.tag === 'em' || node.tag === 'i') {
      const marker = attr(node, 'data-md-marker') || '*';
      return marker + children + marker;
    }
    if (node.tag === 's' || node.tag === 'del') return (attr(node, 'data-md-marker') || '~~') + children + (attr(node, 'data-md-marker') || '~~');
    if (node.tag === 'code') {
      let marker = attr(node, 'data-md-marker') || '`';
      while (textContent(node).includes(marker)) marker += '`';
      return marker + textContent(node) + marker;
    }
    if (node.tag === 'a' || attr(node, 'data-md-link')) {
      const destination = attr(node, 'data-md-destination') ? decodeData(attr(node, 'data-md-destination')) : attr(node, 'href');
      return destination ? `[${children}](${destination})` : children;
    }
    if (node.tag === 'img' || attr(node, 'data-md-image')) {
      const alt = attr(node, 'data-md-alt') ? decodeData(attr(node, 'data-md-alt')) : attr(node, 'alt');
      const destination = attr(node, 'data-md-destination') ? decodeData(attr(node, 'data-md-destination')) : attr(node, 'src');
      return destination ? `![${alt}](${destination})` : alt;
    }
    return children;
  }

  function inlineFromNodes(nodes) {
    return (nodes || []).map(inlineFromNode).join('');
  }

  function inlineFromBlockNodes(nodes) {
    const children = nodes || [];
    if (children.length === 1 && children[0].type === 'element' && children[0].tag === 'br') return '';
    return inlineFromNodes(children);
  }

  function listMarkdown(node, fallbackDepth) {
    const lines = [];
    const items = node.children.filter(child => child.type === 'element' && child.tag === 'li');
    items.forEach((item, index) => {
      const indent = attr(item, 'data-md-indent') ? decodeData(attr(item, 'data-md-indent')) : '  '.repeat(fallbackDepth);
      const marker = attr(item, 'data-md-marker')
        ? decodeData(attr(item, 'data-md-marker'))
        : node.tag === 'ol' ? `${index + 1}.` : '-';
      const spacing = attr(item, 'data-md-spacing') ? decodeData(attr(item, 'data-md-spacing')) : ' ';
      lines.push(indent + marker + spacing + inlineFromBlockNodes(item.children.filter(child => child.type !== 'element' || !['ul', 'ol'].includes(child.tag))));
      item.children.filter(child => child.type === 'element' && ['ul', 'ol'].includes(child.tag)).forEach(child => {
        const nested = listMarkdown(child, fallbackDepth + 1);
        if (nested) lines.push(nested);
      });
    });
    return lines.join('\n');
  }

  function escapeTablePipes(value) {
    let output = '';
    let slashes = 0;
    for (const char of String(value || '')) {
      if (char === '\\') { output += char; slashes++; continue; }
      if (char === '|' && slashes % 2 === 0) output += '\\';
      output += char;
      slashes = 0;
    }
    return output;
  }

  function tableMarkdown(node) {
    const rows = [];
    function collect(current) {
      if (current.type === 'element' && current.tag === 'tr') rows.push(current);
      (current.children || []).forEach(collect);
    }
    collect(node);
    if (!rows.length) return '';
    const output = [];
    rows.forEach((row, index) => {
      const cells = row.children
        .filter(child => child.type === 'element' && ['th', 'td'].includes(child.tag))
        .map(cell => escapeTablePipes(inlineFromNodes(cell.children).trim()));
      let source = '';
      if (attr(row, 'data-md-source') && attr(row, 'data-md-cells')) {
        try {
          const originalCells = JSON.parse(decodeData(attr(row, 'data-md-cells')));
          if (JSON.stringify(originalCells) === JSON.stringify(cells)) source = decodeData(attr(row, 'data-md-source'));
        } catch {
          // 編集済み・破損メタデータは現在のセル値から安全に再構築する。
        }
      }
      output.push(source || `| ${cells.join(' | ')} |`);
      if (index === 0) {
        const separator = attr(node, 'data-md-separator') ? decodeData(attr(node, 'data-md-separator')) : '';
        output.push(separator && parseTableRow(separator).length === cells.length
          ? separator
          : `| ${cells.map(() => '---').join(' | ')} |`);
      }
    });
    return output.join('\n');
  }

  function quoteMarkdown(node) {
    if (attr(node, 'data-md-quote')) {
      return node.children.map(child => {
        if (child.type !== 'element') return inlineFromNode(child);
        const prefix = attr(child, 'data-md-quote-prefix') ? decodeData(attr(child, 'data-md-quote-prefix')) : '> ';
        return prefix + inlineFromBlockNodes(child.children);
      }).join('\n');
    }
    return inlineFromNodes(node.children).split('\n').map(line => '> ' + line).join('\n');
  }

  function blockFromNode(node) {
    if (node.type === 'text') return node.value.trim() ? node.value : null;
    if (node.type === 'comment') return node.value.startsWith(USER_COMMENT) ? commentMarkdown(node) : null;
    if (node.type !== 'element' || DROP_TAGS.has(node.tag)) return null;
    if (hasAttr(node, 'data-md-blank')) return decodeData(attr(node, 'data-md-blank'));
    if (attr(node, 'data-md-paragraph-line')) return inlineFromBlockNodes(node.children);
    if (/^h[1-6]$/.test(node.tag)) {
      const prefix = attr(node, 'data-md-prefix') ? decodeData(attr(node, 'data-md-prefix')) : '#'.repeat(Number(node.tag[1])) + ' ';
      return prefix + inlineFromBlockNodes(node.children);
    }
    if (node.tag === 'hr') return attr(node, 'data-md-source') ? decodeData(attr(node, 'data-md-source')) : '---';
    if (node.tag === 'pre') {
      const open = attr(node, 'data-md-open') ? decodeData(attr(node, 'data-md-open')) : '```' + attr(node, 'data-lang');
      const close = hasAttr(node, 'data-md-close') ? decodeData(attr(node, 'data-md-close')) : '```';
      const codeNode = node.children.find(child => child.type === 'element' && child.tag === 'code');
      const code = textContent(codeNode || node);
      const storedLineCount = Number.parseInt(attr(node, 'data-md-code-lines'), 10);
      const hasCodeLine = code !== '' || (Number.isFinite(storedLineCount) && storedLineCount > 0);
      return open + (hasCodeLine ? '\n' + code : '') + (close ? '\n' + close : '');
    }
    if (node.tag === 'ul' || node.tag === 'ol') return listMarkdown(node, 0);
    if (node.tag === 'blockquote') return quoteMarkdown(node);
    if (node.tag === 'table') return tableMarkdown(node);
    if (node.tag === 'summary') {
      const prefix = attr(node, 'data-md-prefix') ? decodeData(attr(node, 'data-md-prefix')) : '<summary>';
      const suffix = attr(node, 'data-md-suffix') ? decodeData(attr(node, 'data-md-suffix')) : '</summary>';
      return prefix + inlineFromBlockNodes(node.children) + suffix;
    }
    if (node.tag === 'details') {
      const open = attr(node, 'data-md-open') ? decodeData(attr(node, 'data-md-open')) : `<details${Object.hasOwn(node.attrs, 'open') ? ' open' : ''}>`;
      const close = hasAttr(node, 'data-md-close') ? decodeData(attr(node, 'data-md-close')) : '</details>';
      const inner = rootMarkdown(node.children);
      const hasInner = hasAttr(node, 'data-md-has-inner') ? attr(node, 'data-md-has-inner') === '1' : !!inner;
      return open + (hasInner ? '\n' + inner : '') + (close ? '\n' + close : '');
    }
    if (node.tag === 'p') return inlineFromBlockNodes(node.children);
    if (node.tag === 'div') {
      const hasBlocks = node.children.some(child => child.type === 'element' && BLOCK_TAGS.has(child.tag));
      return hasBlocks ? rootMarkdown(node.children) : inlineFromBlockNodes(node.children);
    }
    return inlineFromNodes(node.children);
  }

  function rootMarkdown(nodes) {
    return (nodes || []).map(blockFromNode).filter(value => value !== null).join('\n');
  }

  function fromHtml(value, frontMatterOverride) {
    const tree = parseHtml(String(value || ''));
    let frontMatter = '';
    let documentState = null;
    tree.children = tree.children.filter(node => {
      if (node.type === 'comment' && node.value.startsWith(FRONT_COMMENT)) {
        if (!frontMatter) frontMatter = decodeData(node.value.slice(FRONT_COMMENT.length));
        return false;
      }
      if (node.type === 'comment' && node.value.startsWith(STATE_COMMENT)) {
        if (!documentState) documentState = parseDocumentState(node.value.slice(STATE_COMMENT.length));
        return false;
      }
      return true;
    });
    if (typeof frontMatterOverride === 'string') frontMatter = frontMatterOverride;
    else if (frontMatterOverride && typeof frontMatterOverride === 'object' && Object.hasOwn(frontMatterOverride, 'frontMatter')) {
      frontMatter = String(frontMatterOverride.frontMatter || '');
    }
    const body = restoreBody(rootMarkdown(tree.children), documentState);
    if (frontMatter && body && !/[\r\n]$/.test(frontMatter)) {
      frontMatter += lineEndingFromCode(documentState?.preferred || 'n');
    }
    return frontMatter + body;
  }

  root.MeldexStandaloneMarkdown = Object.freeze({ splitDocument, toHtml, fromHtml });
})(typeof window !== 'undefined' ? window : globalThis);
