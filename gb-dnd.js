/* gb-dnd.js — D&Dユーティリティモジュール
 * D&Dの共通処理を集約: ペイロード解析、リンクHTML生成、ファイル種別判定
 */
const MeldexDnD = (() => {
  const OFFER_TTL_MS = 10000;
  const OFFER_MAX_ITEMS = 100;
  const OFFER_MAX_CHARS = 262144;
  const OFFER_MAX_CACHE_COUNT = 64;
  const OFFER_MAX_CACHE_CHARS = 1048576;
  const DND_QUERY_KEY = 'dnd';
  const KIND_MIME = Object.freeze({
    node: 'application/x-meldex-node',
    text: 'application/x-meldex-text',
    'board-nodes': 'application/x-meldex-board-nodes',
  });
  const receivedOffers = new Map();
  const sourceOffers = new Map();
  const acceptedOffers = new Map();
  const consumedOffers = new Map();
  const sourceClaims = new Map();
  const claimResults = new Map();
  const offerExpiryTimers = new Map();
  let bridgeTransport = null;

  function _transport() {
    const candidate = globalThis.MeldexBroadcast || globalThis.GBBroadcast;
    if (!candidate?.send || !candidate?.on) return null;
    if (bridgeTransport === candidate) return candidate;
    bridgeTransport = candidate;
    candidate.on('dnd-offer', _receiveOffer);
    candidate.on('dnd-request', _receiveRequest);
    candidate.on('dnd-ack', _receiveAck);
    candidate.on('dnd-cancel', _receiveCancel);
    candidate.on('dnd-claim', _receiveClaim);
    candidate.on('dnd-claim-result', _receiveClaimResult);
    candidate.on('dnd-fail', _receiveFail);
    return candidate;
  }

  function _now() { return Date.now(); }

  function _validNonce(value) {
    return typeof value === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(value);
  }

  function _validPayload(payload, kind) {
    if (!payload || typeof payload !== 'object') return false;
    try {
      const encoded = JSON.stringify(payload);
      if (!encoded || encoded.length > OFFER_MAX_CHARS) return false;
    } catch { return false; }
    const arrays = [payload.items, payload.nodes].filter(Array.isArray);
    if (!arrays.every(rows => rows.length <= OFFER_MAX_ITEMS)) return false;
    if (kind === 'node') {
      const rows = Array.isArray(payload.items) ? payload.items : [payload];
      return rows.length > 0 && rows.every(row => row && typeof row === 'object'
        && typeof row.path === 'string' && row.path.trim().length > 0);
    }
    if (kind === 'text') return typeof payload.text === 'string' && payload.text.length > 0;
    if (kind === 'board-nodes') {
      return Array.isArray(payload.nodes) && payload.nodes.length > 0
        && payload.nodes.every(node => node && typeof node === 'object');
    }
    return true;
  }

  function _validOffer(offer, senderWindowId) {
    return !!offer
      && offer.schema === 1
      && _validNonce(offer.nonce)
      && Object.hasOwn(KIND_MIME, offer.kind)
      && offer.origin === location.origin
      && typeof offer.sourceWindowId === 'string'
      && (!senderWindowId || senderWindowId === offer.sourceWindowId)
      && Number.isFinite(offer.createdAt)
      && _now() - offer.createdAt >= -1000
      && _now() - offer.createdAt <= OFFER_TTL_MS
      && _validPayload(offer.payload, offer.kind);
  }

  function _receiveOffer(message) {
    _purgeExpired();
    if (!_validOffer(message?.offer, message?.windowId)) return;
    if (consumedOffers.has(message.offer.nonce)) return;
    receivedOffers.set(message.offer.nonce, message.offer);
    _trimReceivedOffers();
    _scheduleExpiry(message.offer.nonce);
  }

  function _receiveRequest(message) {
    const nonce = message?.nonce;
    const offer = sourceOffers.get(nonce);
    if (!_validOffer(offer) || (message?.origin && message.origin !== location.origin)) return;
    (_transport()?.sendDndOffer || ((payload) => _transport()?.send('dnd-offer', payload)))({ offer });
  }

  function _receiveAck(message) {
    const nonce = message?.nonce;
    if (!_validNonce(nonce) || message?.origin !== location.origin) return;
    const offer = sourceOffers.get(nonce);
    const claim = sourceClaims.get(nonce);
    if (!offer || message?.targetWindowId !== offer.sourceWindowId
        || (claim && claim.windowId !== message?.windowId)) return;
    acceptedOffers.set(nonce, _now());
    sourceClaims.delete(nonce);
    sourceOffers.delete(nonce);
  }

  function _receiveClaim(message) {
    const nonce = message?.nonce;
    const offer = sourceOffers.get(nonce);
    if (!_validOffer(offer) || message?.origin !== location.origin
        || message?.claimantWindowId !== message?.windowId) return;
    let claim = sourceClaims.get(nonce);
    if (!claim) {
      claim = { windowId: message.windowId, claimedAt: _now() };
      sourceClaims.set(nonce, claim);
    }
    const transport = _transport();
    if (transport) {
      (transport.sendDndClaimResult || ((value) => transport.send('dnd-claim-result', value)))({
        nonce,
        origin: location.origin,
        sourceWindowId: offer.sourceWindowId,
        claimantWindowId: message.windowId,
        granted: claim.windowId === message.windowId,
      });
    }
  }

  function _receiveClaimResult(message) {
    const transport = _transport();
    if (!_validNonce(message?.nonce) || message?.origin !== location.origin || !transport
        || message?.claimantWindowId !== transport.windowId
        || message?.sourceWindowId !== message?.windowId) return;
    claimResults.set(message.nonce, {
      granted: message.granted === true,
      sourceWindowId: message.sourceWindowId,
      receivedAt: _now(),
    });
  }

  function _receiveFail(message) {
    const nonce = message?.nonce;
    const offer = sourceOffers.get(nonce);
    const claim = sourceClaims.get(nonce);
    if (!offer || !claim || message?.origin !== location.origin
        || message?.targetWindowId !== offer.sourceWindowId
        || message?.windowId !== claim.windowId) return;
    sourceClaims.delete(nonce);
    sourceOffers.delete(nonce);
  }

  function _receiveCancel(message) {
    if (!_validNonce(message?.nonce) || message?.origin !== location.origin) return;
    receivedOffers.delete(message.nonce);
  }

  function _purgeExpired() {
    const now = _now();
    for (const [nonce, offer] of receivedOffers) {
      if (now - offer.createdAt > OFFER_TTL_MS) receivedOffers.delete(nonce);
    }
    for (const [nonce, offer] of sourceOffers) {
      if (now - offer.createdAt > OFFER_TTL_MS) sourceOffers.delete(nonce);
    }
    for (const [nonce, acceptedAt] of acceptedOffers) {
      if (now - acceptedAt > OFFER_TTL_MS) acceptedOffers.delete(nonce);
    }
    for (const [nonce, consumedAt] of consumedOffers) {
      if (now - consumedAt > OFFER_TTL_MS) consumedOffers.delete(nonce);
    }
    for (const [nonce, claim] of sourceClaims) {
      if (now - claim.claimedAt > OFFER_TTL_MS) sourceClaims.delete(nonce);
    }
    for (const [nonce, result] of claimResults) {
      if (now - result.receivedAt > OFFER_TTL_MS) claimResults.delete(nonce);
    }
  }

  function _trimReceivedOffers() {
    const entries = [...receivedOffers.entries()];
    let totalChars = entries.reduce((sum, [, offer]) => sum + JSON.stringify(offer).length, 0);
    while (receivedOffers.size > OFFER_MAX_CACHE_COUNT || totalChars > OFFER_MAX_CACHE_CHARS) {
      const oldest = [...receivedOffers.entries()]
        .sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
      if (!oldest) break;
      totalChars -= JSON.stringify(oldest[1]).length;
      receivedOffers.delete(oldest[0]);
    }
  }

  function _scheduleExpiry(nonce) {
    if (typeof setTimeout !== 'function') return;
    const previous = offerExpiryTimers.get(nonce);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      receivedOffers.delete(nonce);
      sourceOffers.delete(nonce);
      sourceClaims.delete(nonce);
      claimResults.delete(nonce);
      offerExpiryTimers.delete(nonce);
    }, OFFER_TTL_MS + 50);
    timer?.unref?.();
    offerExpiryTimers.set(nonce, timer);
  }

  function _uriWithNonce(dataTransfer, nonce) {
    let urls = [];
    try {
      urls = String(dataTransfer.getData('text/uri-list') || '')
        .split(/\r?\n/).map(value => value.trim()).filter(value => value && !value.startsWith('#'));
    } catch {}
    let url = null;
    for (const value of urls) {
      try {
        const candidate = new URL(value, location.href);
        if (candidate.origin === location.origin) { url = candidate; break; }
      } catch {}
    }
    if (!url) url = new URL(location.href);
    url.searchParams.set(DND_QUERY_KEY, nonce);
    dataTransfer.setData('text/uri-list', url.toString());
    return url.toString();
  }

  function _nonceFromTransfer(dataTransfer) {
    let raw = '';
    try { raw = String(dataTransfer?.getData?.('text/uri-list') || ''); } catch { return ''; }
    for (const line of raw.split(/\r?\n/)) {
      const value = line.trim();
      if (!value || value.startsWith('#')) continue;
      try {
        const url = new URL(value, location.href);
        const nonce = url.searchParams.get(DND_QUERY_KEY) || '';
        if (url.origin === location.origin && _validNonce(nonce)) return nonce;
      } catch {}
    }
    return '';
  }

  function beginCrossWindowDrag(dataTransfer, payload, kind) {
    if (!dataTransfer || !globalThis.location?.origin
        || !Object.hasOwn(KIND_MIME, kind) || !_validPayload(payload, kind)) return '';
    _purgeExpired();
    const transport = _transport();
    const nonce = globalThis.crypto?.randomUUID?.()
      || `${_now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    const offer = {
      schema: 1,
      nonce,
      kind,
      payload: typeof structuredClone === 'function' ? structuredClone(payload) : JSON.parse(JSON.stringify(payload)),
      origin: location.origin,
      sourceWindowId: transport?.windowId || 'local-window',
      createdAt: _now(),
    };
    sourceOffers.set(nonce, offer);
    _scheduleExpiry(nonce);
    _uriWithNonce(dataTransfer, nonce);
    if (transport) (transport.sendDndOffer || ((value) => transport.send('dnd-offer', value)))({ offer });
    return nonce;
  }

  function hasDropKind(eventOrTransfer, kind) {
    const transfer = eventOrTransfer?.dataTransfer || eventOrTransfer;
    const mime = KIND_MIME[kind];
    if (!transfer || !mime) return false;
    try {
      if (Array.from(transfer.types || []).includes(mime)) return true;
    } catch {}
    const nonce = _nonceFromTransfer(transfer);
    if (!nonce || consumedOffers.has(nonce)) return false;
    _purgeExpired();
    const knownOffer = receivedOffers.get(nonce) || sourceOffers.get(nonce);
    return knownOffer ? _validOffer(knownOffer) && knownOffer.kind === kind : true;
  }

  function _parsePayload(raw, kind) {
    try {
      const payload = JSON.parse(raw);
      return _validPayload(payload, kind) ? payload : null;
    } catch { return null; }
  }

  async function _claimOffer(nonce) {
    if (!nonce || consumedOffers.has(nonce)) return null;
    const localOffer = sourceOffers.get(nonce);
    const transport = _transport();
    if (localOffer && transport) {
      let claim = sourceClaims.get(nonce);
      if (!claim) {
        claim = { windowId: transport.windowId, claimedAt: _now() };
        sourceClaims.set(nonce, claim);
      }
      return claim.windowId === transport.windowId
        ? { granted: true, sourceWindowId: localOffer.sourceWindowId }
        : null;
    }
    if (!transport) return null;
    claimResults.delete(nonce);
    (transport.claimDndOffer || ((value) => transport.send('dnd-claim', value)))({
      nonce,
      origin: location.origin,
      claimantWindowId: transport.windowId,
    });
    const deadline = _now() + 120;
    while (_now() < deadline && !claimResults.has(nonce)) {
      await new Promise(resolve => setTimeout(resolve, 8));
    }
    const result = claimResults.get(nonce) || null;
    claimResults.delete(nonce);
    return result?.granted ? result : null;
  }

  async function resolveDropData(eventOrTransfer, kind) {
    const transfer = eventOrTransfer?.dataTransfer || eventOrTransfer;
    const mime = KIND_MIME[kind];
    if (!transfer || !mime) return null;
    const types = Array.from(transfer.types || []);
    const nonce = _nonceFromTransfer(transfer);
    // Chromium が native custom MIME を渡した場合は、bridge offer より必ず優先する。
    if (types.includes(mime)) {
      const payload = _parsePayload(transfer.getData(mime), kind);
      if (payload) {
        if (nonce && consumedOffers.has(nonce)) return null;
        const claim = nonce ? await _claimOffer(nonce) : { granted: true, sourceWindowId: '' };
        if (nonce && !claim) return null;
        if (nonce) {
          receivedOffers.delete(nonce);
          consumedOffers.set(nonce, _now());
        }
        return { kind, payload, nonce, source: 'native', sourceWindowId: claim?.sourceWindowId || '' };
      }
      // custom MIME が空/不正でも、有効なURI offerがあれば下のfallbackへ進む。
    }
    if (!nonce) return null;
    _purgeExpired();
    let offer = receivedOffers.get(nonce);
    if (!offer) {
      const transport = _transport();
      if (transport) (transport.requestDndOffer || ((value) => transport.send('dnd-request', value)))({ nonce, origin: location.origin });
      await new Promise(resolve => setTimeout(resolve, 80));
      offer = receivedOffers.get(nonce);
    }
    if (!_validOffer(offer) || offer.kind !== kind) return null;
    const claim = await _claimOffer(nonce);
    if (!claim) return null;
    receivedOffers.delete(nonce); // replay は同一ウィンドウでも一回だけ
    consumedOffers.set(nonce, _now());
    return { kind, payload: offer.payload, nonce, source: 'bridge', sourceWindowId: claim.sourceWindowId };
  }

  function completeDrop(resolved) {
    if (!resolved?.nonce) return false;
    const transport = _transport();
    if (!transport) return false;
    if (resolved.sourceWindowId === transport.windowId && sourceOffers.has(resolved.nonce)) {
      acceptedOffers.set(resolved.nonce, _now());
      sourceClaims.delete(resolved.nonce);
      sourceOffers.delete(resolved.nonce);
      return true;
    }
    (transport.sendDndAck || ((value) => transport.send('dnd-ack', value)))({
      nonce: resolved.nonce,
      origin: location.origin,
      targetWindowId: resolved.sourceWindowId || '',
    });
    return true;
  }

  function failDrop(resolved) {
    if (!resolved?.nonce) return false;
    const transport = _transport();
    if (!transport) return false;
    if (resolved.sourceWindowId === transport.windowId && sourceOffers.has(resolved.nonce)) {
      sourceClaims.delete(resolved.nonce);
      sourceOffers.delete(resolved.nonce);
      return true;
    }
    (transport.sendDndFail || ((value) => transport.send('dnd-fail', value)))({
      nonce: resolved.nonce,
      origin: location.origin,
      targetWindowId: resolved.sourceWindowId || '',
    });
    return true;
  }

  function dataTransferWithResolved(original, resolved) {
    if (!resolved?.payload || !KIND_MIME[resolved.kind]) return original;
    const mime = KIND_MIME[resolved.kind];
    return {
      types: Array.from(new Set([...(Array.from(original?.types || [])), mime])),
      files: original?.files || [],
      items: original?.items || [],
      getData(type) {
        if (type === mime) return JSON.stringify(resolved.payload);
        try { return original?.getData?.(type) || ''; } catch { return ''; }
      },
    };
  }

  function cancelCrossWindowDrag(nonce) {
    if (!_validNonce(nonce)) return;
    if (sourceClaims.has(nonce)) return; // processing中は最終ACK/失敗通知までofferを保持
    sourceOffers.delete(nonce);
    const transport = _transport();
    if (transport) (transport.sendDndCancel || ((value) => transport.send('dnd-cancel', value)))({ nonce, origin: location.origin });
  }

  async function waitForDropAck(nonce, waitMs) {
    const deadline = _now() + Math.max(0, Math.min(Number(waitMs) || 160, 500));
    while (_now() < deadline && !acceptedOffers.has(nonce)) {
      await new Promise(resolve => setTimeout(resolve, 16));
    }
    const accepted = acceptedOffers.has(nonce);
    if (accepted) acceptedOffers.delete(nonce);
    return accepted;
  }

  async function waitForDropDisposition(nonce, waitMs) {
    const deadline = _now() + Math.max(0, Math.min(Number(waitMs) || 180, 500));
    while (_now() < deadline && !acceptedOffers.has(nonce) && !sourceClaims.has(nonce)) {
      await new Promise(resolve => setTimeout(resolve, 8));
    }
    return acceptedOffers.has(nonce) || sourceClaims.has(nonce);
  }

  // gb-broadcast.js が後から読み込まれる構成でも listener を結線する。
  if (typeof setTimeout === 'function') setTimeout(() => _transport(), 0);
  // --- パネル操作系D&Dタイプ判定 ---
  function isPanelDnD(types, ctrlKey) {
    if (types.includes('application/meldex-tool') ||
        types.includes('application/x-gb-tab') ||
        types.includes('application/x-gb-pane') ||
        types.includes('application/x-gb-panelset-group') ||
        types.includes('application/x-gb-column')) return true;
    if (types.includes('application/x-meldex-node') && ctrlKey) return true;
    return false;
  }

  // --- ペイロード解析 ---
  function parseMeldexNode(e) {
    const raw = e.dataTransfer.getData('application/x-meldex-node');
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      return {
        name: data.name || '',
        path: data.path || '',
        type: data.type || 'page',
        items: data.items || [data]
      };
    } catch { return null; }
  }

  function inferNodeType(path, explicitType) {
    const declared = String(explicitType || '').trim().toLowerCase();
    if (declared === 'media') return getMediaType((path || '').split('.').pop()) || 'file';
    if (declared) return declared;
    return getMediaType((path || '').split('.').pop()) || 'file';
  }

  function writeNodePayload(dataTransfer, item, surface) {
    const path = String(item?.path || '').trim();
    if (!dataTransfer || !path) return null;
    const name = String(item?.name || item?.label || path.split(/[\\/]/).pop() || path);
    const type = inferNodeType(path, item?.type || item?.toolType || item?.state?.mediaType);
    const normalized = { name, path, type, sourceSurface: surface || 'main' };
    const payload = { ...normalized, items: [normalized] };
    dataTransfer.setData('application/x-meldex-node', JSON.stringify(payload));
    dataTransfer.setData('text/plain', path);
    dataTransfer.effectAllowed = 'copyMove';
    beginCrossWindowDrag(dataTransfer, payload, 'node');
    return payload;
  }

  // 右サブパネル/フロートの表示対象を、ツリーと同じ共通payloadで
  // メインパネルや他アプリへドラッグできるようにする。
  function installSurfaceDragSource(root, handle, currentItem, surface) {
    if (!root || !handle || typeof currentItem !== 'function') return;
    handle.draggable = true;
    handle.dataset.meldexDragSurface = surface || 'main';
    handle.addEventListener('dragstart', e => {
      const payload = writeNodePayload(e.dataTransfer, currentItem(), surface);
      if (!payload) {
        e.preventDefault();
        return;
      }
      e.stopPropagation();
      root.classList.add('meldex-surface-dragging');
    });
    handle.addEventListener('dragend', () => root.classList.remove('meldex-surface-dragging'));
  }

  function installSurfaceDropTarget(root, onNodeDrop) {
    if (!root || typeof onNodeDrop !== 'function') return;
    root.addEventListener('dragover', e => {
      if (!hasDropKind(e, 'node')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = e.altKey ? 'link' : 'copy';
    });
    root.addEventListener('drop', async e => {
      const resolved = await resolveDropData(e, 'node');
      const parsed = resolved?.payload || null;
      if (!parsed?.path) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        const outcome = await Promise.resolve(onNodeDrop(parsed, e));
        if (outcome !== false) completeDrop(resolved);
        else failDrop(resolved);
      } catch (error) {
        failDrop(resolved);
        console.error('[MeldexDnD] surface drop failed:', error);
      }
    });
  }

  // --- ファイル種別判定 ---
  const IMAGE_EXTS = ['png','jpg','jpeg','gif','bmp','webp','svg','ico','avif'];
  const VIDEO_EXTS = ['mp4','webm','ogv','mov','avi'];
  const AUDIO_EXTS = ['mp3','wav','ogg','flac','aac','m4a'];

  function getMediaType(ext) {
    ext = (ext || '').toLowerCase();
    if (IMAGE_EXTS.includes(ext)) return 'image';
    if (VIDEO_EXTS.includes(ext)) return 'video';
    if (AUDIO_EXTS.includes(ext)) return 'audio';
    return null;
  }

  function resolveOpenType(type, ext) {
    const declared = String(type || '').trim().toLowerCase();
    const extension = String(ext || '').trim().toLowerCase().replace(/^\./, '');
    if (declared === 'image' || declared === 'video' || declared === 'audio' || declared === 'media') return 'media';
    if (declared === 'pdf' || extension === 'pdf') return 'media';
    if (declared === 'database') return 'pivot';
    if (declared === 'board') return 'board';
    if (declared === 'scriptnote') return 'scriptnote';
    return declared || 'page';
  }

  function normalizeOpenTarget(item) {
    const path = String(item?.path || '').trim();
    if (!path) return null;
    const ext = path.split('.').pop().toLowerCase();
    const declared = String(item?.type || item?.toolType || '').trim().toLowerCase();
    const label = String(item?.label || item?.name || path.split(/[\\/]/).pop() || path);
    if (declared === 'document' && ext !== 'pdf'
        && typeof GBLinkRouter !== 'undefined' && typeof GBLinkRouter.resolve === 'function') {
      return GBLinkRouter.resolve({ path, label, type: declared });
    }
    const type = resolveOpenType(declared, ext);
    const state = { ...(item?.state || {}) };
    if (type === 'media') {
      state.mediaType = declared === 'media'
        ? (state.mediaType || item?.mediaType || getMediaType(ext) || (ext === 'pdf' ? 'pdf' : 'file'))
        : (declared === 'pdf' || ext === 'pdf'
          ? 'pdf'
          : declared);
    }
    return {
      type,
      path,
      label,
      state,
    };
  }

  // --- リンクHTML生成 ---
  function getIconForType(type) {
    switch (type) {
      case 'database': return 'database';
      case 'entity':   return 'fileSpreadsheet';
      case 'scenario': return 'scenario';
      case 'scriptnote': return 'bookOpenText';
      case 'board':    return 'layout';
      case 'image':    return 'image';
      case 'video':    return 'film';
      case 'audio':    return 'music';
      default:         return 'file';
    }
  }

  function createAutoLinkHtml(name, path, type) {
    const isMedia = type === 'image' || type === 'video' || type === 'audio';
    const ext = (path || '').split('.').pop().toLowerCase();
    const mediaType = isMedia ? type : getMediaType(ext);

    if (mediaType === 'image') {
      const imgUrl = '/api/file-raw?path=' + encodeURIComponent(path);
      return `<div class="embed-media" contenteditable="false" data-meldex-image-host data-path="${esc(path)}" data-name="${esc(name)}"><img src="${imgUrl}" alt="${esc(name)}" data-meldex-content-image></div>`;
    }

    if (mediaType === 'video' || mediaType === 'audio') {
      const mediaUrl = '/api/file-raw?path=' + encodeURIComponent(path);
      const tag = mediaType;
      return `<div class="embed-media" contenteditable="false" data-path="${esc(path)}" data-name="${esc(name)}"><${tag} controls preload="metadata" src="${mediaUrl}"></${tag}></div>`;
    }

    const icon = isMedia ? 'paperclip' : getIconForType(type);
    return `<span class="auto-link" data-path="${esc(path)}" style="color:var(--accent);text-decoration:underline;cursor:pointer;">${lucide(icon,12)} ${esc(name)}</span> `;
  }

  function insertNodeAtEditableRange(editable, item, preferredRange) {
    if (!editable || !item?.path) return false;
    let range = preferredRange?.cloneRange?.() || null;
    const rangeNode = range?.commonAncestorContainer;
    const rangeElement = rangeNode?.nodeType === Node.ELEMENT_NODE ? rangeNode : rangeNode?.parentElement;
    if (!range || !rangeElement || !editable.contains(rangeElement)) {
      range = document.createRange();
      range.selectNodeContents(editable);
      range.collapse(false);
    }
    const fragment = range.createContextualFragment(createAutoLinkHtml(item.name || '', item.path, item.type || 'file'));
    const last = fragment.lastChild;
    range.deleteContents();
    range.insertNode(fragment);
    window.MeldexImageLoading?.trackAll?.(editable);
    if (last) {
      range.setStartAfter(last);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges?.();
      selection?.addRange?.(range);
    }
    editable.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  // --- ドロップキャレット表示 ---
  function showDropCaret(editableEl, e) {
    let caret = editableEl.querySelector('.drop-caret');
    if (!caret) {
      caret = document.createElement('div');
      caret.className = 'drop-caret';
      editableEl.style.position = 'relative';
      editableEl.appendChild(caret);
    }
    const range = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
    if (range) {
      const rects = range.getClientRects();
      const elRect = editableEl.getBoundingClientRect();
      // 挿入位置の線は行の終端側（横書き=行の下辺 / 縦書きrl=行の左辺）へ置く。
      // CSS 側が inset-block-start / block-size / inset-inline を使うため、
      // 縦書きでは同じ宣言のまま自動的に縦線になる。
      const wm = window.MeldexNoteWritingMode;
      const vertical = !!(wm && wm.isVertical(editableEl));
      let offset;
      if (vertical) {
        // vertical-rl は右端が行の始まりで、進むほど左へ向かう。Chrome ではこの向きの
        // 横スクロール量は 0 から負へ動くため、進んだ距離は -scrollLeft になる。
        const base = rects.length > 0 ? rects[0].left : e.clientX;
        offset = (elRect.right - base) - editableEl.scrollLeft;
      } else {
        const base = rects.length > 0 ? rects[0].bottom : e.clientY;
        offset = (base - elRect.top) + editableEl.scrollTop;
      }
      caret.style.insetBlockStart = offset + 'px';
      caret.style.display = '';
    }
  }

  function hideDropCaret(editableEl) {
    const caret = editableEl.querySelector('.drop-caret');
    if (caret) caret.remove();
  }

  // --- キャレット位置にカーソルをセット ---
  function setCaretFromPoint(e) {
    const range = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
    if (range) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  return {
    isPanelDnD,
    beginCrossWindowDrag,
    hasDropKind,
    resolveDropData,
    completeDrop,
    failDrop,
    dataTransferWithResolved,
    cancelCrossWindowDrag,
    waitForDropAck,
    waitForDropDisposition,
    parseMeldexNode,
    inferNodeType,
    writeNodePayload,
    installSurfaceDragSource,
    installSurfaceDropTarget,
    getMediaType,
    resolveOpenType,
    normalizeOpenTarget,
    getIconForType,
    createAutoLinkHtml,
    insertNodeAtEditableRange,
    showDropCaret,
    hideDropCaret,
    setCaretFromPoint
  };
})();
