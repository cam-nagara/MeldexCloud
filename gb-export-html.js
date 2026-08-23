/**
 * Meldex 汎用HTML出力エンジン (gb-export-html.js)
 *
 * 全エディタ共通の「自己完結型HTML」生成機能を提供する。
 * シナリオの exportCurrentScriptNoteAsHtml() を参考に、DOMクローン→クリーンアップ→
 * CSS収集→フォント埋め込み→HTML組み立ての共通パイプラインを実装する。
 */

const MeldexExportHtml = (() => {

  function _getFormControlStaticText(node) {
    if (!node) return '';
    const tagName = node.tagName || '';
    if (tagName === 'SELECT') {
      const selected = node.selectedOptions?.[0];
      return selected?.textContent || node.value || '';
    }
    if (tagName === 'TEXTAREA') {
      return node.value || node.textContent || '';
    }
    if (tagName === 'INPUT') {
      const inputType = (node.type || '').toLowerCase();
      if (inputType === 'checkbox') return node.checked ? '☑' : '☐';
      if (inputType === 'radio') return node.checked ? '◉' : '○';
      return node.value || node.textContent || '';
    }
    return node.value || node.textContent || '';
  }

  // ================================================================
  // 1. DOMクローン + クリーンアップ
  // ================================================================

  /** 要素をクローンし、インタラクティブ属性を除去する
   * @param {HTMLElement} el
   * @param {Object} [opts]
   * @param {boolean} [opts.preserveFormControls=false]
   *   true の場合、input/textarea/select/button を span/disabled 化せずそのまま残す。
   *   公開フォームのようにユーザー入力を受け付ける必要がある HTML に使う。
   */
  function cloneAndClean(el, opts) {
    const options = opts || {};
    const clone = el.cloneNode(true);
    const allNodes = [clone, ...clone.querySelectorAll('*')];
    // contenteditable 除去
    allNodes.forEach(node => {
      node.removeAttribute('contenteditable');
    });
    // data-action / data-sn-action / data-on* 除去
    allNodes.forEach(node => {
      node.removeAttribute('data-action');
      node.removeAttribute('data-sn-action');
      node.removeAttribute('data-args');
      node.removeAttribute('data-onchange');
      node.removeAttribute('data-oninput');
      node.removeAttribute('data-onkeydown');
      node.removeAttribute('data-onfocus');
    });
    // tabindex / draggable 除去
    allNodes.forEach(node => {
      node.removeAttribute('tabindex');
      node.removeAttribute('draggable');
    });
    // イベント属性除去
    const eventAttrs = ['onclick', 'onmouseover', 'onmouseout', 'onmousedown', 'onmouseup',
      'onkeydown', 'onkeyup', 'ondblclick', 'oncontextmenu', 'ondragstart', 'ondrop', 'oninput', 'onchange'];
    allNodes.forEach(node => {
      eventAttrs.forEach(attr => node.removeAttribute(attr));
    });
    // input / textarea / select をテキストに変換、button は無効化
    // preserveFormControls=true の場合はフォーム操作を残すためスキップ
    if (!options.preserveFormControls) {
      clone.querySelectorAll('input, textarea, select, button').forEach(node => {
        if (node.tagName === 'BUTTON') {
          node.setAttribute('disabled', 'disabled');
          node.style.pointerEvents = 'none';
        } else {
          const span = document.createElement('span');
          span.className = node.className;
          span.textContent = _getFormControlStaticText(node);
          node.replaceWith(span);
        }
      });
    }
    return clone;
  }

  // ================================================================
  // 2. ルビ変換
  // ================================================================

  /** span[data-ruby] → ネイティブ <ruby><rt> に変換 */
  function convertDataRuby(el) {
    el.querySelectorAll('[data-ruby]').forEach(node => {
      const rubyText = node.getAttribute('data-ruby');
      if (!rubyText) return;
      const baseText = node.textContent || '';
      const ruby = document.createElement('ruby');
      ruby.appendChild(document.createTextNode(baseText));
      const rt = document.createElement('rt');
      rt.textContent = rubyText;
      ruby.appendChild(rt);
      node.replaceWith(ruby);
    });
  }

  // ================================================================
  // 3. CSS変数の収集
  // ================================================================

  /** :root の CSS 変数を実値に解決して返す */
  function collectCssVars() {
    const rootStyle = getComputedStyle(document.documentElement);
    const varNames = [
      '--bg', '--bg2', '--bg3', '--bg4',
      '--fg', '--fg2', '--accent', '--accent2',
      '--border', '--selection',
      '--ui-header-fg', '--ui-header-bg',
      '--ui-header-font',
      '--ui-toolbar-fg', '--ui-toolbar-bg',
      '--ui-toolbar-font', '--ui-muted-font',
      '--ui-hover-fg', '--ui-hover-bg',
      '--ui-fg-strong',
      '--ui-selection-fg', '--ui-selection-bg',
      '--ui-range-fill-bg', '--ui-range-track-bg',
      '--ui-scrollbar-track-bg', '--ui-scrollbar-thumb-bg', '--ui-scrollbar-thumb-hover-bg',
      '--ui-font', '--ui-font-size',
      '--db-th-font', '--db-entity-font', '--db-cell-font',
      '--red', '--green', '--blue', '--yellow', '--orange', '--purple',
    ];
    return varNames
      .map(v => {
        const val = rootStyle.getPropertyValue(v).trim();
        return val ? `${v}: ${val};` : '';
      })
      .filter(Boolean)
      .join(' ');
  }

  // ================================================================
  // 4. フォント埋め込み
  // ================================================================

  /** 埋め込み可能な Noto Sans JP のウェイト定義（fonts/ に同梱済みのwoff2のみ） */
  const EXPORT_FONT_WEIGHTS = {
    regular: { file: 'fonts/NotoSansJP-Regular.woff2', weight: 400 },
    medium: { file: 'fonts/NotoSansJP-Medium.woff2', weight: 500 },
    bold: { file: 'fonts/NotoSansJP-Bold.woff2', weight: 700 },
  };

  /** Noto Sans JP を data URI で埋め込む。既定は Regular のみ。
      太字を使うビュー（エントリレイアウトのセル書式等）は weights: ['regular','bold'] を渡す。 */
  async function embedFont(weights) {
    const list = Array.isArray(weights) && weights.length ? weights : ['regular'];
    const parts = [];
    for (const key of list) {
      const def = EXPORT_FONT_WEIGHTS[key];
      if (!def) continue;
      try {
        const r = await fetch(def.file);
        if (!r.ok) continue;
        const buf = await r.arrayBuffer();
        const bin = new Uint8Array(buf);
        let s = '';
        for (let i = 0; i < bin.length; i++) s += String.fromCharCode(bin[i]);
        const b64 = btoa(s);
        parts.push(`@font-face { font-family: 'Noto Sans JP'; font-style: normal; font-weight: ${def.weight}; src: url('data:font/woff2;base64,${b64}') format('woff2'); }`);
      } catch { /* このウェイトはフォールバックフォントに任せる */ }
    }
    return parts.join('\n');
  }

  // ================================================================
  // 5. 完全静的化CSS
  // ================================================================

  function getStaticCss() {
    return `
/* 完全静的化: インタラクティブ要素を無効化 */
* { cursor: default !important; }
*:hover, *:focus, *:active { outline: none !important; }
*::selection { background: rgba(100,150,255,0.2); }
[contenteditable] { -webkit-user-modify: read-only; caret-color: transparent; }
input, textarea, select { display: none !important; }
button[disabled] { cursor: default !important; opacity: 1 !important; pointer-events: none; }
a { pointer-events: none; color: inherit; text-decoration: inherit; }
/* 印刷時の背景色保持 */
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`;
  }

  // ================================================================
  // 6. CSS取得ヘルパー
  // ================================================================

  function _resolveCssUrl(url, baseUrl) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    try {
      return new URL(raw, baseUrl ? new URL(baseUrl, document.baseURI) : document.baseURI).toString();
    } catch {
      return raw;
    }
  }

  function _withCacheBust(url) {
    const sep = String(url).includes('?') ? '&' : '?';
    return `${url}${sep}_=${Date.now()}`;
  }

  async function _inlineCssImports(cssText, baseUrl, seen) {
    const importRe = /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?[^;]*;/gi;
    let out = '';
    let last = 0;
    let match;
    while ((match = importRe.exec(cssText))) {
      out += cssText.slice(last, match.index);
      const importUrl = _resolveCssUrl(match[1], baseUrl);
      if (importUrl) out += await fetchCss(importUrl, seen) + '\n';
      last = match.index + match[0].length;
    }
    return out + cssText.slice(last);
  }

  /** 外部CSSファイルを取得し、@import も自己完結用に展開する（キャッシュバイパス付き） */
  async function fetchCss(url, seen) {
    const resolvedUrl = _resolveCssUrl(url);
    if (!resolvedUrl) return '';
    const visited = seen || new Set();
    if (visited.has(resolvedUrl)) return '';
    visited.add(resolvedUrl);
    try {
      const res = await fetch(_withCacheBust(resolvedUrl), { cache: 'no-store' });
      if (!res.ok) return '';
      const cssText = await res.text();
      return await _inlineCssImports(cssText, resolvedUrl, visited);
    } catch {
      return '';
    }
  }

  // ================================================================
  // 7. 画像の data URI 化
  // ================================================================

  /** クローン内の画像を data URI に変換する */
  async function embedImages(clone) {
    const imgs = clone.querySelectorAll('img[src]');
    const promises = [];
    for (const img of imgs) {
      const src = img.getAttribute('src');
      if (!src || src.startsWith('data:')) continue;
      promises.push((async () => {
        try {
          const res = await fetch(src);
          if (!res.ok) return;
          const blob = await res.blob();
          const reader = new FileReader();
          const dataUri = await new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          img.setAttribute('src', dataUri);
        } catch { /* 変換失敗は無視 */ }
      })());
    }
    await Promise.all(promises);
  }

  // ================================================================
  // 8. HTML組み立て
  // ================================================================

  function buildHtml(title, bodyHtml, css, fontCss, extraHeadHtml) {
    const escHtml = MeldexEscape.html;
    return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="color-scheme" content="dark light">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)}</title>
<style>
${fontCss}
${css}
${getStaticCss()}
</style>
${extraHeadHtml || ''}
</head>
<body>
${bodyHtml}
</body>
</html>`;
  }

  // ================================================================
  // 9. 保存ダイアログ呼び出し
  // ================================================================

  async function saveWithDialog(html, title) {
    if (typeof MeldexExportSave !== 'undefined' && typeof MeldexExportSave.saveText === 'function') {
      return await MeldexExportSave.saveText(html, {
        title,
        extension: '.html',
        dialogTitle: 'HTMLとして保存',
        filetypes: [['HTMLファイル', '*.html'], ['すべてのファイル', '*.*']],
        bom: true,
        registerPublishPath: true,
        okMessage: 'HTML として保存しました',
        errorMessage: 'HTML の保存に失敗しました',
      });
    }
    showStatus('保存ダイアログを初期化できませんでした', true);
    return false;
  }

  // ================================================================
  // 10. エディタ別の前処理 + エクスポート
  // ================================================================

  /** 汎用 exportToHtml: contentEl をクローンし自己完結HTML文字列を生成 */
  async function exportToHtml(contentEl, options) {
    const opts = options || {};
    const clone = cloneAndClean(contentEl);

    // ルビ変換
    convertDataRuby(clone);

    // エディタ固有の前処理コールバック
    if (typeof opts.preTransform === 'function') {
      opts.preTransform(clone);
    }

    // 画像の data URI 化
    if (opts.embedImages !== false) {
      await embedImages(clone);
    }

    // CSS
    const varDecls = collectCssVars();
    let cssText = `:root { ${varDecls} }\n`;
    cssText += `html, body {
  margin: 0; padding: 0;
  background: var(--bg, #1e1e1e);
  color: var(--fg, #d4d4d4);
  font-family: var(--ui-font, 'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic UI', 'Meiryo', sans-serif);
  font-size: var(--ui-font-size, 15px);
}\n`;

    // 追加CSSファイル
    if (opts.cssFiles) {
      for (const url of opts.cssFiles) {
        cssText += await fetchCss(url) + '\n';
      }
    }
    // 追加インラインCSS
    if (opts.extraCss) {
      cssText += opts.extraCss + '\n';
    }

    // フォント埋め込み（fontWeights で太字等の追加ウェイトを指定できる）
    const fontCss = opts.embedFont !== false ? await embedFont(opts.fontWeights) : '';

    const title = opts.title || document.title || '無題';
    return buildHtml(title, clone.outerHTML, cssText, fontCss, opts.extraHeadHtml);
  }

  // ================================================================
  // 11. 各ビューのエクスポートエントリポイント
  // ================================================================

  async function exportCurrentView(viewType) {
    showStatus('HTML を生成中...');
    try {
      let html;
      switch (viewType) {
        case 'page': html = await _exportNotePage(); break;
        case 'database': html = await _exportDatabase(); break;
        case 'csv': html = await _exportCsv(); break;
        case 'smart-db': html = await _exportSmartDb(); break;
        case 'calendar': html = await _exportCalendar(); break;
        case 'board': html = await _exportBoard(); break;
        case 'entity-layout': html = await _exportEntityLayout(); break;
        default:
          showStatus('このビューのHTML出力は未対応です', true);
          return;
      }
      if (!html) return;
      const title = _getViewTitle(viewType);
      await saveWithDialog(html, title);
    } catch (err) {
      showStatus('HTML出力に失敗しました: ' + (err?.message || err), true);
    }
  }

  async function publishCurrentView(viewType, opts) {
    const publishOpts = opts || {};
    const ctx = typeof getCurrentPublishContext === 'function' ? getCurrentPublishContext() : { kind: viewType, path: '' };
    const kind = viewType || ctx.kind;
    const supportedKinds = ['page', 'entity', 'database', 'csv', 'smart-db', 'calendar'];
    if (!supportedKinds.includes(kind)) {
      showStatus('このビューは公開HTMLに未対応です', true);
      return false;
    }
    if (typeof MeldexPublicRuntime === 'undefined' || typeof MeldexPublicRuntime.buildPublishHtml !== 'function') {
      showStatus('公開HTMLランタイムを読み込めませんでした', true);
      return false;
    }
    showStatus('公開HTMLを生成中...');
    const publishCtx = typeof getCurrentPublishContext === 'function' ? getCurrentPublishContext() : { kind, path: '' };
    const cfg = typeof getPublishConfigForContext === 'function' ? getPublishConfigForContext(publishCtx) : {};
    if (typeof assertPublishAllowedForContext === 'function' && !await assertPublishAllowedForContext(publishCtx)) {
      return false;
    }
    // 公開設定にコンテキスト由来の値を合成してランタイムへ渡す
    const mergedCfg = {
      ...cfg,
      title: _getViewTitle(kind),
      db_path: publishCtx.path || cfg.db_path || '',
    };
    const html = await MeldexPublicRuntime.buildPublishHtml(kind, mergedCfg);
    if (!html) return false;
    let result = false;
    if (cfg.html_path && !publishOpts.changePath && typeof MeldexExportSave !== 'undefined' && typeof MeldexExportSave.saveTextDirect === 'function') {
      result = await MeldexExportSave.saveTextDirect(cfg.html_path, html, {
        bom: true,
        allowRegister: false,
        okMessage: '公開HTMLを更新しました',
        errorMessage: '公開HTMLの更新に失敗しました',
      });
      if (!result) result = await saveWithDialog(html, mergedCfg.title);
    } else {
      result = await saveWithDialog(html, mergedCfg.title);
    }
    if (result?.path && typeof savePublishConfigForContext === 'function') {
      const next = { ...(cfg || {}), html_path: result.path, last_published_at: new Date().toISOString() };
      await savePublishConfigForContext(publishCtx, next);
    }
    return !!result;
  }

  function _getViewTitle(viewType) {
    switch (viewType) {
      case 'page': {
        const pc = document.getElementById('page-content');
        const h1 = pc?.querySelector('h1, h2, h3');
        return h1?.textContent || pc?.dataset?.path?.split('/').pop()?.replace(/\.\w+$/, '') || 'ノート';
      }
      case 'entity': {
        const title = document.getElementById('entity-title')?.textContent?.trim();
        return title || state?.currentEntityPath?.split(/[\\/]/).pop()?.replace(/\.\w+$/, '') || 'エントリ';
      }
      case 'database':
        return state?.currentDbPath?.split('/').pop() || 'シート';
      case 'smart-db':
        return (state?.currentSmartDb?.name || 'スマートシート') + (typeof getSmartDbActiveView === 'function' && getSmartDbActiveView() === 'dashboard' ? ' ダッシュボード' : '');
      case 'csv':
        return (typeof _csvPath !== 'undefined' ? _csvPath : '').split('/').pop()?.replace(/\.\w+$/, '') || 'CSV';
      case 'calendar':
        return 'カレンダー';
      case 'board': {
        const path = (typeof bd !== 'undefined' && bd?.path) || '';
        return path.split('/').pop() || 'ボード';
      }
      case 'entity-layout': {
        const canvasEl = _findVisibleEntityLayoutCanvas();
        const grid = canvasEl?.closest('.entity-props-grid-container');
        const layoutName = grid?.querySelector('.el-tab.active .el-tab-label')?.textContent?.trim() || 'エントリレイアウト';
        const entityName = _entityLayoutEntityName(canvasEl);
        return entityName && entityName !== 'エントリ' ? entityName + ' - ' + layoutName : layoutName;
      }
      default:
        return '無題';
    }
  }

  // --- エントリレイアウト ---

  /** 表示中のエントリレイアウトのキャンバス（等比フィット中の .el-canvas）を探す。
      書き出しメニュー（gb-db-entity-layout.js）が押された面の grid を
      window.__meldexEntityLayoutExportRoot に控えるため、複数面で同時に開いていても
      その面のキャンバスを優先する。 */
  function _findVisibleEntityLayoutCanvas() {
    const stashedRoot = window.__meldexEntityLayoutExportRoot;
    const scope = stashedRoot?.isConnected ? stashedRoot : document;
    const found = Array.from(scope.querySelectorAll('.el-viewport .el-canvas')).find(el => {
      if (!el.isConnected) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }) || null;
    if (found || scope === document) return found;
    return Array.from(document.querySelectorAll('.el-viewport .el-canvas')).find(el => {
      const rect = el.getBoundingClientRect();
      return el.isConnected && rect.width > 0 && rect.height > 0;
    }) || null;
  }

  /** 書き出し対象の面のエントリ名（サブパネル/右サイドバーはそれぞれのエントリ名を使う） */
  function _entityLayoutEntityName(canvasEl) {
    const surfaceRoot = canvasEl?.closest?.('[data-meldex-entity-detail]');
    const path = surfaceRoot?.dataset?.path || '';
    if (path) return path.split(/[\/]/).pop().replace(/\.\w+$/, '');
    return _getViewTitle('entity');
  }

  /** エントリレイアウトの編集チローム（削除/設定/リサイズ等）を静的出力から取り除く */
  function _stripEntityLayoutEditChrome(clone) {
    clone.querySelectorAll('.el-cell-remove, .el-cell-settings, .el-cell-resize').forEach(el => el.remove());
    clone.querySelectorAll('.el-cell.el-selected').forEach(el => el.classList.remove('el-selected'));
    clone.querySelectorAll('.el-cell.el-editable').forEach(el => el.classList.remove('el-editable'));
  }

  /** エントリレイアウト書き出しの共通オプション。PNG出力側（gb-export-image.js）と共有する。 */
  function entityLayoutExportOptions() {
    const canvasEl = _findVisibleEntityLayoutCanvas();
    if (!canvasEl) return null;
    const width = parseInt(canvasEl.style.width, 10) || canvasEl.offsetWidth || 1000;
    const height = parseInt(canvasEl.style.height, 10) || canvasEl.offsetHeight || 700;
    // セル書式で太字が使われている場合は Bold ウェイトも埋め込む（5.5節）
    const usesBold = !!canvasEl.querySelector('.el-cell[style*="font-weight"]');
    return {
      canvasEl,
      width,
      height,
      htmlOptions: {
        title: _getViewTitle('entity-layout'),
        cssFiles: ['gb-db-entity-layout.css', 'gb-tools.css', 'gb-ui.css'],
        extraCss: 'body { padding: 16px; } .el-canvas { position: relative; margin: 0 auto; }',
        fontWeights: usesBold ? ['regular', 'bold'] : ['regular'],
        preTransform: (clone) => {
          // 表示用の等比フィット transform: scale() を解除し、デザイン基準サイズのまま書き出す
          clone.style.transform = 'none';
          clone.style.position = 'relative';
          clone.style.width = width + 'px';
          clone.style.height = height + 'px';
          _stripEntityLayoutEditChrome(clone);
        },
      },
    };
  }

  async function _exportEntityLayout() {
    const opts = entityLayoutExportOptions();
    if (!opts) {
      showStatus('エントリレイアウトが表示されていません', true);
      return null;
    }
    return exportToHtml(opts.canvasEl, opts.htmlOptions);
  }

  // --- ノート ---
  // ノート本文の書き出し用スタイル。組方向を書き出し結果にも反映する。
  // 旧実装では #page-content にHTMLのインラインstyleがあり、ここで指定した余白等が
  // 実際には適用されていなかった（インラインstyleは外部CSSより優先されるため）。
  // レイアウトを外部CSSへ移したので、ここの指定が初めて効くようになっている。
  function noteExportCss(vertical) {
    if (!vertical) {
      return `
        #page-content, [id="page-content"] {
          padding: 16px 60px;
          line-height: 1.7;
          max-width: 900px;
          margin: 0 auto;
        }
        ruby { ruby-position: over; }
        rt { font-size: 0.55em; line-height: 1; color: inherit; opacity: 0.75; }
      `;
    }
    return `
        #page-content, [id="page-content"] {
          writing-mode: vertical-rl;
          text-orientation: mixed;
          font-feature-settings: "vert" 1, "vpal" 1;
          padding-block: 16px;
          padding-inline: 60px;
          line-height: 2.0;
          max-inline-size: 900px;
          margin-inline: auto;
          block-size: max-content;
          inline-size: auto;
          overflow: visible;
        }
        html, body { block-size: auto; }
        /* コードは縦組みにしない */
        #page-content pre, [id="page-content"] pre { writing-mode: horizontal-tb; }
        /* 番号は縦中横で正立させる */
        #page-content ol > li::marker, [id="page-content"] ol > li::marker { text-combine-upright: all; }
        ruby { ruby-position: inter-character; }
        rt { font-size: 0.55em; line-height: 1; color: inherit; opacity: 0.75; }
      `;
  }

  async function _exportNotePage() {
    const pc = document.getElementById('page-content');
    if (!pc) { showStatus('ノートが開かれていません', true); return null; }
    const vertical = !!(window.MeldexNoteWritingMode && window.MeldexNoteWritingMode.isVertical(pc));
    return exportToHtml(pc, {
      title: _getViewTitle('page'),
      cssFiles: ['gb-tools.css', 'gb-ui.css'],
      extraCss: noteExportCss(vertical),
    });
  }

  // --- データベース ---
  async function _exportDatabase() {
    const table = document.getElementById('pivot-table');
    if (!table) { showStatus('シートが開かれていません', true); return null; }
    // テーブルの列幅を computed value で固定化
    // preTransform 実行前にオリジナルの測定値を収集する（クローンは未アタッチのため getComputedStyle が使えない）
    const origCells = table.querySelectorAll('th, td');
    const cellWidths = Array.from(origCells).map(cell => cell.getBoundingClientRect().width);
    // ステータスバッジの色もオリジナルから収集
    const origBadges = table.querySelectorAll('[class*="status-"]');
    const badgeStyles = Array.from(origBadges).map(badge => {
      const cs = getComputedStyle(badge);
      return { bg: cs.backgroundColor, color: cs.color };
    });
    const preTransform = (clone) => {
      const cloneCells = clone.querySelectorAll('th, td');
      cellWidths.forEach((w, i) => {
        if (cloneCells[i]) {
          cloneCells[i].style.width = w + 'px';
          cloneCells[i].style.minWidth = w + 'px';
        }
      });
      // ステータスバッジの色をインライン化（事前収集した値を使用）
      const cloneBadges = clone.querySelectorAll('[class*="status-"]');
      cloneBadges.forEach((badge, i) => {
        if (badgeStyles[i]) {
          badge.style.backgroundColor = badgeStyles[i].bg;
          badge.style.color = badgeStyles[i].color;
        }
      });
    };
    return exportToHtml(table, {
      title: _getViewTitle('database'),
      cssFiles: ['gb-tools.css', 'gb-ui.css'],
      extraCss: `
        table { border-collapse: collapse; table-layout: fixed; width: 100%; }
        th, td { border: 1px solid var(--border, #333); padding: 4px 8px; }
        thead { position: static; }
        body { padding: 16px; }
      `,
      preTransform,
      embedImages: false,
    });
  }

  // --- CSV ---
  async function _exportCsv() {
    const container = document.getElementById('csv-table-container');
    if (!container) { showStatus('CSVが開かれていません', true); return null; }
    const table = container.querySelector('table');
    if (!table) { showStatus('CSVテーブルが見つかりません', true); return null; }
    return exportToHtml(table, {
      title: _getViewTitle('csv'),
      extraCss: `
        table { border-collapse: collapse; table-layout: auto; }
        th, td { border: 1px solid var(--border, #333); padding: 4px 8px; white-space: pre-wrap; }
        thead th { background: var(--bg2, #252525); position: static; }
        body { padding: 16px; }
      `,
      embedImages: false,
    });
  }

  // --- スマートDB ---
  async function _exportSmartDb() {
    if (typeof getSmartDbActiveView === 'function' && getSmartDbActiveView() === 'dashboard') {
      const dashEl = document.getElementById('smart-db-dashboard-area');
      if (!dashEl) { showStatus('スマートシートが開かれていません', true); return null; }
      return exportToHtml(dashEl, {
        title: _getViewTitle('smart-db'),
        cssFiles: ['gb-tools.css', 'gb-ui.css'],
        extraCss: 'body { padding: 16px; }',
        embedImages: false,
      });
    }
    const table = document.getElementById('smart-db-table');
    if (!table) { showStatus('スマートシートが開かれていません', true); return null; }
    return exportToHtml(table, {
      title: _getViewTitle('smart-db'),
      cssFiles: ['gb-tools.css', 'gb-ui.css'],
      extraCss: `
        table { border-collapse: collapse; table-layout: auto; width: 100%; }
        th, td { border: 1px solid var(--border, #333); padding: 4px 8px; }
        thead { position: static; }
        body { padding: 16px; }
      `,
      embedImages: false,
    });
  }

  // --- カレンダー ---
  async function _exportCalendar() {
    const calIframe = document.querySelector('#calendar-container iframe, iframe[src*="calendar"]');
    const calRoot = document.querySelector('.gb-cal-root');
    if (!calIframe?.contentDocument && !calRoot) {
      showStatus('カレンダーの内容を取得できません', true);
      return null;
    }
    if (calRoot) {
      return exportToHtml(calRoot, {
        title: 'カレンダー',
        cssFiles: ['gb-tools.css', 'gb-ui.css'],
        extraCss: 'body { padding: 16px; }',
        embedImages: false,
      });
    }
    const calBody = calIframe.contentDocument.body;
    if (!calBody) { showStatus('カレンダーが読み込まれていません', true); return null; }
    // カレンダーiframe内のスタイルも取得
    let calCss = '';
    for (const sheet of calIframe.contentDocument.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          calCss += rule.cssText + '\n';
        }
      } catch { /* CORS制約の場合は無視 */ }
    }
    return exportToHtml(calBody, {
      title: 'カレンダー',
      extraCss: calCss + '\nbody { padding: 16px; }',
      embedImages: false,
    });
  }

  // --- ボード ---
  // 座標が負値を含む絶対配置カード + SVGオーバーレイという構造上、そのまま複製すると
  // 表示位置がずれる。PNG出力 (_bdExportImageBounds / _bdCreateExportStage, gb-canvas-features.part02.js)
  // と同じ「全カード・全ライン・全フレームの外接矩形を求めて原点(0,0)基準に平行移動する」
  // 方式を踏襲し、bounds計算は既存関数をそのまま再利用する（重複実装を避ける）。
  async function _exportBoard() {
    const canvasEl = document.getElementById('bd-canvas');
    if (!canvasEl) { showStatus('ボードが開かれていません', true); return null; }
    const bounds = (typeof _bdExportImageBounds === 'function') ? _bdExportImageBounds() : null;
    if (!bounds) { showStatus('ボードにトピックがありません', true); return null; }
    return exportToHtml(canvasEl, {
      title: _getViewTitle('board'),
      cssFiles: ['gb-tools.css', 'gb-ui.css'],
      extraCss: 'body { padding: 16px; }',
      preTransform: (clone) => {
        // #bd-canvas クローン自身を bounds サイズの静的コンテナ化する
        clone.style.position = 'relative';
        clone.style.flex = 'none';
        clone.style.width = bounds.width + 'px';
        clone.style.height = bounds.height + 'px';
        clone.style.overflow = 'hidden';
        const worldClone = clone.querySelector('[data-bd-role="world"]');
        if (!worldClone) return;
        // #bd-world クローンは現在のpan/zoomのtransformを引き継いでいるため上書きし、
        // bounds.x0/y0 分だけ平行移動して負座標のカードも可視領域に収める
        worldClone.style.position = 'absolute';
        worldClone.style.left = '0';
        worldClone.style.top = '0';
        worldClone.style.transformOrigin = '0 0';
        worldClone.style.transform = `translate(${-bounds.x0}px, ${-bounds.y0}px)`;
        worldClone.querySelectorAll('[data-bd-role="svg"]').forEach(svg => {
          svg.setAttribute('width', String(bounds.width));
          svg.setAttribute('height', String(bounds.height));
          svg.style.width = bounds.width + 'px';
          svg.style.height = bounds.height + 'px';
          svg.style.overflow = 'visible';
        });
        // 選択中カードのリサイズハンドル・選択枠・選択ハイライトは静的出力に不要なので除去
        const resizeLayer = worldClone.querySelector('[data-bd-role="resize-layer"]');
        if (resizeLayer) resizeLayer.innerHTML = '';
        clone.querySelectorAll('.bd-selected').forEach(el => el.classList.remove('bd-selected'));
      },
    });
  }

  // ================================================================
  // Public API
  // ================================================================

  return {
    exportToHtml,
    exportCurrentView,
    publishCurrentView,
    cloneAndClean,
    convertDataRuby,
    noteExportCss,
    collectCssVars,
    embedFont,
    embedImages,
    saveWithDialog,
    buildHtml,
    getStaticCss,
    fetchCss,
    entityLayoutExportOptions,
  };

})();
