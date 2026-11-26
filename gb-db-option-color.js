/* gb-db-option-color.js
   セレクト / マルチセレクトの選択肢（option）ごとの色設定。
   - 色の保存場所: property_types[propName].optionColors = { [option値]: '#rrggbb' }
   - options 配列自体は文字列のまま変更しない（追加のみの互換変更）
   - プロパティ設定画面とセル編集ドロップダウンの両方から共通カラーパレットで変更できる
   - 候補名の確定保存時に色も同じ変更としてリネーム/削除する
*/

const _dbPendingColorSaves = new Map();
const _dbColorSaveQueues = new Map();

function _dbReorderedKeys(keys, source, target) {
  const next = [...keys];
  const from = next.indexOf(source), to = next.indexOf(target);
  if (from < 0 || to < 0 || from === to) return next;
  next.splice(from, 1);
  next.splice(to, 0, source);
  return next;
}

function _dbOrderedGroupKeys(keys, saved) {
  const present = new Set(keys);
  return [...new Set([...(Array.isArray(saved) ? saved : []).filter(key => present.has(key)), ...keys])];
}

function _dbOrderTagOptions(tags, config) {
  const order = _dbOrderedGroupKeys(tags.map(tag => String(tag.id)), config?.tagOrder);
  const byId = new Map(tags.map(tag => [String(tag.id), tag]));
  return order.map(id => byId.get(id));
}

function _dbApplyChipTypeTheme(el, dbPath, ctx) {
  const metadata = typeof _ptMetadataForDbPath === 'function' ? _ptMetadataForDbPath(dbPath, ctx) : null;
  const vars = typeof _expandFileStyleVars === 'function' ? _expandFileStyleVars(metadata?.style || metadata?.theme || {}, 'db-view-container') : {};
  Object.entries(vars).forEach(([key, value]) => { if (key.startsWith('--db-option-')) el.style.setProperty(key, value); });
}

function renderDbTagOptionOrderField(optDiv, scope) {
  const info = _ptState(scope), config = info.current || {};
  const field = document.createElement('div');
  field.className = 'field';
  field.innerHTML = '<label>タグの並び順</label>';
  const list = document.createElement('div');
  list.className = 'pt-tag-option-order';
  field.appendChild(list);
  optDiv.appendChild(field);
  const source = String(window.MeldexAutoTagSourceFolder?.(info.dbPath) || '').trim();
  window.MeldexGlobalTags?.loadTagsCached(source).then(data => {
    if (!field.isConnected) return;
    const tags = window.MeldexGlobalTags.sortTagsByGroupOrder(data.tags || [], data.groups || []);
    const sorted = _dbOrderTagOptions(tags, config);
    const keys = sorted.map(tag => String(tag.id));
    scope._dbTagOrderBuffer = [...keys];
    sorted.forEach(tag => {
      const row = document.createElement('div');
      row.className = 'pt-tag-option-row';
      row.dataset.reorderKey = String(tag.id);
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'gb-btn gb-btn-sm gb-btn-icon gb-btn-quiet';
      handle.innerHTML = lucide('gripVertical', 14);
      handle.disabled = Boolean(data.mutation_blocked || checkColumnEditable(info.dbPath, info.propName, info.ctx));
      _dbBindReorderHandle(handle, {
        label: tag.name, key: String(tag.id), root: list, selector: '.pt-tag-option-row',
        keys: () => scope._dbTagOrderBuffer, disabled: () => handle.disabled,
        commit: next => {
          const nodes = new Map([...list.children].map(node => [node.dataset.reorderKey, node]));
          next.forEach(id => list.appendChild(nodes.get(id)));
          scope._dbTagOrderBuffer = next;
          scope.dispatchEvent(new Event('input', { bubbles: true }));
          handle.focus({ preventScroll: true });
        },
      });
      row.append(handle, document.createTextNode(tag.name));
      list.appendChild(row);
    });
  }).catch(error => { list.textContent = 'タグの読み込みに失敗しました'; console.warn(error); });
}

// 同じ操作でマウス・指・キーボードを扱う。ドラッグ中は印だけを動かし、寸法は変えない。
function _dbBindReorderHandle(handle, options) {
  handle.dataset.dbReorderHandle = '1';
  if (!handle.dataset.e2eId) handle.dataset.e2eId = `db-reorder-handle-${options.key}`;
  handle.tabIndex = 0;
  handle.setAttribute('role', 'button');
  handle.setAttribute('aria-label', options.label + 'を並べ替え');
  handle.setAttribute('aria-description', 'ドラッグ、またはAltと矢印キーで並べ替え。Escapeで中止');
  handle.style.touchAction = 'none';
  handle.style.cursor = 'grab';
  handle.addEventListener('keydown', event => {
    if (event.key === 'Alt') { event.stopPropagation(); return; }
    const delta = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : 0;
    if (!event.altKey || !delta || options.disabled?.()) return;
    event.preventDefault();
    event.stopPropagation();
    const keys = options.keys(), index = keys.indexOf(options.key);
    if (index + delta >= 0 && index + delta < keys.length) options.commit(_dbReorderedKeys(keys, options.key, keys[index + delta]));
  });
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || options.disabled?.()) return;
    event.stopPropagation();
    const origin = { x: event.clientX, y: event.clientY }, keys = options.keys();
    let target = options.key, active = false, marked = null;
    handle.setPointerCapture?.(event.pointerId);
    const clearMark = () => { if (marked) marked.style.removeProperty('outline'); marked = null; };
    const hitItem = e => {
      const direct = document.elementFromPoint(e.clientX, e.clientY)?.closest(options.selector);
      if (direct && options.root.contains(direct)) return direct;
      const bounds = options.root.getBoundingClientRect();
      if (e.clientX < bounds.left - 32 || e.clientX > bounds.right + 32 || e.clientY < bounds.top - 32 || e.clientY > bounds.bottom + 32) return null;
      // 自動スクロール端の余白へ指を置いたままでも、最寄りの項目へ移せる。
      const horizontal = options.axis === 'x';
      let nearest = null, distance = Infinity;
      options.root.querySelectorAll(options.selector).forEach(item => {
        const r = item.getBoundingClientRect();
        const d = Math.abs((horizontal ? e.clientX - (r.left + r.right) / 2 : e.clientY - (r.top + r.bottom) / 2));
        if (d < distance) { distance = d; nearest = item; }
      });
      return nearest;
    };
    const move = e => {
      if (e.pointerId !== event.pointerId) return;
      if (!handle.isConnected) { finish(null); return; }
      if (!active && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < 6) return;
      if (!active) window.MeldexDragAutoScroll?.beginPointerSession?.(e.clientX, e.clientY);
      active = true;
      e.preventDefault();
      window.MeldexDragAutoScroll?.updatePointer?.(e.clientX, e.clientY);
      const item = hitItem(e);
      if (!item) return;
      target = item.dataset.reorderKey;
      clearMark();
      marked = item;
      marked.style.outline = '2px solid var(--accent)';
    };
    const cancelKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); } };
    const finish = e => {
      if (e && e.pointerId !== event.pointerId) return;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', cancelKey, true);
      window.removeEventListener('blur', cancel);
      if (active) window.MeldexDragAutoScroll?.endPointerSession?.();
      clearMark();
      if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      if (active && e?.type === 'pointerup') {
        e.preventDefault();
        const item = hitItem(e);
        if (item) target = item.dataset.reorderKey;
        if (target !== options.key) options.commit(_dbReorderedKeys(keys, options.key, target));
      }
    };
    const cancel = () => finish(null);
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', cancelKey, true);
    window.addEventListener('blur', cancel);
  });
}

function _dbColorSavePathKey(path) {
  return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

// ポップアップを閉じた直後の再読込でも、デバウンス中の色を保存してから読む。
function scheduleDbColorSave(sw, dbPath, save) {
  clearTimeout(sw._dbOptionColorSaveTimer);
  let promise = null;
  let timer = null;
  const pending = {
    dbPath,
    flush() {
      clearTimeout(timer);
      if (!promise) {
        const key = _dbColorSavePathKey(dbPath);
        // 同じシートの色保存は、設定の読取と履歴登録も含めて順序を保つ。
        // 前の保存の失敗はその保存自身のチェーンで表示済み。ここでは順序待ちのためだけに受け、
        // 次の色の保存を止めない。
        const previous = _dbColorSaveQueues.get(key);
        promise = Promise.resolve(previous).catch(() => {}).then(save).catch((error) => {
          // 自動保存（タイマー）でも flush の待機側でも、失敗を必ず利用者へ伝える。
          console.warn('[Meldex] 選択肢の背景色を保存できませんでした', error);
          if (typeof showStatus === 'function') {
            showStatus('選択肢の背景色を保存できませんでした: ' + (error?.message || error), true);
          }
          throw error;
        }).finally(() => {
          if (_dbPendingColorSaves.get(sw) === pending) _dbPendingColorSaves.delete(sw);
          if (_dbColorSaveQueues.get(key) === promise) _dbColorSaveQueues.delete(key);
        });
        _dbColorSaveQueues.set(key, promise);
      }
      return promise;
    },
  };
  _dbPendingColorSaves.set(sw, pending);
  // 失敗は保存チェーン内で表示済み。ここでは未処理の拒否にしないためだけに受ける。
  timer = setTimeout(() => pending.flush().catch(() => {}), 250);
  sw._dbOptionColorSaveTimer = timer;
}

async function flushPendingDbColorSaves(dbPath) {
  const target = _dbColorSavePathKey(dbPath);
  while (true) {
    const pending = [..._dbPendingColorSaves.values()].filter(item => !target || _dbColorSavePathKey(item.dbPath) === target);
    if (!pending.length) return;
    await Promise.all(pending.map(item => item.flush()));
  }
}

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

function _dbOptionColorProtectionReason(level) {
  if (level === 'all') return '制作管理に必要な列のため変更できません';
  if (level === 'required') return 'ユーザー管理に必要な列のため変更できません';
  if (level === 'computed') return '自動計算列のため変更できません';
  return '';
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

// カンバンのグループ（列全体）を選択肢の背景色で塗る。見出しは濃く、列の地は薄くする。
function applyDbOptionKanbanColumnColor(col, hex) {
  if (!col) return;
  const safeHex = _dbOptionColorIsValidHex(hex) ? hex.trim() : '';
  if (!safeHex) {
    col.classList.remove('db-option-color-column');
    col.style.removeProperty('--db-option-bg');
    return;
  }
  col.classList.add('db-option-color-column');
  col.style.setProperty('--db-option-bg', safeHex);
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
  return getDbOptionStyle(ptc, groupKey)?.bgColor || getDbOptionColor(ptc, groupKey);
}

function refreshDbOptionColorInOpenViews(dbPath, propName, option, color, ctx) {
  const safeHex = _dbOptionColorIsValidHex(color) ? color.trim() : '';
  const contexts = typeof _dbPaneContextsForPath === 'function'
    ? _dbPaneContextsForPath(dbPath)
    : [];
  if (ctx && !contexts.includes(ctx)) contexts.push(ctx);
  const views = contexts.filter(item => item?.containerEl).map(item => ({ root: item.containerEl, ctx: item }));
  if (!views.length && typeof document !== 'undefined') views.push({ root: document, ctx });

  views.forEach(({ root, ctx }) => {
    root.querySelectorAll?.('td[data-prop-name]').forEach(td => {
      if (td.dataset.propName !== propName) return;
      td.querySelectorAll('.cell-select-val, .multi-select-tag').forEach(chip => {
        if ((chip.textContent || '').trim() !== String(option)) return;
        // 背景色以外の書式（文字色・太字など）は保存済みの値を保ったまま、背景色だけ差し替える。
        const ptc = typeof getPropertyTypes === 'function' ? (getPropertyTypes(dbPath, ctx) || {})[propName] : null;
        const style = { ...getDbOptionStyle(ptc, option) };
        if (safeHex) style.bgColor = safeHex;
        else delete style.bgColor;
        applyDbChipStyle(chip, style);
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
        applyDbOptionKanbanColumnColor(header.closest('.kanban-column'), safeHex);
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
// バックエンドへ反映し、保存成功後に列設定の Undo/Redo 履歴へ積む。
async function setDbOptionColorAndSave(dbPath, propName, option, color, ctx) {
  if (!dbPath || !propName || option == null) return false;
  if (typeof getPropertyTypes !== 'function' || typeof setPropertyType !== 'function') return false;
  const previous = JSON.parse(JSON.stringify((getPropertyTypes(dbPath, ctx) || {})[propName] || {}));
  const cfg = JSON.parse(JSON.stringify(previous));
  const colors = { ...(cfg.optionColors || {}) };
  if (_dbOptionColorIsValidHex(color)) colors[String(option)] = color.trim();
  else delete colors[String(option)];
  if (Object.keys(colors).length) cfg.optionColors = colors;
  else delete cfg.optionColors;
  // 書式（optionStyles）側の背景色が優先されるため、同じ値へそろえる。
  if (cfg.optionStyles && cfg.optionStyles[String(option)]) {
    const style = { ...cfg.optionStyles[String(option)] };
    if (_dbOptionColorIsValidHex(color)) style.bgColor = color.trim();
    else delete style.bgColor;
    if (Object.keys(style).length) cfg.optionStyles[String(option)] = style;
    else delete cfg.optionStyles[String(option)];
    if (!Object.keys(cfg.optionStyles).length) delete cfg.optionStyles;
  }
  try {
    const saved = await Promise.resolve(setPropertyType(dbPath, propName, cfg, ctx));
    if (saved === false) throw new Error('保護されている列のため変更できません');
    if (typeof _ptPushTypeChangeHistory === 'function') {
      _ptPushTypeChangeHistory(dbPath, propName, previous, cfg, ctx);
    }
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
  const protectionLevel = typeof _dbSchemaProtectionLevel === 'function'
    ? _dbSchemaProtectionLevel(dbPath, propName) : null;
  const protectionReason = _dbOptionColorProtectionReason(protectionLevel);
  if (protectionReason) {
    sw.disabled = true;
    sw.title = protectionReason;
    sw.setAttribute('aria-label', `${String(option)} の背景色は変更できません。${protectionReason}`);
  }
  sw.style.cssText = `width:14px;height:14px;flex:0 0 auto;border:1px solid var(--border);border-radius:3px;cursor:${protectionReason ? 'not-allowed' : 'pointer'};padding:0;box-sizing:border-box;`;
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
      refreshDbOptionColorInOpenViews(dbPath, propName, option, color, ctx);
      // ライブ変更のたびに保存せずデバウンスして setPropertyType を呼ぶ
      scheduleDbColorSave(sw, dbPath, () =>
        setDbOptionColorAndSave(dbPath, propName, option, color, ctx).then((ok) => {
          if (ok) {
            if (typeof opts.onChanged === 'function') opts.onChanged();
          } else {
            paint();
            refreshDbOptionColorInOpenViews(dbPath, propName, option, getDbOptionColor(getConfig(), option), ctx);
          }
        })
      );
    });
  });
  itemEl.appendChild(sw);
  return sw;
}

// 選択肢の削除はセルの「解除」と別操作。画面のフィルタや部分キャッシュではなく、
// 正本の全候補から削除対象を集め、値と列設定を同じUndo操作として扱う。
function _dbSelectOptionDeleteWrites(pivot, dbPath, propName, option, type) {
  const writes = [];
  Object.entries(pivot?.entities || {}).forEach(([name, entity]) => {
    (entity[propName] || []).forEach(value => {
      const oldValue = String(value.value ?? '');
      const tokens = type === 'multi-select' ? oldValue.split(',').map(v => v.trim()).filter(Boolean) : [oldValue];
      if (!tokens.includes(option)) return;
      const nextValue = type === 'multi-select' ? tokens.filter(v => v !== option).join(', ') : '';
      const entryPath = entity._entry_path || value.entry_path || _entityPath(dbPath, name, pivot);
      writes.push({ ref: { ...value, entry_path: entryPath, property: propName }, oldValue, nextValue });
    });
  });
  return writes.sort((a, b) => String(a.ref.file).localeCompare(String(b.ref.file))
    || Number(b.ref.candidate_index ?? -1) - Number(a.ref.candidate_index ?? -1));
}

function _dbOptionDeleteConfigKey(config) {
  const ordered = value => Array.isArray(value) ? value.map(ordered)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
  return JSON.stringify(ordered(config || {}));
}

async function _dbRestoreDeletedOptionWrites(writes) {
  const restored = [];
  const remaining = [];
  const entities = new Map();
  // 履歴作成後に別画面で値が変わっていた場合は、その値を上書きしない。
  for (const write of writes.filter(item => item.nextValue)) {
    const ref = { ...write.ref };
    const path = ref.entry_path || ref.file;
    if (!entities.has(path)) entities.set(path, await apiFetch('/entity?path=' + encodeURIComponent(path),
      { skipBrowseCache: true, cache: 'reload' }));
    if (ref.candidate_index != null) {
      ref.candidate_index -= writes.filter(item => !item.nextValue && item.ref.file === ref.file
        && item.ref.candidate_index < write.ref.candidate_index).length;
    }
    const current = entities.get(path).properties?.[ref.property] || [];
    const saved = ref.candidate_index != null ? current[ref.candidate_index] : current.find(value => value.file === ref.file);
    if (!saved || String(saved.value ?? '') !== write.nextValue) throw new Error('対象の値が変更されています。再読み込みして確認してください');
    ref.entry_revision = entities.get(path).revision ?? saved.entry_revision ?? ref.entry_revision;
    remaining.push({ ref, write });
  }
  try {
    // 削除後の候補番号に補正してから、残っている複数選択の値を戻す。
    for (const { ref, write } of remaining) {
      await _apiPutValue(ref, { new_value: write.oldValue });
      restored.push({ ref, write, created: false });
    }
    for (const write of [...writes].reverse().filter(item => !item.nextValue)) {
      const old = write.ref;
      const result = await _apiPostValue(old.entry_path || old.file, old.property, write.oldValue,
        old.status || '採用', old.note || '', old.rich_html, old);
      restored.push({ ref: { ...old, file: result.path || old.file,
        candidate_id: result?.candidate_id, entry_id: result?.entry_id, candidate_index: result.candidate_index, entry_revision: result.revision }, write, created: true });
    }
  } catch (error) {
    // Undoの途中で失敗しても、成功した分だけ復元された状態を残さない。
    const failures = [];
    for (const item of restored.reverse()) {
      try { await _apiPutValue(item.ref, item.created ? { _delete: true } : { new_value: item.write.nextValue }); }
      catch (rollbackError) { failures.push(rollbackError); }
    }
    if (failures.length) {
      const failed = new Error('値の復元に失敗しました。再読み込みして保存状態を確認してください');
      failed.cause = error;
      throw failed;
    }
    throw error;
  }
}

async function _dbApplyDeletedOptionWrites(writes) {
  const completed = [];
  try {
    for (const write of writes) {
      await _apiPutValue(write.ref, write.nextValue ? { new_value: write.nextValue } : { _delete: true });
      completed.push(write);
    }
  } catch (error) {
    await _dbRestoreDeletedOptionWrites(completed);
    throw error;
  }
}

async function deleteDbSelectOptionAndSave(dbPath, propName, option, ctx, beforeConfirm) {
  let committed = false;
  try {
    const lockMessage = typeof checkColumnEditable === 'function' ? checkColumnEditable(dbPath, propName, ctx) : '';
    if (lockMessage) throw new Error(lockMessage);
    await flushPendingDbColorSaves(dbPath);
    let before = JSON.parse(JSON.stringify(getPropertyTypes(dbPath, ctx)?.[propName] || {}));
    const optionType = String(before.type || '').replace(/_/g, '-');
    if (!['select', 'multi-select'].includes(optionType) || before.optionSource) throw new Error('この選択肢は参照元で変更してください');
    const protection = _dbOptionColorProtectionReason(typeof _dbSchemaProtectionLevel === 'function'
      ? _dbSchemaProtectionLevel(dbPath, propName) : null);
    if (protection) throw new Error(protection);
    const readWrites = async () => _dbSelectOptionDeleteWrites(await apiFetch('/pivot?path=' + encodeURIComponent(dbPath),
      { skipBrowseCache: true, cache: 'reload' }), dbPath, propName, String(option), optionType);
    let writes = await readWrites();
    beforeConfirm?.();
    if (!await cfConfirm(`選択肢「${option}」を削除しますか？\nこの選択肢を含む${writes.length}件の値からも削除します。複数選択の他の値は残ります。`,
      { danger: true, okLabel: '削除' })) return false;
    let after = JSON.parse(JSON.stringify(before));
    after.options = (after.options || []).filter(value => value !== option);
    if (after.optionColors) delete after.optionColors[option];
    if (after.option_ids) delete after.option_ids[option];
    const saveConfig = async config => {
      const restoring = config === before;
      if (await setPropertyType(dbPath, propName, JSON.parse(JSON.stringify(config)), ctx) === false) {
        throw new Error('保護されている列のため変更できません');
      }
      // 保存時に付与される安定IDも、以後の競合判定と履歴へ引き継ぐ。
      const stored = JSON.parse(JSON.stringify(getPropertyTypes(dbPath, ctx)?.[propName] || config));
      if (restoring) before = stored;
      else after = stored;
    };
    const reload = async () => {
      if (typeof _ptReloadOtherDbContexts === 'function') await _ptReloadOtherDbContexts(dbPath, ctx);
      await selectDatabase(dbPath, ctx, { silent: true });
    };
    const remove = async () => {
      // 確認中・Undo後の候補番号や保存済みデータを再取得する。
      const current = await readWrites();
      const signature = item => JSON.stringify([item.ref.entry_id || item.ref.entry_path || item.ref.file,
        item.oldValue, item.ref.status || '', item.ref.note || '']);
      const expected = new Map();
      writes.forEach(item => expected.set(signature(item), (expected.get(signature(item)) || 0) + 1));
      current.forEach(item => expected.set(signature(item), (expected.get(signature(item)) || 0) - 1));
      if ([...expected.values()].some(count => count < 0)) throw new Error('対象の値が変更されています。もう一度削除してください');
      if (_dbOptionDeleteConfigKey(getPropertyTypes(dbPath, ctx)?.[propName]) !== _dbOptionDeleteConfigKey(before)) {
        throw new Error('列設定が変更されています。もう一度削除してください');
      }
      await _dbApplyDeletedOptionWrites(current);
      try { await saveConfig(after); }
      catch (error) { await _dbRestoreDeletedOptionWrites(current); throw error; }
      writes = current;
    };
    await remove();
    committed = true;
    historyPush('選択肢削除: ' + propName + '=' + option,
      async () => {
        if (_dbOptionDeleteConfigKey(getPropertyTypes(dbPath, ctx)?.[propName]) !== _dbOptionDeleteConfigKey(after)) {
          throw new Error('列設定が変更されています。再読み込みして確認してください');
        }
        await saveConfig(before);
        try { await _dbRestoreDeletedOptionWrites(writes); }
        catch (error) { await saveConfig(after); throw error; }
        await reload();
      },
      async () => { await remove(); await reload(); }, _dbScope(dbPath));
    await reload();
    showStatus('選択肢「' + option + '」を削除しました');
    return true;
  } catch (error) {
    showStatus((committed ? '選択肢は削除しましたが、表示更新に失敗: ' : '選択肢の削除に失敗: ') + (error?.message || error), true);
    return false;
  }
}

function appendDbOptionDeleteButton(item, opts) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'gb-btn gb-btn-sm gb-btn-icon gb-btn-quiet db-option-delete';
  button.dataset.e2eId = 'db-select-option-delete';
  button.setAttribute('aria-label', opts.option + ' を選択肢から削除');
  button.title = '選択肢から削除';
  button.innerHTML = lucide('trash-2', 14);
  const config = getPropertyTypes(opts.dbPath, opts.ctx)?.[opts.propName] || {};
  const reason = config.optionSource ? '動的な選択肢は参照元で変更してください'
    : _dbOptionColorProtectionReason(typeof _dbSchemaProtectionLevel === 'function'
      ? _dbSchemaProtectionLevel(opts.dbPath, opts.propName) : null);
  if (reason) { button.disabled = true; button.title = reason; }
  button.addEventListener('pointerdown', event => event.stopPropagation());
  button.addEventListener('click', async event => {
    event.stopPropagation();
    button.disabled = true;
    await deleteDbSelectOptionAndSave(opts.dbPath, opts.propName, opts.option, opts.ctx, opts.beforeConfirm);
    button.disabled = Boolean(reason);
  });
  item.classList.add('db-select-option-row');
  item.appendChild(button);
  return button;
}

// プロパティ設定画面: 選択肢の色エディタを描画する。
// container: #pt-select-option-colors のような描画先div
// scope: onPropertyTypeChange 等が使う [data-pt-root] 要素（_ptGet/_ptState の解決対象と同じもの）
// 作業バッファは scope._dbOptionColorBuffer に保持し、window._pt* へは触れない
function renderDbOptionColorEditor(container, scope) {
  if (!container || !scope) return null;
  const stateInfo = typeof _ptState === 'function' ? _ptState(scope) : null;
  const current = stateInfo?.current || {};
  const protectionLevel = typeof _dbSchemaProtectionLevel === 'function'
    ? _dbSchemaProtectionLevel(stateInfo?.dbPath, stateInfo?.propName) : null;
  const protectionReason = _dbOptionColorProtectionReason(protectionLevel);
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
      if (protectionReason) {
        swatch.disabled = true;
        swatch.title = protectionReason;
        swatch.setAttribute('aria-label', `${opt}の色は変更できません。${protectionReason}`);
      }
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

// 列設定パネル: 選択肢を1項目ずつ編集し、色・複製・削除も同じ行で扱う。
// hidden textarea は保存処理との互換レイヤーとして維持し、UI操作のたびに同期する。
function renderDbSelectOptionRows(container, scope) {
  if (!container || !scope) return null;
  const stateInfo = typeof _ptState === 'function' ? _ptState(scope) : {};
  const current = stateInfo?.current || {};
  const protectionLevel = typeof _dbSchemaProtectionLevel === 'function'
    ? _dbSchemaProtectionLevel(stateInfo?.dbPath, stateInfo?.propName) : null;
  const protectionReason = _dbOptionColorProtectionReason(protectionLevel);
  const textarea = typeof _ptGet === 'function'
    ? _ptGet('pt-select-options', scope)
    : scope.querySelector?.('#pt-select-options');
  const addButton = typeof _ptGet === 'function'
    ? _ptGet('pt-select-option-add', scope)
    : scope.querySelector?.('#pt-select-option-add');
  if (!textarea) return null;
  if (!scope._dbOptionColorBuffer) scope._dbOptionColorBuffer = { ...(current.optionColors || {}) };
  if (!scope._dbOptionStyleBuffer) scope._dbOptionStyleBuffer = { ...(current.optionStyles || {}) };
  const buffer = scope._dbOptionColorBuffer;
  const styleBuffer = scope._dbOptionStyleBuffer;
  const used =new Set((stateInfo?.existing || []).flatMap(value => {
    const raw = String(value ?? '').trim();
    return stateInfo?.current?.type === 'multi-select' ? raw.split(',').map(v => v.trim()).filter(Boolean) : (raw ? [raw] : []);
  }));

  const readOptions = () => {
    const seen = new Set();
    return textarea.value.split('\n').map(value => value.trim()).filter(value => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  };
  const writeOptions = (options) => {
    textarea.value = options.join('\n');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const uniqueCopyName = (base, options) => {
    let candidate = `${base} のコピー`;
    let index = 2;
    while (options.includes(candidate)) candidate = `${base} のコピー ${index++}`;
    return candidate;
  };
  const uniqueNewName = (options) => {
    let index = options.length + 1;
    let candidate = `選択肢 ${index}`;
    while (options.includes(candidate)) candidate = `選択肢 ${++index}`;
    return candidate;
  };

  const renderRows = (focusName) => {
    const options = readOptions();
    container.innerHTML = '';
    options.forEach((option, optionIndex) => {
      const row = document.createElement('div');
      row.className = 'pt-select-option-row';
      row.dataset.e2eId = `pt-select-option-row-${optionIndex}`;
      row.dataset.reorderKey = option;
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'gb-btn gb-btn-sm gb-btn-icon gb-btn-quiet pt-option-drag-handle';
      handle.innerHTML = lucide('gripVertical', 14);
      handle.disabled = Boolean(protectionReason || current.optionSource);
      _dbBindReorderHandle(handle, {
        label: option, key: option, root: container, selector: '.pt-select-option-row',
        keys: readOptions, disabled: () => handle.disabled,
        commit: next => { writeOptions(next); renderRows(option); },
      });
      row.appendChild(handle);

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'pt-select-option-input';
      input.dataset.e2eId = `pt-select-option-input-${optionIndex}`;
      input.value = option;
      input.setAttribute('aria-label', `選択肢 ${optionIndex + 1}`);
      if (protectionReason) input.disabled = true;
      input.addEventListener('change', () => {
        const next = input.value.trim();
        const latest = readOptions();
        const duplicate = latest.some((value, index) => index !== optionIndex && value === next);
        if (!next || duplicate) {
          input.value = option;
          if (typeof showStatus === 'function') showStatus(!next ? '空の選択肢は保存できません' : '同じ名前の選択肢があります', true);
          return;
        }
        latest[optionIndex] = next;
        if (Object.prototype.hasOwnProperty.call(buffer, option)) {
          buffer[next] = buffer[option];
          delete buffer[option];
        }
        if (Object.prototype.hasOwnProperty.call(styleBuffer, option)) {
          styleBuffer[next] = styleBuffer[option];
          delete styleBuffer[option];
        }
        writeOptions(latest);
        renderRows(next);
      });
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
        if (event.key === 'Escape') { event.preventDefault(); input.value = option; input.blur(); }
      });
      row.appendChild(input);

      // セルでの見た目そのままのチップ。クリックで書式設定ポップアップ（背景色・文字色など）。
      row.insertBefore(
        _dbCreateOptionPreviewChip(scope, option, optionIndex, stateInfo?.current?.type === 'multi-select', protectionReason),
        input,
      );

      const duplicateButton = document.createElement('button');
      duplicateButton.type = 'button';
      duplicateButton.className = 'gb-icon-btn pt-select-option-action';
      duplicateButton.dataset.e2eId = `pt-select-option-duplicate-${optionIndex}`;
      duplicateButton.title = `${option}を複製`;
      duplicateButton.setAttribute('aria-label', `${option}を複製`);
      duplicateButton.innerHTML = typeof lucide === 'function' ? lucide('copy', 14) : '複製';
      if (protectionReason) duplicateButton.disabled = true;
      duplicateButton.addEventListener('click', () => {
        const latest = readOptions();
        const name = uniqueCopyName(option, latest);
        latest.splice(optionIndex + 1, 0, name);
        if (buffer[option]) buffer[name] = buffer[option];
        if (styleBuffer[option]) styleBuffer[name] = { ...styleBuffer[option] };
        writeOptions(latest);
        renderRows(name);
      });
      row.appendChild(duplicateButton);

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'gb-icon-btn pt-select-option-action';
      deleteButton.dataset.e2eId = `pt-select-option-delete-${optionIndex}`;
      deleteButton.title = used.has(option) ? '使用中の選択肢は削除できません' : `${option}を削除`;
      deleteButton.setAttribute('aria-label', deleteButton.title);
      deleteButton.innerHTML = typeof lucide === 'function' ? lucide('trash-2', 14) : '削除';
      if (protectionReason || used.has(option)) deleteButton.disabled = true;
      deleteButton.addEventListener('click', () => {
        const latest = readOptions();
        latest.splice(optionIndex, 1);
        delete buffer[option];
        delete styleBuffer[option];
        writeOptions(latest);
        renderRows();
      });
      row.appendChild(deleteButton);
      container.appendChild(row);
    });
    if (!options.length) {
      const empty = document.createElement('div');
      empty.className = 'pt-hint';
      empty.textContent = '選択肢はまだありません。';
      container.appendChild(empty);
    }
    if (focusName) {
      const target = [...container.querySelectorAll('.pt-select-option-input')].find(input => input.value === focusName);
      target?.focus();
      target?.select();
    }
  };

  if (addButton && !addButton._dbSelectOptionBound) {
    addButton._dbSelectOptionBound = true;
    if (protectionReason) {
      addButton.disabled = true;
      addButton.title = protectionReason;
    }
    addButton.addEventListener('click', () => {
      const options = readOptions();
      const name = uniqueNewName(options);
      options.push(name);
      writeOptions(options);
      renderRows(name);
    });
  }
  renderRows();
  return buffer;
}

// 列内の全エントリが実際に持つ値を、初出順・重複なしで収集する。
// セレクト/マルチセレクトの候補ドロップダウンと列タイプ設定の選択肢一覧に、
// スキーマ未登録の実在値（型変更前の入力・外部書き込み等）も出すために使う。
// opts.splitCsv: マルチセレクトのカンマ結合値を個別値へ分割する
function collectDbColumnValues(pivotData, propName, opts) {
  const out = [];
  const seen = new Set();
  const push = (value) => {
    const v = String(value ?? '').trim();
    if (v && !seen.has(v)) { seen.add(v); out.push(v); }
  };
  const entities = pivotData?.entities;
  if (!entities || !propName) return out;
  Object.values(entities).forEach(ent => {
    const values = Array.isArray(ent?.[propName]) ? ent[propName] : [];
    values.forEach(v => {
      const raw = String(v?.value ?? '').trim();
      if (!raw) return;
      if (opts?.splitCsv) raw.split(',').forEach(push);
      else push(raw);
    });
  });
  return out;
}

// 保存直前に呼ぶ: scope の作業バッファ（無ければ prevColors）から有効な色だけを集めて返す。
// 候補の入力途中では色を失わないよう、確定した候補への絞り込みは候補移行後に行う。
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

// --- 選択肢・チップの書式（背景色・文字色・枠線色・太字・斜体・取消線）: 2026-11-09 ---
// 値別の変更は色だけ。旧い optionStyles / chipStyle の非色指定は、元データを読み取って
// タイプ別テーマへ移行する。背景色の16進数は旧版互換の optionColors にも書き続ける。
const DB_CHIP_FORMAT_FIELDS = ['textColor', 'borderColor', 'bgColor'];
const DB_CHIP_STYLE_TYPES = new Set(['relation', 'multi-relation', 'common-tags', 'rollup']);

function _dbChipCssColorValid(value) {
  return typeof value === 'string'
    && /^(#[0-9a-fA-F]{3,8}|rgba?\([0-9\s.,%]+\)|hsla?\([0-9\s.,%deg]+\)|transparent)$/.test(value.trim());
}

function normalizeDbChipStyle(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  ['bgColor', 'textColor', 'borderColor'].forEach(key => {
    if (_dbChipCssColorValid(raw[key])) out[key] = raw[key].trim();
  });
  if (raw.fontWeight === 'bold') out.fontWeight = 'bold';
  if (raw.fontStyle === 'italic') out.fontStyle = 'italic';
  if (raw.strike === true) out.strike = true;
  return out;
}

function _dbChipStyleIsEmpty(style) {
  return !style || !Object.keys(style).length;
}

// 選択肢の表示書式。optionStyles が無い選択肢は旧来の optionColors（背景色）だけを使う。
function getDbOptionStyle(ptc, value) {
  if (!ptc || value == null) return {};
  const style = normalizeDbChipStyle(ptc.optionStyles?.[String(value)]);
  delete style.fontWeight;
  delete style.fontStyle;
  delete style.strike;
  if (!style.bgColor) {
    const hex = getDbOptionColor(ptc, value);
    if (hex) style.bgColor = hex;
  }
  return style;
}

// 旧い値・列別書式は元データを残し、未指定のタイプ別テーマへ一度だけ引き継ぐ。
// 同タイプで異なる指定は列・候補の表示順で最初の指定を採る（元の指定は消さない）。
function _dbLegacyChipTheme(metadata) {
  const current = metadata?.style || metadata?.theme || {};
  if (current.__chipTypeMigration) return {};
  const migrated = {};
  const ids = { select: 'select', 'multi-select': 'multi', relation: 'relation',
    'multi-relation': 'multi-relation', 'multi-source-relation': 'multi-source-relation',
    rollup: 'rollup', 'common-tags': 'tag', user: 'user', 'multi-user': 'multi-user', status: 'status' };
  const suffixes = { bgColor: 'bg', textColor: 'fg', borderColor: 'border-color',
    fontWeight: 'bold', fontStyle: 'italic', strike: 'strike' };
  Object.values(metadata?.property_types || {}).forEach(config => {
    const id = ids[config?.type];
    if (!id) return;
    if (id === 'multi-relation') {
      ['fg', 'bg', 'bold', 'italic', 'strike', 'font-size', 'radius', 'padding-x', 'border-color', 'border-width'].forEach(suffix => {
        const key = `--db-option-multi-relation-${suffix}`;
        if (current[key] == null && current[`--db-option-relation-${suffix}`] != null) migrated[key] = current[`--db-option-relation-${suffix}`];
      });
    }
    const styles = [config.chipStyle, ...(Array.isArray(config.options) ? config.options : []).map(value => config.optionStyles?.[value]), ...Object.values(config.optionStyles || {})];
    styles.forEach((raw, index) => Object.entries(normalizeDbChipStyle(raw)).forEach(([prop, value]) => {
      if (index > 0 && ['bgColor', 'textColor', 'borderColor'].includes(prop)) return;
      const key = `--db-option-${id}-${suffixes[prop]}`;
      if (current[key] == null && migrated[key] == null) migrated[key] = prop === 'strike' ? 'line-through' : value;
      if (prop === 'borderColor' && current[`--db-option-${id}-border-width`] == null) migrated[`--db-option-${id}-border-width`] = '1px';
    }));
  });
  return migrated;
}

// チップ要素へ書式を直接適用する。文字色の指定が無く背景色が16進数なら、従来どおり読みやすい白/黒を選ぶ。
function applyDbChipStyle(el, rawStyle) {
  if (!el) return;
  const style = normalizeDbChipStyle(rawStyle);
  ['background', 'background-color', 'color', 'font-weight', 'font-style', 'text-decoration', 'box-shadow']
    .forEach(prop => el.style.removeProperty(prop));
  if (style.bgColor) el.style.background = style.bgColor;
  if (style.textColor) el.style.color = style.textColor;
  else if (style.bgColor) {
    const fg = dbOptionTextColorFor(style.bgColor);
    if (fg) el.style.color = fg;
  }
  if (style.borderColor) el.style.setProperty('--db-value-border-color', style.borderColor);
  else el.style.removeProperty('--db-value-border-color');
}

// タグ・リレーション・ロールアップ: 値の外枠へCSS変数を置き、中のチップ／行へCSSで反映する。
function applyDbColumnChipStyle(el, ptc) {
  if (!el) return;
  // 旧い列全体の書式はタイプ別テーマへ移行済み。値側からは上書きしない。
  const style = {};
  const vars = {
    '--db-chip-bg': style.bgColor || '',
    '--db-chip-fg': style.textColor || (style.bgColor ? dbOptionTextColorFor(style.bgColor) : ''),
    '--db-chip-border': style.borderColor || '',
    '--db-chip-weight': style.fontWeight || '',
    '--db-chip-font-style': style.fontStyle || '',
    '--db-chip-decoration': style.strike ? 'line-through' : '',
  };
  Object.entries(vars).forEach(([name, value]) => {
    if (value) el.style.setProperty(name, value);
    else el.style.removeProperty(name);
  });
  el.classList.toggle('db-chip-styled', !_dbChipStyleIsEmpty(style));
  const flags = {
    chipBg: vars['--db-chip-bg'],
    chipFg: vars['--db-chip-fg'],
    chipBorder: vars['--db-chip-border'],
    chipWeight: vars['--db-chip-weight'],
    chipFontStyle: vars['--db-chip-font-style'],
    chipDecoration: vars['--db-chip-decoration'],
  };
  Object.entries(flags).forEach(([key, value]) => {
    if (value) el.dataset[key] = '1';
    else delete el.dataset[key];
  });
}

// 書式設定ポップアップを開く。値の名前は共通ポップアップと同じ（fontWeight/fontStyle/strike 等）。
function openDbChipFormatPopup(anchorEl, initialStyle, onStyleChange) {
  if (typeof openFormatPopup !== 'function') {
    if (typeof showStatus === 'function') showStatus('書式設定を利用できません', true);
    return null;
  }
  const values = { ...normalizeDbChipStyle(initialStyle) };
  return openFormatPopup(anchorEl, {
    className: 'db-chip-format-popup',
    fields: DB_CHIP_FORMAT_FIELDS,
    values: { ...values },
    onChange: (prop, value) => {
      if (value === '' || value == null || value === false) delete values[prop];
      else values[prop] = value;
      onStyleChange(normalizeDbChipStyle(values));
    },
    onReset: () => {
      Object.keys(values).forEach(key => delete values[key]);
      onStyleChange({});
    },
  });
}

// 列設定パネルの選択肢プレビュー（チップの見た目そのまま。クリックで書式設定ポップアップ）
function _dbCreateOptionPreviewChip(scope, option, optionIndex, multi, protectionReason) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = `${multi ? 'multi-select-tag' : 'cell-select-val'} pt-select-option-preview`;
  chip.dataset.e2eId = `pt-select-option-preview-${optionIndex}`;
  chip.textContent = option;
  const info = typeof _ptState === 'function' ? _ptState(scope) : {};
  _dbApplyChipTypeTheme(chip, info.dbPath, info.ctx);
  chip.title = protectionReason || `${option} の色を設定`;
  chip.setAttribute('aria-label', protectionReason ? `${option}の色は変更できません。${protectionReason}` : `${option}の色を設定`);
  if (protectionReason) chip.disabled = true;
  const currentStyle = () => {
    const colors = scope._dbOptionColorBuffer || {};
    const styles = scope._dbOptionStyleBuffer || {};
    const style = getDbOptionStyle({ optionStyles: styles, optionColors: colors }, option);
    if (!style.bgColor && _dbOptionColorIsValidHex(colors[option])) style.bgColor = colors[option].trim();
    return style;
  };
  applyDbChipStyle(chip, currentStyle());
  chip.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openDbChipFormatPopup(chip, currentStyle(), (style) => {
      if (!scope._dbOptionStyleBuffer) scope._dbOptionStyleBuffer = {};
      if (!scope._dbOptionColorBuffer) scope._dbOptionColorBuffer = {};
      if (_dbChipStyleIsEmpty(style)) delete scope._dbOptionStyleBuffer[option];
      else scope._dbOptionStyleBuffer[option] = style;
      if (_dbOptionColorIsValidHex(style.bgColor)) scope._dbOptionColorBuffer[option] = style.bgColor.trim();
      else delete scope._dbOptionColorBuffer[option];
      applyDbChipStyle(chip, style);
      try { scope.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
    });
  });
  return chip;
}

// 保存直前に呼ぶ: 選択肢ごとの書式（optionStyles）を作業バッファから集める。
function collectDbOptionStyles(scope, prevStyles) {
  const buffer = (scope && scope._dbOptionStyleBuffer) || prevStyles || {};
  const out = {};
  Object.keys(buffer).forEach(key => {
    const style = normalizeDbChipStyle(buffer[key]);
    if (!_dbChipStyleIsEmpty(style)) out[key] = style;
  });
  return out;
}

// 保存直前に呼ぶ: タグ・リレーション・ロールアップ列のチップ書式（chipStyle）。
function collectDbColumnChipStyle(scope, prevStyle) {
  const source = scope && Object.prototype.hasOwnProperty.call(scope, '_dbChipStyleBuffer')
    ? scope._dbChipStyleBuffer
    : prevStyle;
  return normalizeDbChipStyle(source);
}

// 列設定パネル: タグ・リレーション・ロールアップ列の「表示」欄。列内の実際の値を
// チップの見た目どおりに並べ、クリックで列全体のチップ書式を設定する。
function renderDbColumnChipStyleField(optDiv, scope, type) {
  // 形と書式の入口はテーマパネルのタイプ別見本に統一する。
  return null;
}
