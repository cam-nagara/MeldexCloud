/* Document icons share the callout picker and its image registration UI. */
(function (global) {
  'use strict';
  const supported = new Set(['folder', 'page', 'database', 'pivot', 'tree', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'board', 'calendar', 'scenario', 'scriptnote', 'timer', 'form-app', 'map', 'chat']);
  const cache = new Map();
  const pending = new Set();
  const providers = new WeakMap();
  let providerSerial = 0;
  const header = /^\uFEFF?---\r?\n(?:([\s\S]*?)\r?\n)?---(?:\r?\n|$)/;
  // .mel-board は拡張子が .mel-* でも先頭にフロントマターを持つMarkdown形式。中身で判定する。
  const isJson = (path, text) => /\.(?:json|mel-[a-z-]+)$/i.test(path || '') && !/^\uFEFF?---(?:\r?\n|$)/.test(String(text || ''));
  function readFields(text, path) {
    if (!String(text || '').trim()) return {};
    if (isJson(path, text)) {
      const data = JSON.parse(text);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('メタデータの形式が不正です');
      return data;
    }
    const match = String(text).match(header);
    if (!match && /^\uFEFF?---(?:\r?\n|$)/.test(text)) throw new Error('メタデータを読み取れません');
    const result = {};
    for (const key of ['display_icon', 'display_icon_source', 'file_icon_metadata_only']) {
      const matches = [...(match?.[1] || '').matchAll(new RegExp('^' + key + ': *([^\\r\\n]*)$', 'gm'))];
      if (matches.length > 1) throw new Error('アイコンのメタデータが重複しています');
      if (matches.length) {
        const raw = matches[0][1].trim();
        result[key] = raw.startsWith('"') || raw === 'true' || raw === 'false' ? JSON.parse(raw) : raw.startsWith("'") && raw.endsWith("'") ? raw.slice(1,-1).replace(/''/g, "'") : raw;
      }
    }
    return result;
  }
  function writeFields(text, fields, path) {
    const data = readFields(text, path);
    if (isJson(path, text)) return JSON.stringify({...data, ...fields}, null, 2);
    const match = String(text || '').match(header);
    let raw = match?.[1] || '';
    for (const [key, value] of Object.entries(fields)) {
      const line = key + ': ' + JSON.stringify(value);
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        if (/^[|>]/.test(String(data[key]))) throw new Error('このアイコン設定は変更できません');
        raw = raw.replace(new RegExp('^' + key + ':[^\\r\\n]*(?:\\r?\\n[ \\t]+[^\\r\\n]*)*', 'm'), line);
      } else raw += (raw ? '\n' : '') + line;
    }
    return '---\n' + raw + '\n---\n' + (match ? text.slice(match[0].length) : text || '');
  }
  function preserve(newText, oldText, path) {
    if (!String(oldText || '').trim()) return newText;
    if (!/^display_icon(?:_source)?:|"display_icon(?:_source)?"\s*:/m.test(oldText)) return newText;
    const old = readFields(oldText, path), incoming = readFields(newText, path);
    const fields = Object.fromEntries(['display_icon','display_icon_source'].filter(k => Object.prototype.hasOwnProperty.call(old,k)).map(k => [k,old[k]]));
    return Object.entries(fields).every(([k,v]) => incoming[k] === v) ? newText : writeFields(newText, fields, path);
  }
  function normalize(spec) {
    if (spec === '') return '';
    if (typeof spec !== 'string' || spec.length > 2500) throw new Error('アイコンの形式が不正です');
    const parsed = GBIconAssets.parseSpec(spec);
    if (!['lucide', 'noto', 'image'].includes(parsed.type) || !parsed.spec || /[\x00-\x1f\x7f]/.test(parsed.spec)) throw new Error('アイコンの形式が不正です');
    if (parsed.type === 'lucide' && !/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(parsed.name)) throw new Error('アイコンの形式が不正です');
    if (parsed.type === 'noto') {
      const points = parsed.spec.slice(5).split('-').map(part => parseInt(part,16));
      if (points.length > 32 || points.some(cp => cp < 32 || cp === 127 || (cp >= 0xD800 && cp <= 0xF8FF) || cp >= 0xF0000)) throw new Error('アイコンの形式が不正です');
    }
    return parsed.spec;
  }
  function refreshTabs() {
    const layout = typeof GBLayout !== 'undefined' ? GBLayout : global.GBLayout;
    if (layout?.getAllPanes) {
      for (const pane of layout.getAllPanes(layout.root)) {
        for (const tab of pane.tabs || []) {
          const icon = document.querySelector('[data-tab-id="' + global.MeldexEscape.cssIdent(tab.id) + '"] .gb-tab-icon');
          if (icon) icon.innerHTML = render(tabItem(tab), 14, typeof lucide === 'function' ? lucide(tab.icon || 'page', 14) : '');
        }
        layout.refreshPaneTabs?.(pane.id);
      }
    }
    if (typeof renderTabs === 'function') renderTabs();
    scheduleToolbarSync();
  }
  function scope() {
    const state = global.MeldexRuntimeAdapter?.getWorkspaceState?.();
    const provider = global.MeldexStorageAdapter?.getProvider?.();
    let providerId = '';
    if (provider && typeof provider === 'object') {
      if (!providers.has(provider)) providers.set(provider, ++providerSerial);
      providerId = providers.get(provider);
    }
    const workspace = state?.workspaceId || state?.workspace_id || state?.stableId
      || global.MeldexWorkspaces?.getActiveId?.() || global.MeldexStandaloneFS?.rootPathLabel?.()
      || (typeof _homeFolderPath !== 'undefined' ? _homeFolderPath : 'desktop');
    return String(workspace) + ':' + providerId;
  }
  function key(path) { return scope() + '\n' + String(path || '').replace(/\\/g, '/'); }
  function matchesScope(token, provider) {
    const current = global.MeldexStorageAdapter?.getProvider?.();
    return token === scope() && (!current || current === provider);
  }
  function canEdit(item) { return !!item?.path && supported.has(item.type) && !item._isRoot; }
  // この画面で保存した直後の値。別セクション（ホームフォルダ等）や端末内の一覧キャッシュが
  // 古いデータで後から描き直しても、旧アイコンへ戻さない。一覧キャッシュの更新を待つ間
  // （2分）だけ優先し、その後は一覧データ（他の端末での変更を含む）に従う。
  const savedOverrides = new Map();
  const SAVED_OVERRIDE_MS = 120000;
  function remember(item) {
    if (!item?.path || !Object.prototype.hasOwnProperty.call(item, 'display_icon')) return item;
    const k = key(item.path);
    const saved = savedOverrides.get(k);
    if (saved && Date.now() - saved.at > SAVED_OVERRIDE_MS) savedOverrides.delete(k);
    else if (saved && (item.display_icon || '') !== saved.spec) item.display_icon = saved.spec;
    cache.set(k, item.display_icon || '');
    return item;
  }
  function render(item, size, fallback) {
    remember(item);
    const spec = item?.display_icon ?? cache.get(key(item?.path));
    if (!spec || !global.GBIconAssets) return fallback;
    const parsed = GBIconAssets.parseSpec(spec);
    if (!['lucide', 'noto', 'image'].includes(parsed.type) || (parsed.type === 'lucide' && !GBIconAssets.hasLucideName(parsed.name))) return fallback;
    const markup = GBIconAssets.render(spec, size || 18, {contextPath: item.path, className: 'gb-file-custom-icon'});
    return parsed.type === 'image' ? '<span data-file-icon-type="' + MeldexEscape.attr(item.type || 'page') + '">' + markup + '</span>' : markup;
  }
  // アイコンの保存はファイル自体を書き換えるため、そのファイルを開いている編集画面の
  // 「最後に保存した版」が古くなり、次の保存が競合（他の編集あり）で止まっていた。
  // アイコン変更の直前と同じ版を持つ編集画面だけ、新しい版へ進める（それ以外の変更は
  // 通常どおり競合として扱う）。本文は変えていないので、編集中の内容はそのまま残る。
  function adoptRevision(path, previousEtag, etag) {
    if (!path || !etag || !previousEtag || etag === previousEtag) return;
    const same = value => !!value && key(value) === key(path);
    const coordinator = global.MeldexDocumentSaveCoordinator;
    const transport = value => coordinator?.normalizeTransportRevision?.(coordinator.currentTransportName?.(), value) || value;
    const advance = (holder, etagKey, revisionKey) => {
      if (!holder || holder[etagKey] !== previousEtag) return;
      holder[etagKey] = etag;
      if (revisionKey && holder[revisionKey]) holder[revisionKey] = transport(etag);
    };
    try {
      if (typeof bd !== 'undefined' && bd && same(bd.path)) advance(bd, 'lastSavedEtag', 'lastSavedTransportRevision');
      if (typeof _sn2Editors !== 'undefined' && _sn2Editors) {
        Object.values(_sn2Editors).forEach(editor => {
          if (editor && same(editor._path)) advance(editor, '_lastSavedEtag', '_lastSavedTransportRevision');
        });
      }
      if (typeof forEachComponent === 'function') {
        forEachComponent(component => {
          // フォーム・マップは保存の基準版をストアに持つ。
          if (component?.store && same(component.path) && !component.store.pending) advance(component.store, 'etag');
        });
      }
    } catch (error) {
      console.warn('[Meldex] アイコン変更後の保存基準を更新できませんでした', error);
    }
  }
  async function refresh(path, spec) {
    const activeScope = scope();
    cache.set(key(path), spec || '');
    savedOverrides.set(key(path), {spec: spec || '', at: Date.now()});
    const updateItem = item => {
      if (item?.path && key(item.path) === key(path)) item.display_icon = spec || '';
    };
    const refreshTree = () => document.querySelectorAll('.tree-node').forEach(node => {
      updateItem(node._nodeData);
      if (!node._nodeData?.path || key(node._nodeData.path) !== key(path)) return;
      const icon = node.querySelector('.tree-node-row .tree-icon');
      if (icon) icon.innerHTML = typeof _outlinerIconMarkup === 'function'
        ? _outlinerIconMarkup(node._nodeData, 18)
        : render(node._nodeData, 18, typeof lucide === 'function' ? lucide('file', 18) : '');
    });
    refreshTree();
    // タブにはアイコンを持たせない（tabItem 参照）。表示はキャッシュから引き直す。
    // Cache-only refreshes can return an old browse payload. Keep the saved
    // value authoritative until the reload below completes.
    try {
      if (typeof loadOutliner === 'function') await loadOutliner({force: true});
    } catch (_) {
      if (typeof showStatus === 'function') showStatus('アイコンを保存しました。表示を更新できなかったため画面を再読込してください', true);
    }
    if (scope() !== activeScope) return;
    refreshTree();
    cache.set(key(path), spec || '');
    document.querySelectorAll('.fv-item[data-path]').forEach(element => {
      if (key(element.dataset.path) !== key(path)) return;
      if (element._folderItem) element._folderItem.display_icon = spec || '';
      const icon = element.querySelector('.fv-icon');
      if (icon) icon.innerHTML = render(element._folderItem || {path, display_icon:spec}, 36,
        typeof fileTypeIcon === 'function' ? fileTypeIcon(element._folderItem?.type || 'page') : '');
    });
    try { await global.MeldexCloudMobileExplorer?.renderCurrent?.({force:true}); } catch (_) {}
    refreshTabs();
    global.dispatchEvent(new CustomEvent('meldex:file-icon-changed', {detail: {path, icon: spec}}));
  }
  async function openPicker(item, anchorEl) {
    if (!canEdit(item) || !global.GBIconAssets) return;
    const path = item.path, activeScope = scope();
    const isCurrent = () => scope() === activeScope;
    try {
      const loaded = await apiFetch('/file-icon?path=' + encodeURIComponent(path), {silentError: true});
      if (!isCurrent()) return;
      // Reuse callout image upload, validation, resize, and registered-image list.
      const context = document.createElement('div'); context.dataset.path = path;
      const imageOptions = typeof _calloutImageOptions === 'function' ? _calloutImageOptions(context, isCurrent) : {};
      if (GBIconAssets.parseSpec(loaded.icon || '').type === 'image') {
        imageOptions.imageItems = [...(imageOptions.imageItems || []), {type:'image',spec:loaded.icon,label:'現在のアイコン',keywords:'画像'}];
      }
      const save = async spec => {
        if (!isCurrent()) return;
        try {
          const result = await apiFetch('/file-icon', {method: 'PUT', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({path, icon: spec || '', if_match_etag: loaded.etag}), silentError: true});
          if (!isCurrent()) return;
          item.display_icon = result.icon || '';
          adoptRevision(path, loaded.etag, result.etag);
          await refresh(path, result.icon);
        } catch (error) {
          showStatus('アイコンを保存できませんでした。開き直して再試行してください: ' + (error.userMessage || error.message || error), true);
        }
      };
      GBIconAssets.openPicker({...imageOptions, title: 'ファイルアイコン', anchorEl, current: loaded.icon || '',
        includeLucide: true, includeNoto: true, allowReset: true, resetLabel: '既定に戻す',
        onSelect: spec => save(spec), onReset: () => save('')});
    } catch (error) {
      showStatus('アイコンを読み込めませんでした: ' + (error.userMessage || error.message || error), true);
    }
  }
  // 保存済みアイコンを1ファイル1回だけ読み、タブとツールバーの表示へ反映する。
  function prefetch(item) {
    const id = key(item?.path);
    if (!canEdit(item) || isStandalone() || cache.has(id) || pending.has(id) || typeof apiFetch !== 'function') return;
    pending.add(id);
    const activeScope = scope();
    apiFetch('/file-icon?path=' + encodeURIComponent(item.path), {silentError: true}).then(data => {
      if (scope() !== activeScope) return;
      if (cache.has(id)) return;
      cache.set(id, data.icon || '');
      refreshTabs();
    }).catch(() => { if (scope() === activeScope && !cache.has(id)) cache.set(id, ''); }).finally(() => pending.delete(id));
  }
  // タブはファイルを開き替えても同じオブジェクトのまま残るため、アイコンをタブ自体に持たせると
  // 前に開いていたファイルのアイコンが次のファイル（フォルダ等）へ持ち越されていた。
  // タブのアイコンは常にパスから引き、古い版が保存したタブ上の値は捨てる。
  function tabItem(tab) {
    if (tab && Object.prototype.hasOwnProperty.call(tab, 'display_icon')) delete tab.display_icon;
    return {type: tab?.type, path: tab?.path || ''};
  }
  function tabIcon(tab, size, fallback) {
    const item = tabItem(tab);
    const result = render(item, size, fallback);
    prefetch(item);
    // タブ見出しの描き直し（タブの追加・切替・改名・パス変更）にツールバーのアイコンも追従させる。
    scheduleToolbarSync();
    return result;
  }

  // ---- ツールバーのファイル名直前のファイルアイコン（UI共通ルール19「ツールバー」） ----
  // アプリを表す左端の .tb-app-icon とは別の部品。フォルダツリー・フォルダパネルと同じ解決
  // （カスタムアイコン → 種別の既定アイコン）で、表示中のファイル自身のアイコンを出す。
  const TOOLBAR_ICON_SIZE = 16;
  const TOOLBAR_APPS = {
    page: {type: 'page', keys: ['pagePath'], current: () => stateValue('currentPagePath')},
    database: {type: 'database', keys: ['dbPath'], current: () => stateValue('currentDbPath')},
    csv: {type: 'csv', keys: ['csvPath'], current: () => (typeof _csvPath !== 'undefined' ? _csvPath : '')},
    folder: {type: 'folder', keys: ['folderPath'], current: () => (typeof _folderPath !== 'undefined' ? _folderPath : '')},
    scriptnote: {type: 'scriptnote', keys: ['scenarioPath', 'scriptnotePath']},
    board: {type: 'board', keys: ['boardPath']},
    'form-app': {type: 'form-app', keys: ['formPath']},
    map: {type: 'map', keys: ['mapPath']},
  };
  const TOOLBAR_LABEL = 'ファイルアイコン';
  const TOOLBAR_EDIT_LABEL = 'ファイルアイコンを変更';
  let toolbarSyncQueued = false;
  function stateValue(name) {
    try { return (typeof state !== 'undefined' && state && state[name]) || ''; } catch (_) { return ''; }
  }
  function isStandalone() { return !!(global.MeldexStandaloneFS || global.BoardStandaloneFS); }
  function samePath(a, b) {
    const left = String(a || '').replace(/\\/g, '/').replace(/\/+$/, ''), right = String(b || '').replace(/\\/g, '/').replace(/\/+$/, '');
    return !!left && !!right && (left === right || left.endsWith('/' + right) || right.endsWith('/' + left));
  }
  function findTab(tabId) {
    const layout = typeof GBLayout !== 'undefined' ? GBLayout : global.GBLayout;
    for (const pane of layout?.getAllPanes?.(layout.root) || []) {
      const tab = (pane.tabs || []).find(candidate => candidate?.id === tabId);
      if (tab) return tab;
    }
    return null;
  }
  // 同じアプリを2つのパネルで開いても、各ツールバーは自分を含むタブのファイルを出す。
  // 共有の「アクティブなタブ」ではなく、ツールバーを内包するコンポーネント→そのタブで解決する。
  function ownTab(el) {
    let tab = null;
    if (typeof forEachComponent === 'function') {
      forEachComponent((instance, tabId) => {
        if (!tab && instance?.el && instance.el !== el && instance.el.contains?.(el)) tab = findTab(tabId);
      });
    }
    if (tab) return tab;
    const paneId = el.closest?.('.gb-pane[data-pane-id]')?.dataset?.paneId;
    try { return paneId && typeof GBTabs !== 'undefined' ? GBTabs.getActiveTab?.(paneId) || null : null; } catch (_) { return null; }
  }
  function tabPath(tab, keys) {
    if (tab?.path) return tab.path;
    for (const name of keys) if (tab?.state?.[name]) return tab.state[name];
    return '';
  }
  // ルート（保存先そのもの）はフォルダツリーと同じく変更対象外。見るのは最上位の行だけで、ツリー全体は走査しない。
  function isRootPath(path) {
    const normalizePath = value => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const target = normalizePath(path);
    if (!target || typeof document.querySelectorAll !== 'function') return false;
    return [...document.querySelectorAll('#outliner-tree > .tree-node, #body-home > .tree-node')].some(node => node._nodeData?._isRoot
      && normalizePath(node._nodeData.path) === target);
  }
  function toolbarTarget(el) {
    const app = TOOLBAR_APPS[el.dataset.fileIconApp] || TOOLBAR_APPS.page;
    // 本体のシート・ノート・CSV・フォルダ表示は画面を1つだけ持つ（表示中のファイルが正）。
    const path = String((app.current && app.current()) || tabPath(ownTab(el), app.keys) || '');
    const item = {path, type: app.type};
    if (app.type === 'folder' && isRootPath(path)) item._isRoot = true;
    let reason = '';
    if (!path) reason = TOOLBAR_LABEL;
    else if (isStandalone()) reason = 'この画面ではアイコンを変更できません';
    else if (!canEdit(item)) reason = 'このファイルはアイコンを変更できません';
    else if (document.body?.dataset?.cloudReadonly === '1' || document.body?.dataset?.cloudQuotaBlocked === '1') reason = '閲覧専用のためアイコンを変更できません';
    else {
      let locked = false;
      try { locked = typeof isItemLocked === 'function' && isItemLocked(path); } catch (_) { locked = false; }
      if (locked) reason = '編集ロック中のためアイコンを変更できません';
    }
    return {item, editable: !reason, reason};
  }
  function toolbarMarkup(item) {
    if (typeof _outlinerIconMarkup === 'function') return _outlinerIconMarkup(item, TOOLBAR_ICON_SIZE);
    const name = (typeof uiTypeIconName === 'function' && uiTypeIconName(item.type)) || 'page';
    const fallback = typeof lucide === 'function' ? lucide(name, TOOLBAR_ICON_SIZE) : '';
    return item.path ? render(item, TOOLBAR_ICON_SIZE, fallback) : fallback;
  }
  // JSで組むツールバー用の初期マークアップ。種別の既定アイコンを最初から入れ、表示のちらつきを出さない。
  function toolbarIconHtml(app) {
    const appKey = String(app || '').replace(/[^A-Za-z0-9_-]/g, '');
    const config = TOOLBAR_APPS[appKey] || TOOLBAR_APPS.page;
    scheduleToolbarSync();
    return '<span class="tb-file-icon" data-file-icon-app="' + appKey + '" role="img" aria-label="' + TOOLBAR_LABEL + '">'
      + toolbarMarkup({path: '', type: config.type}) + '</span>';
  }
  function watchTitle(el) {
    if (el._fileIconTitleWatched) return;
    const title = el.nextElementSibling;
    if (!title || typeof MutationObserver !== 'function') return;
    el._fileIconTitleWatched = true;
    // ファイル名の差し替え（ファイル切替・改名）で追従する。監視するのはファイル名だけで、
    // アイコン側の書き込みはここに通知されないため自己再帰しない。
    new MutationObserver(scheduleToolbarSync).observe(title, {childList: true, characterData: true, subtree: true});
    title.addEventListener('input', scheduleToolbarSync);
  }
  function setAttr(el, name, value) {
    if (value == null) { if (el.hasAttribute(name)) el.removeAttribute(name); }
    else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }
  function syncToolbarIcon(el) {
    watchTitle(el);
    const {item, editable, reason} = toolbarTarget(el);
    if (item.path) prefetch(item);
    const spec = item.path ? (cache.get(key(item.path)) ?? '') : '';
    const signature = [item.type, item.path, spec, editable ? '1' : '0', reason].join('\n');
    if (el._fileIconSignature === signature) return;
    el._fileIconSignature = signature;
    el.innerHTML = toolbarMarkup(item);
    setAttr(el, 'data-file-icon-path', item.path || null);
    setAttr(el, 'data-file-icon-editable', editable ? 'true' : 'false');
    setAttr(el, 'role', editable ? 'button' : 'img');
    setAttr(el, 'tabindex', editable ? '0' : null);
    setAttr(el, 'aria-haspopup', editable ? 'dialog' : null);
    setAttr(el, 'aria-label', editable ? TOOLBAR_EDIT_LABEL : TOOLBAR_LABEL);
    setAttr(el, 'title', editable ? 'アイコンを変更' : reason);
  }
  function syncToolbarIcons(root) {
    const base = root?.querySelectorAll ? root : document;
    if (typeof base?.querySelectorAll !== 'function') return;
    base.querySelectorAll('.tb-file-icon[data-file-icon-app]').forEach(syncToolbarIcon);
  }
  function scheduleToolbarSync() {
    if (toolbarSyncQueued) return;
    toolbarSyncQueued = true;
    // 非表示の画面では描画フレームが来ないことがあるため、タイマーでまとめて1回だけ同期する。
    setTimeout(() => { toolbarSyncQueued = false; syncToolbarIcons(); }, 0);
  }
  function openToolbarIcon(el) {
    const {item, editable} = toolbarTarget(el);
    if (!editable) return;
    openPicker(item, el);
  }
  document.addEventListener('click', event => {
    const el = event.target?.closest?.('.tb-file-icon[data-file-icon-app]');
    if (!el || el.dataset.fileIconEditable !== 'true') return;
    event.preventDefault();
    openToolbarIcon(el);
  });
  document.addEventListener('keydown', event => {
    const el = event.target;
    if (!(el instanceof Element) || !el.matches('.tb-file-icon[data-file-icon-app]') || el.dataset.fileIconEditable !== 'true') return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openToolbarIcon(el);
  });
  global.addEventListener?.('meldex:file-icon-changed', event => {
    const {path, icon} = event.detail || {};
    // 同じファイルをツリーと別表記のパス（相対／絶対）で開いている場合も最新値にする。
    document.querySelectorAll('.tb-file-icon[data-file-icon-path]').forEach(el => {
      if (samePath(el.dataset.fileIconPath, path)) cache.set(key(el.dataset.fileIconPath), icon || '');
    });
    scheduleToolbarSync();
  });
  global.addEventListener?.('meldex:outliner-rendered', scheduleToolbarSync);
  global.addEventListener?.('meldex:file-locks-updated', scheduleToolbarSync);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleToolbarSync, {once: true});
  else scheduleToolbarSync();
  // A missing image returns to the document's type icon without hiding its name.
  document.addEventListener('error', event => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('gb-file-custom-icon')) return;
    const fallback = document.createElement('span');
    const type = img.closest('[data-file-icon-type]')?.dataset.fileIconType || 'user';
    const name = (typeof uiTypeIconName === 'function' && uiTypeIconName(type)) || (type === 'user' ? 'user' : 'file');
    fallback.innerHTML = typeof lucide === 'function' ? lucide(name, Number(img.width) || 18) : '';
    img.replaceWith(fallback);
  }, true);
  global.MeldexFileIcons = {canEdit, remember, render, openPicker, tabIcon, readFields, writeFields, preserve, matchesScope,
    toolbarIconHtml, syncToolbarIcons, scheduleToolbarSync};
  const extensions = global.__MeldexPwaDataAccessExtensions;
  if (Array.isArray(extensions)) extensions.push(async ({pathname, method, url, body}) => {
    const internals = global.__MeldexPwaDataAccessInternals;
    if (pathname !== '/file-icon' || !['GET','PUT'].includes(method)) return internals?.NOT_HANDLED;
    const provider = await internals._requirePwaProvider(method === 'PUT' ? 'readwrite' : 'read');
    const scopeToken = scope();
    const requireScope = () => { if (!matchesScope(scopeToken,provider)) throw new Error('保存先が変わりました。アイコンを開き直してください'); };
    const path = internals._normalizeFolderPath(method === 'PUT' ? body?.path : url.searchParams.get('path'));
    if (!path) throw new Error('path は必須です');
    const entry = await internals._resolveEntryHandle(provider, path);
    if (!entry) throw new Error('ファイルが見つかりません');
    const note = entry.kind === 'directory' ? internals._joinPath(path, internals._basename(path) + '.md') : path;
    if (entry.kind !== 'directory' && !/\.(?:md|json|mel-[a-z-]+)$/i.test(path)) throw new Error('このファイル形式はアイコン変更に対応していません');
    const noteExists = !!await internals._resolveEntryHandle(provider, note);
    requireScope();
    const loaded = noteExists ? await global.MeldexDataAccess.requestJson('/file?path=' + encodeURIComponent(note)) : {content:'',etag:''};
    requireScope();
    const data = readFields(loaded.content, note);
    if (method === 'GET') return {ok:true,icon:data.display_icon || '',etag:loaded.etag,path};
    if (!Object.prototype.hasOwnProperty.call(body || {},'if_match_etag')) throw new Error('再読込してから変更してください');
    if ((body.if_match_etag || '') !== (loaded.etag || '')) throw new Error('他の編集が保存されています。開き直してください');
    const spec = normalize(body.icon);
    const fields = {display_icon:spec,display_icon_source:'user'};
    if (entry.kind === 'directory' && !noteExists) fields.file_icon_metadata_only = true;
    const content = writeFields(loaded.content, fields, note);
    const saved = await global.MeldexDataAccess.requestJson('/file?path=' + encodeURIComponent(note), {
      method:'PUT',body:{content,if_match_etag:loaded.etag,create_only:!noteExists,_file_icon_write:true,_file_icon_scope:scopeToken},
    });
    return {...saved,ok:true,icon:spec};
  });
})(window);
