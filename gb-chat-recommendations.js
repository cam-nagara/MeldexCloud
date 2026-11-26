/* gb-chat-recommendations.js: retired chat recommendations cleanup only. */
(function (global) {
  'use strict';

  const PANEL_ID = 'chat-recommendations-panel';
  const STORAGE_KEY = 'chat-recommendations-dismissed:v1';
  const ENABLED_STORAGE_KEY = 'chat-recommendations-enabled';

  // 「次にできること」は撤廃済み。旧版からの同一ページ再読込でも残存UIと旧設定を消す。
  global.document.getElementById(PANEL_ID)?.remove();
  try {
    global.localStorage.removeItem(STORAGE_KEY);
    global.localStorage.removeItem(ENABLED_STORAGE_KEY);
  } catch {}
  delete global.GBChatRecommendations;
})(window);
