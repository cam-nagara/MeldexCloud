/* gb-dnd.js — D&Dユーティリティモジュール
 * D&Dの共通処理を集約: ペイロード解析、リンクHTML生成、ファイル種別判定
 */
const MeldexDnD = (() => {
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
    if (type === 'database') return 'pivot';
    if (type === 'board') return 'board';
    if (type === 'scriptnote') return 'scriptnote';
    return type || 'page';
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
      return `<div class="embed-media" contenteditable="false" data-path="${esc(path)}" data-name="${esc(name)}"><img src="${imgUrl}" alt="${esc(name)}"></div>`;
    }

    const icon = isMedia ? 'paperclip' : getIconForType(type);
    return `<span class="auto-link" data-path="${esc(path)}" style="color:var(--accent);text-decoration:underline;cursor:pointer;">${lucide(icon,12)} ${esc(name)}</span> `;
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
      if (rects.length > 0) {
        caret.style.top = (rects[0].bottom - elRect.top + editableEl.scrollTop) + 'px';
      } else {
        caret.style.top = (e.clientY - elRect.top + editableEl.scrollTop) + 'px';
      }
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
    parseMeldexNode,
    getMediaType,
    resolveOpenType,
    getIconForType,
    createAutoLinkHtml,
    showDropCaret,
    hideDropCaret,
    setCaretFromPoint
  };
})();
