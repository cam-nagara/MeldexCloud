/* gb-scriptnote-rowset.js: 台本エディタ v2 — 行セットタブ
   ScriptNoteEditor.prototype を拡張する
   行の組み合わせを指定回数分、台本に追加する機能 */

const SN2_ROWSET_PRESETS_STORAGE_KEY = 'sn2-rowset-presets';
const SN2_ROWSET_STORAGE_HISTORY_SCOPE = 'settings:scriptnote';

function _snRowsetCaptureStorageHistory() {
  if (typeof captureLocalStorageSettings !== 'function') return null;
  if (typeof isLocalStorageSettingsHistorySuppressed === 'function'
    && isLocalStorageSettingsHistorySuppressed()) return null;
  return captureLocalStorageSettings([SN2_ROWSET_PRESETS_STORAGE_KEY]);
}

function _snRowsetRefreshAfterHistory() {
  if (typeof forEachComponent !== 'function') return;
  forEachComponent(component => {
    if (!component?._editor || component._editor._detailActiveTab !== 'rowset') return;
    if (typeof component._syncDetailPanel === 'function') component._syncDetailPanel();
  });
}

function _snRowsetPushStorageHistory(label, beforeSnapshot, detail) {
  if (!beforeSnapshot || typeof historyPush !== 'function'
    || typeof captureLocalStorageSettings !== 'function'
    || typeof restoreLocalStorageSettings !== 'function'
    || typeof _normalizeLocalStorageSettingsSnapshots !== 'function') return false;
  const afterSnapshot = captureLocalStorageSettings([SN2_ROWSET_PRESETS_STORAGE_KEY]);
  const snapshots = _normalizeLocalStorageSettingsSnapshots(beforeSnapshot, afterSnapshot);
  let beforeKey = '';
  let afterKey = '';
  try {
    beforeKey = JSON.stringify(snapshots.before);
    afterKey = JSON.stringify(snapshots.after);
  } catch {}
  if (beforeKey && beforeKey === afterKey) return false;
  historyPush(
    label || 'シナリオ: 行セットプリセット変更',
    () => restoreLocalStorageSettings(snapshots.before, _snRowsetRefreshAfterHistory),
    () => restoreLocalStorageSettings(snapshots.after, _snRowsetRefreshAfterHistory),
    SN2_ROWSET_STORAGE_HISTORY_SCOPE,
    detail || '行セットプリセット'
  );
  return true;
}

Object.assign(ScriptNoteEditor.prototype, {

  _readRowsetPresets() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SN2_ROWSET_PRESETS_STORAGE_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  },

  _writeRowsetPresets(presets, options = {}) {
    const beforeStorage = options.skipHistory ? null : _snRowsetCaptureStorageHistory();
    localStorage.setItem(SN2_ROWSET_PRESETS_STORAGE_KEY, JSON.stringify(presets && typeof presets === 'object' ? presets : {}));
    if (!options.skipHistory) {
      _snRowsetPushStorageHistory(
        options.label || 'シナリオ: 行セットプリセット変更',
        beforeStorage,
        options.detail || ''
      );
    }
  },

  renderRowsetPanel(container) {
    if (!container || !this.doc) return;
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'sn2-rowset-panel';
    wrap.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:auto;';

    // 現在の行セット状態（セッション中保持）
    if (!this._rowsetRows) this._rowsetRows = [];

    const charaNames = (this.doc.characters || []).map(c => c.name).filter(Boolean);
    const validRoles = new Set(charaNames);
    this._rowsetRows.forEach(entry => {
      if (entry?.role && !validRoles.has(entry.role)) entry.role = '';
    });

    // ── ヘッダー ──
    const header = document.createElement('div');
    header.className = 'sn2-detail-header';
    header.innerHTML = '<span style="font-weight:600;font-size:13px;">行セット</span>';
    wrap.appendChild(header);

    // ── プリセット ──
    const presetRow = document.createElement('div');
    presetRow.style.cssText = 'display:flex;align-items:center;gap:4px;padding:4px 12px;border-bottom:1px solid var(--border);';
    const presetSel = document.createElement('select');
    presetSel.style.cssText = 'flex:1;font-size:11px;padding:2px 4px;';
    presetSel.dataset.e2eId = 'scriptnote-rowset-preset-select';
    presetSel.title = '行セットプリセットを選択';
    presetSel.setAttribute('aria-label', '行セットプリセットを選択');
    this._refreshRowsetPresetOptions(presetSel);
    presetSel.addEventListener('change', () => {
      const val = presetSel.value;
      if (!val) return;
      const presets = this._readRowsetPresets();
      const preset = presets[val];
      if (preset) {
        this._rowsetRows = JSON.parse(JSON.stringify(preset));
        this.renderRowsetPanel(container);
      }
    });
    presetRow.appendChild(presetSel);
    // 保存ボタン
    const saveBtn = document.createElement('button');
    saveBtn.className = 'sn2-detail-add-btn';
    saveBtn.type = 'button';
    saveBtn.textContent = '保存';
    saveBtn.title = '現在の行セットをプリセットとして保存';
    saveBtn.dataset.e2eId = 'scriptnote-rowset-save-preset';
    saveBtn.setAttribute('aria-label', '現在の行セットをプリセットとして保存');
    saveBtn.addEventListener('click', () => {
      if (!this._rowsetRows.length) return;
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `<div class="modal" style="min-width:280px;"><h3>行セットプリセット保存</h3>
        <div class="modal-body" style="padding:12px 16px;"><label>プリセット名<input type="text" id="sn2-rsp-name" style="width:100%;padding:4px 6px;margin-top:4px;" placeholder="台詞＋ト書き"></label></div>
        <div class="btn-row" style="display:flex;gap:8px;justify-content:flex-end;padding:8px 16px 16px;">
          <button type="button" class="cancel-btn">キャンセル</button><button type="button" class="primary ok-btn">保存</button>
        </div></div>`;
      const doSave = () => {
        const name = overlay.querySelector('#sn2-rsp-name').value.trim();
        if (!name) return;
        overlay.remove();
        const presets = this._readRowsetPresets();
        presets[name] = JSON.parse(JSON.stringify(this._rowsetRows));
        this._writeRowsetPresets(presets, {
          label: 'シナリオ: 行セットプリセット保存',
          detail: name,
        });
        this._refreshRowsetPresetOptions(presetSel);
        if (typeof showStatus === 'function') showStatus(`行セットプリセット「${name}」を保存しました`);
      };
      overlay.querySelector('.ok-btn').addEventListener('click', doSave);
      overlay.querySelector('.cancel-btn').addEventListener('click', () => overlay.remove());
      overlay.querySelector('#sn2-rsp-name').addEventListener('keydown', ev => { if (ev.key === 'Enter') doSave(); });
      document.body.appendChild(overlay);
      overlay.querySelector('#sn2-rsp-name').focus();
    });
    presetRow.appendChild(saveBtn);
    // 削除ボタン
    const delPresetBtn = document.createElement('button');
    delPresetBtn.className = 'sn2-detail-add-btn';
    delPresetBtn.type = 'button';
    delPresetBtn.textContent = '削除';
    delPresetBtn.title = '選択中のプリセットを削除';
    delPresetBtn.dataset.e2eId = 'scriptnote-rowset-delete-preset';
    delPresetBtn.setAttribute('aria-label', '選択中のプリセットを削除');
    delPresetBtn.addEventListener('click', () => {
      const val = presetSel.value;
      if (!val) return;
      const presets = this._readRowsetPresets();
      if (!presets[val]) return;
      if (typeof showConfirmDialog === 'function') {
        showConfirmDialog(`プリセット「${val}」を削除しますか？`, () => {
          delete presets[val];
          this._writeRowsetPresets(presets, {
            label: 'シナリオ: 行セットプリセット削除',
            detail: val,
          });
          this._refreshRowsetPresetOptions(presetSel);
          if (typeof showStatus === 'function') showStatus(`プリセット「${val}」を削除しました`);
        });
      }
    });
    presetRow.appendChild(delPresetBtn);
    wrap.appendChild(presetRow);

    // ── 行リスト ──
    const listLabel = document.createElement('div');
    listLabel.style.cssText = 'padding:8px 12px 4px;font-size:11px;font-weight:600;color:var(--fg2);';
    listLabel.textContent = '行の組み合わせ';
    wrap.appendChild(listLabel);

    const listWrap = document.createElement('div');
    listWrap.style.cssText = 'overflow-y:auto;padding:0 8px;';
    const list = document.createElement('div');
    list.className = 'sn2-rowset-list';

    this._rowsetRows.forEach((entry, i) => {
      const item = document.createElement('div');
      item.className = 'sn2-detail-item';
      item.style.cssText = 'display:flex;align-items:center;gap:4px;padding:3px 4px;min-height:28px;';
      item.draggable = true;
      item.dataset.idx = i;

      // ドラッグハンドル
      const handle = document.createElement('span');
      handle.className = 'sn2-detail-handle';
      handle.textContent = '⠿';
      handle.style.cssText = 'cursor:grab;color:var(--fg2);font-size:10px;';
      item.appendChild(handle);

      // タイプ選択
      const sel = document.createElement('select');
      sel.style.cssText = 'flex:1;font-size:12px;padding:2px 4px;min-width:0;';
      sel.dataset.e2eId = 'scriptnote-rowset-role-' + i;
      sel.title = '行セット ' + (i + 1) + ' 行目のタイプ';
      sel.setAttribute('aria-label', sel.title);
      const emptyOpt = document.createElement('option');
      emptyOpt.value = '';
      emptyOpt.textContent = '（なし）';
      sel.appendChild(emptyOpt);
      charaNames.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        if (name === entry.role) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', () => { entry.role = sel.value; });
      item.appendChild(sel);

      // 削除ボタン
      const delBtn = document.createElement('button');
      delBtn.className = 'gb-fmt-btn';
      delBtn.type = 'button';
      delBtn.textContent = '✕';
      delBtn.title = '行セット ' + (i + 1) + ' 行目を削除';
      delBtn.dataset.e2eId = 'scriptnote-rowset-delete-row-' + i;
      delBtn.setAttribute('aria-label', delBtn.title);
      delBtn.style.cssText = 'font-size:10px;color:var(--fg2);flex-shrink:0;';
      delBtn.addEventListener('click', () => {
        this._rowsetRows.splice(i, 1);
        this.renderRowsetPanel(container);
      });
      item.appendChild(delBtn);

      list.appendChild(item);
    });

    // D&D
    this._setupRowsetDragDrop(list, container);

    listWrap.appendChild(list);
    wrap.appendChild(listWrap);

    // ── 追加ボタン ──
    const addBtn = document.createElement('button');
    addBtn.className = 'sn2-detail-add-btn';
    addBtn.type = 'button';
    addBtn.textContent = '＋ 行を追加';
    addBtn.dataset.e2eId = 'scriptnote-rowset-add-row';
    addBtn.title = '行セットに行を追加';
    addBtn.setAttribute('aria-label', '行セットに行を追加');
    addBtn.style.cssText = 'margin:4px 12px;';
    addBtn.addEventListener('click', () => {
      this._rowsetRows.push({ role: '' });
      this.renderRowsetPanel(container);
    });
    wrap.appendChild(addBtn);

    // ── 実行セクション ──
    const execRow = document.createElement('div');
    execRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 12px;border-top:1px solid var(--border);justify-content:flex-end;';
    const repeatLabel = document.createElement('span');
    repeatLabel.style.cssText = 'font-size:12px;color:var(--fg2);';
    repeatLabel.textContent = '回数';
    execRow.appendChild(repeatLabel);
    const repeatInput = document.createElement('input');
    repeatInput.type = 'number';
    repeatInput.min = '1';
    repeatInput.max = '100';
    repeatInput.value = this._rowsetRepeat || '1';
    repeatInput.dataset.e2eId = 'scriptnote-rowset-repeat';
    repeatInput.title = '行セットの追加回数';
    repeatInput.setAttribute('aria-label', '行セットの追加回数');
    repeatInput.style.cssText = 'width:50px;font-size:12px;padding:2px 4px;border:1px solid var(--border);border-radius:3px;background:var(--bg);color:var(--fg);';
    repeatInput.addEventListener('change', () => { this._rowsetRepeat = parseInt(repeatInput.value) || 1; });
    execRow.appendChild(repeatInput);
    const execBtn = document.createElement('button');
    execBtn.className = 'sn2-detail-add-btn';
    execBtn.type = 'button';
    execBtn.textContent = 'シナリオに追加';
    execBtn.dataset.e2eId = 'scriptnote-rowset-insert';
    execBtn.title = '行セットをシナリオに追加';
    execBtn.setAttribute('aria-label', '行セットをシナリオに追加');
    execBtn.style.cssText = 'padding:4px 12px;font-size:12px;font-weight:600;';
    execBtn.addEventListener('click', () => this._execRowsetInsert(container));
    execRow.appendChild(execBtn);
    wrap.appendChild(execRow);

    container.appendChild(wrap);
  },

  _execRowsetInsert(panelContainer) {
    if (!this._rowsetRows.length || !this.doc) return;
    const repeat = Math.max(1, Math.min(100, this._rowsetRepeat || 1));

    // カーソル位置を特定
    let insertIdx = this.doc.rows.length - 1;
    const sel = window.getSelection();
    if (sel?.rangeCount) {
      const textEl = sel.focusNode?.nodeType === 1
        ? sel.focusNode.closest?.('.sn2-text')
        : sel.focusNode?.parentElement?.closest?.('.sn2-text');
      if (textEl) {
        const rowEl = textEl.closest('.sn2-row');
        if (rowEl) {
          const rowId = rowEl.dataset.rowId;
          const idx = this.doc.rows.findIndex(r => r.id === rowId);
          if (idx >= 0) insertIdx = idx;
        }
      }
    }

    this._pushUndo('行セット追加');
    const newRows = [];
    let newStatus = '';
    if (this._filterStatuses && this._filterStatuses.size === 1) {
      newStatus = [...this._filterStatuses][0];
    }
    for (let r = 0; r < repeat; r++) {
      this._rowsetRows.forEach(entry => {
        newRows.push({
          id: `sn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: entry.role || '',
          status: newStatus,
          text: '',
          columns: {},
        });
      });
    }
    this.doc.rows.splice(insertIdx + 1, 0, ...newRows);
    this._calcCache = null;
    this._render();
    this._markDirty({ skipUndo: true });

    // 最初の追加行にフォーカス
    if (newRows.length) {
      requestAnimationFrame(() => {
        const rowEl = this.host?.querySelector(`.sn2-row[data-row-id="${newRows[0].id}"]`);
        const textEl = rowEl?.querySelector('.sn2-text');
        if (textEl) this._focusText(textEl, 'start');
      });
    }
    if (typeof showStatus === 'function') showStatus(`${newRows.length}行を追加しました`);
  },

  _refreshRowsetPresetOptions(sel) {
    const presets = this._readRowsetPresets();
    const prevVal = sel.value;
    while (sel.options.length) sel.remove(0);
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = '（プリセット選択）';
    sel.appendChild(emptyOpt);
    Object.keys(presets).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    if (prevVal && [...sel.options].some(o => o.value === prevVal)) sel.value = prevVal;
  },

  _setupRowsetDragDrop(listEl, panelContainer) {
    let dragIdx = -1;
    const clearDragState = () => {
      dragIdx = -1;
      listEl.querySelectorAll('.sn2-detail-item').forEach(el => el.classList.remove('sn2-dragging', 'sn2-drop-above', 'sn2-drop-below'));
    };
    listEl.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.sn2-detail-item');
      if (!item) return;
      dragIdx = Number(item.dataset.idx);
      item.classList.add('sn2-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    listEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      listEl.querySelectorAll('.sn2-detail-item').forEach(el => el.classList.remove('sn2-drop-above', 'sn2-drop-below'));
      const item = e.target.closest('.sn2-detail-item');
      if (item) {
        const rect = item.getBoundingClientRect();
        item.classList.toggle('sn2-drop-above', e.clientY < rect.top + rect.height / 2);
        item.classList.toggle('sn2-drop-below', e.clientY >= rect.top + rect.height / 2);
      }
    });
    listEl.addEventListener('dragend', () => {
      clearDragState();
    });
    listEl.addEventListener('drop', (e) => {
      e.preventDefault();
      const item = e.target.closest('.sn2-detail-item');
      if (!item || dragIdx < 0) { clearDragState(); return; }
      let dropIdx = Number(item.dataset.idx);
      const rect = item.getBoundingClientRect();
      if (e.clientY >= rect.top + rect.height / 2) dropIdx++;
      if (dropIdx === dragIdx || dropIdx === dragIdx + 1) { clearDragState(); return; }
      const [moved] = this._rowsetRows.splice(dragIdx, 1);
      this._rowsetRows.splice(dropIdx > dragIdx ? dropIdx - 1 : dropIdx, 0, moved);
      clearDragState();
      this.renderRowsetPanel(panelContainer);
    });
  },

});
