/* Persistent, item-scoped history for calendar events, ToDos, and shifts. */
(function (global) {
  'use strict';

  const LABELS = Object.freeze({ event: '予定', todo: 'ToDo', shift: 'シフト' });
  const RETURN_FOCUS_SELECTORS = Object.freeze({
    event: '[data-e2e-id="calendar-event-history"]',
    todo: '[data-e2e-id="cal-task-history"]',
    shift: '#sh-history',
  });

  function text(tag, value, className) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = String(value ?? '');
    return element;
  }

  function confirmRestore(label, deleted) {
    const message = deleted
      ? `${label}が存在しなかった版へ復元しますか？\n現在の${label}は削除され、復元前の版として残ります。`
      : `${label}をこの版へ復元しますか？\n現在の内容は復元前の版として残ります。`;
    if (typeof global.cfConfirm === 'function') {
      return global.cfConfirm(message, { okLabel: '復元' });
    }
    return new Promise(resolve => {
      if (typeof showConfirmDialog === 'function') {
        showConfirmDialog(message, () => resolve(true), () => resolve(false));
        return;
      }
      resolve(global.confirm?.(message) === true);
    });
  }

  function displayValue(value) {
    if (value == null || value === '') return '（なし）';
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    return raw.length > 500 ? raw.slice(0, 500) + '…' : raw;
  }

  async function open(kind, itemId, options = {}) {
    if (!LABELS[kind] || !itemId) throw new Error('履歴対象を特定できません');
    const label = LABELS[kind];
    const opener = options.returnFocus || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const focusEntry = () => opener?.isConnected ? opener
      : document.querySelector(RETURN_FOCUS_SELECTORS[kind])
        || document.querySelector('[data-rp-tab="calendar"]');
    const body = document.createElement('div');
    body.dataset.e2eId = 'calendar-item-history-body';
    const status = text('div', `${label}の版を読み込んでいます…`, 'gb-section-desc');
    status.setAttribute('role', 'status');
    body.appendChild(status);
    const close = text('button', '閉じる', 'gb-btn gb-btn-sm');
    close.type = 'button';
    const dialog = global.GBUI.createModal({
      id: 'calendar-item-history', title: `${label}のバージョン`, body, footer: close,
      variant: 'standard', extraClass: 'calendar-item-history-modal', geometryKey: 'calendar-item-history',
      minWidth: '0', initialFocus: close,
      returnFocus: focusEntry,
    });
    dialog.overlay.dataset.e2eId = 'calendar-item-history-overlay';
    dialog.modal.style.width = 'min(720px, calc(100vw - 24px))';
    close.addEventListener('click', () => dialog.close('complete'));
    dialog.open();

    try {
      const listed = await apiFetch(`/cal/history/${encodeURIComponent(kind)}/${encodeURIComponent(itemId)}`);
      body.replaceChildren();
      const versions = Array.isArray(listed?.versions) ? listed.versions : [];
      if (!versions.length) {
        body.appendChild(text('div', `まだ${label}の版はありません。変更または削除すると自動で残ります。`, 'gb-section-desc'));
        return;
      }
      versions.forEach(version => {
        const row = document.createElement('section');
        row.className = 'gb-section gb-section--boxed';
        row.dataset.versionId = String(version.versionId || '');
        row.appendChild(text('div', version.label || '変更前', 'gb-section-title'));
        const created = new Date(version.createdAt || 0);
        const timestamp = Number.isNaN(created.getTime()) ? '日時不明' : created.toLocaleString();
        row.appendChild(text('div', `${timestamp}・${version.actor || '利用者'}${version.deleted ? '・項目なし' : ''}`, 'gb-section-desc'));
        const actions = document.createElement('div');
        actions.className = 'gb-field-row';
        const compare = text('button', '変更内容を見る', 'gb-btn gb-btn-sm');
        compare.type = 'button';
        const restore = text('button', 'この版へ復元', 'gb-btn gb-btn-sm');
        restore.type = 'button';
        const stableVersionId = String(version.versionId || '').replace(/[^a-z0-9_-]+/gi, '-');
        compare.dataset.e2eId = `calendar-item-version-compare-${stableVersionId}`;
        restore.dataset.e2eId = `calendar-item-version-restore-${stableVersionId}`;
        const details = text('div', '', 'gb-section-desc');
        details.hidden = true;
        compare.addEventListener('click', async () => {
          compare.disabled = true;
          try {
            const result = await apiFetch(`/cal/history/${encodeURIComponent(kind)}/${encodeURIComponent(itemId)}/${encodeURIComponent(version.versionId)}`);
            row.dataset.currentRevision = String(result?.currentRevision || '');
            details.replaceChildren();
            const changes = Array.isArray(result?.changes) ? result.changes : [];
            details.appendChild(text('div', changes.length ? `${changes.length}項目が現在と異なります。` : '現在の内容と同じです。'));
            changes.forEach(change => {
              const item = document.createElement('div');
              item.appendChild(text('strong', change.field));
              item.appendChild(text('div', `この版: ${displayValue(change.versionValue)}`));
              item.appendChild(text('div', `現在: ${displayValue(change.currentValue)}`));
              details.appendChild(item);
            });
            details.hidden = false;
          } catch (error) {
            details.textContent = error?.message || '変更内容を読み込めませんでした。';
            details.hidden = false;
          } finally {
            compare.disabled = false;
          }
        });
        restore.addEventListener('click', async () => {
          if (!(await confirmRestore(label, version.deleted === true))) return;
          restore.disabled = true;
          try {
            let currentRevision = row.dataset.currentRevision;
            if (!currentRevision) {
              const compared = await apiFetch(`/cal/history/${encodeURIComponent(kind)}/${encodeURIComponent(itemId)}/${encodeURIComponent(version.versionId)}`);
              currentRevision = String(compared?.currentRevision || '');
            }
            const result = await apiPost(`/cal/history/${encodeURIComponent(kind)}/${encodeURIComponent(itemId)}/${encodeURIComponent(version.versionId)}/restore`, {
              expectedRevision: currentRevision,
            });
            await options.onRestored?.(result);
            dialog.close('restored');
          } catch (error) {
            details.textContent = error?.message || `${label}を復元できませんでした。`;
            details.hidden = false;
            restore.disabled = false;
          }
        });
        actions.append(compare, restore);
        row.append(actions, details);
        body.appendChild(row);
      });
    } catch (error) {
      status.textContent = error?.message || `${label}の版を読み込めませんでした。`;
    }
  }

  global.MeldexCalendarItemHistory = Object.freeze({ open });
})(typeof globalThis !== 'undefined' ? globalThis : window);
