/* 止まっている添付の取込（設定 → 外部取り込み／Xブックマーク／Xアカウント保存）。
 *
 * 添付の取込が途中で止まると、そのトピックへの新規取込が止まり続ける。
 * ここで止まっている件数と内容を見せ、「そのまま残す」か「取込を取り消す」で解消する。
 * 自動で安全に解消できるものは、一覧を取る時点でサーバーが先に解消する。
 */
(function initIntakeRecoverySettings(global) {
  'use strict';

  const ENDPOINT = '/sheet-entry/intake-recovery';

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function help(text, e2eId) {
    return typeof global.fieldHelp === 'function' ? global.fieldHelp(text, e2eId ? { e2eId } : undefined) : '';
  }

  function icon(name) {
    return typeof global.lucide === 'function' ? global.lucide(name, 14) : '';
  }

  function notify(message, error = false) {
    if (typeof global.showStatus === 'function') global.showStatus(String(message || ''), error);
  }

  function stateText(item) {
    if (!item.record_found) return '記録の中身を確かめられません';
    if (item.registered) return 'トピックに登録済み';
    if (item.used_by_other) return '同じ添付を別の取込が登録済み';
    if (item.target_exists) return 'トピックに未登録の添付ファイルがあります';
    return '添付ファイルは作られていません';
  }

  function rowHtml(item) {
    const title = item.topic_name || '（トピック不明）';
    const where = [item.sheet_path, item.attachment_name].filter(Boolean).join(' / ');
    const detail = (item.errors || []).join('\n');
    const discard = (item.actions || []).includes('discard')
      ? `<button type="button" class="gb-btn gb-btn-sm gb-btn-danger" data-intake-recovery-action="discard">取込を取り消す</button>`
      : '';
    return `<div class="settings-intake-recovery-item" style="display:flex;flex-direction:column;gap:var(--ui-space-1);padding:var(--ui-space-2) 0;border-top:1px solid var(--border);" data-intake-recovery-item data-operation-id="${esc(item.operation_id)}" data-root="${esc(item.root)}" data-topic-name="${esc(title)}">
        <div class="gb-label" style="overflow-wrap:anywhere;">${esc(title)} ${help(detail ? `止まった理由: ${detail}` : '止まった理由は記録されていません')}</div>
        <div class="gb-section-desc" style="overflow-wrap:anywhere;">${esc(where)}${where ? ' · ' : ''}${esc(stateText(item))}</div>
        <div class="gb-field-row" style="justify-content:flex-start;">
          <button type="button" class="gb-btn gb-btn-sm" data-intake-recovery-action="keep">そのまま残す</button>
          ${discard}
        </div>
      </div>`;
  }

  async function resolveItem(container, row, action) {
    const name = row.dataset.topicName || 'この取込';
    const message = action === 'discard'
      ? `「${name}」の取込を取り消します。トピックが使っていない添付ファイルを、この端末内の回収領域へ移します。`
      : `「${name}」の止まっている取込を、今の状態のまま確定します。トピックと添付ファイルは変更しません。`;
    const confirmFn = typeof global.cfConfirm === 'function' ? global.cfConfirm : null;
    const ok = confirmFn
      ? await confirmFn(message, { okLabel: action === 'discard' ? '取り消す' : '残す', danger: action === 'discard' })
      : false;
    if (!ok) return;
    row.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try {
      await global.apiFetch(`${ENDPOINT}/resolve`, {
        method: 'POST',
        body: { operation_id: row.dataset.operationId, root: row.dataset.root, action },
      });
      notify(action === 'discard' ? '止まっていた取込を取り消しました' : '止まっていた取込を解消しました');
    } catch (error) {
      notify(error?.message || '止まっている取込を解消できませんでした', true);
    }
    await render(container);
  }

  async function render(container) {
    if (!container || typeof global.apiFetch !== 'function') return;
    if (typeof global._settingsDesktopFeaturesAvailable === 'function' && !global._settingsDesktopFeaturesAvailable()) {
      container.innerHTML = '';
      return;
    }
    let items = [];
    try {
      const result = await global.apiFetch(ENDPOINT, { silentError: true });
      items = Array.isArray(result?.items) ? result.items : [];
    } catch (_error) {
      items = [];
    }
    if (!container.isConnected) return;
    if (!items.length) {
      // 止まっている取込が無い時は何も出さない（:empty で枠ごと隠れる）。
      container.innerHTML = '';
      return;
    }
    container.innerHTML = `<section class="gb-section gb-section--boxed" data-e2e-id="settings-intake-recovery">
        <div class="gb-section-title">${icon('triangleAlert')} 止まっている添付の取込 ${items.length}件 ${help('添付の取込が途中で止まると、そのトピックへの取込が止まります。「そのまま残す」はトピックと添付ファイルを変更せずに確定します。「取込を取り消す」はトピックが使っていない添付ファイルを端末内の回収領域へ移します', 'settings-intake-recovery-help')}</div>
        ${items.map(rowHtml).join('')}
      </section>`;
    container.querySelectorAll('[data-intake-recovery-action]').forEach(button => {
      button.addEventListener('click', () => {
        const row = button.closest('[data-intake-recovery-item]');
        if (row) resolveItem(container, row, button.dataset.intakeRecoveryAction);
      });
    });
  }

  global.MeldexIntakeRecoverySettings = Object.freeze({ render });
})(window);
