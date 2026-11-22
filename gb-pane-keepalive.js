// gb-pane-keepalive.js — 全ペインを接続したまま退避し、内部文書を保持する。
// iframeは取り外した時点で文書が破棄される。同じ要素の差し戻しだけでは保持にならない。
(function () {
  'use strict';

  const _registry = new Map(); // paneId -> { contentEl, parked }
  let _host = null;

  function _ensureHost() {
    if (_host && _host.isConnected) return _host;
    _host = document.getElementById('gb-pane-keepalive-host');
    if (!_host) {
      _host = document.createElement('div');
      _host.id = 'gb-pane-keepalive-host';
      // 画面外へ固定配置し視覚的には常に非表示にする（inert/aria-hiddenは個別要素側で付与）。
      _host.style.cssText = 'position:fixed;left:-99999px;top:0;width:0;height:0;overflow:hidden;pointer-events:none;';
      (document.body || document.documentElement).appendChild(_host);
    }
    return _host;
  }

  function _markInert(el) {
    if (!el) return;
    try { el.inert = true; } catch {}
    el.setAttribute('aria-hidden', 'true');
  }
  function _clearInert(el) {
    if (!el) return;
    try { el.inert = false; } catch {}
    el.removeAttribute('aria-hidden');
  }

  // 接続中の同一文書間だけatomic moveを使う。未接続の初回マウントは通常挿入。
  function move(parent, child, before = null) {
    if (parent === child.parentNode && child.nextSibling === before) return child;
    if (parent.moveBefore && parent.isConnected && child.isConnected
        && parent.ownerDocument === child.ownerDocument) parent.moveBefore(child, before);
    else parent.insertBefore(child, before);
    return child;
  }

  // render()の破棄より前に、接続された退避ホストへ移す。
  function detachAll(paneMap) {
    for (const paneId in (paneMap || {})) {
      const info = paneMap[paneId];
      // サブパネルは #gb-layout-root の外（右レール／モバイルドロワー）にある仮想ペイン。
      // layout root の innerHTML 再生成では消えないため、通常ペイン用keep-aliveへ取り込むと
      // レイアウトツリーに存在しない「stale」と判定され、表示中DOMを誤って破棄してしまう。
      if (info?.surface === 'subpanel') continue;
      const contentEl = info && info.contentEl;
      if (!contentEl || !contentEl.parentNode) continue; // 既に他経路(active pane preserve)で取り外し済み等
      move(_ensureHost(), contentEl);
      _markInert(contentEl);
      _registry.set(paneId, { contentEl, parked: true });
    }
  }

  // 新しいペイン構造(paneMap)を組み終えた後、_postRenderを呼ぶ直前に呼ぶ。
  function reattachAll(paneMap) {
    _registry.forEach((entry, paneId) => {
      const freshInfo = paneMap && paneMap[paneId];
      const freshContentEl = freshInfo && freshInfo.contentEl;
      if (freshInfo && freshContentEl && freshContentEl !== entry.contentEl && freshContentEl.parentNode) {
        move(freshContentEl.parentNode, entry.contentEl, freshContentEl);
        freshContentEl.remove();
        freshInfo.contentEl = entry.contentEl;
        _clearInert(entry.contentEl);
        _registry.delete(paneId);
        return;
      }
      // 差し戻し先が今回の描画に存在しない: 退避ホストへ実体を移す(まだなら)。
      if (!entry.parked) {
        const host = _ensureHost();
        _markInert(entry.contentEl);
        move(host, entry.contentEl);
        entry.parked = true;
      }
    });
  }

  // reattachAllの後に呼ぶ。existsFn(paneId) はレイアウトツリー上にそのpaneIdが
  // まだ存在するかを返す呼び出し側の関数。存在しない(タブ/ペインが実際に閉じられた)
  // 場合だけ、退避ホストに残った実体を破棄する。
  function pruneStale(existsFn) {
    if (typeof existsFn !== 'function') return;
    const storage = document.getElementById('legacy-views');
    _registry.forEach((entry, paneId) => {
      if (existsFn(paneId)) return;
      try {
        if (entry.contentEl) {
          if (storage) {
            Array.from(entry.contentEl.children).forEach((child) => {
              if (child.id && (child.id.startsWith('rp-') || child.id === 'sidebar' || child.id === 'gb-preview-pane' || child.id === 'gb-subpanel-root' || child.id.endsWith('-view') || child.id.endsWith('-view-container') || child.id.startsWith('ann-') || child.id.startsWith('btn-tb-'))) {
                child.style.display = 'none';
                move(storage, child);
              }
            });
          }
          entry.contentEl.remove();
        }
      } catch {}
      _registry.delete(paneId);
    });
  }

  function getParkedPaneIds() {
    const ids = [];
    _registry.forEach((entry, paneId) => { if (entry.parked) ids.push(paneId); });
    return ids;
  }

  function isTracked(paneId) { return _registry.has(paneId); }

  window.GBPaneKeepAlive = {
    move,
    detachAll,
    reattachAll,
    pruneStale,
    getParkedPaneIds,
    isTracked,
  };
})();
