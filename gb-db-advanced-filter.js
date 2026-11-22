/* 条件の入力欄の共通部品（条件付きカラーのダイアログが使う）と、フィルタの入口。
 * 旧「複数条件フィルタ」ダイアログは、統合フィルタへ常に切り替わり画面から開けなかったので消した（2026-11-21 ユーザー決定）。 */

function showAdvancedFilterModal(ctxOrEvent) {
  const ctx = (ctxOrEvent && typeof ctxOrEvent === 'object' && ctxOrEvent.dbPath)
    ? ctxOrEvent
    : (typeof _dbPaneContextFromEvent === 'function'
      ? _dbPaneContextFromEvent(ctxOrEvent?.target || ctxOrEvent?.currentTarget || null, { dbPath: state.currentDbPath })
      : (typeof _currentPaneState === 'function' ? _currentPaneState() : null));
  if (typeof showUnifiedFilterModal === 'function') return showUnifiedFilterModal({ ctx });
  if (typeof showStatus === 'function') showStatus('フィルタを開けませんでした。画面を再読み込みしてください。', true);
  return null;
}

const _CONDITION_CONTROL_BASIS = [['gb-select-short', 96], ['gb-select-medium', 164], ['gb-select-column', 280]];

function styleConditionControl(el, extraCss = '') {
  if (!el) return el;
  const basis = _CONDITION_CONTROL_BASIS.find(([cls]) => el.classList?.contains(cls))?.[1];
  const flexCss = basis ? `flex:0 1 ${basis}px;` : '';
  el.style.cssText = `display:block;width:100%;min-width:0;min-height:32px;box-sizing:border-box;${flexCss}${extraCss}`;
  return el;
}

function setupConditionModalLayout(overlay, listSelector) {
  const modal = overlay?.querySelector('.cond-modal');
  const body = overlay?.querySelector('.cond-modal-body');
  const list = overlay?.querySelector(listSelector);
  const addBtn = overlay?.querySelector('.cond-add-btn');
  if (modal) {
    modal.style.width = 'min(720px, 80vw)';
    modal.style.height = 'min(560px, 80vh)';
  }
  if (body) {
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.gap = '8px';
    body.style.flex = '1 1 auto';
    body.style.minHeight = '0';
  }
  if (list) {
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '8px';
    list.style.flex = '1 1 auto';
    list.style.minHeight = '140px';
    list.style.minWidth = '0';
    list.style.margin = '0';
    list.style.padding = '4px';
    list.style.overflowY = 'auto';
    list.style.border = '1px solid var(--ui-border, var(--border))';
    list.style.borderRadius = '6px';
    list.style.background = 'var(--ui-bg-app, var(--bg))';
    list.style.boxSizing = 'border-box';
  }
  if (addBtn) {
    addBtn.style.marginBottom = '0';
    addBtn.style.flex = '0 0 auto';
  }
  return { modal, body, list, addBtn };
}

function closeConditionModal(listSelector) {
  document.querySelector(listSelector)?.closest('.modal-overlay')?.remove();
}

function createConditionFieldBlock(labelText, control) {
  const wrap = document.createElement('div');
  wrap.className = 'gb-field-select-row';
  const label = document.createElement(control?.id ? 'label' : 'div');
  if (control?.id) {
    label.setAttribute('for', control.id);
    label.className = 'gb-label';
  }
  label.textContent = labelText;
  label.style.cssText = 'font-size:11px;color:var(--ui-fg-muted, var(--fg2));margin:0 0 4px;';
  label.style.flex = '0 0 96px';
  wrap.appendChild(label);
  wrap.appendChild(control);
  return wrap;
}
