/* gb-scriptnote-pages.js: シナリオのページ単位の操作
   「区切り」タイプの行から、次の区切り行の手前までを1ページとして扱い、
   ページの追加・削除・複製・上下移動を行う。どの表示・モードでも同じ規則で動く。
   区切りタイプに「交互に使う区切り」（例: 右改頁⇔左改頁）を設定している時は、
   ページの増減・移動のあとで、以降の区切り行の左右を自動で振り直す。 */

Object.assign(ScriptNoteEditor.prototype, {

  _scenarioBreakTypeNames() {
    return this._getRoleFlagSets?.().breakNames || new Set();
  },

  _isScenarioBreakRow(row, breakNames = this._scenarioBreakTypeNames()) {
    return !!row?.role && breakNames.has(row.role);
  },

  // index の行を含むページの範囲 [start, end)。区切り行がない文書は全体で1ページ。
  _scenarioPageRange(index, breakNames = this._scenarioBreakTypeNames()) {
    const rows = this.doc?.rows || [];
    if (!rows.length) return { start: 0, end: 0 };
    const at = Math.max(0, Math.min(rows.length - 1, index));
    let start = at;
    while (start > 0 && !this._isScenarioBreakRow(rows[start], breakNames)) start -= 1;
    let end = start + 1;
    while (end < rows.length && !this._isScenarioBreakRow(rows[end], breakNames)) end += 1;
    return { start, end };
  },

  _scenarioPageHasBreaks(breakNames = this._scenarioBreakTypeNames()) {
    return (this.doc?.rows || []).some(row => this._isScenarioBreakRow(row, breakNames));
  },

  _scenarioTypeOfRow(row) {
    const effective = globalThis.GBScriptNoteRoleModel?.getEffectiveRole?.(this.doc, row);
    return effective?.type || null;
  },

  _newScenarioRow(typeRef, status = '') {
    const row = {
      id: `sn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      character: '',
      characterRef: { kind: 'none', id: '__none__' },
      type: '',
      role: '',
      status,
      text: '',
      columns: {},
    };
    const model = globalThis.GBScriptNoteRoleModel;
    if (model?.assignRowType) {
      model.assignRowType(this.doc, row, typeRef || null);
      model.assignRowCharacter?.(this.doc, row, '');
    } else if (typeRef?.name) {
      row.type = typeRef.name;
      row.role = typeRef.name;
    }
    return row;
  },

  // 交互に使う区切りタイプの組（タイプID → 相手のタイプID）。片側だけの設定も相互に扱う。
  _scenarioAlternatingBreakPairs() {
    const types = Array.isArray(this.doc?.scenarioTypes) ? this.doc.scenarioTypes : [];
    const byId = new Map(types.map(type => [type.id, type]));
    const pairs = new Map();
    types.forEach(type => {
      const partner = byId.get(type?.alternateBreakTypeId);
      if (!type?.isBreak || !partner?.isBreak || partner.id === type.id) return;
      pairs.set(type.id, partner.id);
      if (!pairs.has(partner.id)) pairs.set(partner.id, type.id);
    });
    return pairs;
  },

  // fromIndex 以降の区切り行を、直前の区切り行から交互になるよう振り直す。
  // fromIndex より前の区切り行は変えない（基準にするだけ）。変えた行数を返す。
  _realternateScenarioBreaks(fromIndex = 0) {
    const pairs = this._scenarioAlternatingBreakPairs();
    if (!pairs.size) return 0;
    const rows = this.doc.rows;
    const typeIdOf = row => {
      const ref = row?.typeRef;
      if (ref?.kind === 'type' && ref.id) return ref.id;
      return this._scenarioTypeOfRow(row)?.id || '';
    };
    let previous = '';
    for (let i = Math.min(fromIndex, rows.length) - 1; i >= 0; i -= 1) {
      const id = typeIdOf(rows[i]);
      if (pairs.has(id)) { previous = id; break; }
    }
    let changed = 0;
    for (let i = Math.max(0, fromIndex); i < rows.length; i += 1) {
      const id = typeIdOf(rows[i]);
      if (!pairs.has(id)) continue;
      const expected = previous && pairs.has(previous) && (pairs.get(previous) === id || previous === id)
        ? pairs.get(previous)
        : id;
      if (expected !== id) {
        globalThis.GBScriptNoteRoleModel?.assignRowType?.(this.doc, rows[i], { kind: 'type', id: expected });
        changed += 1;
      }
      previous = expected;
    }
    if (changed) this._calcCache = null;
    return changed;
  },

  // rowId の行を含むページの下（または上）に新しいページを追加する。
  // 新しいページは「区切り行＋1行」。2行目のタイプは、操作した行のタイプ
  // （絞り込みで1タイプだけ表示している時はそのタイプ）を使う。
  _insertScenarioPageRelative(rowId, position = 'below', focusColId = '_text') {
    if (this._readOnly) return null;
    const rows = this.doc.rows;
    const index = rows.findIndex(row => row.id === rowId);
    if (index < 0) return null;
    const breakNames = this._scenarioBreakTypeNames();
    if (!this._scenarioPageHasBreaks(breakNames)) {
      if (typeof showStatus === 'function') showStatus('区切りの行がないため、ページ単位では追加できません', true);
      return null;
    }
    const { start, end } = this._scenarioPageRange(index, breakNames);
    const breakSource = this._isScenarioBreakRow(rows[start], breakNames)
      ? rows[start]
      : rows.find(row => this._isScenarioBreakRow(row, breakNames));
    const breakType = this._scenarioTypeOfRow(breakSource);
    const current = rows[index];
    let contentType = this._isScenarioBreakRow(current, breakNames) ? null : this._scenarioTypeOfRow(current);
    if (this._filterRoles?.size === 1) {
      const onlyName = [...this._filterRoles][0];
      contentType = (this.doc.scenarioTypes || []).find(type => type?.name === onlyName) || contentType;
    }
    const status = this._filterStatuses?.size === 1 ? [...this._filterStatuses][0] : (current.status || '');
    if (this._cellEditMode) this._exitEditMode?.();
    this._pushUndo('ページ追加');
    const breakRow = this._newScenarioRow(breakType ? { kind: 'type', id: breakType.id } : null, status);
    const contentRow = this._newScenarioRow(contentType ? { kind: 'type', id: contentType.id } : null, status);
    const insertAt = position === 'above' ? start : end;
    // 最初の区切り行より前の行（1ページ目）の上に足す時は、先頭の区切り行はページを
    // 送らないため「1行＋区切り行」の順に入れ、元の1ページ目を次のページへ送る。
    const leadingPage = insertAt === 0 && !this._isScenarioBreakRow(rows[0], breakNames);
    if (leadingPage) rows.splice(insertAt, 0, contentRow, breakRow);
    else rows.splice(insertAt, 0, breakRow, contentRow);
    this._realternateScenarioBreaks(insertAt);
    this._calcCache = null;
    this._render();
    this._markDirty({ skipUndo: true });
    const target = this._isRoleVisible?.(contentRow) === false ? breakRow : contentRow;
    if (this._getCellElement?.(target.id, focusColId)) this._setActiveCell(target.id, focusColId, false);
    else this._activateCellNear?.(rows.indexOf(target), focusColId);
    return contentRow;
  },

  // 指定行を含むページをまとめて削除する。絞り込みで隠れている行も含むため、
  // 隠れた行がある時だけ確認する（Ctrl+Z で戻せる）。
  _deleteScenarioPagesForRows(rowIds, colId = '_text', { confirm = true } = {}) {
    if (this._readOnly) return false;
    const rows = this.doc.rows;
    const breakNames = this._scenarioBreakTypeNames();
    if (!this._scenarioPageHasBreaks(breakNames)) {
      if (typeof showStatus === 'function') showStatus('区切りの行がないため、ページ単位では削除できません', true);
      return false;
    }
    const remove = new Set();
    let firstStart = Infinity;
    (rowIds || []).forEach(id => {
      const index = rows.findIndex(row => row.id === id);
      if (index < 0) return;
      const { start, end } = this._scenarioPageRange(index, breakNames);
      firstStart = Math.min(firstStart, start);
      for (let i = start; i < end; i += 1) remove.add(rows[i].id);
    });
    if (!remove.size) return false;
    if (remove.size >= rows.length) {
      if (typeof showStatus === 'function') showStatus('すべてのページは削除できません', true);
      return false;
    }
    const pageCount = new Set([...remove].map(id => this._scenarioPageRange(rows.findIndex(row => row.id === id), breakNames).start)).size;
    const hiddenCount = rows.filter(row => remove.has(row.id)
      && !this._isScenarioBreakRow(row, breakNames)
      && this._isRoleVisible?.(row) === false).length;
    const run = () => {
      if (this._cellEditMode) this._exitEditMode?.();
      this._pushUndo(pageCount > 1 ? `${pageCount}ページを削除` : 'ページ削除');
      this.doc.rows = this.doc.rows.filter(row => !remove.has(row.id));
      remove.forEach(id => this._rowSelection?.delete?.(id));
      this._gridCellSelection?.clear?.();
      this._gridCellAnchor = null;
      this._textCellSelection?.clear?.();
      this._activeCellRowId = null;
      this._activeCellColId = null;
      this._realternateScenarioBreaks(firstStart);
      this._calcCache = null;
      this._render();
      this._markDirty({ skipUndo: true });
      this._updateRowSelectionUI?.();
      this._activateCellNearAfterClose?.(firstStart, colId);
    };
    if (confirm && hiddenCount > 0 && typeof showConfirmDialog === 'function') {
      showConfirmDialog(`${pageCount}ページを削除します。表示されていない${hiddenCount}行も一緒に削除されます（Ctrl+Z で戻せます）。`, run);
      return true;
    }
    run();
    return true;
  },

  _duplicateScenarioPage(rowId) {
    if (this._readOnly) return null;
    const rows = this.doc.rows;
    const index = rows.findIndex(row => row.id === rowId);
    if (index < 0 || !this._scenarioPageHasBreaks()) return null;
    const breakNames = this._scenarioBreakTypeNames();
    const { start, end } = this._scenarioPageRange(index, breakNames);
    this._pushUndo('ページ複製');
    const copies = rows.slice(start, end).map(row => ({
      ...JSON.parse(JSON.stringify(row)),
      id: `sn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    }));
    // 区切り行で始まらない1ページ目を複製する時は、複製の前に区切り行を足して別のページにする。
    if (!this._isScenarioBreakRow(rows[start], breakNames)) {
      const breakType = this._scenarioTypeOfRow(rows.find(row => this._isScenarioBreakRow(row, breakNames)));
      copies.unshift(this._newScenarioRow(breakType ? { kind: 'type', id: breakType.id } : null, rows[start]?.status || ''));
    }
    rows.splice(end, 0, ...copies);
    this._realternateScenarioBreaks(end);
    this._calcCache = null;
    this._render();
    this._markDirty({ skipUndo: true });
    return copies;
  },

  // ページを前後のページと入れ替える（dir: -1 上へ / 1 下へ）。
  _moveScenarioPage(rowId, dir) {
    if (this._readOnly) return false;
    const rows = this.doc.rows;
    const index = rows.findIndex(row => row.id === rowId);
    if (index < 0 || !this._scenarioPageHasBreaks()) return false;
    const page = this._scenarioPageRange(index);
    const neighborIndex = dir < 0 ? page.start - 1 : page.end;
    if (neighborIndex < 0 || neighborIndex >= rows.length) return false;
    const neighbor = this._scenarioPageRange(neighborIndex);
    // 先頭ページが区切り行で始まらない時は、区切りの位置がずれるので入れ替えない。
    const breakNames = this._scenarioBreakTypeNames();
    if (!this._isScenarioBreakRow(rows[Math.min(page.start, neighbor.start)], breakNames)) return false;
    this._pushUndo('ページ移動');
    const first = dir < 0 ? neighbor : page;
    const second = dir < 0 ? page : neighbor;
    const firstRows = rows.slice(first.start, first.end);
    const secondRows = rows.slice(second.start, second.end);
    rows.splice(first.start, second.end - first.start, ...secondRows, ...firstRows);
    this._realternateScenarioBreaks(first.start);
    this._calcCache = null;
    this._render();
    this._markDirty({ skipUndo: true });
    const colId = this._activeCellColId || '_text';
    if (this._getCellElement?.(rowId, colId)) this._setActiveCell(rowId, colId, false);
    return true;
  },
});
