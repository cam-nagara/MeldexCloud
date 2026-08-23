/* Live event bridge for note TopicView embeds. */
(function initMeldexNoteEmbedLive(global) {
  'use strict';
  if (global.MeldexNoteEmbedLive) return;

  function _open(detail) {
    const resourceType = detail?.resourceType;
    const path = resourceType === 'sheet' ? detail?.dbPath : detail?.boardPath;
    const label = detail?.fallback?.title || String(path || '').split(/[\\/]/).pop() || 'ビュー';
    if (resourceType === 'sheet' && path && typeof global.selectDatabase === 'function') {
      return global.selectDatabase(path, null, { fromExplorer: true });
    }
    if (resourceType === 'board' && path && typeof global.openBoard === 'function') {
      return global.openBoard(label, path, { fromExplorer: true });
    }
    global.showStatus?.('元の項目を開くためのパスを確認できません', true);
    return false;
  }

  function _height(detail) {
    if (!detail?.blockId || typeof detail.setHeight !== 'function') return;
    if (!global.GBUI?.createModal || typeof document === 'undefined') {
      global.showStatus?.('高さ設定を開けません', true); return;
    }
    const body = document.createElement('div');
    const label = document.createElement('label'); label.textContent = '埋め込みの高さ（160〜2400 px）';
    const input = document.createElement('input'); input.type = 'number'; input.min = '160'; input.max = '2400';
    input.step = '20'; input.value = String(detail.height || 420); input.className = 'gb-input';
    label.appendChild(input); body.appendChild(label);
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'キャンセル';
    const apply = document.createElement('button'); apply.type = 'button'; apply.textContent = '高さを変更';
    apply.className = 'gb-btn gb-btn-primary';
    const modal = global.GBUI.createModal({
      id: 'meldex-note-embed-height', title: '埋め込みの高さ', body, footer: [cancel, apply],
      variant: 'mobile-sheet', initialFocus: input,
    });
    cancel.addEventListener('click', () => modal.close('cancel'));
    apply.addEventListener('click', () => {
      const value = Math.max(160, Math.min(2400, Math.round(Number(input.value) || 420)));
      detail.setHeight(detail.blockId, value); modal.close('submit');
    });
    modal.open();
  }

  async function _pick(detail) {
    const ref = await global.MeldexTopicViewPicker?.open?.({
      resourceType: detail?.resourceType, current: detail?.current || null,
    });
    if (ref && typeof detail?.select === 'function') detail.select(ref);
  }

  const handlers = {
    request: (event) => { _pick(event.detail); },
    height: (event) => { _height(event.detail); },
    reconnect: (event) => {
      global.MeldexNoteEmbedBlock?.reconnect?.(event.detail?.runtimeId || event.detail?.blockId);
    },
    open: (event) => { _open(event.detail); },
  };
  global.addEventListener('meldex-note-request-view', handlers.request);
  global.addEventListener('meldex-note-request-embed-height', handlers.height);
  global.addEventListener('meldex-reconnect-topic-view', handlers.reconnect);
  global.addEventListener('meldex-open-topic-view', handlers.open);

  global.MeldexNoteEmbedLive = Object.freeze({
    openOriginal: _open,
    destroy() {
      global.removeEventListener('meldex-note-request-view', handlers.request);
      global.removeEventListener('meldex-note-request-embed-height', handlers.height);
      global.removeEventListener('meldex-reconnect-topic-view', handlers.reconnect);
      global.removeEventListener('meldex-open-topic-view', handlers.open);
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
