/* gb-tray-annotation-bar.js: 常駐アプリが出すデスクトップのアノテートバー
 *
 * 常駐アプリのメニューから開く最前面の小さなバー（gb-window.py の専用ウィンドウ）。
 * 本体のページを ?tray_annotation_bar=1 で読み、本体の画面は出さずにこのバーだけを表示する。
 * - アノテート先: フォルダツリー（GBFolderPicker）から Meldex のファイル、またはシートのトピックを選ぶ
 * - スクリーンショット（全画面・範囲選択・ウィンドウ選択）: 画像はこれまでどおりホームの
 *   「スクリーンショット」へ保存し、アノテート先へ種類「スクリーンショット」のアノテートを記録する
 * - コメント: アノテート先へコメントのアノテートを記録する
 * 保存はすべて本体の通常のAPI（書き込み可否・編集ロックの確認を通る）で行い、失敗はバー内に示す。
 * ウィンドウの移動・一時的な拡大・撮影はウィンドウ側（window.pywebview.api.tray_annotation_bar_*）が担う。
 */
(function () {
  'use strict';

  if (window.MeldexTrayAnnotationBar) return;

  const QUERY_FLAG = 'tray_annotation_bar';
  // gb-window.py / meldex_desktop_annotation_bar.py の PICKER_WIDTH / PICKER_HEIGHT と同じ値
  const PICKER_SIZE = { width: 680, height: 640 };
  const MODES = [
    { mode: 'full', icon: 'monitor', label: '全画面を撮影してアノテート先に記録' },
    { mode: 'region', icon: 'scissors', label: '範囲を選んで撮影してアノテート先に記録' },
    { mode: 'window', icon: 'appWindow', label: 'ウィンドウを選んで撮影してアノテート先に記録' },
  ];

  const state = {
    target: null,
    busy: false,
    pendingRecord: null,
    shell: null,
    targetButton: null,
    targetLabel: null,
    targetIcon: null,
    commentInput: null,
    status: null,
    retryButton: null,
  };

  function isHost() {
    try {
      return new URLSearchParams(window.location.search || '').get(QUERY_FLAG) === '1';
    } catch (_) {
      return false;
    }
  }

  function _icon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 16) : '';
  }

  function _bridge(name) {
    const api = window.pywebview && window.pywebview.api;
    const fn = api && api[name];
    return typeof fn === 'function' ? fn.bind(api) : null;
  }

  // pywebview の窓口は読み込み後に届く。届くまで少し待ち、無ければ null を返す（ブラウザでの確認用）。
  function _waitForBridge(timeoutMs) {
    if (window.pywebview && window.pywebview.api) return Promise.resolve(true);
    return new Promise(resolve => {
      const done = ok => { window.removeEventListener('pywebviewready', onReady); clearTimeout(timer); resolve(ok); };
      const onReady = () => done(true);
      const timer = setTimeout(() => done(false), timeoutMs);
      window.addEventListener('pywebviewready', onReady);
    });
  }

  async function _call(name, ...args) {
    const fn = _bridge(name);
    if (!fn) return null;
    try {
      return await fn(...args);
    } catch (error) {
      _setStatus(`バーの操作に失敗しました: ${error?.message || error}`, true);
      return null;
    }
  }

  function _setStatus(text, isError, options) {
    if (!state.status) return;
    state.status.textContent = String(text || '');
    state.status.dataset.statusKind = text ? (isError ? 'error' : 'success') : '';
    state.status.setAttribute('role', isError ? 'alert' : 'status');
    if (state.retryButton) state.retryButton.hidden = !(options && options.retry);
  }

  function _setBusy(busy) {
    state.busy = !!busy;
    state.shell?.querySelectorAll('button[data-tray-bar-action]').forEach(button => {
      if (button.dataset.trayBarAction !== 'close') button.disabled = state.busy;
    });
    if (state.commentInput) state.commentInput.disabled = state.busy;
  }

  // 保存形（meldex_desktop_annotation_bar.normalize_target と同じ項目）
  function normalizeTarget(selection) {
    if (!selection || !selection.path) return null;
    const target = {
      path: String(selection.path).replace(/\\/g, '/'),
      name: String(selection.sheetName || selection.name || '').trim(),
      kind: selection.kind === 'topic' ? 'topic' : (selection.kind || 'file'),
      type: String(selection.kind === 'topic' ? 'database' : (selection.type || '')),
      rootPath: String(selection.rootPath || ''),
      rootName: String(selection.rootName || ''),
      rootKind: String(selection.rootKind || ''),
    };
    if (target.kind === 'topic') {
      target.topicName = String(selection.topicName || '').trim();
      target.topicId = String(selection.topicId || target.topicName);
      if (!target.topicName) return null;
    }
    return target;
  }

  function targetLabel(target) {
    if (!target) return 'アノテート先を選択';
    if (target.kind === 'topic') return target.topicName;
    return target.name || String(target.path).split('/').pop() || target.path;
  }

  function targetDescription(target) {
    if (!target) return 'アノテート先が未選択です。押すとフォルダツリーから選べます';
    const where = target.kind === 'topic' ? `${target.name || target.path} のトピック「${target.topicName}」` : target.path;
    return `アノテート先: ${where}（押すと変更）`;
  }

  // アノテートの記録先。シートのトピックはトピック全体（sheet_entry）として記録する。
  // entryId はシートのセルのコメント（sheet_cell）と同じくトピック名を使う。
  function targetFields(target) {
    if (target.kind === 'topic') {
      return {
        target_path: target.path,
        target_kind: 'sheet_entry',
        target_ref: { file: target.path, entryId: target.topicName, topicId: target.topicId || target.topicName },
        target_snapshot: target.topicName,
      };
    }
    return { target_path: target.path, target_kind: '' };
  }

  function _requestId(prefix) {
    const rand = (window.crypto && typeof window.crypto.randomUUID === 'function')
      ? window.crypto.randomUUID()
      : String(Date.now()) + Math.random().toString(16).slice(2);
    return `${prefix}-${rand}`;
  }

  function screenshotRecord(target, savedPath, shot) {
    const requestId = _requestId('desktop-bar-shot');
    return {
      type: 'screenshot',
      ...targetFields(target),
      client_request_id: requestId,
      data: {
        path: savedPath,
        mode: shot.mode || '',
        width: shot.width,
        height: shot.height,
        origin: 'desktop-annotation-bar',
        clientRequestId: requestId,
      },
    };
  }

  function commentRecord(target, text) {
    const requestId = _requestId('desktop-bar-comment');
    return {
      type: 'comment',
      ...targetFields(target),
      body: text,
      client_request_id: requestId,
      data: { type: 'comment', text, origin: 'desktop-annotation-bar', clientRequestId: requestId },
    };
  }

  function _renderTarget() {
    const target = state.target;
    if (!state.targetButton) return;
    state.targetLabel.textContent = targetLabel(target);
    const description = targetDescription(target);
    state.targetButton.title = description;
    state.targetButton.setAttribute('aria-label', description);
    state.targetButton.dataset.targetKind = target ? target.kind : '';
    const shared = window.MeldexFileIcons?.itemIconHtml;
    state.targetIcon.innerHTML = !target
      ? _icon('folderOpen', 16)
      : (target.kind === 'topic'
        ? _icon('fileText', 16)
        : (typeof shared === 'function' ? shared({ path: target.path, type: target.type || '' }, 16) : _icon('file', 16)));
  }

  async function setTarget(target, options) {
    state.target = target || null;
    _renderTarget();
    if (options && options.persist === false) return true;
    const saved = await _call('tray_annotation_bar_set_target', state.target);
    if (saved && saved.ok === false) {
      _setStatus(saved.error || 'アノテート先を保存できませんでした', true);
      return false;
    }
    return true;
  }

  async function pickTarget() {
    if (!window.GBFolderPicker?.pickFolder) {
      _setStatus('フォルダツリーを読み込めませんでした', true);
      return null;
    }
    const current = state.target;
    document.body.dataset.trayAnnotationBarPicking = '1';
    await _call('tray_annotation_bar_resize', PICKER_SIZE.width, PICKER_SIZE.height);
    let selection = null;
    try {
      selection = await window.GBFolderPicker.pickFolder({
        title: 'アノテート先を選択',
        selectFiles: true,
        selectSheetTopics: true,
        selectFolders: false,
        includeHome: true,
        includeSources: true,
        includeWorkspaces: true,
        initialPath: current?.path || '',
        initialTopic: current?.kind === 'topic' ? current.topicName : '',
        revealPath: current?.path || '',
      });
    } catch (error) {
      _setStatus(`アノテート先を選べませんでした: ${error?.message || error}`, true);
    } finally {
      delete document.body.dataset.trayAnnotationBarPicking;
      await _call('tray_annotation_bar_restore_size');
    }
    const target = normalizeTarget(selection);
    if (!target) return null;
    await setTarget(target);
    _setStatus('');
    return target;
  }

  async function _ensureTarget() {
    if (state.target) return state.target;
    return pickTarget();
  }

  async function _record(payload, successText) {
    _setStatus('保存中...');
    try {
      const result = await apiPost('/annotations', payload);
      state.pendingRecord = null;
      _setStatus(successText);
      return result;
    } catch (error) {
      state.pendingRecord = { payload, successText };
      _setStatus(`アノテート先に記録できませんでした: ${error?.message || error}`, true, { retry: true });
      return null;
    }
  }

  async function retryPending() {
    const pending = state.pendingRecord;
    if (!pending || state.busy) return null;
    _setBusy(true);
    try {
      // 同じ client_request_id で送り直すので、前回届いていても二重に記録されない
      return await _record(pending.payload, pending.successText);
    } finally {
      _setBusy(false);
    }
  }

  async function capture(mode) {
    if (state.busy) return null;
    const target = await _ensureTarget();
    if (!target) return null;
    _setBusy(true);
    try {
      _setStatus('');
      const shot = await _call('tray_annotation_bar_capture', mode);
      if (!shot) {
        _setStatus('この画面では撮影できません。常駐アプリのメニューからアノテートバーを開いてください', true);
        return null;
      }
      if (shot.ok !== true) {
        if (!shot.cancelled) _setStatus(shot.error || 'スクリーンショットを撮影できませんでした', true);
        return null;
      }
      _setStatus('保存中...');
      let saved;
      try {
        // 画像の保存は常駐アプリの撮影と同じ経路（ホームの「スクリーンショット」へ保存）
        saved = await apiPost('/annotation/screenshot', {
          data: shot.data, mode: shot.mode || mode, width: shot.width, height: shot.height,
        });
      } catch (error) {
        _setStatus(`スクリーンショットを保存できませんでした: ${error?.message || error}`, true);
        return null;
      }
      if (!saved?.path) {
        _setStatus('スクリーンショットを保存できませんでした', true);
        return null;
      }
      const label = target.kind === 'topic' ? `「${target.topicName}」` : `「${targetLabel(target)}」`;
      return await _record(screenshotRecord(target, saved.path, shot), `${label}にスクリーンショットを記録しました`);
    } finally {
      _setBusy(false);
    }
  }

  async function addComment(text) {
    const body = String(text ?? state.commentInput?.value ?? '').trim();
    if (!body || state.busy) return null;
    const target = await _ensureTarget();
    if (!target) return null;
    _setBusy(true);
    try {
      const label = target.kind === 'topic' ? `「${target.topicName}」` : `「${targetLabel(target)}」`;
      const result = await _record(commentRecord(target, body), `${label}にコメントを記録しました`);
      // 失敗時は入力内容を残し、再試行または書き直しできるようにする
      if (result && state.commentInput) state.commentInput.value = '';
      return result;
    } finally {
      _setBusy(false);
      state.commentInput?.focus();
    }
  }

  function _button(action, icon, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gb-btn gb-btn-sm gb-btn-quiet tray-annotation-bar-icon-btn';
    button.dataset.trayBarAction = action;
    button.dataset.e2eId = `tray-annotation-bar-${action}`;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = _icon(icon, 16);
    return button;
  }

  function _bindDrag(handle) {
    let dragging = false;
    let frame = 0;
    const move = () => {
      frame = 0;
      if (dragging) _call('tray_annotation_bar_drag_move');
    };
    const end = () => {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      _call('tray_annotation_bar_drag_end');
    };
    const onMove = event => {
      if (!dragging) return;
      event.preventDefault();
      if (!frame) frame = requestAnimationFrame(move);
    };
    handle.addEventListener('pointerdown', async event => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragging = true;
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', end);
      document.addEventListener('pointercancel', end);
      const started = await _call('tray_annotation_bar_drag_start');
      if (!started) end();
    });
  }

  const _STYLE = `
    body[data-tray-annotation-bar="1"] { margin: 0; overflow: hidden; background: var(--bg); }
    .tray-annotation-bar { position: fixed; inset: 0; z-index: 1; display: flex; flex-direction: column;
      gap: var(--ui-space-1); padding: var(--ui-space-2) var(--ui-space-3); background: var(--bg); color: var(--fg);
      box-sizing: border-box; font-size: var(--ui-font-12); }
    .tray-annotation-bar-row { display: flex; align-items: center; gap: var(--ui-space-2); min-width: 0; }
    .tray-annotation-bar-drag { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;
      width: var(--ui-h-xs); height: var(--ui-h-sm); color: var(--fg2); cursor: grab; touch-action: none; }
    .tray-annotation-bar-target { display: inline-flex; align-items: center; gap: var(--ui-space-2); flex: 0 1 auto;
      min-width: 0; max-width: 40%; }
    .tray-annotation-bar-target-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tray-annotation-bar-target[data-target-kind=""] .tray-annotation-bar-target-label { color: var(--fg2); }
    .tray-annotation-bar-sep { flex: 0 0 auto; width: 1px; height: var(--ui-h-xs); background: var(--border); }
    .tray-annotation-bar-comment { flex: 1 1 auto; min-width: 0; height: var(--ui-h-sm); }
    .tray-annotation-bar-status-row { min-height: var(--ui-h-2xs); }
    .tray-annotation-bar-status { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; color: var(--fg2); font-size: var(--ui-font-11); }
    .tray-annotation-bar-status[data-status-kind="error"] { color: var(--red); }
    body[data-tray-annotation-bar-picking="1"] .tray-annotation-bar { visibility: hidden; }
  `;

  function _isolate(shell) {
    const keep = node => node === shell
      || ['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE'].includes(node.tagName)
      || node.matches?.('.gb-modal-overlay,.modal-overlay,.gb-context-menu,[role="tooltip"],.gb-tooltip,[data-gb-folder-picker]');
    const hide = node => {
      if (!(node instanceof HTMLElement) || keep(node)) return;
      node.setAttribute('aria-hidden', 'true');
      node.inert = true;
      node.style.setProperty('display', 'none', 'important');
    };
    [...document.body.children].forEach(hide);
    new MutationObserver(mutations => mutations.forEach(mutation => mutation.addedNodes.forEach(node => {
      if (node.parentElement === document.body) hide(node);
    }))).observe(document.body, { childList: true });
  }

  function build() {
    if (state.shell) return state.shell;
    document.body.dataset.trayAnnotationBar = '1';
    const style = document.createElement('style');
    style.dataset.trayAnnotationBarStyle = '1';
    style.textContent = _STYLE;
    document.head.appendChild(style);

    const shell = document.createElement('main');
    shell.className = 'tray-annotation-bar';
    shell.dataset.e2eId = 'tray-annotation-bar';
    shell.setAttribute('aria-label', 'デスクトップのアノテートバー');

    const row = document.createElement('div');
    row.className = 'tray-annotation-bar-row';
    row.setAttribute('role', 'toolbar');
    row.setAttribute('aria-label', 'アノテートバーの操作');

    const drag = document.createElement('span');
    drag.className = 'tray-annotation-bar-drag';
    drag.dataset.e2eId = 'tray-annotation-bar-drag';
    drag.title = 'ドラッグして移動';
    drag.setAttribute('aria-hidden', 'true');
    drag.innerHTML = _icon('gripVertical', 16);
    _bindDrag(drag);
    row.appendChild(drag);

    const targetButton = document.createElement('button');
    targetButton.type = 'button';
    targetButton.className = 'gb-btn gb-btn-sm tray-annotation-bar-target';
    targetButton.dataset.trayBarAction = 'target';
    targetButton.dataset.e2eId = 'tray-annotation-bar-target';
    const targetIcon = document.createElement('span');
    targetIcon.setAttribute('aria-hidden', 'true');
    const targetText = document.createElement('span');
    targetText.className = 'tray-annotation-bar-target-label';
    targetButton.append(targetIcon, targetText);
    targetButton.addEventListener('click', () => { if (!state.busy) pickTarget(); });
    row.appendChild(targetButton);

    const sep = () => { const el = document.createElement('span'); el.className = 'tray-annotation-bar-sep'; return el; };
    row.appendChild(sep());
    MODES.forEach(item => {
      const button = _button(`capture-${item.mode}`, item.icon, item.label);
      button.addEventListener('click', () => capture(item.mode));
      row.appendChild(button);
    });
    row.appendChild(sep());

    const comment = document.createElement('input');
    comment.type = 'text';
    comment.className = 'gb-input tray-annotation-bar-comment';
    comment.dataset.e2eId = 'tray-annotation-bar-comment';
    comment.placeholder = 'コメント';
    comment.maxLength = 2000;
    comment.setAttribute('aria-label', 'アノテート先へのコメント（Enterで記録）');
    comment.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      addComment();
    });
    row.appendChild(comment);
    const send = _button('comment', 'send', 'コメントをアノテート先に記録');
    send.addEventListener('click', () => addComment());
    row.appendChild(send);
    const close = _button('close', 'x', 'アノテートバーを閉じる');
    close.addEventListener('click', () => _call('tray_annotation_bar_close'));
    row.appendChild(close);
    shell.appendChild(row);

    const statusRow = document.createElement('div');
    statusRow.className = 'tray-annotation-bar-row tray-annotation-bar-status-row';
    const status = document.createElement('div');
    status.className = 'tray-annotation-bar-status';
    status.dataset.e2eId = 'tray-annotation-bar-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'gb-btn gb-btn-sm';
    retry.dataset.trayBarAction = 'retry';
    retry.dataset.e2eId = 'tray-annotation-bar-retry';
    retry.textContent = '再試行';
    retry.hidden = true;
    retry.addEventListener('click', () => retryPending());
    statusRow.append(status, retry);
    shell.appendChild(statusRow);

    document.body.appendChild(shell);
    Object.assign(state, {
      shell, targetButton, targetLabel: targetText, targetIcon, commentInput: comment, status, retryButton: retry,
    });
    _isolate(shell);
    if (typeof replaceIcons === 'function') replaceIcons(shell);
    _renderTarget();
    comment.addEventListener('keydown', event => {
      if (event.key === 'Escape' && comment.value) { event.preventDefault(); comment.value = ''; }
    });
    return shell;
  }

  async function init() {
    if (!isHost()) return false;
    build();
    await _waitForBridge(3000);
    const saved = await _call('tray_annotation_bar_state');
    const target = normalizeTarget(saved?.target ? { ...saved.target, sheetName: saved.target.name } : null);
    if (target && !state.target) await setTarget(target, { persist: false });
    return true;
  }

  window.MeldexTrayAnnotationBar = {
    isHost,
    init,
    build,
    pickTarget,
    setTarget,
    capture,
    addComment,
    retryPending,
    normalizeTarget,
    targetFields,
    screenshotRecord,
    commentRecord,
    getTarget: () => state.target,
  };

  if (isHost()) {
    if (document.body) init();
    else document.addEventListener('DOMContentLoaded', () => init(), { once: true });
  }
})();
