      items[(index + delta + items.length) % items.length]?.focus();
    } else if (ev.key === 'Home') {
      ev.preventDefault();
      items[0]?.focus();
    } else if (ev.key === 'End') {
      ev.preventDefault();
      items.at(-1)?.focus();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      closeMenu(true);
    }
  });
  pointerCloser = (ev) => {
    if (!menu.contains(ev.target) && !btn?.contains?.(ev.target)) closeMenu(false);
  };
  keyCloser = (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closeMenu(true);
    }
  };
  document.addEventListener('pointerdown', pointerCloser, true);
  document.addEventListener('keydown', keyCloser, true);
  requestAnimationFrame(() => menu.querySelector('.ab-dropdown-item')?.focus());
}

function _screenshotModeIsRegion(mode) {
  return String(mode || '').includes('region');
}

async function _setMeldexWindowVisibilityForScreenshot(action, hwnds) {
  if (window.MeldexRuntimeAdapter?.isDropboxMode?.()) return null;
  try {
    const res = await fetch(API_BASE + '/app-window-visibility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, hwnds: hwnds || [] }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function _hideMeldexWindowForScreenshot() {
  const state = await _setMeldexWindowVisibilityForScreenshot('hide');
  if (!state?.hidden) window.blur();
  await new Promise(r => setTimeout(r, 500));
  return state;
}

async function _restoreMeldexWindowForScreenshot(state) {
  if (state?.hidden) await _setMeldexWindowVisibilityForScreenshot('restore', state.hwnds || []);
  else window.focus();
}

function _cropScreenshotCanvas(canvas, region) {
  const cropped = document.createElement('canvas');
  cropped.width = Math.max(1, Math.round(region.width));
  cropped.height = Math.max(1, Math.round(region.height));
  cropped.getContext('2d').drawImage(
    canvas,
    Math.round(region.x),
    Math.round(region.y),
    cropped.width,
    cropped.height,
    0,
    0,
    cropped.width,
    cropped.height
  );
  return cropped;
}

function _selectScreenshotRegionFromCanvas(canvas) {
  return new Promise(resolve => {
    const restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay screenshot-region-overlay';
    overlay.dataset.modalShell = 'off';
    overlay.dataset.e2eId = 'screenshot-region-overlay';
    overlay.style.zIndex = '5000';

    const shell = document.createElement('div');
    shell.className = 'screenshot-region-shell';
    shell.dataset.e2eId = 'screenshot-region-shell';
    shell.tabIndex = -1;
    shell.setAttribute('role', 'dialog');
    shell.setAttribute('aria-modal', 'true');
    shell.setAttribute('aria-label', 'スクリーンショット範囲選択');

    const stage = document.createElement('div');
    stage.className = 'screenshot-region-stage';
    stage.dataset.e2eId = 'screenshot-region-stage';
    stage.tabIndex = 0;
    stage.setAttribute('role', 'group');
    stage.setAttribute('aria-label', '保存する範囲');

    const preview = document.createElement('canvas');
    preview.className = 'screenshot-region-preview';
    preview.setAttribute('aria-hidden', 'true');
    preview.width = canvas.width;
    preview.height = canvas.height;
    preview.getContext('2d').drawImage(canvas, 0, 0);
    const maxW = Math.max(1, Math.floor(window.innerWidth * 0.94));
    const maxH = Math.max(1, Math.floor(window.innerHeight * 0.82));
    const scale = Math.min(maxW / canvas.width, maxH / canvas.height, 1);
    preview.style.width = Math.max(1, Math.round(canvas.width * scale)) + 'px';
    preview.style.height = Math.max(1, Math.round(canvas.height * scale)) + 'px';

    const selection = document.createElement('div');
    selection.className = 'screenshot-region-selection';
    selection.setAttribute('aria-hidden', 'true');
    selection.style.display = 'none';

    const actions = document.createElement('div');
    actions.className = 'screenshot-region-actions';
    actions.setAttribute('aria-label', '範囲選択の操作');

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'gb-btn gb-btn-sm';
    cancel.dataset.e2eId = 'screenshot-region-cancel';
    cancel.textContent = 'キャンセル';

    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'gb-btn gb-btn-sm gb-btn-primary';
    ok.dataset.e2eId = 'screenshot-region-save';
    ok.textContent = '保存';

    actions.append(cancel, ok);
    stage.append(preview, selection);
    shell.append(stage, actions);
    overlay.append(shell);
    document.body.appendChild(overlay);

    let start = null;
    let current = null;
    let activePointerId = null;
    let cleaned = false;

    const cleanup = (value) => {
      if (cleaned) return;
      cleaned = true;
      overlay.remove();
      document.removeEventListener('keydown', onKeyDown);
      if (restoreFocusTo?.isConnected && !restoreFocusTo.closest?.('.screenshot-region-overlay')) {
        restoreFocusTo.focus?.();
      }
      resolve(value);
    };
    const pointFromEvent = (ev) => {
      const rect = preview.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(rect.width, ev.clientX - rect.left)),
        y: Math.max(0, Math.min(rect.height, ev.clientY - rect.top)),
        rect,
      };
    };
    const visibleRect = () => {
      if (!start || !current) return null;
      const left = Math.min(start.x, current.x);
      const top = Math.min(start.y, current.y);
      const width = Math.abs(current.x - start.x);
      const height = Math.abs(current.y - start.y);
      return { left, top, width, height };
    };
    const updateSelection = () => {
      const rect = visibleRect();
      if (!rect || rect.width < 1 || rect.height < 1) {
        selection.style.display = 'none';
        return;
      }
      selection.style.display = 'block';
      selection.style.left = rect.left + 'px';
      selection.style.top = rect.top + 'px';
      selection.style.width = rect.width + 'px';
      selection.style.height = rect.height + 'px';
    };
    const canvasRegion = () => {
      const rect = visibleRect();
      if (!rect || rect.width < 4 || rect.height < 4) return null;
      const bounds = preview.getBoundingClientRect();
      const scaleX = canvas.width / bounds.width;
      const scaleY = canvas.height / bounds.height;
      const x = Math.max(0, Math.min(canvas.width - 1, rect.left * scaleX));
      const y = Math.max(0, Math.min(canvas.height - 1, rect.top * scaleY));
      return {
        x,
        y,
        width: Math.max(1, Math.min(canvas.width - x, rect.width * scaleX)),
        height: Math.max(1, Math.min(canvas.height - y, rect.height * scaleY)),
      };
    };
    function onKeyDown(ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        cleanup(null);
      } else if (ev.key === 'Enter') {
        const region = canvasRegion();
        if (region) cleanup(region);
      }
    }
    stage.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      stage.focus?.();
      activePointerId = ev.pointerId;
      try { stage.setPointerCapture?.(ev.pointerId); } catch {}
      start = pointFromEvent(ev);
      current = start;
      updateSelection();
    });
    stage.addEventListener('pointermove', (ev) => {
      if (activePointerId == null || ev.pointerId !== activePointerId) return;
      current = pointFromEvent(ev);
      updateSelection();
    });
    stage.addEventListener('pointerup', (ev) => {
      if (activePointerId == null || ev.pointerId !== activePointerId) return;
      current = pointFromEvent(ev);
      try { stage.releasePointerCapture?.(ev.pointerId); } catch {}
      activePointerId = null;
      updateSelection();
    });
    stage.addEventListener('pointercancel', (ev) => {
      if (activePointerId != null && ev.pointerId === activePointerId) activePointerId = null;
    });
    cancel.addEventListener('click', () => cleanup(null));
    ok.addEventListener('click', () => {
      const region = canvasRegion();
      if (!region) {
        showStatus('範囲を選択してください', true);
        return;
      }
      cleanup(region);
    });
    document.addEventListener('keydown', onKeyDown);
    shell.focus();
  });
}

async function captureScreenshot(mode) {
  let stream = null;
  let hideState = null;
  try {
    const hideFirst = mode.includes('hide');
    if (hideFirst) hideState = await _hideMeldexWindowForScreenshot();
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'monitor' } });
    const video = document.createElement('video');
    const loaded = new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = () => reject(new Error('画面キャプチャ映像を読み込めませんでした'));
    });
    video.srcObject = stream;
    await video.play();
    await loaded;
    await new Promise(r => setTimeout(r, 200));
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    stream.getTracks().forEach(t => t.stop());
    stream = null;
    if (hideFirst) {
      await _restoreMeldexWindowForScreenshot(hideState);
      hideState = null;
    }
    let outputCanvas = canvas;
    if (_screenshotModeIsRegion(mode)) {
      const region = await _selectScreenshotRegionFromCanvas(canvas);
      if (!region) return;
      outputCanvas = _cropScreenshotCanvas(canvas, region);
    }
    const b64 = outputCanvas.toDataURL('image/png');
    const res = await apiPost('/annotation/screenshot', { data: b64, target_path: '_screenshots' });
    if (res.path) {
      showStatus('スクリーンショットを保存しました', false, { showSaveDialog: true });
      const viewerUrl = window.MeldexResourceUrl?.viewer
        ? window.MeldexResourceUrl.viewer({ file: res.path, markup: 1 })
        : ('/viewer?file=' + encodeURIComponent(res.path) + '&markup=1');
      window.open(viewerUrl, '_blank');
    }
  } catch (e) {
    if (e.name !== 'NotAllowedError') showStatus('スクリーンショット失敗: ' + e.message, true);
  } finally {
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (hideState) await _restoreMeldexWindowForScreenshot(hideState);
  }
}

// モバイル: スワイプでサイドバー開閉
(function() {
  let touchStartX = 0, touchStartY = 0;
  document.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (window.innerWidth > 768) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return; // 横スワイプのみ
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (dx > 0 && touchStartX < 40 && !sidebar.classList.contains('open')) {
      // 左端から右スワイプ → サイドバー開く
      sidebar.classList.add('open');
      if (backdrop) {
        backdrop.classList.add('open');
        backdrop.style.setProperty('display', 'block', 'important');
      }
    } else if (dx < 0 && sidebar.classList.contains('open')) {
      // 左スワイプ → サイドバー閉じる
      sidebar.classList.remove('open');
      if (backdrop) {
        backdrop.classList.remove('open');
        backdrop.style.setProperty('display', 'none', 'important');
      }
    }
  }, { passive: true });
})();

/* ==============================
   ステータスバー
   ============================== */
// メッセージ先頭行をタイトル、残りを本文として HTML を組み立てる。
// 単一行メッセージは従来通り本文 div のみ表示し、複数行のみタイトル化する。
function _buildCfDialogBody(message) {
  const text = String(message ?? '');
  if (!text) return '';
  // v0.5.250: .gb-confirm-message クラスに統一 (CSS で line-height / white-space / word-break を一括指定)。
  // 複数行メッセージでは先頭行を強調表示 (font-weight) し、以降を本文として扱う。
  const lines = text.split('\n');
  if (lines.length < 2) {
    return `<div class="gb-confirm-message">${esc(text)}</div>`;
  }
  const title = (lines.shift() || '').trim();
  const body = lines.join('\n').trim();
  let html = '';
  if (title) html += `<div class="gb-confirm-message" style="font-weight:600;">${esc(title)}</div>`;
  if (body) html += `<div class="gb-confirm-message" style="color:var(--ui-fg-muted);">${esc(body)}</div>`;
  return html;
}

// v0.5.250: cf ダイアログは .modal (大型殻) から .gb-confirm (コンパクト殻) に統一。
// - ヘッダー / フッター分割なし (短い問いかけ専用)
// - OK ボタンは .gb-btn-primary 基準、message に「削除」が含まれる場合は .gb-btn-danger + ラベル「削除」に自動切替
// - options.danger で明示指定可、options.okLabel / options.cancelLabel で文言上書き可
function _cfIsDeleteMessage(text) {
  // 破壊的操作を示唆するキーワード。
  // 「元に戻す」(= undo) は破壊的でないため「デフォルト.*戻」のみ (リセット系) を拾う。
  // 「を空に」は「ゴミ箱を空にする/します/しますか」を両活用形でカバーする。
  return /削除|破棄|除去|消去|初期化|リセット|を空に|デフォルト.{0,8}戻/.test(String(text || ''));
}

let _cfDialogSeq = 0;
function _cfRestoreFocusTarget() {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function _enhanceCfDialog(overlay, kind, label) {
  const dialog = overlay?.querySelector?.('.gb-confirm');
  if (!dialog) return null;
  const idBase = `gb-${kind}-${++_cfDialogSeq}`;
  overlay.dataset.e2eId = `${kind}-overlay`;
  dialog.dataset.e2eId = `${kind}-dialog`;
  dialog.id = dialog.id || `${idBase}-dialog`;
  dialog.setAttribute('aria-label', label);
  const messages = [...dialog.querySelectorAll('.gb-confirm-message')];
  messages.forEach((message, index) => { message.id = message.id || `${idBase}-message-${index}`; });
  if (messages.length) dialog.setAttribute('aria-describedby', messages.map(message => message.id).join(' '));
  return dialog;
}

function _restoreCfDialogFocus(target, overlay) {
  if (target?.isConnected && !overlay?.contains?.(target)) target.focus?.();
}

// カスタムalertダイアログ（alert()の代替、画面中央モーダル）
function cfAlert(message, options) {
  const opts = options || {};
  const okLabel = opts.okLabel || 'OK';
  const showSupport = opts.support !== false && /HTTP\s+\d{3}|Error|エラー|失敗|例外/.test(String(message || ''));
  const supportButton = showSupport
    ? '<button id="_gb-support" class="gb-btn gb-btn-sm">サポートに送信</button>'
    : '';
  return new Promise(resolve => {
    const restoreFocusTo = _cfRestoreFocusTarget();
    const o = document.createElement('div');
    o.className = 'modal-overlay';
    o.style.zIndex = '300';
    o.innerHTML = `<div class="gb-confirm" role="alertdialog" aria-modal="true">
      ${_buildCfDialogBody(message)}
      <div class="gb-confirm-actions">
        ${supportButton}
        <button id="_gb-ok" class="gb-btn gb-btn-sm gb-btn-primary">${esc(okLabel)}</button>
      </div>
    </div>`;
    document.body.appendChild(o);
    _enhanceCfDialog(o, 'cf-alert', 'お知らせ');
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      o.remove();
      document.removeEventListener('keydown', kh);
      _restoreCfDialogFocus(restoreFocusTo, o);
      resolve();
    };
    function kh(e) {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        cleanup();
      }
    }
    o.querySelector('#_gb-ok').addEventListener('click', cleanup);
    o.querySelector('#_gb-support')?.addEventListener('click', () => {
      window.MeldexDiagnostics?.showSupportDialog?.(new Error(String(message || '')), { kind: 'cfAlert' });
    });
    o.addEventListener('click', (e) => { if (e.target === o) cleanup(); });
    document.addEventListener('keydown', kh);
    o.querySelector('#_gb-ok').focus();
  });
}

// カスタムconfirmダイアログ（confirm()の代替、画面中央モーダル）
// options: { danger?: boolean, okLabel?: string, cancelLabel?: string }
function cfConfirm(message, options) {
  const opts = options || {};
  const autoDanger = _cfIsDeleteMessage(message);
  const isDanger = opts.danger !== undefined ? !!opts.danger : autoDanger;
  const defaultOk = isDanger ? (autoDanger && /削除/.test(String(message)) ? '削除' : '実行') : '決定';
  const okLabel = opts.okLabel || defaultOk;
  const cancelLabel = opts.cancelLabel || 'キャンセル';
  const okVariant = isDanger ? 'gb-btn-danger' : 'gb-btn-primary';
  return new Promise(resolve => {
    const restoreFocusTo = _cfRestoreFocusTarget();
    const o = document.createElement('div');
    o.className = 'modal-overlay';
    o.style.zIndex = '300';
    o.innerHTML = `<div class="gb-confirm" role="alertdialog" aria-modal="true">
      ${_buildCfDialogBody(message)}
      <div class="gb-confirm-actions">
        <button id="_gb-cancel" class="gb-btn gb-btn-sm">${esc(cancelLabel)}</button>
        <button id="_gb-ok" class="gb-btn gb-btn-sm ${okVariant}">${esc(okLabel)}</button>
      </div>
    </div>`;
    document.body.appendChild(o);
    _enhanceCfDialog(o, 'cf-confirm', '確認');
    let done = false;
    const cleanup = (val) => {
      if (done) return;
      done = true;
      o.remove();
      document.removeEventListener('keydown', kh);
      _restoreCfDialogFocus(restoreFocusTo, o);
      resolve(val);
    };
    function kh(e) {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(false); return; }
      // 通常モードは Enter = OK のショートカット。
      // danger モードは誤操作防止のため Enter のショートカットを無効化し、
      // フォーカスされたボタン (初期は cancel) の自然な Enter 起動に任せる。
      if (e.key === 'Enter' && !isDanger) {
        const active = document.activeElement;
        if (active?.id === '_gb-cancel' || active?.id === '_gb-ok') return;
        e.preventDefault();
        cleanup(true);
      }
    }
    o.querySelector('#_gb-ok').addEventListener('click', () => cleanup(true));
    o.querySelector('#_gb-cancel').addEventListener('click', () => cleanup(false));
    o.addEventListener('click', (e) => { if (e.target === o) cleanup(false); });
    document.addEventListener('keydown', kh);
    // danger 時は誤操作防止のため cancel に初期フォーカス、それ以外は ok
    o.querySelector(isDanger ? '#_gb-cancel' : '#_gb-ok').focus();
  });
}

// カスタムpromptダイアログ（prompt()の代替）
function cfPrompt(message, defaultValue, options) {
  const opts = options || {};
  const okLabel = opts.okLabel || '決定';
  const cancelLabel = opts.cancelLabel || 'キャンセル';
  return new Promise(resolve => {
    const restoreFocusTo = _cfRestoreFocusTarget();
    const o = document.createElement('div');
    o.className = 'modal-overlay';
    o.style.zIndex = '300';
    o.innerHTML = `<div class="gb-confirm" role="dialog" aria-modal="true">
      ${_buildCfDialogBody(message)}
      <input type="text" id="_gb-prompt-input" class="gb-confirm-input" value="${esc(defaultValue ?? '')}">
      <div class="gb-confirm-actions">
        <button type="button" id="_gb-cancel" class="gb-btn gb-btn-sm">${esc(cancelLabel)}</button>
        <button type="button" id="_gb-ok" class="gb-btn gb-btn-sm gb-btn-primary">${esc(okLabel)}</button>
      </div>
    </div>`;
    document.body.appendChild(o);
    _enhanceCfDialog(o, 'cf-prompt', '入力');
    const input = o.querySelector('#_gb-prompt-input');
    let done = false;
    const cleanup = (val) => {
      if (done) return;
      done = true;
      o.remove();
      document.removeEventListener('keydown', kh);
      _restoreCfDialogFocus(restoreFocusTo, o);
      resolve(val);
    };
    function kh(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup(null);
      }
    }
    o.querySelector('#_gb-ok').addEventListener('click', () => cleanup(input.value));
    o.querySelector('#_gb-cancel').addEventListener('click', () => cleanup(null));
    o.addEventListener('click', (e) => { if (e.target === o) cleanup(null); });
    document.addEventListener('keydown', kh);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); cleanup(input.value); }
      if (e.key === 'Escape') { e.preventDefault(); cleanup(null); }
    });
    input.focus();
    input.select();
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

/* === gb-app.part03.js === */
// timeline-view(カレンダー)へのD&Dドロップ（ファイルから新規イベント作成）
function _appLocalDateTimeInputValue(date) {
  if (typeof formatLocalDateTime === 'function') return formatLocalDateTime(date);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function _appShouldHandleStandaloneCalendarDrop() {
  return state.view === 'timeline'
    && !state.currentDbPath
    && typeof _showCalEventInDetailPanel === 'function';
}

{
  const tv = document.getElementById('timeline-view');
  if (tv) tv.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('application/x-meldex-node') && _appShouldHandleStandaloneCalendarDrop()) e.preventDefault();
  });
  if (tv) tv.addEventListener('drop', (e) => {
    if (!_appShouldHandleStandaloneCalendarDrop()) return;
    const cfData = e.dataTransfer.getData('application/x-meldex-node');
    if (!cfData) return;
    e.preventDefault();
    try {
      const { name, path } = JSON.parse(cfData);
      // 詳細パネルにイベント編集を表示（タイトルにファイル名、リンク付き）
      const now = new Date();
      const startVal = _appLocalDateTimeInputValue(now);
      const endH = new Date(now.getTime() + 3600000);
      const endVal = _appLocalDateTimeInputValue(endH);
      if (typeof _showCalEventInDetailPanel === 'function') {
        _showCalEventInDetailPanel(
          { title: name, description: '[[' + name + ']](' + path + ')' },
          [], startVal, endVal, false
        );
      }
    } catch {}
  });
}

// main-viewsへのD&Dドロップ
// 通常ドロップ: 各ビュー固有のハンドラに委ねる（ノート→リンク挿入、キャンバス→ノード追加）
// Ctrl+ドロップ: ファイルをそのパネルで開く
{
  const mv = document.getElementById('main-views');
  if (mv) mv.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('application/x-meldex-node')) {
      // Ctrl+ドラッグ時のみmain-viewsレベルで受け付け（ファイルを開く）
      // 通常時は各ビュー固有のdragoverに委ねる
      if (e.ctrlKey && state.view !== 'board') e.preventDefault();
    }
  });
  if (mv) mv.addEventListener('drop', (e) => {
    // Ctrl+ドロップ: ファイルをパネルで開く
    if (!e.ctrlKey) return; // 通常ドロップは各ビュー固有ハンドラに委ねる
    if (state.view === 'board') return;
    const cfData = e.dataTransfer.getData('application/x-meldex-node');
    if (!cfData) return;
    e.preventDefault();
    try {
      const { name, path, type } = JSON.parse(cfData);
      const navType = typeof _normalizeOpenTypeForNav === 'function'
        ? _normalizeOpenTypeForNav(type)
        : (type === 'database' ? 'pivot' : type === 'board' ? 'board' : (type || 'page'));
      navOpen({ type: navType, label: name, path });
    } catch {}
  });
}

// Phase D: HTMLビューワー(viewer.html)のiframe通信のみ残存
// canvas/calendarのpostMessageはPhase Cで直接関数呼び出しに変換済み
function _getTrustedEmbeddedMessageIframe(e) {
  if (!e) return null;
  const candidates = [];
  const addCandidate = iframe => {
    if (iframe && !candidates.includes(iframe)) candidates.push(iframe);
  };
  addCandidate((typeof _getActiveIframe === 'function') ? _getActiveIframe() : null);
  addCandidate(document.getElementById('html-iframe'));
  document.querySelectorAll('iframe').forEach(addCandidate);
  for (const iframe of candidates) {
    if (!iframe?.contentWindow || e.source !== iframe.contentWindow) continue;
    const iframeSrc = iframe.getAttribute('src') || iframe.src || '';
    if (!_gbIsTrustedInternalViewerUrl(iframeSrc)) continue;
    if (e.origin === window.location.origin || e.origin === 'null') return iframe;
  }
  return null;
}

function _isTrustedEmbeddedMessage(e) {
  return !!_getTrustedEmbeddedMessageIframe(e);
}

function _syncViewerCurrentFileFromMessage(msg) {
  const path = typeof msg?.path === 'string' ? msg.path : '';
  if (!path) return false;
  state.currentPagePath = path;
  if (typeof highlightOutlinerNode === 'function') highlightOutlinerNode(path);
  if (typeof _showFileInfoInDetailPanel === 'function') _showFileInfoInDetailPanel(path);
  return true;
}

const _VIEWER_FOLDER_NAV_FILE_EXTS = new Set([
  '.png', '.apng', '.jpg', '.jpeg', '.jpe', '.jfif', '.gif', '.bmp', '.webp',
  '.svg', '.ico', '.avif', '.tif', '.tiff', '.heic', '.heif', '.psd', '.psb',
  '.pdf',
]);
const _viewerFolderNavDisplayableCache = new Map();

function _viewerFolderNavCleanPath(path) {
  return String(path || '').replace(/\\/g, '/').split('#')[0].split('?')[0].replace(/\/+$/, '');
}

function _viewerFolderNavExt(path) {
  const name = _viewerFolderNavCleanPath(path).split('/').pop() || '';
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index).toLowerCase() : '';
}

function _viewerFolderNavIsDisplayableFile(path) {
  return _VIEWER_FOLDER_NAV_FILE_EXTS.has(_viewerFolderNavExt(path));
}

function _viewerFolderNavParentPath(path) {
  const clean = _viewerFolderNavCleanPath(path);
  if (!clean) return '';
  if (!_viewerFolderNavIsDisplayableFile(clean)) return clean;
  const index = clean.lastIndexOf('/');
  return index >= 0 ? clean.slice(0, index) : '';
}

function _viewerFolderNavCurrentFolderFromMessage(msg) {
  const folderPath = _viewerFolderNavCleanPath(msg?.folderPath || '');
  if (folderPath) return folderPath;
  return _viewerFolderNavParentPath(msg?.currentPath || msg?.path || state.currentPagePath || '');
}

function _viewerFolderNavNodePath(node) {
  return _viewerFolderNavCleanPath(node?._nodeData?.path || node?.dataset?.path || '');
}

function _viewerFolderNavPathMatches(nodePath, targetPath) {
  if (typeof _outlinerHighlightPathMatches === 'function') return _outlinerHighlightPathMatches(nodePath, targetPath);
  const a = _viewerFolderNavCleanPath(nodePath).toLowerCase();
  const b = _viewerFolderNavCleanPath(targetPath).toLowerCase();
  return !!a && !!b && (a === b || a.endsWith('/' + b) || b.endsWith('/' + a));
}

function _viewerFolderNavIsFolderNode(node) {
  const data = node?._nodeData || {};
  if (!node || node.style?.display === 'none') return false;
  return data.type === 'folder' || data._isRoot === true;
}

function _viewerFolderNavFolderNodes() {
  const candidates = [...document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node')];
  return candidates.filter(node => _viewerFolderNavIsFolderNode(node) && _viewerFolderNavNodePath(node));
}

function _viewerFolderNavFindIndex(nodes, targetPath) {
  if (!targetPath) return -1;
  return nodes.findIndex(node => _viewerFolderNavPathMatches(_viewerFolderNavNodePath(node), targetPath));
}

function _viewerFolderNavDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function _viewerFolderNavEnsureNodeExpanded(node) {
  const toggle = node?.querySelector?.(':scope > .tree-node-row .tree-toggle');
  if (!toggle || toggle.dataset.expanded === undefined || toggle.dataset.expanded === 'true') return false;
  const childrenDiv = node.querySelector(':scope > .tree-children');
  toggle.click();
  for (let i = 0; i < 30; i++) {
    await _viewerFolderNavDelay(100);
    if (!childrenDiv) break;
    if (!childrenDiv.classList.contains('collapsed') && childrenDiv.dataset.loaded === 'true') break;
  }
  return true;
}

async function _viewerFolderNavEnsureAncestorsExpanded(node) {
  const ancestors = [];
  let parent = node?.parentElement?.closest?.('.tree-node') || null;
  while (parent) {
    ancestors.unshift(parent);
    parent = parent.parentElement?.closest?.('.tree-node') || null;
  }
  for (const ancestor of ancestors) {
    await _viewerFolderNavEnsureNodeExpanded(ancestor);
  }
}

async function _viewerFolderNavRevealCurrentFolder(folderPath) {
  if (!folderPath) return;
  if (typeof _autoExpandToPath === 'function') {
    try { await _autoExpandToPath(folderPath, true); } catch {}
  }
  if (typeof highlightOutlinerNode === 'function') {
    try { highlightOutlinerNode(folderPath, { noScroll: true }); } catch {}
  }
  await _viewerFolderNavDelay(50);
}

function _viewerFolderNavDisplayableFromBrowseItems(items) {
  const files = Array.isArray(items) ? items.filter(item => item && item.type !== 'folder') : [];
  const images = files.filter(item => item.type === 'image' || _viewerFolderNavIsDisplayableFile(item.path || item.name || ''))
    .filter(item => _viewerFolderNavExt(item.path || item.name || '') !== '.pdf');
  const pdfs = files.filter(item => _viewerFolderNavExt(item.path || item.name || '') === '.pdf');
  return {
    has: images.length > 0 || pdfs.length > 0,
    hasImage: images.length > 0,
    firstImage: images[0] || null,
    firstPdf: pdfs[0] || null,
  };
}

async function _viewerFolderNavDisplayableInFolder(folderPath) {
  const key = _viewerFolderNavCleanPath(folderPath);
  if (!key) return { has: false, hasImage: false, firstImage: null, firstPdf: null };
  if (_viewerFolderNavDisplayableCache.has(key)) return _viewerFolderNavDisplayableCache.get(key);
  const result = await apiFetch('/browse?path=' + encodeURIComponent(key) + '&all_files=true')
    .then(items => _viewerFolderNavDisplayableFromBrowseItems(items))
    .catch(() => ({ has: false, hasImage: false, firstImage: null, firstPdf: null }));
  _viewerFolderNavDisplayableCache.set(key, result);
  return result;
}

function _viewerFolderNavOpenTarget(folderPath, result) {
  const targetPath = result?.hasImage ? folderPath : (result?.firstPdf?.path || folderPath);
  if (typeof highlightOutlinerNode === 'function') highlightOutlinerNode(targetPath);
  if (result?.hasImage) {
    openViewer('/viewer?folder=' + encodeURIComponent(folderPath));
  } else if (result?.firstPdf?.path) {
    openViewer('/viewer?pdf=' + encodeURIComponent(result.firstPdf.path));
  }
}

async function _navigateViewerFolderByTreeOrder(direction, currentFolderPath) {
  await _viewerFolderNavRevealCurrentFolder(currentFolderPath);
  let cursorPath = currentFolderPath;
  for (let guard = 0; guard < 400; guard++) {
    const nodes = _viewerFolderNavFolderNodes();
    if (!nodes.length) break;
    let cursorIndex = _viewerFolderNavFindIndex(nodes, cursorPath);
    if (cursorIndex < 0) cursorIndex = direction > 0 ? -1 : nodes.length;
    const candidate = nodes[cursorIndex + direction];
    if (!candidate) break;
    await _viewerFolderNavEnsureAncestorsExpanded(candidate);
    const candidatePath = _viewerFolderNavNodePath(candidate);
    if (!candidatePath) {
      cursorPath = '';
      continue;
    }
    const result = await _viewerFolderNavDisplayableInFolder(candidatePath);
    if (result.has) {
      _viewerFolderNavOpenTarget(candidatePath, result);
      return true;
    }
    const expanded = await _viewerFolderNavEnsureNodeExpanded(candidate);
    if (expanded && direction < 0) continue;
    cursorPath = candidatePath;
  }
  return false;
}

function _handleViewerFolderNavRequest(msg) {
  const direction = Number(msg?.direction) < 0 ? -1 : 1;
  const currentFolderPath = _viewerFolderNavCurrentFolderFromMessage(msg);
  _navigateViewerFolderByTreeOrder(direction, currentFolderPath).then(moved => {
    if (!moved && typeof showStatus === 'function') {
      showStatus('画像またはPDFがあるフォルダがありません', true);
    }
  }).catch(error => {
    if (typeof showStatus === 'function') showStatus('フォルダ移動に失敗しました: ' + (error?.message || error || ''), true);
  });
}

window.addEventListener('message', (e) => {
  if (!_isTrustedEmbeddedMessage(e)) return;
  const msg = e.data;
  if (!msg || !msg.type) return;
  if (msg.type === 'viewer-current-file-changed') { _syncViewerCurrentFileFromMessage(msg); return; }
  if (msg.type === 'viewer-folder-nav-request') { _handleViewerFolderNavRequest(msg); return; }
  const reloadEmbeddedAnnotations = () => {
    const annotationView = (typeof _getAnnotationViewName === 'function') ? _getAnnotationViewName() : state.view;
    if (typeof _usesEmbeddedAnnotationSurface === 'function' && _usesEmbeddedAnnotationSurface(annotationView) && typeof _loadAnnotationsToIframe === 'function') {
      _loadAnnotationsToIframe();
    }
  };
  // HTMLビューワーiframeからのステータス通知
  if (msg.type === 'board-status') { showStatus(msg.message, msg.isError); }
  // ヒストリー更新通知
  if (msg.type === 'history-update') { renderHistoryList(); }
  // HTMLビューワーiframe内メモからの保存依頼
  if (msg.type === 'ann-save-stroke') {
    apiPost('/annotations', {
      target_path: msg.targetPath || ann.targetPath, type: msg.annType,
      data: msg.data, color: msg.color, opacity: msg.opacity, user: getUsername(),
    }).then(res => {
      if (res?.id && typeof _pushAnnotationCreateHistory === 'function') {
        _pushAnnotationCreateHistory(res.id, '注釈: 描画追加', msg.targetPath || ann.targetPath).catch(() => {});
      }
      if (typeof _dispatchEmbeddedAnnotationMessage === 'function') _dispatchEmbeddedAnnotationMessage({ type: 'ann-stroke-saved', annId: res.id, annClientId: msg.annClientId });
    }).catch((err) => {
      if (typeof _dispatchEmbeddedAnnotationMessage === 'function') {
        _dispatchEmbeddedAnnotationMessage({ type: 'ann-stroke-save-failed', annClientId: msg.annClientId });
