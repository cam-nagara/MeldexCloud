/* gb-settings.part05.js: appearance tab theme editor integration */

function _settingsThemeAction(iconName, fallback, label, action, danger) {
  const icon = typeof lucide === 'function' ? lucide(iconName, 14) : fallback;
  return `<button type="button" class="bd-detail-style-action${danger ? ' bd-detail-style-action--danger' : ''}" data-action="${action}" title="${esc(label)}" aria-label="${esc(label)}">${icon}</button>`;
}

function _settingsThemeCommonFontValue() {
  const raw = document.documentElement.style.getPropertyValue('--ui-font')
    || getComputedStyle(document.documentElement).getPropertyValue('--ui-font')
    || '';
  return typeof normalizeFontFamilyValue === 'function' ? normalizeFontFamilyValue(raw) : raw.trim();
}

function _renderSettingsThemeCommonFontSection() {
  const options = typeof getUIFontOptions === 'function' ? getUIFontOptions() : '';
  return `<section class="gb-section gb-section--detail settings-theme-font-section">
    <div class="gb-section-title">共通フォント</div>
    <label class="gb-field-row">
      <span class="gb-label">フォント:</span>
      <select id="modal-font-family" class="gb-select" data-onchange="settingsThemeCommonFontChanged(this.value)" style="max-width:220px;">${options}</select>
    </label>
  </section>`;
}

function renderSettingsAppearancePanel(currentTheme, options = {}) {
  const themeOptions = typeof MeldexThemeManager !== 'undefined'
    ? MeldexThemeManager.themeOptionsHtml(currentTheme)
    : Object.keys(THEME_PRESETS).map(n => '<option value="' + esc(n) + '"' + (n === currentTheme ? ' selected' : '') + '>' + esc(n) + '</option>').join('');
  return `
    <section class="gb-section gb-section--boxed">
      <div class="gb-section-title">${lucide('palette', 14)} テーマ</div>
      <div class="gb-field-row" style="align-items:center;">
        <select id="modal-theme-preset" data-onchange="settingsThemeSelect(this.value)" class="gb-select" style="flex:1;min-width:180px;">
          ${themeOptions}
        </select>
        <span class="bd-detail-style-row" style="width:auto;flex:0 0 auto;">
          ${_settingsThemeAction('plus', '+', '新規カスタムテーマを作成', 'settingsThemeCreate()')}
          ${_settingsThemeAction('copy', '複製', '選択中テーマを複製', 'settingsThemeDuplicate()')}
          ${_settingsThemeAction('pencil', '名前', 'テーマ名を変更', 'settingsThemeRename()')}
          ${_settingsThemeAction('rotateCcw', '戻す', 'デフォルトに戻す', 'settingsThemeReset()')}
          ${_settingsThemeAction('save', '保存', 'デフォルトとして保存', 'settingsThemeSave()')}
          ${_settingsThemeAction('trash2', '削除', 'カスタムテーマを削除', 'settingsThemeDelete()', true)}
          ${_settingsThemeAction(typeof uiTransferIconName === 'function' ? uiTransferIconName('import') : 'download', '読込', 'テーマをインポート', 'settingsThemeImport()')}
          ${_settingsThemeAction(typeof uiTransferIconName === 'function' ? uiTransferIconName('export') : 'upload', '保存', 'テーマをエクスポート', 'settingsThemeExport()')}
        </span>
      </div>
      ${_renderSettingsThemeCommonFontSection()}
    </section>
    <section class="gb-section gb-section--boxed">
      <div class="gb-section-title">テーマカラー</div>
      ${typeof renderSettingsThemePaletteEditor === 'function' ? renderSettingsThemePaletteEditor() : renderThemeColorSetEditor(null, { hideLabel: true })}
    </section>
    <section class="gb-section gb-section--boxed">
      <div class="gb-section-title">テーマ設定</div>
      ${renderSettingsThemeEditor(options.activeStyleTab, {
        deferStyleRows: options.deferStyleRows,
        renderedStyleTab: options.renderedStyleTab,
      })}
    </section>`;
}

function ensureSettingsThemePanel(panel, options = {}) {
  const root = panel?.matches?.('.settings-panel[data-panel="テーマ"]')
    ? panel
    : panel?.querySelector?.('.settings-panel[data-panel="テーマ"]');
  if (!root) return;
  const selectedId = options.selectedId || root.dataset.settingsThemeSelectedId || _settingsThemeCurrentId();
  const activeStyleTab = options.activeStyleTab || root.dataset.settingsThemeActiveStyleTab || _settingsThemeActiveStyleTab(root);
  const hasRenderedStyleTab = Object.prototype.hasOwnProperty.call(options, 'renderedStyleTab');
  const renderedStyleTab = hasRenderedStyleTab
    ? String(options.renderedStyleTab || '')
    : (root.querySelector?.('[data-settings-theme-style-panel][data-settings-theme-style-rendered="1"]')?.dataset?.settingsThemeStylePanel || '');
  const hasDeferStyleRows = Object.prototype.hasOwnProperty.call(options, 'deferStyleRows');
  const deferStyleRows = options.deferStyleRows === true
    || (!hasDeferStyleRows && root.dataset.settingsThemeRendered !== '1' && !renderedStyleTab);
  if (options.force !== true && root.dataset.settingsThemeRendered === '1' && root.querySelector('#settings-theme-editor')) return;
  root.innerHTML = renderSettingsAppearancePanel(selectedId, {
    activeStyleTab,
    deferStyleRows,
    renderedStyleTab,
  });
  root.dataset.settingsThemeRendered = '1';
  root.dataset.settingsThemeSelectedId = selectedId || '';
  root.dataset.settingsThemeActiveStyleTab = activeStyleTab || '';
  bindSettingsThemePanel(root);
  if (typeof replaceIcons === 'function') replaceIcons(root);
}

function _settingsThemeCurrentId() {
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getDefaultThemeId === 'function') {
    return MeldexThemeManager.getDefaultThemeId();
  }
  return detectCurrentTheme();
}

function _settingsThemeCurrent() {
  if (typeof MeldexThemeManager === 'undefined') return null;
  return MeldexThemeManager.getThemeById(_settingsThemeCurrentId());
}

function _settingsThemeIsCustom(id) {
  if (typeof MeldexThemeManager === 'undefined') return false;
  const themeId = id || _settingsThemeCurrentId();
  return MeldexThemeManager.getCustomThemes().some(t => t.id === themeId);
}

const SETTINGS_THEME_STYLE_TABS = [
  '共通', 'フォルダ', 'ノート', 'シナリオ', 'シート', 'ボード', 'カレンダー',
  '補助パネル',
];
const SETTINGS_THEME_STYLE_AUTO_TARGETS = {
  'フォルダ': ['style-folder', 'folder-panel-folder'],
  'ノート': ['style-note', 'note-heading', 'note-toc-item'],
  'シナリオ': ['style-scriptnote', 'scriptnote-type-dialogue', 'scriptnote-type-action', 'scriptnote-type-heading', 'scriptnote-type-summary', 'scriptnote-type-break'],
  'シート': ['style-sheet'],
  'ボード': ['style-board'],
  'カレンダー': ['style-calendar'],
  '補助パネル': ['style-outliner', 'folder-tree-folder', 'style-preview', 'style-detail', 'style-chat', 'style-timer', 'style-history', 'style-annotation', 'style-search', 'style-version'],
};

function _settingsThemeStyleTabNames() {
  return SETTINGS_THEME_STYLE_TABS.filter(name => Array.isArray(UI_STYLE_SECTIONS?.[name]));
}

function _settingsThemeSubsection(title, body) {
  if (!body) return '';
  return `<section class="gb-section gb-section--detail settings-theme-subsection">
    <div class="gb-section-title">${esc(title)}</div>
    ${body}
  </section>`;
}

function _settingsThemePxValue(key, fallback) {
  const raw = getCssVar(key) || fallback || '';
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : parseFloat(fallback) || 0;
}

function _renderSettingsThemeNoteLayoutRows() {
  const margin = _settingsThemePxValue('--page-margin-x', '50px');
  const maxWidth = _settingsThemePxValue('--page-content-max-width', '1200px');
  return _settingsThemeSubsection('レイアウト', `<label class="gb-field-row settings-theme-note-layout-row">
    <span class="gb-label">左右余白</span>
    <input id="settings-note-margin-x" type="number" min="0" max="300" step="1" class="gb-input-sm settings-theme-note-margin-input" value="${esc(margin)}" data-onchange="settingsThemeNoteMarginChanged(this.value)">
    <span class="gb-label">px</span>
  </label>
  <label class="gb-field-row settings-theme-note-layout-row">
    <span class="gb-label">内容最大幅</span>
    <input id="settings-note-content-max-width" type="number" min="480" max="3200" step="10" class="gb-input-sm settings-theme-note-width-input" value="${esc(maxWidth)}" data-onchange="settingsThemeNoteContentMaxWidthChanged(this.value)">
    <span class="gb-label">px</span>
  </label>`);
}

function _renderSettingsThemeStyleAutoRows(name) {
  const targetIds = SETTINGS_THEME_STYLE_AUTO_TARGETS[name];
  if (!targetIds) return '';
  return _settingsThemeSubsection('テーマカラーの自動適用設定', renderThemeUiApplicationEditor({ hideLabel: true, targetIds, showReset: false }));
}

// 共通タブと重複するため、個別パネルタブから除外するラベル
const _COMMON_DUPLICATE_STYLE_LABELS = new Set(['カーソル', 'ホバー', '選択', 'テキスト選択']);

function _filterCommonDuplicates(defs, name) {
  if (!Array.isArray(defs)) return [];
  if (name === '共通') return defs;
  return defs.filter(d => !_COMMON_DUPLICATE_STYLE_LABELS.has(String(d?.label || '').trim()));
}

function _renderSettingsThemeBoardExtras() {
  const shadowRaw = (getCssVar('--bd-shadow') || '').trim();
  const shadowOn = shadowRaw !== '' && shadowRaw !== '0';
  const autoAlignRaw = (getCssVar('--bd-auto-align') || '').trim();
  // defaultOn: 値未設定時はオン扱い
  const autoAlignOn = autoAlignRaw !== '0';
  const fitRaw = (getCssVar('--bd-bg-image-fit') || '').trim() || 'contain';
  const fits = [
    ['contain', '全体表示'],
    ['cover', '埋める'],
    ['auto', '原寸'],
    ['repeat', 'タイル'],
    ['world', 'ボード連動'],
  ];
  const imageRaw = (getCssVar('--bd-bg-image') || '').trim();
  // /file-raw?path=... 形式なら path クエリをデコード、通常のパスなら末尾セグメントを取り出す
  const imageName = (() => {
    if (!imageRaw) return '';
    const match = imageRaw.match(/[?&]path=([^&]+)/);
    let decoded = match ? match[1] : imageRaw;
    try { decoded = decodeURIComponent(decoded); } catch {}
    return decoded.split(/[\\/]/).pop() || decoded;
  })();
  const scaleRaw = (getCssVar('--bd-bg-image-scale') || '').trim();
  const scaleVal = Number.isFinite(parseFloat(scaleRaw)) && parseFloat(scaleRaw) > 0 ? parseFloat(scaleRaw) : 1;
  const fitOptions = fits.map(([v, lbl]) =>
    `<option value="${esc(v)}"${v === fitRaw ? ' selected' : ''}>${esc(lbl)}</option>`).join('');
  const body = `
    <label class="gb-field-row">
      <span class="gb-label" style="min-width:100px;">影</span>
      <input type="checkbox" data-onchange="settingsThemeBoardToggleShadow(this)"${shadowOn ? ' checked' : ''}>
    </label>
    <label class="gb-field-row">
      <span class="gb-label" style="min-width:100px;">自動整列</span>
      <input type="checkbox" data-onchange="settingsThemeBoardToggleAutoAlign(this)"${autoAlignOn ? ' checked' : ''}>
    </label>
    <div class="gb-field-row" style="align-items:center;gap:6px;flex-wrap:wrap;">
      <span class="gb-label" style="min-width:100px;">背景画像</span>
      <button type="button" class="bd-detail-style-action" data-action="settingsThemeBoardChooseBgImage()" title="画像を選択">選択</button>
      <button type="button" class="bd-detail-style-action bd-detail-style-action--danger" data-action="settingsThemeBoardClearBgImage()" title="背景画像をクリア"${imageRaw ? '' : ' disabled'}>クリア</button>
      <span class="gb-section-desc" style="flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(imageRaw)}">${esc(imageName || '（未設定）')}</span>
    </div>
    <label class="gb-field-row">
      <span class="gb-label" style="min-width:100px;">画像表示</span>
      <select class="gb-select" data-onchange="settingsThemeBoardSetBgFit(this.value)" style="max-width:180px;">
        ${fitOptions}
      </select>
    </label>
    <label class="gb-field-row"${fitRaw === 'world' ? '' : ' hidden'}>
      <span class="gb-label" style="min-width:100px;">画像スケール</span>
      <input type="number" min="0.05" max="20" step="0.05" class="gb-input-sm" value="${esc(scaleVal)}" data-onchange="settingsThemeBoardSetBgScale(this.value)">
    </label>`;
  const html = _settingsThemeSubsection('ボード固有設定', body);
  // 再描画時に特定セクションを識別できるようマーカー属性を付ける
  return html.replace('<section class="gb-section gb-section--detail settings-theme-subsection"',
    '<section class="gb-section gb-section--detail settings-theme-subsection" data-settings-theme-board-extras="1"');
}

function _renderSettingsThemeStyleRows(name) {
  const defs = _filterCommonDuplicates(UI_STYLE_SECTIONS?.[name] || [], name);
  const styleRows = defs.map(d => renderStyleRow(d)).join('');
  const styleSection = _settingsThemeSubsection('書式設定', styleRows);
  if (name === '共通') {
    return _settingsThemeSubsection('テーマカラーの自動適用設定', renderThemeUiApplicationEditor({ hideLabel: true, group: 'ui' }))
      + styleSection;
  }
  const autoRows = _renderSettingsThemeStyleAutoRows(name);
  if (name === 'ノート') return autoRows + _renderSettingsThemeNoteLayoutRows() + styleSection;
  if (name === 'ボード') return autoRows + styleSection + _renderSettingsThemeBoardExtras();
  return autoRows + styleSection;
}

// ----- ボード固有設定のハンドラ（テーマタブ） -----
function _settingsThemeBoardReadonlyCheck(el) {
  if (typeof _settingsThemeIsReadonlyElement === 'function' && _settingsThemeIsReadonlyElement(el)) {
    if (typeof _settingsThemePromptDuplicateForEdit === 'function') _settingsThemePromptDuplicateForEdit();
    return true;
  }
  return false;
}

function _settingsThemeBoardSetVar(key, value) {
  if (value == null || value === '') document.documentElement.style.removeProperty(key);
  else document.documentElement.style.setProperty(key, String(value));
  if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
  if (typeof _bdApplyCurrentBoardBackground === 'function') _bdApplyCurrentBoardBackground();
}

function settingsThemeBoardToggleShadow(input) {
  if (_settingsThemeBoardReadonlyCheck(input)) { input.checked = !input.checked; return; }
  // '1'/'0' の2値で保存（saveColorSettings は空文字を保存しないため）。
  // bd._fileStyle 側は '1'/'' を使う既存仕様に注意。どちらも on=真、それ以外=偽で評価される。
  _settingsThemeBoardSetVar('--bd-shadow', input.checked ? '1' : '0');
  // キャンバスの bd-shadow-on クラスは bd._showShadow から付けられる。
  // ファイル側で明示指定 (キーが存在) されている場合はファイルを優先、未指定のみテーマ追従。
  if (typeof bd !== 'undefined' && (!bd._fileStyle || bd._fileStyle['--bd-shadow'] === undefined)) {
    bd._showShadow = !!input.checked;
    const canvas = document.getElementById('bd-canvas');
    if (canvas) canvas.classList.toggle('bd-shadow-on', !!input.checked);
  }
}

function settingsThemeBoardToggleAutoAlign(input) {
  if (_settingsThemeBoardReadonlyCheck(input)) { input.checked = !input.checked; return; }
  _settingsThemeBoardSetVar('--bd-auto-align', input.checked ? '1' : '0');
  // ファイル側が未設定のときはテーマに追従させる
  if (typeof bd !== 'undefined' && (!bd._fileStyle || bd._fileStyle['--bd-auto-align'] === undefined)) {
    bd.autoAlign = !!input.checked;
    if (bd.autoAlign && typeof _bdRelayoutAllStructureTrees === 'function') _bdRelayoutAllStructureTrees();
  }
}

function settingsThemeBoardSetBgFit(value) {
  const allowed = ['contain', 'cover', 'auto', 'repeat', 'world'];
  const next = allowed.includes(value) ? value : 'contain';
  _settingsThemeBoardSetVar('--bd-bg-image-fit', next);
  // スケール行の表示切替
  const panel = document.querySelector('[data-settings-theme-style-panel="ボード"]');
  if (panel) {
    const scaleRow = panel.querySelector('input[data-onchange^="settingsThemeBoardSetBgScale"]')?.closest('.gb-field-row');
    if (scaleRow) scaleRow.hidden = next !== 'world';
  }
}

function settingsThemeBoardSetBgScale(value) {
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) return;
  const clamped = Math.max(0.05, Math.min(20, n));
  _settingsThemeBoardSetVar('--bd-bg-image-scale', String(clamped));
}

function _settingsThemeIsImageFile(file) {
  if (!file) return false;
  const type = String(file.type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(String(file.name || ''));
}

function settingsThemeBoardChooseBgImage() {
  const panel = document.querySelector('[data-settings-theme-style-panel="ボード"]');
  if (panel && _settingsThemeBoardReadonlyCheck(panel)) return;
  if (typeof bd === 'undefined' || !bd?.path) {
    if (typeof showStatus === 'function') showStatus('ボードを開いてから背景画像を設定してください', true);
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (file) {
      if (!_settingsThemeIsImageFile(file)) {
        if (typeof showStatus === 'function') showStatus('画像ファイルを選択してください', true);
        input.remove();
        return;
      }
      try {
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve, reject) => {
          reader.onload = e => resolve(e.target.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const dir = (() => {
          const p = String(bd.path || '');
          const i = p.lastIndexOf('/');
          return i >= 0 ? p.substring(0, i) : '';
        })();
        const res = await apiFetch('/upload-file?path=' + encodeURIComponent(dir), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: dataUrl, filename: file.name || 'background.png' }),
        });
        if (!res?.ok || !res.path) throw new Error('upload failed');
        const url = API_BASE + '/file-raw?path=' + encodeURIComponent(res.path);
        _settingsThemeBoardSetVar('--bd-bg-image', url);
        // パネル再描画
        _settingsThemeRefreshBoardExtras();
        if (typeof showStatus === 'function') showStatus('背景画像を設定しました');
      } catch {
        if (typeof showStatus === 'function') showStatus('背景画像の設定に失敗しました', true);
      }
    }
    input.remove();
  });
  document.body.appendChild(input);
  input.click();
}

function settingsThemeBoardClearBgImage() {
  const panel = document.querySelector('[data-settings-theme-style-panel="ボード"]');
  if (panel && _settingsThemeBoardReadonlyCheck(panel)) return;
  _settingsThemeBoardSetVar('--bd-bg-image', '');
  _settingsThemeBoardSetVar('--bd-bg-image-scale', '');
  _settingsThemeRefreshBoardExtras();
}

function _settingsThemeRefreshBoardExtras() {
  const panel = document.querySelector('[data-settings-theme-style-panel="ボード"]');
  if (!panel) return;
  const section = panel.querySelector('[data-settings-theme-board-extras="1"]');
  if (!section) return;
  const next = _renderSettingsThemeBoardExtras();
  const tmp = document.createElement('div');
  tmp.innerHTML = next;
  const replacement = tmp.firstElementChild;
  if (replacement) section.replaceWith(replacement);
}

function _settingsThemeStylePanelPlaceholder(name) {
  return `<div class="gb-section-desc" data-settings-theme-style-placeholder="1">${esc(name)} の設定は対象を切り替えた時に読み込みます。</div>`;
}

function _renderSettingsThemeStyleTabs(activeStyleTab, options = {}) {
  const names = _settingsThemeStyleTabNames();
  const activeName = names.includes(activeStyleTab) ? activeStyleTab : names[0];
  const renderedStyleTab = activeName;
  const optionsHtml = names.map(name =>
    `<option value="${esc(name)}"${name === activeName ? ' selected' : ''}>${esc(name)}</option>`
  ).join('');
  const panels = names.map((name, idx) => `
    <div data-settings-theme-style-panel="${esc(name)}" data-settings-theme-style-rendered="${name === renderedStyleTab ? '1' : '0'}"${name === activeName ? '' : ' hidden'}>
      ${name === renderedStyleTab ? _renderSettingsThemeStyleRows(name) : (name === activeName ? _settingsThemeStylePanelPlaceholder(name) : '')}
    </div>`).join('');
  return `<label class="gb-field-row settings-theme-style-selector" style="align-items:center;margin-bottom:8px;">
    <span class="gb-label">対象:</span>
    <select class="gb-select" data-settings-theme-style-select data-onchange="switchSettingsThemeStyleTab(this)" style="max-width:240px;">${optionsHtml}</select>
  </label>${panels}`;
}

function renderSettingsThemeEditor(activeStyleTab, options = {}) {
  const theme = _settingsThemeCurrent();
  const builtIn = !!theme && !_settingsThemeIsCustom(theme.id);
  const rows = _renderSettingsThemeStyleTabs(activeStyleTab, options);
  return `<div id="settings-theme-editor" data-readonly="0" data-builtin="${builtIn ? '1' : '0'}" data-theme-id="${esc(theme?.id || '')}">${rows}</div>`;
}

function switchSettingsThemeStyleTab(btn) {
  const editor = btn?.closest?.('#settings-theme-editor');
  const name = btn?.dataset?.settingsThemeStyleTabBtn || btn?.value || '';
  if (!editor || !name) return;
  const select = editor.querySelector('[data-settings-theme-style-select]');
  if (select && select.value !== name) select.value = name;
  editor.querySelectorAll('[data-settings-theme-style-tab-btn]').forEach(tab => {
    const active = tab.dataset.settingsThemeStyleTabBtn === name;
    tab.classList.toggle('gb-inner-tab-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  let activePanel = null;
  editor.querySelectorAll('[data-settings-theme-style-panel]').forEach(panel => {
    const active = panel.dataset.settingsThemeStylePanel === name;
    panel.hidden = !active;
    if (active) activePanel = panel;
  });
  if (activePanel && activePanel.dataset.settingsThemeStyleRendered !== '1') {
    activePanel.innerHTML = _renderSettingsThemeStyleRows(name);
    activePanel.dataset.settingsThemeStyleRendered = '1';
    _bindSettingsThemeStylePanel(activePanel);
    if (typeof replaceIcons === 'function') replaceIcons(activePanel);
  }
  const themePanel = editor.closest('.settings-panel[data-panel="テーマ"]');
  if (themePanel) themePanel.dataset.settingsThemeActiveStyleTab = name;
}

function _bindSettingsThemeStylePanel(root) {
  if (!root || root.dataset.settingsThemeStyleBound === '1') return;
  if (root.querySelector?.('[data-settings-theme-style-placeholder="1"]')) return;
  if (root.dataset.settingsThemeStyleRendered === '0') return;
  root.dataset.settingsThemeStyleBound = '1';
  syncCsSwatches(root);
  syncThemeUiApplicationSelectors(root);
  bindThemeUiApplicationEditor(root);
}

function bindSettingsThemePanel(root) {
  const panel = root || document;
  const editor = panel.querySelector?.('#settings-theme-editor');
  if (!editor) return;
  const activeStylePanel = editor.querySelector('[data-settings-theme-style-panel]:not([hidden])');
  syncCsSwatches(editor);
  syncThemeColorSetSwatches(panel);
  if (typeof syncThemeOsAccentToggle === 'function') syncThemeOsAccentToggle(panel);
  // テーマカラーセクションはテーマ設定エディタの外側にあるため panel 単位でバインドする
  bindThemeColorSetEditor(panel);
  if (activeStylePanel) _bindSettingsThemeStylePanel(activeStylePanel);
  _settingsThemeRefreshActionStates(panel);
}

function settingsThemeApplyCommonFont(value, options = {}) {
  if (value == null) return _settingsThemeCommonFontValue();
  const family = typeof normalizeFontFamilyValue === 'function' ? normalizeFontFamilyValue(value) : String(value || '').trim();
  const current = _settingsThemeCommonFontValue();
  if (current === family) return family;
  if (family) document.documentElement.style.setProperty('--ui-font', family);
  else document.documentElement.style.removeProperty('--ui-font');
  const uiFont = document.getElementById('modal-font-family');
  if (uiFont) uiFont.value = family;
  try { loadGoogleFontForUI(family); } catch {}
  if (options.markDirty !== false && typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
  return family;
}

function settingsThemeCommonFontChanged(value) {
  settingsThemeApplyCommonFont(value);
}

function settingsThemeNoteMarginChanged(value) {
  let px = parseFloat(value);
  if (!Number.isFinite(px)) px = 50;
  px = Math.max(0, Math.min(300, px));
  document.documentElement.style.setProperty('--page-margin-x', px + 'px');
  if (typeof applyNoteMargin === 'function') applyNoteMargin();
  if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
  const input = document.getElementById('settings-note-margin-x');
  if (input) input.value = String(px);
}

function settingsThemeNoteContentMaxWidthChanged(value) {
  const px = typeof _clampNoteContentMaxWidth === 'function'
    ? _clampNoteContentMaxWidth(value)
    : Math.max(480, Math.min(3200, parseFloat(value) || 1200));
  document.documentElement.style.setProperty('--page-content-max-width', px + 'px');
  if (typeof applyNoteContentMaxWidth === 'function') applyNoteContentMaxWidth(px);
  if (typeof _settingsThemeMarkDirty === 'function') _settingsThemeMarkDirty();
  const input = document.getElementById('settings-note-content-max-width');
  if (input) input.value = String(px);
}

function _settingsThemeRefreshActionStates(root) {
  const custom = _settingsThemeIsCustom();
  const setDisabled = (action, disabled) => {
    (root || document).querySelectorAll(`[data-action="${action}"]`).forEach(btn => { btn.disabled = disabled; });
  };
  setDisabled('settingsThemeRename()', !custom);
  setDisabled('settingsThemeSave()', !custom);
  setDisabled('settingsThemeDelete()', !custom);
}

function _settingsThemeRun(message, fn) {
  try {
    return fn();
  } catch (err) {
    console.warn('[settings theme]', message, err);
    showStatus(message + (err?.message ? ': ' + err.message : ''), true);
    return undefined;
  }
}

function _settingsThemeActiveStyleTab(root) {
  const select = (root || document).querySelector?.('[data-settings-theme-style-select]');
  if (select?.value) return select.value;
  const active = (root || document).querySelector?.('[data-settings-theme-style-tab-btn].gb-inner-tab-active');
  return active?.dataset?.settingsThemeStyleTabBtn || '';
}

function _refreshSettingsThemePanel(selectedId, options = {}) {
  const panel = document.querySelector('.settings-panel[data-panel="テーマ"]') || document.querySelector('.settings-panel[data-panel="外観"]');
  if (!panel) return;
  const activeStyleTab = options.activeStyleTab || panel.dataset.settingsThemeActiveStyleTab || _settingsThemeActiveStyleTab(panel);
  const activePanel = Array.from(panel.querySelectorAll?.('[data-settings-theme-style-panel]') || [])
    .find(candidate => candidate.dataset.settingsThemeStylePanel === activeStyleTab);
  const activeRendered = activePanel?.dataset?.settingsThemeStyleRendered === '1';
  ensureSettingsThemePanel(panel, {
    force: true,
    selectedId: selectedId || _settingsThemeCurrentId(),
    activeStyleTab,
    deferStyleRows: !activeRendered,
    renderedStyleTab: activeRendered ? activeStyleTab : '',
  });
}

function _settingsThemeIsReadonlyElement(el) {
  const editor = el?.closest?.('#settings-theme-editor') || document.querySelector('#settings-theme-editor');
  return editor?.dataset.readonly === '1';
}

async function _settingsThemePromptDuplicateForEdit() {
  if (!await cfConfirm('組み込みテーマには上書き保存できません。複製して保存しますか？')) return null;
  return settingsThemeDuplicate(true);
}

function settingsThemeSelect(id) {
  if (!id) return;
  const activeStyleTab = _settingsThemeActiveStyleTab(document);
  applyThemePreset(id);
  if (typeof _settingsThemeSetDirty === 'function') _settingsThemeSetDirty(false);
  _refreshSettingsThemePanel(id, { activeStyleTab });
}

async function settingsThemeCreate(options = {}) {
  if (typeof MeldexThemeManager === 'undefined') return false;
  const opts = options && typeof options === 'object' ? options : {};
  const name = await cfPrompt('カスタムテーマ名', opts.defaultName || 'カスタムテーマ');
  if (name === null) return false;
  const theme = _settingsThemeRun('カスタムテーマを作成できませんでした', () => MeldexThemeManager.createCustomThemeFromCurrent(name));
  if (theme === undefined) return false;
  if (!theme) { showStatus('テーマ名を入力してください', true); return false; }
  MeldexThemeManager.applyDefaultTheme(theme.id, { silent: true, resetThemeColorSet: false });
  if (typeof _settingsThemeSetDirty === 'function') _settingsThemeSetDirty(false);
  if (!opts.skipRefresh) _refreshSettingsThemePanel(theme.id);
  if (!opts.silent) showStatus('カスタムテーマを作成しました');
  return theme;
}

async function settingsThemeDuplicate(autoName) {
  if (typeof MeldexThemeManager === 'undefined') return null;
  const source = _settingsThemeCurrent();
  if (!source) return null;
  let name = `${source.name} コピー`;
  if (!autoName) {
    const input = await cfPrompt('複製後のテーマ名', name);
    if (input === null) return null;
    name = input;
  }
  const theme = _settingsThemeRun('カスタムテーマを複製できませんでした', () => MeldexThemeManager.createCustomThemeFromTheme(source.id, name));
  if (!theme) return null;
  MeldexThemeManager.applyDefaultTheme(theme.id, { silent: true, resetThemeColorSet: false });
  if (typeof _settingsThemeSetDirty === 'function') _settingsThemeSetDirty(false);
  _refreshSettingsThemePanel(theme.id);
  showStatus('カスタムテーマを複製しました');
  return theme;
}

async function settingsThemeRename() {
  if (typeof MeldexThemeManager === 'undefined') return;
  const id = _settingsThemeCurrentId();
  const theme = MeldexThemeManager.getCustomThemes().find(t => t.id === id);
  if (!theme) { showStatus('組み込みテーマは名前を変更できません', true); return; }
  const name = await cfPrompt('テーマ名', theme.name);
  if (name === null) return;
  const renamed = _settingsThemeRun('テーマ名を変更できませんでした', () => MeldexThemeManager.renameCustomTheme(id, name));
  if (renamed === undefined) return;
  if (!renamed) { showStatus('テーマ名を入力してください', true); return; }
  _refreshSettingsThemePanel(renamed.id);
}

function settingsThemeReset() {
  if (typeof MeldexThemeManager === 'undefined') return;
  const id = _settingsThemeCurrentId();
  if (typeof THEME_COLOR_SLOT_SETTINGS_KEY !== 'undefined') localStorage.removeItem(THEME_COLOR_SLOT_SETTINGS_KEY);
  if (typeof THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY !== 'undefined') localStorage.removeItem(THEME_COLOR_EXTRA_SLOT_SETTINGS_KEY);
  MeldexThemeManager.applyDefaultTheme(id, { silent: true, resetThemeColorSet: true });
  if (typeof _settingsThemeSetDirty === 'function') _settingsThemeSetDirty(false);
  _refreshSettingsThemePanel(id);
  showStatus('デフォルトに戻しました');
}

function settingsThemeSave(options = {}) {
  if (typeof MeldexThemeManager === 'undefined') return false;
  const opts = options && typeof options === 'object' ? options : {};
  const id = _settingsThemeCurrentId();
  if (!_settingsThemeIsCustom(id)) {
    showStatus('組み込みテーマはデフォルトとして保存できません。新規カスタムテーマを作成してください', true);
    return false;
  }
  const saved = _settingsThemeRun('デフォルトとして保存できませんでした', () => MeldexThemeManager.updateCustomThemeFromCurrent(id));
  if (saved === undefined) return false;
  if (!saved) { showStatus('デフォルトとして保存できませんでした', true); return false; }
  try { localStorage.removeItem(MeldexThemeManager.THEME_COLOR_SET_KEY); } catch {}
  if (typeof _settingsThemeSetDirty === 'function') _settingsThemeSetDirty(false);
  if (!opts.skipRefresh) _refreshSettingsThemePanel(saved.id);
  if (!opts.silent) showStatus('デフォルトとして保存しました', false, { showSaveDialog: true });
  return true;
}

async function settingsThemeSaveFromSettingsDialog(options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  if (typeof _settingsThemeIsDirty === 'function' && !_settingsThemeIsDirty()) return true;
  if (typeof MeldexThemeManager === 'undefined') return true;
  if (_settingsThemeIsCustom()) return settingsThemeSave({ silent: true, skipRefresh: !!opts.skipRefresh });
  const current = _settingsThemeCurrent();
  const created = await settingsThemeCreate({
    silent: true,
    skipRefresh: !!opts.skipRefresh,
    defaultName: `${current?.name || 'テーマ'} カスタム`,
  });
  return !!created;
}

async function settingsThemeDelete() {
  if (typeof MeldexThemeManager === 'undefined') return;
  const id = _settingsThemeCurrentId();
  const theme = MeldexThemeManager.getCustomThemes().find(t => t.id === id);
  if (!theme) { showStatus('削除できるカスタムテーマが選択されていません', true); return; }
  if (!await cfConfirm('カスタムテーマ「' + theme.name + '」を削除しますか？')) return;
  if (!_settingsThemeRun('カスタムテーマを削除できませんでした', () => MeldexThemeManager.deleteCustomTheme(id))) return;
  MeldexThemeManager.applyDefaultTheme('builtin-dark', { silent: true, resetThemeColorSet: true });
  if (typeof _settingsThemeSetDirty === 'function') _settingsThemeSetDirty(false);
  _refreshSettingsThemePanel('builtin-dark');
  showStatus('カスタムテーマを削除しました');
}

function settingsThemeExport() {
  if (typeof MeldexThemeManager === 'undefined') return;
  const theme = MeldexThemeManager.getThemeById(_settingsThemeCurrentId());
  const payload = { _type: 'meldex-theme', _version: 5, theme };
  if (typeof MeldexThemeManager.getUseOsAccentColor === 'function') {
    payload.useOsAccentColor = MeldexThemeManager.getUseOsAccentColor();
    if (typeof MeldexThemeManager.setThemeOsAccentOnTheme === 'function') {
      MeldexThemeManager.setThemeOsAccentOnTheme(theme, payload.useOsAccentColor);
    }
  }
  if (typeof getStandardPaletteAdjust === 'function' && typeof MeldexThemeManager.setThemeStandardPaletteAdjustOnTheme === 'function') {
    MeldexThemeManager.setThemeStandardPaletteAdjustOnTheme(theme, getStandardPaletteAdjust());
  }
  if (typeof getThemeColorSlotSettings === 'function' && typeof MeldexThemeManager.setThemeColorSlotSettingsOnTheme === 'function') {
    MeldexThemeManager.setThemeColorSlotSettingsOnTheme(theme, getThemeColorSlotSettings());
  }
  if (typeof getThemeColorExtraSlotSettings === 'function' && typeof MeldexThemeManager.setThemeColorExtraSlotSettingsOnTheme === 'function') {
    MeldexThemeManager.setThemeColorExtraSlotSettingsOnTheme(theme, getThemeColorExtraSlotSettings());
  }
  if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveText !== 'function') {
    showStatus('保存ダイアログを初期化できませんでした', true);
    return;
  }
  MeldexExportSave.saveText(JSON.stringify(payload, null, 2), {
    filename: _settingsThemeExportFilename(theme),
    extension: '.json',
    dialogTitle: 'テーマとして保存',
    filetypes: [['JSONファイル', '*.json'], ['すべてのファイル', '*.*']],
    okMessage: 'テーマを保存しました',
    errorMessage: 'テーマの保存に失敗しました',
  });
}

function _settingsThemeExportFilename(theme) {
  const raw = String(theme?.name || theme?.id || 'テーマ').trim() || 'テーマ';
  const safe = raw.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'テーマ';
  return `Meldex_${safe}_テーマ.json`;
}

function _settingsThemeImportPayload(payload) {
  if (typeof MeldexThemeManager === 'undefined') return null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (payload._type !== 'meldex-theme') return null;
  let imported = null;
  const importThemes = Array.isArray(payload.customThemes) ? payload.customThemes : [payload.theme];
  const validThemes = importThemes.filter(_settingsThemeLooksLikeTheme);
  if (!validThemes.length || validThemes.length !== importThemes.length) return null;
  const withPayloadSettings = theme => {
    if (!theme || typeof theme !== 'object') return theme;
    const next = { ...theme, ui: { ...(theme.ui || {}) } };
    if (Object.prototype.hasOwnProperty.call(payload || {}, 'useOsAccentColor')) {
      next.ui.useOsAccentColor = !!payload.useOsAccentColor;
    }
    return next;
  };
  if (Object.prototype.hasOwnProperty.call(payload || {}, 'useOsAccentColor') && typeof MeldexThemeManager.setUseOsAccentColor === 'function') {
    MeldexThemeManager.setUseOsAccentColor(!!payload.useOsAccentColor);
  }
  validThemes.forEach(theme => { imported = MeldexThemeManager.importCustomTheme(withPayloadSettings(theme)); });
  if (imported) {
    MeldexThemeManager.applyDefaultTheme(imported.id, { silent: true, resetThemeColorSet: false });
    if (typeof _settingsThemeSetDirty === 'function') _settingsThemeSetDirty(false);
  }
  return imported;
}

function _settingsThemeLooksLikeTheme(theme) {
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) return false;
  const hasName = typeof theme.name === 'string' && theme.name.trim();
  const hasId = typeof theme.id === 'string' && theme.id.trim();
  const hasUi = theme.ui && typeof theme.ui === 'object' && !Array.isArray(theme.ui);
  const hasCssVars = theme.cssVars && typeof theme.cssVars === 'object' && !Array.isArray(theme.cssVars);
  const hasColorSet = Array.isArray(theme.themeColorSet);
  const hasColorSlots = Array.isArray(theme.themeColorSlotSettings);
  return !!((hasName || hasId) && (hasUi || hasCssVars || hasColorSet || hasColorSlots));
}

function settingsThemeImport() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,application/json';
  inp.onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => {
      try {
        const imported = _settingsThemeImportPayload(JSON.parse(ev.target.result));
        if (!imported) throw new Error('テーマが見つかりません');
        _refreshSettingsThemePanel(imported.id);
        showStatus('テーマを読み込みました');
      } catch (err) {
        showStatus('テーマ読み込み失敗: ' + err.message, true);
      }
    };
    r.readAsText(f, 'UTF-8');
  };
  inp.click();
}
