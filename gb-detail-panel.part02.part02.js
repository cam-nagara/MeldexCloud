  if (typeof replaceIcons === 'function') replaceIcons();
}

function showCalendarDetailTabs(visible) {
  const rpDetail = document.getElementById('rp-detail');
  if (rpDetail) _ensureDetailTabShell(rpDetail);
  document.querySelectorAll('.detail-tab-calendar').forEach(t => {
    t.hidden = !visible;
  });
  // 非表示化時に現在のタブがスケジューラー系ならコンテナも隠すためnullに切り替え
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
    return openEntityInSplit(path, label);
  }
  // ペインシステム（#rp-detailが.gb-pane-content配下）ではcfg.visibleに関係なく同期する。
  // レガシーな独立パネルの場合のみ cfg.visible をチェックする。
  const rpDetail = document.getElementById('rp-detail');
  const inPane = rpDetail && rpDetail.closest('.gb-pane-content');
  let shouldOpenDetailPanel = false;
  if (!inPane) {
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
  // タグ管理タブはエクスプローラー（folder-view）アクティブ時のみ表示
  if (typeof showTagManagementTab === 'function') showTagManagementTab(type === 'folder');
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
      ${esc(label || path.split('/').pop())} のプロパティ設定を読み込めませんでした
    </div>`;
  }
}
