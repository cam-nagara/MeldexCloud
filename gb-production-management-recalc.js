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

  function _pmRequest(path, body) {
    if (body === undefined) {
      if (typeof apiFetch === 'function') return apiFetch(path);
      if (window.MeldexDataAccess?.requestJson) return window.MeldexDataAccess.requestJson(path);
      return Promise.reject(new Error('制作管理APIを呼び出せません'));
    }
    if (window.MeldexProductionUiAvailability?.ensureWritable?.() === false) {
      return Promise.resolve({ ok: false, blocked: true, write_blocked: true });
    }
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

  // 候補ユーザー一覧はMeldexUserPickerに統一（正本「スタッフ管理シート」+
  // ワークスペースメンバーのマージ。ユーザーアカウント一元管理 計画書 Phase 3、
  // §5.8-4）。この選択自体は正本「スタッフ管理シート」へ書き込む
  // （制作管理フル統合Phase 4で完全統合済み。§5.9手順3）。
  async function _pmPopulateWorkspaceUsers(list, options = {}) {
    const names = new Set();
    if (window.MeldexUserPicker) {
      try {
        (await window.MeldexUserPicker.getCandidates()).forEach(candidate => {
          if (candidate?.name) names.add(candidate.name);
        });
      } catch {}
    }
    if (!names.size) {
      const payload = await _pmRequest('/workspaces');
      (payload?.workspaces || []).forEach(workspace => {
        (workspace?.members || []).forEach(member => {
          const name = String(typeof member === 'object' ? member?.name : member || '').trim();
          if (name) names.add(name);
        });
      });
    }
    const current = typeof getUsername === 'function' ? String(getUsername() || '').trim() : '';
    if (current) names.add(current);
    list.replaceChildren();
    if (options.allowEmpty) {
      const emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = options.emptyLabel || 'ユーザーを選択';
      list.appendChild(emptyOption);
    }
    [...names].sort((left, right) => left.localeCompare(right, 'ja')).forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      list.appendChild(option);
    });
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
    const dialogE2eId = options.dialogE2eId || 'production-modal-dialog';
    let busy = false;
    const dialogApi = window.GBUI.createModal({
      id: `${dialogE2eId}-common`,
      titleId: `${dialogE2eId}-title`,
      title,
      variant: 'standard',
      extraClass: 'gb-production-modal',
      geometryKey: dialogE2eId,
      minWidth: '0',
      initialFocus: modal => modal.querySelector('input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])'),
      returnFocus: focusSource,
      closeOnEsc: true,
      closeOnOverlay: true,
      onBeforeClose: reason => !busy || reason === 'complete',
    });
    const { overlay, modal, header, body, footer } = dialogApi;
    overlay.classList.add('modal-overlay', 'gb-production-modal-overlay');
    overlay.dataset.e2eId = options.e2eId || 'production-modal-overlay';
    modal.classList.add('modal');
    modal.style.setProperty('--gb-production-modal-width', width);
    modal.dataset.e2eId = dialogE2eId;
    header.classList.add('gb-production-modal-header');
    header.querySelector('.gb-modal-title')?.classList.add('gb-production-title');
    const closeButton = header.querySelector('.gb-modal-close');
    closeButton?.classList.add('gb-production-modal-close');
    closeButton.setAttribute('aria-label', `${title}を閉じる`);
    closeButton.dataset.e2eId = `${dialogE2eId}-close`;
    body.classList.add('gb-production-modal-body');
    footer.classList.add('gb-production-modal-footer');
    footer.dataset.modalFooter = '1';
    const status = document.createElement('div');
    status.className = 'gb-production-dialog-status';
    status.hidden = true;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const close = (reason = 'programmatic') => dialogApi.close(reason);
    Object.assign(close, { footer, body, status });
    close.showStatus = (message, error = false) => {
      status.textContent = String(message || '');
      status.hidden = !status.textContent;
      status.dataset.statusKind = error ? 'error' : 'info';
    };
    close.setBusy = (next) => {
      busy = !!next;
      overlay.setAttribute('aria-busy', busy ? 'true' : 'false');
      closeButton.disabled = busy;
    };
    dialogApi.open();
    return { overlay, modal, body, close };
  }

  function _pmFooter(closeModal, buttons, options = {}) {
    const footer = closeModal.footer;
    footer.classList.add('gb-modal-footer', 'gb-production-modal-footer');
    footer.dataset.modalFooter = '1';
    footer.replaceChildren();
    if (!footer.isConnected) closeModal.body?.parentElement?.appendChild(footer);
    if (closeModal.status && !closeModal.status.isConnected) closeModal.body?.appendChild(closeModal.status);
    const cancel = _pmButton('閉じる');
    if (options.e2eIdPrefix) cancel.dataset.e2eId = `${options.e2eIdPrefix}-cancel`;
    cancel.addEventListener('click', () => closeModal('cancel'));
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
    // 制作管理UX改善計画（2026-08-04）§6-1: 旧「担当者と時間を割り当て」（確認なし即実行）と
    // 旧「再計算」ダイアログを1本へ統合した（旧称「予定を組み直す」→ 2026-08-05 に
    // 「割当再計算」へ改名・かんたん割当も全廃してここへ一本化）。その後、2026-08-08 に
    // ユーザー判断で表示名のみ「自動割り当て」へ差し戻した（挙動・e2eId・エンドポイントは
    // 変更しない）。
    const { modal, body, close } = _pmModal('自動割り当て', '760px', {
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
    resultBox.dataset.e2eId = 'production-recalculate-result';
    const previewButton = _pmButton('プレビューを作成', true);
    previewButton.dataset.e2eId = 'production-recalculate-preview';
    const applyButton = _pmButton('適用', true);
    applyButton.dataset.e2eId = 'production-recalculate-apply';
    applyButton.disabled = true;
    let rows = [];
    let lastScope = {};
    let lastAllowOvertime = true;
    let lastUnassignedOnly = false;
    let previewRequestId = 0;
    let busyControls = null;
    const setBusy = (next, message = '') => {
      if (next) {
        busyControls = Array.from(modal.querySelectorAll('input, textarea, select, button'))
          .map(control => ({ control, disabled: control.disabled }));
        busyControls.forEach(({ control }) => { control.disabled = true; });
        close.setBusy(true);
        close.showStatus(message || '処理中です。画面を閉じずにお待ちください…');
        return;
      }
      close.setBusy(false);
      (busyControls || []).forEach(({ control, disabled }) => { control.disabled = disabled; });
      busyControls = null;
    };
    // 期間や対象を変えたら古いプレビュー結果を適用できないようにする（旧計画の誤適用防止）
    const resetPreview = () => {
      // 進行中のプレビュー応答（ネットワーク遅延中）が、後から届いて今回の変更を
      // 上書きしないようにする（2026-07-15 徹底チェックで発見: 応答待ち中にスコープの
      // チェックボックスだけを変更すると、日付は変わらないためサーバー側の陳腐化比較を
      // 素通りし、古いスコープのまま「適用」できてしまっていた）。
      previewRequestId += 1;
      rows = [];
      applyButton.disabled = true;
      resultBox.replaceChildren();
      const note = document.createElement('div');
      note.className = 'gb-production-preview-note';
      note.textContent = '期間や対象を変更しました。適用するには再度プレビューを作成してください。';
      resultBox.appendChild(note);
      close.showStatus('期間や対象を変更しました。再度プレビューを作成してください。');
      updateScopeValidity();
    };
    ['input', 'change'].forEach(eventName => {
      from.addEventListener(eventName, resetPreview);
      to.addEventListener(eventName, resetPreview);
    });

    // --- 残業を含める（既定OFF=残業なし。スケジューラー複数アカウント修正計画2026-08-13
    // Phase 3: 全入口の既定を「残業を含めない」に統一する。旧ラベル「シフト時間内に収める」は
    // チェックON＝残業なしという反転した意味で分かりにくかったため、新「自動割り当て」画面と
    // 同じ「残業を含める」（チェックON＝残業あり）に統一した ---
    const allowOvertimeToggle = document.createElement('input');
    allowOvertimeToggle.type = 'checkbox';
    allowOvertimeToggle.checked = false;
    allowOvertimeToggle.dataset.e2eId = 'gb-production-recalc-allow-overtime';
    const allowOvertimeLabel = document.createElement('label');
    allowOvertimeLabel.className = 'gb-check gb-production-check';
    const allowOvertimeText = document.createElement('span');
    allowOvertimeText.textContent = '残業を含める';
    allowOvertimeLabel.append(allowOvertimeToggle, allowOvertimeText);
    const allowOvertimeRow = document.createElement('div');
    allowOvertimeRow.className = 'gb-check-help-row gb-production-check-help-row';
    allowOvertimeRow.appendChild(allowOvertimeLabel);
    allowOvertimeRow.insertAdjacentHTML('beforeend', fieldHelp('オンにすると、シフト終了後から次の出勤までの時間も割り当て候補に含めます'));
    allowOvertimeRow.querySelector('.gb-field-help').dataset.e2eId = 'production-recalculate-overtime-help';
    allowOvertimeToggle.addEventListener('change', resetPreview);

    // --- 未割当のタスクだけ（旧「担当者と時間を割り当て」の即時実行に相当するスコープ）。
    // unassigned_only=true で送ると、既に作業予定日時があるタスクは固定扱いにし、
    // 未割当のタスクだけを新規に割り当てる（工程順・担当者候補は考慮する。制作管理UX
    // 改善計画2026-08-04 §6-1）。 ---
    const unassignedOnlyToggle = document.createElement('input');
    unassignedOnlyToggle.type = 'checkbox';
    unassignedOnlyToggle.checked = false;
    unassignedOnlyToggle.dataset.e2eId = 'production-recalculate-unassigned-only';
    const unassignedOnlyLabel = document.createElement('label');
    unassignedOnlyLabel.className = 'gb-check gb-production-check';
    const unassignedOnlyText = document.createElement('span');
    unassignedOnlyText.textContent = '未割当のタスクだけ';
    unassignedOnlyLabel.append(unassignedOnlyToggle, unassignedOnlyText);
    const unassignedOnlyRow = document.createElement('div');
    unassignedOnlyRow.className = 'gb-check-help-row gb-production-check-help-row';
    unassignedOnlyRow.appendChild(unassignedOnlyLabel);
    unassignedOnlyRow.insertAdjacentHTML('beforeend', fieldHelp('オンにすると、既に予定があるタスクは動かさず、まだ担当者や時間が決まっていないタスクだけに割り当てます'));
    unassignedOnlyRow.querySelector('.gb-field-help').dataset.e2eId = 'production-recalculate-unassigned-help';
    unassignedOnlyToggle.addEventListener('change', resetPreview);

    // --- 対象タスクリスト（作品ごとのシート）のスコープ選択（production-tasklist-redesign-plan
    // 2026-07-15 6.2章）: 既定は全選択=従来どおり期間内全件。一部だけチェックすると
    // work_titles で絞り込む。埋め込みシート側でチェックボックス選択がある場合は
    // 下の「選択中のN件だけを対象にする」切替で task_paths 指定に切り替えられる。 ---
    const scopeFieldset = document.createElement('fieldset');
    scopeFieldset.className = 'gb-production-recalc-scope';
    scopeFieldset.dataset.e2eId = 'production-recalculate-scope';
    const legend = document.createElement('legend');
    legend.textContent = '対象タスクリスト';
    const scopeActions = document.createElement('div');
    scopeActions.className = 'gb-production-recalc-scope-actions';
    const selectAllBtn = _pmButton('全選択');
    selectAllBtn.dataset.e2eId = 'production-recalculate-select-all';
    const selectNoneBtn = _pmButton('全解除');
    selectNoneBtn.dataset.e2eId = 'production-recalculate-select-none';
    scopeActions.append(selectAllBtn, selectNoneBtn);
    const scopeList = document.createElement('div');
    scopeList.className = 'gb-production-recalc-scope-list';
    const scopeHint = document.createElement('div');
    scopeHint.className = 'gb-production-recalc-scope-hint';
    scopeHint.textContent = '対象のタスクリストを1つ以上選択してください';
    scopeHint.hidden = true;
    scopeFieldset.append(legend, scopeActions, scopeList, scopeHint);

    let sheetCheckboxes = [];
    let scopeLoadState = 'loading';

    function updateScopeValidity() {
      const usingSelection = !!(selectedOnlyToggle && selectedOnlyToggle.checked);
      const noneSelected = !usingSelection && sheetCheckboxes.length > 0 && !sheetCheckboxes.some(item => item.checkbox.checked);
      const scopeUnavailable = !usingSelection && scopeLoadState !== 'ready';
      scopeHint.hidden = !noneSelected;
      previewButton.disabled = noneSelected || scopeUnavailable;
      selectAllBtn.disabled = scopeLoadState !== 'ready';
      selectNoneBtn.disabled = scopeLoadState !== 'ready';
    }

    async function loadScopeSheets() {
      scopeLoadState = 'loading';
      sheetCheckboxes = [];
      updateScopeValidity();
      scopeList.replaceChildren();
      const loading = document.createElement('span');
      loading.className = 'gb-production-recalc-scope-loading';
      loading.textContent = 'タスクリストを読み込み中…';
      scopeList.appendChild(loading);
      try {
        const data = await window.MeldexProductionApi.taskSheets();
        const sheets = Array.isArray(data?.sheets) ? data.sheets : [];
        scopeLoadState = 'ready';
        scopeList.replaceChildren();
        sheetCheckboxes = sheets.map(sheet => {
          const sheetWorkTitle = sheet.work_title || sheet.sheet_name;
          const item = document.createElement('label');
          item.className = 'gb-production-recalc-scope-item';
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = true;
          checkbox.dataset.e2eId = 'production-recalculate-sheet-' + String(sheet.sheet_name || '').replace(/[^\p{L}\p{N}_-]+/gu, '-');
          checkbox.addEventListener('change', () => { updateScopeValidity(); resetPreview(); });
          const text = document.createElement('span');
          text.textContent = sheetWorkTitle;
          item.append(checkbox, text);
          scopeList.appendChild(item);
          return { checkbox, workTitle: sheetWorkTitle };
        });
        if (!sheetCheckboxes.length) {
          const empty = document.createElement('span');
          empty.className = 'gb-production-recalc-scope-empty';
          empty.textContent = 'タスクリストがありません';
          scopeList.appendChild(empty);
        }
      } catch (error) {
        scopeList.replaceChildren();
        sheetCheckboxes = [];
        scopeLoadState = 'error';
        const errorText = document.createElement('span');
        errorText.className = 'gb-production-recalc-scope-error';
        errorText.textContent = 'タスクリストの一覧を取得できませんでした。再読み込みしてから実行してください。';
        const retry = _pmButton('再読み込み');
        retry.dataset.e2eId = 'production-recalculate-scope-retry';
        retry.addEventListener('click', () => { void loadScopeSheets(); });
        scopeList.append(errorText, retry);
      }
      updateScopeValidity();
    }
    selectAllBtn.addEventListener('click', () => {
      sheetCheckboxes.forEach(item => { item.checkbox.checked = true; });
      updateScopeValidity();
      resetPreview();
    });
    selectNoneBtn.addEventListener('click', () => {
      sheetCheckboxes.forEach(item => { item.checkbox.checked = false; });
      updateScopeValidity();
      resetPreview();
    });

    // --- 選択中タスクだけを対象にする切替（呼び出し元が埋め込みシートの選択行を渡した場合のみ表示） ---
    const selectedTaskPaths = Array.isArray(options.selectedTaskPaths) ? options.selectedTaskPaths.filter(Boolean) : [];
    let selectedOnlyField = null;
    let selectedOnlyToggle = null;
    if (selectedTaskPaths.length) {
      selectedOnlyToggle = document.createElement('input');
      selectedOnlyToggle.type = 'checkbox';
      selectedOnlyToggle.checked = true;
      selectedOnlyToggle.dataset.e2eId = 'production-recalculate-selected-only';
      selectedOnlyField = _pmField(`選択中の${selectedTaskPaths.length}件だけを対象にする`, selectedOnlyToggle);
      selectedOnlyToggle.addEventListener('change', () => {
        scopeFieldset.disabled = selectedOnlyToggle.checked;
        updateScopeValidity();
        resetPreview();
      });
      scopeFieldset.disabled = true;
    }

    function currentScopeBody() {
      if (selectedOnlyToggle?.checked) return { task_paths: selectedTaskPaths };
      const checked = sheetCheckboxes.filter(item => item.checkbox.checked).map(item => item.workTitle);
      // 全選択（既定）のときだけ絞り込みなし（期間内全件）にする。一覧取得失敗時は
      // previewButton自体を無効化し、失敗を「全件対象」として扱わない。
      if (sheetCheckboxes.length && checked.length < sheetCheckboxes.length) return { work_titles: checked };
      return {};
    }

    previewButton.addEventListener('click', async () => {
      if (previewButton.disabled) return;
      const requestId = ++previewRequestId;
      setBusy(true, '自動割り当てのプレビューを作成しています…');
      try {
        const scope = currentScopeBody();
        const allowOvertime = allowOvertimeToggle.checked;
        const unassignedOnly = unassignedOnlyToggle.checked;
        // current_user はスタッフ未登録時のソロフォールバック用（Desktopは認証セッションが
        // あればサーバー側で上書きする）。
        const result = await _pmRequest('/production-management/recalculate/preview', { date_from: from.value, date_to: to.value, allow_overtime: allowOvertime, unassigned_only: unassignedOnly, current_user: (typeof getUsername === 'function' ? String(getUsername() || '').trim() : ''), ...scope });
        if (requestId !== previewRequestId) return; // 待機中にスコープが変更され陳腐化した応答は破棄
        rows = result.rows || [];
        lastScope = scope;
        lastAllowOvertime = allowOvertime;
        lastUnassignedOnly = unassignedOnly;
        _pmRenderPreview(resultBox, result);
        applyButton.disabled = !rows.length;
        close.showStatus(`プレビューを作成しました: ${rows.length}件`);
      } catch (error) {
        if (requestId !== previewRequestId) return;
        // プレビュー失敗時は前回結果を残さない（古い計画の誤適用防止）
        rows = [];
        applyButton.disabled = true;
        close.showStatus(error?.message || String(error), true);
        _pmStatus(error?.message || String(error), true);
      } finally {
        setBusy(false);
        updateScopeValidity();
        applyButton.disabled = !rows.length;
      }
    });
    applyButton.addEventListener('click', async () => {
      setBusy(true, '自動割り当てを適用しています…');
      try {
        // プレビュー時と同じスコープ(work_titles/task_paths)・allow_overtime・unassigned_onlyを
        // 渡す: サーバー側の陳腐化検知は同一bodyでプレビューを再計算して比較するため、
        // スコープや条件が変わると誤って409になる。
        const result = await _pmRequest('/production-management/recalculate/apply', { date_from: from.value, date_to: to.value, rows, allow_overtime: lastAllowOvertime, unassigned_only: lastUnassignedOnly, current_user: (typeof getUsername === 'function' ? String(getUsername() || '').trim() : ''), ...lastScope });
        _pmStatus(`自動割り当てを適用しました: ${result.applied || 0}件`);
        _pmRefreshCalendars();
        // 埋め込みタスクリスト(あれば)にも反映する。
        document.dispatchEvent(new CustomEvent('meldex:production-task-updated', { detail: { reason: 'recalculate' } }));
        close('complete');
      } catch (error) {
        close.showStatus(error?.message || String(error), true);
        _pmStatus(error?.message || String(error), true);
      } finally {
        if (modal.isConnected) {
          setBusy(false);
          applyButton.disabled = !rows.length;
        }
      }
    });
    body.append(
      _pmField('開始日', from),
      _pmField('終了日', to),
      allowOvertimeRow,
      unassignedOnlyRow,
      ...(selectedOnlyField ? [selectedOnlyField] : []),
      scopeFieldset,
      resultBox
    );
    _pmFooter(close, [previewButton, applyButton], { e2eIdPrefix: 'production-recalculate' });
    loadScopeSheets();
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
    if (window.MeldexProductionUiAvailability?.ensureWritable?.() === false) return null;
    const { body, close } = _pmModal('メンバーを追加', '640px', {
      trigger: options?.trigger,
      e2eId: 'production-staff-add-dialog-overlay',
      dialogE2eId: 'production-staff-add-dialog',
    });
    const name = _pmInput('text', '', 'メンバー名');
    name.dataset.e2eId = 'production-staff-name';
    const user = document.createElement('select');
    user.className = 'gb-select gb-select-sm gb-production-input';
    user.dataset.e2eId = 'production-staff-user';
    const userPlaceholder = document.createElement('option');
    userPlaceholder.value = '';
    userPlaceholder.textContent = 'ユーザーを選択（未連携も可）';
    user.appendChild(userPlaceholder);
    _pmPopulateWorkspaceUsers(user, { allowEmpty: true, emptyLabel: 'ユーザーを選択（未連携も可）' }).catch(error => {
      console.warn('[ProductionManagement] ワークスペースのユーザー候補を読み込めませんでした', error);
    });
    const display = _pmInput('text', '', '表示名');
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
    window.MeldexProductionUiAvailability?.markWriteControl?.(saveButton);
    [name, user, display, workHours, breakHours, holidays, activeFrom, activeTo, googleUrl, caldavUrl, syncEnabled]
      .forEach(control => window.MeldexProductionUiAvailability?.markWriteControl?.(control));
    saveButton.addEventListener('click', async () => {
      saveButton.disabled = true;
      try {
        const staffName = name.value.trim();
        const staffUser = user.value.trim();
        if (staffName) {
          // 重複チェックは正本『スタッフ管理シート』（アカウント一元管理計画書
          // Phase 4で制作管理フル統合済み）から取得する。
          let staffList = [];
          try { staffList = await window.MeldexUserRegistry?.listStaff?.() || []; } catch { staffList = []; }
          const duplicateUser = staffUser && staffList.find(row => (
            String(row?.user || '').trim() === staffUser
            && String(row?.display || row?.entry_name || '').trim() !== staffName
          ));
          if (duplicateUser) {
            const duplicateLabel = duplicateUser.display || duplicateUser.entry_name || duplicateUser.user;
            _pmStatus(`ユーザー「${staffUser}」は「${duplicateLabel}」に連携済みです`, true);
            user.focus();
            return;
          }
          const exists = staffList.some(row => String(row?.display || row?.entry_name || '').trim() === staffName);
          if (exists && typeof cfConfirm === 'function') {
            const ok = await cfConfirm('同じ名前のメンバーがあります。入力内容で既存メンバーを更新しますか？');
            if (!ok) return;
          }
        }
        const result = await _pmRequest('/production-management/staff/add', {
          name: name.value, user: user.value, display: display.value,
          work_hours: workHours.value, break_hours: breakHours.value, holidays: holidays.value,
          active_from: activeFrom.value, active_to: activeTo.value,
          google_url: googleUrl.value, caldav_url: caldavUrl.value, sync_enabled: syncEnabled.checked,
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
      _pmField('メンバー名', name), _pmField('ユーザー（未連携可）', user),
      _pmField('表示名', display),
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
      _pmStatus(locked ? '自動割り当てで動かさないよう固定しました' : '自動割り当ての固定を解除しました');
      _pmRefreshCalendars();
    } else {
      _pmStatus(result.message || '固定を変更できませんでした', true);
    }
    return result;
  }

  function _pmShowRecalcBanner() {
    if (window.MeldexRuntimeAdapter?.isBrowserDataMode?.()) return;
    document.querySelector('.gb-production-recalc-banner')?.remove();
    const banner = document.createElement('div');
    banner.className = 'gb-production-recalc-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-label', '制作管理の自動割り当て案内');
    const text = document.createElement('span');
    text.className = 'gb-production-recalc-banner-text';
    text.textContent = 'メンバーを追加しました。自動割り当てしますか？';
    const open = _pmButton('自動割り当てを確認', true);
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
    menu.setAttribute('aria-label', '制作管理の自動割り当て固定メニュー');
    menu.dataset.e2eId = 'production-lock-menu';
    const closeMenu = (restore = true) => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      menu.remove();
      if (restore) _pmRestoreFocus(sourceEl);
    };
    // フル再計算エンジンはCloud（Dropboxモード）でも固定/解除を実行できる
    // （production-management-ux-improvement-plan-2026-08-04.md §4-1）。
    const makeItem = (label, locked) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'gb-context-menu-item';
      item.setAttribute('role', 'menuitem');
      item.innerHTML = `<span class="menu-icon">${_pmIcon(locked ? 'lock' : 'unlock', 14)}</span><span class="gb-context-menu-item-label"></span>`;
      item.querySelector('.gb-context-menu-item-label').textContent = label;
      item.addEventListener('click', () => {
        closeMenu(false);
        toggleProductionTaskRecalcLock(taskPath, locked, eventId);
      });
      return item;
    };
    const lock = makeItem('自動割り当てで固定', true);
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
