function createTypedValueElement(val, entityPath, propName, thumbSize, propTypeConfig, options = {}) {
  const dbPath = options.dbPath || _valueEditorDbPath(entityPath);
  const filterMode = options.filter ?? options.ctx?.filter ?? (dbPath === state.currentDbPath ? state.filter : 'disabled');
  if (!propTypeConfig || propTypeConfig.type === 'text') {
    return createValueElement(val, entityPath, propName, thumbSize, { ...options, dbPath, filter: filterMode });
  }

  // ボタン型: 値なし、ボタンのみ表示
  if (propTypeConfig.type === 'button') {
    const row = document.createElement('div');
    row.className = 'cell-value';
    const btn = document.createElement('button');
    btn.className = 'db-action-btn';
    btn.dataset.e2eId = _typedCellControlE2eId('button', entityPath, propName);
    btn._dbButtonActions = Array.isArray(propTypeConfig.actions) ? propTypeConfig.actions.map(action => ({ ...action })) : [];
    btn.textContent = propTypeConfig.label || '実行';
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const ctx = typeof _dbFindPaneContextForPath === 'function' ? _dbFindPaneContextForPath(dbPath) : null;
      const entityName = entityPath.replace(/\.md$/, '').split('/').pop();
      const livePtc = dbPath && typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath)?.[propName] : null;
      const renderedActions = Array.isArray(btn._dbButtonActions) ? btn._dbButtonActions : [];
      const actions = Array.isArray(livePtc?.actions) && livePtc.actions.length > 0
        ? livePtc.actions
        : (Array.isArray(propTypeConfig.actions) && propTypeConfig.actions.length > 0 ? propTypeConfig.actions : renderedActions);
      try {
        if (!actions.length) {
          if (typeof showStatus === 'function') showStatus('実行する操作がありません', true);
          return;
        }
        btn.disabled = true;
        await _executeButtonActions(dbPath, entityName, actions, ctx);
      } catch (err) {
        if (typeof showStatus === 'function') showStatus('ボタン実行失敗: ' + (err?.message || err), true);
      } finally {
        if (btn.isConnected) btn.disabled = false;
      }
    });
    row.appendChild(btn);
    return row;
  }

  const row = document.createElement('div');
  row.className = 'cell-value' + (val.status === 'ボツ' ? ' status-botsu' : '');
  _setupCellValueDrag(row, val, entityPath, propName);

  // Status dot（採用状況フィルタ無効時 or DB側でステータス機能 OFF の場合は非表示）
  if (filterMode !== 'disabled' && getStatusEnabled(dbPath)) {
    const dot = document.createElement('span');
    dot.className = 'status-dot';
    dot.style.background = _getStatusColor(val.status, dbPath);
    dot.title = val.status || '案';
    dot.addEventListener('click', (e) => { e.stopPropagation(); showStatusDropdown(dot, val, entityPath, propName); });
    row.appendChild(dot);
  }

  // 共通「...」ホバーボタン（全型に削除等のコンテキストメニュー）
  row.style.position = 'relative';
  const moreBtn = document.createElement('span');
  moreBtn.className = 'cell-value-more';
  moreBtn.style.cssText = 'position:absolute;right:28px;top:50%;transform:translateY(-50%);display:none;cursor:pointer;padding:0 2px;color:var(--fg2);background:var(--bg3);border-radius:3px;z-index:2;';
  moreBtn.innerHTML = lucide('ellipsis', 12);
  moreBtn.title = propTypeConfig.type === 'image' ? '画像を管理' : 'メニュー';
  moreBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (propTypeConfig.type === 'image' && typeof showImageGalleryModal === 'function') {
      showImageGalleryModal(entityPath, propName, val, propTypeConfig);
      return;
    }
    _showValueContextMenu(e, val, entityPath, propName);
  });
  row.appendChild(moreBtn);
  row.addEventListener('mouseenter', () => { moreBtn.style.display = ''; });
  row.addEventListener('mouseleave', () => { moreBtn.style.display = 'none'; });

  const v = typeof _cellUiValueToString === 'function'
    ? _cellUiValueToString(val.value)
    : (val.value == null ? '' : String(val.value));
  const type = propTypeConfig.type;

  if (type === 'image' && typeof createImagePropertyValueElement === 'function') {
    row.appendChild(createImagePropertyValueElement(val, entityPath, propName, thumbSize, propTypeConfig));
    return row;
  }

  if (type === 'checkbox') {
    const cb = document.createElement('span');
    cb.className = 'cell-checkbox';
    cb.textContent = (v === 'true' || v === 'はい' || v === '1' || v === 'yes') ? '\u2611' : '\u2610';
    cb.addEventListener('click', async (e) => {
      e.stopPropagation();
      const lockMsg = _valueEditorLockMessage(dbPath, propName);
      if (lockMsg) { showStatus(lockMsg); return; }
      const isChecked = v === 'true' || v === 'はい' || v === '1' || v === 'yes';
      const nv = isChecked ? 'false' : 'true';
      try {
        const hasExistingValue = val?.file && val.candidate_index != null;
        if (hasExistingValue) {
          await _apiPutValue(val, { new_value: nv });
          _dbUndoValue('チェック: ' + v + ' → ' + nv, val, v, nv);
        } else {
          const result = await _apiPostValue(entityPath, propName, nv, '採用', '');
          val.file = result?.path || entityPath;
          val.property = propName;
          val.candidate_index = result?.candidate_index;
          val.status = '採用';
          const pivotData = (typeof _dbFindPaneContextForPath === 'function' ? _dbFindPaneContextForPath(dbPath)?.pivotData : null) || state.pivotData;
          const entityName = entityPath.replace(/\.md$/, '').split('/').pop();
          const entityData = pivotData?.entities?.[entityName];
          if (entityData) {
            if (!Array.isArray(entityData[propName])) entityData[propName] = [];
            if (!entityData[propName].includes(val)) entityData[propName].push(val);
          }
        }
        val.value = nv;
        cb.textContent = nv === 'true' ? '\u2611' : '\u2610';
        showStatus(nv === 'true' ? '\u2611 チェック' : '\u2610 チェック解除');
        // Step 3: 部分更新化 (checkbox) — 条件付き書式 / フィルタ・グループ・ソート再評価のため
        if (typeof _refreshAfterCellEdit === 'function') _refreshAfterCellEdit(cb, entityPath, propName);
      } catch (e) { showStatus('保存に失敗: ' + (e?.message || e), true); }
    });
    row.appendChild(cb);
    return row;
  }

  if (type === 'date') {
    const span = document.createElement('span');
    span.className = 'cell-date value-text';
    span.textContent = _formatDateDisplay(v, propTypeConfig);
    span.addEventListener('click', () => {
      const lockMsg = _valueEditorLockMessage(dbPath, propName);
      if (lockMsg) { showStatus(lockMsg); return; }
      if (span.querySelector('.cell-date-editor')) return;
      const editor = typeof _dbDateCreateEditor === 'function'
        ? _dbDateCreateEditor(v, propTypeConfig, {
          layout: 'inline',
          className: 'cell-date-editor',
          rootStyle: 'display:flex;align-items:center;gap:4px;flex-wrap:wrap;width:calc(100% - 28px);',
          inputStyle: 'flex:1 1 0;min-width:130px;padding:3px 6px;background:var(--bg2);color:var(--fg);border:1px solid var(--accent);border-radius:3px;font-size:12px;box-sizing:border-box;',
          inputClassName: 'value-input cell-date-input',
        })
        : null;
      if (!editor) return;
      span.textContent = '';
      span.appendChild(editor.root);
      // 編集中は同セル内の「...」「+」を隠す
      const moreBtn = row.querySelector('.cell-value-more');
      if (moreBtn) moreBtn.style.display = 'none';
      const td = row.closest('td');
      const addBtn = td ? td.querySelector('.cell-add-btn') : null;
      if (addBtn) { addBtn.dataset.editingHidden = '1'; addBtn.style.display = 'none'; }
      const restoreBtns = () => {
        if (addBtn && addBtn.dataset.editingHidden) { addBtn.style.display = ''; delete addBtn.dataset.editingHidden; }
        if (moreBtn) moreBtn.style.display = 'none';
      };
      editor.focus();
      let done = false;
      const finish = async () => {
        if (done) return;
        done = true;
        restoreBtns();
        const nv = editor.getValue();
        span.textContent = nv ? _formatDateDisplay(nv, propTypeConfig) : '';
        const oldNormalized = typeof _dbDateNormalizeForCompare === 'function'
          ? _dbDateNormalizeForCompare(v, propTypeConfig)
          : _toInputDateValue(v, editor.mode?.withTime);
        if (nv !== oldNormalized) {
          try {
            await _apiPutValue(val, { new_value: nv });
            _dbUndoValue(propName + ': ' + v + ' → ' + nv, val, v, nv);
            val.value = nv;
            // Step 3: 部分更新化 (ソート対象列等のフォールバックは _tryRefreshPivotCellLocal 内で判定)
            _refreshAfterCellEdit(span, entityPath, propName);
          } catch (e) {
            showStatus('保存に失敗: ' + (e?.message || e), true);
            span.textContent = _formatDateDisplay(v, propTypeConfig);
          }
        }
      };
      editor.root.addEventListener('focusout', (e) => {
        if (editor.contains(e.relatedTarget)) return;
        finish();
      });
      editor.root.addEventListener('db-date-editor-commit', (e) => {
        e.preventDefault();
        finish();
      });
      if (!editor.mode?.withTime && !editor.mode?.range && editor.startInput) {
        editor.startInput.addEventListener('change', finish);
      }
      editor.root.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); finish(); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); done = true; restoreBtns(); span.textContent = _formatDateDisplay(v, propTypeConfig); }
      });
    });
    row.appendChild(span);
    return row;
  }

  if (type === 'number') {
    const span = document.createElement('span');
    span.className = 'cell-number value-text';
    span.textContent = v;
    span.addEventListener('click', () => _startNumberValueEdit(span, val, entityPath, propName, dbPath));
    row.appendChild(span);
    if (propTypeConfig.unit) {
      const unit = document.createElement('span');
      unit.className = 'value-unit';
      unit.textContent = propTypeConfig.unit;
      row.appendChild(unit);
    }
    return row;
  }

  if (type === 'url') {
    if (/^https?:\/\//.test(v)) {
      const link = document.createElement('a');
      link.className = 'value-url';
      link.href = v;
      link.target = '_blank';
      link.rel = 'noopener';
      if (typeof _dbApplyCellInteractiveLinkA11y === 'function') {
        _dbApplyCellInteractiveLinkA11y(link, 'url', entityPath, propName, v);
      }
      try { link.textContent = new URL(v).hostname + '\u2026'; } catch { link.textContent = v; }
      link.addEventListener('click', (e) => e.stopPropagation());
      row.appendChild(link);
    } else {
      const txt = document.createElement('span');
      txt.className = 'value-text';
      txt.textContent = v;
      txt.addEventListener('click', () => startInlineEdit(txt, val, entityPath, propName));
      row.appendChild(txt);
    }
    return row;
  }

  if (type === 'select') {
    const span = document.createElement('span');
    span.className = 'cell-select-val';
    span.textContent = v;
    span.style.cursor = 'pointer';
    span.addEventListener('click', (e) => {
      e.stopPropagation();
      const td = span.closest('td[data-prop-name]');
      const tr = span.closest('tr[data-entity-name]');
      if ((e.shiftKey || e.ctrlKey || e.metaKey) && td && typeof selectDbCellFromPointer === 'function') {
        selectDbCellFromPointer(td, e);
        return;
      }
      if (td && typeof setActiveCell === 'function') setActiveCell(td, { scroll: false });
      if (td && tr && typeof startCellInlineAdd === 'function') {
        const rowEntityName = tr.dataset.entityName || entityPath.replace(/\.md$/, '').split('/').pop();
        startCellInlineAdd(td, entityPath, rowEntityName, propName);
        return;
      }
      const latestConfig = typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath)?.[propName] : null;
      const latestOptions = Array.isArray(latestConfig?.options) ? latestConfig.options : (propTypeConfig.options || []);
      showSelectDropdown(span, val, entityPath, propName, latestOptions, dbPath);
    });
    row.appendChild(span);
    return row;
  }

  if (type === 'multi-select') {
    const tags = v.split(',').map(s => s.trim()).filter(Boolean);
    const tagContainer = document.createElement('div');
    tagContainer.className = 'multi-select-tags';
    tagContainer.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;cursor:pointer;';
    tags.forEach(t => {
      const tag = document.createElement('span');
      tag.className = 'multi-select-tag';
      tag.textContent = t;
      tagContainer.appendChild(tag);
    });
    tagContainer.addEventListener('click', (e) => {
      e.stopPropagation();
      const td = tagContainer.closest('td[data-prop-name]');
      const tr = tagContainer.closest('tr[data-entity-name]');
      if ((e.shiftKey || e.ctrlKey || e.metaKey) && td && typeof selectDbCellFromPointer === 'function') {
        selectDbCellFromPointer(td, e);
        return;
      }
      if (td && typeof setActiveCell === 'function') setActiveCell(td, { scroll: false });
      if (td && tr && typeof startCellInlineAdd === 'function') {
        const rowEntityName = tr.dataset.entityName || entityPath.replace(/\.md$/, '').split('/').pop();
        startCellInlineAdd(td, entityPath, rowEntityName, propName);
      }
    });
    row.appendChild(tagContainer);
    return row;
  }

  if (type === 'user') {
    const span = document.createElement('span');
    span.className = 'cell-user-val';
    span.style.cssText = 'display:inline-flex;align-items:center;gap:4px;cursor:pointer;padding:2px 6px;border-radius:3px;font-size:12px;';
    if (v) {
      span.innerHTML = _userAvatarSmall(v) + ' ' + esc(v);
    } else {
      span.textContent = '—';
      span.style.color = 'var(--fg2)';
    }
    span.addEventListener('click', (e) => {
      e.stopPropagation();
      const lockMsg = _valueEditorLockMessage(dbPath, propName);
      if (lockMsg) { showStatus(lockMsg); return; }
      _showUserDropdown(span, val, entityPath, propName, v, false, { dbPath });
    });
    row.appendChild(span);
    return row;
  }

  if (type === 'multi-user') {
    const container = document.createElement('div');
    container.className = 'multi-user-tags';
    container.style.cssText = 'display:flex;flex-wrap:wrap;gap:2px;cursor:pointer;';
    const users = v ? v.split(',').map(s => s.trim()).filter(Boolean) : [];
    if (users.length === 0) {
      container.textContent = '—';
      container.style.color = 'var(--fg2)';
      container.style.fontSize = '12px';
      container.style.padding = '2px';
    }
    users.forEach(u => {
      const tag = document.createElement('span');
      tag.className = 'multi-user-tag';
      tag.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:1px 6px;border-radius:10px;font-size:11px;background:var(--bg3);border:1px solid var(--border);';
      tag.innerHTML = _userAvatarSmall(u) + ' ' + esc(u);
      container.appendChild(tag);
    });
    container.addEventListener('click', (e) => {
      e.stopPropagation();
      const lockMsg = _valueEditorLockMessage(dbPath, propName);
      if (lockMsg) { showStatus(lockMsg); return; }
      _showUserDropdown(container, val, entityPath, propName, v, true, { dbPath });
    });
    row.appendChild(container);
    return row;
  }

  if (type === 'relation') {
    const span = document.createElement('span');
    span.className = 'relation-link';
    span.textContent = v || '(未選択)';
    span.style.cursor = 'pointer';
    // 自己参照対応: relationDb === '' なら現在のDBを使う
    const _relDb = typeof _dbResolveRelationDbPath === 'function'
      ? _dbResolveRelationDbPath(dbPath, propTypeConfig)
      : ((propTypeConfig.relationDb === '' ? dbPath : propTypeConfig.relationDb) || '');
    span.dataset.dbPath = _relDb;
    span.dataset.entityId = v;
    // キャッシュ済みなら同期表示、未解決時のみ非同期フォロー
    if (v && _relDb) {
      const display = _getRelationDisplayInfo(v, _relDb);
      span.textContent = display.label || v;
      span.dataset.entityName = display.label || v;
      if (!display.resolved) {
        _resolveRelationName(v, _relDb).then(name => {
          span.textContent = name;
          span.dataset.entityName = name || v;
        });
      }
      // カスケード不整合警告
      if (propTypeConfig.cascadeFrom) {
        _validateCascadeValue(v, entityPath, propTypeConfig).then(valid => {
          if (!valid) {
            span.style.background = 'rgba(255,100,100,0.15)';
            span.title = '依存元（' + propTypeConfig.cascadeFrom + '）の値と一致しません';
          }
        });
      }
    }
    span.addEventListener('click', (e) => {
      e.stopPropagation();
      const lockMsg = _valueEditorLockMessage(dbPath, propName);
      if (lockMsg) { showStatus(lockMsg); return; }
      _showRelationDropdown(span, val, entityPath, propName, { ...propTypeConfig, __sourceDbPath: dbPath }, false);
    });
    if (v) span.ondblclick = async (e) => {
      e.stopPropagation();
      const name = _relDb && typeof _resolveRelationName === 'function'
        ? await _resolveRelationName(v, _relDb)
        : _resolveRelationNameSync(v, _relDb);
      // 互換テスト用: navigateToEntity(name, _relDb);
      navigateToEntity(name, _relDb, options.ctx);
    };
    row.appendChild(span);
    return row;
  }

  if (type === 'multi-relation') {
    const ids = v.split(',').map(s => s.trim()).filter(Boolean);
    const tagContainer = document.createElement('div');
    tagContainer.className = 'multi-select-tags';
    tagContainer.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;cursor:pointer;';
    // 自己参照対応: relationDb === '' なら現在のDBを使う
    const _relDbM = typeof _dbResolveRelationDbPath === 'function'
      ? _dbResolveRelationDbPath(dbPath, propTypeConfig)
      : ((propTypeConfig.relationDb === '' ? dbPath : propTypeConfig.relationDb) || '');
    ids.forEach(idOrName => {
      const tag = document.createElement('span');
      tag.className = 'relation-link';
      const display = _relDbM ? _getRelationDisplayInfo(idOrName, _relDbM) : { label: idOrName, resolved: true };
      tag.textContent = display.label || idOrName;
      tag.dataset.dbPath = _relDbM;
      tag.dataset.entityId = idOrName;
      tag.dataset.entityName = display.label || idOrName;
      if (_relDbM && !display.resolved) {
        _resolveRelationName(idOrName, _relDbM).then(name => {
          tag.textContent = name;
          tag.dataset.entityName = name || idOrName;
        });
      }
      tag.ondblclick = async (e) => {
        e.stopPropagation();
        const name = _relDbM && typeof _resolveRelationName === 'function'
          ? await _resolveRelationName(idOrName, _relDbM)
          : _resolveRelationNameSync(idOrName, _relDbM);
        // 互換テスト用: navigateToEntity(name, _relDbM);
        navigateToEntity(name, _relDbM, options.ctx);
      };
      tagContainer.appendChild(tag);
    });
    tagContainer.addEventListener('click', (e) => {
      e.stopPropagation();
      const lockMsg = _valueEditorLockMessage(dbPath, propName);
      if (lockMsg) { showStatus(lockMsg); return; }
      _showRelationDropdown(tagContainer, val, entityPath, propName, { ...propTypeConfig, __sourceDbPath: dbPath }, true);
    });
    row.appendChild(tagContainer);
    return row;
  }

  // マルチソースリレーション型
  if (type === 'multi-source-relation') {
    const tagContainer = document.createElement('div');
    tagContainer.className = 'msr-tags';
    const entries = _parseMsrValue(v);
    const sources = propTypeConfig.sources || [];

    if (entries.length === 0 && propTypeConfig.mode !== 'auto') {
      tagContainer.textContent = '—';
      tagContainer.style.cssText = 'color:var(--fg2);font-size:12px;padding:2px;cursor:pointer;';
    }

    entries.forEach(entry => {
      const tag = document.createElement('span');
      tag.className = 'msr-tag';
      // DBラベルバッジ
      const srcIdx = sources.findIndex(s => s.db === entry.db);
      const label = (srcIdx >= 0 && sources[srcIdx].label) ? sources[srcIdx].label : (entry.db.split('/').pop() || '?');
      const badge = document.createElement('span');
      badge.className = 'msr-badge msr-badge-' + Math.max(0, Math.min(srcIdx, 4));
      badge.textContent = label;
      tag.appendChild(badge);
      // エントリ名（非同期解決）
      const nameSpan = document.createElement('span');
      nameSpan.className = 'msr-name';
      const display = entry.db ? _getRelationDisplayInfo(entry.id, entry.db) : { label: entry.id, resolved: true };
      nameSpan.textContent = display.label || entry.id;
      if (entry.db && !display.resolved) {
        _resolveRelationName(entry.id, entry.db).then(name => { nameSpan.textContent = name; });
      }
      tag.appendChild(nameSpan);
      // ダブルクリック → ナビゲーション
      tag.ondblclick = async (e) => {
        e.stopPropagation();
        const name = await _resolveRelationName(entry.id, entry.db);
        if (name && typeof navigateToEntity === 'function') navigateToEntity(name, entry.db, options.ctx);
      };
      tagContainer.appendChild(tag);
    });

    // 自動モード: 読取専用
    if (propTypeConfig.mode === 'auto') {
      tagContainer.title = '自動収集（読み取り専用）';
    } else {
      // 手動モード: クリックでドロップダウン
      tagContainer.style.cursor = 'pointer';
      tagContainer.addEventListener('click', (e) => {
        e.stopPropagation();
        const lockMsg = _valueEditorLockMessage(dbPath, propName);
        if (lockMsg) { showStatus(lockMsg); return; }
        _showMsrDropdown(tagContainer, val, entityPath, propName, { ...propTypeConfig, __sourceDbPath: dbPath });
      });
    }
    row.appendChild(tagContainer);
    return row;
  }

  // チャット型
  if (type === 'chat') {
    const container = document.createElement('div');
    container.className = 'chat-prop-cell';
    container.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;align-items:center;';
    const chatPaths = v ? v.split(',').map(s => s.trim()).filter(Boolean) : [];

    if (chatPaths.length === 0) {
      // チャットなし: ＋ボタンのみ
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'db-chat-add-btn';
      addBtn.dataset.e2eId = _typedCellControlE2eId('chat-add', entityPath, propName);
      addBtn.setAttribute('aria-label', 'チャットを追加');
      addBtn.innerHTML = lucide('plus', 12) + ' チャット';
      addBtn.style.cssText = 'display:inline-flex;align-items:center;gap:2px;padding:2px 8px;font-size:11px;background:var(--bg3);color:var(--fg2);border:1px solid var(--border);border-radius:3px;cursor:pointer;';
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const lockMsg = _valueEditorLockMessage(dbPath, propName);
        if (lockMsg) { showStatus(lockMsg); return; }
        _createEntityChat(entityPath, val, propName, dbPath);
      });
      container.appendChild(addBtn);
    } else {
      // チャットあり: チャット名リンク + ＋ボタン
      chatPaths.forEach(cp => {
        const chatName = cp.split('/').pop().replace(/\.md$/, '');
        const link = document.createElement('span');
        link.className = 'chat-prop-link';
        link.textContent = chatName;
        link.dataset.chatPropPath = cp;
        link.dataset.gbTooltipDisabled = 'true';
        link.style.cssText = 'display:inline-flex;align-items:center;gap:2px;padding:1px 6px;font-size:11px;background:var(--bg3);border-radius:3px;cursor:pointer;color:var(--accent);';
        link.innerHTML = '<span style="opacity:0.7;">' + lucide('messagesSquare', 11) + '</span> ' + esc(chatName);
        link.addEventListener('click', (e) => {
          e.stopPropagation();
          _openEntityChat(cp);
        });
        container.appendChild(link);
      });
      // ＋ボタン
      const addMore = document.createElement('button');
      addMore.type = 'button';
      addMore.className = 'db-chat-add-btn db-chat-add-more-btn';
      addMore.dataset.e2eId = _typedCellControlE2eId('chat-add-more', entityPath, propName);
      addMore.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;cursor:pointer;color:var(--fg2);min-width:24px;height:24px;padding:0 6px;background:var(--bg3);border:1px solid var(--border);border-radius:3px;';
      addMore.innerHTML = lucide('plus', 12);
      addMore.title = 'チャットを追加';
      addMore.setAttribute('aria-label', 'チャットを追加');
      addMore.addEventListener('click', (e) => {
        e.stopPropagation();
        const lockMsg = _valueEditorLockMessage(dbPath, propName);
        if (lockMsg) { showStatus(lockMsg); return; }
        _createEntityChat(entityPath, val, propName, dbPath);
      });
      container.appendChild(addMore);
    }
    row.appendChild(container);
    return row;
  }

  // fallback
  return createValueElement(val, entityPath, propName, thumbSize, { ...options, dbPath, filter: filterMode });
}

// マルチソースリレーション値パーサ: "db1::id1, db2::id2" → [{ db, id }]
function _parseMsrValue(v) {
  if (!v) return [];
  return v.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const sep = s.indexOf('::');
    if (sep < 0) return { db: '', id: s };
    return { db: s.substring(0, sep), id: s.substring(sep + 2) };
  });
}

// マルチソースリレーション手動ドロップダウン
async function _showMsrDropdown(anchor, val, entityPath, propName, ptc) {
  const dbPath = ptc.__sourceDbPath || _valueEditorDbPath(entityPath, anchor);
  const ctx = typeof _valueEditorContext === 'function' ? _valueEditorContext(entityPath, anchor, dbPath) : null;
  const lockMsg = _valueEditorLockMessage(dbPath, propName);
  if (lockMsg) { showStatus(lockMsg); return; }
  closeAllDropdowns();
  const sources = ptc.sources || [];
  if (sources.length === 0) { showStatus('ソースシートが設定されていません', true); return; }

  const dd = document.createElement('div');
  dd.className = 'status-dropdown';
  dd.style.cssText = 'max-height:350px;overflow-y:auto;min-width:250px;';
  dd.addEventListener('pointerdown', e => e.stopPropagation());
  dd.addEventListener('click', e => e.stopPropagation());

  // 検索ボックス
  const search = document.createElement('input');
  search.type = 'text'; search.placeholder = 'エントリを検索...';
  search.style.cssText = 'width:100%;padding:4px 6px;margin-bottom:4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;font-size:12px;';
  dd.appendChild(search);

  const currentVals = _parseMsrValue(val?.value || '');
  const initialVals = currentVals.map(v => ({ ...v }));
  const msrValueText = (values) => (values || []).map(v => v.db + '::' + v.id).join(', ');
  let didChange = false;
  const isSelected = (db, id) => currentVals.some(v => v.db === db && v.id === id);

  const listDiv = document.createElement('div');

  // 全ソースDBのエントリをロード
  const allEntries = []; // { db, id, name, label }
  for (const src of sources) {
    if (!src.db) continue;
    try {
      const map = await _getRelationMap(src.db);
      const label = src.label || src.db.split('/').pop();
      for (const [id, name] of Object.entries(map.idToName)) {
        allEntries.push({ db: src.db, id, name, label });
      }
    } catch {}
  }

  const renderList = (filter) => {
    listDiv.innerHTML = '';
    const filtered = filter ? allEntries.filter(e => e.name.toLowerCase().includes(filter.toLowerCase())) : allEntries;

    // ソースDB別にグループ化
    const groups = {};
    filtered.forEach(e => {
      if (!groups[e.db]) groups[e.db] = { label: e.label, entries: [] };
      groups[e.db].entries.push(e);
    });

    for (const [db, group] of Object.entries(groups)) {
      // グループヘッダー
      const header = document.createElement('div');
      header.style.cssText = 'padding:4px 8px;font-size:11px;font-weight:bold;color:var(--fg2);border-bottom:1px solid var(--border);';
      header.textContent = '── ' + group.label + ' ──';
      listDiv.appendChild(header);

      group.entries.forEach(entry => {
        const sel = isSelected(entry.db, entry.id);
        const item = document.createElement('div');
        item.className = 'dd-nav-item';
        item.style.cssText = 'padding:4px 8px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px;';
        if (sel) item.style.background = 'rgba(86,156,214,0.15)';
        item.onmouseenter = () => { item.style.background = 'var(--bg4)'; };
        item.onmouseleave = () => { item.style.background = sel ? 'rgba(86,156,214,0.15)' : ''; };
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = sel;
        item.appendChild(cb);
        item.appendChild(document.createTextNode(entry.name));
        item.addEventListener('click', () => {
          const idx = currentVals.findIndex(v => v.db === entry.db && v.id === entry.id);
          const nextVals = currentVals.slice();
          if (idx >= 0) nextVals.splice(idx, 1); else nextVals.push({ db: entry.db, id: entry.id });
          currentVals.splice(0, currentVals.length, ...nextVals);
          didChange = msrValueText(currentVals) !== msrValueText(initialVals);
          renderList(search.value);
          if (dd.isConnected) search.focus({ preventScroll: true });
        });
        listDiv.appendChild(item);
      });
    }
  };
  renderList('');
  search.oninput = () => renderList(search.value);
  dd.appendChild(listDiv);

  // 確定ボタン
  const doneBtn = document.createElement('div');
  doneBtn.className = 'dd-nav-item';
  doneBtn.style.cssText = 'padding:4px 8px;text-align:center;cursor:pointer;font-size:12px;font-weight:bold;color:var(--accent);border-top:1px solid var(--border);margin-top:4px;';
  doneBtn.innerHTML = lucide('check', 12) + ' 確定';
  const commitMultiSourceRelationDropdown = async () => {
    const oldVal = msrValueText(initialVals);
    const nv = msrValueText(currentVals);
    dd.remove();
    if (!didChange || oldVal === nv) return;
    try {
      if (val?.file) {
        await _apiPutValue(val, { new_value: nv });
        if (typeof _dbUndoValue === 'function') _dbUndoValue(propName, val, oldVal, nv);
        val.value = nv;
      } else {
        const created = await _apiPostValue(entityPath, propName, nv, '採用', '');
        if (val && created) {
          val.file = created.path || created.file || val.file;
          val.property = created.property || propName;
          val.candidate_index = created.candidate_index;
          val.status = val.status || '採用';
          val.value = nv;
        }
      }
      await _valueEditorReload(dbPath, ctx);
    } catch (e) {
      showStatus('保存に失敗: ' + (e?.message || e), true);
      await _valueEditorReload(dbPath, ctx);
    }
  };
  doneBtn._ddActivate = commitMultiSourceRelationDropdown;
  doneBtn.addEventListener('click', commitMultiSourceRelationDropdown);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.altKey)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      commitMultiSourceRelationDropdown();
    }
  });
  dd.appendChild(doneBtn);

  if (typeof _positionCellDropdown === 'function') {
    _positionCellDropdown(dd, anchor, { gap: 2, minWidth: 180 });
  } else {
    const rect = anchor.getBoundingClientRect();
    const _zr = _getZoom();
    dd.style.position = 'fixed'; dd.style.left = (rect.left / _zr) + 'px'; dd.style.top = (rect.bottom / _zr + 2) + 'px';
    document.body.appendChild(dd);
    clampPopupToViewport(dd);
  }
  _enableDropdownKeyNav(dd, '.dd-nav-item');
  search.focus();

  setTimeout(() => {
    const closer = (e) => {
      if (!dd.contains(e.target)) { dd.remove(); document.removeEventListener('pointerdown', closer); }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

// マルチソースリレーション自動収集
async function _autoCollectMultiSourceRelation(entityName, entityData, ptc, dbPath) {
  const results = [];
  const pts = getPropertyTypes(dbPath);

  for (const src of (ptc.sources || [])) {
    if (!src.db) continue;
    try {
      const map = await _getRelationMap(src.db);
      if (!_msrPivotCache[src.db]) {
        _msrPivotCache[src.db] = await apiFetch('/pivot?path=' + encodeURIComponent(src.db));
      }
      const pivotData = _msrPivotCache[src.db];
      const remoteEntities = pivotData.entities || {};

      for (const [remoteName, remoteData] of Object.entries(remoteEntities)) {
        const remoteId = remoteData._id || remoteName;
        let allMatch = true;

        for (const rule of (src.matchRules || [])) {
          if (!rule.myProp || !rule.remoteProp) { allMatch = false; break; }

          // 自DBの値
          const myVals = entityData[rule.myProp] || [];
          const myAdopted = myVals.find(v => v.status === '採用' || v.status === '掲載済み') || myVals[0];
          let myVal = myAdopted?.value || '';

          // 参照先DBの値
          const remoteVals = remoteData[rule.remoteProp] || [];
          const remoteAdopted = remoteVals.find(v => v.status === '採用' || v.status === '掲載済み') || remoteVals[0];
          let remoteVal = remoteAdopted?.value || '';

          if (!myVal || !remoteVal) { allMatch = false; break; }

          // 日付型 or 日付形式の値は日付部分のみで比較
          const myPtc = pts[rule.myProp];
          const isDateLike = (s) => /^\d{4}[-/]\d{2}[-/]\d{2}/.test(s);
          if ((myPtc && myPtc.type === 'date') || (isDateLike(myVal) && isDateLike(remoteVal))) {
            myVal = myVal.substring(0, 10);
            remoteVal = remoteVal.substring(0, 10);
          }

          if (myVal !== remoteVal) { allMatch = false; break; }
        }

        if (allMatch && (src.matchRules || []).length > 0) {
          results.push({ db: src.db, id: remoteId, name: remoteName, label: src.label || src.db.split('/').pop() });
        }
      }
    } catch (e) {
      console.warn('MSR自動収集エラー:', src.db, e);
      throw e;
    }
  }
  return results;
}

// MSR自動収集用のpivotキャッシュ（_autoCollectAllMsrProps実行中のみ有効）
let _msrPivotCache = {};

// 全マルチソースリレーションプロパティの自動収集
async function _autoCollectAllMsrProps(dbPath, ctx) {
  _msrPivotCache = {}; // 実行開始時にクリア
  const pts = getPropertyTypes(dbPath);
  const data = ctx.pivotData || state.pivotData;
  if (!pts || !data?.entities) return;


  const msrProps = Object.entries(pts).filter(([_, cfg]) =>
    cfg.type === 'multi-source-relation' && cfg.mode === 'auto'
  );
  if (msrProps.length === 0) return;
  let changed = false;

  for (const entityName of Object.keys(data.entities)) {
    const entityData = data.entities[entityName];
    for (const [propName, ptc] of msrProps) {
      try {
        const collected = await _autoCollectMultiSourceRelation(entityName, entityData, ptc, dbPath);
        const newValue = collected.map(r => r.db + '::' + r.id).join(', ');

        const vals = entityData[propName] || [];
        const adoptedVal = vals.find(v => {
          const status = v?.status || '採用';
          return status === '採用' || status === '掲載済み';
        }) || null;
        const currentValue = adoptedVal ? (adoptedVal.value || '') : '';
        if (newValue === currentValue) continue;

        const entityPath = _entityPath(dbPath, entityName, data);
        if (adoptedVal) {
          await _apiPutValue(adoptedVal, { new_value: newValue });
          adoptedVal.value = newValue;
        } else if (newValue) {
          const result = await _apiPostValue(entityPath, propName, newValue, '採用', '');
          if (!Array.isArray(entityData[propName])) entityData[propName] = [];
          entityData[propName].push({
            property: propName,
            value: newValue,
            status: '採用',
            note: '',
            file: result?.path,
            candidate_index: result?.candidate_index,
          });
        } else {
          continue;
        }
        changed = true;
      } catch (e) { console.warn('MSR自動収集エラー:', entityName, propName, e); }
    }
  }
  _msrPivotCache = {}; // 実行完了時にクリア
  if (changed && typeof renderPivot === 'function') renderPivot(ctx);
}

// チャットプロパティ: エントリに紐づくチャットを作成
async function _createEntityChat(entityPath, val, propName, dbPath) {
  const sourceDbPath = dbPath || _valueEditorDbPath(entityPath);
  const sourceCtx = typeof _valueEditorContext === 'function' ? _valueEditorContext(entityPath, null, sourceDbPath) : null;
  const lockMsg = _valueEditorLockMessage(sourceDbPath, propName);
  if (lockMsg) { showStatus(lockMsg); return; }
  // セッションID生成
  const now = new Date();
  const pad = (n, d=2) => String(n).padStart(d, '0');
  const sessionId = now.getFullYear() + pad(now.getMonth()+1) + pad(now.getDate()) + '_' +
    pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()) + '_' +
    Math.random().toString(36).slice(2, 6);
  if (typeof _initChatSourceFolderSelector === 'function') await _initChatSourceFolderSelector();
  const sourceFolder = typeof _detectSourceFolderFromPath === 'function' ? _detectSourceFolderFromPath(entityPath) : '';
  const chatPath = typeof _chatSavedPathForSession === 'function' ? _chatSavedPathForSession(sessionId) : ('_chat/llm/' + sessionId + '.md');

  // 空のチャットファイルを保存
  const entityName = entityPath.replace(/\.md$/, '').split('/').pop();
  try {
    const message = { role: 'system', content: 'エントリ「' + entityName + '」のチャット' };
    if (typeof _ensureChatMessageId === 'function') _ensureChatMessageId(message);
    await apiPost('/chat/save', {
      path: chatPath,
      source_folder: sourceFolder,
      provider: localStorage.getItem('chat-provider') || 'gemini',
      model: localStorage.getItem('chat-model') || '',
      messages: [message],
      targetPath: entityPath,
      user: typeof getUsername === 'function' ? getUsername() : '',
    });
  } catch (e) { showStatus('チャット作成に失敗', true); return; }

  // プロパティ値にチャットパスを追加
  const currentPaths = (val?.value || '').split(',').map(s => s.trim()).filter(Boolean);
  currentPaths.push(chatPath);
  const newValue = currentPaths.join(', ');
  try {
    if (val?.file) {
      await _apiPutValue(val, { new_value: newValue });
      val.value = newValue;
    } else {
      await _apiPostValue(entityPath, propName, newValue, '採用', '');
    }
  } catch (e) {
    showStatus('チャットは作成されましたが、エントリへの紐付け保存に失敗: ' + (e?.message || e), true);
    _openEntityChat(chatPath, sourceFolder);
    await _valueEditorReload(sourceDbPath, sourceCtx);
    return;
  }

  showStatus('チャットを作成しました');
  // チャットを開く
  _openEntityChat(chatPath, sourceFolder);
  // DB再描画
  await _valueEditorReload(sourceDbPath, sourceCtx);
}

// チャットプロパティ: 保存済みチャットを開く
function _openEntityChat(chatPath, sourceFolder) {
  // 右パネルを開く（閉じていれば）
  const rp = document.getElementById('right-panel');
  if (rp && rp.classList.contains('collapsed')) {
    const toggle = document.getElementById('btn-right-panel');
    if (toggle) toggle.click();
  }
  // openSavedChat が右パネルのチャットタブを開いてロードする
  if (typeof openSavedChat === 'function') {
    openSavedChat(chatPath, '', sourceFolder);
  }
}

// エントリ単位のチャット起動フック
// 汎用: エントリパスから既存または新規のチャットを開始する
// - 右パネルを開き、openFileChat で targetPath 紐付きチャットを復元または作成
window.openEntityChatForPath = async function openEntityChatForPath(entityPath) {
  if (!entityPath) return;
  const rp = document.getElementById('right-panel');
  if (rp && rp.classList.contains('collapsed')) {
    const toggle = document.getElementById('btn-right-panel');
    if (toggle) toggle.click();
  }
  if (typeof openFileChat === 'function') {
    await openFileChat(entityPath);
  }
};
window.openEntityAiChat = window.openEntityChatForPath;

// ユーザープロパティ: 小型アバター
function _userAvatarSmall(username) {
  // avatar URL は属性だけに入れ、onerror 内にユーザー由来文字列を埋め込まない。
  const teamAvatar = window.MeldexDataAccess?.team?.avatarUrl?.(username || 'anonymous', {}) || ('/api/team/avatar/' + encodeURIComponent(username));
  return '<img src="' + esc(teamAvatar) + '" '
    + 'style="width:16px;height:16px;border-radius:50%;object-fit:cover;vertical-align:middle;" '
    + 'onerror="this.hidden=true;this.nextElementSibling.style.display=\'inline-flex\';">'
    + '<span style="display:none;width:16px;height:16px;border-radius:50%;background:var(--accent);color:var(--ui-fg-strong);font-size:9px;font-weight:bold;align-items:center;justify-content:center;vertical-align:middle;">'
    + esc((username || '?')[0].toUpperCase()) + '</span>';
}

// ユーザー選択ドロップダウン
