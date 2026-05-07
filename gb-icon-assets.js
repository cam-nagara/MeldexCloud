/* gb-icon-assets.js - Lucide / Noto Emoji shared picker and renderer */
(function(global) {
  'use strict';

  const HEX_SEQ_RE = /^[0-9a-f]{1,6}(?:[-_][0-9a-f]{1,6})*$/i;

  function _esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function _escAttr(value) {
    return _esc(value).replace(/`/g, '&#96;');
  }

  function _normalizeCode(code) {
    const parts = String(code || '').trim().replace(/_/g, '-').split('-');
    const out = [];
    for (const part of parts) {
      if (!part) return '';
      const cp = parseInt(part, 16);
      if (!Number.isFinite(cp) || cp < 0 || cp > 0x10FFFF) return '';
      out.push(cp.toString(16).toUpperCase());
    }
    return out.join('-');
  }

  function codeToEmoji(code) {
    try {
      return _normalizeCode(code).split('-').map((part) => String.fromCodePoint(parseInt(part, 16))).join('');
    } catch {
      return '';
    }
  }

  function _toKebab(name) {
    return String(name || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/_/g, '-')
      .toLowerCase();
  }

  function _normalizeSearch(value) {
    return String(value || '').toLowerCase().replace(/[-_\s:]/g, '');
  }

  function _lucidePaths(name) {
    if (!name) return '';
    if (typeof global.LUCIDE !== 'undefined' && global.LUCIDE && global.LUCIDE[name] != null) {
      return global.LUCIDE[name];
    }
    if (global.LUCIDE_FULL && global.LUCIDE_FULL[name] != null) return global.LUCIDE_FULL[name];
    const kebab = _toKebab(name);
    if (global.LUCIDE_FULL && global.LUCIDE_FULL[kebab] != null) return global.LUCIDE_FULL[kebab];
    return '';
  }

  function hasLucideName(name) {
    return !!_lucidePaths(name);
  }

  function _emojiAnnotationKeywords(emoji) {
    const src = global.EMOJI_ANNOTATIONS;
    if (!src || !emoji) return '';
    const entry = src[emoji];
    if (!entry) return '';
    const parts = [];
    if (Array.isArray(entry.j)) parts.push(...entry.j);
    if (Array.isArray(entry.e)) parts.push(...entry.e);
    return parts.join(' ');
  }

  function _notoEntries() {
    const src = Array.isArray(global.NOTO_EMOJI) ? global.NOTO_EMOJI : [];
    return src.map((entry) => {
      const code = _normalizeCode(entry.code);
      const emoji = entry.emoji || codeToEmoji(code);
      const annotations = _emojiAnnotationKeywords(emoji);
      return {
        type: 'noto',
        spec: 'noto:' + code,
        code,
        emoji,
        label: entry.name || code,
        search: [entry.emoji || '', code, entry.name || '', annotations].join(' '),
      };
    }).filter((entry) => entry.code);
  }

  let _notoMap = null;
  function _findNoto(code) {
    const normalized = _normalizeCode(code);
    if (!_notoMap) {
      _notoMap = new Map(_notoEntries().map((entry) => [entry.code, entry]));
    }
    return _notoMap.get(normalized) || {
      type: 'noto',
      spec: 'noto:' + normalized,
      code: normalized,
      emoji: codeToEmoji(normalized),
      label: normalized,
      search: normalized,
    };
  }

  function normalizeSpec(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const lower = raw.toLowerCase();
    if (lower.startsWith('lucide:')) {
      const name = raw.slice(raw.indexOf(':') + 1).trim();
      return name ? 'lucide:' + name : '';
    }
    if (lower.startsWith('noto:') || lower.startsWith('emoji:') || lower.startsWith('twemoji:')) {
      const code = _normalizeCode(raw.slice(raw.indexOf(':') + 1));
      return code ? 'noto:' + code : '';
    }
    if (HEX_SEQ_RE.test(raw)) {
      const code = _normalizeCode(raw);
      return code ? 'noto:' + code : '';
    }
    if (hasLucideName(raw)) return 'lucide:' + raw;
    return raw;
  }

  function parseSpec(value) {
    const spec = normalizeSpec(value);
    if (!spec) return { type: '', spec: '', label: '' };
    if (spec.toLowerCase().startsWith('lucide:')) {
      const name = spec.slice(7);
      return { type: 'lucide', spec: 'lucide:' + name, name, label: _toKebab(name), search: name + ' ' + _toKebab(name) };
    }
    if (spec.toLowerCase().startsWith('noto:')) return _findNoto(spec.slice(5));
    if (hasLucideName(spec)) return parseSpec('lucide:' + spec);
    return { type: 'text', spec, label: spec, search: spec };
  }

  function sameSpec(a, b) {
    return normalizeSpec(a).toLowerCase() === normalizeSpec(b).toLowerCase();
  }

  function render(spec, size, options = {}) {
    const parsed = parseSpec(spec);
    const px = Math.max(10, Number(size) || 20);
    const className = options.className ? ' ' + options.className : '';
    if (parsed.type === 'lucide') {
      if (typeof global.lucide === 'function' && hasLucideName(parsed.name)) {
        return global.lucide(parsed.name, px);
      }
    }
    if (parsed.type === 'noto') {
      const label = parsed.label || parsed.code;
      // 外側要素 (button 等) が title を持つケースが多く、span の title を重ねると
      // gb-tooltip のサプレッション対象外の親 title でネイティブツールチップが二重表示されるため、
      // aria-label のみに留める。
      return `<span class="gb-icon-render gb-noto-emoji${className}" data-icon="${_escAttr(parsed.spec)}" role="img" aria-label="${_escAttr(label)}" style="--gb-icon-size:${px}px;">${_esc(parsed.emoji || codeToEmoji(parsed.code) || '?')}</span>`;
    }
    return `<span class="gb-icon-render gb-icon-text${className}" style="--gb-icon-size:${px}px;">${_esc(parsed.label || '?')}</span>`;
  }

  function renderInto(element, spec, size, options = {}) {
    if (!element) return;
    element.innerHTML = render(spec, size, options);
    element.dataset.iconSpec = normalizeSpec(spec);
  }

  function _lucideTagKeywords(name) {
    const src = global.LUCIDE_TAGS;
    if (!src) return '';
    const kebab = _toKebab(name);
    const tags = src[name] || src[kebab] || null;
    if (!Array.isArray(tags) || !tags.length) return '';
    return tags.join(' ');
  }

  function listLucideIcons() {
    const names = new Set();
    const add = (name) => {
      if (!name || String(name).includes('-')) return;
      if (_lucidePaths(name)) names.add(name);
    };
    if (typeof global.LUCIDE !== 'undefined' && global.LUCIDE) Object.keys(global.LUCIDE).forEach(add);
    if (global.LUCIDE_FULL) Object.keys(global.LUCIDE_FULL).forEach(add);
    return [...names].sort((a, b) => _toKebab(a).localeCompare(_toKebab(b))).map((name) => {
      const kebab = _toKebab(name);
      const tags = _lucideTagKeywords(name);
      return {
        type: 'lucide',
        spec: 'lucide:' + name,
        name,
        label: kebab,
        search: [name, kebab, tags].filter(Boolean).join(' '),
      };
    });
  }

  function listNotoEmoji() {
    return _notoEntries();
  }

  function _makePresetItems(presets) {
    return (presets || []).map((preset) => {
      const spec = normalizeSpec(preset.spec || preset.icon || preset.code);
      return {
        ...preset,
        type: parseSpec(spec).type,
        spec,
        label: preset.label || parseSpec(spec).label || spec,
        search: [preset.label || '', preset.keywords || '', spec].join(' '),
        preset: true,
      };
    }).filter((item) => item.spec);
  }

  function _makeAllItems(options) {
    const includeLucide = options.includeLucide !== false;
    const includeNoto = options.includeNoto !== false;
    const items = [];
    if (includeLucide) items.push(...listLucideIcons());
    if (includeNoto) items.push(...listNotoEmoji());
    return items;
  }

  function _normalizeSourceDefs(options, includeLucide, includeNoto) {
    const custom = Array.isArray(options.sources) ? options.sources : [];
    if (custom.length) {
      return custom.map((source) => {
        const id = String(source.id || source.source || source.type || '').trim();
        if (!id) return null;
        return {
          ...source,
          id,
          label: String(source.label || source.title || id).trim(),
          type: source.type || '',
          filter: typeof source.filter === 'function'
            ? source.filter
            : (typeof source.match === 'function' ? source.match : null),
        };
      }).filter(Boolean);
    }

    const defs = [];
    if (includeLucide && includeNoto && options.hideAllTab !== true && options.showAllTab !== false) {
      defs.push({ id: 'all', label: 'すべて' });
    }
    if (includeLucide) defs.push({ id: 'lucide', label: 'Lucide', type: 'lucide' });
    if (includeNoto) defs.push({ id: 'noto', label: 'Noto Emoji', type: 'noto' });
    return defs;
  }

  function _sourceDefMatches(def, item) {
    if (!def || def.id === 'all') return true;
    if (def.filter) {
      try { return !!def.filter(item); } catch { return false; }
    }
    if (def.type) return item.type === def.type;
    return item.type === def.id;
  }

  function openPicker(options = {}) {
    const includeLucide = options.includeLucide !== false;
    const includeNoto = options.includeNoto !== false;
    let allItems = null;
    const presets = _makePresetItems(options.presets);
    const current = normalizeSpec(options.current || '');
    const sourceDefs = _normalizeSourceDefs(options, includeLucide, includeNoto);
    const defaultSource = includeLucide && includeNoto ? 'all' : includeNoto ? 'noto' : 'lucide';
    let activeSource = options.defaultSource || defaultSource;
    if (!sourceDefs.some((source) => source.id === activeSource)) {
      activeSource = sourceDefs[0]?.id || defaultSource;
    }
    const pageSize = Math.max(24, Math.min(1000, Number(options.pageSize || options.initialPageSize) || 240));
    let visibleLimit = pageSize;
    let renderToken = 0;
    document.querySelectorAll('.gb-icon-picker').forEach((picker) => picker.remove());

    const picker = document.createElement('div');
    picker.className = 'gb-icon-picker gb-context-menu' + (options.className ? ' ' + options.className : '');
    picker.style.position = 'fixed';
    picker.style.zIndex = String(options.zIndex || 10004);
    let closeHandler = null;
    let keydownHandler = null;
    const removePicker = () => {
      renderToken++;
      picker.remove();
      if (closeHandler) document.removeEventListener('pointerdown', closeHandler, true);
      if (keydownHandler) document.removeEventListener('keydown', keydownHandler, true);
      closeHandler = null;
      keydownHandler = null;
    };

    const header = document.createElement('div');
    header.className = 'gb-icon-picker-header';
    const title = document.createElement('div');
    title.className = 'gb-icon-picker-title';
    title.textContent = options.title || 'アイコン';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'gb-icon-picker-close';
    closeBtn.title = '閉じる';
    closeBtn.innerHTML = typeof global.lucide === 'function' ? global.lucide('x', 14) : 'x';
    closeBtn.addEventListener('click', removePicker);
    header.append(title, closeBtn);
    picker.appendChild(header);

    const selectItem = (item) => {
      if (!item || !item.spec) return;
      if (typeof options.onSelect === 'function') options.onSelect(item.spec, item);
      removePicker();
    };

    if (presets.length) {
      const presetWrap = document.createElement('div');
      presetWrap.className = 'gb-icon-picker-presets';
      presets.forEach((item) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gb-icon-picker-preset';
        btn.title = item.label;
        if (sameSpec(item.spec, current)) btn.classList.add('is-selected');
        const previewColor = item.color ? ` style="color:${_escAttr(item.color)};"` : '';
        btn.innerHTML = `<span class="gb-icon-picker-preset-icon"${previewColor}>${render(item.spec, 18)}</span><span>${_esc(item.label)}</span>`;
        btn.addEventListener('click', () => selectItem(item));
        presetWrap.appendChild(btn);
      });
      picker.appendChild(presetWrap);
    }

    if (sourceDefs.length > 1) {
      const tabs = document.createElement('div');
      tabs.className = 'gb-icon-picker-tabs';
      sourceDefs.forEach((sourceDef) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'gb-icon-picker-tab';
        tab.textContent = sourceDef.label;
        tab.dataset.source = sourceDef.id;
        if (sourceDef.description) tab.title = sourceDef.description;
        if (sourceDef.id === activeSource) tab.classList.add('active');
        tab.addEventListener('click', () => {
          activeSource = sourceDef.id;
          visibleLimit = pageSize;
          tabs.querySelectorAll('.gb-icon-picker-tab').forEach((el) => el.classList.toggle('active', el === tab));
          renderGrid();
        });
        tabs.appendChild(tab);
      });
      picker.appendChild(tabs);
    }

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'gb-input gb-icon-picker-search';
    search.placeholder = options.placeholder || '検索';
    picker.appendChild(search);

    const grid = document.createElement('div');
    grid.className = 'gb-icon-picker-grid';
    const loading = document.createElement('div');
    loading.className = 'gb-icon-picker-empty';
    loading.textContent = options.loadingLabel || '読み込み中';
    grid.appendChild(loading);
    picker.appendChild(grid);

    if (typeof options.extraFooter === 'function') {
      const extra = options.extraFooter(picker);
      if (extra) picker.appendChild(extra);
    }

    const footer = document.createElement('div');
    footer.className = 'gb-icon-picker-footer';
    const credit = document.createElement('div');
    credit.className = 'gb-icon-picker-credit';
    credit.textContent = includeLucide && includeNoto
      ? 'Lucide (ISC) / Noto Emoji (OFL 1.1)'
      : includeNoto ? 'Noto Emoji (OFL 1.1)' : 'Lucide (ISC)';
    const actions = document.createElement('div');
    actions.className = 'gb-icon-picker-actions';
    if (options.allowReset) {
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'gb-btn gb-btn-xs gb-btn-quiet';
      reset.textContent = options.resetLabel || 'リセット';
      reset.addEventListener('click', () => {
        if (typeof options.onReset === 'function') options.onReset();
        removePicker();
      });
      actions.appendChild(reset);
    }
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'gb-btn gb-btn-xs gb-btn-quiet';
    cancel.textContent = 'キャンセル';
    cancel.addEventListener('click', removePicker);
    actions.appendChild(cancel);
    footer.append(credit, actions);
    picker.appendChild(footer);

    function getAllItems() {
      if (!allItems) allItems = _makeAllItems(options);
      return allItems;
    }

    function sourceMatches(item) {
      const sourceDef = sourceDefs.find((source) => source.id === activeSource);
      return _sourceDefMatches(sourceDef, item);
    }

    function renderGrid() {
      if (!picker.isConnected) return;
      const qRaw = search.value.trim();
      const q = _normalizeSearch(qRaw);
      const exactEmoji = qRaw && qRaw.length <= 8 ? qRaw : '';
      const filtered = getAllItems().filter((item) => {
        if (!sourceMatches(item)) return false;
        if (!q) return true;
        if (exactEmoji && item.emoji === exactEmoji) return true;
        return _normalizeSearch(item.search || item.label || item.spec).includes(q);
      });
      grid.textContent = '';
      const fragment = document.createDocumentFragment();
      filtered.slice(0, visibleLimit).forEach((item) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gb-icon-picker-cell';
        btn.title = item.label || item.spec;
        if (sameSpec(item.spec, current)) btn.classList.add('is-selected');
        btn.innerHTML = render(item.spec, options.itemSize || 22);
        btn.addEventListener('click', () => selectItem(item));
        fragment.appendChild(btn);
      });
      if (!filtered.length) {
        const empty = document.createElement('div');
        empty.className = 'gb-icon-picker-empty';
        empty.textContent = '該当するアイコンがありません';
        fragment.appendChild(empty);
      }
      if (filtered.length > visibleLimit) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'gb-icon-picker-more';
        more.textContent = 'さらに表示（残り' + (filtered.length - visibleLimit) + '件）';
        more.addEventListener('click', () => {
          visibleLimit += pageSize;
          renderGrid();
        });
        fragment.appendChild(more);
      }
      grid.appendChild(fragment);
    }

    function resetAndRenderGrid() {
      visibleLimit = pageSize;
      renderGrid();
    }

    function scheduleInitialRender() {
      const token = ++renderToken;
      const run = () => {
        if (token !== renderToken || !picker.isConnected) return;
        renderGrid();
      };
      if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(run);
      else window.setTimeout(run, 0);
    }

    search.addEventListener('input', resetAndRenderGrid);
    document.body.appendChild(picker);
    const anchorRect = options.anchorEl?.getBoundingClientRect?.() || {
      left: window.innerWidth / 2 - 180,
      right: window.innerWidth / 2 + 180,
      top: 80,
      bottom: 80,
    };
    if (typeof global.positionPopup === 'function') global.positionPopup(picker, anchorRect, { prefer: options.prefer || 'below' });
    else if (typeof global.clampPopupToViewport === 'function') global.clampPopupToViewport(picker);
    search.focus();
    scheduleInitialRender();

    closeHandler = (ev) => {
      if (!picker.contains(ev.target) && ev.target !== options.anchorEl) {
        removePicker();
      }
    };
    keydownHandler = (ev) => {
      if (ev.key === 'Escape') {
        removePicker();
      }
    };
    setTimeout(() => {
      if (!picker.isConnected || !closeHandler || !keydownHandler) return;
      document.addEventListener('pointerdown', closeHandler, true);
      document.addEventListener('keydown', keydownHandler, true);
    }, 0);
    return picker;
  }

  function _avatarColor(value, fallback) {
    const raw = String(value || '').trim();
    if (/^#[0-9a-f]{3,8}$/i.test(raw) || /^rgba?\(/i.test(raw) || /^hsla?\(/i.test(raw)) return raw;
    return fallback;
  }

  function toAvatarDataUrl(spec, options = {}) {
    const parsed = parseSpec(spec);
    const bg = _avatarColor(options.bg, '#000000');
    const fg = _avatarColor(options.fg || options.color, '#d4d4d4');
    let content = '';
    if (parsed.type === 'lucide') {
      const paths = _lucidePaths(parsed.name);
      content = `<svg x="34" y="34" width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="${_escAttr(fg)}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
    } else if (parsed.type === 'noto') {
      const emoji = parsed.emoji || codeToEmoji(parsed.code) || '?';
      content = `<text x="64" y="73" text-anchor="middle" dominant-baseline="middle" font-family="Meldex Noto Emoji, Noto Color Emoji, Segoe UI Emoji, Apple Color Emoji, sans-serif" font-size="66">${_esc(emoji)}</text>`;
    } else {
      content = `<text x="64" y="72" text-anchor="middle" dominant-baseline="middle" fill="${_escAttr(fg)}" font-family="Noto Sans JP, sans-serif" font-size="48" font-weight="700">${_esc((parsed.label || '?').slice(0, 2))}</text>`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="${_escAttr(bg)}"/>${content}</svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  global.GBIconAssets = {
    normalizeSpec,
    parseSpec,
    sameSpec,
    render,
    renderInto,
    listLucideIcons,
    listNotoEmoji,
    codeToEmoji,
    hasLucideName,
    openPicker,
    toAvatarDataUrl,
  };
})(window);
