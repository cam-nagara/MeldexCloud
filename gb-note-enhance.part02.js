// === 後方互換エイリアス（他モジュール・HTML からの呼び出しを壊さない） ===
function applyFileTheme(theme) { return applyFileStyle(theme); }
function applyFileThemeToPanel(theme, panelId) { return applyFileStyleToPanel(theme, panelId); }
function clearFileTheme() { return clearFileStyle(); }
function saveFileThemePreset(name, theme) { return saveFileStylePreset(name, theme); }
function _parseFileThemeFromFrontmatter(fmStr) { return _parseFileStyleFromFrontmatter(fmStr); }
function _getFileThemePresets() { return _getFileStylePresets(); }
function _getCurrentFileTheme() { return _getCurrentFileStyle(); }

function _saveFileTheme(theme) {
  const ctx = _getCurrentFileStyleContext();
  if (ctx === 'scriptnote') {
    const ed = _getScriptNoteEditorForFileStyle();
    if (!ed?.doc) return;
    if (!ed.doc.editor) ed.doc.editor = {};
    Object.keys(ed.doc.editor).forEach((key) => {
      if (_SCRIPTNOTE_REMOVED_FILE_STYLE_KEYS.includes(key) || _isScriptnoteFileStyleKey(key)) delete ed.doc.editor[key];
    });
    const next = _filterScriptnoteFileStyle(theme);
    Object.entries(_SCRIPTNOTE_FILE_STYLE_DEFAULTS).forEach(([key, value]) => {
      if (next[key] === undefined) ed.doc.editor[key] = value;
    });
    Object.entries(next).forEach(([key, value]) => {
      ed.doc.editor[key] = value;
    });
    if (typeof ed._render === 'function') ed._render();
    if (typeof ed._markDirty === 'function') ed._markDirty();
    _refreshCurrentFileStyleUi(ctx);
    return;
  }
  const view = state?.view || '';
  if (view === 'folder') {
    _saveFolderFileStyle(theme);
  } else if (view === 'page') {
    _saveFileThemeToNoteFrontmatter(theme);
  } else if (view === 'board') {
    // キャンバスのフロントマター保存はbdSave()に委ねる（bd._fileStyleを設定）
    if (typeof bd !== 'undefined') {
      bd._fileStyle = (theme && Object.keys(theme).length > 0) ? theme : null;
      bd.dirty = true;
      if (typeof bdSave === 'function') bdSave();
    }
  } else if (_isDbFileStyleView(view)) {
    _saveFileThemeToDbFolderNote(theme);
  }
}

let _dbFolderNoteStyleSaveQueue = Promise.resolve();

function _syncDbMetadataFileStyle(theme) {
  if (!state?.dbMetadata) return;
  if (theme && Object.keys(theme).length > 0) {
    state.dbMetadata.style = _cloneFileStyleObject(theme);
    delete state.dbMetadata.theme;
  } else {
    delete state.dbMetadata.style;
    delete state.dbMetadata.theme;
  }
}

function _saveFileThemeToNoteFrontmatter(theme) {
  const pc = document.getElementById('page-content');
  if (!pc) return;
  let fmStr = pc.dataset.frontmatter || '';
  // 書込時は必ず style: に統一し、旧 theme: ブロックは除去する（同ファイル内の重複防止）
  fmStr = fmStr.replace(/theme:\s*\n(?:\s+--[^\n]+\n?)*/m, '');
  const styleYaml = _fileStyleToYaml(theme);
  if (styleYaml) {
    if (_fileStyleBlockRegex().test(fmStr)) {
      fmStr = fmStr.replace(_fileStyleBlockRegex(), styleYaml);
    } else if (fmStr.startsWith('---')) {
      fmStr = fmStr.replace(/\r?\n---\r?\n?$/, '\n' + styleYaml + '---\n');
    } else {
      fmStr = '---\n' + styleYaml + '---\n';
    }
  } else {
    fmStr = fmStr.replace(_fileStyleBlockRegex(), '');
    if (fmStr.replace(/---\r?\n\s*---\r?\n?/, '').trim() === '') fmStr = '';
  }
  pc.dataset.frontmatter = fmStr;
  pc.dispatchEvent(new Event('input'));
}

function _saveFileThemeToDbFolderNote(theme) {
  const dbPath = state?.currentDbPath;
  if (!dbPath) return Promise.resolve();
  const themeSnapshot = _cloneFileStyleObject(theme);
  const saveTask = async () => {
  // フォルダノートのフロントマターをAPI経由で更新
    const folderName = dbPath.split('/').pop();
    const notePath = dbPath + '/' + folderName + '.md';
    try {
      const data = await apiFetch('/file?path=' + encodeURIComponent(notePath));
      let content = data.content || '';
      const styleYaml = _fileStyleToYaml(themeSnapshot);
      // フロントマター部分のみ操作（本文の style:/theme: と誤マッチ防止）
      const fmMatch = content.match(/^(---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?)/);
      if (fmMatch) {
        let fm = fmMatch[1];
        // 旧 theme: ブロックは必ず除去
        fm = fm.replace(/theme:\s*\n(?:\s+--[^\n]+\n?)*/m, '');
        if (_fileStyleBlockRegex().test(fm)) {
          fm = fm.replace(_fileStyleBlockRegex(), styleYaml);
        } else if (styleYaml) {
          fm = fm.replace(/\r?\n---\r?\n?$/, '\n' + styleYaml + '---\n');
        }
        content = fm + content.substring(fmMatch[1].length);
      } else if (styleYaml) {
        content = '---\n' + styleYaml + '---\n' + content;
      }
      await apiPut('/file?path=' + encodeURIComponent(notePath), {
        content,
        if_match_etag: data.etag || '',
        transport_revision: data.transport_revision || '',
      });
      if (state?.currentDbPath === dbPath) _syncDbMetadataFileStyle(themeSnapshot);
      showStatus('DBテーマを保存しました');
    } catch (e) { showStatus('テーマ保存に失敗しました', true); }
  };
  _dbFolderNoteStyleSaveQueue = _dbFolderNoteStyleSaveQueue.catch(() => {}).then(saveTask);
  return _dbFolderNoteStyleSaveQueue;
}

// ============================================================
// 5. コピーボタン（コードブロック・コールアウト）
// ============================================================
function _noteEnhanceRenderIcon(name, size = 14, fallback = '') {
  return typeof lucide === 'function' ? lucide(name, size) : fallback;
}

function _noteEnhanceSetCopyButtonIcon(btn, name, label) {
  if (!btn) return;
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.innerHTML = _noteEnhanceRenderIcon(name, 14, label);
}

function _initCopyButton() {
  document.addEventListener('mouseover', (e) => {
    const codeBlock = e.target.closest('#page-content pre, #entity-freetext pre');
    const callout = e.target.closest('#page-content .callout-block, #entity-freetext .callout-block');
    const target = codeBlock || callout;
    if (!target) return;
    if (target.querySelector('.copy-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.type = 'button';
    btn.dataset.e2eId = codeBlock ? 'note-copy-button-code' : 'note-copy-button-callout';
    btn.contentEditable = 'false';
    _noteEnhanceSetCopyButtonIcon(btn, 'copy', 'コピー');
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      const text = codeBlock
        ? (codeBlock.querySelector('code')?.textContent || codeBlock.textContent)
        : (callout.querySelector('.callout-body')?.textContent || callout.textContent);
      navigator.clipboard.writeText(text).then(() => {
        _noteEnhanceSetCopyButtonIcon(btn, 'check', 'コピーしました');
        setTimeout(() => { _noteEnhanceSetCopyButtonIcon(btn, 'copy', 'コピー'); }, 1500);
      });
    });

    target.style.position = 'relative';
    target.appendChild(btn);
  });

  document.addEventListener('mouseout', (e) => {
    const target = e.target.closest('pre, .callout-block');
    if (!target) return;
    const related = e.relatedTarget;
    if (target.contains(related)) return;
    const btn = target.querySelector('.copy-btn');
    if (btn) btn.remove();
  });
}
_initCopyButton();

// タッチ対応: touchstart でもコピーボタン表示
document.addEventListener('touchstart', (e) => {
  const target = e.target.closest('#page-content pre, #entity-freetext pre, #page-content .callout-block, #entity-freetext .callout-block');
  if (!target || target.querySelector('.copy-btn')) return;
  // 既存のmouseoverと同じボタン生成ロジックをトリガー
  target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
}, { passive: true });

// ============================================================
// 1b. ファイルスタイル適用ヘルパー（分割サイズ調整のため後続チャンクに配置）
// ============================================================
const _FILE_STYLE_APPLIED_DATASET_KEY = 'fileStyleAppliedVars';

function _fileStyleOsAccentKey() {
  return typeof _FILE_STYLE_USE_OS_ACCENT_KEY !== 'undefined' ? _FILE_STYLE_USE_OS_ACCENT_KEY : '__useOsAccentColor';
}

function _fileStyleUsesOsAccent(style) {
  const value = style?.[_fileStyleOsAccentKey()];
  return value === true || value === 1 || value === '1' || value === 'true';
}

function _fileStyleLocalCustomThemeId() {
  return typeof _FILE_STYLE_LOCAL_CUSTOM_THEME_ID !== 'undefined'
    ? _FILE_STYLE_LOCAL_CUSTOM_THEME_ID
    : '__fileCustomTheme';
}

function _fileStyleIsLocalCustomTheme(style) {
  const themeId = style?.[_FILE_STYLE_THEME_ID_KEY] || style?.themeId || '';
  return String(themeId || '') === _fileStyleLocalCustomThemeId();
}

function _applyFileStyleOsAccentVars(vars) {
  if (typeof MeldexThemeManager === 'undefined') return;
  const accent = typeof MeldexThemeManager.getOsAccentColor === 'function' ? MeldexThemeManager.getOsAccentColor() : '';
  const text = typeof MeldexThemeManager.getOsAccentTextColor === 'function' ? MeldexThemeManager.getOsAccentTextColor() : '';
  vars['--theme-os-accent'] = accent || 'AccentColor';
  vars['--theme-os-accent-text'] = text || 'AccentColorText';
  const accentCss = 'var(--theme-os-accent, AccentColor)';
  const textCss = 'var(--theme-os-accent-text, AccentColorText)';
  (MeldexThemeManager.THEME_OS_ACCENT_STYLE_KEYS || []).forEach(key => { vars[key] = accentCss; });
  (MeldexThemeManager.THEME_OS_ACCENT_TEXT_STYLE_KEYS || []).forEach(key => { vars[key] = textCss; });
}

function _fileStyleThemeVars(style) {
  const themeId = style?.[_FILE_STYLE_THEME_ID_KEY] || style?.themeId || '';
  const useOsAccent = _fileStyleUsesOsAccent(style);
  if (_fileStyleIsLocalCustomTheme(style)) {
    const vars = {};
    if (useOsAccent) {
      _applyFileStyleOsAccentVars(vars);
      const colors = typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getOsAccentThemeColorSet === 'function'
        ? MeldexThemeManager.getOsAccentThemeColorSet()
        : [];
      if (Array.isArray(colors) && colors.length) {
        for (let i = 0; i < 10; i += 1) vars[`--theme-palette-${i}`] = colors[i % colors.length];
      } else {
        for (let i = 0; i < 10; i += 1) vars[`--theme-palette-${i}`] = 'var(--theme-os-accent, AccentColor)';
      }
    }
    return vars;
  }
  if (typeof MeldexThemeManager === 'undefined') return {};
  const themeDef = themeId && typeof MeldexThemeManager.getThemeById === 'function' ? MeldexThemeManager.getThemeById(themeId) : null;
  const vars = { ...(themeDef?.ui?.cssVars || {}) };
  if (useOsAccent) {
    _applyFileStyleOsAccentVars(vars);
  }
  if (typeof MeldexThemeManager.getThemeColorSet === 'function') {
    const colors = useOsAccent
      ? (typeof MeldexThemeManager.getOsAccentThemeColorSet === 'function' ? MeldexThemeManager.getOsAccentThemeColorSet() : [])
      : (themeDef ? MeldexThemeManager.getThemeColorSet(themeDef, { ignoreOsAccent: true }) : []);
    if (Array.isArray(colors) && colors.length) {
      for (let i = 0; i < 10; i += 1) vars[`--theme-palette-${i}`] = colors[i % colors.length];
    }
    if (useOsAccent && (!Array.isArray(colors) || !colors.length)) {
      for (let i = 0; i < 10; i += 1) vars[`--theme-palette-${i}`] = 'var(--theme-os-accent, AccentColor)';
    }
  }
  return vars;
}

function _fileStyleCssVars(style) {
  const vars = {};
  if (!style || typeof style !== 'object') return vars;
  Object.entries(style).forEach(([key, value]) => {
    if (!key.startsWith('--') || value === undefined || value === null || value === '') return;
    if (_fileStyleUsesOsAccent(style) && key.startsWith('--theme-palette-')) return;
    if (_fileStyleIsCommonIntegratedKey(key)) return;
    vars[key] = typeof normalizeStyleSettingValue === 'function' ? normalizeStyleSettingValue(key, value) : value;
  });
  return vars;
}

function _fileStyleIsCommonIntegratedKey(key) {
  if (typeof COMMON_THEME_SURFACE_STYLE_KEYS !== 'undefined' && COMMON_THEME_SURFACE_STYLE_KEYS.has(key)) return true;
  if (typeof COMMON_THEME_SCROLLBAR_STYLE_KEYS !== 'undefined' && COMMON_THEME_SCROLLBAR_STYLE_KEYS.has(key)) return true;
  return false;
}

function _expandFileStyleVars(style, panelId) {
  const themeVars = _fileStyleCssVars(_fileStyleThemeVars(style));
  const styleVars = _fileStyleCssVars(style);
  const vars = { ...themeVars, ...styleVars };
  if (_fileStyleUsesOsAccent(style) && typeof _applyFileStyleOsAccentVars === 'function') {
    _applyFileStyleOsAccentVars(vars);
  }
  const hasStyle = (key) => Object.prototype.hasOwnProperty.call(styleVars, key);
  const hasTheme = (key) => Object.prototype.hasOwnProperty.call(themeVars, key);
  const alias = (sourceKey, targetKeys) => {
    if (hasStyle(sourceKey)) {
      targetKeys.forEach((targetKey) => {
        if (_fileStyleIsCommonIntegratedKey(targetKey)) return;
        if (!hasStyle(targetKey)) vars[targetKey] = styleVars[sourceKey];
      });
    } else if (hasTheme(sourceKey)) {
      targetKeys.forEach((targetKey) => {
        if (_fileStyleIsCommonIntegratedKey(targetKey)) return;
        if (!hasStyle(targetKey) && !hasTheme(targetKey)) vars[targetKey] = themeVars[sourceKey];
      });
    }
  };
  const isPage = panelId === 'page-content' || Object.keys(vars).some(key => key.startsWith('--page-'));
  if (isPage) {
    alias('--page-bg', ['--page-text-bg']);
    alias('--page-fg', ['--page-text-fg']);
    alias('--page-heading-color', [
      '--page-h1-fg', '--page-h2-fg', '--page-h3-fg',
      '--page-h4-fg', '--page-h5-fg', '--page-h6-fg',
    ]);
  }
  const isDb = panelId === 'db-view-container' || Object.keys(vars).some(key => key.startsWith('--db-'));
  if (isDb) {
    alias('--db-header-bg', ['--db-th-bg']);
    alias('--db-row-bg', ['--db-cell-bg', '--db-entity-bg']);
    alias('--db-border-color', ['--db-grid-border']);
  }
  return vars;
}

function clearFileStyleFromElement(el) {
  if (!el) return;
  const raw = el.dataset?.[_FILE_STYLE_APPLIED_DATASET_KEY] || '';
  raw.split(',').map(v => v.trim()).filter(Boolean).forEach(key => el.style.removeProperty(key));
  if (el.dataset) delete el.dataset[_FILE_STYLE_APPLIED_DATASET_KEY];
}

function applyFileStyleToElement(style, el, panelId) {
  if (!el) return;
  clearFileStyleFromElement(el);
  if (!style || typeof style !== 'object') return;
  const vars = _expandFileStyleVars(style, panelId);
  const applied = [];
  for (const [key, value] of Object.entries(vars)) {
    if (!key.startsWith('--')) continue;
    el.style.setProperty(key, value);
    applied.push(key);
  }
  if (applied.length && el.dataset) el.dataset[_FILE_STYLE_APPLIED_DATASET_KEY] = applied.join(',');
}

function applyPageTitleStyleToElement(style, titleEl) {
  if (!titleEl) return;
  applyFileStyleToElement(style, titleEl, 'page-content');
}

// ============================================================
// 6. テーブル操作（セル編集・行列追加・右クリック削除）
// ============================================================
function _ensureTableRowDragHandle() {
  let handle = document.getElementById('table-row-drag-handle');
  if (handle) return handle;
  handle = document.createElement('div');
  handle.id = 'table-row-drag-handle';
  handle.textContent = '⠿';
  handle.draggable = true;
  handle.setAttribute('contenteditable', 'false');
  handle.style.cssText = 'position:fixed;left:0;top:0;width:18px;height:18px;cursor:grab;opacity:0;transition:opacity 0.15s;color:var(--page-table-control-fg,var(--fg2));font-size:15px;display:flex;align-items:center;justify-content:center;z-index:10000;user-select:none;pointer-events:auto;background:var(--page-table-control-bg,var(--bg2));border:var(--page-table-control-border-width,1px) solid var(--page-table-control-border,var(--border));border-radius:4px;';
  document.body.appendChild(handle);

  const rowSelector = '#page-content table tr, #entity-freetext table tr';
  let dropRow = null;
  let dropBefore = false;
  const clearDropMarker = () => {
    if (dropRow) dropRow.style.boxShadow = '';
    dropRow = null;
  };
  const positionHandle = (row) => {
    const rect = row.getBoundingClientRect();
    const z = (typeof _getZoom === 'function' ? _getZoom() : 1) || 1;
    handle.style.top = ((rect.top + Math.max(0, (rect.height - 18) / 2)) / z) + 'px';
    handle.style.left = ((rect.left - 22) / z) + 'px';
  };
  const cleanupDrag = () => {
    clearDropMarker();
    if (handle._dragRow) {
      handle._dragRow.style.opacity = '';
      handle._dragRow = null;
    }
    dropBefore = false;
    if (!handle.matches(':hover')) handle.style.opacity = '0';
  };
  const rowAtClientY = (clientY, table) => {
    if (!table) return null;
    let nearest = null;
    let nearestDistance = Infinity;
    for (const row of Array.from(table.querySelectorAll('tr'))) {
      const rect = row.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) return row;
      const distance = Math.min(Math.abs(clientY - rect.top), Math.abs(clientY - rect.bottom));
      if (distance < nearestDistance) {
        nearest = row;
        nearestDistance = distance;
      }
    }
    const rect = table.getBoundingClientRect();
    return clientY >= rect.top && clientY <= rect.bottom ? nearest : null;
  };
  const rowFromDragEvent = (e, dragRow) => {
    let target = e.target?.closest?.(rowSelector) || null;
    if (!target && typeof document.elementFromPoint === 'function') {
      const prevPointerEvents = handle.style.pointerEvents;
      handle.style.pointerEvents = 'none';
      try {
        target = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(rowSelector) || null;
      } finally {
        handle.style.pointerEvents = prevPointerEvents;
      }
    }
    return target || rowAtClientY(e.clientY, dragRow?.closest?.('table'));
  };

  document.addEventListener('mousemove', (e) => {
    if (handle._dragRow) return;
    if (e.target === handle || handle.contains(e.target)) return;
    const row = e.target.closest(rowSelector);
    if (!row) {
      handle.style.opacity = '0';
      handle._targetRow = null;
      return;
    }
    handle._targetRow = row;
    positionHandle(row);
    handle.style.opacity = '1';
  });

  handle.addEventListener('dragstart', (e) => {
    const row = handle._targetRow;
    if (!row) {
      e.preventDefault();
      return;
    }
    handle._dragRow = row;
    row.style.opacity = '0.35';
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'table-row');
  });

  document.addEventListener('dragover', (e) => {
    const dragRow = handle._dragRow;
    if (!dragRow) return;
    e.preventDefault();
    e.stopPropagation();
    const target = rowFromDragEvent(e, dragRow);
    if (!target || target === dragRow || target.closest('table') !== dragRow.closest('table')) {
      clearDropMarker();
      return;
    }
    const rect = target.getBoundingClientRect();
    dropBefore = e.clientY < rect.top + rect.height / 2;
    if (dropRow && dropRow !== target) dropRow.style.boxShadow = '';
    dropRow = target;
    dropRow.style.boxShadow = dropBefore
      ? 'inset 0 var(--page-drag-guide-width, 2px) 0 var(--page-drag-guide-color, var(--accent))'
      : 'inset 0 calc(-1 * var(--page-drag-guide-width, 2px)) 0 var(--page-drag-guide-color, var(--accent))';
  }, true);

  document.addEventListener('drop', (e) => {
    const dragRow = handle._dragRow;
    if (!dragRow) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const target = rowFromDragEvent(e, dragRow);
    if (!target || target === dragRow || target.closest('table') !== dragRow.closest('table')) {
      cleanupDrag();
      return;
    }
    const pc = dragRow.closest('#page-content, #entity-freetext');
    const beforeHtml = pc ? pc.innerHTML : '';
    _noteTablePushCustomUndo(pc);
    const rect = target.getBoundingClientRect();
    const shouldDropBefore = e.clientY < rect.top + rect.height / 2;
    if (shouldDropBefore) target.before(dragRow);
    else target.after(dragRow);
    _noteTableDispatchInput(pc, beforeHtml);
    cleanupDrag();
  }, true);

  handle.addEventListener('dragend', cleanupDrag);
  handle.addEventListener('mouseleave', (e) => {
    if (handle._dragRow) return;
    if (e.relatedTarget && (e.relatedTarget.closest?.('#page-content table, #entity-freetext table') || e.relatedTarget === handle)) return;
    handle.style.opacity = '0';
  });
  return handle;
}

function _noteTableInsertRowNear(cell, where, editable = _noteTableEditable(cell?.closest?.('table'))) {
  const row = cell?.parentElement;
  if (!row) return null;
  if (!_noteTableCanEdit(editable)) return null;
  const colIdx = Math.max(0, _noteTableColumnIndex(cell));
  const beforeHtml = editable ? editable.innerHTML : '';
  const colCount = Math.max(row.children.length, 1);
  const newRow = document.createElement('tr');
  _noteTablePushCustomUndo(editable);
  for (let i = 0; i < colCount; i += 1) {
    const tag = row.children[i]?.tagName?.toLowerCase() === 'th' ? 'th' : 'td';
    newRow.appendChild(document.createElement(tag));
  }
  if (where === 'before') row.before(newRow);
  else row.after(newRow);
  _noteTableDispatchInput(editable, beforeHtml);
  return newRow.children[Math.min(colIdx, newRow.children.length - 1)] || newRow.firstElementChild;
}

function _noteTableInsertColumnNear(cell, where, editable = _noteTableEditable(cell?.closest?.('table'))) {
  const table = cell?.closest?.('table');
  const row = cell?.parentElement;
  if (!table || !row) return null;
  if (!_noteTableCanEdit(editable)) return null;
  const colIdx = Math.max(0, _noteTableColumnIndex(cell));
  const targetColIdx = where === 'before' ? colIdx : colIdx + 1;
  const beforeHtml = editable ? editable.innerHTML : '';
  let selected = null;
  _noteTablePushCustomUndo(editable);
  _noteTableInsertColgroupColumn(table, targetColIdx);
  table.querySelectorAll('tr').forEach((tr, rowIndex) => {
    const newCell = _noteTableNewCellForRow(tr, rowIndex);
    const ref = tr.children[colIdx];
    if (where === 'before') {
      if (ref) ref.before(newCell);
      else tr.appendChild(newCell);
    } else if (ref?.nextElementSibling) {
      ref.nextElementSibling.before(newCell);
    } else {
      tr.appendChild(newCell);
    }
    if (tr === row) selected = newCell;
  });
  _noteTableSyncCellWidthsFromColgroup(table);
  _noteTableDispatchInput(editable, beforeHtml);
  return selected;
}

async function _noteTableDeleteRow(cell, editable = _noteTableEditable(cell?.closest?.('table'))) {
  const table = cell?.closest?.('table');
  const row = cell?.parentElement;
  if (!table || !row) return false;
  if (!_noteTableCanEdit(editable)) return false;
  const removesTable = table.querySelectorAll('tr').length <= 1;
  const ok = await _noteTableConfirm(removesTable ? '最後の行です。表全体を削除しますか？' : 'この行を削除しますか？');
  if (!ok) return false;
  const colIdx = Math.max(0, _noteTableColumnIndex(cell));
  const beforeHtml = editable ? editable.innerHTML : '';
  _noteTablePushCustomUndo(editable);
  if (removesTable) {
    table.remove();
    _closeNoteTableCellControls();
  } else {
    const nextRow = row.nextElementSibling || row.previousElementSibling;
    const nextCell = nextRow?.children?.[Math.min(colIdx, Math.max(0, nextRow.children.length - 1))] || null;
    row.remove();
    if (nextCell) _showNoteTableCellControls(nextCell);
  }
  _noteTableDispatchInput(editable, beforeHtml);
  return true;
}

async function _noteTableDeleteColumn(cell, editable = _noteTableEditable(cell?.closest?.('table'))) {
  const table = cell?.closest?.('table');
  const row = cell?.parentElement;
  if (!table || !row) return false;
  if (!_noteTableCanEdit(editable)) return false;
  const rows = [...table.rows];
  if (!rows.length) return false;
  const colIdx = Math.max(0, _noteTableColumnIndex(cell));
  const colCount = Math.max(...rows.map(tr => tr.cells.length));
  const ok = await _noteTableConfirm(colCount <= 1 ? '最後の列です。表全体を削除しますか？' : 'この列を削除しますか？');
  if (!ok) return false;
  const beforeHtml = editable ? editable.innerHTML : '';
  const nextCell = row.cells[colIdx + 1] || row.cells[colIdx - 1] || null;
  _noteTablePushCustomUndo(editable);
  if (colCount <= 1) {
    table.remove();
    _closeNoteTableCellControls();
  } else {
    _noteTableDeleteColgroupColumn(table, colIdx);
    rows.forEach((tr) => {
      if (colIdx < tr.cells.length) tr.deleteCell(colIdx);
    });
    _noteTableSyncCellWidthsFromColgroup(table);
    if (nextCell?.isConnected) _showNoteTableCellControls(nextCell);
  }
  _noteTableDispatchInput(editable, beforeHtml);
  return true;
}

async function _noteTableDeleteTable(table, editable = _noteTableEditable(table)) {
  if (!table) return false;
  if (!_noteTableCanEdit(editable)) return false;
  const ok = await _noteTableConfirm('表を削除しますか？');
  if (!ok) return false;
  const beforeHtml = editable ? editable.innerHTML : '';
  _noteTablePushCustomUndo(editable);
  table.remove();
  _noteTableDispatchInput(editable, beforeHtml);
  _closeNoteTableCellControls();
  return true;
}

function _noteTableSetButtonPosition(btn, left, top) {
  if (!btn) return;
  btn.style.left = left + 'px';
  btn.style.top = top + 'px';
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(btn);
}

function _positionNoteTableCellControls(cell = _noteTableActiveCell, controls = _noteTableControls) {
  if (!cell?.isConnected || !controls?.isConnected) {
    _closeNoteTableCellControls();
    return;
  }
  const rect = cell.getBoundingClientRect();
  const z = _noteTableUiZoom();
  const frame = controls.querySelector('.note-table-cell-frame');
  if (frame) {
    frame.style.left = (rect.left / z) + 'px';
    frame.style.top = (rect.top / z) + 'px';
    frame.style.width = Math.max(0, rect.width / z) + 'px';
    frame.style.height = Math.max(0, rect.height / z) + 'px';
  }
  const top = controls.querySelector('[data-note-table-action="insert-row-before"]');
  const bottom = controls.querySelector('[data-note-table-action="insert-row-after"]');
  const left = controls.querySelector('[data-note-table-action="insert-column-before"]');
  const right = controls.querySelector('[data-note-table-action="insert-column-after"]');
  const menu = controls.querySelector('[data-note-table-action="menu"]');
  const plusW = top?.offsetWidth || 22;
  const plusH = top?.offsetHeight || 22;
  const menuW = menu?.offsetWidth || 24;
  _noteTableSetButtonPosition(top, (rect.left + rect.width / 2 - plusW / 2) / z, (rect.top - plusH - 4) / z);
  _noteTableSetButtonPosition(bottom, (rect.left + rect.width / 2 - plusW / 2) / z, (rect.bottom + 4) / z);
  _noteTableSetButtonPosition(left, (rect.left - plusW - 4) / z, (rect.top + rect.height / 2 - plusH / 2) / z);
  _noteTableSetButtonPosition(right, (rect.right + 4) / z, (rect.top + rect.height / 2 - plusH / 2) / z);
  _noteTableSetButtonPosition(menu, (rect.right - menuW - 3) / z, (rect.top + 3) / z);
}

function _closeNoteTableCellControls() {
  if (_noteTableControls) {
    if (typeof _noteTableControls._cleanup === 'function') _noteTableControls._cleanup();
    _noteTableControls.remove();
  }
  _noteTableControls = null;
  _noteTableActiveCell = null;
}

function _noteTableControlButton(action, label, title) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = action === 'menu' ? 'note-table-cell-menu-btn' : 'note-table-cell-plus';
  btn.dataset.noteTableAction = action;
  btn.dataset.e2eId = 'note-table-cell-' + action;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.innerHTML = _noteEnhanceRenderIcon(action === 'menu' ? 'moreHorizontal' : 'plus', 14, label);
  btn.contentEditable = 'false';
  btn.addEventListener('mousedown', (ev) => ev.preventDefault());
  return btn;
}

function _ensureNoteTableCellControls() {
  if (_noteTableControls?.isConnected) return _noteTableControls;
  const controls = document.createElement('div');
  controls.className = 'note-table-cell-controls';
  controls.contentEditable = 'false';
  controls.appendChild(Object.assign(document.createElement('div'), { className: 'note-table-cell-frame' }));
  controls.appendChild(_noteTableControlButton('insert-row-before', '+', '行を上に追加'));
  controls.appendChild(_noteTableControlButton('insert-row-after', '+', '行を下に追加'));
  controls.appendChild(_noteTableControlButton('insert-column-before', '+', '列を左に追加'));
  controls.appendChild(_noteTableControlButton('insert-column-after', '+', '列を右に追加'));
  controls.appendChild(_noteTableControlButton('menu', '…', '表の操作メニュー'));
  controls.addEventListener('click', async (ev) => {
    const action = ev.target?.dataset?.noteTableAction || '';
    if (!action) return;
    ev.preventDefault();
    ev.stopPropagation();
    const cell = controls._cell;
    if (!cell?.isConnected) {
      _closeNoteTableCellControls();
      return;
    }
    const editable = _noteTableEditable(cell.closest?.('table'));
    if (!_noteTableCanEdit(editable)) return;
    let nextCell = null;
    if (action === 'insert-row-before') nextCell = _noteTableInsertRowNear(cell, 'before');
    else if (action === 'insert-row-after') nextCell = _noteTableInsertRowNear(cell, 'after');
    else if (action === 'insert-column-before') nextCell = _noteTableInsertColumnNear(cell, 'before');
    else if (action === 'insert-column-after') nextCell = _noteTableInsertColumnNear(cell, 'after');
    else if (action === 'menu') {
      const rect = ev.target.getBoundingClientRect();
      _showNoteTableCellMenu(cell, rect.left, rect.bottom);
      return;
    }
    if (nextCell?.isConnected) _showNoteTableCellControls(nextCell);
    else _positionNoteTableCellControls(cell, controls);
  });
  document.body.appendChild(controls);
  _noteTableControls = controls;
  return controls;
}

function _showNoteTableCellControls(cell) {
  if (!cell?.isConnected || !cell.closest?.(_NOTE_TABLE_SELECTOR)) {
    _closeNoteTableCellControls();
    return null;
  }
  document.querySelectorAll('.table-mini-toolbar').forEach(existing => {
    if (typeof existing._cleanup === 'function') existing._cleanup();
    existing.remove();
  });
  const controls = _ensureNoteTableCellControls();
  _noteTableActiveCell = cell;
  controls._cell = cell;
  _positionNoteTableCellControls(cell, controls);

  const reposition = () => _positionNoteTableCellControls(controls._cell, controls);
  const closeOutside = (ev) => {
    const target = ev.target;
    if (target?.closest?.('.note-table-cell-controls, .table-cell-menu')) return;
    if (_noteTableCellFromTarget(target)) return;
    _closeNoteTableCellControls();
  };
  const closeOnEscape = (ev) => {
    if (ev.key === 'Escape') _closeNoteTableCellControls();
  };
  if (typeof controls._cleanup === 'function') controls._cleanup();
  controls._cleanup = () => {
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
    document.removeEventListener('mousedown', closeOutside, true);
    document.removeEventListener('keydown', closeOnEscape, true);
  };
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
  document.addEventListener('mousedown', closeOutside, true);
  document.addEventListener('keydown', closeOnEscape, true);
  return controls;
}

function _noteTableMenuSeparator() {
  const sep = document.createElement('div');
  sep.className = 'gb-context-menu-sep';
  return sep;
}

function _showNoteTableCellMenu(cell, x, y, options = {}) {
  const table = cell?.closest?.('table');
  const editable = options.editable || _noteTableEditable(table);
  if (!table) return null;
  if (!_noteTableCanEdit(editable)) return null;
  document.querySelectorAll('.table-cell-menu, .gb-context-menu').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'table-cell-menu gb-context-menu';
  menu.dataset.e2eId = 'note-table-cell-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '表の操作メニュー');

  const mkItem = (id, label, handler, danger = false) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'gb-context-menu-item' + (danger ? ' danger' : '');
    item.dataset.e2eId = 'note-table-cell-menu-' + id;
    item.setAttribute('role', 'menuitem');
    item.setAttribute('aria-label', label);
    const labelEl = document.createElement('span');
    labelEl.className = 'gb-context-menu-item-label';
    labelEl.textContent = label;
    item.appendChild(labelEl);
    item.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      menu.remove();
      const result = await handler();
      if (result?.isConnected) _showNoteTableCellControls(result);
      else if (cell?.isConnected) _positionNoteTableCellControls(cell);
    });
    return item;
  };

  menu.appendChild(mkItem('insert-row-before', '行を上に追加', () => _noteTableInsertRowNear(cell, 'before', editable)));
  menu.appendChild(mkItem('insert-row-after', '行を下に追加', () => _noteTableInsertRowNear(cell, 'after', editable)));
  menu.appendChild(mkItem('insert-column-before', '列を左に追加', () => _noteTableInsertColumnNear(cell, 'before', editable)));
  menu.appendChild(mkItem('insert-column-after', '列を右に追加', () => _noteTableInsertColumnNear(cell, 'after', editable)));
  menu.appendChild(_noteTableMenuSeparator());
  menu.appendChild(mkItem('delete-row', 'この行を削除', () => _noteTableDeleteRow(cell, editable), true));
  menu.appendChild(mkItem('delete-column', 'この列を削除', () => _noteTableDeleteColumn(cell, editable), true));
  menu.appendChild(_noteTableMenuSeparator());
  menu.appendChild(mkItem('delete-table', '表を削除', () => _noteTableDeleteTable(table, editable), true));

  document.body.appendChild(menu);
  if (typeof positionPopup === 'function') {
    positionPopup(menu, { left: x, right: x, top: y, bottom: y });
  } else {
    const z = _noteTableUiZoom();
    menu.style.left = (x / z) + 'px';
    menu.style.top = (y / z) + 'px';
  }
  const closeMenu = (ev) => {
    if (!menu.contains(ev.target) && !ev.target?.closest?.('.note-table-cell-controls')) {
      menu.remove();
      document.removeEventListener('mousedown', closeMenu, true);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', closeMenu, true), 0);
  return menu;
}

function _initTableOperations() {
  _ensureTableRowDragHandle();
  document.addEventListener('pointermove', (e) => {
    if (_noteTableResizeState) {
      _noteTableResizeMove(e);
      return;
    }
    _noteTableSetResizeHover(_noteTableCellAtResizeEdge(e));
  });
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    _noteTableStartResize(e);
  }, true);
  document.addEventListener('pointerup', _noteTableFinishResize, true);
  document.addEventListener('pointercancel', _noteTableFinishResize, true);
  document.addEventListener('click', (e) => {
    const cell = _noteTableCellFromTarget(e.target);
    if (cell) _showNoteTableCellControls(cell);
  });

  // セルクリックで直接編集
  document.addEventListener('click', (e) => {
    const cell = e.target.closest('td, th');
    if (!cell || !cell.closest('#page-content table, #entity-freetext table')) return;
    if (cell.closest('[contenteditable="true"]')) return; // contentEditable内テーブルは gb-editor.js に委譲
    if (cell.querySelector('input.cell-edit')) return;
    const editable = cell.closest('#page-content, #entity-freetext');
    if (!_noteTableCanEdit(editable)) return;

    const input = document.createElement('input');
    input.className = 'cell-edit';
    input.type = 'text';
    input.value = cell.textContent.trim();
    input.style.cssText = 'width:100%;border:none;background:transparent;color:inherit;font:inherit;padding:0;outline:none;';

    const originalText = cell.textContent;
    let cancelled = false;
    cell.textContent = '';
    cell.appendChild(input);
    input.focus();
    input.select();

    input.addEventListener('blur', () => {
      if (cancelled) return;
      cell.textContent = input.value;
      const pc = cell.closest('#page-content, #entity-freetext');
      _noteTableDispatchInput(pc);
    });

    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Escape') { cancelled = true; cell.textContent = originalText; }
      if (ev.key === 'Tab') {
        ev.preventDefault();
        input.blur();
        const nextCell = ev.shiftKey ? cell.previousElementSibling : cell.nextElementSibling;
        if (nextCell) nextCell.click();
        else {
          const row = cell.parentElement;
          const nextRow = ev.shiftKey ? row.previousElementSibling : row.nextElementSibling;
          if (nextRow) {
            const target = ev.shiftKey ? nextRow.lastElementChild : nextRow.firstElementChild;
            if (target) target.click();
          }
        }
      }
    });
  });
}
_initTableOperations();
window.showNoteTableCellControls = _showNoteTableCellControls;

// テーブルセル右クリックで行/列削除メニュー（editable コンテナ委譲）
// 旧: document 委譲 → editable コンテナ個別登録へ移行（global-contextmenu-refactor-plan.md）
// 4-7: セル判定セレクタを closest('td, th') に簡略化。これにより #dp-editable 内テーブルも拾える。
function _tableCellCtxMenuHandler(e) {
  const editable = e.currentTarget;
  const cell = e.target.closest('td, th');
  if (!cell) return;
  const table = cell.closest('table');
  if (!table) return;
  if (!_noteTableCanEdit(editable, { silent: true })) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation?.();
  _showNoteTableCellControls(cell);
  _showNoteTableCellMenu(cell, e.clientX, e.clientY, { editable });
}

// editable コンテナにテーブルセルメニューを付ける
function bindTableCellContextMenu(el) {
  if (!el || el._tableCellCtxMenuAttached) return;
  el._tableCellCtxMenuAttached = true;
  el.addEventListener('contextmenu', _tableCellCtxMenuHandler);
  // タッチ/ペンの長押しでも同じハンドラを発火
  if (typeof addLongPressHandler === 'function') addLongPressHandler(el, _tableCellCtxMenuHandler);
}

// 静的要素に初期バインド（#dp-editable は gb-detail-panel.part02.js の _dpBindAutoSave で動的バインド）
bindTableCellContextMenu(document.getElementById('page-content'));
bindTableCellContextMenu(document.getElementById('entity-freetext'));

// ============================================================
// 行頭記法（工程6） — 「・」「数値」「h1〜h6」「既存の#〜######」+ Space
// ============================================================
// 計画書§5工程6: 共通の現在行変換（gb-note-block-types.js の
// MeldexNoteBlockTypes.convertCurrentLineTo）へ委譲する。現在行の解決境界も
// レジストリの resolveCurrentBlock を正本にし、旧実装（#page-content 直下の
// div/p/h1-6/blockquote だけを対象にした専用ロジック）は残さない。

// 行頭からキャレットまでのテキスト（改行区切りの現在行部分）を取得する。
function _noteLineTextBeforeCaret(block, range) {
  const before = range.cloneRange();
  before.setStart(block, 0);
  const text = before.toString().replace(/\u00a0/g, ' ');
  return text.slice(text.lastIndexOf('\n') + 1);
}

// 行頭記法トリガーの判定。一致しなければ null。
// - 「・」→ 箇条書き
// - 数値（1桁以上）→ 番号付きリスト（入力した数値をstartとして保持）
// - h1〜h6（大小文字問わず）→ 見出し1〜6
// - 既存の #〜###### → 見出し1〜6（維持）
function _noteLineStartTrigger(lineText) {
  const headingHash = lineText.match(/^(#{1,6})$/);
  if (headingHash) return { typeId: 'h' + headingHash[1].length };
  const headingLetter = lineText.match(/^[hH]([1-6])$/);
  if (headingLetter) return { typeId: 'h' + headingLetter[1] };
  if (lineText === '・') return { typeId: 'ul' }; // 「・」
  const ordered = lineText.match(/^(\d+)$/);
  if (ordered) return { typeId: 'ol', orderedStart: parseInt(ordered[1], 10) };
  return null;
}

function _handleNoteMarkdownShortcutKeydown(e) {
  if (e.defaultPrevented || e.isComposing) return; // IME変換中は誤発火させない（工程6必須要件）
  if (e.key !== ' ' && e.key !== 'Spacebar') return;
  if (typeof MeldexNoteBlockTypes === 'undefined') return;
  const editable = e.target?.closest?.(MeldexNoteBlockTypes.EDITABLE_SELECTOR);
  if (!editable || editable.contentEditable !== 'true') return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  if (!editable.contains(range.startContainer)) return;
  const info = MeldexNoteBlockTypes.resolveCurrentBlock(editable, range);
  if (!info) return;
  // コード・表・コールアウト内では行頭記法を認識しない（誤変換防止。従来挙動を維持）
  if (info.kind === 'code' || info.kind === 'table' || info.kind === 'callout') return;
  const lineText = _noteLineTextBeforeCaret(info.block, range);
  const trigger = _noteLineStartTrigger(lineText);
  if (!trigger) return;

  e.preventDefault();
  const originalRange = range.cloneRange();
  MeldexNoteBlockTypes.convertCurrentLineTo(trigger.typeId, {
    editable,
    range: originalRange,
    orderedStart: trigger.orderedStart,
    // トリガー文字（"###" 等）の削除は、共通変換の undo push 直後・DOM変換の
    // 直前で実行し、「削除＋行種変換」を1回のUndoにまとめる（§5工程4-4）。
    beforeConvert(convInfo, convRange) {
      const deleteRange = convRange.cloneRange();
      deleteRange.setStart(convInfo.block, 0);
      const lineIdSpan = convInfo.block.firstElementChild?.classList?.contains('_nl-id') ? convInfo.block.firstElementChild : null;
      if (lineIdSpan) deleteRange.setStartAfter(lineIdSpan);
      deleteRange.deleteContents();
    },
  });
}

function bindNoteMarkdownShortcuts() {
  if (document._noteMarkdownShortcutAttached) return;
  document._noteMarkdownShortcutAttached = true;
  // captureフェーズの単一リスナーへ集約する（#page-content 限定だった旧実装から
  // #entity-freetext・#dp-editable へも一般化。動的生成される編集ホストにも
  // 個別バインド不要で追従する）。
  document.addEventListener('keydown', _handleNoteMarkdownShortcutKeydown, true);
}

bindNoteMarkdownShortcuts();

// スラッシュコマンドのイベントリスナー登録（キー操作は gb-note-block-menu.js が
// document capture フェーズで処理する。ここでは / の検出のみ）
document.addEventListener('input', _onSlashInput);
