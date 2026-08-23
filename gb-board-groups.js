/* BoardGroup model, templates, line impact, and options-panel adapter. */
(function initMeldexBoardGroups(global) {
  'use strict';

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (!value || typeof value !== 'object') return value;
    const result = {};
    Object.keys(value).forEach((key) => { result[key] = clone(value[key]); });
    return result;
  }

  function refKey(value) {
    const ref = value?.topicRef || value;
    return JSON.stringify([String(ref?.sourceId || ''), String(ref?.topicId || '')]);
  }

  function uniqueRefs(values) {
    const refs = new Map();
    (Array.isArray(values) ? values : []).forEach((value) => {
      const ref = clone(value?.topicRef || value);
      if (ref?.sourceId && ref?.topicId && !refs.has(refKey(ref))) refs.set(refKey(ref), ref);
    });
    return [...refs.values()];
  }

  function normalizeGroup(value, idFactory) {
    const source = clone(value || {});
    source.groupId = String(source.groupId || source.id || idFactory?.('group') || '');
    if (!source.groupId) throw new TypeError('groupId is required');
    delete source.id;
    source.name = String(source.name || 'グループ');
    source.topicRefs = uniqueRefs(source.topicRefs || []);
    source.styleRef = source.styleRef == null ? null : String(source.styleRef);
    source.styleOverrides = clone(source.styleOverrides || source.style || {});
    source.locked = !!source.locked;
    source.collapsed = !!source.collapsed;
    if (Number.isFinite(+source.x)) source.x = +source.x;
    if (Number.isFinite(+source.y)) source.y = +source.y;
    if (Number.isFinite(+source.w)) source.w = Math.max(1, +source.w);
    if (Number.isFinite(+source.h)) source.h = Math.max(1, +source.h);
    return source;
  }

  function groupsOf(boardView) {
    return (Array.isArray(boardView?.groups) ? boardView.groups : []).map(normalizeGroup);
  }

  function createGroup(boardView, value, idFactory) {
    const result = clone(boardView || {});
    result.groups = groupsOf(result);
    const group = normalizeGroup(value, idFactory);
    if (result.groups.some((item) => item.groupId === group.groupId)) {
      throw new Error('groupId already exists');
    }
    result.groups.push(group);
    return { boardView: result, group: clone(group) };
  }

  function updateGroup(boardView, groupId, changes) {
    const result = clone(boardView || {});
    result.groups = groupsOf(result);
    const index = result.groups.findIndex((item) => item.groupId === groupId);
    if (index < 0) throw new RangeError('BoardGroup was not found');
    const current = result.groups[index];
    if (current.locked && changes?.locked !== false) throw new Error('locked BoardGroup cannot be edited');
    result.groups[index] = normalizeGroup({ ...current, ...clone(changes || {}), groupId });
    return result;
  }

  function moveGroup(boardView, groupId, delta) {
    const group = groupsOf(boardView).find((item) => item.groupId === groupId);
    if (!group) throw new RangeError('BoardGroup was not found');
    return updateGroup(boardView, groupId, {
      x: (Number(group.x) || 0) + (Number(delta?.x) || 0),
      y: (Number(group.y) || 0) + (Number(delta?.y) || 0),
    });
  }

  function resizeGroup(boardView, groupId, bounds) {
    const changes = {};
    ['x', 'y'].forEach((key) => {
      if (Number.isFinite(+bounds?.[key])) changes[key] = +bounds[key];
    });
    ['w', 'h'].forEach((key) => {
      if (Number.isFinite(+bounds?.[key])) changes[key] = Math.max(1, +bounds[key]);
    });
    return updateGroup(boardView, groupId, changes);
  }

  function endpointTargetsGroup(endpoint, groupId) {
    if (!endpoint || endpoint.targetKind !== 'group') return false;
    const target = endpoint.targetRef;
    return target === groupId || target?.groupId === groupId;
  }

  function lineImpactForGroup(lines, groupId) {
    return (Array.isArray(lines) ? lines : []).filter((line) => (
      endpointTargetsGroup(line?.fromEndpoint, groupId)
      || endpointTargetsGroup(line?.toEndpoint, groupId)
    )).map((line) => String(line.id || line.lineId || ''));
  }

  function planGroupRemoval(boardView, groupId) {
    const group = groupsOf(boardView).find((item) => item.groupId === groupId);
    if (!group) throw new RangeError('BoardGroup was not found');
    const affectedLineIds = lineImpactForGroup(boardView?.lines, groupId);
    return { group: clone(group), affectedLineIds, affectedLineCount: affectedLineIds.length,
      deletesTopicRecords: false, deletesLines: false };
  }

  function removeGroupFrame(boardView, groupId, options) {
    const plan = planGroupRemoval(boardView, groupId);
    if (plan.affectedLineCount && options?.confirmed !== true) {
      return { boardView: clone(boardView), removed: false, confirmationRequired: true, ...plan };
    }
    const result = clone(boardView || {});
    result.groups = groupsOf(result).filter((item) => item.groupId !== groupId);
    result.lines = clone(Array.isArray(result.lines) ? result.lines : []);
    return { boardView: result, removed: true, confirmationRequired: false, ...plan };
  }

  function normalizeLibraries(libraries) {
    const result = clone(libraries || {});
    result.file = Array.isArray(result.file) ? result.file : [];
    result.common = Array.isArray(result.common) ? result.common : [];
    return result;
  }

  function templateFromGroup(group, value) {
    const settings = value || {};
    return {
      templateId: String(settings.templateId),
      name: String(settings.name || group.name || 'グループテンプレート'),
      styleRef: group.styleRef,
      styleOverrides: clone(group.styleOverrides),
      locked: !!group.locked,
      collapsed: !!group.collapsed,
      updatedAt: settings.updatedAt || null,
    };
  }

  function normalizedTemplateName(value) {
    return String(value || '').trim().toLocaleLowerCase();
  }

  function assertUniqueTemplateName(libraries, scope, name, exceptTemplateId) {
    const wanted = normalizedTemplateName(name);
    if (!wanted) throw new TypeError('template name is required');
    const duplicate = normalizeLibraries(libraries)[scope].some((item) => (
      item.templateId !== exceptTemplateId && normalizedTemplateName(item.name) === wanted
    ));
    if (duplicate) throw new Error('同名のグループテンプレートは上書きできません');
  }

  function saveTemplate(libraries, scope, groupValue, options) {
    if (!['file', 'common'].includes(scope)) throw new TypeError('template scope is invalid');
    const result = normalizeLibraries(libraries);
    const group = normalizeGroup(groupValue);
    const makeId = options?.idFactory;
    const templateId = options?.templateId || makeId?.('group-template');
    if (!templateId) throw new TypeError('templateId is required');
    const template = templateFromGroup(group, { ...options, templateId });
    assertUniqueTemplateName(result, scope, template.name);
    result[scope].push(template);
    return { libraries: result, template: clone(template) };
  }

  function updateTemplate(libraries, scope, templateId, changes) {
    const result = normalizeLibraries(libraries);
    const index = result[scope]?.findIndex((item) => item.templateId === templateId) ?? -1;
    if (index < 0) throw new RangeError('group template was not found');
    if (Object.prototype.hasOwnProperty.call(changes || {}, 'name')) {
      assertUniqueTemplateName(result, scope, changes.name, templateId);
    }
    result[scope][index] = { ...result[scope][index], ...clone(changes || {}), templateId };
    delete result[scope][index].topicRefs;
    return result;
  }

  function duplicateTemplate(libraries, scope, templateId, options) {
    const source = normalizeLibraries(libraries)[scope]?.find((item) => item.templateId === templateId);
    if (!source) throw new RangeError('group template was not found');
    const group = normalizeGroup({ groupId: 'template-source', ...source });
    return saveTemplate(libraries, scope, group, {
      ...options, name: options?.name || `${source.name} のコピー`,
    });
  }

  function removeTemplate(libraries, scope, templateId) {
    const result = normalizeLibraries(libraries);
    const before = result[scope]?.length ?? 0;
    result[scope] = result[scope].filter((item) => item.templateId !== templateId);
    if (result[scope].length === before) throw new RangeError('group template was not found');
    return result;
  }

  function applyTemplate(boardView, groupId, template) {
    return updateGroup(boardView, groupId, {
      styleRef: template?.styleRef ?? null,
      styleOverrides: clone(template?.styleOverrides || {}),
      locked: !!template?.locked,
      collapsed: !!template?.collapsed,
    });
  }

  function renderOptionsTab(container, groupValue, callbacks) {
    if (!container?.appendChild) return null;
    const group = normalizeGroup(groupValue);
    const root = document.createElement('section');
    root.className = 'bd-group-options'; root.dataset.bdOptionsTab = 'group';
    const heading = document.createElement('h3'); heading.textContent = 'グループ'; root.appendChild(heading);
    [['名前', 'name', group.name], ['スタイル', 'styleRef', group.styleRef || '']].forEach(([label, key, value]) => {
      const field = document.createElement('label'); field.textContent = label;
      const input = document.createElement('input'); input.value = value;
      input.addEventListener('change', () => callbacks?.onChange?.(group.groupId, { [key]: input.value }));
      field.appendChild(input); root.appendChild(field);
    });
    container.replaceChildren(root);
    return root;
  }

  global.MeldexBoardGroups = Object.freeze({
    normalizeGroup, createGroup, updateGroup, moveGroup, resizeGroup,
    lineImpactForGroup, planGroupRemoval,
    removeGroupFrame, normalizeLibraries, saveTemplate, updateTemplate, duplicateTemplate,
    removeTemplate, applyTemplate, renderOptionsTab, assertUniqueTemplateName,
  });
}(typeof globalThis !== 'undefined' ? globalThis : window));
