/* gb-db-table-display.js — シートのセル表示設定（折返し/切り詰め・最大行数・画像サムネ数）と
   テーブル自動列幅を担当する。gb-db-table.js（1603行あった part03）から表示責務を分離した
   ファイル。シート表示・ビュー状態計画 2026-08-04 で実装。

   このファイルの関数はプロジェクト全体の慣習どおりグローバル関数として宣言する
   （gb-db-props.part0X.js・gb-db-timeline.part01.js 等、他ファイルからそのまま呼び出される
   ため、IIFEで閉じない）。 */

function _dbClampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// セル表示（値の最大行数・折返し/切り詰め）はビュー単位で保持する。旧データはビュー側に
// 未設定のため、その場合だけルート（DB全体）の cellTextOverflow/cellWrapLines へフォールバックする
// （破壊的移行はしない。新規の書込みは常にビュー側へ行う＝setDbCellTextDisplay 参照）。
function _dbCellDisplayConfig(dbPath, ctx = null) {
  const cfg = getDbViewConfig(dbPath);
  const view = typeof getCurrentDbViewConfigEntry === 'function' ? getCurrentDbViewConfigEntry(dbPath, { ctx }) : null;
  const overflowSource = (view && Object.prototype.hasOwnProperty.call(view, 'cellTextOverflow'))
    ? view.cellTextOverflow
    : cfg.cellTextOverflow;
  const linesSource = (view && Object.prototype.hasOwnProperty.call(view, 'cellWrapLines'))
    ? view.cellWrapLines
    : cfg.cellWrapLines;
  const overflow = overflowSource === 'clip' ? 'clip' : 'wrap';
  const lines = _dbClampInt(linesSource, 1, 20, 10);
  return { overflow, lines };
}

// 列単位のセル折返し/切り詰め上書き。
// cellDisplayByColMap（現在の保存済みビューの cellDisplayByCol）に該当キーが無ければ
// シート全体設定を継承する状態を表す null を返す。
function _dbColumnCellOverrideEntry(cellDisplayByColMap, propName) {
  const entry = cellDisplayByColMap && typeof cellDisplayByColMap === 'object' ? cellDisplayByColMap[propName] : null;
  if (!entry || typeof entry !== 'object') return null;
  if (entry.overflow !== 'wrap' && entry.overflow !== 'clip') return null;
  return { overflow: entry.overflow, lines: _dbClampInt(entry.lines, 1, 20, 10) };
}

function _dbColumnCellDisplayMap(dbPath, ctx = null) {
  const root = getDbViewConfig(dbPath);
  const view = typeof getCurrentDbViewConfigEntry === 'function'
    ? getCurrentDbViewConfigEntry(dbPath, { ctx })
    : null;
  if (view && Object.prototype.hasOwnProperty.call(view, 'cellDisplayByCol')) {
    return view.cellDisplayByCol;
  }
  return root?.cellDisplayByCol;
}

// 列メニュー等の単発参照用（dbPath から都度 getDbViewConfig するため、renderPivot の描画ループ内では使わない。
// ループ内は renderPivot が一度だけ取得した cellDisplayByCol マップを options 経由で渡す）
function getDbColumnCellDisplay(dbPath, propName, ctx = null) {
  if (!dbPath || !propName) return null;
  return _dbColumnCellOverrideEntry(_dbColumnCellDisplayMap(dbPath, ctx), propName);
}

function _dbHasColumnCellDisplayOverrides(dbPath, ctx = null) {
  const map = _dbColumnCellDisplayMap(dbPath, ctx);
  return !!(map && typeof map === 'object' && Object.keys(map).length);
}

function syncDbCellDisplayToolbar(dbPath, ctx = null) {
  const btn = document.getElementById('btn-db-cell-wrap') || document.getElementById('sheet-tb-cell-wrap');
  if (!btn) return;
  const cfg = _dbCellDisplayConfig(dbPath, ctx);
  const imgCount = typeof getCellImageThumbCount === 'function' ? getCellImageThumbCount(dbPath, { ctx }) : 3;
  const active = cfg.overflow === 'wrap';
  const iconName = active ? 'wrapText' : 'scissors';
  btn.classList.toggle('active', active);
  btn.innerHTML = (typeof lucide === 'function') ? lucide(iconName, 16) : '';
  const activeCtx = ctx || (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  const hasColumnOverrides = _dbHasColumnCellDisplayOverrides(dbPath, activeCtx);
  const baseTitle = active ? `セル表示: 折り返し (${cfg.lines}行まで・画像${imgCount}枚まで)` : `セル表示: 切り詰め (画像${imgCount}枚まで)`;
  btn.title = baseTitle + (hasColumnOverrides ? '（一部の列は個別設定）' : '');
  btn.setAttribute('aria-label', btn.title);
}

// 列ごとのセル折返し/切り詰めを設定する。overflow に null を渡すとその列の上書きを削除し、
// シート全体設定（cellTextOverflow / cellWrapLines）へ継承を戻す。
function setDbColumnCellTextDisplay(dbPath, propName, overflow, lines, options = {}) {
  if (!dbPath || !propName) return;
  const cfg = getDbViewConfig(dbPath);
  const target = typeof _getCurrentDbViewConfigEntryFromConfig === 'function'
    ? (_getCurrentDbViewConfigEntryFromConfig(cfg, { ctx: options.ctx }) || cfg)
    : cfg;
  const inherited = target !== cfg
    && !Object.prototype.hasOwnProperty.call(target, 'cellDisplayByCol')
    && cfg.cellDisplayByCol
    && typeof cfg.cellDisplayByCol === 'object'
    ? cfg.cellDisplayByCol
    : null;
  const source = target.cellDisplayByCol || inherited;
  const byCol = (source && typeof source === 'object')
    ? { ...source }
    : {};
  const prevLines = byCol[propName]?.lines;
  let detail;
  if (overflow == null) {
    delete byCol[propName];
    detail = `${propName}: シート設定に従う`;
  } else {
    const nextOverflow = overflow === 'clip' ? 'clip' : 'wrap';
    const nextLines = _dbClampInt(lines, 1, 20, prevLines || 10);
    byCol[propName] = { overflow: nextOverflow, lines: nextLines };
    detail = `${propName}: ${nextOverflow === 'wrap' ? `折り返し(${nextLines}行)` : '切り詰め'}`;
  }
  if (Object.keys(byCol).length) target.cellDisplayByCol = byCol;
  else if (target !== cfg && cfg.cellDisplayByCol) target.cellDisplayByCol = {};
  else delete target.cellDisplayByCol;
  saveDbViewConfig(dbPath, cfg, {
    historyLabel: options.label || 'シート表示: 列のセル表示',
    historyDetail: detail,
    skipHistory: options.skipHistory === true,
    ctx: options.ctx,
  });
  const ctx = options.ctx
    || (typeof _dbPaneContextFromEvent === 'function' ? _dbPaneContextFromEvent(options.event, { dbPath }) : null)
    || (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  if (typeof _renderCurrentDbView === 'function') _renderCurrentDbView(ctx, dbPath);
  else if (typeof renderPivot === 'function') renderPivot(ctx);
}

// シート全体（＝現在の保存ビュー）のセル表示（折返し/切り詰め・最大行数）を設定する。
// 保存ビューごとに保持するため、現在のビューエントリへ書き込む（旧データのルート値は
// フォールバック読み込みにのみ使う。_dbCellDisplayConfig 参照）。
function setDbCellTextDisplay(dbPath, overflow, lines, options = {}) {
  if (!dbPath) return;
  const current = _dbCellDisplayConfig(dbPath, options.ctx);
  const nextOverflow = overflow === 'clip' ? 'clip' : 'wrap';
  const nextLines = _dbClampInt(lines, 1, 20, current.lines || 10);
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: セル表示', options.detail || (nextOverflow === 'wrap' ? `${nextLines}行` : '切り詰め'), options, (v) => {
    v.cellTextOverflow = nextOverflow;
    v.cellWrapLines = nextLines;
  });
  const ctx = options.ctx
    || (typeof _dbPaneContextFromEvent === 'function' ? _dbPaneContextFromEvent(options.event, { dbPath }) : null)
    || (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  if (typeof _renderCurrentDbView === 'function') _renderCurrentDbView(ctx, dbPath);
  else if (typeof renderPivot === 'function') renderPivot(ctx);
}

function setDbCommonTagsDisplayLimit(dbPath, value, options = {}) {
  if (!dbPath) return 10;
  const cfg = getDbViewConfig(dbPath);
  const fallback = window.MeldexTagDisplayPreferences?.legacyLimit?.() || 10;
  const next = window.MeldexTagDisplayPreferences?.normalizeLimit?.(value, fallback) || fallback;
  cfg.commonTagsDisplayLimit = next;
  saveDbViewConfig(dbPath, cfg, {
    historyLabel: 'シート表示: タグ表示数',
    historyDetail: `${next}件`,
    skipHistory: options.skipHistory === true,
  });
  window.dispatchEvent?.(new CustomEvent('meldex:sheet-tag-display-limit-changed', {
    detail: { dbPath, value: next },
  }));
  return next;
}

// テーブルビューの「セル表示」メニュー。値の最大行数（1〜20・既定10）・画像サムネ数（1〜12・既定3）を
// 保存ビューごとに保持する。旧「折返し」メニューを名称統一したもの（関数名は既存呼び出し
// （ツールバーの data-action 等）互換のため維持する）。
function showDbCellWrapMenu(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const ctx = typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(event, { dbPath: state.currentDbPath })
    : _currentPaneState();
  const dbPath = ctx?.dbPath || state.currentDbPath;
  if (!dbPath) return;
  document.querySelectorAll('.db-cell-wrap-menu').forEach(el => el.remove());
  const cfg = _dbCellDisplayConfig(dbPath, ctx);
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu db-cell-wrap-menu';
  menu.dataset.e2eId = 'db-cell-display-menu';
  menu.style.minWidth = '200px';

  const heading = document.createElement('div');
  heading.style.cssText = 'padding:4px 10px 2px;font-size:11px;font-weight:600;color:var(--fg2);';
  heading.textContent = 'セル表示';
  menu.appendChild(heading);

  const addItem = (label, icon, active, action) => {
    const item = document.createElement('div');
    item.className = 'gb-context-menu-item' + (active ? ' active' : '');
    item.innerHTML = lucide(icon, 14) + ' ' + label;
    item.addEventListener('click', () => {
      action();
      menu.remove();
    });
    menu.appendChild(item);
  };

  addItem('折り返し', 'wrapText', cfg.overflow === 'wrap', () => {
    setDbCellTextDisplay(dbPath, 'wrap', cfg.lines, { ctx, event });
  });
  addItem('切り詰め', 'scissors', cfg.overflow === 'clip', () => {
    setDbCellTextDisplay(dbPath, 'clip', cfg.lines, { ctx, event });
  });

  const row = document.createElement('label');
  row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:12px;color:var(--fg);';
  const label = document.createElement('span');
  label.textContent = '値の最大行数';
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.max = '20';
  input.value = String(cfg.lines);
  input.dataset.e2eId = 'db-cell-display-max-lines';
  input.style.cssText = 'width:56px;padding:2px 4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;';
  const applyLines = () => {
    const nextLines = _dbClampInt(input.value, 1, 20, cfg.lines);
    input.value = String(nextLines);
    setDbCellTextDisplay(dbPath, 'wrap', nextLines, { ctx, event });
  };
  input.addEventListener('change', applyLines);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyLines();
      menu.remove();
    }
  });
  row.appendChild(label);
  row.appendChild(input);
  menu.appendChild(row);

  // 画像サムネ数（画像型セルが表示するサムネイル枚数の上限。1〜12・既定3）
  const imgRow = document.createElement('label');
  imgRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;font-size:12px;color:var(--fg);border-top:1px solid var(--ui-border,var(--border));';
  const imgLabel = document.createElement('span');
  imgLabel.textContent = '画像サムネ数';
  const imgInput = document.createElement('input');
  imgInput.type = 'number';
  imgInput.min = '1';
  imgInput.max = '12';
  imgInput.step = '1';
  imgInput.dataset.e2eId = 'db-cell-display-image-thumb-count';
  imgInput.setAttribute('aria-label', 'セルの画像サムネ数');
  imgInput.value = String(typeof getCellImageThumbCount === 'function' ? getCellImageThumbCount(dbPath, { ctx }) : 3);
  imgInput.style.cssText = 'width:56px;padding:2px 4px;background:var(--bg);color:var(--fg);border:1px solid var(--ui-border,var(--border));border-radius:3px;';
  const applyImageThumbCount = () => {
    imgInput.value = String(setCellImageThumbCount(dbPath, imgInput.value, { ctx, event }));
    const ctx2 = ctx || (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
    if (typeof _renderCurrentDbView === 'function') _renderCurrentDbView(ctx2, dbPath);
    else if (typeof renderPivot === 'function') renderPivot(ctx2);
  };
  imgInput.addEventListener('change', applyImageThumbCount);
  imgInput.addEventListener('keydown', keyEvent => {
    if (keyEvent.key === 'Enter') {
      keyEvent.preventDefault();
      applyImageThumbCount();
    }
  });
  imgRow.append(imgLabel, imgInput);
  menu.appendChild(imgRow);

  const tagLimitRow = document.createElement('label');
  tagLimitRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;font-size:12px;color:var(--fg);border-top:1px solid var(--ui-border,var(--border));';
  const tagLimitLabel = document.createElement('span');
  tagLimitLabel.textContent = 'タグ表示数';
  const tagLimitInput = document.createElement('input');
  tagLimitInput.type = 'number';
  tagLimitInput.min = '1';
  tagLimitInput.max = '999';
  tagLimitInput.step = '1';
  tagLimitInput.dataset.e2eId = 'sheet-tag-display-limit';
  tagLimitInput.setAttribute('aria-label', 'シートのタグ表示数');
  tagLimitInput.value = String(
    window.MeldexTagDisplayPreferences?.sheetTagDisplayLimit?.(dbPath)
      || window.MeldexGlobalTags?.getCompactTagDisplayLimit?.()
      || 10,
  );
  tagLimitInput.style.cssText = 'width:56px;padding:2px 4px;background:var(--bg);color:var(--fg);border:1px solid var(--ui-border,var(--border));border-radius:3px;';
  const applyTagLimit = () => {
    tagLimitInput.value = String(setDbCommonTagsDisplayLimit(dbPath, tagLimitInput.value, { ctx, event }));
  };
  tagLimitInput.addEventListener('change', applyTagLimit);
  tagLimitInput.addEventListener('keydown', keyEvent => {
    if (keyEvent.key === 'Enter') {
      keyEvent.preventDefault();
      applyTagLimit();
    }
  });
  tagLimitRow.append(tagLimitLabel, tagLimitInput);
  menu.appendChild(tagLimitRow);

  const note = document.createElement('div');
  note.style.cssText = 'padding:4px 10px 6px;font-size:11px;color:var(--fg2);border-top:1px solid var(--border);margin-top:2px;';
  note.textContent = '列ごとの折返し/切り詰めは列メニューから';
  menu.appendChild(note);

  const x = event?.clientX ?? 16;
  const y = event?.clientY ?? 16;
  const z = parseFloat(document.documentElement.style.zoom) || 1;
  menu.style.left = (x / z) + 'px';
  menu.style.top = (y / z) + 'px';
  document.body.appendChild(menu);
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  setTimeout(() => {
    const closer = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('pointerdown', closer);
      }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

// 列ヘッダーメニューから開く、列単位の折返し/切り詰めポップアップ。
// showDbCellWrapMenu（シート全体のセル表示設定）と同じDOM流儀（フローティングdiv・クリック外側で閉じる）を踏襲し、
// 「シート設定に従う（既定）」を追加した3択にする。
// 列ヘッダーメニュー「折り返し設定」サブメニューの子項目を作る。
// 親メニュー（列メニュー / エントリ名列メニュー）を閉じずにサブメニューとして開くため、
// 別ポップアップは作らず {type:'submenu', children} に渡す配列だけを返す。
// propName に '__entity__' を渡せばエントリ名列の折り返しも設定できる
// （cellDisplayByCol は列名キーで __entity__ も受け付ける）。
function _makeColumnWrapSubmenuItems(dbPath, propName, ctx) {
  if (!dbPath || !propName) return [];
  const sheetCfg = _dbCellDisplayConfig(dbPath, ctx);
  const override = getDbColumnCellDisplay(dbPath, propName, ctx);
  const effectiveLines = override ? override.lines : sheetCfg.lines;
  return [
    {
      label: radioMark(!override) + 'シート設定に従う（既定）',
      action: () => setDbColumnCellTextDisplay(dbPath, propName, null, null, { ctx }),
    },
    {
      label: radioMark(!!override && override.overflow === 'wrap') + lucide('wrapText', 14) + ' 折り返し',
      action: () => setDbColumnCellTextDisplay(dbPath, propName, 'wrap', effectiveLines, { ctx }),
    },
    {
      label: radioMark(!!override && override.overflow === 'clip') + lucide('scissors', 14) + ' 切り詰め',
      action: () => setDbColumnCellTextDisplay(dbPath, propName, 'clip', effectiveLines, { ctx }),
    },
    {
      type: 'custom',
      build: () => {
        const row = document.createElement('label');
        row.className = 'gb-menu-wrap-lines-row';
        row.dataset.e2eId = 'db-column-cell-wrap-lines-row';
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:12px;color:var(--fg);white-space:nowrap;';
        const rowLabel = document.createElement('span');
        rowLabel.textContent = '最大行数';
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '1';
        input.max = '20';
        input.value = String(effectiveLines);
        input.dataset.e2eId = 'db-column-cell-wrap-lines-input';
        input.style.cssText = 'width:56px;padding:2px 4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;';
        const applyLines = () => {
          const nextLines = _dbClampInt(input.value, 1, 20, effectiveLines);
          input.value = String(nextLines);
          setDbColumnCellTextDisplay(dbPath, propName, 'wrap', nextLines, { ctx });
        };
        input.addEventListener('change', applyLines);
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            applyLines();
            if (typeof closeColHeaderMenu === 'function') closeColHeaderMenu();
          }
        });
        // 数値入力はサブメニュー（.gb-context-menu）配下にあり外側クリック判定に当たらないが、
        // 念のため pointerdown の伝播は止めてメニューが閉じないようにする。
        row.addEventListener('pointerdown', (e) => e.stopPropagation());
        row.appendChild(rowLabel);
        row.appendChild(input);
        return row;
      },
    },
  ];
}

function _dbTextLengthForWidth(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const longest = lines.reduce((max, line) => Math.max(max, [...line].length), 0);
  return Math.max(longest, [...String(text ?? '').replace(/\r?\n/g, '')].length);
}

function _dbEstimateWrapLines(text, widthChars) {
  const width = Math.max(1, widthChars || 1);
  const lines = String(text ?? '').split(/\r?\n/);
  return lines.reduce((sum, line) => {
    const len = Math.max(1, [...line].length);
    return sum + Math.ceil(len / width);
  }, 0);
}

function _dbTextForProp(entityName, propName, data, propTypes, advFilters, dbPath, filterMode) {
  const entityData = data?.entities?.[entityName] || {};
  const ptc = propTypes?.[propName];
  const metadataSource = typeof _dbPropertyMetadataSource === 'function'
    ? _dbPropertyMetadataSource(ptc)
    : (['created', 'modified', 'modified_by'].includes(ptc?.source) ? ptc.source : '');
  if (metadataSource) {
    const metaVal = entityData['_' + metadataSource] ?? '';
    return metaVal == null ? '' : String(metaVal);
  }
  if (ptc?.type === 'formula' && ptc.formula && typeof formulaEvalForEntity === 'function') {
    const result = formulaEvalForEntity(ptc.formula, entityData, { propTypes, dbPath });
    return result?.error ? '' : String(result?.value ?? '');
  }
  let values = Object.prototype.hasOwnProperty.call(entityData, propName) && Array.isArray(entityData[propName])
    ? entityData[propName]
    : [];
  if (typeof filterValues === 'function') values = filterValues(values, undefined, filterMode);
  if (advFilters?.length && typeof applyAdvancedFilters === 'function') {
    values = applyAdvancedFilters(values, propName, advFilters);
  }
  return values.map(v => v?.value == null ? '' : String(v.value)).filter(Boolean).join(', ');
}

function _dbAutoWidthCharsForTexts(texts, headerText) {
  const values = texts.filter(Boolean);
  const lengths = values.map(_dbTextLengthForWidth);
  const avg = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  let chars = Math.max(4, Math.ceil(Math.max(avg, [...String(headerText || '')].length)));
  chars = Math.min(10, chars);
  if (values.some(text => _dbEstimateWrapLines(text, 10) > 3)) chars = Math.max(chars, 20);
  if (values.some(text => _dbEstimateWrapLines(text, 20) > 10)) chars = Math.max(chars, 30);
  if (values.some(text => _dbEstimateWrapLines(text, 30) > 10)) {
    const longest = lengths.length ? Math.max(...lengths) : chars;
    chars = Math.max(chars, Math.min(50, Math.ceil(longest / 10) * 10));
  }
  return Math.min(50, Math.max(4, chars));
}

function _dbAutoWidthCharsForEntryNames(entityNames, headerText = 'トピック名') {
  const base = _dbAutoWidthCharsForTexts(entityNames, headerText);
  const maxNameLen = entityNames.length
    ? Math.max(...entityNames.map(name => _dbTextLengthForWidth(name)))
    : 0;
  return Math.max(base, Math.min(36, maxNameLen));
}

function _dbWidthPxFromChars(chars) {
  return Math.max(60, Math.min(640, Math.round(chars * 12 + 28)));
}

// 通常テキスト列の自動列幅の上限（計画: 「最大268px程度に制限し、長文や改行を含む値は
// 折り返す」）。エントリ名列・画像列は別の専用算出規則（_dbEntityWidthPxFromChars /
// _dbAutoImageColumnWidth）を維持し、この上限の対象外とする。
const DB_TEXT_AUTO_WIDTH_MAX_PX = 268;

function _dbTextAutoWidthPxFromChars(chars) {
  return Math.min(DB_TEXT_AUTO_WIDTH_MAX_PX, _dbWidthPxFromChars(chars));
}

const DB_ENTITY_AUTO_WIDTH_CHROME_PX = 74;

function _dbEntityWidthPxFromChars(chars) {
  return Math.max(120, Math.min(640, _dbWidthPxFromChars(chars) + DB_ENTITY_AUTO_WIDTH_CHROME_PX));
}

function _dbAutoImageColumnWidth(propName, ptc) {
  const imageCellHeight = ptc?.options?.cell_height ?? ptc?.options?.cell_thumbnail_size;
  const cellSize = typeof _imagePropCellSize === 'function'
    ? _imagePropCellSize(ptc)
    : _dbClampInt(imageCellHeight, 32, 320, 96);
  const labelWidth = _dbWidthPxFromChars(Math.min(16, Math.max(4, [...String(propName || '')].length)));
  return Math.max(96, Math.min(260, Math.max(labelWidth, cellSize + 52)));
}

// 列幅自動算出の本体。手動の「列幅自動調整」ボタンと、データが入った直後の一度だけの
// 自動調整（_dbMaybeAutoFitColumnsOnce）の両方から共有で使う。保存は行わない（呼び出し側が
// 返り値を colWidths へ反映して保存する）。
function _dbComputeAutoFitColumnWidths(params) {
  const { propTypes, visibleProps, entityNames, advFilters, data, dbPath, ctx } = params || {};
  const widths = {};
  const entityChars = _dbAutoWidthCharsForEntryNames(entityNames || [], typeof _dbEntityColumnDisplayLabel === 'function' ? _dbEntityColumnDisplayLabel(dbPath) : 'トピック名');
  widths.__entity__ = _dbEntityWidthPxFromChars(entityChars);
  (visibleProps || []).forEach(propName => {
    const ptc = propTypes?.[propName] || {};
    if (ptc?.type === 'image') {
      widths[propName] = _dbAutoImageColumnWidth(propName, ptc);
      return;
    }
    const texts = (entityNames || []).map(name => _dbTextForProp(name, propName, data, propTypes, advFilters, dbPath, ctx?.filter));
    widths[propName] = _dbTextAutoWidthPxFromChars(_dbAutoWidthCharsForTexts(texts, propName));
  });
  return widths;
}

// データを持つテーブルビューで保存済み列幅が一つもなければ、初回描画前に一度だけ自動調整して
// 保存する（renderPivot から呼ぶ）。既存の列幅が一つでもあれば利用者調整済みとして変更しない。
// 空のビュー（エントリ0件）は何もせず、次回データが入った時の描画で再判定する
// （columnAutoFitInitialized はまだ立てない）。一度実行したら次回以降は
// columnAutoFitInitialized で必ずスキップする（列幅を全消去した後の再トリガーはしない）。
function _dbMaybeAutoFitColumnsOnce(dbPath, ctx, params) {
  if (!dbPath) return null;
  const { entityNames, savedWidths } = params || {};
  if (!Array.isArray(entityNames) || entityNames.length === 0) return null;
  if (savedWidths && typeof savedWidths === 'object' && Object.keys(savedWidths).length > 0) return null;
  const view = typeof getCurrentDbViewConfigEntry === 'function' ? getCurrentDbViewConfigEntry(dbPath, { ctx }) : null;
  if (view?.columnAutoFitInitialized) return null;
  const computed = _dbComputeAutoFitColumnWidths({ ...(params || {}), dbPath, ctx });
  if (typeof _saveCurrentDbViewField === 'function') {
    _saveCurrentDbViewField(dbPath, '', '', { ctx, skipHistory: true }, (v) => {
      v.colWidths = computed;
      v.columnAutoFitInitialized = true;
    });
  }
  return computed;
}

function autoFitCurrentSheetColumns(event, ctxOverride, dbPathOverride) {
  const ctx = ctxOverride || (typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(event, { dbPath: dbPathOverride || state.currentDbPath })
    : _currentPaneState());
  const data = ctx?.pivotData || state.pivotData;
  const dbPath = dbPathOverride || ctx?.dbPath || state.currentDbPath;
  if (!dbPath || !data?.entities) return;
  const viewMode = typeof _dbCurrentViewModeForContext === 'function'
    ? _dbCurrentViewModeForContext(ctx, dbPath)
    : (typeof getCurrentViewMode === 'function' ? getCurrentViewMode(dbPath, { ctx }) : 'pivot');
  if (viewMode === 'timeline' && typeof autoFitTimelineColumns === 'function') {
    autoFitTimelineColumns(ctx, dbPath);
    return;
  }
  if (viewMode !== 'pivot') {
    if (typeof showStatus === 'function') showStatus('列幅自動調整はテーブル表示とタイムライン表示で利用できます', true);
    return;
  }
  const before = typeof captureDbViewConfigHistory === 'function' ? captureDbViewConfigHistory(dbPath) : null;
  const hiddenCols = getHiddenCols(dbPath, { ctx });
  const propTypes = getPropertyTypes(dbPath, ctx);
  const advFilters = getAdvancedFilters(dbPath, { ctx });
  const colOrder = getColOrder(dbPath, { ctx });
  let props = colOrder ? [...colOrder] : [...(data.properties || [])];
  props = [...new Set(props)];
  (data.properties || []).forEach(p => { if (!props.includes(p)) props.push(p); });
  Object.keys(propTypes || {}).forEach(p => { if (!props.includes(p)) props.push(p); });
  if (typeof filterDeletedDbProperties === 'function') props = filterDeletedDbProperties(dbPath, props);
  const visibleProps = props.filter(p => !hiddenCols.includes(p));
  const entityNames = Object.keys(data.entities || {});
  const computed = _dbComputeAutoFitColumnWidths({ propTypes, visibleProps, entityNames, advFilters, data, dbPath, ctx });
  _saveCurrentDbViewField(dbPath, '', '全列', { ctx, skipHistory: true }, (v) => {
    v.colWidths = computed;
    // 手動で自動調整した場合も、以後は初回自動調整（データが入った直後の一度だけの調整）を
    // 再トリガーしない（利用者が明示的に列幅を確定させた状態として扱う）。
    v.columnAutoFitInitialized = true;
  });
  if (typeof pushDbViewConfigHistory === 'function' && typeof captureDbViewConfigHistory === 'function') {
    pushDbViewConfigHistory(dbPath, 'シート表示: 列幅自動調整', before, captureDbViewConfigHistory(dbPath), '全列');
  }
  renderPivot(ctx);
  if (typeof showStatus === 'function') showStatus('列幅を自動調整しました');
}
