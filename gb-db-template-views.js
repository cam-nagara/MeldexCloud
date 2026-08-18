/* ==============================
   gb-db-template-views.js: シートテンプレートのビュー包含
   savedViews（フィルタ/ソート/型別設定を含む）のサニタイズ・エクスポート・マージ適用を担当する。
   gb-db-templates.part01.js の applyDbTemplate / exportDbAsTemplate から
   typeof ガード付きで呼び出される（本ファイル未ロード時は旧来の enabledModes のみのパスへ
   自動フォールバックする＝ロールバック・部分連結ハーネスの両方に対して安全）。
   ============================== */

/* --- typeSpecific のサブホワイトリスト --- */

function _sanitizeDbTemplateTimelineTypeSpecific(timeline) {
  const src = (timeline && typeof timeline === 'object') ? timeline : {};
  const out = {};
  ['timeProp', 'endProp', 'rowProp', 'scale', 'direction', 'calendarSystemId'].forEach((key) => {
    if (src[key]) out[key] = src[key];
  });
  const stepMinutes = Number(src.timeStepMinutes);
  if (Number.isFinite(stepMinutes) && Math.round(stepMinutes) !== 1) out.timeStepMinutes = Math.round(stepMinutes);
  if (Array.isArray(src.calendarSystems) && src.calendarSystems.length) {
    out.calendarSystems = _cloneTemplateData(src.calendarSystems);
  }
  if (Array.isArray(src.cardProps) && src.cardProps.length) {
    out.cardProps = _cloneTemplateData(src.cardProps);
  }
  const thumbCount = Number(src.cardImageThumbCount);
  if (Number.isFinite(thumbCount) && Math.round(thumbCount) !== 3) out.cardImageThumbCount = Math.round(thumbCount);
  const lineCount = Number(src.cardPropLineCount);
  if (Number.isFinite(lineCount) && Math.round(lineCount) !== 1) out.cardPropLineCount = Math.round(lineCount);
  if (src.colWidths && typeof src.colWidths === 'object' && !Array.isArray(src.colWidths) && Object.keys(src.colWidths).length) {
    out.colWidths = _cloneTemplateData(src.colWidths);
  }
  return out;
}

function _sanitizeDbTemplateTypeSpecific(typeSpecific) {
  const src = (typeSpecific && typeof typeSpecific === 'object') ? typeSpecific : {};
  const out = {};
  if (src.pivot && typeof src.pivot === 'object' && src.pivot.groupBy) {
    out.pivot = { groupBy: src.pivot.groupBy };
  }
  if (src.tree && typeof src.tree === 'object' && Object.keys(src.tree).length) {
    out.tree = _cloneTemplateData(src.tree);
  }
  if (src.kanban && typeof src.kanban === 'object' && src.kanban.groupBy && src.kanban.groupBy !== '_status') {
    out.kanban = { groupBy: src.kanban.groupBy };
  }
  if (src.calendar?.mapping && typeof src.calendar.mapping === 'object' && Object.keys(src.calendar.mapping).length) {
    out.calendar = { mapping: _cloneTemplateData(src.calendar.mapping) };
  }
  if (src.chart && typeof src.chart === 'object' && Object.keys(src.chart).length) {
    out.chart = _cloneTemplateData(src.chart);
  }
  if (src.graph && typeof src.graph === 'object' && Object.keys(src.graph).length) {
    out.graph = _cloneTemplateData(src.graph);
  }
  if (src.form?.formConfig != null) {
    out.form = { formConfig: _cloneTemplateData(src.form.formConfig) };
  }
  if (src.timeline && typeof src.timeline === 'object') {
    const timeline = _sanitizeDbTemplateTimelineTypeSpecific(src.timeline);
    if (Object.keys(timeline).length) out.timeline = timeline;
  }
  return out;
}

/* --- savedView 単体のサニタイズ --- */

/**
 * 保存済みビュー1件をテンプレート保存用にホワイトリスト方式でサニタイズする。
 * 除外: manualOrder（実データ依存のエントリ順）、filter（実行時のクイックフィルタ状態）、
 *       timeline.rowHeights / displayStart / displayEnd（実データ依存の表示状態）
 */
function _sanitizeDbTemplateSavedView(view) {
  if (!view || typeof view !== 'object') return null;
  const out = {};
  out.name = String(view.name || '').trim() || 'ビュー';
  out.viewMode = _dbTemplateNormalizeViewMode(view.viewMode);
  if (Array.isArray(view.hiddenCols) && view.hiddenCols.length) out.hiddenCols = _cloneTemplateData(view.hiddenCols);
  if (Array.isArray(view.pinnedCols) && view.pinnedCols.length) out.pinnedCols = _cloneTemplateData(view.pinnedCols);
  if (Array.isArray(view.colOrder) && view.colOrder.length) out.colOrder = _cloneTemplateData(view.colOrder);
  if (view.colWidths && typeof view.colWidths === 'object' && !Array.isArray(view.colWidths) && Object.keys(view.colWidths).length) {
    out.colWidths = _cloneTemplateData(view.colWidths);
  }
  if (view.countTypes && typeof view.countTypes === 'object' && !Array.isArray(view.countTypes) && Object.keys(view.countTypes).length) {
    out.countTypes = _cloneTemplateData(view.countTypes);
  }
  if (Array.isArray(view.advancedFilters) && view.advancedFilters.length) out.advancedFilters = _cloneTemplateData(view.advancedFilters);
  if (view.columnValueFilters && typeof view.columnValueFilters === 'object' && Object.keys(view.columnValueFilters).length) {
    out.columnValueFilters = _cloneTemplateData(view.columnValueFilters);
  }
  if (view.sortConfig != null) out.sortConfig = _cloneTemplateData(view.sortConfig);
  if (view.conditionalFormat) out.conditionalFormat = true;
  if (view.conditionalColors && typeof view.conditionalColors === 'object' && Object.keys(view.conditionalColors).length) {
    out.conditionalColors = _cloneTemplateData(view.conditionalColors);
  }
  if (view.showFooter) out.showFooter = true;
  if (view.entityColumnPinned === false) out.entityColumnPinned = false;
  if (view.thumbnailSize && view.thumbnailSize !== 'small') out.thumbnailSize = view.thumbnailSize;
  const typeSpecific = _sanitizeDbTemplateTypeSpecific(view.typeSpecific);
  if (Object.keys(typeSpecific).length) out.typeSpecific = typeSpecific;
  return out;
}

/**
 * 現在のビュー設定から、テンプレートへ保存する savedViews 配列を生成する。
 * ビューが無い（または全て空相当）場合は null を返す。
 */
function exportDbTemplateSavedViews(cfg) {
  if (!cfg || !Array.isArray(cfg.savedViews) || !cfg.savedViews.length) return null;
  const sanitized = cfg.savedViews
    .map((view) => _sanitizeDbTemplateSavedView(view))
    .filter(Boolean);
  return sanitized.length ? sanitized : null;
}

/* --- savedViews のマージ適用 --- */

function _dbTemplateSavedViewKey(view) {
  return String(view?.name || '') + ' ' + String(view?.viewMode || 'pivot');
}

function _dbTemplateAppendLegacyViewFields(view, template, overwrite) {
  if (!view || typeof view !== 'object') return;
  if (!Array.isArray(view.colOrder)) view.colOrder = [];
  if (template.colOrder) {
    template.colOrder.forEach((col) => {
      if (!view.colOrder.includes(col)) view.colOrder.push(col);
    });
  }
  if (!view.colWidths || typeof view.colWidths !== 'object' || Array.isArray(view.colWidths)) view.colWidths = {};
  if (template.colWidths) {
    Object.entries(template.colWidths).forEach(([k, v]) => {
      if (!view.colWidths[k] || overwrite) view.colWidths[k] = v;
    });
  }
  if (!view.countTypes || typeof view.countTypes !== 'object' || Array.isArray(view.countTypes)) view.countTypes = {};
  if (template.countTypes) {
    Object.entries(template.countTypes).forEach(([k, v]) => {
      if (!view.countTypes[k] || overwrite) view.countTypes[k] = v;
    });
  }
}

/**
 * テンプレートの savedViews を現在の設定へマージ適用する（加算方式）。
 * - name+viewMode が一致する既存ビューはスキップ（overwrite 時はフィールドを上書き）
 * - name のみ一致する場合は「名前 2」のように連番で一意化して追加
 * - colOrder/colWidths/countTypes の旧形式フィールドの追補は、
 *   適用前から存在していたビューにのみ行う（新規追加ビューはテンプレート側の値をそのまま使う）
 * @returns {boolean} savedViews パスを使ったか（false の場合は呼び出し元が旧パスへフォールバックする）
 */
function _applyDbTemplateSavedViews(cfg, template, overwrite) {
  if (!template || !Array.isArray(template.savedViews)) return false;
  if (!Array.isArray(cfg.savedViews)) cfg.savedViews = [];
  const existingViews = cfg.savedViews.slice();
  const existingByKey = new Map();
  const existingNames = new Set();
  existingViews.forEach((view) => {
    if (!view) return;
    existingByKey.set(_dbTemplateSavedViewKey(view), view);
    existingNames.add(String(view.name || ''));
  });

  let added = 0;
  let skipped = 0;
  template.savedViews.forEach((rawView) => {
    const sanitized = _sanitizeDbTemplateSavedView(rawView);
    if (!sanitized) return;
    const key = _dbTemplateSavedViewKey(sanitized);
    const existing = existingByKey.get(key);
    if (existing) {
      skipped++;
      if (overwrite) {
        const name = existing.name;
        const viewMode = existing.viewMode;
        Object.assign(existing, _cloneTemplateData(sanitized));
        existing.name = name;
        existing.viewMode = viewMode;
        const idx = cfg.savedViews.indexOf(existing);
        cfg.savedViews[idx] = _normalizeDbTemplateView(existing, cfg, idx);
      }
      return;
    }
    let uniqueName = sanitized.name;
    let suffix = 2;
    while (existingNames.has(uniqueName)) {
      uniqueName = sanitized.name + ' ' + suffix;
      suffix++;
    }
    sanitized.name = uniqueName;
    existingNames.add(uniqueName);
    const normalized = _normalizeDbTemplateView(sanitized, cfg, cfg.savedViews.length);
    cfg.savedViews.push(normalized);
    existingByKey.set(_dbTemplateSavedViewKey(normalized), normalized);
    added++;
  });

  // 旧形式フィールド（テンプレート直下の colOrder/colWidths/countTypes）の追補は
  // 「適用前から存在していたビュー」だけに行う。新規追加ビューはテンプレートの
  // savedViews 側にすでに完全な情報を持つため、二重適用しない。
  existingViews.forEach((view) => _dbTemplateAppendLegacyViewFields(view, template, overwrite));

  if (!Number.isInteger(cfg.currentViewIdx) || cfg.currentViewIdx < 0 || cfg.currentViewIdx >= cfg.savedViews.length) {
    cfg.currentViewIdx = 0;
  }
  cfg._dbTemplateViewsResult = { added, skipped };
  return true;
}
