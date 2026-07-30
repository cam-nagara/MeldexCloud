/* 画像・文書の埋め込み情報表示と、画像の評価・メモ編集 */
(() => {
  const cache = new Map();
  let folderTagCatalogRefreshTimer = null;

  function embeddedOf(meta) {
    return meta?.embedded && typeof meta.embedded === 'object' ? meta.embedded : null;
  }

  function webclipOf(meta) {
    const embedded = embeddedOf(meta);
    const value = meta?.webclip || embedded?.webclip;
    return value && typeof value === 'object' ? value : null;
  }

  function httpUrl(value) {
    try {
      const parsed = new URL(String(value || '').trim());
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? parsed.href : '';
    } catch {
      return '';
    }
  }

  function row(label, value, className = '') {
    const wrapper = document.createElement('div');
    wrapper.className = 'file-embedded-row' + (className ? ' ' + className : '');
    const key = document.createElement('span');
    key.className = 'file-embedded-key';
    key.textContent = label;
    const content = document.createElement('span');
    content.className = 'file-embedded-value';
    content.textContent = value == null ? '' : String(value);
    wrapper.append(key, content);
    return { wrapper, content };
  }

  function dimensionText(embedded, image) {
    const width = Number(embedded?.width || image?.naturalWidth || 0);
    const height = Number(embedded?.height || image?.naturalHeight || 0);
    return width > 0 && height > 0 ? `${width} × ${height} px` : '';
  }

  async function load(path, preloaded, options = {}) {
    const key = String(path || '');
    if (!key) return preloaded || null;
    if (!options.force && preloaded?.embedded !== undefined) {
      cache.set(key, preloaded);
      return preloaded;
    }
    if (!options.force && cache.has(key)) return cache.get(key);
    const pending = apiFetch('/file-meta?path=' + encodeURIComponent(key), { silentError: true })
      .then(meta => {
        cache.set(key, meta);
        return meta;
      })
      .catch(error => {
        cache.delete(key);
        return {
          _metadataLoadError: error?.userMessage || error?.message || String(error),
        };
      });
    cache.set(key, pending);
    const resolved = await pending;
    if (resolved && cache.get(key) === pending) cache.set(key, resolved);
    return resolved;
  }

  async function update(path, patch) {
    const meta = await apiPost('/file-meta', { path, ...patch }, { silentError: true });
    cache.set(String(path), meta);
    refreshRatingControls(path, meta);
    return meta;
  }

  function setRatingButtons(group, rating) {
    const current = Math.max(0, Math.min(5, Number(rating) || 0));
    group.dataset.rating = String(current);
    group.closest('.fv-image-rating-host')?.classList.toggle('has-rating', current > 0);
    group.querySelectorAll('button').forEach((button, index) => {
      const active = index < current;
      button.classList.toggle('is-active', active);
      button.textContent = active ? '★' : '☆';
      button.setAttribute('aria-pressed', String(index + 1 === current));
    });
  }

  function ratingControl(path, meta, options = {}) {
    const embedded = embeddedOf(meta) || {};
    const e2ePath = String(path || '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'file';
    const group = document.createElement('div');
    group.className = options.compact ? 'file-rating file-rating--compact' : 'file-rating';
    group.dataset.fileRatingPath = String(path || '');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', '評価');
    const editable = embedded.editable === true;
    for (let value = 1; value <= 5; value++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.value = String(value);
      button.dataset.e2eId = `file-rating-${e2ePath}-${value}`;
      button.setAttribute('aria-label', `評価 ${value}`);
      button.disabled = !editable;
      button.title = editable ? `${value}つ星に設定（同じ評価を押すと解除）` : 'この形式の評価は閲覧のみです';
      button.addEventListener('click', async event => {
        event.preventDefault();
        event.stopPropagation();
        if (!editable || group.dataset.saving === '1') return;
        const previous = Number(group.dataset.rating) || 0;
        const next = previous === value ? 0 : value;
        group.dataset.saving = '1';
        setRatingButtons(group, next);
        try {
          await update(path, { rating: next });
          if (typeof showStatus === 'function') showStatus(next ? `評価を${next}つ星にしました` : '評価を解除しました');
        } catch (error) {
          setRatingButtons(group, previous);
          if (typeof showStatus === 'function') showStatus('評価を保存できませんでした: ' + (error?.message || error), true);
        } finally {
          delete group.dataset.saving;
        }
      });
      group.appendChild(button);
    }
    setRatingButtons(group, embedded.rating);
    return group;
  }

  function refreshRatingControls(path, meta) {
    const target = String(path || '');
    document.querySelectorAll('[data-file-rating-path]').forEach(group => {
      if (group.dataset.fileRatingPath === target) {
        setRatingButtons(group, embeddedOf(meta)?.rating);
      }
    });
  }

  function appendLinkRow(host, label, value) {
    const url = httpUrl(value);
    if (!url) return;
    const built = row(label, '');
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = url;
    built.content.appendChild(link);
    host.appendChild(built.wrapper);
  }

  function appendMetadataGroups(host, embedded) {
    const groups = Array.isArray(embedded?.groups) ? embedded.groups : [];
    if (!groups.length) return;
    const heading = document.createElement('div');
    heading.className = 'file-embedded-heading';
    heading.textContent = '埋め込み情報';
    host.appendChild(heading);
    groups.forEach((group, index) => {
      const items = Array.isArray(group?.items) ? group.items : [];
      if (!items.length) return;
      const details = document.createElement('details');
      details.className = 'file-embedded-group';
      details.open = index === 0;
      const summary = document.createElement('summary');
      summary.textContent = `${group.name || '情報'}（${items.length}）`;
      details.appendChild(summary);
      const list = document.createElement('div');
      list.className = 'file-embedded-list';
      items.forEach(item => {
        list.appendChild(row(item?.label || item?.key || '項目', item?.value || '').wrapper);
      });
      details.appendChild(list);
      host.appendChild(details);
    });
  }

  function renderEditor(host, path, meta) {
    if (!host) return;
    host.replaceChildren();
    if (meta?._metadataLoadError) {
      const error = document.createElement('div');
      error.className = 'file-embedded-empty file-embedded-error';
      const message = document.createElement('span');
      message.textContent = '埋め込み情報を読み込めませんでした: ' + meta._metadataLoadError;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'gb-btn gb-btn-xs gb-btn-quiet';
      retry.textContent = '再試行';
      retry.setAttribute('aria-label', '埋め込み情報を再読み込み');
      retry.addEventListener('click', async () => {
        retry.disabled = true;
        const refreshed = await load(path, null, { force: true });
        renderEditor(host, path, refreshed);
      });
      error.append(message, retry);
      host.appendChild(error);
      return;
    }
    const embedded = embeddedOf(meta);
    const webclip = webclipOf(meta);
    if (!embedded && !webclip) {
      const empty = document.createElement('div');
      empty.className = 'file-embedded-empty';
      empty.textContent = '表示できる埋め込み情報はありません';
      host.appendChild(empty);
      return;
    }

    if (embedded?.width && embedded?.height) {
      host.appendChild(row('画像サイズ', dimensionText(embedded)).wrapper);
    }
    if (embedded?.kind === 'image') {
      const ratingRow = row('評価', '');
      ratingRow.content.appendChild(ratingControl(path, meta));
      host.appendChild(ratingRow.wrapper);
    }
    appendLinkRow(host, '元ページ', webclip?.page_url);
    appendLinkRow(host, '画像URL', webclip?.image_url);
    if (webclip?.clipped_at) {
      host.appendChild(row('保存日時', webclip.clipped_at).wrapper);
    }

    if (embedded?.kind === 'image') {
      const memo = document.createElement('div');
      memo.className = 'file-embedded-memo';
      const label = document.createElement('label');
      label.textContent = webclip ? 'WebClipperメモ' : 'メモ';
      const textarea = document.createElement('textarea');
      textarea.value = String(embedded.note || webclip?.note || '');
      textarea.placeholder = 'メモを入力';
      textarea.disabled = embedded.editable !== true;
      const actions = document.createElement('div');
      actions.className = 'file-embedded-memo-actions';
      const hint = document.createElement('span');
      hint.textContent = embedded.editable === true
        ? '画像ファイル内へ保存します'
        : 'この形式のメモは閲覧のみです';
      const save = document.createElement('button');
      save.type = 'button';
      save.textContent = 'メモを保存';
      save.disabled = embedded.editable !== true;
      save.addEventListener('click', async () => {
        if (save.disabled) return;
        save.disabled = true;
        try {
          const nextMeta = await update(path, { note: textarea.value });
          textarea.value = String(embeddedOf(nextMeta)?.note || '');
          if (typeof showStatus === 'function') showStatus('メモを画像ファイルへ保存しました');
        } catch (error) {
          if (typeof showStatus === 'function') showStatus('メモを保存できませんでした: ' + (error?.message || error), true);
        } finally {
          save.disabled = embedded.editable !== true;
        }
      });
      textarea.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          save.click();
        }
      });
      actions.append(hint, save);
      memo.append(label, textarea, actions);
      host.appendChild(memo);
    }
    appendMetadataGroups(host, embedded);
  }

  function renderFolderTags(host, item) {
    if (!host) return;
    const api = window.MeldexGlobalTags;
    const sourceFolder = String(item?.path && window.MeldexAutoTagSourceFolder?.(item.path) || '').trim();
    const catalog = api?.getCachedTagsSync?.(sourceFolder) || null;
    const groups = Array.isArray(catalog?.groups) ? catalog.groups : [];
    const groupsById = Object.fromEntries(groups.map(group => [group.id, group]));
    const rawTags = typeof _folderItemTags === 'function' ? _folderItemTags(item) : [];
    const visibleTags = window.MeldexTagDisplayPreferences?.filterVisibleTags?.(
      rawTags,
      groups,
      sourceFolder,
    ) || rawTags;
    const tags = typeof api?.sortTagsByGroupOrder === 'function'
      ? api.sortTagsByGroupOrder(visibleTags, groups)
      : visibleTags;
    const names = tags.map(tag => String(tag?.name || '')).filter(Boolean);
    const displayLimit = window.MeldexTagDisplayPreferences?.folderTagDisplayLimit?.()
      || api?.getCompactTagDisplayLimit?.()
      || 10;
    const allTagsTitle = `すべてのタグ（${names.length}件）\n${names.join('、')}`;
    host.replaceChildren();
    host.hidden = names.length === 0;
    host.title = allTagsTitle;
    tags.slice(0, displayLimit).forEach(tag => {
      const chip = typeof api?.createTagChip === 'function'
        ? api.createTagChip(tag, {
            compact: true,
            className: 'fv-folder-tag',
            groupsById,
          })
        : Object.assign(document.createElement('span'), {
            className: 'gb-tag-chip gb-tag-chip--compact fv-folder-tag',
            textContent: String(tag?.name || ''),
          });
      host.appendChild(chip);
    });
    if (names.length > displayLimit) {
      const label = `+${names.length - displayLimit}`;
      const more = typeof api?.createTagChip === 'function'
        ? api.createTagChip(null, {
            compact: true,
            summary: true,
            label,
            title: allTagsTitle,
            className: 'fv-folder-tag fv-folder-tag--more',
          })
        : Object.assign(document.createElement('span'), {
            className: 'gb-tag-chip gb-tag-chip--compact gb-tag-chip--summary fv-folder-tag fv-folder-tag--more',
            textContent: label,
            title: allTagsTitle,
          });
      host.appendChild(more);
    }
    if (!catalog && api?.loadTagsCached && host.dataset.folderTagCatalogLoading !== '1') {
      host.dataset.folderTagCatalogLoading = '1';
      api.loadTagsCached(sourceFolder).then(() => {
        delete host.dataset.folderTagCatalogLoading;
        if (host.isConnected) renderFolderTags(host, item);
      }).catch(() => {
        delete host.dataset.folderTagCatalogLoading;
      });
    }
  }

  function attachFolderTags(metaHost, item) {
    if (!metaHost || !item?.path) return null;
    const host = document.createElement('div');
    host.className = 'fv-folder-tags';
    host.dataset.folderTagsPath = String(item.path);
    host._folderTagItem = item;
    metaHost.appendChild(host);
    renderFolderTags(host, item);
    return host;
  }

  function refreshFolderTags(root = document) {
    root.querySelectorAll?.('[data-folder-tags-path]').forEach(host => {
      renderFolderTags(host, host._folderTagItem);
    });
  }

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('meldex:tag-dictionary-changed', () => {
      clearTimeout(folderTagCatalogRefreshTimer);
      folderTagCatalogRefreshTimer = setTimeout(() => {
        const hosts = Array.from(document.querySelectorAll('[data-folder-tags-path]'));
        const sourceFolders = new Set(hosts.map(host => String(
          host._folderTagItem?.path && window.MeldexAutoTagSourceFolder?.(host._folderTagItem.path) || '',
        ).trim()));
        const loads = Array.from(sourceFolders).map(sourceFolder =>
          window.MeldexGlobalTags?.loadTagsCached?.(sourceFolder),
        ).filter(Boolean);
        Promise.allSettled(loads).then(() => refreshFolderTags(document));
      }, 80);
    });
    window.addEventListener('meldex:compact-tag-display-limit-changed', () => {
      refreshFolderTags(document);
    });
    window.addEventListener('meldex:folder-tag-display-limit-changed', () => {
      refreshFolderTags(document);
    });
    window.addEventListener('meldex:tag-group-visibility-changed', () => {
      refreshFolderTags(document);
    });
  }

  function attachFolderCard(thumb, item, image, options = {}) {
    const metaHost = options.metaHost;
    const showDimensions = options.showDimensions !== false;
    const showRating = options.showRating !== false;
    if (!metaHost || item?.type !== 'image' || !item?.path || (!showDimensions && !showRating)) return;
    thumb?.classList.add('fv-thumb--embedded');
    const dimensions = showDimensions ? document.createElement('span') : null;
    if (dimensions) {
      dimensions.className = 'fv-image-dimensions fv-meta-item';
      dimensions.hidden = true;
      metaHost.appendChild(dimensions);
    }
    const ratingHost = showRating ? document.createElement('div') : null;
    if (ratingHost) {
      ratingHost.className = 'fv-image-rating-host fv-meta-item';
      metaHost.appendChild(ratingHost);
    }

    const updateDimensions = embedded => {
      if (!dimensions) return;
      const text = dimensionText(embedded, image);
      dimensions.textContent = text;
      dimensions.hidden = !text;
    };
    const hydrate = async () => {
      if (!metaHost.isConnected) return;
      updateDimensions(item.embedded);
      const preloaded = item.embedded ? { embedded: item.embedded } : null;
      const meta = await load(item.path, preloaded);
      if (!meta || meta._metadataLoadError || !metaHost.isConnected) return;
      item.embedded = embeddedOf(meta);
      updateDimensions(item.embedded);
      if (ratingHost) ratingHost.replaceChildren(ratingControl(item.path, meta, { compact: true }));
    };
    if (image && !(image.complete && image.naturalWidth)) {
      image.addEventListener('load', () => updateDimensions(item.embedded), { once: true });
    }
    queueMicrotask(hydrate);
  }

  window.MeldexEmbeddedMetadata = {
    attachFolderCard,
    attachFolderTags,
    dimensionText,
    load,
    refreshFolderTags,
    renderEditor,
    update,
  };
})();
