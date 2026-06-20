// gb-chat-citations.js: LLM citation pills and source jumps
(function(global) {
  function _escapeText(text) {
    if (typeof esc === 'function') return esc(String(text || ''));
    return String(text || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function _assistantHtml(text) {
    let safe = _escapeText(text);
    safe = safe.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    safe = safe.replace(/`([^`]+)`/g, '<code style="background:var(--bg2);padding:1px 4px;border-radius:3px;">$1</code>');
    safe = safe.replace(/\n/g, '<br>');
    if (typeof renderStamps === 'function') safe = renderStamps(safe);
    return safe;
  }

  function _citationUriParts(citation) {
    const uri = String(citation?.uri || '').trim();
    if (!uri) return {};
    try {
      const parsed = new URL(uri);
      return {
        path: parsed.searchParams.get('path') || '',
        fileId: (parsed.pathname || '').replace(/^\/+/, '') || '',
        line: parsed.searchParams.get('line') || '',
        chunk: parsed.searchParams.get('chunk') || '',
      };
    } catch {
      return {};
    }
  }

  function _citationPath(citation) {
    const direct = String(citation?.path || '').trim();
    if (direct) return direct;
    return _citationUriParts(citation).path || '';
  }

  function _citationUrl(citation) {
    return String(citation?.url || citation?.uri || '').trim();
  }

  function _citationFileId(citation) {
    const direct = String(citation?.file_id || citation?.fileId || '').trim();
    if (direct) return direct;
    return _citationUriParts(citation).fileId || '';
  }

  function _citationLine(citation) {
    const uriParts = _citationUriParts(citation);
    const raw = citation?.line || citation?.start_line || uriParts.line || '';
    const line = Number(raw);
    return Number.isFinite(line) && line > 0 ? Math.floor(line) : 0;
  }

  function _citationChunk(citation) {
    const uriParts = _citationUriParts(citation);
    const raw = citation?.chunk_index ?? citation?.chunk ?? uriParts.chunk ?? '';
    const chunk = Number(raw);
    return Number.isFinite(chunk) && chunk >= 0 ? Math.floor(chunk) : 0;
  }

  function _citationBasename(path) {
    const clean = String(path || '').split(/[?#]/)[0].replace(/[\\\/]+$/, '');
    return clean.split(/[\\\/]/).pop() || clean || path;
  }

  function _citationExtension(path) {
    const name = _citationBasename(path).toLowerCase();
    const index = name.lastIndexOf('.');
    return index >= 0 ? name.slice(index) : '';
  }

  function _citationLabel(citation, index) {
    const path = _citationPath(citation);
    const title = String(citation?.title || citation?.document_title || path || '出典').trim();
    const name = title.split(/[\\/]/).pop() || title || '出典';
    const line = _citationLine(citation);
    return `${index + 1}. ${name}${line ? ':L' + line : ''}`;
  }

  function _citationKey(citation) {
    return JSON.stringify({
      uri: citation?.uri || '',
      url: _citationUrl(citation),
      fileId: _citationFileId(citation),
      path: _citationPath(citation),
      line: _citationLine(citation),
      chunk: _citationChunk(citation),
      text: citation?.cited_text || '',
    });
  }

  function _uniqueCitations(citations) {
    const seen = new Set();
    const out = [];
    (citations || []).forEach(citation => {
      if (!citation || typeof citation !== 'object') return;
      const key = _citationKey(citation);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(citation);
    });
    return out;
  }

  function _appendCitationPills(container, citations) {
    if (!container) return;
    container.querySelectorAll(':scope > .chat-citations').forEach(el => el.remove());
    const list = _uniqueCitations(citations);
    if (!list.length) return;
    const row = document.createElement('div');
    row.className = 'chat-citations';
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;white-space:normal;';
    list.forEach((citation, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-citation-pill';
      btn.style.cssText = 'display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:2px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg2);color:var(--fg2);font-size:11px;line-height:1.35;cursor:pointer;';
      const icon = document.createElement('span');
      icon.style.cssText = 'display:inline-flex;flex-shrink:0;';
      icon.innerHTML = typeof lucide === 'function' ? lucide(citation?.source === 'web' ? 'globe' : 'link', 11) : '';
      const label = document.createElement('span');
      label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;';
      label.textContent = _citationLabel(citation, index);
      btn.title = [
        _citationPath(citation) || _citationUrl(citation),
        citation?.cited_text ? String(citation.cited_text).slice(0, 180) : '',
      ].filter(Boolean).join('\n');
      btn.appendChild(icon);
      btn.appendChild(label);
      btn.addEventListener('click', () => _openChatCitation(citation));
      row.appendChild(btn);
    });
    container.appendChild(row);
  }

  function _chatRenderAssistantStream(container, text, citations) {
    if (!container) return;
    if (typeof global.renderChatMarkdown === 'function') {
      global.renderChatMarkdown(container, text, { role: 'assistant' });
    } else {
      container.innerHTML = _assistantHtml(text);
    }
    _appendCitationPills(container, citations);
  }

  function _findTextNode(root, needle) {
    if (!root || !needle) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const index = node.nodeValue.indexOf(needle);
      if (index >= 0) return { node, index };
    }
    return null;
  }

  function _scrollPageToCitation(citation) {
    const page = document.getElementById('page-content');
    if (!page) return;
    const text = String(citation?.cited_text || '').replace(/\s+/g, ' ').trim();
    const needle = text.length > 80 ? text.slice(0, 80) : text;
    const found = needle.length >= 6 ? _findTextNode(page, needle) : null;
    if (found) {
      try {
        const range = document.createRange();
        range.setStart(found.node, found.index);
        range.setEnd(found.node, Math.min(found.node.nodeValue.length, found.index + needle.length));
        const selection = global.getSelection?.();
        selection?.removeAllRanges();
        selection?.addRange(range);
        const rect = range.getBoundingClientRect();
        const scroller = page;
        scroller.scrollTop += rect.top - scroller.getBoundingClientRect().top - 80;
        return;
      } catch {}
    }
    const line = _citationLine(citation);
    if (line > 1) {
      const totalLines = Math.max(1, (page.innerText || '').split(/\r?\n/).length);
      const ratio = Math.min(1, Math.max(0, (line - 1) / totalLines));
      page.scrollTop = page.scrollHeight * ratio;
    }
  }

  async function _resolveCitationPath(citation) {
    const path = _citationPath(citation);
    if (path) return path;
    const fileId = _citationFileId(citation);
    if (!fileId || typeof apiFetch !== 'function') return '';
    try {
      const data = await apiFetch('/file-path?id=' + encodeURIComponent(fileId));
      return String(data?.path || '');
    } catch {
      return '';
    }
  }

  async function _citationFileType(path) {
    if (!path || typeof apiFetch !== 'function') return '';
    try {
      const data = await apiFetch('/check-type?path=' + encodeURIComponent(path), { silentError: true });
      return String(data?.type || '');
    } catch {
      return '';
    }
  }

  function _citationCanOpenAsPage(path, type, ext) {
    if (type === 'page') return true;
    if (type && type !== 'unknown') return false;
    return ['.md', '.markdown', '.txt'].includes(ext);
  }

  async function _openLocalChatCitation(path, citation) {
    const label = _citationBasename(path).replace(/\.\w+$/, '') || path;
    const lower = path.toLowerCase();
    const ext = _citationExtension(path);
    const type = await _citationFileType(path);
    const opts = { fromExplorer: true, source: 'chat-citation' };
    if (type === 'folder' && typeof openFolder === 'function') {
      await openFolder(label, path, opts);
    } else if (type === 'database' && typeof selectDatabase === 'function') {
      await selectDatabase(path, null, opts);
    } else if ((type === 'smart-db' || lower.endsWith('.smart-db.json') || lower.endsWith('.mel-sheet')) && typeof openSmartDbFile === 'function') {
      await openSmartDbFile(label, path, opts);
    } else if ((type === 'calendar') && typeof openCalendarFile === 'function') {
      await openCalendarFile(label, path, opts);
    } else if ((type === 'chat') && typeof openSavedChat === 'function') {
      await openSavedChat(path);
    } else if ((type === 'scriptnote' || type === 'scenario' || lower.endsWith('.mel-scenario') || lower.endsWith('.scriptnote.json') || lower.endsWith('.scenario.json')) && typeof openScenarioInScriptNote === 'function') {
      openScenarioInScriptNote(path, label, opts);
    } else if ((type === 'board' || lower.endsWith('.mel-board') || lower.endsWith('.board.md')) && typeof openBoard === 'function') {
      await openBoard(label, path, opts);
    } else if (ext === '.csv' && typeof openCsvFile === 'function') {
      await openCsvFile(label, path, opts);
    } else if ((ext === '.html' || ext === '.htm') && typeof openHtmlFile === 'function') {
      await openHtmlFile(label, path, opts);
    } else if (ext === '.pdf' && typeof openViewer === 'function') {
      openViewer('/viewer?pdf=' + encodeURIComponent(path), opts);
    } else if (_citationCanOpenAsPage(path, type, ext) && typeof openPage === 'function') {
      await openPage(label, path, opts);
      setTimeout(() => _scrollPageToCitation(citation), 80);
    } else if (typeof openNative === 'function') {
      await openNative(path);
    } else {
      if (typeof showStatus === 'function') showStatus('この出典はノートとして開けません', true);
      return false;
    }
    return true;
  }

  async function _openChatCitation(citation) {
    const url = _citationUrl(citation);
    if (/^https?:\/\//i.test(url) && !_citationPath(citation) && !_citationFileId(citation)) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    const path = await _resolveCitationPath(citation);
    if (!path) {
      if (typeof showStatus === 'function') showStatus('出典ファイルを特定できません', true);
      return;
    }
    try {
      const opened = await _openLocalChatCitation(path, citation);
      if (opened && typeof showStatus === 'function') showStatus('出典を開きました');
    } catch (e) {
      if (typeof showStatus === 'function') showStatus('出典を開けません: ' + (e?.message || e), true);
    }
  }

  global._chatRenderAssistantStream = _chatRenderAssistantStream;
  global._chatRenderCitations = _appendCitationPills;
  global._openChatCitation = _openChatCitation;
})(window);
