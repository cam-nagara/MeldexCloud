// ============================================================
// gb-shortcuts.js — ショートカットキー中央管理＆ツールチップ統一
// ============================================================

// === Part 1: ショートカットレジストリ ===

const GB_SHORTCUTS = {
  // --- 全般 ---
  'global.save':          { key: '',             label: '自動保存を即時反映',        scope: 'global' },
  'global.new':           { key: 'ctrl+n',       label: '新規作成',                  scope: 'global' },
  'global.quickOpen':     { key: 'ctrl+p',       label: 'クイックオープン',           scope: 'global' },
  'global.undo':          { key: 'ctrl+z',       label: '元に戻す',                  scope: 'global' },
  'global.redo':          { key: 'ctrl+y',       label: 'やり直し',                  scope: 'global' },
  'global.redo2':         { key: 'ctrl+shift+z', label: 'やり直し（代替）',           scope: 'global' },
  'global.search':        { key: 'ctrl+f',       label: '現在のパネルを検索と置換',   scope: 'global' },
  'global.vaultSearch':   { key: 'ctrl+shift+f', label: 'ソースフォルダ全体検索',     scope: 'global' },
  'global.annotation':    { key: 'alt+a',        label: '注釈ツールバーの切替',       scope: 'global' },
  'global.maxPane':       { key: 'ctrl+shift+m', label: 'パネル最大化/復元',         scope: 'global' },
  'global.closeTab':      { key: 'ctrl+w',       label: 'タブを閉じる',              scope: 'global' },
  'global.nextTab':       { key: 'ctrl+tab',     label: '次のタブ',                  scope: 'global' },
  'global.prevTab':       { key: 'ctrl+shift+tab', label: '前のタブ',               scope: 'global' },
  'global.commandPalette': { key: 'ctrl+shift+p', label: 'コマンドパレット',         scope: 'global' },
  'global.settings':      { key: 'ctrl+,',       label: '設定を開く',                scope: 'global' },
  'global.shortcutHelp':  { key: 'ctrl+/',       label: 'ショートカット設定を開く',  scope: 'global' },
  'global.navBack':       { key: 'alt+arrowleft',  label: 'パネル履歴を戻る',       scope: 'global' },
  'global.navForward':    { key: 'alt+arrowright', label: 'パネル履歴を進む',       scope: 'global' },
  'global.navBackBrowser': { key: 'browserback',    label: '戻るボタンでパネル履歴を戻る', scope: 'global' },
  'global.navForwardBrowser': { key: 'browserforward', label: '進むボタンでパネル履歴を進む', scope: 'global' },
  'global.fullscreen':    { key: 'f11',          label: 'フルスクリーン',             scope: 'global' },
  'global.reload':        { key: 'ctrl+shift+r', label: 'リロード',                  scope: 'global' },
  'global.reload2':       { key: 'f5',           label: 'リロード（F5）',             scope: 'global' },
  'global.addComment':    { key: 'alt+shift+c',  label: '注釈コメントを追加',        scope: 'global' },

  // --- 横断アクションID契約（各画面は同じIDをMeldexShortcutRegistryへ登録する） ---
  // 注釈・コメントはどの画面でも使うため、上の global.annotation / global.addComment が正本。
  'chat.focusInput':      { key: 'ctrl+shift+j', label: 'チャット入力欄へ移動',       scope: 'global' },
  'chat.send':            { key: 'enter',        label: 'チャットを送信',             scope: 'chat' },

  // 単独ビューワーのローカル登録と同じID。Meldex本体の設定画面からも編集できる。
  'viewer.playPause':    { key: 'space',            label: '再生 / 一時停止', scope: 'viewer' },
  'viewer.prevFolder':   { key: 'arrowup',          label: '前のフォルダ', scope: 'viewer' },
  'viewer.nextFolder':   { key: 'arrowdown',        label: '次のフォルダ', scope: 'viewer' },
  'viewer.shiftForward': { key: 'shift+arrowright', label: '1枚ずらして進む', scope: 'viewer' },
  'viewer.shiftBackward':{ key: 'shift+arrowleft',  label: '1枚ずらして戻る', scope: 'viewer' },
  'viewer.next':         { key: 'arrowright',       label: '次へ', scope: 'viewer' },
  'viewer.prev':         { key: 'arrowleft',        label: '前へ', scope: 'viewer' },
  'viewer.toggleHud':    { key: 'h',                label: '情報表示の切替', scope: 'viewer' },
  'viewer.fullscreen':   { key: 'f',                label: '全画面表示', scope: 'viewer' },
  'viewer.reversePlay':  { key: 'r',                label: '逆再生の切替', scope: 'viewer' },
  'viewer.flipH':        { key: 'm',                label: '左右反転', scope: 'viewer' },
  'viewer.original':     { key: 'o',                label: '原寸表示', scope: 'viewer' },
  'viewer.rotate':       { key: 'q',                label: '回転', scope: 'viewer' },
  'viewer.zoomIn':       { key: '=',                label: '拡大', scope: 'viewer' },
  'viewer.zoomOut':      { key: '-',                label: '縮小', scope: 'viewer' },
  'viewer.fitContain':   { key: '1',                label: '画面に合わせる', scope: 'viewer' },
  'viewer.fitHeight':    { key: '2',                label: '高さに合わせる', scope: 'viewer' },
  'viewer.fitWidth':     { key: '3',                label: '幅に合わせる', scope: 'viewer' },
  'viewer.fitNone':      { key: '4',                label: 'フィットしない', scope: 'viewer' },
  'viewer.annotation':   { key: 'a',                label: '注釈の切替', scope: 'viewer' },

  // 常駐アプリはこの5 IDをPersonal Preferencesから取得し、OS登録へ反映する。
  'tray.screenshot.full':   { key: 'ctrl+shift+s', label: '全画面を撮影', scope: 'tray' },
  'tray.screenshot.region': { key: 'ctrl+alt+r',   label: '範囲を撮影', scope: 'tray' },
  'tray.screenshot.window': { key: 'ctrl+shift+w', label: 'ウィンドウを撮影', scope: 'tray' },
  'tray.quickMemo':         { key: 'ctrl+alt+m',   label: 'クイックメモを開く', scope: 'tray' },
  'tray.sticky.new':        { key: 'ctrl+alt+s',   label: '新規付箋を作成', scope: 'tray' },

  // --- ノートエディタ ---
  'note.bold':            { key: 'ctrl+b',       label: '太字',                      scope: 'note' },
  'note.italic':          { key: 'ctrl+i',       label: '斜体',                      scope: 'note' },
  'note.underline':       { key: 'ctrl+u',       label: '下線',                      scope: 'note' },
  'note.strike':          { key: 'ctrl+shift+x', label: '取り消し線',                 scope: 'note' },
  'note.h1':              { key: 'ctrl+shift+1', label: '見出し1',                   scope: 'note' },
  'note.h2':              { key: 'ctrl+shift+2', label: '見出し2',                   scope: 'note' },
  'note.h3':              { key: 'ctrl+shift+3', label: '見出し3',                   scope: 'note' },
  'note.h4':              { key: 'ctrl+shift+4', label: '見出し4',                   scope: 'note' },
  'note.h5':              { key: 'ctrl+shift+5', label: '見出し5',                   scope: 'note' },
  'note.h6':              { key: 'ctrl+shift+6', label: '見出し6',                   scope: 'note' },
  'note.body':            { key: 'ctrl+shift+0', label: '本文に戻す',                scope: 'note' },
  'note.ol':              { key: 'ctrl+shift+7', label: '番号付きリスト',             scope: 'note' },
  'note.ul':              { key: 'ctrl+shift+8', label: '箇条書きリスト',             scope: 'note' },
  'note.quote':           { key: 'ctrl+shift+9', label: '引用',                      scope: 'note' },
  'note.hr':              { key: 'ctrl+shift+h', label: '水平線を挿入',              scope: 'note' },
  'note.indent':          { key: 'tab',          label: 'インデント',                scope: 'note' },
  'note.outdent':         { key: 'shift+tab',    label: 'アウトデント',              scope: 'note' },
  // 修正4（バグ報告§4）: alt+shift+arrowup/down は Windows既定の入力言語切替
  // ホットキー（Alt+Shift）と衝突し、実機のキー操作では信頼できないことが
  // 確認された（合成イベントでは正しく動作するがOSに先取りされ得る）。
  // git log -S 調査: 初期実装は alt+arrowup/down、v0.5.140(9e364c3f)で
  // alt+shift+arrowup/down へ変更（Alt+↓をルビポップアップに転用したため）。
  // 「ctrl+arrowup/down」がnoteスコープで使われた記録は本リポジトリ履歴に無いが、
  // シナリオの行移動(scenario.moveUp/moveDown)は既にこの組み合わせを使っており、
  // OSホットキーとも衝突しない。scope('note'/'scenario')で分離されるため、
  // 同一キーの再利用による実害は無い（_checkKeyConflict もscope不一致はコンフリクト
  // 扱いにしない）。
  'note.moveUp':          { key: 'ctrl+arrowup',  label: 'ブロックを上に移動',   scope: 'note' },
  'note.moveDown':        { key: 'ctrl+arrowdown', label: 'ブロックを下に移動', scope: 'note' },
  'note.link':            { key: 'ctrl+k',       label: 'リンクを挿入',              scope: 'note' },
  'note.plainPaste':      { key: 'ctrl+shift+v', label: 'プレーンテキスト貼り付け',   scope: 'note' },
  'note.replace':         { key: 'ctrl+h',       label: '検索と置換',                scope: 'note' },
  'note.codeBlock':       { key: 'ctrl+shift+`', label: 'コードブロック挿入',         scope: 'note' },
  'note.checklist':       { key: 'ctrl+shift+l', label: 'チェックリスト',             scope: 'note' },
  'note.callout':         { key: 'alt+shift+o',  label: 'コールアウトに変換',         scope: 'note' },
  'note.duplicate':       { key: 'ctrl+d',       label: '行を複製',                  scope: 'note' },
  'note.ruby':            { key: 'alt+arrowdown', label: 'ルビを設定',                scope: 'note' },
  'note.newParagraph':    { key: 'ctrl+enter',   label: '次の段落を追加',            scope: 'note' },

  // --- シナリオ ---
  // 実処理は gb-scriptnote-editor.* の既存 keydown / paste ハンドラに委譲する。
  'scenario.addRow':       { key: 'enter',        label: '行を追加',                  scope: 'scenario' },
  'scenario.addRowSameType': { key: 'ctrl+enter', label: '同タイプ行を追加',           scope: 'scenario' },
  'scenario.deleteRow':    { key: 'shift+delete', label: '行を削除',                  scope: 'scenario' },
  'scenario.moveUp':       { key: 'ctrl+arrowup', label: '行を上に移動',              scope: 'scenario' },
  'scenario.moveDown':     { key: 'ctrl+arrowdown', label: '行を下に移動',            scope: 'scenario' },
  'scenario.selectAll':    { key: 'ctrl+a',       label: '全行を選択',                scope: 'scenario' },
  'scenario.newline':      { key: 'shift+enter',  label: 'セル内改行',                scope: 'scenario' },
  'scenario.copy':         { key: 'ctrl+c',       label: 'セルのコピー',              scope: 'scenario' },
  'scenario.paste':        { key: 'ctrl+v',       label: 'セルの貼り付け',            scope: 'scenario' },
  'scenario.cut':          { key: 'ctrl+x',       label: 'セルの切り取り',            scope: 'scenario' },
  'scenario.tab':          { key: 'tab',          label: 'タイプメニューを開く',       scope: 'scenario' },
  'scenario.escape':       { key: 'escape',       label: '編集キャンセル',             scope: 'scenario' },
  'scenario.deselectAll':  { key: 'ctrl+d',       label: '選択を解除',                scope: 'scenario' },
  'scenario.pasteInCell':  { key: 'ctrl+shift+v', label: 'セル内に貼り付け',           scope: 'scenario' },
  'scenario.ruby':         { key: 'ctrl+r',       label: 'ルビを設定',                scope: 'scenario' },
  'scenario.search':       { key: 'ctrl+f',       label: '検索と置換',                scope: 'scenario' },
  'scenario.replace':      { key: 'ctrl+h',       label: '置換',                      scope: 'scenario' },
  'scenario.undo':         { key: 'ctrl+z',       label: '元に戻す',                  scope: 'scenario' },
  'scenario.redo':         { key: 'ctrl+y',       label: 'やり直す',                  scope: 'scenario' },

  // --- データベース ---
  'db.tab':               { key: 'tab',          label: '次のセルへ移動',            scope: 'database' },
  'db.enter':             { key: 'enter',        label: 'エントリを開く / 編集',      scope: 'database' },
  'db.edit':              { key: 'f2',           label: 'セル / エントリ名を編集',   scope: 'database' },
  'db.newEntry':          { key: 'ctrl+enter',   label: '新規エントリ追加',           scope: 'database' },
  'db.newProp':           { key: 'ctrl+shift+enter', label: '新規列追加',    scope: 'database' },
  'db.search':            { key: 'ctrl+f',       label: '現在のシートを検索と置換',   scope: 'database' },
  'db.replace':           { key: 'ctrl+h',       label: '現在のシートで置換',         scope: 'database' },
  'db.advancedFilter':    { key: 'ctrl+shift+f', label: '複数条件フィルタ',           scope: 'database' },
  'db.bulkEdit':          { key: 'ctrl+e',       label: '選択エントリを一括編集',     scope: 'database' },
  'db.copy':              { key: 'ctrl+c',       label: 'セル値のコピー',            scope: 'database' },
  'db.paste':             { key: 'ctrl+v',       label: 'セル値の貼り付け',          scope: 'database' },
  'db.selectAllRows':      { key: 'ctrl+a',       label: '全エントリを選択',          scope: 'database' },
  'db.deselectAllRows':    { key: 'ctrl+d',       label: 'エントリ選択を解除',        scope: 'database' },
  'db.escape':            { key: 'escape',       label: '編集キャンセル / 選択解除',  scope: 'database' },
  'db.filter':            { key: 'ctrl+shift+l', label: 'フィルタの表示/非表示',      scope: 'database' },

  // --- ボード ---
  'board.search':         { key: 'ctrl+f',       label: 'ボード内を検索と置換',      scope: 'board' },
  'board.replace':        { key: 'ctrl+h',       label: 'ボード内を置換',            scope: 'board' },
  'board.delete':         { key: 'delete',       label: 'カードを削除',              scope: 'board' },
  'board.selectAll':      { key: 'ctrl+a',       label: '全要素を選択',              scope: 'board' },
  'board.deselectAll':    { key: 'ctrl+d',       label: '全選択解除',                scope: 'board' },
  'board.edit':           { key: 'f2',           label: 'テキスト編集',              scope: 'board' },
  'board.addChild':       { key: 'ctrl+enter',   label: '子カードを追加',            scope: 'board' },
  'board.addChildTab':    { key: 'tab',          label: '子カードを追加 (Tab)',      scope: 'board' },
  'board.addSibling':     { key: 'enter',        label: '同階層カードを追加',        scope: 'board' },
  'board.ctrlArrowUp':    { key: 'ctrl+arrowup',    label: '↑: 兄弟入替 / 子階層展開・折りたたみ', scope: 'board' },
  'board.ctrlArrowDown':  { key: 'ctrl+arrowdown',  label: '↓: 兄弟入替 / 子階層展開・折りたたみ', scope: 'board' },
  'board.ctrlArrowLeft':  { key: 'ctrl+arrowleft',  label: '←: 兄弟入替 / 子階層展開・折りたたみ', scope: 'board' },
  'board.ctrlArrowRight': { key: 'ctrl+arrowright', label: '→: 兄弟入替 / 子階層展開・折りたたみ', scope: 'board' },
  'board.copy':           { key: 'ctrl+c',       label: 'コピー',                    scope: 'board' },
  'board.paste':          { key: 'ctrl+v',       label: '貼り付け',                  scope: 'board' },
  'board.cut':            { key: 'ctrl+x',       label: '切り取り',                  scope: 'board' },
  'board.pasteImage':     { key: 'ctrl+shift+v', label: '画像を貼り付け',            scope: 'board' },
  'board.zoomIn':         { key: 'ctrl+=',       label: 'ズームイン',                scope: 'board' },
  'board.zoomOut':        { key: 'ctrl+-',       label: 'ズームアウト',              scope: 'board' },
  'board.zoomFit':        { key: 'ctrl+0',       label: '全体表示にフィット',         scope: 'board' },
  'board.zoom100':        { key: 'ctrl+1',       label: '100%表示',                  scope: 'board' },

  // --- カレンダー ---
  'cal.newEvent':         { key: 'n',            label: '新規イベント',              scope: 'calendar' },
  'cal.delete':           { key: 'delete',       label: 'イベントを削除',            scope: 'calendar' },
  'cal.today':            { key: 't',            label: '今日に移動',                scope: 'calendar' },
  'cal.prev':             { key: 'arrowleft',    label: '前の期間に移動',            scope: 'calendar' },
  'cal.next':             { key: 'arrowright',   label: '次の期間に移動',            scope: 'calendar' },
  'cal.enter':            { key: 'enter',        label: 'イベント作成 / 編集',        scope: 'calendar' },
  'cal.escape':           { key: 'escape',       label: 'ポップアップを閉じる',       scope: 'calendar' },
  'cal.viewDay':          { key: 'd',            label: '日表示',                    scope: 'calendar' },
  'cal.viewWeek':         { key: 'w',            label: '週表示',                    scope: 'calendar' },
  'cal.viewMonth':        { key: 'm',            label: '月表示',                    scope: 'calendar' },

  // --- CSVエディタ ---
  'csv.tab':              { key: 'tab',          label: '右のセルへ移動',            scope: 'csv' },
  'csv.enter':            { key: 'enter',        label: '編集を確定',                scope: 'csv' },
  'csv.escape':           { key: 'escape',       label: '編集をキャンセル',           scope: 'csv' },
  'csv.copy':             { key: 'ctrl+c',       label: 'セルのコピー',              scope: 'csv' },
  'csv.selectAll':        { key: 'ctrl+a',       label: '全セル選択',                scope: 'csv' },
  'csv.search':           { key: 'ctrl+f',       label: 'テーブル内検索',            scope: 'csv' },
  'csv.edit':             { key: 'f2',           label: 'セル編集開始',              scope: 'csv' },

  // --- エクスプローラー ---
  'explorer.selectAll':   { key: 'ctrl+a',       label: '全アイテムを選択',          scope: 'folder' },
  'explorer.open':        { key: 'enter',        label: '選択アイテムを開く',         scope: 'folder' },
  'explorer.rename':      { key: 'f2',           label: 'リネーム',                  scope: 'folder' },
  'explorer.delete':      { key: 'delete',       label: '削除',                      scope: 'folder' },

  // --- マウス操作・スペースキーを使う操作（参照専用。割り当ての変更はできない） ---
  // 一覧に「キーだけ」が並ぶと、スペースキーやドラッグで行う操作が抜け落ちる。
  // readonly: true の項目は表示専用で、キー割り当ての競合判定・変更対象にしない。
  'global.dragPanel':      { key: '', display: 'タブのドラッグ',         label: 'パネルの配置を変える',            scope: 'global', readonly: true },
  'global.ctrlDropOpen':   { key: '', display: 'Ctrl+ドロップ',          label: 'ドロップ先のパネルで開く',        scope: 'global', readonly: true },

  'board.mouseAddCard':    { key: '', display: 'ダブルクリック',          label: 'カードの追加 / 編集',             scope: 'board', readonly: true },
  'board.mouseRectSelect': { key: '', display: '左ドラッグ（空白）',      label: '範囲選択',                        scope: 'board', readonly: true },
  'board.mouseMoveCard':   { key: '', display: '左ドラッグ（カード）',    label: 'カードを移動',                    scope: 'board', readonly: true },
  'board.mouseRightPan':   { key: '', display: '右ドラッグ（空白）',      label: '表示位置を移動',                  scope: 'board', readonly: true },
  'board.mouseLine':       { key: '', display: '右ドラッグ（カード）',    label: 'ラインを引く',                    scope: 'board', readonly: true },
  'board.wheelZoom':       { key: '', display: 'ホイール',               label: '拡大・縮小',                      scope: 'board', readonly: true },
  'board.middlePan':       { key: '', display: '中ボタンドラッグ',        label: '表示位置を移動',                  scope: 'board', readonly: true },
  'board.spacePan':        { key: '', display: 'Space+ドラッグ',         label: '表示位置を移動',                  scope: 'board', readonly: true },
  'board.spaceZoom':       { key: '', display: 'Ctrl+Space+ドラッグ',    label: '拡大・縮小',                      scope: 'board', readonly: true },
  'board.spaceRotate':     { key: '', display: 'Shift+Space+ドラッグ',   label: '表示を回転',                      scope: 'board', readonly: true },
  'board.spaceArrowPan':   { key: '', display: 'Space+矢印',            label: '表示位置を移動',                  scope: 'board', readonly: true },
  'board.spaceResetView':  { key: '', display: 'Space+ダブルクリック',   label: '表示をリセット',                  scope: 'board', readonly: true },
  'board.spaceFocus':      { key: '', display: 'Space',                 label: '選択したカードに寄る / 戻す',      scope: 'board', readonly: true },
  'board.dragTail':        { key: '', display: 'Alt+Shift+ドラッグ（カード）', label: 'フキダシのしっぽを追加',     scope: 'board', readonly: true },

  'folder.dragRectSelect': { key: '', display: 'ドラッグ（空白）',        label: '範囲選択',                        scope: 'folder', readonly: true },
  'folder.ctrlDragAdd':    { key: '', display: 'Ctrl+ドラッグ（空白）',   label: '選択に追加',                      scope: 'folder', readonly: true },
  'folder.ctrlWheelZoom':  { key: '', display: 'Ctrl+ホイール',          label: '表示倍率を変える',                scope: 'folder', readonly: true },
  'folder.dragItem':       { key: '', display: '項目のドラッグ',          label: '移動 / ほかの画面へ渡す',          scope: 'folder', readonly: true },

  'database.dragRange':    { key: '', display: 'ドラッグ',               label: 'セルの範囲選択',                  scope: 'database', readonly: true },
  'database.dragRow':      { key: '', display: 'ハンドルのドラッグ',      label: '行の並べ替え',                    scope: 'database', readonly: true },
  'database.dragColumn':   { key: '', display: '列の境界をドラッグ',      label: '列幅を変える',                    scope: 'database', readonly: true },

  'note.dragBlock':        { key: '', display: 'ハンドルのドラッグ',      label: 'ブロックの並べ替え',              scope: 'note', readonly: true },

  'calendar.dragCreate':   { key: '', display: 'ドラッグ',               label: '予定を作る',                      scope: 'calendar', readonly: true },
  'calendar.dragMove':     { key: '', display: '予定のドラッグ',          label: '予定を移動',                      scope: 'calendar', readonly: true },
  'calendar.dragResize':   { key: '', display: '端のドラッグ',            label: '予定の長さを変える',              scope: 'calendar', readonly: true },

  'viewer.dragPan':        { key: '', display: 'ドラッグ',               label: '表示位置を移動',                  scope: 'viewer', readonly: true },

  'annotation.dragDraw':   { key: '', display: 'ドラッグ',               label: '注釈を描く',                      scope: 'annotation', readonly: true },
  'annotation.dragTail':   { key: '', display: 'Alt+Shift+ドラッグ',     label: 'フキダシのしっぽを追加',           scope: 'annotation', readonly: true },

  // --- パネルセット ---
  'panelset.group1':      { key: 'ctrl+alt+1',   label: 'パネルセット ドック1',       scope: 'global' },
  'panelset.group2':      { key: 'ctrl+alt+2',   label: 'パネルセット ドック2',       scope: 'global' },
  'panelset.group3':      { key: 'ctrl+alt+3',   label: 'パネルセット ドック3',       scope: 'global' },
  'panelset.group4':      { key: 'ctrl+alt+4',   label: 'パネルセット ドック4',       scope: 'global' },
  'panelset.group5':      { key: 'ctrl+alt+5',   label: 'パネルセット ドック5',       scope: 'global' },
  'panelset.group6':      { key: 'ctrl+alt+6',   label: 'パネルセット ドック6',       scope: 'global' },
  'panelset.group7':      { key: 'ctrl+alt+7',   label: 'パネルセット ドック7',       scope: 'global' },
  'panelset.group8':      { key: 'ctrl+alt+8',   label: 'パネルセット ドック8',       scope: 'global' },
  'panelset.group9':      { key: 'ctrl+alt+9',   label: 'パネルセット ドック9',       scope: 'global' },
};

const GB_SHORTCUTS_DEFAULT = JSON.parse(JSON.stringify(GB_SHORTCUTS));

// 一覧・カスタム設定・設定UIは gb-shortcut-registry.js（キー配送を持たない共通モジュール）が持つ。
// このファイルは「本体の全ショートカット表」と「実際の処理・配送」を担当する。
// 単独ビューワーやクイックメモのように自前でキーを処理するアプリは、このファイルを読まずに
// レジストリへ自分のキーだけ登録する。
if (typeof window !== 'undefined' && window.MeldexShortcutRegistry) {
  window.MeldexShortcutRegistry.register(GB_SHORTCUTS);
}


// === Part 1-2: スコープ解決 ===

function _viewToScope(view) {
  const map = {
    'page': 'note', 'entity': 'note',
    'pivot': 'database', 'tree': 'database', 'gallery': 'database', 'kanban': 'database',
    'timeline': 'database', 'chart': 'database', 'graph': 'database',
    'board': 'board',
    'calendar': 'calendar',
    'scriptnote': 'scenario',
    'csv': 'csv',
    'folder': 'folder',
    'smart-db': 'database',
  };
  return map[view] || 'global';
}

function _resolveShortcutScope(e) {
  const ae = document.activeElement;
  const target = e?.target?.nodeType === 1 ? e.target : e?.target?.parentElement;
  const editEl = [target, ae].map(el => el?.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"],.chat-rich-input') || el)
    .find(el => el && el.isConnected !== false && (el.isContentEditable || el.contentEditable === 'true' || el.contentEditable === 'plaintext-only' || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.getAttribute?.('role') === 'textbox'));
  const isEditing = !!editEl;

  // 計画書§5工程8-1: noteスコープは全体の state.view ではなく、実フォーカス中の
  // 編集ホストを優先する。state.view 依存では、メインパネル以外
  // （フロート/別タブ/右サイドバー/詳細パネル/エンティティ自由記述）でノートを
  // 編集していても、メインパネルが別ビューを表示していればnoteスコープが返らず
  // ショートカット（Alt+Shift+↑/↓等）が無視されていた（右サイドバーの
  // #dp-editable も同様に無視されていた）。scenario側は既存のstate.view依存
  // 判定（下記の isEditing 分岐）を変更しない — チャット等のドッキング入力欄が
  // #right-panel の外にあり `.gb-se-root` 外で編集中の場合に、メインビューが
  // シナリオというだけで誤ってscenarioスコープへ倒れないための既存保護
  // （2026-07-21 導入）を維持する。
  if (isEditing) {
    const noteHostSelector = (typeof MeldexNoteBlockTypes !== 'undefined' && MeldexNoteBlockTypes.EDITABLE_SELECTOR)
      || '#page-content, #entity-freetext, #dp-editable';
    if (editEl.closest?.(noteHostSelector)) return ['global', 'note'];
    if (editEl.closest?.('#chat-input, .chat-rich-input')) return ['global', 'chat'];
  }

  const rightPanel = document.getElementById('right-panel');
  const inRightPanel = !!(rightPanel && (
    (editEl && rightPanel.contains(editEl)) ||
    (ae && rightPanel.contains(ae)) ||
    (target && rightPanel.contains(target))
  ));

  if (inRightPanel && isEditing) return ['global'];
  if (inRightPanel) return ['global', _viewToScope(state.view)];

  if (isEditing) {
    const scope = _viewToScope(state.view);
    if (scope === 'scenario' && editEl?.closest?.('.gb-se-root')) return ['global', 'scenario'];
    return ['global'];
  }

  return ['global', _viewToScope(state.view)];
}


// === Part 1-3: キー判定ヘルパー ===

// キーの正規化・表示・保存の実装は gb-shortcut-registry.js に一本化した。
// 既存の呼び出し箇所を変えずに済むよう、同名の薄いラッパーだけ残す。
function _shortcutRegistry() {
  return typeof window !== 'undefined' ? window.MeldexShortcutRegistry : null;
}

function _normalizeKeyEvent(e) {
  return _shortcutRegistry()?.normalizeKeyEvent(e) ?? null;
}

function _normalizeKeyDef(keyDef) {
  return _shortcutRegistry()?.normalizeKeyDef(keyDef) ?? String(keyDef || '');
}

function _isNativeHardReloadShortcut(e) {
  const key = String(e?.key || '').toLowerCase();
  return !!(e && !e.altKey && e.shiftKey && (e.ctrlKey || e.metaKey) && (key === 'r' || e.code === 'KeyR'));
}

function _isNativeBrowserSaveShortcut(e) {
  const key = String(e?.key || '').toLowerCase();
  return !!(e && !e.altKey && !e.shiftKey && (e.ctrlKey || e.metaKey) && (key === 's' || e.code === 'KeyS' || e.keyCode === 83));
}

function _hasChatMessageTextSelection() {
  const selection = typeof document.getSelection === 'function' ? document.getSelection() : null;
  if (!selection || selection.isCollapsed || !String(selection.toString())) return false;
  const selectors = '#chat-messages .chat-message-bubble, #team-messages .chat-message-bubble, #chat-messages .chat-message-text, #team-messages .chat-message-text';
  const messageEls = Array.from(document.querySelectorAll(selectors));
  if (!messageEls.length) return false;
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    for (const el of messageEls) {
      try {
        if (range.intersectsNode(el)) return true;
      } catch (_) {}
    }
  }
  return false;
}

function _performMeldexHardReload() {
  const reload = () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('devBust', String(Date.now()));
      window.location.replace(url.toString());
    } catch (_) {
      window.location.reload();
    }
  };
  const tasks = [];
  try {
    if (navigator.serviceWorker?.getRegistrations) {
      tasks.push(navigator.serviceWorker.getRegistrations()
        .then(registrations => Promise.all(registrations.map(registration => registration.unregister()))));
    }
  } catch (_) {}
  try {
    if (window.caches?.keys) {
      tasks.push(caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key)))));
    }
  } catch (_) {}
  if (!tasks.length) {
    reload();
    return;
  }
  Promise.allSettled(tasks).then(reload, reload);
}
if (typeof window !== 'undefined') window.__meldexPerformHardReload = _performMeldexHardReload;

// 表示用: "ctrl+shift+a" → "Ctrl+Shift+A"
function _formatKeyDisplay(keyStr) {
  return _shortcutRegistry()?.formatKey(keyStr) ?? String(keyStr || '');
}


// === Part 2-1: カスタム設定の保存 ===

function _getCustomShortcuts() {
  return _shortcutRegistry()?.getCustom() ?? {};
}

function _shortcutKeyDisplay(keyStr) {
  return _shortcutRegistry()?.keyDisplay(keyStr) ?? (keyStr || '未設定');
}

function _saveCustomShortcuts(custom, options) {
  _shortcutRegistry()?.saveCustom(custom, options);
}

function _getEffectiveShortcuts() {
  return _shortcutRegistry()?.effective() ?? JSON.parse(JSON.stringify(GB_SHORTCUTS));
}

// 指定IDのショートカットの現在のキーを取得（ツールチップ用）
function getShortcutKey(id) {
  return _shortcutRegistry()?.keyFor(id) ?? (GB_SHORTCUTS[id]?.key || '');
}

function _shortcutStatusItem(id, label) {
  const key = getShortcutKey(id);
  if (!key) return '';
  const display = typeof _formatKeyDisplay === 'function' ? _formatKeyDisplay(key) : key;
  return display + ' ' + label;
}

function getScriptnoteShortcutStatusText() {
  // 2026-07-17 最新仕様に同期: Tab=タイプ選択・同タイプ行追加・セル内貼付・全選択/選択解除を追加、
  // 「上へ/下へ」は行移動であることが分かる表記へ変更
  return [
    _shortcutStatusItem('scenario.addRow', '行追加'),
    _shortcutStatusItem('scenario.addRowSameType', '同タイプ行追加'),
    _shortcutStatusItem('scenario.newline', 'セル内改行'),
    _shortcutStatusItem('scenario.deleteRow', '行削除'),
    _shortcutStatusItem('scenario.tab', 'タイプ選択'),
    _shortcutStatusItem('scenario.moveUp', '行を上へ'),
    _shortcutStatusItem('scenario.moveDown', '行を下へ'),
    _shortcutStatusItem('scenario.search', '検索'),
    _shortcutStatusItem('scenario.replace', '置換'),
    _shortcutStatusItem('scenario.ruby', 'ルビ'),
    _shortcutStatusItem('scenario.copy', 'コピー'),
    _shortcutStatusItem('scenario.paste', '貼付'),
    _shortcutStatusItem('scenario.pasteInCell', 'セル内貼付'),
    _shortcutStatusItem('scenario.selectAll', '全選択'),
    _shortcutStatusItem('scenario.deselectAll', '選択解除'),
    _shortcutStatusItem('scenario.undo', 'Undo'),
    _shortcutStatusItem('scenario.redo', 'Redo'),
  ].filter(Boolean).join(' | ');
}

function updateScriptnoteShortcutStatusbar(targetEl) {
  const sc = targetEl || document.getElementById('sb-shortcuts');
  if (!sc) return;
  if (!targetEl && typeof state !== 'undefined' && state.view !== 'scriptnote') return;
  sc.textContent = getScriptnoteShortcutStatusText();
}

function getDatabaseShortcutStatusText() {
  return [
    _shortcutStatusItem('db.tab', '次のセル'),
    _shortcutStatusItem('db.enter', '開く / 編集'),
    _shortcutStatusItem('db.edit', 'セル編集'),
    _shortcutStatusItem('db.newEntry', 'エントリ追加'),
    _shortcutStatusItem('db.newProp', '列追加'),
    _shortcutStatusItem('db.search', '検索'),
    _shortcutStatusItem('db.replace', '置換'),
    _shortcutStatusItem('db.advancedFilter', '詳細フィルタ'),
    _shortcutStatusItem('db.bulkEdit', '一括編集'),
    _shortcutStatusItem('db.copy', 'コピー'),
    _shortcutStatusItem('db.paste', '貼り付け'),
    _shortcutStatusItem('db.selectAllRows', '全行選択'),
    _shortcutStatusItem('db.deselectAllRows', '行選択解除'),
    _shortcutStatusItem('db.escape', 'キャンセル'),
    _shortcutStatusItem('db.filter', 'フィルタ表示'),
  ].filter(Boolean).join(' | ');
}

function updateDatabaseShortcutStatusbar(targetEl) {
  const sc = targetEl || document.getElementById('sb-shortcuts');
  if (!sc) return;
  const databaseViews = ['pivot', 'tree', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form'];
  if (!targetEl && typeof state !== 'undefined' && !databaseViews.includes(state.view)) return;
  sc.textContent = getDatabaseShortcutStatusText();
}

function getCsvShortcutStatusText() {
  return [
    _shortcutStatusItem('csv.tab', '右のセル'),
    _shortcutStatusItem('csv.enter', '編集確定'),
    _shortcutStatusItem('csv.edit', 'セル編集'),
    _shortcutStatusItem('csv.copy', 'コピー'),
    _shortcutStatusItem('csv.selectAll', '全セル選択'),
    _shortcutStatusItem('csv.search', '検索'),
    _shortcutStatusItem('csv.escape', 'キャンセル'),
  ].filter(Boolean).join(' | ');
}

function updateCsvShortcutStatusbar(targetEl) {
  const sc = targetEl || document.getElementById('sb-shortcuts');
  if (!sc) return;
  if (!targetEl && typeof state !== 'undefined' && state.view !== 'csv') return;
  sc.textContent = getCsvShortcutStatusText();
}

function getMediaViewerShortcutStatusText() {
  return [
    _shortcutStatusItem('viewer.prev', '前へ'),
    _shortcutStatusItem('viewer.next', '次へ'),
    _shortcutStatusItem('viewer.shiftBackward', '1枚戻る'),
    _shortcutStatusItem('viewer.shiftForward', '1枚進む'),
    _shortcutStatusItem('viewer.playPause', '再生'),
    _shortcutStatusItem('viewer.zoomIn', '拡大'),
    _shortcutStatusItem('viewer.zoomOut', '縮小'),
    _shortcutStatusItem('viewer.flipH', '反転'),
    _shortcutStatusItem('viewer.rotate', '回転'),
    _shortcutStatusItem('viewer.fullscreen', '全画面'),
    _shortcutStatusItem('viewer.toggleHud', '情報'),
    _shortcutStatusItem('viewer.annotation', '注釈'),
  ].filter(Boolean).join(' | ');
}

function updateMediaViewerShortcutStatusbar(targetEl) {
  const sc = targetEl || document.getElementById('sb-shortcuts');
  if (!sc) return;
  // ビューワーは openMedia→openViewer の順で state.view が 'media'→'html' と遷移するため、
  // view名でのガードは行わない（'html' 到達後に openViewer 側から直接呼ばれる。呼び出し元が
  // 表示文脈を判断する契約。v0.7.139）。
  sc.textContent = getMediaViewerShortcutStatusText();
}
if (typeof window !== 'undefined') {
  window.getMediaViewerShortcutStatusText = getMediaViewerShortcutStatusText;
  window.updateMediaViewerShortcutStatusbar = updateMediaViewerShortcutStatusbar;
}

function _runScriptnoteShortcutAction(id, e) {
  const editor = typeof _sn2GetActiveEditor === 'function' ? _sn2GetActiveEditor() : null;
  if (!editor || typeof editor.runShortcutAction !== 'function') return false;
  return editor.runShortcutAction(id, e);
}

function _currentMainPanelSearchTool() {
  const aliases = {
    page: 'page', entity: 'page', note: 'page',
    folder: 'folder',
    board: 'board',
    database: 'database', db: 'database', sheet: 'database', pivot: 'database',
    tree: 'database', gallery: 'database', kanban: 'database', timeline: 'database',
    chart: 'database', graph: 'database', 'smart-db': 'database',
    scriptnote: 'scenario', scenario: 'scenario',
  };
  try {
    const paneId = typeof GBLayout !== 'undefined' ? GBLayout.activePane : '';
    const activeTab = paneId && typeof GBTabs !== 'undefined' ? GBTabs.getActiveTab(paneId) : null;
    const tabTool = aliases[String(activeTab?.type || '').toLowerCase()];
    if (tabTool) return tabTool;
  } catch (_) {
    // レイアウト初期化中は従来どおりstate.viewへフォールバックする。
  }
  const view = typeof state !== 'undefined' ? String(state.view || '').toLowerCase() : '';
  return aliases[view] || '';
}


// === Part 1-5: アクションハンドラマップ ===

function _switchPanelsetGroupByIndex(n) {
  if (typeof GBPanelSet === 'undefined' || typeof GBLayout === 'undefined') return;
  const ap = GBLayout.activePane;
  if (!ap) return;
  function findPanelset(node) {
    if (!node) return null;
    if (node.type === 'panelset') {
      const active = (node.groups || []).find(g => g && g.id === node.activeGroupId);
      if (active?.root && GBLayout.findNode(active.root, ap)) return node;
    }
    if (node.type === 'split' && Array.isArray(node.children)) {
      for (const c of node.children) { const f = findPanelset(c); if (f) return f; }
    }
    return null;
  }
  const ps = findPanelset(GBLayout.root);
  if (!ps || !ps.groups || ps.groups.length < n) return;
  GBPanelSet.switchGroup(ps, ps.groups[n - 1].id);
}

function _activeCalendarShortcutComponent() {
  try {
    if (typeof GBLayout === 'undefined' || typeof GBTabs === 'undefined' || typeof getComponentInstance !== 'function') return null;
    const paneId = GBLayout.activePane;
    const activeTab = paneId ? GBTabs.getActiveTab(paneId) : null;
    if (!activeTab || activeTab.type !== 'calendar') return null;
    const component = getComponentInstance(activeTab.id);
    return component || null;
  } catch {
    return null;
  }
}

function _calendarShortcutSelectedEventId(component) {
  try {
    const selection = typeof component._eventSelection === 'function' ? component._eventSelection() : null;
    if (selection?.size) return [...selection][selection.size - 1] || '';
    const lastId = component._lastSelectedEventId || '';
    const rendered = typeof component._renderedEventIds === 'function' ? component._renderedEventIds() : [];
    return lastId && rendered.includes(lastId) ? lastId : '';
  } catch {
    return '';
  }
}

function _runCalendarShortcut(action) {
  const component = _activeCalendarShortcutComponent();
  if (!component) return false;
  switch (action) {
    case 'newEvent': {
      const date = component._date || new Date();
      const dateStr = typeof component._localDateStr === 'function'
        ? component._localDateStr(date)
        : new Date(date).toISOString().slice(0, 10);
      if (typeof component._openEventInPanel === 'function') {
        component._openEventInPanel(null, dateStr + 'T00:00', dateStr + 'T23:59', true);
        return true;
      }
      return false;
    }
    case 'delete': {
      const id = _calendarShortcutSelectedEventId(component);
      if (!id) return false;
      if (typeof component._deleteEventFromOptions === 'function') component._deleteEventFromOptions(id);
      else if (typeof component._deleteEventFromPanel === 'function') component._deleteEventFromPanel(id);
      else return false;
      return true;
    }
    case 'today':
      if (typeof component._handleAction === 'function') component._handleAction('today');
      else return false;
      return true;
    case 'prev':
      if (typeof component._handleAction === 'function') component._handleAction('prev');
      else return false;
      return true;
    case 'next':
      if (typeof component._handleAction === 'function') component._handleAction('next');
      else return false;
      return true;
    case 'enter': {
      const id = _calendarShortcutSelectedEventId(component);
      if (id && typeof component._openEventInPanel === 'function') component._openEventInPanel(id);
      else return _runCalendarShortcut('newEvent');
      return true;
    }
    case 'escape':
      if (typeof component._setSelectedEvents === 'function') component._setSelectedEvents([]);
      if (typeof component._closeRightPanel === 'function') component._closeRightPanel();
      return true;
    case 'viewDay':
      if (typeof component.setView === 'function') component.setView('day');
      else return false;
      return true;
    case 'viewWeek':
      if (typeof component.setView === 'function') component.setView('week');
      else return false;
      return true;
    case 'viewMonth':
      if (typeof component.setView === 'function') component.setView('month');
      else return false;
      return true;
    default:
      return false;
  }
}

function _activeNoteEditable() {
  const ae = document.activeElement;
  const editable = ae?.closest?.('#page-content, #entity-freetext, #dp-editable') || null;
  if (!editable || editable.contentEditable !== 'true') return null;
  return editable;
}

function _runNoteRichTextCommand(cmd, value) {
  if (!_activeNoteEditable()) return false;
  if (typeof rtCmd === 'function') {
    rtCmd(cmd, value);
  } else {
    document.execCommand(cmd, false, value || null);
  }
}

function _runNoteHeadingShortcut(tag) {
  if (!_activeNoteEditable()) return false;
  if (typeof rtHeading === 'function') {
    rtHeading(tag);
  } else {
    document.execCommand('formatBlock', false, tag);
  }
}

function _currentNoteSelectionRange() {
  const editable = _activeNoteEditable();
  const sel = editable && typeof window.getSelection === 'function' ? window.getSelection() : null;
  if (!editable || !sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const host = range.commonAncestorContainer?.nodeType === 1
    ? range.commonAncestorContainer
    : range.commonAncestorContainer?.parentElement;
  if (!host || !editable.contains(host)) return null;
  return range.cloneRange();
}

function _insertParagraphAfterCurrentNoteBlock() {
  const editable = _activeNoteEditable();
  const sel = editable && typeof window.getSelection === 'function' ? window.getSelection() : null;
  if (!editable || !sel || !sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  const node = range.startContainer?.nodeType === 1 ? range.startContainer : range.startContainer?.parentElement;
  const block = node?.closest?.('p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, div');
  const target = (!block || block === editable || !editable.contains(block)) ? null : block;
  if (target && !target.parentNode) return false;
  const beforeHtml = editable.innerHTML;
  if (typeof _pushCustomUndo === 'function') _pushCustomUndo(editable);
  const next = document.createElement(target?.tagName === 'LI' ? 'li' : 'p');
  next.appendChild(document.createElement('br'));
  (target ? target.parentNode : editable).insertBefore(next, target ? target.nextSibling : null);
  const caret = document.createRange();
  caret.setStart(next, 0);
  caret.collapse(true);
  sel.removeAllRanges();
  sel.addRange(caret);
  if (editable.innerHTML !== beforeHtml) editable.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

const _shortcutHandlers = {

  // ============ 全般 ============

  'global.save': (e) => {
    if (state.view === 'board' && window.MeldexBoardStandalone?.saveCurrentBoard) window.MeldexBoardStandalone.saveCurrentBoard();
    else if (state.view === 'board' && typeof bdSave === 'function') bdSave();
    else if (state.view === 'csv' && typeof saveCsv === 'function') saveCsv();
    else if (state.view === 'scriptnote') {
      const editor = typeof _sn2GetActiveEditor === 'function' ? _sn2GetActiveEditor() : null;
      if (editor?.save) editor.save();
    }
    else {
      if (typeof flushPendingEditorAutosave === 'function') flushPendingEditorAutosave();
      if (typeof showStatus === 'function') showStatus('自動保存を即時反映しました');
    }
  },
  'global.new': () => {
    const typeMap = { page: 'page', entity: 'page', pivot: 'database', tree: 'database', gallery: 'database', kanban: 'database', board: 'board', calendar: 'calendar', csv: 'page', folder: 'page' };
    const type = typeMap[state.view] || 'page';
    if (typeof showAddOutlinerItem === 'function') showAddOutlinerItem(type);
  },
  'global.quickOpen': () => {
    const searchInput = document.getElementById('sidebar-search-input');
    if (searchInput) { searchInput.focus(); searchInput.select(); }
  },
  'chat.focusInput': () => {
    const input = document.getElementById('chat-input');
    if (!input) return false;
    input.focus();
    const length = typeof input.value === 'string' ? input.value.length : 0;
    if (typeof input.setSelectionRange === 'function') input.setSelectionRange(length, length);
  },
  'chat.send': () => {
    if (typeof chatSend !== 'function') return false;
    chatSend();
  },
  'global.undo': () => {
    // contentEditable内ではブラウザデフォルトに任せる（この判定はショートカット側のみに残す。
    // ツールバーボタンはクリック時点でフォーカスがボタンへ移るため、meldexUndo() には入れない）
    const ae = document.activeElement;
    if (ae && (ae.contentEditable === 'true' || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return false;
    if (typeof meldexUndo === 'function') meldexUndo();
  },
  'global.redo': () => {
    const ae = document.activeElement;
    if (ae && (ae.contentEditable === 'true' || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return false;
    if (typeof meldexRedo === 'function') meldexRedo();
  },
  'global.redo2': () => _shortcutHandlers['global.redo'](),
  'global.navBack': (e) => {
    const ae = document.activeElement;
    if (ae && (ae.contentEditable === 'true' || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return false;
    if (typeof navBack === 'function') navBack();
  },
  'global.navForward': (e) => {
    const ae = document.activeElement;
    if (ae && (ae.contentEditable === 'true' || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return false;
    if (typeof navForward === 'function') navForward();
  },
  'global.navBackBrowser': (e) => _shortcutHandlers['global.navBack'](e),
  'global.navForwardBrowser': (e) => _shortcutHandlers['global.navForward'](e),
  'global.search': () => {
    const tool = _currentMainPanelSearchTool();
    if (tool && typeof openCurrentToolbarSearchReplace === 'function') {
      openCurrentToolbarSearchReplace(tool, { trigger: document.activeElement });
      return;
    }
    if (typeof openFileSearch === 'function') openFileSearch('replace');
  },
  'global.vaultSearch': () => { if (typeof openSearchPanel === 'function') openSearchPanel(); },
  'global.annotation': () => { if (typeof toggleAnnotation === 'function') toggleAnnotation(); },
  'global.maxPane': () => {
    const paneId = typeof GBLayout !== 'undefined' && GBLayout.activePane;
    if (paneId) {
      if (GBLayout.isMaximized && GBLayout.isMaximized()) GBLayout.restoreMaximizedPane();
      else GBLayout.maximizePane(paneId);
    }
  },
  'global.closeTab': () => {
    const paneId = typeof GBLayout !== 'undefined' && GBLayout.activePane;
    if (paneId && typeof GBTabs !== 'undefined') {
      const activeTab = GBTabs.getActiveTab(paneId);
      if (activeTab) GBTabs.closeTab(paneId, activeTab.id);
    }
  },
  'global.nextTab': () => {
    if (typeof GBTabs !== 'undefined' && typeof GBLayout !== 'undefined') {
      const pane = GBLayout.activePane;
      const tabs = GBTabs.getTabs(pane);
      if (!tabs || !tabs.length) return;
      const active = GBTabs.getActiveTab(pane);
      const idx = tabs.findIndex(t => t.id === active?.id);
      const next = tabs[(idx + 1) % tabs.length];
      if (next) GBTabs.activateTab(pane, next.id);
    } else if (typeof _tabs !== 'undefined' && _tabs.length) {
      const idx = _tabs.findIndex(t => t.id === _activeTabId);
      const next = _tabs[(idx + 1) % _tabs.length];
      if (next && typeof activateTab === 'function') activateTab(next.id);
    }
  },
  'global.prevTab': () => {
    if (typeof GBTabs !== 'undefined' && typeof GBLayout !== 'undefined') {
      const pane = GBLayout.activePane;
      const tabs = GBTabs.getTabs(pane);
      if (!tabs || !tabs.length) return;
      const active = GBTabs.getActiveTab(pane);
      const idx = tabs.findIndex(t => t.id === active?.id);
      const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
      if (prev) GBTabs.activateTab(pane, prev.id);
    } else if (typeof _tabs !== 'undefined' && _tabs.length) {
      const idx = _tabs.findIndex(t => t.id === _activeTabId);
      const prev = _tabs[(idx - 1 + _tabs.length) % _tabs.length];
      if (prev && typeof activateTab === 'function') activateTab(prev.id);
    }
  },
  'global.commandPalette': () => {
    if (typeof showCommandPalette === 'function') showCommandPalette();
  },
  'global.settings': () => { if (typeof showSettingsModal === 'function') showSettingsModal(); },
  'global.shortcutHelp': () => {
    if (typeof showSettingsModal === 'function') showSettingsModal({ panel: 'ショートカット' });
  },
  'global.fullscreen': () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  },
  'global.reload':  () => false,
  'global.reload2': () => { location.reload(); },
  'global.addComment': () => { if (typeof addCommentHere === 'function') addCommentHere(); },

  // ============ ノートエディタ ============

  'note.bold':      () => _runNoteRichTextCommand('bold'),
  'note.italic':    () => _runNoteRichTextCommand('italic'),
  'note.underline': () => _runNoteRichTextCommand('underline'),
  'note.strike':    () => _runNoteRichTextCommand('strikeThrough'),
  'note.h1':        () => _runNoteHeadingShortcut('H1'),
  'note.h2':        () => _runNoteHeadingShortcut('H2'),
  'note.h3':        () => _runNoteHeadingShortcut('H3'),
  'note.h4':        () => _runNoteHeadingShortcut('H4'),
  'note.h5':        () => _runNoteHeadingShortcut('H5'),
  'note.h6':        () => _runNoteHeadingShortcut('H6'),
  'note.body':      () => _runNoteHeadingShortcut('P'),
  'note.ol':        () => _runNoteRichTextCommand('insertOrderedList'),
  'note.ul':        () => _runNoteRichTextCommand('insertUnorderedList'),
  'note.quote':     () => _runNoteRichTextCommand('formatBlock', 'BLOCKQUOTE'),
  'note.hr':        () => _runNoteRichTextCommand('insertHorizontalRule'),
  'note.indent':    () => _runNoteRichTextCommand('indent'),
  'note.outdent':   () => _runNoteRichTextCommand('outdent'),
  'note.moveUp':    () => { if (typeof moveBlock === 'function') moveBlock('up'); },
  'note.moveDown':  () => { if (typeof moveBlock === 'function') moveBlock('down'); },
  'note.link':      () => {
    const savedRange = _currentNoteSelectionRange();
    if (typeof showLinkInsertModal === 'function') {
      showLinkInsertModal(savedRange);
      return;
    }
    if (typeof cfPrompt !== 'function') return false;
    cfPrompt('URL:').then(url => {
      if (!url) return;
      if (savedRange) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
      }
      document.execCommand('createLink', false, url);
    });
  },
  'note.plainPaste': (e) => {
    // ブラウザデフォルトのプレーンテキスト貼り付けに任せる
    return false;
  },
  'note.replace':   () => {
    if (typeof openFileSearch === 'function') openFileSearch('replace');
  },
  'note.codeBlock': () => {
    _runNoteRichTextCommand('formatBlock', 'PRE');
  },
  'note.checklist': () => {
    // 計画書§8完了ゲート17: 実際にチェック状態を持つチェック項目へ変換する
    // （gb-note-block-types.js の共通レジストリへ委譲。重複実装を残さない）。
    if (!_activeNoteEditable() || typeof MeldexNoteBlockTypes === 'undefined') return false;
    const result = MeldexNoteBlockTypes.convertCurrentLineTo('checklist');
    if (!result.ok && result.reason && result.reason !== 'no-current-block' && typeof showStatus === 'function') {
      showStatus(result.reason, true);
    }
  },
  'note.callout': () => {
    if (!_activeNoteEditable() || typeof MeldexNoteBlockTypes === 'undefined') return false;
    const result = MeldexNoteBlockTypes.convertCurrentLineTo('callout');
    if (!result.ok && result.reason && result.reason !== 'no-current-block' && typeof showStatus === 'function') {
      showStatus(result.reason, true);
    }
  },
  'note.duplicate': () => {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const block = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
    const line = block?.closest?.('p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, div');
    const editable = line?.closest?.('[contenteditable="true"]') || document.activeElement?.closest?.('[contenteditable="true"]');
    if (!line || !line.parentElement || line === editable) return;
    const beforeHtml = editable ? editable.innerHTML : '';
    if (editable && typeof _pushCustomUndo === 'function') _pushCustomUndo(editable);
    const clone = line.cloneNode(true);
    line.parentElement.insertBefore(clone, line.nextSibling);
    if (editable && editable.innerHTML !== beforeHtml) {
      editable.dispatchEvent(new Event('input', { bubbles: true }));
    }
  },
  'note.ruby': (e) => {
    const edTarget = document.activeElement?.closest('[contenteditable="true"]');
    const sel = window.getSelection();
    if (!edTarget || !sel || sel.isCollapsed || !sel.toString().trim()) return false;
    if (typeof MeldexNoteRuby === 'undefined') return false;
    MeldexNoteRuby.insertRuby(edTarget, sel.getRangeAt(0).cloneRange());
  },
  'note.newParagraph': () => _insertParagraphAfterCurrentNoteBlock(),

  // ============ シナリオ ============
  'scenario.addRow': (e) => _runScriptnoteShortcutAction('scenario.addRow', e),
  'scenario.addRowSameType': (e) => _runScriptnoteShortcutAction('scenario.addRowSameType', e),
  'scenario.deleteRow': (e) => _runScriptnoteShortcutAction('scenario.deleteRow', e),
  'scenario.moveUp': (e) => _runScriptnoteShortcutAction('scenario.moveUp', e),
  'scenario.moveDown': (e) => _runScriptnoteShortcutAction('scenario.moveDown', e),
  'scenario.selectAll': (e) => _runScriptnoteShortcutAction('scenario.selectAll', e),
  'scenario.newline': (e) => _runScriptnoteShortcutAction('scenario.newline', e),
  'scenario.copy': (e) => _runScriptnoteShortcutAction('scenario.copy', e),
  'scenario.paste': (e) => _runScriptnoteShortcutAction('scenario.paste', e),
  'scenario.cut': (e) => _runScriptnoteShortcutAction('scenario.cut', e),
  'scenario.tab': (e) => _runScriptnoteShortcutAction('scenario.tab', e),
  'scenario.escape': (e) => _runScriptnoteShortcutAction('scenario.escape', e),
  'scenario.deselectAll': (e) => _runScriptnoteShortcutAction('scenario.deselectAll', e),
  'scenario.pasteInCell': (e) => _runScriptnoteShortcutAction('scenario.pasteInCell', e),
  'scenario.ruby': (e) => _runScriptnoteShortcutAction('scenario.ruby', e),
  'scenario.search': (e) => _runScriptnoteShortcutAction('scenario.search', e),
  'scenario.replace': (e) => _runScriptnoteShortcutAction('scenario.replace', e),
  'scenario.undo': (e) => _runScriptnoteShortcutAction('scenario.undo', e),
  'scenario.redo': (e) => _runScriptnoteShortcutAction('scenario.redo', e),

  // ============ データベース ============

  'db.newEntry': () => {
    if (state.view !== 'pivot') return false;
    const table = activeCell?.closest?.('table') || document.getElementById('pivot-table');
    if (!table) return false;
    const dataRows = Array.from(table.querySelectorAll('tbody tr:not(.new-entity-row):not(.new-entity-spacer-row):not(.db-virtual-spacer-row):not(.group-header-row)'));
    if (typeof triggerNewEntity === 'function') triggerNewEntity(table, dataRows);
  },
  'db.newProp': () => {
    if (state.view !== 'pivot') return false;
    if (typeof triggerNewProperty === 'function') triggerNewProperty();
  },
  'db.enter': () => {
    if (state.view !== 'pivot') return false;
    if (!activeCell) return false;
    const ae = document.activeElement;
    if (ae && ae.isConnected !== false && (ae.contentEditable === 'true' || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return false;
    const table = activeCell?.closest?.('table') || document.getElementById('pivot-table');
    if (!table) return false;
    const dataRows = Array.from(table.querySelectorAll('tbody tr:not(.new-entity-row):not(.new-entity-spacer-row):not(.db-virtual-spacer-row):not(.group-header-row)'));
    const thAll = Array.from(table.querySelectorAll('thead th'));
    const tr = activeCell.parentElement;
    const colIdx = Array.from(tr.children).indexOf(activeCell);
    const rowIdx = dataRows.indexOf(tr);
    // エントリ名列は並べ替え可能で位置が固定でないため、colIdx ではなくクラスで判定する
    if (activeCell.classList.contains('col-entity')) {
      const nameLabel = activeCell.querySelector('.entity-name-label');
      if (nameLabel) nameLabel.click();
    } else {
      if (typeof _dbStartCellInlineEditor === 'function') {
        _dbStartCellInlineEditor(activeCell, { preferExistingValue: true });
      } else {
        const valText = activeCell.querySelector('.value-text');
        if (valText) {
          valText.click();
          return;
        }
        const entityName = dataRows[rowIdx]?.querySelector('.entity-name-label')?.textContent;
        const propName = thAll[colIdx]?.dataset?.prop;
        if (entityName && propName && state.currentDbPath) {
          startCellInlineAdd(activeCell, _entityPath(state.currentDbPath, entityName), entityName, propName);
        }
      }
    }
  },
  'db.edit': () => {
    if (state.view !== 'pivot') return false;
    if (!activeCell) return false;
    const ae = document.activeElement;
    if (ae && ae.isConnected !== false && (ae.contentEditable === 'true' || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return false;
    const table = activeCell?.closest?.('table') || document.getElementById('pivot-table');
    const tr = activeCell.parentElement;
    const colIdx = Array.from(tr.children).indexOf(activeCell);
    // エントリ名列は並べ替え可能で位置が固定でないため、colIdx ではなくクラスで判定する
    if (activeCell.classList.contains('col-entity')) {
      const nameLabel = activeCell.querySelector('.entity-name-label');
      if (nameLabel) {
        const entityName = nameLabel.textContent;
        startEntityInlineRename(activeCell, nameLabel, entityName, state.currentDbPath);
      }
    } else {
      if (typeof _dbStartCellInlineEditor === 'function') {
        _dbStartCellInlineEditor(activeCell, { preferExistingValue: true });
      } else if (table) {
        const valText = activeCell.querySelector('.value-text');
        if (valText) {
          valText.click();
          return;
        }
        const dataRows = Array.from(table.querySelectorAll('tbody tr:not(.new-entity-row):not(.new-entity-spacer-row):not(.db-virtual-spacer-row):not(.group-header-row)'));
        const thAll = Array.from(table.querySelectorAll('thead th'));
        const rowIdx = dataRows.indexOf(tr);
        const entityName = dataRows[rowIdx]?.querySelector('.entity-name-label')?.textContent;
        const propName = thAll[colIdx]?.dataset?.prop;
        if (entityName && propName && state.currentDbPath && typeof startCellInlineAdd === 'function') {
          startCellInlineAdd(activeCell, _entityPath(state.currentDbPath, entityName), entityName, propName);
        }
      }
    }
  },
  'db.tab': () => {
    // データベースのTab移動は既存ハンドラに残す（矢印キーと一体の複雑なロジック）
    return false;
  },
  'db.search': () => {
    if (!state.currentDbPath) return false;
    if (typeof openCurrentToolbarSearchReplace === 'function') openCurrentToolbarSearchReplace('database');
    else if (typeof openDbFindReplace === 'function') openDbFindReplace('replace');
  },
  'db.replace': () => {
    if (!state.currentDbPath) return false;
    if (typeof openDbFindReplace === 'function') openDbFindReplace('replace');
  },
  'db.advancedFilter': () => {
    if (!state.currentDbPath) return false;
    if (typeof showUnifiedFilterModal === 'function') showUnifiedFilterModal();
    else if (typeof showAdvancedFilterModal === 'function') showAdvancedFilterModal();
    else return false;
  },
  'db.bulkEdit': () => {
    const ctx = typeof _currentPaneState === 'function' ? _currentPaneState() : null;
    const selected = typeof _getSelectedEntities === 'function'
      ? _getSelectedEntities(ctx)
      : (ctx?._selectedEntities ? [...ctx._selectedEntities] : []);
    if (!selected.length || typeof _showBulkEditModal !== 'function') return false;
    _showBulkEditModal(selected, ctx);
  },
  'db.copy': () => { return false; },
  'db.paste': () => { return false; },
  'db.selectAllRows': () => {
    const cell = typeof _dbActiveCellForRowShortcut === 'function' ? _dbActiveCellForRowShortcut() : null;
    if (!cell || (typeof _dbRowShortcutHasNativeEditor === 'function' && _dbRowShortcutHasNativeEditor())) return false;
    const ctx = typeof _dbPaneContextFromEvent === 'function'
      ? _dbPaneContextFromEvent(cell)
      : (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
    if (!ctx || typeof _selectAllPaneRows !== 'function') return false;
    return _selectAllPaneRows(ctx);
  },
  'db.deselectAllRows': () => {
    const cell = typeof _dbActiveCellForRowShortcut === 'function' ? _dbActiveCellForRowShortcut() : null;
    if (!cell || (typeof _dbRowShortcutHasNativeEditor === 'function' && _dbRowShortcutHasNativeEditor())) return false;
    const ctx = typeof _dbPaneContextFromEvent === 'function'
      ? _dbPaneContextFromEvent(cell)
      : (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
    if (!ctx || typeof _clearPaneRowSelection !== 'function') return false;
    return _clearPaneRowSelection(ctx);
  },
  'db.escape': () => {
    const ctx = typeof _currentPaneState === 'function' ? _currentPaneState() : null;
    const selectedSet = ctx?._selectedEntities || state._selectedEntities;
    if (!selectedSet || !selectedSet.size) return false;
    if (typeof _clearPaneRowSelection === 'function') _clearPaneRowSelection(ctx);
    else selectedSet.clear();
  },
  'db.filter': () => {
    const btn = document.getElementById('btn-filter');
    if (btn) btn.click();
  },

  // ============ ボード ============

  'board.search': () => {
    if (state.view !== 'board' || typeof bd === 'undefined' || bd.editing) return false;
    if (typeof openCurrentToolbarSearchReplace === 'function') openCurrentToolbarSearchReplace('board');
    else if (typeof bdOpenFindBar === 'function') bdOpenFindBar('replace');
  },
  'board.replace': () => {
    if (state.view !== 'board' || typeof bd === 'undefined' || bd.editing) return false;
    if (typeof bdOpenFindBar === 'function') bdOpenFindBar('replace');
  },
  'board.delete': () => {
    if (state.view !== 'board' || typeof bd === 'undefined' || bd.editing) return false;
    if (typeof bdDeleteSelected === 'function') bdDeleteSelected();
  },
  'board.selectAll': () => {
    if (state.view !== 'board' || typeof bd === 'undefined' || bd.editing) return false;
    if (typeof bdSelectAllElements === 'function') bdSelectAllElements();
  },
  'board.deselectAll': () => {
    if (state.view !== 'board' || typeof bd === 'undefined' || bd.editing) return false;
    if (typeof bdSelect === 'function') { bdSelect(null); bd._activeNode = null; }
  },
  'board.edit': () => {
    if (state.view !== 'board' || typeof bd === 'undefined' || bd.editing) return false;
    if (bd.selected.size === 1 && typeof bdEditNode === 'function') bdEditNode([...bd.selected][0]);
  },
  // Ctrl+Enter (新) / Tab (互換) で子カードを追加。親と同じスタイル / 構造を継承する。
  'board.addChild': () => {
    if (state.view !== 'board' || typeof bd === 'undefined') return false;
    if (bd.editing) {
      bdFinishEdit();
      setTimeout(() => {
        if (typeof bdAddChildToSelected === 'function') bdAddChildToSelected();
