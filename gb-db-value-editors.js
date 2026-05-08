/* gb-db-value-editors.js: flattened split script for static cloud hosting. */
/* Source chunk: gb-db-value-editors.part01.js */
/* 型別値エディタ・ドロップダウン — gb-db-property-types.js から分離 */

// 日付値の表示用フォーマット: 時刻部分があれば "YYYY-MM-DD HH:MM" で表示
function _formatDateDisplay(v, ptc) {
  if (typeof _dbDateFormatDisplay === 'function') return _dbDateFormatDisplay(v, ptc);
  if (!v || typeof v !== 'string') return v || '';
  const m = v.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (m) return m[1] + ' ' + m[2];
  return v;
}
// ストア値からinput用の値に変換（datetime-local形式: "YYYY-MM-DDTHH:MM"）
function _toInputDateValue(v, wantTime) {
  if (typeof _dbDateToInputValue === 'function') return _dbDateToInputValue(v, wantTime);
  if (!v || typeof v !== 'string') return '';
  if (wantTime) {
    // datetime-local expects "YYYY-MM-DDTHH:MM"
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return v.substring(0, 16);
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v + 'T00:00';
    return v;
  } else {
    // date input expects "YYYY-MM-DD"
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.substring(0, 10);
    return v;
  }
}

// 型に応じたセル描画
function createTypedValueElement(val, entityPath, propName, thumbSize, propTypeConfig) {
  if (!propTypeConfig || propTypeConfig.type === 'text') {
    return createValueElement(val, entityPath, propName, thumbSize);
  }

  // ボタン型: 値なし、ボタンのみ表示
  if (propTypeConfig.type === 'button') {
    const row = document.createElement('div');
    row.className = 'cell-value';
    const btn = document.createElement('button');
    btn.className = 'db-action-btn';
    btn.textContent = propTypeConfig.label || '実行';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dbPath = state.currentDbPath;
      const entityName = entityPath.replace(/\.md$/, '').split('/').pop();
      _executeButtonActions(dbPath, entityName, propTypeConfig.actions || []);
    });
    row.appendChild(btn);
    return row;
  }

  const row = document.createElement('div');
  row.className = 'cell-value' + (val.status === 'ボツ' ? ' status-botsu' : '');
  _setupCellValueDrag(row, val, entityPath, propName);

  // Status dot（採用状況フィルタ無効時 or DB側でステータス機能 OFF の場合は非表示）
  if (state.filter !== 'disabled' && getStatusEnabled(state.currentDbPath)) {
    const dot = document.createElement('span');
    dot.className = 'status-dot';
    dot.style.background = _getStatusColor(val.status, state.currentDbPath);
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
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
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
      const lockMsg = checkColumnEditable(state.currentDbPath, propName);
      if (lockMsg) { showStatus(lockMsg); return; }
      const isChecked = v === 'true' || v === 'はい' || v === '1' || v === 'yes';
      const nv = isChecked ? 'false' : 'true';
      try {
        await _apiPutValue(val, { new_value: nv });
        _dbUndoValue('チェック: ' + v + ' → ' + nv, val, v, nv);
        val.value = nv;
        cb.textContent = nv === 'true' ? '\u2611' : '\u2610';
        showStatus(nv === 'true' ? '\u2611 チェック' : '\u2610 チェック解除');
        // Step 3: 部分更新化 (checkbox) — 条件付き書式 / フィルタ・グループ・ソート再評価のため
        if (typeof _refreshAfterCellEdit === 'function') _refreshAfterCellEdit(cb, entityPath, propName);
      } catch (e) {}
    });
    row.appendChild(cb);
    return row;
  }

  if (type === 'date') {
    const span = document.createElement('span');
    span.className = 'cell-date value-text';
    span.textContent = _formatDateDisplay(v, propTypeConfig);
    span.addEventListener('click', () => {
      const lockMsg = checkColumnEditable(state.currentDbPath, propName);
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
        span.textContent = _formatDateDisplay(nv || v, propTypeConfig);
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
          } catch (e) { span.textContent = _formatDateDisplay(v, propTypeConfig); }
        }
      };
      editor.root.addEventListener('focusout', (e) => {
        if (editor.contains(e.relatedTarget)) return;
        finish();
      });
      if (!editor.mode?.withTime && !editor.mode?.range && editor.startInput) {
        editor.startInput.addEventListener('change', finish);
      }
      editor.root.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(); }
        if (e.key === 'Escape') { e.preventDefault(); done = true; restoreBtns(); span.textContent = _formatDateDisplay(v, propTypeConfig); }
      });
    });
    row.appendChild(span);
    return row;
  }

  if (type === 'number') {
    const span = document.createElement('span');
    span.className = 'cell-number value-text';
    span.textContent = v;
    span.addEventListener('click', () => startInlineEdit(span, val, entityPath, propName));
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
      showSelectDropdown(span, val, entityPath, propName, propTypeConfig.options || []);
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
    // クリックでインライン編集（カンマ区切り）
    tagContainer.addEventListener('click', (e) => {
      e.stopPropagation();
      const lockMsg = checkColumnEditable(state.currentDbPath, propName);
      if (lockMsg) { showStatus(lockMsg); return; }
      if (tagContainer.querySelector('input')) return;
      tagContainer.innerHTML = '';
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = tags.join(', ');
      inp.style.cssText = 'width:100%;padding:2px 4px;background:var(--bg2);color:var(--fg);border:1px solid var(--accent);border-radius:3px;font-size:12px;';
      tagContainer.appendChild(inp);
      inp.focus();
      inp.select();
      let done = false;
      const finish = async () => {
        if (done) return; done = true;
        const nv = inp.value.trim();
        if (nv === v) { _refreshAfterCellEdit(tagContainer, entityPath, propName); return; }
        try {
          await _apiPutValue(val, { new_value: nv });
          _dbUndoValue(propName + ': ' + v + ' → ' + nv, val, v, nv);
          val.value = nv;
          // Step 3: 部分更新化 (multi-select)
          _refreshAfterCellEdit(tagContainer, entityPath, propName);
        } catch(e) { _refreshAfterCellEdit(tagContainer, entityPath, propName); }
      };
      inp.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); finish(); }
        if (ev.key === 'Escape') { ev.preventDefault(); done = true; _refreshAfterCellEdit(tagContainer, entityPath, propName); }
      });
      inp.addEventListener('blur', finish);
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
      const lockMsg = checkColumnEditable(state.currentDbPath, propName);
      if (lockMsg) { showStatus(lockMsg); return; }
      _showUserDropdown(span, val, entityPath, propName, v, false);
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
      const lockMsg = checkColumnEditable(state.currentDbPath, propName);
      if (lockMsg) { showStatus(lockMsg); return; }
      _showUserDropdown(container, val, entityPath, propName, v, true);
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
    const _relDb = (propTypeConfig.relationDb === '' ? state.currentDbPath : propTypeConfig.relationDb) || '';
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
      const lockMsg = checkColumnEditable(state.currentDbPath, propName);
      if (lockMsg) { showStatus(lockMsg); return; }
      _showRelationDropdown(span, val, entityPath, propName, propTypeConfig, false);
    });
    if (v) span.ondblclick = async (e) => {
      e.stopPropagation();
      const name = _relDb && typeof _resolveRelationName === 'function'
        ? await _resolveRelationName(v, _relDb)
        : _resolveRelationNameSync(v, _relDb);
      navigateToEntity(name, _relDb);
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
    const _relDbM = (propTypeConfig.relationDb === '' ? state.currentDbPath : propTypeConfig.relationDb) || '';
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
        navigateToEntity(name, _relDbM);
      };
      tagContainer.appendChild(tag);
    });
    tagContainer.addEventListener('click', (e) => {
      e.stopPropagation();
      const lockMsg = checkColumnEditable(state.currentDbPath, propName);
      if (lockMsg) { showStatus(lockMsg); return; }
      _showRelationDropdown(tagContainer, val, entityPath, propName, propTypeConfig, true);
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
        if (name && typeof navigateToEntity === 'function') navigateToEntity(name, entry.db);
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
        const lockMsg = checkColumnEditable(state.currentDbPath, propName);
        if (lockMsg) { showStatus(lockMsg); return; }
        _showMsrDropdown(tagContainer, val, entityPath, propName, propTypeConfig);
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
      addBtn.className = 'db-chat-add-btn';
      addBtn.innerHTML = lucide('plus', 12) + ' チャット';
      addBtn.style.cssText = 'display:inline-flex;align-items:center;gap:2px;padding:2px 8px;font-size:11px;background:var(--bg3);color:var(--fg2);border:1px solid var(--border);border-radius:3px;cursor:pointer;';
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const lockMsg = checkColumnEditable(state.currentDbPath, propName);
        if (lockMsg) { showStatus(lockMsg); return; }
        _createEntityChat(entityPath, val, propName);
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
      const addMore = document.createElement('span');
      addMore.style.cssText = 'cursor:pointer;color:var(--fg2);padding:0 2px;';
      addMore.innerHTML = lucide('plus', 12);
      addMore.title = 'チャットを追加';
      addMore.addEventListener('click', (e) => {
        e.stopPropagation();
        const lockMsg = checkColumnEditable(state.currentDbPath, propName);
        if (lockMsg) { showStatus(lockMsg); return; }
        _createEntityChat(entityPath, val, propName);
      });
      container.appendChild(addMore);
    }
    row.appendChild(container);
    return row;
  }

  // fallback
  return createValueElement(val, entityPath, propName, thumbSize);
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
  const lockMsg = checkColumnEditable(state.currentDbPath, propName);
  if (lockMsg) { showStatus(lockMsg); return; }
  closeAllDropdowns();
  const sources = ptc.sources || [];
  if (sources.length === 0) { showStatus('ソースシートが設定されていません', true); return; }

  const dd = document.createElement('div');
  dd.className = 'status-dropdown';
  dd.style.cssText = 'max-height:350px;overflow-y:auto;min-width:250px;';

  // 検索ボックス
  const search = document.createElement('input');
  search.type = 'text'; search.placeholder = 'エントリを検索...';
  search.style.cssText = 'width:100%;padding:4px 6px;margin-bottom:4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;font-size:12px;';
  dd.appendChild(search);

  const currentVals = _parseMsrValue(val?.value || '');
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
          if (idx >= 0) currentVals.splice(idx, 1); else currentVals.push({ db: entry.db, id: entry.id });
          const nv = currentVals.map(v => v.db + '::' + v.id).join(', ');
          const oldVal = val.value || '';
          if (val.file) {
            _apiPutValue(val, { new_value: nv }).then(() => {
              _dbUndoValue(propName, val, oldVal, nv);
            }).catch(() => {});
            renderList(search.value);
          } else {
            // 新規作成後はドロップダウンを閉じてDB再読込（val.file取得のため）
            _apiPostValue(entityPath, propName, nv, '採用', '').then(() => {
              dd.remove();
              if (state.currentDbPath) selectDatabase(state.currentDbPath);
            }).catch(() => {});
          }
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
  doneBtn.style.cssText = 'padding:4px 8px;text-align:center;cursor:pointer;font-size:12px;font-weight:bold;color:var(--accent);border-top:1px solid var(--border);margin-top:4px;';
  doneBtn.innerHTML = lucide('check', 12) + ' 確定';
  doneBtn.addEventListener('click', () => { dd.remove(); if (state.currentDbPath) selectDatabase(state.currentDbPath); });
  dd.appendChild(doneBtn);

  const rect = anchor.getBoundingClientRect();
  const _zr = _getZoom();
  dd.style.position = 'fixed'; dd.style.left = (rect.left / _zr) + 'px'; dd.style.top = (rect.bottom / _zr + 2) + 'px';
  document.body.appendChild(dd);
  clampPopupToViewport(dd);
  _enableDropdownKeyNav(dd, '.dd-nav-item');
  search.focus();

  setTimeout(() => {
    const closer = (e) => {
      if (!dd.contains(e.target)) { dd.remove(); document.removeEventListener('pointerdown', closer); if (state.currentDbPath) selectDatabase(state.currentDbPath); }
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
    } catch (e) { console.warn('MSR自動収集エラー:', src.db, e); }
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
        const currentValue = vals.length > 0 ? vals[0].value : '';
        if (newValue === currentValue) continue;

        const entityPath = _entityPath(dbPath, entityName);
        if (vals.length > 0) {
          await _apiPutValue(vals[0], { new_value: newValue });
          vals[0].value = newValue;
        } else if (newValue) {
          const result = await _apiPostValue(entityPath, propName, newValue, '採用', '');
          entityData[propName] = [{
            property: propName,
            value: newValue,
            status: '採用',
            note: '',
            file: result?.path,
            candidate_index: result?.candidate_index,
          }];
        }
        changed = true;
      } catch (e) { console.warn('MSR自動収集エラー:', entityName, propName, e); }
    }
  }
  _msrPivotCache = {}; // 実行完了時にクリア
  if (changed && typeof renderPivot === 'function') renderPivot(ctx);
}

// チャットプロパティ: エントリに紐づくチャットを作成
async function _createEntityChat(entityPath, val, propName) {
  const lockMsg = checkColumnEditable(state.currentDbPath, propName);
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
    if (state.currentDbPath) selectDatabase(state.currentDbPath);
    return;
  }

  showStatus('チャットを作成しました');
  // チャットを開く
  _openEntityChat(chatPath, sourceFolder);
  // DB再描画
  if (state.currentDbPath) selectDatabase(state.currentDbPath);
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
  // team avatar → auth avatar → フォールバック（頭文字）の順で試す
  const teamAvatar = window.MeldexDataAccess?.team?.avatarUrl?.(username || 'anonymous', {}) || ('/api/team/avatar/' + encodeURIComponent(username));
  const authAvatar = window.MeldexDataAccess?.team?.authAvatarUrl?.(username || 'anonymous', {}) || ('/api/auth/avatar/' + encodeURIComponent(username));
  return '<img src="' + esc(teamAvatar) + '" '
    + 'style="width:16px;height:16px;border-radius:50%;object-fit:cover;vertical-align:middle;" '
    + 'onerror="this.onerror=null;this.src=\'' + esc(authAvatar) + '\';this.addEventListener(\'error\',()=>{this.style.display=\'none\';this.nextElementSibling.style.display=\'inline-flex\';},{once:true});">'
    + '<span style="display:none;width:16px;height:16px;border-radius:50%;background:var(--accent);color:var(--ui-fg-strong);font-size:9px;font-weight:bold;align-items:center;justify-content:center;vertical-align:middle;">'
    + esc((username || '?')[0].toUpperCase()) + '</span>';
}

// ユーザー選択ドロップダウン
async function _showUserDropdown(anchor, val, entityPath, propName, currentValue, isMulti, options) {
  const dropdownOptions = options || {};
  document.querySelectorAll('.user-dropdown').forEach(el => el.remove());

  // チームメンバー（優先）+ 旧auth users（後方互換）をマージ
  let users = [];
  const seen = new Set();
  try {
    const team = await apiFetch('/team');
    if (Array.isArray(team)) {
      team.forEach(m => { if (m.name && !seen.has(m.name)) { seen.add(m.name); users.push({ name: m.name, role: m.role || 'editor', has_avatar: !!m.has_avatar }); } });
    }
  } catch {}
  try {
    const authUsers = await apiFetch('/auth/users');
    if (Array.isArray(authUsers)) {
      authUsers.forEach(u => { if (u.name && !seen.has(u.name)) { seen.add(u.name); users.push(u); } });
    }
  } catch {}

  const dd = document.createElement('div');
  dd.className = 'cell-inline-dd user-dropdown';
  dd.style.cssText = 'position:fixed;z-index:9999;min-width:180px;max-height:300px;overflow-y:auto;background:var(--ui-popup-bg, var(--bg2));border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.3);padding:4px;';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'ユーザーを検索...';
  searchInput.style.cssText = 'width:100%;padding:4px 8px;font-size:12px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;margin-bottom:4px;box-sizing:border-box;';
  dd.appendChild(searchInput);

  const selected = new Set(
    isMulti && currentValue ? currentValue.split(',').map(s => s.trim()).filter(Boolean) : []
  );
  if (!isMulti && currentValue) selected.add(currentValue.trim());

  function renderList(filter) {
    dd.querySelectorAll('.user-option,.user-confirm-btn,.user-clear-btn,.user-empty-msg').forEach(el => el.remove());

    if (users.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'user-empty-msg';
      msg.style.cssText = 'padding:8px;color:var(--fg2);font-size:12px;text-align:center;';
      msg.textContent = 'ユーザーが登録されていません。設定 → チームメンバーから追加してください';
      dd.appendChild(msg);
      return;
    }

    const filtered = filter
      ? users.filter(u => u.name.toLowerCase().includes(filter.toLowerCase()))
      : users;

    filtered.forEach(u => {
      const item = document.createElement('div');
      item.className = 'user-option';
      const isSelected = selected.has(u.name);
      item.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 8px;cursor:pointer;border-radius:3px;font-size:12px;'
        + (isSelected ? 'background:var(--accent);color:var(--ui-fg-strong);' : '');
      item.innerHTML = (isMulti ? '<span style="font-size:11px;">' + (isSelected ? '\u2713' : '\u3000') + '</span> ' : '')
        + _userAvatarSmall(u.name) + ' ' + esc(u.name)
        + '<span style="margin-left:auto;font-size:10px;color:' + (isSelected ? 'color-mix(in srgb, var(--ui-fg-strong) 70%, transparent)' : 'var(--fg2)') + ';">' + esc(u.role || '') + '</span>';
      item.addEventListener('mouseover', () => { if (!isSelected) item.style.background = 'var(--bg3)'; });
      item.addEventListener('mouseout', () => { if (!isSelected) item.style.background = ''; });
      item.addEventListener('click', () => {
        if (isMulti) {
          if (selected.has(u.name)) selected.delete(u.name);
          else selected.add(u.name);
          renderList(searchInput.value);
        } else {
          _saveUserValue(val, entityPath, propName, u.name, anchor, dropdownOptions);
          dd.remove();
        }
      });
      dd.appendChild(item);
    });

    if (isMulti) {
      const confirmBtn = document.createElement('div');
      confirmBtn.className = 'user-confirm-btn';
      confirmBtn.style.cssText = 'padding:4px 8px;margin-top:4px;text-align:center;cursor:pointer;font-size:12px;color:var(--accent);border-top:1px solid var(--border);font-weight:bold;';
      confirmBtn.textContent = '\u2713 確定';
      confirmBtn.addEventListener('click', () => {
        _saveUserValue(val, entityPath, propName, [...selected].join(', '), anchor, dropdownOptions);
        dd.remove();
      });
      dd.appendChild(confirmBtn);
    }

    if (!isMulti && currentValue) {
      const clearBtn = document.createElement('div');
      clearBtn.className = 'user-clear-btn';
      clearBtn.style.cssText = 'padding:4px 8px;text-align:center;cursor:pointer;font-size:11px;color:var(--fg2);border-top:1px solid var(--border);margin-top:4px;';
      clearBtn.textContent = '選択を解除';
      clearBtn.addEventListener('click', () => {
        _saveUserValue(val, entityPath, propName, '', anchor, dropdownOptions);
        dd.remove();
      });
      dd.appendChild(clearBtn);
    }
  }

  searchInput.addEventListener('input', () => renderList(searchInput.value));
  renderList('');

  const rect = anchor.getBoundingClientRect();
  const _zu = _getZoom();
  dd.style.left = (rect.left / _zu) + 'px';
  dd.style.top = (rect.bottom / _zu + 2) + 'px';
  document.body.appendChild(dd);
  clampPopupToViewport(dd);
  _enableDropdownKeyNav(dd, '.user-option');
  searchInput.focus();

  setTimeout(() => {
    document.addEventListener('pointerdown', async function closer(ev) {
      if (!dd.contains(ev.target)) {
        let saved = false;
        if (isMulti) {
          saved = await _saveUserValue(val, entityPath, propName, [...selected].join(', '), anchor, dropdownOptions);
        }
        dd.remove();
        if (!saved && typeof dropdownOptions.onCancel === 'function') dropdownOptions.onCancel();
        document.removeEventListener('pointerdown', closer);
      }
    });
  }, 0);
}

/* Source chunk: gb-db-value-editors.part02.js */
async function _saveUserValue(val, entityPath, propName, newValue, anchorEl, options) {
  const saveOptions = options || {};
  const oldValue = val?.value == null ? '' : String(val.value);
  const nextValue = newValue == null ? '' : String(newValue);
  if (nextValue === oldValue) return false;
  try {
    if (val) {
      await _apiPutValue(val, { new_value: nextValue });
      if (typeof _dbUndoValue === 'function') _dbUndoValue(propName + ': ' + oldValue + ' → ' + nextValue, val, oldValue, nextValue);
      val.value = nextValue;
    } else {
      const status = saveOptions.status || '採用';
      const result = await _apiPostValue(entityPath, propName, nextValue, status, '');
      const filePath = result?.path || '';
      const candIdx = result?.candidate_index;
      if (filePath && typeof historyPush === 'function') {
        historyPush('値追加: ' + propName + '=' + nextValue,
          candIdx != null
            ? async () => { await _apiPutValue({ file: filePath, property: propName, candidate_index: candIdx }, { _delete: true }); if (state.currentDbPath) await selectDatabase(state.currentDbPath, undefined, { silent: true }); }
            : async () => { await apiPost('/outliner/delete', { path: filePath }); if (state.currentDbPath) await selectDatabase(state.currentDbPath, undefined, { silent: true }); },
          async () => { await _apiPostValue(entityPath, propName, nextValue, status, ''); if (state.currentDbPath) await selectDatabase(state.currentDbPath, undefined, { silent: true }); },
          _dbScope()
        );
      }
    }
    // Step 3: 部分更新化 (user/multi-user)
    // val が null (新規追加) の場合は新しいエントリ行が必要なのでフルリロード
    if (!val) {
      if (state.currentDbPath) await selectDatabase(state.currentDbPath, undefined, { silent: true });
    } else {
      _refreshAfterCellEdit(anchorEl, entityPath, propName);
    }
    return true;
  } catch {
    return false;
  }
}

// ペアリレーション自動反映
// sourceId を targetEntity の pairProp に追加/除去する
async function _syncPairRelation(dbPath, targetId, pairPropName, sourceId, adding) {
  const map = await _getRelationMap(dbPath);
  const targetName = map.idToName[targetId] || targetId;
  const targetPath = _entityPath(dbPath, targetName);
  try {
    const targetData = await apiFetch('/pivot?path=' + encodeURIComponent(dbPath));
    const entData = targetData.entities?.[targetName];
    if (!entData) return;
    const pairVals = entData[pairPropName] || [];
    const pairVal = pairVals[0];
    if (!pairVal) {
      // ペアプロパティに値がまだない場合は新規作成
      if (adding) {
        await _apiPostValue(targetPath, pairPropName, sourceId, '採用', '');
      }
      return;
    }
    const currentIds = (pairVal.value || '').split(',').map(s => s.trim()).filter(Boolean);
    if (adding) {
      if (!currentIds.includes(sourceId)) currentIds.push(sourceId);
    } else {
      const idx = currentIds.indexOf(sourceId);
      if (idx >= 0) currentIds.splice(idx, 1);
    }
    await _apiPutValue(pairVal, { new_value: currentIds.join(', ') });
  } catch (e) {
    console.warn('ペアリレーション同期に失敗:', e);
    throw e;
  }
}

// 循環参照チェック（A→B→C→Aを検出）
async function _checkCircularDependency(dbPath, sourceId, targetId, propName) {
  const visited = new Set([sourceId]);
  const queue = [targetId];
  try {
    const data = await apiFetch('/pivot?path=' + encodeURIComponent(dbPath));
    const map = await _getRelationMap(dbPath);
    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) return true; // 循環検出
      visited.add(current);
      const name = map.idToName[current] || current;
      const entData = data.entities?.[name];
      if (!entData) continue;
      const vals = entData[propName] || [];
      const v = vals[0]?.value || '';
      v.split(',').map(s => s.trim()).filter(Boolean).forEach(id => {
        if (!visited.has(id)) queue.push(id);
      });
    }
  } catch {}
  return false;
}

// リレーションドロップダウン（参照先DBのエントリ一覧）
async function _showRelationDropdown(el, val, entityPath, propName, ptc, isMulti) {
  closeAllDropdowns();
  const isSelfRef = (ptc.relationDb === '' && ptc.relationDb !== undefined);
  const relDb = isSelfRef ? state.currentDbPath : (ptc.relationDb || '');
  if (!relDb) { showStatus('参照先シートが設定されていません。プロパティ型設定で指定してください。', true); return; }

  // 参照先DBのエントリ一覧（ID付き）を取得
  let entryList = []; // { name, id }
  let refEntities = {};
  try {
    const map = await _getRelationMap(relDb);
    refEntities = map.entities || {};
    entryList = Object.entries(map.idToName).map(([id, name]) => ({ name, id }));
  } catch { showStatus('参照先シートの読み込みに失敗: ' + relDb, true); return; }

  // カスケード絞り込み
  if (ptc.cascadeFrom) {
    const parentValue = _getCurrentEntityValue(entityPath, ptc.cascadeFrom);
    if (parentValue) {
      entryList = entryList.filter(entry => {
        const entData = refEntities[entry.name];
        if (!entData) return false;
        const cascadeVals = entData[ptc.cascadeKey] || [];
        return cascadeVals.some(v => {
          const val = v.value || '';
          return val.split(',').map(s => s.trim()).includes(parentValue);
        });
      });
    }
  }
  // 自己参照時: 自分自身を除外
  if (isSelfRef && entityPath) {
    const selfName = entityPath.replace(/\.md$/, '').split('/').pop();
    const selfMap = _relationCache[relDb];
    const selfId = selfMap ? (selfMap.nameToId[selfName] || selfName) : selfName;
    entryList = entryList.filter(e => e.id !== selfId && e.name !== selfName);
  }
  entryList.sort((a, b) => a.name.localeCompare(b.name));

  const dd = document.createElement('div');
  dd.className = 'status-dropdown';
  dd.style.cssText = 'max-height:300px;overflow-y:auto;min-width:200px;';

  // 検索ボックス
  const search = document.createElement('input');
  search.type = 'text'; search.placeholder = 'エントリを検索...';
  search.style.cssText = 'width:100%;padding:4px 6px;margin-bottom:4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;font-size:12px;';
  dd.appendChild(search);

  const currentVals = isMulti ? ((val?.value) || '').split(',').map(s => s.trim()).filter(Boolean) : [(val?.value) || ''];
  let didChange = false;

  const listDiv = document.createElement('div');
  const renderList = (filter) => {
    listDiv.innerHTML = '';
    const filtered = filter ? entryList.filter(e => e.name.toLowerCase().includes(filter.toLowerCase())) : entryList;
    filtered.forEach(entry => {
      const isSelected = currentVals.includes(entry.id) || currentVals.includes(entry.name);
      const item = document.createElement('div');
      item.className = 'dd-nav-item';
      item.style.cssText = 'padding:4px 8px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px;';
      if (isSelected) item.style.background = 'rgba(86,156,214,0.15)';
      item.onmouseenter = () => { item.style.background = 'var(--bg4)'; };
      item.onmouseleave = () => { item.style.background = isSelected ? 'rgba(86,156,214,0.15)' : ''; };
      if (isMulti) {
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = isSelected;
        item.appendChild(cb);
      }
      item.appendChild(document.createTextNode(entry.name));
      item.addEventListener('click', async () => {
        const oldVal = val.value || '';
        const hasPair = ptc.pairWith && isSelfRef;
        const bidirectionalCtx = ptc.bidirectional ? { entityPath, propName, ptc } : null;
        let selfId = '';
        if (hasPair) {
          const selfName = entityPath.replace(/\.md$/, '').split('/').pop();
          const selfMap = _relationCache[relDb];
          selfId = selfMap ? (selfMap.nameToId[selfName] || selfName) : selfName;
        }
        if (isMulti) {
          const idx = currentVals.findIndex(v => v === entry.id || v === entry.name);
          const adding = idx < 0;
          const nextVals = [...currentVals];
          if (idx >= 0) nextVals.splice(idx, 1); else nextVals.push(entry.id);
          const nv = nextVals.join(', ');
          let cascadeClears = [];
          try {
            cascadeClears = await _clearCascadeDependentValues(entityPath, propName, oldVal, nv);
          } catch (e) {
            showStatus('カスケード依存値の更新に失敗: ' + (e?.message || e), true);
            return;
          }
          try {
            await _apiPutValue(val, { new_value: nv });
          } catch (e) {
            await _restoreCascadeDependentValues(entityPath, cascadeClears);
            showStatus('リレーション値の保存に失敗: ' + (e?.message || e), true);
            if (state.currentDbPath) selectDatabase(state.currentDbPath, undefined, { silent: true });
            return;
          }
          currentVals.splice(0, currentVals.length, ...nextVals);
          _upsertLocalPivotValue(entityPath, propName, val, nv);
          didChange = true;
          let syncError = null;
          try {
            if (hasPair) {
              _relationCache[relDb] = null;
              await _syncPairRelation(relDb, entry.id, ptc.pairWith, selfId, adding);
              if (adding) {
                const circular = await _checkCircularDependency(relDb, selfId, entry.id, propName);
                if (circular) showStatus('⚠ 循環依存が検出されました', true);
              }
            }
            if (bidirectionalCtx && typeof _applyBidirectionalRelationSync === 'function') {
              await _applyBidirectionalRelationSync({
                sourceDbPath: state.currentDbPath,
                entityPath,
                propName,
                ptc,
                oldValue: oldVal,
                newValue: nv,
              });
            }
          } catch (e) {
            syncError = e;
          }
          if (syncError) {
            try { await _apiPutValue(val, { new_value: oldVal }); } catch {}
            currentVals.splice(0, currentVals.length, ...oldVal.split(',').map(s => s.trim()).filter(Boolean));
            _upsertLocalPivotValue(entityPath, propName, val, oldVal);
            if (cascadeClears.length && typeof _restoreCascadeDependentValues === 'function') {
              try { await _restoreCascadeDependentValues(entityPath, cascadeClears); } catch {}
            }
            showStatus('リレーション同期に失敗: ' + (syncError?.message || syncError), true);
            renderList(search.value);
            return;
          }
          // Undo: ペア込みで両方戻す
          _dbUndoPairValue(propName, val, oldVal, nv, hasPair ? relDb : null, hasPair ? entry.id : null, hasPair ? ptc.pairWith : null, selfId, !hasPair ? false : (idx < 0), null, entityPath, cascadeClears, bidirectionalCtx);
          renderList(search.value);
        } else {
          if (oldVal === entry.id || oldVal === entry.name) { closeDropdown(); return; }
          let cascadeClears = [];
          try {
            cascadeClears = await _clearCascadeDependentValues(entityPath, propName, oldVal, entry.id);
          } catch (e) {
            showStatus('カスケード依存値の更新に失敗: ' + (e?.message || e), true);
            return;
          }
          try {
            await _apiPutValue(val, { new_value: entry.id });
          } catch (e) {
            await _restoreCascadeDependentValues(entityPath, cascadeClears);
            showStatus('リレーション値の保存に失敗: ' + (e?.message || e), true);
            if (state.currentDbPath) selectDatabase(state.currentDbPath, undefined, { silent: true });
            return;
          }
          _upsertLocalPivotValue(entityPath, propName, val, entry.id);
          didChange = true;
          let syncError = null;
          try {
            if (hasPair) {
              _relationCache[relDb] = null;
              if (oldVal) await _syncPairRelation(relDb, oldVal, ptc.pairWith, selfId, false);
              await _syncPairRelation(relDb, entry.id, ptc.pairWith, selfId, true);
            }
            if (bidirectionalCtx && typeof _applyBidirectionalRelationSync === 'function') {
              await _applyBidirectionalRelationSync({
                sourceDbPath: state.currentDbPath,
                entityPath,
                propName,
                ptc,
                oldValue: oldVal,
                newValue: entry.id,
              });
            }
          } catch (e) {
            syncError = e;
          }
          if (syncError) {
            try { await _apiPutValue(val, { new_value: oldVal }); } catch {}
            _upsertLocalPivotValue(entityPath, propName, val, oldVal);
            if (cascadeClears.length && typeof _restoreCascadeDependentValues === 'function') {
              try { await _restoreCascadeDependentValues(entityPath, cascadeClears); } catch {}
            }
            showStatus('リレーション同期に失敗: ' + (syncError?.message || syncError), true);
            closeDropdown();
            if (state.currentDbPath) selectDatabase(state.currentDbPath, undefined, { silent: true });
            return;
          }
          _dbUndoPairValue(propName, val, oldVal, entry.id, hasPair ? relDb : null, hasPair ? entry.id : null, hasPair ? ptc.pairWith : null, selfId, true, hasPair ? oldVal : null, entityPath, cascadeClears, bidirectionalCtx);
          closeDropdown();
          await _finalizeRelationCellUpdate(el, entityPath, propName, ptc, cascadeClears.map(c => c.propName));
        }
      });
      listDiv.appendChild(item);
    });
  };
  renderList('');
  search.oninput = () => renderList(search.value);
  dd.appendChild(listDiv);

  // 複数選択の確定ボタン
  if (isMulti) {
    const doneBtn = document.createElement('div');
    doneBtn.style.cssText = 'padding:4px 8px;text-align:center;cursor:pointer;font-size:12px;font-weight:bold;color:var(--accent);border-top:1px solid var(--border);margin-top:4px;';
    doneBtn.innerHTML = lucide('check', 12) + ' 確定';
    doneBtn.addEventListener('click', async () => {
      closeDropdown();
      if (didChange) {
        const cascadeProps = _getCascadeDependents(propName).map(dep => dep.propName);
        await _finalizeRelationCellUpdate(el, entityPath, propName, ptc, cascadeProps);
      }
    });
    dd.appendChild(doneBtn);
  }

  let closer = null;
  const closeDropdown = () => {
    if (dd.parentNode) dd.remove();
    if (closer) {
      document.removeEventListener('pointerdown', closer);
      closer = null;
    }
  };
  const rect = el.getBoundingClientRect();
  const _zr = _getZoom();
  dd.style.position = 'fixed'; dd.style.left = (rect.left / _zr) + 'px'; dd.style.top = (rect.bottom / _zr + 2) + 'px';
  document.body.appendChild(dd);
  clampPopupToViewport(dd);
  _enableDropdownKeyNav(dd, '.dd-nav-item');
  search.focus();

  setTimeout(() => {
    closer = async (e) => {
      if (!dd.contains(e.target)) {
        closeDropdown();
        if (isMulti && didChange) {
          const cascadeProps = _getCascadeDependents(propName).map(dep => dep.propName);
          await _finalizeRelationCellUpdate(el, entityPath, propName, ptc, cascadeProps);
        }
      }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

// Select型ドロップダウン
function showSelectDropdown(el, val, entityPath, propName, options) {
  const lockMsg = checkColumnEditable(state.currentDbPath, propName);
  if (lockMsg) { showStatus(lockMsg); return; }
  closeAllDropdowns();
  const dd = document.createElement('div');
  dd.className = 'status-dropdown';

  // 解除（値をクリア）
  const clearItem = document.createElement('div');
  clearItem.className = 'status-dropdown-item';
  clearItem.style.cssText = 'color:var(--fg2);font-style:italic;';
  clearItem.textContent = '解除';
  clearItem.addEventListener('click', async () => {
    closeAllDropdowns();
    if (val.value) {
      const oldVal = val.value;
      const savedStatus = val.status || '案';
      const savedNote = val.note || '';
      let currentVal = { ...val };
      try {
        await _apiPutValue(val, { _delete: true });
        historyPush('値解除: ' + propName + '=' + oldVal,
          async () => {
            const result = await _apiPostValue(entityPath, propName, oldVal, savedStatus, savedNote);
            if (result) {
              currentVal = {
                file: result.path || currentVal.file,
                property: propName,
                candidate_index: result.candidate_index,
                value: oldVal,
                status: savedStatus,
                note: savedNote,
              };
            }
            if (state.currentDbPath) await selectDatabase(state.currentDbPath, undefined, { silent: true });
          },
          async () => {
            await _apiPutValue(currentVal, { _delete: true });
            if (state.currentDbPath) await selectDatabase(state.currentDbPath, undefined, { silent: true });
          },
          _dbScope()
        );
        // Step 3: 部分更新化 (select 解除) — 削除済み val をローカル pivotData から除去
        _removeLocalPivotValue(val, entityPath, propName);
        _refreshAfterCellEdit(el, entityPath, propName);
      } catch (e) {}
    }
  });
  dd.appendChild(clearItem);

  options.forEach(opt => {
    const item = document.createElement('div');
    item.className = 'status-dropdown-item';
    item.textContent = opt;
    if (val.value === opt) item.classList.add('selected');
    item.addEventListener('click', async () => {
      closeAllDropdowns();
      if (opt !== val.value) {
        const oldVal = val.value || '';
        try {
          await _apiPutValue(val, { new_value: opt });
          _dbUndoValue(propName + ': ' + oldVal + ' → ' + opt, val, oldVal, opt);
          val.value = opt;
          // Step 3: 部分更新化 (select 値変更)
          _refreshAfterCellEdit(el, entityPath, propName);
        } catch (e) {}
      }
    });
    dd.appendChild(item);
  });

  const rect = el.getBoundingClientRect();
  const _zs = _getZoom();
  dd.style.position = 'fixed';
  dd.style.left = (rect.left / _zs) + 'px';
  dd.style.top = (rect.bottom / _zs + 2) + 'px';
  document.body.appendChild(dd);
  clampPopupToViewport(dd);
  _enableDropdownKeyNav(dd, '.status-dropdown-item');
  setTimeout(() => {
    const closer = (e) => {
      if (!dd.contains(e.target)) { closeAllDropdowns(); document.removeEventListener('pointerdown', closer); }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}


function _showAutoFillStatusInput(dbPath, propName, ptc, currentValue) {
  closeColHeaderMenu();
  const currentText = (currentValue && typeof currentValue === 'object')
    ? JSON.stringify(currentValue, null, 2)
    : (currentValue || '');
  // インラインモーダル（prompt()禁止のため）
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="width:350px;padding:16px;">
      <div style="font-size:14px;font-weight:bold;margin-bottom:8px;">ステータス連動設定</div>
      <div style="font-size:12px;color:var(--fg2);margin-bottom:12px;">
        どのステータスに変更されたとき、この日付プロパティに現在日時を自動入力しますか？<br>
        空にすると自動入力を解除します。
      </div>
      <input id="_autoFillStatusInput" type="text" value="${esc(currentText)}" placeholder="例: 撮影済み, 確認済み"
        style="width:100%;padding:6px 8px;font-size:13px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;box-sizing:border-box;margin-bottom:12px;">
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button style="padding:4px 12px;font-size:12px;cursor:pointer;background:var(--bg3);color:var(--fg);border:1px solid var(--border);border-radius:4px;"
          data-action="this.closest('.modal-overlay').remove()">キャンセル</button>
        <button id="_autoFillStatusOk" style="padding:4px 12px;font-size:12px;cursor:pointer;background:var(--accent);color:var(--ui-fg-strong);border:none;border-radius:4px;">設定</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const input = document.getElementById('_autoFillStatusInput');
  input.focus();
  input.select();

  const confirm = () => {
    const raw = input.value.trim();
    const newPtc = { ...ptc };
    let nextValue = raw;
    if (raw && /^[{\[]/.test(raw)) {
      try { nextValue = JSON.parse(raw); }
      catch (e) { showStatus('JSON形式の自動入力設定が不正です', true); return; }
    }
    if (raw) {
      newPtc.autoFillOnStatus = nextValue;
    } else {
      delete newPtc.autoFillOnStatus;
    }
    setPropertyType(dbPath, propName, newPtc);
    showStatus(raw ? 'ステータス連動自動入力を設定' : '自動入力を解除');
    overlay.remove();
  };

  document.getElementById('_autoFillStatusOk').addEventListener('click', confirm);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirm(); });
}

