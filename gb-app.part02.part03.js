// カスタムpromptダイアログ（prompt()の代替）
function cfPrompt(message, defaultValue, options) {
  const opts = options || {};
  const okLabel = opts.okLabel || '決定';
  const cancelLabel = opts.cancelLabel || 'キャンセル';
  if (typeof window.GBUI?.createModal !== 'function') {
    const nativeValue = typeof window.prompt === 'function'
      ? window.prompt(String(message || ''), String(defaultValue ?? ''))
      : null;
    return Promise.resolve(nativeValue);
  }
  return new Promise(resolve => {
    const restoreFocusTo = _cfRestoreFocusTarget();
    const idBase = `gb-cf-prompt-${++_cfDialogSeq}`;
    const messageNodes = _buildCfDialogBodyNodes(message, idBase);
    const input = document.createElement('input');
    input.type = 'text';
    input.id = '_gb-prompt-input';
    input.className = 'gb-confirm-input';
    input.value = String(defaultValue ?? '');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.id = '_gb-cancel';
    cancel.className = 'gb-btn gb-btn-sm';
    cancel.textContent = cancelLabel;
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.id = '_gb-ok';
    ok.className = 'gb-btn gb-btn-sm gb-btn-primary';
    ok.textContent = okLabel;
    let result = null;
    let modalApi = null;
    const finish = (value, reason) => {
      result = value;
      modalApi.close(reason);
    };
    modalApi = _configureCfModal(window.GBUI.createModal({
      id: idBase,
      titleId: `${idBase}-title`,
      title: '入力',
      body: [...messageNodes, input],
      footer: [cancel, ok],
      variant: 'standard',
      extraClass: 'gb-confirm',
      geometryKey: 'cf-prompt',
      initialFocus: () => input,
      returnFocus: () => restoreFocusTo,
      closeLabel: '入力をキャンセル',
      closeOnEsc: true,
      closeOnOverlay: true,
      onClose: () => _completeCfModalPromise(modalApi, resolve, result),
    }), 'cf-prompt', '入力', 'dialog', messageNodes, idBase);
    ok.addEventListener('click', () => finish(input.value, 'submit'));
    cancel.addEventListener('click', () => finish(null, 'cancel'));
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(input.value, 'submit');
      }
    });
    modalApi.open();
    requestAnimationFrame(() => input.select());
  });
}

// showStatus() は meldex-core.js で定義済み（nullチェック付き）

// xlsx取込: ファイル選択 → 新規台本作成 → 台本エディタで開く
function importXlsxToOutliner() {
  document.getElementById('xlsx-import-input').click();
}

function _readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('ファイルを読み込めませんでした'));
    reader.readAsDataURL(file);
  });
}

async function handleXlsxImportToOutliner(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  if (!/\.xlsx$/i.test(file.name)) {
    showStatus('xlsx取込は .xlsx ファイルを選択してください', true);
    return;
  }

  // ファイル名（拡張子なし）を台本名にする
  const baseName = file.name.replace(/\.xlsx$/i, '');

  try {
    const data = await _readFileAsDataUrl(file);
    const res = await apiPost('/import-xlsx-scriptnote', {
      filename: file.name,
      title: baseName,
      data,
    });
    const scriptnotePath = res.path || res.node?.path;
    const label = res.label || baseName;

    // 台本エディタで開く
    if (scriptnotePath && typeof openScenarioInScriptNote === 'function') {
      openScenarioInScriptNote(scriptnotePath, label);
    }

    // フォルダツリーをリロード
    await loadOutliner();
    showStatus(`xlsx取込: ${label}`);
  } catch (err) {
    showStatus('xlsx取込に失敗しました: ' + err.message, true);
  }
}

// Phase C: ボードエンジンはgb-canvas-engine.js + gb-canvas-features.js + gb-canvas-interact.js に移行済み
// bd オブジェクトは gb-canvas-engine.js で定義

// グローバルdrop防止（未処理エリアへのドロップでブラウザがファイルを開くのを防ぐ）
document.addEventListener('dragover', (e) => { e.preventDefault(); }, false);
document.addEventListener('drop', (e) => {
  // 個別ハンドラでpreventDefaultされていない場合のみ（フォールバック）
  if (!e.defaultPrevented) e.preventDefault();
}, false);
