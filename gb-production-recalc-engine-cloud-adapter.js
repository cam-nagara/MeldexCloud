/* ==============================
   gb-production-recalc-engine-cloud-adapter.js: フル再計算エンジンのCloud（Dropboxモード）I/Oアダプター

   production-management-ux-improvement-plan-2026-08-04.md §4-1。gb-production-recalc-engine.js
   （純粋な割当アルゴリズム）を、Cloudのファイル/カレンダーストレージへ橋渡しする。

   このファイルは gb-production-management.part01.js/part02.js とは別クロージャ（独立IIFE）。
   Cloud側の内部ヘルパー（_pmCloudListAllTaskEntries 等）はそのクロージャの外から直接参照でき
   ないため、gb-production-management-task-structure.js と同じ流儀（呼び出し元が deps オブジェクト
   経由で必要な関数だけを注入する）を踏襲する。deps の組み立ては
   gb-production-management.part01.js の `_pmRecalcEngineDeps()` を参照。

   window.MeldexCloudFrontmatterLite（フロントマター読み書き）は gb-cloud-frontmatter-lite.js が
   window へ公開済みのため、ここでは直接参照する（DI不要）。
   ============================== */
(function () {
  'use strict';

  const Engine = window.MeldexProductionRecalcEngine;

  // 制作管理UX改善計画（2026-08-04）§5-1: タスクリストの内部専用列は production_internal
  // へ移った（gb-production-management.part01.js の PM_INTERNAL_METADATA_PROPERTIES /
  // Desktop meldex_production_management_support.INTERNAL_METADATA_PROPERTIES と同一集合。
  // このファイルは別クロージャのためローカルに複製する）。
  const RECALC_INTERNAL_METADATA_PROPERTIES = new Set([
    '階層パス', '階層ラベル',
    '単位レベル1', '単位レベル2', '単位レベル3', '単位レベル4', '単位レベル5',
    'プリセット種別', '作業作成粒度', 'ページソート値', '作成キー', '元テンプレートID', '作業予定区間',
  ]);

  // --- フロントマター値の読み取り（meldex_production_recalculate._prop_value 相当） ---

  function propValueFromFrontmatter(frontmatter, name) {
    if (RECALC_INTERNAL_METADATA_PROPERTIES.has(name)) {
      const internal = frontmatter && frontmatter.production_internal;
      if (internal && typeof internal === 'object' && Object.prototype.hasOwnProperty.call(internal, name)) {
        const value = internal[name];
        if (value !== null && value !== undefined && value !== '') return String(value).trim();
      }
    }
    const raw = (frontmatter && frontmatter.properties && frontmatter.properties[name]) || [];
    const list = Array.isArray(raw) ? raw : [raw];
    const adopted = list.find(v => v && typeof v === 'object' && (v.status === '採用' || v.status === '掲載済み'));
    const value = adopted !== undefined ? adopted : (list.length ? list[0] : '');
    const plain = value && typeof value === 'object' ? (value.value == null ? '' : value.value) : (value == null ? '' : value);
    return String(plain).trim();
  }

  function rangeValue(value) {
    const text = String(value == null ? '' : value);
    const idx = text.indexOf('|');
    if (idx === -1) return [text.trim(), ''];
    return [text.slice(0, idx).trim(), text.slice(idx + 1).trim()];
  }

  function staleError() {
    const error = new Error('制作状況が変わりました。再度プレビューしてください');
    error.status = 409;
    return error;
  }

  // --- 読み込み（_load_tasks / _load_staff / _work_deadlines / _content_order / _content_candidates） ---

  async function workDeadlines(provider, internals, deps) {
    const entries = await deps.listEntries(provider, internals, '作品リスト');
    const deadlines = {};
    (entries || []).forEach(entry => {
      const period = rangeValue(propValueFromFrontmatter(entry.frontmatter, '作業期間'));
      if (period[1]) deadlines[entry.name] = period[1];
    });
    return deadlines;
  }

  async function contentOrder(provider, internals, deps) {
    const entries = await deps.listEntries(provider, internals, '作業内容リスト');
    const order = new Map();
    (entries || []).forEach(entry => {
      order.set(entry.name, Engine.safeFloat(propValueFromFrontmatter(entry.frontmatter, '作業順'), 9999));
    });
    return order;
  }

  async function contentCandidates(provider, internals, deps) {
    const entries = await deps.listEntries(provider, internals, '作業内容リスト');
    const candidates = new Map();
    (entries || []).forEach(entry => {
      candidates.set(entry.name, new Set(Engine.listValue(propValueFromFrontmatter(entry.frontmatter, '担当者候補'))));
    });
    return candidates;
  }

  async function loadTasks(provider, internals, deps, includeCompleted) {
    const deadlines = await workDeadlines(provider, internals, deps);
    const entries = await deps.listAllTaskEntries(provider, internals);
    const rows = [];
    (entries || []).forEach(entry => {
      const fm = entry.frontmatter || {};
      const status = propValueFromFrontmatter(fm, '状況');
      if (status === '完了' && !includeCompleted) return;
      const rangeText = propValueFromFrontmatter(fm, '作業予定日時');
      const planned = rangeValue(rangeText);
      const plannedSegments = Engine.parseSegments(propValueFromFrontmatter(fm, '作業予定区間'));
      const workTitle = propValueFromFrontmatter(fm, '作品タイトル') || propValueFromFrontmatter(fm, '作品タイトル_話数');
      const assigneeFixed = Engine.truthy(propValueFromFrontmatter(fm, '担当者固定'));
      rows.push({
        path: entry.path,
        id: String(fm.id || entry.name),
        task_name: entry.name,
        work_title: workTitle,
        hierarchy_path: propValueFromFrontmatter(fm, '階層パス'),
        content: propValueFromFrontmatter(fm, '作業内容リスト'),
        target: propValueFromFrontmatter(fm, '作業対象リスト'),
        scale: propValueFromFrontmatter(fm, '作業規模リスト'),
        priority: propValueFromFrontmatter(fm, '優先度'),
        status,
        current_user: propValueFromFrontmatter(fm, '担当者'),
        current_range: rangeText,
        current_start: planned[0],
        current_end: planned[1],
        current_segments: plannedSegments,
        planned_hours: Engine.safeFloat(propValueFromFrontmatter(fm, '作業予定時間'), 0),
        target_hours: Engine.safeFloat(propValueFromFrontmatter(fm, '目標作業時間_値'), 1),
        creation_key: propValueFromFrontmatter(fm, '作成キー'),
        assignee_fixed: assigneeFixed,
        fixed_user: assigneeFixed ? propValueFromFrontmatter(fm, '担当者') : '',
        manual_locked: Engine.truthy(propValueFromFrontmatter(fm, '再計算ロック')) || Engine.truthy(propValueFromFrontmatter(fm, 'シフト固定')),
        sort_value: Engine.safeFloat(propValueFromFrontmatter(fm, 'ページソート値'), 0),
        deadline: deadlines[workTitle] || '',
        color: propValueFromFrontmatter(fm, '対象色'),
      });
    });
    return rows;
  }

  async function loadStaff(boundResolver) {
    const result = boundResolver
      ? await boundResolver.resolve()
      : await window.MeldexDataAccess.requestJson('/staff-registry/list');
    const duplicates = Array.isArray(result && result.duplicates) ? result.duplicates : [];
    if (duplicates.length) {
      const dup = duplicates[0];
      const entries = (dup.entries || []).join('、');
      const error = new Error(`ユーザー「${dup.user}」が複数のスタッフに設定されています: ${entries}`);
      error.status = 409;
      throw error;
    }
    const rows = [];
    (result && result.staff ? result.staff : []).forEach(row => {
      const name = String((row && row.user) || '').trim();
      if (!name) return;
      rows.push({
        name,
        display: (row && (row.display || row.entry_name)) || name,
        work_hours: (row && row.work_hours) || '',
        break_hours: (row && row.break_hours) || '',
        holidays: (row && row.holidays) || '',
        active_from: (row && row.active_from) || '',
        active_to: (row && row.active_to) || '',
      });
    });
    return rows;
  }

  const _SHIFT_SORT_KEY = row => `${row.date || ''} ${row.start_time || ''} ${row.user || ''}`;

  async function loadShiftRows(provider, internals, deps, periodValue) {
    const all = await deps.readCalendarStore(provider, internals, 'shifts');
    const filtered = (all || []).filter(row => row && row.type === 'work' && row.date >= periodValue.start && row.date <= periodValue.end);
    filtered.sort((a, b) => (_SHIFT_SORT_KEY(a) < _SHIFT_SORT_KEY(b) ? -1 : _SHIFT_SORT_KEY(a) > _SHIFT_SORT_KEY(b) ? 1 : 0));
    const rows = [];
    filtered.forEach(row => {
      const parsed = Engine.shiftDatetimes(row);
      if (parsed) rows.push({ ...row, _start: parsed[0], _end: parsed[1] });
    });
    return rows;
  }

  async function loadShiftWarnings(provider, internals, deps, periodValue) {
    const all = await deps.readCalendarStore(provider, internals, 'shifts');
    return (all || [])
      .filter(row => row && row.type === 'work' && row.date >= periodValue.start && row.date <= periodValue.end && !String(row.end_time || '').trim())
      .sort((a, b) => (_SHIFT_SORT_KEY(a) < _SHIFT_SORT_KEY(b) ? -1 : _SHIFT_SORT_KEY(a) > _SHIFT_SORT_KEY(b) ? 1 : 0))
      .map(row => ({ type: 'invalid_shift', user: row.user || '', date: row.date || '', reason: '終了時刻がない勤務シフトは割り当て候補から除外しました' }));
  }

  // --- 書き込み（_write_task_assignment / _write_task_unassigned） ---

  function applyPropsToFrontmatter(frontmatter, propsMap) {
    const fm = { ...(frontmatter || {}) };
    fm.properties = { ...(fm.properties || {}) };
    fm.production_internal = { ...(fm.production_internal || {}) };
    const now = new Date().toISOString();
    fm.modified = now;
    Object.entries(propsMap).forEach(([key, value]) => {
      // このアダプターはタスクエントリしか扱わないため常時判定してよい（制作管理UX改善
      // 計画 2026-08-04 §5-1: 作業予定区間は内部専用列）。
      if (RECALC_INTERNAL_METADATA_PROPERTIES.has(key)) {
        if (value === '' || value == null) delete fm.production_internal[key];
        else fm.production_internal[key] = String(value);
        delete fm.properties[key];
        return;
      }
      if (value === '' || value == null) delete fm.properties[key];
      else fm.properties[key] = [{ value: String(value), status: '採用', note: '', created: now }];
    });
    if (!Object.keys(fm.production_internal).length) delete fm.production_internal;
    return fm;
  }

  async function writeTaskAssignment(provider, path, row) {
    const parsed = await window.MeldexCloudFrontmatterLite.readFrontmatter(provider, path);
    const currentStatus = propValueFromFrontmatter(parsed.frontmatter, '状況');
    const props = {
      '担当者': row.user,
      '作業予定日時': `${row.start}|${row.end}`,
      '作業予定区間': Engine.segmentsJson(Engine.rowSegments(row)),
      '作業予定時間': Engine.pythonFloatStr(row.hours),
      'シフト割当不能理由': '',
    };
    if (!currentStatus || currentStatus === '未割り当て') props['状況'] = '着手待ち';
    const fm = applyPropsToFrontmatter(parsed.frontmatter, props);
    await provider.writeText(path, window.MeldexCloudFrontmatterLite.frontmatterText(fm, parsed.body || ''));
    return fm;
  }

  async function writeTaskUnassigned(provider, path, reason) {
    const parsed = await window.MeldexCloudFrontmatterLite.readFrontmatter(provider, path);
    const props = {
      '担当者': '',
      '作業予定日時': '',
      '作業予定区間': '',
      '作業予定時間': '',
      'シフト割当不能理由': reason,
      '状況': '未割り当て',
    };
    const fm = applyPropsToFrontmatter(parsed.frontmatter, props);
    await provider.writeText(path, window.MeldexCloudFrontmatterLite.frontmatterText(fm, parsed.body || ''));
    return fm;
  }

  // --- 保護判定（_frontmatter_task_protected。適用直前の陳腐化再チェック） ---

  function frontmatterTaskProtected(frontmatter) {
    const status = propValueFromFrontmatter(frontmatter, '状況');
    return Engine.PROTECTED_TASK_STATUSES.has(status)
      || Engine.truthy(propValueFromFrontmatter(frontmatter, '再計算ロック'))
      || Engine.truthy(propValueFromFrontmatter(frontmatter, 'シフト固定'))
      || Engine.truthy(propValueFromFrontmatter(frontmatter, '担当者固定'));
  }

  async function preflightRows(provider, rows) {
    const prepared = [];
    const protectedPaths = [];
    for (const row of rows || []) {
      if (row.status !== 'scheduled' && row.status !== 'unassigned') continue;
      const path = String(row.task_path || '').trim();
      if (!path) throw staleError();
      const parsed = await window.MeldexCloudFrontmatterLite.readFrontmatter(provider, path);
      if (frontmatterTaskProtected(parsed.frontmatter)) protectedPaths.push(path);
      prepared.push([row, path]);
    }
    if (protectedPaths.length) throw staleError();
    return prepared;
  }

  // --- プレビュー ---

  // 「担当者と時間を割り当て」（旧: 簡易割当）用のunassigned_onlyスコープ。既に作業予定日時が
  // あるタスクを manual_locked 扱いにし、既存の taskProtected/buildPlanAtRatio の保護ロジックへ
  // そのまま乗せる（新規に一切変更しない）。Desktopの _mark_unassigned_only_locks と同一挙動。
  function markUnassignedOnlyLocks(tasks, unassignedOnly) {
    if (!unassignedOnly) return;
    tasks.forEach(task => {
      if (task.current_start && task.current_end) task.manual_locked = true;
    });
  }

  function applyTaskOptions(tasks, body) {
    const raw = body && (body.taskOptions || body.task_options);
    const optionsByTask = raw && typeof raw === 'object' ? raw : {};
    tasks.forEach(task => {
      const identifiers = [String(task.id || ''), String(task.path || ''), Engine.canonicalTaskPath(task.path)];
      const options = identifiers.map(id => optionsByTask[id]).find(value => value && typeof value === 'object') || {};
      if (options.remainingHours != null) task.target_hours = Math.max(0, Engine.safeFloat(options.remainingHours, task.target_hours));
      task.candidate_users = Array.isArray(options.assigneeCandidates) ? options.assigneeCandidates.map(String) : [];
      task.dependencies = Array.isArray(options.dependencies) ? options.dependencies.map(String) : [];
      task.required_equipment = Array.isArray(options.requiredEquipment) ? options.requiredEquipment.map(String) : [];
      if (options.deadline) task.deadline = String(options.deadline);
    });
  }

  // スタッフ未登録でも割当再計算が使えるよう、現在のユーザーを仮スタッフとして補う。
  // 旧「かんたん割当」のゼロ設定フォールバック（2026-08-05 の一本化で吸収）。Desktopの
  // meldex_production_recalculate.py の _with_fallback_solo_staff と完全同一挙動にする。
  function withFallbackSoloStaff(staff, body) {
    if (staff.length) return { staff, warning: null };
    const user = String((body && body.current_user) || '').trim();
    if (!user) return { staff, warning: null };
    const solo = {
      name: user, display: user,
      work_hours: '9:00-18:00', break_hours: '12:00-13:00',
      holidays: '土,日', active_from: '', active_to: '',
    };
    return {
      staff: [solo],
      warning: {
        type: 'fallback_staff',
        reason: `スタッフが未登録のため、${user}へ仮の勤務時間（平日9:00〜18:00・12:00〜13:00休憩）で割り当てます。スタッフ管理シートで勤務時間を設定すると正確になります`,
      },
    };
  }

  async function previewCloud(provider, internals, body, deps) {
    const unassignedOnly = Engine.truthy(body && body.unassigned_only);
    const periodValue = Engine.period(body || {});
    const allTasks = await loadTasks(provider, internals, deps, false);
    applyTaskOptions(allTasks, body || {});
    markUnassignedOnlyLocks(allTasks, unassignedOnly);
    const tasks = allTasks.filter(task => Engine.taskInScope(task, periodValue));
    const { staff, warning: fallbackStaffWarning } = withFallbackSoloStaff(await loadStaff(deps.boundStaffResolver), body);
    const allowOvertime = (body && body.allow_overtime) === undefined ? true : !!body.allow_overtime;
    const baseShiftRows = await loadShiftRows(provider, internals, deps, periodValue);
    // 可用時間の計算は期間内の全タスクを対象にする（他リストの担当者が既に埋まっている時間帯を
    // 空きと誤認しないため）。work_titles/task_paths によるスコープ絞り込みは、実際にプラン対象へ
    // 渡す直前の scopedTasks だけへ適用する（Desktop版 preview_production_recalculation と同じ順序）。
    const extraBusy = Engine.outOfScopeBusy(allTasks, tasks);
    const shifts = Engine.availability(staff, periodValue, tasks, allowOvertime, extraBusy, baseShiftRows, unassignedOnly);
    const order = await contentOrder(provider, internals, deps);
    const candidates = await contentCandidates(provider, internals, deps);
    const scopedTasks = Engine.applyRecalculationScope(tasks, body || {});
    const planResult = Engine.buildPlan(scopedTasks, staff, shifts, periodValue, order, candidates, {
      equipment: Array.isArray(body && body.equipment) ? body.equipment : [],
    });
    const shiftWarnings = await loadShiftWarnings(provider, internals, deps, periodValue);
    const warnings = [...shiftWarnings, ...planResult.warnings];
    if (fallbackStaffWarning) warnings.unshift(fallbackStaffWarning);
    const rows = planResult.rows;
    return {
      ok: true,
      rows,
      warnings,
      suggestions: Engine.suggestions(rows, warnings),
      summary: {
        scheduled: rows.filter(r => r.status === 'scheduled').length,
        locked: rows.filter(r => r.status === 'locked').length,
        unassigned: rows.filter(r => r.status === 'unassigned').length,
        changed: rows.filter(r => r.changed).length,
      },
      cloud: true,
    };
  }

  // --- 適用 ---

  const _STALENESS_TRIGGER_KEYS = ['date_from', 'date_to', '開始日', '終了日', 'allow_overtime', 'unassigned_only'];

  async function applyCloud(provider, internals, body, deps) {
    await deps.init(provider, internals);
    if (body && body.expected_source_revision) {
      const sourcePreview = await previewCloud(provider, internals, body, deps);
      const source = (sourcePreview.rows || []).slice()
        .sort((a, b) => `${a.task_id || ''}\u0000${a.task_path || ''}`.localeCompare(`${b.task_id || ''}\u0000${b.task_path || ''}`))
        .map(row => ({ taskId: row.task_id, user: row.before_user, range: row.before_range }));
      const currentRevision = await window.MeldexSystemStorage.computeRevision(source);
      if (currentRevision !== body.expected_source_revision) throw staleError();
    }
    const suppliedRows = Array.isArray(body && body.rows) ? body.rows : null;
    let rows;
    if (suppliedRows === null) {
      rows = (await previewCloud(provider, internals, body, deps)).rows;
    } else if (_STALENESS_TRIGGER_KEYS.some(key => Object.prototype.hasOwnProperty.call(body || {}, key))) {
      // allow_overtime やスコープ絞り込みが preview 時と食い違ったまま適用されないよう、同じ body で
      // 再計算した結果と突き合わせる（production-management-ux-improvement-plan-2026-08-04.md §3-5）。
      const fresh = await previewCloud(provider, internals, body, deps);
      const suppliedCanonical = JSON.stringify(Engine.canonicalRecalculationRows(suppliedRows));
      const freshCanonical = JSON.stringify(Engine.canonicalRecalculationRows(fresh.rows));
      if (suppliedCanonical !== freshCanonical) throw staleError();
      rows = fresh.rows;
    } else {
      rows = suppliedRows;
    }

    const journal = deps.mutationJournal(provider, internals);
    await deps.journalCalendar(journal, 'events');
    await deps.journalCalendar(journal, 'calendars');
    try {
      const prepared = await preflightRows(provider, rows);
      let applied = 0;
      let unassigned = 0;
      for (const [row, path] of prepared) {
        await deps.journalText(journal, path);
        if (row.status === 'scheduled') {
          const fm = await writeTaskAssignment(provider, path, row);
          await deps.syncTaskEvent(provider, internals, path, fm);
          applied += 1;
        } else if (row.status === 'unassigned') {
          const fm = await writeTaskUnassigned(provider, path, row.reason || '自動割り当てで割り当て先が見つかりません');
          await deps.syncTaskEvent(provider, internals, path, fm);
          unassigned += 1;
        }
      }
      return { ok: true, applied, unassigned, cloud: true };
    } catch (error) {
      return deps.rollbackMutation(journal, error);
    }
  }

  // --- 固定/解除（set_production_task_lock） ---

  async function resolveTaskPathFromBody(provider, internals, deps, body) {
    const raw = String((body && (body.task_path || body.path)) || '').trim();
    if (raw) return raw;
    const eventId = String((body && body.event_id) || '').trim();
    if (eventId.startsWith('production-task:')) {
      const taskId = Engine.logicalTaskId(eventId);
      const tasks = await loadTasks(provider, internals, deps, true);
      const match = tasks.find(task => task.id === taskId);
      if (match) return match.path;
    }
    return '';
  }

  async function setEventLockFlag(provider, internals, deps, taskId, locked) {
    const events = await deps.readCalendarStore(provider, internals, 'events');
    const baseId = `production-task:${taskId}`;
    const now = new Date().toISOString();
    let changed = false;
    events.forEach(event => {
      const id = String((event && event.id) || '');
      if (id !== baseId && !id.startsWith(`${baseId}:part:`)) return;
      let description = String((event && event.description) || '').replace(/\n?再計算ロック:\s*(true|false)/g, '');
      if (locked) description += '\n再計算ロック: true';
      event.description = description.trim();
      event.modified = now;
      changed = true;
    });
    if (changed) await deps.writeCalendarStore(provider, internals, 'events', events);
    return changed;
  }

  async function lockCloud(provider, internals, body, deps) {
    const locked = Engine.truthy(body && body.locked);
    const path = await resolveTaskPathFromBody(provider, internals, deps, body || {});
    if (!path) return { ok: false, message: '対象の制作管理タスクを見つけられませんでした' };
    const parsed = await window.MeldexCloudFrontmatterLite.readFrontmatter(provider, path);
    const fallbackId = String(path).replace(/\\/g, '/').split('/').pop().replace(/\.md$/i, '');
    const taskId = String((parsed.frontmatter && parsed.frontmatter.id) || fallbackId);
    const props = { '再計算ロック': locked ? 'true' : 'false', 'シフト固定': locked ? 'true' : 'false' };
    const fm = applyPropsToFrontmatter(parsed.frontmatter, props);
    await provider.writeText(path, window.MeldexCloudFrontmatterLite.frontmatterText(fm, parsed.body || ''));
    await setEventLockFlag(provider, internals, deps, taskId, locked);
    return { ok: true, locked, task_path: path, cloud: true };
  }

  // --- カレンダー上のタスク予定のドラッグ移動・端リサイズ（update_production_task_schedule相当。
  // 制作管理UX改善計画2026-08-04 §6-4）: 汎用イベント更新ではなくタスクへの書き戻しとして処理する。 ---

  function cloudError(message, status) {
    const error = new Error(message);
    error.status = status;
    return error;
  }

  function segmentIndexFromBody(body, eventId) {
    if (body && Object.prototype.hasOwnProperty.call(body, 'segment_index')) {
      const value = parseInt(body.segment_index, 10);
      return Number.isFinite(value) && value > 0 ? value : 0;
    }
    if (eventId.startsWith('production-task:') && eventId.includes(':part:')) {
      const value = parseInt(eventId.split(':part:').pop(), 10) - 1;
      return Number.isFinite(value) && value > 0 ? value : 0;
    }
    return 0;
  }

  function durationHoursText(hours) {
    const rounded = Math.round(hours * 10000) / 10000;
    return String(rounded);
  }

  async function updateTaskScheduleCloud(provider, internals, body, deps) {
    body = body || {};
    const path = await resolveTaskPathFromBody(provider, internals, deps, body);
    if (!path) return { ok: false, message: '対象の制作管理タスクを見つけられませんでした' };
    const start = String(body.start || '').trim();
    const end = String(body.end || '').trim();
    if (!start || !end) throw cloudError('開始日時・終了日時は必須です', 400);
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) throw cloudError('日時の形式が不正です', 400);
    if (endDate <= startDate) throw cloudError('終了日時は開始日時より後にしてください', 400);

    const eventId = String(body.event_id || '').trim();
    const segmentIndex = segmentIndexFromBody(body, eventId);

    const parsed = await window.MeldexCloudFrontmatterLite.readFrontmatter(provider, path);
    const fm = parsed.frontmatter || {};
    const currentRange = rangeValue(propValueFromFrontmatter(fm, '作業予定日時'));
    let segments = Engine.parseSegments(propValueFromFrontmatter(fm, '作業予定区間'));
    if (!segments.length && currentRange[0] && currentRange[1]) segments = [{ start: currentRange[0], end: currentRange[1] }];
    if (segmentIndex >= segments.length) throw cloudError('この予定は既に変更されています。カレンダーを再読み込みしてください', 409);
    segments = segments.slice();
    segments[segmentIndex] = { start: Engine.isoMinutes(startDate), end: Engine.isoMinutes(endDate) };
    segments.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : (a.end < b.end ? -1 : a.end > b.end ? 1 : 0)));

    const currentUser = propValueFromFrontmatter(fm, '担当者');
    const requestedUser = String(body.user || '').trim();
    const assigneeFixed = Engine.truthy(propValueFromFrontmatter(fm, '担当者固定'));
    const force = Engine.truthy(body.force);
    let targetUser = currentUser;
    if (requestedUser && requestedUser !== currentUser) {
      if (assigneeFixed && !force) throw cloudError('担当者固定が設定されています。担当者を変更して続けますか？', 409);
      targetUser = requestedUser;
    }
    if (!targetUser) throw cloudError('担当者が未設定のためドラッグで予定を変更できません', 400);

    const aggregateStart = segments.reduce((min, item) => (min === null || item.start < min ? item.start : min), null);
    const aggregateEnd = segments.reduce((max, item) => (max === null || item.end > max ? item.end : max), null);
    const totalHours = segments.reduce((sum, item) => sum + (new Date(item.end) - new Date(item.start)) / 3600000, 0);
    const hoursText = durationHoursText(totalHours);

    const props = {
      '担当者': targetUser,
      '作業予定日時': `${aggregateStart}|${aggregateEnd}`,
      '作業予定区間': Engine.segmentsJson(segments),
      '作業予定時間': hoursText,
      'シフト固定': 'true',
      'シフト割当不能理由': '',
    };
    const currentStatus = propValueFromFrontmatter(fm, '状況');
    if (!currentStatus || currentStatus === '未割り当て') props['状況'] = '着手待ち';
    const nextFm = applyPropsToFrontmatter(fm, props);
    // コミット前レビュー指摘 #8: カレンダーイベント同期が失敗した場合、Desktop
    // meldex_production_recalculate._restore_task_file_bytes と同じくフロントマターを
    // 書込み前のバイト列（テキスト）へ丸ごと書き戻す。ここで戻さないと、タスクの
    // 「作業予定日時」等は新しい値のまま・カレンダー表示だけが古いまま、という不整合が
    // 残ってしまう（ドラッグ操作は見た目上「失敗して元に戻った」動きを期待される）。
    const originalText = await provider.readText(path).catch(() => null);
    await provider.writeText(path, window.MeldexCloudFrontmatterLite.frontmatterText(nextFm, parsed.body || ''));
    try {
      await deps.syncTaskEvent(provider, internals, path, nextFm);
    } catch (syncError) {
      if (originalText != null) {
        try {
          await provider.writeText(path, originalText);
        } catch (restoreError) {
          throw cloudError(
            `カレンダー同期に失敗し、タスクの復元にも失敗しました: ${restoreError?.message || restoreError}`,
            500,
          );
        }
      }
      throw syncError;
    }
    return {
      ok: true,
      task_path: path,
      user: targetUser,
      segments,
      '作業予定日時': `${aggregateStart}|${aggregateEnd}`,
      '作業予定時間': hoursText,
      'シフト固定': true,
      cloud: true,
    };
  }

  window.MeldexProductionRecalcCloudAdapter = {
    previewCloud, applyCloud, lockCloud, updateTaskScheduleCloud,
    loadTasks, loadStaff, propValueFromFrontmatter, applyPropsToFrontmatter,
    writeTaskAssignment, writeTaskUnassigned, staleError,
    // コミット前レビュー指摘 #17: Desktop/JS複製の集合一致をテストで検証できるよう公開する
    // （test_meldex_production_schema_cleanup.py）。
    RECALC_INTERNAL_METADATA_PROPERTIES,
  };
})();
