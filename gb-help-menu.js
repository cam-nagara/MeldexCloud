/* Meldex help menu and About dialog */

function _meldexHelpItems() {
  return [
    { label: '基本', type: 'heading' },
    { label: 'クイックスタート', icon: 'rocket', type: 'manual', title: 'クイックスタート', path: 'マニュアル/01_はじめに/クイックスタート.md' },
    { label: 'マニュアル', icon: 'bookOpen', type: 'manual', title: 'Meldex マニュアル', path: 'マニュアル/Meldex マニュアル.md' },
    { label: 'Q&A', icon: 'helpCircle', type: 'manual', title: 'よくある質問', path: 'マニュアル/04_サポート/よくある質問.md' },
    { type: 'separator' },
    { label: 'LLM / チャット', type: 'heading' },
    { label: 'LLMプラン比較・料金ガイド', icon: 'externalLink', type: 'external', url: 'https://www.notion.so/GelBoard-LLM-2026-3-e8f290d995ad45edb8363f3a0f60cf07' },
    { label: 'チャットLLM ツールガイド', icon: 'fileText', type: 'manual', title: 'チャットLLM ツールガイド', path: 'マニュアル/03_設定と連携/チャットLLM ツールガイド.md' },
    { label: 'LLMプライバシーガイド', icon: 'eyeOff', type: 'manual', title: 'LLMプライバシーガイド', path: 'マニュアル/03_設定と連携/LLMプライバシーガイド.md' },
    { label: 'チャットルール', icon: 'clipboardList', type: 'action', action: 'chatRules' },
    { type: 'separator' },
    { label: '拡張機能', type: 'heading' },
    { label: 'Chrome拡張機能の設定', icon: 'puzzle', type: 'manual', title: 'Chrome拡張機能の設定', path: 'マニュアル/03_設定と連携/Chrome拡張機能の設定.md' },
    { label: '画像ツールの設定', icon: 'image', type: 'manual', title: '画像ツールの設定', path: 'マニュアル/03_設定と連携/画像ツールの設定.md' },
    { label: 'CalDAVカレンダー同期の設定', icon: 'calendarDays', type: 'manual', title: 'CalDAVカレンダー同期の設定', path: 'マニュアル/03_設定と連携/CalDAVカレンダー同期の設定.md' },
    { type: 'separator' },
    { label: '更新履歴', icon: 'history', type: 'changelog' },
    { label: '診断情報をエクスポート', icon: 'lifeBuoy', type: 'action', action: 'diagnostics' },
    { label: 'Meldexについて', icon: 'info', type: 'about' },
  ];
}

function _closeMeldexHelpMenu() {
  document.querySelectorAll('.meldex-help-menu').forEach(el => el.remove());
}

function _openMeldexHelpManual(item) {
  _closeMeldexHelpMenu();
  const fullPath = (_homeFolderPath || '').replace(/[\\/]$/, '') + '/' + item.path;
  if (typeof openPage === 'function') openPage(item.title || item.label, fullPath);
}

function _openMeldexHelpExternal(item) {
  _closeMeldexHelpMenu();
  if (!item.url) return;
  window.open(item.url, '_blank', 'noopener');
}

function _runMeldexHelpAction(item) {
  _closeMeldexHelpMenu();
  if (item.action === 'chatRules') {
    if (typeof showChatRulesDialog === 'function') showChatRulesDialog();
    else if (typeof openKnowledgeHomeView === 'function') openKnowledgeHomeView('rules');
  } else if (item.action === 'diagnostics') {
    window.MeldexDiagnostics?.exportDiagnostics?.().catch(err => {
      if (typeof showStatus === 'function') showStatus('診断情報の作成に失敗しました: ' + (err?.message || err), true);
    });
  }
}

function _resolveMeldexHelpMenuAnchor(anchor) {
  return anchor?.closest?.('#left-chrome-help, #left-chrome-floating-help') || anchor;
}

function _isMeldexLeftChromeHelpAnchor(anchor) {
  return !!anchor?.closest?.('#left-chrome-help, #left-chrome-floating-help');
}

function _meldexFixedPositionScale() {
  const fallback = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1);
  try {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:100px;height:100px;visibility:hidden;pointer-events:none;z-index:-1;';
    document.body.appendChild(probe);
    const rect = probe.getBoundingClientRect();
    probe.remove();
    const scale = rect.width / 100;
    return Number.isFinite(scale) && scale > 0 ? scale : fallback;
  } catch {
    return fallback || 1;
  }
}

function _positionMeldexHelpMenuFromLeftChrome(menu, rect) {
  const scale = _meldexFixedPositionScale();
  const visualViewport = window.visualViewport;
  const vw = (visualViewport?.width || window.innerWidth || document.documentElement.clientWidth) / scale;
  const vh = (visualViewport?.height || window.innerHeight || document.documentElement.clientHeight) / scale;
  const gap = 8;
  const ar = {
    left: rect.left / scale,
    right: rect.right / scale,
    top: rect.top / scale,
    bottom: rect.bottom / scale,
  };
  menu.style.visibility = 'hidden';
  menu.style.right = '';
  menu.style.bottom = '';
  if (!menu.parentNode) document.body.appendChild(menu);
  const pw = menu.offsetWidth || 260;
  const ph = menu.offsetHeight || 320;
  let left = ar.right + gap;
  if (left + pw > vw - gap) left = Math.max(gap, ar.left - pw - gap);
  if (left < gap) left = gap;
  let top = ar.bottom - ph;
  if (top + ph > vh - gap) top = Math.max(gap, vh - ph - gap);
  if (top < gap) top = gap;
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  menu.style.visibility = 'visible';
}

function _positionMeldexHelpMenu(menu, anchor) {
  const anchorEl = _resolveMeldexHelpMenuAnchor(anchor);
  const rect = anchorEl?.getBoundingClientRect?.();
  if (rect) {
    if (_isMeldexLeftChromeHelpAnchor(anchorEl)) {
      _positionMeldexHelpMenuFromLeftChrome(menu, rect);
      return;
    }
    if (typeof positionPopup === 'function') {
      positionPopup(menu, rect, { prefer: 'below' });
      return;
    }
    const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1);
    menu.style.left = Math.max(4, rect.left / z) + 'px';
    menu.style.top = Math.max(4, (rect.bottom + 4) / z) + 'px';
  } else {
    menu.style.left = '8px';
    menu.style.top = '48px';
  }
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
}

function showMeldexHelpMenu(event) {
  const anchor = event?.currentTarget || event?.target;
  _closeMeldexHelpMenu();
  if (typeof window !== 'undefined') window.GBTooltip?.hide?.({ suppressUntilLeave: true });
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu meldex-help-menu';
  menu.style.cssText = 'position:fixed;z-index:100002;min-width:260px;max-height:min(78vh, 560px);overflow:auto;';
  _meldexHelpItems().forEach(item => {
    if (item.type === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'cm-sep';
      menu.appendChild(sep);
      return;
    }
    if (item.type === 'heading') {
      const heading = document.createElement('div');
      heading.style.cssText = 'padding:8px 12px 4px;color:var(--fg2);font-size:11px;font-weight:700;letter-spacing:0;';
      heading.textContent = item.label;
      menu.appendChild(heading);
      return;
    }
    const row = document.createElement('div');
    row.className = 'tree-ctx-item';
    row.style.cssText = 'padding:6px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;';
    row.innerHTML = `<span style="width:16px;height:16px;display:inline-flex;">${lucide(item.icon, 15)}</span><span>${esc(item.label)}</span>`;
    row.addEventListener('click', () => {
      if (item.type === 'manual') _openMeldexHelpManual(item);
      else if (item.type === 'external') _openMeldexHelpExternal(item);
      else if (item.type === 'action') _runMeldexHelpAction(item);
      else if (item.type === 'changelog') showMeldexChangelogDialog();
      else if (item.type === 'about') showMeldexAboutDialog();
    });
    menu.appendChild(row);
  });
  document.body.appendChild(menu);
  replaceIcons(menu);
  _positionMeldexHelpMenu(menu, anchor);
  setTimeout(() => {
    document.addEventListener('pointerdown', function closer(e) {
      if (!menu.contains(e.target) && e.target !== anchor) {
        menu.remove();
        document.removeEventListener('pointerdown', closer);
      }
    });
  }, 0);
}

function showMeldexAboutDialog() {
  _closeMeldexHelpMenu();
  const o = document.createElement('div');
  o.className = 'modal-overlay';
  o.innerHTML = `<div class="modal" style="min-width:520px;max-width:680px;max-height:85vh;overflow-y:auto;">
    <h3 style="display:flex;align-items:center;gap:8px;">${lucide('info',16)} Meldexについて</h3>
    <section class="gb-section gb-section--boxed">
      <div class="gb-section-title">${lucide('info',14)} Meldex BETA</div>
      <div class="gb-section-desc" style="line-height:1.7;">
        複数のアプリが連携して、創作全般を補助する統合ワークスペースです。
      </div>
      <dl class="settings-about-grid" style="margin:12px 0 0;">
        <dt>リリース</dt><dd><span id="settings-about-beta">BETA</span></dd>
        <dt>バージョン</dt><dd><span id="settings-about-version">読み込み中...</span></dd>
        <dt>SemVer</dt><dd><span id="settings-about-semver">読み込み中...</span></dd>
        <dt>コミット</dt><dd><span id="settings-about-commit">読み込み中...</span></dd>
        <dt>ビルド種別</dt><dd><span id="settings-about-variant">読み込み中...</span></dd>
        <dt>同意設定</dt><dd><span id="settings-about-consent-status">確認中...</span></dd>
        <dt>配布者</dt><dd>cam-nagara / Meldex 開発者</dd>
        <dt>公式URL</dt><dd><a href="https://github.com/cam-nagara/Meldex" target="_blank" rel="noopener">https://github.com/cam-nagara/Meldex</a></dd>
        <dt>問い合わせ</dt><dd>GitHub Issues または Meldex ベータ配布ページに記載された連絡先</dd>
      </dl>
      <div class="settings-about-muted" style="margin-top:12px;">
        送信可否は「設定 > フィードバック」で変更できます。
      </div>
    </section>
    <section class="gb-section gb-section--boxed">
      <div class="gb-section-title">OSS クレジット</div>
      <ul class="settings-about-credit-list">
        <li>Meldex 本体 (MIT License)</li>
        <li>Icons by <a href="https://lucide.dev/" target="_blank" rel="noopener" data-e2e-id="settings-about-credit-lucide">Lucide</a> (ISC License)</li>
        <li>Font: <a href="https://fonts.google.com/noto/specimen/Noto+Sans+JP" target="_blank" rel="noopener" data-e2e-id="settings-about-credit-noto-sans-jp">Noto Sans JP</a> (SIL OFL 1.1)</li>
        <li>Emoji Font: <a href="https://github.com/googlefonts/noto-emoji" target="_blank" rel="noopener" data-e2e-id="settings-about-credit-noto-emoji">Google Noto Emoji</a> (SIL OFL 1.1)</li>
        <li>Emoji by <a href="https://github.com/twitter/twemoji" target="_blank" rel="noopener" data-e2e-id="settings-about-credit-twemoji">Twemoji</a> (CC-BY 4.0)</li>
        <li>PDF rendering by <a href="https://github.com/mozilla/pdf.js" target="_blank" rel="noopener" data-e2e-id="settings-about-credit-pdfjs">PDF.js</a> (Apache 2.0)</li>
        <li>Image export by <a href="https://github.com/niklasvh/html2canvas" target="_blank" rel="noopener" data-e2e-id="settings-about-credit-html2canvas">html2canvas</a> (MIT)</li>
        <li>Backend libraries: FastAPI, Starlette, Uvicorn, Pydantic, PyYAML, Pillow, openpyxl, python-docx, python-multipart</li>
        <li>LLM / API SDKs: Anthropic, OpenAI, Google Gen AI, Google API Client, Notion SDK</li>
        <li>CalDAV server: <a href="https://github.com/Kozea/Radicale" target="_blank" rel="noopener">Radicale</a> (GPLv3)</li>
        <li>Tray / hotkey: <a href="https://github.com/moses-palmer/pystray" target="_blank" rel="noopener">pystray</a> / <a href="https://github.com/moses-palmer/pynput" target="_blank" rel="noopener">pynput</a> (LGPLv3)</li>
      </ul>
      <div class="settings-about-muted" style="margin-top:10px;">
        詳細は <code>LICENSE</code>, <code>THIRD-PARTY.md</code>, <code>CREDITS.md</code>, <code>fonts/OFL.txt</code> を参照してください。
      </div>
      <div class="btn-row" style="margin-top:10px;justify-content:flex-start;">
        <button type="button" data-action="window.open('PRIVACY.md','_blank','noopener')">プライバシーポリシー</button>
        <button type="button" data-action="window.open('TERMS-OF-USE.md','_blank','noopener')">利用規約</button>
        <button type="button" data-action="window.open('THIRD-PARTY.md','_blank','noopener')">OSSライセンス</button>
        <button type="button" data-action="window.MeldexDiagnostics?.exportDiagnostics?.()">診断情報を保存</button>
      </div>
    </section>
    <div class="btn-row" style="margin-top:12px;">
      <button data-action="this.closest('.modal-overlay').remove()">閉じる</button>
    </div>
  </div>`;
  document.body.appendChild(o);
  replaceIcons(o);
  if (typeof refreshMeldexAboutPanel === 'function') refreshMeldexAboutPanel(o);
}

async function showMeldexChangelogDialog() {
  _closeMeldexHelpMenu();
  const o = document.createElement('div');
  o.className = 'modal-overlay';
  o.innerHTML = `<div class="modal" style="min-width:520px;max-width:760px;max-height:85vh;">
    <h3 style="display:flex;align-items:center;gap:8px;">${lucide('history',16)} 更新履歴</h3>
    <pre id="meldex-changelog-body" style="flex:1;overflow:auto;white-space:pre-wrap;background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:12px;font-size:12px;line-height:1.6;color:var(--fg);">読み込み中...</pre>
    <div class="btn-row" style="margin-top:12px;">
      <button data-action="this.closest('.modal-overlay').remove()">閉じる</button>
    </div>
  </div>`;
  document.body.appendChild(o);
  replaceIcons(o);
  const body = o.querySelector('#meldex-changelog-body');
  try {
    const res = await fetch('CHANGELOG.md', { cache: 'no-store' });
    body.textContent = res.ok ? await res.text() : '更新履歴を読み込めませんでした。';
  } catch (e) {
    body.textContent = '更新履歴を読み込めませんでした。';
  }
}
