/* gb-production-settings-dialog.js: work-template hierarchy with live sheet editing. */
(function () {
  'use strict';

  const CHILD_SHEETS = Object.freeze([
    { key: 'processes', label: '工程構成', sheet: 'タスクテンプレート', icon: 'listTree' },
    { key: 'targets', label: '作業対象', sheet: '作業対象リスト', icon: 'crosshair' },
    { key: 'contents', label: '作業内容', sheet: '作業内容リスト', icon: 'listChecks' },
    { key: 'scales', label: '作業規模', sheet: '作業規模リスト', icon: 'ruler' },
  ]);
  const SELECTIONS = new Map();
  let activeDialog = null;

  function status(message, error = false) {
    if (typeof showStatus === 'function') showStatus(message, error);
  }

  function icon(name, size = 14) {
    const span = document.createElement('span');
    span.className = 'gb-production-settings-icon';
    if (typeof lucide === 'function') span.innerHTML = lucide(name, size);
    return span;
  }

  function rowIdentity(row) {
    return String(row?.properties?.['テンプレートID'] || row?.id || row?.path || row?.name || '').trim();
  }

  function rowLabel(row) {
    return String(row?.name || row?.properties?.['テンプレート名'] || '名称未設定のテンプレート').trim();
  }

  function pathJoin(root, sheet) {
    return String(root || '').replace(/[\\/]+$/, '') + '/シート/' + sheet;
  }

  function writeAvailabilityText() {
    const availability = window.MeldexProductionUiAvailability?.current?.();
    if (availability?.blocked) return { message: availability.reason || '閲覧専用です', blocked: true };
    return { message: '編集できます。変更はシートの保存経路へ反映されます', blocked: false };
  }

  function relationIds(entity, propName) {
    const values = Array.isArray(entity?.[propName]) ? entity[propName] : [];
    return values.map(item => String(item?.id || item?.value || item || '').trim()).filter(Boolean);
  }

  function applyTemplateFilter(embed, templateId) {
    const pivotData = embed?.ctx?.pivotData;
    if (!pivotData?.entities || typeof pivotData.entities !== 'object') return false;
    const entities = Object.fromEntries(Object.entries(pivotData.entities).filter(([, entity]) => (
      relationIds(entity, '作業テンプレート').includes(templateId)
    )));
    embed.ctx.pivotData = { ...pivotData, entities };
    embed.ctx._selectedEntities?.clear?.();
    if (typeof renderPivot === 'function') renderPivot(embed.ctx);
    return true;
  }

  function selectionFor(root, templates) {
    const previous = SELECTIONS.get(root) || {};
    const template = templates.find(row => rowIdentity(row) === previous.templateId) || templates[0] || null;
    const child = CHILD_SHEETS.find(item => item.key === previous.childKey) || CHILD_SHEETS[0];
    return { template, child };
  }

  function closeExisting() {
    if (!activeDialog?.modal?.isConnected) return false;
    activeDialog.modal.querySelector('.gb-modal-close')?.focus?.();
    return true;
  }

  async function loadContext() {
    const api = window.MeldexProductionApi;
    if (!api?.summary || !api?.list) throw new Error('制作管理APIを初期化できませんでした');
    const [summary, templateResult] = await Promise.all([
      api.summary(),
      api.list('作業テンプレート', { limit: 500 }),
    ]);
    const root = String(summary?.root || '').trim();
    if (!root) throw new Error('制作管理の保存場所を確認できませんでした');
    return { root, templates: Array.isArray(templateResult?.rows) ? templateResult.rows : [] };
  }

  async function open(options = {}) {
    if (closeExisting()) return activeDialog;
    if (!window.GBUI?.createModal || !window.MeldexProductionSheetEmbed?.create) {
      status('制作設定を初期化できませんでした', true);
      return null;
    }

    const trigger = options.trigger || document.activeElement;
    const body = document.createElement('div');
    body.className = 'gb-production-settings-dialog';
    body.dataset.e2eId = 'production-settings-dialog-body';
    body.setAttribute('aria-busy', 'true');

    const loading = document.createElement('div');
    loading.className = 'gb-production-settings-state';
    loading.dataset.e2eId = 'production-settings-loading';
    loading.setAttribute('role', 'status');
    loading.textContent = '制作設定を読み込み中…';
    body.appendChild(loading);

    let embed = null;
    let closed = false;
    const modalApi = window.GBUI.createModal({
      title: '制作設定',
      body,
      variant: window.matchMedia?.('(max-width: 700px)')?.matches ? 'mobile-sheet' : 'standard',
      extraClass: 'gb-production-settings-modal',
      returnFocus: trigger,
      onClose: () => {
        closed = true;
        embed?.destroy?.();
        if (activeDialog === modalApi) activeDialog = null;
      },
    });
    modalApi.modal.dataset.e2eId = 'production-settings-dialog';
    modalApi.modal.setAttribute('aria-describedby', 'production-settings-write-state');
    activeDialog = modalApi;
    modalApi.open();

    try {
      const { root, templates } = await loadContext();
      if (closed) return modalApi;
      const current = selectionFor(root, templates);
      const layout = document.createElement('div');
      layout.className = 'gb-production-settings-layout';
      const nav = document.createElement('nav');
      nav.className = 'gb-production-settings-nav';
      nav.setAttribute('aria-label', '作業テンプレートと設定項目');
      const sheetHost = document.createElement('div');
      sheetHost.className = 'gb-production-settings-sheet';
      sheetHost.dataset.e2eId = 'production-settings-sheet';
      const sheetState = document.createElement('div');
      sheetState.className = 'gb-production-settings-sheet-state';
      sheetState.setAttribute('role', 'status');
      sheetState.setAttribute('aria-live', 'polite');
      sheetState.dataset.e2eId = 'production-settings-sheet-state';
      const embedHost = document.createElement('div');
      embedHost.className = 'gb-production-settings-embed';
      sheetHost.append(sheetState, embedHost);
      const writeState = document.createElement('div');
      writeState.id = 'production-settings-write-state';
      writeState.className = 'gb-production-settings-write-state';
      writeState.setAttribute('role', 'status');
      writeState.dataset.e2eId = 'production-settings-write-state';
      const availability = writeAvailabilityText();
      writeState.textContent = availability.message;
      writeState.classList.toggle('is-blocked', availability.blocked);
      layout.append(nav, sheetHost);
      body.replaceChildren(writeState, layout);
      body.setAttribute('aria-busy', 'false');

      embed = window.MeldexProductionSheetEmbed.create({ idSuffix: `production-settings-${Date.now()}` });
      embed.mount(embedHost);
      let selectedTemplate = current.template;
      let selectedChild = current.child;
      let openSeq = 0;
      let addingRow = false;

      embedHost.addEventListener('click', async event => {
        const addButton = event.target.closest?.('.row-add-btn');
        if (!addButton || addingRow || !selectedTemplate || !selectedChild) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (window.MeldexProductionUiAvailability?.ensureWritable?.() === false) return;
        addingRow = true;
        body.setAttribute('aria-busy', 'true');
        sheetState.classList.remove('is-error');
        sheetState.textContent = `${selectedChild.label}へ行を追加中…`;
        try {
          await window.MeldexProductionApi.createEntry({
            sheet: selectedChild.sheet,
            name: '無題',
            properties: { '作業テンプレート': rowIdentity(selectedTemplate) },
          });
          await embed.refresh();
          applyTemplateFilter(embed, rowIdentity(selectedTemplate));
          sheetState.textContent = `${rowLabel(selectedTemplate)} / ${selectedChild.label} を表示中`;
        } catch (error) {
          sheetState.textContent = error?.message || `${selectedChild.label}へ行を追加できませんでした`;
          sheetState.classList.add('is-error');
        } finally {
          addingRow = false;
          body.setAttribute('aria-busy', 'false');
        }
      }, true);

      const openSheet = async () => {
        if (!selectedTemplate || !selectedChild) return;
        const seq = ++openSeq;
        const templateId = rowIdentity(selectedTemplate);
        SELECTIONS.set(root, { templateId, childKey: selectedChild.key });
        nav.querySelectorAll('[data-production-settings-template]').forEach(button => {
          const active = button.dataset.productionSettingsTemplate === templateId;
          button.classList.toggle('is-active', active);
          button.setAttribute('aria-expanded', active ? 'true' : 'false');
        });
        nav.querySelectorAll('[data-production-settings-child]').forEach(button => {
          const active = button.dataset.productionSettingsTemplate === templateId
            && button.dataset.productionSettingsChild === selectedChild.key;
          button.classList.toggle('is-active', active);
          button.setAttribute('aria-current', active ? 'page' : 'false');
        });
        sheetState.classList.remove('is-error');
        sheetState.textContent = `${rowLabel(selectedTemplate)} / ${selectedChild.label} を読み込み中…`;
        body.setAttribute('aria-busy', 'true');
        if (embed.ctx) {
          embed.ctx.productionTemplateId = templateId;
          embed.ctx.productionTemplateName = rowLabel(selectedTemplate);
          embed.ctx.productionTemplateRelationProp = '作業テンプレート';
        }
        try {
          const opened = await embed.open(pathJoin(root, selectedChild.sheet), {
            forceReload: true,
            productionTemplateId: templateId,
            productionTemplateName: rowLabel(selectedTemplate),
          });
          if (closed || seq !== openSeq) return;
          if (!opened) throw new Error(`${selectedChild.label}を読み込めませんでした`);
          // 埋め込み側の行追加・relation候補絞り込みが、選択中テンプレートを安定IDで参照する。
          if (embed.ctx) {
            embed.ctx.productionTemplateId = templateId;
            embed.ctx.productionTemplateName = rowLabel(selectedTemplate);
            embed.ctx.productionTemplateRelationProp = '作業テンプレート';
          }
          applyTemplateFilter(embed, templateId);
          sheetState.textContent = `${rowLabel(selectedTemplate)} / ${selectedChild.label} を表示中`;
        } catch (error) {
          if (closed || seq !== openSeq) return;
          sheetState.textContent = `${error?.message || selectedChild.label + 'を読み込めませんでした'}。権限、ロック、接続を確認して再試行してください`;
          sheetState.classList.add('is-error');
        } finally {
          if (!closed && seq === openSeq) body.setAttribute('aria-busy', 'false');
        }
      };

      const renderNav = () => {
        nav.replaceChildren();
        if (!templates.length) {
          const empty = document.createElement('p');
          empty.className = 'gb-production-settings-empty';
          empty.textContent = '作業テンプレートがありません。制作管理を再読み込みしてください';
          nav.appendChild(empty);
          sheetState.textContent = '表示できる設定がありません';
          return;
        }
        templates.forEach(template => {
          const templateId = rowIdentity(template);
          const group = document.createElement('div');
          group.className = 'gb-production-settings-template-group';
          const parent = document.createElement('button');
          parent.type = 'button';
          parent.className = 'gb-production-settings-template';
          parent.dataset.productionSettingsTemplate = templateId;
          parent.dataset.e2eId = 'production-settings-template';
          parent.append(icon('layoutTemplate'), document.createTextNode(rowLabel(template)));
          parent.addEventListener('click', () => {
            selectedTemplate = template;
            selectedChild = CHILD_SHEETS[0];
            renderNav();
            openSheet();
          });
          const children = document.createElement('div');
          children.className = 'gb-production-settings-children';
          CHILD_SHEETS.forEach(child => {
            const childButton = document.createElement('button');
            childButton.type = 'button';
            childButton.className = 'gb-production-settings-child';
            childButton.dataset.productionSettingsTemplate = templateId;
            childButton.dataset.productionSettingsChild = child.key;
            childButton.dataset.e2eId = `production-settings-child-${child.key}`;
            childButton.append(icon(child.icon), document.createTextNode(child.label));
            childButton.addEventListener('click', () => {
              selectedTemplate = template;
              selectedChild = child;
              openSheet();
            });
            children.appendChild(childButton);
          });
          group.append(parent, children);
          nav.appendChild(group);
        });
      };

      renderNav();
      await openSheet();
    } catch (error) {
      if (!closed) {
        body.setAttribute('aria-busy', 'false');
        loading.classList.add('is-error');
        loading.textContent = error?.message || '制作設定を読み込めませんでした';
        status(loading.textContent, true);
      }
    }
    return modalApi;
  }

  window.MeldexProductionSettingsDialog = Object.freeze({ open });
})();
