(function () {
  'use strict';

  const PM_ROOT = '制作管理';
  // 「スタッフリスト」シート（制作管理ルートごとのスタッフ一覧）は
  // アカウント一元管理 計画書 Phase 4 で廃止し、全体で1枚の正本
  // 「スタッフ管理シート」（gb-staff-registry-schema.js/gb-user-registry.js）へ
  // 統合した。13→12シート契約変更（破壊的変更・メジャー境界リリース）。
  const PM_SHEETS = ['作品リスト', 'タスクリスト', 'タスクテンプレート', '作業対象リスト', '作業内容リスト', '作業規模リスト', 'スケジュール', '勤怠情報', '自動シフト調整設定', 'スケジュール アーカイブ', 'タスクリスト アーカイブ', 'データソース'];
  const PM_REQUIRED_PAGES = { '制作進行マニュアル.md': '# 制作進行マニュアル\n\n制作管理の手順を記録します。\n', '設定.md': '# 設定\n\n制作管理の設定メモです。\n' };
  const PM_TASK_SHEET_PREFIX = 'タスクリスト_';
  const PM_MAX_GENERATED_TASKS = 5000;
  let PM_TASK_CREATE_QUEUE = Promise.resolve();
  const PM_NAME_MIGRATED_PROVIDERS = new WeakSet();
  const PM_TASK_LEGACY_NAME_PROP = 'タスク名';
  const PM_TASK_HIDDEN_COLUMNS = [PM_TASK_LEGACY_NAME_PROP, 'タスク名を固定', '階層パス', '階層ラベル', '単位レベル1', '単位レベル2', '単位レベル3', '単位レベル4', '単位レベル5', 'プリセット種別', '作業作成粒度', '目標作業時間_値', 'ページソート値', '元テンプレートID', '作成キー'];
  const PM_SHIFT_PARSER = window.MeldexProductionShiftParser;
  // YAML-liteフロントマター読み書きと権限エラー判定は gb-cloud-frontmatter-lite.js（共有ヘルパー）へ委譲。
  // 実装本体・仕様の説明はそちらを参照（Python meldex_frontmatter 互換）。
  const _pmCloudReadFrontmatter = window.MeldexCloudFrontmatterLite.readFrontmatter;
  const _pmCloudFrontmatterText = window.MeldexCloudFrontmatterLite.frontmatterText;
  const _pmCloudIsNotFoundError = window.MeldexCloudFrontmatterLite.isNotFoundError;
  const _pmCloudIsWriteAccessError = window.MeldexCloudFrontmatterLite.isWriteAccessError;
  function _pmMultiRelation(target) {
    return { type: 'multi-relation', target, relationDb: `${PM_ROOT}/シート/${target}` };
  }
  function _pmTaskRowEntryName(row) {
    return String(row?._entry_name || row?.['エントリ名'] || row?.[PM_TASK_LEGACY_NAME_PROP] || row?.name || '無題').trim() || '無題';
  }
  function _pmTaskRowProps(row) {
    const out = {};
    Object.entries(row || {}).forEach(([key, value]) => {
      if (key === '_entry_name' || key === 'エントリ名' || key === PM_TASK_LEGACY_NAME_PROP) return;
      out[key] = value;
    });
    return out;
  }
  function _pmWorkPeriodValue(body) {
    const source = body || {};
    for (const key of ['work_period', '作業期間', 'period']) {
      const value = String(source[key] || '').trim();
      if (value) return value;
    }
    const start = String(source.work_start || source['開始日時'] || '').trim();
    const end = String(source.work_end || source['完了日時'] || source['終了日時'] || '').trim();
    return start && end ? `${start}|${end}` : '';
  }
  const PM_PROPERTY_TYPES = window.MeldexProductionSchemaDefinitions.PROPERTY_TYPES;

  const PM_SEEDS = window.MeldexProductionSchemaDefinitions.SEEDS;

  function _pmShowStatus(message, error) {
    if (typeof showStatus === 'function') showStatus(message, !!error);
    else console[error ? 'error' : 'log'](message);
  }

  function _pmEnsureWritable(options = {}) {
    const ensureWritable = window.MeldexProductionUiAvailability?.ensureWritable;
    return typeof ensureWritable !== 'function' || ensureWritable(options);
  }

  function _pmIcon(name, size = 14) {
    return typeof lucide === 'function' ? lucide(name, size) : '';
  }

  function _pmRestoreFocus(target) {
    if (!target?.isConnected || typeof target.focus !== 'function') return;
    try { target.focus({ preventScroll: true }); } catch { try { target.focus(); } catch {} }
  }

  function _pmRecoveryText(base, result) {
    return result?.recovered_count ? `${base}（不足していた制作管理ファイルを自動復旧しました）` : base;
  }

  function _pmRequest(path, options) {
  const method = String(options?.method || 'GET').toUpperCase();
  const body = options?.body || {};
  if (method === 'POST' && typeof apiPost === 'function') return apiPost(path, body);
  if (typeof apiFetch === 'function') {
    if (method === 'GET') return apiFetch(path);
    return apiFetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  }
  if (window.MeldexDataAccess?.requestJson) return window.MeldexDataAccess.requestJson(path, { method, body });
    throw new Error('制作管理APIを呼び出せません');
  }

  function _pmButton(label, primary) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = primary ? 'gb-btn gb-btn-sm gb-btn-primary' : 'gb-btn gb-btn-sm';
    button.textContent = label;
    return button;
  }

  function _pmField(labelText, input) {
    const field = document.createElement('label');
    field.className = 'field gb-production-field';
    const label = document.createElement('span');
    label.className = 'gb-production-field-label';
    label.textContent = labelText;
    field.append(label, input);
    return field;
  }

  function _pmInput(value, placeholder) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value || '';
    input.placeholder = placeholder || '';
    input.className = 'gb-input gb-input-sm gb-production-input';
    return input;
  }

  function _pmSelect(options, value) {
    const select = document.createElement('select');
    select.className = 'gb-select gb-select-sm gb-production-input';
    options.forEach((item) => {
      const option = document.createElement('option');
      option.value = item;
      option.textContent = item;
      option.selected = item === value;
      select.appendChild(option);
    });
    return select;
  }

  function _pmModal(title, options = {}) {
    const focusSource = options.trigger || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay gb-production-modal-overlay';
    overlay.dataset.e2eId = options.e2eId || 'production-dialog-overlay';
    const modal = document.createElement('div');
    modal.className = 'modal gb-production-modal';
    modal.style.setProperty('--gb-production-modal-width', options.width || '720px');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.tabIndex = -1;
    modal.dataset.e2eId = options.dialogE2eId || 'production-dialog';
    const titleId = `${modal.dataset.e2eId}-title`;
    modal.setAttribute('aria-labelledby', titleId);
    const header = document.createElement('div');
    header.className = 'gb-modal-header gb-production-modal-header';
    const heading = document.createElement('h3');
    heading.id = titleId;
    heading.className = 'gb-production-title';
    heading.textContent = title;
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'gb-modal-close gb-production-modal-close';
    closeButton.setAttribute('aria-label', `${title}を閉じる`);
    closeButton.dataset.e2eId = `${modal.dataset.e2eId}-close`;
    closeButton.innerHTML = _pmIcon('x', 14) || '×';
    header.append(heading, closeButton);
    const body = document.createElement('div');
    body.className = 'gb-modal-body gb-production-modal-body';
    modal.append(header, body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    const close = () => {
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      _pmRestoreFocus(focusSource);
      window.requestAnimationFrame?.(() => _pmRestoreFocus(focusSource));
    };
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
    };
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    closeButton.addEventListener('click', close);
    document.addEventListener('keydown', onKeyDown, true);
    window.GBModalShell?.enhanceOverlay?.(overlay);
    window.requestAnimationFrame(() => {
      const focusTarget = body.querySelector('input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])') || modal;
      _pmRestoreFocus(focusTarget);
    });
    return { overlay, modal, body, close };
  }

  function _pmFooter(closeModal, okLabel, onOk, options = {}) {
    const footer = document.createElement('div');
    footer.className = 'gb-modal-footer gb-production-modal-footer';
    footer.dataset.modalFooter = '1';
    const cancel = _pmButton('キャンセル');
    const ok = _pmButton(okLabel, true);
    if (options.write) window.MeldexProductionUiAvailability?.markWriteControl?.(ok);
    cancel.addEventListener('click', closeModal);
    ok.addEventListener('click', async () => {
      ok.disabled = true;
      try {
        await onOk();
        closeModal();
      } catch (err) {
        _pmShowStatus(err?.message || String(err), true);
      } finally {
        ok.disabled = false;
      }
    });
    footer.append(cancel, ok);
    return footer;
  }

  async function openProductionManagementStart() {
    if (!_pmEnsureWritable()) return null;
    const result = await _pmRequest('/production-management/init', { method: 'POST', body: {} });
    _pmShowStatus(_pmRecoveryText(`制作管理を準備しました: ${result.root || PM_ROOT}`, result));
    return result;
  }

  function openProductionTaskCreate() {
    if (!_pmEnsureWritable()) return null;
    const dialog = window.MeldexProductionTaskCreateDialog?.openActive?.();
    if (!dialog) _pmShowStatus('タスク一括作成画面を初期化できませんでした', true);
    return dialog;
  }

  function openProductionShiftImport() {
    if (!_pmEnsureWritable()) return null;
    const { body, close } = _pmModal('シフト表を取り込む', {
      e2eId: 'production-shift-import-overlay',
      dialogE2eId: 'production-shift-import-dialog',
    });
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv';
    fileInput.className = 'gb-input gb-input-sm gb-production-input';
    fileInput.dataset.e2eId = 'production-shift-import-file';
    const preview = document.createElement('div');
    preview.className = 'gb-production-result-box gb-production-shift-preview';
    preview.dataset.e2eId = 'production-shift-import-preview';
    let parsedRows = [];
    fileInput.addEventListener('change', async () => {
      try {
        parsedRows = await _pmParseShiftFile(fileInput.files?.[0]);
        _pmRenderPreview(preview, parsedRows);
      } catch (error) {
        parsedRows = [];
        preview.textContent = '取り込み内容を読み込めませんでした: ' + (error?.message || error);
        _pmShowStatus(preview.textContent, true);
      }
    });
    body.append(_pmField('Excel / CSV', fileInput), preview, _pmFooter(close, '取り込む', async () => {
      if (!parsedRows.length) throw new Error('取り込む行がありません');
      const result = await _pmRequest('/production-management/shifts/apply', { method: 'POST', body: { rows: parsedRows, source_file: fileInput.files?.[0]?.name || '' } });
      _pmShowStatus(_pmRecoveryText(`シフトを取り込みました: ${result.count || 0}件`, result));
    }, { write: true }));
  }

  function _pmRenderPreview(container, rows) {
    container.replaceChildren();
    const wrap = document.createElement('div');
    wrap.className = 'gb-production-preview-table-wrap';
    const table = document.createElement('table');
    table.className = 'db-table gb-production-preview-table';
    const head = document.createElement('tr');
    ['担当者', '日付', '開始', '終了', '種別'].forEach((label) => {
      const th = document.createElement('th');
      th.textContent = label;
      head.appendChild(th);
    });
    table.appendChild(head);
    rows.slice(0, 50).forEach((row) => {
      const tr = document.createElement('tr');
      [row.user, row.date, row.start_time, row.end_time, row.type].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value || '';
        tr.appendChild(td);
      });
        table.appendChild(tr);
      });
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  async function runProductionAssignment() {
    if (!_pmEnsureWritable()) return null;
    const result = await _pmRequest('/production-management/assign/apply', { method: 'POST', body: {} });
    _pmShowStatus(_pmRecoveryText(`担当者と時間を割り当てました: ${result.updated || 0}件`, result));
    return result;
  }

  async function runProductionExternalSync(options = {}) {
    if (!_pmEnsureWritable({ notify: !options.silent })) return null;
    const result = await _pmRequest('/production-management/external-sync', { method: 'POST', body: { automatic: !!options.silent } });
    if (result?.unsupported) {
      if (!options.silent) _pmShowStatus(result.message || '外部カレンダー送信はこの環境では使えません', true);
      return result;
    }
    if (!options.silent) {
      _pmShowStatus(`外部カレンダーへ送信しました: ${result.caldav_synced || 0}件 / Google ${result.google_pushed || 0}件追加・${result.google_updated || 0}件更新`);
    }
    return result;
  }

  async function _pmAutoProductionExternalSync() {
    if (window.MeldexRuntimeAdapter?.isDropboxMode?.()) return;
    const status = await _pmRequest('/production-management/status', { method: 'GET' }).catch(() => null);
    if (!status?.ready) return;
    await runProductionExternalSync({ silent: true });
  }

  function _pmStartExternalSyncTimer() {
    if (window.__meldexProductionExternalSyncTimer) return;
    const startupTimer = setTimeout(() => _pmAutoProductionExternalSync().catch(() => {}), 15000);
    if (typeof startupTimer?.unref === 'function') startupTimer.unref();
    window.__meldexProductionExternalSyncTimer = setInterval(() => {
      _pmAutoProductionExternalSync().catch(() => {});
    }, 15 * 60 * 1000);
    if (typeof window.__meldexProductionExternalSyncTimer?.unref === 'function') window.__meldexProductionExternalSyncTimer.unref();
  }

  function openProductionExport() {
    const { body, close } = _pmModal('シフト、実績、作業予定を書き出す', {
      e2eId: 'production-export-overlay',
      dialogE2eId: 'production-export-dialog',
    });
    const kind = _pmSelect(['all', 'shifts', 'attendance', 'work'], 'all');
    kind.dataset.e2eId = 'production-export-kind';
    const format = _pmSelect(['csv', 'xlsx'], 'csv');
    format.dataset.e2eId = 'production-export-format';
    const from = _pmInput('', '2026-05-01');
    from.dataset.e2eId = 'production-export-from';
    const to = _pmInput('', '2026-05-31');
    to.dataset.e2eId = 'production-export-to';
    body.append(
      _pmField('対象', kind),
      _pmField('形式', format),
      _pmField('開始日', from),
      _pmField('終了日', to),
      _pmFooter(close, '保存', async () => {
        await _pmSaveExport(kind.value, format.value, from.value, to.value);
      })
    );
  }

  async function _pmSaveExport(kind, format, from, to) {
    const params = new URLSearchParams({ kind, format });
    if (from) params.set('date_from', from);
    if (to) params.set('date_to', to);
    const apiUrl = `/api/production-management/export?${params}`;
    if (!window.MeldexRuntimeAdapter?.isDropboxMode?.() && window.MeldexExportSave?.saveUrl) {
      await MeldexExportSave.saveUrl(apiUrl, { filename: `production_${kind}.${format}`, mime: format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv;charset=utf-8' });
      return;
    }
    const result = await _pmRequest('/production-management/export?' + params, { method: 'GET' });
    if (result.blob) {
      await MeldexExportSave.saveBlob(_pmBase64Blob(result.blob, result.mime), { filename: result.filename, mime: result.mime });
    } else {
      await MeldexExportSave.saveText(result.content || '', { filename: result.filename || `production_${kind}.csv`, mime: result.mime || 'text/csv;charset=utf-8' });
    }
  }

  async function _pmParseShiftFile(file) {
    if (!file) return [];
    if (/\.xlsx$/i.test(file.name)) return PM_SHIFT_PARSER.rowsToShifts(await _pmReadXlsx(file));
    return PM_SHIFT_PARSER.rowsToShifts(PM_SHIFT_PARSER.parseCsv(await file.text()));
  }

  async function _pmReadXlsx(file) {
    if (window.XLSX?.read) {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const first = workbook.SheetNames[0];
      return XLSX.utils.sheet_to_json(workbook.Sheets[first], { header: 1, raw: false });
    }
    const files = await _pmUnzipStoreOrDeflate(await file.arrayBuffer());
    return _pmWorksheetRows(files);
  }

  async function _pmUnzipStoreOrDeflate(buffer) {
    const view = new DataView(buffer);
    const files = {};
    let offset = 0;
    while (offset + 30 < view.byteLength && view.getUint32(offset, true) === 0x04034b50) {
      const method = view.getUint16(offset + 8, true);
      const compressed = view.getUint32(offset + 18, true);
      const nameLen = view.getUint16(offset + 26, true);
      const extraLen = view.getUint16(offset + 28, true);
      const nameBytes = new Uint8Array(buffer, offset + 30, nameLen);
      const name = new TextDecoder().decode(nameBytes);
      const dataStart = offset + 30 + nameLen + extraLen;
      const data = buffer.slice(dataStart, dataStart + compressed);
      files[name] = method === 8 ? await _pmInflateRaw(data) : new Uint8Array(data);
      offset = dataStart + compressed;
    }
    return files;
  }

  async function _pmInflateRaw(buffer) {
    if (!window.DecompressionStream) throw new Error('このブラウザではExcel解析を利用できません。CSVで取り込んでください');
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function _pmWorksheetRows(files) {
    const decoder = new TextDecoder();
    const shared = _pmSharedStrings(decoder.decode(files['xl/sharedStrings.xml'] || new Uint8Array()));
    const sheetName = Object.keys(files).find(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
    const xml = decoder.decode(files[sheetName] || new Uint8Array());
    const rows = [];
    xml.replace(/<row[^>]*>([\s\S]*?)<\/row>/g, (_, rowXml) => {
      const row = [];
      rowXml.replace(/<c([^>]*)>([\s\S]*?)<\/c>/g, (__, attrs, cellXml) => {
        const ref = (attrs.match(/\sr="([A-Z]+)\d+"/) || [])[1] || '';
        const index = _pmColIndex(ref);
        const type = (attrs.match(/\st="([^"]+)"/) || [])[1] || '';
        const raw = (cellXml.match(/<v[^>]*>([\s\S]*?)<\/v>/) || [])[1] || '';
        const inline = (cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || '';
        row[index] = type === 's'
          ? (shared[Number(raw)] || '')
          : type === 'inlineStr'
            ? _pmXmlText(inline)
            : _pmXmlText(raw);
        return '';
      });
      if (row.some(v => String(v || '').trim())) rows.push(row);
      return '';
    });
    return rows;
  }

  function _pmSharedStrings(xml) {
    const values = [];
    xml.replace(/<si[^>]*>([\s\S]*?)<\/si>/g, (_, item) => {
      const parts = [];
      item.replace(/<t[^>]*>([\s\S]*?)<\/t>/g, (__, text) => {
        parts.push(_pmXmlText(text));
        return '';
      });
      values.push(parts.join(''));
      return '';
    });
    return values;
  }

  function _pmXmlText(value) {
    return String(value || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  }

  function _pmColIndex(col) {
    let n = 0;
    String(col || '').split('').forEach(ch => { n = n * 26 + ch.charCodeAt(0) - 64; });
    return Math.max(0, n - 1);
  }

  function _pmBase64Blob(base64, mime) {
    const binary = atob(base64 || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
  }

  function _pmCalendarStorePath(internals, name) {
    return internals._joinPath('_calendar', name + '.json');
  }

  async function _pmReadCalendarStore(provider, internals, name) {
    const rows = await internals._readJsonSafe(provider, _pmCalendarStorePath(internals, name), []);
    return Array.isArray(rows) ? rows : [];
  }

  async function _pmWriteCalendarStore(provider, internals, name, rows) {
    await internals._directoryHandle(provider, '_calendar', true);
    await provider.writeJson(_pmCalendarStorePath(internals, name), Array.isArray(rows) ? rows : []);
  }

  function _pmCloudShiftEndDate(shift) {
    const startTime = String(shift?.start_time || '');
    const endTime = String(shift?.end_time || startTime);
    if (startTime && endTime && endTime <= startTime) return _pmAddDay(shift.date);
    return String(shift?.date || '');
  }

  async function _pmEnsureCloudCalendar(provider, internals, name, color, source, user) {
    const rows = await _pmReadCalendarStore(provider, internals, 'calendars');
    const owner = user || 'system';
    const found = rows.find(row => row.name === name && row.source === source && (row.user || 'system') === owner);
    if (found?.id) return found.id;
    const id = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : 'cal_' + Date.now().toString(36);
    rows.push({ id, name, color, user: owner, source, visible: 1, sort_order: 0, folder: 'シフトカレンダー', edit_role: 'owner', created: new Date().toISOString() });
    await _pmWriteCalendarStore(provider, internals, 'calendars', rows);
    return id;
  }

  async function _pmSyncCloudShiftEvent(provider, shift) {
    const internals = window.__MeldexPwaDataAccessInternals;
    const shiftId = String(shift?.id || '');
    const date = String(shift?.date || '');
    if (!internals || !shiftId || !date) return;
    const username = String(shift.user || 'anonymous');
    const calendarId = await _pmEnsureCloudCalendar(provider, internals, `シフト: ${username}`, '#d19a66', 'shift', username);
    const startTime = String(shift.start_time || '');
    const endTime = String(shift.end_time || startTime);
    const allDay = startTime ? 0 : 1;
    const start = allDay ? date : `${date}T${startTime}`;
    const end = allDay ? date : `${_pmCloudShiftEndDate(shift)}T${endTime || startTime}`;
    const label = { work: '勤務', off: '休み', holiday: '祝日' }[shift.type] || shift.type || 'シフト';
    const eventId = `shift:${shiftId}`;
    const rows = (await _pmReadCalendarStore(provider, internals, 'events')).filter(row => String(row.id) !== eventId);
    rows.push({ id: eventId, title: `シフト ${username}: ${label}`, start, end, all_day: allDay, color: '#d19a66', description: shift.note || '', location: '', url: '', recurrence: '', external_id: shiftId, calendar_source: 'shift', user: username, creator: username, calendar_id: calendarId, alert_minutes: -1, created: shift.created || new Date().toISOString(), modified: new Date().toISOString() });
    await _pmWriteCalendarStore(provider, internals, 'events', rows);
  }

  async function _pmRemoveCloudShiftEvent(provider, shiftId) {
    const internals = window.__MeldexPwaDataAccessInternals;
    if (!internals) return;
    const eventId = `shift:${shiftId}`;
    const rows = await _pmReadCalendarStore(provider, internals, 'events');
    await _pmWriteCalendarStore(provider, internals, 'events', rows.filter(row => {
      const id = String(row.id || '');
      return id !== eventId && !id.startsWith(eventId + ':break:');
    }));
  }

  function _pmCloudShiftPairKey(row) {
    return [String(row?.user || ''), String(row?.date || '')].join('\u0000');
  }

  async function _pmCloudDeleteScheduleEntry(provider, path) {
    if (!path || typeof provider?.deletePath !== 'function') return false;
    await provider.deletePath(path);
    return true;
  }

  async function _pmCloudDeleteShiftRecord(provider, internals, shiftId) {
    try {
      await window.MeldexDataAccess.requestJson('/cal/shifts/' + encodeURIComponent(shiftId), { method: 'DELETE' });
      return true;
    } catch {}
    const rows = await _pmReadCalendarStore(provider, internals, 'shifts');
    await _pmWriteCalendarStore(provider, internals, 'shifts', rows.filter(row => String(row.id) !== String(shiftId)));
    await _pmRemoveCloudShiftEvent(provider, shiftId);
    return true;
  }

  async function _pmCloudCleanupExistingShifts(provider, internals, rows) {
    const targetPairs = new Set((rows || []).map(_pmCloudShiftPairKey).filter(key => !key.startsWith('\u0000') && !key.endsWith('\u0000')));
    if (!targetPairs.size) return { removed_ids: [] };
    const currentRows = await window.MeldexDataAccess.requestJson('/cal/shifts').catch(() => _pmReadCalendarStore(provider, internals, 'shifts'));
    const removedIds = [];
    for (const current of currentRows || []) {
      const id = String(current?.id || '');
      if (!id.startsWith('pm-shift-')) continue;
      const normalized = _pmNormalizeIncomingShift(current);
      if (!normalized || !targetPairs.has(_pmCloudShiftPairKey(normalized))) continue;
      removedIds.push(id);
    }
    for (const shiftId of [...new Set(removedIds)]) {
      await _pmCloudDeleteShiftRecord(provider, internals, shiftId);
      const schedulePath = await _pmCloudFindByProp(provider, internals, 'スケジュール', '作成キー', shiftId);
      await _pmCloudDeleteScheduleEntry(provider, schedulePath).catch(() => false);
    }
    return { removed_ids: [...new Set(removedIds)] };
  }

  function _pmInstallCloudHandler() {
    const internals = window.__MeldexPwaDataAccessInternals;
    const handlers = window.__MeldexPwaDataAccessExtensions;
    if (!internals || !Array.isArray(handlers)) return;
    handlers.push(async function _productionManagementCloudHandler({ method, body, url, pathname }) {
      if (pathname === '/entity/rename' && method === 'POST'
        && window.MeldexProductionSchemaMigration?.isManagedEntryPath?.(body?.path)) {
        const provider = await internals._requirePwaProvider('readwrite');
        return _pmCloudRenameManagedEntry(provider, internals, body || {});
      }
      if (!/^\/production-management(\/|$)/.test(pathname)) return internals.NOT_HANDLED;
      const migrateOnFirstDisplay = method === 'GET' && [
        '/production-management/lists',
        '/production-management/task-sheets',
        '/production-management/task-create-catalog',
      ].includes(pathname);
      const readOnlyRequest = method === 'GET' || (method === 'POST' && [
        '/production-management/tasks/query',
        '/production-management/tasks/preview',
      ].includes(pathname));
      const provider = await internals._requirePwaProvider(readOnlyRequest ? 'read' : 'readwrite');
      let migrationMeta = {};
      if (migrateOnFirstDisplay && !PM_NAME_MIGRATED_PROVIDERS.has(provider)) {
        let writableProvider = null;
        try {
          writableProvider = await internals._requirePwaProvider('readwrite');
        } catch (error) {
          migrationMeta = { read_only: true, migration_skipped: true, migration_message: String(error?.message || error) };
        }
        if (writableProvider) {
          try {
            await _pmCloudWithProductionLease(writableProvider, () => (
              PM_NAME_MIGRATED_PROVIDERS.has(writableProvider) ? Promise.resolve() : _pmCloudInit(writableProvider, internals)
            ));
            PM_NAME_MIGRATED_PROVIDERS.add(provider);
          } catch (error) {
            const readOnly = _pmCloudIsWriteAccessError(error);
            if (!readOnly && Number(error?.status || 0) !== 423) throw error;
            migrationMeta = { read_only: readOnly, migration_skipped: true, migration_message: String(error?.message || error) };
          }
        }
      }
      if (pathname === '/production-management/status' && method === 'GET') return _pmCloudStatus(provider, internals);
      if (pathname === '/production-management/summary' && method === 'GET') return _pmCloudSummary(provider, internals);
      if (pathname === '/production-management/lists' && method === 'GET') return { ...await _pmCloudList(provider, internals, url), ...migrationMeta };
      if (pathname === '/production-management/task-sheets' && method === 'GET') return { ...await _pmCloudTaskSheets(provider, internals), ...migrationMeta };
      if (pathname === '/production-management/task-create-catalog' && method === 'GET') return { ...await _pmCloudTaskCreateCatalog(provider, internals), ...migrationMeta };
      if (pathname === '/production-management/tasks/query' && method === 'POST') return _pmCloudQueryTasks(provider, internals, body || {});
      if (pathname === '/production-management/entries' && (method === 'POST' || method === 'PATCH')) {
        return _pmCloudWithProductionLease(provider, () => method === 'POST'
          ? _pmCloudCreateEntry(provider, internals, body || {})
          : _pmCloudPatchEntry(provider, internals, body || {}));
      }
      if (pathname === '/production-management/task-by-event' && method === 'GET') return _pmCloudTaskByEvent(provider, internals, url);
      if (pathname === '/production-management/tasks/from-template' && method === 'POST') {
        return _pmCloudWithProductionLease(provider, () => _pmCloudCreateFromTemplate(provider, internals, body || {}));
      }
      if (pathname === '/production-management/task-sheets' && method === 'POST') {
        return _pmCloudWithProductionLease(provider, () => _pmCloudCreateTaskSheet(provider, internals, body || {}));
      }
      if (pathname === '/production-management/init' && method === 'POST') {
        return _pmCloudWithProductionLease(provider, () => _pmCloudInit(provider, internals, {
          migrateLegacyWorkspace: true,
          forceNameMigration: true,
        }));
      }
      if (pathname === '/production-management/tasks/preview' && method === 'POST') return _pmCloudPreviewTasks(provider, internals, body || {});
      if (pathname === '/production-management/tasks/create' && method === 'POST') return _pmCloudCreateTasks(provider, internals, body || {});
      if (pathname === '/production-management/shifts/apply' && method === 'POST') {
        return _pmCloudWithProductionLease(provider, () => _pmCloudApplyShifts(provider, internals, body || {}));
      }
      if (pathname === '/production-management/staff/add' && method === 'POST') {
        return _pmCloudWithProductionLease(provider, () => _pmCloudAddStaff(provider, internals, body || {}));
      }
      if (pathname === '/production-management/assign/apply' && method === 'POST') {
        return _pmCloudWithProductionLease(provider, () => _pmCloudApplyAssignment(provider, internals, body || {}));
      }
      if (pathname === '/production-management/external-sync' && method === 'POST') {
        return { ok: false, unsupported: true, message: '外部カレンダー送信はデスクトップ版で設定してください' };
      }
      if (pathname === '/production-management/export' && method === 'GET') return _pmCloudExport(url);
      return internals.NOT_HANDLED;
    });
  }

  function _pmCloudRoot(internals) {
    return internals._joinPath(PM_ROOT, 'シート');
  }

  async function _pmCloudStatus(provider, internals) {
    const missing = await _pmCloudMissing(provider, internals);
    return { ok: true, root: PM_ROOT, missing, ready: missing.length === 0, repairable: !!missing.length, message: missing.length ? '制作管理に必要なファイルが一部見つかりません。「制作管理を始める」で自動復旧できます。' : '', cloud: true };
  }

  async function _pmCloudSummary(provider, internals) {
    const [works, tasks, contents] = await Promise.all([
      _pmCloudListEntries(provider, internals, '作品リスト'),
      _pmCloudListAllTaskEntries(provider, internals),
      _pmCloudListEntries(provider, internals, '作業内容リスト'),
    ]);
    return { ok: true, root: PM_ROOT, counts: { works: works.length, tasks: tasks.length, contents: contents.length }, cloud: true };
  }

  async function _pmCloudList(provider, internals, url) {
    const aliases = { works: '作品リスト', tasks: 'タスクリスト', contents: '作業内容リスト', targets: '作業対象リスト', scales: '作業規模リスト' };
    const requested = String(url?.searchParams?.get('sheet') || 'タスクリスト');
    const sheet = aliases[requested] || requested;
    const q = String(url?.searchParams?.get('q') || '').trim().toLocaleLowerCase('ja');
    const limit = Math.max(1, Math.min(5000, Number(url?.searchParams?.get('limit') || 100) || 100));
    const entries = sheet === 'タスクリスト'
      ? await _pmCloudListAllTaskEntries(provider, internals)
      : await _pmCloudListEntries(provider, internals, sheet);
    const rows = entries.map(_pmCloudEntryRow).filter(row => {
      if (!q) return true;
      return `${row.name}\n${Object.values(row.properties).join('\n')}`.toLocaleLowerCase('ja').includes(q);
    });
    return { ok: true, sheet, rows: rows.slice(0, limit), count: rows.length, root: PM_ROOT, cloud: true };
  }

  async function _pmCloudTaskSheets(provider, internals, cachedWorks = null) {
    const works = Array.isArray(cachedWorks)
      ? cachedWorks
      : await _pmCloudListEntries(provider, internals, '作品リスト', { concurrency: 8 });
    const rows = await _pmCloudMapBounded(works, 8, async work => {
      const workTitle = work.name || _pmCloudPropValue(work.frontmatter, '作品タイトル_話数')
        || _pmCloudPropValue(work.frontmatter, '作品タイトル');
      const sheetName = _pmCloudPropValue(work.frontmatter, 'タスクリストシート');
      if (!sheetName) return null;
      const entries = await _pmCloudDirectoryEntries(provider, internals, internals._joinPath(_pmCloudRoot(internals), sheetName));
      const count = entries.filter(entry => entry?.handle?.kind === 'file' && String(entry.name || '').endsWith('.md') && entry.name !== sheetName + '.md').length;
      return {
        sheet_name: sheetName,
        work_title: workTitle,
        dir: internals._joinPath(_pmCloudRoot(internals), sheetName),
        count,
      };
    });
    return { ok: true, root: PM_ROOT, sheets: rows.filter(Boolean), cloud: true };
  }

  function _pmCloudLegacyTaskWorkTitle(entry) {
    const properties = entry?.frontmatter?.properties || {};
    const hasWorkProperty = Object.prototype.hasOwnProperty.call(properties, '作品タイトル')
      || Object.prototype.hasOwnProperty.call(properties, '作品タイトル_話数');
    const explicit = _pmCloudPropValue(entry?.frontmatter, '作品タイトル')
      || _pmCloudPropValue(entry?.frontmatter, '作品タイトル_話数');
    if (hasWorkProperty) return explicit.trim() || '未分類';
    const keyParts = _pmCloudPropValue(entry?.frontmatter, '作成キー').split('|');
    const inferred = keyParts.length > 4 ? keyParts.slice(0, -4).join('|').trim() : '';
    return inferred || '未分類';
  }

  function _pmCloudAllocateTaskSheetName(workTitle, usedSheets) {
    const base = PM_TASK_SHEET_PREFIX + _pmSafeName(workTitle).slice(0, 100);
    let candidate = base;
    let suffix = 1;
    while (usedSheets.has(candidate.toLocaleLowerCase('ja'))) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
    usedSheets.add(candidate.toLocaleLowerCase('ja'));
    return candidate;
  }

  async function _pmCloudMapBounded(items, limit, mapper) {
    const source = Array.from(items || []);
    const results = new Array(source.length);
    let cursor = 0;
    let firstError = null;
    async function worker() {
      while (!firstError) {
        const index = cursor++;
        if (index >= source.length) return;
        try { results[index] = await mapper(source[index], index); }
        catch (error) { firstError ||= error; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(Math.max(1, limit || 1), source.length) }, worker));
    if (firstError) throw firstError;
    return results;
  }

  async function _pmCloudCreateTaskSheet(provider, internals, body) {
    await _pmCloudInit(provider, internals);
    const workTitle = String(body?.work_title || '').trim();
    if (!workTitle) throw new Error('work_title は必須です');
    const sheetName = await _pmCloudEnsureWorkTaskSheet(provider, internals, workTitle);
    await _pmCloudUpsertEntry(provider, internals, '作品リスト', workTitle, {
      'タスクリストシート': sheetName,
    }, '', '', { reuseName: true });
    return { ok: true, sheet_name: sheetName, work_title: workTitle, dir: internals._joinPath(_pmCloudRoot(internals), sheetName), cloud: true };
  }

  async function _pmCloudAddStaff(provider, internals, body) {
    // 「メンバーを追加」は正本『スタッフ管理シート』への upsert へ委譲する
    // （アカウント一元管理計画書 Phase 4 §5.9手順4・手順5）。スタッフは制作管理
    // ルートごとではなく全体で1枚の正本を共有するため、制作管理の初期化・
    // 一意チェック・書き込みはもう不要（正本自体の保護は window.MeldexUserRegistry
    // が担う）。スキル（旧「担当できる作業」）は正本に存在しない列のため一切
    // 扱わない（計画書§5.5、作業内容リストの「担当者候補」側で設定する）。
    // クラウド静的版のtwin実装（gb-staff-registry-cloud-twin.js、2026-07-20）
    // により実動作する。真のエラー（例: ユーザー重複の409）はここで案内文へ
    // すり替えず、そのまま呼び出し元（openProductionStaffAdd の catch）へ
    // 伝播させる。
    const name = String(body?.name || body?.user || '').trim();
    if (!name) throw new Error('メンバー名は必須です');
    // 「ユーザーを選択（未連携も可）」— user が明示されていない限り name を
    // ユーザーIDへ代用しない（表示名だけの未連携行を許す。
    // meldex_staff_registry_service.upsert_staff の同じ配慮と揃えている）。
    const entry = {
      user: String(body?.user || '').trim(),
      display: String(body?.display || '').trim() || name,
      role: String(body?.role_label || body?.role || '').trim(),
      work_hours: String(body?.work_hours || '').trim(),
      break_hours: String(body?.break_hours || '').trim(),
      holidays: String(body?.holidays || '').trim(),
      active_from: String(body?.active_from || '').trim(),
      active_to: String(body?.active_to || '').trim(),
      google_url: String(body?.google_url || '').trim(),
      caldav_url: String(body?.caldav_url || '').trim(),
      sync_enabled: !!body?.sync_enabled,
      note: String(body?.note || '').trim(),
    };
    await window.MeldexUserRegistry.upsertStaff(entry, { fillOnly: false });
    return { ok: true, staff: name, cloud: true };
  }

  async function _pmCloudTaskSheetForWork(provider, internals, workTitle) {
    const existingWork = await _pmCloudFindByName(provider, internals, '作品リスト', workTitle)
      || await _pmCloudFindByProp(provider, internals, '作品リスト', '作品タイトル_話数', workTitle);
    if (existingWork) {
      const parsed = await _pmCloudReadFrontmatter(provider, existingWork);
      const registered = _pmCloudPropValue(parsed.frontmatter, 'タスクリストシート');
      if (registered) return registered;
    }
    const base = PM_TASK_SHEET_PREFIX + _pmSafeName(workTitle).slice(0, 100);
    const used = new Set();
    for (const work of await _pmCloudListEntries(provider, internals, '作品リスト')) {
      const registered = _pmCloudPropValue(work.frontmatter, 'タスクリストシート');
      if (registered) used.add(registered.toLocaleLowerCase('ja'));
    }
    let candidate = base;
    let suffix = 1;
    // 未登録の同名フォルダは、前回の途中失敗で先に作られた作品別シートとして再利用する。
    // 他作品が正式登録済みの場合だけ枝番へ進み、再試行で孤立シートを増やさない。
    while (used.has(candidate.toLocaleLowerCase('ja'))) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
    return candidate;
  }

  async function _pmCloudEnsureWorkTaskSheet(provider, internals, workTitle) {
    const sheet = await _pmCloudTaskSheetForWork(provider, internals, workTitle);
    await _pmCloudEnsureSheet(provider, internals, sheet, 'タスクリスト');
    return sheet;
  }

  async function _pmCloudInit(provider, internals, options = {}) {
    // 名称衝突は制作管理ファイルへ一切書き込む前に検出する。
    const shouldMigrateNames = options.forceNameMigration || !PM_NAME_MIGRATED_PROVIDERS.has(provider);
    const nameMigration = shouldMigrateNames
      ? await window.MeldexProductionSchemaMigration?.migrateManagedNameProperties?.(
        _pmCloudManagedNameContext(provider, internals)
      ) || { migrated: 0, staff_users_added: 0 }
      : { migrated: 0, staff_users_added: 0 };
    if (shouldMigrateNames) PM_NAME_MIGRATED_PROVIDERS.add(provider);
    const missing = await _pmCloudMissing(provider, internals);
    await internals._directoryHandle(provider, PM_ROOT, true);
    for (const [name, text] of Object.entries(PM_REQUIRED_PAGES)) await _pmCloudEnsurePage(provider, internals, name, text);
    for (const sheet of PM_SHEETS) await _pmCloudEnsureSheet(provider, internals, sheet);
    // 構造が揃っている場合は初期値を再シードしない（編集済みの作業内容・規模リスト等を巻き戻さない）
    if (missing.length) await _pmCloudSeed(provider, internals);
    const recovered = [...missing];
    const cal = await _pmCloudRecoverFromCalendar(provider, internals, missing);
    if (cal.shifts) recovered.push(`カレンダーからシフトを復旧: ${cal.shifts}件`);
    if (cal.tasks) recovered.push(`カレンダーから作業予定を復旧: ${cal.tasks}件`);
    const migration = options.migrateLegacyWorkspace
      ? await _pmCloudMigrateLegacyWorkspace(provider, internals)
      : { works: 0, copied: 0, removed: 0, conflict_copies_removed: 0 };
    return {
      ok: true,
      root: PM_ROOT,
      sheets: PM_SHEETS,
      cloud: true,
      legacy_works_registered: migration.works,
      legacy_migrated: migration.copied,
      legacy_removed: migration.removed,
      conflict_copies_removed: migration.conflict_copies_removed,
      managed_names_migrated: nameMigration.migrated,
      staff_users_added: nameMigration.staff_users_added,
      ..._pmCloudRecoveryPayload(recovered),
    };
  }

  function _pmCloudManagedNameContext(provider, internals) {
    return {
      provider,
      rootPath: _pmCloudRoot(internals),
      listEntries: sheet => _pmCloudListEntries(provider, internals, sheet),
      listTaskSheets: () => _pmCloudTaskSheetNames(provider, internals),
      readFrontmatter: path => _pmCloudReadFrontmatter(provider, path),
      frontmatterText: _pmCloudFrontmatterText,
      safeName: _pmSafeName,
      entryPath: (sheet, name) => internals._joinPath(_pmCloudRoot(internals), sheet, `${name}.md`),
      notePath: sheet => internals._joinPath(_pmCloudRoot(internals), sheet, `${sheet}.md`),
      entryExists: path => _pmCloudEntryExists(provider, path, internals),
      moveEntry: (source, target) => internals._moveEntry(provider, source, target),
      readCalendarEvents: () => _pmReadCalendarStore(provider, internals, 'events'),
      writeCalendarEvents: rows => _pmWriteCalendarStore(provider, internals, 'events', rows),
    };
  }

  async function _pmCloudRenameManagedEntry(provider, internals, body) {
    const migration = window.MeldexProductionSchemaMigration;
    if (!migration?.isManagedEntryPath?.(body?.path)) return internals.NOT_HANDLED;
    return _pmCloudWithProductionLease(provider, () => migration.renameManagedEntry(
      _pmCloudManagedNameContext(provider, internals),
      body?.path,
      body?.new_name,
    ));
  }

  async function _pmCloudMissing(provider, internals) {
    const missing = [];
    for (const name of Object.keys(PM_REQUIRED_PAGES)) {
      if (!await _pmCloudEntryExists(provider, internals._joinPath(PM_ROOT, name), internals)) missing.push(`${PM_ROOT}/${name}`);
    }
    for (const sheet of PM_SHEETS) {
      const dir = internals._joinPath(_pmCloudRoot(internals), sheet);
      if (!await _pmCloudEntryExists(provider, dir, internals)) missing.push(`シート/${sheet}`);
      else if (!await _pmCloudEntryExists(provider, internals._joinPath(dir, sheet + '.md'), internals)) missing.push(`シート/${sheet}/${sheet}.md`);
    }
    return missing;
  }

  async function _pmCloudEntryExists(provider, path, internals) {
    try {
      if (typeof provider?.statPath === 'function') return !!(await provider.statPath(path));
      return !!(await internals._resolveEntryHandle(provider, path));
    } catch (error) {
      if (_pmCloudIsNotFoundError(error)) return false;
      throw error;
    }
  }

  async function _pmCloudEnsurePage(provider, internals, name, text) {
    const path = internals._joinPath(PM_ROOT, name);
    if (!await _pmCloudEntryExists(provider, path, internals)) await provider.writeText(path, text);
  }

  function _pmCloudRecoveryPayload(items) {
    const unique = [...new Set((items || []).filter(Boolean))];
    return { recovered: !!unique.length, recovered_count: unique.length, recovered_items: unique, message: unique.length ? `制作管理に必要なファイルを自動復旧しました: ${unique.slice(0, 4).join('、')}` : '' };
  }

  async function _pmCloudEnsureSheet(provider, internals, sheet, schemaSheet = sheet) {
    const dir = internals._joinPath(_pmCloudRoot(internals), sheet);
    await internals._directoryHandle(provider, dir, true);
    const note = internals._joinPath(dir, sheet + '.md');
    const parsed = await _pmCloudReadFrontmatter(provider, note);
    const frontmatter = { ...(parsed.frontmatter || {}), type: 'settings-db', schema_version: 1 };
    const propTypes = { ...(frontmatter.property_types || {}) };
    if (schemaSheet === 'タスクリスト') {
      delete propTypes[PM_TASK_LEGACY_NAME_PROP];
      delete propTypes['タスク名を固定'];
    }
    if (schemaSheet === 'タスクリスト アーカイブ') delete propTypes[PM_TASK_LEGACY_NAME_PROP];
    const managedNameDefinition = window.MeldexProductionSchemaMigration?.MANAGED_NAME_COLUMNS?.[schemaSheet];
    if (managedNameDefinition) {
      [managedNameDefinition.legacy, ...(managedNameDefinition.historicalAliases || [])]
        .filter(Boolean)
        .forEach(property => { delete propTypes[property]; });
    }
    let expectedTypes = PM_PROPERTY_TYPES[schemaSheet] || {};
    if (schemaSheet === 'タスクリスト' && sheet !== schemaSheet) {
      expectedTypes = {
        ...expectedTypes,
        '次のタスクにより保留中：': _pmMultiRelation(sheet),
        '次のタスクを保留中：': _pmMultiRelation(sheet),
      };
    }
    frontmatter.property_types = _pmCloudMergePropertyTypes(propTypes, expectedTypes);
    if (schemaSheet === 'タスクリスト') {
      frontmatter.calendar_mapping = { ...(frontmatter.calendar_mapping || {}), startProp: '作業予定日時', endProp: '作業予定日時', titleProp: '' };
      if (!frontmatter.calendar_mapping.colorProp) frontmatter.calendar_mapping.colorProp = '対象色';
      if (!frontmatter.calendar_mapping.descriptionProp) frontmatter.calendar_mapping.descriptionProp = '備考';
      _pmCloudApplyTaskHiddenColumns(frontmatter);
    }
    if (sheet === 'スケジュール') frontmatter.calendar_mapping = frontmatter.calendar_mapping || { startProp: '予定日時', endProp: '予定日時', titleProp: '予定名', descriptionProp: '備考' };
    await provider.writeText(note, _pmCloudFrontmatterText(frontmatter, parsed.body || `# ${sheet}\n\n`));
  }

  function _pmCloudMergePropertyTypes(current, expected) {
    const merged = { ...(current || {}) };
    Object.entries(expected || {}).forEach(([prop, spec]) => {
      const existing = merged[prop] && typeof merged[prop] === 'object' ? merged[prop] : {};
      merged[prop] = { ...existing, ...(spec || {}) };
    });
    return merged;
  }

  function _pmCloudApplyTaskHiddenColumns(frontmatter) {
    const config = (frontmatter.view_config && typeof frontmatter.view_config === 'object') ? frontmatter.view_config : {};
    const views = Array.isArray(config.savedViews) && config.savedViews.length ? config.savedViews : [{ name: 'テーブル', viewMode: 'pivot' }];
    views.forEach(view => {
      if (!view || typeof view !== 'object') return;
      const current = Array.isArray(view.hiddenCols) ? view.hiddenCols : [];
      view.hiddenCols = [...new Set([...current, ...PM_TASK_HIDDEN_COLUMNS])];
    });
    config.savedViews = views;
    if (!Number.isInteger(config.currentViewIdx)) config.currentViewIdx = 0;
    frontmatter.view_config = config;
  }

  function _pmTaskPageOptionCount(rows, fallback) {
    return (rows || []).reduce((max, row) => {
      const match = String(row?.['ページ'] || row?.['単位レベル1'] || '').match(/\d+/);
      return match ? Math.max(max, Number(match[0]) || 1) : max;
    }, Math.max(1, Number(fallback) || 1));
  }

  function _pmTaskPageOptions(count) {
    return Array.from({ length: Math.max(1, Number(count) || 1) }, (_, i) => 'p' + String(i + 1).padStart(4, '0'));
  }

  function _pmTaskPanelOptions(rows) {
    return (rows || []).map(row => String(row?.['コマ'] || row?.['単位レベル2'] || '').trim()).filter(Boolean);
  }

  function _pmMergeOptions(current, additions) {
    const out = [];
    [...(Array.isArray(current) ? current : []), ...(additions || [])].forEach((item) => {
      const value = String(item || '').trim();
      if (value && !out.includes(value)) out.push(value);
    });
    return out;
  }

  async function _pmCloudEnsureTaskPagePanelOptions(provider, internals, taskSheet, rows, fallbackPageCount) {
    if (!(rows || []).some(row => String(row?.['ページ'] || row?.['コマ'] || '').trim())) return;
    const note = internals._joinPath(_pmCloudRoot(internals), taskSheet, taskSheet + '.md');
    const parsed = await _pmCloudReadFrontmatter(provider, note);
    const frontmatter = { ...(parsed.frontmatter || {}), type: 'settings-db', schema_version: 1 };
    const propTypes = frontmatter.property_types && typeof frontmatter.property_types === 'object' ? { ...frontmatter.property_types } : {};
    const pageSpec = { ...(propTypes['ページ'] || {}), type: 'multi-select' };
    pageSpec.options = _pmMergeOptions(pageSpec.options, _pmTaskPageOptions(_pmTaskPageOptionCount(rows, fallbackPageCount)));
    propTypes['ページ'] = pageSpec;
    const panelSpec = { ...(propTypes['コマ'] || {}), type: 'multi-select' };
    const panelOptions = _pmMergeOptions(panelSpec.options, _pmTaskPanelOptions(rows));
    if (panelOptions.length) panelSpec.options = panelOptions;
    propTypes['コマ'] = panelSpec;
    frontmatter.property_types = propTypes;
    await provider.writeText(note, _pmCloudFrontmatterText(frontmatter, parsed.body || `# ${taskSheet}\n\n`));
  }

  async function _pmCloudSeed(provider, internals) {
    for (const [sheet, rows] of Object.entries(PM_SEEDS)) {
      for (const [name, props] of rows) await _pmCloudUpsertEntry(provider, internals, sheet, name, props, '', '', { reuseName: true });
    }
    for (const sheet of PM_SHEETS) {
      await _pmCloudUpsertEntry(provider, internals, 'データソース', sheet, { '役割': sheet, '対象シート': `シート/${sheet}`, '有効': 'true', '説明': '制作管理で使う標準シート' }, '役割', sheet);
    }
  }

  function _pmCloudValidateTaskRows(rows) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('作成するタスクがありません。作業内容を1つ以上選んでください');
    if (rows.length > PM_MAX_GENERATED_TASKS) throw new Error(`一度に作成できるタスクは${PM_MAX_GENERATED_TASKS}件までです`);
  }

  async function _pmCloudPreviewTasks(provider, internals, body) {
    const rows = _pmBuildTaskRows(body || {});
    _pmCloudValidateTaskRows(rows);
    await _pmCloudApplyTaskDurations(provider, internals, rows);
    const workTitle = String((body || {}).work_title || (body || {})['作品タイトル'] || (body || {}).title || '無題作品');
    const existingKeys = await _pmCloudExistingTaskKeysForWork(provider, internals, workTitle);
    return { ok: true, rows: rows.map(row => ({ ...row, existing: existingKeys.has(String(row['作成キー'] || '')) })), count: rows.length, cloud: true };
  }

  async function _pmCloudEnsureTaskReferences(provider, internals, rows, config) {
    const values = (prop) => [...new Set((rows || []).map(row => String(row?.[prop] || '').trim()).filter(Boolean))];
    const standardContents = new Map((PM_SEEDS['作業内容リスト'] || []).map(([name, props]) => [name, props]));
    const specs = [
      ['作業対象リスト', values('作業対象リスト'), () => ({ '基準作業時間': '1' })],
      ['作業内容リスト', values('作業内容リスト'), (name, index) => standardContents.get(name) || { '表示名': name, '作業順': String(100 + index * 10), '依存階層': String(100 + index * 10), '作業時間倍率': '1', '標準粒度': config.granularity || '階層単位' }],
      ['作業規模リスト', values('作業規模リスト'), () => ({ '作業時間倍率': '1', '面積比': '1' })],
    ];
    let created = 0;
    for (const [sheet, names, propsFor] of specs) {
      const known = new Set((await _pmCloudListEntries(provider, internals, sheet)).map(entry => entry.name).filter(Boolean));
      for (let index = 0; index < names.length; index += 1) {
        const name = names[index];
        if (known.has(name)) continue;
        await _pmCloudUpsertEntry(provider, internals, sheet, name, propsFor(name, index), '', '', { reuseName: true });
        known.add(name);
        created += 1;
      }
    }
    return created;
  }

  async function _pmCloudCreateTasks(provider, internals, body) {
    const previous = PM_TASK_CREATE_QUEUE;
    let release;
    const current = new Promise(resolve => { release = resolve; });
    PM_TASK_CREATE_QUEUE = current;
    await previous;
    try {
      return await _pmCloudWithProductionLease(provider, () => _pmCloudCreateTasksUnlocked(provider, internals, body));
    } finally {
      release();
      if (PM_TASK_CREATE_QUEUE === current) PM_TASK_CREATE_QUEUE = Promise.resolve();
    }
  }

  async function _pmCloudCreateTasksUnlocked(provider, internals, body) {
    const init = await _pmCloudInit(provider, internals);
    const rows = _pmBuildTaskRows(body || {});
    _pmCloudValidateTaskRows(rows);
    await _pmCloudApplyTaskDurations(provider, internals, rows);
    const workTitle = String((body || {}).work_title || (body || {})['作品タイトル'] || (body || {}).title || '無題作品');
    const workEntries = await _pmCloudListEntries(provider, internals, '作品リスト', { concurrency: 8 });
    const workEntry = workEntries.find(entry => {
      const title = entry.name || _pmCloudPropValue(entry.frontmatter, '作品タイトル_話数')
        || _pmCloudPropValue(entry.frontmatter, '作品タイトル');
      return title === workTitle;
    });
    const config = _pmHierarchyConfig(body || {});
    const paths = _pmHierarchyPaths(body || {}, config);
    const firstLevelCount = new Set(paths.map(path => path[0]).filter(Boolean)).size || paths.length || 1;
    const secondLevelsByFirst = new Map();
    paths.forEach(path => {
      if (!path[1]) return;
      if (!secondLevelsByFirst.has(path[0])) secondLevelsByFirst.set(path[0], new Set());
      secondLevelsByFirst.get(path[0]).add(path[1]);
    });
    const secondLevelCount = Math.max(0, ...[...secondLevelsByFirst.values()].map(values => values.size));
    const usedSheets = new Set(workEntries
      .map(entry => _pmCloudPropValue(entry.frontmatter, 'タスクリストシート').toLocaleLowerCase('ja'))
      .filter(Boolean));
    const taskSheet = _pmCloudPropValue(workEntry?.frontmatter, 'タスクリストシート')
      || _pmCloudAllocateTaskSheetName(workTitle, usedSheets);
    await _pmCloudEnsureSheet(provider, internals, taskSheet, 'タスクリスト');
    const workProps = {
      'ページ数': String(firstLevelCount),
      '階層数': String(config.count),
      '階層ラベル': config.labels.join(','),
      'プリセット種別': config.preset,
      '作業作成粒度': String((body || {}).granularity || (body || {})['作業作成粒度'] || config.granularity || '階層単位'),
      '生成ページ数': String(firstLevelCount),
      '生成コマ数': String(secondLevelCount),
      'タスク生成': '作成中',
      'タスクリストシート': taskSheet,
    };
    const workPeriod = _pmWorkPeriodValue(body || {});
    if (workPeriod) workProps['作業期間'] = workPeriod;
    const workPath = workEntry
      ? await _pmCloudUpdateEntryAtPath(provider, workEntry.path, workProps, workEntry)
      : await _pmCloudUpsertEntry(provider, internals, '作品リスト', workTitle, workProps, '', '', { reuseName: true, createNew: true });
    const migration = await _pmCloudMigrateLegacyTasksForWork(provider, internals, workTitle, taskSheet);
    if (migration.conflicts) throw new Error(`タスクリストに内容を自動統合できない行が${migration.conflicts}件あります。旧タスクリストまたは競合コピーと、作品別タスクリストの同じ作成キーを確認してください`);
    const referencesCreated = await _pmCloudEnsureTaskReferences(provider, internals, rows, config);
    await _pmCloudEnsureTaskPagePanelOptions(provider, internals, taskSheet, rows, firstLevelCount);
    const existingKeys = new Set(migration.existing_keys || []);
    const missingRows = [];
    for (const row of rows) {
      const key = String(row['作成キー'] || '');
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      missingRows.push(row);
    }
    const created = await _pmCloudWriteTaskRows(provider, internals, taskSheet, missingRows);
    await _pmCloudUpdateEntryAtPath(provider, workPath, { ...workProps, 'タスク生成': '作成済み' });
    return { ok: true, created, skipped: rows.length - created, count: rows.length, references_created: referencesCreated, migrated: migration.copied, legacy_removed: migration.removed, migration_conflicts: migration.conflicts, task_sheet: taskSheet, cloud: true, ..._pmCloudRecoveryPayload(init.recovered_items) };
  }

  async function _pmCloudApplyShifts(provider, internals, body) {
    const init = await _pmCloudInit(provider, internals);
    const rows = (body.rows || body.shifts || []).map(_pmNormalizeIncomingShift).filter(Boolean);
    const cleanup = await _pmCloudCleanupExistingShifts(provider, internals, rows);
    const removed = new Set(cleanup.removed_ids || []);
    let created = 0;
    let updated = 0;
    for (const row of rows) {
      const id = _pmShiftId(row);
      const scheduleName = `${row.date}_${row.user}_${_pmScheduleTypeLabel(row.type)}`;
      await _pmCloudUpsertEntry(provider, internals, 'スケジュール', scheduleName, _pmScheduleProps(row, id), '作成キー', id);
      await window.MeldexDataAccess.requestJson('/cal/shifts', { method: 'POST', body: { id, ...row } });
      if (removed.has(id)) updated += 1;
      else created += 1;
    }
    return { ok: true, count: rows.length, created, updated, cloud: true, ..._pmCloudRecoveryPayload(init.recovered_items) };
  }

  async function _pmCloudApplyAssignment(provider, internals, body) {
    const init = await _pmCloudInit(provider, internals);
    const planned = await _pmCloudAssignmentPlan(provider, internals, body || {});
    for (const row of planned) {
      const props = {
        '担当者': row.user,
        '作業予定日時': `${row.start}|${row.end}`,
        '作業予定時間': String(row.hours),
      };
      // デスクトップ版と同じく、状況は未設定の場合のみ「着手待ち」を設定する（作業中・保留を巻き戻さない）
      if (!row.task_status) props['状況'] = '着手待ち';
      if (row.task_path) {
        // 既存エントリをパス指定で直接更新する（作成キーの無い手動タスクで複製行が生まれないように）
        await _pmCloudUpdateEntryAtPath(provider, row.task_path, props);
      } else {
        await _pmCloudUpsertEntry(provider, internals, 'タスクリスト', row.task_name, props, '作成キー', row.task_key);
      }
      await _pmSyncCloudWorkEvent(provider, internals, row);
    }
    return { ok: true, updated: planned.length, rows: planned, cloud: true, ..._pmCloudRecoveryPayload(init.recovered_items) };
  }

  async function _pmCloudAssignmentPlan(provider, internals, body) {
    const tasks = await _pmCloudUnassignedTasks(provider, internals);
    const shifts = await _pmCloudWorkShifts(provider, internals, body.date_from || new Date().toISOString().slice(0, 10));
    const maxCount = Math.max(1, Number(body.limit || 200) || 200);
    const planned = [];
    for (const task of tasks.slice(0, maxCount)) {
      const plan = _pmCloudPlaceTaskInShift(task, shifts);
      if (plan) planned.push(plan);
    }
    return planned;
  }

  async function _pmCloudUnassignedTasks(provider, internals) {
    const entries = await _pmCloudListAllTaskEntries(provider, internals);
    return entries
      .filter(item => !_pmCloudPropValue(item.frontmatter, '作業予定日時') && _pmCloudPropValue(item.frontmatter, '状況') !== '完了')
      .map((item) => {
        const id = String(item.frontmatter?.id || _pmHash(item.path).slice(0, 12));
        const key = _pmCloudPropValue(item.frontmatter, '作成キー') || id;
        return {
          path: item.path,
          id,
          task_key: key,
          task_name: item.name,
          hours: Math.max(0.25, Number(_pmCloudPropValue(item.frontmatter, '目標作業時間_値') || 1) || 1),
          fixed_user: _pmCloudPropValue(item.frontmatter, '担当者'),
          status: _pmCloudPropValue(item.frontmatter, '状況'),
        };
      });
  }

  function _pmCloudDateIsValid(value) {
    return value instanceof Date && !Number.isNaN(value.getTime());
  }

  function _pmCloudBusyForShift(shift, events) {
    return (events || [])
      .filter(event => event && event.calendar_source === 'production-task' && String(event.user || '') === String(shift.user || ''))
      .map(event => {
        const start = new Date(String(event.start || event.end || ''));
        const end = new Date(String(event.end || event.start || ''));
        if (!_pmCloudDateIsValid(start) || !_pmCloudDateIsValid(end)) return null;
        const clampedStart = start < shift._cursor ? shift._cursor : start;
        const clampedEnd = end > shift._end ? shift._end : end;
        return clampedEnd > clampedStart ? [clampedStart, clampedEnd] : null;
      })
      .filter(Boolean)
      .sort((a, b) => a[0] - b[0]);
  }

  async function _pmCloudWorkShifts(provider, internals, dateFrom) {
    const rows = await window.MeldexDataAccess.requestJson('/cal/shifts').catch(() => []);
    const events = await _pmReadCalendarStore(provider, internals, 'events').catch(() => []);
    return (rows || [])
      .map(_pmNormalizeIncomingShift)
      .filter(row => row && row.type === 'work' && (!dateFrom || row.date >= dateFrom))
      .sort((a, b) => [a.date, a.start_time, a.user].join('|').localeCompare([b.date, b.start_time, b.user].join('|')))
      .map(row => ({ ...row, _cursor: _pmDateTime(row.date, row.start_time || '00:00'), _end: _pmShiftEndDateTime(row) }))
      .filter(row => _pmCloudDateIsValid(row._cursor) && _pmCloudDateIsValid(row._end) && row._end > row._cursor)
      .map(row => ({ ...row, _busy: _pmCloudBusyForShift(row, events) }));
  }

  function _pmCloudReserveShiftSlot(shift, durationMs) {
    let cursor = shift._cursor;
    for (const [busyStart, busyEnd] of shift._busy || []) {
      if (busyEnd <= cursor) continue;
      const end = new Date(cursor.getTime() + durationMs);
      if (end <= busyStart && end <= shift._end) {
        shift._cursor = end;
        return [cursor, end];
      }
      if (busyStart < shift._end && busyEnd > cursor) cursor = busyEnd;
    }
    const end = new Date(cursor.getTime() + durationMs);
    if (end <= shift._end) {
      shift._cursor = end;
      return [cursor, end];
    }
    return null;
  }

  function _pmCloudPlaceTaskInShift(task, shifts) {
    const durationMs = Math.max(0.25, Number(task.hours || 1) || 1) * 60 * 60 * 1000;
    for (const shift of shifts) {
      if (task.fixed_user && task.fixed_user !== shift.user) continue;
      const slot = _pmCloudReserveShiftSlot(shift, durationMs);
      if (!slot) continue;
      const [start, end] = slot;
      return {
        task_path: task.path,
        task_id: task.id,
        task_key: task.task_key,
        task_name: task.task_name,
        task_status: task.status || '',
        user: shift.user,
        start: _pmDateTimeText(start),
        end: _pmDateTimeText(end),
        hours: task.hours,
      };
    }
    return null;
  }

  async function _pmSyncCloudWorkEvent(provider, internals, row) {
    const calendarId = await _pmEnsureCloudCalendar(provider, internals, `作業予定: ${row.user}`, '#569cd6', 'production-task', row.user);
    const eventId = `production-task:${row.task_id}`;
    const now = new Date().toISOString();
    const rows = (await _pmReadCalendarStore(provider, internals, 'events')).filter(event => String(event.id) !== eventId);
    rows.push({
      id: eventId,
      title: row.task_name,
      start: row.start,
      end: row.end,
      all_day: 0,
      color: '#569cd6',
      description: '元シート: ' + row.task_path,
      location: '',
      url: '',
      recurrence: '',
      external_id: row.task_id,
      calendar_source: 'production-task',
      user: row.user,
      creator: row.user,
      calendar_id: calendarId,
      alert_minutes: -1,
      created: now,
      modified: now,
    });
    await _pmWriteCalendarStore(provider, internals, 'events', rows);
  }

  async function _pmCloudRecoverFromCalendar(provider, internals, missing) {
    const result = { shifts: 0, tasks: 0 };
    const needsSchedule = missing.some(item => item.includes('スケジュール') || item === PM_ROOT);
    const needsTasks = missing.some(item => item.includes('タスクリスト') || item === PM_ROOT);
    if (needsSchedule) {
      const shifts = await window.MeldexDataAccess.requestJson('/cal/shifts').catch(() => []);
      for (const row of shifts || []) {
        const normalized = _pmNormalizeIncomingShift(row);
        if (!normalized) continue;
        await _pmCloudUpsertEntry(provider, internals, 'スケジュール', `${normalized.date}_${normalized.user}`, _pmScheduleProps(normalized, row.id || _pmShiftId(normalized)), '作成キー', row.id || _pmShiftId(normalized));
        result.shifts += 1;
      }
    }
    if (needsTasks) {
      const events = await window.MeldexDataAccess.requestJson('/cal/events').catch(() => []);
      for (const row of (events || []).filter(event => event.calendar_source === 'production-task')) {
        const key = 'calendar:' + String(row.external_id || row.id || row.title || '');
        await _pmCloudUpsertEntry(provider, internals, 'タスクリスト', row.title || '復旧した作業予定', { '担当者': row.user || '', '作業予定日時': row.start && row.end ? `${row.start}|${row.end}` : row.start || '', '状況': '着手待ち', '作成キー': key, '備考': row.description || 'カレンダーから復旧' }, '作成キー', key);
        result.tasks += 1;
      }
    }
    return result;
  }

  async function _pmCloudExport(url) {
    const kind = url.searchParams.get('kind') || 'all';
    const format = url.searchParams.get('format') || 'csv';
    const rows = await _pmCollectCloudExportRows(kind, url.searchParams.get('date_from') || '', url.searchParams.get('date_to') || '');
    if (format === 'xlsx') {
      const blob = _pmXlsxBlob(rows);
      return { ok: true, filename: `production_${kind}.xlsx`, mime: blob.type, blob: await _pmBlobBase64(blob) };
    }
    return { ok: true, filename: `production_${kind}.csv`, mime: 'text/csv;charset=utf-8', content: _pmRowsCsv(rows) };
  }

  async function _pmCollectCloudExportRows(kind, dateFrom, dateTo) {
    const rows = [];
    if (kind === 'all' || kind === 'shifts') {
      (await window.MeldexDataAccess.requestJson('/cal/shifts'))
        .filter(row => _pmDateInRange(row.date || '', dateFrom, dateTo))
        .forEach(row => rows.push({ '種別': 'シフト', '担当者': row.user || '', '日付': row.date || '', '開始': row.start_time || '', '終了': row.end_time || '', '内容': row.type || '', '備考': row.note || '' }));
    }
    if (kind === 'all' || kind === 'attendance') {
      (await window.MeldexDataAccess.requestJson('/cal/time'))
        .filter(row => _pmDateInRange(String(row.timestamp || '').slice(0, 10), dateFrom, dateTo))
        .forEach(row => rows.push({ '種別': '実績', '担当者': row.user || '', '日付': String(row.timestamp || '').slice(0, 10), '開始': String(row.timestamp || '').slice(11, 16), '終了': '', '内容': row.type || '', '備考': row.note || '' }));
    }
    if (kind === 'all' || kind === 'work') {
      (await window.MeldexDataAccess.requestJson('/cal/events'))
        .filter(row => row.calendar_source === 'production-task' && _pmDateInRange(String(row.start || '').slice(0, 10), dateFrom, dateTo))
        .forEach(row => rows.push({ '種別': '作業予定', '担当者': row.user || '', '日付': String(row.start || '').slice(0, 10), '開始': String(row.start || '').slice(11, 16), '終了': String(row.end || '').slice(11, 16), '内容': row.title || '', '備考': row.description || '' }));
    }
    return rows;
  }

  function _pmDateInRange(date, from, to) {
    const value = String(date || '').slice(0, 10);
    return !!value && (!from || value >= from) && (!to || value <= to);
  }

