(function () {
  'use strict';
  const config = {
  "version": {
    "semver": "0.6.129",
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
    "pageUrl": "https://github.com/cam-nagara/MeldexCloud/releases/tag/v0.6.129"
  },
  "desktop": {
    "currentVersion": "0.6.129",
    "downloadUrl": "https://github.com/cam-nagara/MeldexCloud/releases/download/v0.6.129/Meldex-v0.6.129.zip",
    "releasesUrl": "https://github.com/cam-nagara/MeldexCloud/releases",
    "versions": [
      {
        "version": "0.6.129",
        "downloadUrl": "https://github.com/cam-nagara/MeldexCloud/releases/download/v0.6.129/Meldex-v0.6.129.zip",
        "pageUrl": "https://github.com/cam-nagara/MeldexCloud/releases/tag/v0.6.129",
        "assetName": "Windows用ZIP",
        "sha256": "76617b23f4538548ff98791a896061ddc3fbbfc8c36872229dca780c944ed415",
        "publishedAt": "2026-06-20T19:34:35Z",
        "notesUrl": "https://github.com/cam-nagara/MeldexCloud/releases/tag/v0.6.129"
      }
    ]
  },
  "samples": {
    "downloadUrl": "https://github.com/cam-nagara/MeldexCloud/releases/download/v0.6.129/MeldexSamples.zip"
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
