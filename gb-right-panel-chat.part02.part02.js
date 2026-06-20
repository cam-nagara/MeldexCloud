function _chatExportThemeCss() {
  const vars = (typeof MeldexExportHtml !== 'undefined' && typeof MeldexExportHtml.collectCssVars === 'function')
    ? MeldexExportHtml.collectCssVars()
    : '';
  return `
:root{${vars}}
html,body{
  margin:0;
  padding:0;
  background:var(--bg,#1e1e1e);
  color:var(--fg,#d4d4d4);
  font-family:var(--ui-font,'Noto Sans JP','Hiragino Sans','Yu Gothic UI','Meiryo',system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);
  font-size:var(--ui-font-size,15px);
  line-height:1.6;
  scrollbar-color:var(--ui-scrollbar-thumb-bg,var(--bg4,#444)) var(--ui-scrollbar-track-bg,var(--bg2,#252525));
}
::-webkit-scrollbar{width:10px;height:10px;}
::-webkit-scrollbar-track{background:var(--ui-scrollbar-track-bg,var(--bg2,#252525));}
::-webkit-scrollbar-thumb{background:var(--ui-scrollbar-thumb-bg,var(--bg4,#444));border-radius:5px;}
::-webkit-scrollbar-thumb:hover{background:var(--ui-scrollbar-thumb-hover-bg,var(--fg2,#888));}
main{max-width:960px;margin:0 auto;padding:32px;}
article{border:1px solid var(--border,#444);border-radius:8px;padding:14px 16px;margin:14px 0;background:var(--bg2,#252525);}
article.user{background:var(--bg3,#303030);}
h1{font-size:28px;margin:0 0 18px;color:var(--accent,var(--fg));}
h2{font-size:16px;margin:0 0 10px;color:var(--fg,#d4d4d4);}
h3{font-size:14px;margin:14px 0 6px;color:var(--fg,#d4d4d4);}
time{font-size:12px;color:var(--fg2,#aaa);font-weight:400;}
pre{white-space:pre-wrap;word-break:break-word;background:var(--bg,#1e1e1e);color:var(--fg,#d4d4d4);border:1px solid var(--border,#444);border-radius:6px;padding:10px;overflow:auto;}
p{color:var(--fg2,#aaa);}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
`;
}

function _chatExportMessageMarkdown(message, index) {
  const role = _chatExportRoleLabel(message);
  const time = _chatExportTimestamp(message);
  const title = time ? `${role} (${time})` : role;
  const chunks = [`## ${index + 1}. ${title}`, '', _chatContentToText(message?.content || '').trim()];
  const blocks = Array.isArray(message?.code_exec_blocks) ? message.code_exec_blocks : [];
  blocks.forEach((block, blockIndex) => {
    const code = String(block?.code || '').trim();
    const output = typeof _chatCodeExecOutput === 'function' ? _chatCodeExecOutput(block) : '';
    if (code) chunks.push('', `### 実行コード ${blockIndex + 1}`, '', '```' + String(block?.language || 'python'), code, '```');
    if (output) chunks.push('', `### 実行結果 ${blockIndex + 1}`, '', '```text', output, '```');
  });
  return chunks.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
}

function _chatExportMarkdownBody(title) {
  const lines = [
    '# ' + title,
    '',
    '- エクスポート日時: ' + new Date().toISOString(),
    '- セッションID: ' + (_chatState.sessionId || '(未採番)'),
  ];
  if (_chatState.targetPath) lines.push('- 対象: ' + _chatState.targetPath);
  if (_chatState.provider || _chatState.model) lines.push('- モデル: ' + getProviderLabel(_chatState.provider, _chatState.model));
  lines.push('');
  _chatState.messages.forEach((message, index) => {
    lines.push(_chatExportMessageMarkdown(message, index), '');
  });
  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
}

function _chatExportMeldexNote(title) {
  const frontmatter = [
    '---',
    'type: note',
    'source: chat-export',
    'title: ' + _chatYamlQuote(title),
    'chatSessionId: ' + _chatYamlQuote(_chatState.sessionId || ''),
    'chatTargetPath: ' + _chatYamlQuote(_chatState.targetPath || ''),
    'chatProvider: ' + _chatYamlQuote(_chatState.provider || ''),
    'chatModel: ' + _chatYamlQuote(_chatState.model || ''),
    'exportedAt: ' + _chatYamlQuote(new Date().toISOString()),
    '---',
    '',
  ];
  return frontmatter.join('\n') + _chatExportMarkdownBody(title);
}

function _chatExportHtml(title) {
  const messages = _chatState.messages.map((message, index) => {
    const role = _chatExportRoleLabel(message);
    const time = _chatExportTimestamp(message);
    const text = _chatContentToText(message?.content || '').trim();
    const blocks = Array.isArray(message?.code_exec_blocks) ? message.code_exec_blocks : [];
    const codeBlocks = blocks.map((block, blockIndex) => {
      const code = String(block?.code || '').trim();
      const output = typeof _chatCodeExecOutput === 'function' ? _chatCodeExecOutput(block) : '';
      return [
        code ? `<h3>実行コード ${blockIndex + 1}</h3><pre><code>${_chatHtmlEscape(code)}</code></pre>` : '',
        output ? `<h3>実行結果 ${blockIndex + 1}</h3><pre><code>${_chatHtmlEscape(output)}</code></pre>` : '',
      ].join('');
    }).join('');
    return `<article class="message ${_chatHtmlEscape(message?.role || '')}">
  <h2>${index + 1}. ${_chatHtmlEscape(role)}${time ? ` <time>${_chatHtmlEscape(time)}</time>` : ''}</h2>
  <pre>${_chatHtmlEscape(text)}</pre>
  ${codeBlocks}
</article>`;
  }).join('\n');
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="dark light">
<title>${_chatHtmlEscape(title)}</title>
<style>
${_chatExportThemeCss()}
</style>
</head>
<body>
<main>
<h1>${_chatHtmlEscape(title)}</h1>
<p>エクスポート日時: ${_chatHtmlEscape(new Date().toISOString())}</p>
${messages}
</main>
</body>
</html>
`;
}

async function chatExport(format = 'markdown') {
  const key = String(format || 'markdown');
  if (_chatState.messages.length === 0) {
    showStatus('エクスポートするメッセージがありません', true);
    return false;
  }
  if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveText !== 'function') {
    showStatus('エクスポート機能を読み込めませんでした', true);
    return false;
  }
  const title = _chatExportTitle();
  const safeTitle = (typeof MeldexExportSave.sanitizeTitle === 'function')
    ? MeldexExportSave.sanitizeTitle(title, 'チャット')
    : (title || 'チャット');
  if (key === 'meldex-note') {
    return MeldexExportSave.saveText(_chatExportMeldexNote(title), {
      filename: safeTitle + '-Meldexノート.md',
      extension: '.md',
      filetypes: [['Meldexノート', '*.md'], ['Markdown', '*.md'], ['すべてのファイル', '*.*']],
      dialogTitle: 'チャットをMeldexノート形式でエクスポート',
      okMessage: 'チャットをMeldexノート形式でエクスポートしました',
      errorMessage: 'エクスポートに失敗しました',
    });
  }
  if (key === 'html') {
    return MeldexExportSave.saveText(_chatExportHtml(title), {
      filename: safeTitle + '.html',
      extension: '.html',
      filetypes: [['HTML', '*.html'], ['すべてのファイル', '*.*']],
      dialogTitle: 'チャットをHTML形式でエクスポート',
      okMessage: 'チャットをHTML形式でエクスポートしました',
      errorMessage: 'エクスポートに失敗しました',
    });
  }
  return MeldexExportSave.saveText(_chatExportMarkdownBody(title), {
    filename: safeTitle + '.md',
    extension: '.md',
    filetypes: [['Markdown', '*.md'], ['テキスト', '*.txt'], ['すべてのファイル', '*.*']],
    dialogTitle: 'チャットをMarkdown形式でエクスポート',
    okMessage: 'チャットをMarkdown形式でエクスポートしました',
    errorMessage: 'エクスポートに失敗しました',
  });
}

function showChatExportMenu(event) {
  if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
  document.querySelectorAll('.gb-context-menu').forEach(menu => menu.remove());
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu chat-export-menu';
  const items = [
    { format: 'meldex-note', icon: 'fileText', label: 'Meldexノート形式' },
    { format: 'html', icon: 'globe', label: 'HTML形式' },
    { format: 'markdown', icon: 'fileText', label: 'Markdown形式' },
  ];
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'gb-context-menu-item';
    row.innerHTML = (typeof lucide === 'function' ? lucide(item.icon, 14) : '') + ' ' + item.label;
    row.addEventListener('click', () => {
      menu.remove();
      chatExport(item.format);
    });
    menu.appendChild(row);
  });
  document.body.appendChild(menu);
  const zoom = (typeof _getZoom === 'function') ? _getZoom() : 1;
  const anchor = event?.currentTarget?.getBoundingClientRect?.();
  if (anchor && typeof positionPopup === 'function') {
    positionPopup(menu, anchor);
  } else {
    menu.style.left = (((event?.clientX || window.innerWidth / 2) / zoom)) + 'px';
    menu.style.top = (((event?.clientY || 48) / zoom)) + 'px';
  }
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  setTimeout(() => {
    const closer = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('pointerdown', closer);
      }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

function chatSave(event) {
  return showChatExportMenu(event);
}

// チャット履歴一覧を表示
async function renderChatHistory() {
  const listEl = document.getElementById('chat-history-list');
  if (!listEl) return;
  if (!_chatSourceFolderValue() && !(typeof _chatWorkspaceIdValue === 'function' && _chatWorkspaceIdValue())) {
    listEl.innerHTML = '<div style="padding:8px;color:var(--fg2);font-size:11px;text-align:center;">対象ワークスペースまたはフォルダを選択してください</div>';
    return;
  }
  listEl.innerHTML = '<div style="padding:8px;color:var(--fg2);font-size:11px;text-align:center;">読み込み中...</div>';
  try {
    const items = await apiFetch(_chatApiPath('/chat/list'));
    if (!items || items.length === 0) {
      listEl.innerHTML = '<div style="padding:8px;color:var(--fg2);font-size:11px;text-align:center;">履歴がありません</div>';
      return;
    }
    listEl.innerHTML = '';
    items.forEach(item => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:6px 8px;border-bottom:1px solid var(--border);cursor:pointer;font-size:12px;';
      div.onmouseover = () => div.style.background = 'rgba(255,255,255,0.03)';
      div.onmouseout = () => div.style.background = '';
      const isActive = _chatState.sessionId && item.name === _chatState.sessionId;
      const targetName = item.targetPath ? item.targetPath.split('/').pop() : '';
      const displayTitle = _chatListTitle(item) || item.name;
      const targetInfo = item.title && targetName && item.title !== targetName
        ? `<div style="margin-top:3px;font-size:10px;color:var(--fg2);display:flex;align-items:center;gap:4px;">${lucide('fileText', 10)} <span>${esc(targetName)}</span></div>`
        : '';
      const msgCount = item.messageCount ? `<span style="font-size:10px;color:var(--fg2);">${item.messageCount}件</span>` : '';
      const providerIcon = getProviderIconHtml(item.provider || 'gemini', 14);
      div.innerHTML = `<div style="display:flex;align-items:center;gap:4px;color:${isActive ? 'var(--accent)' : 'var(--fg)'};${isActive ? 'font-weight:bold;' : ''}">${providerIcon}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(displayTitle)}</span> ${msgCount}</div>${targetInfo}`;
      div.addEventListener('click', () => {
        openSavedChat(item.path, '', item.source_folder || item.sourceFolder);
      });
      listEl.appendChild(div);
    });
  } catch (e) {
    listEl.innerHTML = '<div style="padding:8px;color:var(--fg2);font-size:11px;text-align:center;">履歴を取得できません</div>';
  }
}

// ==============================
// チャット検索
// ==============================
let _chatSearchTimer = null;
let _chatSearchSerial = 0;
function _chatSearchToggle() {
  const bar = document.getElementById('chat-search-bar');
  if (!bar) return;
  const visible = bar.style.display === 'flex';
  bar.style.display = visible ? 'none' : 'flex';
  if (!visible) {
    document.getElementById('chat-search-input')?.focus();
  } else {
    _chatSearchClose();
  }
}
function _chatSearchClose() {
  clearTimeout(_chatSearchTimer);
  _chatSearchSerial++;
  const bar = document.getElementById('chat-search-bar');
  if (bar) bar.style.display = 'none';
  const results = document.getElementById('chat-search-results');
  if (results) { results.style.display = 'none'; results.innerHTML = ''; }
  const msgs = _chatLiveMessagesContainer();
  if (msgs) msgs.style.display = 'flex';
  // ハイライト除去
  if (msgs) msgs.querySelectorAll('.chat-search-hl').forEach(m => {
    m.replaceWith(document.createTextNode(m.textContent));
  });
  const countEl = document.getElementById('chat-search-count');
  if (countEl) countEl.textContent = '';
  const input = document.getElementById('chat-search-input');
  if (input) input.value = '';
}
// 全チャット検索結果からセッションを開く
function _chatLoadSession(path, sourceFolder) {
  _chatSearchClose();
  if (typeof openSavedChat === 'function') openSavedChat(path, '', sourceFolder);
}

function _chatAppendHighlightedText(parent, text, query) {
  const source = String(text || '');
  const needle = String(query || '');
  if (!parent || !needle) {
    parent?.appendChild(document.createTextNode(source));
    return;
  }
  const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  let lastIndex = 0;
  source.replace(pattern, (match, offset) => {
    if (offset > lastIndex) parent.appendChild(document.createTextNode(source.slice(lastIndex, offset)));
    const mark = document.createElement('mark');
    mark.style.cssText = 'background:var(--orange);color:var(--ui-fg-strong);border-radius:2px;padding:0 1px;';
    mark.textContent = match;
    parent.appendChild(mark);
    lastIndex = offset + match.length;
    return match;
  });
  if (lastIndex < source.length) parent.appendChild(document.createTextNode(source.slice(lastIndex)));
}

function _chatSearch() {
  const q = document.getElementById('chat-search-input')?.value?.trim();
  const scope = document.getElementById('chat-search-scope')?.value || 'session';
  const countEl = document.getElementById('chat-search-count');
  if (!q) { _chatSearchClose(); _safeSetDisplay('chat-search-bar', 'flex'); return; }
  const searchSerial = ++_chatSearchSerial;
  if (scope === 'session') {
    // セッション内検索: メッセージ内テキストをハイライト
    const results = document.getElementById('chat-search-results');
    if (results) { results.style.display = 'none'; }
    const msgs = _chatLiveMessagesContainer();
    if (!msgs) return;
    if (msgs) msgs.style.display = 'flex';
    // 既存ハイライト除去
    msgs.querySelectorAll('.chat-search-hl').forEach(m => m.replaceWith(document.createTextNode(m.textContent)));
    let count = 0;
    const lq = q.toLowerCase();
    // 1パスでハイライト: 全テキストノードを収集してから一括処理
    const textNodes = [];
    const walker = document.createTreeWalker(msgs, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);
    for (const tnode of textNodes) {
      const text = tnode.textContent;
      const parent = tnode.parentNode;
      if (!parent || parent.classList?.contains('chat-search-hl')) continue;
      const parts = [];
      let lastIdx = 0;
      const lt = text.toLowerCase();
      let idx;
      while ((idx = lt.indexOf(lq, lastIdx)) >= 0) {
        if (idx > lastIdx) parts.push(document.createTextNode(text.substring(lastIdx, idx)));
        const hl = document.createElement('mark');
        hl.className = 'chat-search-hl';
        hl.style.cssText = 'background:var(--orange);color:var(--ui-fg-strong);border-radius:2px;padding:0 1px;';
        hl.textContent = text.substring(idx, idx + q.length);
        parts.push(hl);
        count++;
        lastIdx = idx + q.length;
      }
      if (parts.length) {
        if (lastIdx < text.length) parts.push(document.createTextNode(text.substring(lastIdx)));
        const frag = document.createDocumentFragment();
        parts.forEach(p => frag.appendChild(p));
        parent.replaceChild(frag, tnode);
      }
    }
    if (countEl) countEl.textContent = count + '件';
    // 最初のハイライトにスクロール
    const first = msgs.querySelector('.chat-search-hl');
    if (first) first.scrollIntoView({ block: 'center' });
  } else {
    // 全チャット検索: API経由
    const msgs = _chatLiveMessagesContainer();
    if (msgs) msgs.style.display = 'none';
    const results = document.getElementById('chat-search-results');
    if (!results) return;
    results.style.display = 'block';
    if (!_chatSourceFolderValue() && !(typeof _chatWorkspaceIdValue === 'function' && _chatWorkspaceIdValue())) {
      results.innerHTML = '<div style="color:var(--fg2);font-size:12px;padding:8px;">対象ワークスペースまたはフォルダを選択してください</div>';
      if (countEl) countEl.textContent = '0件';
      return;
    }
    results.innerHTML = '<div style="color:var(--fg2);font-size:12px;padding:8px;">検索中...</div>';
    apiFetch(_chatApiPath('/chat/search?q=' + encodeURIComponent(q))).then(data => {
      if (searchSerial !== _chatSearchSerial) return;
      const items = data.results || [];
      if (countEl) countEl.textContent = items.length + '件';
      if (items.length === 0) {
        results.innerHTML = '<div style="color:var(--fg2);font-size:12px;padding:8px;">結果なし</div>';
        return;
      }
      results.innerHTML = '';
      items.forEach(r => {
        const row = document.createElement('div');
        row.style.cssText = 'padding:6px 8px;border-bottom:1px solid var(--border);cursor:pointer;font-size:12px;';
        const title = document.createElement('div');
        title.style.cssText = 'font-weight:bold;color:var(--fg);margin-bottom:2px;';
        title.textContent = r.title || String(r.path || '').split('/').pop();
        const preview = document.createElement('div');
        preview.style.cssText = 'color:var(--fg2);font-size:11px;';
        _chatAppendHighlightedText(preview, r.snippet || '', q);
        row.append(title, preview);
        row.addEventListener('click', () => _chatLoadSession(r.path, r.source_folder || r.sourceFolder));
        results.appendChild(row);
      });
    }).catch(() => {
      if (searchSerial !== _chatSearchSerial) return;
      results.innerHTML = '<div style="color:var(--fg2);font-size:12px;padding:8px;">検索に失敗しました</div>';
      if (countEl) countEl.textContent = '';
    });
  }
}
// 検索入力のデバウンス
document.getElementById('chat-search-input')?.addEventListener('input', () => {
  clearTimeout(_chatSearchTimer);
  _chatSearchTimer = setTimeout(_chatSearch, 300);
});
document.getElementById('chat-search-scope')?.addEventListener('change', () => { _chatSearch(); });

// Enter送信、Shift+Enter改行
document.getElementById('chat-input')?.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    if (typeof _chatIsImeEnterEvent === 'function' && _chatIsImeEnterEvent(e)) return;
    e.preventDefault();
    chatSend();
  }
});

// ============================
// メッセージ入力欄への D&D（LLM / チーム / DM 共通）
// - 画像 → pending 添付に追加（＋ボタンと同じ扱い）
// - 非画像 → アップロードして入力欄に 名前表示のリンクを挿入
// - 外部ブラウザの画像 URL → fetch して再アップロード
// ============================
function _chatMessageDropBind(inputId, messagesId, mode) {
  [inputId, messagesId].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    el.addEventListener('drop', (e) => { _chatMessageDropHandle(e, inputId, mode); });
  });
}

async function _chatMessageDropHandle(e, inputId, mode) {
  e.preventDefault();
  e.stopPropagation();
  const dt = e.dataTransfer;
  if (!dt) return;
  if (mode === 'team' && !_teamCurrentRoom) {
    if (typeof showStatus === 'function') showStatus('ルームを選択してください', true);
    return;
  }

  // 1. OS / 外部ブラウザからの実ファイル（画像 or それ以外）
  if (dt.files && dt.files.length > 0) {
    for (const file of dt.files) {
      await _chatMessageDropFile(file, mode, inputId);
    }
    return;
  }

  // 2. Meldex 内部ノードのドロップ（フォルダツリー/フォルダパネル/シート）
  const nodeData = dt.getData('application/x-meldex-node');
  if (nodeData) {
    try {
      const node = JSON.parse(nodeData);
      await _chatMessageDropMeldexNode(node, mode, inputId);
    } catch {}
    return;
  }

  // 3. Meldex 内部ビューワー画像（URL に path= が含まれる）
  const raw = dt.getData('text/uri-list') || dt.getData('text/plain') || '';
  const internalMatch = raw.match(/\/(?:api\/)?file-raw\?[^\s]*?path=([^&\s]+)/);
  if (internalMatch) {
    const path = decodeURIComponent(internalMatch[1]);
    const name = path.split('/').pop() || 'image';
    if (_chatIsImagePath(path)) {
      _chatMessageDropAddImageByPath(name, path, mode);
    } else {
      _chatMessageDropInsertLink(inputId, _chatMessageDropLinkMarkup(name, path));
    }
    return;
  }

  // 4. 外部ブラウザの画像 URL（https://...）
  if (/^https?:\/\//i.test(raw)) {
    try {
      const resp = await fetch(raw, { mode: 'cors' });
      if (!resp.ok) throw new Error('fetch failed');
      const blob = await resp.blob();
      if (!blob.type?.startsWith('image/') && !_chatIsImagePath(raw.split('?')[0])) {
        _chatMessageDropInsertLink(inputId, raw);
        return;
      }
      const parsedUrl = new URL(raw);
      const rawName = (parsedUrl.pathname.split('/').pop() || 'image.png') || 'image.png';
      const name = decodeURIComponent(rawName);
      const file = new File([blob], name, { type: blob.type || 'image/png' });
      await _chatMessageDropFile(file, mode, inputId);
    } catch (err) {
      _chatMessageDropInsertLink(inputId, raw);
    }
    return;
  }

  // 5. ツリーパス（フォルダツリー以外の内部ドラッグ）
  const treePath = dt.getData('text/x-tree-path');
  if (treePath) {
    _chatMessageDropInsertLink(inputId, _chatMessageDropLinkMarkup('', treePath));
    return;
  }

  // 6. フォールバック: 任意テキスト
  if (raw) {
    _chatMessageDropInsertLink(inputId, raw);
  }
}

async function _chatMessageDropFile(file, mode, inputId) {
  if (file?.size > 32 * 1024 * 1024) {
    if (typeof showStatus === 'function') showStatus('添付ファイルは32MB以下にしてください', true);
    return;
  }
  if (file.type?.startsWith('image/') || file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) {
    if (mode === 'team') {
      if (typeof _teamUploadAttachment === 'function') await _teamUploadAttachment(file);
    } else {
      if (typeof _chatUploadAttachment === 'function') await _chatUploadAttachment(file);
    }
    return;
  }
  // 非画像: アップロードして入力欄に名前表示のリンクを挿入
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('read error'));
      r.readAsDataURL(file);
    });
    const uploadDir = _chatMessageDropUploadDir(mode);
    const res = await apiFetch('/upload-file?path=' + encodeURIComponent(uploadDir), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: dataUrl, filename: file.name }),
    });
    const uploadedPath = res.path || file.name;
    const markup = _chatMessageDropLinkMarkup(file.name, uploadedPath);
    _chatMessageDropInsertLink(inputId, markup);
    if (typeof _chatTrackDraftUpload === 'function') _chatTrackDraftUpload(inputId, markup, uploadedPath);
  } catch (err) {
    if (typeof showStatus === 'function') showStatus('ファイルのアップロードに失敗しました', true);
  }
}

async function _chatMessageDropMeldexNode(node, mode, inputId) {
  const items = Array.isArray(node?.items) && node.items.length ? node.items : [node];
  const linkTexts = [];
  for (const item of items) {
    const name = String(item?.name || '').trim();
    const path = String(item?.path || '').trim();
    const type = String(item?.type || '').trim();
    if (!path) continue;
    const isImage = type === 'image' || (typeof _chatIsImagePath === 'function' && _chatIsImagePath(path));
    if (isImage) {
      _chatMessageDropAddImageByPath(name || _chatMessageDropNameFromPath(path, 'image'), path, mode);
    } else {
      linkTexts.push(_chatMessageDropLinkMarkup(name, path));
    }
  }
  if (linkTexts.length) _chatMessageDropInsertLink(inputId, linkTexts.join('\n'));
}

function _chatMessageDropNameFromPath(path, fallback = 'リンク') {
  const clean = String(path || '').replace(/[?#].*$/, '').replace(/[\\/]+$/, '');
  const parts = clean.split(/[\\/]/).filter(Boolean);
  return parts.pop() || String(path || '').trim() || fallback;
}

function _chatMessageDropEscapeMarkdownLabel(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

function _chatMessageDropMarkdownLinkMarkup(label, target) {
  const safeLabel = _chatMessageDropEscapeMarkdownLabel(label);
  const safeTarget = String(target || '').replace(/\\/g, '\\\\').replace(/\)/g, '\\)');
  return '[' + safeLabel + '](' + safeTarget + ')';
}

function _chatMessageDropLinkMarkup(name, pathOrUrl) {
  const target = String(pathOrUrl || '').trim();
  if (!target) return '';
  const label = String(name || '').trim() || _chatMessageDropNameFromPath(target, target);
  if (/^https?:\/\//i.test(target)) {
    return _chatMessageDropMarkdownLinkMarkup(label, target);
  }
  if (/[|\]]/.test(target)) return _chatMessageDropMarkdownLinkMarkup(label, target);
  return '[[' + target + '|' + String(label).replace(/\]/g, ')') + ']]';
}

function _chatMessageDropAddImageByPath(name, path, mode) {
  const att = {
    name: name || path.split('/').pop() || 'image',
    path,
    mime: (typeof _chatGuessMimeType === 'function') ? _chatGuessMimeType(path) : 'image/png',
    dataUrl: (typeof API_BASE === 'string' ? API_BASE : '') + '/file-raw?path=' + encodeURIComponent(path),
  };
  if (mode === 'team') {
    _teamPendingAttachments = _teamPendingAttachments || [];
    _teamPendingAttachments.push(att);
    if (typeof _renderTeamAttachments === 'function') _renderTeamAttachments();
  } else {
    _chatState.pendingAttachments = _chatState.pendingAttachments || [];
    _chatState.pendingAttachments.push(att);
    if (typeof _renderChatAttachments === 'function') _renderChatAttachments();
  }
}

function _chatMessageDropInsertLink(inputId, text) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const insert = String(text || '');
  if (!insert) return;
  if (inputId === 'chat-input' && window.GBChatFormatting?.insertText?.(insert)) return;
  const hasFocusedSelection = document.activeElement === input
    && Number.isFinite(input.selectionStart)
    && Number.isFinite(input.selectionEnd);
  const pos = hasFocusedSelection ? input.selectionStart : input.value.length;
  const end = hasFocusedSelection ? input.selectionEnd : input.value.length;
  if (typeof input.setRangeText === 'function') {
    input.setRangeText(insert, pos, end, 'end');
  } else {
    input.value = input.value.substring(0, pos) + insert + input.value.substring(end);
    input.selectionStart = input.selectionEnd = pos + insert.length;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  if (inputId === 'chat-input' && window.GBChatFormatting?.syncInput) window.GBChatFormatting.syncInput();
  if (inputId === 'chat-input' && window.GBChatFormatting?.focusInput?.()) return;
  input.focus();
}

function _chatMessageDropUploadDir(mode) {
  if (mode === 'team') {
    return typeof _teamChatUploadDir === 'function' ? _teamChatUploadDir() : '_chat';
  }
  const chatPath = state.currentPagePath || state.currentEntityPath || '';
  return chatPath ? chatPath.replace(/\/[^/]+$/, '') : '';
}

// LLM / チーム・DM 両方にバインド
_chatMessageDropBind('chat-input', 'chat-messages', 'llm');
_chatMessageDropBind('team-input', 'team-messages', 'team');

function _chatPostFileLink(name, pathOrUrl, isImage) {
  const persistPath = _chatNormalizeStoredPath(pathOrUrl.startsWith('blob:') ? name : pathOrUrl);
  const treatAsImage = !!isImage || _chatIsImagePath(persistPath || name);
  const content = treatAsImage
    ? _chatBuildImageContent(name, persistPath || pathOrUrl)
    : `[[${persistPath || name}]]`;
  const timestamp = _chatLocalTimestamp();
  const message = { role: 'user', content, timestamp };
  _ensureChatMessageId(message);
  chatAddMessage('user', content, { messageIndex: _chatState.messages.length, msg_id: message.msg_id, timestamp });
  _chatState.messages.push(message);
}

// （チャット・カレンダーボタンはHTML直書きに移行済み）

// ============================
// チャット名ドロップダウン（過去チャットの選択）
// ============================
let _chatTitleDropdown = null;
async function showChatHistoryDropdown(event) {
  if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
  if (_chatTitleDropdown) { _closeChatTitleDropdown(); return; }
  const combo = document.getElementById('chat-title-combo');
  const input = document.getElementById('chat-session-title');
  if (!combo || !input) return;

  const popup = document.createElement('div');
  popup.id = 'chat-title-dropdown';
  popup.style.cssText = 'position:fixed;z-index:10080;background:var(--ui-popup-bg, var(--bg));color:var(--fg);border:1px solid var(--border);border-radius:4px;box-shadow:0 4px 16px rgba(0,0,0,0.25);min-width:240px;max-width:380px;max-height:320px;overflow-y:auto;font-size:12px;';
  const loading = document.createElement('div');
  loading.style.cssText = 'padding:8px;color:var(--fg2);text-align:center;';
  loading.textContent = '読み込み中...';
  popup.appendChild(loading);

  const comboRect = combo.getBoundingClientRect();
  popup.style.minWidth = (comboRect.width / _getZoom()) + 'px';
  document.body.appendChild(popup);
  positionPopup(popup, comboRect);
  _chatTitleDropdown = popup;

  const onOutside = (e) => {
    if (!popup.contains(e.target) && e.target.id !== 'chat-title-dropdown-btn') _closeChatTitleDropdown();
  };
  const onKey = (e) => { if (e.key === 'Escape') _closeChatTitleDropdown(); };
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
  }, 0);
  popup._cleanup = () => {
    document.removeEventListener('mousedown', onOutside);
    document.removeEventListener('keydown', onKey);
  };

  try {
    if (!_chatSourceFolderValue() && !(typeof _chatWorkspaceIdValue === 'function' && _chatWorkspaceIdValue())) {
      popup.innerHTML = '';
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:8px;color:var(--fg2);text-align:center;';
      empty.textContent = '対象ワークスペースまたはフォルダを選択してください';
      popup.appendChild(empty);
      return;
    }
    const items = await apiFetch(_chatApiPath('/chat/list'));
    popup.innerHTML = '';
    if (!items || items.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:8px;color:var(--fg2);text-align:center;';
      empty.textContent = '過去のチャットはありません';
      popup.appendChild(empty);
      return;
    }
    items.forEach(item => {
      const row = document.createElement('div');
      const isActive = _chatState.sessionId && item.name === _chatState.sessionId;
      row.style.cssText = 'padding:6px 10px;border-bottom:1px solid var(--border);cursor:pointer;' + (isActive ? 'background:var(--bg3);' : '');
      row.addEventListener('mouseover', () => row.style.background = isActive ? 'var(--bg3)' : 'rgba(255,255,255,0.05)');
      row.addEventListener('mouseout', () => row.style.background = isActive ? 'var(--bg3)' : '');
      const title = document.createElement('div');
      title.style.cssText = 'color:' + (isActive ? 'var(--accent)' : 'var(--fg)') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' + (isActive ? 'font-weight:bold;' : '');
      title.textContent = _chatListTitle(item) || item.name;
      row.appendChild(title);
      const targetName = item.targetPath ? item.targetPath.split('/').pop() : '';
      if (item.title && targetName && item.title !== targetName) {
        const sub = document.createElement('div');
        sub.style.cssText = 'font-size:10px;color:var(--fg2);margin-top:2px;';
        sub.textContent = targetName;
        row.appendChild(sub);
      }
      row.addEventListener('click', () => {
        _closeChatTitleDropdown();
        openSavedChat(item.path, '', item.source_folder || item.sourceFolder);
      });
      popup.appendChild(row);
    });
  } catch (e) {
    popup.innerHTML = '';
    const err = document.createElement('div');
    err.style.cssText = 'padding:8px;color:var(--fg2);text-align:center;';
    err.textContent = '履歴を取得できません';
    popup.appendChild(err);
  }
}
window.showChatHistoryDropdown = showChatHistoryDropdown;

function _closeChatTitleDropdown() {
  if (!_chatTitleDropdown) return;
  if (typeof _chatTitleDropdown._cleanup === 'function') _chatTitleDropdown._cleanup();
  _chatTitleDropdown.remove();
  _chatTitleDropdown = null;
}

// ============================
// マルチモーダル: 画像添付
// ============================
let _chatSessionGen = 0;
function _chatBumpSessionGen() { _chatSessionGen++; }
window._chatBumpSessionGen = _chatBumpSessionGen;
let _chatDraftUploadedLinks = [];
let _chatDraftUploadCleanupPaused = 0;

function _chatCleanupUploadedPath(path) {
  const targetPath = String(path || '').trim();
  if (!targetPath || typeof apiPost !== 'function') return;
  apiPost('/outliner/delete', { path: targetPath }, { silentError: true }).catch(() => {});
}

function _chatCleanupUploadedAttachments(items) {
  (Array.isArray(items) ? items : [items]).forEach(item => {
    if (item && typeof item === 'object') item.canceled = true;
    if (item?.uploaded && item.path) _chatCleanupUploadedPath(item.path);
  });
}
window._chatCleanupUploadedAttachments = _chatCleanupUploadedAttachments;

function _chatWithDraftUploadCleanupPaused(fn) {
  _chatDraftUploadCleanupPaused++;
  try {
    return typeof fn === 'function' ? fn() : undefined;
  } finally {
    _chatDraftUploadCleanupPaused = Math.max(0, _chatDraftUploadCleanupPaused - 1);
  }
}
window._chatWithDraftUploadCleanupPaused = _chatWithDraftUploadCleanupPaused;

function _chatBindDraftUploadCleanup(input) {
  if (!input || input.dataset.chatDraftUploadCleanupBound === '1') return;
  input.dataset.chatDraftUploadCleanupBound = '1';
  input.addEventListener('input', () => {
    if (_chatDraftUploadCleanupPaused) return;
    _chatCleanupDraftUploads(input.id);
  });
}

function _chatTrackDraftUpload(inputId, markup, path) {
  const id = String(inputId || '');
  const text = String(markup || '');
  const targetPath = String(path || '').trim();
  if (!id || !text || !targetPath) return;
  const input = document.getElementById(id);
  if (!input) return;
  _chatBindDraftUploadCleanup(input);
  _chatDraftUploadedLinks.push({ inputId: id, markup: text, path: targetPath });
}
window._chatTrackDraftUpload = _chatTrackDraftUpload;

function _chatCleanupDraftUploads(inputId, options = {}) {
  const id = String(inputId || '');
  const input = id ? document.getElementById(id) : null;
  const value = String(input?.value || '');
  const force = !!options.force;
  const keep = [];
  _chatDraftUploadedLinks.forEach(item => {
    if (id && item.inputId !== id) {
      keep.push(item);
      return;
    }
    if (!force && value.includes(item.markup)) {
      keep.push(item);
      return;
    }
    _chatCleanupUploadedPath(item.path);
  });
  _chatDraftUploadedLinks = keep;
}
window._chatCleanupDraftUploads = _chatCleanupDraftUploads;

function _chatCommitDraftUploadsForText(inputId, text) {
  const id = String(inputId || '');
  const sentText = String(text || '');
  _chatDraftUploadedLinks = _chatDraftUploadedLinks.filter(item => {
    if (item.inputId !== id) return true;
    return !sentText.includes(item.markup);
  });
}
window._chatCommitDraftUploadsForText = _chatCommitDraftUploadsForText;

function _teamClearPendingAttachments(options = {}) {
  const items = _teamPendingAttachments || [];
  _teamPendingAttachments = [];
  if (options.cleanupUploads) _chatCleanupUploadedAttachments(items);
  if (typeof _renderTeamAttachments === 'function') _renderTeamAttachments();
}
window._teamClearPendingAttachments = _teamClearPendingAttachments;

function chatAttachmentPick() {
  const fileInput = document.getElementById('chat-attachment-file');
  if (!fileInput) return;
  fileInput.value = '';
  fileInput.onchange = async () => {
    const files = Array.from(fileInput.files || []);
    for (const f of files) {
      await _chatUploadAttachment(f);
    }
    fileInput.value = '';
  };
  fileInput.click();
}
window.chatAttachmentPick = chatAttachmentPick;

function _chatIsAttachmentFile(file) {
  const name = String(file?.name || '');
  const isPdf = file?.type === 'application/pdf' || /\.pdf$/i.test(name);
  return !!file && (
    file.type?.startsWith('image/') ||
    /\.(?:png|jpe?g|gif|webp|bmp|svg)$/i.test(name) ||
    isPdf
  );
}

function _chatAttachmentFileName(file) {
  const raw = String(file?.name || '').trim();
  if (raw) return raw;
  if (file?.type === 'application/pdf') return 'clipboard-file.pdf';
  const subtype = String(file?.type || '').split('/')[1] || 'png';
  const ext = subtype === 'jpeg' ? 'jpg' : subtype.replace(/[^a-z0-9]/gi, '') || 'png';
  return 'clipboard-image.' + ext;
}

function _chatAttachmentUploadDir() {
  const chatPath = state.currentPagePath || state.currentEntityPath || '';
  return chatPath ? chatPath.replace(/\/[^/]+$/, '') : '';
}

function _chatStartAttachmentUpload(att, gen) {
  const uploadDir = _chatAttachmentUploadDir();
  att.uploadPromise = apiFetch('/upload-file?path=' + encodeURIComponent(uploadDir), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: att.dataUrl, filename: att.name }),
  }).then(res => {
    const uploadedPath = res.path || att.name;
    if (gen !== _chatSessionGen || att.canceled) {
      if (uploadedPath) _chatCleanupUploadedPath(uploadedPath);
      return false;
    }
    att.path = uploadedPath;
    att.uploaded = true;
    att.uploading = false;
    att.uploadError = '';
    _renderChatAttachments();
    return true;
  }).catch(error => {
    if (gen !== _chatSessionGen || att.canceled) return false;
    att.uploading = false;
    att.uploadError = error?.message || 'upload failed';
    _renderChatAttachments();
    if (typeof showStatus === 'function') showStatus('添付ファイルのアップロードに失敗しました', true);
    return false;
  });
  return att.uploadPromise;
}

async function _chatUploadAttachment(file) {
  const isPdf = file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name || '');
  if (!_chatIsAttachmentFile(file)) {
    if (typeof showStatus === 'function') showStatus('画像またはPDFファイルのみ添付できます', true);
    return false;
  }
  if (file.size > 32 * 1024 * 1024) {
    if (typeof showStatus === 'function') showStatus('添付ファイルは32MB以下にしてください', true);
    return false;
  }
  const gen = _chatSessionGen;
  const fileName = _chatAttachmentFileName(file);
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('read error'));
      r.readAsDataURL(file);
    });
    if (gen !== _chatSessionGen) return false;
    _chatState.pendingAttachments = _chatState.pendingAttachments || [];
    const att = {
      id: 'att_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      name: fileName,
      path: '',
      mime: isPdf ? 'application/pdf' : (file.type || 'image/png'),
      dataUrl,
      uploaded: false,
      uploading: true,
      uploadError: '',
    };
    _chatState.pendingAttachments.push(att);
    _renderChatAttachments();
    _chatStartAttachmentUpload(att, gen);
    return att;
  } catch (e) {
    if (gen !== _chatSessionGen) return false;
    if (typeof showStatus === 'function') showStatus('添付ファイルのアップロードに失敗しました', true);
    return false;
  }
}

async function _chatWaitForPendingAttachmentUploads(attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  const pending = list.filter(att => att?.uploading && att.uploadPromise);
  if (pending.length && typeof showStatus === 'function') showStatus('添付ファイルのアップロード完了を待っています...');
  for (const att of pending) {
    try { await att.uploadPromise; } catch {}
  }
  const failed = list.filter(att => att?.uploadError || att?.uploading || !String(att?.path || '').trim());
  if (failed.length) {
    if (typeof showStatus === 'function') showStatus('アップロード未完了の添付があります。削除して貼り直してください。', true);
    _renderChatAttachments();
    return null;
  }
  return list;
}
window._chatWaitForPendingAttachmentUploads = _chatWaitForPendingAttachmentUploads;

function _renderChatAttachments() {
  const bar = document.getElementById('chat-attachments-bar');
  if (!bar) return;
  const list = _chatState.pendingAttachments || [];
  bar.innerHTML = '';
  if (list.length === 0) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';
  list.forEach((att, idx) => {
    const chip = document.createElement('div');
    const hasError = !!att.uploadError;
    chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:2px 6px;background:var(--bg);border:1px solid ' + (hasError ? 'var(--danger, #d9534f)' : 'var(--border)') + ';border-radius:3px;max-width:100%;';
    const isPdf = String(att.mime || '').toLowerCase() === 'application/pdf' || /\.pdf$/i.test(att.name || att.path || '');
    const thumb = document.createElement(isPdf ? 'span' : 'img');
    if (isPdf) {
      thumb.innerHTML = typeof lucide === 'function' ? lucide('fileText', 18) : 'PDF';
      thumb.style.cssText = 'width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;color:var(--fg2);flex-shrink:0;';
    } else {
      thumb.src = att.dataUrl;
      thumb.alt = att.name;
      thumb.style.cssText = 'width:24px;height:24px;object-fit:cover;border-radius:2px;flex-shrink:0;';
    }
    const label = document.createElement('span');
    const suffix = att.uploading ? '（アップロード中）' : (hasError ? '（失敗）' : '');
    label.textContent = att.name + suffix;
    label.title = att.name + suffix;
    label.style.cssText = 'max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    const close = document.createElement('button');
    close.textContent = '×';
    close.title = '削除';
    close.style.cssText = 'background:transparent;color:var(--fg2);border:none;cursor:pointer;padding:0 4px;font-size:14px;line-height:1;';
    close.addEventListener('click', () => {
      const removed = _chatState.pendingAttachments.splice(idx, 1);
      _chatCleanupUploadedAttachments(removed);
      _renderChatAttachments();
    });
    chip.appendChild(thumb);
    chip.appendChild(label);
    chip.appendChild(close);
    bar.appendChild(chip);
  });
}
window._renderChatAttachments = _renderChatAttachments;

function _chatClearPendingAttachments(options = {}) {
  const items = _chatState.pendingAttachments || [];
  _chatState.pendingAttachments = [];
  if (options.cleanupUploads) _chatCleanupUploadedAttachments(items);
  _renderChatAttachments();
}
window._chatClearPendingAttachments = _chatClearPendingAttachments;
