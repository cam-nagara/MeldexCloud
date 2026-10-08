/* gb-escape.js: context-specific escaping primitives shared by Meldex surfaces. */
(function installMeldexEscape(global) {
  'use strict';

  function text(value) {
    return value == null ? '' : String(value);
  }

  function html(value) {
    return text(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[character]));
  }

  function attr(value) {
    return html(value).replace(/[\u0000-\u001F\u007F]/g, character => `&#${character.charCodeAt(0)};`);
  }

  // CSS.escape() escapes identifiers, not arbitrary CSS declarations or URLs.
  function cssIdent(value) {
    const input = text(value);
    if (global.CSS && typeof global.CSS.escape === 'function') return global.CSS.escape(input);
    const length = input.length;
    let result = '';
    for (let index = 0; index < length; index += 1) {
      const code = input.charCodeAt(index);
      if (code === 0) {
        result += '\uFFFD';
      } else if ((code >= 1 && code <= 31) || code === 127
        || (index === 0 && code >= 48 && code <= 57)
        || (index === 1 && code >= 48 && code <= 57 && input.charCodeAt(0) === 45)) {
        result += `\\${code.toString(16)} `;
      } else if (index === 0 && code === 45 && length === 1) {
        result += '\\-';
      } else if (code >= 128 || code === 45 || code === 95
        || (code >= 48 && code <= 57)
        || (code >= 65 && code <= 90)
        || (code >= 97 && code <= 122)) {
        result += input.charAt(index);
      } else {
        result += `\\${input.charAt(index)}`;
      }
    }
    return result;
  }

  function urlComponent(value) {
    return encodeURIComponent(text(value));
  }

  function xml(value) {
    return text(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    }[character]));
  }

  const api = Object.freeze({ text, html, attr, cssIdent, urlComponent, xml });
  Object.defineProperty(global, 'MeldexEscape', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: api,
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
