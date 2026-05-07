/* gb-board-bulk-import.js — シート / スマートシートのエントリを一括でリンクカードとしてボードに読み込む。
 *
 * ボード左上メニュー「シート/スマートシートから一括読込...」から起動。
 *   Step 1: 対象 (現在 Meldex で開いているシート / スマートシートのタブ) を選ぶ
 *   Step 2: ビューを選ぶ (ビューのフィルタを適用)
 *   Step 3: 該当エントリを取得 → 先頭の画像プロパティを並行フェッチ → グリッド配置で一括作成
 *
 * 重複: 既に同じエントリを指すリンクカードがあっても再追加する (仕様: 再追加)。
 * リンクカードの挙動: 既存 bdCreateLinkCardNode と同じ (linkType は path から推定)。
 */
(function () {
  'use strict';

  // 対象候補として扱うタブ型。ここに含まれる型のタブがあれば「開いているシート/スマートシート」として列挙する。
  const SUPPORTED_TAB_TYPES = new Set([
    'smart-db', 'database', 'pivot', 'gallery', 'kanban', 'timeline', 'chart', 'graph',
  ]);

  async function bdOpenBulkLinkImport() {
    if (typeof bd === 'undefined') {
      if (typeof showStatus === 'function') showStatus('ボードが開かれていません', true);
      return;
    }
    const candidates = _collectCandidates();
    if (!candidates.length) {
      if (typeof showStatus === 'function') showStatus('開いているシート / スマートシートのタブがありません', true);
      return;
    }
    _openWizard(candidates);
  }

  // 開いているタブから対象候補を収集する。同じ path の重複は除外する。
  function _collectCandidates() {
    if (typeof GBLayout === 'undefined' || typeof GBLayout.getAllPanes !== 'function') return [];
    const result = [];
    const seen = new Set();
    try {
      GBLayout.getAllPanes(GBLayout.root).forEach(pane => {
        (pane.tabs || []).forEach(tab => {
          const path = tab?.path || '';
          const type = tab?.type || '';
          if (!path || seen.has(path)) return;
          if (SUPPORTED_TAB_TYPES.has(type)) {
            result.push({ path, label: tab.label || path, type });
            seen.add(path);
          }
        });
      });
    } catch (_) { /* noop */ }
    return result;
  }

  function _openWizard(candidates) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '250';
    overlay.innerHTML = `
      <div class="gb-confirm" role="dialog" aria-modal="true" style="min-width:min(520px,92vw);max-width:min(640px,94vw);">
        <div class="gb-confirm-title">シート / スマートシートから一括読込</div>
        <div class="gb-confirm-body" style="display:flex;flex-direction:column;gap:12px;padding:12px 0;">
          <label style="display:flex;flex-direction:column;gap:4px;">
            <span style="font-size:12px;">対象のシート / スマートシート</span>
            <select data-bdbl-source style="padding:4px 6px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;"></select>
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;">
            <span style="font-size:12px;">ビュー</span>
            <select data-bdbl-view style="padding:4px 6px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;"></select>
            <span style="font-size:11px;color:var(--ui-fg-muted,#888);">選択したビューのフィルタを適用します。</span>
          </label>
          <div data-bdbl-status style="font-size:12px;color:var(--ui-fg-muted,#888);min-height:18px;"></div>
        </div>
        <div class="gb-confirm-actions">
          <button class="gb-btn gb-btn-sm" data-bdbl-cancel>キャンセル</button>
          <button class="gb-btn gb-btn-sm gb-btn-primary" data-bdbl-go>読み込む</button>
        </div>
      </div>`;

    const srcSelect = overlay.querySelector('[data-bdbl-source]');
    const viewSelect = overlay.querySelector('[data-bdbl-view]');
    const statusEl = overlay.querySelector('[data-bdbl-status]');
    const goBtn = overlay.querySelector('[data-bdbl-go]');
    const cancelBtn = overlay.querySelector('[data-bdbl-cancel]');

    candidates.forEach((c, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `${c.label}  —  ${c.path}`;
      srcSelect.appendChild(opt);
    });

    let currentEntries = null;
    let busy = false;
    // ユーザーが高速にドロップダウンを切り替えると複数の refreshPreview が in-flight になる。
    // 古い fetch の結果が新しい結果を上書きして表示件数と実エントリがずれる事態を防ぐため、
    // 発火ごとに seq を増やし、結果適用前に自分の seq が最新か照合する。
    let previewSeq = 0;

    const setStatus = (text, isError) => {
      statusEl.textContent = text || '';
      statusEl.style.color = isError ? 'var(--accent,#e66)' : 'var(--ui-fg-muted,#888)';
    };

    const refreshViews = async () => {
      const target = candidates[Number(srcSelect.value || 0)];
      viewSelect.innerHTML = '';
      setStatus('ビューを取得中…');
      const views = await _getViewsFor(target);
      views.forEach((v, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = v.label;
        viewSelect.appendChild(opt);
      });
      viewSelect._views = views;
      viewSelect._target = target;
      await refreshPreview();
    };

    const refreshPreview = async () => {
      const mySeq = ++previewSeq;
      const target = viewSelect._target;
      const views = viewSelect._views || [];
      const v = views[Number(viewSelect.value || 0)];
      if (!target || !v) {
        if (mySeq !== previewSeq) return;
        setStatus('');
        currentEntries = null;
        return;
      }
      setStatus('該当エントリを取得中…');
      try {
        const entries = await _fetchEntries(target, v);
        if (mySeq !== previewSeq) return; // より新しい refreshPreview が発火済みなら捨てる
        currentEntries = entries;
        if (!entries || !entries.length) setStatus('該当エントリがありません', true);
        else setStatus(`該当エントリ: ${entries.length} 件`);
      } catch (e) {
        if (mySeq !== previewSeq) return;
        currentEntries = null;
        setStatus('取得失敗: ' + (e?.message || e), true);
      }
    };

    srcSelect.addEventListener('change', refreshViews);
    viewSelect.addEventListener('change', refreshPreview);

    // Escape ハンドラを含むクリーンアップ。× ボタン / キャンセル / overlay クリック / ESC の
    // いずれで閉じても必ず handler を剥がす (多重オープンでのリーク防止)。
    const onKey = (e) => { if (e.key === 'Escape' && overlay.isConnected) close(); };
    const close = () => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
    };
    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);

    goBtn.addEventListener('click', async () => {
      if (busy) return;
      if (!Array.isArray(currentEntries) || !currentEntries.length) {
        setStatus('読み込めるエントリがありません', true);
        return;
      }
      busy = true;
      goBtn.disabled = true;
      cancelBtn.disabled = true;
      setStatus(`${currentEntries.length} 件のリンクカードを作成中…`);
      try {
        const created = await _executeImport(currentEntries);
        close();
        if (typeof showStatus === 'function') showStatus(`${created} 件のリンクカードを読み込みました`);
      } catch (e) {
        setStatus('読み込みに失敗: ' + (e?.message || e), true);
        goBtn.disabled = false;
        cancelBtn.disabled = false;
        busy = false;
      }
    });

    document.body.appendChild(overlay);
    srcSelect.focus();
    refreshViews();
  }

  async function _getViewsFor(target) {
    if (!target) return [];
    if (target.type === 'smart-db') {
      // スマートシートはトップレベルの filters が「全体ビュー」として機能する。
      // ユーザー定義ビューの概念はスマートシートには現状ない。
      return [{ label: 'スマートシート全体 (フィルタ適用)', kind: 'smart-all' }];
    }
    // 通常のシート: 「現在のフィルタ」「保存済みビュー」「すべて」を列挙。
    const views = [{ label: '現在のフィルタ', kind: 'db-current' }];
    if (typeof getSavedViews === 'function') {
      try {
        const saved = getSavedViews(target.path) || [];
        saved.forEach((v, idx) => {
          views.push({ label: `ビュー: ${v?.name || '(無題)'}`, kind: 'db-saved', idx });
        });
      } catch (_) { /* noop */ }
    }
    views.push({ label: 'すべて (フィルタ無し)', kind: 'db-all' });
    return views;
  }

  async function _fetchEntries(target, view) {
    if (target.type === 'smart-db') {
      return await _fetchSmartDbEntries(target.path);
    }
    return await _fetchDbEntries(target.path, view);
  }

  async function _fetchSmartDbEntries(path) {
    const fileData = await apiFetch('/file?path=' + encodeURIComponent(path));
    let def = {};
    try { def = JSON.parse(fileData?.content || '{}') || {}; } catch { def = {}; }
    const filters = Array.isArray(def.filters) ? def.filters : [];
    const payload = await apiFetch('/smart-db?filters=' + encodeURIComponent(JSON.stringify(filters)));
    const entities = Array.isArray(payload?.entities) ? payload.entities : [];
    return entities
      .filter(e => e && e.path)
      .map(e => ({ path: e.path, name: e.name || '', source: 'smart-db' }));
  }

  async function _fetchDbEntries(dbPath, view) {
    // 通常シートのエントリは /pivot エンドポイントで取得する。
    // state.filter (採用/不採用/すべて) が current フィルタとして status_filter に反映される。
    // view.kind === 'db-all' はフィルタ無しを要求するので status_filter を渡さない。
    let url = '/pivot?path=' + encodeURIComponent(dbPath);
    if (view?.kind === 'db-current' && typeof getFilterParam === 'function') {
      try {
        const fp = getFilterParam();
        if (fp) url += '&status_filter=' + encodeURIComponent(fp);
      } catch (_) { /* noop */ }
    }
    const data = await apiFetch(url);
    const entitiesObj = (data && data.entities && typeof data.entities === 'object') ? data.entities : {};
    // /pivot のエントリは name キーのみ。path は _entityPath(dbPath, name) で導出する。
    const resolvePath = (name) => {
      if (typeof _entityPath === 'function') return _entityPath(dbPath, name);
      // _entityPath が未ロードならフォールバック (新フォーマット想定: dbPath/name.md)
      return dbPath + '/' + name + '.md';
    };
    const all = Object.keys(entitiesObj).map(name => ({
      path: resolvePath(name),
      name,
      source: 'db',
    })).filter(e => !!e.path);
    // 保存済みビューの filter 文字列が指定されていれば、エントリ名または path の部分一致で簡易絞り込む。
    // (高度な advancedFilters の完全適用は将来対応。本 MVP では単純文字列フィルタのみ)。
    if (view?.kind === 'db-saved' && Number.isInteger(view.idx) && typeof getSavedViews === 'function') {
      let filterStr = '';
      try {
        const saved = getSavedViews(dbPath) || [];
        filterStr = String(saved[view.idx]?.filter || '').trim();
      } catch (_) { /* noop */ }
      if (filterStr) {
        const needle = filterStr.toLowerCase();
        return all.filter(e => (e.name + ' ' + e.path).toLowerCase().includes(needle));
      }
    }
    return all;
  }

  async function _executeImport(entries) {
    const canvas = document.getElementById('bd-canvas');
    const rect = canvas?.getBoundingClientRect();
    const paneW = (rect && rect.width) || 800;
    const paneH = (rect && rect.height) || 600;
    const zoom = bd.zoom || 1;
    const viewW = paneW / zoom;
    const viewH = paneH / zoom;

    // リンクカードの既定サイズ: 画像付きで w=240 (gb-board-ui.part01.js の bdCreateLinkCardNode 参照)。
    const cardW = 240;
    const cardH = 140;
    const gap = 24;

    const N = entries.length;
    // 列数はパネル縦横比に合わせて決める。N 枚を (cols × rows) に並べた全体形状が、
    // パネルの (viewW × viewH) と似た比率になるよう cols を選ぶ。
    //   cols / rows ≒ (viewW / cardW+gap) / (viewH / cardH+gap) とする近似。
    const cellW = cardW + gap;
    const cellH = cardH + gap;
    const paneAspect = Math.max(0.1, viewW / Math.max(1, viewH));
    const cellAspect = Math.max(0.1, cellW / cellH);
    let cols = Math.max(1, Math.round(Math.sqrt(N * paneAspect / cellAspect)));
    if (cols > N) cols = N;
    const rows = Math.max(1, Math.ceil(N / cols));

    // グリッド全体をパネル中心に寄せる。
    const gridW = cols * cardW + (cols - 1) * gap;
    const gridH = rows * cardH + (rows - 1) * gap;
    const center = (typeof bdGetCanvasCenterWorld === 'function')
      ? bdGetCanvasCenterWorld()
      : { x: 120, y: 120 };
    const startX = center.x - gridW / 2;
    const startY = center.y - gridH / 2;

    // 画像プロパティは並行取得 (最大 6 本)。
    const imgMap = await _fetchImagesParallel(entries.map(e => e.path), 6);

    if (typeof bdPushUndo === 'function') bdPushUndo();

    const createdIds = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * (cardW + gap);
      const y = startY + row * (cardH + gap);
      const img = imgMap.get(e.path) || '';
      const linkType = (typeof _bdInferLinkType === 'function') ? _bdInferLinkType(e.path, '') : '';
      const node = (typeof bdCreateLinkCardNode === 'function')
        ? bdCreateLinkCardNode(e.path, x, y, e.name || '', { img, linkType, w: cardW })
        : null;
      if (node) {
        bd.nodes.push(node);
        createdIds.push(node.id);
      }
    }

    // 大量追加後の一括再描画。bdRequestFullRender があれば優先使用。
    if (typeof bdRequestFullRender === 'function') bdRequestFullRender('bulk-link-import');
    else if (typeof bdRender === 'function') bdRender();
    if (typeof bdMarkExtrasDirty === 'function') {
      bdMarkExtrasDirty({ minimap: true, boardUi: true, frames: true }, 'bulk-link-import');
    }
    if (typeof bdDirty === 'function') bdDirty();

    // 作成した全カードを選択状態にする (続けてまとめて移動やスタイル変更できるように)。
    // 既存ラインの選択は解除、activeNode は最後に作ったカードに寄せる (単一選択時の
    // 挙動に合わせるため; bdSelect が activeNode = id を行うのと同趣旨)。
    if (bd.selected instanceof Set && createdIds.length) {
      if (typeof bdClearConnectionSelection === 'function') bdClearConnectionSelection();
      bd.selected.clear();
      createdIds.forEach(id => bd.selected.add(id));
      bd._activeNode = createdIds[createdIds.length - 1];
      if (typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
      if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty(createdIds, 'bulk-link-import');
    }

    return createdIds.length;
  }

  // path 配列から最初の画像プロパティ URL を並行取得する。
  // Promise.all + 並行制限 (concurrency 本) で過大な fetch を避ける。
  async function _fetchImagesParallel(paths, concurrency) {
    const result = new Map();
    if (!Array.isArray(paths) || !paths.length) return result;
    let cursor = 0;
    const worker = async () => {
      while (cursor < paths.length) {
        const idx = cursor++;
        const path = paths[idx];
        if (!path) continue;
        try {
          const img = await _extractFirstImage(path);
          if (img) result.set(path, img);
        } catch (_) { /* 画像取得失敗は無視して次へ */ }
      }
    };
    const workerCount = Math.max(1, Math.min(concurrency || 1, paths.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return result;
  }

  // エントリの /entity レスポンスから最初の画像プロパティ値を抽出する。
  // Meldex のエントリプロパティは { properties: { propName: [{value, status, ...}, ...] } } の
  // 構造で、同じプロパティに複数の候補値 (採用/不採用) が並ぶ。ここでは "採用" / "掲載済み" の
  // 値だけを見て、値文字列が画像拡張子で終わる最初のものを選ぶ。
  // 画像判定は拡張子 (.png/.jpg/.jpeg/.gif/.webp/.svg/.bmp/.avif) ベース。
  async function _extractFirstImage(path) {
    if (!path) return '';
    const imgExt = /\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?.*)?$/i;
    const adopted = (status) => status === '採用' || status === '掲載済み';
    let data;
    try {
      data = await apiFetch('/entity?path=' + encodeURIComponent(path));
    } catch (_) { return ''; }
    const props = (data && typeof data === 'object' && data.properties && typeof data.properties === 'object')
      ? data.properties : null;
    if (props) {
      for (const key of Object.keys(props)) {
        const arr = props[key];
        if (!Array.isArray(arr)) continue;
        for (const entry of arr) {
          if (!entry || typeof entry !== 'object') continue;
          if (!adopted(entry.status)) continue;
          const v = entry.value;
          if (typeof v === 'string' && imgExt.test(v)) return _resolveImageUrl(v);
        }
      }
    }
    // フロントマター / props 系の単純 map 形式もフォールバックとして見る
    // (note 系など properties を持たない形式がある場合への備え)。
    const fallbackSources = [];
    if (data && typeof data === 'object') {
      if (data.frontmatter && typeof data.frontmatter === 'object') fallbackSources.push(data.frontmatter);
      if (data.props && typeof data.props === 'object') fallbackSources.push(data.props);
    }
    for (const src of fallbackSources) {
      for (const key of Object.keys(src)) {
        const val = src[key];
        if (typeof val === 'string' && imgExt.test(val)) return _resolveImageUrl(val);
        if (Array.isArray(val)) {
          for (const v of val) {
            if (typeof v === 'string' && imgExt.test(v)) return _resolveImageUrl(v);
          }
        }
      }
    }
    return '';
  }

  // 画像 URL を解決する。http/https/data はそのまま、相対パスは /file-raw 経由に変換する。
  function _resolveImageUrl(val) {
    const s = String(val || '').trim();
    if (!s) return '';
    if (/^(https?|data):/i.test(s)) return s;
    if (typeof API_BASE !== 'undefined' && API_BASE) {
      return API_BASE + '/file-raw?path=' + encodeURIComponent(s);
    }
    return s;
  }

  window.bdOpenBulkLinkImport = bdOpenBulkLinkImport;
})();
