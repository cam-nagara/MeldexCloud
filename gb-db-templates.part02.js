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

  // アイコン + 名前
  const titleRow = document.createElement('div');
  titleRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
  const icon = document.createElement('span');
  icon.innerHTML = typeof lucide === 'function' ? lucide(tmpl.icon || 'file', 18) : '';
  icon.style.cssText = 'color:var(--accent);flex-shrink:0;';
  titleRow.appendChild(icon);
  const name = document.createElement('span');
  name.textContent = tmpl.name;
  name.style.cssText = 'font-weight:bold;font-size:14px;';
  titleRow.appendChild(name);
  if (tmpl.tier > 0) {
    const badge = document.createElement('span');
    badge.textContent = 'T' + tmpl.tier;
    badge.style.cssText = 'font-size:10px;background:var(--bg4);color:var(--fg2);padding:1px 6px;border-radius:8px;margin-left:auto;';
    titleRow.appendChild(badge);
  }
  card.appendChild(titleRow);

  // 説明
  const desc = document.createElement('div');
  desc.textContent = tmpl.description;
  desc.style.cssText = 'font-size:12px;color:var(--fg2);margin-bottom:8px;line-height:1.4;';
  card.appendChild(desc);

  // プロパティプレビュー
  const propInfo = document.createElement('div');
  propInfo.style.cssText = 'font-size:11px;color:var(--fg2);';
  const propNames = tmpl.properties.map(p => p.name).slice(0, 5).join(', ');
  const extra = tmpl.properties.length > 5 ? ' +' + (tmpl.properties.length - 5) : '';
  propInfo.textContent = propNames + extra;
  card.appendChild(propInfo);

  // 適用ボタン
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'margin-top:8px;display:flex;gap:6px;';
  const applyBtn = document.createElement('button');
  applyBtn.textContent = '適用';
  applyBtn.className = 'primary';
  applyBtn.style.cssText = 'font-size:12px;padding:3px 12px;';
  applyBtn.addEventListener('click', e => {
    e.stopPropagation();
    _doApplyTemplate(dbPath, tmpl, overlayEl);
  });
  btnRow.appendChild(applyBtn);

  // カスタムテンプレートの場合: 削除ボタン
  if (tmpl.tier === 0) {
    const delBtn = document.createElement('button');
    delBtn.textContent = '削除';
    delBtn.style.cssText = 'font-size:12px;padding:3px 8px;color:var(--fg2);';
    delBtn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!await _confirmDbTemplate('カスタムテンプレート「' + tmpl.name + '」を削除しますか？')) return;
      const customs = getCustomTemplates().filter(c => c.id !== tmpl.id);
      if (!saveCustomTemplates(customs, { label: 'シートテンプレート: カスタムテンプレート削除', detail: tmpl.name })) return;
      overlayEl.remove();
      showTemplateGalleryModal(dbPath);
    });
    btnRow.appendChild(delBtn);
  }
  card.appendChild(btnRow);

  // カードクリック → プレビュー
  card.addEventListener('click', () => showTemplatePreviewModal(tmpl, dbPath, overlayEl));

  return card;
}

/**
 * テンプレートを適用する
 */
async function _doApplyTemplate(dbPath, tmpl, overlayEl) {
  let result;
  try {
    result = applyDbTemplate(dbPath, tmpl);
    if (result.backendSavePromise) await result.backendSavePromise;
  } catch (e) {
    showStatus('テンプレート適用に失敗: ' + (e.message || e), true);
    return;
  }
  overlayEl.remove();

  let msg = 'テンプレート「' + tmpl.name + '」を適用しました';
  if (result.skipped.length > 0) {
    msg += '（' + result.skipped.length + '件スキップ: 既存プロパティ）';
  }
  showStatus(msg);

  // DB再読み込み
  if (typeof selectDatabase === 'function') selectDatabase(dbPath);
}

/* --- テンプレートプレビューモーダル --- */

function showTemplatePreviewModal(tmpl, dbPath, parentOverlay) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.dbTemplateModal = 'preview';
  overlay.style.zIndex = '130';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.cssText = 'width:500px;max-width:90vw;max-height:70vh;overflow-y:auto;';

  // タイトル
  const h3 = document.createElement('h3');
  h3.textContent = tmpl.name;
  h3.style.margin = '0 0 8px 0';
  modal.appendChild(h3);

  const desc = document.createElement('p');
  desc.textContent = tmpl.description;
  desc.style.cssText = 'color:var(--fg2);font-size:13px;margin:0 0 12px 0;';
  modal.appendChild(desc);

  // プロパティ一覧テーブル
  const table = document.createElement('table');
  table.style.cssText = 'width:100%;font-size:12px;border-collapse:collapse;';
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
    tdName.style.cssText = 'padding:4px 8px;border-bottom:1px solid var(--bg4);';
    tr.appendChild(tdName);

    const tdType = document.createElement('td');
    tdType.textContent = _typeLabel(p.type.type);
    tdType.style.cssText = 'padding:4px 8px;border-bottom:1px solid var(--bg4);color:var(--fg2);';
    tr.appendChild(tdType);

    const tdOpts = document.createElement('td');
    tdOpts.style.cssText = 'padding:4px 8px;border-bottom:1px solid var(--bg4);color:var(--fg2);font-size:11px;';
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
    modeDiv.style.cssText = 'margin-top:12px;font-size:12px;color:var(--fg2);';
    const modeLabels = { pivot: 'テーブル', gallery: 'ギャラリー', kanban: 'カンバン', timeline: 'タイムライン', chart: 'チャート' };
    modeDiv.textContent = '推奨ビュー: ' + tmpl.enabledModes.map(m => modeLabels[m] || m).join(', ');
    modal.appendChild(modeDiv);
  }

  // ボタン
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'margin-top:16px;display:flex;justify-content:flex-end;gap:8px;';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '戻る';
  cancelBtn.addEventListener('click', () => overlay.remove());
  btnRow.appendChild(cancelBtn);
  const applyBtn = document.createElement('button');
  applyBtn.textContent = '適用';
  applyBtn.className = 'primary';
  applyBtn.addEventListener('click', () => {
    overlay.remove();
    _doApplyTemplate(dbPath, tmpl, parentOverlay);
  });
  btnRow.appendChild(applyBtn);
  modal.appendChild(btnRow);

  overlay.appendChild(modal);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
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

function showCreateTemplateModal(dbPath) {
  const exported = exportDbAsTemplate(dbPath);
  if (exported.properties.length === 0) {
    showStatus('このシートにはプロパティ型が設定されていません', true);
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.dbTemplateModal = 'create';
  overlay.style.zIndex = '120';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.cssText = 'width:500px;max-width:90vw;';

  const h3 = document.createElement('h3');
  h3.textContent = 'カスタムテンプレート作成';
  h3.style.margin = '0 0 12px 0';
  modal.appendChild(h3);

  const body = document.createElement('div');
  body.className = 'modal-body';
  body.style.paddingRight = '4px';

  // 名前入力
  const nameField = document.createElement('div');
  nameField.className = 'field';
  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'テンプレート名';
  nameField.appendChild(nameLabel);
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = '例: キャラシート（カスタム）';
  nameField.appendChild(nameInput);
  body.appendChild(nameField);

  // 説明入力
  const descField = document.createElement('div');
  descField.className = 'field';
  const descLabel = document.createElement('label');
  descLabel.textContent = '説明';
  descField.appendChild(descLabel);
  const descInput = document.createElement('input');
  descInput.type = 'text';
  descInput.placeholder = 'テンプレートの説明';
  descField.appendChild(descInput);
  body.appendChild(descField);

  // プロパティプレビュー
  const preview = document.createElement('div');
  preview.style.cssText = 'font-size:12px;color:var(--fg2);margin:8px 0;padding:8px;background:var(--bg3);border-radius:4px;';
  preview.textContent = '含まれるプロパティ: ' + exported.properties.map(p => p.name).join(', ');
  body.appendChild(preview);
  modal.appendChild(body);

  // ボタン
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'margin-top:16px;display:flex;justify-content:flex-end;gap:8px;';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.addEventListener('click', () => overlay.remove());
  btnRow.appendChild(cancelBtn);
  const saveBtn = document.createElement('button');
  saveBtn.textContent = '保存';
  saveBtn.className = 'primary';
  saveBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) { showStatus('名前を入力してください', true); return; }
    exported.name = name;
    exported.description = descInput.value.trim();
    const customs = getCustomTemplates();
    customs.push(exported);
    if (!saveCustomTemplates(customs, { label: 'シートテンプレート: カスタムテンプレート作成', detail: name })) return;
    overlay.remove();
    showStatus('カスタムテンプレート「' + name + '」を保存しました');
  });
  btnRow.appendChild(saveBtn);
  modal.appendChild(btnRow);

  overlay.appendChild(modal);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  setTimeout(() => nameInput.focus(), 50);
}
