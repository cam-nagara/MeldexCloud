    <div class="bd-detail-panel" data-bd-detail-root="node" data-node-id="${_bdEscAttr(node.id)}">
      ${sections.join('')}
    </div>`;
}

function _bdCanRenderDetailPanel() {
  const detailHost = document.getElementById('rp-detail');
  if (detailHost?.closest('.gb-pane-content')) return true;
  return typeof _getDetailPanelCfg === 'function' ? !!_getDetailPanelCfg().visible : false;
}

function _bdCanUseBoardDetailTabs() {
  const detailHost = document.getElementById('rp-detail');
  if (!detailHost?.closest('.gb-pane-content')) return false;
  if (typeof _ensureDetailTabShell === 'function') _ensureDetailTabShell(detailHost);
  return !!detailHost.querySelector('#detail-tab-board-card')
    && typeof setBoardDetailTabContent === 'function'
    && typeof showBoardTabs === 'function'
    && typeof switchDetailTab === 'function';
}

function _bdEnsureBoardFileStyleTab() {
  if (typeof showFileStyleTab === 'function') showFileStyleTab(true);
  if (typeof renderFileStyleTab === 'function') renderFileStyleTab('board');
}

// カード選択時: カードタブに集約した HTML を入れ、カードタブを表示してアクティブに。
// ラインタブは非表示にする (選択中に同時に存在する場合のみライン側が別途上書きする)。
// スタイル管理タブ (カード/ライン/階層別スタイル) はボード表示中は常に出す。
function _bdSetNodeDetailTabs(node, cardHtml, options = {}) {
  if (typeof setBoardDetailTabContent === 'function') {
    setBoardDetailTabContent({ card: cardHtml, line: '' });
  }
  if (typeof showNoteTabs === 'function') showNoteTabs(false);
  if (typeof showDbTabs === 'function') showDbTabs(false);
  if (typeof showBoardTabs === 'function') showBoardTabs({ card: true, line: false, cardStyle: true, lineStyle: true, depthStyle: true });
  _bdEnsureBoardFileStyleTab();
  _bdEnsureBoardStyleManagerTabs();
  // 選択操作時は必ず「カード」タブへ移動する。スタイル編集などの内部再描画では
  // ユーザーが開いている file-style / backlinks / board-note / スタイル管理タブを維持する。
  const nextTab = options.activate === true
    ? 'board-card'
    : (typeof _bdResolveCurrentBoardTab === 'function'
      ? _bdResolveCurrentBoardTab(['board-card', 'board-note', 'board-card-style', 'board-line-style', 'board-depth-style'], 'board-card')
      : 'board-card');
  if (typeof switchDetailTab === 'function') switchDetailTab(nextTab);
}

// ライン選択時: ラインタブに HTML を入れ、ラインタブを表示してアクティブに。
function _bdSetConnDetailTab(connHtml, options = {}) {
  if (typeof setBoardDetailTabContent === 'function') {
    setBoardDetailTabContent({ card: '', line: connHtml });
  }
  if (typeof showNoteTabs === 'function') showNoteTabs(false);
  if (typeof showDbTabs === 'function') showDbTabs(false);
  if (typeof showBoardTabs === 'function') showBoardTabs({ card: false, line: true, cardStyle: true, lineStyle: true, depthStyle: true });
  _bdEnsureBoardFileStyleTab();
  _bdEnsureBoardStyleManagerTabs();
  const nextTab = options.activate === true
    ? 'board-line'
    : (typeof _bdResolveCurrentBoardTab === 'function'
      ? _bdResolveCurrentBoardTab(['board-line', 'board-note', 'board-card-style', 'board-line-style', 'board-depth-style'], 'board-line')
      : 'board-line');
  if (typeof switchDetailTab === 'function') switchDetailTab(nextTab);
}

// 何も選択されていない (ボード全体) 時: カード / ライン タブは非表示、テーマタブをアクティブに。
// スタイル管理タブはボード表示中は常に出す。
function _bdSetBoardPrimaryTab() {
  if (typeof setBoardDetailTabContent === 'function') {
    setBoardDetailTabContent({ card: '', line: '' });
  }
  if (typeof showNoteTabs === 'function') showNoteTabs(false);
  if (typeof showDbTabs === 'function') showDbTabs(false);
  if (typeof showBoardTabs === 'function') showBoardTabs({ card: false, line: false, cardStyle: true, lineStyle: true, depthStyle: true });
  _bdEnsureBoardFileStyleTab();
  _bdEnsureBoardStyleManagerTabs();
  // デフォルトはテーマタブ。ユーザーが backlinks / board-note / スタイル管理タブを選んでいた場合は尊重。
  const nextTab = typeof _bdResolveCurrentBoardTab === 'function'
    ? _bdResolveCurrentBoardTab(['board-note', 'board-card-style', 'board-line-style', 'board-depth-style'], 'file-style')
    : 'file-style';
  if (typeof switchDetailTab === 'function') switchDetailTab(nextTab);
}

// 3つのスタイル管理タブ (カードスタイル / ラインスタイル / 階層別スタイル) のコンテンツを
// 初期化 / 再描画する。各タブは一度レンダー済みなら以後のイベント反映で済むため毎回は再描画しない。
function _bdEnsureBoardStyleManagerTabs() {
  const renderers = [
    { id: 'detail-tab-board-card-style', kind: 'card' },
    { id: 'detail-tab-board-line-style', kind: 'line' },
    { id: 'detail-tab-board-depth-style', kind: 'depth' },
  ];
  renderers.forEach(entry => {
    const el = document.getElementById(entry.id);
    if (!el) return;
    // 既にレンダー済みなら skip (子要素が存在する)
    if (el.childElementCount > 0) return;
    if (entry.kind === 'depth') {
      if (typeof _bdRenderDepthStyleInPanel === 'function') _bdRenderDepthStyleInPanel(el);
    } else {
      if (typeof _bdRenderStyleManagerInPanel === 'function') _bdRenderStyleManagerInPanel(entry.kind, el, null);
    }
  });
}

function _bdRenderBoardPrimaryDetail() {
  if (_bdCanUseBoardDetailTabs()) {
    _bdSetBoardPrimaryTab();
    return;
  }
  // タブ機能が無い古い環境: テーマ表示のみ (ボード全体設定 UI は廃止)
  if (typeof showDetailPanel === 'function') showDetailPanel('');
}

function _bdRenderNodeDetailPanels(node, panels, options = {}) {
  const cardHtml = (panels && panels.contentHtml) || '';
  if (_bdCanUseBoardDetailTabs()) {
    _bdSetNodeDetailTabs(node, cardHtml, options);
    return;
  }
  if (typeof showDetailPanel === 'function') showDetailPanel(cardHtml);
}

function _bdBuildNodeDetailHtml(node) {
  const style = bdGetNodeStyle(node);
  const markerHtml = typeof BD_MARKERS === 'undefined'
    ? ''
    : Object.entries(BD_MARKERS).map(([category, markers]) => _bdMarkerSelectHtml(node, category, markers)).join('');
  const parent = node.parent ? (bd.nodes.find(item => item.id === node.parent)?.text?.split('\n')[0] || node.parent) : 'なし';
  const opacityPct = node.opacity != null ? Math.round(Math.max(0, Math.min(1, node.opacity)) * 100) : 100;
  const title = (node.text || '').split('\n')[0] || '無題カード';
  const plusIcon = typeof lucide === 'function' ? lucide('plus', 14) : '+';
  const saveIcon = typeof lucide === 'function' ? lucide('save', 14) : '保存';
  const resetIcon = typeof lucide === 'function' ? lucide('rotateCcw', 14) : 'リセット';
  const exportIcon = typeof lucide === 'function' ? lucide('upload', 14) : '出力';
  const paletteIcon = typeof lucide === 'function' ? lucide('palette', 14) : '色';
  // カードタブ集約版: 旧「基本/配置/拡張」を 1 タブ内のセクションにまとめる。
  const contentHtml = _bdNodePanelHtml(node, title, [`
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">基本</div>
        <label class="bd-detail-field bd-detail-field-wide"><span>テキスト</span><textarea data-bd-field="text">${esc(node.text || '')}</textarea></label>
        <label class="bd-detail-field bd-detail-field-wide"><span>リンク先</span><input type="text" value="${_bdEscAttr(node.link || '')}" data-bd-field="link"></label>
        ${node.img ? `<label class="bd-detail-field bd-detail-field-wide"><span>画像</span><input type="text" value="${_bdEscAttr(node.img || '')}" data-bd-field="img"></label>` : ''}
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">カードスタイル</div>
        <div class="bd-detail-style-row">
          ${_bdDetailStyleTriggerHtml('card', node.cardStyle || bd.activeCardStyle, 'data-bd-node-style-pick')}
          <button type="button" class="bd-detail-style-action" data-bd-action="save-node-card-style-as-new" title="現在の設定を新しいスタイルとして保存">${plusIcon}</button>
          <button type="button" class="bd-detail-style-action" data-bd-action="save-node-card-style" title="選択中スタイルをデフォルトとして保存">${saveIcon}</button>
          <button type="button" class="bd-detail-style-action" data-bd-action="reset-node-card-style" title="スタイルをデフォルトに戻す">${resetIcon}</button>
        </div>
        <div class="bd-style-summary-card"><div class="bd-style-editor-fields bd-style-editor-fields--fmt" data-bd-node-card-style-fields></div></div>
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">表示</div>
        <label class="bd-detail-check"><input type="checkbox" data-bd-field="minimized" ${node.minimized ? 'checked' : ''}><span>最小化</span></label>
        <label class="bd-detail-check"><input type="checkbox" data-bd-field="collapsed" ${node.collapsed ? 'checked' : ''}><span>折りたたみ</span></label>
        <label class="bd-detail-check"><input type="checkbox" data-bd-field="locked" ${node.locked ? 'checked' : ''}><span>ロック</span></label>
        <div class="bd-detail-inline-actions">
          <button type="button" class="gb-btn gb-btn-sm" data-bd-action="manage-card-styles">スタイル管理</button>
          ${node.link ? '<button type="button" class="gb-btn gb-btn-sm" data-bd-action="open-link">リンク先を開く</button>' : ''}
        </div>
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">カードサイズ</div>
        <label class="bd-detail-field"><span>幅</span><input type="number" class="gb-fmt-num" min="40" value="${Math.round(node.w || style.width || 160)}" data-bd-field="w"></label>
        <label class="bd-detail-field"><span>高さ</span><input type="number" class="gb-fmt-num" min="0" value="${Math.round(node.h || 0)}" data-bd-field="h"></label>
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">配置</div>
        <label class="bd-detail-field"><span>X</span><input type="number" class="gb-fmt-num" value="${Math.round(node.x || 0)}" data-bd-field="x"></label>
        <label class="bd-detail-field"><span>Y</span><input type="number" class="gb-fmt-num" value="${Math.round(node.y || 0)}" data-bd-field="y"></label>
        <label class="bd-detail-field"><span>親カード</span><input type="text" value="${_bdEscAttr(parent)}" readonly data-e2e-id="bd-node-parent-label"></label>
        <label class="bd-detail-check"><input type="checkbox" data-bd-field="container" ${node.container ? 'checked' : ''}><span>コンテナ</span></label>
        <label class="bd-detail-check"><input type="checkbox" data-bd-field="_followChildren" ${node._followChildren ? 'checked' : ''}><span>子カード追従</span></label>
        <label class="bd-detail-check"><input type="checkbox" data-bd-field="_autoStyle" ${node._autoStyle ? 'checked' : ''}><span>階層別スタイル</span></label>
        <div class="bd-detail-inline-actions">
          <button type="button" class="gb-btn gb-btn-sm" data-bd-action="manage-depth-styles">階層別スタイルを管理</button>
        </div>
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">構造</div>
        <label class="bd-detail-field bd-detail-field-wide"><span>構造</span><select data-bd-field="structure">${_bdStructureOptions(node)}</select></label>
        <div class="bd-detail-hint" style="font-size:11px;opacity:0.7;">「親に従う」(初期値) は親カードの構造を継承。他を選ぶと、このカード以下のサブツリーが独自の構造になります。</div>
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">変形</div>
        ${_bdRangeFieldHtml('回転', 'rotate', node.rotate || 0, -360, 360, 1)}
        ${_bdRangeFieldHtml('不透明度', 'opacityPct', opacityPct, 0, 100, 1)}
        <label class="bd-detail-check"><input type="checkbox" data-bd-field="flipH" ${node.flipH ? 'checked' : ''}><span>左右反転</span></label>
        <label class="bd-detail-check"><input type="checkbox" data-bd-field="flipV" ${node.flipV ? 'checked' : ''}><span>上下反転</span></label>
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">拡張</div>
        <label class="bd-detail-field"><span>ステータス</span><select data-bd-field="status">${_bdNodeStatusOptions(node)}</select></label>
        ${markerHtml}
        <div class="bd-detail-inline-actions">
          <button type="button" class="gb-btn gb-btn-sm" data-bd-action="manage-statuses">ステータスを管理</button>
        </div>
      </div>`]);
  _bdLastNodeDetailPanels = { nodeId: node.id, contentHtml };
  return contentHtml;
}

function bdClearConnectionStyleOverrides(conn) {
  [
    'color', 'width', 'style', 'arrow', 'straight', 'pathType',
    'branchRatio', 'cornerRadius',
    'labelTextColor', 'labelBgColor', 'labelBorderColor', 'labelBorderWidth',
    'fontBold', 'fontItalic',
    'textVisible', 'textAlongPath', 'textAutoFlip', 'textShadowWidth', 'textShadowColor',
  ].forEach(key => delete conn[key]);
}

function _bdBuildConnectionDetailHtml(conn) {
  const plusIcon = typeof lucide === 'function' ? lucide('plus', 14) : '+';
  const saveIcon = typeof lucide === 'function' ? lucide('save', 14) : '保存';
  const resetIcon = typeof lucide === 'function' ? lucide('rotateCcw', 14) : 'リセット';
  return `
    <div class="bd-detail-panel" data-bd-detail-root="connection" data-conn-id="${_bdEscAttr(conn.id)}">
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">テキスト</div>
        <label class="bd-detail-field bd-detail-field-wide"><span>テキスト</span><textarea data-bd-conn-field="label">${esc(conn.label || '')}</textarea></label>
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">ラインスタイル</div>
        <div class="bd-detail-style-row">
          ${_bdDetailStyleTriggerHtml('line', conn.styleRef || bd.activeLineStyle, 'data-bd-conn-style-pick')}
          <button type="button" class="bd-detail-style-action" data-bd-action="save-conn-line-style-as-new" title="現在の設定を新しいスタイルとして保存">${plusIcon}</button>
          <button type="button" class="bd-detail-style-action" data-bd-action="save-conn-line-style" title="選択中スタイルをデフォルトとして保存">${saveIcon}</button>
          <button type="button" class="bd-detail-style-action" data-bd-action="reset-conn-line-style" title="スタイルをデフォルトに戻す">${resetIcon}</button>
        </div>
        <div class="bd-style-summary-card"><div class="bd-style-editor-fields bd-style-editor-fields--fmt" data-bd-conn-line-style-fields></div></div>
        <div class="bd-detail-inline-actions">
          <button type="button" class="gb-btn gb-btn-sm" data-bd-action="manage-line-styles">スタイル管理</button>
        </div>
      </div>
    </div>`;
}

function _bdBuildBoardDetailHtml() {
  // cardStyle/lineStyle は HTML 内で直接使われない（_bdDetailStyleTriggerHtml が
  // ID から再取得する）。bdGet*StyleById の副作用（bdEnsureBoardUiState 連鎖）を
  // 避けるため呼ばない。
  const plusIcon = typeof lucide === 'function' ? lucide('plus', 14) : '+';
  const saveIcon = typeof lucide === 'function' ? lucide('save', 14) : '保存';
  const resetIcon = typeof lucide === 'function' ? lucide('rotateCcw', 14) : 'リセット';
  return `
    <div class="bd-detail-panel" data-bd-detail-root="board">
      <div class="bd-detail-heading">ボード</div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">カードスタイル</div>
        <div class="bd-detail-style-row">
          ${_bdDetailStyleTriggerHtml('card', bd.activeCardStyle, 'data-bd-board-card-style-pick')}
          <button type="button" class="bd-detail-style-action" data-bd-action="save-card-style-as-new" title="現在の設定を新しいスタイルとして保存">${plusIcon}</button>
          <button type="button" class="bd-detail-style-action" data-bd-action="save-card-style" title="選択中スタイルをデフォルトとして保存">${saveIcon}</button>
          <button type="button" class="bd-detail-style-action" data-bd-action="reset-card-style" title="スタイルをデフォルトに戻す">${resetIcon}</button>
        </div>
        <div class="bd-style-summary-card"><div class="bd-style-editor-fields bd-style-editor-fields--fmt" data-bd-board-card-style-fields></div></div>
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">ラインスタイル</div>
        <div class="bd-detail-style-row">
          ${_bdDetailStyleTriggerHtml('line', bd.activeLineStyle, 'data-bd-board-line-style-pick')}
          <button type="button" class="bd-detail-style-action" data-bd-action="save-line-style-as-new" title="現在の設定を新しいスタイルとして保存">${plusIcon}</button>
          <button type="button" class="bd-detail-style-action" data-bd-action="save-line-style" title="選択中スタイルをデフォルトとして保存">${saveIcon}</button>
          <button type="button" class="bd-detail-style-action" data-bd-action="reset-line-style" title="スタイルをデフォルトに戻す">${resetIcon}</button>
        </div>
        <div class="bd-style-summary-card"><div class="bd-style-editor-fields bd-style-editor-fields--fmt" data-bd-board-line-style-fields></div></div>
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">階層別スタイル</div>
        <div class="bd-detail-style-row">
          ${_bdDepthStyleTriggerHtml('data-bd-board-depth-style-pick')}
          <button type="button" class="bd-detail-style-action" data-bd-action="apply-depth-theme-colors" title="テーマカラーを階層別スタイルに適用">${paletteIcon}</button>
          <button type="button" class="bd-detail-style-action" data-bd-action="save-depth-styles" title="階層別スタイル一式を全ボード共通のデフォルトとして保存">${saveIcon}</button>
          <button type="button" class="bd-detail-style-action" data-bd-action="reset-depth-styles" title="保存したデフォルトに戻す (未保存ならビルトイン初期値)">${resetIcon}</button>
        </div>
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-inline-actions">
          <button type="button" class="gb-btn gb-btn-sm" data-bd-action="manage-card-styles">カードスタイル管理</button>
          <button type="button" class="gb-btn gb-btn-sm" data-bd-action="manage-line-styles">ラインスタイル管理</button>
          <button type="button" class="gb-btn gb-btn-sm" data-bd-action="export-board-styles">${exportIcon} スタイル一式を書き出し</button>
          <button type="button" class="gb-btn gb-btn-sm" data-bd-action="manage-statuses">ステータスを管理</button>
          <button type="button" class="gb-btn gb-btn-sm" data-bd-action="manage-depth-styles">階層別スタイルを管理</button>
        </div>
      </div>
    </div>`;
}

function _bdDepthStyleTriggerHtml(pickAttr) {
  const styles = typeof bdEnsureDepthStyles === 'function' ? bdEnsureDepthStyles() : (bd?.depthStyles || []);
  const count = Array.isArray(styles) ? styles.length : 0;
  return `<select class="gb-select bd-detail-style-trigger" ${pickAttr || ''} title="編集する階層を選択">
    ${styles.map((style, idx) => {
      const label = typeof bdDepthStyleDisplayName === 'function' ? bdDepthStyleDisplayName(style, idx, count) : `階層 ${idx + 1}`;
      return `<option value="${idx}">${esc(label)}${style?.defaultText ? ` (${esc(style.defaultText)})` : ''}</option>`;
    }).join('')}
    ${count === 0 ? '<option value="">(未設定)</option>' : ''}
  </select>`;
}

function _bdBindSelectionDetailPanel() {
  const roots = [...document.querySelectorAll('[data-bd-detail-root="selection"]')];
  if (!roots.length) return;
  const nodeIds = [...bd.selected];
  const connIds = typeof bdGetSelectedConnectionIds === 'function' ? bdGetSelectedConnectionIds() : [];
  roots.forEach(root => {
    root.querySelector('[data-bd-selection-card-style-pick]')?.addEventListener('click', event => {
      bdOpenStylePicker('card', event.currentTarget, {
        currentId: bd.activeCardStyle,
        onPick(styleId) {
          if (!nodeIds.length) {
            bd.activeCardStyle = styleId || '';
            return;
          }
          bdPushUndo();
          _bdAssignCardStyleToNodes(nodeIds, styleId);
        },
        onAfterPick() {
          bdRender();
          bdDirty();
          if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
        },
      });
    });
    root.querySelector('[data-bd-selection-line-style-pick]')?.addEventListener('click', event => {
      bdOpenStylePicker('line', event.currentTarget, {
        currentId: bd.activeLineStyle,
        onPick(styleId) {
          if (!connIds.length) {
            bd.activeLineStyle = styleId || '';
            return;
          }
          bdPushUndo();
          _bdAssignLineStyleToConnections(connIds, styleId);
        },
        onAfterPick() {
          bdDrawConns();
          bdDirty();
          if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
        },
      });
    });
    // 複数選択ラインの一括フィールド編集。代表ラインの effective スタイルを初期値として表示し、
    // 変更は選択中の全ラインに対して個別 override として書き込む。
    const lineFieldsEl = root.querySelector('[data-bd-selection-line-style-fields]');
    if (lineFieldsEl && connIds.length) {
      bdEnsureBoardUiState();
      const firstConn = typeof bdGetConnectionById === 'function' ? bdGetConnectionById(connIds[0]) : null;
      const wantId = firstConn ? (firstConn.styleRef || bd.activeLineStyle) : bd.activeLineStyle;
      const baseLineStyle = wantId ? (bd.lineStyles.find(s => s.id === wantId) || bd.lineStyles[0] || null) : (bd.lineStyles[0] || null);
      if (firstConn && baseLineStyle) {
        const eff = typeof bdGetConnectionStyle === 'function' ? bdGetConnectionStyle(firstConn) : {};
        const displayStyle = { ...baseLineStyle };
        ['color', 'width', 'style', 'arrow', 'pathType',
         'branchRatio', 'cornerRadius',
         'labelTextColor', 'labelBgColor', 'labelBorderColor', 'labelBorderWidth',
         'fontBold', 'fontItalic',
         'textVisible', 'textAlongPath', 'textAutoFlip', 'textShadowWidth', 'textShadowColor']
          .forEach(key => { if (eff[key] !== undefined) displayStyle[key] = eff[key]; });
        const rerender = () => {
          bdDrawConns();
          bdDirty();
          if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
        };
        _bdBuildStyleFields(lineFieldsEl, 'line', displayStyle, rerender, {
          editTargets: () => connIds
            .map(id => (typeof bdGetConnectionById === 'function' ? bdGetConnectionById(id) : null))
            .filter(Boolean),
          nameEditTarget: () => null, // 複数選択時は名前編集を無効化
          hideFontFamily: true,
        });
      }
    }
  });
}

function _bdUpdateNodeFromField(node, field, value) {
  switch (field) {
    case 'text':
      node.text = value || '';
      break;
    case 'link':
    case 'img':
    case 'status':
      if (value) node[field] = value;
      else delete node[field];
      break;
    case 'bgColor':
    case 'textColor':
    case 'textStrokeColor':
    case 'borderColor':
      if (value) node[field] = value;
      else delete node[field];
      break;
    case 'fontBold':
    case 'fontItalic':
    case 'collapsed':
    case 'minimized':
    case 'locked':
    case 'container':
    case '_followChildren':
    case '_autoStyle':
    case 'flipH':
    case 'flipV':
      node[field] = !!value;
      break;
    case 'cardStyle':
      node.cardStyle = value || '';
      bdClearCardStyleOverrides(node);
      break;
    case 'checked':
      if (value === '') delete node.checked;
      else node.checked = value === 'true';
      break;
    case 'shape':
      if (!value || value === 'rect') delete node.shape;
      else node.shape = value;
      break;
    case 'structure':
      if (value) node.structure = value;
      else delete node.structure;
      break;
    case 'progress': {
      const pct = Math.max(0, Math.min(100, parseInt(value, 10) || 0));
      if (pct) node.progress = pct;
      else delete node.progress;
      break;
    }
    case 'opacityPct': {
      const pct = Math.max(0, Math.min(100, parseInt(value, 10) || 0));
      if (pct >= 100) delete node.opacity;
      else node.opacity = +(pct / 100).toFixed(2);
      break;
    }
    case 'rotate': {
      const num = parseInt(value, 10);
      if (!Number.isFinite(num) || num === 0) delete node.rotate;
      else node.rotate = Math.max(-360, Math.min(360, num));
      break;
    }
    case 'borderWidth':
    case 'borderRadius':
    case 'fontSize':
    case 'textStrokeWidth':
    case 'x':
    case 'y':
    case 'w':
    case 'h': {
      const num = parseInt(value, 10);
      if (!Number.isFinite(num)) break;
      if (field === 'w') node[field] = Math.max(40, num);
      else if (field === 'fontSize') node[field] = Math.max(8, num);
      else if (field === 'textStrokeWidth') node[field] = Math.max(0, Math.min(12, num));
      else if (field === 'x' || field === 'y') node[field] = num;
      else node[field] = Math.max(0, num);
      break;
    }
    case 'note':
      if (value) node.note = value;
      else delete node.note;
      break;
    default:
      if (field.startsWith('marker:')) {
        const category = field.split(':')[1];
        if (!node.markers) node.markers = {};
        if (value === '') delete node.markers[category];
        else node.markers[category] = parseInt(value, 10);
        if (Object.keys(node.markers).length === 0) delete node.markers;
      }
      break;
  }
}

function _bdUpdateConnectionFromField(conn, field, value) {
  switch (field) {
    case 'label':
      if (String(value || '').trim()) conn.label = String(value).trim();
      else delete conn.label;
      break;
    case 'color':
      if (value) conn.color = value;
      else delete conn.color;
      break;
    case 'width': {
      const num = parseInt(value, 10);
      if (!Number.isFinite(num) || num <= 0) delete conn.width;
      else conn.width = Math.max(1, num);
      break;
    }
    case 'styleRef':
      conn.styleRef = value || '';
      break;
    case 'style':
      if (value === 'dashed') conn.style = 'dashed';
      else delete conn.style;
      break;
    case 'arrow':
      conn.arrow = value || '';
      break;
    case 'pathType':
      // v0.5.320: 3 種に統合。旧 free-bezier → curve、旧 orthogonal-curve → orthogonal。
      conn.pathType = value === 'free-bezier' ? 'curve'
        : value === 'orthogonal-curve' ? 'orthogonal'
        : value === 'orthogonal' ? 'orthogonal'
        : value === 'straight' ? 'straight' : 'curve';
      delete conn.straight;
      break;
    case 'branchRatio': {
      const num = parseFloat(value);
      if (Number.isFinite(num)) conn.branchRatio = Math.max(0.05, Math.min(0.95, num));
      else delete conn.branchRatio;
      break;
    }
    case 'cornerRadius': {
      const num = parseFloat(value);
      if (Number.isFinite(num)) conn.cornerRadius = Math.max(0, Math.min(40, num));
      else delete conn.cornerRadius;
      break;
    }
    case 'straight':
      conn.pathType = value === true || value === 'true' ? 'straight' : 'curve';
      delete conn.straight;
      break;
    case 'hidden':
      if (value) conn.hidden = true;
      else delete conn.hidden;
      break;
    default:
      break;
  }
}

async function _bdOpenLinkedTarget(node, e) {
  if (!node?.link) return;
  const path = String(node.link);
  const label = node.text || path.split('/').pop();
  if (typeof bdOpenLinkedPath === 'function') {
    bdOpenLinkedPath(path, label, { ctrlKey: e?.ctrlKey, linkType: node.linkType });
    return;
  }
  if (typeof openPage === 'function') openPage(label, path);
  else if (typeof openNative === 'function') openNative(path);
}

function _bdBindNodeDetailPanel(nodeId) {
  const roots = [...document.querySelectorAll('[data-bd-detail-root="node"]')].filter(root => root.dataset.nodeId === nodeId);
  if (!roots.length) return;
  roots.forEach(root => _bdSyncRangeInputs(root, 'data-bd-field'));
  const applyField = (field, value) => {
    const node = bd.nodes.find(item => item.id === nodeId);
    if (!node) return;
    bdPushUndo();
    _bdUpdateNodeFromField(node, field, value);
    if (field === 'structure' && typeof bdAutoLayout === 'function') {
      // 構造設定: 新しい構造 (非空) ならこのカードをサブルートに再レイアウト。
      // 「親に従う」(空) に戻した場合は、親から再レイアウトが必要なのでルートで実行。
      const targetId = node.structure ? node.id : (typeof bdRoot === 'function' ? bdRoot(node.id)?.id : node.id);
      if (targetId) bdAutoLayout(targetId);
    }
    bdRender();
    bdDirty();
    if (field === 'link' && value) bdShowLinkedSelectionPreview(value);
  };
  roots.forEach(root => {
    root.querySelectorAll('[data-bd-field]').forEach(input => {
      input.addEventListener('change', () => {
        const value = input.type === 'checkbox' ? input.checked : input.value;
        applyField(input.dataset.bdField, value);
      });
    });
    root.querySelectorAll('[data-bd-color-field]').forEach(btn => {
      btn.addEventListener('click', () => {
        const field = btn.dataset.bdColorField;
        const node = bd.nodes.find(item => item.id === nodeId);
        if (!node || typeof openColorPalette !== 'function') return;
        openColorPalette(btn, node[field] || '', color => {
          applyField(field, color || '');
        });
      });
    });
    root.querySelectorAll('[data-bd-reset-field]').forEach(btn => {
      btn.addEventListener('click', () => {
        applyField(btn.dataset.bdResetField, '');
      });
    });
  });
  const node = bd.nodes.find(item => item.id === nodeId);
  const rerenderNodeDetail = () => {
    bdDirty();
    bdRender();
    bdRefreshBoardToolbar();
    if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
  };
  const styleTrigger = roots.map(root => root.querySelector('[data-bd-node-style-pick]')).find(Boolean);
  styleTrigger?.addEventListener('click', event => {
    const target = bd.nodes.find(item => item.id === nodeId);
    if (!target) return;
    bdOpenStylePicker('card', event.currentTarget, {
      currentId: target.cardStyle || bd.activeCardStyle,
      onPick(styleId) {
        bdPushUndo();
        target.cardStyle = styleId || '';
        bdClearCardStyleOverrides(target);
      },
      onAfterPick() {
        rerenderNodeDetail();
      },
    });
  });
  roots.forEach(root => {
    const cardFieldsEl = root.querySelector('[data-bd-node-card-style-fields]');
    if (cardFieldsEl && node) {
      bdEnsureBoardUiState();
      const wantId = node.cardStyle || bd.activeCardStyle;
      const baseCardStyle = bd.cardStyles.find(s => s.id === wantId) || bd.cardStyles[0] || null;
      if (baseCardStyle) {
        // widget は effective style（base + node の個別 override）を表示する。
        const eff = typeof bdGetNodeStyle === 'function' ? bdGetNodeStyle(node) : {};
        const displayStyle = { ...baseCardStyle };
        ['bgColor', 'textColor', 'borderColor', 'borderWidth', 'borderRadius', 'fontSize',
         'fontBold', 'fontItalic', 'textStrokeColor', 'textStrokeWidth', 'shape', 'width',
         'cloudBumpWidth', 'cloudBumpHeight', 'cloudSideWidth', 'cloudOffset',
         'cloudSubWidthRatio', 'cloudSubHeightRatio']
          .forEach(key => {
            if (eff[key] !== undefined) displayStyle[key] = eff[key];
          });
        // v0.5.251: 詳細パネルの編集は「共通スタイル」ではなく「カード個別のオーバーライド」に書き込む。
        // 同じスタイルを使う他のカードには影響しない。
        // 「選択中スタイルをデフォルトとして保存」(save-node-card-style) でカードのオーバーライドを共通スタイルに
        // 伝播する。
        _bdBuildStyleFields(cardFieldsEl, 'card', displayStyle, rerenderNodeDetail, {
          beforeEdit: () => node,
          nameEditTarget: () => bd.cardStyles.find(s => s.id === wantId) || bd.cardStyles[0] || null,
          // 既存カード選択時は「標準幅」(新規カードの初期幅) は無関係なので非表示
          hideDefaultWidth: true,
          hideFontFamily: true,
        });
      }
    }
    root.querySelector('[data-bd-action="save-node-card-style-as-new"]')?.addEventListener('click', () => {
      const target = bd.nodes.find(item => item.id === nodeId);
      if (target) _bdSaveNodeCardStyleAsNew(target);
    });
    root.querySelector('[data-bd-action="save-node-card-style"]')?.addEventListener('click', () => {
      const target = bd.nodes.find(item => item.id === nodeId);
      if (target) _bdSaveCurrentNodeCardStyle(target);
    });
    root.querySelector('[data-bd-action="reset-node-card-style"]')?.addEventListener('click', () => {
      const target = bd.nodes.find(item => item.id === nodeId);
      if (!target) return;
      const wantId = target.cardStyle || bd.activeCardStyle;
      const style = bd.cardStyles.find(s => s.id === wantId) || bd.cardStyles[0] || null;
      if (!style) return;
      // v0.5.251: 詳細パネルのリセットは「このカードの個別オーバーライドをクリア」= 共通スタイルの
      // 見た目に戻すという意味。共通スタイル自体は変更しない (他のカードに影響しないように)。
      bdPushUndo();
      if (typeof bdClearCardStyleOverrides === 'function') bdClearCardStyleOverrides(target);
      rerenderNodeDetail();
      showStatus(`カードスタイル「${style.name}」の個別設定をクリアしました`);
    });
    root.querySelector('[data-bd-action="manage-card-styles"]')?.addEventListener('click', () => {
      bdOpenCardStyleManager();
    });
    root.querySelector('[data-bd-action="reset-style"]')?.addEventListener('click', () => {
      const target = bd.nodes.find(item => item.id === nodeId);
      if (!target) return;
      bdPushUndo();
      bdClearCardStyleOverrides(target);
      bdRender();
      bdDirty();
    });
    root.querySelector('[data-bd-action="open-link"]')?.addEventListener('click', (e) => {
      const target = bd.nodes.find(item => item.id === nodeId);
      _bdOpenLinkedTarget(target, e);
    });
    root.querySelector('[data-bd-action="manage-statuses"]')?.addEventListener('click', () => {
      if (typeof bdManageStatuses === 'function') bdManageStatuses();
    });
    root.querySelector('[data-bd-action="manage-depth-styles"]')?.addEventListener('click', () => {
      if (typeof bdOpenDepthStyleManager === 'function') bdOpenDepthStyleManager();
    });
  });
}

function _bdBindConnectionDetailPanel(connId) {
  const roots = [...document.querySelectorAll('[data-bd-detail-root="connection"]')].filter(root => root.dataset.connId === connId);
  if (!roots.length) return;
  const applyField = (field, value) => {
    const conn = typeof bdGetConnectionById === 'function' ? bdGetConnectionById(connId) : null;
    if (!conn) return;
    bdPushUndo();
    _bdUpdateConnectionFromField(conn, field, value);
    bdDrawConns();
    bdDirty();
    if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
  };
  roots.forEach(root => {
    root.querySelectorAll('[data-bd-conn-field]').forEach(input => {
      input.addEventListener('change', () => {
        const value = input.type === 'checkbox' ? input.checked : input.value;
        applyField(input.dataset.bdConnField, value);
      });
    });
    root.querySelectorAll('[data-bd-conn-color-field]').forEach(btn => {
      btn.addEventListener('click', () => {
        const field = btn.dataset.bdConnColorField;
        const conn = typeof bdGetConnectionById === 'function' ? bdGetConnectionById(connId) : null;
        if (!conn || typeof openColorPalette !== 'function') return;
        openColorPalette(btn, conn[field] || '', color => {
          applyField(field, color || '');
        });
      });
    });
    root.querySelectorAll('[data-bd-conn-reset-field]').forEach(btn => {
      btn.addEventListener('click', () => {
        applyField(btn.dataset.bdConnResetField, '');
      });
    });
    const rerenderConnDetail = () => {
      bdDirty();
      bdDrawConns();
      bdRefreshBoardToolbar();
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
    };
    root.querySelector('[data-bd-conn-style-pick]')?.addEventListener('click', event => {
      const trigger = event.currentTarget;
      const conn = typeof bdGetConnectionById === 'function' ? bdGetConnectionById(connId) : null;
      if (!conn) return;
      bdOpenStylePicker('line', trigger, {
        currentId: conn.styleRef || bd.activeLineStyle,
        onPick(styleId) {
          bdPushUndo();
          conn.styleRef = styleId || '';
          bdClearConnectionStyleOverrides(conn);
        },
        onAfterPick() {
          rerenderConnDetail();
        },
      });
    });
    const lineFieldsEl = root.querySelector('[data-bd-conn-line-style-fields]');
    if (lineFieldsEl) {
      const conn = typeof bdGetConnectionById === 'function' ? bdGetConnectionById(connId) : null;
      bdEnsureBoardUiState();
      const wantId = conn ? (conn.styleRef || bd.activeLineStyle) : null;
      const baseLineStyle = wantId ? (bd.lineStyles.find(s => s.id === wantId) || bd.lineStyles[0] || null) : null;
      if (conn && baseLineStyle) {
        // widget は effective style（base + conn の個別 override）を表示する
        const eff = typeof bdGetConnectionStyle === 'function' ? bdGetConnectionStyle(conn) : {};
        const displayStyle = { ...baseLineStyle };
        ['color', 'width', 'style', 'arrow', 'pathType',
         'branchRatio', 'cornerRadius',
         'labelTextColor', 'labelBgColor', 'labelBorderColor', 'labelBorderWidth',
         'fontBold', 'fontItalic',
         'textVisible', 'textAlongPath', 'textAutoFlip', 'textShadowWidth', 'textShadowColor']
          .forEach(key => {
            if (eff[key] !== undefined) displayStyle[key] = eff[key];
          });
        // v0.5.251: 詳細パネルの編集は「共通スタイル」ではなく「ライン個別のオーバーライド」に書き込む。
        // 同じスタイルを使う他のラインには影響しない。
        // 「選択中スタイルをデフォルトとして保存」(save-conn-line-style) でラインのオーバーライドを共通スタイルに
        // 伝播する。
        _bdBuildStyleFields(lineFieldsEl, 'line', displayStyle, rerenderConnDetail, {
          beforeEdit: () => conn,
          nameEditTarget: () => bd.lineStyles.find(s => s.id === wantId) || bd.lineStyles[0] || null,
          hideFontFamily: true,
        });
      }
    }
    root.querySelector('[data-bd-action="save-conn-line-style-as-new"]')?.addEventListener('click', () => {
      const conn = typeof bdGetConnectionById === 'function' ? bdGetConnectionById(connId) : null;
      if (conn) _bdSaveConnectionLineStyleAsNew(conn);
    });
    root.querySelector('[data-bd-action="save-conn-line-style"]')?.addEventListener('click', () => {
      const conn = typeof bdGetConnectionById === 'function' ? bdGetConnectionById(connId) : null;
      if (conn) _bdSaveCurrentConnectionLineStyle(conn);
    });
    root.querySelector('[data-bd-action="reset-conn-line-style"]')?.addEventListener('click', () => {
      const conn = typeof bdGetConnectionById === 'function' ? bdGetConnectionById(connId) : null;
      if (!conn) return;
      const wantId = conn.styleRef || bd.activeLineStyle;
      const style = bd.lineStyles.find(s => s.id === wantId) || bd.lineStyles[0] || null;
      if (!style) return;
      // v0.5.251: 詳細パネルのリセットは「このラインの個別オーバーライドをクリア」= 共通スタイルの
      // 見た目に戻すという意味。共通スタイル自体は変更しない。
      bdPushUndo();
      if (typeof bdClearConnectionStyleOverrides === 'function') bdClearConnectionStyleOverrides(conn);
      rerenderConnDetail();
      showStatus(`ラインスタイル「${style.name}」の個別設定をクリアしました`);
    });
    root.querySelector('[data-bd-action="manage-line-styles"]')?.addEventListener('click', () => {
      bdOpenLineStyleManager();
    });
  });
}

function _bdBindBoardDetailPanel() {
  const roots = [...document.querySelectorAll('[data-bd-detail-root="board"]')];
  if (!roots.length) return;
  // 注意: bdGetCardStyleById/bdGetLineStyleById は内部で bdEnsureBoardUiState を呼んで
  // bd.cardStyles/bd.lineStyles を新配列に置換する。両方を別々に呼ぶと cardStyle 取得後に
  // bd.cardStyles が再生成され、cardStyle 参照が「古い配列内のオブジェクト」になり、
  // 編集が bd.cardStyles に反映されない。bdEnsureBoardUiState を1回だけ呼んで直接 find する。
  bdEnsureBoardUiState();
  const cardStyle = bd.cardStyles.find(s => s.id === bd.activeCardStyle) || bd.cardStyles[0] || null;
  const lineStyle = bd.lineStyles.find(s => s.id === bd.activeLineStyle) || bd.lineStyles[0] || null;
  const rerenderBoardDetail = () => {
    bdDirty();
    bdRender();
    bdRefreshBoardToolbar();
    if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
  };
  roots.forEach(root => {
    root.querySelectorAll('[data-bd-board-color-field]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (typeof bdPickBoardBackgroundColor === 'function') bdPickBoardBackgroundColor(btn);
        else if (typeof openColorPalette === 'function') {
          const current = bd._bgColor || '';
          openColorPalette(btn, current, color => {
            bd._bgColor = color || '';
            const canvas = document.getElementById('bd-canvas');
            const swatch = document.getElementById('bd-bg-swatch');
            if (canvas) canvas.style.background = bd._bgColor || 'var(--bg)';
            if (swatch) setColorSwatchValue(swatch, bd._bgColor || '');
            bdDirty();
            if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
            if (typeof bdMarkExtrasDirty === 'function') {
              bdMarkExtrasDirty({ minimap: true, boardUi: true }, 'bg-color');
              if (typeof bdScheduleBoardUpdates === 'function') bdScheduleBoardUpdates();
            }
          });
        }
      });
    });
    root.querySelectorAll('[data-bd-board-reset-field]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (typeof bdSetBoardBackgroundColor === 'function') bdSetBoardBackgroundColor('');
        else {
          bd._bgColor = '';
          const canvas = document.getElementById('bd-canvas');
          const swatch = document.getElementById('bd-bg-swatch');
          if (canvas) canvas.style.background = 'var(--bg)';
          if (swatch) setColorSwatchValue(swatch, '');
          bdDirty();
          if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
          if (typeof bdMarkExtrasDirty === 'function') {
            bdMarkExtrasDirty({ minimap: true, boardUi: true }, 'bg-reset');
            if (typeof bdScheduleBoardUpdates === 'function') bdScheduleBoardUpdates();
          }
        }
      });
    });
    root.querySelector('[data-bd-action="set-bg-image"]')?.addEventListener('click', () => {
      if (typeof bdChooseBoardBackgroundImage === 'function') bdChooseBoardBackgroundImage();
    });
    root.querySelector('[data-bd-action="clear-bg-image"]')?.addEventListener('click', () => {
      if (typeof bdClearBoardBackgroundImage === 'function') bdClearBoardBackgroundImage();
    });
    root.querySelector('[data-bd-board-bg-fit]')?.addEventListener('change', event => {
      if (typeof bdSetBoardBackgroundImageFit === 'function') bdSetBoardBackgroundImageFit(event.currentTarget.value);
    });
    root.querySelector('[data-bd-board-card-style-pick]')?.addEventListener('click', event => {
      bdOpenStylePicker('card', event.currentTarget, {
        currentId: bd.activeCardStyle,
        onPick(styleId) { bd.activeCardStyle = styleId || ''; },
        onAfterPick() { rerenderBoardDetail(); },
      });
    });
    root.querySelector('[data-bd-board-line-style-pick]')?.addEventListener('click', event => {
      bdOpenStylePicker('line', event.currentTarget, {
        currentId: bd.activeLineStyle,
        onPick(styleId) { bd.activeLineStyle = styleId || ''; },
        onAfterPick() { rerenderBoardDetail(); },
      });
    });
    const cardFieldsEl = root.querySelector('[data-bd-board-card-style-fields]');
    if (cardFieldsEl) {
      const targetCard = cardStyle || bd.cardStyles[0] || null;
      if (targetCard) {
        // bdEnsureBoardUiState が bd.cardStyles を都度新オブジェクトに差し替えるため、
        // バインド時の参照は古くなる。beforeEdit で常に現在の参照を取り直す。
        _bdBuildStyleFields(cardFieldsEl, 'card', targetCard, rerenderBoardDetail, {
          beforeEdit: () => bd.cardStyles.find(s => s.id === bd.activeCardStyle) || bd.cardStyles[0] || null,
        });
      } else { cardFieldsEl.textContent = 'カードスタイル未設定'; console.warn('[board detail] no card style available'); }
    }
    const lineFieldsEl = root.querySelector('[data-bd-board-line-style-fields]');
    if (lineFieldsEl) {
      const targetLine = lineStyle || bd.lineStyles[0] || null;
      if (targetLine) {
        _bdBuildStyleFields(lineFieldsEl, 'line', targetLine, rerenderBoardDetail, {
          beforeEdit: () => bd.lineStyles.find(s => s.id === bd.activeLineStyle) || bd.lineStyles[0] || null,
        });
      } else { lineFieldsEl.textContent = 'ラインスタイル未設定'; console.warn('[board detail] no line style available'); }
    }
    root.querySelector('[data-bd-action="save-card-style-as-new"]')?.addEventListener('click', () => _bdSaveBoardStyleAsNew('card'));
    root.querySelector('[data-bd-action="save-line-style-as-new"]')?.addEventListener('click', () => _bdSaveBoardStyleAsNew('line'));
    root.querySelector('[data-bd-action="save-card-style"]')?.addEventListener('click', () => _bdSaveCurrentBoardStyle('card'));
    root.querySelector('[data-bd-action="save-line-style"]')?.addEventListener('click', () => _bdSaveCurrentBoardStyle('line'));
    root.querySelector('[data-bd-action="reset-card-style"]')?.addEventListener('click', () => {
      const style = bd.cardStyles.find(s => s.id === bd.activeCardStyle) || bd.cardStyles[0] || null;
      if (!style) return;
      bdPushUndo();
      _bdResetStyleToDefault('card', style);
      rerenderBoardDetail();
      showStatus(`カードスタイル「${style.name}」をデフォルトに戻しました`);
    });
    root.querySelector('[data-bd-action="reset-line-style"]')?.addEventListener('click', () => {
      const style = bd.lineStyles.find(s => s.id === bd.activeLineStyle) || bd.lineStyles[0] || null;
      if (!style) return;
      bdPushUndo();
      _bdResetStyleToDefault('line', style);
      rerenderBoardDetail();
      showStatus(`ラインスタイル「${style.name}」をデフォルトに戻しました`);
    });
    root.querySelector('[data-bd-action="manage-card-styles"]')?.addEventListener('click', () => bdOpenCardStyleManager());
    root.querySelector('[data-bd-action="manage-line-styles"]')?.addEventListener('click', () => bdOpenLineStyleManager());
    root.querySelector('[data-bd-action="export-board-styles"]')?.addEventListener('click', () => {
      if (typeof bdExportBoardStylePack === 'function') bdExportBoardStylePack();
      else if (typeof showStatus === 'function') showStatus('ボードスタイル書き出し機能を初期化できませんでした', true);
    });
    root.querySelector('[data-bd-action="manage-statuses"]')?.addEventListener('click', () => {
      if (typeof bdManageStatuses === 'function') bdManageStatuses();
    });
    root.querySelector('[data-bd-action="manage-depth-styles"]')?.addEventListener('click', () => {
      if (typeof bdOpenDepthStyleManager === 'function') bdOpenDepthStyleManager();
    });
    root.querySelector('[data-bd-action="apply-depth-theme-colors"]')?.addEventListener('click', () => {
      if (typeof bdApplyThemeColorsToDepthStyles !== 'function') return;
      if (typeof bdPushUndo === 'function') bdPushUndo();
      bdApplyThemeColorsToDepthStyles({ applyLineColor: true });
      if (typeof bdApplyAutoStyle === 'function') bd.nodes.filter(node => node._autoStyle).forEach(node => bdApplyAutoStyle(node.id));
      if (typeof bdRender === 'function') bdRender();
      bdDirty();
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
      showStatus('テーマカラーを階層別スタイルに適用しました');
    });
    // 階層別スタイル: 選択した階層を管理ダイアログで開く
    root.querySelector('[data-bd-board-depth-style-pick]')?.addEventListener('change', event => {
      const idx = parseInt(event.target.value, 10);
      if (Number.isFinite(idx)) window._bdPendingDepthStyleIndex = idx;
      if (typeof bdOpenDepthStyleManager === 'function') bdOpenDepthStyleManager();
    });
    // 階層別スタイル: デフォルトとして保存
    root.querySelector('[data-bd-action="save-depth-styles"]')?.addEventListener('click', () => {
      if (typeof bdEnsureDepthStyles === 'function') bdEnsureDepthStyles();
      const snapshot = typeof bdNormalizeDepthStyles === 'function'
        ? bdNormalizeDepthStyles(bd.depthStyles || [])
        : (bd.depthStyles || []).slice();
      if (typeof bdPushUndo === 'function') bdPushUndo();
      if (typeof _bdSaveGlobalDepthStyles === 'function') _bdSaveGlobalDepthStyles(snapshot);
      showStatus('階層別スタイルをデフォルトとして保存しました', false, { showSaveDialog: true });
    });
    // 階層別スタイル: デフォルトに戻す
    root.querySelector('[data-bd-action="reset-depth-styles"]')?.addEventListener('click', () => {
      if (typeof bdPushUndo === 'function') bdPushUndo();
      const global = typeof _bdReadGlobalDepthStyles === 'function' ? _bdReadGlobalDepthStyles() : null;
      const globalIsLegacy = typeof _bdIsLegacyDefaultDepthStyles === 'function' && _bdIsLegacyDefaultDepthStyles(global);
      if (Array.isArray(global) && global.length && !globalIsLegacy) {
        bd.depthStyles = typeof bdNormalizeDepthStyles === 'function' ? bdNormalizeDepthStyles(global) : global.slice();
        showStatus('保存したデフォルトに戻しました');
      } else {
        bd.depthStyles = typeof bdNormalizeDepthStyles === 'function' ? bdNormalizeDepthStyles([]) : [];
        showStatus('デフォルトは未保存のため、ビルトイン初期値に戻しました');
      }
      if (typeof bdRender === 'function') bdRender();
      bdDirty();
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
    });
  });
}

function bdRefreshSelectionDetails(forceEmpty) {
  if (typeof bd === 'undefined') return;
  if (!document.getElementById('bd-canvas') && !bd.path && !bd.nodes.length && !bd.connections.length) return;
  if (typeof bdEnsureBoardUiState === 'function') bdEnsureBoardUiState();
  if (!_bdCanRenderDetailPanel()) return;
  const selectedConnIds = typeof bdGetSelectedConnectionIds === 'function' ? bdGetSelectedConnectionIds() : [];
  const activateSelectionTab = forceEmpty !== true;
  if (bd.selected.size === 0 && selectedConnIds.length === 0 && !forceEmpty) {
    // 選択が空白クリック等で解除された場合: カード/ライン タブは非表示、
    // テーマタブをアクティブ (ユーザーが明示的に開いている board-note / backlinks は尊重)。
    if (typeof clearBoardDetailTabContent === 'function') clearBoardDetailTabContent();
    _bdRenderBoardPrimaryDetail();
    return;
  }
  // タブ表示は維持し、コンテンツだけクリアする。作業パネル再アクティブ時に
  // スタイル/拡張タブが基本へ戻ってしまうのを防ぐため。
  if (typeof clearBoardDetailTabContent === 'function') clearBoardDetailTabContent();
  else if (typeof clearBoardDetailTabs === 'function') clearBoardDetailTabs();
  if (bd.selected.size > 1 || selectedConnIds.length > 1 || (bd.selected.size && selectedConnIds.length)) {
    // 複数選択: 概要 HTML はカード側が選択を含むときはカードタブに、
    // ラインのみの複数選択ならラインタブに表示する。
    const html = _bdSelectionSummaryHtml();
    if (bd.selected.size >= 1) {
      if (_bdCanUseBoardDetailTabs()) _bdSetNodeDetailTabs(null, html, { activate: activateSelectionTab });
      else if (typeof showDetailPanel === 'function') showDetailPanel(html);
    } else {
      if (_bdCanUseBoardDetailTabs()) _bdSetConnDetailTab(html, { activate: activateSelectionTab });
      else if (typeof showDetailPanel === 'function') showDetailPanel(html);
    }
    _bdBindSelectionDetailPanel();
    return;
  }
  if (selectedConnIds.length === 1) {
    const conn = typeof bdGetConnectionById === 'function' ? bdGetConnectionById(selectedConnIds[0]) : null;
    if (!conn) {
      if (typeof bdClearConnectionSelection === 'function') bdClearConnectionSelection();
      if (!forceEmpty) return;
      _bdRenderBoardPrimaryDetail();
      return;
    }
    const html = _bdBuildConnectionDetailHtml(conn);
    if (_bdCanUseBoardDetailTabs()) _bdSetConnDetailTab(html, { activate: activateSelectionTab });
    else if (typeof showDetailPanel === 'function') showDetailPanel(html);
    _bdBindConnectionDetailPanel(conn.id);
    return;
  }
  if (bd.selected.size === 0) {
    if (!forceEmpty) return;
    _bdRenderBoardPrimaryDetail();
    return;
  }
  const nodeId = [...bd.selected][0];
  const node = bd.nodes.find(item => item.id === nodeId);
  if (!node) return;
  _bdBuildNodeDetailHtml(node);
  const panels = _bdLastNodeDetailPanels && _bdLastNodeDetailPanels.nodeId === node.id
    ? _bdLastNodeDetailPanels
    : { nodeId: node.id, contentHtml: '' };
  _bdRenderNodeDetailPanels(node, panels, { activate: activateSelectionTab });
  _bdBindNodeDetailPanel(node.id);
}

function bdSyncBoardUi(forceEmptyDetail) {
  const started = typeof bdPerfStart === 'function' ? bdPerfStart('bdSyncBoardUi') : 0;
  bdRefreshBoardToolbar();
  bdRefreshSelectionDetails(forceEmptyDetail);
  if (typeof bdPerfEnd === 'function') bdPerfEnd('bdSyncBoardUi', started);
}

/* スタイルマネージャ / フィルタメニューは gb-board-style-manager.js に分離 */
