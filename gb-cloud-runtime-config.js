(function () {
  'use strict';
  const config = {
  "version": {
    "semver": "0.5.435",
    "variant": "cloud-beta"
  },
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
  "desktop": {
    "currentVersion": "v0.5.435 BETA",
    "downloadUrl": "https://github.com/cam-nagara/MeldexCloud/releases",
    "releasesUrl": "https://github.com/cam-nagara/MeldexCloud/releases",
    "versions": []
  },
  "samples": {
    "downloadUrl": "https://github.com/cam-nagara/MeldexCloud/releases"
  },
  "dropbox": {
    "developerAppKey": "ovxy3vacegzu7nu"
  }
};
  window.MeldexCloudRuntimeConfig = Object.freeze({
    version: Object.freeze({
      semver: String(config.version?.semver || ''),
      variant: String(config.version?.variant || 'cloud-beta'),
    }),
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
    desktop: Object.freeze({
      currentVersion: String(config.desktop?.currentVersion || ''),
      downloadUrl: String(config.desktop?.downloadUrl || ''),
      releasesUrl: String(config.desktop?.releasesUrl || ''),
      versions: Object.freeze(Array.isArray(config.desktop?.versions) ? config.desktop.versions : []),
    }),
    samples: Object.freeze({
      downloadUrl: String(config.samples?.downloadUrl || ''),
    }),
    dropbox: Object.freeze({
      developerAppKey: String(config.dropbox?.developerAppKey || ''),
    }),
  });
})();
