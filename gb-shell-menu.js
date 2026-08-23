/**
 * Meldex Shell Menu Integration
 * OSシェル動詞の取得・キャッシュ・実行・カスタマイズ
 */

const _shellVerbCache = {}; // path key -> [{name, raw}]
const _HIDDEN_VERBS_KEY = 'gb:hidden-shell-verbs';
const _PINNED_VERBS_KEY = 'gb:pinned-shell-verbs';

function _shellVerbCacheKey(path) {
  return String(path || '').replace(/[\\/]+/g, '/').toLowerCase();
}

function _shellMenuEscHtml(value) {
  return MeldexEscape.html(value);
}

function _shellMenuIconHtml(icon, size = 14) {
  if (!icon || typeof lucide !== 'function') return '';
  return '<span class="menu-icon">' + lucide(icon, size) + '</span>';
}

function _shellMenuAppendItem(menu, label, action, options = {}) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'gb-context-menu-item' + (options.className ? ' ' + options.className : '');
  item.setAttribute('role', options.role || 'menuitem');
  if (options.e2eId) item.dataset.e2eId = options.e2eId;
  if (options.disabled) {
    item.disabled = true;
    item.classList.add('disabled');
  }
  if (options.html != null) {
    item.innerHTML = options.html;
  } else {
    item.innerHTML = _shellMenuIconHtml(options.icon) + '<span>' + _shellMenuEscHtml(label) + '</span>';
  }
  if (options.hasSubmenu) {
    item.classList.add('has-submenu');
    item.setAttribute('aria-haspopup', 'menu');
    item.setAttribute('aria-expanded', 'false');
  }
  item.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (item.disabled) return;
    if (typeof action === 'function') action(event);
  });
  menu.appendChild(item);
  return item;
}

function _shellMenuAppendSeparator(menu) {
  const sep = document.createElement('div');
  sep.className = 'gb-context-menu-sep cm-sep';
  sep.setAttribute('role', 'separator');
  menu.appendChild(sep);
  return sep;
}

function _shellMenuCreatePanel(label) {
  const panel = document.createElement('div');
  panel.className = 'gb-context-menu';
  panel.setAttribute('role', 'menu');
  panel.setAttribute('aria-label', label);
  panel.style.cssText = 'display:none;min-width:160px;';
  return panel;
}

function _shellMenuAppendSubmenu(menu, label, icon, panel, e2eId = '') {
  const trigger = _shellMenuAppendItem(menu, label, null, { icon, hasSubmenu: true, className: 'tree-ctx-item', e2eId });
  const setExpanded = (expanded) => trigger.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  trigger.addEventListener('mouseenter', () => setExpanded(true));
  trigger.addEventListener('mouseleave', () => setTimeout(() => {
    if (panel.style.display === 'none') setExpanded(false);
  }, 220));
  trigger.addEventListener('click', () => {
    trigger.dispatchEvent(new MouseEvent('mouseenter', { cancelable: true }));
    setExpanded(true);
  });
  panel.addEventListener('mouseenter', () => setExpanded(true));
  panel.addEventListener('mouseleave', () => setExpanded(false));
  attachHoverSubmenu(trigger, panel);
  return trigger;
}

function _shellVerbText(verb) {
  return String((verb?.name || '') + ' ' + (verb?.raw || ''))
    .replace(/[&…]/g, '')
    .toLowerCase();
}

function _isEditMutationShellVerb(verb) {
  const text = _shellVerbText(verb);
  const japaneseTokens = [
    '削除',
    '完全に削除',
    'ゴミ箱',
    'ごみ箱',
    '名前の変更',
    '名前を変更',
    'リネーム',
    '切り取り',
    '切り取る',
    '貼り付け',
    '貼付',
    '移動',
    '複製',
  ];
  return japaneseTokens.some(token => text.includes(token))
    || /\b(delete|remove|trash|rename|cut|paste|move|duplicate)\b/.test(text);
}

// --- データ取得 ---

async function fetchShellVerbs(path) {
  const cacheKey = _shellVerbCacheKey(path);
  if (_shellVerbCache[cacheKey]) return _shellVerbCache[cacheKey];
  try {
    const verbs = await apiFetch('/shell-verbs?path=' + encodeURIComponent(path));
    if (verbs.length > 0) _shellVerbCache[cacheKey] = verbs;
    return verbs;
  } catch { return []; }
}

async function executeShellVerb(path, verbRaw) {
  try {
    await apiPost('/shell-verb', { path, verb: verbRaw });
  } catch (e) {
    showStatus('実行に失敗しました: ' + e.message, true);
  }
}

// --- 非表示管理 ---

function getHiddenShellVerbs() {
  try { return JSON.parse(localStorage.getItem(_HIDDEN_VERBS_KEY)) || []; } catch { return []; }
}

function setHiddenShellVerbs(list) {
  localStorage.setItem(_HIDDEN_VERBS_KEY, JSON.stringify(list));
}

function isShellVerbHidden(name) {
  return getHiddenShellVerbs().includes(name);
}

function toggleHiddenShellVerb(name) {
  const hidden = getHiddenShellVerbs();
  const idx = hidden.indexOf(name);
  if (idx >= 0) hidden.splice(idx, 1);
  else hidden.push(name);
  setHiddenShellVerbs(hidden);
}

function getPinnedShellVerbs() {
  try {
    const raw = localStorage.getItem(_PINNED_VERBS_KEY);
    return raw == null ? null : (JSON.parse(raw) || []);
  } catch { return null; }
}

function setPinnedShellVerbs(list) {
  localStorage.setItem(_PINNED_VERBS_KEY, JSON.stringify(Array.isArray(list) ? list : []));
}

function _restoreShellVerbPreference(key, previousValue) {
  if (previousValue == null) localStorage.removeItem(key);
  else localStorage.setItem(key, previousValue);
}

function saveShellVerbPreferences(hiddenList, pinnedList) {
  const previousHidden = localStorage.getItem(_HIDDEN_VERBS_KEY);
  const previousPinned = localStorage.getItem(_PINNED_VERBS_KEY);
  try {
    setHiddenShellVerbs(hiddenList);
    setPinnedShellVerbs(pinnedList);
  } catch (error) {
    let rollbackError = null;
    try { _restoreShellVerbPreference(_HIDDEN_VERBS_KEY, previousHidden); } catch (restoreError) { rollbackError = restoreError; }
    try { _restoreShellVerbPreference(_PINNED_VERBS_KEY, previousPinned); } catch (restoreError) { rollbackError ||= restoreError; }
    if (rollbackError && error && typeof error === 'object') error.rollbackError = rollbackError;
    throw error;
  }
}

function _isDefaultPinnedShellVerb(verb) {
  const text = _shellVerbText(verb);
  return text.includes('dropbox')
    || _isArchiveShellVerb(verb);
}

function _isArchiveShellVerb(verb) {
  const text = _shellVerbText(verb);
  return text.includes('圧縮')
    || text.includes('解凍')
    || text.includes('展開')
    || /\b(compress|archive|extract|unzip|zip)\b/.test(text);
}

function isPinnedShellVerb(verb) {
  const configured = getPinnedShellVerbs();
  return configured == null ? _isDefaultPinnedShellVerb(verb) : configured.includes(verb?.name);
}

// --- メニューへの追加 ---

async function appendShellVerbsToMenu(menu, path, options = {}) {
  if (!path) return;
  const editingLocked = !!options.editingLocked;

  function reclampMenu() {
    if (!document.body.contains(menu)) return;
    if (typeof clampPopupToViewport === 'function') {
      clampPopupToViewport(menu);
      return;
    }
    const rect = menu.getBoundingClientRect();
    const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1);
    if (rect.bottom > window.innerHeight) menu.style.top = Math.max(4, (window.innerHeight - rect.height - 4) / z) + 'px';
    if (rect.right > window.innerWidth) menu.style.left = Math.max(4, (window.innerWidth - rect.width - 4) / z) + 'px';
  }

  // プレースホルダー表示
  const sep = _shellMenuAppendSeparator(menu);
  const placeholder = _shellMenuAppendItem(menu, 'OS メニュー 読み込み中...', null, {
    disabled: true,
    className: 'gb-shell-menu-loading',
  });
  reclampMenu();

  const verbs = await fetchShellVerbs(path);
  // メニューがまだDOMにあるか確認
  if (!document.body.contains(menu)) return;

  placeholder.remove();
  if (verbs.length === 0) {
    sep.remove();
    return;
  }

  const hidden = getHiddenShellVerbs();
  const visibleVerbs = verbs.filter(v => (
    !hidden.includes(v.name) && !(editingLocked && _isEditMutationShellVerb(v))
  ));
  const archiveVerbs = visibleVerbs.filter(_isArchiveShellVerb);
  if (archiveVerbs.length) {
    let archivePanel = menu.querySelector('[data-shell-archive-panel="1"]');
    if (!archivePanel) {
      archivePanel = _shellMenuCreatePanel('圧縮/解凍');
      archivePanel.dataset.shellArchivePanel = '1';
      _shellMenuAppendSubmenu(menu, '圧縮/解凍', 'archive', archivePanel, 'tree-ctx-archive-menu');
    }
    archiveVerbs.forEach(v => {
      _shellMenuAppendItem(archivePanel, v.name, () => {
        if (typeof closeTreeContextMenu === 'function') closeTreeContextMenu();
        executeShellVerb(path, v.raw);
      });
    });
  }

  const promotedVerbs = visibleVerbs.filter(v => isPinnedShellVerb(v) && !_isArchiveShellVerb(v));
  promotedVerbs.forEach(v => {
    _shellMenuAppendItem(menu, v.name, () => {
      if (typeof closeTreeContextMenu === 'function') closeTreeContextMenu();
      executeShellVerb(path, v.raw);
    }, { className: 'tree-ctx-item gb-shell-menu-promoted' });
  });

  // サブメニューとして表示
  const shellPanel = _shellMenuCreatePanel('OS メニュー');
  _shellMenuAppendSubmenu(menu, 'OS メニュー', 'monitor', shellPanel, 'tree-ctx-os-menu');

  const submenuVerbs = visibleVerbs.filter(v => !isPinnedShellVerb(v) && !_isArchiveShellVerb(v));
  if (submenuVerbs.length === 0) {
    _shellMenuAppendItem(
      shellPanel,
      visibleVerbs.length > 0
        ? '選択したコマンドはトップに表示中です'
        : (editingLocked ? '編集ロック中のため編集系操作は非表示です' : 'すべて非表示です'),
      null,
      { disabled: true },
    );
  }

  submenuVerbs.forEach(v => {
    const item = _shellMenuAppendItem(shellPanel, v.name, () => {
      closeTreeContextMenu();
      executeShellVerb(path, v.raw);
    });
    // 右クリック/長押しで非表示オプション
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _showHideVerbPopup(e.clientX, e.clientY, v.name, menu, path);
    });
    if (typeof addLongPressHandler === 'function') {
      addLongPressHandler(item, (e) => _showHideVerbPopup(e.clientX, e.clientY, v.name, menu, path));
    }
  });

  // カスタマイズボタン
  _shellMenuAppendSeparator(shellPanel);
  _shellMenuAppendItem(shellPanel, 'メニューのカスタマイズ...', () => {
    closeTreeContextMenu();
    showShellVerbSettings();
  });

  reclampMenu();
}

// --- 右クリックで非表示 ---

function _showHideVerbPopup(x, y, verbName, parentMenu, path) {
  document.querySelectorAll('.shell-verb-popup').forEach(el => el.remove());
  const popup = document.createElement('div');
  popup.className = 'gb-context-menu shell-verb-popup';
  popup.setAttribute('role', 'menu');
  popup.setAttribute('aria-label', 'OS メニュー項目を非表示');
  popup.style.cssText = 'z-index:100001;';
  _shellMenuAppendItem(popup, `「${verbName}」を非表示にする`, () => {
    toggleHiddenShellVerb(verbName);
    popup.remove();
    closeTreeContextMenu();
    showStatus(`「${verbName}」を非表示にしました。カスタマイズから復元できます。`);
  });
  document.body.appendChild(popup);
  if (typeof positionPopup === 'function') {
    positionPopup(popup, { left: x, right: x, top: y, bottom: y });
  } else {
    const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1);
    popup.style.left = (x / z) + 'px';
    popup.style.top = (y / z) + 'px';
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(popup);
  }
  setTimeout(() => {
    const removeListeners = () => {
      document.removeEventListener('pointerdown', closer, true);
      document.removeEventListener('keydown', keyCloser, true);
    };
    const closer = (e) => {
      if (!popup.contains(e.target)) {
        popup.remove();
        removeListeners();
      }
    };
    const keyCloser = (e) => {
      if (e.key !== 'Escape') return;
      popup.remove();
      removeListeners();
    };
    document.addEventListener('pointerdown', closer, true);
    document.addEventListener('keydown', keyCloser, true);
  }, 0);
}

// --- カスタマイズモーダル ---

async function showShellVerbSettings() {
  const compactDialog = window.matchMedia?.('(max-width: 900px), (pointer: coarse)')?.matches === true;
  // 全キャッシュから動詞を集約
  const allVerbs = new Map(); // name -> raw
  for (const verbs of Object.values(_shellVerbCache)) {
    verbs.forEach(v => { if (!allVerbs.has(v.name)) allVerbs.set(v.name, v.raw); });
  }
  const probePath = (typeof _folderPath !== 'undefined' && _folderPath)
    || (typeof _homeFolderPath !== 'undefined' && _homeFolderPath)
    || (typeof state !== 'undefined' && state?.vaultPath)
    || '';
  if (allVerbs.size === 0 && probePath) {
    const verbs = await fetchShellVerbs(probePath);
    verbs.forEach(v => { if (!allVerbs.has(v.name)) allVerbs.set(v.name, v.raw); });
  }
  if (allVerbs.size === 0) {
    showStatus('まだシェルメニュー項目が読み込まれていません。ファイルメニューを開いてから再度お試しください。');
    return;
  }

  const hidden = getHiddenShellVerbs();
  const desc = document.createElement('div');
  desc.className = 'gb-section-desc shell-verb-settings-desc';
  desc.textContent = '表示する項目と、OSメニューの外側（トップ）にも表示する項目を選べます。Dropbox・圧縮・解凍は初期状態でトップに表示されます。';

  const groupTitle = document.createElement('div');
  groupTitle.className = 'shell-verb-settings-group-title';
  groupTitle.textContent = 'OS メニュー項目';

  const list = document.createElement('div');
  list.className = 'shell-verb-settings-list';
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', 'OS メニュー項目');
  const configuredPinned = getPinnedShellVerbs();
  let verbIndex = 0;
  for (const [name, raw] of allVerbs) {
    const stableVerbId = String(++verbIndex);
    const row = document.createElement('div');
    row.className = 'shell-verb-settings-row';
    row.style.flexWrap = 'nowrap';
    row.style.boxSizing = 'border-box';
    if (compactDialog) {
      row.style.flexDirection = 'column';
      row.style.alignItems = 'stretch';
      row.style.paddingBlock = '8px';
    }
    const label = document.createElement('label');
    label.className = 'shell-verb-settings-visibility';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !hidden.includes(name);
    input.dataset.verbName = name;
    input.dataset.e2eId = 'shell-verb-settings-check-' + stableVerbId;
    input.setAttribute('aria-label', `${name}を表示`);
    const text = document.createElement('span');
    text.textContent = name;
    label.append(input, text);
    const pinLabel = document.createElement('label');
    pinLabel.className = 'shell-verb-settings-pin';
    const pinInput = document.createElement('input');
    pinInput.type = 'checkbox';
    pinInput.checked = configuredPinned == null
      ? _isDefaultPinnedShellVerb({ name, raw })
      : configuredPinned.includes(name);
    pinInput.disabled = !input.checked;
    pinInput.dataset.pinnedVerbName = name;
    pinInput.dataset.e2eId = 'shell-verb-settings-pin-' + stableVerbId;
    pinInput.setAttribute('aria-label', `${name}をトップにも表示`);
    pinLabel.append(pinInput, document.createTextNode('トップにも表示'));
    if (compactDialog) {
      label.style.width = '100%';
      pinLabel.style.width = '100%';
    }
    input.addEventListener('change', () => {
      pinInput.disabled = !input.checked;
      if (!input.checked) pinInput.checked = false;
    });
    row.append(label, pinLabel);
    list.appendChild(row);
  }
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.style.minWidth = '72px';
  closeButton.style.whiteSpace = 'nowrap';
  closeButton.style.flex = '0 0 72px';
  closeButton.dataset.e2eId = 'shell-verb-settings-close';
  closeButton.textContent = '閉じる';
  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.style.minWidth = '72px';
  saveButton.style.whiteSpace = 'nowrap';
  saveButton.style.flex = '0 0 72px';
  saveButton.className = 'primary';
  saveButton.id = 'btn-save-verb-settings';
  saveButton.dataset.e2eId = 'shell-verb-settings-save';
  saveButton.textContent = '保存';
  const status = document.createElement('div');
  status.className = 'gb-validation-message';
  status.dataset.e2eId = 'shell-verb-settings-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let saving = false;
  const dialog = window.GBUI.createModal({
    id: 'shell-verb-settings',
    title: '右クリックメニューのカスタマイズ',
    titleId: 'shell-verb-settings-title',
    body: [desc, groupTitle, list, status],
    footer: [closeButton, saveButton],
    variant: 'standard',
    extraClass: 'shell-verb-settings-modal',
    geometryKey: 'shell-verb-settings',
    minWidth: '0',
    initialFocus: list.querySelector('input:not([disabled])') || closeButton,
    returnFocus: opener,
    onBeforeClose: () => !saving,
  });
  const o = dialog.overlay;
  const modal = dialog.modal;
  o.classList.add('modal-overlay', 'shell-verb-settings-overlay');
  o.dataset.shellVerbSettings = '1';
  o.dataset.e2eId = 'shell-verb-settings-overlay';
  modal.classList.add('modal');
  modal.dataset.e2eId = 'shell-verb-settings-dialog';
  modal.style.width = 'min(520px, calc(100vw - 32px))';
  modal.style.maxHeight = 'min(70vh, calc(100dvh - 24px))';
  modal.style.boxSizing = 'border-box';
  dialog.body.style.minWidth = '0';
  dialog.body.style.maxWidth = '100%';
  dialog.body.style.boxSizing = 'border-box';
  dialog.body.style.overflowX = 'hidden';
  dialog.footer.classList.add('btn-row', 'shell-verb-settings-actions');
  dialog.footer.style.minWidth = '0';
  dialog.footer.style.boxSizing = 'border-box';
  dialog.footer.style.flexWrap = 'nowrap';
  list.style.width = '100%';
  list.style.minWidth = '0';
  list.style.boxSizing = 'border-box';
  if (compactDialog) {
    closeButton.style.minHeight = '44px';
    saveButton.style.minHeight = '44px';
  }
  const commonClose = dialog.header.querySelector('.gb-modal-close');
  if (commonClose) commonClose.dataset.e2eId = 'shell-verb-settings-close-icon';
  closeButton.addEventListener('click', () => dialog.close('cancel'));
  // 既存のタッチE2Eと実機のpointerdown外側タップを、共通controllerへ集約する。
  o.addEventListener('pointerdown', event => {
    if (event.target === o) dialog.close('overlay');
  });

  saveButton.addEventListener('click', () => {
    if (saving) return;
    saving = true;
    status.hidden = true;
    status.textContent = '';
    o.setAttribute('aria-busy', 'true');
    saveButton.disabled = true;
    closeButton.disabled = true;
    if (commonClose) commonClose.disabled = true;
    const displayedNames = new Set(allVerbs.keys());
    const newHidden = hidden.filter(name => !displayedNames.has(name));
    o.querySelectorAll('input[data-verb-name]').forEach(cb => {
      if (!cb.checked) newHidden.push(cb.dataset.verbName);
    });
    const pinned = [...o.querySelectorAll('input[data-pinned-verb-name]:checked:not(:disabled)')]
      .map(cb => cb.dataset.pinnedVerbName);
    let saved = false;
    try {
      saveShellVerbPreferences([...new Set(newHidden)], [...new Set(pinned)]);
      saved = true;
    } catch (error) {
      status.textContent = '設定を保存できませんでした。もう一度お試しください。';
      status.hidden = false;
      console.warn('シェルメニュー設定を保存できませんでした:', error);
    } finally {
      saving = false;
      o.setAttribute('aria-busy', 'false');
      saveButton.disabled = false;
      closeButton.disabled = false;
      if (commonClose) commonClose.disabled = false;
    }
    if (saved) {
      dialog.close('complete');
      showStatus('メニュー設定を保存しました');
    } else {
      saveButton.focus({ preventScroll: true });
    }
  });
  dialog.open();
}

if (typeof window !== 'undefined') {
  window.__MeldexShellMenuInternals = {
    setVerbCacheForTest(path, verbs) {
      _shellVerbCache[_shellVerbCacheKey(path)] = Array.isArray(verbs) ? verbs : [];
    },
    clearVerbCacheForTest(path) {
      if (path == null) {
        Object.keys(_shellVerbCache).forEach(key => delete _shellVerbCache[key]);
        return;
      }
      delete _shellVerbCache[_shellVerbCacheKey(path)];
    },
    getHiddenShellVerbs,
    setHiddenShellVerbs,
    getPinnedShellVerbs,
    setPinnedShellVerbs,
    saveShellVerbPreferences,
    isPinnedShellVerb,
  };
}
