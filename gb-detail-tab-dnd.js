/* gb-detail-tab-dnd.js: オプションパネル内タブの並べ替え */
(function (global) {
  const STORAGE_KEY = 'detail-tab-order';
  const DEFAULT_ORDER = [
    'note-editor',
    'db-property-settings',
    'calendar-today',
    'calendar-settings',
    'calendar-production',
    'board-card',
    'board-line',
    'board-note',
    'board-card-style',
    'board-line-style',
    'board-depth-style',
    'sn2-roles',
    'file-style',
    'publish',
    'sn2-theme',
    'sn2-ruby',
    'sn2-rowset',
    'backlinks',
    'tag-management',
  ];
  let _draggedTabId = '';

  function _readStoredOrder() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string' && id) : [];
    } catch {
      return [];
    }
  }

  function _tabId(tab) {
    return tab?.dataset?.detailTab || '';
  }

  function _cssEscape(value) {
    if (global.CSS?.escape) return global.CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function _tabs(bar) {
    return [...(bar?.querySelectorAll?.('.detail-tab[data-detail-tab]') || [])];
  }

  function _orderedIds(bar) {
    const ids = _tabs(bar).map(_tabId).filter(Boolean);
    const known = new Set(ids);
    const ordered = [];
    for (const id of [..._readStoredOrder(), ...DEFAULT_ORDER]) {
      if (known.has(id) && !ordered.includes(id)) ordered.push(id);
    }
    for (const id of ids) {
      if (!ordered.includes(id)) ordered.push(id);
    }
    return ordered;
  }

  function _saveOrder(bar) {
    const ids = _tabs(bar).map(_tabId).filter(Boolean);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)); } catch {}
  }

  function _clearIndicators(bar) {
    _tabs(bar).forEach(tab => tab.classList.remove('drag-over-left', 'drag-over-right', 'dragging'));
  }

  function applyOrder(bar) {
    if (!bar) return;
    const tabs = _tabs(bar);
    const currentIds = tabs.map(_tabId).filter(Boolean);
    const orderedIds = _orderedIds(bar);
    if (currentIds.join('\n') === orderedIds.join('\n')) return;
    const byId = new Map(tabs.map(tab => [_tabId(tab), tab]));
    for (const id of orderedIds) {
      const tab = byId.get(id);
      if (tab) bar.appendChild(tab);
    }
  }

  function _insertDragged(bar, dragged, target, insertBefore) {
    if (!bar || !dragged || !target || dragged === target) return false;
    const reference = insertBefore ? target : target.nextSibling;
    if (reference === dragged) return false;
    bar.insertBefore(dragged, reference);
    _saveOrder(bar);
    return true;
  }

  function _bindTab(bar, tab) {
    if (!bar || !tab || tab.dataset.detailTabDndBound === '1') return;
    tab.dataset.detailTabDndBound = '1';
    tab.draggable = true;

    tab.addEventListener('dragstart', event => {
      const id = _tabId(tab);
      if (!id || tab.hidden) {
        event.preventDefault();
        return;
      }
      _draggedTabId = id;
      event.dataTransfer?.setData('application/x-detail-tab-id', id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      tab.classList.add('dragging');
    });

    tab.addEventListener('dragend', () => {
      _draggedTabId = '';
      _clearIndicators(bar);
    });

    tab.addEventListener('dragover', event => {
      const draggedId = _draggedTabId;
      if (!draggedId || tab.hidden) return;
      event.preventDefault();
      _tabs(bar).forEach(el => el.classList.remove('drag-over-left', 'drag-over-right'));
      const rect = tab.getBoundingClientRect();
      const isLeft = event.clientX < rect.left + rect.width / 2;
      tab.classList.toggle('drag-over-left', isLeft);
      tab.classList.toggle('drag-over-right', !isLeft);
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    });

    tab.addEventListener('dragleave', () => tab.classList.remove('drag-over-left', 'drag-over-right'));

    tab.addEventListener('drop', event => {
      const draggedId = _draggedTabId || event.dataTransfer?.getData('application/x-detail-tab-id') || '';
      if (!draggedId || tab.hidden) return;
      event.preventDefault();
      const dragged = bar.querySelector(`.detail-tab[data-detail-tab="${_cssEscape(draggedId)}"]`);
      const insertBefore = tab.classList.contains('drag-over-left');
      _insertDragged(bar, dragged, tab, insertBefore);
      _draggedTabId = '';
      _clearIndicators(bar);
    });
  }

  function bind(bar) {
    if (!bar) return;
    applyOrder(bar);
    _tabs(bar).forEach(tab => _bindTab(bar, tab));
    if (bar.dataset.detailTabDndObserver === '1') return;
    bar.dataset.detailTabDndObserver = '1';
    const observer = new MutationObserver(() => {
      applyOrder(bar);
      _tabs(bar).forEach(tab => _bindTab(bar, tab));
    });
    observer.observe(bar, { childList: true });
  }

  global.GBDetailTabDnd = { bind, applyOrder, saveOrder: _saveOrder };

  function _bindExisting() {
    const bar = document.getElementById('detail-tab-bar');
    if (bar) bind(bar);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bindExisting, { once: true });
  } else {
    _bindExisting();
  }
})(window);
