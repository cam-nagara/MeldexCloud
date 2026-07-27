(function () {
  'use strict';
  const config = {
  "version": {
    "semver": "0.7.071",
    "variant": "cloud-beta"
  },
  "cloudPublicUrl": "https://cam-nagara.github.io/MeldexCloud/",
  "cloudBackupUrl": "",
  "betaFeedback": {
    "googleWebAppUrl": "https://script.google.com/macros/s/AKfycbwwt2QNHhABaxGOki7Gpw-Hm6Lnlqnc0uA1LwKncNrNilptWwj6U5-xQeWJj5cZQrzyRw/exec",
    "feedbackFormUrl": ""
  },
  "updateCheck": {
    "url": "",
    "pageUrl": "https://github.com/cam-nagara/MeldexCloud/releases/tag/v0.7.071"
  },
  "desktop": {
    "currentVersion": "0.7.071",
    "downloadUrl": "https://github.com/cam-nagara/MeldexCloud/releases/download/v0.7.071/Meldex-v0.7.071.zip",
    "releasesUrl": "https://github.com/cam-nagara/MeldexCloud/releases",
    "versions": [
      {
        "version": "0.7.071",
        "downloadUrl": "https://github.com/cam-nagara/MeldexCloud/releases/download/v0.7.071/Meldex-v0.7.071.zip",
        "pageUrl": "https://github.com/cam-nagara/MeldexCloud/releases/tag/v0.7.071",
        "publishedAt": "2026-07-27",
        "assetName": "Meldex-v0.7.071.zip"
      },
      {
        "version": "0.7.041",
        "downloadUrl": "https://github.com/cam-nagara/MeldexCloud/releases/download/v0.7.041/Meldex-v0.7.041.zip",
        "pageUrl": "https://github.com/cam-nagara/MeldexCloud/releases/tag/v0.7.041",
        "publishedAt": "2026-07-23",
        "assetName": "Meldex-v0.7.041.zip"
      },
      {
        "version": "0.6.185",
        "downloadUrl": "https://github.com/cam-nagara/MeldexCloud/releases/download/v0.6.185/Meldex-v0.6.185.zip",
        "pageUrl": "https://github.com/cam-nagara/MeldexCloud/releases/tag/v0.6.185",
        "publishedAt": "2026-07-14",
        "assetName": "Meldex-v0.6.185.zip"
      },
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
  "standaloneApps": {
    "note": {
      "cloudUrl": "apps/note/",
      "windowsAsset": "MeldexNote.zip",
      "downloadUrl": "https://github.com/cam-nagara/MeldexCloud/releases/download/v0.7.071/MeldexNote.zip"
    },
    "scenario": {
      "cloudUrl": "apps/scenario/",
      "windowsAsset": "MeldexScenario.zip",
      "downloadUrl": "https://github.com/cam-nagara/MeldexCloud/releases/download/v0.7.071/MeldexScenario.zip"
    },
    "board": {
      "cloudUrl": "apps/board/",
      "windowsAsset": "MeldexBoard.zip",
      "downloadUrl": "https://github.com/cam-nagara/MeldexCloud/releases/download/v0.7.071/MeldexBoard.zip"
    },
    "sheet": {
      "cloudUrl": "apps/sheet/",
      "windowsAsset": "MeldexSheet.zip",
      "downloadUrl": "https://github.com/cam-nagara/MeldexCloud/releases/download/v0.7.071/MeldexSheet.zip"
    },
    "timer": {
      "cloudUrl": "apps/timer/",
      "windowsAsset": "MeldexTimer.zip",
      "downloadUrl": "https://github.com/cam-nagara/MeldexCloud/releases/download/v0.7.071/MeldexTimer.zip"
    },
    "quick-memo": {
      "cloudUrl": "apps/quick-memo/",
      "windowsAsset": "MeldexQuickMemo.zip",
      "downloadUrl": "https://github.com/cam-nagara/MeldexCloud/releases/download/v0.7.071/MeldexQuickMemo.zip"
    }
  },
  "samples": {
    "downloadUrl": "https://github.com/cam-nagara/MeldexCloud/releases/download/v0.7.071/MeldexSamples.zip"
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
    standaloneApps: Object.freeze(Object.fromEntries(
      Object.entries(config.standaloneApps || {}).map(([appId, app]) => [appId, Object.freeze({
        cloudUrl: String(app?.cloudUrl || ''),
        windowsAsset: String(app?.windowsAsset || ''),
        downloadUrl: String(app?.downloadUrl || ''),
      })])
    )),
    samples: Object.freeze({
      downloadUrl: String(config.samples?.downloadUrl || ''),
    }),
    dropbox: Object.freeze({
      developerAppKey: String(config.dropbox?.developerAppKey || ''),
    }),
  });
})();
