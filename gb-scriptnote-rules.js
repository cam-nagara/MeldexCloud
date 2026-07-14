/* gb-scriptnote-rules.js: シナリオエディタ用 入力設定 UI */

function getScenarioNoteLayoutLabel() {
  const value = typeof getScenarioNoteLayoutMode === 'function' ? getScenarioNoteLayoutMode(doc) : '';
  if (value === 'drama') return 'ドラマ・映画シナリオ';
  if (value === 'afureko') return 'アフレコシナリオ';
  if (value === 'stage') return '舞台シナリオ';
  return 'マンガシナリオ';
}

function _rulesAttrValue(value) {
  return esc(value == null ? '' : String(value));
}

function _rulesNamedActionAttrs(action, kind, name, extra = {}) {
  let attrs = `data-rules-action="${_rulesAttrValue(action)}" data-rules-kind="${_rulesAttrValue(kind)}" data-rules-name="${_rulesAttrValue(name)}"`;
  Object.entries(extra).forEach(([key, value]) => {
    attrs += ` data-rules-${key}="${_rulesAttrValue(value)}"`;
  });
  return attrs;
}

function _rulesNamedChangeAttrs(change, kind, name, extra = {}) {
  let attrs = `data-rules-change="${_rulesAttrValue(change)}" data-rules-kind="${_rulesAttrValue(kind)}" data-rules-name="${_rulesAttrValue(name)}"`;
  Object.entries(extra).forEach(([key, value]) => {
    attrs += ` data-rules-${key}="${_rulesAttrValue(value)}"`;
  });
  return attrs;
}

function _rulesBindStructuredHandlers(el) {
  if (!el || el._rulesStructuredBound) return;
  el._rulesStructuredBound = true;

  el.addEventListener('keydown', (event) => {
    const target = event.target.closest('[data-rules-action][role="button"]');
    if (!target || !el.contains(target)) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    target.click();
  });

  el.addEventListener('click', (event) => {
    const target = event.target.closest('[data-rules-action]');
    if (!target || !el.contains(target)) return;
    const action = target.dataset.rulesAction || '';
    const kind = target.dataset.rulesKind || '';
    const name = target.dataset.rulesName || '';
    switch (action) {
      case 'pick-color':
        if (typeof _rulesPickColor === 'function') _rulesPickColor(target.dataset.rulesColorType || '', name, target);
        return;
      case 'toggle-chara-global-font':
        if (typeof _rulesToggleCharaGlobalFont === 'function') _rulesToggleCharaGlobalFont(target.dataset.rulesFontKey || '');
        return;
      case 'toggle-named-font':
        if (typeof _rulesToggleNamedFont === 'function') _rulesToggleNamedFont(kind, name, target.dataset.rulesFontKey || '');
        return;
      case 'remove-chara':
        if (typeof _rulesRemoveChara === 'function') _rulesRemoveChara(name);
        return;
      case 'add-chara':
        if (typeof _rulesAddChara === 'function') _rulesAddChara();
        return;
      case 'open-character-db-import':
        if (typeof openScenarioCharacterDbImport === 'function') openScenarioCharacterDbImport();
        return;
      case 'add-checked-charas':
        if (typeof _rulesAddCheckedCharas === 'function') _rulesAddCheckedCharas();
        return;
      case 'add-custom-type':
        if (typeof _rulesAddCustomType === 'function') _rulesAddCustomType(kind);
        return;
      case 'clear-named-style':
        if (kind === 'special' && typeof _rulesClearSpecialChara === 'function') _rulesClearSpecialChara(name);
        else if (kind === 'rowtype' && typeof _rulesClearRowType === 'function') _rulesClearRowType(name);
        return;
      case 'delete-mode-type':
        if (typeof _rulesDeleteModeType === 'function') _rulesDeleteModeType(kind, name);
        return;
      default:
        return;
    }
  });

  el.addEventListener('dragstart', (event) => {
    const target = event.target.closest('[data-rules-drag-kind]');
    if (!target || !el.contains(target)) return;
    const kind = target.dataset.rulesDragKind || '';
    const index = Number(target.dataset.rulesIndex || '0');
    if (kind === 'chara' && typeof _rulesCharaDragStart === 'function') _rulesCharaDragStart(event, index);
    else if (typeof _rulesTypeDragStart === 'function') _rulesTypeDragStart(event, kind, index);
  });

  el.addEventListener('dragover', (event) => {
    const target = event.target.closest('[data-rules-drag-kind]');
    if (!target || !el.contains(target)) return;
    const kind = target.dataset.rulesDragKind || '';
    const index = Number(target.dataset.rulesIndex || '0');
    if (kind === 'chara' && typeof _rulesCharaDragOver === 'function') _rulesCharaDragOver(event, index);
    else if (typeof _rulesTypeDragOver === 'function') _rulesTypeDragOver(event, kind, index);
  });

  el.addEventListener('drop', (event) => {
    const target = event.target.closest('[data-rules-drag-kind]');
    if (!target || !el.contains(target)) return;
    const kind = target.dataset.rulesDragKind || '';
    const index = Number(target.dataset.rulesIndex || '0');
    if (kind === 'chara' && typeof _rulesCharaDrop === 'function') _rulesCharaDrop(event, index);
    else if (typeof _rulesTypeDrop === 'function') _rulesTypeDrop(event, kind, index);
  });

  el.addEventListener('dragend', (event) => {
    const target = event.target.closest('[data-rules-drag-kind]');
    if (!target || !el.contains(target)) return;
    const kind = target.dataset.rulesDragKind || '';
    if (kind === 'chara' && typeof _rulesCharaDragEnd === 'function') _rulesCharaDragEnd();
    else if (typeof _rulesTypeDragEnd === 'function') _rulesTypeDragEnd();
  });

  el.addEventListener('change', (event) => {
    const target = event.target.closest('[data-rules-change]');
    if (!target || !el.contains(target)) return;
    const change = target.dataset.rulesChange || '';
    const kind = target.dataset.rulesKind || '';
    const name = target.dataset.rulesName || '';
    switch (change) {
      case 'chara-auto-color-target':
        if (typeof _rulesSetCharaAutoColorTarget === 'function') _rulesSetCharaAutoColorTarget(target.value);
        return;
      case 'chara-global-font-size':
        if (typeof _rulesSetCharaGlobalFontSize === 'function') _rulesSetCharaGlobalFontSize(target.value);
        return;
      case 'rename-chara':
        if (typeof _rulesRenameChara === 'function') _rulesRenameChara(name, target.value);
        return;
      case 'named-font-size':
        if (typeof _rulesSetNamedFontSize === 'function') _rulesSetNamedFontSize(kind, name, target.value);
        return;
      case 'page-visual-style':
        if (typeof _rulesSetPageVisualStyle === 'function') _rulesSetPageVisualStyle(name, target.value);
        return;
      case 'page-display-prefix':
        if (typeof _rulesSetPageDisplayPrefix === 'function') _rulesSetPageDisplayPrefix(name, target.value);
        return;
      case 'page-separator-text':
        if (typeof _rulesSetPageSeparatorText === 'function') _rulesSetPageSeparatorText(name, target.value);
        return;
      case 'page-boundary-line':
        if (typeof _rulesSetPageBoundaryLine === 'function') _rulesSetPageBoundaryLine(name, !!target.checked);
        return;
      default:
        return;
    }
  });
}

function _rulesGetActiveScriptNoteEditor() {
  const comp = typeof getActiveScriptNoteComponent === 'function' ? getActiveScriptNoteComponent() : null;
  if (comp?._editor?.doc) return comp._editor;
  return typeof _sn2GetActiveEditor === 'function' ? _sn2GetActiveEditor() : null;
}

function renderScriptNoteRulesTab(targetEl = null) {
  const el = targetEl;
  if (!el) return;
  const activeEditor = _rulesGetActiveScriptNoteEditor();
  if (activeEditor?.doc && typeof activeEditor.renderDetailPanel === 'function') {
    activeEditor.renderDetailPanel(el);
    return;
  }
  const legacyDoc = typeof doc !== 'undefined' ? doc : null;
  if (!legacyDoc || !legacyDoc.settings) {
    el.innerHTML = '<div class="rules-fallback-message">シナリオファイルを開いてください</div>';
    return;
  }
  const globalObj = typeof globalThis !== 'undefined' ? globalThis : window;
  const missingLegacyDeps = [
    'ensureScenarioSettings',
    '_rulesGetCharaStyleDefaults',
    '_rulesGetCharaAutoColorTarget',
    '_rulesResolveCharaBgColor',
    '_rulesResolveCharaTextColor',
    '_rulesRenderPreview',
    '_rulesEnsureSpecialStyle',
    '_rulesEnsureRowTypeStyle',
    'ensurePageSettingBehavior',
    '_rulesSetCharaAutoColorTarget',
    '_rulesToggleCharaGlobalFont',
    '_rulesSetCharaGlobalFontSize',
    '_rulesPickColor',
    '_rulesRenameChara',
    '_rulesRemoveChara',
    '_rulesAddChara',
    'openScenarioCharacterDbImport',
    '_rulesAddCheckedCharas',
    '_rulesAddCustomType',
    '_rulesCharaDragStart',
    '_rulesCharaDragOver',
    '_rulesCharaDrop',
    '_rulesCharaDragEnd',
    '_rulesTypeDragStart',
    '_rulesTypeDragOver',
    '_rulesTypeDrop',
    '_rulesTypeDragEnd',
    '_rulesToggleNamedFont',
    '_rulesClearSpecialChara',
    '_rulesClearRowType',
    '_rulesDeleteModeType',
    '_rulesSetNamedFontSize',
    '_rulesSetPageVisualStyle',
    '_rulesSetPageDisplayPrefix',
    '_rulesSetPageSeparatorText',
    '_rulesSetPageBoundaryLine',
  ].filter((name) => typeof globalObj[name] !== 'function');
  if (missingLegacyDeps.length
      || typeof SPECIAL_CHARA === 'undefined'
      || typeof PAGE_SETTINGS === 'undefined'
      || typeof RULE_PAGE_VISUAL_STYLE_OPTIONS === 'undefined') {
    el.innerHTML = '<div class="rules-fallback-message">現行シナリオエディタのタイプ管理タブを使用してください</div>';
    return;
  }
  ensureScenarioSettings(doc);
  let html = '';

  html += '<div class="rules-section">';
  html += '<div class="rules-section-title">入力設定</div>';
  html += '<div class="rules-section-help">シナリオエディタで使う候補名と基本書式を設定します。ここではキャラ・特殊キャラ・行タイプだけを扱います。</div>';
  html += `<div class="rules-type-row rules-type-row--top">
    <span class="rules-type-label rules-type-label--fixed">現在の書式</span>
    <div class="rules-current-body">
      <div>シナリオ書式: <strong class="rules-current-name">${esc(getScenarioNoteLayoutLabel())}</strong></div>
      <div>表示方向・折返し・幅・行間・字間・フォントはシナリオエディタのツールバーで調整します。</div>
    </div>
  </div>`;
  html += '</div>';

  html += '<div class="rules-section">';
  html += '<div class="rules-section-title">キャラ設定</div>';
  html += '<div class="rules-section-help">キャラ候補と基本書式です。シナリオエディタのキャラ選択候補へ反映されます。</div>';
  const charaDefaults = _rulesGetCharaStyleDefaults();
  const globalAutoTarget = _rulesGetCharaAutoColorTarget();
  const globalBold = (charaDefaults.fontWeight || 'bold') === 'bold';
  const globalItalic = charaDefaults.fontStyle === 'italic';
  const globalFontSize = charaDefaults.fontSize || '';
  html += `<div class="rules-type-row rules-type-row--wrap rules-chara-global-row">
    <span class="rules-type-label rules-type-label--fixed">共通設定</span>
    <select class="rules-mini-select" ${_rulesNamedChangeAttrs('chara-auto-color-target', 'chara', 'global')} title="自動配色の適用先" aria-label="自動配色の適用先">
      <option value="bg"${globalAutoTarget==='bg' ? ' selected' : ''}>背景へ</option>
      <option value="text"${globalAutoTarget==='text' ? ' selected' : ''}>文字へ</option>
      <option value="none"${globalAutoTarget==='none' ? ' selected' : ''}>不使用</option>
    </select>
    <button type="button" class="rules-font-btn rules-font-btn--bold${globalBold?' active':''}" ${_rulesNamedActionAttrs('toggle-chara-global-font', 'chara', 'global', { 'font-key': 'fontWeight' })} title="太字" aria-label="キャラ共通 太字">B</button>
    <button type="button" class="rules-font-btn rules-font-btn--italic${globalItalic?' active':''}" ${_rulesNamedActionAttrs('toggle-chara-global-font', 'chara', 'global', { 'font-key': 'fontStyle' })} title="斜体" aria-label="キャラ共通 斜体">I</button>
    <input type="number" class="rules-font-size" value="${globalFontSize}" min="8" max="24" placeholder="${_rulesGetCharacterFontPlaceholder()}"
      ${_rulesNamedChangeAttrs('chara-global-font-size', 'chara', 'global')} title="フォントサイズ(px)" aria-label="キャラ共通 フォントサイズ">
  </div>`;
  if (!doc.characters.length) {
    html += '<div class="rules-empty-note">キャラなし</div>';
  } else {
    doc.characters.forEach((c, i) => {
      if (c.isDefault) return; // 役割空行用デフォルトタイプはこの一覧では非表示
      const bg = _rulesResolveCharaBgColor(c);
      const tc = _rulesResolveCharaTextColor(c);
      const tcDisplay = tc || (isLightTheme() ? '#333' : '#aaa');
      const bgClass = globalAutoTarget === 'bg' ? 'rules-swatch rules-swatch-auto' : 'rules-swatch';
      const textClass = globalAutoTarget === 'text' ? 'rules-swatch rules-swatch-text rules-swatch-auto' : 'rules-swatch rules-swatch-text';
      html += `<div class="rules-chara-row" draggable="true" data-rules-chara-idx="${i}" data-rules-drag-kind="chara" data-rules-index="${i}">
        <span class="rules-drag-handle">⠿</span>
        <div class="${bgClass}" style="background:${_rulesGetSwatchBackground(bg, 'var(--bg3)')};${bg === 'transparent' ? 'background-size:8px 8px;background-position:0 0,4px 4px;' : ''}"
          ${_rulesNamedActionAttrs('pick-color', 'chara', i, { 'color-type': 'chara-bg' })} role="button" tabindex="0" title="背景色" aria-label="${_rulesAttrValue((c.name || 'キャラ') + ' 背景色')}"></div>
        <div class="${textClass}" style="background:${_rulesGetSwatchBackground(tcDisplay, 'var(--fg2)')};border:1px solid var(--border);${tcDisplay === 'transparent' ? 'background-size:8px 8px;background-position:0 0,4px 4px;' : ''}"
          ${_rulesNamedActionAttrs('pick-color', 'chara', i, { 'color-type': 'chara-text' })} role="button" tabindex="0" title="文字色" aria-label="${_rulesAttrValue((c.name || 'キャラ') + ' 文字色')}"></div>
        ${_rulesRenderPreview(c.name || '見本', { bgColor: bg, textColor: tc, fontWeight: charaDefaults.fontWeight || 'bold', fontStyle: charaDefaults.fontStyle || 'normal', fontSize: charaDefaults.fontSize || null }, { bgTransform: bg, defaultTextColor: tcDisplay })}
        <input class="rules-chara-name" value="${esc(c.name)}" ${_rulesNamedChangeAttrs('rename-chara', 'chara', i)} aria-label="${_rulesAttrValue((c.name || 'キャラ') + ' 名前')}">
        <button type="button" class="rules-remove" ${_rulesNamedActionAttrs('remove-chara', 'chara', i)} aria-label="${_rulesAttrValue((c.name || 'キャラ') + 'を削除')}">${lucide('x', 12)}</button>
      </div>`;
    });
  }
  html += `<div class="rules-action-row">
    <input id="rules-new-chara" class="rules-input" placeholder="キャラ名..." aria-label="追加するキャラ名">
    <button type="button" class="rules-add-btn" ${_rulesNamedActionAttrs('add-chara', 'chara', 'new')}>追加</button>
    <button type="button" class="rules-secondary-btn" ${_rulesNamedActionAttrs('open-character-db-import', 'chara', 'db')} title="シートからキャラを読み込み">DB読込</button>
  </div>`;
  if (doc.characterDb && doc.characterDb.length > 0) {
    const avail = doc.characterDb.filter(name => !doc.characters.some(c => c.name === name));
    if (avail.length > 0) {
      html += '<div class="rules-db-caption">候補済みのDB名:</div><div class="rules-db-list">';
      avail.forEach(name => {
        html += `<label class="rules-db-label"><input type="checkbox" value="${esc(name)}" class="rules-db-check"><span>${esc(name)}</span></label>`;
      });
      html += `</div><button type="button" class="rules-secondary-btn rules-secondary-btn--stacked" ${_rulesNamedActionAttrs('add-checked-charas', 'chara', 'db')}>チェック分を追加</button>`;
    }
  }
  html += '</div>';

  html += '<div class="rules-section">';
  html += '<div class="rules-section-title">特殊キャラ設定</div>';
  html += '<div class="rules-section-help">ト書きやナレーションなど、シナリオ用の補助行候補です。</div>';
  SPECIAL_CHARA.forEach((sc, i) => {
    const style = _rulesEnsureSpecialStyle(sc);
    const bgCol = style.bgColor || '';
    const textCol = style.textColor || '';
    const isBold = style.fontWeight === 'bold';
    const isItalic = style.fontStyle === 'italic';
    const fSize = style.fontSize || '';
    html += `<div class="rules-chara-row" draggable="true" data-rules-type-kind="special" data-rules-type-idx="${i}" data-rules-drag-kind="special" data-rules-index="${i}">
      <span class="rules-drag-handle">⠿</span>
      <div class="rules-swatch" style="background:${_rulesGetSwatchBackground(bgCol, 'var(--bg3)')};${bgCol === 'transparent' ? 'background-size:8px 8px;background-position:0 0,4px 4px;' : ''}"
        ${_rulesNamedActionAttrs('pick-color', 'special', sc, { 'color-type': 'special-bg' })} role="button" tabindex="0" title="背景色" aria-label="${_rulesAttrValue(sc + ' 背景色')}"></div>
      <div class="rules-swatch rules-swatch-text" style="background:${_rulesGetSwatchBackground(textCol, 'var(--fg2)')};border:1px solid var(--border);${textCol === 'transparent' ? 'background-size:8px 8px;background-position:0 0,4px 4px;' : ''}"
        ${_rulesNamedActionAttrs('pick-color', 'special', sc, { 'color-type': 'special-text' })} role="button" tabindex="0" title="文字色" aria-label="${_rulesAttrValue(sc + ' 文字色')}"></div>
      ${_rulesRenderPreview(sc || '見本', style)}
      <button type="button" class="rules-font-btn rules-font-btn--bold${isBold?' active':''}" ${_rulesNamedActionAttrs('toggle-named-font', 'special', sc, { 'font-key': 'fontWeight' })} title="太字" aria-label="${_rulesAttrValue(sc + ' 太字')}">B</button>
      <button type="button" class="rules-font-btn rules-font-btn--italic${isItalic?' active':''}" ${_rulesNamedActionAttrs('toggle-named-font', 'special', sc, { 'font-key': 'fontStyle' })} title="斜体" aria-label="${_rulesAttrValue(sc + ' 斜体')}">I</button>
      <input type="number" class="rules-font-size" value="${fSize}" min="8" max="24" placeholder="${_rulesGetNamedFontPlaceholder('special', sc)}"
        ${_rulesNamedChangeAttrs('named-font-size', 'special', sc)} title="フォントサイズ(px)" aria-label="${_rulesAttrValue(sc + ' フォントサイズ')}">
      <span class="rules-type-label">${esc(sc)}</span>
      ${(bgCol || textCol || style.fontWeight || style.fontStyle || style.fontSize) ? `<button type="button" class="rules-clear" ${_rulesNamedActionAttrs('clear-named-style', 'special', sc)} title="モード既定に戻す" aria-label="${_rulesAttrValue(sc + 'をモード既定に戻す')}">↻</button>` : ''}
      <button type="button" class="rules-remove" ${_rulesNamedActionAttrs('delete-mode-type', 'special', sc)} title="削除" aria-label="${_rulesAttrValue(sc + 'を削除')}">${lucide('x', 12)}</button>
    </div>`;
  });
  html += `<div class="rules-action-row">
    <input id="rules-new-specialchara" class="rules-input rules-input--compact" placeholder="特殊キャラ名..." aria-label="追加する特殊キャラ名">
    <button type="button" class="rules-secondary-btn" ${_rulesNamedActionAttrs('add-custom-type', 'special', 'new')}>追加</button>
  </div>`;
  html += '</div>';

  html += '<div class="rules-section">';
  html += '<div class="rules-section-title">行タイプ設定</div>';
  html += '<div class="rules-section-help">柱や区切りなど、シナリオの段落種別候補です。色と書式に加えて接頭辞や区切り線も設定できます。</div>';
  PAGE_SETTINGS.forEach((ps, i) => {
    const style = _rulesEnsureRowTypeStyle(ps);
    const behavior = ensurePageSettingBehavior(ps);
    const bgCol = style.bgColor || '';
    const textCol = style.textColor || '';
    const isBold = style.fontWeight === 'bold';
    const isItalic = style.fontStyle === 'italic';
    const fSize = style.fontSize || '';
    html += `<div class="rules-page-block" draggable="true" data-rules-type-kind="page" data-rules-type-idx="${i}" data-rules-drag-kind="page" data-rules-index="${i}">
      <div class="rules-type-row rules-type-row--wrap">
        <span class="rules-drag-handle">⠿</span>
        <div class="rules-swatch" style="background:${_rulesGetSwatchBackground(bgCol, 'var(--bg3)')};${bgCol === 'transparent' ? 'background-size:8px 8px;background-position:0 0,4px 4px;' : ''}"
          ${_rulesNamedActionAttrs('pick-color', 'rowtype', ps, { 'color-type': 'rowtype-bg' })} role="button" tabindex="0" title="背景色" aria-label="${_rulesAttrValue(ps + ' 背景色')}"></div>
        <div class="rules-swatch rules-swatch-text" style="background:${_rulesGetSwatchBackground(textCol, 'var(--fg2)')};border:1px solid var(--border);${textCol === 'transparent' ? 'background-size:8px 8px;background-position:0 0,4px 4px;' : ''}"
          ${_rulesNamedActionAttrs('pick-color', 'rowtype', ps, { 'color-type': 'rowtype-text' })} role="button" tabindex="0" title="文字色" aria-label="${_rulesAttrValue(ps + ' 文字色')}"></div>
        ${_rulesRenderPreview(ps || '見本', style)}
        <button type="button" class="rules-font-btn rules-font-btn--bold${isBold?' active':''}" ${_rulesNamedActionAttrs('toggle-named-font', 'rowtype', ps, { 'font-key': 'fontWeight' })} title="太字" aria-label="${_rulesAttrValue(ps + ' 太字')}">B</button>
        <button type="button" class="rules-font-btn rules-font-btn--italic${isItalic?' active':''}" ${_rulesNamedActionAttrs('toggle-named-font', 'rowtype', ps, { 'font-key': 'fontStyle' })} title="斜体" aria-label="${_rulesAttrValue(ps + ' 斜体')}">I</button>
        <input type="number" class="rules-font-size" value="${fSize}" min="8" max="24" placeholder="${_rulesGetNamedFontPlaceholder('rowtype', ps)}"
          ${_rulesNamedChangeAttrs('named-font-size', 'rowtype', ps)} title="フォントサイズ(px)" aria-label="${_rulesAttrValue(ps + ' フォントサイズ')}">
        <span class="rules-type-label">${esc(ps)}</span>
        ${(bgCol || textCol || style.fontWeight || style.fontStyle || style.fontSize) ? `<button type="button" class="rules-clear" ${_rulesNamedActionAttrs('clear-named-style', 'rowtype', ps)} title="モード既定に戻す" aria-label="${_rulesAttrValue(ps + 'をモード既定に戻す')}">↻</button>` : ''}
        <button type="button" class="rules-remove" ${_rulesNamedActionAttrs('delete-mode-type', 'page', ps)} title="削除" aria-label="${_rulesAttrValue(ps + 'を削除')}">${lucide('x', 12)}</button>
      </div>
      <div class="rules-type-row rules-type-row--wrap rules-page-options">
        <select class="rules-page-select" ${_rulesNamedChangeAttrs('page-visual-style', 'page', ps)} aria-label="${_rulesAttrValue(ps + ' 表示スタイル')}">
          ${RULE_PAGE_VISUAL_STYLE_OPTIONS.map(opt => `<option value="${opt.value}"${behavior.visualStyle===opt.value?' selected':''}>${opt.label}</option>`).join('')}
        </select>
        <label class="rules-page-label">接頭辞
          <input class="rules-page-input rules-page-input--prefix" value="${esc(behavior.displayPrefix || '')}" ${_rulesNamedChangeAttrs('page-display-prefix', 'page', ps)}>
        </label>
        <label class="rules-page-label">区切り文字
          <input class="rules-page-input rules-page-input--separator" value="${esc(behavior.separatorText || '')}" ${_rulesNamedChangeAttrs('page-separator-text', 'page', ps)}>
        </label>
        <label class="rules-page-label rules-page-label--checkbox"><input type="checkbox" ${behavior.showBoundaryLine?'checked':''} ${_rulesNamedChangeAttrs('page-boundary-line', 'page', ps)}><span>区切り線</span></label>
      </div>
    </div>`;
  });
  html += `<div class="rules-action-row">
    <input id="rules-new-pagetype" class="rules-input rules-input--compact" placeholder="行タイプ名..." aria-label="追加する行タイプ名">
    <button type="button" class="rules-secondary-btn" ${_rulesNamedActionAttrs('add-custom-type', 'page', 'new')}>追加</button>
  </div>`;
  html += '</div>';

  el.innerHTML = html;
  _rulesBindStructuredHandlers(el);
}
