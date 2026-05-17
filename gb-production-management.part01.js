(function () {
  'use strict';

  const PM_ROOT = '制作管理';
  const PM_SHEETS = ['作品リスト', 'タスクリスト', '作業対象リスト', '作業内容リスト', '作業規模リスト', 'スタッフリスト', 'スケジュール', '勤怠情報', '自動シフト調整設定', 'スケジュール アーカイブ', 'タスクリスト アーカイブ', 'データソース'];
  const PM_REQUIRED_PAGES = { '制作進行マニュアル.md': '# 制作進行マニュアル\n\n制作管理の手順を記録します。\n', '設定.md': '# 設定\n\n制作管理の設定メモです。\n' };
  const PM_PROPERTY_TYPES = {
    '作品リスト': { '作品タイトル_話数': { type: 'text' }, 'ページ数': { type: 'number' }, '作業作成粒度': { type: 'select', options: ['ページ単位', 'コマ単位'] }, '作業期間': { type: 'date', withTime: true, range: true }, '状況': { type: 'select' }, '担当者': { type: 'text' }, 'タスク生成': { type: 'select' }, 'タスク生成_ページ': { type: 'select' }, '依存生成': { type: 'select' }, '生成ページ数': { type: 'number' }, '備考': { type: 'text' } },
    'タスクリスト': { 'タスク名': { type: 'text' }, '作品タイトル': { type: 'text' }, 'ページ': { type: 'text' }, 'コマ': { type: 'text' }, '作業作成粒度': { type: 'select', options: ['ページ単位', 'コマ単位'] }, '作業対象リスト': { type: 'relation', target: '作業対象リスト' }, '作業内容リスト': { type: 'relation', target: '作業内容リスト' }, '作業規模リスト': { type: 'relation', target: '作業規模リスト' }, '対象数': { type: 'number' }, '状況': { type: 'select' }, '担当者': { type: 'text' }, '開始日時': { type: 'date', withTime: true }, '完了日時': { type: 'date', withTime: true }, '作業予定日時': { type: 'date', withTime: true, range: true }, '作業予定時間': { type: 'number' }, '目標作業時間_値': { type: 'number' }, '目標作業時間': { type: 'text' }, '担当者固定': { type: 'checkbox' }, 'シフト固定': { type: 'checkbox' }, 'ページ非共有': { type: 'checkbox' }, 'タスク名を固定': { type: 'checkbox' }, 'シフト割当不能理由': { type: 'text' }, 'ページソート値': { type: 'number' }, '対象色': { type: 'text' }, '作成キー': { type: 'text' }, '備考': { type: 'text' } },
    '作業対象リスト': { '作業対象': { type: 'text' }, '基準作業時間': { type: 'number' }, '担当者候補': { type: 'text' }, '対応する作業内容': { type: 'relation', target: '作業内容リスト' }, '対象色': { type: 'text' }, '備考': { type: 'text' } },
    '作業内容リスト': { '作業内容': { type: 'text' }, '表示名': { type: 'text' }, '別名': { type: 'text' }, '作業順': { type: 'number' }, '依存階層': { type: 'number' }, 'カテゴリ': { type: 'text' }, '作業時間倍率': { type: 'number' }, '担当者候補': { type: 'text' }, '標準粒度': { type: 'select', options: ['ページ単位', 'コマ単位'] }, '対応する作業対象': { type: 'relation', target: '作業対象リスト' }, '備考': { type: 'text' } },
    '作業規模リスト': { '作業規模': { type: 'text' }, '作業時間倍率': { type: 'number' }, '面積比': { type: 'number' }, '備考': { type: 'text' } },
    'スタッフリスト': { 'スタッフ名': { type: 'text' }, '表示名': { type: 'text' }, '権限': { type: 'select', options: ['管理者', 'メンバー'] }, '作業可能時間': { type: 'text' }, '休憩時間': { type: 'text' }, '休日': { type: 'text' }, '担当できる作業': { type: 'relation', target: '作業内容リスト' }, '備考': { type: 'text' } },
    'スケジュール': { '予定名': { type: 'text' }, '種別': { type: 'select', options: ['シフト', '休み', '作業予定'] }, '担当者': { type: 'text' }, '予定日時': { type: 'date', withTime: true, range: true }, '開始時刻': { type: 'text' }, '終了時刻': { type: 'text' }, '作品タイトル': { type: 'text' }, 'タスクリスト': { type: 'relation', target: 'タスクリスト' }, 'スタッフリスト': { type: 'relation', target: 'スタッフリスト' }, 'カレンダーID': { type: 'text' }, '作成キー': { type: 'text' }, '備考': { type: 'text' } },
    '勤怠情報': { 'スタッフ名': { type: 'text' }, '日付': { type: 'date' }, '出勤日時': { type: 'date', withTime: true }, '退勤日時': { type: 'date', withTime: true }, '実績日時': { type: 'date', withTime: true, range: true }, '休憩': { type: 'text' }, '実績時間': { type: 'number' }, '作成キー': { type: 'text' }, '備考': { type: 'text' } },
    '自動シフト調整設定': { '設定名': { type: 'text' }, '自動シフト調整': { type: 'checkbox' }, '自動実行の間隔': { type: 'text' }, '最終実行日時': { type: 'date', withTime: true }, '備考': { type: 'text' } },
    'スケジュール アーカイブ': { '予定名': { type: 'text' }, '種別': { type: 'select' }, '担当者': { type: 'text' }, '予定日時': { type: 'date', withTime: true, range: true }, '作成キー': { type: 'text' }, '備考': { type: 'text' } },
    'タスクリスト アーカイブ': { 'タスク名': { type: 'text' }, '作品タイトル': { type: 'text' }, 'ページ': { type: 'text' }, 'コマ': { type: 'text' }, '状況': { type: 'select' }, '作業予定日時': { type: 'date', withTime: true, range: true }, '作成キー': { type: 'text' }, '備考': { type: 'text' } },
    'データソース': { '役割': { type: 'text' }, '対象シート': { type: 'text' }, '有効': { type: 'checkbox' }, '説明': { type: 'text' } },
  };

  const PM_SEEDS = {
    '作業内容リスト': [
      ['ネーム', { '作業内容': 'ネーム', '表示名': 'ネーム', '作業順': '10', '依存階層': '10', '作業時間倍率': '1', '標準粒度': 'ページ単位' }],
      ['下描き', { '作業内容': '下描き', '表示名': '下描き', '作業順': '40', '依存階層': '40', '作業時間倍率': '1', '標準粒度': 'コマ単位' }],
      ['ペン入れ', { '作業内容': 'ペン入れ', '表示名': 'ペン入れ', '別名': '線画', '作業順': '50', '依存階層': '50', '作業時間倍率': '1', '標準粒度': 'コマ単位' }],
      ['仕上げ', { '作業内容': '仕上げ', '表示名': '仕上げ', '作業順': '60', '依存階層': '60', '作業時間倍率': '1', '標準粒度': 'コマ単位' }],
    ],
    '作業対象リスト': [
      ['全体', { '作業対象': '全体', '基準作業時間': '1' }],
      ['キャラ胸上', { '作業対象': 'キャラ胸上', '基準作業時間': '0.75' }],
      ['背景作画', { '作業対象': '背景作画', '基準作業時間': '2' }],
    ],
    '作業規模リスト': [
      ['小', { '作業規模': '小', '作業時間倍率': '0.5', '面積比': '0.5' }],
      ['中', { '作業規模': '中', '作業時間倍率': '1', '面積比': '1' }],
      ['ページ全体', { '作業規模': 'ページ全体', '作業時間倍率': '1', '面積比': '1' }],
    ],
  };

  function _pmShowStatus(message, error) {
    if (typeof showStatus === 'function') showStatus(message, !!error);
    else console[error ? 'error' : 'log'](message);
  }

  function _pmRecoveryText(base, result) {
    return result?.recovered_count ? `${base}（不足していた制作管理ファイルを自動復旧しました）` : base;
  }

  function _pmRequest(path, options) {
    const method = String(options?.method || 'GET').toUpperCase();
    const body = options?.body || {};
    if (method === 'POST' && typeof apiPost === 'function') return apiPost(path, body);
    if (method === 'GET' && typeof apiFetch === 'function') return apiFetch(path);
    if (window.MeldexDataAccess?.requestJson) return window.MeldexDataAccess.requestJson(path, { method, body });
    throw new Error('制作管理APIを呼び出せません');
  }

  function _pmButton(label, primary) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = primary ? 'btn btn-primary' : 'btn';
    button.textContent = label;
    return button;
  }

  function _pmField(labelText, input) {
    const field = document.createElement('label');
    field.className = 'field';
    const label = document.createElement('span');
    label.textContent = labelText;
    field.append(label, input);
    return field;
  }

  function _pmInput(value, placeholder) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value || '';
    input.placeholder = placeholder || '';
    input.style.width = '100%';
    return input;
  }

  function _pmSelect(options, value) {
    const select = document.createElement('select');
    options.forEach((item) => {
      const option = document.createElement('option');
      option.value = item;
      option.textContent = item;
      option.selected = item === value;
      select.appendChild(option);
    });
    return select;
  }

  function _pmModal(title) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.minWidth = '420px';
    modal.style.maxWidth = '720px';
    const heading = document.createElement('h3');
    heading.textContent = title;
    modal.appendChild(heading);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) overlay.remove();
    });
    return { overlay, modal };
  }

  function _pmFooter(overlay, okLabel, onOk) {
    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '8px';
    const cancel = _pmButton('キャンセル');
    const ok = _pmButton(okLabel, true);
    cancel.addEventListener('click', () => overlay.remove());
    ok.addEventListener('click', async () => {
      ok.disabled = true;
      try {
        await onOk();
        overlay.remove();
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
    const result = await _pmRequest('/production-management/init', { method: 'POST', body: {} });
    _pmShowStatus(_pmRecoveryText(`制作管理を準備しました: ${result.root || PM_ROOT}`, result));
  }

  function openProductionTaskCreate() {
    const { overlay, modal } = _pmModal('ページ単位またはコマ単位の作業を作成');
    const title = _pmInput('', '作品タイトル_話数');
    const pages = _pmInput('1', 'ページ数');
    const panels = _pmInput('1', 'コマ数');
    const targets = _pmInput('全体', '全体,背景作画');
    const contents = _pmInput('ネーム', 'ネーム,下描き');
    const scales = _pmInput('ページ全体', 'ページ全体,中');
    const granularity = _pmSelect(['ページ単位', 'コマ単位'], 'ページ単位');
    modal.append(
      _pmField('作品タイトル_話数', title),
      _pmField('ページ数', pages),
      _pmField('作業作成粒度', granularity),
      _pmField('コマ数', panels),
      _pmField('作業対象リスト', targets),
      _pmField('作業内容リスト', contents),
      _pmField('作業規模リスト', scales),
      _pmFooter(overlay, '作成', async () => {
        const body = {
          work_title: title.value.trim() || '無題作品',
          page_count: pages.value,
          granularity: granularity.value,
          panel_count: panels.value,
          target_names: targets.value,
          content_names: contents.value,
          scale_names: scales.value,
        };
        const result = await _pmRequest('/production-management/tasks/create', { method: 'POST', body });
        _pmShowStatus(_pmRecoveryText(`作業を作成しました: ${result.created || 0}件`, result));
      })
    );
    title.focus();
  }

  function openProductionShiftImport() {
    const { overlay, modal } = _pmModal('シフト表を取り込む');
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv';
    const preview = document.createElement('div');
    preview.style.maxHeight = '240px';
    preview.style.overflow = 'auto';
    preview.style.marginTop = '8px';
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
    modal.append(_pmField('Excel / CSV', fileInput), preview, _pmFooter(overlay, '取り込む', async () => {
      if (!parsedRows.length) throw new Error('取り込む行がありません');
      const result = await _pmRequest('/production-management/shifts/apply', { method: 'POST', body: { rows: parsedRows, source_file: fileInput.files?.[0]?.name || '' } });
      _pmShowStatus(_pmRecoveryText(`シフトを取り込みました: ${result.count || 0}件`, result));
    }));
  }

  function _pmRenderPreview(container, rows) {
    container.replaceChildren();
    const table = document.createElement('table');
    table.className = 'db-table';
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
    container.appendChild(table);
  }

  async function runProductionAssignment() {
    const result = await _pmRequest('/production-management/assign/apply', { method: 'POST', body: {} });
    _pmShowStatus(_pmRecoveryText(`担当者と時間を割り当てました: ${result.updated || 0}件`, result));
  }

  function openProductionExport() {
    const { overlay, modal } = _pmModal('シフト、実績、作業予定を書き出す');
    const kind = _pmSelect(['all', 'shifts', 'attendance', 'work'], 'all');
    const format = _pmSelect(['csv', 'xlsx'], 'csv');
    const from = _pmInput('', '2026-05-01');
    const to = _pmInput('', '2026-05-31');
    modal.append(
      _pmField('対象', kind),
      _pmField('形式', format),
      _pmField('開始日', from),
      _pmField('終了日', to),
      _pmFooter(overlay, '保存', async () => {
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
    if (/\.xlsx$/i.test(file.name)) return _pmRowsToShifts(await _pmReadXlsx(file));
    return _pmRowsToShifts(_pmParseCsv(await file.text()));
  }

  function _pmParseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quote = false;
    const input = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i];
      if (quote && ch === '"' && input[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quote = !quote;
      } else if (!quote && ch === ',') {
        row.push(cell);
        cell = '';
      } else if (!quote && (ch === '\n' || ch === '\r')) {
        if (ch === '\r' && input[i + 1] === '\n') i += 1;
        row.push(cell);
        if (row.some(v => String(v).trim())) rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += ch;
      }
    }
    row.push(cell);
    if (row.some(v => String(v).trim())) rows.push(row);
    return rows;
  }

  function _pmRowsToShifts(rows) {
    if (!Array.isArray(rows) || rows.length < 2) return [];
    const headers = rows[0].map(v => String(v || '').trim());
    const vertical = _pmVerticalShiftRows(headers, rows.slice(1));
    if (vertical.length) return vertical;
    return _pmHorizontalShiftRows(headers, rows.slice(1));
  }

  function _pmVerticalShiftRows(headers, rows) {
    const userIdx = _pmHeaderIndex(headers, ['担当者', 'スタッフ名', 'user', 'name']);
    const dateIdx = _pmHeaderIndex(headers, ['日付', 'date']);
    if (userIdx < 0 || dateIdx < 0) return [];
    const startIdx = _pmHeaderIndex(headers, ['開始', '開始時刻', 'start', 'start_time']);
    const endIdx = _pmHeaderIndex(headers, ['終了', '終了時刻', 'end', 'end_time']);
    const typeIdx = _pmHeaderIndex(headers, ['種別', 'type']);
    const noteIdx = _pmHeaderIndex(headers, ['備考', 'note']);
    return rows.map(row => _pmShiftRow(row[userIdx], row[dateIdx], row[startIdx], row[endIdx], row[typeIdx], row[noteIdx])).filter(Boolean);
  }

  function _pmHorizontalShiftRows(headers, rows) {
    const result = [];
    rows.forEach((row) => {
      const user = String(row[0] || '').trim();
      if (!user) return;
      headers.slice(1).forEach((header, index) => {
        const range = _pmTimeRange(row[index + 1]);
        const date = _pmDate(header);
        if (date && range) result.push(_pmShiftRow(user, date, range.start, range.end, 'work', ''));
      });
    });
    return result.filter(Boolean);
  }

  function _pmHeaderIndex(headers, names) {
    const normalized = names.map(v => String(v).toLowerCase());
    return headers.findIndex(header => normalized.includes(String(header).trim().toLowerCase()));
  }

  function _pmShiftRow(user, date, start, end, type, note) {
    const normalizedDate = _pmDate(date);
    const startText = _pmTime(start);
    const endText = _pmTime(end);
    const range = !endText ? _pmTimeRange(start) : null;
    const finalStart = range ? range.start : startText;
    const finalEnd = range ? range.end : endText;
    if (!String(user || '').trim() || !normalizedDate) return null;
    return { user: String(user).trim(), date: normalizedDate, start_time: finalStart, end_time: finalEnd, type: _pmShiftType(type), note: String(note || '') };
  }

  function _pmShiftType(value) {
    const text = String(value || '').trim().toLowerCase();
    if (text === '休み' || text === '休' || text === 'off') return 'off';
    if (text === '祝日' || text === 'holiday') return 'holiday';
    return 'work';
  }

  function _pmDate(value) {
    const text = String(value || '').trim().replace(/\//g, '-');
    const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (match) return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
    if (/^\d+(?:\.\d+)?$/.test(text)) {
      const serial = Number(text);
      if (serial >= 30000 && serial <= 80000) {
        const date = new Date(Math.round((serial - 25569) * 86400000));
        if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
      }
    }
    return '';
  }

  function _pmTime(value) {
    const match = String(value || '').trim().match(/(\d{1,2}):(\d{2})/);
    return match ? `${String(match[1]).padStart(2, '0')}:${match[2]}` : '';
  }

  function _pmTimeRange(value) {
    const text = String(value || '');
    const match = text.match(/(\d{1,2}:\d{2})\s*(?:~|-|〜|から)\s*(\d{1,2}:\d{2})/);
    return match ? { start: _pmTime(match[1]), end: _pmTime(match[2]) } : null;
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
    await _pmWriteCalendarStore(provider, internals, 'events', rows.filter(row => String(row.id) !== eventId));
  }

  function _pmInstallCloudHandler() {
    const internals = window.__MeldexPwaDataAccessInternals;
    const handlers = window.__MeldexPwaDataAccessExtensions;
    if (!internals || !Array.isArray(handlers)) return;
    handlers.push(async function _productionManagementCloudHandler({ method, body, url, pathname }) {
      if (!/^\/production-management(\/|$)/.test(pathname)) return internals.NOT_HANDLED;
      const provider = await internals._requirePwaProvider(method === 'GET' ? 'read' : 'readwrite');
      if (pathname === '/production-management/status' && method === 'GET') return _pmCloudStatus(provider, internals);
      if (pathname === '/production-management/init' && method === 'POST') return _pmCloudInit(provider, internals);
      if (pathname === '/production-management/tasks/create' && method === 'POST') return _pmCloudCreateTasks(provider, internals, body || {});
      if (pathname === '/production-management/shifts/apply' && method === 'POST') return _pmCloudApplyShifts(provider, internals, body || {});
      if (pathname === '/production-management/assign/apply' && method === 'POST') {
        return _pmCloudApplyAssignment(provider, internals, body || {});
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

  async function _pmCloudInit(provider, internals) {
    const missing = await _pmCloudMissing(provider, internals);
    await internals._directoryHandle(provider, PM_ROOT, true);
    for (const [name, text] of Object.entries(PM_REQUIRED_PAGES)) await _pmCloudEnsurePage(provider, internals, name, text);
    for (const sheet of PM_SHEETS) await _pmCloudEnsureSheet(provider, internals, sheet);
    await _pmCloudSeed(provider, internals);
    const recovered = [...missing];
    const cal = await _pmCloudRecoverFromCalendar(provider, internals, missing);
    if (cal.shifts) recovered.push(`カレンダーからシフトを復旧: ${cal.shifts}件`);
    if (cal.tasks) recovered.push(`カレンダーから作業予定を復旧: ${cal.tasks}件`);
    return { ok: true, root: PM_ROOT, sheets: PM_SHEETS, cloud: true, ..._pmCloudRecoveryPayload(recovered) };
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
    return !!(await internals._resolveEntryHandle(provider, path).catch(() => null));
  }

  async function _pmCloudEnsurePage(provider, internals, name, text) {
    const path = internals._joinPath(PM_ROOT, name);
    if (!await _pmCloudEntryExists(provider, path, internals)) await provider.writeText(path, text);
  }

  function _pmCloudRecoveryPayload(items) {
    const unique = [...new Set((items || []).filter(Boolean))];
    return { recovered: !!unique.length, recovered_count: unique.length, recovered_items: unique, message: unique.length ? `制作管理に必要なファイルを自動復旧しました: ${unique.slice(0, 4).join('、')}` : '' };
  }

  async function _pmCloudEnsureSheet(provider, internals, sheet) {
    const dir = internals._joinPath(_pmCloudRoot(internals), sheet);
    await internals._directoryHandle(provider, dir, true);
    const note = internals._joinPath(dir, sheet + '.md');
    const parsed = await _pmCloudReadFrontmatter(provider, note);
    const frontmatter = { ...(parsed.frontmatter || {}), type: 'settings-db', schema_version: 1 };
    frontmatter.property_types = { ...(frontmatter.property_types || {}), ...(PM_PROPERTY_TYPES[sheet] || {}) };
    if (sheet === 'タスクリスト') frontmatter.calendar_mapping = frontmatter.calendar_mapping || { startProp: '作業予定日時', endProp: '作業予定日時', titleProp: 'タスク名', descriptionProp: '備考' };
    if (sheet === 'スケジュール') frontmatter.calendar_mapping = frontmatter.calendar_mapping || { startProp: '予定日時', endProp: '予定日時', titleProp: '予定名', descriptionProp: '備考' };
    await provider.writeText(note, _pmCloudFrontmatterText(frontmatter, parsed.body || `# ${sheet}\n\n`));
  }

  async function _pmCloudSeed(provider, internals) {
    for (const [sheet, rows] of Object.entries(PM_SEEDS)) {
      for (const [name, props] of rows) await _pmCloudUpsertEntry(provider, internals, sheet, name, props, Object.keys(props)[0], name);
    }
    for (const sheet of PM_SHEETS) {
      await _pmCloudUpsertEntry(provider, internals, 'データソース', sheet, { '役割': sheet, '対象シート': `シート/${sheet}`, '有効': 'true', '説明': '制作管理で使う標準シート' }, '役割', sheet);
    }
  }

  async function _pmCloudCreateTasks(provider, internals, body) {
    const init = await _pmCloudInit(provider, internals);
    const rows = _pmBuildTaskRows(body || {});
    let created = 0;
    for (const row of rows) {
      const path = await _pmCloudFindByProp(provider, internals, 'タスクリスト', '作成キー', row['作成キー']);
      if (path) continue;
      await _pmCloudUpsertEntry(provider, internals, 'タスクリスト', row['タスク名'], row, '作成キー', row['作成キー']);
      created += 1;
    }
    const workTitle = String((body || {}).work_title || (body || {})['作品タイトル'] || (body || {}).title || '無題作品');
    const pageCount = Math.max(1, Number((body || {}).page_count || (body || {})['ページ数'] || 1) || 1);
    await _pmCloudUpsertEntry(provider, internals, '作品リスト', workTitle, {
      '作品タイトル_話数': workTitle,
      'ページ数': String(pageCount),
      '作業作成粒度': String((body || {}).granularity || (body || {})['作業作成粒度'] || 'ページ単位'),
      '生成ページ数': String(pageCount),
      'タスク生成': '作成済み',
    }, '作品タイトル_話数', workTitle);
    return { ok: true, created, skipped: rows.length - created, count: rows.length, cloud: true, ..._pmCloudRecoveryPayload(init.recovered_items) };
  }

  async function _pmCloudApplyShifts(provider, internals, body) {
    const init = await _pmCloudInit(provider, internals);
    const rows = (body.rows || body.shifts || []).map(_pmNormalizeIncomingShift).filter(Boolean);
    for (const row of rows) {
      const id = _pmShiftId(row);
      const scheduleName = `${row.date}_${row.user}_${_pmScheduleTypeLabel(row.type)}`;
      await _pmCloudUpsertEntry(provider, internals, 'スケジュール', scheduleName, _pmScheduleProps(row, id), '作成キー', id);
      await window.MeldexDataAccess.requestJson('/cal/shifts', { method: 'POST', body: { id, ...row } });
    }
    return { ok: true, count: rows.length, created: rows.length, updated: 0, cloud: true, ..._pmCloudRecoveryPayload(init.recovered_items) };
  }

  async function _pmCloudApplyAssignment(provider, internals, body) {
    const init = await _pmCloudInit(provider, internals);
    const planned = await _pmCloudAssignmentPlan(provider, internals, body || {});
    for (const row of planned) {
      await _pmCloudUpsertEntry(provider, internals, 'タスクリスト', row.task_name, {
        '担当者': row.user,
        '作業予定日時': `${row.start}|${row.end}`,
        '作業予定時間': String(row.hours),
        '状況': '着手待ち',
      }, '作成キー', row.task_key);
      await _pmSyncCloudWorkEvent(provider, internals, row);
    }
    return { ok: true, updated: planned.length, rows: planned, cloud: true, ..._pmCloudRecoveryPayload(init.recovered_items) };
  }

  async function _pmCloudAssignmentPlan(provider, internals, body) {
    const tasks = await _pmCloudUnassignedTasks(provider, internals);
    const shifts = await _pmCloudWorkShifts(body.date_from || new Date().toISOString().slice(0, 10));
    const maxCount = Math.max(1, Number(body.limit || 200) || 200);
    const planned = [];
    for (const task of tasks.slice(0, maxCount)) {
      const plan = _pmCloudPlaceTaskInShift(task, shifts);
      if (plan) planned.push(plan);
    }
    return planned;
  }

  async function _pmCloudUnassignedTasks(provider, internals) {
    const entries = await _pmCloudListEntries(provider, internals, 'タスクリスト');
    return entries
      .filter(item => !_pmCloudPropValue(item.frontmatter, '作業予定日時') && _pmCloudPropValue(item.frontmatter, '状況') !== '完了')
      .map((item) => {
        const id = String(item.frontmatter?.id || _pmHash(item.path).slice(0, 12));
        const key = _pmCloudPropValue(item.frontmatter, '作成キー') || id;
        return {
          path: item.path,
          id,
          task_key: key,
          task_name: _pmCloudPropValue(item.frontmatter, 'タスク名') || item.name,
          hours: Math.max(0.25, Number(_pmCloudPropValue(item.frontmatter, '目標作業時間_値') || 1) || 1),
          fixed_user: _pmCloudPropValue(item.frontmatter, '担当者'),
        };
      });
  }

  async function _pmCloudWorkShifts(dateFrom) {
    const rows = await window.MeldexDataAccess.requestJson('/cal/shifts').catch(() => []);
    return (rows || [])
      .map(_pmNormalizeIncomingShift)
      .filter(row => row && row.type === 'work' && (!dateFrom || row.date >= dateFrom))
      .sort((a, b) => [a.date, a.start_time, a.user].join('|').localeCompare([b.date, b.start_time, b.user].join('|')))
      .map(row => ({ ...row, _cursor: _pmDateTime(row.date, row.start_time || '00:00'), _end: _pmShiftEndDateTime(row) }));
  }

  function _pmCloudPlaceTaskInShift(task, shifts) {
    const durationMs = Math.max(0.25, Number(task.hours || 1) || 1) * 60 * 60 * 1000;
    for (const shift of shifts) {
      if (task.fixed_user && task.fixed_user !== shift.user) continue;
      const start = shift._cursor;
      const end = new Date(start.getTime() + durationMs);
      if (end > shift._end) continue;
      shift._cursor = end;
      return {
        task_path: task.path,
        task_id: task.id,
        task_key: task.task_key,
        task_name: task.task_name,
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
        await _pmCloudUpsertEntry(provider, internals, 'タスクリスト', row.title || '復旧した作業予定', { 'タスク名': row.title || '復旧した作業予定', '担当者': row.user || '', '作業予定日時': row.start && row.end ? `${row.start}|${row.end}` : row.start || '', '状況': '着手待ち', '作成キー': key, '備考': row.description || 'カレンダーから復旧' }, '作成キー', key);
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

  async function _pmCloudReadFrontmatter(provider, path) {
    let text = '';
    try { text = await provider.readText(path); } catch {}
    const match = String(text).match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) return { frontmatter: {}, body: text };
    return { frontmatter: _pmYamlLite(match[1]), body: text.slice(match[0].length) };
  }

  function _pmYamlLite(text) {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map(line => ({ indent: (line.match(/^\s*/) || [''])[0].length, text: line.trim() }))
      .filter(line => line.text && !line.text.startsWith('#'));
    function parseBlock(index, indent) {
      if (index >= lines.length) return { value: {}, index };
      if (lines[index].indent < indent) return { value: {}, index };
      return lines[index].text.startsWith('- ')
        ? parseArray(index, lines[index].indent)
        : parseObject(index, indent);
    }
    function parseObject(index, indent) {
      const out = {};
      while (index < lines.length && lines[index].indent >= indent) {
        const line = lines[index];
        if (line.indent < indent || line.text.startsWith('- ')) break;
        if (line.indent > indent) { index += 1; continue; }
        const pair = _pmYamlPair(line.text);
        if (!pair) { index += 1; continue; }
        index += 1;
        if (pair.raw) out[pair.key] = _pmYamlScalar(pair.raw);
        else {
          const nested = parseBlock(index, indent + 2);
          out[pair.key] = nested.value;
          index = nested.index;
        }
      }
      return { value: out, index };
    }
    function parseArray(index, indent) {
      const out = [];
      while (index < lines.length && lines[index].indent === indent && lines[index].text.startsWith('- ')) {
        const item = lines[index].text.slice(2).trim();
        index += 1;
        let value;
        if (!item) {
          const nested = parseBlock(index, indent + 2);
          value = nested.value;
          index = nested.index;
        } else if (item.startsWith('{') || item.startsWith('[')) {
          value = _pmYamlScalar(item);
        } else if (_pmYamlPair(item)) {
          const first = _pmYamlPair(item);
          value = {};
          value[first.key] = first.raw ? _pmYamlScalar(first.raw) : {};
          const nested = parseObject(index, indent + 2);
          value = { ...value, ...(nested.value || {}) };
          index = nested.index;
        } else {
          value = _pmYamlScalar(item);
        }
        out.push(value);
      }
      return { value: out, index };
    }
    return parseBlock(0, 0).value || {};
  }

  function _pmYamlPair(text) {
    const match = String(text || '').match(/^([^:#][^:]*):(?:\s*(.*))?$/);
    if (!match) return null;
    return { key: match[1].trim(), raw: match[2] == null ? '' : match[2].trim() };
  }

  function _pmYamlScalar(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    try { return JSON.parse(text); } catch {}
