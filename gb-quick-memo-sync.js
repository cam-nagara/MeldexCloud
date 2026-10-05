(function () {
  'use strict';

  const QUEUE_KEY = 'meldex:quick-memo:queue:v1';
  const CURRENT_KEY = 'meldex:quick-memo:current:v1';
  let syncing = false;

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  }

  function signature(item) { return JSON.stringify(item); }

  function notFound(error) {
    const status = Number(error?.status || error?.status_code || 0);
    if (status) return status === 404;
    return /^(not_found|path\/not_found)$/.test(String(error?.code || error?.message || ''));
  }

  // 更新対象以外のYAMLブロックをそのまま保ち、未知の列や将来フィールドを落とさない。
  function patchMapping(raw, updates, indent = 0) {
    const lines = String(raw).split(/(?<=\n)/);
    const pattern = new RegExp('^' + ' '.repeat(indent) + '([^\\s:#][^:]*):');
    const starts = [];
    lines.forEach((line, index) => { const match = line.match(pattern); if (match) starts.push({ index, key: match[1].trim() }); });
    let output = lines.slice(0, starts[0]?.index ?? lines.length).join('');
    const seen = new Set();
    starts.forEach((start, index) => {
      const block = lines.slice(start.index, starts[index + 1]?.index ?? lines.length).join('');
      if (!Object.hasOwn(updates, start.key)) { output += block; return; }
      seen.add(start.key);
      if (start.key === 'properties' && /^properties:\s*(?:\r?\n|$)/.test(block)) {
        const tail = block.slice(block.indexOf('\n') + 1);
        const childIndent = tail.match(/^( +)\S[^:]*:/m)?.[1]?.length || 2;
        output += 'properties:\n' + patchMapping(tail, updates.properties, childIndent);
      } else output += ' '.repeat(indent) + start.key + ': ' + jsonValue(updates[start.key]) + '\n';
    });
    Object.entries(updates).forEach(([key, value]) => {
      if (seen.has(key)) return;
      if (output && !output.endsWith('\n')) output += '\n';
      output += ' '.repeat(indent) + key + ': ' + jsonValue(value) + '\n';
    });
    return output;
  }

  function jsonFetch(path, opts) {
    const options = opts || {};
    return apiFetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function jsonValue(value) {
    return JSON.stringify(value == null ? '' : value);
  }

  function frontmatterText(frontmatter, body) {
    const lines = ['---'];
    Object.entries(frontmatter || {}).forEach(([key, value]) => {
      if (!key || key.startsWith('_')) return;
      lines.push(`${key}: ${jsonValue(value)}`);
    });
    lines.push('---', '');
    return lines.join('\n') + String(body || '').replace(/\s+$/, '') + '\n';
  }

  function candidate(value) {
    return { value: String(value || ''), status: '採用', created: nowIso() };
  }

  function tagsValue(tags) {
    if (Array.isArray(tags)) return tags.map((tag) => String(tag || '').trim()).filter(Boolean).join(', ');
    return String(tags || '').trim();
  }

  function safeFileStem(value, fallback) {
    const text = String(value || fallback || 'クイックメモ')
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 96);
    return text || fallback || 'クイックメモ';
  }

  function targetSheetPath(item) {
    const raw = String(item?.target_sheet || '').replace(/\\/g, '/').trim();
    const clean = raw
      .split('/')
      .map(part => safeFileStem(part, '').trim())
      .filter(Boolean)
      .join('/');
    const path = clean || 'クイックメモ';
    if (path.startsWith('__dropbox_root__/')) return path;
    const savedRoot = String(item?.server_path || '').match(/^__dropbox_root__\/[^/]+/)?.[0];
    const root = savedRoot || window.MeldexStandaloneCloud?.getStatus?.().activeRoot?.path;
    return root ? String(root).replace(/\/$/, '') + '/' + path : path;
  }

  function targetSheetName(item) {
    const path = targetSheetPath(item);
    return path.split('/').filter(Boolean).pop() || 'クイックメモ';
  }

  function memoTitle(item) {
    const title = String(item?.title || '').trim();
    if (title) return safeFileStem(title, 'メモ');
    const first = String(item?.text || '').trim().split(/\r?\n/)[0] || '';
    return safeFileStem(first || 'メモ ' + String(item?.updated_at || nowIso()).slice(0, 16).replace('T', ' '), 'メモ');
  }

  function memoPath(item) {
    if (item.server_path || item.path) return String(item.server_path || item.path).replace(/\\/g, '/');
    const stamp = String(item.created_at || nowIso()).replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '_').slice(0, 15);
    const id = String(item.memo_id || item.client_id || Date.now()).replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
    return `${targetSheetPath(item)}/${safeFileStem(stamp + '_' + memoTitle(item) + '_' + id, 'メモ')}.md`;
  }

  function sanitizeHtml(fragment) {
    const template = document.createElement('template');
    template.innerHTML = String(fragment || '');
    template.content.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((node) => node.remove());
    template.content.querySelectorAll('*').forEach((node) => {
      [...node.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = attr.value || '';
        if (name.startsWith('on')) node.removeAttribute(attr.name);
        if ((name === 'href' || name === 'src') && /^(javascript|data:text)/i.test(value)) node.removeAttribute(attr.name);
      });
    });
    return template.innerHTML;
  }

  function safeDrawing(value) {
    const text = String(value || '').trim();
    return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(text) ? text.replace(/\s+/g, '') : '';
  }

  function memoBody(item) {
    const title = memoTitle(item);
    const html = sanitizeHtml(item.html || '');
    const text = String(item.text || '').trim();
    const drawing = safeDrawing(item.drawing_png || item.drawing || '');
    const parts = [`# ${title}`, ''];
    if (html) {
      parts.push('<div class="meldex-quick-memo-body">', html, '</div>', '');
    } else if (text) {
      parts.push(MeldexEscape.html(text).replace(/\n/g, '<br>'), '');
    }
    if (drawing) {
      parts.push('<figure class="meldex-quick-memo-drawing">', `<img alt="手書きメモ" src="${drawing}">`, '</figure>', '');
    }
    return parts.join('\n');
  }

  function memoFrontmatter(item, path) {
    const created = String(item.created_at || nowIso());
    const updated = String(item.updated_at || nowIso());
    const properties = {
      種別: [candidate('メモ')],
      タグ: [candidate(tagsValue(item.tags))],
      追加日時: [candidate(created)],
      更新日時: [candidate(updated)],
      保存先: [candidate(path)],
      メモID: [candidate(String(item.memo_id || item.client_id || ''))],
    };
    if (item.source_url) properties.URL = [candidate(item.source_url)];
    if (item.share_title) properties.共有タイトル = [candidate(item.share_title)];
    if (item.source_label) properties.共有元 = [candidate(item.source_label)];
    return {
      type: 'settings-entry',
      id: 'ent_' + String(item.memo_id || item.client_id || Date.now()).replace(/[^A-Za-z0-9]/g, '').slice(0, 12),
      category: targetSheetName(item),
      quick_memo: true,
      quick_memo_id: String(item.memo_id || item.client_id || ''),
      created,
      modified: updated,
      source_url: String(item.source_url || ''),
      share_title: String(item.share_title || ''),
      source_label: String(item.source_label || ''),
      target_sheet: targetSheetPath(item),
      properties,
      relations: [],
    };
  }

  function quickMemoViewConfig(current) {
    const config = current && typeof current === 'object' ? { ...current } : {};
    const views = Array.isArray(config.savedViews) ? config.savedViews.map(view => ({ ...view })) : [];
    if (!views.some(view => view.id === 'quick-memo-default')) {
      views.unshift({
        id: 'quick-memo-default', name: 'クイックメモ', viewMode: 'pivot',
        sortConfig: { key: '更新日時', dir: 'desc' },
        colOrder: ['種別', 'タグ', '追加日時', '更新日時', '保存先', 'メモID', 'URL', '共有タイトル', '共有元'],
        advancedFilters: [{ property: '種別', field: 'value', operator: 'equals', value: 'メモ' }],
        systemManaged: true,
      });
    }
    config.savedViews = views;
    if (!Number.isInteger(config.currentViewIdx)) config.currentViewIdx = 0;
    return config;
  }

  async function ensureMemoWorkspace(item = {}) {
    const sheetPath = targetSheetPath(item);
    const sheetName = targetSheetName(item);
    const parent = sheetPath.includes('/') ? sheetPath.split('/').slice(0, -1).join('/') : '';
    try {
      await apiFetch('/file?path=' + encodeURIComponent(`${sheetPath}/${sheetName}.md`), { silentError: true });
    } catch (error) {
      if (!notFound(error)) throw error;
      await jsonFetch('/outliner/add', {
        method: 'POST',
        silentError: true,
        body: JSON.stringify({ parent, label: sheetName, type: 'database' }),
      });
    }
    const defaults = {
      種別: { type: 'select', options: ['メモ'] }, タグ: { type: 'multi-select', options: [] },
      追加日時: { type: 'date', withTime: true }, 更新日時: { type: 'date', withTime: true },
      保存先: { type: 'text' }, メモID: { type: 'text' }, URL: { type: 'url' },
      共有タイトル: { type: 'text' }, 共有元: { type: 'text' },
    };
    const existing = await apiFetch('/db-metadata?path=' + encodeURIComponent(sheetPath), { silentError: true });
    const existingTypes = existing?.property_types || existing?.propertyTypes || {};
    await jsonFetch('/db-metadata?path=' + encodeURIComponent(sheetPath), {
      method: 'PUT',
      silentError: true,
      body: JSON.stringify({
        type: 'settings-db',
        storage: 'sqlite',
        cloud_storage: 'sheet-store-v1',
        property_types: { ...defaults, ...existingTypes },
        view_config: quickMemoViewConfig(existing?.view_config || existing?.viewConfig),
      }),
    });
  }

  async function saveViaExistingApis(item) {
    await ensureMemoWorkspace(item);
    const path = memoPath(item);
    const frontmatter = memoFrontmatter(item, path);
    let existing = null;
    try { existing = await apiFetch('/file?path=' + encodeURIComponent(path), { silentError: true }); }
    catch (error) { if (!notFound(error)) throw error; }
    let content = frontmatterText(frontmatter, memoBody(item));
    if (existing) {
      if (!existing.etag) throw new Error('既存メモの更新情報を確認できません');
      if (item.cloud_etag && item.cloud_etag !== existing.etag) throw new Error('クイックメモが別の画面で変更されています');
      const match = String(existing.content || '').match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      const parser = window.MeldexCloudFrontmatterLite?.yamlLite;
      if (!match || !parser) throw new Error('既存メモの追加情報を安全に読み取れません');
      const previous = parser(match[1]);
      if (previous.quick_memo !== true || previous.quick_memo_id !== item.memo_id) throw new Error('保存先は別のメモです');
      delete frontmatter.id;
      delete frontmatter.created;
      delete frontmatter.relations;
      const properties = frontmatter.properties;
      // Inline辞書は未知の列を含め、ブロック辞書は更新列だけを置換する。
      if (/^properties:\s*\S/m.test(match[1])) frontmatter.properties = { ...(previous.properties || {}), ...properties };
      content = '---\n' + patchMapping(match[1], frontmatter) + '---\n\n' + memoBody(item);
    }
    const written = await jsonFetch('/file?path=' + encodeURIComponent(path), {
      method: 'POST',
      silentError: true,
      body: JSON.stringify({ content, ...(existing ? { if_match_etag: existing.etag } : { create_only: true }) }),
    });
    item.server_path = path;
    return { ok: true, path, target_sheet: targetSheetPath(item), cloud_etag: written?.etag || '' };
  }

  async function saveItem(item) {
    try {
      const result = await jsonFetch('/quick-memo', {
        method: 'POST',
        silentError: true,
        body: JSON.stringify(item),
      });
      if (result?.ok) return result;
      throw new Error('クイックメモの保存を確認できませんでした');
    } catch (error) {
      // 権限、ロック、競合、通信失敗を別の書込APIで迂回しない。
      if (![404, 405, 501].includes(Number(error?.status || error?.status_code || 0))) throw error;
    }
    return saveViaExistingApis(item);
  }

  async function syncQueue() {
    if (navigator.locks?.request) return navigator.locks.request('meldex:quick-memo:sync', syncQueueUnlocked);
    return syncQueueUnlocked();
  }

  async function syncQueueUnlocked() {
    if (syncing || typeof apiFetch !== 'function') return false;
    const queue = readJson(QUEUE_KEY, []);
    if (!Array.isArray(queue) || !queue.length) return true;
    syncing = true;
    const sent = new Map();
    try {
      for (const raw of queue) {
        const item = raw && typeof raw === 'object' ? { ...raw } : null;
        if (!item) continue;
        try {
          const result = await saveItem(item);
          sent.set(item.memo_id, { signature: signature(raw), result });
          const current = readJson(CURRENT_KEY, {});
          if (current?.memo_id === item.memo_id) {
            current.server_path = result.path || item.server_path || current.server_path || '';
            if (Array.isArray(result.tags) && current.updated_at === item.updated_at) current.tags = result.tags;
            current.version_path = result.version_path || current.version_path || current.server_path;
            current.version_type = result.version_type || current.version_type || 'file';
            if (result.memo_revision) current.memo_revision = result.memo_revision;
            if (result.cloud_etag) current.cloud_etag = result.cloud_etag;
            delete current.auto_tag;
            writeJson(CURRENT_KEY, current);
          }
        } catch {}
      }
      const latest = readJson(QUEUE_KEY, []);
      const remaining = (Array.isArray(latest) ? latest : []).filter(item => {
        const saved = sent.get(item?.memo_id);
        return !saved || signature(item) !== saved.signature;
      });
      remaining.forEach(item => {
        const saved = sent.get(item.memo_id);
        if (saved) {
          item.server_path = saved.result.path || item.server_path || '';
          if (saved.result.memo_revision) item.memo_revision = saved.result.memo_revision;
          if (saved.result.cloud_etag) item.cloud_etag = saved.result.cloud_etag;
        }
      });
      return writeJson(QUEUE_KEY, remaining) && remaining.length === 0;
    } finally {
      syncing = false;
    }
  }

  window.MeldexQuickMemoSync = Object.freeze({ syncQueue });
  window.addEventListener('online', () => syncQueue());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncQueue();
  });
  setTimeout(() => syncQueue(), 2500);
})();
