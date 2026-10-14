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
    debuggerReporting: {
      baseUrl: '',
      projectSlug: '',
    },
    updateCheck: {
      url: '',
      pageUrl: '',
    },
  };

  releaseConfig.betaFeedback.googleWebAppUrl = _runtimeString(['betaFeedback', 'googleWebAppUrl'], releaseConfig.betaFeedback.googleWebAppUrl);
  releaseConfig.betaFeedback.feedbackFormUrl = _runtimeString(['betaFeedback', 'feedbackFormUrl'], releaseConfig.betaFeedback.feedbackFormUrl);
  releaseConfig.debuggerReporting.baseUrl = _runtimeString(['debuggerReporting', 'baseUrl'], releaseConfig.debuggerReporting.baseUrl);
  releaseConfig.debuggerReporting.projectSlug = _runtimeString(['debuggerReporting', 'projectSlug'], releaseConfig.debuggerReporting.projectSlug);
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
      'Google/Microsoftカレンダー連携',
      'iPhone向けICS購読',
      'クラウド版フルチャット',
      '暗号化APIキーCloud保存',
      'アノテート',
      'バージョン管理',
      'フィードバック送信',
      'Dropbox競合検知/解決',
      'スマホ/タブレットUI',
    ]),
    unsupported: Object.freeze([
      'リアルタイム共同編集',
      'ローカルCLI/MCP/OS連携',
      'ローカルCalDAVサーバー同期・iCal URL購読（.icsファイルのインポート/エクスポートは対応）',
    ]),
  });

  window.MeldexReleaseConfig = Object.freeze({
    ...releaseConfig,
    betaFeedback: Object.freeze(releaseConfig.betaFeedback),
    debuggerReporting: Object.freeze(releaseConfig.debuggerReporting),
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
        // iPhone向けICS購読（gb-cal-ics-subscribe.js）の共有リンク自動作成に必要。
        // 2026-08-04追加。既存の接続セッションは再接続するまでこのスコープを持たない
        // （Dropbox APIエラーで検知し、手動作成手順の案内へフォールバックする）。
        'sharing.write',
      ],
    },
  });
})();
