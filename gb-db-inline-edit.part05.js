function startColResize(e, th, colIndex, propName) {
  e.preventDefault();
  e.stopPropagation();
  const ctx = typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(th, { dbPath: state.currentDbPath })
    : (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath;
  const table = th?.closest?.('table') || _currentPivotTable(ctx);
  const startX = e.clientX;
  const startW = Math.max(60, parseFloat(th.style.width) || th.getBoundingClientRect?.().width || th.offsetWidth || 100);
  let lastWidth = Math.max(60, Math.round(startW));

  const handle = e.target?.closest?.('.col-resize-handle') || e.target;
  handle.classList.add('active');
  handle.setPointerCapture?.(e.pointerId);

  const applyLiveWidth = (width) => {
    lastWidth = Math.max(60, Math.round(width));
    th.style.width = lastWidth + 'px';
    th.style.minWidth = lastWidth + 'px';
    th.style.maxWidth = lastWidth + 'px';
    setColWidth(colIndex, lastWidth, table);
    if (typeof _dbReflowPinnedColumnOffsets === 'function') _dbReflowPinnedColumnOffsets(table);
  };
  const onMove = (e2) => {
    applyLiveWidth(startW + e2.clientX - startX);
  };
  const onUp = (upEvent) => {
    handle.classList.remove('active');
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    handle.releasePointerCapture?.(upEvent?.pointerId ?? e.pointerId);
    // 幅を永続化
    if (propName && dbPath) {
      setColWidthPersist(dbPath, propName, lastWidth, {
        ctx,
        label: 'シート表示: 列幅',
        detail: propName,
      });
    }
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

function setColWidth(colIndex, width, table) {
  // ヘッダー・本文・集計行を同じピクセル幅で固定する。
  table = table || _currentPivotTable();
  if (!table) return;
  const nextWidth = Math.max(60, Math.round(Number(width) || 60));
  table.querySelectorAll('thead tr, tbody tr, tfoot tr').forEach(tr => {
    const cell = tr.children[colIndex];
    if (cell) {
      cell.style.width = nextWidth + 'px';
      cell.style.minWidth = nextWidth + 'px';
      cell.style.maxWidth = nextWidth + 'px';
    }
  });
}

function _showBulkColumnWidthModal(propName, ctxOrDbPath) {
  const ctx = (typeof ctxOrDbPath === 'object' && ctxOrDbPath)
    ? ctxOrDbPath
    : (typeof _dbPaneContextFromEvent === 'function'
      ? _dbPaneContextFromEvent(activeCell, { dbPath: typeof ctxOrDbPath === 'string' ? ctxOrDbPath : state.currentDbPath })
      : (typeof _currentPaneState === 'function' ? _currentPaneState() : null));
  const dbPath = (typeof ctxOrDbPath === 'string' ? ctxOrDbPath : '') || (ctx && ctx.dbPath) || state.currentDbPath;
  if (!dbPath) return;
  let targets = _getSelectedColumns(dbPath);
  if (!targets.length || !targets.includes(propName)) {
    targets = [propName];
    _setSelectedColumns(dbPath, targets, propName);
  }
  const widths = getColWidths(dbPath, { ctx });
  const firstWidth = Number(widths[targets[0]] || 100);
  const sameWidth = targets.every(name => Number(widths[name] || 100) === firstWidth);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal" style="min-width:360px;">
    <h3>列幅を指定</h3>
    <div style="margin:8px 0;color:var(--fg2);font-size:12px;line-height:1.6;">対象: ${targets.map(name => esc(name)).join(' / ')}</div>
    <div class="field">
      <label>幅 (px)</label>
      <input id="bulk-col-width-input" type="number" min="60" step="1" value="${sameWidth ? firstWidth : ''}" placeholder="${sameWidth ? '' : '現在は列ごとに異なります'}" style="width:100%;padding:6px 8px;">
    </div>
    <div class="btn-row" style="margin-top:12px;">
      <button data-action="this.closest('.modal-overlay').remove()">キャンセル</button>
      <button class="primary" id="bulk-col-width-apply">適用</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#bulk-col-width-apply')?.addEventListener('click', () => {
    const input = overlay.querySelector('#bulk-col-width-input');
    const raw = (input?.value || '').trim();
    const parsed = parseInt(raw, 10);
    if (!raw || Number.isNaN(parsed)) {
      showStatus('幅を入力してください', true);
      return;
    }
    const value = Math.max(60, parsed);
    const before = typeof captureDbViewConfigHistory === 'function' ? captureDbViewConfigHistory(dbPath) : null;
    targets.forEach(name => setColWidthPersist(dbPath, name, value, { skipHistory: true, ctx }));
    if (typeof pushDbViewConfigHistory === 'function' && typeof captureDbViewConfigHistory === 'function') {
      pushDbViewConfigHistory(dbPath, 'シート表示: 列幅', before, captureDbViewConfigHistory(dbPath), targets.join(' / '));
    }
    overlay.remove();
    if (typeof _renderCurrentDbView === 'function') _renderCurrentDbView(ctx, dbPath);
    else if (typeof renderPivot === 'function') renderPivot(ctx);
  });
  setTimeout(() => overlay.querySelector('#bulk-col-width-input')?.focus(), 30);
}

/* DB Undo/Redo ヘルパー（scope = 'db:' + dbPath で開いているDB単位） */
