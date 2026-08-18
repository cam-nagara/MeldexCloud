/* ==============================
   gb-db-template-gallery-ui.js: シートテンプレートギャラリー（刷新UI）
   検索付きヘッダー + Tierチップ行 + カードグリッド/プレビューペインの2ペイン構成。
   モーダル共通プラミング（開閉・フォーカス復帰・サイズ調整）と、
   プロパティ表・ビュー一覧のプレビュー描画を担当する。
   モバイルでは重ねプレビューモーダル（gb-db-templates.part02.js の showTemplatePreviewModal）を
   引き続き使用する。
   ============================== */

/* --- トリガー・フォーカス復帰ヘルパー --- */

function _dbTemplateTrigger(triggerEl = null) {
  if (triggerEl && typeof triggerEl.focus === 'function') return triggerEl;
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  return active && typeof active.focus === 'function' ? active : null;
}

function _focusDbTemplateTrigger(triggerEl) {
  if (!triggerEl || typeof triggerEl.focus !== 'function' || !triggerEl.isConnected) return;
  try {
    triggerEl.focus({ preventScroll: true });
  } catch {
    try { triggerEl.focus(); } catch {}
  }
}

/* --- モーダル共通プラミング --- */

function _cleanupDbTemplateOverlay(overlay) {
  if (!overlay || typeof overlay._dbTemplateCleanup !== 'function') return;
  overlay._dbTemplateCleanup();
}

function _isTopDbTemplateOverlay(overlay) {
  if (!overlay?.isConnected) return false;
  const overlays = Array.from(document.querySelectorAll('.modal-overlay[data-db-template-modal]'))
    .filter(el => el.isConnected);
  return overlays[overlays.length - 1] === overlay;
}

function _closeDbTemplateOverlay(overlay, triggerEl = null, options = {}) {
  if (!overlay || !overlay.isConnected) return;
  if (typeof overlay._dbTemplateClose === 'function') {
    overlay._dbTemplateClose(options.reason || 'programmatic');
    return;
  }
  _cleanupDbTemplateOverlay(overlay);
  overlay.remove();
  if (options.restoreFocus === false) return;
  const trigger = triggerEl || overlay._dbTemplateTrigger || null;
  _focusDbTemplateTrigger(trigger);
  setTimeout(() => _focusDbTemplateTrigger(trigger), 0);
  setTimeout(() => _focusDbTemplateTrigger(trigger), 60);
}

function _bindDbTemplateDismiss(overlay, triggerEl = null) {
  if (!overlay) return;
  const onPointerDown = (e) => {
    if (e.target !== overlay) return;
    _closeDbTemplateOverlay(overlay, triggerEl);
  };
  const onKeyDown = (e) => {
    if (e.key !== 'Escape' || !overlay.isConnected) return;
    // アイコンピッカー表示中はEscapeをピッカー側に譲り、テンプレートモーダルを誤って閉じない
    if (document.querySelector('.gb-icon-picker')) return;
    if (!_isTopDbTemplateOverlay(overlay)) return;
    e.preventDefault();
    e.stopPropagation();
    _closeDbTemplateOverlay(overlay, triggerEl);
  };
  overlay.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('keydown', onKeyDown, true);
  overlay._dbTemplateCleanup = () => {
    overlay.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('keydown', onKeyDown, true);
    overlay._dbTemplateCleanup = null;
  };
}

function _dbTemplateViewportSize() {
  const zoom = typeof _getZoom === 'function'
    ? Math.max(0.1, _getZoom() || 1)
    : Math.max(0.1, parseFloat(document.documentElement?.style?.zoom || '') || 1);
  const width = (window.visualViewport?.width || window.innerWidth || document.documentElement?.clientWidth || 800) / zoom;
  const height = (window.visualViewport?.height || window.innerHeight || document.documentElement?.clientHeight || 600) / zoom;
  return { width, height };
}

function _isDbTemplateMobileSheetMode() {
  return document.body?.dataset?.cloudMobile === '1'
    || document.body?.dataset?.mobileUi === '1'
    || document.body?.dataset?.mobileUiLocal === '1'
    || window.MeldexCloudMobileState?.mobile === true;
}

function _setDbTemplateModalSize(modal, opts = {}) {
  if (!modal || _isDbTemplateMobileSheetMode()) return;
  const viewport = _dbTemplateViewportSize();
  const usableWidth = Math.max(260, viewport.width - 32);
  const usableHeight = Math.max(220, viewport.height - 24);
  const maxWidth = Math.max(260, opts.maxWidth || 500);
  modal.style.width = Math.round(Math.min(maxWidth, usableWidth)) + 'px';
  if (!opts.heightRatio && !opts.maxHeight) return;
  let targetHeight = opts.heightRatio ? viewport.height * opts.heightRatio : usableHeight;
  if (opts.maxHeight) targetHeight = Math.min(targetHeight, opts.maxHeight);
  targetHeight = Math.min(targetHeight, usableHeight);
  if (opts.minHeight) targetHeight = Math.max(Math.min(opts.minHeight, usableHeight), targetHeight);
  modal.style.height = Math.round(targetHeight) + 'px';
}

function _showDbTemplateOverlay(overlay, modal, triggerEl = null, focusTarget = null) {
  if (!overlay || !modal) return;
  overlay._dbTemplateTrigger = triggerEl || null;
  _bindDbTemplateDismiss(overlay, triggerEl);
  document.body.appendChild(overlay);
  if (typeof GBModalShell !== 'undefined' && GBModalShell?.enhanceAll) GBModalShell.enhanceAll();
  requestAnimationFrame(() => {
    try {
      (focusTarget || modal)?.focus?.({ preventScroll: true });
    } catch {
      try { (focusTarget || modal)?.focus?.(); } catch {}
    }
  });
}

function _setupDbTemplateButton(button, className, e2eId, ariaLabel = '') {
  if (!button) return button;
  button.type = 'button';
  if (className) button.className = className;
  if (e2eId) button.dataset.e2eId = e2eId;
  if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
  return button;
}

async function _deleteDbCustomTemplateWithConfirm(tmpl, onDeleted, actionButton = null) {
  if (actionButton?.dataset.dbTemplateBusy === '1') return false;
  if (actionButton) {
    actionButton.dataset.dbTemplateBusy = '1';
    actionButton.disabled = true;
  }
  try {
    let confirmed = false;
    try {
      confirmed = await _confirmDbTemplate('カスタムテンプレート「' + tmpl.name + '」を削除しますか？');
    } catch (error) {
      showStatus('カスタムテンプレートの削除確認を表示できませんでした: ' + (error?.message || error), true);
      return false;
    }
    if (!confirmed) return false;
    const customs = getCustomTemplates().filter(c => c.id !== tmpl.id);
    let saved = false;
    try {
      saved = await Promise.resolve(saveCustomTemplates(customs, { label: 'シートテンプレート: カスタムテンプレート削除', detail: tmpl.name }));
    } catch (error) {
      showStatus('カスタムテンプレートの削除に失敗しました: ' + (error?.message || error), true);
      return false;
    }
    if (!saved) return false;
    if (typeof onDeleted === 'function') {
      try {
        await Promise.resolve(onDeleted());
      } catch (error) {
        showStatus('カスタムテンプレートは削除しましたが、一覧を更新できませんでした。画面を再読み込みしてください: ' + (error?.message || error), true);
      }
    }
    return true;
  } finally {
    if (actionButton?.isConnected) {
      delete actionButton.dataset.dbTemplateBusy;
      actionButton.disabled = false;
    }
  }
}

let _dbTemplateOverflowLockDepth = 0;
let _dbTemplatePreviousRootOverflowX = '';
let _dbTemplatePreviousBodyOverflowX = '';
let _dbTemplateLockedScrollers = [];
function _lockDbTemplateHorizontalOverflow() {
  if (_dbTemplateOverflowLockDepth === 0) {
    _dbTemplatePreviousRootOverflowX = document.documentElement.style.overflowX;
    _dbTemplatePreviousBodyOverflowX = document.body.style.overflowX;
    document.documentElement.style.overflowX = 'hidden';
    document.body.style.overflowX = 'hidden';
    _dbTemplateLockedScrollers = Array.from(document.querySelectorAll('#pivot-view, .pivot-view'))
      .map(element => ({ element, overflowX: element.style.overflowX }));
    _dbTemplateLockedScrollers.forEach(({ element }) => { element.style.overflowX = 'hidden'; });
  }
  _dbTemplateOverflowLockDepth += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    _dbTemplateOverflowLockDepth = Math.max(0, _dbTemplateOverflowLockDepth - 1);
    if (_dbTemplateOverflowLockDepth === 0) {
      document.documentElement.style.overflowX = _dbTemplatePreviousRootOverflowX;
      document.body.style.overflowX = _dbTemplatePreviousBodyOverflowX;
      _dbTemplateLockedScrollers.forEach(({ element, overflowX }) => {
        if (element?.isConnected) element.style.overflowX = overflowX;
      });
      _dbTemplateLockedScrollers = [];
    }
  };
}

/* --- アイコン表示 --- */

/**
 * テンプレートアイコン（生Lucide名 or spec文字列）を描画する。
 * GBIconAssets 未ロード環境では lucide() へフォールバックする。
 */
function _dbTemplateIconHtml(icon, size) {
  const spec = icon || 'file';
  if (typeof GBIconAssets !== 'undefined' && GBIconAssets?.render) {
    return GBIconAssets.render(spec, size);
  }
  return typeof lucide === 'function' ? lucide(spec, size) : '';
}

/* --- プロパティ表（デスクトップのプレビューペイン・モバイルの重ねモーダルで共用） --- */

function _typeLabel(type) {
  const labels = {
    text: 'テキスト', number: '数値', select: 'セレクト', 'multi-select': 'マルチセレクト',
    'common-tags': '共通タグ', checkbox: 'チェックボックス', date: '日時', url: 'URL', link: 'リンク',
    relation: 'リレーション', 'multi-relation': 'マルチリレーション', formula: '数式', furigana: 'ふりがな',
  };
  return labels[type] || type;
}

function _buildDbTemplatePropTable(tmpl) {
  const table = document.createElement('table');
  table.className = 'db-template-prop-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">列</th>'
    + '<th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">型</th>'
    + '<th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">オプション</th></tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  (tmpl.properties || []).forEach(p => {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.textContent = p.name;
    tdName.className = 'db-template-prop-name';
    tr.appendChild(tdName);

    const tdType = document.createElement('td');
    tdType.textContent = _typeLabel(p.type.type);
    tdType.className = 'db-template-prop-type';
    tr.appendChild(tdType);

    const tdOpts = document.createElement('td');
    tdOpts.className = 'db-template-prop-options';
    if (p.type.options && p.type.options.length > 0) {
      tdOpts.textContent = p.type.options.join(', ');
    } else if (p.type.type === 'relation' || p.type.type === 'multi-relation') {
      const target = p.type.relationTemplate || p.type.relationDb || (p.type.relationDb === '' ? '自シート' : '');
      const reverse = p.type.bidirectionalProp ? ' / 逆: ' + p.type.bidirectionalProp : '';
      tdOpts.textContent = target ? target + reverse : '(リレーション先を要設定)';
    }
    tr.appendChild(tdOpts);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

/* --- ビュー一覧（プレビューペイン・重ねモーダルで共用） --- */

const DB_TEMPLATE_VIEW_MODE_LABELS = { pivot: 'テーブル', tree: 'ツリー', gallery: 'ギャラリー', kanban: 'カンバン', timeline: 'タイムライン', chart: 'チャート' };

function _dbTemplateViewIcon(mode) {
  const found = (typeof VIEW_TYPES !== 'undefined' ? VIEW_TYPES : []).find(vt => vt.mode === mode);
  return found?.icon || 'table';
}

function _dbTemplateViewSummaryParts(view) {
  const parts = [];
  const filterCount = Array.isArray(view?.advancedFilters) ? view.advancedFilters.length : 0;
  if (filterCount > 0) parts.push(`フィルタ${filterCount}件`);
  if (view?.sortConfig) parts.push('並べ替えあり');
  const groupBy = view?.typeSpecific?.pivot?.groupBy || view?.typeSpecific?.kanban?.groupBy;
  if (groupBy) parts.push('グループ: ' + groupBy);
  return parts;
}

/**
 * テンプレートのビュー一覧セクションを構築する。
 * savedViews があれば各ビューの詳細（モード・名前・フィルタ/ソート/グループ概要）を、
 * 無ければ旧形式の「推奨ビュー: …」表示にフォールバックする。
 */
function _buildDbTemplateViewsSummarySection(tmpl) {
  const wrap = document.createElement('div');
  wrap.className = 'db-template-views-summary';
  if (Array.isArray(tmpl.savedViews) && tmpl.savedViews.length) {
    const title = document.createElement('div');
    title.className = 'db-template-views-summary-title';
    title.textContent = 'ビュー';
    wrap.appendChild(title);
    const list = document.createElement('ul');
    list.className = 'db-template-views-summary-list';
    tmpl.savedViews.forEach(view => {
      const li = document.createElement('li');
      li.className = 'db-template-views-summary-item';
      const iconSpan = document.createElement('span');
      iconSpan.className = 'db-template-views-summary-icon';
      iconSpan.innerHTML = _dbTemplateIconHtml(_dbTemplateViewIcon(view?.viewMode), 14);
      li.appendChild(iconSpan);
      const nameSpan = document.createElement('span');
      nameSpan.className = 'db-template-views-summary-name';
      nameSpan.textContent = view?.name || _dbTemplateViewLabel(view?.viewMode);
      li.appendChild(nameSpan);
      const parts = _dbTemplateViewSummaryParts(view);
      if (parts.length) {
        const detail = document.createElement('span');
        detail.className = 'db-template-views-summary-detail';
        detail.textContent = parts.join(' / ');
        li.appendChild(detail);
      }
      list.appendChild(li);
    });
    wrap.appendChild(list);
  } else if (Array.isArray(tmpl.enabledModes) && tmpl.enabledModes.length) {
    const modeDiv = document.createElement('div');
    modeDiv.className = 'db-template-mode-summary';
    modeDiv.textContent = '推奨ビュー: ' + tmpl.enabledModes.map(m => DB_TEMPLATE_VIEW_MODE_LABELS[m] || _dbTemplateViewLabel(m)).join(', ');
    wrap.appendChild(modeDiv);
  }
  return wrap;
}

/* --- テンプレートカード --- */

/**
 * テンプレートカードを構築する。
 * デスクトップ: クリック/Enter/Space でプレビューペインを更新（重ねモーダルは開かない）。
 * モバイル: クリック/Enter/Space で重ねプレビューモーダル（showTemplatePreviewModal）を開く。
 */
function _buildTemplateCard(tmpl, dbPath, ctx = {}) {
  const card = document.createElement('div');
  card.className = 'template-card' + (ctx.selected ? ' is-selected' : '');
  card.dataset.e2eId = 'db-template-card';
  card.dataset.templateId = tmpl.id;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', 'テンプレート「' + (tmpl.name || '') + '」を確認');
  if (!ctx.mobile) card.setAttribute('aria-pressed', ctx.selected ? 'true' : 'false');

  const titleRow = document.createElement('div');
  titleRow.className = 'template-card-title-row';
  const icon = document.createElement('span');
  icon.innerHTML = _dbTemplateIconHtml(tmpl.icon, 18);
  icon.className = 'template-card-icon';
  titleRow.appendChild(icon);
  const name = document.createElement('span');
  name.textContent = tmpl.name;
  name.className = 'template-card-name';
  titleRow.appendChild(name);
  if (tmpl.tier > 0) {
    const badge = document.createElement('span');
    badge.textContent = 'T' + tmpl.tier;
    badge.className = 'template-card-badge';
    titleRow.appendChild(badge);
  }
  card.appendChild(titleRow);

  const desc = document.createElement('div');
  desc.textContent = tmpl.description;
  desc.className = 'template-card-desc';
  card.appendChild(desc);

  const meta = document.createElement('div');
  meta.className = 'template-card-meta';
  const propCount = (tmpl.properties || []).length;
  const viewCount = Array.isArray(tmpl.savedViews) && tmpl.savedViews.length
    ? tmpl.savedViews.length
    : (Array.isArray(tmpl.enabledModes) ? tmpl.enabledModes.length : 0);
  meta.textContent = propCount + '列 · ' + viewCount + 'ビュー';
  card.appendChild(meta);

  const btnRow = document.createElement('div');
  btnRow.className = 'template-card-actions';
  const applyBtn = document.createElement('button');
  _setupDbTemplateButton(applyBtn, 'gb-btn gb-btn-sm gb-btn-primary primary', 'db-template-card-apply', 'テンプレート「' + (tmpl.name || '') + '」を適用');
  applyBtn.textContent = '適用';
  applyBtn.addEventListener('click', e => {
    e.stopPropagation();
    _doApplyTemplate(dbPath, tmpl, ctx.overlay, ctx.overlay?._dbTemplateTrigger || card);
  });
  btnRow.appendChild(applyBtn);

  if (tmpl.tier === 0) {
    const editBtn = document.createElement('button');
    _setupDbTemplateButton(editBtn, 'gb-btn gb-btn-sm', 'db-template-card-edit', 'カスタムテンプレート「' + (tmpl.name || '') + '」を編集');
    editBtn.textContent = '編集';
    editBtn.addEventListener('click', e => {
      e.stopPropagation();
      _closeDbTemplateOverlay(ctx.overlay, ctx.overlay?._dbTemplateTrigger || card, { restoreFocus: false });
      showEditTemplateModal(tmpl, dbPath, ctx.overlay?._dbTemplateTrigger || card);
    });
    btnRow.appendChild(editBtn);

    const delBtn = document.createElement('button');
    _setupDbTemplateButton(delBtn, 'gb-btn gb-btn-sm gb-btn-danger', 'db-template-card-delete', 'カスタムテンプレート「' + (tmpl.name || '') + '」を削除');
    delBtn.textContent = '削除';
    delBtn.addEventListener('click', async e => {
      e.stopPropagation();
      await _deleteDbCustomTemplateWithConfirm(tmpl, ctx.onChanged, delBtn);
    });
    btnRow.appendChild(delBtn);
  }
  card.appendChild(btnRow);

  const activate = () => {
    if (ctx.mobile) {
      showTemplatePreviewModal(tmpl, dbPath, ctx.overlay, card);
    } else if (typeof ctx.onSelect === 'function') {
      ctx.onSelect();
    }
  };
  card.addEventListener('click', activate);
  card.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    activate();
  });

  return card;
}

/* --- デスクトップ用プレビューペイン --- */

function _renderDbTemplatePreviewPane(pane, tmpl, dbPath, ctx = {}) {
  if (!pane) return;
  pane.innerHTML = '';
  pane.dataset.templateId = tmpl.id;

  const header = document.createElement('div');
  header.className = 'db-template-preview-pane-header';
  const icon = document.createElement('span');
  icon.className = 'db-template-preview-pane-icon';
  icon.innerHTML = _dbTemplateIconHtml(tmpl.icon, 22);
  header.appendChild(icon);
  const name = document.createElement('span');
  name.className = 'db-template-preview-pane-name';
  name.textContent = tmpl.name;
  header.appendChild(name);
  pane.appendChild(header);

  if (tmpl.description) {
    const desc = document.createElement('p');
    desc.className = 'db-template-description';
    desc.textContent = tmpl.description;
    pane.appendChild(desc);
  }

  pane.appendChild(_buildDbTemplateViewsSummarySection(tmpl));

  const propScroll = document.createElement('div');
  propScroll.className = 'db-template-preview-pane-props';
  propScroll.appendChild(_buildDbTemplatePropTable(tmpl));
  pane.appendChild(propScroll);

  if (Array.isArray(tmpl.entityTemplates) && tmpl.entityTemplates.length) {
    const entityDiv = document.createElement('div');
    entityDiv.className = 'db-template-preview-pane-entities';
    entityDiv.textContent = 'エントリ雛形: ' + tmpl.entityTemplates.map(e => e.name).join(', ');
    pane.appendChild(entityDiv);
  }

  const actions = document.createElement('div');
  actions.className = 'db-template-preview-pane-actions';
  const applyBtn = document.createElement('button');
  _setupDbTemplateButton(applyBtn, 'gb-btn gb-btn-sm gb-btn-primary primary', 'db-template-preview-pane-apply', 'テンプレート「' + (tmpl.name || '') + '」を適用');
  applyBtn.textContent = '適用';
  applyBtn.addEventListener('click', () => {
    _doApplyTemplate(dbPath, tmpl, ctx.overlay, ctx.overlay?._dbTemplateTrigger || applyBtn);
  });
  actions.appendChild(applyBtn);

  if (tmpl.tier === 0) {
    const editBtn = document.createElement('button');
    _setupDbTemplateButton(editBtn, 'gb-btn gb-btn-sm', 'db-template-preview-pane-edit', 'カスタムテンプレート「' + (tmpl.name || '') + '」を編集');
    editBtn.textContent = '編集';
    editBtn.addEventListener('click', () => {
      _closeDbTemplateOverlay(ctx.overlay, ctx.overlay?._dbTemplateTrigger || editBtn, { restoreFocus: false });
      showEditTemplateModal(tmpl, dbPath, ctx.overlay?._dbTemplateTrigger || editBtn);
    });
    actions.appendChild(editBtn);

    const delBtn = document.createElement('button');
    _setupDbTemplateButton(delBtn, 'gb-btn gb-btn-sm gb-btn-danger', 'db-template-preview-pane-delete', 'カスタムテンプレート「' + (tmpl.name || '') + '」を削除');
    delBtn.textContent = '削除';
    delBtn.addEventListener('click', async () => {
      await _deleteDbCustomTemplateWithConfirm(tmpl, ctx.onDeleted, delBtn);
    });
    actions.appendChild(delBtn);
  }
  pane.appendChild(actions);
}

/* --- テンプレートギャラリーモーダル本体 --- */

/**
 * テンプレートギャラリーモーダルを表示する。
 * ヘッダー（タイトル+検索+閉じる）→ Tierチップ行 → 本体（カードグリッド+プレビューペイン）→ フッター。
 * モバイルではプレビューペインを出さず、カード選択で重ねプレビューモーダルを開く。
 */
function showTemplateGalleryModal(dbPath, triggerEl = null) {
  const trigger = _dbTemplateTrigger(triggerEl);
  const seq = Date.now().toString(36) + '-' + Math.floor(Math.random() * 1000).toString(36);
  const descId = `db-template-gallery-desc-${seq}`;
  const isMobile = _isDbTemplateMobileSheetMode();
  const content = document.createElement('div');
  content.className = 'db-template-modal-content';
  content.style.cssText = 'display:flex;flex-direction:column;min-height:0;height:100%;';

  // 検索
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'gb-input db-template-search-input';
  searchInput.dataset.e2eId = 'db-template-search-input';
  searchInput.placeholder = 'テンプレートを検索';
  searchInput.setAttribute('aria-label', 'テンプレートを検索（名前・説明・列名）');
  searchInput.style.flex = '0 0 auto';
  content.appendChild(searchInput);
  const desc = document.createElement('div');
  desc.id = descId;
  desc.className = 'gb-visually-hidden';
  desc.textContent = 'シートに適用するテンプレートを選ぶダイアログ';
  content.appendChild(desc);

  // Tierチップ行（旧: 左サイドバー）
  const tierRow = document.createElement('div');
  tierRow.className = 'db-template-tier-row';
  tierRow.style.flex = '0 0 auto';
  tierRow.setAttribute('role', 'group');
  tierRow.setAttribute('aria-label', 'テンプレート種別');
  let currentTier = 'all';
  const tierFilters = [
    { key: 'all', label: 'すべて' },
    { key: '1', label: '基本' },
    { key: '2', label: '標準' },
    { key: '3', label: 'ジャンル別' },
    { key: 'custom', label: 'カスタム' },
  ];
  tierFilters.forEach(tf => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = tf.label;
    btn.className = 'template-tier-btn' + (tf.key === 'all' ? ' active' : '');
    btn.dataset.tier = tf.key;
    btn.dataset.e2eId = `db-template-tier-${tf.key}`;
    btn.setAttribute('aria-pressed', tf.key === 'all' ? 'true' : 'false');
    btn.addEventListener('click', () => {
      currentTier = tf.key;
      tierRow.querySelectorAll('.template-tier-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      renderTemplateCards();
    });
    tierRow.appendChild(btn);
  });
  content.appendChild(tierRow);

  // 本体: カードグリッド + プレビューペイン
  const body = document.createElement('div');
  body.className = 'db-template-body';
  body.style.overflowX = 'hidden';
  const cardCol = document.createElement('div');
  cardCol.className = 'db-template-card-col';
  const grid = document.createElement('div');
  grid.className = 'template-grid';
  grid.dataset.e2eId = 'db-template-grid';
  grid.style.overflowX = 'hidden';
  cardCol.appendChild(grid);
  body.appendChild(cardCol);

  let previewPane = null;
  if (!isMobile) {
    previewPane = document.createElement('div');
    previewPane.className = 'db-template-preview-pane';
    previewPane.dataset.e2eId = 'db-template-preview-pane';
    body.appendChild(previewPane);
  }
  content.appendChild(body);

  // フッター: カスタムテンプレート作成
  const createBtn = document.createElement('button');
  _setupDbTemplateButton(createBtn, 'gb-btn gb-btn-sm', 'db-template-create-open');
  createBtn.textContent = '+ 現在のシートからテンプレート作成';
  createBtn.addEventListener('click', () => {
    _closeDbTemplateOverlay(overlay, trigger, { restoreFocus: false, reason: 'create' });
    showCreateTemplateModal(dbPath, trigger);
  });
  const cancelBtn = document.createElement('button');
  _setupDbTemplateButton(cancelBtn, 'gb-btn gb-btn-sm', 'db-template-gallery-cancel');
  cancelBtn.textContent = '閉じる';
  let busy = false;
  const releaseOverflowLock = _lockDbTemplateHorizontalOverflow();
  const modalApi = window.GBUI.createModal({
    id: `db-template-gallery-${seq}`,
    title: 'シートテンプレート',
    body: content,
    footer: [createBtn, cancelBtn],
    variant: 'standard',
    extraClass: 'db-template-gallery-modal',
    geometryKey: 'db-template-gallery',
    minWidth: '0',
    initialFocus: dialog => dialog,
    returnFocus: trigger || undefined,
    closeLabel: 'シートテンプレートを閉じる',
    onBeforeClose: reason => !busy || reason === 'applied' || reason === 'superseded',
    onClose: releaseOverflowLock,
  });
  const overlay = modalApi.overlay;
  const modal = modalApi.modal;
  modal.classList.add('modal', 'db-template-modal');
  overlay.classList.add('modal-overlay');
  overlay.dataset.dbTemplateModal = 'gallery';
  overlay.style.zIndex = '120';
  overlay._dbTemplateTrigger = trigger;
  overlay._dbTemplateClose = modalApi.close;
  overlay._dbTemplateSetBusy = (next) => {
    busy = !!next;
    modal.setAttribute('aria-busy', busy ? 'true' : 'false');
    modal.querySelectorAll('button, input').forEach(control => { control.disabled = busy; });
  };
  modal.dataset.e2eId = 'db-template-gallery-dialog';
  modal.setAttribute('aria-describedby', descId);
  modalApi.body.style.cssText = 'display:flex;flex-direction:column;min-height:0;overflow:hidden;';
  modalApi.footer.classList.add('db-template-footer');
  const closeBtn = modalApi.header.querySelector('.gb-modal-close');
  if (closeBtn) closeBtn.dataset.e2eId = 'db-template-gallery-close';
  cancelBtn.addEventListener('click', () => modalApi.close('cancel'));
  _setDbTemplateModalSize(modal, { maxWidth: 1040, maxHeight: 820, heightRatio: 0.85, minHeight: 480 });
  modalApi.open();

  let searchQuery = '';
  let selectedTemplateId = '';

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim();
    renderTemplateCards();
  });

  function matchesSearch(tmpl, query) {
    if (!query) return true;
    const q = query.toLowerCase();
    if ((tmpl.name || '').toLowerCase().includes(q)) return true;
    if ((tmpl.description || '').toLowerCase().includes(q)) return true;
    return (tmpl.properties || []).some(p => (p.name || '').toLowerCase().includes(q));
  }

  function selectTemplate(tmpl) {
    selectedTemplateId = tmpl.id;
    grid.querySelectorAll('.template-card').forEach(cardEl => {
      const isSelected = cardEl.dataset.templateId === tmpl.id;
      cardEl.classList.toggle('is-selected', isSelected);
      cardEl.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    });
    if (previewPane) {
      _renderDbTemplatePreviewPane(previewPane, tmpl, dbPath, {
        overlay,
        onDeleted: () => renderTemplateCards(),
      });
    }
  }

  function renderTemplateCards() {
    grid.innerHTML = '';
    const templates = getAllTemplates();
    const filtered = templates.filter(t => {
      if (currentTier === 'custom') { if (t.tier !== 0) return false; }
      else if (currentTier !== 'all' && t.tier !== Number(currentTier)) return false;
      return matchesSearch(t, searchQuery);
    });

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'db-template-empty';
      empty.dataset.e2eId = 'db-template-empty';
      empty.textContent = searchQuery
        ? '該当するテンプレートがありません'
        : (currentTier === 'custom' ? 'カスタムテンプレートはまだありません' : 'テンプレートがありません');
      grid.appendChild(empty);
      if (previewPane) {
        previewPane.innerHTML = '';
        delete previewPane.dataset.templateId;
        const hint = document.createElement('div');
        hint.className = 'db-template-preview-empty';
        hint.textContent = 'テンプレートを選ぶとここにプレビューが表示されます';
        previewPane.appendChild(hint);
      }
      return;
    }

    filtered.forEach(tmpl => {
      const card = _buildTemplateCard(tmpl, dbPath, {
        overlay,
        mobile: isMobile,
        selected: tmpl.id === selectedTemplateId,
        onSelect: () => selectTemplate(tmpl),
        onChanged: () => renderTemplateCards(),
      });
      grid.appendChild(card);
    });

    if (!isMobile) {
      const target = filtered.find(t => t.id === selectedTemplateId) || filtered[0];
      if (target) selectTemplate(target);
    }
  }

  renderTemplateCards();
}
