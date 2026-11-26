(function () {
  'use strict';

  if (window.MeldexErrorMessages) return;

  // 保存競合として扱うHTTPステータス（409=競合 / 412=事前条件不一致 / 428=版指定必須）
  const CONFLICT_STATUSES = new Set([409, 412, 428]);

  const RULES = [
    {
      test: info => info.status === 409 && /file_exists|既に存在|同名|already exists/i.test(info.raw),
      title: '同名の項目があります',
      message: '同じ名前のファイルまたはフォルダが既に存在しています。',
      action: '別の名前で作成するか、既存の項目を確認してください。',
    },
    {
      // 「競合」「conflict」という語が本文に含まれるだけで一致させない。取り消し・
      // 一覧取得など保存以外の失敗まで「ほかの変更とぶつかりました」と誤表示され、
      // 何もしていない起動直後にこの通知が出る原因になっていた。
      // 実際の保存競合として扱うのは、競合を表すステータスか、保存経路が付ける
      // 競合コード（gb-save-safety.js / gb-storage-adapter の etag_conflict）がある場合だけ。
      test: (info) => {
        if (!/conflict|競合|if[_-]?match|etag_conflict|他のタブ|別プロセス/i.test(info.raw)) return false;
        if (String(info.code || '') === 'etag_conflict') return true;
        return CONFLICT_STATUSES.has(info.status);
      },
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
      test: info => info.code === 'local_api_token_required',
      title: 'Meldexの内部接続が切れました',
      message: '画面とMeldex本体の接続情報が一致していません。',
      action: '編集中の内容を控えてから、Meldexを終了して起動し直してください。',
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
      test: info => info.status === 507 || /no space|disk full|空き容量|ENOSPC/i.test(info.raw),
      title: '保存先の空き容量が不足しています',
      message: '保存先ドライブまたは同期フォルダの空き容量が足りません。',
      action: '不要なファイルを整理し、空き容量を確保してから保存してください。',
    },
    {
      test: info => /タイムアウト|timeout/i.test(info.raw),
      title: '処理の完了を確認できません',
      message: '待機時間を超えました。処理は裏側で続いている可能性があります。',
      action: '同じ操作を繰り返さず、しばらく待って結果を確認してください。',
    },
    {
      test: info => /network|failed to fetch|通信|オフライン/i.test(info.raw),
      title: '通信に失敗しました',
      message: 'Meldex サーバーまたはクラウド保存先との通信が切れました。',
      action: 'ネットワークとMeldexの起動状態を確認してから再試行してください。',
    },
    {
      test: info => /(?:ブラウザ版|クラウド版)では(?:まだ)?未対応の操作です/.test(info.raw),
      title: 'この画面では操作を完了できません',
      message: '現在の画面から直接実行できない操作です。入力内容はそのまま保持されています。',
      action: info => info.nextAction || '対象ファイルをデスクトップ版で開き、同じメニューから操作を続けてください。',
    },
    {
      // 400/405/422/428 は本体が理由の文言を返す。理由を出さないと「操作に失敗しました」だけになり、
      // 何が足りないのか分からない（公開元の種類の登録漏れが原因不明のまま残った実例がある）。
      test: info => info.status === 400 || info.status === 422,
      title: '内容を受け付けられませんでした',
      message: info => _detailText(info) || '送った内容がMeldex本体の確認を通りませんでした。',
      action: '表示中の対象や入力内容を確認してから、もう一度試してください。',
      showDetail: true,
    },
    {
      test: info => info.status === 405,
      title: 'この操作は利用できません',
      message: info => _detailText(info) || 'Meldex本体がこの操作を受け付けませんでした。',
      action: '画面を更新してもう一度試し、繰り返す場合はサポートに送信してください。',
      showDetail: true,
    },
    {
      test: info => info.status === 428,
      title: '必要な情報が足りません',
      message: info => _detailText(info) || '操作に必要な情報が足りませんでした。',
      action: '対象を開き直してから、もう一度試してください。',
      showDetail: true,
    },
    {
      test: info => info.status === 501
        || String(info.code || '') === 'cloud_route_unwired'
        || /not implemented|cloud_route_unwired/i.test(info.raw),
      title: '操作を完了できませんでした',
      message: '画面の操作とクラウド保存先の接続に問題があります。',
      action: '画面を更新してもう一度試し、繰り返す場合はサポートに送信してください。',
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

  // 「HTTP 400: 理由」から理由の部分だけを取り出す
  function _detailText(info) {
    return String(info?.raw || '').replace(/^\s*HTTP\s+\d{3}\s*:?\s*/i, '').trim();
  }

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

  function _code(error) {
    if (error == null || typeof error === 'string') return '';
    return String(error.meldexCode || error.code || error.payload?.code || error.payload?.detail?.code || error.detail?.code || '');
  }

  function _nextAction(error, context) {
    if (error == null || typeof error === 'string') return String(context?.nextAction || '');
    return String(
      error.nextAction || error.next_action || error.payload?.nextAction || error.payload?.next_action
      || error.payload?.detail?.nextAction || error.payload?.detail?.next_action || context?.nextAction || ''
    );
  }

  function translate(error, context) {
    const raw = _rawMessage(error);
    const info = { raw, status: _status(error), code: _code(error), nextAction: _nextAction(error, context), context: context || {} };
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
      message: typeof selected.message === 'function' ? selected.message(info) : selected.message,
      action: typeof selected.action === 'function' ? selected.action(info) : selected.action,
      technical: raw,
      status: info.status,
      matched: !!rule,
      showDetail: !!selected.showDetail,
    };
  }

  function toStatusText(error, context) {
    const info = translate(error, context);
    if ((!info.matched || info.showDetail) && info.message) {
      return `${info.title}: ${info.message} ${info.action}`;
    }
    return `${info.title}: ${info.action}`;
  }

  window.MeldexErrorMessages = {
    translate,
    toStatusText,
  };
})();
