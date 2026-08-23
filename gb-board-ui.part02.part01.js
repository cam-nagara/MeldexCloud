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

// 課題3 (2026-08-14): 階層別/カード/ラインスタイルのフィールドを編集すると、その値を反映する
// ための内部再描画 (bdRender()) が bdSyncBoardUi() 経由で選択タブを強制的に「カード」/「ライン」
// タブへ切り替えてしまい、スタイル管理タブを開いたまま編集していたユーザーが弾き出される不具合が
// あった。フィールド編集ハンドラは bdRender() を呼ぶ前後でこのフラグを立て (try/finally で必ず
// 解除)、_bdSetNodeDetailTabs / _bdSetConnDetailTab の activate 分岐でフラグが立っている間は
// 強制切替をスキップする。ユーザーが実際にカード/ラインをクリックして選択を変えた場合の強制切替
// (2026-08-13 導入の E2E 契約) はこの対象外 — canvas 側のクリック処理は bdRefreshSelectionDetails
// を直接呼ぶため bdRender() の内部同期パスを経由しない。
let _bdSuppressDetailTabForceActivate = false;
function _bdRenderKeepingDetailTab() {
  if (typeof bdRender !== 'function') return undefined;
  const prev = _bdSuppressDetailTabForceActivate;
  _bdSuppressDetailTabForceActivate = true;
  try {
    return bdRender();
  } finally {
    _bdSuppressDetailTabForceActivate = prev;
  }
}

// カード選択時: カードタブに集約した HTML を入れ、カードタブを表示してアクティブに。
// ラインタブは非表示にする (選択中に同時に存在する場合のみライン側が別途上書きする)。
// スタイル管理タブ (カード/ライン/階層別スタイル) はボード表示中は常に出す。
function _bdSetNodeDetailTabs(node, cardHtml, options = {}) {
  if (typeof setBoardDetailTabContent === 'function') {
    setBoardDetailTabContent({ card: cardHtml, line: '' });
  }
  if (typeof showNoteTabs === 'function') showNoteTabs(true);
  if (typeof showDbTabs === 'function') showDbTabs(false);
  if (typeof showBoardTabs === 'function') showBoardTabs({ card: true, line: false, cardStyle: true, lineStyle: true, depthStyle: true });
  window.MeldexBoardInfoPanel?.render?.(node);
  _bdEnsureBoardFileStyleTab();
  _bdEnsureBoardStyleManagerTabs();
  // 選択操作時は必ず「カード」タブへ移動する。スタイル編集などの内部再描画では
  // ユーザーが開いている file-style / backlinks / board-note / スタイル管理タブを維持する。
  // 以前は「情報」を出せる場合に note-editor を開いていたが、hasInformation() は
  // 保存済みボードならほぼ常に true になるため、カードを選ぶたび「情報」タブへ
  // 飛んでいた (2026-08-13 ユーザー指摘)。「情報」はタブから明示的に開く。
  const nextTab = (options.activate === true && !_bdSuppressDetailTabForceActivate)
    ? 'board-card'
    : (typeof _bdResolveCurrentBoardTab === 'function'
      ? _bdResolveCurrentBoardTab(['note-editor', 'board-card', 'board-note', 'board-card-style', 'board-line-style', 'board-depth-style'], 'board-card')
      : 'board-card');
  if (typeof switchDetailTab === 'function') switchDetailTab(nextTab);
}

// ライン選択時: ラインタブに HTML を入れ、ラインタブを表示してアクティブに。
function _bdSetConnDetailTab(connHtml, options = {}) {
  if (typeof setBoardDetailTabContent === 'function') {
    setBoardDetailTabContent({ card: '', line: connHtml });
  }
  if (typeof showNoteTabs === 'function') showNoteTabs(true);
  if (typeof showDbTabs === 'function') showDbTabs(false);
  if (typeof showBoardTabs === 'function') showBoardTabs({ card: false, line: true, cardStyle: true, lineStyle: true, depthStyle: true });
  window.MeldexBoardInfoPanel?.render?.(null);
  _bdEnsureBoardFileStyleTab();
  _bdEnsureBoardStyleManagerTabs();
  const nextTab = (options.activate === true && !_bdSuppressDetailTabForceActivate)
    ? 'board-line'
    : (typeof _bdResolveCurrentBoardTab === 'function'
      ? _bdResolveCurrentBoardTab(['note-editor', 'board-line', 'board-note', 'board-card-style', 'board-line-style', 'board-depth-style'], 'board-line')
      : 'board-line');
  if (typeof switchDetailTab === 'function') switchDetailTab(nextTab);
}

// 何も選択されていない (ボード全体) 時: カード / ライン タブは非表示、テーマタブをアクティブに。
// スタイル管理タブはボード表示中は常に出す。
function _bdSetBoardPrimaryTab() {
  if (typeof setBoardDetailTabContent === 'function') {
    setBoardDetailTabContent({ card: '', line: '' });
  }
  if (typeof showNoteTabs === 'function') showNoteTabs(true);
  if (typeof showDbTabs === 'function') showDbTabs(false);
  if (typeof showBoardTabs === 'function') showBoardTabs({ card: false, line: false, cardStyle: true, lineStyle: true, depthStyle: true });
  window.MeldexBoardInfoPanel?.render?.(null);
  _bdEnsureBoardFileStyleTab();
  _bdEnsureBoardStyleManagerTabs();
  // デフォルトはテーマタブ。ユーザーが backlinks / board-note / スタイル管理タブを選んでいた場合は尊重。
  const nextTab = typeof _bdResolveCurrentBoardTab === 'function'
    ? _bdResolveCurrentBoardTab(['note-editor', 'board-note', 'board-card-style', 'board-line-style', 'board-depth-style'], 'file-style')
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
  // 課題18-案A: 「効いている起点」の小さな状態表示。祖先鎖の途中に起点があればそれを示す
  // (絶対ルートとは限らない)。起点自身なら「このカード自身」と表示する。
  const effectiveAnchor = typeof _bdNearestAutoStyleAnchor === 'function' ? _bdNearestAutoStyleAnchor(node.id) : null;
  const effectiveAnchorLabel = !effectiveAnchor
    ? 'なし (階層別スタイル未適用)'
    : effectiveAnchor.id === node.id
      ? 'このトピック自身'
      : ((effectiveAnchor.text || '').split('\n')[0] || effectiveAnchor.id);
  const opacityPct = node.opacity != null ? Math.round(Math.max(0, Math.min(1, node.opacity)) * 100) : 100;
  const title = (node.text || '').split('\n')[0] || '無題トピック';
  const plusIcon = typeof lucide === 'function' ? lucide('plus', 14) : '+';
  const saveIcon = typeof lucide === 'function' ? lucide('save', 14) : '保存';
  const resetIcon = typeof lucide === 'function' ? lucide('rotateCcw', 14) : 'リセット';
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
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="bd-node-manage-card-styles" data-bd-action="manage-card-styles">スタイル管理</button>
          ${node.link ? '<button type="button" class="gb-btn gb-btn-sm" data-e2e-id="bd-node-open-link" data-bd-action="open-link">リンク先を開く</button>' : ''}
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
        <label class="bd-detail-field"><span>親トピック</span><input type="text" value="${_bdEscAttr(parent)}" readonly data-e2e-id="bd-node-parent-label"></label>
        <label class="bd-detail-check"><input type="checkbox" data-bd-field="container" ${node.container ? 'checked' : ''}><span>コンテナ</span></label>
        <label class="bd-detail-check"><input type="checkbox" data-bd-field="_followChildren" ${node._followChildren ? 'checked' : ''}><span>サブトピック追従</span></label>
        <div class="gb-check-help-row">
          <label class="bd-detail-check"><input type="checkbox" data-bd-field="_autoStyle" ${node._autoStyle ? 'checked' : ''}><span>階層別スタイルの起点にする</span></label>
          ${typeof fieldHelp === 'function' ? fieldHelp('このトピックを深さ0として、子孫トピックだけに階層別スタイルを適用します。祖先や、起点を共有しない別系統のトピックには影響しません。', { e2eId: 'bd-node-auto-style-help' }) : ''}
        </div>
        <div class="bd-detail-hint" data-e2e-id="bd-node-effective-anchor-hint">効いている起点: ${esc(effectiveAnchorLabel)}</div>
        <div class="bd-detail-inline-actions">
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="bd-node-manage-depth-styles" data-bd-action="manage-depth-styles">階層別スタイルを管理</button>
        </div>
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">構造</div>
        <label class="bd-detail-field bd-detail-field-wide"><span>構造</span><select data-bd-field="structure">${_bdStructureOptions(node)}</select></label>
        ${_bdStructureHintHtml(node)}
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">変形</div>
        <div class="bd-detail-transform-fields">
          ${_bdRangeFieldHtml('回転', 'rotate', node.rotate || 0, -360, 360, 1)}
          ${_bdRangeFieldHtml('不透明度', 'opacityPct', opacityPct, 0, 100, 1)}
          <div class="bd-detail-transform-checks">
            <label class="bd-detail-check"><input type="checkbox" data-bd-field="flipH" ${node.flipH ? 'checked' : ''}><span>左右反転</span></label>
            <label class="bd-detail-check"><input type="checkbox" data-bd-field="flipV" ${node.flipV ? 'checked' : ''}><span>上下反転</span></label>
          </div>
        </div>
      </div>
      <div class="bd-detail-section">
        <div class="bd-detail-section-title">拡張</div>
        <label class="bd-detail-field"><span>ステータス</span><select data-bd-field="status">${_bdNodeStatusOptions(node)}</select></label>
        ${markerHtml}
        <div class="bd-detail-inline-actions">
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="bd-node-manage-statuses" data-bd-action="manage-statuses">ステータスを管理</button>
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
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="bd-conn-manage-line-styles" data-bd-action="manage-line-styles">スタイル管理</button>
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
        refreshAnchor: () => document.querySelector('[data-bd-detail-root="selection"] [data-bd-selection-card-style-pick]'),
        onPick(styleId) {
          if (!nodeIds.length) {
            bd.activeCardStyle = styleId || '';
            return;
          }
          bdPushUndo();
          _bdAssignCardStyleToNodes(nodeIds, styleId);
        },
        onAfterPick() {
          nodeIds.forEach(id => {
            if (typeof bdMarkNodeDirty === 'function') bdMarkNodeDirty(id, 'selection-detail-style');
          });
          if (typeof bdMarkConnectionsDirtyByNodes === 'function') {
            bdMarkConnectionsDirtyByNodes(nodeIds, 'selection-detail-style');
          }
          bdDirty();
          if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
        },
      });
    });
    root.querySelector('[data-bd-selection-line-style-pick]')?.addEventListener('click', event => {
      bdOpenStylePicker('line', event.currentTarget, {
        currentId: bd.activeLineStyle,
        refreshAnchor: () => document.querySelector('[data-bd-detail-root="selection"] [data-bd-selection-line-style-pick]'),
        onPick(styleId) {
          if (!connIds.length) {
            bd.activeLineStyle = styleId || '';
            return;
          }
          bdPushUndo();
          _bdAssignLineStyleToConnections(connIds, styleId);
        },
        onAfterPick() {
          bdDrawConns({ connIds, reason: 'selection-detail-style' });
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
          bdDrawConns({ connIds, reason: 'selection-detail-fields' });
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
      if (value) {
        node.link = value;
        const inferred = typeof _bdInferLinkType === 'function' ? _bdInferLinkType(value, '') : '';
        if (inferred) node.linkType = inferred;
        else delete node.linkType;
      } else {
        delete node.link;
        delete node.linkType;
      }
      break;
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
      if (field === 'bgColor') node._userBgColor = true;
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
      if (field === 'fontBold') node._userFontBold = true;
      if (field === '_autoStyle' && node[field]) delete node._userCardStyle;
      break;
    case 'cardStyle':
      if (typeof bdSetNodeCardStyleRef === 'function') bdSetNodeCardStyleRef(node, value || '', { clearOverrides: true });
      else {
        node.cardStyle = value || '';
        bdClearCardStyleOverrides(node);
        if (value) node._userCardStyle = true;
        else delete node._userCardStyle;
      }
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
      if (value === '') {
        delete node.opacity;
        break;
      }
      const parsed = parseInt(value, 10);
      if (!Number.isFinite(parsed)) break;
      const pct = Math.max(0, Math.min(100, parsed));
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
      if (field === 'w') node._userW = true;
      else if (field === 'fontSize') node._userFontSize = true;
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

function _bdRefreshNodeDetailDirty(nodeId, includeSubtree) {
  const ids = includeSubtree && typeof bdFastSubtreeIds === 'function'
    ? bdFastSubtreeIds(nodeId)
    : [nodeId];
  ids.forEach(id => {
    if (typeof bdMarkNodeDirty === 'function') bdMarkNodeDirty(id, 'node-detail');
  });
  if (typeof bdMarkConnectionsDirtyByNodes === 'function') bdMarkConnectionsDirtyByNodes(ids, 'node-detail');
  if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty(ids, 'node-detail');
  if (typeof bdMarkExtrasDirty === 'function') {
    bdMarkExtrasDirty({ frames: true, minimap: true, boardUi: true, detailPanel: true }, 'node-detail');
  }
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
    if (field === '_autoStyle' && node._autoStyle && typeof bdApplyAutoStyle === 'function') {
      bdApplyAutoStyle(node.id);
    }
    if (field === 'structure') {
      // 構造設定: 新しい構造 (非空) ならこのカードをサブルートに再レイアウト。
      // 「親に従う」(空) に戻した場合は、親から再レイアウトが必要なのでルートで実行。
      const targetId = node.structure ? node.id : (typeof bdRoot === 'function' ? bdRoot(node.id)?.id : node.id);
      if (targetId && typeof bdRequestAutoLayout === 'function') bdRequestAutoLayout(targetId);
      else if (targetId && typeof bdAutoLayout === 'function') bdAutoLayout(targetId);
    }
    _bdRefreshNodeDetailDirty(nodeId, field === '_autoStyle');
    bdDirty();
    if (field === 'link' || field === '_autoStyle') {
      // _autoStyle: 「効いている起点」表示 (課題18-案A) と階層別スタイルタブの起点プリセット行
      // (課題18-案B) はこのカードの起点状態に依存するため、切り替え直後に再描画する。
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
    }
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
    _bdRefreshNodeDetailDirty(nodeId, false);
    bdRefreshBoardToolbar();
    if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
  };
  const styleTrigger = roots.map(root => root.querySelector('[data-bd-node-style-pick]')).find(Boolean);
  styleTrigger?.addEventListener('click', event => {
    const target = bd.nodes.find(item => item.id === nodeId);
    if (!target) return;
    bdOpenStylePicker('card', event.currentTarget, {
      currentId: target.cardStyle || bd.activeCardStyle,
      refreshAnchor: () => [...document.querySelectorAll('[data-bd-detail-root="node"]')]
        .find(panel => panel.dataset.nodeId === nodeId)?.querySelector('[data-bd-node-style-pick]') || null,
      onPick(styleId) {
        bdPushUndo();
        if (typeof bdSetNodeCardStyleRef === 'function') bdSetNodeCardStyleRef(target, styleId || '', { clearOverrides: true });
        else {
          target.cardStyle = styleId || '';
          bdClearCardStyleOverrides(target);
          if (styleId) target._userCardStyle = true;
          else delete target._userCardStyle;
        }
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
      _bdRenderKeepingDetailTab();
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
    bdDrawConns({ connIds: [connId], reason: 'connection-detail' });
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
      bdDrawConns({ connIds: [connId], reason: 'connection-detail-style' });
      bdRefreshBoardToolbar();
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
    };
    root.querySelector('[data-bd-conn-style-pick]')?.addEventListener('click', event => {
      const trigger = event.currentTarget;
      const conn = typeof bdGetConnectionById === 'function' ? bdGetConnectionById(connId) : null;
      if (!conn) return;
      bdOpenStylePicker('line', trigger, {
        currentId: conn.styleRef || bd.activeLineStyle,
        refreshAnchor: () => [...document.querySelectorAll('[data-bd-detail-root="connection"]')]
          .find(panel => panel.dataset.connId === connId)?.querySelector('[data-bd-conn-style-pick]') || null,
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
