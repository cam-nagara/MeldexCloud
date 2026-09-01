(function (root, factory) {
  'use strict';
  const api = factory(root?.MeldexTopicPropertyFamily, root?.MeldexTopicPlacement);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MeldexTopicDetail = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (PropertyFamily, Placement) {
  'use strict';

  const TABS = Object.freeze([
    { id: 'current-values', label: 'この場所の値' },
    { id: 'all-values', label: 'すべての値' },
    { id: 'registrations-links', label: '登録先・リンク' },
  ]);
  let mountSequence = 0;

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function valueText(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join(', ');
    return JSON.stringify(value);
  }

  function commonTagIds(value) {
    const values = Array.isArray(value) ? value : String(value || '').split(',');
    return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))];
  }

  function normalizePropertyValue(value) {
    if (PropertyFamily?.normalizePropertyValue) return PropertyFamily.normalizePropertyValue(value);
    return clone(value);
  }

  function currentValueRows(propertyValues, columns) {
    if (PropertyFamily?.valuesForColumns) {
      return PropertyFamily.valuesForColumns(propertyValues, columns).map((item) => ({
        id: item.value?.propertyFamilyId || item.column.propertyFamilyId || item.column.columnId,
        columnId: item.column.columnId,
        label: item.column.name,
        type: item.column.columnType,
        value: clone(item.value),
        hidden: false,
      }));
    }
    return [];
  }

  function allValueRows(propertyValues, columns) {
    const columnByFamily = new Map();
    (Array.isArray(columns) ? columns : []).forEach((column) => {
      if (column?.propertyFamilyId) columnByFamily.set(column.propertyFamilyId, column);
      // 列名編集で既存共有列へ共通化した列は、値の正本を旧familyに保ったまま
      // sourcePropertyFamilyIdで表示する。全値タブでも同じ対応を使う。
      if (column?.sourcePropertyFamilyId) columnByFamily.set(column.sourcePropertyFamilyId, column);
    });
    return (Array.isArray(propertyValues) ? propertyValues : []).map(normalizePropertyValue).map((item) => {
      const column = columnByFamily.get(item.propertyFamilyId);
      return {
        id: item.propertyFamilyId,
        label: column?.name || item.displayName || item.propertyFamilyId,
        type: item.columnType,
        value: clone(item.value),
        hidden: !column,
        origins: clone(item.origins),
        updatedAt: item.updatedAt,
        updatedBy: item.updatedBy,
      };
    });
  }

  function usageRows(usageIndex) {
    if (!usageIndex) return [];
    const index = Placement?.normalizeUsageIndex ? Placement.normalizeUsageIndex(usageIndex) : usageIndex;
    return (index.usages || []).map((usage) => ({
      id: usage.usageId,
      label: usage.label || usage.location?.title || usage.targetId || usage.kind,
      kind: usage.kind,
      target: { targetId: usage.targetId, ...clone(usage.location || {}) },
      available: usage.available !== false,
      partial: usage.partial === true,
    }));
  }

  function createViewModel(value) {
    const source = value || {};
    const valueMap = source.propertyValuesByFamilyId || {};
    const requestedOrder = Array.isArray(source.propertyValueOrder) ? source.propertyValueOrder : [];
    const order = [...new Set([...requestedOrder, ...Object.keys(valueMap)])];
    const propertyValues = order.filter((familyId) => valueMap[familyId])
      .map((familyId) => valueMap[familyId]);
    return {
      topicRef: clone(source.topicRef),
      title: typeof source.title === 'string' ? source.title : '',
      partial: source.usageIndex?.partial === true,
      tabs: {
        'current-values': currentValueRows(propertyValues, source.currentColumns),
        'all-values': allValueRows(propertyValues, source.currentColumns),
        'registrations-links': usageRows(source.usageIndex),
      },
    };
  }

  function element(document, tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function nextTabId(currentId, key) {
    const current = TABS.findIndex((tab) => tab.id === currentId);
    if (key === 'Home') return TABS[0].id;
    if (key === 'End') return TABS[TABS.length - 1].id;
    if (key === 'ArrowRight') return TABS[(current + 1) % TABS.length].id;
    if (key === 'ArrowLeft') return TABS[(current - 1 + TABS.length) % TABS.length].id;
    return null;
  }

  function renderValueRows(document, rows, settings) {
    const list = element(document, 'dl', 'topic-detail-values');
    rows.forEach((row) => {
      const item = element(document, 'div', 'topic-detail-value');
      item.dataset.propertyId = row.id;
      const label = row.hidden ? `${row.label}（現在の場所では非表示）` : row.label;
      item.append(element(document, 'dt', 'topic-detail-value-label', label));
      const content = element(document, 'dd', 'topic-detail-value-content');
      if (row.type === 'common-tags' && typeof globalThis.renderInlineTagEditor === 'function') {
        globalThis.renderInlineTagEditor(content, {
          getIds: () => commonTagIds(row.value),
          async setIds(ids) {
            if (settings?.readOnly === true) throw new Error('このトピックは読み取り専用です');
            if (typeof settings?.onUpdateValue !== 'function') {
              throw new Error('トピックのタグ保存機能を利用できません');
            }
            const nextValue = commonTagIds(ids).join(', ');
            await settings.onUpdateValue(clone(row), nextValue);
            row.value = nextValue;
            settings.onValueStored?.(row.id, nextValue);
          },
          readOnly: settings?.readOnly === true,
          sourceFolder: settings?.sourceFolder || '',
          compact: true,
          boxed: false,
        });
      } else {
        content.textContent = valueText(row.value);
      }
      item.append(content);
      const firstOrigin = Array.isArray(row.origins) ? row.origins[0] : null;
      const origin = firstOrigin?.columnName || firstOrigin?.documentName || firstOrigin?.sourceId;
      const update = [row.updatedAt, row.updatedBy].filter(Boolean).join(' / ');
      if (origin || update) {
        item.append(element(document, 'small', 'topic-detail-value-meta',
          [origin ? `由来: ${origin}` : '', update ? `更新: ${update}` : ''].filter(Boolean).join(' / ')));
      }
      list.append(item);
    });
    if (!rows.length) list.append(element(document, 'p', 'topic-detail-empty', '値はありません'));
    return list;
  }

  function renderUsageRows(document, rows, onOpenUsage) {
    const list = element(document, 'ul', 'topic-detail-usages');
    rows.forEach((row) => {
      const item = element(document, 'li', 'topic-detail-usage');
      const button = element(document, 'button', 'gb-btn topic-detail-usage-open', row.label);
      button.type = 'button';
      button.disabled = !row.available;
      button.setAttribute('aria-label', `${row.label}を開く`);
      button.addEventListener('click', () => onOpenUsage?.(clone(row)));
      item.append(button);
      if (!row.available) {
        item.append(element(document, 'span', 'topic-detail-unavailable', '現在は開けません'));
      }
      if (row.partial) item.append(element(document, 'span', 'topic-detail-partial', '一部のみ確認済み'));
      list.append(item);
    });
    if (!rows.length) list.append(element(document, 'p', 'topic-detail-empty', '登録先やリンクはありません'));
    return list;
  }

  function mount(container, value, options) {
    if (!container?.ownerDocument) throw new TypeError('container must be a DOM element');
    const document = container.ownerDocument;
    const model = createViewModel(value);
    const settings = options || {};
    const instanceId = `topic-detail-${++mountSequence}`;
    let activeTab = TABS.some((tab) => tab.id === settings.activeTab)
      ? settings.activeTab : TABS[0].id;
    container.replaceChildren();
    container.classList.add('topic-detail');
    const tabs = element(document, 'div', 'gb-tabbar topic-detail-tabs');
    tabs.setAttribute('role', 'tablist');
    const panel = element(document, 'section', 'topic-detail-panel');
    panel.setAttribute('role', 'tabpanel');

    function render() {
      [...tabs.children].forEach((button) => {
        const selected = button.dataset.tabId === activeTab;
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
        button.classList.toggle('gb-tab-active', selected);
      });
      panel.replaceChildren();
      panel.id = `${instanceId}-panel-${activeTab}`;
      panel.setAttribute('aria-labelledby', `${instanceId}-tab-${activeTab}`);
      const rows = model.tabs[activeTab];
      panel.append(activeTab === 'registrations-links'
        ? renderUsageRows(document, rows, settings.onOpenUsage)
        : renderValueRows(document, rows, {
          ...settings,
          onValueStored(propertyId, nextValue) {
            ['current-values', 'all-values'].forEach((tabId) => {
              model.tabs[tabId].filter(row => row.id === propertyId)
                .forEach(row => { row.value = clone(nextValue); });
            });
          },
        }));
      settings.onTabChange?.(activeTab);
    }

    TABS.forEach((tab) => {
      const button = element(document, 'button', 'gb-tab topic-detail-tab', tab.label);
      button.type = 'button';
      button.id = `${instanceId}-tab-${tab.id}`;
      button.dataset.tabId = tab.id;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', `${instanceId}-panel-${tab.id}`);
      button.addEventListener('click', () => { activeTab = tab.id; render(); });
      button.addEventListener('keydown', (event) => {
        const next = nextTabId(activeTab, event.key);
        if (!next) return;
        event.preventDefault();
        activeTab = next;
        render();
        tabs.children[TABS.findIndex((item) => item.id === next)]?.focus?.();
      });
      tabs.append(button);
    });
    if (model.partial) {
      const warning = element(document, 'p', 'topic-detail-index-partial',
        '登録先とリンクを一部だけ確認できました。再読み込みすると再確認できます。');
      warning.setAttribute('role', 'status');
      container.append(warning);
    }
    container.append(tabs, panel);
    render();
    return Object.freeze({
      model: clone(model),
      selectTab(tabId) {
        if (!TABS.some((tab) => tab.id === tabId)) throw new TypeError('unknown topic detail tab');
        activeTab = tabId;
        render();
      },
      getActiveTab() { return activeTab; },
      destroy() { container.replaceChildren(); },
    });
  }

  return Object.freeze({ TABS, createViewModel, commonTagIds, mount });
}));
