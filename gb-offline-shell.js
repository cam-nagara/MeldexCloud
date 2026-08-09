(function () {
  'use strict';

  if (window.MeldexOfflineShell) return;

  const CHOICE_KEY = 'meldex-offline-shell-choice-v1';
  const CHOICE_ENABLED = 'enabled';
  const CHOICE_ONLINE = 'online';
  const MESSAGE_TIMEOUT_MS = 180000;

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

  function _showFirstRunDialog() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay meldex-offline-choice-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:10025;display:flex;align-items:center;justify-content:center;padding:8px;box-sizing:border-box;background:rgba(0,0,0,.58);';
      overlay.innerHTML = `<div class="meldex-offline-choice-modal" role="dialog" aria-modal="true" aria-labelledby="meldex-offline-choice-title" style="width:calc(100vw - 16px);max-width:620px;max-height:calc(100vh - 16px);overflow:auto;box-sizing:border-box;padding:clamp(16px,4vw,24px);border:1px solid #3a3a3a;border-radius:12px;background:#1e1e1e;color:#d4d4d4;box-shadow:0 16px 48px rgba(0,0,0,.45);">
        <h2 id="meldex-offline-choice-title" style="margin:0 0 8px;font-size:22px;">オフラインでも使いますか？</h2>
        <p style="margin:0 0 16px;color:#bdbdbd;font-size:13px;line-height:1.7;">どちらを選んでも、データはこの端末内に自動保存されます。オフライン利用を選ぶと、Meldex本体もこの端末に保存します。あとから設定で変更できます。</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr));gap:10px;">
          <button id="meldex-offline-enable" type="button" style="min-height:92px;padding:14px;text-align:left;border:1px solid #356b4d;border-radius:10px;background:#18261e;color:#e5e7eb;cursor:pointer;white-space:normal;">
            <strong style="display:block;font-size:16px;margin-bottom:5px;">オフラインでも使えるようにする</strong>
            <span style="display:block;font-size:12px;line-height:1.6;color:#a8c0b0;">通信できない時もMeldexを起動できます。最初にアプリ本体を保存します。</span>
          </button>
          <button id="meldex-offline-online" type="button" style="min-height:92px;padding:14px;text-align:left;border:1px solid #444;border-radius:10px;background:#252525;color:#e5e7eb;cursor:pointer;white-space:normal;">
            <strong style="display:block;font-size:16px;margin-bottom:5px;">オンライン時だけ使う</strong>
            <span style="display:block;font-size:12px;line-height:1.6;color:#aaa;">アプリ本体は保存せず、接続中に最新版を読み込みます。</span>
          </button>
        </div>
        <div id="meldex-offline-choice-status" role="status" aria-live="polite" style="min-height:20px;margin-top:12px;color:#bdbdbd;font-size:12px;line-height:1.6;"></div>
      </div>`;
      document.body.appendChild(overlay);
      const enableButton = overlay.querySelector('#meldex-offline-enable');
      const onlineButton = overlay.querySelector('#meldex-offline-online');
      const statusElement = overlay.querySelector('#meldex-offline-choice-status');
      const setBusy = (busy) => {
        enableButton.disabled = busy;
        onlineButton.disabled = busy;
        enableButton.style.opacity = busy ? '.65' : '1';
        onlineButton.style.opacity = busy ? '.65' : '1';
      };
      enableButton.addEventListener('click', async () => {
        setBusy(true);
        statusElement.textContent = 'Meldex本体をこの端末に保存しています。画面を閉じずにお待ちください…';
        try {
          await enable();
          overlay.remove();
          resolve(CHOICE_ENABLED);
        } catch (error) {
          setBusy(false);
          statusElement.textContent = `準備できませんでした: ${error?.message || String(error)}　オンライン時だけ使うことはできます。`;
          statusElement.style.color = '#f7b4c0';
        }
      });
      onlineButton.addEventListener('click', () => {
        _setChoice(CHOICE_ONLINE);
        overlay.remove();
        resolve(CHOICE_ONLINE);
      });
      enableButton.focus();
    });
  }

  async function prepareFirstRunChoice() {
    if (!_runtime()?.isBrowserMode?.() || _isBypassLaunch()) return getChoice();
    const choice = getChoice();
    if (choice === CHOICE_ENABLED) {
      enable().catch((error) => console.warn('[MeldexOfflineShell] 更新確認に失敗しました', error));
      return choice;
    }
    if (choice === CHOICE_ONLINE) return choice;
    return _showFirstRunDialog();
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
