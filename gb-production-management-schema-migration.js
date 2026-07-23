(function () {
  'use strict';

  const MANAGED_NAME_COLUMNS = Object.freeze({
    '作品リスト': Object.freeze({ legacy: '作品タイトル_話数', historicalAliases: Object.freeze(['作品タイトル']) }),
    '作業対象リスト': Object.freeze({ legacy: '作業対象' }),
    '作業内容リスト': Object.freeze({ legacy: '作業内容' }),
    '作業規模リスト': Object.freeze({ legacy: '作業規模' }),
    'スタッフリスト': Object.freeze({ legacy: 'スタッフ名', userProperty: 'スタッフ' }),
  });
  const TASK_NAME_DEFINITION = Object.freeze({ legacy: 'タスク名' });
  const MASTER_SHEETS = Object.freeze(Object.keys(MANAGED_NAME_COLUMNS));
  const ROOT = '制作管理/シート';
  const NAME_OPERATION_TAILS = new WeakMap();
  const LEASE_OPERATION_TAILS = new WeakMap();

  async function _withProviderQueue(tails, provider, operation) {
    if (!provider || (typeof provider !== 'object' && typeof provider !== 'function')) return operation();
    const previous = tails.get(provider) || Promise.resolve();
    let release;
    const turn = new Promise(resolve => { release = resolve; });
    tails.set(provider, turn);
    await previous.catch(() => {});
    try {
      return await operation();
    } finally {
      release();
      if (tails.get(provider) === turn) tails.delete(provider);
    }
  }

  function _clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function _candidateValue(candidates) {
    const list = Array.isArray(candidates) ? candidates : (candidates == null ? [] : [candidates]);
    const selected = list.find(item => item && typeof item === 'object'
      && (item.status === '採用' || item.status === '掲載済み')) || list[0];
    if (selected && typeof selected === 'object') return String(selected.value || '').trim();
    return String(selected || '').trim();
  }

  function _candidate(value, created) {
    return [{ value: String(value || ''), status: '採用', note: '', created }];
  }

  function _fold(value) {
    return String(value || '').normalize('NFKC').toLocaleLowerCase('ja');
  }

  function _normalizePath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  }

  function _safeName(context, value) {
    const raw = String(value || '').trim();
    if (!raw) throw new Error('制作管理のエントリ名を空にはできません');
    const safe = typeof context.safeName === 'function'
      ? context.safeName(raw)
      : raw.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 100);
    if (!safe) throw new Error(`制作管理のエントリ名「${raw}」をファイル名へ変換できません`);
    return safe;
  }

  function _entryPath(context, sheet, name) {
    if (typeof context.entryPath === 'function') return _normalizePath(context.entryPath(sheet, name));
    return `${_normalizePath(context.rootPath || ROOT)}/${sheet}/${name}.md`;
  }

  function _notePath(context, sheet) {
    if (typeof context.notePath === 'function') return _normalizePath(context.notePath(sheet));
    return `${_normalizePath(context.rootPath || ROOT)}/${sheet}/${sheet}.md`;
  }

  function _isTaskSheetName(sheet) {
    const name = String(sheet || '');
    return name === 'タスクリスト' || name === 'タスクリスト アーカイブ' || name.startsWith('タスクリスト_');
  }

  function _managedNameDefinition(sheet) {
    return MANAGED_NAME_COLUMNS[sheet] || (_isTaskSheetName(sheet) ? TASK_NAME_DEFINITION : null);
  }

  function _managedPathInfo(path) {
    const normalized = _normalizePath(path);
    const match = normalized.match(/^制作管理\/シート\/([^/]+)\/([^/]+)\.md$/i);
    if (!match || !_managedNameDefinition(match[1]) || match[2] === match[1]) return null;
    return { path: normalized, sheet: match[1], name: match[2] };
  }

  function isManagedEntryPath(path) {
    return !!_managedPathInfo(path);
  }

  function reservedLegacyPropertyForPath(path, property) {
    const normalized = _normalizePath(path);
    const match = normalized.match(/^制作管理\/シート\/([^/]+)(?:\/|$)/i);
    const definition = match && _managedNameDefinition(match[1]);
    const reserved = definition ? [definition.legacy, ...(definition.historicalAliases || [])] : [];
    return reserved.includes(String(property || ''));
  }

  function _newRecord(entry, sheet, kind = 'entry') {
    return {
      path: _normalizePath(entry.path),
      sheet,
      name: String(entry.name || ''),
      frontmatter: _clone(entry.frontmatter || {}),
      body: String(entry.body || ''),
      kind,
      changed: false,
      keyChanged: false,
    };
  }

  function _recordFor(records, entry, sheet, kind = 'entry') {
    const path = _normalizePath(entry.path);
    if (!records.has(path)) records.set(path, _newRecord(entry, sheet, kind));
    return records.get(path);
  }

  function _markChanged(record, now) {
    record.changed = true;
    if (record.kind === 'entry') record.frontmatter.modified = now;
  }

  function _properties(record) {
    const current = record.frontmatter.properties;
    if (!current || typeof current !== 'object' || Array.isArray(current)) record.frontmatter.properties = {};
    return record.frontmatter.properties;
  }

  function _addAlias(aliasMaps, sheet, alias, target) {
    const from = String(alias || '').trim();
    const to = String(target || '').trim();
    if (!from || !to) return;
    if (!aliasMaps.has(sheet)) aliasMaps.set(sheet, new Map());
    const map = aliasMaps.get(sheet);
    const folded = _fold(from);
    const conflicting = [...map.entries()].find(([key, value]) => _fold(key) === folded && value !== to);
    if (conflicting) {
      throw new Error(`制作管理の名称移行を中止しました: ${sheet} の「${from}」が複数の名前へ対応します`);
    }
    map.set(from, to);
  }

  function _addFallbackAlias(aliasMaps, sheet, alias, target) {
    const from = String(alias || '').trim();
    const to = String(target || '').trim();
    if (!from || !to) return;
    if (!aliasMaps.has(sheet)) aliasMaps.set(sheet, new Map());
    const map = aliasMaps.get(sheet);
    if ([...map.keys()].some(key => _fold(key) === _fold(from))) return;
    map.set(from, to);
  }

  function _replaceCandidates(candidates, aliases) {
    if (!aliases?.size) return { value: candidates, count: 0 };
    const list = Array.isArray(candidates) ? candidates : (candidates == null ? [] : [candidates]);
    let count = 0;
    const next = list.map(item => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const current = String(item.value ?? '');
        if (!aliases.has(current)) return item;
        if (aliases.get(current) === current) return item;
        count += 1;
        return { ...item, value: aliases.get(current) };
      }
      const current = String(item ?? '');
      if (!aliases.has(current)) return item;
      if (aliases.get(current) === current) return item;
      count += 1;
      return aliases.get(current);
    });
    return { value: Array.isArray(candidates) ? next : next[0], count };
  }

  function _rewriteProperty(record, property, aliases, now) {
    const properties = _properties(record);
    if (!Object.prototype.hasOwnProperty.call(properties, property)) return 0;
    const replaced = _replaceCandidates(properties[property], aliases);
    if (!replaced.count) return 0;
    properties[property] = replaced.value;
    _markChanged(record, now);
    return replaced.count;
  }

  function _replaceExactDeep(value, aliases, ignoredKeys = new Set()) {
    if (typeof value === 'string') {
      const replacement = aliases.get(value);
      return replacement != null && replacement !== value ? { value: replacement, count: 1 } : { value, count: 0 };
    }
    if (Array.isArray(value)) {
      let count = 0;
      const next = value.map(item => {
        const replaced = _replaceExactDeep(item, aliases, ignoredKeys);
        count += replaced.count;
        return replaced.value;
      });
      return { value: next, count };
    }
    if (!value || typeof value !== 'object') return { value, count: 0 };
    let count = 0;
    const next = {};
    Object.entries(value).forEach(([key, item]) => {
      if (ignoredKeys.has(key)) next[key] = item;
      else {
        const replaced = _replaceExactDeep(item, aliases, ignoredKeys);
        next[key] = replaced.value;
        count += replaced.count;
      }
    });
    return { value: next, count };
  }

  function _rewriteViewNode(node, property, aliases) {
    if (!node || typeof node !== 'object' || !aliases?.size) return 0;
    let count = 0;
    if (Array.isArray(node.advancedFilters)) {
      node.advancedFilters = node.advancedFilters.map(filter => {
        if (!filter || (filter.property !== property && filter.prop !== property)) return filter;
        const replaced = _replaceExactDeep(filter, aliases, new Set(['property', 'prop']));
        count += replaced.count;
        return replaced.value;
      });
    }
    if (node.conditionalColors && typeof node.conditionalColors === 'object'
      && Object.prototype.hasOwnProperty.call(node.conditionalColors, property)) {
      const replaced = _replaceExactDeep(node.conditionalColors[property], aliases);
      node.conditionalColors[property] = replaced.value;
      count += replaced.count;
    }
    if (node.formConfig) count += _rewriteViewNode(node.formConfig, property, aliases);
    return count;
  }

  function _rewriteViewConfig(config, property, aliases) {
    if (!config || typeof config !== 'object') return 0;
    let count = _rewriteViewNode(config, property, aliases);
    (Array.isArray(config.savedViews) ? config.savedViews : []).forEach(view => {
      count += _rewriteViewNode(view, property, aliases);
    });
    return count;
  }

  function _creationKeyParts(record) {
    const fm = record.frontmatter;
    return [
      _candidateValue(fm.properties?.['作品タイトル']),
      _candidateValue(fm.properties?.['階層パス']),
      _candidateValue(fm.properties?.['作業対象リスト']),
      _candidateValue(fm.properties?.['作業内容リスト']),
      _candidateValue(fm.properties?.['作業規模リスト']),
    ];
  }

  function _rewriteTaskRecord(record, aliasMaps, now) {
    const before = _creationKeyParts(record);
    let count = 0;
    count += _rewriteProperty(record, '作品タイトル', aliasMaps.get('作品リスト'), now);
    count += _rewriteProperty(record, '作業対象リスト', aliasMaps.get('作業対象リスト'), now);
    count += _rewriteProperty(record, '作業内容リスト', aliasMaps.get('作業内容リスト'), now);
    count += _rewriteProperty(record, '作業規模リスト', aliasMaps.get('作業規模リスト'), now);
    const creationKey = _candidateValue(record.frontmatter.properties?.['作成キー']);
    const oldGeneratedKey = before.join('|');
    const newGeneratedKey = _creationKeyParts(record).join('|');
    let replacementKey = creationKey === oldGeneratedKey ? newGeneratedKey : '';
    if (!replacementKey && creationKey && before[0] && before[0] !== _creationKeyParts(record)[0]) {
      const segments = creationKey.split('|');
      const storedWork = segments.length >= 5 ? segments.slice(0, -4).join('|') : '';
      if (storedWork === before[0]) replacementKey = [_creationKeyParts(record)[0], ...segments.slice(-4)].join('|');
    }
    if (creationKey && replacementKey && creationKey !== replacementKey) {
      const keyAliases = new Map([[creationKey, replacementKey]]);
      const keyCount = _rewriteProperty(record, '作成キー', keyAliases, now);
      if (keyCount) record.keyChanged = true;
      count += keyCount;
    }
    return count;
  }

  function _rewriteTaskNameReferences(record, aliases, now) {
    let count = 0;
    count += _rewriteProperty(record, '次のタスクにより保留中：', aliases, now);
    count += _rewriteProperty(record, '次のタスクを保留中：', aliases, now);
    return count;
  }

  function _rewriteTaskCalendarEvents(events, identitiesBySheet, context, now) {
    if (!Array.isArray(events)) return { events: [], count: 0 };
    const movedTasks = [...identitiesBySheet.entries()]
      .filter(([sheet]) => _isTaskSheetName(sheet))
      .flatMap(([, identities]) => identities)
      .filter(identity => identity.targetName !== identity.record.name)
      .map(identity => ({
        id: String(identity.record.frontmatter?.id || ''),
        sourcePath: identity.record.path,
        targetPath: _entryPath(context, identity.record.sheet, identity.targetName),
        targetName: identity.targetName,
      }));
    if (!movedTasks.length) return { events: _clone(events), count: 0 };
    let count = 0;
    const next = events.map(event => {
      if (!event || event.calendar_source !== 'production-task') return event;
      const match = movedTasks.find(task => (
        (task.id && String(event.external_id || '') === task.id)
        || String(event.description || '').includes(task.sourcePath)
      ));
      if (!match) return event;
      const updated = { ...event };
      updated.title = match.targetName;
      if (String(updated.description || '').includes(match.sourcePath)) {
        updated.description = String(updated.description).split(match.sourcePath).join(match.targetPath);
      }
      updated.modified = now;
      count += 1;
      return updated;
    });
    return { events: next, count };
  }

  async function _loadEntries(context, cache, records, sheet) {
    if (!cache.has(sheet)) {
      const entries = await context.listEntries(sheet);
      cache.set(sheet, Array.isArray(entries) ? entries : []);
    }
    return cache.get(sheet).map(entry => _recordFor(records, entry, sheet));
  }

  async function _loadNote(context, records, sheet) {
    if (typeof context.readFrontmatter !== 'function') return null;
    const path = _notePath(context, sheet);
    const parsed = await context.readFrontmatter(path);
    if (!parsed || (!Object.keys(parsed.frontmatter || {}).length && !String(parsed.body || ''))) return null;
    return _recordFor(records, {
      path,
      name: sheet,
      frontmatter: parsed.frontmatter || {},
      body: parsed.body || '',
    }, sheet, 'note');
  }

  function _migrationIdentity(record, definition, context, explicit, now) {
    const properties = _properties(record);
    const hasLegacy = Object.prototype.hasOwnProperty.call(properties, definition.legacy);
    const legacyCandidates = hasLegacy ? _clone(properties[definition.legacy]) : undefined;
    const legacyValue = _candidateValue(legacyCandidates);
    const historicalCandidates = {};
    const historicalValues = [];
    for (const property of definition.historicalAliases || []) {
      if (!Object.prototype.hasOwnProperty.call(properties, property)) continue;
      historicalCandidates[property] = _clone(properties[property]);
      const value = _candidateValue(properties[property]);
      if (value) historicalValues.push(value);
    }
    const hasHistorical = Object.keys(historicalCandidates).length > 0;
    const prior = record.frontmatter.production_name_migration;
    const explicitMatch = explicit && explicit.path === record.path;
    let desiredRaw = explicitMatch ? explicit.newName : legacyValue;
    if (!desiredRaw && prior?.target_entry_name) desiredRaw = String(prior.target_entry_name);
    if (!desiredRaw && prior?.version === 1 && prior.source_value) desiredRaw = String(prior.source_value);
    const targetName = desiredRaw ? _safeName(context, desiredRaw) : record.name;
    const priorTarget = prior?.target_entry_name ? _safeName(context, prior.target_entry_name) : '';
    const priorPending = !explicitMatch && !hasLegacy && !hasHistorical && priorTarget
      && _fold(priorTarget) !== _fold(record.name);
    const authoritativeAliases = new Set();
    const fallbackAliases = new Set([record.name]);
    if (hasLegacy || hasHistorical) {
      if (legacyValue) authoritativeAliases.add(legacyValue);
      historicalValues.forEach(value => authoritativeAliases.add(value));
      if (!authoritativeAliases.size) authoritativeAliases.add(record.name);
    } else if (explicitMatch) {
      authoritativeAliases.add(explicit.sourceName || record.name);
    } else if (priorPending) {
      if (prior?.source_value) authoritativeAliases.add(String(prior.source_value));
      (Array.isArray(prior?.historical_aliases) ? prior.historical_aliases : [])
        .forEach(value => authoritativeAliases.add(String(value || '')));
      if (!authoritativeAliases.size) authoritativeAliases.add(String(prior?.source_entry_name || record.name));
      if (prior?.source_entry_name) fallbackAliases.add(String(prior.source_entry_name));
    } else {
      authoritativeAliases.add(record.name);
    }
    if (explicitMatch) fallbackAliases.add(explicit.sourceName);

    if (hasLegacy || hasHistorical) {
      record.frontmatter.production_name_migration = {
        version: 3,
        source_property: definition.legacy,
        source_value: legacyValue,
        source_candidates: legacyCandidates,
        historical_aliases: historicalValues,
        historical_candidates: historicalCandidates,
        source_entry_name: record.name,
        target_entry_name: targetName,
        migrated_at: now,
      };
      delete properties[definition.legacy];
      for (const property of definition.historicalAliases || []) delete properties[property];
      _markChanged(record, now);
    }
    if (
      definition.userProperty
      && !_candidateValue(properties[definition.userProperty])
      && legacyValue
      && hasLegacy
    ) {
      properties[definition.userProperty] = Array.isArray(legacyCandidates) && legacyCandidates.length
        ? _clone(legacyCandidates)
        : _candidate(legacyValue, now);
      _markChanged(record, now);
      record.staffUserAdded = true;
    }
    if (explicitMatch && prior && typeof prior === 'object' && prior.target_entry_name !== targetName) {
      record.frontmatter.production_name_migration = { ...prior, target_entry_name: targetName };
      _markChanged(record, now);
    }
    if (explicitMatch && targetName !== record.name) {
      record.frontmatter.production_identity_rename = {
        version: 1,
        source_entry_name: explicit.sourceName,
        target_entry_name: targetName,
        renamed_at: now,
      };
      _markChanged(record, now);
    }
    return {
      record,
      targetName,
      authoritativeAliases,
      fallbackAliases,
      hasLegacy: hasLegacy || hasHistorical,
      explicitMatch,
    };
  }

  function _validateFinalNames(context, identitiesBySheet) {
    for (const [sheet, identities] of identitiesBySheet.entries()) {
      const finalNames = new Map();
      for (const identity of identities) {
        const folded = _fold(identity.targetName);
        const previous = finalNames.get(folded);
        if (previous && previous.record.path !== identity.record.path) {
          throw new Error(`制作管理の名称移行を中止しました: ${sheet} の「${previous.targetName}」と「${identity.targetName}」が同名になります`);
        }
        finalNames.set(folded, identity);
      }
    }
  }

  async function _validateTargetPaths(context, identitiesBySheet) {
    if (typeof context.entryExists !== 'function') return;
    for (const [sheet, identities] of identitiesBySheet.entries()) {
      const sourcePaths = new Map(identities.map(identity => [_fold(identity.record.path), identity.record.path]));
      for (const identity of identities) {
        if (identity.targetName === identity.record.name) continue;
        const targetPath = _entryPath(context, sheet, identity.targetName);
        const occupiedBy = sourcePaths.get(_fold(targetPath));
        if (!occupiedBy && await context.entryExists(targetPath)) {
          throw new Error(`制作管理の名称移行を中止しました: 「${identity.targetName}」は既に存在します`);
        }
      }
    }
  }

  function _validateCreationKeys(taskRecords) {
    const bySheet = new Map();
    taskRecords.forEach(record => {
      const key = _candidateValue(record.frontmatter.properties?.['作成キー']);
      if (!key) return;
      if (!bySheet.has(record.sheet)) bySheet.set(record.sheet, new Map());
      const paths = bySheet.get(record.sheet).get(key) || [];
      paths.push(record);
      bySheet.get(record.sheet).set(key, paths);
    });
    for (const [sheet, keys] of bySheet.entries()) {
      for (const [key, records] of keys.entries()) {
        if (records.length > 1 && records.some(record => record.keyChanged)) {
          throw new Error(`制作管理の名称変更を中止しました: ${sheet} の作成キー「${key}」が重複します`);
        }
      }
    }
  }

  async function _buildPlan(context, explicit = null) {
    if (typeof context?.listEntries !== 'function' || typeof context?.frontmatterText !== 'function'
      || typeof context?.provider?.writeText !== 'function' || typeof context?.provider?.readText !== 'function') {
      throw new Error('制作管理の名称移行に必要なCloudデータ操作を利用できません');
    }
    const now = new Date().toISOString();
    const cache = new Map();
    const records = new Map();
    const identitiesBySheet = new Map();
    const aliasMaps = new Map();
    let explicitFound = !explicit;

    for (const sheet of MASTER_SHEETS) {
      const recordsForSheet = await _loadEntries(context, cache, records, sheet);
      const identities = recordsForSheet.map(record => {
        const identity = _migrationIdentity(record, MANAGED_NAME_COLUMNS[sheet], context, explicit, now);
        if (identity.explicitMatch) explicitFound = true;
        return identity;
      });
      identitiesBySheet.set(sheet, identities);
    }
    const listedTaskSheets = typeof context.listTaskSheets === 'function' ? await context.listTaskSheets() : ['タスクリスト'];
    const allTaskSheets = [...new Set(['タスクリスト', ...(listedTaskSheets || []), 'タスクリスト アーカイブ'])]
      .filter(_isTaskSheetName);
    for (const sheet of allTaskSheets) {
      const recordsForSheet = await _loadEntries(context, cache, records, sheet);
      const identities = recordsForSheet.map(record => {
        const identity = _migrationIdentity(record, TASK_NAME_DEFINITION, context, explicit, now);
        if (identity.explicitMatch) explicitFound = true;
        return identity;
      });
      identitiesBySheet.set(sheet, identities);
    }
    if (!explicitFound) {
      const requested = _managedPathInfo(explicit.path);
      const expected = identitiesBySheet.get(requested.sheet)?.find(identity => (
        identity.record.name === _safeName(context, explicit.newName)
        && identity.record.frontmatter.production_identity_rename?.source_entry_name === requested.name
      ));
      if (expected) return { records, identitiesBySheet, aliasMaps, moves: [], now, alreadyDone: true };
      throw new Error(`制作管理エントリが見つかりません: ${explicit.path}`);
    }

    _validateFinalNames(context, identitiesBySheet);
    await _validateTargetPaths(context, identitiesBySheet);
    for (const [sheet, identities] of identitiesBySheet.entries()) {
      identities.forEach(identity => identity.authoritativeAliases
        .forEach(alias => _addAlias(aliasMaps, sheet, alias, identity.targetName)));
    }
    for (const [sheet, identities] of identitiesBySheet.entries()) {
      identities.forEach(identity => identity.fallbackAliases
        .forEach(alias => _addFallbackAlias(aliasMaps, sheet, alias, identity.targetName)));
    }

    // 管理リスト側の旧名称列定義も、エントリ値と同じ移行単位で除去する。
    // タスクリストの「作品タイトル」は参照列として必須なので、MASTER_SHEETS の
    // フォルダノートだけを対象にし、タスク系シートの定義には触れない。
    for (const sheet of MASTER_SHEETS) {
      const note = await _loadNote(context, records, sheet);
      const propertyTypes = note?.frontmatter?.property_types;
      if (!propertyTypes || typeof propertyTypes !== 'object' || Array.isArray(propertyTypes)) continue;
      const definition = MANAGED_NAME_COLUMNS[sheet];
      const removed = [definition.legacy, ...(definition.historicalAliases || [])]
        .filter(property => Object.prototype.hasOwnProperty.call(propertyTypes, property));
      if (!removed.length) continue;
      removed.forEach(property => { delete propertyTypes[property]; });
      _markChanged(note, now);
    }
    for (const sheet of allTaskSheets) {
      const note = await _loadNote(context, records, sheet);
      const propertyTypes = note?.frontmatter?.property_types;
      if (!propertyTypes || typeof propertyTypes !== 'object' || Array.isArray(propertyTypes)
        || !Object.prototype.hasOwnProperty.call(propertyTypes, TASK_NAME_DEFINITION.legacy)) continue;
      delete propertyTypes[TASK_NAME_DEFINITION.legacy];
      _markChanged(note, now);
    }

    const actionable = [...identitiesBySheet.values()].flat().some(identity => (
      identity.hasLegacy || identity.record.changed || identity.targetName !== identity.record.name
    )) || [...records.values()].some(record => record.changed);
    if (!actionable) {
      return { records, identitiesBySheet, aliasMaps, moves: [], now, alreadyDone: false };
    }

    const taskRecords = [];
    for (const sheet of allTaskSheets) {
      const identities = identitiesBySheet.get(sheet) || [];
      identities.forEach(({ record }) => {
        _rewriteTaskRecord(record, aliasMaps, now);
        _rewriteTaskNameReferences(record, aliasMaps.get(sheet), now);
        taskRecords.push(record);
      });
    }

    const templateRecords = await _loadEntries(context, cache, records, 'タスクテンプレート');
    templateRecords.forEach(record => {
      _rewriteProperty(record, '作業対象リスト', aliasMaps.get('作業対象リスト'), now);
      _rewriteProperty(record, '作業内容リスト', aliasMaps.get('作業内容リスト'), now);
      _rewriteProperty(record, '作業規模リスト', aliasMaps.get('作業規模リスト'), now);
    });
    (await _loadEntries(context, cache, records, '作業対象リスト')).forEach(record => {
      _rewriteProperty(record, '対応する作業内容', aliasMaps.get('作業内容リスト'), now);
    });
    (await _loadEntries(context, cache, records, '作業内容リスト')).forEach(record => {
      _rewriteProperty(record, '対応する作業対象', aliasMaps.get('作業対象リスト'), now);
    });
    // 旧「スタッフリスト.担当できる作業」の参照書き換えは、アカウント一元管理
    // 計画書 Phase 4（§5.5・§5.9手順11）でスキルの持ち先が作業内容リスト側の
    // 「担当者候補」へ移ったため削除した（Python側 meldex_production_identity.py
    // の REFERENCE_SPECS と対応）。
    (await _loadEntries(context, cache, records, '作品リスト')).forEach(record => {
      _rewriteProperty(record, 'タスクリスト', aliasMaps.get('タスクリスト'), now);
    });
    for (const sheet of ['スケジュール', 'スケジュール アーカイブ']) {
      (await _loadEntries(context, cache, records, sheet)).forEach(record => {
        _rewriteProperty(record, '作品タイトル', aliasMaps.get('作品リスト'), now);
        _rewriteProperty(record, 'スタッフリスト', aliasMaps.get('スタッフリスト'), now);
        _rewriteProperty(record, 'タスクリスト', aliasMaps.get('タスクリスト'), now);
      });
    }

    const viewRules = [];
    allTaskSheets.forEach(sheet => {
      viewRules.push([sheet, '作品タイトル', '作品リスト']);
      viewRules.push([sheet, '作業対象リスト', '作業対象リスト']);
      viewRules.push([sheet, '作業内容リスト', '作業内容リスト']);
      viewRules.push([sheet, '作業規模リスト', '作業規模リスト']);
      viewRules.push([sheet, '次のタスクにより保留中：', sheet]);
      viewRules.push([sheet, '次のタスクを保留中：', sheet]);
    });
    viewRules.push(
      ['タスクテンプレート', '作業対象リスト', '作業対象リスト'],
      ['タスクテンプレート', '作業内容リスト', '作業内容リスト'],
      ['タスクテンプレート', '作業規模リスト', '作業規模リスト'],
      ['作業対象リスト', '対応する作業内容', '作業内容リスト'],
      ['作業内容リスト', '対応する作業対象', '作業対象リスト'],
      ['スケジュール', '作品タイトル', '作品リスト'],
      ['スケジュール', 'スタッフリスト', 'スタッフリスト'],
      ['スケジュール', 'タスクリスト', 'タスクリスト'],
      ['スケジュール アーカイブ', '作品タイトル', '作品リスト'],
      ['スケジュール アーカイブ', 'スタッフリスト', 'スタッフリスト'],
      ['スケジュール アーカイブ', 'タスクリスト', 'タスクリスト'],
      ['作品リスト', 'タスクリスト', 'タスクリスト'],
    );
    const noteCache = new Map();
    for (const [sheet, property, sourceSheet] of viewRules) {
      if (!aliasMaps.get(sourceSheet)?.size) continue;
      if (!noteCache.has(sheet)) noteCache.set(sheet, await _loadNote(context, records, sheet));
      const note = noteCache.get(sheet);
      if (!note?.frontmatter?.view_config) continue;
      const count = _rewriteViewConfig(note.frontmatter.view_config, property, aliasMaps.get(sourceSheet));
      if (count) _markChanged(note, now);
    }

    _validateCreationKeys(taskRecords);
    const moves = [];
    for (const [sheet, identities] of identitiesBySheet.entries()) {
      identities.forEach(identity => {
        if (identity.targetName === identity.record.name) return;
        moves.push({
          source: identity.record.path,
          target: _entryPath(context, sheet, identity.targetName),
          sheet,
          sourceName: identity.record.name,
          targetName: identity.targetName,
        });
      });
    }
    let calendar = null;
    if (moves.some(move => _isTaskSheetName(move.sheet))
      && typeof context.readCalendarEvents === 'function'
      && typeof context.writeCalendarEvents === 'function') {
      const original = await context.readCalendarEvents();
      const rewritten = _rewriteTaskCalendarEvents(original, identitiesBySheet, context, now);
      if (rewritten.count) calendar = { original: _clone(original), next: rewritten.events, count: rewritten.count };
    }
    return { records, identitiesBySheet, aliasMaps, moves, calendar, now, alreadyDone: false };
  }

  async function _prepareTwoPhaseMoves(context, moves) {
    if (!moves.length) return [];
    if (typeof context.moveEntry !== 'function') throw new Error('制作管理エントリの名前変更機能を利用できません');
    const reserved = new Set(moves.flatMap(move => [move.source, move.target]).map(_fold));
    const token = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
    const prepared = [];
    for (let index = 0; index < moves.length; index += 1) {
      const move = moves[index];
      const parent = move.source.split('/').slice(0, -1).join('/');
      let temporary = '';
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const candidate = `${parent}/meldex-name-${token}-${index}-${attempt}.md`;
        if (reserved.has(_fold(candidate))) continue;
        if (typeof context.entryExists === 'function' && await context.entryExists(candidate)) continue;
        temporary = candidate;
        reserved.add(_fold(candidate));
        break;
      }
      if (!temporary) throw new Error('制作管理の名称移行用一時ファイル名を確保できません');
      prepared.push({ ...move, temporary });
    }
    return prepared;
  }

  async function _executeTwoPhaseMoves(context, moves, completedMoves) {
    for (const move of moves) {
      await context.moveEntry(move.source, move.temporary);
      completedMoves.push({ source: move.source, target: move.temporary });
    }
    for (const move of moves) {
      await context.moveEntry(move.temporary, move.target);
      completedMoves.push({ source: move.temporary, target: move.target });
    }
  }

  async function _rollback(context, originals, completedMoves, calendarOriginal = null) {
    for (const move of [...completedMoves].reverse()) {
      try { await context.moveEntry(move.target, move.source); } catch (error) {
        console.error('[ProductionManagement] 名称移行のファイル名ロールバックに失敗しました', error);
      }
    }
    for (const [path, text] of originals.entries()) {
      try { await context.provider.writeText(path, text); } catch (error) {
        console.error('[ProductionManagement] 名称移行の内容ロールバックに失敗しました', error);
      }
    }
    if (calendarOriginal && typeof context.writeCalendarEvents === 'function') {
      try { await context.writeCalendarEvents(calendarOriginal); } catch (error) {
        console.error('[ProductionManagement] 名称移行のカレンダーロールバックに失敗しました', error);
      }
    }
  }

  async function _executePlan(context, plan) {
    if (plan.alreadyDone) return { migrated: 0, renamed: 0, references_updated: 0, views_updated: 0, staff_users_added: 0, calendar_events_updated: 0 };
    const preparedMoves = await _prepareTwoPhaseMoves(context, plan.moves);
    const changed = [...plan.records.values()].filter(record => record.changed);
    const originals = new Map();
    for (const record of changed) originals.set(record.path, await context.provider.readText(record.path));
    const completedMoves = [];
    try {
      const masterPaths = new Set([].concat(...[...plan.identitiesBySheet.values()]).map(identity => identity.record.path));
      const ordered = [
        ...changed.filter(record => !masterPaths.has(record.path)),
        ...changed.filter(record => masterPaths.has(record.path)),
      ];
      for (const record of ordered) {
        await context.provider.writeText(record.path, context.frontmatterText(record.frontmatter, record.body));
      }
      if (plan.calendar) await context.writeCalendarEvents(plan.calendar.next);
      await _executeTwoPhaseMoves(context, preparedMoves, completedMoves);
    } catch (error) {
      await _rollback(context, originals, completedMoves, plan.calendar?.original || null);
      throw error;
    }
    const masterPaths = new Set([].concat(...[...plan.identitiesBySheet.values()]).map(identity => identity.record.path));
    return {
      migrated: [...plan.identitiesBySheet.values()].flat().filter(identity => identity.hasLegacy).length,
      renamed: plan.moves.length,
      references_updated: changed.filter(record => record.kind === 'entry' && !masterPaths.has(record.path)).length,
      views_updated: changed.filter(record => record.kind === 'note').length,
      staff_users_added: changed.filter(record => record.staffUserAdded).length,
      calendar_events_updated: plan.calendar?.count || 0,
      moves: plan.moves.map(move => ({ source: move.source, target: move.target })),
    };
  }

  async function migrateManagedNameProperties(context) {
    return _withProviderQueue(NAME_OPERATION_TAILS, context?.provider, async () => (
      _executePlan(context, await _buildPlan(context))
    ));
  }

  async function renameManagedEntry(context, path, newName) {
    return _withProviderQueue(NAME_OPERATION_TAILS, context?.provider, async () => {
      const info = _managedPathInfo(path);
      if (!info) throw new Error('制作管理の名称変更対象ではありません');
      const explicit = {
        path: info.path,
        sourceName: info.name,
        newName: String(newName || '').trim(),
      };
      if (!explicit.newName) throw new Error('path, new_name は必須です');
      const plan = await _buildPlan(context, explicit);
      const result = await _executePlan(context, plan);
      return {
        ok: true,
        new_path: _entryPath(context, info.sheet, _safeName(context, explicit.newName)),
        production_references_updated: result.references_updated,
        production_views_updated: result.views_updated,
        ...result,
      };
    });
  }

  function serializeProviderLeaseOperation(provider, operation) {
    return _withProviderQueue(LEASE_OPERATION_TAILS, provider, operation);
  }

  window.MeldexProductionSchemaMigration = Object.freeze({
    MANAGED_NAME_COLUMNS,
    isManagedEntryPath,
    reservedLegacyPropertyForPath,
    migrateManagedNameProperties,
    renameManagedEntry,
    serializeProviderLeaseOperation,
  });
})();
