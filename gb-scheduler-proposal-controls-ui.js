/* gb-scheduler-proposal-controls-ui.js: placement fixing and shared baseline comparison. */
(function () {
  'use strict';

  const Api = () => window.MeldexSchedulerProposals;

  function status(message, error = false) {
    if (typeof showStatus === 'function') showStatus(message, error);
    else console[error ? 'error' : 'log'](message);
  }

  function icon(name) {
    const element = document.createElement('span'); element.className = 'gb-scheduler-icon';
    if (typeof lucide === 'function') element.innerHTML = lucide(name, 14);
    return element;
  }

  function button(label, iconName, handler, options = {}) {
    const element = document.createElement('button'); element.type = 'button';
    element.className = `gb-btn gb-btn-sm gb-scheduler-button${options.primary ? ' gb-btn-primary' : ''}`;
    element.append(icon(iconName), document.createTextNode(label)); element.disabled = !!options.disabled;
    if (options.e2eId) element.dataset.e2eId = options.e2eId;
    element.addEventListener('click', handler); return element;
  }

  function placementKey(placement) {
    return String(placement?.task_id || placement?.task_path || '').trim();
  }

  function placementRange(placement) {
    const direct = String(placement?.after_range || '').trim();
    if (direct) return direct.replace('|', '〜');
    if (placement?.start && placement?.end) return `${placement.start}〜${placement.end}`;
    return placement?.reason || '未配置';
  }

  function renderPlacements(host, proposal, caps, refresh) {
    const section = document.createElement('section'); section.className = 'gb-scheduler-placement-section';
    const heading = document.createElement('div'); heading.className = 'gb-scheduler-editor-heading';
    const title = document.createElement('strong'); title.textContent = '配置'; heading.appendChild(title); section.appendChild(heading);
    const placements = Array.isArray(proposal.placements) ? proposal.placements : [];
    const writable = caps.policy?.writable !== false && caps.allowed?.['scheduler.proposal.manage'] !== false;
    if (!placements.length) {
      const empty = document.createElement('p'); empty.className = 'gb-scheduler-panel-status'; empty.textContent = '配置はありません'; section.appendChild(empty); host.appendChild(section); return;
    }
    const list = document.createElement('div'); list.className = 'gb-scheduler-placement-list';
    placements.forEach((placement, index) => {
      const key = placementKey(placement); const fixed = !!proposal.fixedPlacements?.[key];
      const card = document.createElement('button'); card.type = 'button';
      card.className = `gb-scheduler-placement-card${fixed ? ' is-fixed' : ''}`;
      card.dataset.e2eId = `scheduler-placement-${index}`; card.dataset.placementKey = key;
      card.disabled = !writable || !key; card.setAttribute('aria-pressed', fixed ? 'true' : 'false');
      const name = document.createElement('strong'); name.textContent = placement.task_name || placement.task_id || '名称未設定のタスク';
      const range = document.createElement('span'); range.textContent = placementRange(placement);
      const assignee = document.createElement('span'); assignee.textContent = placement.user ? `担当: ${placement.user}` : '担当: 未割り当て';
      const action = document.createElement('span'); action.className = 'gb-scheduler-placement-action';
      action.append(icon(fixed ? 'unlock' : 'lock'), document.createTextNode(fixed ? '再計算に任せる' : 'この配置を固定'));
      card.append(name, range, assignee, action);
      card.addEventListener('click', async () => {
        card.disabled = true;
        try {
          await Api().setPlacementFixed(proposal.id, key, !fixed);
          status(fixed ? 'この配置を再計算の対象へ戻しました' : 'この配置を固定しました');
          await refresh();
        } catch (error) { card.disabled = false; status(Api().errorMessage(error), true); }
      });
      list.appendChild(card);
    });
    section.appendChild(list);
    if (Object.values(proposal.fixedPlacements || {}).some(Boolean)) {
      const recalc = document.createElement('div'); recalc.className = 'gb-scheduler-fixed-recalc';
      const text = document.createElement('p'); text.textContent = '固定した配置を維持して、残りを再計算できます。';
      recalc.append(text, button('固定を維持して再計算', 'refreshCw', async event => {
        const control = event.currentTarget; control.disabled = true;
        try { await Api().recalculate(proposal.id); status('固定した配置を維持して再計算しました'); await refresh(); }
        catch (error) { control.disabled = false; status(Api().errorMessage(error), true); }
      }, { primary: true, disabled: !caps.features?.proposalRecalculate || !writable, e2eId: 'scheduler-fixed-recalculate' }));
      section.appendChild(recalc);
    }
    host.appendChild(section);
  }

  async function renderBaselines(host, proposal, caps) {
    if (caps.features?.baselineCompare === false || caps.allowed?.['scheduler.baseline.manage'] === false) return;
    const section = document.createElement('section'); section.className = 'gb-scheduler-baseline-section';
    const title = document.createElement('strong'); title.textContent = '共有ベースラインとの比較';
    const loading = document.createElement('p'); loading.className = 'gb-scheduler-panel-status'; loading.textContent = 'ベースラインを読み込み中…';
    section.append(title, loading); host.appendChild(section);
    try {
      const result = await Api().listBaselines(); const baselines = result.baselines || [];
      if (!baselines.length) { loading.textContent = '比較できる共有ベースラインはありません'; return; }
      const select = document.createElement('select'); select.className = 'gb-select gb-select-sm'; select.dataset.e2eId = 'scheduler-baseline-selector';
      baselines.forEach(item => {
        const option = document.createElement('option'); option.value = item.id;
        const date = item.adoptedAt ? new Date(item.adoptedAt).toLocaleString() : '日時不明';
        option.textContent = `${item.name || item.proposalName || '採用時の計画'} — ${date}`; select.appendChild(option);
      });
      const output = document.createElement('p'); output.className = 'gb-scheduler-compare-summary'; output.setAttribute('role', 'status');
      const compare = button('現在案と比較', 'gitCompare', async () => {
        compare.disabled = true; output.textContent = '比較しています…';
        try {
          const diff = await Api().compareBaseline(select.value, proposal.id);
          output.textContent = diff.same ? '配置の差はありません' : `${diff.changes?.length || 0}件の配置に差があります`;
        } catch (error) { output.textContent = Api().errorMessage(error); output.classList.add('is-error'); }
        finally { compare.disabled = false; }
      }, { primary: true, e2eId: 'scheduler-baseline-compare' });
      const controls = document.createElement('div'); controls.className = 'gb-scheduler-baseline-controls'; controls.append(select, compare);
      loading.replaceWith(controls); section.appendChild(output);
    } catch (error) { loading.textContent = Api().errorMessage(error); loading.classList.add('is-error'); }
  }

  async function render(host, proposal, caps, refresh) {
    host.replaceChildren();
    if (!proposal?.id) return;
    renderPlacements(host, proposal, caps, refresh);
    await renderBaselines(host, proposal, caps);
  }

  window.MeldexSchedulerProposalControlsUi = Object.freeze({ render, _internal: { placementKey, placementRange } });
})();
