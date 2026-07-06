/* ==============================
   gb-production-management-recalc.js: Production recalculation UI
   ============================== */

(() => {
  'use strict';

  function _pmStatus(message, error) {
    if (typeof showStatus === 'function') showStatus(message, !!error);
    else console[error ? 'error' : 'log'](message);
  }

  function _pmIcon(name, size = 14) {
    return typeof lucide === 'function' ? lucide(name, size) : '';
  }

  function _pmRestoreFocus(target) {
    if (!target?.isConnected || typeof target.focus !== 'function') return;
    try { target.focus({ preventScroll: true }); } catch { try { target.focus(); } catch {} }
  }

  function _pmDesktopOnly() {
    if (window.MeldexRuntimeAdapter?.isDropboxMode?.()) {
      _pmStatus('制作管理の再計算はデスクトップ版で実行してください', true);
      return true;
    }
    return false;
  }

  function _pmRequest(path, body) {
    if (_pmDesktopOnly()) return Promise.resolve({ ok: false, unsupported: true });
    if (typeof apiPost === 'function') return apiPost(path, body || {});
    if (window.MeldexDataAccess?.requestJson) return window.MeldexDataAccess.requestJson(path, { method: 'POST', body: body || {} });
    return Promise.reject(new Error('制作管理APIを呼び出せません'));
  }

  function _pmButton(label, primary) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = primary ? 'gb-btn gb-btn-sm gb-btn-primary' : 'gb-btn gb-btn-sm';
    button.textContent = label;
    return button;
  }

  function _pmField(label, input) {
    const field = document.createElement('label');
    if (input?.type === 'checkbox') {
      field.className = 'gb-check gb-production-check';
      const span = document.createElement('span');
      span.textContent = label;
      field.append(input, span);
      return field;
    }
    field.className = 'field gb-production-field';
    const span = document.createElement('span');
    span.className = 'gb-production-field-label';
    span.textContent = label;
    field.append(span, input);
    return field;
  }

  function _pmInput(type, value, placeholder) {
    const input = document.createElement('input');
    input.type = type || 'text';
    input.value = value || '';
    input.placeholder = placeholder || '';
    input.className = 'gb-input gb-input-sm gb-production-input';
    return input;
  }

  function _pmTextarea(value, placeholder) {
    const input = document.createElement('textarea');
    input.value = value || '';
    input.placeholder = placeholder || '';
    input.rows = 2;
    input.className = 'gb-textarea gb-textarea-sm gb-production-input';
    return input;
  }

  function _pmModal(title, width = '760px', options = {}) {
    const focusSource = options.trigger || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay gb-production-modal-overlay';
    overlay.dataset.e2eId = options.e2eId || 'production-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'modal gb-production-modal';
    modal.style.setProperty('--gb-production-modal-width', width);
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.tabIndex = -1;
    modal.dataset.e2eId = options.dialogE2eId || 'production-modal-dialog';
    const titleId = `${modal.dataset.e2eId}-title`;
    modal.setAttribute('aria-labelledby', titleId);
    const header = document.createElement('div');
    header.className = 'gb-modal-header gb-production-modal-header';
    const heading = document.createElement('h3');
    heading.id = titleId;
    heading.className = 'gb-production-title';
    heading.textContent = title;
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'gb-modal-close gb-production-modal-close';
    closeButton.setAttribute('aria-label', `${title}を閉じる`);
    closeButton.dataset.e2eId = `${modal.dataset.e2eId}-close`;
    closeButton.innerHTML = _pmIcon('x', 14) || '×';
    header.append(heading, closeButton);
    const body = document.createElement('div');
    body.className = 'gb-modal-body gb-production-modal-body';
    modal.append(header, body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    const close = () => {
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      _pmRestoreFocus(focusSource);
    };
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
    };
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    closeButton.addEventListener('click', close);
    document.addEventListener('keydown', onKeyDown, true);
    window.GBModalShell?.enhanceOverlay?.(overlay);
    window.requestAnimationFrame(() => {
      const focusTarget = body.querySelector('input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])') || modal;
      _pmRestoreFocus(focusTarget);
    });
    return { overlay, modal, body, close };
  }

  function _pmFooter(closeModal, buttons) {
    const footer = document.createElement('div');
    footer.className = 'gb-modal-footer gb-production-modal-footer';
    footer.dataset.modalFooter = '1';
    const cancel = _pmButton('閉じる');
    cancel.addEventListener('click', closeModal);
    footer.append(cancel, ...buttons);
    return footer;
  }

  function _pmDateText(offsetDays) {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function openProductionRecalculate(options = {}) {
    const { body, close } = _pmModal('再計算', '760px', {
      trigger: options?.trigger,
      e2eId: 'production-recalculate-dialog-overlay',
      dialogE2eId: 'production-recalculate-dialog',
    });
    const from = _pmInput('date', _pmDateText(0));
    from.dataset.e2eId = 'production-recalculate-from';
    const to = _pmInput('date', _pmDateText(30));
    to.dataset.e2eId = 'production-recalculate-to';
    const resultBox = document.createElement('div');
    resultBox.className = 'gb-production-result-box';
    const previewButton = _pmButton('プレビューを作成', true);
    previewButton.dataset.e2eId = 'production-recalculate-preview';
    const applyButton = _pmButton('適用', true);
    applyButton.dataset.e2eId = 'production-recalculate-apply';
    applyButton.disabled = true;
    let rows = [];
    // 期間を変えたら古いプレビュー結果を適用できないようにする（旧期間の計画の誤適用防止）
    const resetPreview = () => {
      rows = [];
      applyButton.disabled = true;
      resultBox.replaceChildren();
      const note = document.createElement('div');
      note.className = 'gb-production-preview-note';
      note.textContent = '期間を変更しました。適用するには再度プレビューを作成してください。';
      resultBox.appendChild(note);
    };
    ['input', 'change'].forEach(eventName => {
      from.addEventListener(eventName, resetPreview);
      to.addEventListener(eventName, resetPreview);
    });
    previewButton.addEventListener('click', async () => {
      previewButton.disabled = true;
      try {
        const result = await _pmRequest('/production-management/recalculate/preview', { date_from: from.value, date_to: to.value });
        rows = result.rows || [];
        _pmRenderPreview(resultBox, result);
        applyButton.disabled = !rows.length;
      } catch (error) {
        // プレビュー失敗時は前回結果を残さない（古い計画の誤適用防止）
        rows = [];
        applyButton.disabled = true;
        _pmStatus(error?.message || String(error), true);
      } finally {
        previewButton.disabled = false;
      }
    });
    applyButton.addEventListener('click', async () => {
      applyButton.disabled = true;
      try {
        const result = await _pmRequest('/production-management/recalculate/apply', { date_from: from.value, date_to: to.value, rows });
        _pmStatus(`再計算を適用しました: ${result.applied || 0}件`);
        _pmRefreshCalendars();
        close();
      } catch (error) {
        _pmStatus(error?.message || String(error), true);
      } finally {
        applyButton.disabled = false;
      }
    });
    body.append(_pmField('開始日', from), _pmField('終了日', to), resultBox);
    body.parentElement.append(_pmFooter(close, [previewButton, applyButton]));
  }

  function _pmRenderPreview(container, result) {
    container.replaceChildren();
    const summary = document.createElement('div');
    summary.textContent = `予定 ${result.summary?.scheduled || 0}件 / 固定 ${result.summary?.locked || 0}件 / 未割り当て ${result.summary?.unassigned || 0}件 / 変更 ${result.summary?.changed || 0}件`;
    container.appendChild(summary);
    (result.suggestions || []).forEach((text) => {
      const item = document.createElement('div');
      item.className = 'gb-production-preview-warning';
      item.textContent = text;
      container.appendChild(item);
    });
    const tableWrap = document.createElement('div');
    tableWrap.className = 'gb-production-preview-table-wrap';
    const table = document.createElement('table');
    table.className = 'db-table gb-production-preview-table';
    const head = document.createElement('tr');
    ['状態', 'タスク', '担当者', '変更前', '変更後', '理由'].forEach((label) => {
      const th = document.createElement('th');
      th.textContent = label;
      head.appendChild(th);
    });
    table.appendChild(head);
    (result.rows || []).slice(0, 100).forEach((row) => {
      const tr = document.createElement('tr');
      [row.status, row.task_name, row.user, row.before_range, row.after_range, row.reason].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value || '';
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    tableWrap.appendChild(table);
    container.appendChild(tableWrap);
  }

  function openProductionStaffAdd(options = {}) {
    const { body, close } = _pmModal('メンバーを追加', '640px', {
      trigger: options?.trigger,
      e2eId: 'production-staff-add-dialog-overlay',
      dialogE2eId: 'production-staff-add-dialog',
    });
    const name = _pmInput('text', '', 'メンバー名');
    name.dataset.e2eId = 'production-staff-name';
    const display = _pmInput('text', '', '表示名');
    const skills = _pmInput('text', '', 'ネーム,下描き');
    const workHours = _pmInput('text', '09:00-18:00', '09:00-18:00');
    const breakHours = _pmInput('text', '12:00-13:00', '12:00-13:00');
    const holidays = _pmInput('text', '土,日', '土,日,2026-05-03');
    const activeFrom = _pmInput('date', '');
    const activeTo = _pmInput('date', '');
    const googleUrl = _pmInput('text', '', 'Google カレンダーID または URL');
    const caldavUrl = _pmInput('text', '', 'CalDAV カレンダーURL');
    const syncEnabled = document.createElement('input');
    syncEnabled.type = 'checkbox';
    syncEnabled.className = 'gb-checkbox';
    syncEnabled.dataset.e2eId = 'production-staff-sync';
    const saveButton = _pmButton('追加', true);
    saveButton.dataset.e2eId = 'production-staff-add-save';
    saveButton.addEventListener('click', async () => {
      saveButton.disabled = true;
      try {
        const staffName = name.value.trim();
        if (staffName) {
          const list = await _pmRequest('/production-management/lists?sheet=' + encodeURIComponent('スタッフリスト') + '&limit=1000').catch(() => null);
          const exists = (list?.rows || []).some(row => {
            const props = row?.properties || {};
            return String(props['スタッフ名'] || row?.name || '').trim() === staffName;
          });
          if (exists && typeof cfConfirm === 'function') {
            const ok = await cfConfirm('同じ名前のメンバーがあります。入力内容で既存メンバーを更新しますか？');
            if (!ok) return;
          }
        }
        const result = await _pmRequest('/production-management/staff/add', {
          name: name.value, display: display.value, skills: skills.value,
          work_hours: workHours.value, break_hours: breakHours.value, holidays: holidays.value,
          active_from: activeFrom.value, active_to: activeTo.value,
          google_url: googleUrl.value, caldav_url: caldavUrl.value, sync_enabled: syncEnabled.checked,
          _preserve_empty: true,
        });
        if (result.ok) {
          _pmStatus(`メンバーを追加しました: ${result.staff}`);
          _pmShowRecalcBanner();
          close();
        } else {
          _pmStatus(result.message || 'メンバーを追加できませんでした', true);
        }
      } catch (error) {
        _pmStatus(error?.message || String(error), true);
      } finally {
        saveButton.disabled = false;
      }
    });
    body.append(
      _pmField('メンバー名', name), _pmField('表示名', display), _pmField('担当できるタスク', skills),
      _pmField('作業可能時間', workHours), _pmField('休憩時間', breakHours), _pmField('休日', holidays),
      _pmField('参加開始日', activeFrom), _pmField('参加終了日', activeTo),
      _pmField('外部カレンダーURL（Google）', googleUrl), _pmField('外部カレンダーURL（CalDAV）', caldavUrl),
      _pmField('同期有効', syncEnabled)
    );
    body.parentElement.append(_pmFooter(close, [saveButton]));
    name.focus();
  }

  async function toggleProductionTaskRecalcLock(taskPath, locked, eventId) {
    const result = await _pmRequest('/production-management/tasks/lock', { task_path: taskPath || '', event_id: eventId || '', locked: !!locked });
    if (result.ok) {
      _pmStatus(locked ? '再計算で動かさないよう固定しました' : '再計算の固定を解除しました');
      _pmRefreshCalendars();
    } else {
      _pmStatus(result.message || '固定を変更できませんでした', true);
    }
    return result;
  }

  function _pmShowRecalcBanner() {
    document.querySelector('.gb-production-recalc-banner')?.remove();
    const banner = document.createElement('div');
    banner.className = 'gb-production-recalc-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-label', '制作管理の再計算案内');
    const text = document.createElement('span');
    text.className = 'gb-production-recalc-banner-text';
    text.textContent = 'メンバーを追加しました。再計算しますか？';
    const open = _pmButton('再計算を確認', true);
    open.dataset.e2eId = 'production-recalc-banner-open';
    const close = _pmButton('閉じる');
    close.dataset.e2eId = 'production-recalc-banner-close';
    open.addEventListener('click', () => { banner.remove(); openProductionRecalculate({ trigger: open }); });
    close.addEventListener('click', () => banner.remove());
    banner.append(text, open, close);
    document.body.appendChild(banner);
  }

  function _pmRefreshCalendars() {
    if (typeof forEachComponent !== 'function' || typeof CalendarComponent === 'undefined') return;
    forEachComponent((instance) => {
      if (instance instanceof CalendarComponent && typeof instance._loadEvents === 'function') {
        instance._loadEvents().then(() => instance._render?.()).catch(() => {});
      }
    });
  }

  function _pmFindCalendarComponent() {
    let found = null;
    if (typeof forEachComponent === 'function' && typeof CalendarComponent !== 'undefined') {
      forEachComponent((instance) => {
        if (!found && instance instanceof CalendarComponent) found = instance;
      });
    }
    return found;
  }

  function _pmTaskPathFromEvent(ev) {
    const match = String(ev?.description || '').match(/元シート:\s*([^\n\r]+)/);
    return match ? match[1].trim() : '';
  }

  function _pmInstallLockMenu() {
    document.addEventListener('contextmenu', (event) => {
      const card = event.target.closest?.('[data-event-id].gb-cal-production-task-event');
      if (!card) return;
      event.preventDefault();
      const component = _pmFindCalendarComponent();
      const ev = component?._events?.find?.(item => String(item.id) === String(card.dataset.eventId));
      const taskPath = _pmTaskPathFromEvent(ev);
      _pmShowLockMenu(event.clientX, event.clientY, taskPath, card.dataset.eventId, card);
    });
  }

  function _pmShowLockMenu(x, y, taskPath, eventId, sourceEl = null) {
    document.querySelector('.gb-production-lock-menu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu gb-production-lock-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '制作管理の再計算固定メニュー');
    menu.dataset.e2eId = 'production-lock-menu';
    const closeMenu = (restore = true) => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      menu.remove();
      if (restore) _pmRestoreFocus(sourceEl);
    };
    const makeItem = (label, locked) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'gb-context-menu-item';
      item.setAttribute('role', 'menuitem');
      item.innerHTML = `<span class="menu-icon">${_pmIcon(locked ? 'lock' : 'unlock', 14)}</span><span class="gb-context-menu-item-label"></span>`;
      item.querySelector('.gb-context-menu-item-label').textContent = label;
      item.addEventListener('click', () => { closeMenu(false); toggleProductionTaskRecalcLock(taskPath, locked, eventId); });
      return item;
    };
    const lock = makeItem('再計算で固定', true);
    const unlock = makeItem('固定を解除', false);
    menu.append(lock, unlock);
    document.body.appendChild(menu);
    // UIズーム使用時の二重スケーリングによる位置ズレを防ぐため、共通のポップアップ配置処理を使う
    const pointRect = { left: x, right: x, top: y, bottom: y, width: 0, height: 0 };
    if (typeof positionPopup === 'function') {
      positionPopup(menu, pointRect, { prefer: 'below', gap: 4 });
    } else {
      const zoom = typeof _getZoom === 'function' ? _getZoom() : 1;
      menu.style.left = `${x / zoom}px`;
      menu.style.top = `${y / zoom}px`;
      if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
    }
    const onPointerDown = (event) => {
      if (!menu.contains(event.target)) closeMenu(false);
    };
    const onKeyDown = (event) => {
      const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
      const active = document.activeElement;
      const index = Math.max(0, items.indexOf(active));
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu(true);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        items[(index + 1) % items.length]?.focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        items[(index - 1 + items.length) % items.length]?.focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        items[0]?.focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        items[items.length - 1]?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    setTimeout(() => document.addEventListener('pointerdown', onPointerDown, true), 0);
    window.requestAnimationFrame(() => _pmRestoreFocus(lock));
  }

  function _pmInstallLockIcon() {
    if (typeof CalendarComponent === 'undefined' || CalendarComponent.prototype.__pmRecalcLockIcon) return;
    const original = CalendarComponent.prototype._eventTitleContentHtml;
    if (typeof original !== 'function') return;
    CalendarComponent.prototype._eventTitleContentHtml = function (ev) {
      const html = original.call(this, ev);
      if (ev?.calendar_source === 'production-task' && /再計算ロック:\s*true/.test(String(ev?.description || ''))) {
        const icon = typeof lucide === 'function' ? lucide('lock', 10) : '[lock]';
        return `${icon}${html}`;
      }
      return html;
    };
    CalendarComponent.prototype.__pmRecalcLockIcon = true;
  }

  window.openProductionRecalculate = openProductionRecalculate;
  window.openProductionStaffAdd = openProductionStaffAdd;
  window.toggleProductionTaskRecalcLock = toggleProductionTaskRecalcLock;

  _pmInstallLockIcon();
  _pmInstallLockMenu();
})();
