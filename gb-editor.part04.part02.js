function _closeTableMiniToolbar(toolbar) {
  if (!toolbar) return;
  if (typeof toolbar._cleanup === 'function') toolbar._cleanup();
  toolbar.remove();
}

function _showTableToolbar(tableEl, editable) {
  document.querySelectorAll('.table-mini-toolbar').forEach(existing => {
    if (existing._tableElement !== tableEl) _closeTableMiniToolbar(existing);
  });
  if (tableEl._tableMiniToolbar?.isConnected) {
    _positionTableMiniToolbar(tableEl, tableEl._tableMiniToolbar);
    return;
  }
  const toolbar = document.createElement('div');
  toolbar.className = 'table-mini-toolbar';
  toolbar.contentEditable = 'false';
  toolbar._tableElement = tableEl;
  toolbar.addEventListener('mousedown', (e) => e.preventDefault());
  function _getCurrentCell() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    return sel.anchorNode?.nodeType === 1
      ? sel.anchorNode.closest('td, th')
      : sel.anchorNode?.parentElement?.closest('td, th');
  }
  const pushTableUndo = () => {
    if (editable && typeof _pushCustomUndo === 'function') _pushCustomUndo(editable);
  };
  const dispatchTableInput = () => editable.dispatchEvent(new Event('input', { bubbles: true }));
  [
    { label: '↑行', action: () => {
      const cell = _getCurrentCell();
      if (!cell) return;
      pushTableUndo();
      const row = cell.parentElement;
      const nr = row.cloneNode(true);
      nr.querySelectorAll('td,th').forEach(c => c.textContent = '');
      row.before(nr);
      dispatchTableInput();
    }},
    { label: '↓行', action: () => {
      const cell = _getCurrentCell();
      if (!cell) return;
      pushTableUndo();
      const row = cell.parentElement;
      const nr = row.cloneNode(true);
      nr.querySelectorAll('td,th').forEach(c => c.textContent = '');
      row.after(nr);
      dispatchTableInput();
    }},
    { label: '行削除', action: async () => {
      const cell = _getCurrentCell();
      if (!cell) return;
      if (!(await confirmNoteTableDelete('この行を削除しますか？'))) return;
      pushTableUndo();
      cell.parentElement.remove();
      dispatchTableInput();
    }},
    { label: '列削除', action: async () => {
      const cell = _getCurrentCell();
      if (!cell) return;
      if (!(await confirmNoteTableDelete('この列を削除しますか？'))) return;
      pushTableUndo();
      const ci = [...cell.parentElement.children].indexOf(cell);
      tableEl.querySelectorAll('tr').forEach(r => { if (r.children[ci]) r.children[ci].remove(); });
      dispatchTableInput();
    }},
  ].forEach(({label, action}) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'table-mini-toolbar-btn';
    btn.textContent = label;
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); action(); });
    toolbar.appendChild(btn);
  });
  document.body.appendChild(toolbar);
  _positionTableMiniToolbar(tableEl, toolbar);
  tableEl._tableMiniToolbar = toolbar;
  const reposition = () => {
    if (!tableEl.isConnected) {
      _closeTableMiniToolbar(toolbar);
      return;
    }
    _positionTableMiniToolbar(tableEl, toolbar);
  };
  const _remove = (e) => {
    if (!tableEl.contains(e.target) && !toolbar.contains(e.target)) _closeTableMiniToolbar(toolbar);
  };
  toolbar._cleanup = () => {
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
    document.removeEventListener('click', _remove);
    if (tableEl._tableMiniToolbar === toolbar) tableEl._tableMiniToolbar = null;
  };
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
  setTimeout(() => document.addEventListener('click', _remove), 0);
}

// テーブルセルクリック/タップでミニツールバー表示
document.addEventListener('click', (e) => {
  const td = e.target.closest('#page-content table td, #page-content table th, #entity-freetext table td, #entity-freetext table th, #dp-editable table td, #dp-editable table th, #board-note-editable table td, #board-note-editable table th');
  if (!td) return;
  if (typeof window.showNoteTableCellControls === 'function') {
    window.showNoteTableCellControls(td);
    return;
  }
  const table = td.closest('table');
  const editable = td.closest('[contenteditable="true"]');
  if (table && editable) _showTableToolbar(table, editable);
});
