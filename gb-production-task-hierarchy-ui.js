/* Parent-task and checklist controls for production task details. */
(function () {
  'use strict';

  function parseChecklist(value) {
    try {
      const rows = JSON.parse(String(value || '[]'));
      if (!Array.isArray(rows)) throw new Error('チェックリストは配列である必要があります');
      const seen = new Set();
      return rows.filter(row => row && typeof row === 'object').map((row, index) => ({
        ...row,
        id: String(row.id || `check-${index + 1}`),
        text: String(row.text || row.label || ''),
        done: row.done === true,
      })).filter(row => row.text.trim() && !seen.has(row.id) && seen.add(row.id));
    } catch (error) {
      throw new Error(`チェックリストの保存データが不正です: ${error?.message || error}`);
    }
  }

  function create(options = {}) {
    const root = document.createElement('fieldset');
    root.className = 'gb-production-task-hierarchy';
    root.dataset.e2eId = 'gb-production-task-hierarchy';
    const legend = document.createElement('legend');
    legend.textContent = '親タスクとチェック項目';
    const parentLabel = document.createElement('label');
    parentLabel.textContent = '親タスク';
    const parent = document.createElement('select');
    parent.className = 'gb-input';
    parent.dataset.e2eId = 'gb-production-parent-task';
    parent.dataset.loading = '1';
    parent.appendChild(new Option('親タスクなし', ''));
    const currentParent = String(options.parentValue || '');
    if (currentParent) {
      parent.appendChild(new Option('現在の親タスク（読み込み中）', currentParent));
      parent.value = currentParent;
    }
    parentLabel.appendChild(parent);
    const list = document.createElement('div');
    list.className = 'gb-production-checklist';
    list.dataset.e2eId = 'gb-production-checklist';
    const originalChecklistValue = String(options.checklistValue || '');
    let checklistError = '';
    let rows = [];
    try { rows = parseChecklist(originalChecklistValue); }
    catch (error) { checklistError = String(error?.message || error); }
    const rowId = String(options.rowId || 'task');
    const safeRowId = rowId.replace(/[^a-zA-Z0-9_-]+/g, '-');
    let nextChecklistSequence = rows.reduce((max, row) => {
      const match = String(row.id).match(/-(\d+)$/);
      return Math.max(max, match ? Number(match[1]) : 0);
    }, 0) + 1;
    let parentLoadFailed = false;

    function prop(row, name) {
      const value = row?.[name] ?? row?.properties?.[name] ?? row?.props?.[name];
      if (Array.isArray(value)) return value[0]?.value ?? value[0] ?? '';
      return value ?? '';
    }

    function scopeKey(path) {
      const normalized = String(path || '').replace(/\\/g, '/');
      return normalized.slice(0, Math.max(0, normalized.lastIndexOf('/')));
    }

    async function loadParentOptions() {
      try {
        if (typeof window.MeldexProductionApi?.queryTasks !== 'function') {
          throw new Error('親タスク一覧を読み込めませんでした');
        }
        const payload = await window.MeldexProductionApi.queryTasks({ limit: 1000 });
        const currentScope = scopeKey(options.scopePath);
        const candidates = (payload?.rows || payload?.items || []).filter(candidate => {
          return currentScope && scopeKey(candidate.path) === currentScope;
        });
        const byId = new Map(candidates.map(row => [String(row.id || ''), row]));
        const isDescendant = candidate => {
          const visited = new Set();
          let current = String(candidate.id || '');
          while (current && !visited.has(current)) {
            if (current === rowId) return true;
            visited.add(current);
            current = String(prop(byId.get(current), '親タスクID') || '');
          }
          return false;
        };
        parent.replaceChildren(new Option('親タスクなし', ''));
        candidates.filter(candidate => String(candidate.id || '') !== rowId && !isDescendant(candidate)).forEach(candidate => {
          parent.appendChild(new Option(String(candidate.name || candidate.title || candidate._entry_name || candidate.id), String(candidate.id)));
        });
        if (currentParent && ![...parent.options].some(option => option.value === currentParent)) {
          parent.appendChild(new Option('削除済みの親タスク（選び直してください）', currentParent));
        }
        parent.value = currentParent;
        parent.disabled = !!checklistError;
        delete parent.dataset.loading;
        window.MeldexProductionUiAvailability?.sync?.(root);
      } catch (error) {
        parentLoadFailed = true;
        const failed = new Option('親タスク一覧を読み込めませんでした', '');
        failed.disabled = true;
        const optionsAfterFailure = [failed];
        if (currentParent) optionsAfterFailure.push(new Option('現在の親タスク（保持中）', currentParent));
        parent.replaceChildren(...optionsAfterFailure);
        parent.value = currentParent;
        parent.disabled = true;
        parent.dataset.loadError = '1';
        delete parent.dataset.loading;
        if (typeof showStatus === 'function') showStatus(error?.message || '親タスク一覧を読み込めませんでした', true);
      }
    }

    function changed() { options.onChange?.(); }
    function render() {
      list.replaceChildren();
      rows.forEach((row, index) => {
        const item = document.createElement('div');
        item.className = 'gb-production-checklist-item';
        item.dataset.checklistId = row.id;
        const done = document.createElement('input');
        done.type = 'checkbox';
        done.checked = row.done;
        done.dataset.e2eId = `gb-production-checklist-done-${safeRowId}-${row.id}`;
        done.setAttribute('aria-label', `${row.text || 'チェック項目'}を完了にする`);
        done.addEventListener('change', () => { rows[index].done = done.checked; changed(); });
        const doneHit = document.createElement('label');
        doneHit.className = 'gb-production-checklist-done';
        doneHit.appendChild(done);
        const text = document.createElement('input');
        text.type = 'text';
        text.className = 'gb-input';
        text.value = row.text;
        text.dataset.e2eId = `gb-production-checklist-text-${safeRowId}-${row.id}`;
        text.addEventListener('input', () => { rows[index].text = text.value; changed(); });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '削除';
        remove.dataset.e2eId = `gb-production-checklist-remove-${safeRowId}-${row.id}`;
        remove.setAttribute('aria-label', `${row.text || 'チェック項目'}を削除`);
        [text, remove].forEach(control => {
          control.style.minHeight = '44px';
          window.MeldexProductionUiAvailability?.markWriteControl?.(control);
        });
        window.MeldexProductionUiAvailability?.markWriteControl?.(done);
        remove.addEventListener('click', () => { rows.splice(index, 1); render(); changed(); });
        item.append(doneHit, text, remove);
        list.appendChild(item);
      });
    }
    const add = document.createElement('button');
    add.type = 'button';
    add.textContent = 'チェック項目を追加';
    add.dataset.e2eId = 'gb-production-checklist-add';
    add.addEventListener('click', () => {
      rows.push({ id: `check-${safeRowId}-${nextChecklistSequence++}`, text: '', done: false });
      render(); changed();
      list.lastElementChild?.querySelector('input[type="text"]')?.focus();
    });
    parent.addEventListener('input', changed);
    parent.style.minHeight = '44px';
    add.style.minHeight = '44px';
    window.MeldexProductionUiAvailability?.markWriteControl?.(parent);
    window.MeldexProductionUiAvailability?.markWriteControl?.(add);
    if (checklistError) {
      const recovery = document.createElement('div');
      recovery.dataset.e2eId = 'gb-production-checklist-recovery';
      recovery.setAttribute('role', 'alert');
      recovery.textContent = 'チェックリストの保存データが不正です。原文は保持しています。バックアップから復旧するか、管理者に確認してください。';
      recovery.title = checklistError;
      root.append(legend, recovery, parentLabel, list, add);
      add.disabled = true;
      parent.disabled = true;
    } else {
      root.append(legend, parentLabel, list, add);
    }
    render();
    window.MeldexProductionUiAvailability?.sync?.(root);
    parent.disabled = true;
    const ready = loadParentOptions();
    function setBusy(busy) {
      root.querySelectorAll('input,select,button').forEach(control => { control.disabled = !!busy; });
      if (!busy) {
        window.MeldexProductionUiAvailability?.sync?.(root);
        if (parentLoadFailed || checklistError) parent.disabled = true;
        if (checklistError) add.disabled = true;
      }
    }
    return {
      root,
      invalid: !!checklistError,
      originalChecklistValue,
      parentControl: { value: () => parent.value, controls: [parent] },
      checklistControl: { value: () => checklistError ? originalChecklistValue : JSON.stringify(rows.filter(row => row.text.trim())), controls: [add] },
      checklistInputs: () => [...list.querySelectorAll('input,button')],
      setBusy,
      ready,
    };
  }

  window.MeldexProductionTaskHierarchyUi = Object.freeze({ create, parseChecklist });
})();
