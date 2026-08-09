/* gb-board-transfer.js: Board D&D and clipboard transfer bridge */
(function (global) {
  'use strict';

  const NODE_MIME = 'application/x-meldex-node';
  const TEXT_MIME = 'application/x-meldex-text';
  const BOARD_MIME = 'application/x-meldex-board-nodes';
  const GRID_COLUMNS = 4;
  const MAX_ITEMS = 100;
  const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i;
  const VIDEO_EXT = /\.(?:mp4|m4v|mov|webm|ogv|avi|mkv|wmv|mpg|mpeg)$/i;
  const AUDIO_EXT = /\.(?:mp3|wav|ogg|m4a|flac|aac)$/i;
  let lastBoardPoint = null;
  let internalCopy = {
    plainText: '',
    capturedAt: 0,
    writeFailed: false,
  };

  function boardCanvas() {
    const paneCanvas = typeof bdGetBoardElement === 'function'
      ? bdGetBoardElement('canvas')
      : null;
    return paneCanvas || document.getElementById('bd-canvas');
  }

  function isEditableTarget(target) {
    return !!target?.closest?.(
      'input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"],.CodeMirror,.monaco-editor',
    );
  }

  function isBoardActive(target) {
    const canvas = boardCanvas();
    if (!canvas || !canvas.isConnected || typeof bd === 'undefined') return false;
    if (target?.closest?.('#bd-canvas,[data-bd-role="canvas"],#board-app')) return true;
    if (global.MeldexBoardStandalone) return true;
    return typeof state !== 'undefined' && state?.view === 'board';
  }

  function canPasteOnBoard(target) {
    if (!isBoardActive(target) || isEditableTarget(target)) return false;
    if (document.querySelector('.modal-overlay')) return false;
    return typeof bdEnsureInteractiveCanvas !== 'function'
      || bdEnsureInteractiveCanvas(boardCanvas());
  }

  function boardCenterPoint() {
    const canvas = boardCanvas();
    if (!canvas) return { x: 160, y: 140 };
    const rect = canvas.getBoundingClientRect();
    if (typeof bdScreenToWorld === 'function') {
      return bdScreenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
    const zoom = Math.max(0.1, Number(bd?.zoom) || 1);
    return {
      x: ((canvas.clientWidth || 640) / 2 - (Number(bd?.panX) || 0)) / zoom,
      y: ((canvas.clientHeight || 480) / 2 - (Number(bd?.panY) || 0)) / zoom,
    };
  }

  function pastePoint(explicitPoint) {
    const point = explicitPoint || lastBoardPoint || boardCenterPoint();
    return {
      x: Number.isFinite(Number(point?.x)) ? Number(point.x) : 160,
      y: Number.isFinite(Number(point?.y)) ? Number(point.y) : 140,
    };
  }

  function normalizePath(path) {
    return String(path || '').trim().replace(/\\/g, '/');
  }

  function filename(path) {
    const clean = normalizePath(path).replace(/[?#].*$/, '');
    return clean.split('/').filter(Boolean).pop() || clean;
  }

  function apiUrl(route, path, extra) {
    const base = typeof API_BASE !== 'undefined' ? API_BASE : '';
    return `${base}${route}?path=${encodeURIComponent(path)}${extra || ''}`;
  }

  function inferLinkType(path, explicitType) {
    const type = String(explicitType || '').trim();
    if (type) return type;
    if (typeof _bdInferLinkType === 'function') return _bdInferLinkType(path, '');
    const lower = String(path || '').toLowerCase();
    if (IMAGE_EXT.test(lower)) return 'image';
    if (VIDEO_EXT.test(lower)) return 'video';
    if (AUDIO_EXT.test(lower)) return 'audio';
    if (/\.html?$/i.test(lower)) return 'html';
    if (/\.pdf$/i.test(lower)) return 'pdf';
    if (/^https?:\/\//i.test(lower)) return 'html';
    return 'file';
  }

  function safeExternalUrl(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^(?:https?:|mailto:|tel:)/i.test(text)) return text;
    if (/^file:\/\//i.test(text)) {
      try {
        const url = new URL(text);
        let decoded = decodeURIComponent(url.pathname || '');
        if (/^\/[A-Za-z](?:\:|\|)\//.test(decoded)) decoded = decoded.slice(1);
        if (/^[A-Za-z]\|/.test(decoded)) decoded = decoded[0] + ':' + decoded.slice(2);
        if (url.host && url.host !== 'localhost') decoded = `//${url.host}${decoded}`;
        return decoded || '';
      } catch {
        return '';
      }
    }
    return '';
  }

  function meldexPathFromUrl(value) {
    const text = String(value || '').trim();
    if (!/^https?:\/\//i.test(text)) return '';
    try {
      const url = new URL(text, location.href);
      const path = url.searchParams.get('path');
      if (path && /\/(?:file-raw|thumbnail|file)(?:\/|$)/.test(url.pathname)) {
        return normalizePath(path);
      }
    } catch {}
    return '';
  }

  function isPathLike(value) {
    const text = String(value || '').trim();
    return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(text)
      || /\.(?:md|txt|json|csv|pdf|html?|mel-board|mel-sheet|mel-scenario|mel-timer|png|jpe?g|gif|webp|bmp|svg|avif|ico|mp4|mov|webm|avi|mkv|mp3|wav|ogg|m4a|flac|aac)$/i.test(text);
  }

  function imageSpec(path, label, source) {
    const normalized = normalizePath(path);
    const src = String(source || '').trim()
      || (normalized ? apiUrl('/file-raw', normalized) : '');
    return {
      kind: 'image',
      label: String(label || filename(normalized) || '画像'),
      path: normalized,
      linkType: 'image',
      src,
    };
  }

  function linkSpec(path, label, explicitType) {
    const normalized = normalizePath(path);
    const linkType = inferLinkType(normalized, explicitType);
    const spec = {
      kind: 'link',
      label: String(label || filename(normalized) || normalized),
      path: normalized,
      linkType,
    };
    if (linkType === 'video' && normalized && !/^https?:\/\//i.test(normalized)) {
      spec.preview = apiUrl('/thumbnail', normalized, '&size=512');
    }
    return spec;
  }

  function specFromMeldexItem(item) {
    const path = normalizePath(item?.path);
    if (!path) return null;
    const label = String(item?.name || item?.label || filename(path) || path);
    const type = String(item?.type || item?.linkType || '').trim();
    if (type === 'image' || IMAGE_EXT.test(path)) return imageSpec(path, label);
    return linkSpec(path, label, type);
  }

  function parseMeldexNodes(raw) {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed?.items) && parsed.items.length
        ? parsed.items
        : [parsed];
      return items.slice(0, MAX_ITEMS).map(specFromMeldexItem).filter(Boolean);
    } catch {
      return [];
    }
  }

  function parseMarkdownLink(text) {
    const match = String(text || '').trim().match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    return match ? { label: match[1].trim(), path: match[2].trim() } : null;
  }

  function plainLineSpec(line) {
    const text = String(line || '').trim();
    if (!text) return null;
    const markdown = parseMarkdownLink(text);
    if (markdown) {
      const meldexPath = meldexPathFromUrl(markdown.path);
      const external = safeExternalUrl(markdown.path);
      if (meldexPath || external) return linkSpec(meldexPath || external, markdown.label);
      if (isPathLike(markdown.path)) return linkSpec(markdown.path, markdown.label);
      return null;
    }
    const meldexPath = meldexPathFromUrl(text);
    if (meldexPath) return specFromMeldexItem({ path: meldexPath, name: filename(meldexPath) });
    const external = safeExternalUrl(text);
    if (external) return linkSpec(external, filename(external) || external);
    if (isPathLike(text)) return specFromMeldexItem({ path: text, name: filename(text) });
    return null;
  }

  function specsFromPlainText(raw) {
    const text = String(raw || '').replace(/\r\n?/g, '\n').trim();
    if (!text) return [];
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length <= MAX_ITEMS) {
      const lineSpecs = lines.map(plainLineSpec);
      if (lineSpecs.every(Boolean)) return lineSpecs;
    }
    return [{ kind: 'text', text, label: text }];
  }

  function htmlMediaSource(element) {
    return String(
      element?.getAttribute?.('src')
      || element?.getAttribute?.('data-src')
      || element?.querySelector?.('source[src]')?.getAttribute?.('src')
      || '',
    ).trim();
  }

  function htmlImageSpec(img) {
    const source = htmlMediaSource(img);
    if (!source || /^(?:javascript:|data:text\/html)/i.test(source)) return null;
    const label = String(img.getAttribute('alt') || img.getAttribute('title') || filename(source) || '画像');
    if (/^data:image\//i.test(source)) return imageSpec('', label, source);
    const meldexPath = meldexPathFromUrl(source);
    if (meldexPath) return imageSpec(meldexPath, label);
    const external = safeExternalUrl(source);
    return external ? imageSpec(external, label, external) : null;
  }

  function specsFromHtml(raw) {
    if (!raw || typeof DOMParser === 'undefined') return [];
    const documentValue = new DOMParser().parseFromString(String(raw), 'text/html');
    const specs = [];
    documentValue.querySelectorAll('img').forEach(img => {
      const spec = htmlImageSpec(img);
      if (spec) specs.push(spec);
    });
    documentValue.querySelectorAll('video,audio').forEach(media => {
      const source = htmlMediaSource(media);
      const path = meldexPathFromUrl(source) || safeExternalUrl(source);
      if (!path) return;
      specs.push(linkSpec(path, media.getAttribute('title') || filename(path), media.tagName.toLowerCase()));
    });
    documentValue.querySelectorAll('a[href]').forEach(anchor => {
      if (anchor.querySelector('img,video,audio')) return;
      const href = String(anchor.getAttribute('href') || '').trim();
      if (!href || /^(?:javascript:|data:)/i.test(href)) return;
      const path = meldexPathFromUrl(href) || safeExternalUrl(href);
      if (!path) return;
      specs.push(linkSpec(path, anchor.textContent?.trim() || filename(path) || path));
    });
    const unique = [];
    const keys = new Set();
    specs.forEach(spec => {
      const key = `${spec.kind}:${spec.path || spec.src}:${spec.label}`;
      if (!keys.has(key) && unique.length < MAX_ITEMS) {
        keys.add(key);
        unique.push(spec);
      }
    });
    const visibleText = String(documentValue.body?.textContent || '').replace(/\s+/g, ' ').trim();
    const labelText = unique.map(spec => spec.label).join(' ').trim();
    if (visibleText && (!unique.length || (visibleText !== labelText && visibleText.length > labelText.length + 8))) {
      unique.push({ kind: 'text', text: visibleText, label: visibleText });
    }
    return unique;
  }

  function dataTransferTypes(transfer) {
    try {
      return Array.from(transfer?.types || []).map(String);
    } catch {
      return [];
    }
  }

  function dataTransferText(transfer, type) {
    try {
      return String(transfer?.getData?.(type) || '');
    } catch {
      return '';
    }
  }

  function dataTransferFiles(transfer) {
    const files = [];
    const seen = new Set();
    const add = file => {
      if (!file) return;
      const key = `${file.name || ''}:${file.size || 0}:${file.type || ''}:${file.lastModified || 0}`;
      if (seen.has(key)) return;
      seen.add(key);
      files.push(file);
    };
    Array.from(transfer?.files || []).forEach(add);
    Array.from(transfer?.items || []).forEach(item => {
      if (item?.kind === 'file') add(item.getAsFile?.());
    });
    return files.slice(0, MAX_ITEMS);
  }

  function boardSnapshotIsCurrent(snapshot) {
    return typeof bd !== 'undefined'
      && bd.path === snapshot.path
      && (!snapshot.openSeq || Number(bd._openSeq) === snapshot.openSeq);
  }

  function nodeForSpec(spec, x, y) {
    if (!spec) return null;
    if (spec.kind === 'text') {
      const text = String(spec.text || spec.label || '').trim();
      if (!text) return null;
      return typeof bdCreateNodeWithStyle === 'function'
        ? bdCreateNodeWithStyle(text, x, y, { w: 260 })
        : bdNode(text, x, y, 260, 0, {});
    }
    if (spec.kind === 'image') {
      const source = String(spec.src || '').trim();
      if (!source) return null;
      const options = {
        img: source,
        linkType: 'image',
        w: 250,
      };
      if (spec.path) {
        options.link = spec.path;
        options.imageSourcePath = spec.path;
      } else {
        options.text = spec.label || '';
      }
      return typeof bdCreateNodeWithStyle === 'function'
        ? bdCreateNodeWithStyle(spec.path ? '' : (spec.label || ''), x, y, options)
        : bdNode(spec.path ? '' : (spec.label || ''), x, y, 250, 0, options);
    }
    if (spec.kind === 'link' && spec.path) {
      const options = {
        link: spec.path,
        linkType: spec.linkType || inferLinkType(spec.path, ''),
        w: spec.preview ? 240 : 210,
      };
      if (spec.preview) options.img = spec.preview;
      return typeof bdCreateNodeWithStyle === 'function'
        ? bdCreateNodeWithStyle(spec.label || filename(spec.path), x, y, options)
        : bdNode(spec.label || filename(spec.path), x, y, options.w, 0, options);
    }
    return null;
  }

  function specOffset(index, mediaOnly) {
    const columns = mediaOnly ? GRID_COLUMNS : 3;
    return {
      x: (index % columns) * (mediaOnly ? 280 : 240),
      y: Math.floor(index / columns) * (mediaOnly ? 220 : 160),
    };
  }

  function finalizeAddedNodes(nodes, reason) {
    if (!nodes.length) return [];
    const ids = nodes.map(node => node.id);
    let needsFullRender = false;
    if (typeof bdBeginFastBoardMutation === 'function') bdBeginFastBoardMutation();
    try {
      nodes.forEach(node => {
        if (typeof bdAppendFastNode !== 'function' || !bdAppendFastNode(node)) {
          needsFullRender = true;
        }
        if (typeof bdMarkNodeDirty === 'function') bdMarkNodeDirty(node.id, reason);
      });
      if (needsFullRender) {
        if (typeof bdRequestFullRender === 'function') bdRequestFullRender(`${reason}-fallback`);
        else if (typeof bdRender === 'function') bdRender();
      }
      if (typeof bdMarkExtrasDirty === 'function') {
        bdMarkExtrasDirty({ minimap: true, boardUi: true, comments: ids }, reason);
      }
    } finally {
      if (typeof bdEndFastBoardMutation === 'function') bdEndFastBoardMutation();
    }
    bd.selected = new Set(ids);
    bd._activeNode = ids.length === 1 ? ids[0] : null;
    if (typeof bdClearConnectionSelection === 'function') bdClearConnectionSelection();
    if (typeof bdApplySelectionDomClass === 'function') bdApplySelectionDomClass();
    ids.forEach(id => {
      if (typeof bdSyncResizeHandleForNode === 'function') bdSyncResizeHandleForNode(id);
    });
    if (typeof bdSyncResizeHandleForNode !== 'function' && typeof bdSyncResizeHandles === 'function') {
      bdSyncResizeHandles();
    }
    if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(true);
    if (typeof bdDirty === 'function') bdDirty();
    global.MeldexBoardImmersive?.updateEmptyGuide?.();
    return ids;
  }

  function addCardSpecs(rawSpecs, point, options) {
    const specs = (Array.isArray(rawSpecs) ? rawSpecs : []).filter(Boolean).slice(0, MAX_ITEMS);
    if (!specs.length || typeof bd === 'undefined' || !Array.isArray(bd.nodes)) return [];
    const origin = pastePoint(point);
    const mediaOnly = specs.every(spec => spec.kind === 'image');
    const nodes = specs.map((spec, index) => {
      const offset = specOffset(index, mediaOnly);
      return nodeForSpec(spec, origin.x + offset.x, origin.y + offset.y);
    }).filter(Boolean);
    if (!nodes.length) return [];
    if (typeof bdPushUndo === 'function') bdPushUndo(options?.undoLabel || 'ボードへ貼り付け');
    bd.nodes.push(...nodes);
    const ids = finalizeAddedNodes(nodes, options?.reason || 'paste-cards');
    if (typeof showStatus === 'function' && options?.silent !== true) {
      showStatus(ids.length > 1 ? `${ids.length}件のカードを貼り付けました` : 'カードを貼り付けました');
    }
    return ids;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = event => resolve(String(event.target?.result || ''));
      reader.onerror = () => reject(reader.error || new Error('ファイルを読み込めません'));
      reader.readAsDataURL(file);
    });
  }

  function isImageFile(file) {
    return String(file?.type || '').startsWith('image/') || IMAGE_EXT.test(String(file?.name || ''));
  }

  function clipboardFileLinkType(file) {
    const type = String(file?.type || '').toLowerCase();
    if (type.startsWith('video/')) return 'video';
    if (type.startsWith('audio/')) return 'audio';
    return '';
  }

  async function uploadClipboardFile(file, boardDir, snapshot, imageMode) {
    const image = isImageFile(file);
    const dataUrl = await readFileAsDataUrl(file);
    if (!boardSnapshotIsCurrent(snapshot)) return null;
    if (image && imageMode === 'embed') {
      // 過大な画像はダイアログでユーザーに埋め込み/リンクを選ばせる（既定は埋め込み）
      const choice = typeof global.bdResolveImageEmbedChoice === 'function'
        ? await global.bdResolveImageEmbedChoice(file.size, file.name)
        : 'embed';
      if (!boardSnapshotIsCurrent(snapshot)) return null;
      if (choice === 'embed') return imageSpec('', file.name || '貼り付けた画像', dataUrl);
    }
    try {
      const response = await apiFetch('/upload-file?path=' + encodeURIComponent(boardDir), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        silentError: image && !snapshot.path,
        body: JSON.stringify({
          data: dataUrl,
          filename: file.name || (image ? 'clipboard-image.png' : 'clipboard-file'),
        }),
      });
      if (response?.ok && response.path) {
        const path = normalizePath(response.path);
        return image
          ? imageSpec(path, file.name || filename(path))
          : linkSpec(path, file.name || filename(path), clipboardFileLinkType(file));
      }
    } catch (error) {
      if (!image) throw error;
    }
    return image ? imageSpec('', file.name || '貼り付けた画像', dataUrl) : null;
  }

  async function cleanupUploads(specs) {
    if (typeof apiPost !== 'function') return;
    const paths = specs.map(spec => spec?.path).filter(path => path && !/^https?:/i.test(path));
    await Promise.allSettled(paths.map(path => (
      apiPost('/outliner/delete', { path }, { silentError: true })
    )));
  }

  async function mapSettledLimited(items, worker, concurrency) {
    const results = new Array(items.length);
    let nextIndex = 0;
    async function run() {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        try {
          results[index] = { status: 'fulfilled', value: await worker(items[index], index) };
        } catch (reason) {
          results[index] = { status: 'rejected', reason };
        }
      }
    }
    const runnerCount = Math.min(items.length, Math.max(1, Number(concurrency) || 1));
    await Promise.all(Array.from({ length: runnerCount }, run));
    return results;
  }

  async function addFiles(rawFiles, point, options) {
    const files = (Array.isArray(rawFiles) ? rawFiles : Array.from(rawFiles || [])).slice(0, MAX_ITEMS);
    if (!files.length || typeof bd === 'undefined') return [];
    const snapshot = { path: bd.path, openSeq: Number(bd._openSeq) || 0 };
    const boardDir = snapshot.path ? snapshot.path.substring(0, snapshot.path.lastIndexOf('/')) : '';
    const imageMode = typeof bdGetImageDropMode === 'function' ? bdGetImageDropMode() : 'link';
    const settled = await mapSettledLimited(
      files,
      file => uploadClipboardFile(file, boardDir, snapshot, imageMode),
      3,
    );
    const specs = [];
    let failed = 0;
    settled.forEach(result => {
      if (result.status === 'fulfilled' && result.value) specs.push(result.value);
      else failed += 1;
    });
    if (!boardSnapshotIsCurrent(snapshot)) {
      await cleanupUploads(specs);
      if (typeof showStatus === 'function') {
        showStatus('別のボードに切り替わったため、貼り付けを中止しました', true);
      }
      return [];
    }
    const ids = addCardSpecs(specs, point, {
      reason: options?.reason || 'paste-files',
      undoLabel: 'ファイルをボードへ貼り付け',
      silent: true,
    });
    if (typeof showStatus === 'function') {
      if (ids.length) {
        const suffix = failed ? `（${failed}件は読み込めませんでした）` : '';
        showStatus(ids.length > 1 ? `${ids.length}件のファイルカードを貼り付けました${suffix}` : `ファイルカードを貼り付けました${suffix}`);
      } else {
        showStatus('貼り付けられるファイルがありませんでした', true);
      }
    }
    return ids;
  }

  function transferHasContent(transfer) {
    return dataTransferFiles(transfer).length > 0
      || dataTransferTypes(transfer).length > 0
      || !!dataTransferText(transfer, 'text/plain')
      || !!dataTransferText(transfer, 'text/html')
      || !!dataTransferText(transfer, NODE_MIME);
  }

  function hasInternalBoardClipboard() {
    return typeof _bdClipboard !== 'undefined'
      && Array.isArray(_bdClipboard)
      && _bdClipboard.length > 0;
  }

  function shouldPasteInternalBoard(transfer) {
    if (!hasInternalBoardClipboard()) return false;
    if (dataTransferText(transfer, BOARD_MIME)) return true;
    const plain = dataTransferText(transfer, 'text/plain').replace(/\r\n?/g, '\n').trim();
    if (plain && internalCopy.plainText && plain === internalCopy.plainText) return true;
    if (!transferHasContent(transfer)) return true;
    return internalCopy.writeFailed && Date.now() - internalCopy.capturedAt < 5000;
  }

  function specsFromBoardNodes(raw) {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return (Array.isArray(parsed?.nodes) ? parsed.nodes : []).slice(0, MAX_ITEMS).map(node => {
        const path = normalizePath(node?.link || node?.imageSourcePath || '');
        if (path) return specFromMeldexItem({
          path, name: node?.text || filename(path), type: node?.linkType || (node?.img ? 'image' : 'file'),
        });
        const text = String(node?.text || '').trim();
        return text ? { kind: 'text', text, label: text } : null;
      }).filter(Boolean);
    } catch { return []; }
  }

  async function processTransfer(transfer, point, options) {
    const boardSpecs = specsFromBoardNodes(dataTransferText(transfer, BOARD_MIME));
    if (boardSpecs.length) {
      return {
        handled: true,
        ids: addCardSpecs(boardSpecs, point, { reason: 'paste-board-nodes' }),
        kind: 'board',
      };
    }
    if (shouldPasteInternalBoard(transfer) && typeof bdPaste === 'function') {
      bdPaste();
      return { handled: true, ids: [...(bd.selected || [])], kind: 'board' };
    }
    const meldexNodes = parseMeldexNodes(dataTransferText(transfer, NODE_MIME));
    if (meldexNodes.length) {
      return {
        handled: true,
        ids: addCardSpecs(meldexNodes, point, { reason: 'paste-meldex-items' }),
        kind: 'meldex-items',
      };
    }
    const meldexText = dataTransferText(transfer, TEXT_MIME);
    if (meldexText) {
      try {
        const parsed = JSON.parse(meldexText);
        const text = String(parsed?.text || '').trim();
        if (text) {
          return {
            handled: true,
            ids: addCardSpecs([{ kind: 'text', text, label: text }], point, { reason: 'paste-meldex-text' }),
            kind: 'text',
          };
        }
      } catch {}
    }
    const files = dataTransferFiles(transfer);
    if (files.length) {
      const filtered = options?.imagesOnly ? files.filter(isImageFile) : files;
      if (filtered.length) {
        return {
          handled: true,
          ids: await addFiles(filtered, point, { reason: 'paste-files' }),
          kind: 'files',
        };
      }
    }
    const htmlSpecs = specsFromHtml(dataTransferText(transfer, 'text/html'));
    const filteredHtml = options?.imagesOnly
      ? htmlSpecs.filter(spec => spec.kind === 'image')
      : htmlSpecs;
    if (filteredHtml.length) {
      return {
        handled: true,
        ids: addCardSpecs(filteredHtml, point, { reason: 'paste-html' }),
        kind: 'html',
      };
    }
    const uriSpecs = dataTransferText(transfer, 'text/uri-list')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map(plainLineSpec)
      .filter(Boolean);
    if (uriSpecs.length && options?.imagesOnly !== true) {
      return {
        handled: true,
        ids: addCardSpecs(uriSpecs, point, { reason: 'paste-links' }),
        kind: 'links',
      };
    }
    const plainSpecs = specsFromPlainText(dataTransferText(transfer, 'text/plain'));
    const filteredPlain = options?.imagesOnly
      ? plainSpecs.filter(spec => spec.kind === 'image')
      : plainSpecs;
    if (filteredPlain.length) {
      return {
        handled: true,
        ids: addCardSpecs(filteredPlain, point, { reason: 'paste-text' }),
        kind: filteredPlain.every(spec => spec.kind === 'link') ? 'links' : 'text',
      };
    }
    return { handled: false, ids: [], kind: '' };
  }

  async function handlePasteEvent(event) {
    if (!event || !canPasteOnBoard(event.target)) return false;
    event.preventDefault();
    event.stopPropagation();
    const result = await processTransfer(event.clipboardData, pastePoint(), {});
    if (!result.handled && typeof showStatus === 'function') {
      showStatus('貼り付けられる内容がクリップボードにありません', true);
    }
    return result.handled;
  }

  async function clipboardItemsTransfer(items) {
    const data = new Map();
    const files = [];
    for (const item of items || []) {
      for (const type of item.types || []) {
        const blob = await item.getType(type);
        if (type === 'text/plain' || type === 'text/html' || type === 'text/uri-list' || type === NODE_MIME || type === BOARD_MIME) {
          data.set(type, await blob.text());
        } else {
          const extension = (type.split('/')[1] || 'bin')
            .replace('jpeg', 'jpg')
            .replace(/[^a-z0-9.+-]/gi, '-')
            .slice(0, 32);
          const name = `clipboard-${files.length + 1}.${extension}`;
          files.push(typeof File === 'function' ? new File([blob], name, { type }) : blob);
        }
      }
    }
    return {
      types: [...data.keys(), ...(files.length ? ['Files'] : [])],
      files,
      items: [],
      getData(type) { return data.get(type) || ''; },
    };
  }

  async function requestPaste(options) {
    if (!canPasteOnBoard(document.activeElement)) return false;
    const point = pastePoint(options?.point);
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        const transfer = await clipboardItemsTransfer(items);
        const result = await processTransfer(transfer, point, options || {});
        if (result.handled) return true;
      }
      if (navigator.clipboard?.readText && options?.imagesOnly !== true) {
        const text = await navigator.clipboard.readText();
        const transfer = {
          types: text ? ['text/plain'] : [],
          files: [],
          items: [],
          getData(type) { return type === 'text/plain' ? text : ''; },
        };
        const result = await processTransfer(transfer, point, options || {});
        if (result.handled) return true;
      }
      if (typeof showStatus === 'function') showStatus('貼り付けられる内容がクリップボードにありません', true);
    } catch (error) {
      if (typeof showStatus === 'function') {
        showStatus('クリップボードを読み取れません。ボード上でCtrl+Vを押してください', true);
      }
    }
    return false;
  }

  function boardCopyPlainText(nodes) {
    return (Array.isArray(nodes) ? nodes : [])
      .map(node => String(node?.text || node?.link || node?.imageSourcePath || '').trim())
      .filter(Boolean)
      .join('\n');
  }

  function captureBoardCopy(nodes) {
    const plainText = boardCopyPlainText(nodes);
    internalCopy = { plainText, capturedAt: Date.now(), writeFailed: false };
    if (!plainText || !navigator.clipboard?.writeText) {
      internalCopy.writeFailed = true;
      return Promise.resolve(false);
    }
    return navigator.clipboard.writeText(plainText)
      .then(() => true)
      .catch(() => {
        internalCopy.writeFailed = true;
        return false;
      });
  }

  function setEntityDragData(transfer, dbPath, entityName, entityPath) {
    if (!transfer || !entityName) return null;
    const path = entityPath || (typeof _entityPath === 'function'
      ? _entityPath(dbPath, entityName)
      : `${normalizePath(dbPath).replace(/\/$/, '')}/${entityName}`);
    const payload = { name: String(entityName), path: normalizePath(path), type: 'entity' };
    transfer.setData('text/plain', payload.name);
    transfer.setData(NODE_MIME, JSON.stringify(payload));
    global.MeldexDnD?.beginCrossWindowDrag?.(transfer, payload, 'node');
    return payload;
  }

  function setBoardNodesDragData(transfer, nodes) {
    const payload = { nodes: (Array.isArray(nodes) ? nodes : []).slice(0, MAX_ITEMS) };
    if (!transfer || !payload.nodes.length) return null;
    transfer.setData(BOARD_MIME, JSON.stringify(payload));
    if (!dataTransferText(transfer, 'text/plain')) transfer.setData('text/plain', boardCopyPlainText(payload.nodes));
    global.MeldexDnD?.beginCrossWindowDrag?.(transfer, payload, 'board-nodes');
    return payload;
  }

  function visible(element) {
    return !!element && element.isConnected && !element.hidden && element.getClientRects?.().length > 0;
  }

  function currentPaneRoot(target) {
    return target?.closest?.('.gb-pane')
      || document.querySelector('.gb-pane.active')
      || document.getElementById(typeof GBLayout !== 'undefined' ? GBLayout.activePane : '')
      || document;
  }

  function clipboardItemsFromUi(event) {
    const target = event.target?.nodeType === 1 ? event.target : document.activeElement;
    const outlinerNode = target?.closest?.('.tree-node');
    if (outlinerNode && typeof treeSelection !== 'undefined') {
      return treeSelection.getNodeData()
        .filter(item => item?.path && !item._isRoot)
        .map(item => ({ name: item.name || filename(item.path), path: item.path, type: item.type || 'file' }));
    }
    if (typeof state !== 'undefined' && state?.view === 'folder') {
      const root = currentPaneRoot(target);
      const items = [...root.querySelectorAll('.fv-item.selected')].filter(visible).map(element => ({
        name: element.dataset.itemName || element.querySelector('.fv-name')?.textContent || filename(element.dataset.path),
        path: element.dataset.path || '',
        type: element.dataset.itemType || 'file',
      })).filter(item => item.path);
      if (items.length) return items;
    }
    if (typeof state !== 'undefined' && state?.view === 'database') {
      const root = currentPaneRoot(target);
      const selected = [...root.querySelectorAll('[data-meldex-entity-path]')]
        .filter(element => visible(element) && (
          element === target
          || element.contains(target)
          || element.classList.contains('selected')
          || element.classList.contains('row-selected')
          || element.getAttribute('aria-selected') === 'true'
        ));
      const items = selected.map(element => ({
        name: element.dataset.entityName || element.dataset.entity || filename(element.dataset.meldexEntityPath),
        path: element.dataset.meldexEntityPath,
        type: 'entity',
      })).filter(item => item.path);
      if (items.length) return items;
    }
    const pathElement = target?.closest?.('[data-path]');
    if (pathElement?.dataset?.path) {
      return [{
        name: pathElement.dataset.itemName || pathElement.textContent?.trim() || filename(pathElement.dataset.path),
        path: pathElement.dataset.path,
        type: pathElement.dataset.itemType || pathElement.dataset.type || 'file',
      }];
    }
    return [];
  }

  function handleCopyEvent(event) {
    if (event.defaultPrevented || isEditableTarget(event.target)) return;
    const selection = String(global.getSelection?.()?.toString() || '').trim();
    if (selection) {
      internalCopy = { plainText: '', capturedAt: 0, writeFailed: false };
      return;
    }
    const items = clipboardItemsFromUi(event).slice(0, MAX_ITEMS);
    if (!items.length || !event.clipboardData) return;
    const payload = items.length === 1 ? items[0] : { items };
    event.preventDefault();
    event.clipboardData.setData(NODE_MIME, JSON.stringify(payload));
    event.clipboardData.setData('text/plain', items.map(item => item.name || item.path).join('\n'));
    internalCopy = { plainText: '', capturedAt: 0, writeFailed: false };
    if (typeof showStatus === 'function') {
      showStatus(items.length > 1 ? `${items.length}件をコピーしました` : '項目をコピーしました');
    }
  }

  function install() {
    document.addEventListener('paste', event => {
      handlePasteEvent(event).catch(error => {
        console.error('[board-transfer] paste failed:', error);
        if (typeof showStatus === 'function') showStatus('貼り付けに失敗しました', true);
      });
    }, true);
    document.addEventListener('copy', handleCopyEvent, true);
    document.addEventListener('pointerdown', event => {
      if (!event.target?.closest?.('#bd-canvas,[data-bd-role="canvas"]')) return;
      if (typeof bdScreenToWorld === 'function') {
        lastBoardPoint = bdScreenToWorld(event.clientX, event.clientY);
      }
    }, { passive: true });
  }

  global.MeldexBoardTransfer = {
    NODE_MIME,
    BOARD_MIME,
    addCardSpecs,
    addFiles,
    captureBoardCopy,
    handlePasteEvent,
    processTransfer,
    requestPaste,
    setEntityDragData,
    setBoardNodesDragData,
    _test: {
      parseMeldexNodes,
      specsFromHtml,
      specsFromPlainText,
      specFromMeldexItem,
      specsFromBoardNodes,
    },
  };

  if (typeof document !== 'undefined') install();
})(window);
