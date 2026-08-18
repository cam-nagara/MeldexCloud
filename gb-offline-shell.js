(function () {
  'use strict';

  if (window.MeldexOfflineShell) return;

  const CHOICE_KEY = 'meldex-offline-shell-choice-v1';
  const CHOICE_ENABLED = 'enabled';
  const CHOICE_ONLINE = 'online';
  const MESSAGE_TIMEOUT_MS = 180000;
  let _choiceDialogApi = null;
  let _choiceDialogPromise = null;

  function _runtime() {
    return window.MeldexRuntimeAdapter;
  }

  function getChoice() {
    try {
      const value = localStorage.getItem(CHOICE_KEY);
      return value === CHOICE_ENABLED || value === CHOICE_ONLINE ? value : '';
    } catch {
      return '';
    }
  }

  function _setChoice(value) {
    try { localStorage.setItem(CHOICE_KEY, value); } catch {}
  }

  function _isBypassLaunch() {
    try {
      const params = new URLSearchParams(location.search);
      return params.has('smoke') || params.has('e2e');
    } catch {
      return false;
    }
  }

  async function _activeWorker() {
    if (!('serviceWorker' in navigator)) throw new Error('このブラウザはオフライン利用に対応していません');
    const registration = await navigator.serviceWorker.ready;
    const worker = registration.active || registration.waiting || registration.installing;
    if (!worker) throw new Error('オフライン用アプリの準備がまだ完了していません');
    return worker;
  }

  async function _request(type) {
    const worker = await _activeWorker();
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => reject(new Error('オフライン用アプリの準備がタイムアウトしました')), MESSAGE_TIMEOUT_MS);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        const result = event.data || {};
        if (result.ok === false) reject(new Error(result.message || 'オフライン設定を変更できませんでした'));
        else resolve(result);
      };
      worker.postMessage({ type }, [channel.port2]);
    });
  }

  async function enable() {
    const result = await _request('MELDEX_OFFLINE_ENABLE');
    _setChoice(CHOICE_ENABLED);
    return result;
  }

  async function disable() {
    const result = await _request('MELDEX_OFFLINE_DISABLE');
    _setChoice(CHOICE_ONLINE);
    return result;
  }

  async function status() {
    try { return await _request('MELDEX_OFFLINE_STATUS'); }
    catch (error) { return { ok: false, enabled: false, message: error?.message || String(error) }; }
  }

  function _choiceButton(id, title, description, primary) {
    const button = document.createElement('button');
    button.id = id;
    button.type = 'button';
    button.className = `gb-btn meldex-offline-choice-button${primary ? ' meldex-offline-choice-button-primary' : ''}`;
    button.style.cssText = `min-width:0;min-height:92px;padding:14px;text-align:left;border-radius:10px;white-space:normal;${primary ? 'border-color:#356b4d;background:#18261e;' : ''}`;
    const strong = document.createElement('strong');
    strong.textContent = title;
    strong.style.cssText = 'display:block;font-size:16px;margin-bottom:5px;';
    const detail = document.createElement('span');
    detail.textContent = description;
    detail.style.cssText = 'display:block;font-size:12px;line-height:1.6;color:var(--ui-fg-muted,#aaa);';
    button.append(strong, detail);
    return button;
  }

  function _choiceDialogContent() {
    const description = document.createElement('p');
    description.className = 'meldex-offline-choice-description';
    description.textContent = 'どちらを選んでも、データはこの端末内に自動保存されます。オフライン利用を選ぶと、Meldex本体もこの端末に保存します。あとから設定で変更できます。';
    description.style.cssText = 'margin:0;color:var(--ui-fg-muted,#bdbdbd);font-size:13px;line-height:1.7;overflow-wrap:anywhere;';
    const status = document.createElement('div');
    status.id = 'meldex-offline-choice-status';
    status.className = 'meldex-offline-choice-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.style.cssText = 'min-height:20px;color:var(--ui-fg-muted,#bdbdbd);font-size:12px;line-height:1.6;overflow-wrap:anywhere;';
    return { description, status };
  }

  function _setChoiceBusy(enableButton, onlineButton, overlay, busy) {
    enableButton.disabled = busy;
    onlineButton.disabled = busy;
    enableButton.style.opacity = busy ? '.65' : '1';
    onlineButton.style.opacity = busy ? '.65' : '1';
    overlay?.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function _showFirstRunDialog(options) {
    options = options || {};
    if (_choiceDialogApi?.isOpen?.() && _choiceDialogPromise) return _choiceDialogPromise;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const enableButton = _choiceButton(
      'meldex-offline-enable',
      'オフラインでも使えるようにする',
      '通信できない時もMeldexを起動できます。最初にアプリ本体を保存します。',
      true
    );
    const onlineButton = _choiceButton(
      'meldex-offline-online',
      'オンライン時だけ使う',
      'アプリ本体は保存せず、接続中に最新版を読み込みます。',
      false
    );
    const { description, status: statusElement } = _choiceDialogContent();
    const enableOffline = typeof options.enable === 'function' ? options.enable : enable;
    let resolveChoice = null;
    let settled = false;
    let busy = false;
    let dialogApi = null;
    const promise = new Promise(resolve => { resolveChoice = resolve; });
    _choiceDialogPromise = promise;
    const settle = (choice) => {
      if (settled) return;
      settled = true;
      busy = false;
      _setChoiceBusy(enableButton, onlineButton, dialogApi?.overlay, false);
      dialogApi.close(choice);
      resolveChoice(choice);
    };
    dialogApi = window.GBUI.createModal({
      id: 'meldex-offline-choice-dialog',
      titleId: 'meldex-offline-choice-title',
      title: 'オフラインでも使いますか？',
      body: [description, statusElement],
      footer: [enableButton, onlineButton],
      variant: 'standard',
      extraClass: 'meldex-offline-choice-modal',
      geometryKey: 'meldex-offline-choice-dialog',
      minWidth: '0',
      initialFocus: enableButton,
      returnFocus: opener,
      closeOnEsc: false,
      closeOnOverlay: false,
      onBeforeClose: reason => ['enabled', 'online', 'test-cleanup'].includes(reason) && (!busy || reason === 'test-cleanup'),
      onClose: () => {
        if (_choiceDialogApi === dialogApi) _choiceDialogApi = null;
        if (_choiceDialogPromise === promise) _choiceDialogPromise = null;
        if (!settled) {
          settled = true;
          resolveChoice('');
        }
      },
    });
    _choiceDialogApi = dialogApi;
    const { overlay, modal, header, body, footer } = dialogApi;
    overlay.classList.add('modal-overlay', 'meldex-offline-choice-overlay');
    overlay.style.zIndex = '10025';
    modal.classList.add('modal');
    modal.dataset.e2eId = 'offline-choice-dialog';
    modal.style.width = 'min(620px, calc(100vw - 16px))';
    modal.style.maxWidth = 'min(620px, calc(100vw - 16px))';
    modal.style.minHeight = 'min(340px, calc(100vh - 16px))';
    modal.style.maxHeight = 'calc(100vh - 16px)';
    body.classList.add('modal-body', 'meldex-offline-choice-body');
    body.style.cssText += 'display:grid;gap:12px;min-width:0;overflow-x:hidden;';
    footer.classList.add('btn-row', 'meldex-offline-choice-actions');
    footer.style.cssText += 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr));align-items:stretch;gap:10px;height:auto;min-height:120px;padding:12px 16px;';
    header.querySelector('.gb-modal-close')?.remove();
    overlay.addEventListener('meldex-offline-dialog-close', () => dialogApi.close('test-cleanup'));
    enableButton.addEventListener('click', async () => {
      if (busy || settled) return;
      busy = true;
      _setChoiceBusy(enableButton, onlineButton, overlay, true);
      statusElement.style.color = 'var(--ui-fg-muted,#bdbdbd)';
      statusElement.textContent = 'Meldex本体をこの端末に保存しています。画面を閉じずにお待ちください…';
      try {
        await enableOffline();
        _setChoice(CHOICE_ENABLED);
        settle(CHOICE_ENABLED);
      } catch (error) {
        busy = false;
        _setChoiceBusy(enableButton, onlineButton, overlay, false);
        statusElement.textContent = `準備できませんでした: ${error?.message || String(error)}　オンライン時だけ使うことはできます。`;
        statusElement.style.color = '#f7b4c0';
      }
    });
    onlineButton.addEventListener('click', () => {
      if (busy || settled) return;
      _setChoice(CHOICE_ONLINE);
      settle(CHOICE_ONLINE);
    });
    dialogApi.open();
    return promise;
  }

  async function prepareFirstRunChoice(options) {
    options = options || {};
    if (!options.force && (!_runtime()?.isBrowserMode?.() || _isBypassLaunch())) return getChoice();
    const choice = getChoice();
    if (choice === CHOICE_ENABLED) {
      enable().catch((error) => console.warn('[MeldexOfflineShell] 更新確認に失敗しました', error));
      return choice;
    }
    if (choice === CHOICE_ONLINE) return choice;
    return _showFirstRunDialog(options);
  }

  function renderSettings(container) {
    if (!container || !_runtime()?.isBrowserDataMode?.()) return;
    const section = document.createElement('div');
    section.className = 'meldex-offline-settings';
    section.style.cssText = 'margin-top:12px;padding-top:12px;border-top:1px solid var(--border);';
    section.innerHTML = `<div style="font-weight:700;font-size:13px;">オフライン利用</div>
      <div data-offline-status class="gb-section-desc" role="status" aria-live="polite">状態を確認しています…</div>
      <div class="gb-field-row" style="justify-content:flex-start;gap:8px;flex-wrap:wrap;margin-top:8px;">
        <button type="button" class="gb-btn gb-btn-sm" data-offline-enable>オフラインでも使えるようにする</button>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-offline-disable>オンライン時だけ使う</button>
      </div>
      <div class="gb-section-desc">設定を変えても、この端末内のワークスペースやファイルは削除されません。</div>`;
    container.appendChild(section);
    const statusElement = section.querySelector('[data-offline-status]');
    const enableButton = section.querySelector('[data-offline-enable]');
    const disableButton = section.querySelector('[data-offline-disable]');
    const setBusy = (busy) => {
      enableButton.disabled = busy;
      disableButton.disabled = busy;
    };
    const refresh = async () => {
      const current = await status();
      const enabled = current.ok === false ? getChoice() === CHOICE_ENABLED : current.enabled === true;
      statusElement.textContent = current.ok === false
        ? `現在の状態を確認できません: ${current.message || 'Service Workerに接続できません'}`
        : enabled ? '現在: オフラインでも使用可能' : '現在: オンライン時だけ使用';
      enableButton.disabled = enabled;
      disableButton.disabled = !enabled;
    };
    enableButton.addEventListener('click', async () => {
      setBusy(true);
      statusElement.textContent = 'Meldex本体をこの端末に保存しています…';
      try { await enable(); await refresh(); }
      catch (error) { statusElement.textContent = `準備できませんでした: ${error?.message || String(error)}`; setBusy(false); }
    });
    disableButton.addEventListener('click', async () => {
      setBusy(true);
      statusElement.textContent = 'オフライン用のアプリ本体だけを削除しています…';
      try { await disable(); await refresh(); }
      catch (error) { statusElement.textContent = `変更できませんでした: ${error?.message || String(error)}`; setBusy(false); }
    });
    refresh();
  }

  window.MeldexOfflineShell = {
    CHOICE_KEY,
    getChoice,
    status,
    enable,
    disable,
    prepareFirstRunChoice,
    renderSettings,
  };
})();
