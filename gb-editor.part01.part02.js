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
    if (el.dataset.standaloneFileInput === '1' && e.dataTransfer.files?.length) return;
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

    // 埋め込み画像・動画はURL文字列へ変換せず、サイズ・保存パスを保った実体を移動する。
    if (types.includes(NOTE_EMBEDDED_MEDIA_MIME) && _draggedEmbeddedMedia) {
      _moveEmbeddedMediaAtDrop(el, _draggedEmbeddedMedia, e, insertRange);
      return;
    }

    // メモ（アノテーション）のドロップ
    const annData = e.dataTransfer.getData('application/x-annotation');
    if (annData) {
      const linkText = _noteAnnotationDropLinkText(annData);
      if (linkText) document.execCommand('insertText', false, linkText + ' ');
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
        const parsedNode = JSON.parse(cfData);
        const nodeItems = Array.isArray(parsedNode?.items) && parsedNode.items.length
          ? parsedNode.items : [parsedNode];
        if (nodeItems.length !== 1) {
          if (nodeResolved) MeldexDnD.failDrop(nodeResolved);
          if (typeof showStatus === 'function') {
            showStatus('複数選択はノートへ一括挿入できないため、全件を変更しませんでした', true);
          }
          draggedNode = null;
          return;
        }
        let nodeItem = nodeItems[0];
        if (typeof MeldexDnD !== 'undefined' && MeldexDnD.preserveMediaItem) {
          nodeItem = await MeldexDnD.preserveMediaItem(nodeItem);
        }
        const { name, path, type } = nodeItem;
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
          const icon = window.MeldexFileIcons?.itemIconName?.(type, path)
            || (type === 'database' ? 'database' : type === 'entity' ? 'fileSpreadsheet' : type === 'scenario' ? 'fileText' : type === 'board' ? 'layout' : 'file');
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
      const generation = el._openPageLoadSeq;
      const dropFiles = Array.from(files);
      showStatus(dropFiles.length > 1 ? `${dropFiles.length}件のファイルを取り込み中…` : 'ファイルを取り込み中…');
      let uploaded = [];
      try {
        uploaded = await MeldexDnD.uploadFiles(dropFiles, dir, { source: 'note-drop', silentError: true });
      } catch (err) {
        showStatus('ファイル挿入に失敗: ' + err.message, true);
        return;
      }
      let failed = 0;
      for (let index = 0; index < dropFiles.length; index += 1) {
        if ((el.dataset.path || el.dataset.entityPath) !== currentPath
            || el._openPageLoadSeq !== generation || !el.isContentEditable) break;
        const result = uploaded[index];
        if (!result?.ok) { failed += 1; continue; }
        insertRange = _insertUploadedFileAtRange(el, insertRange, dropFiles[index], result);
      }
      const failureReason = failed ? _noteUserFacingReason(uploaded.find(result => !result?.ok)?.error, 'ファイルを保存できませんでした') : '';
      showStatus(failed ? `${dropFiles.length - failed}件を挿入し、${failed}件は失敗しました: ${failureReason}` : `${dropFiles.length}件のファイルを挿入しました`, failed > 0);
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
setupEditableDropHandler((window.GBEditorHost?.element('page-content') || document.getElementById('page-content')));
setupEditableDropHandler(document.getElementById('entity-freetext'));

// ノート選択テキストの外部ドラッグ対応（ボード/別ノートへの転送）
// アノテートのドロップ内容から挿入するリンク文字列を作る。内容が壊れていて
// 読み取れない場合は理由を表示して null を返す（旧実装は解析の失敗が無言で消えていた）。
function _noteAnnotationDropLinkText(annData) {
  let ann = null;
  try {
    ann = JSON.parse(annData);
  } catch (error) {
    console.warn('[note] ドロップされたアノテートを読み取れませんでした', error);
  }
  if (!ann || typeof ann !== 'object' || ann.id === undefined || ann.id === null || ann.id === '') {
    if (typeof showStatus === 'function') {
      showStatus('アノテートを挿入できませんでした: ドロップされた内容を読み取れません', true);
    }
    return null;
  }
  return '[アノテート: ' + String(ann.text || '').substring(0, 30) + '](annotation:' + ann.id + ')';
}

function setupEditableDragSource(el) {
  if (!el) return;
  el.addEventListener('dragstart', (e) => {
    const media = e.target?.closest?.('.embed-media');
    if (media && el.contains(media) && e.dataTransfer) {
      _prepareEmbeddedMediaForControls(media);
      _draggedEmbeddedMedia = media;
      media.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData(NOTE_EMBEDDED_MEDIA_MIME, media.dataset.path || media.dataset.name || 'media');
      // 一部WebViewは独自MIMEだけのドラッグを開始しないため、安全な文字列も付ける。
      e.dataTransfer.setData('text/plain', media.dataset.name || media.dataset.path || '埋め込みメディア');
      if (typeof setLowOpacityDragImage === 'function') setLowOpacityDragImage(e, media, 0.72);
      return;
    }
    const sel = window.getSelection();
    const text = sel ? sel.toString() : '';
    if (!text) return;
    e.dataTransfer.setData('text/plain', text);
    const payload = { text, sourcePath: el.dataset.path || '' };
    e.dataTransfer.setData('application/x-meldex-text', JSON.stringify(payload));
    if (typeof MeldexDnD !== 'undefined') MeldexDnD.beginCrossWindowDrag(e.dataTransfer, payload, 'text');
    e.dataTransfer.effectAllowed = 'copyMove';
  });
  el.addEventListener('dragend', () => {
    _draggedEmbeddedMedia?.classList?.remove('is-dragging');
    _draggedEmbeddedMedia = null;
  });
}
setupEditableDragSource((window.GBEditorHost?.element('page-content') || document.getElementById('page-content')));
initNoteTocResize();
syncNoteTocLayout();

// ノート目次の表示/非表示
function toggleNoteToc() {
  const toc = (window.GBEditorHost?.element('note-toc') || document.getElementById('note-toc'));
  const btn = (window.GBEditorHost?.element('btn-toc-toggle') || document.getElementById('btn-toc-toggle'));
  if (toc.style.display === 'none') {
    toc.style.display = '';
    btn.classList.add('active');
    _updateNoteTocCurrentPreferences({ visible: true });
    updateNoteToc();
  } else {
    toc.style.display = 'none';
    btn.classList.remove('active');
    _updateNoteTocCurrentPreferences({ visible: false });
  }
  syncNoteTocLayout();
}

// フロントマターからtoc設定を取得（true/false/undefined）
function _getFrontmatterToc() {
  const pc = (window.GBEditorHost?.element('page-content') || document.getElementById('page-content'));
  const fm = pc?.dataset.frontmatter || '';
  const m = fm.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return undefined;
  const tocLine = m[1].split('\n').find(l => /^toc\s*:/.test(l));
  if (!tocLine) return undefined;
  return tocLine.split(':')[1].trim() === 'true';
}

// 目次を見出しから生成
