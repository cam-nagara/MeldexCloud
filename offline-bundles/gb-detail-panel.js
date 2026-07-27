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
      ${_detailTabButtonHtml('note-editor', 'detail-tab-note-editor', 'エディタ')}
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
    return wrap;
  }
  if (field.type === 'boardBgFit') {
    const wrap = document.createElement('span');
    wrap.className = 'gb-fs-bg-fit-control';
    const sel = document.createElement('select');
    sel.className = 'gb-select';
    sel.disabled = !(typeof bd !== 'undefined' && bd._bgImage);
    _fsSetControlE2e(sel, field, rowLabel, 'fit');
    const curFit = (typeof _bdNormalizeBackgroundFit === 'function') ? _bdNormalizeBackgroundFit(typeof bd !== 'undefined' ? bd._bgImageFit : '') : 'contain';
    [
      ['contain', '全体'],
      ['cover', '余白なし'],
      ['auto', '原寸'],
      ['repeat', 'タイル'],
      ['world', 'ボード追従'],
    ].forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      opt.selected = value === curFit;
      sel.appendChild(opt);
    });
    // ボード追従モード専用: 倍率入力
    const scaleInput = document.createElement('input');
    scaleInput.type = 'number';
    scaleInput.className = 'gb-input gb-fmt-num gb-fmt-num--w70';
    scaleInput.min = '0.05';
    scaleInput.max = '20';
    scaleInput.step = '0.1';
    scaleInput.title = '背景画像の表示倍率 (ボード追従モード)';
    _fsSetControlE2e(scaleInput, field, rowLabel, 'scale');
    const curScale = (typeof bd !== 'undefined' && Number.isFinite(Number(bd._bgImageScale))) ? Number(bd._bgImageScale) : 1;
    scaleInput.value = String(curScale);
    const updateScaleVisibility = () => {
      const active = sel.value === 'world' && !!(typeof bd !== 'undefined' && bd._bgImage);
      scaleInput.style.display = active ? '' : 'none';
    };
    updateScaleVisibility();
    sel.addEventListener('change', () => {
      if (typeof bdSetBoardBackgroundImageFit === 'function') bdSetBoardBackgroundImageFit(sel.value);
      updateScaleVisibility();
    });
    scaleInput.addEventListener('change', () => {
      if (typeof bdSetBoardBackgroundImageScale === 'function') bdSetBoardBackgroundImageScale(Number(scaleInput.value));
    });
    wrap.append(sel, scaleInput);
    return wrap;
  }
  if (field.type === 'select') {
    const sel = document.createElement('select');
    sel.className = 'gb-select';
    sel.title = field.label;
    _fsSetControlE2e(sel, field, rowLabel, 'select');
    const options = typeof field.options === 'function' ? field.options(cur) : (field.options || []);
    if (typeof options === 'string') {
      sel.innerHTML = options;
    } else if (Array.isArray(options)) {
      options.forEach(optData => {
        const opt = document.createElement('option');
        opt.value = optData.v || '';
        opt.textContent = optData.l || optData.v || '';
        if (optData.style) opt.setAttribute('style', optData.style);
        sel.appendChild(opt);
      });
    }
    sel.value = cur || '';
    sel.addEventListener('change', () => {
      const raw = _fsNormalizeFieldValue(field, sel.value);
      sel.value = raw || '';
      adapter.set(field, raw || '');
      adapter.applyCss(field, raw || '');
      if (typeof _fsNotifyFieldChanged === 'function') _fsNotifyFieldChanged(sel, field, adapter, raw);
    });
    return sel;
  }
  if (field.type === 'color') {
    if (field.bgType === 'rgba' && typeof parseColorToHexAlpha === 'function' && typeof hexAlphaToRgba === 'function') {
      const wrap = document.createElement('span');
      wrap.className = 'gb-fmt-popup-group';
      const parsed = parseColorToHexAlpha(cur);
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'gb-fmt-swatch-bg';
      sw.style.background = cur || field.fallback || 'var(--bg3)';
      sw.title = field.label;
      sw.dataset.hex = parsed.hex;
      _fsSetControlE2e(sw, field, rowLabel, 'swatch');
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '100';
      slider.value = String(Math.round(parsed.alpha * 100));
      slider.className = 'cs-alpha';
      slider.title = field.label + ' 透明度';
      _fsSetControlE2e(slider, field, rowLabel, 'alpha');
      const val = document.createElement('span');
      val.className = 'cs-alpha-val';
      val.textContent = slider.value + '%';
      const applyRgba = () => {
        const raw = hexAlphaToRgba(sw.dataset.hex || '#000000', parseInt(slider.value, 10) / 100);
        adapter.set(field, raw);
        sw.style.background = raw || field.fallback || 'var(--bg3)';
        adapter.applyCss(field, raw);
        val.textContent = slider.value + '%';
        globalThis.GBUI?.refreshRangeFill?.(slider);
        if (typeof _fsNotifyFieldChanged === 'function') _fsNotifyFieldChanged(wrap, field, adapter, raw);
      };
      sw.addEventListener('click', () => {
        if (typeof openColorPalette !== 'function') return;
        openColorPalette(sw, sw.dataset.hex || cur || '', (color) => {
          if (color === 'transparent') {
            slider.value = '0';
            sw.dataset.hex = '#000000';
          } else if (color) {
            sw.dataset.hex = color;
          }
          applyRgba();
        });
      });
      slider.addEventListener('input', applyRgba);
      wrap.append(sw, slider, val);
      return wrap;
    }
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'gb-fmt-swatch-bg';
    if (field.applyCustom === 'bgColor') sw.id = 'bd-bg-swatch';
    sw.style.background = cur || field.fallback || 'var(--bg3)';
    sw.title = field.label;
    sw.dataset.value = cur || '';
    _fsSetControlE2e(sw, field, rowLabel, 'swatch');
    sw.addEventListener('click', () => {
      if (typeof openColorPalette !== 'function') return;
      openColorPalette(sw, sw.dataset.value || '', (color) => {
        const raw = color === 'transparent' ? '' : color;
        adapter.set(field, raw);
        sw.style.background = raw || field.fallback || 'var(--bg3)';
        sw.dataset.value = raw || '';
        adapter.applyCss(field, raw);
        if (typeof _fsNotifyFieldChanged === 'function') _fsNotifyFieldChanged(sw, field, adapter, raw);
      });
    });
    return sw;
  }
  if (field.type === 'checkbox') {
    // defaultOn 付きのチェックボックス。on/off は保存値（例: '1'/'0'）。未設定時は defaultOn を参照
    const unset = cur === undefined || cur === null || cur === '';
    const checked = unset ? !!field.defaultOn : (cur === field.on);
    const wrap = document.createElement('label');
    wrap.className = 'bd-detail-check';
    _fsSetControlE2e(wrap, field, rowLabel, 'checkbox-label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    _fsSetControlE2e(input, field, rowLabel, 'checkbox');
    input.addEventListener('change', () => {
      const nextValue = input.checked ? field.on : field.off;
      adapter.set(field, nextValue);
      adapter.applyCss(field, nextValue);
      if (typeof _fsNotifyFieldChanged === 'function') _fsNotifyFieldChanged(input, field, adapter, nextValue);
    });
    const txt = document.createElement('span');
    // rowLabel と重複するプレフィックスがあれば短縮。他タブの toggle 類と同じ扱い
    txt.textContent = _fsShortLabel(field, rowLabel);
    wrap.append(input);
    if (txt.textContent) wrap.appendChild(txt);
    return wrap;
  }
  if (field.type === 'toggle') {
    // defaultOn: 値未設定時のデフォルト表示 (bd.autoAlign のように明示的オフのみ保存したい項目用)
    const isOn = _fsIsToggleOn(field, cur);
    const handleToggle = (btn) => {
      const nextOn = !btn.classList.contains('active');
      btn.classList.toggle('active', nextOn);
      btn.setAttribute('aria-pressed', nextOn ? 'true' : 'false');
      const nextValue = nextOn ? field.on : field.off;
      adapter.set(field, nextValue);
      adapter.applyCss(field, nextValue);
      if (typeof _fsNotifyFieldChanged === 'function') _fsNotifyFieldChanged(btn, field, adapter, nextValue);
    };
    if (typeof field.on === 'boolean' && typeof field.off === 'boolean') {
      const wrap = document.createElement('label');
      wrap.className = 'bd-detail-check';
      _fsSetControlE2e(wrap, field, rowLabel, 'toggle-label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = isOn;
      input.title = field.label;
      _fsSetControlE2e(input, field, rowLabel, 'toggle-checkbox');
      input.addEventListener('change', () => {
        const nextValue = input.checked ? field.on : field.off;
        adapter.set(field, nextValue);
        adapter.applyCss(field, nextValue);
        if (typeof _fsNotifyFieldChanged === 'function') _fsNotifyFieldChanged(input, field, adapter, nextValue);
      });
      const txt = document.createElement('span');
      txt.textContent = _fsShortLabel(field, rowLabel);
      wrap.append(input);
      if (txt.textContent) wrap.appendChild(txt);
      return wrap;
    }
    if (field.on === 'bold' || field.on === 'italic') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gb-fmt-btn' + (isOn ? ' active' : '');
      btn.innerHTML = field.on === 'bold' ? '<b>B</b>' : '<i>I</i>';
      btn.title = field.label;
      _fsSetControlE2e(btn, field, rowLabel, field.on === 'bold' ? 'bold' : 'italic');
      btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
      btn.addEventListener('click', () => handleToggle(btn));
      return btn;
    }
    // bool/その他のトグルはテキスト付きボタン。行プレフィックスがあれば短縮表示
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gb-fmt-btn' + (isOn ? ' active' : '');
    btn.textContent = _fsShortLabel(field, rowLabel);
    btn.title = field.label;
    _fsSetControlE2e(btn, field, rowLabel, 'toggle');
    btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
    btn.addEventListener('click', () => handleToggle(btn));
    return btn;
  }
  if (field.type === 'number') {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'gb-fmt-num gb-fmt-num--w70';
    if (field.min !== undefined) inp.min = String(field.min);
    if (field.max !== undefined) inp.max = String(field.max);
    if (field.step !== undefined) inp.step = String(field.step);
    inp.value = (cur !== undefined && cur !== null && cur !== '') ? String(cur) : '';
    inp.placeholder = '—';
    inp.title = field.label;
    _fsSetControlE2e(inp, field, rowLabel, 'number');
    inp.addEventListener('change', () => {
      const s = inp.value.trim();
      if (!s) {
        adapter.set(field, null);
        adapter.applyCss(field, '');
        if (typeof _fsNotifyFieldChanged === 'function') _fsNotifyFieldChanged(inp, field, adapter, '');
        return;
      }
      let n = parseFloat(s);
      if (isNaN(n)) {
        adapter.set(field, null);
        adapter.applyCss(field, '');
        if (typeof _fsNotifyFieldChanged === 'function') _fsNotifyFieldChanged(inp, field, adapter, '');
        return;
      }
      if (field.min !== undefined) n = Math.max(field.min, n);
      if (field.max !== undefined) n = Math.min(field.max, n);
      adapter.set(field, n);
      adapter.applyCss(field, n);
      if (typeof _fsNotifyFieldChanged === 'function') _fsNotifyFieldChanged(inp, field, adapter, n);
    });
    return inp;
  }
  if (field.type === 'rangeNumber') {
    const currentNumber = _fsParseBoundedNumber(cur, field, _fsParseBoundedNumber(field.fallback, field, 0));
    const wrap = document.createElement('span');
    wrap.className = 'gb-fs-range-number';

    const range = document.createElement('input');
    range.type = 'range';
    range.className = 'gb-fs-range-number__slider';
    if (field.min !== undefined) range.min = String(field.min);
    if (field.max !== undefined) range.max = String(field.max);
    if (field.step !== undefined) range.step = String(field.step);
    range.value = String(currentNumber);
    range.title = field.label;
    _fsSetControlE2e(range, field, rowLabel, 'range');

    const num = document.createElement('input');
    num.type = 'number';
    num.className = 'gb-fmt-num gb-fs-range-number__input';
    if (field.min !== undefined) num.min = String(field.min);
    if (field.max !== undefined) num.max = String(field.max);
    if (field.step !== undefined) num.step = String(field.step);
    num.value = String(currentNumber);
    num.title = field.label;
    _fsSetControlE2e(num, field, rowLabel, 'number');

    const unit = document.createElement('span');
    unit.className = 'gb-fmt-label';
    unit.textContent = field.unit || '';

    const commit = (raw) => {
      const n = _fsParseBoundedNumber(raw, field, currentNumber);
      range.value = String(n);
      num.value = String(n);
      const nextValue = String(n) + (field.unit || '');
      adapter.set(field, nextValue);
      adapter.applyCss(field, nextValue);
      if (typeof globalThis.GBUI?.refreshRangeFill === 'function') globalThis.GBUI.refreshRangeFill(range);
      if (typeof _fsNotifyFieldChanged === 'function') _fsNotifyFieldChanged(wrap, field, adapter, nextValue);
    };

    range.addEventListener('input', () => commit(range.value));
    num.addEventListener('input', () => {
      const n = parseFloat(String(num.value ?? '').replace(/px$/i, '').trim());
      if (!Number.isFinite(n)) return;
      if (field.min !== undefined && n < field.min) return;
      if (field.max !== undefined && n > field.max) return;
      range.value = String(n);
      if (typeof globalThis.GBUI?.refreshRangeFill === 'function') globalThis.GBUI.refreshRangeFill(range);
    });
    num.addEventListener('change', () => commit(num.value));
    if (typeof globalThis.GBUI?.refreshRangeFill === 'function') globalThis.GBUI.refreshRangeFill(range);

    wrap.append(range, num);
    if (unit.textContent) wrap.appendChild(unit);
    return wrap;
  }
  if (field.type === 'text' || field.type === 'pxtext') {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'gb-fmt-text ' + (field.type === 'text' ? 'gb-fmt-text--w120' : 'gb-fmt-text--w60');
    inp.value = cur || '';
    inp.placeholder = field.type === 'pxtext' ? '2px' : '—';
    inp.title = field.label;
    _fsSetControlE2e(inp, field, rowLabel, field.type);
    inp.addEventListener('change', () => {
      const s = inp.value.trim();
      adapter.set(field, s || '');
      adapter.applyCss(field, s || '');
      if (typeof _fsNotifyFieldChanged === 'function') _fsNotifyFieldChanged(inp, field, adapter, s || '');
    });
    return inp;
  }
  return document.createElement('span');
}
/* gb-detail-panel.part02.js */
// 行ラベル（例: "タイトル"）と field.label（例: "タイトル 色"）から短いラベルを返す。
// 行プレフィックスが一致したら除去、なければそのまま。
function _fsShortLabel(field, rowLabel) {
  if (!rowLabel) return field.label;
  if (field.label === rowLabel) return '';
  if (field.label.startsWith(rowLabel + ' ')) return field.label.slice(rowLabel.length + 1);
  if (field.label.startsWith(rowLabel)) {
    const short = field.label.slice(rowLabel.length).trimStart().replace(/^[をの]\s*/, '');
    return short || field.label;
  }
  return field.label;
}

function _fsBuildFieldInline(field, adapter, rowLabel) {
  // toggle は B/I or テキスト付きボタンで内蔵記号があるため、外側ラベルを付けない
  // checkbox は <input type="checkbox"> にラベルを付けた一体コンポーネントを返す
  if (field.type === 'toggle' || field.type === 'checkbox') {
    return _fsBuildControl(field, adapter, rowLabel);
  }
  // color / select / number / text / pxtext は短いラベル付きグループにまとめる
  const group = document.createElement('span');
  group.className = 'gb-fmt-popup-group';
  const label = document.createElement('span');
  label.className = 'gb-fmt-label';
  label.textContent = _fsShortLabel(field, rowLabel);
  if (field.label !== rowLabel) group.appendChild(label);
  group.appendChild(_fsBuildControl(field, adapter, rowLabel));
  if (field.type === 'number' && field.unit) {
    const unit = document.createElement('span');
    unit.className = 'gb-fmt-label';
    unit.textContent = field.unit;
    group.appendChild(unit);
  }
  return group;
}

function _fsBuildRowPreview(rowData, adapter) {
  const fields = rowData?.fields || [];
  const findBy = (test) => fields.find(test);
  const fontField = findBy(f => f.preview === 'fontSample' || f.key === '--bd-default-font-family');
  const fontSizeField = findBy(f => /font-size$/i.test(f.key || f.cssVar || '') || /FontSize$/i.test(f.key || ''));
  const fgField = findBy(f => f.type === 'color' && /(?:fg|color)$/i.test(f.key || '') && !/bg|border|grid|selection|caret|shadow/i.test(f.key || ''));
  const bgField = findBy(f => f.type === 'color' && /bg/i.test(f.key || ''));
  const lineField = findBy(f => f.type === 'color' && /border|grid|hr|active|shadow/i.test(f.key || ''));
  const boldField = findBy(f => f.type === 'toggle' && f.on === 'bold');
  const italicField = findBy(f => f.type === 'toggle' && f.on === 'italic');
  const sample = document.createElement('span');
  sample.className = 'cs-row-preview';
  sample.textContent = fontField ? 'あア A1 - 今日は快晴' : (lineField && !fgField && !bgField ? '━━' : (rowData.label || 'Aa1'));
  if (fontField) sample.dataset.previewKind = 'font';
  const fg = fgField ? _fsReadFieldValue(fgField, adapter) : '';
  const bg = bgField ? _fsReadFieldValue(bgField, adapter) : '';
  const line = lineField ? _fsReadFieldValue(lineField, adapter) : '';
  const bold = boldField ? _fsReadFieldValue(boldField, adapter) : '';
  const italic = italicField ? _fsReadFieldValue(italicField, adapter) : '';
  const fontFamily = fontField ? _fsNormalizeFieldValue(fontField, _fsReadFieldValue(fontField, adapter)) : '';
  const previewSize = typeof STYLE_PREVIEW_FONT_SIZES !== 'undefined'
    ? (STYLE_PREVIEW_FONT_SIZES[rowData.label] || STYLE_PREVIEW_FONT_SIZES['見出し ' + rowData.label] || '')
    : '';
  const fontSize = fontSizeField ? _fsReadFieldValue(fontSizeField, adapter) : previewSize;
  sample.style.background = bg || 'var(--bg)';
  sample.style.color = fg || line || 'var(--fg)';
  if (line) sample.style.borderBottom = '3px solid ' + line;
  if (bold === 'bold') sample.style.fontWeight = 'bold';
  if (italic === 'italic') sample.style.fontStyle = 'italic';
  if (fontSize) sample.style.fontSize = /^\d+(\.\d+)?$/.test(String(fontSize)) ? fontSize + 'px' : String(fontSize);
  if (fontField) sample.style.fontFamily = fontFamily || 'var(--bd-default-font-family, var(--bd-theme-font-family, var(--ui-font, inherit)))';
  return sample;
}

function _fsResolveSections(ctx, spec) {
  const byKey = Object.fromEntries([...spec.display, ...spec.editOps].map(field => [field.key, field]));
  const pick = (keys) => keys.map(key => byKey[key]).filter(Boolean);

  if (ctx === 'folder') {
    return [
      {
        title: '書式設定',
        rows: [
          { label: 'カード', fields: pick(['--fv-item-fg', '--fv-item-bg', '--fv-font-family']) },
          { label: 'カード枠線', fields: pick(['--fv-item-border']) },
          { label: 'ホバー', fields: pick(['--fv-item-hover-bg']) },
          { label: '選択', fields: pick(['--fv-item-selected-fg', '--fv-item-selected-bg']) },
          { label: 'メタ情報', fields: pick(['--fv-meta-fg']) },
          { label: 'アイコン', fields: pick(['--fv-icon-fg']) },
        ],
      },
    ];
  }

  if (ctx === 'scriptnote') {
    return [
      {
        title: '書式設定',
        rows: [
          { label: '基本テキスト', fields: pick(['baseTextColor', 'baseTextFontFamily', 'baseTextBold', 'baseTextItalic', 'baseTextFontSize']) },
          { label: '枠線', fields: pick(['borderColor', 'borderWidth']) },
          { label: '見開き区切り', fields: pick(['spreadBorderColor', 'spreadBorderWidth']) },
          { label: 'ホバー', fields: pick(['hoverBgColor']) },
          { label: 'テキスト選択', fields: pick(['selectionTextColor', 'selectionColor']) },
          { label: 'ドラッグ選択', fields: pick(['dragSelectColor']) },
          { label: 'ドロップ', fields: pick(['dropIndicatorColor', 'dropIndicatorWidth']) },
          { label: 'カーソル', fields: pick(['caretColor', 'caretWidth']) },
        ],
      },
      {
        title: 'レイアウト',
        rows: [
          { label: '行間', fields: pick(['baseTextLineHeightH', 'baseTextLineHeightV']) },
          { label: '字間', fields: pick(['baseTextLetterSpacingH', 'baseTextLetterSpacingV']) },
          { label: 'ルビ', fields: pick(['rubyFontSize', 'rubyOffset']) },
          { label: '折り返し', fields: pick(['wrapMode']) },
        ],
      },
    ];
  }

  if (ctx === 'page') {
    return [
      {
        title: '書式設定',
        rows: [
          { label: 'タイトル', fields: pick(['--page-title-fg', '--page-title-bg', '--page-title-bold', '--page-title-italic', '--page-title-font']) },
          { label: '見出し H1', fields: pick(['--page-h1-fg', '--page-h1-bg', '--page-h1-bold', '--page-h1-italic', '--page-h1-font']) },
          { label: '見出し H2', fields: pick(['--page-h2-fg', '--page-h2-bg', '--page-h2-bold', '--page-h2-italic', '--page-h2-font']) },
          { label: '見出し H3', fields: pick(['--page-h3-fg', '--page-h3-bg', '--page-h3-bold', '--page-h3-italic', '--page-h3-font']) },
          { label: '見出し H4', fields: pick(['--page-h4-fg', '--page-h4-bg', '--page-h4-bold', '--page-h4-italic', '--page-h4-font']) },
          { label: '見出し H5', fields: pick(['--page-h5-fg', '--page-h5-bg', '--page-h5-bold', '--page-h5-italic', '--page-h5-font']) },
          { label: '見出し H6', fields: pick(['--page-h6-fg', '--page-h6-bg', '--page-h6-bold', '--page-h6-italic', '--page-h6-font']) },
          { label: '本文',     fields: pick(['--page-text-fg', '--page-text-bold', '--page-text-italic', '--page-text-font']) },
          { label: 'リンク',   fields: pick(['--page-link-fg', '--page-link-bold', '--page-link-italic']) },
          { label: '引用ブロック', fields: pick(['--page-quote-fg', '--page-quote-bg', '--page-quote-bold', '--page-quote-italic']) },
          { label: '区切り線', fields: pick(['--page-hr-color']) },
          { label: '引用線', fields: pick(['--page-quote-border']) },
          { label: 'テキスト選択', fields: pick(['--page-selection-fg', '--page-selection-color']) },
          { label: 'カーソル', fields: pick(['--page-caret-color', '--page-caret-width']) },
        ],
      },
      {
        title: 'レイアウト',
        rows: [
          { label: '左右余白', fields: pick(['--page-margin-x']), preview: false },
          { label: '内容最大幅', fields: pick(['--page-content-max-width']), preview: false },
        ],
      },
    ];
  }

  if (ctx === 'db') {
    return [
      {
        title: '書式設定',
        rows: [
          { label: '全体',         fields: pick(['--db-header-bg', '--db-border-color']) },
          { label: '選択', fields: pick(['--db-selection-fg', '--db-selection-color']) },
          { label: 'ヘッダー',     fields: pick(['--db-th-fg', '--db-th-bg', '--db-th-bold', '--db-th-italic', '--db-th-font']) },
          { label: 'エントリ列',   fields: pick(['--db-entity-fg', '--db-entity-bg', '--db-entity-bold', '--db-entity-italic', '--db-entity-font']) },
          { label: 'セル',         fields: pick(['--db-cell-fg', '--db-cell-bg', '--db-cell-bold', '--db-cell-italic', '--db-cell-font']) },
          { label: 'アクティブセル枠', fields: pick(['--db-active-color', '--db-active-width']) },
          { label: 'テーブル罫線', fields: pick(['--db-grid-border', '--db-show-grid']) },
        ],
      },
    ];
  }

  if (ctx === 'board') {
    return [
      {
        title: '書式設定',
        rows: [
          { label: 'ボード背景', fields: pick(['--bd-bg', '__bd-bg-reset']), preview: false },
          { label: '影', fields: pick(['--bd-shadow', '--bd-shadow-color']) },
          { label: '標準フォント', fields: pick(['--bd-default-font-family']) },
          { label: '選択',     fields: pick(['--bd-selection-fg', '--bd-selection-color']) },
          { label: '矩形選択', fields: pick(['--bd-select-rect-color']) },
          { label: 'グループ', fields: pick(['--bd-group-color']) },
          { label: 'アンカー', fields: pick(['--bd-anchor-color']) },
          { label: 'カーソル', fields: pick(['--bd-caret-color', '--bd-caret-width']) },
        ],
      },
      {
        title: '背景画像',
        rows: [
          { label: '背景画像', fields: pick(['--bd-bg-image']) },
          { label: '画像表示', fields: pick(['--bd-bg-image-fit']) },
        ],
      },
      {
        title: 'レイアウト',
        rows: [
          { label: '隙間',     fields: pick(['--bd-gap-siblings', '--bd-gap-levels']) },
          { label: '整列',     fields: pick(['--bd-auto-align']) },
        ],
      },
    ];
  }

  // フォールバック: 1 フィールド = 1 行
  return [
    { title: '書式設定', rows: spec.display.map(f => ({ fields: [f] })) },
    { title: '編集操作', rows: spec.editOps.map(f => ({ fields: [f] })) },
  ];
}

function _fsThemeIdField(ctx) {
  return { key: ctx === 'scriptnote' ? 'themeId' : '__themeId', label: 'テーマ', type: 'themeId' };
}

function _fsOsAccentKey() {
  return typeof _FILE_STYLE_USE_OS_ACCENT_KEY !== 'undefined' ? _FILE_STYLE_USE_OS_ACCENT_KEY : '__useOsAccentColor';
}

function _fsUseOsAccentField() {
  return { key: _fsOsAccentKey(), label: 'OSアクセント', type: 'toggle' };
}

function _fsUseOsAccent(ctx, adapter) {
  const source = adapter || _fsGetAdapter(ctx);
  const value = source?.get?.(_fsUseOsAccentField());
  return value === true || value === 1 || value === '1' || value === 'true';
}

function _fsSetUseOsAccent(ctx, enabled) {
  const adapter = _fsGetAdapter(ctx);
  if (!adapter) return false;
  adapter.set(_fsUseOsAccentField(), enabled ? '1' : '');
  return true;
}

function fileThemeToggleOsAccent(ctx) {
  const adapter = _fsGetAdapter(ctx);
  const next = !_fsUseOsAccent(ctx, adapter);
  if (!_fsSetUseOsAccent(ctx, next)) return;
  const finish = () => {
    _fsApplyCurrentStyleRuntime(ctx);
    renderFileStyleTab(ctx);
  };
  if (next && typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.refreshOsAccentColor === 'function') {
    MeldexThemeManager.refreshOsAccentColor().finally(finish);
  } else {
    finish();
  }
}

function _fsCurrentThemeId(ctx, adapter) {
  const style = _fsGetStyleForContext(ctx) || {};
  const styleThemeId = style?.[_fsThemeIdField(ctx).key] || style?.themeId || '';
  if (_fsIsLocalCustomThemeId(styleThemeId)) return styleThemeId;
  if (ctx === 'board' && typeof bd !== 'undefined') return bd.themeId || styleThemeId || '';
  const value = adapter?.get?.(_fsThemeIdField(ctx));
  return String(value || '');
}

function _fsThemeOptionsHtml(currentId, ctx) {
  const cur = String(currentId || '');
  const inherit = `<option value=""${cur ? '' : ' selected'}>アプリ設定に従う</option>`;
  const localCustom = _fsIsLocalCustomThemeId(cur)
    ? `<option value="${esc(_fsLocalCustomThemeId())}" selected>${esc(_fsGetLocalCustomThemeName(ctx))}</option>`
    : '';
  if (typeof MeldexThemeManager === 'undefined' || typeof MeldexThemeManager.themeOptionsHtml !== 'function') {
    return inherit + localCustom;
  }
  return inherit + localCustom + MeldexThemeManager.themeOptionsHtml(cur || '__file-theme-inherit__', { includeSystem: true });
}

function _fsThemeAction(iconName, fallback, label, action, ctx, danger) {
  const icon = typeof lucide === 'function' ? lucide(iconName, 14) : fallback;
  return `<button type="button" class="bd-detail-style-action${danger ? ' bd-detail-style-action--danger' : ''}" data-fs-theme-action="${esc(action)}" data-e2e-id="file-style-theme-action-${esc(ctx)}-${esc(action)}" title="${esc(label)}" aria-label="${esc(label)}">${icon}</button>`;
}

function _fsRunThemeAction(ctx, action) {
  const handlers = {
    create: fileThemeCreate,
    duplicate: fileThemeDuplicate,
    rename: fileThemeRename,
    reset: fileThemeReset,
    save: fileThemeSave,
    delete: fileThemeDelete,
  };
  const handler = handlers[action];
  if (typeof handler !== 'function') return;
  try {
    const result = handler(ctx);
    if (result && typeof result.catch === 'function') {
      result.catch(error => {
        console.error(error);
        if (typeof showStatus === 'function') showStatus('テーマ操作に失敗しました', true);
      });
    }
  } catch (error) {
    console.error(error);
    if (typeof showStatus === 'function') showStatus('テーマ操作に失敗しました', true);
  }
}

function _fsThemePanelId(ctx) {
  return ctx === 'folder' ? 'folder-view'
    : ctx === 'page' ? 'page-content'
    : ctx === 'board' ? 'bd-canvas'
    : ctx === 'db' ? 'db-view-container'
    : '';
}

function _fsApplyCurrentStyleRuntime(ctx) {
  const style = _fsGetStyleForContext(ctx);
  if (ctx === 'scriptnote') {
    const ed = _getScriptNoteEditorForFileStyle?.();
    if (typeof ed?._render === 'function') ed._render();
    return;
  }
  const panelId = _fsThemePanelId(ctx);
  if (panelId && typeof clearFileStyleForPanel === 'function') clearFileStyleForPanel(panelId);
  if (panelId && typeof applyFileStyleToPanel === 'function') applyFileStyleToPanel(style, panelId);
  if (ctx === 'board') {
    if (typeof bdLoadBoardBackgroundFromStyle === 'function') bdLoadBoardBackgroundFromStyle();
    if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.applyBoardThemeRuntime === 'function' && typeof bd !== 'undefined') {
      MeldexThemeManager.applyBoardThemeRuntime(bd);
    }
    if (typeof bdRender === 'function') bdRender();
  }
}

function _fsThemeVarsForCurrent(ctx, adapter) {
  const id = _fsCurrentThemeId(ctx, adapter);
  if (_fsIsLocalCustomThemeId(id)) {
    const style = _fsGetStyleForContext(ctx) || {};
    const vars = {};
    Object.entries(style).forEach(([key, value]) => {
      if (String(key).startsWith('--') && value !== undefined && value !== null && value !== '') vars[key] = value;
    });
    if (_fsUseOsAccent(ctx, adapter) && typeof _applyFileStyleOsAccentVars === 'function') {
      _applyFileStyleOsAccentVars(vars);
      const colors = typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getOsAccentThemeColorSet === 'function'
        ? MeldexThemeManager.getOsAccentThemeColorSet()
        : [];
      if (Array.isArray(colors) && colors.length) {
        for (let i = 0; i < 10; i += 1) vars[`--theme-palette-${i}`] = colors[i % colors.length];
      } else {
        for (let i = 0; i < 10; i += 1) vars[`--theme-palette-${i}`] = 'var(--theme-os-accent, AccentColor)';
      }
    }
    return vars;
  }
  const vars = (id && typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getThemeById === 'function')
    ? { ...(MeldexThemeManager.getThemeById(id)?.ui?.cssVars || {}) }
    : {};
  if (_fsUseOsAccent(ctx, adapter) && typeof _applyFileStyleOsAccentVars === 'function') _applyFileStyleOsAccentVars(vars);
  return vars;
}

function _fsThemeColorSetKey(ctx, id) {
  return `${ctx}:${id || '__inherit__'}`;
}

function _fsThemeStandardPaletteAdjust(themeDef) {
  const ui = themeDef?.ui || {};
  const raw = Object.prototype.hasOwnProperty.call(ui, 'standardPaletteAdjust') ? ui.standardPaletteAdjust
    : Object.prototype.hasOwnProperty.call(themeDef || {}, 'standardPaletteAdjust') ? themeDef.standardPaletteAdjust
    : Object.prototype.hasOwnProperty.call(ui, '_standard-palette-adjust') ? ui['_standard-palette-adjust']
    : Object.prototype.hasOwnProperty.call(themeDef || {}, '_standard-palette-adjust') ? themeDef['_standard-palette-adjust']
    : null;
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.normalizeThemeStandardPaletteAdjust === 'function') {
    return MeldexThemeManager.normalizeThemeStandardPaletteAdjust(raw);
  }
  return raw;
}

function _fsThemeColorSlots(themeDef) {
  const ui = themeDef?.ui || {};
  return themeDef?.themeColorSlotSettings
    || ui.themeColorSlotSettings
    || themeDef?.['_theme-color-slot-settings']
    || ui['_theme-color-slot-settings']
    || null;
}

function _fsComputedThemeColorSet(themeDef) {
  if (!themeDef || typeof computeThemeColorSetFromSlots !== 'function') return null;
  const shouldUseGeneratedPalette = !!themeDef.builtIn
    || Object.prototype.hasOwnProperty.call(themeDef?.ui || {}, 'standardPaletteAdjust')
    || Object.prototype.hasOwnProperty.call(themeDef || {}, 'standardPaletteAdjust')
    || Object.prototype.hasOwnProperty.call(themeDef?.ui || {}, '_standard-palette-adjust')
    || Object.prototype.hasOwnProperty.call(themeDef || {}, '_standard-palette-adjust')
    || !!_fsThemeColorSlots(themeDef);
  if (!shouldUseGeneratedPalette) return null;
  const colors = computeThemeColorSetFromSlots(_fsThemeStandardPaletteAdjust(themeDef), _fsThemeColorSlots(themeDef));
  return Array.isArray(colors) && colors.length ? colors.slice() : null;
}

function _fsThemeColorSetForCurrent(ctx, adapter) {
  if (typeof MeldexThemeManager === 'undefined' || typeof MeldexThemeManager.getThemeColorSet !== 'function') return null;
  const style = _fsGetStyleForContext(ctx) || {};
  if (_fsIsLocalCustomThemeStyle(style) && !_fsUseOsAccent(ctx, adapter)) {
    return _fsLocalCustomPaletteFromStyle(style) || MeldexThemeManager.getThemeColorSet(undefined, { ignoreOsAccent: true });
  }
  if (_fsUseOsAccent(ctx, adapter)) {
    const colors = typeof MeldexThemeManager.getOsAccentThemeColorSet === 'function' ? MeldexThemeManager.getOsAccentThemeColorSet() : [];
    return Array.isArray(colors) && colors.length ? colors.slice() : ['var(--theme-os-accent, AccentColor)'];
  }
  const id = _fsCurrentThemeId(ctx, adapter);
  const pending = _fsPendingThemeColorSets[_fsThemeColorSetKey(ctx, id)];
  if (pending) return pending.slice();
  const defaultId = typeof MeldexThemeManager.getDefaultThemeId === 'function' ? MeldexThemeManager.getDefaultThemeId() : '';
  if (!id || (defaultId && id === defaultId)) {
    return MeldexThemeManager.getThemeColorSet(undefined, { ignoreOsAccent: true });
  }
  if (typeof MeldexThemeManager.getThemeById === 'function') {
    const themeDef = MeldexThemeManager.getThemeById(id);
    return _fsComputedThemeColorSet(themeDef) || MeldexThemeManager.getThemeColorSet(themeDef, { ignoreOsAccent: true });
  }
  return MeldexThemeManager.getThemeColorSet(undefined, { ignoreOsAccent: true });
}

function _fsLocalCustomThemeId() {
  return typeof _FILE_STYLE_LOCAL_CUSTOM_THEME_ID !== 'undefined'
    ? _FILE_STYLE_LOCAL_CUSTOM_THEME_ID
    : '__fileCustomTheme';
}

function _fsLocalCustomThemeNameKey() {
  return typeof _FILE_STYLE_LOCAL_CUSTOM_THEME_NAME_KEY !== 'undefined'
    ? _FILE_STYLE_LOCAL_CUSTOM_THEME_NAME_KEY
    : '__themeName';
}

function _fsLocalCustomThemeSourceKey() {
  return typeof _FILE_STYLE_LOCAL_CUSTOM_THEME_SOURCE_KEY !== 'undefined'
    ? _FILE_STYLE_LOCAL_CUSTOM_THEME_SOURCE_KEY
    : '__themeSourceId';
}

function _fsIsLocalCustomThemeId(id) {
  return String(id || '') === _fsLocalCustomThemeId();
}

function _fsGetLocalCustomThemeName(ctx) {
  const style = _fsGetStyleForContext(ctx) || {};
  return String(style[_fsLocalCustomThemeNameKey()] || 'カスタムテーマ').trim() || 'カスタムテーマ';
}

function _fsIsLocalCustomThemeStyle(style) {
  return _fsIsLocalCustomThemeId(style?.[_fsThemeIdField('').key] || style?.themeId || '');
}

function _fsLocalCustomPaletteFromStyle(style) {
  const colors = [];
  for (let i = 0; i < 10; i += 1) {
    const value = style?.[`--theme-palette-${i}`];
    if (value !== undefined && value !== null && value !== '') colors.push(String(value));
  }
  return colors.length ? colors : null;
}

function _fsThemeColorSetForThemeId(sourceId) {
  if (typeof MeldexThemeManager === 'undefined' || typeof MeldexThemeManager.getThemeColorSet !== 'function') return null;
  const themeDef = typeof MeldexThemeManager.getThemeById === 'function'
    ? MeldexThemeManager.getThemeById(sourceId || MeldexThemeManager.getDefaultThemeId?.())
    : null;
  if (!themeDef) return MeldexThemeManager.getThemeColorSet(undefined, { ignoreOsAccent: true });
  return _fsComputedThemeColorSet(themeDef) || MeldexThemeManager.getThemeColorSet(themeDef, { ignoreOsAccent: true });
}

function _fsStyleStorageKeyForField(ctx, field) {
  if (!field) return '';
  if (ctx === 'scriptnote') return field.key || '';
  return _fsThemeVarKeyForField(field) || field.key || '';
}

function _fsReadSourceThemeVar(sourceTheme, key, useDocumentValue) {
  const sourceVars = sourceTheme?.ui?.cssVars || {};
  if (useDocumentValue && typeof document !== 'undefined' && typeof getComputedStyle === 'function') {
    const root = document.documentElement;
    const value = (root?.style?.getPropertyValue?.(key) || getComputedStyle(root).getPropertyValue(key) || '').trim();
    if (value) return value;
  }
  const value = sourceVars[key];
  return value !== undefined && value !== null && value !== '' ? String(value) : '';
}

function _fsBuildLocalCustomThemeStyle(ctx, options = {}) {
  const adapter = options.adapter || _fsGetAdapter(ctx);
  const current = _fsGetStyleForContext(ctx) || {};
  const defaultThemeId = typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getDefaultThemeId === 'function'
    ? MeldexThemeManager.getDefaultThemeId()
    : '';
  const currentThemeId = _fsCurrentThemeId(ctx, adapter);
  const explicitSource = options.sourceId !== undefined && !_fsIsLocalCustomThemeId(options.sourceId);
  let sourceId = explicitSource
    ? String(options.sourceId || '')
    : String(current[_fsLocalCustomThemeSourceKey()] || currentThemeId || defaultThemeId || '');
  if (_fsIsLocalCustomThemeId(sourceId)) sourceId = defaultThemeId;
  const useDocumentSourceValues = !explicitSource && !String(currentThemeId || '').trim();
  const sourceTheme = typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getThemeById === 'function'
    ? MeldexThemeManager.getThemeById(sourceId || defaultThemeId)
    : null;
  const next = {};
  Object.keys(sourceTheme?.ui?.cssVars || {}).forEach(key => {
    if (!key.startsWith('--')) return;
    const value = _fsReadSourceThemeVar(sourceTheme, key, useDocumentSourceValues);
    if (value) next[key] = value;
  });
  _fsRenderableThemeFields(ctx).forEach(field => {
    const key = _fsStyleStorageKeyForField(ctx, field);
    if (!key || key === _fsThemeIdField(ctx).key) return;
    let value = '';
    if (explicitSource && key.startsWith('--')) {
      value = _fsReadSourceThemeVar(sourceTheme, key, false);
    }
    if (!value) value = _fsReadFieldValue(field, adapter);
    if (!value && !useDocumentSourceValues && key.startsWith('--')) value = _fsReadSourceThemeVar(sourceTheme, key, false);
    if (value !== undefined && value !== null && value !== '') next[key] = value;
  });
  const colorSet = explicitSource ? _fsThemeColorSetForThemeId(sourceId) : _fsThemeColorSetForCurrent(ctx, adapter);
  if (Array.isArray(colorSet) && colorSet.length) {
    for (let i = 0; i < 10; i += 1) next[`--theme-palette-${i}`] = colorSet[i % colorSet.length];
  }
  next[_fsThemeIdField(ctx).key] = _fsLocalCustomThemeId();
  next[_fsLocalCustomThemeNameKey()] = String(options.name || current[_fsLocalCustomThemeNameKey()] || 'カスタムテーマ').trim() || 'カスタムテーマ';
  if (sourceId) next[_fsLocalCustomThemeSourceKey()] = sourceId;
  return next;
}

function _fsPersistStyleViaAdapter(ctx, adapter, style, options = {}) {
  if (!options.skipHistory && typeof _fsApplyStyleWithHistory === 'function') {
    return _fsApplyStyleWithHistory(ctx, adapter, style, options.label || '書式設定変更', options.detail || '');
  }
  if (typeof _fsPersistStyleDirect === 'function') {
    return _fsPersistStyleDirect(ctx, adapter, style, options);
  }
  if (adapter && typeof adapter.saveStyle === 'function') return adapter.saveStyle(style, options);
  return _fsSaveStyleForContext(ctx, style);
}

function _fsEnsureLocalCustomThemeBeforeFieldSet(ctx, field, adapter, options = {}) {
  const key = field?.key || '';
  if (!options.force && (key === _fsThemeIdField(ctx).key || key === 'themeId' || key === _fsLocalCustomThemeNameKey() || key === _fsLocalCustomThemeSourceKey())) {
    return _fsGetStyleForContext(ctx) || {};
  }
  const current = _fsGetStyleForContext(ctx) || {};
  if (!options.force && _fsIsLocalCustomThemeStyle(current)) return current;
  const source = adapter || _fsGetAdapter(ctx);
  if (!source) return current;
  const next = _fsBuildLocalCustomThemeStyle(ctx, { ...options, adapter: source });
  if (ctx === 'board' && typeof bd !== 'undefined') bd.themeId = '';
  _fsPersistStyleViaAdapter(ctx, source, next, { skipHistory: !!options.skipHistory, skipUndo: !!options.skipUndo });
  return next;
}

function _fsRenderableThemeFields(ctx) {
  const spec = _FS_FIELDS[ctx] || { display: [], editOps: [] };
  const fields = [];
  const seen = new Set();
  const addField = (field) => {
    const id = field?.key || field?.cssVar || field?.label || '';
    if (!id || seen.has(id)) return;
    seen.add(id);
    fields.push(field);
  };
  [...(spec.display || []), ...(spec.editOps || [])].forEach(addField);
  if (typeof getFileThemePreviewMappedFields === 'function') {
    _fsResolveSections(ctx, spec).forEach(section => {
      (section.rows || []).forEach(row => {
        if (!row || row.preview === false) return;
        getFileThemePreviewMappedFields(row).forEach(addField);
      });
    });
  }
  return fields;
}

function _fsThemeVarKeyForField(field) {
  const key = String(field?.key || '').trim();
  if (key.startsWith('--')) return key;
  const cssVar = String(field?.cssVar || '').trim();
  return cssVar.startsWith('--') ? cssVar : '';
}

function _fsCollectThemeSaveVars(ctx) {
  const adapter = _fsGetAdapter(ctx);
  const vars = {};
  _fsRenderableThemeFields(ctx).forEach(field => {
    const themeKey = _fsThemeVarKeyForField(field);
    if (!themeKey) return;
    const value = adapter?.get ? adapter.get(field) : undefined;
    if (value !== undefined && value !== null && value !== '') vars[themeKey] = value;
  });
  return vars;
}

function _fsRenderThemeControlSection(ctx, adapter) {
  const current = _fsCurrentThemeId(ctx, adapter);
  const colorSet = _fsThemeColorSetForCurrent(ctx, adapter);
  const useOsAccent = _fsUseOsAccent(ctx, adapter);
  const osAccentColor = typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getOsAccentColor === 'function'
    ? MeldexThemeManager.getOsAccentColor()
    : '';
  return `
    <section class="gb-section gb-section--boxed fs-theme-management" data-file-theme-panel="${esc(ctx)}">
      <div class="gb-section-title">${typeof lucide === 'function' ? lucide('palette', 14) : ''} テーマ</div>
      <div class="gb-field-row fs-theme-row">
        <select class="gb-select fs-theme-select" data-fs-theme-select data-e2e-id="file-style-theme-select-${esc(ctx)}" aria-label="テーマ">
          ${_fsThemeOptionsHtml(current, ctx)}
        </select>
        <span class="bd-detail-style-row fs-theme-actions">
          ${_fsThemeAction('plus', '+', '新規カスタムテーマを作成', 'create', ctx)}
          ${_fsThemeAction('copy', '複製', '選択中テーマを複製', 'duplicate', ctx)}
          ${_fsThemeAction('pencil', '名前', 'テーマ名を変更', 'rename', ctx)}
          ${_fsThemeAction('rotateCcw', '戻す', 'デフォルトに戻す', 'reset', ctx)}
          ${_fsThemeAction('save', '保存', 'デフォルトとして保存', 'save', ctx)}
          ${_fsThemeAction('trash2', '削除', 'カスタムテーマを削除', 'delete', ctx, true)}
        </span>
      </div>
      ${typeof renderThemeColorSetEditor === 'function' ? renderThemeColorSetEditor(colorSet, { osAccent: useOsAccent, osAccentColor }) : ''}
    </section>`;
}

function _fsBindThemePanel(root, ctx) {
  if (!root) return;
  const section = root.querySelector('.fs-theme-management');
  if (!section) return;
  const adapter = _fsGetAdapter(ctx);
  if (typeof syncThemeColorSetSwatches === 'function') syncThemeColorSetSwatches(section, _fsThemeColorSetForCurrent(ctx, adapter));
  const select = section.querySelector('[data-fs-theme-select]');
  select?.addEventListener('change', () => fileThemeSelect(ctx, select.value));
  section.querySelectorAll('[data-fs-theme-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      _fsRunThemeAction(ctx, btn.dataset.fsThemeAction || '');
    });
  });
  _fsBindThemeColorSetEditor(section, ctx);
  _fsRefreshThemeActionStates(root, ctx);
  _fsEnsureThemePanelGlobalSync();
}

let _fsThemePanelGlobalSyncBound = false;
function _fsEnsureThemePanelGlobalSync() {
  if (_fsThemePanelGlobalSyncBound || typeof window === 'undefined') return;
  _fsThemePanelGlobalSyncBound = true;
  const refresh = () => {
    if (typeof syncThemeColorSetSwatches !== 'function') return;
    document.querySelectorAll('.fs-theme-management[data-file-theme-panel]').forEach(section => {
      const ctx = section.getAttribute('data-file-theme-panel') || '';
      if (!ctx) return;
      const adapter = _fsGetAdapter(ctx);
      syncThemeColorSetSwatches(section, _fsThemeColorSetForCurrent(ctx, adapter));
    });
  };
  window.addEventListener('meldex-theme-color-set-change', refresh);
  window.addEventListener('meldex-theme-change', refresh);
}

function _fsBindThemeColorSetEditor(root, ctx) {
  if (!root || typeof MeldexThemeManager === 'undefined') return;
  const adapter = _fsGetAdapter(ctx);
  const id = _fsCurrentThemeId(ctx, adapter);
  const key = _fsThemeColorSetKey(ctx, id);
  const isLocalCustom = _fsIsLocalCustomThemeId(id);
  const isCustom = isLocalCustom || !!(id && MeldexThemeManager.getCustomThemes().some(t => t.id === id));
  const currentColors = () => _fsPendingThemeColorSets[key]?.slice() || _fsThemeColorSetForCurrent(ctx, adapter) || [];
  const saveLocalPalette = (colors) => {
    const current = _fsGetStyleForContext(ctx) || {};
    const source = _fsIsLocalCustomThemeStyle(current)
      ? current
      : _fsBuildLocalCustomThemeStyle(ctx, { adapter, force: true });
    const next = { ...(source || _fsGetStyleForContext(ctx) || {}) };
    const normalized = typeof MeldexThemeManager.normalizeThemeColorSet === 'function'
      ? MeldexThemeManager.normalizeThemeColorSet(colors, currentColors())
      : colors;
    if (!Array.isArray(normalized) || !normalized.length) return;
    for (let i = 0; i < 10; i += 1) next[`--theme-palette-${i}`] = normalized[i % normalized.length];
    next[_fsThemeIdField(ctx).key] = _fsLocalCustomThemeId();
    next[_fsLocalCustomThemeNameKey()] = next[_fsLocalCustomThemeNameKey()] || 'カスタムテーマ';
    _fsPersistStyleViaAdapter(ctx, adapter, next, { label: 'テーマカラー変更' });
    _fsApplyCurrentStyleRuntime(ctx);
    renderFileStyleTab(ctx);
  };
  root.querySelector('[data-theme-os-accent-toggle]')?.addEventListener('click', () => {
    fileThemeToggleOsAccent(ctx);
  });
  root.querySelectorAll('[data-theme-color-slot]').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.themeColorSlot, 10);
      const colors = currentColors();
      openColorPalette(btn, colors[index] || colors[0] || '#ef4444', color => {
        if (!color || color === 'transparent') return;
        const next = currentColors();
        next[index] = color;
        if (!id || !isCustom || isLocalCustom) {
          saveLocalPalette(next);
          return;
        }
        _fsPendingThemeColorSets[key] = next;
        if (typeof syncThemeColorSetSwatches === 'function') syncThemeColorSetSwatches(root, next);
      });
    });
  });
  root.querySelector('[data-theme-color-reset]')?.addEventListener('click', () => {
    if (!id || !isCustom || isLocalCustom) {
      const sourceId = (_fsGetStyleForContext(ctx) || {})[_fsLocalCustomThemeSourceKey()] || MeldexThemeManager.getDefaultThemeId?.();
      const colors = _fsThemeColorSetForThemeId(sourceId);
      if (Array.isArray(colors) && colors.length) saveLocalPalette(colors);
      return;
    }
    delete _fsPendingThemeColorSets[key];
    if (typeof syncThemeColorSetSwatches === 'function') syncThemeColorSetSwatches(root, _fsThemeColorSetForCurrent(ctx, adapter));
  });
}

function _fsRefreshThemeActionStates(root, ctx) {
  const adapter = _fsGetAdapter(ctx);
  const id = _fsCurrentThemeId(ctx, adapter);
  const isCustom = _fsIsLocalCustomThemeId(id) || !!(id && typeof MeldexThemeManager !== 'undefined' && MeldexThemeManager.getCustomThemes().some(t => t.id === id));
  ['rename', 'save', 'delete'].forEach(action => {
    (root || document).querySelectorAll(`[data-fs-theme-action="${action}"]`).forEach(btn => { btn.disabled = !isCustom; });
  });
}

function fileThemeSelect(ctx, id) {
  const adapter = _fsGetAdapter(ctx);
  if (!adapter) return;
  const nextId = String(id || '');
  if (!nextId) {
    if (ctx === 'board' && typeof bd !== 'undefined') bd.themeId = '';
    _fsPersistStyleViaAdapter(ctx, adapter, null, { label: 'テーマ解除' });
    _fsApplyCurrentStyleRuntime(ctx);
    renderFileStyleTab(ctx);
    return;
  }
  if (_fsIsLocalCustomThemeId(nextId)) return;
  _fsEnsureLocalCustomThemeBeforeFieldSet(ctx, _fsThemeIdField(ctx), adapter, { force: true, sourceId: nextId, name: 'カスタムテーマ' });
  _fsApplyCurrentStyleRuntime(ctx);
  renderFileStyleTab(ctx);
}

async function fileThemeCreate(ctx) {
  const name = await cfPrompt('カスタムテーマ名', 'カスタムテーマ');
  if (name === null) return;
  const label = String(name || '').trim();
  if (!label) { showStatus('テーマ名を入力してください', true); return; }
  const adapter = _fsGetAdapter(ctx);
  _fsEnsureLocalCustomThemeBeforeFieldSet(ctx, _fsThemeIdField(ctx), adapter, { force: true, name: label });
  _fsApplyCurrentStyleRuntime(ctx);
  renderFileStyleTab(ctx);
  showStatus('カスタムテーマを作成しました');
}

async function fileThemeDuplicate(ctx) {
  if (typeof MeldexThemeManager === 'undefined') return;
  const adapter = _fsGetAdapter(ctx);
  const sourceId = _fsCurrentThemeId(ctx, adapter) || MeldexThemeManager.getDefaultThemeId();
  const name = await cfPrompt('複製後のテーマ名', 'カスタムテーマ');
  if (name === null) return;
  _fsEnsureLocalCustomThemeBeforeFieldSet(ctx, _fsThemeIdField(ctx), adapter, { force: true, sourceId, name: String(name || '').trim() || 'カスタムテーマ' });
  _fsApplyCurrentStyleRuntime(ctx);
  renderFileStyleTab(ctx);
  showStatus('カスタムテーマを複製しました');
}

async function fileThemeRename(ctx) {
  if (typeof MeldexThemeManager === 'undefined') return;
  const adapter = _fsGetAdapter(ctx);
  const id = _fsCurrentThemeId(ctx, adapter);
  if (_fsIsLocalCustomThemeId(id)) {
    const name = await cfPrompt('テーマ名', _fsGetLocalCustomThemeName(ctx));
    if (name === null) return;
    const label = String(name || '').trim();
    if (!label) { showStatus('テーマ名を入力してください', true); return; }
    const next = { ...(_fsGetStyleForContext(ctx) || {}) };
    next[_fsLocalCustomThemeNameKey()] = label;
    _fsPersistStyleViaAdapter(ctx, adapter, next, { label: 'テーマ名変更' });
    renderFileStyleTab(ctx);
    return;
  }
  const theme = MeldexThemeManager.getCustomThemes().find(t => t.id === id);
  if (!theme) { showStatus('組み込みテーマは名前を変更できません', true); return; }
  const name = await cfPrompt('テーマ名', theme.name);
  if (name === null) return;
  const renamed = MeldexThemeManager.renameCustomTheme(id, name);
  if (!renamed) { showStatus('テーマ名を入力してください', true); return; }
  renderFileStyleTab(ctx);
}

function fileThemeReset(ctx) {
  const adapter = _fsGetAdapter(ctx);
  if (!adapter) return;
  const id = _fsCurrentThemeId(ctx, adapter);
  if (_fsIsLocalCustomThemeId(id)) {
    fileThemeSelect(ctx, '');
    showStatus('デフォルトに戻しました');
    return;
  }
  if (ctx === 'board' && typeof bd !== 'undefined') {
    _fsPersistStyleViaAdapter(ctx, adapter, null, { label: 'テーマリセット' });
  } else if (ctx === 'scriptnote') {
    _fsPersistStyleViaAdapter(ctx, adapter, id ? { [_fsThemeIdField(ctx).key]: id } : null, { label: 'テーマリセット' });
  } else {
    _fsPersistStyleViaAdapter(ctx, adapter, id ? { [_fsThemeIdField(ctx).key]: id } : null, { label: 'テーマリセット' });
  }
  if (ctx !== 'scriptnote') {
    const panelId = _fsThemePanelId(ctx);
    if (panelId && typeof clearFileStyleForPanel === 'function') clearFileStyleForPanel(panelId);
  }
  _fsApplyCurrentStyleRuntime(ctx);
  renderFileStyleTab(ctx);
  showStatus('デフォルトに戻しました');
}

function _fsResetBoardRuntimeFileStyle() {
  if (typeof bd === 'undefined') return;
  bd._bgColor = '';
  bd._bgImage = '';
  bd._bgImageFit = '';
  bd._bgImageScale = 1;
  bd.gapSiblings = null;
  bd.gapLevels = null;
  bd.autoAlign = true;
  bd._showShadow = false;
  if (typeof bdApplyCanvasBackground === 'function') {
    const fallback = (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getActiveBoardTheme === 'function')
      ? MeldexThemeManager.getActiveBoardTheme(bd)?.board?.backgroundColor || ''
      : '';
    bdApplyCanvasBackground(null, fallback);
  }
  if (typeof bdApplyBoardFontVariables === 'function') bdApplyBoardFontVariables();
  if (typeof bdScheduleFontStyleMapUpdate === 'function') bdScheduleFontStyleMapUpdate();
}

function fileThemeSave(ctx) {
  if (typeof MeldexThemeManager === 'undefined') return;
  const adapter = _fsGetAdapter(ctx);
  const id = _fsCurrentThemeId(ctx, adapter);
  if (_fsIsLocalCustomThemeId(id)) {
    showStatus('カスタムテーマはファイル内に保存済みです', false, { showSaveDialog: true });
    return;
  }
  const list = MeldexThemeManager.getCustomThemes();
  const index = list.findIndex(t => t.id === id);
  if (index < 0) { showStatus('組み込みテーマはデフォルトとして保存できません。新規カスタムテーマを作成してください', true); return; }
  const theme = list[index];
  theme.ui = theme.ui || {};
  theme.ui.cssVars = { ...(theme.ui.cssVars || {}), ..._fsCollectThemeSaveVars(ctx) };
  const colorKey = _fsThemeColorSetKey(ctx, id);
  if (_fsPendingThemeColorSets[colorKey] && typeof MeldexThemeManager.normalizeThemeColorSet === 'function') {
    const colorSet = MeldexThemeManager.normalizeThemeColorSet(_fsPendingThemeColorSets[colorKey], theme.ui.colorSet);
    theme.themeColorSet = colorSet;
    theme.ui.themeColorSet = colorSet;
    theme.ui.colorSet = colorSet;
    theme.ui.palette = colorSet;
    delete _fsPendingThemeColorSets[colorKey];
  }
  MeldexThemeManager.saveCustomThemes(list);
  showStatus('デフォルトとして保存しました', false, { showSaveDialog: true });
}

async function fileThemeDelete(ctx) {
  if (typeof MeldexThemeManager === 'undefined') return;
  const adapter = _fsGetAdapter(ctx);
  const id = _fsCurrentThemeId(ctx, adapter);
  if (_fsIsLocalCustomThemeId(id)) {
    if (!await cfConfirm('ファイル内のカスタムテーマを削除して、アプリ設定に戻しますか？')) return;
    fileThemeSelect(ctx, '');
    showStatus('カスタムテーマを削除しました');
    return;
  }
  const theme = MeldexThemeManager.getCustomThemes().find(t => t.id === id);
  if (!theme) { showStatus('削除できるカスタムテーマが選択されていません', true); return; }
  if (!await cfConfirm('カスタムテーマ「' + theme.name + '」を削除しますか？')) return;
  delete _fsPendingThemeColorSets[_fsThemeColorSetKey(ctx, id)];
  MeldexThemeManager.deleteCustomTheme(id);
  fileThemeSelect(ctx, '');
  showStatus('カスタムテーマを削除しました');
}

// ctx: 'folder' | 'page' | 'db' | 'scriptnote' | 'board' | 'calendar'
function renderFileStyleTab(ctx) {
  const rpDetail = document.getElementById('rp-detail');
  if (rpDetail) _ensureDetailTabShell(rpDetail);
  const el = document.getElementById('detail-tab-file-style');
  if (!el) return;
  el.dataset.fileStyleContext = ctx || '';
  if (ctx !== 'calendar') el.removeAttribute('data-calendar-style');
  const ctxLabel = { folder: 'フォルダ', page: 'ノート', db: 'シート', scriptnote: 'シナリオ', board: 'ボード', calendar: 'カレンダー' }[ctx] || '';
  const spec = _FS_FIELDS[ctx] || { display: [], editOps: [] };
  const adapter = _fsGetAdapter(ctx);
  el.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding:var(--ui-space-4);display:flex;flex-direction:column;gap:var(--ui-space-4);';
  const hdr = document.createElement('div');
  hdr.className = 'gb-section-desc';
  hdr.textContent = '対象: ' + (ctxLabel || '—');
  wrap.appendChild(hdr);

  if (!adapter) {
    const empty = document.createElement('div');
    empty.className = 'gb-section-desc';
    empty.textContent = '対象エディタがアクティブではありません';
    wrap.appendChild(empty);
  } else {
    wrap.insertAdjacentHTML('beforeend', _fsRenderThemeControlSection(ctx, adapter));
    _fsResolveSections(ctx, spec).forEach(section => {
      const sec = document.createElement('section');
      sec.className = 'gb-section gb-section--detail';
      const title = document.createElement('h4');
      title.className = 'gb-section-title';
      title.textContent = section.title;
      sec.appendChild(title);
      section.rows.filter(row => row && Array.isArray(row.fields) && row.fields.length).forEach(rowData => {
        const row = document.createElement('div');
        row.className = 'gb-fmt-popup-row gb-fmt-popup-row--wrap';
        row._fsRowData = rowData;
        row._fsAdapter = adapter;
        if (rowData.label) {
          const groupLabel = document.createElement('span');
          groupLabel.className = 'gb-fmt-label gb-fmt-label--group';
          groupLabel.textContent = rowData.label;
          row.appendChild(groupLabel);
        }
        if (ctx !== 'scriptnote' && rowData.preview !== false) row.appendChild(_fsBuildRowPreview(rowData, adapter));
        rowData.fields.forEach(field => row.appendChild(_fsBuildFieldInline(field, adapter, rowData.label)));
        sec.appendChild(row);
      });
      wrap.appendChild(sec);
    });
  }

  el.appendChild(wrap);
  _fsBindThemePanel(el, ctx);
  if (typeof replaceIcons === 'function') replaceIcons();
}

function showCalendarDetailTabs(visible) {
  const rpDetail = document.getElementById('rp-detail');
  if (rpDetail) _ensureDetailTabShell(rpDetail);
  document.querySelectorAll('.detail-tab-calendar').forEach(t => {
    t.hidden = !visible;
  });
  // 非表示化時に現在のタブがスケジュール系ならコンテナも隠すためnullに切り替え
  if (!visible && ['calendar-today', 'calendar-settings', 'calendar-production'].includes(_currentDetailTab)) {
    switchDetailTab(null);
  }
}

function setCalendarTodayTabContent(html) {
  const rpDetail = document.getElementById('rp-detail');
  if (rpDetail) _ensureDetailTabShell(rpDetail);
  const el = document.getElementById('detail-tab-calendar-today');
  if (el) el.innerHTML = html || '';
}

// エントリ詳細はサブパネルに表示（旧詳細パネル経路からの互換転送）
async function _showEntityInDetailPanel(entityPath, entityName) {
  openEntityInSplit(entityPath, entityName);
}

/* ==============================
   スプリットビュー（画面二分割）
   ============================== */
let _splitPath = '';
let _splitDirty = false;
let _splitLoadSeq = 0;

// 台本エディタの詳細タブを非表示にする（グローバル関数）
function hideScriptnoteDetailTabs() {
  document.querySelectorAll('.detail-tab-scriptnote').forEach(el => el.remove());
  const container = document.getElementById('detail-tab-sn2-main');
  if (container) {
    const wrap = container.querySelector('.sn2-detail-wrap');
    if (wrap) wrap.style.display = 'none';
    container.style.display = 'none';
  }
  // 現在のタブがsn2-*なら状態をリセット
  if (_currentDetailTab && _currentDetailTab.startsWith('sn2-')) {
    _currentDetailTab = null;
  }
}

let _detailSyncSeq = 0;
// 詳細パネルが表示中なら、現在のコンテンツに合わせて自動更新する
async function _dpSavePendingBeforeDetailSwitch() {
  const el = document.getElementById('dp-editable');
  if (!el || !_splitDirty) return true;
  if (typeof _dpSavePending !== 'function') return false;
  return _dpSavePending();
}

async function _syncDetailPanel(label, path, type, opts) {
  const seq = ++_detailSyncSeq;
  if (type === 'entity') {
    if (!await _dpSavePendingBeforeDetailSwitch()) return false;
    if (seq !== _detailSyncSeq) return false;
    if (typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.clearDetailPaneShell === 'function') {
      GBPaneBridge.clearDetailPaneShell();
    }
    // ここは「開いているエントリに表示中の詳細を追従させる」ための同期処理。
    // 開いていないフロートパネル/ドロワーをここで開くと、既定パネルがメインパネルでも
    // フロートパネルが必ず一緒に開いてしまうため、既に開いている場合だけ追従させる。
    const drawerOpen = !!window.MeldexCloudMobileSideDrawer?.isOpen?.();
    const subPanelOpen = typeof GBSubPanel !== 'undefined' && typeof GBSubPanel.isOpen === 'function'
      ? GBSubPanel.isOpen('entity')
      : false;
    if (!drawerOpen && !subPanelOpen) return false;
    return openEntityInSplit(path, label);
  }
  // ペインシステム（#rp-detailが.gb-pane-content配下）ではcfg.visibleに関係なく同期する。
  // render中は #rp-detail が一時的に #legacy-views へ退避される。その瞬間に
  // detail-panel-cfg.visible を見て openRightPanelTab('detail') を呼ぶと、
  // ペイン再描画→詳細同期→再オープンが再帰してChromeを固める。
  // GBLayoutが有効ならDOM上の一時的な親に関係なくペインシステム扱いにする。
  const rpDetail = document.getElementById('rp-detail');
  const inPane = rpDetail && rpDetail.closest('.gb-pane-content');
  const paneLayoutActive = typeof GBLayout !== 'undefined' && !!GBLayout.root;
  let shouldOpenDetailPanel = false;
  if (!inPane && !paneLayoutActive) {
    const cfg = _getDetailPanelCfg();
    if (!cfg.visible) return;
    shouldOpenDetailPanel = !!(rpDetail && typeof _openDetailRightPanel === 'function');
  }
  if (!await _dpSavePendingBeforeDetailSwitch()) return false;
  if (seq !== _detailSyncSeq) return false;
  if (shouldOpenDetailPanel) _openDetailRightPanel();
  // タブシェルを確保（初回起動時の保険）
  if (rpDetail) _ensureDetailTabShell(rpDetail);
  if (type !== 'board') {
    if (typeof showBoardTabs === 'function') showBoardTabs(false);
    if (typeof hideBoardNoteTab === 'function') hideBoardNoteTab();
  }
  if (type !== 'calendar' && typeof showCalendarDetailTabs === 'function') showCalendarDetailTabs(false);
  if (type !== 'scriptnote') hideScriptnoteDetailTabs();
  const noteEditorTypes = new Set(['page']);
  const dbTypes = new Set(['database']);
  const publishTypes = new Set(['page', 'database', 'calendar', 'csv', 'smart-db', 'board', 'scriptnote']);
  if (typeof showNoteTabs === 'function') showNoteTabs(noteEditorTypes.has(type));
  if (typeof showDbTabs === 'function') showDbTabs(dbTypes.has(type));
  if (typeof showPublishDetailTab === 'function') showPublishDetailTab(publishTypes.has(type));
  // ファイルテーマタブは編集可能な主要タイプで共通表示
  const styleTypes = new Set(['folder', 'page', 'database', 'board', 'scriptnote']);
  if (typeof showFileStyleTab === 'function') {
    const show = styleTypes.has(type);
    showFileStyleTab(show);
    if (show) {
      const ctx = (type === 'page') ? 'page'
        : (type === 'folder') ? 'folder'
        : (type === 'board') ? 'board'
        : (type === 'scriptnote') ? 'scriptnote'
        : 'db';
      renderFileStyleTab(ctx);
    }
  }
  if (type === 'page') {
    // 詳細パネルにはファイル情報を表示（ノート内容はメインペインで表示済み）
    if (typeof _showFileInfoInDetailPanel === 'function') _showFileInfoInDetailPanel(path, opts?.fileMeta);
    else openInSplitView(label, path);
  } else if (type === 'folder') {
    // フォルダ選択時は詳細パネルにフォルダ情報を表示
    await showDetailPanel(`<div style="padding:8px;font-size:12px;color:var(--fg2);">
      <div style="font-weight:bold;font-size:12px;color:var(--fg);margin-bottom:8px;">${esc(label)}</div>
      <div>パス: ${esc(path)}</div>
      <div data-global-tags-target-path="${esc(path)}"></div>
    </div>`);
    if (seq !== _detailSyncSeq) return false;
    if (typeof hydrateGlobalTagTargetEditors === 'function') hydrateGlobalTagTargetEditors(document.getElementById('rp-detail') || document);
  } else if (type === 'database') {
    await _showDatabaseInfoInDetailPanel(label, path);
  }
}

// DB選択時：プロパティ設定タブにシート設定を表示
async function _showDatabaseInfoInDetailPanel(label, path) {
  const el = _resolveDetailEl();
  if (!el) return;
  _ensureDetailTabShell(el);
  const propSettings = el.querySelector('#detail-tab-db-property-settings');
  if (!propSettings) return;
  const seq = _detailSyncSeq;
  if (!await _dpSavePending()) return;
  if (seq !== _detailSyncSeq) return;
  if (typeof showDbTabs === 'function') showDbTabs(true);
  if (typeof switchDetailTab === 'function') {
    switchDetailTab(typeof _resolveDetailTabForType === 'function'
      ? _resolveDetailTabForType('database', 'db-property-settings')
      : 'db-property-settings');
  }
  const titleEl = el.querySelector('#split-right-title');
  if (titleEl) titleEl.textContent = label || path.split('/').pop();
  // エントリ表示からの切替時に残った dp-editable を削除
  _removeStaleDpEditables(el);
  if (typeof renderDbPropertySettingsPanel === 'function') {
    const s = (typeof state !== 'undefined') ? state : null;
    const selected = s?.selectedColumn?.dbPath === path ? s.selectedColumn.propName : '';
    renderDbPropertySettingsPanel(path, selected || '', propSettings);
  } else {
    propSettings.innerHTML = `<div class="gb-section-desc" style="padding:var(--ui-space-4);">
      ${esc(label || path.split('/').pop())} の列設定を読み込めませんでした
    </div>`;
  }
}
/* gb-detail-panel.part03.js */

function _fsRefreshRowPreview(row, adapter) {
  if (!row || !row._fsRowData || typeof _fsBuildRowPreview !== 'function') return;
  const oldPreview = row.querySelector(':scope > .cs-row-preview');
  if (!oldPreview) return;
  oldPreview.replaceWith(_fsBuildRowPreview(row._fsRowData, adapter || row._fsAdapter));
}

function _fsNotifyFieldChanged(anchor, field, adapter, value) {
  const row = anchor?.closest?.('.gb-fmt-popup-row');
  if (!row) return;
  if (field?.preview === 'fontSample') _fsUpdateFontSample(row, value);
  _fsRefreshRowPreview(row, adapter);
}

function _dpApplyNoteFileStyle(body, fm) {
  if (!body) return;
  const style = (typeof _parseFileStyleFromFrontmatter === 'function' ? _parseFileStyleFromFrontmatter(fm || '') : null)
    || (typeof _getDefaultFileStyle === 'function' ? _getDefaultFileStyle('page') : null)
    || {};
  if (typeof applyFileStyleToElement === 'function') {
    applyFileStyleToElement(style, body, 'page-content');
  }
  const root = body.closest?.('#rp-detail, [id^="detail-panel-"], .modal');
  const titleEl = root?.querySelector?.('#split-right-title');
  if (titleEl && typeof applyPageTitleStyleToElement === 'function') {
    applyPageTitleStyleToElement(style, titleEl);
  }
}

// カレンダーイベントフォームを詳細パネルに表示
function _showCalEventInDetailPanel(ev, calendars, defaultStart, defaultEnd, defaultAllDay, ownerComponent) {
  const el = _resolveDetailEl({ modal: true });
  if (!el) return;
  el._calComponent = ownerComponent || document.getElementById('rp-calendar')?._calComponent || null;
  const pos = _getDetailPanelCfg().position || 'right';
  el.style.display = '';

  const now = new Date();
  const _localISO = d => { const p = n => String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const isEdit = !!ev?.id;
  const startVal = isEdit ? ev.start?.substring(0,16) : (defaultStart || _localISO(now));
  const endVal = isEdit ? (ev.end || '').substring(0,16) : (defaultEnd || _localISO(new Date(now.getTime()+3600000)));
  const isAllDay = isEdit ? ev.all_day : !!defaultAllDay;
  const defaultCalendarId = !isEdit && ownerComponent?._calendarIdForNewEvent ? ownerComponent._calendarIdForNewEvent() : '';
  const calOpts = (calendars || []).map(c => `<option value="${esc(c.id)}" ${(ev?.calendar_id===c.id || (!isEdit && c.id===defaultCalendarId))?'selected':''}>${esc(c.name)}</option>`).join('');

  el.innerHTML = '';
  el.appendChild(_buildDpHeader(isEdit ? 'イベント編集' : '新規イベント', pos));

  const body = document.createElement('div');
  body.className = 'dp-event-form';
  body.innerHTML = `
    <div class="dp-field"><label for="dp-cal-title">タイトル</label><input id="dp-cal-title" class="gb-input" data-e2e-id="dp-cal-title" type="text" value="${esc(ev?.title || '')}" placeholder="イベント名"></div>
    <div class="dp-field"><label class="gb-check dp-event-check" for="dp-cal-allday"><input id="dp-cal-allday" class="gb-checkbox" data-e2e-id="dp-cal-allday" type="checkbox" ${isAllDay?'checked':''}><span>終日</span></label></div>
    <div class="dp-field"><label for="dp-cal-start">開始</label><input id="dp-cal-start" class="gb-input" data-e2e-id="dp-cal-start" type="datetime-local" value="${startVal}" ${isAllDay?'disabled':''}></div>
    <div class="dp-field"><label for="dp-cal-end">終了</label><input id="dp-cal-end" class="gb-input" data-e2e-id="dp-cal-end" type="datetime-local" value="${endVal}" ${isAllDay?'disabled':''}></div>
    ${calOpts ? `<div class="dp-field"><label for="dp-cal-calendar">カレンダー</label><select id="dp-cal-calendar" class="gb-select" data-e2e-id="dp-cal-calendar">${calOpts}</select></div>` : ''}
    <div class="dp-field"><span class="dp-field-label">色</span><button type="button" id="dp-cal-color" class="gb-color-swatch gb-color-swatch--field" data-e2e-id="dp-cal-color" data-color="${esc(ev?.color || '#569cd6')}" title="イベント色" aria-label="イベント色"></button></div>
    <div class="dp-field"><label for="dp-cal-location">場所</label><input id="dp-cal-location" class="gb-input" data-e2e-id="dp-cal-location" type="text" value="${esc(ev?.location || '')}"></div>
    <div class="dp-field"><label for="dp-cal-url">URL</label><input id="dp-cal-url" class="gb-input" data-e2e-id="dp-cal-url" type="url" value="${esc(ev?.url || '')}" placeholder="https://..."></div>
    <div class="dp-field"><label for="dp-cal-desc">説明</label><textarea id="dp-cal-desc" class="gb-textarea gb-textarea-sm" data-e2e-id="dp-cal-desc" rows="3">${esc(ev?.description || '')}</textarea></div>
    <div class="dp-cal-actions">
      ${isEdit ? `<button type="button" id="dp-cal-delete" class="gb-btn gb-btn-sm gb-btn-danger" data-e2e-id="dp-cal-delete">削除</button>` : ''}
      ${isEdit ? `<button type="button" id="dp-cal-comment-list" class="gb-btn gb-btn-sm" data-e2e-id="dp-cal-comment-list">コメント一覧</button>` : ''}
      ${isEdit ? `<button type="button" id="dp-cal-add-comment" class="gb-btn gb-btn-sm" data-e2e-id="dp-cal-add-comment">コメントを追加</button>` : ''}
      <span class="dp-cal-spacer"></span>
      <button type="button" id="dp-cal-save" class="gb-btn gb-btn-sm gb-btn-primary" data-e2e-id="dp-cal-save">${isEdit ? '更新' : '作成'}</button>
    </div>
  `;
  el.appendChild(body);

  const allDay = body.querySelector('#dp-cal-allday');
  const startInput = body.querySelector('#dp-cal-start');
  const endInput = body.querySelector('#dp-cal-end');
  const applyAllDayState = () => {
    const checked = !!allDay?.checked;
    [startInput, endInput].forEach(input => {
      if (!input) return;
      input.disabled = checked;
      input.classList.toggle('is-disabled', checked);
    });
  };
  allDay?.addEventListener('change', applyAllDayState);
  applyAllDayState();

  const colorSwatch = body.querySelector('#dp-cal-color');
  bindColorSwatch(colorSwatch, () => getColorSwatchValue(colorSwatch, ev?.color || '#569cd6'), (nextColor) => {
    setColorSwatchValue(colorSwatch, nextColor || '#569cd6');
  });
  // Audit-P1 H-6: イベント編集時のコメント追加（target_kind='calendar_event'）。
  // target_ref = { file: calendar_id || '_calendar', eventId: ev.id } で管理。
  if (isEdit && ev?.id) {
    const addBtn = body.querySelector('#dp-cal-add-comment');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        if (typeof addCommentHere !== 'function') return;
        const calId = (ev.calendar_id || '_calendar');
        addCommentHere({
          targetKind: 'calendar_event',
          filePath: calId,
          targetRef: { file: calId, eventId: ev.id },
          snapshot: (ev.title || '').trim().slice(0, 120),
        }, { anchorEl: addBtn });
      });
    }
    const listBtn = body.querySelector('#dp-cal-comment-list');
    if (listBtn) {
      listBtn.addEventListener('click', () => {
        const calId = (ev.calendar_id || '_calendar');
        if (typeof CommentBadges !== 'undefined' && typeof CommentBadges.openPanelForFileComments === 'function') {
          CommentBadges.openPanelForFileComments(calId);
        }
      });
    }
    body.querySelector('#dp-cal-delete')?.addEventListener('click', () => _dpCalDelete(ev.id));
  }
  body.querySelector('#dp-cal-save')?.addEventListener('click', () => _dpCalSave(isEdit ? ev.id : ''));
  setTimeout(() => body.querySelector('#dp-cal-title')?.focus(), 50);
}

async function _dpCalSave(editId) {
  // Phase C: CalendarComponentに直接undo記録を依頼
  const formRoot = document.getElementById('dp-cal-title')?.closest('.modal, #rp-detail, [id^="detail-panel-"]');
  const calComponent = formRoot?._calComponent || document.getElementById('rp-calendar')?._calComponent || null;
  if (calComponent) calComponent.pushUndo(editId ? 'イベント編集' : 'イベント作成');
  const data = {
    title: document.getElementById('dp-cal-title')?.value || '',
    start: document.getElementById('dp-cal-start')?.value || '',
    end: document.getElementById('dp-cal-end')?.value || '',
    all_day: document.getElementById('dp-cal-allday')?.checked ? 1 : 0,
    color: getColorSwatchValue(document.getElementById('dp-cal-color'), ''),
    location: document.getElementById('dp-cal-location')?.value || '',
    url: document.getElementById('dp-cal-url')?.value || '',
    description: document.getElementById('dp-cal-desc')?.value || '',
    calendar_id: document.getElementById('dp-cal-calendar')?.value || '',
    user: getUsername(),
  };
  try {
    if (editId) await apiPut('/cal/events/' + editId, data);
    else await apiPost('/cal/events', data);
    showStatus('イベントを保存しました');
    // Phase C: CalendarComponentに直接リロードを通知
    if (calComponent) calComponent.reload();
    _hideDetailPanel();
  } catch { showStatus('保存に失敗', true); }
}

async function _dpCalDelete(id) {
  if (!await cfConfirm('このイベントを削除しますか？')) return;
  // Phase C: CalendarComponentに直接undo記録を依頼
  const formRoot = document.getElementById('dp-cal-title')?.closest('.modal, #rp-detail, [id^="detail-panel-"]');
  const calComponent = formRoot?._calComponent || document.getElementById('rp-calendar')?._calComponent || null;
  if (calComponent) calComponent.pushUndo('イベント削除');
  // 削除前に calendar_id を拾っておく（対象絞り込み用）
  let calId = '';
  try {
    if (calComponent?._events) {
      const evRef = calComponent._events.find(x => x.id === id);
      calId = evRef?.calendar_id || '';
    }
  } catch (_) {}
  try {
    await apiFetch('/cal/events/' + id, { method: 'DELETE' });
    // Audit-P1 H-6: 削除成功後に紐付いたコメントを孤児化（target_kind='calendar_event'）
    apiPost('/annotations/orphan-by-target', {
      target_kind: 'calendar_event',
      target_file: calId || '_calendar',
      item_id: id,
      cascade_container: true,
    }).catch(() => {});
    showStatus('削除しました');
    // Phase C: CalendarComponentに直接リロードを通知
    if (calComponent) calComponent.reload();
    _hideDetailPanel();
  } catch { showStatus('削除に失敗', true); }
}

async function openInSplitView(label, path) {
  if (!await _dpSavePending()) return;
  const el = _resolveDetailEl();
  if (!el) return;
  el.style.display = '';
  _splitPath = path;
  _splitDirty = false;

  _ensureDetailTabShell(el);
  // タブ構造がない旧レイアウトの場合はフラットに構築（モーダル等のフォールバック）
  const noteEditor = el.querySelector('#detail-tab-note-editor');
  if (!noteEditor) {
    const pos = _getDetailPanelCfg().position || 'right';
    _removeStaleDpEditables(el);
    el.innerHTML = '';
    el.appendChild(_buildDpHeader(label || path.split('/').pop(), pos));
    const legacyBody = document.createElement('div');
    legacyBody.id = 'dp-editable';
    legacyBody.contentEditable = 'true';
    legacyBody.style.cssText = 'flex:1;padding:12px;overflow-y:auto;overscroll-behavior:contain;line-height:1.7;outline:none;font-size:12px;color:var(--page-text-fg,var(--fg));background:var(--page-text-bg,var(--content-bg,var(--bg)));';
    legacyBody.dataset.path = path;
    legacyBody.dataset.frontmatter = '';
    legacyBody.dataset.entityMode = '';
    legacyBody.innerHTML = '<span style="color:var(--fg2)">読み込み中...</span>';
    el.appendChild(legacyBody);
    _dpBindAutoSave(legacyBody);
    _dpLoadFileInto(legacyBody, path);
    return;
  }

  // 他ツールのタブを隠し、note-editorをアクティブ化
  if (typeof showBoardTabs === 'function') showBoardTabs(false);
  if (typeof hideBoardNoteTab === 'function') hideBoardNoteTab();
  if (typeof showCalendarDetailTabs === 'function') showCalendarDetailTabs(false);
  if (typeof hideScriptnoteDetailTabs === 'function') hideScriptnoteDetailTabs();
  if (typeof showDbTabs === 'function') showDbTabs(false);
  if (typeof showNoteTabs === 'function') showNoteTabs(true);
  if (typeof switchDetailTab === 'function') {
    switchDetailTab(typeof _resolveDetailTabForType === 'function'
      ? _resolveDetailTabForType('page', 'note-editor')
      : 'note-editor');
  }

  const titleEl = el.querySelector('#split-right-title');
  if (titleEl) titleEl.textContent = label || path.split('/').pop();

  // 既存の dp-editable を全削除（自動保存タイマーもクリア）
  _removeStaleDpEditables(el);
  noteEditor.innerHTML = '';
  const body = document.createElement('div');
  body.id = 'dp-editable';
  body.contentEditable = 'true';
  body.style.cssText = 'flex:1;padding:12px;overflow-y:auto;overscroll-behavior:contain;line-height:1.7;outline:none;font-size:12px;color:var(--page-text-fg,var(--fg));background:var(--page-text-bg,var(--content-bg,var(--bg)));';
  body.dataset.path = path;
  body.dataset.frontmatter = '';
  body.dataset.entityMode = '';
  body.innerHTML = '<span style="color:var(--fg2)">読み込み中...</span>';
  noteEditor.appendChild(body);
  _dpBindAutoSave(body);
  _dpLoadFileInto(body, path);
}

function _dpLoadFileInto(body, path) {
  const loadSeq = ++_splitLoadSeq;
  body.dataset.loadSeq = String(loadSeq);
  body.contentEditable = 'false';
  apiFetch('/file?path=' + encodeURIComponent(path)).then(data => {
    if (body.dataset.loadSeq !== String(loadSeq) || body.dataset.path !== path || _splitDirty) return;
    let md = data.content || '';
    const fmMatch = md.match(/^---\n[\s\S]*?\n---\n?/);
    const fm = fmMatch ? fmMatch[0] : '';
    if (fm) md = md.substring(fm.length);
    body.dataset.frontmatter = fm;
    _dpApplyNoteFileStyle(body, fm);
    const html = md.trim() ? applyAutoLinks(mdToHtml(md, { basePath: path }), path) : '';
    body.innerHTML = html || '<span style="color:var(--fg2)">内容がありません</span>';
    body.contentEditable = 'true';
  }).catch(() => {
    if (body.dataset.loadSeq !== String(loadSeq) || body.dataset.path !== path || _splitDirty) return;
    body.innerHTML = '<span style="color:var(--fg2)">読み込みに失敗しました</span>';
    body.contentEditable = 'true';
  });
}

// エントリ詳細はオプションパネルではなくサブパネルに表示する。
async function openEntityInSplit(entityPath, entityName) {
  if (!entityPath) return false;
  if (!await _dpSavePending()) return false;
  const name = entityName || entityPath.split('/').pop().replace(/\.md$/, '');
  _splitPath = entityPath;
  _splitDirty = false;
  if (window.MeldexCloudMobileSideDrawer?.openEntity?.(entityPath, name)) return true;
  if (typeof GBSubPanel !== 'undefined' && typeof GBSubPanel.open === 'function') {
    return GBSubPanel.open('entity', { path: entityPath, label: name });
  }
  if (typeof selectEntity === 'function') {
    await selectEntity(entityPath);
    return true;
  }
  return false;
}

// 独立詳細パネル用ヘッダー生成
function _buildDpHeader(title, pos) {
  const header = document.createElement('div');
  header.className = 'dp-detail-header';
  header.innerHTML = `<span id="split-right-title" class="dp-detail-title">${esc(title)}</span>
    <button type="button" class="gb-btn gb-btn-xs gb-btn-icon gb-btn-quiet" data-e2e-id="detail-panel-close" aria-label="詳細パネルを閉じる" title="閉じる">${lucide('x', 12)}</button>`;
  header.querySelector('[data-e2e-id="detail-panel-close"]')?.addEventListener('click', () => _hideDetailPanel());
  return header;
}

// 残留dp-editable要素を削除し、未発火の自動保存タイマーもクリアする
function _removeStaleDpEditables(root) {
  const scope = root || document;
  scope.querySelectorAll('#dp-editable').forEach(n => {
    if (n._autoSaveTimer) { clearTimeout(n._autoSaveTimer); n._autoSaveTimer = null; }
    n.remove();
  });
}

// 独立詳細パネルの編集エリアに自動保存+ドロップハンドラをバインド
function _dpBindAutoSave(el) {
  el.addEventListener('input', () => {
    _splitDirty = true;
    const autoVersionPath = el.dataset?.path || '';
    if (autoVersionPath && el._autoVersionPath !== autoVersionPath && typeof startAutoVersion === 'function') {
      startAutoVersion(autoVersionPath, 'file');
      el._autoVersionPath = autoVersionPath;
    }
    if (autoVersionPath && typeof markAutoVersionDirty === 'function') markAutoVersionDirty();
    // パネル固有のタイマー（グローバル共有を避ける）
    clearTimeout(el._autoSaveTimer);
    el._autoSaveTimer = setTimeout(() => { if (_splitDirty) _dpSave(el); }, 2000);
  });
  el.addEventListener('blur', () => { if (_splitDirty) _dpSave(el); });
  if (typeof setupEditableDropHandler === 'function') setupEditableDropHandler(el);
  // コンテキストメニュー（#dp-editable 用）を動的バインド。
  // global-contextmenu-refactor-plan.md に従い、document 委譲からコンテナ委譲へ移行。
  if (typeof bindNoteEditorContextMenu === 'function') bindNoteEditorContextMenu(el);
  if (typeof bindTableCellContextMenu === 'function') bindTableCellContextMenu(el);
}

// 独立詳細パネルの編集内容を保存
function _dpIsPlaceholderOnly(el) {
  if (!el || el.childNodes.length > 1) return false;
  const span = el.querySelector('span[style*="color:var(--fg2)"]');
  if (!span || span !== el.firstElementChild) return false;
  const text = (span.textContent || '').trim();
  return text === '内容がありません' || text === '読み込み中...' || text === '読み込みに失敗しました' || text === 'クリックして自由記述を編集';
}

function _dpBuildSavePayload(el) {
  if (!el) return null;
  const path = el.dataset.path;
  if (!path) return null;
  if (_dpIsPlaceholderOnly(el)) return null;
  let md = htmlToMd(el.innerHTML);
  const fm = el.dataset.frontmatter || '';
  if (fm) md = fm + md;
  return { path, content: md, html: el.innerHTML };
}

async function _dpSave(el) {
  if (!el) el = document.getElementById('dp-editable');
  if (!el || !_splitDirty) return true;
  const payload = _dpBuildSavePayload(el);
  if (!payload) {
    _splitDirty = false;
    return true;
  }
  try {
    await apiPut('/file?path=' + encodeURIComponent(payload.path), { content: payload.content, skip_if_missing: true });
    if (el.dataset.path === payload.path && el.innerHTML === payload.html) _splitDirty = false;
    return true;
  } catch (e) {
    if (typeof showStatus === 'function') showStatus('オプションの保存に失敗しました', true);
    return false;
  }
}

// 未保存内容があれば保存してからパネルを切り替え
async function _dpSavePending() {
  const el = document.getElementById('dp-editable');
  if (!el || !_splitDirty) return true;
  return _dpSave(el);
}

// 旧互換
function resetSplitPropsPanel() {}

async function closeSplitView() {
  if (!await _dpSavePending()) return false;
  _hideDetailPanel();
  _splitPath = '';
  return true;
}

async function clearDetailPanel() {
  if (!await _dpSavePending()) return false;
  _hideDetailPanel();
  _splitPath = '';
  _splitDirty = false;
  return true;
}

function saveSplitContent() {
  return _dpSave();
}

// スプリットビューのドロップハンドラ設定（v5.0: split-right-contentは廃止、dp-editableは動的に作成されるため_dpBindAutoSave内で設定）

function toggleSplitView() {
  // 後方互換: toggleRightPanel + 詳細タブ
  toggleRightPanel();
}

// ボードのカードからリンク先を開く
function bdOpenNodeLink(nodeId) {
  const n = bd.nodes.find(v => v.id === nodeId);
  if (!n || !n.link) return false;
  if (typeof _bdOpenLinkedTarget === 'function') _bdOpenLinkedTarget(n);
  else {
    const label = n.text || n.link.split('/').pop();
    openInSplitView(label, n.link);
  }
  return true;
}


// ボードのリンク付きカード選択時にノートタブで内容を表示
let _boardNotePath = '';
let _boardNoteDirty = false;
let _boardNoteLoadSeq = 0;

async function openBoardNoteTab(label, path) {
  if (!path) return;
  // ノートタブを表示
  document.querySelectorAll('.detail-tab-board-note').forEach(t => { t.hidden = false; });

  // 既に同じパスが表示中なら切り替えのみ
  if (_boardNotePath === path) {
    switchDetailTab('board-note');
    return;
  }

  // 前回のノートを保存
  if (!await _saveBoardNote()) return;

  _boardNotePath = path;
  _boardNoteDirty = false;
  const loadSeq = ++_boardNoteLoadSeq;

  const body = document.getElementById('board-note-editable');
  if (!body) return;
  body.contentEditable = 'false';
  body.dataset.boardNoteLoadSeq = String(loadSeq);
  body.innerHTML = '<span style="color:var(--fg2)">読み込み中...</span>';
  body.dataset.frontmatter = '';

  apiFetch('/file?path=' + encodeURIComponent(path)).then(data => {
    if (loadSeq !== _boardNoteLoadSeq || _boardNotePath !== path || body.dataset.boardNoteLoadSeq !== String(loadSeq) || _boardNoteDirty) return;
    let md = data.content || '';
    const fmMatch = md.match(/^---\n[\s\S]*?\n---\n?/);
    const fm = fmMatch ? fmMatch[0] : '';
    if (fm) md = md.substring(fm.length);
    body.dataset.frontmatter = fm;
    _dpApplyNoteFileStyle(body, fm);
    body.innerHTML = md.trim() ? applyAutoLinks(mdToHtml(md, { basePath: path }), path) : '<span style="color:var(--fg2)">内容がありません</span>';
    body.contentEditable = 'true';
    _boardNoteDirty = false;
  }).catch(() => {
    if (loadSeq !== _boardNoteLoadSeq || _boardNotePath !== path || body.dataset.boardNoteLoadSeq !== String(loadSeq) || _boardNoteDirty) return;
    body.innerHTML = '<span style="color:var(--fg2)">読み込みに失敗しました</span>';
    body.contentEditable = 'true';
  });

  // 自動保存バインド
  body.oninput = () => { _boardNoteDirty = true; };
  if (body._boardNoteSaveTimer) clearInterval(body._boardNoteSaveTimer);
  // body が DOM から外れたら interval を自己クリーンアップして孤児化を防ぐ
  body._boardNoteSaveTimer = setInterval(() => {
    if (!body.isConnected) {
      clearInterval(body._boardNoteSaveTimer);
      body._boardNoteSaveTimer = null;
      return;
    }
    _saveBoardNote();
  }, 3000);

  switchDetailTab('board-note');
}

function _buildBoardNoteSavePayload(body) {
  if (!body || !_boardNotePath) return null;
  if (_dpIsPlaceholderOnly(body)) return null;
  const fm = body.dataset.frontmatter || '';
  const md = htmlToMd(body.innerHTML);
  return { path: _boardNotePath, content: fm + md, html: body.innerHTML };
}

async function _saveBoardNote() {
  if (!_boardNoteDirty || !_boardNotePath) return true;
  const body = document.getElementById('board-note-editable');
  if (!body) return true;
  const payload = _buildBoardNoteSavePayload(body);
  if (!payload) return true;
  try {
    await apiPut('/file?path=' + encodeURIComponent(payload.path), { content: payload.content, skip_if_missing: true });
    if (_boardNotePath === payload.path && body.innerHTML === payload.html) _boardNoteDirty = false;
    return true;
  } catch (e) {
    if (typeof showStatus === 'function') showStatus('ボードノートの保存に失敗しました', true);
    return false;
  }
}

function hideBoardNoteTab() {
  const finalizeHide = () => {
    _boardNotePath = '';
    _boardNoteDirty = false;
    const body = document.getElementById('board-note-editable');
    if (body && body._boardNoteSaveTimer) {
      clearInterval(body._boardNoteSaveTimer);
      body._boardNoteSaveTimer = null;
    }
    document.querySelectorAll('.detail-tab-board-note').forEach(t => { t.hidden = true; });
    if (_currentDetailTab === 'board-note') {
      // board-note が閉じられた時、表示中のカード/ライン タブがあればそこへ、
      // 無ければテーマ (file-style) にフォールバックする。
      const cardTab = document.querySelector('.detail-tab-board-card');
      const lineTab = document.querySelector('.detail-tab-board-line');
      const cardVisible = cardTab && !cardTab.hidden;
      const lineVisible = lineTab && !lineTab.hidden;
      const fileStyleTab = document.querySelector('.detail-tab-file-style');
      const fileStyleVisible = fileStyleTab && !fileStyleTab.hidden;
      const next = cardVisible ? 'board-card'
        : lineVisible ? 'board-line'
        : fileStyleVisible ? 'file-style'
        : null;
      switchDetailTab(next);
    }
  };
  if (_boardNoteDirty && _boardNotePath) {
    _saveBoardNote().then(ok => { if (ok) finalizeHide(); });
    return;
  }
  finalizeHide();
}
