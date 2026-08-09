// 共通タグ型セル表示: 値はタグID配列(カンマ区切り文字列)。タグの名前・色は
// .meldex/global-tags.json 側のカタログを非同期取得して解決する（キャッシュ付き）。
// 解除済み/削除済みのタグIDは表示をスキップする（積極的な掃除はしない）。
let _commonTagsRefreshTimer = null;

async function hydrateCommonTagsValueElement(container) {
  const api = (typeof window !== 'undefined') ? window.MeldexGlobalTags : null;
  const tagIds = Array.isArray(container?._commonTagIds) ? container._commonTagIds : [];
  if (!container || !tagIds.length || !api || typeof api.loadTagsCached !== 'function') return;
  const sourceFolder = String(container.dataset.tagSourceFolder || '').trim();
  const data = await api.loadTagsCached(sourceFolder);
  if (!container.isConnected) return;
  const allTags = Array.isArray(data?.tags) ? data.tags : [];
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  const groupsById = Object.fromEntries(groups.map(g => [g.id, g]));
  const tagsById = Object.fromEntries(allTags.map(t => [String(t.id), t]));
  const resolvedTags = tagIds.map(id => tagsById[id]).filter(Boolean);
  const visibleTags = window.MeldexTagDisplayPreferences?.filterVisibleTags?.(
    resolvedTags,
    groups,
    sourceFolder,
  ) || resolvedTags;
  const orderedTags = typeof api.sortTagsByGroupOrder === 'function'
    ? api.sortTagsByGroupOrder(visibleTags, groups)
    : visibleTags;
  const displayLimit = window.MeldexTagDisplayPreferences?.sheetTagDisplayLimit?.(
    container.dataset.dbPath || '',
  ) || api.getCompactTagDisplayLimit?.() || 10;
  const names = orderedTags.map(tag => String(tag?.name || '')).filter(Boolean);
  const allTagsTitle = `すべてのタグ（${names.length}件）\n${names.join('、')}`;
  container.textContent = '';
  container.title = allTagsTitle;
  orderedTags.slice(0, displayLimit).forEach(tag => {
    const chip = typeof api.createTagChip === 'function'
      ? api.createTagChip(tag, {
          compact: true,
          groupsById,
          className: 'multi-select-tag common-tags-tag',
        })
      : Object.assign(document.createElement('span'), {
          className: 'gb-tag-chip gb-tag-chip--compact multi-select-tag common-tags-tag',
          textContent: tag.name || '',
        });
    container.appendChild(chip);
  });
  if (orderedTags.length > displayLimit) {
    const label = `+${orderedTags.length - displayLimit}`;
    const more = typeof api.createTagChip === 'function'
      ? api.createTagChip(null, {
          compact: true,
          summary: true,
          label,
          title: allTagsTitle,
          className: 'multi-select-tag common-tags-tag common-tags-tag--more',
        })
      : Object.assign(document.createElement('span'), {
          className: 'gb-tag-chip gb-tag-chip--compact gb-tag-chip--summary multi-select-tag common-tags-tag common-tags-tag--more',
          textContent: label,
          title: allTagsTitle,
        });
    container.appendChild(more);
  }
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('meldex:tag-dictionary-changed', () => {
    clearTimeout(_commonTagsRefreshTimer);
    _commonTagsRefreshTimer = setTimeout(() => {
      document.querySelectorAll('.common-tags-cell').forEach(container => {
        hydrateCommonTagsValueElement(container).catch(() => {});
      });
    }, 80);
  });
  window.addEventListener('meldex:compact-tag-display-limit-changed', () => {
    document.querySelectorAll('.common-tags-cell').forEach(container => {
      hydrateCommonTagsValueElement(container).catch(() => {
        // 個別セルの読込失敗表示はhydrateCommonTagsValueElement内で反映済み。
      });
    });
  });
  window.addEventListener('meldex:sheet-tag-display-limit-changed', () => {
    document.querySelectorAll('.common-tags-cell').forEach(container => {
      hydrateCommonTagsValueElement(container).catch(() => {});
    });
  });
  window.addEventListener('meldex:tag-group-visibility-changed', () => {
    document.querySelectorAll('.common-tags-cell').forEach(container => {
      hydrateCommonTagsValueElement(container).catch(() => {});
    });
  });
}

function createCommonTagsValueElement(rawValue, entityPath, propName, dbPath) {
  const tagIds = String(rawValue || '').split(',').map(s => s.trim()).filter(Boolean);
  const container = document.createElement('div');
  container.className = 'multi-select-tags common-tags-cell';
  container.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;cursor:pointer;min-height:16px;';
  container._commonTagIds = tagIds;
  container.dataset.dbPath = String(dbPath || '');
  container.dataset.tagSourceFolder = String(
    dbPath && window.MeldexAutoTagSourceFolder?.(dbPath) || '',
  ).trim();
  hydrateCommonTagsValueElement(container).catch(() => {});
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
  const valueCtx = options.ctx || (
    typeof _valueEditorContext === 'function'
      ? _valueEditorContext(entityPath, null, dbPath)
      : null
  );
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
      const ctx = valueCtx || (typeof _dbFindPaneContextForPath === 'function' ? _dbFindPaneContextForPath(dbPath) : null);
      const entityName = entityPath.replace(/\.md$/, '').split('/').pop();
      const livePtc = dbPath && typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath, ctx)?.[propName] : null;
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

  // ロールアップ/数式型: 保存値ではなくその場の計算結果を表示する（表セルの計算描画と揃える）。
  // 計算に必要なエントリ全体のプロパティ (options.entityData) を渡せない呼び出し元では、
  // 変換前の生値をそのまま出さないよう「計算列」の安全なフォールバック表示にする。
  if (type === 'rollup' || type === 'formula') {
    const row = document.createElement('div');
    row.className = 'cell-value';
    const span = document.createElement('span');
    span.className = 'db-cell-display-text';
    span.style.cssText = 'font-size:13px;color:var(--fg2);';
    row.appendChild(span);

    if (type === 'rollup' && (!propTypeConfig.relationProp || typeof calcRollupValue !== 'function')) {
      span.classList.add('db-cell-unconfigured');
      span.textContent = '未設定';
      span.title = '列タイプの設定でリレーション列と参照先の列を指定してください';
      return row;
    }
    if (type === 'formula' && !propTypeConfig.formula) {
      span.classList.add('db-cell-unconfigured');
      span.textContent = '未設定';
      span.title = '列タイプの設定で数式を入力してください';
      return row;
    }

    const entityData = options.entityData || null;
    const resolvedPropTypes = options.propTypes
      || (dbPath && typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath, valueCtx) : null);
    if (!entityData || !resolvedPropTypes
        || (type === 'formula' && typeof formulaEvalForEntity !== 'function')) {
      span.textContent = '計算列';
      span.title = '計算結果を表示するための情報を取得できませんでした';
      return row;
    }

    const entityName = options.entityName || entityPath.replace(/\.md$/, '').split('/').pop();

    if (type === 'formula') {
      const result = formulaEvalForEntity(propTypeConfig.formula, entityData, { propTypes: resolvedPropTypes, dbPath });
      if (result.error) {
        span.style.color = 'var(--red)';
        span.textContent = '#ERROR';
        span.title = result.error;
      } else {
        span.style.color = 'var(--fg)';
        span.textContent = result.value === '' ? '' : String(result.value);
      }
      return row;
    }

    // ロールアップ: 参照先DBの取得を伴うため非同期で埋める
    span.textContent = '...';
    const entitiesMap = { [entityName]: entityData };
    calcRollupValue(entityName, entitiesMap, propTypeConfig, resolvedPropTypes, dbPath, filterMode)
      .then(result => {
        if (!span.isConnected) return;
        span.classList.remove('db-cell-unconfigured');
        span.style.color = 'var(--fg)';
        if (result && typeof result === 'object' && result.kind === 'rollup-values') {
          span.textContent = result.text || '—';
          return;
        }
        span.textContent = result === '-' ? '-' : String(result);
      })
      .catch(() => {
        if (!span.isConnected) return;
        span.textContent = '#ERR';
        span.style.color = 'var(--red)';
      });
    return row;
  }

  const row = document.createElement('div');
  row.className = 'cell-value' + (val.status === 'ボツ' ? ' status-botsu' : '');
  _setupCellValueDrag(row, val, entityPath, propName);

  // リレーションはロールアップの参照可否にも使うため、常にステータスを変更できるようにする。
  // その他の型は、採用状況フィルタ使用時または候補値が複数ある場合だけ表示する。
  // ただし1セル1値で運用するシート（制作管理）ではリレーション特例を適用しない。適用すると
  // リレーション列だらけのシートで「ステータス機能」の設定に関係なくマークが出続ける。
  // そのシートで「ステータス機能」をオンにした場合は従来どおり出す（hidesCandidateStatusUi）。
  const hideStatusUi = typeof hidesCandidateStatusUi === 'function' && hidesCandidateStatusUi(dbPath);
  const relationStatusEditable = !hideStatusUi && (type === 'relation' || type === 'multi-relation');
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
  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'cell-value-more';
  moreBtn.style.cssText = 'position:absolute;right:28px;top:50%;transform:translateY(-50%);display:none;cursor:pointer;padding:0 2px;color:var(--fg2);background:var(--bg3);border:0;border-radius:3px;z-index:2;';
  moreBtn.innerHTML = lucide('ellipsis', 12);
  moreBtn.title = propTypeConfig.type === 'image' ? '画像を管理' : 'メニュー';
  moreBtn.setAttribute('aria-label', propTypeConfig.type === 'image' ? '画像を管理' : '候補値のメニュー');
  moreBtn.dataset.e2eId = _typedCellControlE2eId('value-more', entityPath, propName)
    + '-' + String(val?.candidate_index ?? 0);
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
      const lockMsg = _valueEditorLockMessage(dbPath, propName, valueCtx);
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
      const lockMsg = _valueEditorLockMessage(dbPath, propName, valueCtx);
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
      const lockMsg = _valueEditorLockMessage(dbPath, propName, valueCtx);
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
      const latestConfig = typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath, valueCtx)?.[propName] : null;
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
    row.appendChild(createCommonTagsValueElement(v, entityPath, propName, dbPath));
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
      const lockMsg = _valueEditorLockMessage(dbPath, propName, valueCtx);
      if (lockMsg) { showStatus(lockMsg); return; }
      _showUserDropdown(span, val, entityPath, propName, v, false, { dbPath, ctx: valueCtx });
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
      const lockMsg = _valueEditorLockMessage(dbPath, propName, valueCtx);
      if (lockMsg) { showStatus(lockMsg); return; }
      _showUserDropdown(container, val, entityPath, propName, v, true, { dbPath, ctx: valueCtx });
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
      const lockMsg = _valueEditorLockMessage(dbPath, propName, valueCtx);
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
      const lockMsg = _valueEditorLockMessage(dbPath, propName, valueCtx);
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
        const lockMsg = _valueEditorLockMessage(dbPath, propName, valueCtx);
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
        const lockMsg = _valueEditorLockMessage(dbPath, propName, valueCtx);
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
        const lockMsg = _valueEditorLockMessage(dbPath, propName, valueCtx);
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
  const lockMsg = _valueEditorLockMessage(dbPath, propName, ctx);
  if (lockMsg) { showStatus(lockMsg); return; }
  closeAllDropdowns(ctx || anchor);
  const sources = ptc.sources || [];
  if (sources.length === 0) { showStatus('ソースシートが設定されていません', true); return; }

  const dd = document.createElement('div');
  dd.className = 'status-dropdown';
  if (ctx?.paneId) dd.dataset.dbPaneId = ctx.paneId;
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
async function _autoCollectMultiSourceRelation(entityName, entityData, ptc, dbPath, ctx) {
  const results = [];
  const pts = getPropertyTypes(dbPath, ctx);
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
  const pts = getPropertyTypes(dbPath, ctx);
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
        const collected = await _autoCollectMultiSourceRelation(entityName, entityData, ptc, dbPath, ctx);
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
  const lockMsg = _valueEditorLockMessage(sourceDbPath, propName, sourceCtx);
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
