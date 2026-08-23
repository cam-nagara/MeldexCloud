/* gb-chat-markdown.part01.js: チャット本文のMarkdown描画（見出し/表/コード/リンク要素の生成）
   リンク先の解決とオープン処理は gb-chat-markdown.part02.js が担当する。 */
(function (global) {
  'use strict';

  const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico']);
  const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.avi', '.mkv']);
  const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac']);

  // 「裸書き」（[表示名](...) で囲まれていない、本文中にそのまま書かれた文字列）を
  // Meldex内のパスとして自動リンク化してよいかの判定に使う。日本語の本文には空白が
  // 無いため、「心の隙間/絶望」「インカージョン/剪定」のようにスラッシュを含む言い回しが
  // 1文まるごとパスとして誤認されていた（2026-08-07 ユーザー報告）。
  // 句読点・かぎ括弧・全角記号を1つでも含む文字列は、裸書きのパスとして扱わない。
  // これらの文字を実際に含むファイル名は [表示名](パス) 形式で書けばリンクになる。
  const BARE_PATH_PROSE_RE = /[、。，．・‥…！？!?；;：「」『』【】〔〕〈〉《》（）()［］\[\]｛｝{}〝〟“”‘’＝＋＊×÷＆％＄＃＠～〜｜＜＞<>#"'`,＝=&%$@|]/;
  const BARE_PATH_MAX_SEGMENTS = 12;
  const BARE_PATH_MAX_SEGMENT_LENGTH = 120;

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

  // `パス#見出し名` を「開く対象」と「開いた後にスクロールする見出し」へ分ける。
  // Web URL と file:// URL の `#` はそのままURLの一部として扱う。
  // `#見出し` だけ（対象ファイルの指定なし）は、チャットには「今開いているノート」の
  // 概念が無いため分離しない。
  function _splitTargetAnchor(target) {
    const raw = String(target || '');
    const empty = { path: raw, anchor: '' };
    if (!raw || _isWebUrl(raw) || _isFileUrl(raw)) return empty;
    const index = raw.indexOf('#');
    if (index <= 0) return empty;
    const path = raw.slice(0, index).trim();
    if (!path) return empty;
    let anchor = raw.slice(index + 1).trim();
    try { anchor = decodeURIComponent(anchor); } catch {}
    return anchor ? { path, anchor } : empty;
  }

  function _linkLabel(target) {
    if (_isWebUrl(target)) return target;
    if (_isFileUrl(target)) return _basename(_fileUrlToPath(target));
    const split = _splitTargetAnchor(target);
    if (split.anchor) return split.anchor;
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
    const scheme = target.match(/^(?:(?:home|source|vault):\/+|meldex:\/\/)/i);
    const body = scheme ? target.slice(scheme[0].length) : target;
    if (BARE_PATH_PROSE_RE.test(body)) return false;
    const segments = _normalizeSlashPath(body).split('/').filter(Boolean);
    if (!segments.length || segments.length > BARE_PATH_MAX_SEGMENTS) return false;
    if (segments.some(segment => segment.length > BARE_PATH_MAX_SEGMENT_LENGTH)) return false;
    if (scheme) return true;
    if (!/[\\/]/.test(target)) return false;
    const clean = segments.join('/');
    if (/^\d{1,4}\/\d{1,2}(?:\/\d{1,2})?$/.test(clean)) return false;
    if (!/[^\d\/._-]/.test(clean)) return false;
    return segments.length >= 2;
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

  function _markdownLinkLabel(label, fallback) {
    const value = String(label || fallback || '');
    const trimmed = value.trim();
    const wrappedCode = trimmed.match(/^(`+)([\s\S]*?)\1$/);
    return wrappedCode ? wrappedCode[2] : value;
  }

  function _makeLink(label, target, options) {
    const normalized = _normalizeMarkdownTarget(target);
    const a = document.createElement('a');
    a.className = 'chat-md-link';
    a.href = _isWebUrl(normalized) ? normalized : '#';
    a.textContent = _markdownLinkLabel(label, _linkLabel(normalized));
    a.dataset.chatLinkTarget = normalized;
    a.dataset.gbTooltipDisabled = 'true';
    // 裸書き（本文にそのまま書かれたパス）由来のリンクだけ、描画後に実在確認して
    // 見つからなければ通常の文字へ戻す（誤リンク化の残りを自動で解消する）。
    if (options?.bare) a.dataset.chatLinkBare = 'true';
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
    window.MeldexImageLoading?.track?.(img, { label: 'チャットの画像を読み込んでいます', allowDetached: true });
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
        parent.appendChild(_makeLink(workspacePath.target, workspacePath.target, { bare: true }));
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
    _verifyBareWorkspaceLinks(root);
    return root;
  }
