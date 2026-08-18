(function () {
  'use strict';

  function plainValue(values) {
    const items = Array.isArray(values) ? values : values == null ? [] : [values];
    const adopted = items.find(value => value && typeof value === 'object' && ['採用', '掲載済み'].includes(value.status));
    const value = adopted ?? items[0] ?? '';
    return String(value && typeof value === 'object' ? value.value ?? '' : value);
  }

  function resolve(propertyType, entityData) {
    const source = propertyType?.optionSource;
    if (!source || source.kind !== 'row-page-range') return null;
    const api = window.MeldexProductionPageStructure;
    if (!api) return null;
    const count = plainValue(entityData?.[source.countProperty || 'ページ数']) || source.fallbackCount || api.FALLBACK_COUNT;
    const startSide = plainValue(entityData?.[source.sideProperty || '開始ページの位置']) || source.defaultSide || api.LEFT;
    const options = source.mode === 'spread'
      ? api.spreadOptions(count, startSide)
      : api.pageOptions(count);
    return { options, count: Number(count), startSide };
  }

  window.MeldexDbDynamicOptions = { plainValue, resolve };
})();
