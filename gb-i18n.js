/* Minimal i18n scaffold for future localization. */
(function() {
  'use strict';

  const DEFAULT_LOCALE = 'ja';
  const DEFAULT_MESSAGES = {
    'chat.systemPromptIntro': 'あなたはMeldexで動作する創作支援アシスタントです。日本語で応答してください。',
  };
  const state = {
    locale: DEFAULT_LOCALE,
    messages: { ...DEFAULT_MESSAGES },
  };

  function t(key, fallback) {
    const value = state.messages[key];
    return value == null || value === '' ? (fallback == null ? key : fallback) : String(value);
  }

  async function load(locale = DEFAULT_LOCALE) {
    state.locale = locale || DEFAULT_LOCALE;
    try {
      const res = await fetch(`i18n/${encodeURIComponent(state.locale)}.json`, { cache: 'no-cache' });
      if (!res.ok) return state.messages;
      const data = await res.json();
      if (data && typeof data === 'object') state.messages = { ...DEFAULT_MESSAGES, ...data };
    } catch {}
    return state.messages;
  }

  window.MeldexI18n = {
    DEFAULT_LOCALE,
    DEFAULT_MESSAGES,
    state,
    t,
    load,
  };

  load(DEFAULT_LOCALE);
})();
