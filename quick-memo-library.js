(function () {
  'use strict';

  const PAGE_SIZE = 50;
  const CLOUD_FOLDER = 'クイックメモ';

  async function readWithTimeout(task, message, timeoutMs = 15000) {
    let timer;
    try {
      return await Promise.race([task, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })]);
    } finally {
      clearTimeout(timer);
    }
  }

  function parseJsonValue(raw) {
    try { return JSON.parse(raw); } catch (_) { return String(raw || '').replace(/^['"]|['"]$/g, ''); }
  }

  function splitFrontmatter(rawText) {
    const text = String(rawText || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (!text.startsWith('---\n')) return { frontmatter: {}, body: text };
    const end = text.indexOf('\n---\n', 4);
    if (end < 0) return { frontmatter: {}, body: text };
    const parser = window.MeldexCloudFrontmatterLite?.yamlLite;
    if (typeof parser === 'function') {
      return { frontmatter: parser(text.slice(4, end)), body: text.slice(end + 5) };
    }
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
    const drawingIndex = body.search(/<figure[^>]*class=["'][^"']*meldex-quick-memo-(?:drawing|audio)/i);
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

  function parseMemoText(rawText, path, etag = '') {
    const parsed = splitFrontmatter(rawText);
    const html = bodyHtml(parsed.body);
    const drawing = parsed.body.match(/<img[^>]+src=["'](data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+)["']/i);
    const tagsText = acceptedProperty(parsed.frontmatter, 'タグ');
    return {
      memo_id: String(parsed.frontmatter.quick_memo_id || parsed.frontmatter.id || path || ''),
      title: Object.hasOwn(parsed.frontmatter, 'quick_memo_title') ? String(parsed.frontmatter.quick_memo_title || '') : titleFromBody(parsed.body, String(path || '').split('/').pop()?.replace(/\.md$/i, '')),
      html,
      text: plainText(html),
      drawing_png: drawing ? drawing[1].replace(/\s+/g, '') : '',
      audio_clips: [...parsed.body.matchAll(/<audio[^>]+src=["'](data:audio\/(?:webm|mp4|mpeg|ogg|wav);base64,[A-Za-z0-9+/=]+)["']/gi)].map(match => match[1]),
      input_mode: String(parsed.frontmatter.quick_memo_input_mode || (drawing ? 'pen' : 'text')),
      tags: tagsText ? tagsText.split(/[,、]/).map((item) => item.trim()).filter(Boolean) : [],
      created_at: String(parsed.frontmatter.created || acceptedProperty(parsed.frontmatter, '追加日時') || ''),
      updated_at: String(parsed.frontmatter.modified || acceptedProperty(parsed.frontmatter, '更新日時') || ''),
      source_url: acceptedProperty(parsed.frontmatter, 'URL'),
      share_title: acceptedProperty(parsed.frontmatter, '共有タイトル'),
      source_label: acceptedProperty(parsed.frontmatter, '共有元'),
      server_path: String(path || ''),
      path: String(path || ''),
      quick_memo: parsed.frontmatter.quick_memo === true,
      cloud_etag: String(etag || ''),
    };
  }

  function normalizedPending(item) {
    const html = String(item.html || '');
    return {
      ...item,
      title: String(item.title || '').trim(),
      display_title: String(item.title || '').trim() || String(item.text || '').trim().split(/\r?\n/)[0] || (item.drawing_png ? '手書きメモ' : item.audio_clips?.length ? '音声メモ' : '無題のメモ'),
      preview: String(item.text || plainText(html)).slice(0, 160),
      pending: true,
      path: item.server_path || '',
    };
  }

  function normalizedSaved(item) {
    return {
      ...item,
      title: String(item.title || '').trim(),
      display_title: String(item.title || '').trim() || String(item.text || item.preview || '').trim().slice(0, 60) || (item.drawing_png ? '手書きメモ' : item.audio_clips?.length ? '音声メモ' : '無題のメモ'),
      preview: String(item.preview || item.text_preview || item.text || '').replace(/\s+/g, ' ').slice(0, 160),
      created_at: item.created_at || item.created || '',
      updated_at: item.updated_at || item.modified || '',
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
      openEpoch: 0,
      failedFiles: [],
      loadFailed: false,
      loadError: '',
      connectionRequired: false,
    };
    let loadEpoch = 0;

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
      title.textContent = item.display_title || item.title;
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
      const failedRead = state.loadFailed || state.failedFiles.length > 0;
      const failureMessage = state.loadFailed ? state.loadError
        : `${state.failedFiles.length}件のメモを読み込めませんでした。再試行してください`;
      if (!state.filtered.length) {
        const empty = document.createElement('div');
        empty.className = 'qm-list-empty';
        empty.textContent = state.loading ? (options.isCloudMode() ? 'Dropboxのメモを確認中…' : '読み込み中…')
          : failedRead ? failureMessage
            : state.connectionRequired ? 'Dropboxに接続すると保存済みのメモを表示できます。メニューから接続してください'
              : '該当するメモはありません';
        options.content.appendChild(empty);
      } else {
        state.filtered.forEach((item) => options.content.appendChild(createListItem(item)));
        if (failedRead || state.connectionRequired) {
          const message = document.createElement('div');
          message.className = 'qm-list-empty';
          message.setAttribute('role', 'status');
          message.textContent = failedRead ? failureMessage
            : 'Dropbox未接続です。端末に保存した送信待ちのメモを表示しています';
          options.content.appendChild(message);
        }
      }
      options.moreButton.hidden = state.nextOffset == null && !state.failedFiles.length && !state.loadFailed;
      options.moreButton.textContent = state.failedFiles.length || state.loadFailed ? '読み込みを再試行' : 'さらに読み込む';
      options.moreButton.disabled = state.loading;
    }

    function filter() {
      const query = options.search.value.trim().toLocaleLowerCase('ja');
      const tag = options.tagFilter.value;
      state.filtered = state.merged.filter((item) => {
        const searchable = `${item.title} ${item.search_text || item.text || item.preview} ${(item.tags || []).join(' ')}`.toLocaleLowerCase('ja');
        return (!query || searchable.includes(query)) && (!tag || (item.tags || []).includes(tag));
      });
      render();
    }

    async function localPage(reset, next, assertActive) {
      const query = new URLSearchParams({ offset: String(reset ? 0 : next.offset), limit: String(PAGE_SIZE) });
      const response = await fetch(`${options.apiBase}/api/quick-memo/list?${query}`);
      const payload = await response.json().catch(() => ({}));
      assertActive();
      if (!response.ok) throw new Error(payload.error || 'メモ一覧を読み込めませんでした');
      if (reset) next.saved = [];
      next.saved.push(...(Array.isArray(payload.memos) ? payload.memos : []));
      next.nextOffset = Number.isFinite(payload.next_offset) ? payload.next_offset : null;
      next.offset = next.nextOffset == null ? next.offset : next.nextOffset;
    }

    async function cloudPage(reset, next, assertActive) {
      if (reset) {
        const folder = await options.cloudFolderPath?.() || CLOUD_FOLDER;
        assertActive();
        const entries = await window.apiFetch('/quick-memo/files?path=' + encodeURIComponent(folder));
        assertActive();
        next.cloudFiles = (Array.isArray(entries) ? entries : [])
          .filter((item) => /\.md$/i.test(item.name || item.path || ''));
        next.saved = [];
        next.offset = 0;
        next.failedFiles = [];
      }
      const start = next.offset;
      const retrying = next.failedFiles.length > 0;
      const files = retrying ? next.failedFiles : next.cloudFiles.slice(start, start + PAGE_SIZE);
      next.failedFiles = [];
      const memos = [];
      for (let offset = 0; offset < files.length; offset += 6) {
        const batch = files.slice(offset, offset + 6);
        const results = await Promise.all(batch.map(async (item) => {
          try {
            const result = await window.apiFetch('/quick-memo/file?path=' + encodeURIComponent(item.path));
            assertActive();
            const memo = parseMemoText(result?.content ?? result, item.path, result?.etag);
            return memo.quick_memo ? memo : null;
          } catch (_) {
            next.failedFiles.push(item);
            return null;
          }
        }));
        assertActive();
        memos.push(...results.filter(Boolean));
      }
      next.saved.push(...memos);
      const end = retrying ? start : start + files.length;
      next.nextOffset = end < next.cloudFiles.length ? end : null;
      next.offset = next.nextOffset == null ? end : next.nextOffset;
    }

    async function load(reset) {
      if (state.loading) return;
      const epoch = ++loadEpoch;
      let active = true;
      const assertActive = () => {
        if (!active || epoch !== loadEpoch) throw new Error('メモ一覧の読込を中止しました');
      };
      state.loading = true;
      state.loadFailed = false;
      state.loadError = '';
      state.connectionRequired = options.isCloudMode() && !options.cloudConnected();
      if (state.connectionRequired) {
        state.saved = [];
        state.nextOffset = null;
        state.failedFiles = [];
      }
      // Remote reads must never hide the device's pending notes.
      mergeItems();
      const next = { ...state, saved: [...state.saved], failedFiles: [...state.failedFiles] };
      try {
        const read = state.connectionRequired ? Promise.resolve()
          : options.isCloudMode() ? cloudPage(reset, next, assertActive) : localPage(reset, next, assertActive);
        await readWithTimeout(read, 'メモ一覧の読込に時間がかかっています。端末の入力は保持しています。接続と保存先を確認して再試行してください', options.readTimeoutMs);
        assertActive();
        Object.assign(state, { saved: next.saved, cloudFiles: next.cloudFiles,
          failedFiles: next.failedFiles, offset: next.offset, nextOffset: next.nextOffset });
        state.loading = false;
        mergeItems();
        if (state.failedFiles.length) options.onStatus?.(`${state.failedFiles.length}件のメモを読み込めませんでした。再試行してください`, true);
      } catch (error) {
        if (epoch !== loadEpoch) return;
        state.loading = false;
        state.loadFailed = true;
        state.loadError = String(options.formatError?.(error) || error?.message || error).replace(/\s+/g, ' ').slice(0, 240);
        mergeItems();
        options.onStatus?.(state.loadError, true);
      } finally {
        active = false;
      }
    }

    async function openItem(item, button) {
      const epoch = ++state.openEpoch;
      button.disabled = true;
      try {
        await options.beforeNavigate?.();
        let memo = item;
        if (!item.pending && options.isCloudMode()) {
          const result = await readWithTimeout(window.apiFetch('/quick-memo/file?path=' + encodeURIComponent(item.path)),
            'メモを開くのに時間がかかっています。接続を確認してメモをもう一度選んでください', options.readTimeoutMs);
          memo = parseMemoText(result?.content ?? result, item.path, result?.etag);
        } else if (!item.pending) {
          const query = new URLSearchParams({ path: item.path || '', memo_id: item.memo_id || '' });
          const payload = await readWithTimeout((async () => {
            const response = await fetch(`${options.apiBase}/api/quick-memo/item?${query}`);
            const value = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(value.error || 'メモを開けませんでした');
            return value;
          })(), 'メモを読み込めません。接続を確認してもう一度選んでください', options.readTimeoutMs);
          memo = payload.memo || payload;
        }
        if (epoch !== state.openEpoch) return;
        await options.onOpen?.(memo, undefined, () => epoch === state.openEpoch);
      } catch (error) {
        if (epoch === state.openEpoch) {
          state.loadFailed = true;
          state.loadError = String(options.formatError?.(error) || error?.message || error).replace(/\s+/g, ' ').slice(0, 240);
          render();
          options.onStatus?.(state.loadError, true);
        }
      } finally {
        button.disabled = false;
      }
    }

    async function show() {
      await options.beforeNavigate?.();
      options.editorView.style.display = 'none';
      options.listView.style.display = '';
      options.search.focus();
      await load(true);
    }

    function hide() {
      state.openEpoch += 1;
      loadEpoch += 1;
      state.loading = false;
      options.listView.style.display = 'none';
      options.editorView.style.display = '';
    }

    options.search.addEventListener('input', filter);
    options.tagFilter.addEventListener('change', filter);
    options.moreButton.addEventListener('click', () => load(state.loadFailed));
    options.backButton.addEventListener('click', hide);
    return { show, hide, refresh: () => load(true), parseMemoText };
  }

  window.MeldexQuickMemoLibrary = { create, parseMemoText, splitFrontmatter, readWithTimeout };
})();
