/**
 * Meldex 汎用PNG出力エンジン (gb-export-image.js)
 *
 * Phase 2 の gb-export-html.js で生成した自己完結HTMLを
 * サーバーサイド (Playwright) に送信してPNGスクリーンショットを取得する。
 * Playwright 未インストール時は html2canvas フォールバック。
 */

const MeldexExportImage = (() => {

  // ================================================================
  // サーバーサイドレンダリング方式（推奨）
  // ================================================================

  async function _exportViaServer(html, options) {
    const opts = options || {};
    const zoom = parseFloat(document.documentElement.style.zoom) || 1;
    const dpr = opts.dpr || Math.round(window.devicePixelRatio || 1);
    const width = opts.width || Math.round((opts.contentWidth || 1200) * zoom);

    const res = await fetch('/api/export/html-to-png', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, width, dpr }),
    });

    if (res.status === 501) {
      // Playwright 未インストール → フォールバック
      return null;
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error('PNG生成に失敗: ' + (errText || res.statusText));
    }
    return await res.blob();
  }

  // ================================================================
  // ブラウザ自身のレイアウトエンジンによる画像化（SVG foreignObject）
  // ================================================================
  // html2canvas は writing-mode（縦書き）・ルビ・縦中横・text-orientation を解釈できず、
  // 縦書きのシナリオやノートを画像化すると文字が横倒し・重なりで崩れる。配布版には
  // サーバー側の画像化エンジンも同梱されないため、自己完結HTMLを画面外の iframe で
  // レイアウトし、その結果を SVG foreignObject 経由でキャンバスへ描く。描画は画面と
  // 同じエンジンが行うので、縦書き・ルビ・装飾がエディタ表示と一致する。
  // 外部リソースは読めない（SVG画像の制約）ため、フォント・画像は data URI 埋め込み済みの
  // HTML を渡すこと。data URI の SVG は Chromium でキャンバスを汚染しない。
  const NATIVE_MAX_CANVAS_EDGE = 32000;
  const NATIVE_MAX_CANVAS_AREA = 120 * 1000 * 1000;

  function _escapeStyleForXhtml(cssText) {
    // XHTML の <style> 本文は XML として解釈されるため、共通の XML エスケープを通す
    // （CDATA を使わず確実に通す。実体参照は XML 解析で元の文字に戻る）。
    return MeldexEscape.xml(cssText || '');
  }

  // 描画フレームを n 回待つ。ウィンドウが非表示・裏に回っていると描画フレームが進まず
  // 出力が永久に止まるため、各フレームを最大 80ms でタイマーへ切り替える。
  function _nextFrames(count) {
    const one = () => new Promise(resolve => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      try { requestAnimationFrame(finish); } catch {}
      setTimeout(finish, 80);
    });
    let chain = Promise.resolve();
    for (let i = 0; i < (count || 1); i++) chain = chain.then(one);
    return chain;
  }

  async function _waitForFrameAssets(doc) {
    try { if (doc.fonts?.ready) await doc.fonts.ready; } catch {}
    const images = Array.from(doc.images || []);
    await Promise.all(images.map(img => (img.complete ? null : new Promise(resolve => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    }))));
    await _nextFrames(2);
  }

  /**
   * 自己完結HTMLをブラウザのレイアウトエンジンでPNG化する。
   * @param {string} html - 完全なHTML文書（外部参照なし）
   * @param {Object} options - { viewportWidth, viewportHeight, dpr, captureSelector, padding, background }
   * @returns {Promise<Blob>}
   */
  async function renderHtmlToPngNative(html, options) {
    const opts = options || {};
    const viewportWidth = Math.max(320, Math.round(Number(opts.viewportWidth) || 1200));
    const viewportHeight = Math.max(200, Math.round(Number(opts.viewportHeight) || 800));
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    iframe.style.cssText = `position:fixed;left:-100000px;top:0;width:${viewportWidth}px;height:${viewportHeight}px;border:0;visibility:hidden;pointer-events:none;`;
    document.body.appendChild(iframe);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('画像化用の描画がタイムアウトしました')), 60000);
        iframe.onload = () => { clearTimeout(timer); resolve(); };
        iframe.srcdoc = html;
      });
      const doc = iframe.contentDocument;
      if (!doc?.body) throw new Error('画像化用の文書を構築できませんでした');
      await _waitForFrameAssets(doc);
      const target = (opts.captureSelector && doc.querySelector(opts.captureSelector)) || doc.body;
      const padding = Math.max(0, Number(opts.padding) || 0);
      // 縦書きの本文は左（負の座標）方向へはみ出す。foreignObject は文書の原点より左上を
      // 描けないため、はみ出し分だけ本文を右下へずらし、文書幅も同じだけ広げてから測る
      // （本文の折り返し幅は変えない）。
      const measureMin = () => {
        let mx = Infinity; let my = Infinity;
        const nodes = opts.boundsSelector ? target.querySelectorAll(opts.boundsSelector) : [target, ...target.querySelectorAll('*')];
        nodes.forEach(node => {
          const r = node.getBoundingClientRect();
          if (!r.width && !r.height) return;
          mx = Math.min(mx, r.left + (iframe.contentWindow.scrollX || 0));
          my = Math.min(my, r.top + (iframe.contentWindow.scrollY || 0));
        });
        return { mx: Number.isFinite(mx) ? mx : 0, my: Number.isFinite(my) ? my : 0 };
      };
      const firstMin = measureMin();
      const shiftX = firstMin.mx < padding ? Math.ceil(padding - firstMin.mx) : 0;
      const shiftY = firstMin.my < padding ? Math.ceil(padding - firstMin.my) : 0;
      if (shiftX || shiftY) {
        const bodyStyle = iframe.contentWindow.getComputedStyle(doc.body);
        doc.body.style.paddingLeft = (parseFloat(bodyStyle.paddingLeft) || 0) + shiftX + 'px';
        doc.body.style.paddingTop = (parseFloat(bodyStyle.paddingTop) || 0) + shiftY + 'px';
        iframe.style.width = (viewportWidth + shiftX) + 'px';
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      // 撮影範囲 = 対象要素の外接矩形（はみ出した子孫を含む）。縦書きの右起点レイアウトでも
      // 左右にはみ出た部分を取りこぼさないよう、子孫の矩形も合わせて測る。
      const rootRect = target.getBoundingClientRect();
      let minX = rootRect.left; let minY = rootRect.top; let maxX = rootRect.right; let maxY = rootRect.bottom;
      if (target !== doc.body) {
        // boundsSelector があれば内容を持つ要素だけで外接矩形を測る（min-height:100% 等の
        // 入れ物が作る余白を画像へ含めない）
        const boundNodes = opts.boundsSelector ? target.querySelectorAll(opts.boundsSelector) : target.querySelectorAll('*');
        if (opts.boundsSelector && boundNodes.length) {
          minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
        }
        boundNodes.forEach(node => {
          const r = node.getBoundingClientRect();
          if (!r.width && !r.height) return;
          minX = Math.min(minX, r.left); minY = Math.min(minY, r.top);
          maxX = Math.max(maxX, r.right); maxY = Math.max(maxY, r.bottom);
        });
      } else {
        maxX = Math.max(maxX, doc.documentElement.scrollWidth);
        maxY = Math.max(maxY, doc.documentElement.scrollHeight);
        minX = Math.min(minX, 0); minY = Math.min(minY, 0);
      }
      const scrollX = iframe.contentWindow.scrollX || 0;
      const scrollY = iframe.contentWindow.scrollY || 0;
      const x0 = Math.floor(minX + scrollX - padding);
      const y0 = Math.floor(minY + scrollY - padding);
      const width = Math.max(1, Math.ceil(maxX - minX + padding * 2));
      const height = Math.max(1, Math.ceil(maxY - minY + padding * 2));
      // foreignObject の大きさが描画時の表示領域になる。縦書きは1行の長さを表示領域の高さから
      // 決めるため、測定した iframe の表示領域より小さくしない（小さいと行の長さが変わる）。
      const docWidth = Math.max(width + Math.max(0, x0), doc.documentElement.scrollWidth, doc.documentElement.clientWidth);
      const docHeight = Math.max(height + Math.max(0, y0), doc.documentElement.scrollHeight, doc.documentElement.clientHeight);

      let background = opts.background || '';
      if (!background) {
        const bodyBg = iframe.contentWindow.getComputedStyle(doc.body).backgroundColor;
        const htmlBg = iframe.contentWindow.getComputedStyle(doc.documentElement).backgroundColor;
        background = [bodyBg, htmlBg].find(c => c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)') || '';
      }

      // 組方向が親と異なる要素（横書きの中の縦書き本文など）は、行の長さの基準が
      // foreignObject 内では通常表示と変わり、極端に短い行で組まれる。測定した行方向の
      // 長さ（縦書きは高さ、横書きは幅）を明示して、同じ位置で改行させる。
      const frameWin = iframe.contentWindow;
      [doc.body, ...doc.body.querySelectorAll('*')].forEach(node => {
        const parent = node.parentElement;
        if (!parent) return;
        const mode = frameWin.getComputedStyle(node).writingMode;
        if (mode === frameWin.getComputedStyle(parent).writingMode) return;
        const vertical = /^vertical|^sideways/.test(mode);
        if (vertical && !node.style.height) node.style.height = node.getBoundingClientRect().height + 'px';
        if (!vertical && !node.style.width) node.style.width = node.getBoundingClientRect().width + 'px';
      });

      const serializer = new XMLSerializer();
      const styles = Array.from(doc.querySelectorAll('style')).map(node => node.textContent || '').join('\n');
      const htmlAttrs = Array.from(doc.documentElement.attributes)
        .filter(attr => attr.name !== 'xmlns' && attr.name !== 'style')
        .map(attr => ` ${attr.name}="${MeldexEscape.html(attr.value)}"`).join('');
      // foreignObject 内では文書幅が foreignObject の幅になる。測定した iframe と同じ文書幅に
      // 固定し、中央寄せ・右寄せ（縦書き）の配置が画像化時にずれないようにする。
      const layoutWidth = doc.documentElement.clientWidth || (viewportWidth + shiftX);
      const layoutHeight = doc.documentElement.clientHeight || viewportHeight;
      const htmlStyle = ` style="width:${layoutWidth}px;min-width:${layoutWidth}px;max-width:${layoutWidth}px;min-height:${layoutHeight}px;${MeldexEscape.html(doc.documentElement.getAttribute('style') || '')}"`;
      // body を XHTML として直列化（<style>/<script> は除外済みの複製を使う）
      const bodyClone = doc.body.cloneNode(true);
      bodyClone.querySelectorAll('script, style, link').forEach(node => node.remove());
      const bodyXml = serializer.serializeToString(bodyClone);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x0} ${y0} ${width} ${height}">`
        + `<foreignObject x="0" y="0" width="${docWidth}" height="${docHeight}">`
        + `<html xmlns="http://www.w3.org/1999/xhtml"${htmlAttrs}${htmlStyle}><head><style>${_escapeStyleForXhtml(styles)}</style></head>${bodyXml}</html>`
        + '</foreignObject></svg>';

      const image = new Image();
      image.decoding = 'sync';
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('画像化用のSVGを読み込めませんでした'));
        image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      });
      // 非表示ウィンドウでは decode() が保留されることがあるため上限時間を設ける（読込自体は onload で完了済み）
      try { await Promise.race([image.decode?.(), new Promise(resolve => setTimeout(resolve, 2000))]); } catch {}

      // キャンバス上限を超える場合は解像度を下げる（長大なシナリオでも失敗させない）
      const desiredScale = Math.max(1, Number(opts.dpr) || Math.round(window.devicePixelRatio || 1) || 1);
      const scale = Math.min(
        desiredScale,
        NATIVE_MAX_CANVAS_EDGE / width,
        NATIVE_MAX_CANVAS_EDGE / height,
        Math.sqrt(NATIVE_MAX_CANVAS_AREA / (width * height)),
      );
      // これ以上縮めると文字が判読できない。崩れた画像を作らず、代わりの手段を案内する。
      if (!(scale >= 0.2)) {
        throw new Error('内容が大きすぎるため画像にできません。折り返し表示にするか、HTMLとして保存してください');
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const g = canvas.getContext('2d');
      if (background) {
        g.fillStyle = background;
        g.fillRect(0, 0, canvas.width, canvas.height);
      }
      g.scale(scale, scale);
      g.drawImage(image, 0, 0, width, height);
      return await new Promise((resolve, reject) => {
        canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Canvas→Blob変換に失敗'))), 'image/png');
      });
    } finally {
      iframe.remove();
    }
  }

  // ================================================================
  // html2canvas フォールバック
  // ================================================================

  async function _loadHtml2Canvas() {
    if (window.html2canvas) return window.html2canvas;
    if (window.MeldexCloudAssets) {
      await window.MeldexCloudAssets.load('capture');
      return window.html2canvas;
    }
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/html2canvas.min.js';
      s.onload = () => resolve(window.html2canvas);
      s.onerror = () => reject(new Error('html2canvas の読み込みに失敗しました'));
      document.head.appendChild(s);
    });
  }

  async function _fallbackHtml2Canvas(contentEl, options) {
    const h2c = await _loadHtml2Canvas();
    const scale = (options?.dpr || window.devicePixelRatio || 1);
    const rect = contentEl.getBoundingClientRect?.() || {};
    const width = Math.ceil(options?.width || contentEl.scrollWidth || rect.width || contentEl.clientWidth || 1200);
    const height = Math.ceil(options?.height || contentEl.scrollHeight || rect.height || contentEl.clientHeight || 800);
    let backgroundColor;
    for (let parent = contentEl; parent; parent = parent.parentElement) {
      const color = getComputedStyle(parent).backgroundColor;
      if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') {
        backgroundColor = color;
        break;
      }
    }
    // html2canvas は前世代のcolor構文までしか解釈できず、Chromeがネイティブの
    // チェックボックス等に用いる `color(srgb ...)` 形式の computed style に当たると
    // 例外で失敗する。サーバーサイド生成パス（MeldexExportHtml.exportToHtml側）は
    // 事前に preTransform でUI専用要素を取り除けるが、このフォールバック経路は
    // 実DOMをそのまま撮影するため同じ手段が使えない。ignoreElements で対象外にする。
    const ignoreElements = typeof options?.ignoreElements === 'function' ? options.ignoreElements : undefined;
    // html2canvasは複雑なDOM（縦書き・ルビ等の絶対配置要素が多いシナリオ表示等）で
    // 極端に時間がかかる、または返ってこないことがある。サーバー側レンダリングが
    // 使えない単独アプリではこのフォールバックが唯一の経路になるため、無期限に
    // 固まって見えないよう上限時間を設ける（タイムアウト後はエラー扱いにする）。
    const timeoutMs = Number(options?.fallbackTimeoutMs) || 120000;
    const canvas = await Promise.race([
      h2c(contentEl, {
        scale,
        useCORS: true,
        logging: false,
        width,
        height,
        // Capture extent and layout viewport are different: a narrow table
        // must not activate phone CSS in an otherwise desktop window.
        windowWidth: options?.layoutViewport?.width || width,
        windowHeight: options?.layoutViewport?.height || height,
        backgroundColor: options?.layoutViewport ? backgroundColor : undefined,
        onclone: options?.onclone,
        ignoreElements,
        scrollX: 0,
        scrollY: 0,
      }),
      new Promise((_resolve, reject) => setTimeout(
        () => reject(new Error('PNG生成がタイムアウトしました（内容が複雑すぎる可能性があります）')),
        timeoutMs,
      )),
    ]);
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas→Blob変換に失敗'));
      }, 'image/png');
    });
  }

  // ================================================================
  // 保存ダイアログ経由で保存
  // ================================================================

  async function _saveWithDialog(blob, title) {
    if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveBlob !== 'function') {
      showStatus('保存ダイアログを初期化できませんでした', true);
      return false;
    }
    return MeldexExportSave.saveBlob(blob, {
      title,
      extension: '.png',
      dialogTitle: '画像（PNG）として保存',
      filetypes: [['PNGファイル', '*.png'], ['すべてのファイル', '*.*']],
      okMessage: 'PNG として保存しました',
      errorMessage: 'PNG の保存に失敗しました',
    });
  }

  // ================================================================
  // メインAPI
  // ================================================================

  /**
   * 指定コンテンツ要素をPNGとしてエクスポートする
   * @param {HTMLElement} contentEl - キャプチャ対象の要素
   * @param {Object} options - { title, dpr, width, htmlOptions, useFallbackOnly }
   */
  async function exportToPng(contentEl, options) {
    const opts = options || {};
    showStatus('PNG を生成中...');

    try {
      let blob = null;

      // 縦書き・ルビを含み得るビューは、まずブラウザ自身のレイアウトで画像化する。
      let nativeHtml = '';
      let nativeError = null;
      if (opts.native && !opts.useFallbackOnly) {
        try {
          const html = typeof opts.buildHtml === 'function'
            ? await opts.buildHtml()
            : (typeof MeldexExportHtml !== 'undefined' ? await MeldexExportHtml.exportToHtml(contentEl, opts.htmlOptions || {}) : '');
          nativeHtml = html || '';
          if (html) {
            blob = await renderHtmlToPngNative(html, {
              viewportWidth: opts.nativeViewportWidth || contentEl?.scrollWidth || 1200,
              viewportHeight: opts.nativeViewportHeight || 800,
              dpr: opts.dpr,
              captureSelector: opts.captureSelector,
              boundsSelector: opts.boundsSelector,
              padding: opts.capturePadding,
            });
          }
        } catch (nativeErr) {
          console.warn('[export-image] native render failed, falling back:', nativeErr);
          nativeError = nativeErr;
          blob = null;
        }
      }

      if (!blob && !opts.useFallbackOnly && typeof MeldexExportHtml !== 'undefined') {
        try {
          // 方式C: HTML生成 → サーバーサイドレンダリング（専用スナップショットがあればそれを使う）
          const html = nativeHtml || await MeldexExportHtml.exportToHtml(contentEl, opts.htmlOptions || {});
          blob = await _exportViaServer(html, {
            dpr: opts.dpr,
            width: opts.width,
            contentWidth: contentEl.scrollWidth,
          });
        } catch (serverErr) {
          console.warn('[export-image] server render failed, falling back to html2canvas:', serverErr);
        }
      }

      // html2canvas は縦書き・ルビを描けない。縦書きを含み得るビューでは崩れた画像を
      // 黙って保存せず、失敗として知らせる（旧経路へ戻らない）。
      const legacyFallbackForbidden = typeof opts.forbidLegacyFallback === 'function'
        ? !!opts.forbidLegacyFallback()
        : !!opts.forbidLegacyFallback;
      if (!blob && legacyFallbackForbidden) {
        showStatus('PNG の生成に失敗しました' + (nativeError?.message ? ': ' + nativeError.message : ''), true);
        return;
      }
      if (!blob) {
        // フォールバック: html2canvas
        blob = await _fallbackHtml2Canvas(contentEl, opts);
      }

      if (!blob) {
        showStatus('PNG の生成に失敗しました', true);
        return;
      }

      // 保存ダイアログ or 直接ダウンロード
      await _saveWithDialog(blob, opts.title || '無題');

    } catch (err) {
      showStatus('PNG出力に失敗: ' + (err?.message || err), true);
    }
  }

  /**
   * 現在のビューをPNGとしてエクスポート
   */
  async function exportCurrentView(viewType) {
    const targets = {
      page: () => document.getElementById('page-content'),
      scriptnote: () => {
        if (typeof _sn2GetActiveEditor !== 'function') return null;
        const editor = _sn2GetActiveEditor();
        return editor?.host?.querySelector('.sn2-scroll') || null;
      },
      database: () => document.getElementById('pivot-table'),
      csv: () => {
        const c = document.getElementById('csv-table-container');
        return c?.querySelector('table') || null;
      },
      calendar: () => {
        const iframe = document.querySelector('#calendar-container iframe, iframe[src*="calendar"]');
        return document.querySelector('.gb-cal-root') || iframe?.contentDocument?.body || null;
      },
      'entity-layout': () => (typeof MeldexExportHtml !== 'undefined' && MeldexExportHtml.entityLayoutExportOptions)
        ? (MeldexExportHtml.entityLayoutExportOptions()?.canvasEl || null)
        : null,
    };

    const getEl = targets[viewType];
    if (!getEl) {
      showStatus('このビューのPNG出力は未対応です', true);
      return;
    }

    const titleMap = {
      page: () => {
        const pc = document.getElementById('page-content');
        const h = pc?.querySelector('h1, h2, h3');
        return h?.textContent || 'ノート';
      },
      scriptnote: () => {
        const comp = typeof getActiveScriptNoteComponent === 'function' ? getActiveScriptNoteComponent() : null;
        return comp?.state?.label || 'シナリオ';
      },
      database: () => state?.currentDbPath?.split('/').pop() || 'シート',
      csv: () => (typeof _csvPath !== 'undefined' ? _csvPath : '').split('/').pop()?.replace(/\.\w+$/, '') || 'CSV',
      calendar: () => 'カレンダー',
      'entity-layout': () => (typeof MeldexExportHtml !== 'undefined' && MeldexExportHtml.entityLayoutExportOptions)
        ? (MeldexExportHtml.entityLayoutExportOptions()?.htmlOptions?.title || 'トピックレイアウト')
        : 'エントリレイアウト',
    };

    // シナリオの描画の確定（入力中セルの再描画・縦書き寸法の待機）は
    // buildScriptNoteExportDocument が行う。ここで全体を描き直すと行選択が失われる。
    // ノートの縦書きも組み直しに時間がかかるため、同じく描画完了を待ってから撮影する
    if (viewType === 'page' && window.MeldexNoteWritingMode?.isActive?.()) {
      await _nextFrames(2);
    }

    const el = getEl();
    if (!el) {
      showStatus('エクスポート対象が見つかりません', true);
      return;
    }

    const title = (titleMap[viewType] || (() => '無題'))();

    // エントリレイアウトはデザイン基準サイズ（transform解除後の実寸）でビューポート幅を固定する
    const extraOptions = {};
    if (viewType === 'entity-layout' && typeof MeldexExportHtml !== 'undefined' && MeldexExportHtml.entityLayoutExportOptions) {
      const layoutOptions = MeldexExportHtml.entityLayoutExportOptions();
      if (layoutOptions) extraOptions.width = layoutOptions.width + 32;
    }

    const htmlOptions = _getHtmlOptionsForView(viewType);
    // シナリオは本文・タイプ書式・縦書き・ルビをエディタと同じに再現する専用スナップショットを使う
    if (viewType === 'scriptnote' && typeof buildScriptNoteExportDocument === 'function') {
      const editor = typeof _sn2GetActiveEditor === 'function' ? _sn2GetActiveEditor() : null;
      let snapshot = null;
      await exportToPng(el, {
        title,
        native: true,
        buildHtml: async () => {
          snapshot = await buildScriptNoteExportDocument(editor, { purpose: 'image' });
          return snapshot?.html || '';
        },
        get nativeViewportWidth() { return snapshot?.viewportWidth || 1200; },
        get nativeViewportHeight() { return snapshot?.viewportHeight || 800; },
        captureSelector: '.sn2-scroll',
        boundsSelector: '.sn2-header, .sn2-row, .sn2-page-break, .sn2-spread-border',
        capturePadding: 16,
        forbidLegacyFallback: true,
        htmlOptions,
        ignoreElements: _ignoreElementsForView(viewType),
      });
      return;
    }
    // ノートの縦書きは1行の長さが本文領域の高さで決まる。画像も画面と同じ高さで組む。
    if (viewType === 'page') {
      const pane = el.closest?.('.page-scroll, .editor-scroll, .pane-content') || el.parentElement || el;
      extraOptions.nativeViewportWidth = Math.max(320, Math.round(pane.clientWidth || el.clientWidth || 1200));
      extraOptions.nativeViewportHeight = Math.max(320, Math.round(pane.clientHeight || el.clientHeight || window.innerHeight || 800));
    }
    await exportToPng(el, {
      native: viewType === 'page',
      captureSelector: viewType === 'page' ? '#page-content' : undefined,
      forbidLegacyFallback: viewType === 'page' && !!window.MeldexNoteWritingMode?.isActive?.(),
      title,
      htmlOptions,
      layoutViewport: viewType === 'database' ? { width: window.innerWidth, height: window.innerHeight } : undefined,
      onclone: viewType === 'database' ? doc => {
        const table = doc.getElementById('pivot-table');
        if (table) htmlOptions.preTransform(table);
      } : undefined,
      ignoreElements: _ignoreElementsForView(viewType),
      ...extraOptions,
    });
  }

  // フォールバック（html2canvas直接撮影）経路専用。サーバー生成パスの
  // preTransform で除去しているUI専用要素と同じものを撮影対象から除外する。
  // 現状シナリオの行選択チェックボックス（.sn2-row-check）がネイティブ描画で
  // color() 構文の computed style になり html2canvas が解析に失敗するため、
  // ここで撮影自体から外す（見た目のオン/オフ状態は元々エクスポート対象外）。
  function _ignoreElementsForView(viewType) {
    if (viewType === 'entity-layout') {
      // サーバー経路の preTransform と同じ編集チロームをフォールバック撮影からも除外する
      const selector = '.el-cell-remove, .el-cell-settings, .el-cell-resize';
      return (el) => { try { return el.matches?.(selector) === true; } catch { return false; } };
    }
    if (viewType !== 'scriptnote') return undefined;
    const selector = '.sn2-row-bulk-bar, .sn2-handle-zone, .sn2-handle, .sn2-add-row, .sn2-add-col-btn, .sn2-row-check';
    return (el) => { try { return el.matches?.(selector) === true; } catch { return false; } };
  }

  /** ビューごとの HTML 出力オプション */
  function _collectCalendarIframeCss() {
    const iframe = document.querySelector('#calendar-container iframe, iframe[src*="calendar"]');
    let css = '';
    if (!iframe?.contentDocument) return css;
    for (const sheet of iframe.contentDocument.styleSheets) {
      try {
        for (const rule of sheet.cssRules) css += rule.cssText + '\n';
      } catch {}
    }
    return css;
  }

  function _databasePreTransformOptions() {
    const table = document.getElementById('pivot-table');
    const origCells = table ? Array.from(table.querySelectorAll('th, td')) : [];
    const cellStyles = origCells.map(cell => {
      const style = getComputedStyle(cell);
      return { width: cell.getBoundingClientRect().width, color: style.color, backgroundColor: style.backgroundColor };
    });
    const origBadges = table ? Array.from(table.querySelectorAll('[class*="status-"]')) : [];
    const badgeStyles = origBadges.map(badge => {
      const cs = getComputedStyle(badge);
      return { bg: cs.backgroundColor, color: cs.color };
    });
    return {
      preTransform: (clone) => {
        const cloneCells = clone.querySelectorAll('th, td');
        cellStyles.forEach((style, i) => {
          if (!cloneCells[i]) return;
          cloneCells[i].style.width = style.width + 'px';
          cloneCells[i].style.minWidth = style.width + 'px';
          cloneCells[i].style.color = style.color;
          cloneCells[i].style.backgroundColor = style.backgroundColor;
          cloneCells[i].style.position = 'static';
          cloneCells[i].style.left = 'auto';
          cloneCells[i].style.right = 'auto';
        });
        const cloneBadges = clone.querySelectorAll('[class*="status-"]');
        cloneBadges.forEach((badge, i) => {
          if (!badgeStyles[i]) return;
          badge.style.backgroundColor = badgeStyles[i].bg;
          badge.style.color = badgeStyles[i].color;
        });
        clone.querySelectorAll('.col-row-controls-header, .col-row-controls, .col-add-prop, .col-add-prop-cell, .new-entity-row, .new-entity-spacer-row, .entity-row-open-btn, .entity-row-more-btn, .th-more-btn, .col-resize-handle, .cell-value-more, .cell-add-btn').forEach(node => node.remove());
        if (clone.tHead) clone.tHead.style.position = 'static';
        clone.querySelectorAll('.entity-name-cell-main').forEach(node => { node.style.paddingRight = '0'; });
      },
    };
  }

  function _getHtmlOptionsForView(viewType) {
    switch (viewType) {
      case 'page':
        if (typeof MeldexExportHtml !== 'undefined' && MeldexExportHtml.noteExportOptions) {
          const pc = document.getElementById('page-content');
          return MeldexExportHtml.noteExportOptions(pc, !!(window.MeldexNoteWritingMode && window.MeldexNoteWritingMode.isActive()), '');
        }
        return {
          cssFiles: ['gb-tools.css', 'gb-ui.css'],
          // 組方向を画像にも反映する。スタイルの本体は gb-export-html.js の
          // noteExportCss と共有し、HTML出力と画像出力で見た目がずれないようにする。
          extraCss: (typeof MeldexExportHtml !== 'undefined' && MeldexExportHtml.noteExportCss)
            ? MeldexExportHtml.noteExportCss(!!(window.MeldexNoteWritingMode && window.MeldexNoteWritingMode.isActive()))
            : `
            #page-content, [id="page-content"] {
              padding: 16px 60px; line-height: 1.7; max-width: 900px; margin: 0 auto;
            }
            ruby { ruby-position: over; }
            rt { font-size: 0.55em; line-height: 1; color: inherit; opacity: 0.75; }
          `,
        };
      case 'scriptnote':
        return {
          cssFiles: ['gb-scriptnote-editor.css'],
          extraCss: `
            .sn2-scroll { flex: none !important; overflow: visible !important; height: auto !important; max-height: none !important; width: fit-content !important; max-width: none !important; }
            .sn2-row-bulk-bar, .sn2-handle, .sn2-handle-zone, .sn2-add-row, .sn2-add-col-btn, .sn2-resizer, .sn2-col-resizer, .sn2-row-resizer { display: none !important; }
            ruby { ruby-position: over; }
            .sn2-scroll.sn2-vertical ruby { ruby-position: inter-character; }
            rt { font-size: 0.55em; line-height: 1; color: inherit; opacity: 0.75; }
          `,
          preTransform: (clone) => {
            clone.querySelectorAll('.sn2-row-bulk-bar, .sn2-handle-zone, .sn2-handle, .sn2-add-row, .sn2-add-col-btn').forEach(el => el.remove());
          },
        };
      case 'database':
        return {
          cssFiles: ['gb-tools.css', 'gb-ui.css'],
          extraCss: `
            table { border-collapse: collapse; table-layout: fixed; width: 100%; }
            th, td { border: 1px solid var(--border, #333); padding: 4px 8px; }
            body { padding: 16px; }
          `,
          embedImages: false,
          ..._databasePreTransformOptions(),
        };
      case 'csv':
        return {
          extraCss: `
            table { border-collapse: collapse; }
            th, td { border: 1px solid var(--border, #333); padding: 4px 8px; }
            body { padding: 16px; }
          `,
          embedImages: false,
        };
      case 'calendar':
        return {
          cssFiles: ['gb-tools.css', 'gb-ui.css'],
          extraCss: _collectCalendarIframeCss() + '\nbody { padding: 16px; }',
          embedImages: false,
        };
      case 'entity-layout':
        // HTML出力（gb-export-html.js）と同じオプションを共有し、見た目のズレを防ぐ
        return (typeof MeldexExportHtml !== 'undefined' && MeldexExportHtml.entityLayoutExportOptions)
          ? (MeldexExportHtml.entityLayoutExportOptions()?.htmlOptions || {})
          : {};
      default:
        return {};
    }
  }

  // ================================================================
  // Public API
  // ================================================================

  return {
    exportToPng,
    exportCurrentView,
    renderHtmlToPngNative,
  };

})();
