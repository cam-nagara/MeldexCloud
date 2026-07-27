/* gb-detail-panel.part01.js */
/**
 * Meldex Detail Panel
 * 詳細パネル、分割ビュー、カレンダーフォーム
 */

// ==============================
// 詳細パネル タブ切替（gb-scenario-rules.js から移設）
// ==============================
let _currentDetailTab = null;

function _normalizeDetailTab(tab) {
  const validTabs = new Set([
    'note-editor',
    'db-property-settings',
    'calendar-today',
    'calendar-settings',
    'calendar-production',
    'board-card',
    'board-line',
    'board-note',
    'board-card-style',
    'board-line-style',
    'board-depth-style',
    'backlinks',
    'publish',
    'sn2-main',
    'sn2-roles',
    'sn2-theme',
    'sn2-ruby',
    'sn2-rowset',
    'file-style',
  ]);
  return validTabs.has(tab) ? tab : null;
}

// 作業パネル再アクティブ時、ユーザーが選んでいた詳細タブ (file-style / backlinks や
// 対象タイプの主要タブ) を保持する。互換性が無い場合のみ defaultTab にフォールバック。
function _resolveDetailTabForType(type, defaultTab) {
  const cur = (typeof _currentDetailTab !== 'undefined') ? _currentDetailTab : null;
  if (cur === 'file-style') return cur;
  const backlinksTypes = new Set(['page', 'database', 'board']);
  if (cur === 'backlinks' && backlinksTypes.has(type)) return cur;
  const publishTypes = new Set(['page', 'database', 'calendar', 'csv', 'smart-db', 'scriptnote']);
  if (cur === 'publish' && publishTypes.has(type)) return cur;
  const compatible = {
    page: ['note-editor', 'publish'],
    folder: ['note-editor'],
    database: ['db-property-settings', 'publish'],
    board: ['board-card', 'board-line', 'board-note', 'board-card-style', 'board-line-style', 'board-depth-style'],
    calendar: ['calendar-today', 'calendar-settings', 'calendar-production', 'publish'],
    csv: ['publish'],
    'smart-db': ['publish'],
    scriptnote: ['sn2-main', 'sn2-roles', 'sn2-theme', 'sn2-ruby', 'sn2-rowset', 'publish'],
  };
  const valid = compatible[type] || [];
  if (valid.includes(cur)) return cur;
  return defaultTab;
}

function switchDetailTab(tab) {
  tab = _normalizeDetailTab(tab);
  _currentDetailTab = tab;
  const bar = document.getElementById('detail-tab-bar');
  if (!bar) return;
  bar.querySelectorAll('.gb-inner-tab, .detail-tab').forEach(t => {
    const tabId = t.dataset.detailTab || '';
    const active = !t.hidden && t.dataset.detailTab === tab;
    if (tabId) {
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-controls', _detailTabPanelId(tabId));
      if (!t.dataset.e2eId) t.dataset.e2eId = 'detail-tab-' + tabId;
    }
    t.classList.toggle('gb-inner-tab-active', active);
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', active ? 'true' : 'false');
    // 旧経路 (_applyScopedDetailTab) が付与したインライン style を除去
    t.style.borderBottomColor = '';
    t.style.color = '';
    t.style.fontWeight = '';
  });
  ['note-editor', 'db-property-settings', 'sn2-main', 'calendar-today', 'calendar-settings', 'calendar-production', 'board-card', 'board-line', 'board-note', 'board-card-style', 'board-line-style', 'board-depth-style', 'file-style', 'backlinks', 'publish'].forEach(id => {
    const el = document.getElementById('detail-tab-' + id);
    if (!el) return;
    // 台本タブ(sn2-*)は共通コンテナ detail-tab-sn2-main を使用
    const isSn2 = tab && tab.startsWith('sn2-');
    const show = id === tab || (id === 'sn2-main' && isSn2);
    el.hidden = !show;
    // 旧経路の style.display 残留をクリア
    el.style.display = '';
  });
  // 空状態プレースホルダー: どのタブもアクティブでない場合のみ表示
  const emptyEl = document.getElementById('detail-tab-empty');
  if (emptyEl) emptyEl.hidden = !!tab;
  // §12.5 バックリンク: タブに切り替わった瞬間に現在のエントリで一覧取得
  if (tab === 'backlinks' && window.GbBacklinks) {
    const container = document.getElementById('detail-tab-backlinks');
    const s = (typeof state !== 'undefined') ? state : null;
    const path = (s && (s.currentEntityPath || s.currentPagePath || s.currentFilePath)) || '';
    window.GbBacklinks.render(path, container);
  }
  if (tab === 'publish' && typeof renderPublishDetailTab === 'function') {
    renderPublishDetailTab();
  }
  try {
    document.dispatchEvent(new CustomEvent('meldex:detail-tab-switched', { detail: { tab } }));
  } catch {}
}

// ==============================
// 詳細パネル（独立パネル、位置選択可能）
// ==============================
function _getDetailPanelCfg() {
  try { return JSON.parse(localStorage.getItem('detail-panel-cfg') || '{}'); } catch { return {}; }
}
function _saveDetailPanelCfg(cfg) {
  localStorage.setItem('detail-panel-cfg', JSON.stringify(cfg));
}

function _detailPanelEl(pos) { return document.getElementById('detail-panel-' + pos); }

function _detailTabPanelId(tab) {
  return tab && String(tab).startsWith('sn2-') ? 'detail-tab-sn2-main' : 'detail-tab-' + tab;
}

function _detailTabButtonHtml(tab, className, label) {
  return `<button type="button" role="tab" class="gb-inner-tab detail-tab ${className}" data-detail-tab="${tab}" hidden data-e2e-id="detail-tab-${tab}" aria-selected="false" aria-controls="${_detailTabPanelId(tab)}" data-action="switchDetailTab('${tab}')">${label}</button>`;
}

function _detailTabShellHtml() {
  return `
    <nav id="detail-tab-bar" class="gb-tabbar" role="tablist" aria-label="オプションパネルのタブ">
      ${_detailTabButtonHtml('note-editor', 'detail-tab-note-editor', '情報')}
      ${_detailTabButtonHtml('db-property-settings', 'detail-tab-db-property-settings', '列設定')}
      ${_detailTabButtonHtml('calendar-today', 'detail-tab-calendar', '今日')}
      ${_detailTabButtonHtml('calendar-settings', 'detail-tab-calendar detail-tab-calendar-settings', 'スケジュール設定')}
      ${_detailTabButtonHtml('calendar-production', 'detail-tab-calendar detail-tab-calendar-production', '制作管理')}
      ${_detailTabButtonHtml('board-card', 'detail-tab-board detail-tab-board-card', 'カード')}
      ${_detailTabButtonHtml('board-line', 'detail-tab-board detail-tab-board-line', 'ライン')}
      ${_detailTabButtonHtml('board-note', 'detail-tab-board-note', 'ノート')}
      ${_detailTabButtonHtml('file-style', 'detail-tab-file-style', 'テーマ')}
      ${_detailTabButtonHtml('publish', 'detail-tab-publish', '公開')}
      ${_detailTabButtonHtml('board-card-style', 'detail-tab-board-style detail-tab-board-card-style', 'カードスタイル')}
      ${_detailTabButtonHtml('board-line-style', 'detail-tab-board-style detail-tab-board-line-style', 'ラインスタイル')}
      ${_detailTabButtonHtml('board-depth-style', 'detail-tab-board-style detail-tab-board-depth-style', '階層別スタイル')}
      ${_detailTabButtonHtml('backlinks', 'detail-tab-backlinks', 'バックリンク')}
    </nav>
    <div id="detail-tab-note-editor" class="gb-panel-body" hidden></div>
    <div id="detail-tab-db-property-settings" class="gb-panel-body-scroll" hidden></div>
    <div id="detail-tab-sn2-main" class="gb-panel-body" hidden></div>
    <div id="detail-tab-calendar-today" class="gb-panel-body-scroll" hidden></div>
    <div id="detail-tab-calendar-settings" class="gb-panel-body-scroll" hidden></div>
    <div id="detail-tab-calendar-production" class="gb-panel-body-scroll" hidden></div>
    <div id="detail-tab-board-card" class="gb-panel-body-scroll" hidden></div>
    <div id="detail-tab-board-line" class="gb-panel-body-scroll" hidden></div>
    <div id="detail-tab-board-card-style" class="gb-panel-body-scroll" hidden></div>
    <div id="detail-tab-board-line-style" class="gb-panel-body-scroll" hidden></div>
    <div id="detail-tab-board-depth-style" class="gb-panel-body-scroll" hidden></div>
    <div id="detail-tab-board-note" class="gb-panel-body" hidden>
      <div id="board-note-editable" class="gb-contenteditable-body" contenteditable="true"></div>
    </div>
    <div id="detail-tab-file-style" class="gb-panel-body-scroll" hidden></div>
    <div id="detail-tab-backlinks" class="gb-panel-body-scroll" hidden></div>
    <div id="detail-tab-publish" class="gb-panel-body-scroll" hidden></div>
    <div id="detail-tab-empty" class="gb-empty-placeholder">選択中の項目がありません</div>`;
}

function _ensureDetailTabShell(el) {
  if (!el || el.id !== 'rp-detail') return;
  const existingBar = el.querySelector('#detail-tab-bar');
  if (existingBar) {
    if (window.GBDetailTabDnd?.bind) window.GBDetailTabDnd.bind(existingBar);
    return;
  }
  el.innerHTML = _detailTabShellHtml();
  const bar = el.querySelector('#detail-tab-bar');
  if (window.GBDetailTabDnd?.bind) window.GBDetailTabDnd.bind(bar);
}

function _openDetailRightPanel() {
  const rpDetail = document.getElementById('rp-detail');
  if (!rpDetail) return false;
  _ensureDetailTabShell(rpDetail);
  const cfg = _getDetailPanelCfg();
  cfg.visible = true;
  _saveDetailPanelCfg(cfg);
  if (typeof openRightPanelTab === 'function') openRightPanelTab('detail');
  else if (typeof switchRightTab === 'function') switchRightTab('detail');
  return true;
}

// v5.0: ペインシステムの#rp-detailを優先し、なければ旧detail-panelにフォールバック
function _resolveDetailEl(opts) {
  if (opts && opts.modal) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.dataset.e2eId = 'detail-legacy-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.dataset.e2eId = 'detail-legacy-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'オプション');
    modal.tabIndex = -1;
    modal.style.cssText = 'min-width:400px;max-height:80vh;overflow-y:auto;display:flex;flex-direction:column;';
    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    return modal;
  }
  const rpDetail = document.getElementById('rp-detail');
  if (rpDetail) _ensureDetailTabShell(rpDetail);
  if (rpDetail && !opts?.legacyPanel) return rpDetail;
  const cfg = _getDetailPanelCfg();
  const pos = cfg.position || 'right';
  cfg.visible = true;
  _saveDetailPanelCfg(cfg);
  const el = _detailPanelEl(pos);
  if (el) return el;
  return null;
}

async function showDetailPanel(contentHtml) {
  const el = _resolveDetailEl();
  if (!el) return;
  _ensureDetailTabShell(el);
  // #rp-detail にタブ構造がある場合はエディタタブの中身だけ書き換え
  const noteEditor = el.querySelector('#detail-tab-note-editor');
  if (noteEditor) {
    if (!await _dpSavePending()) return;
    if (typeof showDbTabs === 'function') showDbTabs(false);
    if (typeof showNoteTabs === 'function') showNoteTabs(true);
    if (typeof switchDetailTab === 'function') {
      switchDetailTab(_resolveDetailTabForType('page', 'note-editor'));
    }
    // 残留 dp-editable を削除（自動保存タイマーもクリア）
    _removeStaleDpEditables(el);
    noteEditor.innerHTML = '';
    const body = document.createElement('div');
    // gap なしで content をそのまま流す (gb-panel-body-scroll は Section 用で gap あり)
    body.style.cssText = 'flex:1;overflow-y:auto;padding:var(--ui-space-4);min-height:0;';
    body.innerHTML = contentHtml;
    noteEditor.appendChild(body);
    return;
  }
  // 旧レイアウト（タブなし）
  if (!await _dpSavePending()) return;
  _removeStaleDpEditables(el);
  el.innerHTML = '';
  const cfg = _getDetailPanelCfg();
  const pos = cfg.position || 'right';
  // ヘッダー（位置変更ボタン+閉じるボタン）
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;padding:4px 8px;border-bottom:1px solid var(--border);flex-shrink:0;gap:4px;';
  header.innerHTML = `<span style="font-size:12px;font-weight:bold;flex:1;">オプション</span>
    <button type="button" class="gb-btn gb-btn-xs gb-btn-icon" data-action="_hideDetailPanel()" aria-label="オプションパネルを閉じる" title="閉じる" data-e2e-id="legacy-detail-panel-close">${lucide('x', 12)}</button>`;
  el.appendChild(header);
  // コンテンツ
  const body = document.createElement('div');
  body.style.cssText = 'flex:1;overflow-y:auto;padding:8px;';
  body.innerHTML = contentHtml;
  el.appendChild(body);
}

function _hideDetailPanel() {
  const cfg = _getDetailPanelCfg();
  cfg.visible = false;
  _saveDetailPanelCfg(cfg);
  ['top','bottom','left','right'].forEach(p => { const el = _detailPanelEl(p); if (el) el.style.display = 'none'; });
  // v5.0: モーダルオーバーレイで表示された場合はモーダルを閉じる
  const modals = document.querySelectorAll('.modal-overlay');
  modals.forEach(m => { if (m.querySelector('#dp-cal-title')) m.remove(); });
}

function toggleOptionPanel() {
  const rpDetail = document.getElementById('rp-detail');
  if (rpDetail && typeof toggleRightPanelTab === 'function') {
    const panel = document.getElementById('right-panel');
    const activeTab = document.querySelector('.rp-tab.active')?.dataset.rpTab;
    const willOpen = !(panel?.classList.contains('open') && activeTab === 'detail');
    const cfg = _getDetailPanelCfg();
    cfg.visible = willOpen;
    _saveDetailPanelCfg(cfg);
    _ensureDetailTabShell(rpDetail);
    toggleRightPanelTab('detail');
    return;
  }
  const cfg = _getDetailPanelCfg();
  cfg.visible = cfg.visible !== true;
  _saveDetailPanelCfg(cfg);
}

function toggleDetailPanel() {
  return toggleOptionPanel();
}

function _refreshBacklinksIfActive() {
  if (_currentDetailTab !== 'backlinks' || !window.GbBacklinks) return;
  const container = document.getElementById('detail-tab-backlinks');
  const s = (typeof state !== 'undefined') ? state : null;
  const path = (s && (s.currentEntityPath || s.currentPagePath || s.currentFilePath)) || '';
  window.GbBacklinks.render(path, container);
}

function _clearBacklinksTabIfHidden() {
  if (_currentDetailTab !== 'backlinks') return;
  const visible = [...document.querySelectorAll('.detail-tab-backlinks')].some(t => !t.hidden);
  if (!visible) switchDetailTab(null);
}

function showNoteTabs(visible) {
  const rpDetail = document.getElementById('rp-detail');
  if (rpDetail) _ensureDetailTabShell(rpDetail);
  const dbVisible = [...document.querySelectorAll('.detail-tab-db-property-settings')].some(t => !t.hidden);
  document.querySelectorAll('.detail-tab-note-editor').forEach(t => {
    t.hidden = !visible;
  });
  // バックリンクタブもノート/DB文脈で表示
  document.querySelectorAll('.detail-tab-backlinks').forEach(t => {
    t.hidden = !(visible || dbVisible);
  });
  if (!visible && _currentDetailTab === 'note-editor') {
    switchDetailTab(null);
  }
  _clearBacklinksTabIfHidden();
  if (visible) _refreshBacklinksIfActive();
}

function showDbTabs(visible) {
  const rpDetail = document.getElementById('rp-detail');
  if (rpDetail) _ensureDetailTabShell(rpDetail);
  const noteVisible = [...document.querySelectorAll('.detail-tab-note-editor')].some(t => !t.hidden);
  document.querySelectorAll('.detail-tab-db-property-settings').forEach(t => {
    t.hidden = !visible;
  });
  // バックリンクタブも DB 文脈で表示（showNoteTabs と重複してよい；上書き）
  document.querySelectorAll('.detail-tab-backlinks').forEach(t => {
    t.hidden = !(visible || noteVisible);
  });
  if (!visible && _currentDetailTab === 'db-property-settings') {
    switchDetailTab(null);
  }
  _clearBacklinksTabIfHidden();
  if (visible) {
    const container = document.getElementById('detail-tab-db-property-settings');
    const s = (typeof state !== 'undefined') ? state : null;
    const sel = s?.selectedColumn;
    if (container && !container.innerHTML.trim() && typeof renderDbPropertySettingsPanel === 'function') {
      renderDbPropertySettingsPanel(s?.currentDbPath || '', sel?.propName || '', container);
    }
    _refreshBacklinksIfActive();
  }
}

// ボード内のカード/ライン/スタイル管理 タブの個別表示切替。
// visibility は { card, line, cardStyle, lineStyle, depthStyle } を取り、未指定は既存状態を維持する
// (undefined → そのまま、true/false で明示切替)。古い (boolean) 形式での呼び出しは主要な
// card/line タブにのみ適用し、スタイル管理系は boolean 時のみ追従 (ボード非表示時は全て隠す)。
function showBoardTabs(visibility) {
  const rpDetail = document.getElementById('rp-detail');
  if (rpDetail) _ensureDetailTabShell(rpDetail);
  const norm = (typeof visibility === 'boolean')
    ? {
        card: visibility, line: visibility,
        cardStyle: visibility, lineStyle: visibility, depthStyle: visibility,
      }
    : (visibility || {});
  const map = {
    card: '.detail-tab-board-card',
    line: '.detail-tab-board-line',
    cardStyle: '.detail-tab-board-card-style',
    lineStyle: '.detail-tab-board-line-style',
    depthStyle: '.detail-tab-board-depth-style',
  };
  Object.entries(map).forEach(([key, sel]) => {
    if (norm[key] === undefined) return;
    document.querySelectorAll(sel).forEach(t => { t.hidden = !norm[key]; });
  });
  // 現在のタブが隠された場合はクリアする
  if (_currentDetailTab === 'board-card' && norm.card === false) switchDetailTab(null);
  if (_currentDetailTab === 'board-line' && norm.line === false) switchDetailTab(null);
  if (_currentDetailTab === 'board-card-style' && norm.cardStyle === false) switchDetailTab(null);
  if (_currentDetailTab === 'board-line-style' && norm.lineStyle === false) switchDetailTab(null);
  if (_currentDetailTab === 'board-depth-style' && norm.depthStyle === false) switchDetailTab(null);
}

function setBoardDetailTabContent(contents) {
  const rpDetail = document.getElementById('rp-detail');
  if (rpDetail) _ensureDetailTabShell(rpDetail);
  const map = {
    card: 'detail-tab-board-card',
    line: 'detail-tab-board-line',
    cardStyle: 'detail-tab-board-card-style',
    lineStyle: 'detail-tab-board-line-style',
    depthStyle: 'detail-tab-board-depth-style',
  };
  Object.entries(map).forEach(([key, id]) => {
    if (!Object.prototype.hasOwnProperty.call(contents || {}, key)) return;
    const el = document.getElementById(id);
    if (el) el.innerHTML = contents[key] || '';
  });
}

function clearBoardDetailTabContent() {
  // カード/ライン タブに加え、スタイル管理タブ 3 つも stale データを捨てる。
  // ボード切替時に前ボードの style 一覧/選択が残らないようにするため。
  setBoardDetailTabContent({ card: '', line: '', cardStyle: '', lineStyle: '', depthStyle: '' });
}

function clearBoardDetailTabs() {
  clearBoardDetailTabContent();
  showBoardTabs(false);
}

// ファイルテーマ タブ（全エディタ共通）の表示切替
function showFileStyleTab(visible) {
  const rpDetail = document.getElementById('rp-detail');
  if (rpDetail) _ensureDetailTabShell(rpDetail);
  document.querySelectorAll('.detail-tab-file-style').forEach(t => { t.hidden = !visible; });
  if (!visible) {
    document.querySelectorAll('#detail-tab-file-style').forEach(el => {
      delete el.dataset.fileStyleContext;
      el.removeAttribute('data-calendar-style');
    });
  }
  if (!visible && _currentDetailTab === 'file-style') {
    switchDetailTab(null);
  }
}

function renderPublishDetailTab() {
  const rpDetail = document.getElementById('rp-detail');
  if (rpDetail) _ensureDetailTabShell(rpDetail);
  const el = document.getElementById('detail-tab-publish');
  if (!el) return;
  if (typeof renderPublishSettingsPanel !== 'function') {
    el.innerHTML = '<div class="gb-section-desc" style="padding:var(--ui-space-4);">公開設定を読み込めませんでした</div>';
    return;
  }
  el.innerHTML = `<div style="padding:var(--ui-space-4);">${renderPublishSettingsPanel()}</div>`;
  if (typeof bindPublishSettingsPanel === 'function') bindPublishSettingsPanel(el);
  if (typeof replaceIcons === 'function') replaceIcons(el);
}

function showPublishDetailTab(visible) {
  const rpDetail = document.getElementById('rp-detail');
  if (rpDetail) _ensureDetailTabShell(rpDetail);
  document.querySelectorAll('.detail-tab-publish').forEach(t => { t.hidden = !visible; });
  if (!visible && _currentDetailTab === 'publish') {
    switchDetailTab(null);
  }
  if (visible) renderPublishDetailTab();
}

// ==========================================================
// ファイルテーマ タブ（全エディタ共通）
// ==========================================================
// scriptnote のフィールドは doc.editor.* を直接バッキングし、
// --sn2-* を host の内部要素に setProperty する（ライブプレビュー）。
// page / db / board はフロントマターの style: に格納された --* 変数をバッキングし、
// _getCurrentFileStyle / _saveFileTheme + applyFileStyleToPanel 経由で適用する。
const _FS_FIELDS = {
  folder: {
    display: [
      { key: '--fv-item-bg',          label: 'カード背景',   type: 'color' },
      { key: '--fv-item-fg',          label: 'カード文字',   type: 'color' },
      { key: '--fv-item-border',      label: 'カード枠線',   type: 'color' },
      { key: '--fv-item-hover-bg',    label: 'ホバー背景',   type: 'color' },
      { key: '--fv-item-selected-bg', label: '選択背景',     type: 'color' },
      { key: '--fv-item-selected-fg', label: '選択文字',     type: 'color' },
      { key: '--fv-meta-fg',          label: 'メタ情報',     type: 'color' },
      { key: '--fv-icon-fg',          label: 'アイコン',     type: 'color' },
      { key: '--fv-font-family',      label: 'フォント',     type: 'select', options: getFontFamilyOptions, normalize: normalizeFontFamilyValue, preview: 'fontSample' },
    ],
    editOps: [],
  },
  page: {
    display: [
      { key: '--page-margin-x', label: '左右余白', type: 'rangeNumber', unit: 'px', min: 0, max: 300, step: 1, fallback: '50px' },
      { key: '--page-content-max-width', label: '内容最大幅', type: 'rangeNumber', unit: 'px', min: 480, max: 3200, step: 10, fallback: '1200px' },
      // タイトル
      { key: '--page-title-fg',     label: 'タイトル 色',     type: 'color' },
      { key: '--page-title-bg',     label: 'タイトル 背景',   type: 'color' },
      { key: '--page-title-bold',   label: 'タイトル 太字',   type: 'toggle', on: 'bold',   off: 'normal' },
      { key: '--page-title-italic', label: 'タイトル 斜体',   type: 'toggle', on: 'italic', off: 'normal' },
      { key: '--page-title-font',   label: 'タイトル フォント', type: 'select', options: getFontFamilyOptions, normalize: normalizeFontFamilyValue, preview: 'fontSample' },
      // H1〜H6
      { key: '--page-h1-fg',     label: 'H1 色',     type: 'color' },
      { key: '--page-h1-bg',     label: 'H1 背景',   type: 'color' },
      { key: '--page-h1-bold',   label: 'H1 太字',   type: 'toggle', on: 'bold',   off: 'normal' },
      { key: '--page-h1-italic', label: 'H1 斜体',   type: 'toggle', on: 'italic', off: 'normal' },
      { key: '--page-h1-font',   label: 'H1 フォント', type: 'select', options: getFontFamilyOptions, normalize: normalizeFontFamilyValue, preview: 'fontSample' },
      { key: '--page-h2-fg',     label: 'H2 色',     type: 'color' },
      { key: '--page-h2-bg',     label: 'H2 背景',   type: 'color' },
      { key: '--page-h2-bold',   label: 'H2 太字',   type: 'toggle', on: 'bold',   off: 'normal' },
      { key: '--page-h2-italic', label: 'H2 斜体',   type: 'toggle', on: 'italic', off: 'normal' },
      { key: '--page-h2-font',   label: 'H2 フォント', type: 'select', options: getFontFamilyOptions, normalize: normalizeFontFamilyValue, preview: 'fontSample' },
      { key: '--page-h3-fg',     label: 'H3 色',     type: 'color' },
      { key: '--page-h3-bg',     label: 'H3 背景',   type: 'color' },
      { key: '--page-h3-bold',   label: 'H3 太字',   type: 'toggle', on: 'bold',   off: 'normal' },
      { key: '--page-h3-italic', label: 'H3 斜体',   type: 'toggle', on: 'italic', off: 'normal' },
      { key: '--page-h3-font',   label: 'H3 フォント', type: 'select', options: getFontFamilyOptions, normalize: normalizeFontFamilyValue, preview: 'fontSample' },
      { key: '--page-h4-fg',     label: 'H4 色',     type: 'color' },
      { key: '--page-h4-bg',     label: 'H4 背景',   type: 'color' },
      { key: '--page-h4-bold',   label: 'H4 太字',   type: 'toggle', on: 'bold',   off: 'normal' },
      { key: '--page-h4-italic', label: 'H4 斜体',   type: 'toggle', on: 'italic', off: 'normal' },
      { key: '--page-h4-font',   label: 'H4 フォント', type: 'select', options: getFontFamilyOptions, normalize: normalizeFontFamilyValue, preview: 'fontSample' },
      { key: '--page-h5-fg',     label: 'H5 色',     type: 'color' },
      { key: '--page-h5-bg',     label: 'H5 背景',   type: 'color' },
      { key: '--page-h5-bold',   label: 'H5 太字',   type: 'toggle', on: 'bold',   off: 'normal' },
      { key: '--page-h5-italic', label: 'H5 斜体',   type: 'toggle', on: 'italic', off: 'normal' },
      { key: '--page-h5-font',   label: 'H5 フォント', type: 'select', options: getFontFamilyOptions, normalize: normalizeFontFamilyValue, preview: 'fontSample' },
      { key: '--page-h6-fg',     label: 'H6 色',     type: 'color' },
      { key: '--page-h6-bg',     label: 'H6 背景',   type: 'color' },
      { key: '--page-h6-bold',   label: 'H6 太字',   type: 'toggle', on: 'bold',   off: 'normal' },
      { key: '--page-h6-italic', label: 'H6 斜体',   type: 'toggle', on: 'italic', off: 'normal' },
      { key: '--page-h6-font',   label: 'H6 フォント', type: 'select', options: getFontFamilyOptions, normalize: normalizeFontFamilyValue, preview: 'fontSample' },
      // 本文
      { key: '--page-text-fg',     label: '本文 色',     type: 'color' },
      { key: '--page-text-bold',   label: '本文 太字',   type: 'toggle', on: 'bold',   off: 'normal' },
      { key: '--page-text-italic', label: '本文 斜体',   type: 'toggle', on: 'italic', off: 'normal' },
      { key: '--page-text-font',   label: '本文 フォント', type: 'select', options: getFontFamilyOptions, normalize: normalizeFontFamilyValue, preview: 'fontSample' },
      // リンク
      { key: '--page-link-fg',     label: 'リンク 色',   type: 'color' },
      { key: '--page-link-bold',   label: 'リンク 太字', type: 'toggle', on: 'bold',   off: 'normal' },
      { key: '--page-link-italic', label: 'リンク 斜体', type: 'toggle', on: 'italic', off: 'normal' },
      // 引用
      { key: '--page-quote-fg',     label: '引用 色',     type: 'color' },
      { key: '--page-quote-bg',     label: '引用 背景',   type: 'color', bgType: 'rgba' },
      { key: '--page-quote-bold',   label: '引用 太字',   type: 'toggle', on: 'bold',   off: 'normal' },
      { key: '--page-quote-italic', label: '引用 斜体',   type: 'toggle', on: 'italic', off: 'normal' },
      { key: '--page-quote-border', label: '引用線 色',   type: 'color' },
      // 区切り
      { key: '--page-hr-color', label: '区切り線 色', type: 'color' },
    ],
    editOps: [
      { key: '--page-selection-fg',    label: '選択文字',   type: 'color' },
      { key: '--page-selection-color', label: '選択背景',   type: 'color' },
      { key: '--page-caret-color',     label: 'カーソル色', type: 'color' },
      { key: '--page-caret-width',     label: 'カーソル太さ', type: 'pxtext' },
    ],
  },
  db: {
    display: [
      { key: '--db-header-bg', label: 'ヘッダー背景', type: 'color' },
      { key: '--db-border-color', label: '罫線色',    type: 'color' },
      // ヘッダー
      { key: '--db-th-fg',     label: 'ヘッダー 色',   type: 'color' },
      { key: '--db-th-bg',     label: 'ヘッダー 背景', type: 'color' },
      { key: '--db-th-bold',   label: 'ヘッダー 太字', type: 'toggle', on: 'bold',   off: 'normal' },
      { key: '--db-th-italic', label: 'ヘッダー 斜体', type: 'toggle', on: 'italic', off: 'normal' },
      { key: '--db-th-font',   label: 'ヘッダー フォント', type: 'select', options: getFontFamilyOptions, normalize: normalizeFontFamilyValue, preview: 'fontSample' },
      // エントリ列
      { key: '--db-entity-fg',     label: 'エントリ列 色',   type: 'color' },
      { key: '--db-entity-bg',     label: 'エントリ列 背景', type: 'color' },
      { key: '--db-entity-bold',   label: 'エントリ列 太字', type: 'toggle', on: 'bold',   off: 'normal' },
      { key: '--db-entity-italic', label: 'エントリ列 斜体', type: 'toggle', on: 'italic', off: 'normal' },
      { key: '--db-entity-font',   label: 'エントリ列 フォント', type: 'select', options: getFontFamilyOptions, normalize: normalizeFontFamilyValue, preview: 'fontSample' },
      // セル
      { key: '--db-cell-fg',     label: 'セル 色',   type: 'color' },
      { key: '--db-cell-bg',     label: 'セル 背景', type: 'color', bgType: 'rgba' },
      { key: '--db-cell-bold',   label: 'セル 太字', type: 'toggle', on: 'bold',   off: 'normal' },
      { key: '--db-cell-italic', label: 'セル 斜体', type: 'toggle', on: 'italic', off: 'normal' },
      { key: '--db-cell-font',   label: 'セル フォント', type: 'select', options: getFontFamilyOptions, normalize: normalizeFontFamilyValue, preview: 'fontSample' },
      // アクティブセル枠
      { key: '--db-active-color', label: 'アクティブセル枠 色',   type: 'color' },
      { key: '--db-active-width', label: 'アクティブセル枠 太さ', type: 'pxtext' },
      // 罫線
      { key: '--db-grid-border', label: '罫線 色',   type: 'color' },
      { key: '--db-show-grid',   label: '罫線 表示', type: 'toggle', on: '1px', off: '0px' },
    ],
    editOps: [
      { key: '--db-selection-fg',    label: '選択文字', type: 'color' },
      { key: '--db-selection-color', label: '選択背景', type: 'color' },
    ],
  },
  board: {
    display: [
      { key: '--bd-bg',           label: 'ボード背景', type: 'color', applyCustom: 'bgColor' },
      { key: '__bd-bg-reset',     label: '背景色リセット', type: 'boardBgColorReset' },
      { key: '--bd-shadow',       label: '影',         type: 'toggle', on: '1', off: '', applyCustom: 'shadow' },
      { key: '--bd-shadow-color', label: '影の色',     type: 'color' },
      { key: '--bd-bg-image',     label: '背景画像',   type: 'boardBgImage' },
      { key: '--bd-bg-image-fit', label: '画像表示',   type: 'boardBgFit' },
      { key: '--bd-default-font-family', label: 'ボード標準フォント', type: 'select', options: getFontFamilyOptions, normalize: normalizeFontFamilyValue, preview: 'fontSample', applyCustom: 'fontFamily' },
    ],
    editOps: [
      { key: '--bd-selection-fg',      label: '選択文字',   type: 'color' },
      { key: '--bd-selection-color',   label: '選択色',     type: 'color' },
      { key: '--bd-caret-color',       label: 'カーソル色', type: 'color' },
      { key: '--bd-caret-width',       label: 'カーソル太さ', type: 'pxtext' },
      { key: '--bd-select-rect-color', label: '矩形選択色', type: 'color' },
      { key: '--bd-group-color',       label: 'グループ色', type: 'color' },
      { key: '--bd-anchor-color',      label: 'アンカー色', type: 'color' },
      { key: '--bd-gap-siblings',      label: '同階層カード間の隙間', type: 'number', unit: 'px', min: 0, max: 400, step: 1, fallback: 10, applyCustom: 'gapSiblings' },
      { key: '--bd-gap-levels',        label: '階層間の隙間',         type: 'number', unit: 'px', min: 0, max: 600, step: 1, fallback: 30, applyCustom: 'gapLevels' },
      { key: '--bd-auto-align',        label: '自動整列',             type: 'checkbox', on: '1', off: '0', defaultOn: true, applyCustom: 'autoAlign' },
    ],
  },
  scriptnote: {
    // scriptnote フィールド: key = doc.editor のプロパティ名
    display: [
      { key: 'borderColor',          label: '枠線色',           type: 'color',  cssVar: '--sn2-border-color',        target: 'editor', fallback: 'var(--border)' },
      { key: 'borderWidth',          label: '枠線太さ',         type: 'pxtext', cssVar: '--sn2-border-width',        target: 'editor' },
      { key: 'baseTextColor',        label: '基本 文字色',      type: 'color',  cssVar: '--sn2-base-text-color',     target: 'scroll' },
      { key: 'baseTextFontFamily',   label: '基本 フォント',    type: 'select', options: getFontFamilyOptions, normalize: normalizeFontFamilyValue, preview: 'fontSample', cssVar: '--sn2-base-text-font-family', target: 'scroll' },
      { key: 'baseTextBold',         label: '基本 太字',        type: 'toggle', on: 'bold',   off: '',      cssVar: '--sn2-base-text-bold',        target: 'scroll' },
      { key: 'baseTextItalic',       label: '基本 斜体',        type: 'toggle', on: 'italic', off: '',      cssVar: '--sn2-base-text-italic',      target: 'scroll' },
      { key: 'baseTextFontSize',     label: '基本 サイズ',      type: 'number', unit: 'px', min: 8, max: 36, step: 1,     cssVar: '--sn2-base-text-font-size',   target: 'scroll' },
      { key: 'baseTextLineHeightH',   label: '横 行間',         type: 'number', unit: '',   min: 1, max: 3,  step: 0.1, applyCustom: 'textSpacing' },
      { key: 'baseTextLineHeightV',   label: '縦 行間',         type: 'number', unit: '',   min: 1, max: 3,  step: 0.1, applyCustom: 'textSpacing' },
      { key: 'baseTextLetterSpacingH',label: '横 字間',         type: 'number', unit: 'em', min: -0.2, max: 1, step: 0.05, applyCustom: 'textSpacing' },
      { key: 'baseTextLetterSpacingV',label: '縦 字間',         type: 'number', unit: 'em', min: -0.2, max: 1, step: 0.05, applyCustom: 'textSpacing' },
      { key: 'rubyPresentation',     label: 'ルビ表示',          type: 'rubyPresentation' },
      { key: 'spreadBorderColor',    label: '見開き区切り色',   type: 'color',  cssVar: '--sn2-spread-border-color', target: 'editor' },
      { key: 'spreadBorderWidth',    label: '見開き区切り太さ', type: 'pxtext', cssVar: '--sn2-spread-border-width', target: 'editor' },
      { key: 'wrapMode',             label: '折り返し',         type: 'toggle', on: true, off: false, defaultOn: true, applyCustom: 'wrapMode' },
    ],
    editOps: [
      { key: 'hoverBgColor',       label: 'ホバー背景',       type: 'color',  cssVar: '--sn2-hover-bg',        target: 'editor' },
      { key: 'caretColor',         label: 'カーソル色',       type: 'color',  cssVar: '--sn2-caret-color',     target: 'editor' },
      { key: 'caretWidth',         label: 'カーソル太さ',     type: 'pxtext', cssVar: '--sn2-caret-width',     target: 'editor' },
      { key: 'dragSelectColor',    label: 'ドラッグ選択矩形', type: 'color',  cssVar: '--sn2-drag-select-color', target: 'editor' },
      { key: 'selectionColor',     label: 'テキスト選択',     type: 'color',  cssVar: '--sn2-selection-color', target: 'scroll' },
      { key: 'selectionTextColor', label: '選択文字',       type: 'color',  cssVar: '--sn2-selection-fg', target: 'scroll' },
      { key: 'dropIndicatorColor', label: 'ドロップ色',       type: 'color',  cssVar: '--sn2-drop-color',      target: 'editor' },
      { key: 'dropIndicatorWidth', label: 'ドロップ太さ',     type: 'pxtext', cssVar: '--sn2-drop-width',      target: 'editor' },
    ],
  },
};
const _fsPendingThemeColorSets = {};
let _fsStyleHistorySuppressed = 0;

function _fsStyleSnapshot(style) {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return {};
  const out = {};
  Object.keys(style).sort().forEach((key) => {
    const value = style[key];
    if (value === undefined || value === null || value === '') return;
    out[key] = value;
  });
  return JSON.parse(JSON.stringify(out));
}

function _fsStyleSnapshotsEqual(a, b) {
  try { return JSON.stringify(_fsStyleSnapshot(a)) === JSON.stringify(_fsStyleSnapshot(b)); }
  catch { return false; }
}

function _fsWithStyleHistorySuppressed(fn) {
  _fsStyleHistorySuppressed += 1;
  const release = () => {
    _fsStyleHistorySuppressed = Math.max(0, _fsStyleHistorySuppressed - 1);
  };
  try {
    const result = typeof fn === 'function' ? fn() : undefined;
    if (result && typeof result.finally === 'function') return result.finally(release);
    release();
    return result;
  } catch (err) {
    release();
    throw err;
  }
}

function _fsStyleHistoryLabel(ctx, label) {
  if (label) return label;
  return ({
    folder: 'フォルダ書式設定変更',
    page: 'ノート書式設定変更',
    db: 'シート書式設定変更',
    board: 'ボード書式設定変更',
    scriptnote: 'シナリオ書式設定変更',
  })[ctx] || '書式設定変更';
}

function _fsStyleHistoryScope(ctx) {
  const s = (typeof state !== 'undefined') ? state : null;
  if (ctx === 'db' && typeof _dbViewConfigHistoryScope === 'function') {
    return _dbViewConfigHistoryScope(s?.currentDbPath || '');
  }
  if (ctx === 'db') return s?.currentDbPath ? 'db:' + String(s.currentDbPath).replace(/\\/g, '/') : '';
  if (ctx === 'page') {
    const path = s?.currentPagePath || document.getElementById('page-content')?.dataset?.path || '';
    return path ? 'page:' + String(path).split('/').pop() : '';
  }
  if (ctx === 'folder') {
    const path = (typeof _folderPath !== 'undefined' ? _folderPath : '') || '';
    return path ? 'folder:' + String(path).replace(/\\/g, '/') : '';
  }
  return '';
}

function _fsMarkStyleVersionDirty(ctx) {
  if (ctx === 'folder' || typeof markAutoVersionDirty !== 'function') return;
  try { markAutoVersionDirty(); } catch {}
}

function _fsPersistStyleDirect(ctx, adapter, style, options = {}) {
  if (adapter && typeof adapter.saveStyle === 'function') {
    return adapter.saveStyle(style, options);
  }
  return _fsSaveStyleForContext(ctx, style);
}

function _fsRestoreStyleSnapshot(ctx, style) {
  const result = _fsWithStyleHistorySuppressed(() => _fsPersistStyleDirect(ctx, _fsGetAdapter(ctx), _fsStyleSnapshot(style), { skipUndo: true }));
  const refresh = () => {
    if (ctx === 'board' && (!_fsStyleSnapshot(style) || Object.keys(_fsStyleSnapshot(style)).length === 0) && typeof _fsResetBoardRuntimeFileStyle === 'function') {
      _fsResetBoardRuntimeFileStyle();
    }
    if (typeof _fsApplyCurrentStyleRuntime === 'function') _fsApplyCurrentStyleRuntime(ctx);
    if (typeof renderFileStyleTab === 'function') renderFileStyleTab(ctx);
  };
  if (result && typeof result.then === 'function') return result.finally(refresh);
  refresh();
  return result;
}

function _fsPushStyleHistory(ctx, before, after, label, detail) {
  if (_fsStyleHistorySuppressed || _fsStyleSnapshotsEqual(before, after)) return false;
  if (ctx === 'scriptnote' || ctx === 'board') return false;
  if (typeof historyPush !== 'function') return false;
  historyPush(
    _fsStyleHistoryLabel(ctx, label),
    () => _fsRestoreStyleSnapshot(ctx, before),
    () => _fsRestoreStyleSnapshot(ctx, after),
    _fsStyleHistoryScope(ctx),
    detail || ''
  );
  return true;
}

function _fsApplyStyleWithHistory(ctx, adapter, style, label, detail) {
  const before = _fsStyleSnapshot(_fsGetStyleForContext(ctx));
  const next = _fsStyleSnapshot(style);
  if (_fsStyleSnapshotsEqual(before, next)) return null;
  if (ctx === 'scriptnote') {
    const ed = _getScriptNoteEditorForFileStyle?.();
    if (typeof ed?._pushUndo === 'function') ed._pushUndo(_fsStyleHistoryLabel(ctx, label));
  } else if (ctx === 'board' && typeof bdPushUndo === 'function') {
    bdPushUndo();
  }
  const result = _fsWithStyleHistorySuppressed(() => _fsPersistStyleDirect(ctx, adapter, next, { skipUndo: true }));
  const finish = () => {
    if (ctx === 'board' && Object.keys(next).length === 0 && typeof _fsResetBoardRuntimeFileStyle === 'function') _fsResetBoardRuntimeFileStyle();
    if (typeof _fsApplyCurrentStyleRuntime === 'function') _fsApplyCurrentStyleRuntime(ctx);
    const after = _fsStyleSnapshot(_fsGetStyleForContext(ctx));
    _fsPushStyleHistory(ctx, before, after, label, detail);
    return after;
  };
  if (result && typeof result.then === 'function') return result.then(finish);
  return finish();
}

function _fsFormatCss(field, raw) {
  if (raw === null || raw === undefined || raw === '') return '';
  const s = String(raw).trim();
  if (!s) return '';
  if (field.type === 'pxtext') return /^\d+(\.\d+)?$/.test(s) ? s + 'px' : s;
  if (field.type === 'rangeNumber') return /^\d+(\.\d+)?$/.test(s) ? s + (field.unit || '') : s;
  if (field.type === 'number' && field.unit) return s + field.unit;
  return s;
}

function _fsGetScriptnoteAdapter() {
  const comp = (typeof getActiveScriptNoteComponent === 'function') ? getActiveScriptNoteComponent() : null;
  const ed = comp?._editor;
  if (!ed || !ed.doc) return null;
  return {
    kind: 'scriptnote',
    get: (field) => ed.doc.editor?.[field.key],
    saveStyle: (style, options = {}) => {
      if (!ed.doc.editor) ed.doc.editor = {};
      const next = _filterScriptnoteFileStyle(style || {});
      Object.keys(ed.doc.editor).forEach((key) => {
        if (typeof _isScriptnoteFileStyleKey === 'function' && _isScriptnoteFileStyleKey(key)) delete ed.doc.editor[key];
      });
      if (typeof _SCRIPTNOTE_FILE_STYLE_DEFAULTS !== 'undefined') {
        Object.entries(_SCRIPTNOTE_FILE_STYLE_DEFAULTS).forEach(([key, value]) => {
          if (next[key] === undefined) ed.doc.editor[key] = value;
        });
      } else if (next.wrapMode === undefined) {
        ed.doc.editor.wrapMode = true;
      }
      Object.entries(next).forEach(([key, value]) => { ed.doc.editor[key] = value; });
      if (typeof ed._markDirty === 'function') ed._markDirty(options.skipUndo ? { skipUndo: true } : {});
      if (typeof ed._render === 'function') ed._render();
    },
    set: (field, val) => {
      const pushedUndo = typeof ed._pushUndo === 'function';
      if (pushedUndo) ed._pushUndo('スタイル設定変更');
      if (typeof _fsEnsureLocalCustomThemeBeforeFieldSet === 'function') {
        _fsEnsureLocalCustomThemeBeforeFieldSet('scriptnote', field, null, { skipHistory: true, skipUndo: pushedUndo });
      }
      if (!ed.doc.editor) ed.doc.editor = {};
      if (field.key === 'wrapMode' && (val === null || val === undefined || val === '')) ed.doc.editor[field.key] = true;
      else if (val === null || val === undefined || val === '') delete ed.doc.editor[field.key];
      else ed.doc.editor[field.key] = val;
      if (typeof ed._markDirty === 'function') ed._markDirty(pushedUndo ? { skipUndo: true } : {});
    },
    applyCss: (field, raw) => {
      if (field.applyCustom === 'wrapMode' || field.applyCustom === 'textSpacing') { if (typeof ed._render === 'function') ed._render(); return; }
      if (!field.cssVar) return;
      const host = ed.host; if (!host) return;
      const tgt = field.target === 'editor' ? host.querySelector('.sn2-editor')
                 : field.target === 'scroll' ? host.querySelector('.sn2-scroll') : host;
      if (!tgt) return;
      const css = _fsFormatCss(field, raw);
      if (css) tgt.style.setProperty(field.cssVar, css);
      else tgt.style.removeProperty(field.cssVar);
    },
    refresh: () => { if (typeof ed._render === 'function') ed._render(); },
  };
}

function _fsGetStyleForContext(ctx) {
  const s = (typeof state !== 'undefined') ? state : null;
  if (ctx === 'scriptnote') {
    const ed = _getScriptNoteEditorForFileStyle?.();
    return ed ? _filterScriptnoteFileStyle(ed.doc.editor || {}) : {};
  }
  if (ctx === 'folder') return typeof _getFolderFileStyle === 'function' ? _getFolderFileStyle() : {};
  if (ctx === 'page') {
    const pc = document.getElementById('page-content');
    return typeof _parseFileStyleFromFrontmatter === 'function' ? (_parseFileStyleFromFrontmatter(pc?.dataset?.frontmatter || '') || {}) : {};
  }
  if (ctx === 'board') {
    if (typeof bd !== 'undefined') return bd._fileStyle || bd._fileTheme || {};
    return {};
  }
  if (ctx === 'db') return (s?.dbMetadata?.style || s?.dbMetadata?.theme || {});
  return typeof _getCurrentFileStyle === 'function' ? (_getCurrentFileStyle() || {}) : {};
}

function _fsSaveStyleForContext(ctx, style) {
  const saved = style && Object.keys(style).length ? style : null;
  let result;
  if (ctx === 'folder' && typeof _saveFolderFileStyle === 'function') {
    result = _saveFolderFileStyle(saved);
    return result;
  }
  if (ctx === 'page' && typeof _saveFileThemeToNoteFrontmatter === 'function') {
    result = _saveFileThemeToNoteFrontmatter(saved);
    _fsMarkStyleVersionDirty(ctx);
    return result;
  }
  if (ctx === 'board' && typeof bd !== 'undefined') {
    bd._fileStyle = saved;
    if (!saved && typeof _fsResetBoardRuntimeFileStyle === 'function') _fsResetBoardRuntimeFileStyle();
    bd.dirty = true;
    result = typeof bdSave === 'function' ? bdSave() : undefined;
    _fsMarkStyleVersionDirty(ctx);
    return result;
  }
  if (ctx === 'db') {
    if (typeof _syncDbMetadataFileStyle === 'function') _syncDbMetadataFileStyle(saved);
    result = typeof _saveFileThemeToDbFolderNote === 'function' ? _saveFileThemeToDbFolderNote(saved) : undefined;
    _fsMarkStyleVersionDirty(ctx);
    return result;
  }
  result = typeof _saveFileTheme === 'function' ? _saveFileTheme(saved) : undefined;
  _fsMarkStyleVersionDirty(ctx);
  return result;
}

function _fsGetFrontmatterAdapter(ctx) {
  const panelId = ctx === 'folder' ? 'folder-view'
    : ctx === 'page' ? 'page-content'
    : ctx === 'board' ? 'bd-canvas'
    : 'db-view-container';
  return {
    kind: 'frontmatter',
    ctx,
    get: (field) => {
      const cur = _fsGetStyleForContext(ctx);
      return cur[field.key];
    },
    set: (field, val) => {
      const before = _fsStyleSnapshot(_fsGetStyleForContext(ctx));
      const boardUndoPushed = ctx === 'board' && typeof bdPushUndo === 'function' && !_fsStyleHistorySuppressed;
      if (boardUndoPushed) bdPushUndo();
      if (typeof _fsEnsureLocalCustomThemeBeforeFieldSet === 'function') {
        _fsEnsureLocalCustomThemeBeforeFieldSet(ctx, field, null, { skipHistory: true, skipUndo: true });
      }
      const cur = _fsGetStyleForContext(ctx);
      const next = { ...cur };
      if (val === null || val === undefined || val === '') delete next[field.key];
      else next[field.key] = val;
      _fsSaveStyleForContext(ctx, next);
      _fsPushStyleHistory(ctx, before, _fsGetStyleForContext(ctx), '書式設定変更', field?.label || field?.key || '');
    },
    applyCss: (field, raw) => {
      const el = panelId === 'bd-canvas' && typeof bdGetBoardElement === 'function'
        ? bdGetBoardElement('canvas')
        : document.getElementById(panelId);
      if (!el) return;
      const css = _fsFormatCss(field, raw);
      if (css) el.style.setProperty(field.key, css);
      else el.style.removeProperty(field.key);
      if (ctx !== 'scriptnote' && typeof applyFileStyleToPanel === 'function') {
        applyFileStyleToPanel(_fsGetStyleForContext(ctx) || {}, panelId);
      }
      if (ctx === 'board' && field.applyCustom === 'fontFamily') {
        if (typeof bdApplyBoardFontVariables === 'function') {
          const world = typeof bdGetBoardElement === 'function' ? bdGetBoardElement('world') : document.getElementById('bd-world');
          bdApplyBoardFontVariables(el, world);
        }
        if (typeof bdScheduleFontStyleMapUpdate === 'function') bdScheduleFontStyleMapUpdate();
      }
      // ボード固有: 影トグルは bd._showShadow に同期してカード/ライン再描画
      if (ctx === 'board' && field.applyCustom === 'shadow' && typeof bd !== 'undefined') {
        bd._showShadow = !!raw && raw !== '' && raw !== '0';
        if (typeof bdRender === 'function') bdRender();
        if (typeof bdDrawConns === 'function') bdDrawConns();
      }
      // 2026-04-18: ボード固有: レイアウト隙間 / 自動整列 トグルを bd 側の JS state に同期。
      //   - gapSiblings / gapLevels は bdLayout* のオフセット算出で使う
      //   - autoAlign は resize 終了後の自動再レイアウト + ドラッグ終了後の吸着で使う
      //   - 既存のカード群に即座に反映するため、autoAlign が on なら全構造ツリーを再レイアウトする
      //
      // 重要: adapter.set() が先に _saveFileTheme → bdSave() を走らせるが、bdSave の
      // bdToMd() は「再レイアウト前」のノード位置を取ってしまう (bdSave は async で sync 部分だけ
      // 先行実行される)。そのため再レイアウト後にもう 1 度 bdSave() を呼んで新しい位置を保存
      // しないと、ファイルには gap だけ新しく位置は古いまま書き込まれて不整合になる。
      const _ensureSaveAfterRelayout = () => {
        if (typeof bdSave === 'function') bdSave();
      };
      if (ctx === 'board' && field.applyCustom === 'gapSiblings' && typeof bd !== 'undefined') {
        const n = parseFloat(raw);
        bd.gapSiblings = Number.isFinite(n) && n >= 0 ? n : null;
        if (bd.autoAlign !== false && typeof _bdRelayoutAllStructureTrees === 'function') {
          _bdRelayoutAllStructureTrees();
          _ensureSaveAfterRelayout();
        }
      }
      if (ctx === 'board' && field.applyCustom === 'gapLevels' && typeof bd !== 'undefined') {
        const n = parseFloat(raw);
        bd.gapLevels = Number.isFinite(n) && n >= 0 ? n : null;
        if (bd.autoAlign !== false && typeof _bdRelayoutAllStructureTrees === 'function') {
          _bdRelayoutAllStructureTrees();
          _ensureSaveAfterRelayout();
        }
      }
      if (ctx === 'board' && field.applyCustom === 'autoAlign' && typeof bd !== 'undefined') {
        // '0' を明示保存時のみ off。未設定 / '1' は on (defaultOn: true の UI 既定と一致)。
        const nextOn = raw !== '0';
        bd.autoAlign = nextOn;
        // オフ → オン に切り替わった時は既存の構造ツリーに現在の隙間を適用する (ユーザー要望)。
        if (nextOn && typeof _bdRelayoutAllStructureTrees === 'function') {
          _bdRelayoutAllStructureTrees();
          _ensureSaveAfterRelayout();
        }
      }
      // ボード固有: 背景色は bd._bgColor と #bd-canvas インライン style に同期。
      // (既存実装では canvas.style.background が CSS 変数より優先されるため、 inline を更新しないと反映されない)
      if (ctx === 'board' && field.applyCustom === 'bgColor' && typeof bd !== 'undefined') {
        bd._bgColor = raw || '';
        const canvas = document.getElementById('bd-canvas');
        if (canvas) {
          if (bd._bgColor) canvas.style.background = bd._bgColor;
          else canvas.style.background = '';
        }
        if (typeof bdSave === 'function') bdSave();
        const swatch = document.getElementById('bd-bg-swatch');
        if (swatch && typeof setColorSwatchValue === 'function') setColorSwatchValue(swatch, bd._bgColor || '');
        if (typeof bdMarkExtrasDirty === 'function') {
          bdMarkExtrasDirty({ minimap: true, boardUi: true }, 'detail-bg-style');
          if (typeof bdScheduleBoardUpdates === 'function') bdScheduleBoardUpdates();
        }
      }
    },
    refresh: () => {},
  };
}

function _fsGetAdapter(ctx) {
  return (ctx === 'scriptnote') ? _fsGetScriptnoteAdapter() : _fsGetFrontmatterAdapter(ctx);
}

function _fsReadFieldValue(field, adapter) {
  const raw = adapter.get(field);
  if (raw !== undefined && raw !== null && raw !== '') return raw;
  if (field.fallback) return field.fallback;
  const ctx = adapter.kind === 'scriptnote' ? 'scriptnote' : (adapter.ctx || _getCurrentFileStyleContext?.());
  const themeVars = ctx ? _fsThemeVarsForCurrent(ctx, adapter) : {};
  const themeKey = field.key && String(field.key).startsWith('--') ? field.key : field.cssVar;
  if (themeKey && themeVars[themeKey]) return themeVars[themeKey];
  if (field.key && field.key.startsWith('--')) {
    const rootValue = getComputedStyle(document.documentElement).getPropertyValue(field.key).trim();
    if (rootValue) return rootValue;
  }
  return '';
}

function _fsNormalizeFieldValue(field, value) {
  const normalized = typeof field.normalize === 'function' ? field.normalize(value) : value;
  const key = field?.key || field?.cssVar || '';
  return typeof normalizeStyleSettingValue === 'function' ? normalizeStyleSettingValue(key, normalized) : normalized;
}

function _fsParseBoundedNumber(raw, field, fallback) {
  let n = parseFloat(String(raw ?? '').replace(/px$/i, '').trim());
  if (!Number.isFinite(n)) n = fallback;
  if (!Number.isFinite(n)) n = parseFloat(String(field.fallback ?? '').replace(/px$/i, '').trim());
  if (!Number.isFinite(n)) n = field.min ?? 0;
  if (field.min !== undefined) n = Math.max(field.min, n);
  if (field.max !== undefined) n = Math.min(field.max, n);
  return n;
}

function _fsUpdateFontSample(row, value) {
  const sample = row?.querySelector?.('.cs-row-preview[data-preview-kind="font"]');
  if (!sample) return;
  const family = typeof normalizeFontFamilyValue === 'function' ? normalizeFontFamilyValue(value) : String(value || '').trim();
  sample.style.fontFamily = family || 'var(--bd-default-font-family, var(--bd-theme-font-family, var(--ui-font, inherit)))';
}

function _fsE2eToken(value) {
  return String(value == null ? '' : value)
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function _fsFieldE2eId(field, rowLabel, suffix) {
  const fieldKey = field?.key || field?.cssVar || field?.label || field?.type || 'field';
  return ['file-style-field', rowLabel, fieldKey, suffix]
    .map(_fsE2eToken)
    .filter(Boolean)
    .join('-');
}

function _fsSetControlE2e(el, field, rowLabel, suffix) {
  if (!el?.dataset) return el;
  el.dataset.e2eId = _fsFieldE2eId(field, rowLabel, suffix);
  if (field?.label) el.dataset.e2eLabel = field.label;
  const tag = String(el.tagName || '').toLowerCase();
  const type = String(el.getAttribute?.('type') || '').toLowerCase();
  const interactive = ['button', 'input', 'select', 'textarea'].includes(tag) || el.getAttribute?.('role') === 'button';
  if (interactive && type !== 'hidden') {
    const label = _fsControlA11yLabel(field, rowLabel, suffix);
    if (label && !el.getAttribute('aria-label')) el.setAttribute('aria-label', label);
    if (label && !el.getAttribute('title')) el.setAttribute('title', label);
  }
  return el;
}

function _fsControlA11yLabel(field, rowLabel, suffix) {
  const fieldLabel = String(field?.label || '').trim();
  const row = String(rowLabel || '').trim();
  const suffixLabels = {
    fit: '表示方法',
    scale: '倍率',
    select: '選択',
    swatch: '色',
    alpha: '透明度',
    checkbox: '切り替え',
    'toggle-checkbox': '切り替え',
    bold: '太字',
    italic: '斜体',
    toggle: '切り替え',
    number: '数値',
    range: 'スライダー',
    text: 'テキスト',
    pxtext: 'px値',
    reset: 'リセット',
    choose: '画像選択',
    clear: '画像クリア',
  };
  const suffixLabel = suffixLabels[suffix] || '';
  const parts = [];
  if (row) parts.push(row);
  if (fieldLabel && fieldLabel !== row && !fieldLabel.startsWith(row + ' ')) parts.push(fieldLabel);
  if (suffixLabel && !parts.some(part => part.includes(suffixLabel))) parts.push(suffixLabel);
  return parts.join(' ').trim() || fieldLabel || suffixLabel || 'スタイル設定';
}

function _fsIsToggleOn(field, cur) {
  const unset = cur === undefined || cur === null || cur === '';
  if (unset) return !!field.defaultOn;
  if (cur === field.on) return true;
  if (field.on === true) return cur === true || cur === 1 || cur === '1' || cur === 'true';
  if (field.on === false) return cur === false || cur === 0 || cur === '0' || cur === 'false';
  return false;
}

function _fsBuildControl(field, adapter, rowLabel) {
  const cur = _fsNormalizeFieldValue(field, _fsReadFieldValue(field, adapter));
  if (field.type === 'rubyPresentation') {
    const editor = typeof _getScriptNoteEditorForFileStyle === 'function' ? _getScriptNoteEditorForFileStyle() : null;
    if (editor && typeof MeldexRubySettingsUI !== 'undefined') {
      return MeldexRubySettingsUI.createEditorSettings(editor, { scope: 'file-theme' });
    }
    const unavailable = document.createElement('span');
    unavailable.className = 'fs-muted';
    unavailable.textContent = 'シナリオを開くと設定できます';
    return unavailable;
  }
  if (field.type === 'boardBgColorReset') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gb-fmt-reset';
    btn.textContent = 'リセット';
    btn.title = field.label;
    btn.disabled = !(typeof bd !== 'undefined' && (bd._bgColor || adapter.get({ key: '--bd-bg' })));
    _fsSetControlE2e(btn, field, rowLabel, 'reset');
    btn.addEventListener('click', () => {
      const bgField = { key: '--bd-bg', label: 'ボード背景', type: 'color', applyCustom: 'bgColor' };
      adapter.set(bgField, '');
      adapter.applyCss(bgField, '');
      btn.disabled = true;
      if (typeof bdDirty === 'function') bdDirty();
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
      if (typeof _fsNotifyFieldChanged === 'function') _fsNotifyFieldChanged(btn, bgField, adapter, '');
    });
    return btn;
  }
  if (field.type === 'boardBgImage') {
    const wrap = document.createElement('span');
    wrap.className = 'gb-fmt-popup-group';
    wrap.dataset.e2eId = _fsFieldE2eId(field, rowLabel, 'image-group');
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', _fsControlA11yLabel(field, rowLabel, 'choose'));
    const imgName = (typeof _bdBackgroundImageName === 'function') ? _bdBackgroundImageName() : '';
    const imageBtn = document.createElement('button');
    imageBtn.type = 'button';
    imageBtn.className = 'gb-btn gb-btn-sm';
    imageBtn.innerHTML = (typeof lucide === 'function' ? lucide('image', 14) : '') + ' 画像';
    _fsSetControlE2e(imageBtn, field, rowLabel, 'choose');
    imageBtn.addEventListener('click', () => { if (typeof bdChooseBoardBackgroundImage === 'function') bdChooseBoardBackgroundImage(); });
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'gb-btn gb-btn-sm';
    clearBtn.innerHTML = (typeof lucide === 'function' ? lucide('eraser', 14) : '') + ' 画像クリア';
    clearBtn.disabled = !imgName;
    _fsSetControlE2e(clearBtn, field, rowLabel, 'clear');
    clearBtn.addEventListener('click', () => { if (typeof bdClearBoardBackgroundImage === 'function') bdClearBoardBackgroundImage(); });
    const hint = document.createElement('span');
    hint.className = 'gb-fmt-label';
    hint.textContent = imgName || '画像なし';
    wrap.append(imageBtn, clearBtn, hint);
