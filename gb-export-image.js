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
  // html2canvas フォールバック
  // ================================================================

  async function _loadHtml2Canvas() {
    if (window.html2canvas) return window.html2canvas;
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
    const canvas = await h2c(contentEl, { scale, useCORS: true, logging: false });
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

      if (!opts.useFallbackOnly && typeof MeldexExportHtml !== 'undefined') {
        try {
          // 方式C: HTML生成 → サーバーサイドレンダリング
          const html = await MeldexExportHtml.exportToHtml(contentEl, opts.htmlOptions || {});
          blob = await _exportViaServer(html, {
            dpr: opts.dpr,
            width: opts.width,
            contentWidth: contentEl.scrollWidth,
          });
        } catch (serverErr) {
          console.warn('[export-image] server render failed, falling back to html2canvas:', serverErr);
        }
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
      'smart-db': () => (typeof getSmartDbActiveView === 'function' && getSmartDbActiveView() === 'dashboard')
        ? document.getElementById('smart-db-dashboard-area')
        : document.getElementById('smart-db-table'),
      calendar: () => {
        const iframe = document.querySelector('#calendar-container iframe, iframe[src*="calendar"]');
        return document.querySelector('.gb-cal-root') || iframe?.contentDocument?.body || null;
      },
    };

    const getEl = targets[viewType];
    if (!getEl) {
      showStatus('このビューのPNG出力は未対応です', true);
      return;
    }

    const el = getEl();
    if (!el) {
      showStatus('エクスポート対象が見つかりません', true);
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
      'smart-db': () => (state?.currentSmartDb?.name || 'スマートシート') + (typeof getSmartDbActiveView === 'function' && getSmartDbActiveView() === 'dashboard' ? ' ダッシュボード' : ''),
      calendar: () => 'カレンダー',
    };

    const title = (titleMap[viewType] || (() => '無題'))();

    // シナリオは特別処理: rAF×2 で縦書きレンダリング完了を待つ
    if (viewType === 'scriptnote') {
      const editor = typeof _sn2GetActiveEditor === 'function' ? _sn2GetActiveEditor() : null;
      if (editor) {
        try { editor._syncAllFromDom?.(); } catch {}
        try { editor._render(); } catch {}
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
    }

    await exportToPng(el, {
      title,
      htmlOptions: _getHtmlOptionsForView(viewType),
    });
  }

  /** ビューごとの HTML 出力オプション */
  function _getHtmlOptionsForView(viewType) {
    switch (viewType) {
      case 'page':
        return {
          cssFiles: ['gb-editor.css'],
          extraCss: `
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
          cssFiles: ['gb-database.css', 'gb-ui.css'],
          extraCss: `
            table { border-collapse: collapse; table-layout: fixed; width: 100%; }
            th, td { border: 1px solid var(--border, #333); padding: 4px 8px; }
            body { padding: 16px; }
          `,
          embedImages: false,
        };
      case 'smart-db':
        return {
          cssFiles: ['gb-tools.css', 'gb-ui.css'],
          extraCss: `
            table { border-collapse: collapse; table-layout: auto; width: 100%; }
            th, td { border: 1px solid var(--border, #333); padding: 4px 8px; }
            body { padding: 16px; }
          `,
          embedImages: false,
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
  };

})();
