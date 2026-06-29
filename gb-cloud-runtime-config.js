(function () {
  'use strict';
  const config = {
  "version": {
    "semver": "0.6.160",
    "variant": "cloud-beta"
  },
  "cloudPublicUrl": "https://cam-nagara.github.io/MeldexCloud/Meldex.html",
  "cloudBackupUrl": "",
  "betaFeedback": {
    "googleWebAppUrl": "https://script.google.com/macros/s/AKfycbwwt2QNHhABaxGOki7Gpw-Hm6Lnlqnc0uA1LwKncNrNilptWwj6U5-xQeWJj5cZQrzyRw/exec",
    "feedbackFormUrl": ""
  },
  "updateCheck": {
    "url": "",
    "pageUrl": "https://github.com/cam-nagara/MeldexCloud/releases/tag/v0.6.152"
  },
  "desktop": {
    "currentVersion": "0.6.152",
    "downloadUrl": "https://github.com/cam-nagara/MeldexCloud/releases/download/v0.6.152/Meldex-v0.6.152.zip",
    "releasesUrl": "https://github.com/cam-nagara/MeldexCloud/releases",
    "versions": [
      {
        "version": "0.6.152",
        "downloadUrl": "https://github.com/cam-nagara/MeldexCloud/releases/download/v0.6.152/Meldex-v0.6.152.zip",
        "pageUrl": "https://github.com/cam-nagara/MeldexCloud/releases/tag/v0.6.152",
        "assetName": "Windows用ZIP",
        "sha256": "6dbd5c83188af32fd96494d96cbb03a32c52d6bf3421b90e31f63d6833a3983c",
        "publishedAt": "2026-06-29T13:51:38Z",
        "notesUrl": "https://github.com/cam-nagara/MeldexCloud/releases/tag/v0.6.152"
      }
    ]
  },
  "samples": {
    "downloadUrl": "https://github.com/cam-nagara/MeldexCloud/releases/download/v0.6.152/MeldexSamples.zip"
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
