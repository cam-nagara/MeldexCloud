      const card = _buildTemplateCard(tmpl, dbPath, overlay);
      grid.appendChild(card);
    });
  }

  renderTemplateCards();
}

/**
 * テンプレートカードを構築
 */
function _buildTemplateCard(tmpl, dbPath, overlayEl) {
  const card = document.createElement('div');
  card.className = 'template-card';
  card.dataset.e2eId = 'db-template-card';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', 'テンプレート「' + (tmpl.name || '') + '」を確認');

  // アイコン + 名前
  const titleRow = document.createElement('div');
  titleRow.className = 'template-card-title-row';
  const icon = document.createElement('span');
  icon.innerHTML = typeof lucide === 'function' ? lucide(tmpl.icon || 'file', 18) : '';
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

  // 説明
  const desc = document.createElement('div');
  desc.textContent = tmpl.description;
  desc.className = 'template-card-desc';
  card.appendChild(desc);

  // プロパティプレビュー
  const propInfo = document.createElement('div');
  propInfo.className = 'template-card-props';
  const propNames = tmpl.properties.map(p => p.name).slice(0, 5).join(', ');
  const extra = tmpl.properties.length > 5 ? ' +' + (tmpl.properties.length - 5) : '';
  propInfo.textContent = propNames + extra;
  card.appendChild(propInfo);

  // 適用ボタン
  const btnRow = document.createElement('div');
  btnRow.className = 'template-card-actions';
  const applyBtn = document.createElement('button');
  _setupDbTemplateButton(applyBtn, 'gb-btn gb-btn-sm gb-btn-primary primary', 'db-template-card-apply', 'テンプレート「' + (tmpl.name || '') + '」を適用');
  applyBtn.textContent = '適用';
  applyBtn.addEventListener('click', e => {
    e.stopPropagation();
    _doApplyTemplate(dbPath, tmpl, overlayEl, overlayEl?._dbTemplateTrigger || card);
  });
  btnRow.appendChild(applyBtn);

  // カスタムテンプレートの場合: 削除ボタン
  if (tmpl.tier === 0) {
    const delBtn = document.createElement('button');
    _setupDbTemplateButton(delBtn, 'gb-btn gb-btn-sm gb-btn-danger', 'db-template-card-delete', 'カスタムテンプレート「' + (tmpl.name || '') + '」を削除');
    delBtn.textContent = '削除';
    delBtn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!await _confirmDbTemplate('カスタムテンプレート「' + tmpl.name + '」を削除しますか？')) return;
      const customs = getCustomTemplates().filter(c => c.id !== tmpl.id);
      if (!saveCustomTemplates(customs, { label: 'シートテンプレート: カスタムテンプレート削除', detail: tmpl.name })) return;
      _closeDbTemplateOverlay(overlayEl, overlayEl?._dbTemplateTrigger || card, { restoreFocus: false });
      showTemplateGalleryModal(dbPath, overlayEl?._dbTemplateTrigger || card);
    });
    btnRow.appendChild(delBtn);
  }
  card.appendChild(btnRow);

  // カードクリック → プレビュー
  const openPreview = () => showTemplatePreviewModal(tmpl, dbPath, overlayEl, card);
  card.addEventListener('click', openPreview);
  card.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openPreview();
  });

  return card;
}

/**
 * テンプレートを適用する
 */
async function _doApplyTemplate(dbPath, tmpl, overlayEl, triggerEl = null) {
  let result;
  try {
    result = applyDbTemplate(dbPath, tmpl);
    if (result.backendSavePromise) await result.backendSavePromise;
  } catch (e) {
    showStatus('テンプレート適用に失敗: ' + (e.message || e), true);
    return;
  }
  _closeDbTemplateOverlay(overlayEl, triggerEl || overlayEl?._dbTemplateTrigger || null);

  let msg = 'テンプレート「' + tmpl.name + '」を適用しました';
  if (result.skipped.length > 0) {
    msg += '（' + result.skipped.length + '件スキップ: 既存プロパティ）';
  }
  showStatus(msg);

  // DB再読み込み
  if (typeof selectDatabase === 'function') selectDatabase(dbPath);
}

/* --- テンプレートプレビューモーダル --- */

function showTemplatePreviewModal(tmpl, dbPath, parentOverlay, triggerEl = null) {
  const trigger = _dbTemplateTrigger(triggerEl);
  const seq = Date.now().toString(36) + '-' + Math.floor(Math.random() * 1000).toString(36);
  const titleId = `db-template-preview-title-${seq}`;
  const descId = `db-template-preview-desc-${seq}`;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.dbTemplateModal = 'preview';
  overlay.style.zIndex = '130';

  const modal = document.createElement('div');
  modal.className = 'modal db-template-modal db-template-preview-modal';
  modal.dataset.e2eId = 'db-template-preview-dialog';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', titleId);
  modal.setAttribute('aria-describedby', descId);
  modal.tabIndex = -1;
  _setDbTemplateModalSize(modal, { maxWidth: 500, maxHeight: 680, heightRatio: 0.74, minHeight: 360 });

  // タイトル
  const h3 = document.createElement('h3');
  h3.id = titleId;
  h3.textContent = tmpl.name;
  modal.appendChild(h3);

  const desc = document.createElement('p');
  desc.id = descId;
  desc.textContent = tmpl.description;
  desc.className = 'db-template-description';
  modal.appendChild(desc);

  // プロパティ一覧テーブル
  const table = document.createElement('table');
  table.className = 'db-template-prop-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">プロパティ</th>'
    + '<th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">型</th>'
    + '<th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">オプション</th></tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  tmpl.properties.forEach(p => {
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
  modal.appendChild(table);

  // ビュータイプ
  if (tmpl.enabledModes) {
    const modeDiv = document.createElement('div');
    modeDiv.className = 'db-template-mode-summary';
    const modeLabels = { pivot: 'テーブル', gallery: 'ギャラリー', kanban: 'カンバン', timeline: 'タイムライン', chart: 'チャート' };
    modeDiv.textContent = '推奨ビュー: ' + tmpl.enabledModes.map(m => modeLabels[m] || m).join(', ');
    modal.appendChild(modeDiv);
  }

  // ボタン
  const btnRow = document.createElement('div');
  btnRow.className = 'db-template-footer';
  const cancelBtn = document.createElement('button');
  _setupDbTemplateButton(cancelBtn, 'gb-btn gb-btn-sm', 'db-template-preview-back');
  cancelBtn.textContent = '戻る';
  cancelBtn.addEventListener('click', () => _closeDbTemplateOverlay(overlay, trigger));
  btnRow.appendChild(cancelBtn);
  const applyBtn = document.createElement('button');
  _setupDbTemplateButton(applyBtn, 'gb-btn gb-btn-sm gb-btn-primary primary', 'db-template-preview-apply');
  applyBtn.textContent = '適用';
  applyBtn.addEventListener('click', () => {
    _closeDbTemplateOverlay(overlay, trigger, { restoreFocus: false });
    _doApplyTemplate(dbPath, tmpl, parentOverlay, parentOverlay?._dbTemplateTrigger || trigger);
  });
  btnRow.appendChild(applyBtn);
  modal.appendChild(btnRow);

  overlay.appendChild(modal);
  _showDbTemplateOverlay(overlay, modal, trigger, modal);
}

function _typeLabel(type) {
  const labels = {
    text: 'テキスト', number: '数値', select: 'セレクト', 'multi-select': 'マルチセレクト',
    checkbox: 'チェックボックス', date: '日時', url: 'URL', relation: 'リレーション',
    'multi-relation': 'マルチリレーション', formula: '数式',
  };
  return labels[type] || type;
}

/* --- カスタムテンプレート作成モーダル --- */

function showCreateTemplateModal(dbPath, triggerEl = null) {
  const exported = exportDbAsTemplate(dbPath);
  if (exported.properties.length === 0) {
    showStatus('このシートにはプロパティ型が設定されていません', true);
    return;
  }

  const trigger = _dbTemplateTrigger(triggerEl);
  const seq = Date.now().toString(36) + '-' + Math.floor(Math.random() * 1000).toString(36);
  const titleId = `db-template-create-title-${seq}`;
  const descId = `db-template-create-desc-${seq}`;
  const nameId = `db-template-name-${seq}`;
  const detailId = `db-template-desc-${seq}`;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.dbTemplateModal = 'create';
  overlay.style.zIndex = '120';

  const modal = document.createElement('div');
  modal.className = 'modal db-template-modal db-template-create-modal';
  modal.dataset.e2eId = 'db-template-create-dialog';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', titleId);
  modal.setAttribute('aria-describedby', descId);
  modal.tabIndex = -1;
  _setDbTemplateModalSize(modal, { maxWidth: 500, maxHeight: 520, heightRatio: 0.62, minHeight: 360 });

  const h3 = document.createElement('h3');
  h3.id = titleId;
  h3.textContent = 'カスタムテンプレート作成';
  modal.appendChild(h3);
  const modalDesc = document.createElement('div');
  modalDesc.id = descId;
  modalDesc.className = 'gb-visually-hidden';
  modalDesc.textContent = '現在のシート設定をカスタムテンプレートとして保存するダイアログ';
  modal.appendChild(modalDesc);

  const body = document.createElement('div');
  body.className = 'modal-body';

  // 名前入力
  const nameField = document.createElement('div');
  nameField.className = 'field gb-field';
  const nameLabel = document.createElement('label');
  nameLabel.className = 'gb-label';
  nameLabel.htmlFor = nameId;
  nameLabel.textContent = 'テンプレート名';
  nameField.appendChild(nameLabel);
  const nameInput = document.createElement('input');
  nameInput.id = nameId;
  nameInput.className = 'gb-input';
  nameInput.dataset.e2eId = 'db-template-name-input';
  nameInput.type = 'text';
  nameInput.placeholder = '例: キャラシート（カスタム）';
  nameField.appendChild(nameInput);
  body.appendChild(nameField);

  // 説明入力
  const descField = document.createElement('div');
  descField.className = 'field gb-field';
  const descLabel = document.createElement('label');
  descLabel.className = 'gb-label';
  descLabel.htmlFor = detailId;
  descLabel.textContent = '説明';
  descField.appendChild(descLabel);
  const descInput = document.createElement('input');
  descInput.id = detailId;
  descInput.className = 'gb-input';
  descInput.dataset.e2eId = 'db-template-desc-input';
  descInput.type = 'text';
  descInput.placeholder = 'テンプレートの説明';
  descField.appendChild(descInput);
  body.appendChild(descField);

  // プロパティプレビュー
  const preview = document.createElement('div');
  preview.className = 'db-template-create-preview';
  preview.textContent = '含まれるプロパティ: ' + exported.properties.map(p => p.name).join(', ');
  body.appendChild(preview);
  modal.appendChild(body);

  // ボタン
  const btnRow = document.createElement('div');
  btnRow.className = 'db-template-footer';
  const cancelBtn = document.createElement('button');
  _setupDbTemplateButton(cancelBtn, 'gb-btn gb-btn-sm', 'db-template-create-cancel');
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.addEventListener('click', () => _closeDbTemplateOverlay(overlay, trigger));
  btnRow.appendChild(cancelBtn);
  const saveBtn = document.createElement('button');
  _setupDbTemplateButton(saveBtn, 'gb-btn gb-btn-sm gb-btn-primary primary', 'db-template-create-save');
  saveBtn.textContent = '保存';
  saveBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) { showStatus('名前を入力してください', true); return; }
    exported.name = name;
    exported.description = descInput.value.trim();
    const customs = getCustomTemplates();
    customs.push(exported);
    if (!saveCustomTemplates(customs, { label: 'シートテンプレート: カスタムテンプレート作成', detail: name })) return;
    _closeDbTemplateOverlay(overlay, trigger);
    showStatus('カスタムテンプレート「' + name + '」を保存しました');
  });
  btnRow.appendChild(saveBtn);
  modal.appendChild(btnRow);

  overlay.appendChild(modal);
  _showDbTemplateOverlay(overlay, modal, trigger, nameInput);
}
