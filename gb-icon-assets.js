/* gb-icon-assets.js - Lucide / Noto Emoji shared picker and renderer */
(function(global) {
  'use strict';

  const HEX_SEQ_RE = /^[0-9a-f]{1,6}(?:[-_][0-9a-f]{1,6})*$/i;

  function _esc(value) {
    return MeldexEscape.html(value);
  }

  function _escAttr(value) {
    return MeldexEscape.attr(value);
  }

  function _normalizeCode(code) {
    const parts = String(code || '').trim().replace(/_/g, '-').split('-');
    const out = [];
    for (const part of parts) {
      if (!part) return '';
      const cp = parseInt(part, 16);
      if (!Number.isFinite(cp) || cp < 0 || cp > 0x10FFFF || _isPrivateUseCodePoint(cp)) return '';
      out.push(cp.toString(16).toUpperCase());
    }
    return out.join('-');
  }

  function _isPrivateUseCodePoint(cp) {
    return (cp >= 0xE000 && cp <= 0xF8FF)
      || (cp >= 0xF0000 && cp <= 0xFFFFD)
      || (cp >= 0x100000 && cp <= 0x10FFFD);
  }

  function codeToEmoji(code) {
    try {
      return _normalizeCode(code).split('-').map((part) => String.fromCodePoint(parseInt(part, 16))).join('');
    } catch {
      return '';
    }
  }

  function _toKebab(name) {
    return String(name || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/_/g, '-')
      .toLowerCase();
  }

  function _normalizeSearch(value) {
    return String(value || '').normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g,
      ch => String.fromCharCode(ch.charCodeAt(0) - 0x60)).replace(/[-_\s:]/g, '');
  }

  // 同梱の日本語絵文字辞書を、Lucideの英語名・タグにも接続する。
  let _japaneseIndex = null;
  let _japaneseIndexSource = null;
  const JAPANESE_ICON_WORDS = {
    accessibility: 'アクセシビリティ 支援', activity: '活動 心拍 波形', align: '整列 揃える',
    arrow: '矢印 やじるし', asterisk: '星印 アスタリスク', audio: '音声 音楽', axis: '軸 座標',
    badge: 'バッジ 印章', between: '間 間隔', blend: '混合 重ねる', blocks: 'ブロック',
    book: '本 読書', bookmark: 'ブックマーク しおり', bot: 'ボット ロボット', box: '箱',
    braces: '波括弧', brackets: '角括弧', bring: '前面', case: '文字 大文字 小文字',
    chart: 'グラフ 図表', chevron: '山形 矢印', circle: '円 丸', clipboard: 'クリップボード 貼り付け',
    columns: '列 段組', combine: '結合', command: 'コマンド 命令', component: '部品 コンポーネント',
    concatenate: '連結', container: 'コンテナ 容器', contrast: 'コントラスト 明暗', copy: 'コピー 複製',
    corner: '角 曲がる', crop: '切り抜き トリミング', crosshair: '照準 目標', database: 'データベース 保存',
    delete: '削除 消す', diff: '差分 比較', dimensions: '寸法 大きさ', distribute: '均等 配置',
    dock: 'ドック 固定', ellipsis: '省略 三点', equal: '等しい 同じ', expand: '拡大 展開',
    external: '外部', file: 'ファイル 書類', filter: 'フィルター 絞り込み', flip: '反転',
    fold: '折り畳み', folder: 'フォルダ', format: '書式', frame: '枠 フレーム', fullscreen: '全画面',
    gantt: 'ガント 工程', git: 'ギット 変更履歴 分岐', grip: 'ハンドル つかむ 移動', group: 'グループ',
    heading: '見出し', indent: 'インデント 字下げ', info: '情報 案内', inspection: '点検 検査',
    italic: '斜体', iteration: '反復 繰り返し', kanban: 'カンバン 看板', layers: 'レイヤー 階層',
    layout: 'レイアウト 配置', ligature: '合字', list: 'リスト 一覧 箇条書き', loader: '読込 待機',
    locate: '位置 現在地', maximize: '最大化', merge: '統合 結合', minimize: '最小化',
    minus: 'マイナス 引く 減らす', monitor: 'モニター 画面', mouse: 'マウス', move: '移動 動かす',
    navigation: 'ナビゲーション 方角', network: 'ネットワーク 接続', option: 'オプション 選択',
    outdent: '字下げ解除', package: '荷物 パッケージ', panel: 'パネル', panels: 'パネル',
    parentheses: '丸括弧', pilcrow: '段落記号', pivot: 'ピボット 集計', plus: 'プラス 追加 足す',
    pointer: 'ポインター カーソル', ratio: '比率', redo: 'やり直す', regex: '正規表現',
    replace: '置換 入れ替え', rotate: '回転', rows: '行 段組', scan: 'スキャン 読取',
    scaling: '拡大縮小', search: '検索 探す', send: '送信 送る', separator: '区切り線',
    settings: '設定 歯車', shapes: '図形', shrink: '縮小', sliders: 'スライダー 調整',
    space: '空白 間隔', spell: '綴り スペル 校正', split: '分割 分岐', square: '四角 正方形',
    stretch: '伸ばす', strikethrough: '取り消し線', subscript: '下付き文字', superscript: '上付き文字',
    table: 'テーブル 表', text: 'テキスト 文字', toggle: '切替 スイッチ', tooltip: 'ツールチップ ヒント',
    type: '文字 書体', underline: '下線', undo: '元に戻す', ungroup: 'グループ解除',
    unlink: 'リンク解除', unfold: '展開', upload: 'アップロード 登録', variable: '変数',
    view: '表示 ビュー', waypoints: '経由地', wrap: '折り返し', zoom: 'ズーム 拡大縮小',
    bluetooth: 'ブルートゥース 無線', building: '建物 ビル', calendar: 'カレンダー 日付 予定',
    cast: 'キャスト 配信', clock: '時計 時間', code: 'コード プログラム', copyleft: 'コピーレフト 著作権',
    dice: 'サイコロ', disc: 'ディスク 円盤', flower: '花', gamepad: 'ゲーム コントローラー',
    grid: 'グリッド 格子', languages: '言語 翻訳', lasso: '投げ縄 選択', link: 'リンク 接続',
    microwave: '電子レンジ', music: '音楽 音符', plug: 'プラグ 電源', repeat: '繰り返し リピート',
    scale: '尺度 拡大縮小', share: '共有 シェア', tablet: 'タブレット 端末', tally: '集計 数える',
    touchpad: 'タッチパッド', trash: 'ごみ箱 削除', volume: '音量 ボリューム', wallet: '財布',
    db: 'シート データベース', scenario: 'シナリオ', sync: '同期 更新',
  };

  function _japaneseKeywords(name, tags) {
    if (!_japaneseIndex || _japaneseIndexSource !== global.EMOJI_ANNOTATIONS) {
      _japaneseIndexSource = global.EMOJI_ANNOTATIONS;
      const counts = new Map();
      for (const entry of Object.values(global.EMOJI_ANNOTATIONS || {})) {
        for (const en of entry.e || []) {
          if (!counts.has(en)) counts.set(en, new Map());
          const words = counts.get(en);
          for (const ja of entry.j || []) words.set(ja, (words.get(ja) || 0) + 1);
        }
      }
      _japaneseIndex = new Map([...counts].map(([en, words]) => [en,
        [...words].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([ja]) => ja).join(' ')]));
    }
    const kebab = _toKebab(name);
    const tokens = [kebab, ...kebab.replace(/\d+(?:d)?/g, '-').split('-'), ...(tags || '').split(' ')];
    return [...new Set(tokens.flatMap(token => [JAPANESE_ICON_WORDS[token], _japaneseIndex.get(token)]).filter(Boolean))].join(' ');
  }

  function _itemTooltip(item) {
    return (item.label || item.spec) + '\n検索ワード: ' + (item.search || item.keywords || item.label || item.spec);
  }

  function _lucidePaths(name) {
    if (!name) return '';
    if (typeof global.LUCIDE !== 'undefined' && global.LUCIDE && global.LUCIDE[name] != null) {
      return global.LUCIDE[name];
    }
    if (global.LUCIDE_FULL && global.LUCIDE_FULL[name] != null) return global.LUCIDE_FULL[name];
    const kebab = _toKebab(name);
    if (global.LUCIDE_FULL && global.LUCIDE_FULL[kebab] != null) return global.LUCIDE_FULL[kebab];
    return '';
  }

  function hasLucideName(name) {
    return !!_lucidePaths(name);
  }

  function _emojiAnnotationKeywords(emoji) {
    const src = global.EMOJI_ANNOTATIONS;
    if (!src || !emoji) return '';
    const entry = src[emoji];
    if (!entry) return '';
    const parts = [];
    if (Array.isArray(entry.j)) parts.push(...entry.j);
    if (Array.isArray(entry.e)) parts.push(...entry.e);
    return parts.join(' ');
  }

  function _notoEntries() {
    const src = Array.isArray(global.NOTO_EMOJI) ? global.NOTO_EMOJI : [];
    return src.map((entry) => {
      const code = _normalizeCode(entry.code);
      const emoji = entry.emoji || codeToEmoji(code);
      const annotations = _emojiAnnotationKeywords(emoji);
      const fallbackLabel = /^[0-9]$/.test(emoji) ? '数字 ' + emoji
        : /^1F1[EF][0-9A-F]$/.test(code) ? '地域記号 ' + String.fromCodePoint(parseInt(code, 16) - 0x1F1E6 + 65)
        : code === '20E3' ? 'キーキャップ結合記号' : code;
      return {
        type: 'noto',
        spec: 'noto:' + code,
        code,
        emoji,
        label: entry.name || global.EMOJI_ANNOTATIONS?.[emoji]?.j?.slice(-1)[0] || fallbackLabel,
        search: [entry.emoji || '', code, entry.name || '', annotations,
          /^[0-9]$/.test(emoji) ? '数字 番号 ' + emoji : '',
          /^1F1[EF][0-9A-F]$/.test(code) ? '地域記号 アルファベット ' + emoji : '',
          code === '20E3' ? 'キーキャップ 囲み数字' : ''].join(' '),
      };
    }).filter((entry) => entry.code);
  }

  let _notoMap = null;
  function _findNoto(code) {
    const normalized = _normalizeCode(code);
    if (!_notoMap) {
      _notoMap = new Map(_notoEntries().map((entry) => [entry.code, entry]));
    }
    return _notoMap.get(normalized) || {
      type: 'noto',
      spec: 'noto:' + normalized,
      code: normalized,
      emoji: codeToEmoji(normalized),
      label: normalized,
      search: normalized,
    };
  }

  function normalizeSpec(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const lower = raw.toLowerCase();
    if (lower.startsWith('image:')) {
      try {
        const path = decodeURIComponent(raw.slice(6)).replace(/\\/g, '/');
        if (!path || path.length > 2048 || /[:\x00-\x1f]/.test(path)
          || path.startsWith('/') || path.split('/').includes('..')) return '';
        return 'image:' + encodeURIComponent(path);
      } catch (_) { return ''; }
    }
    if (lower.startsWith('lucide:')) {
      const name = raw.slice(raw.indexOf(':') + 1).trim();
      return name ? 'lucide:' + name : '';
    }
    if (lower.startsWith('noto:') || lower.startsWith('emoji:') || lower.startsWith('twemoji:')) {
      const code = _normalizeCode(raw.slice(raw.indexOf(':') + 1));
      return code ? 'noto:' + code : '';
    }
    if (HEX_SEQ_RE.test(raw)) {
      const code = _normalizeCode(raw);
      return code ? 'noto:' + code : '';
    }
    if (hasLucideName(raw)) return 'lucide:' + raw;
    return raw;
  }

  function parseSpec(value) {
    const spec = normalizeSpec(value);
    if (!spec) return { type: '', spec: '', label: '' };
    if (spec.startsWith('image:')) return { type: 'image', spec, path: decodeURIComponent(spec.slice(6)), label: '画像' };
    if (spec.toLowerCase().startsWith('lucide:')) {
      const name = spec.slice(7);
      return { type: 'lucide', spec: 'lucide:' + name, name, label: _toKebab(name), search: name + ' ' + _toKebab(name) };
    }
    if (spec.toLowerCase().startsWith('noto:')) return _findNoto(spec.slice(5));
    if (hasLucideName(spec)) return parseSpec('lucide:' + spec);
    return { type: 'text', spec, label: spec, search: spec };
  }

  function sameSpec(a, b) {
    const left = normalizeSpec(a), right = normalizeSpec(b);
    if (left.startsWith('image:') || right.startsWith('image:')) return left === right;
    return left.toLowerCase() === right.toLowerCase();
  }

  function render(spec, size, options = {}) {
    const parsed = parseSpec(spec);
    const px = Math.max(10, Number(size) || 20);
    const className = options.className ? ' ' + options.className : '';
    if (parsed.type === 'image') {
      const src = '/api/media/file?path=' + encodeURIComponent(parsed.path);
      return `<img class="gb-icon-render gb-icon-image${_escAttr(className)}" src="${_escAttr(src)}" alt="" width="${px}" height="${px}" loading="lazy" decoding="async" style="object-fit:cover;border-radius:4px;">`;
    }
    if (parsed.type === 'lucide') {
      if (typeof global.lucide === 'function' && hasLucideName(parsed.name)) {
        return global.lucide(parsed.name, px);
      }
    }
    if (parsed.type === 'noto') {
      const label = parsed.label || parsed.code;
      // 外側要素 (button 等) が title を持つケースが多く、span の title を重ねると
      // gb-tooltip のサプレッション対象外の親 title でネイティブツールチップが二重表示されるため、
      // aria-label のみに留める。
      return `<span class="gb-icon-render gb-noto-emoji${className}" data-icon="${_escAttr(parsed.spec)}" role="img" aria-label="${_escAttr(label)}" style="--gb-icon-size:${px}px;">${_esc(parsed.emoji || codeToEmoji(parsed.code) || '?')}</span>`;
    }
    return `<span class="gb-icon-render gb-icon-text${className}" style="--gb-icon-size:${px}px;">${_esc(parsed.label || '?')}</span>`;
  }

  function renderInto(element, spec, size, options = {}) {
    if (!element) return;
    element.innerHTML = render(spec, size, options);
    element.dataset.iconSpec = normalizeSpec(spec);
  }

  function _lucideTagKeywords(name) {
    const src = global.LUCIDE_TAGS;
    if (!src) return '';
    const kebab = _toKebab(name);
    const tags = src[name] || src[kebab] || null;
    if (!Array.isArray(tags) || !tags.length) return '';
    return tags.join(' ');
  }

  function listLucideIcons() {
    const names = new Set();
    const add = (name) => {
      if (!name || String(name).includes('-')) return;
      if (_lucidePaths(name)) names.add(name);
    };
    if (typeof global.LUCIDE !== 'undefined' && global.LUCIDE) Object.keys(global.LUCIDE).forEach(add);
    if (global.LUCIDE_FULL) Object.keys(global.LUCIDE_FULL).forEach(add);
    return [...names].sort((a, b) => _toKebab(a).localeCompare(_toKebab(b))).map((name) => {
      const kebab = _toKebab(name);
      const tags = _lucideTagKeywords(name);
      return {
        type: 'lucide',
        spec: 'lucide:' + name,
        name,
        label: kebab,
        search: [name, kebab, tags, _japaneseKeywords(name, tags)].filter(Boolean).join(' '),
      };
    });
  }

  function listNotoEmoji() {
    return _notoEntries();
  }

  function _makePresetItems(presets) {
    return (presets || []).map((preset) => {
      const spec = normalizeSpec(preset.spec || preset.icon || preset.code);
      return {
        ...preset,
        type: parseSpec(spec).type,
        spec,
        label: preset.label || parseSpec(spec).label || spec,
        search: [preset.label || '', preset.keywords || '', parseSpec(spec).search || '', spec].join(' '),
        preset: true,
      };
    }).filter((item) => item.spec);
  }

  function _makeAllItems(options) {
    const includeLucide = options.includeLucide !== false;
    const includeNoto = options.includeNoto !== false;
    const items = [];
    if (includeLucide) items.push(...listLucideIcons());
    if (includeNoto) items.push(...listNotoEmoji());
    const seen = new Set();
    for (const item of options.imageItems || []) {
      const spec = normalizeSpec(item.spec);
      if (!spec.startsWith('image:') || seen.has(spec)) continue;
      seen.add(spec);
      items.push({ ...item, type: 'image', spec, search: [item.label, item.keywords, '画像 写真 カスタム'].join(' ') });
    }
    return items;
  }

  function _normalizeSourceDefs(options, includeLucide, includeNoto) {
    const custom = Array.isArray(options.sources) ? options.sources : [];
    if (custom.length) {
      return custom.map((source) => {
        const id = String(source.id || source.source || source.type || '').trim();
        if (!id) return null;
        return {
          ...source,
          id,
          label: String(source.label || source.title || id).trim(),
          type: source.type || '',
          filter: typeof source.filter === 'function'
            ? source.filter
            : (typeof source.match === 'function' ? source.match : null),
        };
      }).filter(Boolean);
    }

    const defs = [];
    if (includeLucide && includeNoto && options.hideAllTab !== true && options.showAllTab !== false) {
      defs.push({ id: 'all', label: 'すべて' });
    }
    if (includeLucide) defs.push({ id: 'lucide', label: 'Lucide', type: 'lucide' });
    if (includeNoto) defs.push({ id: 'noto', label: 'Noto Emoji', type: 'noto' });
    if (options.onUploadImage) defs.push({ id: 'image', label: '登録画像', type: 'image' });
    return defs;
  }

  function _sourceDefMatches(def, item) {
    if (!def || def.id === 'all') return true;
    if (def.filter) {
      try { return !!def.filter(item); } catch { return false; }
    }
    if (def.type) return item.type === def.type;
    return item.type === def.id;
  }

  function openPicker(options = {}) {
    const includeLucide = options.includeLucide !== false;
    const includeNoto = options.includeNoto !== false;
    let allItems = null;
    const presets = _makePresetItems(options.presets);
    const current = normalizeSpec(options.current || '');
    const sourceDefs = _normalizeSourceDefs(options, includeLucide, includeNoto);
    const defaultSource = includeLucide && includeNoto ? 'all' : includeNoto ? 'noto' : 'lucide';
    let activeSource = options.defaultSource || defaultSource;
    if (!sourceDefs.some((source) => source.id === activeSource)) {
      activeSource = sourceDefs[0]?.id || defaultSource;
    }
    const pageSize = Math.max(24, Math.min(1000, Number(options.pageSize || options.initialPageSize) || 240));
    let visibleLimit = pageSize;
    let renderToken = 0;
    document.querySelectorAll('.gb-icon-picker').forEach((picker) => {
      if (typeof picker._requestClose === 'function') picker._requestClose();
      else picker.remove();
    });
    const restoreTarget = options.restoreFocusEl || options.anchorEl || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const restoreFocus = () => {
      if (!restoreTarget || typeof restoreTarget.focus !== 'function' || !restoreTarget.isConnected) return;
      try { restoreTarget.focus({ preventScroll: true }); } catch { restoreTarget.focus(); }
    };

    const picker = document.createElement('div');
    const pickerId = 'gb-icon-picker-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    picker.className = 'gb-icon-picker gb-context-menu' + (options.className ? ' ' + options.className : '');
    picker.dataset.e2eId = 'icon-picker-popup';
    picker.setAttribute('role', 'dialog');
    picker.setAttribute('aria-modal', 'false');
    picker.style.position = 'fixed';
    picker.style.zIndex = String(options.zIndex || 10004);
    // タブや「さらに表示」はクリック中に自身を再描画する。切断された
    // event.targetを共通dismissが外側クリックと判定しないよう境界で止める。
    picker.addEventListener('click', (event) => event.stopPropagation());
    let closeHandler = null;
    let keydownHandler = null;
    const removePicker = () => {
      renderToken++;
      picker.remove();
      if (closeHandler) document.removeEventListener('pointerdown', closeHandler, true);
      if (keydownHandler) document.removeEventListener('keydown', keydownHandler, true);
      closeHandler = null;
      keydownHandler = null;
      setTimeout(restoreFocus, 0);
    };
    picker._requestClose = removePicker;

    const header = document.createElement('div');
    header.className = 'gb-icon-picker-header';
    const title = document.createElement('div');
    title.id = pickerId + '-title';
    title.className = 'gb-icon-picker-title';
    title.textContent = options.title || 'アイコン';
    picker.setAttribute('aria-labelledby', title.id);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'gb-icon-picker-close';
    closeBtn.dataset.e2eId = 'icon-picker-close';
    closeBtn.title = '閉じる';
    closeBtn.setAttribute('aria-label', 'アイコンピッカーを閉じる');
    closeBtn.innerHTML = typeof global.lucide === 'function' ? global.lucide('x', 14) : 'x';
    closeBtn.addEventListener('click', removePicker);
    header.append(title, closeBtn);
    picker.appendChild(header);

    const selectItem = (item) => {
      if (!item || !item.spec) return;
      if (typeof options.onSelect === 'function') options.onSelect(item.spec, item);
      removePicker();
    };

    if (presets.length) {
      const presetWrap = document.createElement('div');
      presetWrap.className = 'gb-icon-picker-presets';
      if (options.presetsIconOnly) presetWrap.classList.add('gb-icon-picker-presets-icons');
      presets.forEach((item) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gb-icon-picker-preset';
        btn.dataset.e2eId = 'icon-picker-preset';
        btn.title = _itemTooltip(item);
        btn.setAttribute('aria-label', item.label + 'を選択');
        btn.setAttribute('aria-pressed', sameSpec(item.spec, current) ? 'true' : 'false');
        if (sameSpec(item.spec, current)) btn.classList.add('is-selected');
        const previewColor = item.color ? ` style="color:${_escAttr(item.color)};"` : '';
        btn.innerHTML = `<span class="gb-icon-picker-preset-icon"${previewColor}>${render(item.spec, 18)}</span>`
          + (options.presetsIconOnly ? '' : `<span>${_esc(item.label)}</span>`);
        btn.querySelectorAll('[aria-label]').forEach(icon => { icon.removeAttribute('aria-label'); icon.setAttribute('aria-hidden', 'true'); });
        btn.addEventListener('click', () => selectItem(item));
        presetWrap.appendChild(btn);
      });
      picker.appendChild(presetWrap);
    }

    if (sourceDefs.length > 1) {
      const tabs = document.createElement('div');
      tabs.className = 'gb-icon-picker-tabs';
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', 'アイコンの種類');
      sourceDefs.forEach((sourceDef) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'gb-icon-picker-tab';
        tab.textContent = sourceDef.label;
        tab.dataset.source = sourceDef.id;
        tab.dataset.e2eId = 'icon-picker-tab-' + sourceDef.id;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', sourceDef.id === activeSource ? 'true' : 'false');
        if (sourceDef.description) tab.title = sourceDef.description;
        if (sourceDef.id === activeSource) tab.classList.add('active');
        tab.addEventListener('click', () => {
          activeSource = sourceDef.id;
          visibleLimit = pageSize;
          tabs.querySelectorAll('.gb-icon-picker-tab').forEach((el) => el.classList.toggle('active', el === tab));
          tabs.querySelectorAll('.gb-icon-picker-tab').forEach((el) => el.setAttribute('aria-selected', el === tab ? 'true' : 'false'));
          renderGrid();
        });
        tabs.appendChild(tab);
      });
      picker.appendChild(tabs);
    }

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'gb-input gb-icon-picker-search';
    search.dataset.e2eId = 'icon-picker-search';
    search.placeholder = options.placeholder || '検索';
    search.setAttribute('aria-label', options.searchLabel || 'アイコンを検索');
    picker.appendChild(search);

    if (typeof options.onUploadImage === 'function') {
      const form = document.createElement('div'); form.className = 'gb-icon-image-register';
      const label = document.createElement('input'); label.className = 'gb-input'; label.placeholder = '画像の名前（省略時はファイル名）';
      label.setAttribute('aria-label', '画像の名前');
      const keywords = document.createElement('input'); keywords.className = 'gb-input'; keywords.placeholder = '検索ワード（例: 猫 ねこ キャラクター）';
      keywords.setAttribute('aria-label', '画像の検索ワード');
      const upload = document.createElement('button'); upload.type = 'button'; upload.className = 'gb-btn gb-btn-xs';
      upload.textContent = '画像を登録'; upload.dataset.e2eId = 'icon-picker-image-upload';
      const fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.hidden = true;
      fileInput.accept = 'image/png,image/jpeg,image/gif,image/webp';
      const status = document.createElement('div'); status.setAttribute('role', 'status');
      upload.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0]; if (!file) return;
        upload.disabled = true; status.textContent = '登録中…';
        try {
          const item = await options.onUploadImage(file, { label: label.value.trim(), keywords: keywords.value.trim() });
          if (picker.isConnected) selectItem(item);
        } catch (error) { if (picker.isConnected) status.textContent = error.message || '画像の登録に失敗しました'; }
        finally { upload.disabled = false; fileInput.value = ''; }
      });
      form.append(label, keywords, upload, fileInput, status); picker.appendChild(form);
    }

    const grid = document.createElement('div');
    grid.className = 'gb-icon-picker-grid';
    grid.dataset.e2eId = 'icon-picker-grid';
    grid.setAttribute('role', 'list');
    grid.setAttribute('aria-label', 'アイコン一覧');
    const loading = document.createElement('div');
    loading.className = 'gb-icon-picker-empty';
    loading.textContent = options.loadingLabel || '読み込み中';
    grid.appendChild(loading);
    picker.appendChild(grid);

    if (typeof options.extraFooter === 'function') {
      const extra = options.extraFooter(picker);
      if (extra) picker.appendChild(extra);
    }

    const footer = document.createElement('div');
    footer.className = 'gb-icon-picker-footer';
    const credit = document.createElement('div');
    credit.className = 'gb-icon-picker-credit';
    credit.textContent = includeLucide && includeNoto
      ? 'Lucide (ISC) / Noto Emoji (OFL 1.1)'
      : includeNoto ? 'Noto Emoji (OFL 1.1)' : 'Lucide (ISC)';
    const actions = document.createElement('div');
    actions.className = 'gb-icon-picker-actions';
    if (options.allowReset) {
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'gb-btn gb-btn-xs gb-btn-quiet';
      reset.dataset.e2eId = 'icon-picker-reset';
      reset.textContent = options.resetLabel || 'リセット';
      reset.setAttribute('aria-label', reset.textContent);
      reset.addEventListener('click', () => {
        if (typeof options.onReset === 'function') options.onReset();
        removePicker();
      });
      actions.appendChild(reset);
    }
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'gb-btn gb-btn-xs gb-btn-quiet';
    cancel.dataset.e2eId = 'icon-picker-cancel';
    cancel.textContent = 'キャンセル';
    cancel.setAttribute('aria-label', 'アイコン選択をキャンセル');
    cancel.addEventListener('click', removePicker);
    actions.appendChild(cancel);
    footer.append(credit, actions);
    picker.appendChild(footer);

    function getAllItems() {
      if (!allItems) allItems = _makeAllItems(options);
      return allItems;
    }

    function sourceMatches(item) {
      const sourceDef = sourceDefs.find((source) => source.id === activeSource);
      return _sourceDefMatches(sourceDef, item);
    }

    function renderGrid() {
      if (!picker.isConnected) return;
      const qRaw = search.value.trim();
      const q = _normalizeSearch(qRaw);
      const exactEmoji = qRaw && qRaw.length <= 8 ? qRaw : '';
      const filtered = getAllItems().filter((item) => {
        if (!sourceMatches(item)) return false;
        if (!q) return true;
        if (exactEmoji && item.emoji === exactEmoji) return true;
        return _normalizeSearch(item.search || item.label || item.spec).includes(q);
      });
      grid.textContent = '';
      const fragment = document.createDocumentFragment();
      filtered.slice(0, visibleLimit).forEach((item) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gb-icon-picker-cell';
        btn.dataset.e2eId = 'icon-picker-cell';
        btn.title = _itemTooltip(item);
        btn.setAttribute('aria-label', (item.label || item.spec) + 'を選択');
        btn.setAttribute('aria-pressed', sameSpec(item.spec, current) ? 'true' : 'false');
        if (sameSpec(item.spec, current)) btn.classList.add('is-selected');
        btn.innerHTML = render(item.spec, options.itemSize || 22);
        btn.querySelectorAll('[aria-label]').forEach(icon => { icon.removeAttribute('aria-label'); icon.setAttribute('aria-hidden', 'true'); });
        btn.addEventListener('click', () => selectItem(item));
        fragment.appendChild(btn);
      });
      if (!filtered.length) {
        const empty = document.createElement('div');
        empty.className = 'gb-icon-picker-empty';
        empty.textContent = '該当するアイコンがありません';
        fragment.appendChild(empty);
      }
      if (filtered.length > visibleLimit) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'gb-icon-picker-more';
        more.dataset.e2eId = 'icon-picker-more';
        more.textContent = 'さらに表示（残り' + (filtered.length - visibleLimit) + '件）';
        more.setAttribute('aria-label', more.textContent);
        more.addEventListener('click', () => {
          visibleLimit += pageSize;
          renderGrid();
        });
        fragment.appendChild(more);
      }
      grid.appendChild(fragment);
    }

    function resetAndRenderGrid() {
      visibleLimit = pageSize;
      renderGrid();
    }

    function scheduleInitialRender() {
      const token = ++renderToken;
      const run = () => {
        if (token !== renderToken || !picker.isConnected) return;
        renderGrid();
      };
      if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(run);
      else window.setTimeout(run, 0);
    }

    search.addEventListener('input', resetAndRenderGrid);
    document.body.appendChild(picker);
    const anchorRect = options.anchorEl?.getBoundingClientRect?.() || {
      left: window.innerWidth / 2 - 180,
      right: window.innerWidth / 2 + 180,
      top: 80,
      bottom: 80,
    };
    if (typeof global.positionPopup === 'function') global.positionPopup(picker, anchorRect, { prefer: options.prefer || 'below' });
    else if (typeof global.clampPopupToViewport === 'function') global.clampPopupToViewport(picker);
    search.focus();
    scheduleInitialRender();
    if (global.MeldexCloudAssets) {
      global.MeldexCloudAssets.load('icons').then(() => {
        allItems = null;
        renderGrid();
      }).catch(error => {
        if (picker.isConnected) {
          grid.textContent = error.message;
          const retry = document.createElement('button');
          retry.textContent = '再試行';
          retry.onclick = () => { removePicker(); openPicker(options); };
          grid.appendChild(retry);
        }
      });
    }

    closeHandler = (ev) => {
      if (!picker.contains(ev.target) && ev.target !== options.anchorEl) {
        removePicker();
      }
    };
    keydownHandler = (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        removePicker();
      }
    };
    setTimeout(() => {
      if (!picker.isConnected || !closeHandler || !keydownHandler) return;
      document.addEventListener('pointerdown', closeHandler, true);
      document.addEventListener('keydown', keydownHandler, true);
    }, 0);
    return picker;
  }

  function _avatarColor(value, fallback) {
    const raw = String(value || '').trim();
    if (/^#[0-9a-f]{3,8}$/i.test(raw) || /^rgba?\(/i.test(raw) || /^hsla?\(/i.test(raw)) return raw;
    return fallback;
  }

  function toAvatarDataUrl(spec, options = {}) {
    const parsed = parseSpec(spec);
    const bg = _avatarColor(options.bg, '#000000');
    const fg = _avatarColor(options.fg || options.color, '#d4d4d4');
    let content = '';
    if (parsed.type === 'lucide') {
      const paths = _lucidePaths(parsed.name);
      content = `<svg x="34" y="34" width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="${_escAttr(fg)}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
    } else if (parsed.type === 'noto') {
      const emoji = parsed.emoji || codeToEmoji(parsed.code) || '?';
      content = `<text x="64" y="73" text-anchor="middle" dominant-baseline="middle" font-family="Meldex Noto Emoji, Noto Color Emoji, Segoe UI Emoji, Apple Color Emoji, sans-serif" font-size="66">${_esc(emoji)}</text>`;
    } else {
      content = `<text x="64" y="72" text-anchor="middle" dominant-baseline="middle" fill="${_escAttr(fg)}" font-family="Noto Sans JP, sans-serif" font-size="48" font-weight="700">${_esc((parsed.label || '?').slice(0, 2))}</text>`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="${_escAttr(bg)}"/>${content}</svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  global.GBIconAssets = {
    normalizeSpec,
    parseSpec,
    sameSpec,
    render,
    renderInto,
    listLucideIcons,
    listNotoEmoji,
    codeToEmoji,
    hasLucideName,
    openPicker,
    toAvatarDataUrl,
  };
})(window);
