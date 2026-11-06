/* Document icons share the callout picker and its image registration UI. */
(function (global) {
  'use strict';
  const supported = new Set(['folder', 'page', 'database', 'board', 'calendar', 'scenario', 'scriptnote', 'timer', 'form-app', 'map', 'chat']);
  const cache = new Map();
  const pending = new Set();
  const providers = new WeakMap();
  let providerSerial = 0;
  const header = /^\uFEFF?---\r?\n(?:([\s\S]*?)\r?\n)?---(?:\r?\n|$)/;
  const isJson = path => /\.(?:json|mel-[a-z-]+)$/i.test(path || '');
  function readFields(text, path) {
    if (!String(text || '').trim()) return {};
    if (isJson(path)) {
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
    if (isJson(path)) return JSON.stringify({...data, ...fields}, null, 2);
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
    if (global.GBLayout?.getAllPanes) {
      for (const pane of GBLayout.getAllPanes()) {
        for (const tab of pane.tabs || []) {
          const icon = document.querySelector('[data-tab-id="' + CSS.escape(tab.id) + '"] .gb-tab-icon');
          if (icon) icon.innerHTML = render(tab, 14, typeof lucide === 'function' ? lucide(tab.icon || 'page', 14) : '');
        }
      }
    }
    if (typeof renderTabs === 'function') renderTabs();
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
  function remember(item) {
    if (item?.path && Object.prototype.hasOwnProperty.call(item, 'display_icon')) cache.set(key(item.path), item.display_icon || '');
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
  async function refresh(path, spec) {
    cache.set(key(path), spec || '');
    try {
      if (typeof loadOutliner === 'function') await loadOutliner({force: true});
    } catch (_) {
      if (typeof showStatus === 'function') showStatus('アイコンを保存しました。表示を更新できなかったため画面を再読込してください', true);
    }
    document.querySelectorAll('.fv-item[data-path]').forEach(element => {
      if (element.dataset.path !== path) return;
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
  function tabIcon(tab, size, fallback) {
    const result = render(tab, size, fallback);
    const id = key(tab.path);
    if (canEdit(tab) && !cache.has(id) && !pending.has(id) && typeof apiFetch === 'function') {
      pending.add(id);
      const activeScope = scope();
      apiFetch('/file-icon?path=' + encodeURIComponent(tab.path), {silentError: true}).then(data => {
        if (scope() !== activeScope) return;
        cache.set(id, data.icon || '');
        refreshTabs();
      }).catch(() => { if (scope() === activeScope) cache.set(id, ''); }).finally(() => pending.delete(id));
    }
    return result;
  }
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
  global.MeldexFileIcons = {canEdit, remember, render, openPicker, tabIcon, readFields, writeFields, preserve, matchesScope};
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
