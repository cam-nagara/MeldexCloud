/**
 * Meldex Shell Menu Integration
 * OSシェル動詞の取得・キャッシュ・実行・カスタマイズ
 */

const _shellVerbCache = {}; // path key -> [{name, raw}]
const _HIDDEN_VERBS_KEY = 'gb:hidden-shell-verbs';

function _shellVerbCacheKey(path) {
  return String(path || '').replace(/[\\/]+/g, '/').toLowerCase();
}

function _shellMenuEscHtml(value) {
  if (typeof esc === 'function') return esc(value);
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
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

function _shellMenuAppendSubmenu(menu, label, icon, panel) {
  const trigger = _shellMenuAppendItem(menu, label, null, { icon, hasSubmenu: true, className: 'tree-ctx-item' });
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

  // サブメニューとして表示
  const shellPanel = _shellMenuCreatePanel('OS メニュー');
  _shellMenuAppendSubmenu(menu, 'OS メニュー', 'monitor', shellPanel);

  if (visibleVerbs.length === 0) {
    _shellMenuAppendItem(
      shellPanel,
      editingLocked ? '編集ロック中のため編集系操作は非表示です' : 'すべて非表示です',
      null,
      { disabled: true },
    );
  }

  visibleVerbs.forEach(v => {
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

function showShellVerbSettings() {
  // 全キャッシュから動詞を集約
  const allVerbs = new Map(); // name -> raw
  for (const verbs of Object.values(_shellVerbCache)) {
    verbs.forEach(v => { if (!allVerbs.has(v.name)) allVerbs.set(v.name, v.raw); });
  }
  if (allVerbs.size === 0) {
    showStatus('まだシェルメニュー項目が読み込まれていません。ファイルメニューを開いてから再度お試しください。');
    return;
  }

  const hidden = getHiddenShellVerbs();
  const o = document.createElement('div');
  o.className = 'modal-overlay shell-verb-settings-overlay';
  o.dataset.shellVerbSettings = '1';
  o.dataset.e2eId = 'shell-verb-settings-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal shell-verb-settings-modal';
  modal.dataset.e2eId = 'shell-verb-settings-dialog';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'shell-verb-settings-title');
  modal.style.minWidth = '360px';
  modal.style.width = 'min(520px, calc(100vw - 32px))';
  modal.style.maxHeight = 'min(70vh, calc(100dvh - 24px))';

  const title = document.createElement('h3');
  title.id = 'shell-verb-settings-title';
  title.textContent = '右クリックメニューのカスタマイズ';

  const desc = document.createElement('div');
  desc.className = 'gb-section-desc shell-verb-settings-desc';
  desc.textContent = 'チェックを外すとメニューから非表示になります。';

  const groupTitle = document.createElement('div');
  groupTitle.className = 'shell-verb-settings-group-title';
  groupTitle.textContent = 'OS メニュー項目';

  const list = document.createElement('div');
  list.className = 'shell-verb-settings-list';
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', 'OS メニュー項目');
  for (const [name] of allVerbs) {
    const label = document.createElement('label');
    label.className = 'shell-verb-settings-row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !hidden.includes(name);
    input.dataset.verbName = name;
    input.dataset.e2eId = 'shell-verb-settings-check-' + String(name).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    input.setAttribute('aria-label', `${name}を表示`);
    const text = document.createElement('span');
    text.textContent = name;
    label.append(input, text);
    list.appendChild(label);
  }
  const footer = document.createElement('div');
  footer.className = 'btn-row shell-verb-settings-actions';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.dataset.e2eId = 'shell-verb-settings-close';
  closeButton.textContent = '閉じる';
  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'primary';
  saveButton.id = 'btn-save-verb-settings';
  saveButton.dataset.e2eId = 'shell-verb-settings-save';
  saveButton.textContent = '保存';
  footer.append(closeButton, saveButton);
  modal.append(title, desc, groupTitle, list, footer);
  o.appendChild(modal);
  document.body.appendChild(o);

  const close = () => {
    document.removeEventListener('keydown', keyCloser, true);
    o.remove();
  };
  const keyCloser = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    close();
  };
  o.addEventListener('pointerdown', (event) => {
    if (event.target === o) close();
  });
  closeButton.addEventListener('click', close);
  document.addEventListener('keydown', keyCloser, true);

  saveButton.addEventListener('click', () => {
    const displayedNames = new Set(allVerbs.keys());
    const newHidden = hidden.filter(name => !displayedNames.has(name));
    o.querySelectorAll('input[data-verb-name]').forEach(cb => {
      if (!cb.checked) newHidden.push(cb.dataset.verbName);
    });
    setHiddenShellVerbs([...new Set(newHidden)]);
    close();
    showStatus('メニュー設定を保存しました');
  });
  if (typeof window !== 'undefined' && window.GBModalShell?.enhanceOverlay) {
    window.GBModalShell.enhanceOverlay(o);
  }
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
  };
}
