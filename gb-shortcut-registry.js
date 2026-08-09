/* gb-shortcut-registry.js
 * ショートカットキーの一覧・カスタム設定・設定UIを、キーの配送（中央ハンドラ）から
 * 切り離して全アプリで共有するためのモジュール。
 *
 * - Meldex本体・ノート・シナリオ・シート・ボードは gb-shortcuts.js が全体の一覧を
 *   ここへ登録し、配送も gb-shortcuts.js 側で行う。
 * - ビューワー・クイックメモのように自前でキーを処理するアプリは、gb-shortcuts.js を
 *   読み込まずに registerLocal() で自分のキーだけ登録し、matchEvent() で判定に使う。
 *   これで「どのアプリでもオプションパネルからショートカットを確認・変更できる」状態に
 *   しつつ、そのアプリに存在しない操作を一覧へ出さずに済む。
 *
 * カスタム値は localStorage の 'meldex-custom-shortcuts' に保存する（キーの上書きのみ）。
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'meldex-custom-shortcuts';
  const MODIFIER_KEYS = new Set(['control', 'shift', 'alt', 'meta']);
  // Shift+数字キーの記号→数字マッピング（US配列基準）
  const SHIFT_DIGIT_MAP = { '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0' };

  const SCOPE_ORDER = ['global', 'note', 'scenario', 'database', 'board', 'calendar', 'csv', 'folder', 'viewer', 'quickmemo', 'timer', 'panelset'];
  const SCOPE_LABELS = {
    global: '全体',
    note: 'ノート',
    scenario: 'シナリオ',
    database: 'シート',
    board: 'ボード',
    calendar: 'スケジュール',
    csv: 'CSV',
    folder: 'フォルダ',
    viewer: 'ビューワー',
    quickmemo: 'クイックメモ',
    timer: 'タイマー',
    panelset: 'パネルセット',
  };

  // メインパネルで開いているアプリの種類 → ショートカットのスコープ。
  // オプションパネルのショートカットタブは、既定でこのスコープだけに絞って表示する。
  const TYPE_TO_SCOPE = {
    page: 'note',
    entity: 'note',
    note: 'note',
    db: 'database',
    database: 'database',
    pivot: 'database',
    tree: 'database',
    gallery: 'database',
    kanban: 'database',
    timeline: 'database',
    chart: 'database',
    graph: 'database',
    'smart-db': 'database',
    scriptnote: 'scenario',
    scenario: 'scenario',
    board: 'board',
    canvas: 'board',
    calendar: 'calendar',
    csv: 'csv',
    folder: 'folder',
    outliner: 'folder',
    preview: 'viewer',
    media: 'viewer',
    viewer: 'viewer',
    'quick-memo': 'quickmemo',
    quickmemo: 'quickmemo',
    timer: 'timer',
  };

  const definitions = {};

  function _esc(value) {
    if (typeof global.esc === 'function') return global.esc(String(value == null ? '' : value));
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function register(defs, options) {
    if (!defs || typeof defs !== 'object') return;
    const local = options?.local === true;
    for (const [id, def] of Object.entries(defs)) {
      if (!def || typeof def !== 'object') continue;
      definitions[id] = {
        key: String(def.key || ''),
        label: String(def.label || id),
        scope: String(def.scope || 'global'),
        local,
      };
    }
  }

  function registerLocal(defs) {
    register(defs, { local: true });
  }

  function defaults() {
    return JSON.parse(JSON.stringify(definitions));
  }

  function getCustom() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
  }

  // 設定変更後に、開いている全部のショートカット一覧（設定ダイアログ／オプションパネル）を描き直す
  function _refreshOpenSettings() {
    if (typeof global._updateAllTooltips === 'function') global._updateAllTooltips();
    if (typeof global.updateScriptnoteShortcutStatusbar === 'function') global.updateScriptnoteShortcutStatusbar();
    document.querySelectorAll('[data-shortcut-settings-host]').forEach(host => {
      renderSettings(host, { scope: host.dataset.shortcutSettingsScope || '', boxed: host.dataset.shortcutSettingsBoxed === '1' });
    });
  }

  function saveCustom(custom, options) {
    const before = (typeof global.captureLocalStorageSettings === 'function')
      ? global.captureLocalStorageSettings([STORAGE_KEY])
      : null;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(custom)); } catch { /* 保存できない環境では変更を持ち越さない */ }
    if (typeof global.updateScriptnoteShortcutStatusbar === 'function') global.updateScriptnoteShortcutStatusbar();
    if (typeof global.updateDatabaseShortcutStatusbar === 'function') global.updateDatabaseShortcutStatusbar();
    if (typeof global.updateCsvShortcutStatusbar === 'function') global.updateCsvShortcutStatusbar();
    if (before && options?.skipHistory !== true && typeof global.pushLocalStorageSettingsHistory === 'function') {
      global.pushLocalStorageSettingsHistory(
        options?.label || '設定: ショートカット変更',
        before,
        global.captureLocalStorageSettings([STORAGE_KEY]),
        options?.detail || '',
        _refreshOpenSettings
      );
    }
  }

  function effective() {
    const custom = getCustom();
    const result = defaults();
    for (const [id, overrides] of Object.entries(custom)) {
      if (result[id]) result[id].key = overrides.key;
    }
    return result;
  }

  function keyFor(id) {
    const custom = getCustom();
    if (custom[id]) return custom[id].key;
    return definitions[id]?.key || '';
  }

  // === キー判定 ===

  function normalizeKeyEvent(e) {
    const rawKey = typeof e?.key === 'string' ? e.key : '';
    if (!rawKey) return null;
    const key = rawKey.toLowerCase();
    if (MODIFIER_KEYS.has(key)) return null;
    const mods = [];
    if (e.altKey) mods.push('alt');
    if (e.ctrlKey || e.metaKey) mods.push('ctrl');
    if (e.shiftKey) mods.push('shift');
    let mainKey = key;
    if (mainKey === ' ') mainKey = 'space';
    if (mainKey === '+') {
      mainKey = '=';
      const shiftIdx = mods.indexOf('shift');
      if (shiftIdx >= 0) mods.splice(shiftIdx, 1);
    }
    if (e.shiftKey && e.code === 'Backquote') mainKey = '`';
    // Shift+数字キー: e.keyは記号になるが、e.codeから元の数字を復元
    if (e.shiftKey && e.code && e.code.startsWith('Digit')) mainKey = e.code.charAt(5);
    // Shift+記号キーのフォールバック（e.codeが使えない場合）
    if (e.shiftKey && SHIFT_DIGIT_MAP[mainKey]) mainKey = SHIFT_DIGIT_MAP[mainKey];
    return [...mods, mainKey].join('+');
  }

  function normalizeKeyDef(keyDef) {
    const parts = String(keyDef || '').toLowerCase().replace(/\s/g, '').split('+');
    const mods = [];
    let mainKey = '';
    for (const part of parts) {
      if (['ctrl', 'shift', 'alt', 'meta'].includes(part)) mods.push(part);
      else mainKey = part;
    }
    mods.sort();
    return [...mods, mainKey].join('+');
  }

  // 表示用: "ctrl+shift+a" → "Ctrl+Shift+A"
  function formatKey(keyStr) {
    if (!keyStr) return '';
    return String(keyStr).split('+').map(part => {
      if (part === 'ctrl') return 'Ctrl';
      if (part === 'shift') return 'Shift';
      if (part === 'alt') return 'Alt';
      if (part === 'meta') return 'Meta';
      if (part === 'arrowup') return '↑';
      if (part === 'arrowdown') return '↓';
      if (part === 'arrowleft') return '←';
      if (part === 'arrowright') return '→';
      if (part === 'browserback') return '戻るボタン';
      if (part === 'browserforward') return '進むボタン';
      if (part === 'escape') return 'Esc';
      if (part === 'enter') return 'Enter';
      if (part === 'delete') return 'Del';
      if (part === 'backspace') return 'BS';
      if (part === 'tab') return 'Tab';
      if (part === 'space') return 'Space';
      if (part.length === 1) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    }).join('+');
  }

  function keyDisplay(keyStr) {
    return keyStr ? formatKey(keyStr) : '未設定';
  }

  // 押されたキーに対応するショートカットIDを返す（自前でキーを処理するアプリ用）。
  // scopes を渡すとその範囲だけを見る。
  function matchEvent(e, scopes) {
    const pressed = normalizeKeyEvent(e);
    if (!pressed) return '';
    const allowed = Array.isArray(scopes) && scopes.length ? scopes : null;
    const shortcuts = effective();
    for (const [id, def] of Object.entries(shortcuts)) {
      if (!def.key) continue;
      if (allowed && !allowed.includes(def.scope)) continue;
      if (normalizeKeyDef(def.key) === pressed) return id;
    }
    return '';
  }

  function conflict(selfId, newKey) {
    const shortcuts = effective();
    const selfScope = shortcuts[selfId]?.scope;
    for (const [id, def] of Object.entries(shortcuts)) {
      if (id === selfId || !def.key) continue;
      if (normalizeKeyDef(def.key) !== newKey) continue;
      if (def.scope === selfScope || def.scope === 'global' || selfScope === 'global') return def;
    }
    return null;
  }

  function scopeLabel(scope) {
    return SCOPE_LABELS[scope] || scope;
  }

  function scopeForType(type) {
    return TYPE_TO_SCOPE[String(type || '').toLowerCase()] || '';
  }

  // === 設定UI ===
  // 4階層規則（.gb-section → .gb-section-title → .gb-field-row → .gb-field-inline）に従う。
  // 設定ダイアログでは枠付き（boxed）、オプションパネルでは枠なしで使う。

  function _displayScope(id, def) {
    if (id.startsWith('panelset.')) return 'panelset';
    return def.scope || 'global';
  }

  function _groups(shortcuts, custom) {
    const grouped = Object.fromEntries(SCOPE_ORDER.map(scope => [scope, []]));
    for (const [id, def] of Object.entries(shortcuts)) {
      const displayScope = _displayScope(id, def);
      if (!grouped[displayScope]) grouped[displayScope] = [];
      grouped[displayScope].push({ id, displayScope, ...def, isCustom: !!custom[id] });
    }
    return grouped;
  }

  function applyFilter(container) {
    const query = (container.querySelector('[data-shortcut-search]')?.value || '').trim().toLowerCase();
    const selectedScope = container.querySelector('[data-shortcut-scope-filter]')?.value || 'all';
    container.querySelectorAll('.shortcut-row').forEach(row => {
      const matchesScope = selectedScope === 'all' || row.dataset.scope === selectedScope;
      const matchesSearch = !query || (row.dataset.search || '').includes(query);
      row.hidden = !(matchesScope && matchesSearch);
    });
    container.querySelectorAll('.shortcut-group').forEach(group => {
      const visibleCount = Array.from(group.querySelectorAll('.shortcut-row')).filter(row => !row.hidden).length;
      group.hidden = visibleCount === 0;
      const count = group.querySelector('.shortcut-group-count');
      if (count) count.textContent = visibleCount + '件';
    });
    const empty = container.querySelector('[data-shortcut-empty]');
    if (empty) empty.hidden = !!container.querySelector('.shortcut-group:not([hidden])');
  }

  function _scopeOptionsHtml(scopeOptions, previousScope) {
    let html = '<option value="all"' + (previousScope === 'all' ? ' selected' : '') + '>すべて</option>';
    for (const [scope, items] of scopeOptions) {
      html += '<option value="' + _esc(scope) + '"' + (previousScope === scope ? ' selected' : '') + '>'
        + _esc(scopeLabel(scope)) + ' (' + items.length + ')</option>';
    }
    return html;
  }

  function _rowHtml(item) {
    const status = item.isCustom ? 'カスタム' : '既定';
    const label = scopeLabel(item.displayScope);
    const searchText = [item.label, item.id, item.key, label].join(' ').toLowerCase();
    let html = '<div class="shortcut-row gb-field-row" data-id="' + _esc(item.id) + '" data-scope="' + _esc(item.displayScope)
      + '" data-search="' + _esc(searchText) + '">';
    html += '<span class="shortcut-label gb-label" title="' + _esc(item.id) + '">' + _esc(item.label) + '</span>';
    html += '<span class="shortcut-status' + (item.isCustom ? ' is-custom' : '') + '">' + status + '</span>';
    html += '<kbd class="shortcut-key' + (item.isCustom ? ' is-custom' : '') + '" data-id="' + _esc(item.id)
      + '" data-e2e-id="shortcut-key-' + _esc(item.id)
      + '" tabindex="0" role="button" title="クリックして変更" aria-label="' + _esc(item.label) + 'のキーを変更">'
      + _esc(keyDisplay(item.key)) + '</kbd>';
    if (item.isCustom) {
      html += '<button type="button" class="shortcut-reset gb-btn gb-btn-xs gb-btn-quiet" data-id="' + _esc(item.id)
        + '" data-e2e-id="shortcut-reset-' + _esc(item.id) + '" title="デフォルトに戻す" aria-label="'
        + _esc(item.label) + 'をデフォルトに戻す">✕</button>';
    } else {
      html += '<span class="shortcut-reset-spacer"></span>';
    }
    return html + '</div>';
  }

  function _groupHtml(scope, items) {
    let html = '<div class="shortcut-group" data-scope="' + _esc(scope) + '">';
    html += '<div class="shortcut-group-head">';
    html += '<span>' + _esc(scopeLabel(scope)) + '</span>';
    html += '<span class="shortcut-group-count gb-section-desc">' + items.length + '件</span>';
    html += '</div>';
    html += items.map(_rowHtml).join('');
    return html + '</div>';
  }

  function _startKeyCapture(kbd, container) {
    const original = kbd.textContent;
    kbd.textContent = 'キーを入力...';
    kbd.classList.add('is-capturing');
    const finish = (text) => {
      kbd.textContent = text;
      kbd.classList.remove('is-capturing');
    };
    const handler = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        document.removeEventListener('keydown', handler, true);
        finish(keyDisplay(effective()[kbd.dataset.id]?.key || '') || original);
        return;
      }
      const newKey = normalizeKeyEvent(event);
      if (!newKey) return; // 修飾キー単体は無視（入力継続）
      const id = kbd.dataset.id;
      const hit = conflict(id, newKey);
      if (hit) {
        document.removeEventListener('keydown', handler, true);
        kbd.textContent = '競合: ' + hit.label;
        setTimeout(() => finish(keyDisplay(effective()[id]?.key || '')), 1500);
        return;
      }
      const custom = getCustom();
      // デフォルトと同じなら削除（カスタム扱いにしない）
      if (normalizeKeyDef(definitions[id]?.key || '') === newKey) delete custom[id];
      else custom[id] = { key: newKey };
      saveCustom(custom);
      document.removeEventListener('keydown', handler, true);
      renderSettings(container, container._shortcutSettingsOptions || {});
      if (typeof global._updateAllTooltips === 'function') global._updateAllTooltips();
    };
    document.addEventListener('keydown', handler, true);
  }

  // container に一覧を描画する。
  // options.scope: 初期の絞り込みスコープ（'' なら すべて）
  // options.boxed: 設定ダイアログ用の枠付き表示にするか
  function renderSettings(container, options) {
    if (!container) return;
    const opts = options || {};
    container._shortcutSettingsOptions = opts;
    container.dataset.shortcutSettingsHost = '1';
    container.dataset.shortcutSettingsScope = opts.scope || '';
    container.dataset.shortcutSettingsBoxed = opts.boxed ? '1' : '0';

    const shortcuts = effective();
    const custom = getCustom();
    const grouped = _groups(shortcuts, custom);
    const scopeOptions = Object.entries(grouped).filter(([, items]) => items.length);
    const previousSearch = container.querySelector('[data-shortcut-search]')?.value || '';
    // 既定は「いま開いているアプリの分だけ」。ただしユーザーが絞り込みを自分で
    // 変えた後は、アプリを切り替えてもその選択を尊重する。
    const autoScope = (opts.scope && grouped[opts.scope]?.length) ? opts.scope : 'all';
    const previousScope = container.dataset.shortcutScopeUserChoice === '1'
      ? (container.querySelector('[data-shortcut-scope-filter]')?.value || autoScope)
      : autoScope;

    let html = '<section class="gb-section shortcut-settings-wrap'
      + (opts.boxed ? ' gb-section--boxed' : ' gb-section--detail') + '">';
    html += '<div class="gb-section-title">ショートカットキー</div>';
    html += '<div class="gb-field-row shortcut-settings-filter">';
    html += '<input class="gb-input" type="text" placeholder="検索" data-shortcut-search'
      + (opts.boxed ? ' id="shortcut-search"' : '') + ' value="' + _esc(previousSearch) + '">';
    html += '<select class="gb-select" data-shortcut-scope-filter' + (opts.boxed ? ' id="shortcut-scope-filter"' : '') + '>';
    html += _scopeOptionsHtml(scopeOptions, previousScope);
    html += '</select>';
    html += '<button type="button" class="gb-btn gb-btn-sm" data-shortcut-reset-all'
      + (opts.boxed ? ' id="shortcut-reset-all"' : '') + '>すべてリセット</button>';
    html += '</div>';
    html += scopeOptions.map(([scope, items]) => _groupHtml(scope, items)).join('');
    html += '<div class="gb-section-desc" data-shortcut-empty' + (opts.boxed ? ' id="shortcut-empty"' : '')
      + ' hidden>該当するショートカットがありません</div>';
    html += '</section>';
    container.innerHTML = html;

    container.querySelectorAll('.shortcut-key').forEach(kbd => {
      kbd.addEventListener('click', () => _startKeyCapture(kbd, container));
      kbd.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        _startKeyCapture(kbd, container);
      });
    });

    container.querySelectorAll('.shortcut-reset').forEach(button => {
      button.addEventListener('click', () => {
        const next = getCustom();
        delete next[button.dataset.id];
        saveCustom(next);
        renderSettings(container, opts);
        if (typeof global._updateAllTooltips === 'function') global._updateAllTooltips();
      });
    });

    container.querySelector('[data-shortcut-reset-all]')?.addEventListener('click', async () => {
      const confirmFn = typeof global.cfConfirm === 'function' ? global.cfConfirm : null;
      if (confirmFn && !await confirmFn('すべてのショートカットをデフォルトに戻しますか？')) return;
      saveCustom({});
      renderSettings(container, opts);
      if (typeof global._updateAllTooltips === 'function') global._updateAllTooltips();
    });

    container.querySelector('[data-shortcut-search]')?.addEventListener('input', () => applyFilter(container));
    container.querySelector('[data-shortcut-scope-filter]')?.addEventListener('change', () => {
      container.dataset.shortcutScopeUserChoice = '1';
      applyFilter(container);
    });
    applyFilter(container);
  }

  global.MeldexShortcutRegistry = Object.freeze({
    register,
    registerLocal,
    defaults,
    effective,
    getCustom,
    saveCustom,
    keyFor,
    normalizeKeyEvent,
    normalizeKeyDef,
    formatKey,
    keyDisplay,
    matchEvent,
    conflict,
    scopeLabel,
    scopeForType,
    renderSettings,
    applyFilter,
    SCOPE_LABELS,
    SCOPE_ORDER,
  });
})(typeof window !== 'undefined' ? window : globalThis);
