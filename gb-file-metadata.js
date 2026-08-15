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

  // === メモの自動保存 ===
  // 画像ファイル本体へ書き込むため、打鍵ごとには保存せず入力が止まってから書き出す。
  // 入力欄から離れた時・ファイルを切り替えた時・ウィンドウを閉じる時は即座に確定させる。
  const MEMO_AUTOSAVE_DELAY_MS = 1200;
  const pendingMemos = new Map();

  function _memoStatus(el, text, isError) {
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('file-embedded-memo-status--error', !!isError);
  }

  async function _flushMemo(textarea) {
    const state = pendingMemos.get(textarea);
    if (!state) return;
    if (state.timer) { clearTimeout(state.timer); state.timer = null; }
    if (state.inflight) { try { await state.inflight; } catch { /* 直前の失敗はこの後で作り直す */ } }
    // 保存中に追記された分も書き切る。失敗したらそこで打ち切り、無限に再送しない。
    while (textarea.value !== state.savedValue) {
      const value = textarea.value;
      _memoStatus(state.statusEl, '保存中...');
      state.inflight = update(state.path, { note: value });
      try {
        await state.inflight;
        state.savedValue = value;
        _memoStatus(state.statusEl, '保存しました');
      } catch (error) {
        _memoStatus(state.statusEl, '保存できませんでした', true);
        if (typeof showStatus === 'function') showStatus('メモを保存できませんでした: ' + (error?.message || error), true);
        return;
      } finally {
        state.inflight = null;
      }
      if (!textarea.isConnected) return;
    }
  }

  // パネル切り替え・ウィンドウを閉じる直前に呼ぶ。未確定のメモを全部書き出す。
  async function flushPendingMemos() {
    await Promise.all([...pendingMemos.keys()].map(textarea => _flushMemo(textarea)));
    return true;
  }

  // パネルが作り直されると入力欄ごと差し替わる。取り残された未保存分は
  // 書き出してから登録を捨てる（待たない。描画を止めないため）。
  function _pruneDetachedMemos() {
    for (const textarea of [...pendingMemos.keys()]) {
      if (textarea.isConnected) continue;
      const state = pendingMemos.get(textarea);
      if (state && textarea.value !== state.savedValue) _flushMemo(textarea);
      pendingMemos.delete(textarea);
    }
  }

  function bindMemoAutosave(textarea, statusEl, path, initialValue) {
    _pruneDetachedMemos();
    pendingMemos.set(textarea, {
      path,
      statusEl,
      savedValue: initialValue,
      timer: null,
      inflight: null,
    });
    textarea.addEventListener('input', () => {
      const state = pendingMemos.get(textarea);
      if (!state) return;
      if (state.timer) clearTimeout(state.timer);
      _memoStatus(state.statusEl, textarea.value === state.savedValue ? '' : '未保存');
      state.timer = setTimeout(() => { _flushMemo(textarea); }, MEMO_AUTOSAVE_DELAY_MS);
    });
    textarea.addEventListener('blur', () => { _flushMemo(textarea); });
    textarea.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        _flushMemo(textarea);
      }
    });
  }

  window.addEventListener('pagehide', () => { flushPendingMemos(); });

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
      // 埋め込み情報のグループは既定で全部閉じる（タグと主要項目は常に開いた状態のまま）。
      details.open = false;
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

  function renderEditor(primaryHost, groupsHost, path, meta) {
    if (!primaryHost) return;
    _pruneDetachedMemos();
    primaryHost.replaceChildren();
    if (groupsHost) groupsHost.replaceChildren();
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
      retry.dataset.e2eId = 'file-embedded-metadata-retry';
      retry.addEventListener('click', async () => {
        retry.disabled = true;
        const refreshed = await load(path, null, { force: true });
        renderEditor(primaryHost, groupsHost, path, refreshed);
      });
      error.append(message, retry);
      primaryHost.appendChild(error);
      return;
    }
    const embedded = embeddedOf(meta);
    const webclip = webclipOf(meta);
    if (!embedded && !webclip) {
      const empty = document.createElement('div');
      empty.className = 'file-embedded-empty';
      empty.textContent = '表示できる埋め込み情報はありません';
      primaryHost.appendChild(empty);
      return;
    }

    if (embedded?.width && embedded?.height) {
      primaryHost.appendChild(row('画像サイズ', dimensionText(embedded)).wrapper);
    }
    if (embedded?.kind === 'image') {
      const ratingRow = row('評価', '');
      ratingRow.content.appendChild(ratingControl(path, meta));
      primaryHost.appendChild(ratingRow.wrapper);
    }
    appendLinkRow(primaryHost, '元ページ', webclip?.page_url);
    appendLinkRow(primaryHost, '画像URL', webclip?.image_url);
    if (webclip?.clipped_at) {
      primaryHost.appendChild(row('保存日時', webclip.clipped_at).wrapper);
    }

    if (embedded?.kind === 'image') {
      const editable = embedded.editable === true;
      const memo = document.createElement('div');
      memo.className = 'file-embedded-memo';
      const label = document.createElement('label');
      // 取り込み元（Web Clipper経由か否か）に関わらずどの画像でも使えるメモ欄のため、
      // 特定機能名を冠したラベルは付けない（用語統一ルール）。
      label.textContent = 'メモ';
      // 「画像ファイル内へ保存します」の説明は基本UIから外し、ラベル横の
      // ヘルプアイコンのツールチップへ集約する（UI共通ルール）。
      if (editable && typeof fieldHelp === 'function') {
        label.insertAdjacentHTML('beforeend', ' ' + fieldHelp('入力をやめると自動で保存されます。内容は画像ファイル自体に書き込まれます', { e2eId: 'file-embedded-memo-help' }));
      }
      const textarea = document.createElement('textarea');
      const initialNote = String(embedded.note || webclip?.note || '');
      textarea.value = initialNote;
      textarea.placeholder = 'メモを入力';
      textarea.disabled = !editable;
      textarea.dataset.e2eId = 'file-embedded-memo-input';
      const actions = document.createElement('div');
      actions.className = 'file-embedded-memo-actions';
      const status = document.createElement('span');
      status.className = 'file-embedded-memo-status';
      status.setAttribute('role', 'status');
      status.dataset.e2eId = 'file-embedded-memo-status';
      // 入力できない理由だけは可視のまま1行残す（条件付きの短い状態説明）。
      if (!editable) status.textContent = 'この形式のメモは閲覧のみです';
      actions.append(status);
      memo.append(label, textarea, actions);
      primaryHost.appendChild(memo);
      if (editable) bindMemoAutosave(textarea, status, path, initialNote);
    }
    if (groupsHost) appendMetadataGroups(groupsHost, embedded);
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
    flushPendingMemos,
    load,
    refreshFolderTags,
    renderEditor,
    update,
  };
})();
