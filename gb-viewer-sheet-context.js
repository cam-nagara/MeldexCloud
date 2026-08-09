(function () {
  'use strict';

  const contexts = new Map();
  const MAX_CONTEXTS = 80;

  function normalizePath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
  }

  function contextForEntityPath(entityPath) {
    const active = typeof _currentPaneState === 'function' ? _currentPaneState() : null;
    const candidates = [active];
    if (typeof state !== 'undefined') candidates.push(state);
    return candidates.find(candidate => {
      const dbPath = candidate?.dbPath || candidate?.currentDbPath || state?.currentDbPath || '';
      return dbPath && normalizePath(entityPath).startsWith(normalizePath(dbPath) + '/');
    }) || active || state;
  }

  function entityNameForPath(ctx, dbPath, entityPath) {
    const entities = ctx?.pivotData?.entities || state?.pivotData?.entities || {};
    const target = normalizePath(entityPath);
    return Object.keys(entities).find(name => {
      if (typeof _entityPath === 'function') {
        return normalizePath(_entityPath(dbPath, name, ctx?.pivotData || state?.pivotData)) === target;
      }
      return target.endsWith('/' + normalizePath(name).replace(/\.md$/i, ''))
        || target.endsWith('/' + normalizePath(name));
    }) || '';
  }

  function visibleRowOrder(ctx, dbPath) {
    if (Array.isArray(ctx?._lastEntityNames)) return [...ctx._lastEntityNames];
    if (typeof _dbSortedEntityNames === 'function') {
      return _dbSortedEntityNames(ctx?.pivotData || state?.pivotData, dbPath, ctx, {
        applyAdvancedFilters: true,
      });
    }
    return Object.keys(ctx?.pivotData?.entities || state?.pivotData?.entities || {});
  }

  function visibleValues(rawValues, filterMode) {
    const source = Array.isArray(rawValues) ? rawValues : [];
    return typeof filterValues === 'function'
      ? filterValues(source, undefined, filterMode)
      : source;
  }

  function serializeImage(item) {
    const path = typeof _imagePropOpenPath === 'function' ? _imagePropOpenPath(item) : '';
    const url = typeof _imageSrc === 'function' ? _imageSrc(item, false) : (item?.url || item?.src || '');
    return {
      id: String(item?.id || item?.content_hash || item?.hash || path || url || ''),
      name: String(item?.caption || item?.filename || path.split('/').pop() || '画像'),
      path,
      url,
      width: Number(item?.width || 0),
      height: Number(item?.height || 0),
    };
  }

  function cellImages(ctx, entityName, propName) {
    const entity = ctx?.pivotData?.entities?.[entityName]
      || state?.pivotData?.entities?.[entityName]
      || {};
    const values = visibleValues(entity[propName], ctx?.filter ?? state?.filter ?? 'disabled');
    const images = [];
    values.forEach(value => {
      const parsed = typeof parseImagePropertyValue === 'function'
        ? parseImagePropertyValue(value?.value)
        : [];
      parsed.forEach(item => images.push(serializeImage(item)));
    });
    return images.filter(item => item.url || item.path);
  }

  function imageKey(item) {
    return String(item?.id || item?.content_hash || item?.hash
      || (typeof _imagePropOpenPath === 'function' ? _imagePropOpenPath(item) : '')
      || (typeof _imageSrc === 'function' ? _imageSrc(item, false) : '')
      || '');
  }

  function remember(context) {
    contexts.set(context.id, context);
    while (contexts.size > MAX_CONTEXTS) contexts.delete(contexts.keys().next().value);
    return context;
  }

  function create(options) {
    const entityPath = String(options?.entityPath || '');
    const propName = String(options?.propName || '');
    const ctx = options?.ctx || contextForEntityPath(entityPath);
    const dbPath = ctx?.dbPath || state?.currentDbPath || '';
    const rowOrder = visibleRowOrder(ctx, dbPath);
    const entityName = entityNameForPath(ctx, dbPath, entityPath);
    const foundRowIndex = rowOrder.indexOf(entityName);
    const rowIndex = foundRowIndex >= 0 ? foundRowIndex : 0;
    const imagesByRow = rowOrder.map(name => cellImages(ctx, name, propName));
    const clickedKey = imageKey(options?.item);
    const foundImageIndex = imagesByRow[rowIndex]?.findIndex(image => image.id === clickedKey) ?? -1;
    const startIndex = foundImageIndex >= 0 ? foundImageIndex : 0;
    return remember({
      id: 'sheet-viewer-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2),
      dbPath,
      paneId: ctx?.paneId || (typeof GBLayout !== 'undefined' ? GBLayout.activePane : ''),
      propName,
      rowOrder,
      imagesByRow,
      rowIndex,
      startIndex,
      createdAt: Date.now(),
    });
  }

  function payload(context, options) {
    const rowIndex = Number.isInteger(options?.rowIndex) ? options.rowIndex : context.rowIndex;
    return {
      type: 'viewer-sheet-context-set',
      contextId: context.id,
      sheetPath: context.dbPath,
      column: context.propName,
      rowIndex,
      rowCount: context.rowOrder.length,
      rowName: context.rowOrder[rowIndex] || '',
      images: context.imagesByRow[rowIndex] || [],
      startIndex: Number.isInteger(options?.startIndex) ? options.startIndex : context.startIndex,
      boundary: !!options?.boundary,
      message: options?.message || '',
    };
  }

  function post(target, message) {
    target?.postMessage?.(message, location.origin && location.origin !== 'null' ? location.origin : '*');
  }

  function handleRequest(message, target) {
    const context = contexts.get(String(message?.contextId || ''));
    if (!context) {
      post(target, {
        type: 'viewer-sheet-context-set',
        contextId: String(message?.contextId || ''),
        images: [],
        boundary: true,
        message: 'シートの画像閲覧情報が見つかりません',
      });
      return true;
    }
    post(target, payload(context));
    return true;
  }

  function handleRowNavigation(message, target) {
    const context = contexts.get(String(message?.contextId || ''));
    if (!context) return handleRequest(message, target);
    const direction = Number(message?.direction) < 0 ? -1 : 1;
    let candidate = context.rowIndex + direction;
    while (candidate >= 0 && candidate < context.rowOrder.length) {
      if (context.imagesByRow[candidate]?.length) {
        context.rowIndex = candidate;
        context.startIndex = 0;
        post(target, payload(context, { rowIndex: candidate, startIndex: 0 }));
        return true;
      }
      candidate += direction;
    }
    post(target, payload(context, {
      boundary: true,
      message: direction < 0 ? '前に画像がある行はありません' : '次に画像がある行はありません',
    }));
    return true;
  }

  window.MeldexViewerSheetContext = {
    create,
    viewerUrl(context) {
      return '/viewer?sheetContext=' + encodeURIComponent(context.id);
    },
    handleRequest,
    handleRowNavigation,
    get(id) {
      return contexts.get(String(id || '')) || null;
    },
  };
})();
