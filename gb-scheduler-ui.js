/* gb-scheduler-ui.js: neutral scheduler surfaces, proposals, and allocation flow. */
(function () {
  'use strict';

  const Api = () => window.MeldexSchedulerProposals;
  let toolbarObserver = null;
  const CAPABILITY_LABELS = Object.freeze({
    'scheduler.allocate': '自動割り当て',
    'scheduler.proposal.manage': '案の操作',
    'scheduler.adopt': '案の採用',
    'scheduler.baseline.manage': 'ベースライン',
    'scheduler.settings.manage': 'プロジェクト・タスク設定',
    'scheduler.policy.manage': '能力設定',
  });
  const ROLE_DEFAULTS = Object.freeze({
    admin: Object.keys(CAPABILITY_LABELS),
    schedule_manager: Object.keys(CAPABILITY_LABELS).filter(item => item !== 'scheduler.policy.manage'),
    member: [], viewer: [],
  });

  function status(message, error = false) {
    if (typeof showStatus === 'function') showStatus(message, error);
    else console[error ? 'error' : 'log'](message);
  }

  function icon(name, size = 14) {
    const span = document.createElement('span');
    span.className = 'gb-scheduler-icon';
    if (typeof lucide === 'function') span.innerHTML = lucide(name, size);
    return span;
  }

  function button(label, iconName, onClick, options = {}) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `gb-btn gb-btn-sm${options.primary ? ' gb-btn-primary' : ''} gb-scheduler-button`;
    if (iconName) element.appendChild(icon(iconName));
    element.appendChild(document.createTextNode(label));
    element.disabled = !!options.disabled;
    element.dataset.e2eId = options.e2eId || '';
    if (options.title) element.title = options.title;
    if (onClick) element.addEventListener('click', onClick);
    return element;
  }

  function field(label, control, help) {
    const wrap = document.createElement('label');
    wrap.className = 'gb-scheduler-field';
    const heading = document.createElement('span');
    heading.className = 'gb-scheduler-field-label';
    heading.textContent = label;
    if (help && typeof fieldHelp === 'function') heading.insertAdjacentHTML('beforeend', ` ${fieldHelp(help)}`);
    wrap.append(heading, control);
    return wrap;
  }

  function input(type, value, e2eId) {
    const control = document.createElement('input');
    control.type = type;
    control.value = value || '';
    control.className = 'gb-input gb-input-sm';
    if (e2eId) control.dataset.e2eId = e2eId;
    return control;
  }

  function modalVariant() {
    return window.matchMedia?.('(max-width: 700px)')?.matches ? 'mobile-sheet' : 'standard';
  }

  function confirmation(title, message, confirmLabel) {
    return new Promise(resolve => {
      const text = document.createElement('p');
      text.className = 'gb-scheduler-confirm-text';
      text.textContent = message;
      let settled = false;
      const modal = window.GBUI.createModal({
        title, body: text, variant: modalVariant(), extraClass: 'gb-scheduler-modal',
        onClose: () => { if (!settled) resolve(false); },
      }); modal.modal.dataset.e2eId = 'scheduler-confirmation-dialog';
      const cancel = button('キャンセル', 'x', () => { settled = true; modal.close('cancel'); resolve(false); }, { e2eId: 'scheduler-confirmation-cancel' });
      const confirm = button(confirmLabel, 'check', () => { settled = true; modal.close('confirm'); resolve(true); }, { primary: true, e2eId: 'scheduler-confirmation-confirm' });
      modal.footer.append(cancel, confirm);
      modal.modal.appendChild(modal.footer);
      modal.open();
    });
  }

  function proposalOption(proposal) {
    const option = document.createElement('option');
    option.value = proposal.id;
    option.textContent = proposal.name || '名称未設定の案';
    return option;
  }

  async function fillSelector(select, force = false) {
    const api = Api();
    if (!api) return;
    const previous = api.selectedId();
    try {
      const proposals = await api.list(force);
      select.replaceChildren();
      const confirmed = document.createElement('option');
      confirmed.value = '';
      confirmed.textContent = '確定版';
      select.appendChild(confirmed);
      proposals.forEach(proposal => select.appendChild(proposalOption(proposal)));
      select.value = proposals.some(item => item.id === previous) ? previous : '';
      select.disabled = false;
    } catch (error) {
      select.disabled = true;
      select.title = api.errorMessage(error);
    }
  }

  function createProposalSelector(options = {}) {
    const wrap = document.createElement('div');
    wrap.className = `gb-scheduler-proposal-selector${options.toolbar ? ' is-toolbar' : ''}`;
    const label = document.createElement('label');
    label.textContent = options.toolbar ? '表示案' : 'スケジュール案';
    const select = document.createElement('select');
    select.className = 'gb-select gb-select-sm';
    select.dataset.e2eId = options.e2eId || 'scheduler-proposal-selector';
    select.disabled = true;
    const loading = document.createElement('option');
    loading.textContent = '読み込み中…';
    select.appendChild(loading);
    select.addEventListener('change', async () => {
      const previous = Api().selectedId();
      try {
        await Api().select(select.value);
        syncAllSelectors();
      } catch (error) {
        select.value = previous;
        status(Api().errorMessage(error), true);
      }
    });
    label.appendChild(select);
    wrap.appendChild(label);
    fillSelector(select);
    return wrap;
  }

  function syncAllSelectors(force = false) {
    document.querySelectorAll('[data-e2e-id="scheduler-proposal-selector"], [data-e2e-id="scheduler-toolbar-proposal-selector"]')
      .forEach(select => fillSelector(select, force));
  }

  function today(offsetDays = 0) {
    const value = new Date();
    value.setDate(value.getDate() + offsetDays);
    return value.toISOString().slice(0, 10);
  }

  function selectedScope(paths) {
    const section = document.createElement('fieldset');
    section.className = 'gb-scheduler-scope-list';
    const legend = document.createElement('legend');
    legend.textContent = `選択中のタスク ${paths.length}件`;
    section.appendChild(legend);
    paths.forEach((path, index) => {
      const label = document.createElement('label');
      label.className = 'gb-check gb-scheduler-scope-item';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      checkbox.value = path;
      checkbox.dataset.e2eId = `scheduler-selected-task-${index}`;
      const name = String(path).split(/[\\/]/).pop()?.replace(/\.md$/i, '') || `タスク${index + 1}`;
      label.append(checkbox, document.createTextNode(name));
      section.appendChild(label);
    });
    return section;
  }

  function noSelectionScope() {
    const section = document.createElement('div');
    section.className = 'gb-scheduler-scope-grid';
    const from = input('date', today(), 'scheduler-scope-from');
    const to = input('date', today(14), 'scheduler-scope-to');
    const project = input('text', '', 'scheduler-scope-project');
    project.placeholder = 'すべてのプロジェクト';
    const assignee = input('text', '', 'scheduler-scope-assignee');
    assignee.placeholder = 'すべての担当者';
    const savedFilter = input('text', '', 'scheduler-scope-saved-filter');
    savedFilter.placeholder = '指定なし';
    section.append(
      field('開始日', from), field('終了日', to), field('プロジェクト', project),
      field('担当者', assignee), field('保存フィルター', savedFilter),
    );
    return section;
  }

  function allocationRequest(body, selectedPaths) {
    const request = {
      date_from: body.querySelector('[data-e2e-id="scheduler-scope-from"]')?.value || today(),
      date_to: body.querySelector('[data-e2e-id="scheduler-common-deadline"]')?.value
        || body.querySelector('[data-e2e-id="scheduler-scope-to"]')?.value || today(14),
      strategy: body.querySelector('[data-e2e-id="scheduler-strategy"]')?.value || 'recommended',
      allow_overtime: !!body.querySelector('[data-e2e-id="scheduler-allow-overtime"]')?.checked,
    };
    if (selectedPaths.length) {
      request.task_paths = [...body.querySelectorAll('.gb-scheduler-scope-item input:checked')].map(item => item.value);
    } else {
      const project = body.querySelector('[data-e2e-id="scheduler-scope-project"]')?.value.trim();
      const assignee = body.querySelector('[data-e2e-id="scheduler-scope-assignee"]')?.value.trim();
      const filter = body.querySelector('[data-e2e-id="scheduler-scope-saved-filter"]')?.value.trim();
      if (project) request.work_titles = [project];
      if (assignee) request.assignees = [assignee];
      if (filter) request.saved_filter = filter;
    }
    const estimate = Number(body.querySelector('[data-e2e-id="scheduler-common-estimate"]')?.value || 0);
    if (estimate > 0) request.default_estimate_hours = estimate;
    request.deadline_policy = body.querySelector('[data-e2e-id="scheduler-deadline-policy"]')?.value || 'preserve';
    return request;
  }

  async function openAutoAllocation(options = {}) {
    const selectedPaths = Array.isArray(options.selectedTaskPaths) ? options.selectedTaskPaths.filter(Boolean) : [];
    let capabilities;
    try { capabilities = await Api().loadCapabilities(); } catch (error) {
      status(Api().errorMessage(error), true); return null;
    }
    if (!capabilities.features?.allocationPreview || capabilities.allowed?.['scheduler.allocate'] === false) {
      status('現在の権限では自動割り当てを実行できません', true); return null;
    }
    const body = document.createElement('div');
    body.className = 'gb-scheduler-allocation-form';
    body.appendChild(selectedPaths.length ? selectedScope(selectedPaths) : noSelectionScope());
    const deadline = input('date', today(14), 'scheduler-common-deadline');
    const estimate = input('number', '', 'scheduler-common-estimate');
    estimate.min = '0.25'; estimate.step = '0.25'; estimate.placeholder = '既存値を使用';
    const deadlinePolicy = document.createElement('select');
    deadlinePolicy.className = 'gb-select gb-select-sm';
    deadlinePolicy.dataset.e2eId = 'scheduler-deadline-policy';
    [['preserve', '個別の期限を維持'], ['replace', '共通の期限で上書き']].forEach(([value, label]) => {
      const option = document.createElement('option'); option.value = value; option.textContent = label; deadlinePolicy.appendChild(option);
    });
    body.append(field('共通の期限', deadline), field('共通の見積時間', estimate), field('既存の期限', deadlinePolicy));
    const details = document.createElement('details');
    details.className = 'gb-scheduler-advanced';
    const summary = document.createElement('summary');
    summary.textContent = '割り当ての精度を上げる';
    const strategy = document.createElement('select');
    strategy.className = 'gb-select gb-select-sm'; strategy.dataset.e2eId = 'scheduler-strategy';
    [['recommended', '推奨'], ['earliest_completion', '最短完了'], ['load_balance', '負荷均等'], ['minimize_overtime', '残業最小'], ['minimize_fragmentation', '分断最小'], ['deadline_margin', '締切余裕'], ['minimize_assignee_changes', '担当変更最小']]
      .forEach(([value, label]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; strategy.appendChild(option); });
    const overtimeLabel = document.createElement('label');
    overtimeLabel.className = 'gb-check';
    const overtime = document.createElement('input'); overtime.type = 'checkbox'; overtime.dataset.e2eId = 'scheduler-allow-overtime';
    overtimeLabel.append(overtime, document.createTextNode('残業を候補に含める'));
    details.append(summary, field('戦略', strategy), overtimeLabel);
    body.appendChild(details);
    const progress = document.createElement('div');
    progress.className = 'gb-scheduler-progress'; progress.hidden = true; progress.setAttribute('role', 'status');
    body.appendChild(progress);

    const modal = window.GBUI.createModal({
      title: '自動割り当て', body, variant: modalVariant(), extraClass: 'gb-scheduler-modal',
      returnFocus: options.trigger,
    }); modal.modal.dataset.e2eId = 'scheduler-allocation-dialog';
    const cancel = button('キャンセル', 'x', () => modal.close('cancel'));
    const run = button('案を作成', 'sparkles', async () => {
      const request = allocationRequest(body, selectedPaths);
      if (selectedPaths.length && !request.task_paths.length) {
        status('対象にするタスクを1件以上選んでください', true); return;
      }
      run.disabled = true; cancel.disabled = true; progress.hidden = false;
      progress.textContent = '案を作成しています…';
      const requestId = `allocation-${Date.now().toString(36)}`;
      const stop = button('処理を中止', 'square', async () => {
        stop.disabled = true;
        try { await Api().cancel(requestId); } catch { /* request result reports the failure */ }
      }, { e2eId: 'scheduler-allocation-cancel' });
      progress.appendChild(stop);
      try {
        const result = await Api().createAllocation({ ...request, requestId });
        if (result.cancelled) status('自動割り当てを中止しました');
        else status(`${result.proposal.name}を作成しました`);
        modal.close('complete');
        syncAllSelectors(true);
      } catch (error) {
        progress.textContent = Api().errorMessage(error);
        progress.classList.add('is-error');
        run.disabled = false; cancel.disabled = false;
      }
    }, { primary: true, e2eId: 'scheduler-allocation-create' });
    modal.footer.append(cancel, run);
    modal.modal.appendChild(modal.footer);
    modal.open();
    return modal;
  }

  async function renameCurrent() {
    const current = Api().current();
    if (!current) return;
    const name = input('text', current.name, 'scheduler-proposal-name');
    const body = field('案の名前', name);
    const modal = window.GBUI.createModal({ title: '案の名前を変更', body, variant: modalVariant(), extraClass: 'gb-scheduler-modal' }); modal.modal.dataset.e2eId = 'scheduler-rename-dialog';
    const cancel = button('キャンセル', 'x', () => modal.close('cancel'), { e2eId: 'scheduler-rename-cancel' });
    const save = button('変更する', 'check', async () => {
      const next = name.value.trim();
      if (!next) return name.focus();
      save.disabled = true;
      try { await Api().patch(current.id, { name: next }); modal.close('save'); syncAllSelectors(true); }
      catch (error) { save.disabled = false; status(Api().errorMessage(error), true); }
    }, { primary: true, e2eId: 'scheduler-rename-save' });
    modal.footer.append(cancel, save); modal.modal.appendChild(modal.footer); modal.open();
  }

  async function compareCurrent() {
    const current = Api().current();
    const candidates = Api().cachedList().filter(item => item.id !== current?.id);
    if (!current || !candidates.length) return status('比較できる別の案がありません', true);
    const select = document.createElement('select');
    select.className = 'gb-select'; candidates.forEach(item => select.appendChild(proposalOption(item)));
    const body = field('比較する案', select);
    const modal = window.GBUI.createModal({ title: '案を比較', body, variant: modalVariant(), extraClass: 'gb-scheduler-modal' }); modal.modal.dataset.e2eId = 'scheduler-compare-dialog';
    const cancel = button('閉じる', 'x', () => modal.close('cancel'), { e2eId: 'scheduler-compare-cancel' });
    const compare = button('比較する', 'gitCompare', async () => {
      compare.disabled = true;
      try {
        const result = await Api().compare(current.id, select.value);
        body.replaceChildren();
        const summary = document.createElement('p');
        summary.className = 'gb-scheduler-compare-summary';
        summary.textContent = result.same ? '配置の差はありません' : `${result.changes.length}件の配置に差があります`;
        body.appendChild(summary);
      } catch (error) { compare.disabled = false; status(Api().errorMessage(error), true); }
    }, { primary: true, e2eId: 'scheduler-compare-run' });
    modal.footer.append(cancel, compare); modal.modal.appendChild(modal.footer); modal.open();
  }

  async function adoptCurrent() {
    const current = Api().current();
    if (!current) return;
    try {
      const preview = await Api().adoptionPreview(current.id);
      if (!preview.canApply) return status(preview.conflicts?.[0]?.message || 'この案は採用できません', true);
      const ok = await confirmation('案を採用', `確定版へ${preview.diff?.changes?.length || 0}件の変更を反映します。`, '採用する');
      if (!ok) return;
      await Api().adopt(current.id);
      status('案を確定版へ反映しました');
      syncAllSelectors(true);
    } catch (error) { status(Api().errorMessage(error), true); }
  }

  async function archiveCurrent() {
    const current = Api().current();
    if (!current) return;
    const ok = await confirmation('案を保管', `${current.name || 'この案'}を検討中の一覧から外します。`, '保管する');
    if (!ok) return;
    try { await Api().archive(current.id); syncAllSelectors(true); }
    catch (error) { status(Api().errorMessage(error), true); }
  }

  async function renderAllocation(host) {
    host.replaceChildren();
    const selector = createProposalSelector();
    const summary = document.createElement('div');
    summary.className = 'gb-scheduler-current-summary';
    const actions = document.createElement('div');
    actions.className = 'gb-scheduler-proposal-actions';
    const proposalDetails = document.createElement('div');
    proposalDetails.className = 'gb-scheduler-proposal-details';
    host.append(selector, summary, actions, proposalDetails);
    async function refresh() {
      let caps;
      try { caps = await Api().loadCapabilities(); await Api().list(); }
      catch (error) { summary.textContent = Api().errorMessage(error); summary.classList.add('is-error'); return; }
      const current = Api().current();
      summary.textContent = current
        ? `${current.metrics?.scheduled || 0}件配置・${current.metrics?.unassigned || 0}件未配置`
        : '確定版を表示しています';
      actions.replaceChildren();
      proposalDetails.replaceChildren();
      if (!current) return;
      const product = current.productSummary || {};
      const progress = product.progress || {};
      const cost = product.cost || {};
      const metricsLine = document.createElement('p');
      metricsLine.className = 'gb-scheduler-panel-status';
      metricsLine.dataset.e2eId = 'scheduler-progress-cost';
      const progressText = Number.isFinite(progress.total)
        ? `進捗 ${progress.completed || 0}/${progress.total}件`
        : '進捗 未算出';
      const plannedText = Number.isFinite(cost.planned)
        ? `予定コスト ${Number(cost.planned).toLocaleString('ja-JP')}円`
        : '予定コスト 単価未設定';
      const actualText = Number.isFinite(cost.actual)
        ? `実績コスト ${Number(cost.actual).toLocaleString('ja-JP')}円`
        : `実績コスト 未算出（${cost.actualUnavailableReason || '勤怠実績時間を取得できません'}）`;
      metricsLine.textContent = `${progressText}・${plannedText}・${actualText}`;
      const writable = caps.policy?.writable !== false && caps.allowed?.['scheduler.proposal.manage'] !== false;
      actions.append(
        button('名前を変更', 'pencil', renameCurrent, { disabled: !writable, e2eId: 'scheduler-proposal-rename' }),
        button('分岐', 'gitBranch', async () => {
          try { await Api().branch(current.id); syncAllSelectors(true); } catch (error) { status(Api().errorMessage(error), true); }
        }, { disabled: !caps.features?.proposalBranch, e2eId: 'scheduler-proposal-branch' }),
        button('現在の情報で再計算', 'refreshCw', async () => {
          try { await Api().recalculate(current.id); syncAllSelectors(true); } catch (error) { status(Api().errorMessage(error), true); }
        }, { disabled: !caps.features?.proposalRecalculate, e2eId: 'scheduler-proposal-recalculate' }),
        button('比較', 'gitCompare', compareCurrent, { disabled: !caps.features?.proposalCompare, e2eId: 'scheduler-proposal-compare' }),
        button('採用', 'checkCircle', adoptCurrent, { primary: true, disabled: !caps.features?.adoptionApply || caps.allowed?.['scheduler.adopt'] === false, e2eId: 'scheduler-proposal-adopt' }),
        button('保管', 'archive', archiveCurrent, { disabled: !writable, e2eId: 'scheduler-proposal-archive' }),
      );
      await window.MeldexSchedulerProposalControlsUi?.render?.(proposalDetails, current, caps, refresh);
      proposalDetails.prepend(metricsLine);
    }
    refresh();
    host.__schedulerRefresh = refresh;
  }

  async function renderProject(host, component, apiOverride) {
    const client = apiOverride || Api();
    host.replaceChildren();
    const context = component?._productionTaskContext?.() || {};
    const projectId = String(context.workTitle || '').trim();
    const open = button('プロジェクト一覧を開く', 'folderKanban', () => component?._selectProductionTab?.('works'), { primary: true });
    const policyHost = document.createElement('section');
    policyHost.className = 'gb-scheduler-capability-policy';
    await renderCapabilityPolicy(policyHost, client);
    if (!projectId) {
      const text = document.createElement('p'); text.className = 'gb-scheduler-panel-status';
      text.textContent = 'プロジェクトを選ぶと設定を表示します';
      host.append(text, open, policyHost); return;
    }
    const loading = document.createElement('p'); loading.className = 'gb-scheduler-panel-status'; loading.textContent = '読み込み中…';
    host.append(loading, open);
    try {
      const [settingsResult, templatesResult, caps] = await Promise.all([
        client.projectSettings(projectId), client.listTemplates(), client.loadCapabilities(),
      ]);
      const selector = document.createElement('select'); selector.className = 'gb-select gb-select-sm';
      (templatesResult.templates || []).forEach(template => {
        const option = document.createElement('option'); option.value = template.id; option.textContent = template.name;
        selector.appendChild(option);
      });
      selector.value = settingsResult.settings.primaryTemplateId;
      const save = button('設定を保存', 'check', async () => {
        save.disabled = true;
        try {
          await client.saveProjectSettings(projectId, { primaryTemplateId: selector.value }, settingsResult.storageRevision);
          status('プロジェクト設定を保存しました');
        } catch (error) { save.disabled = false; status(client.errorMessage(error), true); }
      }, { primary: true, disabled: caps.allowed?.['scheduler.settings.manage'] === false });
      host.replaceChildren(field('主テンプレート', selector), save, open, policyHost);
    } catch (error) {
      loading.textContent = client.errorMessage(error); loading.classList.add('is-error');
    }
  }

  async function renderCapabilityPolicy(host, apiOverride) {
    const client = apiOverride || Api();
    host.replaceChildren();
    const heading = document.createElement('strong'); heading.textContent = 'ワークスペースの能力';
    const loading = document.createElement('p'); loading.className = 'gb-scheduler-panel-status'; loading.textContent = '能力設定を読み込み中…';
    host.append(heading, loading);
    try {
      const caps = await client.loadCapabilities();
      if (caps.allowed?.['scheduler.policy.manage'] === false) {
        loading.textContent = `現在の役割: ${caps.actor?.role || '閲覧'}`;
        const restricted = document.createElement('p');
        restricted.className = 'gb-scheduler-panel-status';
        restricted.dataset.e2eId = 'scheduler-capability-history-restricted';
        restricted.textContent = '能力設定の履歴は管理権限があるユーザーのみ確認できます';
        host.appendChild(restricted);
        return;
      }
      let result = await client.capabilityPolicy();
      const historyView = policy => {
        const section = document.createElement('section');
        section.className = 'gb-scheduler-capability-history';
        section.dataset.e2eId = 'scheduler-capability-history';
        const title = document.createElement('strong'); title.textContent = '最近の変更';
        const records = Array.isArray(policy?.history) ? policy.history.slice(-5).reverse() : [];
        section.appendChild(title);
        if (!records.length) {
          const empty = document.createElement('p'); empty.className = 'gb-scheduler-panel-status';
          empty.dataset.e2eId = 'scheduler-capability-history-empty'; empty.textContent = '変更履歴はまだありません';
          section.appendChild(empty); return section;
        }
        records.forEach((record, index) => {
          const row = document.createElement('details'); row.className = 'gb-scheduler-capability-history-row';
          row.dataset.e2eId = `scheduler-capability-history-row-${index}`;
          const summary = document.createElement('summary');
          const actor = String(record?.actor || '不明');
          const changedAt = String(record?.changedAt || '');
          summary.textContent = `${actor} ・ ${changedAt ? new Date(changedAt).toLocaleString('ja-JP') : '時刻不明'}`;
          summary.dataset.gbTooltip = '変更前後の能力設定を表示します';
          const detail = document.createElement('pre');
          detail.textContent = `変更前\n${JSON.stringify(record?.before || {}, null, 2)}\n変更後\n${JSON.stringify(record?.after || {}, null, 2)}`;
          row.append(summary, detail); section.appendChild(row);
        });
        return section;
      };
      const grid = document.createElement('div'); grid.className = 'gb-scheduler-capability-grid';
      const controls = new Map();
      [['admin', '管理者'], ['schedule_manager', 'スケジュール管理者'], ['member', 'メンバー'], ['viewer', '閲覧']].forEach(([role, label]) => {
        const row = document.createElement('fieldset'); row.className = 'gb-scheduler-capability-role';
        row.dataset.e2eId = `scheduler-capability-role-${role}`;
        const legend = document.createElement('legend'); legend.textContent = label; row.appendChild(legend);
        const roleControls = new Map(); controls.set(role, roleControls);
        Object.entries(CAPABILITY_LABELS).forEach(([capability, capabilityLabel]) => {
          const item = document.createElement('label'); item.className = 'gb-check';
          const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
          const override = result.policy?.roleOverrides?.[role]?.[capability];
          checkbox.checked = typeof override === 'boolean' ? override : ROLE_DEFAULTS[role].includes(capability);
          checkbox.dataset.capability = capability; roleControls.set(capability, checkbox);
          item.append(checkbox, document.createTextNode(capabilityLabel)); row.appendChild(item);
        });
        grid.appendChild(row);
      });
      const actions = document.createElement('div'); actions.className = 'gb-scheduler-proposal-actions';
      const save = button('能力を保存', 'shieldCheck', async () => {
        save.disabled = true;
        const roleOverrides = {};
        controls.forEach((items, role) => {
          roleOverrides[role] = Object.fromEntries([...items].map(([capability, checkbox]) => [capability, checkbox.checked]));
        });
        try {
          await client.patchCapabilityPolicy({ roleOverrides }, result.storageRevision);
          result = await client.capabilityPolicy();
          await renderCapabilityPolicy(host, client);
          status('能力設定を保存しました');
        } catch (error) { status(client.errorMessage(error), true); }
        finally { save.disabled = false; }
      }, { primary: true });
      save.dataset.e2eId = 'scheduler-capability-save';
      const reset = button('既定に戻す', 'rotateCcw', async () => {
        if (!await confirmation('能力設定を既定に戻す', '管理者とスケジュール管理者を中心とした既定の能力へ戻します。', '既定に戻す')) return;
        reset.disabled = true;
        try { await client.resetCapabilityPolicy(result.storageRevision); await renderCapabilityPolicy(host, client); status('能力設定を既定に戻しました'); }
        catch (error) { reset.disabled = false; status(client.errorMessage(error), true); }
      });
      actions.append(save, reset);
      host.replaceChildren(heading, grid, actions, historyView(result.policy));
    } catch (error) {
      loading.textContent = client.errorMessage(error); loading.classList.add('is-error');
    }
  }

  async function renderTaskSettings(host, component) {
    return window.MeldexSchedulerSettingsUi?.render?.(host, component);
  }

  function renderCalendar(host, component) {
    host.replaceChildren();
    if (typeof component?._renderCalendarSettingsPanel === 'function') {
      component._renderCalendarSettingsPanel(host);
      return;
    }
    const message = document.createElement('p');
    message.className = 'gb-scheduler-panel-status';
    message.textContent = 'カレンダー表示を読み込んでください';
    host.appendChild(message);
  }

  function injectToolbarSelectors() {
    document.querySelectorAll('.gb-toolbar-cal').forEach(toolbar => {
      if (toolbar.querySelector('[data-scheduler-toolbar-selector]')) return;
      const selector = createProposalSelector({ toolbar: true, e2eId: 'scheduler-toolbar-proposal-selector' });
      selector.dataset.schedulerToolbarSelector = '1';
      const anchor = toolbar.querySelector('[data-cal-action="recalculate"]');
      if (anchor) anchor.before(selector);
      else toolbar.querySelector('.gb-cal-toolbar-actions')?.prepend(selector);
    });
  }

  function install() {
    const original = window.openProductionRecalculate;
    window.openProductionRecalculateLegacy = original;
    window.openProductionRecalculate = openAutoAllocation;
    injectToolbarSelectors();
    toolbarObserver = new MutationObserver(injectToolbarSelectors);
    toolbarObserver.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('meldex:scheduler-proposals-changed', event => {
      syncAllSelectors();
      document.querySelectorAll('.gb-production-sidebar-content').forEach(host => host.__schedulerRefresh?.(event));
    });
  }

  window.MeldexSchedulerUi = Object.freeze({
    openAutoAllocation, createProposalSelector, renderAllocation, renderProject,
    renderTaskSettings, renderCalendar, syncAllSelectors,
    _internal: { allocationRequest, selectedScope, noSelectionScope },
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
