  regId('rab-detail',          { label: 'オプション', desc: '右サイドバーにオプション設定タブを表示します' });
  regId('rab-calendar',        { label: 'スケジュール', desc: '右サイドバーにスケジュールを表示します' });
  regId('rab-chat',            { label: 'チャット',   desc: '右サイドバーにチャットを表示します' });
  regId('rab-tags',            { label: 'タグ',       desc: '右サイドバーにタグ管理を表示します' });
  regId('rab-annotation',      { label: '注釈',       desc: '右サイドバーに注釈一覧を表示します' });
  regId('rab-history',         { label: '履歴',       desc: '右サイドバーに操作履歴を表示します' });

  // 右アクティビティバー: data-rp-tab
  regData('rp-tab', 'detail',     { label: 'オプション', desc: '右サイドバーにオプション設定タブを表示します' });
  regData('rp-tab', 'calendar',   { label: 'スケジュール', desc: '右サイドバーにスケジュールを表示します' });
  regData('rp-tab', 'chat',       { label: 'チャット',   desc: '右サイドバーにチャットを表示します' });
  regData('rp-tab', 'tags',       { label: 'タグ',       desc: '右サイドバーにタグ管理を表示します' });
  regData('rp-tab', 'annotation', { label: '注釈',       desc: '右サイドバーに注釈一覧を表示します' });
  regData('rp-tab', 'history',    { label: '履歴',       desc: '右サイドバーに操作履歴を表示します' });

  // data-action だけを持つボタンでもヒントを拾えるようにする
  regAction('toggleactivitymenu', { label: 'メニュー',   desc: 'ファイル操作・ヘルプ・最近開いた項目などを開きます' });
  regAction('showpanelmenu',      { label: 'パネル',     desc: 'パネル配置の保存・呼び出し・操作メニューを開きます' });
  regAction('applyapplayout',     { label: 'レイアウト', desc: '単一レイアウトを維持します' });
  regAction('createnewapplayout', { label: 'レイアウト', desc: '単一レイアウトを維持します' });
  regAction('showusermenu',       { label: 'ユーザー',   desc: 'ユーザー設定を開きます' });
  regAction('showsettingsmodal',  { label: '設定',       desc: 'アプリ全体の設定ダイアログを開きます', shortcutId: 'global.settings' });
  regAction('togglesidebar',      { label: 'フォルダツリー', desc: '左サイドバーのフォルダツリーを開閉します' });
  regAction('toggleannotationtoolbar', { label: '注釈ツール', desc: '手描き注釈ツールバーを開閉します', shortcutId: 'global.annotation' });
  regAction('toggleoverlayvisibility', { label: '注釈オーバーレイ', desc: '描き込んだ注釈の表示/非表示を切り替えます' });
  regAction('toggleoptionpanel',  { label: 'オプションパネル', desc: '右サイドバーのオプション設定を開閉します' });
  regAction('togglerightpaneltab',{ label: '右サイドバータブ', desc: '指定した右サイドバーのタブを開閉します' });

  // ====== Registry seed (B2: フォルダツリー / ソースフォルダ管理 / フォルダビューツールバー) ======
  regId('btn-tree-search-clear', { label: '検索クリア', desc: 'フォルダツリーの検索キーワードをクリアします' });
  regId('btn-vault-search',      { label: '全文検索',   desc: 'ソースフォルダ全体のファイル本文を横断検索します', shortcutId: 'global.vaultSearch' });
  regId('btn-filter-toggle',     { label: 'フィルタ表示', desc: 'フォルダツリーのフィルタ入力欄を開閉します' });
  regId('sidebar-search-input',  { label: 'ファイル名検索', desc: 'フォルダツリー内のファイル名で絞り込みます', shortcutId: 'global.quickOpen' });
  regId('sidebar-resize',        { label: 'サイドバー幅', desc: 'ドラッグしてフォルダツリーの幅を調整します' });
  regId('folder-btn-slideshow',  { label: 'スライドショー', desc: '現在のフォルダ内の画像をスライドショーで表示します' });
  regAction('cleartreenamesearch', { label: '検索クリア', desc: 'フォルダツリーの検索キーワードをクリアします' });
  regAction('opensearchpanel',     { label: '全文検索',   desc: 'ソースフォルダ全体のファイル本文を横断検索します', shortcutId: 'global.vaultSearch' });
  regAction('toggleglobalfilterbar', { label: 'フィルタ表示', desc: 'フォルダツリーのフィルタ入力欄を開閉します' });
  regAction('dovaultsearch',     { label: '検索実行',   desc: '入力したキーワードでソースフォルダ全体を検索します' });
  regAction('dovaultreplace:false', { label: '置換',     desc: 'カーソル位置の一致を一つ置換します' });
  regAction('dovaultreplace:true',  { label: '全置換',   desc: 'すべての一致をまとめて置換します' });
  regAction('closesearchpanel',  { label: '閉じる',     desc: '全文検索パネルを閉じます' });
  regAction('opensourcefoldersettings', { label: 'ソースフォルダ管理', desc: 'ソースフォルダの追加・削除・並べ替えを行います' });
  regAction('addoutlinerrootfromsettings', { label: 'ソースフォルダ追加', desc: '新しいソースフォルダを登録します' });
  regAction('showhomeaddmenu',   { label: 'ホームフォルダへ追加', desc: 'ホームフォルダに表示する項目を選びます' });
  regAction('showfolderdisplaysettings', { label: '表示設定', desc: 'フォルダビューの並び順・表示項目を変更します' });
  regAction('showfolderpanelsettings',   { label: 'フォルダオプション', desc: 'フォルダビュー全般のオプションを開きます' });
  regAction('fvbulkslideshow',   { label: 'スライドショー', desc: '選択したファイルをスライドショーで表示します' });
  regAction('fvbulkboard',       { label: 'ボードへ並べる', desc: '選択したファイルをカードとしてボードに配置します' });
  regAction('fvbulkdelete',      { label: '一括削除',   desc: '選択したファイルをまとめて削除します' });
  regAction('fvbulkcopypath',    { label: 'パスコピー', desc: '選択したファイルのパスをクリップボードにコピーします' });
  regAction('fvbulkdeselect',    { label: '選択解除',   desc: 'ファイルの選択を解除します' });

  // ====== Registry seed (B3: ノートツールバー) ======
  // 第1引数までを正規化してキーにする (rtCmd('bold') → action:rtcmd:bold)
  regAction('rtcmd:bold',          { label: '太字',       desc: '選択した文字を太字にします', shortcutId: 'note.bold' });
  regAction('rtcmd:italic',        { label: '斜体',       desc: '選択した文字を斜体にします', shortcutId: 'note.italic' });
  regAction('rtcmd:underline',     { label: '下線',       desc: '選択した文字に下線を付けます', shortcutId: 'note.underline' });
  regAction('rtcmd:strikethrough', { label: '取り消し線', desc: '選択した文字に取り消し線を付けます', shortcutId: 'note.strike' });
  regAction('rtcmd:insertunorderedlist', { label: '箇条書き', desc: '行頭に「・」を付けたリストにします' });
  regAction('rtcmd:insertorderedlist',   { label: '番号付きリスト', desc: '行頭に「1. 2. 3.」と番号を付けます', shortcutId: 'note.ol' });
  regAction('rtcmd:formatblock',         { label: '引用',     desc: '段落を引用ブロックにします', shortcutId: 'note.quote' });
  regAction('rtcmd:inserthorizontalrule',{ label: '水平線',   desc: '段落と段落の間に水平区切り線を挿入します', shortcutId: 'note.hr' });
  regData('rt-cmd', 'bold',          { label: '太字',       desc: '選択した文字を太字にします', shortcutId: 'note.bold' });
  regData('rt-cmd', 'italic',        { label: '斜体',       desc: '選択した文字を斜体にします', shortcutId: 'note.italic' });
  regData('rt-cmd', 'underline',     { label: '下線',       desc: '選択した文字に下線を付けます', shortcutId: 'note.underline' });
  regData('rt-cmd', 'strikeThrough', { label: '取り消し線', desc: '選択した文字に取り消し線を付けます', shortcutId: 'note.strike' });
  regId('rt-fg-color',           { label: 'テキスト色', desc: '選択した文字色を変更します' });
  regId('rt-bg-color',           { label: '背景色',     desc: '選択した文字の背景色を変更します' });
  regAction('insertcallout',     { label: 'コールアウト', desc: '注意書きや補足を強調するコールアウトを挿入します' });
  regAction('insertnotetable',   { label: '表',         desc: '行と列のあるテーブルを挿入します' });
  regAction('togglenotetoc',     { label: '目次',       desc: 'ノートの見出しから生成した目次パネルを開閉します' });
  regAction('togglenotevertical',{ label: '縦書き / 横書き', desc: 'ノート本文の組方向を切り替えます' });
  regAction('toggleheadingindent', { label: '見出しインデント', desc: '見出しレベルに応じた本文の段下げ表示を切り替えます' });
  regAction('dofilesearch:-1',  { label: '前へ',     desc: '前の検索一致箇所へジャンプします' });
  regAction('dofilesearch:1',   { label: '次へ',     desc: '次の検索一致箇所へジャンプします' });
  regAction('dofilereplace:false', { label: '置換',  desc: 'カーソル位置の一致を一つ置換します' });
  regAction('dofilereplace:true',  { label: '全置換', desc: 'ファイル内のすべての一致をまとめて置換します' });
  regAction('clearfilesearch',   { label: '検索を閉じる', desc: 'ファイル内検索バーを閉じます' });

  // ====== Registry seed (B4: シナリオツールバー) ======
  regData('sn-action', 'saveTemplate',  { label: 'テンプレート保存', desc: '現在のシナリオ設定をテンプレートとして登録します' });
  regData('sn-action', 'horizontal',    { label: '横書き表示', desc: 'シナリオの本文を横書きで表示します' });
  regData('sn-action', 'vertical',      { label: '縦書き表示', desc: 'シナリオの本文を縦書きで表示します' });
  regData('sn-action', 'wrap',          { label: '折返し',     desc: 'シナリオ本文の自動折返しを切り替えます' });
  regData('sn-action', 'mergeDisplay',  { label: 'まとめ表示', desc: '同じタイプやガター値の連続行を省略表示します' });
  regData('sn-action', 'addColumn',     { label: '列追加',     desc: 'シナリオに新しい列を追加します' });
  regData('sn-action', 'filter',        { label: 'フィルタ',   desc: 'タイプや採用状況でシナリオを絞り込みます' });
  regData('sn-action', 'reload',        { label: '再読み込み', desc: 'シナリオファイルを保存後の状態に再読み込みします' });
  regData('sn-action', 'saveFilter',    { label: 'フィルタ保存', desc: '現在のフィルタ条件を名前を付けて保存します' });
  regData('sn-action', 'search',        { label: '検索 / 置換', desc: 'シナリオ本文を検索または置換します', shortcutId: 'scenario.search' });
  regData('sn-action', 'detail',        { label: 'オプション', desc: 'シナリオの表示オプションを開きます' });

  // ====== Registry seed (B5: シート / スマートシート / カレンダー) ======
  regAction('showcolumndisplayordermodal', { label: '列の表示と順序', desc: '表示する列と並び順を変更します' });
  regAction('showcolvisibilitymodal', { label: '列の表示と順序', desc: '表示する列と並び順を変更します' });
  regAction('showdbsearchmodal',  { label: 'シート横断検索', desc: '複数のシートをまたいで値を検索します' });
  regAction('onvalidateclick',    { label: '整合性検証',  desc: 'シートの値が検証ルールを満たしているか確認します' });
  regAction('showvalidationrulesmodal', { label: '検証ルール', desc: '値の整合性検証ルールを管理します' });
  regAction('opencurrenttoolbarsearchreplace', { label: '検索 / 置換', desc: '現在のビュー内で検索と置換を行います', shortcutId: 'global.search' });
  regId('btn-db-detail',          { label: 'オプション', desc: 'シートの表示オプションを開閉します' });
  regAction('showunifiedfiltermodal', { label: 'フィルタ', desc: 'シートの絞り込み条件を設定します', shortcutId: 'db.filter' });
  regAction('addcolumn',          { label: '列追加',     desc: 'シートに新しい列を追加します' });
  regData('cal-action', 'toggleSidebar', { label: 'スケジュールサイドバー', desc: '小型カレンダーやイベント一覧の表示を切り替えます' });
  regData('cal-action', 'today',         { label: '今日',     desc: '表示位置を今日に戻します', shortcutId: 'cal.today' });
  regData('cal-action', 'prev',          { label: '前へ',     desc: '前の期間（日/週/月）に移動します', shortcutId: 'cal.prev' });
  regData('cal-action', 'next',          { label: '次へ',     desc: '次の期間（日/週/月）に移動します', shortcutId: 'cal.next' });
  regData('cal-action', 'template',      { label: 'テンプレート', desc: 'カレンダーテンプレートを開きます' });
  regData('cal-action', 'timer',         { label: 'タイマー', desc: '作業タイマーを開きます' });
  regData('cal-action', 'production',    { label: '制作管理', desc: '制作管理パネルを開きます' });
  regData('cal-action', 'sync',          { label: '外部同期', desc: 'Googleカレンダー等と同期します' });
  regData('cal-action', 'sidebarOnly',   { label: 'サイドバーのみ', desc: 'メイン領域を隠してサイドバーのみ表示します' });
  regData('cal-action', 'settings',      { label: 'スケジュール設定', desc: 'スケジュールの表示と動作を設定します' });
  regData('cal-action', 'miniPrev',      { label: '前の月', desc: 'サイドバーの小型カレンダーを前の月に進めます' });
  regData('cal-action', 'miniNext',      { label: '次の月', desc: 'サイドバーの小型カレンダーを次の月に進めます' });
  regData('cal-action', 'addTodayTask',  { label: '今日のToDo追加', desc: '今日の日付でToDoを追加します' });
  regData('cal-action', 'createCalendar',{ label: 'カレンダー作成', desc: '新しいカレンダーを作成します' });

  // ====== Registry seed (B6: ボード) ======
  regData('bd-tool', 'select',     { label: '選択',     desc: 'カードやラインの選択・移動を行います' });
  regData('bd-tool', 'add-card',   { label: 'カード追加', desc: 'クリック位置に新しいカードを追加します' });
  regData('bd-tool', 'add-line',   { label: 'ライン追加', desc: 'カードからカードへラインを引きます' });
  regData('bd-tool', 'erase',      { label: '消しゴム', desc: 'カードやラインをクリックで削除します' });
  regData('bd-action', 'pick-card-style',     { label: 'カードスタイル', desc: '適用するカードスタイルを選びます' });
  regData('bd-action', 'manage-card-styles',  { label: 'カードスタイル管理', desc: 'カードスタイルの追加・編集・削除を行います' });
  regData('bd-action', 'pick-line-style',     { label: 'ラインスタイル', desc: '適用するラインスタイルを選びます' });
  regData('bd-action', 'manage-line-styles',  { label: 'ラインスタイル管理', desc: 'ラインスタイルの追加・編集・削除を行います' });
  regData('bd-action', 'filters',             { label: 'フィルタ', desc: 'タグや関連でボードのカードを絞り込みます' });
  regData('bd-action', 'find-replace',        { label: '検索 / 置換', desc: 'ボード内のカード本文を検索または置換します', shortcutId: 'global.search' });
  regData('bd-action', 'detail',              { label: 'オプション', desc: 'ボードの表示オプションを開きます' });
  regData('bd-action', 'zoom-select', { label: '表示倍率', desc: '表示倍率を一覧から選びます' });
  regData('bd-action', 'zoom-out',    { label: 'ズームアウト', desc: '表示倍率を下げます', shortcutId: 'board.zoomOut' });
  regData('bd-action', 'zoom-in',     { label: 'ズームイン', desc: '表示倍率を上げます', shortcutId: 'board.zoomIn' });
  regData('bd-action', 'zoom-100',    { label: '100%表示', desc: '表示倍率を100%に戻します', shortcutId: 'board.zoom100' });
  regData('bd-action', 'fit',         { label: '全体表示', desc: 'すべてのカードが収まる倍率に合わせます', shortcutId: 'board.zoomFit' });
  regData('bd-action', 'reset-rotation', { label: '回転リセット', desc: 'ボードの回転を0度に戻します' });
  regData('bd-action', 'bg-color',        { label: '背景色',     desc: 'ボードの背景色を変更します' });
  regData('bd-action', 'set-bg-image',    { label: '背景画像',   desc: 'ボードの背景に画像を設定します' });
  regData('bd-action', 'clear-bg-image',  { label: '背景画像クリア', desc: 'ボードの背景画像を解除します' });
  regId('bd-zoom-slider',  { label: '倍率スライダー', desc: 'ドラッグでボードの表示倍率を調整します' });
  regId('bd-rot-slider',   { label: '回転スライダー', desc: 'ドラッグでボードの回転角度を調整します' });
  regAction('bdopenfindbar', { label: '検索 / 置換', desc: 'ボード内のカード本文を検索または置換します', shortcutId: 'global.search' });

  // ====== Registry seed (B7: 注釈・チャット・LLM・チームチャット・DM) ======
  regData('tool', 'pen',     { label: 'ペン',       desc: 'ペンで自由に注釈を書き込みます' });
  regData('tool', 'marker',  { label: 'マーカー',   desc: '半透明のマーカーで注釈を書き込みます' });
  regData('tool', 'lasso',   { label: '塗りつぶし', desc: '囲んだ範囲を半透明色で塗ります' });
  regData('tool', 'eraser',  { label: '消しゴム',   desc: '描き込んだ注釈を消します' });
  regData('tool', 'sticky',  { label: '付箋',       desc: '紙の付箋のような注釈を貼り付けます' });
  regId('ann-color-swatch',  { label: '注釈色',     desc: '注釈ペン・マーカー・付箋の色を変更します' });
  regId('ann-opacity',       { label: '不透明度',   desc: '注釈の不透明度を調整します' });
  regAction('annclear',      { label: '注釈全削除', desc: '現在のページの注釈をすべて削除します' });
  regAction('newrpcomment',  { label: '注釈コメント追加', desc: '新しい注釈コメントを作成します', shortcutId: 'global.addComment' });
  regAction('loadrpannotationlist', { label: '注釈一覧更新', desc: '注釈一覧を最新状態に更新します' });
  regAction('chatsend',      { label: '送信',       desc: 'チャットメッセージを送信します' });
  regAction('chatclear',     { label: '新しいチャット', desc: '新しいチャットセッションを開始します' });
  regAction('chatsave',      { label: 'チャット保存', desc: '現在のチャットを保存します' });
  regAction('chatattachments',     { label: '添付追加', desc: 'ファイルや画像を添付します' });
  regAction('chatattachmentpick',  { label: '画像添付', desc: 'チャットに画像を添付します' });
  regAction('chatsearchtoggle',    { label: 'チャット内検索', desc: 'チャット内のメッセージを検索します' });
  regAction('chatsearchclose',     { label: '検索を閉じる', desc: 'チャット内検索を閉じます' });
  regAction('switchchatmode',      { label: 'モード切替', desc: 'LLM / チーム / DM などチャット表示を切り替えます' });
  regAction('showchatllmhelpmenu', { label: 'LLMヘルプ', desc: 'LLMチャットのヘルプとプロンプト集を開きます' });
  regAction('showchatrulesdialog', { label: 'LLMルール', desc: 'LLMに守らせるルールを編集します' });
  regAction('teamsend',            { label: 'チーム送信', desc: 'チームチャットへメッセージを送信します' });
  regAction('teamattachmentpick',  { label: 'チーム画像添付', desc: 'チームチャットに画像を添付します' });
  regAction('showcreateroommodal', { label: 'ルーム作成', desc: '新しいチャットルームを作成します' });
  regAction('showdirectmessagemodal', { label: 'DM開始', desc: 'ダイレクトメッセージを開始します' });
  regAction('onstampsend',         { label: 'スタンプ送信', desc: 'スタンプをチャットに送信します' });
  regId('chat-session-title',      { label: 'チャット名', desc: '現在のチャットの名前を編集します' });
  regId('chat-title-dropdown-btn', { label: 'チャット履歴', desc: '過去のチャットを呼び出します' });
  regId('chat-send-btn',           { label: '送信', desc: 'チャットメッセージを送信します' });

  // ====== Registry seed (B8: 設定ダイアログ・共通) ======

  // ====== Registry seed (B9: 各種モーダル / フォーム入力 / 共通ボタン) ======
  regAction('historyundo',  { label: '元に戻す', desc: '直前の操作を元に戻します', shortcutId: 'global.undo' });
  regAction('historyredo',  { label: 'やり直し', desc: '元に戻した操作をやり直します', shortcutId: 'global.redo' });
  regAction('htmlnavback',  { label: '戻る',     desc: '一つ前のページに戻ります' });
  regAction('htmlnavforward', { label: '進む',   desc: '一つ次のページに進みます' });
  regAction('htmlnavigate', { label: '移動',     desc: '入力したURLへ移動します' });
  regAction('htmlrefresh',  { label: '更新',     desc: '表示中のページを再読み込みします' });
  regAction('docmd',        { label: '実行',     desc: '選択中の操作を実行します' });
  regAction('add',          { label: '追加',     desc: '新しい項目を追加します' });
  regAction('addtodaytask', { label: '今日のToDo追加', desc: '今日の日付でToDoを追加します' });
  regData('align', 'left',   { label: '左寄せ',   desc: '選択範囲を左寄せにします' });
  regData('align', 'center', { label: '中央寄せ', desc: '選択範囲を中央に揃えます' });
  regData('align', 'right',  { label: '右寄せ',   desc: '選択範囲を右寄せにします' });

  // 共通アイコン（個別の解説が無い場合の最後の頼り。レジストリ未ヒット時にしか効かない）
  regIcon('add',    { label: '追加',   desc: '新しい項目を追加します' });
  regIcon('plus',   { label: '追加',   desc: '新しい項目を追加します' });
  regIcon('save',   { label: '保存',   desc: '現在の内容を保存します' });
  regIcon('search', { label: '検索',   desc: 'キーワードで検索します' });
  regIcon('trash2', { label: '削除',   desc: '選択した項目を削除します' });
  regIcon('x',      { label: '閉じる', desc: 'このパネルやダイアログを閉じます' });
  regIcon('check',  { label: '確定',   desc: '入力内容を確定します' });
  regIcon('refreshCw', { label: '更新', desc: '内容を最新状態に更新します' });
  regIcon('history',{ label: '履歴',   desc: '操作履歴を開きます' });
  regIcon('filter', { label: 'フィルタ', desc: '絞り込み条件を設定します' });

  // ====== Registry seed (B10: 動的生成ボタン群) ======
  // 注: regAction のキーは normalizeKey 後の値（小文字・記号除去）と一致させる必要がある。
  // バージョン管理パネル
  regAction('savemanualversion',     { label: '手動保存',     desc: '現在のファイル状態をバージョンとして保存します' });
  regAction('refreshversionpanel',   { label: '一覧更新',     desc: 'バージョン一覧を最新状態に更新します' });
  regAction('compareversion',        { label: '差分比較',     desc: 'このバージョンと現在の内容の差分を表示します' });
  regAction('restoreversion',        { label: '復元',         desc: 'このバージョンの内容を現在のファイルに上書きします' });
  regAction('previewversion',        { label: 'プレビュー',   desc: 'このバージョンの内容を読み取り専用で表示します' });
  regAction('deleteversion',         { label: 'バージョン削除', desc: 'このバージョンを履歴から削除します' });
  regAction('savefolderversion',     { label: 'フォルダ保存', desc: 'フォルダ全体のバージョンを保存します' });
  regAction('restorefolderversion',  { label: 'フォルダ復元', desc: 'このフォルダバージョンの状態に戻します' });
  regAction('deletefolderversion',   { label: 'フォルダ削除', desc: 'このフォルダバージョンを履歴から削除します' });
  regAction('showfolderversionfiles',{ label: 'ファイル一覧', desc: 'このフォルダバージョンに含まれるファイルを表示します' });
  regAction('opencurrentversionstab',{ label: '現在のファイル', desc: '現在開いているファイルのバージョン履歴に切り替えます' });
  regAction('togglediffmode',        { label: '差分表示',     desc: '差分表示モードを切り替えます' });

  // タブ・パネル
  regAction('closetab',              { label: 'タブを閉じる', desc: 'このタブを閉じます', shortcutId: 'global.closeTab' });
  regAction('toggleoptionpanel',     { label: 'オプションパネル', desc: '右サイドバーのオプション設定を開閉します' });
  regAction('switchdetailtab',       { label: 'タブ切替',     desc: 'オプションパネルの表示タブを切り替えます' });
  regAction('switchsettingstab',     { label: '設定タブ切替', desc: '設定ダイアログの表示タブを切り替えます' });
  regAction('switchsettingsthemestyletab', { label: 'スタイル切替', desc: 'テーマ設定のスタイルタブを切り替えます' });
  regAction('switchcstab',           { label: 'スタイル切替', desc: 'カードスタイル編集のタブを切り替えます' });
  regAction('switchrighttab',        { label: '右サイドバー切替', desc: '右サイドバーの表示タブを切り替えます' });

  // 履歴パネル
  regAction('historypanelclear',     { label: '履歴クリア',   desc: '操作履歴の表示をすべてクリアします' });
  regAction('historypaneljump',      { label: '履歴ジャンプ', desc: 'この操作時点の状態に戻します' });

  // 注釈マネージャ
  regAction('openannotationmanager', { label: '注釈マネージャ', desc: '注釈の一覧管理画面を開きます' });
  regAction('loadannotationlist',    { label: '注釈一覧更新', desc: '注釈一覧を最新状態に更新します' });
  regAction('loadrpstickylist',      { label: '付箋一覧更新', desc: '付箋一覧を最新状態に更新します' });
  regAction('jumptoannotation',      { label: '注釈へ移動',   desc: 'この注釈の位置へジャンプします' });
  regAction('deleteannotationfrommanager', { label: '注釈削除', desc: 'この注釈を削除します' });
  regAction('deletenote',            { label: 'コメント削除', desc: 'このコメントを削除します' });

  // テーマ・配色・スタイル
  regAction('exporteditortheme',     { label: 'テーマ書き出し', desc: '現在のテーマ設定をファイルに保存します' });
  regAction('importeditortheme',     { label: 'テーマ読み込み', desc: 'ファイルからテーマ設定を読み込みます' });
  regAction('restorethemesnapshot',  { label: 'テーマ復元',   desc: '保存しておいたテーマ設定の状態に戻します' });
  regAction('applycolorsettings',    { label: '配色適用',     desc: '現在の配色設定を反映します' });
  regAction('resetcolorsettings',    { label: '配色リセット', desc: '配色設定を初期状態に戻します' });
  regAction('opencspalette',         { label: '色を選択',     desc: 'カラーパレットを開きます' });
  regAction('opencspalettergba',     { label: '色を選択',     desc: '不透明度付きでカラーパレットを開きます' });
  regAction('openrtcolorpalette',    { label: '色を選択',     desc: 'テキスト用カラーパレットを開きます' });
  regAction('openstylebgonlypalette',{ label: '背景色を選択', desc: '背景色専用のカラーパレットを開きます' });
  regAction('openstylepreviewpopup', { label: 'プレビュー',   desc: 'スタイルのプレビューを表示します' });
  regAction('togglecsstyle',         { label: 'スタイル切替', desc: 'カードスタイルの有効/無効を切り替えます' });
  regAction('togglelinevisibility',  { label: 'ライン表示',   desc: 'このライン種類の表示/非表示を切り替えます' });

  // ファイル別スタイル / プリセット
  regAction('setdefaultfilestyle',   { label: '既定にする',   desc: 'このスタイルを新規ファイルの既定にします' });
  regAction('resetcurrentfilestyle', { label: 'スタイル初期化', desc: '現在のファイル個別スタイルを既定に戻します' });
  regAction('showfilestylepresetsavedialog',  { label: 'プリセット保存', desc: '現在のスタイルをプリセットとして保存します' });
  regAction('showfilestylepresetapplydialog', { label: 'プリセット適用', desc: '保存済みプリセットを現在のファイルに適用します' });

  // フォント・色設定の補助
  regAction('openfontmanager',       { label: 'フォント管理', desc: '使用するフォントを追加・編集します' });
  regAction('chooseavataricon',      { label: 'アイコン選択', desc: 'プロフィール画像を変更します' });
  regAction('removeavatar',          { label: 'アイコン解除', desc: 'プロフィール画像を初期状態に戻します' });

  // 設定・送信・全般
  regAction('addworkspace',          { label: 'ワークスペース追加', desc: '新しいワークスペースを登録します' });
  regAction('submitsettings',        { label: '設定を保存',   desc: '入力した設定を保存します' });
  regAction('submitaddfolderlink',   { label: 'リンク追加',   desc: '入力した内容でフォルダリンクを追加します' });
  regAction('applycolvisibility',    { label: '表示と順序を適用', desc: '列の表示状態と並び順を確定します' });
  regAction('dosaveview',            { label: 'ビュー保存',   desc: '現在の表示条件を名前を付けて保存します' });
  regAction('runexporttodb',         { label: 'シート出力',   desc: '結果をシートに書き出します' });
  regAction('testformula',           { label: '数式テスト',   desc: '入力した数式の結果を試算します' });
  regAction('backlinksrebuild',      { label: '逆リンク再構築', desc: 'バックリンクの索引を再構築します' });

  // フォルダ・スライドショー
  regAction('openfolderslideshow',   { label: 'スライドショー', desc: 'フォルダ内の画像をスライドショーで表示します' });
  regAction('openscenariocharacterdbimport', { label: 'キャラ取り込み', desc: 'シナリオで使うキャラ情報をシートから取り込みます' });

  // ツールメニュー / モバイル / スクショ
  regAction('showtoolmenu',          { label: 'ツールメニュー', desc: '現在のビューのツールメニューを開きます' });
  regAction('showmobiletoolmenu',    { label: 'ツールメニュー', desc: 'モバイル向けツールメニューを開きます' });
  regAction('showscreenshotmenu',    { label: 'スクリーンショット', desc: 'スクリーンショット撮影メニューを開きます' });
  regAction('opentooltab',           { label: 'ツールタブを開く', desc: '指定したツールのタブを開きます' });
  regAction('openrightpaneltab',     { label: '右サイドバータブを開く', desc: '指定した右サイドバーのタブを開きます' });

  // チームチャット
  regAction('selectteamroom',        { label: 'ルーム選択',   desc: 'このチームチャットルームを開きます' });
  regAction('showchathistorydropdown', { label: 'チャット履歴', desc: '過去のチャットを呼び出します' });

  // ゴミ箱
  regAction('trashrestore',          { label: '復元',         desc: 'ゴミ箱からこの項目を元の場所に戻します' });
  regAction('trashdelete',           { label: '完全削除',     desc: 'この項目をゴミ箱から完全に削除します' });
  regAction('trashempty',            { label: 'ゴミ箱を空に', desc: 'ゴミ箱の中身をすべて完全削除します' });

  // テーマ背景画像
  regAction('settingsthemeboardchoosebgimage', { label: '背景画像を選択', desc: 'ボードの既定背景画像を選択します' });
  regAction('settingsthemeboardclearbgimage',  { label: '背景画像クリア', desc: 'ボードの既定背景画像を解除します' });

  // スマートシート
  regAction('setsmartdbactiveview',  { label: 'ビュー切替',   desc: 'スマートシートの表示ビューを切り替えます' });

  // ====== Registry seed (B11: ボード詳細・カレンダー詳細・バージョンアクション) ======
  // ボード スタイル/状態 操作
  regData('bd-action', 'manage-statuses',     { label: 'ステータス管理', desc: 'カードのステータス候補を追加・編集・削除します' });
  regData('bd-action', 'manage-depth-styles', { label: '階層スタイル管理', desc: '階層ごとの既定スタイルを管理します' });
  regData('bd-action', 'save-depth-styles',   { label: '階層スタイル保存', desc: '現在の階層別スタイルを保存します' });
  regData('bd-action', 'reset-depth-styles',  { label: '階層スタイルリセット', desc: '階層別スタイルを初期状態に戻します' });
  regData('bd-action', 'save-card-style',         { label: 'カードスタイル保存', desc: '現在のカードスタイルを上書き保存します' });
  regData('bd-action', 'save-card-style-as-new',  { label: '別名保存',     desc: '現在のカードスタイルを別名で新規保存します' });
  regData('bd-action', 'save-node-card-style',        { label: 'カード固有スタイル保存', desc: 'このカード固有のスタイルを保存します' });
  regData('bd-action', 'save-node-card-style-as-new', { label: '別名保存',           desc: 'このカード固有のスタイルを別名で保存します' });
  regData('bd-action', 'save-line-style',         { label: 'ラインスタイル保存', desc: '現在のラインスタイルを上書き保存します' });
  regData('bd-action', 'save-line-style-as-new',  { label: '別名保存',     desc: '現在のラインスタイルを別名で新規保存します' });
  regData('bd-action', 'save-conn-line-style',        { label: 'ライン固有スタイル保存', desc: 'このライン固有のスタイルを保存します' });
  regData('bd-action', 'save-conn-line-style-as-new', { label: '別名保存',         desc: 'このライン固有のスタイルを別名で保存します' });
  regData('bd-action', 'reset-card-style',         { label: 'カードスタイルリセット', desc: 'カードスタイルを既定値に戻します' });
  regData('bd-action', 'reset-node-card-style',    { label: 'カード固有解除', desc: 'このカードの固有スタイルを解除して既定に戻します' });
  regData('bd-action', 'reset-line-style',         { label: 'ラインスタイルリセット', desc: 'ラインスタイルを既定値に戻します' });
  regData('bd-action', 'reset-conn-style',         { label: 'ライン固有解除', desc: 'このラインの固有スタイルを解除して既定に戻します' });
  regData('bd-action', 'reset-conn-line-style',    { label: 'ラインスタイル解除', desc: 'ラインのスタイル設定を解除します' });
  regData('bd-action', 'reset-conn-bends',         { label: 'ライン形状リセット', desc: 'ラインの曲げ・分岐形状を初期化します' });
  regData('bd-action', 'reset-style',              { label: 'スタイル全リセット', desc: '選択中のスタイル設定をすべて既定に戻します' });
  regData('bd-action', 'open-link',                { label: 'リンクを開く', desc: 'カードに設定されたリンク先を開きます' });

  // カレンダー追加操作（B5未網羅分）
  regData('cal-action', 'addEvent',  { label: 'イベント追加', desc: 'この日付にイベントを追加します' });
  regData('cal-action', 'addTask',   { label: 'ToDo追加',   desc: 'この日付にToDoを追加します' });

  // ====== Registry seed (B12: 主要 input / slider / select) ======
  // 注釈ツール幅・不透明度
  regId('ann-width-pen',     { label: 'ペンの太さ',     desc: 'ペンで描く線の太さを調整します' });
  regId('ann-width-marker',  { label: 'マーカーの太さ', desc: 'マーカーで描く線の太さを調整します' });
  regId('ann-width-eraser',  { label: '消しゴムサイズ', desc: '消しゴムで消す範囲の大きさを調整します' });
  // チャット
  regId('chat-input',           { label: 'メッセージ', desc: 'チャットに送るメッセージを入力します。Enter または送信ボタンで確定' });
  regId('chat-search-input',    { label: 'チャット検索', desc: 'このチャット内のメッセージをキーワードで検索します' });
  regId('chat-attachment-file', { label: '添付ファイル', desc: 'チャットに添付するファイルを選択します' });
  // 注釈・コメント検索
  regId('rp-ann-search',  { label: '注釈検索', desc: '注釈一覧を本文で検索します' });
  // フォルダフィルタ
  regId('gf-search-entities', { label: 'フィルタ検索', desc: 'フィルタ対象の項目をキーワードで絞り込みます' });
  // HTMLビューア
  regId('html-url-bar', { label: 'URL', desc: '表示するURLを入力します。Enterで移動' });
  // タイマー
  regId('inp-h',       { label: '時',   desc: 'タイマーの時間（時）を設定します' });
  regId('inp-m',       { label: '分',   desc: 'タイマーの時間（分）を設定します' });
  regId('inp-s',       { label: '秒',   desc: 'タイマーの時間（秒）を設定します' });
  regId('inp-countup', { label: 'カウントアップ', desc: 'チェックすると経過時間を計測するモードになります' });
  regId('seek-bar',    { label: '再生位置', desc: 'ドラッグして再生位置を移動します' });
  regId('fade',        { label: 'フェード時間', desc: '画像切替時のフェード時間（秒）を設定します' });
  // ノート余白
  regId('note-margin-slider', { label: 'ノート余白', desc: 'ノート本文と画面端の余白を調整します' });
  // ルビ
  regId('ruby-input', { label: 'ルビ', desc: 'ふりがなとして表示する文字を入力します' });
  // タイトル変更
  regId('title-input', { label: 'タイトル', desc: 'ファイルのタイトルを入力します' });
  // ファイル選択（XLSX取込・画像添付）
  regId('xlsx-import-input', { label: 'Excel取込', desc: 'シートに取り込むXLSXファイルを選択します' });
  regId('gb-img-file-input', { label: '画像選択',  desc: '挿入する画像ファイルを選択します' });
  regId('avatar-upload-input', { label: 'アイコン画像', desc: 'プロフィール用の画像ファイルを選択します' });
  // 一括列幅
  regId('bulk-col-width-input', { label: '列幅一括', desc: '選択中の列の幅をまとめて変更します' });
  // 設定検索
  regId('settings-back-btn', { label: '設定TOPへ戻る', desc: '設定ダイアログのトップ画面に戻ります' });
  // チームチャット
  regId('team-input', { label: 'メッセージ', desc: 'チームチャットに送るメッセージを入力します。Enter または送信ボタンで確定' });
  regId('time-input', { label: '時刻', desc: 'メッセージに付ける時刻を入力します' });

  // ====== Registry seed (B13: 画像ビューワー・スライドショー・CSP連携・ボード検索) ======
  // ボード検索バー
  regId('bd-find-q',           { label: '検索ワード',     desc: 'ボード内のカード本文から検索するキーワードを入力します' });
  regId('bd-find-r',           { label: '置換ワード',     desc: '見つかった文字列を置き換える文字列を入力します' });
  regId('bd-find-prev',        { label: '前の一致',       desc: '前の検索一致箇所へジャンプします' });
  regId('bd-find-next',        { label: '次の一致',       desc: '次の検索一致箇所へジャンプします' });
  regId('bd-find-replace-one', { label: '置換',           desc: '現在の一致箇所を1件置換します' });
  regId('bd-find-replace-all', { label: '全置換',         desc: 'すべての一致箇所をまとめて置換します' });
  regId('bd-find-close',       { label: '検索を閉じる',   desc: 'ボード内検索バーを閉じます' });
  regId('bd-find-count',       { label: '一致件数',       desc: '検索一致箇所の件数を表示します' });
  // ボード ステータス管理ダイアログ
  regId('bd-st-add',           { label: 'ステータス追加', desc: '新しいステータスを追加します' });
  regId('bd-st-close',         { label: '閉じる',         desc: 'ステータス管理を閉じます' });
  // ボード ズーム/回転表示
  regId('bd-zoom-label',       { label: '表示倍率',       desc: '現在の表示倍率を表示します' });
  regId('bd-rot-label',        { label: '回転角度',       desc: '現在の回転角度を表示します' });
  regId('bd-bg-swatch',        { label: '背景色',         desc: 'クリックでボードの背景色を変更します' });

  // 画像ビューワー / スライドショー
  regId('btn-prev',         { label: '前の画像',     desc: '一つ前の画像に戻ります' });
  regId('btn-next',         { label: '次の画像',     desc: '一つ次の画像に進みます' });
  regId('btn-prev-folder',  { label: '前のフォルダ', desc: '一つ前のフォルダに移動します' });
  regId('btn-next-folder',  { label: '次のフォルダ', desc: '一つ次のフォルダに移動します' });
  regId('btn-play',         { label: '再生',         desc: 'スライドショーを再生または一時停止します' });
  regId('btn-original',     { label: '原寸表示',     desc: '画像を原寸大で表示します' });
  regId('btn-fit',          { label: 'フィット表示', desc: '画面サイズに合わせて画像を表示します' });
  regId('btn-zoom-in',      { label: 'ズームイン',   desc: '表示倍率を上げます' });
  regId('btn-zoom-out',     { label: 'ズームアウト', desc: '表示倍率を下げます' });
  regId('btn-rotate',       { label: '回転',         desc: '画像を90度ずつ回転させます' });
  regId('btn-flip-h',       { label: '左右反転',     desc: '画像を左右に反転させます' });
  regId('btn-flip-v',       { label: '上下反転',     desc: '画像を上下に反転させます' });
  regId('btn-fullscreen',   { label: 'フルスクリーン', desc: 'フルスクリーン表示を切り替えます', shortcutId: 'global.fullscreen' });
  regId('btn-slideshow',    { label: 'スライドショー', desc: 'スライドショー再生を開始します' });
  regId('btn-hud',          { label: 'HUD表示',       desc: '操作HUDの表示/非表示を切り替えます' });
  regId('btn-markup',       { label: '注釈モード',    desc: '画像への注釈描画モードを切り替えます' });
  regId('btn-bg',           { label: '背景色',        desc: 'ビューワーの背景色を切り替えます' });

  // CSP（CLIP STUDIO PAINT）連携
  regId('btn-clip-page',       { label: 'CSPページ送信',  desc: '現在のページ情報をCLIP STUDIO PAINTへ送信します' });
  regId('btn-clip-screenshot', { label: 'CSPスクショ',    desc: 'CLIP STUDIO PAINTのキャンバスを取り込みます' });

  // シート（ビュー設定保存ダイアログ等）
  regId('btn-export-to-db',     { label: 'シート出力',    desc: '現在の結果をシートに書き出します' });
  regId('btn-save-verb-settings', { label: '動詞設定保存', desc: '動詞設定を保存します' });
  regId('btn-shift-back',  { label: '前のシフト', desc: '一つ前のシフトに戻ります' });
  regId('btn-shift-fwd',   { label: '次のシフト', desc: '一つ次のシフトに進みます' });
  regId('btn-start',       { label: '開始', desc: '処理を開始します' });

  // ノート/シナリオツールバーの個別ボタン
  regId('btn-detail',         { label: 'オプション',   desc: '右サイドバーにオプション設定を開きます' });
  regId('btn-horizontal',     { label: '横書き',       desc: '横書き表示に切り替えます' });
  regId('btn-vertical',       { label: '縦書き',       desc: '縦書き表示に切り替えます' });
  regId('btn-wrap',           { label: '折返し',       desc: '本文の自動折返しを切り替えます' });
  regId('btn-merge-display',  { label: 'まとめ表示',   desc: '同じタイプ・ガター値の連続行を省略表示します' });

  // カレンダーボタン
  regId('cal-add-ev',     { label: 'イベント追加', desc: 'カレンダーに新しいイベントを追加します', shortcutId: 'cal.newEvent' });
  regId('cal-add-task',   { label: 'ToDo追加',   desc: 'カレンダーに新しいToDoを追加します' });
  regId('cal-prev',       { label: '前へ',         desc: '前の期間に移動します', shortcutId: 'cal.prev' });
  regId('cal-next',       { label: '次へ',         desc: '次の期間に移動します', shortcutId: 'cal.next' });
  regId('cal-today',      { label: '今日',         desc: '表示位置を今日に戻します', shortcutId: 'cal.today' });
  regId('cal-mode',       { label: '表示モード',   desc: '日 / 週 / 月などの表示モードを切り替えます' });
  regId('cal-start-day',  { label: '週の開始曜日', desc: 'カレンダーの週の開始曜日を選びます' });
  regId('cal-timer',      { label: 'タイマー',     desc: '作業タイマーを開きます' });
  regId('cal-sync',       { label: '外部同期',     desc: '外部カレンダーと同期します' });
  regId('cal-title',      { label: '期間表示',     desc: '現在表示している期間を示します' });
  // カレンダーイベント詳細
  regId('cal-detail-title',    { label: 'タイトル',     desc: 'イベントのタイトルを入力します' });
  regId('cal-detail-start',    { label: '開始日時',     desc: 'イベントの開始日時を入力します' });
  regId('cal-detail-end',      { label: '終了日時',     desc: 'イベントの終了日時を入力します' });
  regId('cal-detail-allday',   { label: '終日',         desc: 'チェックすると終日イベントとして扱います' });
  regId('cal-detail-calendar', { label: 'カレンダー',   desc: 'このイベントを保存するカレンダーを選びます' });
  regId('cal-detail-color',    { label: 'イベント色',   desc: 'イベントの表示色を選びます' });
  regId('cal-detail-location', { label: '場所',         desc: 'イベントの開催場所を入力します' });
  regId('cal-detail-url',      { label: 'URL',          desc: '関連するリンクのURLを入力します' });
  regId('cal-detail-desc',     { label: '説明',         desc: 'イベントの詳細説明を入力します' });
  regId('cal-detail-alert',    { label: 'アラート',     desc: '通知タイミングを設定します' });
  regId('cal-detail-rec-type', { label: '繰り返し',     desc: '繰り返しのパターンを選びます（毎日、毎週など）' });
  regId('cal-detail-rec-interval', { label: '間隔',     desc: '繰り返しの間隔（◯日ごと、◯週ごと等）を入力します' });
  regId('cal-detail-rec-days',     { label: '繰り返し曜日', desc: '繰り返す曜日を選びます' });
  regId('cal-detail-rec-end',      { label: '終了',     desc: '繰り返しの終了条件を設定します' });
  regId('cal-detail-rec-opts',     { label: '繰り返しオプション', desc: '繰り返しの詳細オプションを設定します' });
  regId('cal-detail-save',         { label: '保存',     desc: 'イベントの内容を保存します' });
  regId('cal-detail-delete',       { label: '削除',     desc: 'このイベントを削除します' });
  regId('cal-detail-open-entry',   { label: 'エントリを開く', desc: 'リンクされているシートのエントリを開きます' });

  // シナリオ フィルタ保存ダイアログ
  regId('sn-filter-preset',         { label: 'プリセット選択', desc: '保存済みのフィルタプリセットを選びます' });
  regId('sn-save-name',             { label: 'プリセット名',   desc: '保存するフィルタプリセットの名前を入力します' });
  regId('sn-save-folder-tree',      { label: 'フォルダ',       desc: 'プリセットを保存するフォルダを選びます' });
  regId('sn-save-folder-label',     { label: 'フォルダラベル', desc: '保存先フォルダのラベルを表示します' });
  regId('sn-save-folder-display',   { label: 'フォルダ表示',   desc: '選んだ保存先フォルダのパスを表示します' });
  regId('sn-save-ok',               { label: '保存',           desc: 'プリセットを保存します' });
  regId('sn-save-cancel',           { label: 'キャンセル',     desc: '保存をキャンセルします' });

  // ====== Registry seed (B14: 検索/置換UI、CSV、チャット選択、注釈フィルタ) ======
  // ソースフォルダ全文検索パネル
  regId('sp-query',         { label: '検索ワード',     desc: 'ソースフォルダ全体から検索するキーワードを入力します' });
  regId('sp-replace',       { label: '置換ワード',     desc: '見つかった文字列を置き換える文字列を入力します' });
  regId('sp-case',          { label: '大文字小文字を区別', desc: 'チェックすると大文字と小文字を区別して検索します' });
  regId('sp-regex',         { label: '正規表現',       desc: 'チェックするとキーワードを正規表現として扱います' });
  regId('sp-folder-only',   { label: 'フォルダ名のみ', desc: 'チェックするとフォルダ名のみを検索対象にします' });
  regId('sp-show-replace',  { label: '置換を表示',     desc: '置換ワード入力欄を表示します' });

  // ファイル内検索バー

  // CSV ツールバー
  regId('csv-add-row',      { label: '行追加', desc: 'CSV最終行の下に新しい行を追加します' });
  regId('csv-add-col',      { label: '列追加', desc: 'CSV最終列の右に新しい列を追加します' });
  regId('csv-to-db',        { label: 'シート変換', desc: 'CSVをシートに変換して開きます' });

  // フォルダ表示レイアウト
  regId('folder-layout-select', { label: 'フォルダ表示', desc: 'フォルダビューの表示形式（リスト/グリッド等）を選びます' });

  // チャットモデル選択
  regId('chat-search-scope',  { label: '検索範囲', desc: 'チャット内検索の対象範囲を選びます' });
  regId('chat-provider',      { label: 'プロバイダ', desc: 'AIプロバイダ（OpenAI/Anthropic/Google等）を選びます' });
  regId('chat-model',         { label: 'モデル',     desc: '使用するAIモデルを選びます' });

  // チームチャット
  regId('team-room-select',     { label: 'ルーム選択', desc: '表示するチームチャットルームを選びます' });
  regId('team-attachment-file', { label: '添付ファイル', desc: 'チームチャットに添付するファイルを選択します' });
  regId('team-send-btn',        { label: '送信', desc: 'チームチャットへメッセージを送信します' });

  // 注釈パネルのフィルタ
  regId('rp-ann-view',    { label: '表示形式',   desc: '注釈一覧の表示形式（リスト/カード等）を切り替えます' });
  regId('rp-ann-sort',    { label: '並び順',     desc: '注釈一覧の並び順を切り替えます' });
  regId('rp-ann-type',    { label: '種類フィルタ', desc: '表示する注釈の種類で絞り込みます' });
  regId('rp-ann-scope',   { label: '範囲フィルタ', desc: '表示する注釈の対象範囲で絞り込みます' });
  regId('rp-ann-status',  { label: 'ステータス', desc: '表示する注釈のステータスで絞り込みます（解決/未解決等）' });
  regId('rp-ann-user',    { label: 'ユーザー',   desc: '注釈を作成したユーザーで絞り込みます' });

  // バージョンアクション（data-version-action）
  regData('version-action', 'save',            { label: '手動保存',     desc: '現在のファイル状態をバージョンとして保存します' });
  regData('version-action', 'saveFolder',      { label: 'フォルダ保存', desc: 'フォルダ全体のバージョンを保存します' });
  regData('version-action', 'refresh',         { label: '一覧更新',     desc: 'バージョン一覧を最新状態に更新します' });
  regData('version-action', 'compare',         { label: '差分比較',     desc: 'このバージョンと現在の内容の差分を表示します' });
  regData('version-action', 'restore',         { label: '復元',         desc: 'このバージョンの内容を現在のファイルに上書きします' });
  regData('version-action', 'restoreFolder',   { label: 'フォルダ復元', desc: 'このフォルダバージョンの状態に戻します' });
  regData('version-action', 'promoteFolder',   { label: 'スナップショット化', desc: '自動保存されたフォルダバージョンを手動保存として残します' });
  regData('version-action', 'preview',         { label: 'プレビュー',   desc: 'このバージョンの内容を読み取り専用で表示します' });
  regData('version-action', 'delete',          { label: 'バージョン削除', desc: 'このバージョンを履歴から削除します' });
  regData('version-action', 'deleteFolder',    { label: 'フォルダ削除', desc: 'このフォルダバージョンを履歴から削除します' });
  regData('version-action', 'showFolderFiles', { label: 'ファイル一覧', desc: 'このフォルダバージョンに含まれるファイルを表示します' });

  window.GBTooltip = {
    showFor,
    hide: hideNow,
    refresh,
    getTooltipText,
    // 旧 title ツールチップ経路（gb-events.js）が委譲前に除外リスト
    // （タブ・カスタムリンク等）を照会できるようにする
    isEligible: isTooltipEligible,
    register: (scope, key, entry) => reg(scope, key, entry)
  };
})();
