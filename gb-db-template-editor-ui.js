/* ==============================
   gb-db-template-editor-ui.js: カスタムテンプレートの作成・編集
   名前/説明に加えてアイコンを共通アイコンポップアップ（GBIconAssets.openPicker）で設定できる。
   作成・編集は同一のフォームモーダルを mode: 'create' | 'edit' で共用する。
   ============================== */

/**
 * アイコンspecを保存用に正規化する。
 * Lucide選択時は生名（旧版の lucide('lucide:x') 空SVG化を避けるため）、
 * Noto選択時は 'noto:HEX' のまま保存する。
 */
function _dbTemplateIconSpecForSave(spec) {
  const normalized = (typeof GBIconAssets !== 'undefined' && GBIconAssets?.normalizeSpec)
    ? GBIconAssets.normalizeSpec(spec)
    : String(spec || '');
  if (!normalized) return 'file';
  return normalized.toLowerCase().startsWith('lucide:') ? normalized.slice(7) : normalized;
}

function _dbTemplateOpenIconPicker(anchorEl, currentIcon, onSelect) {
  if (typeof GBIconAssets === 'undefined' || typeof GBIconAssets.openPicker !== 'function') return;
  GBIconAssets.openPicker({
    title: 'テンプレートアイコンを選択',
    anchorEl,
    current: currentIcon,
    allowReset: true,
    resetLabel: '既定に戻す',
    onSelect: (spec) => onSelect(_dbTemplateIconSpecForSave(spec)),
    onReset: () => onSelect('file'),
  });
}

/**
 * アイコン設定欄を構築する。GBIconAssets 未ロード環境ではボタンを出さず
 * 既定アイコンのまま進める（行き止まりUI禁止）。
 */
function _buildDbTemplateIconField(initialIcon) {
  const field = document.createElement('div');
  field.className = 'field gb-field db-template-icon-field';
  const label = document.createElement('div');
  label.className = 'gb-label';
  label.textContent = 'アイコン';
  field.appendChild(label);

  let currentIcon = initialIcon || 'file';
  const hasIconPicker = typeof GBIconAssets !== 'undefined' && typeof GBIconAssets.openPicker === 'function';

  if (!hasIconPicker) {
    const fallback = document.createElement('div');
    fallback.className = 'db-template-icon-fallback';
    fallback.innerHTML = _dbTemplateIconHtml(currentIcon, 18);
    field.appendChild(fallback);
    return { field, getIcon: () => currentIcon };
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'gb-btn gb-btn-sm db-template-icon-button';
  button.dataset.e2eId = 'db-template-icon-button';
  button.setAttribute('aria-label', 'テンプレートアイコンを選択');
  // gb-dropdown-dismiss.js の「外側クリックで閉じる」対象から自身を除外し、
  // 開いた直後に自分自身のクリックでピッカーが閉じてしまわないようにする
  button.setAttribute('aria-haspopup', 'dialog');
  const iconPreview = document.createElement('span');
  iconPreview.className = 'db-template-icon-button-preview';
  const labelSpan = document.createElement('span');
  labelSpan.className = 'db-template-icon-button-label';
  labelSpan.textContent = 'アイコンを選ぶ';
  button.append(iconPreview, labelSpan);
  const updateButton = () => {
    iconPreview.innerHTML = _dbTemplateIconHtml(currentIcon, 18);
  };
  updateButton();
  button.addEventListener('click', () => {
    _dbTemplateOpenIconPicker(button, currentIcon, (nextIcon) => {
      currentIcon = nextIcon;
      updateButton();
    });
  });
  field.appendChild(button);
  return { field, getIcon: () => currentIcon };
}

/**
 * カスタムテンプレートの作成/編集フォームモーダル本体（両モード共用）。
 * @param {object} options - { mode: 'create'|'edit', dbPath, triggerEl, initialName, initialDescription,
 *   initialIcon, previewText, editNote, onSave(fields): boolean|void }
 */
function _showDbTemplateFormModal(options) {
  const trigger = _dbTemplateTrigger(options.triggerEl);
  const mode = options.mode === 'edit' ? 'edit' : 'create';
  const seq = Date.now().toString(36) + '-' + Math.floor(Math.random() * 1000).toString(36);
  const descId = `db-template-${mode}-desc-${seq}`;
  const nameId = `db-template-name-${seq}`;
  const detailId = `db-template-desc-${seq}`;

  const modalDesc = document.createElement('div');
  modalDesc.id = descId;
  modalDesc.className = 'gb-visually-hidden';
  modalDesc.textContent = mode === 'edit'
    ? 'カスタムテンプレートの名前・説明・アイコンを編集するダイアログ'
    : '現在のシート設定をカスタムテンプレートとして保存するダイアログ';
  const body = document.createElement('div');
  body.className = 'modal-body';
  body.appendChild(modalDesc);

  const iconField = _buildDbTemplateIconField(options.initialIcon);
  body.appendChild(iconField.field);

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
  nameInput.value = options.initialName || '';
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
  descInput.value = options.initialDescription || '';
  descField.appendChild(descInput);
  body.appendChild(descField);

  // プロパティ/ビューのプレビュー概要
  const preview = document.createElement('div');
  preview.className = 'db-template-create-preview';
  preview.textContent = options.previewText || '';
  body.appendChild(preview);

  // 追加コンテンツの差し込み口（エントリレイアウトの画像同梱チェックリスト等）
  if (options.extraBody instanceof HTMLElement) body.appendChild(options.extraBody);

  if (mode === 'edit') {
    const note = document.createElement('div');
    note.className = 'db-template-edit-note';
    note.dataset.e2eId = 'db-template-edit-note';
    if (options.editNote) {
      note.textContent = options.editNote;
    } else {
      note.innerHTML = `名前・説明・アイコンのみ編集できます ${fieldHelp('列とビューは保存時点の内容のまま変更されません')}`;
    }
    body.appendChild(note);
  }
  // ボタン
  const cancelBtn = document.createElement('button');
  _setupDbTemplateButton(cancelBtn, 'gb-btn gb-btn-sm', 'db-template-' + mode + '-cancel');
  cancelBtn.textContent = 'キャンセル';
  const saveBtn = document.createElement('button');
  _setupDbTemplateButton(saveBtn, 'gb-btn gb-btn-sm gb-btn-primary primary', 'db-template-' + mode + '-save');
  saveBtn.textContent = '保存';
  let busy = false;
  let modalApi = null;
  const releaseOverflowLock = _lockDbTemplateHorizontalOverflow();
  const setBusy = (next) => {
    busy = !!next;
    if (!modalApi) return;
    modalApi.modal.setAttribute('aria-busy', busy ? 'true' : 'false');
    [cancelBtn, saveBtn, modalApi.header.querySelector('.gb-modal-close')].filter(Boolean)
      .forEach(control => { control.disabled = busy; });
  };
  saveBtn.addEventListener('click', async () => {
    if (busy) return;
    const name = nameInput.value.trim();
    if (!name) { showStatus('名前を入力してください', true); return; }
    setBusy(true);
    try {
      const result = await Promise.resolve(options.onSave({
        name,
        description: descInput.value.trim(),
        icon: iconField.getIcon(),
      }));
      if (result === false) return;
      modalApi.close('saved');
    } catch (error) {
      showStatus('カスタムテンプレートの保存に失敗: ' + (error?.message || error), true);
    } finally {
      if (modalApi.isOpen()) setBusy(false);
    }
  });
  modalApi = window.GBUI.createModal({
    id: `db-template-${mode}-${seq}`,
    title: mode === 'edit' ? 'カスタムテンプレート編集' : 'カスタムテンプレート作成',
    body,
    footer: [cancelBtn, saveBtn],
    variant: 'standard',
    extraClass: `db-template-${mode}-modal`,
    geometryKey: `db-template-${mode}`,
    minWidth: '0',
    initialFocus: nameInput,
    returnFocus: trigger || undefined,
    closeLabel: mode === 'edit' ? 'カスタムテンプレート編集を閉じる' : 'カスタムテンプレート作成を閉じる',
    onBeforeClose: reason => !busy || reason === 'saved' || reason === 'superseded',
    onClose: releaseOverflowLock,
  });
  const overlay = modalApi.overlay;
  const modal = modalApi.modal;
  modal.classList.add('modal', 'db-template-modal');
  overlay.classList.add('modal-overlay');
  overlay.dataset.dbTemplateModal = mode;
  overlay.style.zIndex = '120';
  overlay._dbTemplateTrigger = trigger;
  overlay._dbTemplateClose = modalApi.close;
  modal.dataset.e2eId = 'db-template-' + mode + '-dialog';
  modal.setAttribute('aria-describedby', descId);
  modalApi.footer.classList.add('db-template-footer');
  const closeBtn = modalApi.header.querySelector('.gb-modal-close');
  if (closeBtn) closeBtn.dataset.e2eId = `db-template-${mode}-close`;
  cancelBtn.addEventListener('click', () => modalApi.close('cancel'));
  _setDbTemplateModalSize(modal, { maxWidth: 500, maxHeight: 560, heightRatio: 0.66, minHeight: 400 });
  modalApi.open();
}

/**
 * 現在のシートからカスタムテンプレートを作成するダイアログを開く。
 */
function showCreateTemplateModal(dbPath, triggerEl = null) {
  const exported = exportDbAsTemplate(dbPath);
  if (exported.properties.length === 0) {
    showStatus('このシートには列タイプが設定されていません', true);
    return;
  }

  const viewCount = Array.isArray(exported.savedViews) ? exported.savedViews.length : 0;
  const layoutCount = Array.isArray(exported.entityLayouts) ? exported.entityLayouts.length : 0;
  const previewText = '含まれる列: ' + exported.properties.map(p => p.name).join(', ')
    + (viewCount ? `（ビュー${viewCount}件を含む）` : '')
    + (layoutCount ? `（エントリレイアウト${layoutCount}件を含む）` : '');

  // エントリレイアウト内のアップロード画像は「指定したものだけ」テンプレートへ同梱する（既定OFF）。
  // 同梱しない画像はパス参照のままになり、テンプレート適用先では画像の再設定が必要になる。
  const uploadImages = typeof listDbTemplateEntityLayoutUploadImages === 'function'
    ? listDbTemplateEntityLayoutUploadImages(exported)
    : [];
  let extraBody = null;
  if (uploadImages.length) {
    extraBody = document.createElement('div');
    extraBody.className = 'db-template-image-embed';
    extraBody.dataset.e2eId = 'db-template-image-embed';
    const head = document.createElement('div');
    head.className = 'db-template-image-embed-head';
    head.innerHTML = 'テンプレートへ同梱する画像 ' + (typeof fieldHelp === 'function'
      ? fieldHelp('チェックした画像はテンプレート自体に埋め込まれ、適用先でもそのまま表示されます（1枚500KBまで）。チェックしない画像は元ファイルの場所を参照するだけになり、適用先では画像の再設定が必要です')
      : '');
    extraBody.appendChild(head);
    uploadImages.forEach(item => {
      const row = document.createElement('label');
      row.className = 'db-template-image-embed-row';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.dataset.cellId = item.cellId;
      check.dataset.e2eId = 'db-template-image-embed-check';
      row.appendChild(check);
      const span = document.createElement('span');
      const fileName = String(item.path || '').split(/[\\/]/).pop() || '(画像)';
      span.textContent = (item.layoutName ? item.layoutName + ': ' : '') + fileName;
      row.appendChild(span);
      extraBody.appendChild(row);
    });
  }

  _showDbTemplateFormModal({
    mode: 'create',
    dbPath,
    triggerEl,
    initialName: '',
    initialDescription: '',
    initialIcon: exported.icon || 'file',
    previewText,
    extraBody,
    onSave: async ({ name, description, icon }) => {
      exported.name = name;
      exported.description = description;
      exported.icon = icon;
      if (extraBody && typeof embedDbTemplateEntityLayoutImages === 'function') {
        const selectedIds = Array.from(extraBody.querySelectorAll('input[type="checkbox"][data-cell-id]'))
          .filter(check => check.checked)
          .map(check => check.dataset.cellId);
        const embedResult = await embedDbTemplateEntityLayoutImages(exported, selectedIds);
        if (embedResult.skipped > 0) {
          showStatus(`同梱できなかった画像が${embedResult.skipped}件あります（500KB超またはアクセス不可）。パス参照のまま保存します`, true);
        }
      }
      const customs = getCustomTemplates();
      customs.push(exported);
      if (!saveCustomTemplates(customs, { label: 'シートテンプレート: カスタムテンプレート作成', detail: name })) return false;
      showStatus('カスタムテンプレート「' + name + '」を保存しました');
    },
  });
}

/**
 * 既存のカスタムテンプレートの名前・説明・アイコンを編集するダイアログを開く。
 * プロパティ・ビューは保存時点のスナップショットのまま変更しない。
 */
function showEditTemplateModal(tmpl, dbPath, triggerEl = null) {
  if (!tmpl || tmpl.tier !== 0) return;
  const propCount = (tmpl.properties || []).length;
  const viewCount = Array.isArray(tmpl.savedViews) ? tmpl.savedViews.length : 0;
  const previewText = `列${propCount}件` + (viewCount ? ` / ビュー${viewCount}件` : '');

  _showDbTemplateFormModal({
    mode: 'edit',
    dbPath,
    triggerEl,
    initialName: tmpl.name || '',
    initialDescription: tmpl.description || '',
    initialIcon: tmpl.icon || 'file',
    previewText,
    onSave: ({ name, description, icon }) => {
      const customs = getCustomTemplates();
      const idx = customs.findIndex(c => c.id === tmpl.id);
      if (idx < 0) { showStatus('カスタムテンプレートが見つかりません', true); return false; }
      customs[idx] = { ...customs[idx], name, description, icon };
      if (!saveCustomTemplates(customs, { label: 'シートテンプレート: カスタムテンプレート編集', detail: name })) return false;
      showStatus('カスタムテンプレート「' + name + '」を更新しました');
    },
  });
}
