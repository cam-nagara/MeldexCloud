/**
 * Meldex Editor
 * ページ/エントリ編集、リッチテキスト、マークダウン変換、自動リンク、検索
 */

// ページタイトルのインライン編集
// ページタイトル — contenteditableのblurでリネーム
let _pageTitleOld = '';
function initPageTitle() {
  const el = document.getElementById('page-title');
  if (!el || el._titleInit) return;
  el._titleInit = true;
  el.addEventListener('focus', () => { _pageTitleOld = el.textContent; });
  el.addEventListener('blur', async () => {
    const nv = el.textContent.trim();
    const path = state.currentPagePath;
    if (!nv) { el.textContent = _pageTitleOld; return; }
    if (!path || nv === _pageTitleOld) return;
    if (typeof isItemLocked === 'function' && isItemLocked(path)) { el.textContent = _pageTitleOld; return; }
    try {
      const res = await apiPost('/outliner/rename', { old_path: path, new_name: nv, type: 'page' });
      if (!res || !res.ok) throw new Error('rename failed');
      const newPath = res.new_path || (() => {
        const dir = path.substring(0, path.lastIndexOf('/'));
        const ext = path.substring(path.lastIndexOf('.'));
        return dir + '/' + nv + ext;
      })();
      // 自動保存タイマーをキャンセル（旧パスへの保存を防止）
      clearTimeout(window._noteAutoSaveTimer);
      state.currentPagePath = newPath;
      document.getElementById('page-content').dataset.path = newPath;
      showStatus('リネーム: ' + _pageTitleOld + ' → ' + nv);
      _pageTitleOld = nv;
      // フォルダツリーのノードを直接更新（loadOutlinerによる全再構築を避ける）
      _renameTreeNode(path, newPath, nv, res.file_id);
      if (typeof renameAppPathReferences === 'function') {
        renameAppPathReferences(path, newPath, { label: nv, fileId: res.file_id, type: 'page' });
      }
      if (typeof handleRelocateResponse === 'function') handleRelocateResponse(res);
    } catch { el.textContent = _pageTitleOld; }
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
}
function startPageTitleEdit(el) { el.focus(); }

// ノートのファイルアイコン変更UIは廃止済み。旧データ互換のため参照先だけ残す。
function openPageIconPicker() {}
function _setPageIcon() {}
function _savePageIcon() {}
function _loadPageIcon() {}


function flushPendingEditorAutosave() {
  const pending = [];
  if (window._noteAutoSaveTimer) {
    clearTimeout(window._noteAutoSaveTimer);
    window._noteAutoSaveTimer = null;
    const pc = document.getElementById('page-content');
    const currentPath = pc?.dataset?.path;
    if (currentPath && pc.dataset.loadFailed !== '1') {
      pc.querySelectorAll('mark.file-search-highlight').forEach(m => m.replaceWith(...m.childNodes));
      pc.normalize();
      let md = htmlToMd(pc.innerHTML || '');
      const prevSaved = pc.dataset.lastSavedMd || '';
      const prevBody = prevSaved.replace(/^---\n[\s\S]*?\n---\n?/, '');
      const fm = pc.dataset.frontmatter || '';
      const prevFm = (prevSaved.match(/^(---\n[\s\S]*?\n---\n?)/) || [null, ''])[1] || '';
      if (md.trim() || prevBody.trim() || fm !== prevFm) {
        if (fm) md = fm + md;
        window.MeldexDraftRecovery?.queueDraft?.(currentPath, md, pc.dataset.lastSavedMd || '');
        const req = apiPut('/file?path=' + encodeURIComponent(currentPath), _noteSavePayload(pc, md));
        pending.push(req);
        req
          .then((res) => {
            if (_handleNoteSkippedMissingSave(res, currentPath, md, pc)) return;
            pc.dataset.lastSavedMd = md;
            pc.dataset.lastSavedEtag = res.etag || '';
            window.MeldexDraftRecovery?.markSynced?.(currentPath);
          })
          .catch((error) => {
            if (!_handleNoteSaveFailure(error, currentPath, md, pc)) {
              showStatus('自動保存に失敗しました。ネットワークを確認してください', true);
            }
          });
      }
    }
  }
  if (window._ftAutoSaveTimer) {
    clearTimeout(window._ftAutoSaveTimer);
    window._ftAutoSaveTimer = null;
    const ft = document.getElementById('entity-freetext');
    const ep = ft?.dataset?.entityPath;
    if (ep && ft.textContent.trim() !== '自由記述エリア（クリックして編集）') {
      const md = htmlToMd(ft.innerHTML || '');
      const req = (ep.endsWith('.md')
        ? apiPut('/value?path=' + encodeURIComponent(ep), { new_body: md, skip_if_missing: true })
        : apiPut('/file?path=' + encodeURIComponent(ep + '/_freetext.md'), { content: md, skip_if_missing: true }))
        .then((res) => { _handleFreeTextSkippedMissingSave(res); return res; });
      pending.push(req);
      req.catch(() => { showStatus('自由記述の自動保存に失敗しました', true); });
    }
  }
  return pending.length ? Promise.allSettled(pending) : Promise.resolve([]);
}

function _noteMarkdownFromEditor(pc) {
  if (!pc) return '';
  pc.querySelectorAll('mark.file-search-highlight').forEach(m => m.replaceWith(...m.childNodes));
  pc.normalize();
  let md = htmlToMd(pc.innerHTML || '');
  const fm = pc.dataset.frontmatter || '';
  if (fm) md = fm + md;
  return md;
}

function _noteSavePayload(pc, md, extra) {
  const payload = {
    content: md,
    if_match_etag: pc?.dataset?.lastSavedEtag || '',
    skip_if_missing: true,
    ...(extra || {}),
  };
  if (payload.force_overwrite) delete payload.skip_if_missing;
  return payload;
}

function _noteSaveSkippedMissing(res) {
  return !!(res?.skipped || res?.missing);
}

function _handleNoteSkippedMissingSave(res, path, md, pc) {
  if (!_noteSaveSkippedMissing(res)) return false;
  window.MeldexDraftRecovery?.saveDraft?.(path, md, pc?.dataset?.lastSavedMd || '');
  showStatus('ノート保存を中止しました: ファイルが見つかりません。下書きを保持しました', true);
  return true;
}

function _handleFreeTextSkippedMissingSave(res) {
  if (!_noteSaveSkippedMissing(res)) return false;
  showStatus('自由記述の保存先が見つかりません。内容は画面に保持しています', true);
  return true;
}

function _noteDir(path) {
  const value = String(path || '');
  const idx = value.lastIndexOf('/');
  return idx >= 0 ? value.slice(0, idx + 1) : '';
}

function _renderNoteConflictDiff(host, mine, other) {
  if (!host) return;
  host.textContent = '';
  const a = String(mine || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const b = String(other || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const rows = (typeof _computeDiff === 'function')
    ? _computeDiff(a, b).map(d => ({ left: d.textA || '', right: d.textB || '', same: d.type === 'equal' }))
    : Array.from({ length: Math.max(a.length, b.length) }, (_, i) => ({ left: a[i] || '', right: b[i] || '', same: (a[i] || '') === (b[i] || '') }));
  const diffCount = rows.filter(r => !r.same).length;
  const title = document.createElement('div');
  title.style.cssText = 'display:flex;justify-content:space-between;gap:12px;font-size:12px;color:var(--ui-fg-muted);margin:10px 0 6px;';
  title.innerHTML = `<span>自分の未保存編集</span><span>ファイル側の最新版</span>`;
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;max-height:min(42vh,420px);overflow:auto;border:1px solid var(--border);border-radius:6px;background:var(--bg1,var(--bg));padding:6px;';
  const left = document.createElement('div');
  const right = document.createElement('div');
  [left, right].forEach(col => {
    col.style.cssText = 'display:flex;flex-direction:column;gap:1px;min-width:0;font:12px/1.5 var(--mono,Consolas,monospace);white-space:pre-wrap;word-break:break-word;';
  });
  rows.slice(0, 300).forEach((row, i) => {
    const leftLine = document.createElement('div');
    const rightLine = document.createElement('div');
    [leftLine, rightLine].forEach(el => {
      el.style.cssText = (row.same ? '' : 'background:rgba(220,80,80,.16);') + 'padding:1px 4px;border-radius:3px;';
    });
    leftLine.textContent = `${i + 1}: ${row.left || ' '}`;
    rightLine.textContent = `${i + 1}: ${row.right || ' '}`;
    left.appendChild(leftLine);
    right.appendChild(rightLine);
  });
  if (rows.length > 300) {
    [left, right].forEach(col => {
      const more = document.createElement('div');
      more.textContent = `... ${rows.length - 300} 行省略`;
      more.style.cssText = 'padding:4px;color:var(--ui-fg-muted);';
      col.appendChild(more);
    });
  }
  const summary = document.createElement('div');
  summary.textContent = diffCount ? `差分 ${diffCount} 行。どちらを残すか選んでください。` : '差分はありません。必要に応じて保存方法を選んでください。';
  summary.style.cssText = 'font-size:12px;color:var(--ui-fg-muted);margin-top:6px;';
  grid.append(left, right);
  host.append(title, grid, summary);
}

function _showNoteConflictDialog(path, md, pc) {
  if (document.querySelector('[data-note-conflict-dialog="1"]')) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.noteConflictDialog = '1';
  overlay.style.zIndex = '10090';
  overlay.innerHTML = `<div class="gb-confirm" role="dialog" aria-modal="true" style="min-width:min(920px,92vw);max-width:min(1000px,96vw);">
    <div class="gb-confirm-message" style="font-weight:600;">他のタブ/パネルで変更されています</div>
    <div class="gb-confirm-message" style="color:var(--ui-fg-muted);">現在の編集は未保存ドラフトとして保持しています。どちらを残すか選んでください。</div>
    <div data-conflict-diff style="margin-top:8px;color:var(--ui-fg-muted);">ファイル側の最新版を取得しています...</div>
    <div class="gb-confirm-actions">
      <button data-e2e-id="note-conflict-overwrite" data-conflict-action="overwrite">自分の編集で上書き</button>
      <button data-e2e-id="note-conflict-reload" data-conflict-action="reload">相手の変更を読み込む</button>
      <button data-e2e-id="note-conflict-save-as" data-conflict-action="save-as">別名で保存</button>
      <button data-e2e-id="note-conflict-close" data-conflict-action="close">保留</button>
    </div>
  </div>`;
  overlay.addEventListener('click', async (event) => {
    const action = event.target?.dataset?.conflictAction;
    if (!action) return;
    if (action === 'close') {
      overlay.remove();
      return;
    }
    try {
      if (action === 'overwrite') {
        const res = await apiPut('/file?path=' + encodeURIComponent(path), _noteSavePayload(pc, md, { force_overwrite: true }));
        if (pc) {
          pc.dataset.lastSavedMd = md;
          pc.dataset.lastSavedEtag = res.etag || '';
        }
        window.MeldexSaveSafety?.clearConflict?.(path);
        await window.MeldexDraftRecovery?.markSynced?.(path);
        showStatus('自分の編集で上書き保存しました');
      } else if (action === 'reload') {
        await window.MeldexDraftRecovery?.saveDraft?.(path, md, pc?.dataset?.lastSavedMd || '');
        await openPage(path.split('/').pop().replace(/\.md$/i, ''), path);
        window.MeldexSaveSafety?.clearConflict?.(path);
        showStatus('相手の変更を読み込みました');
      } else if (action === 'save-as') {
        const fallback = _noteDir(path) + path.split('/').pop().replace(/(\.[^/.]+)?$/, '_copy$1');
        const nextPath = await cfPrompt('別名で保存', fallback);
        if (!nextPath) return;
        const res = await apiPut('/file?path=' + encodeURIComponent(nextPath), { content: md });
        if (pc) {
          pc.dataset.path = nextPath;
          pc.dataset.lastSavedMd = md;
          pc.dataset.lastSavedEtag = res.etag || '';
        }
        state.currentPagePath = nextPath;
        window.MeldexSaveSafety?.clearConflict?.(path);
        showStatus('別名で保存しました');
      }
      overlay.remove();
    } catch (error) {
      showStatus('競合処理に失敗しました: ' + (error.message || error), true);
    }
  });
  document.body.appendChild(overlay);
  apiFetch('/file?path=' + encodeURIComponent(path)).then(data => {
    _renderNoteConflictDiff(overlay.querySelector('[data-conflict-diff]'), md, String(data?.content || ''));
  }).catch(() => {
    const diffHost = overlay.querySelector('[data-conflict-diff]');
    if (diffHost) diffHost.textContent = 'ファイル側の最新版を取得できませんでした。必要なら「相手の変更を読み込む」で再読込してください。';
  });
}

function _handleNoteSaveFailure(error, path, md, pc) {
  window.MeldexDraftRecovery?.saveDraft?.(path, md, pc?.dataset?.lastSavedMd || '');
  if (error?.meldexCode === 'etag_conflict' || error?.status === 409) {
    window.MeldexSaveSafety?.markConflict?.(path, error?.meldexMessage || error?.message || '保存競合');
    _showNoteConflictDialog(path, md, pc);
    return true;
  }
  if (error?.status === 404 || error?.meldexCode === 'file_missing' || error?.code === 'file_missing') {
    showStatus('ノート保存を中止しました: ファイルが見つかりません。下書きを保持しました', true);
    return true;
  }
  return false;
}

function _noteMarkdownFrontmatterType(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(String(text || ''));
  if (!match) return '';
  const typeMatch = /^\s*type\s*:\s*([^\r\n#]+)/m.exec(match[1]);
  return typeMatch ? typeMatch[1].trim().replace(/^['"]|['"]$/g, '') : '';
}

function _notePathLooksLikeBoard(path) {
  return /\.(?:mel-board|board\.md)$/i.test(String(path || ''));
}

function _noteMarkdownIsBoard(text) {
  return _noteMarkdownFrontmatterType(text) === 'board';
}

function _schedulePageDisplayLayers(path, pc, html, isStalePageLoad) {
  const layers = window.MeldexDisplayLayers;
  const autoLinksEnabled = !!layers?.isEnabled?.('autoLinks');
  const commentsEnabled = !!layers?.isEnabled?.('comments');
  if (!autoLinksEnabled && !commentsEnabled) return;
  const initialHtml = pc.innerHTML;
  const run = () => {
    if (isStalePageLoad?.()) return;
    if (document.activeElement === pc) return;
    if (autoLinksEnabled && pc.innerHTML === initialHtml) {
      pc.innerHTML = applyAutoLinks(html, path, { force: true });
    }
    if (commentsEnabled && typeof CommentBadges !== 'undefined') {
      try { CommentBadges.refreshNote(path, pc, { force: true }); } catch {}
    }
  };
  if (typeof layers?.scheduleIdle === 'function') layers.scheduleIdle(run, 900);
  else setTimeout(run, 0);
}


// ページ表示
async function openPage(label, path, opts) {
  const openOpts = opts || {};
  const showOpenLoading = !openOpts.silent
    && !openOpts.skipGlobalUi
    && typeof showLoading === 'function'
    && typeof hideLoading === 'function';
  let loadingShown = false;
  let preloadedFileData = null;
  try {
    if (showOpenLoading) { showLoading('ノートを読み込み中...'); loadingShown = true; }
    if (!openOpts.allowBoardAsPage && typeof openBoard === 'function' && _notePathLooksLikeBoard(path)) {
      if (loadingShown) { hideLoading(); loadingShown = false; }
      await openBoard(label, path, openOpts);
      return;
    }
    if (!openOpts.allowBoardAsPage && typeof openBoard === 'function' && /\.md$/i.test(String(path || ''))) {
      try {
        preloadedFileData = await apiFetch('/file?path=' + encodeURIComponent(path));
        if (_noteMarkdownIsBoard(preloadedFileData?.content || '')) {
          if (loadingShown) { hideLoading(); loadingShown = false; }
          await openBoard(label, path, openOpts);
          return;
        }
      } catch {
        preloadedFileData = null;
      }
    }
  if (!openOpts.skipStateView) state.view = 'page';
  state.currentPagePath = path;
  if (!openOpts.skipHistoryScope && typeof historySetScope === 'function') historySetScope('');
  if (!openOpts.skipShowView) showView('page');
  const pageTitleEl = document.getElementById('page-title');
  if (pageTitleEl) {
    pageTitleEl.textContent = label;
    pageTitleEl.contentEditable = isItemLocked(path) ? 'false' : 'true';
  }
  initPageTitle();
  if (!openOpts.skipRecent) addRecent(label, path, 'page');
  if (!openOpts.skipSaveLastView) saveLastView({type:'page', label, path});
  if (!openOpts.skipNavPush) {
    const _navEntry = {type:'page', label, path};
    navPush(_navEntry);
  }
  if (!openOpts.skipAutoVersion) startAutoVersion(path, 'file');
  const pc = document.getElementById('page-content');
  if (!pc) return;
  const pageLoadSeq = (window._openPageLoadSeq || 0) + 1;
  window._openPageLoadSeq = pageLoadSeq;
  const isStalePageLoad = () => window._openPageLoadSeq !== pageLoadSeq || pc.dataset.path !== path;
  pc.dataset.path = path;
  // 編集ロック
  pc.contentEditable = isItemLocked(path) ? 'false' : 'true';

  // フォルダツリーで対応するノードをハイライト
  if (!openOpts.skipHighlight) highlightOutlinerNode(path);

  let _openPageFileData = null;
  try {
    const data = preloadedFileData || await apiFetch('/file?path=' + encodeURIComponent(path));
    _openPageFileData = data;
    if (isStalePageLoad()) return;
    const raw = data.content || '';
    // フロントマターを保存（保存時にプリペンドするため）
    const fmMatch = raw.match(/^(---\n[\s\S]*?\n---\n?)/);
    pc.dataset.frontmatter = fmMatch ? fmMatch[1] : '';
    pc.dataset.lastSavedMd = raw;
    pc.dataset.lastSavedEtag = data.etag || '';
    pc.dataset.loadFailed = '';
    pc.contentEditable = isItemLocked(path) ? 'false' : 'true';
    if (showOpenLoading && typeof showLoadingBeforeHeavyWork === 'function') {
      await showLoadingBeforeHeavyWork(raw, '大きいノートを描画中...');
      if (isStalePageLoad()) return;
    }
    // 本文を先に表示し、重い表示レイヤーは必要時だけ遅延適用する。
    const html = mdToHtml(raw);
    pc.innerHTML = html;
    _loadPageIcon();
    if (typeof CommentBadges !== 'undefined') { try { CommentBadges.refreshFileIndicator(path); } catch {} }
    _schedulePageDisplayLayers(path, pc, html, isStalePageLoad);
    if (!openOpts.skipGlobalUi) showStatus(`ノート: ${label}`);
  } catch (e) {
    pc.innerHTML = '<span style="color:var(--fg2)">(ノートを読み込めませんでした)</span>';
    pc.dataset.frontmatter = '';
    pc.dataset.lastSavedMd = '';
    pc.dataset.loadFailed = '1';
    pc.contentEditable = 'false';
  }

  // 前回のハンドラを除去してから再登録（openPage呼び出しごとの蓄積防止）
  if (pc._autoLinkHandler) pc.removeEventListener('click', pc._autoLinkHandler);
  if (pc._autoLinkDblHandler) pc.removeEventListener('dblclick', pc._autoLinkDblHandler);
  pc._autoLinkHandler = function(e) {
    const link = e.target.closest('.auto-link');
    if (link) {
      e.preventDefault();
      onAutoLinkClick(link, e);
    }
  };
  if (pc._autoLinkDblHandler) pc.removeEventListener('dblclick', pc._autoLinkDblHandler);
  pc._autoLinkDblHandler = null;
  pc.addEventListener('click', pc._autoLinkHandler);

  // 前のタイマーをキャンセル（ページ切替時に古いパスで保存されるのを防止）
  clearTimeout(window._noteAutoSaveTimer);

  pc.onblur = async function() {
    clearTimeout(window._noteAutoSaveTimer); // onblur時もタイマーキャンセル
    const currentPath = this.dataset.path;
    if (!currentPath) return;
    if (this.dataset.loadFailed === '1') return;
    this.querySelectorAll('mark.file-search-highlight').forEach(m => m.replaceWith(...m.childNodes));
    this.normalize();
    // auto-linkを除去せずhtmlToMdに渡す（htmlToMd内でMarkdownリンクに変換される）
    let md = htmlToMd(this.innerHTML);
    // 過去に中身があったノートを全削除した場合は空のまま保存する必要がある。
    // 初回開いて何も編集していないケースだけ保存スキップ。
    const prevSaved = this.dataset.lastSavedMd || '';
    const prevBody = prevSaved.replace(/^---\n[\s\S]*?\n---\n?/, '');
    // フロントマターを復元
    const fm = this.dataset.frontmatter || '';
    const prevFm = (prevSaved.match(/^(---\n[\s\S]*?\n---\n?)/) || [null, ''])[1] || '';
    if (!md.trim() && !prevBody.trim() && fm === prevFm) return;
    if (fm) md = fm + md;
    const prevMd = this.dataset.lastSavedMd || '';
    try {
      const res = await apiPut('/file?path=' + encodeURIComponent(currentPath), _noteSavePayload(this, md));
      if (_handleNoteSkippedMissingSave(res, currentPath, md, this)) return;
      _orphanRemovedNoteLines(prevMd, md, currentPath);
      this.dataset.lastSavedMd = md;
      this.dataset.lastSavedEtag = res.etag || '';
      await window.MeldexDraftRecovery?.markSynced?.(currentPath);
      showStatus('ノートを保存しました', false, { passiveSave: true });
      // 操作履歴に記録（undo/redoはブラウザネイティブに任せる）
      if (typeof historyPush === 'function') {
        const detail = typeof summarizeHistoryTextChange === 'function'
          ? summarizeHistoryTextChange(prevMd, md)
          : '内容を更新';
        historyPush('ページ編集', null, null, 'page:' + currentPath.split('/').pop(), detail);
      }
      // DOM再構築はしない（ラウンドトリップで改行消失を防止）
    } catch (e) {
      if (!_handleNoteSaveFailure(e, currentPath, md, this)) {
        showStatus('ノートの保存に失敗しました。ネットワークを確認してください', true);
      }
    }
  };

  // 自動保存: 入力後2秒で保存（dataset.pathを都度参照し、クロージャのpathは使わない）
  pc.oninput = () => {
    if (pc.dataset.loadFailed === '1') return;
    markAutoVersionDirty();
    clearTimeout(window._noteAutoSaveTimer);
    const draftPath = pc.dataset.path;
    if (draftPath) {
      window.MeldexDraftRecovery?.queueDraft?.(draftPath, _noteMarkdownFromEditor(pc), pc.dataset.lastSavedMd || '');
    }
    window._noteAutoSaveTimer = setTimeout(() => {
      const currentPath = pc.dataset.path;
      if (!currentPath) return;
      pc.querySelectorAll('mark.file-search-highlight').forEach(m => m.replaceWith(...m.childNodes));
      pc.normalize();
      let md = htmlToMd(pc.innerHTML);
      // 全削除を保存できるように、過去に本文があった場合は空でも保存する
      const prevSaved = pc.dataset.lastSavedMd || '';
      const prevBody = prevSaved.replace(/^---\n[\s\S]*?\n---\n?/, '');
      const fm = pc.dataset.frontmatter || '';
      const prevFm = (prevSaved.match(/^(---\n[\s\S]*?\n---\n?)/) || [null, ''])[1] || '';
      if (!md.trim() && !prevBody.trim() && fm === prevFm) return;
      if (fm) md = fm + md;
      const _prevSavedForDiff = pc.dataset.lastSavedMd || '';
      window.MeldexDraftRecovery?.queueDraft?.(currentPath, md, pc.dataset.lastSavedMd || '');
      apiPut('/file?path=' + encodeURIComponent(currentPath), _noteSavePayload(pc, md))
        .then((res) => {
          if (_handleNoteSkippedMissingSave(res, currentPath, md, pc)) return;
          _orphanRemovedNoteLines(_prevSavedForDiff, md, currentPath);
          pc.dataset.lastSavedMd = md;
          pc.dataset.lastSavedEtag = res.etag || '';
          window.MeldexDraftRecovery?.markSynced?.(currentPath);
        })
        .catch((error) => {
          if (!_handleNoteSaveFailure(error, currentPath, md, pc)) {
            showStatus('自動保存に失敗しました。ネットワークを確認してください', true);
          }
        });
    }, 2000);
    // 目次更新（#note-toc 不在で TypeError にしない）
    const tocEl = document.getElementById('note-toc');
    if (tocEl && tocEl.style.display !== 'none') updateNoteToc();
  };

  // 目次を更新（フロントマター優先、なければlocalStorage設定）
  const _toc = document.getElementById('note-toc');
  const _tocBtn = document.getElementById('btn-toc-toggle');
  const _fmToc = _getFrontmatterToc();
  // ファイル指定 > グローバル設定
  const _showToc = _fmToc !== undefined ? _fmToc
                 : localStorage.getItem('note-toc-visible') === '1';
  if (_showToc) {
    if (_toc) _toc.style.display = '';
    if (_tocBtn) _tocBtn.classList.add('active');
  } else {
    if (_toc) _toc.style.display = 'none';
    if (_tocBtn) _tocBtn.classList.remove('active');
  }
  syncNoteTocLayout();
  if (_toc && _toc.style.display !== 'none') updateNoteToc();

  // ビューワーペインにプレビュー表示（読み込み済みデータを渡して再取得を回避）
  if (!openOpts.skipGlobalUi) _updateLinkedPreview(path, _openPageFileData);
  // 詳細パネルにファイル情報を表示（メタ情報を渡して /file-meta 呼び出しを回避）
  const _fileMeta = _openPageFileData?.modified ? { created: _openPageFileData.created, modified: _openPageFileData.modified, size: _openPageFileData.size } : undefined;
  if (!openOpts.skipGlobalUi) _syncDetailPanel(label, path, 'page', { fileMeta: _fileMeta });
  } finally {
    if (loadingShown) {
      hideLoading();
      if (typeof hideLoadingMessage === 'function') {
        hideLoadingMessage('ノートを読み込み中...');
        hideLoadingMessage('大きいノートを描画中...');
      }
    }
  }
}

// ノート縦書き/横書き切替
function toggleNoteVertical() {
  const pc = document.getElementById('page-content');
  const btn = document.getElementById('btn-note-vertical');
  const isV = pc.classList.toggle('vertical-writing');
  // アイコンは「クリック後の動作」を示す: 横書き中→kanban（縦書きにする）、縦書き中→textAlignStart（横書きに戻す）
  if (btn) {
    const iconName = isV ? 'textAlignStart' : 'kanban';
    btn.innerHTML = (typeof lucide === 'function') ? lucide(iconName, 16) : '<span class="ico ico-' + iconName + '"></span>';
    btn.title = isV ? '横書きに戻す' : '縦書きにする';
    btn.classList.toggle('active', isV);
  }
  localStorage.setItem('note-vertical', isV ? '1' : '');
}

const NOTE_TOC_WIDTH_KEY = 'note-toc-width';

function syncNoteTocLayout() {
  const toc = document.getElementById('note-toc');
  const handle = document.getElementById('note-toc-resize');
  if (!toc || !handle) return;
  const visible = toc.style.display !== 'none';
  handle.style.display = visible ? '' : 'none';
  if (!visible) return;
  const savedWidth = parseInt(localStorage.getItem(NOTE_TOC_WIDTH_KEY) || '200', 10) || 200;
  toc.style.width = savedWidth + 'px';
  toc.style.flexBasis = savedWidth + 'px';
}

function initNoteTocResize() {
  if (window._noteTocResizeInitialized) return;
  window._noteTocResizeInitialized = true;
  const toc = document.getElementById('note-toc');
  const handle = document.getElementById('note-toc-resize');
  if (!toc || !handle) return;
  handle.addEventListener('pointerdown', (e) => {
    if (toc.style.display === 'none') return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = toc.getBoundingClientRect().width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev) => {
      const next = Math.max(140, Math.min(420, Math.round(startWidth + (ev.clientX - startX))));
      toc.style.width = next + 'px';
      toc.style.flexBasis = next + 'px';
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem(NOTE_TOC_WIDTH_KEY, String(Math.round(toc.getBoundingClientRect().width)));
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
}

// 縦書きモード: マウスホイールで横スクロール
document.getElementById('page-content').addEventListener('wheel', function(e) {
  if (e.ctrlKey) return; // Ctrl+ホイール: UIスケール変更に委譲
  if (!this.classList.contains('vertical-writing')) return;
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    e.preventDefault();
    this.scrollLeft -= e.deltaY;
  }
}, { passive: false });

// Ctrl+K: リンク挿入モーダル
document.getElementById('page-content').addEventListener('keydown', function(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    const sel = window.getSelection();
    const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    showLinkInsertModal(range);
  }
});

function _rangeBelongsToEditable(el, range) {
  if (!el || !range) return false;
  const node = range.commonAncestorContainer;
  const root = node?.nodeType === 1 ? node : node?.parentElement;
  return !!(root && (root === el || el.contains(root)));
}

function _captureEditableSelection(el) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0).cloneRange();
  return _rangeBelongsToEditable(el, range) ? range : null;
}

function _restoreEditableRange(el, range) {
  if (!_rangeBelongsToEditable(el, range)) return false;
  try {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  } catch {
    return false;
  }
}

function _editableRangeFromPoint(el, x, y) {
  let range = null;
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(x, y);
  } else if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    }
  }
  return _rangeBelongsToEditable(el, range) ? range : null;
}

function _safeAutoLinkPasteHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const blockTags = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'LI']);
  const walk = (node) => {
    if (node.nodeType === 3) return esc(node.textContent || '');
    if (node.nodeType !== 1) return '';
    const tag = node.tagName;
    if (tag === 'BR') return '<br>';
    if (node.classList?.contains('auto-link') && node.dataset?.path) {
      const label = node.textContent || node.dataset.path;
      return `<span class="auto-link" data-path="${esc(node.dataset.path)}" style="color:var(--accent);text-decoration:underline;cursor:pointer;">${esc(label)}</span>`;
    }
    const inner = [...node.childNodes].map(walk).join('');
    return blockTags.has(tag) ? `<div>${inner || '<br>'}</div>` : inner;
  };
  return [...tmp.childNodes].map(walk).join('');
}

function _readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => resolve(ev.target.result);
    reader.onerror = () => reject(reader.error || new Error('file read failed'));
    reader.readAsDataURL(file);
  });
}

function _insertHtmlAtEditableRange(el, range, html) {
  _restoreEditableRange(el, range);
  document.execCommand('insertHTML', false, html);
  return _captureEditableSelection(el) || range;
}

async function _insertDroppedFileAtRange(el, range, file, dir) {
  const dataUrl = await _readFileAsDataURL(file);
  const res = await apiFetch('/upload-file?path=' + encodeURIComponent(dir), {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({data: dataUrl, filename: file.name}),
  });
  if (!res.ok) return range;
  const rawPath = res.path || file.name;
  const linkUrl = API_BASE + '/file-raw?path=' + encodeURIComponent(rawPath);
  if (file.type.startsWith('image/')) {
    return _insertHtmlAtEditableRange(el, range,
      `<div class="embed-media" contenteditable="false" data-path="${esc(rawPath)}" data-name="${esc(file.name)}"><img src="${esc(linkUrl)}" alt="${esc(file.name)}"></div>`);
  }
  if (file.type.startsWith('video/')) {
    return _insertHtmlAtEditableRange(el, range,
      `<div class="embed-media" contenteditable="false" data-path="${esc(rawPath)}" data-name="${esc(file.name)}"><video src="${esc(linkUrl)}" controls style="max-width:100%;"></video></div>`);
  }
  return _insertHtmlAtEditableRange(el, range, `<a href="${esc(linkUrl)}">${esc(file.name)}</a> `);
}

// クリップボード貼り付け: テキスト + 画像対応
document.getElementById('page-content').addEventListener('paste', async function(e) {
  if (!this.isContentEditable) return;
  const cd = e.clipboardData;
  if (!cd) return;

  // 画像が含まれている場合 → アップロードして埋め込み
  const imageFile = [...cd.files].find(f => f.type.startsWith('image/'));
  if (imageFile) {
    e.preventDefault();
    const editor = this;
    const pasteRange = _captureEditableSelection(editor);
    const currentPath = editor.dataset.path || state.currentPagePath;
    if (!currentPath) return;
    const dir = currentPath.substring(0, currentPath.lastIndexOf('/'));
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const fname = imageFile.name || ('paste-' + Date.now() + '.png');
        const res = await apiFetch('/upload-file?path=' + encodeURIComponent(dir), {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({data: ev.target.result, filename: fname}),
        });
        if (res.ok && res.path) {
          const linkUrl = API_BASE + '/file-raw?path=' + encodeURIComponent(res.path);
          _insertHtmlAtEditableRange(editor, pasteRange,
            `<div class="embed-media" contenteditable="false" data-path="${esc(res.path)}" data-name="${esc(fname)}"><img src="${esc(linkUrl)}" alt="${esc(fname)}"></div>`);
        }
      } catch (err) { showStatus('画像の貼り付けに失敗', true); }
    };
    reader.readAsDataURL(imageFile);
    return;
  }

  // auto-link を含むHTMLの場合はリッチ貼り付け
  const html = cd.getData('text/html');
  if (html && html.includes('auto-link') && html.includes('data-path')) {
    e.preventDefault();
    const safeHtml = _safeAutoLinkPasteHtml(html);
    if (safeHtml.trim()) {
      document.execCommand('insertHTML', false, safeHtml);
      return;
    }
  }

  // テキスト: プレーンテキストとして挿入（HTML書式を除去）
  const text = cd.getData('text/plain');
  if (text) {
    e.preventDefault();
    document.execCommand('insertText', false, text);
  }
});

// ユニバーサルD&D: ノートビューへの挿入
// 埋め込みメディア フローティングコントロール
let _activeMedia = null;

(function() {
  const controls = document.getElementById('media-float-controls');
  const resizeHandle = document.getElementById('media-resize-handle');
  if (!controls || !resizeHandle) return;

  // ホバーでコントロール表示
  document.addEventListener('mouseover', (e) => {
    const media = e.target.closest('.embed-media');
    if (media) {
      _activeMedia = media;
      _positionMediaControls(media);
      return;
    }
    // コントロール/リサイズ上にいる場合は維持
    if (e.target.closest('#media-float-controls') || e.target.id === 'media-resize-handle') return;
  });

  // コントロールから離れたら非表示（遅延付きで誤消去防止）
  let _mediaHideTimer = null;
  function _scheduleHideMedia() {
    clearTimeout(_mediaHideTimer);
    _mediaHideTimer = setTimeout(() => {
      controls.classList.remove('visible');
      resizeHandle.classList.remove('visible');
      _activeMedia = null;
    }, 200);
  }
  function _cancelHideMedia() {
    clearTimeout(_mediaHideTimer);
  }

  document.addEventListener('mouseout', (e) => {
    const related = e.relatedTarget;
    if (related && (related.closest('.embed-media') || related.closest('#media-float-controls') || related.id === 'media-resize-handle')) {
      _cancelHideMedia();
      return;
    }
    if (e.target.closest('.embed-media') || e.target.closest('#media-float-controls') || e.target.id === 'media-resize-handle') {
      _scheduleHideMedia();
    }
  });
  controls.addEventListener('mouseenter', _cancelHideMedia);
  resizeHandle.addEventListener('mouseenter', _cancelHideMedia);

  // アラインメントボタン
  controls.querySelectorAll('[data-align]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_activeMedia) return;
      const align = btn.dataset.align;
      controls.querySelectorAll('[data-align]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (align === 'left') { _activeMedia.style.marginLeft = '0'; _activeMedia.style.marginRight = 'auto'; }
      else if (align === 'right') { _activeMedia.style.marginLeft = 'auto'; _activeMedia.style.marginRight = '0'; }
      else { _activeMedia.style.marginLeft = 'auto'; _activeMedia.style.marginRight = 'auto'; }
      const pc = document.getElementById('page-content');
      if (pc) pc.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  // 削除ボタン
  controls.querySelector('[data-action="delete"]').addEventListener('click', () => {
    if (_activeMedia) {
      _activeMedia.remove(); controls.classList.remove('visible'); resizeHandle.classList.remove('visible'); _activeMedia = null;
      const pc = document.getElementById('page-content');
      if (pc) pc.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  // リサイズハンドル
  resizeHandle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!_activeMedia) return;
    const img = _activeMedia.querySelector('img, video');
    if (!img) return;
    const startX = e.clientX, startW = img.offsetWidth;
    function onMove(ev) {
      const newW = Math.max(50, startW + (ev.clientX - startX));
      img.style.width = newW + 'px';
      img.style.height = 'auto';
      _positionMediaControls(_activeMedia);
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      // リサイズ完了 → 自動保存トリガー
      const pc = document.getElementById('page-content');
      if (pc) pc.dispatchEvent(new Event('input', { bubbles: true }));
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
})();

function _positionMediaControls(media) {
  const controls = document.getElementById('media-float-controls');
  const resizeHandle = document.getElementById('media-resize-handle');
  if (!controls || !media) return;
  const rect = media.getBoundingClientRect();
  const z = _getZoom();
  controls.style.left = (rect.right / z - controls.offsetWidth - 4) + 'px';
  controls.style.top = (rect.top / z + 4) + 'px';
  controls.classList.add('visible');
  resizeHandle.style.left = (rect.right / z - 7) + 'px';
  resizeHandle.style.top = (rect.bottom / z - 7) + 'px';
  resizeHandle.classList.add('visible');
  // 現在のアラインメントを反映
  const ml = media.style.marginLeft, mr = media.style.marginRight;
  controls.querySelectorAll('[data-align]').forEach(b => b.classList.remove('active'));
  if (ml === '0px' || ml === '0') controls.querySelector('[data-align="left"]')?.classList.add('active');
  else if (mr === '0px' || mr === '0') controls.querySelector('[data-align="right"]')?.classList.add('active');
  else controls.querySelector('[data-align="center"]')?.classList.add('active');
}

// 埋め込みメディアのダブルクリックでビューワーを開く
function _embeddedMediaType(media) {
  const tag = media?.querySelector('video,audio')?.tagName;
  if (tag === 'VIDEO') return 'video';
  if (tag === 'AUDIO') return 'audio';
  const ext = String(media?.dataset?.path || '').split('.').pop().toLowerCase();
  if (['mp4','mov','avi','webm'].includes(ext)) return 'video';
  if (['mp3','wav','ogg','flac'].includes(ext)) return 'audio';
  return 'image';
}

document.addEventListener('dblclick', (e) => {
  const media = e.target.closest('.embed-media');
  if (media && media.dataset.path) {
    openMedia(media.dataset.name || '', media.dataset.path, _embeddedMediaType(media));
  }
});

function setupEditableDropHandler(el) {
  el.addEventListener('dragover', (e) => {
    const types = e.dataTransfer.types;
    // パネル操作系のD&Dはスキップ（パネルハンドラに委ねる）
    if (types.includes('application/meldex-tool') ||
        types.includes('application/x-gb-tab') ||
        types.includes('application/x-gb-pane')) return;
    // meldex-node + Ctrl はパネル操作（ファイルを開く）
    if (types.includes('application/x-meldex-node') && e.ctrlKey) return;

    e.preventDefault();
    e.stopPropagation();
    // キャレット位置にドロップラインを表示
