/* standalone-default-apps.js: default app setup dialog for Meldex standalone apps. */
(function () {
  'use strict';

  const NS = (window.MeldexStandaloneDefaultApps = window.MeldexStandaloneDefaultApps || {});
  const PROMPT_KEY_PREFIX = 'meldex-standalone-default-app-prompt-v1:';
  let statusCache = null;
  let styleInstalled = false;
  let dialogSeq = 0;

  function isNativeStandalone() {
    return new URLSearchParams(location.search).get('native') === '1';
  }

  function showMessage(message, isError) {
    if (typeof window.showStatus === 'function') {
      window.showStatus(message, !!isError);
    } else {
      (isError ? console.error : console.log)(message);
    }
  }

  async function fetchJson(path, opts = {}) {
    const res = await fetch(path, {
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
    });
    if (!res.ok) {
      let detail = '';
      try {
        const payload = await res.json();
        detail = payload?.detail || payload?.error || '';
      } catch {}
      const error = new Error(detail || ('HTTP ' + res.status));
      error.status = res.status;
      throw error;
    }
    return res.json();
  }

  async function loadStatus(force) {
    if (statusCache && !force) return statusCache;
    statusCache = await fetchJson('/api/standalone/default-apps/status');
    return statusCache;
  }

  function appIdFromStatus(status) {
    return String(status?.app?.app || status?.app?.app_id || '').trim() || 'standalone';
  }

  function promptKey(status) {
    return PROMPT_KEY_PREFIX + appIdFromStatus(status);
  }

  function markPromptSeen(status) {
    try {
      localStorage.setItem(promptKey(status), '1');
    } catch {}
  }

  function hasPromptBeenSeen(status) {
    try {
      return localStorage.getItem(promptKey(status)) === '1';
    } catch {
      return true;
    }
  }

  function labelForExtension(appId, ext) {
    const value = String(ext || '').toLowerCase();
    const labels = {
      '.mel-sheet': 'Meldexシート',
      '.mel-scenario': 'Meldexシナリオ',
      '.mel-timer': 'Meldexタイマー',
      '.mel-board': 'Meldexボード',
      '.csv': 'CSV',
      '.md': 'Markdown',
      '.txt': 'テキスト',
      '.pdf': 'PDF',
      '.png': 'PNG画像',
      '.apng': 'APNG画像',
      '.jpg': 'JPEG画像',
      '.jpeg': 'JPEG画像',
      '.jpe': 'JPEG画像',
      '.jfif': 'JPEG画像',
      '.gif': 'GIF画像',
      '.bmp': 'BMP画像',
      '.webp': 'WebP画像',
      '.svg': 'SVG画像',
      '.ico': 'ICO画像',
      '.avif': 'AVIF画像',
    };
    return (labels[value] || value.replace(/^\./, '').toUpperCase()) + '（' + value + '）';
  }

  function installStyle() {
    if (styleInstalled) return;
    styleInstalled = true;
    const style = document.createElement('style');
    style.textContent = `
.sa-default-apps-overlay{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.54);display:flex;align-items:center;justify-content:center;padding:18px;color:var(--fg,#e5e7eb);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans JP",sans-serif}
.sa-default-apps-dialog{width:min(560px,calc(100vw - 24px));max-height:min(760px,88vh);overflow:auto;background:var(--bg2,#1c2028);border:1px solid var(--border,rgba(255,255,255,.16));border-radius:8px;box-shadow:0 18px 54px rgba(0,0,0,.52)}
.sa-default-apps-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 18px 10px;border-bottom:1px solid var(--border,rgba(255,255,255,.12))}
.sa-default-apps-title{font-size:16px;font-weight:650;line-height:1.35}
.sa-default-apps-close{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border,rgba(255,255,255,.16));background:transparent;color:inherit;border-radius:6px;width:32px;height:32px;cursor:pointer}
.sa-default-apps-body{padding:14px 18px 16px}
.sa-default-apps-desc{font-size:13px;line-height:1.65;color:var(--fg2,#a9b0bd);margin:0 0 12px}
.sa-default-apps-list{display:grid;gap:8px;margin:10px 0 12px}
.sa-default-apps-row{display:flex;gap:10px;align-items:flex-start;min-height:44px;box-sizing:border-box;border:1px solid var(--border,rgba(255,255,255,.14));background:rgba(255,255,255,.035);border-radius:7px;padding:10px 11px;cursor:pointer}
.sa-default-apps-row input{margin-top:3px;accent-color:var(--accent,#00c2a8)}
.sa-default-apps-row-main{display:grid;gap:3px;min-width:0}
.sa-default-apps-row-title{font-size:13px;font-weight:600}
.sa-default-apps-row-note{font-size:12px;color:var(--fg2,#a9b0bd);line-height:1.4}
.sa-default-apps-note{font-size:12px;color:var(--fg2,#a9b0bd);line-height:1.55;white-space:pre-wrap}
.sa-default-apps-message{font-size:12px;line-height:1.55;margin-top:10px;color:var(--fg2,#a9b0bd);white-space:pre-wrap}
.sa-default-apps-message.error{color:var(--red,#ff6b6b)}
.sa-default-apps-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:14px}
.sa-default-apps-actions button{min-height:34px;border:1px solid var(--border,rgba(255,255,255,.16));background:var(--bg3,#2a303a);color:inherit;border-radius:6px;padding:7px 12px;font-size:13px;cursor:pointer}
.sa-default-apps-actions button.primary{background:var(--accent,#00c2a8);border-color:var(--accent,#00c2a8);color:#07110f;font-weight:650}
.sa-default-apps-actions button:disabled{opacity:.55;cursor:not-allowed}
@media(max-width:520px){.sa-default-apps-overlay{align-items:flex-end;padding:8px}.sa-default-apps-dialog{width:100%;max-height:92vh}.sa-default-apps-close{width:44px;height:44px}.sa-default-apps-row{min-height:44px}.sa-default-apps-row input{min-width:20px;min-height:20px}.sa-default-apps-actions button{flex:1 1 auto;min-height:44px}}
`;
    document.head.appendChild(style);
  }

  function closeExisting(options = {}) {
    document.querySelectorAll('.sa-default-apps-overlay').forEach(el => {
      if (typeof el._saDefaultAppsClose === 'function') el._saDefaultAppsClose(options);
      else el.remove();
    });
  }

  function shouldPrecheck(app, row) {
    if (row?.default) return true;
    const prompt = Array.isArray(app?.default_prompt_extensions) ? app.default_prompt_extensions : [];
    return prompt.includes(row?.extension);
  }

  function selectedExtensions(dialog) {
    return Array.from(dialog.querySelectorAll('input[data-extension]:checked'))
      .map(input => input.getAttribute('data-extension'))
      .filter(Boolean);
  }

  function updatePrimaryState(dialog) {
    const primary = dialog.querySelector('[data-default-apps-submit]');
    if (primary) primary.disabled = selectedExtensions(dialog).length === 0;
  }

  function makeButton(label, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (className) button.className = className;
    return button;
  }

  function renderStatusOnly(dialog, status, message, closeDialog, descId) {
    const body = dialog.querySelector('.sa-default-apps-body');
    if (!body) return;
    body.textContent = '';
    const desc = document.createElement('p');
    desc.className = 'sa-default-apps-desc';
    if (descId) desc.id = descId;
    desc.textContent = message;
    body.appendChild(desc);
    const actions = document.createElement('div');
    actions.className = 'sa-default-apps-actions';
    const close = makeButton('閉じる');
    close.addEventListener('click', () => {
      closeDialog?.();
    });
    actions.appendChild(close);
    body.appendChild(actions);
  }

  async function submitSelection(dialog, status) {
    const message = dialog.querySelector('.sa-default-apps-message');
    const primary = dialog.querySelector('[data-default-apps-submit]');
    const extensions = selectedExtensions(dialog);
    if (!extensions.length) {
      if (message) {
        message.textContent = '既定アプリにするファイル形式を選択してください。';
        message.classList.add('error');
      }
      return;
    }
    if (primary) primary.disabled = true;
    if (message) {
      message.textContent = 'Windowsに登録しています...';
      message.classList.remove('error');
    }
    try {
      const res = await fetchJson('/api/standalone/default-apps/set-default', {
        method: 'POST',
        body: JSON.stringify({ extensions, open_settings: true }),
      });
      statusCache = null;
      markPromptSeen(status);
      const suffix = res?.settings_opened
        ? '\nWindowsの既定アプリ画面を開きました。対象の拡張子でMeldexを選んでください。'
        : '';
      if (message) message.textContent = String(res?.message || '既定アプリ設定を更新しました。') + suffix;
      showMessage('既定アプリ設定を更新しました', false);
    } catch (error) {
      if (message) {
        message.textContent = '既定アプリを設定できませんでした: ' + (error?.message || error);
        message.classList.add('error');
      }
      showMessage('既定アプリを設定できませんでした', true);
    } finally {
      if (primary) primary.disabled = false;
      updatePrimaryState(dialog);
    }
  }

  function buildDialog(status, opts = {}) {
    installStyle();
    closeExisting({ markSeen: false, restore: false });
    const app = status?.app || {};
    const idBase = 'sa-default-apps-' + (++dialogSeq);
    const restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = document.createElement('div');
    overlay.className = 'sa-default-apps-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'sa-default-apps-dialog';
    dialog.id = idBase + '-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', idBase + '-title');
    dialog.setAttribute('aria-describedby', idBase + '-desc');
    const head = document.createElement('div');
    head.className = 'sa-default-apps-head';
    const title = document.createElement('div');
    title.className = 'sa-default-apps-title';
    title.id = idBase + '-title';
    title.textContent = opts.firstRun ? 'ファイルの開き方を設定しますか？' : '既定アプリに設定';
    const close = makeButton('×', 'sa-default-apps-close');
    close.setAttribute('aria-label', '閉じる');
    head.append(title, close);
    dialog.appendChild(head);

    const body = document.createElement('div');
    body.className = 'sa-default-apps-body';
    dialog.appendChild(body);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    let done = false;
    const closeDialog = (options = {}) => {
      if (done) return;
      done = true;
      if (options.markSeen !== false) markPromptSeen(status);
      document.removeEventListener('keydown', onKeydown, true);
      overlay.remove();
      if (options.restore !== false && restoreFocusTo?.isConnected) {
        const restoreFocus = () => restoreFocusTo.focus?.();
        restoreFocus();
        setTimeout(restoreFocus, 0);
      }
    };
    function onKeydown(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeDialog();
    }
    overlay._saDefaultAppsClose = closeDialog;
    close.addEventListener('click', () => closeDialog());
    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeDialog();
    });
    document.addEventListener('keydown', onKeydown, true);

    if (!status?.supported) {
      renderStatusOnly(dialog, status, 'Windows版の単独アプリでのみ設定できます。', closeDialog, idBase + '-desc');
      close.focus();
      return overlay;
    }
    if (!app?.target_exists) {
      renderStatusOnly(dialog, status, (app?.label || '単独アプリ') + ' の実行ファイルが見つかりません。', closeDialog, idBase + '-desc');
      close.focus();
      return overlay;
    }

    const desc = document.createElement('p');
    desc.className = 'sa-default-apps-desc';
    desc.id = idBase + '-desc';
    desc.textContent = (app.label || 'このアプリ') + ' で開きたいファイル形式を選びます。チェックを外しても、現在の既定アプリへ戻す操作は行いません。';
    body.appendChild(desc);

    const list = document.createElement('div');
    list.className = 'sa-default-apps-list';
    const rows = Array.isArray(app.extensions) ? app.extensions : [];
    rows.forEach(row => {
      const ext = String(row?.extension || '').toLowerCase();
      if (!ext) return;
      const label = document.createElement('label');
      label.className = 'sa-default-apps-row';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('data-extension', ext);
      input.checked = shouldPrecheck(app, row);
      input.addEventListener('change', () => updatePrimaryState(dialog));
      const main = document.createElement('span');
      main.className = 'sa-default-apps-row-main';
      const titleText = document.createElement('span');
      titleText.className = 'sa-default-apps-row-title';
      titleText.textContent = labelForExtension(app.app, ext);
      const note = document.createElement('span');
      note.className = 'sa-default-apps-row-note';
      note.textContent = row.default
        ? '現在Meldexで開く設定です。'
        : (row.user_choice_locked ? 'Windows設定で確認が必要な形式です。' : '現在の既定アプリは変更されていません。');
      main.append(titleText, note);
      label.append(input, main);
      list.appendChild(label);
    });
    body.appendChild(list);

    if (Array.isArray(app.unsupported_default_extensions) && app.unsupported_default_extensions.length) {
      const note = document.createElement('div');
      note.className = 'sa-default-apps-note';
      note.textContent = 'Windowsの既定アプリにできない形式: ' + app.unsupported_default_extensions.join(', ') + (app.note ? '\n' + app.note : '');
      body.appendChild(note);
    } else if (app.note) {
      const note = document.createElement('div');
      note.className = 'sa-default-apps-note';
      note.textContent = app.note;
      body.appendChild(note);
    }

    const message = document.createElement('div');
    message.className = 'sa-default-apps-message';
    message.setAttribute('aria-live', 'polite');
    body.appendChild(message);

    const actions = document.createElement('div');
    actions.className = 'sa-default-apps-actions';
    const later = makeButton(opts.firstRun ? '今はしない' : '閉じる');
    later.addEventListener('click', () => {
      closeDialog();
    });
    const primary = makeButton('選択した形式を既定にする', 'primary');
    primary.setAttribute('data-default-apps-submit', '1');
    primary.addEventListener('click', () => submitSelection(dialog, status));
    actions.append(later, primary);
    body.appendChild(actions);
    updatePrimaryState(dialog);
    primary.focus();
    return overlay;
  }

  async function openDialog(opts = {}) {
    if (!isNativeStandalone()) {
      installStyle();
      buildDialog({ supported: false, app: { app: 'standalone' } }, opts);
      return;
    }
    try {
      const status = await loadStatus(true);
      buildDialog(status, opts);
    } catch (error) {
      showMessage('既定アプリ設定を開けませんでした: ' + (error?.message || error), true);
    }
  }

  async function maybeShowFirstRunPrompt() {
    if (!isNativeStandalone()) return;
    try {
      const status = await loadStatus(false);
      const app = status?.app || {};
      const rows = Array.isArray(app.extensions) ? app.extensions : [];
      if (!status?.supported || !app.target_exists || !rows.length || hasPromptBeenSeen(status)) return;
      if (rows.every(row => row?.default)) {
        markPromptSeen(status);
        return;
      }
      setTimeout(() => openDialog({ firstRun: true }), 450);
    } catch {}
  }

  function installOpenHandlers() {
    document.addEventListener('click', event => {
      const trigger = event.target?.closest?.('[data-standalone-default-apps-open]');
      if (!trigger) return;
      event.preventDefault();
      event.stopPropagation();
      openDialog({ source: 'menu' });
    });
  }

  function revealNativeControls() {
    if (!isNativeStandalone()) return;
    document.querySelectorAll('[data-standalone-default-apps-open][hidden]').forEach(el => {
      el.hidden = false;
    });
  }

  function init() {
    installOpenHandlers();
    revealNativeControls();
    maybeShowFirstRunPrompt();
  }

  NS.openDialog = openDialog;
  NS.isAvailable = isNativeStandalone;
  NS.refreshStatus = () => loadStatus(true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
