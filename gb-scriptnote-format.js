/* gb-scriptnote-format.js: シナリオエディタ専用フォーマット */

const SCRIPTNOTE_FILE_TYPE = 'meldex-scriptnote';
const SCRIPTNOTE_FILE_VERSION = 1;

function isScriptNoteFileDoc(value) {
  return !!(value && typeof value === 'object' && value.fileType === SCRIPTNOTE_FILE_TYPE);
}

function _scriptNoteNormalizeLayout(layout) {
  return ['manga', 'drama', 'afureko', 'stage'].includes(layout) ? layout : 'manga';
}

function convertScenarioDocToScriptNoteDoc(sourceDoc = {}, options = {}) {
  const src = typeof cloneSeData === 'function' ? cloneSeData(sourceDoc) : JSON.parse(JSON.stringify(sourceDoc || {}));
  const settings = typeof ensureScenarioSettings === 'function'
    ? ensureScenarioSettings(src)
    : (src.settings || {});
  const layoutMode = _scriptNoteNormalizeLayout(
    options.layoutMode
      || settings.noteLayoutMode
      || (typeof _guessScenarioNoteLayoutMode === 'function' ? _guessScenarioNoteLayoutMode(settings.modeName || '') : 'manga')
  );
  const rows = Array.isArray(src.rows) ? src.rows.map((row, idx) => ({
    id: row?.id || `sn-row-${idx + 1}`,
    role: typeof getScenarioCharacterDisplayValue === 'function'
      ? getScenarioCharacterDisplayValue(row || {})
      : String(row?.pageSetting || row?.character || ''),
    status: String(row?.status || ''),
    text: String(row?.text || ''),
    columns: row?.columns && typeof row.columns === 'object'
      ? JSON.parse(JSON.stringify(row.columns))
      : {},
  })) : [];
  const converted = {
    fileType: SCRIPTNOTE_FILE_TYPE,
    version: SCRIPTNOTE_FILE_VERSION,
    title: String(src.title || ''),
    layoutMode,
    editor: {
      viewMode: settings.viewMode || 'horizontal',
      wrapMode: settings.wrapMode ?? true,
      textWidth: settings.textWidth ?? 20,
      baseTextLineHeightH: settings.lineHeightH ?? settings.lineHeight ?? 1.5,
      baseTextLineHeightV: settings.lineHeightV ?? settings.lineHeight ?? 1.5,
      baseTextLetterSpacingH: settings.letterSpacingH ?? settings.letterSpacing ?? 0.02,
      baseTextLetterSpacingV: settings.letterSpacingV ?? settings.letterSpacing ?? 0.02,
      fontH: settings.fontH || '',
      fontV: settings.fontV || '',
      colors: settings.colors || null,
    },
    characters: Array.isArray(src.characters) ? src.characters : [],
    characterDb: Array.isArray(src.characterDb) ? src.characterDb : [],
    notes: Array.isArray(src.notes) ? src.notes : [],
    rows,
    source: {
      importedFrom: options.sourcePath || '',
      modeName: settings.modeName || '',
    }
  };
  return globalThis.GBScriptNoteRoleModel?.ensureDocument
    ? globalThis.GBScriptNoteRoleModel.ensureDocument(converted)
    : converted;
}

function convertScriptNoteDocToScenarioDoc(scriptDoc = {}, options = {}) {
  const baseDoc = typeof createEmptyDoc === 'function' ? createEmptyDoc() : { rows: [], notes: [], characters: [], characterDb: [], settings: {} };
  const nextDoc = { ...baseDoc };
  nextDoc.title = String(scriptDoc.title || '');
  nextDoc.rows = [];
  nextDoc.notes = Array.isArray(scriptDoc.notes) ? scriptDoc.notes.map(note => ({ ...note })) : [];
  const roleModel = globalThis.GBScriptNoteRoleModel;
  const legacyTypes = (Array.isArray(scriptDoc.scenarioTypes) ? scriptDoc.scenarioTypes : [])
    .map((type) => JSON.parse(JSON.stringify(type)));
  const legacyCharacters = (Array.isArray(scriptDoc.characters) ? scriptDoc.characters : [])
    .map((character) => ({
      ...(roleModel?.getEffectiveStyle?.(scriptDoc, { kind: 'character', id: character.id }) || {}),
      name: character.name,
    }));
  nextDoc.characters = [...legacyTypes, ...legacyCharacters];
  nextDoc.characterDb = Array.isArray(scriptDoc.characterDb) ? [...scriptDoc.characterDb] : [];
  nextDoc.settings = typeof ensureScenarioSettings === 'function' ? ensureScenarioSettings(nextDoc) : (nextDoc.settings || {});
  const editor = scriptDoc.editor || {};
  nextDoc.settings.viewMode = editor.viewMode || 'horizontal';
  nextDoc.settings.wrapMode = editor.wrapMode ?? true;
  nextDoc.settings.textWidth = editor.textWidth ?? 20;
  nextDoc.settings.plotWidth = nextDoc.settings.textWidth;
  const lineHeightH = editor.baseTextLineHeightH ?? editor.baseTextLineHeight ?? 1.5;
  const lineHeightV = editor.baseTextLineHeightV ?? editor.baseTextLineHeight ?? lineHeightH;
  const letterSpacingH = editor.baseTextLetterSpacingH ?? editor.baseTextLetterSpacing ?? 0.02;
  const letterSpacingV = editor.baseTextLetterSpacingV ?? editor.baseTextLetterSpacing ?? letterSpacingH;
  nextDoc.settings.lineHeightH = lineHeightH;
  nextDoc.settings.lineHeightV = lineHeightV;
  nextDoc.settings.letterSpacingH = letterSpacingH;
  nextDoc.settings.letterSpacingV = letterSpacingV;
  nextDoc.settings.lineHeight = nextDoc.settings.viewMode === 'vertical' ? lineHeightV : lineHeightH;
  nextDoc.settings.letterSpacing = nextDoc.settings.viewMode === 'vertical' ? letterSpacingV : letterSpacingH;
  nextDoc.settings.fontH = editor.fontH || '';
  nextDoc.settings.fontV = editor.fontV || '';
  nextDoc.settings.colors = editor.colors || null;
  nextDoc.settings.noteLayoutMode = _scriptNoteNormalizeLayout(scriptDoc.layoutMode);
  nextDoc.settings.editorSurface = 'note';
  if (scriptDoc?.source?.modeName) nextDoc.settings.modeName = scriptDoc.source.modeName;

  (Array.isArray(scriptDoc.rows) ? scriptDoc.rows : []).forEach((item, idx) => {
    const role = String(item?.role || '').trim();
    const row = typeof createRow === 'function' ? createRow('', '', String(item?.text || '')) : {
      id: item?.id || `row-${idx + 1}`,
      pageSetting: '',
      character: '',
      text: String(item?.text || '')
    };
    row.id = item?.id || row.id;
    if (item?.status) row.status = String(item.status);
    if (item?.columns && typeof item.columns === 'object') {
      row.columns = JSON.parse(JSON.stringify(item.columns));
    }
    if (typeof syncScenarioRowPageSettingFromCharacter === 'function') syncScenarioRowPageSettingFromCharacter(row, role);
    else if (row) row.character = role;
    nextDoc.rows.push(row);
  });

  return nextDoc;
}

function suggestScriptNotePath(path = '', title = '') {
  const base = String(path || '').trim();
  if (base) return base.replace(/\.(json|csv|xlsx|xls)$/i, '') + '.scriptnote.json';
  const safeTitle = String(title || '無題シナリオ').trim() || '無題シナリオ';
  return safeTitle + '.scriptnote.json';
}

function _sn2GetActiveSaveContext() {
  const comp = typeof getActiveScriptNoteComponent === 'function' ? getActiveScriptNoteComponent() : null;
  const editor = comp?._editor?.doc
    ? comp._editor
    : (typeof _sn2GetActiveEditor === 'function' ? _sn2GetActiveEditor() : null);
  if (!editor?.doc) return null;
  return { comp, editor };
}

function _sn2NormalizeScriptNoteFileName(name = '') {
  const raw = String(name || '').trim();
  const base = raw || '無題シナリオ';
  if (/\.scriptnote\.json$/i.test(base)) return base;
  if (/\.json$/i.test(base)) return base.replace(/\.json$/i, '.scriptnote.json');
  return base.replace(/\.[^./\\]+$/i, '') + '.scriptnote.json';
}

function _sn2JoinPath(folder = '', fileName = '') {
  const f = String(folder || '').replace(/[\\/]+$/g, '');
  const n = String(fileName || '').replace(/^[\\/]+/g, '');
  return f ? f + '/' + n : n;
}

function _sn2SetActiveScriptNotePath(ctx, targetPath) {
  const { comp, editor } = ctx || {};
  if (!editor || !targetPath) return;
  const oldPath = editor._path || '';
  if (editor._saveTimer) {
    clearTimeout(editor._saveTimer);
    editor._saveTimer = null;
  }
  if (oldPath && oldPath !== targetPath && typeof _sn2Editors !== 'undefined') delete _sn2Editors[oldPath];
  editor._path = targetPath;
  editor._dirty = false;
  if (typeof createScriptNoteRowIdSet === 'function') editor._lastSavedRowIds = createScriptNoteRowIdSet(editor.doc);
  if (typeof _sn2Editors !== 'undefined') {
    _sn2Editors[targetPath] = editor;
    if (editor._historyScopeId) _sn2Editors[editor._historyScopeId] = editor;
    editor._sn2RegisteredPath = targetPath;
    editor._sn2RegisteredScopeId = editor._historyScopeId || '';
  }
  const label = typeof getScriptNoteLabelFromPath === 'function'
    ? getScriptNoteLabelFromPath(targetPath, editor.doc?.title || '')
    : (targetPath.split('/').pop() || targetPath).replace(/\.scriptnote\.json$/i, '');
  if (comp?.state) {
    comp.state.scenarioPath = targetPath;
    comp.state.label = label;
  }
  if (typeof GBTabs !== 'undefined' && comp?.tabId) GBTabs.setTabLabel?.(comp.tabId, label);
  if (typeof historySetScope === 'function' && typeof editor._historyScope === 'function') historySetScope(editor._historyScope());
  if (typeof startAutoVersion === 'function') startAutoVersion(targetPath, 'file');
}

async function _sn2ScriptNoteFileExists(path) {
  if (!path || typeof apiFetch !== 'function') return false;
  try {
    await apiFetch('/file?path=' + encodeURIComponent(path), { silentError: true });
    return true;
  } catch (err) {
    if (err?.status === 404) return false;
    return true;
  }
}

async function _sn2ConfirmScriptNoteOverwrite(targetPath, sourcePath = '', options = {}) {
  const normalizePath = (value) => String(value || '').replace(/\\/g, '/');
  if (normalizePath(targetPath) === normalizePath(sourcePath)) return true;
  const exists = await _sn2ScriptNoteFileExists(targetPath);
  if (!exists) return true;
  if (options.forceOverwrite) return true;
  if (typeof cfConfirm !== 'function') {
    if (typeof showStatus === 'function') showStatus('同名のシナリオファイルが既にあります', true);
    return false;
  }
  return await cfConfirm('同名のシナリオファイルが既にあります。上書きしますか？', {
    danger: true,
    okLabel: '上書き',
    cancelLabel: 'キャンセル',
  });
}

async function _sn2FetchCssWithImports(url, seen = new Set()) {
  const resolved = new URL(url, window.location.href);
  const seenKey = resolved.href.replace(/[?#].*$/, '');
  if (seen.has(seenKey)) return '';
  seen.add(seenKey);
  const fetchUrl = new URL(resolved.href);
  fetchUrl.searchParams.set('_', String(Date.now()));
  const res = await fetch(fetchUrl.href, { cache: 'no-store' });
  if (!res.ok) return '';
  const css = await res.text();
  const importRe = /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?\s*;/g;
  let out = '';
  let last = 0;
  let match;
  while ((match = importRe.exec(css)) !== null) {
    out += css.slice(last, match.index);
    const importUrl = match[1] || '';
    if (/^(https?:|data:)/i.test(importUrl)) out += match[0];
    else out += await _sn2FetchCssWithImports(new URL(importUrl, resolved).href, seen);
    last = importRe.lastIndex;
  }
  out += css.slice(last);
  return out;
}

async function saveCurrentScriptNoteAs(path, options = {}) {
  const targetPath = String(path || '').trim();
  if (!targetPath) return false;
  const ctx = _sn2GetActiveSaveContext();
  if (!ctx) {
    if (typeof showStatus === 'function') showStatus('シナリオファイルが開かれていません', true);
    return false;
  }
  const { editor } = ctx;
  const sourcePath = editor._path || ctx.comp?.state?.scenarioPath || '';
  const clearPendingSave = () => {
    if (editor._saveTimer) {
      clearTimeout(editor._saveTimer);
      editor._saveTimer = null;
    }
  };
  clearPendingSave();
  if (typeof editor._syncAllFromDom === 'function') editor._syncAllFromDom();
  const exportDoc = typeof editor.collectDoc === 'function'
    ? editor.collectDoc()
    : (typeof serializeScriptNoteDoc === 'function' ? serializeScriptNoteDoc(editor.doc) : editor.doc);
  clearPendingSave();
  if (!(await _sn2ConfirmScriptNoteOverwrite(targetPath, sourcePath, options))) return false;
  const targetExists = await _sn2ScriptNoteFileExists(targetPath);
  await apiPut('/file?path=' + encodeURIComponent(targetPath), {
    content: JSON.stringify(exportDoc, null, 2),
    ...(targetExists ? { force_overwrite: true } : { create_only: true }),
  });
  _sn2SetActiveScriptNotePath(ctx, targetPath);
  return true;
}

function _sn2FormatIcon(name, size = 14) {
  return typeof lucide === 'function' ? lucide(name, size) : '';
}

function _sn2IsRenderedFocusTarget(el) {
  if (!el || !el.isConnected || typeof el.focus !== 'function') return false;
  const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
  return !rect || (rect.width > 0 && rect.height > 0);
}

function _sn2RestoreFocus(el) {
  if (!_sn2IsRenderedFocusTarget(el)) return;
  try { el.focus({ preventScroll: true }); } catch { try { el.focus(); } catch {} }
}

async function promptSaveCurrentScriptNoteAs() {
  const ctx = _sn2GetActiveSaveContext();
  if (!ctx) {
    if (typeof showStatus === 'function') showStatus('シナリオファイルが開かれていません', true);
    return false;
  }
  const srcPath = ctx.editor._path || ctx.comp?.state?.scenarioPath || '';
  const defaultName = _sn2NormalizeScriptNoteFileName(srcPath ? srcPath.split('/').pop() : (ctx.editor.doc?.title || ''));
  const srcFolder = srcPath.includes('/') ? srcPath.substring(0, srcPath.lastIndexOf('/')) : '';
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  return new Promise(resolve => {
    const body = document.createElement('div');
    body.className = 'sn2-save-as-content';

    const nameField = document.createElement('div');
    nameField.className = 'field gb-field sn2-save-field';
    const nameLabel = document.createElement('label');
    nameLabel.className = 'gb-label';
    nameLabel.htmlFor = 'sn-save-name';
    nameLabel.textContent = 'ファイル名';
    const nameInput = document.createElement('input');
    nameInput.id = 'sn-save-name';
    nameInput.className = 'gb-input sn2-save-name-input';
    nameInput.type = 'text';
    nameInput.value = defaultName;
    nameInput.autocomplete = 'off';
    nameInput.setAttribute('aria-label', 'ファイル名');
    nameField.append(nameLabel, nameInput);

    const folderField = document.createElement('div');
    folderField.className = 'field gb-field sn2-save-field';
    const folderFieldLabel = document.createElement('label');
    folderFieldLabel.className = 'gb-label';
    folderFieldLabel.id = 'sn-save-folder-field-label';
    folderFieldLabel.textContent = '保存先フォルダ';
    const folderDisplay = document.createElement('button');
    folderDisplay.id = 'sn-save-folder-display';
    folderDisplay.type = 'button';
    folderDisplay.className = 'gb-btn gb-btn-sm gb-btn-quiet sn2-save-folder-display';
    folderDisplay.setAttribute('role', 'button');
    folderDisplay.setAttribute('tabindex', '0');
    folderDisplay.setAttribute('aria-haspopup', 'dialog');
    folderDisplay.setAttribute('aria-expanded', 'false');
    folderDisplay.setAttribute('aria-labelledby', 'sn-save-folder-field-label sn-save-folder-label');
    folderDisplay.setAttribute('aria-label', '保存先フォルダを選択');
    const folderLabel = document.createElement('span');
    folderLabel.id = 'sn-save-folder-label';
    folderLabel.className = 'sn2-save-folder-label';
    folderLabel.textContent = srcFolder || '(ルート)';
    const folderChevron = document.createElement('span');
    folderChevron.className = 'sn2-save-folder-chevron';
    folderChevron.setAttribute('aria-hidden', 'true');
    folderChevron.innerHTML = _sn2FormatIcon('chevronDown', 14);
    folderDisplay.append(folderLabel, folderChevron);
    const folderTree = document.createElement('div');
    folderTree.id = 'sn-save-folder-tree';
    folderTree.className = 'sn2-save-folder-tree';
    folderTree.setAttribute('role', 'tree');
    folderTree.hidden = true;
    folderField.append(folderFieldLabel, folderDisplay, folderTree);
    const saveStatus = document.createElement('div');
    saveStatus.className = 'sn2-save-as-status';
    saveStatus.setAttribute('role', 'status');
    saveStatus.setAttribute('aria-live', 'polite');
    body.append(nameField, folderField, saveStatus);

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.id = 'sn-save-cancel';
    cancelButton.className = 'gb-btn gb-btn-sm gb-btn-quiet';
    cancelButton.textContent = 'キャンセル';
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.id = 'sn-save-ok';
    saveButton.className = 'gb-btn gb-btn-sm gb-btn-primary';
    saveButton.textContent = '保存';
    let selectedFolder = srcFolder;
    let finished = false;
    let saving = false;
    let childOpen = false;
    let pendingResult = false;
    const modalApi = window.GBUI.createModal({
      id: 'scriptnote-save-as', title: 'シナリオ形式として保存', body, footer: [cancelButton, saveButton],
      variant: 'standard', geometryKey: 'scriptnote-save-as', minWidth: '0', initialFocus: '#sn-save-name',
      returnFocus: opener, closeLabel: 'シナリオ形式として保存を閉じる', closeOnEsc: true, closeOnOverlay: true,
      onBeforeClose: (reason) => reason === 'submit' || (!saving && !childOpen),
      onClose: () => {
        if (finished) return;
        finished = true;
        resolve(pendingResult);
      },
    });
    const overlay = modalApi.overlay;
    const dialog = modalApi.modal;
    overlay.dataset.e2eId = 'save-scenario-format-modal-overlay';
    overlay.dataset.sn2Dialog = 'save-as';
    dialog.dataset.e2eId = 'save-scenario-format-modal';
    globalThis.GBScriptNoteDialogUI.applyCompactTargets(dialog);
    dialog.classList.add('sn2-save-as-modal');
    modalApi.body.classList.add('sn2-save-as-body');
    modalApi.footer.classList.add('sn2-save-as-actions');
    const escCss = (value) => (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') ? CSS.escape(value) : String(value).replace(/"/g, '\\"');
    const setTreeOpen = (open) => {
      folderTree.hidden = !open;
      folderTree.classList.toggle('is-open', !!open);
      folderDisplay.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    const close = (result, reason = 'cancel') => {
      if (finished) return false;
      pendingResult = result;
      return modalApi.close(reason);
    };
    const selectFolder = (path, label) => {
      selectedFolder = path;
      folderLabel.textContent = label || path || '(ルート)';
      setTreeOpen(false);
    };
    const createRow = (name, path, depth, icon = 'folder', options = {}) => {
      const row = document.createElement('div');
      row.className = 'sn2-save-folder-row';
      row.dataset.snFolderPath = path;
      row.dataset.depth = String(depth);
      row.style.setProperty('--sn2-save-folder-depth', String(depth));
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', String(depth + 1));
      row.setAttribute('aria-selected', path === selectedFolder ? 'true' : 'false');
      if (path === selectedFolder) {
        row.dataset.selected = '1';
        row.classList.add('is-selected');
      }
      if (options.onToggle) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'gb-btn gb-btn-xs gb-btn-icon gb-btn-ghost sn2-save-folder-toggle';
        toggle.setAttribute('aria-label', `${name || '(ルート)'}を展開`);
        toggle.setAttribute('aria-expanded', 'false');
        toggle.innerHTML = _sn2FormatIcon('chevronRight', 14);
        toggle.addEventListener('click', async (event) => {
          event.stopPropagation();
          await options.onToggle(toggle, row);
        });
        row.appendChild(toggle);
      } else {
        const spacer = document.createElement('span');
        spacer.className = 'sn2-save-folder-toggle-spacer';
        spacer.setAttribute('aria-hidden', 'true');
        row.appendChild(spacer);
      }
      const selectButton = document.createElement('button');
      selectButton.type = 'button';
      selectButton.className = 'gb-btn gb-btn-sm gb-btn-ghost sn2-save-folder-select';
      selectButton.setAttribute('aria-label', `${name || '(ルート)'}を保存先にする`);
      const iconWrap = document.createElement('span');
      iconWrap.className = 'sn2-save-folder-icon';
      iconWrap.setAttribute('aria-hidden', 'true');
      iconWrap.innerHTML = typeof lucide === 'function' ? lucide(icon, 12) : '';
      const label = document.createElement('span');
      label.className = 'sn2-save-folder-name';
      label.textContent = name || '(ルート)';
      selectButton.append(iconWrap, label);
      row.appendChild(selectButton);
      selectButton.addEventListener('click', () => {
        folderTree.querySelectorAll('[data-sn-folder-path]').forEach(el => {
          delete el.dataset.selected;
          el.classList.remove('is-selected');
          el.setAttribute('aria-selected', 'false');
        });
        row.dataset.selected = '1';
        row.classList.add('is-selected');
        row.setAttribute('aria-selected', 'true');
        selectFolder(path, name || '(ルート)');
      });
      return row;
    };
    const expandFolder = async (parentPath, depth) => {
      const parentRow = folderTree.querySelector(`[data-sn-folder-path="${escCss(parentPath)}"]`);
      let insertAfter = parentRow || null;
      try {
        const data = await apiFetch('/browse?path=' + encodeURIComponent(parentPath) + '&folders_only=1&sort=name&order=asc');
        const folders = (Array.isArray(data) ? data : (data.items || [])).filter(i => i.type === 'folder');
        for (const f of folders) {
          if (folderTree.querySelector(`[data-sn-folder-path="${escCss(f.path)}"]`)) continue;
          const row = createRow(f.name, f.path, depth + 1, 'folder', {
            onToggle: async (toggle, rowEl) => {
              const expanded = toggle.dataset.expanded === '1';
              if (expanded) {
                const d = Number(rowEl.dataset.depth || 0);
                let next = rowEl.nextElementSibling;
                while (next && Number(next.dataset.depth || 0) > d) {
                  const rm = next;
                  next = next.nextElementSibling;
                  rm.remove();
                }
                toggle.dataset.expanded = '0';
                toggle.setAttribute('aria-expanded', 'false');
                toggle.innerHTML = _sn2FormatIcon('chevronRight', 14);
                return;
              }
              await expandFolder(f.path, depth + 1);
              toggle.dataset.expanded = '1';
              toggle.setAttribute('aria-expanded', 'true');
              toggle.innerHTML = _sn2FormatIcon('chevronDown', 14);
            },
          });
          if (insertAfter?.nextSibling) folderTree.insertBefore(row, insertAfter.nextSibling);
          else folderTree.appendChild(row);
          insertAfter = row;
        }
      } catch {
        if (!folderTree.children.length) {
          const error = document.createElement('div');
          error.className = 'sn2-save-folder-status is-error';
          error.setAttribute('role', 'status');
          error.textContent = 'フォルダ一覧の取得に失敗';
          folderTree.replaceChildren(error);
        }
      }
      globalThis.GBScriptNoteDialogUI.applyCompactTargets(folderTree);
    };
    // フォルダツリー展開
    folderDisplay.addEventListener('click', async () => {
      if (window.GBFolderPicker?.pickFolder) {
        if (childOpen) return;
        childOpen = true;
        const compactObserver = window.innerWidth <= 1024 ? new MutationObserver(() => {
          document.querySelectorAll('.gb-modal').forEach(modal => globalThis.GBScriptNoteDialogUI.applyCompactTargets(modal));
        }) : null;
        compactObserver?.observe(document.body, { childList: true, subtree: true });
        try {
          const pickerPromise = window.GBFolderPicker.pickFolder({
            title: '保存先フォルダを選択',
            initialPath: selectedFolder,
          });
          document.querySelectorAll('.gb-modal').forEach(modal => globalThis.GBScriptNoteDialogUI.applyCompactTargets(modal));
          const selected = await pickerPromise;
          if (selected?.path !== undefined) {
            selectFolder(selected.path, selected.label || selected.name || selected.path || '(ルート)');
          }
        } catch (error) {
          saveStatus.textContent = `保存先を選択できませんでした。入力内容を保ったまま再試行できます。${error?.message ? ` ${error.message}` : ''}`;
        } finally {
          compactObserver?.disconnect();
          childOpen = false;
          _sn2RestoreFocus(folderDisplay);
        }
        return;
      }
      if (!folderTree.hidden) { setTreeOpen(false); return; }
      setTreeOpen(true);
      const loading = document.createElement('div');
      loading.className = 'sn2-save-folder-status';
      loading.setAttribute('role', 'status');
      loading.textContent = '読み込み中...';
      folderTree.replaceChildren(loading);
      try {
        folderTree.replaceChildren(createRow('(ルート)', '', 0, 'home'));
        await expandFolder('', 0);
      } catch (error) {
        saveStatus.textContent = `フォルダ一覧を読み込めませんでした。入力内容を保ったまま再試行できます。${error?.message ? ` ${error.message}` : ''}`;
      }
    });
    folderDisplay.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      folderDisplay.click();
    });
    const doSave = async () => {
      if (saving) return;
      const name = _sn2NormalizeScriptNoteFileName(nameInput.value);
      if (!name) return;
      nameInput.value = name;
      const targetPath = _sn2JoinPath(selectedFolder, name);
      saving = true;
      saveButton.disabled = true;
      dialog.setAttribute('aria-busy', 'true');
      saveStatus.textContent = '保存しています...';
      try {
        const saved = await saveCurrentScriptNoteAs(targetPath);
        if (!saved) {
          saveStatus.textContent = '保存できませんでした。入力内容を保ったまま再試行できます。';
          return;
        }
        let lastViewWarning = '';
        if (typeof saveLastView === 'function') {
          const label = typeof getScriptNoteLabelFromPath === 'function'
            ? getScriptNoteLabelFromPath(targetPath)
            : targetPath.split('/').pop().replace(/\.scriptnote\.json$/i, '').replace(/\.\w+$/, '');
          try {
            saveLastView({ type: 'scriptnote', label, path: targetPath });
          } catch (error) {
            console.warn('保存後の最近開いたビュー更新に失敗しました:', error);
            lastViewWarning = 'シナリオは保存しましたが、最近開いたビューを更新できませんでした';
          }
        }
        saveStatus.textContent = '';
        close(true, 'submit');
        if (typeof showStatus === 'function') {
          if (lastViewWarning) showStatus(lastViewWarning, true);
          else showStatus('シナリオ形式で保存しました', false, { showSaveDialog: true });
        }
      } catch (err) {
        saveStatus.textContent = `保存できませんでした。入力内容を保ったまま再試行できます。${err?.message ? ` ${err.message}` : ''}`;
        if (typeof showStatus === 'function') showStatus('保存に失敗: ' + (err?.message || err), true);
      } finally {
        saving = false;
        dialog.setAttribute('aria-busy', 'false');
        if (overlay.isConnected) saveButton.disabled = false;
      }
    };
    saveButton.addEventListener('click', doSave);
    cancelButton.addEventListener('click', () => close(false, 'cancel'));
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSave(); } });
    globalThis.GBScriptNoteDialogUI.applyCompactTargets(dialog);
    modalApi.open();
    nameInput.select();
  });
}

// シナリオエディタの現在ビュー（フィルタ・テーマ・縦/横/折返し設定すべて反映済み）を
// 操作不可の静的 HTML として保存する。embed-font: Regular の woff2 を data URI で
// 埋め込んで自己完結させる。
async function exportCurrentScriptNoteAsHtml() {
  if (typeof _sn2GetActiveEditor !== 'function') {
    if (typeof showStatus === 'function') showStatus('シナリオエディタが利用できません', true);
    return;
  }
  const editor = _sn2GetActiveEditor();
  if (!editor?.doc) {
    if (typeof showStatus === 'function') showStatus('シナリオファイルが開かれていません', true);
    return;
  }
  // 最新状態でレンダリング
  try { editor._syncAllFromDom?.(); } catch {}
  try { editor._render(); } catch {}
  // _render() は縦書きモードで requestAnimationFrame 内で行の style.height と
  // style.minWidth を設定する。クローン前に rAF を 2 回待ってこれらの JS 同期
  // 処理が完了してから DOM スナップショットを取る (これを待たないと行高さが
  // 未設定のままクローンされ、エクスポート HTML でテキストが潰れる)。
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const scroll = editor.host?.querySelector('.sn2-scroll');
  if (!scroll) {
    if (typeof showStatus === 'function') showStatus('レンダリング結果が見つかりません', true);
    return;
  }

  // ステータス表示
  if (typeof showStatus === 'function') showStatus('HTML を生成中...');

  // クローンしてインタラクティブな属性を除去
  const clone = scroll.cloneNode(true);
  // フローティング UI / ドラッグハンドル系を除去
  clone.querySelectorAll('.sn2-row-bulk-bar, .sn2-handle-zone, .sn2-handle, .sn2-add-row, .sn2-add-col-btn').forEach(el => el.remove());
  // contenteditable / inputs / data-action を完全除去
  clone.querySelectorAll('[contenteditable]').forEach(el => {
    el.removeAttribute('contenteditable');
    el.setAttribute('data-readonly', '1');
  });
  clone.querySelectorAll('[data-action], [data-sn-action]').forEach(el => {
    el.removeAttribute('data-action');
    el.removeAttribute('data-sn-action');
  });
  clone.querySelectorAll('input, textarea, select, button').forEach(el => {
    if (el.tagName === 'BUTTON') {
      // タイプボタンは見た目だけ残してクリック不可に
      el.setAttribute('disabled', 'disabled');
      el.style.pointerEvents = 'none';
    } else {
      const span = document.createElement('span');
      span.className = el.className;
      span.textContent = el.value || el.textContent || '';
      el.replaceWith(span);
    }
  });
  clone.querySelectorAll('[tabindex]').forEach(el => el.removeAttribute('tabindex'));
  clone.querySelectorAll('[draggable]').forEach(el => el.removeAttribute('draggable'));

  // span[data-ruby] / .auto-link[data-ruby] を HTML 標準の <ruby><rt> に置換する。
  // 元の実装は ::after 擬似要素で描画していたが、iOS Safari や Gmail/Dropbox の
  // 内蔵ブラウザでは ::after ルビの位置計算が壊れて二重描画になるケースがあった。
  // ネイティブ ruby は全ブラウザで安定して縦書きルビが描画される。
  clone.querySelectorAll('[data-ruby]').forEach(el => {
    const rubyText = el.getAttribute('data-ruby');
    if (!rubyText) return;
    const baseText = el.textContent || '';
    const ruby = document.createElement('ruby');
    ruby.appendChild(document.createTextNode(baseText));
    const rt = document.createElement('rt');
    rt.textContent = rubyText;
    ruby.appendChild(rt);
    // auto-link も含め、クラス名は保持しない (ネイティブ ruby に任せる)
    el.replaceWith(ruby);
  });

  // CSS を取得（gb-fonts.css は woff2 埋め込みに置き換えるので除外）
  // cache-buster + no-store でブラウザ・中間キャッシュを完全回避する
  let editorCss = '';
  try {
    editorCss = await _sn2FetchCssWithImports('gb-scriptnote-editor.css');
  } catch {}

  // CSS 変数を :root から収集
  const rootStyle = getComputedStyle(document.documentElement);
  const varNames = [
    '--bg', '--bg2', '--bg3', '--bg4',
    '--fg', '--fg2', '--accent', '--accent2',
    '--border', '--selection',
    '--ui-header-fg', '--ui-header-bg',
    '--ui-header-font',
    '--ui-toolbar-fg', '--ui-toolbar-bg',
    '--ui-toolbar-font', '--ui-muted-font',
    '--ui-hover-fg', '--ui-hover-bg',
    '--ui-fg-strong',
    '--ui-selection-fg', '--ui-selection-bg',
    '--ui-range-fill-bg', '--ui-range-track-bg',
    '--ui-scrollbar-track-bg', '--ui-scrollbar-thumb-bg', '--ui-scrollbar-thumb-hover-bg',
    '--ui-font', '--ui-font-size',
  ];
  const varDecls = varNames
    .map(v => {
      const val = rootStyle.getPropertyValue(v).trim();
      return val ? `${v}: ${val};` : '';
    })
    .filter(Boolean)
    .join(' ');

  // Noto Sans JP Regular を data URI で埋め込み（自己完結 HTML 化）
  let fontFaceCss = '';
  try {
    const r = await fetch('fonts/NotoSansJP-Regular.woff2');
    if (r.ok) {
      const buf = await r.arrayBuffer();
      const bin = new Uint8Array(buf);
      let s = '';
      for (let i = 0; i < bin.length; i++) s += String.fromCharCode(bin[i]);
      const b64 = btoa(s);
      fontFaceCss = `@font-face { font-family: 'Noto Sans JP'; font-style: normal; font-weight: 400; src: url('data:font/woff2;base64,${b64}') format('woff2'); }`;
    }
  } catch {}

  const title = (editor.doc.title || 'シナリオ').toString();
  const safeTitle = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80) || '無題';
  const escHtml = (s) => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="color-scheme" content="dark light">
<title>${escHtml(title)}</title>
<style>
${fontFaceCss}
:root { ${varDecls} }
html, body {
  margin: 0; padding: 0;
  background: var(--bg, #1e1e1e);
  color: var(--fg, #d4d4d4);
  font-family: var(--ui-font, 'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic UI', 'Meiryo', sans-serif);
  font-size: var(--ui-font-size, 15px);
}
${editorCss}
/* 静的エクスポート用の上書き: 操作 UI を完全に隠す */
/* .sn2-scroll は通常 flex:1 で親に張り付くが、エクスポートではコンテンツに
   ぴったり合わせて body 直下に並べる。縦書き row-reverse でもはみ出さない
   よう幅を fit-content にしてブラウザのスクロールに任せる */
.sn2-scroll {
  flex: none !important;
  overflow: visible !important;
  height: auto !important;
  max-height: none !important;
  width: fit-content !important;
  max-width: none !important;
}
.sn2-row-bulk-bar, .sn2-handle, .sn2-handle-zone, .sn2-add-row, .sn2-add-col-btn,
.sn2-resizer, .sn2-col-resizer, .sn2-row-resizer { display: none !important; }
.sn2-row { cursor: default !important; }
*, *::before, *::after { user-select: text !important; -webkit-user-select: text !important; }
[disabled] { cursor: default !important; opacity: 1 !important; }

/* iOS Safari / Gmail/Dropbox 内蔵ブラウザ向けの互換 CSS */
/* ネイティブ ruby を iOS でも正しく縦書きにレンダリングさせる */
ruby {
  ruby-position: over;
}
.sn2-scroll.sn2-vertical ruby {
  ruby-position: inter-character;
}
rt {
  font-size: 0.55em;
  line-height: 1;
  color: inherit;
  opacity: 0.75;
}
/* iOS で縦書きのグリフが一部横になる対策。writing-mode を -webkit- プレフィックス
   でも指定し、text-combine-upright で数字・記号を縦中横にする */
.sn2-scroll.sn2-vertical .sn2-text,
.sn2-scroll.sn2-vertical .sn2-gutter,
.sn2-scroll.sn2-vertical .sn2-custom-text {
  -webkit-writing-mode: vertical-rl;
  -webkit-text-orientation: upright;
}
.sn2-scroll.sn2-vertical .sn2-role-btn {
  -webkit-writing-mode: vertical-rl;
  -webkit-text-orientation: mixed;
}
.sn2-tcy,
.sn2-tcy-wide {
  -webkit-text-combine: horizontal;
}
</style>
</head>
<body>
${clone.outerHTML}
</body>
</html>`;

  // OS ネイティブの「名前を付けて保存」ダイアログをサーバー側 (Meldex.py)
  // で開き、選択されたパスに直接書き込む。
  if (typeof MeldexExportSave !== 'undefined' && typeof MeldexExportSave.saveText === 'function') {
    await MeldexExportSave.saveText(html, {
      title: safeTitle,
      extension: '.html',
      dialogTitle: 'HTMLとして保存',
      filetypes: [['HTMLファイル', '*.html'], ['すべてのファイル', '*.*']],
      bom: true,
      okMessage: 'HTML として保存しました',
      errorMessage: 'HTML の保存に失敗しました',
    });
  }
}

// 行本文 (row.text) を Markdown 出力用のプレーンテキストへ変換する。
// row.text の内部表現はエスケープ付きプレーンテキストで、ルビは {ベース|ルビ}、
// 手動リンクは [ラベル](ml:target)、改行は \n で保持されている (HTML の <br> ではない)。
// ここではルビ記法 {ベース|ルビ} をそのまま出力し、手動リンクはラベルのみに落とし、
// エスケープ済みの生文字 (\{ \| \} \\ \[ \]) は素の文字へ戻す。
function _sn2ScriptNoteRowTextForMarkdown(rawText) {
  const raw = String(rawText || '');
  if (typeof _sn2CollectVisibleSegments !== 'function') {
    return typeof _sn2UnescapeScriptNotePlainText === 'function' ? _sn2UnescapeScriptNotePlainText(raw) : raw;
  }
  return _sn2CollectVisibleSegments(raw).map(segment => {
    if (segment.type === 'ruby') return `{${segment.plain}|${segment.ruby}}`;
    if (segment.type === 'manual-link') return segment.plain;
    return typeof _sn2UnescapeScriptNotePlainText === 'function' ? _sn2UnescapeScriptNotePlainText(segment.raw) : segment.raw;
  }).join('');
}

// シナリオの現在ビューを Markdown 形式のプレーンテキストとして保存する。
// 役名 (タイプ) を持つ行は `**[役名]** 本文` の形式にし、区切り (ページ送り) 行は
// セクション区切りの水平線 "---" に変換する。行内改行は Markdown のハードブレーク
// (行末2スペース+改行) にして、素の Markdown ビューアでも改行が保たれるようにする。
async function exportCurrentScriptNoteAsMarkdown() {
  if (typeof _sn2GetActiveEditor !== 'function') {
    if (typeof showStatus === 'function') showStatus('シナリオエディタが利用できません', true);
    return;
  }
  const editor = _sn2GetActiveEditor();
  if (!editor?.doc) {
    if (typeof showStatus === 'function') showStatus('シナリオファイルが開かれていません', true);
    return;
  }
  try { editor._syncAllFromDom?.(); } catch {}

  const doc = editor.doc;
  const { breakNames } = typeof editor._getRoleFlagSets === 'function'
    ? editor._getRoleFlagSets()
    : { breakNames: new Set() };

  const title = String(doc.title || '無題シナリオ').trim() || '無題シナリオ';
  const rows = Array.isArray(doc.rows) ? doc.rows : [];
  const blocks = [`# ${title}`];

  rows.forEach((row, idx) => {
    const role = String(row?.role || '').trim();
    const rawBody = _sn2ScriptNoteRowTextForMarkdown(row?.text || '');
    if (role && breakNames.has(role)) {
      // 区切り（ページ送り）行はセクション区切りの水平線に変換する
      if (idx > 0) blocks.push('---');
      const trimmed = rawBody.trim();
      if (trimmed) blocks.push(trimmed.split('\n').join('  \n'));
      return;
    }
    const lines = rawBody.split('\n');
    if (role) lines[0] = lines[0] ? `**[${role}]** ${lines[0]}` : `**[${role}]**`;
    blocks.push(lines.join('  \n'));
  });

  const markdown = blocks.join('\n\n') + '\n';
  const safeTitle = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80) || '無題';

  if (typeof MeldexExportSave !== 'undefined' && typeof MeldexExportSave.saveText === 'function') {
    await MeldexExportSave.saveText(markdown, {
      title: safeTitle,
      extension: '.md',
      dialogTitle: 'Markdownとして保存',
      filetypes: [['Markdownファイル', '*.md'], ['すべてのファイル', '*.*']],
      bom: true,
      okMessage: 'Markdown として保存しました',
      errorMessage: 'Markdown の保存に失敗しました',
    });
  }
}
globalThis.GBScriptNoteDialogUI = globalThis.GBScriptNoteDialogUI || {
  applyCompactTargets(root) {
    if (!root) return;
    const compact = window.innerWidth <= 1024;
    const body = root.querySelector(':scope > .gb-modal-body');
    root.style.setProperty('box-sizing', 'border-box');
    root.style.setProperty('min-width', '0');
    root.style.setProperty('max-width', '100%');
    root.style.setProperty('overflow-x', 'hidden', 'important');
    body?.style.setProperty('box-sizing', 'border-box');
    body?.style.setProperty('min-width', '0');
    body?.style.setProperty('max-width', '100%');
    body?.style.setProperty('overflow-x', 'hidden', 'important');
    if (compact) body?.style.setProperty('width', '100%');
    root.querySelectorAll('button, input, select, textarea, [role="button"], [role="option"]').forEach(control => {
      if (control.type === 'checkbox' || control.type === 'radio') {
        const label = control.closest('label');
        if (label) {
          label.classList.add('sn2-dialog-touch-choice');
        }
        return;
      }
      control.classList.add('sn2-dialog-touch-target');
      if (control.tagName === 'BUTTON') control.classList.add('sn2-dialog-touch-button');
    });
  },
};
