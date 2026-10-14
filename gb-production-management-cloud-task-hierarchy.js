  // gb-production-management-cloud-task-hierarchy.js: 目標作業時間の計算（基準時間×
  // 内容倍率×規模倍率×対象数）と、階層構成（プリセット・階層ラベル・ページ/コマ等の
  // 単位パス）からタスク行を組み立てる純粋ロジックを担当する（責務単位分割 2026-08-12。
  // 旧 gb-production-management.part02.js の一部）。
  //
  // gb-production-management.part01.js から続く共有クロージャ（IIFEの raw
  // concatenation）に属し、このファイル自体は自前のIIFEを持たない。読み込み順は
  // gb-production-management.js を参照。

  function _pmCloudDurationNumber(value, fallback = 1) {
    const text = String(value == null ? '' : value).trim();
    const parsed = text ? Number(text) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function _pmCloudDurationText(value) {
    const rounded = Math.round(Number(value || 0) * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0+$/, '').replace(/\.$/, '');
  }

  async function _pmCloudTaskDurationMaps(provider, internals, templateId = '') {
    const specs = {
      targets: ['作業対象リスト', '基準作業時間'],
      contents: ['作業内容リスト', '作業時間倍率'],
      scales: ['作業規模リスト', '作業時間倍率'],
    };
    const result = {};
    for (const [kind, [sheet, valueProp]] of Object.entries(specs)) {
      const values = new Map();
      (PM_SEEDS[sheet] || []).forEach(([name, props]) => {
        values.set(name, _pmCloudDurationNumber(props?.[valueProp], 1));
      });
      for (const entry of await _pmCloudListEntries(provider, internals, sheet)) {
        if (templateId && _pmCloudPropValue(entry.frontmatter, '作業テンプレート') !== templateId) continue;
        const name = entry.name;
        if (!name) continue;
        values.set(name, _pmCloudDurationNumber(_pmCloudPropValue(entry.frontmatter, valueProp), values.get(name) ?? 1));
      }
      result[kind] = values;
    }
    return result;
  }

  // 対象数は既定1。0以下・非数（空欄含む）は1扱いにする（設計文書の計算式
  // 基準時間×内容倍率×規模倍率×対象数のうち対象数側の丸め規則）。
  function _pmCloudTargetCountNumber(value) {
    const text = String(value == null ? '' : value).trim();
    const parsed = text ? Number(text) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }

  async function _pmCloudApplyTaskDurations(provider, internals, rows, templateId = '') {
    const maps = await _pmCloudTaskDurationMaps(provider, internals, templateId);
    (rows || []).forEach(row => {
      const targetHours = maps.targets.get(String(row?.['作業対象リスト'] || '')) ?? 1;
      const contentRatio = maps.contents.get(String(row?.['作業内容リスト'] || '')) ?? 1;
      const scaleRatio = maps.scales.get(String(row?.['作業規模リスト'] || '')) ?? 1;
      const targetCount = _pmCloudTargetCountNumber(row?.['対象数']);
      const hoursText = _pmCloudDurationText(Math.max(0.01, targetHours * contentRatio * scaleRatio * targetCount));
      row['目標作業時間_値'] = hoursText;
      row['目標作業時間'] = `${hoursText}時間`;
    });
    return rows;
  }

  // テンプレート生成・カレンダードロップ経路（_pmCloudCreateFromTemplate）用: 作業対象・
  // 作業内容・作業規模の3分類が揃っている場合だけ計算式で目標作業時間_値／目標作業時間を
  // 上書きする。分類が1つでも欠けている場合はテンプレートの明示値（手動指定値）を温存する。
  async function _pmCloudApplyTemplateInstanceDuration(provider, internals, props, templateId = '') {
    const target = String(props?.['作業対象リスト'] || '').trim();
    const content = String(props?.['作業内容リスト'] || '').trim();
    const scale = String(props?.['作業規模リスト'] || '').trim();
    if (!target || !content || !scale) return props;
    await _pmCloudApplyTaskDurations(provider, internals, [props], templateId);
    return props;
  }

  // シート編集経路（Cloud）で作業対象/作業内容/作業規模/対象数のセルが変更された時、
  // 目標作業時間_値・目標作業時間を再計算する単一の入口。gb-data-access-dropbox-expanded
  // .part01.js の _updateValue / _updateSheetStoreValue / _addValue / _addSheetStoreValue
  // から window.MeldexProductionManagement.applyTaskDurationRecalcOnValueUpdate() 経由で
  // 呼ばれる。後続フェーズ（タスク名自動更新のCloud対応）でも同じ入口に処理を足す想定。
  const PM_DURATION_RECALC_TRIGGER_PROPS = new Set(['作業対象リスト', '作業内容リスト', '作業規模リスト', '対象数']);

  function _pmHierarchyConfig(body) {
    const explicitPreset = String(body.preset || body['プリセット種別'] || '').trim();
    const preset = explicitPreset || (_pmHasMangaCountInput(body) ? 'マンガ' : '汎用');
    const rawCount = body.hierarchy_count || body['階層数'];
    const fallback = preset === 'マンガ' ? 2 : 1;
    const count = Math.max(1, Math.min(5, Number(rawCount || fallback) || fallback));
    const labels = _pmList(body.hierarchy_labels || body['階層ラベル'] || (preset === 'マンガ' ? 'ページ,コマ' : '項目,サブ項目,詳細,工程,単位'));
    while (labels.length < count) labels.push('単位レベル' + (labels.length + 1));
    const granularity = String(body.granularity || body['作業作成粒度'] || (preset === 'マンガ' ? 'ページ単位' : ''));
    return { preset, count, labels: labels.slice(0, count), granularity };
  }

  // meldex_production_task_sheets.resolve_level_prop_names の JS版。新規タスク作成時の
  // レベル値プロパティキー解決に使う（AGENT_INBOX.md「制作タスク作成のJS側ミラーにも旧名
  // 単位レベル1〜3書き込みバグが残っている」の解消。2026-07-15 フェーズD1）。
  // 優先順位: 作品固有ラベル（階層ラベルの各段名。マンガプリセットなら ページ/コマ）
  //   > 中分類/小分類/詳細分類（1〜3段目のみ） > 旧 単位レベルN。
  const _PM_NEW_LEVEL_NAMES = ['中分類', '小分類', '詳細分類'];

  function _pmResolveLevelPropNames(labelsText, levelCount = 5) {
    const labels = _pmList(labelsText);
    const result = [];
    for (let index = 0; index < levelCount; index += 1) {
      const candidates = [];
      if (labels[index]) candidates.push(labels[index]);
      if (_PM_NEW_LEVEL_NAMES[index]) candidates.push(_PM_NEW_LEVEL_NAMES[index]);
      candidates.push('単位レベル' + (index + 1));
      result.push([...new Set(candidates)]);
    }
    return result;
  }

  function _pmHierarchyPaths(body, config) {
    const pathCount = _pmHierarchyPathCount(body, config);
    if (pathCount > PM_MAX_GENERATED_TASKS) throw new Error(`一度に作成できる階層は${PM_MAX_GENERATED_TASKS}件までです`);
    const explicit = _pmExplicitHierarchyPaths(body.hierarchy_paths || body['階層パス'], config.count);
    if (explicit.length) return explicit;
    if (config.preset === 'マンガ' || _pmHasMangaCountInput(body)) {
      const pages = _pmLevelValues(body.pages, body.page_count || body['ページ数'], 1, 'P');
      if (config.granularity !== 'コマ単位' || config.count < 2) return pages.map(page => [page]);
      const panels = _pmLevelValues(body.panels, body.panel_count || body['コマ数'], 1, 'C');
      return pages.flatMap(page => panels.map(panel => [page, panel]));
    }
    const counts = _pmHierarchyCounts(body.hierarchy_counts || body['階層別件数'], config.count);
    return _pmCartesian(counts.map((count, level) => Array.from({ length: count }, (_, i) => `L${level + 1}-${i + 1}`)));
  }

  function _pmHierarchyPathCount(body, config) {
    const explicit = _pmExplicitHierarchyPaths(body.hierarchy_paths || body['階層パス'], config.count);
    if (explicit.length) return explicit.length;
    if (config.preset === 'マンガ' || _pmHasMangaCountInput(body)) {
      const pages = _pmLevelValueCount(body.pages, _pmFirstPresent(body, ['page_count', 'ページ数']), 1, 'ページ数');
      if (config.granularity !== 'コマ単位' || config.count < 2) return pages;
      return pages * _pmLevelValueCount(body.panels, _pmFirstPresent(body, ['panel_count', 'コマ数']), 1, 'コマ数');
    }
    return _pmValidatedHierarchyCounts(body.hierarchy_counts || body['階層別件数'], config.count)
      .reduce((total, count) => total * count, 1);
  }

  function _pmExplicitHierarchyPaths(value, count) {
    const rows = Array.isArray(value) ? value : String(value || '').split(/\r?\n/).filter(Boolean);
    return rows.map((row) => {
      const parts = Array.isArray(row) ? row : String(row).split(/[>\/\\|-]/);
      return parts.map(part => String(part).trim()).filter(Boolean).slice(0, count);
    }).filter(path => path.length);
  }

  function _pmLevelValues(values, countValue, fallback, prefix) {
    const list = _pmList(values);
    if (list.length) return list.map(value => _pmUnitLabel(value, prefix));
    const count = _pmPositiveInteger(countValue || fallback, String(prefix).toLowerCase() === 'p' ? 'ページ数' : 'コマ数');
    return Array.from({ length: count }, (_, i) => _pmFormatUnitLabel(i + 1, prefix));
  }

  function _pmLevelValueCount(values, countValue, fallback, label) {
    const list = _pmList(values);
    const requested = countValue === undefined || countValue === null || countValue === '' ? fallback : countValue;
    return list.length || _pmPositiveInteger(requested, label);
  }

  function _pmValidatedHierarchyCounts(value, count) {
    const list = _pmList(value);
    return Array.from({ length: count }, (_, index) => _pmPositiveInteger(list[index] || 1, `階層${index + 1}の件数`));
  }

  function _pmPositiveInteger(value, label) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) throw new Error(`${label}は1以上の整数で指定してください`);
    return number;
  }

  function _pmFirstPresent(body, keys) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(body, key)) return body[key];
    }
    return undefined;
  }

  function _pmHasMangaCountInput(body) {
    return ['page_count', 'ページ数', 'panel_count', 'コマ数', 'pages', 'panels'].some((key) => {
      const value = body?.[key];
      return value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length);
    });
  }

  function _pmUnitLabel(value, prefix) {
    const text = String(value || '').trim();
    const spread = text.match(new RegExp('^' + prefix + '?(\\d+)\\s*[-–—~〜～/・]\\s*' + prefix + '?(\\d+)$', 'i'));
    if (spread && Number(spread[2]) === Number(spread[1]) + 1) {
      return _pmFormatUnitLabel(Number(spread[1]), prefix) + '-' + _pmFormatUnitLabel(Number(spread[2]), prefix);
    }
    const number = text.match(/\d+/)?.[0];
    if (number && (new RegExp('^' + prefix + '\\d+', 'i')).test(text)) return _pmFormatUnitLabel(Number(number), prefix);
    if (/^\d+$/.test(text)) return _pmFormatUnitLabel(Number(text), prefix);
    return text || _pmFormatUnitLabel(1, prefix);
  }

  function _pmFormatUnitLabel(index, prefix) {
    const normalized = String(prefix || '').toLowerCase();
    const width = normalized === 'p' ? 4 : normalized === 'c' ? 2 : 2;
    return normalized + String(Math.max(1, Number(index) || 1)).padStart(width, '0');
  }

  function _pmHierarchyCounts(value, count) {
    const list = _pmList(value);
    return Array.from({ length: count }, (_, i) => Math.max(1, Number(list[i] || 1) || 1));
  }

  function _pmCartesian(levels) {
    return levels.reduce((acc, level) => acc.flatMap(path => level.map(value => [...path, value])), [[]]);
  }

  function _pmHierarchyId(path) {
    return path.map(value => String(value).trim()).filter(Boolean).join('-');
  }

  function _pmBuildTaskRows(body) {
    const workTitle = String(body.work_title || body['作品タイトル'] || '無題作品');
    const config = _pmHierarchyConfig(body);
    const targets = _pmTaskDimension(body, ['target_names', '作業対象リスト'], ['全体'], '作業対象');
    const contents = _pmTaskDimension(body, ['content_names', '作業内容リスト'], [config.preset === 'マンガ' ? 'ネーム' : '制作'], '作業内容');
    const scales = _pmTaskDimension(body, ['scale_names', '作業規模リスト'], [config.preset === 'マンガ' ? 'ページ全体' : '標準'], '作業規模');
    const estimated = _pmHierarchyPathCount(body, config) * targets.length * contents.length * scales.length;
    if (estimated > PM_MAX_GENERATED_TASKS) throw new Error(`一度に作成できるタスクは${PM_MAX_GENERATED_TASKS}件までです`);
    const paths = _pmHierarchyPaths(body, config);
    // 実際に書き込むプロパティキーは、この作品の階層ラベル解決結果の先頭候補を使う
    // （meldex_production_task_sheets.resolve_level_prop_names と同じ優先順位。マンガ
    // プリセットなら「ページ/コマ」、汎用プリセットで階層ラベル未指定なら「中分類/小分類/
    // 詳細分類」、階層ラベルを明示指定した作品ではその名前が実際のプロパティキーになる）。
    const levelPropNames = _pmResolveLevelPropNames(config.labels.join(',')).map(candidates => candidates[0]);
    const rows = [];
    paths.forEach(path => targets.forEach(target => contents.forEach(content => scales.forEach((scale) => {
      const unitId = _pmHierarchyId(path);
      const key = [workTitle, unitId, target, content, scale].join('|');
      const levels = {};
      path.slice(0, 5).forEach((value, index) => { levels[levelPropNames[index]] = value; });
      const usesMangaUnits = config.preset === 'マンガ';
      rows.push({ _entry_name: _pmTaskTitle(path, target, scale, content), '作品タイトル': workTitle, 'ページ': usesMangaUnits ? (path[0] || '') : '', 'コマ': usesMangaUnits ? (path[1] || '全体') : '', '階層パス': unitId, '階層ラベル': config.labels.join(','), 'プリセット種別': config.preset, ...levels, '作業作成粒度': config.granularity || `階層${path.length || 1}単位`, '作業対象リスト': target, '作業内容リスト': content, '作業規模リスト': scale, '対象数': '1', '状況': '未着手', '目標作業時間_値': '1', 'ページソート値': String(_pmSortPath(path)), '作成キー': key });
    }))));
    return rows;
  }
