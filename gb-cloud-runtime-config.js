(function () {
  'use strict';
  const config = {
  "cloudPublicUrl": "https://cam-nagara.github.io/MeldexCloud/Meldex.html",
  "cloudBackupUrl": "",
  "betaFeedback": {
    "googleWebAppUrl": "",
    "feedbackFormUrl": ""
  },
  "updateCheck": {
    "url": "",
    "pageUrl": ""
  },
  "dropbox": {
    "developerAppKey": "ovxy3vacegzu7nu"
  }
};
  window.MeldexCloudRuntimeConfig = Object.freeze({
    cloudPublicUrl: String(config.cloudPublicUrl || ''),
    cloudBackupUrl: String(config.cloudBackupUrl || ''),
    betaFeedback: Object.freeze({
      googleWebAppUrl: String(config.betaFeedback?.googleWebAppUrl || ''),
      feedbackFormUrl: String(config.betaFeedback?.feedbackFormUrl || ''),
    }),
    updateCheck: Object.freeze({
      url: String(config.updateCheck?.url || ''),
      pageUrl: String(config.updateCheck?.pageUrl || ''),
    }),
    dropbox: Object.freeze({
      developerAppKey: String(config.dropbox?.developerAppKey || ''),
    }),
  });
})();
