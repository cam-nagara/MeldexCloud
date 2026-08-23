/* MeldexEmbedBlock v1: strict validation and safe Markdown round-trip. */
(function (global) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const RESOURCE_TYPES = new Set(['sheet', 'board']);
  const HEADERS = new Set(['full', 'compact', 'hidden']);
  const INTERACTIONS = new Set(['editable', 'read-only']);
  const DIRECTIVE_RE = /<!--meldex-embed:v(\d+):([A-Za-z0-9_-]+)-->/g;
  const MAX_DIRECTIVE_BYTES = 64 * 1024;

  class EmbedValidationError extends Error {}

  function _plainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new EmbedValidationError(label + ' must be an object');
    }
    return value;
  }

  function _string(value, label, maximum) {
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f]/.test(value)) {
      throw new EmbedValidationError(label + ' must be a non-empty string');
    }
    if (value.length > (maximum || 512)) throw new EmbedValidationError(label + ' is too long');
    return value;
  }

  function _safeOpenUri(value) {
    const uri = _string(value, 'fallback.openUri', 2048).trim();
    if (/^(?:javascript|vbscript|data|file):/i.test(uri)) {
      throw new EmbedValidationError('fallback.openUri uses an unsafe scheme');
    }
    if (!/^(?:https?:\/\/|meldex:|\/|#|\.\.\/|\.\/)/i.test(uri)) {
      throw new EmbedValidationError('fallback.openUri must be an app, relative, or web URI');
    }
    return uri;
  }

  function _clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalize(block) {
    const source = _plainObject(block, 'MeldexEmbedBlock');
    if (source.schemaVersion !== SCHEMA_VERSION) {
      throw new EmbedValidationError('unsupported MeldexEmbedBlock schemaVersion');
    }
    if (!RESOURCE_TYPES.has(source.resourceType)) {
      throw new EmbedValidationError('resourceType must be sheet or board');
    }
    const display = _plainObject(source.display, 'display');
    const fallback = _plainObject(source.fallback, 'fallback');
    if (!HEADERS.has(display.header)) throw new EmbedValidationError('display.header is invalid');
    if (!INTERACTIONS.has(display.interaction)) throw new EmbedValidationError('display.interaction is invalid');
    if (!Number.isInteger(display.height) || display.height < 160 || display.height > 2400) {
      throw new EmbedValidationError('display.height must be an integer from 160 to 2400');
    }
    const result = _clone(source);
    result.schemaVersion = SCHEMA_VERSION;
    result.blockId = _string(source.blockId, 'blockId');
    result.resourceType = source.resourceType;
    result.sourceId = _string(source.sourceId, 'sourceId');
    result.documentId = _string(source.documentId, 'documentId');
    result.viewId = _string(source.viewId, 'viewId');
    result.display = Object.assign({}, _clone(display), {
      header: display.header,
      height: display.height,
      interaction: display.interaction,
    });
    result.fallback = Object.assign({}, _clone(fallback), {
      title: _string(fallback.title, 'fallback.title', 500),
      openUri: _safeOpenUri(fallback.openUri),
    });
    return result;
  }

  function inspect(block) {
    try {
      const source = _plainObject(block, 'MeldexEmbedBlock');
      if (source.schemaVersion !== SCHEMA_VERSION) {
        return { editable: false, status: 'unsupported-schema', block: _clone(source) };
      }
      if (!RESOURCE_TYPES.has(source.resourceType)) {
        return { editable: false, status: 'unsupported-type', block: _clone(source) };
      }
      return { editable: true, status: 'supported', block: normalize(source) };
    } catch (error) {
      return { editable: false, status: 'invalid', error: String(error.message || error), block: null };
    }
  }

  function _encodeUtf8(value) {
    const text = JSON.stringify(value);
    if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64url');
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function _decodeUtf8(value) {
    if (value.length > MAX_DIRECTIVE_BYTES * 2) throw new EmbedValidationError('embed directive is too large');
    if (typeof Buffer !== 'undefined') return Buffer.from(value, 'base64url').toString('utf8');
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  function _escapeLinkLabel(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/([\[\]])/g, '\\$1').replace(/[\r\n]+/g, ' ');
  }

  function _escapeLinkUri(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/\)/g, '\\)');
  }

  function fallbackMarkdown(block) {
    const inspected = inspect(block);
    const source = inspected.block || block || {};
    const fallback = source.fallback && typeof source.fallback === 'object' ? source.fallback : {};
    let title = typeof fallback.title === 'string' && fallback.title.trim()
      ? fallback.title.trim() : '対応していない埋め込みビュー';
    let uri = '#';
    try { uri = _safeOpenUri(fallback.openUri || '#'); } catch (_) { uri = '#'; }
    return '[' + _escapeLinkLabel(title) + '](' + _escapeLinkUri(uri) + ')';
  }

  function toMarkdown(block) {
    const normalized = normalize(block);
    const encoded = _encodeUtf8(normalized);
    if (encoded.length > MAX_DIRECTIVE_BYTES * 2) throw new EmbedValidationError('embed directive is too large');
    return '<!--meldex-embed:v1:' + encoded + '-->\n' + fallbackMarkdown(normalized);
  }

  function parseDirective(version, encoded) {
    let decoded;
    try {
      decoded = JSON.parse(_decodeUtf8(encoded));
    } catch (error) {
      return { editable: false, status: 'invalid', error: String(error.message || error), block: null };
    }
    if (Number(version) !== SCHEMA_VERSION) {
      return { editable: false, status: 'unsupported-schema', block: decoded };
    }
    return inspect(decoded);
  }

  function parseMarkdown(markdown) {
    const source = String(markdown || '');
    const items = [];
    DIRECTIVE_RE.lastIndex = 0;
    let match;
    while ((match = DIRECTIVE_RE.exec(source))) {
      const parsed = parseDirective(match[1], match[2]);
      items.push(Object.assign(parsed, {
        start: match.index,
        end: DIRECTIVE_RE.lastIndex,
        directive: match[0],
        fallbackMarkdown: fallbackMarkdown(parsed.block),
      }));
    }
    return items;
  }

  const api = {
    SCHEMA_VERSION,
    EmbedValidationError,
    normalize,
    inspect,
    toMarkdown,
    parseDirective,
    parseMarkdown,
    fallbackMarkdown,
  };
  global.MeldexNoteEmbedSerializer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
