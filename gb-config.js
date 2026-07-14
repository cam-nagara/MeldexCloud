(function () {
  const runtimeConfig = window.MeldexCloudRuntimeConfig || {};

  function _runtimeString(path, fallback) {
    let current = runtimeConfig;
    for (const key of path) current = current && current[key];
    return String(current || fallback || '').trim();
  }

  const releaseConfig = {
    isBeta: true,
    betaLabel: 'BETA',
    publicLabel: 'Meldex Cloud BETA',
    fallbackSemver: _runtimeString(['version', 'semver'], '0.5.x'),
    betaFeedback: {
      googleWebAppUrl: '',
      googleSharedSecret: '',
      usageRole: 'beta-usage',
      crashSheetName: 'crash',
      usageSheetName: 'usage',
      feedbackSheetName: 'feedback',
      feedbackFormUrl: '',
    },
    updateCheck: {
      url: '',
      pageUrl: '',
    },
  };

  releaseConfig.betaFeedback.googleWebAppUrl = _runtimeString(['betaFeedback', 'googleWebAppUrl'], releaseConfig.betaFeedback.googleWebAppUrl);
  releaseConfig.betaFeedback.feedbackFormUrl = _runtimeString(['betaFeedback', 'feedbackFormUrl'], releaseConfig.betaFeedback.feedbackFormUrl);
  releaseConfig.updateCheck.url = _runtimeString(['updateCheck', 'url'], releaseConfig.updateCheck.url);
  releaseConfig.updateCheck.pageUrl = _runtimeString(['updateCheck', 'pageUrl'], releaseConfig.updateCheck.pageUrl);

  window.MeldexCloudBetaScope = Object.freeze({
    label: 'Meldex Cloud BETA',
    supported: Object.freeze([
      'フォルダ',
      'ノート',
      'シナリオ',
      'ボード',
      'シート',
      'カレンダー',
      'スマートシート',
      'クラウド版フルチャット',
      '暗号化APIキーCloud保存',
      '注釈',
      'バージョン管理',
      'フィードバック送信',
      'Dropbox競合検知/解決',
      'スマホ/タブレットUI',
    ]),
    unsupported: Object.freeze([
      'リアルタイム共同編集',
      'ローカルCLI/MCP/OS連携',
      '外部カレンダー同期リレー未設定時のGoogle/CalDAV同期',
    ]),
  });

  window.MeldexReleaseConfig = Object.freeze({
    ...releaseConfig,
    betaFeedback: Object.freeze(releaseConfig.betaFeedback),
    updateCheck: Object.freeze(releaseConfig.updateCheck),
  });

  window.MeldexCloudConfig = Object.freeze({
    dropbox: {
      developerAppKey: _runtimeString(['dropbox', 'developerAppKey'], 'ovxy3vacegzu7nu'),
      scopes: [
        'account_info.read',
        'files.metadata.read',
        'files.metadata.write',
        'files.content.read',
        'files.content.write',
        'sharing.read',
      ],
    },
  });
})();
