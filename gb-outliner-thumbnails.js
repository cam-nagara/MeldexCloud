/**
 * gb-outliner-thumbnails.js
 *
 * フォルダツリーの軽量サムネイル表示・OS登録形式アイコンを扱うモジュール。
 * 計画: app/docs/folder-tree-thumbnail-large-branch-interaction-plan-2026-07-31.md
 *       §2.1（行の高さとサムネイル）、§2.2（OS登録アイコン）、§4.1-4/5（サムネイル表示・スタイル）、
 *       §5 Phase4、§7（性能合格基準）
 * 承認サンプル: app/docs/folder-tree-thumbnail-sample-2026-07-31/index.html
 *
 * 責務:
 * - 表示設定（既定ON・端末ローカルlocalStorage）の読み書き
 * - 行がサムネイル対象/形式アイコン候補かどうかの判定（純関数。folder/database/entity/
 *   Meldex固有形式・対象外拡張子を除外）
 * - 取得キュー（同時数制限・多重統合・キャンセル・負キャッシュ）— DOM非依存の純関数として
 *   切り出し、Node単体テストの対象にする（gb-outliner-virtual.js と同じ設計方針）
 * - 形式アイコンの拡張子単位メモリキャッシュ（1拡張子=1回だけ要求）
 * - 行DOMへのサムネイル枠/形式アイコン<img>の差し込み、IntersectionObserverによる
 *   表示範囲＋少量オーバースキャンでの遅延取得
 * - 仮想化コンテナ（gb-outliner-virtual-render.js）との行高連携（22px→50pxへの昇格時に
 *   累積オフセットを再計算し、変更行が表示範囲より上ならscrollTopを補正してジャンプを防ぐ）
 *
 * 依存（実行時のみ参照。読み込み順は gb-outliner.js / gb-outliner-virtual-render.js より後）:
 *   GBOutlinerVirtual（22px/50px定数の単一情報源）, GBOutlinerVirtualRender.updateRowHeight,
 *   _outlinerResolvedType（型解決。無ければ item.type をそのまま使う）, lucide（形式アイコン
 *   取得失敗時、既存Lucideアイコンへ戻すのは呼び出し元がすでに描画済みのため何もしなくてよい）
 *
 * 設計上の判断（行高の決定方式）:
 * 「取得成功のみ50px、それ以外(未解決/対象外/失敗)は22px」という確定仕様(§2.1表)を文字通り
 * 実装する。行は常に22px(現行と同じ見た目)で生成し、サムネイルが実際に読み込めた時だけ
 * 50pxへ昇格する片方向の遷移にする（成功→50pxのみ。失敗時に50→22へ縮める処理を持たない）。
 * これにより「取得不可時に壊れた画像枠や50pxの空行を残す」状態が構造的に発生しない。
 */
(function () {
  'use strict';

  // ------------------------------------------------------------
  // 表示設定（既定ON・端末ローカル。editor-config同期ではなくlocalStorage）
  // 未保存と"1"はON、明示的な"0"だけをOFFとして扱う。OFFも値を保存することで、
  // 次回起動後に利用者が選んだ状態を維持する。
  // ------------------------------------------------------------
  var SETTING_KEY = 'gb:tree-thumbnails-enabled';

  function isEnabled() {
    try { return localStorage.getItem(SETTING_KEY) !== '0'; } catch (e) { return true; }
  }
  function setEnabled(next) {
    try {
      localStorage.setItem(SETTING_KEY, next ? '1' : '0');
    } catch (e) {}
  }

  // ------------------------------------------------------------
  // サムネイルのサイズ設定（小/中/大。既定は中）。端末ローカルlocalStorage。
  // ------------------------------------------------------------
  var SIZE_SETTING_KEY = 'gb:tree-thumbnail-size';

  function sizeMode() {
    try {
      var v = localStorage.getItem(SIZE_SETTING_KEY);
      return (v === 'small' || v === 'large') ? v : 'medium';
    } catch (e) { return 'medium'; }
  }
  function setSizeMode(next) {
    try {
      if (next === 'small' || next === 'large') localStorage.setItem(SIZE_SETTING_KEY, next);
      else localStorage.removeItem(SIZE_SETTING_KEY);
    } catch (e) {}
  }

  // ------------------------------------------------------------
  // サムネイル対象・形式アイコン候補の判定（純関数。DOM非依存）
  // ------------------------------------------------------------

  // meldex_tree_thumbnail_service.py の NO_THUMBNAIL_EXTENSIONS を意図的に複製する
  // （バックエンドの安全な共通ファイルを改変せずフロント単独で「対象外」を即座に
  // 判定するため。サーバー側は最終的な安全弁として別途この判定を行う）。
  var NO_THUMBNAIL_EXTENSIONS = Object.freeze([
    'md', 'markdown', 'txt', 'json', 'yml', 'yaml', 'csv', 'tsv',
    'js', 'ts', 'py', 'css', 'html', 'htm', 'xml', 'log', 'ini', 'cfg',
    'ps1', 'bat', 'sh',
  ]);
  var _noThumbExtSet = new Set(NO_THUMBNAIL_EXTENSIONS);

  // フォルダ・シート・エントリ・Meldex固有形式は内容サムネイル/形式アイコンどちらの
  // 対象にもしない（§2.1「内容サムネイルを出さない項目は22px行のままとする」）。
  var NON_THUMBNAIL_TYPES = Object.freeze(['folder', 'database', 'entity', 'scriptnote', 'board', 'calendar']);
  var _nonThumbTypeSet = new Set(NON_THUMBNAIL_TYPES);

  function _extname(path) {
    // item.path はURLではなく実ファイルパス。Windowsでは「#」をファイル名に使えるため、
    // URLフラグメント扱いで切り落とすと「name_#tag.png」の拡張子を見失ってしまう。
    var clean = String(path || '');
    var m = /\.([A-Za-z0-9]+)$/.exec(clean);
    return m ? m[1].toLowerCase() : '';
  }

  // _outlinerResolvedType が読み込まれていれば使う（scriptnote/board の実判定に必要）。
  // Node単体テスト環境など未定義の場合は item.type をそのまま使う。
  function _resolvedItemType(item) {
    if (!item) return '';
    if (typeof _outlinerResolvedType === 'function') {
      try { return _outlinerResolvedType(item.type, item.path) || ''; } catch (e) { /* フォールバックへ */ }
    }
    return item.type || '';
  }

  function _isBaseIneligible(item) {
    if (!item || item._isRoot) return true;
    var type = _resolvedItemType(item);
    if (_nonThumbTypeSet.has(type)) return true;
    return false;
  }

  // 内容サムネイル（64×44px→50px行）の対象かどうか。
  function isThumbnailEligible(item) {
    if (_isBaseIneligible(item)) return false;
    var ext = _extname(item.path);
    if (!ext) return false;
    if (_noThumbExtSet.has(ext)) return false;
    return true;
  }

  // 形式アイコン（18×18px、OS登録アイコンで置き換え候補）の対象かどうか。
  // 内容サムネイルと同じ対象集合を再利用する（§2.2は「対応外はOS形式アイコンへ」の
  // フォールバック関係にあり、二重に対象集合を保守するとズレの原因になるため）。
  function isFormatIconCandidate(item) {
    return isThumbnailEligible(item);
  }

  // ------------------------------------------------------------
  // 取得キュー（同時数制限・多重統合・キャンセル）。DOM/ネットワークに依存しない
  // 純粋なスケジューラとして実装し、Node単体テストの対象にする。
  // ------------------------------------------------------------
  var CANCELED = { canceled: true };

  function createRequestQueue(maxConcurrency) {
    var limit = Math.max(1, Number(maxConcurrency) || 1);
    var active = 0;
    var waiting = []; // 起動待ちのentry配列（FIFO）
    var byKey = new Map(); // key -> entry（待機中・実行中のどちらも含む）

    function _pump() {
      while (active < limit && waiting.length) {
        var entry = waiting.shift();
        if (byKey.get(entry.key) !== entry) continue; // 既にキャンセル済み
        active++;
        (function (entry) {
          Promise.resolve()
            .then(function () { return entry.run(); })
            .then(
              function (result) { entry.resolve(result); },
              function (err) { entry.reject(err); }
            )
            .then(function () {
              active--;
              if (byKey.get(entry.key) === entry) byKey.delete(entry.key);
              _pump();
            });
        })(entry);
      }
    }

    // 同一keyの多重取得は同じPromiseへ相乗りさせる（統合）。
    function request(key, run) {
      var existing = byKey.get(key);
      if (existing) return existing.promise;
      var entry = { key: key, run: run };
      entry.promise = new Promise(function (resolve, reject) {
        entry.resolve = resolve;
        entry.reject = reject;
      });
      byKey.set(key, entry);
      waiting.push(entry);
      _pump();
      return entry.promise;
    }

    // 未開始（waiting配列に残っている）のものだけをキャンセルする。実行開始済みの
    // タスクはそのまま完了まで進める（§2.1「未開始要求をキャンセルする」＝実行中は
    // 対象外。進行中のPromiseへ後から相乗りできるよう byKey には残したままにする）。
    function cancel(key) {
      var entry = byKey.get(key);
      if (!entry) return false;
      var idx = waiting.indexOf(entry);
      if (idx < 0) return false; // 既に実行中
      waiting.splice(idx, 1);
      byKey.delete(key);
      entry.reject(CANCELED);
      return true;
    }

    function cancelAllPending() {
      var pending = waiting.slice();
      waiting.length = 0;
      pending.forEach(function (entry) {
        byKey.delete(entry.key);
        entry.reject(CANCELED);
      });
    }

    function isPending(key) { return waiting.some(function (e) { return e.key === key; }); }
    function isActive(key) {
      var entry = byKey.get(key);
      return !!entry && waiting.indexOf(entry) < 0;
    }
    function pendingCount() { return waiting.length; }
    function activeCount() { return active; }

    return {
      request: request,
      cancel: cancel,
      cancelAllPending: cancelAllPending,
      isPending: isPending,
      isActive: isActive,
      pendingCount: pendingCount,
      activeCount: activeCount,
    };
  }

  // ------------------------------------------------------------
  // 短時間の負キャッシュ（失敗直後の再試行ループを防ぐ）。時刻を引数で渡せるようにして
  // 実時計に依存せずNode単体テストできるようにする。
  // ------------------------------------------------------------
  function createNegativeCache(ttlMs) {
    var ttl = Math.max(0, Number(ttlMs) || 0);
    var expires = new Map();
    function markFailed(key, now) {
      expires.set(key, (now == null ? Date.now() : now) + ttl);
    }
    function isFailed(key, now) {
      var exp = expires.get(key);
      if (exp == null) return false;
      var t = now == null ? Date.now() : now;
      if (exp <= t) { expires.delete(key); return false; }
      return true;
    }
    function clear(key) { expires.delete(key); }
    function clearAll() { expires.clear(); }
    return { markFailed: markFailed, isFailed: isFailed, clear: clear, clearAll: clearAll };
  }

  // ------------------------------------------------------------
  // 形式アイコンの拡張子単位メモリキャッシュ。同じ拡張子は fetchIcon を1回だけ呼ぶ
  // （成功/失敗どちらも結果を共有Promiseとして再利用する）。
  // ------------------------------------------------------------
  function createFormatIconCache(options) {
    var opts = options || {};
    var fetchIcon = typeof opts.fetchIcon === 'function' ? opts.fetchIcon : function () { return Promise.resolve(null); };
    var cache = new Map(); // ext -> { promise, status, url }

    function get(ext) {
      var key = String(ext || '').toLowerCase();
      if (!key) return Promise.resolve(null);
      var hit = cache.get(key);
      if (hit) return hit.promise;
      var entry = { status: 'pending', url: null };
      entry.promise = Promise.resolve()
        .then(function () { return fetchIcon(key); })
        .then(
          function (url) {
            entry.status = url ? 'ok' : 'none';
            entry.url = url || null;
            return entry.url;
          },
          function () {
            entry.status = 'none';
            entry.url = null;
            return null;
          }
        );
      cache.set(key, entry);
      return entry.promise;
    }
    function has(ext) { return cache.has(String(ext || '').toLowerCase()); }
    function requestCount() { return cache.size; }
    function reset() { cache.clear(); }

    return { get: get, has: has, requestCount: requestCount, reset: reset };
  }

  // ------------------------------------------------------------
  // 行高の決定（GBOutlinerVirtual の22px/50px定数を単一の情報源として再利用する）
  // ------------------------------------------------------------
  function compactRowHeight() {
    return (window.GBOutlinerVirtual && window.GBOutlinerVirtual.ROW_HEIGHT_COMPACT) || 22;
  }
  // サムネイル表示行の高さ（サイズ設定 小/中/大 に連動。既定=中=50px）。
  function thumbnailRowHeight() {
    if (window.GBOutlinerVirtual && typeof window.GBOutlinerVirtual.rowHeightThumbnailForSize === 'function') {
      return window.GBOutlinerVirtual.rowHeightThumbnailForSize(sizeMode());
    }
    return (window.GBOutlinerVirtual && window.GBOutlinerVirtual.ROW_HEIGHT_THUMBNAIL) || 50;
  }

  // ------------------------------------------------------------
  // 端末種別（同時取得数の初期値: Desktop最大4、モバイル最大2）
  // ------------------------------------------------------------
  function _isMobileTier() {
    try {
      if (window.MeldexCloudMobileState && window.MeldexCloudMobileState.mobile === true) return true;
      if (window.matchMedia && window.matchMedia('(max-width: 1024px), (pointer: coarse)').matches) return true;
    } catch (e) { /* ignore */ }
    return false;
  }
  function maxThumbnailConcurrency() { return _isMobileTier() ? 2 : 4; }

  // ローカルPython API（Windows Shell依存）が使えるかどうか。Cloud静的版（data-cloud-mode=
  // "dropbox"）はバックエンドが存在しないため、リクエスト自体を発行しない
  // （§2.2「Cloud静的版とモバイルではWindows Shellを利用できないため、Meldex同梱の
  // 形式アイコンまたは汎用アイコンを使用する」）。既存の判定慣習
  // （document.body.dataset.cloudMode==='dropbox'）に合わせる。
  function _hasNativeApiBackend() {
    try { return document.body && document.body.dataset && document.body.dataset.cloudMode !== 'dropbox'; }
    catch (e) { return true; }
  }

  // 端末倍率上限2倍で最大192px相当まで要求する（論理幅はサイズ設定 小48/中64/大96px）。
  // backendのTREE_THUMB_MAX_SIZE（meldex_tree_thumbnail_service.py）はこの192pxより
  // 余裕を持たせた256pxが上限。ここで計算した値がその上限を超えることはないが、
  // 万一超えてもbackend側のnormalize_tree_thumbnail_size()がクランプする。
  function _thumbnailRequestSize() {
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    var scale = Math.max(1, Math.min(2, dpr));
    var baseWidth = (window.GBOutlinerVirtual && typeof window.GBOutlinerVirtual.thumbnailWidthForSize === 'function')
      ? window.GBOutlinerVirtual.thumbnailWidthForSize(sizeMode())
      : 64;
    return Math.round(baseWidth * scale);
  }

  function _thumbKey(path, size) { return String(path || '') + '|' + String(size || ''); }

  // ------------------------------------------------------------
  // ネットワーク層（<img>プローブ方式。成功したURLをそのまま可視imgのsrcへ再利用する
  // ことで、プローブ時のHTTPキャッシュヒットにより二重ダウンロードを避ける）
  // ------------------------------------------------------------
  function _probeImageUrl(url, signal) {
    return new Promise(function (resolve, reject) {
      if (signal && signal.aborted) { reject(CANCELED); return; }
      var img = new Image();
      var settled = false;
      var onAbort = function () {
        if (settled) return;
        settled = true;
        img.src = '';
        reject(CANCELED);
      };
      img.onload = function () {
        if (settled) return;
        settled = true;
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve(url);
      };
      img.onerror = function () {
        if (settled) return;
        settled = true;
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve(null);
      };
      if (signal) signal.addEventListener('abort', onAbort);
      img.src = url;
    });
  }

  function _treeThumbnailUrl(path, size) {
    return '/api/tree-thumbnail?path=' + encodeURIComponent(path) + '&size=' + encodeURIComponent(size);
  }
  function _formatIconUrl(ext, size) {
    return '/api/format-icon?ext=' + encodeURIComponent(ext) + '&size=' + encodeURIComponent(size);
  }

  // ------------------------------------------------------------
  // モジュール単位の状態（DOM層）
  // ------------------------------------------------------------
  var _thumbQueue = createRequestQueue(maxThumbnailConcurrency());
  var _negativeCache = createNegativeCache(30000); // backendの負キャッシュTTL(30秒)に合わせる
  var _formatIconCache = createFormatIconCache({
    fetchIcon: function (ext) {
      if (!_hasNativeApiBackend()) return Promise.resolve(null);
      return _probeImageUrl(_formatIconUrl(ext, 32));
    },
  });
  var _tracked = new Map(); // row(.tree-node-row) -> record
  var _io = null;

  function _observer() {
    if (_io) return _io;
    if (typeof IntersectionObserver !== 'function') return null;
    _io = new IntersectionObserver(_onIntersect, {
      root: document.getElementById('tree-scroll-container') || null,
      rootMargin: '200px 0px',
      threshold: 0.01,
    });
    return _io;
  }

  function _onIntersect(entries) {
    entries.forEach(function (entry) {
      var row = entry.target;
      var rec = _tracked.get(row);
      if (!rec) return;
      if (entry.isIntersecting) {
        _startForRow(row, rec);
      } else if (rec.wantThumb) {
        // 折りたたみ・スクロールアウトで「未開始」の取得だけをキャンセルする。
        // 既に開始済み（実行中）のものはそのまま進行させ、結果はキャッシュへ反映される。
        _thumbQueue.cancel(_thumbKey(rec.item && rec.item.path, rec.size));
      }
    });
  }

  function _startForRow(row, rec) {
    if (rec.started) return;
    rec.started = true;
    if (rec.wantIcon) _resolveFormatIcon(row, rec);
    if (rec.wantThumb) _resolveThumbnail(row, rec);
  }

  function _resolveFormatIcon(row, rec) {
    var ext = _extname(rec.item && rec.item.path);
    if (!ext) return;
    _formatIconCache.get(ext).then(function (url) {
      if (!url) return;
      if (!row.isConnected) return; // 行が既に破棄されている
      if (!_tracked.has(row) || _tracked.get(row) !== rec) return; // 別行に再利用済み
      _applyFormatIconImage(rec.iconEl, url, !!(rec.item && rec.item.linked));
    });
  }

  function _applyFormatIconImage(iconEl, url, linked) {
    if (!iconEl) return;
    iconEl.innerHTML = '';
    var img = document.createElement('img');
    img.className = 'tree-format-icon-img';
    img.alt = '';
    img.src = url;
    iconEl.appendChild(img);
    if (linked && typeof lucide === 'function') {
      var badge = document.createElement('span');
      badge.style.cssText = 'position:relative;top:-4px;left:-2px;';
      badge.innerHTML = lucide('externalLink', 8);
      iconEl.appendChild(badge);
    }
  }

  function attachFormatIcon(iconEl, item) {
    if (!iconEl || !isFormatIconCandidate(item)) return false;
    var ext = _extname(item && item.path);
    if (!ext) return false;
    var pathToken = String(item.path || '');
    iconEl.dataset.formatIconPath = pathToken;
    _formatIconCache.get(ext).then(function (url) {
      if (!url || !iconEl.isConnected || iconEl.dataset.formatIconPath !== pathToken) return;
      iconEl.innerHTML = '';
      var img = document.createElement('img');
      img.className = 'tree-format-icon-img fv-format-icon-img';
      img.alt = '';
      img.src = url;
      iconEl.appendChild(img);
    });
    return true;
  }

  function _resolveThumbnail(row, rec) {
    var path = rec.item && rec.item.path;
    if (!path || !_hasNativeApiBackend()) {
      if (rec.imageLoading) rec.imageLoading.dispose();
      return;
    }
    var size = rec.size;
    var key = _thumbKey(path, size);
    if (_negativeCache.isFailed(key)) {
      if (rec.imageLoading) rec.imageLoading.dispose();
      return;
    }
    _thumbQueue
      .request(key, function () { return _probeImageUrl(_treeThumbnailUrl(path, size)); })
      .then(
        function (url) {
          if (!url) {
            if (rec.imageLoading) rec.imageLoading.dispose();
            _negativeCache.markFailed(key);
            return;
          }
          if (!row.isConnected) return;
          if (!_tracked.has(row) || _tracked.get(row) !== rec) return;
          _promoteRowToThumbnail(row, rec, url);
        },
        function (err) {
          if (err === CANCELED) { rec.started = false; return; } // 未開始キャンセル: 再度視界に入ったら再試行できるようにする
          if (rec.imageLoading) rec.imageLoading.dispose();
          _negativeCache.markFailed(key);
        }
      );
  }

  function _promoteRowToThumbnail(row, rec, url) {
    var img = rec.thumbImg;
    if (!img) return;
    img.addEventListener('load', function () { img.classList.add('is-loaded'); }, { once: true });
    img.src = url; // プローブ済みURLと同一のためHTTPキャッシュから即時解決される
    row.classList.add('thumb-ready');
    // 仮想化コンテナに属する行は、絶対位置×固定行高の前提を維持するため
    // 累積オフセットを再計算し、変更行が表示範囲より上ならscrollTopを補正する。
    var nodeDiv = row.parentElement; // .tree-node
    var containerDiv = nodeDiv && nodeDiv.parentElement; // .tree-children（仮想化コンテナ）
    if (containerDiv && window.GBOutlinerVirtualRender && typeof window.GBOutlinerVirtualRender.updateRowHeight === 'function') {
      window.GBOutlinerVirtualRender.updateRowHeight(nodeDiv, thumbnailRowHeight());
    }
  }

  // ------------------------------------------------------------
  // 行DOMへの取り付け・取り外し（gb-outliner.part01.part02.js / gb-outliner-virtual-render.js から呼ばれる）
  // ------------------------------------------------------------

  // row: .tree-node-row 要素, item: ブラウズ項目, iconEl: 既存の .tree-icon 要素
  function attachToRow(row, item, iconEl) {
    if (!row || !item || !iconEl) return;
    var wantIcon = isFormatIconCandidate(item) && _hasNativeApiBackend();
    var wantThumb = isEnabled() && isThumbnailEligible(item) && _hasNativeApiBackend();
    if (!wantIcon && !wantThumb) return;

    var rec = {
      item: item,
      iconEl: iconEl,
      wantIcon: wantIcon,
      wantThumb: wantThumb,
      size: _thumbnailRequestSize(),
      started: false,
      thumbImg: null,
    };

    if (wantThumb) {
      var shell = document.createElement('span');
      shell.className = 'tree-thumb-shell';
      var img = document.createElement('img');
      img.className = 'tree-thumb-img';
      img.alt = '';
      img.decoding = 'async';
      shell.appendChild(img);
      iconEl.insertAdjacentElement('afterend', shell);
      rec.thumbImg = img;
      rec.shell = shell;
      rec.imageLoading = window.MeldexImageLoading?.track?.(img, {
        host: shell,
        label: 'サムネイルを読み込んでいます',
        errorMode: 'silent',
        allowDetached: true,
      }) || null;
    }

    _tracked.set(row, rec);
    var observer = _observer();
    if (observer) observer.observe(row);
    else _startForRow(row, rec); // IntersectionObserver未対応環境: 即時取得にフォールバック
  }

  // gb-outliner-virtual-render.js の _unmountRow / 非仮想化フォルダの再読込前などから
  // 呼ばれる。未開始のキュー要求をキャンセルし、監視を止めてメモリリークを防ぐ。
  function detachRow(row) {
    if (!row) return;
    var rec = _tracked.get(row);
    if (!rec) return;
    _tracked.delete(row);
    if (_io) { try { _io.unobserve(row); } catch (e) {} }
    if (rec.wantThumb) _thumbQueue.cancel(_thumbKey(rec.item && rec.item.path, rec.size));
    if (rec.imageLoading) rec.imageLoading.dispose();
  }

  // 再読込・設定OFF切替時に、追跡中の行と待機中の要求をすべて破棄する。
  // 実行中（既にネットワークへ出た）ものは完了まで進めるが、結果を適用する先の
  // _tracked が空になっているため、古い行への反映は起きない（無害化）。
  // 負キャッシュ（30秒TTLの取得失敗記録）もここでクリアする。クリアしないと
  // 「フォルダツリーを更新」直後に再試行しても、直前セッションで失敗記録された
  // パスがTTL経過まで再取得されない（フィルタ側にのみ実装済みの再取得契機を
  // 負キャッシュ側が無効化してしまうバグ）。
  function resetAll() {
    if (_io) { try { _io.disconnect(); } catch (e) {} }
    _tracked = new Map();
    _thumbQueue.cancelAllPending();
    _negativeCache.clearAll();
  }

  window.GBOutlinerThumbnails = {
    SETTING_KEY: SETTING_KEY,
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    SIZE_SETTING_KEY: SIZE_SETTING_KEY,
    sizeMode: sizeMode,
    setSizeMode: setSizeMode,
    isAvailable: _hasNativeApiBackend,
    isThumbnailEligible: isThumbnailEligible,
    isFormatIconCandidate: isFormatIconCandidate,
    attachFormatIcon: attachFormatIcon,
    NO_THUMBNAIL_EXTENSIONS: NO_THUMBNAIL_EXTENSIONS,
    NON_THUMBNAIL_TYPES: NON_THUMBNAIL_TYPES,
    createRequestQueue: createRequestQueue,
    createNegativeCache: createNegativeCache,
    createFormatIconCache: createFormatIconCache,
    compactRowHeight: compactRowHeight,
    thumbnailRowHeight: thumbnailRowHeight,
    maxThumbnailConcurrency: maxThumbnailConcurrency,
    attachToRow: attachToRow,
    detachRow: detachRow,
    resetAll: resetAll,
    // テスト・診断用（実装詳細への依存を避けたい呼び出し元は使わないこと）
    _debug: {
      trackedCount: function () { return _tracked.size; },
      thumbQueue: function () { return _thumbQueue; },
      formatIconCache: function () { return _formatIconCache; },
      negativeCache: function () { return _negativeCache; },
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.GBOutlinerThumbnails;
  }
})();
