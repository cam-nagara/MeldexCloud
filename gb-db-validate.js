/* ==============================
   gb-db-validate.js: 整合性検証エンジン
   DB間の矛盾・不整合をルールベースで自動検出
   ============================== */

/* --- ルール永続化 --- */

function getValidationRules(dbPath) {
  const fid = _pathToFileId(dbPath);
  if (fid) {
    try {
      const v = localStorage.getItem('validationRules:' + fid);
      if (v) {
        const parsed = JSON.parse(v);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch {}
  }
  try {
    const parsed = JSON.parse(localStorage.getItem('validationRules:' + dbPath));
    return Array.isArray(parsed) ? parsed : [];
  }
  catch { return []; }
}

function setValidationRules(dbPath, rules) {
  const fid = _pathToFileId(dbPath);
  localStorage.setItem('validationRules:' + (fid || dbPath), JSON.stringify(rules));
}

/* --- バリデーション実行 --- */

/**
 * 全ルールを実行し結果を返す
 */
async function runValidation(dbPath, pivotData, propTypes) {
  const savedRules = getValidationRules(dbPath);
  const rules = Array.isArray(savedRules) ? savedRules.filter(r => r && r.enabled !== false) : [];
  if (rules.length === 0) return [];

  const entitiesMap = pivotData.entities || {};
  const entityNames = Object.keys(entitiesMap);
  const results = [];

  for (const rule of rules) {
    let ruleResults = [];
    try {
      switch (rule.type) {
        case 'range_check':
          ruleResults = _validateRangeCheck(rule, entitiesMap, entityNames, dbPath, propTypes);
          break;
        case 'reference_exists':
          ruleResults = await _validateReferenceExists(rule, entitiesMap, entityNames, dbPath, propTypes);
          break;
        case 'cross_db_range':
          ruleResults = await _validateCrossDbRange(rule, entitiesMap, entityNames, dbPath, propTypes);
          break;
        case 'required':
          ruleResults = _validateRequired(rule, entitiesMap, entityNames, dbPath);
          break;
      }
    } catch (e) {
      ruleResults = [{
        ruleId: rule.id, ruleLabel: rule.label || rule.type || '不明なルール', severity: 'error',
        entityName: '(ルール)', entityPath: '',
        message: 'ルール実行に失敗: ' + (e.message || e),
        property: '',
      }];
    }
    results.push(...ruleResults);
  }

  // エラーを先にソート
  results.sort((a, b) => (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1));
  return results;
}

/* --- 各バリデーター --- */

function _validationValues(values, options = {}) {
  const list = Array.isArray(values) ? values : [];
  if (options.allStatuses) return list;
  return list.filter(v => {
    const status = v?.status || '採用';
    return status === '採用' || status === '掲載済み';
  });
}

function _validationRelationNames(entityData, relationProperty, ptc) {
  const vals = _validationValues(entityData?.[relationProperty]);
  const names = [];
  vals.forEach(v => {
    if (!v?.value) return;
    if (ptc?.type === 'multi-relation') {
      String(v.value).split(',').forEach(n => { const t = n.trim(); if (t) names.push(t); });
    } else {
      const t = String(v.value).trim();
      if (t) names.push(t);
    }
  });
  return names;
}

function _validationRuleError(rule, message, property = '') {
  return {
    ruleId: rule.id,
    ruleLabel: rule.label || rule.type || '不明なルール',
    severity: 'error',
    entityName: '(ルール)',
    entityPath: '',
    message,
    property,
  };
}

function _validationComparable(rawValue, ptc) {
  const raw = rawValue == null ? '' : String(rawValue).trim();
  if (!raw) return { ok: false, display: raw };
  const type = ptc?.type || '';
  const dateCandidate = type === 'date' || /^\d{4}[-/]\d{2}[-/]\d{2}/.test(raw);
  if (dateCandidate) {
    const parsed = typeof _dbDateParseValue === 'function' ? _dbDateParseValue(raw) : null;
    const dateRaw = parsed?.range ? parsed.start : (parsed?.start || raw);
    const comparable = typeof _dbDateGetComparableValue === 'function' ? _dbDateGetComparableValue(dateRaw) : dateRaw;
    const d = typeof parseLocalDate === 'function' ? parseLocalDate(comparable) : new Date(comparable);
    if (!Number.isNaN(d.getTime())) return { ok: true, value: d.getTime(), display: comparable };
    return { ok: false, display: raw };
  }
  const normalized = raw.replace(/,/g, '');
  if (/^[+-]?(?:\d+|\d*\.\d+)$/.test(normalized)) {
    const n = Number(normalized);
    if (Number.isFinite(n)) return { ok: true, value: n, display: raw };
  }
  if (type === 'number') return { ok: false, display: raw };
  return { ok: true, value: raw, display: raw };
}

function _validationCompare(left, right, operator) {
  const bothNumbers = typeof left === 'number' && typeof right === 'number';
  const cmp = bothNumbers ? (left - right) : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
  switch (operator) {
    case '>=': return cmp >= 0;
    case '<=': return cmp <= 0;
    case '>':  return cmp > 0;
    case '<':  return cmp < 0;
    case '==': return bothNumbers ? left === right : String(left) === String(right);
    case '!=': return bothNumbers ? left !== right : String(left) !== String(right);
  }
  return true;
}

function _validateRangeCheck(rule, entitiesMap, entityNames, dbPath, propTypes) {
  const results = [];
  const { property, operator, compareProperty } = rule.config || {};
  if (!property || !operator || !compareProperty) return results;
  const ptc1 = propTypes?.[property];
  const ptc2 = propTypes?.[compareProperty];

  entityNames.forEach(en => {
    const vals1 = _validationValues(entitiesMap[en][property] || [], { allStatuses: true });
    const vals2 = _validationValues(entitiesMap[en][compareProperty] || [], { allStatuses: true });
    if (vals1.length === 0 || vals2.length === 0) return;
    vals1.forEach(val1 => {
      vals2.forEach(val2 => {
        const v1 = _validationComparable(val1.value, ptc1);
        const v2 = _validationComparable(val2.value, ptc2);
        if (!v1.ok || !v2.ok) return;
        const pass = _validationCompare(v1.value, v2.value, operator);
        if (!pass) {
          results.push({
            ruleId: rule.id, ruleLabel: rule.label, severity: 'error',
            entityName: en, entityPath: _entityPath(dbPath, en),
            message: property + '(' + v1.display + ') ' + operator + ' ' + compareProperty + '(' + v2.display + '): 条件不一致',
            property,
          });
        }
      });
    });
  });
  return results;
}

function _buildValidationRelationTargetIndex(targetEntities) {
  const names = new Set();
  const ids = new Map();
  Object.entries(targetEntities || {}).forEach(([name, entity]) => {
    names.add(name);
    const entityId = entity?._id;
    if (entityId) ids.set(String(entityId), name);
  });
  return { names, ids };
}

function _resolveValidationTargetName(rawNameOrId, targetIndex) {
  const token = String(rawNameOrId || '').trim();
  if (!token) return '';
  if (targetIndex.names.has(token)) return token;
  return targetIndex.ids.get(token) || '';
}

async function _validateReferenceExists(rule, entitiesMap, entityNames, dbPath, propTypes) {
  const results = [];
  const { relationProperty } = rule.config || {};
  if (!relationProperty) return results;

  const ptc = propTypes?.[relationProperty];
  if (!ptc) return results;
  // 自己参照: relationDb が未設定または '' の場合は現在のDBを指す
  const _relDb = (ptc.relationDb === '' || ptc.relationDb == null) ? dbPath : ptc.relationDb;
  if (!_relDb) return results;

  const targetData = await fetchRelatedDbData(_relDb);
  if (!targetData || !targetData.entities) {
    return [_validationRuleError(rule, relationProperty + ': 参照先シートを読み込めません: ' + _relDb, relationProperty)];
  }

  const targetIndex = _buildValidationRelationTargetIndex(targetData.entities);

  entityNames.forEach(en => {
    const names = _validationRelationNames(entitiesMap[en], relationProperty, ptc);
    names.forEach(nameOrId => {
      const targetName = _resolveValidationTargetName(nameOrId, targetIndex);
      if (!targetName) {
        results.push({
          ruleId: rule.id, ruleLabel: rule.label, severity: 'error',
          entityName: en, entityPath: _entityPath(dbPath, en),
          message: relationProperty + ': 「' + nameOrId + '」は参照先シートに存在しません',
          property: relationProperty,
        });
      }
    });
  });
  return results;
}

async function _validateCrossDbRange(rule, entitiesMap, entityNames, dbPath, propTypes) {
  const results = [];
  const { property, operator, targetDb, targetProperty, matchRelation } = rule.config || {};
  if (!property || !operator || !targetDb || !targetProperty || !matchRelation) return results;

  const targetData = await fetchRelatedDbData(targetDb);
  if (!targetData || !targetData.entities) {
    return [_validationRuleError(rule, '参照先シートを読み込めません: ' + targetDb, targetProperty)];
  }
  const targetIndex = _buildValidationRelationTargetIndex(targetData.entities);
  const sourcePtc = propTypes?.[property];

  entityNames.forEach(en => {
    const names = _validationRelationNames(entitiesMap[en], matchRelation, propTypes?.[matchRelation]);
    if (names.length === 0) return;

    const vals = _validationValues(entitiesMap[en][property] || []);
    if (vals.length === 0) return;

    names.forEach(targetNameOrId => {
      const targetName = _resolveValidationTargetName(targetNameOrId, targetIndex);
      if (!targetName) {
        results.push({
          ruleId: rule.id, ruleLabel: rule.label, severity: 'error',
          entityName: en, entityPath: _entityPath(dbPath, en),
          message: matchRelation + ': 「' + targetNameOrId + '」は参照先シートに存在しません',
          property: matchRelation,
        });
        return;
      }
      const targetEntity = targetData.entities[targetName];
      if (!targetEntity) return;
      const targetVals = _validationValues(targetEntity[targetProperty] || []);
      if (targetVals.length === 0) return;
      vals.forEach(val1 => {
        targetVals.forEach(val2 => {
          const v1 = _validationComparable(val1.value, sourcePtc);
          const v2 = _validationComparable(val2.value, null);
          if (!v1.ok || !v2.ok) return;
          const pass = _validationCompare(v1.value, v2.value, operator);
          if (!pass) {
            results.push({
              ruleId: rule.id, ruleLabel: rule.label, severity: 'error',
              entityName: en, entityPath: _entityPath(dbPath, en),
              message: property + '(' + v1.display + ') ' + operator + ' ' + targetName + '.' + targetProperty + '(' + v2.display + '): 他シート条件不一致',
              property,
            });
          }
        });
      });
    });
  });
  return results;
}

function _validateRequired(rule, entitiesMap, entityNames, dbPath) {
  const results = [];
  const { property, statusFilter } = rule.config || {};
  if (!property) return results;

  entityNames.forEach(en => {
    // ステータスフィルタ: 対象エントリのみ
    if (statusFilter) {
      const mainStatus = typeof getEntityMainStatus === 'function' ? getEntityMainStatus(entitiesMap[en]) : '';
      if (mainStatus !== statusFilter) return;
    }
    const vals = _validationValues(entitiesMap[en][property] || []);
    const hasValue = vals.some(v => v?.value != null && String(v.value).trim() !== '');
    if (!hasValue) {
      results.push({
        ruleId: rule.id, ruleLabel: rule.label, severity: 'warning',
        entityName: en, entityPath: _entityPath(dbPath, en),
        message: property + ' が空です（' + (statusFilter || '全') + 'トピック）',
        property,
      });
    }
  });
  return results;
}

/* --- UI: 検証結果モーダル --- */

function _validationOpenAfterClose(modalApi, reason, openNext) {
  modalApi.close(reason);
  const continueWhenClosed = () => {
    if (modalApi.overlay.isConnected) {
      setTimeout(continueWhenClosed, 30);
      return;
    }
    openNext();
  };
  continueWhenClosed();
}

function showValidationResults(results, dbPath, dialogFlow) {
  const flow = dialogFlow || { returnFocus: document.activeElement };
  const errors = results.filter(r => r.severity === 'error').length;
  const warnings = results.filter(r => r.severity === 'warning').length;
  const body = document.createElement('div');
  body.className = 'gb-validation-results-content';

  if (results.length === 0) {
    const ok = document.createElement('div');
    ok.style.cssText = 'text-align:center;padding:40px;color:var(--fg2);font-size:14px;';
    ok.textContent = '問題は見つかりませんでした';
    body.appendChild(ok);
  } else {
    const list = document.createElement('div');
    list.className = 'gb-validation-results-list';
    list.style.cssText = 'flex:1;overflow-y:auto;';
    results.forEach(r => {
      const item = document.createElement('div');
      item.className = 'gb-validation-result-item';
      item.style.cssText = 'padding:8px 12px;border-bottom:1px solid var(--bg4);cursor:pointer;';
      item.addEventListener('mouseenter', () => { item.style.background = 'var(--bg4)'; });
      item.addEventListener('mouseleave', () => { item.style.background = ''; });

      const icon = r.severity === 'error'
        ? `<span style="color:var(--red);">${lucide('circleX', 14)}</span>`
        : `<span style="color:#e6a700;">${lucide('circleAlert', 14)}</span>`;
      const header = document.createElement('div');
      header.style.cssText = 'font-size:13px;font-weight:bold;display:flex;align-items:center;gap:4px;';
      header.innerHTML = icon + ' ' + esc(r.entityName) + ' — ' + esc(r.ruleLabel);
      item.appendChild(header);

      const msg = document.createElement('div');
      msg.style.cssText = 'font-size:12px;color:var(--fg2);margin-top:2px;';
      msg.textContent = r.message;
      item.appendChild(msg);

      item.addEventListener('click', () => {
        modalApi.close('select-result');
        if (r.entityPath) selectEntity(r.entityPath);
      });
      list.appendChild(item);
    });
    body.appendChild(list);
  }

  // フッター
  const rulesBtn = document.createElement('button');
  rulesBtn.type = 'button';
  rulesBtn.className = 'gb-btn gb-btn-sm';
  rulesBtn.textContent = 'ルール管理';
  rulesBtn.dataset.e2eId = 'validation-results-rules';
  rulesBtn.addEventListener('click', () => {
    _validationOpenAfterClose(modalApi, 'open-rules', () => showValidationRulesModal(dbPath, flow));
  });
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'gb-btn gb-btn-sm';
  closeBtn.textContent = '閉じる';
  closeBtn.setAttribute('aria-label', '検証結果を閉じる');
  closeBtn.dataset.e2eId = 'validation-results-close';
  closeBtn.addEventListener('click', () => modalApi.close('close-button'));

  const modalApi = window.GBUI.createModal({
    id: 'validation-results-dialog',
    title: '検証結果: ' + errors + ' エラー / ' + warnings + ' 警告',
    body,
    footer: [rulesBtn, closeBtn],
    variant: 'standard',
    extraClass: 'gb-validation-results-modal',
    geometryKey: 'validation-results',
    initialFocus: '[data-e2e-id="validation-results-close"]',
    returnFocus: () => flow.returnFocus,
  });
  modalApi.overlay.classList.add('modal-overlay');
  modalApi.overlay._validationModalApi = modalApi;
  modalApi.modal.classList.add('modal');
  modalApi.modal.dataset.e2eId = 'validation-results-dialog';
  modalApi.footer.classList.add('gb-validation-footer');
  modalApi.open();
}

/* --- UI: ルール管理モーダル --- */

function showValidationRulesModal(dbPath, dialogFlow) {
  const flow = dialogFlow || { returnFocus: document.activeElement };

  const rules = getValidationRules(dbPath);
  const list = document.createElement('div');
  list.className = 'gb-validation-rules-list';
  list.style.cssText = 'flex:1;overflow-y:auto;';

  if (rules.length === 0) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--fg2);">ルールなし</div>';
  } else {
    rules.forEach((rule, i) => {
      const item = document.createElement('div');
      item.className = 'gb-validation-rule-row';
      item.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--bg4);';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'gb-validation-rule-check';
      cb.dataset.e2eId = 'validation-rule-' + (rule.id || i) + '-enabled';
      cb.setAttribute('aria-label', (rule.label || rule.type || 'ルール') + 'を有効化');
      cb.checked = rule.enabled !== false;
      cb.addEventListener('change', () => {
        rules[i].enabled = cb.checked;
        setValidationRules(dbPath, rules);
      });
      item.appendChild(cb);

      const label = document.createElement('span');
      label.className = 'gb-validation-rule-label';
      label.style.cssText = 'flex:1;font-size:13px;';
      label.textContent = rule.label || rule.type;
      item.appendChild(label);

      const typeBadge = document.createElement('span');
      typeBadge.className = 'gb-validation-rule-type';
      typeBadge.style.cssText = 'font-size:10px;background:var(--bg4);padding:1px 6px;border-radius:8px;color:var(--fg2);';
      typeBadge.textContent = rule.type;
      item.appendChild(typeBadge);

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'gb-btn gb-btn-xs';
      editBtn.textContent = '編集';
      editBtn.dataset.e2eId = 'validation-rule-' + (rule.id || i) + '-edit';
      editBtn.setAttribute('aria-label', (rule.label || rule.type || 'ルール') + 'を編集');
      editBtn.style.cssText = 'font-size:11px;padding:1px 6px;';
      editBtn.addEventListener('click', () => {
        _validationOpenAfterClose(modalApi, 'edit-rule', () => {
          showValidationRuleEditor(dbPath, { ...rule, config: { ...(rule.config || {}) } }, flow);
        });
      });
      item.appendChild(editBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'gb-btn gb-btn-xs gb-btn-danger';
      delBtn.textContent = '削除';
      delBtn.dataset.e2eId = 'validation-rule-' + (rule.id || i) + '-delete';
      delBtn.setAttribute('aria-label', (rule.label || rule.type || 'ルール') + 'を削除');
      delBtn.style.cssText = 'font-size:11px;padding:1px 6px;';
      delBtn.addEventListener('click', async () => {
        const ok = typeof cfConfirm === 'function'
          ? await cfConfirm('この検証ルールを削除しますか？', { danger: true, okLabel: '削除' })
          : (typeof confirm === 'function' ? confirm('この検証ルールを削除しますか？') : true);
        if (!ok) return;
        rules.splice(i, 1);
        setValidationRules(dbPath, rules);
        _validationOpenAfterClose(modalApi, 'delete-rule', () => showValidationRulesModal(dbPath, flow));
      });
      item.appendChild(delBtn);

      list.appendChild(item);
    });
  }

  // 新規ルール追加
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'gb-btn gb-btn-sm gb-btn-primary';
  addBtn.textContent = '+ 新規ルール';
  addBtn.dataset.e2eId = 'validation-add-rule';
  addBtn.addEventListener('click', () => {
    _validationOpenAfterClose(modalApi, 'add-rule', () => showValidationRuleEditor(dbPath, null, flow));
  });
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'gb-btn gb-btn-sm';
  closeBtn.textContent = '閉じる';
  closeBtn.setAttribute('aria-label', 'ルール管理を閉じる');
  closeBtn.dataset.e2eId = 'validation-rules-close';
  closeBtn.addEventListener('click', () => modalApi.close('close-button'));

  const modalApi = window.GBUI.createModal({
    id: 'validation-rules-dialog',
    title: 'バリデーションルール',
    body: list,
    footer: [addBtn, closeBtn],
    variant: 'standard',
    extraClass: 'gb-validation-rules-modal',
    geometryKey: 'validation-rules',
    initialFocus: '[data-e2e-id="validation-add-rule"]',
    returnFocus: () => flow.returnFocus,
  });
  modalApi.overlay.classList.add('modal-overlay');
  modalApi.overlay._validationModalApi = modalApi;
  modalApi.modal.classList.add('modal');
  modalApi.modal.dataset.e2eId = 'validation-rules-dialog';
  modalApi.footer.classList.add('gb-validation-footer');
  modalApi.open();
}

/* --- UI: ルール編集モーダル --- */

function showValidationRuleEditor(dbPath, existingRule, dialogFlow) {
  const flow = dialogFlow || { returnFocus: document.activeElement };
  const rule = existingRule || { id: 'rule-' + Date.now(), type: 'range_check', label: '', enabled: true, config: {} };
  const body = document.createElement('div');
  body.className = 'gb-validation-editor-content';

  // ルール名
  const nameField = document.createElement('div');
  nameField.className = 'field';
  nameField.innerHTML = '<label>ルール名</label>';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.id = 'vr-rule-name';
  nameInput.dataset.e2eId = 'validation-editor-name';
  nameInput.value = rule.label;
  nameInput.placeholder = '例: 回収話 >= 仕込み話';
  nameField.appendChild(nameInput);
  body.appendChild(nameField);

  // ルールタイプ
  const typeField = document.createElement('div');
  typeField.className = 'field';
  typeField.innerHTML = '<label>タイプ</label>';
  const typeSel = document.createElement('select');
  typeSel.id = 'vr-rule-type';
  typeSel.dataset.e2eId = 'validation-editor-type';
  typeSel.setAttribute('aria-label', 'バリデーションルールタイプ');
  [
    { key: 'range_check', label: '列間の比較' },
    { key: 'reference_exists', label: 'リレーション先の存在確認' },
    { key: 'cross_db_range', label: '他シートの列との比較' },
    { key: 'required', label: '必須列' },
  ].forEach(opt => {
    const o = document.createElement('option');
    o.value = opt.key; o.textContent = opt.label;
    if (opt.key === rule.type) o.selected = true;
    typeSel.appendChild(o);
  });
  typeField.appendChild(typeSel);
  body.appendChild(typeField);

  // 設定エリア
  const configDiv = document.createElement('div');
  configDiv.id = 'vr-config';
  body.appendChild(configDiv);

  const props = state.pivotData ? state.pivotData.properties : [];
  const operators = [
    { key: '>=', label: '>=' }, { key: '<=', label: '<=' },
    { key: '>', label: '>' }, { key: '<', label: '<' },
    { key: '==', label: '==' }, { key: '!=', label: '!=' },
  ];

  function renderConfig() {
    const type = typeSel.value;
    configDiv.innerHTML = '';
    if (type === 'range_check') {
      configDiv.innerHTML = _fieldSelect('列1', 'vr-prop1', props, rule.config.property) +
        _fieldSelect('比較演算子', 'vr-op', operators.map(o => o.key), rule.config.operator) +
        _fieldSelect('列2', 'vr-prop2', props, rule.config.compareProperty);
    } else if (type === 'reference_exists') {
      const relProps = props.filter(p => { const pt = getPropertyTypes(dbPath)?.[p]; return pt && (pt.type === 'relation' || pt.type === 'multi-relation'); });
      configDiv.innerHTML = _fieldSelect('リレーション列', 'vr-relprop', relProps, rule.config.relationProperty);
    } else if (type === 'cross_db_range') {
      configDiv.innerHTML = _fieldSelect('列', 'vr-prop1', props, rule.config.property) +
        _fieldSelect('演算子', 'vr-op', operators.map(o => o.key), rule.config.operator) +
        '<div class="field"><label>参照先シートパス</label><input id="vr-targetdb" type="text" value="' + esc(rule.config.targetDb || '') + '" placeholder="例: ストーリー/アーク"></div>' +
        '<div class="field"><label>参照先の列</label><input id="vr-targetprop" type="text" value="' + esc(rule.config.targetProperty || '') + '"></div>' +
        _fieldSelect('マッチリレーション', 'vr-matchrel', props, rule.config.matchRelation);
    } else if (type === 'required') {
      configDiv.innerHTML = _fieldSelect('列', 'vr-prop1', props, rule.config.property) +
        '<div class="field"><label>対象ステータス（空=全て）</label><input id="vr-status" type="text" value="' + esc(rule.config.statusFilter || '') + '" placeholder="例: 採用"></div>';
    }
  }
  typeSel.addEventListener('change', renderConfig);
  renderConfig();

  // ボタン
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'gb-btn gb-btn-sm';
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.dataset.e2eId = 'validation-editor-cancel';
  cancelBtn.addEventListener('click', () => {
    _validationOpenAfterClose(modalApi, 'cancel', () => showValidationRulesModal(dbPath, flow));
  });
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = '保存';
  saveBtn.className = 'gb-btn gb-btn-sm gb-btn-primary primary';
  saveBtn.dataset.e2eId = 'validation-editor-save';
  saveBtn.addEventListener('click', () => {
    rule.label = nameInput.value.trim();
    rule.type = typeSel.value;
    rule.config = _collectRuleConfig(rule.type);
    const errors = _validationRuleConfigErrors(rule.type, rule.config, rule.label);
    if (errors.length) {
      if (typeof showStatus === 'function') showStatus(errors[0], true);
      return;
    }
    const rules = getValidationRules(dbPath);
    const idx = rules.findIndex(r => r.id === rule.id);
    if (idx >= 0) rules[idx] = rule; else rules.push(rule);
    setValidationRules(dbPath, rules);
    _validationOpenAfterClose(modalApi, 'save', () => showValidationRulesModal(dbPath, flow));
    showStatus('ルールを保存しました');
  });

  const modalApi = window.GBUI.createModal({
    id: 'validation-rule-editor-dialog',
    title: existingRule ? 'ルール編集' : '新規ルール',
    body,
    footer: [cancelBtn, saveBtn],
    variant: 'standard',
    extraClass: 'gb-validation-rule-editor',
    geometryKey: 'validation-rule-editor',
    initialFocus: '#vr-rule-name',
    returnFocus: () => flow.returnFocus,
  });
  modalApi.overlay.classList.add('modal-overlay');
  modalApi.overlay._validationModalApi = modalApi;
  modalApi.overlay.style.zIndex = '130';
  modalApi.modal.classList.add('modal');
  modalApi.modal.dataset.e2eId = 'validation-rule-editor-dialog';
  modalApi.footer.classList.add('gb-validation-footer', 'gb-validation-editor-footer');
  modalApi.open();
}

function _validationRuleConfigErrors(type, config, label) {
  const cfg = config || {};
  const errors = [];
  if (!String(label || '').trim()) errors.push('ルール名を入力してください');
  if (type === 'range_check') {
    if (!cfg.property) errors.push('列1を選択してください');
    if (!cfg.operator) errors.push('比較演算子を選択してください');
    if (!cfg.compareProperty) errors.push('列2を選択してください');
  } else if (type === 'reference_exists') {
    if (!cfg.relationProperty) errors.push('リレーション列を選択してください');
  } else if (type === 'cross_db_range') {
    if (!cfg.property) errors.push('列を選択してください');
    if (!cfg.operator) errors.push('演算子を選択してください');
    if (!String(cfg.targetDb || '').trim()) errors.push('参照先シートパスを入力してください');
    if (!String(cfg.targetProperty || '').trim()) errors.push('参照先の列を入力してください');
    if (!cfg.matchRelation) errors.push('マッチリレーションを選択してください');
  } else if (type === 'required') {
    if (!cfg.property) errors.push('列を選択してください');
  }
  return errors;
}

function _fieldSelect(label, id, options, selected) {
  let html = '<div class="field"><label>' + esc(label) + '</label><select id="' + id + '">';
  html += '<option value="">選択...</option>';
  options.forEach(o => {
    const val = typeof o === 'string' ? o : (o.key || String(o));
    html += '<option value="' + esc(val) + '"' + (val === selected ? ' selected' : '') + '>' + esc(val) + '</option>';
  });
  html += '</select></div>';
  return html;
}

function _collectRuleConfig(type) {
  if (type === 'range_check') {
    return {
      property: document.getElementById('vr-prop1')?.value || '',
      operator: document.getElementById('vr-op')?.value || '>=',
      compareProperty: document.getElementById('vr-prop2')?.value || '',
    };
  } else if (type === 'reference_exists') {
    return { relationProperty: document.getElementById('vr-relprop')?.value || '' };
  } else if (type === 'cross_db_range') {
    return {
      property: document.getElementById('vr-prop1')?.value || '',
      operator: document.getElementById('vr-op')?.value || '>=',
      targetDb: (document.getElementById('vr-targetdb')?.value || '').trim(),
      targetProperty: (document.getElementById('vr-targetprop')?.value || '').trim(),
      matchRelation: document.getElementById('vr-matchrel')?.value || '',
    };
  } else if (type === 'required') {
    return {
      property: document.getElementById('vr-prop1')?.value || '',
      statusFilter: (document.getElementById('vr-status')?.value || '').trim(),
    };
  }
  return {};
}

/* --- ツールバーハンドラ --- */

async function onValidateClick() {
  const dbPath = state.currentDbPath;
  if (!dbPath || !state.pivotData) { showStatus('シートを選択してください', true); return; }
  showStatus('検証中...');
  const propTypes = getPropertyTypes(dbPath);
  let validationData = state.pivotData;
  try {
    validationData = await apiFetch('/pivot?path=' + encodeURIComponent(dbPath));
  } catch (e) {
    showStatus('検証データの取得に失敗: ' + (e.message || e), true);
    return;
  }
  const results = await runValidation(dbPath, validationData, propTypes);
  showValidationResults(results, dbPath);
  const errorCount = results.filter(r => r.severity === 'error').length;
  const warningCount = results.filter(r => r.severity === 'warning').length;
  if (errorCount > 0) showStatus(errorCount + '件のエラーを検出');
  else if (warningCount > 0) showStatus(warningCount + '件の警告を検出');
  else showStatus('検証完了 — 問題なし');
}
