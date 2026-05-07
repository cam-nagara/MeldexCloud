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
      path: _citationPath(citation),
      line: _citationLine(citation),
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

  async function _openChatCitation(citation) {
    const url = _citationUrl(citation);
    if (citation?.source === 'web' && /^https?:\/\//i.test(url)) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    const path = await _resolveCitationPath(citation);
    if (!path) {
      if (typeof showStatus === 'function') showStatus('出典ファイルを特定できません', true);
      return;
    }
    const label = path.split('/').pop()?.replace(/\.\w+$/, '') || path;
    const lower = path.toLowerCase();
    const opts = { fromExplorer: true };
    try {
      if ((lower.endsWith('.scriptnote.json') || lower.endsWith('.scenario.json')) && typeof openScenarioInScriptNote === 'function') {
        openScenarioInScriptNote(path, label, opts);
      } else if (lower.endsWith('.board.md') && typeof openBoard === 'function') {
        await openBoard(label, path, opts);
      } else if (lower.endsWith('.csv') && typeof openCsvFile === 'function') {
        await openCsvFile(label, path, opts);
      } else if (lower.endsWith('.html') && typeof openHtmlFile === 'function') {
        await openHtmlFile(label, path, opts);
      } else if (typeof openPage === 'function') {
        await openPage(label, path, opts);
        setTimeout(() => _scrollPageToCitation(citation), 80);
      }
      if (typeof showStatus === 'function') showStatus('出典を開きました');
    } catch (e) {
      if (typeof showStatus === 'function') showStatus('出典を開けません: ' + (e?.message || e), true);
    }
  }

  global._chatRenderAssistantStream = _chatRenderAssistantStream;
  global._chatRenderCitations = _appendCitationPills;
  global._openChatCitation = _openChatCitation;
})(window);
