    // 挿入位置の線は共通実装（gb-dnd.js）へ委譲する。旧実装はここに同じ計算を
    // 複製しており、縦書き対応のような修正が片方だけに入る温床になっていた。
    if (typeof MeldexDnD !== 'undefined' && MeldexDnD.showDropCaret) {
      MeldexDnD.showDropCaret(el, e);
    }
  });
  el.addEventListener('dragleave', (e) => {
    const types = e.dataTransfer.types;
    if (types.includes('application/meldex-tool') ||
        types.includes('application/x-gb-tab') ||
        types.includes('application/x-gb-pane')) return;
    if (types.includes('application/x-meldex-node') && e.ctrlKey) return;
    e.stopPropagation();
    if (!el.contains(e.relatedTarget)) {
      const caret = el.querySelector('.drop-caret');
      if (caret) caret.remove();
    }
  });
  el.addEventListener('drop', async (e) => {
    const types = e.dataTransfer.types;
    // パネル操作系のD&Dはスキップ
    if (types.includes('application/meldex-tool') ||
        types.includes('application/x-gb-tab') ||
        types.includes('application/x-gb-pane')) return;
    if (types.includes('application/x-meldex-node') && e.ctrlKey) return;

    e.preventDefault();
    e.stopPropagation();
    const caret = el.querySelector('.drop-caret');
    if (caret) caret.remove();

    // ドロップ位置にキャレットを移動
    const range = _editableRangeFromPoint(el, e.clientX, e.clientY);
    if (range) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); }
    let insertRange = range ? range.cloneRange() : _captureEditableSelection(el);

    // メモ（アノテーション）のドロップ
    const annData = e.dataTransfer.getData('application/x-annotation');
    if (annData) {
      const ann = JSON.parse(annData);
      const linkText = '[注釈: ' + (ann.text || '').substring(0, 30) + '](annotation:' + ann.id + ')';
      document.execCommand('insertText', false, linkText + ' ');
      return;
    }

    // カレンダーイベントのドロップ
    const calEventId = e.dataTransfer.getData('application/x-cal-event');
    if (calEventId) {
      const linkText = e.dataTransfer.getData('text/plain') || '[イベント]';
      document.execCommand('insertText', false, linkText + ' ');
      return;
    }

    // フォルダツリーからのドロップ
    const nodeResolved = typeof MeldexDnD !== 'undefined'
      ? await MeldexDnD.resolveDropData(e, 'node') : null;
    const cfData = nodeResolved
      ? JSON.stringify(nodeResolved.payload)
      : e.dataTransfer.getData('application/x-meldex-node');
    if (cfData) {
      try {
        const { name, path, type } = JSON.parse(cfData);
        if (typeof MeldexDnD !== 'undefined' && MeldexDnD.insertNodeAtEditableRange
            && MeldexDnD.insertNodeAtEditableRange(el, { name, path, type }, insertRange)) {
          draggedNode = null;
          MeldexDnD.completeDrop(nodeResolved);
          return;
        }
        if (type === 'image' || type === 'video' || type === 'audio') {
          // 画像/動画/音声: メディア埋め込みを挿入
          const ext = (path || '').split('.').pop().toLowerCase();
          const isImage = ['png','jpg','jpeg','gif','bmp','webp','svg','ico','avif'].includes(ext) || type === 'image';
          if (isImage) {
            const imgUrl = '/api/file-raw?path=' + encodeURIComponent(path);
            document.execCommand('insertHTML', false,
              `<div class="embed-media" contenteditable="false" data-meldex-image-host data-path="${esc(path)}" data-name="${esc(name)}"><img src="${imgUrl}" alt="${esc(name)}" data-meldex-content-image></div>`);
            window.MeldexImageLoading?.trackAll?.(el);
          } else if (type === 'video' || ['mp4','m4v','mov','webm','ogv','avi','mkv','wmv','mpg','mpeg'].includes(ext)) {
            const videoUrl = '/api/file-raw?path=' + encodeURIComponent(path);
            document.execCommand('insertHTML', false,
              `<div class="embed-media" contenteditable="false" data-path="${esc(path)}" data-name="${esc(name)}"><video controls preload="metadata" src="${videoUrl}"></video></div>`);
          } else if (type === 'audio') {
            const audioUrl = '/api/file-raw?path=' + encodeURIComponent(path);
            document.execCommand('insertHTML', false,
              `<div class="embed-media" contenteditable="false" data-path="${esc(path)}" data-name="${esc(name)}"><audio controls preload="metadata" src="${audioUrl}"></audio></div>`);
          } else {
            // 未知の媒体はパスリンクとして挿入
            document.execCommand('insertHTML', false,
              `<span class="auto-link" data-path="${esc(path)}" style="color:var(--accent);text-decoration:underline;cursor:pointer;">${lucide('paperclip',12)} ${esc(name)}</span> `);
          }
        } else {
          // その他: リンク+Lucideアイコンとして挿入
          const icon = type === 'database' ? 'database' : type === 'entity' ? 'fileSpreadsheet' : type === 'scenario' ? 'fileText' : type === 'board' ? 'layout' : 'file';
          document.execCommand('insertHTML', false,
            `<span class="auto-link" data-path="${esc(path)}" style="color:var(--accent);text-decoration:underline;cursor:pointer;">${lucide(icon,12)} ${esc(name)}</span> `);
        }
        if (nodeResolved) MeldexDnD.completeDrop(nodeResolved);
      } catch(err) {
        if (nodeResolved) MeldexDnD.failDrop(nodeResolved);
        if (typeof showStatus === 'function') showStatus('ドロップ処理に失敗しました', true);
      }
      draggedNode = null;
      return;
    }

    // OS からのファイルドロップ
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const currentPath = el.dataset.path || el.dataset.entityPath;
      if (!currentPath) return;
      const dir = currentPath.substring(0, currentPath.lastIndexOf('/'));
      for (const f of files) {
        try {
          insertRange = await _insertDroppedFileAtRange(el, insertRange, f, dir);
        } catch(err) { showStatus('ファイル挿入に失敗: ' + err.message, true); }
      }
      return;
    }

    // 外部テキストのドロップ（他アプリからのテキスト選択ドラッグ）
    const plainText = e.dataTransfer.getData('text/plain');
    if (plainText) {
      document.execCommand('insertText', false, plainText);
    }
  });
}
window.MeldexSetupEditableDropHandler = setupEditableDropHandler;
// page-content と entity-freetext にドロップハンドラを設定
setupEditableDropHandler(document.getElementById('page-content'));
setupEditableDropHandler(document.getElementById('entity-freetext'));

// ノート選択テキストの外部ドラッグ対応（ボード/別ノートへの転送）
function setupEditableDragSource(el) {
  if (!el) return;
  el.addEventListener('dragstart', (e) => {
    const sel = window.getSelection();
    const text = sel ? sel.toString() : '';
    if (!text) return;
    e.dataTransfer.setData('text/plain', text);
    const payload = { text, sourcePath: el.dataset.path || '' };
    e.dataTransfer.setData('application/x-meldex-text', JSON.stringify(payload));
    if (typeof MeldexDnD !== 'undefined') MeldexDnD.beginCrossWindowDrag(e.dataTransfer, payload, 'text');
    e.dataTransfer.effectAllowed = 'copyMove';
  });
}
setupEditableDragSource(document.getElementById('page-content'));
initNoteTocResize();
syncNoteTocLayout();

// ノート目次の表示/非表示
function toggleNoteToc() {
  const toc = document.getElementById('note-toc');
  const btn = document.getElementById('btn-toc-toggle');
  if (toc.style.display === 'none') {
    toc.style.display = '';
    btn.classList.add('active');
    localStorage.setItem('note-toc-visible', '1');
    updateNoteToc();
  } else {
    toc.style.display = 'none';
    btn.classList.remove('active');
    localStorage.setItem('note-toc-visible', '');
  }
  syncNoteTocLayout();
}

// フロントマターからtoc設定を取得（true/false/undefined）
function _getFrontmatterToc() {
  const pc = document.getElementById('page-content');
  const fm = pc?.dataset.frontmatter || '';
  const m = fm.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return undefined;
  const tocLine = m[1].split('\n').find(l => /^toc\s*:/.test(l));
  if (!tocLine) return undefined;
  return tocLine.split(':')[1].trim() === 'true';
}

// 目次を見出しから生成
