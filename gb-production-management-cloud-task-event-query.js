  // gb-production-management-cloud-task-event-query.js: タスク⇔カレンダー予定の同期
  // （区間分割・ロック表示を含む）、カレンダードロップからのテンプレート起点タスク作成、
  // 予定IDからのタスク逆引き、タスク一覧の絞り込み・並べ替えクエリを担当する
  // （責務単位分割 2026-08-12。旧 gb-production-management.part02.js の一部）。
  //
  // gb-production-management.part01.js から続く共有クロージャ（IIFEの raw
  // concatenation）に属し、このファイル自体は自前のIIFEを持たない。読み込み順は
  // gb-production-management.js を参照。

  function _pmCloudTaskSegments(value, start, end) {
    let rows = [];
    try { rows = Array.isArray(value) ? value : JSON.parse(String(value || '[]')); } catch {}
    const valid = (Array.isArray(rows) ? rows : []).map(item => ({ start: String(item?.start || ''), end: String(item?.end || '') }))
      .filter(item => item.start && item.end && new Date(item.end) > new Date(item.start)).sort((a, b) => a.start.localeCompare(b.start));
    return valid.length ? valid : (start && end ? [{ start, end }] : []);
  }
  async function _pmCloudSyncTaskEventUnlocked(provider, internals, path, fm) {
    const taskId = String(fm?.id || internals._basename(path).replace(/\.md$/i, ''));
    const baseId = `production-task:${taskId}`;
    const before = await _pmReadCalendarStore(provider, internals, 'events');
    const collision = before.find(event => (
      String(event?.id || '') === baseId || String(event?.id || '').startsWith(baseId + ':part:')
    ) && String(event?.calendar_source || '') !== 'production-task');
    if (collision) throw _pmCloudError(409, '制作タスク予定のIDが通常予定と競合しています。通常予定のIDを変更してください');
    const events = before.filter(event => String(event?.id || '') !== baseId && !String(event?.id || '').startsWith(baseId + ':part:'));
    const planned = _pmCloudPropValue(fm, '作業予定日時');
    const user = _pmCloudPropValue(fm, '担当者');
    if (planned && user && planned.includes('|')) {
      const [start, end] = planned.split('|', 2);
      const segments = _pmCloudTaskSegments(_pmCloudPropValue(fm, '作業予定区間'), start, end);
      const scope = _pmCloudMemberScope(user, fm || {});
      const calendarId = await _pmEnsureCloudCalendar(provider, internals, `作業予定: ${user}`, '#569cd6', 'production-task', user, fm || {});
      const key = _pmCloudPropValue(fm, '作成キー');
      const work = _pmCloudPropValue(fm, '作品タイトル');
      const locked = /^(true|1|yes|on)$/i.test(_pmCloudPropValue(fm, '再計算ロック'));
      const now = new Date().toISOString();
      // 対象色がある時だけ個別色とし、空なら作業予定カレンダーの色を継承する。
      // nullable override はDesktopのmeldex_calendar_mutation_serviceと同じ契約。
      const eventColorOverride = String(_pmCloudPropValue(fm, '対象色') || '').trim();
      segments.forEach((segment, index) => {
        const id = index ? `${baseId}:part:${index + 1}` : baseId;
        const old = before.find(event => String(event?.id || '') === id);
        const detail = ['元シート: ' + path, work && '作品タイトル: ' + work, key && '作成キー: ' + key, locked && '再計算ロック: true', segments.length > 1 && `作業区間: ${index + 1}/${segments.length}`].filter(Boolean).join('\n');
        events.push({ id, title: internals._basename(path).replace(/\.md$/i, ''), start: segment.start, end: segment.end, all_day: 0, color: eventColorOverride || old?.color || '#569cd6', color_override: eventColorOverride || null, description: detail, location: '', url: key ? `production-task-key:${key}` : '', recurrence: '', external_id: taskId, calendar_source: 'production-task', user, creator: user, calendar_id: calendarId, workspace_id: scope.workspace_id, member_id: scope.member_id, alert_minutes: -1, created: old?.created || now, modified: now });
      });
    }
    await _pmWriteCalendarStore(provider, internals, 'events', events);
  }

  function _pmCloudSyncTaskEvent(provider, internals, path, fm) {
    const operation = leasedProvider => _pmCloudSyncTaskEventUnlocked(leasedProvider, internals, path, fm);
    const lease = window.MeldexCloudCalendarLease;
    return lease?.withLease ? lease.withLease(provider, context => operation(context?.guardProvider?.(provider) || provider),
      PM_CALENDAR_LEASE_TOKEN ? { token: PM_CALENDAR_LEASE_TOKEN } : null) : operation(provider);
  }

  function _pmCloudApplyCalendarDrop(props, body, drop) {
    const startDate = new Date(String(drop?.start || body?.start || ''));
    if (!Number.isFinite(startDate.getTime())) throw _pmCloudError(400, '開始日時は必須です');
    const fallback = Math.max(0.01, Number(props['目標作業時間_値']) || 1) * 60;
    const minutes = Math.max(1, Number(drop?.duration_minutes || body?.duration_minutes) || fallback);
    if (minutes > 525600) throw _pmCloudError(400, '作業時間は1年以内で指定してください');
    const rawEnd = String(drop?.end || body?.end || '');
    const endDate = rawEnd ? new Date(rawEnd) : new Date(startDate.getTime() + minutes * 60000);
    if (!Number.isFinite(endDate.getTime()) || endDate <= startDate) throw _pmCloudError(400, '終了日時は開始日時より後にしてください');
    const user = String(props['担当者'] || body?.current_user || '').trim();
    if (!user) throw _pmCloudError(400, 'カレンダーへ追加する担当者を指定してください');
    const start = _pmDateTimeText(startDate), end = _pmDateTimeText(endDate);
    props['担当者'] = user; props['作業予定日時'] = `${start}|${end}`;
    props['作業予定区間'] = JSON.stringify([{ start, end }]);
    props['作業予定時間'] = _pmCloudDurationText((endDate - startDate) / 3600000); props['状況'] = '着手待ち';
  }
  async function _pmCloudCreateFromTemplate(provider, internals, body) {
    if ((await _pmCloudMissing(provider, internals)).length) await _pmCloudInit(provider, internals);
    const template = await _pmCloudResolveEntry(provider, internals, 'タスクテンプレート', { path: body?.template_path, id: body?.template_id });
    const journal = _pmCloudMutationJournal(provider, internals);
    try {
      const projectless = String(body?.scope || '').trim().toLowerCase() === 'projectless';
      let work = null;
      if (!projectless && (body?.work_path || body?.work_id)) work = await _pmCloudResolveEntry(provider, internals, '作品リスト', { path: body.work_path, id: body.work_id });
      else if (!projectless) {
        const workTitle = String(body?.work_title || body?.['作品タイトル'] || '').trim();
        if (!workTitle) throw _pmCloudError(400, 'work_id、work_path、work_title のいずれかは必須です');
        work = await _pmCloudGetOrCreateWork(provider, internals, workTitle, journal, true);
      }
      const props = {};
      PM_CLOUD_TEMPLATE_FIELDS.forEach(name => { const value = _pmCloudPropValue(template.frontmatter, name); if (value) props[name] = value; });
      const overrides = body?.overrides && typeof body.overrides === 'object' ? body.overrides : {};
      const unknown = Object.keys(overrides).filter(name => !PM_CLOUD_TEMPLATE_FIELDS.has(name) && !['name', 'name_override'].includes(name));
      if (unknown.length) throw _pmCloudError(400, '上書きできない項目です: ' + unknown.join(', '));
      Object.entries(overrides).forEach(([name, value]) => { if (PM_CLOUD_TEMPLATE_FIELDS.has(name)) { if (value == null || value === '') delete props[name]; else props[name] = String(value); } });
      const labels = (work ? _pmCloudPropValue(work.frontmatter, '階層ラベル') : '') || '中分類,小分類,詳細分類';
      const levelNames = _pmResolveLevelPropNames(labels).map(names => names[0]);
      const classification = body?.classification && typeof body.classification === 'object' ? body.classification : {};
      const levels = [1, 2, 3].map(index => String(classification[`level${index}`] ?? body?.[`level${index}`] ?? props[`\u5358\u4f4d\u30ec\u30d9\u30eb${index}`] ?? '').trim());
      levels.forEach((value, index) => { delete props[`\u5358\u4f4d\u30ec\u30d9\u30eb${index + 1}`]; if (value) props[levelNames[index]] = value; });
      const key = 'template-instance:' + (globalThis.crypto?.randomUUID?.() || _pmHash(Date.now() + '|' + Math.random()));
      props['作品タイトル'] = work?.name || ''; props['階層パス'] = levels.filter(Boolean).join('-'); props['階層ラベル'] = labels;
      props['プリセット種別'] = (work ? _pmCloudPropValue(work.frontmatter, 'プリセット種別') : '') || '汎用'; props['状況'] ||= '未着手';
      props['元テンプレートID'] = String(template.frontmatter?.id || template.name); props['作成キー'] = key;
      // 分類（作業対象・作業内容・作業規模）が揃っている場合のみ、目標作業時間_値／
      // 目標作業時間を計算式（基準×内容倍率×規模倍率×対象数）で上書きする。分類が1つでも
      // 欠けている場合はテンプレートの目標作業時間_値（分類が無い場合の手動指定値）を温存する。
      const selectedTemplateId = String((work && _pmCloudPropValue(work.frontmatter, '使用する作業テンプレート'))
        || _pmCloudPropValue(template.frontmatter, '作業テンプレート') || '');
      await _pmCloudApplyTemplateInstanceDuration(provider, internals, props, selectedTemplateId);
      const name = String(body?.task_name || overrides.name_override || overrides.name || props['タスク名'] || _pmCloudPropValue(template.frontmatter, 'テンプレート名') || '無題タスク').trim() || '無題タスク';
      delete props['タスク名'];
      const surface = String(body?.drop?.surface || body?.surface || 'list').toLowerCase();
      if (!['list', 'calendar'].includes(surface)) throw _pmCloudError(400, 'drop.surface は list または calendar を指定してください');
      if (surface === 'calendar') _pmCloudApplyCalendarDrop(props, body, body?.drop || {});
      const { sheet } = projectless
        ? await _pmCloudEnsureProjectlessTaskSheet(provider, internals, journal)
        : await _pmCloudEnsureTaskSheetForWork(provider, internals, work, journal);
      if (surface === 'calendar') { await _pmCloudJournalCalendar(journal, 'events'); await _pmCloudJournalCalendar(journal, 'calendars'); }
      const entry = await _pmCloudWriteNewEntry(provider, internals, 'タスクリスト', sheet, name, props, journal, key);
      if (surface === 'calendar') await _pmCloudSyncTaskEvent(provider, internals, entry.path, entry.frontmatter);
      return { ok: true, surface, template_id: String(template.frontmatter?.id || template.name), row: _pmCloudEntryRow(entry), cloud: true };
    } catch (error) { return _pmCloudRollbackMutation(journal, error); }
  }

  async function _pmCloudTaskByEvent(provider, internals, url) {
    const eventId = String(url?.searchParams?.get('event_id') || '').trim();
    if (!eventId) throw _pmCloudError(400, 'event_id は必須です');
    const event = (await _pmReadCalendarStore(provider, internals, 'events')).find(row => String(row?.id || '') === eventId);
    if (!event) throw _pmCloudError(404, '予定が見つかりません');
    const match = String(event.description || '').match(/(?:^|\n)元シート:\s*([^\n]+)/);
    if (!match) throw _pmCloudError(404, '元の作業項目が見つかりません');
    const entry = await _pmCloudResolveEntry(provider, internals, 'タスクリスト', { path: match[1].trim() });
    return { ok: true, event, row: _pmCloudEntryRow(entry), cloud: true };
  }

  function _pmCloudQueryValues(value) { return new Set(_pmList(value)); }
  function _pmCloudQueryLevel(props, index) {
    for (const name of _pmResolveLevelPropNames(props?.['階層ラベル'] || '')[index] || []) if (props?.[name]) return String(props[name]);
    return '';
  }
  function _pmCloudQueryField(row, field) {
    const props = row.properties || {};
    if (field === 'name') return row.name || '';
    if (/^level[1-3]$/.test(field)) return _pmCloudQueryLevel(props, Number(field.slice(-1)) - 1);
    if (field === '作品タイトル') return props['作品タイトル'] || props['作品タイトル_話数'] || '';
    return props[field] || '';
  }
  function _pmCloudQuerySort(raw) {
    const aliases = { task_name: 'name', 'タスク名': 'name', work: '作品タイトル', work_title: '作品タイトル', status: '状況', assignee: '担当者', '単位レベル1': 'level1', '単位レベル2': 'level2', '単位レベル3': 'level3', '中分類': 'level1', '小分類': 'level2', '詳細分類': 'level3', priority: '優先度', planned_start: '作業予定日時', work_content: '作業内容リスト', duration: '目標作業時間_値', target_hours: '目標作業時間_値' };
    if (raw == null || raw === '' || (Array.isArray(raw) && !raw.length)) raw = ['work_title', 'level1', 'level2', 'level3', 'name'].map(field => ({ field, direction: 'asc' }));
    if (typeof raw === 'string') raw = raw.split(',').filter(Boolean).map(token => { const [field, direction] = token.trim().split(':'); return { field, direction }; });
    if (raw && !Array.isArray(raw)) raw = [raw];
    if (!Array.isArray(raw)) throw _pmCloudError(400, 'sort は配列で指定してください');
    return raw.map(item => {
      const requested = String(item?.field || '').trim(); const field = aliases[requested] || requested;
      if (!(field === 'name' || /^level[1-3]$/.test(field) || Object.prototype.hasOwnProperty.call(PM_PROPERTY_TYPES['タスクリスト'], field))) throw _pmCloudError(400, `並べ替えできない項目です: ${requested}`);
      const direction = String(item?.direction || 'asc').toLowerCase(); if (!['asc', 'desc'].includes(direction)) throw _pmCloudError(400, 'sort.direction は asc または desc を指定してください');
      return { field, direction };
    });
  }
  async function _pmCloudQueryTasks(provider, internals, body) {
    const filters = body?.filters && typeof body.filters === 'object' ? body.filters : {};
    const q = String(body?.q || '').trim().toLocaleLowerCase('ja');
    const allRows = (await _pmCloudListAllTaskEntries(provider, internals)).map(_pmCloudEntryRow);
    const facets = {
      statuses: [...new Set(allRows.map(row => String(_pmCloudQueryField(row, '状況') || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'ja', { numeric: true, sensitivity: 'base' })),
      assignees: [...new Set(allRows.map(row => String(_pmCloudQueryField(row, '担当者') || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'ja', { numeric: true, sensitivity: 'base' })),
    };
    let rows = allRows.filter(row => {
      if (q && !`${row.name}\n${Object.values(row.properties || {}).join('\n')}`.toLocaleLowerCase('ja').includes(q)) return false;
      const rules = [[_pmCloudQueryField(row, '作品タイトル'), filters.work_titles || filters.works || filters.work || body?.work_titles || body?.work_title], [_pmCloudQueryField(row, '状況'), filters.statuses || filters.status || body?.statuses || body?.status], [_pmCloudQueryField(row, '担当者'), filters.assignees || filters.assignee || body?.assignees || body?.assignee]];
      if (rules.some(([value, accepted]) => { const set = _pmCloudQueryValues(accepted); return set.size && !set.has(String(value)); })) return false;
      return [1, 2, 3].every(index => { const set = _pmCloudQueryValues(filters[`level${index}`] || body?.[`level${index}`]); return !set.size || set.has(_pmCloudQueryLevel(row.properties, index - 1)); });
    });
    for (const spec of _pmCloudQuerySort(body?.sort).reverse()) rows.sort((a, b) => {
      const av = String(_pmCloudQueryField(a, spec.field) || ''), bv = String(_pmCloudQueryField(b, spec.field) || '');
      if (!av || !bv) return av ? -1 : bv ? 1 : 0;
      const numeric = spec.field === '目標作業時間_値' && Number.isFinite(Number(av)) && Number.isFinite(Number(bv));
      const compared = numeric ? Number(av) - Number(bv) : av.localeCompare(bv, 'ja', { numeric: true, sensitivity: 'base' });
      return spec.direction === 'desc' ? -compared : compared;
    });
    const total = rows.length, offset = Math.max(0, Number.parseInt(body?.offset, 10) || 0), limit = Math.max(1, Math.min(1000, Number.parseInt(body?.limit, 10) || 200));
    const workMeta = {};
    for (const work of await _pmCloudListEntries(provider, internals, '作品リスト')) {
      const labels = _pmList(_pmCloudPropValue(work.frontmatter, '階層ラベル')).slice(0, 3);
      workMeta[work.name] = { id: String(work.frontmatter?.id || work.name), title: work.name, classification_labels: labels, classification_count: Math.max(0, Number(_pmCloudPropValue(work.frontmatter, '階層数')) || labels.length) };
    }
    rows = rows.slice(offset, offset + limit);
    return { ok: true, sheet: 'タスクリスト', columns: Object.keys(PM_PROPERTY_TYPES['タスクリスト']), property_types: PM_PROPERTY_TYPES['タスクリスト'], editable_columns: Object.keys(PM_PROPERTY_TYPES['タスクリスト']), rows, count: rows.length, total, offset, limit, work_meta: workMeta, generic_classification_labels: ['中分類', '小分類', '詳細分類'], facets, cloud: true };
  }
