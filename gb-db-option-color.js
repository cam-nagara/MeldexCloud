/* gb-db-option-color.js
   セレクト / マルチセレクトの選択肢（option）ごとの色設定。
   - 色の保存場所: property_types[propName].optionColors = { [option値]: '#rrggbb' }
   - options 配列自体は文字列のまま変更しない（追加のみの互換変更）
   - プロパティ設定画面とセル編集ドロップダウンの両方から共通カラーパレットで変更できる
   - リネーム/削除で孤立した色キーは自動削除しない（options textarea の autosave デバウンス中に
     行が一時的に消えるため）。UI表示は現存 options のみに絞る
*/

// hex 3桁/6桁のみ有効な色として扱う。'transparent' や不正値は「未設定」として扱う
function _dbOptionColorIsValidHex(hex) {
  return typeof hex === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex.trim());
}

// option 値に対する色を取得（未設定/不正値は空文字）
function getDbOptionColor(ptc, value) {
  if (!ptc || !ptc.optionColors || value == null) return '';
  const hex = ptc.optionColors[String(value)];
  return _dbOptionColorIsValidHex(hex) ? hex.trim() : '';
}

// 背景色に対する読みやすい文字色（白/黒）を YIQ で判定
function dbOptionTextColorFor(hexBg) {
  if (!_dbOptionColorIsValidHex(hexBg)) return '';
  let hex = hexBg.trim().slice(1);
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? '#000000' : '#ffffff';
}

// チップ要素（.cell-select-val / .multi-select-tag 等）へ色を適用。hex が空ならデフォルト（CSS変数）に戻す
function applyDbOptionChipColor(el, hex) {
  if (!el) return;
  const safeHex = _dbOptionColorIsValidHex(hex) ? hex.trim() : '';
  if (!safeHex) {
    el.style.removeProperty('background');
    el.style.removeProperty('background-color');
    el.style.removeProperty('color');
    return;
  }
  el.style.background = safeHex;
  const fg = dbOptionTextColorFor(safeHex);
  if (fg) el.style.color = fg;
}

// グループ行 / カンバン列ヘッダーへ候補色と自動コントラスト色を適用する。
function applyDbOptionHeaderColor(el, hex) {
  if (!el) return;
  const safeHex = _dbOptionColorIsValidHex(hex) ? hex.trim() : '';
  if (!safeHex) {
    el.classList.remove('db-option-color-header');
    el.style.removeProperty('--db-option-bg');
    el.style.removeProperty('--db-option-fg');
    return;
  }
  el.classList.add('db-option-color-header');
  el.style.setProperty('--db-option-bg', safeHex);
  el.style.setProperty('--db-option-fg', dbOptionTextColorFor(safeHex));
}

// ドロップダウン項目先頭に挿入する色ドット（DOM要素）。hex が無効なら null
function createDbOptionColorDot(hex) {
  const safeHex = _dbOptionColorIsValidHex(hex) ? hex.trim() : '';
  if (!safeHex) return null;
  const dot = document.createElement('span');
  dot.className = 'db-option-color-dot';
  dot.setAttribute('aria-hidden', 'true');
  dot.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-right:2px;vertical-align:middle;';
  dot.style.background = safeHex;
  return dot;
}

// テンプレートリテラル（innerHTML）内で使う文字列版の色ドット
function dbOptionColorDotHtml(hex) {
  const safeHex = _dbOptionColorIsValidHex(hex) ? hex.trim() : '';
  if (!safeHex) return '';
  return '<span class="db-option-color-dot" aria-hidden="true" style="display:inline-block;width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-right:4px;vertical-align:middle;background:' + safeHex + ';"></span>';
}

// グループ化ヘッダー（テーブルの行グループ / カンバン列）用に、groupByProp が select 系なら
// groupKey に対応する色ドットHTMLを返す。対象外なら空文字
function dbOptionColorDotHtmlForGroup(dbPath, groupByProp, groupKey, ctx) {
  return dbOptionColorDotHtml(getDbOptionColorForGroup(dbPath, groupByProp, groupKey, ctx));
}

function getDbOptionColorForGroup(dbPath, groupByProp, groupKey, ctx) {
  if (!dbPath || !groupByProp || typeof getPropertyTypes !== 'function') return '';
  const ptc = (getPropertyTypes(dbPath, ctx) || {})[groupByProp];
  if (!ptc || (ptc.type !== 'select' && ptc.type !== 'multi-select')) return '';
  return getDbOptionColor(ptc, groupKey);
}

function refreshDbOptionColorInOpenViews(dbPath, propName, option, color, ctx) {
  const safeHex = _dbOptionColorIsValidHex(color) ? color.trim() : '';
  const contexts = typeof _dbPaneContextsForPath === 'function'
    ? _dbPaneContextsForPath(dbPath)
    : [];
  if (ctx && !contexts.includes(ctx)) contexts.push(ctx);
  const roots = contexts.map(item => item?.containerEl).filter(Boolean);
  if (!roots.length && typeof document !== 'undefined') roots.push(document);

  roots.forEach(root => {
    root.querySelectorAll?.('td[data-prop-name]').forEach(td => {
      if (td.dataset.propName !== propName) return;
      td.querySelectorAll('.cell-select-val, .multi-select-tag').forEach(chip => {
        if ((chip.textContent || '').trim() === String(option)) applyDbOptionChipColor(chip, safeHex);
      });
    });

    const groupBy = typeof getGroupBy === 'function' ? getGroupBy(dbPath, ctx) : '';
    if (groupBy === propName) {
      root.querySelectorAll?.('tr.group-header-row').forEach(row => {
        if (row.dataset.groupKey !== String(option)) return;
        applyDbOptionHeaderColor(row, safeHex);
        const cell = row.querySelector('td');
        const existing = cell?.querySelector('.db-option-color-dot');
        if (existing) existing.remove();
        const dot = createDbOptionColorDot(safeHex);
        if (dot && cell) {
          const toggle = cell.querySelector('.group-toggle');
          if (toggle?.nextSibling) cell.insertBefore(dot, toggle.nextSibling);
          else cell.appendChild(dot);
        }
      });
    }

    const kanbanGroupBy = typeof getKanbanGroupBy === 'function' ? getKanbanGroupBy(dbPath, ctx) : '';
    if (kanbanGroupBy === propName) {
      root.querySelectorAll?.('.kanban-column-header').forEach(header => {
        const title = header.querySelector('span:not(.kanban-dot):not(.kanban-count)');
        if ((title?.textContent || '').trim() !== String(option)) return;
        applyDbOptionHeaderColor(header, safeHex);
        const existing = header.querySelector('.kanban-dot');
        if (existing) existing.remove();
        const dot = createDbOptionColorDot(safeHex);
        if (dot) {
          dot.classList.add('kanban-dot');
          header.insertBefore(dot, header.firstChild);
        }
      });
    }
  });
}

// --- セル編集ドロップダウンからの色設定（第2弾: 2026-07-24） ---
// 選択肢の色を optionColors に保存する。低レベルの setPropertyType を使い、state.dbMetadata（同期更新）と
// バックエンドへ反映する。Undo/Redo は積まない（軽微な表示変更のため）。
async function setDbOptionColorAndSave(dbPath, propName, option, color, ctx) {
  if (!dbPath || !propName || option == null) return false;
  if (typeof getPropertyTypes !== 'function' || typeof setPropertyType !== 'function') return false;
  const cfg = JSON.parse(JSON.stringify((getPropertyTypes(dbPath, ctx) || {})[propName] || {}));
  const colors = { ...(cfg.optionColors || {}) };
  if (_dbOptionColorIsValidHex(color)) colors[String(option)] = color.trim();
  else delete colors[String(option)];
  if (Object.keys(colors).length) cfg.optionColors = colors;
  else delete cfg.optionColors;
  try {
    await setPropertyType(dbPath, propName, cfg, ctx);
    refreshDbOptionColorInOpenViews(dbPath, propName, option, color, ctx);
  } catch (error) {
    if (typeof showStatus === 'function') {
      showStatus(`選択肢の背景色を保存できませんでした: ${error?.message || '保存エラー'}`, true);
    }
    return false;
  }
  return true;
}

// ドロップダウンの選択肢項目に「背景色を設定」できる色スウォッチを付ける。
// クリックで共通カラーパレットを開き、選んだ色を optionColors に保存する。
// opts: { dbPath, propName, option, ctx, getConfig?, onChanged? }
function appendDbOptionColorSwatch(itemEl, opts) {
  if (!itemEl || !opts || typeof openColorPalette !== 'function') return null;
  const { dbPath, propName, option, ctx } = opts;
  const getConfig = typeof opts.getConfig === 'function'
    ? opts.getConfig
    : () => (typeof getPropertyTypes === 'function' ? (getPropertyTypes(dbPath, ctx) || {})[propName] : null);
  const sw = document.createElement('button');
  sw.type = 'button';
  sw.className = 'db-option-color-swatch';
  sw.title = '背景色を設定';
  sw.setAttribute('aria-label', String(option) + ' の背景色を設定');
  sw.style.cssText = 'width:14px;height:14px;flex:0 0 auto;border:1px solid var(--border);border-radius:3px;cursor:pointer;padding:0;box-sizing:border-box;';
  const paint = (hexOverride) => {
    const hex = hexOverride != null ? hexOverride : getDbOptionColor(getConfig(), option);
    sw.style.background = _dbOptionColorIsValidHex(hex) ? hex.trim() : 'transparent';
  };
  paint();
  // ドロップダウン項目のクリック（値のトグル/選択）へ伝播させない
  sw.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
  sw.addEventListener('click', (e) => {
    e.stopPropagation();
    openColorPalette(sw, getDbOptionColor(getConfig(), option) || '', (color) => {
      paint(color); // ライブでスウォッチへ反映
      clearTimeout(sw._dbOptionColorSaveTimer);
      // ライブ変更のたびに保存せずデバウンスして setPropertyType を呼ぶ
      sw._dbOptionColorSaveTimer = setTimeout(() => {
        setDbOptionColorAndSave(dbPath, propName, option, color, ctx).then((ok) => {
          if (ok) {
            if (typeof opts.onChanged === 'function') opts.onChanged();
          } else {
            paint();
          }
        });
      }, 250);
    });
  });
  itemEl.appendChild(sw);
  return sw;
}

// プロパティ設定画面: 選択肢の色エディタを描画する。
// container: #pt-select-option-colors のような描画先div
// scope: onPropertyTypeChange 等が使う [data-pt-root] 要素（_ptGet/_ptState の解決対象と同じもの）
// 作業バッファは scope._dbOptionColorBuffer に保持し、window._pt* へは触れない
function renderDbOptionColorEditor(container, scope) {
  if (!container || !scope) return null;
  const stateInfo = typeof _ptState === 'function' ? _ptState(scope) : null;
  const current = stateInfo?.current || {};
  if (!scope._dbOptionColorBuffer) {
    scope._dbOptionColorBuffer = { ...(current.optionColors || {}) };
  }
  const buffer = scope._dbOptionColorBuffer;
  const getTextarea = () => (typeof _ptGet === 'function' ? _ptGet('pt-select-options', scope) : scope.querySelector?.('#pt-select-options'));

  const renderRows = () => {
    const textarea = getTextarea();
    container.innerHTML = '';
    const raw = textarea ? textarea.value : '';
    const opts = raw.split('\n').map(s => s.trim()).filter(Boolean);
    const seen = new Set();
    opts.forEach((opt, optionIndex) => {
      if (seen.has(opt)) return;
      seen.add(opt);
      const row = document.createElement('div');
      row.className = 'pt-option-color-row';
      row.dataset.e2eId = 'pt-select-option-color-row';
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:2px 0;';
      const label = document.createElement('span');
      label.textContent = opt;
      label.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;';
      row.appendChild(label);
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'gb-fmt-swatch';
      swatch.dataset.e2eId = `pt-select-option-color-swatch-${optionIndex}`;
      swatch.title = opt + ' の色';
      swatch.setAttribute('aria-label', opt + 'の色を選択');
      row.appendChild(swatch);
      container.appendChild(row);
      if (typeof setColorSwatchValue === 'function') setColorSwatchValue(swatch, buffer[opt] || '');
      if (typeof bindColorSwatch === 'function') {
        bindColorSwatch(swatch, () => buffer[opt] || '', (color) => {
          if (_dbOptionColorIsValidHex(color)) buffer[opt] = color.trim();
          else delete buffer[opt];
          if (typeof setColorSwatchValue === 'function') setColorSwatchValue(swatch, buffer[opt] || '');
          // autosave（_bindDbPropertySettingsAutosave の input 委譲）を明示的に起動する。
          // カラーパレットは document.body 直下に描画されスウォッチ自身のクリックとは
          // 別イベントで onSelect が呼ばれるため、ここで input イベントを起こさないと
          // 選択肢の色変更が保存されない。
          try { scope.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
        });
      }
    });
    if (!opts.length) {
      const empty = document.createElement('div');
      empty.className = 'pt-hint';
      empty.textContent = '選択肢を追加すると色を設定できます。';
      container.appendChild(empty);
    }
  };

  renderRows();
  const textarea = getTextarea();
  if (textarea && !textarea._dbOptionColorInputBound) {
    textarea._dbOptionColorInputBound = true;
    textarea.addEventListener('input', renderRows);
  }
  return buffer;
}

// 保存直前に呼ぶ: scope の作業バッファ（無ければ prevColors）から有効な色だけを集めて返す。
// currentOptions は将来の並び替え等に備えた引数（オーファンキーは意図的にプルーニングしない）
function collectDbOptionColors(scope, prevColors, currentOptions) {
  void currentOptions;
  const buffer = (scope && scope._dbOptionColorBuffer) || prevColors || {};
  const out = {};
  Object.keys(buffer).forEach(key => {
    const hex = buffer[key];
    if (_dbOptionColorIsValidHex(hex)) out[key] = hex.trim();
  });
  return out;
}
