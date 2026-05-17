(function () {
  'use strict';
  const config = {
  "version": {
    "semver": "0.6.0",
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
    "pageUrl": "https://github.com/cam-nagara/Meldex/releases/tag/v0.6.0"
  },
  "desktop": {
    "currentVersion": "0.6.0",
    "downloadUrl": "https://github.com/cam-nagara/Meldex/releases/download/v0.6.0/Meldex-v0.6.0.zip",
    "releasesUrl": "https://github.com/cam-nagara/Meldex/releases",
    "versions": [
      {
        "version": "0.6.0",
        "downloadUrl": "https://github.com/cam-nagara/Meldex/releases/download/v0.6.0/Meldex-v0.6.0.zip",
        "pageUrl": "https://github.com/cam-nagara/Meldex/releases/tag/v0.6.0",
        "assetName": "Windows用ZIP",
        "sha256": "3692ec66a46eaa4c7a73f1b487cdeef0948998595f98d1f000fb41fb6f55ffb6",
        "publishedAt": "2026-05-17T04:30:01Z",
        "notesUrl": "https://github.com/cam-nagara/Meldex/releases/tag/v0.6.0"
      }
    ]
  },
  "samples": {
    "downloadUrl": "https://github.com/cam-nagara/Meldex/releases/download/v0.6.0/MeldexSamples.zip"
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
