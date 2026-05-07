/**
 * Meldex Shell Menu Integration
 * OSシェル動詞の取得・キャッシュ・実行・カスタマイズ
 */

const _shellVerbCache = {}; // extension -> [{name, raw}]
const _HIDDEN_VERBS_KEY = 'gb:hidden-shell-verbs';

// --- データ取得 ---

async function fetchShellVerbs(path) {
  // 拡張子ベースのキャッシュ（サーバーも同様にキャッシュ）
  // パスの末尾からファイル名を取得し、最後の . 以降を拡張子とする
  const name = path.replace(/[\\/]/g, '/').split('/').pop() || '';
  const dotIdx = name.lastIndexOf('.');
  const ext = (dotIdx > 0) ? name.substring(dotIdx).toLowerCase() : ('__noext__:' + path);
  if (_shellVerbCache[ext]) return _shellVerbCache[ext];
  try {
    const verbs = await apiFetch('/shell-verbs?path=' + encodeURIComponent(path));
    if (verbs.length > 0) _shellVerbCache[ext] = verbs;
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

async function appendShellVerbsToMenu(menu, path) {
  if (!path) return;

  // プレースホルダー表示
  const placeholder = document.createElement('div');
  placeholder.style.cssText = 'padding:4px 12px;color:var(--fg2);font-size:11px;font-style:italic;';
  placeholder.textContent = 'OS メニュー 読み込み中...';

  const sep = document.createElement('div');
  sep.className = 'cm-sep';
  menu.appendChild(sep);
  menu.appendChild(placeholder);

  const verbs = await fetchShellVerbs(path);
  // メニューがまだDOMにあるか確認
  if (!document.body.contains(menu)) return;

  placeholder.remove();
  if (verbs.length === 0) {
    sep.remove();
    return;
  }

  const hidden = getHiddenShellVerbs();
  const visibleVerbs = verbs.filter(v => !hidden.includes(v.name));

  // サブメニューとして表示
  const shellWrap = document.createElement('div');
  shellWrap.style.position = 'relative';
  const shellTrigger = document.createElement('div');
  shellTrigger.className = 'tree-ctx-item';
  shellTrigger.innerHTML = '<span style="margin-right:6px;opacity:0.7;">' + lucide('monitor', 14) + '</span>OS メニュー' + submenuArrow();
  shellTrigger.style.cssText = 'padding:4px 12px;cursor:pointer;';
  const shellPanel = document.createElement('div');
  shellPanel.className = 'gb-context-menu';
  shellPanel.style.cssText = 'display:none;min-width:160px;';
  attachHoverSubmenu(shellTrigger, shellPanel);

  if (visibleVerbs.length === 0) {
    const emptyItem = document.createElement('div');
    emptyItem.textContent = 'すべて非表示です';
    emptyItem.style.cssText = 'padding:4px 12px;font-size:12px;color:var(--fg2);white-space:nowrap;';
    shellPanel.appendChild(emptyItem);
  }

  visibleVerbs.forEach(v => {
    const item = document.createElement('div');
    item.textContent = v.name;
    item.style.cssText = 'padding:4px 12px;cursor:pointer;font-size:13px;white-space:nowrap;';
    item.addEventListener('mouseenter', () => { item.style.background = 'var(--bg4)'; });
    item.addEventListener('mouseleave', () => { item.style.background = ''; });
    item.addEventListener('click', () => {
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
    shellPanel.appendChild(item);
  });

  // カスタマイズボタン
  const custSep = document.createElement('div');
  custSep.className = 'cm-sep';
  shellPanel.appendChild(custSep);
  const custItem = document.createElement('div');
  custItem.textContent = 'メニューのカスタマイズ...';
  custItem.style.cssText = 'padding:4px 12px;cursor:pointer;font-size:12px;color:var(--fg2);white-space:nowrap;';
  custItem.addEventListener('mouseenter', () => { custItem.style.background = 'var(--bg4)'; });
  custItem.addEventListener('mouseleave', () => { custItem.style.background = ''; });
  custItem.addEventListener('click', () => {
    closeTreeContextMenu();
    showShellVerbSettings();
  });
  shellPanel.appendChild(custItem);

  shellWrap.appendChild(shellTrigger);
  shellWrap.appendChild(shellPanel);
  menu.appendChild(shellWrap);

  // メニュー位置再調整
  const rect = menu.getBoundingClientRect();
  { const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1);
  if (rect.bottom > window.innerHeight) menu.style.top = Math.max(4, (window.innerHeight - rect.height - 4) / z) + 'px';
  if (rect.right > window.innerWidth) menu.style.left = Math.max(4, (window.innerWidth - rect.width - 4) / z) + 'px'; }
}

// --- 右クリックで非表示 ---

function _showHideVerbPopup(x, y, verbName, parentMenu, path) {
  document.querySelectorAll('.shell-verb-popup').forEach(el => el.remove());
  const popup = document.createElement('div');
  popup.className = 'gb-context-menu shell-verb-popup';
  popup.style.cssText = 'z-index:100001;';
  const item = document.createElement('div');
  item.textContent = `「${verbName}」を非表示にする`;
  item.style.cssText = 'padding:4px 12px;cursor:pointer;font-size:12px;white-space:nowrap;';
  item.addEventListener('mouseenter', () => { item.style.background = 'var(--bg4)'; });
  item.addEventListener('mouseleave', () => { item.style.background = ''; });
  item.addEventListener('click', () => {
    toggleHiddenShellVerb(verbName);
    popup.remove();
    closeTreeContextMenu();
    showStatus(`「${verbName}」を非表示にしました。カスタマイズから復元できます。`);
  });
  popup.appendChild(item);
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
    document.addEventListener('pointerdown', function closer(e) {
      if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('pointerdown', closer); }
    });
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
    showStatus('まだシェルメニュー項目が読み込まれていません。ファイルを右クリックしてから再度お試しください。');
    return;
  }

  const hidden = getHiddenShellVerbs();
  const o = document.createElement('div');
  o.className = 'modal-overlay';
  let html = '<div class="modal" style="min-width:360px;max-height:70vh;overflow-y:auto;">';
  html += '<h3>右クリックメニューのカスタマイズ</h3>';
  html += '<div style="font-size:12px;color:var(--fg2);margin-bottom:12px;">チェックを外すとメニューから非表示になります。</div>';
  html += '<div style="font-size:12px;font-weight:bold;color:var(--fg);margin-bottom:8px;">OS メニュー項目</div>';
  for (const [name] of allVerbs) {
    const checked = !hidden.includes(name) ? 'checked' : '';
    html += `<label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;font-size:13px;">
      <input type="checkbox" ${checked} data-verb-name="${esc(name)}">
      <span>${esc(name)}</span>
    </label>`;
  }
  html += '<div class="btn-row" style="margin-top:16px;">';
  html += '<button data-action="this.closest(\'.modal-overlay\').remove()">閉じる</button>';
  html += '<button class="primary" id="btn-save-verb-settings">保存</button>';
  html += '</div></div>';
  o.innerHTML = html;
  document.body.appendChild(o);

  document.getElementById('btn-save-verb-settings').addEventListener('click', () => {
    const newHidden = [];
    o.querySelectorAll('input[data-verb-name]').forEach(cb => {
      if (!cb.checked) newHidden.push(cb.dataset.verbName);
    });
    setHiddenShellVerbs(newHidden);
    o.remove();
    showStatus('メニュー設定を保存しました');
  });
}
