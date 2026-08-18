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
// メッセージ先頭行をタイトル、残りを本文として安全なDOMへ変換する。
// 単一行メッセージは従来通り本文だけ、複数行のみ先頭行を強調する。
function _buildCfDialogBodyNodes(message, idBase) {
  const text = String(message ?? '');
  if (!text) return [];
  const lines = text.split('\n');
  const entries = lines.length < 2
    ? [{ text, kind: 'body' }]
    : [
        { text: (lines.shift() || '').trim(), kind: 'title' },
        { text: lines.join('\n').trim(), kind: 'muted' },
      ];
  return entries.filter(entry => entry.text).map((entry, index) => {
    const node = document.createElement('div');
    node.className = 'gb-confirm-message';
    node.id = `${idBase}-message-${index}`;
    node.textContent = entry.text;
    if (entry.kind === 'title') node.style.fontWeight = '600';
    if (entry.kind === 'muted') node.style.color = 'var(--ui-fg-muted)';
    return node;
  });
}

// 短い問いかけ用の .gb-confirm 表示を保ちつつ、生成・閉鎖・フォーカス・
// モバイル変換を GBUI.createModal へ統一する。
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

function _cfIsTopmostDialog(dialog) {
  const managed = window.GBDialogKeyboard?.topmostDialog?.();
  if (managed) return managed === dialog;
  const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')]
    .filter(node => node.isConnected && !node.hidden);
  return !dialogs.length || dialogs[dialogs.length - 1] === dialog;
}

function _configureCfModal(modalApi, kind, label, role, messageNodes, idBase) {
  modalApi.overlay.classList.add('modal-overlay');
  modalApi.overlay.dataset.e2eId = `${kind}-overlay`;
  modalApi.modal.classList.add('gb-confirm');
  modalApi.modal.dataset.e2eId = `${kind}-dialog`;
  modalApi.modal.dataset.dialogType = kind;
  modalApi.modal.id = `${idBase}-dialog`;
  modalApi.modal.setAttribute('role', role);
  modalApi.modal.setAttribute('aria-label', label);
  const closeButton = modalApi.header.querySelector('.gb-modal-close');
  if (closeButton) closeButton.dataset.e2eId = `${kind}-close`;
  if (messageNodes.length) {
    modalApi.modal.setAttribute('aria-describedby', messageNodes.map(node => node.id).join(' '));
  }
  modalApi.footer.classList.add('gb-confirm-actions');
  return modalApi;
}

function _completeCfModalPromise(modalApi, resolve, value) {
  const settle = () => {
    if (modalApi?.overlay?.isConnected) {
      setTimeout(settle, 40);
      return;
    }
    // GBUI.createModal のフォーカス復帰は、モバイル下端シートの閉じるアニメーション後に
    // 同じ40ms周期で実行される。onClose時点で先にPromiseを解決すると、直後に開いた
    // ダイアログから旧ダイアログの復帰処理がフォーカスを奪うため、次タスクまで待つ。
    setTimeout(() => resolve(value), 0);
  };
  settle();
}

// カスタムalertダイアログ（alert()の代替、画面中央モーダル）
function cfAlert(message, options) {
  const opts = options || {};
  const okLabel = opts.okLabel || 'OK';
  const showSupport = opts.support !== false && /HTTP\s+\d{3}|Error|エラー|失敗|例外/.test(String(message || ''));
  if (typeof window.GBUI?.createModal !== 'function') {
    if (typeof window.alert === 'function') window.alert(String(message || ''));
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const restoreFocusTo = _cfRestoreFocusTarget();
    const idBase = `gb-cf-alert-${++_cfDialogSeq}`;
    const messageNodes = _buildCfDialogBodyNodes(message, idBase);
    const supportButton = document.createElement('button');
    supportButton.type = 'button';
    supportButton.id = '_gb-support';
    supportButton.className = 'gb-btn gb-btn-sm';
    supportButton.textContent = 'サポートに送信';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.id = '_gb-ok';
    ok.className = 'gb-btn gb-btn-sm gb-btn-primary';
    ok.textContent = okLabel;
    let modalApi = null;
    const onDocumentKeydown = event => {
      if (event.key !== 'Enter' || !_cfIsTopmostDialog(modalApi?.modal)) return;
      const active = document.activeElement;
      const interactive = active?.closest?.('button, a[href], input, select, textarea, [contenteditable="true"], [role="button"]');
      if (interactive && modalApi.modal.contains(interactive)) return;
      event.preventDefault();
      modalApi.close('submit');
    };
    modalApi = _configureCfModal(window.GBUI.createModal({
      id: idBase,
      titleId: `${idBase}-title`,
      title: 'お知らせ',
      body: messageNodes,
      footer: showSupport ? [supportButton, ok] : [ok],
      variant: 'standard',
      extraClass: 'gb-confirm',
      geometryKey: 'cf-alert',
      initialFocus: () => ok,
      returnFocus: () => restoreFocusTo,
      closeLabel: 'お知らせを閉じる',
      closeOnEsc: true,
      closeOnOverlay: true,
      onClose: () => {
        document.removeEventListener('keydown', onDocumentKeydown);
        _completeCfModalPromise(modalApi, resolve);
      },
    }), 'cf-alert', 'お知らせ', 'alertdialog', messageNodes, idBase);
    ok.addEventListener('click', () => modalApi.close('submit'));
    supportButton.addEventListener('click', () => {
      window.MeldexDiagnostics?.showSupportDialog?.(new Error(String(message || '')), { kind: 'cfAlert' });
    });
    document.addEventListener('keydown', onDocumentKeydown);
    modalApi.open();
  });
}

// カスタムconfirmダイアログ（confirm()の代替、画面中央モーダル）
// options: { danger?: boolean, okLabel?: string, cancelLabel?: string, extraNode?: Node }
// extraNode: メッセージ本文とボタン列の間に挿入する追加DOM要素（呼び出し元が
// textContent等で安全に組み立てたNodeを渡す想定。innerHTML文字列連結はしない。
// ファイル参照整合性計画 Phase 4: 削除確認ダイアログへの被参照警告表示に使う
// （app/gb-delete-impact-warning.js 参照）。
function cfConfirm(message, options) {
  if (typeof window.cfConfirm === 'function' && window.cfConfirm !== cfConfirm) {
    return window.cfConfirm(message, options);
  }
  const opts = options || {};
  const extraNode = opts.extraNode instanceof Node ? opts.extraNode : null;
  const autoDanger = _cfIsDeleteMessage(message);
  const isDanger = opts.danger !== undefined ? !!opts.danger : autoDanger;
  const defaultOk = isDanger ? (autoDanger && /削除/.test(String(message)) ? '削除' : '実行') : '決定';
  const okLabel = opts.okLabel || defaultOk;
  const cancelLabel = opts.cancelLabel || 'キャンセル';
  const okVariant = isDanger ? 'gb-btn-danger' : 'gb-btn-primary';
  if (typeof window.GBUI?.createModal !== 'function') {
    const nativeValue = typeof window.confirm === 'function' ? window.confirm(String(message || '')) : false;
    return Promise.resolve(nativeValue);
  }
  return new Promise(resolve => {
    const restoreFocusTo = _cfRestoreFocusTarget();
    const idBase = `gb-cf-confirm-${++_cfDialogSeq}`;
    const messageNodes = _buildCfDialogBodyNodes(message, idBase);
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.id = '_gb-cancel';
    cancel.className = 'gb-btn gb-btn-sm';
    cancel.textContent = cancelLabel;
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.id = '_gb-ok';
    ok.className = `gb-btn gb-btn-sm ${okVariant}`;
    ok.textContent = okLabel;
    let result = false;
    let modalApi = null;
    const finish = (value, reason) => {
      result = value;
      modalApi.close(reason);
    };
    const onDocumentKeydown = event => {
      // 通常モードは Enter = OK のショートカット。
      // danger モードは誤操作防止のため Enter のショートカットを無効化し、
      // フォーカスされたボタン (初期は cancel) の自然な Enter 起動に任せる。
      if (event.key === 'Enter' && !isDanger && _cfIsTopmostDialog(modalApi?.modal)) {
        const active = document.activeElement;
        const interactive = active?.closest?.('button, a[href], input, select, textarea, [contenteditable="true"], [role="button"]');
        if (interactive && modalApi.modal.contains(interactive)) return;
        event.preventDefault();
        finish(true, 'submit');
      }
    };
    modalApi = _configureCfModal(window.GBUI.createModal({
      id: idBase,
      titleId: `${idBase}-title`,
      title: '確認',
      body: extraNode ? [...messageNodes, extraNode] : messageNodes,
      footer: [cancel, ok],
      variant: 'standard',
      extraClass: 'gb-confirm',
      geometryKey: 'cf-confirm',
      initialFocus: () => isDanger ? cancel : ok,
      returnFocus: () => restoreFocusTo,
      closeLabel: '確認をキャンセル',
      closeOnEsc: true,
      closeOnOverlay: true,
      onClose: () => {
        document.removeEventListener('keydown', onDocumentKeydown);
        _completeCfModalPromise(modalApi, resolve, result);
      },
    }), 'cf-confirm', '確認', 'alertdialog', messageNodes, idBase);
    ok.addEventListener('click', () => finish(true, 'submit'));
    cancel.addEventListener('click', () => finish(false, 'cancel'));
    document.addEventListener('keydown', onDocumentKeydown);
    modalApi.open();
  });
}
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
  // 注意: #sidebar は GBLayout のドッキング対象として #gb-layout-root（#main-views の
  // 子孫）へ組み込まれるため、フォルダツリー（お気に入り・最近使った項目・ワークスペースを
  // 含む #sidebar 全体）は実行時には #main-views の子孫になる。Ctrl+ドロップでパネルに
  // 開くこの機能は「ドロップ先がツリー以外のパネル領域」の場合だけに限定し、ツリー内へ
  // Ctrl+ドロップしても項目が開かないようにする（フォルダツリー改修 Phase 2 §2.5・§9）。
  const _isMainViewsSidebarDrop = (e) => !!e.target?.closest?.('#sidebar');
  if (mv) mv.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('application/x-meldex-node')) {
      // Ctrl+ドラッグ時のみmain-viewsレベルで受け付け（ファイルを開く）
      // 通常時は各ビュー固有のdragoverに委ねる
      if (e.ctrlKey && state.view !== 'board' && !_isMainViewsSidebarDrop(e)) e.preventDefault();
    }
  });
  if (mv) mv.addEventListener('drop', (e) => {
    // Ctrl+ドロップ: ファイルをパネルで開く
    if (!e.ctrlKey) return; // 通常ドロップは各ビュー固有ハンドラに委ねる
    if (state.view === 'board') return;
    if (_isMainViewsSidebarDrop(e)) return; // フォルダツリー（サイドバー）内へのCtrl+ドロップでは開かない
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
  if (msg.type === 'viewer-sheet-context-request' && window.MeldexViewerSheetContext) {
    window.MeldexViewerSheetContext.handleRequest(msg, e.source);
    return;
  }
  if (msg.type === 'viewer-sheet-row-nav-request' && window.MeldexViewerSheetContext) {
    window.MeldexViewerSheetContext.handleRowNavigation(msg, e.source);
    return;
  }
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
  } finally {
    if (showOpenLoading) {
      hideLoading();
      if (typeof hideLoadingMessage === 'function') {
        hideLoadingMessage('ボードを読み込み中...');
      }
    }
  }
}

function openMedia(label, path, type, opts) {
  const openOpts = opts || {};
  // 画像/PDF/動画はビューワー（html-view の #html-iframe）で表示するため、media-view を
  // 経由する showView('media') は行わない（openViewer 側の showView('html') に一本化）。
  // media-view を一瞬マウントすると html-view が退避（DOM移動）され、iframe が強制
  // 再読み込みされて開き直しの高速パスが成立しなくなる（v0.7.139検証で実測）。
  const viewerRouted = (type === 'image' || type === 'pdf' || type === 'video');
  if (!openOpts.skipShowView) { if (!viewerRouted) showView('media'); }
  else if (!openOpts.skipStateView) state.view = 'media';
  const mediaTitleEl = document.getElementById('media-title');
  if (mediaTitleEl) mediaTitleEl.textContent = label;
  const currentTitleEl = document.getElementById('current-title');
  if (currentTitleEl && !openOpts.skipGlobalUi) currentTitleEl.textContent = label;
  if (!openOpts.skipSaveLastView) saveLastView({type:'media', label, path, mediaType: type});
  if (!openOpts.skipNavPush) {
    const _navEntry = {type:'media', label, path, mediaType: type, viewerUrl: openOpts.viewerUrl || ''};
    navPush(_navEntry);
  }
  if (!openOpts.skipRecent) addRecent(label, path, 'media');
  if (!openOpts.skipHighlight) highlightOutlinerNode(path);
  // 詳細パネルにファイル情報を表示
  if (!openOpts.skipGlobalUi && typeof _showFileInfoInDetailPanel === 'function') _showFileInfoInDetailPanel(path);
  // ビューワーペインを更新
  state.currentPagePath = path;
  const container = document.getElementById('media-content');
  const url = openOpts.rawUrl || (API_BASE + '/file-raw?path=' + encodeURIComponent(path));
  if (type === 'image') {
    openViewer(openOpts.viewerUrl || openOpts.rawUrl || ('/viewer?file=' + encodeURIComponent(path)), openOpts);
    return;
  } else if (type === 'pdf') {
    openViewer('/viewer?pdf=' + encodeURIComponent(path), openOpts);
    return;
  } else if (type === 'video') {
    // 動画も画像・PDFと同じくビューワー（viewer.html／#html-iframe）側へ統一する。
    // ビューワー側の動画対応は並行して実装中で、ここではルーティングのみ行う
    // （旧・#media-content への直接注入は廃止。共有コンテナのタブ間混入対策も
    // ビューワー経由に一本化することで簡素化される）。
    openViewer(openOpts.viewerUrl || openOpts.rawUrl || ('/viewer?file=' + encodeURIComponent(path)), openOpts);
    return;
  } else if (!container) {
    return;
