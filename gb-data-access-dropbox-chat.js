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

  function _chatNormalizeMessage(message) {
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
    return clean;
  }

  function _yamlString(value) {
    return JSON.stringify(String(value || ''));
  }

  function _chatDocumentFromPayload(body) {
    const messages = (Array.isArray(body?.messages) ? body.messages : []).map(_chatNormalizeMessage);
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
    frontmatter.push('messages: ' + JSON.stringify(messages), '---', '');
    const bodyLines = messages.map(message => {
      const role = message.role === 'assistant' ? 'Assistant' : 'User';
      return `### ${role}\n${_chatMessageText(message.content)}\n`;
    });
    return frontmatter.join('\n') + '\n' + bodyLines.join('\n');
  }

  function _parsePwaChatFrontmatter(raw) {
    const text = String(raw || '');
    const match = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) return { frontmatter: {}, body: text };
    const fm = {};
    match[1].split(/\r?\n/).forEach(line => {
      const idx = line.indexOf(':');
      if (idx <= 0) return;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (!key) return;
      if (!value) { fm[key] = ''; return; }
      try { fm[key] = JSON.parse(value); }
      catch { fm[key] = value.replace(/^['"]|['"]$/g, ''); }
    });
    return { frontmatter: fm, body: text.slice(match[0].length) };
  }

  async function _listPwaChatFiles(provider) {
    const files = [];
    const rootEntries = await _listDirectoryEntries(provider, PWA_CHAT_LLM_DIR).catch(() => []);
    for (const entry of rootEntries) {
      const path = _joinPath(PWA_CHAT_LLM_DIR, entry.name);
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

  async function _savePwaChat(provider, body) {
    const savePath = _normalizeFolderPath(body?.path || '');
    if (!savePath || !savePath.startsWith(PWA_CHAT_LLM_DIR + '/') || !/\.md$/i.test(savePath)) {
      throw new Error('_chat/llm 配下の .md パスを指定してください');
    }
    await _directoryHandle(provider, _dirname(savePath), true);
    await provider.writeText(savePath, _chatDocumentFromPayload(body || {}));
    const result = { ok: true, path: savePath, user: String(body?.user || '') };
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

  async function _loadPwaChat(provider, path) {
    const chatPath = _normalizeFolderPath(path || '');
    if (!chatPath.startsWith(PWA_CHAT_LLM_DIR + '/')) throw new Error('_chat/llm 配下以外のチャットは読み込めません');
    const raw = await provider.readText(chatPath);
    const parsed = _parsePwaChatFrontmatter(raw);
    const messages = Array.isArray(parsed.frontmatter.messages) ? parsed.frontmatter.messages.map(_chatNormalizeMessage) : [];
    delete parsed.frontmatter.messages;
    return { frontmatter: parsed.frontmatter, messages };
  }

  async function _listPwaChats(provider) {
    const rows = [];
    for (const file of await _listPwaChatFiles(provider)) {
      try {
        const raw = await provider.readText(file.path);
        const parsed = _parsePwaChatFrontmatter(raw);
        const stats = await _fileStats(file.handle).catch(() => ({ modifiedMs: 0, modified: '' }));
        rows.push({
          name: _basename(file.path).replace(/\.md$/i, ''),
          path: file.path,
          title: String(parsed.frontmatter.title || ''),
          targetPath: String(parsed.frontmatter.targetPath || ''),
          targetId: String(parsed.frontmatter.targetId || ''),
          provider: String(parsed.frontmatter.provider || ''),
          model: String(parsed.frontmatter.model || ''),
          messageCount: Array.isArray(parsed.frontmatter.messages) ? parsed.frontmatter.messages.length : 0,
          modified: stats.modifiedMs || 0,
        });
      } catch {}
    }
    return rows.sort((a, b) => (b.modified || 0) - (a.modified || 0)).slice(0, 50);
  }

  async function _searchPwaChats(provider, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return { results: [] };
    const results = [];
    for (const item of await _listPwaChats(provider)) {
      try {
        const data = await _loadPwaChat(provider, item.path);
        for (const message of data.messages || []) {
          const text = _chatMessageText(message.content);
          const idx = text.toLowerCase().indexOf(q);
          if (idx < 0) continue;
          const snippet = text.slice(Math.max(0, idx - 40), idx + q.length + 60);
          results.push({ path: item.path, title: item.title || _basename(item.path), snippet });
          break;
        }
      } catch {}
    }
    return { results: results.slice(0, 30) };
  }

  handlers.push(async ({ method, body, url, pathname }) => {
    if (pathname === '/chat/config' && method === 'GET') return _llmConfigShape();
    if (pathname === '/chat/config' && (method === 'PUT' || method === 'POST')) return { ok: false, unsupported: true };
    if (pathname === '/chat/list' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      return _listPwaChats(provider);
    }
    if (pathname === '/chat/search' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      return _searchPwaChats(provider, url.searchParams.get('q') || '');
    }
    if (pathname === '/chat/load' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      return _loadPwaChat(provider, url.searchParams.get('path') || '');
    }
    if (pathname === '/chat/save' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      return _savePwaChat(provider, body || {});
    }
    if (pathname === '/chat/stream' && method === 'POST') return { ok: true, direct_client_stream: true };
    return NOT_HANDLED;
  });
})();
