(function () {
  'use strict';

  if (window.MeldexErrorMessages) return;

  const RULES = [
    {
      test: info => info.status === 409 && /file_exists|既に存在|同名|already exists/i.test(info.raw),
      title: '同名の項目があります',
      message: '同じ名前のファイルまたはフォルダが既に存在しています。',
      action: '別の名前で作成するか、既存の項目を確認してください。',
    },
    {
      test: info => /conflict|競合|if[_-]?match|etag_conflict|他のタブ|別プロセス/i.test(info.raw),
      title: 'ほかの変更とぶつかりました',
      message: '同じファイルが別のタブまたは別の端末で更新されています。',
      action: '最新の状態を読み込み、必要な内容だけ保存し直してください。',
    },
    {
      test: info => info.status === 423 || /locked|編集ロック|ロック中/i.test(info.raw),
      title: '編集ロック中です',
      message: 'この項目は今、編集できない状態です。',
      action: 'ロック理由を確認し、解除後にもう一度操作してください。',
    },
    {
      test: info => info.status === 404 || /not found|見つかりません/i.test(info.raw),
      title: '項目が見つかりません',
      message: '対象のファイルまたはフォルダが移動・削除された可能性があります。',
      action: 'フォルダツリーを更新し、開き直してください。',
    },
    {
      test: info => info.status === 403 || /forbidden|許可されていない|禁止|権限/i.test(info.raw),
      title: '操作する権限がありません',
      message: '現在の権限ではこの操作を実行できません。',
      action: '管理者に確認するか、別の保存先を選んでください。',
    },
    {
      test: info => info.status === 413 || /too large|payload too large|request entity too large|content length/i.test(info.raw),
      title: 'データが大きすぎます',
      message: '一度に処理する内容が大きすぎます。',
      action: '添付や選択範囲を減らしてから、もう一度試してください。',
    },
    {
      test: info => /no space|disk full|空き容量|ENOSPC/i.test(info.raw),
      title: '保存先の空き容量が不足しています',
      message: '保存先ドライブまたは同期フォルダの空き容量が足りません。',
      action: '不要なファイルを整理し、空き容量を確保してから保存してください。',
    },
    {
      test: info => /network|failed to fetch|通信|オフライン|タイムアウト|timeout/i.test(info.raw),
      title: '通信に失敗しました',
      message: 'Meldex サーバーまたはクラウド保存先との通信が切れました。',
      action: 'ネットワークとMeldexの起動状態を確認してから再試行してください。',
    },
    {
      test: info => /sqlite|database is locked|database disk image/i.test(info.raw),
      title: 'データベースの処理に失敗しました',
      message: '内部データベースの読み書きで問題が起きました。',
      action: 'Meldexを再起動し、必要なら設定のデータベースメンテナンスを実行してください。',
    },
    {
      test: info => info.status >= 500,
      title: 'Meldex内部でエラーが起きました',
      message: '操作を完了できませんでした。',
      action: '少し待って再試行し、繰り返す場合はサポートに送信してください。',
    },
  ];

  function _rawMessage(error) {
    if (error == null) return '';
    if (typeof error === 'string') return error;
    return String(error.technical || error.raw || error.message || error.detail || error.statusText || error.userMessage || error);
  }

  function _status(error) {
    const value = Number(error?.status || error?.httpStatus || error?.payload?.status);
    if (Number.isFinite(value) && value > 0) return value;
    const match = _rawMessage(error).match(/HTTP\s+(\d{3})/i);
    return match ? Number(match[1]) : 0;
  }

  function translate(error, context) {
    const raw = _rawMessage(error);
    const info = { raw, status: _status(error), context: context || {} };
    const rule = RULES.find(item => {
      try { return item.test(info); } catch (_) { return false; }
    });
    const fallback = {
      title: '操作に失敗しました',
      message: raw || '原因不明のエラーが発生しました。',
      action: 'もう一度試し、繰り返す場合はサポートに送信してください。',
    };
    const selected = rule || fallback;
    return {
      title: selected.title,
      message: selected.message,
      action: selected.action,
      technical: raw,
      status: info.status,
      matched: !!rule,
    };
  }

  function toStatusText(error, context) {
    const info = translate(error, context);
    if (!info.matched && info.message) {
      return `${info.title}: ${info.message} ${info.action}`;
    }
    return `${info.title}: ${info.action}`;
  }

  window.MeldexErrorMessages = {
    translate,
    toStatusText,
  };
})();
