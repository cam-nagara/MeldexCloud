/* gb-file-info-panel.js: フォルダとボードで共有するファイル情報パネル */
(function initMeldexFileInfoPanel(global) {
  'use strict';

  const renderRevisions = new WeakMap();
  const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico']);
  const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'webm']);
  const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac']);

  function escapeHtml(value) {
    if (typeof global.esc === 'function') return global.esc(String(value == null ? '' : value));
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function iconHtml(name, size) {
    return typeof global.lucide === 'function' ? global.lucide(name, size || 16) : '';
  }

  function fileIcon(ext) {
    if (IMAGE_EXTS.has(ext)) return 'image';
    if (VIDEO_EXTS.has(ext)) return 'clapperboard';
    if (AUDIO_EXTS.has(ext)) return 'audio';
    if (ext === 'md') return 'fileText';
    if (ext === 'json') return 'db';
    if (ext === 'board' || ext === 'mel-board') return 'layoutDashboard';
    if (ext === 'pdf') return 'fileText';
    if (ext === 'html' || ext === 'htm') return 'codeXml';
    return 'file';
  }

  function formatFileSize(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) return '';
    if (value < 1024) return value + ' B';
    if (value < 1048576) return (value / 1024).toFixed(1) + ' KB';
    if (value < 1073741824) return (value / 1048576).toFixed(1) + ' MB';
    return (value / 1073741824).toFixed(1) + ' GB';
  }

  function contextForPath(filePath) {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    const fileName = normalized.split('/').pop() || normalized;
    const dotIndex = fileName.lastIndexOf('.');
    const ext = dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : '';
    const folderPath = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '';
    const folderName = folderPath.split('/').pop() || folderPath;
    const typeLabel = ext === 'md'
      ? 'ノート'
      : ext === 'json'
        ? 'シナリオ／シート'
        : ext === 'board' || ext === 'mel-board'
          ? 'ボード'
          : ext === 'html' || ext === 'htm'
            ? 'HTML'
            : ext || 'ファイル';
    return { fileName, ext, folderPath, folderName, typeLabel };
  }

  function metadataRowsHtml(meta) {
    if (!meta) return '';
    const rows = [];
    const dateRow = (label, value) => {
      if (!value) return;
      const parsed = new Date(value);
      const text = Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString('ja-JP');
      rows.push([label, text]);
    };
    dateRow('作成日時', meta.created);
    dateRow('更新日時', meta.modified);
    if (meta.size != null) rows.push(['ファイルサイズ', formatFileSize(meta.size)]);
    if (meta._metadataLoadError) rows.push(['詳細', '読み込めませんでした']);
    return rows.map(([label, value]) => (
      `<tr><td style="padding:4px 8px 4px 0;color:var(--fg2);white-space:nowrap;">${escapeHtml(label)}</td>`
      + `<td style="padding:4px 0;">${escapeHtml(value)}</td></tr>`
    )).join('');
  }

  function panelHtml(filePath, preloadedMeta, options) {
    const info = contextForPath(filePath);
    const tagsHtml = options?.showTags === false
      ? ''
      : `<div data-global-tags-target-path="${escapeHtml(filePath)}"></div>`;
    const folderIdentity = 'file-info-folder-' + encodeURIComponent(filePath);
    const folderHtml = info.folderPath
      ? `<button type="button" class="auto-link" data-e2e-id="${escapeHtml(folderIdentity)}" data-path="${escapeHtml(info.folderPath)}" data-native-folder="true" style="padding:0;border:0;background:transparent;color:var(--accent);font:inherit;cursor:pointer;">${escapeHtml(info.folderName)}</button>`
      : '—';
    return `<div style="padding:12px;" data-file-info-path="${escapeHtml(filePath)}">`
      + `<div style="font-size:15px;font-weight:bold;margin-bottom:12px;display:flex;align-items:center;gap:6px;">${iconHtml(fileIcon(info.ext), 16)} ${escapeHtml(info.fileName)}</div>`
      + '<table style="font-size:13px;color:var(--fg2);width:100%;border-collapse:collapse;">'
      + '<tbody>'
      + `<tr><td style="padding:4px 8px 4px 0;color:var(--fg2);white-space:nowrap;">種類</td><td style="padding:4px 0;">${escapeHtml(info.typeLabel)}</td></tr>`
      + `<tr><td style="padding:4px 8px 4px 0;color:var(--fg2);white-space:nowrap;">フォルダ</td><td style="padding:4px 0;">${folderHtml}</td></tr>`
      + `<tr><td style="padding:4px 8px 4px 0;color:var(--fg2);white-space:nowrap;">パス</td><td style="padding:4px 0;word-break:break-all;font-size:11px;">${escapeHtml(filePath)}</td></tr>`
      + '</tbody>'
      + `<tbody data-file-info-metadata-rows>${metadataRowsHtml(preloadedMeta)}<tr data-file-info-loading><td style="padding:4px 8px 4px 0;color:var(--fg2);">詳細</td><td style="padding:4px 0;">読み込み中...</td></tr></tbody>`
      + `</table><div class="file-embedded-panel" data-file-embedded-metadata-path="${escapeHtml(filePath)}"></div>`
      + `${tagsHtml}</div>`;
  }

  function findPanel(root, filePath) {
    if (!root) return null;
    return [...root.querySelectorAll('[data-file-info-path]')]
      .find(element => element.dataset.fileInfoPath === filePath) || null;
  }

  async function loadMetadata(filePath, preloadedMeta) {
    const preloaded = preloadedMeta && typeof preloadedMeta === 'object' ? preloadedMeta : null;
    if (preloaded && preloaded.embedded !== undefined) return preloaded;
    if (typeof global.apiFetch !== 'function') return preloaded;
    try {
      const fetched = await global.apiFetch('/file-meta?path=' + encodeURIComponent(filePath), { silentError: true });
      return fetched ? { ...(preloaded || {}), ...fetched } : preloaded;
    } catch (error) {
      return {
        ...(preloaded || {}),
        _metadataLoadError: error?.userMessage || error?.message || String(error),
      };
    }
  }

  function applyMetadata(root, filePath, meta) {
    const panel = findPanel(root, filePath);
    if (!panel) return false;
    const rows = panel.querySelector('[data-file-info-metadata-rows]');
    if (rows) rows.innerHTML = metadataRowsHtml(meta);
    const embeddedHost = [...panel.querySelectorAll('[data-file-embedded-metadata-path]')]
      .find(element => element.dataset.fileEmbeddedMetadataPath === filePath);
    global.MeldexEmbeddedMetadata?.renderEditor?.(embeddedHost, filePath, meta);
    return true;
  }

  function hydrateTags(root, options) {
    if (options?.showTags === false) return;
    if (typeof global.hydrateGlobalTagTargetEditors === 'function') {
      global.hydrateGlobalTagTargetEditors(root);
    }
  }

  async function renderInto(container, filePath, options) {
    if (!container) return false;
    const normalizedPath = String(filePath || '').trim();
    if (!normalizedPath) {
      container.innerHTML = '<div class="gb-empty-placeholder">ファイルが選択されていません</div>';
      return false;
    }
    const revision = (renderRevisions.get(container) || 0) + 1;
    renderRevisions.set(container, revision);
    const metadataPromise = loadMetadata(normalizedPath, options?.preloadedMeta);
    container.innerHTML = panelHtml(normalizedPath, options?.preloadedMeta, options);
    hydrateTags(container, options);
    const meta = await metadataPromise;
    if (renderRevisions.get(container) !== revision || options?.isCurrent?.() === false) return false;
    return applyMetadata(container, normalizedPath, meta);
  }

  async function showInDetailPanel(filePath, options) {
    const normalizedPath = String(filePath || '').trim();
    if (!normalizedPath || typeof global.showDetailPanel !== 'function') return false;
    const metadataPromise = loadMetadata(normalizedPath, options?.preloadedMeta);
    if (typeof global._dpSavePending === 'function' && !await global._dpSavePending()) return false;
    if (options?.isCurrent?.() === false) return false;
    await global.showDetailPanel(panelHtml(normalizedPath, options?.preloadedMeta, options));
    if (options?.isCurrent?.() === false) return false;
    const detailRoot = global.document.getElementById('rp-detail') || global.document;
    hydrateTags(detailRoot, options);
    const meta = await metadataPromise;
    if (options?.isCurrent?.() === false) return false;
    return applyMetadata(detailRoot, normalizedPath, meta);
  }

  function renderEmbedded(container, target) {
    if (!container) return false;
    const title = String(target?.label || target?.name || '埋め込みファイル');
    const type = String(target?.typeLabel || target?.type || '埋め込みデータ');
    const source = String(target?.source || target?.path || '');
    const dimensions = Number(target?.width) > 0 && Number(target?.height) > 0
      ? `${Math.round(target.width)} × ${Math.round(target.height)} px`
      : '';
    container.innerHTML = `<div style="padding:12px;" data-file-info-embedded="true">`
      + `<div style="font-size:15px;font-weight:bold;margin-bottom:12px;">${escapeHtml(title)}</div>`
      + '<table style="font-size:13px;color:var(--fg2);width:100%;border-collapse:collapse;"><tbody>'
      + `<tr><td style="padding:4px 8px 4px 0;white-space:nowrap;">種類</td><td style="padding:4px 0;">${escapeHtml(type)}</td></tr>`
      + (dimensions ? `<tr><td style="padding:4px 8px 4px 0;white-space:nowrap;">画像サイズ</td><td style="padding:4px 0;">${escapeHtml(dimensions)}</td></tr>` : '')
      + (source ? `<tr><td style="padding:4px 8px 4px 0;white-space:nowrap;">参照先</td><td style="padding:4px 0;word-break:break-all;font-size:11px;">${escapeHtml(source)}</td></tr>` : '')
      + '</tbody></table></div>';
    return true;
  }

  function cancel(container) {
    if (!container) return;
    renderRevisions.set(container, (renderRevisions.get(container) || 0) + 1);
  }

  global.MeldexFileInfoPanel = Object.freeze({
    renderInto,
    showInDetailPanel,
    renderEmbedded,
    cancel,
    contextForPath,
  });
})(window);
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

  // カラー列は、テキスト入力ではなく共通カラーパレットで色を選んで追加する。
  const _ptcAdd = (parentDb && typeof getPropertyTypes === 'function') ? getPropertyTypes(parentDb)[propName] : null;
  if (_ptcAdd?.type === 'color' && typeof openColorPalette === 'function') {
    let saved = false;
    let saveTimer = null;
    openColorPalette(valuesEl, '', (color) => {
      if (saved) return;
      const hex = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(color || '').trim()) ? color.trim() : '';
      clearTimeout(saveTimer);
      if (!hex) return;
      // ライブ変更のたびに保存せず、色が落ち着いてから1回だけ候補値を追加する
      saveTimer = setTimeout(async () => {
        if (saved) return;
        saved = true;
        try {
          await _apiPostValue(entityPath, propName, hex, '採用', '');
          const fresh = await apiFetch('/entity?path=' + encodeURIComponent(entityPath)).catch(() => null);
          if (fresh && fresh.properties) renderEntityPropsGridInto(grid, fresh, entityPath, opts);
          else {
            if (!Array.isArray(data.properties[propName])) data.properties[propName] = [];
            data.properties[propName].push({ property: propName, value: hex, status: '採用', note: '', file: entityPath });
            renderEntityPropsGridInto(grid, data, entityPath, opts);
          }
        } catch (e) { showStatus('候補値の追加に失敗しました', true); }
      }, 300);
    });
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
    // カード自体は draggable にしない。専用ハンドル（entry-prop-drag-handle）だけで
    // 並べ替えられるようにし、値要素の文字選択（gb-entity-props-selection.js）と
    // ゴーストカードが競合しないようにする（シート表示・ビュー状態・エントリ操作の
    // 改善計画 2026-08-04。行ドラッグハンドル row-drag-handle と同じ慣行）。
    card.draggable = false;
    let dragHandle = null;
    const nameEl = document.createElement('div');
    nameEl.className = 'entry-prop-name';
    if (layoutEditMode) {
      dragHandle = document.createElement('span');
      dragHandle.className = 'entry-prop-drag-handle';
      dragHandle.draggable = true;
      dragHandle.title = 'ドラッグして並べ替え';
      dragHandle.dataset.e2eId = _entityPropControlId('entry-prop-drag', propName);
      dragHandle.setAttribute('role', 'button');
      dragHandle.setAttribute('aria-label', 'ドラッグして並べ替え: ' + propName);
      dragHandle.innerHTML = typeof lucide === 'function' ? lucide('gripVertical', 14) : '☰';
      dragHandle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      nameEl.appendChild(dragHandle);
    }
    // 各列名の前に列タイプのアイコンを表示する
    if (typeof lucide === 'function' && typeof getPropertyTypeIcon === 'function') {
      const typeIcon = document.createElement('span');
      typeIcon.className = 'entry-prop-type-icon';
      typeIcon.setAttribute('aria-hidden', 'true');
      typeIcon.innerHTML = lucide(getPropertyTypeIcon(propTypes[propName]?.type), 14);
      nameEl.appendChild(typeIcon);
    }
    const nameText = document.createElement('span');
    nameText.className = 'entry-prop-name-text';
    nameText.textContent = propName;
    nameEl.appendChild(nameText);
    card.appendChild(nameEl);
    const valuesEl = document.createElement('div');
    valuesEl.className = 'entry-prop-values cell-values';
    const values = filterValues(data.properties[propName] || []);
    const ptc = propTypes[propName];
    // ロールアップ/数式型は保存値でなくその場の計算結果を1つだけ表示する（表セルと同じ見え方）。
    // 未変換の生値が複数残っていても計算結果は1本にまとめ、値が無くても空の計算結果を表示する。
    const isComputedProp = ptc?.type === 'rollup' || ptc?.type === 'formula';
    const renderValues = isComputedProp
      ? [values[0] || { value: '', status: '採用' }]
      : (ptc?.type === 'image' && values.length === 0)
        ? [{ value: '', status: '採用', file: entityPath, property: propName, candidate_index: null }]
        : values;
    renderValues.forEach(val => {
      let valEl;
      if (typeof createTypedValueElement === 'function' && ptc) {
        valEl = createTypedValueElement(val, entityPath, propName, 'small', ptc, {
          entityData: data.properties,
          propTypes,
        });
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
    // ロールアップ/数式型は計算結果であり候補値を追加できないため、＋ボタンは出さない
    // （シート表側の _nonValueTypes 除外と同じ扱い）。
    if (!isComputedProp) {
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
      // ＋（候補値を追加）は独立行ではなく、値群の末尾（最後の値と同じ行）にインライン配置する。
      const lastValueEl = !layoutEditMode
        ? Array.from(valuesEl.children).reverse().find(el => el.classList && el.classList.contains('cell-value'))
        : null;
      if (lastValueEl) {
        const tail = document.createElement('div');
        tail.className = 'entry-prop-value-tail';
        valuesEl.insertBefore(tail, lastValueEl);
        tail.appendChild(lastValueEl);
        tail.appendChild(addBtn);
      } else {
        valuesEl.appendChild(addBtn);
      }
    }
    card.appendChild(valuesEl);

    // D&D 並べ替え (DB 単位の順序保存。同 DB のすべてのエントリ表示で共有)
    // dragstart/dragend はドラッグ操作を実際に開始できる要素（専用ハンドル）へ付ける。
    // dragover/dragleave/drop はドロップ先判定なのでカード全体のままでよい
    // （ハンドル以外の場所へドロップしても、そのカードの位置へ挿入される）。
    if (dragHandle) {
      dragHandle.addEventListener('dragstart', (e) => {
        if (!layoutEditMode) return;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/x-meldex-entry-prop', propName);
        card.classList.add('dragging');
      });
      dragHandle.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        grid.querySelectorAll('.entry-prop-card.drag-over-left, .entry-prop-card.drag-over-right')
          .forEach(el => el.classList.remove('drag-over-left', 'drag-over-right'));
      });
    }
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

// エントリ自由記述の保存先/方式を決定する。
// - entityPathが.mdで終わる（新形式=1エントリ1ファイル）: /value経由、entry_revisionでCAS
// - それ以外（旧形式=フォルダ型エントリ）: 実体は ep + '/_freetext.md' への/file保存、etagでCAS
function _entityFreeTextTarget(entityPath) {
  const path = String(entityPath || '');
  if (!path) return { path: '', mode: 'file' };
  return path.endsWith('.md') ? { path, mode: 'value' } : { path: path + '/_freetext.md', mode: 'file' };
}

function _entityFreeTextShowConflictPending(hostEl, entityPath, documentKey) {
  window.MeldexConflictPendingBanner?.show?.(documentKey, {
    label: '競合を保留中',
    e2eId: 'entity-freetext-conflict-pending-banner',
    onConfirm: () => {
      _entityFreeTextReviewConflict(hostEl, entityPath, documentKey)
        .catch(() => showStatus('エントリ本文の競合確認に失敗しました', true));
    },
  });
}

function _entityFreeTextRestoreConflictReview(hostEl, entityPath, documentKey, record) {
  const coordinator = window.MeldexDocumentSaveCoordinator;
  if (coordinator && record) {
    const current = coordinator.getConflict?.(documentKey);
    if (!current || current.generation !== record.generation) return;
    coordinator.restoreConflict?.(documentKey, record);
  }
  _entityFreeTextShowConflictPending(hostEl, entityPath, documentKey);
}

async function _entityFreeTextReviewConflict(hostEl, entityPath, documentKey) {
  const coordinator = window.MeldexDocumentSaveCoordinator;
  const record = coordinator?.requestConflictReview?.(documentKey) || null;
  if (coordinator && !record) return;
  const generation = record?.generation ?? null;
  const target = _entityFreeTextTarget(entityPath);
  const localMd = hostEl && typeof htmlToMd === 'function'
    ? htmlToMd(hostEl.innerHTML)
    : String(record?.localMd || '');
  window.MeldexConflictPendingBanner?.hide?.(documentKey);
  const keepLocal = typeof cfConfirm === 'function'
    ? await cfConfirm('このエントリ本文は他の場所で更新されています。今の編集内容で上書きしますか？（キャンセルすると最新版を読み込み、今の編集内容は下書きに残ります）')
    : false;
  try {
    if (!hostEl || hostEl.dataset.entityPath !== entityPath) {
      _entityFreeTextRestoreConflictReview(hostEl, entityPath, documentKey, record);
      return;
    }
    if (keepLocal) {
      const result = target.mode === 'value'
        ? await apiPut('/value?path=' + encodeURIComponent(target.path), {
            new_body: localMd,
            skip_if_missing: true,
          })
        : await apiPut('/file?path=' + encodeURIComponent(target.path), {
            content: localMd,
            force_overwrite: true,
          });
      const resolved = coordinator?.resolveConflict?.(documentKey, generation);
      if (coordinator && !resolved) {
        throw new Error('エントリ本文の競合状態が更新されたため、上書き結果を確定できません');
      }
      hostEl.dataset.lastSavedMd = localMd;
      if (target.mode === 'value') {
        hostEl.dataset.lastSavedRevision = (result?.revision != null)
          ? String(result.revision)
          : hostEl.dataset.lastSavedRevision || '';
      } else {
        hostEl.dataset.lastSavedEtag = result?.etag || hostEl.dataset.lastSavedEtag || '';
        if (result?.transport_revision && coordinator?.normalizeTransportRevision) {
          hostEl.dataset.lastSavedTransportRevision = coordinator.normalizeTransportRevision(
            coordinator.currentTransportName(),
            result.transport_revision,
          );
        }
      }
      coordinator?.bindDocumentIdentity?.(target.path, result || {});
      if (resolved) window.MeldexConflictPendingBanner?.hide?.(documentKey);
      await window.MeldexDraftRecovery?.markSynced?.(target.path);
      showStatus('自分の編集でエントリ本文を上書き保存しました');
      return;
    }

    await window.MeldexDraftRecovery?.saveDraft?.(
      target.path,
      localMd,
      hostEl.dataset.lastSavedEtag || hostEl.dataset.lastSavedRevision || '',
    );
    const latest = await apiFetch('/entity?path=' + encodeURIComponent(entityPath));
    if (!hostEl || hostEl.dataset.entityPath !== entityPath) {
      _entityFreeTextRestoreConflictReview(hostEl, entityPath, documentKey, record);
      return;
    }
    const latestMd = String(latest?.page_content || '');
    hostEl.innerHTML = latestMd.trim() && typeof mdToHtml === 'function'
      ? (typeof applyAutoLinks === 'function'
          ? applyAutoLinks(mdToHtml(latestMd, { basePath: entityPath }), entityPath)
          : mdToHtml(latestMd))
      : '';
    hostEl.dataset.lastSavedMd = latestMd;
    hostEl.dataset.lastSavedRevision = (latest?.revision != null) ? String(latest.revision) : '';
    hostEl.dataset.lastSavedEtag = latest?.freetext_etag || '';
    hostEl.dataset.lastSavedTransportRevision = '';
    const resolved = coordinator?.resolveConflict?.(documentKey, generation);
    if (coordinator && !resolved) {
      throw new Error('エントリ本文の競合状態が更新されたため、再読込結果を確定できません');
    }
    if (resolved) window.MeldexConflictPendingBanner?.hide?.(documentKey);
    _bindEntityFreeTextParticipant(hostEl, entityPath);
    showStatus('最新版のエントリ本文を読み込みました');
  } catch (error) {
    _entityFreeTextRestoreConflictReview(hostEl, entityPath, documentKey, record);
    throw error;
  }
}

// /api/entity のrevisionは新形式エントリの論理版、/api/file の
// transport_revisionは実ファイルの保存先固有版で役割が異なる。参加登録時は
// metadata_onlyのidentityだけを文書キー統合へ使い、/valueのCASへファイルetagを
// 流用しない。旧形式の_freetext.mdだけは同じ/file経路なので読込etagも保持する。
function _bindEntityFreeTextParticipant(hostEl, entityPath) {
  const coordinator = window.MeldexDocumentSaveCoordinator;
  const target = _entityFreeTextTarget(entityPath);
  if (!coordinator || !hostEl || !target.path) return;
  const provisionalKey = coordinator.documentKeyForPath(target.path);
  coordinator.registerParticipant(provisionalKey, hostEl);
  if (coordinator.isConflictPending?.(provisionalKey)) {
    _entityFreeTextShowConflictPending(hostEl, entityPath, provisionalKey);
  }
  Promise.resolve(apiFetch(
    '/file?path=' + encodeURIComponent(target.path) + '&metadata_only=true',
    { silentError: true },
  )).then((metadata) => {
    if (!metadata || hostEl.dataset.entityPath !== entityPath) return;
    const documentKey = coordinator.bindDocumentIdentity?.(target.path, metadata) || provisionalKey;
    coordinator.registerParticipant(documentKey, hostEl);
    if (target.mode === 'file' && metadata.transport_revision && coordinator.normalizeTransportRevision) {
      hostEl.dataset.lastSavedTransportRevision = coordinator.normalizeTransportRevision(
        coordinator.currentTransportName(),
        metadata.transport_revision,
      );
    }
    if (coordinator.isConflictPending?.(documentKey)) {
      _entityFreeTextShowConflictPending(hostEl, entityPath, documentKey);
    }
  }).catch(() => {
    // 新規の旧形式エントリ本文では _freetext.md がまだ無い。初回保存の
    // create_onlyで生成するため、metadata 404は表示や入力を妨げない。
  });
}

// 工程2-C項目5・6: エントリ自由記述の保存を保存コーディネーター経由へ接続する。
// メインパネル（ft.oninput/onblur）とタブ/パネル切替flush（flushPendingEditorAutosave）の
// 双方から呼ばれる共有関数にすることで、同じ文書に対する保存経路の分断を無くす。
// hostEl は dataset.lastSavedMd / lastSavedRevision / lastSavedEtag を保持する
// contenteditable要素（メインパネルの#entity-freetext、モバイルドロワーの本文editor等）。
async function _saveEntityFreeText(hostEl, entityPath, md, opts) {
  const target = _entityFreeTextTarget(entityPath);
  if (!target.path) return true;
  const coordinator = window.MeldexDocumentSaveCoordinator;
  const revision = (hostEl && hostEl.dataset && hostEl.dataset.lastSavedRevision) || '';
  const transportRevision = (hostEl && hostEl.dataset && hostEl.dataset.lastSavedTransportRevision) || '';
  const etag = (hostEl && hostEl.dataset && hostEl.dataset.lastSavedEtag) || '';
  if (!coordinator) {
    // コーディネーター未ロード時のフォールバック（従来の直接呼び出し。旧シグネチャ互換）。
    const res = target.mode === 'value'
      ? await apiPut('/value?path=' + encodeURIComponent(target.path), {
          new_body: md,
          skip_if_missing: true,
          ...(revision !== '' ? { base_revision: Number(revision) } : {}),
        })
      : await apiPut('/file?path=' + encodeURIComponent(target.path), {
          content: md,
          ...((transportRevision || etag) ? {
            if_match_etag: etag,
            transport_revision: transportRevision,
            skip_if_missing: true,
          } : {
            create_only: true,
          }),
        });
    if (typeof _handleFreeTextSkippedMissingSave === 'function' && _handleFreeTextSkippedMissingSave(res)) return false;
    return true;
  }
  const documentKey = coordinator.documentKeyForPath(target.path);
  if (hostEl) coordinator.registerParticipant(documentKey, hostEl);
  const guardedTransportRevision = transportRevision || etag;
  const sendFn = (previousResult) => (target.mode === 'value'
    ? apiPut('/value?path=' + encodeURIComponent(target.path), {
        new_body: md, skip_if_missing: true,
        ...((previousResult?.revision ?? revision) !== ''
          ? { base_revision: Number(previousResult?.revision ?? revision) }
          : {}),
      })
    : apiPut('/file?path=' + encodeURIComponent(target.path), {
        content: md,
        ...((previousResult?.transport_revision || previousResult?.etag || guardedTransportRevision) ? {
          if_match_etag: coordinator.revisionTokenForWrite(
            previousResult?.transport_revision || previousResult?.etag || guardedTransportRevision,
          ),
          transport_revision: previousResult?.transport_revision
            || previousResult?.etag
            || guardedTransportRevision,
          skip_if_missing: true,
        } : {
          create_only: true,
        }),
      }));
  try {
    const res = await coordinator.requestSave(documentKey, hostEl, target.path, md, sendFn, {
      reason: (opts && opts.reason) || 'entity-freetext',
    });
    if (res && res.conflictPending) return false;
    if (typeof _handleFreeTextSkippedMissingSave === 'function' && _handleFreeTextSkippedMissingSave(res)) return false;
    if (hostEl && hostEl.dataset && hostEl.dataset.entityPath === entityPath) {
      hostEl.dataset.lastSavedMd = (res && res.savedMd != null) ? res.savedMd : md;
      if (target.mode === 'value') hostEl.dataset.lastSavedRevision = (res && res.revision != null) ? String(res.revision) : revision;
      else {
        hostEl.dataset.lastSavedEtag = (res && res.etag) || etag;
        if (res?.transport_revision && coordinator.normalizeTransportRevision) {
          hostEl.dataset.lastSavedTransportRevision = coordinator.normalizeTransportRevision(
            coordinator.currentTransportName(),
            res.transport_revision,
          );
        }
      }
    }
    if (res) coordinator.bindDocumentIdentity?.(target.path, res);
    return true;
  } catch (error) {
    if (error?.status === 409 || error?.meldexCode === 'etag_conflict') {
      coordinator.reportConflict(documentKey, {
        path: target.path,
        localMd: md,
        localEtag: target.mode === 'value' ? revision : etag,
        serverDetail: (error && error.meldexDetail && typeof error.meldexDetail === 'object') ? error.meldexDetail : null,
      });
      _entityFreeTextShowConflictPending(hostEl, entityPath, documentKey);
    }
    throw error;
  }
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
  if (window.MeldexEntityDetail?.mount) {
    const entityPath = state.currentEntityPath;
    const controller = window.MeldexEntityDetail.mount({
      root: document.getElementById('entity-view'),
      path: entityPath,
      surface: 'main',
      data,
    });
    controller.ready.then((mounted) => {
      if (!mounted || state.currentEntityPath !== entityPath) return;
      if (typeof _renderEntityActions === 'function') _renderEntityActions(data, entityPath);
      if (typeof _renderEntityBacklinks === 'function') _renderEntityBacklinks(data, entityPath);
    });
    return;
  }
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
          _saveEntityFreeText(ft, ep, '', { reason: 'entity-freetext-create' }).catch(() => { showStatus('自由記述の作成に失敗しました', true); });
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
  // 工程2-C項目5・6: 読込直後の保存済みbaseline（内容+revision/etag）をdatasetへ保持し、
  // 文書ID単位のarbiterへ参加登録する（新形式=revision、旧形式=freetext_etagのどちらか）。
  ft.dataset.lastSavedMd = hasNote ? rawContent : '';
  ft.dataset.lastSavedRevision = (data.revision != null) ? String(data.revision) : '';
  ft.dataset.lastSavedEtag = data.freetext_etag || '';
  ft.dataset.lastSavedTransportRevision = '';
  _bindEntityFreeTextParticipant(ft, entityPath);
  // Markdown→HTML変換してからauto-link適用 (rawContent は冒頭で取得済み)
  if (hasNote) {
    const ftHtml = applyAutoLinks(mdToHtml(rawContent, { basePath: entityPath }), entityPath);
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
      _saveEntityFreeText(ft, ep, md, { reason: 'entity-freetext-auto' }).catch(() => { showStatus('自由記述の自動保存に失敗しました', true); });
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
      const saved = await _saveEntityFreeText(this, ep, md, { reason: 'entity-freetext-blur' });
      if (!saved) return;
      showStatus('自由記述を保存しました', false, { passiveSave: true });
      this.innerHTML = applyAutoLinks(mdToHtml(md, { basePath: ep }), ep);
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
  const editable = el?.closest?.('#page-content, #entity-freetext, #dp-editable, .meldex-entity-detail-editor') || null;
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
// options.basePath: 本文が属するノートのパス。相対メディアパス（WebClipperのクリップ本文など）を
// 解決する基準になる。省略した場合は従来どおり src をそのまま出力する。
function mdToHtml(md, options) {
  if (!md) return '';
  const _prevMediaBasePath = _mdMediaBasePath;
  _mdMediaBasePath = String((options && options.basePath) || '');
  try {
  // 改行コード正規化（CRLF→LF）
  md = md.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // フロントマター（YAML）を除去
  md = md.replace(/^---\n[\s\S]*?\n---\n?/, '');
  // 注釈用 line-id マーカーをセンチネル化。リスト/見出し/引用の場合はマーカー記号の直後へ、
  // その他は単独行としてブロック前に残し、末尾で span 化 → 隣接ブロックへ移送する。
  md = md.replace(/^<!--nl:([A-Za-z0-9_-]+)-->\r?\n([^\n]*)/gm, (m, id, nextLine) => {
    const sen = '\x02NLID:' + id + '\x02';
    // チェックリスト行は「- [ ] 」まるごとをbullet接頭辞として扱う（先に判定しないと
    // 汎用listMが「- 」だけを接頭辞と誤認し、センチネルが [ ] の手前に挟まってしまう）。
    const clM = nextLine.match(/^(\s*[*\-+]\s+\[[ xX]\]\s+)(.*)$/);
    if (clM) return clM[1] + sen + clM[2];
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
      // 安定アンカーID（工程11）: 見出しリンク作成時に getOrAssignStableHeadingAnchorId
      // が付与した行ID（<!--nl:ID-->）は、NLID正規化により content 先頭のセンチネルとして
      // 現れる。これが有る場合はテキストに依存しない永続IDを id/data-note-heading-id の
      // 正本にし、テキストスラグ由来の旧形式IDは data-note-heading-legacy-id へ退避して
      // 旧アンカー形式のリンクからも解決できるようにする（安定性検証: 見出し名変更・
      // 重複見出しの増減があっても、既にリンク済みの見出しのIDは変わらない）。
      const persistentHeadingIdMatch = content.match(/^\x02NLID:([A-Za-z0-9_-]+)\x02/);
      const persistentHeadingId = persistentHeadingIdMatch ? persistentHeadingIdMatch[1] : '';
      const legacyHeadingId = _noteHeadingId(content, headingSlugCounts);
      const headingId = persistentHeadingId || legacyHeadingId;
      content = content.replace(/^:([a-zA-Z][a-zA-Z0-9-]*):/, (match, iconName) => {
        if (typeof LUCIDE !== 'undefined' && LUCIDE[iconName] && typeof lucide === 'function') {
          return `<span class="heading-icon">${lucide(iconName, lv <= 2 ? 20 : 16)}</span> `;
        }
        return match; // 存在しないアイコン名はテキストとして保持
      });
      let idAttrs = '';
      if (headingId) {
        idAttrs = ` id="${esc(headingId)}" data-note-heading-id="${esc(headingId)}"`;
        if (persistentHeadingId && legacyHeadingId && legacyHeadingId !== headingId) {
          idAttrs += ` data-note-heading-legacy-id="${esc(legacyHeadingId)}"`;
        }
      }
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

    // リスト（チェックリスト） — 「- [ ] 」「- [x] 」。箇条書き判定より先に行う。
    const clm = line.match(/^(\s*)[*\-+]\s+\[([ xX])\]\s+(.*)$/);
    if (clm) {
      const indent = clm[1].length;
      const checked = clm[2].toLowerCase() === 'x';
      adjustListDepth(indent, 'ul');
      html += `<li class="note-checklist-item" data-checked="${checked ? 'true' : 'false'}"><input type="checkbox" class="note-checklist-check" contenteditable="false" tabindex="-1" aria-label="チェック項目" data-e2e-id="note-checklist-check"${checked ? ' checked' : ''}>${inlinemd(clm[3])}</li>`;
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
  } finally {
    _mdMediaBasePath = _prevMediaBasePath;
  }
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

// 見出しの安定アンカーID（工程11: 見出しリンク作成）。
// 既存の行ID機構（getOrAssignNoteLineId）を再利用し、見出しテキストにも
// 前後の見出しの増減・改名にも依存しない永続IDを見出しへ割り当てる。
// - 未割当なら新規採番し、その場で id / data-note-heading-id を更新する
//   （次回の mdToHtml 再描画を待たず、挿入直後のリンクも即座に機能させるため）。
// - 既存の（テキストスラグ由来の）ID は data-note-heading-legacy-id へ退避し、
//   旧アンカー形式のリンクからの解決（_scrollNoteAnchorIntoView）を維持する。
// 工程9（右クリック／ハンドルへの「見出しへのリンクをコピー」統合）でも
// このヘルパーをそのまま再利用する想定。
function getOrAssignStableHeadingAnchorId(headingEl) {
  if (!headingEl || !/^H[1-6]$/.test(headingEl.tagName || '')) return '';
  const legacyId = headingEl.id || headingEl.dataset?.noteHeadingId || '';
  const stableId = typeof getOrAssignNoteLineId === 'function' ? getOrAssignNoteLineId(headingEl) : '';
  if (!stableId) return legacyId; // 行ID機構が使えない場合は現行ID（旧形式）のまま
  if (headingEl.id !== stableId) headingEl.id = stableId;
  if (headingEl.dataset) {
    headingEl.dataset.noteHeadingId = stableId;
    if (legacyId && legacyId !== stableId) headingEl.dataset.noteHeadingLegacyId = legacyId;
  }
  return stableId;
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
  const target = headings.find(el => el.dataset?.noteHeadingId === id || el.dataset?.noteHeadingLegacyId === id || el.id === id);
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

// ノート本文の相対メディアパスを解決するための基準パス。mdToHtml 実行中だけ値が入る
// （mdToHtml は同期処理なので、描画が入れ子になっても保存・復元で正しく戻る）。
// WebClipperで保存したクリップ本文は `_assets/画像.jpg`（ノートフォルダ基準）や
// `Web Clipper/_assets/画像.jpg`（保存先フォルダ基準・旧形式）のような相対パスを含む。
// 相対パスのままだと <img src> がアプリ自身のURL基準で解決されてしまい画像が出ないため、
// ここで保存先基準のパスへ直してからファイル取得URLに変換する。
var _mdMediaBasePath = '';

function _mdNormalizeVaultRelPath(path) {
  const out = [];
  for (const part of String(path || '').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { out.pop(); continue; }
    out.push(part);
  }
  return out.join('/');
}

// Markdown中の相対メディアパスを保存先基準のパスへ解決する。
// 解決できない場合（基準パス未設定・絶対URL・データURL等）は空文字列を返す。
function _mdResolvedMediaPath(src) {
  const raw = String(src || '').trim();
  if (!raw) return '';
  // 絶対URL / ルート相対 / データURL / ページ内アンカーはそのまま扱う
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(raw)) return '';
  const base = String(_mdMediaBasePath || '').replace(/\\/g, '/');
  if (!base) return '';
  const dir = base.replace(/\/[^/]*$/, '');
  let rel = raw.replace(/&amp;/g, '&');
  try { rel = decodeURIComponent(rel); } catch (_) {}
  rel = rel.replace(/\\/g, '/');
  if (!dir) return _mdNormalizeVaultRelPath(rel);
  // 旧形式（WebClipperの古いクリップ）は保存先フォルダ名から始まる完全パスなので二重に連結しない
  if (rel === dir || rel.startsWith(dir + '/')) return _mdNormalizeVaultRelPath(rel);
  const dirName = dir.split('/').pop();
  const relHead = rel.split('/')[0];
  if (dirName && relHead === dirName) {
    return _mdNormalizeVaultRelPath(dir + '/' + rel.slice(relHead.length + 1));
  }
  return _mdNormalizeVaultRelPath(dir + '/' + rel);
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
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, altFull, srcRaw) => {
    // 拡張alt解析: ![alt|w=300|path=...](src)
    const parts = altFull.split('|');
    const alt = parts[0];
    let w = 0, dataPath = '', mediaType = '';
    for (let i = 1; i < parts.length; i++) {
      if (parts[i].startsWith('w=')) w = parseInt(parts[i].slice(2));
      if (parts[i].startsWith('path=')) dataPath = parts[i].slice(5);
      if (parts[i].startsWith('type=')) mediaType = parts[i].slice(5).toLowerCase();
    }
    // 相対パス（WebClipperのクリップ本文など）は保存先基準のパスへ直してから取得URLにする
    let src = srcRaw;
    const resolvedPath = _mdResolvedMediaPath(srcRaw);
    if (resolvedPath) {
      src = '/api/file-raw?path=' + encodeURIComponent(resolvedPath);
      if (!dataPath) dataPath = esc(resolvedPath);
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
        if (node.classList?.contains('note-checklist-item')) {
          const checked = node.dataset?.checked === 'true' || !!node.querySelector('input.note-checklist-check')?.checked;
          return _liMk + indent + '- [' + (checked ? 'x' : ' ') + '] ' + text + '\n' + nestedList;
        }
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
          // 行種変換（gb-note-block-types.js）で他行種からコールアウトへ変換した場合、
          // 保持対象の _nl-id マーカーは callout-block 自身の先頭子要素として置かれる
          // （callout-icon より前）。既存の素のコールアウトには無いため空文字のまま。
          const _calloutMk = _nlIdMarker(node);
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
          return _calloutMk + firstLine + (restLines ? '\n' + restLines : '') + '\n';
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
  if (/^(?:javascript|vbscript|data):/i.test(String(filePath).trim())) return '';
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

async function openLinkInFloatPanel(filePath, name, options) {
  if (!filePath) return;
  const noteAnchorId = _noteAnchorIdFromHref(filePath);
  if (noteAnchorId) {
    _scrollNoteAnchorIntoView(null, noteAnchorId);
    return;
  }
  const label = name || filePath.split(/[/\\]/).pop();
  if (typeof flushPendingEditorAutosave === 'function') await flushPendingEditorAutosave();
  if (typeof openLinkedPathInFloatPanel === 'function') {
    return openLinkedPathInFloatPanel(filePath, label, options || {});
  }
  return _openLinkInCurrentTab(filePath, label);
}

function openLinkInRightPane(filePath, name, options) {
  if (typeof openLinkedPathInRightPane === 'function') {
    const label = name || filePath.split(/[/\\]/).pop();
    return openLinkedPathInRightPane(filePath, label, options || {});
  }
  return openLinkInFloatPanel(filePath, name, options);
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
  openLinkInFloatPanel(filePath, name, {
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
  if (target.closest('.status-dot')) return null;
  const sourcePaneId = target.closest('.gb-pane')?.dataset?.paneId || '';

  const autoLink = target.closest('.auto-link[data-path]');
  if (autoLink) {
    const path = _resolveAutoLinkPath(autoLink.dataset.path || '');
    if (!path) return null;
    return {
      path,
      label: _contextLinkLabel(autoLink, path),
      linkType: autoLink.dataset.linkType || autoLink.dataset.type || '',
      sourcePaneId,
      element: autoLink,
      nativeFolder: autoLink.dataset.nativeFolder === 'true',
    };
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
  // フロートパネル／サブパネル内では、右サイドバーで開く（別サブパネルを開くUI）を
  // 表示しない（計画書「右サイドバー操作の制限」節）。
  const _canUseRightSidebar = typeof GBPaneBridge === 'undefined' || typeof GBPaneBridge.canUseRightSidebarTools !== 'function'
    || typeof GBPaneBridge.surfaceOf !== 'function'
    || GBPaneBridge.canUseRightSidebarTools(GBPaneBridge.surfaceOf(e?.target || null));

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
  const isExternalContextUrl = /^https?:\/\//i.test(browserUrl);
  if (isExternalContextUrl) {
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
  const localHostname = String(window.location?.hostname || '').toLowerCase();
  const canOpenNativeFolder = linkTarget.nativeFolder
    && (!localHostname || ['localhost', '127.0.0.1', '::1'].includes(localHostname))
    && typeof apiPost === 'function';
  if (canOpenNativeFolder) {
    addItem('folderOpen', 'エクスプローラーで開く', () => {
      if (typeof openNative === 'function') {
        openNative(linkTarget.path);
        return;
      }
      apiPost('/open-native', { path: linkTarget.path }, { silentError: true })
        .then(() => {
          if (typeof showStatus === 'function') showStatus('エクスプローラーで開きました');
        })
        .catch(error => {
          if (typeof showStatus === 'function') showStatus('フォルダを開けませんでした: ' + (error?.message || error), true);
        });
    });
  }
  if (!linkTarget.localAnchor) {
    addItem('layers-2', 'フロートパネルで開く', () => openLinkInFloatPanel(linkTarget.path, linkTarget.label, {
      linkType: linkTarget.linkType || '',
      sourcePaneId: linkTarget.sourcePaneId || '',
    }));
    addItem('panelTop', 'メインパネルで開く', () => openLinkInMainPane(linkTarget.path, linkTarget.label, {
      linkType: linkTarget.linkType || '',
      sourcePaneId: linkTarget.sourcePaneId || '',
    }));
    if (_canUseRightSidebar) {
      addItem('panelRight', '右サイドバーで開く', () => openLinkInRightPane(linkTarget.path, linkTarget.label, {
        linkType: linkTarget.linkType || '',
        sourcePaneId: linkTarget.sourcePaneId || '',
        sourceEl: e?.target || null,
      }));
    }
    if (typeof canOpenLinkedPathStandalone !== 'function' || canOpenLinkedPathStandalone(linkTarget.path, linkTarget.linkType || '')) {
      addItem('externalLink', '単独アプリで開く', () => openLinkStandalone(linkTarget.path, linkTarget.label, {
        linkType: linkTarget.linkType || '',
        sourcePaneId: linkTarget.sourcePaneId || '',
      }));
    }
    if (!isExternalContextUrl && typeof window.revealPathInFolderTree === 'function') {
      addItem('folderTree', 'フォルダツリーに表示', () => window.revealPathInFolderTree(linkTarget.path));
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

function _openContextLinkFloatPanel(linkTarget) {
  if (!linkTarget?.path) return;
  if (typeof linkTarget.openAction === 'function') {
    linkTarget.openAction();
    return;
  }
  openLinkInFloatPanel(linkTarget.path, linkTarget.label, {
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
    _openContextLinkFloatPanel(linkTarget);
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
let _fileInfoRenderRevision = 0;
let _fileInfoCurrentPath = '';
let _fileInfoCurrentPromise = null;

function _showFileInfoInDetailPanel(filePath, preloadedMeta, options) {
  const normalizedPath = String(filePath || '').trim();
  if (!normalizedPath) return Promise.resolve();
  const autoTagTargets = Array.isArray(options?.autoTagTargets)
    ? options.autoTagTargets.filter(item => item?.path)
    : [];
  if (autoTagTargets.length) {
    window.MeldexTagManagement?.setAutoTagTargets?.(autoTagTargets);
  } else {
    window.MeldexTagManagement?.setAutoTagTarget?.(normalizedPath, false);
  }
  const multiFileTargets = autoTagTargets.filter(item => item.type !== 'folder');
  const renderKey = multiFileTargets.length > 1
    ? 'multi:' + multiFileTargets.map(item => String(item.path)).sort().join('\n')
    : normalizedPath;
  // OptionTargetContext（計画書§11.1）: フォルダパネルの一般ファイル選択・メディア表示・
  // ビューワー内ファイル切替はすべてこの関数を通るため、ここを「今バックリンク等の
  // オプションパネルが対象にすべきファイル」の単一の更新地点にする。早期returnより前に
  // 呼ぶことで、キャッシュ済み描画をスキップする場合でも選択状態の追従は必ず起きる
  // （ファイル参照整合性計画 Phase 5: フォルダパネルの一般ファイル選択が古いノート等の
  // 対象でバックリンクを表示し続ける不具合の修正）。
  if (multiFileTargets.length > 1) {
    window.GBOptionTargetContext?.set(
      multiFileTargets.map(item => ({ path: item.path, kind: 'file' })),
      'file-info-panel-multi'
    );
  } else {
    window.GBOptionTargetContext?.set({ path: normalizedPath, kind: 'file' }, 'file-info-panel');
  }
  const detailRoot = document.getElementById('rp-detail') || document;
  if (renderKey === _fileInfoCurrentPath) {
    if (_fileInfoCurrentPromise) return _fileInfoCurrentPromise;
    const currentFileInfoPanel = [...detailRoot.querySelectorAll('[data-file-info-path]')]
      .some(element => element.dataset.fileInfoPath === normalizedPath);
    if (currentFileInfoPanel || detailRoot.querySelector('[data-folder-multi-info-host]')) return Promise.resolve();
  }
  const revision = ++_fileInfoRenderRevision;
  _fileInfoCurrentPath = renderKey;
  const renderTask = multiFileTargets.length > 1 && window.MeldexFolderMultiInfo?.render
    ? window.MeldexFolderMultiInfo.render(multiFileTargets, {
        isCurrent: () => revision === _fileInfoRenderRevision && _fileInfoCurrentPath === renderKey,
      })
    : window.MeldexFileInfoPanel?.showInDetailPanel(normalizedPath, {
        preloadedMeta,
        isCurrent: () => revision === _fileInfoRenderRevision && _fileInfoCurrentPath === renderKey,
      });
  const task = Promise.resolve(renderTask).catch(error => {
    if (revision === _fileInfoRenderRevision) {
      console.warn('ファイル情報パネルの更新に失敗しました', error);
    }
  });
  _fileInfoCurrentPromise = task.finally(() => {
    if (revision === _fileInfoRenderRevision) _fileInfoCurrentPromise = null;
  });
  return _fileInfoCurrentPromise;
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

    const isEntityFreetext = savedEditable.id === 'entity-freetext';
    const savePromise = isEntityFreetext && typeof _saveEntityFreeText === 'function'
      ? _saveEntityFreeText(savedEditable, ep, md, { reason: 'ruby' })
      : (window.MeldexNoteSaveAdapter
        ? window.MeldexNoteSaveAdapter.performSave(savedEditable, savePath, md, { reason: 'ruby' })
        : apiPut('/file?path=' + encodeURIComponent(savePath), {
            content: md,
            if_match_etag: savedEditable.dataset.lastSavedEtag || '',
            transport_revision: savedEditable.dataset.lastSavedTransportRevision || '',
          }));
    savePromise.then((saved) => {
      if (saved === false || saved?.conflictPending) return;
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
    const impactTargets = items.map(item => ({ path: item.path, kind: item.type === 'folder' ? 'folder' : 'file' }));
    const confirmMessage = items.length + ' 件を削除しますか？';
    const confirmed = typeof MeldexDeleteImpactWarning !== 'undefined'
      ? await MeldexDeleteImpactWarning.confirmDeleteWithImpact(impactTargets, confirmMessage)
      : await cfConfirm(confirmMessage);
    if (!confirmed) return;
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
    if (document.getElementById('file-search-bar')?.classList.contains('open')) { closeFileSearch(); e.preventDefault(); return; }
    if (document.getElementById('search-panel')?.classList.contains('open')) { closeSearchPanel(); e.preventDefault(); return; }
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

// 計画書§5工程7-8: 現在行の論理ブロック定義・移動判定は gb-note-block-reorder.js
// （MeldexNoteBlockTypes.resolveCurrentBlockベース）へ統合した。旧実装は
// document.activeElement を無条件に「編集ホスト」とみなし、見出しセクション
// ラッパー（section.heading-section）を越えてpc直下まで無条件に登っていたため
// heading-section単位で誤って移動する経路があった。ハンドルドラッグと
// Alt+Shift+↑/↓が同じresolverを共有する（§2.4「ドラッグとキーボードは同じ
// resolverを使う」）。第一級の実装は gb-note-block-reorder.js を参照。
function moveBlock(direction) {
  if (typeof MeldexNoteBlockReorder === 'undefined') return;
  return MeldexNoteBlockReorder.moveBlock(direction);
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
// contextOverride: 行ハンドルの右クリック（gb-note-block-reorder.js の
// _onHandleContextMenu）から呼ばれる場合に渡される { editable, blockInfo }。
// 通常の contextmenu バインド（bindNoteEditorContextMenu）経由では
// e.currentTarget が editable 自身なので省略でよい（バグ報告§3の「可能であれば」対応）。
function _noteCtxMenuHandler(e, contextOverride) {
  const editable = (contextOverride && contextOverride.editable) || e.currentTarget;
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
  // 計画書§5工程9-1: 右クリック/長押し位置(caretRangeFromPoint優先、フォールバックは
  // e.target位置)から対象の論理ブロック(行)を解決する。ロック中/読み取り専用時は
  // このハンドラ自体が発火しない(呼び出し元 bindNoteEditorContextMenu 参照)。
  const _blockInfo = (contextOverride && contextOverride.blockInfo !== undefined)
    ? contextOverride.blockInfo
    : ((typeof MeldexNoteBlockContextMenu !== 'undefined')
      ? MeldexNoteBlockContextMenu.resolveBlockInfoForEvent(editable, e, _ctxTargetEl)
      : null);
  const _blockIsHeading = !!(_blockInfo && _blockInfo.kind === 'heading');
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
    // 計画書§5工程9: 「行種変更」(共通行種メニューのサブメニュー)。
    { type: 'blockType', blockInfo: _blockInfo },
    // 計画書§5工程11項目4: 見出し限定で「この見出しへのリンクをコピー」を追加する。
    ...(_blockIsHeading ? [{
      label: 'この見出しへのリンクをコピー',
      enabled: true,
      action: () => {
        if (typeof MeldexNoteBlockContextMenu !== 'undefined') MeldexNoteBlockContextMenu.copyHeadingLink(_blockInfo.block);
      },
    }] : []),
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
    // 工程9: 「行種変更」サブメニューを開いたまま外側の項目クリックやEscapeで
    // 親メニューだけが閉じると、サブメニューが孤立表示のまま残る。閉じる経路を
    // 問わず必ず一緒に畳む(ARIA aria-expanded/対象行ハイライトも合わせて解除)。
    if (typeof MeldexNoteBlockMenu !== 'undefined' && MeldexNoteBlockMenu.isOpen()) MeldexNoteBlockMenu.close();
    if (typeof MeldexNoteBlockContextMenu !== 'undefined') MeldexNoteBlockContextMenu.clearHighlight();
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
    if (item.type === 'blockType') {
      // 工程9: ホバー/矢印右で開く共通行種メニュー(gb-note-block-menu.js)への
      // サブメニュートリガー。構築・開閉・対象行ハイライトは共有ヘルパーへ委譲する
      // (gb-note-block-context-menu.js。ハンドルクリックメニュー側の見出しリンク
      // コピー統合と同じ対象行解決・ハイライトクラスを再利用するため)。
      const el = (typeof MeldexNoteBlockContextMenu !== 'undefined')
        ? MeldexNoteBlockContextMenu.buildBlockTypeMenuTrigger({
            editable,
            blockInfo: item.blockInfo,
            onAfterAction: () => closeNoteContextMenu(false),
          })
        : _editorMenuButton('行種変更', false, () => {});
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
      if (menu.contains(ev.target)) return;
      // 修正2: 「行種変更」サブメニュー(gb-note-block-menu.js の #note-block-menu)は
      // このメニューの子ではなく document.body 直下の別要素として開く。
      // pointerdown を素朴に「外側クリック」判定すると、サブメニュー項目を
      // クリックした瞬間にこの outside-click ハンドラが先に発火し、
      // MeldexNoteBlockMenu.close() でサブメニューを閉じてしまい、直後の click
      // イベントが選択項目に届かなくなる（行種変更が「全く機能しない」原因）。
      // サブメニュー内のクリックは外側クリック扱いにしない。
      const blockMenuEl = document.getElementById('note-block-menu');
      if (blockMenuEl && blockMenuEl.contains(ev.target)) return;
      closeNoteContextMenu(true);
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
