/* gb-tool-calendar-production-task-create.js: manga task bulk-create dialog */
(function() {
  'use strict';

  if (typeof CalendarComponent === 'undefined') return;

  const STANDARD_CONTENTS = ['ネーム', '下描き', '3D配置', 'ペン入れ', '仕上げ'];
  const MAX_TASKS = 5000;
  const DEFAULT_PAGE_COUNT = 19;
  const DEFAULT_PANEL_COUNT = 5;
  const UNIT_SPREAD = '見開き単位';
  const UNIT_PAGE = 'ページ単位';
  const UNIT_PANEL = 'コマ単位';
  const UNIT_OPTIONS = [UNIT_SPREAD, UNIT_PAGE, UNIT_PANEL];
  // 従来この画面は常にコマ単位で作成していた。作品側に粒度の保存が無い場合は同じ挙動を保つ。
  const DEFAULT_UNIT = UNIT_PANEL;
  // 割り当てをどこまで先の日付へ入れるか（自動割り当て画面の既定と揃える）。
  const AUTO_ASSIGN_DAYS = 30;
  let activeCatalogLoad = null;

  function api() {
    if (!window.MeldexProductionApi) throw new Error('制作管理APIを初期化できませんでした');
    return window.MeldexProductionApi;
  }

  function value(row, propName) {
    return String(row?.properties?.[propName] ?? '').trim();
  }

  function sorted(values) {
    return [...new Set((values || []).map(item => String(item || '').trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, 'ja', { numeric: true }));
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
    let sheets;
    if (typeof api().taskCreateCatalog === 'function') {
      try {
        const snapshot = await api().taskCreateCatalog();
        works = snapshot?.works;
        contents = snapshot?.contents;
        sheets = { sheets: snapshot?.task_sheets || [] };
      } catch (_error) {
        // Older Cloud providers do not know this combined read yet.  Keep the
        // established endpoints as a compatibility path; defaults remain usable
        // even when one optional catalog cannot be read.
      }
    }
    if (!works || !contents || !sheets) {
      [works, contents, sheets] = await Promise.all([
        api().list('作品リスト', { limit: 1000 }),
        api().list('作業内容リスト', { limit: 1000 }),
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
        // 件数見積りをサーバー側の生成数と一致させるために必要（保存済みの見開きは
        // 2ページで1単位になるため、単純な「ページ数×コマ数」では合わない）。
        startSide: value(row, '開始ページの位置'),
        spreads: value(row, '見開きページ'),
        granularity: value(row, '作業作成粒度'),
      });
    });
    const sheetRows = sheets?.sheets || [];
    const sheetWorks = sheetRows.map(sheet => sheet?.work_title || '').filter(Boolean);
    const sheetMeta = new Map(sheetRows.map(sheet => [String(sheet?.work_title || '').trim(), sheet]));
    workMeta.forEach((meta, name) => {
      const sheet = sheetMeta.get(name);
      meta.panelCount = meta.panelCount || Number(sheet?.panel_count) || 0;
      // 既にタスクがある作品で単位を変えると、旧単位のタスクが残ったまま新しく作られる
      // （作成キーに単位が入るため重複扱いにならない）。事前に知らせるために件数を持つ。
      meta.taskCount = Number(sheet?.count) || 0;
    });
    sheetWorks.forEach(name => {
      if (!workMeta.has(name)) {
        const sheet = sheetMeta.get(name);
        workMeta.set(name, {
          pageCount: 0,
          panelCount: Number(sheet?.panel_count) || 0,
          preset: '',
          taskCount: Number(sheet?.count) || 0,
        });
      }
    });
    return {
      works: sorted([...workMeta.keys(), ...sheetWorks]),
      workMeta,
      contents: sorted(rowCatalog(contents, '')),
    };
  }

  function loadCatalog() {
    if (activeCatalogLoad) return activeCatalogLoad;
    const pending = requestCatalog();
    activeCatalogLoad = pending.finally(() => { activeCatalogLoad = null; });
    return activeCatalogLoad;
  }

  function assignDateText(offsetDays) {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    const pad = number => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  /* 一括作成の直後に、その作品の未割当タスクへ続けて自動で割り当てる。
   *
   * 既に日時が入っているタスクは動かさない（unassigned_only）。他作品へ波及させないため
   * work_titles で今作った作品だけに絞る。適用はプレビューと同一の条件＋受け取った rows を
   * そのまま渡す必要がある（サーバーが同じ条件で再計算して突き合わせるため。条件がずれると
   * 409になる）。戻り値は {message, error} で、呼び出し元がトーストの種類を分ける。
   */
  async function autoAssign(workTitle) {
    // work_titles が空集合だとサーバーは「絞り込みなし＝全作品」として扱う。作品名が空の
    // まま呼ぶと他作品まで巻き込むため、ここで止める。
    const title = String(workTitle || '').trim();
    if (!title) return null;
    const request = {
      date_from: assignDateText(0),
      date_to: assignDateText(AUTO_ASSIGN_DAYS),
      // 「シフト時間内に収める」をオンにする（ユーザー判断 2026-08-08）。画面のチェックが
      // オン＝残業させない、なので allow_overtime は false。確認なしで走る自動実行では、
      // 勤務時間外へ勝手に予定を入れない側を既定にする。
      allow_overtime: false,
      unassigned_only: true,
      work_titles: [title],
      current_user: typeof getUsername === 'function' ? String(getUsername() || '').trim() : '',
    };
    try {
      const provider = api();
      const preview = await provider.recalculatePreview(request);
      const rows = Array.isArray(preview?.rows) ? preview.rows : [];
      const applied = rows.length
        ? Number((await provider.recalculateApply({ ...request, rows }))?.applied || 0)
        : 0;
      // 割り当てられない理由は「担当できる人がいない」「空き時間が足りない」「前工程が
      // 未割り当て」の3つがあり得る。期間を広げれば直る、と決めつけない。
      // 0件のときは何も書き換わっていないので一覧の再読み込みもしない（作成直後の読み込みと
      // 合わせて2回になり、無駄な往復が増える）。
      if (!applied) return { message: 'タスクは作成しましたが、割り当てはできませんでした。自動割り当てで内容を確認できます。' };
      // 割り当てた予定を一覧・カレンダーへ反映する（自動割り当て画面の適用後と同じ通知）。
      document.dispatchEvent(new CustomEvent('meldex:production-task-updated', {
        detail: { workTitle: title, reason: 'recalculate' },
      }));
      const leftover = Number(preview?.summary?.unassigned || 0);
      return {
        message: `${applied.toLocaleString('ja-JP')}件を割り当てました`
          + (leftover ? `（${leftover.toLocaleString('ja-JP')}件は割り当てられませんでした。自動割り当てで理由を確認できます）` : ''),
      };
    } catch (error) {
      // タスクは既に保存済み。割り当てだけの失敗で作成全体を失敗扱いにしない。
      console.error('[MeldexProductionTaskCreate] 自動割り当てに失敗しました', error);
      return { message: 'タスクは作成しましたが、割り当てはできませんでした。自動割り当てからやり直せます。', error: true };
    }
  }

  /* autoAssign を投げっぱなしで実行する（ダイアログを閉じてから結果を知らせる）。
   *
   * 割り当ては保存より時間がかかるため待たせない。作成が0件（全件が重複でスキップ）でも
   * 走らせる: 前回の実行が一覧更新の失敗などで割り当てまで届かなかった場合、ここで
   * 打ち切ると未割当のまま二度と自動で割り当てられなくなる。未割当のタスクが無ければ
   * プレビューが空で返るだけで実害はない。
   */
  function runAutoAssign(workTitle) {
    autoAssign(workTitle).then(result => {
      if (result?.message) notify(result.message, !!result.error);
    }).catch(error => {
      console.error('[MeldexProductionTaskCreate] 自動割り当ての通知に失敗しました', error);
    });
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
      try { source.focus({ preventScroll: true }); } catch (_error) { source.focus?.(); }
    };
    window.setTimeout?.(attempt, 0);
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

    const unit = document.createElement('select');
    unit.required = true;
    unit.dataset.e2eId = 'production-bulk-unit';
    UNIT_OPTIONS.forEach(name => unit.appendChild(option(name)));
    unit.value = DEFAULT_UNIT;

    const panelField = makeField('1ページのコマ数', panelCount);
    const fields = document.createElement('div');
    fields.className = 'gb-production-bulk-fields';
    fields.append(
      makeField('作品', work),
      makeField('ページ数', pageCount),
      makeField('作成単位', unit),
      panelField,
    );

    const contentFieldset = document.createElement('fieldset');
    contentFieldset.className = 'gb-production-bulk-contents';
    const legend = document.createElement('legend');
    legend.innerHTML = '作業内容 ' + fieldHelp('同じ作品・ページ・コマ・作業内容の組み合わせは重複作成しません。未登録の標準作業内容は自動で追加します。作業対象と作業規模は初期値で作成するので、あとから一覧で変更できます。');
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
    [work, pageCount, panelCount, unit, ...contentGrid.querySelectorAll('input')]
      .forEach(control => window.MeldexProductionUiAvailability?.markWriteControl?.(control));
    window.MeldexProductionUiAvailability?.markWriteControl?.(submit);
    window.MeldexProductionUiAvailability?.markWriteForm?.(form);

    let dialog = null;
    let busy = false;
    let closed = false;
    let catalogReady = false;
    let catalogFailed = false;
    let catalog = { works: [], workMeta: new Map(), contents: [] };
    let pageTouched = false;
    let panelTouched = false;
    let unitTouched = false;
    let headerClose = null;

    const close = force => {
      if (busy && !force) return;
      dialog?.close?.();
    };
    const integer = input => Number.isInteger(Number(input.value)) ? Number(input.value) : 0;
    const workMeta = () => catalog.workMeta.get(work.value.trim());
    // サーバーは「ページ数」ではなくページ単位の並び（見開きは2ページで1単位）でタスクを
    // 刻む。見積りが実際の生成数とずれないよう、生成側と同じ共通ロジックで数える。
    // 作品側の見開き設定が今のページ数で成立しない場合の説明文。空なら問題なし。
    let structureError = '';
    const unitCount = () => {
      structureError = '';
      const pages = integer(pageCount);
      if (pages < 1) return 0;
      const structure = window.MeldexProductionPageStructure;
      if (!structure) return pages;
      const meta = workMeta();
      const side = String(meta?.startSide || '');
      const saved = String(meta?.spreads || '');
      // 保存済みの見開きページが今のページ数で成立しないと、サーバーはどの単位でも作成を
      // 拒否する。同じ判定をここでして、押しても必ず失敗するボタンを出さない（この画面に
      // 見開きページの欄は無いため、気づかないと抜け出せない行き止まりになる）。
      const invalid = saved ? (structure.normalizeSpreads(saved, pages, side).invalid || []) : [];
      if (invalid.length) {
        structureError = `この作品の見開きページ「${invalid.join('、')}」は、ページ数${pages}では使えません。`
          + '「作品設定」で見開きページを直すか、ページ数を戻してください。';
        return 0;
      }
      try {
        const spreads = unit.value === UNIT_SPREAD ? structure.spreadOptions(pages, side) : saved;
        return structure.pageUnits(pages, spreads, side).length;
      } catch (error) {
        structureError = error?.message || '見開きページの設定を読み取れませんでした。「作品設定」を確認してください。';
        return 0;
      }
    };
    const perUnitCount = () => (unit.value === UNIT_PANEL ? integer(panelCount) : 1);
    const taskCount = () => unitCount() * perUnitCount() * selectedContents(contentGrid).length;
    const unitLabel = () => (unit.value === UNIT_SPREAD ? '見開き' : 'ページ');
    const sync = () => {
      const pages = integer(pageCount);
      const panels = integer(panelCount);
      const usesPanels = unit.value === UNIT_PANEL;
      panelField.hidden = !usesPanels;
      const contents = selectedContents(contentGrid);
      const units = unitCount();
      const count = units * perUnitCount() * contents.length;
      const invalidPanels = usesPanels && (panels < 1 || panels > 99);
      const invalidCount = pages < 1 || pages > 999 || invalidPanels || !contents.length
        || count > MAX_TASKS || !!structureError;
      const invalidWork = !work.value.trim();
      submit.disabled = busy || !catalogReady || catalogFailed || invalidCount || invalidWork;
      summary.classList.toggle('is-error', count > MAX_TASKS || !!structureError);
      const breakdown = usesPanels
        ? `${units}${unitLabel()} × ${panels}コマ × ${contents.length}工程`
        : `${units}${unitLabel()} × ${contents.length}工程`;
      if (structureError) summary.textContent = structureError;
      else summary.textContent = count > MAX_TASKS
        ? `${breakdown} = ${count.toLocaleString('ja-JP')}件（上限${MAX_TASKS.toLocaleString('ja-JP')}件）`
        : `${breakdown} = 最大${count.toLocaleString('ja-JP')}件`;
      const meta = catalog.workMeta.get(work.value.trim());
      // 既にタスクがある作品で単位を変えると、旧単位のタスクは残ったまま新しい単位のタスクが
      // 追加される（作成キーに単位が含まれるため重複扱いにならない）。気づかないと同じ作業が
      // 二重に並ぶので、作る前に知らせる。
      const savedUnit = UNIT_OPTIONS.includes(meta?.granularity) ? meta.granularity : '';
      const unitChanged = !!savedUnit && savedUnit !== unit.value && Number(meta?.taskCount) > 0;
      if (unitChanged) {
        warning.hidden = false;
        warning.textContent = `この作品には${Number(meta.taskCount).toLocaleString('ja-JP')}件のタスクが「${savedUnit}」で作られています。`
          + `「${unit.value}」で作ると、既存のタスクは残ったまま別に追加されます。`;
      } else {
        warning.hidden = !meta || !meta.preset || meta.preset === 'マンガ';
        warning.textContent = warning.hidden ? '' : 'この作品の既存設定を、ページ・コマ構成のマンガ設定へ更新します（既存タスクは削除しません）。';
      }
      form.setAttribute('aria-busy', catalogReady || catalogFailed ? 'false' : 'true');
      dialog?.modal?.toggleAttribute('data-catalog-ready', catalogReady);
    };
    const setBusy = value => {
      busy = !!value;
      dialog?.modal?.setAttribute('aria-busy', busy ? 'true' : 'false');
      [work, pageCount, panelCount, unit, ...contentGrid.querySelectorAll('input')].forEach(control => { control.disabled = busy; });
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
      if (!unitTouched) {
        unit.value = UNIT_OPTIONS.includes(meta?.granularity) ? meta.granularity : DEFAULT_UNIT;
      }
    };
    work.addEventListener('input', () => {
      applyWorkStructure();
      onInput();
    });
    pageCount.addEventListener('input', () => { pageTouched = true; onInput(); });
    panelCount.addEventListener('input', () => { panelTouched = true; onInput(); });
    unit.addEventListener('change', () => { unitTouched = true; onInput(); });
    contentGrid.addEventListener('change', onInput);

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
        const usesPanels = unit.value === UNIT_PANEL;
        // 作業対象・作業規模はこの画面から外した。キーごと送らないことでサーバー既定
        // （全体 / ページ全体）が使われる。空配列を送るとエラーになるので付けない。
        const data = await api().createTasks({
          work_title: workTitle,
          preset: 'マンガ',
          hierarchy_count: usesPanels ? 2 : 1,
          hierarchy_labels: usesPanels ? ['ページ', 'コマ'] : ['ページ'],
          granularity: unit.value,
          page_count: integer(pageCount),
          ...(usesPanels ? { panel_count: integer(panelCount) } : {}),
          content_names: selectedContents(contentGrid),
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
        // 一覧の更新に失敗しても、タスク自体は保存済みなので割り当ては続ける。ここで
        // 打ち切ると、案内どおり同じ条件で再実行しても全件が重複扱いになり、割り当てが
        // 二度と走らない行き止まりになる。
        if (shown === false) {
          result.textContent = 'タスクの保存は完了しましたが、一覧を更新できませんでした。同じ条件でもう一度実行すると、作成済み分は重複せず表示を再試行できます。';
          notify(result.textContent, true);
          setBusy(false);
          runAutoAssign(workTitle);
          return;
        }
        notify(`${created.toLocaleString('ja-JP')}件を追加しました${skipped ? `（${skipped.toLocaleString('ja-JP')}件は作成済み）` : ''}`);
        close(true);
        runAutoAssign(workTitle);
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
