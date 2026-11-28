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

// 新しく作るシナリオは本体の新規作成と同じ現行の拡張子 .mel-scenario にする
// （CHANGELOG 2026-10-22。M-014 S7/S10）。旧シナリオ .scenario.json は二重拡張子にしない。
const SCRIPTNOTE_CURRENT_EXT = '.mel-scenario';
const _SN2_SCENARIO_SOURCE_EXT_RE = /(?:\.mel-scenario|\.scriptnote\.json|\.scenario\.json|\.(?:json|csv|xlsx|xls))$/i;

function suggestScriptNotePath(path = '', title = '') {
  const base = String(path || '').trim();
  if (base) return base.replace(_SN2_SCENARIO_SOURCE_EXT_RE, '') + SCRIPTNOTE_CURRENT_EXT;
  const safeTitle = String(title || '無題シナリオ').trim() || '無題シナリオ';
  return safeTitle + SCRIPTNOTE_CURRENT_EXT;
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
  // シナリオの拡張子（現行 .mel-scenario・旧 .scriptnote.json）はそのまま使う。旧形式のファイルを
  // 既定の名前で保存しても同じファイルへの通常の保存になり、別のファイルや別の文書にならない。
  if (/(?:\.mel-scenario|\.scriptnote\.json)$/i.test(base)) return base;
  if (/\.scenario\.json$/i.test(base)) return base.replace(/\.scenario\.json$/i, '') + SCRIPTNOTE_CURRENT_EXT;
  if (/\.json$/i.test(base)) return base.replace(/\.json$/i, '') + SCRIPTNOTE_CURRENT_EXT;
  return base.replace(/\.[^./\\]+$/i, '') + SCRIPTNOTE_CURRENT_EXT;
}

function _sn2JoinPath(folder = '', fileName = '') {
  const f = String(folder || '').replace(/[\\/]+$/g, '');
  const n = String(fileName || '').replace(/^[\\/]+/g, '');
  return f ? f + '/' + n : n;
}

function _sn2SetActiveScriptNotePath(ctx, targetPath, saveResult = {}) {
  const { comp, editor } = ctx || {};
  if (!editor || !targetPath) return;
  const coordinator = window.MeldexDocumentSaveCoordinator;
  const oldPath = editor._path || '';
  const oldDocumentKey = coordinator && oldPath ? coordinator.documentKeyForPath(oldPath) : '';
  if (editor._saveTimer) {
    clearTimeout(editor._saveTimer);
    editor._saveTimer = null;
  }
  if (oldPath && oldPath !== targetPath && typeof _sn2Editors !== 'undefined') delete _sn2Editors[oldPath];
  editor._path = targetPath;
  editor._dirty = false;
  // 「名前を付けて保存」は別文書を作るため、元ファイルのetag/revisionを
  // 新しい保存先へ持ち越さない。PUT応答の新しい文書IDとrevisionを次回保存の
  // CAS基準として即座に確定する。
  editor._lastSavedEtag = saveResult?.etag || '';
  editor._lastSavedTransportRevision = coordinator && (saveResult?.transport_revision || saveResult?.etag)
    ? coordinator.normalizeTransportRevision(
      coordinator.currentTransportName(),
      saveResult.transport_revision || saveResult.etag,
    )
    : (saveResult?.transport_revision || saveResult?.etag || '');
  if (coordinator) {
    const targetDocumentKey = coordinator.bindDocumentIdentity(targetPath, saveResult || {});
    if (oldDocumentKey && oldDocumentKey !== targetDocumentKey) {
      coordinator.unregisterParticipant?.(oldDocumentKey, editor);
    }
    coordinator.registerParticipant?.(targetDocumentKey, editor);
  }
  if (typeof createScriptNoteRowIdSet === 'function') editor._lastSavedRowIds = createScriptNoteRowIdSet(editor.doc);
  if (typeof _sn2Editors !== 'undefined') {
    _sn2Editors[targetPath] = editor;
    if (editor._historyScopeId) _sn2Editors[editor._historyScopeId] = editor;
    editor._sn2RegisteredPath = targetPath;
    editor._sn2RegisteredScopeId = editor._historyScopeId || '';
  }
  const label = typeof getScriptNoteLabelFromPath === 'function'
    ? getScriptNoteLabelFromPath(targetPath, editor.doc?.title || '')
    : (targetPath.split('/').pop() || targetPath).replace(/(?:\.mel-scenario|\.scriptnote\.json)$/i, '');
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

async function _sn2PrepareSaveAsDocument(exportDoc, targetPath, sourcePath, targetExists) {
  const text = JSON.stringify(exportDoc, null, 2);
  const independentCopy = String(targetPath || '').replace(/\\/g, '/') !== String(sourcePath || '').replace(/\\/g, '/');
  if (!independentCopy) return { doc: exportDoc, text, documentId: '', independentCopy: false };

  const identity = window.MeldexDocumentIdentity;
  const format = identity?.formatForPath?.(targetPath, text) || null;
  if (!format) {
    // .scriptnote.json等の旧形式は文書ID基盤の対象外。元の.mel-scenario由来IDを
    // 持ち込むと保存直後と再読込後でdocumentKeyが変わるため、IDだけを除外する。
    const legacyDoc = JSON.parse(text);
    if (legacyDoc?.meldex && typeof legacyDoc.meldex === 'object') {
      delete legacyDoc.meldex.document_id;
      if (Object.keys(legacyDoc.meldex).length === 1 && legacyDoc.meldex.metadata_version != null) {
        delete legacyDoc.meldex;
      }
    }
    return { doc: legacyDoc, text: JSON.stringify(legacyDoc, null, 2), documentId: '', independentCopy: true };
  }
  let documentId = '';
  if (targetExists) {
    // 上書き先の文書IDを読めないまま新しいIDを振ると、同じファイルが別文書として扱われ、
    // 版履歴・リンク・競合判定が黙って切り離される。読めない時は保存を止めて理由を返す。
    let current = null;
    try {
      if (typeof apiFetch !== 'function') throw new Error('ファイルを読み込めません');
      current = await apiFetch('/file?path=' + encodeURIComponent(targetPath), { silentError: true });
    } catch (error) {
      throw new Error(`上書き先のシナリオを確認できなかったため保存を中止しました（${error?.message || error}）`);
    }
    documentId = identity.readDocumentId?.(current?.content || '', format) || current?.document_id || '';
  }
  if (!documentId) {
    documentId = identity?.newDocumentId?.() || '';
  }
  if (!documentId) return { doc: exportDoc, text, documentId: '', independentCopy: true };

  const doc = JSON.parse(text);
  doc.meldex = {
    ...(doc.meldex && typeof doc.meldex === 'object' ? doc.meldex : {}),
    metadata_version: 1,
    document_id: documentId,
  };
  return { doc, text: JSON.stringify(doc, null, 2), documentId, independentCopy: true };
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
  const normalizedSourcePath = String(sourcePath || '').replace(/\\/g, '/');
  const normalizedTargetPath = String(targetPath || '').replace(/\\/g, '/');
  if (normalizedSourcePath && normalizedSourcePath === normalizedTargetPath) {
    // 既定名のまま保存してもforce_overwriteでCASを迂回しない。通常保存キューの
    // etag/transport_revision検証をそのまま通す。
    const saved = typeof editor.save === 'function' ? await editor.save() : false;
    return saved !== false;
  }
  if (!(await _sn2ConfirmScriptNoteOverwrite(targetPath, sourcePath, options))) return false;
  const targetExists = await _sn2ScriptNoteFileExists(targetPath);
  const prepared = await _sn2PrepareSaveAsDocument(exportDoc, targetPath, sourcePath, targetExists);
  const rawSaveResult = await apiPut('/file?path=' + encodeURIComponent(targetPath), {
    content: prepared.text,
    ...(targetExists ? { force_overwrite: true } : { create_only: true }),
  }, { backgroundFileWrite: true });
  const documentId = rawSaveResult?.document_id || prepared.documentId || '';
  const saveResult = documentId ? { ...(rawSaveResult || {}), document_id: documentId } : (rawSaveResult || {});
  if (prepared.independentCopy && editor.doc) {
    if (prepared.documentId) {
      editor.doc.meldex = {
        ...(prepared.doc?.meldex || editor.doc.meldex || {}),
        metadata_version: 1,
        document_id: documentId || prepared.documentId,
      };
    } else if (prepared.doc?.meldex && typeof prepared.doc.meldex === 'object') {
      // 旧形式へ切り替えた後の通常保存でも、元.mel-scenarioの文書IDを再混入させない。
      editor.doc.meldex = { ...prepared.doc.meldex };
    } else {
      delete editor.doc.meldex;
    }
  }
  _sn2SetActiveScriptNotePath(ctx, targetPath, saveResult);
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
    const escCss = MeldexEscape.cssIdent;
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
            : targetPath.split('/').pop().replace(/(?:\.mel-scenario|\.scriptnote\.json)$/i, '').replace(/\.\w+$/, '');
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

// ==========================================================
// シナリオの静的スナップショット（HTML保存・PNG・公開で共通）
// ==========================================================
// エディタの現在ビュー（フィルタ・テーマ・タイプ書式・縦/横/折返し・ルビ設定）を
// 操作不可の自己完結HTMLにする。HTML保存・画像（PNG）・公開はすべてこの1つの
// 生成結果を使い、出力形式ごとに見た目がずれないようにする。
//
// 再現の要点:
// - 描画は .sn2-scroll の複製。祖先（エディタホストや :root）から継承している
//   CSS変数・文字設定は複製側へ計算済みの値で書き写す（祖先は出力に含まれないため）。
// - 行選択の列（_handle）は見出しセルと行の両方から外す（片方だけ外すと縦書きで
//   見出しと行が列幅ぶんずれる）。
// - ルビはエディタと同じ表現（data-ruby と疑似要素）のまま出力し、ルビ設定
//   （大きさ・位置・揃え・字間・書体）をそのまま効かせる。
// - 折り返し表示は段の割り付けがエディタの表示寸法で決まるため、その寸法を固定する。
const SN2_EXPORT_REMOVE_SELECTOR = [
  '.sn2-row-bulk-bar', '.sn2-handle-zone', '.sn2-handle', '.sn2-add-row', '.sn2-add-col-btn',
  '.sn2-resizer', '.sn2-col-resizer', '.sn2-row-resizer', '.sn2-row-check',
  '[data-col-id="_handle"]', '.sn2-drop-indicator',
  // 縦書きでスクロール端まで寄せるための編集用余白（画面幅比率の空白）。出力には不要で、
  // 画像化時に幅の基準が変わると内容がずれる原因になる。
  '.sn2-pan-spacer-inline', '.sn2-pan-spacer',
  // 入力中の独自カーソル、コメントの件数バッジ（内部のやり取りを公開しない）
  '.sn2-custom-caret', '.cmt-badge', '[data-export-remove]',
  // 文書として出力してはならない要素
  'script', 'iframe', 'object', 'embed', 'base', 'meta', 'link', 'portal',
].join(', ');
const SN2_EXPORT_TRANSIENT_CLASSES = [
  'sn2-dragging', 'sn2-cell-active', 'sn2-drop-below', 'sn2-drop-above', 'sn2-swap-highlight',
  'sn2-text-cell-selected', 'sn2-row-selected', 'sn2-role-cell-selected', 'sn2-grid-cell-selected',
  'sn2-panning', 'cmt-line-highlight',
];
// 出力に残す data 属性（表示のCSSが参照するもの）。それ以外（リンク先の内部パス
// data-path など）は出力・公開に載せない。
const SN2_EXPORT_DATA_ATTR_RE = /^data-(after|before|align|border|col-border-right|col-id|row-id|kind|outline|overflow|ruby(-[a-z-]+)?|spread-border|valign|status)$/;

function _sn2ExportSafeLink(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('#')) return raw;
  try {
    const url = new URL(raw, document.baseURI);
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol) ? url.toString() : '';
  } catch { return ''; }
}

// 出力・公開用の属性の清掃（イベント属性・内部パス・危険なリンクを除去）
function _sn2ExportSanitizeAttributes(clone) {
  [clone, ...clone.querySelectorAll('*')].forEach(node => {
    Array.from(node.attributes || []).forEach(attr => {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'srcset' || name === 'title') {
        node.removeAttribute(attr.name);
      } else if (name.startsWith('data-') && !SN2_EXPORT_DATA_ATTR_RE.test(name)) {
        node.removeAttribute(attr.name);
      } else if (name === 'href' || name === 'xlink:href') {
        const safe = _sn2ExportSafeLink(attr.value);
        if (safe && !/^data:/i.test(attr.value)) node.setAttribute(attr.name, safe);
        else if (!/^data:/i.test(attr.value)) node.removeAttribute(attr.name);
      }
    });
  });
}
// 祖先から継承され、エクスポート先では失われる文字・色の計算値
const SN2_EXPORT_INHERITED_PROPS = [
  'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'font-feature-settings', 'font-kerning', 'text-rendering', '-webkit-font-smoothing',
];

function _sn2ExportComputedCustomProperties(el) {
  const out = [];
  if (!el) return out;
  const cs = getComputedStyle(el);
  for (let i = 0; i < cs.length; i++) {
    const name = cs[i];
    if (!name || !name.startsWith('--')) continue;
    const value = cs.getPropertyValue(name).trim();
    if (value) out.push([name, value]);
  }
  return out;
}

// 元要素の計算済みスタイルを複製へ固定する（レイアウト依存の寸法・既定書体を出力先でも再現する）
const SN2_EXPORT_CONTROL_PROPS = [
  'display', 'box-sizing', 'width', 'height', 'min-width', 'min-height', 'flex-grow', 'flex-shrink', 'flex-basis',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-radius', 'background-color', 'color', 'font-family', 'font-size', 'font-weight', 'font-style',
  'line-height', 'letter-spacing', 'text-align', 'vertical-align', 'align-items', 'justify-content',
  'writing-mode', 'text-orientation', 'white-space', 'overflow-x', 'overflow-y', 'text-overflow',
];

// 寸法は整数に丸めた offsetWidth/offsetHeight ではなく実寸で固定する。丸めると列ごとに
// 1px未満のずれが積み重なり、公開HTMLの文字の位置が画面と1px違ってくる。
function _sn2ExportExactSize(el, axis) {
  const z = typeof _getZoom === 'function' ? (_getZoom() || 1) : 1;
  const rect = el.getBoundingClientRect();
  const value = (axis === 'height' ? rect.height : rect.width) / z;
  if (!(Number.isFinite(value) && value > 0)) return axis === 'height' ? el.offsetHeight : el.offsetWidth;
  // 書き出しの style 属性は有効数字6桁で書かれる（35.390625px → 35.3906px）。ブラウザは寸法を
  // 1/64px 単位に切り捨てるため、そのままだと 1/64px 小さくなり、縦書きの文字が1px近くずれる。
  // 1/64px 単位へ揃えた値に半単位（1/128px）を足し、6桁に丸めても同じ寸法に戻るようにする。
  return Math.floor(value * 64 + 1e-6) / 64 + 1 / 128;
}

// ルビは画面では親文字の ::after として、親文字からの相対位置で置いている。縦書きの親文字は
// inline のため、その基準（包含ブロック）の決め方がブラウザで違い、iPhone（Safari と同じ描画の仕組み）では
// ルビが親文字から離れて出ていた。書き出しでは、画面で決まったルビの位置を本文のセルからの位置として
// 計り、本物の要素として置く（どのブラウザでも同じ位置になる）。
const SN2_EXPORT_RUBY_STYLE_PROPS = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-variant-east-asian',
  'font-feature-settings', 'font-kerning', 'letter-spacing', 'word-spacing', 'color', 'opacity', 'line-height',
  'white-space', 'writing-mode', 'text-orientation', 'text-align', 'text-indent', 'text-shadow',
  '-webkit-text-stroke-width', '-webkit-text-stroke-color', '-webkit-text-fill-color',
  'text-decoration-line', 'text-decoration-color', 'text-decoration-style', 'paint-order',
];

// 縦書き用の字形（OpenType の vert）を明示して使う。Chrome は縦書きで自動的に使うが、Safari と同じ描画の
// 仕組み（WebKit）は埋め込んだフォントで使わないことがあり、「 」（ ）…ー、。が横書きの形のまま並んでいた。
function _sn2ExportWithVert(value) {
  const current = String(value || '').trim();
  if (/["']vert["']/.test(current)) return current;
  return current && current !== 'normal' ? `${current}, "vert" 1` : '"vert" 1';
}

function _sn2ExportEnableVerticalGlyphs(original, clone) {
  if (!original.classList.contains('sn2-vertical')) return;
  const sources = [original, ...original.querySelectorAll('*')];
  const targets = [clone, ...clone.querySelectorAll('*')];
  if (sources.length !== targets.length) return;
  sources.forEach((src, index) => {
    const value = getComputedStyle(src).fontFeatureSettings;
    targets[index].style.setProperty('font-feature-settings', _sn2ExportWithVert(value));
  });
}

function _sn2ExportPlaceRuby(original, clone) {
  const z = typeof _getZoom === 'function' ? (_getZoom() || 1) : 1;
  const px = value => parseFloat(value) || 0;
  const sources = original.querySelectorAll('.sn2-text [data-ruby], .sn2-custom-text [data-ruby]');
  const targets = clone.querySelectorAll('.sn2-text [data-ruby], .sn2-custom-text [data-ruby]');
  if (sources.length !== targets.length) return;
  const vertical = original.classList.contains('sn2-vertical');
  sources.forEach((src, index) => {
    const dst = targets[index];
    const cell = src.closest('.sn2-text, .sn2-custom-text');
    const dstCell = dst.closest('.sn2-text, .sn2-custom-text');
    if (!cell || !dstCell) return;
    const ps = getComputedStyle(src, '::after');
    if (!ps.content || ps.content === 'none' || ps.content === 'normal') return;
    const span = src.getBoundingClientRect();
    const box = cell.getBoundingClientRect();
    const width = px(ps.width);
    const height = px(ps.height);
    const left = span.left / z + px(ps.left);
    const top = vertical ? span.top / z + px(ps.top) : span.bottom / z - px(ps.bottom) - height;
    const ruby = document.createElement('span');
    ruby.className = 'sn2-export-ruby';
    ruby.setAttribute('aria-hidden', 'true');
    ruby.textContent = src.getAttribute('data-ruby-rendered') || src.getAttribute('data-ruby') || '';
    SN2_EXPORT_RUBY_STYLE_PROPS.forEach(name => {
      const value = ps.getPropertyValue(name);
      if (value) ruby.style.setProperty(name, value);
    });
    if (vertical) ruby.style.setProperty('font-feature-settings', _sn2ExportWithVert(ps.fontFeatureSettings));
    // 親文字（span）からの位置で置く。親文字が別の位置へ組まれるブラウザでも、ルビは親文字に付いて動く。
    // 行の太さの方向（縦書きは左右、横書きは上下）は、親文字の箱の大きさがブラウザで違う（行間の扱いの差）ため、
    // 親文字の中心からの位置で置く。
    const spanW = span.width / z;
    const spanH = span.height / z;
    ruby.style.setProperty('position', 'absolute');
    if (vertical) {
      ruby.style.setProperty('left', `calc(50% + ${left - span.left / z - spanW / 2}px)`);
      ruby.style.setProperty('top', (top - span.top / z) + 'px');
    } else {
      ruby.style.setProperty('left', (left - span.left / z) + 'px');
      ruby.style.setProperty('top', `calc(50% + ${top - span.top / z - spanH / 2}px)`);
    }
    ruby.style.setProperty('width', width + 'px');
    ruby.style.setProperty('height', height + 'px');
    ruby.style.setProperty('margin', '0');
    ruby.style.setProperty('padding', '0');
    ruby.style.setProperty('pointer-events', 'none');
    ruby.style.setProperty('overflow', 'visible');
    dst.setAttribute('data-ruby-placed', '1');
    dst.style.setProperty('position', 'relative');
    dst.appendChild(ruby);
  });
}

// 三点リーダー（…）・二点リーダー（‥）は、本文を「正立」で組むと、Safari と同じ描画の仕組み（iPhone の
// Dropbox アプリ等）では縦書き用の字形に差し替わらず、横向きのまま描かれる。縦書きの本文では、同じ形の
// 縦書き用の文字（︙ ︰）に置き換える（Chrome の画面でも縦向きに描かれている）。埋め込むフォントには、
// 元の約物の縦書き用の字形を縦書き用の文字として足してあり、画面と同じ字形になる（meldex_font_subset.py）。
const SN2_EXPORT_VERTICAL_FORMS = { '…': '︙', '‥': '︰' };

function _sn2ExportVerticalForms(clone) {
  if (!clone.classList.contains('sn2-vertical')) return;
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.parentElement?.closest('.sn2-text, .sn2-custom-text')) continue;
    const value = node.nodeValue || '';
    if (/[…‥]/.test(value)) node.nodeValue = value.replace(/[…‥]/g, ch => SN2_EXPORT_VERTICAL_FORMS[ch] || ch);
  }
}

// 縦書きの約物（※・…・ー・括弧・句読点・全角の！？等）の向き: 本文のセルは画面と同じく「正立」
// （text-orientation: upright）を明示しており、向きは縦書き用の字形（vert）で決まる。約物を1文字ずつ
// 別の要素に分けると、Safari と同じ描画の仕組みでは縦書き用の字形に差し替わらなくなるため、分けない
// （2026-11-21 に WebKit で確認）。

function _sn2ExportFreezeLayout(original, clone) {
  const vertical = original.classList.contains('sn2-vertical');
  const freezeMainAxis = (src, dst) => {
    const cs = getComputedStyle(src);
    if (cs.display === 'none') return;
    dst.style.setProperty('box-sizing', 'border-box', 'important');
    if (vertical) dst.style.setProperty('height', _sn2ExportExactSize(src, 'height') + 'px', 'important');
    else dst.style.setProperty('width', _sn2ExportExactSize(src, 'width') + 'px', 'important');
    dst.style.setProperty('flex', '0 0 auto', 'important');
  };
  // 見出しセルはエディタで表示領域に合わせて縮められ、行はその寸法に揃えてある。
  // 出力先では縮まないため、見出しセルの実寸を固定して行とずれないようにする。
  const pairs = (selector, fn) => {
    const a = original.querySelectorAll(selector);
    const b = clone.querySelectorAll(selector);
    if (a.length !== b.length) return;
    a.forEach((el, i) => fn(el, b[i]));
  };
  pairs('.sn2-header-cell', freezeMainAxis);
  // 見出し列そのものの太さ（縦書きは幅、横書きは高さ）もエディタでは縮められている
  pairs('.sn2-header', (src, dst) => {
    if (getComputedStyle(src).display === 'none') return;
    dst.style.setProperty('box-sizing', 'border-box', 'important');
    if (vertical) dst.style.setProperty('width', _sn2ExportExactSize(src, 'width') + 'px', 'important');
    else dst.style.setProperty('height', _sn2ExportExactSize(src, 'height') + 'px', 'important');
    dst.style.setProperty('flex-shrink', '0', 'important');
  });
  // 行内のセルも同様（行の寸法はエディタが見出しに合わせて固定済み。セル側は縮み方が
  // 出力先で変わると本文の折り返し位置まで変わる）
  // 行の太さ（縦書きは幅、横書きは高さ）もエディタの実寸に揃える
  pairs('.sn2-row', (src, dst) => {
    if (getComputedStyle(src).display === 'none') return;
    if (vertical) dst.style.setProperty('width', _sn2ExportExactSize(src, 'width') + 'px');
    else dst.style.setProperty('height', _sn2ExportExactSize(src, 'height') + 'px');
  });
  pairs('.sn2-row > *', (src, dst) => {
    if (src.matches('.sn2-row-spacer, .sn2-handle-zone, .sn2-handle')) return;
    freezeMainAxis(src, dst);
  });
  // ルビの親文字には、アプリ全体のCSS（ノートと共通の [data-ruby] の規則。親文字の途中で行を分けない）も
  // 効いている。書き出しはシナリオのCSSだけを持つため、行分けに関わる値を計算済みの値で写す。
  pairs('[data-ruby]', (src, dst) => {
    const cs = getComputedStyle(src);
    ['white-space-collapse', 'text-wrap-mode'].forEach(name => {
      const value = cs.getPropertyValue(name);
      if (value) dst.style.setProperty(name, value);
    });
  });
  // ボタン・入力欄は既定書体（ブラウザ既定）と既定の枠を持つ。span 化しても同じ見た目に
  // なるよう計算済みスタイルを書き写しておく。
  pairs('button, input, select, textarea', (src, dst) => {
    const cs = getComputedStyle(src);
    // 値はプロパティで設定されるため複製に残らない。表示中の文字列を元要素から控える。
    if (src.tagName === 'SELECT') dst.setAttribute('data-export-text', src.selectedIndex >= 0 ? (src.options[src.selectedIndex]?.textContent || '') : '');
    else if (src.tagName === 'INPUT' && (src.type === 'checkbox' || src.type === 'radio')) dst.setAttribute('data-export-text', src.checked ? '☑' : '☐');
    else if (src.tagName === 'INPUT' || src.tagName === 'TEXTAREA') dst.setAttribute('data-export-text', src.value || '');
    SN2_EXPORT_CONTROL_PROPS.forEach(name => {
      const value = cs.getPropertyValue(name);
      if (value) dst.style.setProperty(name, value);
    });
    if (cs.display === 'inline-block' || cs.display === 'inline') dst.style.setProperty('display', 'inline-block');
  });
}

function _sn2ExportStripInteractive(clone) {
  clone.querySelectorAll(SN2_EXPORT_REMOVE_SELECTOR).forEach(el => el.remove());
  SN2_EXPORT_TRANSIENT_CLASSES.forEach(cls => {
    clone.querySelectorAll('.' + cls).forEach(el => el.classList.remove(cls));
  });
  clone.querySelectorAll('[contenteditable]').forEach(el => {
    el.removeAttribute('contenteditable');
    el.setAttribute('data-readonly', '1');
    // 編集可能領域にはブラウザ既定で「空白の後で折り返す」改行規則が付く。属性を外しても
    // エディタと同じ位置で改行されるよう、同じ規則を明示しておく。
    el.style.setProperty('-webkit-line-break', 'after-white-space');
  });
  clone.querySelectorAll('[data-action], [data-sn-action]').forEach(el => {
    el.removeAttribute('data-action');
    el.removeAttribute('data-sn-action');
  });
  // ボタン（キャラ・タイプ表示）は見た目を保つため span へ置き換える。disabled の
  // ままだと閲覧ブラウザの既定スタイル（灰色化）が混ざる。
  clone.querySelectorAll('button').forEach(btn => {
    const span = document.createElement('span');
    Array.from(btn.attributes).forEach(attr => {
      if (/^(type|disabled|aria-haspopup|aria-expanded|tabindex|onclick)$/i.test(attr.name)) return;
      span.setAttribute(attr.name, attr.value);
    });
    span.style.removeProperty('pointer-events');
    while (btn.firstChild) span.appendChild(btn.firstChild);
    btn.replaceWith(span);
  });
  clone.querySelectorAll('input, textarea, select').forEach(el => {
    const span = document.createElement('span');
    span.className = el.className;
    const frozen = el.getAttribute('style');
    if (frozen) span.setAttribute('style', frozen);
    const exportText = el.getAttribute('data-export-text');
    if (el.dataset) Object.entries(el.dataset).forEach(([key, value]) => { if (key !== 'exportText') span.dataset[key] = value; });
    if (exportText !== null) span.textContent = exportText;
    else if (el.type === 'checkbox' || el.type === 'radio') span.textContent = el.checked ? '☑' : '☐';
    else if (el.tagName === 'SELECT') span.textContent = el.selectedOptions?.[0]?.textContent || el.value || '';
    else span.textContent = el.value || el.textContent || '';
    el.replaceWith(span);
  });
  clone.querySelectorAll('[tabindex]').forEach(el => el.removeAttribute('tabindex'));
  clone.querySelectorAll('[draggable]').forEach(el => el.removeAttribute('draggable'));
  clone.querySelectorAll('[role="button"], [role="textbox"], [role="separator"]').forEach(el => {
    el.removeAttribute('role');
    el.removeAttribute('aria-readonly');
    el.removeAttribute('aria-multiline');
  });
  clone.querySelectorAll('[data-e2e-id]').forEach(el => el.removeAttribute('data-e2e-id'));
  clone.querySelectorAll('[style*="cursor"]').forEach(el => el.style.removeProperty('cursor'));
  _sn2ExportSanitizeAttributes(clone);
}

// 表示中に使われている文字の太さだけを埋め込む（太字の行を合成太字にしない）
function _sn2ExportUsedFontWeights(scroll) {
  const used = new Set(['regular']);
  if (!scroll) return Array.from(used);
  const nodes = [scroll, ...scroll.querySelectorAll('*')];
  for (const node of nodes) {
    const weight = Number.parseInt(getComputedStyle(node).fontWeight, 10) || 400;
    if (weight >= 600) used.add('bold');
    else if (weight >= 500) used.add('medium');
    if (used.size === 3) break;
  }
  return ['regular', 'medium', 'bold'].filter(key => used.has(key));
}

async function _sn2ExportEmbedFontCss(enabled, weights) {
  if (enabled === false) return '';
  if (typeof MeldexExportHtml !== 'undefined' && typeof MeldexExportHtml.embedFont === 'function') {
    try {
      const css = await MeldexExportHtml.embedFont(weights && weights.length ? weights : ['regular']);
      if (css) return css;
    } catch {}
  }
  try {
    const r = await fetch('fonts/NotoSansJP-Regular.woff2');
    if (!r.ok) return '';
    const bin = new Uint8Array(await r.arrayBuffer());
    let s = '';
    for (let i = 0; i < bin.length; i += 0x8000) s += String.fromCharCode.apply(null, bin.subarray(i, i + 0x8000));
    return `@font-face { font-family: 'Noto Sans JP'; font-style: normal; font-weight: 400; src: url('data:font/woff2;base64,${btoa(s)}') format('woff2'); }`;
  } catch {
    return '';
  }
}

// 描画フレームを n 回待つ。ウィンドウが非表示・裏に回っていると描画フレームが進まず
// 出力が永久に止まるため、各フレームを最大 80ms でタイマーへ切り替える。
function _sn2ExportNextFrames(count = 2) {
  const one = () => new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    try { requestAnimationFrame(finish); } catch {}
    setTimeout(finish, 80);
  });
  let chain = Promise.resolve();
  for (let i = 0; i < count; i++) chain = chain.then(one);
  return chain;
}

async function _sn2ExportEditorCss() {
  let css = '';
  try { css = await _sn2FetchCssWithImports('gb-scriptnote-editor.css'); } catch {}
  // CSS内の相対 url()（画像・フォント）は自己完結のため data URI 化する
  if (css && typeof MeldexExportHtml !== 'undefined' && typeof MeldexExportHtml.inlineCssAssets === 'function') {
    try { css = await MeldexExportHtml.inlineCssAssets(css, document.baseURI); } catch {}
  }
  return css;
}

/**
 * シナリオの静的スナップショットを作る。
 * @param {object} editor - アクティブなシナリオエディタ
 * @param {{purpose?: 'html'|'image'|'publish', embedFont?: boolean}} options
 */
async function buildScriptNoteExportDocument(editor, options = {}) {
  if (!editor?.doc) return null;
  try { editor._syncAllFromDom?.(); } catch {}
  // 表示中の DOM がそのまま出力の正本。全体を描き直すと行選択やスクロール位置が失われるため、
  // 入力中のセル（記法がまだ描画に反映されていない可能性がある）がある時だけ描き直す。
  const active = document.activeElement;
  const editingCell = !!(active && editor.host?.contains?.(active) && active.isContentEditable);
  if (editingCell) {
    try { editor._render(); } catch {}
  }
  // 縦書きの行寸法は描画後のフレームで確定する。2フレーム待ってから複製する。
  await _sn2ExportNextFrames(2);
  try { if (document.fonts?.ready) await document.fonts.ready; } catch {}
  const scroll = editor.host?.querySelector('.sn2-scroll');
  if (!scroll) return null;

  const vertical = scroll.classList.contains('sn2-vertical');
  const wrap = scroll.classList.contains('sn2-wrap');
  const viewWidth = Math.max(320, Math.round(scroll.clientWidth || 1200));
  const viewHeight = Math.max(200, Math.round(scroll.clientHeight || 800));

  const clone = scroll.cloneNode(true);
  _sn2ExportFreezeLayout(scroll, clone);
  _sn2ExportEnableVerticalGlyphs(scroll, clone);
  _sn2ExportPlaceRuby(scroll, clone);
  _sn2ExportStripInteractive(clone);
  _sn2ExportVerticalForms(clone);

  // 祖先由来の CSS 変数（テーマ・ファイルテーマ・UI設定）を計算値で固定する
  _sn2ExportComputedCustomProperties(scroll).forEach(([name, value]) => {
    if (!clone.style.getPropertyValue(name)) clone.style.setProperty(name, value);
  });
  const scrollStyle = getComputedStyle(scroll);
  SN2_EXPORT_INHERITED_PROPS.forEach(name => {
    const value = scrollStyle.getPropertyValue(name);
    if (value && !clone.style.getPropertyValue(name)) clone.style.setProperty(name, value);
  });
  const bg = scrollStyle.backgroundColor;
  // 折り返し表示は段の割り付けを決めた寸法を固定する（縦書きは幅、横書きは高さ）
  if (wrap && vertical) clone.style.setProperty('width', viewWidth + 'px', 'important');
  if (wrap && !vertical) clone.style.setProperty('height', viewHeight + 'px', 'important');

  if (typeof MeldexExportHtml !== 'undefined' && typeof MeldexExportHtml.embedImages === 'function') {
    try { await MeldexExportHtml.embedImages(clone); } catch {}
  }

  // HTML保存・公開は、使っている文字だけのフォント（画面と同じ書体）を埋め込む。iPhone 等には同じ
  // フォントが無く、置き換わると字形・文字の幅・約物の向きが変わってルビもずれるため。
  // 画像（PNG）は画面と同じブラウザで描くため、従来の埋め込みのままにする。
  const subsetFont = options.purpose !== 'image' && options.embedFont !== false
    && typeof MeldexExportHtml !== 'undefined' && typeof MeldexExportHtml.subsetFontCss === 'function'
    ? MeldexExportHtml.subsetFontCss(scroll)
    : Promise.resolve(null);
  const [editorCss, subset] = await Promise.all([_sn2ExportEditorCss(), subsetFont]);
  const fontCss = subset?.css || await _sn2ExportEmbedFontCss(options.embedFont, _sn2ExportUsedFontWeights(scroll));
  const rootVars = _sn2ExportComputedCustomProperties(document.documentElement)
    .map(([name, value]) => `${name}: ${value};`).join(' ');

  const fileStem = String(editor._path || '').split('/').pop().replace(/(\.mel-scenario|\.scriptnote\.json)$/i, '');
  const title = String(editor.doc.title || fileStem || 'シナリオ');
  const safeTitle = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80) || '無題';
  const escHtml = MeldexEscape.html;
  const pageBg = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
    ? bg
    : 'var(--sn2-page-bg, var(--content-bg, var(--bg, #1e1e1e)))';
  const csp = options.purpose === 'publish'
    ? '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; media-src data:; form-action \'none\'">\n<meta name="referrer" content="no-referrer">\n'
    : '';

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${csp}<meta name="color-scheme" content="dark light">
<title>${escHtml(title)}</title>
<style>
${fontCss}
/* アプリ本体と同じ基本リセット（gb-theme.css）。無いとセル内余白の寸法計算がずれる */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root { ${rootVars} }
html, body {
  margin: 0; padding: 0;
  background: ${pageBg};
  color: var(--fg, #d4d4d4);
  font-family: var(--ui-font, 'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic UI', 'Meiryo', sans-serif);
  font-size: var(--ui-font-size, 15px);
}
${editorCss}
/* 書き出し: ルビは本物の要素として置く（::after は使わない） */
[data-ruby-placed]::after { content: none !important; }
/* Safari と同じ描画の仕組み（iPhone の Dropbox アプリ等）だけに効かせる（WebKit だけが対応している「句読点のぶら下げ」で見分ける）。縦書きの詰め（vpal）を正しく扱えず、
   括弧・三点リーダー・長音が文字の枠からはみ出したり横向きの形のまま描かれたりするため、縦書き用の字形（vert）
   だけを使う。 */
@supports (hanging-punctuation: first) {
  .sn2-scroll.sn2-vertical, .sn2-scroll.sn2-vertical * { font-feature-settings: "vert" 1 !important; }
  /* inline の親文字を基準にした位置は、WebKit では行の太さの分ずれる。inline-block にすると、
     親文字の箱（字面を中央に置く）を基準にでき、ルビの位置（親文字の中心から）が Chrome と一致する */
  .sn2-scroll.sn2-vertical .sn2-text span[data-ruby][data-ruby-placed],
  .sn2-scroll.sn2-vertical .sn2-custom-text span[data-ruby][data-ruby-placed] { display: inline-block !important; }
}
/* 縦書きの詰めは埋め込むフォントに書き込んである（meldex_font_subset.py）。ブラウザ独自の約物の詰め
   （text-spacing-trim）は、画面では縦書きの詰めの指定があるため働かない。詰めの指定を使わないブラウザでも
   二重に詰めないよう、明示して止める */
.sn2-scroll.sn2-vertical .sn2-text, .sn2-scroll.sn2-vertical .sn2-custom-text { text-spacing-trim: space-all; }
/* 静的エクスポート用の上書き: 操作 UI を隠し、内容の寸法で配置する */
body { padding: 16px; box-sizing: border-box; }
body > .sn2-scroll {
  flex: none !important;
  overflow: visible !important;
  max-height: none !important;
  max-width: none !important;
  position: relative !important;
}
body > .sn2-scroll:not(.sn2-wrap) { height: auto !important; width: max-content !important; }
body > .sn2-scroll.sn2-vertical:not(.sn2-wrap) { margin-left: auto; }
body > .sn2-scroll.sn2-wrap.sn2-vertical { height: auto !important; }
body > .sn2-scroll.sn2-wrap:not(.sn2-vertical) { width: max-content !important; }
.sn2-header, .sn2-scroll.sn2-wrap .sn2-header,
.sn2-scroll.sn2-vertical:not(.sn2-wrap) > .sn2-header { position: relative !important; top: auto !important; left: auto !important; right: auto !important; }
.sn2-row-bulk-bar, .sn2-handle, .sn2-handle-zone, .sn2-add-row, .sn2-add-col-btn,
.sn2-resizer, .sn2-col-resizer, .sn2-row-resizer, .sn2-row-check { display: none !important; }
.sn2-row, .sn2-header-cell { cursor: default !important; }
*, *::before, *::after { user-select: text !important; -webkit-user-select: text !important; caret-color: transparent; }
.sn2-text:focus, .sn2-custom-text:focus { outline: none !important; }
@media print {
  body { padding: 0; }
  .sn2-row { break-inside: avoid; }
}
</style>
</head>
<body>
${clone.outerHTML}
</body>
</html>`;
  return { html, title, safeTitle, viewportWidth: viewWidth + 32, viewportHeight: viewHeight + 32, vertical };
}

// シナリオエディタの現在ビューを操作不可の静的 HTML として保存する。
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
  let snapshot = null;
  try {
    // HTMLの作成中は処理パネルに出す（ステータスバーには進捗を出さない。2026-11-21）。
    const build = () => buildScriptNoteExportDocument(editor, { purpose: 'html' });
    snapshot = typeof runWithProgress === 'function'
      ? await runWithProgress('HTMLを作成しています', build, { kind: 'export-html' })
      : await build();
  } catch (error) {
    if (typeof showStatus === 'function') showStatus('HTML の生成に失敗しました: ' + (error?.message || error), true);
    return;
  }
  if (!snapshot) {
    if (typeof showStatus === 'function') showStatus('レンダリング結果が見つかりません', true);
    return;
  }
  if (typeof MeldexExportSave !== 'undefined' && typeof MeldexExportSave.saveText === 'function') {
    await MeldexExportSave.saveText(snapshot.html, {
      title: snapshot.safeTitle,
      extension: '.html',
      dialogTitle: 'HTMLとして保存',
      filetypes: [['HTMLファイル', '*.html'], ['すべてのファイル', '*.*']],
      bom: true,
      okMessage: 'HTML として保存しました',
      errorMessage: 'HTML の保存に失敗しました',
    });
  }
}
if (typeof window !== 'undefined') {
  window.buildScriptNoteExportDocument = buildScriptNoteExportDocument;
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
    // ルビ記法の区切り文字（\ { | }）が親文字・ルビに含まれる場合はエスケープし、
    // 記法として一意に読めるようにする（例: 親文字 "A|B" → {A\|B|ルビ}）。
    if (segment.type === 'ruby') {
      const escRuby = value => String(value || '').replace(/[\\{}|]/g, ch => '\\' + ch);
      return `{${escRuby(segment.plain)}|${escRuby(segment.ruby)}}`;
    }
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
    const displayRole = String(row?.character || role).trim();
    const rawBody = _sn2ScriptNoteRowTextForMarkdown(row?.text || '');
    if (role && breakNames.has(role)) {
      // 区切り（ページ送り）行はセクション区切りの水平線に変換する
      if (idx > 0) blocks.push('---');
      const trimmed = rawBody.trim();
      if (trimmed) blocks.push(trimmed.split('\n').join('  \n'));
      return;
    }
    const lines = rawBody.split('\n');
    if (displayRole) lines[0] = lines[0] ? `**[${displayRole}]** ${lines[0]}` : `**[${displayRole}]**`;
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
      // 埋め込んだ共通部品（フォルダツリー等）は部品側の寸法に任せる。ここで拡大すると共通の見た目が崩れる
      if (control.closest('[data-ui-component]')) return;
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
