/* Read-only topic body previews shared by card and timeline views. */
(function () {
  'use strict';
  const LIMIT = 200;
  const pending = new Map();
  const queue = [];
  let active = 0;
  const observed = new Set();
  let observer = null;
  let cleanupScheduled = false;

  function observe(row) {
    if (!observer) {
      observer = new IntersectionObserver(entries => {
        entries.filter(entry => entry.isIntersecting).forEach(entry => {
          observer.unobserve(entry.target);
          observed.delete(entry.target);
          entry.target._refreshBodyExcerpt?.();
        });
      });
      new MutationObserver(() => {
        if (!observed.size || cleanupScheduled) return;
        cleanupScheduled = true;
        requestAnimationFrame(() => {
          cleanupScheduled = false;
          for (const target of observed) if (!target.isConnected) {
            observer.unobserve(target);
            observed.delete(target);
          }
        });
      }).observe(document.body, { childList: true, subtree: true });
    }
    observed.add(row);
    observer.observe(row);
  }

  function scope() {
    return JSON.stringify([window.MeldexRuntimeAdapter?.getMode?.(),
      window.MeldexRuntimeAdapter?.getWorkspaceState?.()]);
  }

  function take(text) { return Array.from(String(text || '')).slice(0, LIMIT).join(''); }

  function plain(raw) {
    let text = String(raw || '').replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
    const template = document.createElement('template');
    template.innerHTML = text.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/(?:p|div|li|h[1-6])>/gi, '\n');
    template.content.querySelectorAll('script,style,iframe,object').forEach(el => el.remove());
    text = template.content.textContent || '';
    return text.replace(/^\s*```[^\n]*\n|^\s*```\s*$/gm, '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+)/gm, '')
      .replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim();
  }

  function pump() {
    while (active < 4 && queue.length) {
      const job = queue.shift();
      active++;
      Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => { active--; pump(); });
    }
  }

  function request(path) {
    const requestedScope = scope();
    return new Promise((resolve, reject) => {
      queue.push({ resolve, reject, run: () => {
        if (scope() !== requestedScope) throw new Error('保存先が変わりました。ビューを開き直してください');
        return Promise.resolve(apiFetch(path, { silentError: true })).then(result => {
          if (scope() !== requestedScope) throw new Error('保存先が変わりました。ビューを開き直してください');
          return result;
        });
      } });
      pump();
    });
  }

  function sheetText(data) {
    const parts = [];
    for (const [name, entry] of Object.entries(data?.entities || {})) {
      parts.push(name);
      for (const [prop, values] of Object.entries(entry || {})) {
        if (prop.startsWith('_') || !Array.isArray(values)) continue;
        parts.push(values.map(value => plain(value.rich_html || value.value || '')).filter(Boolean).join(' '));
      }
      if (Array.from(parts.join(' ')).length >= LIMIT) break;
    }
    return parts.filter(Boolean).join(' ');
  }

  async function read(path) {
    const data = await request('/entity?path=' + encodeURIComponent(path));
    const parts = [plain(data?.page_content || '')].filter(Boolean);
    if (Array.from(parts.join(' ')).length >= LIMIT) return take(parts.join(' '));
    if (!data?.entry_attachments?.some(item => ['note', 'sheet', 'database'].includes(item.kind))) {
      return take(parts.join(' '));
    }
    const listing = await request('/sheet-entry/attachments?entry_path=' + encodeURIComponent(path));
    for (const item of listing?.attachments || []) {
      if (!['note', 'sheet', 'database'].includes(item.kind)) continue;
      const target = item.client_path || item.path;
      if (!target) continue;
      if (item.exists === false) throw new Error('リンク先の本文が見つかりません');
      if (item.kind === 'note') {
        const file = await request('/file?path=' + encodeURIComponent(target));
        parts.push(plain(typeof file === 'string' ? file : file?.content || ''));
      } else {
        parts.push(sheetText(await request('/pivot?path=' + encodeURIComponent(target))));
      }
      if (Array.from(parts.join(' ')).length >= LIMIT) break;
    }
    return take(parts.filter(Boolean).join(' '));
  }

  function load(path) {
    const key = scope() + ':' + path;
    if (!pending.has(key)) pending.set(key, read(path).finally(() => pending.delete(key)));
    return pending.get(key);
  }

  function append(root, path) {
    if (!root || !path) return;
    const row = document.createElement('div');
    row.className = 'db-body-excerpt';
    row.dataset.dbBodyExcerpt = path;
    row.setAttribute('aria-label', '本文冒頭');
    row.style.cssText = 'font-size:inherit;line-height:1.5;white-space:normal;overflow-wrap:anywhere;';
    const label = document.createElement('span');
    label.textContent = '本文冒頭: ';
    label.style.color = 'var(--fg2)';
    const value = document.createElement('span');
    row.append(label, value);
    root.appendChild(row);
    let generation = 0;
    const refresh = async () => {
      const ticket = ++generation, requestedScope = scope();
      value.textContent = '読込中…';
      row.removeAttribute('title');
      try {
        const text = await load(path);
        if (!row.isConnected || ticket !== generation) return;
        if (scope() !== requestedScope) throw new Error('保存先が変わりました。ビューを開き直してください');
        value.textContent = text || '—';
      } catch (error) {
        if (!row.isConnected || ticket !== generation) return;
        value.textContent = '';
        row.title = error?.message || '本文を読み込めませんでした';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'gb-btn gb-btn-sm';
        retry.textContent = '本文を再読込';
        retry.addEventListener('click', event => { event.stopPropagation(); refresh(); });
        value.appendChild(retry);
      }
    };
    row._refreshBodyExcerpt = refresh;
    if (typeof IntersectionObserver === 'function') observe(row);
    else refresh();
    return row;
  }

  window.MeldexDbBodyExcerpt = Object.freeze({ append, load, plain, take, sheetText });
})();
