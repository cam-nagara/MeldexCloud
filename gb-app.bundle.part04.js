
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
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay screenshot-region-overlay';
    overlay.style.zIndex = '5000';
    overlay.style.background = 'rgba(0,0,0,0.68)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';

    const shell = document.createElement('div');
    shell.className = 'screenshot-region-shell';
    shell.style.display = 'flex';
    shell.style.flexDirection = 'column';
    shell.style.gap = '8px';
    shell.style.maxWidth = '94vw';
    shell.style.maxHeight = '92vh';

    const stage = document.createElement('div');
    stage.className = 'screenshot-region-stage';
    stage.style.position = 'relative';
    stage.style.overflow = 'hidden';
    stage.style.background = '#111';
    stage.style.border = '1px solid rgba(255,255,255,0.35)';
    stage.style.cursor = 'crosshair';
    stage.style.touchAction = 'none';

    const preview = document.createElement('canvas');
    preview.width = canvas.width;
    preview.height = canvas.height;
    preview.getContext('2d').drawImage(canvas, 0, 0);
    const maxW = Math.max(1, Math.floor(window.innerWidth * 0.94));
    const maxH = Math.max(1, Math.floor(window.innerHeight * 0.82));
    const scale = Math.min(maxW / canvas.width, maxH / canvas.height, 1);
    preview.style.width = Math.max(1, Math.round(canvas.width * scale)) + 'px';
    preview.style.height = Math.max(1, Math.round(canvas.height * scale)) + 'px';
    preview.style.display = 'block';

    const selection = document.createElement('div');
    selection.className = 'screenshot-region-selection';
    selection.style.position = 'absolute';
    selection.style.border = '2px solid #fff';
    selection.style.boxShadow = '0 0 0 9999px rgba(0,0,0,0.35)';
    selection.style.pointerEvents = 'none';
    selection.style.display = 'none';

    const actions = document.createElement('div');
    actions.className = 'screenshot-region-actions';
    actions.style.display = 'flex';
    actions.style.justifyContent = 'flex-end';
    actions.style.gap = '8px';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'gb-btn gb-btn-sm';
    cancel.textContent = 'キャンセル';

    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'gb-btn gb-btn-sm gb-btn-primary';
    ok.textContent = '保存';

    actions.append(cancel, ok);
    stage.append(preview, selection);
    shell.append(stage, actions);
    overlay.append(shell);
    document.body.appendChild(overlay);

    let start = null;
    let current = null;
    let activePointerId = null;

    const cleanup = (value) => {
      overlay.remove();
      document.removeEventListener('keydown', onKeyDown);
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
      if (ev.key === 'Escape') cleanup(null);
      if (ev.key === 'Enter') {
        const region = canvasRegion();
        if (region) cleanup(region);
      }
    }
    stage.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      activePointerId = ev.pointerId;
      stage.setPointerCapture?.(ev.pointerId);
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
      stage.releasePointerCapture?.(ev.pointerId);
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
    ok.focus();
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

// カスタムalertダイアログ（alert()の代替、画面中央モーダル）
function cfAlert(message, options) {
  const opts = options || {};
  const okLabel = opts.okLabel || 'OK';
  const showSupport = opts.support !== false && /HTTP\s+\d{3}|Error|エラー|失敗|例外/.test(String(message || ''));
  const supportButton = showSupport
    ? '<button id="_gb-support" class="gb-btn gb-btn-sm">サポートに送信</button>'
    : '';
  return new Promise(resolve => {
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
    const cleanup = () => { o.remove(); document.removeEventListener('keydown', kh); resolve(); };
    function kh(e) { if (e.key === 'Enter' || e.key === 'Escape') cleanup(); }
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
    const cleanup = (val) => { o.remove(); document.removeEventListener('keydown', kh); resolve(val); };
    function kh(e) {
      if (e.key === 'Escape') { cleanup(false); return; }
      // 通常モードは Enter = OK のショートカット。
      // danger モードは誤操作防止のため Enter のショートカットを無効化し、
      // フォーカスされたボタン (初期は cancel) の自然な Enter 起動に任せる。
      if (e.key === 'Enter' && !isDanger) {
        const active = document.activeElement;
        if (active?.id === '_gb-cancel' || active?.id === '_gb-ok') return;
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
    const o = document.createElement('div');
    o.className = 'modal-overlay';
    o.style.zIndex = '300';
    o.innerHTML = `<div class="gb-confirm" role="dialog" aria-modal="true">
      ${_buildCfDialogBody(message)}
      <input type="text" id="_gb-prompt-input" class="gb-confirm-input" value="${esc(defaultValue ?? '')}">
      <div class="gb-confirm-actions">
        <button id="_gb-cancel" class="gb-btn gb-btn-sm">${esc(cancelLabel)}</button>
        <button id="_gb-ok" class="gb-btn gb-btn-sm gb-btn-primary">${esc(okLabel)}</button>
      </div>
    </div>`;
    document.body.appendChild(o);
    const input = o.querySelector('#_gb-prompt-input');
    const cleanup = (val) => { o.remove(); resolve(val); };
    o.querySelector('#_gb-ok').addEventListener('click', () => cleanup(input.value));
    o.querySelector('#_gb-cancel').addEventListener('click', () => cleanup(null));
    o.addEventListener('click', (e) => { if (e.target === o) cleanup(null); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') cleanup(input.value); if (e.key === 'Escape') cleanup(null); });
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
function _isTrustedEmbeddedMessage(e) {
  const iframe = (typeof _getActiveIframe === 'function') ? _getActiveIframe() : document.getElementById('html-iframe');
  if (!e || !iframe?.contentWindow || e.source !== iframe.contentWindow) return false;
  if (e.origin === window.location.origin) return true;
  const iframeSrc = iframe.getAttribute('src') || iframe.src || '';
  return e.origin === 'null' && _gbIsTrustedInternalViewerUrl(iframeSrc);
}

window.addEventListener('message', (e) => {
  if (!_isTrustedEmbeddedMessage(e)) return;
  const msg = e.data;
  if (!msg || !msg.type) return;
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
      }
      if (typeof showStatus === 'function') showStatus('注釈の保存に失敗しました: ' + (err?.message || err || ''), true);
    });
  }
  if (msg.type === 'ann-delete') {
    if (msg.annId) {
      (async () => {
        const before = typeof _fetchAnnotationHistoryRow === 'function'
          ? await _fetchAnnotationHistoryRow(msg.annId).catch(() => null)
          : null;
        await apiDelete('/annotations/' + encodeURIComponent(msg.annId));
        if (typeof _pushAnnotationHistory === 'function') _pushAnnotationHistory('注釈: 削除', before, null, msg.annId);
        reloadEmbeddedAnnotations();
      })().catch(() => {});
    }
  }
  if (msg.type === 'ann-delete-note') {
    if (msg.annId && msg.data) {
      if (typeof _putAnnotationWithHistory === 'function') {
        _putAnnotationWithHistory(msg.annId, { data: msg.data }, '注釈: 削除', msg.annId)
          .then(reloadEmbeddedAnnotations)
          .catch(() => {});
      } else {
        apiPut('/annotations/' + encodeURIComponent(msg.annId), { data: msg.data }).then(reloadEmbeddedAnnotations).catch(() => {});
      }
    }
  }
  if (msg.type === 'ann-update-note') {
    if (msg.annId && (msg.data || msg.color)) {
      const body = msg.color ? { color: msg.color } : { data: msg.data };
      const label = msg.color ? '注釈: 色変更' : '注釈: 付箋更新';
      if (typeof _putAnnotationWithHistory === 'function') {
        _putAnnotationWithHistory(msg.annId, body, label, msg.annId).catch(() => {});
      } else {
        apiPut('/annotations/' + encodeURIComponent(msg.annId), body).catch(() => {});
      }
    }
  }
  if (msg.type === 'ann-create-note') {
    const annotationView = (typeof _getAnnotationViewName === 'function') ? _getAnnotationViewName() : state.view;
    const embedded = typeof _usesEmbeddedAnnotationSurface === 'function' && _usesEmbeddedAnnotationSurface(annotationView);
    if (!embedded && !msg.targetPath && typeof createNote === 'function') {
      const prevColor = ann.color;
      const prevOpacity = ann.opacity;
      if (msg.color) ann.color = msg.color;
      ann.opacity = 1;
      Promise.resolve(createNote(msg.x, msg.y, 'sticky')).finally(() => {
        ann.color = prevColor;
        ann.opacity = prevOpacity;
      });
      return;
    }
    const annClientId = msg.annClientId || ('pending-note-' + Date.now().toString(36));
    const noteData = { x: msg.x, y: msg.y, width: 180, height: 100, text: '', html: '', user: getUsername() };
    if (embedded && typeof _dispatchEmbeddedAnnotationMessage === 'function') {
      _dispatchEmbeddedAnnotationMessage({
        type: 'ann-add-note',
        item: {
          id: annClientId,
          type: 'comment',
          shape: 'sticky',
          data: noteData,
          color: msg.color || ann.color,
          opacity: 1,
          user: getUsername(),
          created: new Date().toISOString(),
        },
      });
    }
    apiPost('/annotations', {
      target_path: msg.targetPath || ann.targetPath,
      type: 'comment', shape: 'sticky',
      data: noteData, color: msg.color || ann.color, opacity: 1, user: getUsername(),
    }).then(res => {
      if (res?.id && typeof _pushAnnotationCreateHistory === 'function') {
        _pushAnnotationCreateHistory(res.id, '注釈: 付箋追加', msg.targetPath || ann.targetPath).catch(() => {});
      }
      if (embedded) reloadEmbeddedAnnotations();
      else renderNote(res.id, 'sticky', noteData, msg.color || ann.color, 1, getUsername(), res.created);
    }).catch(() => {
      if (embedded && typeof _dispatchEmbeddedAnnotationMessage === 'function') {
        _dispatchEmbeddedAnnotationMessage({ type: 'ann-remove-note', annId: annClientId });
      }
    });
  }
});

// Phase C: bdToMd/bdSave等のスタブは廃止 → gb-canvas-engine.js + gb-canvas-features.js に実装済み

function bdOpenBgPalette(event) {
  if (typeof openColorPalette !== 'function') return;
  const swatch = document.getElementById('bd-bg-swatch');
  const canvas = document.getElementById('bd-canvas');
  if (!swatch || !canvas) return;
  openColorPalette(swatch, (typeof bd !== 'undefined' && bd._bgColor) || '', function(v) {
    canvas.style.background = v;
    setColorSwatchValue(swatch, v);
    if (typeof bd !== 'undefined') bd._bgColor = v || '';
    if (typeof bdMarkExtrasDirty === 'function') {
      bdMarkExtrasDirty({ minimap: true, boardUi: true }, 'bg-palette');
      if (typeof bdScheduleBoardUpdates === 'function') bdScheduleBoardUpdates();
    }
  });
}

async function openBoard(label, path, opts) {
  const openOpts = opts || {};
  const showOpenLoading = !openOpts.silent
    && !openOpts.skipGlobalUi
    && typeof showLoading === 'function'
    && typeof hideLoading === 'function';
  const prevView = state.view;
  const prevBoardPath = state.currentBoardPath;
  const currentTitleEl = document.getElementById('current-title');
  const prevTitle = currentTitleEl ? currentTitleEl.textContent : '';
  const restorePreviousView = () => {
    state.currentBoardPath = prevBoardPath || null;
    if (currentTitleEl && !openOpts.skipGlobalUi) currentTitleEl.textContent = prevTitle;
    if (!openOpts.skipShowView && prevView && prevView !== 'board') showView(prevView);
    else if (!openOpts.skipStateView) state.view = prevView || '';
  };
  if (showOpenLoading) showLoading('ボードを読み込み中...');
  try {
    if (!openOpts.skipStateView) state.view = 'board';
    state.currentBoardPath = path;
    if (!openOpts.skipHistoryScope && typeof historySetScope === 'function') historySetScope('');
    if (!openOpts.skipShowView) showView('board');
    if (currentTitleEl && !openOpts.skipGlobalUi) currentTitleEl.textContent = label;
    const opened = typeof bdOpenBoard === 'function' ? await bdOpenBoard(label, path, openOpts) : true;
    if (opened === false) {
      restorePreviousView();
      return false;
    }
    if (!openOpts.skipSaveLastView) saveLastView({type:'board', label, path});
    if (!openOpts.skipNavPush) {
      const _navEntry = {type:'board', label, path};
      navPush(_navEntry);
    }
    if (!openOpts.skipRecent) addRecent(label, path, 'board');
    if (!openOpts.skipHighlight) highlightOutlinerNode(path);
    if (!openOpts.skipAutoVersion) startAutoVersion(path, 'file');
    return true;
  } catch (err) {
    restorePreviousView();
    showStatus('ボード読み込みエラー: ' + (err.message || err), true);
    return false;
  } finally { if (showOpenLoading) hideLoading(); }
}

function openMedia(label, path, type, opts) {
  const openOpts = opts || {};
  if (!openOpts.skipShowView) showView('media');
  else if (!openOpts.skipStateView) state.view = 'media';
  const mediaTitleEl = document.getElementById('media-title');
  if (mediaTitleEl) mediaTitleEl.textContent = label;
  const currentTitleEl = document.getElementById('current-title');
  if (currentTitleEl && !openOpts.skipGlobalUi) currentTitleEl.textContent = label;
  if (!openOpts.skipSaveLastView) saveLastView({type:'media', label, path, mediaType: type});
  if (!openOpts.skipNavPush) {
    const _navEntry = {type:'media', label, path, mediaType: type};
    navPush(_navEntry);
  }
  if (!openOpts.skipRecent) addRecent(label, path, 'media');
  if (!openOpts.skipHighlight) highlightOutlinerNode(path);
  // 詳細パネルにファイル情報を表示
  if (!openOpts.skipGlobalUi && typeof _showFileInfoInDetailPanel === 'function') _showFileInfoInDetailPanel(path);
  // ビューワーペインを更新
  state.currentPagePath = path;
  const container = document.getElementById('media-content');
  const url = API_BASE + '/file-raw?path=' + encodeURIComponent(path);
  if (type === 'image') {
    openViewer('/viewer?file=' + encodeURIComponent(path), openOpts);
    return;
  } else if (type === 'pdf') {
    openViewer('/viewer?pdf=' + encodeURIComponent(path), openOpts);
    return;
  } else if (!container) {
    return;
  } else if (type === 'video') {
    container.innerHTML = '<video src="' + esc(url) + '" controls style="max-width:100%;max-height:80vh;border-radius:4px;">動画を再生できません</video>';
  } else if (type === 'audio') {
    container.innerHTML = '<div style="text-align:center;padding:40px;">' + lucide('audio',48) + '<br><audio src="' + esc(url) + '" controls style="margin-top:16px;width:400px;">音声を再生できません</audio></div>';
  } else {
    container.innerHTML = '<div class="gb-empty-state"><div class="gb-empty-message">このメディア形式は表示できません</div><div class="gb-empty-hint">' + esc(label || path || '') + '</div></div>';
    if (!openOpts.skipGlobalUi) showStatus('このメディア形式は表示できません: ' + (label || type || path), true);
    return;
  }
  if (!openOpts.skipGlobalUi) showStatus(type + ': ' + label);
}

function openCalendarFile(label, path, opts) {
  // カレンダーDBをタイムラインビュー（カレンダーモード）で開く
  const cfg = getDbViewConfig(path);
  const view = typeof _getCurrentDbViewConfigEntryFromConfig === 'function'
    ? _getCurrentDbViewConfigEntryFromConfig(cfg)
    : null;
  if (view) {
    if (typeof _ensureDbViewTypeSpecific === 'function') _ensureDbViewTypeSpecific(view, cfg);
    view.viewMode = 'timeline';
    cfg.currentViewIdx = Math.max(0, cfg.currentViewIdx || 0);
    saveDbViewConfig(path, cfg, { skipHistory: true });
  }
  return selectDatabase(path, null, opts);
}

const _GB_UNTRUSTED_IFRAME_SANDBOX = 'allow-scripts allow-forms allow-popups allow-downloads';
const _GB_EXTERNAL_HTML_IFRAME_SANDBOX = _GB_UNTRUSTED_IFRAME_SANDBOX + ' allow-same-origin';
const _GB_TRUSTED_VIEWER_IFRAME_SANDBOX = _GB_UNTRUSTED_IFRAME_SANDBOX + ' allow-same-origin';

function _gbIsTrustedInternalViewerUrl(rawUrl) {
  const text = String(rawUrl || '').trim();
  if (!text) return false;
  try {
    const parsed = new URL(text, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname.replace(/\/+$/, '') === '/viewer';
  } catch {
    return false;
  }
}

function _gbHtmlIframeSandboxForUrl(rawUrl) {
  const text = String(rawUrl || '').trim();
  if (!text) return _GB_UNTRUSTED_IFRAME_SANDBOX;
  try {
    const parsed = new URL(text, window.location.origin);
    if (_gbIsTrustedInternalViewerUrl(parsed.href)) {
      return _GB_TRUSTED_VIEWER_IFRAME_SANDBOX;
    }
    if (['http:', 'https:'].includes(parsed.protocol) && parsed.origin !== window.location.origin) {
      return _GB_EXTERNAL_HTML_IFRAME_SANDBOX;
    }
  } catch {}
  return _GB_UNTRUSTED_IFRAME_SANDBOX;
}

function _gbPrepareUntrustedIframe(iframe, rawUrl) {
  if (!iframe) return null;
  iframe.setAttribute('sandbox', _gbHtmlIframeSandboxForUrl(rawUrl || iframe.getAttribute('src') || iframe.src || ''));
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  return iframe;
}

function _gbNormalizeHtmlViewerUrl(rawUrl) {
  const text = String(rawUrl || '').trim();
  if (!text) return '';
  try {
    const parsed = new URL(text, window.location.origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function _gbSetHtmlViewerSrc(rawUrl) {
  const url = _gbNormalizeHtmlViewerUrl(rawUrl);
  if (!url) {
    if (typeof showStatus === 'function') showStatus('HTMLビューワーで開けないURLです', true);
    return false;
  }
  const iframe = _gbPrepareUntrustedIframe(document.getElementById('html-iframe'), url);
  if (iframe) iframe.src = url;
  const urlBar = document.getElementById('html-url-bar');
  if (urlBar) urlBar.value = url;
  return true;
}

_gbPrepareUntrustedIframe(document.getElementById('html-iframe'));

function openHtmlFile(label, path, opts) {
  const openOpts = opts || {};
  if (!openOpts.skipShowView) showView('html');
  else if (!openOpts.skipStateView) state.view = 'html';
  state.currentPagePath = path;
  const currentTitleEl = document.getElementById('current-title');
  if (currentTitleEl && !openOpts.skipGlobalUi) currentTitleEl.textContent = label;
  if (!openOpts.skipSaveLastView) saveLastView({type:'html', label, path});
  if (!openOpts.skipNavPush) {
    const _navEntry = {type:'html', label, path};
    navPush(_navEntry);
  }
  if (!openOpts.skipRecent) addRecent(label, path, 'html');
  if (!openOpts.skipHighlight) highlightOutlinerNode(path);
  const url = API_BASE + '/file-raw?path=' + encodeURIComponent(path);
  if (typeof trackIframeLoading === 'function') {
    trackIframeLoading(document.getElementById('html-iframe'), 'HTMLを読み込み中...', openOpts);
  }
  _gbSetHtmlViewerSrc(url);
  if (!openOpts.skipGlobalUi) showStatus('HTML: ' + label);
}
/* LUCIDE, lucide(), fileTypeIcon() は meldex-core.js で定義済み */
function getUsername() {
  try { const cfg = JSON.parse(localStorage.getItem('meldex-user') || '{}'); return cfg.name || 'anonymous'; } catch { return 'anonymous'; }
}

// ビュー切り替え時のアノテーション再読み込みは showView 本体 (720-731行) で処理済み

// replaceIcons() は meldex-core.js で定義済み（DOMContentLoaded内で呼び出し）

const _GB_RESIZABLE_MODAL_SELECTOR = '.modal, .gb-modal, .link-modal, .gb-cal-modal';
const _GB_MODAL_RESIZE_DIRECTIONS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

function _gbClampModalValue(value, min, max) {
  if (max < min) return min;
