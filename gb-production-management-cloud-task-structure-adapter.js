  // gb-production-management-cloud-task-structure-adapter.js: フル再計算エンジン
  // （gb-production-recalc-engine-cloud-adapter.js）・階層構造編集
  // （gb-production-management-task-structure.js）向けの依存注入オブジェクトの組み立てと、
  // シフト/日付整形・ハッシュ・安全なファイル名生成などの共有ユーティリティを担当する
  // （責務単位分割 2026-08-12。旧 gb-production-management.part02.js の一部）。
  //
  // gb-production-management.part01.js から続く共有クロージャ（IIFEの raw
  // concatenation）に属し、このファイル自体は自前のIIFEを持たない。読み込み順は
  // gb-production-management.js を参照。

  // フル再計算エンジン（gb-production-recalc-engine-cloud-adapter.js、別クロージャ）向けの依存
  // 注入。_pmCloudTaskStructureDeps() と同じ流儀（part01.js/part02.js は同一IIFEなので、
  // どちらに置いてもprivateヘルパーへ同様にアクセスできる）。
  function _pmRecalcEngineDeps() {
    return {
      listEntries: _pmCloudListEntries, listAllTaskEntries: _pmCloudListAllTaskEntries, init: _pmCloudInit,
      mutationJournal: _pmCloudMutationJournal, journalText: _pmCloudJournalText, journalCalendar: _pmCloudJournalCalendar,
      rollbackMutation: _pmCloudRollbackMutation, syncTaskEvent: _pmCloudSyncTaskEvent,
      readCalendarStore: _pmReadCalendarStore, writeCalendarStore: _pmWriteCalendarStore,
      // タスク作成系のCloud機能が同じ書込みヘルパーを使えるよう、追加の参照も
      // 上乗せする（_pmRecalcEngineDeps()のスーパーセット）。
      propValue: _pmCloudPropValue, writeNewEntry: _pmCloudWriteNewEntry,
      ensureTaskSheetForWork: _pmCloudEnsureTaskSheetForWork, journalDirectory: _pmCloudJournalDirectory,
    };
  }

  function _pmCloudTaskStructureDeps() {
    return {
      propValue: _pmCloudPropValue,
      belongsToWork: _pmCloudTaskBelongsToWork,
      hash: _pmHash,
      findWork: _pmCloudFindWork,
      listTasks: _pmCloudListAllTaskEntries,
      buildRows: _pmBuildTaskRows,
      validateRows: _pmCloudValidateTaskRows,
      error: _pmCloudError,
      init: _pmCloudInit,
      mutationJournal: _pmCloudMutationJournal,
      root: _pmCloudRoot,
      journalDirectory: _pmCloudJournalDirectory,
      journalText: _pmCloudJournalText,
      ensureSheet: _pmCloudEnsureSheet,
      uniqueEntryPath: _pmCloudUniqueEntryPath,
      clone: _pmCloudClone,
      frontmatterText: _pmCloudFrontmatterText,
      writeNewEntry: _pmCloudWriteNewEntry,
      updateEntry: _pmCloudUpdateEntryAtPath,
      rollback: _pmCloudRollbackMutation,
    };
  }

  function _pmCloudPreviewTaskStructure(provider, internals, body) {
    return window.MeldexProductionCloudTaskStructure.preview(
      provider,
      internals,
      body,
      _pmCloudTaskStructureDeps(),
    );
  }

  function _pmCloudApplyTaskStructure(provider, internals, body) {
    return window.MeldexProductionCloudTaskStructure.apply(
      provider,
      internals,
      body,
      _pmCloudTaskStructureDeps(),
    );
  }

  function _pmTaskDimension(body, keys, fallback, label) {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
      const values = [...new Set(_pmList(body[key]))];
      if (!values.length) throw new Error(`${label}を1つ以上指定してください`);
      return values;
    }
    return fallback.slice();
  }

  function _pmList(value) {
    if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
    return String(value || '').split(/[,、\n]/).map(v => v.trim()).filter(Boolean);
  }

  function _pmTaskTitle(path, target, scale, content) {
    return [_pmHierarchyId(path), target === '全体' ? '' : target, (scale === 'ページ全体' || scale === '標準') ? '' : scale, content].filter(Boolean).join(' ');
  }

  function _pmSortPath(path) {
    const number = path.map(part => String(part).match(/\d+/)?.[0]).find(Boolean);
    return number ? Number(number) : 0;
  }

  function _pmNormalizeIncomingShift(row) {
    if (!row) return null;
    const user = String(row.user || row['担当者'] || row['スタッフ名'] || '').trim();
    const date = PM_SHIFT_PARSER.normalizeDate(row.date || row['日付']);
    if (!user || !date) return null;
    const startRaw = row.start_time || row['開始時刻'] || row.start;
    const endRaw = row.end_time || row['終了時刻'] || row.end;
    const start_time = PM_SHIFT_PARSER.normalizeTime(startRaw);
    const end_time = PM_SHIFT_PARSER.normalizeTime(endRaw, { allowOver24: true });
    if (String(startRaw || '').trim() && !start_time) return null;
    if (String(endRaw || '').trim() && !end_time) return null;
    return { user, date, start_time, end_time, type: PM_SHIFT_PARSER.normalizeType(row.type || row['種別']), note: String(row.note || row['備考'] || '') };
  }

  function _pmScheduleProps(row, id) {
    const label = _pmScheduleTypeLabel(row.type);
    return { '予定名': `${label} ${row.user}`, '種別': label, '担当者': row.user, '予定日時': _pmDateRange(row.date, row.start_time, row.end_time), '開始時刻': row.start_time, '終了時刻': row.end_time, 'カレンダーID': `shift:${id}`, '作成キー': id, '備考': row.note };
  }

  function _pmScheduleTypeLabel(type) {
    return type === 'off' || type === 'holiday' ? '休み' : 'シフト';
  }

  function _pmDateRange(date, start, end) {
    if (!start) return date;
    const endDate = end && end <= start ? _pmAddDay(date) : date;
    return `${date}T${start}|${endDate}T${end || start}`;
  }

  function _pmAddDay(date) {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    // toISOString()（UTC変換）はUTCより進んだタイムゾーンで同じ日付を返すため、ローカル整形を使う
    return _pmDateTimeText(d).slice(0, 10);
  }

  function _pmDateTime(date, time) {
    return new Date(`${date}T${time || '00:00'}`);
  }

  function _pmShiftEndDateTime(row) {
    return _pmDateTime(_pmCloudShiftEndDate(row), row.end_time || row.start_time || '00:00');
  }

  function _pmDateTimeText(value) {
    const pad = n => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
  }

  function _pmShiftId(row) {
    return 'pm-shift-' + _pmHash([row.user, row.date, row.start_time, row.end_time, row.type].join('|')).slice(0, 20);
  }
  function _pmSafeName(value) {
    return String(value || '無題').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 100) || '無題';
  }

  function _pmHash(value) {
    let hash = 2166136261;
    String(value || '').split('').forEach((ch) => {
      hash ^= ch.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    });
    return (hash >>> 0).toString(16) + Math.abs(String(value || '').length).toString(16);
  }
