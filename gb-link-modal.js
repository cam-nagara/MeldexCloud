/* gb-link-modal.js — リンク挿入モーダル
 * Ctrl+K / コンテキストメニュー「リンクを挿入...」で表示される
 * フォルダツリー (既存の #sidebar を一時的にモーダル内に埋め込み) + 外部URL入力のUI
 */
const MeldexLinkModal = (() => {
  let _overlay = null;
  let _savedRange = null;
  let _callback = null;
  // サイドバーを一時的にモーダルへ移動するため、元の親 / 次兄弟 / display を記録
  let _sidebarOrigParent = null;
  let _sidebarOrigNextSibling = null;
  let _sidebarOrigDisplay = null;
  let _sidebarClickHandler = null;
  let _focusReturnTarget = null;

  function _inferTypeFromPath(path) {
    const lower = String(path || '').toLowerCase();
    if (lower.endsWith('.mel-scenario') || lower.endsWith('.scriptnote.json')) return 'scriptnote';
    if (lower.endsWith('.mel-sheet') || lower.endsWith('.smart-db.json') || lower.endsWith('.smart.json')) return 'smart-db';
    if (lower.endsWith('.mel-timer') || lower.endsWith('.timer.json')) return 'timer';
    if (lower.endsWith('.mel-board') || lower.endsWith('.board.json') || lower.endsWith('.canvas.json')) return 'board';
    if (/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(lower)) return 'image';
    if (/\.(mp4|webm|mov|mkv)$/.test(lower)) return 'video';
    if (/\.(mp3|wav|ogg|m4a|flac)$/.test(lower)) return 'audio';
    if (/\.pdf$/.test(lower)) return 'pdf';
    if (/\.html?$/.test(lower)) return 'html';
    if (/\.csv$/.test(lower)) return 'csv';
    return 'page';
  }

  function _onSidebarClickCapture(e) {
    // サイドバー内のファイル行クリックを捕捉してリンク挿入に流す。
    // フォルダ / データベース行や、展開トグル / ホバーボタン / セクションヘッダー
    // / 検索入力欄などは除外し、通常動作 (展開・メニュー・セクション折りたたみ) を維持する。
    if (e.target?.closest?.(
      '.tree-toggle, .tree-hover-btn, .tree-hover-btns, ' +
      '.sidebar-section-btn, .sidebar-section-header, .sidebar-section-toggle, ' +
      'input, select, textarea, button'
    )) return;

    const row = e.target?.closest?.('.tree-node-row, .fav-item, .sidebar-item');
    if (!row) return;

    // createTreeNodeFromBrowse は親 `.tree-node` に `_nodeData = item` を保持している。
    // item.type で folder / database を直接判定できる。
    const nodeEl = row.closest('.tree-node');
    const data = nodeEl?._nodeData || null;
    let path = '';
    let type = '';
    let name = '';
    if (data) {
      if (data.type === 'folder' || data.type === 'database') return; // 展開・ナビは通常動作
      path = data.path || '';
      type = data.type || '';
      name = data.name || '';
    } else {
      // fav-item / sidebar-item など _nodeData を持たない行: data-path + 拡張子から推定
      const pathHost = row.closest('[data-path]') || (row.dataset?.path ? row : null);
      path = pathHost?.dataset?.path || '';
      name = path.split('/').pop() || path;
      type = _inferTypeFromPath(path);
    }
    if (!path) {
      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();
      if (typeof showStatus === 'function') showStatus('リンクにできるファイルを選択してください', true);
      return;
    }

    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();

    insertFileLink({ name, path, type: type || _inferTypeFromPath(path) });
  }

  function _moveSidebarInto(container) {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return false;
    _sidebarOrigParent = sidebar.parentNode;
    _sidebarOrigNextSibling = sidebar.nextSibling;
    _sidebarOrigDisplay = sidebar.style.display;
    // モーダル内で表示し、モーダル高さに追従するようスタイルを一時変更
    sidebar.style.display = 'flex';
    sidebar.dataset.linkModalHost = '1';
    container.appendChild(sidebar);
    // クリック捕捉リスナー (キャプチャ位相) を付与
    _sidebarClickHandler = _onSidebarClickCapture;
    sidebar.addEventListener('click', _sidebarClickHandler, true);
    return true;
  }

  function _restoreSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || !_sidebarOrigParent) return;
    if (_sidebarClickHandler) {
      sidebar.removeEventListener('click', _sidebarClickHandler, true);
      _sidebarClickHandler = null;
    }
    // 元の位置に戻す
    if (_sidebarOrigNextSibling && _sidebarOrigNextSibling.parentNode === _sidebarOrigParent) {
      _sidebarOrigParent.insertBefore(sidebar, _sidebarOrigNextSibling);
    } else {
      _sidebarOrigParent.appendChild(sidebar);
    }
    sidebar.style.display = _sidebarOrigDisplay ?? '';
    delete sidebar.dataset.linkModalHost;
    _sidebarOrigParent = null;
    _sidebarOrigNextSibling = null;
    _sidebarOrigDisplay = null;
  }

  // 工程11: リンク挿入モーダル「このノートの見出し」セクション用ヘルパー。
  // savedRange の位置から、現在編集中のノート（またはエントリ自由記述等の
  // 同種contenteditableホスト）を特定する。ノート本体に限らず、見出し
  // (h1〜h6) を含む contenteditable ホストであれば汎用的に対応する。
  function _resolveHeadingHost(range) {
    if (!range) return null;
    const node = range.commonAncestorContainer || range.startContainer;
    if (!node) return null;
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || typeof el.closest !== 'function') return null;
    return el.closest('[contenteditable="true"]');
  }

  // host内の見出し(h1〜h6)を文書順に列挙し、階層（祖先見出しの経路）と
  // 同名見出しの重複件数を付与する。同名見出しの区別（項目2）に使う。
  function _collectHeadingCandidates(host) {
    const headings = Array.from(host.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    const stack = [];
    const list = headings.map((el, index) => {
      const level = Number(el.tagName.slice(1));
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const ancestorPath = stack.map(item => item.text);
      const rawText = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const text = rawText || '(無題の見出し)';
      stack.push({ level, text });
      return { el, level, text, index, ancestorPath };
    });
    const totalByText = new Map();
    list.forEach(item => totalByText.set(item.text, (totalByText.get(item.text) || 0) + 1));
    list.forEach(item => { item.duplicateCount = totalByText.get(item.text) || 1; });
    return list;
  }

  // 見出し直後の最初の非見出しブロックから短い抜粋を作る（周辺情報での区別用）。
  function _headingSurroundingSnippet(el) {
    let node = el?.nextElementSibling;
    let guard = 0;
    while (node && guard < 6) {
      guard++;
      if (/^H[1-6]$/.test(node.tagName)) break; // 次の見出しに到達したら打ち切り
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) return text.length > 24 ? text.slice(0, 24) + '…' : text;
      node = node.nextElementSibling;
    }
    return '';
  }

  // 同名見出しがある場合だけ、階層（祖先見出し）+ 周辺本文の抜粋を返す。
  function _headingDisambiguationText(candidate) {
    if (!candidate || candidate.duplicateCount <= 1) return '';
    const parts = [];
    if (candidate.ancestorPath.length) parts.push(candidate.ancestorPath.join(' > '));
    const snippet = _headingSurroundingSnippet(candidate.el);
    if (snippet) parts.push(snippet);
    if (!parts.length) parts.push('同名の見出しが複数あります');
    return parts.join(' ・ ');
  }

  function show(savedRange, callback) {
    if (_overlay) close();
    _savedRange = savedRange;
    _callback = callback || null;
    _focusReturnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    _overlay = document.createElement('div');
    _overlay.className = 'link-modal-overlay';
    _overlay.dataset.e2eId = 'link-insert-modal-overlay';
    _overlay.addEventListener('mousedown', (e) => { if (e.target === _overlay) close(); });
    _overlay.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close();
    });

    const modal = document.createElement('div');
    modal.className = 'link-modal';
    modal.dataset.e2eId = 'link-insert-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'link-insert-modal-title');
    modal.tabIndex = -1;

    // タイトル
    const header = document.createElement('div');
    header.className = 'gb-modal-shell-header link-modal-header';
    header.dataset.e2eId = 'link-insert-modal-header';
    const title = document.createElement('div');
    title.id = 'link-insert-modal-title';
    title.className = 'gb-modal-title';
    title.textContent = 'リンクを挿入';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'gb-modal-close link-modal-close';
    closeBtn.dataset.e2eId = 'link-insert-modal-close';
    closeBtn.setAttribute('aria-label', '閉じる');
    closeBtn.title = '閉じる';
    closeBtn.innerHTML = typeof lucide === 'function' ? lucide('x', 16) : '<span class="ico ico-x" aria-hidden="true"></span>';
    closeBtn.addEventListener('click', close);
    header.append(title, closeBtn);
    modal.appendChild(header);

    const body = document.createElement('div');
    body.className = 'gb-modal-shell-body link-modal-body';
    body.dataset.e2eId = 'link-insert-modal-body';
    modal.appendChild(body);

    // フォルダツリー（既存 #sidebar を埋め込み）
    const treeWrap = document.createElement('div');
    treeWrap.className = 'link-modal-tree';
    treeWrap.dataset.e2eId = 'link-insert-modal-tree';
    body.appendChild(treeWrap);

    // このノートの見出し（工程11: 見出しリンク作成導線）。
    // savedRange が実際に見出しを持つ編集ホスト内にある時だけ表示する。
    // board/canvas 等（savedRange なしでコールバック経由の呼び出し）や
    // 見出しの無いノートでは、空セクションを出さずそのまま省略する。
    const headingHost = _resolveHeadingHost(savedRange);
    const headingCandidates = headingHost ? _collectHeadingCandidates(headingHost) : [];
    if (headingCandidates.length > 0) {
      const headingsWrap = document.createElement('div');
      headingsWrap.className = 'link-modal-headings';
      headingsWrap.dataset.e2eId = 'link-insert-modal-headings';
      const headingsLabel = document.createElement('div');
      headingsLabel.className = 'link-modal-headings-label';
      headingsLabel.textContent = 'このノートの見出し';
      headingsWrap.appendChild(headingsLabel);
      headingCandidates.forEach(candidate => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'link-modal-heading-item';
        item.dataset.e2eId = 'link-insert-modal-heading-item';
        item.dataset.headingIndex = String(candidate.index);
        item.style.paddingLeft = (10 + (candidate.level - 1) * 12) + 'px';
        const levelBadge = document.createElement('span');
        levelBadge.className = 'link-modal-heading-level';
        levelBadge.textContent = 'H' + candidate.level;
        const textSpan = document.createElement('span');
        textSpan.className = 'link-modal-heading-text';
        textSpan.textContent = candidate.text;
        item.append(levelBadge, textSpan);
        const extra = _headingDisambiguationText(candidate);
        if (extra) {
          const extraSpan = document.createElement('span');
          extraSpan.className = 'link-modal-heading-extra';
          extraSpan.textContent = extra;
          item.appendChild(extraSpan);
          item.title = `${candidate.text}（${extra}）`;
        } else {
          item.title = candidate.text;
        }
        item.addEventListener('click', () => insertHeadingLink(candidate));
        headingsWrap.appendChild(item);
      });
      body.appendChild(headingsWrap);
    }

    // URL入力欄
    const urlWrap = document.createElement('div');
    urlWrap.className = 'link-modal-url-row';
    urlWrap.dataset.e2eId = 'link-insert-modal-url-row';
    const urlLabel = document.createElement('label');
    urlLabel.className = 'link-modal-url-label';
    urlLabel.htmlFor = 'link-insert-modal-url';
    urlLabel.textContent = 'URL:';
    const urlInput = document.createElement('input');
    urlInput.id = 'link-insert-modal-url';
    urlInput.className = 'gb-input link-modal-url-input';
    urlInput.dataset.e2eId = 'link-insert-modal-url-input';
    urlInput.type = 'text';
    urlInput.placeholder = 'https://...';
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (urlInput.value.trim()) insertUrlLink(urlInput.value.trim()); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    urlWrap.appendChild(urlLabel);
    urlWrap.appendChild(urlInput);
    body.appendChild(urlWrap);

    // ボタン
    const btnWrap = document.createElement('div');
    btnWrap.className = 'gb-modal-shell-footer link-modal-actions';
    btnWrap.dataset.e2eId = 'link-insert-modal-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'gb-btn gb-btn-sm link-modal-cancel';
    cancelBtn.dataset.e2eId = 'link-insert-modal-cancel';
    cancelBtn.textContent = 'キャンセル';
    cancelBtn.addEventListener('click', close);
    const insertUrlBtn = document.createElement('button');
    insertUrlBtn.type = 'button';
    insertUrlBtn.className = 'gb-btn gb-btn-sm gb-btn-primary link-modal-insert-url';
    insertUrlBtn.dataset.e2eId = 'link-insert-modal-insert-url';
    insertUrlBtn.textContent = 'URLを挿入';
    insertUrlBtn.addEventListener('click', () => {
      if (urlInput.value.trim()) insertUrlLink(urlInput.value.trim());
    });
    btnWrap.appendChild(cancelBtn);
    btnWrap.appendChild(insertUrlBtn);
    modal.appendChild(btnWrap);

    _overlay.appendChild(modal);
    document.body.appendChild(_overlay);

    // 既存サイドバーをモーダル内に移動
    _moveSidebarInto(treeWrap);
    document.body.dataset.linkModalOpen = '1';
    window.GBModalShell?.enhanceOverlay?.(_overlay);
    setTimeout(() => {
      try { urlInput.focus({ preventScroll: true }); } catch (_) { urlInput.focus(); }
    }, 0);
  }

  function _normalizeSafeUrl(rawUrl) {
    const raw = String(rawUrl || '').trim();
    if (!raw) return null;
    let candidate = raw;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
      if (!/^[^\s/@]+\.[^\s/]{2,}([/?#].*)?$/i.test(candidate)) return null;
      candidate = 'https://' + candidate;
    }
    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) return null;
      return candidate;
    } catch {
      return null;
    }
  }

  function _urlLabel(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'mailto:' || parsed.protocol === 'tel:') return url;
      return parsed.hostname + parsed.pathname + parsed.search + parsed.hash;
    } catch {
      return url;
    }
  }

  function _createUrlLinkHtml(url, label) {
    const text = label || _urlLabel(url);
    return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent2);">${esc(text)}</a> `;
  }

  function insertFileLink(item) {
    if (_callback) {
      _callback({ type: 'file', name: item.name, path: item.path, fileType: item.type });
      close();
      return;
    }
    if (_savedRange) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(_savedRange);
    }
    const selectedText = window.getSelection()?.toString() || item.name;
    const html = MeldexDnD.createAutoLinkHtml(selectedText, item.path, item.type);
    document.execCommand('insertHTML', false, html);
    close();
  }

  // 工程11: 見出しを選択した時の同一ノート内リンク挿入。
  // アンカーIDは getOrAssignStableHeadingAnchorId（gb-editor側）で確保する
  // 既存の安定IDを使う。テキストスラグには依存しないため、見出し名変更・
  // 重複見出しの増減・保存/再読込があってもリンク先を見失わない。
  function insertHeadingLink(candidate) {
    const headingEl = candidate?.el;
    if (!headingEl) return;
    const anchorId = typeof getOrAssignStableHeadingAnchorId === 'function'
      ? getOrAssignStableHeadingAnchorId(headingEl)
      : (headingEl.dataset?.noteHeadingId || headingEl.id || '');
    if (!anchorId) {
      if (typeof showStatus === 'function') showStatus('見出しへのリンクを作成できませんでした', true);
      return;
    }
    const label = candidate.text || headingEl.textContent || '';
    if (_callback) {
      _callback({ type: 'heading', anchorId, label });
      close();
      return;
    }
    if (_savedRange) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(_savedRange);
    }
    const selectedText = window.getSelection()?.toString() || label;
    const html = `<a href="#${esc(anchorId)}" class="note-anchor-link" data-note-anchor="${esc(anchorId)}" data-e2e-id="note-anchor-link" style="color:var(--accent);text-decoration:underline;cursor:pointer;">${esc(selectedText)}</a> `;
    document.execCommand('insertHTML', false, html);
    close();
  }

  function insertUrlLink(url) {
    const safeUrl = _normalizeSafeUrl(url);
    if (!safeUrl) {
      showStatus('安全なURLを入力してください', true);
      return;
    }
    if (_callback) {
      _callback({ type: 'url', url: safeUrl });
      close();
      return;
    }
    if (_savedRange) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(_savedRange);
    }
    const selectedText = window.getSelection()?.toString() || _urlLabel(safeUrl);
    document.execCommand('insertHTML', false, _createUrlLinkHtml(safeUrl, selectedText));
    close();
  }

  function _restoreFocusTarget(target) {
    if (!target?.isConnected || typeof target.focus !== 'function') return;
    try { target.focus({ preventScroll: true }); } catch (_) { target.focus(); }
  }

  function close() {
    // サイドバーを元の位置に戻してからオーバーレイを除去
    const focusTarget = _focusReturnTarget;
    _restoreSidebar();
    if (_overlay) {
      _overlay.remove();
      _overlay = null;
    }
    delete document.body.dataset.linkModalOpen;
    _savedRange = null;
    _callback = null;
    _restoreFocusTarget(focusTarget);
    requestAnimationFrame(() => _restoreFocusTarget(focusTarget));
    setTimeout(() => _restoreFocusTarget(focusTarget), 260);
    _focusReturnTarget = null;
  }

  return { show, close };
})();

function showLinkInsertModal(savedRange, callback) {
  MeldexLinkModal.show(savedRange, callback);
}
