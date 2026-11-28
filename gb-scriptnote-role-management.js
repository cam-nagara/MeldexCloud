/* gb-scriptnote-role-management.js: タイプ／キャラ分離管理UI */

Object.assign(ScriptNoteEditor.prototype, {
  _roleManagementValueKey(value) {
    return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  },

  _roleManagementBodySnapshot(doc) {
    const model = globalThis.GBScriptNoteRoleModel;
    if (Number(doc?.schema_version) < 4 || !Array.isArray(doc?.rows)
      || !Array.isArray(doc.scenarioTypes) || !Array.isArray(doc.characters)
      || typeof model?.getEffectiveRole !== 'function' || typeof model?.buildRoleChoices !== 'function') return null;
    try {
      const content = { ...doc }; delete content.scenarioTypes; delete content.characters;
      // 表示中のビューは履歴で戻さない。履歴本文に残った古い印だけで全文更新しない。
      delete content.activeViewId;
      const identity = { ...(doc.meldex || {}) }; delete identity.save_stamp;
      if (Object.keys(identity).length) content.meldex = identity;
      else delete content.meldex;
      const names = new Set(doc.rows.map(row => String(row.role || '')));
      const breaks = new Set(), summaries = new Set();
      [...model.buildRoleChoices(doc), ...doc.rows].forEach(subject => {
        const effective = model.getEffectiveRole(doc, subject);
        const name = String(effective?.name || subject?.role || subject?.name || '');
        if (!names.has(name)) return;
        const type = effective?.type || effective?.style;
        if (type?.isBreak || type?.kind === 'break') breaks.add(name);
        if (type?.isSummary || type?.kind === 'summary') summaries.add(name);
      });
      return this._roleManagementValueKey({ content, roles: doc.rows.map(row => model.getEffectiveRole(doc, row)),
        breaks: [...breaks].sort(), summaries: [...summaries].sort() });
    } catch (_) { return null; }
  },

  _restoreNoneCharacterPaintSnapshot(data) {
    const body = this.host?.querySelector?.('.sn2-editor');
    if (!body?.isConnected || !this.host.contains(body) || typeof this._refreshRowStyles !== 'function') return false;
    const withoutPaint = doc => {
      if (!doc?.editor || !Array.isArray(doc.rows)) return null;
      const content = { ...doc }, editor = { ...doc.editor };
      delete content.activeViewId;
      const identity = { ...(doc.meldex || {}) }; delete identity.save_stamp;
      if (Object.keys(identity).length) content.meldex = identity;
      else delete content.meldex;
      const stored = editor.noneCharacter;
      if (stored != null) {
        if (typeof stored !== 'object' || Array.isArray(stored)) return null;
        const none = { ...stored }, style = { ...(none.roleStyle || {}) };
        // 色は寸法を変えない。文字サイズなど、他の値は比較から外さない。
        for (const key of ['bgColor', 'textColor', 'textStrokeColor', 'accentColor']) delete style[key];
        if (Object.keys(style).length) none.roleStyle = style;
        else delete none.roleStyle;
        if (none.id === 'none') delete none.id;
        if (none.name === '') delete none.name;
        if (Object.keys(none).length) editor.noneCharacter = none;
        else delete editor.noneCharacter;
      }
      content.editor = editor;
      return this._roleManagementValueKey(content);
    };
    try {
      if (this._roleManagementValueKey(this.doc?.editor?.noneCharacter)
          === this._roleManagementValueKey(data?.editor?.noneCharacter)) return false;
      const before = withoutPaint(this.doc);
      if (before === null || before !== withoutPaint(data)) return false;
      if (Object.prototype.hasOwnProperty.call(data.editor, 'noneCharacter')) {
        this.doc.editor.noneCharacter = data.editor.noneCharacter;
      } else delete this.doc.editor.noneCharacter;
      this._refreshRowStyles();
      return true;
    } catch (_) { return false; }
  },

  _restoreRoleManagementBodySnapshot(data) {
    const body = this.host?.querySelector?.('.sn2-editor');
    if (!body?.isConnected || !this.host.contains(body)) return false;
    const before = this._roleManagementBodySnapshot(this.doc);
    if (before === null || before !== this._roleManagementBodySnapshot(data)) return false;
    const restore = (previous, next) => {
      const byId = new Map(previous.map(item => [item.id, item]));
      return next.map(item => {
        const old = byId.get(item.id);
        return old && this._roleManagementValueKey(old) === this._roleManagementValueKey(item) ? old : item;
      });
    };
    // 本文のセルが参照するモデルは保持する。変更した未使用の役割だけ交換する。
    this.doc.scenarioTypes = restore(this.doc.scenarioTypes, data.scenarioTypes);
    this.doc.characters = restore(this.doc.characters, data.characters);
    return true;
  },

  _roleManagementAdapter() {
    const doc = this.doc;
    const model = globalThis.GBScriptNoteRoleModel || null;
    const needsNormalization = Number(doc?.schema_version) < 4
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
          + (doc.rows || []).filter(row => row?.typeRef?.kind === 'type' && row.typeRef.id === id).length;
      }
      return (doc.rows || []).filter(row => row?.characterRef?.kind === 'character' && row.characterRef.id === id).length;
    };
    const canDelete = (kind, id, replacement = null) => {
      const value = invoke('canDeleteRole', [doc, { kind, id }, replacement], () => null);
      if (typeof value === 'boolean') return value;
      if (value && typeof value === 'object') {
        return value.allowed !== false && value.ok !== false && value.canDelete !== false;
      }
      return references(kind, id) === 0;
    };
    let bodySnapshot = this._roleManagementBodySnapshot(doc);
    let bodyHost = this.host;
    let bodyElement = bodyHost?.querySelector?.('.sn2-editor');
    let bodyReadOnly = !!this._readOnly, bodyPath = this._path;
    const touch = () => {
      const nextSnapshot = this._roleManagementBodySnapshot(doc);
      const keepBody = this.doc === doc && this.host === bodyHost && bodyElement?.isConnected
        && bodyReadOnly === !!this._readOnly && bodyPath === this._path
        && bodyHost.contains(bodyElement) && bodyHost.querySelector('.sn2-editor') === bodyElement
        && bodySnapshot !== null && bodySnapshot === nextSnapshot;
      this._calcCache = null;
      this._markDirty();
      if (!keepBody) this._render();
      bodySnapshot = nextSnapshot;
      bodyHost = this.host;
      bodyElement = bodyHost?.querySelector?.('.sn2-editor');
      bodyReadOnly = !!this._readOnly; bodyPath = this._path;
    };
    const rename = (method, item, name) => {
      if (this._readOnly) throw new Error('編集ロック中のため変更できません');
      const before = { id: item.id, name: item.name };
      const result = invoke(method,
        [doc, item.id, String(name || '').trim()],
        () => { item.name = checkedName(name, item); return item; });
      this._rebindRoleFilters?.([before], [item]);
      return result;
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
      renameType: (type, name) => rename('renameType', type, name),
      renameCharacter: (character, name) => rename('renameCharacter', character, name),
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

  _fitRoleManagementColumnsAfterRender(root, container) {
    const doc = this.doc, host = this.host, path = this._path;
    const fit = () => {
      if (this.doc !== doc || this.host !== host || this._path !== path || !root.isConnected
        || !container.isConnected || !container.contains(root)
        || container.querySelector('.sn2-role-management') !== root) return;
      const widths = [...root.querySelectorAll('table[data-role-management-kind]')]
        .map(table => ({ table, width: table.parentElement?.clientWidth || 0 }));
      widths.forEach(({ table, width }) => {
        this._applyRoleManagementColumnWidths(table, table.dataset.roleManagementKind, null, null, width);
      });
    };
    // 本文の再配置と表の構築を終えてから、描画直前に全表をまとめて測る。
    // 旧環境では同期の配置を維持する。
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fit);
    else fit();
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
    root.addEventListener('click', event => {
      const target = event.target;
      const blankSurface = target === root
        || target?.classList?.contains('sn2-role-manage-section')
        || target?.classList?.contains('sn2-role-manage-scroll');
      if (!blankSurface) return;
      this._detailTypeSelection.clear();
      this._detailCharacterSelection.clear();
      this._detailTypeSelectionAnchor = null;
      this._detailCharacterSelectionAnchor = null;
      root.querySelectorAll('.sn2-role-manage-row.selected').forEach(row => row.classList.remove('selected'));
      root.querySelectorAll('.sn2-role-manage-check:not(:disabled)').forEach(checkbox => { checkbox.checked = false; });
      this._syncRoleManagementSelectAll('type', typeSection);
      this._syncRoleManagementSelectAll('character', characterSection);
    });
    container.appendChild(root);
    // 表示領域の幅が決まってから列幅を収める（描画前の幅0では縮められないため）。
    this._fitRoleManagementColumnsAfterRender(root, container);
  },

  _buildRoleManagementSeparator(typeSection, characterSection) {
    const storageKey = 'meldex.scriptnote.roleManagement.splitPercent';
    const separator = document.createElement('div');
    separator.className = 'sn2-role-manage-separator';
    separator.dataset.e2eId = 'scriptnote-role-management-separator';
    separator.tabIndex = 0;
    separator.setAttribute('role', 'separator');
    separator.setAttribute('aria-orientation', 'horizontal');
    separator.setAttribute('aria-label', 'タイプ表の最大の高さを調整');
    separator.setAttribute('aria-valuemin', '20');
    separator.setAttribute('aria-valuemax', '80');
    const storedValue = localStorage.getItem(storageKey);
    const stored = storedValue == null ? Number.NaN : Number(storedValue);
    let percent = Number.isFinite(stored) ? Math.max(20, Math.min(80, stored)) : 40;
    const apply = (next, persist = true) => {
      percent = Math.max(20, Math.min(80, Math.round(next)));
      // 表は行数に合わせた高さで描き、ボタン群とキャラ表をその直下へ続ける。
      // セパレーターはタイプ表の高さの上限（パネル高さに対する割合）を決め、超える分はタイプ表内でスクロールする。
      typeSection.style.maxHeight = `${percent}%`;
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

  _roleManagementPreviewColumns() {
    const standard = [
      { id: '_gutter', label: '大区切り' },
      { id: '_gutter2', label: '小区切り' },
      { id: '_character', label: 'キャラ' },
      { id: '_role', label: 'タイプ' },
      { id: '_text', label: '本文' },
    ];
    const custom = (this.doc.editor?.customColumns || []).map(column => ({
      id: column.id,
      label: column.label || column.id || '追加列',
    }));
    return [...standard, ...custom];
  },

  _roleManagementTableColumns() {
    // 「大区切り／小区切り／タイプ／テキスト／追加列」を表示する（キャラ列はキャラ表で扱う）。
    // パネル幅に収まらない分は横スクロールし、列幅は見出しの境界線ドラッグで調整する。
    return this._roleManagementPreviewColumns().filter(column => column.id !== '_character');
  },

  _roleManagementEffectiveAppearance(kind, item, adapter = null) {
    if (kind === 'type') return item;
    return {
      ...(item || {}),
      roleStyle: {
        ...(item?.roleStyle || {}),
        ...(item?.nameColor ? { textColor: item.nameColor } : {}),
      },
    };
  },

  _roleManagementStyleTarget(kind, item, adapter) {
    if (kind === 'type') return item;
    if (!item?.typeId) return null;
    return adapter.types.find(type => type?.id === item.typeId) || null;
  },

  _resolveRoleManagementPreviewStyle(appearance, colId) {
    const colStyle = this.doc.editor?.columnStyles?.[colId] || {};
    const roleStyle = (colId === '_character' || colId === '_role') ? (appearance?.roleStyle || {})
      : colId === '_text' ? (appearance?.textStyle || {})
        : colId === '_gutter' ? (appearance?.gutterStyle || {})
          : colId === '_gutter2' ? (appearance?.gutter2Style || {})
            : (appearance?.customStyles?.[colId] || {});
    const isGutter = colId === '_gutter' || colId === '_gutter2';
    const read = (key, fallback = '') => {
      if (isGutter) {
        return Object.prototype.hasOwnProperty.call(roleStyle, key)
          ? roleStyle[key]
          : (colStyle[key] ?? fallback);
      }
      let roleValue = roleStyle[key];
      if ((key === 'bgColor' || key === 'textColor') && !roleValue) roleValue = appearance?.[key];
      if (colId === '_text' && !roleValue && [
        'fontWeight', 'fontStyle', 'fontSize', 'fontFamily',
        'textStrokeColor', 'textStrokeWidth',
      ].includes(key)) roleValue = appearance?.[key];
      return roleValue || colStyle[key] || fallback;
    };
    const columnSettings = typeof _scriptNoteColumnLayoutSettings === 'function'
      ? _scriptNoteColumnLayoutSettings(this.doc, colId)
      : (colId.startsWith('_')
        ? (this.doc.editor?.standardColumnSettings?.[colId] || {})
        : ((this.doc.editor?.customColumns || []).find(column => column.id === colId) || {}));
    const countStyle = colId === '_gutter' ? (this.doc.editor?.countConfig?.primaryStyle || {})
      : colId === '_gutter2' ? (this.doc.editor?.countConfig?.secondaryStyle || {})
        : {};
    return {
      bgColor: countStyle.bgColor || read('bgColor'),
      textColor: countStyle.textColor || read('textColor'),
      fontWeight: countStyle.fontWeight || read('fontWeight'),
      fontStyle: read('fontStyle'),
      fontSize: countStyle.fontSize || read('fontSize'),
      fontFamily: read('fontFamily'),
      textStrokeColor: read('textStrokeColor'),
      textStrokeWidth: read('textStrokeWidth'),
      leftAccent: !!read('leftAccent', false),
      underline: !!read('underline', false),
      accentColor: read('accentColor'),
      textBefore: colId === '_text' ? (roleStyle.textBefore ?? appearance?.textBefore ?? '') : (roleStyle.textBefore ?? ''),
      textAfter: colId === '_text' ? (roleStyle.textAfter ?? appearance?.textAfter ?? '') : (roleStyle.textAfter ?? ''),
      textAlign: columnSettings.align || 'left',
      textValign: columnSettings.valign || 'top',
      textOverflow: columnSettings.overflow || 'wrap',
    };
  },

  _roleManagementPreviewText(item, appearance, column) {
    if (column.id === '_gutter' || column.id === '_gutter2') {
      return this._detailCellPreviewLabel?.(column.id) || (column.id === '_gutter' ? 'p01' : 'コマ01');
    }
    if (column.id === '_character' || column.id === '_role') return item?.name || '（なし）';
    const style = this._resolveRoleManagementPreviewStyle(appearance, column.id);
    const base = column.id === '_text' ? '本文' : (column.label || '見本');
    return `${style.textBefore || ''}${base}${style.textAfter || ''}`;
  },

  _applyRoleManagementPreview(preview, item, appearance, column) {
    if (!preview || !appearance) return;
    const style = this._resolveRoleManagementPreviewStyle(appearance, column.id);
    const isGutter = column.id === '_gutter' || column.id === '_gutter2';
    const isCustom = !column.id.startsWith('_');
    const pageBg = 'var(--sn2-page-bg, var(--content-bg, var(--bg)))';
    const baseText = 'var(--sn2-base-text-color, var(--fg))';
    const accent = style.accentColor || style.textColor || 'var(--accent)';
    const backgroundText = isGutter && /^#[0-9a-f]{6}$/i.test(style.bgColor || '')
      ? globalThis.MeldexThemeManager?.getAccentTextColor?.(style.bgColor) : '';
    preview.textContent = this._roleManagementPreviewText(item, appearance, column);
    Object.assign(preview.style, {
      background: style.bgColor || (isCustom ? 'transparent' : pageBg),
      color: style.textColor || backgroundText || (isCustom ? 'inherit' : baseText),
      fontWeight: style.fontWeight === 'bold' || style.bold ? 'bold' : '',
      fontStyle: style.fontStyle === 'italic' || style.italic ? 'italic' : '',
      fontSize: style.fontSize ? `${style.fontSize}px` : '',
      fontFamily: style.fontFamily || '',
      webkitTextStrokeColor: style.textStrokeColor || '',
      webkitTextStrokeWidth: style.textStrokeWidth ? `${style.textStrokeWidth}px` : '',
      paintOrder: (style.textStrokeColor || style.textStrokeWidth) ? 'stroke fill' : '',
      boxShadow: style.leftAccent ? `inset 3px 0 0 ${accent}` : '',
      textDecorationLine: style.underline ? 'underline' : '',
      textDecorationColor: style.underline ? accent : '',
      textAlign: style.textAlign || 'center',
      whiteSpace: style.textOverflow === 'wrap' ? 'normal' : 'nowrap',
      display: style.textValign ? 'flex' : '',
      alignItems: style.textValign === 'top' ? 'flex-start' : style.textValign === 'bottom' ? 'flex-end' : (style.textValign ? 'center' : ''),
      justifyContent: style.textAlign === 'left' ? 'flex-start' : style.textAlign === 'right' ? 'flex-end' : (style.textValign ? 'center' : ''),
    });
    preview.dataset.valign = style.textValign || '';
    preview.dataset.overflow = style.textOverflow || '';
  },

  _applyRoleManagementNamePreview(control, item, appearance) {
    const isCharacter = this.doc?.characters?.includes?.(item) || control?.dataset?.rolePreviewKind === 'character';
    const column = { id: isCharacter ? '_character' : '_role', label: isCharacter ? 'キャラ' : 'タイプ' };
    this._applyRoleManagementPreview(control, item, appearance, column);
    // input は置換要素なので、縦位置用の flex 指定を外して通常の編集欄として保つ。
    control.style.display = '';
    control.style.alignItems = '';
    control.style.justifyContent = '';
    control.value = item?.name || '';
  },

  _applyRoleManagementRowDecoration(row, appearance) {
    row.classList.toggle('sn2-role-manage-row--outlined', !!appearance?.outline);
    if (appearance?.outlineColor) row.style.setProperty('--sn2-role-outline-color', appearance.outlineColor);
    else row.style.removeProperty('--sn2-role-outline-color');
    if (appearance?.outlineWidth) row.style.setProperty('--sn2-role-outline-width', `${appearance.outlineWidth}px`);
    else row.style.removeProperty('--sn2-role-outline-width');
  },

  _buildRoleManagementStyleCell(kind, item, itemIndex, column, adapter, panelContainer) {
    const appearance = this._roleManagementEffectiveAppearance(kind, item, adapter);
    const cell = document.createElement('td');
    cell.className = 'sn2-role-preview-cell';
    cell.dataset.columnId = column.id;
    if (this._getColumnBorderSet?.().has(column.id)) cell.classList.add('sn2-role-preview-cell--bordered');
    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'sn2-role-style-preview';
    preview.dataset.rolePreviewKind = kind;
    preview.dataset.rolePreviewId = item?.id || 'none';
    preview.dataset.rolePreviewColumn = column.id;
    const suffix = column.id.replace(/^_/, '') || 'column';
    preview.dataset.e2eId = column.id === '_role'
      ? `scriptnote-${kind}-style-preview-${itemIndex}`
      : `scriptnote-${kind}-style-preview-${itemIndex}-${suffix}`;
    const ownerName = item?.name || '（なし）';
    const target = this._roleManagementStyleTarget(kind, item, adapter);
    preview.title = target
      ? `${ownerName}の${column.label}書式を設定`
      : `${ownerName}へ初期タイプを設定すると${column.label}書式を編集できます`;
    preview.setAttribute('aria-label', preview.title);
    preview.addEventListener('click', () => {
      const styleTarget = this._roleManagementStyleTarget(kind, item, adapter);
      if (!styleTarget) {
        if (typeof showStatus === 'function') showStatus('先にキャラの初期タイプを設定してください', true);
        this._showCharacterManagementSettingsPopup(preview, item, adapter, panelContainer);
        return;
      }
      const isGutter = column.id === '_gutter' || column.id === '_gutter2';
      const inheritedStyle = isGutter ? (this.doc.editor?.columnStyles?.[column.id] || {}) : {};
      this._showCellStylePopup(preview, styleTarget, column.id, panelContainer, isGutter ? {
        includeCountConfig: false,
        inheritedStyle,
        typeOverride: true,
      } : {});
    });
    this._applyRoleManagementPreview(preview, item, appearance, column);
    cell.appendChild(preview);
    return cell;
  },

  _refreshRoleManagementPreviews(panelContainer) {
    const root = panelContainer || document;
    const adapter = this._roleManagementAdapter();
    const columns = new Map(this._roleManagementPreviewColumns().map(column => [column.id, column]));
    root.querySelectorAll?.('[data-role-preview-kind][data-role-preview-column]').forEach(preview => {
      const kind = preview.dataset.rolePreviewKind;
      const id = preview.dataset.rolePreviewId;
      const item = kind === 'type'
        ? (id === 'none' ? this.doc.editor?.noneType : adapter.types.find(candidate => candidate.id === id))
        : (id === 'none' ? this._scenarioNoneCharacter(false) : adapter.characters.find(candidate => candidate.id === id));
      const column = columns.get(preview.dataset.rolePreviewColumn);
      if (!item || !column) return;
      const appearance = this._roleManagementEffectiveAppearance(kind, item, adapter);
      if ((column.id === '_character' || column.id === '_role') && preview.matches('input')) {
        this._applyRoleManagementNamePreview(preview, item, appearance);
      } else {
        this._applyRoleManagementPreview(preview, item, appearance, column);
      }
      preview.closest('.sn2-role-preview-cell')?.classList.toggle(
        'sn2-role-preview-cell--bordered',
        this._getColumnBorderSet?.().has(column.id),
      );
      const row = preview.closest('.sn2-role-manage-row');
      if (row) this._applyRoleManagementRowDecoration(row, appearance);
    });
  },

  _markRoleManagementGridControls(row, rowIndex) {
    const controls = [...row.children].map(cell => {
      if (!cell?.matches?.('td')) return null;
      return cell.querySelector(
        'input:not(:disabled):not(.sn2-role-manage-grip), select:not(:disabled), button:not(:disabled):not(.sn2-role-style-trigger)',
      );
    }).filter(Boolean);
    controls.forEach((control, columnIndex) => {
      control.dataset.roleGridControl = 'true';
      control.dataset.roleGridRow = String(rowIndex);
      control.dataset.roleGridColumn = String(columnIndex);
      if (control.matches('select')) {
        control.setAttribute('aria-keyshortcuts', 'Enter Space F2 ArrowUp ArrowDown Escape');
        control.title = '上下矢印: 行移動／Enter・Space・F2: 選択肢を編集／Escape: 編集終了';
      }
    });
  },

  _bindRoleManagementGridNavigation(table) {
    const tableKind = table.dataset.roleManagementKind;
    const setSelectEditMode = (select, enabled) => {
      if (!select?.matches?.('select')) return;
      if (enabled) select.dataset.roleSelectEditing = 'true';
      else delete select.dataset.roleSelectEditing;
      select.classList.toggle('is-keyboard-editing', !!enabled);
    };
    table.addEventListener('focusout', event => setSelectEditMode(event.target, false));
    table.addEventListener('keydown', event => {
      const panelHost = table.closest('.sn2-role-management')?.parentElement;
      const current = event.target.closest?.('[data-role-grid-control="true"]');
      if (!current || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      const isText = current.matches('input[type="text"], input:not([type])');
      const setTextEditMode = (input, enabled) => {
        if (!input?.matches?.('input[type="text"], input:not([type])')) return;
        input.readOnly = !enabled;
        input.classList.toggle('is-keyboard-editing', !!enabled);
        if (enabled) requestAnimationFrame(() => input.select());
      };
      const restoreGridFocus = control => {
        const row = Number(control.dataset.roleGridRow);
        const col = Number(control.dataset.roleGridColumn);
        requestAnimationFrame(() => {
          const liveTable = panelHost?.querySelector?.(`[data-role-management-kind="${tableKind}"]`);
          const liveControl = liveTable?.querySelector?.(`[data-role-grid-row="${row}"][data-role-grid-column="${col}"]`);
          liveControl?.focus?.({ preventScroll: true });
        });
      };
      if (isText) {
        if (event.key === 'Enter' || event.key === 'F2') {
          event.preventDefault();
          if (current.readOnly) setTextEditMode(current, true);
          else {
            setTextEditMode(current, false);
            current.blur();
            restoreGridFocus(current);
          }
          return;
        }
        if (event.key === 'Escape' && !current.readOnly) {
          event.preventDefault();
          setTextEditMode(current, false);
          current.blur();
          restoreGridFocus(current);
          return;
        }
      }
      if (current.matches('select')) {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'F2') {
          setSelectEditMode(current, current.dataset.roleSelectEditing !== 'true');
          if (event.key === 'F2') event.preventDefault();
          return;
        }
        if (event.key === 'Escape' && current.dataset.roleSelectEditing === 'true') {
          setSelectEditMode(current, false);
          return;
        }
      }
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      if (isText && !current.readOnly && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        const start = current.selectionStart ?? 0;
        const end = current.selectionEnd ?? start;
        if (start !== end) return;
        if (event.key === 'ArrowLeft' && start > 0) return;
        if (event.key === 'ArrowRight' && end < current.value.length) return;
      }
      if (current.matches('select') && current.dataset.roleSelectEditing === 'true'
        && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) return;
      const rowIndex = Number(current.dataset.roleGridRow);
      const columnIndex = Number(current.dataset.roleGridColumn);
      const rowDelta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
      const columnDelta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
      const targetRow = rowIndex + rowDelta;
      const targetColumn = columnIndex + columnDelta;
      let next = table.querySelector(`[data-role-grid-row="${targetRow}"][data-role-grid-column="${targetColumn}"]`);
      if (!next && rowDelta) {
        const rowControls = [...table.querySelectorAll(`[data-role-grid-row="${targetRow}"]`)];
        next = rowControls.sort((a, b) => Math.abs(Number(a.dataset.roleGridColumn) - columnIndex)
          - Math.abs(Number(b.dataset.roleGridColumn) - columnIndex))[0];
      }
      if (!next) return;
      event.preventDefault();
      next.focus({ preventScroll: true });
      next.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      requestAnimationFrame(() => {
        const liveTable = panelHost?.querySelector(`[data-role-management-kind="${tableKind}"]`);
        const live = liveTable?.querySelector(`[data-role-grid-row="${targetRow}"][data-role-grid-column="${targetColumn}"]`)
          || (rowDelta ? [...(liveTable?.querySelectorAll(`[data-role-grid-row="${targetRow}"]`) || [])]
            .sort((a, b) => Math.abs(Number(a.dataset.roleGridColumn) - columnIndex)
              - Math.abs(Number(b.dataset.roleGridColumn) - columnIndex))[0] : null);
        if (!live || live === document.activeElement) return;
        live.focus({ preventScroll: true });
        live.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      });
    });
  },

  _toggleRoleManagementSelection(kind, item, checked, shiftKey, adapter, section) {
    const selection = kind === 'type' ? this._detailTypeSelection : this._detailCharacterSelection;
    const items = kind === 'type' ? adapter.types : adapter.characters;
    const anchorKey = kind === 'type' ? '_detailTypeSelectionAnchor' : '_detailCharacterSelectionAnchor';
    const anchorId = this[anchorKey];
    if (shiftKey && anchorId) {
      const from = items.findIndex(candidate => candidate.id === anchorId);
      const to = items.findIndex(candidate => candidate.id === item.id);
      if (from >= 0 && to >= 0) {
        const start = Math.min(from, to);
        const end = Math.max(from, to);
        for (let index = start; index <= end; index += 1) {
          if (checked) selection.add(items[index].id);
          else selection.delete(items[index].id);
        }
      }
    } else {
      if (checked) selection.add(item.id);
      else selection.delete(item.id);
      this[anchorKey] = item.id;
    }
    section?.querySelectorAll('.sn2-role-manage-row[data-role-id]').forEach(row => {
      const selected = selection.has(row.dataset.roleId);
      row.classList.toggle('selected', selected);
      const checkbox = row.querySelector('input[type="checkbox"]');
      if (checkbox && !checkbox.disabled) checkbox.checked = selected;
    });
    this._syncRoleManagementSelectAll(kind, section);
  },

  // チェックボックスを押したまま上下の行へなぞると、なぞった行をまとめて同じ状態（選択／解除）にする。
  // 押した行のチェックの反対の状態を、通過したすべての行へ適用する（シートの行選択と同じ操作）。
  _beginRoleManagementDragSelect(kind, startRow, startCheck, downEvent) {
    const section = startRow.closest('section');
    if (!section) return;
    const selection = kind === 'type' ? this._detailTypeSelection : this._detailCharacterSelection;
    const anchorKey = kind === 'type' ? '_detailTypeSelectionAnchor' : '_detailCharacterSelectionAnchor';
    const checked = !startCheck.checked;
    const startX = downEvent.clientX;
    const startY = downEvent.clientY;
    const autoScroll = globalThis.MeldexDragAutoScroll;
    let dragging = false;
    let lastRow = startRow;
    const applyRow = row => {
      const id = row?.dataset?.roleId;
      const checkbox = row?.querySelector('.sn2-role-manage-check');
      if (!id || !checkbox || checkbox.disabled) return;
      if (checked) selection.add(id);
      else selection.delete(id);
      row.classList.toggle('selected', checked);
      checkbox.checked = checked;
      this._syncRoleManagementSelectAll(kind, section);
    };
    const move = event => {
      if (!dragging) {
        if (Math.abs(event.clientY - startY) < 4 && Math.abs(event.clientX - startX) < 4) return;
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.sn2-role-manage-row');
        if (!target || target === startRow) return;
        dragging = true;
        section.classList.add('is-drag-selecting');
        autoScroll?.beginPointerSession?.(startX, startY);
        applyRow(startRow);
      }
      autoScroll?.updatePointer?.(event.clientX, event.clientY);
      event.preventDefault();
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.sn2-role-manage-row');
      if (!target || target.closest('section') !== section) return;
      // 速く動かして途中の行を飛ばしても、前回の位置から今回の位置までの行をすべて同じ状態にする。
      const rows = [...section.querySelectorAll('.sn2-role-manage-row')];
      const from = rows.indexOf(lastRow);
      const to = rows.indexOf(target);
      if (from >= 0 && to >= 0) {
        for (let index = Math.min(from, to); index <= Math.max(from, to); index += 1) applyRow(rows[index]);
      } else {
        applyRow(target);
      }
      lastRow = target;
    };
    const end = () => {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', end, true);
      document.removeEventListener('pointercancel', end, true);
      if (!dragging) return;
      autoScroll?.endPointerSession?.();
      section.classList.remove('is-drag-selecting');
      this[anchorKey] = startRow.dataset.roleId || this[anchorKey];
      // 押したチェックボックス上で離した時だけ click が届く。届いた click は反転させない。
      startCheck.dataset.roleDragSelectSuppress = '1';
      setTimeout(() => { delete startCheck.dataset.roleDragSelectSuppress; }, 0);
    };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', end, true);
    document.addEventListener('pointercancel', end, true);
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
      ? 'シナリオのタイプ列から選択するタイプと、その書式を管理します'
      : 'キャラ名の背景色・文字色と、キャラ選択時に補われる初期タイプを設定します';
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
    if (!isType) {
      // 表全体への入口は、表のタイトル行の右端に置く（フッターは置かない。UI共通ルール §6）。
      const importButton = this._roleManagementButton('シート読込', 'シートからキャラを読み込む', () => {
        this._showDbImportModal(panelContainer);
      }, 'scriptnote-character-import-db');
      importButton.classList.add('sn2-role-manage-header-action');
      importButton.disabled = !!this._readOnly;
      header.appendChild(importButton);
    }
    section.appendChild(header);
    const scroll = document.createElement('div');
    scroll.className = 'sn2-role-manage-scroll';
    scroll.dataset.e2eId = `scriptnote-${kind}-list`;
    scroll.tabIndex = 0;
    scroll.setAttribute('aria-label', `${isType ? 'タイプ' : 'キャラ'}一覧`);
    const table = document.createElement('table');
    table.className = `sn2-role-manage-table sn2-role-manage-table--${isType ? 'types' : 'characters'}`;
    table.dataset.roleManagementKind = kind;
    const tableColumns = isType ? this._roleManagementTableColumns() : [];
    const customColumnCount = tableColumns.filter(column => !column.id.startsWith('_')).length;
    table.style.setProperty('--sn2-role-custom-cols', String(customColumnCount));
    table.setAttribute('aria-label', `${isType ? 'タイプ' : 'キャラ'}の設定表`);
    const colgroup = document.createElement('colgroup');
    // 列幅の既定値。空文字は「残り幅を受け持つ列」（タイプ表はテキスト、キャラ表はキャラ名）。
    // 左端の選択・並べ替え列はキャラ表と同じ36pxに保つ。全列を固定幅にすると
    // 余った幅が左端列にも配分されるため、可変列を1つだけ残す。
    const addColumn = (key, width) => {
      const column = document.createElement('col');
      column.dataset.roleColKey = key;
      column.dataset.roleColDefault = width ? String(width) : '';
      colgroup.appendChild(column);
    };
    if (isType) {
      addColumn('control', 36);
      tableColumns.forEach(column => {
        const key = `preview-${column.id}`;
        if (column.id === '_role') addColumn(key, 86);
        else if (column.id === '_text') addColumn(key, 0);
        else addColumn(key, 50);
      });
      addColumn('settings', 60);
    } else {
      addColumn('control', 36);
      addColumn('name', 0);
      addColumn('linked-type', 88);
      addColumn('sheet-link', 112);
    }
    table.appendChild(colgroup);
    this._applyRoleManagementColumnWidths(table, kind);
    const thead = document.createElement('thead');
    const headings = isType
      ? [
        { label: '', tooltip: '選択と並べ替え', key: 'control' },
        ...tableColumns.map(column => ({
          label: column.id === '_role' ? 'タイプ' : column.id === '_text' ? 'テキスト' : column.label,
          tooltip: `${column.label}の書式。見出しで選択中タイプを一括設定、各セルで個別設定します`,
          key: `preview-${column.id}`,
          column,
        })),
        { label: '設定', tooltip: 'タイプの機能と詳細設定', key: 'settings' },
      ]
      : [
        { label: '', tooltip: '選択と並べ替え', key: 'control' },
        {
          label: 'キャラ名',
          tooltip: 'キャラ名の書式。見出しで選択中キャラ（未選択なら全キャラ）を一括設定、セルの「…」で個別設定します',
          key: 'name',
          column: { id: '_character', label: 'キャラ名' },
        },
        {
          label: '初期タイプ',
          tooltip: 'タイプ未設定行で、このキャラを選んだ時に補うタイプです。見出しで選択中キャラ（未選択なら全キャラ）を一括変更します',
          key: 'linked-type',
          bulkType: true,
        },
        { label: 'シート', tooltip: '「シート読込」で追加したキャラの元トピック。クリックでサブパネルに表示します', key: 'sheet-link' },
      ];
    const headingRow = document.createElement('tr');
    headings.forEach((heading, columnIndex) => {
      const th = document.createElement('th');
      th.textContent = heading.label;
      th.title = heading.tooltip;
      th.className = `sn2-role-manage-col sn2-role-manage-col--${heading.key.replace(/[^a-z0-9_-]/gi, '-')}`;
      if (heading.column) {
        th.dataset.columnId = heading.column.id;
        th.classList.add('sn2-role-manage-format-header');
        th.tabIndex = 0;
        th.setAttribute('role', 'button');
        th.setAttribute('aria-label', `${heading.column.label}列の書式を一括設定`);
        const openBulkFormat = isType
          ? () => this._showColBulkPopup(th, heading.column.id, panelContainer)
          : () => this._showCharacterColumnBulkPopup(th, panelContainer);
        th.addEventListener('click', openBulkFormat);
        th.addEventListener('keydown', event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          openBulkFormat();
        });
      }
      if (heading.key === 'control') {
        // 表の左上（見出しの左端かつチェックボックス＆ハンドル列の上端）の全選択。シートの表と同じ共通部品。
        const selectAll = globalThis.MeldexRowHandleMenu?.createSelectAllCheckbox?.({
          e2eId: `scriptnote-${kind}-select-all`,
          unit: isType ? 'タイプ' : 'キャラ',
          onToggle: shouldSelect => this._setRoleManagementAllSelected(kind, section, shouldSelect),
        });
        if (selectAll) {
          th.textContent = '';
          th.classList.add('sn2-role-manage-col--select-all');
          th.appendChild(selectAll);
        }
      }
      if (heading.bulkType) {
        th.classList.add('sn2-role-manage-format-header');
        th.tabIndex = 0;
        th.setAttribute('role', 'button');
        th.setAttribute('aria-haspopup', 'menu');
        th.setAttribute('aria-expanded', 'false');
        th.setAttribute('aria-label', '初期タイプを一括変更');
        th.dataset.e2eId = 'scriptnote-character-bulk-type';
        const openBulkType = () => this._showCharacterBulkTypeMenu(th, panelContainer);
        th.addEventListener('click', openBulkType);
        th.addEventListener('keydown', event => {
          if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          openBulkType();
        });
      }
      if (isType && heading.column?.id === '_role') th.dataset.e2eId = 'scriptnote-type-format-header';
      else if (!isType && heading.column?.id === '_character') th.dataset.e2eId = 'scriptnote-character-format-header';
      else if (heading.column) {
        // 本文・区切り・追加列の見出しも操作できる部品なので、列IDで安定した識別子を付ける。
        th.dataset.e2eId = `scriptnote-${kind}-format-header-${String(heading.column.id).replace(/^_/, '').replace(/[^a-z0-9_-]/gi, '-')}`;
      }
      headingRow.appendChild(th);
    });
    // 見出しの境界線をドラッグして列幅を変える。表は常に表示領域の幅へ収め、余りは可変列
    // （タイプ表はテキスト、キャラ表はキャラ名）が受け持つ。可変列より左の境界線は左側の列、
    // 可変列より右の境界線は右側の列の幅を変える（最終列も幅を変えられ、右端は常に揃う）。
    const flexIndex = headings.findIndex(heading => !Number(colgroup.querySelector(`col[data-role-col-key="${MeldexEscape.cssIdent(heading.key)}"]`)?.dataset.roleColDefault));
    [...headingRow.children].forEach((th, columnIndex) => {
      const heading = headings[columnIndex];
      const next = headings[columnIndex + 1];
      const resize = !next ? null
        : (flexIndex >= 0 && columnIndex >= flexIndex)
          ? { key: next.key, label: next.label, sign: -1 }
          : { key: heading.key, label: heading.label, sign: 1 };
      this._bindRoleManagementColumnResize(th, table, kind, heading.key, heading.label, resize, columnIndex === flexIndex);
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
    } else {
      tbody.appendChild(this._buildScenarioNoneCharacterManagementRow(adapter, panelContainer));
    }
    tbody.appendChild(this._buildRoleManagementNewRow(kind, adapter, panelContainer, headings.length, items.length + 1));
    table.appendChild(tbody);
    this._bindRoleManagementGridNavigation(table);
    scroll.appendChild(table);
    section.appendChild(scroll);
    this._observeRoleManagementTableWidth(scroll, table, kind);
    // 表の下のボタン列（フッター）は置かない（2026-11-21）。全選択＝左上のチェックボックス、追加＝末尾の「＋ 新規」行、
    // 複製・削除＝行のハンドルメニュー（選択中の行では一括）、初期タイプの一括変更＝「初期タイプ」の見出し、
    // シートからの読み込み＝タイトル行の右端。
    this._syncRoleManagementSelectAll(kind, section);
    return section;
  },

  // 表の末尾の「＋ 新規」行。シートの表の「新規」行と同じく、押すと表の末尾へ1行足す（取り消し履歴つき）。
  _buildRoleManagementNewRow(kind, adapter, panelContainer, columnCount, gridRowIndex) {
    const isType = kind === 'type';
    const selection = isType ? this._detailTypeSelection : this._detailCharacterSelection;
    const row = document.createElement('tr');
    row.className = 'sn2-role-manage-new-row';
    row.dataset.e2eId = `scriptnote-${kind}-new-row`;
    const spacer = document.createElement('td');
    spacer.className = 'sn2-role-manage-cell--control';
    spacer.setAttribute('aria-hidden', 'true');
    const cell = document.createElement('td');
    cell.className = 'sn2-role-manage-new-cell';
    cell.colSpan = Math.max(1, columnCount - 1);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sn2-role-manage-new-btn';
    button.dataset.e2eId = `scriptnote-${kind}-add`;
    button.title = isType ? '表の末尾へタイプを追加' : '表の末尾へキャラを追加';
    button.setAttribute('aria-label', button.title);
    button.disabled = !!this._readOnly;
    const icon = document.createElement('span');
    icon.className = 'sn2-role-manage-new-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '＋';
    const label = document.createElement('span');
    label.textContent = '新規';
    button.append(icon, label);
    button.addEventListener('click', () => {
      if (this._readOnly) return;
      this._pushUndo(isType ? 'タイプ追加' : 'キャラ追加');
      const created = isType ? adapter.addType() : adapter.addCharacter();
      selection.clear();
      if (created?.id) selection.add(created.id);
      adapter.touch();
      this.renderDetailPanel(panelContainer);
      requestAnimationFrame(() => {
        const sectionClass = isType ? 'types' : 'characters';
        const live = panelContainer?.querySelector?.(`.sn2-role-manage-section--${sectionClass}`);
        live?.querySelector?.(`.sn2-role-manage-row[data-role-id="${MeldexEscape.cssIdent(created?.id || '')}"]`)
          ?.scrollIntoView?.({ block: 'nearest' });
        live?.querySelector?.(`[data-e2e-id="scriptnote-${kind}-add"]`)?.scrollIntoView?.({ block: 'nearest' });
      });
    });
    cell.appendChild(button);
    row.append(spacer, cell);
    button.dataset.roleGridControl = 'true';
    button.dataset.roleGridRow = String(gridRowIndex);
    button.dataset.roleGridColumn = '0';
    return row;
  },

  // 全選択チェックボックス: 表示中のすべての行を選択／選択解除する。描き直さずに行の表示だけを合わせる。
  _setRoleManagementAllSelected(kind, section, shouldSelect) {
    const adapter = this._roleManagementAdapter();
    const isType = kind === 'type';
    const selection = isType ? this._detailTypeSelection : this._detailCharacterSelection;
    const items = isType ? adapter.types : adapter.characters;
    const anchorKey = isType ? '_detailTypeSelectionAnchor' : '_detailCharacterSelectionAnchor';
    selection.clear();
    if (shouldSelect) items.forEach(item => selection.add(item.id));
    this[anchorKey] = null;
    section?.querySelectorAll('.sn2-role-manage-row[data-role-id]').forEach(row => {
      const selected = selection.has(row.dataset.roleId);
      row.classList.toggle('selected', selected);
      const checkbox = row.querySelector('input.sn2-role-manage-check');
      if (checkbox && !checkbox.disabled) checkbox.checked = selected;
    });
    this._syncRoleManagementSelectAll(kind, section);
  },

  // 全選択チェックボックスの表示（全選択・一部選択の中間表示・未選択）を、表の選択へ合わせる。
  _syncRoleManagementSelectAll(kind, section) {
    const checkbox = section?.querySelector?.('thead input.row-select-all-cb');
    if (!checkbox) return;
    const rows = [...section.querySelectorAll('tbody .sn2-role-manage-row[data-role-id]')]
      .filter(row => !row.querySelector('input.sn2-role-manage-check')?.disabled);
    const selection = kind === 'type' ? this._detailTypeSelection : this._detailCharacterSelection;
    const selected = rows.reduce((count, row) => count + (selection.has(row.dataset.roleId) ? 1 : 0), 0);
    globalThis.MeldexRowHandleMenu?.syncSelectAllCheckbox?.(checkbox, {
      total: rows.length, selected, unit: kind === 'type' ? 'タイプ' : 'キャラ',
    });
  },

  // キャラ表「初期タイプ」見出し: 選択中のキャラ（未選択なら全キャラ）の初期タイプをまとめて変える。
  // メニューは共通の MeldexContextMenuUI。1回の取り消しで全体が戻る。
  _showCharacterBulkTypeMenu(anchorEl, panelContainer) {
    const menuUI = globalThis.MeldexContextMenuUI;
    if (!menuUI?.openAt) return;
    const adapter = this._roleManagementAdapter();
    const selectedIds = this._detailCharacterSelection || new Set();
    const selected = adapter.characters.filter(character => selectedIds.has(character.id));
    const targets = selected.length ? selected : adapter.characters.slice();
    const readOnly = !!this._readOnly || !targets.length;
    const values = targets.map(character => character.typeId || '');
    const shared = values.length && values.every(value => value === values[0]) ? values[0] : null;
    const apply = typeId => {
      if (readOnly) return;
      const next = typeId || null;
      const changing = targets.filter(character => (character.typeId || null) !== next);
      if (!changing.length) return;
      this._pushUndo('キャラ初期タイプ一括変更');
      changing.forEach(character => adapter.setCharacterType(character, next));
      adapter.touch();
      this.renderDetailPanel(panelContainer);
    };
    const option = (value, label) => ({
      label,
      icon: shared === value ? 'check' : undefined,
      e2eId: `scriptnote-character-bulk-type-option-${value || 'none'}`,
      disabled: readOnly,
      action: () => apply(value),
    });
    const items = [
      {
        type: 'label',
        label: selected.length ? `選択中の${targets.length}件に設定` : `全${targets.length}件に設定`,
        e2eId: 'scriptnote-character-bulk-type-target',
      },
      { type: 'separator' },
      option('', '（未設定）'),
      ...adapter.types.map(type => option(type.id, type.name || '名称未設定')),
    ];
    anchorEl.setAttribute('aria-expanded', 'true');
    menuUI.openAt({
      anchorRect: anchorEl.getBoundingClientRect(),
      ariaLabel: '初期タイプの一括変更',
      e2eId: 'scriptnote-character-bulk-type-menu',
      restoreFocus: anchorEl,
      items,
      onClose: () => {
        if (anchorEl.isConnected) anchorEl.setAttribute('aria-expanded', 'false');
      },
    });
  },

  _roleManagementColumnWidthStore() {
    try {
      const saved = JSON.parse(localStorage.getItem('meldex.scriptnote.roleManagement.columnWidths.v2') || '{}');
      return saved && typeof saved === 'object' ? saved : {};
    } catch { return {}; }
  },

  _saveRoleManagementColumnWidth(kind, key, width) {
    const saved = this._roleManagementColumnWidthStore();
    const storeKey = `${kind}:${key}`;
    if (width == null) delete saved[storeKey];
    else saved[storeKey] = width;
    try { localStorage.setItem('meldex.scriptnote.roleManagement.columnWidths.v2', JSON.stringify(saved)); } catch {}
  },

  // 列幅（既定値＋利用者がドラッグで変えた値）を colgroup と表の幅へ反映する。
  // 可変列（既定値なし）は記憶した幅を使わず、常に残りの幅を受け持つ。表は表示領域の幅（100%）で描き、
  // 右端を表示領域の端へ揃える。表示領域が固定列の合計より狭い時は、直前に幅を変えた列以外の固定列を
  // 比率を保って縮めて収める（記憶する幅は変えない）。それでも収まらない時だけ横スクロールになる。
  _applyRoleManagementColumnWidths(table, kind, overrides = null, pinnedKey = null, availableWidth = null) {
    const FLEX_MIN_WIDTH = 48;
    const MIN_WIDTH = 28;
    const saved = this._roleManagementColumnWidthStore();
    const available = Math.floor(Number.isFinite(availableWidth) ? availableWidth : (table.parentElement?.clientWidth || 0));
    const cols = [...table.querySelectorAll(':scope > colgroup > col[data-role-col-key]')];
    const pinned = pinnedKey || table.dataset.rolePinnedKey || '';
    let hasFlexible = false;
    const fixed = [];
    cols.forEach(col => {
      const key = col.dataset.roleColKey;
      const fallback = Number(col.dataset.roleColDefault) || 0;
      if (!fallback) {
        col.style.width = '';
        hasFlexible = true;
        return;
      }
      const override = overrides && Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : undefined;
      const stored = Number(override !== undefined ? override : saved[`${kind}:${key}`]);
      fixed.push({ col, key, width: Number.isFinite(stored) && stored > 0 ? stored : fallback });
    });
    const reserve = hasFlexible ? FLEX_MIN_WIDTH : 0;
    let excess = available > 0 ? fixed.reduce((sum, entry) => sum + entry.width, 0) + reserve - available : 0;
    if (excess > 0) {
      const shrinkable = fixed.filter(entry => entry.key !== 'control' && entry.key !== pinned);
      // 縮められる余地（最小幅を超える分）に比例して配分する。最小幅に達した列は外して繰り返す。
      for (let pass = 0; pass < 4 && excess > 0.5; pass += 1) {
        const room = shrinkable.reduce((sum, entry) => sum + Math.max(0, entry.width - MIN_WIDTH), 0);
        if (room <= 0) break;
        const ratio = Math.min(1, excess / room);
        shrinkable.forEach(entry => {
          const cut = Math.max(0, entry.width - MIN_WIDTH) * ratio;
          entry.width -= cut;
          excess -= cut;
        });
      }
    }
    let fixedSum = 0;
    fixed.forEach(entry => {
      const width = Math.max(MIN_WIDTH, Math.floor(entry.width));
      entry.col.style.width = `${width}px`;
      fixedSum += width;
    });
    table.style.width = '100%';
    table.style.minWidth = `${fixedSum + reserve}px`;
  },

  // 表示領域（パネル幅）が変わったら列幅を収め直す。
  _observeRoleManagementTableWidth(scroll, table, kind) {
    if (typeof ResizeObserver !== 'function') return;
    let lastWidth = -1;
    const observer = new ResizeObserver(() => {
      if (!table.isConnected) { observer.disconnect(); return; }
      const width = scroll.clientWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      this._applyRoleManagementColumnWidths(table, kind);
    });
    observer.observe(scroll);
  },

  // header: 境界線を置く見出し。resize: { key, label, sign } 境界線のドラッグで幅を変える列
  // （sign=-1 は境界線の右側の列で、左へ動かすと広がる）。null なら境界線を置かない。
  _bindRoleManagementColumnResize(header, table, kind, key, label = '', resize = { key, label, sign: 1 }, flexible = false) {
    const MIN_WIDTH = 28;
    const MAX_WIDTH = 640;
    const colFor = targetKey => table.querySelector(`:scope > colgroup > col[data-role-col-key="${MeldexEscape.cssIdent(targetKey)}"]`);
    const headerFor = targetKey => [...(header.parentElement?.children || [])]
      .find(th => th.classList.contains(`sn2-role-manage-col--${String(targetKey).replace(/[^a-z0-9_-]/gi, '-')}`)) || header;
    const clamp = width => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width)));
    const targetCol = resize ? colFor(resize.key) : null;
    if (resize && targetCol && Number(targetCol.dataset.roleColDefault)) {
      const targetKey = resize.key;
      const sign = resize.sign < 0 ? -1 : 1;
      const resizer = document.createElement('span');
      resizer.className = 'sn2-role-column-resizer';
      resizer.dataset.e2eId = `scriptnote-${kind}-column-resizer-${String(key).replace(/^preview-_?/, '').replace(/[^a-z0-9_-]/gi, '-')}`;
      resizer.dataset.roleResizeKey = targetKey;
      resizer.tabIndex = -1;
      resizer.setAttribute('role', 'separator');
      resizer.setAttribute('aria-orientation', 'vertical');
      resizer.setAttribute('aria-label', `${resize.label || '列'}の幅を調整`);
      resizer.title = 'ドラッグで列幅を変更／ダブルクリックで元の幅に戻す／右クリックで数値指定';
      // 見出しのクリック（書式の一括設定）へ伝わらないようにする。
      resizer.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
      resizer.addEventListener('dblclick', event => {
        event.preventDefault();
        event.stopPropagation();
        this._saveRoleManagementColumnWidth(kind, targetKey, null);
        if (table.dataset.rolePinnedKey === targetKey) delete table.dataset.rolePinnedKey;
        this._applyRoleManagementColumnWidths(table, kind);
      });
      resizer.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        try { resizer.setPointerCapture?.(event.pointerId); } catch (_) { /* 合成イベントでは捕捉できない */ }
        const startX = event.clientX;
        const startWidth = Math.round(headerFor(targetKey).getBoundingClientRect().width);
        let width = startWidth;
        resizer.classList.add('is-resizing');
        const move = pointerEvent => {
          width = clamp(startWidth + sign * (pointerEvent.clientX - startX));
          this._applyRoleManagementColumnWidths(table, kind, { [targetKey]: width }, targetKey);
        };
        const finish = commit => {
          resizer.classList.remove('is-resizing');
          resizer.removeEventListener('pointermove', move);
          resizer.removeEventListener('pointerup', end);
          resizer.removeEventListener('pointercancel', cancel);
          if (commit && width !== startWidth) {
            this._saveRoleManagementColumnWidth(kind, targetKey, width);
            // 幅を変えた列は指定どおりの幅で残し、収まらない分は他の列が縮んで受け持つ。
            table.dataset.rolePinnedKey = targetKey;
          }
          this._applyRoleManagementColumnWidths(table, kind);
        };
        const end = () => finish(true);
        const cancel = () => finish(false);
        resizer.addEventListener('pointermove', move);
        resizer.addEventListener('pointerup', end);
        resizer.addEventListener('pointercancel', cancel);
      });
      header.appendChild(resizer);
    }
    // 見出しの右クリック・メニューキーで「列幅を数値指定...」を出す（可変列は残り幅を受け持つので出さない）。
    // 見出しメニューを持たない列にも数値指定の入口を用意するため、共通の右クリックメニューを使う。
    if (flexible || !colFor(key)) return;
    const suffix = String(key).replace(/^preview-_?/, '').replace(/[^a-z0-9_-]/gi, '-');
    header.addEventListener('contextmenu', event => {
      if (!window.MeldexContextMenuUI?.openAt) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = header.getBoundingClientRect();
      const fromPointer = event.clientX > 0 || event.clientY > 0;
      window.MeldexContextMenuUI.openAt({
        ...(fromPointer ? { x: event.clientX, y: event.clientY } : { anchorRect: rect }),
        ariaLabel: `${label || '列'}列メニュー`,
        e2eId: `scriptnote-${kind}-column-menu-${suffix}`,
        restoreFocus: header.tabIndex >= 0 ? header : null,
        items: [{
          label: '列幅を数値指定...',
          icon: 'ruler',
          e2eId: `scriptnote-${kind}-column-width-${suffix}`,
          action: () => this._showRoleManagementColumnWidthDialog(header, table, kind, key, label),
        }],
      });
    });
  },

  // タイプ表・キャラ表の列幅を数値で指定する。保存先はドラッグと同じ列幅記憶。
  _showRoleManagementColumnWidthDialog(header, table, kind, key, label = '') {
    const MIN_WIDTH = 28;
    const MAX_WIDTH = 640;
    const stored = Number(this._roleManagementColumnWidthStore()[`${kind}:${key}`]);
    const current = Number.isFinite(stored) && stored > 0
      ? stored
      : Math.round(header?.getBoundingClientRect?.().width || 0);
    return this._showScriptNoteColumnWidthModal({
      targetLabel: label,
      current,
      min: MIN_WIDTH,
      max: MAX_WIDTH,
      returnFocus: header?.tabIndex >= 0 ? header : null,
      onApply: (width) => {
        this._saveRoleManagementColumnWidth(kind, key, width);
        // ダイアログ表示中に表が描き直されても、表示中の同種の表すべてへ反映する。
        const tables = new Set([table, ...document.querySelectorAll(`table[data-role-management-kind="${MeldexEscape.cssIdent(kind)}"]`)]);
        tables.forEach(target => {
          if (!target?.isConnected) return;
          target.dataset.rolePinnedKey = key;
          this._applyRoleManagementColumnWidths(target, kind);
        });
        return true;
      },
    });
  },

  _showTypeManagementSettingsMenu(anchor, type, panelContainer) {
    this._showRoleOptionsPopup(anchor, type, panelContainer);
  },

  _buildRoleManagementControlCell(kind, row, item, adapter, panelContainer, itemIndex, disabled = false) {
    const cell = document.createElement('td');
    cell.className = 'sn2-role-manage-cell--control';
    const controls = document.createElement('span');
    controls.className = 'sn2-role-manage-control';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'sn2-role-manage-check';
    check.dataset.e2eId = `scriptnote-${kind}-select-${itemIndex}`;
    const label = item?.name || (kind === 'type' ? 'タイプ' : 'キャラ');
    if (disabled) {
      check.disabled = true;
      check.title = '「（なし）」行は削除・複製できません';
      check.setAttribute('aria-label', '（なし）行は選択対象外');
    } else {
      const selection = kind === 'type' ? this._detailTypeSelection : this._detailCharacterSelection;
      check.checked = selection.has(item.id);
      check.title = `${label}を選択`;
      check.setAttribute('aria-label', check.title);
      const applySelection = shiftKey => {
        this._toggleRoleManagementSelection(kind, item, check.checked, shiftKey, adapter, row.closest('section'));
      };
      check.addEventListener('click', event => {
        event.stopPropagation();
        // ドラッグで複数選択した直後の click は、ドラッグ側で状態を確定済みなので反転させない。
        if (check.dataset.roleDragSelectSuppress === '1') {
          delete check.dataset.roleDragSelectSuppress;
          event.preventDefault();
          return;
        }
        applySelection(event.shiftKey);
      });
      check.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey) return;
        this._beginRoleManagementDragSelect(kind, row, check, event);
      });
      check.addEventListener('keydown', event => {
        if (event.key !== ' ' || !event.shiftKey) return;
        event.preventDefault();
        check.checked = !check.checked;
        applySelection(true);
      });
    }
    controls.appendChild(check);

    if (disabled) {
      const grip = document.createElement('button');
      grip.type = 'button';
      grip.className = 'sn2-role-manage-grip sn2-role-manage-grip--disabled';
      grip.disabled = true;
      grip.dataset.e2eId = `scriptnote-${kind}-drag-${itemIndex}`;
      grip.title = '「（なし）」行は固定表示のため並べ替えできません';
      grip.setAttribute('aria-label', '（なし）行は並べ替え不可');
      grip.innerHTML = typeof lucide === 'function' ? lucide('gripVertical', 14) : '⠿';
      controls.appendChild(grip);
    } else {
      controls.appendChild(this._buildRoleManagementGrip(
        row, kind, item, adapter, panelContainer, Number(itemIndex),
      ));
    }
    cell.appendChild(controls);
    return cell;
  },

  _buildRoleManagementTypeNameCell(type, itemIndex, adapter, panelContainer, editable = true) {
    const column = { id: '_role', label: 'タイプ' };
    const cell = document.createElement('td');
    cell.className = 'sn2-role-preview-cell sn2-role-manage-cell--type-name';
    cell.dataset.columnId = column.id;
    if (this._getColumnBorderSet?.().has(column.id)) cell.classList.add('sn2-role-preview-cell--bordered');
    const editor = document.createElement('div');
    editor.className = 'sn2-role-name-editor';
    const preview = document.createElement(editable ? 'input' : 'span');
    preview.className = editable
      ? 'sn2-role-manage-name sn2-role-name-preview'
      : 'sn2-role-manage-name--static sn2-role-name-preview';
    if (editable) preview.type = 'text';
    if (editable) preview.readOnly = true;
    preview.dataset.rolePreviewKind = 'type';
    preview.dataset.rolePreviewId = type?.id || 'none';
    preview.dataset.rolePreviewColumn = '_role';
    preview.dataset.e2eId = `scriptnote-type-name-${itemIndex}`;
    preview.setAttribute('aria-label', editable ? 'タイプ名' : 'タイプ名: （なし）');
    if (editable) {
      preview.title = 'タイプ名。キャラ名を含む他の役割名と重複できません';
      preview.addEventListener('dblclick', () => {
        preview.readOnly = false;
        preview.classList.add('is-keyboard-editing');
        preview.select();
      });
      preview.addEventListener('blur', () => {
        preview.readOnly = true;
        preview.classList.remove('is-keyboard-editing');
      });
      preview.addEventListener('change', () => {
        const previous = type.name;
        try {
          this._pushUndo('タイプ名変更');
          adapter.renameType(type, preview.value);
        } catch (error) {
          preview.value = previous || '';
          if (typeof showStatus === 'function') showStatus(error?.message || String(error), true);
          return;
        }
        preview.value = type.name || previous;
        adapter.touch();
        this.renderDetailPanel(panelContainer);
      });
    } else {
      preview.title = 'タイプが未設定の行に適用される共通の書式です';
    }
    this._applyRoleManagementNamePreview(preview, type, type);
    if (!editable) preview.textContent = '（なし）';

    const format = document.createElement('button');
    format.type = 'button';
    format.className = 'sn2-role-style-trigger';
    format.textContent = '…';
    format.title = `${editable ? type.name || 'タイプ' : '（なし）'}のタイプ列書式を設定`;
    format.setAttribute('aria-label', format.title);
    format.dataset.e2eId = `scriptnote-type-style-preview-${itemIndex}`;
    format.addEventListener('click', event => {
      event.stopPropagation();
      this._showCellStylePopup(format, type, '_role', panelContainer);
    });
    editor.append(preview, format);
    cell.appendChild(editor);
    return cell;
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
    row.dataset.roleKind = 'type';
    row.dataset.e2eId = 'scriptnote-type-row-none';
    const settingsCell = document.createElement('td');
    settingsCell.className = 'sn2-role-manage-actions';
    const options = this._roleManagementButton('設定', '「（なし）」行の機能と詳細設定', () => {
      this._showRoleOptionsPopup(options, noneType, panelContainer);
    }, 'scriptnote-type-settings-none');
    settingsCell.append(options);

    row.appendChild(this._buildRoleManagementControlCell(
      'type', row, noneType, adapter, panelContainer, 'none', true,
    ));
    this._roleManagementTableColumns().forEach(column => {
      row.appendChild(column.id === '_role'
        ? this._buildRoleManagementTypeNameCell(noneType, 'none', adapter, panelContainer, false)
        : this._buildRoleManagementStyleCell('type', noneType, 'none', column, adapter, panelContainer));
    });
    row.appendChild(settingsCell);
    this._applyRoleManagementRowDecoration(row, noneType);
    this._markRoleManagementGridControls(row, adapter.types.length);
    return row;
  },

  _buildScenarioTypeManagementRow(type, index, adapter, panelContainer) {
    const row = document.createElement('tr');
    row.className = 'sn2-role-manage-row';
    row.dataset.roleId = type.id;
    row.dataset.roleKind = 'type';
    row.dataset.e2eId = `scriptnote-type-row-${index}`;
    const selected = this._detailTypeSelection.has(type.id);
    row.classList.toggle('selected', selected);
    const settingsCell = document.createElement('td');
    settingsCell.className = 'sn2-role-manage-actions';
    const options = this._roleManagementButton('設定', 'タイプの機能と詳細設定', () => {
      this._showRoleOptionsPopup(options, type, panelContainer);
    }, `scriptnote-type-settings-${index}`);
    settingsCell.append(options);

    row.appendChild(this._buildRoleManagementControlCell(
      'type', row, type, adapter, panelContainer, index,
    ));
    this._roleManagementTableColumns().forEach(column => {
      row.appendChild(column.id === '_role'
        ? this._buildRoleManagementTypeNameCell(type, index, adapter, panelContainer)
        : this._buildRoleManagementStyleCell('type', type, index, column, adapter, panelContainer));
    });
    row.appendChild(settingsCell);
    this._applyRoleManagementRowDecoration(row, type);
    this._markRoleManagementGridControls(row, index);
    return row;
  },

  _showCharacterManagementSettingsPopup(anchor, character, adapter, panelContainer) {
    document.querySelectorAll('.sn2-character-settings-popup').forEach(element => element.remove());
    if (typeof closeAllFormatPopups === 'function') closeAllFormatPopups();
    const popup = document.createElement('div');
    popup.className = 'gb-fmt-popup sn2-character-settings-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', `${character.name || 'キャラ'}の設定`);
    popup.dataset.e2eId = 'scriptnote-character-settings-popup';

    const header = document.createElement('div');
    header.className = 'sn2-character-settings-header';
    const title = document.createElement('strong');
    title.textContent = 'キャラ設定';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'gb-btn-icon';
    closeButton.setAttribute('aria-label', 'キャラ設定を閉じる');
    closeButton.innerHTML = typeof lucide === 'function' ? lucide('x', 14) : '×';
    header.append(title, closeButton);

    const body = document.createElement('div');
    body.className = 'sn2-character-settings-body';
    const makeField = (labelText, control) => {
      const label = document.createElement('label');
      label.className = 'sn2-character-settings-field';
      const caption = document.createElement('span');
      caption.textContent = labelText;
      label.append(caption, control);
      return label;
    };
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'gb-input';
    nameInput.value = character.name || '';
    nameInput.dataset.e2eId = 'scriptnote-character-settings-name';
    nameInput.setAttribute('aria-label', 'キャラ名');

    const colorButton = document.createElement('button');
    colorButton.type = 'button';
    colorButton.className = 'sn2-role-name-color gb-color-swatch gb-color-swatch--field';
    colorButton.style.background = character.nameColor || 'transparent';
    colorButton.dataset.color = character.nameColor || 'transparent';
    colorButton.dataset.e2eId = 'scriptnote-character-settings-color';
    colorButton.setAttribute('aria-label', 'キャラ名の色');

    const typeSelect = document.createElement('select');
    typeSelect.className = 'gb-select';
    typeSelect.dataset.e2eId = 'scriptnote-character-settings-type';
    typeSelect.setAttribute('aria-label', '初期タイプ');
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
    body.append(makeField('キャラ名', nameInput), makeField('名前色', colorButton), makeField('初期タイプ', typeSelect));
    const note = document.createElement('p');
    note.className = 'sn2-character-settings-note';
    note.textContent = '初期タイプは、タイプ未設定の行でこのキャラを選んだ時だけ補われます。行で明示したタイプは上書きしません。';
    body.appendChild(note);
    popup.append(header, body);

    let pointerHandler = null;
    let keyHandler = null;
    const close = (restoreFocus = true) => {
      popup.remove();
      if (pointerHandler) document.removeEventListener('pointerdown', pointerHandler, true);
      if (keyHandler) document.removeEventListener('keydown', keyHandler, true);
      if (restoreFocus) requestAnimationFrame(() => anchor?.isConnected && anchor.focus());
    };
    closeButton.addEventListener('click', () => close());
    nameInput.addEventListener('change', () => {
      const previous = character.name || '';
      if (nameInput.value.trim() === previous) return;
      try {
        this._pushUndo('キャラ名変更');
        adapter.renameCharacter(character, nameInput.value);
      } catch (error) {
        nameInput.value = previous;
        if (typeof showStatus === 'function') showStatus(error?.message || String(error), true);
        return;
      }
      nameInput.value = character.name || previous;
      const rowInput = panelContainer?.querySelector(`[data-role-id="${MeldexEscape.cssIdent(character.id)}"] [data-e2e-id^="scriptnote-character-name-"]`);
      if (rowInput) rowInput.value = character.name;
      adapter.touch();
      this._refreshRoleManagementPreviews(panelContainer);
    });
    colorButton.addEventListener('click', () => {
      if (typeof openColorPalette !== 'function') return;
      openColorPalette(colorButton, character.nameColor || 'transparent', nextColor => {
        this._pushUndo('キャラ名前色変更');
        character.nameColor = nextColor || 'transparent';
        if (!character.typeId && character.legacyAppearance) {
          character.legacyAppearance.roleStyle = {
            ...(character.legacyAppearance.roleStyle || {}), textColor: character.nameColor,
          };
        }
        colorButton.dataset.color = character.nameColor;
        colorButton.style.background = character.nameColor;
        const rowColor = panelContainer?.querySelector(`[data-role-id="${MeldexEscape.cssIdent(character.id)}"] [data-e2e-id^="scriptnote-character-name-color-"]`);
        if (rowColor) {
          rowColor.dataset.color = character.nameColor;
          rowColor.style.background = character.nameColor;
        }
        adapter.touch();
        this._refreshRoleManagementPreviews(panelContainer);
      });
    });
    typeSelect.addEventListener('change', () => {
      this._pushUndo('キャラ初期タイプ変更');
      adapter.setCharacterType(character, typeSelect.value || null);
      const rowSelect = panelContainer?.querySelector(`[data-role-id="${MeldexEscape.cssIdent(character.id)}"] [data-e2e-id^="scriptnote-character-type-"]`);
      if (rowSelect) rowSelect.value = character.typeId || '';
      adapter.touch();
      this._refreshRoleManagementPreviews(panelContainer);
    });

    document.body.appendChild(popup);
    if (typeof positionPopup === 'function') positionPopup(popup, anchor.getBoundingClientRect());
    else if (typeof clampPopupToViewport === 'function') clampPopupToViewport(popup);
    pointerHandler = event => {
      if (!popup.contains(event.target) && event.target !== anchor) close();
    };
    keyHandler = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
    };
    document.addEventListener('keydown', keyHandler, true);
    setTimeout(() => document.addEventListener('pointerdown', pointerHandler, true), 0);
    requestAnimationFrame(() => {
      nameInput.focus();
      nameInput.select();
    });
  },

  // キャラ表の「（なし）」行。キャラ欄が空欄の行に使う名前書式を持つ。
  // 未設定のうちは文書へ書き込まず、書式を変えた時だけ editor.noneCharacter として保存する。
  _scenarioNoneCharacter(create = false) {
    const editor = this.doc?.editor;
    const stored = editor?.noneCharacter && typeof editor.noneCharacter === 'object' ? editor.noneCharacter : null;
    if (stored) {
      stored.id = 'none';
      stored.name = '';
      return stored;
    }
    const transient = this._transientNoneCharacter ||= { id: 'none', name: '', roleStyle: {} };
    if (create && editor) {
      editor.noneCharacter = transient;
      this._transientNoneCharacter = null;
    }
    return transient;
  },

  _buildScenarioNoneCharacterManagementRow(adapter, panelContainer) {
    const noneCharacter = this._scenarioNoneCharacter(false);
    const row = document.createElement('tr');
    row.className = 'sn2-role-manage-row sn2-role-manage-row--none';
    row.dataset.roleId = 'none';
    row.dataset.roleKind = 'character';
    row.dataset.e2eId = 'scriptnote-character-row-none';
    const nameCell = document.createElement('td');
    nameCell.className = 'sn2-role-manage-cell--name sn2-role-preview-cell';
    nameCell.dataset.columnId = '_character';
    if (this._getColumnBorderSet?.().has('_character')) nameCell.classList.add('sn2-role-preview-cell--bordered');
    const nameEditor = document.createElement('div');
    nameEditor.className = 'sn2-role-name-editor';
    const preview = document.createElement('span');
    preview.className = 'sn2-role-manage-name--static sn2-role-name-preview';
    preview.dataset.rolePreviewKind = 'character';
    preview.dataset.rolePreviewId = 'none';
    preview.dataset.rolePreviewColumn = '_character';
    preview.dataset.e2eId = 'scriptnote-character-name-none';
    preview.title = 'キャラが空欄の行に適用される共通の書式です';
    preview.setAttribute('aria-label', 'キャラ名: （なし）');
    this._applyRoleManagementPreview(
      preview, noneCharacter,
      this._roleManagementEffectiveAppearance('character', noneCharacter, adapter),
      { id: '_character', label: 'キャラ' },
    );
    const format = document.createElement('button');
    format.type = 'button';
    format.className = 'sn2-role-style-trigger';
    format.textContent = '…';
    format.title = '（なし）の背景色と文字色を設定';
    format.setAttribute('aria-label', format.title);
    format.dataset.e2eId = 'scriptnote-character-style-preview-none';
    format.addEventListener('click', event => {
      event.stopPropagation();
      this._showCharacterNameStylePopup(format, this._scenarioNoneCharacter(true), adapter, panelContainer);
    });
    nameEditor.append(preview, format);
    nameCell.appendChild(nameEditor);
    const typeCell = document.createElement('td');
    typeCell.className = 'sn2-role-manage-cell--linked-type sn2-role-manage-cell--muted';
    typeCell.textContent = '—';
    typeCell.title = '（なし）行には初期タイプを設定できません';
    const sheetCell = document.createElement('td');
    sheetCell.className = 'sn2-role-manage-cell--sheet-link';
    row.append(
      this._buildRoleManagementControlCell('character', row, noneCharacter, adapter, panelContainer, 'none', true),
      nameCell,
      typeCell,
      sheetCell,
    );
    this._markRoleManagementGridControls(row, adapter.characters.length);
    return row;
  },

  // キャラ表「シート」列: 元トピックへのリンク（クリックでサブパネルに表示）と、
  // 連携先トピックの選択（空欄・変更ボタン → シートからトピックを1件選ぶダイアログ）。
  _buildCharacterSheetLinkCell(character, index, panelContainer = null) {
    const cell = document.createElement('td');
    cell.className = 'sn2-role-manage-cell--sheet-link';
    const link = character?.sheetLink && typeof character.sheetLink === 'object' ? character.sheetLink : null;
    const path = String(link?.path || '').trim();
    const canPick = !!panelContainer && !this._readOnly && !!character?.id;
    const openPicker = () => {
      if (!canPick) return;
      this._showDbImportModal(panelContainer, { linkCharacterId: character.id });
    };
    if (canPick) {
      cell.classList.add('sn2-role-manage-cell--sheet-link-pickable');
      // ボタン以外の余白クリックでも連携先を選べる。
      cell.addEventListener('click', event => {
        if (event.target.closest?.('button')) return;
        event.stopPropagation();
        openPicker();
      });
    }
    const buildPickButton = linked => {
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = `sn2-role-sheet-link-pick${linked ? ' sn2-role-sheet-link-pick--change' : ''}`;
      pick.dataset.e2eId = `scriptnote-character-sheet-pick-${index}`;
      pick.title = linked ? '連携するシートのトピックを選び直す' : 'シートのトピックと連携';
      pick.setAttribute('aria-label', `${character?.name || 'キャラ'}: ${pick.title}`);
      pick.innerHTML = typeof lucide === 'function' ? lucide(linked ? 'pencil' : 'link2', 12) : '…';
      pick.addEventListener('click', event => {
        event.stopPropagation();
        openPicker();
      });
      return pick;
    };
    if (!path) {
      if (canPick) cell.appendChild(buildPickButton(false));
      return cell;
    }
    const name = String(link.name || '').trim() || path.split('/').pop().replace(/\.md$/i, '');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sn2-role-sheet-link';
    button.dataset.e2eId = `scriptnote-character-sheet-link-${index}`;
    button.textContent = name;
    button.title = `${name}をサブパネルで開く`;
    button.setAttribute('aria-label', button.title);
    button.addEventListener('click', async event => {
      event.stopPropagation();
      if (typeof openEntityInSplit !== 'function') {
        if (typeof showStatus === 'function') showStatus('この画面ではトピックを開けません', true);
        return;
      }
      try {
        const opened = await openEntityInSplit(path, name);
        if (opened === false && typeof showStatus === 'function') showStatus('トピックを開けませんでした', true);
      } catch (error) {
        console.error('キャラの元トピックを開けませんでした', error);
        if (typeof showStatus === 'function') showStatus('トピックを開けませんでした', true);
      }
    });
    const wrap = document.createElement('span');
    wrap.className = 'sn2-role-sheet-link-wrap';
    wrap.appendChild(button);
    if (canPick) wrap.appendChild(buildPickButton(true));
    cell.appendChild(wrap);
    return cell;
  },

  _buildScenarioCharacterManagementRow(character, index, adapter, panelContainer) {
    const row = document.createElement('tr');
    row.className = 'sn2-role-manage-row';
    row.dataset.roleId = character.id;
    row.dataset.roleKind = 'character';
    row.dataset.e2eId = `scriptnote-character-row-${index}`;
    const selected = this._detailCharacterSelection.has(character.id);
    row.classList.toggle('selected', selected);
    const nameCell = document.createElement('td');
    nameCell.className = 'sn2-role-manage-cell--name';
    const nameEditor = document.createElement('div');
    nameEditor.className = 'sn2-role-name-editor';
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'sn2-role-manage-name';
    name.value = character.name || '';
    name.title = 'キャラ名。タイプ名を含む他の役割名と重複できません';
    name.dataset.e2eId = `scriptnote-character-name-${index}`;
    name.setAttribute('aria-label', 'キャラ名');
    name.readOnly = true;
    name.dataset.rolePreviewKind = 'character';
    name.dataset.rolePreviewId = character.id;
    name.dataset.rolePreviewColumn = '_character';
    name.classList.add('sn2-role-name-preview');
    name.addEventListener('dblclick', () => {
      name.readOnly = false;
      name.classList.add('is-keyboard-editing');
      name.select();
    });
    name.addEventListener('blur', () => {
      name.readOnly = true;
      name.classList.remove('is-keyboard-editing');
    });
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
    this._applyRoleManagementNamePreview(
      name,
      character,
      this._roleManagementEffectiveAppearance('character', character, adapter),
    );
    const format = document.createElement('button');
    format.type = 'button';
    format.className = 'sn2-role-style-trigger';
    format.textContent = '…';
    format.title = `${character.name || 'キャラ'}の背景色と文字色を設定`;
    format.setAttribute('aria-label', format.title);
    format.dataset.e2eId = `scriptnote-character-style-preview-${index}`;
    format.addEventListener('click', event => {
      event.stopPropagation();
      this._showCharacterNameStylePopup(format, character, adapter, panelContainer);
    });
    nameEditor.append(name, format);
    nameCell.appendChild(nameEditor);
    nameCell.classList.add('sn2-role-preview-cell');
    nameCell.dataset.columnId = '_character';
    if (this._getColumnBorderSet?.().has('_character')) nameCell.classList.add('sn2-role-preview-cell--bordered');
    const typeCell = document.createElement('td');
    typeCell.className = 'sn2-role-manage-cell--linked-type';
    const typeSelect = document.createElement('select');
    typeSelect.className = 'sn2-role-type-select';
    typeSelect.title = 'タイプ未設定の行で、このキャラを選んだ時に補う初期タイプです';
    typeSelect.dataset.e2eId = `scriptnote-character-type-${index}`;
    typeSelect.setAttribute('aria-label', `${character.name || 'キャラ'}の初期タイプ`);
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
      this._pushUndo('キャラ初期タイプ変更');
      adapter.setCharacterType(character, typeSelect.value || null);
      adapter.touch();
      this._refreshRoleManagementPreviews(panelContainer);
    });
    typeCell.appendChild(typeSelect);
    row.append(
      this._buildRoleManagementControlCell('character', row, character, adapter, panelContainer, index),
      nameCell,
      typeCell,
      this._buildCharacterSheetLinkCell(character, index, panelContainer),
    );
    this._applyRoleManagementRowDecoration(row, this._roleManagementEffectiveAppearance('character', character, adapter));
    this._markRoleManagementGridControls(row, index);
    return row;
  },

  _showCharacterNameStylePopup(anchor, character, adapter, panelContainer) {
    if (typeof openFormatPopup !== 'function') return;
    // 開いただけでは文書を書き換えない（空の書式を作るのは実際に変更した時だけ）。
    const currentStyle = () => (character.roleStyle && typeof character.roleStyle === 'object' ? character.roleStyle : null);
    const ensureStyle = () => currentStyle() || (character.roleStyle = {});
    const initial = currentStyle() || {};
    openFormatPopup(anchor, {
      values: {
        bgColor: initial.bgColor || '',
        textColor: initial.textColor || character.nameColor || '',
      },
      fields: ['bgColor', 'textColor'],
      className: 'gb-fmt-popup--character-name-style',
      onChange: (prop, value) => {
        this._pushUndo('キャラ名書式変更');
        const style = ensureStyle();
        if (value === '' || value == null) delete style[prop];
        else style[prop] = value;
        if (prop === 'textColor') character.nameColor = value || '';
        adapter.touch();
        this._refreshRowStyles();
        this._markDirty();
        this._refreshRoleManagementPreviews(panelContainer);
      },
      onReset: () => {
        this._pushUndo('キャラ名書式リセット');
        const style = currentStyle();
        if (style) {
          delete style.bgColor;
          delete style.textColor;
        }
        character.nameColor = '';
        adapter.touch();
        this._refreshRowStyles();
        this._markDirty();
        this._refreshRoleManagementPreviews(panelContainer);
      },
    });
  },

  // キャラ表「キャラ名」見出し: タイプ表の列見出しと同じく、列全体の書式をまとめて設定する。
  // 対象は選択中のキャラ、未選択なら全キャラ。保存先は各キャラの名前書式（キャラ列に表示）。
  _showCharacterColumnBulkPopup(anchorEl, panelContainer) {
    if (typeof openFormatPopup !== 'function') return;
    const adapter = this._roleManagementAdapter();
    const flagProps = new Set(['leftAccent', 'underline']);
    const styleProps = [
      'bgColor', 'textColor', 'fontWeight', 'fontStyle', 'fontSize', 'fontFamily',
      'textStrokeColor', 'textStrokeWidth', 'leftAccent', 'underline', 'accentColor',
    ];
    const getTargets = () => {
      const selectedIds = this._detailCharacterSelection || new Set();
      const selected = adapter.characters.filter(character => selectedIds.has(character.id));
      return selected.length ? selected : adapter.characters;
    };
    const styleOf = character => {
      if (!character.roleStyle || typeof character.roleStyle !== 'object') character.roleStyle = {};
      return character.roleStyle;
    };
    const valueOf = (character, prop) => {
      if (prop === 'textColor') return character.roleStyle?.textColor || character.nameColor || '';
      if (flagProps.has(prop)) return !!character.roleStyle?.[prop];
      return character.roleStyle?.[prop] ?? '';
    };
    // 対象キャラで値が揃っている書式だけを初期表示する（揃っていなければ未設定表示）。
    const initialTargets = getTargets();
    const values = {};
    styleProps.forEach(prop => {
      const candidates = initialTargets.map(character => valueOf(character, prop));
      const shared = candidates.length && candidates.every(value => value === candidates[0]);
      values[prop] = shared ? candidates[0] : (flagProps.has(prop) ? false : '');
    });
    const refresh = () => {
      adapter.touch();
      this._refreshRowStyles();
      this._markDirty();
      this._refreshRoleManagementPreviews(panelContainer);
    };
    openFormatPopup(anchorEl, {
      values,
      fields: [
        'textColor', 'fontSize', 'fontFamily', 'bold', 'italic',
        'textStrokeColor', 'textStrokeWidth', 'bgColor', 'leftAccent', 'underline', 'accentColor',
      ],
      verticalWriting: this.doc.editor?.viewMode === 'vertical',
      className: 'gb-fmt-popup--colbulk',
      positionAnchor: this._detailMultiSelectionPositionAnchor?.(anchorEl, panelContainer),
      onChange: (prop, value) => {
        const targets = getTargets();
        if (!targets.length) return;
        this._pushUndo('キャラ名書式一括変更');
        targets.forEach(character => {
          const style = styleOf(character);
          if (value === '' || value === null || value === undefined || value === false) delete style[prop];
          else style[prop] = value;
          if (prop === 'textColor') character.nameColor = value || '';
        });
        refresh();
      },
      onReset: () => {
        const targets = getTargets();
        if (!targets.length) return;
        this._pushUndo('キャラ名書式一括リセット');
        targets.forEach(character => {
          const style = styleOf(character);
          styleProps.forEach(prop => delete style[prop]);
          character.nameColor = '';
        });
        refresh();
      },
    });
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
    grip.title = 'クリックでメニュー／ドラッグで並べ替え。Alt+上下キーでも移動できます';
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
      try { grip.setPointerCapture?.(event.pointerId); } catch (_) { /* 合成イベント等で捕捉できない時は grip 上の移動だけで続ける */ }
      let destination = null;
      let dragging = false;
      const startX = event.clientX;
      const startY = event.clientY;
      const threshold = globalThis.MeldexRowHandleMenu?.DRAG_THRESHOLD || 4;
      const autoScroll = globalThis.MeldexDragAutoScroll;
      const move = pointerEvent => {
        // 閾値未満の移動はクリック（行メニュー）として扱い、並べ替えを始めない。
        if (!dragging) {
          if (Math.hypot(pointerEvent.clientX - startX, pointerEvent.clientY - startY) < threshold) return;
          dragging = true;
          row.classList.add('sn2-dragging');
          autoScroll?.beginPointerSession?.(startX, startY);
        }
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
        if (dragging) autoScroll?.endPointerSession?.();
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
    globalThis.MeldexRowHandleMenu?.bind?.(grip, {
      getRow: () => grip.closest('.sn2-role-manage-row') || row,
      ariaLabel: `${kind === 'type' ? 'タイプ' : 'キャラ'}のメニュー`,
      e2eId: `scriptnote-${kind}-row-menu`,
      getItems: () => this._roleManagementRowMenuItems(kind, item, adapter, panelContainer, stableSuffix),
    });
    return grip;
  },

  // タイプ表／キャラ表のハンドルクリックで開く行メニュー。
  // 押した行が選択中（2行以上）の時は、一括実行できる項目だけを出し、選択中のすべての行へ適用する
  // （押した行が選択外ならその1行だけ。選択は変えない）。どの一括操作も取り消し1回で戻る。
  _roleManagementRowMenuItems(kind, item, adapter, panelContainer, stableSuffix) {
    const isType = kind === 'type';
    const list = isType ? adapter.types : adapter.characters;
    const index = list.findIndex(candidate => candidate.id === item.id);
    if (index < 0) return [];
    const readOnly = !!this._readOnly;
    const selection = isType ? this._detailTypeSelection : this._detailCharacterSelection;
    const selected = !!selection?.has(item.id);
    const label = isType ? 'タイプ' : 'キャラ';
    const shared = globalThis.MeldexRowHandleMenu;
    const orderedIds = list.map(candidate => candidate.id);
    const targets = shared?.resolveTargets
      ? shared.resolveTargets(item.id, orderedIds, selection || [])
      : { batch: false, ids: [item.id], runs: [[item.id]], count: 1, rowId: item.id };
    const batch = !!targets.batch;
    const targetItems = targets.ids.map(id => list.find(candidate => candidate.id === id)).filter(Boolean);
    const rerender = () => {
      adapter.touch();
      this.renderDetailPanel(panelContainer);
    };
    // 表示中の並び（nextOrder）になるよう、元の配列での順序を組み直す。
    const applyOrder = nextOrder => {
      for (let i = 1; i < nextOrder.length; i += 1) {
        adapter.move(kind, nextOrder[i], { afterId: nextOrder[i - 1] });
      }
    };
    const moveOrder = delta => (shared?.moveOrder ? shared.moveOrder(orderedIds, targets.ids, delta) : null);
    const move = delta => {
      // 動かせない時は取り消し履歴を積まない（空の履歴を残さない）。
      const nextOrder = batch ? moveOrder(delta) : null;
      if (batch && !nextOrder) return;
      this._pushUndo(isType ? 'タイプ並び替え' : 'キャラ並び替え');
      if (batch) {
        applyOrder(nextOrder);
        rerender();
        return;
      }
      if (adapter.move(kind, item.id, delta)) {
        rerender();
        requestAnimationFrame(() => {
          panelContainer.querySelector(`[data-e2e-id="scriptnote-${kind}-drag-${MeldexEscape.cssIdent(stableSuffix)}"]`)?.focus();
        });
      }
    };
    const createBlank = () => (isType ? adapter.addType() : adapter.addCharacter());
    // 行の上／下へ新しいタイプ・キャラを追加する（＋追加ボタンと同じ既定値で作り、位置だけ変える）。
    const insert = after => {
      this._pushUndo(isType ? 'タイプ追加' : 'キャラ追加');
      if (batch) {
        // 連続して選択された行のまとまりごとに、まとまりの件数ぶんを上／下へ入れる。選択は変えない。
        const plans = shared?.planInsertions ? shared.planInsertions(targets, after ? 'below' : 'above') : [];
        plans.forEach(plan => {
          let previousId = plan.anchorId;
          for (let i = 0; i < plan.count; i += 1) {
            const created = createBlank();
            if (!created?.id) continue;
            if (after) {
              adapter.move(kind, created.id, { afterId: previousId });
              previousId = created.id;
            } else {
              adapter.move(kind, created.id, { beforeId: plan.anchorId });
            }
          }
        });
        rerender();
        return;
      }
      const created = createBlank();
      if (!created?.id) return;
      adapter.move(kind, created.id, after ? { afterId: item.id } : { beforeId: item.id });
      selection?.clear?.();
      selection?.add?.(created.id);
      rerender();
      requestAnimationFrame(() => {
        const row = panelContainer.querySelector(`.sn2-role-manage-section--${isType ? 'types' : 'characters'} .sn2-role-manage-row[data-role-id="${MeldexEscape.cssIdent(created.id)}"]`);
        row?.scrollIntoView?.({ block: 'nearest' });
      });
    };
    const duplicate = () => {
      this._pushUndo(isType ? 'タイプ複製' : 'キャラ複製');
      if (batch) {
        // まとまりごとに、まとまり全体の複製をまとまりの直後へ入れる。選択は変えない。
        const plans = shared?.planInsertions ? shared.planInsertions(targets, 'below') : [];
        plans.forEach(plan => {
          let previousId = plan.anchorId;
          plan.ids.forEach(id => {
            const source = list.find(candidate => candidate.id === id);
            const created = source ? adapter.clone(kind, source) : null;
            if (!created?.id) return;
            adapter.move(kind, created.id, { afterId: previousId });
            previousId = created.id;
          });
        });
        rerender();
        return;
      }
      const created = adapter.clone(kind, item);
      selection?.clear?.();
      if (created?.id) selection?.add?.(created.id);
      rerender();
    };
    const items = [
      { icon: 'plus', label: `上に${label}を追加`, e2eId: `scriptnote-${kind}-row-menu-insert-above`, disabled: readOnly,
        batch: true, batchLabel: count => `上に${count}行を追加`,
        action: () => insert(false) },
      { icon: 'plus', label: `下に${label}を追加`, e2eId: `scriptnote-${kind}-row-menu-insert-below`, disabled: readOnly,
        batch: true, batchLabel: count => `下に${count}行を追加`,
        action: () => insert(true) },
      { icon: 'copy', label: '複製', e2eId: `scriptnote-${kind}-row-menu-duplicate`, disabled: readOnly,
        batch: true, batchLabel: count => `${count}行を複製`, action: duplicate },
      { type: 'separator' },
      { icon: 'chevronUp', label: '上へ移動', e2eId: `scriptnote-${kind}-row-menu-move-up`,
        disabled: readOnly || (batch ? !moveOrder(-1) : index === 0),
        batch: true, batchLabel: count => `${count}行を上へ移動`, action: () => move(-1) },
      { icon: 'chevronDown', label: '下へ移動', e2eId: `scriptnote-${kind}-row-menu-move-down`,
        disabled: readOnly || (batch ? !moveOrder(1) : index >= list.length - 1),
        batch: true, batchLabel: count => `${count}行を下へ移動`, action: () => move(1) },
    ];
    if (!isType) {
      // シート連携は1件ずつ選ぶ操作なので、一括時は出さない。
      const linked = !!String(item?.sheetLink?.path || '').trim();
      items.push(
        { type: 'separator' },
        { icon: 'link2', label: linked ? 'シートのトピックを選び直す...' : 'シートのトピックと連携...',
          e2eId: 'scriptnote-character-row-menu-sheet-link', disabled: readOnly,
          action: () => this._showDbImportModal(panelContainer, { linkCharacterId: item.id }) },
        ...(linked ? [{ icon: 'unlink', label: 'シートとの連携を解除', e2eId: 'scriptnote-character-row-menu-sheet-unlink',
          disabled: readOnly, action: () => this._setCharacterSheetLink(item.id, null, panelContainer) }] : []),
      );
    }
    items.push(
      { type: 'separator' },
      { icon: selected ? 'squareMinus' : 'squareCheck', label: selected ? '選択解除' : '選択',
        e2eId: `scriptnote-${kind}-row-menu-select`,
        action: () => {
          if (selected) selection?.delete?.(item.id);
          else selection?.add?.(item.id);
          this.renderDetailPanel(panelContainer);
        } },
      { icon: 'squareMinus', label: '選択を解除', e2eId: `scriptnote-${kind}-row-menu-clear-selection`, batchOnly: true,
        action: () => {
          selection?.clear?.();
          this.renderDetailPanel(panelContainer);
        } },
      { icon: 'arrowLeftRight', label: '選択を反転', e2eId: `scriptnote-${kind}-row-menu-invert-selection`, batchOnly: true,
        action: () => {
          orderedIds.forEach(id => {
            if (selection.has(id)) selection.delete(id);
            else selection.add(id);
          });
          this.renderDetailPanel(panelContainer);
        } },
      { type: 'separator' },
      { icon: 'trash2', label: '削除', danger: true, e2eId: `scriptnote-${kind}-row-menu-delete`, disabled: readOnly,
        batch: true, batchLabel: count => `${count}行を削除`,
        // 置換削除のダイアログを閉じた時は、メニューを開いた行のハンドルへフォーカスを戻す。
        action: () => this._deleteManagedRoles(kind, batch ? targetItems : [item], adapter, panelContainer, null, {
          focusOwner: panelContainer?.querySelector?.(`[data-e2e-id="scriptnote-${kind}-drag-${MeldexEscape.cssIdent(stableSuffix)}"]`),
        }) },
    );
    if (shared?.buildItems) {
      return shared.buildItems(items, targets, { unit: '行', labelE2eId: `scriptnote-${kind}-row-menu-batch-label` });
    }
    return items.filter(entry => !entry.batchOnly);
  },

  // キャラの「シート」列の連携先を設定・解除する（取り消し履歴つき）。
  _setCharacterSheetLink(characterId, link, panelContainer) {
    if (this._readOnly) return false;
    const adapter = this._roleManagementAdapter();
    const character = adapter.characters.find(candidate => candidate.id === characterId);
    if (!character) return false;
    const nextPath = String(link?.path || '').trim();
    const currentPath = String(character.sheetLink?.path || '').trim();
    if (nextPath === currentPath && (!nextPath || String(link?.name || '') === String(character.sheetLink?.name || ''))) return false;
    this._pushUndo(nextPath ? 'キャラのシート連携' : 'キャラのシート連携解除');
    if (nextPath) {
      character.sheetLink = { path: nextPath, name: String(link.name || ''), sheet: String(link.sheet || '') };
    } else {
      delete character.sheetLink;
    }
    adapter.touch();
    if (panelContainer) this.renderDetailPanel(panelContainer);
    return true;
  },

  _deleteManagedRoles(kind, selected, adapter, panelContainer, onDeleted = null, options = {}) {
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
    select.className = 'gb-select gb-select-column';
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
    cancel.dataset.e2eId = `scriptnote-${kind}-delete-cancel`;
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'gb-btn gb-btn-danger';
    confirm.textContent = '置換して削除';
    confirm.dataset.e2eId = `scriptnote-${kind}-delete-confirm`;
    // 行のハンドルメニューから開いた時は、メニューを開いた行のハンドル（focusOwner）へ戻す。
    const owner = options.focusOwner?.isConnected ? options.focusOwner : document.activeElement;
    let busy = false;
    // 開いた操作（行のハンドル）が削除で消えた時は、その表（スクロール領域）へ戻す。
    const returnFocus = () => owner?.isConnected && owner !== document.body
      ? owner
      : panelContainer?.querySelector(`[data-e2e-id="scriptnote-${kind}-list"]`);
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
    if (!select.dataset.e2eId) select.dataset.e2eId = `scriptnote-${kind}-delete-replacement`;
    this._sn2EnsureStableControlIds?.(modal.modal, `scriptnote-${kind}-delete-dialog`);
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

});
