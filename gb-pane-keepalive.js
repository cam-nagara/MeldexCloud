// gb-pane-keepalive.js — パネルレイアウトのペインDOM keep-aliveレジストリ
// (ブレークポイント往復での非破壊リサイズ)。ビューワー残課題修正計画 2026-08-04
// 「1. 非破壊リサイズとPDF」対応。
//
// 背景: GBLayout.render()（gb-layout.part03.part01.js）は呼び出されるたびに
// `_layoutEl.innerHTML = ''` で全ペインDOMを破棄し、作り直す。既存の
// `_renderPreservingActivePane()` はアクティブペインの contentEl だけを
// 「render()実行前に取り外し、_postRenderが呼ばれる直前に新しい空のcontentElへ
// 差し戻す」ことで、アクティブペインに限り再生成を回避している
// （この関数自体は既存の決定的テストに固定されているため変更しない）。
//
// 本モジュールは、この「取り外し→差し戻し」パターンを全ペイン（非アクティブ含む）へ
// 一般化する。GBLayout.render() 側から detachAll/reattachAll/pruneStale の3フックを
// 呼んでもらう構成（render()側の変更は最小限の追記のみ）。
//   - detachAll:  render()が_layoutEl.innerHTML=''で破棄する直前に呼ぶ。paneMapに
//     載っている「今まさにDOM上にある」全ペインのcontentElを、プレースホルダ
//     （コメントノード）へ差し替える形でその場から取り外す（別ホストへは移動しない。
//     実体を移動する操作自体がiframeの再読み込みを招くため）。
//     _renderPreservingActivePane()が既にアクティブペインを取り外し済みの場合、
//     そのcontentElは既にparentNodeを持たないため自然にスキップされる（二重処理なし）。
//   - reattachAll: render()が新しいペイン構造を組み終え、_postRenderを呼ぶ直前に呼ぶ。
//     追跡中の各ペインについて、新しい生成先（空のcontentEl）が見つかれば実体を
//     差し戻す。見つからない場合（今回のブレークポイント/表示状態でそのペインが
//     描画対象外になった場合。モバイル時の非アクティブペイン等）だけ、退避ホストへ
//     実体を移す（inert + aria-hidden）。これが本モジュールで唯一「実体を移動する」経路。
//   - pruneStale: reattachAllの後に呼ぶ。タブ/ペインが実際に閉じられ、レイアウト
//     ツリー上にpaneIdが存在しなくなった場合だけ、退避ホストに残った実体を破棄する。
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

  // render()の破棄より前に呼ぶ。paneMapに載っている全ペインのcontentElを、
  // 現在の親から「プレースホルダへ差し替える」形で無破壊に取り外す。
  function detachAll(paneMap) {
    for (const paneId in (paneMap || {})) {
      const info = paneMap[paneId];
      const contentEl = info && info.contentEl;
      if (!contentEl || !contentEl.parentNode) continue; // 既に他経路(active pane preserve)で取り外し済み等
      const placeholder = document.createComment('gb-pane-keepalive:' + paneId);
      contentEl.parentNode.replaceChild(placeholder, contentEl);
      _registry.set(paneId, { contentEl, parked: false });
    }
  }

  // 新しいペイン構造(paneMap)を組み終えた後、_postRenderを呼ぶ直前に呼ぶ。
  function reattachAll(paneMap) {
    _registry.forEach((entry, paneId) => {
      const freshInfo = paneMap && paneMap[paneId];
      const freshContentEl = freshInfo && freshInfo.contentEl;
      if (freshInfo && freshContentEl && freshContentEl !== entry.contentEl && freshContentEl.parentNode) {
        freshContentEl.replaceWith(entry.contentEl);
        freshInfo.contentEl = entry.contentEl;
        _clearInert(entry.contentEl);
        _registry.delete(paneId);
        return;
      }
      // 差し戻し先が今回の描画に存在しない: 退避ホストへ実体を移す(まだなら)。
      if (!entry.parked) {
        const host = _ensureHost();
        _markInert(entry.contentEl);
        host.appendChild(entry.contentEl);
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
                storage.appendChild(child);
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
    detachAll,
    reattachAll,
    pruneStale,
    getParkedPaneIds,
    isTracked,
  };
})();
