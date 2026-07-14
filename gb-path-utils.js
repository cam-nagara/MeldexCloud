/* gb-path-utils.js: パスをコピー機能向けの共通パスユーティリティ
 *
 * 「パスをコピー」はフォルダツリー・フォルダビュー・ツールメニュー・シートのエントリメニューの
 * 4箇所にあり、コピー結果をドライブレター付きのフル絶対パスへ統一するために使う。
 * vault相対パスを state.vaultPath（絶対パス）と結合し、Windowsのネイティブ表記（\区切り）へ
 * 変換する。ロジックは元々 gb-outliner.part02.part01.js のツリー用ヘルパーにのみ実装されていた
 * ものを、他の3箇所でも使えるよう共通化したもの。
 *
 * 依存なし。window.GBPathUtils として公開する。未ロード時に備え、呼び出し側は
 * `window.GBPathUtils?.resolveForClipboard?.(path, base) ?? path` の形でフォールバックすること。
 */
(function (global) {
  'use strict';

  // ドライブレター（C:\ や C:/）・UNCパス（\\server\share）・先頭/（Dropbox仮想パス等）を絶対パスとみなす
  function isAbsolute(path) {
    const value = String(path || '');
    return /^[a-zA-Z]:[\\/]/.test(value) || /^[/\\]{2}/.test(value) || value.startsWith('/');
  }

  function join(base, rel) {
    const left = String(base || '').replace(/[\\/]+$/, '');
    const right = String(rel || '').replace(/^[\\/]+/, '');
    if (!left) return right;
    if (!right) return left;
    return left + '/' + right;
  }

  // Windows形式（ドライブレター/UNC）のときだけ / を \ に正規化する。
  // 先頭/の仮想パス（Dropboxクラウドモード等）はそのまま返す。
  // ドライブレターの直後は \ と / の両方があり得る（vaultPath は \ 形式、サーバーの相対パスは / 形式のため、
  // join 後は混在する）。どちらでも Windows パスとみなして全区切りを \ へ揃える。
  function toNativeClipboard(path) {
    const value = String(path || '');
    if (/^[a-zA-Z]:[\\/]/.test(value)) return value.replace(/\//g, '\\');
    if (/^[/\\]{2}/.test(value)) return '\\\\' + value.replace(/^[/\\]+/, '').replace(/\//g, '\\');
    return value;
  }

  // path が絶対ならそのまま、相対なら basePath（絶対のときのみ）と結合してから
  // クリップボード用のネイティブ表記へ変換する。basePath が使えない場合は元の path のまま
  // ネイティブ表記化する（安全フォールバック。クラウド/Dropboxモードで vaultPath が
  // 空・仮想パスの場合を含む）。
  function resolveForClipboard(path, basePath) {
    const value = String(path || '');
    if (!value) return value;
    const resolved = (!isAbsolute(value) && basePath && isAbsolute(String(basePath)))
      ? join(basePath, value)
      : value;
    return toNativeClipboard(resolved);
  }

  global.GBPathUtils = { isAbsolute, join, toNativeClipboard, resolveForClipboard };
})(window);
