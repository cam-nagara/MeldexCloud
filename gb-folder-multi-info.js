/* 複数ファイル選択時の、共通値だけを表示する読み取り専用情報パネル。 */
(() => {
  let renderToken = 0;

  function text(value) {
    return value == null ? '' : String(value);
  }

  function comparablePath(value) {
    const normalized = text(value).trim().replace(/\\/g, '/').replace(/\/+$/g, '');
    const platform = typeof navigator === 'undefined'
      ? ''
      : String(navigator.platform || navigator.userAgentData?.platform || '');
    const isWindows = /^Win/i.test(platform);
    return isWindows ? normalized.toLocaleLowerCase('ja') : normalized;
  }

  function fileContext(path) {
    const normalized = text(path);
    const name = normalized.split(/[/\\]/).pop() || normalized;
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    const folderPath = normalized.replace(/[/\\][^/\\]+$/, '');
    return {
      ext,
      folderPath,
      folderName: folderPath.split(/[/\\]/).pop() || folderPath,
      typeLabel: ext === 'md' ? 'ノート' : ext === 'json' ? 'シナリオ/シート' : ext === 'board' ? 'ボード' : ext,
    };
  }

  function normalizedDate(value) {
    if (!value) return null;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : text(value);
  }

  function displayedDate(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString('ja-JP') : text(value);
  }

  function embedded(meta) {
    return meta?.embedded && typeof meta.embedded === 'object' ? meta.embedded : {};
  }

  function metadataValues(item, meta) {
    const context = fileContext(item.path);
    const embeddedMeta = embedded(meta);
    const webclip = meta?.webclip && typeof meta.webclip === 'object'
      ? meta.webclip
      : (embeddedMeta.webclip && typeof embeddedMeta.webclip === 'object' ? embeddedMeta.webclip : {});
    const values = new Map([
      ['type', { label: '種類', raw: context.typeLabel, display: context.typeLabel }],
      ['folder', {
        label: 'フォルダ',
        raw: comparablePath(context.folderPath),
        display: context.folderName,
        path: context.folderPath,
      }],
      ['created', { label: '作成日時', raw: normalizedDate(meta?.created), display: displayedDate(meta?.created) }],
      ['modified', { label: '更新日時', raw: normalizedDate(meta?.modified), display: displayedDate(meta?.modified) }],
      ['size', {
        label: 'ファイルサイズ',
        raw: meta?.size == null ? null : Number(meta.size),
        display: meta?.size == null ? '' : (typeof _formatFileSize === 'function' ? _formatFileSize(meta.size) : text(meta.size)),
      }],
      ['dimensions', {
        label: '画像サイズ',
        raw: embeddedMeta.width && embeddedMeta.height ? `${embeddedMeta.width}x${embeddedMeta.height}` : null,
        display: embeddedMeta.width && embeddedMeta.height ? `${embeddedMeta.width} × ${embeddedMeta.height} px` : '',
      }],
      ['rating', {
        label: '評価',
        raw: embeddedMeta.rating == null ? null : Number(embeddedMeta.rating),
        display: embeddedMeta.rating == null ? '' : `${Number(embeddedMeta.rating) || 0} / 5`,
      }],
      ['note', { label: webclip.page_url ? 'WebClipperメモ' : 'メモ', raw: text(embeddedMeta.note || webclip.note) || null, display: text(embeddedMeta.note || webclip.note) }],
      ['page-url', { label: '元ページ', raw: text(webclip.page_url) || null, display: text(webclip.page_url) }],
      ['image-url', { label: '画像URL', raw: text(webclip.image_url) || null, display: text(webclip.image_url) }],
      ['clipped-at', { label: '保存日時', raw: text(webclip.clipped_at) || null, display: text(webclip.clipped_at) }],
    ]);
    const groups = Array.isArray(embeddedMeta.groups) ? embeddedMeta.groups : [];
    groups.forEach(group => {
      (Array.isArray(group?.items) ? group.items : []).forEach(entry => {
        const label = text(entry?.label || entry?.key || '項目');
        const key = `embedded:${text(group?.name)}:${text(entry?.key || label)}`;
        const value = text(entry?.value);
        values.set(key, { label, raw: value || null, display: value });
      });
    });
    return values;
  }

  function sameValue(left, right) {
    if (left == null || right == null) return left === right;
    return typeof left === 'number' && typeof right === 'number'
      ? Object.is(left, right)
      : text(left) === text(right);
  }

  function commonRows(valueMaps, options = {}) {
    if (!valueMaps.length) return [];
    const result = [];
    valueMaps[0].forEach((entry, key) => {
      if (!options.includeMetadata && !['type', 'folder'].includes(key)) return;
      if (entry.raw == null || entry.raw === '') return;
      if (valueMaps.every(values => values.has(key) && sameValue(values.get(key)?.raw, entry.raw))) {
        result.push(entry);
      }
    });
    return result;
  }

  function itemTags(item) {
    const tags = typeof _folderItemTags === 'function' ? _folderItemTags(item) : [];
    return (Array.isArray(tags) ? tags : [])
      .filter(tag => tag && (tag.id || tag.name))
      .map(tag => ({ ...tag, _key: text(tag.id || tag.name) }))
      .sort((a, b) => a._key.localeCompare(b._key, 'ja'));
  }

  function commonTagList(items) {
    const lists = items.map(itemTags);
    if (!lists.length || !lists[0].length) return [];
    const signature = JSON.stringify(lists[0].map(tag => tag._key));
    return lists.every(tags => JSON.stringify(tags.map(tag => tag._key)) === signature) ? lists[0] : [];
  }

  function appendRow(table, entry) {
    const row = document.createElement('tr');
    const label = document.createElement('td');
    label.className = 'folder-multi-info-label';
    label.textContent = entry.label;
    const value = document.createElement('td');
    value.className = 'folder-multi-info-value';
    if (entry.path) {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'auto-link folder-multi-info-link';
      link.dataset.path = entry.path;
      link.dataset.nativeFolder = 'true';
      link.textContent = entry.display;
      value.appendChild(link);
    } else {
      value.textContent = entry.display;
    }
    row.append(label, value);
    table.appendChild(row);
  }

  function appendTags(host, items) {
    const tags = commonTagList(items);
    if (!tags.length) return;
    const section = document.createElement('section');
    section.className = 'folder-multi-info-tags';
    const heading = document.createElement('h3');
    heading.textContent = 'タグ';
    const chips = document.createElement('div');
    chips.className = 'folder-multi-info-tag-list';
    const api = window.MeldexGlobalTags;
    tags.forEach(tag => {
      const chip = api?.createTagChip?.(tag, { compact: true })
        || Object.assign(document.createElement('span'), {
          className: 'gb-tag-chip gb-tag-chip--compact',
          textContent: text(tag.name),
        });
      chips.appendChild(chip);
    });
    section.append(heading, chips);
    host.appendChild(section);
  }

  function renderContent(host, items, metas, failures, onRetry) {
    host.replaceChildren();
    const panel = document.createElement('div');
    panel.className = 'folder-multi-info';
    panel.dataset.e2eId = 'folder-multi-info';
    const heading = document.createElement('h2');
    heading.className = 'folder-multi-info-title';
    heading.textContent = `${items.length}件のファイルを選択中`;
    const description = document.createElement('p');
    description.className = 'folder-multi-info-description';
    description.textContent = '選択中のすべてのファイルで値が同じ項目だけを表示しています。';
    panel.append(heading, description);
    if (failures.length) {
      const warning = document.createElement('div');
      warning.className = 'folder-multi-info-warning';
      warning.setAttribute('role', 'status');
      const warningText = document.createElement('span');
      warningText.textContent = `${failures.length}件の詳細情報を確認できなかったため、確認済みの基本情報だけを表示しています。`;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'gb-btn gb-btn-sm';
      retry.textContent = '再試行';
      retry.addEventListener('click', () => onRetry?.());
      warning.append(warningText, retry);
      panel.appendChild(warning);
    }
    const rows = commonRows(items.map((item, index) => metadataValues(item, metas[index])), {
      includeMetadata: failures.length === 0,
    });
    if (rows.length) {
      const table = document.createElement('table');
      table.className = 'folder-multi-info-table';
      rows.forEach(entry => appendRow(table, entry));
      panel.appendChild(table);
    } else {
      const empty = document.createElement('p');
      empty.className = 'folder-multi-info-empty';
      empty.textContent = '共通する情報はありません。';
      panel.appendChild(empty);
    }
    if (!failures.length) appendTags(panel, items);
    host.appendChild(panel);
  }

  async function loadMetadata(item) {
    try {
      const fetched = await apiFetch('/file-meta?path=' + encodeURIComponent(item.path), { silentError: true });
      return { meta: { ...item, ...(fetched || {}) }, error: null };
    } catch (error) {
      return { meta: { ...item }, error };
    }
  }

  async function renderInto(host, items, options = {}) {
    const targets = (Array.isArray(items) ? items : []).filter(item => item?.path && item.type !== 'folder');
    if (!host || targets.length < 2) return false;
    const token = ++renderToken;
    host.innerHTML = '<div class="folder-multi-info-loading">共通情報を読み込んでいます...</div>';
    const results = await Promise.all(targets.map(loadMetadata));
    if (token !== renderToken || options.isCurrent?.() === false || !host.isConnected) return true;
    renderContent(
      host,
      targets,
      results.map(result => result.meta),
      results.filter(result => result.error),
      () => renderInto(host, targets, options),
    );
    return true;
  }

  async function render(items, options = {}) {
    const targets = (Array.isArray(items) ? items : []).filter(item => item?.path && item.type !== 'folder');
    if (targets.length < 2 || typeof showDetailPanel !== 'function') return false;
    await showDetailPanel('<div data-folder-multi-info-host></div>');
    if (options.isCurrent?.() === false) return true;
    const detailRoot = document.getElementById('rp-detail') || document;
    const host = detailRoot.querySelector('[data-folder-multi-info-host]');
    if (!host) return true;
    return renderInto(host, targets, options);
  }

  window.MeldexFolderMultiInfo = { render, renderInto, commonRows };
})();
