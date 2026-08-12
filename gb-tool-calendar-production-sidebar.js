/* gb-tool-calendar-production-sidebar.js: production task detail/template/unique-management-action sidebar */
(function() {
  'use strict';

  const STATE = new WeakMap();
  const EVENT_REQUESTS = new WeakMap();
  let LAST_BODY = null;
  let SIDEBAR_ID_SEQ = 0;
  const MODES = [
    ['detail', '詳細', 'fileText'],
    ['project', 'プロジェクト', 'folderKanban'],
    ['taskSettings', 'タスク設定', 'listChecks'],
    ['allocation', '割り当て', 'calendarClock'],
    ['calendar', 'カレンダー', 'calendarDays'],
  ];
  // production-tasklist-redesign-plan-2026-07-15 3.2章: 大分類=作品そのものになったため、
  // レベル列は新規タスクリストシートの 中分類/小分類/詳細分類（旧: 単位レベル1/2/3）を指す。
  // バックエンド meldex_production_task_sheets.resolve_level_prop_names と同じ優先順位
  // （作品の階層ラベル > 新名 > 旧名）で、行が実際に持つキーを解決する。
  const NEW_LEVEL_NAMES = ['中分類', '小分類', '詳細分類'];
  const LEGACY_LEVEL_NAMES = ['単位レベル1', '単位レベル2', '単位レベル3'];
  // 作業対象/作業内容/作業規模は管理リストからのドロップダウンにする
  // （production-tasklist-redesign-plan-2026-07-15 5.2/6.2章）。キーは
  // gb-tool-calendar-production-task-view.js の MANAGED_LISTS のkeyと揃えている。
  // staff（担当者）は Phase 1〜3 では制作管理ローカルの旧スタッフリストを
  // 直接一覧表示していたが、制作管理フル統合（アカウント一元管理計画書
  // Phase 4、§5.9手順7-8）で正本『スタッフ管理シート」参照へ切り替えたため、
  // このテーブルからは外し、populateStaffManagedSelect() で個別に扱う。
  const MANAGED_SELECT_SHEETS = {
    targets: { sheet: '作業対象リスト' },
    contents: { sheet: '作業内容リスト' },
    scales: { sheet: '作業規模リスト' },
  };

  function api() {
    if (!window.MeldexProductionApi) throw new Error('制作管理APIを初期化できませんでした');
    return window.MeldexProductionApi;
  }

  function icon(name, size = 14) {
    const span = document.createElement('span');
    span.className = 'gb-production-sidebar-icon';
    if (typeof lucide === 'function') span.innerHTML = lucide(name, size);
    return span;
  }

  function status(message, error) {
    if (typeof showStatus === 'function') showStatus(message, !!error);
  }

  function prop(row, name) {
    return row?.properties?.[name] ?? '';
  }

  function workTitle(row) {
    return prop(row, '作品タイトル') || row?.name || prop(row, '作品タイトル_話数');
  }

  function collaborationPath(row) {
    const path = String(row?.path || '').trim();
    if (!path || /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(path)) return path;
    const home = String(typeof _homeFolderPath !== 'undefined' ? _homeFolderPath || '' : window._homeFolderPath || '').replace(/[\\/]+$/, '');
    return home ? `${home}/${path.replace(/^[\\/]+/, '')}` : path;
  }

  function componentFor(options = {}) {
    return options.component || window.MeldexCalendarOptionPanel?.findCalendarComponent?.() || null;
  }

  function optionBody(select = true) {
    return window.MeldexCalendarOptionPanel?.container?.('スケジュール', {
      tabId: 'calendar-production',
      select,
    }) || null;
  }

  function existingOptionBody() {
    if (LAST_BODY && LAST_BODY.isConnected !== false) return LAST_BODY;
    if (typeof document.getElementById !== 'function') return null;
    return document.getElementById('detail-tab-calendar-production')
      ?.querySelector?.('.cal-option-body') || null;
  }

  function openMobileProductionDrawer(body, title) {
    const drawer = window.MeldexCloudMobileSideDrawer;
    if (!body?.parentNode || !drawer?.isEnabled?.() || typeof drawer.openElement !== 'function') return false;
    return !!drawer.openElement(title || 'スケジュール', body, { kind: 'scheduler' });
  }

  function closeProductionOptionPanelIfOpen() {
    const productionTab = document.getElementById('detail-tab-calendar-production');
    if (!productionTab || productionTab.hidden) return;
    if (typeof GBTabs !== 'undefined' && typeof GBTabs.findPaneWithTab === 'function' && typeof GBTabs.closeTab === 'function') {
      const detailTab = GBTabs.findPaneWithTab('detail', '');
      if (detailTab) {
        GBTabs.closeTab(detailTab.paneId, detailTab.tabId);
        return;
      }
    }
    const rightPanel = document.getElementById('right-panel');
    const activeRightTab = document.querySelector('.rp-tab.active')?.dataset?.rpTab;
    if (!rightPanel?.classList.contains('open') || activeRightTab !== 'detail') return;
    if (typeof toggleOptionPanel === 'function') toggleOptionPanel();
  }

  function emitUpdated(row, reason = 'task') {
    document.dispatchEvent(new CustomEvent('meldex:production-task-updated', { detail: { row, reason } }));
  }

  function rowIdentity(row) {
    return String(row?.path || row?.id || '').trim();
  }

  function isCurrentDetail(options, row) {
    const current = STATE.get(options.body);
    return !!current
      && current.revision === options.revision
      && rowIdentity(current.row) === rowIdentity(row);
  }

  function setDetailDirty(options, component, key, dirty, onClean) {
    const current = STATE.get(options.body);
    if (!current || current.revision !== options.revision) return;
    current[key] = !!dirty;
    current.detailDirty = !!(current.taskDetailDirty || current.classificationDirty);
    if (current.detailDirty) return;
    if (current.pendingRow) {
      const pendingRow = current.pendingRow;
      current.pendingRow = null;
      queueMicrotask(() => syncTask(pendingRow, component));
    } else if (typeof onClean === 'function') {
      onClean();
    }
  }

  function confirmDiscardUnsavedDetail(body, sameTarget, onConfirmed) {
    if (sameTarget) return true;
    const current = STATE.get(body);
    if (!current?.detailDirty) return true;
    // While a save request is in flight the edits are already being persisted, so
    // navigating away loses nothing; the save continuation guards with isCurrentDetail.
    if (current.saveInFlight) return true;
    const message = '編集中の変更があります。破棄して移動しますか？';
    if (typeof showConfirmDialog === 'function') {
      showConfirmDialog(message, () => onConfirmed?.());
      return false;
    }
    return typeof window.confirm === 'function' && window.confirm(message);
  }

  function runAfterDiscardConfirmation(body, sameTarget, action) {
    if (confirmDiscardUnsavedDetail(body, sameTarget, action)) action();
  }

  async function refreshProductionEvents(component) {
    if (!component || component._destroyed || typeof component._loadEvents !== 'function') return { ok: true, skipped: true };
    const result = await component._loadEvents();
    if (result?.ok === false) return result;
    if (component._surface === 'calendar' && typeof component._render === 'function') component._render();
    return result || { ok: true };
  }

  function nextEventRequest(body) {
    const next = (EVENT_REQUESTS.get(body) || 0) + 1;
    EVENT_REQUESTS.set(body, next);
    return next;
  }

  function button(label, iconName, handler, primary = false, writeAction = false) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'gb-production-sidebar-button' + (primary ? ' primary' : '');
    element.append(icon(iconName), document.createTextNode(label));
    element.addEventListener('click', handler);
    if (writeAction) window.MeldexProductionUiAvailability?.markWriteControl?.(element);
    return element;
  }

  function dateInputValue(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    return text.substring(0, 16);
  }

  function field(name, labelText, type, rawValue, helpText) {
    if (type === 'checkbox') {
      // 保護トグル（再計算ロック/担当者固定/シフト固定）は他の設定行と別レイアウト
      // （チェック+ラベルの横並び）にする（gb-check-help-row と同じ見た目にそろえる）。
      const row = document.createElement('div');
      row.className = 'gb-check-help-row gb-production-check-help-row';
      const label = document.createElement('label');
      label.className = 'gb-check gb-production-check';
      const control = document.createElement('input');
      control.type = 'checkbox';
      control.checked = String(rawValue || '').trim().toLowerCase() === 'true';
      control.dataset.propName = name;
      const caption = document.createElement('span');
      caption.textContent = labelText;
      label.append(control, caption);
      row.appendChild(label);
      if (helpText) row.insertAdjacentHTML('beforeend', fieldHelp(helpText));
      return { label: row, value: () => (control.checked ? 'true' : 'false'), controls: [control] };
    }
    const label = document.createElement('label');
    label.className = 'gb-production-sidebar-field';
    const caption = document.createElement('span');
    caption.textContent = labelText;
    label.appendChild(caption);
    if (type === 'range') {
      const wrap = document.createElement('div');
      wrap.className = 'gb-production-sidebar-date-range';
      const parts = String(rawValue || '').split('|');
      const start = document.createElement('input');
      start.type = 'datetime-local';
      start.value = dateInputValue(parts[0]);
      start.setAttribute('aria-label', `${labelText} 開始`);
      const end = document.createElement('input');
      end.type = 'datetime-local';
      end.value = dateInputValue(parts[1]);
      end.setAttribute('aria-label', `${labelText} 終了`);
      wrap.append(start, end);
      label.appendChild(wrap);
      return {
        label,
        value: () => start.value && end.value ? `${start.value}|${end.value}` : (start.value || end.value),
        controls: [start, end],
      };
    }
    let control;
    if (type === 'textarea') control = document.createElement('textarea');
    else if (type === 'status') {
      control = document.createElement('select');
      ['未着手', '着手中', '確認待ち', '完了', '保留'].forEach(value => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        control.appendChild(option);
      });
      if (rawValue && !Array.from(control.options).some(option => option.value === rawValue)) {
        const option = document.createElement('option');
        option.value = rawValue;
        option.textContent = rawValue;
        control.appendChild(option);
      }
    } else if (type === 'priority') {
      control = document.createElement('select');
      ['', '低', '通常', '高', '最優先'].forEach(priority => {
        const option = document.createElement('option');
        option.value = priority;
        option.textContent = priority || '未設定';
        control.appendChild(option);
      });
      if (rawValue && !Array.from(control.options).some(option => option.value === rawValue)) {
        const option = document.createElement('option');
        option.value = rawValue;
        option.textContent = rawValue;
        control.appendChild(option);
      }
    } else if (type === 'managed-select') {
      // 管理リスト（作業対象/作業内容/作業規模/スタッフ）からのドロップダウン。
      // 開いた時点でリストを非同期取得して選択肢を追加する（populateManagedSelect参照）。
      // 現在値は取得前でも選択肢として持たせておき、常に空選択もできるようにする。
      control = document.createElement('select');
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = '未設定';
      control.appendChild(blank);
      if (rawValue) {
        const option = document.createElement('option');
        option.value = rawValue;
        option.textContent = rawValue;
        control.appendChild(option);
      }
    } else {
      control = document.createElement('input');
      control.type = type;
      if (type === 'number') {
        const isHoursField = /時間/.test(name);
        control.step = isHoursField ? '0.25' : '1';
        if (name === '目標作業時間_値') control.min = '0.25';
        if (name === '対象数') control.min = '1';
      }
    }
    control.value = type === 'datetime-local' ? dateInputValue(rawValue) : (rawValue || (type === 'color' ? '#569cd6' : ''));
    control.dataset.propName = name;
    label.appendChild(control);
    return { label, value: () => control.value, controls: [control], selectEl: type === 'managed-select' ? control : null };
  }

  // 制作管理UX改善計画（2026-08-04）§6-2: 予定（作業予定日時＋作業予定時間）と目標時間
  // （目標作業時間_値）は再計算エンジン・同期フックが更新する自動列のため読み取り専用表示に
  // 統一する（タスクリスト側の計算列と同じ扱い。gb-db-computed-columns.js 参照）。
  function formatScheduleHoursDisplay(raw) {
    const num = Number(raw);
    if (!Number.isFinite(num) || num <= 0) return '';
    const rounded = Math.round(num * 10) / 10;
    return `${rounded}h`;
  }

  function formatScheduleRangeDisplay(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    const [startRaw, endRaw] = text.split('|');
    const start = dateInputValue(startRaw).replace('T', ' ');
    const end = dateInputValue(endRaw).replace('T', ' ');
    if (!start && !end) return '';
    if (start && end) {
      const sameDay = start.slice(0, 10) === end.slice(0, 10);
      return sameDay ? `${start}〜${end.slice(11)}` : `${start}〜${end}`;
    }
    return start || end;
  }

  function readOnlyField(labelText, displayText, options = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'gb-production-sidebar-field gb-production-sidebar-readonly';
    wrap.dataset.e2eId = options.e2eId || '';
    const caption = document.createElement('span');
    caption.textContent = labelText;
    wrap.appendChild(caption);
    const value = document.createElement('div');
    value.className = 'gb-production-sidebar-readonly-value';
    value.textContent = displayText || '未設定';
    if (options.warning) {
      const warn = document.createElement('span');
      warn.className = 'gb-production-sidebar-readonly-warning';
      warn.textContent = '⚠';
      warn.title = options.warning;
      warn.setAttribute('aria-label', options.warning);
      value.appendChild(document.createTextNode(' '));
      value.appendChild(warn);
    }
    wrap.appendChild(value);
    return wrap;
  }

  // 選択肢が非同期で届く間もフィールドの識別子(DOM要素)は差し替えない。
  // 取得できたら既存のselect要素へoptionを追加するだけに留め、進行中の入力・
  // ダーティ判定・イベント登録済みの要素参照を壊さない。
  async function populateManagedSelect(selectEl, managedKey, options, row) {
    if (managedKey === 'staff') return populateStaffManagedSelect(selectEl, options, row);
    const info = MANAGED_SELECT_SHEETS[managedKey];
    if (!info || !selectEl) return;
    let rows;
    try {
      const data = await api().list(info.sheet, { limit: 1000 });
      rows = data?.rows || [];
    } catch (error) {
      console.warn('選択肢を読み込めませんでした: ' + info.sheet, error);
      return; // 現行のselect(現在値のみ)を維持する。呼び出し元でのテキスト入力化は行わない。
    }
    if (!isCurrentDetail(options, row) || !selectEl.isConnected) return; // 古い応答は破棄
    const existingByValue = new Map(Array.from(selectEl.options).map(option => [option.value, option]));
    rows.forEach(item => {
      const value = info.nameProp ? prop(item, info.nameProp) : (item.name || '');
      if (!value) return;
      const displayText = info.displayProp ? (prop(item, info.displayProp) || item.name || value) : value;
      const existing = existingByValue.get(value);
      if (existing) { existing.textContent = displayText; return; }
      const option = document.createElement('option');
      option.value = value;
      option.textContent = displayText;
      selectEl.appendChild(option);
      existingByValue.set(value, option);
    });
  }

  // 「担当者」は正本『スタッフ管理シート』（window.MeldexUserRegistry）から
  // 候補を取得する（アカウント一元管理計画書 Phase 4 §5.9手順7-8）。
  async function populateStaffManagedSelect(selectEl, options, row) {
    if (!selectEl) return;
    let staff;
    try {
      staff = await window.MeldexUserRegistry?.listStaff?.() || [];
    } catch (error) {
      console.warn('スタッフ候補を読み込めませんでした', error);
      return;
    }
    if (!isCurrentDetail(options, row) || !selectEl.isConnected) return; // 古い応答は破棄
    const existingByValue = new Map(Array.from(selectEl.options).map(option => [option.value, option]));
    staff.forEach(item => {
      const value = String(item?.user || '').trim();
      if (!value) return;
      const displayText = item.display || value;
      const existing = existingByValue.get(value);
      if (existing) { existing.textContent = displayText; return; }
      const option = document.createElement('option');
      option.value = value;
      option.textContent = displayText;
      selectEl.appendChild(option);
      existingByValue.set(value, option);
    });
  }

  function splitLevelLabels(text) {
    return String(text || '').split(/[,、]+/).map(part => part.trim()).filter(Boolean);
  }

  // 表示用ラベル(3段、新名で既定)。既存の呼び出し規約(作品ごとのworkMeta優先、無ければ
  // 行の階層ラベル、それも無ければ既定名)は変更しない。
  function classificationLabels(row, component) {
    const title = workTitle(row);
    const meta = component?._productionTaskState?.workMeta?.[title];
    const source = meta?.classification_labels || prop(row, '階層ラベル') || NEW_LEVEL_NAMES.join(',');
    const labels = Array.isArray(source) ? source : splitLevelLabels(source);
    return NEW_LEVEL_NAMES.map((fallback, index) => String(labels[index] || fallback).trim() || fallback);
  }

  // キー解決用の生ラベル配列（既定名で埋めない。3.2章のresolve_level_prop_namesと同じ
  // 優先順位で使うため、「作品が実際にカスタムラベルを設定しているか」を区別する必要がある）。
  function rawClassificationLabels(row, component) {
    const title = workTitle(row);
    const meta = component?._productionTaskState?.workMeta?.[title];
    if (Array.isArray(meta?.classification_labels) && meta.classification_labels.length) return meta.classification_labels;
    return splitLevelLabels(prop(row, '階層ラベル'));
  }

  function levelPropCandidates(customLabels, index) {
    const candidates = [];
    const custom = String(customLabels?.[index] || '').trim();
    if (custom) candidates.push(custom);
    if (NEW_LEVEL_NAMES[index]) candidates.push(NEW_LEVEL_NAMES[index]);
    if (LEGACY_LEVEL_NAMES[index]) candidates.push(LEGACY_LEVEL_NAMES[index]);
    return [...new Set(candidates)];
  }

  // 行が実際に持つキーを優先順位どおりに探す（表示にも保存先にも使う）。
  //
  // 行に既存データがあればそのキーをそのまま使う（新旧混在データへの後方互換）。無ければ
  // resolve_level_prop_names と同じ優先順位（作品固有の階層ラベル > 中分類/小分類/詳細分類 >
  // 単位レベルN）の先頭候補を使う。PATCH /production-management/entries は対象エントリが
  // 実際に属するシートの現行スキーマ（meldex_production_task_sheets.task_sheet_entry_schema。
  // 改名後の実プロパティ名を含む）に対して検証するため、ここで新名を書き込み先に選んでも
  // 「存在しない項目です」の400にはならない（2026-07-15 フェーズD1で解消。旧: 常に旧名
  // 単位レベルNへ固定して書き込む回避策だった）。
  function resolveLevelPropName(row, customLabels, index) {
    const candidates = levelPropCandidates(customLabels, index);
    const props = row?.properties || {};
    const existing = candidates.find(name => Object.prototype.hasOwnProperty.call(props, name));
    return existing || candidates[0] || '';
  }

  function classificationEditor(row, component, options) {
    const section = document.createElement('section');
    section.className = 'gb-production-classification-editor';
    const heading = document.createElement('div');
    heading.className = 'gb-production-sidebar-section-title';
    const title = document.createElement('strong');
    title.textContent = '分類名';
    const help = document.createElement('span');
    help.textContent = 'この作品だけに適用';
    heading.appendChild(title);
    // ここでの変更は表示ラベル(階層ラベル)のみで、シート自体の列名は変わらない
    // （production-tasklist-redesign-plan-2026-07-15 6章: 現状の制約として、埋め込みシート
    // 単体では「開いている作品のシート」を安全に特定できないため列名の実改名は行わない）。
    heading.insertAdjacentHTML('beforeend', ' ' + fieldHelp('ここで変更できるのは、この作品で使う分類の表示ラベルだけです。制作管理に必要な列の名前や種類は変更できません。'));
    heading.appendChild(help);
    const fieldControls = [];
    const controls = classificationLabels(row, component).map((value, index) => {
      const item = field(`level-label-${index + 1}`, `${index + 1}段目`, 'text', value);
      section.appendChild(item.label);
      fieldControls.push(...(item.controls || []));
      return item;
    });
    fieldControls.forEach(control => window.MeldexProductionUiAvailability?.markWriteControl?.(control));
    let initialValues = controls.map(item => String(item.value() ?? ''));
    const updateDirtyState = () => {
      const dirty = controls.some((item, index) => String(item.value() ?? '') !== initialValues[index]);
      setDetailDirty(options, component, 'classificationDirty', dirty);
    };
    section.addEventListener('input', updateDirtyState);
    section.addEventListener('change', updateDirtyState);
    const save = button('分類名を保存', 'save', async event => {
      const work = workTitle(row);
      if (!work) {
        status('作品が設定されていないため分類名を保存できません', true);
        return;
      }
      const control = event.currentTarget;
      control.disabled = true;
      fieldControls.forEach(item => { item.disabled = true; });
      const savingState = STATE.get(options.body);
      if (savingState) savingState.saveInFlight = true;
      try {
        const data = await api().list('作品リスト', { q: work, limit: 100 });
        const workRow = (data.rows || []).find(item => item.name === work || prop(item, '作品タイトル_話数') === work);
        if (!workRow) throw new Error('作品リストに対象の作品が見つかりません');
        const labels = controls.map(item => item.value().trim()).map((value, index) => value || NEW_LEVEL_NAMES[index]);
        await api().patchEntry({ sheet: '作品リスト', path: workRow.path, id: workRow.id, properties: { '階層数': '3', '階層ラベル': labels.join(',') } });
        if (component?._productionTaskState?.workMeta?.[work]) {
          component._productionTaskState.workMeta[work].classification_labels = labels;
          component._productionTaskState.workMeta[work].classification_count = 3;
        }
        status('この作品の分類名を保存しました');
        initialValues = labels.slice();
        setDetailDirty(options, component, 'classificationDirty', false);
        emitUpdated(row, 'classification-labels');
      } catch (error) {
        status(error?.message || '分類名を保存できませんでした', true);
      } finally {
        control.disabled = false;
        fieldControls.forEach(item => { item.disabled = false; });
        if (savingState) savingState.saveInFlight = false;
      }
    }, false, true);
    save.dataset.e2eId = 'gb-production-classification-label-save';
    section.prepend(heading);
    section.appendChild(save);
    return section;
  }

  function taskDetail(content, row, options) {
    content.replaceChildren();
    if (!row) {
      const empty = document.createElement('div');
      empty.className = 'gb-production-sidebar-empty';
      empty.append(icon('mousePointerClick', 22));
      const title = document.createElement('strong');
      title.textContent = 'タスクを選択してください';
      const description = document.createElement('p');
      description.textContent = 'カレンダー上の制作予定を選ぶと詳細を編集できます。';
      empty.append(title, description);
      content.appendChild(empty);
      return;
    }
    const component = componentFor(options);
    const header = document.createElement('div');
    header.className = 'gb-production-sidebar-detail-header';
    const heading = document.createElement('strong');
    heading.textContent = row.name || '制作タスク';
    const work = document.createElement('span');
    work.textContent = workTitle(row) || '作品未設定';
    header.append(heading, work);
    const form = document.createElement('form');
    form.className = 'gb-production-sidebar-form';
    form.dataset.e2eId = 'gb-production-task-detail-form';
    const controls = new Map();
    const fieldControls = [];
    const managedSelectQueue = []; // { item, managedKey } — 開いた後に非同期で選択肢を補う
    const buildField = (name, label, type, managedKey, rawValueOverride, helpText) => {
      const rawValue = rawValueOverride !== undefined ? rawValueOverride : prop(row, name);
      const item = field(name, label, type, rawValue, helpText);
      controls.set(name, item);
      form.appendChild(item.label);
      fieldControls.push(...(item.controls || []));
      if (managedKey && item.selectEl) managedSelectQueue.push({ item, managedKey });
      return item;
    };
    buildField('状況', '状況', 'status');
    buildField('担当者', '担当者', 'managed-select', 'staff');
    // レベル欄: resolveLevelPropName() が行の実データキー（無ければ優先順位の先頭候補）を
    // 解決し、表示・保存先の両方にそのキーを使う。
    const displayLevelLabels = classificationLabels(row, component);
    const rawLevelLabels = rawClassificationLabels(row, component);
    displayLevelLabels.forEach((labelText, index) => {
      const levelName = resolveLevelPropName(row, rawLevelLabels, index);
      buildField(levelName, labelText, 'text');
    });
    buildField('作業対象リスト', '作業対象', 'managed-select', 'targets');
    buildField('作業内容リスト', '作業内容', 'managed-select', 'contents');
    buildField('作業規模リスト', '作業規模', 'managed-select', 'scales');
    buildField('対象数', '対象数', 'number');
    // 制作管理UX改善計画（2026-08-04）§6-2: 予定（作業予定日時＋作業予定時間）と目標時間は
    // 再計算エンジン・同期フックが更新する自動列のため読み取り専用表示にする（編集フォームの
    // controls/changedProperties には含めない＝保存対象外）。
    const scheduleReason = prop(row, 'シフト割当不能理由');
    const scheduleText = [
      formatScheduleRangeDisplay(prop(row, '作業予定日時')),
      formatScheduleHoursDisplay(prop(row, '作業予定時間')) ? `（${formatScheduleHoursDisplay(prop(row, '作業予定時間'))}）` : '',
    ].filter(Boolean).join(' ');
    form.appendChild(readOnlyField('予定', scheduleText, {
      e2eId: 'gb-production-task-detail-schedule',
      warning: scheduleReason ? `シフト割当不能: ${scheduleReason}` : '',
    }));
    form.appendChild(readOnlyField('目標時間', formatScheduleHoursDisplay(prop(row, '目標作業時間_値')), {
      e2eId: 'gb-production-task-detail-target-hours',
    }));
    buildField('優先度', '優先度', 'priority');
    buildField('対象色', '色', 'color');
    buildField('作業時間_実績', '実績（時間）', 'number');
    buildField('開始日時', '開始日時', 'datetime-local');
    buildField('完了日時', '完了日時', 'datetime-local');
    buildField('備考', '備考', 'textarea');
    // 保護トグル（再計算ロック/担当者固定/シフト固定）。カレンダー上のドラッグ移動・
    // リサイズ（§6-4）は書き戻し時に「シフト固定」を自動付与する。
    buildField('再計算ロック', '再計算ロック', 'checkbox', null, undefined, 'オンにすると、このタスクは自動割り当てで動かなくなります');
    buildField('担当者固定', '担当者固定', 'checkbox', null, undefined, 'オンにすると、自動割り当てでも担当者が変わりません');
    buildField('シフト固定', 'シフト固定', 'checkbox', null, undefined, 'オンにすると、この予定日時は自動割り当てで動かなくなります');
    const hierarchy = window.MeldexProductionTaskHierarchyUi?.create?.({
      parentValue: prop(row, '親タスクID'),
      checklistValue: prop(row, 'チェックリスト'),
      rowId: row.id,
      scopePath: row.path,
      onChange: () => form.dispatchEvent(new Event('change', { bubbles: true })),
    });
    if (hierarchy) {
      controls.set('親タスクID', hierarchy.parentControl);
      controls.set('チェックリスト', hierarchy.checklistControl);
      form.appendChild(hierarchy.root);
      fieldControls.push(...hierarchy.parentControl.controls, ...hierarchy.checklistInputs());
    }
    fieldControls.forEach(control => window.MeldexProductionUiAvailability?.markWriteControl?.(control));
    const initialValues = new Map(Array.from(controls, ([name, item]) => [name, String(item.value() ?? '')]));
    managedSelectQueue.forEach(({ item, managedKey }) => {
      populateManagedSelect(item.selectEl, managedKey, options, row);
    });
    const changedProperties = () => {
      const properties = {};
      controls.forEach((item, name) => {
        const next = String(item.value() ?? '');
        if (next !== initialValues.get(name)) properties[name] = next;
      });
      return properties;
    };
    const updateDirtyState = () => {
      setDetailDirty(options, component, 'taskDetailDirty', Object.keys(changedProperties()).length > 0);
    };
    form.addEventListener('input', updateDirtyState);
    form.addEventListener('change', updateDirtyState);
    const actions = document.createElement('div');
    actions.className = 'gb-production-sidebar-actions';
    const save = button('変更を保存', 'save', () => {}, true, true);
    save.type = 'submit';
    save.dataset.e2eId = 'gb-production-task-detail-save';
    const source = button('元シートを開く', 'externalLink', () => {
      if (row.path && typeof openPage === 'function') openPage(row.name || '制作タスク', row.path);
    });
    actions.append(save, source);
    const collaboration = document.createElement('div');
    collaboration.className = 'gb-production-sidebar-actions gb-production-collaboration-actions';
    collaboration.setAttribute('role', 'group');
    collaboration.setAttribute('aria-label', 'タスクについて相談・確認');
    const chatPath = collaborationPath(row);
    const runCollaboration = async (control, failureMessage, callback) => {
      if (control.dataset.busy === 'true') return;
      control.dataset.busy = 'true';
      control.disabled = true;
      control.setAttribute('aria-busy', 'true');
      try { await callback(); }
      catch (error) { status(error?.message || failureMessage, true); }
      finally {
        control.dataset.busy = 'false';
        control.disabled = false;
        control.setAttribute('aria-busy', 'false');
      }
    };
    const chat = button('チャット', 'messageSquare', () => runCollaboration(chat, 'このタスクのチャットを開けません', async () => {
      if (!chatPath || typeof window.openEntityChatForPath !== 'function') throw new Error('このタスクのチャットを開けません');
      const opened = await window.openEntityChatForPath(chatPath);
      if (opened === false) throw new Error('このタスクのチャットを開けません');
      document.dispatchEvent(new CustomEvent('meldex:production-collaboration-handoff', {
        detail: { kind: 'chat', path: row.path, resolvedPath: chatPath },
      }));
      status('このタスクのチャットを開きました');
    }));
    chat.dataset.e2eId = 'gb-production-task-collaboration-chat';
    chat.dataset.gbTooltip = 'このタスクのチャットで相談し、ファイルを共有します';
    const note = button('ノート', 'fileText', () => runCollaboration(note, 'このタスクのノートを開けません', async () => {
      if (!row.path || typeof openPage !== 'function') throw new Error('このタスクのノートを開けません');
      await openPage(row.name || '制作タスク', row.path);
      document.dispatchEvent(new CustomEvent('meldex:production-collaboration-handoff', {
        detail: { kind: 'note', path: row.path },
      }));
      status('このタスクのノートを開きました');
    }));
    note.dataset.e2eId = 'gb-production-task-collaboration-note';
    note.dataset.gbTooltip = 'このタスクのノートを開きます';
    const annotation = button('注釈', 'messagesSquare', () => runCollaboration(annotation, 'このタスクの注釈を開けません', async () => {
      if (!row.path || typeof openPage !== 'function' || typeof openRightPanelTab !== 'function') throw new Error('このタスクの注釈を開けません');
      await openPage(row.name || '制作タスク', row.path);
      openRightPanelTab('annotation', { surface: 'main' });
      const annotationOpened = document.getElementById('right-panel')?.classList.contains('open')
        || (typeof GBTabs !== 'undefined' && !!GBTabs.findPaneWithTab?.('annotation', ''));
      if (annotationOpened) {
        document.dispatchEvent(new CustomEvent('meldex:production-collaboration-handoff', {
          detail: { kind: 'annotation', path: row.path },
        }));
        status('このタスクの注釈を開きました');
      } else throw new Error('このタスクの注釈を開けません');
    }));
    annotation.dataset.e2eId = 'gb-production-task-collaboration-annotation';
    annotation.dataset.gbTooltip = 'このタスクの注釈を開きます';
    const notifications = button('通知', 'bell', () => runCollaboration(notifications, '通知を確認できません', async () => {
      const calendar = componentFor(options);
      if (typeof calendar?._checkAlarms !== 'function') throw new Error('通知を確認できません');
      await calendar._checkAlarms();
      status('現在の通知を確認しました');
    }));
    notifications.dataset.e2eId = 'gb-production-task-collaboration-notifications';
    notifications.dataset.gbTooltip = '現在の通知を確認します';
    collaboration.append(chat, note, annotation, notifications);
    form.appendChild(actions);
    form.appendChild(collaboration);
    window.MeldexProductionUiAvailability?.markWriteForm?.(form);
    const setFormBusy = busy => {
      fieldControls.forEach(control => { control.disabled = busy; });
      hierarchy?.setBusy?.(busy);
      save.disabled = busy;
      source.disabled = busy;
    };
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (window.MeldexProductionUiAvailability?.ensureWritable?.() === false) return;
      const properties = changedProperties();
      if (!Object.keys(properties).length) {
        status('変更はありません');
        return;
      }
      setFormBusy(true);
      const savingState = STATE.get(options.body);
      if (savingState) savingState.saveInFlight = true;
      try {
        const result = await api().patchEntry({
          sheet: 'タスクリスト', path: row.path, id: row.id,
          expectedModified: row.modified || '', properties,
        });
        const updated = result.row || row;
        status('タスクを保存しました');
        emitUpdated(updated);
        setFormBusy(false);
        // Apply the save result (and clear taskDetailDirty) before awaiting the calendar
        // reload below, which can take several seconds. Otherwise a classification-name
        // save that finishes first sees taskDetailDirty still true and cannot flush a
        // pending external update, which then gets silently dropped once this handler
        // resumes (see setDetailDirty's single pendingRow-apply path).
        if (isCurrentDetail(options, row)) {
          const current = STATE.get(options.body);
          current.row = updated;
          setDetailDirty(options, component, 'taskDetailDirty', false, () => taskDetail(content, updated, options));
        }
        let refreshFailed = false;
        try {
          const refreshResult = await refreshProductionEvents(component);
          refreshFailed = refreshResult?.ok === false;
        } catch (_error) {
          refreshFailed = true;
        }
        if (refreshFailed) {
          status('タスクは保存しましたが、カレンダーを再読み込みできませんでした。カレンダーを再読み込みしてください', true);
        }
      } catch (error) {
        status(error?.message || 'タスクを保存できませんでした', true);
        setFormBusy(false);
      } finally {
        if (savingState) savingState.saveInFlight = false;
      }
    });
    content.append(header, form, classificationEditor(row, component, options));
  }

  function buildShell(body, state, options) {
    body.replaceChildren();
    const shell = document.createElement('div');
    shell.className = 'gb-production-sidebar';
    const tabs = document.createElement('div');
    tabs.className = 'gb-production-sidebar-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'スケジュールのオプション');
    state.sidebarDomId = state.sidebarDomId || `gb-production-sidebar-${++SIDEBAR_ID_SEQ}`;
    const panelId = `${state.sidebarDomId}-panel`;
    const activateMode = (key, focusAfterActivation = false) => {
      if (state.mode === key) return;
      runAfterDiscardConfirmation(body, false, () => render(body, {
        ...options,
        mode: key,
        focusSidebarMode: focusAfterActivation ? key : '',
      }));
    };
    MODES.forEach(([key, label, iconName]) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'gb-production-sidebar-tab' + (state.mode === key ? ' is-active' : '');
      tab.dataset.productionSidebarMode = key;
      tab.dataset.e2eId = `gb-production-sidebar-${key}`;
      tab.id = `${state.sidebarDomId}-tab-${key}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', panelId);
      tab.setAttribute('aria-selected', state.mode === key ? 'true' : 'false');
      tab.tabIndex = state.mode === key ? 0 : -1;
      tab.append(icon(iconName), document.createTextNode(label));
      tab.addEventListener('click', () => activateMode(key));
      tabs.appendChild(tab);
    });
    tabs.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabButtons = [...tabs.querySelectorAll('[role="tab"]')].filter(tab => !tab.disabled);
      const currentIndex = tabButtons.indexOf(event.target.closest('[role="tab"]'));
      if (currentIndex < 0 || !tabButtons.length) return;
      event.preventDefault();
      const nextIndex = event.key === 'Home' ? 0
        : event.key === 'End' ? tabButtons.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabButtons.length) % tabButtons.length;
      const nextMode = tabButtons[nextIndex].dataset.productionSidebarMode;
      tabButtons[nextIndex].focus();
      activateMode(nextMode, true);
    });
    const content = document.createElement('div');
    content.className = 'gb-production-sidebar-content';
    content.id = panelId;
    content.setAttribute('role', 'tabpanel');
    content.setAttribute('aria-labelledby', `${state.sidebarDomId}-tab-${state.mode}`);
    shell.append(tabs, content);
    body.appendChild(shell);
    if (options.focusSidebarMode === state.mode) {
      queueMicrotask(() => body.querySelector(
        `[data-production-sidebar-mode="${state.mode}"]`
      )?.focus?.());
    }
    return content;
  }

  function taskListSurfaceNotice(content) {
    const notice = document.createElement('div');
    notice.className = 'gb-production-task-list-sidebar-note';
    notice.dataset.e2eId = 'gb-production-task-list-sidebar-note';
    const title = document.createElement('strong');
    title.innerHTML = 'タスクリストは表で編集します ' + fieldHelp('タスク詳細は、カレンダー上の制作予定を選んだときだけ表示されます。');
    notice.append(title);
    content.appendChild(notice);
  }

  function render(body, options = {}) {
    if (!body) return;
    LAST_BODY = body;
    const eventRequestId = Number(options.eventRequestId || 0);
    if (eventRequestId) {
      if (EVENT_REQUESTS.get(body) !== eventRequestId) return;
    } else {
      nextEventRequest(body);
    }
    const previous = STATE.get(body) || { mode: 'detail', row: null };
    const component = componentFor(options) || previous.component || null;
    const state = {
      ...previous,
      mode: MODES.some(([key]) => key === options.mode) ? options.mode : previous.mode,
      row: options.row !== undefined ? options.row : previous.row,
      component,
      detailDirty: false,
      taskDetailDirty: false,
      classificationDirty: false,
      pendingRow: null,
      saveInFlight: false,
      revision: Number(previous.revision || 0) + 1,
    };
    STATE.set(body, state);
    const context = { ...options, body, row: state.row, component, revision: state.revision };
    delete context.eventRequestId;
    const content = buildShell(body, state, context);
    if (state.mode === 'detail') {
      // forceDetail: 埋め込みシート表そのものが編集場所になる作品別タブとは異なり、
      // 「すべて」タブのフラット表はセル直接編集を持たない（第一段階の設計）ため、行クリック
      // からはこのタスクリスト面上でも実際の編集フォームを開く必要がある
      // （gb-tool-calendar-production-all-view.js の onOpenTask 経由）。
      if (options.forceDetail !== true && (options.taskListSurface === true || component?._surface === 'productionTasks')) taskListSurfaceNotice(content);
      else taskDetail(content, state.row, context);
    }
    else if (state.mode === 'project') window.MeldexSchedulerUi?.renderProject?.(content, context.component);
    else if (state.mode === 'taskSettings') window.MeldexSchedulerUi?.renderTaskSettings?.(content, context.component);
    else if (state.mode === 'allocation') window.MeldexSchedulerUi?.renderAllocation?.(content, context.component);
    else if (state.mode === 'calendar') window.MeldexSchedulerUi?.renderCalendar?.(content, context.component);
  }

  function openTask(row, component, options = {}) {
    const body = optionBody(true);
    if (!body) {
      status('制作管理の詳細パネルを開けませんでした', true);
      return;
    }
    const current = STATE.get(body);
    const sameRow = !!current && current.mode === 'detail' && rowIdentity(current.row) === rowIdentity(row);
    const forceDetail = options.forceDetail === true;
    runAfterDiscardConfirmation(body, sameRow, () => render(body, { mode: 'detail', row, component, forceDetail }));
  }

  function syncTask(row, component) {
    const identity = rowIdentity(row);
    const body = identity ? existingOptionBody() : null;
    const state = body ? STATE.get(body) : null;
    if (!state || state.mode !== 'detail' || rowIdentity(state.row) !== identity) return { synced: false, reason: 'not-current' };
    if (component && state.component && component !== state.component) return { synced: false, reason: 'different-component' };
    if (state.detailDirty) {
      state.pendingRow = row;
      return { synced: false, dirty: true };
    }
    render(body, { mode: 'detail', row, component: component || state.component });
    return { synced: true, dirty: false };
  }

  async function openTaskEvent(body, event, component) {
    const targetBody = body || optionBody(true);
    if (!targetBody) {
      status('制作タスクの詳細パネルを開けませんでした', true);
      return;
    }
    const requestId = nextEventRequest(targetBody);
    try {
      const data = await api().taskByEvent(event?.id || '');
      if (EVENT_REQUESTS.get(targetBody) !== requestId) return;
      const nextRow = data.row || null;
      const current = STATE.get(targetBody);
      const sameRow = !!current && current.mode === 'detail' && rowIdentity(current.row) === rowIdentity(nextRow);
      runAfterDiscardConfirmation(targetBody, sameRow, () => {
        if (EVENT_REQUESTS.get(targetBody) !== requestId) return;
        render(targetBody, { mode: 'detail', row: nextRow, component, eventRequestId: requestId });
      });
    } catch (error) {
      if (EVENT_REQUESTS.get(targetBody) !== requestId) return;
      status(error?.message || '制作タスクの詳細を読み込めませんでした', true);
      runAfterDiscardConfirmation(targetBody, false, () => {
        if (EVENT_REQUESTS.get(targetBody) !== requestId) return;
        render(targetBody, { mode: 'detail', row: null, component, eventRequestId: requestId });
      });
    }
  }

  function showTemplates(component) {
    const body = optionBody(true);
    if (!body) return;
    runAfterDiscardConfirmation(body, false, () => {
      render(body, { mode: 'taskSettings', component });
      openMobileProductionDrawer(body, 'タスク設定');
    });
  }

  function showActions(component) {
    const body = optionBody(true);
    if (!body) return;
    runAfterDiscardConfirmation(body, false, () => {
      render(body, { mode: 'allocation', component });
      openMobileProductionDrawer(body, '割り当て');
    });
  }

  function prepareTaskListSurface(component, onConfirmed) {
    const body = existingOptionBody();
    if (!body) return true;
    const current = STATE.get(body);
    if (current?.mode && current.mode !== 'detail') return true;
    const prepare = () => {
      render(body, { mode: 'detail', row: null, component, taskListSurface: true });
      closeProductionOptionPanelIfOpen();
    };
    if (!confirmDiscardUnsavedDetail(body, false, () => {
      prepare();
      onConfirmed?.();
    })) return false;
    prepare();
    return true;
  }

  function syncTaskListSurface(component) {
    const body = existingOptionBody();
    if (!body) return;
    const current = STATE.get(body);
    if ((current?.mode && current.mode !== 'detail') || current?.detailDirty || current?.taskDetailDirty || current?.classificationDirty) return;
    if (!body.querySelector('[data-e2e-id="gb-production-task-list-sidebar-note"]')) {
      render(body, { mode: 'detail', row: null, component, taskListSurface: true });
    }
    closeProductionOptionPanelIfOpen();
  }

  window.MeldexProductionSidebar = Object.freeze({
    render,
    openTask,
    syncTask,
    openTaskEvent,
    showTemplates,
    showActions,
    prepareTaskListSurface,
    syncTaskListSurface,
  });
})();
