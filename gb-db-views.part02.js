      type: 'submenu',
      label: lucide('layoutDashboard', 14) + ' ビュータイプを変更',
      children: VIEW_TYPES
        .filter(vt => isCalendarCapable || vt.mode !== 'calendar')
        .map(vt => ({
          label: (vt.mode === currentType ? lucide('check', 14) + ' ' : '<span style="display:inline-block;width:14px;"></span> ') + lucide(vt.icon, 14) + ' ' + vt.label,
          action: () => changeViewType(idx, vt.mode, ctx),
        })),
    },
    { type: 'sep' },
    { label: '左と入れ替え', disabled: idx === 0, action: () => swapViews(idx, idx - 1) },
    { label: '右と入れ替え', disabled: idx >= viewsCount - 1, action: () => swapViews(idx, idx + 1) },
    { type: 'sep' },
    { label: '削除', action: async () => {
      if (!await cfConfirm('このビューを削除しますか？')) return;
      const before = typeof captureDbViewConfigHistory === 'function' ? captureDbViewConfigHistory(dbPath) : null;
      const views = getSavedViews(dbPath);
      views.splice(idx, 1);
      setSavedViews(dbPath, views, { skipHistory: true });
      const curIdx = getCurrentViewIdx(dbPath);
      let nextIdx = curIdx;
      if (curIdx === idx) nextIdx = views.length > 0 ? Math.min(idx, views.length - 1) : -1;
      else if (curIdx > idx) setCurrentViewIdx(dbPath, curIdx - 1, { skipHistory: true });
      if (curIdx === idx) setCurrentViewIdx(dbPath, nextIdx, { skipHistory: true });
      if (typeof pushDbViewConfigHistory === 'function' && typeof captureDbViewConfigHistory === 'function') {
        pushDbViewConfigHistory(dbPath, 'シート表示: ビュー削除', before, captureDbViewConfigHistory(dbPath));
      }
      if (nextIdx >= 0) loadSavedView(nextIdx, ctx, { skipHistory: true });
      else {
        renderDbViewTabs(ctx);
        if (typeof renderDbNoViewsGuide === 'function') renderDbNoViewsGuide(ctx);
      }
    }},
  ];

  _renderDbViewTabMenuItems(menu, items);

  { const z = _getZoom(); menu.style.left = (e.clientX / z) + 'px'; menu.style.top = (e.clientY / z) + 'px'; }
  document.body.appendChild(menu);
  clampPopupToViewport(menu);
  setTimeout(() => {
    const closer = (ev) => {
      if (!menu.contains(ev.target)) { closeColHeaderMenu(); document.removeEventListener('pointerdown', closer); }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

/* ==============================
   グループ化
   ============================== */
function getGroupBy(dbPath, ctx) {
  return getCurrentDbViewTypeSpecific(dbPath, 'pivot', { ctx })?.groupBy || null;
}

function _renderDbViewTabMenuItems(container, itemList) {
  itemList.forEach(item => {
    if (item.type === 'sep') {
      container.appendChild(Object.assign(document.createElement('div'), { className: 'gb-context-menu-sep' }));
      return;
    }
    if (item.type === 'submenu') {
      const wrapper = document.createElement('div');
      const el = document.createElement('div');
      el.className = 'gb-context-menu-item';
      el.innerHTML = item.label + (typeof submenuArrow === 'function' ? submenuArrow() : ' ▸');
      const sub = document.createElement('div');
      sub.className = 'gb-context-menu gb-context-submenu';
      sub.style.display = 'none';
      _renderDbViewTabMenuItems(sub, item.children || []);
      if (typeof attachHoverSubmenu === 'function') attachHoverSubmenu(el, sub);
      else {
        el.addEventListener('mouseenter', () => { sub.style.display = 'block'; });
        wrapper.addEventListener('mouseleave', () => { sub.style.display = 'none'; });
      }
      wrapper.appendChild(el);
      wrapper.appendChild(sub);
      container.appendChild(wrapper);
      return;
    }
    const el = document.createElement('div');
    el.className = 'gb-context-menu-item';
    el.innerHTML = item.label;
    if (item.disabled) {
      el.style.opacity = '0.4';
      el.style.pointerEvents = 'none';
    } else {
      el.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        closeColHeaderMenu();
        try {
          await item.action();
        } catch (err) {
          console.error(err);
          showStatus('ビュー操作に失敗しました: ' + (err?.message || err), true);
        }
      });
    }
    container.appendChild(el);
  });
}
function setGroupBy(dbPath, prop, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: グループ化', options.detail || prop || '解除', options, (v) => {
    if (!v.typeSpecific || typeof v.typeSpecific !== 'object' || Array.isArray(v.typeSpecific)) v.typeSpecific = {};
    if (!v.typeSpecific.pivot || typeof v.typeSpecific.pivot !== 'object' || Array.isArray(v.typeSpecific.pivot)) v.typeSpecific.pivot = {};
    v.typeSpecific.pivot.groupBy = prop;
  });
}

// renderPivotに統合（後述のrenderPivot改修で使用）

function _dbValueMatchesAdvancedFilter(valueObj, filter) {
  const target = filter.field === 'status' ? (valueObj?.status || '') : (valueObj?.value || '');
  switch (filter.operator) {
    case 'equals': return target === filter.value;
    case 'not_equals': return target !== filter.value;
    case 'contains': return target && target.includes(filter.value);
    case 'not_contains': return !target || !target.includes(filter.value);
    case 'empty': return !target || String(target).trim() === '';
    case 'not_empty': return target && String(target).trim() !== '';
    default: return true;
  }
}

function _dbValuesMatchAdvancedFilter(values, filter) {
  const list = Array.isArray(values) ? values : [];
  if (!list.length) return ['empty', 'not_contains', 'not_equals'].includes(filter.operator);
  if (filter.operator === 'not_equals' || filter.operator === 'not_contains') {
    return list.every(v => _dbValueMatchesAdvancedFilter(v, filter));
  }
  return list.some(v => _dbValueMatchesAdvancedFilter(v, filter));
}

// 互換テスト用: function _dbFilterValuesForCurrentView(values)
function _dbFilterValuesForCurrentView(values, filterMode) {
  const list = Array.isArray(values) ? values : [];
  return typeof filterValues === 'function' ? filterValues(list, undefined, filterMode) : list;
}

function _dbEntityPassesAdvancedFilters(entityData, filters, filterMode) {
  if (!Array.isArray(filters) || filters.length === 0) return true;
  return filters.every(filter => {
    if (filter.property === '*') {
      const allValues = Object.values(entityData || {})
        // 互換テスト用: .flatMap(vals => Array.isArray(vals) ? _dbFilterValuesForCurrentView(vals) : [])
        .flatMap(vals => Array.isArray(vals) ? _dbFilterValuesForCurrentView(vals, filterMode) : [])
        .filter(v => v && typeof v === 'object');
      return _dbValuesMatchAdvancedFilter(allValues, filter);
    }
    // 互換テスト用: const values = _dbFilterValuesForCurrentView(entityData?.[filter.property] || []);
    const values = _dbFilterValuesForCurrentView(entityData?.[filter.property] || [], filterMode);
    return _dbValuesMatchAdvancedFilter(values, filter);
  });
}

function _isKanbanGroupableProperty(dbPath, propName) {
  const ptc = getPropertyTypes(dbPath)[propName] || {};
  if (ptc.source) return false;
  if (['formula', 'rollup', 'button', 'multi-source-relation', 'chat'].includes(ptc.type || '')) return false;
  return !checkColumnEditable(dbPath, propName);
}

function _kanbanStatusDefs(dbPath) {
  const preferredOrder = ['掲載済み', '採用', '案', 'ボツ'];
  const sourceList = (typeof getStatusList === 'function') ? getStatusList(dbPath) : [];
  const rawList = Array.isArray(sourceList) && sourceList.length
    ? sourceList
    : preferredOrder.map(name => ({ name, color: typeof _getStatusColor === 'function' ? _getStatusColor(name, dbPath) : '' }));
  const byName = new Map();
  rawList.forEach(item => {
    const name = String(item?.name ?? item ?? '').trim();
    if (!name || byName.has(name)) return;
    const color = item?.color || (typeof _getStatusColor === 'function' ? _getStatusColor(name, dbPath) : '');
    byName.set(name, { name, color });
  });
  const ordered = [];
  const seen = new Set();
  const push = (name) => {
    if (!byName.has(name) || seen.has(name)) return;
    ordered.push(byName.get(name));
    seen.add(name);
  };
  preferredOrder.forEach(push);
  rawList.forEach(item => push(String(item?.name ?? item ?? '').trim()));
  return ordered.length ? ordered : preferredOrder.map(name => ({ name, color: '' }));
}

function _kanbanEntityMainStatus(entityData, dbPath) {
  const order = _kanbanStatusDefs(dbPath).map(item => item.name);
  let best = '';
  let bestIdx = Infinity;
  Object.values(entityData || {}).forEach(propVals => {
    if (!Array.isArray(propVals)) return;
    propVals.forEach(v => {
      const status = String(v?.status || '採用').trim() || '採用';
      let idx = order.indexOf(status);
      if (idx < 0) idx = order.length;
      if (idx < bestIdx) {
        best = status;
        bestIdx = idx;
      }
    });
  });
  return best || order[0] || '採用';
}

function _kanbanValueRef(valueObj, propName) {
  return {
    file: valueObj?.file,
    property: valueObj?.property || propName,
    candidate_index: valueObj?.candidate_index,
  };
}

function _kanbanStatusMoveTargets(entityData, dbPath) {
  const entries = [];
  Object.entries(entityData || {}).forEach(([propName, propVals]) => {
    if (!Array.isArray(propVals)) return;
    propVals.forEach(v => {
      if (!v || typeof v !== 'object') return;
      const old = String(v.status || '採用').trim() || '採用';
      entries.push({ val: v, ref: _kanbanValueRef(v, propName), old, propName });
    });
  });
  const adopted = entries.filter(item => item.old === '採用' || item.old === '掲載済み');
  if (adopted.length) return adopted;
  const mainStatus = _kanbanEntityMainStatus(entityData, dbPath);
  return entries.filter(item => item.old === mainStatus);
}

async function _rollbackKanbanStatusMove(statusWriteOps, autoFillOps) {
  if (typeof _undoAutoFillStatusOps === 'function') {
    try { await _undoAutoFillStatusOps(autoFillOps); } catch {}
  }
  for (const op of [...(statusWriteOps || [])].reverse()) {
    try { await _apiPutValue(op.ref || op.val, { new_status: op.old }); } catch {}
  }
}

function _kanbanAdoptedValueForWrite(values) {
  if (typeof getAdoptedValueForWrite === 'function') return getAdoptedValueForWrite(values);
  const list = Array.isArray(values) ? values : [];
  return list.find(v => ['採用', '掲載済み'].includes(v?.status || '採用')) || null;
}

/* ==============================
   ギャラリービュー
   ============================== */
function _dbViewSurfaceEl(ctx, selector, id) {
  if (ctx && ctx.containerEl) {
    const scoped = ctx.containerEl.querySelector(selector);
    if (scoped) return scoped;
  }
  return document.getElementById(id) || document.querySelector(selector);
}

function _galleryImageSrcFromValue(rawValue, dbPath, entityName) {
  const items = typeof parseImagePropertyValue === 'function' ? parseImagePropertyValue(rawValue) : [];
  if (items.length && typeof _imageSrc === 'function') {
    // 動画・PDFはカバー画像にできないので、画像の添付があればそれを使う
    const cover = typeof _attachmentKind === 'function'
      ? items.find(item => _attachmentKind(item) === 'image')
      : items[0];
    return cover ? _imageSrc(cover, true) : '';
  }
  const text = String(rawValue || '').trim();
  if (!text || !/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(text)) return '';
  if (/^(https?:|data:|blob:|\/)/.test(text)) return text;
  return '/api/file-raw?path=' + encodeURIComponent(dbPath + '/' + entityName + '/' + text);
}

function _dbCardImageItemsFromValues(vals) {
  if (typeof parseImagePropertyValue !== 'function') return [];
  for (const val of vals || []) {
    const items = parseImagePropertyValue(val?.value);
    if (items.length) return items;
  }
  return [];
}

function _appendDbCardImagePreview(root, items, options = {}) {
  if (!root || !Array.isArray(items) || !items.length || typeof _imageSrc !== 'function') return false;
  const wrap = document.createElement('div');
  wrap.className = 'db-card-image-preview ' + (options.className || '');
  if (options.propName) wrap.title = options.propName;
  const thumbCount = typeof _normalizeDbCardImageThumbCount === 'function'
    ? _normalizeDbCardImageThumbCount(options.thumbCount)
    : Math.max(1, Math.min(12, Math.round(Number(options.thumbCount || 3) || 3)));
  const thumbColumns = Math.max(1, Math.min(4, Math.round(Number(options.columns || Math.min(3, thumbCount)) || 3)));
  wrap.dataset.thumbCount = String(thumbCount);
  wrap.style.setProperty('--db-card-thumb-columns', String(thumbColumns));
  let appended = 0;
  items.slice(0, thumbCount).forEach((item, idx) => {
    const mediaKind = typeof _attachmentKind === 'function'
      ? _attachmentKind(item)
      : String(item?.asset_kind || item?.media_type || '').toLowerCase();
    // thumb_url は新方式では動画にも入る（生ファイル）ので、本物の縮小画像だけを preview として扱う
    const hasPreview = !!(item?.preview_url || item?.preview_src || item?.preview_image_url);
    if (mediaKind !== 'image' && !hasPreview) {
      const placeholder = document.createElement('div');
      placeholder.className = 'db-card-media-placeholder';
      placeholder.dataset.imageIndex = String(idx);
      const icon = mediaKind === 'video' ? 'video' : 'fileText';
      const caption = mediaKind === 'video' ? '動画' : (mediaKind === 'pdf' ? 'PDF' : 'ファイル');
      placeholder.innerHTML = (typeof lucide === 'function' ? lucide(icon, 16) : '') + `<span>${caption}</span>`;
      placeholder.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof openImagePropertyItemInViewer === 'function') openImagePropertyItemInViewer(item);
      });
      wrap.appendChild(placeholder);
      appended += 1;
      return;
    }
    const src = _imageSrc(item, true);
    if (!src) return;
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.fetchPriority = 'low';
    img.src = src;
    img.alt = item.caption || item.filename || options.propName || '画像';
    img.dataset.imageIndex = String(idx);
    img.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof openImagePropertyItemInViewer === 'function') openImagePropertyItemInViewer(item);
    });
    const imageHost = window.MeldexImageLoading?.createHost?.(img, { className: 'db-card-image-host' });
    wrap.appendChild(imageHost || img);
    window.MeldexImageLoading?.track?.(img, { host: imageHost, label: '画像を読み込んでいます' });
    appended += 1;
  });
  if (!appended) return false;
  if (items.length > appended) {
    const more = document.createElement('span');
    more.className = 'db-card-image-more';
    more.textContent = '+' + (items.length - appended);
    wrap.appendChild(more);
  }
  root.appendChild(wrap);
  return true;
}

function _appendFirstDbCardImagePreview(root, entityData, propNames, propTypes, ctx, options = {}) {
  if (!root || !entityData || !Array.isArray(propNames)) return false;
  const seen = new Set();
  for (const propName of propNames) {
    if (!propName || seen.has(propName)) continue;
    seen.add(propName);
    const ptc = propTypes?.[propName] || {};
    if (ptc.type && ptc.type !== 'image') continue;
    const vals = filterValues(entityData[propName] || [], undefined, ctx?.filter);
    const imageItems = _dbCardImageItemsFromValues(vals);
    if (imageItems.length && _appendDbCardImagePreview(root, imageItems, { ...options, propName })) {
      return true;
    }
  }
  return false;
}

function _getGalleryConfig(dbPath, ctx) {
  const cfg = getCurrentDbViewTypeSpecific(dbPath, 'gallery', { ctx }) || {};
  const displayCfg = typeof _dbCardViewDisplayConfig === 'function'
    ? _dbCardViewDisplayConfig(cfg)
    : { cardImageThumbCount: 3, cardPropLineCount: 1 };
  return {
    showEntryName: cfg.showEntryName !== false,
    cardProps: Object.prototype.hasOwnProperty.call(cfg, 'cardProps') && Array.isArray(cfg.cardProps) ? cfg.cardProps : null,
    ...displayCfg,
  };
}

function _setGalleryDisplayProps(dbPath, cfg, options = {}) {
  const next = {
    ...cfg,
    cardProps: Array.isArray(cfg.cardProps) ? cfg.cardProps : [],
    showEntryName: cfg.showEntryName !== false,
    ...(typeof _dbCardViewDisplayConfig === 'function' ? _dbCardViewDisplayConfig(cfg) : {}),
  };
  setCurrentDbViewTypeSpecific(dbPath, 'gallery', next, {
    ctx: options.ctx || null,
    historyLabel: options.label || 'シート表示: ギャラリー表示列',
    detail: options.detail || '',
    skipHistory: options.skipHistory === true,
  });
}

function _galleryDefaultCardProps(visibleProps) {
  return (visibleProps || []).slice(0, 4);
}

function _attachDbCardInlineEditor(host, options) {
  const api = globalThis.MeldexDbCardInlineEditor;
  if (!api?.attach || !host) return null;
  const opts = options || {};
  const ptc = opts.propertyConfig || {};
  const type = String(ptc.type || 'text').replace(/_/g, '-');
  const values = Array.isArray(opts.values) ? opts.values : [];
  const valueRef = values[0] || { value: '', status: '採用', property: opts.propName };
  const entityPath = _entityPath(opts.dbPath, opts.entityName);
  const canEdit = () => {
    const message = typeof checkColumnEditable === 'function'
      ? checkColumnEditable(opts.dbPath, opts.propName, opts.ctx) : '';
    if (message) { if (typeof showStatus === 'function') showStatus(message, true); return false; }
    return !(typeof _cellUiRuntimeReadOnly === 'function' && _cellUiRuntimeReadOnly(host));
  };
  const save = async (newValue) => {
    const previous = valueRef.value;
    if (valueRef.file && valueRef.candidate_index != null) {
      await _apiPutValue(valueRef, { new_value: newValue });
    } else {
      const result = await _apiPostValue(entityPath, opts.propName, newValue, '採用', '');
      valueRef.file = result?.path || result?.file || entityPath;
      valueRef.candidate_index = result?.candidate_index;
      if (opts.entityData) {
        if (!Array.isArray(opts.entityData[opts.propName])) opts.entityData[opts.propName] = [];
        if (!opts.entityData[opts.propName].includes(valueRef)) opts.entityData[opts.propName].push(valueRef);
      }
    }
    valueRef.value = newValue;
    return { previous, valueRef };
  };
  return api.attach(host, {
    type, propertyConfig: ptc, propertyName: opts.propName,
    initialValue: valueRef.value, readOnly: opts.readOnly === true, canEdit, save,
    render: value => { host.textContent = value == null || value === '' ? '—' : String(value); },
    rollback: oldValue => { valueRef.value = oldValue; },
    pushUndo: ({ oldValue, newValue }) => {
      if (typeof _dbUndoValue === 'function') {
        _dbUndoValue(`${opts.propName}: ${oldValue} → ${newValue}`, valueRef, oldValue, newValue, undefined, undefined, { dbPath: opts.dbPath, ctx: opts.ctx });
      }
    },
    onError: message => { if (typeof showStatus === 'function') showStatus('保存に失敗: ' + message, true); },
    mountTypedEditor: root => {
      if (typeof createTypedValueElement !== 'function') return;
      root.replaceChildren(createTypedValueElement(valueRef, entityPath, opts.propName,
        typeof getThumbnailSize === 'function' ? getThumbnailSize(opts.dbPath, { ctx: opts.ctx }) : 80,
        ptc, { dbPath: opts.dbPath, ctx: opts.ctx, filter: opts.ctx?.filter, entityData: opts.entityData, entityName: opts.entityName }));
    },
  });
}

function _showGalleryDisplayPropsMenu(anchor, dbPath, cfg, props, ctx) {
  document.querySelectorAll('.gallery-card-props-menu').forEach(el => el.remove());
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu tl-card-props-menu gallery-card-props-menu';
  menu.style.cssText = 'position:fixed;z-index:10000;min-width:240px;max-height:340px;overflow:auto;padding:6px;';
  let ordered = Array.isArray(cfg.cardProps) ? [...cfg.cardProps].filter(prop => props.includes(prop)) : [];
  let showEntryName = cfg.showEntryName !== false;
  let { cardImageThumbCount, cardPropLineCount } = typeof _dbCardViewDisplayConfig === 'function'
    ? _dbCardViewDisplayConfig(cfg)
    : { cardImageThumbCount: 3, cardPropLineCount: 1 };
  const save = (detail) => {
    _setGalleryDisplayProps(dbPath, { ...cfg, cardProps: ordered, showEntryName, cardImageThumbCount, cardPropLineCount }, { ctx, detail });
    renderGallery(ctx);
  };
  if (typeof _appendDbDisplayPropOption === 'function') {
    _appendDbDisplayPropOption(menu, 'トピック名', showEntryName, {
      onToggle(checked) {
        showEntryName = checked;
        save('トピック名');
      },
    });
    if (typeof _appendDbCardDisplayControls === 'function') {
      _appendDbCardDisplayControls(menu, { cardImageThumbCount, cardPropLineCount }, (next, detail) => {
        cardImageThumbCount = next.cardImageThumbCount;
        cardPropLineCount = next.cardPropLineCount;
        save(detail);
      });
    }
    props.forEach(prop => {
      _appendDbDisplayPropOption(menu, prop, ordered.includes(prop), {
        canMoveUp: ordered.indexOf(prop) > 0,
        canMoveDown: ordered.indexOf(prop) >= 0 && ordered.indexOf(prop) < ordered.length - 1,
        onToggle(checked) {
          ordered = checked ? [...ordered, prop].filter((name, idx, arr) => arr.indexOf(name) === idx) : ordered.filter(name => name !== prop);
          save(prop);
        },
        onMove(delta) {
          const idx = ordered.indexOf(prop);
          const nextIdx = idx + delta;
          if (idx < 0 || nextIdx < 0 || nextIdx >= ordered.length) return;
          [ordered[idx], ordered[nextIdx]] = [ordered[nextIdx], ordered[idx]];
          save(prop);
        },
      });
    });
  }
  document.body.appendChild(menu);
  if (typeof attachMeldexDropdownCloseButton === 'function') {
    attachMeldexDropdownCloseButton(menu, {
      trigger: anchor,
      className: 'gallery-card-props-menu-close',
      attr: 'data-gallery-card-props-close',
    });
  }
  if (typeof _positionTimelineCardPropsMenu === 'function') _positionTimelineCardPropsMenu(menu, anchor);
  else if (typeof positionPopup === 'function') positionPopup(menu, anchor.getBoundingClientRect());
  setTimeout(() => {
    const closer = (ev) => {
      if (!menu.contains(ev.target) && ev.target !== anchor && !anchor.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('pointerdown', closer);
      }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

function _buildGalleryToolbar(dbPath, galleryCfg, visibleProps, activeCardProps, ctx) {
  const toolbar = document.createElement('div');
  toolbar.className = 'db-card-view-toolbar gallery-card-view-toolbar';
  const displayPropsBtn = document.createElement('button');
  displayPropsBtn.type = 'button';
  displayPropsBtn.className = 'tl-nav-btn db-card-view-toolbar-btn';
  displayPropsBtn.title = 'カードに表示する列';
  displayPropsBtn.dataset.e2eId = 'gallery-display-props';
  displayPropsBtn.innerHTML = (typeof lucide === 'function' ? lucide('listPlus', 12) + ' ' : '') + '表示列' + (activeCardProps.length ? ' (' + activeCardProps.length + ')' : '');
  displayPropsBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    _showGalleryDisplayPropsMenu(ev.currentTarget, dbPath, { ...galleryCfg, cardProps: activeCardProps }, visibleProps, ctx);
  });
  toolbar.appendChild(displayPropsBtn);
  return toolbar;
}

function renderGallery(ctx) {
  ctx = ctx || _currentPaneState();
  const data = ctx.pivotData || state.pivotData;
  const container = _dbViewSurfaceEl(ctx, '.gallery-view', 'gallery-view');
  if (!container) {
    if (typeof showStatus === 'function') showStatus('シートのギャラリー表示領域を準備できませんでした。シートを開き直してください。', true);
    return;
  }
  container.style.display = 'flex';
  if (!data || !data.entities) { container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--fg2);">データがありません</div>'; return; }

  const dbPath = ctx.dbPath || state.currentDbPath;
  const hiddenCols = getHiddenCols(dbPath, { ctx });
  const advFilters = getAdvancedFilters(dbPath, { ctx });
  const columnValueFilters = typeof getColumnValueFilters === 'function' ? getColumnValueFilters(dbPath, { ctx }) : {};
  const propTypes = getPropertyTypes(dbPath);
  const colOrder = getColOrder(dbPath, { ctx });
  const entitiesMap = data.entities;
  const entityNames = typeof _dbSortedEntityNames === 'function'
    ? _dbSortedEntityNames(data, dbPath, ctx, { applyAdvancedFilters: true, advFilters, columnValueFilters, propTypes })
    : Object.keys(entitiesMap)
      .filter(name => _dbEntityPassesAdvancedFilters(entitiesMap[name], advFilters, ctx?.filter)
        && (typeof _dbEntityPassesColumnValueFilters !== 'function'
          || _dbEntityPassesColumnValueFilters(name, entitiesMap[name], columnValueFilters, dbPath, ctx, ctx?.filter)))
      .sort();
  ctx._lastEntityNames = [...entityNames];
  if (entityNames.length === 0) {
    if (typeof _dbRenderEmptyStateWithCreate === 'function') {
      _dbRenderEmptyStateWithCreate(container, 'layoutGrid', 'トピックがありません', 'トピックを追加して開始してください', ctx);
    } else {
      renderEmptyState(container, 'layoutGrid', 'トピックがありません', 'トピックを追加して開始してください');
    }
    return;
  }
  // colOrder適用（renderPivotと同じ順序ロジック）
  let orderedProps = colOrder ? colOrder.filter(p => data.properties.includes(p)) : [...data.properties];
  data.properties.forEach(p => { if (!orderedProps.includes(p)) orderedProps.push(p); });
  if (typeof filterDeletedDbProperties === 'function') orderedProps = filterDeletedDbProperties(dbPath, orderedProps);
  const visibleProps = orderedProps.filter(p => !hiddenCols.includes(p));
  const galleryCfg = _getGalleryConfig(dbPath, ctx);
  const activeCardProps = Array.isArray(galleryCfg.cardProps) ? galleryCfg.cardProps : _galleryDefaultCardProps(visibleProps);

  const toolbar = _buildGalleryToolbar(dbPath, galleryCfg, visibleProps, activeCardProps, ctx);
  const grid = document.createElement('div');
  grid.className = 'gallery-grid';

  entityNames.forEach(entityName => {
    const entityData = entitiesMap[entityName];
    const card = document.createElement('div');
    card.className = 'gallery-card';
    card.dataset.entity = entityName;
    card.dataset.entityName = entityName;
    card.dataset.meldexEntityPath = _entityPath(dbPath, entityName, ctx?.pivotData);
    card.draggable = true;
    card.addEventListener('dragstart', (event) => {
      window.MeldexBoardTransfer?.setEntityDragData?.(
        event.dataTransfer,
        dbPath,
        entityName,
        card.dataset.meldexEntityPath,
      );
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
    });
    card.addEventListener('click', () => openEntityInSplit(_entityPath(dbPath, entityName), entityName));
    card.addEventListener('dblclick', (ev) => {
      ev.stopPropagation();
      if (typeof _navPushWithViewState === 'function') _navPushWithViewState(ctx, entityName);
      selectEntity(_entityPath(dbPath, entityName));
    });
    card.addEventListener('contextmenu', (e) => { e.preventDefault(); showDbCardContextMenu(e, dbPath, entityName); });
    if (typeof addLongPressHandler === 'function') {
      addLongPressHandler(card, (e) => showDbCardContextMenu(e, dbPath, entityName));
    }

    // タッチ用メニューボタン
    const moreBtn = document.createElement('span');
    moreBtn.className = 'card-more-btn';
    moreBtn.innerHTML = lucide('moreHorizontal', 12);
    moreBtn.title = 'メニュー';
    moreBtn.style.cssText = 'position:absolute;top:4px;right:4px;cursor:pointer;font-size:14px;color:var(--fg2);padding:2px 4px;border-radius:3px;z-index:5;';
    moreBtn.addEventListener('click', (e) => { e.stopPropagation(); showDbCardContextMenu(e, dbPath, entityName); });
    card.style.position = 'relative';
    card.style.setProperty('--db-card-prop-lines', String(galleryCfg.cardPropLineCount));
    card.appendChild(moreBtn);

    let title = null;
    if (galleryCfg.showEntryName !== false) {
      title = document.createElement('div');
      title.className = 'gallery-card-title';
      title.textContent = entityName;
      card.appendChild(title);
    }

    // プロパティ一覧（先頭4件）
    const propsDiv = document.createElement('div');
    propsDiv.className = 'gallery-card-props';
    let shown = 0;
    const cardPropNames = Array.isArray(galleryCfg.cardProps)
      ? galleryCfg.cardProps.filter(propName => visibleProps.includes(propName))
      : _galleryDefaultCardProps(visibleProps);
    // 画像は「カードに表示する列」で有効な画像型列だけを対象にする。未選択列や別列からの
    // 補完（フィルタリングされていない全画像型列の走査・拡張子推測によるフォールバック）は行わない。
    // 有効な画像型列が複数ある場合は、列の表示順に、各列のサムネ数（cardImageThumbCount）まで
    // 個別に並べる（総数の上限は「サムネ数×有効な画像型列数」）。
    const selectedImageCols = cardPropNames.filter(propName => propTypes[propName]?.type === 'image');
    for (const propName of cardPropNames) {
      // sourceプロパティ: メタデータから表示
      const ptcG = propTypes[propName];
      if (ptcG?.type === 'image') continue; // 画像はループの外でまとめて表示する
      let displayVal = '';
      const metadataSource = typeof _dbPropertyMetadataSource === 'function'
        ? _dbPropertyMetadataSource(ptcG)
        : (['created', 'modified', 'modified_by'].includes(ptcG?.source) ? ptcG.source : '');
      if (metadataSource) {
        const metaKey = '_' + metadataSource;
        const mv = entityData[metaKey] || '';
        if ((metadataSource === 'created' || metadataSource === 'modified') && mv) displayVal = mv.replace('T', ' ').substring(0, 16);
        else displayVal = mv || '';
      } else {
        const vals = filterValues(entityData[propName] || [], undefined, ctx?.filter);
        displayVal = vals.map(v => v.value).join(', ');
      }
      if (!displayVal && metadataSource) continue;
      const propRow = document.createElement('div');
      propRow.className = 'gallery-card-prop';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'gallery-card-prop-name';
      nameSpan.textContent = propName + ':';
      propRow.appendChild(nameSpan);
      const valSpan = document.createElement('span');
      valSpan.className = 'gallery-card-prop-val';
      valSpan.dataset.e2eId = ['gallery-card-property', dbPath, entityName, propName]
        .map(value => encodeURIComponent(String(value || ''))).join(':');
      valSpan.dataset.entityName = String(entityName || '');
      valSpan.dataset.propertyName = String(propName || '');
      if (!ptcG?.source && typeof _dbRichAppendValuePreview === 'function') {
        // 互換テスト用: _dbRichAppendValuePreview(valSpan, filterValues(entityData[propName] || []));
        _dbRichAppendValuePreview(valSpan, filterValues(entityData[propName] || [], undefined, ctx?.filter));
      } else {
        valSpan.textContent = displayVal;
      }
      if (!valSpan.textContent && !valSpan.children.length) valSpan.textContent = '—';
      propRow.appendChild(valSpan);
      _attachDbCardInlineEditor(valSpan, {
        dbPath, entityName, propName, propertyConfig: ptcG, values: entityData[propName] || [],
        entityData, ctx, readOnly: !!metadataSource,
      });
      propsDiv.appendChild(propRow);
      shown++;
    }
    // 有効な画像型列が無ければ画像領域は表示しない。列の表示順（cardPropNames の順序）で、
    // 各列ごとに独立したサムネブロックを追加する（列ごとに cardImageThumbCount 枚まで）。
    selectedImageCols.forEach(propName => {
      const vals = filterValues(entityData[propName] || [], undefined, ctx?.filter);
      const imageItems = _dbCardImageItemsFromValues(vals);
      if (!imageItems.length) {
        const empty = document.createElement('span');
        empty.className = 'gallery-card-image-preview';
        empty.textContent = '画像を追加';
        _attachDbCardInlineEditor(empty, {
          dbPath, entityName, propName, propertyConfig: propTypes[propName] || {},
          values: entityData[propName] || [], entityData, ctx,
        });
        card.appendChild(empty);
        return;
      }
      _appendDbCardImagePreview(card, imageItems, {
        className: 'gallery-card-image-preview',
        thumbCount: galleryCfg.cardImageThumbCount,
        columns: Math.min(2, galleryCfg.cardImageThumbCount),
        propName,
      });
    });
    card.appendChild(propsDiv);

    // リレーション表示
    const allRelations = [];
    Object.values(entityData).forEach(vals => {
      if (!Array.isArray(vals)) return;
      vals.forEach(v => {
        if (v.relations && v.relations.length > 0) {
          v.relations.forEach(r => allRelations.push(r));
        }
      });
    });
    if (allRelations.length > 0) {
      const relDiv = document.createElement('div');
      relDiv.className = 'relation-links';
      relDiv.style.marginTop = '6px';
      allRelations.slice(0, 3).forEach(r => {
        const link = document.createElement('span');
        link.className = 'relation-link';
        link.textContent = (r.entity || '') + (r.role ? ' (' + r.role + ')' : '');
        link.dataset.dbPath = r.db_path || r.dbPath || r.database || dbPath;
        link.dataset.entityName = r.entity || '';
        link.addEventListener('click', (e) => { e.stopPropagation(); navigateToEntity(r.entity, link.dataset.dbPath || dbPath, ctx); });
        relDiv.appendChild(link);
      });
      card.appendChild(relDiv);
    }

    grid.appendChild(card);
  });

  container.innerHTML = '';
  container.appendChild(toolbar);
  container.appendChild(grid);
}

// リレーションエントリへのナビゲーション
/* ==============================
   カンバンビュー
   ============================== */
function getKanbanGroupBy(dbPath, ctx) {
  return getCurrentDbViewTypeSpecific(dbPath, 'kanban', { ctx })?.groupBy || '_status';
}
function setKanbanGroupBy(dbPath, prop, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: カンバングループ', options.detail || prop || '', options, (v) => {
    if (!v.typeSpecific || typeof v.typeSpecific !== 'object' || Array.isArray(v.typeSpecific)) v.typeSpecific = {};
    if (!v.typeSpecific.kanban || typeof v.typeSpecific.kanban !== 'object' || Array.isArray(v.typeSpecific.kanban)) v.typeSpecific.kanban = {};
    v.typeSpecific.kanban.groupBy = prop;
  });
}

function _getKanbanConfig(dbPath, ctx) {
  const cfg = getCurrentDbViewTypeSpecific(dbPath, 'kanban', { ctx }) || {};
  const displayCfg = typeof _dbCardViewDisplayConfig === 'function'
    ? _dbCardViewDisplayConfig(cfg)
    : { cardImageThumbCount: 3, cardPropLineCount: 1 };
  return {
    groupBy: cfg.groupBy || '_status',
    showEntryName: cfg.showEntryName !== false,
    cardProps: Object.prototype.hasOwnProperty.call(cfg, 'cardProps') && Array.isArray(cfg.cardProps) ? cfg.cardProps : null,
    ...displayCfg,
  };
}

function _setKanbanDisplayProps(dbPath, cfg, options = {}) {
  const next = {
    ...cfg,
    cardProps: Array.isArray(cfg.cardProps) ? cfg.cardProps : [],
    showEntryName: cfg.showEntryName !== false,
    ...(typeof _dbCardViewDisplayConfig === 'function' ? _dbCardViewDisplayConfig(cfg) : {}),
  };
  setCurrentDbViewTypeSpecific(dbPath, 'kanban', next, {
    ctx: options.ctx || null,
    historyLabel: options.label || 'シート表示: カンバン表示列',
    detail: options.detail || '',
    skipHistory: options.skipHistory === true,
  });
}

function _kanbanDefaultCardProps(visibleProps, groupByProp) {
  return (visibleProps || []).filter(propName => propName !== groupByProp).slice(0, 3);
}

function _renderKanbanCardProps(root, card, propNames, ctx, options = {}) {
  const dbPath = ctx?.dbPath || state.currentDbPath;
  const propTypes = dbPath && typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath) : {};
  propNames.forEach(propName => {
    const vals = filterValues(card.data[propName] || [], undefined, ctx?.filter);
    const ptc = propTypes[propName] || {};
    if (ptc?.type === 'image') {
      const imageItems = _dbCardImageItemsFromValues(vals);
      if (imageItems.length) {
        _appendDbCardImagePreview(root, imageItems, {
          className: 'kanban-card-image-preview',
          propName,
          thumbCount: options.cardImageThumbCount,
        });
      } else {
        const empty = document.createElement('span');
        empty.className = 'kanban-card-image-preview';
        empty.dataset.e2eId = ['kanban-card-property', dbPath, card.name, propName]
          .map(value => encodeURIComponent(String(value || ''))).join(':');
        empty.textContent = '画像を追加';
        _attachDbCardInlineEditor(empty, {
          dbPath, entityName: card.name, propName, propertyConfig: ptc, values: card.data[propName] || [],
          entityData: card.data, ctx,
        });
        root.appendChild(empty);
      }
      return;
    }
    const propRow = document.createElement('div');
    propRow.className = 'kanban-card-prop';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'kanban-card-prop-name';
    nameSpan.textContent = propName + ': ';
    propRow.appendChild(nameSpan);
    const valueHost = document.createElement('span');
    valueHost.className = 'kanban-card-prop-value';
    valueHost.dataset.e2eId = ['kanban-card-property', dbPath, card.name, propName]
      .map(value => encodeURIComponent(String(value || ''))).join(':');
    if (typeof _dbRichAppendValuePreview === 'function' && vals.length) {
      _dbRichAppendValuePreview(valueHost, vals);
    } else {
      valueHost.textContent = vals.map(v => v.value).join(', ') || '—';
    }
    propRow.appendChild(valueHost);
    _attachDbCardInlineEditor(valueHost, {
      dbPath, entityName: card.name, propName, propertyConfig: ptc, values: card.data[propName] || [],
      entityData: card.data, ctx,
    });
    root.appendChild(propRow);
  });
}

function _showKanbanDisplayPropsMenu(anchor, dbPath, cfg, props, ctx) {
  document.querySelectorAll('.kanban-card-props-menu').forEach(el => el.remove());
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu tl-card-props-menu kanban-card-props-menu';
  menu.style.cssText = 'position:fixed;z-index:10000;min-width:240px;max-height:340px;overflow:auto;padding:6px;';
  let ordered = Array.isArray(cfg.cardProps) ? [...cfg.cardProps].filter(prop => props.includes(prop)) : [];
  let showEntryName = cfg.showEntryName !== false;
  let { cardImageThumbCount, cardPropLineCount } = typeof _dbCardViewDisplayConfig === 'function'
    ? _dbCardViewDisplayConfig(cfg)
    : { cardImageThumbCount: 3, cardPropLineCount: 1 };
  const save = (detail) => {
    _setKanbanDisplayProps(dbPath, { ...cfg, cardProps: ordered, showEntryName, cardImageThumbCount, cardPropLineCount }, { ctx, detail });
    renderKanban(ctx);
  };
  if (typeof _appendDbDisplayPropOption === 'function') {
    _appendDbDisplayPropOption(menu, 'トピック名', showEntryName, {
      onToggle(checked) {
        showEntryName = checked;
        save('トピック名');
      },
    });
    if (typeof _appendDbCardDisplayControls === 'function') {
      _appendDbCardDisplayControls(menu, { cardImageThumbCount, cardPropLineCount }, (next, detail) => {
        cardImageThumbCount = next.cardImageThumbCount;
        cardPropLineCount = next.cardPropLineCount;
        save(detail);
      });
    }
    props.forEach(prop => {
      _appendDbDisplayPropOption(menu, prop, ordered.includes(prop), {
        canMoveUp: ordered.indexOf(prop) > 0,
        canMoveDown: ordered.indexOf(prop) >= 0 && ordered.indexOf(prop) < ordered.length - 1,
        onToggle(checked) {
          ordered = checked ? [...ordered, prop].filter((name, idx, arr) => arr.indexOf(name) === idx) : ordered.filter(name => name !== prop);
          save(prop);
        },
        onMove(delta) {
          const idx = ordered.indexOf(prop);
          const nextIdx = idx + delta;
          if (idx < 0 || nextIdx < 0 || nextIdx >= ordered.length) return;
          [ordered[idx], ordered[nextIdx]] = [ordered[nextIdx], ordered[idx]];
          save(prop);
        },
      });
    });
  }
  document.body.appendChild(menu);
  if (typeof attachMeldexDropdownCloseButton === 'function') {
    attachMeldexDropdownCloseButton(menu, {
      trigger: anchor,
      className: 'kanban-card-props-menu-close',
      attr: 'data-kanban-card-props-close',
    });
  }
  if (typeof _positionTimelineCardPropsMenu === 'function') _positionTimelineCardPropsMenu(menu, anchor);
  else if (typeof positionPopup === 'function') positionPopup(menu, anchor.getBoundingClientRect());
  setTimeout(() => {
    const closer = (ev) => {
      if (!menu.contains(ev.target) && ev.target !== anchor && !anchor.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('pointerdown', closer);
      }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

function _buildKanbanToolbar(dbPath, groupByProp, visibleProps, kanbanCfg, activeCardProps, ctx) {
  const toolbar = document.createElement('div');
  toolbar.className = 'db-card-view-toolbar kanban-card-view-toolbar';
  const label = document.createElement('span');
  label.className = 'chart-label';
  label.textContent = 'グループ化';
  toolbar.appendChild(label);

  const sel = document.createElement('select');
  sel.className = 'chart-select';
  sel.dataset.e2eId = 'kanban-group-by-select';
  sel.setAttribute('aria-label', 'カンバンのグループ化');
  const optStatus = document.createElement('option');
  optStatus.value = '_status'; optStatus.textContent = 'ステータス';
  if (groupByProp === '_status') optStatus.selected = true;
  sel.appendChild(optStatus);
  visibleProps.filter(p => _isKanbanGroupableProperty(dbPath, p)).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p; opt.textContent = p;
    if (groupByProp === p) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.onchange = () => { setKanbanGroupBy(dbPath, sel.value, { ctx }); renderKanban(ctx); };
  toolbar.appendChild(sel);

  const displayPropsBtn = document.createElement('button');
  displayPropsBtn.type = 'button';
  displayPropsBtn.className = 'tl-nav-btn db-card-view-toolbar-btn';
  displayPropsBtn.title = 'カードに表示する列';
  displayPropsBtn.dataset.e2eId = 'kanban-display-props';
  displayPropsBtn.innerHTML = (typeof lucide === 'function' ? lucide('listPlus', 12) + ' ' : '') + '表示列' + (activeCardProps.length ? ' (' + activeCardProps.length + ')' : '');
  displayPropsBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    _showKanbanDisplayPropsMenu(ev.currentTarget, dbPath, { ...kanbanCfg, groupBy: groupByProp, cardProps: activeCardProps }, visibleProps.filter(p => p !== groupByProp), ctx);
  });
  toolbar.appendChild(displayPropsBtn);
  return toolbar;
}

function renderKanban(ctx) {
  ctx = ctx || _currentPaneState();
  const data = ctx.pivotData || state.pivotData;
  const container = _dbViewSurfaceEl(ctx, '.kanban-view', 'kanban-view');
  if (!container) {
    if (typeof showStatus === 'function') showStatus('シートのカンバン表示領域を準備できませんでした。シートを開き直してください。', true);
    return;
  }
  container.style.display = 'flex';
  if (!data || !data.entities) { container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--fg2);">データがありません</div>'; return; }

  const dbPath = ctx.dbPath || state.currentDbPath;
  const entitiesMap = data.entities;
  const advFilters = getAdvancedFilters(dbPath, { ctx });
  const columnValueFilters = typeof getColumnValueFilters === 'function' ? getColumnValueFilters(dbPath, { ctx }) : {};
  const propTypes = getPropertyTypes(dbPath);
  const entityNames = typeof _dbSortedEntityNames === 'function'
    ? _dbSortedEntityNames(data, dbPath, ctx, { applyAdvancedFilters: true, advFilters, columnValueFilters, propTypes })
    : Object.keys(entitiesMap)
      .filter(name => _dbEntityPassesAdvancedFilters(entitiesMap[name], advFilters, ctx?.filter)
        && (typeof _dbEntityPassesColumnValueFilters !== 'function'
          || _dbEntityPassesColumnValueFilters(name, entitiesMap[name], columnValueFilters, dbPath, ctx, ctx?.filter)))
      .sort();
  ctx._lastEntityNames = [...entityNames];
  if (entityNames.length === 0) {
    if (typeof _dbRenderEmptyStateWithCreate === 'function') {
      _dbRenderEmptyStateWithCreate(container, 'columns', 'トピックがありません', 'トピックを追加して開始してください', ctx);
    } else {
      renderEmptyState(container, 'columns', 'トピックがありません', 'トピックを追加して開始してください');
    }
    return;
  }
  const hiddenCols = getHiddenCols(dbPath, { ctx });
  const colOrder = getColOrder(dbPath, { ctx });
  let orderedProps = colOrder ? colOrder.filter(p => data.properties.includes(p)) : [...data.properties];
  data.properties.forEach(p => { if (!orderedProps.includes(p)) orderedProps.push(p); });
  if (typeof filterDeletedDbProperties === 'function') orderedProps = filterDeletedDbProperties(dbPath, orderedProps);
  const visibleProps = orderedProps.filter(p => !hiddenCols.includes(p));
  const kanbanCfg = _getKanbanConfig(dbPath, ctx);
  let groupByProp = kanbanCfg.groupBy || getKanbanGroupBy(dbPath, ctx);
  if (groupByProp !== '_status' && !_isKanbanGroupableProperty(dbPath, groupByProp)) {
    groupByProp = '_status';
    setKanbanGroupBy(dbPath, groupByProp, { ctx, skipHistory: true });
  }

  // グループ化: ステータスまたはSelect型プロパティで分類
  const columns = new Map();

  if (groupByProp === '_status') {
    // ステータスベースのカンバン
    const statusDefs = _kanbanStatusDefs(dbPath);
    statusDefs.forEach(st => columns.set(st.name, []));

    entityNames.forEach(entityName => {
      const entityData = entitiesMap[entityName];
      const mainStatus = _kanbanEntityMainStatus(entityData, dbPath);
      if (!columns.has(mainStatus)) columns.set(mainStatus, []);
      columns.get(mainStatus).push({ name: entityName, data: entityData, status: mainStatus });
    });
  } else {
    // プロパティベースのカンバン
    entityNames.forEach(entityName => {
      const entityData = entitiesMap[entityName];
      const vals = filterValues(entityData[groupByProp] || [], undefined, ctx?.filter);
      const groupKey = vals.length > 0 ? vals[0].value : '(未設定)';
      if (!columns.has(groupKey)) columns.set(groupKey, []);
      columns.get(groupKey).push({ name: entityName, data: entityData, groupValue: groupKey });
    });
  }

  const activeCardProps = Array.isArray(kanbanCfg.cardProps) ? kanbanCfg.cardProps : _kanbanDefaultCardProps(visibleProps, groupByProp);
  const toolbar = _buildKanbanToolbar(dbPath, groupByProp, visibleProps, kanbanCfg, activeCardProps, ctx);

  // ボード描画
  const board = document.createElement('div');
  board.className = 'kanban-board';

  const statusColors = new Map(_kanbanStatusDefs(dbPath).map(st => [st.name, st.color]));

  columns.forEach((cards, colKey) => {
    const col = document.createElement('div');
    col.className = 'kanban-column';

    // カラムヘッダー
    const colHeader = document.createElement('div');
    colHeader.className = 'kanban-column-header';
    let optionHeaderColor = '';
    if (groupByProp === '_status') {
      const dot = document.createElement('span');
      dot.className = 'kanban-dot';
      dot.style.background = statusColors.get(colKey) || (typeof _getStatusColor === 'function' ? _getStatusColor(colKey, dbPath) : '#888');
      colHeader.appendChild(dot);
    } else if (typeof createDbOptionColorDot === 'function' && typeof getDbOptionColor === 'function') {
      const groupPtc = propTypes[groupByProp];
      if (groupPtc && (groupPtc.type === 'select' || groupPtc.type === 'multi-select')) {
        optionHeaderColor = getDbOptionColor(groupPtc, colKey);
        const optionDot = createDbOptionColorDot(optionHeaderColor);
        if (optionDot) { optionDot.classList.add('kanban-dot'); colHeader.appendChild(optionDot); }
      }
    }
    if (typeof applyDbOptionHeaderColor === 'function') applyDbOptionHeaderColor(colHeader, optionHeaderColor);
    const colTitle = document.createElement('span');
    colTitle.textContent = colKey;
    colHeader.appendChild(colTitle);
    const countBadge = document.createElement('span');
    countBadge.className = 'kanban-count';
    countBadge.textContent = cards.length;
    colHeader.appendChild(countBadge);
    col.appendChild(colHeader);

    // カラムボディ（カード一覧 + D&Dドロップ先）
    const colBody = document.createElement('div');
    colBody.className = 'kanban-column-body';
    colBody.dataset.column = colKey;

    // D&D: ドロップ先
    colBody.addEventListener('dragover', (e) => { e.preventDefault(); colBody.classList.add('drag-over'); });
    colBody.addEventListener('dragleave', () => colBody.classList.remove('drag-over'));
    colBody.addEventListener('drop', async (e) => {
      e.preventDefault();
      colBody.classList.remove('drag-over');
      const entityName = e.dataTransfer.getData('text/x-kanban-entity');
      if (!entityName) return;

      // ロックチェック（プロパティベースのグループ化の場合）
      if (groupByProp !== '_status') {
        const lockMsg = checkColumnEditable(dbPath, groupByProp);
        if (lockMsg) { showStatus(lockMsg); return; }
      }

      if (groupByProp === '_status') {
        // ステータスベース: 代表候補だけを変更し、案/ボツなどの別候補を巻き込まない
        const entityData = entitiesMap[entityName];
        const statusWriteOps = [];
        const autoFillOps = [];
        try {
          const statusTargets = _kanbanStatusMoveTargets(entityData, dbPath);
          for (const target of statusTargets) {
            if (target.old === colKey) continue;
            await _apiPutValue(target.ref, { new_status: colKey });
            statusWriteOps.push(target);
            if (typeof _autoFillOnStatusChange === 'function') {
              const entityPath = _entityPath(dbPath, entityName);
              const ops = await _autoFillOnStatusChange(entityPath, target.propName, colKey, dbPath, { ctx });
              if (Array.isArray(ops)) autoFillOps.push(...ops);
            }
          }
        } catch(err) {
          await _rollbackKanbanStatusMove(statusWriteOps, autoFillOps);
          showStatus('ステータス更新に失敗: ' + (err.message || err), true);
          await selectDatabase(dbPath, ctx);
          return;
        }
        if (statusWriteOps.length > 0) {
          historyPush('カンバン移動: ' + entityName + ' → ' + colKey,
            async () => {
              if (typeof _undoAutoFillStatusOps === 'function') await _undoAutoFillStatusOps(autoFillOps);
              for (const s of [...statusWriteOps].reverse()) { try { await _apiPutValue(s.ref, { new_status: s.old }); } catch {} }
              await selectDatabase(dbPath, ctx);
            },
            async () => {
              for (const s of statusWriteOps) { try { await _apiPutValue(s.ref, { new_status: colKey }); } catch {} }
              if (typeof _redoAutoFillStatusOps === 'function') await _redoAutoFillStatusOps(autoFillOps);
              await selectDatabase(dbPath, ctx);
            },
            _dbScope(dbPath)
          );
        }
      } else {
        // プロパティベース: 該当プロパティの採用値を変更
        const entityData = entitiesMap[entityName];
        const rawVals = entityData[groupByProp] || [];
        // 案/ボツの先頭候補を書き換えないよう、採用/掲載済みの代表候補だけを対象にする
        const target = _kanbanAdoptedValueForWrite(rawVals);
        if (target) {
          const oldVal = target.value || '';
          try {
            if (colKey === '(未設定)') {
              const ok = await (typeof cfConfirm === 'function'
                ? cfConfirm(`「${entityName}」の「${groupByProp}」を未設定にします。\n\n現在の値は削除されますが、元に戻せるよう履歴へ記録します。続行しますか？`)
                : Promise.resolve(window.confirm(`「${entityName}」の値を未設定にしますか？`)));
              if (!ok) return;
              const oldStatus = target.status || '採用';
              const oldNote = target.note || '';
              const oldRichHtml = target.rich_html || '';
              const oldRelations = Array.isArray(target.relations) ? JSON.parse(JSON.stringify(target.relations)) : [];
              const oldPublishedIn = Array.isArray(target.published_in) ? JSON.parse(JSON.stringify(target.published_in)) : [];
              const entityPath = _entityPath(dbPath, entityName);
              let currentRef = { file: target.file, entry_path: entityPath, property: target.property || groupByProp, candidate_index: target.candidate_index };
              await _apiPutValue(target, { _delete: true });
              historyPush('カンバン移動: ' + entityName,
                async () => {
                  const result = await _apiPostValue(entityPath, groupByProp, oldVal, oldStatus, oldNote, oldRichHtml, {
                    relations: oldRelations,
                    published_in: oldPublishedIn,
                    created: target.created || '',
                  });
                  currentRef = { file: result?.path || result?.file || currentRef.file, entry_path: entityPath, property: result?.property || groupByProp, candidate_index: result?.candidate_index };
                  await selectDatabase(dbPath, ctx);
                },
                async () => { await _apiPutValue(currentRef, { _delete: true }); await selectDatabase(dbPath, ctx); },
                _dbScope(dbPath)
              );
            } else {
              await _apiPutValue(target, { new_value: colKey });
              _dbUndoValue('カンバン移動: ' + entityName, target, oldVal, colKey);
            }
          } catch(err) {
            showStatus('値の更新に失敗: ' + (err.message || err), true);
            await selectDatabase(dbPath, ctx);
            return;
          }
        } else {
          // 値が存在しない場合は新規に採用値を追加
          if (colKey !== '(未設定)') {
            try {
              const entityPath = _entityPath(dbPath, entityName);
              const result = await _apiPostValue(entityPath, groupByProp, colKey, '採用', '');
              let createdRef = { file: result?.path || result?.file, entry_path: entityPath, property: result?.property || groupByProp, candidate_index: result?.candidate_index };
              if (createdRef.file) {
                historyPush('カンバン移動: ' + entityName,
                  async () => { await _apiPutValue(createdRef, { _delete: true }); await selectDatabase(dbPath, ctx); },
                  async () => {
                    const redo = await _apiPostValue(entityPath, groupByProp, colKey, '採用', '');
                    createdRef = { file: redo?.path || redo?.file || createdRef.file, entry_path: entityPath, property: redo?.property || groupByProp, candidate_index: redo?.candidate_index };
                    await selectDatabase(dbPath, ctx);
                  },
                  _dbScope(dbPath)
                );
              }
            } catch(err) { showStatus('値の更新に失敗: ' + (err.message || err), true); await selectDatabase(dbPath, ctx); return; }
          }
        }
      }
      showStatus(entityName + ' → ' + colKey);
      selectDatabase(dbPath, ctx);
    });

    // カード描画
    cards.forEach(card => {
      const cardEl = document.createElement('div');
      cardEl.className = 'kanban-card';
      cardEl.dataset.entity = card.name;
      cardEl.dataset.entityName = card.name;
      cardEl.dataset.meldexEntityPath = _entityPath(dbPath, card.name, ctx?.pivotData);
      cardEl.draggable = true;

      // D&D: ドラッグ開始
      cardEl.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/x-kanban-entity', card.name);
        window.MeldexBoardTransfer?.setEntityDragData?.(
          e.dataTransfer,
          dbPath,
          card.name,
          cardEl.dataset.meldexEntityPath,
        );
        e.dataTransfer.effectAllowed = 'copyMove';
        cardEl.classList.add('dragging');
      });
      cardEl.addEventListener('dragend', () => cardEl.classList.remove('dragging'));

      // クリック: サイドバーに詳細表示
      cardEl.addEventListener('click', () => openEntityInSplit(_entityPath(dbPath, card.name), card.name));
      cardEl.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        if (typeof _navPushWithViewState === 'function') _navPushWithViewState(ctx, card.name);
        selectEntity(_entityPath(dbPath, card.name));
      });
      cardEl.addEventListener('contextmenu', (e) => { e.preventDefault(); showDbCardContextMenu(e, dbPath, card.name); });
      if (typeof addLongPressHandler === 'function') {
        addLongPressHandler(cardEl, (e) => showDbCardContextMenu(e, dbPath, card.name));
      }

      // タッチ用メニューボタン
      const moreBtn = document.createElement('span');
      moreBtn.className = 'card-more-btn';
      moreBtn.innerHTML = lucide('moreHorizontal', 12);
      moreBtn.title = 'メニュー';
      moreBtn.style.cssText = 'position:absolute;top:4px;right:4px;cursor:pointer;font-size:14px;color:var(--fg2);padding:2px 4px;border-radius:3px;z-index:5;';
      moreBtn.addEventListener('click', (e) => { e.stopPropagation(); showDbCardContextMenu(e, dbPath, card.name); });
      cardEl.style.position = 'relative';
      cardEl.style.setProperty('--db-card-prop-lines', String(kanbanCfg.cardPropLineCount));
      cardEl.appendChild(moreBtn);

      if (kanbanCfg.showEntryName !== false) {
        const title = document.createElement('div');
        title.className = 'kanban-card-title';
        title.textContent = card.name;
        cardEl.appendChild(title);
      }

      const propsDiv = document.createElement('div');
      propsDiv.className = 'kanban-card-props';
      const cardPropNames = Array.isArray(kanbanCfg.cardProps)
        ? kanbanCfg.cardProps.filter(propName => visibleProps.includes(propName) && propName !== groupByProp)
        : _kanbanDefaultCardProps(visibleProps, groupByProp);
      _renderKanbanCardProps(propsDiv, card, cardPropNames, ctx, {
        cardImageThumbCount: kanbanCfg.cardImageThumbCount,
      });
      cardEl.appendChild(propsDiv);

      colBody.appendChild(cardEl);
    });

    col.appendChild(colBody);
    board.appendChild(col);
  });

  container.innerHTML = '';
  container.appendChild(toolbar);
  container.appendChild(board);
}

/* ==============================
   タイムラインビュー
   ============================== */
