/* タグパネルのタブ切替と、選択ファイルへの軽量なタグ割り当てUI。 */
(function () {
  'use strict';

  const TAB_STORAGE_KEY = 'meldex.tagPanel.activeTab.v1';
  const TAB_AUTO = 'auto-tag';
  const TAB_TREE = 'tag-tree';
  const TAG_MUTATION_DEBOUNCE_MS = 180;
  const pendingKeyCounts = new Map();
  const queuedMutationBatches = new Map();
  let savedTab = '';
  let treeRoot = null;
  let context = emptyContext();
  let requestRevision = 0;
  let filterRenderTimer = 0;
  let mutationQueue = Promise.resolve();

  function emptyContext() {
    return {
      signature: '',
      path: '',
      sourceFolder: '',
      selectionCount: 0,
      recursive: false,
      eligible: false,
      loading: false,
      loadFailed: false,
      catalogMutationBlocked: false,
      targetMutationBlocked: false,
      warning: '',
      assignedIds: new Set(),
      assignedNames: new Set(),
      tagsById: new Map(),
    };
  }

  function runtimeAvailable() {
    return window.isAutoTagRuntimeAvailable?.() === true;
  }

  function storedTab() {
    if (savedTab) return savedTab;
    try {
      const value = localStorage.getItem(TAB_STORAGE_KEY);
      savedTab = value === TAB_TREE || value === TAB_AUTO ? value : TAB_TREE;
    } catch (_) {
      savedTab = TAB_TREE;
    }
    return savedTab;
  }

  function activeTab() {
    return runtimeAvailable() ? storedTab() : TAB_TREE;
  }

  function setActiveTab(value, options) {
    const next = runtimeAvailable() && value === TAB_AUTO ? TAB_AUTO : TAB_TREE;
    savedTab = next;
    if (options?.persist !== false) {
      try { localStorage.setItem(TAB_STORAGE_KEY, next); } catch (_) {
        // 保存不能な埋め込み環境でも、現在のタブ切替は有効にする。
      }
    }
    return next;
  }

  function icon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 14) : '';
  }

  function createTabButton(value, label, iconName, onChange) {
    const button = document.createElement('button');
    const selected = activeTab() === value;
    button.type = 'button';
    button.className = 'gb-inner-tab gb-tag-panel-tab' + (selected ? ' gb-inner-tab-active' : '');
    button.dataset.tagPanelTab = value;
    button.dataset.e2eId = 'tag-panel-tab-' + value;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
    button.setAttribute('tabindex', selected ? '0' : '-1');
    button.innerHTML = '<span class="gb-inner-tab-icon">'
      + icon(iconName, 13)
      + '</span><span class="gb-inner-tab-label">'
      + label
      + '</span>';
    const activate = () => {
      if (activeTab() === value) return;
      setActiveTab(value);
      if (typeof onChange === 'function') onChange(value);
    };
    button.addEventListener('click', activate);
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = Array.from(button.parentElement?.querySelectorAll('[role="tab"]') || []);
      if (!buttons.length) return;
      let index = buttons.indexOf(button);
      if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = buttons.length - 1;
      else index = (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[index]?.click();
      buttons[index]?.focus();
    });
    return button;
  }

  function createTabBar(onChange) {
    if (!runtimeAvailable()) return null;
    const tabBar = document.createElement('div');
    tabBar.className = 'gb-tabbar gb-tag-panel-tabs';
    tabBar.dataset.e2eId = 'tag-panel-tabs';
    tabBar.setAttribute('role', 'tablist');
    tabBar.setAttribute('aria-label', 'タグパネルの表示');
    tabBar.append(
      createTabButton(TAB_TREE, 'タグツリー', 'list-tree', onChange),
      createTabButton(TAB_AUTO, '自動タグ付け', 'sparkles', onChange),
    );
    return tabBar;
  }

  function normalizedPath(value) {
    const resolved = window.MeldexTagPresetUI?.normalizeAutoTagTargetPath?.(value)
      || (typeof value === 'string' ? value.trim() : '');
    return String(resolved || '').trim();
  }

  function pathKey(value) {
    return normalizedPath(value).replace(/\\/g, '/').replace(/\/+$/g, '').toLocaleLowerCase('ja');
  }

  function normalizedTarget(target) {
    const targets = Array.isArray(target?.targets) ? target.targets : [];
    const first = targets[0] || target || {};
    const path = normalizedPath(first);
    const recursive = !!first?.recursive;
    return {
      path,
      recursive,
      selectionCount: targets.length || (path ? 1 : 0),
      eligible: !!path && (targets.length || 1) === 1 && !recursive,
    };
  }

  function assignedFromData(data) {
    const rows = Array.isArray(data?.tags) ? data.tags : [];
    return {
      ids: new Set(rows.map(tag => String(tag?.id || '')).filter(Boolean)),
      names: new Set(rows.map(tag => String(tag?.name || '').toLocaleLowerCase('ja')).filter(Boolean)),
    };
  }

  function applyTargetData(data) {
    const assigned = assignedFromData(data);
    context.assignedIds = assigned.ids;
    context.assignedNames = assigned.names;
    context.loading = !!data?._provisional;
    context.loadFailed = false;
    context.targetMutationBlocked = !!data?._provisional || !!data?.mutation_blocked;
    context.warning = String(data?.warning || context.warning || '');
    schedulePatch();
  }

  // タグの付け外し状態はスクロール中も含めて即座に見た目へ反映する必要があるため、
  // requestAnimationFrame によるバッチ遅延は使わず同期で塗り直す。非表示/非合成の
  // ブラウザ面ではrAFが発火しないことがあり、決定的な検証・実運用の両方で
  // 同期反映の方が安全（2026-08-14 タグツリー複数列化での見直し）。
  function schedulePatch() {
    patchVisibleTree();
  }

  function assignmentBlockedReason() {
    if (!context.path) return 'ファイルを1件選択してください';
    if (context.selectionCount !== 1) return 'タグを付け外しするファイルを1件だけ選択してください';
    if (context.recursive) return 'フォルダではなくファイルを1件選択してください';
    if (context.loading) return '選択ファイルのタグを読み込んでいます';
    if (context.loadFailed) return 'タグの読込に失敗したため、再読み込みしてください';
    if (!window.MeldexGlobalTags?.addTargetTag || !window.MeldexGlobalTags?.removeTargetTag) {
      return 'この実行環境ではファイルのタグを変更できません';
    }
    if (context.catalogMutationBlocked || context.targetMutationBlocked) {
      return context.warning || 'タグ辞書の同期競合を解消してください';
    }
    return '';
  }

  function isTagAssigned(tag) {
    const tagId = String(tag?.id || '');
    const tagName = String(tag?.name || '').toLocaleLowerCase('ja');
    return context.assignedIds.has(tagId) || context.assignedNames.has(tagName);
  }

  function isPending(key) {
    return Number(pendingKeyCounts.get(key) || 0) > 0;
  }

  function hasPendingForSignature(signature) {
    const prefix = String(signature || '') + '\n';
    for (const [key, count] of pendingKeyCounts) {
      if (count > 0 && key.startsWith(prefix)) return true;
    }
    return false;
  }

  // タグツリーの行に埋め込まれたタグチップ（[data-tag-assignment-id]付き）を、
  // 現在の付け外し状態・操作可否に合わせて塗り直す。チップの生成そのものは
  // gb-tag-management.js 側が担当し、ここでは既存要素のクラス/属性だけを更新する。
  function applyChipVisual(chip) {
    const tagId = String(chip.dataset.tagAssignmentId || '');
    const tagName = String(chip.dataset.tagAssignmentName || '');
    const assigned = context.assignedIds.has(tagId) || context.assignedNames.has(tagName.toLocaleLowerCase('ja'));
    const reason = assignmentBlockedReason();
    const pending = isPending(context.signature + '\n' + tagId);
    chip.classList.toggle('gb-tag-chip--assigned', assigned);
    chip.classList.toggle('gb-tag-chip--assignment-disabled', !!reason);
    chip.classList.toggle('gb-tag-chip--assignment-pending', pending);
    chip.setAttribute('aria-pressed', assigned ? 'true' : 'false');
    chip.setAttribute(
      'aria-label',
      reason
        ? `${tagName || 'タグ'}（${reason}）`
        : `${tagName || 'タグ'}を選択ファイルへ${assigned ? '外す' : '付ける'}`,
    );
  }

  function patchVisibleTree() {
    if (!treeRoot?.isConnected) return;
    treeRoot.querySelectorAll('[data-tag-assignment-id]').forEach(applyChipVisual);
    const status = treeRoot.querySelector('[data-tag-assignment-status]');
    if (!status) return;
    status.classList.toggle('is-error', context.loadFailed);
    if (!context.path) status.textContent = 'タグをクリックすると、選択中のファイルに付け外しできます。';
    else if (context.selectionCount !== 1) status.textContent = '複数選択中です。タグの付け外しはファイルを1件だけ選択してください。';
    else if (context.recursive) status.textContent = 'フォルダが選択されています。タグの付け外しはファイルを1件だけ選択してください。';
    else if (context.loading) status.textContent = '選択ファイルのタグを読み込んでいます…';
    else if (context.loadFailed) status.textContent = context.warning || 'タグを読み込めませんでした。再読み込みしてください。';
    else if (context.catalogMutationBlocked || context.targetMutationBlocked) {
      status.textContent = context.warning || 'タグ辞書の同期競合を解消してください。';
    }
    else status.textContent = 'ファイルを1件選択すると、タグをクリックで付け外しできます。';
  }

  async function refreshTarget(force) {
    const revision = ++requestRevision;
    const signature = context.signature;
    if (!context.eligible || !window.MeldexGlobalTags?.loadTargetTags) {
      context.loading = false;
      schedulePatch();
      return;
    }
    const cached = window.MeldexGlobalTags.getCachedTargetTagsSync?.(
      context.path,
      { sourceFolder: context.sourceFolder },
    );
    if (cached) applyTargetData(cached);
    else {
      context.loading = true;
      schedulePatch();
    }
    try {
      const data = await window.MeldexGlobalTags.loadTargetTags(context.path, {
        sourceFolder: context.sourceFolder,
        force: !!force,
      });
      if (revision !== requestRevision || signature !== context.signature) return;
      applyTargetData(data);
    } catch (error) {
      if (revision !== requestRevision || signature !== context.signature) return;
      context.loading = false;
      context.loadFailed = true;
      context.warning = String(error?.userMessage || error?.message || error || 'タグを読み込めませんでした');
      schedulePatch();
    }
  }

  function setTreeContext(options) {
    const target = normalizedTarget(options?.target || {});
    const sourceFolder = String(options?.sourceFolder || '').trim();
    const signature = `${pathKey(target.path)}\n${sourceFolder.toLocaleLowerCase('ja')}\n${target.selectionCount}\n${target.recursive ? 1 : 0}`;
    const tags = Array.isArray(options?.tags) ? options.tags : [];
    const sameTarget = signature === context.signature;
    context.tagsById = new Map(tags.map(tag => [String(tag?.id || ''), tag]));
    context.catalogMutationBlocked = !!options?.mutationBlocked;
    context.warning = String(options?.warning || '');
    if (sameTarget) {
      schedulePatch();
      if (context.loadFailed) refreshTarget(true);
      return;
    }
    requestRevision += 1;
    context = {
      ...emptyContext(),
      signature,
      path: target.path,
      sourceFolder,
      selectionCount: target.selectionCount,
      recursive: target.recursive,
      eligible: target.eligible,
      catalogMutationBlocked: !!options?.mutationBlocked,
      warning: String(options?.warning || ''),
      tagsById: new Map(tags.map(tag => [String(tag?.id || ''), tag])),
    };
    refreshTarget(false);
  }

  function createTargetStatus() {
    const status = document.createElement('div');
    status.className = 'gb-tag-assignment-status';
    status.dataset.tagAssignmentStatus = '1';
    status.setAttribute('role', 'status');
    return status;
  }

  function setAssigned(tag, checked) {
    const tagId = String(tag?.id || '');
    const tagName = String(tag?.name || '').toLocaleLowerCase('ja');
    if (checked) {
      if (tagId) context.assignedIds.add(tagId);
      if (tagName) context.assignedNames.add(tagName);
    } else {
      context.assignedIds.delete(tagId);
      context.assignedNames.delete(tagName);
    }
  }

  function pendingKey(signature, tag) {
    return String(signature || '') + '\n' + String(tag?.id || tag?.name || '');
  }

  function changePendingCount(key, delta) {
    const next = Number(pendingKeyCounts.get(key) || 0) + delta;
    if (next > 0) pendingKeyCounts.set(key, next);
    else pendingKeyCounts.delete(key);
  }

  function canUseBatchMutation(operations) {
    if (!window.MeldexGlobalTags?.updateTargetTags) return false;
    return operations.every(operation => {
      const scope = String(operation.tag?._dictionary_scope || '');
      return scope !== 'admin' && scope !== 'duplicate';
    });
  }

  async function executeMutationBatch(batch, operations) {
    if (canUseBatchMutation(operations)) {
      batch.usedBatchApi = true;
      return window.MeldexGlobalTags.updateTargetTags(batch.path, {
        add: operations.filter(operation => operation.checked).map(operation => operation.tag),
        remove: operations.filter(operation => !operation.checked).map(operation => operation.tag),
      }, { sourceFolder: batch.sourceFolder });
    }
    let result = null;
    for (const operation of operations) {
      result = operation.checked
        ? await window.MeldexGlobalTags.addTargetTag(batch.path, operation.tag)
        : await window.MeldexGlobalTags.removeTargetTag(batch.path, operation.tag);
    }
    return result;
  }

  function flushMutationBatch(batch) {
    if (queuedMutationBatches.get(batch.signature) !== batch) return;
    queuedMutationBatches.delete(batch.signature);
    clearTimeout(batch.timer);
    const operations = [...batch.operations.values()];
    if (!operations.length) return;

    mutationQueue = mutationQueue.catch(() => {}).then(async () => {
      batch.result = await executeMutationBatch(batch, operations);
    }).catch(error => {
      batch.failed = true;
      if (batch.signature === context.signature) {
        operations.forEach(operation => {
          const key = pendingKey(batch.signature, operation.tag);
          if (Number(pendingKeyCounts.get(key) || 0) === 1) {
            setAssigned(operation.tag, operation.initial);
          }
        });
        context.warning = String(error?.userMessage || error?.message || error || 'タグを保存できませんでした');
        if (typeof showStatus === 'function') showStatus(context.warning, true);
      }
    }).finally(() => {
      operations.forEach(operation => {
        changePendingCount(pendingKey(batch.signature, operation.tag), -1);
      });
      if (batch.signature !== context.signature) return;
      schedulePatch();
      if (hasPendingForSignature(batch.signature)) return;
      if (batch.failed) {
        // 失敗が連鎖した場合は各操作の楽観状態だけでは正しい復元先を
        // 決められないため、失敗時だけ保存済み状態を読み直す。
        refreshTarget(true);
      } else if (batch.usedBatchApi && batch.result) {
        context.warning = '';
        applyTargetData(batch.result);
      } else {
        refreshTarget(true);
      }
    });
  }

  function flushQueuedMutationBatches() {
    [...queuedMutationBatches.values()].forEach(flushMutationBatch);
  }

  function queueTagMutation(tag, checked) {
    const signature = context.signature;
    let batch = queuedMutationBatches.get(signature);
    if (!batch) {
      batch = {
        path: context.path,
        sourceFolder: context.sourceFolder,
        signature,
        operations: new Map(),
        timer: 0,
        usedBatchApi: false,
        result: null,
        failed: false,
      };
      queuedMutationBatches.set(signature, batch);
    }
    const operationKey = String(tag?.id || tag?.name || '');
    let operation = batch.operations.get(operationKey);
    if (!operation) {
      operation = { tag, initial: !checked, checked };
      batch.operations.set(operationKey, operation);
      changePendingCount(pendingKey(signature, tag), 1);
    } else {
      operation.tag = tag;
      operation.checked = checked;
    }
    setAssigned(tag, checked);
    if (operation.checked === operation.initial) {
      batch.operations.delete(operationKey);
      changePendingCount(pendingKey(signature, tag), -1);
    }
    clearTimeout(batch.timer);
    if (batch.operations.size) {
      batch.timer = setTimeout(() => flushMutationBatch(batch), TAG_MUTATION_DEBOUNCE_MS);
    } else {
      queuedMutationBatches.delete(signature);
    }
    schedulePatch();
  }

  // タグ行（チップ）のクリック/Enter/Spaceから呼ばれる、唯一の付け外し入口。
  // 対象が1件も選べていない・複数選択・フォルダ選択・読込中などは
  // assignmentBlockedReason() が理由を返し、その間は何も起きない。
  function toggleTagAssignment(tag) {
    if (!tag) return false;
    if (assignmentBlockedReason()) return false;
    queueTagMutation(tag, !isTagAssigned(tag));
    return true;
  }

  function mountTree(root) {
    treeRoot = root || null;
    schedulePatch();
  }

  function scheduleTreeFilterRender(callback) {
    clearTimeout(filterRenderTimer);
    filterRenderTimer = setTimeout(() => {
      filterRenderTimer = 0;
      if (typeof callback === 'function') callback();
    }, 90);
  }

  function handleTargetTagsChanged(event) {
    if (!context.eligible) return;
    if (pathKey(event?.detail?.path) !== pathKey(context.path)) return;
    if (hasPendingForSignature(context.signature)) return;
    if (event?.detail?.data) applyTargetData(event.detail.data);
    else refreshTarget(true);
  }

  function handleAutoTagJobFinished() {
    if (!context.eligible || hasPendingForSignature(context.signature)) return;
    refreshTarget(true);
  }

  window.addEventListener?.('meldex:target-tags-changed', handleTargetTagsChanged);
  window.addEventListener?.('pagehide', flushQueuedMutationBatches);
  window.addEventListener?.('beforeunload', flushQueuedMutationBatches);
  document.addEventListener?.('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushQueuedMutationBatches();
  });
  document.addEventListener?.('meldex:auto-tag-job-finished', handleAutoTagJobFinished);

  window.MeldexTagPanelTabs = {
    TAB_AUTO,
    TAB_TREE,
    activeTab,
    setActiveTab,
    createTabBar,
    setTreeContext,
    createTargetStatus,
    isTagAssigned,
    assignmentBlockedReason,
    toggleTagAssignment,
    mountTree,
    scheduleTreeFilterRender,
    refreshTarget: () => refreshTarget(true),
  };
})();
