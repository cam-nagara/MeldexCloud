/* gb-chat-markdown.js: safe Markdown-ish rendering for chat bubbles */
(function (global) {
  'use strict';

  const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico']);
  const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.avi', '.mkv']);
  const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac']);

  function _trimTrailingPunctuation(value) {
    let text = String(value || '');
    const bracketPairs = { ')': '(', ']': '[', '）': '（', '」': '「', '』': '『', '】': '【' };
    const isBalancedClosing = (close) => {
      const open = bracketPairs[close];
      let depth = 0;
      for (const ch of text) {
        if (ch === open) depth += 1;
        else if (ch === close) depth -= 1;
      }
      return depth >= 0;
    };
    const shouldTrim = () => {
      const ch = text.slice(-1);
      if (!ch) return false;
      if (/[.,;:!?、。]/.test(ch)) return true;
      return Object.prototype.hasOwnProperty.call(bracketPairs, ch) && !isBalancedClosing(ch);
    };
    while (shouldTrim()) text = text.slice(0, -1);
    return text;
  }

  function _normalizeSlashPath(path) {
    return String(path || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '');
  }

  function _basename(path) {
    const clean = String(path || '').split(/[?#]/)[0].replace(/[\\\/]+$/, '');
    return clean.split(/[\\\/]/).pop() || clean || path;
  }

  function _extension(path) {
    const name = _basename(path).toLowerCase();
    const index = name.lastIndexOf('.');
    return index >= 0 ? name.slice(index) : '';
  }

  function _isWebUrl(target) {
    return /^https?:\/\//i.test(String(target || ''));
  }

  function _isFileUrl(target) {
    return /^file:\/\//i.test(String(target || ''));
  }

  function _isAbsoluteLocalPath(target) {
    const value = String(target || '').trim();
    return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value);
  }

  function _fileUrlToPath(target) {
    try {
      const parsed = new URL(String(target || ''));
      const decodedPath = decodeURIComponent(parsed.pathname || '');
      if (parsed.hostname) return '\\\\' + parsed.hostname + decodedPath.replace(/\//g, '\\');
      return decodedPath.replace(/^\/([A-Za-z]:)/, '$1').replace(/\//g, '\\');
    } catch {
      return String(target || '').replace(/^file:\/+/i, '');
    }
  }

  function _targetFromFileRawUrl(target) {
    try {
      const parsed = new URL(String(target || ''), location.origin);
      if (!/\/(?:api\/)?file-raw$/i.test(parsed.pathname)) return '';
      return parsed.searchParams.get('path') || '';
    } catch {
      const match = String(target || '').match(/[?&]path=([^&]+)/);
      return match ? decodeURIComponent(match[1]) : '';
    }
  }

  function _fileRawUrl(path) {
    if (global.MeldexResourceUrl?.fileRaw) return global.MeldexResourceUrl.fileRaw(path);
    const base = typeof API_BASE === 'string' ? API_BASE : '/api';
    return base + '/file-raw?path=' + encodeURIComponent(path);
  }

  function _linkLabel(target) {
    if (_isWebUrl(target)) return target;
    if (_isFileUrl(target)) return _basename(_fileUrlToPath(target));
    return _basename(target);
  }

  function _normalizeMarkdownTarget(raw) {
    let target = String(raw || '').trim();
    if ((target.startsWith('<') && target.endsWith('>')) || (target.startsWith('"') && target.endsWith('"'))) {
      target = target.slice(1, -1).trim();
    }
    if ((target.startsWith("'") && target.endsWith("'"))) target = target.slice(1, -1).trim();
    return _unescapeMarkdownText(target);
  }

  function _unescapeMarkdownText(value) {
    return String(value || '').replace(/\\([\\`*_{}\[\]()#+\-.!|>])/g, '$1');
  }

  function _findUnescapedChar(text, start, targetChar) {
    for (let i = Math.max(0, Number(start) || 0); i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === targetChar) return i;
    }
    return -1;
  }

  function _appendText(parent, text) {
    if (text) parent.appendChild(document.createTextNode(text));
  }

  function _chatMarkdownCopyIconHtml(size = 12) {
    return typeof global.lucide === 'function' ? global.lucide('copy', size) : 'Copy';
  }

  function _chatMarkdownCopyFallback(text) {
    if (!global.document?.body) return false;
    const textarea = global.document.createElement('textarea');
    textarea.value = String(text || '');
    textarea.setAttribute('readonly', '');
    textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    global.document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    let ok = false;
    try {
      ok = global.document.execCommand('copy');
    } catch {
      ok = false;
    }
    textarea.remove();
    return ok;
  }

  async function _chatMarkdownCopyText(text, okMessage = 'コードをコピーしました') {
    const value = String(text ?? '');
    if (!value) {
      if (typeof global.showStatus === 'function') global.showStatus('コピーする内容がありません', true);
      return false;
    }
    if (typeof global.GBChatCopyText === 'function') {
      return global.GBChatCopyText(value, okMessage);
    }
    try {
      if (global.navigator?.clipboard?.writeText) await global.navigator.clipboard.writeText(value);
      else if (!_chatMarkdownCopyFallback(value)) throw new Error('clipboard unavailable');
      if (typeof global.showStatus === 'function') global.showStatus(okMessage);
      return true;
    } catch (err) {
      if (_chatMarkdownCopyFallback(value)) {
        if (typeof global.showStatus === 'function') global.showStatus(okMessage);
        return true;
      }
      if (typeof global.showStatus === 'function') global.showStatus('コピーに失敗: ' + (err?.message || err), true);
      return false;
    }
  }

  function _attachCodeCopyButton(pre, text) {
    if (!pre || !String(text || '')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-code-copy-btn';
    btn.title = 'コードをコピー';
    btn.setAttribute('aria-label', 'コードをコピー');
    btn.innerHTML = _chatMarkdownCopyIconHtml(12);
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      _chatMarkdownCopyText(text, 'コードをコピーしました');
    });
    pre.appendChild(btn);
  }

  function _safeInlineColor(value) {
    const raw = String(value || '').trim();
    if (/^#[0-9a-f]{3,8}$/i.test(raw)) return raw;
    if (/^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(raw)) return raw;
    return '';
  }

  function _safeInlineFont(value) {
    const raw = String(value || '').trim();
    if (!raw || raw.length > 160 || /url\s*\(|expression\s*\(|[<>[\]{};\\]/i.test(raw)) return '';
    return raw;
  }

  function _makeChatStyleSpan(rawAttrs) {
    const span = document.createElement('span');
    const attrs = String(rawAttrs || '');
    attrs.replace(/([a-z]+)="([^"]*)"/gi, (_, key, value) => {
      const name = String(key || '').toLowerCase();
      if (name === 'color') {
        const color = _safeInlineColor(value);
        if (color) span.style.color = color;
      } else if (name === 'bg') {
        const color = _safeInlineColor(value);
        if (color) span.style.backgroundColor = color;
      } else if (name === 'size') {
        const size = Math.max(8, Math.min(96, Number(value) || 0));
        if (size) span.style.fontSize = size + 'px';
      } else if (name === 'font') {
        const font = _safeInlineFont(value);
        if (font) span.style.fontFamily = font;
      }
      return '';
    });
    return span.getAttribute('style') ? span : null;
  }

  function _looksLikeWorkspacePathToken(value) {
    const target = _normalizeMarkdownTarget(value);
    if (!target || _isWebUrl(target) || _isFileUrl(target) || _isAbsoluteLocalPath(target)) return false;
    if (/^(?:home|source|vault):\/+/i.test(target) || /^meldex:\/\//i.test(target)) return true;
    if (!/[\\/]/.test(target)) return false;
    const clean = _normalizeSlashPath(target);
    if (/^\d{1,4}\/\d{1,2}(?:\/\d{1,2})?$/.test(clean)) return false;
    if (!/[^\d\/._-]/.test(clean)) return false;
    return clean.split('/').filter(Boolean).length >= 2;
  }

  function _matchWorkspaceInline(rest) {
    const match = String(rest || '').match(/^(?:(?:home|source|vault):\/+|meldex:\/\/)?[^\s<>"'`]+[\\/][^\s<>"'`]+/i);
    if (!match) return null;
    const target = _trimTrailingPunctuation(match[0]);
    if (!_looksLikeWorkspacePathToken(target)) return null;
    return { target, length: target.length };
  }

  function _stampNode(spec, large) {
    if (!/^[A-Za-z0-9:_-]+$/.test(String(spec || ''))) return document.createTextNode('::stamp:' + spec + '::');
    const wrap = document.createElement('span');
    wrap.className = 'chat-md-stamp';
    if (typeof stampToImg === 'function') {
      wrap.innerHTML = stampToImg(spec, large ? 44 : 28);
    } else {
      wrap.textContent = '::stamp:' + spec + '::';
    }
    return wrap;
  }

  function _makeLink(label, target) {
    const normalized = _normalizeMarkdownTarget(target);
    const a = document.createElement('a');
    a.className = 'chat-md-link';
    a.href = _isWebUrl(normalized) ? normalized : '#';
    a.textContent = label || _linkLabel(normalized);
    a.dataset.chatLinkTarget = normalized;
    a.dataset.gbTooltipDisabled = 'true';
    if (_isWebUrl(normalized)) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    a.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openChatMarkdownTarget(normalized);
    });
    return a;
  }

  function _makeImage(alt, target) {
    const normalized = _normalizeMarkdownTarget(target);
    const pathFromRaw = _targetFromFileRawUrl(normalized);
    const ext = _extension(pathFromRaw || normalized);
    if (!_isWebUrl(normalized) && !pathFromRaw && !IMAGE_EXTS.has(ext)) {
      return _makeLink(alt || _linkLabel(normalized), normalized);
    }
    const img = document.createElement('img');
    img.className = 'chat-md-image';
    img.alt = alt || _linkLabel(normalized);
    img.loading = 'lazy';
    img.src = pathFromRaw ? _fileRawUrl(pathFromRaw) : (_isWebUrl(normalized) ? normalized : _fileRawUrl(normalized));
    img.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openChatMarkdownTarget(normalized);
    });
    return img;
  }

  function _findClosing(text, start, needle) {
    const index = text.indexOf(needle, start);
    return index >= 0 ? index : -1;
  }

  function _findMarkdownLinkEnd(text, openParen) {
    let depth = 0;
    for (let i = openParen; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === '(') depth += 1;
      if (ch === ')') {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  function _appendInline(parent, text) {
    let i = 0;
    let buffer = '';
    const flush = () => {
      if (!buffer) return;
      _appendText(parent, buffer);
      buffer = '';
    };

    while (i < text.length) {
      const rest = text.slice(i);

      if (rest.startsWith('`')) {
        const end = _findClosing(text, i + 1, '`');
        if (end > i) {
          flush();
          const code = document.createElement('code');
          code.textContent = text.slice(i + 1, end);
          parent.appendChild(code);
          i = end + 1;
          continue;
        }
      }

      if (rest.startsWith('**')) {
        const end = _findClosing(text, i + 2, '**');
        if (end > i) {
          flush();
          const strong = document.createElement('strong');
          _appendInline(strong, text.slice(i + 2, end));
          parent.appendChild(strong);
          i = end + 2;
          continue;
        }
      }

      if (rest.startsWith('~~')) {
        const end = _findClosing(text, i + 2, '~~');
        if (end > i) {
          flush();
          const del = document.createElement('del');
          _appendInline(del, text.slice(i + 2, end));
          parent.appendChild(del);
          i = end + 2;
          continue;
        }
      }

      if (rest.startsWith('[u]')) {
        const end = _findClosing(text, i + 3, '[/u]');
        if (end > i) {
          flush();
          const underline = document.createElement('u');
          _appendInline(underline, text.slice(i + 3, end));
          parent.appendChild(underline);
          i = end + 4;
          continue;
        }
      }

      const styleOpen = rest.match(/^\[style\s+([^\]]{1,240})\]/i);
      if (styleOpen) {
        const end = _findClosing(text, i + styleOpen[0].length, '[/style]');
        const span = end > i ? _makeChatStyleSpan(styleOpen[1]) : null;
        if (span) {
          flush();
          _appendInline(span, text.slice(i + styleOpen[0].length, end));
          parent.appendChild(span);
          i = end + 8;
          continue;
        }
      }

      if (rest.startsWith('*') && !rest.startsWith('**')) {
        const end = _findClosing(text, i + 1, '*');
        if (end > i + 1) {
          flush();
          const em = document.createElement('em');
          _appendInline(em, text.slice(i + 1, end));
          parent.appendChild(em);
          i = end + 1;
          continue;
        }
      }

      const stamp = rest.match(/^::stamp:([A-Za-z0-9:_-]+)::/);
      if (stamp) {
        flush();
        parent.appendChild(_stampNode(stamp[1], false));
        i += stamp[0].length;
        continue;
      }

      const wiki = rest.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
      if (wiki) {
        flush();
        const target = wiki[1].trim();
        const label = (wiki[2] || _linkLabel(target)).trim();
        parent.appendChild(_makeLink(label, target));
        i += wiki[0].length;
        continue;
      }

      if (rest.startsWith('![')) {
        const closeBracket = _findUnescapedChar(text, i + 2, ']');
        if (closeBracket > i && text[closeBracket + 1] === '(') {
          const closeParen = _findMarkdownLinkEnd(text, closeBracket + 1);
          if (closeParen > closeBracket) {
            flush();
            parent.appendChild(_makeImage(_unescapeMarkdownText(text.slice(i + 2, closeBracket)), text.slice(closeBracket + 2, closeParen)));
            i = closeParen + 1;
            continue;
          }
        }
      }

      if (rest.startsWith('[')) {
        const closeBracket = _findUnescapedChar(text, i + 1, ']');
        if (closeBracket > i && text[closeBracket + 1] === '(') {
          const closeParen = _findMarkdownLinkEnd(text, closeBracket + 1);
          if (closeParen > closeBracket) {
            flush();
            parent.appendChild(_makeLink(_unescapeMarkdownText(text.slice(i + 1, closeBracket)), text.slice(closeBracket + 2, closeParen)));
            i = closeParen + 1;
            continue;
          }
        }
      }

      const web = rest.match(/^https?:\/\/[^\s<>"']+/i);
      if (web) {
        const target = _trimTrailingPunctuation(web[0]);
        flush();
        parent.appendChild(_makeLink(target, target));
        i += target.length;
        continue;
      }

      const local = rest.match(/^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+\\)[^\s<>"']+/);
      if (local) {
        const target = _trimTrailingPunctuation(local[0]);
        flush();
        parent.appendChild(_makeLink(target, target));
        i += target.length;
        continue;
      }

      const workspacePath = _matchWorkspaceInline(rest);
      if (workspacePath) {
        flush();
        parent.appendChild(_makeLink(workspacePath.target, workspacePath.target));
        i += workspacePath.length;
        continue;
      }

      buffer += text[i];
      i += 1;
    }
    flush();
  }

  function _appendInlineBlock(parent, lines) {
    lines.forEach((line, index) => {
      if (index > 0) parent.appendChild(document.createElement('br'));
      _appendInline(parent, line);
    });
  }

  function _isTableSeparator(line) {
    const cells = String(line || '').trim().split('|').map(cell => cell.trim()).filter(Boolean);
    return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
  }

  function _splitTableRow(line) {
    let text = String(line || '').trim();
    if (text.startsWith('|')) text = text.slice(1);
    if (text.endsWith('|')) text = text.slice(0, -1);
    return text.split('|').map(cell => cell.trim());
  }

  function _renderTable(lines) {
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');
    const header = document.createElement('tr');
    _splitTableRow(lines[0]).forEach(cell => {
      const th = document.createElement('th');
      _appendInline(th, cell);
      header.appendChild(th);
    });
    thead.appendChild(header);
    lines.slice(2).forEach(line => {
      const tr = document.createElement('tr');
      _splitTableRow(line).forEach(cell => {
        const td = document.createElement('td');
        _appendInline(td, cell);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(thead);
    table.appendChild(tbody);
    return table;
  }

  function _applyChatHeadingSections(root) {
    if (!root) return;
    const children = [...root.childNodes];
    const fragment = document.createDocumentFragment();
    const stack = [];

    const closeAbove = (level) => {
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
    };

    children.forEach(node => {
      root.removeChild(node);
      const tagMatch = node.nodeName && node.nodeName.match(/^H([1-6])$/);
      if (tagMatch) {
        const level = parseInt(tagMatch[1], 10);
        closeAbove(level);
        const section = document.createElement('section');
        section.className = 'chat-heading-section chat-heading-level-' + level;
        section.appendChild(node);
        if (stack.length) stack[stack.length - 1].section.appendChild(section);
        else fragment.appendChild(section);
        stack.push({ level, section });
      } else if (stack.length) {
        stack[stack.length - 1].section.appendChild(node);
      } else {
        fragment.appendChild(node);
      }
    });

    root.appendChild(fragment);
  }

  function _nextBlockStarts(line) {
    return /^\s*(```|#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+|---+\s*$)/.test(line || '');
  }

  function renderChatMarkdown(container, markdown, options) {
    if (!container) return null;
    const root = document.createElement('div');
    root.className = 'chat-markdown';
    root.dataset.chatMarkdownRole = options?.role || '';
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i += 1;
        continue;
      }

      const fence = line.match(/^\s*```([A-Za-z0-9_+.-]*)\s*$/);
      if (fence) {
        const lang = fence[1] || '';
        const codeLines = [];
        i += 1;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
          codeLines.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        if (lang) code.dataset.language = lang;
        code.textContent = codeLines.join('\n');
        pre.appendChild(code);
        _attachCodeCopyButton(pre, codeLines.join('\n'));
        root.appendChild(pre);
        continue;
      }

      if (/^\s*---+\s*$/.test(line)) {
        root.appendChild(document.createElement('hr'));
        i += 1;
        continue;
      }

      const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
      if (heading) {
        const h = document.createElement('h' + Math.min(6, heading[1].length));
        _appendInline(h, heading[2]);
        root.appendChild(h);
        i += 1;
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        const quoteLines = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
          i += 1;
        }
        const quote = document.createElement('blockquote');
        _appendInlineBlock(quote, quoteLines);
        root.appendChild(quote);
        continue;
      }

      const listMatch = line.match(/^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/);
      if (listMatch) {
        const ordered = !!listMatch[2];
        const list = document.createElement(ordered ? 'ol' : 'ul');
        while (i < lines.length) {
          const itemMatch = lines[i].match(ordered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/);
          if (!itemMatch) break;
          const li = document.createElement('li');
          _appendInline(li, itemMatch[1]);
          list.appendChild(li);
          i += 1;
        }
        root.appendChild(list);
        continue;
      }

      if (line.includes('|') && i + 1 < lines.length && _isTableSeparator(lines[i + 1])) {
        const tableLines = [line, lines[i + 1]];
        i += 2;
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
          tableLines.push(lines[i]);
          i += 1;
        }
        root.appendChild(_renderTable(tableLines));
        continue;
      }

      const paragraph = [line];
      i += 1;
      while (i < lines.length && lines[i].trim() && !_nextBlockStarts(lines[i])) {
        if (lines[i].includes('|') && i + 1 < lines.length && _isTableSeparator(lines[i + 1])) break;
        paragraph.push(lines[i]);
        i += 1;
      }
      const p = document.createElement('p');
      _appendInlineBlock(p, paragraph);
      root.appendChild(p);
    }

    if (global.localStorage?.getItem?.('note-heading-indent') !== '0') {
      _applyChatHeadingSections(root);
    }
    container.replaceChildren(root);
    container.style.whiteSpace = 'normal';
    return root;
  }

  function _pushUniquePath(list, value) {
    const path = String(value || '').trim();
    if (!path) return;
    const key = path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    if (!key || list.some(item => item.key === key)) return;
    list.push({ path, key });
  }

  function _pathHasExtension(path) {
    return !!_extension(path);
  }

  function _pushWorkspacePathVariants(list, path) {
    const clean = String(path || '').trim();
    if (!clean) return;
    _pushUniquePath(list, clean);
    if (_pathHasExtension(clean) || /[\\/]$/.test(clean)) return;
    ['.md', '.smart-db.json', '.scriptnote.json', '.json', '.csv'].forEach(ext => _pushUniquePath(list, clean + ext));
  }

  function _joinWorkspacePath(root, rel) {
    const base = String(root || '').trim().replace(/[\\\/]+$/, '');
    const child = String(rel || '').trim().replace(/^[\\\/]+/, '');
    return base && child ? (base + '/' + child) : (base || child);
  }

  async function _workspaceRoots() {
    if (typeof apiFetch !== 'function') return [];
    const roots = [];
    const addRoot = (kind, payload) => {
      const path = String(payload?.path || '').trim();
      if (!path) return;
      const key = path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
      if (roots.some(root => root.key === key)) return;
      roots.push({ kind, path, key });
    };
    const [vaultRes, homeRes, outlinerRes] = await Promise.allSettled([
      apiFetch('/vault'),
      apiFetch('/home-folder'),
      apiFetch('/outliner-roots'),
    ]);
    if (vaultRes.status === 'fulfilled') addRoot('vault', vaultRes.value);
    if (homeRes.status === 'fulfilled') addRoot('home', homeRes.value);
    if (outlinerRes.status === 'fulfilled' && Array.isArray(outlinerRes.value)) {
      outlinerRes.value.forEach(root => {
        if (root?.visible === false) return;
        addRoot('source', root);
      });
    }
    return roots;
  }

  function _currentChatSourceRoot() {
    try {
      if (typeof _chatSourceFolderValue === 'function') return String(_chatSourceFolderValue() || '').trim();
    } catch {}
    return '';
  }

  function _rootPrefixedRelative(rootPath, target) {
    const rootName = _basename(rootPath);
    const clean = _normalizeSlashPath(target);
    if (!rootName || !clean) return '';
    if (clean === rootName) return '';
    if (clean.startsWith(rootName + '/')) return clean.slice(rootName.length + 1);
    return '';
  }

  async function _workspacePathCandidates(target) {
    const cleanTarget = _normalizeMarkdownTarget(target).replace(/^meldex:\/\//i, '').replace(/^vault:\/\//i, 'vault:/');
    const candidates = [];
    const roots = await _workspaceRoots();
    const virtual = cleanTarget.match(/^(home|source|vault):\/+(.*)$/i);
    if (virtual) {
      const kind = virtual[1].toLowerCase();
      const rel = virtual[2] || '';
      const preferred = kind === 'home'
        ? roots.find(root => root.kind === 'home')?.path
        : kind === 'source'
          ? (_currentChatSourceRoot() || roots.find(root => root.kind === 'vault')?.path || roots.find(root => root.kind === 'source')?.path)
          : roots.find(root => root.kind === 'vault')?.path;
      if (preferred) _pushWorkspacePathVariants(candidates, _joinWorkspacePath(preferred, rel));
      _pushWorkspacePathVariants(candidates, rel);
      return candidates.map(item => item.path);
    }

    _pushWorkspacePathVariants(candidates, cleanTarget);
    roots.forEach(root => {
      const rel = _rootPrefixedRelative(root.path, cleanTarget);
      if (rel) _pushWorkspacePathVariants(candidates, _joinWorkspacePath(root.path, rel));
      _pushWorkspacePathVariants(candidates, _joinWorkspacePath(root.path, cleanTarget));
    });
    return candidates.map(item => item.path);
  }

  async function _checkWorkspaceCandidateType(cleanPath) {
    if (typeof apiFetch !== 'function') return '';
    try {
      const resolved = await apiFetch('/check-type?path=' + encodeURIComponent(cleanPath));
      return String(resolved?.type || '');
    } catch {
      return '';
    }
  }

  async function _resolveWorkspaceTarget(target) {
    const candidates = await _workspacePathCandidates(target);
    for (const candidate of candidates) {
      const type = await _checkWorkspaceCandidateType(candidate);
      if (type && type !== 'unknown') return { path: candidate, type };
    }
    return { path: candidates[0] || target, type: '' };
  }

  function _activateChatWorkspaceOpenPane() {
    try {
      if (global.GBPaneBridge?.activateFileOpenPane) {
        return global.GBPaneBridge.activateFileOpenPane({ source: 'chat-link' }) || '';
      }
    } catch {}
    return '';
  }

  function _usesWorkspaceOpenPane(type, ext) {
    if (type === 'chat') return false;
    if (['folder', 'database', 'smart-db', 'board', 'scriptnote', 'scenario', 'calendar', 'page'].includes(type)) return true;
    if (['.smart-db.json', '.csv', '.html', '.htm', '.pdf'].includes(ext)) return true;
    return IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext) || AUDIO_EXTS.has(ext);
  }

  async function _openWorkspacePath(path) {
    const target = String(path || '').trim();
    if (!target) return false;
    const resolvedTarget = await _resolveWorkspaceTarget(target);
    const cleanPath = resolvedTarget.path;
    const label = _basename(cleanPath);
    let type = resolvedTarget.type || await _checkWorkspaceCandidateType(cleanPath);
    const ext = _extension(cleanPath);
    const targetPaneId = _usesWorkspaceOpenPane(type, ext) ? _activateChatWorkspaceOpenPane() : '';
    const opts = { fromExplorer: true, source: 'chat-link' };
    if (targetPaneId) opts.paneId = targetPaneId;
    try {
      if (type === 'folder') await openFolder(label, cleanPath, opts);
      else if (type === 'database') await selectDatabase(cleanPath, null, opts);
      else if (type === 'smart-db' && typeof openSmartDbFile === 'function') await openSmartDbFile(label, cleanPath, opts);
      else if (type === 'board' && typeof openBoard === 'function') await openBoard(label, cleanPath, opts);
      else if ((type === 'scriptnote' || type === 'scenario') && typeof openScenarioInScriptNote === 'function') openScenarioInScriptNote(cleanPath, label, opts);
      else if (type === 'calendar' && typeof openCalendarFile === 'function') await openCalendarFile(label, cleanPath, opts);
      else if (type === 'chat' && typeof openSavedChat === 'function') await openSavedChat(cleanPath);
      else if (type === 'page' && typeof openPage === 'function') await openPage(label, cleanPath, opts);
      else if (ext === '.smart-db.json' && typeof openSmartDbFile === 'function') await openSmartDbFile(label, cleanPath, opts);
      else if (ext === '.csv' && typeof openCsvFile === 'function') await openCsvFile(label, cleanPath, opts);
      else if ((ext === '.html' || ext === '.htm') && typeof openHtmlFile === 'function') await openHtmlFile(label, cleanPath, opts);
      else if (ext === '.pdf' && typeof openViewer === 'function') openViewer('/viewer?pdf=' + encodeURIComponent(cleanPath), opts);
      else if (IMAGE_EXTS.has(ext)) {
        if (typeof openViewer === 'function') openViewer('/viewer?file=' + encodeURIComponent(cleanPath), opts);
        else await openNative(cleanPath);
      } else if ((VIDEO_EXTS.has(ext) || AUDIO_EXTS.has(ext)) && typeof openMedia === 'function') {
        await openMedia(label, cleanPath, VIDEO_EXTS.has(ext) ? 'video' : 'audio', opts);
      } else if (typeof openNative === 'function') {
        await openNative(cleanPath);
      } else if (typeof showStatus === 'function') {
        showStatus('リンクを開けませんでした', true);
      }
      return true;
    } catch (error) {
      if (typeof showStatus === 'function') showStatus('リンクを開けませんでした: ' + (error?.message || error), true);
      return false;
    }
  }

  async function _openAbsoluteLocalPath(path) {
    const target = String(path || '').trim();
    if (!target) return false;
    try {
      if (typeof apiPost === 'function') {
        await apiPost('/open-local-path', { path: target });
        if (typeof showStatus === 'function') showStatus('ネイティブアプリで開きました');
        return true;
      }
      if (typeof openNative === 'function') {
        await openNative(target);
        return true;
      }
    } catch (error) {
      if (typeof showStatus === 'function') showStatus('開けませんでした: ' + (error?.message || error), true);
    }
    return false;
  }

  async function openChatMarkdownTarget(rawTarget) {
    const target = _normalizeMarkdownTarget(rawTarget);
    if (!target) return false;
    if (_isWebUrl(target)) {
      global.open(target, '_blank', 'noopener');
      return true;
    }
    const rawPath = _targetFromFileRawUrl(target);
    if (rawPath) return _openWorkspacePath(rawPath);
    if (_isFileUrl(target)) {
      return _openAbsoluteLocalPath(_fileUrlToPath(target));
    }
    if (_isAbsoluteLocalPath(target)) {
      return _openAbsoluteLocalPath(target);
    }
    return _openWorkspacePath(target);
  }

  global.renderChatMarkdown = renderChatMarkdown;
  global.openChatMarkdownTarget = openChatMarkdownTarget;
})(window);
