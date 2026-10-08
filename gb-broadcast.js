/* gb-broadcast.js — BroadcastChannel によるウィンドウ間通信基盤
 * 複数ウィンドウ間のデータ転送・ファイル変更通知を管理
 */
const MeldexBroadcast = (() => {
  const CHANNEL_NAME = 'meldex';
  let channel = null;
  const windowId = globalThis.crypto?.randomUUID?.()
    || 'win-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const _listeners = {};

  function init() {
    if (channel) return;
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (e) => {
        const msg = e.data;
        if (!msg || !msg.type || msg.windowId === windowId) return;
        const handlers = _listeners[msg.type];
        if (handlers) handlers.forEach(fn => { try { fn(msg); } catch {} });
      };
    } catch {
      // BroadcastChannel 非対応環境では無操作
    }
  }

  function send(type, payload) {
    if (!channel) init();
    if (!channel) return;
    channel.postMessage({ ...(payload || {}), type, windowId, timestamp: Date.now() });
  }

  function on(type, callback) {
    if (!_listeners[type]) _listeners[type] = [];
    _listeners[type].push(callback);
  }

  function off(type, callback) {
    if (!_listeners[type]) return;
    _listeners[type] = _listeners[type].filter(fn => fn !== callback);
  }

  // --- 転送系 ---
  function startTransfer(payload) {
    send('transfer-start', { payload });
  }

  function acceptTransfer(sourceWindowId) {
    send('transfer-accept', { targetWindowId: sourceWindowId });
  }

  // D&D bridge は BroadcastChannel の同一 origin transport だけを使う。
  // payload の検証・TTL・一回消費は gb-dnd.js 側に集約し、ここでは永続化しない。
  function sendDndOffer(payload) {
    send('dnd-offer', payload);
  }
  function sendDndAck(payload) {
    send('dnd-ack', payload);
  }
  function sendDndCancel(payload) {
    send('dnd-cancel', payload);
  }
  function requestDndOffer(payload) {
    send('dnd-request', payload);
  }
  function claimDndOffer(payload) {
    send('dnd-claim', payload);
  }
  function sendDndClaimResult(payload) {
    send('dnd-claim-result', payload);
  }
  function sendDndFail(payload) {
    send('dnd-fail', payload);
  }

  // --- ファイル変更通知 ---
  function notifyFileChanged(path, action) {
    send('file-changed', { path, action: action || 'modified' });
  }

  // --- Phase 6: サブウィンドウ関連通知 ---
  function notifySubwindowReady(payload) {
    send('subwindow-ready', payload || {});
  }
  function notifySubwindowOpened(payload) {
    send('subwindow-opened', payload || {});
  }
  function notifySubwindowClosed(payload) {
    send('subwindow-closed', payload || {});
  }
  function sendStateSnapshot(payload) {
    send('state-snapshot', payload || {});
  }
  function notifyGlobalStateChanged(payload) {
    send('global-state-changed', payload || {});
  }

  // --- クリップボード転送ヘルパー ---
  // ファイル/ノード情報をクリップボードにリッチデータとして書き込む
  async function copyMeldexLink(name, path, type) {
    const escapeMarkdownLabel = (text) => String(text || '')
      .replace(/\\/g, '\\\\')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\r?\n/g, ' ');
    const escapeMarkdownPath = (text) => String(text || '')
      .replace(/\\/g, '/')
      .replace(/\)/g, '\\)')
      .replace(/>/g, '%3E')
      .replace(/\r?\n/g, '');
    const md = `[${escapeMarkdownLabel(name)}](${escapeMarkdownPath(path)})`;
    const icon = typeof MeldexDnD !== 'undefined' ? MeldexDnD.getIconForType(type) : 'file';
    const html = `<span class="auto-link" data-path="${esc(path)}" style="color:var(--accent);text-decoration:underline;cursor:pointer;">${typeof lucide !== 'undefined' ? lucide(icon, 12) : ''}${esc(name)}</span>`;
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([md], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' })
      })]);
      return true;
    } catch {
      // フォールバック: テキストのみ
      try { await navigator.clipboard.writeText(md); return true; } catch { return false; }
    }
  }

  // 初期化
  init();

  return {
    windowId,
    send,
    on,
    off,
    startTransfer,
    acceptTransfer,
    sendDndOffer,
    sendDndAck,
    sendDndCancel,
    requestDndOffer,
    claimDndOffer,
    sendDndClaimResult,
    sendDndFail,
    notifyFileChanged,
    notifySubwindowReady,
    notifySubwindowOpened,
    notifySubwindowClosed,
    sendStateSnapshot,
    notifyGlobalStateChanged,
    copyMeldexLink
  };
})();

// 互換: 他モジュールが `GBBroadcast` で参照しているため同名でも公開
if (typeof window !== 'undefined') {
  window.GBBroadcast = window.GBBroadcast || MeldexBroadcast;
}
