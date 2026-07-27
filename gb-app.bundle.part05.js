    }

    // v5.0 ペインシステムがタブを復元している場合は welcome にフォールバックしない。
    // lastView ベースの復元が hit しなくても、ペイン配置が残っていれば画面は埋まっている。
    if (!restored) {
      const _paneHasTabs = _paneLayoutHasAnyTabs();
      if (!_paneHasTabs) showView('welcome');
    }

    // 起動後の重い補助処理は背景で継続し、表示を先に返す。
    _scheduleStartupDatabaseViewTabsRepair();
    _hideStartupSplash();
    if (typeof _logPerfEvent === 'function') {
      _logPerfEvent('startup.visible', initStartedAt, { restored });
    }
    _runStartupBackground('file-id-migration-finalize', rawMigrationPromise.then(() => _migratePathsToFileIds()), () => {
      if (state.currentDbPath && typeof _refreshDbViewConfigAfterHistory === 'function') {
        _refreshDbViewConfigAfterHistory(state.currentDbPath);
      }
    });
    _runStartupBackground('post-init-ready', Promise.allSettled([migrationPromise, outlinerPromise, linkDictPromise]), () => {
      initGlobalFilterBar();
      _runStartupBackground('outliner-startup-refresh', _refreshOutlinerAfterStartupReady(), () => {
        _highlightLastOutlinerNodeAfterStartup();
        showStatus('準備完了');
      });
    });
  } catch (e) {
    showStatus('ソースフォルダ情報の取得に失敗しました', true);
  }
  _hideStartupSplash();
}
/* ==============================
   表示切替
   ============================== */
function showView(viewName, ctx) {
  const resolvedViewName = ['calendar', 'tasks', 'shifts'].includes(viewName) ? 'timeline' : viewName;
  const isDbViewName = (name) => ['pivot', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form', 'smart-db', 'calendar', 'tasks', 'shifts'].includes(name);
  // スプリットペイン内のビュー切替（ctxにcontainerElがある場合）
  if (ctx && ctx.containerEl) {
    const isDbView = isDbViewName(viewName);
    const c = ctx.containerEl;
    const hasPaneViewSurfaces = !!c.querySelector('#pivot-view, #gallery-view, #kanban-view, #timeline-view, #chart-view, #graph-view, #form-view, #smart-db-view, .pivot-view, .gallery-view, .kanban-view, .timeline-view, .chart-view, .graph-view, .form-view, .smart-db-view');
    if (hasPaneViewSurfaces) {
      const _sv = (sel, show) => { const el = c.querySelector(sel); if (el) el.style.display = show; };
      _sv('#db-view-container, .db-view-container', isDbView ? 'flex' : 'none');
      _sv('#pivot-view, .pivot-view', resolvedViewName === 'pivot' ? '' : 'none');
      _sv('#gallery-view, .gallery-view', resolvedViewName === 'gallery' ? 'flex' : 'none');
      _sv('#kanban-view, .kanban-view', resolvedViewName === 'kanban' ? 'flex' : 'none');
      _sv('#timeline-view, .timeline-view', resolvedViewName === 'timeline' ? '' : 'none');
      _sv('#chart-view, .chart-view', resolvedViewName === 'chart' ? 'flex' : 'none');
      _sv('#graph-view, .graph-view', resolvedViewName === 'graph' ? 'flex' : 'none');
      _sv('#form-view, .form-view', resolvedViewName === 'form' ? 'flex' : 'none');
      _sv('#smart-db-view, .smart-db-view', resolvedViewName === 'smart-db' ? '' : 'none');
      ctx.viewMode = viewName;
      return;
    }
  }
  // ビュー切替前にボードの未保存を即時保存
  if (state.view === 'board' && viewName !== 'board' && typeof bd !== 'undefined' && bd.dirty && bd.path) {
    if (typeof bdSave === 'function') bdSave();
  }
  // ボードから離れたらノートタブを非表示
  if (state.view === 'board' && viewName !== 'board' && typeof hideBoardNoteTab === 'function') {
    hideBoardNoteTab();
  }
  // フォルダ以外のビューに切り替わったら一括処理バーを非表示
  if (viewName !== 'folder') {
    const fvBar = document.getElementById('fv-bulk-bar');
    if (fvBar) { fvBar.classList.remove('visible'); fvBar.hidden = true; fvBar.setAttribute('aria-hidden', 'true'); }
  }
  if (state.view === 'board' && viewName !== 'board' && typeof clearBoardDetailTabs === 'function') {
    clearBoardDetailTabs();
  }
  // viewName: 'welcome' | 'pivot' | 'gallery' | 'kanban' | 'entity' | 'page' | 'board'
  const isDbView = isDbViewName(viewName);
  const _setDisplay = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.style.display = value;
  };
  _setDisplay('login-view', 'none');
  _setDisplay('welcome-view', resolvedViewName === 'welcome' ? 'flex' : 'none');
  _setDisplay('db-view-container', isDbView ? 'flex' : 'none');
  _setDisplay('pivot-view', resolvedViewName === 'pivot' ? '' : 'none');
  _setDisplay('gallery-view', resolvedViewName === 'gallery' ? 'flex' : 'none');
  _setDisplay('kanban-view', resolvedViewName === 'kanban' ? 'flex' : 'none');
  _setDisplay('timeline-view', resolvedViewName === 'timeline' ? '' : 'none');
  _setDisplay('chart-view', resolvedViewName === 'chart' ? 'flex' : 'none');
  _setDisplay('graph-view', resolvedViewName === 'graph' ? 'flex' : 'none');
  _setDisplay('form-view', resolvedViewName === 'form' ? 'flex' : 'none');
  _setDisplay('smart-db-view', resolvedViewName === 'smart-db' ? 'flex' : 'none');
  _setDisplay('compare-view', resolvedViewName === 'compare' ? 'flex' : 'none');
  _setDisplay('entity-view', resolvedViewName === 'entity' ? 'flex' : 'none');
  _setDisplay('page-view', resolvedViewName === 'page' ? 'flex' : 'none');
  _setDisplay('media-view', resolvedViewName === 'media' ? 'flex' : 'none');
  _setDisplay('html-view', resolvedViewName === 'html' ? 'flex' : 'none');
  _setDisplay('csv-view', resolvedViewName === 'csv' ? 'flex' : 'none');
  _setDisplay('folder-view', resolvedViewName === 'folder' ? 'flex' : 'none');
  // app-toolbarの表示切替
  const appTb = document.getElementById('app-toolbar');
  _setDisplay('tb-db', isDbView ? 'contents' : 'none');
  // ページビュー: app-toolbarにリッチテキストツールバー表示
  const showRtInAppbar = (resolvedViewName === 'page');
  _setDisplay('rt-toolbar', showRtInAppbar ? '' : 'none');
  const hasAppTb = isDbView || showRtInAppbar;
  if (appTb) appTb.classList.toggle('visible', hasAppTb);
  // エントリビュー: エントリ内ツールバー
  const entityRt = document.getElementById('entity-rt-toolbar');
  if (entityRt) entityRt.style.display = (resolvedViewName === 'entity') ? 'flex' : 'none';
  // ステータスバーのショートカットヘルプ
  const sc = document.getElementById('sb-shortcuts');
  if (isDbView) {
    const csvSheetActive = typeof isCsvSheetModeActive === 'function' && isCsvSheetModeActive();
    if (csvSheetActive && typeof updateCsvShortcutStatusbar === 'function') updateCsvShortcutStatusbar(sc);
    else if (typeof updateDatabaseShortcutStatusbar === 'function') updateDatabaseShortcutStatusbar(sc);
    else sc.textContent = '';
  } else if (resolvedViewName === 'entity' || resolvedViewName === 'page') {
    sc.textContent = 'Ctrl+B 太字 | Ctrl+I 斜体 | Ctrl+U 下線 | Ctrl+Shift+1~6 見出し | Ctrl+Shift+8 箇条書き | Tab インデント | Ctrl+Shift+↑↓ 移動';
  } else if (resolvedViewName === 'scriptnote') {
    if (typeof updateScriptnoteShortcutStatusbar === 'function') updateScriptnoteShortcutStatusbar(sc);
    else sc.textContent = 'Enter 行追加 | Ctrl+Enter 同タイプ行追加 | Shift+Del 行削除 | Tab タイプ選択 | Ctrl+↑↓ 行移動 | Ctrl+R ルビ | Ctrl+Z Undo | Ctrl+Y Redo';
  } else {
    sc.textContent = '';
  }

  state.view = viewName;

  // メモ: ビュー切替時にターゲット更新＋再読み込み＋スクロール同期
  if (typeof ann !== 'undefined') {
    const newTarget = typeof getAnnotationTarget === 'function' ? getAnnotationTarget() : '';
    if (newTarget !== ann.targetPath) {
      ann.targetPath = newTarget;
      // 埋め込みサーフェス (board/html) の場合は iframe/bridge 側でロードされるため、
      // スタンドアロン側の loadAnnotations を呼ぶと同じ注釈が二重に描画される
      const embedded = typeof _usesEmbeddedAnnotationSurface === 'function'
        && _usesEmbeddedAnnotationSurface(viewName);
      if (embedded) {
        // 旧ビューからの残留（スタンドアロン overlay の描画＋付箋）をクリア
        const layer = document.getElementById('ann-layer');
        if (layer) layer.innerHTML = '';
        if (typeof _forEachStandaloneAnnotationNote === 'function') {
          _forEachStandaloneAnnotationNote(el => el.remove());
        }
      } else if (typeof loadAnnotations === 'function') {
        loadAnnotations();
      }
    }
    if (typeof _setupOverlayScroll === 'function') _setupOverlayScroll(viewName);
  }
}
// スクリーンショットメニュー
function showScreenshotMenu(e) {
  const btn = e?.target?.closest?.('button') || e?.target;
  const existing = document.querySelector('.ab-dropdown.ss-menu');
  if (existing) {
    existing.remove();
    btn?.setAttribute?.('aria-expanded', 'false');
    return;
  }
  const menu = document.createElement('div');
  menu.className = 'ab-dropdown ss-menu';
  menu.id = 'screenshot-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'スクリーンショット');
  if (btn?.setAttribute) {
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-controls', menu.id);
  }
  let closed = false;
  let pointerCloser = null;
  let keyCloser = null;
  const closeMenu = (restoreFocus = false) => {
    if (closed) return;
    closed = true;
    if (pointerCloser) document.removeEventListener('pointerdown', pointerCloser, true);
    if (keyCloser) document.removeEventListener('keydown', keyCloser, true);
    if (btn?.setAttribute) btn.setAttribute('aria-expanded', 'false');
    menu.remove();
    if (restoreFocus) btn?.focus?.();
  };
  function addItem(label, fn, mode) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'ab-dropdown-item';
    item.setAttribute('role', 'menuitem');
    if (mode) item.dataset.screenshotMode = mode;
    item.textContent = label;
    item.addEventListener('click', () => { closeMenu(false); fn(); });
    menu.appendChild(item);
  }
  function addSep() {
    const s = document.createElement('div');
    s.className = 'ab-dropdown-sep';
    s.setAttribute('role', 'separator');
    menu.appendChild(s);
  }
  addItem('全画面キャプチャ', () => captureScreenshot('full'), 'full');
  addItem('範囲選択キャプチャ', () => captureScreenshot('region'), 'region');
  addSep();
  addItem('全画面（GB非表示）', () => captureScreenshot('full-hide'), 'full-hide');
  addItem('範囲選択（GB非表示）', () => captureScreenshot('region-hide'), 'region-hide');
  addSep();
  addItem('トレイアプリから操作', () => showStatus('Ctrl+Shift+S (全画面) / Ctrl+Shift+R (範囲) / Ctrl+Shift+W (ウィンドウ)'));
  document.body.appendChild(menu);
  const placeMenu = () => {
    if (!btn?.getBoundingClientRect) return;
    const rect = btn.getBoundingClientRect();
    if (typeof positionPopup === 'function') {
      positionPopup(menu, rect, { prefer: 'right', gap: 4 });
      return;
    }
    const z = _getZoom();
    menu.style.left = (rect.right / z + 4) + 'px';
    menu.style.top = (rect.top / z) + 'px';
    requestAnimationFrame(() => {
      const mr = menu.getBoundingClientRect();
      if (mr.bottom > window.innerHeight) menu.style.top = ((window.innerHeight - mr.height - 4) / z) + 'px';
      if (mr.right > window.innerWidth) menu.style.left = ((rect.left - mr.width - 4) / z) + 'px';
    });
  };
  placeMenu();
  menu.addEventListener('keydown', (ev) => {
    const items = [...menu.querySelectorAll('.ab-dropdown-item')];
    const index = items.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const delta = ev.key === 'ArrowDown' ? 1 : -1;
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
