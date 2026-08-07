/* 公開 HTML 設定 */

function getCurrentPublishContext() {
  if (state?.view === 'smart-db' && state.currentSmartDb) {
    return { kind: 'smart-db', label: state.currentSmartDb.name || 'スマートシート', path: state.currentSmartDb._filePath || state.currentSmartDb.id || '' };
  }
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
    return { kind: 'board', label: 'ボード', path: tab.path };
  }
  if (tab?.type === 'scriptnote' && tab.path) {
    return { kind: 'scriptnote', label: 'シナリオ', path: tab.path };
  }
  return { kind: '', label: '未選択', path: '' };
}

function getPublishConfigForContext(ctx) {
  if (ctx?.kind === 'database') return state.dbMetadata?.publish || {};
  if (ctx?.kind === 'smart-db') return state.currentSmartDb?.publish || {};
  // entity / page / csv / calendar は localStorage にファイルパス単位で保存
  if (ctx?.path) {
    try { return JSON.parse(localStorage.getItem('gb:publish:' + ctx.path) || '{}'); } catch { return {}; }
  }
  return {};
}

async function assertPublishAllowedForContext(ctx) {
  const target = ctx || (typeof getCurrentPublishContext === 'function' ? getCurrentPublishContext() : null);
  if (!target?.path || typeof apiFetch !== 'function') return true;
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

async function savePublishConfigForContext(ctx, cfg) {
  if (!ctx?.kind) return false;
  const next = { ...(cfg || {}) };
  if (ctx.kind === 'smart-db') {
    state.currentSmartDb.publish = next;
    if (Array.isArray(next.views_enabled)) next.views_enabled = next.views_enabled.filter(v => v !== 'form');
    if (typeof saveSmartDbDef === 'function') await saveSmartDbDef(state.currentSmartDb);
    return true;
  }
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

function renderPublishSettingsPanel() {
  const ctx = getCurrentPublishContext();
  const cfg = getPublishConfigForContext(ctx);
  // 単一パネル種別は「表ビュー/フォーム」設定を持たない
  const isSinglePanel = ['page', 'entity', 'csv', 'calendar'].includes(ctx.kind);
  const isDb = ctx.kind === 'database';
  return `<section class="gb-section gb-section--boxed" id="publish-settings-panel" data-kind="${esc(ctx.kind)}" data-path="${esc(ctx.path)}">
    <div class="gb-section-title">${lucide('globe',14)} 公開${isSinglePanel ? ' ' + fieldHelp('現在表示中の内容がそのまま静的HTMLとして出力されます') : ''}</div>
    <div class="gb-section-desc">対象: ${esc(ctx.label)}${ctx.path ? ' / ' + esc(ctx.path) : ''}</div>
    <label class="gb-field-row"><span class="gb-label">HTML保存先</span><input id="publish-html-path" class="gb-input" value="${esc(cfg.html_path || '')}" readonly></label>
    <div class="gb-field-row">
      <button type="button" class="gb-btn gb-btn-sm" id="publish-save-as-btn">公開先を変更</button>
      <button type="button" class="gb-btn gb-btn-sm primary" id="publish-update-btn">公開を更新</button>
    </div>
    <div class="gb-check-row" style="flex-direction:column;align-items:flex-start;">
      <label class="gb-check"><input type="checkbox" id="publish-embed-font" ${cfg.embed_font !== false ? 'checked' : ''}><span>フォントを埋め込む</span></label>
      ${isDb ? `<label class="gb-check"><input type="checkbox" id="publish-form-submit-enabled" ${cfg.form_submit_enabled ? 'checked' : ''}><span>公開フォーム送信を受け付ける（フォームビューのみ）</span></label>` : ''}
    </div>
    ${isDb ? `
    <label class="gb-field-row"><span class="gb-label">Meldex公開URL</span><input id="publish-server-url" class="gb-input" value="${esc(cfg.server_public_url || '')}" placeholder="https://example.example"></label>
    <label class="gb-field-row"><span class="gb-label">送信先URL</span><input id="publish-submit-url" class="gb-input" value="${esc(cfg.submit_url || '')}" placeholder="未指定ならMeldex公開URLから生成"></label>
    <label class="gb-field-row"><span class="gb-label">送信トークン</span><input id="publish-form-token" class="gb-input" value="${esc(cfg.form_submit_token || '')}" readonly><button type="button" class="gb-btn gb-btn-sm" id="publish-token-btn">再発行</button></label>
    ` : ''}
  </section>`;
}

function bindPublishSettingsPanel(root) {
  const panel = root.querySelector('#publish-settings-panel');
  if (!panel) return;
  const ctx = { kind: panel.dataset.kind || '', path: panel.dataset.path || '', label: '' };
  const token = panel.querySelector('#publish-form-token');
  panel.querySelector('#publish-token-btn')?.addEventListener('click', () => { if (token) token.value = _publishToken(); });
  panel.querySelector('#publish-save-as-btn')?.addEventListener('click', async () => {
    await savePublishSettingsFromPanel(root);
    if (typeof MeldexExportHtml !== 'undefined') await MeldexExportHtml.publishCurrentView(ctx.kind, { changePath: true });
    const cfg = getPublishConfigForContext(getCurrentPublishContext());
    const pathInput = panel.querySelector('#publish-html-path');
    if (pathInput) pathInput.value = cfg.html_path || '';
  });
  panel.querySelector('#publish-update-btn')?.addEventListener('click', async () => {
    await savePublishSettingsFromPanel(root);
    if (typeof MeldexExportHtml !== 'undefined') await MeldexExportHtml.publishCurrentView(ctx.kind);
  });
}

// ファイル単位の「公開設定」モーダル。各アプリ (ノート/シナリオ/シート/ボード/スマートシート) の
// メニューボタンから呼ばれる。対象はアクティブなファイルコンテキスト。
function showPublishSettingsModal() {
  document.querySelectorAll('.modal-overlay[data-publish-settings]').forEach(m => m.remove());
  const ctx = getCurrentPublishContext();
  if (!ctx.kind) {
    if (typeof showStatus === 'function') showStatus('公開設定の対象ファイルがありません', true);
    return;
  }
  const o = document.createElement('div');
  o.className = 'modal-overlay';
  o.dataset.publishSettings = '1';
  o.innerHTML = `<div class="modal" style="width:560px;max-height:80vh;">
    <h3 style="flex-shrink:0;display:flex;align-items:center;gap:8px;">
      <span>${lucide('globe',16)} 公開設定</span>
    </h3>
    <div style="overflow-y:auto;flex:1;">
      ${renderPublishSettingsPanel()}
    </div>
    <div class="btn-row" style="flex-shrink:0;display:flex;justify-content:flex-end;gap:8px;padding-top:12px;">
      <button class="gb-btn" data-publish-close>閉じる</button>
    </div>
  </div>`;
  document.body.appendChild(o);
  if (typeof replaceIcons === 'function') replaceIcons();
  bindPublishSettingsPanel(o);
  o.querySelector('[data-publish-close]')?.addEventListener('click', () => o.remove());
  o.addEventListener('click', (e) => { if (e.target === o) o.remove(); });
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

async function savePublishSettingsFromPanel(root) {
  const panel = (root || document).querySelector('#publish-settings-panel');
  if (!panel) return true;
  const ctx = getCurrentPublishContext();
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
  await savePublishConfigForContext(ctx, cfg);
  return true;
}
