(function () {
  'use strict';

  const PAGE_SIZE = 50;
  const CLOUD_FOLDER = 'クイックメモ';

  function parseJsonValue(raw) {
    try { return JSON.parse(raw); } catch (_) { return String(raw || '').replace(/^['"]|['"]$/g, ''); }
  }

  function splitFrontmatter(rawText) {
    const text = String(rawText || '').replace(/\r\n?/g, '\n');
    if (!text.startsWith('---\n')) return { frontmatter: {}, body: text };
    const end = text.indexOf('\n---\n', 4);
    if (end < 0) return { frontmatter: {}, body: text };
    const frontmatter = {};
    text.slice(4, end).split('\n').forEach((line) => {
      const colon = line.indexOf(':');
      if (colon <= 0) return;
      frontmatter[line.slice(0, colon).trim()] = parseJsonValue(line.slice(colon + 1).trim());
    });
    return { frontmatter, body: text.slice(end + 5) };
  }

  function acceptedProperty(frontmatter, name) {
    const values = frontmatter?.properties?.[name];
    if (!Array.isArray(values)) return '';
    const accepted = values.find((item) => item?.status === '採用') || values[0];
    return String(accepted?.value || '').trim();
  }

  function bodyHtml(body) {
    const marker = '<div class="meldex-quick-memo-body">';
    const markerIndex = body.indexOf(marker);
    const drawingIndex = body.search(/<figure[^>]*class=["'][^"']*meldex-quick-memo-drawing/i);
    if (markerIndex >= 0) {
      const start = markerIndex + marker.length;
      const section = body.slice(start, drawingIndex >= start ? drawingIndex : undefined);
      const end = section.lastIndexOf('</div>');
      return (end >= 0 ? section.slice(0, end) : section).trim();
    }
    let legacy = body.replace(/^# .+?(?:\n|$)/, '');
    legacy = legacy.replace(/<p class=["']meldex-quick-memo-share[^>]*>[\s\S]*?<\/p>/gi, '');
    legacy = legacy.replace(/<figure[\s\S]*?<\/figure>/gi, '');
    return legacy.trim();
  }

  function plainText(html) {
    const element = document.createElement('div');
    element.innerHTML = String(html || '');
    return (element.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function titleFromBody(body, fallback) {
    const match = String(body || '').match(/^#\s+(.+)$/m);
    return (match?.[1] || fallback || '無題のメモ').trim();
  }

  function parseMemoText(rawText, path) {
    const parsed = splitFrontmatter(rawText);
    const html = bodyHtml(parsed.body);
    const drawing = parsed.body.match(/<img[^>]+src=["'](data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+)["']/i);
    const tagsText = acceptedProperty(parsed.frontmatter, 'タグ');
    return {
      memo_id: String(parsed.frontmatter.quick_memo_id || parsed.frontmatter.id || path || ''),
      title: titleFromBody(parsed.body, String(path || '').split('/').pop()?.replace(/\.md$/i, '')),
      html,
      text: plainText(html),
      drawing_png: drawing ? drawing[1].replace(/\s+/g, '') : '',
      tags: tagsText ? tagsText.split(/[,、]/).map((item) => item.trim()).filter(Boolean) : [],
      created_at: String(parsed.frontmatter.created || acceptedProperty(parsed.frontmatter, '追加日時') || ''),
      updated_at: String(parsed.frontmatter.modified || acceptedProperty(parsed.frontmatter, '更新日時') || ''),
      source_url: acceptedProperty(parsed.frontmatter, 'URL'),
      share_title: acceptedProperty(parsed.frontmatter, '共有タイトル'),
      source_label: acceptedProperty(parsed.frontmatter, '共有元'),
      server_path: String(path || ''),
      path: String(path || ''),
      quick_memo: parsed.frontmatter.quick_memo === true,
    };
  }

  function normalizedPending(item) {
    const html = String(item.html || '');
    return {
      ...item,
      title: String(item.title || '').trim() || String(item.text || '').trim().split(/\r?\n/)[0] || '無題のメモ',
      preview: String(item.text || plainText(html)).slice(0, 160),
      pending: true,
      path: item.server_path || '',
    };
  }

  function normalizedSaved(item) {
    return {
      ...item,
      title: String(item.title || '').trim() || '無題のメモ',
      preview: String(item.preview || item.text || '').replace(/\s+/g, ' ').slice(0, 160),
      pending: false,
      tags: Array.isArray(item.tags) ? item.tags : [],
    };
  }

  function formatDate(value) {
    if (!String(value || '').trim()) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  }

  function create(options) {
    const state = {
      saved: [],
      merged: [],
      filtered: [],
      offset: 0,
      nextOffset: null,
      loading: false,
      cloudFiles: [],
    };

    function pendingItems() {
      const queue = options.readQueue?.();
      return (Array.isArray(queue) ? queue : []).map(normalizedPending);
    }

    function mergeItems() {
      const byId = new Map();
      state.saved.map(normalizedSaved).forEach((item) => {
        byId.set(String(item.memo_id || item.path), item);
      });
      pendingItems().forEach((item) => {
        byId.set(String(item.memo_id || item.path), item);
      });
      state.merged = [...byId.values()].sort((a, b) => {
        return String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''));
      });
      updateTagFilter();
      filter();
    }

    function updateTagFilter() {
      const selected = options.tagFilter.value;
      const tags = [...new Set(state.merged.flatMap((item) => item.tags || []))].sort((a, b) => a.localeCompare(b, 'ja'));
      options.tagFilter.replaceChildren(new Option('すべてのタグ', ''));
      tags.forEach((tag) => options.tagFilter.appendChild(new Option(tag, tag)));
      options.tagFilter.value = tags.includes(selected) ? selected : '';
    }

    function createListItem(item) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'qm-list-item';
      const title = document.createElement('div');
      title.className = 'qm-list-item-title';
      title.textContent = item.title;
      const preview = document.createElement('div');
      preview.className = 'qm-list-item-preview';
      preview.textContent = item.preview || '本文なし';
      const meta = document.createElement('div');
      meta.className = 'qm-list-item-meta';
      const date = document.createElement('span');
      date.textContent = formatDate(item.updated_at || item.created_at);
      const tags = document.createElement('span');
      tags.className = 'qm-list-item-tags';
      (item.tags || []).slice(0, 5).forEach((tag) => {
        const chip = document.createElement('span');
        chip.className = 'qm-list-tag';
        chip.textContent = tag;
        tags.appendChild(chip);
      });
      meta.append(date, tags);
      if (item.pending) {
        const status = document.createElement('span');
        status.className = 'qm-list-state';
        status.textContent = '送信待ち';
        meta.appendChild(status);
      }
      button.append(title, preview, meta);
      button.addEventListener('click', () => openItem(item, button));
      return button;
    }

    function render() {
      options.content.replaceChildren();
      if (!state.filtered.length) {
        const empty = document.createElement('div');
        empty.className = 'qm-list-empty';
        empty.textContent = state.loading ? '読み込み中…' : '該当するメモはありません';
        options.content.appendChild(empty);
      } else {
        state.filtered.forEach((item) => options.content.appendChild(createListItem(item)));
      }
      options.moreButton.hidden = state.nextOffset == null;
      options.moreButton.disabled = state.loading;
    }

    function filter() {
      const query = options.search.value.trim().toLocaleLowerCase('ja');
      const tag = options.tagFilter.value;
      state.filtered = state.merged.filter((item) => {
        const searchable = `${item.title} ${item.preview} ${(item.tags || []).join(' ')}`.toLocaleLowerCase('ja');
        return (!query || searchable.includes(query)) && (!tag || (item.tags || []).includes(tag));
      });
      render();
    }

    async function localPage(reset) {
      if (reset) {
        state.saved = [];
        state.offset = 0;
      }
      const query = new URLSearchParams({ offset: String(state.offset), limit: String(PAGE_SIZE) });
      const response = await fetch(`${options.apiBase}/api/quick-memo/list?${query}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'メモ一覧を読み込めませんでした');
      state.saved.push(...(Array.isArray(payload.memos) ? payload.memos : []));
      state.nextOffset = Number.isFinite(payload.next_offset) ? payload.next_offset : null;
      state.offset = state.nextOffset == null ? state.offset : state.nextOffset;
    }

    async function cloudPage(reset) {
      if (reset) {
        const entries = await window.MeldexStandaloneCloud.browse(CLOUD_FOLDER, { detail: false });
        state.cloudFiles = (Array.isArray(entries) ? entries : [])
          .filter((item) => /\.md$/i.test(item.name || item.path || ''));
        state.saved = [];
        state.offset = 0;
      }
      const start = state.offset;
      const files = state.cloudFiles.slice(start, start + PAGE_SIZE);
      const memos = [];
      for (let offset = 0; offset < files.length; offset += 6) {
        const batch = files.slice(offset, offset + 6);
        const results = await Promise.all(batch.map(async (item) => {
          try {
            const result = await window.MeldexStandaloneCloud.readText(item.path);
            return parseMemoText(result?.content ?? result, item.path);
          } catch (_) {
            return null;
          }
        }));
        memos.push(...results.filter(Boolean));
      }
      state.saved.push(...memos);
      const end = start + files.length;
      state.nextOffset = end < state.cloudFiles.length ? end : null;
      state.offset = state.nextOffset == null ? end : state.nextOffset;
    }

    async function load(reset) {
      if (state.loading) return;
      state.loading = true;
      render();
      try {
        if (options.isCloudMode() && options.cloudConnected()) await cloudPage(reset);
        else if (!options.isCloudMode()) await localPage(reset);
        state.loading = false;
        mergeItems();
      } catch (error) {
        state.loading = false;
        mergeItems();
        options.onStatus?.(String(error?.message || error), true);
      }
    }

    async function openItem(item, button) {
      button.disabled = true;
      try {
        await options.beforeNavigate?.();
        let memo = item;
        if (!item.pending && options.isCloudMode()) {
          const result = await window.MeldexStandaloneCloud.readText(item.path);
          memo = parseMemoText(result?.content ?? result, item.path);
        } else if (!item.pending) {
          const query = new URLSearchParams({ path: item.path || '', memo_id: item.memo_id || '' });
          const response = await fetch(`${options.apiBase}/api/quick-memo/item?${query}`);
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error || 'メモを開けませんでした');
          memo = payload.memo || payload;
        }
        await options.onOpen?.(memo);
      } catch (error) {
        button.disabled = false;
        options.onStatus?.(String(error?.message || error), true);
      }
    }

    async function show() {
      await options.beforeNavigate?.();
      options.editorView.style.display = 'none';
      options.listView.style.display = '';
      await load(true);
      options.search.focus();
    }

    function hide() {
      options.listView.style.display = 'none';
      options.editorView.style.display = '';
    }

    options.search.addEventListener('input', filter);
    options.tagFilter.addEventListener('change', filter);
    options.moreButton.addEventListener('click', () => load(false));
    options.backButton.addEventListener('click', hide);
    return { show, hide, refresh: () => load(true), parseMemoText };
  }

  window.MeldexQuickMemoLibrary = { create, parseMemoText, splitFrontmatter };
})();
