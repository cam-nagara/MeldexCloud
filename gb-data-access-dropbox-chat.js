(function () {
  'use strict';

  const internals = window.__MeldexPwaDataAccessInternals;
  const handlers = window.__MeldexPwaDataAccessExtensions;
  if (!internals || !Array.isArray(handlers)) return;

  const {
    NOT_HANDLED,
    _normalizeFolderPath,
    _joinPath,
    _dirname,
    _basename,
    _requirePwaProvider,
    _directoryHandle,
    _listDirectoryEntries,
    _fileStats,
  } = internals;

  const PWA_CHAT_LLM_DIR = '_chat/llm';
  const CHAT_SECTION_RE = /^###?\s+(User|Assistant)\r?\n/gm;

  async function _llmConfigShape() {
    const configured = await window.MeldexLlmKeys?.configuredProviders?.().catch(() => ({})) || {};
    return {
      providers: {
        gemini: { available: true, configured: !!configured.gemini, localConfigured: !!configured.gemini },
        anthropic: { available: true, configured: !!configured.anthropic, localConfigured: !!configured.anthropic },
        openai: { available: true, configured: !!configured.openai, localConfigured: !!configured.openai },
      },
    };
  }

  function _chatMessageText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map(part => {
        if (!part || typeof part !== 'object') return '';
        if (part.type === 'text') return String(part.text || '');
        const name = part.name || part.path || part.url || part.mimeType || part.type || 'attachment';
        return `[${part.type === 'document' ? 'PDF' : '添付'}: ${name}]`;
      }).filter(Boolean).join('\n');
    }
    return String(content || '');
  }

  function _requestSourceFolder(url, body) {
    const raw = body?.source_folder || body?.sourceFolder || url?.searchParams?.get('source_folder') || '';
    const normalized = _normalizeFolderPath(raw);
    if (!normalized || normalized === '.') return '';
    _assertSafeChatPath(normalized, 'source_folder');
    return normalized;
  }

  function _assertSafeChatPath(path, field) {
    const parts = _normalizeFolderPath(path).split('/').filter(Boolean);
    if (parts.some(part => part === '.' || part === '..')) throw new Error(`${field || 'path'} が不正です`);
  }

  function _sourcePath(sourceFolder, path) {
    const base = _normalizeFolderPath(sourceFolder);
    const rel = _normalizeFolderPath(path);
    _assertSafeChatPath(rel, 'path');
    if (!base) return rel;
    if (rel === base || rel.startsWith(base + '/')) return rel;
    return _joinPath(base, rel);
  }

  function _clientPath(sourceFolder, path) {
    const base = _normalizeFolderPath(sourceFolder);
    const normalized = _normalizeFolderPath(path);
    if (base && normalized.startsWith(base + '/')) return normalized.slice(base.length + 1);
    return normalized;
  }

  function _llmDir(sourceFolder) {
    return _sourcePath(sourceFolder, PWA_CHAT_LLM_DIR);
  }

  function _resolveChatPath(sourceFolder, path) {
    const normalized = _normalizeFolderPath(path);
    if (!normalized) throw new Error('path は必須です');
    const llmDir = _llmDir(sourceFolder);
    const scopedPath = _sourcePath(sourceFolder, normalized);
    if (!scopedPath.startsWith(llmDir + '/')) throw new Error('_chat/llm 配下の .md パスを指定してください');
    if (!/\.md$/i.test(scopedPath)) throw new Error('_chat/llm 配下の .md パスを指定してください');
    return scopedPath;
  }

  function _chatNormalizeMessage(message, options = {}) {
    const msg = message && typeof message === 'object' ? message : {};
    const clean = {
      role: String(msg.role || 'user'),
      content: msg.content == null ? '' : msg.content,
      msg_id: String(msg.msg_id || ('msg_' + Math.random().toString(16).slice(2, 10).padEnd(8, '0'))),
    };
    ['timestamp', 'provider', 'model'].forEach(key => {
      const value = String(msg[key] || '').trim();
      if (value) clean[key] = value;
    });
    ['citations', 'code_exec_blocks', 'artifacts'].forEach(key => {
      if (Array.isArray(msg[key])) clean[key] = msg[key];
    });
    if (msg.usage && typeof msg.usage === 'object' && !Array.isArray(msg.usage)) clean.usage = msg.usage;
    if (msg.aborted === true) clean.aborted = true;
    if (str(msg.thinking).trim()) clean.thinking = str(msg.thinking).trim();
    if (str(msg.tool_audit_warning).trim()) clean.tool_audit_warning = str(msg.tool_audit_warning).trim();
    if (msg.compressed === true) clean.compressed = true;
    if (msg.compressed_summary === true) {
      clean.compressed_summary = true;
      clean.original_message_count = Number(msg.original_message_count || 0) || 0;
      if (Array.isArray(msg.original_messages) && options.includeOriginals !== false) {
        clean.original_messages = msg.original_messages.map(item => _chatNormalizeMessage(item, { includeOriginals: false }));
        if (!clean.original_message_count) clean.original_message_count = clean.original_messages.length;
      }
    }
    return clean;
  }

  function str(value) {
    return String(value == null ? '' : value);
  }

  function _yamlString(value) {
    return JSON.stringify(String(value || ''));
  }

  function _chatDocumentFromPayload(body) {
    const messages = (Array.isArray(body?.messages) ? body.messages : []).map(_chatNormalizeMessage);
    const archivedHistory = _chatArchivedHistory(messages, body?.archived_history);
    const frontmatter = [
      '---',
      'type: "chat"',
      'provider: ' + _yamlString(body?.provider || ''),
      'model: ' + _yamlString(body?.model || ''),
      'created: ' + _yamlString(new Date().toISOString().slice(0, 10)),
      'tags: ' + JSON.stringify(Array.isArray(body?.tags) ? body.tags : []),
    ];
    const title = String(body?.title || '').trim();
    const targetPath = String(body?.targetPath || body?.target_path || '').trim();
    const targetId = String(body?.targetId || body?.target_id || '').trim();
    if (title) frontmatter.push('title: ' + _yamlString(title));
    if (targetPath) frontmatter.push('targetPath: ' + _yamlString(targetPath));
    if (targetId) frontmatter.push('targetId: ' + _yamlString(targetId));
    if (archivedHistory.length) frontmatter.push('archived_history: ' + JSON.stringify(archivedHistory));
    frontmatter.push('messages: ' + JSON.stringify(messages), '---', '');
    const bodyLines = messages.map(message => {
      const role = message.role === 'assistant' ? 'Assistant' : 'User';
      return `### ${role}\n${_chatMessageText(message.content)}\n`;
    });
    return frontmatter.join('\n') + '\n' + bodyLines.join('\n');
  }

  function _chatArchivedHistory(messages, existing) {
    const archived = Array.isArray(existing) ? existing.filter(item => item && typeof item === 'object') : [];
    const seen = new Set(archived.map(item => String(item.summary_msg_id || '')).filter(Boolean));
    messages.forEach(message => {
      if (!message || message.compressed_summary !== true || !Array.isArray(message.original_messages) || !message.original_messages.length) return;
      const key = String(message.msg_id || '');
      if (key && seen.has(key)) return;
      archived.push({
        summary_msg_id: key,
        original_message_count: Number(message.original_message_count || message.original_messages.length) || message.original_messages.length,
        messages: message.original_messages,
      });
      if (key) seen.add(key);
    });
    return archived;
  }

  function _parsePwaChatFrontmatter(raw) {
    const text = String(raw || '');
    const match = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) return { frontmatter: {}, body: text };
    const fm = {};
    match[1].split(/\r?\n/).forEach(line => {
      if (!/^[A-Za-z_][A-Za-z0-9_-]*\s*:/.test(line)) return;
      const idx = line.indexOf(':');
      if (idx <= 0) return;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (!key) return;
      if (!value) { fm[key] = ''; return; }
      try { fm[key] = JSON.parse(value); }
      catch { fm[key] = value.replace(/^['"]|['"]$/g, ''); }
    });
    const yamlLite = _yamlLiteObject(match[1]);
    Object.entries(yamlLite).forEach(([key, value]) => {
      if (Array.isArray(value) || (value && typeof value === 'object')) fm[key] = value;
      else if (!Object.prototype.hasOwnProperty.call(fm, key)) fm[key] = value;
    });
    return { frontmatter: fm, body: text.slice(match[0].length) };
  }

  function _yamlLiteObject(source) {
    const lines = String(source || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const parsed = _yamlLiteBlock(lines, 0, 0).value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  }

  function _yamlLiteIndent(line) {
    return (String(line || '').match(/^ */) || [''])[0].length;
  }

  function _yamlLiteNextIndent(lines, index, minIndent) {
    for (let i = index; i < lines.length; i += 1) {
      if (!String(lines[i] || '').trim()) continue;
      const indent = _yamlLiteIndent(lines[i]);
      if (indent === minIndent && String(lines[i]).slice(indent).startsWith('- ')) return indent;
      if (indent > minIndent) return indent;
      return minIndent + 2;
    }
    return minIndent + 2;
  }

  function _yamlLiteScalar(raw) {
    const value = String(raw == null ? '' : raw).trim();
    if (!value || value === 'null' || value === '~') return '';
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
    try { return JSON.parse(value); } catch {}
    if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
    if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
    return value.replace(/^['"]|['"]$/g, '');
  }

  function _yamlLitePair(text) {
    const match = String(text || '').match(/^([^:#][^:\n]*):\s*(.*)$/);
    return match ? [match[1].trim(), match[2]] : null;
  }

  function _yamlLiteAssign(target, key, rest, lines, index, indent) {
    if (rest && rest.trim()) return { value: _yamlLiteScalar(rest), next: index + 1 };
    const childIndent = _yamlLiteNextIndent(lines, index + 1, indent);
    const child = _yamlLiteBlock(lines, index + 1, childIndent);
    return { value: child.value, next: child.next };
  }

  function _yamlLiteBlock(lines, start, indent) {
    let index = start;
    while (index < lines.length && !String(lines[index] || '').trim()) index += 1;
    if (index >= lines.length || _yamlLiteIndent(lines[index]) < indent) return { value: {}, next: index };
    const isList = _yamlLiteIndent(lines[index]) === indent && String(lines[index]).slice(indent).startsWith('- ');
    if (isList) {
      const list = [];
      while (index < lines.length) {
        const line = String(lines[index] || '');
        if (!line.trim()) { index += 1; continue; }
        const currentIndent = _yamlLiteIndent(line);
        if (currentIndent < indent) break;
        if (currentIndent > indent) { index += 1; continue; }
        const trimmed = line.slice(indent);
        if (!trimmed.startsWith('- ')) break;
        const rest = trimmed.slice(2);
        const pair = _yamlLitePair(rest);
        if (pair) {
          const item = {};
          const assigned = _yamlLiteAssign(item, pair[0], pair[1], lines, index, indent);
          item[pair[0]] = assigned.value;
          index = assigned.next;
          const childIndent = _yamlLiteNextIndent(lines, index, indent);
          const child = _yamlLiteBlock(lines, index, childIndent);
          if (child.value && typeof child.value === 'object' && !Array.isArray(child.value)) Object.assign(item, child.value);
          index = child.next;
          list.push(item);
        } else if (rest.trim()) {
          list.push(_yamlLiteScalar(rest));
          index += 1;
        } else {
          const childIndent = _yamlLiteNextIndent(lines, index + 1, indent);
          const child = _yamlLiteBlock(lines, index + 1, childIndent);
          list.push(child.value);
          index = child.next;
        }
      }
      return { value: list, next: index };
    }
    const obj = {};
    while (index < lines.length) {
      const line = String(lines[index] || '');
      if (!line.trim()) { index += 1; continue; }
      const currentIndent = _yamlLiteIndent(line);
      if (currentIndent < indent) break;
      if (currentIndent > indent) { index += 1; continue; }
      const pair = _yamlLitePair(line.slice(indent));
      if (!pair) break;
      const assigned = _yamlLiteAssign(obj, pair[0], pair[1], lines, index, indent);
      obj[pair[0]] = assigned.value;
      index = assigned.next;
    }
    return { value: obj, next: index };
  }

  function _messagesFromChatBody(body) {
    const text = String(body || '');
    const matches = Array.from(text.matchAll(CHAT_SECTION_RE));
    if (!matches.length) return [];
    const messages = [];
    for (let i = 0; i < matches.length; i += 1) {
      const match = matches[i];
      const next = matches[i + 1];
      const contentStart = match.index + match[0].length;
      const contentEnd = next ? next.index : text.length;
      const content = text.slice(contentStart, contentEnd).trim();
      messages.push({
        role: match[1] === 'Assistant' ? 'assistant' : 'user',
        content,
      });
    }
    return messages.map(_chatNormalizeMessage);
  }

  function _shouldUseBodyChatMessages(frontmatterMessages, bodyMessages) {
    if (!bodyMessages.length) return false;
    if (!frontmatterMessages.length) return true;
    if (bodyMessages.length > frontmatterMessages.length) return true;
    for (let i = 0; i < Math.min(frontmatterMessages.length, bodyMessages.length); i += 1) {
      const front = frontmatterMessages[i] || {};
      const body = bodyMessages[i] || {};
      if (front.role !== body.role) continue;
      if (typeof front.content !== 'string') continue;
      const frontText = front.content.trim();
      const bodyText = typeof body.content === 'string' ? body.content.trim() : '';
      if (/^[|>][-+]?$/.test(frontText) && bodyText) return true;
      if (!frontText && bodyText) return true;
      if (frontText && bodyText.length > frontText.length && bodyText.startsWith(frontText)) return true;
    }
    return false;
  }

  function _messagesFromParsedChat(parsed) {
    const bodyMessages = _messagesFromChatBody(parsed.body);
    if (Array.isArray(parsed.frontmatter.messages)) {
      const frontmatterMessages = parsed.frontmatter.messages.map(_chatNormalizeMessage);
      return _shouldUseBodyChatMessages(frontmatterMessages, bodyMessages) ? bodyMessages : frontmatterMessages;
    }
    return bodyMessages;
  }

  async function _listPwaChatFiles(provider, sourceFolder) {
    const files = [];
    const rootEntries = await _listDirectoryEntries(provider, _llmDir(sourceFolder)).catch(() => []);
    for (const entry of rootEntries) {
      const path = _joinPath(_llmDir(sourceFolder), entry.name);
      if (entry.handle.kind === 'file' && /\.md$/i.test(entry.name)) {
        files.push({ path, handle: entry.handle });
      } else if (entry.handle.kind === 'directory') {
        const childEntries = await _listDirectoryEntries(provider, path).catch(() => []);
        childEntries.forEach(child => {
          if (child.handle.kind === 'file' && /\.md$/i.test(child.name)) {
            files.push({ path: _joinPath(path, child.name), handle: child.handle });
          }
        });
      }
    }
    return files;
  }

  async function _savePwaChat(provider, body, sourceFolder) {
    const savePath = _resolveChatPath(sourceFolder, body?.path || '');
    await _directoryHandle(provider, _dirname(savePath), true);
    await provider.writeText(savePath, _chatDocumentFromPayload(body || {}));
    const result = { ok: true, path: _clientPath(sourceFolder, savePath), user: String(body?.user || '') };
    const extractor = window.MeldexKnowledgeCloudExtractor;
    if (typeof extractor?.extractAfterChatSave === 'function') {
      try {
        result.knowledge = await extractor.extractAfterChatSave(provider, { ...(body || {}), path: savePath });
      } catch (error) {
        result.knowledge = { ok: false, error: error?.message || String(error) };
      }
    }
    return result;
  }

  async function _loadPwaChat(provider, path, sourceFolder) {
    const chatPath = _resolveChatPath(sourceFolder, path || '');
    const raw = await provider.readText(chatPath);
    const parsed = _parsePwaChatFrontmatter(raw);
    const messages = _messagesFromParsedChat(parsed);
    delete parsed.frontmatter.messages;
    return { frontmatter: parsed.frontmatter, messages };
  }

  async function _listPwaChats(provider, sourceFolder) {
    const rows = [];
    for (const file of await _listPwaChatFiles(provider, sourceFolder)) {
      try {
        const raw = await provider.readText(file.path);
        const parsed = _parsePwaChatFrontmatter(raw);
        const stats = await _fileStats(file.handle).catch(() => ({ modifiedMs: 0, modified: '' }));
        const messages = _messagesFromParsedChat(parsed);
        rows.push({
          name: _basename(file.path).replace(/\.md$/i, ''),
          path: _clientPath(sourceFolder, file.path),
          title: String(parsed.frontmatter.title || ''),
          targetPath: String(parsed.frontmatter.targetPath || ''),
          targetId: String(parsed.frontmatter.targetId || ''),
          provider: String(parsed.frontmatter.provider || ''),
          model: String(parsed.frontmatter.model || ''),
          messageCount: messages.length,
          modified: stats.modifiedMs || 0,
        });
      } catch {}
    }
    return rows.sort((a, b) => (b.modified || 0) - (a.modified || 0)).slice(0, 50);
  }

  async function _searchPwaChats(provider, query, sourceFolder) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return { results: [] };
    const results = [];
    const files = await _listPwaChatFiles(provider, sourceFolder);
    for (const file of files) {
      try {
        const raw = await provider.readText(file.path);
        const parsed = _parsePwaChatFrontmatter(raw);
        const data = { frontmatter: parsed.frontmatter, messages: _messagesFromParsedChat(parsed) };
        for (const message of data.messages || []) {
          const text = _chatMessageText(message.content);
          const idx = text.toLowerCase().indexOf(q);
          if (idx < 0) continue;
          const snippet = text.slice(Math.max(0, idx - 40), idx + q.length + 60);
          const clientPath = _clientPath(sourceFolder, file.path);
          const stats = await _fileStats(file.handle).catch(() => ({ modifiedMs: 0 }));
          results.push({ path: clientPath, title: String(data.frontmatter.title || '') || _basename(clientPath), snippet, modified: stats.modifiedMs || 0 });
          break;
        }
      } catch {}
    }
    results.sort((a, b) => (b.modified || 0) - (a.modified || 0));
    return { results: results.slice(0, 30).map(({ modified, ...row }) => row) };
  }

  handlers.push(async ({ method, body, url, pathname }) => {
    const sourceFolder = _requestSourceFolder(url, body || {});
    if (pathname === '/chat/config' && method === 'GET') return _llmConfigShape();
    if (pathname === '/chat/config' && (method === 'PUT' || method === 'POST')) return { ok: false, unsupported: true };
    if (pathname === '/chat/list' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      return _listPwaChats(provider, sourceFolder);
    }
    if (pathname === '/chat/search' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      return _searchPwaChats(provider, url.searchParams.get('q') || '', sourceFolder);
    }
    if (pathname === '/chat/load' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      return _loadPwaChat(provider, url.searchParams.get('path') || '', sourceFolder);
    }
    if (pathname === '/chat/save' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      return _savePwaChat(provider, body || {}, sourceFolder);
    }
    if (pathname === '/chat/stream' && method === 'POST') return { ok: true, direct_client_stream: true };
    return NOT_HANDLED;
  });
})();
