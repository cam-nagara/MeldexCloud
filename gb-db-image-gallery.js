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

function _imagePropOptions(ptc) {
  const opts = ptc?.options || {};
  const accept = Array.isArray(opts.accept) && opts.accept.length
    ? opts.accept.map(s => String(s).toLowerCase().replace(/^\./, ''))
    : ['png', 'jpg', 'jpeg', 'gif', 'webp'];
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

function _imageSrc(item, preferThumb) {
  const rel = (preferThumb && (item.thumb_url || item.thumb || item.preview_url || item.preview_src || item.preview_image_url))
    || item.thumb_url || item.url || item.src || item.thumb || item.preview_url || item.preview_src || item.preview_image_url || '';
  if (!rel) return '';
  if (/^(https?:|data:|blob:)/.test(rel)) return rel;
  if (rel.startsWith('/')) return rel;
  return '/api/media/file?path=' + encodeURIComponent(rel);
}

function _isAcceptedImageFile(file, accept) {
  if (!file) return false;
  const type = String(file.type || '').toLowerCase();
  if (type && !type.startsWith('image/')) return false;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return accept.includes(ext) || (ext === 'jpg' && accept.includes('jpeg')) || (ext === 'jpeg' && accept.includes('jpg'));
}

function _imagePropDbPathForEntity(entityPath) {
  if (typeof _dbPathFromEntityPath === 'function') return _dbPathFromEntityPath(entityPath);
  return state.currentDbPath || '';
}

function _imagePropLockMessage(entityPath, propName) {
  const dbPath = _imagePropDbPathForEntity(entityPath);
  return dbPath && typeof checkColumnEditable === 'function' ? checkColumnEditable(dbPath, propName) : null;
}

async function uploadImagePropertyFiles(files, entityPath, propName, val, ptc) {
  const options = _imagePropOptions(ptc);
  const current = parseImagePropertyValue(val?.value);
  const accepted = Array.from(files || []).filter(file => _isAcceptedImageFile(file, options.accept));
  if (!accepted.length) { showStatus('画像ファイルがありません', true); return current; }
  const room = Math.max(0, options.maxCount - current.length);
  if (room <= 0) { showStatus('画像数の上限に達しています', true); return current; }
  const targetFiles = accepted.slice(0, room);
  if (accepted.length > room) showStatus('画像数の上限を超えた分は追加しませんでした');
  let added = 0;
  let failed = 0;
  for (const file of targetFiles) {
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('thumbnail_size', String(options.thumbSize));
      const res = await fetch(API_BASE + '/media/upload', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const meta = await res.json();
      current.push({
        id: (typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : ('img_' + Date.now() + '_' + Math.random().toString(16).slice(2))),
        content_hash: meta.content_hash || meta.hash,
        filename: meta.filename || file.name,
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
  const isExistingValue = !!(val && val.file && (val.candidate_index != null || _imagePropNormalizePath(val.file) !== _imagePropNormalizePath(entityPath)));
  if (isExistingValue) {
    await _apiPutValue(val, { new_value: newValue });
    val.value = newValue;
  } else {
    const result = await _apiPostValue(entityPath, propName, newValue, '採用', '');
    if (val && result) {
      val.value = newValue;
      val.file = result.path || result.file || entityPath;
      val.property = propName;
      if (result.candidate_index != null) val.candidate_index = result.candidate_index;
      val.status = val.status || '採用';
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
  const candidates = [item?.url, item?.src, item?.path, item?.file, item?.thumb_url, item?.thumb];
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

function openImagePropertyItemInViewer(item) {
  const imagePath = _imagePropOpenPath(item);
  if (imagePath && typeof openViewer === 'function') {
    openViewer('/viewer?file=' + encodeURIComponent(imagePath));
    return true;
  }
  const imageUrl = _imageSrc(item, false);
  if (imageUrl && typeof openViewer === 'function') {
    openViewer(imageUrl);
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
      const img = document.createElement('img');
      img.className = 'gb-image-thumb';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.fetchPriority = 'low';
      img.src = _imageSrc(items[i], true);
      img.alt = items[i].caption || items[i].filename || '';
      img.dataset.imageIndex = String(i);
      stack.appendChild(img);
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
    if (!openImagePropertyItemInViewer(item)) {
      showStatus('画像を開けませんでした', true);
    }
  });
  return wrap;
}

function showImageGalleryModal(entityPath, propName, val, ptc) {
  const options = _imagePropOptions(ptc);
  let items = parseImagePropertyValue(val?.value);
  const lockMsg = _imagePropLockMessage(entityPath, propName);
  const canEdit = !lockMsg;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal gb-image-gallery-modal">
    <h3>${typeof lucide === 'function' ? lucide('images', 16) : ''} ${esc(propName)}</h3>
    <div class="gb-image-gallery-toolbar">
      <label class="gb-btn gb-btn-sm">${typeof lucide === 'function' ? lucide('imagePlus', 13) : ''} 追加<input id="gb-img-file-input" type="file" multiple accept="image/*" hidden></label>
      <span class="gb-section-desc">${items.length} / ${options.maxCount}</span>
    </div>
    <div id="gb-img-gallery-list" class="gb-image-gallery-list"></div>
    <div class="btn-row"><button data-action="this.closest('.modal-overlay').remove()">閉じる</button></div>
  </div>`;
  document.body.appendChild(overlay);
  const list = overlay.querySelector('#gb-img-gallery-list');
  const fileInput = overlay.querySelector('#gb-img-file-input');
  const countEl = overlay.querySelector('.gb-section-desc');
  if (fileInput) fileInput.disabled = !canEdit;
  const render = () => {
    if (countEl) countEl.textContent = `${items.length} / ${options.maxCount}`;
    list.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'gb-image-gallery-empty';
      empty.textContent = '画像をドロップ';
      list.appendChild(empty);
      return;
    }
    items.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = 'gb-image-gallery-card';
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = _imageSrc(item, true);
      img.alt = item.filename || '';
      card.appendChild(img);
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
        } else if (typeof openViewer === 'function') {
          openViewer('/viewer?file=' + encodeURIComponent(imagePath));
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
  };
  const saveNextItems = async (nextItems) => {
    const prevItems = _imagePropCloneItems(items);
    try {
      await saveImagePropertyItems(entityPath, propName, val, nextItems);
      items = _imagePropCloneItems(nextItems);
    } catch (err) {
      items = prevItems;
      showStatus(err?.message || '画像プロパティの保存に失敗しました', true);
    }
    render();
  };
  const addFiles = async (files) => {
    if (!canEdit) {
      if (lockMsg) showStatus(lockMsg, true);
      return;
    }
    try {
      items = await uploadImagePropertyFiles(files, entityPath, propName, val, ptc);
      render();
    } catch (err) {
      showStatus(err?.message || '画像追加に失敗しました', true);
    }
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
