/* gb-tool-calendar-production-task-create.js: manga task bulk-create dialog */
(function() {
  'use strict';

  if (typeof CalendarComponent === 'undefined') return;

  const STANDARD_CONTENTS = ['ネーム', '下描き', '3D配置', 'ペン入れ', '仕上げ'];
  const MAX_TASKS = 5000;
  const DEFAULT_PAGE_COUNT = 19;
  const DEFAULT_PANEL_COUNT = 5;
  let activeCatalogLoad = null;

  function api() {
    if (!window.MeldexProductionApi) throw new Error('制作管理APIを初期化できませんでした');
    return window.MeldexProductionApi;
  }

  function value(row, propName) {
    return String(row?.properties?.[propName] ?? '').trim();
  }

  function unique(values) {
    return [...new Set((values || []).map(item => String(item || '').trim()).filter(Boolean))];
  }

  function sorted(values) {
    return unique(values).sort((left, right) => left.localeCompare(right, 'ja', { numeric: true }));
  }

  function notify(message, error = false) {
    if (typeof showStatus === 'function') showStatus(message, error);
  }

  function ensureProductionWritable(options) {
    return window.MeldexProductionUiAvailability?.ensureWritable?.(options) !== false;
  }

  function makeButton(label, iconName, primary = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gb-production-task-button' + (primary ? ' primary' : '');
    if (iconName) {
      const icon = document.createElement('span');
      icon.className = 'gb-production-task-icon';
      if (typeof lucide === 'function') icon.innerHTML = lucide(iconName, 14);
      button.appendChild(icon);
    }
    button.appendChild(document.createTextNode(label));
    return button;
  }

  function makeField(labelText, control) {
    const field = document.createElement('label');
    field.className = 'gb-production-bulk-field';
    const label = document.createElement('span');
    label.className = 'gb-production-bulk-field-label';
    label.textContent = labelText;
    field.append(label, control);
    return field;
  }

  function option(valueText) {
    const item = document.createElement('option');
    item.value = valueText;
    item.textContent = valueText;
    return item;
  }

  function selectedContents(host) {
    return [...host.querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value);
  }

  function contentOption(name, checked) {
    const label = document.createElement('label');
    label.className = 'gb-production-bulk-check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = name;
    input.checked = checked;
    input.dataset.e2eContent = name;
    const text = document.createElement('span');
    text.textContent = name;
    label.append(input, text);
    return label;
  }

  function rowCatalog(data, propName) {
    return (data?.rows || []).map(row => value(row, propName) || String(row?.name || '').trim()).filter(Boolean);
  }

  async function requestCatalog() {
    let works;
    let contents;
    let targets;
    let scales;
    let sheets;
    if (typeof api().taskCreateCatalog === 'function') {
      try {
        const snapshot = await api().taskCreateCatalog();
        works = snapshot?.works;
        contents = snapshot?.contents;
        targets = snapshot?.targets;
        scales = snapshot?.scales;
        sheets = { sheets: snapshot?.task_sheets || [] };
      } catch (_error) {
        // Older Cloud providers do not know this combined read yet.  Keep the
        // established endpoints as a compatibility path; defaults remain usable
        // even when one optional catalog cannot be read.
      }
    }
    if (!works || !contents || !targets || !scales || !sheets) {
      [works, contents, targets, scales, sheets] = await Promise.all([
        api().list('作品リスト', { limit: 1000 }),
        api().list('作業内容リスト', { limit: 1000 }),
        api().list('作業対象リスト', { limit: 1000 }),
        api().list('作業規模リスト', { limit: 1000 }),
        api().taskSheets(),
      ]);
    }
    const workRows = Array.isArray(works?.rows) ? works.rows : [];
    const workMeta = new Map();
    workRows.forEach(row => {
      const name = String(row?.name || '').trim() || value(row, '作品タイトル_話数');
      if (!name) return;
      workMeta.set(name, {
        pageCount: Number(value(row, 'ページ数')) || 0,
        panelCount: Number(value(row, '生成コマ数')) || 0,
        preset: value(row, 'プリセット種別'),
      });
    });
    const sheetRows = sheets?.sheets || [];
    const sheetWorks = sheetRows.map(sheet => sheet?.work_title || '').filter(Boolean);
    const sheetMeta = new Map(sheetRows.map(sheet => [String(sheet?.work_title || '').trim(), sheet]));
    workMeta.forEach((meta, name) => {
      const sheet = sheetMeta.get(name);
      meta.panelCount = meta.panelCount || Number(sheet?.panel_count) || 0;
    });
    sheetWorks.forEach(name => {
      if (!workMeta.has(name)) workMeta.set(name, { pageCount: 0, panelCount: Number(sheetMeta.get(name)?.panel_count) || 0, preset: '' });
    });
    return {
      works: sorted([...workMeta.keys(), ...sheetWorks]),
      workMeta,
      contents: sorted(rowCatalog(contents, '')),
      targets: sorted(rowCatalog(targets, '')),
      scales: sorted(rowCatalog(scales, '')),
    };
  }

  function loadCatalog() {
    if (activeCatalogLoad) return activeCatalogLoad;
    const pending = requestCatalog();
    activeCatalogLoad = pending.finally(() => { activeCatalogLoad = null; });
    return activeCatalogLoad;
  }

  function focusableElements(modal) {
    return [...modal.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    )].filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length > 0);
  }

  function restoreFocusAfterClose(source, overlay) {
    let remaining = 12;
    const attempt = () => {
      window.MeldexCloudMobile?.refresh?.();
      window.MeldexCloudMobileEditBar?.refresh?.();
      if (!source?.isConnected || source.disabled) return;
      if (overlay?.isConnected || source.hidden || !source.getClientRects?.().length) {
        if (remaining-- > 0) window.setTimeout?.(attempt, 50);
        return;
      }
      const active = document.activeElement;
      const meaningful = active && active !== document.body && active !== document.documentElement && active !== source
        && active.isConnected && active.getClientRects?.().length;
      if (!meaningful) {
        try { source.focus({ preventScroll: true }); } catch (_error) { source.focus?.(); }
      }
    };
    window.setTimeout?.(attempt, 0);
  }

  function setOptions(select, values, preferred) {
    select.replaceChildren();
    sorted(values).forEach(name => select.appendChild(option(name)));
    if (preferred && [...select.options].some(item => item.value === preferred)) select.value = preferred;
  }

  function activeCalendarComponent() {
    if (typeof getActiveTab === 'function' && typeof getComponentInstance === 'function') {
      const activeTab = getActiveTab();
      const active = activeTab?.id ? getComponentInstance(activeTab.id) : null;
      if (active instanceof CalendarComponent) return active;
    }
    const rightPanel = document.getElementById('rp-calendar')?._calComponent;
    if (rightPanel instanceof CalendarComponent) return rightPanel;
    let found = null;
    if (typeof forEachComponent === 'function') {
      forEachComponent(instance => { if (!found && instance instanceof CalendarComponent) found = instance; });
    }
    return found;
  }

  function openDialog(component, trigger) {
    const current = component._productionTaskCreateDialog;
    if (current?.modal?.isConnected) {
      current.modal.focus?.();
      return current;
    }
    if (!ensureProductionWritable()) return null;
    if (!window.GBUI?.createModal) {
      notify('タスク一括作成画面を初期化できませんでした', true);
      return null;
    }

    const source = trigger || (typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement : null);
    const panel = document.createElement('section');
    panel.className = 'gb-production-bulk-create';
    panel.dataset.e2eId = 'production-bulk-create-form';

    const form = document.createElement('form');
    form.className = 'gb-production-bulk-form';
    form.noValidate = true;
    form.id = 'production-bulk-create-' + String(component.tabId || component.paneId || Date.now()).replace(/[^\w-]/g, '-');

    const work = document.createElement('input');
    work.type = 'text';
    work.required = true;
    work.maxLength = 120;
    work.autocomplete = 'off';
    work.placeholder = '作品名を入力または選択';
    work.dataset.e2eId = 'production-bulk-work';
    const workList = document.createElement('datalist');
    workList.id = 'production-bulk-work-list-' + String(component.tabId || component.paneId || Date.now()).replace(/[^\w-]/g, '-');
    work.setAttribute('list', workList.id);

    const pageCount = document.createElement('input');
    pageCount.type = 'number';
    pageCount.min = '1';
    pageCount.max = '999';
    pageCount.step = '1';
    pageCount.required = true;
    pageCount.value = String(DEFAULT_PAGE_COUNT);
    pageCount.inputMode = 'numeric';
    pageCount.dataset.e2eId = 'production-bulk-pages';

    const panelCount = document.createElement('input');
    panelCount.type = 'number';
    panelCount.min = '1';
    panelCount.max = '99';
    panelCount.step = '1';
    panelCount.required = true;
    panelCount.value = String(DEFAULT_PANEL_COUNT);
    panelCount.inputMode = 'numeric';
    panelCount.dataset.e2eId = 'production-bulk-panels';

    const target = document.createElement('select');
    target.required = true;
    target.dataset.e2eId = 'production-bulk-target';
    setOptions(target, ['全体'], '全体');
    const scale = document.createElement('select');
    scale.required = true;
    scale.dataset.e2eId = 'production-bulk-scale';
    setOptions(scale, ['ページ全体'], 'ページ全体');

    const fields = document.createElement('div');
    fields.className = 'gb-production-bulk-fields';
    fields.append(
      makeField('作品', work),
      makeField('ページ数', pageCount),
      makeField('1ページのコマ数', panelCount),
      makeField('作業対象', target),
      makeField('作業規模', scale),
    );

    const contentFieldset = document.createElement('fieldset');
    contentFieldset.className = 'gb-production-bulk-contents';
    const legend = document.createElement('legend');
    legend.innerHTML = '作業内容 ' + fieldHelp('同じ作品・ページ・コマ・作業対象・作業内容・作業規模の組み合わせは重複作成しません。未登録の標準作業内容は自動で追加します。');
    const contentGrid = document.createElement('div');
    contentGrid.className = 'gb-production-bulk-content-grid';
    contentGrid.dataset.e2eId = 'production-bulk-contents';
    STANDARD_CONTENTS.forEach(name => contentGrid.appendChild(contentOption(name, true)));
    contentFieldset.append(legend, contentGrid);

    const summary = document.createElement('div');
    summary.className = 'gb-production-bulk-summary';
    summary.setAttribute('role', 'status');
    summary.setAttribute('aria-live', 'polite');
    summary.dataset.e2eId = 'production-bulk-summary';
    const warning = document.createElement('p');
    warning.className = 'gb-production-bulk-warning';
    warning.hidden = true;
    warning.dataset.e2eId = 'production-bulk-conversion-warning';
    const result = document.createElement('p');
    result.className = 'gb-production-bulk-result';
    result.setAttribute('role', 'alert');
    result.dataset.e2eId = 'production-bulk-result';
    form.append(fields, workList, contentFieldset, summary, warning, result);
    panel.append(form);

    const cancel = makeButton('キャンセル', 'x');
    cancel.dataset.e2eId = 'production-bulk-cancel';
    const submit = makeButton('タスクを一括作成', 'listPlus', true);
    submit.type = 'submit';
    submit.dataset.e2eId = 'production-bulk-submit';
    submit.setAttribute('form', form.id);
    [work, pageCount, panelCount, target, scale, ...contentGrid.querySelectorAll('input')]
      .forEach(control => window.MeldexProductionUiAvailability?.markWriteControl?.(control));
    window.MeldexProductionUiAvailability?.markWriteControl?.(submit);
    window.MeldexProductionUiAvailability?.markWriteForm?.(form);

    let dialog = null;
    let busy = false;
    let closed = false;
    let catalogReady = false;
    let catalogFailed = false;
    let catalog = { works: [], workMeta: new Map(), contents: [], targets: ['全体'], scales: ['ページ全体'] };
    let pageTouched = false;
    let panelTouched = false;
    let headerClose = null;

    const close = force => {
      if (busy && !force) return;
      dialog?.close?.();
    };
    const integer = input => Number.isInteger(Number(input.value)) ? Number(input.value) : 0;
    const taskCount = () => integer(pageCount) * integer(panelCount) * selectedContents(contentGrid).length;
    const sync = () => {
      const pages = integer(pageCount);
      const panels = integer(panelCount);
      const contents = selectedContents(contentGrid);
      const count = taskCount();
      const invalidCount = pages < 1 || pages > 999 || panels < 1 || panels > 99 || !contents.length || count > MAX_TASKS;
      const invalidWork = !work.value.trim();
      submit.disabled = busy || !catalogReady || catalogFailed || invalidCount || invalidWork;
      summary.classList.toggle('is-error', count > MAX_TASKS);
      summary.textContent = count > MAX_TASKS
        ? `${pages}ページ × ${panels}コマ × ${contents.length}工程 = ${count.toLocaleString('ja-JP')}件（上限${MAX_TASKS.toLocaleString('ja-JP')}件）`
        : `${pages}ページ × ${panels}コマ × ${contents.length}工程 = 最大${count.toLocaleString('ja-JP')}件`;
      const meta = catalog.workMeta.get(work.value.trim());
      warning.hidden = !meta || !meta.preset || meta.preset === 'マンガ';
      warning.textContent = warning.hidden ? '' : 'この作品の既存設定を、ページ・コマ構成のマンガ設定へ更新します（既存タスクは削除しません）。';
      form.setAttribute('aria-busy', catalogReady || catalogFailed ? 'false' : 'true');
      dialog?.modal?.toggleAttribute('data-catalog-ready', catalogReady);
    };
    const setBusy = value => {
      busy = !!value;
      dialog?.modal?.setAttribute('aria-busy', busy ? 'true' : 'false');
      [work, pageCount, panelCount, target, scale, ...contentGrid.querySelectorAll('input')].forEach(control => { control.disabled = busy; });
      cancel.disabled = busy;
      if (headerClose) headerClose.disabled = busy;
      submit.replaceChildren();
      const iconName = busy ? 'loaderCircle' : 'listPlus';
      const icon = document.createElement('span');
      icon.className = 'gb-production-task-icon' + (busy ? ' is-spinning' : '');
      if (typeof lucide === 'function') icon.innerHTML = lucide(iconName, 14);
      submit.append(icon, document.createTextNode(busy ? '作成中…' : 'タスクを一括作成'));
      sync();
    };

    dialog = window.GBUI.createModal({
      title: 'タスクを一括作成',
      body: panel,
      footer: [cancel, submit],
      closeLabel: 'タスク一括作成を閉じる',
      closeOnOverlay: false,
      closeOnEsc: false,
      extraClass: 'gb-production-modal',
      onClose: () => {
        if (closed) return;
        closed = true;
        if (component._productionTaskCreateDialog?.overlay === dialog.overlay) component._productionTaskCreateDialog = null;
        restoreFocusAfterClose(source, dialog.overlay);
      },
    });
    dialog.overlay.classList.add('gb-production-modal-overlay');
    dialog.overlay.dataset.e2eId = 'production-bulk-create-overlay';
    dialog.modal.classList.add('gb-production-task-create-dialog');
    dialog.modal.style.setProperty('--gb-production-modal-width', '720px');
    dialog.modal.dataset.e2eId = 'production-bulk-create-dialog';
    dialog.header.classList.add('gb-production-modal-header');
    dialog.header.querySelector('.gb-modal-title')?.insertAdjacentHTML('beforeend', ' ' + fieldHelp('作品の全ページ・全コマへ、選んだ作業内容のタスクをまとめて作成します。'));
    dialog.body.classList.add('gb-production-modal-body');
    dialog.footer.classList.add('gb-production-modal-footer');
    dialog.footer.dataset.modalFooter = '1';
    headerClose = dialog.header.querySelector('.gb-modal-close');
    if (headerClose) headerClose.dataset.e2eId = 'production-bulk-create-close';

    cancel.addEventListener('click', () => close());
    dialog.overlay.addEventListener('click', event => { if (event.target === dialog.overlay) close(); });
    dialog.modal.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = focusableElements(dialog.modal);
      if (!focusable.length) { event.preventDefault(); dialog.modal.focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });

    const onInput = () => { result.textContent = ''; sync(); };
    const applyWorkStructure = () => {
      const meta = catalog.workMeta.get(work.value.trim());
      const savedPages = Number(meta?.pageCount);
      const savedPanels = Number(meta?.panelCount);
      if (!pageTouched) {
        pageCount.value = String(Number.isInteger(savedPages) && savedPages > 0
          ? Math.min(999, savedPages)
          : DEFAULT_PAGE_COUNT);
      }
      if (!panelTouched) {
        panelCount.value = String(Number.isInteger(savedPanels) && savedPanels > 0
          ? Math.min(99, savedPanels)
          : DEFAULT_PANEL_COUNT);
      }
    };
    work.addEventListener('input', () => {
      applyWorkStructure();
      onInput();
    });
    pageCount.addEventListener('input', () => { pageTouched = true; onInput(); });
    panelCount.addEventListener('input', () => { panelTouched = true; onInput(); });
    contentGrid.addEventListener('change', onInput);
    target.addEventListener('change', onInput);
    scale.addEventListener('change', onInput);

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!ensureProductionWritable()) return;
      sync();
      if (submit.disabled || busy) {
        if (!work.value.trim()) { result.textContent = '作品名を入力してください。'; work.focus(); }
        else if (!selectedContents(contentGrid).length) result.textContent = '作業内容を1つ以上選んでください。';
        else if (taskCount() > MAX_TASKS) result.textContent = `一度に作成できるタスクは${MAX_TASKS.toLocaleString('ja-JP')}件までです。`;
        return;
      }
      setBusy(true);
      result.textContent = '';
      const workTitle = work.value.trim();
      try {
        const data = await api().createTasks({
          work_title: workTitle,
          preset: 'マンガ',
          hierarchy_count: 2,
          hierarchy_labels: ['ページ', 'コマ'],
          granularity: 'コマ単位',
          page_count: integer(pageCount),
          panel_count: integer(panelCount),
          target_names: [target.value],
          content_names: selectedContents(contentGrid),
          scale_names: [scale.value],
        });
        const created = Number(data?.created || 0);
        const skipped = Number(data?.skipped || 0);
        let shown = true;
        if (typeof component._showProductionTaskWork === 'function') {
          shown = await component._showProductionTaskWork(workTitle);
          if (shown === false) {
            await new Promise(resolve => setTimeout(resolve, 500));
            shown = await component._showProductionTaskWork(workTitle);
          }
        } else {
          const refreshed = await component._refreshProductionTaskEmbed?.();
          shown = refreshed !== false;
        }
        document.dispatchEvent(new CustomEvent('meldex:production-task-updated', {
          detail: { workTitle, created, skipped, sourceComponent: component },
        }));
        if (shown === false) {
          result.textContent = 'タスクの保存は完了しましたが、一覧を更新できませんでした。同じ条件でもう一度実行すると、作成済み分は重複せず表示を再試行できます。';
          notify(result.textContent, true);
          setBusy(false);
          return;
        }
        notify(`${created.toLocaleString('ja-JP')}件を追加しました${skipped ? `（${skipped.toLocaleString('ja-JP')}件は作成済み）` : ''}`);
        close(true);
      } catch (error) {
        const message = error?.message || 'タスクを作成できませんでした。入力内容を確認してください。';
        const resume = '保存途中で止まった場合も、同じ条件でもう一度実行すると不足分だけを再開できます。';
        result.textContent = `${message} ${resume}`;
        notify(result.textContent, true);
        setBusy(false);
      }
    });

    document.body.appendChild(dialog.overlay);
    component._productionTaskCreateDialog = dialog;
    window.GBModalShell?.enhanceOverlay?.(dialog.overlay);
    sync();
    window.requestAnimationFrame?.(() => work.focus?.());

    const context = component._productionTaskContext?.() || {};
    work.value = String(context.workTitle || '').trim();
    sync();
    loadCatalog().then(data => {
      if (closed) return;
      catalog = data;
      workList.replaceChildren(...data.works.map(name => option(name)));
      setOptions(target, unique(['全体', ...data.targets]), '全体');
      setOptions(scale, unique(['ページ全体', ...data.scales]), 'ページ全体');
      const extraContents = data.contents.filter(name => !STANDARD_CONTENTS.includes(name));
      extraContents.forEach(name => contentGrid.appendChild(contentOption(name, false)));
      applyWorkStructure();
      catalogReady = true;
      catalogFailed = false;
      sync();
    }).catch(error => {
      if (closed) return;
      catalogFailed = true;
      result.textContent = '制作管理の設定を読み込めませんでした。通信状態を確認して、もう一度開いてください。';
      notify(error?.message || result.textContent, true);
      sync();
    });
    return dialog;
  }

  CalendarComponent.prototype._openProductionTaskCreate = function(trigger) {
    return openDialog(this, trigger);
  };

  window.MeldexProductionTaskCreateDialog = {
    open(component, trigger) {
      return component instanceof CalendarComponent ? openDialog(component, trigger) : null;
    },
    openActive(trigger) {
      const component = activeCalendarComponent();
      return component ? openDialog(component, trigger) : null;
    },
    standardContents: STANDARD_CONTENTS.slice(),
    maxTasks: MAX_TASKS,
  };
})();
