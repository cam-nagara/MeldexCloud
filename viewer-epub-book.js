/* viewer-epub-book.js — Meldexビューワー: DRMのないEPUBを読み、章ごとの安全な表示用文書を組み立てる。
   方針（2026-11-28 利用者の依頼「EPUBを開いてハイライトできるようにする」）:
     - EPUBの中身は信頼しない。スクリプト・フォーム・埋め込み・イベント属性は取り除き、本の外（ネットワーク）を
       参照する指定（http(s)の画像・CSSの@import・url()）は捨てる。本の中の画像・CSS・フォントだけを data: で渡す。
       表示側は不透明なオリジンの sandbox の iframe（allow-same-origin なし）と、nonce つきCSPで止める。
     - DRM（暗号化）のあるEPUBは開かない。理由を示して止める。解除はしない。フォントの難読化（EPUBの仕様の
       フォント保護）も解かず、そのフォントは使わない（本の文字は端末のフォントで表示する）。
     - ZIPの読み取りは共通のZIPエンジン（gb-archive-zip-engine.js）を使い、章は表示する時に1つずつ展開する。
   公開: window.MeldexViewerEpubBook */
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const XLINK_NS = 'http://www.w3.org/1999/xlink';
  const OPS_NS = 'http://www.idpf.org/2007/ops';
  // EPUBの仕様のフォント保護（難読化）。DRMではないが解かない（そのフォントは使わない）。
  const FONT_OBFUSCATION = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']);
  const MAX_TOC_ENTRIES = 5000;
  const MAX_CSS_IMPORT_DEPTH = 4;
  const MIME = {
    xhtml: 'application/xhtml+xml', html: 'text/html', htm: 'text/html', css: 'text/css', svg: 'image/svg+xml',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
    bmp: 'image/bmp', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogg: 'audio/ogg',
    vtt: 'text/vtt',
  };

  class EpubError extends Error {
    constructor(message, code) { super(message); this.name = 'EpubError'; this.code = code || 'epub_error'; }
  }

  function extOf(path) {
    const name = String(path || '').split('/').pop() || '';
    const index = name.lastIndexOf('.');
    return index > 0 ? name.slice(index + 1).toLowerCase() : '';
  }
  function dirOf(path) {
    const value = String(path || '');
    const index = value.lastIndexOf('/');
    return index >= 0 ? value.slice(0, index + 1) : '';
  }
  const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
  // 本の中の参照を、ZIP内のパス（正規化済み）と断片へ分ける。本の外（スキーム付き・ルートより上）は null。
  function resolveRef(base, ref) {
    const raw = String(ref == null ? '' : ref).trim();
    if (!raw || SCHEME_RE.test(raw) || raw.startsWith('//')) return null;
    const hashIndex = raw.indexOf('#');
    const pathPart = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
    const fragment = hashIndex >= 0 ? raw.slice(hashIndex + 1) : '';
    let decoded = pathPart.split('?')[0];
    try { decoded = decodeURIComponent(decoded); } catch (_) { /* 不正な%はそのまま */ }
    const combined = decoded.startsWith('/') ? decoded.slice(1) : (decoded ? dirOf(base) + decoded : String(base || ''));
    const parts = [];
    for (const part of combined.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { if (!parts.length) return null; parts.pop(); continue; }
      parts.push(part);
    }
    let decodedFragment = fragment;
    try { decodedFragment = decodeURIComponent(fragment); } catch (_) { /* そのまま */ }
    return { path: parts.join('/'), fragment: decodedFragment };
  }

  function decodeText(bytes) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
    const declared = /encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/i.exec(head)?.[1] || /charset\s*=\s*["']?([A-Za-z0-9._-]+)/i.exec(head)?.[1];
    if (declared && !/^utf-?8$/i.test(declared)) {
      try { return new TextDecoder(declared).decode(bytes); } catch (_) { /* 知らない文字コードはUTF-8で読む */ }
    }
    return new TextDecoder('utf-8').decode(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes);
  }

  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    return doc.getElementsByTagName('parsererror').length ? null : doc;
  }
  // 章の本文はXHTMLとして読む。&nbsp; などで読めない時はHTMLとして読み直す。
  function parseChapter(text) {
    const xml = new DOMParser().parseFromString(text, 'application/xhtml+xml');
    if (!xml.getElementsByTagName('parsererror').length && xml.documentElement) return xml;
    return new DOMParser().parseFromString(text, 'text/html');
  }
  const byLocal = (root, name) => [...root.getElementsByTagNameNS('*', name)];
  const firstLocal = (root, name) => root.getElementsByTagNameNS('*', name)[0] || null;
  const textOf = node => String(node?.textContent || '').replace(/\s+/g, ' ').trim();
  function epubType(el) {
    return String(el.getAttributeNS?.(OPS_NS, 'type') || el.getAttribute?.('epub:type') || '');
  }

  function parseNavToc(doc, navPath) {
    const navs = byLocal(doc, 'nav');
    const nav = navs.find(el => /(^|\s)toc(\s|$)/.test(epubType(el))) || navs[0];
    if (!nav) return [];
    const out = [];
    const walk = (list, depth) => {
      for (const li of [...list.children].filter(el => el.localName === 'li')) {
        if (out.length >= MAX_TOC_ENTRIES) return;
        const link = [...li.children].find(el => el.localName === 'a' || el.localName === 'span');
        const target = link?.localName === 'a' ? resolveRef(navPath, link.getAttribute('href')) : null;
        const label = textOf(link) || textOf(li).slice(0, 120);
        if (label) out.push({ label, href: target ? target.path : '', fragment: target?.fragment || '', depth });
        const child = [...li.children].find(el => el.localName === 'ol' || el.localName === 'ul');
        if (child) walk(child, depth + 1);
      }
    };
    const list = [...nav.children].find(el => el.localName === 'ol' || el.localName === 'ul') || firstLocal(nav, 'ol');
    if (list) walk(list, 0);
    return out;
  }

  function parseNcxToc(doc, ncxPath) {
    const out = [];
    const walk = (parent, depth) => {
      for (const point of [...parent.children].filter(el => el.localName === 'navPoint')) {
        if (out.length >= MAX_TOC_ENTRIES) return;
        const label = textOf(firstLocal(point, 'text'));
        const content = [...point.children].find(el => el.localName === 'content');
        const target = resolveRef(ncxPath, content?.getAttribute('src'));
        if (label) out.push({ label, href: target ? target.path : '', fragment: target?.fragment || '', depth });
        walk(point, depth + 1);
      }
    };
    const map = firstLocal(doc, 'navMap');
    if (map) walk(map, 0);
    return out;
  }

  // ---- 開く ----
  async function open(bytes, options = {}) {
    const zip = window.MeldexArchiveZipEngine;
    if (!zip?.parseZip) throw new EpubError('EPUBを読む部品を読み込めませんでした', 'engine_missing');
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    let members;
    try { members = (await zip.parseZip(bytes)).members; }
    catch (error) { throw new EpubError('EPUBファイルを読めませんでした（壊れているか、EPUBではありません）: ' + (error?.message || error), 'corrupt'); }
    const textCache = new Map();
    async function readBytes(name) {
      const info = members.get(name);
      if (!info || info.isDir) throw new EpubError('EPUBの中にファイルがありません: ' + name, 'missing_member');
      return zip.extractMember(bytes, info);
    }
    async function readText(name) {
      if (!textCache.has(name)) textCache.set(name, readBytes(name).then(decodeText));
      return textCache.get(name);
    }
    // DRM（暗号化）の検出。仕様のフォント保護だけなら開く（そのフォントは使わない）。
    if (members.has('META-INF/rights.xml')) throw new EpubError('DRMで保護されたEPUBは開けません。DRMのないEPUBを開いてください', 'drm');
    const obfuscated = new Set();
    if (members.has('META-INF/encryption.xml')) {
      const enc = parseXml(await readText('META-INF/encryption.xml'));
      if (!enc) throw new EpubError('EPUBの暗号化の情報を読めませんでした', 'corrupt');
      for (const data of byLocal(enc, 'EncryptedData')) {
        const algorithm = firstLocal(data, 'EncryptionMethod')?.getAttribute('Algorithm') || '';
        const uri = firstLocal(data, 'CipherReference')?.getAttribute('URI') || '';
        if (!FONT_OBFUSCATION.has(algorithm)) throw new EpubError('DRMで保護されたEPUBは開けません。DRMのないEPUBを開いてください', 'drm');
        const target = resolveRef('', uri);
        if (target) obfuscated.add(target.path);
      }
    }
    if (!members.has('META-INF/container.xml')) throw new EpubError('EPUBの目次ファイル（container.xml）がありません', 'no_container');
    const container = parseXml(await readText('META-INF/container.xml'));
    const opfPath = container && resolveRef('', byLocal(container, 'rootfile')[0]?.getAttribute('full-path'))?.path;
    if (!opfPath || !members.has(opfPath)) throw new EpubError('EPUBのパッケージ情報（OPF）が見つかりません', 'no_opf');
    const opf = parseXml(await readText(opfPath));
    if (!opf) throw new EpubError('EPUBのパッケージ情報（OPF）を読めませんでした', 'bad_opf');

    const metadata = firstLocal(opf, 'metadata') || opf;
    const metaValue = name => {
      for (const meta of byLocal(metadata, 'meta')) {
        if (meta.getAttribute('property') === name) return textOf(meta);
        if (meta.getAttribute('name') === name) return String(meta.getAttribute('content') || '');
      }
      return '';
    };
    const manifest = new Map();
    const manifestByPath = new Map();
    for (const item of byLocal(firstLocal(opf, 'manifest') || opf, 'item')) {
      const id = item.getAttribute('id') || '';
      const target = resolveRef(opfPath, item.getAttribute('href'));
      if (!id || !target?.path) continue;
      const entry = { id, path: target.path, mediaType: String(item.getAttribute('media-type') || '').toLowerCase(),
        properties: String(item.getAttribute('properties') || '').split(/\s+/).filter(Boolean) };
      manifest.set(id, entry);
      manifestByPath.set(entry.path, entry);
    }
    const spineEl = firstLocal(opf, 'spine');
    if (!spineEl) throw new EpubError('EPUBの読む順番（spine）がありません', 'no_spine');
    const globalLayout = metaValue('rendition:layout') === 'pre-paginated' ? 'pre-paginated' : 'reflowable';
    const spine = [];
    for (const ref of byLocal(spineEl, 'itemref')) {
      const item = manifest.get(ref.getAttribute('idref') || '');
      if (!item || !members.has(item.path)) continue;
      if (!/x?html|svg/.test(item.mediaType) && !/^(x?html?|svg)$/.test(extOf(item.path))) continue;
      const props = String(ref.getAttribute('properties') || '').split(/\s+/).filter(Boolean);
      const layout = props.includes('rendition:layout-pre-paginated') ? 'pre-paginated'
        : (props.includes('rendition:layout-reflowable') ? 'reflowable' : globalLayout);
      spine.push({ index: spine.length, id: item.id, href: item.path, linear: ref.getAttribute('linear') !== 'no', layout,
        spread: props.find(prop => /^(rendition:)?page-spread-/.test(prop)) || '' });
    }
    if (!spine.length) throw new EpubError('EPUBに表示できる本文がありません', 'empty_spine');

    const progression = String(spineEl.getAttribute('page-progression-direction') || '').toLowerCase();
    const writingMode = metaValue('primary-writing-mode');
    const language = textOf(firstLocal(metadata, 'language'));
    let toc = [];
    const navItem = [...manifest.values()].find(item => item.properties.includes('nav'));
    try {
      if (navItem && members.has(navItem.path)) toc = parseNavToc(parseChapter(await readText(navItem.path)), navItem.path);
      const ncx = manifest.get(spineEl.getAttribute('toc') || '') || [...manifest.values()].find(item => item.mediaType === 'application/x-dtbncx+xml');
      if (!toc.length && ncx && members.has(ncx.path)) {
        const ncxDoc = parseXml(await readText(ncx.path));
        if (ncxDoc) toc = parseNcxToc(ncxDoc, ncx.path);
      }
    } catch (error) { console.warn('[viewer-epub] 目次を読めませんでした', error?.message || error); }

    const book = {
      title: textOf(firstLocal(metadata, 'title')) || options.name || '',
      language,
      rtl: progression === 'rtl' || (!progression && /^vertical-rl/.test(writingMode)),
      writingMode,
      layout: globalLayout,
      spine, toc, opfPath, manifestByPath, obfuscated,
      members, readBytes, readText,
      urls: new Map(), cssCache: new Map(), disposed: false,
    };
    book.resourceUrl = name => resourceUrl(book, name);
    book.dispose = () => dispose(book);
    book.buildChapter = (index, extra) => buildChapter(book, index, extra);
    book.spineIndexOf = path => spine.findIndex(item => item.href === path);
    return book;
  }

  function dispose(book) {
    book.disposed = true;
    book.urls.clear(); book.cssCache.clear();
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('読み込めませんでした'));
      reader.readAsDataURL(blob);
    });
  }

  // 本の中の画像・フォント・音声を data: で渡す（初めて使う時に1回だけ展開する）。章の枠は不透明なオリジンなので、
  // 親のオリジンの blob: は使わない。難読化したフォントは渡さない。
  function resourceUrl(book, name) {
    if (!name || book.obfuscated.has(name) || !book.members.has(name)) return Promise.resolve('');
    if (!book.urls.has(name)) {
      const type = book.manifestByPath.get(name)?.mediaType || MIME[extOf(name)] || 'application/octet-stream';
      // 本の中のHTML・スクリプトは資源として渡さない（画像・フォント・音声・動画・字幕だけ）。
      if (!/^(image|font|audio|video)\/|^application\/(font|x-font|vnd\.ms-opentype|octet-stream)|^text\/vtt/.test(type)) return Promise.resolve('');
      book.urls.set(name, book.readBytes(name).then(bytes => {
        if (book.disposed) return '';
        return blobToDataUrl(new Blob([bytes], { type }));
      }).catch(error => { console.warn('[viewer-epub] 本の中の資源を読めませんでした', name, error?.message || error); return ''; }));
    }
    return book.urls.get(name);
  }

  // ---- CSS（本の中のものだけ。本の外の参照は捨てる）----
  const URL_RE = /url\(\s*(['"]?)([^'")]*?)\1\s*\)/gi;
  const IMPORT_RE = /@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?[^;]*;/gi;
  function isSafeDataUrl(value) { return /^data:(image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)|font\/|application\/(font|x-font))/i.test(value); }
  async function rewriteCss(book, text, basePath, depth = 0) {
    let css = String(text || '').replace(/\/\*[\s\S]*?\*\//g, '');
    // @import は本の中のCSSだけを展開する（深さに上限）。本の外は読まない。
    const imports = [];
    css = css.replace(IMPORT_RE, (_, __, ref) => { imports.push(ref); return '\u0000IMPORT' + (imports.length - 1) + '\u0000'; });
    const importedTexts = await Promise.all(imports.map(async ref => {
      const target = resolveRef(basePath, ref);
      if (!target || depth >= MAX_CSS_IMPORT_DEPTH || !book.members.has(target.path)) return '';
      try { return await loadCss(book, target.path, depth + 1); } catch (_) { return ''; }
    }));
    css = css.replace(/\u0000IMPORT(\d+)\u0000/g, (_, index) => importedTexts[Number(index)] || '');
    // 古いブラウザーの実行系の指定は捨てる（念のため）
    css = css.replace(/expression\s*\(/gi, 'invalid(').replace(/-moz-binding\s*:/gi, 'x-invalid:').replace(/behavior\s*:/gi, 'x-invalid:')
      .replace(/javascript\s*:/gi, 'invalid:');
    const refs = new Map();
    css.replace(URL_RE, (_, __, ref) => { refs.set(ref, null); return ''; });
    await Promise.all([...refs.keys()].map(async ref => {
      const value = ref.trim();
      if (value.startsWith('#')) { refs.set(ref, value); return; }
      if (/^data:/i.test(value)) { refs.set(ref, isSafeDataUrl(value) ? value : ''); return; }
      const target = resolveRef(basePath, value);
      refs.set(ref, target ? await resourceUrl(book, target.path) : '');
    }));
    return css.replace(URL_RE, (_, __, ref) => {
      const url = refs.get(ref);
      return url ? 'url("' + url.replace(/["\\\n\r]/g, ch => '\\' + ch) + '")' : 'none';
    });
  }
  function loadCss(book, path, depth = 0) {
    if (!book.cssCache.has(path)) {
      book.cssCache.set(path, book.readText(path).then(text => rewriteCss(book, text, path, depth)));
    }
    return book.cssCache.get(path);
  }
  async function sanitizeStyleAttr(book, value, basePath) {
    const text = String(value || '');
    if (!/url\(|expression|binding|behavior|javascript/i.test(text)) return text;
    return rewriteCss(book, text, basePath, MAX_CSS_IMPORT_DEPTH);
  }

  // ---- 本文の消毒 ----
  // 中身ごと捨てる要素（実行・入力・埋め込み・頭部）。
  const DROP = new Set(['script', 'style', 'link', 'meta', 'base', 'title', 'head', 'iframe', 'frame', 'frameset', 'object',
    'embed', 'applet', 'form', 'input', 'button', 'select', 'textarea', 'option', 'optgroup', 'datalist', 'output',
    'noscript', 'template', 'portal', 'dialog', 'foreignobject', 'slot', 'param', 'canvas', 'keygen', 'menu']);
  const HTML_TAGS = new Set(('a abbr address article aside b bdi bdo big blockquote br caption center cite code col colgroup dd del '
    + 'details dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hgroup hr i img ins kbd li main mark nav ol p '
    + 'picture pre q rb rp rt rtc ruby s samp section small source span strike strong sub summary sup table tbody td tfoot th '
    + 'thead time tr tt u ul var wbr audio video track font aside figure').split(' '));
  const SVG_TAGS = new Set(('svg g path rect circle ellipse line polyline polygon text tspan textpath image defs use symbol desc '
    + 'clippath lineargradient radialgradient stop pattern mask marker switch title').split(' '));
  const HTML_ATTRS = new Set(['class', 'id', 'lang', 'dir', 'title', 'alt', 'width', 'height', 'colspan', 'rowspan', 'align',
    'valign', 'role', 'start', 'type', 'reversed', 'value', 'span', 'scope', 'headers', 'abbr', 'datetime', 'name', 'controls',
    'loop', 'muted', 'kind', 'srclang', 'label', 'border', 'cellpadding', 'cellspacing', 'color', 'face', 'size', 'nowrap',
    'open', 'hidden']);
  const MEDIA_SRC_TAGS = new Set(['img', 'source', 'audio', 'video', 'track', 'image']);

  function collectAssetRefs(root, basePath, refs) {
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let el = walker.currentNode; el; el = walker.nextNode()) {
      const name = String(el.localName || '').toLowerCase();
      if (!MEDIA_SRC_TAGS.has(name) && name !== 'video') continue;
      for (const attr of ['src', 'href', 'poster']) {
        const value = attr === 'href' ? (el.getAttribute('href') || el.getAttributeNS?.(XLINK_NS, 'href')) : el.getAttribute(attr);
        const target = value && resolveRef(basePath, value);
        if (target?.path) refs.add(target.path);
      }
    }
  }

  function safeUrlFor(value, basePath, assets) {
    const raw = String(value || '').trim();
    if (/^data:/i.test(raw)) return isSafeDataUrl(raw) ? raw : '';
    const target = resolveRef(basePath, raw);
    return target ? (assets.get(target.path) || '') : '';
  }

  async function importNode(book, source, out, basePath, assets, ctx) {
    if (source.nodeType === 3) return out.createTextNode(source.nodeValue);
    if (source.nodeType !== 1) return null; // コメント・処理命令・CDATAは捨てる
    const name = String(source.localName || '').toLowerCase();
    if (DROP.has(name)) return null;
    const isSvg = source.namespaceURI === SVG_NS || (ctx.inSvg && source.namespaceURI !== 'http://www.w3.org/1999/xhtml');
    const allowed = isSvg ? SVG_TAGS.has(name) : HTML_TAGS.has(name);
    const appendChildren = async target => {
      for (const child of [...source.childNodes]) {
        const imported = await importNode(book, child, out, basePath, assets, { inSvg: isSvg && name !== 'switch' ? true : ctx.inSvg });
        if (imported) target.appendChild(imported);
      }
      return target;
    };
    // 知らない要素（MathML・epub:switch 等）は外し、中の文字だけ残す。
    if (!allowed) return appendChildren(out.createDocumentFragment());
    const el = isSvg ? out.createElementNS(SVG_NS, source.localName) : out.createElement(name);
    for (const attr of [...source.attributes]) {
      const local = String(attr.localName || attr.name).toLowerCase();
      const qualified = String(attr.name).toLowerCase();
      const value = attr.value;
      if (local.startsWith('on') || qualified.startsWith('xmlns') || local === 'srcset' || local === 'formaction') continue;
      if (qualified === 'epub:type' || (attr.namespaceURI === OPS_NS && local === 'type')) { el.setAttribute('data-epub-type', value); continue; }
      if (qualified === 'xml:lang') { el.setAttribute('lang', value); continue; }
      if (local === 'style') { el.setAttribute('style', await sanitizeStyleAttr(book, value, basePath)); continue; }
      if (local === 'href') {
        if (name === 'a') {
          const target = resolveRef(basePath, value);
          if (target) {
            el.setAttribute('data-epub-href', (target.path || basePath) + (target.fragment ? '#' + target.fragment : ''));
            el.setAttribute('role', 'link'); el.setAttribute('tabindex', '0');
          } else if (/^(https?|mailto):/i.test(value.trim())) {
            el.setAttribute('data-external-href', value.trim().slice(0, 2000));
            el.setAttribute('title', value.trim().slice(0, 2000));
          }
          continue;
        }
        if (name === 'image') { const url = safeUrlFor(value, basePath, assets); if (url) el.setAttribute('href', url); continue; }
        if (name === 'use' || name === 'textpath' || name === 'pattern' || name === 'lineargradient' || name === 'radialgradient') {
          if (value.trim().startsWith('#')) el.setAttribute('href', value.trim());
          continue;
        }
        continue;
      }
      if (local === 'src' || local === 'poster') {
        if (MEDIA_SRC_TAGS.has(name) || name === 'video') { const url = safeUrlFor(value, basePath, assets); if (url) el.setAttribute(local, url); }
        continue;
      }
      if (isSvg) {
        // SVGの表示用の属性は残す。url() は文書の中（#〜）だけ。
        if (/url\(/i.test(value) && !/^\s*url\(\s*['"]?#[^)]*\)\s*$/i.test(value)) continue;
        if (/^(xlink:)?(href|actuate|show|arcrole|role)$/.test(qualified)) continue;
        try { el.setAttribute(attr.localName === attr.name ? attr.name : attr.localName, value); } catch (_) { /* 不正な名前は捨てる */ }
        continue;
      }
      if (HTML_ATTRS.has(local) || local.startsWith('aria-')) el.setAttribute(local, value);
    }
    if (name === 'video' || name === 'audio') { el.setAttribute('controls', ''); el.removeAttribute('autoplay'); el.setAttribute('preload', 'metadata'); }
    if (name === 'img') { el.setAttribute('draggable', 'false'); el.setAttribute('decoding', 'async'); }
    return appendChildren(el);
  }

  // 固定レイアウト（コミック等）の1ページの大きさ（viewport の指定、無ければSVGの寸法）。
  function fixedViewport(doc) {
    const meta = byLocal(doc, 'meta').find(el => String(el.getAttribute('name') || '').toLowerCase() === 'viewport');
    const content = String(meta?.getAttribute('content') || '');
    const width = Number(/width\s*=\s*([\d.]+)/i.exec(content)?.[1]);
    const height = Number(/height\s*=\s*([\d.]+)/i.exec(content)?.[1]);
    if (width > 0 && height > 0) return { width, height };
    const svg = firstLocal(doc, 'svg');
    const box = String(svg?.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (box.length === 4 && box[2] > 0 && box[3] > 0) return { width: box[2], height: box[3] };
    return null;
  }

  // 表示用のCSP。本の中の資源（data:）以外は読まず、スクリプトはビューワーの仲介スクリプト（毎回の nonce）だけ動く
  // （消毒に加えた2つ目の止め）。本の <meta http-equiv> は消毒で捨てるので、このCSPを本が上書き・緩めることはない。
  function chapterCsp(nonce) {
    return "default-src 'none'; script-src 'nonce-" + nonce + "'; object-src 'none'; base-uri 'none'; form-action 'none'; "
      + "connect-src 'none'; frame-src 'none'; worker-src 'none'; img-src data:; media-src data:; font-src data:; style-src 'unsafe-inline'";
  }
  function randomToken() {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes)).replace(/[^A-Za-z0-9]/g, '');
  }

  // 章を1つ、安全な表示用HTMLにする。extra.headStyle は表示側（ページ割り）の指定。
  async function buildChapter(book, spineIndex, extra = {}) {
    const item = book.spine[spineIndex];
    if (!item) throw new EpubError('章が見つかりません', 'no_chapter');
    const basePath = item.href;
    const source = parseChapter(await book.readText(basePath));
    const root = source.documentElement;
    const body = firstLocal(source, 'body') || root;
    // 文書の順にスタイルを集める（<link rel=stylesheet> と <style>）。
    const styles = [];
    const walker = source.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let el = walker.currentNode; el; el = walker.nextNode()) {
      const name = String(el.localName || '').toLowerCase();
      if (name === 'link' && /(^|\s)stylesheet(\s|$)/i.test(el.getAttribute('rel') || '') && !/alternate/i.test(el.getAttribute('rel') || '')) {
        const target = resolveRef(basePath, el.getAttribute('href'));
        if (target && book.members.has(target.path)) styles.push(loadCss(book, target.path).catch(() => ''));
      } else if (name === 'style') {
        styles.push(rewriteCss(book, el.textContent, basePath));
      }
    }
    const assetPaths = new Set();
    collectAssetRefs(body, basePath, assetPaths);
    const assets = new Map();
    await Promise.all([...assetPaths].map(async path => assets.set(path, await resourceUrl(book, path))));
    const out = document.implementation.createHTMLDocument('');
    const outBody = out.body;
    for (const child of [...body.childNodes]) {
      const imported = await importNode(book, child, out, basePath, assets, { inSvg: false });
      if (imported) outBody.appendChild(imported);
    }
    // 本の指定（縦書き等）がhtml・bodyのclass・lang・styleにあることが多いので写す。
    const copyRootAttrs = async (from, to) => {
      for (const name of ['class', 'lang', 'dir', 'id']) { const value = from?.getAttribute?.(name); if (value) to.setAttribute(name, value); }
      const lang = from?.getAttribute?.('xml:lang') || from?.getAttributeNS?.('http://www.w3.org/XML/1998/namespace', 'lang');
      if (lang && !to.getAttribute('lang')) to.setAttribute('lang', lang);
      const style = from?.getAttribute?.('style');
      if (style) to.setAttribute('style', await sanitizeStyleAttr(book, style, basePath));
      const type = from && epubType(from);
      if (type) to.setAttribute('data-epub-type', type);
    };
    await copyRootAttrs(root, out.documentElement);
    if (body !== root) await copyRootAttrs(body, outBody);
    if (!out.documentElement.getAttribute('lang') && book.language) out.documentElement.setAttribute('lang', book.language);
    const css = await Promise.all(styles);
    const head = out.head;
    head.replaceChildren();
    const nonce = randomToken(), channel = randomToken();
    // CSPは頭の最初の要素。本の中身（消毒済み）は全部この後ろにある
    const csp = out.createElement('meta'); csp.setAttribute('http-equiv', 'Content-Security-Policy'); csp.setAttribute('content', chapterCsp(nonce));
    const charset = out.createElement('meta'); charset.setAttribute('charset', 'utf-8');
    head.append(csp, charset);
    // 本が色を決めていない時の紙の色。本のCSSが後に来るので本の指定が勝つ。
    const base = out.createElement('style'); base.id = 'meldex-epub-base';
    base.textContent = 'html{background:#fff;color:#111;} img,svg,video{max-width:100%;} a[data-epub-href]{cursor:pointer;}';
    head.appendChild(base);
    css.forEach(text => { if (!text) return; const style = out.createElement('style'); style.textContent = text; head.appendChild(style); });
    const layout = out.createElement('style'); layout.id = 'meldex-epub-layout'; layout.textContent = String(extra.headStyle || '');
    head.appendChild(layout);
    const highlights = out.createElement('style'); highlights.id = 'meldex-epub-highlights';
    head.appendChild(highlights);
    // ビューワーの仲介スクリプト（viewer-epub-frame.js）。nonce 付きで本文の後ろに置く。本の中身は消毒でスクリプトを持たない。
    const frameSource = window.MeldexViewerEpubFrame;
    if (typeof frameSource !== 'function') throw new EpubError('EPUBを表示する部品を読み込めませんでした', 'engine_missing');
    const bridge = out.createElement('script');
    bridge.setAttribute('nonce', nonce);
    bridge.setAttribute('data-channel', channel);
    bridge.textContent = '(' + frameSource.toString() + ')();';
    out.body.appendChild(bridge);
    return {
      html: '<!DOCTYPE html>' + out.documentElement.outerHTML,
      channel,
      href: basePath,
      fixed: item.layout === 'pre-paginated' ? (fixedViewport(source) || { width: 1000, height: 1414 }) : null,
    };
  }

  window.MeldexViewerEpubBook = { open, resolveRef, decodeText, EpubError, chapterCsp, _rewriteCss: rewriteCss };
})();
