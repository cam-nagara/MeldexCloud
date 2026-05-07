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
      case 'toggle-named-font':
        if (typeof _rulesToggleNamedFont === 'function') _rulesToggleNamedFont(kind, name, target.dataset.rulesFontKey || '');
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

  el.addEventListener('change', (event) => {
    const target = event.target.closest('[data-rules-change]');
    if (!target || !el.contains(target)) return;
    const change = target.dataset.rulesChange || '';
    const kind = target.dataset.rulesKind || '';
    const name = target.dataset.rulesName || '';
    switch (change) {
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
    el.innerHTML = '<div style="color:var(--fg2);padding:16px;">シナリオファイルを開いてください</div>';
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
    el.innerHTML = '<div style="color:var(--fg2);padding:16px;">現行シナリオエディタのタイプ管理タブを使用してください</div>';
    return;
  }
  ensureScenarioSettings(doc);
  let html = '';

  html += '<div class="rules-section">';
  html += '<div class="rules-section-title">入力設定</div>';
  html += '<div class="rules-section-help">シナリオエディタで使う候補名と基本書式を設定します。ここではキャラ・特殊キャラ・行タイプだけを扱います。</div>';
  html += `<div class="rules-type-row" style="align-items:flex-start;">
    <span class="rules-type-label" style="min-width:72px;">現在の書式</span>
    <div style="font-size:12px;line-height:1.7;color:var(--fg2);">
      <div>シナリオ書式: <strong style="color:var(--fg);">${esc(getScenarioNoteLayoutLabel())}</strong></div>
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
  html += `<div class="rules-type-row rules-chara-global-row" style="flex-wrap:wrap;">
    <span class="rules-type-label" style="flex:0 0 auto;min-width:72px;">共通設定</span>
    <select class="rules-mini-select" data-onchange="_rulesSetCharaAutoColorTarget(this.value)" title="自動配色の適用先">
      <option value="bg"${globalAutoTarget==='bg' ? ' selected' : ''}>背景へ</option>
      <option value="text"${globalAutoTarget==='text' ? ' selected' : ''}>文字へ</option>
      <option value="none"${globalAutoTarget==='none' ? ' selected' : ''}>不使用</option>
    </select>
    <button class="rules-font-btn${globalBold?' active':''}" data-action="_rulesToggleCharaGlobalFont('fontWeight')" title="太字" style="font-weight:bold;font-size:11px;padding:0 4px;">B</button>
    <button class="rules-font-btn${globalItalic?' active':''}" data-action="_rulesToggleCharaGlobalFont('fontStyle')" title="斜体" style="font-style:italic;font-size:11px;padding:0 4px;">I</button>
    <input type="number" class="rules-font-size" value="${globalFontSize}" min="8" max="24" placeholder="${_rulesGetCharacterFontPlaceholder()}"
      data-onchange="_rulesSetCharaGlobalFontSize(this.value)" title="フォントサイズ(px)">
  </div>`;
  if (!doc.characters.length) {
    html += '<div style="color:var(--fg2);font-size:12px;padding:4px;">キャラなし</div>';
  } else {
    doc.characters.forEach((c, i) => {
      if (c.isDefault) return; // 役割空行用デフォルトタイプはこの一覧では非表示
      const bg = _rulesResolveCharaBgColor(c);
      const tc = _rulesResolveCharaTextColor(c);
      const tcDisplay = tc || (isLightTheme() ? '#333' : '#aaa');
      const bgClass = globalAutoTarget === 'bg' ? 'rules-swatch rules-swatch-auto' : 'rules-swatch';
      const textClass = globalAutoTarget === 'text' ? 'rules-swatch rules-swatch-text rules-swatch-auto' : 'rules-swatch rules-swatch-text';
      html += `<div class="rules-chara-row" draggable="true" data-rules-chara-idx="${i}"
        ondragstart="_rulesCharaDragStart(event,${i})" ondragover="_rulesCharaDragOver(event,${i})"
        ondrop="_rulesCharaDrop(event,${i})" ondragend="_rulesCharaDragEnd()">
        <span class="rules-drag-handle">⠿</span>
        <div class="${bgClass}" style="background:${_rulesGetSwatchBackground(bg, 'var(--bg3)')};${bg === 'transparent' ? 'background-size:8px 8px;background-position:0 0,4px 4px;' : ''}"
          data-action="_rulesPickColor('chara-bg',${i},this)" title="背景色"></div>
        <div class="${textClass}" style="background:${_rulesGetSwatchBackground(tcDisplay, 'var(--fg2)')};border:1px solid var(--border);${tcDisplay === 'transparent' ? 'background-size:8px 8px;background-position:0 0,4px 4px;' : ''}"
          data-action="_rulesPickColor('chara-text',${i},this)" title="文字色"></div>
        ${_rulesRenderPreview(c.name || '見本', { bgColor: bg, textColor: tc, fontWeight: charaDefaults.fontWeight || 'bold', fontStyle: charaDefaults.fontStyle || 'normal', fontSize: charaDefaults.fontSize || null }, { bgTransform: bg, defaultTextColor: tcDisplay })}
        <input class="rules-chara-name" value="${esc(c.name)}" data-onchange="_rulesRenameChara(${i},this.value)">
        <button class="rules-remove" data-action="_rulesRemoveChara(${i})">${lucide('x', 12)}</button>
      </div>`;
    });
  }
  html += `<div style="display:flex;gap:4px;padding:4px 0;">
    <input id="rules-new-chara" placeholder="キャラ名..." style="flex:1;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;padding:3px 6px;font-size:12px;">
    <button data-action="_rulesAddChara()" style="padding:3px 8px;background:var(--accent);color:var(--ui-fg-strong);border:1px solid var(--accent);border-radius:3px;cursor:pointer;font-size:12px;">追加</button>
    <button data-action="openScenarioCharacterDbImport()" style="padding:3px 8px;background:var(--bg3);color:var(--fg);border:1px solid var(--border);border-radius:3px;cursor:pointer;font-size:12px;" title="シートからキャラを読み込み">DB読込</button>
  </div>`;
  if (doc.characterDb && doc.characterDb.length > 0) {
    const avail = doc.characterDb.filter(name => !doc.characters.some(c => c.name === name));
    if (avail.length > 0) {
      html += '<div style="font-size:11px;color:var(--fg2);margin-top:4px;">候補済みのDB名:</div><div style="max-height:100px;overflow-y:auto;">';
      avail.forEach(name => {
        html += `<label style="display:flex;align-items:center;gap:4px;padding:1px 0;cursor:pointer;font-size:12px;"><input type="checkbox" value="${esc(name)}" class="rules-db-check"><span>${esc(name)}</span></label>`;
      });
      html += `</div><button data-action="_rulesAddCheckedCharas()" style="margin:4px 0;padding:2px 8px;background:var(--bg3);color:var(--fg);border:1px solid var(--border);border-radius:3px;cursor:pointer;font-size:11px;">チェック分を追加</button>`;
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
    html += `<div class="rules-chara-row" draggable="true" data-rules-type-kind="special" data-rules-type-idx="${i}"
      ondragstart="_rulesTypeDragStart(event,'special',${i})" ondragover="_rulesTypeDragOver(event,'special',${i})"
      ondrop="_rulesTypeDrop(event,'special',${i})" ondragend="_rulesTypeDragEnd()">
      <span class="rules-drag-handle">⠿</span>
      <div class="rules-swatch" style="background:${_rulesGetSwatchBackground(bgCol, 'var(--bg3)')};${bgCol === 'transparent' ? 'background-size:8px 8px;background-position:0 0,4px 4px;' : ''}"
        ${_rulesNamedActionAttrs('pick-color', 'special', sc, { 'color-type': 'special-bg' })} title="背景色"></div>
      <div class="rules-swatch rules-swatch-text" style="background:${_rulesGetSwatchBackground(textCol, 'var(--fg2)')};border:1px solid var(--border);${textCol === 'transparent' ? 'background-size:8px 8px;background-position:0 0,4px 4px;' : ''}"
        ${_rulesNamedActionAttrs('pick-color', 'special', sc, { 'color-type': 'special-text' })} title="文字色"></div>
      ${_rulesRenderPreview(sc || '見本', style)}
      <button class="rules-font-btn${isBold?' active':''}" ${_rulesNamedActionAttrs('toggle-named-font', 'special', sc, { 'font-key': 'fontWeight' })} title="太字" style="font-weight:bold;font-size:11px;padding:0 4px;">B</button>
      <button class="rules-font-btn${isItalic?' active':''}" ${_rulesNamedActionAttrs('toggle-named-font', 'special', sc, { 'font-key': 'fontStyle' })} title="斜体" style="font-style:italic;font-size:11px;padding:0 4px;">I</button>
      <input type="number" class="rules-font-size" value="${fSize}" min="8" max="24" placeholder="${_rulesGetNamedFontPlaceholder('special', sc)}"
        ${_rulesNamedChangeAttrs('named-font-size', 'special', sc)} title="フォントサイズ(px)">
      <span class="rules-type-label">${esc(sc)}</span>
      ${(bgCol || textCol || style.fontWeight || style.fontStyle || style.fontSize) ? `<button class="rules-clear" ${_rulesNamedActionAttrs('clear-named-style', 'special', sc)} title="モード既定に戻す">↻</button>` : ''}
      <button class="rules-remove" ${_rulesNamedActionAttrs('delete-mode-type', 'special', sc)} title="削除">${lucide('x', 12)}</button>
    </div>`;
  });
  html += `<div style="display:flex;gap:4px;padding:4px 0;">
    <input id="rules-new-specialchara" placeholder="特殊キャラ名..." style="flex:1;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;padding:2px 6px;font-size:11px;">
    <button data-action="_rulesAddCustomType('special')" style="padding:2px 6px;background:var(--bg3);color:var(--fg);border:1px solid var(--border);border-radius:3px;cursor:pointer;font-size:11px;">追加</button>
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
    html += `<div style="padding:3px 0;border-bottom:1px solid var(--border);" draggable="true" data-rules-type-kind="page" data-rules-type-idx="${i}"
      ondragstart="_rulesTypeDragStart(event,'page',${i})" ondragover="_rulesTypeDragOver(event,'page',${i})"
      ondrop="_rulesTypeDrop(event,'page',${i})" ondragend="_rulesTypeDragEnd()">
      <div class="rules-type-row" style="flex-wrap:wrap;">
        <span class="rules-drag-handle">⠿</span>
        <div class="rules-swatch" style="background:${_rulesGetSwatchBackground(bgCol, 'var(--bg3)')};${bgCol === 'transparent' ? 'background-size:8px 8px;background-position:0 0,4px 4px;' : ''}"
          ${_rulesNamedActionAttrs('pick-color', 'rowtype', ps, { 'color-type': 'rowtype-bg' })} title="背景色"></div>
        <div class="rules-swatch rules-swatch-text" style="background:${_rulesGetSwatchBackground(textCol, 'var(--fg2)')};border:1px solid var(--border);${textCol === 'transparent' ? 'background-size:8px 8px;background-position:0 0,4px 4px;' : ''}"
          ${_rulesNamedActionAttrs('pick-color', 'rowtype', ps, { 'color-type': 'rowtype-text' })} title="文字色"></div>
        ${_rulesRenderPreview(ps || '見本', style)}
        <button class="rules-font-btn${isBold?' active':''}" ${_rulesNamedActionAttrs('toggle-named-font', 'rowtype', ps, { 'font-key': 'fontWeight' })} title="太字" style="font-weight:bold;font-size:11px;padding:0 4px;">B</button>
        <button class="rules-font-btn${isItalic?' active':''}" ${_rulesNamedActionAttrs('toggle-named-font', 'rowtype', ps, { 'font-key': 'fontStyle' })} title="斜体" style="font-style:italic;font-size:11px;padding:0 4px;">I</button>
        <input type="number" class="rules-font-size" value="${fSize}" min="8" max="24" placeholder="${_rulesGetNamedFontPlaceholder('rowtype', ps)}"
          ${_rulesNamedChangeAttrs('named-font-size', 'rowtype', ps)} title="フォントサイズ(px)">
        <span class="rules-type-label">${esc(ps)}</span>
        ${(bgCol || textCol || style.fontWeight || style.fontStyle || style.fontSize) ? `<button class="rules-clear" ${_rulesNamedActionAttrs('clear-named-style', 'rowtype', ps)} title="モード既定に戻す">↻</button>` : ''}
        <button class="rules-remove" ${_rulesNamedActionAttrs('delete-mode-type', 'page', ps)} title="削除">${lucide('x', 12)}</button>
      </div>
      <div class="rules-type-row" style="padding-left:22px;flex-wrap:wrap;gap:6px;">
        <select ${_rulesNamedChangeAttrs('page-visual-style', 'page', ps)} style="background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;padding:2px 4px;font-size:11px;min-width:92px;">
          ${RULE_PAGE_VISUAL_STYLE_OPTIONS.map(opt => `<option value="${opt.value}"${behavior.visualStyle===opt.value?' selected':''}>${opt.label}</option>`).join('')}
        </select>
        <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--fg2);">接頭辞
          <input value="${esc(behavior.displayPrefix || '')}" ${_rulesNamedChangeAttrs('page-display-prefix', 'page', ps)} style="width:54px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;padding:2px 4px;font-size:11px;">
        </label>
        <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--fg2);">区切り文字
          <input value="${esc(behavior.separatorText || '')}" ${_rulesNamedChangeAttrs('page-separator-text', 'page', ps)} style="width:88px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;padding:2px 4px;font-size:11px;">
        </label>
        <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--fg2);"><input type="checkbox" ${behavior.showBoundaryLine?'checked':''} ${_rulesNamedChangeAttrs('page-boundary-line', 'page', ps)}><span>区切り線</span></label>
      </div>
    </div>`;
  });
  html += `<div style="display:flex;gap:4px;padding:4px 0;">
    <input id="rules-new-pagetype" placeholder="行タイプ名..." style="flex:1;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;padding:2px 6px;font-size:11px;">
    <button data-action="_rulesAddCustomType('page')" style="padding:2px 6px;background:var(--bg3);color:var(--fg);border:1px solid var(--border);border-radius:3px;cursor:pointer;font-size:11px;">追加</button>
  </div>`;
  html += '</div>';

  el.innerHTML = html;
  _rulesBindStructuredHandlers(el);
}
