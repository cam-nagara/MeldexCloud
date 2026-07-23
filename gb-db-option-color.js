/* gb-db-option-color.js
   セレクト / マルチセレクトの選択肢（option）ごとの色設定。
   - 色の保存場所: property_types[propName].optionColors = { [option値]: '#rrggbb' }
   - options 配列自体は文字列のまま変更しない（追加のみの互換変更）
   - 設定場所はプロパティ設定画面のみ。セル編集ドロップダウンには色を「表示」するだけで、
     ドロップダウン内からの色変更は第2弾（2026-07-18 確定仕様）
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
  if (!dbPath || !groupByProp || typeof getPropertyTypes !== 'function') return '';
  const ptc = (getPropertyTypes(dbPath, ctx) || {})[groupByProp];
  if (!ptc || (ptc.type !== 'select' && ptc.type !== 'multi-select')) return '';
  return dbOptionColorDotHtml(getDbOptionColor(ptc, groupKey));
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
    opts.forEach(opt => {
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
      swatch.dataset.e2eId = 'pt-select-option-color-swatch';
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
