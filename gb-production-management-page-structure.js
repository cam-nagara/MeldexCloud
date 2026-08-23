(function () {
  'use strict';

  const LEFT = '左ページ';
  const RIGHT = '右ページ';
  const FALLBACK_COUNT = 99;
  const SPREAD_GRANULARITY = '見開き単位';

  function positiveCount(value, fallback = FALLBACK_COUNT) {
    if (value === undefined || value === null || value === '') return fallback;
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) throw new Error('ページ数は1以上の整数で指定してください');
    return number;
  }

  function side(value) {
    return value === RIGHT ? RIGHT : LEFT;
  }

  function page(index) {
    return 'p' + String(Math.max(1, Number(index) || 1)).padStart(4, '0');
  }

  function pageOptions(pageCount) {
    return Array.from({ length: positiveCount(pageCount) }, (_, index) => page(index + 1));
  }

  function spreadOptions(pageCount, startSide) {
    const count = positiveCount(pageCount);
    const first = side(startSide) === RIGHT ? 1 : 2;
    const result = [];
    for (let index = first; index < count; index += 2) result.push(`${page(index)}-${page(index + 1)}`);
    return result;
  }

  function list(value) {
    if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
    return String(value || '').split(/[,、\n]/).map(item => item.trim()).filter(Boolean);
  }

  function parseSpread(value) {
    const numbers = [...String(value || '').matchAll(/\d+/g)].map(match => Number(match[0]));
    return numbers.length === 2 && numbers[1] === numbers[0] + 1 ? numbers : null;
  }

  function normalizeSpreads(values, pageCount, startSide) {
    const allowed = new Set(spreadOptions(pageCount, startSide));
    const valid = [];
    const invalid = [];
    list(values).forEach((raw) => {
      const pair = parseSpread(raw);
      const canonical = pair ? `${page(pair[0])}-${page(pair[1])}` : '';
      if (allowed.has(canonical)) {
        if (!valid.includes(canonical)) valid.push(canonical);
      } else if (!invalid.includes(raw)) {
        invalid.push(raw);
      }
    });
    return { valid, invalid };
  }

  function pageUnits(pageCount, spreads, startSide) {
    const count = positiveCount(pageCount, 1);
    const normalized = normalizeSpreads(spreads, count, startSide);
    if (normalized.invalid.length) {
      throw new Error(`見開きページに現在のページ数・開始ページ位置では使えない値があります: ${normalized.invalid.join('、')}`);
    }
    const starts = new Set(normalized.valid.map(value => parseSpread(value)[0]));
    const result = [];
    for (let index = 1; index <= count;) {
      if (starts.has(index)) {
        result.push(`${page(index)}-${page(index + 1)}`);
        index += 2;
      } else {
        result.push(page(index));
        index += 1;
      }
    }
    return result;
  }

  function positiveSavedCount(value, fallback = 1) {
    const number = Number(String(value == null ? '' : value).trim());
    return Number.isInteger(number) && number >= 1 ? number : fallback;
  }

  function plainProperty(frontmatter, name) {
    const values = frontmatter?.properties?.[name];
    const listValues = Array.isArray(values) ? values : values == null ? [] : [values];
    const adopted = listValues.find(value => value && typeof value === 'object' && ['採用', '掲載済み'].includes(value.status));
    const value = adopted ?? listValues[0] ?? '';
    return String(value && typeof value === 'object' ? value.value ?? '' : value);
  }

  function prepare(body, workFrontmatter) {
    const source = { ...(body || {}) };
    if (source.hierarchy_paths || source['階層パス']) return source;
    const saved = {};
    [
      'ページ数', 'プリセット種別', '開始ページの位置', '見開きページ', 'カラーページ',
      '作業作成粒度', '階層数', '階層ラベル', '生成コマ数',
    ].forEach((name) => {
      saved[name] = plainProperty(workFrontmatter, name);
    });
    const preset = String(source.preset || source['プリセット種別'] || saved['プリセット種別'] || '').trim();
    const rawCount = source.page_count ?? source['ページ数'] ?? saved['ページ数'];
    if (rawCount === undefined || rawCount === null || rawCount === '' || (preset && preset !== 'マンガ')) return source;
    const count = positiveCount(rawCount, 1);
    const startSide = side(source.start_page_side || source['開始ページの位置'] || saved['開始ページの位置']);
    const spreads = source.spread_pages ?? source['見開きページ'] ?? saved['見開きページ'];
    const colors = source.color_pages ?? source['カラーページ'] ?? saved['カラーページ'];
    const normalized = normalizeSpreads(spreads, count, startSide);
    const explicitGranularity = source.granularity || source['作業作成粒度'] || '';
    const granularity = explicitGranularity || saved['作業作成粒度'] || 'ページ単位';
    // 保存済みの見開きページは、どの粒度でも先に検証する。見開き単位は合成した見開きを
    // pageUnits() へ渡すため、そのままだと保存値の検証を素通りし、範囲外になった見開きが
    // 黙って捨てられたうえで作品へ書き戻され、ユーザーの設定を無警告で削除してしまう。
    // Python 側 prepare_task_body と同じ扱い。
    if (normalized.invalid.length) {
      throw new Error(`見開きページに現在のページ数・開始ページ位置では使えない値があります: ${normalized.invalid.join('、')}`);
    }
    // 見開き単位は「全ページを2ページずつ組にする」指定。作品に保存済みの見開き設定では
    // なく、そのページ数・開始ページ位置で成立する見開きすべてを使って単位を作る。
    // ただし作品側の 見開きページ 設定は書き換えない（_spread_pages には検証済みの保存値を
    // そのまま残す）。今回の作成にだけ効く。
    const unitSpreads = granularity === SPREAD_GRANULARITY ? spreadOptions(count, startSide) : normalized.valid;
    const defaultHierarchyCount = granularity === 'コマ単位' ? 2 : 1;
    const hierarchyCount = source.hierarchy_count || source['階層数']
      || (explicitGranularity ? defaultHierarchyCount : saved['階層数'] || defaultHierarchyCount);
    const hierarchyLabels = source.hierarchy_labels || source['階層ラベル']
      || (explicitGranularity
        ? (granularity === 'コマ単位' ? 'ページ,コマ' : 'ページ')
        : saved['階層ラベル'] || (granularity === 'コマ単位' ? 'ページ,コマ' : 'ページ'));
    return {
      ...source,
      preset: preset || 'マンガ',
      granularity,
      hierarchy_count: hierarchyCount,
      hierarchy_labels: hierarchyLabels,
      // 作品の 生成コマ数 は、ページ単位・見開き単位で作ると "0" が保存される（階層が1段
      // なので第2階層が0件）。あとで粒度をコマ単位へ戻したとき "0" が不正値として400に
      // なるため、正の整数でなければ未設定として扱う（Python 側 _positive_saved_count と同じ）。
      panel_count: source.panel_count || source['コマ数'] || positiveSavedCount(saved['生成コマ数']),
      page_count: count,
      pages: pageUnits(count, unitSpreads, startSide),
      _physical_page_count: count,
      _page_start_side: startSide,
      _spread_pages: normalized.valid,
      _color_pages: list(colors),
    };
  }

  window.MeldexProductionPageStructure = {
    LEFT, RIGHT, FALLBACK_COUNT, SPREAD_GRANULARITY, page, pageOptions, spreadOptions,
    parseSpread, normalizeSpreads, pageUnits, plainProperty, prepare,
  };
})();
