(function () {
  'use strict';

  const QUEUE_KEY = 'meldex:quick-memo:queue:v1';
  const CURRENT_KEY = 'meldex:quick-memo:current:v1';
  const NEVER = '__MELDEX_QUICK_MEMO_NEVER__';
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
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
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
    return clean || 'クイックメモ';
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
      parts.push(text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>'), '');
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

  function smartDbDefinition(sheetPath = 'クイックメモ') {
    const name = sheetPath.split('/').filter(Boolean).pop() || 'クイックメモ';
    return {
      type: 'smart-db',
      id: 'file:' + name + '.smart-db.json',
      name,
      sourceType: 'db-entities',
      filters: [
        { property: '種別', field: 'value', operator: 'equals', value: 'メモ' },
        { property: 'タグ', field: 'value', operator: 'not_contains', value: NEVER },
        { property: '追加日時', field: 'value', operator: 'not_contains', value: NEVER },
        { property: '更新日時', field: 'value', operator: 'not_contains', value: NEVER },
        { property: '保存先', field: 'value', operator: 'not_contains', value: NEVER },
      ],
      views: { table: {}, dashboard: { widgets: [] } },
      activeView: 'table',
      created: nowIso(),
    };
  }

  async function ensureMemoWorkspace(item = {}) {
    const sheetPath = targetSheetPath(item);
    const sheetName = targetSheetName(item);
    const parent = sheetPath.includes('/') ? sheetPath.split('/').slice(0, -1).join('/') : '';
    try {
      await apiFetch('/file?path=' + encodeURIComponent(`${sheetPath}/${sheetName}.md`), { silentError: true });
    } catch {
      await jsonFetch('/outliner/add', {
        method: 'POST',
        silentError: true,
        body: JSON.stringify({ parent, label: sheetName, type: 'database' }),
      }).catch(() => undefined);
    }
    await jsonFetch('/db-metadata?path=' + encodeURIComponent(sheetPath), {
      method: 'PUT',
      silentError: true,
      body: JSON.stringify({
        type: 'settings-db',
        storage: 'sqlite',
        cloud_storage: 'sheet-store-v1',
        property_types: {
          種別: { type: 'select', options: ['メモ'] },
          タグ: { type: 'multi-select', options: [] },
          追加日時: { type: 'date', withTime: true },
          更新日時: { type: 'date', withTime: true },
          保存先: { type: 'text' },
          メモID: { type: 'text' },
          URL: { type: 'url' },
          共有タイトル: { type: 'text' },
          共有元: { type: 'text' },
        },
      }),
    });
    if (sheetPath !== 'クイックメモ') return;
    try {
      await apiFetch('/file?path=' + encodeURIComponent('クイックメモ.smart-db.json'), { silentError: true });
    } catch {
      await jsonFetch('/file?path=' + encodeURIComponent('クイックメモ.smart-db.json'), {
        method: 'POST',
        silentError: true,
        body: JSON.stringify({ content: JSON.stringify(smartDbDefinition(sheetPath), null, 2) }),
      });
    }
  }

  async function saveViaExistingApis(item) {
    await ensureMemoWorkspace(item);
    const path = memoPath(item);
    const frontmatter = memoFrontmatter(item, path);
    if (!item.server_path && !item.path) {
      try {
        const created = await jsonFetch('/entity/create', {
          method: 'POST',
          silentError: true,
          body: JSON.stringify({
            parent_path: targetSheetPath(item),
            name: path.split('/').pop().replace(/\.md$/i, ''),
            properties: frontmatter.properties,
            source: 'quick-memo',
            reviewed: true,
          }),
        });
        const createdPath = created?.path || path;
        await jsonFetch('/value?path=' + encodeURIComponent(createdPath), {
          method: 'PUT',
          silentError: true,
          body: JSON.stringify({ new_body: memoBody(item) }),
        });
        item.server_path = createdPath;
        return { ok: true, path: createdPath, target_sheet: targetSheetPath(item) };
      } catch {}
    }
    const content = frontmatterText(frontmatter, memoBody(item));
    await jsonFetch('/file?path=' + encodeURIComponent(path), {
      method: 'POST',
      silentError: true,
      body: JSON.stringify({ content }),
    });
    item.server_path = path;
    return { ok: true, path, target_sheet: targetSheetPath(item) };
  }

  async function saveItem(item) {
    try {
      const result = await jsonFetch('/quick-memo', {
        method: 'POST',
        silentError: true,
        body: JSON.stringify(item),
      });
      if (result?.ok) return result;
    } catch {}
    return saveViaExistingApis(item);
  }

  async function syncQueue() {
    if (syncing || typeof apiFetch !== 'function') return false;
    const queue = readJson(QUEUE_KEY, []);
    if (!Array.isArray(queue) || !queue.length) return true;
    syncing = true;
    const remaining = [];
    try {
      for (const raw of queue) {
        const item = raw && typeof raw === 'object' ? { ...raw } : null;
        if (!item) continue;
        try {
          const result = await saveItem(item);
          const current = readJson(CURRENT_KEY, {});
          if (current?.memo_id === item.memo_id) {
            current.server_path = result.path || item.server_path || current.server_path || '';
            if (Array.isArray(result.tags)) current.tags = result.tags;
            delete current.auto_tag;
            writeJson(CURRENT_KEY, current);
          }
        } catch {
          remaining.push(raw);
        }
      }
      writeJson(QUEUE_KEY, remaining);
      return remaining.length === 0;
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
