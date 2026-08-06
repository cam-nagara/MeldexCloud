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

  function formatForPath(path) {
    const lower = String(path || '').toLowerCase();
    for (const [ext, fmt] of CURRENT_FORMAT_EXTENSIONS) {
      if (lower.endsWith(ext)) return fmt;
    }
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
    if (fmt === 'board') return _readBoardDocumentId(text);
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
    const match = FRONTMATTER_RE.exec(source);
    if (!match) {
      // フロントマター自体が無い（想定外に壊れたファイル）場合は新規付与する。
      return '---\n' + _boardMeldexBlock(documentId) + '---\n' + source;
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
    if (fmt === 'board') {
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
    if (fmt === 'board') {
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
  NS.newDocumentId = newDocumentId;
  NS.readDocumentId = readDocumentId;
  NS.ensureDocumentId = ensureDocumentId;
  NS.ensureDocumentIdForOverwrite = ensureDocumentIdForOverwrite;
  NS.regenerateDocumentId = regenerateDocumentId;
  NS.DocumentIdConflictError = DocumentIdConflictError;
})();
