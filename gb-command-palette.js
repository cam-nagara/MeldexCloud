/* gb-command-palette.js: global command palette and left chrome footer */
(function () {
  'use strict';

  const MAX_RECENT_ITEMS = 16;
  const MAX_FILE_RESULTS = 60;
  const GLOBAL_FILE_MIN_QUERY = 1;
  const GLOBAL_INDEX_REFRESH_TTL_MS = 30000;
  const LEFT_CHROME_POLL_MS = 3000;

  const state = {
    overlay: null,
    palette: null,
    input: null,
    closeButton: null,
    list: null,
    scope: null,
    items: [],
    activeIndex: 0,
    query: '',
    seq: 0,
    mode: 'root',
    parentItem: null,
    globalIndexPromise: null,
    globalIndexFiles: null,
    globalIndexLoadedAt: 0,
    floatingChrome: null,
    leftChromeSyncRaf: 0,
    leftChromePollTimer: 0,
    restoreFocusEl: null,
    initialized: false,
  };

  const NEW_ITEM_TYPES = [
    { label: 'フォルダ', icon: 'folder', type: 'folder' },
    { label: 'ノート', icon: 'fileText', type: 'page' },
    { label: 'シート', icon: 'database', type: 'database' },
    { label: 'ボード', icon: 'presentation', type: 'board' },
    { label: 'カレンダー', icon: 'calendar', type: 'calendar' },
    { label: 'スマートシート', icon: 'databaseZap', type: 'smart-db' },
  ];

  const DEFAULT_PANEL_SECTIONS = [
    {
      title: '作業パネル',
      items: [
        { label: 'フォルダ', icon: 'folder', type: 'folder' },
        { label: 'ノート', icon: 'fileText', type: 'page' },
        { label: 'シナリオ', icon: 'bookOpenText', type: 'scriptnote' },
        { label: 'シート', icon: 'database', type: 'database' },
        { label: 'ボード', icon: 'presentation', type: 'board' },
        { label: 'スケジューラー', icon: 'calendar', type: 'calendar' },
        { label: 'スマートシート', icon: 'databaseZap', type: 'smart-db' },
      ],
    },
    {
      title: '補助パネル',
      items: [
        { label: 'フォルダツリー', icon: 'folderTree', type: 'outliner' },
        { label: 'ビューワー', icon: 'tvMinimal', type: 'preview' },
        { label: 'オプション', icon: 'slidersHorizontal', type: 'detail' },
        { label: 'バージョン管理', icon: 'gitBranch', type: 'version' },
        { label: 'チャット', icon: 'messagesSquare', type: 'chat' },
        { label: 'タイマー', icon: 'timer', type: 'timer' },
        { label: 'ヒストリー', icon: 'history', type: 'history' },
        { label: '注釈', icon: 'stickyNote', type: 'annotation' },
      ],
    },
  ];

  const FILE_TYPE_LABELS = {
    page: 'ノート',
    scriptnote: 'シナリオ',
    board: 'ボード',
    database: 'シート',
    'smart-db': 'スマートシート',
    calendar: 'カレンダー',
    csv: 'CSV',
    image: '画像',
    audio: '音声',
    video: '動画',
    media: 'メディア',
    html: 'HTML',
    pdf: 'PDF',
    folder: 'フォルダ',
    entity: 'エントリ',
    text: 'テキスト',
    data: 'データ',
    chat: 'チャット',
    archive: '圧縮ファイル',
    other: 'ファイル',
  };

  const FILE_NAV_TYPES = {
    page: 'page',
    scriptnote: 'scriptnote',
    board: 'board',
    database: 'database',
    'smart-db': 'smart-db',
    calendar: 'calendar',
    csv: 'csv',
    image: 'image',
    audio: 'audio',
    video: 'video',
    pdf: 'media',
    html: 'html',
    entity: 'entity',
    folder: 'folder',
  };

  const GLOBAL_INDEX_PAGE_CATEGORIES = new Set(['text', 'data', 'chat', 'archive', 'calendar', 'other']);

  function _icon(name, size = 16) {
    if (!name) return '';
    try {
      if (typeof lucide === 'function') return lucide(name, size);
    } catch {}
    return `<span class="ico ico-${String(name).replace(/[^a-zA-Z0-9_-]/g, '')}"></span>`;
  }

  function _normalize(value) {
    return String(value || '').normalize('NFKC').toLowerCase();
  }

  function _tokenize(query) {
    return _normalize(query).split(/\s+/).map(s => s.trim()).filter(Boolean);
  }

  function _command(id, group, label, subtitle, icon, action, options = {}) {
    const keywords = Array.isArray(options.keywords) ? options.keywords : [];
    return {
      id,
      group,
      label,
      subtitle: subtitle || '',
      icon: icon || 'circle',
      action,
      meta: options.meta || '',
      priority: options.priority || 0,
      keywords,
      subcommands: options.subcommands || null,
      fileKey: options.fileKey || '',
    };
  }

  function _notifyActionUnavailable(label) {
    if (typeof showStatus === 'function') showStatus(`${label}を開けませんでした`, true);
  }

  function _openSettings(panel) {
    if (typeof showSettingsModal !== 'function') {
      _notifyActionUnavailable('設定');
      return false;
    }
    return showSettingsModal(panel ? { panel } : undefined);
  }

  function _openTrash() {
    if (typeof openTrashFromFolderTree === 'function') return openTrashFromFolderTree();
    if (typeof showTrashModal === 'function') return showTrashModal();
    _notifyActionUnavailable('ゴミ箱');
    return false;
  }

  function _openHelp(event) {
    if (typeof showMeldexHelpMenu === 'function') return showMeldexHelpMenu(event);
    _notifyActionUnavailable('ヘルプ');
    return false;
  }

  function _scoreItem(item, tokens) {
    if (!tokens.length) return 1000 + (item.priority || 0);
    const hay = _normalize([item.label, item.subtitle, item.meta, ...(item.keywords || [])].join(' '));
    const label = _normalize(item.label);
    let score = 0;
    for (const token of tokens) {
      if (!hay.includes(token)) return -1;
      if (label === token) score += 120;
      else if (label.startsWith(token)) score += 90;
      else if (label.includes(token)) score += 65;
      else score += 30;
    }
    return score + (item.priority || 0);
  }

  function _filterItems(items, query) {
    const tokens = _tokenize(query);
    return items
      .map((item) => ({ item, score: _scoreItem(item, tokens) }))
      .filter(entry => entry.score >= 0)
      .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
      .map(entry => entry.item);
  }

  function _getPanelSections() {
    try {
      if (Array.isArray(PANEL_MENU_SECTIONS)) return PANEL_MENU_SECTIONS;
    } catch {}
    return DEFAULT_PANEL_SECTIONS;
  }

  function _openPanel(type, item) {
    if (item?.open && typeof item.open === 'function') {
      item.open();
      return;
    }
    if (typeof _openPanelMenuItem === 'function') {
      _openPanelMenuItem(type);
      return;
    }
    if (typeof addPanelMenuTool === 'function') addPanelMenuTool(type);
  }

  function _entryOpenPath(entry) {
    return String(entry?.openPath || entry?.absPath || entry?.abs_path || entry?.path || '');
  }

  function _entryRootKey(entry) {
    return String(entry?.root_type || entry?.rootType || entry?.root_name || entry?.rootName || '');
  }

  function _entryExtension(entry) {
    const raw = String(entry?.ext || _entryOpenPath(entry).split('/').pop() || '');
    const ext = raw.includes('.') ? raw.split('.').pop() : raw;
    return ext.toLowerCase();
  }

  function _mediaTypeForEntry(entry, type) {
    if (entry?.mediaType) return String(entry.mediaType);
    const category = String(entry?.category || '').toLowerCase();
    if (['image', 'audio', 'video', 'pdf'].includes(category)) return category;
    const entryType = String(entry?.type || '').toLowerCase();
    if (['image', 'audio', 'video', 'pdf'].includes(entryType)) return entryType;
    const ext = _entryExtension(entry);
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext)) return 'image';
    if (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'].includes(ext)) return 'audio';
    if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogv'].includes(ext)) return 'video';
    if (ext === 'pdf') return 'pdf';
    return type === 'media' ? 'image' : '';
  }

  function _navTypeForEntry(entry) {
    const category = String(entry?.category || '').toLowerCase();
    if (category) {
      if (GLOBAL_INDEX_PAGE_CATEGORIES.has(category)) return 'page';
      return FILE_NAV_TYPES[category] || category || 'page';
    }
    const raw = String(entry?.type || 'page');
    return FILE_NAV_TYPES[raw] || FILE_NAV_TYPES[raw.toLowerCase()] || raw || 'page';
  }

  function _displayTypeForEntry(entry, type, mediaType) {
    const category = String(entry?.category || '').toLowerCase();
    return mediaType || category || type;
  }

  function _commandFileKey(entry, type) {
    const openPath = _entryOpenPath(entry);
    return `${type || _navTypeForEntry(entry)}:${_entryRootKey(entry)}:${String(entry?.path || '')}:${openPath}`;
  }

  function invalidateCommandPaletteGlobalIndex() {
    state.globalIndexFiles = null;
    state.globalIndexLoadedAt = 0;
    state.globalIndexPromise = null;
  }

  function _openFile(entry) {
    const openPath = _entryOpenPath(entry);
    if (!openPath) return;
    const type = entry.type || _navTypeForEntry(entry);
    const label = entry.label || entry.name || openPath;
    const mediaType = _mediaTypeForEntry(entry, type);
    if (typeof navOpen === 'function') {
      navOpen({
        ...entry,
        type,
        label,
        path: openPath,
        mediaType,
      });
      return;
    }
    if (type === 'page' && typeof openPage === 'function') openPage(label, openPath);
  }

  function _readRecentItems() {
    try {
      const recent = JSON.parse(localStorage.getItem('meldex-recent') || '[]');
      return Array.isArray(recent) ? recent : [];
    } catch {
      return [];
    }
  }

  function _recentCommands() {
    return _readRecentItems()
      .filter(entry => entry && entry.path)
      .slice(0, MAX_RECENT_ITEMS)
      .map((entry, index) => {
        const type = _navTypeForEntry(entry);
        const mediaType = _mediaTypeForEntry(entry, type);
        const displayType = _displayTypeForEntry(entry, type, mediaType);
        const label = entry.label || entry.name || entry.path;
        const fileKey = _commandFileKey(entry, type);
        return _command(
          `recent:${fileKey}`,
          '最近使った項目',
          label,
          `${FILE_TYPE_LABELS[displayType] || FILE_TYPE_LABELS[type] || type} / ${entry.path}`,
          _iconForFileType(displayType),
          () => _openFile({ ...entry, type, label, mediaType }),
          {
            keywords: ['最近', 'recent', entry.path, entry.abs_path, entry.root_name, entry.root_type],
            priority: 30 - index,
            meta: '開く',
            fileKey,
          },
        );
      });
  }

  function _iconForFileType(type) {
    const map = {
      page: 'fileText',
      scriptnote: 'bookOpenText',
      board: 'presentation',
      database: 'database',
      'smart-db': 'databaseZap',
      calendar: 'calendar',
      csv: 'table',
      image: 'image',
      audio: 'music',
      video: 'video',
      media: 'file',
      html: 'code',
      pdf: 'fileText',
      folder: 'folder',
      entity: 'userRound',
      text: 'fileText',
      data: 'braces',
      chat: 'messagesSquare',
      archive: 'archive',
      other: 'file',
    };
    return map[type] || 'file';
  }

  async function _loadGlobalFiles(options = {}) {
    const now = Date.now();
    const stale = !state.globalIndexLoadedAt || (now - state.globalIndexLoadedAt) > GLOBAL_INDEX_REFRESH_TTL_MS;
    const refresh = !!options.refresh;
    if (state.globalIndexFiles && !refresh && !stale) return state.globalIndexFiles;
    if (!state.globalIndexPromise) {
      state.globalIndexPromise = (async () => {
        if (typeof apiFetch !== 'function') return [];
        const data = await apiFetch('/global-index' + (refresh ? '?refresh=1' : ''));
        const files = Array.isArray(data?.files) ? data.files : [];
        state.globalIndexFiles = files;
        state.globalIndexLoadedAt = Date.now();
        return files;
      })().catch((error) => {
        console.warn('[command-palette] global index load failed', error);
        return state.globalIndexFiles || [];
      }).finally(() => {
        state.globalIndexPromise = null;
      });
    }
    return state.globalIndexPromise;
  }

  function _globalFileCommands(files, query, existingKeys) {
    const tokens = _tokenize(query);
    if (!tokens.length) return [];
    const out = [];
    for (const file of files || []) {
      const type = _navTypeForEntry(file);
      if (!type || !file.path) continue;
      const openPath = _entryOpenPath(file);
      const mediaType = _mediaTypeForEntry(file, type);
      const displayType = _displayTypeForEntry(file, type, mediaType);
      const label = file.name || file.label || file.path;
      const key = _commandFileKey(file, type);
      if (existingKeys.has(key)) continue;
      const item = _command(
        `file:${key}`,
        'ファイル',
        label,
        `${FILE_TYPE_LABELS[displayType] || FILE_TYPE_LABELS[type] || type} / ${file.root_name || ''}${file.path ? ' / ' + file.path : ''}`,
        _iconForFileType(displayType),
        () => _openFile({ ...file, type, label, openPath, mediaType }),
        {
          keywords: [file.path, file.abs_path, file.root_name, file.root_type, file.ext, 'file', 'open'],
          meta: '開く',
          fileKey: key,
        },
      );
      const score = _scoreItem(item, tokens);
      if (score >= 0) out.push({ item, score });
    }
    out.sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label));
    return out.slice(0, MAX_FILE_RESULTS).map(entry => entry.item);
  }

  function _layoutEntries() {
    if (typeof GBAppLayouts !== 'undefined' && typeof GBAppLayouts.listAppLayouts === 'function') {
      return GBAppLayouts.listAppLayouts();
    }
    const layouts = typeof GBAppLayouts !== 'undefined' ? GBAppLayouts.APP_LAYOUTS || {} : {};
    return Object.entries(layouts).map(([id, record]) => ({
      id,
      label: record?.label || id,
      icon: record?.defaultIcon || 'layoutTemplate',
      builtin: true,
    }));
  }

  function _layoutSubcommands(layout) {
    return [];
  }

  function _layoutCommands() {
    return _layoutEntries().map((layout) => {
      const active = document.body?.dataset?.appLayoutActive === layout.id;
      return _command(
        `layout:${layout.id}`,
        'アプリレイアウト',
        layout.label || layout.id,
        active ? '現在のレイアウト' : 'レイアウトへ切り替え',
        layout.icon || 'layoutTemplate',
        () => _applyAppLayout(layout.id),
        {
          keywords: ['app layout', 'アプリレイアウト', layout.id, layout.toolType || ''],
          meta: active ? '選択中' : '切替',
          priority: active ? 85 : 70,
          subcommands: () => _layoutSubcommands(layout),
        },
      );
    });
  }

  function _commandCommands() {
    const items = [];
    NEW_ITEM_TYPES.forEach((entry) => {
      items.push(_command(
        `new:${entry.type}`,
        'コマンド',
        `${entry.label}を新規作成`,
        'フォルダツリーの選択位置に追加',
        entry.icon,
        () => { if (typeof showAddOutlinerItem === 'function') showAddOutlinerItem(entry.type); },
        { keywords: ['new', 'create', '追加', entry.type], priority: 65 },
      ));
    });
    items.push(
      _command('trash:open', 'コマンド', '削除済みファイルを開く', 'ゴミ箱', 'trash2', () => _openTrash(), { keywords: ['trash', 'ゴミ箱', '削除'], priority: 60 }),
      _command('settings:open', 'コマンド', '設定を開く', '', 'settings', () => _openSettings(), { keywords: ['preferences', 'config'], priority: 62 }),
      _command('user:settings', 'コマンド', 'ユーザー設定を開く', '', 'userRound', () => _openSettings('ユーザー'), { keywords: ['user', 'profile', 'アカウント'], priority: 58 }),
      _command('knowledge:settings', 'コマンド', 'LLMの記憶継承を開く', '', 'brain', () => {
        if (typeof openKnowledgeHomeView === 'function') openKnowledgeHomeView('items');
      }, { keywords: ['knowledge', '記憶', 'LLM'], priority: 57 }),
      _command('ideas:open', 'コマンド', 'アイディアインボックスを開く', '', 'lightbulb', () => {
        if (typeof openIdeaInboxView === 'function') openIdeaInboxView();
      }, { keywords: ['idea', 'アイディア'], priority: 56 }),
      _command('taste:open', 'コマンド', '感性原則を開く', '', 'sparkles', () => {
        if (typeof openKnowledgeHomeView === 'function') openKnowledgeHomeView('taste');
      }, { keywords: ['taste', '感性', '個人化'], priority: 56 }),
    );
    return items;
  }

  function _applyAppLayout(appId) {
    if (typeof window.applyAppLayout === 'function') return window.applyAppLayout(appId);
    return GBAppLayouts?.applyAppLayout?.(appId);
  }

  function _settingsCommands() {
    const panels = typeof getSettingsNavigationTabs === 'function'
      ? getSettingsNavigationTabs().map(tab => ({ name: tab.id, icon: tab.icon || 'settings', desc: tab.desc || '' }))
      : [
        { name: 'ユーザー・共同作業', icon: 'usersRound', desc: 'ユーザー名、ワークスペース、メンバー' },
        { name: '保存先・フォルダ', icon: 'folder', desc: 'ホームフォルダ、保存先、ソースフォルダ' },
        { name: '表示・起動', icon: 'monitorCog', desc: '表示サイズ、見やすさ、起動時の動作' },
        { name: 'テーマ', icon: 'palette', desc: 'テーマ、テーマカラー、フォント' },
        { name: 'ショートカット', icon: 'keyboard', desc: 'キーボード操作' },
        { name: 'AI・Discord', icon: 'bot', desc: 'AIキー、AI使用量、Discord連携' },
        { name: 'インポート', icon: 'download', desc: '外部取り込み、Notion同期、拡張機能' },
        { name: '導入・アプリ連携', icon: 'download', desc: 'サンプル、ホーム画面追加、ファイル関連付け' },
        { name: '履歴・引き継ぎ', icon: 'history', desc: 'Undo、バージョン保存、設定移行' },
        { name: 'ゴミ箱・データ保守', icon: 'database', desc: 'ゴミ箱、バックアップ、内部データ' },
        { name: 'フィードバック', icon: 'messageSquareText', desc: 'フィードバック、利用統計、診断' },
      ];
    return panels.map((panel) => {
      const name = panel.name;
      const icon = panel.icon || (name === 'ショートカット' ? 'keyboard' : name === 'テーマ' ? 'palette' : name === 'フィードバック' ? 'messageSquareText' : name === 'インポート' ? 'download' : 'settings');
      return _command(`settings:${name}`, '設定', `${name}設定を開く`, panel.desc || '', icon, () => _openSettings(name), { keywords: ['settings', '設定', name] });
    });
  }

  function _panelCommands() {
    const commands = [];
    _getPanelSections().forEach((section) => {
      (section.items || []).forEach((item) => {
        commands.push(_command(
          `panel:${item.type || item.label}`,
          'パネル',
          `${item.label}パネルを開く`,
          section.title || '',
          item.icon || 'panelRight',
          () => _openPanel(item.type, item),
          { keywords: ['panel', 'パネル', item.type || '', section.title || ''], priority: 45 },
        ));
      });
    });
    return commands;
  }

  function _baseCommands() {
    if (state.mode === 'sub' && state.parentItem) {
      return [
        _command('sub:back', '操作', '戻る', state.parentItem.label, 'arrowLeft', () => _leaveSubcommands(), { priority: 90 }),
        ..._filterItems(state.parentItem.subcommands?.() || [], state.query),
      ];
    }
    return [
      ..._layoutCommands(),
      ..._commandCommands(),
      ..._panelCommands(),
      ..._settingsCommands(),
      ..._recentCommands(),
    ];
  }

  function _groupItems(items) {
    const groups = [];
    const byGroup = new Map();
    for (const item of items) {
      const key = item.group || 'その他';
      if (!byGroup.has(key)) {
        byGroup.set(key, []);
        groups.push({ label: key, items: byGroup.get(key) });
      }
      byGroup.get(key).push(item);
    }
    return groups;
  }

  function _clearList() {
    if (!state.list) return;
    while (state.list.firstChild) state.list.firstChild.remove();
  }

  function _renderList() {
    if (!state.list) return;
    _clearList();
    const items = state.items;
    if (state.scope) {
      state.scope.textContent = state.mode === 'sub' && state.parentItem
        ? `${state.parentItem.label} / 操作`
        : 'コマンド';
    }
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'cmd-palette-empty';
      empty.textContent = '該当する項目がありません';
      if (state.input) state.input.removeAttribute('aria-activedescendant');
      state.list.appendChild(empty);
      return;
    }
    const groups = _groupItems(items);
    groups.forEach((group) => {
      const title = document.createElement('div');
      title.className = 'cmd-palette-group';
      title.textContent = group.label;
      state.list.appendChild(title);
      group.items.forEach((item) => state.list.appendChild(_renderItem(item, items.indexOf(item))));
    });
    _syncActiveItem();
  }

  function _renderItem(item, index) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cmd-palette-item';
    button.id = `cmd-palette-item-${index}`;
    button.dataset.commandId = item.id;
    button.dataset.commandIndex = String(index);
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', index === state.activeIndex ? 'true' : 'false');
    if (index === state.activeIndex) button.classList.add('is-active');

    const icon = document.createElement('span');
    icon.className = 'cmd-palette-item-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = _icon(item.icon, 18);

    const main = document.createElement('span');
    main.className = 'cmd-palette-item-main';
    const label = document.createElement('span');
    label.className = 'cmd-palette-item-label';
    label.textContent = item.label;
    main.appendChild(label);
    if (item.subtitle) {
      const subtitle = document.createElement('span');
      subtitle.className = 'cmd-palette-item-subtitle';
      subtitle.textContent = item.subtitle;
      main.appendChild(subtitle);
    }

    const meta = document.createElement('span');
    meta.className = 'cmd-palette-item-meta';
    meta.textContent = item.subcommands ? 'Tab' : (item.meta || '');

    button.append(icon, main, meta);
    button.addEventListener('mouseenter', () => {
      state.activeIndex = index;
      _syncActiveItem();
    });
    button.addEventListener('click', () => _executeItem(item));
    return button;
  }

  function _syncActiveItem() {
    if (!state.list) return;
    const buttons = state.list.querySelectorAll('.cmd-palette-item');
    buttons.forEach((button) => {
      const active = Number(button.dataset.commandIndex) === state.activeIndex;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      if (active) {
        button.scrollIntoView({ block: 'nearest' });
        if (state.input) state.input.setAttribute('aria-activedescendant', button.id);
      }
    });
    if (!buttons.length && state.input) state.input.removeAttribute('aria-activedescendant');
  }

  async function _refreshItems(options = {}) {
    const seq = ++state.seq;
    state.query = state.input?.value || '';
    let items = _filterItems(_baseCommands(), state.query);
    state.items = items;
    state.activeIndex = Math.min(state.activeIndex, Math.max(0, items.length - 1));
    _renderList();

    if (state.mode !== 'root' || _tokenize(state.query).length < GLOBAL_FILE_MIN_QUERY) return;
    const files = await _loadGlobalFiles({ refresh: !!options.refreshGlobalIndex });
    if (seq !== state.seq) return;
    const existingKeys = new Set(items.filter(item => item.fileKey).map(item => item.fileKey));
    const fileItems = _globalFileCommands(files, state.query, existingKeys);
    items = _filterItems([...items, ...fileItems], state.query);
    state.items = items;
    state.activeIndex = Math.min(state.activeIndex, Math.max(0, items.length - 1));
    _renderList();
  }

  function _moveActive(delta) {
    if (!state.items.length) return;
    const len = state.items.length;
    state.activeIndex = (state.activeIndex + delta + len) % len;
    _syncActiveItem();
  }

  function _enterSubcommands(item) {
    if (!item?.subcommands) return false;
    state.mode = 'sub';
    state.parentItem = item;
    state.activeIndex = 0;
    if (state.input) {
      state.input.value = '';
      state.query = '';
    }
    _refreshItems();
    return true;
  }

  function _leaveSubcommands() {
    state.mode = 'root';
    state.parentItem = null;
    state.activeIndex = 0;
    if (state.input) {
      state.input.value = '';
      state.query = '';
    }
    _refreshItems();
  }

  function _executeItem(item) {
    if (!item) return;
    if (item.id === 'sub:back') {
      _leaveSubcommands();
      return;
    }
    if (item.subcommands) {
      _enterSubcommands(item);
      return;
    }
    const action = item.action;
    closeCommandPalette();
    if (typeof action === 'function') {
      setTimeout(() => {
        try {
          const result = action();
          if (result && typeof result.catch === 'function') result.catch(error => console.error('[command-palette] action failed', error));
        } catch (error) {
          console.error('[command-palette] action failed', error);
        }
      }, 0);
    }
  }

  function _onInputKeydown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      _moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      _moveActive(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      _executeItem(state.items[state.activeIndex]);
    } else if (event.key === 'Tab' || event.key === 'ArrowRight') {
      const item = state.items[state.activeIndex];
      if (item?.subcommands) {
        event.preventDefault();
        _enterSubcommands(item);
      }
    } else if (event.key === 'ArrowLeft' && state.mode === 'sub') {
      event.preventDefault();
      _leaveSubcommands();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeCommandPalette();
    }
  }

  function _createOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'cmd-palette-overlay';
    overlay.className = 'cmd-palette-overlay';
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'コマンドパレット');

    const palette = document.createElement('div');
    palette.className = 'cmd-palette';

    const header = document.createElement('div');
    header.className = 'cmd-palette-header';
    const searchIcon = document.createElement('span');
    searchIcon.className = 'ico ico-search';
    searchIcon.setAttribute('aria-hidden', 'true');
    const input = document.createElement('input');
    input.id = 'cmd-palette-input';
    input.className = 'cmd-palette-input';
    input.type = 'search';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'コマンドやファイルを検索';
    input.setAttribute('aria-label', 'コマンドを検索');
    input.setAttribute('aria-controls', 'cmd-palette-list');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    const scope = document.createElement('span');
    scope.className = 'cmd-palette-scope';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'cmd-palette-close';
    closeButton.title = '閉じる';
    closeButton.setAttribute('aria-label', 'コマンドパレットを閉じる');
    closeButton.innerHTML = _icon('x', 16);
    header.append(searchIcon, input, scope, closeButton);

    const list = document.createElement('div');
    list.id = 'cmd-palette-list';
    list.className = 'cmd-palette-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'コマンド候補');

    const footer = document.createElement('div');
    footer.className = 'cmd-palette-footer';
    ['Enter 実行', 'Tab 操作', '↑↓ 選択', 'Esc 閉じる'].forEach((text) => {
      const span = document.createElement('span');
      span.textContent = text;
      footer.appendChild(span);
    });

    palette.append(header, list, footer);
    overlay.appendChild(palette);
    overlay.addEventListener('pointerdown', (event) => {
      if (event.target === overlay) closeCommandPalette();
    });
    input.addEventListener('input', () => {
      state.activeIndex = 0;
      _refreshItems();
    });
    input.addEventListener('keydown', _onInputKeydown);
    closeButton.addEventListener('click', () => closeCommandPalette());

    document.body.appendChild(overlay);
    state.overlay = overlay;
    state.palette = palette;
    state.input = input;
    state.closeButton = closeButton;
    state.list = list;
    state.scope = scope;
  }

  function _ensureOverlay() {
    if (!state.overlay || !state.overlay.isConnected) _createOverlay();
  }

  function _syncPaletteViewportClamp() {
    if (!state.palette || !state.overlay || state.overlay.hidden) return;
    const rect = state.palette.getBoundingClientRect();
    const top = Number.isFinite(rect.top) ? Math.max(0, rect.top) : 0;
    const zoom = Math.max(0.1, parseFloat(document.documentElement.style.zoom || '1') || 1);
    const availableHeight = Math.max(160, window.innerHeight - top - 12);
    const maxHeight = Math.floor(availableHeight / zoom);
    state.palette.style.maxHeight = `${maxHeight}px`;
  }

  function showCommandPalette(options = {}) {
    _ensureOverlay();
    if (options.refreshGlobalIndex !== false) invalidateCommandPaletteGlobalIndex();
    const focusTarget = options.restoreFocusEl || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    state.restoreFocusEl = focusTarget && !state.overlay.contains(focusTarget) ? focusTarget : null;
    state.mode = 'root';
    state.parentItem = null;
    state.activeIndex = 0;
    state.input.value = String(options.query || '');
    state.overlay.hidden = false;
    state.input.setAttribute('aria-expanded', 'true');
    document.body.classList.add('gb-command-palette-open');
    _syncPaletteViewportClamp();
    _refreshItems({ refreshGlobalIndex: !!options.refreshGlobalIndex });
    _syncPaletteViewportClamp();
    requestAnimationFrame(() => {
      _syncPaletteViewportClamp();
      state.input.focus();
      state.input.select();
    });
  }

  function closeCommandPalette(options = {}) {
    if (!state.overlay) return;
    state.overlay.hidden = true;
    if (state.input) state.input.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('gb-command-palette-open');
    const restoreEl = state.restoreFocusEl;
    state.restoreFocusEl = null;
    if (options.restoreFocus !== false && restoreEl?.isConnected) {
      try { restoreEl.focus({ preventScroll: true }); } catch {}
    }
  }

  function refreshCommandPalette(options = {}) {
    if (options.refreshGlobalIndex || options.globalIndex) invalidateCommandPaletteGlobalIndex();
    _syncLeftChromeUser();
    if (state.overlay && !state.overlay.hidden) {
      _refreshItems({ refreshGlobalIndex: !!(options.refreshGlobalIndex || options.globalIndex) });
      _syncPaletteViewportClamp();
    }
  }

  function _readUserName() {
    try {
      const user = JSON.parse(localStorage.getItem('meldex-user') || '{}') || {};
      return String(user.name || '').trim();
    } catch {
      return '';
    }
  }

  function _renderAvatar(target, name, avatar, bg) {
    if (!target) return;
    while (target.firstChild) target.firstChild.remove();
    target.style.background = bg || '#000000';
    if (avatar) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = avatar;
      target.appendChild(img);
      return;
    }
    target.textContent = (name || '?').charAt(0).toUpperCase() || '?';
  }

  function _syncLeftChromeUser() {
    const name = _readUserName() || 'ユーザー';
    const avatar = localStorage.getItem('meldex-avatar') || '';
    const bg = typeof window._getAvatarBgColor === 'function'
      ? window._getAvatarBgColor()
      : (localStorage.getItem('meldex-avatar-bg') || '#000000');
    const nameEl = document.getElementById('left-chrome-user-name');
    if (nameEl) nameEl.textContent = name;
    _renderAvatar(document.getElementById('left-chrome-user-avatar'), name, avatar, bg);
    _renderAvatar(document.getElementById('left-chrome-floating-avatar'), name, avatar, bg);
  }

  function _leftChromeFloatingEl() {
    if (state.floatingChrome) return state.floatingChrome;
    state.floatingChrome = document.getElementById('left-chrome-floating');
    return state.floatingChrome;
  }

  function _visibleLeftDockTarget() {
    const root = document.getElementById('gb-layout-root') || document;
    const candidates = Array.from(root.querySelectorAll('.gb-dock-bar, .gb-split-collapsed-horizontal'));
    const visible = candidates.map(el => {
      const rect = el.getBoundingClientRect?.();
      const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
      return { el, rect, style };
    }).filter(item => {
      const rect = item.rect;
      const style = item.style;
      return rect
        && rect.left <= 48
        && rect.width >= 24
        && rect.width <= 48
        && rect.height > 120
        && style
        && style.display !== 'none'
        && style.visibility !== 'hidden';
    });
    visible.sort((a, b) => (a.rect.left - b.rect.left) || (a.rect.top - b.rect.top));
    return visible[0]?.el || null;
  }

  function _elementIntersectsViewport(rect) {
    if (!rect) return false;
    const viewportWidth = Math.max(document.documentElement?.clientWidth || 0, window.innerWidth || 0);
    const viewportHeight = Math.max(document.documentElement?.clientHeight || 0, window.innerHeight || 0);
    return rect.right > 1
      && rect.bottom > 1
      && rect.left < viewportWidth - 1
      && rect.top < viewportHeight - 1;
  }

  function _syncLeftChromePlacement(sidebarVisible) {
    const floating = _leftChromeFloatingEl();
    if (!floating) return;
    const dockTarget = sidebarVisible ? null : _visibleLeftDockTarget();
    if (dockTarget) {
      if (floating.parentElement !== dockTarget) dockTarget.appendChild(floating);
      floating.classList.add('is-docked');
      return;
    }
    if (floating.parentElement !== document.body) document.body.appendChild(floating);
    floating.classList.remove('is-docked');
  }

  function _syncLeftChromeVisibility() {
    const sidebar = document.getElementById('sidebar');
    let visible = false;
    if (sidebar) {
      const style = window.getComputedStyle ? window.getComputedStyle(sidebar) : null;
      const rect = sidebar.getBoundingClientRect?.();
      visible = !!(style
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect
        && rect.width > 20
        && rect.height > 20
        && _elementIntersectsViewport(rect));
    }
    if (document.body) document.body.dataset.leftChromeSidebarVisible = visible ? '1' : '0';
    _syncLeftChromePlacement(visible);
  }

  function _queueLeftChromeSync() {
    if (state.leftChromeSyncRaf) return;
    const raf = window.requestAnimationFrame || (fn => setTimeout(fn, 16));
    state.leftChromeSyncRaf = raf(() => {
      state.leftChromeSyncRaf = 0;
      _syncLeftChromeVisibility();
    });
  }

  function _stopLeftChromePolling() {
    if (!state.leftChromePollTimer) return;
    clearInterval(state.leftChromePollTimer);
    state.leftChromePollTimer = 0;
  }

  function _startLeftChromePolling() {
    if (document.hidden === true) {
      _stopLeftChromePolling();
      return;
    }
    if (state.leftChromePollTimer) return;
    state.leftChromePollTimer = setInterval(_syncLeftChromeVisibility, LEFT_CHROME_POLL_MS);
  }

  function _syncLeftChromePollingForVisibility() {
    if (document.hidden === true) {
      _stopLeftChromePolling();
      return;
    }
    _syncLeftChromeVisibility();
    _startLeftChromePolling();
  }

  function _bindStaticTriggers() {
    ['left-chrome-command-trigger', 'left-chrome-floating-command'].forEach((id) => {
      const button = document.getElementById(id);
      if (!button || button.__gbCommandPaletteBound) return;
      button.__gbCommandPaletteBound = true;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        showCommandPalette({ restoreFocusEl: event.currentTarget });
      });
    });
  }

  function _bindLeftChromeButton(id, action) {
    const button = document.getElementById(id);
    if (!button || button.__gbLeftChromeActionBound) return;
    button.__gbLeftChromeActionBound = true;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      try {
        const result = action(event);
        if (result && typeof result.catch === 'function') {
          result.catch(error => console.error('[left-chrome] action failed', error));
        }
      } catch (error) {
        console.error('[left-chrome] action failed', error);
      }
    });
  }

  function _bindLeftChromeActionTriggers() {
    _bindLeftChromeButton('left-chrome-help', (event) => _openHelp(event));
    _bindLeftChromeButton('left-chrome-floating-help', (event) => _openHelp(event));
    _bindLeftChromeButton('left-chrome-trash', () => _openTrash());
    _bindLeftChromeButton('left-chrome-floating-trash', () => _openTrash());
    _bindLeftChromeButton('left-chrome-settings', () => _openSettings());
    _bindLeftChromeButton('left-chrome-floating-settings', () => _openSettings());
    _bindLeftChromeButton('left-chrome-user', () => _openSettings('ユーザー'));
    _bindLeftChromeButton('left-chrome-floating-user', () => _openSettings('ユーザー'));
    _syncLeftChromeUser();
  }

  function _init() {
    if (state.initialized || typeof document === 'undefined') return;
    state.initialized = true;
    _bindStaticTriggers();
    _bindLeftChromeActionTriggers();
    _leftChromeFloatingEl();
    _syncLeftChromeUser();
    _syncLeftChromeVisibility();
    window.addEventListener('resize', () => {
      _queueLeftChromeSync();
      _syncPaletteViewportClamp();
    });
    window.addEventListener('storage', (event) => {
      if (['meldex-user', 'meldex-avatar', 'meldex-avatar-bg'].includes(event.key)) _syncLeftChromeUser();
    });
    document.addEventListener('keydown', (event) => {
      if (!state.overlay || state.overlay.hidden || event.key !== 'Escape') return;
      event.preventDefault();
      closeCommandPalette();
    }, true);
    const sidebar = document.getElementById('sidebar');
    if (sidebar && typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(_queueLeftChromeSync);
      observer.observe(sidebar, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    const layoutRoot = document.getElementById('gb-layout-root');
    if (layoutRoot && typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(_queueLeftChromeSync);
      observer.observe(layoutRoot, { childList: true, subtree: true });
    }
    document.addEventListener('visibilitychange', _syncLeftChromePollingForVisibility);
    _startLeftChromePolling();
  }

  window.showCommandPalette = showCommandPalette;
  window.closeCommandPalette = closeCommandPalette;
  window.refreshCommandPalette = refreshCommandPalette;
  window.invalidateCommandPaletteGlobalIndex = invalidateCommandPaletteGlobalIndex;
  window.updateLeftChromeUser = _syncLeftChromeUser;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init, { once: true });
  } else {
    _init();
  }
})();
