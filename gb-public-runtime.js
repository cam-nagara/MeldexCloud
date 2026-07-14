/* 公開 HTML ランタイム生成
 *
 * 役割: 現在のビュー (page/database/csv/smart-db/calendar/entity) を
 *   現テーマを完全再現した静的 HTML としてエクスポートする。
 *   + 編集不可 (input を span 化 / contenteditable 除去)
 *   + 画像埋込 / フォント埋込 / CSS 変数取込
 *   + フォーム送信ランタイム (現在表示がフォームビューの場合のみ注入)
 *
 * 生成経路は MeldexExportHtml の共通ヘルパを再利用し、`buildHtml` と
 * DOM パイプライン (cloneAndClean / convertDataRuby / embedImages / embedFont)
 * を統一する。旧 payload-rebuild 方式 (固定ライトテーマ) は廃止。
 */

const MeldexPublicRuntime = (() => {
  function _jsonForScript(payload) {
    // `<` のみエスケープして `</script>` で DOM が閉じないようにする。
    // JSON は正しい文字列リテラルを含むので二重引用符はそのまま。
    return JSON.stringify(payload || {}).replace(/</g, '\\u003c');
  }

  // ==========================================================================
  // ランタイムスクリプト: 公開 HTML に注入されてクライアントで動作する。
  //   - フォーム送信 (form[data-publish-form] があれば有効化)
  //   - 現バージョンではタブ切替はサポートしない (単一ビュー公開)
  // ==========================================================================
  // ランタイムスクリプト: 公開 HTML 内でフォーム入力を収集し POST する。
  // - checkbox: チェック状態を 'true' / 'false' の文字列で明示送信 (未チェックも区別)
  // - image (file): 各ファイルを base64 data URL に読み込み、バックエンド契約の
  //   [{filename, type, data_url}, ...] 形式 JSON 文字列で送信
  // - その他: input.value をそのまま送信
  // 入力種別は _buildFormInputRow が付与する data-form-type で判別。
  const RUNTIME_SCRIPT = "(function(){\n"
    + "  function init() {\n"
    + "  var cfgEl = document.getElementById('meldex-publish-cfg');\n"
    + "  var cfg = {};\n"
    + "  try { cfg = JSON.parse(cfgEl && cfgEl.textContent || '{}'); } catch (e) {}\n"
    + "  var form = document.querySelector('form[data-publish-form]');\n"
    + "  if (!form) return;\n"
    + "  var msg = document.getElementById('meldex-publish-msg');\n"
    + "  function successMessage() { return cfg.success_message || cfg.successMessage || '送信しました'; }\n"
    + "  function pad2(value) { return String(value).padStart(2, '0'); }\n"
    + "  function templateEntityName(template) {\n"
    + "    var d = new Date();\n"
    + "    return String(template || 'フォーム送信 {yyyy}-{MM}-{dd} {HH}:{mm}')\n"
    + "      .replace(/\\{yyyy\\}/g, String(d.getFullYear()))\n"
    + "      .replace(/\\{MM\\}/g, pad2(d.getMonth() + 1))\n"
    + "      .replace(/\\{dd\\}/g, pad2(d.getDate()))\n"
    + "      .replace(/\\{HH\\}/g, pad2(d.getHours()))\n"
    + "      .replace(/\\{mm\\}/g, pad2(d.getMinutes()))\n"
    + "      .replace(/\\{ss\\}/g, pad2(d.getSeconds()));\n"
    + "  }\n"
    + "  function buildEntityName(fields) {\n"
    + "    var source = cfg.form_entity_name_source || cfg.formEntityNameSource || null;\n"
    + "    if (!source || typeof source !== 'object') return '';\n"
    + "    if (source.kind === 'property') {\n"
    + "      var prop = String(source.property || '');\n"
    + "      return prop ? String(fields[prop] || '').trim().slice(0, 80) : '';\n"
    + "    }\n"
    + "    if (source.kind === 'timestamp') return templateEntityName('フォーム送信 {yyyy}-{MM}-{dd} {HH}-{mm}-{ss}');\n"
    + "    if (source.kind === 'template') return templateEntityName(source.template || '');\n"
    + "    return '';\n"
    + "  }\n"
    + "  function postFeedbackToGoogle(payload) {\n"
    + "    var url = String(cfg.feedback_google_url || '').trim();\n"
    + "    if (!cfg.feedback_relay_enabled || !/^https:\\/\\/script\\.google\\.com\\/macros\\/s\\//.test(url)) return;\n"
    + "    try {\n"
    + "      fetch(url, {\n"
    + "        method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' },\n"
    + "        body: JSON.stringify({ app: 'Meldex', kind: 'feedback', sheet: cfg.feedback_google_sheet || 'feedback', payload: payload, sentAt: new Date().toISOString() })\n"
    + "      });\n"
    + "    } catch (err) {}\n"
    + "  }\n"
    + "  function readFileAsDataUrl(file) {\n"
    + "    return new Promise(function (resolve, reject) {\n"
    + "      var r = new FileReader();\n"
    + "      r.onload = function () { resolve(String(r.result || '')); };\n"
    + "      r.onerror = function () { reject(r.error || new Error('read failed')); };\n"
    + "      r.readAsDataURL(file);\n"
    + "    });\n"
    + "  }\n"
    + "  async function collectFields() {\n"
    + "    var fields = {};\n"
    + "    // name 属性付きの入力要素を全部見る (checkbox / file も含めて明示的に処理)\n"
    + "    var els = form.querySelectorAll('input[name], textarea[name], select[name]');\n"
    + "    for (var i = 0; i < els.length; i += 1) {\n"
    + "      var el = els[i];\n"
    + "      var name = el.getAttribute('name');\n"
    + "      if (!name) continue;\n"
    + "      var type = (el.dataset && el.dataset.formType) || el.type || 'text';\n"
    + "      if (type === 'checkbox' || el.type === 'checkbox') {\n"
    + "        fields[name] = el.checked ? 'true' : 'false';\n"
    + "        continue;\n"
    + "      }\n"
    + "      if (type === 'image' || el.type === 'file') {\n"
    + "        var files = Array.from(el.files || []);\n"
    + "        var items = [];\n"
    + "        for (var j = 0; j < files.length; j += 1) {\n"
    + "          var f = files[j];\n"
    + "          try {\n"
    + "            var dataUrl = await readFileAsDataUrl(f);\n"
    + "            items.push({ filename: f.name, type: f.type || '', data_url: dataUrl });\n"
    + "          } catch (err) { throw new Error('画像を読み込めませんでした: ' + (f && f.name || '添付ファイル')); }\n"
    + "        }\n"
    + "        fields[name] = JSON.stringify(items);\n"
    + "        continue;\n"
    + "      }\n"
    + "      if (el.type === 'radio') {\n"
    + "        if (el.checked) fields[name] = el.value;\n"
    + "        else if (!(name in fields)) fields[name] = '';\n"
    + "        continue;\n"
    + "      }\n"
    + "      fields[name] = el.value != null ? String(el.value) : '';\n"
    + "    }\n"
    + "    return fields;\n"
    + "  }\n"
    + "  form.addEventListener('submit', async function (e) {\n"
    + "    e.preventDefault();\n"
    + "    if (!cfg.form_submit_enabled) { if (msg) msg.textContent = '現在受付停止中です'; return; }\n"
    + "    if (msg) msg.textContent = '送信中...';\n"
    + "    var fields = {};\n"
    + "    try { fields = await collectFields(); } catch (err) {\n"
    + "      if (msg) msg.textContent = '入力収集失敗: ' + (err && err.message || err);\n"
    + "      return;\n"
    + "    }\n"
    + "    var body = {\n"
    + "      db_path: cfg.db_path || '',\n"
    + "      token: cfg.form_submit_token || '',\n"
    + "      form_id: cfg.form_id || '',\n"
    + "      name: buildEntityName(fields),\n"
    + "      fields: fields\n"
    + "    };\n"
    + "    try {\n"
    + "      var res = await fetch(cfg.submit_url || '/api/public-form/submit', {\n"
    + "        method: 'POST', headers: { 'Content-Type': 'application/json' },\n"
    + "        body: JSON.stringify(body)\n"
    + "      });\n"
    + "      if (msg) msg.textContent = res.ok ? successMessage() : ('送信失敗 (' + res.status + ')');\n"
    + "      if (res.ok) {\n"
    + "        postFeedbackToGoogle({ dbPath: body.db_path, formId: body.form_id, fields: fields, source: 'public-form', userAgent: navigator.userAgent || '' });\n"
    + "        form.reset();\n"
    + "      }\n"
    + "    } catch (err) {\n"
    + "      if (msg) msg.textContent = '送信失敗: ' + (err && err.message || err);\n"
    + "    }\n"
    + "  });\n"
    + "  }\n"
    + "  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();\n"
    + "})();";

  // ==========================================================================
  // ビュータイプごとの入力要素取得・CSS ファイル・追加 CSS を決定
  // ==========================================================================
  function _resolveViewDef(viewType) {
    if (viewType === 'page' || viewType === 'entity') {
      const el = viewType === 'entity'
        ? document.getElementById('entity-view')
        : document.getElementById('page-content');
      return {
        el,
        cssFiles: ['gb-tools.css', 'gb-ui.css'],
        extraCss:
          '#page-content, [id="page-content"], #entity-view { padding: 16px 60px; line-height: 1.7; max-width: 900px; margin: 0 auto; }\n'
          + '#entity-view { box-sizing: border-box; }\n'
          + 'ruby { ruby-position: over; }\n'
          + 'rt { font-size: 0.55em; line-height: 1; color: inherit; opacity: 0.75; }\n',
        notFound: 'ノートが開かれていません',
      };
    }
    if (viewType === 'database') {
      // 現在の DB ビューモードで分岐: フォームビューならフォームを、それ以外はテーブルを公開
      const dbPath = (typeof state !== 'undefined' && state.currentDbPath) || '';
      const viewMode = (typeof getCurrentViewMode === 'function' && dbPath) ? getCurrentViewMode(dbPath) : (state?.view || 'pivot');
      if (viewMode === 'form') {
        // 公開用フォームを新規構築 (_buildFormAnswerPanel で publicMode=true 指定)
        const props = state.pivotData?.properties || [];
        const propTypes = (typeof getPropertyTypes === 'function') ? getPropertyTypes(dbPath) || {} : {};
        const formCfg = (typeof getActiveFormConfig === 'function')
          ? getActiveFormConfig(dbPath, props, propTypes)
          : null;
        if (!formCfg) return { el: null, cssFiles: [], extraCss: '', notFound: 'フォーム設定を取得できません' };
        let formEl = null;
        if (typeof _buildFormAnswerPanel === 'function') {
          formEl = _buildFormAnswerPanel(dbPath, formCfg, propTypes, true);
        }
        if (!formEl) return { el: null, cssFiles: [], extraCss: '', notFound: 'フォームを構築できません' };
        // 送信ランタイム検出用マーカー
        formEl.setAttribute('data-publish-form', '1');
        // ランタイムスクリプトが何らかの理由で動作しない場合でも、
        // デフォルト submit によるページリロードを抑止する。
        // action="javascript:void(0)" は form のネイティブ送信を無害化。
        formEl.setAttribute('action', 'javascript:void(0)');
        // DOM に接続しないまま cloneAndClean に渡す
        // （_buildFormAnswerPanel は computed style に依存しないため DOM 接続不要）
        return {
          el: formEl,
          preserveFormControls: true,
          runtimeExtras: {
            form_id: formCfg?.id || '',
            success_message: formCfg?.successMessage || '送信しました',
            feedback_relay_enabled: !!formCfg?.betaFeedbackRelay,
            ...(formCfg?.entityNameProp ? { form_entity_name_source: { kind: 'property', property: formCfg.entityNameProp } } : {}),
          },
          cssFiles: ['gb-tools.css', 'gb-ui.css'],
          extraCss:
            'body { padding: 24px; }\n'
            + 'form[data-publish-form] { max-width: 680px; margin: 0 auto; }\n'
            // getStaticCss の `input,textarea,select { display:none !important; }` を
            // 高特異度セレクタで上書き (pointer-events/cursor も有効化)
            + 'form[data-publish-form] input,\n'
            + 'form[data-publish-form] textarea,\n'
            + 'form[data-publish-form] select {\n'
            + '  display: revert !important;\n'
            + '  pointer-events: auto !important;\n'
            + '  cursor: text !important;\n'
            + '}\n'
            + 'form[data-publish-form] input[type="checkbox"],\n'
            + 'form[data-publish-form] input[type="radio"] { cursor: pointer !important; }\n'
            + 'form[data-publish-form] button,\n'
            + 'form[data-publish-form] button[type="submit"] {\n'
            + '  display: revert !important;\n'
            + '  pointer-events: auto !important;\n'
            + '  cursor: pointer !important;\n'
            + '  opacity: 1 !important;\n'
            + '}\n',
          notFound: 'フォームを構築できません',
        };
      }
      return {
        el: document.getElementById('pivot-table'),
        cssFiles: ['gb-tools.css', 'gb-ui.css'],
        extraCss:
          'body { padding: 16px; }\n'
          + 'table { border-collapse: collapse; table-layout: fixed; width: 100%; }\n'
          + 'th, td { border: 1px solid var(--border, #333); padding: 4px 8px; }\n'
          + 'thead { position: static; }\n',
        notFound: 'シートが開かれていません',
        preTransform: _preTransformDatabaseTable,
      };
    }
    if (viewType === 'csv') {
      const container = document.getElementById('csv-table-container');
      return {
        el: container ? container.querySelector('table') : null,
        cssFiles: [],
        extraCss:
          'body { padding: 16px; }\n'
          + 'table { border-collapse: collapse; table-layout: auto; }\n'
          + 'th, td { border: 1px solid var(--border, #333); padding: 4px 8px; white-space: pre-wrap; }\n'
          + 'thead th { background: var(--bg2, #252525); position: static; }\n',
        notFound: 'CSV が開かれていません',
      };
    }
    if (viewType === 'smart-db') {
      const el = (typeof getSmartDbActiveView === 'function' && getSmartDbActiveView() === 'dashboard')
        ? document.getElementById('smart-db-dashboard-area')
        : document.getElementById('smart-db-table');
      return {
        el,
        cssFiles: ['gb-tools.css', 'gb-ui.css'],
        extraCss:
          'body { padding: 16px; }\n'
          + 'table { border-collapse: collapse; table-layout: auto; width: 100%; }\n'
          + 'th, td { border: 1px solid var(--border, #333); padding: 4px 8px; }\n',
        notFound: 'スマートシートが開かれていません',
      };
    }
    if (viewType === 'calendar') {
      const calRoot = document.querySelector('.gb-cal-root');
      return {
        el: calRoot,
        cssFiles: ['gb-tools.css', 'gb-ui.css'],
        extraCss: 'body { padding: 16px; }\n',
        notFound: 'カレンダーが開かれていません',
      };
    }
    return { el: null, cssFiles: [], extraCss: '', notFound: 'この種別は公開 HTML 未対応です' };
  }

  // DB テーブル: 列幅とステータスバッジ色を computed value でインライン化
  // (これがないとクローン側では getComputedStyle が効かない)
  function _preTransformDatabaseTable(originalEl, clone) {
    if (!originalEl || !clone) return;
    const origCells = originalEl.querySelectorAll('th, td');
    const cellWidths = Array.from(origCells).map(c => c.getBoundingClientRect().width);
    const cloneCells = clone.querySelectorAll('th, td');
    cellWidths.forEach((w, i) => {
      if (cloneCells[i]) {
        cloneCells[i].style.width = w + 'px';
        cloneCells[i].style.minWidth = w + 'px';
      }
    });
    const origBadges = originalEl.querySelectorAll('[class*="status-"]');
    const cloneBadges = clone.querySelectorAll('[class*="status-"]');
    origBadges.forEach((b, i) => {
      if (!cloneBadges[i]) return;
      const cs = getComputedStyle(b);
      cloneBadges[i].style.backgroundColor = cs.backgroundColor;
      cloneBadges[i].style.color = cs.color;
    });
  }

  // ==========================================================================
  // 公開 HTML 構築メイン: viewType + publish 設定から自己完結 HTML 文字列を返す
  // ==========================================================================
  async function buildPublishHtml(viewType, publishCfg) {
    publishCfg = publishCfg || {};
    if (typeof MeldexExportHtml === 'undefined') {
      showStatus('HTML 出力エンジンを読み込めませんでした', true);
      return null;
    }
    const def = _resolveViewDef(viewType);
    if (!def.el) {
      showStatus(def.notFound || '公開対象が見つかりません', true);
      return null;
    }
    try {
      // DOM クローン → クリーンアップ → ルビ変換 → preTransform → 画像埋込
      const clone = MeldexExportHtml.cloneAndClean(def.el, {
        preserveFormControls: !!def.preserveFormControls,
      });
      MeldexExportHtml.convertDataRuby(clone);
      if (typeof def.preTransform === 'function') def.preTransform(def.el, clone);
      await MeldexExportHtml.embedImages(clone);

    // CSS: ルート変数 + 追加 CSS ファイル + ビュー固有 CSS + 公開ランタイム CSS
    const varDecls = typeof MeldexExportHtml.collectCssVars === 'function'
      ? MeldexExportHtml.collectCssVars()
      : '';
    let cssText = ':root { ' + varDecls + ' }\n';
    cssText += 'html, body { margin: 0; padding: 0; background: var(--bg, #1e1e1e); color: var(--fg, #d4d4d4);'
      + ' font-family: var(--ui-font, "Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif);'
      + ' font-size: var(--ui-font-size, 15px); }\n';
    for (const f of def.cssFiles) {
      cssText += await MeldexExportHtml.fetchCss(f) + '\n';
    }
    cssText += def.extraCss + '\n';
    // 公開ランタイム用の補助スタイル (メッセージ表示等)
    cssText += '#meldex-publish-msg { margin-top: 10px; color: var(--accent, #4a90d9); font-size: 13px; }\n';

    // フォント埋込 (publish 設定で制御)
    const fontCss = publishCfg.embed_font !== false
      ? await MeldexExportHtml.embedFont()
      : '';

    // ランタイム設定 (def.runtimeExtras があればマージ)
    const runtimeCfg = {
      db_path: publishCfg.db_path || (typeof state !== 'undefined' && state.currentDbPath) || '',
      form_submit_enabled: !!publishCfg.form_submit_enabled,
      form_submit_token: publishCfg.form_submit_token || '',
      form_id: publishCfg.form_id || '',
      success_message: publishCfg.success_message || publishCfg.successMessage || '',
      form_entity_name_source: publishCfg.form_entity_name_source || publishCfg.formEntityNameSource || null,
      feedback_relay_enabled: !!publishCfg.feedback_relay_enabled,
      feedback_google_url: publishCfg.feedback_google_url || (window.MeldexReleaseConfig?.betaFeedback?.googleWebAppUrl || ''),
      feedback_google_sheet: publishCfg.feedback_google_sheet || (window.MeldexReleaseConfig?.betaFeedback?.feedbackSheetName || 'feedback'),
      submit_url: publishCfg.submit_url
        || (publishCfg.server_public_url
          ? String(publishCfg.server_public_url).replace(/\/+$/, '') + '/api/public-form/submit'
          : ''),
      ...(def.runtimeExtras || {}),
    };
    const extraHeadHtml =
      '<script type="application/json" id="meldex-publish-cfg">'
      + _jsonForScript(runtimeCfg)
      + '</script>\n'
      + '<script>' + RUNTIME_SCRIPT + '</script>';

    // body: クローン済み HTML + メッセージ領域
    const bodyHtml = clone.outerHTML + '\n<div id="meldex-publish-msg"></div>';

    const title = publishCfg.title || (typeof _getViewTitle === 'function' ? _getViewTitle(viewType) : 'Meldex');
      return MeldexExportHtml.buildHtml(title, bodyHtml, cssText, fontCss, extraHeadHtml);
    } finally {
      // 画面外に一時配置したフォーム等の仮要素を破棄
      if (def.disposeEl && def.disposeEl.parentNode) {
        try { def.disposeEl.parentNode.removeChild(def.disposeEl); } catch {}
      }
    }
  }

  return {
    buildPublishHtml,
  };
})();
