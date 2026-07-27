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

function _valueEditorDbPath(entityPath, anchorEl) {
  const fromEntity = typeof _dbPathFromEntityPath === 'function' ? _dbPathFromEntityPath(entityPath) : '';
  if (fromEntity) return fromEntity;
  if (typeof _dbPivotContextFromTarget === 'function' && typeof _dbPivotPathForContext === 'function') {
    const ctx = _dbPivotContextFromTarget(anchorEl, { entityPath });
    const fromCtx = _dbPivotPathForContext(ctx, '');
    if (fromCtx) return fromCtx;
  }
  return state.currentDbPath || '';
}

function _valueEditorContext(entityPath, anchorEl, dbPath) {
  const targetDbPath = dbPath || _valueEditorDbPath(entityPath, anchorEl);
  if (typeof _dbPivotContextFromTarget === 'function') {
    const ctx = _dbPivotContextFromTarget(anchorEl, { entityPath, dbPath: targetDbPath });
    if (ctx) return ctx;
  }
  if (targetDbPath && typeof _dbFindPaneContextForPath === 'function') {
    const ctx = _dbFindPaneContextForPath(targetDbPath);
    if (ctx) return ctx;
  }
  return typeof _currentPaneState === 'function' ? _currentPaneState() : null;
}

function _typedCellControlE2eId(kind, entityPath, propName) {
  const token = (typeof _dbE2eToken === 'function')
    ? _dbE2eToken
    : (value) => String(value == null ? '' : value)
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}_-]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'item';
  return `db-cell-${token(kind)}-${token(entityPath)}-${token(propName)}`;
}

function _valueEditorLockMessage(dbPath, propName) {
  return typeof checkColumnEditable === 'function' ? checkColumnEditable(dbPath, propName) : '';
}

function _valueEditorReload(dbPath, ctx) {
  if (!dbPath || typeof selectDatabase !== 'function') return undefined;
  const reloadCtx = ctx || (typeof _dbFindPaneContextForPath === 'function' ? _dbFindPaneContextForPath(dbPath) : null);
  return selectDatabase(dbPath, reloadCtx || undefined, { silent: true });
}

function _startNumberValueEdit(span, val, entityPath, propName, dbPath) {
  const lockMsg = _valueEditorLockMessage(dbPath, propName);
  if (lockMsg) { showStatus(lockMsg); return; }
  if (span.querySelector('input')) return;
  const old = typeof _cellUiValueToString === 'function' ? _cellUiValueToString(val.value) : String(val.value || '');
  const editedTd = span.closest('td');
  const editedRoot = editedTd?.closest?.('.gb-pane') || editedTd?.closest?.('.gb-pane-content') || document;
  const restoreEditedCellSelection = (afterRender = false) => {
    const restore = () => {
      const target = typeof _cellUiResolveRenderedCell === 'function'
        ? _cellUiResolveRenderedCell(editedTd, entityPath, propName, editedRoot)
        : editedTd;
      if (target && typeof setActiveCell === 'function') setActiveCell(target, { scroll: false });
    };
    restore();
    if (!afterRender) return;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restore);
    setTimeout(restore, 80);
  };
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'value-input cell-number-input';
  input.value = old;
  input.style.cssText = 'width:100%;padding:2px 4px;background:var(--bg2);color:var(--fg);border:1px solid var(--accent);border-radius:3px;font-size:12px;';
  span.textContent = '';
  span.appendChild(input);
  input.focus();
  input.select();
  let done = false;
  const restore = () => { span.textContent = old; restoreEditedCellSelection(); };
  const finish = () => {
    if (done) return;
    done = true;
    const nv = input.value.trim();
    if (nv && !Number.isFinite(Number(nv))) {
      showStatus('数値として保存できません', true);
      restore();
      return;
    }
    if (nv === old) { restore(); return; }
    span.textContent = nv;
    restoreEditedCellSelection();
    const saveRef = { ...val };
    val.value = nv;
    const save = async () => {
      try {
        await _apiPutValue(saveRef, { new_value: nv });
        if (typeof _syncValueRefAfterSave === 'function') _syncValueRefAfterSave(saveRef, val);
        else if (saveRef.file) val.file = saveRef.file;
        if (typeof _dbUndoValue === 'function') _dbUndoValue(propName + ': ' + old + ' → ' + nv, val, old, nv);
        if (typeof _refreshAfterCellEdit === 'function') _refreshAfterCellEdit(span, entityPath, propName);
        restoreEditedCellSelection(true);
      } catch (e) {
        val.value = old;
        showStatus('保存に失敗: ' + (e?.message || e), true);
        restore();
      }
    };
    if (typeof _cellUiScheduleAfterPaint === 'function') {
      _cellUiScheduleAfterPaint(save);
    } else if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(save));
    } else {
      setTimeout(save, 0);
    }
  };
  if (typeof attachInlineBlurCommit === 'function') attachInlineBlurCommit(input, finish);
  else input.addEventListener('blur', finish);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); finish(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); done = true; restore(); }
  });
}

// 型に応じたセル描画
// 共通タグ型セル表示: 値はタグID配列(カンマ区切り文字列)。タグの名前・色は
// .meldex/global-tags.json 側のカタログを非同期取得して解決する（キャッシュ付き）。
// 解除済み/削除済みのタグIDは表示をスキップする（積極的な掃除はしない）。
function createCommonTagsValueElement(rawValue, entityPath, propName) {
  const tagIds = String(rawValue || '').split(',').map(s => s.trim()).filter(Boolean);
  const container = document.createElement('div');
  container.className = 'multi-select-tags common-tags-cell';
  container.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;cursor:pointer;min-height:16px;';
  const api = (typeof window !== 'undefined') ? window.MeldexGlobalTags : null;
  if (tagIds.length && api && typeof api.loadTagsCached === 'function') {
    api.loadTagsCached().then(data => {
      if (!container.isConnected) return;
      const allTags = Array.isArray(data?.tags) ? data.tags : [];
      const groups = Array.isArray(data?.groups) ? data.groups : [];
      const groupsById = Object.fromEntries(groups.map(g => [g.id, g]));
      const tagsById = Object.fromEntries(allTags.map(t => [String(t.id), t]));
      container.textContent = '';
      tagIds.forEach(id => {
        const tag = tagsById[id];
        if (!tag) return; // 削除済み等の無効IDは表示をスキップ
        const chip = document.createElement('span');
        chip.className = 'multi-select-tag common-tags-tag';
        chip.textContent = tag.name || '';
        const color = typeof api.effectiveTagColor === 'function' ? api.effectiveTagColor(tag, groupsById) : '';
        if (color && /^var\(--[-\w]+\)$/.test(color)) {
          chip.style.background = color;
        } else if (color && typeof applyDbOptionChipColor === 'function') {
          applyDbOptionChipColor(chip, color);
        }
        container.appendChild(chip);
      });
    }).catch(() => {});
  }
  container.addEventListener('click', (e) => {
    e.stopPropagation();
    const td = container.closest('td[data-prop-name]');
    const tr = container.closest('tr[data-entity-name]');
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
  return container;
}

function createTypedValueElement(val, entityPath, propName, thumbSize, propTypeConfig, options = {}) {
  const dbPath = options.dbPath || _valueEditorDbPath(entityPath);
  const filterMode = options.filter ?? options.ctx?.filter ?? (dbPath === state.currentDbPath ? state.filter : 'disabled');
  if (!propTypeConfig || propTypeConfig.type === 'text') {
    return createValueElement(val, entityPath, propName, thumbSize, { ...options, dbPath, filter: filterMode });
  }
  const type = propTypeConfig.type;

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

  // リレーションはロールアップの参照可否にも使うため、常にステータスを変更できるようにする。
  // その他の型は、採用状況フィルタ使用時または候補値が複数ある場合だけ表示する。
  const relationStatusEditable = type === 'relation' || type === 'multi-relation';
  if (relationStatusEditable || (filterMode !== 'disabled' && getStatusEnabled(dbPath)) || options.forceStatusDot) {
    const dot = document.createElement('span');
    dot.className = 'status-dot';
    dot.style.background = _getStatusColor(val.status, dbPath);
    dot.title = val.status || '案';
    dot._dbStatusDropdownArgs = { val, entityPath, propName };
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
  if (type === 'image' && typeof createImagePropertyValueElement === 'function') {
    row.appendChild(createImagePropertyValueElement(val, entityPath, propName, thumbSize, propTypeConfig, options));
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

  if (type === 'color') {
    const swatch = document.createElement('span');
    swatch.className = 'cell-color-swatch value-text';
    const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
    const applyColor = (hex) => {
      const ok = HEX.test(String(hex || '').trim());
      swatch.style.background = ok ? hex.trim() : '';
      swatch.classList.toggle('is-empty', !ok);
      swatch.textContent = ok ? '' : '色を設定';
      if (ok) swatch.title = hex.trim(); else swatch.removeAttribute('title');
    };
    applyColor(v);
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      const lockMsg = _valueEditorLockMessage(dbPath, propName);
      if (lockMsg) { showStatus(lockMsg); return; }
      if (typeof openColorPalette !== 'function') return;
      let saveTimer = null;
      openColorPalette(swatch, v || '', (color) => {
        applyColor(color); // ライブでスウォッチへ反映
        clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
          const nv = HEX.test(String(color || '').trim()) ? color.trim() : '';
          if (nv === (v || '')) return;
          try {
            const hasExisting = val?.file && val.candidate_index != null;
            if (hasExisting) {
              await _apiPutValue(val, { new_value: nv });
              _dbUndoValue(propName + ': ' + (v || '') + ' → ' + nv, val, v, nv);
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
            if (typeof _refreshAfterCellEdit === 'function') _refreshAfterCellEdit(swatch, entityPath, propName);
          } catch (err) { showStatus('保存に失敗: ' + (err?.message || err), true); }
        }, 250);
      });
    });
    row.appendChild(swatch);
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

  if (type === 'link' && typeof createDbLinkValueElement === 'function') {
    row.appendChild(createDbLinkValueElement(val, entityPath, propName, thumbSize, propTypeConfig, { ...options, dbPath }));
    return row;
  }

  if (type === 'select') {
    const span = document.createElement('span');
    span.className = 'cell-select-val';
    span.textContent = v;
    span.style.cursor = 'pointer';
    if (typeof applyDbOptionChipColor === 'function' && typeof getDbOptionColor === 'function') {
      applyDbOptionChipColor(span, getDbOptionColor(propTypeConfig, v));
    }
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
      if (typeof applyDbOptionChipColor === 'function' && typeof getDbOptionColor === 'function') {
        applyDbOptionChipColor(tag, getDbOptionColor(propTypeConfig, t));
      }
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

  if (type === 'common-tags') {
    row.appendChild(createCommonTagsValueElement(v, entityPath, propName));
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
      const srcIdx = sources.findIndex((s, index) =>
        (_msrRuntimeSourceId(s, index) === entry.sourceId)
        || (!entry.sourceId && s.db === entry.db));
      const source = srcIdx >= 0 ? sources[srcIdx] : null;
      const sheetLabel = entry.db.split('/').pop() || '?';
      const detailLabel = source?.label || (_msrSourceKind(source) === 'relation' ? source?.relationProp : '');
      const label = detailLabel ? sheetLabel + '/' + detailLabel : sheetLabel;
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

function _msrSourceKind(source) {
  return source?.kind === 'relation' ? 'relation' : 'sheet';
}

function _msrRuntimeSourceId(source, index) {
  if (source?.sourceId) return source.sourceId;
  const seed = [_msrSourceKind(source), source?.db || '', source?.relationProp || '', source?.label || '', index].join('|');
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 'msr-legacy-' + (hash >>> 0).toString(36);
}

function _msrCanonicalValue(values) {
  return (values || []).map(value => {
    const base = [value.db || '', value.id || ''].join('::');
    return value.sourceId ? base + '::' + value.sourceId : base;
  }).join(', ');
}

function _msrAdoptedValues(values) {
  return (Array.isArray(values) ? values : []).filter(value => {
    const status = value?.status || '採用';
    return status === '採用' || status === '掲載済み';
  });
}

function _msrRelationValueReferences(values, currentId, currentName) {
  const expected = new Set([String(currentId || ''), String(currentName || '')].filter(Boolean));
  return _msrAdoptedValues(values).some(value =>
    String(value?.value || '').split(',').map(item => item.trim()).filter(Boolean).some(item => expected.has(item))
  );
}

function _msrCurrentEntityIdentity(entityPath, dbPath, ctx) {
  const name = typeof _getPivotEntityName === 'function'
    ? _getPivotEntityName(entityPath)
    : String(entityPath || '').split('/').pop().replace(/\.md$/i, '');
  const data = ctx?.pivotData || state.pivotData;
  const entityData = data?.entities?.[name] || {};
  return { name, id: entityData._id || name };
}

// canonical: "db::entryId::sourceId"。旧 "db::entryId" も読み取る。
function _parseMsrValue(v) {
  if (!v) return [];
  return v.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const parts = s.split('::');
    if (parts.length < 2) return { db: '', id: s, sourceId: '' };
    return { db: parts[0], id: parts[1], sourceId: parts.slice(2).join('::') };
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
  const hadLegacyValues = currentVals.some(value => !value.sourceId);
  currentVals.forEach(value => {
    if (value.sourceId) return;
    const sourceIndex = sources.findIndex(source => source.db === value.db);
    value.sourceId = sourceIndex >= 0
      ? _msrRuntimeSourceId(sources[sourceIndex], sourceIndex)
      : _msrRuntimeSourceId({ kind: 'sheet', db: value.db }, -1);
  });
  const initialVals = currentVals.map(v => ({ ...v }));
  const msrValueText = _msrCanonicalValue;
  let didChange = false;
  const isSelected = (db, id, sourceId) => currentVals.some(v =>
    v.db === db && v.id === id && (v.sourceId ? v.sourceId === sourceId : true));

  const listDiv = document.createElement('div');

  // 全ソースDBのエントリをロード
  const allEntries = []; // { db, id, name, label, sourceId, dangling? }
  const currentIdentity = _msrCurrentEntityIdentity(entityPath, dbPath, ctx);
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
    const src = sources[sourceIndex];
    if (!src.db) continue;
    const sourceId = _msrRuntimeSourceId(src, sourceIndex);
    try {
      const map = await _getRelationMap(src.db);
      const sheetName = src.db.split('/').pop();
      const detailLabel = src.label || (_msrSourceKind(src) === 'relation' ? src.relationProp : '');
      const label = detailLabel ? sheetName + '/' + detailLabel : sheetName;
      for (const [id, name] of Object.entries(map.idToName)) {
        if (_msrSourceKind(src) === 'relation') {
          const remoteData = map.entities?.[name] || {};
          if (!src.relationProp
            || !_msrRelationValueReferences(remoteData[src.relationProp], currentIdentity.id, currentIdentity.name)) continue;
        }
        allEntries.push({ db: src.db, id, name, label, sourceId });
      }
    } catch (error) {
      console.warn('マルチソースリレーションの候補を読み込めませんでした:', src.db, error);
    }
  }
  for (const selected of currentVals) {
    const selectedSourceIndex = sources.findIndex((source, index) =>
      (_msrRuntimeSourceId(source, index) === selected.sourceId)
      || (!selected.sourceId && source.db === selected.db));
    const selectedSource = selectedSourceIndex >= 0 ? sources[selectedSourceIndex] : null;
    const sourceId = selected.sourceId || (selectedSource ? _msrRuntimeSourceId(selectedSource, selectedSourceIndex) : '');
    if (allEntries.some(entry => entry.db === selected.db && entry.id === selected.id && entry.sourceId === sourceId)) continue;
    let name = selected.id;
    try {
      name = await _resolveRelationName(selected.id, selected.db) || selected.id;
    } catch (error) {
      console.warn('マルチソースリレーションの現在値を解決できませんでした:', selected.db, selected.id, error);
    }
    const sheetName = selected.db.split('/').pop() || '?';
    const detailLabel = selectedSource?.label
      || (_msrSourceKind(selectedSource) === 'relation' ? selectedSource?.relationProp : '');
    allEntries.unshift({
      db: selected.db,
      id: selected.id,
      name,
      label: detailLabel ? sheetName + '/' + detailLabel : sheetName,
      sourceId,
      dangling: true,
    });
  }

  const renderList = (filter) => {
    listDiv.innerHTML = '';
    const filtered = filter ? allEntries.filter(e => e.name.toLowerCase().includes(filter.toLowerCase())) : allEntries;

    // ソースDB別にグループ化
    const groups = {};
    filtered.forEach(e => {
      const groupKey = e.db + '::' + e.sourceId;
      if (!groups[groupKey]) groups[groupKey] = { db: e.db, label: e.label, entries: [] };
      groups[groupKey].entries.push(e);
    });

    for (const group of Object.values(groups)) {
      // グループヘッダー
      const header = document.createElement('div');
      header.style.cssText = 'padding:4px 8px;font-size:11px;font-weight:bold;color:var(--fg2);border-bottom:1px solid var(--border);';
      header.textContent = '── ' + group.label + ' ──';
      listDiv.appendChild(header);

      group.entries.forEach(entry => {
        const sel = isSelected(entry.db, entry.id, entry.sourceId);
        const item = document.createElement('div');
        item.className = 'dd-nav-item';
        item.style.cssText = 'padding:4px 8px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px;';
        if (sel) item.style.background = 'rgba(86,156,214,0.15)';
        item.onmouseenter = () => { item.style.background = 'var(--bg4)'; };
        item.onmouseleave = () => { item.style.background = sel ? 'rgba(86,156,214,0.15)' : ''; };
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = sel;
        item.appendChild(cb);
        item.appendChild(document.createTextNode(entry.name + (entry.dangling ? '（現在の値・候補外）' : '')));
        item.addEventListener('click', () => {
          const idx = currentVals.findIndex(v =>
            v.db === entry.db && v.id === entry.id
            && (v.sourceId ? v.sourceId === entry.sourceId : true));
          const nextVals = currentVals.slice();
          if (idx >= 0) nextVals.splice(idx, 1);
          else nextVals.push({ db: entry.db, id: entry.id, sourceId: entry.sourceId });
          currentVals.splice(0, currentVals.length, ...nextVals);
          didChange = hadLegacyValues || msrValueText(currentVals) !== msrValueText(initialVals);
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
  const currentId = entityData?._id || entityName;

  const sources = ptc.sources || [];
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
    const src = sources[sourceIndex];
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
        if (_msrSourceKind(src) === 'relation') {
          if (src.relationProp
            && _msrRelationValueReferences(remoteData[src.relationProp], currentId, entityName)) {
            results.push({
              db: src.db,
              id: remoteId,
              sourceId: _msrRuntimeSourceId(src, sourceIndex),
              name: remoteName,
              label: src.label || src.relationProp || src.db.split('/').pop(),
            });
          }
          continue;
        }
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
          results.push({
            db: src.db,
            id: remoteId,
            sourceId: _msrRuntimeSourceId(src, sourceIndex),
            name: remoteName,
            label: src.label || src.db.split('/').pop(),
          });
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
        const newValue = _msrCanonicalValue(collected);

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
async function _showUserDropdown(anchor, val, entityPath, propName, currentValue, isMulti, options) {
  const dropdownOptions = options || {};
  document.querySelectorAll('.user-dropdown').forEach(el => el.remove());

  // 候補ユーザー一覧はMeldexUserPickerに統一（正本「スタッフ管理シート」+
  // ワークスペースメンバーのマージ。/team・/auth/usersへの参照はここで無くなる。
  // ユーザーアカウント一元管理 計画書 Phase 3、§5.8-1）。
  const users = window.MeldexUserPicker
    ? await window.MeldexUserPicker.getCandidates()
    : [];

  const dd = document.createElement('div');
  dd.className = 'cell-inline-dd user-dropdown';
  dd.style.cssText = 'position:fixed;z-index:9999;min-width:180px;max-height:300px;overflow-y:auto;background:var(--ui-popup-bg, var(--bg2));border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.3);padding:4px;';
  dd.addEventListener('pointerdown', e => e.stopPropagation());
  dd.addEventListener('click', e => e.stopPropagation());

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
      msg.textContent = 'ユーザーが登録されていません。設定 → ワークスペースでメンバーを追加してください';
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
      item.addEventListener('click', async () => {
        if (isMulti) {
          if (selected.has(u.name)) selected.delete(u.name);
          else selected.add(u.name);
          renderList(searchInput.value);
        } else {
          const saved = await _saveUserValue(val, entityPath, propName, u.name, anchor, dropdownOptions);
          if (saved) dd.remove();
          else showStatus('ユーザーを保存できませんでした', true);
        }
      });
      dd.appendChild(item);
    });

    if (isMulti) {
      const confirmBtn = document.createElement('div');
      confirmBtn.className = 'user-confirm-btn dd-nav-item';
      confirmBtn.style.cssText = 'padding:4px 8px;margin-top:4px;text-align:center;cursor:pointer;font-size:12px;color:var(--accent);border-top:1px solid var(--border);font-weight:bold;';
      confirmBtn.textContent = '\u2713 確定';
      const commitMultiUserDropdown = async () => {
        const saved = await _saveUserValue(val, entityPath, propName, [...selected].join(', '), anchor, dropdownOptions);
        if (saved) dd.remove();
        else showStatus('ユーザーを保存できませんでした', true);
      };
      confirmBtn._ddActivate = commitMultiUserDropdown;
      confirmBtn.addEventListener('click', commitMultiUserDropdown);
      dd.appendChild(confirmBtn);
    }

    if (!isMulti && currentValue) {
      const clearBtn = document.createElement('div');
      clearBtn.className = 'user-clear-btn';
      clearBtn.style.cssText = 'padding:4px 8px;text-align:center;cursor:pointer;font-size:11px;color:var(--fg2);border-top:1px solid var(--border);margin-top:4px;';
      clearBtn.textContent = '選択を解除';
      clearBtn.addEventListener('click', async () => {
        const saved = await _saveUserValue(val, entityPath, propName, '', anchor, dropdownOptions);
        if (saved) dd.remove();
        else showStatus('ユーザーを保存できませんでした', true);
      });
      dd.appendChild(clearBtn);
    }
  }

  searchInput.addEventListener('input', () => renderList(searchInput.value));
  renderList('');

  if (typeof _positionCellDropdown === 'function') {
    _positionCellDropdown(dd, anchor, { gap: 2, minWidth: 180 });
  } else {
    const rect = anchor.getBoundingClientRect();
    const _zu = _getZoom();
    dd.style.left = (rect.left / _zu) + 'px';
    dd.style.top = (rect.bottom / _zu + 2) + 'px';
    document.body.appendChild(dd);
    clampPopupToViewport(dd);
  }
  _enableDropdownKeyNav(dd, '.user-option,.user-confirm-btn,.user-clear-btn');
  searchInput.focus();

  setTimeout(() => {
    document.addEventListener('pointerdown', function closer(ev) {
      if (!dd.contains(ev.target)) {
        dd.remove();
        if (typeof dropdownOptions.onCancel === 'function') dropdownOptions.onCancel();
        document.removeEventListener('pointerdown', closer);
      }
    });
  }, 0);
}
async function _saveUserValue(val, entityPath, propName, newValue, anchorEl, options) {
  const saveOptions = options || {};
  const dbPath = saveOptions.dbPath || (typeof _valueEditorDbPath === 'function' ? _valueEditorDbPath(entityPath, anchorEl) : state.currentDbPath);
  const ctx = saveOptions.ctx || (typeof _valueEditorContext === 'function' ? _valueEditorContext(entityPath, anchorEl, dbPath) : null);
  const oldValue = val?.value == null ? '' : String(val.value);
  const nextValue = newValue == null ? '' : String(newValue);
  if (nextValue === oldValue) return true;
  try {
    if (val) {
      await _apiPutValue(val, { new_value: nextValue });
      if (typeof _dbUndoValue === 'function') _dbUndoValue(propName + ': ' + oldValue + ' → ' + nextValue, val, oldValue, nextValue);
      val.value = nextValue;
    } else {
      const status = saveOptions.status || '採用';
      const result = await _apiPostValue(entityPath, propName, nextValue, status, '');
      const filePath = result?.path || '';
      if (filePath && typeof historyPush === 'function') {
        let currentRef = {
          file: filePath,
          entry_path: entityPath,
          property: result?.property || propName,
          candidate_index: result?.candidate_index,
        };
        historyPush('値追加: ' + propName + '=' + nextValue,
          currentRef.candidate_index != null
            ? async () => { await _apiPutValue(currentRef, { _delete: true }); await _valueEditorReload(dbPath, ctx); }
            : async () => { await apiPost('/outliner/delete', { path: currentRef.file }); await _valueEditorReload(dbPath, ctx); },
          async () => {
            const redo = await _apiPostValue(entityPath, propName, nextValue, status, '');
            currentRef = {
              file: redo?.path || redo?.file || currentRef.file,
              entry_path: entityPath,
              property: redo?.property || propName,
              candidate_index: redo?.candidate_index,
            };
            await _valueEditorReload(dbPath, ctx);
          },
          typeof _dbScopeForPath === 'function' ? _dbScopeForPath(dbPath) : _dbScope(dbPath)
        );
      }
    }
    // Step 3: 部分更新化 (user/multi-user)
    // val が null (新規追加) の場合は新しいエントリ行が必要なのでフルリロード
    if (!val) {
      await _valueEditorReload(dbPath, ctx);
    } else {
      _refreshAfterCellEdit(anchorEl, entityPath, propName);
    }
    return true;
  } catch (e) {
    if (!saveOptions.silent) showStatus('保存に失敗: ' + (e?.message || e), true);
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
    const pairVal = pairVals.find(v => ['採用', '掲載済み'].includes(v?.status || '採用')) || null;
    if (!pairVal) {
      // ペアプロパティに値がまだない場合は新規作成
      if (adding) {
        const created = await _apiPostValue(targetPath, pairPropName, sourceId, '採用', '');
        const createdFile = created?.path || created?.file;
        if (!createdFile) return null;
        return {
          undo: async () => {
            await _apiPutValue({
              file: createdFile,
              entry_path: targetPath,
              property: created?.property || pairPropName,
              candidate_index: created?.candidate_index,
            }, { _delete: true });
          },
        };
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
    const oldValue = pairVal.value || '';
    const nextValue = currentIds.join(', ');
    if (oldValue === nextValue) return null;
    await _apiPutValue(pairVal, { new_value: nextValue });
    return {
      undo: async () => {
        await _apiPutValue(pairVal, { new_value: oldValue });
      },
    };
  } catch (e) {
    console.warn('ペアリレーション同期に失敗:', e);
    throw e;
  }
}

async function _rollbackRelationSyncOps(ops) {
  for (let i = (ops || []).length - 1; i >= 0; i -= 1) {
    try { await ops[i](); }
    catch (e) { console.warn('リレーション同期の巻き戻しに失敗:', e); }
  }
}

// 循環参照チェック（A→B→C→Aを検出）
async function _checkCircularDependency(dbPath, sourceId, targetId, propName) {
  const sourceKey = String(sourceId || '');
  const visited = new Set();
  const queue = [String(targetId || '')];
  try {
    const data = await apiFetch('/pivot?path=' + encodeURIComponent(dbPath));
    const map = await _getRelationMap(dbPath);
    while (queue.length > 0) {
      const current = String(queue.shift() || '');
      if (!current) continue;
      if (current === sourceKey) return true; // 循環検出
      if (visited.has(current)) continue;
      visited.add(current);
      const name = map.idToName[current] || current;
      const entData = data.entities?.[name];
      if (!entData) continue;
      const vals = entData[propName] || [];
      const v = vals[0]?.value || '';
      v.split(',').map(s => s.trim()).filter(Boolean).forEach(id => {
        const nextId = String(id || '');
        if (nextId === sourceKey) queue.push(nextId);
        else if (!visited.has(nextId)) queue.push(nextId);
      });
    }
  } catch {}
  return false;
}

// リレーションドロップダウン（参照先DBのエントリ一覧）
async function _showRelationDropdown(el, val, entityPath, propName, ptc, isMulti) {
  closeAllDropdowns();
  const isSelfRef = (ptc.relationDb === '' && ptc.relationDb !== undefined);
  const sourceDbPath = ptc.__sourceDbPath || (typeof _valueEditorDbPath === 'function' ? _valueEditorDbPath(entityPath, el) : state.currentDbPath);
  const sourceCtx = typeof _valueEditorContext === 'function' ? _valueEditorContext(entityPath, el, sourceDbPath) : null;
  const relDb = typeof _dbResolveRelationDbPath === 'function'
    ? _dbResolveRelationDbPath(sourceDbPath, ptc)
    : (isSelfRef ? sourceDbPath : (ptc.relationDb || ''));
  if (!relDb) { showStatus('参照先シートが設定されていません。列タイプ設定で指定してください。', true); return; }

  // 参照先DBのエントリ一覧（ID付き）を取得
  let entryList = []; // { name, id }
  let refEntities = {};
  try {
    const cachedMap = typeof _getCachedRelationMap === 'function' ? _getCachedRelationMap(relDb) : null;
    const map = cachedMap || await _getRelationMap(relDb);
    if (cachedMap && typeof _refreshRelationMapSoon === 'function') _refreshRelationMapSoon(relDb);
    refEntities = map.entities || {};
    entryList = Object.entries(map.idToName).map(([id, name]) => ({ name, id }));
  } catch { showStatus('参照先シートの読み込みに失敗: ' + relDb, true); return; }

  // カスケード絞り込み
  if (ptc.cascadeFrom) {
    const parentValues = typeof _getCurrentEntityValues === 'function'
      ? _getCurrentEntityValues(entityPath, ptc.cascadeFrom)
      : [_getCurrentEntityValue(entityPath, ptc.cascadeFrom)].filter(Boolean);
    if (parentValues.length) {
      entryList = entryList.filter(entry => {
        const entData = refEntities[entry.name];
        if (!entData) return false;
        const cascadeVals = entData[ptc.cascadeKey] || [];
        return cascadeVals.some(v => {
          const vals = typeof _splitDbMultiValue === 'function'
            ? _splitDbMultiValue(v.value)
            : String(v.value || '').split(',').map(s => s.trim()).filter(Boolean);
          return parentValues.some(parentValue => vals.includes(parentValue));
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
  dd.addEventListener('pointerdown', e => e.stopPropagation());
  dd.addEventListener('click', e => e.stopPropagation());

  // 検索ボックス
  const search = document.createElement('input');
  search.type = 'text'; search.placeholder = 'エントリを検索...';
  search.style.cssText = 'width:100%;padding:4px 6px;margin-bottom:4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;font-size:12px;';
  dd.appendChild(search);

  const currentVals = isMulti ? ((val?.value) || '').split(',').map(s => s.trim()).filter(Boolean) : [(val?.value) || ''];
  const initialVals = [...currentVals];
  const relationValueText = (values) => (values || []).map(v => String(v || '').trim()).filter(Boolean).join(', ');
  let didChange = false;
  const refreshRelationCellNow = () => {
    try {
      if (typeof _refreshPivotRelationCell === 'function') {
        _refreshPivotRelationCell(el, entityPath, propName, ptc, { dbPath: sourceDbPath, ctx: sourceCtx });
      }
    } catch {}
  };

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
      item.addEventListener('click', () => selectRelationEntry(entry));
      listDiv.appendChild(item);
    });
    // 該当なしの文字列を新規エントリとして追加（部分一致候補の有無に関わらず末尾に表示）
    const trimmedFilter = (filter || '').trim();
    if (trimmedFilter && !entryList.some(e => e.name === trimmedFilter)) {
      const addItem = document.createElement('div');
      addItem.className = 'dd-nav-item';
      addItem.dataset.ddAdd = '1';
      addItem.style.cssText = 'padding:4px 8px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px;color:var(--accent);';
      addItem.innerHTML = lucide('plus', 12) + ' 「' + esc(trimmedFilter) + '」を新規作成';
      addItem.onmouseenter = () => { addItem.style.background = 'var(--bg4)'; };
      addItem.onmouseleave = () => { addItem.style.background = ''; };
      addItem._ddActivate = () => handleCreateNewRelationEntry(trimmedFilter);
      addItem.addEventListener('click', () => handleCreateNewRelationEntry(trimmedFilter));
      listDiv.appendChild(addItem);
    }
  };
  // 既存エントリ選択時の確定処理（新規作成後もこの関数を通す。処理内容は元itemクリックハンドラーをそのまま移動）
  const selectRelationEntry = async (entry) => {
    const oldVal = val?.value || '';
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
      if (idx >= 0) currentVals.splice(idx, 1);
      else currentVals.push(entry.id);
      didChange = relationValueText(currentVals) !== relationValueText(initialVals);
      renderList(search.value);
      if (dd.isConnected) search.focus({ preventScroll: true });
    } else {
      if (oldVal === entry.id || oldVal === entry.name) { closeDropdown(); return; }
      let cascadeClears = [];
      _upsertLocalPivotValue(entityPath, propName, val, entry.id);
      refreshRelationCellNow();
      try {
        cascadeClears = await _clearCascadeDependentValues(entityPath, propName, oldVal, entry.id);
      } catch (e) {
        _upsertLocalPivotValue(entityPath, propName, val, oldVal);
        refreshRelationCellNow();
        showStatus('カスケード依存値の更新に失敗: ' + (e?.message || e), true);
        return;
      }
      try {
        await _apiPutValue(val, { new_value: entry.id });
      } catch (e) {
        _upsertLocalPivotValue(entityPath, propName, val, oldVal);
        refreshRelationCellNow();
        await _restoreCascadeDependentValues(entityPath, cascadeClears);
        showStatus('リレーション値の保存に失敗: ' + (e?.message || e), true);
        await _valueEditorReload(sourceDbPath, sourceCtx);
        return;
      }
      _upsertLocalPivotValue(entityPath, propName, val, entry.id);
      didChange = true;
      let syncError = null;
      const syncRollbackOps = [];
      try {
        if (hasPair) {
          _relationCache[relDb] = null;
          if (oldVal) {
            const oldPairOp = await _syncPairRelation(relDb, oldVal, ptc.pairWith, selfId, false);
            if (oldPairOp?.undo) syncRollbackOps.push(oldPairOp.undo);
          }
          const newPairOp = await _syncPairRelation(relDb, entry.id, ptc.pairWith, selfId, true);
          if (newPairOp?.undo) syncRollbackOps.push(newPairOp.undo);
        }
        if (bidirectionalCtx && typeof _applyBidirectionalRelationSync === 'function') {
          const bidirectionalOp = await _applyBidirectionalRelationSync({
            sourceDbPath,
            entityPath,
            propName,
            ptc,
            oldValue: oldVal,
            newValue: entry.id,
          });
          if (bidirectionalOp?.undo) syncRollbackOps.push(bidirectionalOp.undo);
        }
      } catch (e) {
        syncError = e;
      }
      if (syncError) {
        await _rollbackRelationSyncOps(syncRollbackOps);
        try { await _apiPutValue(val, { new_value: oldVal }); } catch {}
        _upsertLocalPivotValue(entityPath, propName, val, oldVal);
        refreshRelationCellNow();
        if (cascadeClears.length && typeof _restoreCascadeDependentValues === 'function') {
          try { await _restoreCascadeDependentValues(entityPath, cascadeClears); } catch {}
        }
        showStatus('リレーション同期に失敗: ' + (syncError?.message || syncError), true);
        closeDropdown();
        await _valueEditorReload(sourceDbPath, sourceCtx);
        return;
      }
      if (isSelfRef) {
        const selfName = entityPath.replace(/\.md$/, '').split('/').pop();
        const selfMap = _relationCache[relDb];
        const selfIdForCycle = selfMap ? (selfMap.nameToId[selfName] || selfName) : selfName;
        const circular = await _checkCircularDependency(relDb, selfIdForCycle, entry.id, propName);
        if (circular) showStatus('⚠ 循環依存が検出されました', true);
      }
      _dbUndoPairValue(propName, val, oldVal, entry.id, hasPair ? relDb : null, hasPair ? entry.id : null, hasPair ? ptc.pairWith : null, selfId, true, hasPair ? oldVal : null, entityPath, cascadeClears, bidirectionalCtx);
      closeDropdown();
      await _finalizeRelationCellUpdate(el, entityPath, propName, ptc, cascadeClears.map(c => c.propName));
    }
  };
  // 検索欄に完全一致が無い文字列を参照先シートへ新規エントリとして作成し、そのまま選択する
  // （Notionのリレーション追加と同じUX）。連打防止は creatingRelationEntry フラグで行う。
  let creatingRelationEntry = false;
  const handleCreateNewRelationEntry = async (rawName) => {
    const trimmed = String(rawName || '').trim();
    if (!trimmed || creatingRelationEntry) return;
    creatingRelationEntry = true;
    try {
      const sanitized = trimmed.replace(/[\\/:*?"<>|]/g, '_');
      await apiPost('/entity/create', { parent_path: relDb, name: sanitized });
      // 名前解決とロールアップの参照先キャッシュを同時に無効化する
      if (typeof _invalidateRelationTargetCaches === 'function') _invalidateRelationTargetCaches(relDb);
      else _relationCache[relDb] = null;
      const map = await _getRelationMap(relDb);
      const newId = (map?.nameToId && map.nameToId[sanitized]) || sanitized;
      const newEntry = { name: sanitized, id: newId };
      entryList.push(newEntry);
      entryList.sort((a, b) => a.name.localeCompare(b.name));
      await selectRelationEntry(newEntry);
    } catch (e) {
      showStatus('エントリの作成に失敗: ' + (e?.message || e), true);
    } finally {
      creatingRelationEntry = false;
    }
  };
  renderList('');
  search.oninput = () => renderList(search.value);
  dd.appendChild(listDiv);

  // 複数選択の確定ボタン
  if (isMulti) {
    const commitMultiRelationDropdown = async () => {
      const oldVal = relationValueText(initialVals);
      const nv = relationValueText(currentVals);
      closeDropdown();
      if (!didChange || oldVal === nv) return;
      const hasPair = ptc.pairWith && isSelfRef;
      const bidirectionalCtx = ptc.bidirectional ? { entityPath, propName, ptc } : null;
      let selfId = '';
      if (hasPair) {
        const selfName = entityPath.replace(/\.md$/, '').split('/').pop();
        const selfMap = _relationCache[relDb];
        selfId = selfMap ? (selfMap.nameToId[selfName] || selfName) : selfName;
      }
      let cascadeClears = [];
      const syncRollbackOps = [];
      try {
        if (typeof _upsertLocalPivotValue === 'function') _upsertLocalPivotValue(entityPath, propName, val, nv);
        if (val) val.value = nv;
        refreshRelationCellNow();
        if (typeof _clearCascadeDependentValues === 'function') {
          cascadeClears = await _clearCascadeDependentValues(entityPath, propName, oldVal, nv);
        }
        if (val?.file) {
          await _apiPutValue(val, { new_value: nv });
        } else {
          const created = await _apiPostValue(entityPath, propName, nv, '採用', '');
          if (val && created) {
            val.file = created.path || created.file || val.file;
            val.property = created.property || propName;
            val.candidate_index = created.candidate_index;
            val.status = val.status || '採用';
          }
        }
        if (hasPair) {
          _relationCache[relDb] = null;
          const oldSet = new Set(initialVals);
          const nextSet = new Set(currentVals);
          for (const removed of initialVals.filter(id => !nextSet.has(id))) {
            const op = await _syncPairRelation(relDb, removed, ptc.pairWith, selfId, false);
            if (op?.undo) syncRollbackOps.push(op.undo);
          }
          for (const added of currentVals.filter(id => !oldSet.has(id))) {
            const op = await _syncPairRelation(relDb, added, ptc.pairWith, selfId, true);
            if (op?.undo) syncRollbackOps.push(op.undo);
            const circular = await _checkCircularDependency(relDb, selfId, added, propName);
            if (circular) showStatus('⚠ 循環依存が検出されました', true);
          }
        }
        if (bidirectionalCtx && typeof _applyBidirectionalRelationSync === 'function') {
          const bidirectionalOp = await _applyBidirectionalRelationSync({
            sourceDbPath,
            entityPath,
            propName,
            ptc,
            oldValue: oldVal,
            newValue: nv,
          });
          if (bidirectionalOp?.undo) syncRollbackOps.push(bidirectionalOp.undo);
        }
        if (typeof _dbUndoValue === 'function' && val) _dbUndoValue(propName + ': ' + oldVal + ' → ' + nv, val, oldVal, nv);
        const cascadeProps = _getCascadeDependents(propName, sourceDbPath).map(dep => dep.propName);
        await _finalizeRelationCellUpdate(el, entityPath, propName, ptc, cascadeProps);
      } catch (e) {
        await _rollbackRelationSyncOps(syncRollbackOps);
        if (val?.file) {
          try { await _apiPutValue(val, { new_value: oldVal }); } catch {}
        }
        currentVals.splice(0, currentVals.length, ...initialVals);
        if (typeof _upsertLocalPivotValue === 'function') _upsertLocalPivotValue(entityPath, propName, val, oldVal);
        if (val) val.value = oldVal;
        if (cascadeClears.length && typeof _restoreCascadeDependentValues === 'function') {
          try { await _restoreCascadeDependentValues(entityPath, cascadeClears); } catch {}
        }
        refreshRelationCellNow();
        showStatus('リレーション値の保存に失敗: ' + (e?.message || e), true);
        await _valueEditorReload(sourceDbPath, sourceCtx);
      }
    };
    const doneBtn = document.createElement('div');
    doneBtn.className = 'dd-nav-item';
    doneBtn.style.cssText = 'padding:4px 8px;text-align:center;cursor:pointer;font-size:12px;font-weight:bold;color:var(--accent);border-top:1px solid var(--border);margin-top:4px;';
    doneBtn.innerHTML = lucide('check', 12) + ' 確定';
    doneBtn._ddActivate = commitMultiRelationDropdown;
    doneBtn.addEventListener('click', commitMultiRelationDropdown);
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.altKey)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        commitMultiRelationDropdown();
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
  if (typeof _positionCellDropdown === 'function') {
    _positionCellDropdown(dd, el, { gap: 2, minWidth: 180 });
  } else {
    const rect = el.getBoundingClientRect();
    const _zr = _getZoom();
    dd.style.position = 'fixed'; dd.style.left = (rect.left / _zr) + 'px'; dd.style.top = (rect.bottom / _zr + 2) + 'px';
    document.body.appendChild(dd);
    clampPopupToViewport(dd);
  }
  _enableDropdownKeyNav(dd, '.dd-nav-item');
  search.focus();

  setTimeout(() => {
    closer = async (e) => {
      if (!dd.contains(e.target)) {
        closeDropdown();
      }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

// Select型ドロップダウン
function showSelectDropdown(el, val, entityPath, propName, options, dbPath) {
  const sourceDbPath = dbPath || (typeof _valueEditorDbPath === 'function' ? _valueEditorDbPath(entityPath, el) : state.currentDbPath);
  const sourceCtx = typeof _valueEditorContext === 'function' ? _valueEditorContext(entityPath, el, sourceDbPath) : null;
  const lockMsg = _valueEditorLockMessage(sourceDbPath, propName);
  if (lockMsg) { showStatus(lockMsg); return; }
  const latestConfig = typeof getPropertyTypes === 'function' ? getPropertyTypes(sourceDbPath)?.[propName] : null;
  const effectiveOptions = Array.isArray(latestConfig?.options) ? latestConfig.options : (Array.isArray(options) ? options : []);
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
                entry_path: entityPath,
                property: propName,
                candidate_index: result.candidate_index,
                value: oldVal,
                status: savedStatus,
                note: savedNote,
              };
            }
            await _valueEditorReload(sourceDbPath, sourceCtx);
          },
          async () => {
            await _apiPutValue(currentVal, { _delete: true });
            await _valueEditorReload(sourceDbPath, sourceCtx);
          },
          // 互換テスト用: typeof _dbScopeForPath === 'function' ? _dbScopeForPath(sourceDbPath) : _dbScope()
          typeof _dbScopeForPath === 'function' ? _dbScopeForPath(sourceDbPath) : _dbScope(sourceDbPath)
        );
        // Step 3: 部分更新化 (select 解除) — 削除済み val をローカル pivotData から除去
        _removeLocalPivotValue(val, entityPath, propName);
        _refreshAfterCellEdit(el, entityPath, propName);
      } catch (e) { showStatus('保存に失敗: ' + (e?.message || e), true); }
    }
  });
  dd.appendChild(clearItem);

  effectiveOptions.forEach(opt => {
    const item = document.createElement('div');
    item.className = 'status-dropdown-item';
    if (typeof createDbOptionColorDot === 'function') {
      const dot = createDbOptionColorDot(typeof getDbOptionColor === 'function' ? getDbOptionColor(latestConfig, opt) : '');
      if (dot) item.appendChild(dot);
    }
    item.appendChild(document.createTextNode(opt));
    if (val.value === opt) item.classList.add('selected');
    item.addEventListener('click', async () => {
      closeAllDropdowns();
      if (opt !== val.value) {
        const oldVal = val.value || '';
        try {
          if (typeof _upsertLocalPivotValue === 'function') _upsertLocalPivotValue(entityPath, propName, val, opt);
          else val.value = opt;
          _refreshAfterCellEdit(el, entityPath, propName);
          await _apiPutValue(val, { new_value: opt });
          _dbUndoValue(propName + ': ' + oldVal + ' → ' + opt, val, oldVal, opt);
        } catch (e) {
          if (typeof _upsertLocalPivotValue === 'function') _upsertLocalPivotValue(entityPath, propName, val, oldVal);
          else val.value = oldVal;
          _refreshAfterCellEdit(el, entityPath, propName);
          showStatus('保存に失敗: ' + (e?.message || e), true);
        }
      }
    });
    dd.appendChild(item);
  });

  if (typeof _positionCellDropdown === 'function') {
    _positionCellDropdown(dd, el, { gap: 2 });
  } else {
    const rect = el.getBoundingClientRect();
    const _zs = _getZoom();
    dd.style.position = 'fixed';
    dd.style.left = (rect.left / _zs) + 'px';
    dd.style.top = (rect.bottom / _zs + 2) + 'px';
    document.body.appendChild(dd);
    clampPopupToViewport(dd);
  }
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
      <div style="font-size:14px;font-weight:bold;margin-bottom:8px;">ステータス連動設定 ${fieldHelp('どのステータスに変更されたとき、この日時列に現在日時を自動入力しますか？空にすると自動入力を解除します。')}</div>
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

  const confirm = async () => {
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
    try {
      await Promise.resolve(setPropertyType(dbPath, propName, newPtc));
      showStatus(raw ? 'ステータス連動自動入力を設定' : '自動入力を解除');
      overlay.remove();
    } catch (e) {
      showStatus('自動入力設定の保存に失敗: ' + (e?.message || e), true);
    }
  };

  document.getElementById('_autoFillStatusOk').addEventListener('click', confirm);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirm(); });
}
