/* 画像プロパティ */

function parseImagePropertyValue(value) {
  if (Array.isArray(value)) return value.filter(v => v && typeof v === 'object');
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(v => v && typeof v === 'object') : [];
  } catch {
    return [];
  }
}

function stringifyImagePropertyValue(items) {
  return JSON.stringify(Array.isArray(items) ? items : []);
}

// 画像列は画像に加えて動画・PDFも受け付ける（列側で accept を指定した場合はその設定を優先）
const ATTACHMENT_VIDEO_EXTS = ['mp4', 'webm', 'mov'];
const ATTACHMENT_DOCUMENT_EXTS = ['pdf'];
const ATTACHMENT_DEFAULT_ACCEPT = ['png', 'jpg', 'jpeg', 'gif', 'webp'].concat(ATTACHMENT_VIDEO_EXTS, ATTACHMENT_DOCUMENT_EXTS);

function _imagePropOptions(ptc) {
  const opts = ptc?.options || {};
  const accept = Array.isArray(opts.accept) && opts.accept.length
    ? opts.accept.map(s => String(s).toLowerCase().replace(/^\./, ''))
    : ATTACHMENT_DEFAULT_ACCEPT.slice();
  const thumbSize = Math.max(64, Math.min(1024, parseInt(opts.thumbnail_size, 10) || 256));
  return {
    maxCount: opts.max_count == null || opts.max_count === '' ? 100 : Math.max(1, parseInt(opts.max_count, 10) || 100),
    accept: accept.filter(ext => ext !== 'svg'),
    thumbSize,
    cellSize: _imagePropCellSize(ptc),
  };
}

function _imagePropCellSize(ptc) {
  const opts = ptc?.options || {};
  const thumbSize = Math.max(64, Math.min(1024, parseInt(opts.thumbnail_size, 10) || 256));
  const raw = opts.cell_height ?? opts.cell_thumbnail_size;
  return Math.max(32, Math.min(320, parseInt(raw, 10) || Math.min(96, thumbSize)));
}

// 新方式（シートフォルダ内の添付フォルダ）の実ファイルパスから表示URLを組み立てる。
// 縮小表示は共通のサムネイル生成、原寸・再生は生ファイル配信を使う。
function _attachmentUrlFromPath(path, preferThumb, thumbSize) {
  const clean = String(path || '').replace(/\\/g, '/');
  if (!clean) return '';
  if (!preferThumb) return '/api/file-raw?path=' + encodeURIComponent(clean);
  const size = Math.max(64, Math.min(1024, parseInt(thumbSize, 10) || 256));
  return '/api/thumbnail?path=' + encodeURIComponent(clean) + '&size=' + size;
}

function _imageSrc(item, preferThumb, thumbSize) {
  // 新方式は縮小と原寸で配信先が別なので、preferThumb を厳密に守る。
  // 動画・PDFは縮小版を作らないため、常に生ファイルを返す。
  if (item && item.path) {
    const wantThumb = !!preferThumb && (!item.kind || item.kind === 'image');
    return _attachmentUrlFromPath(item.path, wantThumb, thumbSize);
  }
  const rel = (preferThumb && (item.thumb_url || item.thumb || item.preview_url || item.preview_src || item.preview_image_url))
    || item.thumb_url || item.url || item.src || item.thumb || item.preview_url || item.preview_src || item.preview_image_url || '';
  if (!rel) return '';
  if (/^(https?:|data:|blob:)/.test(rel)) return rel;
  if (rel.startsWith('/')) return rel;
  return '/api/media/file?path=' + encodeURIComponent(rel);
}

// 添付の種別（image / video / pdf）。新方式は保存時に kind が付くが、
// 旧データや外部由来の値には無いので拡張子から補う。
function _attachmentKind(item) {
  const declared = String(item?.kind || '').toLowerCase();
  if (declared === 'image' || declared === 'video' || declared === 'pdf') return declared;
  const source = String(item?.path || item?.src || item?.filename || item?.url || '');
  const ext = (source.split('?')[0].split('.').pop() || '').toLowerCase();
  if (ATTACHMENT_VIDEO_EXTS.includes(ext)) return 'video';
  if (ATTACHMENT_DOCUMENT_EXTS.includes(ext)) return 'pdf';
  return 'image';
}

function _isAcceptedAttachmentFile(file, accept) {
  if (!file) return false;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const type = String(file.type || '').toLowerCase();
  const allowed = accept.includes(ext)
    || (ext === 'jpg' && accept.includes('jpeg'))
    || (ext === 'jpeg' && accept.includes('jpg'));
  if (!allowed) return false;
  if (!type) return true;
  if (ATTACHMENT_VIDEO_EXTS.includes(ext)) return type.startsWith('video/');
  if (ATTACHMENT_DOCUMENT_EXTS.includes(ext)) return type.includes('pdf');
  return type.startsWith('image/');
}

// 動画・PDFは縮小画像を作らないため、種別アイコンとファイル名のタイルで表す。
// クリック位置の判定は .gb-image-thumb を使うので、画像と同じクラスを付ける。
function _createAttachmentThumb(item, index) {
  const kind = _attachmentKind(item);
  const label = item?.caption || item?.filename || '';
  if (kind === 'image') {
    const img = document.createElement('img');
    img.className = 'gb-image-thumb';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.fetchPriority = 'low';
    // 読み込み判定前の img を見せると、低速時にブラウザ標準の破損アイコンと
    // alt 文言が一瞬表示される。成功時だけ実画像を表示し、失敗時は下の
    // フォールバックタイルへ置換する。
    img.style.color = 'transparent';
    img.alt = label;
    if (index != null) img.dataset.imageIndex = String(index);
    const replaceFailedImage = () => {
      // サムネイル生成だけが失敗した場合は、保存済みの原寸ファイルへ一度だけ
      // 切り替える。原寸も読めない時だけ中立タイルにする。
      if (img.dataset.rawFallback !== '1') {
        const rawSrc = _imageSrc(item, false);
        if (rawSrc && rawSrc !== img.getAttribute('src')) {
          img.dataset.rawFallback = '1';
          img.src = rawSrc;
          return;
        }
      }
      // file: URL は src 代入時に同期的に失敗し、呼出元が DOM へ追加する前に
      // error が届くことがある。親がまだ無い時だけ次の描画まで待つ。
      if (!img.parentNode) {
        requestAnimationFrame(() => {
          if (img.parentNode) replaceFailedImage();
        });
        return;
      }
      const fallback = document.createElement('div');
      fallback.className = 'gb-image-thumb gb-attachment-tile gb-image-thumb-fallback';
      fallback.dataset.kind = 'image';
      if (index != null) fallback.dataset.imageIndex = String(index);
      fallback.title = label;
      if (typeof lucide === 'function') fallback.innerHTML = lucide('image', 20) || '';
      const caption = document.createElement('span');
      caption.textContent = label || '画像';
      fallback.appendChild(caption);
      img.replaceWith(_setupAttachmentThumbDrag(fallback, item));
    };
    img.addEventListener('error', replaceFailedImage);
    img.addEventListener('load', () => {
      img.style.removeProperty('color');
    }, { once: true });
    // キャッシュ済みの失敗URLは src 代入直後に error が発火し得るため、
    // フォールバックの listener を登録してから読み込みを開始する。
    img.src = _imageSrc(item, true);
    window.MeldexImageLoading?.track?.(img, { label: '画像を読み込んでいます', errorMode: 'silent', allowDetached: true });
    return _setupAttachmentThumbDrag(img, item);
  }
  const tile = document.createElement('div');
  tile.className = 'gb-image-thumb gb-attachment-tile';
  tile.dataset.kind = kind;
  if (index != null) tile.dataset.imageIndex = String(index);
  tile.title = label;
  if (typeof lucide === 'function') tile.innerHTML = lucide(kind === 'video' ? 'film' : 'fileText', 20) || '';
  const caption = document.createElement('span');
  caption.textContent = label;
  tile.appendChild(caption);
  return _setupAttachmentThumbDrag(tile, item);
}

function _setupAttachmentThumbDrag(element, item) {
  const path = _imagePropOpenPath(item);
  if (!element || !path) return element;
  element.draggable = true;
  element.dataset.attachmentPath = path;
  element.addEventListener('dragstart', e => {
    // セル本体にも委譲 dragstart があるため、ここで止めないとサムネイル固有の
    // 添付path/typeがセル側payloadで上書きされる。
    e.stopPropagation();
    const type = _attachmentKind(item);
    const name = item?.caption || item?.filename || path.split(/[\\/]/).pop() || path;
    if (typeof MeldexDnD !== 'undefined' && MeldexDnD.writeNodePayload) {
      MeldexDnD.writeNodePayload(e.dataTransfer, { name, path, type }, 'sheet-image');
    }
  });
  return element;
}

// 添付アップロードは共通のAPI経路（apiFetch）を通らないため、編集ロックの識別子を自前で付ける。
function _attachmentUploadHeaders() {
  const locks = window.MeldexActiveLocks;
  if (!locks || !locks.header || typeof locks.token !== 'function') return undefined;
  try {
    const value = locks.token();
    return value ? { [locks.header]: value } : undefined;
  } catch {
    return undefined;
  }
}

function _imagePropDbPathForEntity(entityPath) {
  if (typeof _dbPathFromEntityPath === 'function') return _dbPathFromEntityPath(entityPath);
  return state.currentDbPath || '';
}

function _imagePropLockMessage(entityPath, propName) {
  const dataset = globalThis.document?.body?.dataset || {};
  if (dataset.cloudQuotaBlocked === '1') {
    return 'Dropbox容量が95%を超えているため編集を停止しています';
  }
  if (dataset.cloudReadonly === '1') {
    return '閲覧専用のため変更できません';
  }
  const dbPath = _imagePropDbPathForEntity(entityPath);
  return dbPath && typeof checkColumnEditable === 'function' ? checkColumnEditable(dbPath, propName) : null;
}

async function uploadImagePropertyFiles(files, entityPath, propName, val, ptc) {
  const options = _imagePropOptions(ptc);
  const current = parseImagePropertyValue(val?.value);
  const accepted = Array.from(files || []).filter(file => _isAcceptedAttachmentFile(file, options.accept));
  if (!accepted.length) { showStatus('添付できるファイルがありません', true); return current; }
  const room = Math.max(0, options.maxCount - current.length);
  if (room <= 0) { showStatus('画像数の上限に達しています', true); return current; }
  const targetFiles = accepted.slice(0, room);
  if (accepted.length > room) showStatus('画像数の上限を超えた分は追加しませんでした');
  let added = 0;
  let failed = 0;
  // 添付先シートを渡すと、そのシートフォルダ内の添付フォルダへ元のファイル名のまま保存される。
  // 渡せない場合はサーバー側が従来の保存先へ退避する（後方互換）。
  const sheetPath = _imagePropDbPathForEntity(entityPath) || '';
  for (const file of targetFiles) {
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('thumbnail_size', String(options.thumbSize));
      if (sheetPath) fd.append('sheet_path', sheetPath);
      // 添付はシートフォルダの中へ保存するため、開いているシート自身の編集ロックに当たる。
      // 自分のロックであることを示す識別子を付けないと、自分で開いたシートへ貼れなくなる。
      const res = await fetch(API_BASE + '/media/upload', {
        method: 'POST',
        body: fd,
        headers: _attachmentUploadHeaders(),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const meta = await res.json();
      current.push({
        id: (typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : ('img_' + Date.now() + '_' + Math.random().toString(16).slice(2))),
        content_hash: meta.content_hash || meta.hash,
        filename: meta.filename || file.name,
        path: meta.path || '',
        kind: meta.kind || '',
        src: meta.src,
        thumb: meta.thumb,
        url: meta.url,
        thumb_url: meta.thumb_url,
        width: meta.width || null,
        height: meta.height || null,
        size: meta.size || file.size,
        added_at: new Date().toISOString(),
        caption: '',
      });
      added += 1;
    } catch (err) {
      failed += 1;
      console.warn('[image-property] upload failed:', err);
    }
  }
  if (added > 0) await saveImagePropertyItems(entityPath, propName, val, current);
  if (failed > 0) {
    const message = added > 0
      ? `一部の画像を追加できませんでした（成功 ${added} 件 / 失敗 ${failed} 件）`
      : '画像追加に失敗しました';
    showStatus(message, true);
    if (added === 0) throw new Error(message);
  }
  return current;
}

async function saveImagePropertyItems(entityPath, propName, val, items) {
  const newValue = stringifyImagePropertyValue(items);
  const oldValue = typeof val?.value === 'string'
    ? val.value
    : stringifyImagePropertyValue(parseImagePropertyValue(val?.value));
  const dbPath = _imagePropDbPathForEntity(entityPath);
  const isExistingValue = !!(val && val.file && (val.candidate_index != null || _imagePropNormalizePath(val.file) !== _imagePropNormalizePath(entityPath)));
  if (isExistingValue) {
    await _apiPutValue(val, { new_value: newValue });
    if (oldValue !== newValue && typeof _dbUndoValue === 'function') {
      _dbUndoValue(`画像変更: ${propName}`, val, oldValue, newValue, undefined, undefined, { dbPath, entityPath });
    }
    val.value = newValue;
  } else {
    const status = val?.status || '採用';
    let currentRef = null;
    const applyCreatedResult = result => {
      if (!result) return null;
      currentRef = {
        file: result.path || result.file || entityPath,
        entry_path: entityPath,
        property: propName,
        candidate_index: result.candidate_index,
        value: newValue,
        status,
        note: '',
      };
      if (val) {
        Object.assign(val, currentRef);
        if (result.candidate_index == null) delete val.candidate_index;
      }
      return currentRef;
    };
    applyCreatedResult(await _apiPostValue(entityPath, propName, newValue, status, ''));
    if (currentRef && typeof historyPush === 'function') {
      const historyScope = typeof _dbScope === 'function' ? _dbScope(dbPath) : `db:${dbPath || ''}`;
      const deleteCurrent = async () => {
        if (currentRef.candidate_index != null) {
          await _apiPutValue(currentRef, { _delete: true });
        } else if (currentRef.file && _imagePropNormalizePath(currentRef.file) !== _imagePropNormalizePath(entityPath)) {
          await apiPost('/outliner/delete', { path: currentRef.file });
        }
        await apiPost('/media/rebuild-refs', {}).catch(() => {});
        if (dbPath && typeof selectDatabase === 'function') await selectDatabase(dbPath, undefined, { silent: true });
      };
      const recreate = async () => {
        applyCreatedResult(await _apiPostValue(entityPath, propName, newValue, status, ''));
        await apiPost('/media/rebuild-refs', {}).catch(() => {});
        if (dbPath && typeof selectDatabase === 'function') await selectDatabase(dbPath, undefined, { silent: true });
      };
      historyPush(`画像候補追加: ${propName}`, deleteCurrent, recreate, historyScope);
    }
    if (val && currentRef) {
      val.value = newValue;
      val.property = propName;
      val.status = status;
    }
  }
  apiPost('/media/rebuild-refs', {}).catch(() => {});
  if (typeof _refreshAfterCellEdit === 'function') _refreshAfterCellEdit(document.activeElement, entityPath, propName);
  else if (state.currentDbPath && typeof selectDatabase === 'function') selectDatabase(state.currentDbPath, undefined, { silent: true });
}

function _imagePropNormalizePath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function _imagePropCloneItems(items) {
  return JSON.parse(JSON.stringify(Array.isArray(items) ? items : []));
}

function _imagePropOpenPath(item) {
  // 新方式は path が実ファイルの場所そのものなので最優先で使う
  const candidates = [item?.path, item?.url, item?.src, item?.file, item?.thumb_url, item?.thumb];
  for (const raw of candidates) {
    const value = String(raw || '').trim();
    if (!value || /^(?:data:|blob:|https?:)/i.test(value)) continue;
    if (value.startsWith('/')) {
      try {
        const parsed = new URL(value, location.origin);
        const apiPath = parsed.searchParams.get('path') || '';
        if (apiPath) return apiPath.replace(/\\/g, '/');
      } catch {}
      continue;
    }
    return value.replace(/\\/g, '/');
  }
  return '';
}

function openImagePropertyItemInViewer(item, options = {}) {
  const sheetContext = window.MeldexViewerSheetContext?.create?.({
    item,
    entityPath: options.entityPath,
    propName: options.propName,
    ctx: options.ctx,
  });
  const sheetViewerUrl = sheetContext
    ? window.MeldexViewerSheetContext.viewerUrl(sheetContext)
    : '';
  const imagePath = _imagePropOpenPath(item);
  if (imagePath) {
    const label = item?.caption || item?.filename || imagePath.split('/').pop() || imagePath;
    const ext = (imagePath.split('.').pop() || '').toLowerCase();
    const mediaType = (typeof MeldexDnD !== 'undefined' && typeof MeldexDnD.getMediaType === 'function'
      ? MeldexDnD.getMediaType(ext)
      : null) || _attachmentKind(item);
    // シートの表示状態（スクロール位置・表示中のビュー）を戻る履歴へ積んでから画像を開く。
    // DB行ダブルクリック（_handleTbodyDblclick）と同一パターン（②タブ別ナビ履歴、2026-07-21）。
    // _navPushWithViewState の既定フォールバック（_currentPaneState()）は旧split専用の
    // gb-pane-context.js 由来で、現行のペイン/タブ体系には存在しないペインID 'main' を
    // 返すため、履歴が対象タブへ積まれない（legacy側の未使用履歴へ迷子になる）。
    // ここでは現在アクティブなペインIDを明示して渡す（dbPathはstate.currentDbPathへの
    // 内蔵フォールバックに委ねる）。
    if (typeof _navPushWithViewState === 'function') {
      const activePaneId = (typeof GBLayout !== 'undefined' && GBLayout.activePane) ? GBLayout.activePane : null;
      _navPushWithViewState(activePaneId ? { paneId: activePaneId } : null, null);
    }
    if (typeof openMedia === 'function') {
      openMedia(label, imagePath, mediaType, sheetViewerUrl ? { viewerUrl: sheetViewerUrl } : undefined);
      return true;
    }
    if (typeof openViewer === 'function') {
      openViewer('/viewer?file=' + encodeURIComponent(imagePath));
      return true;
    }
    return false;
  }
  // URL-only（https:/data:/blob: 等でワークスペース内パスへ解決できない）場合は、
  // 戻る操作で再生できないため従来どおり openViewer 直呼びのまま履歴対象外で開く。
  const imageUrl = _imageSrc(item, false);
  if (imageUrl && typeof openViewer === 'function') {
    if (sheetViewerUrl) {
      if (typeof navPush === 'function') {
        navPush({ type: 'html', label: item?.caption || item?.filename || '画像', path: sheetViewerUrl, urlExternal: true });
      }
      openViewer(sheetViewerUrl);
    } else {
      openViewer(imageUrl);
    }
    return true;
  }
  return false;
}

function createImagePropertyValueElement(val, entityPath, propName, thumbSize, ptc, options = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'gb-image-cell';
  if (options.cardPreview) wrap.classList.add('gb-image-cell-card-preview');
  const imageOptions = _imagePropOptions(ptc);
  wrap.style.setProperty('--gb-image-cell-size', imageOptions.cellSize + 'px');
  const items = parseImagePropertyValue(val?.value);
  const configuredCount = typeof _normalizeDbCardImageThumbCount === 'function'
    ? _normalizeDbCardImageThumbCount(options.imagePreviewCount)
    : Math.max(1, Math.min(12, Math.round(Number(options.imagePreviewCount || 3) || 3)));
  const previewCount = Math.min(configuredCount, items.length);
  if (!items.length) {
    wrap.classList.add('gb-image-cell-empty');
    wrap.innerHTML = (typeof lucide === 'function' ? lucide('imagePlus', 16) : '') + '<span>画像をドロップ</span>';
  } else {
    const stack = document.createElement('div');
    stack.className = 'gb-image-thumb-stack';
    for (let i = 0; i < previewCount; i++) {
      stack.appendChild(_createAttachmentThumb(items[i], i));
    }
    if (items.length > previewCount) {
      const more = document.createElement('span');
      more.className = 'gb-image-more';
      more.textContent = '+' + (items.length - previewCount);
      stack.appendChild(more);
    }
    wrap.appendChild(stack);
  }
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  wrap.addEventListener('dragenter', (e) => { stop(e); wrap.classList.add('gb-cell-dropzone-active'); });
  wrap.addEventListener('dragover', (e) => { stop(e); wrap.classList.add('gb-cell-dropzone-active'); });
  wrap.addEventListener('dragleave', (e) => { e.stopPropagation(); wrap.classList.remove('gb-cell-dropzone-active'); });
  wrap.addEventListener('drop', async (e) => {
    stop(e);
    wrap.classList.remove('gb-cell-dropzone-active');
    const dbPath = _imagePropDbPathForEntity(entityPath);
    const lockMsg = _imagePropLockMessage(entityPath, propName);
    if (lockMsg) { showStatus(lockMsg); return; }
    try {
      await uploadImagePropertyFiles(e.dataTransfer.files, entityPath, propName, val, ptc);
      showStatus('画像を追加しました');
      if (dbPath) selectDatabase(dbPath, undefined, { silent: true });
    } catch (err) {
      showStatus(err?.message || '画像追加に失敗しました', true);
    }
  });
  wrap.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!items.length) return;
    const thumb = e.target?.closest?.('.gb-image-thumb');
    const idx = thumb && wrap.contains(thumb) ? parseInt(thumb.dataset.imageIndex || '0', 10) : 0;
    const item = items[Number.isFinite(idx) ? idx : 0] || items[0];
    if (!openImagePropertyItemInViewer(item, { entityPath, propName, ctx: options.ctx })) {
      showStatus('画像を開けませんでした', true);
    }
  });
  return wrap;
}

function showImageGalleryModal(entityPath, propName, val, ptc, modalOptions = {}) {
  const options = _imagePropOptions(ptc);
  let items = parseImagePropertyValue(val?.value);
  const lockMsg = _imagePropLockMessage(entityPath, propName);
  const canEdit = !lockMsg;
  let busy = false;
  const returnFocus = typeof modalOptions.returnFocus === 'function'
    ? modalOptions.returnFocus
    : (modalOptions.returnFocus?.isConnected
      ? modalOptions.returnFocus
      : (document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null));
  const body = document.createElement('div');
  body.className = 'gb-image-gallery-body';
  body.innerHTML = `
    <div class="gb-image-gallery-toolbar">
      <label class="gb-btn gb-btn-sm" data-e2e-id="image-gallery-add">${typeof lucide === 'function' ? lucide('imagePlus', 13) : ''} 追加<input id="gb-img-file-input" type="file" multiple accept="${esc(options.accept.map(ext => '.' + ext).join(','))}" hidden></label>
      <span class="gb-section-desc">${items.length} / ${options.maxCount}</span>
    </div>
    <div id="gb-img-gallery-list" class="gb-image-gallery-list"></div>`;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'gb-btn gb-btn-sm';
  closeBtn.dataset.e2eId = 'image-gallery-close';
  closeBtn.textContent = '閉じる';
  const modalApi = window.GBUI.createModal({
    id: 'image-property-gallery-dialog',
    title: `${propName}の画像`,
    body,
    footer: [closeBtn],
    variant: 'standard',
    extraClass: 'gb-image-gallery-modal',
    geometryKey: 'image-property-gallery',
    initialFocus: '[data-e2e-id="image-gallery-add"]',
    returnFocus: returnFocus || undefined,
    onBeforeClose: () => {
      if (!busy) return true;
      if (typeof showStatus === 'function') showStatus('画像を保存しています。完了後に閉じてください', true);
      return false;
    },
  });
  const overlay = modalApi.overlay;
  overlay.classList.add('modal-overlay');
  overlay.dataset.imageGalleryDialog = '1';
  overlay._imageGalleryModalApi = modalApi;
  const headerClose = modalApi.header.querySelector('.gb-modal-close');
  if (headerClose) headerClose.dataset.e2eId = 'image-gallery-close-icon';
  closeBtn.addEventListener('click', () => modalApi.close('close-button'));
  modalApi.open();
  const list = overlay.querySelector('#gb-img-gallery-list');
  const fileInput = overlay.querySelector('#gb-img-file-input');
  const countEl = overlay.querySelector('.gb-section-desc');
  if (fileInput) fileInput.disabled = !canEdit;
  const setBusy = (nextBusy) => {
    busy = nextBusy === true;
    overlay.dataset.imageGalleryBusy = busy ? '1' : '0';
    overlay.querySelectorAll('.gb-image-gallery-card input, .gb-image-gallery-card button').forEach((control) => {
      control.disabled = busy || !canEdit && control.title !== '開き方を選ぶ';
    });
    if (fileInput) fileInput.disabled = busy || !canEdit;
    closeBtn.disabled = busy;
    if (headerClose) headerClose.disabled = busy;
  };
  const render = () => {
    if (countEl) countEl.textContent = `${items.length} / ${options.maxCount}`;
    list.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'gb-image-gallery-empty';
      empty.textContent = '画像をドロップ';
      list.appendChild(empty);
      setBusy(busy);
      return;
    }
    items.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = 'gb-image-gallery-card';
      const thumb = _createAttachmentThumb(item, idx);
      thumb.classList.remove('gb-image-thumb');
      card.appendChild(thumb);
      const meta = document.createElement('div');
      meta.className = 'gb-image-gallery-meta';
      const cap = document.createElement('input');
      cap.type = 'text';
      cap.value = item.caption || '';
      cap.placeholder = item.filename || 'キャプション';
      cap.disabled = !canEdit;
      cap.addEventListener('change', async () => {
        if (!canEdit) {
          cap.value = item.caption || '';
          if (lockMsg) showStatus(lockMsg, true);
          return;
        }
        const nextItems = _imagePropCloneItems(items);
        if (!nextItems[idx]) return;
        nextItems[idx].caption = cap.value;
        await saveNextItems(nextItems);
      });
      meta.appendChild(cap);
      const actions = document.createElement('div');
      actions.className = 'gb-image-gallery-actions';
      const actionBtn = (icon, title, fn, options = {}) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'gb-icon-btn';
        b.innerHTML = typeof lucide === 'function' ? lucide(icon, 14) : title;
        b.title = title;
        b.disabled = options.disabled === true || (!canEdit && options.requiresEdit !== false);
        b.addEventListener('click', fn);
        return b;
      };
      const imagePath = _imagePropOpenPath(item);
      actions.appendChild(actionBtn('externalLink', '開き方を選ぶ', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const imageLabel = item.caption || item.filename || imagePath.split('/').pop() || '画像';
        if (typeof showLinkedOpenTargetMenu === 'function') {
          showLinkedOpenTargetMenu(ev, imagePath, imageLabel, { linkType: 'image' });
        } else if (typeof openImagePropertyItemInViewer === 'function') {
          openImagePropertyItemInViewer(item);
        }
      }, { requiresEdit: false, disabled: !imagePath }));
      actions.appendChild(actionBtn('arrowUp', '上へ', async () => {
        if (idx <= 0) return;
        const nextItems = _imagePropCloneItems(items);
        [nextItems[idx - 1], nextItems[idx]] = [nextItems[idx], nextItems[idx - 1]];
        await saveNextItems(nextItems);
      }));
      actions.appendChild(actionBtn('arrowDown', '下へ', async () => {
        if (idx >= items.length - 1) return;
        const nextItems = _imagePropCloneItems(items);
        [nextItems[idx + 1], nextItems[idx]] = [nextItems[idx], nextItems[idx + 1]];
        await saveNextItems(nextItems);
      }));
      actions.appendChild(actionBtn('trash2', '削除', async () => {
        if (typeof confirm === 'function' && !confirm('この画像を削除しますか？')) return;
        const nextItems = _imagePropCloneItems(items);
        nextItems.splice(idx, 1);
        await saveNextItems(nextItems);
      }));
      meta.appendChild(actions);
      card.appendChild(meta);
      list.appendChild(card);
    });
    setBusy(busy);
  };
  const saveNextItems = async (nextItems) => {
    const prevItems = _imagePropCloneItems(items);
    setBusy(true);
    try {
      await saveImagePropertyItems(entityPath, propName, val, nextItems);
      items = _imagePropCloneItems(nextItems);
    } catch (err) {
      items = prevItems;
      showStatus(err?.message || '画像列の保存に失敗しました', true);
    } finally {
      setBusy(false);
    }
    render();
  };
  const addFiles = async (files) => {
    if (!canEdit) {
      if (lockMsg) showStatus(lockMsg, true);
      return;
    }
    setBusy(true);
    try {
      items = await uploadImagePropertyFiles(files, entityPath, propName, val, ptc);
    } catch (err) {
      showStatus(err?.message || '画像追加に失敗しました', true);
    } finally {
      setBusy(false);
    }
    render();
  };
  fileInput?.addEventListener('change', async (e) => {
    await addFiles(e.target.files);
    e.target.value = '';
  });
  list.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); list.classList.add('gb-cell-dropzone-active'); });
  list.addEventListener('dragleave', (e) => { e.stopPropagation(); list.classList.remove('gb-cell-dropzone-active'); });
  list.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); list.classList.remove('gb-cell-dropzone-active'); addFiles(e.dataTransfer.files); });
  render();
}
