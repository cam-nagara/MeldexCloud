/* gb-scheduler-proposals-api.js: shared Desktop/Cloud scheduler client state. */
(function () {
  'use strict';

  const CACHE = new Map();
  let capabilities = null;
  let proposals = [];
  let selectedId = '';
  let loading = null;

  function user() {
    return String((typeof getUsername === 'function' ? getUsername() : '') || 'anonymous').trim();
  }

  function rootPath() {
    return String(window.MeldexProductionApi?.rootPath?.() || window.MeldexProductionManagement?.rootPath || '');
  }

  function selectedKey() {
    const workspaceId = String(capabilities?.workspaceId || rootPath() || 'default');
    return `meldex:scheduler:selected:${workspaceId}:${user()}`;
  }

  function request(path, options = {}) {
    if (!window.MeldexDataAccess?.requestJson) return Promise.reject(new Error('スケジューラーを初期化できませんでした'));
    const method = String(options.method || 'GET').toUpperCase();
    const body = method === 'GET' ? undefined : {
      ...(options.body || {}), current_user: user(), root_path: rootPath(),
    };
    return window.MeldexDataAccess.requestJson(path, {
      method, body, timeoutMs: options.timeoutMs || 120000,
    }).catch(error => {
      if (Number(error?.status || 0) === 409) {
        error.userMessage = '別の環境で案が更新されています。再読み込みしてください';
      } else if (navigator.onLine === false || /offline|network|fetch/i.test(String(error?.message || ''))) {
        error.status = Number(error?.status || 503);
        error.code = error.code || 'scheduler_offline';
        error.userMessage = 'オフラインのため最新の案を確認できません。接続後にもう一度実行してください';
      }
      throw error;
    });
  }

  function query(values) {
    const params = new URLSearchParams();
    Object.entries(values || {}).forEach(([key, value]) => {
      if (value !== '' && value !== undefined && value !== null) params.set(key, String(value));
    });
    const text = params.toString();
    return text ? `?${text}` : '';
  }

  function remember(proposal) {
    if (!proposal?.id) return proposal;
    CACHE.set(String(proposal.id), proposal);
    const index = proposals.findIndex(item => item.id === proposal.id);
    if (index >= 0) proposals[index] = proposal;
    else proposals.unshift(proposal);
    return proposal;
  }

  function emit(reason) {
    document.dispatchEvent(new CustomEvent('meldex:scheduler-proposals-changed', {
      detail: { reason, selectedId, proposal: CACHE.get(selectedId) || null, proposals: proposals.slice() },
    }));
  }

  async function loadCapabilities(force = false) {
    if (capabilities && !force) return capabilities;
    capabilities = await request(`/scheduler/capabilities${query({ current_user: user(), root_path: rootPath() })}`);
    return capabilities;
  }

  async function capabilityPolicy() {
    return request(`/scheduler/capability-policy${query({ current_user: user(), root_path: rootPath() })}`);
  }

  async function patchCapabilityPolicy(patchValue, expectedRevision) {
    capabilities = null;
    return request('/scheduler/capability-policy', { method: 'PATCH', body: { patch: patchValue, expectedRevision } });
  }

  async function resetCapabilityPolicy(expectedRevision) {
    capabilities = null;
    return request('/scheduler/capability-policy/reset', { method: 'POST', body: { expectedRevision } });
  }

  async function listTemplates(includeArchived = false) {
    return request(`/scheduler/templates${query({ current_user: user(), root_path: rootPath(), include_archived: includeArchived })}`);
  }

  async function createTemplate(template) {
    return request('/scheduler/templates', { method: 'POST', body: { template } });
  }

  async function patchTemplate(template) {
    return request(`/scheduler/templates/${encodeURIComponent(template.id)}`, {
      method: 'PATCH', body: { patch: template.patch || {}, expectedRevision: template.storageRevision },
    });
  }

  async function cloneTemplate(id, name) {
    return request(`/scheduler/templates/${encodeURIComponent(id)}/clone`, { method: 'POST', body: { name } });
  }

  async function archiveTemplate(id, expectedRevision) {
    return request(`/scheduler/templates/${encodeURIComponent(id)}/archive`, { method: 'POST', body: { expectedRevision } });
  }

  async function projectSettings(id) {
    return request(`/scheduler/projects/${encodeURIComponent(id)}/settings${query({ current_user: user(), root_path: rootPath() })}`);
  }

  async function saveProjectSettings(id, patchValue, expectedRevision) {
    return request(`/scheduler/projects/${encodeURIComponent(id)}/settings`, {
      method: 'PUT', body: { patch: patchValue, expectedRevision },
    });
  }

  async function validateTask(body) {
    return request('/scheduler/tasks/validate', { method: 'POST', body });
  }

  async function list(force = false, includeArchived = false) {
    if (!force && proposals.length) return proposals.slice();
    if (loading) return loading;
    loading = request(`/scheduler/proposals${query({ current_user: user(), root_path: rootPath(), include_archived: includeArchived })}`)
      .then(result => {
        proposals = Array.isArray(result?.proposals) ? result.proposals.slice() : [];
        proposals.forEach(remember);
        const saved = localStorage.getItem(selectedKey()) || '';
        if (!proposals.some(item => item.id === selectedId)) {
          selectedId = proposals.some(item => item.id === saved) ? saved : '';
        }
        emit('list');
        return proposals.slice();
      }).finally(() => { loading = null; });
    return loading;
  }

  async function get(id, force = false) {
    const proposalId = String(id || '');
    if (!force && CACHE.has(proposalId)) return CACHE.get(proposalId);
    const result = await request(`/scheduler/proposals/${encodeURIComponent(proposalId)}${query({ current_user: user(), root_path: rootPath() })}`);
    return remember(result.proposal);
  }

  async function select(id) {
    const proposalId = String(id || '');
    const proposal = proposalId ? await get(proposalId) : null;
    selectedId = proposal?.id || '';
    if (selectedId) localStorage.setItem(selectedKey(), selectedId);
    else localStorage.removeItem(selectedKey());
    document.dispatchEvent(new CustomEvent('meldex:scheduler-proposal-selected', {
      detail: { proposalId: selectedId, proposal, preserveViewState: true },
    }));
    emit('select');
    return proposal;
  }

  async function createAllocation(body) {
    const result = await request('/scheduler/allocation/preview', {
      method: 'POST', body: { allowEstimateCompression: false, ...(body || {}) },
    });
    if (result?.cancelled) return result;
    remember(result.proposal);
    await select(result.proposal.id);
    emit('create');
    return result;
  }

  async function patch(id, values) {
    const current = await get(id);
    const result = await request(`/scheduler/proposals/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: { patch: values, expectedRevision: current.storageRevision },
    });
    remember(result.proposal);
    emit('patch');
    return result.proposal;
  }

  async function archive(id) {
    const current = await get(id);
    const result = await request(`/scheduler/proposals/${encodeURIComponent(id)}${query({
      current_user: user(), root_path: rootPath(), expected_revision: current.storageRevision,
    })}`, { method: 'DELETE' });
    CACHE.delete(id);
    proposals = proposals.filter(item => item.id !== id);
    if (selectedId === id) await select(proposals[0]?.id || '');
    emit('archive');
    return result.proposal;
  }

  async function branch(id, name) {
    const result = await request(`/scheduler/proposals/${encodeURIComponent(id)}/branch`, {
      method: 'POST', body: { name: name || '' },
    });
    remember(result.proposal);
    await select(result.proposal.id);
    emit('branch');
    return result.proposal;
  }

  async function recalculate(id, overrides = {}) {
    const result = await request(`/scheduler/proposals/${encodeURIComponent(id)}/recalculate`, {
      method: 'POST', body: { overrides }, timeoutMs: 120000,
    });
    remember(result.proposal);
    await select(result.proposal.id);
    emit('recalculate');
    return result.proposal;
  }

  async function compare(id, otherId) {
    return request(`/scheduler/proposals/${encodeURIComponent(id)}/compare/${encodeURIComponent(otherId)}${query({
      current_user: user(), root_path: rootPath(),
    })}`);
  }

  async function setPlacementFixed(id, placementKey, fixed) {
    const current = await get(id);
    const key = String(placementKey || '').trim();
    if (!key) throw new Error('固定する配置を特定できませんでした');
    const fixedPlacements = { ...(current.fixedPlacements || {}) };
    fixedPlacements[key] = !!fixed;
    return patch(id, { fixedPlacements });
  }

  async function listBaselines() {
    return request(`/scheduler/baselines${query({ current_user: user(), root_path: rootPath() })}`);
  }

  async function compareBaseline(baselineId, proposalId) {
    return request(`/scheduler/baselines/${encodeURIComponent(baselineId)}/compare/${encodeURIComponent(proposalId)}${query({
      current_user: user(), root_path: rootPath(),
    })}`);
  }

  async function adoptionPreview(id) {
    return request(`/scheduler/proposals/${encodeURIComponent(id)}/adoption/preview`, { method: 'POST' });
  }

  async function adopt(id) {
    const result = await request(`/scheduler/proposals/${encodeURIComponent(id)}/adoption/apply`, {
      method: 'POST', timeoutMs: 120000,
    });
    CACHE.delete(id);
    proposals = proposals.filter(item => item.id !== id);
    if (selectedId === id) await select(proposals[0]?.id || '');
    emit('adopt');
    document.dispatchEvent(new CustomEvent('meldex:production-task-updated', { detail: { reason: 'scheduler-adopt' } }));
    return result;
  }

  async function cancel(requestId) {
    return request('/scheduler/allocation/cancel', { method: 'POST', body: { requestId } });
  }

  window.MeldexSchedulerProposals = Object.freeze({
    loadCapabilities, capabilityPolicy, patchCapabilityPolicy, resetCapabilityPolicy,
    listTemplates, createTemplate, patchTemplate, cloneTemplate, archiveTemplate,
    projectSettings, saveProjectSettings, validateTask,
    list, get, select, createAllocation, patch, archive,
    branch, recalculate, compare, setPlacementFixed, listBaselines, compareBaseline,
    adoptionPreview, adopt, cancel,
    current: () => CACHE.get(selectedId) || null,
    selectedId: () => selectedId,
    cachedList: () => proposals.slice(),
    errorMessage: error => error?.userMessage || error?.message || String(error),
    _resetForTests() {
      capabilities = null; proposals = []; selectedId = ''; loading = null; CACHE.clear();
    },
  });
})();
