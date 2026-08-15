/* gb-settings-ai-usage.js: AI API budget and administrator AI usage settings */
function _formatUsd(value) {
  const number = Number(value || 0);
  return '$' + number.toFixed(number >= 1 ? 2 : 4) + '（' + _formatApproxJpyFromUsd(number) + '）';
}

const CHAT_COST_USD_JPY_APPROX_RATE = 156;
function _formatApproxJpyFromUsd(value) {
  const amount = Number(value || 0) * CHAT_COST_USD_JPY_APPROX_RATE;
  if (!Number.isFinite(amount) || amount === 0) return '約0円';
  if (Math.abs(amount) < 1) return '約' + amount.toFixed(2).replace(/\.?0+$/, '') + '円';
  return '約' + Math.round(amount).toLocaleString('ja-JP') + '円';
}

const CHAT_COST_DEFAULTS = {
  monthly_budget_usd: 300,
  daily_budget_usd: 30,
  session_budget_usd: 100,
  max_concurrent_requests: 60,
  max_tool_iterations: 300,
  max_retry_attempts: 60,
  large_context_warning_tokens: 4800000,
  large_context_block_tokens: 6000000,
};

function _chatCostRoot(root) {
  const scope = root?.querySelector ? root : document;
  return scope?.matches?.('#chat-cost-settings-container') ? scope : scope.querySelector('#chat-cost-settings-container');
}

function _chatCostNumber(container, id, fallback) {
  const value = String(container?.querySelector?.('#' + id)?.value ?? '').trim();
  if (!value) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function _chatCostFallbackStatus() {
  return { settings: { ...CHAT_COST_DEFAULTS, pricing_last_reviewed: '' }, totals: { day: { cost_usd: 0 }, month: { cost_usd: 0 } } };
}

async function _chatCostLoadBudgetStatus(timeoutMs = 4500) {
  if (typeof apiFetch !== 'function') return _chatCostFallbackStatus();
  let timer = 0;
  const timeout = new Promise(resolve => { timer = window.setTimeout(() => resolve(null), timeoutMs); });
  try {
    const status = await Promise.race([apiFetch('/chat/budget'), timeout]);
    return status && typeof status === 'object' ? status : _chatCostFallbackStatus();
  } catch (_err) {
    return _chatCostFallbackStatus();
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

async function saveChatCostSettingsFromSettingsDialog(root, options = {}) {
  const container = _chatCostRoot(root);
  if (!container || !container.querySelector('#chat-budget-monthly')) return true;
  const statusEl = container.querySelector('#chat-budget-status');
  try {
    await apiPut('/chat/budget', {
      monthly_budget_usd: _chatCostNumber(container, 'chat-budget-monthly', CHAT_COST_DEFAULTS.monthly_budget_usd),
      daily_budget_usd: _chatCostNumber(container, 'chat-budget-daily', CHAT_COST_DEFAULTS.daily_budget_usd),
      session_budget_usd: _chatCostNumber(container, 'chat-budget-session', CHAT_COST_DEFAULTS.session_budget_usd),
      monthly_mode: container.querySelector('#chat-budget-monthly-mode')?.value || 'hard',
      daily_mode: container.querySelector('#chat-budget-daily-mode')?.value || 'hard',
      session_mode: container.querySelector('#chat-budget-session-mode')?.value || 'hard',
      max_concurrent_requests: _chatCostNumber(container, 'chat-budget-concurrency', CHAT_COST_DEFAULTS.max_concurrent_requests),
      max_tool_iterations: _chatCostNumber(container, 'chat-budget-tool-iterations', CHAT_COST_DEFAULTS.max_tool_iterations),
      max_retry_attempts: _chatCostNumber(container, 'chat-budget-retry-attempts', CHAT_COST_DEFAULTS.max_retry_attempts),
      large_context_warning_tokens: _chatCostNumber(container, 'chat-budget-large-warning', CHAT_COST_DEFAULTS.large_context_warning_tokens),
      large_context_block_tokens: _chatCostNumber(container, 'chat-budget-large-block', CHAT_COST_DEFAULTS.large_context_block_tokens),
    });
    if (statusEl) statusEl.textContent = '保存しました';
    if (typeof chatRefreshUsageBanner === 'function') chatRefreshUsageBanner();
    if (!options.silent && typeof showStatus === 'function') showStatus('AI使用量設定を保存しました', false, { showSaveDialog: true });
    return true;
  } catch (error) {
    if (statusEl) statusEl.textContent = '保存に失敗しました: ' + (error?.message || error);
    if (!options.silent && typeof showStatus === 'function') showStatus('AI使用量設定の保存に失敗しました: ' + (error?.message || error), true);
    return false;
  }
}

async function _loadWorkspaceCliConfigForAiUsageSummary() {
  try {
    const config = await apiFetch('/workspace-cli/config', { silentError: true });
    return config && typeof config === 'object' ? config : null;
  } catch {
    return null;
  }
}

function _workspaceCliAiUsageSummaryRowsHtml(rows, formatItem) {
  const list = Array.isArray(rows) ? rows : [];
  return list.length ? list.map(formatItem).join(' / ') : 'まだありません';
}

function _workspaceCliAiUsageSummarySectionHtml(config) {
  const summary = config?.ai_usage_summary;
  if (!summary) return '';
  const total = Number(summary.month_total_count || 0);
  const failures = Number(summary.month_failure_count || 0);
  const memberRows = _workspaceCliAiUsageSummaryRowsHtml(summary.top_members, item => `${esc(item?.member || '')} ${Number(item?.count || 0)}件`);
  const modelRows = _workspaceCliAiUsageSummaryRowsHtml(summary.top_models, item => `${esc(item?.model || '')} ${Number(item?.count || 0)}件`);
  return `
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('users',14)} 管理者AIの利用状況（今月） ${fieldHelp('ワークスペースタブから管理者PCへ依頼した回数です。メンバー個人のAPIキー・CLI利用（AIタブ）は含まれません。依頼内容や返答本文は表示されません。定額CLIのため費用は計算していません。')}</div>
        <div class="gb-section-desc">依頼: ${total}件${failures ? `（失敗 ${failures}件）` : ''}</div>
        <div class="gb-section-desc">メンバー別: ${memberRows}</div>
        <div class="gb-section-desc">モデル別: ${modelRows}</div>
        <div class="gb-field-row" style="justify-content:flex-start;margin-top:6px;"><button type="button" class="gb-btn gb-btn-sm" id="workspace-cli-ai-usage-open-sheet">${lucide('externalLink',14)} シートで開く</button></div>
      </section>`;
}

async function _openWorkspaceCliAiUsageSheet(sheetName) {
  if (typeof closeSettingsModalRestoringTheme === 'function') closeSettingsModalRestoringTheme();
  if (typeof showView === 'function') showView('database');
  if (typeof selectDatabase === 'function') await selectDatabase(sheetName || 'AI使用量');
}

async function renderChatCostSettings(root) {
  const container = (root?.querySelector ? root : document).querySelector('#chat-cost-settings-container');
  if (!container) return;
  container.innerHTML = `<section class="gb-section gb-section--boxed"><div class="gb-section-title">${lucide('walletCards',14)} AI使用量</div><div class="gb-section-desc">読み込み中...</div></section>`;
  try {
    const [status, workspaceCliConfig] = await Promise.all([_chatCostLoadBudgetStatus(), _loadWorkspaceCliConfigForAiUsageSummary()]);
    const settings = status.settings || {};
    const totals = status.totals || {};
    const modeOptions = value => ['hard', 'warn', 'off'].map(mode => {
      const label = mode === 'hard' ? 'ハード停止' : mode === 'warn' ? '警告のみ' : '無効';
      return `<option value="${mode}" ${String(value || 'hard') === mode ? 'selected' : ''}>${label}</option>`;
    }).join('');
    container.innerHTML = `
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('gauge',14)} AI API使用量 ${fieldHelp('Meldex本体の課金ではありません。登録したAI APIキーで各社APIを使った場合の推定使用量です。', { e2eId: 'settings-ai-usage-help' })}</div>
        <div class="gb-section-desc">今日: ${_formatUsd(totals.day?.cost_usd)} / 今月: ${_formatUsd(totals.month?.cost_usd)}</div>
        <div class="gb-section-desc">AI API単価表レビュー日: ${esc(settings.pricing_last_reviewed || '')}</div>
      </section>
      ${_workspaceCliAiUsageSummarySectionHtml(workspaceCliConfig)}
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('shieldAlert',14)} 予算上限</div>
        <label class="gb-field-row"><span class="gb-label">月次</span><input id="chat-budget-monthly" type="number" min="0" step="0.1" class="gb-input" style="width:100px;" value="${Number(settings.monthly_budget_usd ?? CHAT_COST_DEFAULTS.monthly_budget_usd)}"><select id="chat-budget-monthly-mode" class="gb-select">${modeOptions(settings.monthly_mode)}</select></label>
        <label class="gb-field-row"><span class="gb-label">日次</span><input id="chat-budget-daily" type="number" min="0" step="0.1" class="gb-input" style="width:100px;" value="${Number(settings.daily_budget_usd ?? CHAT_COST_DEFAULTS.daily_budget_usd)}"><select id="chat-budget-daily-mode" class="gb-select">${modeOptions(settings.daily_mode)}</select></label>
        <label class="gb-field-row"><span class="gb-label">1チャット</span><input id="chat-budget-session" type="number" min="0" step="0.1" class="gb-input" style="width:100px;" value="${Number(settings.session_budget_usd ?? CHAT_COST_DEFAULTS.session_budget_usd)}"><select id="chat-budget-session-mode" class="gb-select">${modeOptions(settings.session_mode)}</select></label>
        <label class="gb-field-row"><span class="gb-label">同時実行</span><input id="chat-budget-concurrency" type="number" min="1" max="120" step="1" class="gb-input" style="width:80px;" value="${Number(settings.max_concurrent_requests ?? CHAT_COST_DEFAULTS.max_concurrent_requests)}"><span class="gb-section-desc">件まで</span></label>
        <label class="gb-field-row"><span class="gb-label">ツールループ</span><input id="chat-budget-tool-iterations" type="number" min="5" max="600" step="1" class="gb-input" style="width:80px;" value="${Number(settings.max_tool_iterations ?? CHAT_COST_DEFAULTS.max_tool_iterations)}"><span class="gb-section-desc">回まで</span></label>
        <label class="gb-field-row"><span class="gb-label">リトライ</span><input id="chat-budget-retry-attempts" type="number" min="0" max="120" step="1" class="gb-input" style="width:80px;" value="${Number(settings.max_retry_attempts ?? CHAT_COST_DEFAULTS.max_retry_attempts)}"><span class="gb-section-desc">回まで</span></label>
        <label class="gb-field-row"><span class="gb-label">長文警告</span><input id="chat-budget-large-warning" type="number" min="0" step="1000" class="gb-input" style="width:120px;" value="${Number(settings.large_context_warning_tokens ?? CHAT_COST_DEFAULTS.large_context_warning_tokens)}"><span class="gb-section-desc">tokens</span></label>
        <label class="gb-field-row"><span class="gb-label">長文停止</span><input id="chat-budget-large-block" type="number" min="0" step="1000" class="gb-input" style="width:120px;" value="${Number(settings.large_context_block_tokens ?? CHAT_COST_DEFAULTS.large_context_block_tokens)}"><span class="gb-section-desc">tokens</span></label>
        <div class="gb-field-row" style="justify-content:flex-start;"><button type="button" class="gb-btn gb-btn-sm" id="chat-budget-save">${lucide('save',14)} 保存</button><button type="button" class="gb-btn gb-btn-sm gb-btn-danger" id="chat-budget-reset">${lucide('rotateCcw',14)} 使用量履歴をリセット</button></div>
        <div id="chat-budget-status" class="gb-section-desc"></div>
      </section>`;
    const statusEl = container.querySelector('#chat-budget-status');
    container.querySelector('#workspace-cli-ai-usage-open-sheet')?.addEventListener('click', () => _openWorkspaceCliAiUsageSheet(workspaceCliConfig?.ai_usage_sheet_name));
    container.querySelector('#chat-budget-save')?.addEventListener('click', () => saveChatCostSettingsFromSettingsDialog(container, { silent: false }));
    container.querySelector('#chat-budget-reset')?.addEventListener('click', async () => {
      const ok = typeof cfConfirm === 'function' ? await cfConfirm('LLM使用量履歴をリセットしますか？', { danger: true, okLabel: 'リセット' }) : confirm('LLM使用量履歴をリセットしますか？');
      if (!ok) return;
      await apiPost('/chat/usage/reset', {});
      statusEl.textContent = '使用量履歴をリセットしました';
      if (typeof renderChatCostSettings === 'function') renderChatCostSettings(root);
      if (typeof chatRefreshUsageBanner === 'function') chatRefreshUsageBanner();
    });
  } catch (error) {
    container.innerHTML = `<section class="gb-section gb-section--boxed"><div class="gb-section-title">${lucide('triangleAlert',14)} AI使用量</div><div class="gb-section-desc">読み込みに失敗しました: ${esc(error.message || error)}</div></section>`;
  }
}
