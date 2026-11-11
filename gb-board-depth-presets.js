/* gb-board-depth-presets.js: 階層別スタイルのプリセット
   （階層ごとのカードとラインの組み合わせ一式）を保存・適用・名前変更・削除する。 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'meldex-bd-depth-style-presets-v1';
  const MAX_PRESETS = 60;

  let popupEl = null;
  let popupAnchor = null;
  let popupOutsideHandler = null;

  // ============================================================
  //  小さなユーティリティ
  // ============================================================

  // ボード側の識別子は `const bd = {...}` のようにグローバル字句スコープにあり、
  // window のプロパティにはならない。gb-board-immersive.js と同じく素の識別子で参照する。
  function boardState() {
    try {
      if (typeof bd !== 'undefined' && bd && Array.isArray(bd.nodes)) return bd;
    } catch { /* この画面には bd の字句束縛が無い。 */ }
    return global.bd && Array.isArray(global.bd.nodes) ? global.bd : null;
  }

  function status(message, isError) {
    if (typeof showStatus === 'function') showStatus(message, !!isError);
  }

  function escText(value) {
    return MeldexEscape.html(value);
  }

  // 保存済みプリセットの色はユーザー入力由来なので、CSS へ埋める前に形式を限定する。
  function safeColor(value, fallback) {
    const raw = String(value == null ? '' : value).trim();
    if (/^#[0-9a-f]{3,8}$/i.test(raw)) return raw;
    return fallback;
  }

  function clone(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
  }

  function normalizeStyles(styles) {
    if (typeof bdNormalizeDepthStyles === 'function') {
      return bdNormalizeDepthStyles(Array.isArray(styles) ? styles : []);
    }
    return Array.isArray(styles) ? clone(styles) || [] : [];
  }

  function currentStyles() {
    const state = boardState();
    if (!state) return [];
    if (typeof bdEnsureDepthStyles === 'function') bdEnsureDepthStyles();
    return normalizeStyles(state.depthStyles || []);
  }

  function makeId() {
    const stamp = Date.now().toString(36);
    const salt = Math.floor(Math.random() * 0x10000).toString(36);
    return `depth-preset-${stamp}-${salt}`;
  }

  // ============================================================
  //  ビルトインプリセット
  // ============================================================
  // ビルトインは削除・上書きできない土台。ユーザーはここから始めて自分の組み合わせを保存する。
  // cardStyleRef / lineStyleRef は「どのスタイルから値を取り込んだか」の目印でしかないため、
  // 値を作り変える派生プリセットでは空にして、実際の値と食い違わないようにする。


  // 用途ごとの初期搭載プリセット。色はテーマ色セットの位置（0赤 1橙 2黄 3緑 4水 5青 6紫 7桃）と
  // 塗り方（solid=塗りつぶし / tint=淡い色 / outline=枠だけ / plain=枠なし / muted=控えめ）で指定する。
  function level(palette, spec) {
    const pick = index => (typeof bdThemeRoleColor === 'function' ? bdThemeRoleColor(index, palette) : palette[index % palette.length]) || '#3b82f6';
    const color = pick(spec.idx);
    const toned = typeof bdThemeTone === 'function'
      ? bdThemeTone(color, spec.tone)
      : { bgColor: color, borderColor: color, textColor: '#ffffff', lineColor: color };
    const lineColorBase = pick(spec.lineIdx ?? spec.idx) || color;
    const lineColor = typeof bdThemeTone === 'function'
      ? bdThemeTone(lineColorBase, spec.lineTone || 'solid').lineColor
      : lineColorBase;
    return {
      name: spec.name,
      cardStyleRef: '',
      lineStyleRef: '',
      fontSize: spec.fontSize,
      fontBold: !!spec.bold,
      fontItalic: false,
      width: spec.width || 180,
      bgColor: toned.bgColor,
      textColor: toned.textColor || '',
      borderColor: toned.borderColor,
      borderWidth: spec.borderWidth ?? (spec.tone === 'plain' ? 0 : 1),
      borderRadius: spec.radius ?? 8,
      shape: spec.shape || 'rect',
      defaultText: spec.text || spec.name,
      line: {
        color: lineColor,
        width: spec.line?.width ?? 2,
        style: spec.line?.style || '',
        arrow: spec.line?.arrow || '',
        pathType: spec.line?.pathType || 'curve',
        branchRatio: 0.5,
        cornerRadius: 6,
      },
    };
  }

  function levels(specs) {
    return (base, palette) => specs.map(spec => level(palette, spec));
  }

  const BUILTIN_DEFS = [
    {
      id: 'depth-preset-standard',
      name: '標準',
      description: '中心テーマから詳細まで、主役の色を段階的に弱める汎用の組み合わせ',
      build: base => base,
    },
    {
      id: 'depth-preset-logic',
      name: 'ロジック・資料（直角線）',
      description: '論点整理や資料向け。角を控えめにし、直角線で階層を揃える',
      build: levels([
        { name: '結論', idx: 5, tone: 'solid', fontSize: 18, bold: true, width: 220, radius: 6, borderWidth: 2, line: { width: 2, pathType: 'orthogonal' } },
        { name: '論点', idx: 5, tone: 'tint', fontSize: 15, bold: true, width: 200, radius: 4, line: { width: 1.5, pathType: 'orthogonal' } },
        { name: '根拠', idx: 5, tone: 'outline', fontSize: 13, width: 190, radius: 4, line: { width: 1, pathType: 'orthogonal' } },
        { name: '補足', idx: 5, tone: 'outline', fontSize: 12, width: 180, radius: 4, lineTone: 'muted', line: { width: 1, pathType: 'orthogonal' } },
      ]),
    },
    {
      id: 'depth-preset-org',
      name: '組織図・分類',
      description: '上から下へ分ける組織図や分類ツリー向け。上位ほど濃く塗る',
      build: levels([
        { name: '全体', idx: 5, tone: 'solid', fontSize: 17, bold: true, width: 200, radius: 8, borderWidth: 2, line: { width: 2, pathType: 'orthogonal' } },
        { name: '部門', idx: 4, tone: 'solid', fontSize: 15, bold: true, width: 180, radius: 8, line: { width: 1.5, pathType: 'orthogonal' } },
        { name: 'チーム', idx: 4, tone: 'tint', fontSize: 13, width: 160, radius: 6, line: { width: 1, pathType: 'orthogonal' } },
        { name: '担当', idx: 4, tone: 'outline', fontSize: 12, width: 150, radius: 6, lineTone: 'muted', line: { width: 1, pathType: 'orthogonal' } },
      ]),
    },
    {
      id: 'depth-preset-rainbow',
      name: '階層で色分け',
      description: '深い階層でも何段目かを色で見分けられる。分類の多いマップ向け',
      build: levels([
        { name: '階層1', idx: 5, tone: 'solid', fontSize: 18, bold: true, width: 220, radius: 10, borderWidth: 2, line: { width: 3 } },
        { name: '階層2', idx: 4, tone: 'tint', fontSize: 15, bold: true, width: 190, radius: 8, borderWidth: 2, line: { width: 2 } },
        { name: '階層3', idx: 3, tone: 'tint', fontSize: 14, width: 180, radius: 8, line: { width: 1.5 } },
        { name: '階層4', idx: 2, tone: 'tint', fontSize: 13, width: 170, radius: 8, line: { width: 1 } },
        { name: '階層5', idx: 1, tone: 'tint', fontSize: 12, width: 160, radius: 8, line: { width: 1 } },
      ]),
    },
    {
      id: 'depth-preset-sticky',
      name: '付箋（アイデア出し）',
      description: 'ブレインストーミングやKJ法向け。テーマ以外は付箋の見た目にそろえる',
      build: levels([
        { name: 'テーマ', idx: 1, tone: 'solid', fontSize: 17, bold: true, width: 200, radius: 4, borderWidth: 2, lineTone: 'muted', line: { width: 1.5, pathType: 'straight' } },
        { name: '付箋', idx: 2, tone: 'tint', fontSize: 13, width: 160, radius: 2, borderWidth: 0, lineTone: 'muted', line: { width: 1, pathType: 'straight' } },
      ]),
    },
    {
      id: 'depth-preset-timeline',
      name: 'タイムライン',
      description: '年表や予定向け。節目を丸い札、作業を枠で表す',
      build: levels([
        { name: '期間', idx: 5, tone: 'solid', fontSize: 17, bold: true, width: 200, radius: 999, shape: 'pill', borderWidth: 2, line: { width: 3, pathType: 'straight', arrow: 'end' } },
        { name: '節目', idx: 4, tone: 'solid', fontSize: 14, bold: true, width: 160, radius: 999, shape: 'pill', line: { width: 1.5, pathType: 'straight' } },
        { name: '作業', idx: 4, tone: 'outline', fontSize: 13, width: 160, radius: 6, lineTone: 'muted', line: { width: 1, pathType: 'straight' } },
      ]),
    },
    {
      id: 'depth-preset-minimal',
      name: '線のみ（メモ）',
      description: '枠を使わず文字と線だけで書く。手早いメモや下書き向け',
      build: levels([
        { name: '題', idx: 5, tone: 'plain', fontSize: 19, bold: true, width: 220, radius: 0, line: { width: 2 } },
        { name: '項目', idx: 5, tone: 'plain', fontSize: 15, bold: true, width: 190, radius: 0, line: { width: 1.5 } },
        { name: '詳細', idx: 5, tone: 'plain', fontSize: 13, width: 180, radius: 0, lineTone: 'muted', line: { width: 1 } },
      ]),
    },
    {
      id: 'depth-preset-presentation',
      name: 'プレゼン（高コントラスト）',
      description: '画面共有や発表向け。すべて塗りつぶし、文字と線を太めにする',
      build: levels([
        { name: '主題', idx: 6, tone: 'solid', fontSize: 22, bold: true, width: 260, radius: 12, borderWidth: 2, line: { width: 4 } },
        { name: '要点', idx: 5, tone: 'solid', fontSize: 17, bold: true, width: 220, radius: 10, line: { width: 3 } },
        { name: '説明', idx: 4, tone: 'solid', fontSize: 15, width: 200, radius: 8, line: { width: 2 } },
      ]),
    },
  ];

  // 旧版の初期搭載プリセットIDを、役割の近い現行プリセットへ読み替える
  // （起点トピックの depthStyleRef や「適用中」記録に旧IDが残っていても見失わない）。
  const LEGACY_BUILTIN_ALIASES = Object.freeze({
    'depth-preset-simple': 'depth-preset-logic',
    'depth-preset-mindmap': 'depth-preset-standard',
  });

  function builtinPresets() {
    const base = normalizeStyles([]);
    if (!base.length) return [];
    const palette = typeof bdGetThemeColorSet === 'function' ? bdGetThemeColorSet(boardState() || undefined) : [];
    const colors = Array.isArray(palette) && palette.length
      ? palette
      : ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
    return BUILTIN_DEFS.map(def => ({
      id: def.id,
      name: def.name,
      description: def.description || '',
      builtin: true,
      styles: normalizeStyles(def.build(base.map(style => ({ ...style, line: { ...(style.line || {}) } })), colors)),
    }));
  }

  // ============================================================
  //  保存領域
  // ============================================================

  function readUserPresets() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
    catch { return []; }
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(entry => entry && typeof entry === 'object' && Array.isArray(entry.styles) && entry.styles.length)
      .map(entry => ({
        id: String(entry.id || '') || makeId(),
        name: String(entry.name || '').trim() || '名前のないプリセット',
        builtin: false,
        updatedAt: String(entry.updatedAt || ''),
        styles: entry.styles,
      }))
      .slice(0, MAX_PRESETS);
  }

  function writeUserPresets(presets) {
    try {
      const payload = (presets || []).slice(0, MAX_PRESETS).map(entry => ({
        id: entry.id,
        name: entry.name,
        updatedAt: entry.updatedAt || '',
        styles: entry.styles,
      }));
      if (payload.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      else localStorage.removeItem(STORAGE_KEY);
      return true;
    } catch {
      return false;
    }
  }

  function listPresets() {
    return [...builtinPresets(), ...readUserPresets()];
  }

  function findPreset(id) {
    const key = LEGACY_BUILTIN_ALIASES[id] || id;
    return listPresets().find(entry => entry.id === key) || null;
  }

  function uniqueName(baseName, excludeId) {
    const trimmed = String(baseName || '').trim() || '階層別スタイル';
    const taken = new Set(listPresets().filter(entry => entry.id !== excludeId).map(entry => entry.name));
    if (!taken.has(trimmed)) return trimmed;
    for (let i = 2; i < 1000; i++) {
      const candidate = `${trimmed} ${i}`;
      if (!taken.has(candidate)) return candidate;
    }
    return trimmed;
  }

  // 現在のボードの階層別スタイルと一致するプリセットを探す。
  // 保存済みの選択IDも、現在の内容が一致する間だけ適用中として扱う。
  function fingerprint(styles) {
    return JSON.stringify(normalizeStyles(styles));
  }

  function matchedPresetId() {
    const current = fingerprint(currentStyles());
    if (!current || current === '[]') return '';
    const state = boardState();
    const presets = listPresets();
    // 同じ内容を別名保存しても、選んだプリセットを標準搭載のものへ戻さない。
    // 選択IDはボードの保存・履歴に含め、別タブや復元時も同じ選択へ戻す。
    const preferred = state?.activeDepthStylePreset
      ? presets.find(entry => entry.id === state.activeDepthStylePreset && fingerprint(entry.styles) === current)
      : null;
    const hit = preferred || presets.find(entry => fingerprint(entry.styles) === current);
    return hit ? hit.id : '';
  }

  function rememberChosenPreset(id) {
    const state = boardState();
    if (state) state.activeDepthStylePreset = id;
  }

  // ============================================================
  //  操作
  // ============================================================

  function applyBoardChange() {
    const state = boardState();
    if (state && typeof bdNormalizeDepthStyles === 'function') {
      state.depthStyles = bdNormalizeDepthStyles(state.depthStyles);
    }
    if (typeof _bdApplyAllAutoStyles === 'function') _bdApplyAllAutoStyles();
    if (typeof bdDirty === 'function') bdDirty();
    if (typeof _bdRenderKeepingDetailTab === 'function') _bdRenderKeepingDetailTab();
    if (typeof bdRefreshBoardToolbar === 'function') bdRefreshBoardToolbar();
    if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
  }

  function applyPreset(id) {
    const preset = findPreset(id);
    const state = boardState();
    if (!preset || !state) return false;
    if (state.readOnly || state.readonly || state.isReadOnly) {
      status('読み取り専用のボードは変更できません', true);
      return false;
    }
    if (typeof bdPushUndo === 'function') bdPushUndo(`階層別スタイル: ${preset.name}`);
    state.depthStyles = normalizeStyles(preset.styles);
    rememberChosenPreset(id);
    applyBoardChange();
    status(`階層別スタイル「${preset.name}」を適用しました`);
    return true;
  }

  function saveCurrentAsNew(name) {
    const state = boardState();
    if (!state || state.readOnly || state.readonly || state.isReadOnly) return null;
    const styles = currentStyles();
    if (!styles.length) return null;
    const presets = readUserPresets();
    if (presets.length >= MAX_PRESETS) {
      status(`プリセットは${MAX_PRESETS}件までです。不要なものを削除してください`, true);
      return null;
    }
    const entry = {
      id: makeId(),
      name: uniqueName(name),
      builtin: false,
      updatedAt: new Date().toISOString(),
      styles,
    };
    presets.push(entry);
    if (!writeUserPresets(presets)) {
      if (typeof global.showStatus === 'function') global.showStatus('プリセットを保存できませんでした', true);
      return null;
    }
    if (typeof bdPushUndo === 'function') bdPushUndo(`階層別スタイルを保存: ${entry.name}`);
    rememberChosenPreset(entry.id);
    if (typeof bdDirty === 'function') bdDirty();
    return entry;
  }

  function duplicatePreset(id) {
    const source = findPreset(id);
    if (!source) return null;
    const presets = readUserPresets();
    if (presets.length >= MAX_PRESETS) {
      status(`プリセットは${MAX_PRESETS}件までです。不要なものを削除してください`, true);
      return null;
    }
    const entry = {
      id: makeId(),
      name: uniqueName(`${source.name} のコピー`),
      builtin: false,
      updatedAt: new Date().toISOString(),
      styles: normalizeStyles(source.styles),
    };
    presets.push(entry);
    if (writeUserPresets(presets)) return entry;
    status('プリセットを複製できませんでした', true);
    return null;
  }

  function overwritePreset(id) {
    const presets = readUserPresets();
    const target = presets.find(entry => entry.id === id);
    if (!target) return false;
    const styles = currentStyles();
    if (!styles.length) return false;
    target.styles = styles;
    target.updatedAt = new Date().toISOString();
    return writeUserPresets(presets);
  }

  function renamePreset(id, name) {
    const presets = readUserPresets();
    const target = presets.find(entry => entry.id === id);
    if (!target) return false;
    const nextName = String(name || '').trim();
    if (!nextName) return false;
    target.name = uniqueName(nextName, id);
    target.updatedAt = new Date().toISOString();
    return writeUserPresets(presets);
  }

  function removePreset(id) {
    const presets = readUserPresets();
    const next = presets.filter(entry => entry.id !== id);
    if (next.length === presets.length) return false;
    return writeUserPresets(next);
  }

  // ============================================================
  //  表示
  // ============================================================

  function previewHtml(styles) {
    const chips = (Array.isArray(styles) ? styles : []).slice(0, 7).map((style, index) => {
      const bg = safeColor(style?.bgColor, 'var(--bg2)');
      const border = safeColor(style?.borderColor, 'var(--border)');
      const round = style?.shape === 'pill' || style?.shape === 'ellipse'
        ? '999px'
        : `${Math.min(6, Math.max(0, Math.round(+style?.borderRadius || 0)))}px`;
      const width = Math.max(9, 24 - index * 2);
      return `<span class="bd-depth-preset-chip" style="background:${bg};border-color:${border};border-radius:${round};width:${width}px"></span>`;
    }).join('');
    return `<span class="bd-depth-preset-chips" aria-hidden="true">${chips}</span>`;
  }

  function presetSummary(preset) {
    const count = Array.isArray(preset?.styles) ? preset.styles.length : 0;
    return `${preset?.name || ''}（${count}階層）`;
  }

  function triggerLabel() {
    const activeId = matchedPresetId();
    if (!activeId) return 'プリセット未適用（編集中）';
    const preset = findPreset(activeId);
    return preset ? presetSummary(preset) : 'プリセット未適用（編集中）';
  }

  // ============================================================
  //  ポップアップ
  // ============================================================

  function closePopup(options) {
    const anchor = popupAnchor;
    if (anchor?.setAttribute) anchor.setAttribute('aria-expanded', 'false');
    // 取り残された同種のポップアップも必ず片付ける。
    document.querySelectorAll('.bd-depth-preset-popup').forEach(el => el.remove());
    popupEl = null;
    popupAnchor = null;
    if (popupOutsideHandler) {
      document.removeEventListener('pointerdown', popupOutsideHandler);
      popupOutsideHandler = null;
    }
    if (options?.restoreFocus && anchor?.isConnected && typeof anchor.focus === 'function') {
      if (typeof global.focusMeldexDropdownTrigger === 'function') global.focusMeldexDropdownTrigger(anchor);
      else try { anchor.focus({ preventScroll: true }); } catch { anchor.focus(); }
    }
  }

  function positionPopupAt(anchor) {
    if (!popupEl || !anchor?.getBoundingClientRect) return;
    const rect = anchor.getBoundingClientRect();
    if (typeof global.positionPopup === 'function') {
      global.positionPopup(popupEl, rect, { prefer: 'below', gap: 4 });
      return;
    }
    const zoom = typeof global._getZoom === 'function' ? global._getZoom() : 1;
    popupEl.style.left = (rect.left / zoom) + 'px';
    popupEl.style.top = (rect.bottom / zoom + 4) + 'px';
    if (typeof global.clampPopupToViewport === 'function') global.clampPopupToViewport(popupEl);
  }

  function closeButtonHtml() {
    if (typeof global.meldexDropdownCloseButtonHtml === 'function') {
      return global.meldexDropdownCloseButtonHtml({
        className: 'bd-detail-style-action bd-style-manager-popup-close',
        attr: 'data-bd-depth-preset-close',
      });
    }
    const icon = typeof global.lucide === 'function' ? global.lucide('x', 14) : '×';
    return `<button type="button" class="bd-detail-style-action bd-style-manager-popup-close" data-bd-depth-preset-close title="閉じる" aria-label="閉じる">${icon}</button>`;
  }

  async function askName(message, defaultValue) {
    if (typeof global.cfPrompt === 'function') return await global.cfPrompt(message, defaultValue);
    if (typeof global.prompt === 'function') return global.prompt(message, defaultValue);
    return defaultValue;
  }

  async function askConfirm(message) {
    if (typeof global.cfConfirm === 'function') return await global.cfConfirm(message);
    if (typeof global.confirm === 'function') return global.confirm(message);
    return true;
  }

  function openPopup(anchorEl, options) {
    if (!anchorEl) return;
    global.MeldexBoardStyleManagerPopup?.close?.();
    if (popupEl) {
      const same = popupAnchor === anchorEl;
      closePopup();
      if (same) return;
    }
    const opts = options || {};
    let anchor = anchorEl;
    popupEl = document.createElement('div');
    popupEl.className = 'bd-style-manager-popup bd-depth-preset-popup';
    popupEl.setAttribute('role', 'dialog');
    popupEl.setAttribute('aria-label', '階層別スタイルのプリセット');
    popupEl.setAttribute('aria-modal', 'false');
    popupEl.tabIndex = -1;
    document.body.appendChild(popupEl);
    popupAnchor = anchor;
    anchor.setAttribute('aria-haspopup', 'dialog');
    anchor.setAttribute('aria-expanded', 'true');

    const notify = () => { if (typeof opts.onChange === 'function') opts.onChange(); };

    const self = popupEl;
    const render = () => {
      // 確認ダイアログ待ちなどで既に閉じられたあとの遅延再描画では何もしない。
      // 描画すると positionPopup() が閉じたはずのポップアップを DOM へ戻してしまう。
      if (!popupEl || popupEl !== self) return;
      const presets = listPresets();
      const activeId = matchedPresetId();
      const selectedId = presets.some(entry => entry.id === opts.selectedId)
        ? opts.selectedId
        : (activeId || presets[0]?.id || '');
      opts.selectedId = selectedId;
      const selected = presets.find(entry => entry.id === selectedId) || null;
      const icon = (name, fallback) => (typeof global.lucide === 'function' ? global.lucide(name, 14) : fallback);

      popupEl.innerHTML = `
        <div class="bd-style-manager-popup-list" role="listbox" aria-label="階層別スタイルのプリセット一覧">
          ${presets.map(entry => {
            const label = presetSummary(entry) + (entry.builtin ? '（標準搭載）' : '');
            return `<div class="bd-style-list-item bd-depth-preset-item ${entry.id === selectedId ? 'active' : ''} ${entry.id === activeId ? 'is-applied' : ''}"
              data-bd-depth-preset-id="${escText(entry.id)}" tabindex="0" role="option"
              aria-selected="${entry.id === selectedId ? 'true' : 'false'}"
              title="${escText(label)}" aria-label="${escText(label)}">
              <span class="bd-style-list-preview bd-depth-preset-preview">${previewHtml(entry.styles)}</span>
              <span class="bd-style-list-name">${escText(entry.name)}</span>
              ${entry.id === activeId ? '<span class="bd-style-applied-mark">適用中</span>' : ''}
            </div>`;
          }).join('')}
          ${presets.length ? '' : '<div class="bd-depth-preset-empty">保存されたプリセットはありません</div>'}
        </div>
        <div class="bd-style-manager-popup-actions">
          <button type="button" class="bd-detail-style-action" data-bd-depth-preset-add title="今の階層別スタイルを新しいプリセットとして保存" aria-label="今の階層別スタイルを新しいプリセットとして保存">${icon('plus', '+')}</button>
          <button type="button" class="bd-detail-style-action" data-bd-depth-preset-duplicate title="選択中のプリセットを複製" aria-label="選択中のプリセットを複製" ${selected ? '' : 'disabled'}>${icon('copy', '複製')}</button>
          <button type="button" class="bd-detail-style-action" data-bd-depth-preset-overwrite title="選択中のプリセットを今の内容で上書き" aria-label="選択中のプリセットを今の内容で上書き" ${selected && !selected.builtin ? '' : 'disabled'}>${icon('save', '保存')}</button>
          <button type="button" class="bd-detail-style-action" data-bd-depth-preset-rename title="選択中のプリセットの名前を変更" aria-label="選択中のプリセットの名前を変更" ${selected && !selected.builtin ? '' : 'disabled'}>${icon('pencil', '名前')}</button>
          <button type="button" class="bd-detail-style-action bd-detail-style-action--danger" data-bd-depth-preset-delete title="選択中のプリセットを削除" aria-label="選択中のプリセットを削除" ${selected && !selected.builtin ? '' : 'disabled'}>${icon('trash2', '削除')}</button>
          ${closeButtonHtml()}
        </div>`;

      if (typeof opts.refreshAnchor === 'function') {
        const next = opts.refreshAnchor();
        if (next) {
          anchor = next;
          popupAnchor = next;
          anchor.setAttribute('aria-haspopup', 'dialog');
          anchor.setAttribute('aria-expanded', 'true');
        }
      }
      positionPopupAt(anchor);

      popupEl.querySelectorAll('[data-bd-depth-preset-id]').forEach(item => {
        const activate = () => {
          const id = item.dataset.bdDepthPresetId || '';
          opts.selectedId = id;
          if (applyPreset(id)) notify();
          render();
        };
        item.addEventListener('click', activate);
        item.addEventListener('keydown', event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          activate();
        });
      });

      popupEl.querySelector('[data-bd-depth-preset-add]')?.addEventListener('click', async () => {
        const suggested = uniqueName('階層別スタイル');
        const name = await askName('プリセット名を入力してください', suggested);
        if (name === null || name === undefined) return;
        const entry = saveCurrentAsNew(name);
        if (!entry) return;
        opts.selectedId = entry.id;
        if (typeof global.showStatus === 'function') global.showStatus(`プリセット「${entry.name}」を保存しました`);
        notify();
        render();
      });

      popupEl.querySelector('[data-bd-depth-preset-overwrite]')?.addEventListener('click', async () => {
        if (!selected || selected.builtin) return;
        const ok = await askConfirm(`プリセット「${selected.name}」を今の階層別スタイルで上書きしますか？`);
        if (!ok) return;
        if (!overwritePreset(selected.id)) {
          if (typeof global.showStatus === 'function') global.showStatus('プリセットを上書きできませんでした', true);
          return;
        }
        if (typeof global.showStatus === 'function') global.showStatus(`プリセット「${selected.name}」を上書きしました`);
        notify();
        render();
      });

      popupEl.querySelector('[data-bd-depth-preset-duplicate]')?.addEventListener('click', () => {
        if (!selected) return;
        const entry = duplicatePreset(selected.id);
        if (!entry) return;
        opts.selectedId = entry.id;
        if (typeof global.showStatus === 'function') global.showStatus(`プリセット「${entry.name}」を複製しました`);
        notify();
        render();
      });

      popupEl.querySelector('[data-bd-depth-preset-rename]')?.addEventListener('click', async () => {
        if (!selected || selected.builtin) return;
        const name = await askName('新しいプリセット名を入力してください', selected.name);
        if (name === null || name === undefined) return;
        if (!renamePreset(selected.id, name)) return;
        notify();
        render();
      });

      popupEl.querySelector('[data-bd-depth-preset-delete]')?.addEventListener('click', async () => {
        if (!selected || selected.builtin) return;
        const ok = await askConfirm(`プリセット「${selected.name}」を削除しますか？`);
        if (!ok) return;
        if (!removePreset(selected.id)) return;
        opts.selectedId = '';
        if (typeof global.showStatus === 'function') global.showStatus(`プリセット「${selected.name}」を削除しました`);
        notify();
        render();
      });

      popupEl.querySelector('[data-bd-depth-preset-close]')?.addEventListener('click', () => {
        closePopup({ restoreFocus: true });
      });
    };

    popupEl.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePopup({ restoreFocus: true });
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const items = [...popupEl.querySelectorAll('.bd-depth-preset-item')];
      if (!items.length) return;
      const target = event.target?.closest?.('.bd-depth-preset-item');
      if (!target && event.target !== popupEl) return;
      event.preventDefault();
      const current = items.indexOf(target);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = current < 0 ? (step > 0 ? 0 : items.length - 1) : (current + step + items.length) % items.length;
      items[next].focus();
    });

    render();
    setTimeout(() => {
      popupOutsideHandler = event => {
        if (!popupEl || popupEl !== self) return;
        // 名前入力や削除確認のダイアログ内クリックでは閉じない。
        if (event.target?.closest?.('[aria-modal="true"], dialog[open]')) return;
        if (popupEl.contains(event.target)) return;
        if (popupAnchor && popupAnchor.contains(event.target)) return;
        closePopup();
      };
      document.addEventListener('pointerdown', popupOutsideHandler);
    }, 0);
  }

  // ============================================================
  //  階層別スタイルタブへ差し込むプリセット行
  // ============================================================

  function buildRow(options) {
    const opts = options || {};
    const section = document.createElement('div');
    section.className = 'bd-detail-section bd-depth-preset-section';
    const title = document.createElement('div');
    title.className = 'bd-detail-section-title';
    title.textContent = '階層別スタイルプリセット';
    if (typeof global.fieldHelp === 'function') {
      title.insertAdjacentHTML('beforeend', ' ' + global.fieldHelp(
        '階層ごとのトピックとラインの組み合わせを一式でまとめたものです。選ぶとこのボードの階層別スタイル全体が入れ替わります。保存したプリセットはどのボードからでも使えます。'
      ));
    }
    const row = document.createElement('div');
    row.className = 'bd-detail-style-row';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'bd-style-panel-picker bd-depth-preset-picker';
    trigger.setAttribute('data-bd-depth-preset-picker', 'depth');
    trigger.setAttribute('data-e2e-id', 'bd-depth-preset-picker');
    trigger.setAttribute('aria-label', 'プリセットを選ぶ');
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');

    const refresh = () => {
      const activeId = matchedPresetId();
      const preset = activeId ? findPreset(activeId) : null;
      trigger.innerHTML = `<span class="bd-style-picker-preview">${previewHtml(preset ? preset.styles : currentStyles())}</span>`
        + `<span class="bd-style-picker-label">${escText(triggerLabel())}</span>`
        + '<span class="bd-style-picker-caret" aria-hidden="true">▾</span>';
    };
    refresh();

    trigger.addEventListener('click', () => {
      openPopup(trigger, {
        onChange: () => {
          refresh();
          if (typeof opts.onApplied === 'function') opts.onApplied();
        },
        refreshAnchor: () => (typeof opts.refreshAnchor === 'function' ? opts.refreshAnchor() : trigger),
      });
    });

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'bd-detail-style-action';
    saveBtn.setAttribute('data-bd-depth-preset-save', 'true');
    saveBtn.setAttribute('data-e2e-id', 'bd-depth-preset-save');
    saveBtn.title = '今の階層別スタイルを新しいプリセットとして保存';
    saveBtn.setAttribute('aria-label', saveBtn.title);
    saveBtn.innerHTML = typeof global.lucide === 'function' ? global.lucide('plus', 14) : '+';
    saveBtn.addEventListener('click', async () => {
      const name = await askName('プリセット名を入力してください', uniqueName('階層別スタイル'));
      if (name === null || name === undefined) return;
      const entry = saveCurrentAsNew(name);
      if (!entry) return;
      if (typeof global.showStatus === 'function') global.showStatus(`プリセット「${entry.name}」を保存しました`);
      refresh();
    });

    row.append(trigger, saveBtn);
    section.append(title, row);
    return { section, refresh };
  }

  global.MeldexBoardDepthPresets = Object.freeze({
    list: listPresets,
    find: findPreset,
    apply: applyPreset,
    saveCurrentAsNew,
    duplicate: duplicatePreset,
    overwrite: overwritePreset,
    rename: renamePreset,
    remove: removePreset,
    matchedPresetId,
    buildRow,
    openPopup,
    closePopup,
    storageKey: STORAGE_KEY,
  });
})(typeof window !== 'undefined' ? window : globalThis);
