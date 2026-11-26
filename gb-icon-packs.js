/* gb-icon-packs.js - 利用者が登録するアイコン素材集（SVG / PNG）
 *
 * - 登録: フォルダ（SVG/PNG）またはZIPから。SVGは安全な要素・属性だけ残して作り直し、PNGは縮小して描き直す。
 * - 保存: 個人設定の保存先（Dropboxの個人管理領域。デスクトップ版・Cloud版共通）へ、目録1つ
 *   （icon-packs）と素材集ごとの文書（icon-pack-<id>）で置く。利用者のファイルの隣には置かない。
 *   端末内（IndexedDB）にも写しを持ち、起動直後の描画は写しから行う（通信を待たない）。
 *   Dropboxへ接続していない環境では端末内だけで動き、接続後に送る。
 * - 描画: アイコンの値は `pack:<素材集ID>/<アイコンID>`。素材集が無い時は代わりの絵を出す。
 */
(function (global) {
  'use strict';

  if (global.MeldexIconPacks) return;

  const INDEX_DOC = 'icon-packs';
  const PACK_DOC_PREFIX = 'icon-pack-';
  const DB_NAME = 'meldex-icon-packs';
  const DB_STORE = 'kv';
  const STATE_KEY = 'state';
  const LIMITS = Object.freeze({
    maxPacks: 20,
    maxIconsPerPack: 500,
    maxSvgInputBytes: 100 * 1024,
    maxSvgOutputBytes: 48 * 1024,
    maxPngInputBytes: 512 * 1024,
    maxPngSide: 128,
    maxPackBytes: 900 * 1024,
    maxZipBytes: 20 * 1024 * 1024,
    maxNameLength: 60,
  });
  const PACK_ID_RE = /^[0-9a-f]{12}$/;
  const ICON_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
  const SPEC_RE = /^pack:([0-9a-f]{12})\/([a-z0-9][a-z0-9_-]{0,63})$/;

  // ---- SVG の無害化 ---------------------------------------------------------
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const XLINK_NS = 'http://www.w3.org/1999/xlink';
  const ALLOWED_ELEMENTS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect',
    'defs', 'use', 'symbol', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'title']);
  const ALLOWED_ATTRIBUTES = new Set(['viewbox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r',
    'rx', 'ry', 'd', 'points', 'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap',
    'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity',
    'transform', 'clip-path', 'clip-rule', 'mask', 'id', 'offset', 'stop-color', 'stop-opacity', 'gradientunits',
    'gradienttransform', 'spreadmethod', 'fx', 'fy', 'preserveaspectratio', 'href', 'xlink:href', 'color',
    'vector-effect', 'shape-rendering', 'clippathunits', 'maskunits', 'maskcontentunits', 'display', 'visibility',
    'xmlns', 'xmlns:xlink', 'version', 'style']);
  const ALLOWED_STYLE_PROPS = new Set(['fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap',
    'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity',
    'stop-color', 'stop-opacity', 'color', 'display', 'visibility', 'clip-rule', 'vector-effect']);
  const MONO_COLORS = new Set(['', 'none', 'currentcolor', 'transparent', 'black', '#000', '#000000', '#000f', '#000000ff',
    'rgb(0,0,0)', 'rgba(0,0,0,1)', 'inherit']);

  function _safeValue(value) {
    const text = String(value || '');
    if (/[<>]/.test(text) || /javascript:|data:|expression\s*\(|@import|\\/i.test(text)) return null;
    // url(...) は文書内の参照（#id）だけ許す。外部の参照は落とす。
    const urls = text.match(/url\s*\(([^)]*)\)/gi) || [];
    if (urls.some(u => !/^url\s*\(\s*['"]?#[A-Za-z0-9_.:-]+['"]?\s*\)$/i.test(u))) return null;
    return text;
  }

  function _sanitizeStyle(value) {
    const kept = [];
    for (const part of String(value || '').split(';')) {
      const idx = part.indexOf(':');
      if (idx < 0) continue;
      const prop = part.slice(0, idx).trim().toLowerCase();
      const val = _safeValue(part.slice(idx + 1).trim());
      if (ALLOWED_STYLE_PROPS.has(prop) && val != null && val !== '') kept.push(prop + ':' + val);
    }
    return kept.join(';');
  }

  /** SVG文字列を無害化して返す。使えない時は Error を投げる。戻り値 { svg, tint }。 */
  function sanitizeSvg(text) {
    const source = String(text || '');
    if (!source.trim()) throw new Error('空のSVGです');
    if (new Blob([source]).size > LIMITS.maxSvgInputBytes) throw new Error('SVGが大きすぎます（100KBまで）');
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('外部定義を含むSVGは登録できません');
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) {
      throw new Error('SVGとして読めません');
    }
    const colors = new Set();
    const ids = new Set();
    const out = document.implementation.createDocument(SVG_NS, 'svg', null);
    const copy = (node, target) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3) {
          // 文字はタイトルの中だけ残す（描画に使う文字要素は許していない）。
          if (target.nodeName.toLowerCase() === 'title') target.appendChild(out.createTextNode(child.nodeValue.slice(0, 200)));
          continue;
        }
        if (child.nodeType !== 1) continue;
        const name = String(child.localName || '').toLowerCase();
        if (!ALLOWED_ELEMENTS.has(name) || child.namespaceURI !== SVG_NS) continue;
        const el = out.createElementNS(SVG_NS, child.localName);
        copyAttributes(child, el);
        copy(child, el);
        target.appendChild(el);
      }
    };
    const copyAttributes = (from, to) => {
      for (const attr of Array.from(from.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on') || !ALLOWED_ATTRIBUTES.has(name) || name === 'xmlns' || name === 'xmlns:xlink') continue;
        let value = attr.value;
        if (name === 'href' || name === 'xlink:href') {
          // <use> などの参照は文書内（#id）だけ。
          if (!/^#[A-Za-z0-9_.:-]+$/.test(value.trim())) continue;
          to.setAttribute('href', value.trim());
          continue;
        }
        if (name === 'style') {
          value = _sanitizeStyle(value);
          if (!value) continue;
          for (const m of value.matchAll(/(?:^|;)(fill|stroke|stop-color|color):([^;]*)/g)) colors.add(m[2].trim().toLowerCase().replace(/\s+/g, ''));
        } else {
          value = _safeValue(value);
          if (value == null) continue;
          if (['fill', 'stroke', 'stop-color', 'color'].includes(name)) colors.add(value.trim().toLowerCase().replace(/\s+/g, ''));
        }
        if (name === 'id') ids.add(value);
        to.setAttribute(attr.name, value);
      }
    };
    const svg = out.documentElement;
    copyAttributes(root, svg);
    copy(root, svg);
    // 大きさは表示側で決める。縦横の比は viewBox に残す。
    if (!svg.getAttribute('viewBox')) {
      const w = parseFloat(root.getAttribute('width')) || 24;
      const h = parseFloat(root.getAttribute('height')) || 24;
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    if (!svg.querySelector('path,circle,ellipse,line,polyline,polygon,rect,use')) throw new Error('描く図形がありません');
    const result = new XMLSerializer().serializeToString(svg);
    if (new Blob([result]).size > LIMITS.maxSvgOutputBytes) throw new Error('SVGが大きすぎます');
    // 黒・現在の色だけで描くアイコンは、テーマの文字色で塗る（黒いままだと暗いテーマで見えない）。
    const tint = [...colors].every(color => MONO_COLORS.has(color));
    return { svg: result, tint };
  }

  // ---- PNG の描き直し -------------------------------------------------------
  async function sanitizePng(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 8) throw new Error('PNGとして読めません');
    if (bytes.length > LIMITS.maxPngInputBytes) throw new Error('PNGが大きすぎます（512KBまで）');
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (!sig.every((b, i) => bytes[i] === b)) throw new Error('PNGとして読めません');
    const blob = new Blob([bytes], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob).catch(() => { throw new Error('PNGとして読めません'); });
    const scale = Math.min(1, LIMITS.maxPngSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    // 描き直すことで、埋め込まれた付随情報（撮影情報・文字列など）を落とす。
    return canvas.toDataURL('image/png');
  }

  // ---- 状態 -----------------------------------------------------------------
  // packs: { [id]: { id, name, enabled, updatedAt, icons: [{ id, name, kind, data, tint }], revision, synced, dirty } }
  let state = { order: [], packs: {}, indexRevision: null, removed: [] };
  let iconMap = new Map();
  let loaded = false;
  let remoteAvailable = null;
  let syncing = null;
  const listeners = new Set();

  function _rebuildMap() {
    iconMap = new Map();
    for (const id of state.order) {
      const pack = state.packs[id];
      if (!pack) continue;
      for (const icon of pack.icons || []) iconMap.set(id + '/' + icon.id, { pack, icon });
    }
  }

  function _emit() {
    _rebuildMap();
    for (const fn of listeners) { try { fn(); } catch (_) {} }
    _refreshRenderedIcons();
    try { global.dispatchEvent(new CustomEvent('meldex-icon-packs-change')); } catch (_) {}
  }

  // 読み込み前・素材集が無い時に置いた仮の絵を、今の状態で描き直す（同じ絵なら触らない）。
  function _refreshRenderedIcons() {
    if (typeof document === 'undefined' || !global.GBIconAssets?.render) return;
    document.querySelectorAll('.gb-icon-pack[data-icon]').forEach((el) => {
      const spec = el.dataset.icon;
      const size = parseFloat(el.style.getPropertyValue('--gb-icon-size')) || 20;
      if (el.dataset.packState === describe(spec).state) return;
      const holder = document.createElement('span');
      holder.innerHTML = global.GBIconAssets.render(spec, size, { className: el.dataset.extraClass || '' });
      const next = holder.firstElementChild;
      if (next) el.replaceWith(next);
    });
  }

  // ---- 端末内の写し（IndexedDB） --------------------------------------------
  let _dbPromise = null;
  function _db() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve) => {
      try {
        if (!global.indexedDB) { resolve(null); return; }
        const req = global.indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
    return _dbPromise;
  }
  async function _loadLocal() {
    const db = await _db();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(STATE_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  }
  async function _saveLocal() {
    const db = await _db();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(JSON.parse(JSON.stringify(state)), STATE_KEY);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (_) { resolve(false); }
    });
  }

  function _normalizeState(raw) {
    const next = { order: [], packs: {}, indexRevision: null, removed: [] };
    if (!raw || typeof raw !== 'object') return next;
    next.indexRevision = raw.indexRevision || null;
    next.removed = Array.isArray(raw.removed) ? raw.removed.filter(r => PACK_ID_RE.test(r?.id || '')) : [];
    for (const id of Array.isArray(raw.order) ? raw.order : []) {
      const pack = raw.packs?.[id];
      if (!PACK_ID_RE.test(id) || !pack || next.packs[id]) continue;
      next.packs[id] = _normalizePack(pack, id);
      next.order.push(id);
    }
    return next;
  }
  function _normalizePack(pack, id) {
    return {
      id,
      name: String(pack.name || '素材集').slice(0, LIMITS.maxNameLength),
      enabled: pack.enabled !== false,
      updatedAt: String(pack.updatedAt || ''),
      icons: (Array.isArray(pack.icons) ? pack.icons : []).filter(icon => ICON_ID_RE.test(icon?.id || '')
        && (icon.kind === 'svg' || icon.kind === 'png') && typeof icon.data === 'string')
        .slice(0, LIMITS.maxIconsPerPack)
        .map(icon => ({ id: icon.id, name: String(icon.name || icon.id).slice(0, 120), kind: icon.kind, data: icon.data, tint: !!icon.tint })),
      revision: pack.revision || null,
      synced: !!pack.synced,
      dirty: !!pack.dirty,
      // 中身（アイコン）を送る必要があるか。使う／使わない・名前の変更は目録だけ送る。
      contentDirty: !!pack.contentDirty || (!!pack.dirty && !pack.synced),
    };
  }

  // ---- 個人設定の保存先 -----------------------------------------------------
  function _hasRemote() { return typeof global.apiFetch === 'function'; }
  async function _prefGet(name) {
    if (!_hasRemote()) return null;
    return global.apiFetch('/personal-preferences/' + name, { silentError: true, skipBrowseCache: true });
  }
  async function _prefPut(name, payload, expectedRevision) {
    return global.apiFetch('/personal-preferences/' + name, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, silentError: true,
      body: JSON.stringify({ payload, expectedRevision: expectedRevision || null }),
    });
  }
  function _isConflict(error) {
    return Number(error?.status || error?.response?.status || 0) === 409 || /409|競合/.test(String(error?.message || ''));
  }

  function _packPayload(pack) {
    return { version: 1, id: pack.id, name: pack.name, updatedAt: pack.updatedAt,
      icons: pack.icons.map(({ id, name, kind, data, tint }) => ({ id, name, kind, data, tint })) };
  }
  function _indexPayload() {
    return { version: 1, updatedAt: new Date().toISOString(),
      packs: state.order.map(id => state.packs[id]).filter(Boolean).map(p => ({
        id: p.id, name: p.name, enabled: p.enabled, iconCount: p.icons.length, updatedAt: p.updatedAt })) };
  }

  async function _pushPack(pack) {
    let expected = pack.revision;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await _prefPut(PACK_DOC_PREFIX + pack.id, _packPayload(pack), expected);
        if (!result?.available) return false;
        pack.revision = result.revision || null;
        pack.dirty = false;
        pack.contentDirty = false;
        pack.synced = true;
        return true;
      } catch (error) {
        if (!_isConflict(error) || attempt) throw error;
        expected = (await _prefGet(PACK_DOC_PREFIX + pack.id))?.revision || null;
      }
    }
    return false;
  }

  async function _tombstone(entry) {
    let expected = entry.revision || null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await _prefPut(PACK_DOC_PREFIX + entry.id, { version: 1, id: entry.id, removed: true, updatedAt: new Date().toISOString() }, expected);
        return;
      } catch (error) {
        if (!_isConflict(error) || attempt) throw error;
        expected = (await _prefGet(PACK_DOC_PREFIX + entry.id))?.revision || null;
      }
    }
  }

  /** 個人設定の保存先と突き合わせる。他の端末の追加・変更・削除を取り込み、この端末の変更を送る。 */
  function sync() {
    if (syncing) return syncing;
    syncing = (async () => {
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const remote = await _prefGet(INDEX_DOC).catch(() => null);
          if (!remote || remote.available !== true) { remoteAvailable = false; return { available: false }; }
          remoteAvailable = true;
          const remoteEntries = remote.exists && Array.isArray(remote.payload?.packs) ? remote.payload.packs : [];
          const removedIds = new Set(state.removed.map(r => r.id));
          const remoteById = new Map(remoteEntries.filter(e => PACK_ID_RE.test(e?.id || '') && !removedIds.has(e.id)).map(e => [e.id, e]));
          let changedIndex = state.removed.length > 0;
          // 他の端末で消えた素材集（この端末で送信済みのもの）は消す。未送信のものは残して送る。
          for (const id of [...state.order]) {
            const pack = state.packs[id];
            if (!remoteById.has(id)) {
              if (pack.synced && !pack.dirty) { delete state.packs[id]; state.order = state.order.filter(x => x !== id); }
              else changedIndex = true;
            }
          }
          // 他の端末で増えた・変わった素材集を取り込む。
          for (const [id, entry] of remoteById) {
            const local = state.packs[id];
            if (local?.dirty) {
              if (local.enabled !== (entry.enabled !== false) || local.name !== entry.name) changedIndex = true;
              continue;
            }
            if (local && local.updatedAt === String(entry.updatedAt || '')) {
              local.enabled = entry.enabled !== false;
              local.name = String(entry.name || local.name).slice(0, LIMITS.maxNameLength);
              continue;
            }
            const doc = await _prefGet(PACK_DOC_PREFIX + id).catch(() => null);
            if (!doc?.exists || !doc.payload || doc.payload.removed) continue;
            const pack = _normalizePack({ ...doc.payload, enabled: entry.enabled, name: entry.name || doc.payload.name }, id);
            pack.revision = doc.revision || null;
            pack.synced = true;
            state.packs[id] = pack;
            if (!state.order.includes(id)) state.order.push(id);
          }
          // この端末の変更を送る（素材集の中身→目録の順。目録だけ先に届いて中身が無い状態を作らない）。
          for (const id of state.order) {
            const pack = state.packs[id];
            if (pack?.dirty && (pack.contentDirty || !pack.synced)) { await _pushPack(pack); changedIndex = true; }
            else if (pack?.dirty) { pack.dirty = false; pack.synced = true; changedIndex = true; }
          }
          if (changedIndex) {
            try {
              const result = await _prefPut(INDEX_DOC, _indexPayload(), remote.revision || null);
              state.indexRevision = result?.revision || null;
            } catch (error) {
              if (_isConflict(error)) continue;
              throw error;
            }
            for (const entry of state.removed.splice(0)) await _tombstone(entry).catch(() => {});
          } else {
            state.indexRevision = remote.revision || null;
          }
          await _saveLocal();
          _emit();
          return { available: true };
        }
        return { available: true, conflict: true };
      } finally {
        syncing = null;
      }
    })();
    return syncing;
  }

  function _scheduleSync() {
    const run = () => sync().catch((error) => {
      global.console?.warn?.('[Meldex] アイコン素材集を同期できませんでした', error);
    });
    if (typeof global.requestIdleCallback === 'function') global.requestIdleCallback(run, { timeout: 8000 });
    else setTimeout(run, 3000);
  }

  // ---- 取り込み -------------------------------------------------------------
  function _newPackId() {
    const bytes = new Uint8Array(6);
    (global.crypto || {}).getRandomValues?.(bytes);
    if (!bytes.some(Boolean)) for (let i = 0; i < 6; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }
  function _iconSlug(name, used) {
    const base = String(name || '').replace(/\.[^.]+$/, '').normalize('NFKC').toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 56) || 'icon';
    let slug = /^[a-z0-9]/.test(base) ? base : 'i-' + base;
    let n = 2;
    while (used.has(slug)) slug = (base.slice(0, 52) + '-' + n++);
    used.add(slug);
    return slug;
  }
  function _hash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16) + ':' + text.length;
  }

  /** files: [{ name, bytes: Uint8Array }]。戻り値 { pack, added, skipped: [{ name, reason }] } */
  async function importEntries(files, options = {}) {
    if (state.order.length >= LIMITS.maxPacks) throw new Error(`素材集は${LIMITS.maxPacks}個まで登録できます`);
    const used = new Set();
    const seen = new Set();
    const icons = [];
    const skipped = [];
    let bytesTotal = 0;
    const sorted = [...files].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ja'));
    for (const file of sorted) {
      const name = String(file.name || '').split(/[\\/]/).pop();
      const lower = name.toLowerCase();
      if (!lower.endsWith('.svg') && !lower.endsWith('.png')) continue;
      if (icons.length >= LIMITS.maxIconsPerPack) { skipped.push({ name, reason: `1つの素材集は${LIMITS.maxIconsPerPack}個まで` }); continue; }
      try {
        let icon;
        if (lower.endsWith('.svg')) {
          const text = new TextDecoder('utf-8', { fatal: false }).decode(file.bytes);
          const { svg, tint } = sanitizeSvg(text);
          icon = { kind: 'svg', data: svg, tint };
        } else {
          icon = { kind: 'png', data: await sanitizePng(file.bytes), tint: false };
        }
        const key = _hash(icon.data);
        if (seen.has(key)) { skipped.push({ name, reason: '同じ絵が登録済み' }); continue; }
        if (bytesTotal + icon.data.length > LIMITS.maxPackBytes) { skipped.push({ name, reason: '素材集の容量の上限（約900KB）' }); continue; }
        seen.add(key);
        bytesTotal += icon.data.length;
        const display = name.replace(/\.[^.]+$/, '');
        icons.push({ id: _iconSlug(display, used), name: display, ...icon });
      } catch (error) {
        skipped.push({ name, reason: error.message || '読めません' });
      }
    }
    if (!icons.length) {
      const error = new Error('登録できるSVG・PNGがありませんでした');
      error.skipped = skipped;
      throw error;
    }
    const id = _newPackId();
    const pack = _normalizePack({ name: String(options.name || '素材集').trim() || '素材集', enabled: true,
      updatedAt: new Date().toISOString(), icons, dirty: true, contentDirty: true }, id);
    state.packs[id] = pack;
    state.order.push(id);
    await _saveLocal();
    _emit();
    _scheduleSyncNow();
    return { pack: summary(pack), added: icons.length, skipped };
  }

  async function importFileList(fileList, options = {}) {
    const files = [];
    for (const file of Array.from(fileList || [])) {
      const lower = String(file.name || '').toLowerCase();
      if (!lower.endsWith('.svg') && !lower.endsWith('.png')) continue;
      if (file.size > Math.max(LIMITS.maxSvgInputBytes, LIMITS.maxPngInputBytes)) {
        files.push({ name: file.name, bytes: new Uint8Array(LIMITS.maxPngInputBytes + 1) });
        continue;
      }
      files.push({ name: file.webkitRelativePath || file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    }
    const first = Array.from(fileList || [])[0];
    const folder = String(first?.webkitRelativePath || '').split('/')[0];
    return importEntries(files, { name: options.name || folder || '素材集' });
  }

  async function importZip(file, options = {}) {
    const engine = global.MeldexArchiveZipEngine;
    if (!engine) throw new Error('この画面ではZIPを読めません');
    if (file.size > LIMITS.maxZipBytes) throw new Error('ZIPが大きすぎます（20MBまで）');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { members } = await engine.parseZip(bytes);
    const files = [];
    for (const member of members.values()) {
      if (member.isDir || engine.isSymlinkExternalAttr?.(member.externalAttr)) continue;
      const lower = member.name.toLowerCase();
      if ((!lower.endsWith('.svg') && !lower.endsWith('.png')) || /(^|\/)(__macosx|\.)/i.test(member.name)) continue;
      if (member.uncompressedSize > Math.max(LIMITS.maxSvgInputBytes, LIMITS.maxPngInputBytes)) {
        files.push({ name: member.name, bytes: new Uint8Array(LIMITS.maxPngInputBytes + 1) });
        continue;
      }
      files.push({ name: member.name, bytes: await engine.extractMember(bytes, member) });
    }
    return importEntries(files, { name: options.name || String(file.name || '素材集').replace(/\.zip$/i, '') });
  }

  function _scheduleSyncNow() {
    sync().catch((error) => global.showStatus?.('アイコン素材集を同期できませんでした: ' + (error?.message || error), true));
  }

  async function _mutate(id, fn) {
    const pack = state.packs[id];
    if (!pack) throw new Error('素材集が見つかりません');
    fn(pack);
    pack.dirty = true;
    await _saveLocal();
    _emit();
    _scheduleSyncNow();
    return summary(pack);
  }
  function setEnabled(id, enabled) {
    return _mutate(id, (pack) => { pack.enabled = !!enabled; });
  }
  function rename(id, name) {
    const clean = String(name || '').trim().slice(0, LIMITS.maxNameLength);
    if (!clean) return Promise.reject(new Error('名前を入力してください'));
    return _mutate(id, (pack) => { pack.name = clean; });
  }
  async function remove(id) {
    const pack = state.packs[id];
    if (!pack) return false;
    delete state.packs[id];
    state.order = state.order.filter(x => x !== id);
    if (pack.synced) state.removed.push({ id, revision: pack.revision || null });
    await _saveLocal();
    _emit();
    _scheduleSyncNow();
    return true;
  }

  // ---- 参照 -----------------------------------------------------------------
  function summary(pack) {
    return { id: pack.id, name: pack.name, enabled: pack.enabled, iconCount: pack.icons.length,
      synced: pack.synced && !pack.dirty, preview: pack.icons.slice(0, 12).map(icon => 'pack:' + pack.id + '/' + icon.id) };
  }
  function list() { return state.order.map(id => state.packs[id]).filter(Boolean).map(summary); }

  /** 値の状態: ready（描ける）/ pending（写しの読み込み前）/ disabled（使わない設定）/ missing（見つからない）。 */
  function describe(spec) {
    const match = SPEC_RE.exec(String(spec || ''));
    if (!match) return { state: 'missing' };
    const found = iconMap.get(match[1] + '/' + match[2]);
    if (found) return { state: 'ready', pack: found.pack, icon: found.icon, packEnabled: found.pack.enabled };
    return { state: loaded ? 'missing' : 'pending', packId: match[1], iconId: match[2] };
  }

  function iconDataUrl(icon) {
    if (icon.kind === 'png') return icon.data;
    return 'data:image/svg+xml,' + encodeURIComponent(icon.data).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29');
  }

  /** 選択画面用: 使う設定の素材集のアイコン。 */
  function pickerItems() {
    const items = [];
    for (const id of state.order) {
      const pack = state.packs[id];
      if (!pack?.enabled) continue;
      for (const icon of pack.icons) {
        items.push({ type: 'pack', spec: 'pack:' + id + '/' + icon.id, packId: id, label: icon.name,
          search: [icon.name, icon.id, pack.name, '素材集'].join(' ') });
      }
    }
    return items;
  }

  /** 画像が要る所向け。塗る指定のSVGは色を付けたPNGにする。 */
  async function imageDataUrl(spec, options = {}) {
    const info = describe(spec);
    if (info.state !== 'ready') return '';
    const url = iconDataUrl(info.icon);
    if (!info.icon.tint && !options.bg) return url;
    const size = Math.max(16, Math.min(512, Number(options.size) || 128));
    const img = new Image();
    img.src = url;
    await img.decode();
    const glyph = Math.round(size * (options.scale || 1));
    const offset = (size - glyph) / 2;
    const layer = document.createElement('canvas');
    layer.width = size; layer.height = size;
    const lctx = layer.getContext('2d');
    lctx.drawImage(img, offset, offset, glyph, glyph);
    if (info.icon.tint) {
      lctx.globalCompositeOperation = 'source-in';
      lctx.fillStyle = options.color || '#9aa0a6';
      lctx.fillRect(0, 0, size, size);
    }
    if (!options.bg) return layer.toDataURL('image/png');
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = options.bg;
    ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(layer, 0, 0);
    return canvas.toDataURL('image/png');
  }

  // ---- 設定画面 -------------------------------------------------------------
  function _el(tag, attrs = {}, text) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v);
    }
    if (text != null) el.textContent = text;
    return el;
  }

  function _confirm(message) {
    if (typeof global.cfConfirm === 'function') return global.cfConfirm(message);
    if (typeof global.showConfirmDialog === 'function') {
      return new Promise(resolve => global.showConfirmDialog(message, () => resolve(true), () => resolve(false)));
    }
    return Promise.resolve(false);
  }

  function renderSettings(container) {
    if (!container) return;
    container.textContent = '';
    container.classList.add('gb-icon-packs-settings');
    const section = _el('section', { className: 'gb-section gb-section--boxed', dataset: { e2eId: 'icon-packs-settings' } });
    const title = _el('div', { className: 'gb-section-title' });
    title.innerHTML = (typeof global.lucide === 'function' ? global.lucide('shapes', 14) : '') + ' アイコン素材集';
    if (typeof global.fieldHelp === 'function') {
      title.insertAdjacentHTML('beforeend', ' ' + global.fieldHelp('フォルダやZIPに入ったSVG・PNGのアイコンを登録すると、アイコンを選ぶ画面の「素材集」タブから選べます。SVGは安全のため、スクリプト・外部の参照・操作で動く指定を取り除いて登録します。Dropboxに接続していれば個人設定として保存され、他の端末でも使えます。', { e2eId: 'icon-packs-help' }));
    }
    section.appendChild(title);

    const actions = _el('div', { className: 'gb-icon-packs-actions' });
    const folderBtn = _el('button', { type: 'button', className: 'gb-btn gb-btn-sm', dataset: { e2eId: 'icon-packs-add-folder' } }, 'フォルダから登録');
    const zipBtn = _el('button', { type: 'button', className: 'gb-btn gb-btn-sm', dataset: { e2eId: 'icon-packs-add-zip' } }, 'ZIPから登録');
    const folderInput = _el('input', { type: 'file', hidden: '', multiple: '', accept: '.svg,.png,image/svg+xml,image/png', dataset: { e2eId: 'icon-packs-folder-input' } });
    folderInput.webkitdirectory = true;
    const zipInput = _el('input', { type: 'file', hidden: '', accept: '.zip,application/zip', dataset: { e2eId: 'icon-packs-zip-input' } });
    const status = _el('div', { className: 'gb-icon-packs-status', role: 'status', dataset: { e2eId: 'icon-packs-status' } });
    folderBtn.addEventListener('click', () => folderInput.click());
    zipBtn.addEventListener('click', () => zipInput.click());
    const runImport = async (job) => {
      folderBtn.disabled = true; zipBtn.disabled = true;
      status.textContent = '登録中…';
      try {
        const result = await job();
        status.textContent = `「${result.pack.name}」に${result.added}個のアイコンを登録しました`
          + (result.skipped.length ? `（登録しなかったもの${result.skipped.length}件: ${result.skipped.slice(0, 3).map(s => s.name + '＝' + s.reason).join('、')}${result.skipped.length > 3 ? ' ほか' : ''}）` : '');
      } catch (error) {
        status.textContent = (error.message || '登録できませんでした')
          + (error.skipped?.length ? `（${error.skipped.slice(0, 3).map(s => s.name + '＝' + s.reason).join('、')}）` : '');
      } finally {
        folderBtn.disabled = false; zipBtn.disabled = false;
        folderInput.value = ''; zipInput.value = '';
      }
    };
    folderInput.addEventListener('change', () => { if (folderInput.files?.length) runImport(() => importFileList(folderInput.files)); });
    zipInput.addEventListener('change', () => { const f = zipInput.files?.[0]; if (f) runImport(() => importZip(f)); });
    actions.append(folderBtn, zipBtn, folderInput, zipInput);
    section.append(actions, status);

    const listEl = _el('div', { className: 'gb-icon-packs-list', role: 'list', dataset: { e2eId: 'icon-packs-list' } });
    const where = _el('div', { className: 'gb-icon-packs-where', dataset: { e2eId: 'icon-packs-where' } });
    section.append(listEl, where);
    container.appendChild(section);

    const draw = () => {
      if (!listEl.isConnected) { listeners.delete(draw); return; }
      listEl.textContent = '';
      where.textContent = remoteAvailable === true ? '個人設定（Dropbox）に保存し、他の端末と同期します'
        : remoteAvailable === false ? 'この端末にだけ保存しています（Dropboxに接続すると同期します）' : '';
      const packs = list();
      if (!packs.length) {
        listEl.appendChild(_el('div', { className: 'gb-section-desc' }, 'まだ登録されていません'));
        return;
      }
      for (const pack of packs) {
        const row = _el('div', { className: 'gb-icon-packs-row', role: 'listitem', dataset: { e2eId: 'icon-packs-row:' + pack.id, packId: pack.id } });
        const preview = _el('div', { className: 'gb-icon-packs-preview', 'aria-hidden': 'true' });
        preview.innerHTML = pack.preview.map(spec => global.GBIconAssets?.render?.(spec, 18) || '').join('');
        const name = _el('input', { type: 'text', className: 'gb-input gb-icon-packs-name', maxlength: String(LIMITS.maxNameLength),
          'aria-label': '素材集の名前', dataset: { e2eId: 'icon-packs-name:' + pack.id } });
        name.value = pack.name;
        name.addEventListener('change', () => rename(pack.id, name.value).catch(error => { status.textContent = error.message; name.value = pack.name; }));
        const count = _el('span', { className: 'gb-icon-packs-count' }, pack.iconCount + '個');
        const toggleLabel = _el('label', { className: 'gb-icon-packs-toggle' });
        const toggle = _el('input', { type: 'checkbox', dataset: { e2eId: 'icon-packs-enabled:' + pack.id } });
        toggle.checked = pack.enabled;
        toggle.addEventListener('change', () => setEnabled(pack.id, toggle.checked));
        toggleLabel.append(toggle, document.createTextNode('使う'));
        const removeBtn = _el('button', { type: 'button', className: 'gb-btn gb-btn-xs gb-btn-quiet', 'aria-label': `素材集「${pack.name}」を削除`,
          dataset: { e2eId: 'icon-packs-remove:' + pack.id } }, '削除');
        removeBtn.addEventListener('click', async () => {
          const ok = await _confirm(`素材集「${pack.name}」を削除しますか？\nこの素材集のアイコンを使っている所は、代わりの絵で表示されます。他の端末からも削除されます。`);
          if (ok) await remove(pack.id);
        });
        row.append(preview, name, count, toggleLabel, removeBtn);
        listEl.appendChild(row);
      }
    };
    listeners.add(draw);
    draw();
    if (remoteAvailable == null) sync().catch(() => {}).finally(draw);
  }

  const ready = _loadLocal().then((raw) => {
    state = _normalizeState(raw);
  }).catch(() => {}).then(() => {
    loaded = true;
    _emit();
    _scheduleSync();
  });

  global.MeldexIconPacks = Object.freeze({
    LIMITS,
    ready,
    sanitizeSvg,
    sanitizePng,
    importEntries,
    importFileList,
    importZip,
    setEnabled,
    rename,
    remove,
    sync,
    list,
    describe,
    iconDataUrl,
    imageDataUrl,
    pickerItems,
    renderSettings,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    isLoaded: () => loaded,
    remoteAvailable: () => remoteAvailable,
  });
})(window);
