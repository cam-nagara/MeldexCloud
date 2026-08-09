/* ==============================
   gb-link-router.js: 共通リンクルーター

   計画書: app/docs/subpanel-floatpanel-dialog-keyboard-plan_2026-07-31.md
     「実装構成 > 共通リンクルーターと副画面ホスト」節

   パス・拡張子・既存メタデータから「どのMeldexアプリで表示すべきか」を
   単一の契約 `{ type, path, label, state }` へ解決する。新しい右サイドバー
   常設パネル（GBSubPanel）が主な利用元。

   gb-board-links.js からもこのルーターを優先利用する。既存のNode単体回帰では
   gb-link-router.jsを読み込まずgb-board-links.jsだけを評価するため、その場合に
   限って同じ判定規則のフォールバックを残している。実アプリでは本モジュールが
   正本となり、ボードとサブパネルでリンク解決の挙動を共有する。
   ============================== */

const GBLinkRouter = (() => {
  const EXTERNAL_BROWSER_RE = /^https?:\/\//i;
  const EXTERNAL_ACTION_RE = /^(mailto:|tel:)/i;

  const IMAGE_EXTS = ['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'apng', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'];
  const VIDEO_EXTS = ['mp4', 'mov', 'avi', 'webm', 'mkv', 'ogv'];
  const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'];

  // 「対応対象」節に列挙された形式のうち、拡張子だけで機械的に判定できるもの。
  // これに含まれない拡張子（.docx / .pptx / .zip / .exe 等）は resolve() で
  // recognized:false（サブパネル側は unsupported 扱い）になる。
  const KNOWN_EXTS = new Set([
    'md', 'txt', 'json', 'board', 'csv', 'html', 'htm', 'pdf',
    ...IMAGE_EXTS, ...VIDEO_EXTS, ...AUDIO_EXTS,
  ]);
  const KNOWN_COMPOUND_SUFFIXES = [
    '.mel-scenario', '.scriptnote.json', '.scenario.json',
    '.mel-board', '.board.json', '.canvas.json',
    '.mel-sheet', '.smart-db.json',
    '.mel-timer', '.timer.json',
  ];

  // 明示 linkType（'database'/'sheet'/'scenario'/'image' 等、UI側やボードノードが
  // 持つ簡略表記）を、表示先タブ種別へ正規化する。
  // gb-board-links.js の _bdResolveOpenType と同じ対応表（挙動を揃えるため）。
  function normalizeExplicitType(type) {
    const t = String(type || '').trim();
    if (t === 'database' || t === 'sheet') return 'pivot';
    if (t === 'scenario') return 'scriptnote';
    if (t === 'image' || t === 'video' || t === 'audio') return 'media';
    if (t === 'pdf') return 'pdf';
    if (t === 'document') return 'document';
    return t;
  }

  function ext(path) {
    const fileName = String(path || '').split(/[/\\]/).pop() || '';
    return fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
  }

  function mediaTypeFromExt(extension) {
    const e = String(extension || '').toLowerCase();
    if (IMAGE_EXTS.includes(e)) return 'image';
    if (VIDEO_EXTS.includes(e)) return 'video';
    if (AUDIO_EXTS.includes(e)) return 'audio';
    if (e === 'pdf') return 'pdf';
    return '';
  }

  function isExternalBrowserUrl(path) {
    return EXTERNAL_BROWSER_RE.test(String(path || '').trim());
  }

  function isExternalActionUrl(path) {
    return EXTERNAL_ACTION_RE.test(String(path || '').trim());
  }

  function isExternalUrl(path) {
    return isExternalBrowserUrl(path) || isExternalActionUrl(path);
  }

  // 拡張子・複合サフィックスから表示先タブ種別を推定する（構造的な推定のみ、
  // ネットワーク照会は行わない）。gb-board-links.js の _bdInferLinkType と
  // 同じ優先順位・対応表を保つ。
  function inferTypeFromPath(path) {
    const lower = String(path || '').trim().toLowerCase();
    if (!lower) return '';
    if (isExternalUrl(lower)) return 'html';
    const extension = ext(lower);
    if (lower.endsWith('.mel-scenario') || lower.endsWith('.scriptnote.json') || lower.endsWith('.scenario.json')) return 'scriptnote';
    if (lower.endsWith('.mel-board') || lower.endsWith('.board.json') || lower.endsWith('.canvas.json') || extension === 'board') return 'board';
    if (lower.endsWith('.mel-sheet') || lower.endsWith('.smart-db.json')) return 'smart-db';
    if (lower.endsWith('.mel-timer') || lower.endsWith('.timer.json')) return 'timer';
    if (extension === 'md' || extension === 'txt') return 'page';
    if (extension === 'pdf') return 'pdf';
    if (extension === 'csv') return 'csv';
    if (extension === 'html' || extension === 'htm') return 'html';
    const media = mediaTypeFromExt(extension);
    if (media) return media;
    return '';
  }

  // 拡張子だけから「対応対象（計画書の一覧）に含まれる形式か」を判定する。
  // 拡張子なし（フォルダ/エントリ/ノートの可能性がある）は true 扱い
  // （後続の非同期照会や明示 linkType に委ねる）。
  function isRecognizedPath(path, explicitType) {
    if (normalizeExplicitType(explicitType)) return true;
    const lower = String(path || '').trim().toLowerCase();
    if (!lower) return true;
    if (isExternalUrl(lower)) return true;
    if (KNOWN_COMPOUND_SUFFIXES.some(suffix => lower.endsWith(suffix))) return true;
    const extension = ext(lower);
    if (!extension) return true;
    return KNOWN_EXTS.has(extension);
  }

  // { type, path, label, state } の state 部分（gb-board-links.js の
  // _bdTabStateForLinkedEntry と同じ形。仮想ペインへ渡すタブstateに使う）。
  function stateForEntry(entry) {
    const state = {};
    if (!entry || typeof entry !== 'object') return state;
    if (entry.mediaType) state.mediaType = entry.mediaType;
    if (entry.calendarFile) state.calendarFile = true;
    if (entry.urlExternal) state.urlExternal = true;
    if (entry.type === 'scriptnote') {
      state.scenarioPath = entry.path || '';
      state.label = entry.label || '';
    } else if (entry.type === 'board') {
      state.boardPath = entry.path || '';
      state.label = entry.label || '';
    }
    return state;
  }

  // フルの構造的解決（ネットワーク照会なし）。gb-board-links.js の
  // _bdResolveLinkedEntry と同じ分岐・優先順位・既定値を独立実装として保つ。
  function resolveEntry(path, label, linkType) {
    const nextPath = String(path || '').trim();
    const nextLabel = String(label || nextPath.split(/[/\\]/).pop() || nextPath).trim() || nextPath;
    const rawType = String(linkType || '').trim();
    const explicitType = rawType ? normalizeExplicitType(rawType) : '';
    const explicitMediaType = ['image', 'video', 'audio'].includes(rawType) ? rawType : '';
    const lower = nextPath.toLowerCase();
    const extension = ext(nextPath);

    let entry;
    if (explicitType === 'scriptnote') entry = { type: 'scriptnote', label: nextLabel, path: nextPath };
    else if (explicitType === 'board') entry = { type: 'board', label: nextLabel, path: nextPath };
    else if (explicitType === 'timer') entry = { type: 'timer', label: nextLabel, path: nextPath };
    else if (explicitType === 'csv') entry = { type: 'csv', label: nextLabel, path: nextPath };
    else if (explicitType === 'html') entry = { type: 'html', label: nextLabel, path: nextPath };
    else if (explicitType === 'entity') entry = { type: 'entity', label: nextLabel, path: nextPath };
    else if (['pivot', 'tree', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form'].includes(explicitType)) entry = { type: explicitType, label: nextLabel, path: nextPath };
    else if (explicitType === 'smart-db') entry = { type: 'smart-db', label: nextLabel, path: nextPath };
    else if (explicitType === 'folder') entry = { type: 'folder', label: nextLabel, path: nextPath };
    else if (explicitType === 'calendar') entry = { type: 'timeline', label: nextLabel, path: nextPath, calendarFile: true };
    else if (explicitType === 'pdf' || (explicitType === 'document' && extension === 'pdf')) {
      entry = { type: 'media', mediaType: 'pdf', label: nextLabel, path: nextPath };
    } else if (explicitType === 'document') entry = { type: 'page', label: nextLabel, path: nextPath };
    else if (explicitType === 'page') entry = { type: 'page', label: nextLabel, path: nextPath };
    else if (explicitType === 'media') {
      entry = { type: 'media', mediaType: explicitMediaType || mediaTypeFromExt(extension) || 'file', label: nextLabel, path: nextPath };
    } else if (lower.endsWith('.mel-scenario') || lower.endsWith('.scriptnote.json') || lower.endsWith('.scenario.json')) {
      entry = { type: 'scriptnote', label: nextLabel, path: nextPath };
    } else if (lower.endsWith('.mel-board') || lower.endsWith('.board.json') || lower.endsWith('.canvas.json')) {
      entry = { type: 'board', label: nextLabel, path: nextPath };
    } else if (extension === 'board') entry = { type: 'board', label: nextLabel, path: nextPath };
    else if (lower.endsWith('.mel-sheet') || lower.endsWith('.smart-db.json')) entry = { type: 'smart-db', label: nextLabel, path: nextPath };
    else if (lower.endsWith('.mel-timer') || lower.endsWith('.timer.json')) entry = { type: 'timer', label: nextLabel, path: nextPath };
    else if (extension === 'csv') entry = { type: 'csv', label: nextLabel, path: nextPath };
    else if (extension === 'html' || extension === 'htm') entry = { type: 'html', label: nextLabel, path: nextPath };
    else if (IMAGE_EXTS.includes(extension)) entry = { type: 'media', mediaType: 'image', label: nextLabel, path: nextPath };
    else if (VIDEO_EXTS.includes(extension)) entry = { type: 'media', mediaType: 'video', label: nextLabel, path: nextPath };
    else if (AUDIO_EXTS.includes(extension)) entry = { type: 'media', mediaType: 'audio', label: nextLabel, path: nextPath };
    else if (extension === 'pdf') entry = { type: 'media', mediaType: 'pdf', label: nextLabel, path: nextPath };
    else entry = { type: 'page', label: nextLabel, path: nextPath };

    return entry;
  }

  function _normalizeInput(pathOrTarget, hints) {
    const opts = hints || {};
    if (pathOrTarget && typeof pathOrTarget === 'object') {
      const path = String(pathOrTarget.path || pathOrTarget.link || '').trim();
      return {
        path,
        label: String(opts.label || pathOrTarget.label || pathOrTarget.text || path.split(/[/\\]/).pop() || path).trim(),
        linkType: String(opts.linkType || pathOrTarget.linkType || pathOrTarget.type || '').trim(),
      };
    }
    const path = String(pathOrTarget || '').trim();
    return {
      path,
      label: String(opts.label || path.split(/[/\\]/).pop() || path).trim(),
      linkType: String(opts.linkType || '').trim(),
    };
  }

  // 同期解決（ネットワーク照会なし）。
  // 戻り値: { type, path, label, state, external?, mediaType?, calendarFile?,
  //           urlExternal?, recognized }
  function resolve(pathOrTarget, hints) {
    const { path, label, linkType } = _normalizeInput(pathOrTarget, hints);
    if (!path) {
      return { type: 'unsupported', path: '', label: label || '', state: {}, recognized: false, reason: 'empty-path' };
    }
    if (isExternalActionUrl(path)) {
      return { external: true, type: 'external', path, label: label || path, state: {}, recognized: true };
    }
    if (isExternalBrowserUrl(path)) {
      return { external: true, type: 'external', path, label: label || path, state: {}, recognized: true };
    }
    const entry = resolveEntry(path, label, linkType);
    const recognized = isRecognizedPath(path, linkType);
    if (!recognized) entry.type = 'unsupported';
    entry.state = stateForEntry(entry);
    entry.recognized = recognized;
    return entry;
  }

  // 非同期解決。明示 linkType が無く、拡張子が md/json/なし（＝サーバー側の
  // 実データを見ないと表示先が確定できないケース）の場合だけ /check-type を
  // 照会する。gb-board-links.js の _bdShouldResolveLinkedType/_bdFetchLinkedType/
  // _bdResolveLinkedEntryAsync と同じ判定条件・キャッシュ戦略。
  const _typeCache = new Map();

  function _shouldQueryServerType(path, explicitType) {
    if (normalizeExplicitType(explicitType)) return false;
    const nextPath = String(path || '').trim();
    if (!nextPath || /^[a-z][a-z0-9+.-]*:\/\//i.test(nextPath)) return false;
    const extension = ext(nextPath);
    return !extension || ['md', 'json'].includes(extension);
  }

  async function _queryServerType(path) {
    const key = String(path || '').trim();
    if (!key) return '';
    if (_typeCache.has(key)) return _typeCache.get(key);
    let type = '';
    try {
      if (typeof apiFetch === 'function') {
        const result = await apiFetch('/check-type?path=' + encodeURIComponent(key));
        type = String(result?.type || '').trim();
      } else if (typeof fetch === 'function' && typeof API_BASE !== 'undefined') {
        const resp = await fetch(API_BASE + '/check-type?path=' + encodeURIComponent(key));
        if (resp.ok) {
          const result = await resp.json();
          type = String(result?.type || '').trim();
        }
      }
    } catch {
      type = '';
    }
    if (type === 'unknown') type = '';
    _typeCache.set(key, type);
    return type;
  }

  // ファイルの存在確認は型解決キャッシュと分離する。存在しなかったファイルを
  // 作成して「再読み込み」した場合に、古い結果で失敗し続けないためである。
  // 戻り値の checked=false は、実行環境が /check-type を提供しない、または
  // 一時的に照会できなかったことを示す。この場合は対象アプリ自身の読込処理へ
  // 進み、実際に失敗した時点でサブパネル側の再試行UIへ切り替える。
  async function checkAvailability(pathOrTarget) {
    const { path } = _normalizeInput(pathOrTarget);
    const key = String(path || '').trim();
    if (!key || isExternalUrl(key)) return { checked: false, exists: false, error: false };
    try {
      let result = null;
      if (typeof apiFetch === 'function') {
        result = await apiFetch('/check-type?path=' + encodeURIComponent(key), { silentError: true });
      } else if (typeof fetch === 'function' && typeof API_BASE !== 'undefined') {
        const resp = await fetch(API_BASE + '/check-type?path=' + encodeURIComponent(key));
        if (!resp.ok) return { checked: false, exists: false, error: true };
        result = await resp.json();
      } else {
        return { checked: false, exists: false, error: false };
      }
      if (typeof result?.exists === 'boolean') {
        return { checked: true, exists: result.exists, error: false };
      }
      // 旧ランタイムとの移行互換。型を解決できた応答は実体がある場合だけ返る。
      const resolvedType = String(result?.type || '').trim();
      if (resolvedType && resolvedType !== 'unknown') {
        return { checked: true, exists: true, error: false };
      }
      return { checked: false, exists: false, error: false };
    } catch {
      return { checked: false, exists: false, error: true };
    }
  }

  async function resolveAsync(pathOrTarget, hints) {
    const { path, label, linkType } = _normalizeInput(pathOrTarget, hints);
    if (!path) return resolve(pathOrTarget, hints);
    if (isExternalActionUrl(path) || isExternalBrowserUrl(path)) {
      return resolve(pathOrTarget, hints);
    }
    if (!_shouldQueryServerType(path, linkType)) {
      return resolve(pathOrTarget, hints);
    }
    const serverType = await _queryServerType(path);
    return resolve(pathOrTarget, { ...(hints || {}), label, linkType: serverType || linkType });
  }

  return {
    resolve,
    resolveAsync,
    checkAvailability,
    inferTypeFromPath,
    normalizeExplicitType,
    isRecognizedPath,
    isExternalUrl,
    isExternalBrowserUrl,
    isExternalActionUrl,
    mediaTypeFromExt,
    stateForEntry,
    ext,
  };
})();

if (typeof window !== 'undefined') window.GBLinkRouter = GBLinkRouter;
if (typeof module !== 'undefined' && module.exports) module.exports = GBLinkRouter;
