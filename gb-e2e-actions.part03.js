/* gb-e2e-actions.part03.js: timeline-specific E2E actions */
  registerAction('database_reorder_timeline_header', async (action, api) => {
    const dbPath = action.dbPath || _appState().currentDbPath;
    const configDbPath = _resolvedDbPathKey(api, dbPath);
    const fromValue = String(action.fromValue || action.from || 'Villain');
    const toValue = String(action.toValue || action.to || 'Hero');
    api.assert(dbPath, 'dbPath が見つかりません');
    let focused = await _focusContentTab('database', dbPath, api, 'シートタブ再アクティブ化').catch(() => null);
    if (!focused) focused = await _focusContentTab('pivot', dbPath, api, 'シートタブ再アクティブ化').catch(() => null);
    const paneCtx = focused?.paneId && typeof getPaneContext === 'function'
      ? getPaneContext(focused.paneId)
      : null;
    const renderCtx = paneCtx || (typeof _currentPaneState === 'function' ? _currentPaneState() : null) || {};
    renderCtx.dbPath = dbPath;
    if ((!renderCtx.pivotData || !Object.keys(renderCtx.pivotData.entities || {}).length) && typeof selectDatabase === 'function') {
      await selectDatabase(dbPath, renderCtx);
    }
    renderCtx.dbPath = configDbPath || dbPath;
    if (typeof renderTimeline === 'function') renderTimeline(renderCtx);
    const headerState = await api.waitFor(() => {
      const sortable = [...document.querySelectorAll('.timeline-view .tl-axis-sortable, #timeline-view .tl-axis-sortable')]
        .filter(el => _isVisibleElement(el));
      if (sortable.length) return { sortable };
      const all = [...document.querySelectorAll('.timeline-view .tl-header-cell, #timeline-view .tl-header-cell')]
        .filter(el => _isVisibleElement(el));
      return all.length ? { sortable, all } : null;
    }, 'タイムラインヘッダー');
    const headers = headerState.sortable || [];
    api.assert(headers.length, `タイムラインヘッダーが並べ替え可能になっていません: headers=${(headerState.all || []).map(el => `${el.className}:${(el.textContent || '').trim()}`).join('|')}`);
    const findHeader = (value) => headers.find(el => {
      const key = el.dataset.tlAxisValue || '';
      const text = (el.textContent || '').trim();
      return key === value || text === value || text.includes(value);
    });
    const pair = { from: findHeader(fromValue), to: findHeader(toValue) };
    api.assert(pair.from && pair.to, `タイムラインヘッダーが見つかりません: ${fromValue} → ${toValue} / headers=${headers.map(el => `${el.dataset.tlAxisValue || ''}:${(el.textContent || '').trim()}`).join('|')}`);
    const fromKey = pair.from.dataset.tlAxisValue || fromValue;
    const toKey = pair.to.dataset.tlAxisValue || toValue;
    const dataTransfer = typeof DataTransfer === 'function'
      ? new DataTransfer()
      : {
          _data: {},
          effectAllowed: 'move',
          dropEffect: 'move',
          setData(type, value) { this._data[type] = String(value); },
          getData(type) { return this._data[type] || ''; },
        };
    const makeDragEvent = (type, target) => {
      const rect = target.getBoundingClientRect();
      const init = {
        bubbles: true,
        cancelable: true,
        dataTransfer,
        clientX: rect.left + Math.max(1, rect.width / 2),
        clientY: rect.top + Math.max(1, rect.height / 2),
      };
      let ev;
      try { ev = new DragEvent(type, init); }
      catch {
        ev = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'clientX', { value: init.clientX });
        Object.defineProperty(ev, 'clientY', { value: init.clientY });
      }
      if (!ev.dataTransfer) Object.defineProperty(ev, 'dataTransfer', { value: dataTransfer });
      return ev;
    };
    pair.from.dispatchEvent(makeDragEvent('dragstart', pair.from));
    pair.to.dispatchEvent(makeDragEvent('dragover', pair.to));
    pair.to.dispatchEvent(makeDragEvent('drop', pair.to));
    pair.from.dispatchEvent(makeDragEvent('dragend', pair.from));
    await api.waitFor(() => {
      const cfg = typeof getTimelineConfig === 'function' ? getTimelineConfig(configDbPath) : {};
      const order = Array.isArray(cfg?.rowOrder) ? cfg.rowOrder : [];
      const fromIdx = order.indexOf(fromKey);
      const toIdx = order.indexOf(toKey);
      return fromIdx >= 0 && toIdx >= 0 && fromIdx < toIdx ? true : null;
    }, `タイムラインヘッダー並べ替え保存: ${fromValue} → ${toValue}`);
    api.logStep(`タイムラインヘッダー並べ替え OK: ${fromValue} → ${toValue}`);
  });

  registerAction('database_click_timeline_entry', async (action, api) => {
    const dbPath = action.dbPath || _appState().currentDbPath;
    const configDbPath = _resolvedDbPathKey(api, dbPath);
    const entityName = action.entityName || 'Hero';
    const mode = action.mode || 'timeline';
    api.assert(dbPath, 'dbPath が見つかりません');
    const card = await api.waitFor(() => {
      const items = [...document.querySelectorAll('.timeline-view .tl-card, .timeline-view .tl-bar, #timeline-view .tl-card, #timeline-view .tl-bar')];
      return items.find(el => _isVisibleElement(el) && (
        el.dataset.entity === entityName || (el.textContent || '').includes(entityName)
      )) || null;
    }, 'タイムラインエントリ: ' + entityName);
    const rect = card.getBoundingClientRect();
    card.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: rect.left + Math.max(1, rect.width / 2),
      clientY: rect.top + Math.max(1, rect.height / 2),
    }));
    await api.waitFor(() => {
      const currentMode = typeof getCurrentViewMode === 'function' ? getCurrentViewMode(configDbPath) : '';
      const sentinel = _dbViewSentinel(mode);
      const panel = document.getElementById('gb-subpanel');
      const view = document.querySelector('[data-gb-subpanel-entity-root="true"]');
      const subpanelVisible = panel && !panel.hidden && view && _isVisibleElement(view);
      return currentMode === mode && sentinel && subpanelVisible ? true : null;
    }, 'タイムラインクリック後のビュー維持');
    api.logStep('タイムラインエントリクリック OK: ' + entityName);
  });
