/* gb-db-option-color.js
   セレクト / マルチセレクトの選択肢（option）ごとの色設定。
   - 色の保存場所: property_types[propName].optionColors = { [option値]: '#rrggbb' }
   - options 配列自体は文字列のまま変更しない（追加のみの互換変更）
   - プロパティ設定画面とセル編集ドロップダウンの両方から共通カラーパレットで変更できる
   - 候補名の確定保存時に色も同じ変更としてリネーム/削除する
*/

const _dbPendingColorSaves = new Map();
const _dbColorSaveQueues = new Map();

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
        const previous = _dbColorSaveQueues.get(key);
        promise = Promise.resolve(previous).catch(() => {}).then(save).finally(() => {
          if (_dbPendingColorSaves.get(sw) === pending) _dbPendingColorSaves.delete(sw);
          if (_dbColorSaveQueues.get(key) === promise) _dbColorSaveQueues.delete(key);
        });
        _dbColorSaveQueues.set(key, promise);
      }
      return promise;
    },
  };
  _dbPendingColorSaves.set(sw, pending);
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
  const views = contexts.filter(item => item?.containerEl).map(item => ({ root: item.containerEl, ctx: item }));
  if (!views.length && typeof document !== 'undefined') views.push({ root: document, ctx });

  views.forEach(({ root, ctx }) => {
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
  const buffer = scope._dbOptionColorBuffer;
  const used = new Set((stateInfo?.existing || []).flatMap(value => {
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
        writeOptions(latest);
        renderRows(next);
      });
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
        if (event.key === 'Escape') { event.preventDefault(); input.value = option; input.blur(); }
      });
      row.appendChild(input);

      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'gb-fmt-swatch pt-select-option-color';
      swatch.dataset.e2eId = `pt-select-option-color-${optionIndex}`;
      swatch.title = `${option} の色`;
      swatch.setAttribute('aria-label', `${option}の色を選択`);
      if (protectionReason) swatch.disabled = true;
      row.appendChild(swatch);
      if (typeof setColorSwatchValue === 'function') setColorSwatchValue(swatch, buffer[option] || '');
      if (typeof bindColorSwatch === 'function') {
        bindColorSwatch(swatch, () => buffer[option] || '', color => {
          if (_dbOptionColorIsValidHex(color)) buffer[option] = color.trim();
          else delete buffer[option];
          if (typeof setColorSwatchValue === 'function') setColorSwatchValue(swatch, buffer[option] || '');
          scope.dispatchEvent(new Event('input', { bubbles: true }));
        });
      }

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
