/* gb-entity-props-panel.js:
   renderEntityPropsGridInto (gb-editor.part02.part01.js) が描画する列一覧の
   ヘッダー行 (開閉トグル + 列幅設定) を担当する。

   - 開閉: プロパティ本体 (並び替えツールバー + グループ見出し + カード一式) の表示/非表示を切り替える
   - 列幅: プロパティカードの最小列幅 (CSS変数 --entity-prop-col-width) を設定する

   状態は dbPath (エントリの親フォルダ) 単位で view_config へ保存する (getDbViewConfig/saveDbViewConfig
   は呼ぶだけで gb-app 側は編集しない)。renderEntityPropsGridInto はフルページ版(#entity-props-grid)・
   サブパネル版・モバイルドロワーの3表示先すべてから共有で呼ばれるため、
   ここに実装すれば自動的に3箇所へ反映される。
   dbPath が解決できないエントリ (親フォルダがシートではない等) ではセッション内のみの
   フォールバック状態を使い、保存もエラーも出さない。 */

const ENTITY_PROP_COL_WIDTH_MIN = 150;
const ENTITY_PROP_COL_WIDTH_MAX = 600;
const ENTITY_PROP_COL_WIDTH_STEP = 10;
const ENTITY_PROP_COL_WIDTH_DEFAULT = 300;

// dbPath が無いエントリ用のセッション内 (非永続) フォールバック状態。key: entityPath
const _entityPropsSessionState = {};

function _clampEntityPropColWidth(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return ENTITY_PROP_COL_WIDTH_DEFAULT;
  return Math.max(ENTITY_PROP_COL_WIDTH_MIN, Math.min(ENTITY_PROP_COL_WIDTH_MAX, Math.round(n)));
}

function _entityPropsSessionKey(entityPath) {
  return 'entity:' + (entityPath || '');
}

// 現在の開閉状態・列幅を返す。dbPath があれば view_config、無ければセッション内状態を参照する。
function _entityPropsViewState(dbPath, entityPath) {
  if (dbPath && typeof getDbViewConfig === 'function') {
    const cfg = getDbViewConfig(dbPath) || {};
    return {
      collapsed: !!cfg.entityPropsCollapsed,
      colWidth: _clampEntityPropColWidth(cfg.entityPropsColWidth),
    };
  }
  const local = _entityPropsSessionState[_entityPropsSessionKey(entityPath)] || {};
  return {
    collapsed: !!local.collapsed,
    colWidth: _clampEntityPropColWidth(local.colWidth),
  };
}

function _setEntityPropsCollapsed(dbPath, entityPath, collapsed, options = {}) {
  const next = !!collapsed;
  if (dbPath && typeof getDbViewConfig === 'function' && typeof saveDbViewConfig === 'function') {
    const cfg = getDbViewConfig(dbPath);
    cfg.entityPropsCollapsed = next;
    saveDbViewConfig(dbPath, cfg, {
      historyLabel: '列一覧: 開閉',
      historyDetail: next ? '折りたたみ' : '展開',
      skipHistory: options.skipHistory === true,
    });
    return;
  }
  const key = _entityPropsSessionKey(entityPath);
  _entityPropsSessionState[key] = { ..._entityPropsSessionState[key], collapsed: next };
}

function _setEntityPropsColWidth(dbPath, entityPath, widthPx, options = {}) {
  const next = _clampEntityPropColWidth(widthPx);
  if (dbPath && typeof getDbViewConfig === 'function' && typeof saveDbViewConfig === 'function') {
    const cfg = getDbViewConfig(dbPath);
    cfg.entityPropsColWidth = next;
    saveDbViewConfig(dbPath, cfg, {
      historyLabel: '列一覧: 列幅',
      historyDetail: next + 'px',
      skipHistory: options.skipHistory === true,
    });
    return next;
  }
  const key = _entityPropsSessionKey(entityPath);
  _entityPropsSessionState[key] = { ..._entityPropsSessionState[key], colWidth: next };
  return next;
}

function _closeEntityPropsColWidthPopup() {
  document.querySelectorAll('.entity-props-col-width-popup').forEach(el => {
    if (typeof el._cleanup === 'function') el._cleanup();
    el.remove();
  });
}

// ヘッダー行 (プロパティラベル + 開閉シェブロン + 列幅設定ボタン) を生成する。
// grid/data/entityPath/options は開閉トグル時に renderEntityPropsGridInto を再実行するための closure。
function _buildEntityPropsHeader(grid, data, entityPath, options, dbPath, hasProps, viewState) {
  const header = document.createElement('div');
  header.className = 'entity-props-header';
  header.dataset.e2eId = 'entity-props-header';
  // プロパティが0件の場合は現状の挙動 (実質空表示) を踏襲してヘッダーごと隠す
  if (!hasProps) header.style.display = 'none';

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'entity-props-toggle';
  toggleBtn.dataset.e2eId = 'entity-props-toggle';
  toggleBtn.setAttribute('aria-expanded', viewState.collapsed ? 'false' : 'true');
  const toggleLabel = viewState.collapsed ? '列一覧を開く' : '列一覧を閉じる';
  toggleBtn.title = toggleLabel;
  toggleBtn.setAttribute('aria-label', toggleLabel);

  const chevron = document.createElement('span');
  chevron.className = 'entity-props-toggle-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = typeof lucide === 'function' ? lucide('chevronRight', 14) : '›';
  toggleBtn.appendChild(chevron);

  const label = document.createElement('span');
  label.className = 'entity-props-header-label';
  label.textContent = '列一覧';
  toggleBtn.appendChild(label);

  toggleBtn.addEventListener('click', () => {
    _closeEntityPropsColWidthPopup();
    if (typeof _epsClosePopup === 'function') _epsClosePopup();
    const cur = _entityPropsViewState(dbPath, entityPath);
    _setEntityPropsCollapsed(dbPath, entityPath, !cur.collapsed);
    if (typeof renderEntityPropsGridInto === 'function') renderEntityPropsGridInto(grid, data, entityPath, options);
    grid.querySelector?.('[data-e2e-id="entity-props-toggle"]')?.focus?.({ preventScroll: true });
  });
  header.appendChild(toggleBtn);

  const widthBtn = document.createElement('button');
  widthBtn.type = 'button';
  widthBtn.className = 'entity-props-col-width-btn gb-btn gb-btn-sm gb-btn-icon';
  widthBtn.dataset.e2eId = 'entity-props-col-width-btn';
  widthBtn.title = '列一覧の列幅を設定';
  widthBtn.setAttribute('aria-label', '列一覧の列幅を設定');
  widthBtn.setAttribute('aria-haspopup', 'dialog');
  widthBtn.innerHTML = typeof lucide === 'function' ? lucide('slidersHorizontal', 14) : '⚙';
  widthBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    _showEntityPropsColWidthPopup(widthBtn, grid, dbPath, entityPath);
  });
  header.appendChild(widthBtn);

  return header;
}

// 列幅設定ポップアップ。number入力は即時プレビュー(CSS変数setProperty)し、
// change/Enter/リセットで view_config へ確定保存する。
function _showEntityPropsColWidthPopup(anchorBtn, grid, dbPath, entityPath) {
  _closeEntityPropsColWidthPopup();
  const viewState = _entityPropsViewState(dbPath, entityPath);

  const popup = document.createElement('div');
  popup.className = 'gb-context-menu entity-props-col-width-popup';
  popup.dataset.e2eId = 'entity-props-col-width-popup';

  const title = document.createElement('div');
  title.className = 'entity-props-col-width-popup-title';
  title.textContent = '列幅';
  popup.appendChild(title);

  const row = document.createElement('label');
  row.className = 'entity-props-col-width-popup-row';
  const rowLabel = document.createElement('span');
  rowLabel.textContent = '列の最小幅 (px)';
  row.appendChild(rowLabel);

  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(ENTITY_PROP_COL_WIDTH_MIN);
  input.max = String(ENTITY_PROP_COL_WIDTH_MAX);
  input.step = String(ENTITY_PROP_COL_WIDTH_STEP);
  input.value = String(viewState.colWidth);
  input.dataset.e2eId = 'entity-props-col-width-input';
  row.appendChild(input);
  popup.appendChild(row);

  const preview = (raw) => {
    const clamped = _clampEntityPropColWidth(raw);
    grid.style.setProperty('--entity-prop-col-width', clamped + 'px');
    return clamped;
  };
  const commit = () => {
    const clamped = preview(input.value);
    input.value = String(clamped);
    _setEntityPropsColWidth(dbPath, entityPath, clamped);
    return clamped;
  };
  input.addEventListener('input', () => { preview(input.value); });
  input.addEventListener('change', commit);

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'gb-btn gb-btn-sm';
  resetBtn.dataset.e2eId = 'entity-props-col-width-reset';
  resetBtn.textContent = '既定に戻す';
  resetBtn.addEventListener('click', () => {
    input.value = String(ENTITY_PROP_COL_WIDTH_DEFAULT);
    commit();
    input.focus();
  });
  popup.appendChild(resetBtn);

  document.body.appendChild(popup);

  const cleanupFns = [];
  popup._cleanup = () => { cleanupFns.splice(0).forEach(off => off()); };
  const closePopup = () => {
    popup._cleanup();
    popup.remove();
    if (typeof focusMeldexDropdownTrigger === 'function') focusMeldexDropdownTrigger(anchorBtn);
    else { try { anchorBtn?.focus?.(); } catch { /* ignore */ } }
  };

  if (typeof attachMeldexDropdownCloseButton === 'function') {
    attachMeldexDropdownCloseButton(popup, {
      trigger: anchorBtn,
      className: 'entity-props-col-width-popup-close',
      attr: 'data-entity-props-col-width-close',
      close: closePopup,
    });
  }

  if (typeof positionPopup === 'function') {
    positionPopup(popup, anchorBtn.getBoundingClientRect(), { gap: 4 });
  } else {
    const rect = anchorBtn.getBoundingClientRect();
    const z = typeof _getZoom === 'function' ? _getZoom() : 1;
    popup.style.left = (rect.left / z) + 'px';
    popup.style.top = (rect.bottom / z + 4) + 'px';
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(popup);
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePopup();
    }
  });

  setTimeout(() => {
    const onPointerDown = (ev) => {
      if (!popup.contains(ev.target) && ev.target !== anchorBtn && !anchorBtn.contains(ev.target)) closePopup();
    };
    document.addEventListener('pointerdown', onPointerDown);
    cleanupFns.push(() => document.removeEventListener('pointerdown', onPointerDown));
  }, 0);

  requestAnimationFrame(() => {
    try { input.focus({ preventScroll: true }); input.select(); } catch { input.focus(); }
  });
}
