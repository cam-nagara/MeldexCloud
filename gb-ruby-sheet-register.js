/* gb-ruby-sheet-register.js
 * ルビ設定ポップアップ（ノート / シナリオ共通）の「シートに登録」。
 *
 * 選択中の文字列をトピック名、入力済みのルビを「ふりがな」列の値として、
 * ふりがな列を持つシートへ登録する。登録先は
 *   前回使ったシート → 作品フォルダ → ソースフォルダ → ホーム → ワークスペース
 * の順に候補を並べ、無い時は「フォルダツリーから選ぶ...」（GBFolderPicker）と
 * 「新規シートを作成...」を使う。候補は1回の要求（/ruby-sheets）で取得し、
 * シートごとに列定義を取り直さない。
 *
 * 呼び出し側（gb-note-ruby.js / gb-scriptnote-editor.part04.js）は attach() で
 * ポップアップに段を足し、ダイアログを開いている間は isBusy(popup) を見て
 * 外側クリック・Tab巡回・Esc の処理を止める。
 */
(function (global) {
  'use strict';
  if (global.MeldexRubySheetRegister) return;

  var LAST_KEY = 'meldex.rubySheetRegister.last.v1';
  var DEFAULT_PROP = 'ふりがな';
  var NEW_SHEET_DEFAULT_NAME = 'ルビ辞書';
  var BUSY_ATTR = 'rubySheetBusy';

  // --- 純粋な判定（テストで固定） ---------------------------------------------

  function normPath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '').trim();
  }

  function samePath(a, b) {
    var x = normPath(a).toLowerCase();
    var y = normPath(b).toLowerCase();
    return !!x && x === y;
  }

  // 候補の並べ替え: 前回使ったシートを先頭グループにし、他のグループからは除く。
  // グループの順は サーバーの返す優先度（作品 → ソース → ホーム → ワークスペース）を保つ。
  var GROUP_ORDER = ['last', 'work', 'source', 'home', 'workspace'];
  function orderCandidateGroups(payload, last) {
    var groups = Array.isArray(payload && payload.groups) ? payload.groups : [];
    var lastPath = last && last.path ? normPath(last.path) : '';
    var lastSheet = null;
    var seen = {};
    var out = [];
    groups.forEach(function (group) {
      var sheets = [];
      (Array.isArray(group && group.sheets) ? group.sheets : []).forEach(function (sheet) {
        var key = normPath(sheet && sheet.path).toLowerCase();
        if (!key || seen[key]) return;
        seen[key] = true;
        if (lastPath && key === lastPath.toLowerCase()) { lastSheet = sheet; return; }
        sheets.push(sheet);
      });
      if (sheets.length) {
        out.push({ kind: String(group.kind || ''), label: String(group.label || ''), rootName: String(group.rootName || ''), sheets: sheets });
      }
    });
    if (lastPath) {
      var sheet = lastSheet || {
        path: lastPath,
        name: String(last.name || lastPath.split('/').pop() || ''),
        relPath: String(last.relPath || last.name || ''),
        furiganaProps: Array.isArray(last.furiganaProps) ? last.furiganaProps : [],
      };
      out.unshift({ kind: 'last', label: '前回使ったシート', rootName: '', sheets: [sheet] });
    }
    out.sort(function (a, b) {
      var ia = GROUP_ORDER.indexOf(a.kind); var ib = GROUP_ORDER.indexOf(b.kind);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return out;
  }

  // 登録の分岐: 同名トピックが無ければ作成、同じ読みが既にあれば何もしない、
  // 違う読みしか無ければ候補値として追加（採用の読みが既にある時は「案」で足す）。
  function planRegistration(lookup, ruby) {
    var value = String(ruby || '').trim();
    if (!value) return { action: 'none' };
    if (!lookup || !lookup.exists) return { action: 'create', status: '採用' };
    var readings = Array.isArray(lookup.readings) ? lookup.readings : [];
    if (readings.some(function (r) { return String(r && r.value || '').trim() === value; })) {
      return { action: 'exists-same' };
    }
    var hasAdopted = readings.some(function (r) { return r && r.status === '採用' && String(r.value || '').trim(); });
    return { action: 'append', status: hasAdopted ? '案' : '採用', existing: readings.map(function (r) { return String(r.value || ''); }) };
  }

  function rubyPropertyFor(sheet, lookup) {
    var a = sheet && Array.isArray(sheet.furiganaProps) ? sheet.furiganaProps : [];
    var b = lookup && Array.isArray(lookup.furiganaProps) ? lookup.furiganaProps : [];
    return String(a[0] || b[0] || DEFAULT_PROP);
  }

  // --- 環境 -------------------------------------------------------------------

  function readLast() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(LAST_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && parsed.path ? parsed : null;
    } catch (_) { return null; }
  }

  function writeLast(sheet) {
    try {
      if (!sheet || !sheet.path || !global.localStorage) return;
      global.localStorage.setItem(LAST_KEY, JSON.stringify({
        path: normPath(sheet.path),
        name: String(sheet.name || ''),
        relPath: String(sheet.relPath || ''),
        furiganaProps: Array.isArray(sheet.furiganaProps) ? sheet.furiganaProps.slice(0, 4) : [],
      }));
    } catch (_) {}
  }

  function workFolderFor(path) {
    try {
      if (typeof global.getWorkFolder === 'function') return String(global.getWorkFolder(path || undefined) || '');
    } catch (_) {}
    return '';
  }

  function api(path, opts) {
    if (typeof global.apiFetch !== 'function') return Promise.reject(new Error('この画面ではシートに登録できません'));
    return global.apiFetch(path, opts);
  }

  function post(path, body) {
    if (typeof global.apiPost === 'function') return global.apiPost(path, body);
    return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  function put(path, body) {
    if (typeof global.apiPut === 'function') return global.apiPut(path, body);
    return api(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  function status(message, isError) {
    if (typeof global.showStatus === 'function') global.showStatus(message, !!isError);
  }

  function errorText(err) {
    var text = global.MeldexErrorMessages && typeof global.MeldexErrorMessages.toStatusText === 'function'
      ? global.MeldexErrorMessages.toStatusText(err, {})
      : '';
    return text || (err && err.message) || String(err || '');
  }

  function fetchCandidates(currentPath) {
    var params = [];
    var work = workFolderFor(currentPath);
    if (currentPath) params.push('path=' + encodeURIComponent(currentPath));
    if (work) params.push('work=' + encodeURIComponent(work));
    return api('/ruby-sheets' + (params.length ? '?' + params.join('&') : ''), { silentError: true, skipBrowseCache: true });
  }

  function lookupEntry(sheetPath, name) {
    return api('/ruby-sheets/entry?sheet=' + encodeURIComponent(sheetPath) + '&name=' + encodeURIComponent(name), { silentError: true });
  }

  function dbScope(path) {
    if (typeof global._dbScopeForPath === 'function') return global._dbScopeForPath(path);
    return 'db:' + normPath(path);
  }

  function afterDictionaryChange(sheetPath) {
    // 自動リンク辞書・読み取得（/api/ruby）はサーバー側で保存先の変化を検知して作り直す。
    // 画面が持っている辞書の写しだけ読み直す。
    try { if (typeof global.loadLinkDict === 'function') global.loadLinkDict(); } catch (_) {}
    try {
      // 本体の state はトップレベルの let 宣言なので window には載らない
      var st = typeof state !== 'undefined' ? state : global.state;
      if (st && samePath(st.currentDbPath, sheetPath) && typeof global.selectDatabase === 'function') {
        global.selectDatabase(sheetPath, null, { silent: true });
      }
    } catch (_) {}
  }

  function pushCreateHistory(sheet, name, created) {
    if (typeof global.historyPush !== 'function') return;
    var path = String((created && (created.path || created.entry_path)) || (normPath(sheet.path) + '/' + name + '.md'));
    var entryId = String((created && (created.entry_id || created.id)) || '');
    var properties = created && created.__properties;
    global.historyPush('ルビをシートに登録: ' + name,
      async function () {
        var identity = global.GbDbEntryIdentity;
        if (!identity || typeof identity.deleteEntries !== 'function') throw new Error('この画面では取り消せません');
        var result = await identity.deleteEntries({
          dbPath: sheet.path,
          ctx: null,
          entries: [{ name: name, path: path, entryId: entryId }],
          source: 'ruby-sheet-register-undo',
        });
        if (result && result.failures && result.failures.length) throw result.failures[0].error;
        afterDictionaryChange(sheet.path);
      },
      async function () {
        var redo = await post('/entity/create', { parent_path: sheet.path, name: name, properties: properties });
        path = String((redo && (redo.path || redo.entry_path)) || path);
        entryId = String((redo && (redo.entry_id || redo.id)) || '');
        afterDictionaryChange(sheet.path);
      },
      dbScope(sheet.path));
  }

  // 1件の登録。結果 { kind: 'created'|'appended'|'exists-same'|'cancelled', sheet, name, ruby }
  async function registerTo(sheet, text, ruby, hooks) {
    hooks = hooks || {};
    var name = String(text || '').trim();
    var value = String(ruby || '').trim();
    if (!sheet || !sheet.path || !name || !value) throw new Error('登録する文字列とルビを入力してください');
    var lookup = await lookupEntry(sheet.path, name);
    var plan = planRegistration(lookup, value);
    var prop = rubyPropertyFor(sheet, lookup);
    var sheetName = String(sheet.name || normPath(sheet.path).split('/').pop() || '');
    if (plan.action === 'exists-same') {
      writeLast(sheet);
      return { kind: 'exists-same', sheet: sheet, name: name, ruby: value };
    }
    if (plan.action === 'append') {
      var existing = plan.existing.filter(Boolean).join('、') || '（なし）';
      var confirmFn = typeof global.cfConfirm === 'function' ? global.cfConfirm : null;
      var withDialog = hooks.withDialog || function (fn) { return fn(); };
      var question = 'シート「' + sheetName + '」には「' + name + '」が既にあります（' + prop + ': ' + existing + '）。\n'
        + '読み「' + value + '」を' + (plan.status === '案' ? '案として' : '') + '追加しますか？';
      var ok = confirmFn ? await withDialog(function () { return confirmFn(question, { okLabel: '追加' }); }) : false;
      if (!ok) return { kind: 'cancelled', sheet: sheet, name: name, ruby: value };
      var body = lookup.legacy
        ? { folder_path: lookup.path, property: prop, value: value, status: plan.status }
        : { entry_path: lookup.path, property: prop, value: value, status: plan.status };
      await post('/value', body);
      writeLast(sheet);
      afterDictionaryChange(sheet.path);
      return { kind: 'appended', sheet: sheet, name: name, ruby: value, status: plan.status };
    }
    var properties = {};
    properties[prop] = [{ value: value, status: '採用' }];
    var created = await post('/entity/create', { parent_path: sheet.path, name: name, properties: properties });
    if (created && typeof created === 'object') created.__properties = properties;
    pushCreateHistory(sheet, name, created);
    writeLast(sheet);
    afterDictionaryChange(sheet.path);
    return { kind: 'created', sheet: sheet, name: name, ruby: value };
  }

  function resultMessage(result) {
    var sheetName = String(result.sheet && (result.sheet.name || normPath(result.sheet.path).split('/').pop()) || '');
    if (result.kind === 'created') return '「' + result.name + '」をシート「' + sheetName + '」に登録しました';
    if (result.kind === 'appended') return '「' + result.name + '」の読み「' + result.ruby + '」をシート「' + sheetName + '」に追加しました';
    if (result.kind === 'exists-same') return '「' + result.name + '」の読み「' + result.ruby + '」はシート「' + sheetName + '」に登録済みです';
    return '';
  }

  // 新規シート: 作成先（既定は作品フォルダ → 現在のファイルのフォルダ）と名前を選び、
  // 「ふりがな（ふりがな型）」列を持つシートを作る。トピック名の列はシートの既定の名前列。
  async function createSheet(currentPath, hooks) {
    hooks = hooks || {};
    var withDialog = hooks.withDialog || function (fn) { return fn(); };
    var parentDefault = workFolderFor(currentPath) || normPath(currentPath).split('/').slice(0, -1).join('/');
    var parent = parentDefault;
    var picker = global.GBFolderPicker;
    if (picker && typeof picker.pickFolder === 'function') {
      var selection = await withDialog(function () {
        return picker.pickFolder({
          title: '新しいシートの作成先を選択',
          initialPath: parentDefault || '',
          revealPath: parentDefault || '',
        });
      });
      if (!selection || !selection.path) return null;
      parent = selection.path;
    }
    var label = NEW_SHEET_DEFAULT_NAME;
    if (typeof global.cfPrompt === 'function') {
      label = await withDialog(function () { return global.cfPrompt('新しいシートの名前', NEW_SHEET_DEFAULT_NAME, { okLabel: '作成' }); });
      if (label == null) return null;
      label = String(label).trim() || NEW_SHEET_DEFAULT_NAME;
    }
    var created = await post('/outliner/add', { type: 'database', label: label, parent: parent || '' });
    var sheetPath = String((created && created.node && created.node.path) || '');
    if (!sheetPath) throw new Error('シートを作成できませんでした');
    var propertyTypes = {};
    propertyTypes[DEFAULT_PROP] = { type: 'furigana' };
    await put('/db-metadata?path=' + encodeURIComponent(sheetPath), { property_types: propertyTypes });
    try { if (typeof global.refreshOutliner === 'function') global.refreshOutliner(); } catch (_) {}
    return {
      path: sheetPath,
      name: String((created.node && created.node.label) || label),
      relPath: sheetPath,
      furiganaProps: [DEFAULT_PROP],
    };
  }

  async function pickSheetFromTree(currentPath, hooks) {
    var picker = global.GBFolderPicker;
    if (!picker || typeof picker.pickFolder !== 'function') return null;
    var withDialog = (hooks && hooks.withDialog) || function (fn) { return fn(); };
    var selection = await withDialog(function () {
      return picker.pickFolder({
        title: '登録先のシートを選択',
        selectFiles: true,
        fileTypes: ['database'],
        emptyText: 'この階層にフォルダとシートはありません。',
        searchProvider: typeof global._getAllDatabases === 'function' ? function () { return global._getAllDatabases(true); } : undefined,
        searchPlaceholder: 'シート名で検索...',
        revealPath: workFolderFor(currentPath) || '',
      });
    });
    if (!selection || !selection.path) return null;
    return {
      path: selection.path,
      name: String(selection.label || selection.name || normPath(selection.path).split('/').pop() || ''),
      relPath: String(selection.path),
      furiganaProps: [],
    };
  }

  // --- UI ---------------------------------------------------------------------

  function isBusy(popup) {
    return !!(popup && popup.dataset && popup.dataset[BUSY_ATTR] === '1');
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function menuButton(label, detail, e2eId) {
    var button = el('button', 'gb-context-menu-item gb-ruby-sheet-register-item');
    button.type = 'button';
    if (e2eId) button.dataset.e2eId = e2eId;
    var main = el('span', 'gb-context-menu-item-label gb-ruby-sheet-register-name', label);
    button.appendChild(main);
    if (detail) {
      var sub = el('span', 'gb-ruby-sheet-register-path', detail);
      button.appendChild(sub);
      button.title = label + '（' + detail + '）';
    }
    return button;
  }

  /**
   * ルビ設定ポップアップに「シートに登録」の段を足す。
   * opts: { getText(), getRuby(), rubyInput, getPath(), reposition(), focusAfter }
   */
  function attach(popup, opts) {
    opts = opts || {};
    if (!popup) return null;
    var mount = opts.mount || popup;
    var section = el('div', 'gb-ruby-sheet-register');
    section.dataset.e2eId = 'ruby-sheet-register';
    var toggle = el('button', 'gb-btn gb-btn-sm gb-btn-quiet gb-ruby-sheet-register-toggle', 'シートに登録');
    toggle.type = 'button';
    toggle.dataset.e2eId = 'ruby-sheet-register-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.title = '選択中の文字列とルビを、ふりがな列のあるシートに登録します';
    var panel = el('div', 'gb-ruby-sheet-register-panel');
    panel.hidden = true;
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', '登録先のシート');
    panel.dataset.e2eId = 'ruby-sheet-register-panel';
    var list = el('div', 'gb-ruby-sheet-register-list');
    var result = el('div', 'gb-ruby-sheet-register-result');
    result.setAttribute('role', 'status');
    result.setAttribute('aria-live', 'polite');
    result.hidden = true;
    var sep = el('div', 'gb-context-menu-sep');
    var treeButton = menuButton('フォルダツリーから選ぶ...', '', 'ruby-sheet-register-tree');
    var newButton = menuButton('新規シートを作成...', '', 'ruby-sheet-register-new');
    if (!(global.GBFolderPicker && typeof global.GBFolderPicker.pickFolder === 'function')) treeButton.hidden = true;
    panel.append(list, sep, treeButton, newButton);
    section.append(toggle, panel, result);
    mount.appendChild(section);

    var loaded = false;
    var working = false;

    function currentPath() {
      try { return normPath(typeof opts.getPath === 'function' ? opts.getPath() : ''); } catch (_) { return ''; }
    }
    function ruby() { return String(typeof opts.getRuby === 'function' ? opts.getRuby() : '').trim(); }
    function text() { return String(typeof opts.getText === 'function' ? opts.getText() : '').trim(); }
    function reposition() { try { if (typeof opts.reposition === 'function') opts.reposition(); } catch (_) {} }

    function syncEnabled() {
      var enabled = !!ruby() && !!text() && !working;
      toggle.disabled = !enabled;
      panel.querySelectorAll('button').forEach(function (button) { button.disabled = !enabled; });
    }

    // ダイアログ（フォルダ選択・確認・名前入力）の間はポップアップを隠し、
    // 呼び出し側の外側クリック・Tab巡回・Esc の処理を止める。
    async function withDialog(fn) {
      popup.dataset[BUSY_ATTR] = '1';
      popup.classList.add('is-ruby-sheet-dialog-open');
      try {
        return await fn();
      } finally {
        popup.classList.remove('is-ruby-sheet-dialog-open');
        // ダイアログを閉じたクリックが外側クリックとして届かないよう、解除を1拍遅らせる
        setTimeout(function () { delete popup.dataset[BUSY_ATTR]; }, 0);
        if (popup.isConnected) {
          try { toggle.focus({ preventScroll: true }); } catch (_) {}
        }
      }
    }

    function showResult(message, sheet, isError) {
      result.textContent = '';
      result.hidden = !message;
      result.classList.toggle('is-error', !!isError);
      if (!message) { reposition(); return; }
      result.appendChild(el('span', 'gb-ruby-sheet-register-result-text', message));
      if (sheet && sheet.path && typeof global.selectDatabase === 'function') {
        var open = el('button', 'gb-btn gb-btn-sm gb-btn-quiet gb-ruby-sheet-register-open', 'シートを開く');
        open.type = 'button';
        open.dataset.e2eId = 'ruby-sheet-register-open';
        open.addEventListener('click', function () {
          if (typeof opts.close === 'function') opts.close();
          global.selectDatabase(sheet.path);
        });
        result.appendChild(open);
      }
      reposition();
    }

    async function run(getSheet) {
      if (working) return;
      var value = ruby();
      var name = text();
      if (!value || !name) return;
      working = true;
      syncEnabled();
      try {
        var sheet = await getSheet();
        if (!sheet) return;
        var outcome = await registerTo(sheet, name, value, { withDialog: withDialog });
        if (outcome.kind === 'cancelled') return;
        var message = resultMessage(outcome);
        status(message, false);
        if (popup.isConnected) {
          panel.hidden = true;
          toggle.setAttribute('aria-expanded', 'false');
          loaded = false;
          showResult(message, outcome.sheet, false);
        }
      } catch (err) {
        var msg = 'シートに登録できませんでした: ' + errorText(err);
        status(msg, true);
        if (popup.isConnected) showResult(msg, null, true);
      } finally {
        working = false;
        if (popup.isConnected) syncEnabled();
      }
    }

    function renderGroups(groups) {
      list.textContent = '';
      if (!groups.length) {
        list.appendChild(el('div', 'gb-context-menu-label gb-ruby-sheet-register-empty', 'ふりがな列のあるシートは見つかりませんでした'));
        return;
      }
      groups.forEach(function (group) {
        var heading = group.label + (group.rootName && group.kind !== 'last' ? '（' + group.rootName + '）' : '');
        list.appendChild(el('div', 'gb-context-menu-label gb-ruby-sheet-register-group', heading));
        group.sheets.forEach(function (sheet) {
          var button = menuButton(String(sheet.name || ''), String(sheet.relPath || ''), 'ruby-sheet-register-candidate');
          button.dataset.sheetPath = String(sheet.path || '');
          button.dataset.groupKind = group.kind;
          button.addEventListener('click', function () { run(function () { return Promise.resolve(sheet); }); });
          list.appendChild(button);
        });
      });
    }

    async function load() {
      list.textContent = '';
      list.appendChild(el('div', 'gb-context-menu-label', 'シートを読み込み中...'));
      reposition();
      try {
        var payload = await fetchCandidates(currentPath());
        if (!popup.isConnected) return;
        renderGroups(orderCandidateGroups(payload, readLast()));
        if (payload && payload.truncated) {
          list.appendChild(el('div', 'gb-context-menu-label', '候補が多いため一部だけを表示しています'));
        }
        loaded = true;
      } catch (err) {
        if (!popup.isConnected) return;
        list.textContent = '';
        renderGroups(orderCandidateGroups({ groups: [] }, readLast()));
        var failed = el('div', 'gb-context-menu-label is-error', '候補を読み込めませんでした');
        var retry = el('button', 'gb-btn gb-btn-sm gb-btn-quiet', '再試行');
        retry.type = 'button';
        retry.addEventListener('click', function () { load(); });
        list.append(failed, retry);
      }
      syncEnabled();
      reposition();
    }

    toggle.addEventListener('click', function () {
      if (toggle.disabled) return;
      var open = panel.hidden;
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        showResult('', null, false);
        if (!loaded) load(); else reposition();
        var first = panel.querySelector('button:not([hidden]):not(:disabled)');
        if (first) { try { first.focus({ preventScroll: true }); } catch (_) {} }
      } else {
        reposition();
      }
    });
    treeButton.addEventListener('click', function () {
      run(function () { return pickSheetFromTree(currentPath(), { withDialog: withDialog }); });
    });
    newButton.addEventListener('click', function () {
      run(function () {
        return createSheet(currentPath(), { withDialog: withDialog }).then(function (sheet) {
          if (sheet) status('シート「' + sheet.name + '」を作成しました', false);
          return sheet;
        });
      });
    });
    if (opts.rubyInput) {
      opts.rubyInput.addEventListener('input', function () {
        syncEnabled();
        if (!result.hidden) showResult('', null, false);
      });
    }
    syncEnabled();
    return { element: section, toggle: toggle, panel: panel, refresh: syncEnabled };
  }

  global.MeldexRubySheetRegister = {
    attach: attach,
    isBusy: isBusy,
    registerTo: registerTo,
    createSheet: createSheet,
    orderCandidateGroups: orderCandidateGroups,
    planRegistration: planRegistration,
    rubyPropertyFor: rubyPropertyFor,
    resultMessage: resultMessage,
    LAST_KEY: LAST_KEY,
  };
})(typeof window !== 'undefined' ? window : globalThis);
