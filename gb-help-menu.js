/* Meldex help menu and About dialog */

function _meldexHelpItems() {
  return [
    { label: '基本', type: 'heading' },
    { label: 'クイックスタート', icon: 'rocket', type: 'manual', title: 'クイックスタート', path: 'マニュアル/01_はじめに/クイックスタート.md' },
    { label: 'マニュアル', icon: 'bookOpen', type: 'manual', title: 'Meldex マニュアル', path: 'マニュアル/Meldex マニュアル.md' },
    { label: 'Q&A', icon: 'helpCircle', type: 'manual', title: 'よくある質問', path: 'マニュアル/04_サポート/よくある質問.md' },
    { type: 'separator' },
    { label: 'LLM / チャット', type: 'heading' },
    { label: 'LLMの必要性とコスト方針', icon: 'fileText', type: 'manual', title: 'LLMの必要性とコスト方針', path: 'マニュアル/03_設定と連携/LLMの必要性とコスト方針.md' },
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
    { label: 'Meldex（メルデックス）について', icon: 'info', type: 'about' },
  ];
}

function _closeMeldexHelpMenu() {
  document.querySelectorAll('.meldex-help-menu').forEach(el => el.remove());
}

let _meldexHelpDialogReturnFocus = null;

function _meldexHelpDialogOwner(explicitOwner) {
  if (explicitOwner?.isConnected && explicitOwner?.focus) return explicitOwner;
  if (_meldexHelpDialogReturnFocus?.isConnected && _meldexHelpDialogReturnFocus?.focus) return _meldexHelpDialogReturnFocus;
  return _fallbackMeldexHelpMenuAnchor();
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

const MELDEX_HELP_MENU_ANCHOR_SELECTOR = '#left-chrome-help, #left-chrome-floating-help, [data-meldex-help-menu-anchor="1"], [data-action^="showMeldexHelpMenu"]';
const MELDEX_LEFT_CHROME_HELP_ANCHOR_SELECTOR = '#left-chrome-help, #left-chrome-floating-help';

function _isMeldexHelpMenuAnchorVisible(el) {
  if (!el || el.hidden) return false;
  const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  const rect = el.getBoundingClientRect?.();
  if (!rect) return true;
  const viewportWidth = Math.max(document.documentElement?.clientWidth || 0, window.innerWidth || 0);
  const viewportHeight = Math.max(document.documentElement?.clientHeight || 0, window.innerHeight || 0);
  return rect.width > 0
    && rect.height > 0
    && rect.right > 0
    && rect.bottom > 0
    && rect.left < viewportWidth
    && rect.top < viewportHeight;
}

function _fallbackMeldexHelpMenuAnchor() {
  const activeAnchor = document.activeElement?.closest?.(MELDEX_HELP_MENU_ANCHOR_SELECTOR);
  if (_isMeldexHelpMenuAnchorVisible(activeAnchor)) return activeAnchor;
  const selectors = ['#left-chrome-floating-help', '#left-chrome-help'];
  for (const selector of selectors) {
    const el = document.querySelector?.(selector);
    if (_isMeldexHelpMenuAnchorVisible(el)) return el;
  }
  return null;
}

function _resolveMeldexHelpMenuAnchor(anchor) {
  const matched = anchor?.closest?.(MELDEX_HELP_MENU_ANCHOR_SELECTOR);
  if (matched) return matched;
  if (anchor?.getBoundingClientRect) return anchor;
  return _fallbackMeldexHelpMenuAnchor();
}

function _isMeldexLeftChromeHelpAnchor(anchor) {
  return !!anchor?.closest?.(MELDEX_LEFT_CHROME_HELP_ANCHOR_SELECTOR);
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

function _positionMeldexHelpMenuWithoutAnchor(menu) {
  const scale = _meldexFixedPositionScale();
  const visualViewport = window.visualViewport;
  const vw = (visualViewport?.width || window.innerWidth || document.documentElement.clientWidth) / scale;
  const vh = (visualViewport?.height || window.innerHeight || document.documentElement.clientHeight) / scale;
  const gap = 12;
  menu.style.visibility = 'hidden';
  menu.style.right = '';
  menu.style.bottom = '';
  if (!menu.parentNode) document.body.appendChild(menu);
  const pw = menu.offsetWidth || 260;
  const ph = menu.offsetHeight || 320;
  const maxLeft = Math.max(gap, vw - pw - gap);
  const left = Math.min(Math.max(gap, (vw - pw) / 2), maxLeft);
  const maxTop = Math.max(gap, vh - ph - gap);
  const top = Math.min(72, maxTop);
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
    _positionMeldexHelpMenuWithoutAnchor(menu);
    return;
  }
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
}

function showMeldexHelpMenu(event) {
  const anchor = _resolveMeldexHelpMenuAnchor(event?.currentTarget || event?.target);
  _meldexHelpDialogReturnFocus = anchor;
  _closeMeldexHelpMenu();
  if (typeof window !== 'undefined') window.GBTooltip?.hide?.({ suppressUntilLeave: true });
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu meldex-help-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'ヘルプ');
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
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'gb-context-menu-item tree-ctx-item';
    row.setAttribute('role', 'menuitem');
    row.style.cssText = 'width:100%;border:0;background:transparent;text-align:left;padding:6px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;';
    row.innerHTML = `<span style="width:16px;height:16px;display:inline-flex;">${lucide(item.icon, 15)}</span><span>${esc(item.label)}</span>`;
    row.addEventListener('click', () => {
      if (item.type === 'manual') _openMeldexHelpManual(item);
      else if (item.type === 'external') _openMeldexHelpExternal(item);
      else if (item.type === 'action') _runMeldexHelpAction(item);
      else if (item.type === 'changelog') showMeldexChangelogDialog(anchor);
      else if (item.type === 'about') showMeldexAboutDialog(anchor);
    });
    menu.appendChild(row);
  });
  document.body.appendChild(menu);
  replaceIcons(menu);
  _positionMeldexHelpMenu(menu, anchor);
  setTimeout(() => {
    document.addEventListener('pointerdown', function closer(e) {
      if (!menu.contains(e.target) && e.target !== anchor && !anchor?.contains?.(e.target)) {
        menu.remove();
        document.removeEventListener('pointerdown', closer);
      }
    });
  }, 0);
}

function _meldexLegalDocUrl(filename) {
  const name = String(filename || '').replace(/^\/+/, '');
  if (name === 'THIRD-PARTY.md' && window.location?.protocol === 'file:') {
    const path = String(window.location.pathname || '').replace(/\\/g, '/');
    if (/\/app\/Meldex(?:-dev)?\.html$/i.test(path)) return '../THIRD-PARTY.md';
  }
  return name;
}

function _openMeldexLegalDoc(filename) {
  window.open(_meldexLegalDocUrl(filename), '_blank', 'noopener');
}

function showMeldexAboutDialog(returnFocus) {
  _closeMeldexHelpMenu();
  const content = document.createElement('div');
  content.innerHTML = `<section class="gb-section gb-section--boxed">
      <div class="gb-section-title">${lucide('info',14)} Meldex（メルデックス） BETA</div>
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
        <dt>公式URL</dt><dd><a href="https://github.com/cam-nagara/Meldex" target="_blank" rel="noopener" data-e2e-id="settings-about-official-url">https://github.com/cam-nagara/Meldex</a></dd>
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
        <li>CalDAV server: <a href="https://github.com/Kozea/Radicale" target="_blank" rel="noopener" data-e2e-id="settings-about-credit-radicale">Radicale</a> (GPLv3)</li>
        <li>Tray / hotkey: <a href="https://github.com/moses-palmer/pystray" target="_blank" rel="noopener" data-e2e-id="settings-about-credit-pystray">pystray</a> / <a href="https://github.com/moses-palmer/pynput" target="_blank" rel="noopener" data-e2e-id="settings-about-credit-pynput">pynput</a> (LGPLv3)</li>
      </ul>
      <div class="settings-about-muted" style="margin-top:10px;">
        詳細は <code>LICENSE</code>, <code>THIRD-PARTY.md</code>, <code>CREDITS.md</code>, <code>fonts/OFL.txt</code> を参照してください。
      </div>
      <div class="btn-row" style="margin-top:10px;justify-content:flex-start;">
        <button type="button" data-action="_openMeldexLegalDoc('PRIVACY.html')">プライバシーポリシー</button>
        <button type="button" data-action="_openMeldexLegalDoc('TERMS-OF-USE.html')">利用規約</button>
        <button type="button" data-action="_openMeldexLegalDoc('THIRD-PARTY.md')">OSSライセンス</button>
        <button type="button" data-action="window.MeldexDiagnostics?.exportDiagnostics?.()">診断情報を保存</button>
      </div>
    </section>`;
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'gb-btn gb-btn-sm';
  closeButton.dataset.e2eId = 'meldex-about-close';
  closeButton.textContent = '閉じる';
  const modalApi = window.GBUI.createModal({
    id: 'meldex-help-about',
    title: 'Meldex（メルデックス）について',
    body: [...content.childNodes],
    footer: closeButton,
    variant: 'standard',
    geometryKey: 'meldex-help-about',
    minWidth: '0',
    initialFocus: closeButton,
    returnFocus: _meldexHelpDialogOwner(returnFocus),
    closeLabel: 'Meldexについてを閉じる',
    closeOnEsc: true,
    closeOnOverlay: true,
  });
  modalApi.overlay.classList.add('meldex-help-about-overlay');
  modalApi.overlay.dataset.e2eId = 'meldex-help-about-overlay';
  modalApi.modal.classList.add('meldex-help-about-dialog');
  modalApi.modal.dataset.e2eId = 'meldex-help-about-dialog';
  modalApi.header.querySelector('.gb-modal-close').dataset.e2eId = 'meldex-about-header-close';
  modalApi.modal.style.cssText = 'width:min(680px, calc(100vw - 24px));max-width:680px;height:min(85vh, 720px);max-height:85vh;overflow:hidden;';
  modalApi.body.style.cssText = 'min-height:0;overflow-y:auto;overflow-x:hidden;';
  modalApi.body.querySelectorAll('.gb-section').forEach(section => {
    section.style.cssText += ';box-sizing:border-box;min-width:0;max-width:100%;';
  });
  modalApi.body.querySelectorAll('.gb-section > *:not(.gb-section-title)').forEach(item => {
    item.style.cssText += ';box-sizing:border-box;min-width:0;max-width:calc(100% - 1em);';
  });
  modalApi.body.querySelectorAll('a').forEach(link => {
    link.style.overflowWrap = 'anywhere';
  });
  modalApi.body.querySelectorAll('.btn-row').forEach(row => {
    row.style.flexWrap = 'wrap';
  });
  modalApi.footer.style.cssText = 'position:relative;z-index:2;';
  closeButton.style.cssText = 'box-sizing:border-box;min-width:88px;max-width:100%;white-space:nowrap;';
  closeButton.addEventListener('click', () => modalApi.close('footer-close'));
  modalApi.open();
  replaceIcons(modalApi.overlay);
  if (typeof refreshMeldexAboutPanel === 'function') refreshMeldexAboutPanel(modalApi.overlay);
  return modalApi;
}

async function showMeldexChangelogDialog(returnFocus) {
  _closeMeldexHelpMenu();
  const content = document.createElement('div');
  content.innerHTML = `<div id="meldex-changelog-status" role="status" aria-live="polite"></div>
    <pre id="meldex-changelog-body" style="min-height:96px;max-height:min(60vh,480px);box-sizing:border-box;margin:0;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:12px;font-size:12px;line-height:1.6;color:var(--fg);">読み込み中...</pre>`;
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'gb-btn gb-btn-sm';
  closeButton.dataset.e2eId = 'meldex-changelog-close';
  closeButton.textContent = '閉じる';
  const modalApi = window.GBUI.createModal({
    id: 'meldex-help-changelog',
    title: '更新履歴',
    body: [...content.childNodes],
    footer: closeButton,
    variant: 'standard',
    geometryKey: 'meldex-help-changelog',
    minWidth: '0',
    initialFocus: closeButton,
    returnFocus: _meldexHelpDialogOwner(returnFocus),
    closeLabel: '更新履歴を閉じる',
    closeOnEsc: true,
    closeOnOverlay: true,
  });
  modalApi.overlay.classList.add('meldex-help-changelog-overlay');
  modalApi.overlay.dataset.e2eId = 'meldex-help-changelog-overlay';
  modalApi.modal.classList.add('meldex-help-changelog-dialog');
  modalApi.modal.dataset.e2eId = 'meldex-help-changelog-dialog';
  modalApi.header.querySelector('.gb-modal-close').dataset.e2eId = 'meldex-changelog-header-close';
  modalApi.modal.style.cssText = 'width:min(760px, calc(100vw - 24px));max-width:760px;max-height:85vh;overflow:hidden;';
  modalApi.body.style.cssText = 'min-height:0;box-sizing:border-box;overflow:hidden;';
  modalApi.footer.style.cssText = 'position:relative;z-index:2;width:100%;min-width:0;max-width:100%;padding-left:16px;padding-right:16px;';
  closeButton.style.cssText = 'box-sizing:border-box;flex:0 0 auto;min-width:88px;max-width:100%;white-space:nowrap;overflow:visible;';
  const body = modalApi.modal.querySelector('#meldex-changelog-body');
  const status = modalApi.modal.querySelector('#meldex-changelog-status');
  const load = async () => {
    modalApi.modal.setAttribute('aria-busy', 'true');
    status.textContent = '更新履歴を読み込んでいます。';
    body.textContent = '読み込み中...';
    try {
      const res = await fetch('CHANGELOG.md', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!modalApi.isOpen()) return;
      body.textContent = text;
      status.textContent = '';
    } catch (error) {
      if (!modalApi.isOpen()) return;
      body.textContent = '更新履歴を読み込めませんでした。';
      status.innerHTML = '<button type="button" class="gb-btn gb-btn-sm" data-e2e-id="meldex-changelog-retry">再試行</button>';
      status.querySelector('[data-e2e-id="meldex-changelog-retry"]')?.addEventListener('click', load);
    } finally {
      if (modalApi.isOpen()) modalApi.modal.setAttribute('aria-busy', 'false');
    }
  };
  closeButton.addEventListener('click', () => modalApi.close('footer-close'));
  modalApi.open();
  replaceIcons(modalApi.overlay);
  await load();
  return modalApi;
}
