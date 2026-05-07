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
    : ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
  return {
    maxCount: opts.max_count == null || opts.max_count === '' ? 100 : Math.max(1, parseInt(opts.max_count, 10) || 100),
    accept,
    thumbSize: Math.max(40, Math.min(320, parseInt(opts.thumbnail_size, 10) || 96)),
  };
}

function _imageSrc(item, preferThumb) {
  const rel = (preferThumb && (item.thumb_url || item.thumb)) || item.thumb_url || item.url || item.src || item.thumb || '';
  if (!rel) return '';
  if (/^(https?:|data:|blob:)/.test(rel)) return rel;
  if (rel.startsWith('/')) return rel;
  return '/api/media/file?path=' + rel;
}

function _isAcceptedImageFile(file, accept) {
  if (!file || !file.type?.startsWith('image/')) return false;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return accept.includes(ext) || (ext === 'jpg' && accept.includes('jpeg')) || (ext === 'jpeg' && accept.includes('jpg'));
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
  for (const file of targetFiles) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('thumbnail_size', String(options.thumbSize));
    const res = await fetch(API_BASE + '/media/upload', { method: 'POST', body: fd });
    if (!res.ok) throw new Error('画像アップロード失敗: HTTP ' + res.status);
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
  }
  await saveImagePropertyItems(entityPath, propName, val, current);
  return current;
}

async function saveImagePropertyItems(entityPath, propName, val, items) {
  const newValue = stringifyImagePropertyValue(items);
  if (val && val.file && val.candidate_index != null) {
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

function createImagePropertyValueElement(val, entityPath, propName, thumbSize, ptc) {
  const wrap = document.createElement('div');
  wrap.className = 'gb-image-cell';
  const options = _imagePropOptions(ptc);
  const items = parseImagePropertyValue(val?.value);
  const previewCount = Math.min(3, items.length);
  if (!items.length) {
    wrap.classList.add('gb-image-cell-empty');
    wrap.innerHTML = (typeof lucide === 'function' ? lucide('imagePlus', 16) : '') + '<span>画像をドロップ</span>';
  } else {
    const stack = document.createElement('div');
    stack.className = 'gb-image-thumb-stack';
    for (let i = 0; i < previewCount; i++) {
      const img = document.createElement('img');
      img.className = 'gb-image-thumb';
      img.src = _imageSrc(items[i], true);
      img.alt = items[i].caption || items[i].filename || '';
      img.style.width = options.thumbSize + 'px';
      img.style.height = options.thumbSize + 'px';
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
    const lockMsg = checkColumnEditable(state.currentDbPath, propName);
    if (lockMsg) { showStatus(lockMsg); return; }
    try {
      await uploadImagePropertyFiles(e.dataTransfer.files, entityPath, propName, val, ptc);
      showStatus('画像を追加しました');
      if (state.currentDbPath) selectDatabase(state.currentDbPath, undefined, { silent: true });
    } catch (err) {
      showStatus(err?.message || '画像追加に失敗しました', true);
    }
  });
  wrap.addEventListener('click', (e) => {
    e.stopPropagation();
    showImageGalleryModal(entityPath, propName, val, ptc);
  });
  return wrap;
}

function showImageGalleryModal(entityPath, propName, val, ptc) {
  const options = _imagePropOptions(ptc);
  let items = parseImagePropertyValue(val?.value);
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
  const render = () => {
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
      img.src = _imageSrc(item, true);
      img.alt = item.filename || '';
      card.appendChild(img);
      const meta = document.createElement('div');
      meta.className = 'gb-image-gallery-meta';
      const cap = document.createElement('input');
      cap.type = 'text';
      cap.value = item.caption || '';
      cap.placeholder = item.filename || 'キャプション';
      cap.addEventListener('change', async () => {
        items[idx].caption = cap.value;
        await saveImagePropertyItems(entityPath, propName, val, items);
      });
      meta.appendChild(cap);
      const actions = document.createElement('div');
      actions.className = 'gb-image-gallery-actions';
      const actionBtn = (icon, title, fn) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'gb-icon-btn';
        b.innerHTML = typeof lucide === 'function' ? lucide(icon, 14) : title;
        b.title = title;
        b.addEventListener('click', fn);
        return b;
      };
      actions.appendChild(actionBtn('arrowUp', '上へ', async () => {
        if (idx <= 0) return;
        [items[idx - 1], items[idx]] = [items[idx], items[idx - 1]];
        await saveImagePropertyItems(entityPath, propName, val, items);
        render();
      }));
      actions.appendChild(actionBtn('arrowDown', '下へ', async () => {
        if (idx >= items.length - 1) return;
        [items[idx + 1], items[idx]] = [items[idx], items[idx + 1]];
        await saveImagePropertyItems(entityPath, propName, val, items);
        render();
      }));
      actions.appendChild(actionBtn('trash2', '削除', async () => {
        items.splice(idx, 1);
        await saveImagePropertyItems(entityPath, propName, val, items);
        render();
      }));
      meta.appendChild(actions);
      card.appendChild(meta);
      list.appendChild(card);
    });
  };
  const addFiles = async (files) => {
    try {
      items = await uploadImagePropertyFiles(files, entityPath, propName, val, ptc);
      render();
    } catch (err) {
      showStatus(err?.message || '画像追加に失敗しました', true);
    }
  };
  overlay.querySelector('#gb-img-file-input')?.addEventListener('change', (e) => addFiles(e.target.files));
  list.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); list.classList.add('gb-cell-dropzone-active'); });
  list.addEventListener('dragleave', (e) => { e.stopPropagation(); list.classList.remove('gb-cell-dropzone-active'); });
  list.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); list.classList.remove('gb-cell-dropzone-active'); addFiles(e.dataTransfer.files); });
  render();
}
