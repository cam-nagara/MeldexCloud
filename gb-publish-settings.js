/* 公開 HTML 設定 */

function getCurrentPublishContext() {
  if (state.currentDbPath && (state?.view === 'pivot' || ['tree', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form'].includes(getCurrentViewMode(state.currentDbPath)))) {
    return { kind: 'database', label: state.currentDbPath.split('/').pop() || 'シート', path: state.currentDbPath };
  }
  if (state?.view === 'entity' && state.currentEntityPath) {
    return { kind: 'entity', label: state.currentEntityPath.split('/').pop()?.replace(/\.md$/, '') || 'エントリ', path: state.currentEntityPath };
  }
  // 単一パネル対応種別 (page / csv / calendar)
  if (state?.view === 'page') {
    const pc = document.getElementById('page-content');
    const p = pc?.dataset?.path || '';
    if (p) return { kind: 'page', label: p.split('/').pop()?.replace(/\.md$/, '') || 'ノート', path: p };
  }
  if (state?.view === 'csv') {
    const p = (typeof _csvPath !== 'undefined' && _csvPath) ? _csvPath : '';
    if (p) return { kind: 'csv', label: p.split('/').pop() || 'CSV', path: p };
  }
  if (state?.view === 'calendar') {
    const p = state.currentDbPath || '';
    if (p) return { kind: 'calendar', label: p.split('/').pop() || 'カレンダー', path: p };
  }
  // ボード / シナリオはタブ単位で複数開けるため、アクティブタブから対象を判定する
  const tab = (typeof GBTabs !== 'undefined' && typeof GBTabs.getActiveTab === 'function') ? GBTabs.getActiveTab() : null;
  if (tab?.type === 'board' && tab.path) {
    return {
      kind: 'board',
      label: tab.label || tab.path.split('/').pop()?.replace(/\.[^.]+$/, '') || 'ボード',
      path: tab.path,
      paneId: (typeof GBLayout !== 'undefined' && GBLayout.activePane) ? String(GBLayout.activePane) : '',
      tabId: String(tab.id || ''),
      viewId: String((typeof bd !== 'undefined' && bd?.activeBoardViewId) || ''),
    };
  }
  if (tab?.type === 'scriptnote' && tab.path) {
    return { kind: 'scriptnote', label: 'シナリオ', path: tab.path };
  }
  return { kind: '', label: '未選択', path: '' };
}

function _publishContextError(message) {
  if (typeof showStatus === 'function') showStatus(message, true);
  return null;
}

function _publishOptionPathForContext(kind, path) {
  if (kind === 'database'
    && typeof GbBacklinks !== 'undefined'
    && typeof GbBacklinks.dbFolderNotePath === 'function') {
    return String(GbBacklinks.dbFolderNotePath(path) || '');
  }
  return String(path || '');
}

// 公開開始時に表示対象と OptionTarget を一度だけ束ねる。以後の非同期工程は
// この immutable snapshot を使い、工程ごとに現在値との一致だけを検証する。
function createPublishContextSnapshot(expectedKind) {
  const visible = getCurrentPublishContext();
  const kind = String(visible?.kind || '');
  const path = String(visible?.path || '');
  if (!kind || !path) return _publishContextError('公開対象が選択されていません');
  if (expectedKind && String(expectedKind) !== kind) {
    return _publishContextError('表示中の対象と公開種別が一致しません');
  }

  const option = (typeof GBOptionTargetContext !== 'undefined' && typeof GBOptionTargetContext.get === 'function')
    ? GBOptionTargetContext.get()
    : null;
  const targets = Array.isArray(option?.targets) ? option.targets : [];
  const optionTargetPath = _publishOptionPathForContext(kind, path);
  if (targets.length > 1) return _publishContextError('公開対象が複数選択されているため処理を停止しました');
  if (targets.length === 1) {
    const target = targets[0] || {};
    if (String(target.path || '') !== optionTargetPath || String(target.kind || '') !== kind) {
      return _publishContextError('表示中の対象と選択対象が一致しないため処理を停止しました');
    }
  }

  return Object.freeze({
    kind,
    path,
    label: String(visible.label || ''),
    paneId: String(visible.paneId || ''),
    tabId: String(visible.tabId || ''),
    viewId: String(visible.viewId || ''),
    selectionRevision: Number.isFinite(option?.selectionRevision) ? option.selectionRevision : null,
    optionTargetCount: targets.length,
    optionTargetPath,
  });
}

function _publishBoardCanvasSnapshot() {
  const canvas = document.getElementById('bd-canvas');
  if (!canvas || typeof canvas.cloneNode !== 'function') return null;
  const clone = canvas.cloneNode(true);
  // 公開対象は保存されたボード文書だけ。選択、フォーカス、ドラッグ中の
  // クロームは利用者の一時UI状態なので、スナップショット固定前に除去する。
  clone.querySelectorAll(
    '.bd-selected, .bd-selection-preview, .bd-drag-preview, [data-bd-role="resize-layer"], [data-export-remove]'
  ).forEach(node => {
    if (node.matches?.('.bd-selected')) node.classList.remove('bd-selected');
    else if (node.matches?.('[data-bd-role="resize-layer"]')) node.innerHTML = '';
    else node.remove();
  });
  clone.querySelectorAll('[aria-selected="true"]').forEach(node => node.removeAttribute('aria-selected'));
  return clone.outerHTML;
}

// ボードの公開正本は「保存済みのアクティブボード＋表示中の保存ビュー」の
// 固定スナップショット。ここで既存 bdSave/CAS を必ず通し、DOMだけを先行公開しない。
async function preparePublishContextSnapshot(snapshot) {
  if (!snapshot || !isPublishContextSnapshotCurrent(snapshot, true)) return null;
  if (snapshot.kind !== 'board') return snapshot;
  if (typeof bd === 'undefined' || String(bd.path || '') !== snapshot.path || typeof bdToMd !== 'function') {
    return _publishContextError('アクティブボードを確認できないため公開を停止しました');
  }
  const openSeq = Number(bd._openSeq) || 0;
  if (bd.dirty) {
    if (typeof bdSave !== 'function' || !await bdSave()) {
      return _publishContextError('ボードを保存できないため公開を停止しました');
    }
  }
  if (!isPublishContextSnapshotCurrent(snapshot, true)
    || String(bd.path || '') !== snapshot.path
    || (Number(bd._openSeq) || 0) !== openSeq
    || bd.dirty) {
    return _publishContextError('ボードが保存中に変更されたため公開を停止しました');
  }
  const coordinator = window.MeldexDocumentSaveCoordinator;
  const documentKey = coordinator?.documentKeyForPath?.(snapshot.path) || snapshot.path;
  if (coordinator?.getConflict?.(documentKey)) {
    return _publishContextError('ボードの保存競合が未解決のため公開を停止しました');
  }
  const bounds = (typeof _bdExportImageBounds === 'function') ? _bdExportImageBounds() : null;
  const canvasHtml = _publishBoardCanvasSnapshot();
  if (!bounds || !canvasHtml) {
    return _publishContextError('公開できるボード内容がありません');
  }
  const board = Object.freeze({
    schema: 'meldex.board-publish-snapshot.v1',
    contextPolicy: 'saved-active-board',
    openSeq,
    documentKey,
    sourceRevision: String(bd.lastSavedTransportRevision || bd.lastSavedEtag || ''),
    activeBoardViewId: String(bd.activeBoardViewId || snapshot.viewId || ''),
    document: bdToMd(),
    canvasHtml,
    bounds: Object.freeze({
      x0: Number(bounds.x0) || 0,
      y0: Number(bounds.y0) || 0,
      width: Number(bounds.width) || 0,
      height: Number(bounds.height) || 0,
    }),
  });
  return Object.freeze({ ...snapshot, viewId: board.activeBoardViewId, board });
}
if (typeof window !== 'undefined') window.preparePublishContextSnapshot = preparePublishContextSnapshot;

function isPublishContextSnapshotCurrent(snapshot, reportError) {
  let valid = !!snapshot?.kind && !!snapshot?.path;
  const current = valid ? getCurrentPublishContext() : null;
  valid = valid
    && String(current?.kind || '') === snapshot.kind
    && String(current?.path || '') === snapshot.path;

  if (valid && snapshot.selectionRevision !== null) {
    const option = (typeof GBOptionTargetContext !== 'undefined' && typeof GBOptionTargetContext.get === 'function')
      ? GBOptionTargetContext.get()
      : null;
    const targets = Array.isArray(option?.targets) ? option.targets : [];
    valid = option?.selectionRevision === snapshot.selectionRevision
      && targets.length === snapshot.optionTargetCount
      && targets.length <= 1;
    if (valid && targets.length === 1) {
      valid = String(targets[0]?.path || '') === snapshot.optionTargetPath
        && String(targets[0]?.kind || '') === snapshot.kind;
    }
  }

  if (valid && snapshot.kind === 'board' && snapshot.board) {
    valid = typeof bd !== 'undefined'
      && String(bd.path || '') === snapshot.path
      && (Number(bd._openSeq) || 0) === snapshot.board.openSeq
      && !bd.dirty
      && typeof bdToMd === 'function'
      && bdToMd() === snapshot.board.document;
  }

  if (!valid && reportError && typeof showStatus === 'function') {
    showStatus('公開対象が処理中に変更されたため、生成・保存を停止しました', true);
  }
  return valid;
}
if (typeof window !== 'undefined') {
  window.createPublishContextSnapshot = createPublishContextSnapshot;
  window.isPublishContextSnapshotCurrent = isPublishContextSnapshotCurrent;
}

function getPublishConfigForContext(ctx) {
  if (ctx?.kind === 'database') return state.dbMetadata?.publish || {};
  // entity / page / csv / calendar は localStorage にファイルパス単位で保存
  if (ctx?.path) {
    try { return JSON.parse(localStorage.getItem('gb:publish:' + ctx.path) || '{}'); } catch { return {}; }
  }
  return {};
}

async function assertPublishAllowedForContext(ctx) {
  const target = ctx || (typeof getCurrentPublishContext === 'function' ? getCurrentPublishContext() : null);
  if (!target?.path) return false;
  if (typeof apiFetch !== 'function') {
    if (typeof showStatus === 'function') showStatus('公開権限をサーバ側で確認できないため処理を停止しました', true);
    return false;
  }
  try {
    const data = await apiFetch('/status_policies/resolve?path=' + encodeURIComponent(target.path));
    const policy = data?.policy || {};
    if (policy.publish_allowed === false) {
      const status = data?.status || '(未設定)';
      if (typeof showStatus === 'function') showStatus('このstatusは公開が許可されていません: ' + status, true);
      return false;
    }
    return true;
  } catch (err) {
    if (typeof showStatus === 'function') showStatus('公開可否の確認に失敗しました: ' + (err?.message || err), true);
    return false;
  }
}
if (typeof window !== 'undefined') window.assertPublishAllowedForContext = assertPublishAllowedForContext;

async function assertPublishSourceRevisionCurrent(ctx) {
  if (!ctx?.path || ctx.kind !== 'board' || !ctx.board) return true;
  if (!ctx.board.sourceRevision || typeof apiFetch !== 'function') {
    return !!_publishContextError('ボードの保存revisionを確認できないため公開を停止しました');
  }
  try {
    const current = await apiFetch('/file?path=' + encodeURIComponent(ctx.path) + '&metadata_only=1', {
      silentError: true,
    });
    const revision = String(current?.transport_revision || current?.etag || current?.revision || '');
    if (!revision || revision !== String(ctx.board.sourceRevision)) {
      return !!_publishContextError('ボードが別の端末で更新されたため、再読込してから公開してください');
    }
    return true;
  } catch (error) {
    if (typeof showStatus === 'function') showStatus('ボードrevisionの再確認に失敗しました: ' + (error?.message || error), true);
    return false;
  }
}
if (typeof window !== 'undefined') window.assertPublishSourceRevisionCurrent = assertPublishSourceRevisionCurrent;

async function savePublishConfigForContext(ctx, cfg) {
  if (!ctx?.kind) return false;
  const next = { ...(cfg || {}) };
  if (ctx.kind === 'database') {
    if (!state.dbMetadata) state.dbMetadata = {};
    state.dbMetadata.publish = next;
    await apiPut('/db-metadata?path=' + encodeURIComponent(ctx.path), { publish: next });
    return true;
  }
  // entity / page / csv / calendar は localStorage 保存
  if (ctx.path) localStorage.setItem('gb:publish:' + ctx.path, JSON.stringify(next));
  return true;
}

function _publishToken() {
  const bytes = new Uint8Array(24);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function _buildSubmitUrl(serverUrl, submitUrl) {
  const explicit = String(submitUrl || '').trim();
  if (explicit) return explicit;
  const base = String(serverUrl || '').trim().replace(/\/+$/, '');
  return base ? base + '/api/public-form/submit' : '';
}

function _publishEntityNameSourceForContext(ctx, prev) {
  const fallback = prev?.form_entity_name_source || { kind: 'template', template: 'フォーム送信 {yyyy}-{MM}-{dd} {HH}:{mm}' };
  if (ctx?.kind !== 'database' || typeof getActiveFormConfig !== 'function') return fallback;
  try {
    const props = state?.pivotData?.properties || [];
    const propTypes = (typeof getPropertyTypes === 'function') ? getPropertyTypes(ctx.path) || {} : {};
    const formCfg = getActiveFormConfig(ctx.path, props, propTypes);
    const prop = String(formCfg?.entityNameProp || '').trim();
    return prop ? { kind: 'property', property: prop } : fallback;
  } catch {
    return fallback;
  }
}

function renderPublishSettingsPanel(contextSnapshot) {
  const ctx = contextSnapshot || createPublishContextSnapshot();
  if (!ctx) return '';
  const cfg = getPublishConfigForContext(ctx);
  // 単一パネル種別は「表ビュー/フォーム」設定を持たない
  const isSinglePanel = ['page', 'entity', 'csv', 'calendar'].includes(ctx.kind);
  const isDb = ctx.kind === 'database';
  return `<section class="gb-section gb-section--boxed" id="publish-settings-panel" data-kind="${esc(ctx.kind)}" data-path="${esc(ctx.path)}">
    <div class="gb-section-title">${lucide('globe',14)} 公開${isSinglePanel ? ' ' + fieldHelp('現在表示中の内容がそのまま静的HTMLとして出力されます') : ''}</div>
    <div class="gb-section-desc">対象: ${esc(ctx.label)}${ctx.path ? ' / ' + esc(ctx.path) : ''}</div>
    <label class="gb-field-row"><span class="gb-label">HTML保存先</span><input id="publish-html-path" data-e2e-id="publish-html-path" class="gb-input" value="${esc(cfg.html_path || '')}" readonly></label>
    <div class="gb-field-row">
      <button type="button" class="gb-btn gb-btn-sm" id="publish-save-as-btn" data-e2e-id="publish-change-path">公開先を変更</button>
    </div>
    <div class="gb-field-row">
      <button type="button" class="gb-btn gb-btn-sm" id="publish-update-btn" data-e2e-id="publish-update">公開を更新</button>
    </div>
    <div class="gb-check-row">
      <label class="gb-check"><input type="checkbox" id="publish-embed-font" data-e2e-id="publish-embed-font" ${cfg.embed_font !== false ? 'checked' : ''}><span>フォントを埋め込む</span></label>
    </div>
    ${isDb ? `<div class="gb-check-row"><label class="gb-check"><input type="checkbox" id="publish-form-submit-enabled" data-e2e-id="publish-form-submit-enabled" ${cfg.form_submit_enabled ? 'checked' : ''}><span>公開フォーム送信を受け付ける（フォームビューのみ）</span></label></div>` : ''}
    ${isDb ? `
    <label class="gb-field-row"><span class="gb-label">Meldex公開URL</span><input id="publish-server-url" data-e2e-id="publish-server-url" class="gb-input" value="${esc(cfg.server_public_url || '')}" placeholder="https://example.example"></label>
    <label class="gb-field-row"><span class="gb-label">送信先URL</span><input id="publish-submit-url" data-e2e-id="publish-submit-url" class="gb-input" value="${esc(cfg.submit_url || '')}" placeholder="未指定ならMeldex公開URLから生成"></label>
    <label class="gb-field-row"><span class="gb-label">送信トークン</span><input id="publish-form-token" data-e2e-id="publish-form-token" class="gb-input" value="${esc(cfg.form_submit_token || '')}" readonly><button type="button" class="gb-btn gb-btn-sm" id="publish-token-btn" data-e2e-id="publish-token-regenerate">再発行</button></label>
    ` : ''}
  </section>`;
}

function bindPublishSettingsPanel(root, options) {
  const opts = options || {};
  const panel = root.querySelector('#publish-settings-panel');
  if (!panel) return;
  const ctx = opts.contextSnapshot;
  if (!ctx || !isPublishContextSnapshotCurrent(ctx, true)) return;
  const token = panel.querySelector('#publish-form-token');
  panel.querySelector('#publish-token-btn')?.addEventListener('click', () => { if (token) token.value = _publishToken(); });
  const runPublishAction = async (button, changePath) => {
    if (button?.disabled) return;
    opts.onBusyChange?.(true);
    try {
      if (!isPublishContextSnapshotCurrent(ctx, true)) return;
      await savePublishSettingsFromPanel(root, ctx);
      if (!isPublishContextSnapshotCurrent(ctx, true)) return;
      if (typeof MeldexExportHtml !== 'undefined') {
        const publishSnapshot = typeof preparePublishContextSnapshot === 'function'
          ? await preparePublishContextSnapshot(ctx)
          : ctx;
        if (!publishSnapshot) return;
        await MeldexExportHtml.publishCurrentView(ctx.kind, {
          changePath: !!changePath,
          contextSnapshot: publishSnapshot,
        });
      }
      if (changePath) {
        if (!isPublishContextSnapshotCurrent(ctx, true)) return;
        const cfg = getPublishConfigForContext(ctx);
        const pathInput = panel.querySelector('#publish-html-path');
        if (pathInput) pathInput.value = cfg.html_path || '';
      }
    } catch (error) {
      if (typeof showStatus === 'function') showStatus('公開設定を保存できませんでした: ' + (error?.message || error), true);
    } finally {
      opts.onBusyChange?.(false);
    }
  };
  const changePathButton = panel.querySelector('#publish-save-as-btn');
  const updateButton = panel.querySelector('#publish-update-btn');
  changePathButton?.addEventListener('click', () => runPublishAction(changePathButton, true));
  updateButton?.addEventListener('click', () => runPublishAction(updateButton, false));
}

// ファイル単位の「公開設定」モーダル。各アプリ（ノート／シナリオ／シート／ボード）の
// メニューボタンから呼ばれる。対象はアクティブなファイルコンテキスト。
function showPublishSettingsModal(options) {
  const opts = options || {};
  showPublishSettingsModal._activeDialog?.close?.('superseded');
  const ctx = createPublishContextSnapshot();
  if (!ctx) {
    if (typeof showStatus === 'function') showStatus('公開設定の対象ファイルがありません', true);
    return;
  }
  const content = document.createElement('div');
  content.className = 'gb-publish-settings-body';
  content.innerHTML = renderPublishSettingsPanel(ctx);
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'gb-btn';
  closeButton.dataset.e2eId = 'publish-settings-close';
  closeButton.textContent = '閉じる';
  let busy = false;
  let dialogApi = null;
  const setBusy = value => {
    busy = !!value;
    dialogApi?.overlay?.setAttribute('aria-busy', busy ? 'true' : 'false');
    content.querySelectorAll('button,input').forEach(control => { control.disabled = busy; });
    closeButton.disabled = busy;
  };
  dialogApi = window.GBUI.createModal({
    id: 'publish-settings-dialog',
    title: '公開設定',
    body: content,
    footer: closeButton,
    variant: 'standard',
    extraClass: 'gb-publish-settings-modal',
    geometryKey: 'publish-settings',
    initialFocus: '[data-e2e-id="publish-change-path"]',
    returnFocus: opts.returnFocus || undefined,
    onBeforeClose: reason => !busy || reason === 'superseded',
    onClose: () => {
      if (showPublishSettingsModal._activeDialog === dialogApi) showPublishSettingsModal._activeDialog = null;
    },
  });
  showPublishSettingsModal._activeDialog = dialogApi;
  const o = dialogApi.overlay;
  o.classList.add('modal-overlay');
  o.dataset.publishSettings = '1';
  dialogApi.header.querySelector('.gb-modal-close')?.setAttribute('data-e2e-id', 'publish-settings-close-icon');
  closeButton.addEventListener('click', () => dialogApi.close('close-button'));
  if (typeof replaceIcons === 'function') replaceIcons();
  bindPublishSettingsPanel(o, { onBusyChange: setBusy, contextSnapshot: ctx });
  dialogApi.open();
}
if (typeof window !== 'undefined') window.showPublishSettingsModal = showPublishSettingsModal;

async function publishCurrentDatabaseView() {
  if (typeof MeldexExportHtml !== 'undefined') {
    await MeldexExportHtml.publishCurrentView('database');
  }
}
if (typeof window !== 'undefined') window.publishCurrentDatabaseView = publishCurrentDatabaseView;

async function publishCurrentPageView() {
  if (typeof MeldexExportHtml !== 'undefined') {
    await MeldexExportHtml.publishCurrentView('page');
  }
}
if (typeof window !== 'undefined') window.publishCurrentPageView = publishCurrentPageView;

async function savePublishSettingsFromPanel(root, contextSnapshot) {
  const panel = (root || document).querySelector('#publish-settings-panel');
  if (!panel) return true;
  const ctx = contextSnapshot || createPublishContextSnapshot();
  if (!ctx || !isPublishContextSnapshotCurrent(ctx, true)) return false;
  const prev = getPublishConfigForContext(ctx);
  const isDb = ctx.kind === 'database';
  const serverUrlInput = panel.querySelector('#publish-server-url');
  const submitUrlInput = panel.querySelector('#publish-submit-url');
  const serverUrl = isDb
    ? (serverUrlInput ? serverUrlInput.value.trim() : prev.server_public_url || '')
    : (prev.server_public_url || '');
  const submitUrl = isDb
    ? _buildSubmitUrl(serverUrl, submitUrlInput ? submitUrlInput.value.trim() : prev.submit_url || '')
    : (prev.submit_url || '');
  const cfg = {
    ...prev,
    html_path: panel.querySelector('#publish-html-path')?.value || prev.html_path || '',
    embed_font: !!panel.querySelector('#publish-embed-font')?.checked,
    // DB 以外はフォーム関連フィールドは変更しない (prev 値維持)
    form_submit_enabled: isDb
      ? !!panel.querySelector('#publish-form-submit-enabled')?.checked
      : !!prev.form_submit_enabled,
    form_submit_token: isDb
      ? (panel.querySelector('#publish-form-token')?.value || prev.form_submit_token || _publishToken())
      : prev.form_submit_token || '',
    form_entity_name_source: _publishEntityNameSourceForContext(ctx, prev),
    server_public_url: serverUrl,
    submit_url: submitUrl,
    submit_method: prev.submit_method || 'tunnel',
  };
  if (!isPublishContextSnapshotCurrent(ctx, true)) return false;
  await savePublishConfigForContext(ctx, cfg);
  return true;
}
