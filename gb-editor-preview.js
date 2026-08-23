/* ==============================
   gb-editor-preview.js: ノート linked preview helper

   gb-editor.js から linked preview とメディアクリック補助を分離。
   ノート本体の編集ロジックと preview 連携を切り離す。
   ============================== */

function _fileIcon(ext) {
  if (['jpg','jpeg','png','gif','webp','svg','bmp','avif','ico'].includes(ext)) return 'image';
  if (['mp4','mov','avi','webm'].includes(ext)) return 'clapperboard';
  if (['mp3','wav','ogg','flac'].includes(ext)) return 'audio';
  if (ext === 'md') return 'fileText';
  if (ext === 'json') return 'db';
  if (ext === 'board') return 'board';
  if (ext === 'pdf') return 'fileText';
  return 'file';
}

function _formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

let _linkedPreviewSeq = 0;

function _updateLinkedPreview(filePath, preloadedData) {
  const seq = ++_linkedPreviewSeq;
  const pane = document.getElementById('gb-preview-pane');
  if (!pane || !pane.closest('.gb-pane-content')) return;
  const ext = filePath.split('.').pop().toLowerCase();
  const fileName = filePath.split(/[/\\]/).pop();
  const imgExts = ['jpg','jpeg','png','gif','webp','svg','bmp','ico','avif'];
  if (imgExts.includes(ext)) {
    const url = (typeof API_BASE !== 'undefined' ? API_BASE : '') + '/file-raw?path=' + encodeURIComponent(filePath);
    pane.innerHTML = `<span class="meldex-content-image-host" data-meldex-image-host><img data-meldex-content-image src="${url}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;" alt="preview"></span>
      <div style="margin-top:8px;font-size:12px;color:var(--fg2);word-break:break-all;">${esc(fileName)}</div>`;
    window.MeldexImageLoading?.trackAll?.(pane);
  } else {
    const dataPromise = preloadedData ? Promise.resolve(preloadedData) : fetch(API_BASE + '/file?path=' + encodeURIComponent(filePath)).then(r => r.ok ? r.json() : Promise.reject());
    dataPromise.then(data => {
      if (seq !== _linkedPreviewSeq) return;
      const text = data.content || '';
      if (ext === 'json' && text.startsWith('{')) {
        try {
          const json = JSON.parse(text);
          if (json.rows && json.title !== undefined) {
            const totalRows = Array.isArray(json.rows) ? json.rows.length : 0;
            const rows = (json.rows || []).slice(0, 20);
            let html = `<div style="font-size:13px;font-weight:bold;margin-bottom:8px;color:var(--fg);display:flex;align-items:center;gap:4px;">${lucide('fileText',14)} ${esc(json.title || fileName)}</div>`;
            html += `<div style="font-size:11px;color:var(--fg2);margin-bottom:6px;">${totalRows}行のシナリオ</div>`;
            html += '<div style="font-size:12px;max-height:80%;overflow:auto;">';
            rows.forEach(r => {
              html += `<div style="padding:2px 0;border-bottom:1px solid var(--border);display:flex;gap:4px;">`;
              const roleName = r.character || r.role || '';
              if (roleName) html += `<span style="color:var(--accent);font-weight:bold;min-width:60px;">${esc(roleName)}</span>`;
              html += `<span style="color:var(--fg);">${esc((r.text || '').split('\n')[0].slice(0, 60))}</span></div>`;
            });
            html += '</div>';
            pane.innerHTML = html;
            return;
          }
        } catch {}
      }
      const preview = text.substring(0, 500);
      pane.innerHTML = `<div style="font-size:13px;font-weight:bold;margin-bottom:8px;color:var(--fg);display:flex;align-items:center;gap:4px;">${lucide(_fileIcon(ext),14)} ${esc(fileName)}</div>
        <pre style="font-size:12px;color:var(--fg2);white-space:pre-wrap;word-break:break-all;max-height:80%;overflow:auto;">${esc(preview)}</pre>`;
    }).catch(() => {
      if (seq !== _linkedPreviewSeq) return;
      pane.innerHTML = `<div style="color:var(--fg2);font-size:13px;">${esc(fileName)}</div>`;
    });
  }
}

document.addEventListener('click', (e) => {
  const media = e.target.closest('.embed-media');
  if (!media) return;
  const path = media.dataset.path;
  if (path) {
    _updateLinkedPreview(path);
    const name = media.dataset.name || path.split('/').pop();
    if (typeof showDetailPanel === 'function') {
      showDetailPanel(`<div style="padding:8px;font-size:12px;color:var(--fg2);">
        <div style="font-weight:bold;font-size:13px;color:var(--fg);margin-bottom:8px;">${esc(name)}</div>
        <div>パス: ${esc(path)}</div>
      </div>`);
    }
  }
});
