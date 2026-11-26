/* gb-folder-large.js: 大きなフォルダ（数千〜20万項目以上）のフォルダパネル表示（2026-11-24）。
 *
 * 項目数がしきい値を超えるフォルダだけ、一覧をページごとに取り（/api/browse-page）、
 * 見えている範囲と前後の余白だけカードを置く。小さなフォルダは従来の描き方のまま。
 *
 * - 一覧: ページ（200件）を位置で持つ。見えている範囲のページだけ取り、遠いページは捨てる。
 * - 配置: リスト／リスト・小は行の高さ固定、グリッドは列数×カードの高さ固定、ウォーターフォールは
 *   ページごとの塊で積む（寸法が分かった画像は縦横比で、分からない項目は正方形）。横並びはグリッドの配置で出す
 *   （幅が項目ごとに違い、全項目の寸法が無いと位置を決められないため）。
 * - 選択: パスで持つ。「すべて選択」は「全件（除外つき）」として持ち、対象のパスは /api/browse-paths で
 *   2万件ずつ取り寄せる。取り寄せが終わるまで _folderSelectedItems は空にして、一部だけを対象にした操作を防ぐ。
 * - 並べ替え・名前の絞り込み・種類の絞り込みはサーバーへ渡す。
 *
 * gb-folder.js の分割読み込みの末尾で読み込む（_folderItems などの状態は gb-folder.part01 と共有）。
 */
(function (global) {
  'use strict';

  const DEFAULT_THRESHOLD = 3000;
  const PAGE = 200;
  const MAX_PAGES = 40;
  const MAX_IN_FLIGHT = 3;
  const PATHS_CHUNK = 20000;
  // 一覧の読み取り待ちの知らせ（pending）の後、聞き直すまでの間隔。読み取りは 0.2〜0.3 秒で終わることが多いので、最初は短く。
  const PENDING_RETRY_STEPS = [100, 200, 300];
  function pendingDelay(tries) { return PENDING_RETRY_STEPS[Math.min(Math.max(0, tries), PENDING_RETRY_STEPS.length - 1)]; }
  const GAP = 3;
  const CARD_BUDGET_MS = 8; // 1回の描画の区切りでカードを作る時間の上限
  const SERVER_SORTS = new Set(['name', 'modified', 'created']);
  const KIND_OF_TYPE = { folder: 'folder', database: 'folder', image: 'image', video: 'video', audio: 'audio', page: 'note', other: 'other' };
  const KIND_CHOICES = [['folder', 'フォルダ'], ['image', '画像'], ['video', '動画'], ['audio', '音声'], ['page', 'ノート'], ['other', 'その他']];
  const UNAVAILABLE_TIP = '大きなフォルダでは使えません';
  const IMAGE_EXT = /\.(png|apng|jpe?g|jpe|jfif|gif|bmp|webp|svg|ico|avif|tiff?|heic|heif|psd|psb)$/i;
  const VIDEO_EXT = /\.(mp4|webm|mov|avi|mkv)$/i;
  const AUDIO_EXT = /\.(mp3|wav|ogg|flac|m4a|aac)$/i;

  let threshold = DEFAULT_THRESHOLD;
  let S = null;
  const boundContainers = new WeakSet();
  const stateByContainer = new WeakMap(); // 描画先 → その面の状態（メインとサブパネルが別々に持つ）
  const stats = { requests: 0, slowest: 0, longestSync: 0, samples: [] };

  function noteRequest(started) {
    const took = now() - started;
    stats.requests += 1;
    stats.slowest = Math.max(stats.slowest, took);
    stats.samples.push(Math.round(took));
    if (stats.samples.length > 400) stats.samples.shift();
  }

  function now() { return (global.performance && performance.now) ? performance.now() : Date.now(); }

  function ensureStyle() {
    if (document.getElementById('gb-folder-large-style')) return;
    const style = document.createElement('style');
    style.id = 'gb-folder-large-style';
    style.textContent = [
      '.fv-large.list-layout > .fv-item{height:var(--fv-large-row-h,48px);min-height:0;overflow:hidden;flex:none;}',
      '.fv-large.list-layout .fv-list-name{overflow:hidden;white-space:nowrap;flex-direction:row;align-items:center;gap:6px;}',
      '.fv-large.list-layout .fv-list-name-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}',
      '.fv-large.list-layout .fv-list-extra-meta{flex-wrap:nowrap;overflow:hidden;flex:none;max-width:50%;}',
      '.fv-large{overflow-anchor:none;}',
      '.fv-large > .fv-large-spacer{flex:none;width:1px;pointer-events:none;grid-column:1 / -1;}',
      '.fv-large.list-layout > .fv-large-slot{height:var(--fv-large-row-h,48px);flex:none;box-sizing:border-box;}',
      '.fv-large.grid-layout > .fv-large-slot{width:var(--fv-card-w,120px);height:var(--fv-large-card-h,150px);box-sizing:border-box;border-radius:6px;background:var(--fv-item-bg,var(--bg2));opacity:.45;}',
      '.fv-large.grid-layout > .fv-item{height:var(--fv-large-card-h,150px);box-sizing:border-box;overflow:hidden;}',
      '.fv-large.waterfall-layout > .fv-item{box-sizing:border-box;overflow:hidden;}',
      '.fv-large:is(.grid-layout,.waterfall-layout) .fv-thumb{height:var(--fv-large-thumb-h,110px);margin-bottom:2px;display:flex;align-items:center;justify-content:center;overflow:hidden;}',
      '.fv-large:is(.grid-layout,.waterfall-layout) .fv-thumb img{width:100%;height:100%;max-height:none;object-fit:contain;display:block;}',
      '.fv-large:is(.grid-layout,.waterfall-layout) .fv-icon{padding:0;}',
      '.fv-large:is(.grid-layout,.waterfall-layout) .fv-name{height:17px;line-height:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.fv-large:is(.grid-layout,.waterfall-layout) .fv-meta{height:14px;line-height:14px;flex-wrap:nowrap;overflow:hidden;margin-top:2px;}',
      '.fv-large [aria-disabled="true"].fv-list-header-cell{opacity:.5;cursor:default;}',
      '.gb-folder-large-off{opacity:.5;}',
    ].join('\n');
    document.head.appendChild(style);
  }

  function gridEl() { return typeof _folderGridEl === 'function' ? _folderGridEl() : document.getElementById('folder-grid'); }

  function active() {
    if (!S) return false;
    if (typeof _folderPath === 'undefined' || S.path !== _folderPath) return false;
    return S.container === gridEl();
  }

  // 面（メイン／サブパネル）のつなぎ替え: 今の面の状態を返し、渡された状態をつなぐ（gb-folder.part01.part00.js）。
  function swapState(next) {
    const previous = S;
    S = next || null;
    return previous;
  }

  // st がまだ生きているか。別の面をつないでいる間に届いた続き（ページの到着・タイマー・スクロール）は、
  // 自分の面をつなぎ直してから進める（処理の区切りで、操作中の面へ自動で戻る）。
  function live(st) {
    if (!st || st.disposed) return false;
    if (S === st) return true;
    if (typeof _folderEnterSurface !== 'function') return false;
    return _folderEnterSurface(st.surface || null) && S === st;
  }

  function disposeState(st) {
    if (!st || st.disposed) return;
    st.disposed = true;
    clearTimeout(st.pendingTimer);
    clearTimeout(st.ratioTimer);
    clearTimeout(st.shapeTimer);
    clearTimeout(st.refreshTimer);
    if (lasso && lasso.st === st) lassoStop(false);
    if (st.container && stateByContainer.get(st.container) === st) stateByContainer.delete(st.container);
  }

  function deactivate() {
    if (!S) return;
    const st = S;
    S = null;
    st.disposed = true;
    if (st.container && stateByContainer.get(st.container) === st) stateByContainer.delete(st.container);
    clearTimeout(st.pendingTimer);
    clearTimeout(st.ratioTimer);
    clearTimeout(st.shapeTimer);
    clearTimeout(st.refreshTimer);
    if (lasso && lasso.st === st) lassoStop(false);
    st.container?.classList?.remove('fv-large');
    ['--fv-large-row-h', '--fv-large-card-h', '--fv-large-thumb-h'].forEach(name => st.container?.style?.removeProperty(name));
  }

  // ---- 取り寄せ ------------------------------------------------------------------------------------

  function queryOf(st) {
    return 'path=' + encodeURIComponent(st.path)
      + '&sort=' + st.sort + '&order=' + st.order
      + (st.q ? '&q=' + encodeURIComponent(st.q) : '')
      + (st.kinds ? '&kinds=' + encodeURIComponent(st.kinds) : '');
  }

  async function timedFetch(path, opts) {
    const started = now();
    try {
      return await apiFetch(path, opts);
    } finally {
      noteRequest(started);
    }
  }

  function readQuery() {
    const sort = typeof _folderReadListSort === 'function' ? _folderReadListSort() : { key: 'name', order: 'asc' };
    const supported = SERVER_SORTS.has(sort.key);
    const cfg = typeof getFolderDisplayConfig === 'function' ? getFolderDisplayConfig() : {};
    const kinds = new Set();
    (Array.isArray(cfg.filterTypes) ? cfg.filterTypes : []).forEach(type => kinds.add(KIND_OF_TYPE[type] || 'other'));
    return {
      sort: supported ? sort.key : 'name',
      order: supported && sort.order === 'desc' ? 'desc' : 'asc',
      q: String(cfg.filterText || '').trim(),
      kinds: Array.from(kinds).sort().join(','),
    };
  }

  // 開く時の確認。大きなフォルダなら true（ここで描く）。小さなフォルダ・確認できない時は false（従来の描き方）。
  async function open(path, ctx) {
    const context = ctx || {};
    const stale = () => typeof context.isCurrent === 'function' && context.isCurrent() === false;
    // 別のフォルダ・別の描画先へ切り替わる時は、件数の確認を待たずに前の表示の状態を手放す（確認を待つ間、
    // 消えた一覧の状態のままキー操作や選択を受け付けない。すぐ元のフォルダへ戻った時も作り直す）。
    if (S && (S.path !== path || S.container !== gridEl())) deactivate();
    if (!path || global.MeldexRuntimeAdapter?.isDropboxMode?.() || typeof apiFetch !== 'function') { deactivate(); return false; }
    const same = S && S.path === path && S.container === gridEl();
    let probe = null;
    try {
      probe = await timedFetch('/browse-page?path=' + encodeURIComponent(path) + '&limit=1&at=0&all_files=true', { silentError: true });
    } catch (error) {
      if (stale()) return false;
      deactivate();
      return false;
    }
    if (stale()) return false;
    // 一覧の読み取りが 0.25 秒で終わらないフォルダは、大きなフォルダとして開き始める（件数は最初のページで確かめ、
    // しきい値より小さければ従来の描き方へ戻す）。
    const stillListing = !!probe && probe.pending === true;
    const totalAll = stillListing ? 0 : Number(probe?.total_unfiltered ?? probe?.total);
    if (!stillListing && (!Number.isFinite(totalAll) || totalAll <= threshold)) { deactivate(); return false; }
    if (stillListing) showPending(probe.listed);
    if (context.displayReady) { try { await context.displayReady; } catch {} }
    if (stale()) return false;
    if (!same) {
      deactivate();
      S = newState(path);
    }
    S.unconfirmed = stillListing;
    if (stillListing) { S.listing = true; S.listed = Number(probe.listed) || 0; S.loadedOnce = false; }
    S.totalUnfiltered = totalAll;
    const opts = { reload: true };
    if (context.resetScroll) opts.resetScrollTop = true;
    if (Array.isArray(context.selectedPaths)) opts.preserveSelectedPaths = context.selectedPaths;
    render(opts);
    await whenWindowLoaded();
    return true;
  }

  function showPending(listed) {
    const container = gridEl();
    if (container && !container.querySelector('.fv-item')) {
      let state = container.querySelector('.fv-loading-state');
      if (!state) {
        container.innerHTML = '';
        state = document.createElement('div');
        state.className = 'fv-loading-state';
        state.style.cssText = 'padding:24px;color:var(--fg2);';
        state.setAttribute('role', 'status');
        container.appendChild(state);
      }
      state.textContent = '読み込み中（' + (Number(listed) || 0) + '件）';
    }
    if (!(typeof _folderIsIndependentSurface === 'function' && _folderIsIndependentSurface())) {
      const count = document.getElementById('folder-item-count');
      if (count) count.textContent = '読み込み中（' + (Number(listed) || 0) + '件）';
    }
  }

  function newState(path) {
    return {
      surface: typeof _folderCurrentSurface === 'function' ? _folderCurrentSurface() : null,
      path, container: null, queryKey: '', sort: 'name', order: 'asc', q: '', kinds: '',
      total: 0, totalUnfiltered: 0, folderCount: null, signature: '', listed: 0, listing: false,
      pages: new Map(), inFlight: new Map(), wanted: [], linked: [],
      view: [], cards: new Map(), slots: new Map(), mode: 'grid', m: null,
      header: null, top: null, bottom: null, wfSpacer: null,
      ratios: new Map(), wfLayouts: new Map(), wfTops: null,
      sel: newSelection(), focusWant: -1,
      syncQueued: false, pendingTimer: 0, ratioTimer: 0, generation: 0, waiters: [],
    };
  }

  function newSelection() {
    return { all: false, excluded: new Set(), picked: new Map(), ranges: [], shape: null, allItems: null, resolving: 0, token: 0, anchor: -1, focus: -1, version: 0, cache: null, cacheVersion: -1 };
  }

  function count(st) { return (st.total || 0) + st.linked.length; }

  function lastPage(st) { return st.total > 0 ? Math.floor((st.total - 1) / PAGE) : 0; }

  function pageOf(st, index) { return Math.min(lastPage(st), Math.floor(index / PAGE)); }

  function itemAt(st, index) {
    if (index < 0 || index >= count(st)) return null;
    const page = pageOf(st, index);
    const items = st.pages.get(page);
    return items ? (items[index - page * PAGE] || null) : null;
  }

  function wantPages(st, pages) {
    st.wanted = pages.filter(page => page >= 0 && page <= lastPage(st) && !st.pages.has(page) && !st.inFlight.has(page));
    pump(st);
  }

  function pump(st) {
    while (st.wanted.length && st.inFlight.size < MAX_IN_FLIGHT) fetchPage(st, st.wanted.shift());
  }

  function fetchPage(st, page, options) {
    const force = options && options.force;
    if (st.inFlight.has(page) || (!force && st.pages.has(page))) return st.inFlight.get(page) || Promise.resolve();
    const key = st.queryKey;
    const promise = timedFetch('/browse-page?' + queryOf(st) + '&all_files=true&detail=true&limit=' + PAGE + '&at=' + (page * PAGE), { silentError: true })
      .then(result => {
        st.inFlight.delete(page);
        if (!live(st) || st.queryKey !== key) return;
        if (result && result.pending === true) {
          st.listing = true;
          st.listed = Number(result.listed) || 0;
          updateCount(st);
          clearTimeout(st.pendingTimer);
          st.pendingTries = (st.pendingTries || 0) + 1;
          st.pendingTimer = setTimeout(() => { if (live(st) && st.queryKey === key) { fetchPage(st, page, options); } }, pendingDelay(st.pendingTries - 1));
          return;
        }
        applyPage(st, page, result || {});
      })
      .catch(error => {
        st.inFlight.delete(page);
        if (!live(st) || st.queryKey !== key) return;
        st.failed = true;
        console.warn('[フォルダ] 一覧の読み込みに失敗しました', error);
        if (typeof showStatus === 'function') showStatus('フォルダの一覧を読み込めませんでした', true);
        settle(st);
      })
      .finally(() => { if (live(st)) pump(st); });
    st.inFlight.set(page, promise);
    return promise;
  }

  function applyPage(st, page, result) {
    st.listing = false;
    st.pendingTries = 0;
    st.failed = false;
    const items = Array.isArray(result.items) ? result.items : [];
    const signature = String(result.signature || '');
    const total = Number(result.total) || 0;
    if (st.unconfirmed) {
      st.unconfirmed = false;
      const all = Number(result.total_unfiltered ?? result.total) || 0;
      if (all <= threshold) { fallBackToClassic(st); return; }
    }
    const changed = (st.signature && signature && signature !== st.signature) || (st.loadedOnce && total !== st.total);
    if (changed) {
      // フォルダの中身が変わった: 取ってあるページを捨てて、見えている範囲から取り直す
      st.pages.clear();
      st.linked = [];
      st.wfLayouts.clear();
      st.folderCount = null;
      st.generation += 1;
      if (st.sel.all) resolveAll(st);
    }
    st.signature = signature || st.signature;
    const totalChanged = total !== st.total || !st.loadedOnce;
    st.total = total;
    if (Number.isFinite(Number(result.total_unfiltered))) st.totalUnfiltered = Number(result.total_unfiltered);
    st.loadedOnce = true;
    const start = Number(result.start) || 0;
    const own = Math.max(0, (Number(result.end) || 0) - start);
    if (start === page * PAGE || !total) {
      const pageItems = items.slice();
      if (result.at_end) st.linked = pageItems.slice(own);
      if (typeof isOutlinerDeletePendingPath === 'function') {
        pageItems.forEach(item => { if (item && isOutlinerDeletePendingPath(item.path)) item._folderLargeHidden = true; });
      }
      const pageKey = Math.min(page, lastPage(st));
      const existing = st.pages.get(pageKey);
      // 中身が変わっていなければ、前に取った項目をそのまま使う（置いてあるカードを作り直さない）
      if (!(existing && samePage(existing, pageItems))) {
        st.pages.set(pageKey, pageItems);
        st.wfLayouts.delete(pageKey);
      }
      if (typeof _registerFileIds === 'function') _registerFileIds(pageItems);
      if (typeof registerFileTypes === 'function') registerFileTypes(pageItems);
    }
    evict(st);
    publishItems(st);
    updateCount(st);
    // 件数や中身が変わった時は、寸法を決め直してその場で置き直す（余白だけ先に変えると、見えている位置がずれる）。
    // それ以外は、カードを置くのを次の描画の区切りへまとめる（続けて届いた複数ページを1回の長い処理にしない）。
    if (totalChanged || changed) { layout(st, { keepIndex: true }); sync(st, { hydrate: true }); }
    else {
      if (st.mode === 'waterfall') wfRecompute(st, true);
      queueSync(st);
    }
    finishFocus(st);
    if (st.folderCount == null) loadFolderCount(st);
    settle(st);
  }

  // 読み取りに時間がかかっただけの小さなフォルダだった: 従来の描き方で開き直す
  function fallBackToClassic(st) {
    const path = st.path;
    const container = typeof _folderResolveRenderOverride === 'function' ? _folderResolveRenderOverride() : null;
    settleNow(st);
    deactivate();
    if (typeof openFolder !== 'function') return;
    const label = String(path).split(String.fromCharCode(92)).join('/').split('/').filter(Boolean).pop() || path;
    openFolder(label, path, { silent: true, skipNavPush: true, skipSaveLastView: true, skipShowView: true, skipGlobalUi: true, containerEl: container });
  }

  function samePage(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      const x = a[i], y = b[i];
      if (!x || !y || x.path !== y.path || x.name !== y.name || x.type !== y.type || x.modified !== y.modified || x.size !== y.size
          || !!x._folderLargeHidden !== !!y._folderLargeHidden) return false;
    }
    return true;
  }

  function evict(st) {
    if (st.pages.size <= MAX_PAGES) return;
    const center = st.centerPage || 0;
    const pages = Array.from(st.pages.keys()).sort((a, b) => Math.abs(b - center) - Math.abs(a - center));
    while (st.pages.size > MAX_PAGES && pages.length) {
      const page = pages.shift();
      st.pages.delete(page);
      st.wfLayouts.delete(page);
    }
  }

  // 既存の処理が参照する配列へ、取ってある項目を渡す（_folderVisibleItems は位置で引ける疎な配列）。
  function publishItems(st) {
    const view = [];
    view.length = count(st);
    const dense = [];
    Array.from(st.pages.keys()).sort((a, b) => a - b).forEach(page => {
      const items = st.pages.get(page);
      for (let i = 0; i < items.length; i += 1) {
        if (!items[i]) continue;
        view[page * PAGE + i] = items[i];
        dense.push(items[i]);
      }
    });
    st.view = view;
    if (live(st) && active()) {
      _folderVisibleItems = view;
      _folderItems = dense;
    }
  }

  function loadFolderCount(st) {
    const key = st.queryKey;
    st.folderCount = -1;
    listingReady(st)
      .then(ready => (ready ? apiPost('/browse-paths', { path: st.path, sort: st.sort, order: st.order, q: st.q, kinds: 'folder', start: 0, end: 0 }, { silentError: true }) : null))
      .then(result => {
        if (!result) { if (live(st) && st.queryKey === key) st.folderCount = null; return; }
        if (!live(st) || st.queryKey !== key) return;
        const wantsFolders = !st.kinds || st.kinds.split(',').includes('folder');
        st.folderCount = wantsFolders ? (Number(result?.total) || 0) : 0;
        updateCount(st);
      })
      .catch(() => { if (live(st)) st.folderCount = null; });
  }

  function updateCount(st) {
    if (typeof _folderIsIndependentSurface === 'function' && _folderIsIndependentSurface()) return;
    const el = document.getElementById('folder-item-count');
    if (st.container && st.m && !st.loadedOnce) showLoading(st);
    if (el) {
      if (st.listing || !st.loadedOnce) el.textContent = '読み込み中（' + (st.listed || 0) + '件）';
      else {
        const shown = count(st);
        el.textContent = shown + (st.totalUnfiltered && st.totalUnfiltered !== st.total ? ' / ' + st.totalUnfiltered : '') + ' 項目';
      }
    }
    const status = document.getElementById('sb-count');
    if (status && st.loadedOnce && st.folderCount != null && st.folderCount >= 0) {
      status.textContent = 'フォルダ ' + st.folderCount + ' / ファイル ' + Math.max(0, count(st) - st.folderCount);
    }
  }

  function settle(st) {
    if (!st.waiters.length) return;
    if (st.listing || st.inFlight.size || st.wanted.length) return;
    settleNow(st);
  }

  function settleNow(st) {
    const waiters = st.waiters.splice(0);
    waiters.forEach(resolve => resolve());
  }

  // 一覧を取っておく側（サーバー）が読み直し中なら、終わるまで短い要求で待つ（パスの取り寄せは待ちの知らせを返さない）
  async function listingReady(st) {
    const key = st.queryKey;
    for (let tries = 0; tries < 400; tries += 1) {
      const probe = await timedFetch('/browse-page?' + queryOf(st) + '&all_files=true&limit=1&at=0', { silentError: true });
      if (!live(st) || st.queryKey !== key) return false;
      if (!probe || probe.pending !== true) return true;
      await new Promise(resolve => setTimeout(resolve, pendingDelay(tries)));
      if (!live(st) || st.queryKey !== key) return false;
    }
    return false;
  }

  function whenWindowLoaded() {
    const st = S;
    if (!st) return Promise.resolve();
    return new Promise(resolve => {
      st.waiters.push(resolve);
      setTimeout(() => settle(st), 0);
      // 読み込みが長引いても、開く処理は待たせ続けない（表示は続きを取り次第出る）
      setTimeout(resolve, 4000);
    });
  }

  // ---- 配置 ----------------------------------------------------------------------------------------

  function layoutMode() {
    const layout = typeof _folderLayout === 'undefined' ? 'grid' : _folderLayout;
    if (layout === 'list' || layout === 'list-small') return 'list';
    if (layout === 'waterfall') return 'waterfall';
    return 'grid';
  }

  function displayFlags() {
    const cfg = typeof getFolderDisplayConfig === 'function' ? getFolderDisplayConfig() : {};
    const isList = layoutMode() === 'list';
    return {
      isListLayout: isList,
      compactList: (typeof _folderLayout !== 'undefined') && _folderLayout === 'list-small',
      showThumbForLayout: isList || cfg.showThumb !== false,
      showName: cfg.showName !== false, showSize: cfg.showSize !== false, showDate: cfg.showDate !== false,
      showType: cfg.showType !== false, showDimensions: cfg.showDimensions !== false,
      showRating: cfg.showRating !== false, showTags: cfg.showTags !== false,
    };
  }

  function measure(st) {
    const container = st.container;
    const flags = displayFlags();
    const style = getComputedStyle(container);
    const padTop = parseFloat(style.paddingTop) || 0;
    const padLeft = parseFloat(style.paddingLeft) || 0;
    const padRight = parseFloat(style.paddingRight) || 0;
    const cardW = Math.max(48, parseInt(style.getPropertyValue('--fv-card-w'), 10) || 120);
    const m = { flags, padTop, padLeft, cardW, headerH: st.header ? st.header.offsetHeight : 0, viewH: container.clientHeight || 600 };
    if (st.mode === 'list') {
      const probe = document.createElement('div');
      probe.className = 'fv-item';
      probe.style.cssText = 'visibility:hidden;position:absolute;height:auto;';
      container.appendChild(probe);
      m.rowH = Math.max(16, Math.round(parseFloat(getComputedStyle(probe).minHeight) || 48));
      probe.remove();
      container.style.setProperty('--fv-large-row-h', m.rowH + 'px');
      m.cols = 1; m.pitch = m.rowH; m.cardH = m.rowH; m.gap = 0;
    } else {
      const hasMeta = flags.showSize || flags.showDate || flags.showType || flags.showTags || flags.showDimensions || flags.showRating;
      m.thumbH = flags.showThumbForLayout ? Math.max(24, cardW - 10) : 0;
      m.textH = (flags.showName ? 17 : 0) + (hasMeta ? 16 : 0);
      m.cardH = 10 + (m.thumbH ? m.thumbH + 2 : 0) + m.textH;
      m.gap = GAP;
      m.pitch = m.cardH + GAP;
      const inner = Math.max(cardW, container.clientWidth - padLeft - padRight);
      m.cols = Math.max(1, Math.floor((inner + GAP) / (cardW + GAP)));
      container.style.setProperty('--fv-large-card-h', m.cardH + 'px');
      container.style.setProperty('--fv-large-thumb-h', m.thumbH + 'px');
    }
    st.m = m;
    return m;
  }

  function baseTop(st) { return st.m.padTop + st.m.headerH; }

  function firstVisibleIndex(st) {
    const m = st.m;
    if (!m) return 0;
    const y = Math.max(0, st.container.scrollTop - m.padTop);
    if (st.mode === 'waterfall') return wfIndexAt(st, y);
    return Math.max(0, Math.floor(y / m.pitch)) * m.cols;
  }

  // 寸法を測り直し、スクロールできる高さを決める。keepIndex: 見えていた先頭の項目を保つ。
  function layout(st, options) {
    const keep = options && options.keepIndex && st.m ? firstVisibleIndex(st) : -1;
    measure(st);
    if (st.mode === 'waterfall') wfRecompute(st, false);
    st.winA = -1; st.winB = -1;
    if (keep > 0) scrollToIndex(st, keep, 'start');
  }

  function scrollToIndex(st, index, align) {
    const m = st.m;
    const container = st.container;
    let top, height;
    if (st.mode === 'waterfall') {
      const pos = wfPosition(st, index);
      top = m.padTop + pos.y; height = pos.h;
    } else {
      top = m.padTop + m.headerH + Math.floor(index / m.cols) * m.pitch;
      height = m.cardH;
    }
    const viewTop = container.scrollTop + (st.mode === 'list' ? m.headerH : 0);
    const viewBottom = container.scrollTop + container.clientHeight;
    if (align === 'start') container.scrollTop = Math.max(0, top - (st.mode === 'list' ? m.headerH : 0));
    else if (top < viewTop) container.scrollTop = Math.max(0, top - (st.mode === 'list' ? m.headerH : m.padTop));
    else if (top + height > viewBottom) container.scrollTop = top + height - container.clientHeight + 4;
  }

  // ---- ウォーターフォール（ページごとの塊で積む） ----------------------------------------------------

  function wfItemHeight(st, item) {
    const m = st.m;
    if (!m.thumbH) return 10 + m.textH;
    const ratio = item && st.ratios.get(item.path);
    const thumb = ratio ? Math.round(Math.max(0.3, Math.min(3, ratio)) * (m.cardW - 10)) : m.thumbH;
    return 10 + thumb + 2 + m.textH;
  }

  function wfPageCount(st, page) {
    const last = lastPage(st);
    if (page < last) return PAGE;
    return Math.max(0, count(st) - last * PAGE);
  }

  function wfBlock(st, page) {
    const items = st.pages.get(page);
    const m = st.m;
    if (!items) {
      const rows = Math.ceil(wfPageCount(st, page) / m.cols);
      return { height: rows * (m.cardH + GAP), loaded: false };
    }
    let block = st.wfLayouts.get(page);
    if (block) return block;
    const heights = new Array(m.cols).fill(0);
    const x = new Array(items.length), y = new Array(items.length), h = new Array(items.length);
    for (let i = 0; i < items.length; i += 1) {
      let col = 0;
      for (let c = 1; c < m.cols; c += 1) if (heights[c] < heights[col]) col = c;
      x[i] = col * (m.cardW + GAP); y[i] = heights[col]; h[i] = wfItemHeight(st, items[i]);
      heights[col] += h[i] + GAP;
    }
    block = { height: Math.max.apply(null, heights), loaded: true, x, y, h };
    st.wfLayouts.set(page, block);
    return block;
  }

  // 塊の上端を積み直す。anchor: 見えていた先頭の項目の位置を保つ（上の塊の高さが変わった時にずれない）。
  function wfRecompute(st, anchor) {
    const container = st.container;
    const m = st.m;
    const keepIndex = anchor && st.wfTops ? wfIndexAt(st, Math.max(0, container.scrollTop - m.padTop)) : -1;
    const keepOffset = keepIndex >= 0 ? (m.padTop + wfPosition(st, keepIndex).y) - container.scrollTop : 0;
    const pages = count(st) ? lastPage(st) + 1 : 0;
    const tops = new Float64Array(pages + 1);
    for (let page = 0; page < pages; page += 1) tops[page + 1] = tops[page] + wfBlock(st, page).height;
    st.wfTops = tops;
    if (st.wfSpacer) st.wfSpacer.style.height = Math.max(1, tops[pages]) + 'px';
    if (keepIndex >= 0) {
      const next = (m.padTop + wfPosition(st, keepIndex).y) - keepOffset;
      if (Math.abs(next - container.scrollTop) > 1) container.scrollTop = Math.max(0, next);
    }
  }

  function wfPageAt(st, y) {
    const tops = st.wfTops;
    if (!tops || tops.length < 2) return 0;
    let low = 0, high = tops.length - 2;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (tops[mid] <= y) low = mid; else high = mid - 1;
    }
    return low;
  }

  function wfIndexAt(st, y) {
    const page = wfPageAt(st, y);
    const block = wfBlock(st, page);
    const local = y - st.wfTops[page];
    if (!block.loaded) {
      const row = Math.max(0, Math.floor(local / (st.m.cardH + GAP)));
      return Math.min(count(st) - 1, page * PAGE + row * st.m.cols);
    }
    let best = 0, bestY = -1;
    for (let i = 0; i < block.y.length; i += 1) {
      if (block.y[i] <= local && block.y[i] > bestY) { best = i; bestY = block.y[i]; }
    }
    return page * PAGE + best;
  }

  function wfPosition(st, index) {
    const page = pageOf(st, index);
    const block = wfBlock(st, page);
    const top = st.wfTops ? st.wfTops[page] || 0 : 0;
    const local = index - page * PAGE;
    if (block.loaded && local < block.y.length) return { x: block.x[local], y: top + block.y[local], h: block.h[local] };
    const m = st.m;
    return { x: (local % m.cols) * (m.cardW + GAP), y: top + Math.floor(local / m.cols) * (m.cardH + GAP), h: m.cardH };
  }

  function onImageLoad(event) {
    const st = stateByContainer.get(event.currentTarget) || null;
    if (!live(st) || st.mode !== 'waterfall' || !active()) return;
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !img.naturalWidth || !img.naturalHeight) return;
    const card = img.closest('.fv-item');
    const item = card && card._folderItem;
    if (!item || !item.path || !img.closest('.fv-thumb') || img.closest('.fv-icon')) return;
    const ratio = img.naturalHeight / img.naturalWidth;
    const known = st.ratios.get(item.path);
    if (known && Math.abs(known - ratio) < 0.02) return;
    if (!known && Math.abs(ratio - 1) < 0.02) return;
    st.ratios.set(item.path, ratio);
    st.wfDirty = true;
    clearTimeout(st.ratioTimer);
    st.ratioTimer = setTimeout(() => {
      if (!live(st) || st.mode !== 'waterfall' || !st.wfDirty) return;
      st.wfDirty = false;
      st.wfLayouts.clear();
      wfRecompute(st, true);
      st.winA = -1;
      sync(st, { reposition: true });
    }, 120);
  }

  // ---- 描画 ----------------------------------------------------------------------------------------

  function render(opts) {
    const st = S;
    if (!st) return Promise.resolve(false);
    const options = opts || {};
    ensureStyle();
    const container = gridEl();
    if (!container) return Promise.resolve(false);
    st.container = container;
    stateByContainer.set(container, st);
    const previousScroll = container.scrollTop;
    const previousMode = st.mode;
    const anchorIndex = st.m && !options.resetScrollTop ? firstVisibleIndex(st) : -1;

    const query = readQuery();
    const queryKey = [query.sort, query.order, query.q, query.kinds].join('\n');
    const queryChanged = queryKey !== st.queryKey;
    if (queryChanged) {
      Object.assign(st, query);
      st.queryKey = queryKey;
      st.pages.clear(); st.inFlight = new Map(); st.wanted = []; st.linked = [];
      st.wfLayouts.clear(); st.signature = ''; st.loadedOnce = false; st.total = 0; st.folderCount = null;
      st.generation += 1;
      clearTimeout(st.pendingTimer);
      st.listing = false;
      if (st.sel.all) resolveAll(st);
      st.sel.anchor = -1; st.sel.focus = -1; st.sel.ranges = [];
    }

    if (Array.isArray(options.preserveSelectedPaths) && !st.sel.all && !st.sel.resolving) {
      const keep = new Map();
      // このフォルダの直下の項目だけを選択に残す（別のフォルダの項目のパスが渡されても、選択へ入れない。
      // 入れると、その後の削除・切り取りが見えていない別のフォルダの項目へ及ぶ）。
      const inThisFolder = typeof _folderIsDirectChildOfCurrent === 'function' ? _folderIsDirectChildOfCurrent : () => true;
      options.preserveSelectedPaths.forEach(path => {
        if (!path || !inThisFolder(path)) return;
        keep.set(path, st.sel.picked.get(path) || findLoaded(st, path) || stubFor(path, false));
      });
      st.sel.picked = keep;
      st.sel.version += 1;
    }

    global.GBOutlinerThumbnails?.detachWithin?.(container);
    container.innerHTML = '';
    st.cards = new Map(); st.slots = new Map();
    st.mode = layoutMode();
    const layoutClass = st.mode === 'list'
      ? (typeof FOLDER_LAYOUT_CLASSES !== 'undefined' && FOLDER_LAYOUT_CLASSES[_folderLayout]) || 'list-layout'
      : st.mode === 'waterfall' ? 'waterfall-layout' : 'grid-layout';
    const independent = typeof _folderIsIndependentSurface === 'function' && _folderIsIndependentSurface();
    container.className = (independent ? 'gb-subpanel-folder-root ' : '') + layoutClass + ' fv-large';
    container.style.position = 'relative';
    if (typeof _installFolderBlankContextMenu === 'function') _installFolderBlankContextMenu(container);
    if (!independent) {
      const select = document.getElementById('folder-layout-select');
      if (select && typeof _folderLayout !== 'undefined') select.value = _folderLayout;
    }
    st.inRender = true;
    try {
      if (typeof applyFolderZoom === 'function') applyFolderZoom();
      if (typeof applyFvPanelLayout === 'function') applyFvPanelLayout();
    } finally { st.inRender = false; }
    if (typeof _disconnectWaterfallResizeObserver === 'function') _disconnectWaterfallResizeObserver();
    container.style.height = '';
    const flags = displayFlags();
    if (typeof _folderConfigureListLayout === 'function') _folderConfigureListLayout(container, flags.isListLayout);
    st.header = null;
    if (flags.isListLayout && typeof _folderRenderListHeader === 'function') {
      _folderRenderListHeader(container);
      st.header = container.querySelector('.fv-list-header');
      markUnsupportedSortHeaders(st.header);
    }
    if (typeof _updateFolderDisplayFilterButton === 'function') _updateFolderDisplayFilterButton();
    st.top = null; st.bottom = null; st.wfSpacer = null;
    if (st.mode === 'waterfall') {
      st.wfSpacer = document.createElement('div');
      st.wfSpacer.className = 'wf-spacer';
      st.wfSpacer.style.cssText = 'position:relative;width:1px;pointer-events:none;';
      container.appendChild(st.wfSpacer);
    } else {
      st.top = document.createElement('div'); st.top.className = 'fv-large-spacer';
      st.bottom = document.createElement('div'); st.bottom.className = 'fv-large-spacer';
      container.appendChild(st.top); container.appendChild(st.bottom);
    }
    bind(container);
    publishItems(st);
    layout(st);
    if (options.resetScrollTop || queryChanged) container.scrollTop = 0;
    else if (previousMode !== st.mode && anchorIndex > 0) { sizeSpacers(st); scrollToIndex(st, anchorIndex, 'start'); }
    else { sizeSpacers(st); container.scrollTop = previousScroll; }
    updateCount(st);
    sync(st, { hydrate: true });
    // 取ってある一覧が古くないか、見えているページで確かめる（項目の追加・削除・改名の後）
    if (!queryChanged && st.loadedOnce) fetchPage(st, pageOf(st, Math.min(count(st) - 1, Math.max(0, firstVisibleIndex(st)))), { force: true });
    if (typeof _updateFolderBulkBar === 'function') _updateFolderBulkBar();
    return Promise.resolve(true);
  }

  function markUnsupportedSortHeaders(header) {
    if (!header) return;
    header.querySelectorAll('[data-folder-list-sort]').forEach(button => {
      if (SERVER_SORTS.has(button.dataset.folderListSort)) return;
      button.setAttribute('aria-disabled', 'true');
      button.dataset.gbTooltip = UNAVAILABLE_TIP;
      button.addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
    });
  }

  function bind(container) {
    if (boundContainers.has(container)) return;
    boundContainers.add(container);
    container.addEventListener('scroll', () => {
      const st = stateByContainer.get(container);
      if (live(st) && active()) queueSync(st);
    }, { passive: true });
    container.addEventListener('load', onImageLoad, true);
    if (typeof ResizeObserver === 'function') {
      let lastWidth = container.clientWidth, lastHeight = container.clientHeight;
      new ResizeObserver(() => {
        const st = stateByContainer.get(container);
        if (!live(st) || !active()) return;
        const width = container.clientWidth, height = container.clientHeight;
        if (width === lastWidth && height === lastHeight) return;
        const widthChanged = width !== lastWidth;
        lastWidth = width; lastHeight = height;
        if (width <= 0) return;
        if (widthChanged) relayout();
        else { st.m.viewH = height; queueSync(st); }
      }).observe(container);
    }
  }

  function queueSync(st) {
    if (st.syncQueued) return;
    st.syncQueued = true;
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      st.syncQueued = false;
      if (live(st) && active()) sync(st);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    setTimeout(run, 50);
  }

  function relayout() {
    const st = S;
    if (!st || st.inRender || !active() || !st.m) return;
    layout(st, { keepIndex: true });
    if (st.mode === 'waterfall') { st.cards.forEach(el => el.remove()); st.cards.clear(); }
    sync(st, { hydrate: true, reposition: true });
  }

  function sizeSpacers(st) {
    if (st.mode === 'waterfall') return;
    const m = st.m;
    const rows = Math.ceil(count(st) / m.cols);
    const a = Math.max(0, st.winA), b = Math.max(a, st.winB);
    const topRows = st.winA < 0 ? 0 : Math.floor(a / m.cols);
    const bottomRows = st.winA < 0 ? rows : Math.max(0, rows - Math.ceil(b / m.cols));
    setSpacer(st.top, topRows, m);
    setSpacer(st.bottom, bottomRows, m);
  }

  function setSpacer(el, rows, m) {
    if (!el) return;
    const height = rows > 0 ? rows * m.pitch - m.gap : 0;
    const display = height > 0 ? '' : 'none';
    if (el.style.display !== display) el.style.display = display;
    const value = Math.max(0, height) + 'px';
    if (el.style.height !== value) el.style.height = value;
  }

  function cardContext(st) {
    return Object.assign({ container: st.container, filteredItems: st.view, preserveSelectedPaths: new Set() }, st.m.flags);
  }

  function createCard(st, item, index) {
    const el = _folderCreateItemCard(item, index, cardContext(st));
    el.dataset.idx = String(index);
    if (item._folderLargeHidden || (typeof isOutlinerDeletePendingPath === 'function' && isOutlinerDeletePendingPath(item.path))
        || (typeof _folderPendingMovePaths !== 'undefined' && typeof _folderMembershipKey === 'function' && _folderPendingMovePaths.has(_folderMembershipKey(item.path)))) {
      el.inert = true;
      el.style.visibility = 'hidden';
    }
    if (!el.inert && isSelected(st, index, item)) {
      el.classList.add('selected');
      const check = el.querySelector('.fv-check');
      if (check) check.checked = true;
    }
    return el;
  }

  function sync(st, options) {
    const started = now();
    const opts = options || {};
    if (!st.m || !st.container.isConnected) return;
    if (st.mode === 'waterfall') syncWaterfall(st, opts, started);
    else syncRows(st, opts, started);
    stats.longestSync = Math.max(stats.longestSync, now() - started);
  }

  function syncRows(st, opts, started) {
    const m = st.m;
    const container = st.container;
    const total = count(st);
    const overscan = st.mode === 'list' ? 12 : 3;
    const y = Math.max(0, container.scrollTop - m.padTop);
    const firstRow = Math.max(0, Math.floor(y / m.pitch) - overscan);
    const lastRow = Math.ceil((y + (container.clientHeight || m.viewH)) / m.pitch) + overscan;
    const a = Math.min(total, firstRow * m.cols);
    const b = Math.min(total, lastRow * m.cols);
    st.centerPage = Math.floor(((a + b) / 2) / PAGE);
    const pages = [];
    if (total || !st.loadedOnce) {
      for (let page = Math.floor(a / PAGE); page <= Math.floor(Math.max(a, b - 1) / PAGE); page += 1) pages.push(page);
      if (!st.loadedOnce && !pages.length) pages.push(0);
    }
    wantPages(st, pages);

    if (!total && st.loadedOnce) { showEmpty(st); return; }
    container.querySelector(':scope > .fv-empty-state')?.remove();
    showLoading(st);

    // 範囲の外へ出たカードを外す
    st.cards.forEach((el, index) => {
      if (index >= a && index < b && el.parentNode === container) {
        // 一覧を取り直して別の項目になった位置は作り直す（まだ取り直していないページのカードは残す）
        const current = itemAt(st, index);
        if (!current || current === el._folderItem) return;
      }
      global.GBOutlinerThumbnails?.detachWithin?.(el);
      el.remove();
      st.cards.delete(index);
    });
    st.slots.forEach((el, index) => {
      if (index >= a && index < b && el.parentNode === container && !itemAt(st, index)) return;
      el.remove();
      st.slots.delete(index);
    });
    st.winA = a; st.winB = b;
    sizeSpacers(st);
    let cursor = st.top.nextSibling;
    let deferred = false;
    for (let index = a; index < b; index += 1) {
      let el = st.cards.get(index);
      if (!el) {
        const item = itemAt(st, index);
        if (item && (now() - started) < CARD_BUDGET_MS) {
          el = createCard(st, item, index);
          st.cards.set(index, el);
          const slot = st.slots.get(index);
          if (slot) { slot.remove(); st.slots.delete(index); }
        } else {
          if (item) deferred = true;
          el = st.slots.get(index);
          if (!el) {
            el = document.createElement('div');
            el.className = 'fv-large-slot';
            el.dataset.largeSlot = String(index);
            el.setAttribute('aria-hidden', 'true');
            st.slots.set(index, el);
          }
        }
      }
      if (el === cursor) cursor = cursor.nextSibling;
      else container.insertBefore(el, cursor && cursor.parentNode === container ? cursor : st.bottom);
    }
    if (deferred) queueSync(st);
  }

  function syncWaterfall(st, opts, started) {
    const m = st.m;
    const container = st.container;
    const total = count(st);
    if (!st.wfTops) wfRecompute(st, false);
    const over = 600;
    const viewTop = Math.max(0, container.scrollTop - m.padTop - over);
    const viewBottom = container.scrollTop - m.padTop + (container.clientHeight || m.viewH) + over;
    const firstPage = wfPageAt(st, viewTop);
    const lastVisible = wfPageAt(st, viewBottom);
    st.centerPage = Math.floor((firstPage + lastVisible) / 2);
    const pages = [];
    if (total || !st.loadedOnce) for (let page = firstPage; page <= lastVisible; page += 1) pages.push(page);
    wantPages(st, pages);
    if (!total && st.loadedOnce) { showEmpty(st); return; }
    container.querySelector(':scope > .fv-empty-state')?.remove();
    showLoading(st);
    const wanted = new Set();
    let deferred = false;
    for (let page = firstPage; page <= lastVisible && total; page += 1) {
      const block = wfBlock(st, page);
      if (!block.loaded) continue;
      const top = st.wfTops[page];
      const items = st.pages.get(page);
      for (let i = 0; i < items.length; i += 1) {
        const y = top + block.y[i];
        if (y + block.h[i] < viewTop || y > viewBottom || !items[i]) continue;
        const index = page * PAGE + i;
        wanted.add(index);
        let el = st.cards.get(index);
        if (el && el._folderItem !== items[i]) {
          global.GBOutlinerThumbnails?.detachWithin?.(el);
          el.remove();
          st.cards.delete(index);
          el = null;
        }
        if (!el) {
          if ((now() - started) >= CARD_BUDGET_MS) { deferred = true; continue; }
          el = createCard(st, items[i], index);
          st.cards.set(index, el);
          container.insertBefore(el, st.wfSpacer);
          opts.reposition = true;
        }
        if (opts.reposition || !el.dataset.largePlaced) {
          el.dataset.largePlaced = '1';
          el.style.left = block.x[i] + 'px';
          el.style.top = y + 'px';
          el.style.width = m.cardW + 'px';
          el.style.height = block.h[i] + 'px';
          const thumb = el.querySelector(':scope > .fv-thumb');
          if (thumb) thumb.style.height = Math.max(0, block.h[i] - 12 - m.textH) + 'px';
        }
      }
    }
    st.cards.forEach((el, index) => {
      if (wanted.has(index)) return;
      global.GBOutlinerThumbnails?.detachWithin?.(el);
      el.remove();
      st.cards.delete(index);
    });
    st.winA = 0; st.winB = 0;
    if (deferred) queueSync(st);
  }

  // 最初のページが届くまでの表示（読めた件数つき）
  function showLoading(st) {
    const container = st.container;
    let state = container.querySelector(':scope > .fv-loading-state');
    if (st.loadedOnce) { if (state) state.remove(); return; }
    if (!state) {
      state = document.createElement('div');
      state.className = 'fv-loading-state';
      state.style.cssText = 'padding:24px;color:var(--fg2);grid-column:1 / -1;';
      state.setAttribute('role', 'status');
      container.insertBefore(state, st.bottom || st.wfSpacer || null);
    }
    const text = '読み込み中（' + (st.listed || 0) + '件）';
    if (state.textContent !== text) state.textContent = text;
  }

  function showEmpty(st) {
    const container = st.container;
    container.querySelector(':scope > .fv-loading-state')?.remove();
    st.cards.forEach(el => el.remove()); st.cards.clear();
    st.slots.forEach(el => el.remove()); st.slots.clear();
    if (st.top) setSpacer(st.top, 0, st.m);
    if (st.bottom) setSpacer(st.bottom, 0, st.m);
    if (container.querySelector(':scope > .fv-empty-state')) return;
    const empty = document.createElement('div');
    empty.className = 'fv-empty-state';
    empty.style.flexDirection = 'column';
    empty.style.gap = '12px';
    const filtered = !!(st.q || st.kinds);
    const message = document.createElement('div');
    message.textContent = filtered ? (st.totalUnfiltered + '項目が絞り込みで非表示です') : 'このフォルダは空です';
    empty.appendChild(message);
    if (filtered) {
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'gb-btn gb-btn-sm';
      reset.dataset.e2eId = 'folder-empty-clear-filters';
      reset.textContent = '絞り込みを解除';
      reset.addEventListener('click', () => {
        if (typeof _clearFolderFilters === 'function') _clearFolderFilters();
        if (typeof renderFolderGrid === 'function') renderFolderGrid({ resetScrollTop: true });
      });
      empty.appendChild(reset);
    }
    container.insertBefore(empty, st.bottom || st.wfSpacer || null);
  }

  // ---- 選択 ----------------------------------------------------------------------------------------

  function stubFor(path, isFolder) {
    const name = String(path || '').replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || '';
    const type = isFolder ? 'folder' : IMAGE_EXT.test(name) ? 'image' : VIDEO_EXT.test(name) ? 'video'
      : AUDIO_EXT.test(name) ? 'audio' : /\.md$/i.test(name) ? 'page' : 'file';
    return { path, name, type, _folderLargeStub: true };
  }

  function findLoaded(st, path) {
    for (const items of st.pages.values()) {
      for (let i = 0; i < items.length; i += 1) if (items[i] && items[i].path === path) return items[i];
    }
    return null;
  }

  function isSelected(st, index, item) {
    const sel = st.sel;
    const path = item && item.path;
    if (sel.shape && inShape(sel.shape, index)) return true;
    if (sel.all) return !!path && !sel.excluded.has(path);
    if (path && sel.picked.has(path)) return true;
    for (let i = 0; i < sel.ranges.length; i += 1) if (index >= sel.ranges[i].lo && index <= sel.ranges[i].hi) return true;
    return false;
  }

  function selectionCount(st) {
    const state = st || S;
    if (!state) return 0;
    const sel = state.sel;
    if (sel.all) return Math.max(0, count(state) - sel.excluded.size);
    let total = sel.picked.size;
    sel.ranges.forEach(range => { total += range.pendingCount || 0; });
    if (sel.shape) total += sel.shape.count || 0;
    return total;
  }

  // ---- 位置で持つ選択（範囲ドラッグ・Shift+矢印） ----------------------------------------------------
  // 選んだ範囲を、まず位置（何番目から何番目・どの列）で持つ。見えているカードはその場で選択の表示になり、
  // 取ってある項目だけで足りればすぐに、足りなければパスを取り寄せてから、選択（パスの集まり）へ移す。

  function inShape(shape, index) {
    return index >= shape.lo && index <= shape.hi && (!shape.hit || shape.hit(index));
  }

  function loadedByPath(st) {
    const map = new Map();
    st.pages.forEach(items => { for (let i = 0; i < items.length; i += 1) if (items[i] && items[i].path) map.set(items[i].path, items[i]); });
    return map;
  }

  function dropShape(st, sel, shape) {
    if (sel.shape !== shape) return;
    sel.shape = null;
    if (shape.counted) { shape.counted = false; sel.resolving = Math.max(0, sel.resolving - 1); }
  }

  // 位置で持っている範囲を選択へ移す。defer: 取り寄せが要る時は少し待ってから（キーを押し続けている間は取り寄せない）。
  function commitShape(st, options) {
    const sel = st.sel, shape = sel.shape;
    if (!shape) return;
    clearTimeout(st.shapeTimer);
    const add = item => { if (sel.all) sel.excluded.delete(item.path); else sel.picked.set(item.path, item); };
    const hi = Math.min(shape.hi, count(st) - 1);
    let missing = false;
    for (let index = shape.lo; index <= hi; index += 1) {
      if (shape.hit && !shape.hit(index)) continue;
      if (!itemAt(st, index)) { missing = true; break; }
    }
    if (!missing) {
      for (let index = shape.lo; index <= hi; index += 1) {
        if (shape.hit && !shape.hit(index)) continue;
        const item = itemAt(st, index);
        if (item && item.path && !item._folderLargeHidden) add(item);
      }
      dropShape(st, sel, shape);
      sel.version += 1;
      return;
    }
    if (!shape.counted) { shape.counted = true; sel.resolving += 1; sel.version += 1; }
    if (options && options.defer) {
      st.shapeTimer = setTimeout(() => { if (live(st) && st.sel === sel && sel.shape === shape) commitShape(st); }, 180);
      return;
    }
    const token = sel.token;
    const current = () => live(st) && st.sel === sel && sel.token === token && sel.shape === shape;
    const loaded = loadedByPath(st);
    let offset = shape.lo;
    resolvePaths(st, shape.lo, Math.min(hi + 1, st.total), stubs => {
      if (!current()) return false;
      for (let i = 0; i < stubs.length; i += 1) {
        if (shape.hit && !shape.hit(offset + i)) continue;
        add(loaded.get(stubs[i].path) || stubs[i]);
      }
      offset += stubs.length;
      return true;
    }).then(ok => {
      if (!current()) return;
      for (let index = Math.max(shape.lo, st.total); index <= hi; index += 1) {
        const item = itemAt(st, index);
        if (item && item.path && (!shape.hit || shape.hit(index))) add(item);
      }
      dropShape(st, sel, shape);
      if (!ok && typeof showStatus === 'function') showStatus('選択した範囲を確認できませんでした', true);
      selectionChanged(st, _folderSelected);
    });
  }

  // Shift+矢印・Shift+Home/End など: 起点から移った先までを選ぶ
  function extendTo(st, index) {
    const previous = st.sel;
    const anchor = previous.anchor >= 0 ? Math.min(previous.anchor, count(st) - 1) : (previous.focus >= 0 ? previous.focus : index);
    clearTimeout(st.shapeTimer);
    const sel = newSelection();
    sel.token = previous.token + 1;
    sel.anchor = anchor; sel.focus = index;
    const lo = Math.min(anchor, index), hi = Math.max(anchor, index);
    sel.shape = { lo, hi, hit: null, count: hi - lo + 1 };
    st.sel = sel;
    st.focusWant = -1;
    if (st.mode === 'waterfall' && !st.wfTops) wfRecompute(st, false);
    scrollToIndex(st, index, 'nearest');
    sync(st, { hydrate: true });
    commitShape(st, { defer: true });
    selectionChanged(st, itemAt(st, index) || null);
  }

  // ---- 範囲ドラッグ ----------------------------------------------------------------------------------
  // ドラッグした範囲を位置で求めるので、スクロールして画面から外れた行・まだ取っていない行も選択に入る。
  // ドラッグ中に上下の端へ寄せると、その方向へスクロールする。

  let lasso = null;
  const LASSO_EDGE = 20;

  function lassoPoint(grid, clientX, clientY) {
    const box = grid.getBoundingClientRect();
    return { x: clientX - box.left + grid.scrollLeft, y: clientY - box.top + grid.scrollTop };
  }

  function lassoBegin(event, grid, onDone) {
    const st = S;
    if (!st || !st.m || st.container !== grid || event.pointerType === 'touch') return false;
    lassoStop(false);
    const additive = event.ctrlKey || event.metaKey;
    if (!additive) clearSelection();
    else if (st.sel.shape) commitShape(st);
    const start = lassoPoint(grid, event.clientX, event.clientY);
    const rect = document.createElement('div');
    rect.className = 'fv-large-lasso';
    rect.style.cssText = 'position:absolute;border:1px solid var(--accent);background:color-mix(in srgb,var(--ui-selection-bg,var(--selection)) 15%,transparent);pointer-events:none;z-index:10;left:' + start.x + 'px;top:' + start.y + 'px;width:0;height:0;';
    grid.appendChild(rect);
    const state = {
      st, grid, rect, onDone, pointerId: event.pointerId, startX: start.x, startY: start.y,
      clientX: event.clientX, clientY: event.clientY, moved: false, sel: st.sel,
      move: e => { state.clientX = e.clientX; state.clientY = e.clientY; lassoUpdate(); },
      end: () => lassoStop(true),
      scroll: () => lassoUpdate(),
      timer: setInterval(lassoAutoScroll, 16),
    };
    lasso = state;
    grid.addEventListener('pointermove', state.move);
    grid.addEventListener('pointerup', state.end);
    grid.addEventListener('pointercancel', state.end);
    grid.addEventListener('scroll', state.scroll, { passive: true });
    try { grid.setPointerCapture(event.pointerId); } catch {}
    return true;
  }

  function lassoAutoScroll() {
    const state = lasso;
    if (!state || !state.moved) return;
    const grid = state.grid;
    const box = grid.getBoundingClientRect();
    const top = box.top + (state.st.mode === 'list' ? state.st.m.headerH : 0);
    let step = 0;
    if (state.clientY > box.bottom - LASSO_EDGE) step = Math.min(160, 6 + (state.clientY - (box.bottom - LASSO_EDGE)) * 0.8);
    else if (state.clientY < top + LASSO_EDGE) step = -Math.min(160, 6 + ((top + LASSO_EDGE) - state.clientY) * 0.8);
    if (!step) return;
    const before = grid.scrollTop;
    grid.scrollTop = before + step;
    if (grid.scrollTop !== before) { sync(state.st); lassoUpdate(); }
  }

  // ドラッグの矩形（画面の座標）に掛かる位置の範囲を求める。位置の物差しは、置いてあるカードから実測する。
  function lassoShape(st, left, top, right, bottom) {
    const total = count(st);
    const m = st.m;
    if (!total || !m) return null;
    if (st.mode === 'waterfall') {
      let ref = null, refIndex = -1;
      st.cards.forEach((el, index) => { if (!ref && el.isConnected) { ref = el; refIndex = index; } });
      if (!ref || !st.wfTops) return null;
      const box = ref.getBoundingClientRect();
      const pos = wfPosition(st, refIndex);
      const scale = box.width > 0 ? box.width / m.cardW : 1;
      const x0 = (left - box.left) / scale + pos.x, x1 = (right - box.left) / scale + pos.x;
      const y0 = (top - box.top) / scale + pos.y, y1 = (bottom - box.top) / scale + pos.y;
      const lo = wfPageAt(st, Math.max(0, y0)) * PAGE;
      const hi = Math.min(total - 1, (wfPageAt(st, Math.max(0, y1)) + 1) * PAGE - 1);
      const hit = index => {
        const p = wfPosition(st, index);
        return !(p.x + m.cardW < x0 || p.x > x1 || p.y + p.h < y0 || p.y > y1);
      };
      let hits = 0;
      if (hi - lo <= 6000) { for (let index = lo; index <= hi; index += 1) if (hit(index)) hits += 1; }
      else hits = hi - lo + 1; // 広い範囲の件数は目安（確定の時に数え直す）
      return hits ? { lo, hi, hit, count: hits } : null;
    }
    const cols = m.cols;
    const a = Math.max(0, st.winA), b = Math.max(a, st.winB);
    const elementAt = index => { const el = st.cards.get(index) || st.slots.get(index); return el && el.isConnected ? el : null; };
    const first = elementAt(a);
    if (!first || b <= a) return null;
    const firstBox = first.getBoundingClientRect();
    const rowA = Math.floor(a / cols), rowL = Math.floor((b - 1) / cols);
    const lastOfColumn = elementAt(rowL * cols);
    const pitch = rowL > rowA && lastOfColumn ? (lastOfColumn.getBoundingClientRect().top - firstBox.top) / (rowL - rowA) : firstBox.height + m.gap;
    if (!(pitch > 0)) return null;
    const rows = Math.ceil(total / cols);
    const r0 = Math.max(0, rowA + Math.ceil((top - firstBox.top - firstBox.height) / pitch));
    const r1 = Math.min(rows - 1, rowA + Math.floor((bottom - firstBox.top) / pitch));
    if (r1 < r0) return null;
    let c0 = -1, c1 = -1;
    for (let c = 0; c < cols; c += 1) {
      const el = elementAt(rowA * cols + c);
      if (!el) break;
      const box = c === 0 ? firstBox : el.getBoundingClientRect();
      if (box.right < left || box.left > right) continue;
      if (c0 < 0) c0 = c;
      c1 = c;
    }
    if (c0 < 0) return null;
    const lo = r0 * cols + c0;
    const hi = Math.min(total - 1, r1 * cols + c1);
    if (hi < lo) return null;
    const width = c1 - c0 + 1;
    let hits = (r1 - r0 + 1) * width;
    if (r1 === rows - 1) hits -= width - Math.max(0, Math.min(width, (total - r1 * cols) - c0));
    if (hits <= 0) return null;
    const hit = width === cols ? null : index => { const c = index % cols; return c >= c0 && c <= c1; };
    return { lo, hi, hit, count: hits };
  }

  function lassoUpdate() {
    const state = lasso;
    if (!state) return;
    const st = state.st, grid = state.grid;
    if (!live(st) || st.container !== grid || !active() || st.sel !== state.sel) { lassoStop(false); return; }
    if (state.rect.parentNode !== grid) grid.appendChild(state.rect);
    const point = lassoPoint(grid, state.clientX, state.clientY);
    const x = Math.min(state.startX, point.x), y = Math.min(state.startY, point.y);
    const w = Math.abs(point.x - state.startX), h = Math.abs(point.y - state.startY);
    if (w > 2 || h > 2) state.moved = true;
    state.rect.style.left = x + 'px'; state.rect.style.top = y + 'px';
    state.rect.style.width = w + 'px'; state.rect.style.height = h + 'px';
    if (!state.moved) return;
    const box = grid.getBoundingClientRect();
    const left = x - grid.scrollLeft + box.left, top = y - grid.scrollTop + box.top;
    const sel = st.sel;
    if (sel.shape && sel.shape.counted) { sel.shape.counted = false; sel.resolving = Math.max(0, sel.resolving - 1); }
    sel.shape = lassoShape(st, left, top, left + w, top + h);
    sel.version += 1;
    paintSelection(st);
    const total = selectionCount(st);
    if (total > 1 && typeof showStatus === 'function') showStatus(total + ' 件選択中');
  }

  function lassoStop(commit) {
    const state = lasso;
    if (!state) return;
    lasso = null;
    clearInterval(state.timer);
    const grid = state.grid;
    grid.removeEventListener('pointermove', state.move);
    grid.removeEventListener('pointerup', state.end);
    grid.removeEventListener('pointercancel', state.end);
    grid.removeEventListener('scroll', state.scroll);
    try { grid.releasePointerCapture(state.pointerId); } catch {}
    state.rect.remove();
    const st = state.st;
    const stillLive = live(st) && st.sel === state.sel;
    if (stillLive) {
      const shape = st.sel.shape;
      const primary = shape ? itemAt(st, shape.lo) : null;
      if (shape && commit && state.moved) { st.sel.anchor = shape.lo; st.sel.focus = shape.hi; }
      if (commit && state.moved) commitShape(st);
      else if (shape) dropShape(st, st.sel, shape);
      selectionChanged(st, primary || null);
    }
    if (typeof state.onDone === 'function') state.onDone(!!(commit && state.moved));
  }

  function paintSelection(st) {
    st.cards.forEach((el, index) => {
      const selected = !el.inert && isSelected(st, index, el._folderItem);
      if (el.classList.contains('selected') !== selected) el.classList.toggle('selected', selected);
      const check = el.querySelector('.fv-check');
      if (check && check.checked !== selected) check.checked = selected;
    });
  }

  // 既存の処理（範囲ドラッグ・チェックボックスなど）がカードの選択表示を直接変えた分を取り込む
  function adoptFromCards(st) {
    const sel = st.sel;
    let changed = false;
    st.cards.forEach((el, index) => {
      const item = el._folderItem;
      if (!item || !item.path) return;
      const dom = el.classList.contains('selected') && !el.inert;
      if (dom === isSelected(st, index, item)) return;
      changed = true;
      if (sel.all) { if (dom) sel.excluded.delete(item.path); else sel.excluded.add(item.path); }
      else if (dom) sel.picked.set(item.path, item);
      else {
        sel.picked.delete(item.path);
        sel.ranges = sel.ranges.filter(range => index < range.lo || index > range.hi);
      }
    });
    if (changed) sel.version += 1;
  }

  // _normalizeFolderSelectionForVisibleItems の代わり。_folderSelectedItems を今の選択に合わせる。
  function normalizeSelection() {
    const st = S;
    if (!st) return 0;
    // 既存の処理が選択の配列を入れ替えていたら（削除の後に空にする・開く時に外す など）、それを今の選択として取り込む
    if (st.lastAssigned && _folderSelectedItems !== st.lastAssigned) {
      const external = Array.isArray(_folderSelectedItems) ? _folderSelectedItems : [];
      const next = newSelection();
      next.anchor = st.sel.anchor; next.focus = st.sel.focus;
      next.token = st.sel.token + 1;
      for (let i = 0; i < external.length; i += 1) {
        if (external[i] && external[i].path) next.picked.set(external[i].path, external[i]);
      }
      st.sel = next;
      st.focusWant = -1;
      paintSelection(st);
    }
    adoptFromCards(st);
    const sel = st.sel;
    let items;
    if (sel.resolving > 0) items = [];
    else if (sel.all) {
      if (sel.cacheVersion !== sel.version || !sel.cache) {
        const all = sel.allItems || [];
        sel.cache = sel.excluded.size ? all.filter(item => !sel.excluded.has(item.path)) : all.slice();
        sel.cacheVersion = sel.version;
      }
      items = sel.cache;
    } else {
      if (sel.picked.size <= 5000) {
        // 名前の変更で項目のパスが変わっていたら、引くキーを合わせる
        let stale = false;
        sel.picked.forEach((item, path) => { if (item.path !== path) stale = true; });
        if (stale) sel.picked = new Map(Array.from(sel.picked.values(), item => [item.path, item]));
      }
      items = Array.from(sel.picked.values());
    }
    _folderSelectedItems = items;
    st.lastAssigned = items;
    if (!items.length) _folderSelected = null;
    else if (!_folderSelected || !items.includes(_folderSelected)) _folderSelected = items[items.length - 1];
    return items.length;
  }

  function selectionChanged(st, primary) {
    st.sel.version += 1;
    paintSelection(st);
    if (primary) _folderSelected = primary;
    if (typeof _updateFolderBulkBar === 'function') _updateFolderBulkBar();
    const total = selectionCount(st);
    if (total > 1 && typeof showStatus === 'function') showStatus(total + ' 件選択中');
    if (primary && total <= 200 && typeof _getFvPanelCfg === 'function' && typeof showFolderPreview === 'function') {
      const cfg = _getFvPanelCfg();
      if ((cfg.previewVisible ?? true) || (cfg.detailVisible ?? true)) showFolderPreview(primary);
    }
  }

  function clearSelection(options) {
    const st = S;
    if (!st) return;
    const anchor = st.sel.anchor, focus = st.sel.focus;
    st.sel.token += 1;
    st.sel = newSelection();
    st.sel.anchor = anchor; st.sel.focus = focus;
    st.focusWant = -1;
    paintSelection(st);
    if (options && options.silent) return;
    _folderSelectedItems = [];
    st.lastAssigned = _folderSelectedItems;
    _folderSelected = null;
  }

  function indexOfCard(el) { return parseInt(el?.dataset?.idx, 10); }

  function cardClick(event, item, el) {
    const st = S;
    if (!st) return;
    const index = indexOfCard(el);
    const sel = st.sel;
    if (event.ctrlKey || event.metaKey) {
      if (sel.all) { if (sel.excluded.has(item.path)) sel.excluded.delete(item.path); else sel.excluded.add(item.path); }
      else if (sel.picked.has(item.path)) sel.picked.delete(item.path);
      else sel.picked.set(item.path, item);
      sel.anchor = index; sel.focus = index;
    } else if (event.shiftKey && sel.anchor >= 0) {
      selectRange(st, sel.anchor, index);
      sel.focus = index;
    } else {
      sel.token += 1;
      sel.all = false; sel.excluded = new Set(); sel.allItems = null; sel.ranges = []; sel.shape = null; sel.resolving = 0;
      sel.picked = new Map([[item.path, item]]);
      sel.anchor = index; sel.focus = index;
    }
    st.focusWant = -1;
    selectionChanged(st, item);
  }

  function cardCheck(item, el, checked) {
    const st = S;
    if (!st) return;
    const sel = st.sel;
    if (sel.all) { if (checked) sel.excluded.delete(item.path); else sel.excluded.add(item.path); }
    else if (checked) sel.picked.set(item.path, item);
    else sel.picked.delete(item.path);
    sel.anchor = indexOfCard(el); sel.focus = sel.anchor;
    selectionChanged(st, checked ? item : null);
  }

  function selectOnly(item, el) {
    const st = S;
    if (!st) return;
    const index = el ? indexOfCard(el) : -1;
    st.sel.token += 1;
    const sel = newSelection();
    sel.picked.set(item.path, item);
    sel.anchor = index; sel.focus = index;
    st.sel = sel;
    selectionChanged(st, item);
  }

  // 位置の範囲を選択へ加える。取ってある項目はその場で、まだ取っていない範囲はパスだけ取り寄せる。
  function selectRange(st, from, to) {
    const sel = st.sel;
    const lo = Math.max(0, Math.min(from, to)), hi = Math.min(count(st) - 1, Math.max(from, to));
    let missing = false;
    for (let index = lo; index <= hi; index += 1) {
      const item = itemAt(st, index);
      if (!item) { missing = true; break; }
    }
    if (!missing) {
      for (let index = lo; index <= hi; index += 1) {
        const item = itemAt(st, index);
        if (sel.all) sel.excluded.delete(item.path); else sel.picked.set(item.path, item);
      }
      return;
    }
    if (sel.all) return;
    const range = { lo, hi, pendingCount: hi - lo + 1 };
    sel.ranges.push(range);
    sel.resolving += 1;
    const token = sel.token;
    const loaded = loadedByPath(st);
    resolvePaths(st, lo, Math.min(hi + 1, st.total), stubs => {
      if (!live(st) || st.sel !== sel || sel.token !== token) return false;
      stubs.forEach(stub => { if (!sel.picked.has(stub.path)) sel.picked.set(stub.path, loaded.get(stub.path) || stub); });
      return true;
    }).then(ok => {
      if (!live(st) || st.sel !== sel || sel.token !== token) return;
      for (let index = Math.max(lo, st.total); index <= hi; index += 1) {
        const item = itemAt(st, index);
        if (item) sel.picked.set(item.path, item);
      }
      sel.ranges = sel.ranges.filter(entry => entry !== range);
      sel.resolving = Math.max(0, sel.resolving - 1);
      if (!ok && typeof showStatus === 'function') showStatus('選択した範囲を確認できませんでした', true);
      selectionChanged(st, _folderSelected);
    });
  }

  // start〜end の位置のパスを 2万件ずつ取り寄せる（1回の処理を長くしない）
  async function resolvePaths(st, start, end, onChunk) {
    const key = st.queryKey;
    try {
      if (start < end && !(await listingReady(st))) return false;
      for (let from = start; from < end; from += PATHS_CHUNK) {
        const to = Math.min(end, from + PATHS_CHUNK);
        const started = now();
        const result = await apiPost('/browse-paths', { path: st.path, sort: st.sort, order: st.order, q: st.q, kinds: st.kinds, start: from, end: to }, { silentError: true });
        noteRequest(started);
        if (!live(st) || st.queryKey !== key) return false;
        const paths = Array.isArray(result?.paths) ? result.paths : [];
        const folders = Number(result?.kinds?.folder) || 0;
        const stubs = new Array(paths.length);
        for (let i = 0; i < paths.length; i += 1) stubs[i] = stubFor(paths[i], i < folders);
        if (onChunk(stubs) === false) return false;
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      return true;
    } catch (error) {
      console.warn('[フォルダ] 選択した項目の確認に失敗しました', error);
      return false;
    }
  }

  function resolveAll(st) {
    const sel = st.sel;
    sel.token += 1;
    const token = sel.token;
    sel.allItems = null;
    sel.resolving = 1;
    sel.version += 1;
    const collected = [];
    resolvePaths(st, 0, Number.MAX_SAFE_INTEGER, stubs => {
      if (!live(st) || st.sel !== sel || sel.token !== token) return false;
      for (let i = 0; i < stubs.length; i += 1) collected.push(stubs[i]);
      return stubs.length >= PATHS_CHUNK;
    }).then(() => {
      if (!live(st) || st.sel !== sel || sel.token !== token) return;
      st.linked.forEach(item => { if (item && item.path) collected.push(item); });
      sel.allItems = collected;
      sel.resolving = 0;
      selectionChanged(st, _folderSelected);
    });
  }

  function selectAll() {
    const st = S;
    if (!st) return false;
    st.sel = newSelection();
    st.sel.all = true;
    st.focusWant = -1;
    paintSelection(st);
    resolveAll(st);
    if (typeof _updateFolderBulkBar === 'function') _updateFolderBulkBar();
    if (typeof showStatus === 'function') showStatus(selectionCount(st) + ' 件選択');
    return true;
  }

  function isSelectedItem(item) {
    const st = S;
    if (!st || !item || !item.path) return false;
    if (st.sel.all) return !st.sel.excluded.has(item.path);
    return st.sel.picked.has(item.path);
  }

  // ドラッグで運ぶ項目。選択の確認が終わっていなければ null（呼び出し側はドラッグを始めない）。
  function dragItems(item) {
    const st = S;
    if (!st) return [item];
    if (st.sel.resolving > 0) return null;
    normalizeSelection();
    const items = _folderSelectedItems;
    return items.some(selected => selected && selected.path === item.path) ? items.slice() : [item];
  }

  // ---- キーボード ----------------------------------------------------------------------------------

  function handleKey(event) {
    const st = S;
    if (!st || !st.m) return false;
    const key = event.key;
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageUp', 'PageDown'].includes(key)) return false;
    event.preventDefault();
    const total = count(st);
    if (!total) return true;
    const cols = st.m.cols;
    const rowsPerPage = Math.max(1, Math.floor(((st.container.clientHeight || st.m.viewH) - (st.mode === 'list' ? st.m.headerH : 0)) / st.m.pitch) - 1);
    const current = st.sel.focus;
    let next = current;
    if (current < 0) next = key === 'End' ? total - 1 : 0;
    else if (key === 'ArrowRight') next = current + 1;
    else if (key === 'ArrowLeft') next = current - 1;
    else if (key === 'ArrowDown') next = current + cols;
    else if (key === 'ArrowUp') next = current - cols;
    else if (key === 'Home') next = 0;
    else if (key === 'End') next = total - 1;
    else if (key === 'PageDown') next = current + rowsPerPage * cols;
    else if (key === 'PageUp') next = current - rowsPerPage * cols;
    if ((key === 'ArrowDown' || key === 'PageDown') && next >= total) next = current >= 0 && current + cols >= total ? current : total - 1;
    if ((key === 'ArrowUp' || key === 'PageUp') && next < 0) next = current >= 0 && current - cols < 0 ? current : 0;
    next = Math.max(0, Math.min(total - 1, next));
    if (event.shiftKey) extendTo(st, next);
    else focusIndex(st, next);
    return true;
  }

  function focusIndex(st, index) {
    st.sel.token += 1;
    const sel = newSelection();
    sel.anchor = index; sel.focus = index;
    st.sel = sel;
    st.focusWant = index;
    if (st.mode === 'waterfall' && !st.wfTops) wfRecompute(st, false);
    scrollToIndex(st, index, 'nearest');
    sync(st, { hydrate: true });
    if (!finishFocus(st)) {
      sel.ranges = [{ lo: index, hi: index, pendingCount: 1 }];
      sel.resolving = 1;
      paintSelection(st);
      if (typeof _updateFolderBulkBar === 'function') _updateFolderBulkBar();
      fetchPage(st, pageOf(st, index));
    }
  }

  // キーで移った先の項目が取れたら、選択を確定する
  function finishFocus(st) {
    const index = st.focusWant;
    if (index < 0) return false;
    const item = itemAt(st, index);
    if (!item) return false;
    st.focusWant = -1;
    const sel = st.sel;
    sel.ranges = [];
    sel.resolving = 0;
    sel.picked = new Map([[item.path, item]]);
    selectionChanged(st, item);
    if (typeof showStatus === 'function') showStatus(item.name || '');
    return true;
  }

  // ---- 絞り込み・並べ替えのメニュー ------------------------------------------------------------------

  function markUnavailable(node) {
    if (!node) return;
    node.classList.add('gb-folder-large-off');
    node.dataset.gbTooltip = UNAVAILABLE_TIP;
    node.setAttribute('aria-disabled', 'true');
    node.querySelectorAll('input, select, button').forEach(control => { control.disabled = true; });
    node.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); }, true);
  }

  function adjustFilterMenu(menu, cfg) {
    if (!menu || !active()) return;
    const typeBox = menu.querySelector('[data-folder-filter-section="type"]');
    if (typeBox && typeof _fdCheckboxRow === 'function') {
      const selected = new Set((Array.isArray(cfg?.filterTypes) ? cfg.filterTypes : []).map(type => KIND_OF_TYPE[type] ? type : 'other'));
      typeBox.innerHTML = '';
      KIND_CHOICES.forEach(([type, label]) => {
        typeBox.appendChild(_fdCheckboxRow(label, selected.has(type), enabled => {
          _fdSetArrayFilter(typeof getFolderDisplayConfig === 'function' ? getFolderDisplayConfig() : cfg, 'filterTypes', type, enabled);
        }, { dataset: { folderFilterType: type } }));
      });
    }
    ['ext', 'folder', 'tag', 'tag-chips', 'modified'].forEach(name => {
      menu.querySelectorAll('[data-folder-filter-section="' + name + '"]').forEach(markUnavailable);
    });
    menu.querySelectorAll('[data-e2e-id="folder-filter-tag-mode"], [data-e2e-id="folder-filter-tag-picker-trigger"], [data-e2e-id="folder-panel-search-scope-trigger"], [data-e2e-id="folder-panel-search-tag-trigger"]').forEach(control => {
      control.disabled = true;
      control.dataset.gbTooltip = UNAVAILABLE_TIP;
    });
  }

  function sortSupported(option) {
    return !!option && SERVER_SORTS.has(option.sort);
  }

  function adjustSortMenu(menu, options) {
    if (!menu || !active()) return;
    const buttons = menu.querySelectorAll('[role="menuitemradio"]');
    (options || []).forEach((option, index) => {
      const button = buttons[index];
      if (!button || sortSupported(option)) return;
      button.disabled = true;
      button.dataset.gbTooltip = UNAVAILABLE_TIP;
    });
  }

  // ---- 公開 ----------------------------------------------------------------------------------------

  function refresh() {
    const st = S;
    if (!st || !active()) return;
    clearTimeout(st.refreshTimer);
    st.refreshTimer = setTimeout(() => {
      if (!live(st) || !active()) return;
      publishItems(st);
      // 既存の処理が外したカードは置き直す
      st.cards.forEach((el, index) => { if (el.parentNode !== st.container) st.cards.delete(index); });
      st.winA = -1;
      sync(st, { hydrate: true, reposition: true });
      if (st.loadedOnce && count(st)) fetchPage(st, pageOf(st, Math.min(count(st) - 1, firstVisibleIndex(st))), { force: true });
    }, 0);
  }

  function debugState() {
    const st = S;
    if (!st) return null;
    return {
      path: st.path, mode: st.mode, total: st.total, count: count(st), totalUnfiltered: st.totalUnfiltered,
      sort: st.sort, order: st.order, q: st.q, kinds: st.kinds, signature: st.signature,
      pages: Array.from(st.pages.keys()).sort((a, b) => a - b), inFlight: st.inFlight.size, listing: st.listing,
      cards: st.cards.size, slots: st.slots.size, window: [st.winA, st.winB], busy: !!st.syncQueued,
      cols: st.m ? st.m.cols : 0, pitch: st.m ? st.m.pitch : 0,
      selection: { all: st.sel.all, excluded: st.sel.excluded.size, picked: st.sel.picked.size, resolving: st.sel.resolving,
        count: selectionCount(st), anchor: st.sel.anchor, focus: st.sel.focus },
      stats: { requests: stats.requests, slowest: stats.slowest, longestSync: stats.longestSync, samples: stats.samples.slice() },
    };
  }

  global.MeldexFolderLarge = {
    PAGE,
    open, active, deactivate, render, relayout, refresh, swapState, disposeState,
    normalizeSelection, clearSelection, selectAll, selectionCount: () => selectionCount(S),
    selectionPending: () => !!(S && S.sel.resolving > 0),
    // 多数を選んでいる時に、選択が前回から変わったかだけを答える（変わっていなければ重い後処理を省ける）
    selectionVersionChanged(key) {
      if (!S) return true;
      S.seenVersions = S.seenVersions || new Map();
      const token = S.sel.token + ':' + S.sel.version + ':' + S.sel.resolving;
      if (S.seenVersions.get(key) === token && S.seenSelection === S.sel) return false;
      S.seenVersions.set(key, token);
      S.seenSelection = S.sel;
      return true;
    },
    cardClick, cardCheck, selectOnly, isSelectedItem, dragItems, handleKey, lassoBegin,
    adjustFilterMenu, adjustSortMenu,
    scrollToIndex(index) { if (S && S.m) { scrollToIndex(S, Math.max(0, Math.min(count(S) - 1, index)), 'start'); sync(S, { hydrate: true }); } },
    threshold: () => threshold,
    setThreshold(value) { threshold = Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : DEFAULT_THRESHOLD; },
    state: debugState,
    resetStats() { stats.requests = 0; stats.slowest = 0; stats.longestSync = 0; stats.samples = []; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
