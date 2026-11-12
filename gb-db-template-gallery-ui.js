/* ==============================
   gb-db-template-gallery-ui.js: シートテンプレートギャラリー（刷新UI）
   検索付きヘッダー + Tierチップ行 + カードグリッド/プレビューペインの2ペイン構成。
   一覧・検索・分類・プレビューは全アプリ共通のテンプレート選択画面（gb-template-picker.js）を使い、
   ここではシート用のサムネイル（列見出し付きの小さな表）と、列表・ビュー一覧の詳細描画、
   作成・編集ダイアログ共通のプラミングを担当する（2026-11-11 全アプリのテンプレート画面を統一）。

   設計意図（UI共通ルールとの整合、2026-08-19 UI統一）:
   - カードは「クリックで選択のみ」。適用/編集/削除はデスクトップ=プレビューペイン、
     モバイル=重ねプレビューモーダルへ集約し、同じ操作ボタンを二重表示しない。
   - 説明文はカードへ常時表示せず data-gb-tooltip（ホバー/フォーカス/長押し）へ集約する。
     選択後のプレビュー（ペイン/重ねモーダル）は詳細表示面なので説明文を可視のまま残す。
   - Tierチップは .gb-btn 系を基底にし、フィルタ選択状態だけ pill 形状+accent の
     修飾クラス（.template-tier-btn）で表現する。
   - プレビューペイン付き2ペイン構成は「一覧と詳細の分離」（ビュータブ等と同じ
     選択→詳細操作パターン）を1モーダル内で成立させるための意図的な専用レイアウト。
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

/* --- 列表（テンプレート選択画面のプレビュー詳細で使用） --- */

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

const DB_TEMPLATE_VIEW_MODE_LABELS = { pivot: 'テーブル', tree: 'ツリー', gallery: 'ギャラリー', kanban: 'カンバン', timeline: 'タイムライン', gantt: 'ガント', chart: 'チャート' };

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

/* --- サムネイル（列見出し付きの小さな表） --- */

const _DB_TEMPLATE_TIER_LABELS = { 1: '基本', 2: '標準', 3: 'ジャンル別', custom: 'カスタム' };

function _renderDbTemplateThumbnail(tmpl, host, size) {
  const large = size === 'large';
  const wrap = document.createElement('div');
  wrap.className = 'gb-tpl-sheet';
  const head = document.createElement('div');
  head.className = 'gb-tpl-sheet-title';
  const icon = document.createElement('span');
  icon.className = 'gb-tpl-sheet-icon';
  icon.innerHTML = _dbTemplateIconHtml(tmpl.icon, large ? 16 : 12);
  const title = document.createElement('span');
  title.textContent = tmpl.name || '';
  head.append(icon, title);
  const table = document.createElement('div');
  table.className = 'gb-tpl-sheet-table';
  const columns = ['名前', ...(tmpl.properties || []).map(prop => prop?.name || '').filter(Boolean)].slice(0, large ? 6 : 4);
  table.style.gridTemplateColumns = `repeat(${columns.length}, minmax(0, 1fr))`;
  columns.forEach(name => {
    const cell = document.createElement('span');
    cell.className = 'gb-tpl-sheet-th';
    cell.textContent = name;
    table.appendChild(cell);
  });
  for (let row = 0; row < (large ? 5 : 3); row += 1) {
    columns.forEach(() => {
      const cell = document.createElement('span');
      cell.className = 'gb-tpl-sheet-td';
      table.appendChild(cell);
    });
  }
  wrap.append(head, table);
  host.appendChild(wrap);
}

function _dbTemplatePickerItems() {
  return getAllTemplates().map(tmpl => {
    const tierKey = tmpl.tier === 0 ? 'custom' : String(tmpl.tier || '');
    const viewCount = Array.isArray(tmpl.savedViews) ? tmpl.savedViews.length : (tmpl.enabledModes || []).length;
    return {
      ...tmpl,
      builtin: tmpl.tier !== 0,
      category: tierKey,
      categoryLabel: _DB_TEMPLATE_TIER_LABELS[tierKey] || '',
      badge: `${(tmpl.properties || []).length}列・${viewCount}ビュー`,
      renderThumbnail: (host, options) => _renderDbTemplateThumbnail(tmpl, host, options?.size),
      details: host => {
        host.appendChild(_buildDbTemplateViewsSummarySection(tmpl));
        host.appendChild(_buildDbTemplatePropTable(tmpl));
        if (Array.isArray(tmpl.entityTemplates) && tmpl.entityTemplates.length) {
          const entityDiv = document.createElement('div');
          entityDiv.className = 'db-template-preview-pane-entities';
          entityDiv.textContent = 'トピック雛形: ' + tmpl.entityTemplates.map(e => e.name).join(', ');
          host.appendChild(entityDiv);
        }
        if (Array.isArray(tmpl.entityLayouts) && tmpl.entityLayouts.length) {
          const layoutsDiv = document.createElement('div');
          layoutsDiv.className = 'db-template-preview-pane-entities';
          layoutsDiv.textContent = 'トピックレイアウト: ' + tmpl.entityLayouts.map(l => l?.name || 'レイアウト').join(', ');
          host.appendChild(layoutsDiv);
        }
      },
    };
  });
}

/* --- テンプレートギャラリー（全アプリ共通のサムネイル選択画面） --- */

/**
 * シートテンプレートの選択画面を開く。ノート・シナリオ・ボードと同じ共通画面
 * （gb-template-picker.js）を使い、適用・編集・削除・現在のシートから作成を行う。
 */
function showTemplateGalleryModal(dbPath, triggerEl = null) {
  const trigger = _dbTemplateTrigger(triggerEl);
  if (!window.MeldexTemplatePicker) {
    showStatus('テンプレート選択画面を読み込めませんでした', true);
    return null;
  }
  const releaseOverflowLock = _lockDbTemplateHorizontalOverflow();
  const findTemplate = id => getAllTemplates().find(tmpl => tmpl.id === id) || null;
  const picker = window.MeldexTemplatePicker.open({
    id: 'sheet-templates',
    title: 'シートテンプレート',
    items: _dbTemplatePickerItems(),
    searchPlaceholder: 'テンプレートを検索（名前・説明・列名）',
    emptyText: 'テンプレートがありません',
    cardClass: 'template-card',
    e2e: {
      dialog: 'db-template-gallery-dialog', grid: 'db-template-grid', preview: 'db-template-preview-pane',
      search: 'db-template-search-input', card: 'db-template-card', categoryPrefix: 'db-template-tier-',
      apply: 'db-template-preview-pane-apply', close: 'db-template-gallery-close',
    },
    onClose: releaseOverflowLock,
    primaryAction: {
      label: '適用',
      run: async item => {
        const tmpl = findTemplate(item.id);
        if (!tmpl) throw new Error('テンプレートが見つかりません');
        return _doApplyTemplate(dbPath, tmpl, null, trigger);
      },
    },
    itemActions: [
      { label: '編集', e2eId: 'db-template-preview-pane-edit', when: item => !item.builtin, run: (item, ctx) => {
        const tmpl = findTemplate(item.id);
        if (!tmpl) throw new Error('テンプレートが見つかりません');
        ctx.close('edit');
        showEditTemplateModal(tmpl, dbPath, trigger);
        return false;
      } },
      { label: '削除', danger: true, e2eId: 'db-template-preview-pane-delete', when: item => !item.builtin, run: async (item, ctx) => {
        const tmpl = findTemplate(item.id);
        if (!tmpl) throw new Error('テンプレートが見つかりません');
        await _deleteDbCustomTemplateWithConfirm(tmpl, () => ctx.refresh(_dbTemplatePickerItems()), null);
        return false;
      } },
    ],
  });
  // 作成・編集ダイアログや後始末が使う、シートテンプレート画面の共通目印。
  if (picker?.overlay) {
    picker.overlay.classList.add('modal-overlay');
    picker.overlay.dataset.dbTemplateModal = 'gallery';
    picker.overlay._dbTemplateTrigger = trigger;
    picker.overlay._dbTemplateClose = reason => picker.close(reason);
    picker.modal?.classList.add('modal', 'db-template-modal');
  }
  return picker;
}
