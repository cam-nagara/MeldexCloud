/* シートの列設定タブの追加機能（gb-db-property-types.js から分割読込）
 *  1. 列メモ（列設定の一番上。property_types[列].description、トピック名列は表示設定 entityColumnMemo）
 *  2. ビューに応じた列設定の表示（列を選んでいない時、カンバンのグループ化列などを出す）
 *  3. AI自動生成列（property_types[列].ai_autofill。生成はデスクトップ版のサーバーで行う）
 */

const PT_AI_SUPPORTED_TYPES = ['text', 'furigana', 'number', 'select', 'link', 'date'];
const PT_AI_TRIGGERS = ['on_create', 'on_source_change'];
const PT_AI_OVERWRITE_MODES = ['empty_only', 'always'];
const PT_AI_PROVIDER_FALLBACK = [
  { key: 'claude_code', label: 'Claude Code', kind: 'cli' },
  { key: 'codex', label: 'Codex CLI', kind: 'cli' },
  { key: 'antigravity_cli', label: 'Antigravity CLI', kind: 'cli' },
  { key: 'anthropic', label: 'Anthropic API', kind: 'api' },
  { key: 'openai', label: 'OpenAI API', kind: 'api' },
  { key: 'gemini', label: 'Gemini API', kind: 'api' },
];
const PT_AI_MAX_PROMPT_CHARS = 4000;
const PT_MEMO_MAX_CHARS = 4000;

/* ---------- 共通 ---------- */

function _ptIsCloudSurface() {
  try {
    return !!(window.MeldexRuntimeAdapter?.isPwaMode?.()
      || ['browser', 'dropbox', 'server'].includes(document.body?.dataset?.cloudMode || ''));
  } catch {
    return false;
  }
}

function _ptColumnWriteBlockedMessage(dbPath, propName, ctx) {
  if (typeof _cellUiWriteBlockedMessage === 'function') {
    const message = _cellUiWriteBlockedMessage(ctx);
    if (message) return message;
  }
  if (propName && propName !== '__entity__' && typeof _dbSchemaProtectionLevel === 'function') {
    const level = _dbSchemaProtectionLevel(dbPath, propName);
    if (level === 'all' || level === 'computed' || level === 'required') return '読み取り専用';
  }
  return '';
}

function _ptCloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

// 列メモ・AI自動生成は専用欄で個別に保存する。型や選択肢の自動保存（applyPropertyType）が
// 列設定を組み立て直す時、直前の保存値を引き継いで消さない。
function _ptPreserveIndependentColumnFields(config, stored) {
  if (!config || typeof config !== 'object' || !stored || typeof stored !== 'object') return config;
  if (typeof stored.description === 'string' && stored.description && !('description' in config)) {
    config.description = stored.description;
  }
  if (stored.ai_autofill && typeof stored.ai_autofill === 'object' && !('ai_autofill' in config)) {
    config.ai_autofill = _ptCloneJson(stored.ai_autofill);
  }
  return config;
}

// 列名変更時に、AI自動生成のプロンプト内の {旧名} を {新名} へ付け替える。
function _ptRenameAiPromptRefs(cfg, oldName, newName) {
  const ai = cfg?.ai_autofill;
  if (!ai || typeof ai !== 'object' || typeof ai.prompt !== 'string' || !oldName || oldName === newName) return;
  ai.prompt = ai.prompt.split('{' + oldName + '}').join('{' + newName + '}');
}

// 列設定の独立欄（メモ・AI）の操作で、列設定全体の自動保存を走らせない。
function _ptIsIndependentFieldEvent(event) {
  return !!event?.target?.closest?.('[data-pt-independent]');
}

/* ---------- 1. 列メモ ---------- */

function _ptColumnMemoValue(dbPath, propName, ctx) {
  if (propName === '__entity__') {
    return String(getDbViewConfig(dbPath)?.entityColumnMemo || '');
  }
  const types = typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath, ctx) : null;
  return String(types?.[propName]?.description || '');
}

function _ptColumnMemoFieldHtml(dbPath, propName, ctx) {
  const value = _ptColumnMemoValue(dbPath, propName, ctx);
  const blocked = _ptColumnWriteBlockedMessage(dbPath, propName, ctx);
  const help = typeof fieldHelp === 'function'
    ? fieldHelp('この列の用途や入力のきまりを書き残せます。入力を止めると自動で保存します', { e2eId: 'pt-column-memo-help' })
    : '';
  return `<div class="field pt-column-memo" data-pt-independent="memo">
      <label for="pt-column-memo">メモ ${help}${blocked ? ` <span class="pt-hint">${esc(blocked)}</span>` : ''}</label>
      <div class="pt-column-memo-value">
        <textarea id="pt-column-memo" rows="3" maxlength="${PT_MEMO_MAX_CHARS}" placeholder="この列のメモ" aria-label="列のメモ" data-e2e-id="pt-column-memo"${blocked ? ' readonly' : ''}>${esc(value)}</textarea>
        <div class="pt-autosave-status" aria-live="polite" data-pt-memo-status></div>
      </div>
    </div>`;
}

async function _ptSaveColumnMemo(dbPath, propName, ctx, text) {
  const nextText = String(text || '').slice(0, PT_MEMO_MAX_CHARS);
  if (propName === '__entity__') {
    const config = _cloneDbViewObject(getDbViewConfig(dbPath));
    if (nextText.trim()) config.entityColumnMemo = nextText;
    else delete config.entityColumnMemo;
    const saved = await saveDbViewConfigImmediate(dbPath, config, { ctx, historyLabel: 'シート設定: 列メモ' });
    if (!saved) throw new Error('表示設定を保存できませんでした');
    return true;
  }
  const types = getPropertyTypes(dbPath, ctx) || {};
  const before = _ptCloneJson(types[propName] || { type: 'text' });
  const next = { ...before };
  if (nextText.trim()) next.description = nextText;
  else delete next.description;
  if (JSON.stringify(before) === JSON.stringify(next)) return true;
  const ok = await Promise.resolve(setPropertyType(dbPath, propName, next, ctx));
  if (ok === false) throw new Error('この列のメモは変更できません');
  if (typeof _ptPushTypeChangeHistory === 'function') _ptPushTypeChangeHistory(dbPath, propName, before, next, ctx);
  return true;
}

function _ptBindColumnMemoField(root, dbPath, propName, ctx) {
  const textarea = root?.querySelector?.('#pt-column-memo');
  if (!textarea || textarea.dataset.ptMemoBound) return;
  textarea.dataset.ptMemoBound = '1';
  const status = root.querySelector('[data-pt-memo-status]');
  let savedText = textarea.value;
  let timer = null;
  let pending = null;
  const commit = () => {
    clearTimeout(timer);
    timer = null;
    if (textarea.readOnly) return Promise.resolve(true);
    const text = textarea.value;
    if (text === savedText) return pending || Promise.resolve(true);
    if (status) status.textContent = '保存中...';
    const run = (pending || Promise.resolve()).then(() => _ptSaveColumnMemo(dbPath, propName, ctx, text))
      .then(() => {
        savedText = text;
        if (status) status.textContent = '保存済み';
        return true;
      })
      .catch((error) => {
        if (status) status.textContent = '保存できませんでした';
        if (typeof showStatus === 'function') showStatus('列のメモを保存できませんでした: ' + (error?.message || error), true);
        return false;
      });
    pending = run.finally(() => { if (pending === run) pending = null; });
    return run;
  };
  textarea.addEventListener('input', () => {
    if (status) status.textContent = '保存待ち...';
    clearTimeout(timer);
    timer = setTimeout(commit, 700);
  });
  textarea.addEventListener('blur', () => { commit(); });
  textarea.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      clearTimeout(timer);
      textarea.value = savedText;
      if (status) status.textContent = '';
      textarea.blur();
    }
  });
  const previousFlush = root._ptFlushAutosave;
  root._ptFlushAutosave = async () => {
    await commit();
    if (typeof previousFlush === 'function') return previousFlush();
    return undefined;
  };
}

/* ---------- 2. ビューに応じた列設定 ---------- */

const PT_VIEW_LABELS = {
  pivot: 'テーブル', tree: 'ツリー', gallery: 'ギャラリー', kanban: 'カンバン', calendar: 'カレンダー',
  timeline: 'タイムライン', gantt: 'ガント', chart: 'チャート', graph: 'グラフ', form: 'フォーム',
};

function _ptViewModeFor(dbPath, ctx) {
  if (typeof getCurrentViewMode === 'function') return getCurrentViewMode(dbPath, { ctx }) || 'pivot';
  return ctx?.viewMode || 'pivot';
}

// ビューごとに「その時に適切な列」の対応表。先頭が既定で表示する列。
function _ptViewSettingsTargets(dbPath, ctx) {
  const viewMode = _ptViewModeFor(dbPath, ctx);
  const targets = [];
  const add = (role, prop) => {
    const name = prop === '_entity' ? '__entity__' : String(prop || '');
    if (!name || targets.some(item => item.prop === name)) return;
    targets.push({ role, prop: name });
  };
  const safe = (fn) => { try { return fn(); } catch { return null; } };
  if (viewMode === 'pivot') {
    add('グループ化の基準', safe(() => getGroupBy(dbPath, ctx)));
  } else if (viewMode === 'kanban') {
    const groupBy = safe(() => getKanbanGroupBy(dbPath, ctx)) || '_status';
    if (groupBy !== '_status') add('グループ化の基準', groupBy);
  } else if (viewMode === 'calendar') {
    const mapping = safe(() => getCalendarMapping(dbPath, { ctx })) || {};
    add('開始日時', mapping.startProp);
    add('終了日時', mapping.endProp);
    add('タイトル', mapping.titleProp);
    add('色分け', mapping.colorProp);
  } else if (viewMode === 'timeline' || viewMode === 'gantt') {
    const cfg = safe(() => getTimelineConfig(dbPath, { ctx, viewType: viewMode })) || {};
    add('時間の基準', cfg.timeProp);
    add('終了', cfg.endProp);
    add('行の基準', cfg.rowProp);
  } else if (viewMode === 'chart') {
    const cfg = safe(() => getChartConfig(dbPath, { ctx })) || {};
    add('横軸', cfg.xProperty);
    add('縦軸', cfg.yProperty);
  } else if (viewMode === 'graph') {
    const cfg = safe(() => getGraphConfig(dbPath, { ctx })) || {};
    add('色分け', cfg.colorProperty);
  } else if (viewMode === 'tree') {
    const cfg = safe(() => getDbTreeViewConfig(dbPath, ctx)) || {};
    add('親を表す列', cfg.parentProp);
    add('表示名', cfg.labelProp);
    add('並び順', cfg.orderProp);
  } else if (viewMode === 'gallery') {
    const types = safe(() => getPropertyTypes(dbPath, ctx)) || {};
    const imageProp = Object.keys(types).find(name => types[name]?.type === 'image');
    add('画像', imageProp);
    const cfg = safe(() => _getGalleryConfig(dbPath, ctx)) || {};
    (cfg.cardProps || []).slice(0, 3).forEach(prop => add('カードに表示', prop));
  } else if (viewMode === 'form') {
    const data = ctx?.pivotData || (typeof state !== 'undefined' ? state.pivotData : null) || {};
    const types = safe(() => getPropertyTypes(dbPath, ctx)) || {};
    const cfg = safe(() => getActiveFormConfig(dbPath, data.properties || [], types, ctx)) || {};
    add('トピック名に使う項目', cfg.entityNameProp);
    (cfg.fields || []).slice(0, 3).forEach(prop => add('フォームの項目', prop));
  }
  const pivotData = ctx?.pivotData || (typeof _ptPivotDataForDbPath === 'function' ? _ptPivotDataForDbPath(dbPath) : null);
  const known = new Set([
    ...(pivotData?.properties || []),
    ...Object.keys((typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath, ctx) : null) || {}),
    '__entity__',
  ]);
  const visibleTargets = targets.filter(item => known.has(item.prop)
    && (item.prop === '__entity__' || typeof isDbPropertyDeleted !== 'function' || !isDbPropertyDeleted(dbPath, item.prop)));
  return { viewMode, viewLabel: PT_VIEW_LABELS[viewMode] || 'ビュー', targets: visibleTargets };
}

// 表示中のビューの識別（保存ビューの位置・ID・種類）。明示的に選んだ列をビュー切替で解除する判定に使う。
function _ptActiveViewKey(dbPath, ctx) {
  try {
    const idx = typeof getCurrentViewIdx === 'function' ? getCurrentViewIdx(dbPath) : -1;
    const views = typeof getDbViewConfig === 'function' ? (getDbViewConfig(dbPath)?.savedViews || []) : [];
    const view = idx >= 0 ? views[idx] : null;
    return [idx, view?.id || '', _ptViewSettingsTargets(dbPath, ctx).viewMode].join('|');
  } catch (_) {
    return '';
  }
}

function _ptViewTargetSignature(dbPath, ctx) {
  const info = _ptViewSettingsTargets(dbPath, ctx);
  return [dbPath, info.viewMode, ...info.targets.map(item => item.role + '=' + item.prop)].join('|');
}

// 列を選んでいない時に表示する列（ユーザーが明示的に選んだ列があればそちらが優先）。
function _ptResolveViewFallbackProp(dbPath, ctx, preferred) {
  const info = _ptViewSettingsTargets(dbPath, ctx);
  if (!info.targets.length) return { info, target: null };
  const target = info.targets.find(item => item.prop === preferred) || info.targets[0];
  return { info, target };
}

function _ptViewContextHeaderHtml(info, active) {
  if (!info || !info.targets.length) return '';
  const label = (prop) => prop === '__entity__'
    ? (typeof _dbEntityColumnDisplayLabel === 'function' ? _dbEntityColumnDisplayLabel(info.dbPath || '') : 'トピック名')
    : prop;
  const chips = info.targets.length > 1
    ? `<div class="pt-formula-tools pt-view-targets" role="group" aria-label="${esc(info.viewLabel)}の基準列">${info.targets.map(item =>
        `<button type="button" class="pt-small-btn${item.prop === active?.prop ? '' : ' muted'}" data-pt-view-target="${esc(item.prop)}" aria-pressed="${item.prop === active?.prop ? 'true' : 'false'}">${esc(item.role)}: ${esc(label(item.prop))}</button>`
      ).join('')}</div>`
    : '';
  return `<div class="field pt-view-context" data-pt-view-context data-e2e-id="pt-view-context">
      <div class="pt-hint">${esc(info.viewLabel)}の${esc(active?.role || '基準')}を表示しています</div>
      ${chips}
    </div>`;
}

// 列が選ばれていない時は、表示中のビューの基準列の設定を出す。
// 戻り値: 表示する列名（無ければ ''）。描画後に _ptDecorateViewFallback で見出しを付ける。
function _ptViewFallbackForPanel(target, dbPath, ctx) {
  if (!target || !dbPath) return '';
  const preferred = target.dataset?.ptViewTargetProp || '';
  const { info, target: resolved } = _ptResolveViewFallbackProp(dbPath, ctx, preferred);
  info.dbPath = dbPath;
  // 基準列が無いビューでも「列を選んでいない状態」を覚えておき、ビューを切り替えた時に追従する。
  target._ptViewFallback = { info, active: resolved || null, signature: _ptViewTargetSignature(dbPath, ctx), dbPath };
  return resolved ? resolved.prop : '';
}

function _ptDecorateViewFallback(target, dbPath, ctx) {
  const fallback = target?._ptViewFallback;
  if (!fallback || !fallback.active || fallback.dbPath !== dbPath) return;
  const root = target.querySelector('[data-pt-root], [data-db-property-settings-root]');
  if (!root || root.querySelector('[data-pt-view-context]')) return;
  root.insertAdjacentHTML('afterbegin', _ptViewContextHeaderHtml(fallback.info, fallback.active));
  root.querySelectorAll('[data-pt-view-target]').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      target.dataset.ptViewTargetProp = btn.dataset.ptViewTarget || '';
      renderDbPropertySettingsPanel(dbPath, '', target, ctx);
    });
  });
}

let _ptViewRefreshTimer = null;
const _ptViewRefreshPaths = new Set();

// 表示設定の保存（ビュー切替・グループ化列の変更など）の後に呼ばれる。列を選んでいない状態で
// 列設定タブが開いている時だけ、基準列が変わった場合に限り描き直す（全体再描画はしない）。
function _ptScheduleViewTargetRefresh(dbPath) {
  if (typeof document === 'undefined') return;
  _ptViewRefreshPaths.add(String(dbPath || ''));
  if (_ptViewRefreshTimer) return;
  _ptViewRefreshTimer = setTimeout(() => {
    _ptViewRefreshTimer = null;
    const paths = new Set(_ptViewRefreshPaths);
    _ptViewRefreshPaths.clear();
    const container = document.getElementById('detail-tab-db-property-settings');
    if (!container || !container.isConnected) return;
    const explicit = container._ptExplicitView;
    if (explicit && !container._ptViewFallback) {
      // 明示的に選んだ列の表示中にビューを切り替えた: 新しいビューに基準列があればそちらへ移る。
      const samePath = [...paths].some(path => !path
        || (typeof _ptNormalizeDbPath === 'function' ? _ptNormalizeDbPath(path) === _ptNormalizeDbPath(explicit.dbPath) : path === explicit.dbPath));
      if (!samePath) return;
      if (container.contains(document.activeElement) && document.activeElement?.matches?.('input, textarea, select')) return;
      const ctx = typeof _ptContextForDbPath === 'function' ? _ptContextForDbPath(explicit.dbPath) : null;
      if (_ptActiveViewKey(explicit.dbPath, ctx) === explicit.key) return;
      if (!_ptViewSettingsTargets(explicit.dbPath, ctx).targets.length) return;
      if (typeof state !== 'undefined' && state.selectedColumn?.dbPath === explicit.dbPath) state.selectedColumn = null;
      renderDbPropertySettingsPanel(explicit.dbPath, '', container, ctx);
      return;
    }
    const fallback = container._ptViewFallback;
    if (!fallback) return;
    const normalized = typeof _ptNormalizeDbPath === 'function' ? _ptNormalizeDbPath(fallback.dbPath) : fallback.dbPath;
    const matches = [...paths].some(path => !path
      || (typeof _ptNormalizeDbPath === 'function' ? _ptNormalizeDbPath(path) : path) === normalized);
    if (!matches) return;
    if (container.contains(document.activeElement) && document.activeElement?.matches?.('input, textarea, select')) return;
    const ctx = typeof _ptContextForDbPath === 'function' ? _ptContextForDbPath(fallback.dbPath) : null;
    const signature = _ptViewTargetSignature(fallback.dbPath, ctx);
    if (signature === fallback.signature) return;
    renderDbPropertySettingsPanel(fallback.dbPath, '', container, ctx);
  }, 0);
}

/* ---------- 3. AI自動生成列 ---------- */

function _ptNormalizeAiAutofillConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const triggers = (Array.isArray(raw.triggers) ? raw.triggers : [raw.triggers])
    .map(value => String(value || '').trim())
    .filter((value, index, list) => PT_AI_TRIGGERS.includes(value) && list.indexOf(value) === index);
  const overwrite = PT_AI_OVERWRITE_MODES.includes(raw.overwrite) ? raw.overwrite : 'empty_only';
  const provider = PT_AI_PROVIDER_FALLBACK.some(item => item.key === raw.provider) ? raw.provider : '';
  const model = /^[A-Za-z0-9][A-Za-z0-9._:\-/]{0,127}$/.test(String(raw.model || '').trim()) ? String(raw.model).trim() : '';
  return {
    version: 1,
    enabled: raw.enabled === true,
    prompt: String(raw.prompt || '').slice(0, PT_AI_MAX_PROMPT_CHARS),
    triggers,
    overwrite,
    provider,
    model,
  };
}

let _ptAiSettingsCache = null;
let _ptAiSettingsLoadedAt = 0;

async function _ptLoadAiSettings(force) {
  if (_ptIsCloudSurface() || typeof apiFetch !== 'function') return null;
  if (!force && _ptAiSettingsCache && Date.now() - _ptAiSettingsLoadedAt < 60000) return _ptAiSettingsCache;
  try {
    const result = await apiFetch('/sheet-ai-column/settings', { silentError: true });
    if (result?.ok) {
      _ptAiSettingsCache = result;
      _ptAiSettingsLoadedAt = Date.now();
    }
  } catch {
    // 古い本体・接続失敗時は候補の既定一覧で設定だけ編集できる
  }
  return _ptAiSettingsCache;
}

function _ptAiProviderOptionsHtml(current, providers) {
  const list = Array.isArray(providers) && providers.length ? providers : PT_AI_PROVIDER_FALLBACK;
  const options = [`<option value=""${!current ? ' selected' : ''}>アプリ全体の既定</option>`];
  list.forEach(item => {
    const suffix = item.available === false ? '（未設定）' : '';
    options.push(`<option value="${esc(item.key)}"${item.key === current ? ' selected' : ''}>${esc(item.label + suffix)}</option>`);
  });
  return options.join('');
}

function _ptAiSectionHtml(dbPath, propName, ctx, type) {
  const types = getPropertyTypes(dbPath, ctx) || {};
  const config = _ptNormalizeAiAutofillConfig(types[propName]?.ai_autofill) || _ptNormalizeAiAutofillConfig({});
  const blocked = _ptColumnWriteBlockedMessage(dbPath, propName, ctx);
  const disabledAttr = blocked ? ' disabled' : '';
  const cloud = _ptIsCloudSurface();
  const canRun = !cloud && typeof runBackgroundJob === 'function';
  const pivotData = ctx?.pivotData || (typeof _ptPivotDataForDbPath === 'function' ? _ptPivotDataForDbPath(dbPath) : null);
  const refProps = (typeof filterDeletedDbProperties === 'function'
    ? filterDeletedDbProperties(dbPath, pivotData?.properties || [])
    : (pivotData?.properties || [])).filter(prop => prop !== propName);
  const refButtons = [...refProps, 'トピック名', '本文']
    .map(prop => `<button type="button" class="pt-small-btn" data-pt-ai-ref="${esc(prop)}"${disabledAttr}>{${esc(prop)}}</button>`)
    .join('');
  const help = (text, id) => (typeof fieldHelp === 'function' ? fieldHelp(text, { e2eId: id }) : '');
  return `<div id="pt-ai-autofill" class="pt-ai-autofill" data-pt-independent="ai" data-e2e-id="pt-ai-autofill"${PT_AI_SUPPORTED_TYPES.includes(type) ? '' : ' hidden'}
      style="margin-top:12px;border-top:1px solid var(--border);padding-top:8px;">
      <div class="gb-check-help-row">
        <label class="pt-check-label"><input id="pt-ai-enabled" type="checkbox"${config.enabled ? ' checked' : ''}${disabledAttr} data-e2e-id="pt-ai-enabled"> AI自動生成</label>
        ${help('列ごとのプロンプトでAIにセルの値を作らせます。生成はデスクトップ版で実行され、AIの使用量に記録されます', 'pt-ai-enabled-help')}
        ${blocked ? `<span class="pt-hint">${esc(blocked)}</span>` : ''}
      </div>
      <div id="pt-ai-body"${config.enabled ? '' : ' hidden'}>
        <div class="field"><label for="pt-ai-prompt">プロンプト ${help('{列名} で他の列の値、{トピック名} でトピック名、{本文} で本文を参照できます', 'pt-ai-prompt-help')}</label>
          <textarea id="pt-ai-prompt" rows="5" maxlength="${PT_AI_MAX_PROMPT_CHARS}" placeholder="例: {あらすじ} を30字で要約"${blocked ? ' readonly' : ''} data-e2e-id="pt-ai-prompt">${esc(config.prompt)}</textarea>
        </div>
        <div class="pt-formula-props pt-ai-ref-row" role="group" aria-label="参照できる列">${refButtons}</div>
        <fieldset class="gb-field-pair-group"><legend>自動で生成するとき</legend>
          <label class="pt-check-label"><input id="pt-ai-trigger-create" type="checkbox"${config.triggers.includes('on_create') ? ' checked' : ''}${disabledAttr}> トピックを作成したとき</label>
          <label class="pt-check-label"><input id="pt-ai-trigger-source" type="checkbox"${config.triggers.includes('on_source_change') ? ' checked' : ''}${disabledAttr}> 参照している列が変わったとき</label>
        </fieldset>
        <div class="field"><label for="pt-ai-overwrite">上書き</label>
          <select id="pt-ai-overwrite"${disabledAttr}>
            <option value="empty_only"${config.overwrite === 'empty_only' ? ' selected' : ''}>空欄のときだけ</option>
            <option value="always"${config.overwrite === 'always' ? ' selected' : ''}>常に上書き</option>
          </select>
        </div>
        <div class="field"><label for="pt-ai-provider">使用するAI</label>
          <select id="pt-ai-provider"${disabledAttr} data-e2e-id="pt-ai-provider">${_ptAiProviderOptionsHtml(config.provider, _ptAiSettingsCache?.providers)}</select>
        </div>
        <div class="field"><label for="pt-ai-model">モデル ${help('空欄ならAIごとの既定（チャットの設定）を使います', 'pt-ai-model-help')}</label>
          <input id="pt-ai-model" type="text" value="${esc(config.model)}" placeholder="空欄で既定"${disabledAttr}>
        </div>
        ${cloud ? `<div class="pt-hint" data-pt-ai-cloud-note>生成はデスクトップ版で実行できます</div>` : `
        <div class="gb-check-help-row" data-pt-ai-app-row>
          <label class="pt-check-label"><input id="pt-ai-app-auto" type="checkbox" disabled data-e2e-id="pt-ai-app-auto"> 自動生成を許可（全シート共通）</label>
          ${help('既定はオフです。オフの間は手動の生成だけ行います。オンでも1分あたりの件数に上限があります', 'pt-ai-app-auto-help')}
        </div>`}
        ${canRun ? `<div class="pt-formula-tools pt-ai-actions">
          <button type="button" class="gb-btn gb-btn-sm" data-pt-ai-run="selected"${disabledAttr} data-e2e-id="pt-ai-run-selected">選択中のトピックを生成</button>
          <button type="button" class="gb-btn gb-btn-sm" data-pt-ai-run="all"${disabledAttr} data-e2e-id="pt-ai-run-all">列全体を生成</button>
        </div>` : ''}
        <div class="pt-autosave-status" aria-live="polite" data-pt-ai-status></div>
      </div>
    </div>`;
}

function _ptCollectAiConfig(section, previous) {
  const get = id => section.querySelector('#' + id);
  const triggers = [];
  if (get('pt-ai-trigger-create')?.checked) triggers.push('on_create');
  if (get('pt-ai-trigger-source')?.checked) triggers.push('on_source_change');
  return _ptNormalizeAiAutofillConfig({
    ...(previous || {}),
    enabled: !!get('pt-ai-enabled')?.checked,
    prompt: get('pt-ai-prompt')?.value || '',
    triggers,
    overwrite: get('pt-ai-overwrite')?.value || 'empty_only',
    provider: get('pt-ai-provider')?.value || '',
    model: get('pt-ai-model')?.value || '',
  });
}

async function _ptSaveAiConfig(dbPath, propName, ctx, nextAi) {
  const types = getPropertyTypes(dbPath, ctx) || {};
  const before = _ptCloneJson(types[propName] || { type: 'text' });
  const next = { ...before, ai_autofill: nextAi };
  if (JSON.stringify(before) === JSON.stringify(next)) return true;
  const ok = await Promise.resolve(setPropertyType(dbPath, propName, next, ctx));
  if (ok === false) throw new Error('この列のAI自動生成は変更できません');
  if (typeof _ptPushTypeChangeHistory === 'function') _ptPushTypeChangeHistory(dbPath, propName, before, next, ctx);
  return true;
}

function _ptAiEntityEntryPath(dbPath, entityName, pivotData) {
  const entity = pivotData?.entities?.[entityName];
  if (entity?._entry_path) return entity._entry_path;
  return typeof _entityPath === 'function' ? _entityPath(dbPath, entityName, pivotData) : '';
}

function _ptAiCellIsEmpty(entity, propName) {
  const values = Array.isArray(entity?.[propName]) ? entity[propName] : [];
  const adopted = typeof getAdoptedValueForWrite === 'function' ? getAdoptedValueForWrite(values) : values[0];
  return !String(adopted?.value ?? '').trim();
}

// 1セルの生成結果を、通常の値書き込み（編集ロック・自動バージョン・取り消し）で保存する。
async function _ptAiWriteCellValue(dbPath, ctx, entityName, propName, value) {
  const data = ctx?.pivotData || state.pivotData;
  const entityData = data?.entities?.[entityName];
  if (!entityData) throw new Error('対象のトピックが見つかりません');
  const raw = Array.isArray(entityData[propName]) ? entityData[propName] : [];
  const adopted = typeof getAdoptedValueForWrite === 'function' ? getAdoptedValueForWrite(raw) : raw[0];
  const label = 'AIで生成: ' + propName;
  const entityPath = _ptAiEntityEntryPath(dbPath, entityName, data);
  if (adopted) {
    const oldValue = adopted.value ?? '';
    if (String(oldValue) === String(value)) return;
    await _apiPutValue(adopted, { new_value: value, __source: 'sheet-ai-column' });
    if (typeof _dbUndoValue === 'function') _dbUndoValue(label, adopted, oldValue, value, undefined, undefined, { dbPath, ctx });
    adopted.value = value;
  } else {
    const result = await _apiPostValue(entityPath, propName, value, '採用', '', '', { __source: 'sheet-ai-column' });
    const added = {
      value, status: '採用', file: result?.path || result?.file || entityPath, property: propName,
      candidate_id: result?.candidate_id, entry_id: result?.entry_id, candidate_index: result?.candidate_index ?? raw.length,
    };
    entityData[propName] = [...raw, added];
    if (typeof _dbUndoValue === 'function') _dbUndoValue(label, added, '', value, undefined, undefined, { dbPath, ctx });
  }
  if (typeof _buttonActionRefreshTargetCell === 'function') {
    _buttonActionRefreshTargetCell(dbPath, entityPath, entityName, propName, ctx);
  } else if (typeof _renderCurrentDbView === 'function') {
    _renderCurrentDbView(ctx, dbPath);
  }
}

async function _ptAiConfirmBulk(dbPath, propName, count) {
  let estimate = null;
  try {
    estimate = await apiPost('/sheet-ai-column/estimate', { db_path: dbPath, prop: propName, count }, { silentError: true });
  } catch (error) {
    if (typeof showStatus === 'function') showStatus('AI生成を開始できません: ' + (error?.message || error), true);
    return false;
  }
  const costText = estimate?.is_cli
    ? `${estimate.provider_label || 'CLI'}（定額のCLI。従量課金なし）`
    : `${estimate?.provider_label || ''} 概算 約${Number(estimate?.estimated_cost_jpy || 0).toLocaleString()}円（約$${Number(estimate?.estimated_cost_usd || 0).toFixed(2)}、1ドル=${estimate?.usd_jpy_rate || 156}円換算）`;
  const message = `列「${propName}」の${count}件をAIで生成します。\n使用するAI: ${costText}\n\n元に戻す時は、シートのバージョン履歴から生成前の状態へ戻せます。実行しますか？`;
  return typeof cfConfirm === 'function' ? cfConfirm(message, { okLabel: '生成' }) : false;
}

async function _ptAiRun(mode, dbPath, propName, ctx, section) {
  const status = section.querySelector('[data-pt-ai-status]');
  const setStatus = (text) => { if (status) status.textContent = text; };
  const flush = section._ptAiFlush;
  if (typeof flush === 'function') await flush();
  const config = _ptNormalizeAiAutofillConfig((getPropertyTypes(dbPath, ctx) || {})[propName]?.ai_autofill);
  if (!config?.enabled || !config.prompt.trim()) {
    if (typeof showStatus === 'function') showStatus('AI自動生成を有効にして、プロンプトを入力してください', true);
    return;
  }
  const pivotData = ctx?.pivotData || state.pivotData || {};
  const entities = pivotData.entities || {};
  let names = mode === 'selected'
    ? (typeof _getSelectedEntities === 'function' ? _getSelectedEntities(ctx) : [])
    : Object.keys(entities);
  if (!names.length) {
    if (typeof showStatus === 'function') showStatus(mode === 'selected' ? 'トピックを選択してください' : '生成するトピックはありません', true);
    return;
  }
  if (config.overwrite !== 'always') names = names.filter(name => _ptAiCellIsEmpty(entities[name], propName));
  if (!names.length) {
    if (typeof showStatus === 'function') showStatus('空欄のトピックはありません');
    return;
  }
  if (names.length === 1 && mode === 'selected') {
    const entityName = names[0];
    setStatus('生成中...');
    try {
      const result = await runBackgroundJob('/sheet-ai-column/generate', {
        db_path: dbPath, prop: propName, entry_path: _ptAiEntityEntryPath(dbPath, entityName, pivotData),
      }, { operationKind: 'sheet-ai-column', operationLabel: `AIで生成: ${propName}`, successMessage: 'AIで生成しました' });
      if (typeof result?.value !== 'string') throw new Error(result?.error || 'AIの返答を受け取れませんでした');
      await _ptAiWriteCellValue(dbPath, ctx, entityName, propName, result.value);
      setStatus('');
      if (typeof showStatus === 'function') showStatus(`「${entityName}」の${propName}をAIで生成しました`);
    } catch (error) {
      setStatus('');
      if (error?.name !== 'AbortError' && typeof showStatus === 'function') showStatus('AIで生成できませんでした: ' + (error?.message || error), true);
    }
    return;
  }
  if (!await _ptAiConfirmBulk(dbPath, propName, names.length)) return;
  setStatus('生成中...');
  try {
    const result = await runBackgroundJob('/sheet-ai-column/run', {
      db_path: dbPath, prop: propName,
      entry_paths: names.map(name => _ptAiEntityEntryPath(dbPath, name, pivotData)).filter(Boolean),
    }, { operationKind: 'sheet-ai-column', operationLabel: `AIで生成: ${propName}（${names.length}件）` });
    setStatus('');
    const failed = Number(result?.failed || 0);
    if (typeof showStatus === 'function') {
      showStatus(`AIで${Number(result?.written || 0)}件生成しました` + (failed ? `（${failed}件失敗）` : ''), failed > 0);
    }
  } catch (error) {
    setStatus('');
    if (error?.name !== 'AbortError' && typeof showStatus === 'function') showStatus('AIで生成できませんでした: ' + (error?.message || error), true);
  } finally {
    if (globalThis.GbDbEntryIdentity && ctx) {
      try { await globalThis.GbDbEntryIdentity.reload(ctx, dbPath); } catch {}
    } else if (typeof selectDatabase === 'function') {
      try { await selectDatabase(dbPath, ctx, { silent: true, skipRecent: true, skipNavPush: true }); } catch {}
    }
  }
}

function _ptRenderAiAutofillSection(root, dbPath, propName, ctx) {
  if (!root || !dbPath || !propName || propName === '__entity__') return;
  if (root.querySelector('#pt-ai-autofill')) return;
  const anchor = root.querySelector('.pt-autosave-status:not([data-pt-memo-status])') || null;
  const type = typeof _ptReadUiType === 'function' ? _ptReadUiType(root) : ((getPropertyTypes(dbPath, ctx) || {})[propName]?.type || 'text');
  const holder = document.createElement('div');
  holder.innerHTML = _ptAiSectionHtml(dbPath, propName, ctx, type);
  const section = holder.firstElementChild;
  if (anchor) root.insertBefore(section, anchor);
  else root.appendChild(section);
  _ptBindAiAutofillSection(root, section, dbPath, propName, ctx);
}

function _ptBindAiAutofillSection(root, section, dbPath, propName, ctx) {
  const get = id => section.querySelector('#' + id);
  const status = section.querySelector('[data-pt-ai-status]');
  const body = get('pt-ai-body');
  let saved = _ptNormalizeAiAutofillConfig((getPropertyTypes(dbPath, ctx) || {})[propName]?.ai_autofill);
  let timer = null;
  let pending = null;
  const commit = () => {
    clearTimeout(timer);
    timer = null;
    const next = _ptCollectAiConfig(section, saved);
    const savedComparable = saved || _ptNormalizeAiAutofillConfig({});
    if (JSON.stringify(next) === JSON.stringify(savedComparable)) return pending || Promise.resolve(true);
    if (status) status.textContent = '保存中...';
    const run = (pending || Promise.resolve()).then(() => _ptSaveAiConfig(dbPath, propName, ctx, next))
      .then(() => {
        saved = next;
        const autoWanted = next.enabled && next.triggers.length;
        const appAuto = _ptAiSettingsCache?.settings?.auto_enabled === true;
        if (status) status.textContent = autoWanted && !appAuto && !_ptIsCloudSurface()
          ? '保存済み（全シート共通の自動生成がオフのため、自動では生成しません）'
          : '保存済み';
        return true;
      })
      .catch((error) => {
        if (status) status.textContent = '保存できませんでした';
        if (typeof showStatus === 'function') showStatus('AI自動生成の設定を保存できませんでした: ' + (error?.message || error), true);
        return false;
      });
    pending = run.finally(() => { if (pending === run) pending = null; });
    return run;
  };
  const schedule = (delay) => {
    if (status) status.textContent = '保存待ち...';
    clearTimeout(timer);
    timer = setTimeout(commit, delay);
  };
  section._ptAiFlush = commit;
  section.addEventListener('input', (event) => {
    if (event.target?.id === 'pt-ai-app-auto') return;
    schedule(700);
  });
  section.addEventListener('change', (event) => {
    if (event.target?.id === 'pt-ai-app-auto') return;
    if (event.target?.id === 'pt-ai-enabled' && body) body.hidden = !event.target.checked;
    schedule(150);
  });
  section.addEventListener('focusout', (event) => {
    if (section.contains(event.relatedTarget)) return;
    commit();
  });
  section.querySelectorAll('[data-pt-ai-ref]').forEach(btn => {
    btn.addEventListener('click', () => {
      const textarea = get('pt-ai-prompt');
      if (!textarea || textarea.readOnly) return;
      const text = '{' + (btn.dataset.ptAiRef || '') + '}';
      if (typeof _ptInsertFormulaText === 'function') _ptInsertFormulaText(textarea, text);
      else { textarea.value += text; textarea.dispatchEvent(new Event('input', { bubbles: true })); }
    });
  });
  section.querySelectorAll('[data-pt-ai-run]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      try { await _ptAiRun(btn.dataset.ptAiRun, dbPath, propName, ctx, section); }
      finally { btn.disabled = false; }
    });
  });
  const typeSelect = root.querySelector('#pt-type');
  typeSelect?.addEventListener('change', () => {
    const type = typeof _ptReadUiType === 'function' ? _ptReadUiType(root) : typeSelect.value;
    section.hidden = !PT_AI_SUPPORTED_TYPES.includes(type);
  });
  const previousFlush = root._ptFlushAutosave;
  root._ptFlushAutosave = async () => {
    await commit();
    if (typeof previousFlush === 'function') return previousFlush();
    return undefined;
  };
  // 使用できるAIの一覧と、全シート共通の自動生成の許可（デスクトップ版のみ）を後から読む。
  _ptLoadAiSettings(false).then((result) => {
    if (!result || !section.isConnected) return;
    const providerSelect = get('pt-ai-provider');
    if (providerSelect && document.activeElement !== providerSelect) {
      const current = providerSelect.value;
      providerSelect.innerHTML = _ptAiProviderOptionsHtml(current, result.providers);
    }
    const appToggle = get('pt-ai-app-auto');
    if (appToggle) {
      appToggle.checked = result.settings?.auto_enabled === true;
      appToggle.disabled = !!_ptColumnWriteBlockedMessage(dbPath, propName, ctx);
      appToggle.addEventListener('change', async () => {
        const wanted = appToggle.checked;
        appToggle.disabled = true;
        try {
          const saved = await apiPut('/sheet-ai-column/settings', { auto_enabled: wanted });
          _ptAiSettingsCache = { ...(_ptAiSettingsCache || {}), settings: saved?.settings || { auto_enabled: wanted } };
          _ptAiSettingsLoadedAt = Date.now();
          if (typeof showStatus === 'function') showStatus(wanted ? '全シート共通の自動生成を許可しました' : '全シート共通の自動生成をオフにしました');
        } catch (error) {
          appToggle.checked = !wanted;
          if (typeof showStatus === 'function') showStatus('自動生成の許可を変更できませんでした: ' + (error?.message || error), true);
        } finally {
          appToggle.disabled = false;
        }
      });
    }
  });
}

window.MeldexSheetAiColumn = Object.freeze({
  supportedTypes: PT_AI_SUPPORTED_TYPES.slice(),
  normalizeConfig: _ptNormalizeAiAutofillConfig,
  viewSettingsTargets: _ptViewSettingsTargets,
});
