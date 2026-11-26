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
    const rawKey = match[1].trim();
    const key = rawKey.replace(/^(['"])([\s\S]*)\1$/, '$2');
    return { key, raw: match[2] == null ? '' : match[2].trim() };
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

  // ---------------------------------------------------------------------------
  // デスクトップ版（PyYAML）が書くYAMLを、Cloud版でも同じ値として読むための読込。
  // 旧 yamlLite は、80桁で折り返された長い値・複数行の引用符つき文字列・リスト項目の
  // 中のリスト（`- value:` の下の `- 神聖`）を読めず、値を切り詰めたり後続のキー
  // （status 等）を落としたりしていた（実データ settings-entry 1061件中423件）。
  // それをそのまま書き戻すとデータが消えるため、読めない形を見つけた時は結果に
  // LOSSY_MARK を付け、frontmatterText は書込を拒否する。
  // ---------------------------------------------------------------------------
  const LOSSY_MARK = (typeof Symbol === 'function' && Symbol.for)
    ? Symbol.for('meldex.frontmatter.lossy') : '__meldexFrontmatterLossy';

  function _yamlEscapeToJson(body) {
    let out = '';
    for (let i = 0; i < body.length; i += 1) {
      const ch = body[i];
      if (ch !== '\\') {
        // 折り畳みで入った改行などの制御文字は、JSONとして読めるよう符号化する。
        const code = ch.charCodeAt(0);
        out += code < 0x20 ? '\\u' + code.toString(16).padStart(4, '0') : ch;
        continue;
      }
      const next = body[i + 1];
      i += 1;
      if (next === undefined) return null;
      if ('"\\/bfnrt'.includes(next)) out += '\\' + next;
      else if (next === '0') out += '\\u0000';
      else if (next === 'a') out += '\\u0007';
      else if (next === 'v') out += '\\u000b';
      else if (next === 'e') out += '\\u001b';
      else if (next === ' ') out += ' ';
      else if (next === 'N') out += '\\u0085';
      else if (next === '_') out += '\\u00a0';
      else if (next === 'L') out += '\\u2028';
      else if (next === 'P') out += '\\u2029';
      else if (next === 'x') { out += '\\u00' + body.slice(i + 1, i + 3); i += 2; }
      else if (next === 'u') { out += '\\u' + body.slice(i + 1, i + 5); i += 4; }
      else if (next === 'U') {
        const code = parseInt(body.slice(i + 1, i + 9), 16);
        if (!Number.isFinite(code)) return null;
        out += JSON.stringify(String.fromCodePoint(code)).slice(1, -1);
        i += 8;
      } else return null;
    }
    return out;
  }

  function _yamlTrim(text) {
    return String(text == null ? '' : text).replace(/^[ \t]+|[ \t]+$/g, '');
  }

  function _yamlResolvePlain(text) {
    const value = String(text);
    if (/^(?:~|null|Null|NULL)?$/.test(value)) return null;
    if (/^(?:true|True|TRUE|yes|Yes|YES|on|On|ON)$/.test(value)) return true;
    if (/^(?:false|False|FALSE|no|No|NO|off|Off|OFF)$/.test(value)) return false;
    if (/^[-+]?(?:0|[1-9][0-9_]*)$/.test(value)) return Number(value.replace(/_/g, ''));
    if (/^0x[0-9a-fA-F_]+$/.test(value)) return parseInt(value.slice(2).replace(/_/g, ''), 16);
    if (/^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*(?:[eE][-+][0-9]+)?$/.test(value) && /[0-9]/.test(value)) {
      return Number(value.replace(/_/g, ''));
    }
    if (/^[-+]?\.(?:inf|Inf|INF)$/.test(value)) return value.startsWith('-') ? -Infinity : Infinity;
    if (/^\.(?:nan|NaN|NAN)$/.test(value)) return NaN;
    return value;
  }

  // \r\n・\r・\n・U+0085・U+2028・U+2029（ソースに制御文字を直接書かないよう実行時に組み立てる）。
  const YAML_LINE_BREAKS = new RegExp('\\r\\n|[\\r\\n' + String.fromCharCode(0x85, 0x2028, 0x2029) + ']', 'g');

  function parseYamlDocument(source) {
    // YAML 1.1（PyYAML）は U+0085・U+2028・U+2029 も改行として扱う。
    const raw = String(source || '').split(YAML_LINE_BREAKS);
    const anchors = new Map();
    // 折り畳み時、\n・\r・U+0085 は空白になるが、U+2028・U+2029 はその文字のまま残る。
    const keptBreaks = String.fromCharCode(0x2028, 0x2029);
    const breakChars = String(source || '').match(YAML_LINE_BREAKS) || [];
    const lines = raw.map((text, i) => ({
      text,
      breakBefore: i > 0 ? breakChars[i - 1] : '',
      indent: (text.match(/^ */) || [''])[0].length,
      // YAMLの空白はASCIIの空白とタブだけ。全角空白（U+3000）は本文として残す。
      blank: !/[^ \t]/.test(text),
      comment: /^[ \t]*#/.test(text),
    }));
    const normalizedBreak = (index) => {
      const value = lines[index] ? lines[index].breakBefore : '';
      return value && keptBreaks.includes(value) ? value : '\n';
    };
    // 内容行 from から次の内容行 to（間は空行だけ）へ移る時に挟む文字（PyYAMLの折り畳み規則）。
    const foldBetween = (from, to, escapedBreak) => {
      const lineBreak = normalizedBreak(from + 1);
      const breaks = [];
      for (let j = from + 1; j < to; j += 1) breaks.push(normalizedBreak(j + 1));
      if (escapedBreak) return breaks.join('');
      return (lineBreak !== '\n' ? lineBreak : (breaks.length ? '' : ' ')) + breaks.join('');
    };
    let lossy = false;
    const markLossy = () => { lossy = true; };
    if (/\t/.test(String(source || '').replace(/(["'])(?:\\.|(?!\1).)*\1/g, ''))) markLossy();

    const skip = (index) => {
      while (index < lines.length && (lines[index].blank || lines[index].comment)) index += 1;
      return index;
    };
    const isSeqItem = (text, col) => text.length > col && text[col] === '-' && (text.length === col + 1 || text[col + 1] === ' ');

    function splitKey(content) {
      // content は行頭（字下げ除く）。キーと値の区切りの ": " または行末の ":" を探す。
      if (content.startsWith('"') || content.startsWith("'")) {
        const quote = content[0];
        let end = 1;
        for (; end < content.length; end += 1) {
          if (quote === '"' && content[end] === '\\') { end += 1; continue; }
          if (content[end] === quote) {
            if (quote === "'" && content[end + 1] === "'") { end += 1; continue; }
            break;
          }
        }
        const after = content.slice(end + 1);
        const m = after.match(/^[ \t]*:(?:[ \t]+|$)/);
        if (!m) return null;
        const inner = content.slice(1, end);
        let key = inner.replace(/''/g, "'");
        if (quote === '"') {
          const json = _yamlEscapeToJson(inner);
          try { key = json === null ? inner : JSON.parse('"' + json + '"'); } catch { key = inner; markLossy(); }
        }
        return { key, rest: after.slice(m[0].length) };
      }
      if (/^[?&*!|>%@`]/.test(content) || content.startsWith('[') || content.startsWith('{')) return null;
      const m = content.match(/^(.*?)[ \t]*:(?:[ \t]+|$)/);
      if (!m || !m[1]) return null;
      if (/[ \t]#/.test(m[1])) return null;
      return { key: m[1], rest: content.slice(m[0].length) };
    }

    function stripComment(text, flow = false) {
      // flow内の引用符つきの値（影の「0 2px #色」など）はコメントではない。
      // plain scalar内のアポストロフィーは引用符として扱わない。
      if (flow) {
        let quote = '';
        for (let i = 0; i < text.length; i += 1) {
          const ch = text[i];
          if (quote) {
            if (quote === '"' && ch === '\\') { i += 1; continue; }
            if (ch === quote) {
              if (quote === "'" && text[i + 1] === "'") { i += 1; continue; }
              quote = '';
            }
          } else if (ch === '"' || ch === "'") quote = ch;
          else if (ch === '#' && (i === 0 || /[ \t]/.test(text[i - 1]))) return text.slice(0, i).trimEnd();
        }
        return text;
      }
      const m = text.match(/^(.*?)[ \t]+#.*$/);
      return m ? m[1] : text;
    }

    // 1つのスカラー値を読む。first は開始行の値部分、index は開始行、parentIndent は
    // その値を持つキー（または `-`）の字下げ。継続行（parentIndent より深い行）を折り畳む。
    function readScalar(first, index, parentIndent) {
      const text = _yamlTrim(first);
      if (text.startsWith('&') || text.startsWith('*') || text.startsWith('!') || text.startsWith('?')) { markLossy(); }
      if (text.startsWith('"') || text.startsWith("'")) return readQuoted(text, index, parentIndent);
      if (text.startsWith('|') || text.startsWith('>')) return readBlockScalar(text, index, parentIndent);
      if (text.startsWith('[') || text.startsWith('{')) return readFlow(text, index, parentIndent);
      const parts = [stripComment(text)];
      let last = index;
      let next = index + 1;
      while (next < lines.length) {
        const line = lines[next];
        if (line.blank) { next += 1; continue; }
        if (line.indent <= parentIndent || line.comment) break;
        parts.push(foldBetween(last, next, false));
        parts.push(stripComment(_yamlTrim(line.text)));
        last = next;
        next += 1;
      }
      return { value: _yamlResolvePlain(_yamlTrim(parts.join(''))), index: last + 1 };
    }

    function readQuoted(text, index, parentIndent) {
      const quote = text[0];
      const chunks = [];
      let current = text.slice(1);
      let next = index;
      for (;;) {
        let closeAt = -1;
        for (let i = 0; i < current.length; i += 1) {
          if (quote === '"' && current[i] === '\\') { i += 1; continue; }
          if (current[i] === quote) {
            if (quote === "'" && current[i + 1] === "'") { i += 1; continue; }
            closeAt = i;
            break;
          }
        }
        if (closeAt >= 0) {
          chunks.push(current.slice(0, closeAt));
          const tail = current.slice(closeAt + 1).trim();
          if (tail && !tail.startsWith('#')) markLossy();
          next += 1;
          break;
        }
        chunks.push(current);
        const from = next;
        next += 1;
        while (next < lines.length && lines[next].blank) next += 1;
        if (next >= lines.length) { markLossy(); break; }
        // 行の継ぎ目は PyYAML と同じ規則で折り畳む（空行は改行、U+2028 等はそのまま）。
        chunks.push({ from, to: next });
        current = lines[next].text.replace(/^[ \t]+/, '');
      }
      let body = '';
      chunks.forEach((chunk, i) => {
        if (typeof chunk === 'string') {
          const isLast = i === chunks.length - 1;
          let piece = isLast ? chunk : chunk;
          // 行末の空白は継ぎ目で捨てる（二重引用符の `\` 直前の空白は残す）。
          if (!isLast && !(quote === '"' && /(^|[^\\])(\\\\)*\\$/.test(piece))) piece = piece.replace(/[ \t]+$/, '');
          body += piece;
          return;
        }
        // 二重引用符の行末 `\` は改行の打ち消し（空白を入れない）。
        const escapedBreak = quote === '"' && /(^|[^\\])(\\\\)*\\$/.test(body);
        if (escapedBreak) body = body.slice(0, -1);
        body += foldBetween(chunk.from, chunk.to, escapedBreak);
      });
      if (quote === "'") return { value: body.replace(/''/g, "'"), index: next };
      const json = _yamlEscapeToJson(body);
      if (json === null) { markLossy(); return { value: body, index: next }; }
      try { return { value: JSON.parse('"' + json + '"'), index: next }; }
      catch { markLossy(); return { value: body, index: next }; }
    }

    function readBlockScalar(text, index, parentIndent) {
      const header = text.match(/^([|>])([1-9])?([+-])?([1-9])?\s*(#.*)?$/);
      if (!header) { markLossy(); return { value: '', index: index + 1 }; }
      const folded = header[1] === '>';
      const chomp = header[3] || '';
      const explicit = Number(header[2] || header[4] || 0);
      let next = index + 1;
      const body = [];
      let blockIndent = explicit ? parentIndent + explicit : 0;
      while (next < lines.length) {
        const line = lines[next];
        if (line.blank) { body.push(''); next += 1; continue; }
        if (!blockIndent) blockIndent = line.indent;
        if (line.indent < blockIndent || line.indent <= parentIndent) break;
        body.push(line.text.slice(blockIndent));
        next += 1;
      }
      let trailing = 0;
      while (body.length && body[body.length - 1] === '') { body.pop(); trailing += 1; }
      let value;
      if (folded) {
        value = '';
        body.forEach((line, i) => {
          if (i === 0) { value = line; return; }
          const prev = body[i - 1];
          if (line === '' || prev === '' || /^\s/.test(line) || /^\s/.test(prev)) value += '\n' + line;
          else value += ' ' + line;
        });
        value = value.replace(/\n(?=\n)/g, '\n');
      } else value = body.join('\n');
      if (chomp === '+') value += '\n'.repeat(trailing + 1);
      else if (chomp !== '-' && body.length) value += '\n';
      return { value, index: next };
    }

    function readFlow(text, index, parentIndent) {
      let buffer = text;
      let next = index + 1;
      const balanced = (value) => {
        let depth = 0; let quote = '';
        for (let i = 0; i < value.length; i += 1) {
          const ch = value[i];
          if (quote) {
            if (quote === '"' && ch === '\\') { i += 1; continue; }
            if (ch === quote) quote = '';
            continue;
          }
          if (ch === '"' || ch === "'") quote = ch;
          else if (ch === '[' || ch === '{') depth += 1;
          else if (ch === ']' || ch === '}') depth -= 1;
        }
        return depth <= 0 && !quote;
      };
      while (!balanced(buffer) && next < lines.length && (lines[next].blank || lines[next].indent > parentIndent)) {
        buffer += ' ' + lines[next].text.trim();
        next += 1;
      }
      const trimmed = stripComment(buffer.trim(), true);
      try { return { value: JSON.parse(trimmed), index: next }; } catch {}
      const inline = yamlInline(trimmed);
      if (inline === undefined) { markLossy(); return { value: trimmed, index: next }; }
      // 簡易 flow 読込は入れ子の引用符や折り返しを完全には扱えないため、JSONで読めない
      // 複雑な flow は書き戻し不可として印を付ける（単純な [a, b] / {} は安全）。
      if (/["'][^"']*[,:\[\]{}][^"']*["']/.test(trimmed)) markLossy();
      return { value: inline, index: next };
    }

    function cloneValue(value) {
      return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
    }

    // 値の開始位置（キーの後ろ、または `- ` の後ろ）から1つの値を読む。アンカー（&名前）と
    // 参照（*名前）を解決する。PyYAMLは同じ辞書を2か所で使うと自動でアンカーを書く。
    function readValue(rest, index, col, indentlessSeq) {
      let text = _yamlTrim(rest);
      let anchor = '';
      const anchorMatch = text.match(/^&([^ \t,\[\]{}]+)(?:[ \t]+(.*))?$/);
      if (anchorMatch) {
        anchor = anchorMatch[1];
        text = _yamlTrim(anchorMatch[2] || '');
      }
      let result;
      const alias = text.match(/^\*([^ \t,\[\]{}]+)[ \t]*(?:#.*)?$/);
      if (alias) {
        if (!anchors.has(alias[1])) markLossy();
        result = { value: cloneValue(anchors.has(alias[1]) ? anchors.get(alias[1]) : null), index: index + 1 };
      } else if (text && !text.startsWith('#')) {
        if (anchor && splitKey(text)) markLossy();
        result = readScalar(text, index, col);
      } else {
        const childIndex = skip(index + 1);
        if (childIndex < lines.length && lines[childIndex].indent > col) {
          result = readNodeAt(childIndex, lines[childIndex].indent, lines[childIndex].text.slice(lines[childIndex].indent));
        } else if (indentlessSeq && childIndex < lines.length && lines[childIndex].indent === col
          && isSeqItem(lines[childIndex].text, col)) {
          result = readSeq(childIndex, col);
        } else {
          result = { value: null, index: index + 1 };
        }
      }
      if (anchor) anchors.set(anchor, result.value);
      return result;
    }

    // index から、字下げ col の位置で始まる値（マップ・リスト・スカラー）を読む。
    function readNodeAt(index, col, content) {
      if (isSeqItem(content, 0)) return readSeq(index, col);
      const pair = splitKey(content);
      if (pair) return readMap(index, col);
      return readScalar(content, index, col - 1);
    }

    function readMap(index, col) {
      const out = {};
      let first = true;
      while (index < lines.length) {
        index = skip(index);
        if (index >= lines.length) break;
        const line = lines[index];
        const content = first && line.virtual != null ? line.virtual : line.text.slice(col);
        if (!first || line.virtual == null) {
          if (line.indent < col) break;
          if (line.indent > col) { markLossy(); index += 1; continue; }
          if (isSeqItem(line.text, col)) break;
        }
        first = false;
        const pair = splitKey(content);
        if (!pair) { markLossy(); index += 1; continue; }
        // 重複キーはデスクトップ版（yaml.safe_load）と同じく後勝ち。
        const result = readValue(pair.rest, index, col, true);
        out[pair.key] = result.value;
        index = result.index;
      }
      return { value: out, index };
    }

    function readSeq(index, col) {
      const out = [];
      while (index < lines.length) {
        index = skip(index);
        if (index >= lines.length) break;
        const line = lines[index];
        if (line.indent !== col || !isSeqItem(line.text, col)) {
          if (line.indent > col) { markLossy(); index += 1; continue; }
          break;
        }
        const after = line.text.slice(col + 1);
        const contentOffset = (after.match(/^ */) || [''])[0].length;
        const content = after.slice(contentOffset);
        if (!content || content.startsWith('#') || content.startsWith('&') || content.startsWith('*')) {
          const result = readValue(content, index, col, false);
          out.push(result.value);
          index = result.index;
          continue;
        }
        const itemCol = col + 1 + contentOffset;
        if (isSeqItem(content, 0)) {
          // `- - a` の入れ子リスト: 内側を仮想行として読む。
          lines[index] = { ...line, text: ' '.repeat(itemCol) + content, indent: itemCol };
          const child = readSeq(index, itemCol);
          out.push(child.value);
          index = child.index;
          continue;
        }
        if (splitKey(content)) {
          lines[index] = { ...line, virtual: content };
          const child = readMap(index, itemCol);
          out.push(child.value);
          index = child.index;
          continue;
        }
        const scalar = readScalar(content, index, col);
        out.push(scalar.value);
        index = scalar.index;
      }
      return { value: out, index };
    }

    let value = {};
    const start = skip(0);
    if (start < lines.length) {
      const line = lines[start];
      const content = line.text.slice(line.indent);
      if (content === '---' || content.startsWith('--- ')) markLossy();
      const node = readNodeAt(start, line.indent, content);
      value = node.value;
      if (skip(node.index) < lines.length) markLossy();
    }
    return { value, lossy };
  }

  function markLossyValue(value, lossy) {
    if (lossy && value && typeof value === 'object') {
      Object.defineProperty(value, LOSSY_MARK, { value: true, enumerable: true, configurable: true, writable: true });
    }
    return value;
  }

  function isLossy(value) {
    return !!(value && typeof value === 'object' && value[LOSSY_MARK]);
  }

  function assertWritable(frontmatter) {
    if (isLossy(frontmatter)) {
      throw Object.assign(new Error('このファイルの設定欄には、Cloud版で正確に読めない書き方が含まれるため、内容を守るために保存を中止しました。デスクトップ版で開いて保存すると解消します'), {
        status: 409, code: 'frontmatter_not_round_trippable',
      });
    }
  }

  function yamlLite(text) {
    const parsed = parseYamlDocument(text);
    const value = parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value) ? parsed.value : {};
    return markLossyValue(value, parsed.lossy || value !== parsed.value);
  }

  function frontmatterText(frontmatter, body) {
    assertWritable(frontmatter);
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
    let revision = null;
    let exists = true;
    try {
      const readSnapshot = provider.readBytesSnapshot || provider.readBytesFresh;
      if (typeof readSnapshot === 'function') {
        const snapshot = await readSnapshot.call(provider, path);
        text = new TextDecoder().decode(snapshot.bytes);
        revision = snapshot.revision || null;
        if (!revision) throw Object.assign(new Error('読込時の保存条件を確認できません'), { status: 503 });
      } else {
        text = await provider.readText(path);
      }
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      exists = false;
    }
    const match = String(text).match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    const snapshot = { sourceText: text, revision, exists };
    if (!match) return { frontmatter: {}, body: text, ...snapshot };
    return { frontmatter: yamlLite(match[1]), body: text.slice(match[0].length), ...snapshot };
  }

  async function writeFrontmatter(provider, path, frontmatter, body, snapshot) {
    if (!snapshot || (snapshot.exists !== false && !snapshot.revision)) {
      throw Object.assign(new Error('読込時の保存条件がないため書込を中止しました'), {
        status: 503, code: 'strict_cas_unavailable',
      });
    }
    const content = frontmatterText(frontmatter, body);
    if (typeof window.apiPut === 'function') {
      return window.apiPut('/file?path=' + encodeURIComponent(path), {
        content,
        base_content: snapshot.sourceText || '',
        ...(snapshot.exists === false ? { create_only: true } : { if_match_etag: snapshot.revision }),
      });
    }
    if (typeof provider.uploadBytesConditional !== 'function') {
      throw Object.assign(new Error('条件付き保存に対応していません'), { status: 503, code: 'strict_cas_unavailable' });
    }
    return provider.uploadBytesConditional(path, new TextEncoder().encode(content),
      snapshot.exists === false ? null : snapshot.revision);
  }

  window.MeldexCloudFrontmatterLite = {
    isNotFoundError,
    isWriteAccessError,
    yamlPair,
    yamlSplitInline,
    yamlInline,
    yamlScalar,
    yamlLite,
    parseYamlDocument,
    isLossy,
    assertWritable,
    LOSSY_MARK,
    frontmatterText,
    readFrontmatter,
    writeFrontmatter,
  };
})();
