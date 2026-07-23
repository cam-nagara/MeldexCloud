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
      _applyPageTitleRenameSuccess(el, path, newPath, nv, res.file_id);
      if (typeof handleRelocateResponse === 'function') handleRelocateResponse(res);
    } catch (e) {
      if (e && e.isTimeout) {
        await _pageTitleConfirmRenameAfterTimeout(el, path, nv);
      } else {
        // API失敗時はタイトルを元に戻す（無言で戻すとユーザーが失敗に気づけないため理由も表示）
        el.textContent = _pageTitleOld;
        const reason = (e && (e.userMessage || e.message)) ? String(e.userMessage || e.message) : '';
        showStatus(`「${_pageTitleOld}」のリネームに失敗` + (reason ? `（${reason}）` : ''), true);
      }
    }
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
  // 貼り付けは常にプレーンテキストとして挿入する（他所からの太字・斜体・フォント等の書式を持ち込ませない）
  el.addEventListener('paste', (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const text = cd.getData('text/plain');
    if (text) {
      e.preventDefault();
      document.execCommand('insertText', false, text);
    }
  });
  // ドラッグ&ドロップ等、paste以外の経路で書式付き要素が紛れ込んだ場合の保険。
  // ルビ表示用の [data-ruby] 要素（_pageTitleRubyHandler 参照）は対象外。
  el.addEventListener('input', () => {
    if (!el.querySelector('*:not(br):not([data-ruby])')) return;
    const text = el.textContent;
    el.textContent = text;
    const range = document.createRange();
    const sel = window.getSelection();
    if (el.firstChild) {
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  });
}

// ノートタイトルのリネーム成功時の反映（通常成功時とタイムアウト事後確認成功時で共通）
function _applyPageTitleRenameSuccess(el, oldPath, newPath, nv, fileId) {
  // 自動保存タイマーをキャンセル（旧パスへの保存を防止）
  clearTimeout(window._noteAutoSaveTimer);
  state.currentPagePath = newPath;
  document.getElementById('page-content').dataset.path = newPath;
  window.MeldexFileLockBadge?.apply?.(el, newPath);
  showStatus('リネーム: ' + _pageTitleOld + ' → ' + nv);
  _pageTitleOld = nv;
  // フォルダツリーのノードを直接更新（loadOutlinerによる全再構築を避ける）
  if (typeof _renameTreeNode === 'function') _renameTreeNode(oldPath, newPath, nv, fileId);
  if (typeof renameAppPathReferences === 'function') {
    renameAppPathReferences(oldPath, newPath, { label: nv, fileId, type: 'page' });
  }
}

// リネームAPIタイムアウト時の事後確認。フォルダツリー側（gb-outliner）の共通ヘルパーを再利用する
async function _pageTitleConfirmRenameAfterTimeout(el, path, nv) {
  const oldName = _pageTitleOld;
  showStatus('リネームに時間がかかっています。結果を確認中…');
  const canConfirm = typeof _outlinerFetchFolderListingForConfirm === 'function'
    && typeof _outlinerFindRenamedItem === 'function';
  if (canConfirm) {
    const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '';
    const contextNodeEl = typeof _findTreeNodeByPath === 'function' ? _findTreeNodeByPath(path) : null;
    const delays = typeof _outlinerPostTimeoutConfirmDelays === 'function'
      ? _outlinerPostTimeoutConfirmDelays()
      : (typeof OUTLINER_POST_TIMEOUT_CONFIRM_DELAYS_MS !== 'undefined'
        ? OUTLINER_POST_TIMEOUT_CONFIRM_DELAYS_MS : [2000, 4000, 8000, 16000]);
    for (const delay of delays) {
      await new Promise(r => setTimeout(r, delay));
      const items = await _outlinerFetchFolderListingForConfirm(parentPath, contextNodeEl);
      const found = _outlinerFindRenamedItem(items, oldName, nv);
      if (found) {
        if (state.currentPagePath === path) {
          _applyPageTitleRenameSuccess(el, path, found.path, nv, found.file_id);
        } else {
          // 確認中に別のノートへ移動していた場合はエディタ状態（現在パス・タイトル・
          // 自動保存先）を触らず、ツリーと参照の更新だけ行う
          if (typeof _renameTreeNode === 'function') _renameTreeNode(path, found.path, nv, found.file_id);
          if (typeof renameAppPathReferences === 'function') {
            renameAppPathReferences(path, found.path, { label: nv, fileId: found.file_id, type: 'page' });
          }
          showStatus('リネーム: ' + oldName + ' → ' + nv);
        }
        return;
      }
    }
  }
  // 確認中に別のノートへ移動していた場合、el は別ノートのタイトルを表示しているため戻さない
  if (state.currentPagePath === path) el.textContent = oldName;
  showStatus(`「${oldName}」のリネームに失敗（結果を確認できませんでした）`, true);
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
            // ページ切替でpc(singleton)が別ノートを指していたら書き込まない（etag汚染防止）
            if (pc.dataset.path === currentPath) {
              pc.dataset.lastSavedMd = md;
              pc.dataset.lastSavedEtag = res.etag || '';
            }
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
  overlay.dataset.e2eId = 'note-conflict-dialog-overlay';
  overlay.style.zIndex = '10090';
  overlay.innerHTML = `<div class="gb-confirm note-conflict-dialog" role="dialog" aria-modal="true" aria-labelledby="note-conflict-title" aria-describedby="note-conflict-desc note-conflict-diff" data-e2e-id="note-conflict-dialog" style="min-width:min(920px,92vw);max-width:min(1000px,96vw);">
    <div id="note-conflict-title" class="gb-confirm-message" style="font-weight:600;">他のタブ/パネルで変更されています</div>
    <div id="note-conflict-desc" class="gb-confirm-message" style="color:var(--ui-fg-muted);">現在の編集は未保存ドラフトとして保持しています。どちらを残すか選んでください。</div>
    <div id="note-conflict-diff" data-conflict-diff style="margin-top:8px;color:var(--ui-fg-muted);" aria-live="polite">ファイル側の最新版を取得しています...</div>
    <div class="gb-confirm-actions" data-modal-footer>
      <button type="button" class="gb-btn gb-btn-sm gb-btn-primary" data-e2e-id="note-conflict-overwrite" data-conflict-action="overwrite">自分の編集で上書き</button>
      <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="note-conflict-reload" data-conflict-action="reload">相手の変更を読み込む</button>
      <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="note-conflict-save-as" data-conflict-action="save-as">別名で保存</button>
      <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="note-conflict-close" data-conflict-action="close">保留</button>
    </div>
  </div>`;
  const restoreFocus = () => {
    if (pc?.isConnected) pc.focus?.({ preventScroll: true });
  };
  const closeDialog = () => {
    overlay.remove();
    restoreFocus();
    requestAnimationFrame(restoreFocus);
    setTimeout(restoreFocus, 260);
  };
  overlay.addEventListener('click', async (event) => {
    const actionButton = event.target?.closest?.('[data-conflict-action]');
    const action = actionButton?.dataset?.conflictAction;
    if (!action) return;
    if (action === 'close') {
      closeDialog();
      return;
    }
    try {
      if (action === 'overwrite') {
        const res = await apiPut('/file?path=' + encodeURIComponent(path), _noteSavePayload(pc, md, { force_overwrite: true }));
        // ダイアログを開いた後にpc(singleton)が別ノートへ切り替わっていたら書き込まない（etag汚染防止）
        if (pc && pc.dataset.path === path) {
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
        const promptPromise = cfPrompt('別名で保存', fallback);
        document.querySelector('[data-e2e-id="cf-prompt-overlay"]')?.style?.setProperty('z-index', '10100');
        const nextPath = await promptPromise;
        if (!nextPath) return;
        const res = await apiPut('/file?path=' + encodeURIComponent(nextPath), { content: md });
        // ダイアログを開いた後にpc(singleton)が別ノートへ切り替わっていたら書き込まない（path/etag汚染防止）
        if (pc && pc.dataset.path === path) {
          pc.dataset.path = nextPath;
          pc.dataset.lastSavedMd = md;
          pc.dataset.lastSavedEtag = res.etag || '';
          state.currentPagePath = nextPath;
        }
        window.MeldexSaveSafety?.clearConflict?.(path);
        showStatus('別名で保存しました');
      }
      closeDialog();
    } catch (error) {
      showStatus('競合処理に失敗しました: ' + (error.message || error), true);
    }
  });
  overlay.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeDialog();
  });
  document.body.appendChild(overlay);
  const focusInitialAction = () => overlay.querySelector('[data-conflict-action="overwrite"]')?.focus?.({ preventScroll: true });
  focusInitialAction();
  requestAnimationFrame(focusInitialAction);
  setTimeout(focusInitialAction, 60);
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
    window.MeldexFileLockBadge?.apply?.(pageTitleEl, path);
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
  // バージョン管理タブの追従同期。_getCurrentVersionTarget() は state.view==='page' の時
  // #page-content の dataset.path を見るため、navPush() 呼び出し時点（この直前）ではまだ
  // 古いパスのままで間に合わない。dataset.path を確定させたこの時点で同期する。
  if (typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.syncFollowingVersionTabs === 'function') {
    GBPaneBridge.syncFollowingVersionTabs();
  }
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
    _prepareEmbeddedMediaControls(pc);
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
      // ページ切替でthis(singleton)が別ノートを指していたら書き込まない（etag汚染防止）
      if (this.dataset.path === currentPath) {
        this.dataset.lastSavedMd = md;
        this.dataset.lastSavedEtag = res.etag || '';
      }
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
          // ページ切替でpc(singleton)が別ノートを指していたら書き込まない（etag汚染防止）
          if (pc.dataset.path === currentPath) {
            pc.dataset.lastSavedMd = md;
            pc.dataset.lastSavedEtag = res.etag || '';
          }
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
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-label', '目次幅を調整');
  handle.dataset.e2eId = handle.dataset.e2eId || 'note-toc-resize';
  if (!handle.hasAttribute('tabindex')) handle.tabIndex = 0;
  const applyWidth = (width) => {
    const next = Math.max(140, Math.min(420, Math.round(width)));
    toc.style.width = next + 'px';
    toc.style.flexBasis = next + 'px';
    localStorage.setItem(NOTE_TOC_WIDTH_KEY, String(next));
    return next;
  };
  const currentWidth = () => parseFloat(toc.style.width || '') || toc.getBoundingClientRect().width || parseInt(localStorage.getItem(NOTE_TOC_WIDTH_KEY) || '200', 10) || 200;
  handle.addEventListener('pointerdown', (e) => {
    if (toc.style.display === 'none') return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = currentWidth();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev) => {
      applyWidth(startWidth + (ev.clientX - startX));
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      applyWidth(currentWidth());
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
  handle.addEventListener('keydown', (e) => {
    if (toc.style.display === 'none') return;
    const current = currentWidth();
    let next = current;
    if (e.key === 'ArrowLeft') next = current - 16;
    else if (e.key === 'ArrowRight') next = current + 16;
    else if (e.key === 'Home') next = 140;
    else if (e.key === 'End') next = 420;
    else return;
    e.preventDefault();
    applyWidth(next);
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

function _prepareEmbeddedMediaForControls(media) {
  if (!media) return;
  if (!media.hasAttribute('tabindex')) media.tabIndex = 0;
  if (!media.hasAttribute('role')) media.setAttribute('role', 'group');
  if (!media.hasAttribute('aria-label')) {
    media.setAttribute('aria-label', media.dataset.name ? `埋め込みメディア: ${media.dataset.name}` : '埋め込みメディア');
  }
}

function _prepareEmbeddedMediaControls(root) {
  root?.querySelectorAll?.('.embed-media')?.forEach(_prepareEmbeddedMediaForControls);
}

(function() {
  const controls = document.getElementById('media-float-controls');
  const resizeHandle = document.getElementById('media-resize-handle');
  if (!controls || !resizeHandle) return;

  controls.setAttribute('aria-hidden', 'true');
  resizeHandle.setAttribute('aria-hidden', 'true');
  controls.querySelectorAll('[data-media-icon]').forEach(btn => {
    const icon = btn.dataset.mediaIcon;
    if (icon && typeof lucide === 'function') btn.innerHTML = lucide(icon, 14);
  });

  let _mediaHideTimer = null;

  function _cancelHideMedia() {
    clearTimeout(_mediaHideTimer);
  }

  function _hideMediaControls(options = {}) {
    const restoreTarget = options.restoreFocus ? _activeMedia : null;
    controls.classList.remove('visible');
    resizeHandle.classList.remove('visible');
    controls.setAttribute('aria-hidden', 'true');
    resizeHandle.setAttribute('aria-hidden', 'true');
    if (_activeMedia) delete _activeMedia.dataset.mediaControlsActive;
    _activeMedia = null;
    if (restoreTarget?.isConnected && typeof restoreTarget.focus === 'function') {
      try { restoreTarget.focus({ preventScroll: true }); } catch (_) { restoreTarget.focus(); }
    }
  }

  function _scheduleHideMedia() {
    clearTimeout(_mediaHideTimer);
    _mediaHideTimer = setTimeout(() => _hideMediaControls(), 200);
  }

  function _showMediaControls(media, options = {}) {
    if (!media) return;
    _cancelHideMedia();
    _prepareEmbeddedMediaForControls(media);
    if (_activeMedia && _activeMedia !== media) delete _activeMedia.dataset.mediaControlsActive;
    _activeMedia = media;
    _activeMedia.dataset.mediaControlsActive = '1';
    _positionMediaControls(media);
    controls.removeAttribute('aria-hidden');
    resizeHandle.removeAttribute('aria-hidden');
    if (options.focusControls) {
      const target = controls.querySelector('.active') || controls.querySelector('button');
      try { target?.focus?.({ preventScroll: true }); } catch (_) { target?.focus?.(); }
    }
  }

  function _isMediaControlTarget(target) {
    return !!(target?.closest?.('#media-float-controls') || target?.id === 'media-resize-handle');
  }

  document.addEventListener('mouseover', (e) => {
    const media = e.target.closest('.embed-media');
    if (media) {
      _showMediaControls(media);
      return;
    }
    // コントロール/リサイズ上にいる場合は維持
    if (_isMediaControlTarget(e.target)) return;
  });

  document.addEventListener('pointerdown', (e) => {
    const media = e.target?.closest?.('.embed-media');
    if (media) {
      _showMediaControls(media);
      return;
    }
    if (_isMediaControlTarget(e.target)) return;
    if (_activeMedia) _scheduleHideMedia();
  });

  document.addEventListener('focusin', (e) => {
    const media = e.target?.closest?.('.embed-media');
    if (media) _showMediaControls(media);
  });

  document.addEventListener('keydown', (e) => {
    const media = e.target?.closest?.('.embed-media');
    if (media && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      _showMediaControls(media, { focusControls: true });
      return;
    }
    if (e.key === 'Escape' && (_isMediaControlTarget(e.target) || media) && _activeMedia) {
      e.preventDefault();
      _hideMediaControls({ restoreFocus: true });
    }
  });

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
  controls.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      _hideMediaControls({ restoreFocus: true });
      return;
    }
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const buttons = Array.from(controls.querySelectorAll('button'));
    const current = buttons.indexOf(document.activeElement);
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const next = buttons[(current + dir + buttons.length) % buttons.length] || buttons[0];
    next?.focus?.();
  });

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
  controls.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    const media = _activeMedia;
    if (!media) return;
    controls.classList.remove('visible');
    resizeHandle.classList.remove('visible');
    controls.setAttribute('aria-hidden', 'true');
    resizeHandle.setAttribute('aria-hidden', 'true');
    const ok = typeof cfConfirm === 'function'
      ? await cfConfirm('この埋め込みメディアを削除しますか？', { danger: true, okLabel: '削除' })
      : confirm('この埋め込みメディアを削除しますか？');
    if (!ok) {
      if (media.isConnected) _showMediaControls(media, { focusControls: true });
      return;
    }
    if (!media.isConnected) {
      _hideMediaControls();
      return;
    }
    media.remove();
    _hideMediaControls();
    const pc = document.getElementById('page-content');
    if (pc) pc.dispatchEvent(new Event('input', { bubbles: true }));
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
  controls.classList.add('visible');
  const controlsWidth = controls.offsetWidth || 1;
  controls.style.left = (rect.right / z - controlsWidth - 4) + 'px';
  controls.style.top = (rect.top / z + 4) + 'px';
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(controls);
  resizeHandle.style.left = (rect.right / z - 7) + 'px';
  resizeHandle.style.top = (rect.bottom / z - 7) + 'px';
  resizeHandle.classList.add('visible');
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(resizeHandle);
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
    let caret = el.querySelector('.drop-caret');
    if (!caret) { caret = document.createElement('div'); caret.className = 'drop-caret'; el.style.position = 'relative'; el.appendChild(caret); }
    const range = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
    if (range) {
      const rects = range.getClientRects();
      const elRect = el.getBoundingClientRect();
      if (rects.length > 0) {
        caret.style.top = (rects[0].bottom - elRect.top + el.scrollTop) + 'px';
      } else {
        caret.style.top = (e.clientY - elRect.top + el.scrollTop) + 'px';
      }
      caret.style.display = '';
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
    const cfData = e.dataTransfer.getData('application/x-meldex-node');
    if (cfData) {
      try {
        const { name, path, type } = JSON.parse(cfData);
        if (type === 'image' || type === 'video' || type === 'audio') {
          // 画像/動画/音声: メディア埋め込みを挿入
          const ext = (path || '').split('.').pop().toLowerCase();
          const isImage = ['png','jpg','jpeg','gif','bmp','webp','svg','ico','avif'].includes(ext) || type === 'image';
          if (isImage) {
            const imgUrl = '/api/file-raw?path=' + encodeURIComponent(path);
            document.execCommand('insertHTML', false,
              `<div class="embed-media" contenteditable="false" data-path="${esc(path)}" data-name="${esc(name)}"><img src="${imgUrl}" alt="${esc(name)}"></div>`);
          } else {
            // 動画/音声: リンクとして挿入
            document.execCommand('insertHTML', false,
              `<span class="auto-link" data-path="${esc(path)}" style="color:var(--accent);text-decoration:underline;cursor:pointer;">${lucide('paperclip',12)} ${esc(name)}</span> `);
          }
        } else {
          // その他: リンク+Lucideアイコンとして挿入
          const icon = type === 'database' ? 'database' : type === 'entity' ? 'fileSpreadsheet' : type === 'scenario' ? 'fileText' : type === 'board' ? 'layout' : 'file';
          document.execCommand('insertHTML', false,
            `<span class="auto-link" data-path="${esc(path)}" style="color:var(--accent);text-decoration:underline;cursor:pointer;">${lucide(icon,12)} ${esc(name)}</span> `);
        }
      } catch(err) {}
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
    e.dataTransfer.setData('application/x-meldex-text', JSON.stringify({
      text, sourcePath: el.dataset.path || ''
    }));
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
function updateNoteToc() {
  const pc = document.getElementById('page-content');
  const toc = document.getElementById('note-toc');
  if (!pc || !toc) return;

  const headings = pc.querySelectorAll('h1, h2, h3, h4, h5, h6');
  if (headings.length === 0) {
    toc.innerHTML = '<div style="color:var(--fg2);padding:4px;">見出しがありません</div>';
    return;
  }

  let html = '';
  headings.forEach((h, i) => {
    const level = parseInt(h.tagName[1]);
    const indent = (level - 1) * 12;
    const text = h.textContent.trim() || '(無題)';
    html += `<button type="button" class="note-toc-item note-toc-level-${level}" data-note-toc-level="${level}" data-note-toc-index="${i}" style="display:block;width:100%;padding:2px 4px 2px ${indent}px;cursor:pointer;border:0;background:transparent;text-align:left;font:inherit;border-radius:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${level===1?'var(--accent)':'var(--fg)'};"
      title="${esc(text)}">${esc(text)}</button>`;
  });
  toc.innerHTML = html;
  toc.querySelectorAll('[data-note-toc-index]').forEach(item => {
    item.addEventListener('mouseenter', () => { item.style.background = 'var(--bg4)'; });
    item.addEventListener('mouseleave', () => { item.style.background = ''; });
    item.addEventListener('click', () => {
      const index = Number(item.dataset.noteTocIndex);
      const target = document.querySelectorAll('#page-content h1,#page-content h2,#page-content h3,#page-content h4,#page-content h5,#page-content h6')[index];
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

/* ==============================
   エントリページ描画 (グリッド + 編集 UI + D&D 並べ替え + 親DBリンク)
   ============================== */
function _entityParentDir(entityPath) {
  if (!entityPath) return '';
  const i = entityPath.lastIndexOf('/');
  return i >= 0 ? entityPath.substring(0, i) : '';
}

function _entityPropControlId(prefix, propName) {
  const suffix = Array.from(String(propName || 'property'))
    .map(ch => /[A-Za-z0-9_-]/.test(ch) ? ch : ch.codePointAt(0).toString(16))
    .join('-')
    .replace(/-+/g, '-')
    .slice(0, 80) || 'property';
  return `${prefix}-${suffix}`;
}

// エントリ単位のプロパティ並び順 (DB ごとに共有)
function getEntryPropOrder(dbPath) {
  if (typeof getDbViewConfig !== 'function' || !dbPath) return null;
  return getDbViewConfig(dbPath).entryPropOrder || null;
}
function setEntryPropOrder(dbPath, order) {
  if (typeof getDbViewConfig !== 'function' || !dbPath) return;
  const c = getDbViewConfig(dbPath);
  c.entryPropOrder = order;
  if (typeof saveDbViewConfig === 'function') saveDbViewConfig(dbPath, c);
}

function _showEntryPropInlineAdd(valuesEl, grid, data, entityPath, propName, options) {
  const opts = options || {};
  const parentDb = opts.parentDb || _entityParentDir(entityPath);
  const lockMsg = parentDb && typeof checkColumnEditable === 'function'
    ? checkColumnEditable(parentDb, propName)
    : '';
  if (lockMsg) { showStatus(lockMsg); return; }
  if (!valuesEl || valuesEl.querySelector('.entry-prop-inline-add')) {
    valuesEl?.querySelector?.('.entry-prop-inline-add input')?.focus();
    return;
  }
  if (parentDb && typeof getStatusEnabled === 'function' && !getStatusEnabled(parentDb) && valuesEl.querySelector('.cell-value')) {
    showStatus('このシートは1セル1値運用です（ステータス機能オフ）');
    return;
  }

  const statusOn = !parentDb || typeof getStatusEnabled !== 'function' || getStatusEnabled(parentDb);
  const row = document.createElement('div');
  row.className = 'entry-prop-inline-add';
  row.style.cssText = 'display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:4px;';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = '値を入力';
  input.style.cssText = 'flex:1 1 160px;min-width:120px;padding:3px 6px;background:var(--bg2);color:var(--fg);border:1px solid var(--accent);border-radius:3px;font-size:12px;';
  row.appendChild(input);

  let statusSelect = null;
  if (statusOn) {
    statusSelect = document.createElement('select');
    statusSelect.style.cssText = 'width:auto;padding:3px 6px;font-size:12px;';
    ['案', '採用', 'ボツ', '掲載済み'].forEach(status => {
      const opt = document.createElement('option');
      opt.value = status;
      opt.textContent = status;
      if (status === '案') opt.selected = true;
      statusSelect.appendChild(opt);
    });
    row.appendChild(statusSelect);
  }

  const noteInput = document.createElement('input');
  noteInput.type = 'text';
  noteInput.placeholder = '備考';
  noteInput.style.cssText = 'flex:1 1 120px;min-width:100px;padding:3px 6px;background:var(--bg2);color:var(--fg);border:1px solid var(--border);border-radius:3px;font-size:12px;';
  row.appendChild(noteInput);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'gb-btn gb-btn-sm';
  saveBtn.title = '候補値を追加';
  saveBtn.setAttribute('aria-label', '候補値を追加');
  saveBtn.innerHTML = typeof lucide === 'function' ? lucide('check', 14) : '追加';
  row.appendChild(saveBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'gb-btn gb-btn-sm';
  cancelBtn.title = 'キャンセル';
  cancelBtn.setAttribute('aria-label', 'キャンセル');
  cancelBtn.innerHTML = typeof lucide === 'function' ? lucide('x', 14) : '取消';
  row.appendChild(cancelBtn);

  const cancel = () => row.remove();
  const submit = async () => {
    const value = input.value.trim();
    if (!value) { showStatus('値を入力してください', true); input.focus(); return; }
    const status = statusSelect ? statusSelect.value : '採用';
    const note = noteInput.value.trim();
    saveBtn.disabled = true;
    try {
      await _apiPostValue(entityPath, propName, value, status, note);
      showStatus('候補値を追加しました');
      const fresh = await apiFetch('/entity?path=' + encodeURIComponent(entityPath)).catch(() => null);
      if (fresh && fresh.properties) {
        renderEntityPropsGridInto(grid, fresh, entityPath, opts);
      } else {
        if (!Array.isArray(data.properties[propName])) data.properties[propName] = [];
        data.properties[propName].push({ property: propName, value, status, note, file: entityPath });
        renderEntityPropsGridInto(grid, data, entityPath, opts);
      }
    } catch (e) {
      saveBtn.disabled = false;
      showStatus('候補値の追加に失敗しました', true);
    }
  };

  saveBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', cancel);
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  valuesEl.appendChild(row);
  input.focus();
}

// プロパティグリッドを指定 container に描画する共通関数 (entity-view と詳細パネルで共有)
function renderEntityPropsGridInto(grid, data, entityPath, options) {
  if (!grid) return;
  const opts = options || {};
  const parentDb = opts.parentDb || _entityParentDir(entityPath);
  const propTypes = opts.propTypes || (typeof getPropertyTypes === 'function' ? getPropertyTypes(parentDb) : null) || {};
  const allProps = Object.keys(data.properties || {});
  const layout = typeof getPropertyLayout === 'function'
    ? getPropertyLayout(parentDb, allProps)
    : { order: getEntryPropOrder(parentDb) || [...allProps].sort(), hidden: [], groups: [] };
  const groupedProps = typeof applyPropertyLayout === 'function'
    ? applyPropertyLayout(allProps, layout)
    : [{ title: '', props: layout.order || allProps }];
  const propNames = groupedProps.flatMap(group => group.props || []);
  const layoutEditMode = typeof isPropertyLayoutEditMode === 'function' && isPropertyLayoutEditMode(parentDb);
  grid.innerHTML = '';
  // grid container にもクラスを付けて CSS が当たるように
  grid.classList.add('entity-props-grid-container');

  // 開閉状態・列幅は dbPath (エントリの親フォルダ) 単位で view_config に保存する。
  // フルページ/サブパネル/モバイルドロワーいずれもこの共通関数を経由するため自動的に反映される。
  const viewState = typeof _entityPropsViewState === 'function'
    ? _entityPropsViewState(parentDb, entityPath)
    : { collapsed: false, colWidth: 300 };
  grid.style.setProperty('--entity-prop-col-width', viewState.colWidth + 'px');
  // ヘッダーの表示可否は「プロパティが1つも定義されていないか」で判定する (allProps基準)。
  // レイアウト編集で全プロパティを非表示にしただけの場合はヘッダー(と並び替えツールバーへの導線)を残す。
  if (typeof _buildEntityPropsHeader === 'function') {
    grid.appendChild(_buildEntityPropsHeader(grid, data, entityPath, options, parentDb, allProps.length > 0, viewState));
  }

  // プロパティ本体 (並び替えツールバー + グループ見出し + カード)。閉じている間は丸ごと隠す。
  // display:contents にすることで、このラッパー自体はグリッドのレイアウトに関与せず、
  // 子要素 (カード等) が引き続き外側グリッドの直接の子として複数列に配置される。
  const body = document.createElement('div');
  body.className = 'entity-props-body';
  body.dataset.e2eId = 'entity-props-body';
  body.style.display = viewState.collapsed ? 'none' : 'contents';
  grid.appendChild(body);

  if (typeof renderPropertyLayoutToolbar === 'function') {
    renderPropertyLayoutToolbar(grid, data, entityPath, options, body);
  }
  groupedProps.forEach(group => {
    if (group.title) {
      const title = document.createElement('h4');
      title.className = 'gb-prop-group-title';
      title.textContent = group.title;
      body.appendChild(title);
    }
    (group.props || []).forEach(propName => {
    const card = document.createElement('div');
    card.className = 'entry-prop-card' + (layoutEditMode ? ' layout-editing' : '');
    card.dataset.propName = propName;
    card.draggable = layoutEditMode;
    const nameEl = document.createElement('div');
    nameEl.className = 'entry-prop-name';
    nameEl.textContent = (layoutEditMode ? '☰ ' : '') + propName;
    card.appendChild(nameEl);
    const valuesEl = document.createElement('div');
    valuesEl.className = 'entry-prop-values cell-values';
    const values = filterValues(data.properties[propName] || []);
    const ptc = propTypes[propName];
    const renderValues = (ptc?.type === 'image' && values.length === 0)
      ? [{ value: '', status: '採用', file: entityPath, property: propName, candidate_index: null }]
      : values;
    renderValues.forEach(val => {
      let valEl;
      if (typeof createTypedValueElement === 'function' && ptc) {
        valEl = createTypedValueElement(val, entityPath, propName, 'small', ptc);
      } else if (typeof createValueElement === 'function') {
        valEl = createValueElement(val, entityPath, propName);
      }
      if (valEl) valuesEl.appendChild(valEl);
      if (val.relations && val.relations.length > 0) {
        const relDiv = document.createElement('div');
        relDiv.className = 'relation-links';
        relDiv.style.marginLeft = '12px';
        val.relations.forEach(r => {
          const link = document.createElement('span');
          link.className = 'relation-link';
          link.textContent = (r.entity || '') + (r.role ? ' (' + r.role + ')' : '');
          link.addEventListener('click', (e) => { e.stopPropagation(); navigateToEntity(r.entity); });
          relDiv.appendChild(link);
        });
        valuesEl.appendChild(relDiv);
      }
    });
    if (layoutEditMode) {
      const hideBtn = document.createElement('button');
      hideBtn.type = 'button';
      hideBtn.className = 'gb-prop-hide-btn';
      hideBtn.title = '列一覧から非表示';
      hideBtn.dataset.e2eId = _entityPropControlId('entity-prop-hide', propName);
      hideBtn.dataset.propName = propName;
      hideBtn.innerHTML = typeof lucide === 'function' ? lucide('eyeOff', 12) : '非表示';
      hideBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const next = typeof getPropertyLayout === 'function' ? getPropertyLayout(parentDb, allProps) : layout;
        next.hidden = Array.from(new Set([...(next.hidden || []), propName]));
        if (!await savePropertyLayout(parentDb, next)) return;
        renderEntityPropsGridInto(grid, data, entityPath, options);
      });
      valuesEl.appendChild(hideBtn);
    }
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'cell-add-btn';
    addBtn.dataset.e2eId = _entityPropControlId('entity-prop-add', propName);
    addBtn.dataset.propName = propName;
    addBtn.innerHTML = typeof lucide === 'function' ? lucide('plus', 14) : '+';
    addBtn.title = '候補値を追加';
    addBtn.setAttribute('aria-label', '候補値を追加');
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      _showEntryPropInlineAdd(valuesEl, grid, data, entityPath, propName, options);
    });
    valuesEl.appendChild(addBtn);
    card.appendChild(valuesEl);

    // D&D 並べ替え (DB 単位の順序保存。同 DB のすべてのエントリ表示で共有)
    card.addEventListener('dragstart', (e) => {
      if (!layoutEditMode) return;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/x-meldex-entry-prop', propName);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      grid.querySelectorAll('.entry-prop-card.drag-over-left, .entry-prop-card.drag-over-right')
        .forEach(el => el.classList.remove('drag-over-left', 'drag-over-right'));
    });
    card.addEventListener('dragover', (e) => {
      if (!layoutEditMode) return;
      if (!e.dataTransfer.types.includes('text/x-meldex-entry-prop')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = card.getBoundingClientRect();
      const isLeft = (e.clientX - rect.left) < rect.width / 2;
      card.classList.toggle('drag-over-left', isLeft);
      card.classList.toggle('drag-over-right', !isLeft);
    });
    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over-left', 'drag-over-right');
    });
    card.addEventListener('drop', async (e) => {
      if (!layoutEditMode) return;
      e.preventDefault();
      const fromName = e.dataTransfer.getData('text/x-meldex-entry-prop');
      const isLeft = card.classList.contains('drag-over-left');
      card.classList.remove('drag-over-left', 'drag-over-right');
      if (!fromName || fromName === propName) return;
      const arr = propNames.filter(n => n !== fromName);
      const idx = arr.indexOf(propName);
      const insertIdx = idx >= 0 ? idx + (isLeft ? 0 : 1) : arr.length;
      arr.splice(insertIdx, 0, fromName);
      if (parentDb) {
        const next = typeof getPropertyLayout === 'function' ? getPropertyLayout(parentDb, allProps) : { order: arr, hidden: [], groups: [] };
        next.order = arr;
        if (typeof savePropertyLayout === 'function' && !await savePropertyLayout(parentDb, next)) return;
        else setEntryPropOrder(parentDb, arr);
      }
      // 同じ container を再描画 (entity-view からも詳細パネルからも呼べる)
      renderEntityPropsGridInto(grid, data, entityPath, options);
    });
    body.appendChild(card);
  });
  });
}

async function _saveEntityFreeText(ep, md) {
  const res = ep.endsWith('.md')
    ? await apiPut('/value?path=' + encodeURIComponent(ep), { new_body: md, skip_if_missing: true })
    : await apiPut('/file?path=' + encodeURIComponent(ep + '/_freetext.md'), { content: md, skip_if_missing: true });
  if (typeof _handleFreeTextSkippedMissingSave === 'function' && _handleFreeTextSkippedMissingSave(res)) return false;
  return true;
}

function _setEntityCreateActionButton(button, iconName, label) {
  if (!button) return;
  button.type = 'button';
  button.className = 'entity-create-action-btn';
  button.setAttribute('aria-label', label);
  button.textContent = '';
  if (typeof lucide === 'function') {
    const icon = document.createElement('span');
    icon.className = 'entity-create-action-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = lucide(iconName, 14);
    button.appendChild(icon);
  }
  const text = document.createElement('span');
  text.className = 'entity-create-action-label';
  text.textContent = label;
  button.appendChild(text);
}

function renderEntityPage(data) {
  // data = {entity, properties: {propName: [{value, status, note, file, ...}]}, page_content}
  document.getElementById('entity-title').textContent = data.entity || '';

  const entityPath = state.currentEntityPath;
  const parentDb = _entityParentDir(entityPath);

  // 親 DB へのリンク
  const linkBox = document.getElementById('entity-parent-link');
  if (linkBox) {
    linkBox.innerHTML = '';
    if (parentDb) {
      const parentName = parentDb.split('/').pop() || parentDb;
      const a = document.createElement('a');
      a.textContent = '← ' + parentName;
      a.title = parentDb;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof selectDatabase === 'function') selectDatabase(parentDb);
      });
      linkBox.appendChild(a);
    }
  }

  // プロパティグリッド描画 (共通関数を使用)
  const grid = document.getElementById('entity-props-grid');
  if (grid) {
    renderEntityPropsGridInto(grid, data, entityPath, { parentDb });
  }

  // ノートエリア (entity-freetext): page_content が空なら隠して「ノートを作成」ボタン表示
  const ft = document.getElementById('entity-freetext');
  const noteBtnBox = document.getElementById('entity-create-note-btn');
  const rtToolbar = document.getElementById('entity-rt-toolbar');
  const rawContent = data.page_content || '';
  const hasNote = rawContent.trim() !== '';
  if (ft) ft.dataset.entityNoteCreated = hasNote ? '1' : '0';
  if (noteBtnBox) {
    noteBtnBox.innerHTML = '';
    const chatBtn = document.createElement('button');
    _setEntityCreateActionButton(chatBtn, 'messageSquare', 'チャットを作成');
    chatBtn.dataset.e2eId = 'entity-create-chat';
    chatBtn.addEventListener('click', () => {
      if (typeof window.openEntityChatForPath === 'function') {
        window.openEntityChatForPath(entityPath);
      } else if (typeof openFileChat === 'function') {
        openFileChat(entityPath);
      }
    });
    if (!hasNote) {
      ft.style.display = 'none';
      if (rtToolbar) rtToolbar.style.display = 'none';
      const btn = document.createElement('button');
      _setEntityCreateActionButton(btn, 'filePlus', 'ノートを作成');
      btn.dataset.e2eId = 'entity-create-note';
      btn.addEventListener('click', () => {
        // ノートを作成: 空のコンテンツで初期化、エディタを表示
        ft.style.display = '';
        ft.dataset.entityNoteCreated = '1';
        if (rtToolbar) rtToolbar.style.display = '';
        ft.innerHTML = '<p><br></p>';
        noteBtnBox.style.display = 'none';
        // 即時保存 (空ノートを作成)
        const ep = ft.dataset.entityPath;
        if (ep) {
          _saveEntityFreeText(ep, '').catch(() => { showStatus('自由記述の作成に失敗しました', true); });
        }
        ft.focus();
      });
      noteBtnBox.appendChild(btn);
      noteBtnBox.appendChild(chatBtn);
      noteBtnBox.style.display = '';
    } else {
      noteBtnBox.appendChild(chatBtn);
      noteBtnBox.style.display = '';
      ft.style.display = '';
      if (rtToolbar) rtToolbar.style.display = '';
    }
  }

  // Free text (with auto-links)
  ft.dataset.entityPath = entityPath;
  // Markdown→HTML変換してからauto-link適用 (rawContent は冒頭で取得済み)
  if (hasNote) {
    const ftHtml = applyAutoLinks(mdToHtml(rawContent), entityPath);
    ft.innerHTML = ftHtml;
  } else {
    // ノート未作成時はエディタ自体を非表示にしているため innerHTML 不要
    ft.innerHTML = '';
  }

  if (ft._autoLinkHandler) ft.removeEventListener('click', ft._autoLinkHandler);
  if (ft._autoLinkDblHandler) { ft.removeEventListener('dblclick', ft._autoLinkDblHandler); ft._autoLinkDblHandler = null; }
  ft._autoLinkHandler = function(e) {
    const link = e.target.closest('.auto-link');
    if (link) { e.preventDefault(); onAutoLinkClick(link, e); }
  };
  ft.addEventListener('click', ft._autoLinkHandler);

  // 自動保存タイマー（2秒デバウンス）
  ft.oninput = function() {
    clearTimeout(window._ftAutoSaveTimer);
    window._ftAutoSaveTimer = setTimeout(() => {
      if (ft.textContent.trim() === '自由記述エリア（クリックして編集）') return;
      const md = htmlToMd(ft.innerHTML);
      const ep = ft.dataset.entityPath;
      if (!ep) return;
      _saveEntityFreeText(ep, md).catch(() => { showStatus('自由記述の自動保存に失敗しました', true); });
    }, 2000);
  };

  ft.onblur = async function() {
    clearTimeout(window._ftAutoSaveTimer);
    if (this.textContent.trim() === '自由記述エリア（クリックして編集）') return;
    // 検索ハイライトのmarkタグを除去
    this.querySelectorAll('mark.file-search-highlight').forEach(m => m.replaceWith(...m.childNodes));
    this.normalize();

    const md = htmlToMd(this.innerHTML);

    const ep = this.dataset.entityPath;
    if (!ep) return;
    try {
      const saved = await _saveEntityFreeText(ep, md);
      if (!saved) return;
      showStatus('自由記述を保存しました', false, { passiveSave: true });
      this.innerHTML = applyAutoLinks(mdToHtml(md), ep);
    } catch (e) { showStatus('自由記述の保存に失敗しました', true); }
  };

  // DBアクションボタン + バックリンク表示（gb-db-actions.js）
  if (typeof _renderEntityActions === 'function') _renderEntityActions(data, entityPath);
  if (typeof _renderEntityBacklinks === 'function') _renderEntityBacklinks(data, entityPath);
}

/* ==============================
   カスタムアンドゥ（execCommandが効かないDOM操作用）
   ============================== */
/* ヒストリー（Undo/Redo）→ gb-history.js に移動 */

// 既存のcontenteditable用カスタムundo
const _CUSTOM_UNDO_MAX = 50;
function _pushCustomUndo(editable) {
  if (!editable._customUndoStack) editable._customUndoStack = [];
  if (!editable._customRedoStack) editable._customRedoStack = [];
  editable._customUndoStack.push(editable.innerHTML);
  if (editable._customUndoStack.length > _CUSTOM_UNDO_MAX) editable._customUndoStack.shift();
  editable._customRedoStack.length = 0; // redo履歴をクリア
  editable._lastCustomOp = true;
  editable._customUndoInputPending = true;
}

let _customUndoInProgress = false; // dispatchEvent中のinputリスナーを抑制
document.addEventListener('keydown', function(e) {
  if (!e.ctrlKey) return;
  const editable = document.activeElement;
  if (!editable || editable.contentEditable !== 'true') return;

  // Ctrl+Z: カスタムアンドゥ（直前がカスタム操作の場合のみ）
  if (e.key === 'z' && !e.shiftKey && editable._lastCustomOp && editable._customUndoStack && editable._customUndoStack.length > 0) {
    e.preventDefault();
    editable._customRedoStack.push(editable.innerHTML);
    editable.innerHTML = editable._customUndoStack.pop();
    editable._lastCustomOp = editable._customUndoStack.length > 0;
    _customUndoInProgress = true;
    editable.dispatchEvent(new Event('input', { bubbles: true }));
    _customUndoInProgress = false;
    return;
  }
  // Ctrl+Y / Ctrl+Shift+Z: カスタムリドゥ
  if ((e.key === 'y' || (e.key === 'z' && e.shiftKey)) && editable._customRedoStack && editable._customRedoStack.length > 0) {
    e.preventDefault();
    editable._customUndoStack.push(editable.innerHTML);
    editable.innerHTML = editable._customRedoStack.pop();
    editable._lastCustomOp = true;
    _customUndoInProgress = true;
    editable.dispatchEvent(new Event('input', { bubbles: true }));
    _customUndoInProgress = false;
    return;
  }
}, true); // captureフェーズで先に処理

// 通常の入力でカスタムフラグをクリア（以降のCtrl+Zはネイティブアンドゥに委譲）
document.addEventListener('input', function(e) {
  if (_customUndoInProgress) return; // カスタムundo/redoの自動保存トリガーは無視
  const editable = e.target;
  if (editable && editable.contentEditable === 'true') {
    if (editable._customUndoInputPending) {
      editable._customUndoInputPending = false;
      editable._lastCustomOp = true;
      return;
    }
    editable._lastCustomOp = false;
  }
});

/* ==============================
   リッチテキスト
   ============================== */
let rtTarget = null;
let rtSavedSelection = null;

function _rtEditableFromNode(node) {
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  const editable = el?.closest?.('#page-content, #entity-freetext, #dp-editable') || null;
  if (!editable || editable.contentEditable !== 'true') return null;
  return editable;
}

function _rtSelectionEditable(range) {
  const editable = _rtEditableFromNode(range?.commonAncestorContainer);
  if (!editable || !range) return null;
  if (!editable.contains(range.startContainer) || !editable.contains(range.endContainer)) return null;
  return editable;
}

function rtCaptureSelectionFromToolbar() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0).cloneRange();
  const editable = _rtSelectionEditable(range);
  if (!editable) return false;
  rtSavedSelection = range;
  rtTarget = editable;
  return true;
}

function rtRestoreSelection() {
  if (rtTarget && !rtTarget.isConnected) {
    rtTarget = null;
    rtSavedSelection = null;
    return;
  }
  if (rtTarget) rtTarget.focus();
  if (rtSavedSelection && _rtSelectionEditable(rtSavedSelection)) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(rtSavedSelection);
  }
}

function _rtEnsureEditableSelection() {
  rtRestoreSelection();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const editable = _rtSelectionEditable(range);
  if (!editable) return null;
  rtTarget = editable;
  rtSavedSelection = range.cloneRange();
  return editable;
}

function _rtBlockAtSelection(editable) {
  const sel = window.getSelection();
  if (!editable || !sel || sel.rangeCount === 0) return null;
  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  const block = node?.closest?.('h1,h2,h3,h4,h5,h6,p,div,blockquote,pre,li');
  if (!block || block === editable || !editable.contains(block)) return null;
  if (block.tagName === 'PRE' || block.closest('table, pre, code')) return null;
  return block;
}

function _rtReplaceBlockTag(block, tag) {
  if (!block || block.tagName === tag) return block;
  const next = document.createElement(tag.toLowerCase());
  while (block.firstChild) next.appendChild(block.firstChild);
  block.replaceWith(next);
  return next;
}

function _rtPlaceCaretInBlock(block) {
  if (!block) return;
  if (!block.childNodes.length) block.appendChild(document.createElement('br'));
  const range = document.createRange();
  range.selectNodeContents(block);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  rtSavedSelection = range.cloneRange();
}

function _rtDispatchEditableInput(editable) {
  if (!editable) return;
  editable.dispatchEvent(new Event('input', { bubbles: true }));
  const toc = document.getElementById('note-toc');
  if (toc && toc.style.display !== 'none' && typeof updateNoteToc === 'function') updateNoteToc();
}

function _rtClearNoteTitleAtSelection(editable) {
  const block = _rtBlockAtSelection(editable);
  if (!block) return;
  block.classList.remove('note-title');
  delete block.dataset.noteTitle;
}

function _rtApplyNoteTitle() {
  const editable = _rtEnsureEditableSelection();
  if (!editable) return;
  if (typeof _pushCustomUndo === 'function') _pushCustomUndo(editable);
  let block = _rtBlockAtSelection(editable);
  if (!block) {
    document.execCommand('formatBlock', false, 'H1');
    block = _rtBlockAtSelection(editable);
  }
  if (!block) return;
  block = _rtReplaceBlockTag(block, 'H1');
  block.classList.add('note-title');
  block.dataset.noteTitle = '1';
  _rtPlaceCaretInBlock(block);
  _rtDispatchEditableInput(editable);
}

function rtCmd(cmd, value) {
  const editable = _rtEnsureEditableSelection();
  if (!editable) return;
  document.execCommand(cmd, false, value || null);
  if (cmd === 'formatBlock') _rtClearNoteTitleAtSelection(editable);
}

function rtColor(cmd, value) {
  if (!_rtEnsureEditableSelection()) return;
  document.execCommand(cmd, false, value);
}

function openRtColorPalette(anchorEl, cmd) {
  if (!anchorEl || typeof openColorPalette !== 'function') return;
  const currentColor = getColorSwatchValue(anchorEl, anchorEl.dataset.rtColor || '');
  openColorPalette(anchorEl, currentColor, (color) => {
    const appliedColor = color || anchorEl.dataset.rtColor || (cmd === 'hiliteColor' ? '#1e1e1e' : '#d4d4d4');
    document.querySelectorAll(`.rt-color-swatch[data-rt-cmd="${cmd}"]`).forEach((swatch) => {
      swatch.dataset.rtColor = appliedColor;
      setColorSwatchValue(swatch, appliedColor);
    });
    rtColor(cmd, appliedColor);
  });
}

function syncRtToolbarColorSwatches(root) {
  (root || document).querySelectorAll('.rt-color-swatch').forEach((swatch) => {
    const color = swatch.dataset.rtColor || getColorSwatchValue(swatch, '');
    setColorSwatchValue(swatch, color);
  });
}

function rtHeading(tag) {
  if (!tag) return;
  if (String(tag).toUpperCase() === 'TITLE') {
    _rtApplyNoteTitle();
    return;
  }
  const editable = _rtEnsureEditableSelection();
  if (!editable) return;
  document.execCommand('formatBlock', false, tag);
  _rtClearNoteTitleAtSelection(editable);
}

function showRtToolbar(show) {
  const el = document.getElementById('rt-toolbar');
  if (el) el.style.display = show ? '' : 'none';
}

setTimeout(() => syncRtToolbarColorSwatches(), 0);

// === コールアウトブロック ===
const CALLOUT_PRESETS = [
  { icon: 'lightbulb', color: '#e6a700', type: '', label: 'ヒント' },
  { icon: 'circleAlert', color: '#3898ec', type: 'info', label: '情報' },
  { icon: 'alertTriangle', color: '#ecb438', type: 'warning', label: '注意' },
  { icon: 'zap', color: '#ec3838', type: 'danger', label: '重要' },
  { icon: 'checkSquare', color: '#38b450', type: 'success', label: '完了' },
  { icon: 'pencil', color: '', type: '', label: '注釈' },
  { icon: 'messageSquare', color: '#9b59b6', type: '', label: '考察' },
  { icon: 'crosshair', color: '#e67e22', type: '', label: '目標' },
  { icon: 'mapPin', color: '#e74c3c', type: '', label: 'ピン' },
  { icon: 'bookmark', color: '#1abc9c', type: '', label: 'ブックマーク' },
];

function insertNoteTable(rows = 3, cols = 3) {
  const editable = document.activeElement?.closest('#page-content, #entity-freetext, #dp-editable')
                || document.getElementById('page-content');
  if (!editable) return;
  editable.focus();
  // 既存セレクションがあればそこに挿入、無ければ末尾に追加
  let html = '<table><thead><tr>';
  for (let c = 0; c < cols; c++) html += '<th>列' + (c + 1) + '</th>';
  html += '</tr></thead><tbody>';
  for (let r = 0; r < rows - 1; r++) {
    html += '<tr>';
    for (let c = 0; c < cols; c++) html += '<td></td>';
    html += '</tr>';
  }
  html += '</tbody></table><p><br></p>';
  // execCommand で挿入 (undo 対応)
  if (document.queryCommandSupported && document.queryCommandSupported('insertHTML')) {
    document.execCommand('insertHTML', false, html);
  } else {
    editable.insertAdjacentHTML('beforeend', html);
  }
  editable.dispatchEvent(new Event('input'));
}

function insertCallout() {
  const editable = document.activeElement?.closest('#page-content, #entity-freetext, #dp-editable');
  if (!editable) return;
  const insertRange = (rtTarget === editable && rtSavedSelection && _rtSelectionEditable(rtSavedSelection))
    ? rtSavedSelection.cloneRange()
    : null;
  const btns = document.querySelectorAll('[data-action="insertCallout()"]');
  let btn = null;
  for (const b of btns) { if (b.offsetParent !== null) { btn = b; break; } }
  if (typeof GBIconAssets === 'undefined') {
    _insertCalloutBlock(editable, 'lightbulb', '', '#e6a700', insertRange);
    return;
  }
  GBIconAssets.openPicker({
    title: 'コールアウトアイコン',
    className: 'callout-picker',
    anchorEl: btn || editable,
    includeLucide: true,
    includeNoto: true,
    presets: CALLOUT_PRESETS.map((p) => ({ ...p, spec: p.icon })),
    onSelect: (spec, item) => {
      _insertCalloutBlock(editable, spec, item?.type || '', item?.color || '', insertRange);
    },
  });
}

function _insertCalloutBlock(editable, iconName, type, color, insertRange) {
  editable.focus();
  if (insertRange && _rtSelectionEditable(insertRange)) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(insertRange);
  }
  const cls = type ? ' callout-' + type : '';
  const colorStyle = color ? ' style="color:' + esc(color) + ';"' : '';
  const spec = typeof GBIconAssets !== 'undefined' ? GBIconAssets.normalizeSpec(iconName || 'lightbulb') : iconName;
  const iconHtml = typeof GBIconAssets !== 'undefined' ? GBIconAssets.render(spec, 20) : lucide(iconName, 20);
  const html = `<div class="callout-block${cls}" contenteditable="false"><span class="callout-icon" data-icon="${esc(spec)}"${color ? ' data-color="' + esc(color) + '"' : ''} title="アイコンをクリックして変更"${colorStyle}>${iconHtml}</span><div class="callout-body" contenteditable="true">ここにテキストを入力...</div></div><p><br></p>`;
  document.execCommand('insertHTML', false, html);
  setTimeout(() => {
    const blocks = editable.querySelectorAll('.callout-block');
    const last = blocks[blocks.length - 1];
    if (last) {
      const body = last.querySelector('.callout-body');
      if (body) { body.focus(); const s = window.getSelection(); s.selectAllChildren(body); s.collapseToEnd(); }
    }
  }, 50);
}

function _calloutPresetForSpec(spec) {
  if (typeof GBIconAssets === 'undefined') {
    return CALLOUT_PRESETS.find(p => p.icon === spec) || null;
  }
  return CALLOUT_PRESETS.find(p => GBIconAssets.sameSpec(p.icon, spec)) || null;
}

function _dispatchCalloutInput(iconEl) {
  const editable = iconEl?.closest?.('#page-content, #entity-freetext, #dp-editable');
  if (editable) editable.dispatchEvent(new Event('input', { bubbles: true }));
}

// コールアウトアイコンクリックで変更（Lucide + Noto Emoji + 色選択）
document.addEventListener('click', (e) => {
  const iconEl = e.target.closest('.callout-icon');
  if (!iconEl) return;
  e.preventDefault();
  if (typeof GBIconAssets === 'undefined') return;

  function applyIcon(spec, color) {
    const normalized = GBIconAssets.normalizeSpec(spec);
    iconEl.innerHTML = GBIconAssets.render(normalized, 20);
    iconEl.dataset.icon = normalized;
    iconEl.dataset.color = color || '';
    iconEl.style.color = color || '';
    const block = iconEl.closest('.callout-block');
    // プリセットに一致するtypeがあれば適用
    if (block) {
      const preset = _calloutPresetForSpec(normalized);
      block.className = 'callout-block' + (preset?.type ? ' callout-' + preset.type : '');
    }
    _dispatchCalloutInput(iconEl);
  }

  GBIconAssets.openPicker({
    title: 'コールアウトアイコン',
    className: 'callout-picker',
    anchorEl: iconEl,
    current: iconEl.dataset.icon || '',
    includeLucide: true,
    includeNoto: true,
    presets: CALLOUT_PRESETS.map((p) => ({ ...p, spec: p.icon })),
    onSelect: (spec, item) => applyIcon(spec, item?.color || iconEl.dataset.color || ''),
    extraFooter: () => {
      const colorWrap = document.createElement('div');
      colorWrap.style.cssText = 'padding-top:6px;border-top:1px solid var(--border);display:flex;align-items:center;gap:6px;flex-shrink:0;';
      colorWrap.innerHTML = '<span style="font-size:11px;color:var(--fg2);">色</span>';
      if (typeof createInlineColorGrid === 'function') {
        const curColor = iconEl.dataset.color || '';
        const cg = createInlineColorGrid(curColor, (c) => {
          iconEl.style.color = c || '';
          iconEl.dataset.color = c || '';
          _dispatchCalloutInput(iconEl);
        });
        cg.style.cssText += 'max-width:320px;';
        colorWrap.appendChild(cg);
      }
      return colorWrap;
    },
  });
});

// エントリ用リッチテキストツールバーを初期化（メインと同じボタン構成）
function _shouldAllowToolbarMouseDefault(target) {
  const editable = target?.closest?.('[contenteditable="true"], [contenteditable="plaintext-only"], [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
  if (editable) return true;
  const tag = target?.tagName;
  if (tag === 'SELECT' || tag === 'OPTION') return true;
  if (tag === 'INPUT') {
    const type = String(target.type || '').toLowerCase();
    return ['color', 'range', 'number', 'text', 'search'].includes(type);
  }
  if (tag === 'TEXTAREA') return true;
  return false;
}

(function() {
  const src = document.getElementById('rt-toolbar');
  const dst = document.getElementById('entity-rt-toolbar');
  if (!src || !dst) return;
  dst.innerHTML = src.innerHTML;
  // イベントを複製（data-actionはインラインなのでそのまま動く）
  // mousedownでフォーカスを奪わないようにする
  dst.addEventListener('mousedown', function(e) {
    rtCaptureSelectionFromToolbar();
    if (_shouldAllowToolbarMouseDefault(e.target)) return;
    e.preventDefault();
  });
})();

document.getElementById('rt-toolbar').addEventListener('mousedown', function(e) {
  rtCaptureSelectionFromToolbar();
  if (_shouldAllowToolbarMouseDefault(e.target)) return;
  e.preventDefault();
});

// page-view内の専用ツールバー（#page-rt-toolbar）にも同じmousedownハンドラ
{
  const pageRtTb = document.getElementById('page-rt-toolbar');
  if (pageRtTb) pageRtTb.addEventListener('mousedown', function(e) {
    rtCaptureSelectionFromToolbar();
    if (_shouldAllowToolbarMouseDefault(e.target)) return;
    e.preventDefault();
  });
}

document.addEventListener('focusin', function(e) {
  if (e.target.id === 'entity-freetext' || e.target.id === 'page-content' || e.target.id === 'dp-editable') {
    rtTarget = e.target;
  }
});
// ツールバーはshowViewで表示/非表示を制御（focusoutでは閉じない）

/* ==============================
   自動リンク
   ============================== */
// linkDict は MeldexAutoLink に委譲。互換性のためゲッターを提供
let linkDict = typeof MeldexAutoLink !== 'undefined' ? MeldexAutoLink.getDict() : [];

// 作品フォルダ設定
const WORK_FOLDER_KEY = 'outliner-work-folder';
const WORK_FOLDER_ID_KEY = 'outliner-work-folder-id';
function getWorkFolder() {
  // file_id から最新パスを解決（gb-app.js より先に呼ばれる可能性があるためガード）
  const fid = localStorage.getItem(WORK_FOLDER_ID_KEY);
  if (fid && typeof _fileIdToPath === 'function') {
    const resolved = _fileIdToPath(fid);
    if (resolved) return resolved;
  }
  return localStorage.getItem(WORK_FOLDER_KEY) || '';
}
function setWorkFolder(path) {
  if (path) {
    localStorage.setItem(WORK_FOLDER_KEY, path);
    const fid = typeof _pathToFileId === 'function' ? _pathToFileId(path) : '';
    if (fid) localStorage.setItem(WORK_FOLDER_ID_KEY, fid);
  } else {
    localStorage.removeItem(WORK_FOLDER_KEY);
    localStorage.removeItem(WORK_FOLDER_ID_KEY);
  }
}

async function loadLinkDict() {
  if (typeof MeldexAutoLink !== 'undefined') {
    await MeldexAutoLink.loadDict(getWorkFolder());
    linkDict = MeldexAutoLink.getDict();
  } else {
    try {
      const work = getWorkFolder();
      const url = work ? '/link-dict?work=' + encodeURIComponent(work) : '/link-dict';
      const data = await apiFetch(url);
      linkDict = data.entries || [];
    } catch (e) { linkDict = []; }
  }
}

function applyAutoLinks(html, filePath, options = {}) {
  if (typeof MeldexAutoLink !== 'undefined') return MeldexAutoLink.applyToHtml(html, filePath, options);
  return html;
}

function stripAutoLinks(html) {
  if (typeof MeldexAutoLink !== 'undefined') return MeldexAutoLink.stripFromHtml(html);
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('.auto-link').forEach(el => el.replaceWith(...el.childNodes));
  return div.innerHTML;
}

/* ==============================
   Markdown ↔ HTML 変換
   ============================== */
function mdToHtml(md) {
  if (!md) return '';
  // 改行コード正規化（CRLF→LF）
  md = md.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // フロントマター（YAML）を除去
  md = md.replace(/^---\n[\s\S]*?\n---\n?/, '');
  // 注釈用 line-id マーカーをセンチネル化。リスト/見出し/引用の場合はマーカー記号の直後へ、
  // その他は単独行としてブロック前に残し、末尾で span 化 → 隣接ブロックへ移送する。
  md = md.replace(/^<!--nl:([A-Za-z0-9_-]+)-->\r?\n([^\n]*)/gm, (m, id, nextLine) => {
    const sen = '\x02NLID:' + id + '\x02';
    const listM = nextLine.match(/^(\s*(?:[*\-+]|\d+\.)\s+)(.*)$/);
    if (listM) return listM[1] + sen + listM[2];
    const hM = nextLine.match(/^(#{1,6}\s+)(.*)$/);
    if (hM) return hM[1] + sen + hM[2];
    const qM = nextLine.match(/^(>\s*)(.*)$/);
    if (qM) return qM[1] + sen + qM[2];
    return sen + '\n' + nextLine;
  });

  const lines = md.split('\n');
  let html = '';
  let inCodeBlock = false, codeLang = '';
  let inTable = false, _tableRowCount = 0;
  let pendingTableLayout = null;
  let pendingNoteTitle = false;
  const headingSlugCounts = new Map();
  // リストネスト管理: スタックで深度・種別を追跡
  const listStack = []; // [{ type: 'ul'|'ol', indent: number }, ...]

  function closeListAll() {
    while (listStack.length > 0) {
      const t = listStack.pop();
      html += t.type === 'ul' ? '</ul>' : '</ol>';
    }
  }
  function adjustListDepth(indent, type) {
    // 現在の深度より浅くなった分だけ閉じる
    while (listStack.length > 0) {
      const top = listStack[listStack.length - 1];
      if (top.indent > indent) {
        listStack.pop();
        html += top.type === 'ul' ? '</ul>' : '</ol>';
      } else if (top.indent === indent && top.type !== type) {
        // 同深度でリスト種別が変わった場合は閉じて開き直す
        listStack.pop();
        html += top.type === 'ul' ? '</ul>' : '</ol>';
        break;
      } else {
        break;
      }
    }
    // スタックが空、または現在の深度より浅い場合は新しいリストを開く
    if (listStack.length === 0 || listStack[listStack.length - 1].indent < indent) {
      html += type === 'ul' ? '<ul>' : '<ol>';
      listStack.push({ type, indent });
    }
  }

  function splitMarkdownTableRow(line) {
    const cells = [];
    let cell = '';
    for (let i = 1; i < line.length - 1; i++) {
      const ch = line[i];
      if (ch === '\\' && i + 1 < line.length - 1) {
        const next = line[i + 1];
        if (next === '|') { cell += '|'; i++; continue; }
        cell += ch + next; i++; continue;
      }
      if (ch === '|') {
        cells.push(cell.trim());
        cell = '';
      } else {
        cell += ch;
      }
    }
    cells.push(cell.trim());
    return cells;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // コードブロック
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        html += '</code></pre>';
        inCodeBlock = false;
      } else {
        closeListAll();
        codeLang = line.slice(3).trim();
        html += `<pre style="background:var(--bg3);padding:8px;border-radius:4px;overflow-x:auto;font-size:13px;"${codeLang ? ` data-lang="${esc(codeLang)}"` : ''}><code>`;
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      html += esc(line) + '\n';
      continue;
    }

    const tableLayoutMatch = line.match(/^<!--table-layout:(.+)-->\s*$/);
    if (tableLayoutMatch) {
      try {
        pendingTableLayout = JSON.parse(tableLayoutMatch[1]);
      } catch {
        pendingTableLayout = null;
      }
      continue;
    }

    // テーブル
    if (line.match(/^\|.*\|$/)) {
      closeListAll();
      // 区切り行（|---|---|）はスキップ
      if (line.match(/^\|[\s\-:|]+\|$/)) continue;
      const cells = splitMarkdownTableRow(line);
      if (!inTable) {
        const layoutJson = pendingTableLayout ? esc(JSON.stringify(pendingTableLayout)) : '';
        const hasWidths = Array.isArray(pendingTableLayout?.colWidths) && pendingTableLayout.colWidths.some(width => Number(width) > 0);
        html += `<table style="border-collapse:collapse;width:100%;margin:8px 0;${hasWidths ? 'table-layout:fixed;' : ''}"${layoutJson ? ` data-note-table-layout="${layoutJson}" data-note-table-resized="1"` : ''}>`;
        if (hasWidths) {
          html += '<colgroup>' + cells.map((_, ci) => {
            const rawWidth = Number(pendingTableLayout.colWidths[ci]) || 0;
            const width = rawWidth > 0 ? Math.max(40, rawWidth) : 0;
            return width ? `<col style="width:${width}px;">` : '<col>';
          }).join('') + '</colgroup>';
        }
        inTable = true;
        _tableRowCount = 0;
      }
      const tag = _tableRowCount === 0 ? 'th' : 'td';
      const rowHeight = Array.isArray(pendingTableLayout?.rowHeights)
        ? Math.max(24, Number(pendingTableLayout.rowHeights[_tableRowCount]) || 0)
        : 0;
      _tableRowCount++;
      const rowStyle = rowHeight ? ` style="height:${rowHeight}px;"` : '';
      const cellHeight = rowHeight ? `height:${rowHeight}px;` : '';
      html += `<tr${rowStyle}>` + cells.map(c => `<${tag} style="border:1px solid var(--border);padding:4px 8px;${cellHeight}">${inlinemd(c)}</${tag}>`).join('') + '</tr>';
      continue;
    }
    if (inTable) { html += '</table>'; inTable = false; pendingTableLayout = null; }

    // details/summary タグはそのまま通す
    const trimmed = line.trim();
    if (/^<details>$/i.test(trimmed) || /^<\/details>$/i.test(trimmed)) {
      closeListAll(); html += line + '\n'; continue;
    }
    if (/^<summary>(.*)<\/summary>$/i.test(trimmed)) {
      const inner = trimmed.match(/^<summary>(.*)<\/summary>$/i)[1];
      html += `<summary>${inlinemd(inner)}</summary>\n`; continue;
    }
    if (/^<!--\s*title\s*-->$/i.test(trimmed)) {
      closeListAll();
      pendingNoteTitle = true;
      continue;
    }

    // 空行
    if (trimmed === '') { closeListAll(); html += '<div><br></div>'; continue; }

    // 見出し（アイコン記法対応: ## :iconName: テキスト）
    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      closeListAll();
      const lv = hm[1].length;
      let content = hm[2];
      const headingId = _noteHeadingId(content, headingSlugCounts);
      content = content.replace(/^:([a-zA-Z][a-zA-Z0-9-]*):/, (match, iconName) => {
        if (typeof LUCIDE !== 'undefined' && LUCIDE[iconName] && typeof lucide === 'function') {
          return `<span class="heading-icon">${lucide(iconName, lv <= 2 ? 20 : 16)}</span> `;
        }
        return match; // 存在しないアイコン名はテキストとして保持
      });
      const idAttrs = headingId ? ` id="${esc(headingId)}" data-note-heading-id="${esc(headingId)}"` : '';
      const titleAttrs = pendingNoteTitle ? ' class="note-title" data-note-title="1"' : '';
      html += `<h${lv}${idAttrs}${titleAttrs}>${inlinemd(content)}</h${lv}>`;
      pendingNoteTitle = false;
      continue;
    }

    // 水平線
    if (line.match(/^(-{3,}|\*{3,}|_{3,})$/)) { closeListAll(); html += '<hr>'; continue; }

    // コールアウト: > [!iconName #color type] テキスト（後続の > 行も本文に含める）
    // 形式: > [!lightbulb #e6a700 warning] テキスト  or  > [!💡 info] テキスト（旧emoji互換）
    const calloutMatch = line.match(/^>\s*\[!([^\s\]]+)\s*(#[0-9a-fA-F]{3,8})?\s*(info|warning|danger|success)?\]\s*(.*)$/);
    if (calloutMatch) {
      closeListAll();
      const cIconRaw = calloutMatch[1], cColor = calloutMatch[2] || '', cType = calloutMatch[3] || '', cTextParts = [calloutMatch[4]];
      while (i + 1 < lines.length && lines[i + 1].startsWith('> ')) {
        i++;
        cTextParts.push(lines[i].slice(2));
      }
      const cls = cType ? ' callout-' + cType : '';
      const cBody = cTextParts.map(t => inlinemd(t)).join('<br>');
      const colorStyle = cColor ? ' style="color:' + esc(cColor) + ';"' : '';
      const cIconSpec = typeof GBIconAssets !== 'undefined' ? GBIconAssets.normalizeSpec(cIconRaw) : cIconRaw;
      const cIconHtml = typeof GBIconAssets !== 'undefined' ? GBIconAssets.render(cIconSpec, 20) : (typeof lucide === 'function' ? lucide(cIconRaw, 20) : esc(cIconRaw));
      const iconHtml = `<span class="callout-icon" data-icon="${esc(cIconSpec)}"${cColor ? ' data-color="' + esc(cColor) + '"' : ''}${colorStyle}>${cIconHtml}</span>`;
      html += `<div class="callout-block${cls}" contenteditable="false">${iconHtml}<div class="callout-body" contenteditable="true">${cBody}</div></div>`;
      continue;
    }
    // 引用（複数行をまとめて1つの<blockquote>に + 出典行検出）
    if (line.startsWith('> ')) {
      closeListAll();
      const quoteLines = [line.slice(2)];
      while (i + 1 < lines.length && lines[i + 1].startsWith('> ')) {
        i++;
        quoteLines.push(lines[i].slice(2));
      }
      const lastLine = quoteLines[quoteLines.length - 1];
      const citeMatch = lastLine.match(/^—\s+(.+)$/);
      if (citeMatch) {
        const bodyLines = quoteLines.slice(0, -1);
        const citeContent = inlinemd(citeMatch[1]);
        html += `<blockquote><div class="quote-body">${bodyLines.map(l => inlinemd(l)).join('<br>')}</div><cite class="quote-cite">${citeContent}</cite></blockquote>`;
      } else {
        html += `<blockquote>${quoteLines.map(l => inlinemd(l)).join('<br>')}</blockquote>`;
      }
      continue;
    }

    // リスト（箇条書き）
    const ulm = line.match(/^(\s*)[*\-+]\s+(.*)$/);
    if (ulm) {
      const indent = ulm[1].length;
      adjustListDepth(indent, 'ul');
      html += `<li>${inlinemd(ulm[2])}</li>`;
      continue;
    }
    // リスト（番号付き）
    const olm = line.match(/^(\s*)\d+\.\s+(.*)$/);
    if (olm) {
      const indent = olm[1].length;
      adjustListDepth(indent, 'ol');
      html += `<li>${inlinemd(olm[2])}</li>`;
      continue;
    }

    closeListAll();
    // 通常段落
    html += `<div>${inlinemd(line)}</div>`;
  }

  closeListAll();
  if (inCodeBlock) html += '</code></pre>';
  if (inTable) html += '</table>';
  // センチネルを隠し span に復元
  html = html.replace(/\x02NLID:([A-Za-z0-9_-]+)\x02/g, '<span class="_nl-id" data-line-id="$1" contenteditable="false" style="display:none;"></span>');
  // 注釈用 line-id span を、その直後のブロック先頭に移送する（<span._nl-id> を内包する空 <div> を潰す）
  try {
    const _tmp = document.createElement('div');
    _tmp.innerHTML = html;
    const _holders = [..._tmp.children].filter(el =>
      el.tagName === 'DIV' && el.children.length === 1 && el.firstElementChild?.classList?.contains('_nl-id') && el.textContent.trim() === ''
    );
    _holders.forEach(holder => {
      const span = holder.firstElementChild;
      const next = holder.nextElementSibling;
      if (next) {
        next.insertBefore(span, next.firstChild);
        holder.remove();
      }
    });
    html = _tmp.innerHTML;
  } catch (_) {}
  return html;
}

// MD から <!--nl:ID--> を抽出して Set で返す。
function _extractNoteLineIds(md) {
  const ids = new Set();
  if (!md) return ids;
  const re = /<!--nl:([A-Za-z0-9_-]+)-->/g;
  let m;
  while ((m = re.exec(md)) !== null) ids.add(m[1]);
  return ids;
}

// 保存前後の MD を比較し、削除された line-id の注釈を孤児化する。
async function _orphanRemovedNoteLines(prevMd, currMd, filePath) {
  try {
    const prevIds = _extractNoteLineIds(prevMd);
    const currIds = _extractNoteLineIds(currMd);
    const removed = [...prevIds].filter(id => !currIds.has(id));
    if (removed.length > 0) {
      await Promise.all(removed.map(id =>
        apiPost('/annotations/orphan-by-target', {
          target_kind: 'note_line',
          target_file: filePath,
          item_id: id,
          cascade_container: true,
        }).catch(() => {})
      ));
    }
    // Audit-P1 H-1: 保存完了後にコメントバッジキャッシュを無効化し、
    // 現在開いているノートのバッジを再描画する。自動保存の 2 秒タイマー後に
    // 3 秒 TTL キャッシュが効いて古いバッジが残ることを防ぐ。
    if (typeof CommentBadges !== 'undefined' && filePath) {
      try {
        CommentBadges.invalidate(filePath);
        const pc = document.getElementById('page-content');
        if (pc && pc.dataset.path === filePath) {
          CommentBadges.refreshNote(filePath, pc);
        }
      } catch (_) {}
    }
  } catch (_) {}
}

// ブロック要素から line-id を取得。未設定なら新規採番して挿入する（Y案: 遅延付与）。
function getOrAssignNoteLineId(blockEl) {
  if (!blockEl) return '';
  let span = [...blockEl.children].find(c => c.classList?.contains('_nl-id'));
  if (span && blockEl.firstElementChild === span) return span.dataset.lineId || '';
  const id = 'nl-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  if (!span) {
    span = document.createElement('span');
    span.className = '_nl-id';
    span.setAttribute('contenteditable', 'false');
    span.style.display = 'none';
    span.dataset.lineId = id;
  } else {
    span.remove();
  }
  blockEl.insertBefore(span, blockEl.firstChild);
  return span.dataset.lineId;
}

function _noteHeadingPlainText(value) {
  return String(value || '')
    .replace(/\x02NLID:[A-Za-z0-9_-]+\x02/g, '')
    .replace(/^:([a-zA-Z][a-zA-Z0-9-]*):\s*/, '')
    .replace(/!\[((?:[^\]\\]|\\.)*)\]\(((?:[^)\\]|\\.)*)\)/g, '$1')
    .replace(/\[((?:[^\]\\]|\\.)+)\]\(((?:[^)\\]|\\.)*)\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/\\([\])])/g, '$1')
    .trim();
}

function _noteHeadingBaseId(value) {
  const text = _noteHeadingPlainText(value).replace(/\s+/g, '-');
  return text || 'section';
}

function _noteHeadingId(value, counts) {
  const base = _noteHeadingBaseId(value);
  const current = counts?.get(base) || 0;
  counts?.set(base, current + 1);
  return current ? `${base}-${current + 1}` : base;
}

function _noteAnchorIdFromHref(href) {
  let raw = String(href || '').trim();
  if (!raw.startsWith('#') || raw === '#') return '';
  raw = raw.slice(1);
  try { raw = decodeURIComponent(raw); } catch (_) {}
  return raw.trim();
}

function _scrollNoteAnchorIntoView(anchorEl, anchorId) {
  const id = String(anchorId || '').trim();
  if (!id) return;
  const host = anchorEl?.closest?.('[contenteditable="true"]') || document.getElementById('page-content');
  if (!host) return;
  const headings = [...host.querySelectorAll('[data-note-heading-id], h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')];
  const target = headings.find(el => el.dataset?.noteHeadingId === id || el.id === id);
  if (!target) {
    if (typeof showStatus === 'function') showStatus('リンク先の見出しが見つかりません');
    return;
  }
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// パスからファイルタイプアイコンを推定して返す
function _linkIcon(path) {
  const fname = path.split(/[/\\]/).pop();
  const ext = fname.includes('.') ? fname.split('.').pop().toLowerCase() : '';
  const IMG = ['png','jpg','jpeg','gif','webp','svg','bmp','avif','ico'];
  const VID = ['mp4','webm','mov','avi','mkv'];
  const AUD = ['mp3','wav','ogg','flac','m4a','aac'];
  if (!ext) return lucide('db', 12);
  if (ext === 'md') return lucide('file', 12);
  if (ext === 'json') return lucide('fileText', 12);
  if (IMG.includes(ext)) return lucide('image', 12);
  if (VID.includes(ext)) return lucide('video', 12);
  if (AUD.includes(ext)) return lucide('audio', 12);
  if (ext === 'pdf') return lucide('fileText', 12);
  return lucide('file', 12);
}

function _noteLinkifyBareUrls(html) {
  if (!html || typeof document === 'undefined' || !/https?:\/\//i.test(html)) return html;
  const root = document.createElement('span');
  root.innerHTML = html;
  const skipTags = new Set(['A', 'CODE', 'PRE', 'KBD', 'SAMP', 'SCRIPT', 'STYLE']);
  const urlRe = /https?:\/\/[^\s<>"']+/gi;
  const trailingRe = /[.,!?;:、。)]）}\]」』〉》]+$/;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || !urlRe.test(node.nodeValue || '')) return NodeFilter.FILTER_REJECT;
      urlRe.lastIndex = 0;
      if (parent.closest('a,.auto-link') || skipTags.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(node => {
    const text = node.nodeValue || '';
    const frag = document.createDocumentFragment();
    let last = 0;
    text.replace(urlRe, (match, offset) => {
      if (offset > last) frag.appendChild(document.createTextNode(text.slice(last, offset)));
      let url = match;
      let suffix = '';
      const trailing = url.match(trailingRe);
      if (trailing) {
        suffix = trailing[0];
        url = url.slice(0, -suffix.length);
      }
      const a = document.createElement('a');
      a.href = url;
      a.textContent = url;
      a.style.color = 'var(--accent2)';
      frag.appendChild(a);
      if (suffix) frag.appendChild(document.createTextNode(suffix));
      last = offset + match.length;
      return match;
    });
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.replaceWith(frag);
  });
  return root.innerHTML;
}

// インラインMarkdown変換
function inlinemd(text) {
  let s = esc(text);
  // キーキャップ記法: [[Ctrl]] → <kbd>Ctrl</kbd>（インラインコードの前に処理）
  s = s.replace(/\[\[([^\]]+?)\]\]/g, '<kbd>$1</kbd>');
  // インラインコード
  s = s.replace(/`([^`]+)`/g, '<code style="background:var(--bg3);padding:1px 4px;border-radius:2px;font-size:0.9em;">$1</code>');
  // 太字+斜体
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>');
  // 太字
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  // 斜体
  s = s.replace(/\*(.+?)\*/g, '<i>$1</i>');
  // 取り消し線
  s = s.replace(/~~(.+?)~~/g, '<s>$1</s>');
  // 画像（リンクより先に処理。!が先にリンクとしてマッチするのを防止）
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, altFull, src) => {
    // 拡張alt解析: ![alt|w=300|path=...](src)
    const parts = altFull.split('|');
    const alt = parts[0];
    let w = 0, dataPath = '', mediaType = '';
    for (let i = 1; i < parts.length; i++) {
      if (parts[i].startsWith('w=')) w = parseInt(parts[i].slice(2));
      if (parts[i].startsWith('path=')) dataPath = parts[i].slice(5);
      if (parts[i].startsWith('type=')) mediaType = parts[i].slice(5).toLowerCase();
    }
    const wStyle = w ? `width:${w}px;` : 'max-width:100%;';
    const isManagedMedia = dataPath || src.includes('/file-raw?') || src.includes('/media/file?');
    if (isManagedMedia) {
      // embed-media構造を復元（リサイズハンドル対応）— altFull/srcは既にesc済み
      if (mediaType === 'video') {
        return `<div class="embed-media" contenteditable="false" data-path="${dataPath}" data-name="${alt}" data-type="video"><video src="${src}" controls style="${wStyle}"></video></div>`;
      }
      if (mediaType === 'audio') {
        return `<div class="embed-media" contenteditable="false" data-path="${dataPath}" data-name="${alt}" data-type="audio"><audio src="${src}" controls style="${wStyle}"></audio></div>`;
      }
      return `<div class="embed-media" contenteditable="false" data-path="${dataPath}" data-name="${alt}" data-type="image"><img src="${src}" alt="${alt}" style="${wStyle}"></div>`;
    }
    return `<img src="${src}" alt="${alt}" style="${wStyle}">`;
  });
  // リンク: 外部URLはaタグ、内部パスはauto-linkスパン（エスケープ済み\]と\)に対応）
  s = s.replace(/\[((?:[^\]\\]|\\.)+)\]\(((?:&lt;.*?&gt;|<.*?>|(?:[^)\\]|\\.)+))\)/g, (m, text, href) => {
    // htmlToMdがエスケープした\]と\)を復元
    const cleanText = text.replace(/\\([\])])/g, '$1');
    let cleanHref = href.replace(/\\([\])])/g, '$1');
    if (cleanHref.startsWith('&lt;') && cleanHref.endsWith('&gt;')) cleanHref = cleanHref.slice(4, -4);
    else if (cleanHref.startsWith('<') && cleanHref.endsWith('>')) cleanHref = cleanHref.slice(1, -1);
    if (cleanHref.startsWith('http://') || cleanHref.startsWith('https://') || cleanHref.startsWith('mailto:')) {
      return `<a href="${cleanHref}" style="color:var(--accent2);">${cleanText}</a>`;
    }
    const noteAnchorId = _noteAnchorIdFromHref(cleanHref);
    if (noteAnchorId) {
      return `<a href="#${esc(noteAnchorId)}" class="note-anchor-link" data-note-anchor="${esc(noteAnchorId)}" data-e2e-id="note-anchor-link" style="color:var(--accent);text-decoration:underline;cursor:pointer;">${cleanText}</a>`;
    }
    // ファイルタイプアイコン: テキストがファイル名風またはパスが拡張子なし（DBフォルダ）の場合に付与
    // エンティティ自動リンク（テキスト=エンティティ名、パス=.mdファイル）にはアイコンを付けない
    const _pf = cleanHref.split(/[/\\]/).pop();
    const _pe = _pf.includes('.') ? _pf.split('.').pop().toLowerCase() : '';
    const _knownExt = ['md','json','txt','csv','html','pdf','png','jpg','jpeg','gif','webp','svg','bmp','avif','ico','mp4','webm','mov','avi','mkv','mp3','wav','ogg','flac','m4a','aac','clip','psd','zip'];
    const _textExt = cleanText.trim().includes('.') ? cleanText.trim().split('.').pop().toLowerCase() : '';
    const _showIco = !_pe || _knownExt.includes(_textExt);
    const ico = _showIco ? _linkIcon(cleanHref) + ' ' : '';
    return `<span class="auto-link" data-path="${cleanHref}" style="color:var(--accent);text-decoration:underline;cursor:pointer;">${ico}${cleanText}</span>`;
  });
  // ルビ記法: {漢字|ルビ} → data-ruby属性のspanで表示
  // ルビ部分はひらがな・カタカナ・漢字・英数字のみ（プログラムの{x|y}との誤判定を防止）
  s = s.replace(/\{([^|{}]+)\|([\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBFa-zA-Z0-9\u30FC\u3005\u3006\u3007ー\s]+)\}/g, '<span data-ruby="$2" style="position:relative;">$1</span>');
  return _noteLinkifyBareUrls(s);
}

// HTML→Markdown変換
// 空行は \x00BLANK\x00 マーカーで管理し、最終段階でブロック境界\nと結合して\n\nを生成する。
// これにより、ブロック要素の末尾\n + 空行\n\n = \n\n\n → 圧縮で消失、という問題を回避する。
function htmlToMd(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  const BLANK = '\x00BLANK\x00';

  function tablePixelStyle(value) {
    const n = parseFloat(String(value || '').replace('px', ''));
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  }

  function tableLayoutForMarkdown(table) {
    const cols = [...table.querySelectorAll(':scope > colgroup > col')];
    const firstRow = table.rows?.[0];
    const colWidths = firstRow ? [...firstRow.cells].map((cell, index) => {
      return tablePixelStyle(cols[index]?.style?.width) || tablePixelStyle(cell.style.width);
    }) : [];
    const rowHeights = [...(table.rows || [])].map(row => {
      const firstCell = row.cells?.[0];
      return tablePixelStyle(row.style.height) || tablePixelStyle(firstCell?.style?.height);
    });
    const hasLayout = colWidths.some(Boolean) || rowHeights.some(Boolean);
    if (!hasLayout) return '';
    const payload = {
      colWidths: colWidths.map(width => width || null),
      rowHeights: rowHeights.map(height => height || null),
    };
    return '<!--table-layout:' + JSON.stringify(payload) + '-->\n';
  }

  function tableCellMarkdown(text) {
    return String(text || '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
  }

  // ブロック要素の先頭が _nl-id span であれば <!--nl:ID--> を返す。テキストが先にある場合は無効扱い（Q3: 結合時の後段ID喪失）。
  function _nlIdMarker(node) {
    const first = node.firstChild;
    if (first && first.nodeType === 1 && first.classList?.contains('_nl-id')) {
      const id = first.dataset?.lineId;
      if (id) return '<!--nl:' + id + '-->\n';
    }
    return '';
  }

  function walk(node) {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return '';

    const tag = node.tagName;
    // コピーボタン・テーブル操作ボタン・セル編集inputはスキップ
    if (node.classList?.contains('copy-btn') || node.classList?.contains('table-add-row') || node.classList?.contains('table-add-col')) return '';
    if (node.classList?.contains('cell-edit')) return node.value || '';
    // DETAILS/SUMMARY/H1-H6は子ノードを個別に走査するため、childrenの事前計算をスキップ
    const _needsChildren = !['DETAILS','SUMMARY','H1','H2','H3','H4','H5','H6','KBD','BLOCKQUOTE','LI'].includes(tag);
    const children = _needsChildren ? [...node.childNodes].map(walk).join('') : '';

    switch (tag) {
      case 'KBD': return '[[' + node.textContent + ']]';
      case 'DETAILS': {
        let md = '<details>\n';
        for (const child of node.childNodes) md += walk(child);
        md += '</details>\n\n';
        return md;
      }
      case 'SUMMARY': {
        let text = '';
        for (const child of node.childNodes) text += walk(child);
        return '<summary>' + text.trim() + '</summary>\n';
      }
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
        const level = parseInt(tag[1]);
        let text = '';
        for (const child of node.childNodes) {
          if (child.classList?.contains('heading-icon')) {
            const svg = child.querySelector('svg');
            const iconName = svg?.dataset?.icon || '';
            if (iconName) text += ':' + iconName + ': ';
            continue;
          }
          text += walk(child);
        }
        const titleMarker = (node.classList?.contains('note-title') || node.dataset?.noteTitle === '1') ? '<!--title-->\n' : '';
        return titleMarker + _nlIdMarker(node) + '#'.repeat(level) + ' ' + text.trim() + '\n';
      }
      case 'B': case 'STRONG': return '**' + children + '**';
      case 'I': case 'EM': return '*' + children + '*';
      case 'S': case 'DEL': return '~~' + children + '~~';
      case 'U': return children; // Markdownに下線はない
      case 'CODE':
        if (node.parentElement?.tagName === 'PRE') return children;
        return '`' + children + '`';
      case 'PRE': {
        const lang = node.dataset?.lang || '';
        const codeText = children.endsWith('\n') ? children.slice(0, -1) : children;
        return _nlIdMarker(node) + '```' + lang + '\n' + codeText + '\n```\n';
      }
      case 'BLOCKQUOTE': {
        const _nlMk = _nlIdMarker(node);
        // quote-body/quote-cite構造がある場合（出典付き引用）
        const qBody = node.querySelector('.quote-body');
        const qCite = node.querySelector('.quote-cite');
        if (qBody || qCite) {
          let quoteText = '';
          if (qBody) {
            const bodyMd = [...qBody.childNodes].map(n => {
              if (n.tagName === 'BR') return '\n';
              return walk(n);
            }).join('');
            quoteText += bodyMd.split('\n').map(l => '> ' + l.trim()).join('\n') + '\n';
          }
          if (qCite) {
            quoteText += '> — ' + [...qCite.childNodes].map(walk).join('').trim() + '\n';
          }
          return _nlMk + quoteText;
        }
        // 出典なし引用（テキスト + <br> 混在）
        const rawMd = [...node.childNodes].map(n => {
          if (n.tagName === 'BR') return '\n';
          return walk(n);
        }).join('');
        return _nlMk + rawMd.split('\n').map(l => '> ' + l.trim()).join('\n') + '\n';
      }
      case 'HR': return '---\n';
      case 'BR': return '\n';
      case 'UL': return children;
      case 'OL': return children;
      case 'LI': {
        const parent = node.parentElement;
        // ネスト深度を計算（親のUL/OLを辿る）
        let depth = 0;
        let p = parent;
        while (p) {
          if (p.tagName === 'UL' || p.tagName === 'OL') depth++;
          p = p.parentElement;
        }
        const indent = '  '.repeat(Math.max(0, depth - 1));
        // LI内のテキスト部分とネストされたリスト部分を分離
        let textParts = [];
        let nestedList = '';
        for (const child of node.childNodes) {
          if (child.nodeType === 1 && (child.tagName === 'UL' || child.tagName === 'OL')) {
            nestedList += walk(child);
          } else if (child.nodeType === 1 && child.tagName === 'BR') {
            textParts.push('\n');
          } else {
            const c = walk(child);
            if (c.trim()) textParts.push(c.trim());
          }
        }
        // BR由来の改行を空白区切りに変換（Markdown LI内では改行=行分離になるため）
        const text = textParts.join(' ').replace(/ ?\n ?/g, ' ');
        const _liMk = _nlIdMarker(node);
        if (parent?.tagName === 'OL') {
          const idx = [...parent.children].indexOf(node) + 1;
          return _liMk + indent + idx + '. ' + text + '\n' + nestedList;
        }
        return _liMk + indent + '- ' + text + '\n' + nestedList;
      }
      case 'A': {
        const href = node.getAttribute('href');
        return href ? '[' + children.replace(/\]/g, '\\]') + '](' + href.replace(/\)/g, '\\)') + ')' : children;
      }
      case 'TABLE': {
        const rows = node.querySelectorAll('tr');
        if (rows.length === 0) return children;
        let md = tableLayoutForMarkdown(node);
        rows.forEach((tr, ri) => {
          const cells = [...tr.querySelectorAll('th, td')].map(c => tableCellMarkdown(walk(c).trim()));
          md += '| ' + cells.join(' | ') + ' |\n';
          if (ri === 0) md += '| ' + cells.map(() => '---').join(' | ') + ' |\n';
        });
        return md;  // 最終行の\nで終わるため追加不要
      }
      case 'TR': case 'TH': case 'TD': return children;
      case 'DIV': case 'P': {
        // コールアウトブロック → Markdown変換
        if (node.classList.contains('callout-block')) {
          const iconEl = node.querySelector('.callout-icon');
          // data-icon属性があればLucide名、なければtextContent（旧emoji互換）
          const icon = iconEl?.dataset?.icon || iconEl?.textContent || 'lightbulb';
          const color = iconEl?.dataset?.color || '';
          const bodyNode = node.querySelector('.callout-body');
          const body = bodyNode ? [...bodyNode.childNodes].map(walk).join('').trim() : '';
          const typeMatch = [...node.classList].find(c => c.startsWith('callout-') && c !== 'callout-block');
          const type = typeMatch ? typeMatch.replace('callout-', '') : '';
          const bodyLines = body.split('\n');
          const firstLine = `> [!${icon}${color ? ' ' + color : ''}${type ? ' ' + type : ''}] ${bodyLines[0]}`;
          const restLines = bodyLines.slice(1).map(l => '> ' + l).join('\n');
          return firstLine + (restLines ? '\n' + restLines : '') + '\n';
        }
        const trimmed = children.trim();
        // 空のdiv/p（<div><br></div>等）→ 空行マーカー
        if (!trimmed || trimmed === '\n') return BLANK;
        return _nlIdMarker(node) + trimmed + '\n';
      }
      case 'SPAN':
        // 注釈用 line-id span は MD に直接出力しない（ブロック先頭なら _nlIdMarker 経由で親側から emit される）
        if (node.classList?.contains('_nl-id')) return '';
        // コメントバッジ（Phase 2e-ii）は UI 装飾なので保存しない
        if (node.classList?.contains('cmt-badge')) return '';
        // auto-linkスパン: data-pathがあればMarkdownリンクとして保存
        if (node.classList?.contains('auto-link')) {
          const linkPath = node.dataset?.path;
          if (linkPath) {
            // SVGアイコンのtextContentが混入しないようclone後に除去
            const _cl = node.cloneNode(true);
            _cl.querySelectorAll('svg').forEach(s => s.remove());
            const linkText = _cl.textContent.trim().replace(/\]/g, '\\]');
            const safePath = linkPath.replace(/\)/g, '\\)');
            return `[${linkText}](${safePath})`;
          }
          return children;
        }
        // data-ruby属性付きspan → ルビ記法に変換
        if (node.dataset && node.dataset.ruby) {
          return `{${children}|${node.dataset.ruby}}`;
        }
        return children;
      case 'MARK':
        if (node.classList?.contains('cmt-highlight')) return children;
        return children;
      case 'IMG': {
        const src = node.getAttribute('src') || '';
        const alt = node.getAttribute('alt') || '';
        const w = node.style.width ? parseInt(node.style.width) : (node.getAttribute('width') ? parseInt(node.getAttribute('width')) : 0);
        const embedDiv = node.closest('.embed-media');
        const dataPath = embedDiv?.dataset?.path || '';
        const mediaType = embedDiv?.dataset?.type || '';
        // 幅・パス情報を保存: ![alt|w=300|path=...](src)
        let extra = '';
        if (w) extra += '|w=' + w;
        if (dataPath) extra += '|path=' + dataPath;
        if (mediaType && mediaType !== 'image') extra += '|type=' + mediaType;
        return `![${alt.replace(/\]/g, '\\]')}${extra}](${src})`;
      }
      case 'VIDEO':
      case 'AUDIO': {
        const src = node.getAttribute('src') || '';
        const embedDiv = node.closest('.embed-media');
        const dataPath = embedDiv?.dataset?.path || '';
        const dataName = embedDiv?.dataset?.name || '';
        const w = node.style.width ? parseInt(node.style.width) : (node.getAttribute('width') ? parseInt(node.getAttribute('width')) : 0);
        const type = tag === 'VIDEO' ? 'video' : 'audio';
        const alt = (dataName || src.split('/').pop() || type).replace(/\]/g, '\\]');
        let extra = '|type=' + type;
        if (w) extra += '|w=' + w;
        if (dataPath) extra += '|path=' + dataPath;
        return `![${alt}${extra}](${src})`;
      }
      case 'RUBY': {
        const base = [...node.childNodes].filter(n => n.nodeName !== 'RT' && n.nodeName !== 'RP').map(walk).join('');
        const rt = node.querySelector('rt');
        const ruby = rt ? rt.textContent : '';
        return ruby ? `{${base}|${ruby}}` : base;
      }
      case 'RT': return '';
      case 'SECTION': return children; // heading-sectionは中身だけ出力
      default:
        // data-ruby属性付きspan → ルビ記法に変換
        if (node.dataset && node.dataset.ruby) {
          return `{${children}|${node.dataset.ruby}}`;
        }
        return children;
    }
  }

  let md = walk(div);

  // 空行マーカーを改行に変換
  // \nBLANK → \n\n（ブロック末尾\n + 空行 = Markdown空行1つ）
  md = md.split('\n' + BLANK).join('\n\n');
  // 残余マーカー（連続空行の2つ目以降）→ 改行に変換
  md = md.split(BLANK).join('\n');

  // ゼロ幅スペース除去（ルビ境界）
  md = md.replace(/\u200B/g, '');
  // 注: \n{3,}圧縮は行わない（ユーザーが意図的に追加した複数空行を保持するため）
  return md.trim() + '\n';
}

// パスを解決（絶対パスはそのまま、相対パスはvaultまたは現在のファイル基準で解決）
function _resolveAutoLinkPath(filePath) {
  if (!filePath) return filePath;
  if (/^(https?:|mailto:)/i.test(filePath)) return filePath;
  // Windowsの絶対パス（D:/ 等）またはUnix絶対パス（/で始まる）
  if (/^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('/')) return filePath;
  // vaultパスがあればvault基準で解決
  if (state.vaultPath && !filePath.startsWith('./') && !filePath.startsWith('../')) {
    return state.vaultPath.replace(/\\/g, '/') + '/' + filePath;
  }
  // 相対パス: 現在のファイルのディレクトリを先頭に付加
  const pc = document.getElementById('page-content');
  const currentPath = (pc && pc.dataset.path)
    || state.currentPagePath
    || state.currentBoardPath
    || window._embeddedFilePath
    || '';
  const dir = currentPath.replace(/[/\\][^/\\]*$/, '');
  if (!dir) return filePath;
  const rel = filePath.startsWith('./') ? filePath.slice(2) : filePath;
  return dir + '/' + rel;
}

/**
 * 統一リンクオープン関数 — 全リンク種別（自動リンク、手動リンク、ボードリンクカード等）で使用
 * @param {string} filePath - リンク先パス（絶対 or 相対）
 * @param {string} [name] - 表示ラベル（省略時はファイル名）
 * @param {object} [options] - { ctrlKey: boolean }
 */
async function openLink(filePath, name, options) {
  if (!filePath) return;
  const noteAnchorId = _noteAnchorIdFromHref(filePath);
  if (noteAnchorId) {
    _scrollNoteAnchorIntoView(null, noteAnchorId);
    return;
  }
  if (/^(https?:|mailto:)/i.test(filePath)) {
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(filePath, '_blank', 'noopener');
    } else if (typeof location !== 'undefined') {
      location.href = filePath;
    }
    return;
  }
  const label = name || filePath.split(/[/\\]/).pop();
  if (typeof flushPendingEditorAutosave === 'function') await flushPendingEditorAutosave();
  await _openLinkInCurrentTab(filePath, label);
}

async function openLinkInSubPanel(filePath, name, options) {
  if (!filePath) return;
  const noteAnchorId = _noteAnchorIdFromHref(filePath);
  if (noteAnchorId) {
    _scrollNoteAnchorIntoView(null, noteAnchorId);
    return;
  }
  const label = name || filePath.split(/[/\\]/).pop();
  if (typeof flushPendingEditorAutosave === 'function') await flushPendingEditorAutosave();
  if (typeof openLinkedPathInSubPanel === 'function') {
    return openLinkedPathInSubPanel(filePath, label, options || {});
  }
  return _openLinkInCurrentTab(filePath, label);
}

function openLinkInRightPane(filePath, name, options) {
  if (typeof openLinkedPathInRightPane === 'function') {
    const label = name || filePath.split(/[/\\]/).pop();
    return openLinkedPathInRightPane(filePath, label, options || {});
  }
  return openLinkInSubPanel(filePath, name, options);
}

function openLinkInMainPane(filePath, name, options) {
  if (!filePath) return;
  const label = name || filePath.split(/[/\\]/).pop();
  if (typeof openLinkedPathInMainPane === 'function') {
    return openLinkedPathInMainPane(filePath, label, options || {});
  }
  return openLink(filePath, label, options || {});
}

function openLinkStandalone(filePath, name, options) {
  if (!filePath) return;
  const label = name || filePath.split(/[/\\]/).pop();
  if (typeof openLinkedPathStandalone === 'function') {
    return openLinkedPathStandalone(filePath, label, options || {});
  }
  return openLink(filePath, label, options || {});
}

async function _openLinkInCurrentTab(filePath, name) {
  const ext = filePath.includes('.') ? filePath.split('.').pop().toLowerCase() : '';
  const imgExts = ['jpg','jpeg','png','gif','webp','svg','bmp','ico','avif'];
  const mediaExts = ['mp4','webm','mov','avi','mp3','wav','ogg','flac','aac'];
  if (ext === 'md') {
    // DB内エントリかどうか判定
    const parent = filePath.replace(/[/\\][^/\\]+$/, '');
    let isDbEntry = false;
    try {
      const meta = await apiFetch('/db-metadata?path=' + encodeURIComponent(parent));
      if (meta && meta.property_types && Object.keys(meta.property_types).length > 0) isDbEntry = true;
    } catch {}
    if (isDbEntry && typeof selectDatabase === 'function' && typeof selectEntity === 'function') {
      await selectDatabase(parent);
      await selectEntity(filePath);
    } else {
      await openPage(name, filePath);
    }
  } else if (ext === 'board') {
    if (typeof openBoard === 'function') await openBoard(name, filePath);
  } else if (ext === 'csv') {
    if (typeof openCsvFile === 'function') openCsvFile(name, filePath);
  } else if (ext === 'html' || ext === 'htm') {
    if (typeof openHtmlFile === 'function') openHtmlFile(name, filePath);
  } else if (ext === 'pdf') {
    if (typeof openViewer === 'function') openViewer('/viewer?pdf=' + encodeURIComponent(filePath));
  } else if (imgExts.includes(ext)) {
    if (typeof openMedia === 'function') openMedia(name, filePath, 'image');
  } else if (mediaExts.includes(ext)) {
    const mtype = ['mp3','wav','ogg','flac','aac'].includes(ext) ? 'audio' : 'video';
    if (typeof openMedia === 'function') openMedia(name, filePath, mtype);
  } else if (ext === 'mel-scenario' || ext === 'scriptnote.json' || filePath.endsWith('.scriptnote.json')) {
    if (typeof openScenarioInScriptNote === 'function') openScenarioInScriptNote(filePath, name);
  } else if (!ext || ext === 'json') {
    // フォルダ or DB
    if (typeof selectEntity === 'function') await selectEntity(filePath);
    else await openPage(name, filePath);
  } else {
    await openPage(name, filePath);
  }
  // ビューワーにもプレビュー表示
  _updateLinkedPreview(filePath);
  _showFileInfoInDetailPanel(filePath);
}

// 旧API互換: onAutoLinkClick → サブパネルオープンに委譲
function onAutoLinkClick(el, e) {
  const filePath = _resolveAutoLinkPath(el.dataset.path);
  if (!filePath) return;
  if (filePath.replace(/\\/g, '/').includes('_chat/llm/') && filePath.includes('#')) {
    const hashIndex = filePath.indexOf('#');
    if (typeof openSavedChat === 'function') {
      openSavedChat(filePath.slice(0, hashIndex), filePath.slice(hashIndex + 1));
      return;
    }
  }
  const name = el.textContent.replace(/^[\s]*/, '').trim() || filePath.split(/[/\\]/).pop();
  openLinkInSubPanel(filePath, name, {
    linkType: el.dataset.linkType || el.dataset.type || '',
    sourcePaneId: el.closest('.gb-pane')?.dataset?.paneId || '',
  });
}

// ダブルクリックは現在のパネルでリンク先を開く
function onAutoLinkDblClick(el) {
  const filePath = _resolveAutoLinkPath(el.dataset.path);
  if (!filePath) return;
  const name = el.textContent.replace(/^[\s]*/, '').trim() || filePath.split(/[/\\]/).pop();
  openLink(filePath, name);
}

function _contextLinkLabel(el, fallbackPath) {
  const text = (el?.textContent || '').replace(/^[\s]*/, '').trim();
  return text || String(fallbackPath || '').split(/[/\\]/).pop() || String(fallbackPath || '');
}

function _relationLinkEntityName(el) {
  const explicit = String(el?.dataset?.entityName || '').trim();
  if (explicit) return explicit;
  return String(el?.textContent || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function _resolveContextLinkTarget(rawTarget) {
  const target = rawTarget?.closest ? rawTarget : rawTarget?.parentElement;
  if (!target) return null;
  const sourcePaneId = target.closest('.gb-pane')?.dataset?.paneId || '';

  const autoLink = target.closest('.auto-link[data-path]');
  if (autoLink) {
    const path = _resolveAutoLinkPath(autoLink.dataset.path || '');
    if (!path) return null;
    return { path, label: _contextLinkLabel(autoLink, path), linkType: autoLink.dataset.linkType || autoLink.dataset.type || '', sourcePaneId, element: autoLink };
  }

  const chatLink = target.closest('.chat-md-link[data-chat-link-target]');
  if (chatLink) {
    const path = String(chatLink.dataset.chatLinkTarget || '').trim();
    if (!path) return null;
    return {
      path,
      label: _contextLinkLabel(chatLink, path),
      linkType: chatLink.dataset.linkType || '',
      sourcePaneId,
      element: chatLink,
      openAction: () => {
        if (typeof openChatMarkdownTarget === 'function') openChatMarkdownTarget(path);
        else openLink(path, _contextLinkLabel(chatLink, path));
      },
    };
  }

  const chatPropLink = target.closest('.chat-prop-link');
  if (chatPropLink) {
    const path = String(chatPropLink.dataset.chatPropPath || chatPropLink.getAttribute('title') || '').trim();
    if (!path) return null;
    return {
      path,
      label: _contextLinkLabel(chatPropLink, path),
      linkType: 'chat',
      sourcePaneId,
      element: chatPropLink,
      openAction: () => {
        if (typeof _openEntityChat === 'function') _openEntityChat(path);
        else openLink(path, _contextLinkLabel(chatPropLink, path));
      },
    };
  }

  const backlink = target.closest('.bl-link[data-path]');
  if (backlink) {
    const path = String(backlink.dataset.path || '').trim();
    if (!path) return null;
    return {
      path,
      label: _contextLinkLabel(backlink, path),
      linkType: backlink.dataset.linkType || '',
      sourcePaneId,
      element: backlink,
    };
  }

  const relationLink = target.closest('.relation-link');
  if (relationLink) {
    const dbPath = relationLink.dataset.dbPath || (typeof state !== 'undefined' ? state.currentDbPath : '') || '';
    const entityName = _relationLinkEntityName(relationLink);
    if (!dbPath || !entityName || typeof _entityPath !== 'function') return null;
    return { path: _entityPath(dbPath, entityName), label: entityName, linkType: 'entity', sourcePaneId, element: relationLink };
  }

  const noteAnchor = target.closest('a.note-anchor-link[data-note-anchor], a[href^="#"]');
  if (noteAnchor && !noteAnchor.closest('.gb-context-menu')) {
    const anchorId = String(noteAnchor.dataset?.noteAnchor || _noteAnchorIdFromHref(noteAnchor.getAttribute('href') || '')).trim();
    if (anchorId) {
      return {
        path: '#' + anchorId,
        label: _contextLinkLabel(noteAnchor, anchorId),
        linkType: 'note-anchor',
        sourcePaneId,
        localAnchor: anchorId,
        element: noteAnchor,
        openAction: () => _scrollNoteAnchorIntoView(noteAnchor, anchorId),
      };
    }
  }

  const anchor = target.closest('a[href]');
  if (anchor && !anchor.closest('.gb-context-menu')) {
    const path = anchor.getAttribute('href') || '';
    if (!path || path === '#' || /^javascript:/i.test(path)) return null;
    const editableHost = anchor.closest('[contenteditable="true"]');
    return { path, label: _contextLinkLabel(anchor, path), linkType: anchor.dataset.linkType || '', sourcePaneId, anchorEl: anchor, editableHost, element: anchor };
  }
  return null;
}

function _unlinkContextAnchor(linkTarget) {
  const anchor = linkTarget?.anchorEl;
  const editable = linkTarget?.editableHost;
  if (!anchor || !editable || !anchor.isConnected) return;
  if (typeof _pushCustomUndo === 'function') _pushCustomUndo(editable);
  const textNode = document.createTextNode(anchor.textContent || '');
  anchor.replaceWith(textNode);
  const range = document.createRange();
  range.setStartAfter(textNode);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  editable.dispatchEvent(new Event('input', { bubbles: true }));
  editable.focus();
}

function _linkContextItemId(label) {
  return 'note-link-context-menu-' + String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\u3040-\u30ff\u3400-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function _showLinkContextMenu(e, linkTarget) {
  if (!linkTarget?.path) return;
  removeTooltip();
  if (typeof closeColHeaderMenu === 'function') closeColHeaderMenu();
  document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'gb-context-menu gb-link-context-menu';
  menu.dataset.e2eId = 'note-link-context-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'リンクメニュー');
  menu.style.zIndex = '10080';
  const addItem = (icon, label, action) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'gb-context-menu-item';
    item.dataset.e2eId = _linkContextItemId(label);
    item.setAttribute('role', 'menuitem');
    item.setAttribute('aria-label', label);
    const iconWrap = document.createElement('span');
    iconWrap.className = 'menu-icon';
    iconWrap.setAttribute('aria-hidden', 'true');
    if (typeof lucide === 'function') iconWrap.innerHTML = lucide(icon, 16);
    const labelEl = document.createElement('span');
    labelEl.className = 'gb-context-menu-item-label';
    labelEl.textContent = label;
    item.append(iconWrap, labelEl);
    item.addEventListener('click', () => {
      menu.remove();
      action();
    });
    menu.appendChild(item);
  };
  addItem('externalLink', 'リンク先を開く', () => {
    if (typeof linkTarget.openAction === 'function') linkTarget.openAction();
    else openLink(linkTarget.path, linkTarget.label);
  });
  const browserUrl = String(linkTarget.path || '').trim();
  if (/^https?:\/\//i.test(browserUrl)) {
    addItem('externalLink', '既定のブラウザで開く', () => {
      if (typeof openExternalBrowserUrl === 'function') {
        openExternalBrowserUrl(browserUrl);
      } else if (typeof apiPost === 'function') {
        apiPost('/open-external-url', { url: browserUrl }, { silentError: true })
          .catch(() => window.open?.(browserUrl, '_blank', 'noopener'));
      } else {
        window.open?.(browserUrl, '_blank', 'noopener');
      }
    });
  }
  if (!linkTarget.localAnchor) {
    addItem('layers-2', 'サブパネルで開く', () => openLinkInSubPanel(linkTarget.path, linkTarget.label, {
      linkType: linkTarget.linkType || '',
      sourcePaneId: linkTarget.sourcePaneId || '',
    }));
    addItem('panelTop', 'メインパネルで開く', () => openLinkInMainPane(linkTarget.path, linkTarget.label, {
      linkType: linkTarget.linkType || '',
      sourcePaneId: linkTarget.sourcePaneId || '',
    }));
    addItem('panelRight', '右サイドバーで開く', () => openLinkInRightPane(linkTarget.path, linkTarget.label, {
      linkType: linkTarget.linkType || '',
      sourcePaneId: linkTarget.sourcePaneId || '',
    }));
    if (typeof canOpenLinkedPathStandalone !== 'function' || canOpenLinkedPathStandalone(linkTarget.path, linkTarget.linkType || '')) {
      addItem('externalLink', '単独アプリで開く', () => openLinkStandalone(linkTarget.path, linkTarget.label, {
        linkType: linkTarget.linkType || '',
        sourcePaneId: linkTarget.sourcePaneId || '',
      }));
    }
  }
  if (linkTarget.anchorEl && linkTarget.editableHost) {
    const sep = document.createElement('div');
    sep.className = 'gb-context-menu-sep';
    sep.setAttribute('role', 'separator');
    menu.appendChild(sep);
    addItem('unlink', 'リンクを解除', () => _unlinkContextAnchor(linkTarget));
  }

  menu.addEventListener('keydown', (ev) => {
    const items = Array.from(menu.querySelectorAll('.gb-context-menu-item'));
    if (!items.length) return;
    const current = items.indexOf(document.activeElement);
    const focusAt = (index) => {
      ev.preventDefault();
      items[(index + items.length) % items.length]?.focus?.({ preventScroll: true });
    };
    if (ev.key === 'Escape') {
      ev.preventDefault();
      menu.remove();
      linkTarget.element?.focus?.({ preventScroll: true });
    } else if (ev.key === 'ArrowDown') {
      focusAt(current + 1);
    } else if (ev.key === 'ArrowUp') {
      focusAt(current - 1);
    } else if (ev.key === 'Home') {
      focusAt(0);
    } else if (ev.key === 'End') {
      focusAt(items.length - 1);
    }
  });

  document.body.appendChild(menu);
  const anchorRect = { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY };
  if (typeof positionPopup === 'function') {
    positionPopup(menu, anchorRect);
  } else {
    const z = typeof _getZoom === 'function' ? _getZoom() : 1;
    menu.style.left = (e.clientX / z) + 'px';
    menu.style.top = (e.clientY / z) + 'px';
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  }
  setTimeout(() => {
    menu.querySelector('.gb-context-menu-item')?.focus?.({ preventScroll: true });
    const closer = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('pointerdown', closer, true);
      }
    };
    document.addEventListener('pointerdown', closer, true);
  }, 0);
}

const LINK_CONTEXT_LONG_PRESS_MS = 520;
const LINK_CONTEXT_LONG_PRESS_MOVE_TOLERANCE = 10;
let _linkContextLongPressTimer = null;
let _linkContextLongPressPointerId = null;
let _linkContextLongPressStart = null;
let _linkContextLongPressElement = null;
let _linkContextLongPressSuppressUntil = 0;

function _clearLinkContextLongPress() {
  if (_linkContextLongPressTimer) clearTimeout(_linkContextLongPressTimer);
  _linkContextLongPressTimer = null;
  _linkContextLongPressPointerId = null;
  _linkContextLongPressStart = null;
  _linkContextLongPressElement = null;
}

function _linkContextLongPressMatches(target) {
  if (!_linkContextLongPressElement || Date.now() > _linkContextLongPressSuppressUntil) return false;
  const linkTarget = _resolveContextLinkTarget(target);
  return !!(linkTarget?.element && linkTarget.element === _linkContextLongPressElement);
}

function _suppressLinkContextLongPressFollowup(e) {
  if (!_linkContextLongPressMatches(e.target)) return false;
  e.preventDefault();
  e.stopImmediatePropagation();
  e.stopPropagation();
  return true;
}

document.addEventListener('contextmenu', (e) => {
  if (_suppressLinkContextLongPressFollowup(e)) return;
  const linkTarget = _resolveContextLinkTarget(e.target);
  if (!linkTarget) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  e.stopPropagation();
  _showLinkContextMenu(e, linkTarget);
}, true);

let _linkActivationTimer = null;
let _linkActivationToken = 0;

function _openContextLinkCurrent(linkTarget) {
  if (!linkTarget?.path) return;
  if (typeof linkTarget.openAction === 'function') {
    linkTarget.openAction();
    return;
  }
  openLink(linkTarget.path, linkTarget.label);
}

function _openContextLinkSubPanel(linkTarget) {
  if (!linkTarget?.path) return;
  if (typeof linkTarget.openAction === 'function') {
    linkTarget.openAction();
    return;
  }
  openLinkInSubPanel(linkTarget.path, linkTarget.label, {
    linkType: linkTarget.linkType || '',
    sourcePaneId: linkTarget.sourcePaneId || '',
  });
}

function _consumeUnifiedLinkEvent(e, linkTarget) {
  if (!linkTarget?.path) return false;
  e.preventDefault();
  e.stopImmediatePropagation();
  e.stopPropagation();
  removeTooltip();
  return true;
}

document.addEventListener('click', (e) => {
  if (e.button !== 0) return;
  if (_suppressLinkContextLongPressFollowup(e)) return;
  const linkTarget = _resolveContextLinkTarget(e.target);
  if (!_consumeUnifiedLinkEvent(e, linkTarget)) return;
  if (e.detail > 1) {
    ++_linkActivationToken;
    clearTimeout(_linkActivationTimer);
    _linkActivationTimer = null;
    return;
  }
  const token = ++_linkActivationToken;
  clearTimeout(_linkActivationTimer);
  _linkActivationTimer = setTimeout(() => {
    if (token !== _linkActivationToken) return;
    _openContextLinkSubPanel(linkTarget);
  }, 320);
}, true);

document.addEventListener('dblclick', (e) => {
  if (e.button !== 0) return;
  const linkTarget = _resolveContextLinkTarget(e.target);
  if (!_consumeUnifiedLinkEvent(e, linkTarget)) return;
  ++_linkActivationToken;
  clearTimeout(_linkActivationTimer);
  _linkActivationTimer = null;
  _openContextLinkCurrent(linkTarget);
}, true);

document.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
  if (e.button != null && e.button !== 0 && e.button !== -1) return;
  const linkTarget = _resolveContextLinkTarget(e.target);
  if (!linkTarget?.element) return;
  _clearLinkContextLongPress();
  _linkContextLongPressPointerId = e.pointerId;
  _linkContextLongPressStart = { x: e.clientX, y: e.clientY };
  _linkContextLongPressElement = linkTarget.element;
  _linkContextLongPressTimer = setTimeout(() => {
    const longPressPoint = _linkContextLongPressStart || { x: e.clientX, y: e.clientY };
    _linkContextLongPressTimer = null;
    _linkContextLongPressPointerId = null;
    _linkContextLongPressStart = null;
    _linkContextLongPressSuppressUntil = Date.now() + 900;
    try {
      e.preventDefault();
      e.stopPropagation();
    } catch {}
    const latestTarget = _resolveContextLinkTarget(_linkContextLongPressElement);
    if (!latestTarget) return;
    _showLinkContextMenu({
      clientX: longPressPoint.x,
      clientY: longPressPoint.y,
      target: _linkContextLongPressElement,
      preventDefault: () => e.preventDefault(),
      stopPropagation: () => e.stopPropagation(),
      stopImmediatePropagation: () => e.stopImmediatePropagation?.(),
    }, latestTarget);
  }, LINK_CONTEXT_LONG_PRESS_MS);
}, true);

document.addEventListener('pointermove', (e) => {
  if (_linkContextLongPressPointerId == null || e.pointerId !== _linkContextLongPressPointerId || !_linkContextLongPressStart) return;
  const dx = e.clientX - _linkContextLongPressStart.x;
  const dy = e.clientY - _linkContextLongPressStart.y;
  if (dx * dx + dy * dy > LINK_CONTEXT_LONG_PRESS_MOVE_TOLERANCE * LINK_CONTEXT_LONG_PRESS_MOVE_TOLERANCE) {
    _clearLinkContextLongPress();
  }
}, true);

document.addEventListener('pointerup', (e) => {
  if (_linkContextLongPressPointerId == null || e.pointerId !== _linkContextLongPressPointerId) return;
  _clearLinkContextLongPress();
}, true);

document.addEventListener('pointercancel', (e) => {
  if (_linkContextLongPressPointerId == null || e.pointerId !== _linkContextLongPressPointerId) return;
  _clearLinkContextLongPress();
}, true);

// 詳細パネルにファイルのメタ情報を表示
async function _showFileInfoInDetailPanel(filePath, preloadedMeta) {
  const fileName = filePath.split(/[/\\]/).pop();
  const ext = fileName.split('.').pop().toLowerCase();
  try {
    const meta = preloadedMeta || await fetch(API_BASE + '/file-meta?path=' + encodeURIComponent(filePath)).then(r => r.ok ? r.json() : null).catch(() => null);
    const folderPath = filePath.replace(/[/\\][^/\\]+$/, '');
    const folderName = folderPath.split(/[/\\]/).pop();
    const typeLabel = ext === 'md' ? 'ノート' : ext === 'json' ? 'シナリオ/シート' : ext === 'board' ? 'ボード' : ext;
    let html = `<div style="padding:12px;">`;
    html += `<div style="font-size:15px;font-weight:bold;margin-bottom:12px;display:flex;align-items:center;gap:6px;">${lucide(_fileIcon(ext),16)} ${esc(fileName)}</div>`;
    html += `<table style="font-size:13px;color:var(--fg2);width:100%;border-collapse:collapse;">`;
    html += `<tr><td style="padding:4px 8px 4px 0;color:var(--fg2);white-space:nowrap;">種類</td><td style="padding:4px 0;">${esc(typeLabel)}</td></tr>`;
    html += `<tr><td style="padding:4px 8px 4px 0;color:var(--fg2);white-space:nowrap;">フォルダ</td><td style="padding:4px 0;"><span class="auto-link" data-path="${esc(folderPath)}" style="color:var(--accent);cursor:pointer;">${esc(folderName)}</span></td></tr>`;
    html += `<tr><td style="padding:4px 8px 4px 0;color:var(--fg2);white-space:nowrap;">パス</td><td style="padding:4px 0;word-break:break-all;font-size:11px;">${esc(filePath)}</td></tr>`;
    if (meta) {
      if (meta.created) html += `<tr><td style="padding:4px 8px 4px 0;color:var(--fg2);white-space:nowrap;">作成日時</td><td style="padding:4px 0;">${new Date(meta.created).toLocaleString('ja-JP')}</td></tr>`;
      if (meta.modified) html += `<tr><td style="padding:4px 8px 4px 0;color:var(--fg2);white-space:nowrap;">更新日時</td><td style="padding:4px 0;">${new Date(meta.modified).toLocaleString('ja-JP')}</td></tr>`;
      if (meta.size != null) html += `<tr><td style="padding:4px 8px 4px 0;color:var(--fg2);white-space:nowrap;">サイズ</td><td style="padding:4px 0;">${_formatFileSize(meta.size)}</td></tr>`;
    }
    html += `</table><div data-global-tags-target-path="${esc(filePath)}"></div></div>`;
    if (typeof showDetailPanel === 'function') {
      await showDetailPanel(html);
      if (typeof hydrateGlobalTagTargetEditors === 'function') hydrateGlobalTagTargetEditors(document.getElementById('rp-detail') || document);
    }
  } catch {
    // ファイル情報取得失敗時も基本情報を表示（entity APIフォールバックは不要）
    if (typeof showDetailPanel === 'function') {
      await showDetailPanel(`<div style="padding:12px;"><div style="font-size:15px;font-weight:bold;margin-bottom:8px;">${lucide('fileText',16)} ${esc(fileName)}</div><div style="font-size:12px;color:var(--fg2);">${esc(filePath)}</div><div data-global-tags-target-path="${esc(filePath)}"></div></div>`);
      if (typeof hydrateGlobalTagTargetEditors === 'function') hydrateGlobalTagTargetEditors(document.getElementById('rp-detail') || document);
    }
  }
}

/* linked preview helper は gb-editor-preview.js に分離 */

// JSON ファイルの要約生成（シナリオ/キャンバス/スマートDB）
function _summarizeJson(raw) {
  try {
    const obj = JSON.parse(raw);
    // シナリオ
    if (Array.isArray(obj.rows)) {
      const chars = (obj.characters || []).map(c => c.name).join(', ');
      return `シナリオ — ${obj.rows.length}行` + (chars ? `\nキャラ: ${chars}` : '') + (obj.title ? `\nタイトル: ${obj.title}` : '');
    }
    // スマートDB
    if (obj.type === 'smart-db') {
      const filters = (obj.filters || []).length;
      const widgets = (obj.views?.dashboard?.widgets || []).length;
      return `スマートシート — フィルタ${filters}件` + (widgets ? `\nダッシュボード: ウィジェット${widgets}件` : '') + (obj.sourceDb ? `\nソース: ${obj.sourceDb.split('/').pop()}` : '');
    }
    // キャンバス（フロントマター付きMarkdown→JSONではないが念のため）
    return '';
  } catch { return ''; }
}

// リンクツールチップ
let tooltipEl = null;
let tooltipTimer = null;
let tooltipCache = {};

let _tooltipLink = null; // 現在ツールチップ表示中のリンク要素
let _tooltipSuppressedLink = null;
let _tooltipDescribedLink = null;
let _tooltipDescribedId = '';
let _tooltipIdSeq = 0;

function _clearAutoLinkTooltipDescription() {
  if (_tooltipDescribedLink && _tooltipDescribedId && document.documentElement.contains(_tooltipDescribedLink)) {
    const ids = (_tooltipDescribedLink.getAttribute('aria-describedby') || '')
      .split(/\s+/)
      .filter(id => id && id !== _tooltipDescribedId);
    if (ids.length) _tooltipDescribedLink.setAttribute('aria-describedby', ids.join(' '));
    else _tooltipDescribedLink.removeAttribute('aria-describedby');
  }
  _tooltipDescribedLink = null;
  _tooltipDescribedId = '';
}

function _attachAutoLinkTooltipDescription(link, tip) {
  _clearAutoLinkTooltipDescription();
  if (!link || !tip?.id) return;
  const ids = (link.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  if (!ids.includes(tip.id)) ids.push(tip.id);
  link.setAttribute('aria-describedby', ids.join(' '));
  _tooltipDescribedLink = link;
  _tooltipDescribedId = tip.id;
}

function _isAutoLinkTooltipSuppressed(link) {
  if (!_tooltipSuppressedLink) return false;
  if (!document.documentElement.contains(_tooltipSuppressedLink)) {
    _tooltipSuppressedLink = null;
    return false;
  }
  return link === _tooltipSuppressedLink || _tooltipSuppressedLink.contains(link);
}

function _clearAutoLinkTooltipSuppression() {
  _tooltipSuppressedLink = null;
}

function _queueAutoLinkTooltip(linkOrTarget) {
  const linkTarget = linkOrTarget?.path ? linkOrTarget : _resolveContextLinkTarget(linkOrTarget);
  const link = linkTarget?.element;
  if (!link || !linkTarget?.path) return;
  if (linkTarget.localAnchor || linkTarget.linkType === 'note-anchor' || _noteAnchorIdFromHref(linkTarget.path)) {
    clearTimeout(tooltipTimer);
    removeTooltip();
    return;
  }
  if (_tooltipSuppressedLink && !_tooltipSuppressedLink.contains(link)) _clearAutoLinkTooltipSuppression();
  if (_isAutoLinkTooltipSuppressed(link)) return;
  if (link === _tooltipLink) return; // 同じリンク上なら何もしない
  clearTimeout(tooltipTimer);
  removeTooltip();

  const path = linkTarget.path;
  if (!path) return;
  _tooltipLink = link;

  tooltipTimer = setTimeout(async () => {
    tooltipTimer = null;
    if (!tooltipCache[path]) {
      const fname = path.split(/[/\\]/).pop();
      const ext = fname.includes('.') ? fname.split('.').pop().toLowerCase() : '';
      if (/^(https?:|mailto:)/i.test(path)) {
        tooltipCache[path] = { title: linkTarget.label || fname || path, props: path };
      } else {
      try {
        const res = await fetch(API_BASE + '/entity?path=' + encodeURIComponent(path));
        if (!res.ok) throw new Error();
        const data = await res.json();
        const props = data.properties || {};
        const lines = [];
        for (const [k, vals] of Object.entries(props)) {
          const adopted = vals.find(v => v.status === '採用' || v.status === '掲載済み');
          if (adopted) lines.push(`${k}: ${adopted.value}`);
        }
        if (lines.length > 0) {
          tooltipCache[path] = { title: data.entity, props: lines.slice(0, 6).join('\n') };
        } else {
          // エンティティだがプロパティなし（DBフォルダ等）— エンティティ数を取得
          try {
            const params = new URLSearchParams({
              scope: path,
              filters: JSON.stringify([{ property: '' }]),
            });
            const [dbData, meta] = await Promise.all([
              apiFetch('/smart-db?' + params.toString()),
              apiFetch('/db-metadata?path=' + encodeURIComponent(path)),
            ]);
            const entityCount = Number(dbData.total_entities_scanned ?? dbData.entities?.length ?? 0);
            const propNames = Object.keys(meta.property_types || {}).slice(0, 5);
            const summary = `${entityCount}件のエントリ` + (propNames.length ? `\n項目: ${propNames.join(', ')}` : '');
            tooltipCache[path] = { title: data.entity || fname, props: summary };
          } catch {
            tooltipCache[path] = { title: data.entity || fname, props: data.page_content ? data.page_content.substring(0, 150).replace(/\n/g, ' ') : '' };
          }
        }
      } catch (e) {
        // entity APIが失敗: ファイルタイプ別に表示
        const imgExts = ['jpg','jpeg','png','gif','webp','svg','bmp','avif','ico'];
        const binaryExts = ['pdf','clip','psd','ai','zip','rar','7z','exe','dll','doc','docx','xls','xlsx','pptx'];
        if (imgExts.includes(ext)) {
          const url = (typeof API_BASE !== 'undefined' ? API_BASE : '') + '/file-raw?path=' + encodeURIComponent(path);
          tooltipCache[path] = { title: fname, props: '', img: url };
        } else if (binaryExts.includes(ext)) {
          tooltipCache[path] = { title: fname, props: '' };
        } else {
          try {
            const fd = await apiFetch('/file?path=' + encodeURIComponent(path));
            const raw = fd.content || '';
            // JSON（シナリオ/キャンバス/スマートDB/ダッシュボード）は要約表示
            if (ext === 'json') {
              tooltipCache[path] = { title: fname, props: _summarizeJson(raw) };
            } else {
              // テキストファイル: フロントマター除去して冒頭表示
              const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
              tooltipCache[path] = { title: fname, props: body.substring(0, 200).replace(/\n/g, ' ') };
            }
          } catch { tooltipCache[path] = { title: fname, props: '' }; }
        }
      }
      }
    }

    if (_tooltipLink !== link || !document.documentElement.contains(link)) return;
    const info = tooltipCache[path];
    removeTooltip();
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'link-tooltip';
    tooltipEl.id = 'link-tooltip-' + (++_tooltipIdSeq);
    tooltipEl.setAttribute('role', 'tooltip');
    tooltipEl.setAttribute('aria-hidden', 'false');

    const titleEl = document.createElement('div');
    titleEl.className = 'lt-title';
    titleEl.innerHTML = `${_linkIcon(path)} ${esc(info.title)}`;
    tooltipEl.appendChild(titleEl);

    if (info.img) {
      const preview = document.createElement('img');
      preview.className = 'lt-preview';
      preview.src = info.img;
      preview.alt = info.title || path.split(/[/\\]/).pop() || 'preview';
      tooltipEl.appendChild(preview);
    } else if (info.props) {
      const propsEl = document.createElement('div');
      propsEl.className = 'lt-props';
      propsEl.innerHTML = esc(info.props).replace(/\n/g, '<br>');
      tooltipEl.appendChild(propsEl);
    }

    const rect = link.getBoundingClientRect();
    const z = _getZoom();
    tooltipEl.style.left = (rect.left / z) + 'px';
    tooltipEl.style.top = (rect.bottom / z + 4) + 'px';
    document.body.appendChild(tooltipEl);
    _attachAutoLinkTooltipDescription(link, tooltipEl);

    if (typeof clampPopupToViewport === 'function') {
      clampPopupToViewport(tooltipEl);
    } else {
      const tr = tooltipEl.getBoundingClientRect();
      if (tr.right > window.innerWidth) tooltipEl.style.left = (Math.max(8, window.innerWidth - tr.width - 8) / z) + 'px';
      if (tr.bottom > window.innerHeight) tooltipEl.style.top = (Math.max(8, rect.top - tr.height - 4) / z) + 'px';
      const clamped = tooltipEl.getBoundingClientRect();
      if (clamped.left < 0) tooltipEl.style.left = (8 / z) + 'px';
      if (clamped.top < 0) tooltipEl.style.top = (8 / z) + 'px';
    }
  }, 400);
}

document.addEventListener('mouseover', (e) => {
  const linkTarget = _resolveContextLinkTarget(e.target);
  if (!linkTarget?.element) {
    // リンク外に出たら消す
    clearTimeout(tooltipTimer);
    removeTooltip();
    _clearAutoLinkTooltipSuppression();
    return;
  }
  _queueAutoLinkTooltip(linkTarget);
});

document.addEventListener('pointermove', (e) => {
  if (!_tooltipLink && !tooltipEl && !tooltipTimer) return;
  const linkTarget = _resolveContextLinkTarget(e.target);
  const link = linkTarget?.element || null;
  if (tooltipEl) {
    removeTooltip({ suppressLink: _tooltipLink });
    if (linkTarget) _queueAutoLinkTooltip(linkTarget);
    return;
  }
  if (!link) {
    removeTooltip();
    return;
  }
  if (_tooltipLink && link !== _tooltipLink && !_tooltipLink.contains(link)) {
    removeTooltip();
    _queueAutoLinkTooltip(linkTarget);
  }
});

document.addEventListener('mouseout', (e) => {
  if (!_tooltipSuppressedLink) return;
  if (!(e.relatedTarget instanceof Node) || !_tooltipSuppressedLink.contains(e.relatedTarget)) {
    _clearAutoLinkTooltipSuppression();
  }
});

// スクロールやクリック時にもツールチップを消す
document.addEventListener('scroll', removeTooltip, true);
document.addEventListener('click', removeTooltip, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (tooltipEl || tooltipTimer)) removeTooltip({ suppressLink: _tooltipLink });
}, true);

function removeTooltip(options = {}) {
  const suppressLink = options.suppressLink || null;
  clearTimeout(tooltipTimer);
  tooltipTimer = null;
  if (suppressLink && document.documentElement.contains(suppressLink)) {
    _tooltipSuppressedLink = suppressLink;
  }
  _clearAutoLinkTooltipDescription();
  _tooltipLink = null;
  if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
}

/* ==============================
   ファイル内検索・置換（Ctrl+F）
   ============================== */
let _fileSearchMatches = [];
let _fileSearchIdx = -1;
let _fileSearchLastQuery = '';
let _fileSearchLastRoot = null;

function openFileSearch(mode = 'find') {
  const bar = document.getElementById('file-search-bar');
  const replaceMode = String(mode || '').toLowerCase() === 'replace';
  bar.classList.add('open');
  bar.classList.toggle('replace-open', replaceMode);
  const q = document.getElementById('fsb-query');
  const r = document.getElementById('fsb-replace');
  q.value = ''; r.value = '';
  q.rows = 1; r.rows = 1;
  q.classList.remove('multiline'); r.classList.remove('multiline');
  document.getElementById('fsb-count').textContent = '';
  _fileSearchMatches = [];
  _fileSearchIdx = -1;
  _fileSearchLastQuery = '';
  _fileSearchLastRoot = null;
  q.focus();
}

// 検索/置換テキストエリアのキーイベントと複数行自動拡張
document.addEventListener('DOMContentLoaded', () => {
  const q = document.getElementById('fsb-query');
  const r = document.getElementById('fsb-replace');
  if (!q || !r) return;

  function autoResize(ta) {
    const lines = ta.value.split('\n').length;
    if (lines > 1) { ta.rows = Math.min(lines, 5); ta.classList.add('multiline'); }
    else { ta.rows = 1; ta.classList.remove('multiline'); }
  }

  let queryComposing = false;
  const isComposingQuery = (e) => queryComposing || e.isComposing || e.keyCode === 229;
  q.addEventListener('compositionstart', () => { queryComposing = true; });
  q.addEventListener('compositionend', () => {
    queryComposing = false;
    autoResize(q);
    doFileSearch(1);
  });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeFileSearch(); e.preventDefault(); return; }
    // Enter（Shift なし）: 次の検索結果へジャンプ。Shift+Enter: 改行入力
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isComposingQuery(e)) return;
      e.preventDefault();
      doFileSearch(1);
      return;
    }
  });
  q.addEventListener('input', () => autoResize(q));

  r.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeFileSearch(); e.preventDefault(); }
  });
  r.addEventListener('input', () => autoResize(r));
});

function closeFileSearch() {
  document.getElementById('file-search-bar').classList.remove('open');
  clearFileSearchHighlights();
}

function _currentFileSearchEditable() {
  if (state.view === 'entity') return document.getElementById('entity-freetext');
  if (state.view === 'page') return document.getElementById('page-content');
  return null;
}

function doFileSearch(direction) {
  const q = document.getElementById('fsb-query').value;
  if (!q) {
    clearFileSearchHighlights();
    _fileSearchMatches = [];
    _fileSearchIdx = -1;
    _fileSearchLastQuery = '';
    _fileSearchLastRoot = null;
    document.getElementById('fsb-count').textContent = '0/0';
    return;
  }

  // ボードビューの場合はボード内検索
  if (state.view === 'board') { doBoardSearch(q, direction); return; }

  const editable = _currentFileSearchEditable();
  if (!editable || !editable.isConnected) return;

  const previousIdx = _fileSearchIdx;
  const sameSearch = _fileSearchLastQuery === q && _fileSearchLastRoot === editable && previousIdx >= 0;
  clearFileSearchHighlights();

  // テキストノード内でマッチを検索
  const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
  _fileSearchMatches = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent;
    let idx = 0;
    const lq = q.toLowerCase();
    while (true) {
      const pos = text.toLowerCase().indexOf(lq, idx);
      if (pos === -1) break;
      _fileSearchMatches.push({ node, pos, len: q.length });
      idx = pos + q.length;
    }
  }

  if (_fileSearchMatches.length === 0) {
    document.getElementById('fsb-count').textContent = '0/0';
    return;
  }

  // ハイライト表示（CSS highlight APIの代わりにmark要素で）
  // 逆順で挿入してインデックスがずれないようにする
  for (let i = _fileSearchMatches.length - 1; i >= 0; i--) {
    const m = _fileSearchMatches[i];
    const range = document.createRange();
    range.setStart(m.node, m.pos);
    range.setEnd(m.node, m.pos + m.len);
    const mark = document.createElement('mark');
    mark.className = 'file-search-highlight';
    mark.style.cssText = 'background:var(--orange);color:#000;border-radius:1px;';
    try { range.surroundContents(mark); } catch (e) { /* クロスエレメント範囲はスキップ */ }
  }

  // 再収集（markで囲んだのでノードが変わった）
  const marks = editable.querySelectorAll('mark.file-search-highlight');
  if (sameSearch) {
    const step = direction > 0 ? 1 : -1;
    _fileSearchIdx = (previousIdx + step + marks.length) % marks.length;
  } else {
    _fileSearchIdx = direction > 0 ? 0 : marks.length - 1;
  }
  _fileSearchLastQuery = q;
  _fileSearchLastRoot = editable;
  if (_fileSearchIdx >= 0 && _fileSearchIdx < marks.length) {
    marks[_fileSearchIdx].style.outline = '2px solid var(--accent)';
    marks[_fileSearchIdx].scrollIntoView({ block: 'center' });
  }
  document.getElementById('fsb-count').textContent = `${_fileSearchIdx + 1}/${marks.length}`;
}

// --- ボード内検索 ---
function doBoardSearch(q, direction) {
  // Phase D: ボード検索は直接bdFindReplace()を呼ぶ（簡易検索: ノード選択のみ）
  if (typeof bd !== 'undefined' && q) {
    bd.selected = new Set();
    bd.nodes.forEach(n => { if (n.text && n.text.includes(q)) bd.selected.add(n.id); });
    document.querySelectorAll('.bd-node').forEach(el => el.classList.toggle('bd-selected', bd.selected.has(el.id.replace('bdn-', ''))));
    showStatus(bd.selected.size + '件のカードが見つかりました');
  }
}

function clearBoardSearchHighlights() {
  if (typeof bd !== 'undefined') {
    bd.selected = new Set();
    document.querySelectorAll('.bd-node').forEach(el => el.classList.remove('bd-selected'));
  }
}

function clearFileSearchHighlights() {
  const editables = [document.getElementById('page-content'), document.getElementById('entity-freetext')];
  editables.forEach(el => {
    if (!el) return;
    el.querySelectorAll('mark.file-search-highlight').forEach(mark => {
      mark.replaceWith(...mark.childNodes);
    });
    el.normalize();
  });
  // ボード検索ハイライトもクリア
  clearBoardSearchHighlights();
}

function _currentFileSearchMark(editable) {
  const marks = editable?.querySelectorAll?.('mark.file-search-highlight') || [];
  if (!marks.length) return null;
  const index = _fileSearchIdx >= 0 && _fileSearchIdx < marks.length ? _fileSearchIdx : 0;
  return marks[index] || null;
}

function _refreshFileSearchAfterSingleReplace(editable, replacedIndex) {
  const marks = editable?.querySelectorAll?.('mark.file-search-highlight') || [];
  if (!marks.length) {
    _fileSearchMatches = [];
    _fileSearchIdx = -1;
    document.getElementById('fsb-count').textContent = '0/0';
    return;
  }
  _fileSearchIdx = Math.min(Math.max(0, replacedIndex), marks.length - 1);
  marks.forEach(mark => { mark.style.outline = ''; });
  marks[_fileSearchIdx].style.outline = '2px solid var(--accent)';
  marks[_fileSearchIdx].scrollIntoView({ block: 'center' });
  document.getElementById('fsb-count').textContent = `${_fileSearchIdx + 1}/${marks.length}`;
}

function _commitFileSearchReplacement(editable) {
  editable.dispatchEvent(new Event('input', { bubbles: true }));
  editable.dispatchEvent(new Event('blur'));
}

function doFileReplace(all) {
  const q = document.getElementById('fsb-query').value;
  const r = document.getElementById('fsb-replace').value;
  if (!q) return;

  const editable = _currentFileSearchEditable();
  if (!editable || !editable.isConnected) {
    document.getElementById('fsb-count').textContent = 'この画面ではノート本文の置換はできません';
    if (typeof showStatus === 'function') showStatus('この画面ではノート本文の置換はできません', true);
    return;
  }

  if (!all) {
    if (!_currentFileSearchMark(editable) || _fileSearchLastQuery !== q || _fileSearchLastRoot !== editable) {
      doFileSearch(1);
    }
    const currentMark = _currentFileSearchMark(editable);
    if (!currentMark) {
      document.getElementById('fsb-count').textContent = '0件置換';
      return;
    }
    const replacedIndex = Math.max(0, _fileSearchIdx);
    currentMark.replaceWith(document.createTextNode(r));
    editable.normalize();
    _refreshFileSearchAfterSingleReplace(editable, replacedIndex);
    document.getElementById('fsb-count').textContent = '1件置換';
    _commitFileSearchReplacement(editable);
    return;
  }

  clearFileSearchHighlights();

  // テキストノード単位で置換（HTMLタグ内を誤置換しない）
  const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  let count = 0;
  const lq = q.toLowerCase();
  for (const node of textNodes) {
    const text = node.textContent;
    const idx = text.toLowerCase().indexOf(lq);
    if (idx === -1) continue;

    if (all) {
      // 全置換: 大文字小文字無視で全一致を置換
      const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = text.match(regex);
      count += matches ? matches.length : 0;
      node.textContent = text.replace(regex, () => r);
    }
  }

  document.getElementById('fsb-count').textContent = `${count}件置換`;
  if (count > 0) _commitFileSearchReplacement(editable);
}

/* ==============================
   ルビ設定（右クリックメニュー）
   #page-title 等のノート編集以外の contenteditable 向け。
   全域抑止と board 早期 return は meldex-core.part02.js の capture ハンドラへ移管済み。
   ノート編集用 editable (#entity-freetext/#page-content/#dp-editable) は
   bindNoteEditorContextMenu 側のメニュー内「ルビを設定...」項目が担当する。
   ============================== */
function _editorPointRect(x, y) {
  const left = Number.isFinite(x) ? x : 0;
  const top = Number.isFinite(y) ? y : 0;
  return { left, right: left, top, bottom: top, width: 0, height: 0 };
}

function _editorEventAnchorRect(e, fallbackEl) {
  const fallback = fallbackEl?.getBoundingClientRect?.();
  const x = Number.isFinite(e?.clientX) && e.clientX > 0 ? e.clientX : (fallback?.left || 12);
  const y = Number.isFinite(e?.clientY) && e.clientY > 0 ? e.clientY : (fallback?.top || 12);
  return _editorPointRect(x, y);
}

function _positionEditorPopup(popup, anchorRect) {
  if (!popup) return;
  if (typeof positionPopup === 'function') {
    positionPopup(popup, anchorRect);
    return;
  }
  const z = typeof _getZoom === 'function' ? (_getZoom() || 1) : 1;
  popup.style.left = ((anchorRect?.left || 12) / z) + 'px';
  popup.style.top = ((anchorRect?.bottom ?? anchorRect?.top ?? 12) / z) + 'px';
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(popup);
}

function _editorMenuSeparator() {
  const sep = document.createElement('div');
  sep.className = 'gb-context-menu-sep';
  sep.setAttribute('role', 'separator');
  return sep;
}

function _editorMenuButton(label, enabled, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'gb-context-menu-item';
  button.setAttribute('role', 'menuitem');
  button.textContent = label;
  if (!enabled) {
    button.classList.add('disabled');
    button.disabled = true;
    button.setAttribute('aria-disabled', 'true');
  }
  button.addEventListener('click', (event) => {
    event.preventDefault();
    if (!enabled) return;
    onClick?.(event, button);
  });
  return button;
}

function _closeEditorPopup(popup, cleanup, restoreFocusEl) {
  if (!popup) return;
  if (popup.isConnected) popup.remove();
  cleanup?.();
  if (restoreFocusEl?.isConnected && typeof restoreFocusEl.focus === 'function') restoreFocusEl.focus();
}

function _pageTitleRubyHandler(e) {
  const editable = e.target.closest('[contenteditable="true"]');
  if (!editable) return;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
  // 念のため: 万一ノート編集 editable に届いた場合はノートメニューに任せる
  if (editable.id === 'entity-freetext' || editable.id === 'page-content' || editable.id === 'dp-editable') return;

  e.preventDefault();
  const selectedText = sel.toString().trim();

  // 既存のルビメニューを閉じる
  document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());

  // 選択範囲を保存
  const savedRange = sel.getRangeAt(0).cloneRange();
  const savedEditable = editable;

  const menu = document.createElement('div');
  menu.className = 'gb-context-menu note-ruby-popup page-title-ruby-popup';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', 'ページタイトルにルビを設定');
  // mousedownでフォーカスを奪わない
  menu.addEventListener('mousedown', (ev) => { if (ev.target.tagName !== 'INPUT') ev.preventDefault(); });
  const label = document.createElement('div');
  label.className = 'note-ruby-popup-label';
  label.textContent = `「${selectedText.slice(0, 20)}」にルビを設定`;
  const row = document.createElement('div');
  row.className = 'note-ruby-popup-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'ruby-input';
  input.className = 'gb-input note-ruby-input';
  input.placeholder = 'ルビを入力...';
  input.setAttribute('aria-label', 'ページタイトルのルビ');
  input.dataset.e2eId = 'page-title-ruby-input';
  // 開くと同時に自動フォーカスされるため、フォーカス由来のツールチップは出さない
  input.setAttribute('data-gb-tooltip-disabled', 'true');
  const applyButton = document.createElement('button');
  applyButton.type = 'button';
  applyButton.className = 'gb-btn gb-btn-sm gb-btn-primary note-ruby-ok';
  applyButton.id = 'ruby-apply-btn';
  applyButton.dataset.e2eId = 'page-title-ruby-apply';
  applyButton.textContent = '設定';
  row.append(input, applyButton);
  menu.append(label, row);
  document.body.appendChild(menu);
  _positionEditorPopup(menu, _editorEventAnchorRect(e, editable));
  // blurで再描画されないよう一時的に無効化
  const origBlur = savedEditable.onblur;
  savedEditable.onblur = null;
  input.focus();
  // メニューが閉じたらblurを復元
  const restoreBlur = () => { savedEditable.onblur = origBlur; };
  window._rubyRestoreBlur = restoreBlur;
  let outsideCloser = null;
  let keyCloser = null;
  const cleanupRubyPopup = () => {
    if (outsideCloser) document.removeEventListener('pointerdown', outsideCloser, true);
    if (keyCloser) document.removeEventListener('keydown', keyCloser, true);
    outsideCloser = null;
    keyCloser = null;
    if (window._rubyRestoreBlur) { window._rubyRestoreBlur(); window._rubyRestoreBlur = null; }
  };

  function doApply() {
    const ruby = input.value.trim();
    _closeEditorPopup(menu, cleanupRubyPopup);
    if (!ruby) return;

    const path = savedEditable.dataset?.path || savedEditable.dataset?.entityPath;
    const ep = savedEditable.dataset.entityPath || '';
    const isNewFormatFreetext = savedEditable.id === 'entity-freetext' && ep.endsWith('.md');
    const savePath = savedEditable.id === 'entity-freetext'
      ? (isNewFormatFreetext ? ep : ep + '/_freetext.md')
      : (path || '');
    if (!savePath) return;

    // --- ルビ適用 ---
    // 自動保存タイマーをキャンセル（normalize()でRangeが無効化されるのを防止）
    clearTimeout(window._noteAutoSaveTimer);

    savedEditable.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);

    // カスタムアンドゥ用にスナップショットを保存
    _pushCustomUndo(savedEditable);

    // 既存のルビspan全体を選択している場合はルビ値を上書き
    const existingRuby = savedRange.startContainer.parentElement?.closest('[data-ruby]');
    if (existingRuby && savedRange.toString().trim() === existingRuby.textContent.trim()) {
      existingRuby.dataset.ruby = ruby;
    } else {
      // 選択範囲をruby spanで囲む（DOM直接操作）
      const span = document.createElement('span');
      span.dataset.ruby = ruby;
      span.style.position = 'relative';
      try {
        savedRange.surroundContents(span);
      } catch (e) {
        const fragment = savedRange.extractContents();
        span.appendChild(fragment);
        savedRange.insertNode(span);
      }
    }

    // ペンディング中の自動保存をキャンセルし、即時保存
    clearTimeout(window._noteAutoSaveTimer);
    savedEditable.querySelectorAll('mark.file-search-highlight').forEach(m => m.replaceWith(...m.childNodes));
    savedEditable.normalize();
    let md = htmlToMd(savedEditable.innerHTML);
    if (!md.trim()) return;
    const fm = savedEditable.dataset.frontmatter || '';
    if (fm) md = fm + md;

    const savePromise = isNewFormatFreetext
      ? apiPut('/value?path=' + encodeURIComponent(savePath), { new_body: md })
      : apiPut('/file?path=' + encodeURIComponent(savePath), { content: md });
    savePromise.then(() => {
      // 保存後にDOM再描画（auto-link再適用のため）
      const bodyMd = md.replace(/^---\n[\s\S]*?\n---\n?/, '');
      const reHtml = mdToHtml(bodyMd);
      savedEditable.innerHTML = applyAutoLinks(reHtml, savePath);
      // ルビを設定したテキストの直後にカーソルを配置
      savedEditable.focus();
      const rubySpans = savedEditable.querySelectorAll('[data-ruby]');
      for (const span of rubySpans) {
        if (span.textContent.includes(selectedText)) {
          const s = window.getSelection();
          const r = document.createRange();
          r.setStartAfter(span);
          r.collapse(true);
          s.removeAllRanges();
          s.addRange(r);
          span.scrollIntoView({ block: 'center' });
          break;
        }
      }
      showStatus('ルビを設定しました');
    }).catch(() => {});
  }

  applyButton.addEventListener('click', doApply);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); doApply(); }
    if (ev.key === 'Escape') { ev.preventDefault(); _closeEditorPopup(menu, cleanupRubyPopup, savedEditable); }
    ev.stopPropagation();
  });

  outsideCloser = function closer(ev) {
    if (!menu.contains(ev.target)) {
      _closeEditorPopup(menu, cleanupRubyPopup, savedEditable);
    }
  };
  keyCloser = function onKey(ev) {
    // Tab / Shift+Tab はポップアップ内の項目切り替え（ルビ設定ポップアップ共通挙動）
    if (ev.key === 'Tab') {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof gbCyclePopupFocus === 'function') gbCyclePopupFocus(menu, ev.shiftKey);
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      _closeEditorPopup(menu, cleanupRubyPopup, savedEditable);
    }
  };
  setTimeout(() => {
    document.addEventListener('pointerdown', outsideCloser, true);
    document.addEventListener('keydown', keyCloser, true);
  }, 0);
}

{
  const _pageTitleEl = document.getElementById('page-title');
  if (_pageTitleEl) {
    _pageTitleEl.addEventListener('contextmenu', _pageTitleRubyHandler);
    if (typeof addLongPressHandler === 'function') addLongPressHandler(_pageTitleEl, _pageTitleRubyHandler);
  }
}

/* ==============================
   Notion風キーボードショートカット
   ============================== */
// 書式ショートカット（Ctrl+B/I/U/E、Ctrl+Shift+1-9/0/H、Tab等）
// Ctrl+F/Shift+F、Alt+↓ → gb-shortcuts.js の中央ハンドラに移行済み

// 残存ハンドラ: F2/Delete（フォルダツリー操作）、Shift+F10（キーボード右クリック）、
//               Escape（検索パネルを閉じる）
document.addEventListener('keydown', async (e) => {
  if (e.defaultPrevented) return;

  const isEditing = document.activeElement?.contentEditable === 'true' || document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';

  // F2: フォルダツリーのインラインリネーム（フォルダビュー・ボード・エディタ中は除外）
  if (e.key === 'F2' && !isEditing && state.view !== 'folder' && state.view !== 'board' && treeSelection.lastClicked) {
    e.preventDefault();
    const nd = treeSelection.lastClicked._nodeData;
    const lbl = treeSelection.lastClicked.querySelector('.tree-label');
    if (nd && lbl && nd.type !== 'entity' && !nd._isRoot && !(nd.path && isItemLocked(nd.path))) startTreeLabelEdit(lbl, nd);
    return;
  }
  // Delete: フォルダツリーのツリー項目削除
  // ユーザーの最後のポインタ操作がフォルダツリー内にあった場合だけ発火する。
  // 以前は !isEditing のみを見ていたため、エディタから Esc/blur でフォーカスを body に戻した直後の
  // Delete で意図せずツリー側の選択ファイルが削除されていた。
  // tree-node 自体は tabindex を持たないので activeElement は当てにならず、
  // gb-app.js の pointerdown リスナーが window._lastPointerInTree を更新する。
  const active = document.activeElement;
  const inTreeByFocus = !!(active && (active.id === 'outliner-tree' || active.closest?.('#outliner-tree') || active.closest?.('.tree-node')));
  const inTreeByPointer = !!window._lastPointerInTree;
  if (e.key === 'Delete' && !isEditing && (inTreeByFocus || inTreeByPointer) && treeSelection.items.size > 0 && state.view !== 'folder' && state.view !== 'board') {
    const items = [...treeSelection.items].map(n => n._nodeData).filter(d => d && !d._isRoot && !(d.path && isItemLocked(d.path)));
    if (items.length === 0) return;
    if (!await cfConfirm(items.length + ' 件を削除しますか？')) return;
    deleteOutlinerItemsWithHistory(items, {
      label: items.length + ' 件を削除',
      onItemDeleted: (item) => {
        if (typeof _removeOutlinerNodesForPaths === 'function') _removeOutlinerNodesForPaths([item.path]);
      },
      refresh: async () => {
        if (typeof loadOutliner === 'function') await loadOutliner();
        if (typeof renderWorkspaceSidebar === 'function') renderWorkspaceSidebar();
      },
    }).then((result) => {
      const deletedCount = result.deletedCount || result.succeeded.length;
      showStatus(deletedCount + ' 件を削除しました（Undoで戻せます）' + (result.failedCount ? `（${result.failedCount}件失敗）` : ''), result.failedCount > 0);
      if (typeof loadOutliner === 'function') loadOutliner();
    });
    return;
  }

  // Escape: 検索パネルを閉じる（中央ハンドラではEscapeをglobalに登録していないため残存）
  if (e.key === 'Escape') {
    if (document.getElementById('file-search-bar').classList.contains('open')) { closeFileSearch(); e.preventDefault(); return; }
    if (document.getElementById('search-panel').classList.contains('open')) { closeSearchPanel(); e.preventDefault(); return; }
  }

  // Shift+F10: 右クリックメニューをキーボードで呼び出し
  if (e.key === 'F10' && e.shiftKey) {
    e.preventDefault();
    const el = document.activeElement;
    const rect = el ? el.getBoundingClientRect() : { left: 100, top: 100, bottom: 120 };
    const sel = window.getSelection();
    let x = rect.left + 20, y = rect.top + 20;
    if (sel && !sel.isCollapsed) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      x = r.left; y = r.bottom;
    }
    const evt = new MouseEvent('contextmenu', { clientX: x, clientY: y, bubbles: true, cancelable: true });
    (el || document.body).dispatchEvent(evt);
    return;
  }
});

function moveBlock(direction) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  let node = sel.anchorNode;
  while (node && node.nodeType === 3) node = node.parentNode;
  const editable = document.activeElement;
  if (!node || node === editable) return;
  const beforeHtml = editable.innerHTML;
  let undoPushed = false;
  const pushCustomUndo = () => {
    if (undoPushed || typeof _pushCustomUndo !== 'function') return;
    _pushCustomUndo(editable);
    undoPushed = true;
  };

  const markerId = '_mv_' + Date.now();
  const li = node.closest ? node.closest('li') : null;

  if (li && editable.contains(li)) {
    const sibling = direction === 'up' ? li.previousElementSibling : li.nextElementSibling;
    if (sibling) {
      // 同一リスト内のLI入れ替え
      pushCustomUndo();
      _swapAdjacent(li, sibling, direction, sel, markerId);
    } else {
      // リスト境界: この1項目だけを抽出して移動
      _moveLiAcrossBoundary(li, direction, editable, sel, markerId, pushCustomUndo);
    }
  } else {
    // リスト外ブロック
    while (node && node !== editable && node.parentNode !== editable) node = node.parentNode;
    if (!node || node === editable) return;
    const sibling = direction === 'up' ? node.previousElementSibling : node.nextElementSibling;
    if (!sibling) return;

    // 隣接要素がリスト(UL/OL)またはリストを含む要素なら、そのリストにLIとして合流
    let targetList = null;
    if (sibling.tagName === 'UL' || sibling.tagName === 'OL') {
      targetList = sibling;
    } else {
      targetList = sibling.querySelector('ul, ol');
    }
    if (targetList) {
      pushCustomUndo();
      const newLi = document.createElement('li');
      newLi.innerHTML = node.innerHTML;
      newLi.setAttribute('data-mv', markerId);
      if (direction === 'down') {
        targetList.insertBefore(newLi, targetList.firstElementChild);
      } else {
        targetList.appendChild(newLi);
      }
      node.remove();
    } else {
      pushCustomUndo();
      _swapAdjacent(node, sibling, direction, sel, markerId);
    }
  }

  // カーソルを移動先の要素に配置
  const moved = editable.querySelector('[data-mv="' + markerId + '"]');
  if (moved) {
    moved.removeAttribute('data-mv');
    const r = document.createRange();
    r.selectNodeContents(moved);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
    moved.scrollIntoView({ block: 'nearest' });
  }
  if (editable.innerHTML !== beforeHtml) {
    editable.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// 隣接する2要素を入れ替え（DOM直接操作、カスタムアンドゥで対応）
function _swapAdjacent(target, sibling, direction, sel, markerId) {
  target.setAttribute('data-mv', markerId);
  if (direction === 'up') {
    target.parentNode.insertBefore(target, sibling);
  } else {
    target.parentNode.insertBefore(sibling, target);
  }
}

// リスト境界でLIを1項目だけ移動（同じ階層を維持する）
function _moveLiAcrossBoundary(li, direction, editable, sel, markerId, beforeMutate) {
  const parentList = li.parentNode; // UL or OL
  const listTag = parentList.tagName; // 'UL' or 'OL'

  // 親リストを含む最も近いブロック要素（editable直下まで辿る）
  let listBlock = parentList;
  while (listBlock.parentNode !== editable) listBlock = listBlock.parentNode;

  // listBlockの隣接要素を取得
  const adjacent = direction === 'up'
    ? listBlock.previousElementSibling
    : listBlock.nextElementSibling;
  if (!adjacent) return;

  // ケース1: 隣接要素の中に同タイプのリストがあれば合流
  // （隣がリストそのもの、または隣の内部にリストがある場合）
  let targetList = null;
  if (adjacent.tagName === listTag) {
    targetList = adjacent;
  } else {
    // 隣の要素内（LI, DIV等）から同タイプのリストを探す
    targetList = adjacent.querySelector(listTag.toLowerCase());
  }
  if (targetList) {
    beforeMutate?.();
    li.setAttribute('data-mv', markerId);
    parentList.removeChild(li);
    if (direction === 'up') {
      targetList.appendChild(li);
    } else {
      targetList.insertBefore(li, targetList.firstElementChild);
    }
    if (parentList.children.length === 0) {
      // 空リストを削除。親が空のDIV等なら一緒に削除
      const p = parentList.parentNode;
      parentList.remove();
      if (p !== editable && p.children.length === 0 && !p.textContent.trim()) p.remove();
    }
    return;
  }

  // ケース2: 隣にリストがない → LIをdivとして抽出
  const div = document.createElement('div');
  div.innerHTML = li.innerHTML;
  div.setAttribute('data-mv', markerId);
  beforeMutate?.();
  parentList.removeChild(li);
  if (direction === 'up') {
    editable.insertBefore(div, listBlock);
  } else {
    listBlock.nextSibling
      ? editable.insertBefore(div, listBlock.nextSibling)
      : editable.appendChild(div);
  }
  if (parentList.children.length === 0) {
    const p = parentList.parentNode;
    parentList.remove();
    if (p !== editable && p.children.length === 0 && !p.textContent.trim()) p.remove();
  }
}

// ノートエディタ用ルビ入力ポップアップ。
// シナリオエディタの sn2-header-popup と同パターン（positionPopup + 範囲基準）。
function showNoteRubyPopup(editable, range) {
  if (!editable || !range) return;
  document.querySelectorAll('.note-ruby-popup').forEach(el => el.remove());
  const text = range.toString();
  if (!text) return;
  const popup = document.createElement('div');
  popup.className = 'gb-context-menu note-ruby-popup';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', 'ノート本文にルビを設定');
  const label = document.createElement('div');
  label.className = 'note-ruby-popup-label';
  label.textContent = `「${text.slice(0, 20)}」にルビを設定`;
  const row = document.createElement('div');
  row.className = 'note-ruby-popup-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'gb-input note-ruby-input';
  input.placeholder = 'ルビを入力...';
  input.setAttribute('aria-label', 'ノート本文のルビ');
  input.dataset.e2eId = 'note-ruby-input';
  // 開くと同時に自動フォーカスされるため、フォーカス由来のツールチップは出さない
  input.setAttribute('data-gb-tooltip-disabled', 'true');
  const applyButton = document.createElement('button');
  applyButton.type = 'button';
  applyButton.className = 'gb-btn gb-btn-sm gb-btn-primary note-ruby-ok';
  applyButton.dataset.e2eId = 'note-ruby-apply';
  applyButton.textContent = '設定';
  row.append(input, applyButton);
  popup.append(label, row);
  popup.addEventListener('mousedown', ev => { if (ev.target.tagName !== 'INPUT') ev.preventDefault(); });
  document.body.appendChild(popup);
  _positionEditorPopup(popup, range.getBoundingClientRect());
  let closeHandler = null;
  let keyHandler = null;
  const cleanup = () => {
    if (closeHandler) document.removeEventListener('pointerdown', closeHandler, true);
    if (keyHandler) document.removeEventListener('keydown', keyHandler, true);
    closeHandler = null;
    keyHandler = null;
  };
  const apply = () => {
    const ruby = input.value.trim();
    _closeEditorPopup(popup, cleanup);
    if (!ruby) return;
    editable.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    _pushCustomUndo(editable);
    const rangeRoot = range.commonAncestorContainer?.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer?.parentElement;
    const existingRuby = rangeRoot?.closest?.('[data-ruby]');
    let span = existingRuby && editable.contains(existingRuby) && range.toString().trim() === existingRuby.textContent.trim()
      ? existingRuby
      : null;
    if (span) {
      span.dataset.ruby = ruby;
    } else {
      span = document.createElement('span');
      span.dataset.ruby = ruby;
      span.style.position = 'relative';
      span.textContent = text;
      range.deleteContents();
      range.insertNode(span);
    }
    const r2 = document.createRange();
    r2.setStartAfter(span);
    r2.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r2);
    editable.dispatchEvent(new Event('input', { bubbles: true }));
    showStatus('ルビを設定しました');
  };
  applyButton.addEventListener('click', apply);
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); apply(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); _closeEditorPopup(popup, cleanup, editable); }
    ev.stopPropagation();
  });
  closeHandler = function onPointerDown(ev) {
    if (!popup.contains(ev.target)) _closeEditorPopup(popup, cleanup, editable);
  };
  keyHandler = function onKeyDown(ev) {
    // Tab / Shift+Tab はポップアップ内の項目切り替え（ルビ設定ポップアップ共通挙動）
    if (ev.key === 'Tab') {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof gbCyclePopupFocus === 'function') gbCyclePopupFocus(popup, ev.shiftKey);
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      _closeEditorPopup(popup, cleanup, editable);
    }
  };
  setTimeout(() => {
    document.addEventListener('pointerdown', closeHandler, true);
    document.addEventListener('keydown', keyHandler, true);
    input.focus();
  }, 0);
}

async function confirmNoteTableDelete(message) {
  if (typeof cfConfirm === 'function') return !!(await cfConfirm(message));
  if (typeof confirm === 'function') return !!confirm(message);
  return true;
}

// ノート/自由記述の右クリックメニュー
// 旧: document 委譲 → editable コンテナ個別登録へ移行（global-contextmenu-refactor-plan.md）
function _noteCtxMenuHandler(e) {
  const editable = e.currentTarget;
  if (!editable || editable.contentEditable !== 'true') return;
  e.preventDefault();
  closeColHeaderMenu();
  document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());

  const sel = window.getSelection();
  const selectionRange = sel && !sel.isCollapsed && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
  const hasSelection = !!(selectionRange && _rangeBelongsToEditable(editable, selectionRange));
  const savedRange = hasSelection ? selectionRange.cloneRange() : null;
  const anchorSourceRect = e.target?.getBoundingClientRect?.() || editable.getBoundingClientRect();
  const anchorX = Number.isFinite(e.clientX) && e.clientX > 0 ? e.clientX : anchorSourceRect.left;
  const anchorY = Number.isFinite(e.clientY) && e.clientY > 0 ? e.clientY : anchorSourceRect.top;
  const commentAnchorEl = {
    getBoundingClientRect: () => ({ left: anchorX, right: anchorX, top: anchorY, bottom: anchorY, width: 0, height: 0 }),
  };

  // 選択を復元してからアクションを実行するヘルパー
  const restoreAndExec = (action) => {
    editable.focus();
    if (savedRange) {
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(savedRange.cloneRange());
    }
    action();
  };

  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'ノート本文メニュー');
  // mousedownで選択が消えないようにpreventDefault
  menu.addEventListener('mousedown', (ev) => ev.preventDefault());

  // 選択範囲を復元してから execCommand を実行するヘルパー（書式ポップアップ用）
  const applyFormat = (cmd, value) => {
    editable.focus();
    if (savedRange) {
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(savedRange.cloneRange());
    }
    document.execCommand(cmd, false, value);
  };

  // Audit-P1 H-2: 右クリック時点で e.target から明示コンテキストを構築し、
  // addCommentHere に override として渡す（detectCommentContext の DOM スキャンに頼らない）。
  const _ctxScanEl = e.target;
  const _ctxTargetEl = _ctxScanEl?.nodeType === Node.ELEMENT_NODE ? _ctxScanEl : _ctxScanEl?.parentElement;
  const _commentHighlightEl = _ctxTargetEl?.closest?.('.cmt-highlight,.cmt-line-highlight');
  const items = [
    { label: 'コメントを追加', enabled: true, action: () => restoreAndExec(() => {
      if (typeof addCommentHere !== 'function') return;
      let override = null;
      try {
        if (typeof CommentBadges !== 'undefined' && typeof CommentBadges.detectCommentContext === 'function') {
          override = CommentBadges.detectCommentContext(_ctxScanEl);
        }
      } catch (_) { override = null; }
      addCommentHere(override || undefined, { anchorEl: commentAnchorEl });
    }) },
    { type: 'sep' },
    { label: '切り取り', enabled: hasSelection, action: () => restoreAndExec(() => document.execCommand('cut')) },
    { label: 'コピー', enabled: hasSelection, action: () => restoreAndExec(() => document.execCommand('copy')) },
    { label: '貼り付け', enabled: true, action: () => restoreAndExec(() => navigator.clipboard.readText().then(t => document.execCommand('insertText', false, t)).catch(() => {})) },
    { type: 'sep' },
    { label: '元に戻す', enabled: true, action: () => { editable.focus(); document.execCommand('undo'); } },
    { label: 'やり直し', enabled: true, action: () => { editable.focus(); document.execCommand('redo'); } },
    { type: 'sep' },
    { label: 'すべて選択', enabled: true, action: () => { editable.focus(); document.execCommand('selectAll'); } },
    { type: 'sep' },
    { type: 'format', label: '書式…', enabled: hasSelection },
    { type: 'sep' },
    { label: 'Googleで検索', enabled: hasSelection, action: () => {
      const query = (savedRange ? savedRange.toString() : (sel ? sel.toString() : '')).trim();
      if (!query) return;
      const url = 'https://www.google.com/search?q=' + encodeURIComponent(query);
      try { window.open(url, '_blank', 'noopener,noreferrer'); }
      catch { window.location.href = url; }
    }},
    { type: 'sep' },
    { label: 'ルビを設定...', enabled: hasSelection, action: () => {
      if (!savedRange) return;
      showNoteRubyPopup(editable, savedRange);
    }},
    { label: 'リンクを挿入...', enabled: true, action: () => {
      restoreAndExec(() => {});
      showLinkInsertModal(savedRange);
    }},
    { label: 'リンクを解除', enabled: !!_ctxTargetEl?.closest('a'), action: () => restoreAndExec(() => document.execCommand('unlink')) },
  ];
  if (_commentHighlightEl) {
    items.unshift(
      { label: 'コメント一覧を開く', enabled: true, action: () => {
        const filePath = _commentHighlightEl.dataset.cmtFile || editable.dataset.path || document.getElementById('page-content')?.dataset.path || state.currentPagePath || '';
        if (typeof CommentBadges !== 'undefined' && typeof CommentBadges.openPanelForFileComments === 'function') {
          CommentBadges.openPanelForFileComments(filePath);
        }
      } },
      { type: 'sep' },
    );
  }

  // テーブルセル右クリック時の行列操作
  // リファクタで editable コンテナ委譲となったため、editable 内の table に限定される。
  // 旧セレクタで拾えていなかった #dp-editable 内 table もここで拾えるようになる（4-7 修正）。
  const _ctxCell = e.target.closest('td, th');
  const _ctxTable = _ctxCell ? _ctxCell.closest('table') : null;
  if (_ctxCell && _ctxTable) {
    const pushTableUndo = () => {
      if (typeof _pushCustomUndo === 'function') _pushCustomUndo(editable);
    };
    const dispatchTableInput = () => editable.dispatchEvent(new Event('input', { bubbles: true }));
    items.push(
      { type: 'sep' },
      { label: '上に行を追加', enabled: true, action: () => {
        pushTableUndo();
        const row = _ctxCell.parentElement;
        const newRow = row.cloneNode(true);
        newRow.querySelectorAll('td, th').forEach(c => c.textContent = '');
        row.before(newRow);
        dispatchTableInput();
      }},
      { label: '下に行を追加', enabled: true, action: () => {
        pushTableUndo();
        const row = _ctxCell.parentElement;
        const newRow = row.cloneNode(true);
        newRow.querySelectorAll('td, th').forEach(c => c.textContent = '');
        row.after(newRow);
        dispatchTableInput();
      }},
      { label: '行を削除', enabled: true, action: async () => {
        if (!(await confirmNoteTableDelete('この行を削除しますか？'))) return;
        pushTableUndo();
        _ctxCell.parentElement.remove();
        dispatchTableInput();
      }},
      { label: '列を削除', enabled: true, action: async () => {
        if (!(await confirmNoteTableDelete('この列を削除しますか？'))) return;
        pushTableUndo();
        const colIndex = [..._ctxCell.parentElement.children].indexOf(_ctxCell);
        _ctxTable.querySelectorAll('tr').forEach(row => {
          if (row.children[colIndex]) row.children[colIndex].remove();
        });
        dispatchTableInput();
      }}
    );
  }

  let menuPointerCloser = null;
  let menuKeyCloser = null;
  const closeNoteContextMenu = (restoreFocus = false) => {
    if (menu.isConnected) menu.remove();
    if (menuPointerCloser) document.removeEventListener('pointerdown', menuPointerCloser, true);
    if (menuKeyCloser) document.removeEventListener('keydown', menuKeyCloser, true);
    menuPointerCloser = null;
    menuKeyCloser = null;
    if (restoreFocus && editable.isConnected) editable.focus();
  };

  items.forEach(item => {
    if (item.type === 'sep') { menu.appendChild(_editorMenuSeparator()); return; }
    if (item.type === 'format') {
      // 「書式…」: クリックで統一書式ポップアップを開く
      const el = _editorMenuButton(item.label, item.enabled && typeof openFormatPopup === 'function', () => {
        if (!item.enabled || typeof openFormatPopup !== 'function') {
          closeNoteContextMenu(true);
          return;
        }
        // メニューを閉じる前にアンカー位置を取得（閉じると el が DOM から消えて rect=(0,0,0,0) になる）
        const anchorRect = el.getBoundingClientRect();
        const virtualAnchor = { getBoundingClientRect: () => anchorRect };
        closeNoteContextMenu(false);
        // 選択を復元しないと queryCommandState / queryCommandValue が誤った結果を返す
        editable.focus();
        if (savedRange) {
          const s = window.getSelection();
          s.removeAllRanges();
          s.addRange(savedRange.cloneRange());
        }
        const curColor = document.queryCommandValue('foreColor') || '';
        const values = {
          textColor: curColor,
          fontWeight: document.queryCommandState('bold') ? 'bold' : '',
          fontStyle: document.queryCommandState('italic') ? 'italic' : '',
          underline: document.queryCommandState('underline'),
          strike: document.queryCommandState('strikeThrough'),
        };
        openFormatPopup(virtualAnchor, {
          values,
          fields: ['textColor', 'bold', 'italic', 'underline', 'strike'],
          onChange: (prop, value) => {
            // 各変更前に選択を復元し、execCommand を実行
            // bold/italic/underline/strike はトグル系なので value の真偽に関係なく
            // execCommand を実行すれば UI のアクティブ状態と DOM が一致する
            if (prop === 'fontWeight') applyFormat('bold');
            else if (prop === 'fontStyle') applyFormat('italic');
            else if (prop === 'underline') applyFormat('underline');
            else if (prop === 'strike') applyFormat('strikeThrough');
            else if (prop === 'textColor') {
              const c = value || getComputedStyle(editable).color;
              applyFormat('foreColor', c);
            }
          },
        });
      });
      menu.appendChild(el);
      return;
    }
    const el = _editorMenuButton(item.label, item.enabled, () => { closeNoteContextMenu(false); item.action(); });
    menu.appendChild(el);
  });

  document.body.appendChild(menu);
  _positionEditorPopup(menu, _editorEventAnchorRect(e, editable));
  setTimeout(() => {
    menuPointerCloser = (ev) => {
      if (!menu.contains(ev.target)) closeNoteContextMenu(true);
    };
    menuKeyCloser = (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        closeNoteContextMenu(true);
      }
    };
    document.addEventListener('pointerdown', menuPointerCloser, true);
    document.addEventListener('keydown', menuKeyCloser, true);
  }, 0);
}

// editable コンテナ（#page-content / #entity-freetext / #dp-editable）にノート編集メニューを付ける
function bindNoteEditorContextMenu(el) {
  if (!el || el._noteCtxMenuAttached) return;
  el._noteCtxMenuAttached = true;
  el.addEventListener('contextmenu', _noteCtxMenuHandler);
  // タッチ/ペンの長押しでも同じハンドラを発火
  if (typeof addLongPressHandler === 'function') addLongPressHandler(el, _noteCtxMenuHandler);
}

// 静的要素に初期バインド（#dp-editable は gb-detail-panel.part02.js の _dpBindAutoSave で動的バインド）
bindNoteEditorContextMenu(document.getElementById('page-content'));
bindNoteEditorContextMenu(document.getElementById('entity-freetext'));

// ============================================================
// テーブルミニツールバー（タッチ対応）
// ============================================================
function _tableMiniToolbarZoom() {
  return (typeof _getZoom === 'function' ? _getZoom() : 1) || 1;
}

function _positionTableMiniToolbar(tableEl, toolbar) {
  if (!tableEl?.isConnected || !toolbar?.isConnected) return;
  const rect = tableEl.getBoundingClientRect();
  const z = _tableMiniToolbarZoom();
  const width = toolbar.offsetWidth || 180;
  const height = toolbar.offsetHeight || 28;
  toolbar.style.left = ((rect.left + (rect.width - width) / 2) / z) + 'px';
  toolbar.style.top = ((rect.top - height / 2) / z) + 'px';
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(toolbar);
}

function _closeTableMiniToolbar(toolbar) {
  if (!toolbar) return;
  if (typeof toolbar._cleanup === 'function') toolbar._cleanup();
  toolbar.remove();
}

function _showTableToolbar(tableEl, editable) {
  document.querySelectorAll('.table-mini-toolbar').forEach(existing => {
    if (existing._tableElement !== tableEl) _closeTableMiniToolbar(existing);
  });
  if (tableEl._tableMiniToolbar?.isConnected) {
    _positionTableMiniToolbar(tableEl, tableEl._tableMiniToolbar);
    return;
  }
  const toolbar = document.createElement('div');
  toolbar.className = 'table-mini-toolbar';
  toolbar.contentEditable = 'false';
  toolbar._tableElement = tableEl;
  toolbar.addEventListener('mousedown', (e) => e.preventDefault());
  function _getCurrentCell() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    return sel.anchorNode?.nodeType === 1
      ? sel.anchorNode.closest('td, th')
      : sel.anchorNode?.parentElement?.closest('td, th');
  }
  const pushTableUndo = () => {
    if (editable && typeof _pushCustomUndo === 'function') _pushCustomUndo(editable);
  };
  const dispatchTableInput = () => editable.dispatchEvent(new Event('input', { bubbles: true }));
  [
    { label: '↑行', action: () => {
      const cell = _getCurrentCell();
      if (!cell) return;
      pushTableUndo();
      const row = cell.parentElement;
      const nr = row.cloneNode(true);
      nr.querySelectorAll('td,th').forEach(c => c.textContent = '');
      row.before(nr);
      dispatchTableInput();
    }},
    { label: '↓行', action: () => {
      const cell = _getCurrentCell();
      if (!cell) return;
      pushTableUndo();
      const row = cell.parentElement;
      const nr = row.cloneNode(true);
      nr.querySelectorAll('td,th').forEach(c => c.textContent = '');
      row.after(nr);
      dispatchTableInput();
    }},
    { label: '行削除', action: async () => {
      const cell = _getCurrentCell();
      if (!cell) return;
      if (!(await confirmNoteTableDelete('この行を削除しますか？'))) return;
      pushTableUndo();
      cell.parentElement.remove();
      dispatchTableInput();
    }},
    { label: '列削除', action: async () => {
      const cell = _getCurrentCell();
      if (!cell) return;
      if (!(await confirmNoteTableDelete('この列を削除しますか？'))) return;
      pushTableUndo();
      const ci = [...cell.parentElement.children].indexOf(cell);
      tableEl.querySelectorAll('tr').forEach(r => { if (r.children[ci]) r.children[ci].remove(); });
      dispatchTableInput();
    }},
  ].forEach(({label, action}) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'table-mini-toolbar-btn';
    btn.textContent = label;
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); action(); });
    toolbar.appendChild(btn);
  });
  document.body.appendChild(toolbar);
  _positionTableMiniToolbar(tableEl, toolbar);
  tableEl._tableMiniToolbar = toolbar;
  const reposition = () => {
    if (!tableEl.isConnected) {
      _closeTableMiniToolbar(toolbar);
      return;
    }
    _positionTableMiniToolbar(tableEl, toolbar);
  };
  const _remove = (e) => {
    if (!tableEl.contains(e.target) && !toolbar.contains(e.target)) _closeTableMiniToolbar(toolbar);
  };
  toolbar._cleanup = () => {
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
    document.removeEventListener('click', _remove);
    if (tableEl._tableMiniToolbar === toolbar) tableEl._tableMiniToolbar = null;
  };
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
  setTimeout(() => document.addEventListener('click', _remove), 0);
}

// テーブルセルクリック/タップでミニツールバー表示
document.addEventListener('click', (e) => {
  const td = e.target.closest('#page-content table td, #page-content table th, #entity-freetext table td, #entity-freetext table th, #dp-editable table td, #dp-editable table th, #board-note-editable table td, #board-note-editable table th');
  if (!td) return;
  if (typeof window.showNoteTableCellControls === 'function') {
    window.showNoteTableCellControls(td);
    return;
  }
  const table = td.closest('table');
  const editable = td.closest('[contenteditable="true"]');
  if (table && editable) _showTableToolbar(table, editable);
});
