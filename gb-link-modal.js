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

  function _inferTypeFromPath(path) {
    const lower = String(path || '').toLowerCase();
    if (lower.endsWith('.scriptnote.json')) return 'scriptnote';
    if (lower.endsWith('.smart.json')) return 'smart-db';
    if (lower.endsWith('.dashboard.json')) return 'dashboard';
    if (lower.endsWith('.board.json') || lower.endsWith('.canvas.json')) return 'board';
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
    if (!path) return;

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

  function show(savedRange, callback) {
    if (_overlay) close();
    _savedRange = savedRange;
    _callback = callback || null;

    _overlay = document.createElement('div');
    _overlay.className = 'link-modal-overlay';
    _overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:flex-start;justify-content:center;padding-top:6vh;background:rgba(0,0,0,.4);';
    _overlay.addEventListener('mousedown', (e) => { if (e.target === _overlay) close(); });

    const modal = document.createElement('div');
    modal.className = 'link-modal';
    // 縦長ダイアログ: 幅を絞り高さを大きく
    modal.style.cssText = 'background:var(--bg2);border:1px solid var(--border);border-radius:8px;width:min(400px,90vw);height:min(85vh,820px);display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,.3);overflow:hidden;';

    // タイトル
    const header = document.createElement('div');
    header.style.cssText = 'padding:12px 16px 8px;font-size:13px;font-weight:600;color:var(--fg);flex-shrink:0;';
    header.textContent = 'リンクを挿入';
    modal.appendChild(header);

    // フォルダツリー（既存 #sidebar を埋め込み）
    const treeWrap = document.createElement('div');
    treeWrap.className = 'link-modal-tree';
    treeWrap.style.cssText = 'flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;border-top:1px solid var(--border);border-bottom:1px solid var(--border);';
    modal.appendChild(treeWrap);

    // URL入力欄
    const urlWrap = document.createElement('div');
    urlWrap.style.cssText = 'padding:8px 16px;display:flex;gap:8px;align-items:center;flex-shrink:0;';
    const urlLabel = document.createElement('span');
    urlLabel.textContent = 'URL:';
    urlLabel.style.cssText = 'font-size:12px;color:var(--fg2);white-space:nowrap;';
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.placeholder = 'https://...';
    urlInput.style.cssText = 'flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--fg);font-size:13px;outline:none;box-sizing:border-box;';
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (urlInput.value.trim()) insertUrlLink(urlInput.value.trim()); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    urlWrap.appendChild(urlLabel);
    urlWrap.appendChild(urlInput);
    modal.appendChild(urlWrap);

    // ボタン
    const btnWrap = document.createElement('div');
    btnWrap.style.cssText = 'padding:8px 16px 12px;display:flex;justify-content:flex-end;gap:8px;flex-shrink:0;';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'キャンセル';
    cancelBtn.style.cssText = 'padding:4px 16px;border:1px solid var(--border);border-radius:4px;background:var(--bg3);color:var(--fg);cursor:pointer;font-size:12px;';
    cancelBtn.addEventListener('click', close);
    const insertUrlBtn = document.createElement('button');
    insertUrlBtn.textContent = 'URLを挿入';
    insertUrlBtn.style.cssText = 'padding:4px 16px;border:none;border-radius:4px;background:var(--accent);color:var(--ui-fg-strong);cursor:pointer;font-size:12px;';
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

  function close() {
    // サイドバーを元の位置に戻してからオーバーレイを除去
    _restoreSidebar();
    if (_overlay) {
      _overlay.remove();
      _overlay = null;
    }
    delete document.body.dataset.linkModalOpen;
    _savedRange = null;
    _callback = null;
  }

  return { show, close };
})();

function showLinkInsertModal(savedRange, callback) {
  MeldexLinkModal.show(savedRange, callback);
}
