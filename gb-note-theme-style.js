/* gb-note-theme-style.js: note-specific theme style rows */
(function () {
  'use strict';

  const NOTE_STYLE_ROWS = [
    { label: '見出しインデント', numbers:[
      { label:'H2', key:'--page-h2-indent', min:0, max:80, step:1, unit:'px', fallback:8 },
      { label:'H3', key:'--page-h3-indent', min:0, max:80, step:1, unit:'px', fallback:16 },
      { label:'H4', key:'--page-h4-indent', min:0, max:80, step:1, unit:'px', fallback:24 },
      { label:'H5', key:'--page-h5-indent', min:0, max:80, step:1, unit:'px', fallback:32 },
      { label:'H6', key:'--page-h6-indent', min:0, max:80, step:1, unit:'px', fallback:40 },
    ], text:'H2-H6' },
    { label: '表 見出し', fg:'--page-table-header-fg', bg:'--page-table-header-bg', bold:'--page-table-header-bold', italic:'--page-table-header-italic', text:'列1', font:'--page-table-header-font' },
    { label: '表 セル', fg:'--page-table-cell-fg', bg:'--page-table-cell-bg', bold:'--page-table-cell-bold', italic:'--page-table-cell-italic', text:'セル', font:'--page-table-cell-font', bgType:'rgba' },
    { label: '表 サイズ', numbers:[
      { label:'文字', key:'--page-table-font-size', min:10, max:28, step:1, unit:'px', fallback:13 },
      { label:'上下余白', key:'--page-table-cell-padding-y', min:0, max:32, step:1, unit:'px', fallback:6 },
      { label:'左右余白', key:'--page-table-cell-padding-x', min:0, max:48, step:1, unit:'px', fallback:10 },
      { label:'外余白', key:'--page-table-margin-y', min:0, max:48, step:1, unit:'px', fallback:8 },
    ], text:'表' },
    { label: '表 枠線', line:'--page-table-border-color', width:'--page-table-border-width', text:'━━' },
    { label: '表 行ホバー背景', fg:'--page-table-row-hover-fg', bg:'--page-table-row-hover-bg', text:'ホバー' },
    { label: '表 追加ボタン', fg:'--page-table-control-fg', bg:'--page-table-control-bg', bold:'--page-table-control-bold', italic:'--page-table-control-italic', line:'--page-table-control-border', width:'--page-table-control-border-width', text:'+ 行', font:'--page-table-control-font', fontSize:'--page-table-control-font-size' },
    { label: '表 追加ボタンホバー背景', fg:'--page-table-control-hover-fg', bg:'--page-table-control-hover-bg', line:'--page-table-control-hover-border', text:'+ 列' },
    { label: '表 追加ボタン形状', numbers:[
      { label:'角丸', key:'--page-table-control-radius', min:0, max:999, step:1, unit:'px', fallback:999 },
    ], text:'丸' },
    { label: '表 編集ツールバー', fg:'--page-table-toolbar-fg', bg:'--page-table-toolbar-bg', bold:'--page-table-toolbar-bold', italic:'--page-table-toolbar-italic', line:'--page-table-toolbar-border', width:'--page-table-toolbar-border-width', text:'↑行', font:'--page-table-toolbar-font', fontSize:'--page-table-toolbar-font-size' },
    { label: '表 編集ツールバーボタン', bg:'--page-table-toolbar-button-bg', line:'--page-table-toolbar-button-border', width:'--page-table-toolbar-button-border-width', text:'ボタン' },
    { label: '表 編集ツールバーボタンホバー背景', fg:'--page-table-toolbar-hover-fg', bg:'--page-table-toolbar-button-hover-bg', text:'ボタン' },
    { label: '表 編集ツールバー形状', numbers:[
      { label:'角丸', key:'--page-table-toolbar-radius', min:0, max:24, step:1, unit:'px', fallback:4 },
      { label:'ボタン角丸', key:'--page-table-toolbar-button-radius', min:0, max:24, step:1, unit:'px', fallback:2 },
    ], text:'角丸' },
    { label: '表 編集枠', line:'--page-cell-edit-outline-color', width:'--page-cell-edit-outline-width', text:'━━' },
    { label: 'コールアウト', fg:'--page-callout-fg', bg:'--page-callout-bg', line:'--page-callout-border', width:'--page-callout-border-width', text:'注釈', bgType:'rgba' },
    { label: 'コールアウト本文', fg:'--page-callout-body-fg', bg:null, bold:'--page-callout-body-bold', italic:'--page-callout-body-italic', text:'本文', font:'--page-callout-body-font' },
    { label: 'コールアウトアイコン', fg:'--page-callout-icon-fg', bg:null, text:'アイコン' },
    { label: 'コールアウト形状', numbers:[
      { label:'角丸', key:'--page-callout-radius', min:0, max:32, step:1, unit:'px', fallback:6 },
      { label:'間隔', key:'--page-callout-gap', min:0, max:40, step:1, unit:'px', fallback:10 },
      { label:'上下余白', key:'--page-callout-padding-y', min:0, max:48, step:1, unit:'px', fallback:12 },
      { label:'左右余白', key:'--page-callout-padding-x', min:0, max:64, step:1, unit:'px', fallback:14 },
      { label:'外余白', key:'--page-callout-margin-y', min:0, max:48, step:1, unit:'px', fallback:8 },
    ], text:'注釈' },
    { label: 'コールアウト 情報', bg:'--page-callout-info-bg', line:'--page-callout-info-border', text:'情報', bgType:'rgba' },
    { label: 'コールアウト 注意', bg:'--page-callout-warning-bg', line:'--page-callout-warning-border', text:'注意', bgType:'rgba' },
    { label: 'コールアウト 重要', bg:'--page-callout-danger-bg', line:'--page-callout-danger-border', text:'重要', bgType:'rgba' },
    { label: 'コールアウト 完了', bg:'--page-callout-success-bg', line:'--page-callout-success-border', text:'完了', bgType:'rgba' },
    { label: 'コピーボタン', fg:'--page-copy-button-fg', bg:'--page-copy-button-bg', line:'--page-copy-button-border', width:'--page-copy-button-border-width', text:'Copy' },
    { label: 'コピーボタンホバー背景', fg:'--page-copy-button-hover-fg', bg:'--page-copy-button-hover-bg', text:'Copy' },
    { label: 'コピーボタン形状', numbers:[
      { label:'角丸', key:'--page-copy-button-radius', min:0, max:24, step:1, unit:'px', fallback:4 },
      { label:'不透明度', key:'--page-copy-button-opacity', min:0, max:1, step:0.05, unit:'', slider:true, fallback:0.7 },
    ], text:'Copy' },
    { label: '引用元', fg:'--page-quote-cite-fg', bg:null, text:'引用元' },
    { label: '引用元リンク', fg:'--page-quote-cite-link-fg', bg:null, text:'リンク' },
    { label: '引用元不透明度', numbers:[
      { label:'通常', key:'--page-quote-cite-opacity', min:0, max:1, step:0.05, unit:'', slider:true, fallback:0.6 },
      { label:'ホバー', key:'--page-quote-cite-hover-opacity', min:0, max:1, step:0.05, unit:'', slider:true, fallback:1 },
    ], text:'0.6' },
    { label: 'リンクホバー背景', bg:'--page-link-hover-bg', text:'リンク', bgType:'rgba' },
    { label: 'リンクホバー形状', numbers:[{ label:'角丸', key:'--page-link-hover-radius', min:0, max:24, step:1, unit:'px', fallback:2 }], text:'角丸' },
    { label: 'コードブロック枠線', line:'--page-code-block-border', width:'--page-code-block-border-width', text:'━━' },
    { label: 'コードブロック形状', numbers:[{ label:'角丸', key:'--page-code-block-radius', min:0, max:24, step:1, unit:'px', fallback:4 }], text:'code' },
    { label: 'キーボード表記', fg:'--page-kbd-fg', bg:'--page-kbd-bg', line:'--page-kbd-border', width:'--page-kbd-border-width', text:'Ctrl' },
    { label: 'キーボード表記形状', numbers:[
      { label:'下線太さ', key:'--page-kbd-border-bottom-width', min:0, max:10, step:1, unit:'px', fallback:2 },
      { label:'角丸', key:'--page-kbd-radius', min:0, max:24, step:1, unit:'px', fallback:4 },
    ], text:'Ctrl' },
    { label: '開閉ブロック', bg:'--page-details-bg', line:'--page-details-border', width:'--page-details-border-width', text:'詳細', bgType:'rgba' },
    { label: '開閉ブロック見出し', fg:'--page-details-summary-fg', bg:'--page-details-summary-bg', text:'summary' },
    { label: '開閉ブロック見出しホバー背景', fg:'--page-details-summary-hover-fg', bg:'--page-details-summary-hover-bg', text:'summary' },
    { label: '開閉ブロック形状', numbers:[{ label:'角丸', key:'--page-details-radius', min:0, max:24, step:1, unit:'px', fallback:4 }], text:'詳細' },
    { label: '開閉ブロック開状態線', line:'--page-details-open-border', width:'--page-details-open-border-width', text:'━━' },
    { label: '見出しアイコン', fg:'--page-heading-icon-fg', bg:null, text:'アイコン' },
    { label: '見出しアイコン不透明度', numbers:[{ label:'不透明度', key:'--page-heading-icon-opacity', min:0, max:1, step:0.05, unit:'', slider:true, fallback:0.8 }], text:'0.8' },
    { label: 'ドラッグガイド', line:'--page-drag-guide-color', width:'--page-drag-guide-width', text:'━━' },
    { label: 'ドラッグ中不透明度', numbers:[{ label:'不透明度', key:'--page-dragging-opacity', min:0, max:1, step:0.05, unit:'', slider:true, fallback:0.4 }], text:'0.4' },
  ];

  function registerNoteStyleRows() {
    if (typeof UI_STYLE_SECTIONS === 'undefined' || !Array.isArray(UI_STYLE_SECTIONS['ノート'])) return;
    const noteRows = UI_STYLE_SECTIONS['ノート'];
    const existing = new Set(noteRows.map(row => row?.label));
    NOTE_STYLE_ROWS.forEach(row => {
      if (!existing.has(row.label)) noteRows.push(row);
    });
  }

  registerNoteStyleRows();
})();
