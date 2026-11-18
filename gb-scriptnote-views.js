/* gb-scriptnote-views.js: シナリオのビュー
   ツールバー下のビュータブ（共通部品 MeldexViewTabs）で、絞り込みと「追加・削除の単位」を
   ビューとして切り替える。ビューはシナリオファイル内（doc.views / doc.activeViewId）に保存する。
   旧形式の文書はビューを持たないため、開いた時に「すべて」と、この端末に保存されていた
   フィルタプリセット（旧機能）からビューを作る（保存は次に文書を保存した時）。
   旧版はこの2項目を知らないので読み飛ばす（追加のみの変更）。 */

const SN2_VIEW_ALL_ID = 'view-all';
const SN2_LEGACY_FILTER_PRESETS_KEY = 'sn2-filter-presets';
const SN2_LEGACY_FILTER_PRESETS_ORDER_KEY = 'sn2-filter-presets-order';

function _sn2NewViewId() {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `view-${random}`;
}

function _sn2NameList(value) {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.map(item => String(item ?? '')))];
}

// 絞り込み条件を保存形式へ正規化する。何も絞り込まない時は null。
function _sn2NormalizeViewFilter(filter) {
  if (!filter || typeof filter !== 'object') return null;
  const visible = _sn2NameList(filter.visible);
  const hidden = _sn2NameList(filter.hidden) || [];
  const visibleStatuses = _sn2NameList(filter.visibleStatuses);
  const hiddenStatuses = _sn2NameList(filter.hiddenStatuses) || [];
  if (!visible && !hidden.length && !visibleStatuses && !hiddenStatuses.length) return null;
  return { visible, hidden, visibleStatuses, hiddenStatuses };
}

// 利用者が選んだビューのアイコン（GBIconAssets の指定）。未設定・不正値は '' = 既定アイコン。
function _sn2NormalizeViewIcon(value) {
  if (typeof value !== 'string') return '';
  const spec = value.trim();
  return spec && spec.length <= 1024 ? spec : '';
}

function _sn2NormalizeView(view, index) {
  const source = view && typeof view === 'object' ? view : {};
  const icon = _sn2NormalizeViewIcon(source.icon);
  return {
    id: String(source.id || (index === 0 ? SN2_VIEW_ALL_ID : _sn2NewViewId())),
    name: String(source.name || '').trim() || (index === 0 ? 'すべて' : `ビュー${index + 1}`),
    filter: _sn2NormalizeViewFilter(source.filter),
    editUnit: source.editUnit === 'page' ? 'page' : 'row',
    // 追加フィールド（旧版は読み飛ばす）。未設定の時は書かない。
    ...(icon ? { icon } : {}),
  };
}

// 旧機能「フィルタプリセット」（端末の保存領域・全シナリオ共通）をビューの元にする。
function _sn2LegacyFilterPresetViews() {
  let presets = {};
  let order = [];
  try { presets = JSON.parse(localStorage.getItem(SN2_LEGACY_FILTER_PRESETS_KEY) || '{}') || {}; } catch { presets = {}; }
  try { order = JSON.parse(localStorage.getItem(SN2_LEGACY_FILTER_PRESETS_ORDER_KEY) || '[]') || []; } catch { order = []; }
  if (!presets || typeof presets !== 'object' || Array.isArray(presets)) return [];
  const names = [
    ...order.filter(name => Object.prototype.hasOwnProperty.call(presets, name)),
    ...Object.keys(presets).filter(name => !order.includes(name)),
  ];
  return names.map(name => {
    const preset = presets[name];
    const filter = Array.isArray(preset)
      ? { visible: preset, hidden: [], visibleStatuses: null, hiddenStatuses: [] }
      : {
        visible: preset?.visible ?? null,
        hidden: preset?.hidden || [],
        visibleStatuses: Object.prototype.hasOwnProperty.call(preset || {}, 'visibleStatuses') ? preset.visibleStatuses : null,
        hiddenStatuses: preset?.hiddenStatuses || [],
      };
    return { id: _sn2NewViewId(), name: String(name), filter: _sn2NormalizeViewFilter(filter), editUnit: 'row' };
  });
}

Object.assign(ScriptNoteEditor.prototype, {

  _ensureScenarioViews() {
    if (!this.doc) return [];
    if (!Array.isArray(this.doc.views) || !this.doc.views.length) {
      this.doc.views = [
        { id: SN2_VIEW_ALL_ID, name: 'すべて', filter: null, editUnit: 'row' },
        ..._sn2LegacyFilterPresetViews(),
      ];
    }
    const seen = new Set();
    this.doc.views = this.doc.views.map((view, index) => {
      const normalized = _sn2NormalizeView(view, index);
      if (seen.has(normalized.id)) normalized.id = _sn2NewViewId();
      seen.add(normalized.id);
      return normalized;
    });
    if (!this.doc.views.some(view => view.id === this.doc.activeViewId)) this.doc.activeViewId = this.doc.views[0].id;
    return this.doc.views;
  },

  _activeScenarioView() {
    const views = this._ensureScenarioViews();
    return views.find(view => view.id === this.doc?.activeViewId) || views[0] || null;
  },

  // 表示中のビューの「追加・削除の単位」。'page' の時は行の追加・削除をページ単位で行う。
  _scenarioViewEditUnit() {
    return this._activeScenarioView()?.editUnit === 'page' ? 'page' : 'row';
  },

  _captureScenarioViewFilter() {
    const statusEnabled = !!this.doc?.editor?.statusEnabled;
    return _sn2NormalizeViewFilter({
      visible: this._filterRoles ? [...this._filterRoles] : null,
      hidden: this._hideRoles ? [...this._hideRoles] : [],
      visibleStatuses: statusEnabled && this._filterStatuses ? [...this._filterStatuses] : null,
      hiddenStatuses: statusEnabled && this._hideStatuses ? [...this._hideStatuses] : [],
    });
  },

  _applyScenarioViewFilter(view, { render = true } = {}) {
    const filter = view?.filter || null;
    const statusEnabled = !!this.doc?.editor?.statusEnabled;
    // 同じ絞り込みなら描き直さない（読み込み直後の二重描画を避ける）。
    if (JSON.stringify(this._captureScenarioViewFilter()) === JSON.stringify(_sn2NormalizeViewFilter(filter))) {
      this._syncFilterButtonState?.();
      return;
    }
    this._filterRoles = filter?.visible ? new Set(filter.visible) : null;
    this._hideRoles = filter?.hidden?.length ? new Set(filter.hidden) : null;
    this._filterStatuses = statusEnabled && filter?.visibleStatuses ? new Set(filter.visibleStatuses) : null;
    this._hideStatuses = statusEnabled && filter?.hiddenStatuses?.length ? new Set(filter.hiddenStatuses) : null;
    if (render) {
      this._calcCache = null;
      this._render();
    }
    this._syncFilterButtonState?.();
  },

  // ビューの切替は表示の切替なので、取り消し履歴にも未保存表示にも入れない
  // （表示中のビューは次に保存した時に一緒に記録される）。
  _activateScenarioView(viewId) {
    const view = this._ensureScenarioViews().find(item => item.id === viewId);
    if (!view) return false;
    if (this._cellEditMode) this._exitEditMode?.();
    this._clearActiveCell?.();
    this._gridCellSelection?.clear?.();
    this.doc.activeViewId = view.id;
    this._applyScenarioViewFilter(view);
    this._refreshScenarioViewTabs();
    return true;
  },

  // フィルタメニューでの変更を、表示中のビューの絞り込みとして保存する。
  _onScenarioFilterChanged() {
    const view = this._activeScenarioView();
    if (!view || this._readOnly) return;
    const next = this._captureScenarioViewFilter();
    if (JSON.stringify(next) === JSON.stringify(view.filter || null)) return;
    this._pushUndo('ビューの絞り込み変更');
    view.filter = next;
    this._markDirty({ skipUndo: true });
    this._refreshScenarioViewTabs();
  },

  _mutateScenarioViews(label, mutate) {
    if (this._readOnly || !this.doc) return false;
    this._ensureScenarioViews();
    this._pushUndo(label);
    const result = mutate(this.doc.views);
    this._ensureScenarioViews();
    this._markDirty({ skipUndo: true });
    this._refreshScenarioViewTabs();
    return result;
  },

  _uniqueScenarioViewName(base) {
    const names = new Set(this._ensureScenarioViews().map(view => view.name));
    if (!names.has(base)) return base;
    let index = 2;
    while (names.has(`${base}${index}`)) index += 1;
    return `${base}${index}`;
  },

  _addScenarioView({ fromCurrent = false } = {}) {
    const view = {
      id: _sn2NewViewId(),
      name: this._uniqueScenarioViewName('ビュー'),
      filter: fromCurrent ? this._captureScenarioViewFilter() : null,
      editUnit: fromCurrent ? this._scenarioViewEditUnit() : 'row',
    };
    this._mutateScenarioViews('ビュー追加', views => { views.push(view); });
    this._activateScenarioView(view.id);
    return view;
  },

  _duplicateScenarioView(viewId) {
    const source = this._ensureScenarioViews().find(view => view.id === viewId);
    if (!source) return null;
    const copy = { ...JSON.parse(JSON.stringify(source)), id: _sn2NewViewId(), name: this._uniqueScenarioViewName(`${source.name} のコピー`) };
    this._mutateScenarioViews('ビュー複製', views => {
      views.splice(views.findIndex(view => view.id === viewId) + 1, 0, copy);
    });
    this._activateScenarioView(copy.id);
    return copy;
  },

  _renameScenarioView(viewId, name) {
    const next = String(name || '').trim();
    if (!next) throw new Error('ビュー名を入力してください');
    if (this._ensureScenarioViews().some(view => view.id !== viewId && view.name === next)) {
      throw new Error('同じ名前のビューがあります');
    }
    return this._mutateScenarioViews('ビュー名変更', views => {
      const view = views.find(item => item.id === viewId);
      if (view) view.name = next;
    });
  },

  _moveScenarioView(viewId, toIndex) {
    return this._mutateScenarioViews('ビュー並べ替え', views => {
      const from = views.findIndex(view => view.id === viewId);
      if (from < 0) return;
      const [view] = views.splice(from, 1);
      views.splice(Math.max(0, Math.min(views.length, toIndex)), 0, view);
    });
  },

  _deleteScenarioView(viewId) {
    const views = this._ensureScenarioViews();
    if (views.length <= 1) return false;
    const wasActive = this.doc.activeViewId === viewId;
    this._mutateScenarioViews('ビュー削除', list => {
      const index = list.findIndex(view => view.id === viewId);
      if (index >= 0) list.splice(index, 1);
    });
    if (wasActive) this._activateScenarioView(this.doc.views[0].id);
    return true;
  },

  _setScenarioViewEditUnit(viewId, unit) {
    return this._mutateScenarioViews('ビューの操作単位変更', views => {
      const view = views.find(item => item.id === viewId);
      if (view) view.editUnit = unit === 'page' ? 'page' : 'row';
    });
  },

  // ビューのアイコンを変える（spec='' で既定に戻す）。文書の取り消し履歴と保存に載せる。
  _setScenarioViewIcon(viewId, spec) {
    const view = this._ensureScenarioViews().find(item => item.id === viewId);
    if (!view) return false;
    const next = _sn2NormalizeViewIcon(typeof MeldexViewTabs !== 'undefined' && MeldexViewTabs.normalizeIconSpec
      ? MeldexViewTabs.normalizeIconSpec(spec) : spec);
    if ((view.icon || '') === next) return false;
    return this._mutateScenarioViews('ビューのアイコン変更', views => {
      const target = views.find(item => item.id === viewId);
      if (!target) return;
      if (next) target.icon = next;
      else delete target.icon;
    }) !== false;
  },

  // タイプ・キャラの改名に合わせて、各ビューの絞り込み条件の名前も付け替える。
  _renameScenarioViewRoles(renamed) {
    if (!(renamed instanceof Map) || !renamed.size || !Array.isArray(this.doc?.views)) return;
    this.doc.views.forEach(view => {
      const filter = view?.filter;
      if (!filter) return;
      for (const key of ['visible', 'hidden']) {
        if (Array.isArray(filter[key])) filter[key] = filter[key].map(name => renamed.get(name) ?? name);
      }
    });
  },

  _refreshScenarioViewTabs() {
    this._viewTabs?.refresh?.();
  },

  // ツールバー直下にビュータブを置く。読み込み・再読み込みのたびに呼ばれる。
  _mountScenarioViewTabs(anchor) {
    if (!anchor?.parentNode || typeof MeldexViewTabs === 'undefined') return null;
    this._ensureScenarioViews();
    if (!this._viewTabs || !this._viewTabs.element.isConnected) {
      this._viewTabs?.element?.remove?.();
      this._viewTabs = MeldexViewTabs.create({
        e2ePrefix: 'scriptnote-view',
        ariaLabel: 'シナリオのビュー',
        readOnly: () => !!this._readOnly,
        getViews: () => this._ensureScenarioViews().map(view => ({
          id: view.id,
          name: view.name,
          icon: view.editUnit === 'page' ? 'bookOpen' : (view.filter ? 'funnel' : 'table'),
          customIcon: view.icon || '',
        })),
        getActiveId: () => this._activeScenarioView()?.id,
        onActivate: id => this._activateScenarioView(id),
        onRename: (id, name) => this._renameScenarioView(id, name),
        onDuplicate: id => this._duplicateScenarioView(id),
        onMove: (id, index) => this._moveScenarioView(id, index),
        onDelete: id => this._deleteScenarioView(id),
        onChangeIcon: (id, spec) => this._setScenarioViewIcon(id, spec),
        viewMenuItems: view => {
          const current = this._ensureScenarioViews().find(item => item.id === view.id);
          return [
            { id: 'unit-row', label: '追加・削除は行単位', checked: current?.editUnit !== 'page',
              run: () => this._setScenarioViewEditUnit(view.id, 'row') },
            { id: 'unit-page', label: '追加・削除はページ単位', checked: current?.editUnit === 'page',
              run: () => this._setScenarioViewEditUnit(view.id, 'page') },
          ];
        },
        addMenuItems: () => [
          { id: 'add-current', label: '現在の絞り込みで追加', icon: 'funnel', run: () => this._addScenarioView({ fromCurrent: true }) },
          { id: 'add-all', label: 'すべて表示のビューを追加', icon: 'table', run: () => this._addScenarioView() },
        ],
      });
      this._viewTabs.element.classList.add('sn2-view-tabs');
      anchor.parentNode.insertBefore(this._viewTabs.element, anchor.nextSibling);
    }
    this._applyScenarioViewFilter(this._activeScenarioView());
    this._viewTabs.refresh();
    return this._viewTabs;
  },
});
