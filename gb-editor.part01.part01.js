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
      // 工程1: タブ/パネル切替・終了前flushの実処理は、2秒自動保存タイマーの
      // コールバックと共通の _runNoteAutoSave() へ集約し、保存コーディネーター
      // 経由のsingle-flight/coalesceへ合流させる（新規の競合保存を起こさない）。
      pending.push(_runNoteAutoSave(pc));
    }
  }
  if (window._ftAutoSaveTimer) {
    clearTimeout(window._ftAutoSaveTimer);
    window._ftAutoSaveTimer = null;
    const ft = document.getElementById('entity-freetext');
    const ep = ft?.dataset?.entityPath;
    if (ep && ft.textContent.trim() !== '自由記述エリア（クリックして編集）') {
      // 工程2-C項目5: flush(タブ/パネル切替・終了前)も自動保存/blurと同じ
      // 保存コーディネーター経由の共有関数（gb-editor.part02.part01.js）を使う
      // （従来は生apiPutでetag/entry_revisionを一切送らない別実装だった）。
      const md = htmlToMd(ft.innerHTML || '');
      const req = _saveEntityFreeText(ft, ep, md, { reason: 'entity-freetext-flush' });
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

// ============================================================
// 工程3: 入力イベントの軽量化（計画書§5工程3。
// app/docs/note-editor-regression-performance-conflict-plan-2026-08-01.md）
//
// pc.oninput の同期区間は、dirty revisionの更新・軽量な行情報更新・
// ドラフト予約（debounce+最大待ち時間で1件へ集約）だけに限定する。
// 全本文Markdown変換（htmlToMd）とライブDOM正規化（normalize()）は、
// 同期区間では一切呼ばない。実際に変換が必要になった時は編集DOMのclone上で
// 行い（ハイライト除去・normalize()もclone側だけに適用）、ライブDOMの
// 選択・キャレットには一切触れない。
//
// 対象外（保存経路レーン・行種系レーンの担当）: 2秒自動保存
// （_runNoteAutoSave）・blur保存（pc.onblur）・flushPendingEditorAutosave()・
// 行頭記法フック。ここで行う軽量化はIndexedDBドラフト退避と目次表示だけに
// 閉じており、ネットワーク保存の挙動・タイミングは変更しない。
// ============================================================

const NOTE_DRAFT_DEBOUNCE_MS = 300;
const NOTE_DRAFT_MAX_WAIT_MS = 1000;

// pcは実質シングルトン要素だが、要素そのものをキーにしたWeakMapで状態を
// 持つ（将来の複数編集ホスト対応や、パス切替時の取り違え防止のため）。
const _noteDraftReservations = new WeakMap();

// 項目1: dirty revisionの更新。プロパティのインクリメントのみのO(1)処理で、
// 本文の内容には一切触れない。同時に直列化キャッシュを無効化する。
function _bumpNoteEditorRevision(pc) {
  pc._noteEditRevision = (pc._noteEditRevision || 0) + 1;
  pc._noteEditSerializeCache = null;
  return pc._noteEditRevision;
}

// 項目1: 軽量な行情報更新。現在のキャレットが属する、pc直下のブロック要素
// （見出し・段落・リスト項目等）の参照だけをO(深さ)で記録する。全行走査・
// 全文パースは行わない。
function _updateNoteEditorLineHint(pc) {
  const sel = window.getSelection && window.getSelection();
  let node = (sel && sel.rangeCount) ? sel.getRangeAt(0).startContainer : null;
  if (node && node.nodeType === 3) node = node.parentElement;
  while (node && node.parentElement && node.parentElement !== pc) node = node.parentElement;
  pc._noteLastEditedBlock = (node && node !== pc) ? node : null;
}

// 項目3: Markdown変換が必要な時に使う非破壊serializer。pc.cloneNode(true)で
// 切り離したコピー上でハイライト除去・normalize()・htmlToMd()を行うため、
// ライブ編集DOM（したがって選択・キャレット）には一切触れない。
// _noteMarkdownFromEditor（ライブDOMを直接正規化する既存関数。
// gb-note-save-adapter.js の serialize() 等、正確な現在値が必要な呼び出し元
// 向けに現状のまま残す）とは別の関数として提供する。
//
// 項目5: 直前の _bumpNoteEditorRevision 以降に編集が無い（同一revision）
// 場合は、キャッシュ済みのserialize結果を再利用し、cloneNode/normalize/
// htmlToMdを再実行しない。
function _noteMarkdownFromEditorNonDestructive(pc) {
  if (!pc) return '';
  const revision = pc._noteEditRevision || 0;
  const cache = pc._noteEditSerializeCache;
  if (cache && cache.revision === revision) return cache.md;
  const clone = pc.cloneNode(true);
  clone.querySelectorAll('mark.file-search-highlight').forEach(m => m.replaceWith(...m.childNodes));
  clone.normalize();
  let md = htmlToMd(clone.innerHTML || '');
  const fm = pc.dataset.frontmatter || '';
  if (fm) md = fm + md;
  pc._noteEditSerializeCache = { revision, md };
  return md;
}

// 項目6: 見出し構造の軽量シグネチャ（個数＋各見出しのタグ・文字数）。完全な
// 文字列比較ではなく変更検知の目安として使う。呼び出しは
// _maybeRefreshNoteTocAfterEdit（debounce/最大待ち時間の満了時のみ）に限定し、
// 通常文字入力のたびに呼ぶことはない。
function _noteHeadingSignature(pc) {
  const heads = pc.querySelectorAll('h1,h2,h3,h4,h5,h6');
  let sig = String(heads.length);
  for (let i = 0; i < heads.length; i++) {
    sig += '|' + heads[i].tagName + ':' + (heads[i].textContent || '').length;
  }
  return sig;
}

// 項目6: 見出し構造（個数・見出しテキスト長）が変わった時だけ
// updateNoteToc() を呼ぶ。目次が非表示、または見出し構造に変化が無ければ
// 全再構築しない。
function _maybeRefreshNoteTocAfterEdit(pc) {
  const tocEl = document.getElementById('note-toc');
  if (!tocEl || tocEl.style.display === 'none') return;
  const signature = _noteHeadingSignature(pc);
  if (pc._noteTocSignature === signature) return;
  pc._noteTocSignature = signature;
  if (typeof updateNoteToc === 'function') updateNoteToc();
}

// 項目4: ドラフト退避のdebounce+最大待ち時間。連続入力は1件へ集約し、最終
// 入力から最大 NOTE_DRAFT_MAX_WAIT_MS 経過したら強制的にflushする（合格
// 基準「ドラフトは最終入力から最大1秒以内に必ず退避される」）。
function _scheduleNoteDraftReservation(pc) {
  if (!pc || !pc.dataset.path || pc.dataset.loadFailed === '1') return;
  let rec = _noteDraftReservations.get(pc);
  if (!rec) {
    rec = { timer: null, firstAt: 0 };
    _noteDraftReservations.set(pc, rec);
  }
  const now = Date.now();
  if (!rec.firstAt) rec.firstAt = now;
  clearTimeout(rec.timer);
  const elapsed = now - rec.firstAt;
  const wait = Math.max(0, Math.min(NOTE_DRAFT_DEBOUNCE_MS, NOTE_DRAFT_MAX_WAIT_MS - elapsed));
  rec.timer = setTimeout(() => _flushNoteDraftReservation(pc), wait);
}

// 項目4・7: 予約済みのドラフト退避を実行する。保留中の予約が無い場合
// （そのノートで何も編集していない場合）は何もしない —— blur・非表示化・
// 終了前・ノート切替のたびに無条件でqueueDraftを呼ぶと、未編集のノートにも
// 「未保存の編集あり」のドラフトが残ってしまうため。
// IME変換中（pc._noteComposing）は、options.ignoreComposingが無い限り何も
// せず、compositionend側からの再スケジュールに委ねる（変換確定前の中間文字列
// をドラフトへ書かない。項目7）。blur・非表示化・終了前は
// { ignoreComposing: true } を渡し、保留中の編集を取りこぼさない。
function _flushNoteDraftReservation(pc, options) {
  const ignoreComposing = !!(options && options.ignoreComposing);
  const rec = _noteDraftReservations.get(pc);
  const hadPending = !!(rec && rec.timer);
  // 修正9（IME変換セッション中のドラフト退避起点の保持）: composing中に
  // タイマーが満了しただけで実際には退避をスキップする場合（下のcomposing
  // ガードで判定）、rec.firstAtはリセットしない。従来は無条件で
  // rec.firstAt = 0 していたため、変換候補選択中の一時停止で debounce
  // タイマー(300ms)が composing中に満了するたびに起点が0へ戻り、次の
  // 入力イベントで「今」を新しい起点として再スタートしていた。IME変換に
  // 時間がかかるほど「最大1秒で必ず退避される」保証が実質失われ、
  // compositionend まで退避が繰延べされ続けていた。
  const composingBlocked = !!(pc && pc._noteComposing && !ignoreComposing);
  if (rec) {
    clearTimeout(rec.timer);
    rec.timer = null;
    if (!composingBlocked) rec.firstAt = 0;
  }
  if (!hadPending) return;
  if (!pc || pc.dataset.loadFailed === '1') return;
  const draftPath = pc.dataset.path;
  if (!draftPath) return;
  if (composingBlocked) return;
  const md = _noteMarkdownFromEditorNonDestructive(pc);
  window.MeldexDraftRecovery?.queueDraft?.(draftPath, md, pc.dataset.lastSavedMd || '');
  _maybeRefreshNoteTocAfterEdit(pc);
}

function _noteSavePayload(pc, md, extra) {
  const payload = {
    content: md,
    if_match_etag: pc?.dataset?.lastSavedEtag || '',
    transport_revision: pc?.dataset?.lastSavedTransportRevision || '',
    skip_if_missing: true,
    ...(extra || {}),
  };
  if (payload.force_overwrite) delete payload.skip_if_missing;
  return payload;
}

// 工程1: 2秒自動保存タイマーのコールバックと flushPendingEditorAutosave() の
// 双方から共有される、メインパネルノートの自動保存の実処理。
// 保存コーディネーター（gb-document-save-coordinator.js）とノート用アダプター
// （gb-note-save-adapter.js）経由で送信することで、blurと同一documentKeyの
// single-flight/coalesceへ合流させ、同じ内容の2本目のPUTを発生させない
// （計画書§5工程1-2・5・6）。
async function _runNoteAutoSave(pc, expectedPath) {
  const currentPath = pc?.dataset?.path;
  if (!currentPath || pc.dataset.loadFailed === '1') return;
  // 修正3（誤PUTの防止・二重防御）: 呼び出し元がタイマー設定時点のパスを
  // expectedPathとして渡している場合（2秒自動保存タイマーからの呼び出し）、
  // 発火時点の pc.dataset.path と一致しなければ何もしない。openPage()側の
  // clearTimeout漏れ・タイミングずれが万一あっても、ここが最終防波堤になる
  // （flushPendingEditorAutosave()からの直接呼び出しはexpectedPathを渡さず、
  // 従来どおり「今のcurrentPath」で保存する）。
  if (expectedPath !== undefined && expectedPath !== currentPath) return;
  pc.querySelectorAll('mark.file-search-highlight').forEach(m => m.replaceWith(...m.childNodes));
  pc.normalize();
  let md = htmlToMd(pc.innerHTML || '');
  const prevSaved = pc.dataset.lastSavedMd || '';
  const prevBody = prevSaved.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const fm = pc.dataset.frontmatter || '';
  const prevFm = (prevSaved.match(/^(---\n[\s\S]*?\n---\n?)/) || [null, ''])[1] || '';
  if (fm) md = fm + md;
  // 工程1項目2: 内容が保存済みbaselineと完全一致するなら何もしない（PUTを発生させない）
  if (window.MeldexNoteSaveAdapter?.isUnchanged?.(pc, md)) return;
  if (!md.trim() && !prevBody.trim() && fm === prevFm) return;
  const _prevSavedForDiff = prevSaved;
  window.MeldexDraftRecovery?.queueDraft?.(currentPath, md, prevSaved);
  try {
    // フォールバック: window.MeldexNoteSaveAdapter が読み込まれていない環境
    // （単独ノート版 note-standalone.html は保存基盤3ファイル
    // gb-document-save-coordinator.js/gb-note-save-adapter.js/
    // gb-conflict-pending-banner.js を読み込まない）では、存在チェック無しの
    // 呼び出しがTypeErrorとなり自動保存が完全に壊れていた（try/catchで握り
    // つぶされ「ネットワークを確認してください」と誤表示。実際にはPUT未送信）。
    // アダプター未読込時は工程1以前と同じ直接PUT経路へフォールバックする。
    const res = window.MeldexNoteSaveAdapter
      ? await window.MeldexNoteSaveAdapter.performSave(pc, currentPath, md, { reason: 'auto' })
      : await apiPut('/file?path=' + encodeURIComponent(currentPath), _noteSavePayload(pc, md));
    // 工程2-A項目4・5: conflict-pending中はコーディネーターがネットワーク送信を
    // スキップして返す。何もサーバーへ送っていないため、baseline更新・
    // ドラフト同期完了扱いのどちらも行わない（ローカル編集とIndexedDBドラフトの
    // 継続はoninput側で既に行われている）。
    if (_noteSaveConflictPending(res)) return;
    if (_handleNoteSkippedMissingSave(res, currentPath, md, pc)) return;
    _orphanRemovedNoteLines(_prevSavedForDiff, md, currentPath);
    // ページ切替でpc(singleton)が別ノートを指していたら書き込まない（etag汚染防止）
    if (pc.dataset.path === currentPath) {
      pc.dataset.lastSavedMd = (res && res.savedMd != null) ? res.savedMd : md;
      pc.dataset.lastSavedEtag = (res && res.etag) || '';
    }
    window.MeldexDraftRecovery?.markSynced?.(currentPath);
  } catch (error) {
    if (!_handleNoteSaveFailure(error, currentPath, md, pc)) {
      showStatus('自動保存に失敗しました。ネットワークを確認してください', true);
    }
  }
}

function _noteSaveSkippedMissing(res) {
  return !!(res?.missing);
}

// 工程2-A項目4: 保存コーディネーターがconflict-pending/resolving中を理由に
// ネットワーク送信をスキップした結果かどうかを判定する（res.skippedは
// 「ファイル未検出でスキップ」と共通のフラグだが、conflictPendingは
// このケース専用に付与される）。
function _noteSaveConflictPending(res) {
  return !!(res && res.conflictPending);
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
  // ダイアログを開いた競合世代を固定し、非同期処理の完了時に別世代の競合を
  // 誤って解除しない（計画書§5工程2-A項目8）。
  const conflictGeneration = window.MeldexNoteSaveAdapter?.getConflictGeneration?.(path);
  const conflictDocumentKey = window.MeldexNoteSaveAdapter?.documentKeyForPath?.(path) || path;
  let actionBusy = false;
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
  // 工程2-B項目8: ダイアログを閉じた時はノート本文へ固定復帰せず、競合発生前に
  // ユーザーが移ろうとしていた要素（保存コーディネーターが記録したfocusTarget）へ
  // preventScroll付きで戻す。復帰先が削除済み・無効・不可視の場合だけpcへ
  // フォールバックする（項目9）。直接呼び出し（コーディネーターに競合記録が
  // 無い経路。既存の competed E2E 等）では常にpcへフォールバックする。
  const restoreFocus = () => {
    const recorded = window.MeldexNoteSaveAdapter?.getConflictFocusTarget?.(path);
    const target = window.MeldexNoteSaveAdapter?.isElementUsableForFocus?.(recorded)
      ? recorded : (pc?.isConnected ? pc : null);
    target?.focus?.({ preventScroll: true });
  };
  // 工程2-A項目6: 「保留」とEscapeは同じconflict-pending遷移とし、ダイアログを
  // 閉じた後は「競合を保留中」の非モーダル表示だけを残す（実際に保存
  // コーディネーター側へ競合が記録されている場合のみ表示される）。
  const closeDialog = () => {
    const coordinator = window.MeldexDocumentSaveCoordinator;
    const current = coordinator?.getConflict?.(conflictDocumentKey);
    // 「保留」は解決ではない。確認開始時の同じ競合がまだ残っている場合、
    // RESOLVING から CONFLICT_PENDING へ戻して、次回も確認できるようにする。
    if (current && current.generation === conflictGeneration) {
      coordinator.restoreConflict?.(conflictDocumentKey, current);
    }
    overlay.remove();
    window.MeldexNoteSaveAdapter?.showConflictPendingBannerIfPending?.(path, pc);
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
    if (actionBusy) return;
    actionBusy = true;
    overlay.querySelectorAll('[data-conflict-action]').forEach(button => { button.disabled = true; });
    try {
      if (action === 'overwrite') {
        const res = await apiPut('/file?path=' + encodeURIComponent(path), _noteSavePayload(pc, md, { force_overwrite: true }));
        if (window.MeldexNoteSaveAdapter?.getConflictGeneration?.(path) !== conflictGeneration) {
          throw new Error('競合状態が更新されたため、上書き結果を確定できません');
        }
        // ダイアログを開いた後にpc(singleton)が別ノートへ切り替わっていたら書き込まない（etag汚染防止）
        if (pc && pc.dataset.path === path) {
          pc.dataset.lastSavedMd = md;
          pc.dataset.lastSavedEtag = res.etag || '';
        }
        window.MeldexNoteSaveAdapter?.syncResolvedBaseline?.(path, pc, md, res.etag || '');
        // 工程2-A項目8: 実際に解決へ至った時だけconflict-pendingを解除する
        // （MeldexSaveSafety.clearConflictへの委譲を含む）。
        const resolved = window.MeldexNoteSaveAdapter?.resolveConflict?.(path, conflictGeneration);
        if (resolved === false) throw new Error('競合状態が更新されたため、もう一度確認してください');
        await window.MeldexDraftRecovery?.markSynced?.(path);
        showStatus('自分の編集で上書き保存しました');
      } else if (action === 'reload') {
        await window.MeldexDraftRecovery?.saveDraft?.(path, md, pc?.dataset?.lastSavedMd || '');
        const reloadSnapshot = pc && pc.dataset.path === path ? {
          html: pc.innerHTML,
          frontmatter: pc.dataset.frontmatter || '',
          lastSavedMd: pc.dataset.lastSavedMd || '',
          lastSavedEtag: pc.dataset.lastSavedEtag || '',
          loadFailed: pc.dataset.loadFailed || '',
          contentEditable: pc.contentEditable,
        } : null;
        const latest = await apiFetch('/file?path=' + encodeURIComponent(path));
        if (window.MeldexNoteSaveAdapter?.getConflictGeneration?.(path) !== conflictGeneration) {
          throw new Error('競合状態が更新されたため、再読込を中止しました');
        }
        const opened = await openPage(path.split('/').pop().replace(/\.md$/i, ''), path, {
          prefetchedFileData: latest,
          conflictGeneration,
          skipNavPush: true,
          skipRecent: true,
          skipAutoVersion: true,
        });
        if (!opened) {
          // 描画失敗時は、取得前のローカル表示とbaselineを戻す。ドラフトは
          // 既に退避済みで、競合状態も解除していない。
          if (reloadSnapshot && pc?.dataset?.path === path) {
            pc.innerHTML = reloadSnapshot.html;
            pc.dataset.frontmatter = reloadSnapshot.frontmatter;
            pc.dataset.lastSavedMd = reloadSnapshot.lastSavedMd;
            pc.dataset.lastSavedEtag = reloadSnapshot.lastSavedEtag;
            pc.dataset.loadFailed = reloadSnapshot.loadFailed;
            pc.contentEditable = reloadSnapshot.contentEditable;
          }
          throw new Error('最新版を読み込めませんでした');
        }
        if (pc && pc.dataset.path === path) {
          window.MeldexNoteSaveAdapter?.syncResolvedBaseline?.(
            path, pc, pc.dataset.lastSavedMd || '', pc.dataset.lastSavedEtag || '',
          );
        }
        const resolved = window.MeldexNoteSaveAdapter?.resolveConflict?.(path, conflictGeneration);
        if (resolved === false) throw new Error('競合状態が更新されたため、もう一度確認してください');
        // 修正4（ドラフト残留の防止）: 「相手の変更を読み込む」＝自分の未保存
        // 編集を破棄することをユーザーが明示した操作。直前のsaveDraft()で
        // IndexedDBに退避した破棄済み内容を、上書き分岐（923行付近）と同様に
        // markSynced()で消す。従来はここでドラフトを消しておらず、次回起動時の
        // 「未保存の編集があります」から、既に破棄したはずの古い内容を復元でき
        // てしまい、そこで「上書き保存」を選ぶと今読み込んだ最新版の上へ
        // force_overwriteされ得た。
        await window.MeldexDraftRecovery?.markSynced?.(path);
        showStatus('相手の変更を読み込みました');
      } else if (action === 'save-as') {
        const fallback = _noteDir(path) + path.split('/').pop().replace(/(\.[^/.]+)?$/, '_copy$1');
        const promptPromise = cfPrompt('別名で保存', fallback);
        document.querySelector('[data-e2e-id="cf-prompt-overlay"]')?.style?.setProperty('z-index', '10100');
        const nextPath = await promptPromise;
        if (!nextPath) return;
        let targetExists = false;
        try {
          await apiFetch('/file?path=' + encodeURIComponent(nextPath) + '&metadata_only=1', { silentError: true });
          targetExists = true;
        } catch (error) {
          if (error?.status !== 404) throw error;
        }
        if (targetExists && !await cfConfirm('同名のファイルが既にあります。上書きしますか？', {
          danger: true, okLabel: '上書き', cancelLabel: 'キャンセル',
        })) return;
        const res = await apiPut('/file?path=' + encodeURIComponent(nextPath), {
          content: md,
          ...(targetExists ? { force_overwrite: true } : { create_only: true }),
        });
        if (window.MeldexNoteSaveAdapter?.getConflictGeneration?.(path) !== conflictGeneration) {
          throw new Error('元ファイルの競合状態が更新されたため、別名保存の結果を確定できません');
        }
        // ダイアログを開いた後にpc(singleton)が別ノートへ切り替わっていたら書き込まない（path/etag汚染防止）
        if (pc && pc.dataset.path === path) {
          pc.dataset.path = nextPath;
          pc.dataset.lastSavedMd = md;
          pc.dataset.lastSavedEtag = res.etag || '';
          state.currentPagePath = nextPath;
        }
        const resolved = window.MeldexNoteSaveAdapter?.resolveConflict?.(path, conflictGeneration);
        if (resolved === false) throw new Error('元ファイルの競合状態が更新されました');
        // 修正4（ドラフト残留の防止）: 内容は新パス(nextPath)へ保存成功済みの
        // ため、旧パス(path)のドラフト（あれば）はもう「未保存」ではない。
        // pc.dataset.pathの汚染チェックとは無関係に、旧パスのキーで独立して
        // 残っているドラフトを消す（新パス側は元々ドラフトを持たないため
        // 移し替えは不要）。従来はここでドラフト処理が皆無で、次回起動時の
        // 「未保存の編集があります」に旧パスの古い内容が残り続けていた。
        await window.MeldexDraftRecovery?.markSynced?.(path);
        showStatus('別名で保存しました');
      }
      closeDialog();
    } catch (error) {
      showStatus('競合処理に失敗しました: ' + (error.message || error), true);
    } finally {
      actionBusy = false;
      if (overlay.isConnected) {
        overlay.querySelectorAll('[data-conflict-action]').forEach(button => { button.disabled = false; });
      }
    }
  });
  overlay.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeDialog();
  });
  document.body.appendChild(overlay);
  // ダイアログ自体が「競合を保留中」の代わりとなる能動的なUIなので、
  // 開いている間は非モーダル表示を隠す（既存の直接呼び出し経路では
  // 対応する保留記録が無いため常に何もしない）。
  window.MeldexNoteSaveAdapter?.hideConflictPendingBanner?.(path);
  const focusInitialAction = () => overlay.querySelector('[data-conflict-action="overwrite"]')?.focus?.({ preventScroll: true });
  focusInitialAction();
  requestAnimationFrame(focusInitialAction);
  setTimeout(focusInitialAction, 60);
  apiFetch('/file?path=' + encodeURIComponent(path)).then(data => {
    // 「保留」または別の解決操作で閉じた後に届いた応答は無効。
    if (!overlay.isConnected || actionBusy) return;
    const remote = String(data?.content || '');
    // 修正7（誤自動解決の防止）: 再起動/再読込後に復元された競合
    // （restorePendingConflictIfAny経由。コーディネーター側に本当の未保存内容を
    // 持たず、mdはサーバー再読込済み内容へのフォールバック値）では、正規化
    // 一致判定をスキップする。フォールバック値はほぼ常にremoteと一致するため、
    // 判定をそのまま通すと「実質何も比較せずに競合を自動解決した」ことになり、
    // 本当の未保存編集（ドラフト復元系 MeldexDraftRecovery に隔離されたまま）を
    // 確認する機会を失う。完全な統合（復元時に対応するドラフトのcontentを
    // localMdとして引き当てる）は将来課題とし、ここでは誤自動解決だけを防ぐ
    // 最小対応に留める。
    const isRestoredConflict = !!window.MeldexNoteSaveAdapter?.isRestoredConflict?.(path);
    // 工程2-A項目9: 正規化後のローカル内容とサーバー内容が一致した場合は、
    // 現在etagを取り込んで安全に自動解決する（差分表示・4アクションは出さない）。
    if (!isRestoredConflict && window.MeldexNoteSaveAdapter?.contentMatchesNormalized?.(md, remote)) {
      const resolved = window.MeldexNoteSaveAdapter.autoResolveConflictAsMatch(
        path, pc, remote, data?.etag, conflictGeneration,
      );
      if (resolved) {
        closeDialog();
        showStatus('内容が一致していたため、競合を自動的に解決しました');
        return;
      }
    }
    _renderNoteConflictDiff(overlay.querySelector('[data-conflict-diff]'), md, remote);
    if (isRestoredConflict) {
      const hint = document.createElement('div');
      hint.dataset.e2eId = 'note-conflict-restored-hint';
      hint.style.cssText = 'font-size:12px;color:var(--ui-fg-muted);margin-top:8px;';
      hint.textContent = '再起動前の編集内容は「未保存の編集があります」の復元から確認できます。';
      overlay.querySelector('[data-conflict-diff]')?.insertAdjacentElement('afterend', hint);
    }
  }).catch(() => {
    const diffHost = overlay.querySelector('[data-conflict-diff]');
    if (diffHost) diffHost.textContent = 'ファイル側の最新版を取得できませんでした。必要なら「相手の変更を読み込む」で再読込してください。';
  });
}

function _handleNoteSaveFailure(error, path, md, pc) {
  window.MeldexDraftRecovery?.saveDraft?.(path, md, pc?.dataset?.lastSavedMd || '');
  if (error?.meldexCode === 'etag_conflict' || error?.status === 409) {
    // 工程2-A項目2・6・7、工程2-B項目5〜7: 409を無条件でダイアログ表示せず、
    // まず保存コーディネーターへ報告する。同じ文書が既にconflict-pending/
    // resolving中（＝この409が「保留」後の後追い再試行や、既に表示中の
    // ダイアログに由来する二重報告）ならisNew:falseが返り、ダイアログを
    // 再表示しない（同じ競合世代へ統合するだけ）。新規の競合（isNew:true）
    // だけがダイアログを開く——このisNew判定こそが「自己起因の古い応答/
    // 同一文書ID・同じ競合世代の複数409」の分類そのものである。
    const report = window.MeldexNoteSaveAdapter?.reportSaveFailureConflict?.(pc, path, md, error);
    if (!report || report.isNew) _showNoteConflictDialog(path, md, pc);
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
  let preloadedFileData = openOpts.prefetchedFileData || null;
  let pageLoadSucceeded = false;
  try {
    if (showOpenLoading) { showLoading('ノートを読み込み中...'); loadingShown = true; }
    if (!openOpts.allowBoardAsPage && typeof openBoard === 'function' && _notePathLooksLikeBoard(path)) {
      if (loadingShown) { hideLoading(); loadingShown = false; }
      await openBoard(label, path, openOpts);
      return;
    }
    if (!openOpts.allowBoardAsPage && typeof openBoard === 'function' && /\.md$/i.test(String(path || ''))) {
      try {
        preloadedFileData = preloadedFileData || await apiFetch('/file?path=' + encodeURIComponent(path));
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
  // OptionTargetContext（計画書§11.1）: ノートを開いた時点で選択対象を更新する。
  // これを怠ると、フォルダパネルで一般ファイルを選んだ後にノートへ戻った際、
  // バックリンクタブが直前のファイル対象を指したままになる（逆方向の取り違え）。
  window.GBOptionTargetContext?.set({ path, kind: 'page' }, 'note-open');
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
  // 修正3（誤PUTの防止）: 旧ノート用の2秒自動保存タイマーを、pc.dataset.path
  // 書き換え（この少し下）より前にここで確実にキャンセルする。従来は
  // この後に複数回のawait（apiFetch等）を挟んだ後、792行目付近でしか
  // キャンセルしていなかった。その待ち時間中に旧タイマーが発火すると、
  // 発火時点で読まれる pc.dataset.path は既に新パスへ書き換わっている一方、
  // 送信される md はタイマー登録時（旧ノート編集時）のクロージャ内容のままの
  // ため、「新パス＋旧内容」という誤ったPUTが発生し得た（新旧のetagがたまたま
  // 一致する窓では無警告のまま別ノートへ上書きしてしまう）。792行目付近の
  // 既存clearTimeoutは二重キャンセルとして残す（安全側）。
  clearTimeout(window._noteAutoSaveTimer);
  // 工程3: ノート切替前に、直前のノート用に予約されていたドラフト退避を
  // （pc.dataset.pathが新パスへ書き換わる前に）flushする。書き換え後に
  // flushすると、直前ノートの内容が新ノートのパスへドラフト保存されて
  // しまう（誤タグ付け）。編集していなければ _flushNoteDraftReservation が
  // 何もしない（hadPendingガード）ため、未編集ノートへの余計な書き込みは
  // 起きない。あわせてIME合成フラグ・直列化キャッシュ・目次シグネチャも
  // 新しいノートへ持ち越さない。
  _flushNoteDraftReservation(pc, { ignoreComposing: true });
  pc._noteComposing = false;
  pc._noteEditRevision = 0;
  pc._noteEditSerializeCache = null;
  pc._noteTocSignature = undefined;
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
    const fmMatch = raw.match(/^(---\n[\s\S]*?\n---\n?)/);
    if (showOpenLoading && typeof showLoadingBeforeHeavyWork === 'function') {
      await showLoadingBeforeHeavyWork(raw, '大きいノートを描画中...');
      if (isStalePageLoad()) return;
    }
    if (
      openOpts.conflictGeneration != null
      && window.MeldexNoteSaveAdapter?.getConflictGeneration?.(path) !== openOpts.conflictGeneration
    ) {
      return false;
    }
    // 非同期の重い描画待ちと競合世代の再確認が完了してからbaselineを確定する。
    // 先にdatasetだけ更新すると、待機中に別の解決操作が進んだ場合に
    // 「古いDOM＋新しいbaseline/etag」という巻き戻し可能な状態が残る。
    pc.dataset.frontmatter = fmMatch ? fmMatch[1] : '';
    pc.dataset.lastSavedMd = raw;
    pc.dataset.lastSavedEtag = data.etag || '';
    // パスは表示/再取得用、asset/provider ID は保存調停用の安定IDとして分離する。
    // 名前変更・移動後も同じ文書の保存キューと保留競合を引き継ぐ。
    window.MeldexNoteSaveAdapter?.bindHostIdentity?.(pc, path, data);
    pc.dataset.loadFailed = '';
    // 工程1項目9: メインパネルのノートを文書単位arbiterへ登録する（保存は起こさない）。
    // 同一パスを詳細パネル内ノートでも開いている場合、single-flightロックと
    // baseline追従（未編集側への保存結果反映）を共有できるようにする。
    window.MeldexNoteSaveAdapter?.registerHost?.(pc, path);
    // 工程2-A項目10: 再起動/再読込後も未解決の保留競合を復元する。パネルは
    // 強制表示せず「競合を保留中」の非モーダル表示だけを再開する。
    window.MeldexNoteSaveAdapter?.restorePendingConflictIfAny?.(pc, path);
    pc.contentEditable = isItemLocked(path) ? 'false' : 'true';
    // 本文を先に表示し、重い表示レイヤーは必要時だけ遅延適用する。
    const html = mdToHtml(raw, { basePath: path });
    pc.innerHTML = html;
    _prepareEmbeddedMediaControls(pc);
    _loadPageIcon();
    if (typeof CommentBadges !== 'undefined') { try { CommentBadges.refreshFileIndicator(path); } catch {} }
    _schedulePageDisplayLayers(path, pc, html, isStalePageLoad);
    pageLoadSucceeded = true;
    if (!openOpts.skipGlobalUi) showStatus(`ノート: ${label}`);
  } catch (e) {
    pc.innerHTML = '<span style="color:var(--fg2)">(ノートを読み込めませんでした)</span>';
    pc.dataset.frontmatter = '';
    pc.dataset.lastSavedMd = '';
    pc.dataset.loadFailed = '1';
    pc.contentEditable = 'false';
    pageLoadSucceeded = false;
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

  pc.onblur = async function(e) {
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
    if (fm) md = fm + md;
    // 工程1項目2・4: 内容が保存済みbaselineと完全一致するなら、Markdown再変換以降の
    // 処理（PUT・etag更新・履歴追加）を一切行わない。未変更の非空ノートでも
    // blurのたびにPUTが発生していた回帰の修正（計画書§5工程1-4）。
    if (window.MeldexNoteSaveAdapter?.isUnchanged?.(this, md)) return;
    if (!md.trim() && !prevBody.trim() && fm === prevFm) return;
    const prevMd = this.dataset.lastSavedMd || '';
    try {
      // 工程1項目3・5: 直接apiPutを呼ばず、保存コーディネーターへ
      // reason:'blur' とフォーカス移動先（relatedTarget）を渡す。進行中の
      // 自動保存があれば同じdocumentKeyのsingle-flightへ合流し、同一内容の
      // 2本目のPUTを発生させない。
      // フォールバック: window.MeldexNoteSaveAdapter が読み込まれていない環境
      // （単独ノート版 note-standalone.html。保存基盤3ファイル未読込）では
      // 存在チェック無しの呼び出しがTypeErrorとなりblur保存が完全に壊れて
      // いたため、工程1以前と同じ直接PUT経路へフォールバックする。
      const res = window.MeldexNoteSaveAdapter
        ? await window.MeldexNoteSaveAdapter.performSave(this, currentPath, md, { reason: 'blur', focusTarget: e?.relatedTarget })
        : await apiPut('/file?path=' + encodeURIComponent(currentPath), _noteSavePayload(this, md));
      // 工程2-A項目4・5: conflict-pending中はネットワーク送信自体がスキップ
      // されている。保存成功扱いの表示・履歴追加・baseline更新を一切行わない
      // （focusInitialAction由来のblur等が、保留中に古いetagで再試行して
      // 二重の409を作ってしまう回帰の直接対策）。
      if (_noteSaveConflictPending(res)) return;
      if (_handleNoteSkippedMissingSave(res, currentPath, md, this)) return;
      _orphanRemovedNoteLines(prevMd, md, currentPath);
      // ページ切替でthis(singleton)が別ノートを指していたら書き込まない（etag汚染防止）
      if (this.dataset.path === currentPath) {
        this.dataset.lastSavedMd = (res && res.savedMd != null) ? res.savedMd : md;
        this.dataset.lastSavedEtag = (res && res.etag) || '';
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
    } catch (saveError) {
      if (!_handleNoteSaveFailure(saveError, currentPath, md, this)) {
        showStatus('ノートの保存に失敗しました。ネットワークを確認してください', true);
      }
    }
  };

  // 自動保存: 入力後2秒で保存（dataset.pathを都度参照し、クロージャのpathは使わない）
  // 工程3: 同期区間はdirty revision更新・軽量な行情報更新・ドラフト予約だけに
  // 限定する（計画書§5工程3-1）。全本文Markdown変換・ライブDOM正規化・目次の
  // 全再構築は同期区間で行わない。実際の変換とドラフト保存・目次判定は
  // _flushNoteDraftReservation() 側（debounce+最大待ち時間の満了時）に
  // まとめて1回だけ実行する。
  pc.oninput = () => {
    if (pc.dataset.loadFailed === '1') return;
    markAutoVersionDirty();
    clearTimeout(window._noteAutoSaveTimer);
    _bumpNoteEditorRevision(pc);
    _updateNoteEditorLineHint(pc);
    _scheduleNoteDraftReservation(pc);
    // 修正3（誤PUTの防止・二重防御）: タイマー設定時点のパスを捕捉しておき、
    // 発火時に _runNoteAutoSave() 側で pc.dataset.path と照合させる。
    const scheduledPath = pc.dataset.path;
    window._noteAutoSaveTimer = setTimeout(() => {
      // 工程1: 実処理は _runNoteAutoSave() へ集約（flushPendingEditorAutosave()と共有）。
      // 保存コーディネーター経由のsingle-flight/coalesceにより、blurと競合しない。
      _runNoteAutoSave(pc, scheduledPath);
    }, 2000);
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
  // 工程3: ここで初期シグネチャを記録しておくと、開いた直後の最初の編集で
  // 見出し構造が変わっていない場合に、debounce満了時の余計な再構築（項目6）を
  // 避けられる（無くても不整合にはならない軽微な最適化）。
  pc._noteTocSignature = pc.querySelectorAll ? _noteHeadingSignature(pc) : undefined;

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
  return pageLoadSucceeded;
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

// 工程3項目7: IME変換中は保存用DOM整形（Markdown変換・ドラフト直列化）を
// 走らせない。compositionend後にまとめて1回だけ処理する（既存の
// pc.onblur・_runNoteAutoSaveの挙動自体は変更しない。ここで制御するのは
// ドラフト予約のタイミングだけ）。
document.getElementById('page-content').addEventListener('compositionstart', function() {
  this._noteComposing = true;
});
document.getElementById('page-content').addEventListener('compositionend', function() {
  this._noteComposing = false;
  _scheduleNoteDraftReservation(this);
});

// 工程3項目4: ドラフト退避はblur時に即時flushする。既存のpc.onblur
// （ネットワーク保存）とは独立した経路であり、onblurプロパティの代入とは
// 別にaddEventListenerで追加する（既存のblur処理関数自体は変更しない）。
document.getElementById('page-content').addEventListener('blur', function() {
  _flushNoteDraftReservation(this, { ignoreComposing: true });
});

// 工程3項目4: 非表示化・終了前もドラフト退避を即時flushする（IndexedDBドラフト
// だけを対象にした保険。ネットワーク自動保存の終了前flush＝
// flushPendingEditorAutosave の既存のbeforeunload配線とは別経路）。
if (!document._noteDraftFlushGlobalListenersAttached) {
  document._noteDraftFlushGlobalListenersAttached = true;
  const _flushCurrentNoteDraftReservation = () => {
    const pc = document.getElementById('page-content');
    if (pc) _flushNoteDraftReservation(pc, { ignoreComposing: true });
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) _flushCurrentNoteDraftReservation();
  });
  window.addEventListener('pagehide', _flushCurrentNoteDraftReservation);
  window.addEventListener('beforeunload', _flushCurrentNoteDraftReservation);
}

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
  let _dismissedMedia = null;

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
      _dismissedMedia = restoreTarget;
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
    controls.setAttribute('aria-hidden', 'false');
    resizeHandle.setAttribute('aria-hidden', 'false');
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
      if (media === _dismissedMedia) return;
      _showMediaControls(media);
      return;
    }
    // コントロール/リサイズ上にいる場合は維持
    if (_isMediaControlTarget(e.target)) return;
  });

  document.addEventListener('pointerdown', (e) => {
    const media = e.target?.closest?.('.embed-media');
    if (media) {
      _dismissedMedia = null;
      _showMediaControls(media);
      return;
    }
    if (_isMediaControlTarget(e.target)) return;
    if (_activeMedia) _scheduleHideMedia();
  });

  document.addEventListener('focusin', (e) => {
    const media = e.target?.closest?.('.embed-media');
    if (!media) return;
    if (media === _dismissedMedia) return;
    _showMediaControls(media);
  });
  document.addEventListener('focusout', (e) => {
    const media = e.target?.closest?.('.embed-media');
    if (!media || media !== _dismissedMedia) return;
    queueMicrotask(() => {
      if (!media.contains(document.activeElement)) _dismissedMedia = null;
    });
  });

  document.addEventListener('keydown', (e) => {
    const media = e.target?.closest?.('.embed-media');
    if (media && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      _dismissedMedia = null;
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
    if (e.target.closest('.embed-media') === _dismissedMedia) _dismissedMedia = null;
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
