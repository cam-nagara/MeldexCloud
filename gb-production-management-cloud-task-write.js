  // gb-production-management-cloud-task-write.js: タスク行の一括書き込み（バケット分割・
  // 競合時の再照合）、タスク作成カタログAPI（作品/作業対象/作業内容/作業規模/タスクシート
  // 一覧の同時取得）、制作管理ワークスペースの書き込みリース（排他制御）を担当する
  // （責務単位分割 2026-08-12。旧 gb-production-management.part02.js の一部）。
  //
  // gb-production-management.part01.js から続く共有クロージャ（IIFEの raw
  // concatenation）に属し、このファイル自体は自前のIIFEを持たない。読み込み順は
  // gb-production-management.js を参照。

  async function _pmCloudWriteTaskRows(provider, internals, taskSheet, rows) {
    const buckets = Array.from({ length: Math.min(4, Math.max(1, rows.length)) }, () => []);
    rows.forEach(row => {
      const name = _pmSafeName(_pmTaskRowEntryName(row));
      const bucket = Number.parseInt(_pmHash(name).slice(0, 8), 16) % buckets.length;
      buckets[bucket].push(row);
    });
    let created = 0;
    const createdEntries = [];
    const errors = [];
    let aborted = false;
    await Promise.all(buckets.map(async bucket => {
      for (const row of bucket) {
        if (aborted) break;
        const key = String(row['作成キー'] || '');
        try {
          const path = await _pmCloudUpsertEntry(
            provider,
            internals,
            taskSheet,
            _pmTaskRowEntryName(row),
            _pmTaskRowProps(row),
            '作成キー',
            key,
            { skipLookup: true },
          );
          const topicId = 'ent_' + _pmHash(path).slice(0, 10);
          createdEntries.push({
            path,
            name: _pmTaskRowEntryName(row),
            frontmatter: {
              id: topicId,
              topicRef: {
                sourceId: _pmCloudProductionSourceId(provider, internals),
                topicId,
              },
            },
            body: '',
          });
          created += 1;
        } catch (error) {
          const isConflict = String(error?.name || '').toLowerCase().includes('conflict')
            || String(error?.status || error?.code || '') === '409'
            || /conflict|競合/i.test(String(error?.message || ''));
          let reconciled = false;
          try {
            const concurrent = isConflict && key ? await _pmCloudTaskConflictExists(provider, internals, taskSheet, row, key) : false;
            if (concurrent) {
              const conflictPath = String(error?.message || '').match(/競合コピーへ保存しました:\s*(.+)\s*$/)?.[1] || '';
              if (conflictPath && typeof provider?.deletePath !== 'function') throw error;
              if (conflictPath) await provider.deletePath(conflictPath);
              reconciled = true;
            }
          } catch (reconcileError) {
            errors.push(reconcileError);
            aborted = true;
            break;
          }
          if (reconciled) continue;
          errors.push(error);
          aborted = true;
          break;
        }
      }
    }));
    if (errors.length) throw errors[0];
    return { created, entries: createdEntries };
  }

  async function _pmCloudTaskConflictExists(provider, internals, taskSheet, row, key) {
    const props = _pmTaskRowProps(row);
    const safeName = _pmSafeName(_pmTaskRowEntryName(row));
    const dir = internals._joinPath(_pmCloudRoot(internals), taskSheet);
    const suffix = _pmHash([taskSheet, '作成キー', key, JSON.stringify(props)].join('|')).slice(0, 8);
    const candidates = [
      internals._joinPath(dir, safeName + '.md'),
      internals._joinPath(dir, `${safeName}-${suffix}.md`),
    ];
    for (const path of candidates) {
      if (!await _pmCloudEntryExists(provider, path, internals)) continue;
      const parsed = await _pmCloudReadFrontmatter(provider, path);
      if (_pmCloudPropValue(parsed.frontmatter, '作成キー') === key) return true;
    }
    return false;
  }

  async function _pmCloudTaskCreateCatalog(provider, internals) {
    const works = await _pmCloudListEntries(provider, internals, '作品リスト', { concurrency: 8 });
    const [contents, targets, scales, taskSheets] = await Promise.all([
      _pmCloudListEntries(provider, internals, '作業内容リスト', { concurrency: 8 }),
      _pmCloudListEntries(provider, internals, '作業対象リスト', { concurrency: 8 }),
      _pmCloudListEntries(provider, internals, '作業規模リスト', { concurrency: 8 }),
      _pmCloudTaskSheets(provider, internals, works),
    ]);
    const payload = (sheet, entries) => ({ ok: true, sheet, rows: entries.map(_pmCloudEntryRow), count: entries.length, root: PM_ROOT, cloud: true });
    return {
      ok: true,
      root: PM_ROOT,
      works: payload('作品リスト', works),
      contents: payload('作業内容リスト', contents),
      targets: payload('作業対象リスト', targets),
      scales: payload('作業規模リスト', scales),
      task_sheets: taskSheets.sheets,
      cloud: true,
    };
  }

  let PM_CALENDAR_LEASE_TOKEN = '';
  const PM_LEASE_PROVIDER_ORIGINAL = Symbol.for('meldex.lease.originalProvider');

  async function _pmCloudWithProductionLease(provider, operation) {
    const serialize = window.MeldexProductionSchemaMigration?.serializeProviderLeaseOperation;
    if (typeof serialize === 'function') {
      return serialize(provider, () => _pmCloudWithProductionLeaseUnlocked(provider, operation));
    }
    return _pmCloudWithProductionLeaseUnlocked(provider, operation);
  }

  async function _pmCloudWithProductionLeaseUnlocked(provider, operation) {
    const requireUnlocked = window.MeldexFileLockStore?.requireUnlocked;
    if (typeof requireUnlocked === 'function') {
      await requireUnlocked(provider, PM_ROOT, { action: 'production-management', includeDescendants: true });
    }
    const store = window.MeldexActiveLockStore;
    if (!store?.acquire || !store?.release || !store?.heartbeat) {
      if (window.MeldexRuntimeAdapter?.getWorkspaceState) throw _pmCloudError(503, '共有更新ロックを利用できません');
      return operation(provider);
    }
    const token = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `pm-${Date.now()}-${_pmHash(Math.random())}`;
    const holderId = `production-task-create:${token}`;
    const lease = {
      path: PM_ROOT,
      token,
      holder_id: holderId,
      locked_by: '制作管理タスク生成',
      device_label: '制作管理',
      kind: 'production-task-create',
      include_descendants: true,
      lease_seconds: 300,
    };
    await store.acquire(provider, lease);
    let leaseLost = null;
    let heartbeatPromise = null;
    const lostError = cause => {
      const error = _pmCloudError(409, '制作管理の共有更新ロックを失いました。変更を保存せず再読み込みしてください');
      error.code = 'PRODUCTION_LEASE_LOST';
      if (cause) error.cause = cause;
      return error;
    };
    const assertOwned = async () => {
      if (leaseLost) throw leaseLost;
      if (!heartbeatPromise) {
        heartbeatPromise = Promise.resolve(store.heartbeat(provider, lease))
          .catch(error => { leaseLost = lostError(error); throw leaseLost; })
          .finally(() => { heartbeatPromise = null; });
      }
      await heartbeatPromise;
      if (leaseLost) throw leaseLost;
    };
    const guardedProvider = new Proxy(provider, {
      get(object, property) {
        if (property === PM_LEASE_PROVIDER_ORIGINAL) return object[PM_LEASE_PROVIDER_ORIGINAL] || object;
        const value = Reflect.get(object, property, object);
        if (typeof value !== 'function') return value;
        if (!/^(?:write|upload|put|create|copy|remove|delete|move|rename)/u.test(String(property))) return value.bind(object);
        return async (...args) => { await assertOwned(); return value.apply(object, args); };
      },
    });
    const heartbeatId = setInterval(() => {
      assertOwned().catch(error => console.warn('[ProductionManagement] 制作管理ロックの更新に失敗しました', error));
    }, 60000);
    try {
      const calendarLease = window.MeldexCloudCalendarLease;
      if (!calendarLease?.withLease) {
        if (window.MeldexRuntimeAdapter?.getWorkspaceState) throw _pmCloudError(503, '共有カレンダーの更新ロックを利用できません');
        return operation(guardedProvider);
      }
      return await calendarLease.withLease(provider, async context => {
        PM_CALENDAR_LEASE_TOKEN = context.token;
        try {
          const guardedByBoth = context?.guardProvider?.(guardedProvider) || guardedProvider;
          const result = await operation(guardedByBoth);
          await assertOwned();
          return result;
        }
        finally { PM_CALENDAR_LEASE_TOKEN = ''; }
      });
    } finally {
      if (heartbeatId != null) clearInterval(heartbeatId);
      try {
        await store.release(provider, PM_ROOT, token, holderId);
      } catch (error) {
        console.warn('[ProductionManagement] 制作管理ロックの解放に失敗しました', error);
      }
    }
  }
