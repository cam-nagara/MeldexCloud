        <input id="pt-calsync-target-db" type="text" value="${esc(safe.targetDb || '')}" placeholder="例: ShareDevelop/Meldex開発/カレンダー/AI修正スケジュール">
      </div>
      <div class="field"><label>タイトルテンプレート ${fieldHelp('利用可能な変数: {entryName} / {entryPath} / {entryId}')}</label>
        <input id="pt-calsync-title-tmpl" type="text" value="${esc(safe.titleTemplate || '{entryName}')}" placeholder="{entryName}">
      </div>
      <div class="field"><label>説明テンプレート ${fieldHelp('テンプレ変数に加え、トピックの採用列名も {列名} で参照できます')}</label>
        <textarea id="pt-calsync-desc-tmpl" rows="3" placeholder="デバッグリストエントリ: {entryPath}">${esc(safe.descriptionTemplate || '')}</textarea>
      </div>
      <div class="field"><label>色ルール (JSON 配列) ${fieldHelp('上から順に評価し、最初にマッチしたルールの color を使います。default ルールがフォールバックになります')}</label>
        <textarea id="pt-calsync-color-rules" rows="5" placeholder='[
  { "when": { "prop": "進捗", "equals": "完了" }, "color": "#6a9955" },
  { "default": "#569cd6" }
]'>${esc(colorRulesJson)}</textarea>
      </div>
      <div class="field"><label>トピック削除時の挙動</label>
        <select id="pt-calsync-on-entry-delete">
          <option value="deleteEvent" ${(safe.onEntryDelete || 'deleteEvent') === 'deleteEvent' ? 'selected' : ''}>イベントも削除</option>
          <option value="orphan" ${safe.onEntryDelete === 'orphan' ? 'selected' : ''}>孤立マーク（残す）</option>
          <option value="ignore" ${safe.onEntryDelete === 'ignore' ? 'selected' : ''}>何もしない</option>
        </select>
      </div>
      <div class="field"><label>日時クリア時の挙動</label>
        <select id="pt-calsync-on-date-cleared">
          <option value="deleteEvent" ${(safe.onDateCleared || 'deleteEvent') === 'deleteEvent' ? 'selected' : ''}>イベントを削除</option>
          <option value="ignore" ${safe.onDateCleared === 'ignore' ? 'selected' : ''}>何もしない</option>
        </select>
      </div>
      <div class="field">
        <label class="pt-check-label">
          <input id="pt-calsync-reverse-enabled" type="checkbox" ${rsObj.enabled !== false ? 'checked' : ''}>
          カレンダー側の変更を逆方向同期する
        </label>
        <label class="pt-check-label" style="margin-top:4px;">
          <input id="pt-calsync-reverse-skip-rec" type="checkbox" ${rsObj.skipIfRecurrence !== false ? 'checked' : ''}>
          繰り返し化されたイベントは逆方向同期しない（推奨）
        </label>
      </div>
      <div class="field"><label>書き戻し時のステータス</label>
        <input id="pt-calsync-write-status" type="text" value="${esc(safe.writeStatus || '採用')}" placeholder="採用">
      </div>
    </div>
  `;
}

function _bindCalendarSyncEditor(root) {
  const chk = _ptGet('pt-calsync-enabled', root);
  const body = _ptGet('pt-calsync-body', root);
  const tgt = _ptGet('pt-calsync-target-db', root);
  if (chk && body) {
    chk.addEventListener('change', () => { body.style.display = chk.checked ? '' : 'none'; });
  }
  if (tgt && typeof _attachDbPicker === 'function') _attachDbPicker(tgt, _ptState(root)?.dbPath);
}

// applyPropertyType から呼ばれる。calendarSync セクションの入力値を収集して返す（無効時は null）。
function _collectCalendarSyncConfig(root) {
  const chk = _ptGet('pt-calsync-enabled', root);
  if (!chk || !chk.checked) return null;
  const targetDb = _ptGet('pt-calsync-target-db', root)?.value?.trim() || '';
  if (!targetDb) {
    showStatus('カレンダー連動: 対象カレンダーシートを指定してください', true);
    throw new Error('calendarSync.targetDb is required');
  }
  const titleTemplate = _ptGet('pt-calsync-title-tmpl', root)?.value?.trim() || '{entryName}';
  const descriptionTemplate = _ptGet('pt-calsync-desc-tmpl', root)?.value || '';
  const rulesRaw = _ptGet('pt-calsync-color-rules', root)?.value?.trim() || '';
  let colorRules = [];
  if (rulesRaw) {
    try {
      colorRules = JSON.parse(rulesRaw);
      if (!Array.isArray(colorRules)) throw new Error('配列ではありません');
    } catch (e) {
      showStatus('色ルールのJSONが不正: ' + (e?.message || e), true);
      throw e;
    }
  }
  const onEntryDelete = _ptGet('pt-calsync-on-entry-delete', root)?.value || 'deleteEvent';
  const onDateCleared = _ptGet('pt-calsync-on-date-cleared', root)?.value || 'deleteEvent';
  const reverseSync = {
    enabled: !!_ptGet('pt-calsync-reverse-enabled', root)?.checked,
    syncDate: true,
    syncTitle: false,
    skipIfRecurrence: !!_ptGet('pt-calsync-reverse-skip-rec', root)?.checked,
  };
  const writeStatus = _ptGet('pt-calsync-write-status', root)?.value?.trim() || '採用';
  const out = { targetDb, titleTemplate, descriptionTemplate, onEntryDelete, onDateCleared, reverseSync, writeStatus };
  if (colorRules.length) out.colorRules = colorRules;
  return out;
}

// 選択肢欄の初期値: スキーマ登録済み選択肢に、列内で実際に使われている値
// （スキーマ未登録の値。型変更前の入力・外部書き込み等）を統合して表示する。
// これにより「選択肢の色」欄にも列内の全値が並び、値ごとに色を設定できる。
// マルチセレクトはカンマ結合で保存されるため個別値へ分割してから統合する。
// 行ごとに候補が変わる動的選択肢列（optionSource）では実在値を混ぜない。
function _ptMergedSelectOptions(current, existing, type) {
  const merged = [];
  const seen = new Set();
  const push = (value) => {
    const v = String(value ?? '').trim();
    if (v && !seen.has(v)) { seen.add(v); merged.push(v); }
  };
  (Array.isArray(current?.options) ? current.options : []).forEach(push);
  if (!current?.optionSource) {
    (existing || []).forEach(raw => {
      if (type === 'multi-select') String(raw ?? '').split(',').forEach(push);
      else push(raw);
    });
  }
  return merged;
}

function onPropertyTypeChange(root) {
  const scope = _ptResolveRoot(root);
  window._ptActiveRoot = scope;
  const baseType = _ptGet('pt-type', scope)?.value || 'text';
  const type = _ptReadUiType(scope);
  const optDiv = _ptGet('pt-options', scope);
  if (!optDiv) return;
  const multRow = _ptGet('pt-multiplicity-row', scope);
  if (multRow) {
    multRow.hidden = typeof isPropertyTypeMultiplicityBase === 'function'
      ? !isPropertyTypeMultiplicityBase(baseType)
      : !['select', 'relation', 'user'].includes(baseType);
  }
  const { current, existing, propName: statePropName, dbPath } = _ptState(scope);

  if (type === 'select' || type === 'multi-select') {
    const opts = _ptMergedSelectOptions(current, existing, type);
    const optionColorHelp = fieldHelp('色はセル・ドロップダウン・カンバン・グループヘッダーに反映されます。セル編集時の選択肢ドロップダウンからも設定できます')
      .replace('<span ', '<span data-e2e-id="pt-select-option-color-help" ');
    optDiv.innerHTML = `<div class="field"><label>選択肢 ${optionColorHelp}</label>
      <textarea id="pt-select-options" hidden aria-hidden="true">${esc(opts.join('\n'))}</textarea>
      <div id="pt-select-option-rows" class="pt-select-option-list" data-e2e-id="pt-select-option-list"></div>
      <button type="button" id="pt-select-option-add" class="gb-btn gb-btn-sm pt-select-option-add" data-e2e-id="pt-select-option-add">＋ 選択肢</button>
    </div>`;
    scope._dbOptionColorBuffer = { ...(current.optionColors || {}) };
    if (typeof renderDbSelectOptionRows === 'function') {
      renderDbSelectOptionRows(_ptGet('pt-select-option-rows', scope), scope);
    }
  } else if (type === 'relation' || type === 'multi-relation') {
    // 現在のDBのリレーション型プロパティ一覧（カスケード元の候補）
    const relProps = [];
    const pts = getPropertyTypes(dbPath || state.currentDbPath);
    if (pts) {
      for (const [p, cfg] of Object.entries(pts)) {
