/* gb-folder.js: split loader stub */
if (typeof __loadSplitScript !== 'function') throw new Error('gb-split-loader.js is not loaded');
// gb-folder.part01〜part03 は1つの元ファイルを任意の位置で分けたもので、境界がブロックの途中に
// ある。独立した部品を間に挟むと、その中身が閉じていないブロックの内側に入り実行されない
// （2026-08-15〜11-18、移動の取り消し・貼り付け方法の選択が無効だった）。独立部品は必ず末尾に置く。
__loadSplitScript('gb-folder.js', [
  'gb-folder.part01.js',
  'gb-folder.part02.js',
  'gb-folder.part03.js',
  'gb-folder-link-batch.js',
  'gb-folder-link-actions.js',
]);
