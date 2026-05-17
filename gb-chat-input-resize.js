/* Drag-resize support for chat composer inputs. */
(function () {
  const CONFIGS = [
    { handleId: 'chat-composer-resize', inputId: 'chat-input', storageKey: 'chat-input-height', minRows: 2, maxRows: 10 },
    { handleId: 'team-composer-resize', inputId: 'team-input', storageKey: 'team-input-height', minRows: 2, maxRows: 8 },
  ];

  function _lineMetrics(input, minRows, maxRows) {
    const style = getComputedStyle(input);
    const fontSize = parseFloat(style.fontSize) || 13;
    const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.4;
    const padding =
      (parseFloat(style.paddingTop) || 0) +
      (parseFloat(style.paddingBottom) || 0) +
      (parseFloat(style.borderTopWidth) || 0) +
      (parseFloat(style.borderBottomWidth) || 0);
    return {
      min: (minRows || 2) * lineHeight + padding,
      autoMax: (maxRows || 8) * lineHeight + padding,
    };
  }

  function _resizeTarget(input) {
    if (window.GBChatFormatting?.visibleInputForInput) {
      const visible = window.GBChatFormatting.visibleInputForInput(input);
      if (visible) return visible;
    }
    return input;
  }

  function _panelHeight(handle) {
    const panel = handle.closest('#chat-llm-panel, #chat-team-panel, #rp-chat, #right-panel');
    const height = panel?.getBoundingClientRect?.().height || 0;
    return height > 200 ? height : Math.max(360, Math.floor(window.innerHeight * 0.55));
  }

  function _bounds(handle, input, cfg) {
    const target = _resizeTarget(input);
    const metrics = _lineMetrics(target, cfg.minRows, cfg.maxRows);
    const panelMax = Math.max(metrics.min, Math.floor(_panelHeight(handle) * 0.56));
    const max = Math.max(metrics.autoMax, Math.min(panelMax, 360));
    input.dataset.chatManualMaxHeight = String(Math.round(max));
    return { min: metrics.min, max };
  }

  function _applyHeight(handle, input, cfg, height, persist) {
    const bounds = _bounds(handle, input, cfg);
    const next = Math.round(Math.min(Math.max(Number(height) || bounds.min, bounds.min), bounds.max));
    const target = _resizeTarget(input);
    input.dataset.chatManualHeight = '1';
    target.style.height = next + 'px';
    target.style.overflowY = target.scrollHeight > next + 1 ? 'auto' : 'hidden';
    if (target !== input) {
      input.style.height = next + 'px';
      input.style.overflowY = 'hidden';
    }
    if (persist) localStorage.setItem(cfg.storageKey, String(next));
  }

  function _restoreHeight(handle, input, cfg) {
    const stored = Number(localStorage.getItem(cfg.storageKey) || 0);
    const bounds = _bounds(handle, input, cfg);
    if (Number.isFinite(stored) && stored >= bounds.min) {
      _applyHeight(handle, input, cfg, stored, false);
    } else if (typeof window._autoGrowTextarea === 'function') {
      window._autoGrowTextarea(input, cfg.minRows, cfg.maxRows);
    }
  }

  function _installOne(cfg) {
    const handle = document.getElementById(cfg.handleId);
    const input = document.getElementById(cfg.inputId);
    if (!handle || !input || handle.dataset.chatResizeBound === '1') return;
    handle.dataset.chatResizeBound = '1';
    _restoreHeight(handle, input, cfg);

    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startY = event.clientY;
      const target = _resizeTarget(input);
      const startHeight = target.getBoundingClientRect().height || parseFloat(target.style.height) || _bounds(handle, input, cfg).min;
      handle.classList.add('is-dragging');
      document.body.classList.add('chat-composer-resizing');
      try { handle.setPointerCapture(event.pointerId); } catch {}

      const move = moveEvent => {
        _applyHeight(handle, input, cfg, startHeight + startY - moveEvent.clientY, true);
      };
      const stop = () => {
        handle.classList.remove('is-dragging');
        document.body.classList.remove('chat-composer-resizing');
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', stop);
        document.removeEventListener('pointercancel', stop);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', stop);
      document.addEventListener('pointercancel', stop);
    });

    handle.addEventListener('keydown', event => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const bounds = _bounds(handle, input, cfg);
      const target = _resizeTarget(input);
      const current = target.getBoundingClientRect().height || bounds.min;
      if (event.key === 'Home') _applyHeight(handle, input, cfg, bounds.min, true);
      else if (event.key === 'End') _applyHeight(handle, input, cfg, bounds.max, true);
      else _applyHeight(handle, input, cfg, current + (event.key === 'ArrowUp' ? 14 : -14), true);
    });
  }

  function install() {
    CONFIGS.forEach(_installOne);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
  window.addEventListener('resize', () => {
    CONFIGS.forEach(cfg => {
      const handle = document.getElementById(cfg.handleId);
      const input = document.getElementById(cfg.inputId);
      if (handle && input && input.dataset.chatManualHeight === '1') {
        const target = _resizeTarget(input);
        _applyHeight(handle, input, cfg, target.getBoundingClientRect().height, false);
      }
    });
  });

  window.MeldexChatInputResize = { install };
})();
