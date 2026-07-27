/**
 * gb-db-calendar-mapping.js
 * 任意DBの日時プロパティをカレンダー表示へマッピングし、日時変更を書き戻す
 */

function _normalizeCalendarMapping(mapping) {
  if (!mapping || typeof mapping !== 'object') return null;
  const norm = {
    startProp: String(mapping.startProp || '').trim(),
    endProp: String(mapping.endProp || '').trim(),
    titleProp: String(mapping.titleProp || '').trim(),
    colorProp: String(mapping.colorProp || '').trim(),
    descriptionProp: String(mapping.descriptionProp || '').trim(),
    locationProp: String(mapping.locationProp || '').trim(),
    urlProp: String(mapping.urlProp || '').trim(),
    calendarIdProp: String(mapping.calendarIdProp || '').trim(),
  };
  return norm.startProp ? norm : null;
}

function getCalendarMapping(dbPath, options = {}) {
  const ctx = options.ctx || null;
  if (ctx?.dbPath === dbPath && ctx.dbMetadata && Object.prototype.hasOwnProperty.call(ctx.dbMetadata, 'calendar_mapping')) {
    const metadataMapping = _normalizeCalendarMapping(ctx.dbMetadata?.calendar_mapping);
    if (metadataMapping) return metadataMapping;
  }
  if (state.currentDbPath === dbPath && state.dbMetadata && Object.prototype.hasOwnProperty.call(state.dbMetadata, 'calendar_mapping')) {
    const metadataMapping = _normalizeCalendarMapping(state.dbMetadata?.calendar_mapping);
    if (metadataMapping) return metadataMapping;
  }
  const local = _normalizeCalendarMapping(getCurrentDbViewTypeSpecific(dbPath, 'calendar', { ctx })?.mapping);
  return local || null;
}

function _dbHasCalendarMapping(dbPath, pivotData, ctx) {
  const mapping = getCalendarMapping(dbPath, { ctx });
  if (!mapping?.startProp) return false;
  const props = pivotData?.properties || state.pivotData?.properties || [];
  return props.includes(mapping.startProp);
}

function _getCalendarIntegrationInfo(dbPath, pivotData, ctx) {
  const data = pivotData || state.pivotData;
  const mapping = getCalendarMapping(dbPath, { ctx });
  const isCalendarSource = !!data?.calendar_db;
  const hasMapping = !isCalendarSource && _dbHasCalendarMapping(dbPath, data, ctx);
  return {
    kind: isCalendarSource ? 'calendar-db' : hasMapping ? 'mapped-db' : 'none',
    isMappedDb: hasMapping,
    canEditDates: isCalendarSource || hasMapping,
    canCreateEvents: isCalendarSource,
    canDeleteEvents: isCalendarSource,
    canSyncExternal: isCalendarSource,
    mapping: hasMapping ? mapping : null,
  };
}

function _canRenderCalendarFromDb(dbPath, pivotData, ctx) {
  const info = _getCalendarIntegrationInfo(dbPath, pivotData, ctx);
  return info.kind !== 'none';
}

function _getAllowedCalendarModes(dbPath, pivotData) {
  return [
    { v: 'month', l: '月' },
    { v: 'week', l: '週' },
    { v: 'day', l: '日' },
  ];
}

function _normalizeCalendarModeForDb(dbPath, mode, pivotData) {
  const allowed = new Set(_getAllowedCalendarModes(dbPath, pivotData).map(m => m.v));
  return allowed.has(mode) ? mode : 'month';
}

function _calendarPropValue(props, propName, filterMode) {
  const ref = _calendarPropRef(props, propName, filterMode);
  return ref ? (ref.value || '') : '';
}

function _calendarPropRef(props, propName, filterMode) {
  if (!propName) return null;
  const vals = typeof filterValues === 'function' ? filterValues(props[propName] || [], undefined, filterMode) : (props[propName] || []);
  if (!vals.length) return null;
  if (typeof getAdoptedValueForWrite === 'function') return getAdoptedValueForWrite(vals) || vals[0];
  return vals.find(v => v && (v.status === '採用' || v.status === '掲載済み')) || vals[0];
}

function _collectMappedCalendarEvents(dbPath, data, ctx) {
  const info = _getCalendarIntegrationInfo(dbPath, data, ctx);
  const mapping = info.mapping;
  if (!mapping) return [];
  const propTypes = typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath) : {};
  const startPtc = propTypes[mapping.startProp] || {};
  const events = [];

  for (const [entityName, props] of Object.entries(data.entities || {})) {
    const filterMode = ctx?.filter;
    const startRaw = _calendarPropValue(props, mapping.startProp, filterMode);
    if (!startRaw) continue;
    const startParsed = typeof _dbDateParseValue === 'function' ? _dbDateParseValue(startRaw) : null;
    const startToken = startParsed?.start || startRaw;
    if (!startToken) continue;
    const start = (typeof parseLocalDate === 'function') ? parseLocalDate(startToken) : new Date(startToken);
    if (Number.isNaN(start.getTime())) continue;

    let endToken = '';
    if (mapping.endProp) {
      const endRaw = _calendarPropValue(props, mapping.endProp, filterMode);
      if (mapping.endProp === mapping.startProp && startParsed?.range) {
        endToken = startParsed.end || '';
      } else if (typeof _dbDateGetComparableValue === 'function') {
        endToken = _dbDateGetComparableValue(endRaw, true) || '';
      } else {
        endToken = endRaw;
      }
    } else if (startParsed?.range) {
      endToken = startParsed.end || '';
    }
    let end = endToken
      ? ((typeof parseLocalDate === 'function') ? parseLocalDate(endToken) : new Date(endToken))
      : new Date(start);
    if (Number.isNaN(end.getTime()) || end < start) end = new Date(start);

    const hasTime = !!startPtc.withTime
      || (typeof _dbDateHasTimeToken === 'function' && (_dbDateHasTimeToken(startToken) || _dbDateHasTimeToken(endToken)));
    const supportsEnd = !!(mapping.endProp || startPtc.range || startParsed?.range);
    const title = _calendarPropValue(props, mapping.titleProp, filterMode) || entityName;
    const color = _calendarPropValue(props, mapping.colorProp, filterMode) || '#569cd6';
    const description = _calendarPropValue(props, mapping.descriptionProp, filterMode) || '';
    const location = _calendarPropValue(props, mapping.locationProp, filterMode) || '';
    const url = _calendarPropValue(props, mapping.urlProp, filterMode) || '';
    const calendarId = _calendarPropValue(props, mapping.calendarIdProp, filterMode) || 'default';
    const entityPath = typeof _entityPath === 'function' ? _entityPath(dbPath, entityName) : '';
    const startRef = _calendarPropRef(props, mapping.startProp, filterMode);

    events.push({
      name: title,
      entityName,
      entityPath,
      file: startRef?.file || entityPath,
      start,
      end,
      color,
      allDay: !hasTime,
      location,
      description,
      calendarId,
      url,
      alertMinutes: -1,
      recurrence: '',
      _mapped: true,
      _mappedDbPath: dbPath,
      _mappedCtx: ctx || null,
      _mappedPivotData: data,
      _mappedMapping: mapping,
      _mappedEntityData: props,
      _mappedSupportsEnd: supportsEnd,
    });
  }

  return events;
}

function _collectCalendarEventsForDb(dbPath, data, ctx) {
  const info = _getCalendarIntegrationInfo(dbPath, data, ctx);
  if (info.kind === 'calendar-db') return typeof _collectCalendarEvents === 'function' ? _collectCalendarEvents(data, dbPath) : [];
  if (info.kind === 'mapped-db') return _collectMappedCalendarEvents(dbPath, data, ctx);
  return [];
}

function _getMappedCalendarUpdateContext(dbPath, ev) {
  if (!ev?._mapped) return null;
  const sourceDbPath = ev._mappedDbPath || dbPath;
  const paneCtx = ev._mappedCtx || null;
  const pivotData = ev._mappedPivotData
    || (paneCtx?.dbPath === sourceDbPath ? paneCtx.pivotData : null)
    || (state.currentDbPath === sourceDbPath ? state.pivotData : null)
    || null;
  const info = ev._mappedMapping
    ? { kind: 'mapped-db', isMappedDb: true, canEditDates: true, mapping: ev._mappedMapping }
    : _getCalendarIntegrationInfo(sourceDbPath, pivotData, paneCtx);
  const mapping = info.mapping;
  const entityData = ev._mappedEntityData || pivotData?.entities?.[ev.entityName];
  if (!mapping || !entityData) return null;
  const filterMode = paneCtx?.filter;
  const propTypes = typeof getPropertyTypes === 'function' ? getPropertyTypes(sourceDbPath) : {};
  const startPtc = propTypes[mapping.startProp] || {};
  const startVal = _calendarPropRef(entityData, mapping.startProp, filterMode);
  if (!startVal) return null;
  const startRaw = startVal.value || '';
  const parsed = typeof _dbDateParseValue === 'function' ? _dbDateParseValue(startRaw) : null;
  const inlineRange = mapping.endProp === mapping.startProp || (!mapping.endProp && (startPtc.range || parsed?.range));
  const endVal = mapping.endProp && mapping.endProp !== mapping.startProp ? _calendarPropRef(entityData, mapping.endProp, filterMode) : null;
  const endPtc = mapping.endProp && mapping.endProp !== mapping.startProp ? (propTypes[mapping.endProp] || {}) : startPtc;
  return {
    info,
    mapping,
    entityData,
    propTypes,
    startPtc,
    endPtc,
    startVal,
    endVal,
    inlineRange,
    startRaw,
    endRaw: inlineRange ? (parsed?.end || '') : (endVal?.value || ''),
    entityPath: ev.entityPath || (typeof _entityPath === 'function' ? _entityPath(sourceDbPath, ev.entityName) : ''),
  };
}

function _mappedCalendarDateValue(date, ptc, oldRaw) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const withTime = !!ptc?.withTime || (typeof _dbDateHasTimeToken === 'function' && _dbDateHasTimeToken(oldRaw || ''));
  // フォールバックはローカル日時に揃える（toISOString は UTC 出力で日付ズレを起こす）
  if (typeof _dbDateValueFromDate === 'function') return _dbDateValueFromDate(date, withTime);
  if (withTime && typeof formatLocalDateTime === 'function') return formatLocalDateTime(date);
  if (typeof formatLocalDate === 'function') return formatLocalDate(date);
  return '';
}

function _calendarMappingHistoryScope(dbPath) {
  if (typeof _dbViewConfigHistoryScope === 'function') return _dbViewConfigHistoryScope(dbPath);
  return typeof _dbScope === 'function' ? _dbScope(dbPath) : ('db:' + String(dbPath || '').split('/').pop());
}

async function _saveMappedCalendarDates(dbPath, ev, startDate, endDate, options = {}) {
  const ctx = _getMappedCalendarUpdateContext(dbPath, ev);
  if (!ctx) throw new Error('マッピング元の日時列を解決できません');
  const reloadCtx = options.ctx || ev?._mappedCtx || null;
  const startValue = _mappedCalendarDateValue(startDate, ctx.startPtc, ctx.startRaw);
  const clearEndIfMissing = !!options.clearEndIfMissing;
  const preserveEmptyEnd = !!options.preserveMissingEndIfZeroDuration
    && !ctx.endRaw
    && (!(endDate instanceof Date) || Number.isNaN(endDate.getTime()) || endDate.getTime() === startDate.getTime());
  let endValue = '';
  if (ctx.inlineRange) {
    endValue = (clearEndIfMissing || preserveEmptyEnd) ? '' : _mappedCalendarDateValue(endDate || startDate, ctx.endPtc, ctx.endRaw);
  } else if (ctx.mapping.endProp) {
    endValue = (clearEndIfMissing || preserveEmptyEnd) ? '' : _mappedCalendarDateValue(endDate || startDate, ctx.endPtc, ctx.endRaw);
  }
  const newStartRaw = ctx.inlineRange
    ? _dbDateSerializeValue(startValue, endValue, ctx.startPtc, ctx.startRaw)
    : startValue;

  const dbPathForHistory = dbPath;
  const startRef = { file: ctx.startVal.file, entry_path: ctx.entityPath, property: ctx.startVal.property, candidate_index: ctx.startVal.candidate_index };
  const oldStartRaw = ctx.startRaw;
  const oldEndRaw = ctx.endRaw;
  let createdEndRef = null;

  const deleteCreatedEnd = async (ref) => {
    if (!ref) return;
    try { await _apiPutValue(ref, { _delete: true }); } catch {}
  };

  const applyValues = async (startRaw, endRaw, mode, opts = {}) => {
    let startWritten = false;
    let localCreatedEndRef = null;
    try {
      await _apiPutValue(startRef, { new_value: startRaw });
      startWritten = true;
      if (!ctx.inlineRange && ctx.mapping.endProp) {
        if (ctx.endVal) {
          await _apiPutValue({ file: ctx.endVal.file, entry_path: ctx.entityPath, property: ctx.endVal.property, candidate_index: ctx.endVal.candidate_index }, { new_value: endRaw });
        } else if (endRaw && (mode === 'redo' || mode === 'apply')) {
          const res = await _apiPostValue(ctx.entityPath, ctx.mapping.endProp, endRaw, '採用', '');
          createdEndRef = { file: res?.path, entry_path: ctx.entityPath, property: res?.property || ctx.mapping.endProp, candidate_index: res?.candidate_index };
          localCreatedEndRef = createdEndRef;
        }
      }
    } catch (err) {
      if (opts.rollbackOnFailure) {
        if (localCreatedEndRef) await deleteCreatedEnd(localCreatedEndRef);
        if (startWritten) {
          try { await _apiPutValue(startRef, { new_value: oldStartRaw }); } catch {}
        }
      }
      throw err;
    }
  };

  await applyValues(newStartRaw, endValue, 'apply', { rollbackOnFailure: true });

  if (typeof historyPush === 'function' && typeof _dbScope === 'function') {
    historyPush(
      'カレンダー日時更新: ' + (ev.name || ev.entityName || ''),
      async () => {
        await _apiPutValue(startRef, { new_value: oldStartRaw });
        if (!ctx.inlineRange && ctx.mapping.endProp) {
          if (ctx.endVal) {
            await _apiPutValue({ file: ctx.endVal.file, entry_path: ctx.entityPath, property: ctx.endVal.property, candidate_index: ctx.endVal.candidate_index }, { new_value: oldEndRaw });
          } else if (createdEndRef) {
            await _apiPutValue(createdEndRef, { _delete: true });
          }
        }
        await selectDatabase(dbPathForHistory, reloadCtx);
      },
      async () => {
        await applyValues(newStartRaw, endValue, 'redo');
        await selectDatabase(dbPathForHistory, reloadCtx);
      },
      _calendarMappingHistoryScope(dbPathForHistory)
    );
  }

  if (!options.skipReload) await selectDatabase(dbPath, reloadCtx);
  return { startRaw: newStartRaw, endRaw: endValue };
}

let _mappedCalendarPanelSeq = 0;

function _focusMappedCalendarTrigger(triggerEl) {
  if (!triggerEl || !triggerEl.isConnected || typeof triggerEl.focus !== 'function') return;
  try {
    const isNaturallyFocusable = /^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/i.test(triggerEl.tagName || '');
    if (!isNaturallyFocusable && !triggerEl.hasAttribute('tabindex')) triggerEl.tabIndex = -1;
    triggerEl.focus({ preventScroll: true });
  } catch {
    try { triggerEl.focus(); } catch {}
  }
}

function _buildMappedCalendarInput(label, value, withTime, inputId, e2eId) {
  const wrap = document.createElement('div');
  wrap.className = 'field gb-field mapped-calendar-date-field';
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;font-size:12px;';
  const title = document.createElement('label');
  title.className = 'gb-label';
  title.setAttribute('for', inputId);
  title.textContent = label;
  const input = document.createElement('input');
  input.id = inputId;
  input.className = 'gb-input';
  input.dataset.e2eId = e2eId || inputId;
  input.type = withTime ? 'datetime-local' : 'date';
  input.value = typeof _dbDateToInputValue === 'function' ? _dbDateToInputValue(value, withTime) : (value || '');
  input.style.cssText = 'width:100%;box-sizing:border-box;';
  wrap.appendChild(title);
  wrap.appendChild(input);
  return { wrap, input };
}

function _openMappedCalendarEventPanel(dbPath, ev, triggerEl = null) {
  const ctx = _getMappedCalendarUpdateContext(dbPath, ev);
  if (!ctx) {
    showStatus('マッピング元の日時列を解決できません', true);
    return;
  }
  const panelSeq = ++_mappedCalendarPanelSeq;
  const titleId = `mapped-cal-title-${panelSeq}`;
  const descId = `mapped-cal-desc-${panelSeq}`;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.mappedCalendarPanel = '1';
  const modal = document.createElement('div');
  modal.className = 'modal mapped-calendar-event-panel';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', titleId);
  modal.setAttribute('aria-describedby', descId);
  modal.tabIndex = -1;
  modal.style.cssText = 'min-width:0;width:min(520px,95vw);max-width:min(520px,95vw);';
  const startWithTime = !!ctx.startPtc.withTime || (typeof _dbDateHasTimeToken === 'function' && _dbDateHasTimeToken(ctx.startRaw));
  const endWithTime = !!ctx.endPtc.withTime || (typeof _dbDateHasTimeToken === 'function' && _dbDateHasTimeToken(ctx.endRaw));
  const startField = _buildMappedCalendarInput('開始', ctx.startRaw, startWithTime, `mapped-cal-start-${panelSeq}`, 'mapped-cal-start');
  const endField = (ctx.inlineRange || ctx.mapping.endProp || ev._mappedSupportsEnd)
    ? _buildMappedCalendarInput('終了', ctx.inlineRange ? ctx.endRaw : ctx.endRaw, endWithTime || startWithTime, `mapped-cal-end-${panelSeq}`, 'mapped-cal-end')
    : null;

  modal.innerHTML = `
    <h3 id="${titleId}">${esc(ev.name || ev.entityName || '予定')}</h3>
    <div id="${descId}" style="font-size:12px;color:var(--fg2);margin-bottom:8px;">
      日時のみここで編集できます ${fieldHelp('タイトルや色は元エントリ側で変更してください')}
    </div>
    <div id="mapped-cal-fields" style="display:flex;flex-direction:column;gap:8px;"></div>
    <div class="btn-row" data-modal-footer style="justify-content:space-between;margin-top:12px;">
      <button type="button" class="gb-btn gb-btn-sm" id="mapped-cal-open" data-e2e-id="mapped-cal-open" style="min-height:44px;">エントリを開く</button>
      <div style="display:flex;gap:8px;">
        <button type="button" class="gb-btn gb-btn-sm" id="mapped-cal-cancel" data-e2e-id="mapped-cal-cancel" style="min-height:44px;">キャンセル</button>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-primary primary" id="mapped-cal-save" data-e2e-id="mapped-cal-save" style="min-height:44px;">保存</button>
      </div>
    </div>
  `;
  overlay.appendChild(modal);
  let closed = false;
  const closePanel = (options = {}) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
    if (options.restoreFocus !== false) {
      _focusMappedCalendarTrigger(triggerEl);
      setTimeout(() => _focusMappedCalendarTrigger(triggerEl), 0);
      setTimeout(() => _focusMappedCalendarTrigger(triggerEl), 60);
    }
  };
  const onKeyDown = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    closePanel();
  };
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) closePanel();
  });
  document.addEventListener('keydown', onKeyDown);
  document.body.appendChild(overlay);

  const fields = modal.querySelector('#mapped-cal-fields');
  fields.appendChild(startField.wrap);
  if (endField) fields.appendChild(endField.wrap);

  modal.querySelector('#mapped-cal-open')?.addEventListener('click', () => {
    closePanel({ restoreFocus: false });
    if (ctx.entityPath && typeof selectEntity === 'function') selectEntity(ctx.entityPath);
  });
  modal.querySelector('#mapped-cal-cancel')?.addEventListener('click', () => closePanel());
  modal.querySelector('#mapped-cal-save')?.addEventListener('click', async () => {
    const startVal = startField.input.value;
    const endVal = endField ? endField.input.value.trim() : '';
    if (!startVal) {
      showStatus('開始日時を入力してください', true);
      startField.input.focus();
      return;
    }
    try {
      const parseInputDate = (raw) => {
        if (!raw) return null;
        return (typeof parseLocalDate === 'function') ? parseLocalDate(raw) : new Date(raw);
      };
      await _saveMappedCalendarDates(dbPath, ev, parseInputDate(startVal), endVal ? parseInputDate(endVal) : null, {
        preserveMissingEndIfZeroDuration: !endVal,
        clearEndIfMissing: !!endField && !endVal,
      });
      showStatus('日時を更新しました');
      closePanel();
    } catch (e) {
      showStatus('日時の更新に失敗: ' + (e?.message || e), true);
    }
  });
  window.GBModalShell?.enhanceAll?.();
  setTimeout(() => startField.input.focus(), 30);
}

function _renderCalendarMappingConfigSection(host, dbPath, props, propTypes, currentMapping) {
  const current = _normalizeCalendarMapping(currentMapping);
  const dateProps = props.filter(p => (propTypes[p]?.type || '') === 'date');
  const textLikeProps = props.filter(p => ['text', 'select', 'multi-select', 'url', 'number', 'date'].includes(propTypes[p]?.type || 'text'));

  const rowSelect = (id, label, options, value, placeholder = '(なし)', help = '') => `
    <div class="field gb-field" style="margin-top:6px;">
      <label class="gb-label" for="${id}">${label}${help ? ' ' + fieldHelp(help) : ''}</label>
      <select id="${id}" class="gb-select" data-e2e-id="${id}" style="width:100%;box-sizing:border-box;">
        <option value="">${placeholder}</option>
        ${options.map(p => `<option value="${esc(p)}" ${value===p?'selected':''}>${esc(p)}</option>`).join('')}
      </select>
    </div>`;

  const wrap = document.createElement('div');
  wrap.id = 'dbcfg-calendar-mapping';
  wrap.className = 'field';
  wrap.style.marginTop = '10px';
  wrap.innerHTML = `
    <div class="gb-check-help-row">
      <label class="gb-check" style="display:flex;align-items:center;gap:6px;cursor:pointer;min-height:44px;">
        <input id="dbcfg-calmap-enabled" type="checkbox" data-e2e-id="dbcfg-calmap-enabled" aria-controls="dbcfg-calendar-mapping-fields" aria-expanded="${current?.startProp ? 'true' : 'false'}" ${current?.startProp ? 'checked' : ''} ${dateProps.length === 0 ? 'disabled' : ''}>
        <span>任意シートをカレンダー表示に連携する</span>
      </label>
      ${fieldHelp('連携すると、このシートの既存イベントは日時だけカレンダー上で編集できます。新規作成・削除・外部同期はカレンダーシート側で行います。')}
    </div>
    <div id="dbcfg-calendar-mapping-fields" style="margin-top:6px;${current?.startProp ? '' : 'display:none;'}">
      ${rowSelect('dbcfg-calmap-start', '開始列', dateProps, current?.startProp || '', '(必須)')}
      ${rowSelect('dbcfg-calmap-end', '終了列', dateProps, current?.endProp || '', undefined, '開始列が期間付き日時なら、終了列を空にしても終了日時を拾います')}
      ${rowSelect('dbcfg-calmap-title', 'タイトル列', textLikeProps, current?.titleProp || '', '(エントリ名)')}
      ${rowSelect('dbcfg-calmap-color', '色列', textLikeProps, current?.colorProp || '')}
      ${rowSelect('dbcfg-calmap-desc', '説明列', textLikeProps, current?.descriptionProp || '')}
      ${rowSelect('dbcfg-calmap-location', '場所列', textLikeProps, current?.locationProp || '')}
      ${rowSelect('dbcfg-calmap-url', 'URL列', textLikeProps, current?.urlProp || '')}
      ${rowSelect('dbcfg-calmap-calid', 'カレンダー分類列', textLikeProps, current?.calendarIdProp || '')}
    </div>
  `;

  if (dateProps.length === 0) {
    const note = document.createElement('div');
    note.style.cssText = 'font-size:11px;color:var(--red);margin-top:6px;';
    note.textContent = '日時列がないため、カレンダー連携は設定できません。';
    wrap.appendChild(note);
  }

  const enabled = wrap.querySelector('#dbcfg-calmap-enabled');
  const fields = wrap.querySelector('#dbcfg-calendar-mapping-fields');
  enabled?.addEventListener('change', () => {
    if (fields) fields.style.display = enabled.checked ? '' : 'none';
    enabled.setAttribute('aria-expanded', enabled.checked ? 'true' : 'false');
  });

  host.appendChild(wrap);
}

function _collectCalendarMappingConfig(modalEl) {
  const enabled = modalEl.querySelector('#dbcfg-calmap-enabled');
  if (!enabled || !enabled.checked) return null;
  const mapping = _normalizeCalendarMapping({
    startProp: modalEl.querySelector('#dbcfg-calmap-start')?.value || '',
    endProp: modalEl.querySelector('#dbcfg-calmap-end')?.value || '',
    titleProp: modalEl.querySelector('#dbcfg-calmap-title')?.value || '',
    colorProp: modalEl.querySelector('#dbcfg-calmap-color')?.value || '',
    descriptionProp: modalEl.querySelector('#dbcfg-calmap-desc')?.value || '',
    locationProp: modalEl.querySelector('#dbcfg-calmap-location')?.value || '',
    urlProp: modalEl.querySelector('#dbcfg-calmap-url')?.value || '',
    calendarIdProp: modalEl.querySelector('#dbcfg-calmap-calid')?.value || '',
  });
  if (!mapping?.startProp) throw new Error('開始列を選択してください');
  return mapping;
}
