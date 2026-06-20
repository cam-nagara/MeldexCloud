/* ==============================
   gb-production-management-recalc.js: Production recalculation UI
   ============================== */

(() => {
  'use strict';

  function _pmStatus(message, error) {
    if (typeof showStatus === 'function') showStatus(message, !!error);
    else console[error ? 'error' : 'log'](message);
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
    button.className = primary ? 'btn btn-primary' : 'btn';
    button.textContent = label;
    return button;
  }

  function _pmField(label, input) {
    const field = document.createElement('label');
    field.className = 'field';
    const span = document.createElement('span');
    span.textContent = label;
    field.append(span, input);
    return field;
  }

  function _pmInput(type, value, placeholder) {
    const input = document.createElement('input');
    input.type = type || 'text';
    input.value = value || '';
    input.placeholder = placeholder || '';
    input.style.width = '100%';
    return input;
  }

  function _pmTextarea(value, placeholder) {
    const input = document.createElement('textarea');
    input.value = value || '';
    input.placeholder = placeholder || '';
    input.rows = 2;
    input.style.width = '100%';
    return input;
  }

  function _pmModal(title, width = '760px') {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.minWidth = '420px';
    modal.style.maxWidth = width;
    modal.style.maxHeight = '82vh';
    modal.style.overflow = 'auto';
    const heading = document.createElement('h3');
    heading.textContent = title;
    modal.appendChild(heading);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) overlay.remove();
    });
    return { overlay, modal };
  }

  function _pmFooter(overlay, buttons) {
    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '8px';
    const cancel = _pmButton('閉じる');
    cancel.addEventListener('click', () => overlay.remove());
    footer.append(cancel, ...buttons);
    return footer;
  }

  function _pmDateText(offsetDays) {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function openProductionRecalculate() {
    const { overlay, modal } = _pmModal('再計算');
    const from = _pmInput('date', _pmDateText(0));
    const to = _pmInput('date', _pmDateText(30));
    const resultBox = document.createElement('div');
    resultBox.style.marginTop = '12px';
    const previewButton = _pmButton('プレビューを作成', true);
    const applyButton = _pmButton('適用', true);
    applyButton.disabled = true;
    let rows = [];
    // 期間を変えたら古いプレビュー結果を適用できないようにする（旧期間の計画の誤適用防止）
    const resetPreview = () => {
      rows = [];
      applyButton.disabled = true;
      resultBox.replaceChildren();
      const note = document.createElement('div');
      note.style.color = 'var(--fg2)';
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
        overlay.remove();
      } catch (error) {
        _pmStatus(error?.message || String(error), true);
      } finally {
        applyButton.disabled = false;
      }
    });
    modal.append(_pmField('開始日', from), _pmField('終了日', to), resultBox, _pmFooter(overlay, [previewButton, applyButton]));
  }

  function _pmRenderPreview(container, result) {
    container.replaceChildren();
    const summary = document.createElement('div');
    summary.textContent = `予定 ${result.summary?.scheduled || 0}件 / 固定 ${result.summary?.locked || 0}件 / 未割り当て ${result.summary?.unassigned || 0}件 / 変更 ${result.summary?.changed || 0}件`;
    container.appendChild(summary);
    (result.suggestions || []).forEach((text) => {
      const item = document.createElement('div');
      item.style.color = 'var(--warning, #b26a00)';
      item.textContent = text;
      container.appendChild(item);
    });
    const table = document.createElement('table');
    table.className = 'db-table';
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
    container.appendChild(table);
  }

  function openProductionStaffAdd() {
    const { overlay, modal } = _pmModal('メンバーを追加', '640px');
    const name = _pmInput('text', '', 'メンバー名');
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
    const saveButton = _pmButton('追加', true);
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
          overlay.remove();
        } else {
          _pmStatus(result.message || 'メンバーを追加できませんでした', true);
        }
      } catch (error) {
        _pmStatus(error?.message || String(error), true);
      } finally {
        saveButton.disabled = false;
      }
    });
    modal.append(
      _pmField('メンバー名', name), _pmField('表示名', display), _pmField('担当できるタスク', skills),
      _pmField('作業可能時間', workHours), _pmField('休憩時間', breakHours), _pmField('休日', holidays),
      _pmField('参加開始日', activeFrom), _pmField('参加終了日', activeTo),
      _pmField('外部カレンダーURL（Google）', googleUrl), _pmField('外部カレンダーURL（CalDAV）', caldavUrl),
      _pmField('同期有効', syncEnabled), _pmFooter(overlay, [saveButton])
    );
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
    banner.style.position = 'fixed';
    banner.style.left = '50%';
    banner.style.top = '12px';
    banner.style.transform = 'translateX(-50%)';
    banner.style.zIndex = '9999';
    banner.style.display = 'flex';
    banner.style.alignItems = 'center';
    banner.style.gap = '8px';
    banner.style.padding = '8px 12px';
    banner.style.border = '1px solid var(--border)';
    banner.style.background = 'var(--bg)';
    banner.style.boxShadow = '0 4px 12px rgba(0,0,0,.18)';
    const text = document.createElement('span');
    text.textContent = 'メンバーを追加しました。再計算しますか？';
    const open = _pmButton('再計算を確認', true);
    const close = _pmButton('閉じる');
    open.addEventListener('click', () => { banner.remove(); openProductionRecalculate(); });
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
      _pmShowLockMenu(event.clientX, event.clientY, taskPath, card.dataset.eventId);
    });
  }

  function _pmShowLockMenu(x, y, taskPath, eventId) {
    document.querySelector('.gb-production-lock-menu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'gb-production-lock-menu';
    menu.style.position = 'fixed';
    menu.style.zIndex = '9999';
    menu.style.display = 'grid';
    menu.style.gap = '4px';
    menu.style.padding = '6px';
    menu.style.border = '1px solid var(--border)';
    menu.style.background = 'var(--bg)';
    menu.style.boxShadow = '0 4px 12px rgba(0,0,0,.18)';
    const lock = _pmButton('再計算で固定');
    const unlock = _pmButton('固定を解除');
    lock.addEventListener('click', () => { menu.remove(); toggleProductionTaskRecalcLock(taskPath, true, eventId); });
    unlock.addEventListener('click', () => { menu.remove(); toggleProductionTaskRecalcLock(taskPath, false, eventId); });
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
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
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
