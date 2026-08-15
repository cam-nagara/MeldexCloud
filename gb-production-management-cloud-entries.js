  // gb-production-management-cloud-entries.js: エントリ.mdファイルのディレクトリ列挙・
  // 読み書き（Upsert/Update/Find）と、タスクシート名の列挙を担当する（責務単位分割
  // 2026-08-12。旧 gb-production-management.part02.js の一部）。
  //
  // gb-production-management.part01.js から続く共有クロージャ（IIFEの raw
  // concatenation）に属し、このファイル自体は自前のIIFEを持たない。読み込み順は
  // gb-production-management.js を参照。

  async function _pmCloudDirectoryEntries(provider, internals, dir) {
    try {
      return await internals._listDirectoryEntries(provider, dir);
    } catch (error) {
      if (_pmCloudIsNotFoundError(error)) return [];
      throw error;
    }
  }

  async function _pmCloudUpsertEntry(provider, internals, sheet, name, props, keyProp, keyValue, options = {}) {
    let existing = keyProp && keyValue && !options.skipLookup
      ? await _pmCloudFindByProp(provider, internals, sheet, keyProp, keyValue)
      : '';
    const safeName = _pmSafeName(existing ? internals._basename(existing).replace(/\.md$/i, '') : name);
    let path = existing || internals._joinPath(_pmCloudRoot(internals), sheet, safeName + '.md');
    if (!existing && await _pmCloudEntryExists(provider, path, internals)) {
      if (options.reuseName) existing = path;
      const atBase = await _pmCloudReadFrontmatter(provider, path);
      if (existing || (keyProp && keyValue && _pmCloudPropValue(atBase.frontmatter, keyProp) === String(keyValue))) {
        if (!props || !Object.keys(props).length) return path;
      } else {
        const suffix = _pmHash([sheet, keyProp || '', keyValue || '', JSON.stringify(props || {})].join('|')).slice(0, 8);
        path = internals._joinPath(_pmCloudRoot(internals), sheet, `${safeName}-${suffix}.md`);
        let counter = 1;
        while (await _pmCloudEntryExists(provider, path, internals)) {
          const atCandidate = await _pmCloudReadFrontmatter(provider, path);
          if (keyProp && keyValue && _pmCloudPropValue(atCandidate.frontmatter, keyProp) === String(keyValue)) return path;
          counter += 1;
          path = internals._joinPath(_pmCloudRoot(internals), sheet, `${safeName}-${suffix}-${counter}.md`);
        }
      }
    }
    const parsed = options.createNew && !existing ? { frontmatter: {}, body: '' } : await _pmCloudReadFrontmatter(provider, path);
    const fm = { ...(parsed.frontmatter || {}) };
    fm.type = 'settings-entry';
    fm.id = fm.id || 'ent_' + _pmHash(path).slice(0, 10);
    fm.category = sheet;
    fm.modified = new Date().toISOString();
    fm.properties = { ...(fm.properties || {}) };
    // タスクリスト（+作品別シート）だけ内部専用列を production_internal へ振り分ける
    // （制作管理UX改善計画 2026-08-04 §5-1）。作品リスト等の同名列（階層ラベル/プリセット
    // 種別/作業作成粒度）は対象外（_pmCloudIsTaskSheetName で先に判定してから適用する）。
    const isTaskSheet = _pmCloudIsTaskSheetName(sheet);
    if (isTaskSheet) fm.production_internal = { ...(fm.production_internal || {}) };
    Object.entries(props || {}).forEach(([prop, value]) => {
      if (value == null || value === '') return;
      if (_pmCloudIsInternalMetadataProp(isTaskSheet, prop)) {
        fm.production_internal[prop] = String(value);
        return;
      }
      fm.properties[prop] = [{ value: String(value), status: '採用', note: '', created: new Date().toISOString() }];
    });
    if (typeof options.beforeWrite === 'function') await options.beforeWrite(path);
    await provider.writeText(path, _pmCloudFrontmatterText(fm, parsed.body || ''));
    return path;
  }

  // コミット前レビュー指摘 #16: タスクシートへの直接プロパティ書込み
  // （_pmCloudUpsertEntry / _pmCloudUpdateEntryAtPath / _pmCloudApplyEntryUpdates）で共通
  // して使う、内部メタデータキーの振り分け判定。isTaskSheet（真偽値。呼び出し側が物理
  // シート名や論理シート名から先に判定する）かつ PM_INTERNAL_METADATA_PROPERTIES に
  // 含まれる列なら production_internal へ、それ以外は通常の properties へ書く。
  function _pmCloudIsInternalMetadataProp(isTaskSheet, prop) {
    return !!isTaskSheet && PM_INTERNAL_METADATA_PROPERTIES.has(prop);
  }

  // _pmCloudUpdateEntryAtPath は sheet名を引数で受け取らないため、対象パスが
  // `制作管理/シート/<シート名>/...` の形かどうかから物理シート名を復元する
  // （PM_ROOTはpart01.jsで定義済み。同じ共有クロージャのため直接参照できる）。
  function _pmCloudSheetNameFromPath(path) {
    const normalized = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const prefix = `${PM_ROOT}/シート/`;
    if (!normalized.startsWith(prefix)) return '';
    return normalized.slice(prefix.length).split('/').filter(Boolean)[0] || '';
  }

  // 既存エントリをパス指定で直接更新する（キー検索に依存しない。割り当て結果の書き戻し用）
  async function _pmCloudUpdateEntryAtPath(provider, path, props, cachedEntry = null) {
    const parsed = cachedEntry || await _pmCloudReadFrontmatter(provider, path);
    const fm = { ...(parsed.frontmatter || {}) };
    fm.type = fm.type || 'settings-entry';
    fm.modified = new Date().toISOString();
    fm.properties = { ...(fm.properties || {}) };
    // コミット前レビュー指摘 #16: タスクシートへ書き戻す場合、内部メタデータキー
    // （作成キー・階層パス等）は properties ではなく production_internal へ振り分ける
    // （_pmCloudUpsertEntry / _pmCloudApplyEntryUpdates と同じ判定を共通化して再利用。
    // これが無いと、再計算エンジンの割当結果書き戻しのたびに内部専用列が生JSONの
    // properties へ復活し、列一覧・フィルタ候補に再び現れてしまう）。
    const isTaskSheet = _pmCloudIsTaskSheetName(_pmCloudSheetNameFromPath(path));
    if (isTaskSheet) fm.production_internal = { ...(fm.production_internal || {}) };
    Object.entries(props || {}).forEach(([prop, value]) => {
      if (value == null || value === '') return;
      if (_pmCloudIsInternalMetadataProp(isTaskSheet, prop)) {
        fm.production_internal[prop] = String(value);
        return;
      }
      fm.properties[prop] = [{ value: String(value), status: '採用', note: '', created: new Date().toISOString() }];
    });
    if (isTaskSheet && fm.production_internal && !Object.keys(fm.production_internal).length) delete fm.production_internal;
    await provider.writeText(path, _pmCloudFrontmatterText(fm, parsed.body || ''));
    return path;
  }

  async function _pmCloudFindByProp(provider, internals, sheet, prop, value) {
    for (const entry of await _pmCloudListEntries(provider, internals, sheet)) {
      if (_pmCloudPropValue(entry.frontmatter, prop) === String(value)) return entry.path;
    }
    return '';
  }

  async function _pmCloudListEntries(provider, internals, sheet, options = {}) {
    const dir = internals._joinPath(_pmCloudRoot(internals), sheet);
    const entries = await _pmCloudDirectoryEntries(provider, internals, dir);
    const files = entries.filter(entry => entry.handle.kind === 'file' && entry.name.endsWith('.md')
      && entry.name !== sheet + '.md' && !entry.name.startsWith('_'));
    const rows = await _pmCloudMapBounded(files, options.concurrency || 1, async entry => {
      const path = internals._joinPath(dir, entry.name);
      const parsed = await _pmCloudReadFrontmatter(provider, path);
      return {
        path,
        name: entry.name.replace(/\.md$/i, ''),
        frontmatter: parsed.frontmatter || {},
        body: parsed.body || '',
        transportRevision: await _pmCloudEntryTransportRevision(provider, path, parsed),
      };
    });
    // ストア汚染の過渡期フォールバック（production-sheet-store-contamination-fix-plan-
    // 2026-08-05.md Phase 3）: 修復（_repairProductionSheetStoreIfNeeded）が走る前の
    // 1リクエスト目や旧版クライアント併走時に、sheet-store にしか無い行をベストエフォート
    // で合流させ、重複作成・編集不能(404)・目標時間の計算誤りを防ぐ。同名は物理.md優先。
    // 修復完了後は storeファイル自体が無いため、この読み取りは即失敗して素通りする。
    try {
      const store = await provider.readJson(internals._joinPath(dir, '_meldex_sheet.cloud.json'));
      if (store && store.rows && typeof store.rows === 'object') {
        const seen = new Set(rows.map(row => (row.name + '.md').toLowerCase()));
        Object.values(store.rows).forEach((row) => {
          const fileName = String(row?.file_name || '').trim();
          if (!fileName || !fileName.toLowerCase().endsWith('.md')) return;
          if (fileName.startsWith('_') || fileName === sheet + '.md') return;
          if (seen.has(fileName.toLowerCase())) return;
          if (String(row?.frontmatter?.type || '') !== 'settings-entry') return;
          rows.push({
            path: internals._joinPath(dir, fileName),
            name: fileName.replace(/\.md$/i, ''),
            frontmatter: row.frontmatter || {},
            body: String(row.body || ''),
          });
        });
      }
    } catch (err) { /* sheet-store未使用（修復済み・正常状態）。物理ファイルの結果のみで進める */ }
    return rows;
  }

  async function _pmCloudFindByName(provider, internals, sheet, name) { return (await _pmCloudListEntries(provider, internals, sheet)).find(entry => entry.name === String(name))?.path || ''; }

  async function _pmCloudTaskSheetNames(provider, internals, cachedWorks = null) { // cachedWorksは同一処理内で列挙済みの作品リストのみ再利用可（別タイミング取得分は陳腐化し得るため使い回さない）。省略時は従来どおり自前で列挙する
    const names = new Set();
    const legacyDir = internals._joinPath(_pmCloudRoot(internals), 'タスクリスト');
    if (await _pmCloudEntryExists(provider, legacyDir, internals)) names.add('タスクリスト');
    for (const work of (Array.isArray(cachedWorks) ? cachedWorks : await _pmCloudListEntries(provider, internals, '作品リスト'))) {
      const sheet = _pmCloudPropValue(work.frontmatter, 'タスクリストシート');
      if (sheet) names.add(sheet);
    }
    const rootEntries = await _pmCloudDirectoryEntries(provider, internals, _pmCloudRoot(internals));
    rootEntries.forEach(entry => {
      if (entry?.handle?.kind === 'directory' && _pmCloudIsTaskSheetName(entry.name)) names.add(String(entry.name));
    });
    return [...names];
  }
