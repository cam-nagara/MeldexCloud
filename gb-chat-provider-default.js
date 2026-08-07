/* gb-chat-provider-default.js: first-run provider selection for installed local CLIs. */
(function(global) {
  'use strict';

  const CLI_PRIORITY = ['codex', 'claude_code', 'antigravity_cli'];
  let _applying = null;

  function _storedProvider() {
    try {
      return String(localStorage.getItem('chat-provider') || '').trim();
    } catch {
      return '';
    }
  }

  function _readyProvider() {
    if (!global.GBChatCli?.providerReadyStatus) return '';
    return CLI_PRIORITY.find(provider => global.GBChatCli.providerReadyStatus(provider)?.ok) || '';
  }

  function _storedModel(provider) {
    try {
      return String(localStorage.getItem('chat-model:' + provider) || '');
    } catch {
      return '';
    }
  }

  async function applyFirstRun(options = {}) {
    if (_storedProvider()) return { applied: false, provider: _storedProvider(), reason: 'saved' };
    if (_applying) return _applying;
    _applying = Promise.resolve().then(async () => {
      if (!options.configLoaded && global.GBChatCli?.loadChatConfig) {
        await global.GBChatCli.loadChatConfig();
      }
      if (_storedProvider()) return { applied: false, provider: _storedProvider(), reason: 'saved' };
      const provider = _readyProvider();
      if (!provider) return { applied: false, provider: '', reason: 'unavailable' };
      try {
        localStorage.setItem('chat-provider', provider);
      } catch {
        // プライベートモード等で保存できなくても、この起動中の初期選択は適用する。
      }
      if (typeof _chatState !== 'undefined' && _chatState) {
        _chatState.provider = provider;
        _chatState.model = _storedModel(provider)
          || (typeof _chatDefaultModel === 'function' ? _chatDefaultModel(provider) : '');
        _chatState.pendingModel = _chatState.model;
      }
      const select = document.getElementById('chat-provider');
      if (select) select.value = provider;
      return { applied: true, provider, reason: 'installed-cli' };
    }).finally(() => {
      _applying = null;
    });
    return _applying;
  }

  global.GBChatProviderDefault = {
    priority: CLI_PRIORITY.slice(),
    applyFirstRun,
  };
})(window);
