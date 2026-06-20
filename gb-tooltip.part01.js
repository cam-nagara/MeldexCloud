/* gb-tooltip.js - delegated tooltip layer for Meldex.
   Purpose: provide one tooltip behavior for existing title/aria-label hints
   and future data-gb-tooltip help text without editing every control. */
(function() {
  'use strict';

  const ATTR_PRIMARY = 'data-gb-tooltip';
  const ATTR_LEGACY = 'data-tooltip';
  const ATTR_HELP = 'data-help';
  const ATTR_DISABLED = 'data-gb-tooltip-disabled';
  const ATTR_NATIVE_TITLE = 'data-gb-native-title';
  const TOOLTIP_ID = 'gb-tooltip';
  const SHOW_DELAY_MS = 350;
  const FOCUS_DELAY_MS = 120;
  const HIDE_DELAY_MS = 80;
  const TOUCH_LONG_PRESS_MS = 520;
  const TOUCH_FOCUS_SUPPRESS_MS = TOUCH_LONG_PRESS_MS + FOCUS_DELAY_MS + 200;
  const INTERACTIVE_SELECTORS = [
    'button',
    'a[href]',
    'input',
    'select',
    'textarea',
    '[role="button"]',
    '[role="menuitem"]',
    '[tabindex]',
    '[data-action]',
    '[data-bd-action]',
    '[data-sn-action]',
    '[data-cal-action]',
    '[data-version-action]',
    '[data-db-action]',
    '[data-bd-tool]',
    '[data-tool]',
    '[data-align]',
    '[draggable="true"]',
    '.gb-color-swatch',
    '.tb-icon-btn',
    '.tb-text-btn',
    '.tool-menu-btn',
    '.bd-toolbar-btn',
    '.tl-nav-btn',
    '.sp-btn',
    '.sidebar-section-btn',
    '.sidebar-section-header'
  ];
  // タブ系要素はツールチップ解説を表示しない (ラベルを読めば分かるため冗長)
  const TAB_EXCLUDE_SELECTORS = [
    '[role="tab"]',
    '[data-rp-tab]',
    '[data-tab-id]',
    '.rp-tab',
    '.chat-mode-tab',
    '.gb-tab',
    '.gb-tab-icon',
    '.gb-tab-label',
    '.gb-panel-tab',
    '.gb-inner-tab'
  ];
  const CUSTOM_LINK_TOOLTIP_SELECTORS = [
    '.auto-link[data-path]',
    '.chat-md-link[data-chat-link-target]',
    '.chat-prop-link',
    '.bl-link[data-path]',
    '.bd-link-node[data-link-path]'
  ];
  const CELL_CONTENT_EXCLUDE_SELECTORS = [
    '#pivot-table tbody td',
    '.pivot-table tbody td',
    '.pivot-view td[role="cell"]',
    'td[data-prop-name]',
    'td.col-entity',
    '.new-entity-row td',
    '.cell-value',
    '.entity-name-label',
    '.value-text',
    '.db-cell-display-text',
    '.value-url',
    '.cell-thumbnail',
    '.multi-select-tags',
    '.multi-select-tag',
    '.cell-select-val',
    '.cell-number',
    '.relation-link'
  ];
  const TRANSIENT_TOOLTIP_EXCLUDE_SELECTORS = [
    '.status-dropdown',
    '.cell-inline-dd',
    '.user-dropdown',
    '.gb-context-menu',
    '.db-picker-popup',
    '.gb-selection-float-bar',
    '.value-input',
    '.cell-inline-input',
    '.cell-date-editor'
  ];
  const TARGET_SELECTORS = [
    '[' + ATTR_PRIMARY + ']',
    '[' + ATTR_LEGACY + ']',
    '[' + ATTR_HELP + ']',
    '[title]',
    '[aria-label]',
    '[' + ATTR_NATIVE_TITLE + ']',
    ...INTERACTIVE_SELECTORS
  ];
  // 中央レジストリ: 「id / action / data-* / icon」のキーを横断で引く高品質ツールチップ。
  // 値は { label, desc?, shortcutId? }。表示は formatRegistryEntry() で合成する。
  // 詳細解説のないものは ACTION_HINTS / DATA_HINTS / ID_HINTS / ICON_HINTS の旧経路を使う。
  const REGISTRY = Object.create(null);
  function reg(scope, key, entry) {
    REGISTRY[scope + ':' + key] = entry;
  }
  function regId(key, entry) { reg('id', key, entry); }
  function regAction(key, entry) { reg('action', key, entry); }
  function regData(name, value, entry) { reg('data:' + name, value, entry); }
  function regIcon(key, entry) { reg('icon', key, entry); }

  function lookupShortcutKey(id) {
    if (!id) return '';
    if (typeof window.getShortcutKey === 'function') return window.getShortcutKey(id) || '';
    if (typeof getShortcutKey === 'function') return getShortcutKey(id) || '';
    return '';
  }
  function lookupShortcutDisplay(id) {
    const key = lookupShortcutKey(id);
    if (!key) return '';
    if (typeof window._formatKeyDisplay === 'function') return window._formatKeyDisplay(key);
    if (typeof _formatKeyDisplay === 'function') return _formatKeyDisplay(key);
    return key;
  }
  function formatRegistryEntry(entry) {
    if (!entry) return '';
    const label = entry.label || '';
    const desc = entry.desc || '';
    let text = label;
    if (label && desc) text = label + ' — ' + desc;
    else if (!label && desc) text = desc;
    if (entry.shortcutId) {
      const disp = lookupShortcutDisplay(entry.shortcutId);
      if (disp) text += ' (' + disp + ')';
    }
    return text;
  }

  const ACTION_HINTS = Object.freeze({
    add: '追加します',
    addcolumn: '列を追加します',
    addtodaytask: '今日のToDoを追加します',
    annclear: '注釈をすべて削除します',
    applyapplayout: '単一レイアウトを維持します',
    bdopenfindbar: 'ボード内を検索または置換します',
    chatattachments: '添付ファイルを追加します',
    chatattachmentpick: 'チャットに画像を添付します',
    chatclear: '新しいチャットを開始します',
    chatsave: '現在のチャットを保存します',
    chatsend: 'チャットを送信します',
    clearfilesearch: '検索バーを閉じます',
    cleartreenamesearch: 'フォルダツリー検索をクリアします',
    createnewapplayout: '現在の配置からレイアウトを作成します',
    docmd: '選択中の操作を実行します',
    dofilereplace: '現在のファイル内で置換します',
    dofilesearch: '現在のファイル内を検索します',
    dovaultreplace: 'ソースフォルダ内を置換します',
    dovaultsearch: 'ソースフォルダ内を検索します',
    fvbulkslideshow: '選択中のファイルをスライドショーで開きます',
    fvbulkboard: '選択中のファイルをボードに並べます',
    fvbulkdelete: '選択中のファイルを削除します',
    fvbulkcopypath: '選択中のファイルパスをコピーします',
    fvbulkdeselect: '選択を解除します',
    historyredo: '操作をやり直します',
    historyundo: '直前の操作を元に戻します',
    htmlnavback: '前のページへ戻ります',
    htmlnavforward: '次のページへ進みます',
    htmlnavigate: '入力したURLへ移動します',
    htmlrefresh: '表示中のページを更新します',
    insertcallout: 'コールアウトを挿入します',
    insertnotetable: '表を挿入します',
    loadrpannotationlist: '注釈一覧を更新します',
    newrpcomment: '新しい注釈コメントを作成します',
    onstampsend: 'スタンプを送信します',
    onvalidateclick: 'シートの整合性を検証します',
    opencurrenttoolbarsearchreplace: 'このビューで検索と置換を開きます',
    openrightpaneltab: '右サイドバーのタブを開きます',
    opensearchpanel: '全文検索パネルを開きます',
    rtcmd: 'ノートの書式を変更します',
    showchatllmhelpmenu: 'LLMチャットのヘルプを開きます',
    showchatrulesdialog: 'LLMに守らせるルールを編集します',
    showcolumndisplayordermodal: 'シート列の表示状態と並び順を変更します',
    showcolvisibilitymodal: 'シート列の表示状態と並び順を変更します',
    showcreatecalendar: '新しいカレンダーを作成します',
    showcreateroommodal: '新しいルームを作成します',
    showdbsearchmodal: '複数シートを横断検索します',
    showdirectmessagemodal: 'DMを開始します',
    showfolderdisplaysettings: 'フォルダビューの表示を設定します',
    showfolderpanelsettings: 'フォルダビューのオプションを開きます',
    showpanelmenu: 'パネルメニューを開きます',
    showsettingsmodal: '設定を開きます',
    showtoolmenu: 'ツールメニューを開きます',
    showunifiedfiltermodal: 'フィルタ条件を設定します',
    showusermenu: 'ユーザー設定を開きます',
    showvalidationrulesmodal: '検証ルールを管理します',
    switchchatmode: 'チャット表示を切り替えます',
    switchrighttab: '右サイドバーの表示を切り替えます',
    teamattachmentpick: 'チームチャットに画像を添付します',
    teamsend: 'チームチャットへ送信します',
    toggleactivitymenu: 'メニューを開閉します',
    toggleannotationtoolbar: '注釈ツールバーを開閉します',
    toggledetailpanel: 'オプションパネルを開閉します',
    toggleglobalfilterbar: 'フォルダツリーのフィルタを表示または非表示にします',
    toggleheadingindent: '見出しインデント表示を切り替えます',
    togglenotevertical: 'ノートの縦書きを切り替えます',
    toggleoverlayvisibility: '注釈オーバーレイを表示または非表示にします',
    togglerightpaneltab: '右サイドバーのタブを開閉します',
    togglesidebar: 'フォルダツリーを開閉します',
    togglesidebarsection: 'セクションを開閉します',
    togglenotetoc: '目次を表示または非表示にします',
    chatsearchclose: 'チャット検索を閉じます',
    chatsearchtoggle: 'チャット内検索を開閉します',
    opensourcefoldersettings: 'ソースフォルダの管理を開きます',
    addoutlinerrootfromsettings: 'ソースフォルダを追加します',
    showhomeaddmenu: 'ホームフォルダへ追加する項目を選びます'
  });
  const DATA_HINTS = Object.freeze({
    'bd-action:pick-card-style': 'カードスタイルを選択します',
    'bd-action:manage-card-styles': 'カードスタイルを管理します',
    'bd-action:pick-line-style': 'ラインスタイルを選択します',
    'bd-action:manage-line-styles': 'ラインスタイルを管理します',
    'bd-action:filters': 'ボードのフィルタを設定します',
    'bd-action:find-replace': 'ボード内を検索または置換します',
    'bd-action:detail': 'ボードのオプションを開きます',
    'bd-action:zoom-select': '表示倍率を選択します',
    'bd-action:zoom-out': '表示倍率を下げます',
    'bd-action:zoom-in': '表示倍率を上げます',
    'bd-action:zoom-100': '表示倍率を100%に戻します',
    'bd-action:fit': 'ボード全体が見える倍率にします',
    'bd-action:reset-rotation': '回転をリセットします',
    'bd-action:bg-color': 'ボード背景色を変更します',
    'bd-action:bg-image': '背景画像を設定します',
    'bd-action:bg-clear': '背景をクリアします',
    'bd-tool:select': 'カードやラインを選択します',
    'bd-tool:add-card': 'ボードにカードを追加します',
    'bd-tool:add-line': 'カード間にラインを追加します',
    'bd-tool:erase': 'カードやラインを消します',
    'sn-action:saveTemplate': '現在のシナリオ設定をテンプレートとして登録します',
    'sn-action:horizontal': 'シナリオを横書き表示にします',
    'sn-action:vertical': 'シナリオを縦書き表示にします',
    'sn-action:wrap': 'シナリオ本文の折返しを切り替えます',
    'sn-action:mergeDisplay': '同じタイプやガター値を省略して表示します',
    'sn-action:addColumn': 'シナリオに列を追加します',
    'sn-action:filter': 'シナリオをタイプや採用状況で絞り込みます',
    'sn-action:reload': 'シナリオファイルを再読み込みします',
    'sn-action:saveFilter': '現在のフィルタを登録します',
    'sn-action:search': 'シナリオ本文を検索または置換します',
    'sn-action:detail': 'シナリオのオプションを開きます',
    'cal-action:toggleSidebar': 'スケジューラーサイドバーを開閉します',
    'cal-action:today': '今日へ移動します',
    'cal-action:prev': '前の期間へ移動します',
    'cal-action:next': '次の期間へ移動します',
    'cal-action:template': 'カレンダーテンプレートを開きます',
    'cal-action:timer': 'タイマーを開きます',
    'cal-action:production': '制作管理パネルを開きます',
    'cal-action:sync': '外部カレンダーと同期します',
    'cal-action:sidebarOnly': 'サイドバーのみの表示に切り替えます',
    'cal-action:settings': 'スケジューラー設定を開きます',
    'cal-action:miniPrev': '小型カレンダーを前の月へ移動します',
    'cal-action:miniNext': '小型カレンダーを次の月へ移動します',
    'cal-action:addTodayTask': '今日のToDoを追加します',
    'cal-action:createCalendar': '新しいカレンダーを作成します',
    'tool:pen': 'ペンで注釈を書き込みます',
    'tool:marker': 'マーカーで注釈を書き込みます',
    'tool:lasso': '囲んだ範囲を塗ります',
    'tool:eraser': '注釈を消します',
    'tool:sticky': '付箋を追加します',
    'align:left': '左寄せにします',
    'align:center': '中央に揃えます',
    'align:right': '右寄せにします',
    'rp-tab:calendar': 'カレンダータブを表示します',
    'rp-tab:chat': 'チャットタブを表示します',
    'rp-tab:annotation': '注釈タブを表示します',
    'rp-tab:history': '履歴タブを表示します'
  });
  const ID_HINTS = Object.freeze({
    'left-chrome-command-trigger': 'コマンドやファイルを検索します',
    'left-chrome-floating-command': 'コマンドやファイルを検索します',
    'left-chrome-help': 'ヘルプを開きます',
    'left-chrome-floating-help': 'ヘルプを開きます',
    'left-chrome-trash': 'ゴミ箱を開きます',
    'left-chrome-floating-trash': 'ゴミ箱を開きます',
    'left-chrome-settings': 'Meldexの設定を開きます',
    'left-chrome-floating-settings': 'Meldexの設定を開きます',
    'left-chrome-user': 'ユーザー設定を開きます',
    'left-chrome-floating-user': 'ユーザー設定を開きます',
    'ann-color-swatch': '注釈の色を変更します',
    'ann-opacity': '注釈の不透明度を調整します',
    'bd-zoom-slider': 'ボードの表示倍率を調整します',
    'bd-rot-slider': 'ボードの回転角度を調整します',
    'btn-tree-search-clear': 'フォルダツリー検索をクリアします',
    'btn-vault-search': 'ソースフォルダ内を全文検索します',
    'btn-filter-toggle': 'フォルダツリーのフィルタを表示または非表示にします',
    'chat-session-title': 'チャット名を入力します。Enterまたはフォーカス移動で保存します',
    'chat-title-dropdown-btn': '過去のチャットを選択します',
    'folder-btn-slideshow': '現在のフォルダをスライドショーで開きます',
    'sidebar-resize': 'ドラッグしてフォルダツリーの幅を調整します'
  });
  const ICON_HINTS = Object.freeze({
    add: '追加します',
    arrowLeftS: '戻ります',
    arrowRightS: '進みます',
    board: 'ボードを開きます',
    bold: '太字にします',
    calendar: 'カレンダーを開きます',
    camera: 'スクリーンショットを撮影します',
    check: '完了または解決にします',
    checkSquare: '検証します',
    clipboardList: '一覧を開きます',
    columns: '列を設定します',
    db: 'シートを開きます',
    filter: 'フィルタを設定します',
    funnel: 'フィルタを設定します',
    history: '履歴を開きます',
    italic: '斜体にします',
    menu: 'メニューを開きます',
    messagesSquare: 'チャットを開きます',
    minus: '区切り線を挿入します',
    panelLeft: '左パネルを開閉します',
    panelRight: '右サイドバーを開閉します',
    play: '再生またはスライドショーを開始します',
    plus: '追加します',
    refreshCw: '更新します',
    save: '保存します',
    search: '検索します',
    settings2: '設定を開きます',
    slidersHorizontal: 'オプションを開きます',
    stickyNote: '注釈を開きます',
    strikethrough: '取り消し線を適用します',
    table: '表を挿入します',
    trash2: '削除します',
    underline: '下線を適用します',
    x: '閉じます'
  });

  let tooltipEl = null;
  let activeEl = null;
  let pendingEl = null;
  let suppressedEl = null;
  let showTimer = 0;
  let hideTimer = 0;
  let touchLongPressTimer = 0;
  let touchLongPressEl = null;
  let suppressFocusTooltipUntil = 0;

  function ensureTooltip() {
    if (tooltipEl && tooltipEl.isConnected) return tooltipEl;
    tooltipEl = document.createElement('div');
    tooltipEl.id = TOOLTIP_ID;
    tooltipEl.className = 'gb-tooltip';
    tooltipEl.setAttribute('role', 'tooltip');
    tooltipEl.hidden = true;
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }

  function isExplicitTooltip(el) {
    return el.hasAttribute(ATTR_PRIMARY) || el.hasAttribute(ATTR_LEGACY) || el.hasAttribute(ATTR_HELP);
  }

  function isInteractiveLike(el) {
    if (!el || !el.matches) return false;
    return el.matches(INTERACTIVE_SELECTORS.join(','));
  }

  function isTabLike(el) {
    if (!el || !el.matches) return false;
    return el.matches(TAB_EXCLUDE_SELECTORS.join(','));
  }

  function isCustomLinkTooltipTarget(el) {
    if (!el || !el.closest) return false;
    return !!el.closest(CUSTOM_LINK_TOOLTIP_SELECTORS.join(','));
  }

  function isCellContentTooltipTarget(el) {
    if (!el || !el.closest) return false;
    return !!el.closest(CELL_CONTENT_EXCLUDE_SELECTORS.join(','));
  }

  function isTransientTooltipTarget(el) {
    if (!el || !el.closest) return false;
    return !!el.closest(TRANSIENT_TOOLTIP_EXCLUDE_SELECTORS.join(','));
  }

  function findCellContentNativeTitleTarget(start) {
    if (!(start instanceof Element)) return null;
    const cellTarget = start.closest(CELL_CONTENT_EXCLUDE_SELECTORS.join(','));
    if (!cellTarget) return null;
    const titleTarget = start.closest('[title],[' + ATTR_NATIVE_TITLE + ']');
    if (titleTarget && (cellTarget.contains(titleTarget) || titleTarget.contains(cellTarget))) return titleTarget;
    if (cellTarget.hasAttribute('title') || cellTarget.hasAttribute(ATTR_NATIVE_TITLE)) return cellTarget;
    return null;
  }

  function isTooltipEligible(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.closest('.gb-tooltip')) return false;
    if (el.getAttribute(ATTR_DISABLED) === 'true') return false;
    if (isTabLike(el)) return false;
    if (isCustomLinkTooltipTarget(el)) return false;
    if (isCellContentTooltipTarget(el)) return false;
    if (isTransientTooltipTarget(el)) return false;
    if (isExplicitTooltip(el)) return true;
    return isInteractiveLike(el);
  }

  function findTooltipTarget(start) {
    if (!(start instanceof Element)) return null;
    const el = start.closest(TARGET_SELECTORS.join(','));
    if (!el || !document.documentElement.contains(el)) return null;
    return isTooltipEligible(el) ? el : null;
  }

  function readAttr(el, name) {
    const value = el.getAttribute(name);
    return value == null ? '' : String(value).trim();
  }

  function normalizeKey(value) {
    return String(value || '').replace(/[\s_-]+/g, '').toLowerCase();
  }

  function actionName(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^([A-Za-z_$][\w$]*)/);
    return match ? match[1] : raw;
  }

  function firstDatasetHint(el) {
    const pairs = [
      ['bd-action', el.getAttribute('data-bd-action')],
      ['bd-tool', el.getAttribute('data-bd-tool')],
      ['sn-action', el.getAttribute('data-sn-action')],
      ['cal-action', el.getAttribute('data-cal-action')],
      ['version-action', el.getAttribute('data-version-action')],
      ['db-action', el.getAttribute('data-db-action')],
      ['tool', el.getAttribute('data-tool')],
      ['align', el.getAttribute('data-align')],
      ['rp-tab', el.getAttribute('data-rp-tab')]
    ];
    for (const [name, value] of pairs) {
      if (!value) continue;
      const direct = DATA_HINTS[name + ':' + value];
      if (direct) return direct;
      const normalized = DATA_HINTS[name + ':' + normalizeKey(value)];
      if (normalized) return normalized;
    }
    const action = el.getAttribute('data-action');
    if (action) {
      const key = normalizeKey(actionName(action));
      if (ACTION_HINTS[key]) return ACTION_HINTS[key];
    }
    return '';
  }

  function idHint(el) {
    const id = readAttr(el, 'id');
    return id ? (ID_HINTS[id] || ID_HINTS[normalizeKey(id)] || '') : '';
  }

  function compactText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function visibleTextHint(el) {
    if (!el) return '';
    const text = compactText(el.textContent);
    if (!text) return '';
    if (!isTextVisiblyTruncated(el)) return '';
    // ボタン・タブの可視テキストはそのまま返す（「を実行します」「を表示します」等の冗長な接尾辞は付けない）。
    return text;
  }

  function normalizedTooltipText(value) {
    return compactText(value).replace(/[、。,.!?！？:：;；]+$/g, '');
  }

  function sameVisibleText(el, text) {
    if (!el || !text) return false;
    const visible = normalizedTooltipText(el.textContent);
    const tooltip = normalizedTooltipText(text);
    return !!visible && visible === tooltip;
  }

  function isNodeOverflowing(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    return (el.scrollWidth > el.clientWidth + 1) || (el.scrollHeight > el.clientHeight + 1);
  }

  function isTextVisiblyTruncated(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (isNodeOverflowing(el)) return true;
    const selectors = [
      '.tree-label',
      '.fv-name',
      '.gb-tab-label',
      '.gb-panel-title',
      '.sidebar-item-label',
      '.entity-name-label',
      '.value-text'
    ];
    for (const selector of selectors) {
      const node = el.matches?.(selector) ? el : el.querySelector?.(selector);
      if (isNodeOverflowing(node)) return true;
    }
    return false;
  }

  function shouldSuppressRedundantTooltip(el, text) {
    if (!sameVisibleText(el, text)) return false;
    return !isTextVisiblyTruncated(el);
  }

  function finalizeTooltipText(text, el) {
    const withShortcut = appendShortcut(text, el);
    return shouldSuppressRedundantTooltip(el, withShortcut) ? '' : withShortcut;
  }

  function placeholderHint(el) {
    const placeholder = readAttr(el, 'placeholder');
    if (!placeholder) return '';
    // placeholder はそのまま返す（接尾辞「を入力します」を付けても「キーワードを入力」+「を入力します」のように二重になるため）。
    return placeholder;
  }

  function labelHint(el) {
    const id = readAttr(el, 'id');
    let label = '';
    if (id && document.querySelector) {
      try {
        const node = document.querySelector('label[for="' + cssEscape(id) + '"]');
        if (node) label = compactText(node.textContent);
      } catch {}
    }
    if (!label) {
      const wrapper = el.closest && el.closest('label');
      if (wrapper) label = compactText(wrapper.textContent);
    }
    if (!label) return '';
    // 「（機能名）を設定します」のような無意味なフォールバックは付けない（ラベルそのままを返す）。
    return label;
  }

  function iconHint(el) {
    const icon = el.querySelector && el.querySelector('[class*="ico-"]');
    if (!icon) return '';
    for (const cls of icon.classList) {
      if (!cls.startsWith('ico-')) continue;
      const key = cls.slice(4);
      if (ICON_HINTS[key]) return ICON_HINTS[key];
    }
    return '';
  }

  function controlFallbackHint(el) {
    if (!el || !el.tagName) return '';
    // ボタン・タブ・汎用入力に対する無意味な汎用文言（「この操作を実行します」「値を入力します」等）は出さない。
    // 文脈情報のある drag や input[type=range] のみ残す（操作方法の手掛かりになるため）。
    if (el.hasAttribute('draggable')) {
      if (compactText(el.textContent)) return '';
      return 'ドラッグして移動または並べ替えます';
    }
    const tag = el.tagName.toLowerCase();
    const type = readAttr(el, 'type').toLowerCase();
    if (tag === 'input' && type === 'range') return 'ドラッグして値を調整します';
    if (tag === 'input' && type === 'color') return 'クリックして色を選びます';
    return '';
  }

  function registryHint(el) {
    if (!el || !el.getAttribute) return '';
    const id = readAttr(el, 'id');
    if (id) {
      const e = REGISTRY['id:' + id] || REGISTRY['id:' + normalizeKey(id)];
      if (e) return formatRegistryEntry(e);
    }
    const dataPairs = [
      ['bd-action', el.getAttribute('data-bd-action')],
      ['bd-tool', el.getAttribute('data-bd-tool')],
      ['sn-action', el.getAttribute('data-sn-action')],
      ['cal-action', el.getAttribute('data-cal-action')],
      ['version-action', el.getAttribute('data-version-action')],
      ['db-action', el.getAttribute('data-db-action')],
      ['tool', el.getAttribute('data-tool')],
      ['align', el.getAttribute('data-align')],
      ['rp-tab', el.getAttribute('data-rp-tab')],
      ['rt-cmd', el.getAttribute('data-rt-cmd')]
    ];
    for (const [name, value] of dataPairs) {
      if (!value) continue;
      const e = REGISTRY['data:' + name + ':' + value]
        || REGISTRY['data:' + name + ':' + normalizeKey(value)];
      if (e) return formatRegistryEntry(e);
    }
    const action = el.getAttribute('data-action');
    if (action) {
      const k = normalizeKey(actionName(action));
      const argMatch = action.match(/[A-Za-z_$][\w$]*\(\s*(['"]?)([^'",)]*)\1/);
      if (argMatch && argMatch[2]) {
        // 引数は dash や符号付き数値を区別したいので軽い正規化のみ。
        const argKey = String(argMatch[2]).trim().toLowerCase();
        const e = REGISTRY['action:' + k + ':' + argKey];
        if (e) return formatRegistryEntry(e);
      }
      const e = REGISTRY['action:' + k];
      if (e) return formatRegistryEntry(e);
    }
    const iconNode = el.querySelector && el.querySelector('[class*="ico-"]');
    if (iconNode) {
      for (const cls of iconNode.classList) {
        if (!cls.startsWith('ico-')) continue;
        const e = REGISTRY['icon:' + cls.slice(4)];
        if (e) return formatRegistryEntry(e);
      }
    }
    return '';
  }

  function appendShortcut(text, el) {
    if (!text || !el) return text;
    if (/[(（][^)）]*[)）]\s*$/.test(text)) return text;
    const id = el.getAttribute && (el.getAttribute('data-shortcut-id') || el.dataset?.shortcutId);
    if (!id) return text;
    const disp = lookupShortcutDisplay(id);
    if (!disp) return text;
    return text + ' (' + disp + ')';
  }

  function getTooltipText(el) {
    if (!el) return '';
    const fromRegistry = registryHint(el);
    // registry に shortcutId が無くても data-shortcut-id があれば後付けする。
    // appendShortcut は末尾に既に括弧表記があれば二重付与を避けるため安全。
    if (fromRegistry) return finalizeTooltipText(fromRegistry, el);
    const text = (
      readAttr(el, ATTR_PRIMARY) ||
      readAttr(el, ATTR_LEGACY) ||
      readAttr(el, ATTR_HELP) ||
      readAttr(el, 'title') ||
      readAttr(el, ATTR_NATIVE_TITLE) ||
      readAttr(el, 'aria-label') ||
      firstDatasetHint(el) ||
      idHint(el) ||
      placeholderHint(el) ||
      labelHint(el) ||
      visibleTextHint(el) ||
      iconHint(el) ||
      controlFallbackHint(el)
    );
    return finalizeTooltipText(text, el);
  }

  function shouldKeepNativeTitleSuppressed(el) {
    const nativeTitle = readAttr(el, ATTR_NATIVE_TITLE) || readAttr(el, 'title');
    return !!nativeTitle && shouldSuppressRedundantTooltip(el, nativeTitle);
  }

  function suppressNativeTitle(el) {
    if (!el || !el.hasAttribute('title')) return;
    if (!el.hasAttribute(ATTR_NATIVE_TITLE)) {
      el.setAttribute(ATTR_NATIVE_TITLE, el.getAttribute('title') || '');
    }
    el.removeAttribute('title');
  }

  function restoreNativeTitle(el) {
    if (!el || !el.hasAttribute(ATTR_NATIVE_TITLE)) return;
    const title = el.getAttribute(ATTR_NATIVE_TITLE) || '';
    if (title) el.setAttribute('title', title);
    else el.removeAttribute('title');
    el.removeAttribute(ATTR_NATIVE_TITLE);
  }

  function clearTimers() {
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = 0;
    }
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = 0;
    }
  }

  function positionTooltip(el) {
    const tip = ensureTooltip();
    tip.removeAttribute('style');

    const rect = el.getBoundingClientRect();
    if (typeof positionPopup === 'function') {
      positionPopup(tip, rect, { prefer: 'below', gap: 6 });
    }
  }

  function showFor(el, explicitText) {
    if (!el || !document.documentElement.contains(el)) return;
    const text = explicitText != null ? String(explicitText).trim() : getTooltipText(el);
    if (!text) {
      if (shouldKeepNativeTitleSuppressed(el)) return;
      restoreNativeTitle(el);
      return;
    }

    const tip = ensureTooltip();
    activeEl = el;
    pendingEl = null;
    suppressNativeTitle(el);
    tip.textContent = text;
    tip.hidden = false;
    tip.classList.add('is-visible');
    tip.setAttribute('aria-hidden', 'false');
    positionTooltip(el);
  }

  function isSuppressed(el) {
    if (!suppressedEl) return false;
    if (!document.documentElement.contains(suppressedEl)) {
      suppressedEl = null;
      return false;
    }
    return el === suppressedEl || suppressedEl.contains(el);
  }

  function clearSuppressed() {
    if (!suppressedEl) return;
    const prev = suppressedEl;
    suppressedEl = null;
    restoreNativeTitle(prev);
  }

  function hideNow(options) {
    const prev = activeEl || pendingEl;
    const suppressUntilLeave = !!options?.suppressUntilLeave;
    const suppressTarget = suppressUntilLeave ? activeEl : null;
    clearTimers();
    activeEl = null;
    pendingEl = null;
    if (tooltipEl) {
      tooltipEl.hidden = true;
      tooltipEl.classList.remove('is-visible');
      tooltipEl.setAttribute('aria-hidden', 'true');
      tooltipEl.textContent = '';
    }
    if (suppressTarget && document.documentElement.contains(suppressTarget)) {
      if (suppressedEl && suppressedEl !== suppressTarget) restoreNativeTitle(suppressedEl);
      suppressedEl = suppressTarget;
      suppressNativeTitle(suppressTarget);
    } else {
      restoreNativeTitle(prev);
    }
  }

  function queueShow(el, delay) {
    if (!el || el === activeEl || el === pendingEl) return;
    if (suppressedEl && !suppressedEl.contains(el)) clearSuppressed();
    if (isSuppressed(el)) return;
    clearTimers();
    if (activeEl && activeEl !== el) restoreNativeTitle(activeEl);
    activeEl = null;
    pendingEl = el;
    suppressNativeTitle(el);
    showTimer = window.setTimeout(() => showFor(el), delay);
  }

  function queueHide(el) {
    if (el && activeEl && el !== activeEl && !activeEl.contains(el)) return;
    if (hideTimer) clearTimeout(hideTimer);
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = 0;
      restoreNativeTitle(pendingEl);
      pendingEl = null;
    }
    hideTimer = window.setTimeout(hideNow, HIDE_DELAY_MS);
  }

  function clearTouchLongPress() {
    const prev = touchLongPressEl;
    if (touchLongPressTimer) {
      clearTimeout(touchLongPressTimer);
      touchLongPressTimer = 0;
    }
    touchLongPressEl = null;
    if (prev && prev !== activeEl && prev !== pendingEl && prev !== suppressedEl) {
      restoreNativeTitle(prev);
    }
  }

  function suppressFocusTooltipAfterTouch() {
    suppressFocusTooltipUntil = Date.now() + TOUCH_FOCUS_SUPPRESS_MS;
  }

  function handlePointerOver(ev) {
    if (ev.pointerType && ev.pointerType !== 'mouse') return;
    if (isTransientTooltipTarget(ev.target)) {
      hideNow();
      return;
    }
    const cellTitleEl = findCellContentNativeTitleTarget(ev.target);
    if (cellTitleEl) suppressNativeTitle(cellTitleEl);
    const el = findTooltipTarget(ev.target);
    if (!el) return;
    queueShow(el, SHOW_DELAY_MS);
  }

  function handlePointerOut(ev) {
    if (ev.pointerType && ev.pointerType !== 'mouse') {
      clearTouchLongPress();
      return;
    }
    const cellTitleEl = findCellContentNativeTitleTarget(ev.target);
    if (cellTitleEl && (!(ev.relatedTarget instanceof Node) || !cellTitleEl.contains(ev.relatedTarget))) {
      restoreNativeTitle(cellTitleEl);
    }
    if (suppressedEl && (!(ev.relatedTarget instanceof Node) || !suppressedEl.contains(ev.relatedTarget))) {
      clearSuppressed();
    }
    const el = activeEl || pendingEl;
    if (!el) return;
    if (ev.relatedTarget instanceof Node && el.contains(ev.relatedTarget)) return;
    queueHide(el);
  }

  function handlePointerMove(ev) {
    if (ev.pointerType && ev.pointerType !== 'mouse') return;
    if (!activeEl && !pendingEl) return;
    const el = findTooltipTarget(ev.target);
    if (activeEl) {
      hideNow({ suppressUntilLeave: true });
      if (el && !isSuppressed(el)) queueShow(el, SHOW_DELAY_MS);
      return;
    }
    if (!el) {
      hideNow();
      return;
    }
    if (pendingEl && el !== pendingEl && !pendingEl.contains(el)) {
      hideNow();
      queueShow(el, SHOW_DELAY_MS);
    }
  }

  function handlePointerDown(ev) {
    if (!ev.pointerType || ev.pointerType === 'mouse') {
      if (activeEl || pendingEl || touchLongPressEl) {
        clearTouchLongPress();
        hideNow({ suppressUntilLeave: true });
      }
      return;
    }
    const el = findTooltipTarget(ev.target);
    if (!el) return;
    suppressFocusTooltipAfterTouch();
    clearTouchLongPress();
    touchLongPressEl = el;
    suppressNativeTitle(el);
    touchLongPressTimer = window.setTimeout(() => {
      if (touchLongPressEl && document.documentElement.contains(touchLongPressEl)) {
        showFor(touchLongPressEl);
      }
      touchLongPressTimer = 0;
    }, TOUCH_LONG_PRESS_MS);
  }

  function handlePointerEnd(ev) {
    if (!ev.pointerType || ev.pointerType === 'mouse') return;
    suppressFocusTooltipAfterTouch();
    clearTouchLongPress();
    if (activeEl) queueHide(activeEl);
  }

  function handleImmediateDismiss() {
    if (!activeEl && !pendingEl && !touchLongPressEl) return;
    clearTouchLongPress();
    hideNow({ suppressUntilLeave: true });
  }

  function handleFocusIn(ev) {
    if (Date.now() < suppressFocusTooltipUntil) return;
    if (isTransientTooltipTarget(ev.target)) {
      hideNow();
      return;
    }
    const el = findTooltipTarget(ev.target);
    if (!el) return;
    queueShow(el, FOCUS_DELAY_MS);
  }

  function handleFocusOut(ev) {
    const el = activeEl || pendingEl;
    if (!el) return;
    if (ev.relatedTarget instanceof Node && el.contains(ev.relatedTarget)) return;
    queueHide(el);
  }

  function handleKeyDown(ev) {
    if (ev.key === 'Escape' && (activeEl || pendingEl || touchLongPressEl)) {
      clearTouchLongPress();
      hideNow();
    }
  }

  function refresh() {
    if (activeEl && tooltipEl && !tooltipEl.hidden) {
      const text = getTooltipText(activeEl);
      if (!text) hideNow();
      else {
        tooltipEl.textContent = text;
        positionTooltip(activeEl);
      }
    }
  }

  function install() {
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('mousedown', handleImmediateDismiss, true);
    document.addEventListener('contextmenu', handleImmediateDismiss, true);
    document.addEventListener('wheel', handleImmediateDismiss, true);
    document.addEventListener('pointerover', handlePointerOver, true);
    document.addEventListener('pointermove', handlePointerMove, true);
    document.addEventListener('pointerout', handlePointerOut, true);
    document.addEventListener('pointerup', handlePointerEnd, true);
    document.addEventListener('pointercancel', handlePointerEnd, true);
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', handleFocusOut, true);
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', refresh);
    window.addEventListener('scroll', () => {
      clearTouchLongPress();
      refresh();
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }

  // ====== Registry seed (B1: 左クローム / 右アクティビティバー) ======
  // フォーマット: `label — desc (Ctrl+S)`。shortcutId は GB_SHORTCUTS のキーを参照。
  regId('left-chrome-command-trigger', { label: 'コマンドパレット', desc: 'コマンドやファイルを検索します', shortcutId: 'global.commandPalette' });
  regId('left-chrome-floating-command', { label: 'コマンドパレット', desc: 'コマンドやファイルを検索します', shortcutId: 'global.commandPalette' });
  regId('left-chrome-user',     { label: 'ユーザー', desc: 'ユーザー設定を開きます' });
  regId('left-chrome-floating-user', { label: 'ユーザー', desc: 'ユーザー設定を開きます' });
  regId('left-chrome-help', { label: 'ヘルプ', desc: 'ヘルプメニューを開きます' });
  regId('left-chrome-floating-help', { label: 'ヘルプ', desc: 'ヘルプメニューを開きます' });
  regId('left-chrome-trash', { label: 'ゴミ箱', desc: '削除済みファイルを開きます' });
  regId('left-chrome-floating-trash', { label: 'ゴミ箱', desc: '削除済みファイルを開きます' });
  regId('left-chrome-settings', { label: '設定', desc: 'アプリ全体の設定ダイアログを開きます', shortcutId: 'global.settings' });
  regId('left-chrome-floating-settings', { label: '設定', desc: 'アプリ全体の設定ダイアログを開きます', shortcutId: 'global.settings' });
  regId('btn-sidebar-toggle',  { label: 'フォルダツリー', desc: '左サイドバーのフォルダツリーを開閉します' });
  regId('btn-tb-annotation',   { label: '注釈ツール', desc: '手描き注釈ツールバーを開閉します', shortcutId: 'global.annotation' });
  regId('btn-overlay-toggle',  { label: '注釈オーバーレイ', desc: '描き込んだ注釈の表示/非表示を切り替えます' });
  regId('btn-split-toggle',    { label: 'スプリット', desc: '画面を上下または左右に分割して2画面表示にします' });
  regId('btn-toc-toggle',      { label: '目次',       desc: 'ノートの見出しから生成した目次パネルを開閉します' });
  regId('btn-note-vertical',   { label: '縦書き / 横書き', desc: 'ノート本文の組方向を切り替えます' });
  regId('btn-heading-indent',  { label: '見出しインデント', desc: '見出しレベルに応じた本文の段下げ表示を切り替えます' });
  regId('btn-version',         { label: 'バージョン管理', desc: 'ファイルの履歴・差分・復元を行うパネルを開きます' });
  regId('btn-filter',          { label: 'フィルタ',   desc: 'シートの絞り込み条件を設定します', shortcutId: 'db.filter' });
