    el.addEventListener('dragend', () => { el.classList.remove('dragging'); _clearTabDragIndicators(); });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      _clearTabDragIndicators();
      const rect = el.getBoundingClientRect();
      if (e.clientX < rect.left + rect.width / 2) el.classList.add('drag-over-left');
      else el.classList.add('drag-over-right');
    });
    el.addEventListener('dragleave', () => { el.classList.remove('drag-over-left', 'drag-over-right'); });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      _clearTabDragIndicators();
      const fromIdx = parseInt(e.dataTransfer.getData('application/x-tab-idx'));
      if (isNaN(fromIdx) || fromIdx === i) return;
      const rect = el.getBoundingClientRect();
      const insertBefore = e.clientX < rect.left + rect.width / 2;
      const moved = _tabs.splice(fromIdx, 1)[0];
      let toIdx = insertBefore ? i : i + 1;
      if (fromIdx < i) toIdx--;
      _tabs.splice(toIdx, 0, moved);
      renderTabs();
    });

    bar.appendChild(el);
  });
}

function _clearTabDragIndicators() {
  document.querySelectorAll('.tab-item.drag-over-left,.tab-item.drag-over-right').forEach(el => {
    el.classList.remove('drag-over-left', 'drag-over-right');
  });
}

// Meldex内部タブとして開く
function _normalizeOpenTypeForNav(type) {
  if (type === 'database') return 'pivot';
  if (type === 'scenario') return 'scriptnote';
  return type || 'page';
}

function _openInNewTab(label, path, type) {
  const openType = _normalizeOpenTypeForNav(type);
  const id = 'tab-' + (++_tabIdCounter);
  _tabs.push({ id, label: label || '(無題)', type: openType, path: path || '', icon: _tabIcon(openType) });
  _activeTabId = id;
  renderTabs();
  // コンテンツを開く
  _addingTab = true;
  try {
    return navOpen({ type: openType, label, path });
  } finally {
    _addingTab = false;
  }
}

// タブバーへのフォルダツリーD&Dドロップ
(function() {
  const bar = document.getElementById('tab-bar');
  if (!bar) return;
  bar.addEventListener('dragover', (e) => {
    // Meldexノードまたはタブ移動のみ受け入れ
    e.preventDefault();
    e.dataTransfer.dropEffect = 'link';
    // ドロップ位置のインジケーター表示
    _clearTabDragIndicators();
    const tabEls = [...bar.querySelectorAll('.tab-item')];
    for (const tabEl of tabEls) {
      const rect = tabEl.getBoundingClientRect();
      if (e.clientX < rect.left + rect.width / 2) {
        tabEl.classList.add('drag-over-left');
        return;
      } else if (e.clientX < rect.right) {
        tabEl.classList.add('drag-over-right');
        return;
      }
    }
    // 全タブの右側
    if (tabEls.length > 0) tabEls[tabEls.length - 1].classList.add('drag-over-right');
  });
  bar.addEventListener('dragleave', (e) => {
    if (!bar.contains(e.relatedTarget)) _clearTabDragIndicators();
  });
  bar.addEventListener('drop', (e) => {
    e.preventDefault();
    _clearTabDragIndicators();
    const draggedTabIndex = e.dataTransfer.getData('application/x-tab-idx');
    if (draggedTabIndex) {
      if (e.target.closest?.('.tab-item')) return;
      const fromIdx = parseInt(draggedTabIndex);
      if (isNaN(fromIdx) || fromIdx < 0 || fromIdx >= _tabs.length || fromIdx === _tabs.length - 1) return;
      const moved = _tabs.splice(fromIdx, 1)[0];
      _tabs.push(moved);
      renderTabs();
      return;
    }
    // Meldexノードのドロップ
    const cfData = e.dataTransfer.getData('application/x-meldex-node');
    if (!cfData) return;
    try {
      const { name, path, type } = JSON.parse(cfData);
      const openType = _normalizeOpenTypeForNav(type);
      // 挿入位置を決定
      const tabEls = [...bar.querySelectorAll('.tab-item')];
      let insertIdx = _tabs.length;
      for (let i = 0; i < tabEls.length; i++) {
        const rect = tabEls[i].getBoundingClientRect();
        if (e.clientX < rect.left + rect.width / 2) { insertIdx = i; break; }
      }
      const id = 'tab-' + (++_tabIdCounter);
      const newTab = { id, label: name || '(無題)', type: openType, path: path || '', icon: _tabIcon(openType) };
      _tabs.splice(insertIdx, 0, newTab);
      _activeTabId = id;
      renderTabs();
      _addingTab = true;
      try {
        navOpen({ type: openType, label: name, path });
      } finally {
        _addingTab = false;
      }
    } catch {}
  });
})();

// タブ右クリックメニュー（＋長押しでも同メニュー）
function _handleTabBarContextmenu(e) {
  const tabEl = e.target.closest('.tab-item');
  if (!tabEl) return;
  e.preventDefault();
  const idx = parseInt(tabEl.dataset.tabIdx);
  const tab = _tabs[idx];
  if (!tab) return;

  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  { const z = _getZoom(); menu.style.left = (e.clientX / z) + 'px'; menu.style.top = (e.clientY / z) + 'px'; }
  function addMI(label, fn) {
    const mi = document.createElement('div');
    mi.textContent = label;
    mi.style.cssText = 'padding:4px 12px;cursor:pointer;font-size:13px;white-space:nowrap;';
    mi.onmouseenter = () => { mi.style.background = 'var(--bg4)'; };
    mi.onmouseleave = () => { mi.style.background = ''; };
    mi.addEventListener('click', () => { menu.remove(); fn(); });
    menu.appendChild(mi);
  }
  addMI('新しいウィンドウで開く', () => {
    const openType = _normalizeOpenTypeForNav(tab.type);
    const url = '/?open=' + encodeURIComponent(openType) + '&path=' + encodeURIComponent(tab.path || '') + '&label=' + encodeURIComponent(tab.label || '');
    Promise.resolve(_open_app_window_js(url)).then((ok) => {
      if (ok) closeTab(tab.id);
      else if (typeof showStatus === 'function') showStatus('新しいウィンドウを開けませんでした', true);
    });
  });
