/* gb-document-identity.js
 *
 * 固有形式ファイル（.mel-board / .mel-scenario / .mel-timer / .mel-sheet）へ、
 * 安定した文書ID（document_id）を追加型メタデータとして保存するための共通
 * ヘルパー。app/meldex_document_identity.py のJS版（対になる実装）。
 *
 * 固有形式付随物廃止・管理データ一元化計画 Phase 2 の実装。
 * 計画書: app/docs/proprietary-format-sidecar-cleanup-plan-2026-07-31.md §4.3
 *
 * 設計方針は meldex_document_identity.py のモジュールdocstringを参照。
 * ここではブラウザ側の書込チョークポイント（board-standalone-fs.js の
 * ローカルFS直接書込、gb-data-access-dropbox-fileops.* のDropbox直接書込）
 * から薄く呼ぶことを想定する。
 *
 * 「閲覧では書き込まない」原則を守るため、ensureDocumentId/regenerateDocumentId
 * は呼び出し側が実際に書き込む直前でのみ呼ぶこと。読込専用の経路から
 * 呼んではならない。
 */
(function () {
  'use strict';

  const NS = (window.MeldexDocumentIdentity = window.MeldexDocumentIdentity || {});

  const METADATA_VERSION = 1;

  // 対象4形式（現行形式のみ）。
  const CURRENT_FORMAT_EXTENSIONS = [
    ['.mel-board', 'board'],
    ['.mel-scenario', 'scenario'],
    ['.mel-timer', 'timer'],
    ['.mel-sheet', 'sheet'],
  ];

  const JSON_FORMATS = new Set(['scenario', 'timer', 'sheet']);

  // フロントマター全体（開始"---" 〜 終了"---"）を検出する正規表現。
  // ^ は文字列先頭に固定されるため match.index は常に 0 になる
  // （フラグ 'm' を使っていないため）。
  const FRONTMATTER_RE = /^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/;

  function _classifyMarkdown(path, text) {
    const normalized = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const parts = normalized.split('/').filter(Boolean);
    const lowerParts = parts.map(part => part.toLocaleLowerCase());
    const name = lowerParts[lowerParts.length - 1] || '';
    const internal = new Set(['_trash', '.trash', '_versions', '.versions', '_history', '.history', '_meldex', '.meldex', '_system', '.system']);
    if (!name.endsWith('.md')) return { eligible: false, reason: 'not_markdown' };
    if (typeof text !== 'string') return { eligible: false, reason: 'content_unavailable' };
    if (parts.includes('制作管理')) return { eligible: false, reason: 'production_managed' };
    if (lowerParts.slice(0, -1).some(part => internal.has(part))) return { eligible: false, reason: 'internal_path' };
    if (name.startsWith('.') || name.startsWith('~$') || /\.(?:tmp|temp|partial|download|crdownload)$/.test(name)) {
      return { eligible: false, reason: 'temporary_path' };
    }
    const source = String(text).replace(/^\uFEFF/, '');
    if (!source.startsWith('---')) return { eligible: true, kind: 'doc', reason: 'general_note' };
    const match = FRONTMATTER_RE.exec(String(text));
    if (!match) return { eligible: false, reason: 'malformed_frontmatter' };
    if (/^---\s*$/m.test(String(text).slice(match[0].length))) {
      return { eligible: false, reason: 'multiple_frontmatter_delimiters' };
    }
    if (match[2].includes('\t') || match[2].includes('#')
        || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(match[2])
        || /(^|\s)[&*][^\s]+/.test(match[2])
        || /(^|\s)![^\s]+/.test(match[2]) || /[\[\]{}]/.test(match[2])
        || /^\s*-\s+/m.test(match[2])
        || /^[ ]*[^#\r\n][^:\r\n]*:[ ]*[|>][0-9+-]*[ ]*$/m.test(match[2])
        || /^[ ]*["'][^\r\n:]*["'][ ]*:/m.test(match[2])
        || /^[ ]*<<[ ]*:/m.test(match[2])) {
      return { eligible: false, reason: 'unsupported_yaml_expression' };
    }
    const lines = match[2].split(/\r?\n/);
    let rawType = '';
    let rawMeldex = null;
    const topLevelKeys = new Set();
    const keysByIndent = new Map();
    const indentStack = [0];
    let previousOpensMapping = false;
    const unsupportedPlainScalar = value => {
      const raw = String(value || '');
      const trimmed = raw.trim();
      const quoted = trimmed.length >= 2 && (trimmed[0] === '"' || trimmed[0] === "'")
        && trimmed[trimmed.length - 1] === trimmed[0];
      return !quoted && /:(?:\s|$)/.test(raw);
    };
    for (const line of lines) {
      if (!line.trim()) continue;
      const indent = /^( *)/.exec(line)[1].length;
      const currentIndent = indentStack[indentStack.length - 1];
      if (indent < currentIndent) {
        while (indentStack.length > 1 && indent < indentStack[indentStack.length - 1]) {
          indentStack.pop();
        }
        if (indent !== indentStack[indentStack.length - 1]) {
          return { eligible: false, reason: 'malformed_frontmatter' };
        }
      } else if (indent > currentIndent) {
        if (!previousOpensMapping) return { eligible: false, reason: 'malformed_frontmatter' };
        indentStack.push(indent);
      }
      const nested = /^(\s+)([^:#][^:]*):(?:\s*(.*))?$/.exec(line);
      if (nested) {
        if (unsupportedPlainScalar(nested[3])) {
          return { eligible: false, reason: 'unsupported_yaml_expression' };
        }
        const indent = nested[1].replace(/\t/g, '  ').length;
        for (const depth of [...keysByIndent.keys()]) {
          if (depth > indent) keysByIndent.delete(depth);
        }
        const key = nested[2].trim();
        const seen = keysByIndent.get(indent) || new Set();
        if (seen.has(key)) return { eligible: false, reason: 'malformed_frontmatter' };
        seen.add(key); keysByIndent.set(indent, seen);
        previousOpensMapping = !String(nested[3] || '').trim();
        continue;
      }
      if (/^\s/.test(line)) return { eligible: false, reason: 'malformed_frontmatter' };
      keysByIndent.clear();
      const pair = /^([^:#][^:]*):(?:\s*(.*))?$/.exec(line);
      if (!pair) return { eligible: false, reason: 'malformed_frontmatter' };
      const key = pair[1].trim();
      if (unsupportedPlainScalar(pair[2])) {
        return { eligible: false, reason: 'unsupported_yaml_expression' };
      }
      if (topLevelKeys.has(key)) return { eligible: false, reason: 'malformed_frontmatter' };
      topLevelKeys.add(key);
      if (key === 'type') rawType = String(pair[2] || '').trim();
      if (key === 'meldex') rawMeldex = String(pair[2] || '').trim();
      previousOpensMapping = !String(pair[2] || '').trim();
    }
    if (rawMeldex !== null && rawMeldex !== '') return { eligible: false, reason: 'ambiguous_meldex_metadata' };
    if (/!![A-Za-z0-9_:-]+/.test(rawType)) return { eligible: false, reason: 'unsupported_yaml_expression' };
    if (/^[\[{>|]/.test(rawType)) return { eligible: false, reason: 'invalid_type' };
    const noteType = rawType.replace(/^(['"])([\s\S]*)\1$/, '$2').trim().toLocaleLowerCase();
    if (!noteType || noteType === 'note') return { eligible: true, kind: 'doc', reason: 'general_note' };
    if (['settings-db', 'settings-entry', 'calendar-event'].includes(noteType)) {
      return { eligible: false, reason: noteType.replace(/-/g, '_') };
    }
    return { eligible: false, reason: 'managed_or_unknown_type' };
  }

  function formatForPath(path, text) {
    const lower = String(path || '').toLowerCase();
    for (const [ext, fmt] of CURRENT_FORMAT_EXTENSIONS) {
      if (lower.endsWith(ext)) return fmt;
    }
    if (lower.endsWith('.md') && _classifyMarkdown(path, text).eligible) return 'note';
    return null;
  }

  function newDocumentId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    // フォールバック（randomUUID が使えない実行環境用）。
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : ((r & 0x3) | 0x8);
      return v.toString(16);
    });
  }

  function _readJsonDocumentId(text) {
    let doc;
    try {
      doc = JSON.parse(text);
    } catch {
      return null;
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
    const meldex = doc.meldex;
    if (meldex && typeof meldex === 'object') {
      const value = meldex.document_id;
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
  }

  // フロントマター本文から、指定キーで始まるトップレベルブロック（キー行＋
  // それに続くインデント行・空行）だけを抜き出す。Python版
  // _extract_top_level_yaml_block と同じロジック。
  function _extractTopLevelYamlBlock(fmBody, key) {
    const prefix = key + ':';
    const lines = String(fmBody || '').split('\n');
    let start = null;
    let end = lines.length;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (start === null) {
        if (line === prefix || line.startsWith(prefix + ' ') || line.startsWith(prefix + '\t')) start = i;
        continue;
      }
      if (line && !/^\s/.test(line)) {
        end = i;
        break;
      }
    }
    if (start === null) return null;
    return lines.slice(start, end).join('\n');
  }

  // 簡易パーサー: meldex: ブロック配下の "key: value" 行だけを読む。
  // フルYAMLパーサーは使わず、ボードの手書きフロントマター記法を壊さない
  // 方針（gb-canvas-engine.js の preserve-unknown-frontmatter と対称）に合わせる。
  function _parseMeldexBlockValues(block) {
    const result = {};
    const rows = String(block || '').split('\n').slice(1)
      .map(line => ({ line, match: /^([ \t]+)(\w+):\s*(.*)$/.exec(line) }))
      .filter(row => row.match);
    if (!rows.length) return result;
    const directIndent = Math.min(...rows.map(row => row.match[1].replace(/\t/g, '  ').length));
    rows.forEach(({ match: m }) => {
      if (!m) return;
      if (m[1].replace(/\t/g, '  ').length !== directIndent) return;
      let value = m[3].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[m[2]] = value;
    });
    return result;
  }

  function _readBoardDocumentId(text) {
    const match = FRONTMATTER_RE.exec(String(text || ''));
    if (!match) return null;
    const block = _extractTopLevelYamlBlock(match[2], 'meldex');
    if (block === null) return null;
    const values = _parseMeldexBlockValues(block);
    return values.document_id || null;
  }

  function readDocumentId(text, fmt) {
    if (fmt === 'board' || fmt === 'note') return _readBoardDocumentId(text);
    if (JSON_FORMATS.has(fmt)) return _readJsonDocumentId(text);
    return null;
  }

  function _injectJsonDocumentId(text, documentId) {
    let doc;
    try {
      doc = JSON.parse(text);
    } catch {
      return null;
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
    const meldex = (doc.meldex && typeof doc.meldex === 'object') ? { ...doc.meldex } : {};
    meldex.metadata_version = METADATA_VERSION;
    meldex.document_id = documentId;
    doc.meldex = meldex;
    return JSON.stringify(doc, null, 2) + '\n';
  }

  function _boardMeldexBlock(documentId) {
    return `meldex:\n  metadata_version: ${METADATA_VERSION}\n  document_id: "${documentId}"\n`;
  }

  function _upsertBoardMeldexFields(block, documentId) {
    const lines = String(block || '').split('\n');
    const childIndents = lines.slice(1)
      .map(line => /^(\s+)\S/.exec(line))
      .filter(Boolean)
      .map(match => match[1]);
    const indent = childIndents.length
      ? childIndents.reduce((shortest, value) => (value.length < shortest.length ? value : shortest))
      : '  ';
    const replacements = {
      metadata_version: String(METADATA_VERSION),
      document_id: `"${documentId}"`,
    };
    const replaced = new Set();
    for (let i = 1; i < lines.length; i += 1) {
      const match = /^(\s+)([A-Za-z0-9_]+):/.exec(lines[i]);
      if (!match || match[1] !== indent
          || !Object.prototype.hasOwnProperty.call(replacements, match[2])) continue;
      lines[i] = `${indent}${match[2]}: ${replacements[match[2]]}`;
      replaced.add(match[2]);
    }
    ['metadata_version', 'document_id'].forEach((key) => {
      if (!replaced.has(key)) lines.push(`${indent}${key}: ${replacements[key]}`);
    });
    return lines.join('\n');
  }

  function _injectBoardDocumentId(text, documentId) {
    const source = String(text || '');
    if (source.includes('\r\n')) {
      return _injectBoardDocumentId(source.replace(/\r\n/g, '\n'), documentId).replace(/\n/g, '\r\n');
    }
    const match = FRONTMATTER_RE.exec(source);
    if (!match) {
      // フロントマター自体が無い（想定外に壊れたファイル）場合は新規付与する。
      const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
      const body = bom ? source.slice(1) : source;
      return bom + '---\n' + _boardMeldexBlock(documentId) + '---\n' + body;
    }
    const headerLen = match[1].length;
    const fmBody = match[2];
    const existingBlock = _extractTopLevelYamlBlock(fmBody, 'meldex');
    if (existingBlock !== null) {
      const blockStart = fmBody.indexOf(existingBlock);
      const newFmBody = fmBody.slice(0, blockStart)
        + _upsertBoardMeldexFields(existingBlock, documentId)
        + fmBody.slice(blockStart + existingBlock.length);
      return source.slice(0, headerLen) + newFmBody + source.slice(headerLen + fmBody.length);
    }
    const block = _boardMeldexBlock(documentId);
    const separator = (!fmBody || fmBody.endsWith('\n')) ? '' : '\n';
    const newFmBody = fmBody + separator + block.replace(/\n+$/, '');
    return source.slice(0, headerLen) + newFmBody + source.slice(headerLen + fmBody.length);
  }

  function _stripBoardDocumentIdBlock(text) {
    const source = String(text || '');
    const match = FRONTMATTER_RE.exec(source);
    if (!match) return source;
    const headerLen = match[1].length;
    const fmBody = match[2];
    const block = _extractTopLevelYamlBlock(fmBody, 'meldex');
    if (block === null) return source;
    const idx = fmBody.indexOf(block);
    if (idx < 0) return source;
    const newFmBody = fmBody.slice(0, idx) + fmBody.slice(idx + block.length);
    return source.slice(0, headerLen) + newFmBody + source.slice(headerLen + fmBody.length);
  }

  function ensureDocumentId(text, fmt, preferredDocumentId) {
    const existing = readDocumentId(text, fmt);
    if (existing) return { text, changed: false, documentId: existing };
    const id = String(preferredDocumentId || '').trim() || newDocumentId();
    let nextText;
    if (fmt === 'board' || fmt === 'note') {
      nextText = _injectBoardDocumentId(text, id);
    } else if (JSON_FORMATS.has(fmt)) {
      nextText = _injectJsonDocumentId(text, id);
      if (nextText === null) return { text, changed: false, documentId: null };
    } else {
      return { text, changed: false, documentId: null };
    }
    return { text: nextText, changed: true, documentId: id };
  }

  class DocumentIdConflictError extends Error {
    constructor(existingDocumentId, incomingDocumentId) {
      super('保存先と入力内容の文書IDが一致しません');
      this.name = 'DocumentIdConflictError';
      this.status = 409;
      this.code = 'document_id_conflict';
      this.meldexCode = 'document_id_conflict';
      this.existingDocumentId = existingDocumentId;
      this.incomingDocumentId = incomingDocumentId;
    }
  }

  function ensureDocumentIdForOverwrite(text, fmt, existingDocumentId) {
    const authoritativeId = String(existingDocumentId || '').trim();
    const incomingId = readDocumentId(text, fmt);
    if (authoritativeId && incomingId && incomingId !== authoritativeId) {
      throw new DocumentIdConflictError(authoritativeId, incomingId);
    }
    return ensureDocumentId(text, fmt, authoritativeId);
  }

  function regenerateDocumentId(text, fmt) {
    const id = newDocumentId();
    let nextText;
    if (fmt === 'board' || fmt === 'note') {
      nextText = _injectBoardDocumentId(text, id);
    } else if (JSON_FORMATS.has(fmt)) {
      nextText = _injectJsonDocumentId(text, id);
      if (nextText === null) return { text, changed: false, documentId: null };
    } else {
      return { text, changed: false, documentId: null };
    }
    return { text: nextText, changed: true, documentId: id };
  }

  NS.formatForPath = formatForPath;
  NS.classifyMarkdown = _classifyMarkdown;
  NS.newDocumentId = newDocumentId;
  NS.readDocumentId = readDocumentId;
  NS.ensureDocumentId = ensureDocumentId;
  NS.ensureDocumentIdForOverwrite = ensureDocumentIdForOverwrite;
  NS.regenerateDocumentId = regenerateDocumentId;
  NS.DocumentIdConflictError = DocumentIdConflictError;
})();
