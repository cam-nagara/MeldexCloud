/* gb-note-file-embed.js — ノートへのファイル埋め込み（Obsidianと同じ `![[パス]]` 記法）
 *
 * ノートの本文に `![[パス]]`（または `![[パス|高さ]]`）を1行で書くと、そのファイルを本文中に表示する。
 * ボード・シート・シナリオ・ノート・CSV・画像・動画・音声・PDF に対応し、その他の種類はファイルのカードを出す。
 *
 * - 保存されるのは `![[パス]]` の1行だけ。表示内容はノートに保存しない（他のアプリでも読める記法のまま）。
 * - 表示は Shadow DOM の中に描く。ノート本文の変更検知・取り消し履歴・自動保存に表示の書き換えが混ざらない。
 * - 表示は読み取り専用。「開く」で元のファイルをメインパネル／右のパネルで開いて編集する。
 * - 元のファイルが保存されたら、そのファイルを表示している埋め込みだけを描き直す（ノートは読み直さない）。
 * - 見えている埋め込みだけを描く（画面外の埋め込みはスクロールで近づいた時に読み込む）。
 */
(function initMeldexNoteFileEmbed(global) {
  'use strict';
  if (global.MeldexNoteFileEmbed) return;

  const LINE_RE = /^\s*!\[\[([^\[\]\n]{1,1024})\]\]\s*$/;
  const HOST_CLASS = 'meldex-file-embed';
  const MAX_NOTE_DEPTH = 2;
  const SHEET_ROW_LIMIT = 40;
  const SHEET_COLUMN_LIMIT = 6;
  const CSV_ROW_LIMIT = 60;
  const SCENARIO_ROW_LIMIT = 60;
  const MIN_HEIGHT = 120;
  const MAX_HEIGHT = 2400;

  const KIND_BY_EXT = {
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', svg: 'image', avif: 'image', ico: 'image',
    mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', ogv: 'video',
    mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio', aac: 'audio', opus: 'audio',
    pdf: 'pdf',
    'mel-board': 'board', 'mel-sheet': 'sheet', 'mel-scenario': 'scenario', 'mel-map': 'map', 'mel-form': 'form', 'mel-timer': 'timer',
    csv: 'csv', tsv: 'csv',
    md: 'note', markdown: 'note', txt: 'note',
  };
  const KIND_LABELS = {
    image: '画像', video: '動画', audio: '音声', pdf: 'PDF', board: 'ボード', sheet: 'シート', scenario: 'シナリオ',
    map: 'マップ', form: 'フォーム', timer: 'タイマー', csv: 'CSV', note: 'ノート', folder: 'フォルダ', file: 'ファイル',
  };
  const KIND_ICONS = {
    image: 'image', video: 'video', audio: 'audio', pdf: 'fileText', board: 'layoutDashboard', sheet: 'table', scenario: 'clapperboard',
    map: 'map', form: 'clipboardList', timer: 'timer', csv: 'table', note: 'fileText', folder: 'folder', file: 'file',
  };
  const BOARD_AUTO_MAX_HEIGHT = 900;
  const DEFAULT_HEIGHT = { board: 0, sheet: 0, scenario: 0, csv: 0, pdf: 560, note: 0, video: 0, audio: 0, image: 0 };

  // ------------------------------------------------------------------
  //  記法の読み書き
  // ------------------------------------------------------------------
  const _attr = value => global.MeldexEscape.attr(value);
  const _html = value => global.MeldexEscape.html(value);

  function parseTarget(inner) {
    const raw = String(inner || '').trim();
    if (!raw) return null;
    const bar = raw.indexOf('|');
    const target = (bar < 0 ? raw : raw.slice(0, bar)).trim();
    const option = (bar < 0 ? '' : raw.slice(bar + 1)).trim();
    if (!target || /^(?:javascript|vbscript|data|file):/i.test(target) || /^[a-z][a-z0-9+.-]*:\/\//i.test(target)) return null;
    const hash = target.indexOf('#');
    const path = (hash < 0 ? target : target.slice(0, hash)).trim().replace(/\\/g, '/');
    const section = hash < 0 ? '' : target.slice(hash + 1).trim();
    if (!path) return null;
    let size = 0;
    const sizeMatch = option.match(/^(?:h=)?(\d{2,4})$/i);
    if (sizeMatch) size = Math.max(40, Math.min(MAX_HEIGHT, Number(sizeMatch[1])));
    return { path, section, size, option: sizeMatch ? '' : option };
  }

  function kindForPath(path) {
    const name = String(path || '').split('/').pop() || '';
    const lower = name.toLowerCase();
    if (lower.endsWith('.scriptnote.json')) return 'scenario';
    const mel = lower.match(/\.(mel-[a-z]+)$/);
    if (mel) return KIND_BY_EXT[mel[1]] || 'file';
    const dot = lower.lastIndexOf('.');
    if (dot <= 0) return 'folder';
    return KIND_BY_EXT[lower.slice(dot + 1)] || 'file';
  }

  function displayName(path) {
    const name = String(path || '').split('/').filter(Boolean).pop() || String(path || '');
    return name.replace(/\.(mel-[a-z]+|md|markdown|txt)$/i, '');
  }

  function blockHtmlForLine(line) {
    const match = String(line || '').match(LINE_RE);
    if (!match) return '';
    const target = parseTarget(match[1]);
    if (!target) return '';
    const kind = kindForPath(target.path);
    const source = match[1].trim();
    // 埋め込み表示に対応していない面（書き出し等）でも読めるよう、元へのリンクを中に置く。
    return `<div class="${HOST_CLASS}" contenteditable="false" data-embed-source="${_attr(source)}"`
      + ` data-embed-path="${_attr(target.path)}" data-embed-kind="${kind}"`
      + (target.size ? ` data-embed-size="${target.size}"` : '')
      + `><a class="meldex-file-embed-fallback" href="${_attr(target.path)}">${_html(displayName(target.path))}</a></div>`;
  }

  function markdownForElement(element) {
    const path = String(element?.dataset?.embedPath || '').trim();
    if (!path) {
      const source = String(element?.dataset?.embedSource || '').trim();
      return source ? '![[' + source + ']]' : '';
    }
    const target = parseTarget(element.dataset.embedSource || path) || { section: '', option: '' };
    const size = Number(element.dataset.embedSize || 0);
    let out = path;
    if (target.section) out += '#' + target.section;
    if (size) out += '|' + size;
    else if (target.option) out += '|' + target.option;
    return '![[' + out + ']]';
  }

  // blockHtmlForLine と同じ要素を、文字列を経由せずに組み立てる（挿入・貼り付け用）。
  function hostElementForLine(line) {
    const match = String(line || '').match(LINE_RE);
    const target = match ? parseTarget(match[1]) : null;
    if (!target) return null;
    const doc = global.document;
    const host = doc.createElement('div');
    host.className = HOST_CLASS;
    host.setAttribute('contenteditable', 'false');
    host.dataset.embedSource = match[1].trim();
    host.dataset.embedPath = target.path;
    host.dataset.embedKind = kindForPath(target.path);
    if (target.size) host.dataset.embedSize = String(target.size);
    const fallback = doc.createElement('a');
    fallback.className = 'meldex-file-embed-fallback';
    fallback.setAttribute('href', target.path);
    fallback.textContent = displayName(target.path);
    host.appendChild(fallback);
    return host;
  }

  function _createHostElement(path, options) {
    const sizeText = options?.size ? '|' + Math.round(options.size) : '';
    return hostElementForLine('![[' + path + sizeText + ']]');
  }

  // ------------------------------------------------------------------
  //  パスの解決
  // ------------------------------------------------------------------
  function _normalizePath(path) {
    const out = [];
    String(path || '').replace(/\\/g, '/').split('/').forEach(part => {
      if (!part || part === '.') return;
      if (part === '..') { out.pop(); return; }
      out.push(part);
    });
    return out.join('/');
  }

  function _notePathFor(host) {
    const owner = host?.closest?.('[data-path]');
    return String(owner?.dataset?.path || host?.dataset?.embedBase || '').replace(/\\/g, '/');
  }

  // `作品/…/図.mel-board` のようにソースフォルダ起点で書くのが基本。`./` `../` や
  // フォルダを含まない名前はノートのあるフォルダを起点にする。
  function resolvePath(rawPath, notePath) {
    const raw = String(rawPath || '').replace(/\\/g, '/').trim();
    if (!raw) return '';
    if (/^(?:home|source|vault):\//.test(raw)) return raw;
    const noteDir = String(notePath || '').replace(/\\/g, '/').replace(/\/[^/]*$/, '');
    if (raw.startsWith('./') || raw.startsWith('../') || (!raw.includes('/') && noteDir && noteDir !== notePath)) {
      return _normalizePath((noteDir ? noteDir + '/' : '') + raw);
    }
    return _normalizePath(raw);
  }

  function _rawUrl(path) {
    return '/api/file-raw?path=' + encodeURIComponent(path);
  }

  // ------------------------------------------------------------------
  //  読み込み（同じファイルの埋め込みは読み込みを共有する）
  // ------------------------------------------------------------------
  const textCache = new Map();
  const sheetCache = new Map();

  async function _fetchText(path) {
    if (textCache.has(path)) return textCache.get(path);
    const pending = (async () => {
      const response = await global.fetch(_rawUrl(path), { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) {
        const error = new Error(response.status === 404 ? 'missing' : 'failed');
        error.status = response.status;
        throw error;
      }
      return await response.text();
    })();
    textCache.set(path, pending);
    pending.catch(() => { if (textCache.get(path) === pending) textCache.delete(path); });
    return pending;
  }

  async function _fetchSheet(path) {
    if (sheetCache.has(path)) return sheetCache.get(path);
    if (typeof global.apiFetch !== 'function') throw new Error('failed');
    const pending = global.apiFetch('/pivot?path=' + encodeURIComponent(path), { silentError: true });
    sheetCache.set(path, pending);
    pending.catch(() => { if (sheetCache.get(path) === pending) sheetCache.delete(path); });
    return pending;
  }

  function invalidate(path) {
    const target = String(path || '').replace(/\\/g, '/');
    for (const key of [...textCache.keys()]) if (_samePathOrInside(key, target)) textCache.delete(key);
    for (const key of [...sheetCache.keys()]) if (_samePathOrInside(key, target) || _samePathOrInside(target, key)) sheetCache.delete(key);
  }

  function _samePathOrInside(path, parent) {
    const a = String(path || '');
    const b = String(parent || '');
    return !!a && !!b && (a === b || a.startsWith(b.replace(/\/+$/, '') + '/'));
  }

  // ------------------------------------------------------------------
  //  表示の部品
  // ------------------------------------------------------------------
  const SHADOW_CSS = `
:host { display: block; margin: 10px 0; }
.mfe { position: relative; border: 1px solid var(--border, #3a3f46); border-radius: 8px; background: var(--bg2, #16191e);
  color: var(--fg, #e5e7eb); overflow: hidden; font-family: inherit; }
.mfe-head { display: flex; align-items: center; gap: 6px; height: 28px; padding: 0 6px 0 8px; border-bottom: 1px solid var(--border, #3a3f46);
  background: color-mix(in srgb, var(--bg3, #1f2329) 70%, transparent); font-size: 12px; }
.mfe-head .mfe-icon { display: inline-flex; width: 14px; height: 14px; color: var(--fg2, #9aa0a6); flex: 0 0 14px; }
.mfe-head .mfe-icon svg { width: 14px; height: 14px; }
.mfe-title { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--fg, #e5e7eb);
  background: none; border: 0; padding: 0; font: inherit; text-align: left; cursor: pointer; }
.mfe-title:hover { text-decoration: underline; }
.mfe-kind { color: var(--fg2, #9aa0a6); flex: 0 0 auto; }
.mfe-btn { height: 22px; padding: 0 8px; border: 1px solid var(--border, #3a3f46); border-radius: 4px; background: transparent;
  color: var(--fg, #e5e7eb); font: inherit; font-size: 12px; cursor: pointer; flex: 0 0 auto; }
.mfe-btn:hover { background: var(--bg3, #1f2329); }
.mfe-body { position: relative; overflow: auto; }
.mfe-body.mfe-fixed { overflow: auto; }
.mfe-body:not(.mfe-fixed) { max-height: 520px; }
.mfe[data-kind="board"] .mfe-body, .mfe[data-kind="image"] .mfe-body, .mfe[data-kind="video"] .mfe-body, .mfe[data-kind="note"] .mfe-body { max-height: none; }
.mfe-status { padding: 14px 12px; color: var(--fg2, #9aa0a6); font-size: 12px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mfe-status.mfe-error { color: var(--danger, #f87171); }
.mfe-resize { position: absolute; left: 0; right: 0; bottom: 0; height: 6px; cursor: ns-resize; }
.mfe-resize:hover { background: color-mix(in srgb, var(--accent, #3b82f6) 35%, transparent); }
.mfe-media { display: block; max-width: 100%; margin: 0 auto; }
.mfe-pdf { display: block; width: 100%; height: 100%; border: 0; background: #fff; }
table.mfe-table { border-collapse: collapse; width: 100%; font-size: 12px; }
.mfe-table th, .mfe-table td { border: 1px solid var(--border, #3a3f46); padding: 3px 8px; text-align: left; vertical-align: top;
  max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mfe-table th { position: sticky; top: 0; background: var(--bg3, #1f2329); font-weight: 600; z-index: 1; }
.mfe-more { padding: 6px 10px; color: var(--fg2, #9aa0a6); font-size: 12px; }
.mfe-note { padding: 8px 14px; font-size: 14px; line-height: 1.7; max-height: 520px; overflow: auto; }
.mfe-note h1, .mfe-note h2, .mfe-note h3 { margin: 0.6em 0 0.3em; line-height: 1.35; }
.mfe-note h1 { font-size: 1.4em; } .mfe-note h2 { font-size: 1.2em; } .mfe-note h3 { font-size: 1.08em; }
.mfe-note p, .mfe-note div { margin: 0; }
.mfe-note ul, .mfe-note ol { margin: 0.2em 0; padding-left: 1.6em; }
.mfe-note img, .mfe-note video { max-width: 100%; }
.mfe-note table { border-collapse: collapse; }
.mfe-note pre { white-space: pre-wrap; }
.mfe-note .meldex-file-embed-fallback, .mfe-note a { color: var(--accent, #60a5fa); }
.mfe-scenario { padding: 8px 14px; font-size: 13px; line-height: 1.7; }
.mfe-scenario .mfe-sc-row { display: flex; gap: 10px; }
.mfe-scenario .mfe-sc-who { flex: 0 0 7em; color: var(--fg2, #9aa0a6); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mfe-scenario .mfe-sc-text { flex: 1 1 auto; white-space: pre-wrap; }
.mfe-scenario .mfe-sc-head { font-weight: 700; margin-top: 6px; }
.mfe-card { display: flex; align-items: center; gap: 10px; padding: 14px; font-size: 13px; }
.mfe-card .mfe-path { color: var(--fg2, #9aa0a6); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* ボードの静的表示 */
.mfe-board { position: relative; overflow: hidden; background: var(--bd-bg, var(--content-bg, var(--bg, #0f1216))); }
.mfe-board-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.mfe-board-svg { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.mfe-bnode { position: absolute; box-sizing: border-box; padding: 6px 8px; border: 0 solid transparent; border-radius: 6px;
  font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; white-space: normal; text-align: center; }
.mfe-bnode[data-shape="ellipse"] { border-radius: 50%; }
.mfe-bnode[data-shape="pill"] { border-radius: 999px; }
.mfe-bnode[data-shape="accent-card"] { padding: 10px 14px 12px 12px; text-align: left; line-height: 1.55; }
.mfe-bnode[data-shape="accent-card"] .mfe-bnode-title { display: block; font-weight: 700; font-size: 1.15em; line-height: 1.4;
  color: color-mix(in srgb, var(--mfe-accent, var(--accent, #3b82f6)) 82%, currentColor); }
.mfe-bnode[data-shape="accent-card"] .mfe-bnode-body { display: block; margin-top: 6px; }
.mfe-bnode img { max-width: 100%; display: block; }
`;

  function _icon(name) {
    const span = global.document.createElement('span');
    span.className = 'mfe-icon';
    if (typeof global.lucide === 'function') {
      try {
        const markup = global.lucide(name, 14);
        if (markup) {
          const template = global.document.createElement('template');
          template.innerHTML = String(markup);
          span.appendChild(template.content);
        }
      } catch { /* アイコン無しで続ける */ }
    }
    return span;
  }

  function _el(tag, className, text) {
    const element = global.document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function _button(label, action, title) {
    const button = _el('button', 'mfe-btn', label);
    button.type = 'button';
    button.dataset.mfeAction = action;
    button.dataset.e2eId = 'note-file-embed-' + action;
    button.title = title || label;
    button.setAttribute('aria-label', title || label);
    return button;
  }

  function _status(body, text, options) {
    body.textContent = '';
    const status = _el('div', 'mfe-status' + (options?.error ? ' mfe-error' : ''), text);
    status.setAttribute('role', options?.error ? 'alert' : 'status');
    if (options?.retry) status.appendChild(_button('再試行', 'retry'));
    body.appendChild(status);
  }

  // ------------------------------------------------------------------
  //  種類ごとの表示
  // ------------------------------------------------------------------
  // Cloud・スマホではファイルを保存先から取り寄せて表示する。画面全体の書き換え監視は
  // 埋め込みの表示（Shadow DOM）の中まで届かないため、ここで同じ処理を呼ぶ。
  function _isBrowserData() {
    const runtime = global.MeldexRuntimeAdapter;
    return !!(runtime?.isBrowserDataMode?.() || runtime?.isDropboxMode?.());
  }

  function _setFileSource(element, path) {
    if (_isBrowserData() && typeof global.MeldexPwaFileUrl?.applyToElement === 'function') {
      global.MeldexPwaFileUrl.applyToElement(element, path, 'src');
      return;
    }
    element.src = _rawUrl(path);
  }

  function _fileSourcesWithin(root) {
    if (!_isBrowserData() || typeof global.MeldexPwaFileUrl?.applyToElement !== 'function') return;
    root.querySelectorAll('[src]').forEach(element => {
      const path = global.MeldexPwaFileUrl.extractPath?.(element.getAttribute('src'));
      if (path) global.MeldexPwaFileUrl.applyToElement(element, path, 'src');
    });
  }

  function _renderMedia(body, kind, path, size) {
    body.textContent = '';
    let media;
    if (kind === 'image') {
      media = _el('img', 'mfe-media');
      media.alt = displayName(path);
      media.loading = 'lazy';
      if (size) media.style.width = Math.min(size, 2400) + 'px';
      media.addEventListener('error', () => _status(body, '画像を読み込めませんでした', { error: true, retry: true }), { once: true });
    } else if (kind === 'video' || kind === 'audio') {
      media = _el(kind, 'mfe-media');
      media.controls = true;
      media.preload = 'metadata';
      if (kind === 'video' && size) media.style.width = Math.min(size, 2400) + 'px';
      if (kind === 'audio') media.style.width = '100%';
    } else {
      media = _el('iframe', 'mfe-pdf');
      media.title = displayName(path);
      media.loading = 'lazy';
    }
    _setFileSource(media, path);
    body.appendChild(media);
  }

  function _stripFrontmatter(text) {
    const normalized = String(text || '').replace(/\r\n?/g, '\n');
    const match = normalized.match(/^---\n[\s\S]*?\n---\n?/);
    return match ? normalized.slice(match[0].length) : normalized;
  }

  function _frontmatterType(text) {
    const match = String(text || '').replace(/\r\n?/g, '\n').match(/^---\n([\s\S]*?)\n---/);
    const type = match && match[1].match(/^type:\s*["']?([\w-]+)/m);
    return type ? type[1] : '';
  }

  function _sectionOf(markdown, section) {
    if (!section) return markdown;
    const lines = markdown.split('\n');
    const wanted = section.replace(/^#+\s*/, '').trim();
    let start = -1; let level = 0;
    for (let i = 0; i < lines.length; i++) {
      const heading = lines[i].match(/^(#{1,6})\s+(.*)$/);
      if (!heading) continue;
      if (start < 0 && heading[2].trim() === wanted) { start = i; level = heading[1].length; continue; }
      if (start >= 0 && heading[1].length <= level) return lines.slice(start, i).join('\n');
    }
    return start >= 0 ? lines.slice(start).join('\n') : markdown;
  }

  function _renderNote(body, text, path, host, section) {
    body.textContent = '';
    const wrap = _el('div', 'mfe-note');
    const markdown = _sectionOf(_stripFrontmatter(text), section);
    if (typeof global.mdToHtml === 'function') {
      // ノート本文と同じ変換器の出力（Markdown中のHTMLはエスケープ済み）。
      wrap.innerHTML = global.mdToHtml(markdown, { basePath: path });
    } else {
      wrap.textContent = markdown;
    }
    body.appendChild(wrap);
    _fileSourcesWithin(wrap);
    // 埋め込まれたノートの中の埋め込みは2段目まで表示する（循環・入れ子の際限なしを防ぐ）。
    const depth = Number(host?.dataset?.embedDepth || 0) + 1;
    wrap.querySelectorAll('.' + HOST_CLASS).forEach(inner => {
      inner.dataset.embedBase = path;
      inner.dataset.embedDepth = String(depth);
      if (depth < MAX_NOTE_DEPTH && !_isAncestorPath(host, resolvePath(inner.dataset.embedPath, path))) hydrateElement(inner);
    });
  }

  function _isAncestorPath(host, path) {
    let current = host;
    while (current) {
      if (current.dataset?.embedResolved === path) return true;
      const root = current.getRootNode?.();
      current = root && root.host ? root.host : null;
    }
    return false;
  }

  function _candidateText(value, entityNames) {
    if (value == null) return '';
    if (Array.isArray(value)) {
      if (!value.length) return '';
      const adopted = value.find(item => item && typeof item === 'object' && item.status === '採用') || value[0];
      return _candidateText(adopted, entityNames);
    }
    if (typeof value === 'object') {
      if ('value' in value) return _candidateText(value.value, entityNames);
      return '';
    }
    const text = String(value);
    if (/^ent_[0-9a-f]{6,}$/i.test(text)) return entityNames.get(text) || '（参照）';
    return text.replace(/\s+/g, ' ');
  }

  function _renderSheet(body, data, path) {
    body.textContent = '';
    const entities = data && typeof data.entities === 'object' ? data.entities : {};
    const names = Object.keys(entities);
    if (!names.length && !Array.isArray(data?.properties)) {
      _renderFileCard(body, 'folder', path);
      return;
    }
    const entityNames = new Map();
    names.forEach(name => { const id = entities[name]?._id; if (id) entityNames.set(id, name); });
    const columns = (Array.isArray(data.properties) ? data.properties : [])
      .filter(name => typeof name === 'string' && !name.startsWith('_')).slice(0, SHEET_COLUMN_LIMIT);
    const table = _el('table', 'mfe-table');
    const head = _el('tr');
    head.appendChild(_el('th', '', '名前'));
    columns.forEach(name => head.appendChild(_el('th', '', name)));
    table.appendChild(_el('thead')).appendChild(head);
    const tbody = table.appendChild(_el('tbody'));
    names.slice(0, SHEET_ROW_LIMIT).forEach(name => {
      const row = _el('tr');
      row.appendChild(_el('td', '', name));
      columns.forEach(column => row.appendChild(_el('td', '', _candidateText(entities[name]?.[column], entityNames))));
      tbody.appendChild(row);
    });
    body.appendChild(table);
    if (!names.length) body.appendChild(_el('div', 'mfe-more', 'トピックはまだありません'));
    else if (names.length > SHEET_ROW_LIMIT) body.appendChild(_el('div', 'mfe-more', `ほか ${names.length - SHEET_ROW_LIMIT} 件（開くとすべて表示します）`));
  }

  function _parseCsv(text, delimiter) {
    const rows = [];
    let row = []; let cell = ''; let quoted = false;
    const src = String(text || '').replace(/\r\n?/g, '\n');
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (quoted) {
        if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"' && cell === '') quoted = true;
      else if (ch === delimiter) { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; if (rows.length > CSV_ROW_LIMIT) break; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function _renderCsv(body, text, path) {
    body.textContent = '';
    const rows = _parseCsv(text, /\.tsv$/i.test(path) ? '\t' : ',');
    if (!rows.length) { _status(body, '内容はありません'); return; }
    const table = _el('table', 'mfe-table');
    const head = _el('tr');
    rows[0].forEach(value => head.appendChild(_el('th', '', value)));
    table.appendChild(_el('thead')).appendChild(head);
    const tbody = table.appendChild(_el('tbody'));
    rows.slice(1, CSV_ROW_LIMIT).forEach(values => {
      const row = _el('tr');
      values.forEach(value => row.appendChild(_el('td', '', value)));
      tbody.appendChild(row);
    });
    body.appendChild(table);
    if (rows.length > CSV_ROW_LIMIT) body.appendChild(_el('div', 'mfe-more', '以降の行は開くと表示します'));
  }

  function _renderScenario(body, text) {
    body.textContent = '';
    let data;
    try { data = JSON.parse(text); } catch { _status(body, 'シナリオを読み込めませんでした', { error: true, retry: true }); return; }
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const wrap = _el('div', 'mfe-scenario');
    if (data?.title) wrap.appendChild(_el('div', 'mfe-sc-head', String(data.title)));
    const characters = new Map((Array.isArray(data?.characters) ? data.characters : [])
      .map(item => [String(item?.id || ''), String(item?.name || '')]));
    rows.slice(0, SCENARIO_ROW_LIMIT).forEach(row => {
      const textValue = String(row?.text ?? row?.content ?? row?.dialogue ?? '').trim();
      const who = String(row?.character ?? row?.speaker ?? row?.name ?? '');
      const whoName = characters.get(who) || who;
      if (!textValue && !whoName) return;
      const line = _el('div', 'mfe-sc-row');
      line.appendChild(_el('span', 'mfe-sc-who', whoName || String(row?.type || '')));
      line.appendChild(_el('span', 'mfe-sc-text', textValue));
      wrap.appendChild(line);
    });
    if (!rows.length) wrap.appendChild(_el('div', 'mfe-more', '行はまだありません'));
    else if (rows.length > SCENARIO_ROW_LIMIT) wrap.appendChild(_el('div', 'mfe-more', `ほか ${rows.length - SCENARIO_ROW_LIMIT} 行（開くとすべて表示します）`));
    body.appendChild(wrap);
  }

  function _renderFileCard(body, kind, path) {
    body.textContent = '';
    const card = _el('div', 'mfe-card');
    const icon = _icon(KIND_ICONS[kind] || 'file');
    icon.style.width = icon.style.height = '20px';
    card.appendChild(icon);
    const textBox = _el('div');
    textBox.appendChild(_el('div', '', displayName(path)));
    textBox.appendChild(_el('div', 'mfe-path', (KIND_LABELS[kind] || 'ファイル') + ' ・ 開いて表示します'));
    card.appendChild(textBox);
    body.appendChild(card);
  }

  // ---- ボード（保存内容から読み取り専用の図を描く） ----
  function _boardStyleLookup(board) {
    const fromFile = Array.isArray(board.cardStyles) && board.cardStyles.length ? board.cardStyles : null;
    const builtins = typeof global.bdDefaultCardStylesForBoard === 'function' ? global.bdDefaultCardStylesForBoard(board) : [];
    const cards = new Map();
    builtins.forEach(style => style?.id && cards.set(style.id, style));
    (fromFile || []).forEach(style => style?.id && cards.set(style.id, style));
    const firstCard = (fromFile && fromFile[0]) || builtins[0] || {};
    const lineBuiltins = typeof global.bdDefaultLineStylesForBoard === 'function' ? global.bdDefaultLineStylesForBoard(board) : [];
    const lines = new Map();
    lineBuiltins.forEach(style => style?.id && lines.set(style.id, style));
    (Array.isArray(board.lineStyles) ? board.lineStyles : []).forEach(style => style?.id && lines.set(style.id, style));
    const firstLine = (Array.isArray(board.lineStyles) && board.lineStyles[0]) || lineBuiltins[0] || {};
    return { cards, firstCard, lines, firstLine };
  }

  function _pick(node, style, key, fallback) {
    if (node && node[key] !== undefined) return node[key];
    if (style && style[key] !== undefined && style[key] !== '') return style[key];
    return fallback;
  }

  function _boardNodeStyle(board, node, lookup) {
    const style = (node.cardStyle && lookup.cards.get(node.cardStyle)) || lookup.firstCard;
    const base = {
      bgColor: _pick(node, style, 'bgColor', ''),
      textColor: _pick(node, style, 'textColor', ''),
      borderColor: _pick(node, style, 'borderColor', ''),
      borderWidth: +_pick(node, style, 'borderWidth', 0) || 0,
      borderRadius: _pick(node, style, 'borderRadius', 6),
      fontSize: +_pick(node, style, 'fontSize', 13) || 13,
      fontBold: !!_pick(node, style, 'fontBold', false),
      shape: String(_pick(node, style, 'shape', '') || ''),
    };
    if (global.MeldexThemeColoring && typeof global.MeldexThemeColoring.resolveNodeStyle === 'function') {
      try { return global.MeldexThemeColoring.resolveNodeStyle({ board, node, baseStyle: base }); } catch { return base; }
    }
    return base;
  }

  function _safeColor(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw || raw.length > 120 || /[<>{};\\]|url\s*\(|expression\s*\(/i.test(raw)) return '';
    return raw;
  }

  function _renderBoard(body, text, path, height) {
    body.textContent = '';
    if (typeof global.bdParseMd !== 'function') { _renderFileCard(body, 'board', path); return; }
    let board;
    try { board = global.bdParseMd(text); } catch { _status(body, 'ボードを読み込めませんでした', { error: true, retry: true }); return; }
    const nodes = (Array.isArray(board?.nodes) ? board.nodes : []).filter(node => node && !node.contained);
    if (!nodes.length) { _status(body, 'トピックはまだありません'); return; }
    const lookup = _boardStyleLookup(board);
    const doc = global.document;
    const stage = _el('div', 'mfe-board');
    if (height) stage.style.height = height + 'px';
    const world = _el('div', 'mfe-board-world');
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'mfe-board-svg');
    world.appendChild(svg);
    let minX = Infinity; let minY = Infinity;
    nodes.forEach(node => { minX = Math.min(minX, +node.x || 0); minY = Math.min(minY, +node.y || 0); });
    const elements = new Map();
    nodes.forEach(node => {
      const style = _boardNodeStyle(board, node, lookup);
      const element = _el('div', 'mfe-bnode');
      element.dataset.shape = style.shape || 'rect';
      element.style.left = ((+node.x || 0) - minX) + 'px';
      element.style.top = ((+node.y || 0) - minY) + 'px';
      element.style.width = (+node.w || 160) + 'px';
      if (+node.h) element.style.minHeight = (+node.h) + 'px';
      const bg = _safeColor(style.bgColor); if (bg) element.style.background = bg;
      const fg = _safeColor(style.textColor); if (fg) element.style.color = fg;
      const border = _safeColor(style.borderColor);
      const borderWidth = Math.max(0, Math.min(20, +style.borderWidth || 0));
      if (border && borderWidth) { element.style.borderColor = border; element.style.borderWidth = borderWidth + 'px'; element.style.borderStyle = 'solid'; }
      if (style.shape !== 'ellipse' && style.shape !== 'pill' && style.borderRadius != null) element.style.borderRadius = Math.max(0, +style.borderRadius || 0) + 'px';
      element.style.fontSize = Math.max(8, Math.min(72, +style.fontSize || 13)) + 'px';
      if (style.fontBold) element.style.fontWeight = '700';
      const textValue = String(node.text || '');
      if (style.shape === 'accent-card') {
        const accent = border || 'var(--accent, #3b82f6)';
        element.style.borderStyle = 'solid';
        if (!borderWidth) { element.style.borderColor = accent; element.style.borderWidth = '1px'; }
        element.style.borderLeftColor = accent;
        element.style.borderLeftWidth = Math.max(4, Math.min(16, Math.round((borderWidth || 1.5) * 4))) + 'px';
        element.style.setProperty('--mfe-accent', accent);
        const [title, ...rest] = textValue.split('\n');
        element.appendChild(_el('span', 'mfe-bnode-title', title));
        if (rest.length) element.appendChild(_el('span', 'mfe-bnode-body', rest.join('\n'))).style.whiteSpace = 'pre-wrap';
      } else {
        element.style.whiteSpace = 'pre-wrap';
        element.textContent = textValue;
      }
      if (node.img && /^[^:]+$/.test(String(node.imageSourcePath || node.img || ''))) {
        const img = _el('img');
        img.alt = '';
        img.loading = 'lazy';
        _setFileSource(img, String(node.imageSourcePath || node.img));
        element.prepend(img);
      }
      world.appendChild(element);
      elements.set(node.id, { node, element });
    });
    stage.appendChild(world);
    body.appendChild(stage);
    // 文章の折り返しで高さが決まってから線を引き、全体が収まる倍率にする。
    const layout = () => {
      if (!stage.isConnected) return;
      const rects = new Map();
      let maxX = 0; let maxY = 0;
      elements.forEach(({ element }, id) => {
        const rect = { x: element.offsetLeft, y: element.offsetTop, w: element.offsetWidth, h: element.offsetHeight };
        rects.set(id, rect);
        maxX = Math.max(maxX, rect.x + rect.w); maxY = Math.max(maxY, rect.y + rect.h);
      });
      _drawBoardLines(svg, board, rects, lookup);
      svg.setAttribute('width', String(maxX + 20));
      svg.setAttribute('height', String(maxY + 20));
      const pad = 16;
      const availableW = Math.max(120, stage.clientWidth - pad * 2);
      // 高さ未指定: 幅に合わせて縮め、高さは内容に合わせる（上限を超える縦長の図は全体が収まる倍率）。
      // 高さ指定あり: 指定の枠に全体が収まる倍率。
      let scale = Math.min(1, availableW / Math.max(1, maxX));
      if (height) {
        scale = Math.min(scale, Math.max(80, height - pad * 2) / Math.max(1, maxY));
      } else {
        scale = Math.min(scale, (BOARD_AUTO_MAX_HEIGHT - pad * 2) / Math.max(1, maxY));
        stage.style.height = Math.ceil(maxY * scale + pad * 2) + 'px';
      }
      const availableH = Math.max(80, (height || stage.clientHeight) - pad * 2);
      const offsetX = pad + Math.max(0, (availableW - maxX * scale) / 2);
      const offsetY = pad + Math.max(0, (availableH - maxY * scale) / 2);
      world.style.width = maxX + 'px';
      world.style.height = maxY + 'px';
      world.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
      stage.dataset.scale = String(Math.round(scale * 1000) / 1000);
    };
    layout();
    if (typeof global.ResizeObserver === 'function') {
      let frame = 0;
      const observer = new global.ResizeObserver(() => {
        if (frame) return;
        frame = global.requestAnimationFrame(() => { frame = 0; layout(); });
      });
      observer.observe(stage);
      body._mfeDispose = () => observer.disconnect();
    }
  }

  function _anchor(rect, side) {
    if (side === 'left') return { x: rect.x, y: rect.y + rect.h / 2 };
    if (side === 'right') return { x: rect.x + rect.w, y: rect.y + rect.h / 2 };
    if (side === 'top') return { x: rect.x + rect.w / 2, y: rect.y };
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h };
  }

  function _drawBoardLines(svg, board, rects, lookup) {
    const ns = 'http://www.w3.org/2000/svg';
    while (svg.firstChild) svg.firstChild.remove();
    const defs = global.document.createElementNS(ns, 'defs');
    svg.appendChild(defs);
    const markers = new Map();
    const marker = color => {
      if (markers.has(color)) return markers.get(color);
      const id = 'mfe-arrow-' + markers.size;
      const element = global.document.createElementNS(ns, 'marker');
      element.setAttribute('id', id);
      element.setAttribute('viewBox', '0 0 10 10');
      element.setAttribute('refX', '9'); element.setAttribute('refY', '5');
      element.setAttribute('markerWidth', '7'); element.setAttribute('markerHeight', '7');
      element.setAttribute('orient', 'auto-start-reverse');
      const head = global.document.createElementNS(ns, 'path');
      head.setAttribute('d', 'M0,0 L10,5 L0,10 z');
      head.setAttribute('fill', color);
      element.appendChild(head);
      defs.appendChild(element);
      markers.set(color, id);
      return id;
    };
    (Array.isArray(board.connections) ? board.connections : []).forEach(conn => {
      const a = rects.get(conn?.from); const b = rects.get(conn?.to);
      if (!a || !b) return;
      const style = (conn.styleRef && lookup.lines.get(conn.styleRef)) || lookup.firstLine || {};
      const color = _safeColor(conn.color || style.color) || 'var(--fg2, #9aa0a6)';
      const width = Math.max(0.5, Math.min(12, +(conn.width ?? style.width) || 1.5));
      const arrow = conn.arrow !== undefined ? conn.arrow : (style.arrow ?? 'end');
      const pathType = conn.pathType || style.pathType || 'curve';
      const horizontal = b.x >= a.x + a.w || b.x + b.w <= a.x;
      let start; let end;
      if (horizontal) {
        const forward = b.x >= a.x + a.w;
        start = _anchor(a, forward ? 'right' : 'left'); end = _anchor(b, forward ? 'left' : 'right');
      } else {
        const down = b.y >= a.y + a.h / 2;
        start = _anchor(a, down ? 'bottom' : 'top'); end = _anchor(b, down ? 'top' : 'bottom');
      }
      let d;
      if (pathType === 'straight') d = `M${start.x},${start.y} L${end.x},${end.y}`;
      else if (pathType === 'orthogonal' || pathType === 'orthogonal-curve') {
        const ratio = Number.isFinite(+conn.branchRatio) ? +conn.branchRatio : (Number.isFinite(+style.branchRatio) ? +style.branchRatio : 0.5);
        if (horizontal) { const mx = start.x + (end.x - start.x) * ratio; d = `M${start.x},${start.y} H${mx} V${end.y} H${end.x}`; }
        else { const my = start.y + (end.y - start.y) * ratio; d = `M${start.x},${start.y} V${my} H${end.x} V${end.y}`; }
      } else if (horizontal) {
        const mx = (start.x + end.x) / 2; d = `M${start.x},${start.y} C${mx},${start.y} ${mx},${end.y} ${end.x},${end.y}`;
      } else {
        const my = (start.y + end.y) / 2; d = `M${start.x},${start.y} C${start.x},${my} ${end.x},${my} ${end.x},${end.y}`;
      }
      const line = global.document.createElementNS(ns, 'path');
      line.setAttribute('d', d);
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', String(width));
      if ((conn.style || style.style) === 'dashed') line.setAttribute('stroke-dasharray', '6 4');
      if (arrow === 'end' || arrow === 'both') line.setAttribute('marker-end', `url(#${marker(color)})`);
      if (arrow === 'start' || arrow === 'both') line.setAttribute('marker-start', `url(#${marker(color)})`);
      svg.appendChild(line);
    });
  }

  // ------------------------------------------------------------------
  //  1つの埋め込みの組み立て
  // ------------------------------------------------------------------
  let visibilityObserver = null;

  function _observeVisibility(host) {
    if (typeof global.IntersectionObserver !== 'function') { renderElement(host); return; }
    if (!visibilityObserver) {
      visibilityObserver = new global.IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          visibilityObserver.unobserve(entry.target);
          renderElement(entry.target);
        });
      }, { rootMargin: '600px 0px' });
    }
    visibilityObserver.observe(host);
  }

  function _heightFor(host, kind) {
    const size = Number(host.dataset.embedSize || 0);
    if (kind === 'image' || kind === 'video') return 0;
    if (size) return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, size));
    return DEFAULT_HEIGHT[kind] || 0;
  }

  function hydrateElement(host) {
    if (!host || !host.classList?.contains(HOST_CLASS) || !host.isConnected) return false;
    const notePath = _notePathFor(host);
    const path = resolvePath(host.dataset.embedPath, notePath);
    if (!path) return false;
    const kind = host.dataset.embedKind || kindForPath(path);
    host.dataset.embedResolved = path;
    host.dataset.embedKind = kind;
    host.setAttribute('contenteditable', 'false');
    const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    if (root.querySelector('.mfe')) {
      // 取り消し等で同じ要素が戻った時は、組み立て済みの表示をそのまま使う。
      if (host.dataset.embedRendered !== path) _observeVisibility(host);
      return true;
    }
    root.textContent = '';
    const style = global.document.createElement('style');
    style.textContent = SHADOW_CSS;
    root.appendChild(style);
    const frame = _el('div', 'mfe');
    frame.dataset.kind = kind;
    const head = _el('div', 'mfe-head');
    head.appendChild(_icon(KIND_ICONS[kind] || 'file'));
    const title = _el('button', 'mfe-title', displayName(path));
    title.type = 'button';
    title.dataset.mfeAction = 'open-side';
    title.title = '右のパネルで開く';
    head.appendChild(title);
    head.appendChild(_el('span', 'mfe-kind', KIND_LABELS[kind] || 'ファイル'));
    head.appendChild(_button('開く', 'open-side', '右のパネルで開いて編集（ノートはそのまま）'));
    frame.appendChild(head);
    const body = _el('div', 'mfe-body');
    const height = _heightFor(host, kind);
    if (height) { body.style.height = height + 'px'; body.classList.add('mfe-fixed'); }
    _status(body, '読み込み中...');
    frame.appendChild(body);
    if (kind !== 'image' && kind !== 'audio' && kind !== 'video') {
      const handle = _el('div', 'mfe-resize');
      handle.title = 'ドラッグで高さを変更';
      handle.dataset.mfeAction = 'resize';
      frame.appendChild(handle);
    }
    root.appendChild(frame);
    root.addEventListener('click', event => _onAction(host, event));
    root.addEventListener('dblclick', event => {
      if (event.target?.closest?.('button')) return;
      event.preventDefault();
      _open(host, 'side');
    });
    root.addEventListener('pointerdown', event => _onResizeStart(host, event));
    // 下端のドラッグを、本文の文字選択やブロックのドラッグ移動として始めさせない。
    root.addEventListener('mousedown', event => { if (event.target?.closest?.('.mfe-resize')) event.preventDefault(); });
    root.addEventListener('dragstart', event => { if (event.target?.closest?.('.mfe-resize, .mfe-btn, .mfe-title')) event.preventDefault(); });
    _observeVisibility(host);
    return true;
  }

  function _alternatePath(host) {
    if (host.dataset.embedTriedAlternate === '1') return '';
    const raw = String(host.dataset.embedPath || '').replace(/\\/g, '/').trim();
    if (!raw || raw.includes('/') || raw.startsWith('.')) return '';
    const alternate = _normalizePath(raw);
    return alternate && alternate !== host.dataset.embedResolved ? alternate : '';
  }

  async function renderElement(host) {
    const root = host?.shadowRoot;
    const body = root?.querySelector('.mfe-body');
    if (!body) return;
    const path = host.dataset.embedResolved;
    const kind = host.dataset.embedKind;
    const generation = (Number(host.dataset.embedGeneration || 0) + 1);
    host.dataset.embedGeneration = String(generation);
    body._mfeDispose?.(); body._mfeDispose = null;
    const stale = () => !host.isConnected || Number(host.dataset.embedGeneration) !== generation;
    const startedAt = global.performance?.now?.() || Date.now();
    try {
      if (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'pdf') {
        _renderMedia(body, kind, path, Number(host.dataset.embedSize || 0));
      } else if (kind === 'sheet' || kind === 'folder') {
        const data = await _fetchSheet(path).catch(error => (error?.status === 404 ? null : Promise.reject(error)));
        if (stale()) return;
        if (data === null) throw Object.assign(new Error('missing'), { status: 404 });
        if (kind === 'folder' && !(data && (Object.keys(data.entities || {}).length || (data.properties || []).length))) _renderFileCard(body, 'folder', path);
        else {
          _renderSheet(body, data, path);
          const kindLabel = root.querySelector('.mfe-kind');
          if (kindLabel) kindLabel.textContent = KIND_LABELS.sheet;
          const headIcon = root.querySelector('.mfe-head .mfe-icon');
          if (headIcon && kind === 'folder') headIcon.replaceWith(_icon(KIND_ICONS.sheet));
        }
      } else if (kind === 'map' || kind === 'form' || kind === 'timer' || kind === 'file') {
        _renderFileCard(body, kind, path);
      } else {
        const text = await _fetchText(path);
        if (stale()) return;
        const type = kind === 'note' ? _frontmatterType(text) : '';
        if (kind === 'board' || type === 'board') _renderBoard(body, text, path, _heightFor(host, 'board'));
        else if (kind === 'scenario') _renderScenario(body, text);
        else if (kind === 'csv') _renderCsv(body, text, path);
        else _renderNote(body, text, path, host, parseTarget(host.dataset.embedSource || '')?.section || '');
      }
      host.dataset.embedRendered = path;
      host.dataset.embedState = 'ready';
      const elapsed = (global.performance?.now?.() || Date.now()) - startedAt;
      host.dataset.embedRenderMs = String(Math.round(elapsed));
    } catch (error) {
      if (stale()) return;
      const missing = error?.status === 404 || error?.message === 'missing';
      // フォルダを含まない名前は、ノートのフォルダ → ソースフォルダの直下の順に探す。
      const alternate = missing ? _alternatePath(host) : '';
      if (alternate) {
        host.dataset.embedResolved = alternate;
        host.dataset.embedTriedAlternate = '1';
        renderElement(host);
        return;
      }
      host.dataset.embedState = missing ? 'missing' : 'error';
      if (host.dataset.embedState === 'missing') {
        _status(body, `「${displayName(path)}」が見つかりません。移動・名前の変更・削除された可能性があります`, { error: true, retry: true });
      } else {
        _status(body, '読み込めませんでした', { error: true, retry: true });
      }
    }
  }

  function _open(host, where) {
    const path = host.dataset.embedResolved || host.dataset.embedPath;
    const label = displayName(path);
    const opener = where === 'side' ? global.openLinkedPathInRightPane : global.openLinkedPathInMainPane;
    if (typeof opener === 'function') {
      // サブパネルの中のノートからは右のパネルを開けないため、メインパネルで開く。
      Promise.resolve(opener(path, label, { fromEmbed: true, sourceEl: host }))
        .then(opened => {
          if (opened === false && where === 'side' && typeof global.openLinkedPathInMainPane === 'function') {
            return global.openLinkedPathInMainPane(path, label, { fromEmbed: true });
          }
          return opened;
        })
        .catch(() => global.showStatus?.('開けませんでした', true));
      return;
    }
    if (typeof global.openLinkedPathInMainPane === 'function') { global.openLinkedPathInMainPane(path, label); return; }
    global.showStatus?.('この画面では開けません', true);
  }

  function _onAction(host, event) {
    const button = event.target?.closest?.('[data-mfe-action]');
    if (!button) return;
    const action = button.dataset.mfeAction;
    if (action === 'resize') return;
    event.preventDefault();
    event.stopPropagation();
    if (action === 'open') _open(host, 'main');
    else if (action === 'open-side') _open(host, 'side');
    else if (action === 'retry') { invalidate(host.dataset.embedResolved); renderElement(host); }
  }

  function _markEditorChanged(host) {
    const editable = host?.closest?.('[contenteditable="true"]');
    if (!editable) return;
    editable.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function _onResizeStart(host, event) {
    const handle = event.target?.closest?.('.mfe-resize');
    if (!handle || event.button !== 0) return;
    const editable = host.closest('[contenteditable="true"]');
    if (!editable) return;
    const body = host.shadowRoot.querySelector('.mfe-body');
    const startY = event.clientY;
    const startHeight = body.offsetHeight;
    event.preventDefault();
    handle.setPointerCapture?.(event.pointerId);
    if (typeof global._pushCustomUndo === 'function') global._pushCustomUndo(editable);
    const move = ev => {
      const next = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(startHeight + ev.clientY - startY)));
      body.style.height = next + 'px';
      body.classList.add('mfe-fixed');
      body.querySelector('.mfe-board')?.style.setProperty('height', next + 'px');
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      const next = Math.round(body.offsetHeight / 10) * 10;
      if (next && next !== Number(host.dataset.embedSize || 0)) {
        host.dataset.embedSize = String(next);
        _markEditorChanged(host);
        if (host.dataset.embedKind === 'board') renderElement(host);
      }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  function setSize(host, size) {
    if (!host?.classList?.contains(HOST_CLASS)) return false;
    const next = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(Number(size) || 0)));
    if (!next) return false;
    host.dataset.embedSize = String(next);
    const body = host.shadowRoot?.querySelector('.mfe-body');
    if (body) { body.style.height = next + 'px'; body.classList.add('mfe-fixed'); body.querySelector('.mfe-board')?.style.setProperty('height', next + 'px'); }
    _markEditorChanged(host);
    if (host.dataset.embedKind === 'board') renderElement(host);
    return true;
  }

  // ------------------------------------------------------------------
  //  まとめ操作
  // ------------------------------------------------------------------
  function hydrateWithin(root) {
    if (!root?.querySelectorAll) return 0;
    let count = 0;
    root.querySelectorAll('.' + HOST_CLASS).forEach(host => { if (hydrateElement(host)) count++; });
    return count;
  }

  function disposeWithin(root) {
    if (!root?.querySelectorAll) return 0;
    let count = 0;
    root.querySelectorAll('.' + HOST_CLASS).forEach(host => {
      visibilityObserver?.unobserve(host);
      host.shadowRoot?.querySelector('.mfe-body')?._mfeDispose?.();
      count++;
    });
    return count;
  }

  function _allHosts() {
    const hosts = [];
    const visit = root => {
      root.querySelectorAll?.('.' + HOST_CLASS).forEach(host => {
        hosts.push(host);
        if (host.shadowRoot) visit(host.shadowRoot);
      });
    };
    if (global.document) visit(global.document);
    return hosts;
  }

  // 元のファイルが変わった埋め込みだけを描き直す（ノート全体は読み直さない）。
  let refreshTimer = 0;
  const pendingPaths = new Set();
  function refreshPaths(paths) {
    (Array.isArray(paths) ? paths : [paths]).forEach(path => { if (path) pendingPaths.add(String(path).replace(/\\/g, '/')); });
    if (refreshTimer) return;
    refreshTimer = global.setTimeout(() => {
      refreshTimer = 0;
      const changed = [...pendingPaths];
      pendingPaths.clear();
      changed.forEach(invalidate);
      _allHosts().forEach(host => {
        const target = host.dataset.embedResolved;
        if (!target || !changed.some(path => _samePathOrInside(path, target) || _samePathOrInside(target, path))) return;
        if (host.dataset.embedState || host.dataset.embedRendered) renderElement(host);
      });
    }, 250);
  }

  function _renamed(oldPath, newPath) {
    const from = String(oldPath || '').replace(/\\/g, '/');
    const to = String(newPath || '').replace(/\\/g, '/');
    if (!from || !to || from === to) return;
    invalidate(from);
    _allHosts().forEach(host => {
      const target = host.dataset.embedResolved;
      if (!target || !_samePathOrInside(target, from)) return;
      const next = to + target.slice(from.length);
      host.dataset.embedPath = next;
      host.dataset.embedResolved = next;
      const source = parseTarget(host.dataset.embedSource || '');
      host.dataset.embedSource = next + (source?.section ? '#' + source.section : '') + (host.dataset.embedSize ? '|' + host.dataset.embedSize : '');
      const title = host.shadowRoot?.querySelector('.mfe-title');
      if (title) title.textContent = displayName(next);
      renderElement(host);
    });
  }

  // ------------------------------------------------------------------
  //  挿入（コマンド・貼り付け・ドロップ）
  // ------------------------------------------------------------------
  function insertEmbed(editable, range, path, options) {
    if (!editable || editable.contentEditable !== 'true') return { ok: false, reason: 'read-only' };
    const host = _createHostElement(path, options);
    if (!host) return { ok: false, reason: 'invalid' };
    if (!options?.skipUndo && typeof global._pushCustomUndo === 'function') global._pushCustomUndo(editable);
    const targetRange = range || (() => {
      const r = global.document.createRange();
      r.selectNodeContents(editable); r.collapse(false); return r;
    })();
    // 行の途中なら行の後ろへ置く（埋め込みは1行を占める）。
    let block = targetRange.startContainer;
    while (block && block.parentNode !== editable) block = block.parentNode;
    if (block && block !== editable) {
      const empty = !String(block.textContent || '').trim() && !block.querySelector?.('img,video,audio,.embed-media,.' + HOST_CLASS);
      if (empty) block.replaceWith(host);
      else block.after(host);
    } else {
      targetRange.deleteContents();
      targetRange.insertNode(host);
    }
    if (!host.nextElementSibling) {
      const trailing = global.document.createElement('div');
      trailing.appendChild(global.document.createElement('br'));
      host.after(trailing);
    }
    hydrateElement(host);
    editable.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true, element: host };
  }

  async function insertFromCommand(context) {
    if (!global.GBFolderPicker || typeof global.GBFolderPicker.pickFolder !== 'function') {
      global.showStatus?.('ファイルを選べません', true);
      return false;
    }
    const selected = await global.GBFolderPicker.pickFolder({ title: '埋め込むファイルを選択', selectFiles: true });
    // 選択結果は絶対パスなので、シート・ボードの埋め込みと同じくソースフォルダ起点の相対パスで書く。
    // 絶対パスのままだと、別のPCやDropbox経由で開いた時に参照が切れる。
    const path = typeof selected === 'string'
      ? selected
      : (global.GBFolderPicker.toSourceRelativePath?.(selected) || selected?.path || '');
    if (!path) return false;
    if (typeof context?.prepareInsert === 'function') context.prepareInsert();
    const selection = global.getSelection?.();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : context?.range;
    return insertEmbed(context?.editable, range, path, { skipUndo: !!context?.skipUndo }).ok;
  }

  // 貼り付けた文字に `![[…]]` だけの行があれば、その場で埋め込み表示にする。
  function upgradeTextLines(editable) {
    if (!editable || editable.contentEditable !== 'true') return 0;
    let count = 0;
    [...editable.children].forEach(child => {
      if (child.classList?.contains(HOST_CLASS) || child.children.length > 1) return;
      const text = String(child.textContent || '');
      if (!LINE_RE.test(text)) return;
      const host = hostElementForLine(text);
      if (!host) return;
      child.replaceWith(host);
      hydrateElement(host);
      count++;
    });
    return count;
  }

  function _onInput(event) {
    if (event.inputType !== 'insertFromPaste' && event.inputType !== 'insertFromDrop') return;
    const editable = event.target?.closest?.('[contenteditable="true"]');
    if (!editable || !editable.querySelector) return;
    if (upgradeTextLines(editable)) editable.dispatchEvent(new Event('input', { bubbles: true }));
  }

  if (global.addEventListener) {
    global.addEventListener('meldex:paths-written', event => {
      (Array.isArray(event.detail?.renamed) ? event.detail.renamed : []).forEach(item => _renamed(item?.from, item?.to));
      refreshPaths(event.detail?.paths || []);
    });
    global.addEventListener('meldex:entity-values-changed', event => { if (event.detail?.phase === 'saved') refreshPaths([event.detail.path]); });
    global.addEventListener('meldex:file-path-renamed', event => _renamed(event.detail?.oldPath || event.detail?.old_path || event.detail?.from, event.detail?.newPath || event.detail?.new_path || event.detail?.to));
    global.addEventListener('meldex:batch-paths-renamed', event => {
      const items = event.detail?.items || event.detail?.renames || event.detail?.paths || [];
      (Array.isArray(items) ? items : []).forEach(item => _renamed(item?.oldPath || item?.old_path || item?.from || item?.src, item?.newPath || item?.new_path || item?.to || item?.dst));
    });
    global.document?.addEventListener?.('input', _onInput, true);
  }

  global.MeldexNoteFileEmbed = Object.freeze({
    LINE_RE,
    parseTarget,
    kindForPath,
    resolvePath,
    blockHtmlForLine,
    markdownForElement,
    hydrateElement,
    hydrateWithin,
    disposeWithin,
    renderElement,
    refreshPaths,
    invalidate,
    insertEmbed,
    insertFromCommand,
    upgradeTextLines,
    setSize,
    renamed: _renamed,
  });
})(typeof window !== 'undefined' ? window : globalThis);
