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

  if (!globalThis.GBUI?.createModal) throw new Error('列幅指定を初期化できませんでした');
  const existing = document.querySelector('[data-e2e-id="db-bulk-column-width-dialog"]');
  if (existing) { existing.focus(); return existing.closest('.gb-modal-overlay')?._dbBulkColumnWidthApi || null; }
  const content = document.createElement('div');
  content.innerHTML = `
    <div style="margin:8px 0;color:var(--fg2);font-size:12px;line-height:1.6;">対象: ${targets.map(name => esc(name)).join(' / ')}</div>
    <div class="field">
      <label for="bulk-col-width-input">幅 (px)</label>
      <input id="bulk-col-width-input" class="gb-input" type="number" min="60" step="1" value="${sameWidth ? firstWidth : ''}" placeholder="${sameWidth ? '' : '現在は列ごとに異なります'}" style="width:100%;min-width:0;box-sizing:border-box;">
    </div>`;
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button'; cancelButton.className = 'gb-btn gb-btn-sm'; cancelButton.textContent = 'キャンセル';
  const applyButton = document.createElement('button');
  applyButton.type = 'button'; applyButton.id = 'bulk-col-width-apply'; applyButton.className = 'gb-btn gb-btn-sm gb-btn-primary primary'; applyButton.textContent = '適用';
  let busy = false;
  const modalApi = globalThis.GBUI.createModal({
    id: 'db-bulk-column-width', title: '列幅を指定', body: content, footer: [cancelButton, applyButton],
    variant: 'standard', geometryKey: 'db-bulk-column-width', minWidth: '0', initialFocus: '#bulk-col-width-input',
    returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : undefined,
    closeLabel: '列幅指定を閉じる', closeOnEsc: true, closeOnOverlay: true,
    onBeforeClose: reason => reason === 'applied' || !busy,
  });
  const overlay = modalApi.overlay;
  overlay._dbBulkColumnWidthApi = modalApi;
  overlay.dataset.e2eId = 'db-bulk-column-width-overlay';
  modalApi.modal.dataset.e2eId = 'db-bulk-column-width-dialog';
  modalApi.modal.style.width = 'min(420px, calc(100vw - 24px))';
  modalApi.body.style.setProperty('overflow-x', 'hidden', 'important');
  cancelButton.addEventListener('click', () => modalApi.close('cancel'));
  applyButton.addEventListener('click', async () => {
    if (busy) return;
    const input = content.querySelector('#bulk-col-width-input');
    const raw = (input?.value || '').trim();
    const parsed = parseInt(raw, 10);
    if (!raw || Number.isNaN(parsed)) {
      showStatus('幅を入力してください', true);
      return;
    }
    busy = true;
    cancelButton.disabled = true;
    applyButton.disabled = true;
    const value = Math.max(60, parsed);
    const before = typeof captureDbViewConfigHistory === 'function' ? captureDbViewConfigHistory(dbPath) : null;
    try {
      targets.forEach(name => setColWidthPersist(dbPath, name, value, { skipHistory: true, ctx }));
      if (typeof _renderCurrentDbView === 'function') await Promise.resolve(_renderCurrentDbView(ctx, dbPath));
      else if (typeof renderPivot === 'function') await Promise.resolve(renderPivot(ctx));
    } catch (error) {
      if (before && typeof restoreLocalStorageSettings === 'function') {
        try {
          restoreLocalStorageSettings(before);
          if (typeof _persistDbViewConfigToBackend === 'function') {
            await Promise.resolve(_persistDbViewConfigToBackend(dbPath, getDbViewConfig(dbPath), { immediate: true, ctx }));
          }
        } catch (restoreError) {
          console.warn('列幅保存失敗後の設定復元に失敗:', restoreError);
        }
      }
      try {
        if (typeof _renderCurrentDbView === 'function') await Promise.resolve(_renderCurrentDbView(ctx, dbPath));
        else if (typeof renderPivot === 'function') await Promise.resolve(renderPivot(ctx));
      } catch (restoreError) {
        console.warn('列幅保存失敗後の表示復元に失敗:', restoreError);
      }
      showStatus('列幅の保存に失敗しました: ' + (error?.message || error), true);
      busy = false;
      cancelButton.disabled = false;
      applyButton.disabled = false;
      applyButton.focus({ preventScroll: true });
      return;
    }
    if (typeof pushDbViewConfigHistory === 'function' && typeof captureDbViewConfigHistory === 'function') {
      pushDbViewConfigHistory(dbPath, 'シート表示: 列幅', before, captureDbViewConfigHistory(dbPath), targets.join(' / '));
    }
    modalApi.close('applied');
  });
  modalApi.open();
  return modalApi;
}

/* DB Undo/Redo ヘルパー（scope = 'db:' + dbPath で開いているDB単位） */
