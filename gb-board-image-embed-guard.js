/* gb-board-image-embed-guard.js: 画像埋め込み時のサイズ確認ダイアログ
 *
 * .mel-board のカード画像・背景画像は埋め込みを既定にする
 * (proprietary-format-sidecar-cleanup-plan-2026-07-31.md §5.1)。
 * ただし埋め込みでファイルが過大になる場合は、保存前にサイズを案内し、
 * ユーザーが「埋め込み」「リンク」を選べるようにする。
 *
 * しきい値5MBの根拠: gb-compare.js の COMPARE_LARGE_FILE_SKIP_BYTES、
 * gb-cloud-conflict-resolver.js の BINARY_FULL_HASH_MAX_BYTES と同じ、
 * 既存の「大きいファイル」しきい値に合わせた。Web Clipper 拡張の埋め込み上限
 * (10MB) より小さく設定し、.mel-board 1ファイルに複数の埋め込み画像が
 * 集まっても肥大化しにくい水準にしている。
 */
(function (global) {
  'use strict';

  const EMBED_CONFIRM_BYTES = 5 * 1024 * 1024;

  // 複数ファイルの同時ドロップ/貼り付けでダイアログが重ならないよう直列化する
  let dialogQueue = Promise.resolve();

  function formatBytes(bytes) {
    if (typeof global.formatFileSize === 'function') return global.formatFileSize(bytes);
    const mb = Math.max(0, Number(bytes) || 0) / (1024 * 1024);
    return Math.round(mb * 10) / 10 + ' MB';
  }

  async function askEmbedOrLink(bytes, fileName) {
    if (typeof global.cfConfirm !== 'function') return 'embed';
    const title = String(fileName || '画像').trim();
    const message = `${title}\n画像サイズ: ${formatBytes(bytes)}\n埋め込むと保存先の容量が増えます。`;
    const embed = await global.cfConfirm(message, {
      okLabel: '埋め込み',
      cancelLabel: 'リンク',
    });
    return embed ? 'embed' : 'link';
  }

  // bytes: 画像データのバイト数, fileName: ダイアログに表示するファイル名(省略可)
  // 戻り値: Promise<'embed' | 'link'>
  function resolveImageEmbedChoice(bytes, fileName) {
    const size = Number(bytes) || 0;
    if (size <= EMBED_CONFIRM_BYTES) return Promise.resolve('embed');
    const run = () => askEmbedOrLink(size, fileName);
    const queued = dialogQueue.then(run, run);
    dialogQueue = queued.catch(() => {});
    return queued;
  }

  // bd接頭辞のフラットな関数として公開する（typeof での安全な存在確認のため。
  // `typeof MeldexBoardImageEmbedGuard?.resolveImageEmbedChoice` のようなプロパティアクセスは
  // MeldexBoardImageEmbedGuard 自体が未宣言だと ReferenceError になり typeof の安全性が働かない）
  global.bdResolveImageEmbedChoice = resolveImageEmbedChoice;
  global.MeldexBoardImageEmbedGuard = {
    EMBED_CONFIRM_BYTES,
    resolveImageEmbedChoice,
  };
})(window);
