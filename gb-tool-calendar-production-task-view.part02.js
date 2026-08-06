  // ---------------------------------------------------------------------
  // list switch bar (rebuilt in place, without touching the embed)
  // ---------------------------------------------------------------------

  function listSwitchButton(label, active, e2eId, onSelect) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gb-production-list-switch-btn' + (active ? ' is-active' : '');
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.tabIndex = active ? 0 : -1;
    button.dataset.e2eId = e2eId;
    button.textContent = label;
    button.addEventListener('click', onSelect);
    return button;
  }

  function buildAddListControl(component, state) {
    const wrap = document.createElement('span');
    wrap.className = 'gb-production-list-switch-add';
    if (!state.addingList) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gb-production-list-switch-btn gb-production-list-switch-add-btn';
      button.title = 'タスクリストを追加';
      button.setAttribute('aria-label', 'タスクリストを追加');
      button.dataset.e2eId = 'gb-production-list-switch-add-open';
      button.appendChild(icon('plus', 14));
      window.MeldexProductionUiAvailability?.markWriteControl?.(button);
      button.addEventListener('click', () => {
        state.addingList = true;
        renderListBar(component, state);
        state.listBarEl?.querySelector('[data-e2e-id="gb-production-list-switch-add-input"]')?.focus();
      });
      wrap.appendChild(button);
      return wrap;
    }
    const form = document.createElement('form');
    form.className = 'gb-production-list-switch-add-form';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '作品名（新しいタスクリスト）';
    input.dataset.e2eId = 'gb-production-list-switch-add-input';
    input.setAttribute('aria-label', '新しいタスクリストの作品名');
    window.MeldexProductionUiAvailability?.markWriteControl?.(input);
    const cancel = () => { state.addingList = false; renderListBar(component, state); };
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); cancel(); }
    });
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'submit';
    confirmBtn.className = 'gb-production-list-switch-add-confirm';
    confirmBtn.dataset.e2eId = 'gb-production-list-switch-add-confirm';
    confirmBtn.setAttribute('aria-label', '追加を確定');
    confirmBtn.appendChild(icon('check', 14));
    window.MeldexProductionUiAvailability?.markWriteControl?.(confirmBtn);
    window.MeldexProductionUiAvailability?.markWriteForm?.(form);
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'gb-production-list-switch-add-cancel';
    cancelBtn.setAttribute('aria-label', 'キャンセル');
    cancelBtn.appendChild(icon('x', 14));
    cancelBtn.addEventListener('click', cancel);
    form.append(input, confirmBtn, cancelBtn);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!ensureProductionWritable()) return;
      const workTitle = input.value.trim();
      if (!workTitle) { input.focus(); return; }
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      input.disabled = true;
      try {
        const created = await api().createTaskSheet({ work_title: workTitle });
        state.addingList = false;
        await loadSheetsAndMeta(component, state, { force: true });
        const sheet = state.sheets.find(item => item.sheet_name === created.sheet_name)
          || { sheet_name: created.sheet_name, work_title: created.work_title, dir: created.dir };
        selectTaskList(component, state, sheet);
        notify(`「${sheet.work_title}」のタスクリストを追加しました`);
      } catch (error) {
        notify(error?.message || 'タスクリストを追加できませんでした', true);
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
        input.disabled = false;
        input.focus();
      }
    });
    wrap.appendChild(form);
    return wrap;
  }

  function renderListBar(component, state) {
    const bar = state.listBarEl;
    if (!bar) return;
    const managedActive = !!managedListInfo(state.pendingTabKey) || state.selection?.kind === 'managed';
    bar.hidden = managedActive;
    bar.replaceChildren();
    if (managedActive) return;
    if (state.sheetsLoading && !state.sheetsLoaded) {
      const loading = document.createElement('span');
      loading.className = 'gb-production-list-switch-loading';
      loading.textContent = 'タスクリストを読み込み中…';
      bar.appendChild(loading);
      return;
    }
    if (state.sheetsError && !state.sheetsLoaded) {
      const error = document.createElement('span');
      error.className = 'gb-production-list-switch-error';
      error.textContent = state.sheetsError;
      bar.appendChild(error);
      bar.appendChild(makeButton('再試行', 'refreshCw', () => loadSheetsAndMeta(component, state, { force: true })));
      return;
    }
    const tabsModule = window.MeldexProductionListTabs || null;
    const arranged = tabsModule
      ? tabsModule.arrange(state.sheets, state.pmRootPath)
      : { visible: state.sheets, hidden: [] };
    if (state.sheets.length) {
      const allButton = listSwitchButton('すべて', state.selection?.kind === 'all', 'gb-production-list-switch-all', () => selectAllLists(component, state));
      // classList はテスト用DOMスタブに無いため className 連結で付与する
      allButton.className += ' gb-production-list-switch-all-btn';
      allButton.title = '全作品のタスクリストをまとめて表示';
      bar.appendChild(allButton);
    }
    arranged.visible.forEach((sheet, index) => {
      const active = state.selection?.kind === 'task' && state.selection.sheetName === sheet.sheet_name;
      // 作品名など日本語主体の文字列を潰さないよう、Unicodeの文字/数字はそのまま保持する
      // (ASCII限定の置換だと別作品同士のe2e-idが衝突し得るため)。
      const e2eId = 'gb-production-list-switch-task-' + sheet.sheet_name.replace(/[^\p{L}\p{N}_-]+/gu, '-');
      const button = listSwitchButton(sheet.work_title || sheet.sheet_name, active, e2eId, () => selectTaskList(component, state, sheet));
      tabsModule?.decorateTab(button, {
        sheetName: sheet.sheet_name,
        pmRoot: state.pmRootPath,
        sheets: state.sheets,
        canSwapLeft: index > 0,
        canSwapRight: index < arranged.visible.length - 1,
        onChanged: () => {
          renderListBar(component, state);
          // 「すべて」表示中はブロック順もタブ順へ即追従させる
          if (state.selection?.kind === 'all') openSelectionIfNeeded(component, state);
        },
        onHide: () => hideListTab(component, state, sheet),
      });
      bar.appendChild(button);
    });
    bar.appendChild(buildAddListControl(component, state));
    if (tabsModule && arranged.hidden.length) {
      bar.appendChild(tabsModule.buildHiddenMenuButton(arranged.hidden, {
        pmRoot: state.pmRootPath,
        sheets: state.sheets,
        onReopen: sheet => selectTaskList(component, state, sheet),
      }));
    }
    if (state.selection?.kind === 'task') {
      const structureButton = makeButton(
        'タスク構成を更新',
        'panelsTopLeft',
        event => openTaskStructureDialog(component, state, event.currentTarget),
      );
      structureButton.dataset.e2eId = 'gb-production-task-structure-open';
      structureButton.title = '作品設定のページ数・見開きページを未着手タスクへ反映';
      window.MeldexProductionUiAvailability?.markWriteControl?.(structureButton);
      bar.appendChild(structureButton);
    }
  }

  // タブを閉じる＝リスト切替バーからの非表示（タスクリスト本体は削除しない）。
  // 表示中のタブを閉じた場合は「すべて」へ退避して、表が空にならないようにする。
  function hideListTab(component, state, sheet) {
    const tabsModule = window.MeldexProductionListTabs;
    if (!tabsModule?.hideTab(state.pmRootPath, state.sheets, sheet.sheet_name)) return;
    notify(`「${sheet.work_title || sheet.sheet_name}」のタブを閉じました。「＋」の隣のボタンから再表示できます`);
    if (state.selection?.kind === 'task' && state.selection.sheetName === sheet.sheet_name) {
      selectAllLists(component, state);
      return;
    }
    renderListBar(component, state);
  }

  function openTaskStructureDialog(component, state, trigger) {
    if (!ensureProductionWritable()) return null;
    const workTitle = String(state.selection?.workTitle || '').trim();
    if (!workTitle || !window.GBUI?.createModal) {
      notify('作品別タスクリストを選択してから実行してください', true);
      return null;
    }
    const panel = document.createElement('section');
    panel.className = 'gb-production-quick-plan';
    panel.dataset.e2eId = 'gb-production-task-structure-dialog';
    const intro = document.createElement('p');
    intro.textContent = `「${workTitle}」のページ数・見開き設定を、未着手タスクへ反映します。進行中・完了・予定済み・実績あり・固定済みのタスクは変更しません。`;
    const summary = document.createElement('div');
    summary.className = 'gb-production-bulk-summary';
    summary.setAttribute('role', 'status');
    summary.setAttribute('aria-live', 'polite');
    summary.textContent = '変更内容を確認しています…';
    const detail = document.createElement('p');
    detail.className = 'gb-production-bulk-result';
    detail.setAttribute('role', 'alert');
    panel.append(intro, summary, detail);

    const cancel = makeButton('閉じる', 'x');
    const apply = makeButton('この構成に更新', 'check', null, true);
    apply.dataset.e2eId = 'gb-production-task-structure-apply';
    apply.disabled = true;
    let preview = null;
    let busy = true;
    const dialog = window.GBUI.createModal({
      title: 'タスク構成を更新',
      body: panel,
      footer: [cancel, apply],
      closeLabel: 'タスク構成の更新を閉じる',
      closeOnOverlay: false,
      closeOnEsc: false,
      extraClass: 'gb-production-modal',
    });
    const setBusy = value => {
      busy = !!value;
      dialog.modal.setAttribute('aria-busy', busy ? 'true' : 'false');
      cancel.disabled = busy;
      apply.disabled = busy || !preview?.apply_allowed;
      apply.textContent = busy ? '処理中…' : 'この構成に更新';
    };
    const close = () => { if (!busy) dialog.close?.(); };
    cancel.addEventListener('click', close);
    apply.addEventListener('click', async () => {
      if (!preview?.fingerprint || busy) return;
      setBusy(true);
      detail.textContent = '';
      try {
        const result = await api().applyTaskStructure({
          work_title: workTitle,
          fingerprint: preview.fingerprint,
        });
        await loadSheetsAndMeta(component, state, { force: true });
        await component._showProductionTaskWork?.(workTitle);
        document.dispatchEvent(new CustomEvent('meldex:production-task-updated', {
          detail: { workTitle, sourceComponent: component, structureUpdated: true },
        }));
        notify(
          `${Number(result.created || 0).toLocaleString('ja-JP')}件を作成し、`
          + `${Number(result.archived || 0).toLocaleString('ja-JP')}件をアーカイブしました。`
          + '必要に応じて「割当再計算」を実行してください。',
        );
        busy = false;
        dialog.close?.();
      } catch (error) {
        detail.textContent = error?.message || 'タスク構成を更新できませんでした。もう一度プレビューしてください。';
        setBusy(false);
      }
    });
    document.body.appendChild(dialog.overlay);
    window.GBModalShell?.enhanceOverlay?.(dialog.overlay);
    setBusy(true);
    api().previewTaskStructure({ work_title: workTitle }).then((data) => {
      preview = data;
      const units = (data.page_units || []).join('、');
      summary.textContent = [
        `ページ単位: ${units || '変更なし'}`,
        `新規 ${Number(data.create_count || 0)}件`,
        `アーカイブ ${Number(data.archive_count || 0)}件`,
        `保護して維持 ${Number(data.protected_count || 0)}件`,
        `変更なし ${Number(data.unchanged_count || 0)}件`,
      ].join(' ／ ');
      detail.textContent = data.protected_count
        ? '作業中・予定済みなどの保護対象は元の構成のまま残ります。'
        : data.apply_allowed ? '内容を確認して「この構成に更新」を押してください。' : '更新が必要なタスクはありません。';
      setBusy(false);
    }).catch((error) => {
      detail.textContent = error?.message || '変更内容を確認できませんでした。';
      setBusy(false);
    });
    return dialog;
  }

  async function refreshCalendarEvents(component) {
    if (typeof component?._loadEvents !== 'function') return { ok: true, skipped: true };
    try {
      return await component._loadEvents() || { ok: true };
    } catch (error) {
      return { ok: false, stale: false, error };
    }
  }

