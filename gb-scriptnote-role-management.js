/* gb-scriptnote-role-management.js: タイプ／キャラ分離管理UI */

Object.assign(ScriptNoteEditor.prototype, {
  _roleManagementAdapter() {
    const doc = this.doc;
    const model = globalThis.GBScriptNoteRoleModel || null;
    const needsNormalization = Number(doc?.schema_version) < 3
      || !Array.isArray(doc?.scenarioTypes)
      || !Array.isArray(doc?.characters);
    if (needsNormalization && model?.ensureDocument) model.ensureDocument(doc);
    doc.scenarioTypes = Array.isArray(doc.scenarioTypes) ? doc.scenarioTypes : [];
    doc.characters = Array.isArray(doc.characters) ? doc.characters : [];
    const invoke = (name, args, fallback) => {
      if (typeof model?.[name] === 'function') return model[name](...args);
      return fallback();
    };
    const uniqueId = (kind) => {
      const prefix = kind === 'type' ? 'type-' : 'char-';
      const used = new Set([...doc.scenarioTypes, ...doc.characters].map(item => String(item?.id || '')));
      let id;
      do {
        const seed = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        id = prefix + seed;
      } while (used.has(id));
      return id;
    };
    // needsNormalizationがfalseの経路（配列としては既に存在するが、要素側でid未設定の項目が
    // 混入したケース）を通っても、並べ替えグリップ等の安定IDに "undefined" 文字列が漏れないよう、
    // ここで欠落idを一意な値に補完しておく（複数項目が同一の欠落idを共有し、可視UIの安定id/ data-*
    // が重複する事故を防ぐ）。
    doc.scenarioTypes.forEach(item => { if (item && !item.id) item.id = uniqueId('type'); });
    doc.characters.forEach(item => { if (item && !item.id) item.id = uniqueId('character'); });
    const uniqueName = (base, self = null) => {
      const wanted = String(base || '').trim() || '名称未設定';
      const used = new Set([...doc.scenarioTypes, ...doc.characters]
        .filter(item => item !== self).map(item => String(item?.name || '').trim()).filter(Boolean));
      if (!used.has(wanted)) return wanted;
      let index = 2;
      while (used.has(`${wanted} ${index}`)) index += 1;
      return `${wanted} ${index}`;
    };
    const checkedName = (name, self = null) => {
      const wanted = String(name || '').trim();
      if (!wanted) throw new Error('名前を入力してください');
      const duplicate = [...doc.scenarioTypes, ...doc.characters]
        .some(item => item !== self && String(item?.name || '').trim() === wanted);
      if (duplicate) throw new Error(`「${wanted}」はすでに使用されています`);
      return wanted;
    };
    const references = (kind, id) => {
      const value = invoke('countReferences', [doc, { kind, id }], () => null);
      if (Number.isFinite(Number(value))) return Number(value);
      if (value && Number.isFinite(Number(value.total))) return Number(value.total);
      if (value?.references && Number.isFinite(Number(value.references.total))) {
        return Number(value.references.total);
      }
      if (kind === 'type') {
        return doc.characters.filter(character => character?.typeId === id).length
          + (doc.rows || []).filter(row => row?.roleRef?.kind === 'type' && row.roleRef.id === id).length;
      }
      return (doc.rows || []).filter(row => row?.roleRef?.kind === 'character' && row.roleRef.id === id).length;
    };
    const canDelete = (kind, id, replacement = null) => {
      const value = invoke('canDeleteRole', [doc, { kind, id }, replacement], () => null);
      if (typeof value === 'boolean') return value;
      if (value && typeof value === 'object') {
        return value.allowed !== false && value.ok !== false && value.canDelete !== false;
      }
      return references(kind, id) === 0;
    };
    const touch = () => {
      this._calcCache = null;
      this._markDirty();
      this._render();
    };
    return {
      model,
      types: doc.scenarioTypes,
      characters: doc.characters.filter(character => !character?.isDefault && !character?.isTypeDefault),
      uniqueName,
      references,
      canDelete,
      touch,
      addType: () => {
        const defaults = JSON.parse(JSON.stringify(doc.editor?.defaultType || {}));
        const type = {
          ...defaults,
          id: uniqueId('type'),
          name: uniqueName('新しいタイプ'),
          roleStyle: { ...(defaults.roleStyle || {}) },
          textStyle: { ...(defaults.textStyle || {}) },
          gutterStyle: { ...(defaults.gutterStyle || {}) },
          gutter2Style: { ...(defaults.gutter2Style || {}) },
          customStyles: { ...(defaults.customStyles || {}) },
          kind: defaults.kind || 'dialogue',
          isBreak: !!defaults.isBreak,
          isSummary: !!defaults.isSummary,
        };
        delete type.isTypeDefault;
        delete type.isDefault;
        delete type.isRoleNone;
        doc.scenarioTypes.push(type);
        return type;
      },
      addCharacter: (name = '新しいキャラ', typeId = null) => {
        const characterName = uniqueName(name);
        const character = invoke(
          'ensureCharacterForName',
          [doc, characterName, { nameColor: '#cccccc' }],
          () => {
            const item = {
              id: uniqueId('character'),
              name: characterName,
              typeId: null,
              nameColor: '#cccccc',
            };
            doc.characters.push(item);
            return item;
          },
        );
        if (typeId) invoke(
          'setCharacterType',
          [doc, character.id, typeId],
          () => { character.typeId = typeId; return character; },
        );
        return character;
      },
      renameType: (type, name) => invoke(
        'renameType',
        [doc, type.id, String(name || '').trim()],
        () => { type.name = checkedName(name, type); return type; },
      ),
      renameCharacter: (character, name) => invoke(
        'renameCharacter',
        [doc, character.id, String(name || '').trim()],
        () => { character.name = checkedName(name, character); return character; },
      ),
      setCharacterType: (character, typeId) => invoke(
        'setCharacterType',
        [doc, character.id, typeId || null],
        () => {
          character.typeId = typeId || null;
          if (character.typeId) delete character.legacyAppearance;
          return character;
        },
      ),
      remove: (kind, ids, replacement = null) => {
        ids.forEach(id => invoke(
          'deleteRole',
          [doc, { kind, id }, replacement],
          () => {
            if (references(kind, id)) throw new Error('使用中の役割は置換先なしで削除できません');
            const target = kind === 'type' ? doc.scenarioTypes : doc.characters;
            const index = target.findIndex(item => item?.id === id);
            if (index >= 0) target.splice(index, 1);
          },
        ));
      },
      move: (kind, id, destination) => invoke(
        'moveRole',
        [doc, { kind, id }, Number.isInteger(destination) ? { delta: destination } : destination],
        () => {
          const target = kind === 'type' ? doc.scenarioTypes : doc.characters;
          const index = target.findIndex(item => item?.id === id);
          const next = Number.isInteger(destination)
            ? index + destination
            : target.findIndex(item => item?.id === destination?.beforeId);
          if (index < 0 || next < 0 || next >= target.length || next === index) return false;
          const [item] = target.splice(index, 1);
          target.splice(index < next ? next - 1 : next, 0, item);
          return true;
        },
      ),
      clone: (kind, source) => {
        const clone = JSON.parse(JSON.stringify(source));
        clone.id = uniqueId(kind);
        clone.name = uniqueName(`${source.name || (kind === 'type' ? 'タイプ' : 'キャラ')}（コピー）`);
        const target = kind === 'type' ? doc.scenarioTypes : doc.characters;
        const index = target.indexOf(source);
        target.splice(index < 0 ? target.length : index + 1, 0, clone);
        return clone;
      },
    };
  },

  _renderSeparatedRoleManagement(container) {
    const adapter = this._roleManagementAdapter();
    this._detailTypeSelection = this._detailTypeSelection || new Set();
    this._detailCharacterSelection = this._detailCharacterSelection || new Set();
    this._detailSelection = new Set();
    container.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'sn2-detail sn2-role-management';
    root.dataset.e2eId = 'scriptnote-role-management';
    const typeSection = this._buildRoleManagementSection('type', adapter, container);
    const characterSection = this._buildRoleManagementSection('character', adapter, container);
    const separator = this._buildRoleManagementSeparator(typeSection, characterSection);
    root.append(typeSection, separator, characterSection);
    container.appendChild(root);
  },

  _buildRoleManagementSeparator(typeSection, characterSection) {
    const storageKey = 'meldex.scriptnote.roleManagement.splitPercent';
    const separator = document.createElement('div');
    separator.className = 'sn2-role-manage-separator';
    separator.dataset.e2eId = 'scriptnote-role-management-separator';
    separator.tabIndex = 0;
    separator.setAttribute('role', 'separator');
    separator.setAttribute('aria-orientation', 'horizontal');
    separator.setAttribute('aria-label', 'タイプとキャラの表示割合を調整');
    separator.setAttribute('aria-valuemin', '20');
    separator.setAttribute('aria-valuemax', '80');
    const storedValue = localStorage.getItem(storageKey);
    const stored = storedValue == null ? Number.NaN : Number(storedValue);
    let percent = Number.isFinite(stored) ? Math.max(20, Math.min(80, stored)) : 50;
    const apply = (next, persist = true) => {
      percent = Math.max(20, Math.min(80, Math.round(next)));
      typeSection.style.flex = `0 1 ${percent}%`;
      characterSection.style.flex = `0 1 ${100 - percent}%`;
      separator.setAttribute('aria-valuenow', String(percent));
      if (persist) localStorage.setItem(storageKey, String(percent));
    };
    apply(percent, false);
    separator.addEventListener('keydown', event => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      apply(percent + (event.key === 'ArrowDown' ? 5 : -5));
    });
    separator.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      separator.setPointerCapture?.(event.pointerId);
      const root = separator.parentElement;
      const move = pointerEvent => {
        const rect = root.getBoundingClientRect();
        if (rect.height <= 0) return;
        apply(((pointerEvent.clientY - rect.top) / rect.height) * 100, false);
      };
      const end = pointerEvent => {
        move(pointerEvent);
        localStorage.setItem(storageKey, String(percent));
        separator.removeEventListener('pointermove', move);
        separator.removeEventListener('pointerup', end);
        separator.removeEventListener('pointercancel', cancel);
      };
      const cancel = () => {
        separator.removeEventListener('pointermove', move);
        separator.removeEventListener('pointerup', end);
        separator.removeEventListener('pointercancel', cancel);
      };
      separator.addEventListener('pointermove', move);
      separator.addEventListener('pointerup', end);
      separator.addEventListener('pointercancel', cancel);
    });
    return separator;
  },

  _roleManagementButton(label, title, action, e2eId = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sn2-detail-add-btn';
    button.textContent = label;
    button.title = title;
    if (e2eId) button.dataset.e2eId = e2eId;
    button.addEventListener('click', action);
    return button;
  },

  _buildRoleManagementSection(kind, adapter, panelContainer) {
    const isType = kind === 'type';
    const items = isType ? adapter.types : adapter.characters;
    const selection = isType ? this._detailTypeSelection : this._detailCharacterSelection;
    const section = document.createElement('section');
    section.className = `sn2-role-manage-section sn2-role-manage-section--${isType ? 'types' : 'characters'}`;
    section.dataset.e2eId = `scriptnote-${kind}-management-section`;
    const header = document.createElement('header');
    header.className = 'sn2-role-manage-header';
    header.title = isType
      ? 'キャラと紐づいたタイプは、シナリオのタイプ列候補から自動的に外れます'
      : 'キャラは名前色と対応タイプを持ち、本文などの書式は対応タイプから取得します';
    const title = document.createElement('h2');
    title.className = 'sn2-role-manage-title';
    title.textContent = isType ? 'タイプ' : 'キャラ';
    title.title = header.title;
    const count = document.createElement('span');
    count.className = 'sn2-role-manage-count';
    const unset = isType ? 0 : items.filter(item => !item.typeId).length;
    count.textContent = isType ? `${items.length}件` : `${items.length}件・未設定${unset}件`;
    title.appendChild(count);
    header.appendChild(title);
    section.appendChild(header);
    const scroll = document.createElement('div');
    scroll.className = 'sn2-role-manage-scroll';
    scroll.dataset.e2eId = `scriptnote-${kind}-list`;
    scroll.tabIndex = 0;
    scroll.setAttribute('aria-label', `${isType ? 'タイプ' : 'キャラ'}一覧`);
    const table = document.createElement('table');
    table.className = `sn2-role-manage-table sn2-role-manage-table--${isType ? 'types' : 'characters'}`;
    const thead = document.createElement('thead');
    const headings = isType
      ? [['', '並べ替え'], ['', '選択'], ['タイプ名', 'シナリオ上の機能と完全な書式を所有する名前'], ['書式', '書式プレビュー。クリックすると既存の完全な書式設定を開きます'], ['設定', 'タイプの機能・ガター・詳細設定']]
      : [['', '並べ替え'], ['', '選択'], ['色', 'タイプ列に表示するキャラ名だけへ適用する名前色'], ['キャラ名', 'シナリオに表示するキャラ名'], ['対応タイプ', '選択したタイプの完全な書式を使用します'], ['設定', 'キャラ行の編集']];
    const headingRow = document.createElement('tr');
    headings.forEach(([label, tooltip], columnIndex) => {
      const th = document.createElement('th');
      th.textContent = label;
      th.title = tooltip;
      const resizable = isType ? [2, 3].includes(columnIndex) : [3, 4].includes(columnIndex);
      if (resizable) this._bindRoleManagementColumnResize(th, kind, columnIndex);
      if (isType && label === '書式') {
        th.classList.add('sn2-role-manage-format-header');
        th.dataset.e2eId = 'scriptnote-type-format-header';
        th.tabIndex = 0;
        th.setAttribute('role', 'button');
        th.setAttribute('aria-label', '選択中のタイプの書式を設定');
        const open = event => {
          if (event.target.closest?.('.sn2-role-column-resizer')) return;
          this._showColBulkPopup(th, '_role', panelContainer);
        };
        th.addEventListener('click', open);
        th.addEventListener('keydown', event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          open(event);
        });
      }
      headingRow.appendChild(th);
    });
    thead.appendChild(headingRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    if (!items.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = headings.length;
      cell.className = 'sn2-role-manage-empty';
      cell.textContent = isType ? 'タイプがありません' : 'キャラがありません';
      row.appendChild(cell);
      tbody.appendChild(row);
    } else {
      items.forEach((item, index) => {
        tbody.appendChild(isType
          ? this._buildScenarioTypeManagementRow(item, index, adapter, panelContainer)
          : this._buildScenarioCharacterManagementRow(item, index, adapter, panelContainer));
      });
    }
    if (isType) {
      tbody.appendChild(this._buildScenarioNoneTypeManagementRow(adapter, panelContainer));
    }
    table.appendChild(tbody);
    scroll.appendChild(table);
    section.appendChild(scroll);
    section.appendChild(this._buildRoleManagementToolbar(kind, adapter, panelContainer));
    return section;
  },

  _bindRoleManagementColumnResize(header, kind, columnIndex) {
    const storageKey = 'meldex.scriptnote.roleManagement.columnWidths.v1';
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch {}
    const key = `${kind}:${columnIndex}`;
    const stored = Number(saved[key]);
    if (Number.isFinite(stored) && stored >= 80) header.style.width = `${stored}px`;
    const resizer = document.createElement('span');
    resizer.className = 'sn2-role-column-resizer';
    resizer.dataset.e2eId = `scriptnote-${kind}-column-resizer-${columnIndex}`;
    resizer.tabIndex = 0;
    resizer.setAttribute('role', 'separator');
    resizer.setAttribute('aria-orientation', 'vertical');
    resizer.setAttribute('aria-label', `${header.textContent || '列'}の幅を調整`);
    const setWidth = width => {
      const next = Math.max(80, Math.min(480, Math.round(width)));
      header.style.width = `${next}px`;
      resizer.setAttribute('aria-valuenow', String(next));
      return next;
    };
    resizer.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const next = setWidth(header.getBoundingClientRect().width + (event.key === 'ArrowRight' ? 10 : -10));
      saved[key] = next;
      localStorage.setItem(storageKey, JSON.stringify(saved));
    });
    resizer.addEventListener('pointerdown', event => {
      event.preventDefault();
      event.stopPropagation();
      resizer.setPointerCapture?.(event.pointerId);
      const startX = event.clientX;
      const startWidth = header.getBoundingClientRect().width;
      let width = startWidth;
      const move = pointerEvent => { width = setWidth(startWidth + pointerEvent.clientX - startX); };
      const end = () => {
        saved[key] = width;
        localStorage.setItem(storageKey, JSON.stringify(saved));
        resizer.removeEventListener('pointermove', move);
        resizer.removeEventListener('pointerup', end);
        resizer.removeEventListener('pointercancel', cancel);
      };
      const cancel = () => {
        resizer.removeEventListener('pointermove', move);
        resizer.removeEventListener('pointerup', end);
        resizer.removeEventListener('pointercancel', cancel);
      };
      resizer.addEventListener('pointermove', move);
      resizer.addEventListener('pointerup', end);
      resizer.addEventListener('pointercancel', cancel);
    });
    header.appendChild(resizer);
  },

  _showTypeManagementSettingsMenu(anchor, type, panelContainer) {
    document.querySelectorAll('.sn2-type-settings-menu').forEach(element => element.remove());
    const menu = document.createElement('div');
    menu.className = 'gb-fmt-popup sn2-type-settings-menu';
    menu.setAttribute('role', 'menu');
    const styleTargets = [
      ['_role', 'タイプ列の書式', 'タイプ列に表示する名前の完全な書式を設定'],
      ['_text', '本文の書式', '本文列の完全な書式を設定'],
      ['_gutter', '大区切りの書式', '大区切り列の完全な書式を設定'],
      ['_gutter2', '小区切りの書式', '小区切り列の完全な書式を設定'],
    ];
    (this.doc.editor?.customColumns || []).forEach(column => {
      styleTargets.push([column.id, `${column.label || column.id}の書式`, 'カスタム列の完全な書式を設定']);
    });
    styleTargets.forEach(([columnId, label, title]) => {
      menu.appendChild(this._roleManagementButton(label, title, () => {
        menu.remove();
        const isGutter = columnId === '_gutter' || columnId === '_gutter2';
        const inheritedStyle = isGutter ? (this.doc.editor?.columnStyles?.[columnId] || {}) : {};
        this._showCellStylePopup(anchor, type, columnId, panelContainer, isGutter ? {
          includeCountConfig: false,
          inheritedStyle,
          typeOverride: true,
        } : {});
      }, `scriptnote-type-style-${columnId.replace(/^_/, '')}`));
    });
    menu.appendChild(this._roleManagementButton('機能・詳細設定', 'タイプの機能、区切り、その他の詳細設定を開く', () => {
      menu.remove();
      this._showRoleOptionsPopup(anchor, type, panelContainer);
    }, 'scriptnote-type-function-settings'));
    document.body.appendChild(menu);
    if (typeof positionPopup === 'function') positionPopup(menu, anchor.getBoundingClientRect());
    else if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
    const close = (event) => {
      if (event.key === 'Escape' || (!menu.contains(event.target) && event.target !== anchor)) {
        menu.remove();
        document.removeEventListener('pointerdown', close, true);
        document.removeEventListener('keydown', close, true);
      }
    };
    setTimeout(() => {
      document.addEventListener('pointerdown', close, true);
      document.addEventListener('keydown', close, true);
    }, 0);
  },

  _buildScenarioNoneTypeManagementRow(adapter, panelContainer) {
    const noneType = typeof ensureScriptNoteNoneType === 'function'
      ? ensureScriptNoteNoneType(this.doc.editor)
      : (this.doc.editor.noneType = this.doc.editor.noneType || { isRoleNone: true, name: '' });
    noneType.id = 'none';
    noneType.isRoleNone = true;
    noneType.name = '';

    const row = document.createElement('tr');
    row.className = 'sn2-role-manage-row sn2-role-manage-row--none';
    row.dataset.roleId = 'none';
    row.dataset.e2eId = 'scriptnote-type-row-none';

    const handleCell = document.createElement('td');
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'sn2-role-manage-grip sn2-role-manage-grip--disabled';
    grip.disabled = true;
    grip.dataset.e2eId = 'scriptnote-type-drag-none';
    grip.title = '「（なし）」行は固定表示のため並べ替えできません';
    grip.setAttribute('aria-label', '（なし）行は並べ替え不可');
    grip.innerHTML = typeof lucide === 'function' ? lucide('gripVertical', 14) : '⠿';
    handleCell.appendChild(grip);

    const selectCell = document.createElement('td');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.disabled = true;
    check.dataset.e2eId = 'scriptnote-type-select-none';
    check.title = '「（なし）」行は削除・複製できません';
    check.setAttribute('aria-label', '（なし）行は選択対象外');
    selectCell.appendChild(check);

    const nameCell = document.createElement('td');
    const name = document.createElement('span');
    name.className = 'sn2-role-manage-name sn2-role-manage-name--static';
    name.textContent = '（なし）';
    name.title = 'タイプが未設定の行に適用される共通の書式・オプションです';
    name.dataset.e2eId = 'scriptnote-type-name-none';
    name.setAttribute('aria-label', 'タイプ名: （なし）');
    nameCell.appendChild(name);

    const previewCell = document.createElement('td');
    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'sn2-role-style-preview';
    preview.title = '「（なし）」行のタイプ列の書式を設定';
    preview.dataset.e2eId = 'scriptnote-type-style-preview-none';
    preview.setAttribute('aria-label', '（なし）行の書式を設定');
    const roleStyle = noneType.roleStyle || {};
    preview.textContent = `${roleStyle.textBefore || ''}（なし）${roleStyle.textAfter || ''}`;
    Object.assign(preview.style, {
      color: roleStyle.textColor || '',
      background: roleStyle.bgColor || '',
      fontWeight: roleStyle.fontWeight === 'bold' || roleStyle.bold ? 'bold' : '',
      fontStyle: roleStyle.fontStyle === 'italic' || roleStyle.italic ? 'italic' : '',
      fontFamily: roleStyle.fontFamily || '',
      fontSize: roleStyle.fontSize ? `${roleStyle.fontSize}px` : '',
    });
    preview.addEventListener('click', () => this._showCellStylePopup(preview, noneType, '_role', panelContainer));
    previewCell.appendChild(preview);

    const settingsCell = document.createElement('td');
    settingsCell.className = 'sn2-role-manage-actions';
    const options = this._roleManagementButton('設定', '「（なし）」行の機能、ガター、本文書式を設定', () => {
      this._showTypeManagementSettingsMenu(options, noneType, panelContainer);
    }, 'scriptnote-type-settings-none');
    settingsCell.append(options);

    row.append(handleCell, selectCell, nameCell, previewCell, settingsCell);
    return row;
  },

  _buildScenarioTypeManagementRow(type, index, adapter, panelContainer) {
    const row = document.createElement('tr');
    row.className = 'sn2-role-manage-row';
    row.dataset.roleId = type.id;
    row.dataset.e2eId = `scriptnote-type-row-${index}`;
    const selected = this._detailTypeSelection.has(type.id);
    row.classList.toggle('selected', selected);
    const handleCell = document.createElement('td');
    handleCell.appendChild(this._buildRoleManagementGrip(row, 'type', type, adapter, panelContainer, index));
    const selectCell = document.createElement('td');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = selected;
    check.title = `${type.name || 'タイプ'}を選択`;
    check.dataset.e2eId = `scriptnote-type-select-${index}`;
    check.setAttribute('aria-label', check.title);
    check.addEventListener('change', () => {
      if (check.checked) this._detailTypeSelection.add(type.id);
      else this._detailTypeSelection.delete(type.id);
      row.classList.toggle('selected', check.checked);
    });
    selectCell.appendChild(check);
    const nameCell = document.createElement('td');
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'sn2-role-manage-name';
    name.value = type.name || '';
    name.title = 'タイプ名。キャラ名を含む他の役割名と重複できません';
    name.dataset.e2eId = `scriptnote-type-name-${index}`;
    name.setAttribute('aria-label', 'タイプ名');
    name.addEventListener('change', () => {
      const previous = type.name;
      try {
        this._pushUndo('タイプ名変更');
        adapter.renameType(type, name.value);
      } catch (error) {
        name.value = previous || '';
        if (typeof showStatus === 'function') showStatus(error?.message || String(error), true);
        return;
      }
      name.value = type.name || previous;
      adapter.touch();
      this.renderDetailPanel(panelContainer);
    });
    nameCell.appendChild(name);
    const previewCell = document.createElement('td');
    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'sn2-role-style-preview';
    preview.title = 'タイプ列の書式を設定';
    preview.dataset.e2eId = `scriptnote-type-style-preview-${index}`;
    preview.setAttribute('aria-label', `${type.name || 'タイプ'}の書式を設定`);
    const roleStyle = type.roleStyle || {};
    preview.textContent = `${roleStyle.textBefore || ''}${type.name || 'Aa'}${roleStyle.textAfter || ''}`;
    Object.assign(preview.style, {
      color: roleStyle.textColor || '',
      background: roleStyle.bgColor || '',
      fontWeight: roleStyle.fontWeight === 'bold' || roleStyle.bold ? 'bold' : '',
      fontStyle: roleStyle.fontStyle === 'italic' || roleStyle.italic ? 'italic' : '',
      fontFamily: roleStyle.fontFamily || '',
      fontSize: roleStyle.fontSize ? `${roleStyle.fontSize}px` : '',
    });
    preview.addEventListener('click', () => this._showCellStylePopup(preview, type, '_role', panelContainer));
    previewCell.appendChild(preview);
    const settingsCell = document.createElement('td');
    settingsCell.className = 'sn2-role-manage-actions';
    const options = this._roleManagementButton('設定', 'タイプの機能、ガター、カスタム列を設定', () => {
      this._showTypeManagementSettingsMenu(options, type, panelContainer);
    }, `scriptnote-type-settings-${index}`);
    settingsCell.append(options);
    row.append(handleCell, selectCell, nameCell, previewCell, settingsCell);
    return row;
  },

  _buildScenarioCharacterManagementRow(character, index, adapter, panelContainer) {
    const row = document.createElement('tr');
    row.className = 'sn2-role-manage-row';
    row.dataset.roleId = character.id;
    row.dataset.e2eId = `scriptnote-character-row-${index}`;
    const selected = this._detailCharacterSelection.has(character.id);
    row.classList.toggle('selected', selected);
    const handleCell = document.createElement('td');
    handleCell.appendChild(this._buildRoleManagementGrip(row, 'character', character, adapter, panelContainer, index));
    const selectCell = document.createElement('td');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = selected;
    check.title = `${character.name || 'キャラ'}を選択`;
    check.dataset.e2eId = `scriptnote-character-select-${index}`;
    check.setAttribute('aria-label', check.title);
    check.addEventListener('change', () => {
      if (check.checked) this._detailCharacterSelection.add(character.id);
      else this._detailCharacterSelection.delete(character.id);
      row.classList.toggle('selected', check.checked);
    });
    selectCell.appendChild(check);
    const colorCell = document.createElement('td');
    const color = document.createElement('button');
    color.type = 'button';
    color.className = 'sn2-role-name-color gb-color-swatch gb-color-swatch--field';
    color.dataset.color = character.nameColor || 'transparent';
    color.style.background = character.nameColor || 'transparent';
    color.title = 'タイプ列に表示するキャラ名の色';
    color.dataset.e2eId = `scriptnote-character-name-color-${index}`;
    color.setAttribute('aria-label', `${character.name || 'キャラ'}の名前色`);
    color.addEventListener('click', () => {
      if (typeof openColorPalette !== 'function') return;
      openColorPalette(color, character.nameColor || 'transparent', nextColor => {
        this._pushUndo('キャラ名前色変更');
        character.nameColor = nextColor || 'transparent';
        color.dataset.color = character.nameColor;
        color.style.background = character.nameColor;
        adapter.touch();
        requestAnimationFrame(() => color.isConnected && color.focus());
      });
    });
    colorCell.appendChild(color);
    const nameCell = document.createElement('td');
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'sn2-role-manage-name';
    name.value = character.name || '';
    name.title = 'キャラ名。タイプ名を含む他の役割名と重複できません';
    name.dataset.e2eId = `scriptnote-character-name-${index}`;
    name.setAttribute('aria-label', 'キャラ名');
    name.addEventListener('change', () => {
      const previous = character.name;
      try {
        this._pushUndo('キャラ名変更');
        adapter.renameCharacter(character, name.value);
      } catch (error) {
        name.value = previous || '';
        if (typeof showStatus === 'function') showStatus(error?.message || String(error), true);
        return;
      }
      name.value = character.name || previous;
      adapter.touch();
      this.renderDetailPanel(panelContainer);
    });
    nameCell.appendChild(name);
    const typeCell = document.createElement('td');
    const typeSelect = document.createElement('select');
    typeSelect.className = 'sn2-role-type-select';
    typeSelect.title = '対応タイプの見た目と機能を使用します。未設定では既定または旧表示を維持します';
    typeSelect.dataset.e2eId = `scriptnote-character-type-${index}`;
    typeSelect.setAttribute('aria-label', `${character.name || 'キャラ'}の対応タイプ`);
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '（未設定）';
    typeSelect.appendChild(none);
    adapter.types.forEach(type => {
      const option = document.createElement('option');
      option.value = type.id;
      option.textContent = type.name || '名称未設定';
      option.selected = type.id === character.typeId;
      typeSelect.appendChild(option);
    });
    typeSelect.addEventListener('change', () => {
      this._pushUndo('キャラ対応タイプ変更');
      adapter.setCharacterType(character, typeSelect.value || null);
      adapter.touch();
      this.renderDetailPanel(panelContainer);
    });
    typeCell.appendChild(typeSelect);
    const settingsCell = document.createElement('td');
    settingsCell.className = 'sn2-role-manage-actions';
    const edit = this._roleManagementButton('設定', 'この行で名前色、キャラ名、対応タイプを設定', () => {
      row.classList.add('is-editing');
      name.focus();
      name.select();
    }, `scriptnote-character-settings-${index}`);
    settingsCell.append(edit);
    row.append(handleCell, selectCell, colorCell, nameCell, typeCell, settingsCell);
    return row;
  },

  _buildRoleManagementGrip(row, kind, item, adapter, panelContainer, rowIndex) {
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'sn2-role-manage-grip';
    // item.id は本来 role-model 側の正規化で必ず補完されるが、経路によってはこの描画に
    // 到達するまでに未設定のまま渡ってくることがある。その場合でも安定id/data-*へ文字列
    // "undefined" がそのまま漏れて複数要素が同一idを共有しないよう、行インデックスへ
    // フォールバックして一意性を確保する。
    const stableSuffix = item?.id || `idx-${rowIndex}`;
    grip.dataset.e2eId = `scriptnote-${kind}-drag-${stableSuffix}`;
    grip.setAttribute('aria-label', `${item.name || (kind === 'type' ? 'タイプ' : 'キャラ')}を並べ替え`);
    grip.title = 'ドラッグで並べ替え。Alt+上下キーでも移動できます';
    grip.innerHTML = typeof lucide === 'function' ? lucide('gripVertical', 14) : '⠿';
    const finishMove = () => {
      adapter.touch();
      this.renderDetailPanel(panelContainer);
      requestAnimationFrame(() => {
        panelContainer.querySelector(`[data-e2e-id="scriptnote-${kind}-drag-${MeldexEscape.cssIdent(stableSuffix)}"]`)?.focus();
      });
    };
    grip.addEventListener('keydown', event => {
      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
      event.preventDefault();
      const delta = event.key === 'ArrowUp' ? -1 : 1;
      const target = kind === 'type' ? adapter.types : adapter.characters;
      const index = target.findIndex(candidate => candidate.id === item.id);
      if (index < 0 || index + delta < 0 || index + delta >= target.length) return;
      this._pushUndo(kind === 'type' ? 'タイプ並び替え' : 'キャラ並び替え');
      if (adapter.move(kind, item.id, delta)) finishMove();
    });
    grip.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      grip.setPointerCapture?.(event.pointerId);
      row.classList.add('sn2-dragging');
      let destination = null;
      const autoScroll = globalThis.MeldexDragAutoScroll;
      autoScroll?.beginPointerSession?.(event.clientX, event.clientY);
      const move = pointerEvent => {
        autoScroll?.updatePointer?.(pointerEvent.clientX, pointerEvent.clientY);
        const targetRow = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)?.closest?.('.sn2-role-manage-row');
        if (!targetRow || targetRow.closest('section') !== row.closest('section')) return;
        row.closest('tbody')?.querySelectorAll('.sn2-drop-above, .sn2-drop-below').forEach(candidate => {
          candidate.classList.remove('sn2-drop-above', 'sn2-drop-below');
        });
        const targetId = targetRow.dataset.roleId || item.id;
        const rect = targetRow.getBoundingClientRect();
        const dropAfter = pointerEvent.clientY >= rect.top + rect.height / 2;
        targetRow.classList.add(dropAfter ? 'sn2-drop-below' : 'sn2-drop-above');
        destination = dropAfter ? { afterId: targetId } : { beforeId: targetId };
      };
      const cleanup = () => {
        autoScroll?.endPointerSession?.();
        row.classList.remove('sn2-dragging');
        row.closest('tbody')?.querySelectorAll('.sn2-drop-above, .sn2-drop-below').forEach(candidate => {
          candidate.classList.remove('sn2-drop-above', 'sn2-drop-below');
        });
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', end);
        grip.removeEventListener('pointercancel', cancel);
      };
      const end = () => {
        cleanup();
        const targetId = destination?.beforeId || destination?.afterId || '';
        if (!destination || targetId === item.id) return;
        this._pushUndo(kind === 'type' ? 'タイプ並び替え' : 'キャラ並び替え');
        if (adapter.move(kind, item.id, destination)) finishMove();
      };
      const cancel = cleanup;
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', end);
      grip.addEventListener('pointercancel', cancel);
    });
    return grip;
  },

  _deleteManagedRoles(kind, selected, adapter, panelContainer, onDeleted = null) {
    if (!selected.length) return;
    const isType = kind === 'type';
    const selection = isType ? this._detailTypeSelection : this._detailCharacterSelection;
    const selectedIds = new Set(selected.map(item => item.id));
    const used = selected.filter(item => adapter.references(kind, item.id) > 0);
    const finish = async (replacement = null, close = null, setBusy = null) => {
      setBusy?.(true);
      try {
        await Promise.resolve();
        selected.forEach(item => {
          if (!adapter.canDelete(kind, item.id, replacement)) {
            throw new Error(`「${item.name || '名称未設定'}」の参照を置換できません`);
          }
        });
        this._pushUndo(isType ? 'タイプ削除' : 'キャラ削除');
        adapter.remove(kind, selected.map(item => item.id), replacement);
      } catch (error) {
        if (typeof showStatus === 'function') showStatus(error?.message || String(error), true);
        setBusy?.(false);
        return false;
      }
      selection.clear();
      onDeleted?.();
      adapter.touch();
      this.renderDetailPanel(panelContainer);
      setBusy?.(false);
      close?.('submitted');
      return true;
    };
    if (!used.length) {
      const message = `${selected.length}件の${isType ? 'タイプ' : 'キャラ'}を削除しますか？`;
      if (typeof showConfirmDialog === 'function') showConfirmDialog(message, () => finish());
      return;
    }
    const candidates = (isType ? adapter.types : adapter.characters)
      .filter(item => !selectedIds.has(item.id));
    if (isType && !candidates.length) {
      if (typeof showStatus === 'function') {
        showStatus('使用中のタイプを削除するには、置換先となる別のタイプが必要です', true);
      }
      return;
    }
    if (!globalThis.GBUI?.createModal) {
      if (typeof showStatus === 'function') {
        showStatus(`使用中の${isType ? 'タイプ' : 'キャラ'}は、置換先を指定してから削除してください`, true);
      }
      return;
    }
    const body = document.createElement('div');
    body.className = 'sn2-role-delete-body';
    const explanation = document.createElement('p');
    explanation.textContent = isType
      ? '使用中のタイプです。紐づくキャラと直接使用している行を、別のタイプへ一括置換してから削除します。'
      : '使用中のキャラです。使用行を別のキャラへ置換するか、役割を「（なし）」へ明示的に解除してから削除します。';
    body.appendChild(explanation);
    const impact = document.createElement('ul');
    used.forEach(item => {
      const line = document.createElement('li');
      line.textContent = `${item.name || '名称未設定'}: ${adapter.references(kind, item.id)}件`;
      impact.appendChild(line);
    });
    body.appendChild(impact);
    const label = document.createElement('label');
    label.className = 'sn2-role-delete-field';
    const caption = document.createElement('span');
    caption.textContent = isType ? '置換先タイプ' : '参照の処理';
    const select = document.createElement('select');
    select.dataset.e2eId = `scriptnote-${kind}-delete-replacement`;
    if (!isType) {
      const clear = document.createElement('option');
      clear.value = 'none:none';
      clear.textContent = '参照を「（なし）」に解除';
      select.appendChild(clear);
    }
    candidates.forEach(item => {
      const option = document.createElement('option');
      option.value = `${kind}:${item.id}`;
      option.textContent = `${isType ? '置換: ' : '別のキャラへ置換: '}${item.name || '名称未設定'}`;
      select.appendChild(option);
    });
    label.append(caption, select);
    body.appendChild(label);
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'gb-btn gb-btn-secondary';
    cancel.textContent = 'キャンセル';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'gb-btn gb-btn-danger';
    confirm.textContent = '置換して削除';
    confirm.dataset.e2eId = `scriptnote-${kind}-delete-confirm`;
    const owner = document.activeElement;
    let busy = false;
    const returnFocus = () => owner?.isConnected
      ? owner
      : panelContainer?.querySelector(`[data-e2e-id="scriptnote-${kind}-delete"]`);
    const restoreParentFocus = reason => {
      if (reason === 'submitted') return;
      setTimeout(() => {
        const target = returnFocus();
        const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].filter(dialog => dialog.isConnected);
        const topDialog = dialogs[dialogs.length - 1];
        if (target?.isConnected && (!topDialog || topDialog.contains(target))) target.focus();
      }, 0);
    };
    const modal = globalThis.GBUI.createModal({
      id: `scriptnote-${kind}-delete-replacement-dialog`,
      title: `${isType ? 'タイプ' : 'キャラ'}の参照を置換して削除`,
      body,
      footer: [cancel, confirm],
      variant: 'standard',
      geometryKey: `scriptnote-${kind}-delete-replacement`,
      minWidth: '0',
      extraClass: 'sn2-role-delete-modal',
      initialFocus: select,
      returnFocus,
      closeLabel: `${isType ? 'タイプ' : 'キャラ'}の削除を閉じる`,
      closeOnEsc: true,
      closeOnOverlay: true,
      onBeforeClose: reason => !busy || reason === 'submitted',
      onClose: restoreParentFocus,
    });
    modal.overlay.dataset.e2eId = `scriptnote-${kind}-delete-overlay`;
    modal.modal.dataset.e2eId = `scriptnote-${kind}-delete-dialog`;
    globalThis.GBScriptNoteDialogUI?.applyCompactTargets?.(modal.modal);
    const setBusy = next => {
      busy = next;
      modal.modal.setAttribute('aria-busy', next ? 'true' : 'false');
      confirm.disabled = next;
      cancel.disabled = next;
      select.disabled = next;
    };
    cancel.addEventListener('click', () => modal.close('cancel'));
    confirm.addEventListener('click', () => {
      if (busy) return;
      const [replacementKind, replacementId] = select.value.split(':');
      finish({ kind: replacementKind, id: replacementId }, modal.close, setBusy);
    });
    modal.open();
  },

  _buildRoleManagementToolbar(kind, adapter, panelContainer) {
    const isType = kind === 'type';
    const selection = isType ? this._detailTypeSelection : this._detailCharacterSelection;
    const items = isType ? adapter.types : adapter.characters;
    const toolbar = document.createElement('div');
    toolbar.className = 'sn2-detail-toolbar sn2-role-manage-toolbar';
    const rerender = () => {
      adapter.touch();
      this.renderDetailPanel(panelContainer);
    };
    toolbar.appendChild(this._roleManagementButton('＋追加', isType ? '新規タイプを追加' : '新規キャラを追加', () => {
      this._pushUndo(isType ? 'タイプ追加' : 'キャラ追加');
      const created = isType ? adapter.addType() : adapter.addCharacter();
      selection.clear();
      selection.add(created.id);
      rerender();
    }, `scriptnote-${kind}-add`));
    toolbar.appendChild(this._roleManagementButton('複製', '選択中を複製', () => {
      const selected = items.filter(item => selection.has(item.id));
      if (!selected.length) return;
      this._pushUndo(isType ? 'タイプ複製' : 'キャラ複製');
      selection.clear();
      selected.forEach(item => selection.add(adapter.clone(kind, item).id));
      rerender();
    }, `scriptnote-${kind}-duplicate`));
    toolbar.appendChild(this._roleManagementButton('削除', '選択中を削除', () => {
      const selected = items.filter(item => selection.has(item.id));
      this._deleteManagedRoles(kind, selected, adapter, panelContainer);
    }, `scriptnote-${kind}-delete`));
    toolbar.appendChild(this._roleManagementButton('全選択', `すべての${isType ? 'タイプ' : 'キャラ'}を選択`, () => {
      items.forEach(item => selection.add(item.id));
      this.renderDetailPanel(panelContainer);
    }, `scriptnote-${kind}-select-all`));
    if (!isType) {
      const spacer = document.createElement('span');
      spacer.className = 'sn2-detail-toolbar-spacer';
      toolbar.appendChild(spacer);
      const bulk = document.createElement('select');
      bulk.className = 'sn2-role-bulk-type';
      bulk.dataset.e2eId = 'scriptnote-character-bulk-type-select';
      bulk.title = '選択したキャラへ一括設定する対応タイプ';
      bulk.setAttribute('aria-label', '一括設定する対応タイプ');
      const none = document.createElement('option');
      none.value = '';
      none.textContent = '対応タイプ: 未設定';
      bulk.appendChild(none);
      adapter.types.forEach(type => {
        const option = document.createElement('option');
        option.value = type.id;
        option.textContent = `対応タイプ: ${type.name}`;
        bulk.appendChild(option);
      });
      toolbar.appendChild(bulk);
      toolbar.appendChild(this._roleManagementButton('一括設定', '選択したキャラの対応タイプをまとめて変更', () => {
        const selected = adapter.characters.filter(character => selection.has(character.id));
        if (!selected.length) return;
        this._pushUndo('キャラ対応タイプ一括変更');
        selected.forEach(character => adapter.setCharacterType(character, bulk.value || null));
        rerender();
      }, 'scriptnote-character-bulk-type'));
      toolbar.appendChild(this._roleManagementButton('DB読込', 'DBからキャラを読み込む', () => {
        this._showDbImportModal(panelContainer);
      }, 'scriptnote-character-import-db'));
    }
    return toolbar;
  },

});
