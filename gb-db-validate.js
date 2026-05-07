/* ==============================
   gb-db-validate.js: 整合性検証エンジン
   DB間の矛盾・不整合をルールベースで自動検出
   ============================== */

/* --- ルール永続化 --- */

function getValidationRules(dbPath) {
  const fid = _pathToFileId(dbPath);
  if (fid) { try { const v = localStorage.getItem('validationRules:' + fid); if (v) return JSON.parse(v); } catch {} }
  try { return JSON.parse(localStorage.getItem('validationRules:' + dbPath)) || []; }
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
  const rules = getValidationRules(dbPath).filter(r => r.enabled !== false);
  if (rules.length === 0) return [];

  const entitiesMap = pivotData.entities || {};
  const entityNames = Object.keys(entitiesMap);
  const results = [];

  for (const rule of rules) {
    let ruleResults = [];
    try {
      switch (rule.type) {
        case 'range_check':
          ruleResults = _validateRangeCheck(rule, entitiesMap, entityNames, dbPath);
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

function _validationValues(values) {
  return Array.isArray(values) ? values : [];
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

function _validateRangeCheck(rule, entitiesMap, entityNames, dbPath) {
  const results = [];
  const { property, operator, compareProperty } = rule.config || {};
  if (!property || !operator || !compareProperty) return results;

  entityNames.forEach(en => {
    const vals1 = _validationValues(entitiesMap[en][property] || []);
    const vals2 = _validationValues(entitiesMap[en][compareProperty] || []);
    if (vals1.length === 0 || vals2.length === 0) return;
    vals1.forEach(val1 => {
      vals2.forEach(val2 => {
        const v1 = parseFloat(val1.value);
        const v2 = parseFloat(val2.value);
        if (isNaN(v1) || isNaN(v2)) return;

        let pass = false;
        switch (operator) {
          case '>=': pass = v1 >= v2; break;
          case '<=': pass = v1 <= v2; break;
          case '>':  pass = v1 > v2; break;
          case '<':  pass = v1 < v2; break;
          case '==': pass = v1 === v2; break;
          case '!=': pass = v1 !== v2; break;
        }
        if (!pass) {
          results.push({
            ruleId: rule.id, ruleLabel: rule.label, severity: 'error',
            entityName: en, entityPath: _entityPath(dbPath, en),
            message: property + '(' + v1 + ') ' + operator + ' ' + compareProperty + '(' + v2 + '): 条件不一致',
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
  if (!targetData || !targetData.entities) return results;

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
  if (!targetData || !targetData.entities) return results;
  const targetIndex = _buildValidationRelationTargetIndex(targetData.entities);

  entityNames.forEach(en => {
    const names = _validationRelationNames(entitiesMap[en], matchRelation, propTypes?.[matchRelation]);
    if (names.length === 0) return;

    const vals = _validationValues(entitiesMap[en][property] || []);
    if (vals.length === 0) return;

    names.forEach(targetNameOrId => {
      const targetName = _resolveValidationTargetName(targetNameOrId, targetIndex);
      if (!targetName) return;
      const targetEntity = targetData.entities[targetName];
      if (!targetEntity) return;
      const targetVals = _validationValues(targetEntity[targetProperty] || []);
      if (targetVals.length === 0) return;
      vals.forEach(val1 => {
        targetVals.forEach(val2 => {
          const v1 = parseFloat(val1.value);
          const v2 = parseFloat(val2.value);
          if (isNaN(v1) || isNaN(v2)) return;

          let pass = false;
          switch (operator) {
            case '>=': pass = v1 >= v2; break;
            case '<=': pass = v1 <= v2; break;
            case '>':  pass = v1 > v2; break;
            case '<':  pass = v1 < v2; break;
            case '==': pass = v1 === v2; break;
            case '!=': pass = v1 !== v2; break;
          }
          if (!pass) {
            results.push({
              ruleId: rule.id, ruleLabel: rule.label, severity: 'error',
              entityName: en, entityPath: _entityPath(dbPath, en),
              message: property + '(' + v1 + ') ' + operator + ' ' + targetName + '.' + targetProperty + '(' + v2 + '): 他シート条件不一致',
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
        message: property + ' が空です（' + (statusFilter || '全') + 'エントリ）',
        property,
      });
    }
  });
  return results;
}

/* --- UI: 検証結果モーダル --- */

function showValidationResults(results, dbPath) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.cssText = 'width:600px;max-width:90vw;max-height:80vh;display:flex;flex-direction:column;';

  // ヘッダー
  const h3 = document.createElement('h3');
  const errors = results.filter(r => r.severity === 'error').length;
  const warnings = results.filter(r => r.severity === 'warning').length;
  h3.textContent = '検証結果: ' + errors + ' エラー / ' + warnings + ' 警告';
  h3.style.margin = '0 0 12px 0';
  modal.appendChild(h3);

  if (results.length === 0) {
    const ok = document.createElement('div');
    ok.style.cssText = 'text-align:center;padding:40px;color:var(--fg2);font-size:14px;';
    ok.textContent = '問題は見つかりませんでした';
    modal.appendChild(ok);
  } else {
    const list = document.createElement('div');
    list.style.cssText = 'flex:1;overflow-y:auto;';
    results.forEach(r => {
      const item = document.createElement('div');
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
        overlay.remove();
        if (r.entityPath) selectEntity(r.entityPath);
      });
      list.appendChild(item);
    });
    modal.appendChild(list);
  }

  // フッター
  const footer = document.createElement('div');
  footer.style.cssText = 'margin-top:12px;display:flex;justify-content:space-between;';
  const rulesBtn = document.createElement('button');
  rulesBtn.textContent = 'ルール管理';
  rulesBtn.dataset.e2eId = 'validation-results-rules';
  rulesBtn.addEventListener('click', () => { overlay.remove(); showValidationRulesModal(dbPath); });
  footer.appendChild(rulesBtn);
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '閉じる';
  closeBtn.dataset.e2eId = 'validation-results-close';
  closeBtn.addEventListener('click', () => overlay.remove());
  footer.appendChild(closeBtn);
  modal.appendChild(footer);

  overlay.appendChild(modal);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

/* --- UI: ルール管理モーダル --- */

function showValidationRulesModal(dbPath) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.cssText = 'width:600px;max-width:90vw;max-height:80vh;display:flex;flex-direction:column;';

  const h3 = document.createElement('h3');
  h3.textContent = 'バリデーションルール';
  h3.style.margin = '0 0 12px 0';
  modal.appendChild(h3);

  const rules = getValidationRules(dbPath);
  const list = document.createElement('div');
  list.style.cssText = 'flex:1;overflow-y:auto;';

  if (rules.length === 0) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--fg2);">ルールなし</div>';
  } else {
    rules.forEach((rule, i) => {
      const item = document.createElement('div');
      item.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--bg4);';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.e2eId = 'validation-rule-' + (rule.id || i) + '-enabled';
      cb.setAttribute('aria-label', (rule.label || rule.type || 'ルール') + 'を有効化');
      cb.checked = rule.enabled !== false;
      cb.addEventListener('change', () => {
        rules[i].enabled = cb.checked;
        setValidationRules(dbPath, rules);
      });
      item.appendChild(cb);

      const label = document.createElement('span');
      label.style.cssText = 'flex:1;font-size:13px;';
      label.textContent = rule.label || rule.type;
      item.appendChild(label);

      const typeBadge = document.createElement('span');
      typeBadge.style.cssText = 'font-size:10px;background:var(--bg4);padding:1px 6px;border-radius:8px;color:var(--fg2);';
      typeBadge.textContent = rule.type;
      item.appendChild(typeBadge);

      const delBtn = document.createElement('button');
      delBtn.textContent = '削除';
      delBtn.dataset.e2eId = 'validation-rule-' + (rule.id || i) + '-delete';
      delBtn.setAttribute('aria-label', (rule.label || rule.type || 'ルール') + 'を削除');
      delBtn.style.cssText = 'font-size:11px;padding:1px 6px;';
      delBtn.addEventListener('click', () => {
        rules.splice(i, 1);
        setValidationRules(dbPath, rules);
        overlay.remove();
        showValidationRulesModal(dbPath);
      });
      item.appendChild(delBtn);

      list.appendChild(item);
    });
  }
  modal.appendChild(list);

  // 新規ルール追加
  const footer = document.createElement('div');
  footer.style.cssText = 'margin-top:12px;display:flex;justify-content:space-between;';
  const addBtn = document.createElement('button');
  addBtn.textContent = '+ 新規ルール';
  addBtn.dataset.e2eId = 'validation-add-rule';
  addBtn.addEventListener('click', () => { overlay.remove(); showValidationRuleEditor(dbPath, null); });
  footer.appendChild(addBtn);
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '閉じる';
  closeBtn.dataset.e2eId = 'validation-rules-close';
  closeBtn.addEventListener('click', () => overlay.remove());
  footer.appendChild(closeBtn);
  modal.appendChild(footer);

  overlay.appendChild(modal);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

/* --- UI: ルール編集モーダル --- */

function showValidationRuleEditor(dbPath, existingRule) {
  const rule = existingRule || { id: 'rule-' + Date.now(), type: 'range_check', label: '', enabled: true, config: {} };
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '130';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.cssText = 'width:500px;max-width:90vw;';

  const h3 = document.createElement('h3');
  h3.textContent = existingRule ? 'ルール編集' : '新規ルール';
  h3.style.margin = '0 0 12px 0';
  modal.appendChild(h3);

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
  modal.appendChild(nameField);

  // ルールタイプ
  const typeField = document.createElement('div');
  typeField.className = 'field';
  typeField.innerHTML = '<label>タイプ</label>';
  const typeSel = document.createElement('select');
  typeSel.id = 'vr-rule-type';
  typeSel.dataset.e2eId = 'validation-editor-type';
  typeSel.setAttribute('aria-label', 'バリデーションルールタイプ');
  [
    { key: 'range_check', label: 'プロパティ間の比較' },
    { key: 'reference_exists', label: 'リレーション先の存在確認' },
    { key: 'cross_db_range', label: '他シートプロパティとの比較' },
    { key: 'required', label: '必須プロパティ' },
  ].forEach(opt => {
    const o = document.createElement('option');
    o.value = opt.key; o.textContent = opt.label;
    if (opt.key === rule.type) o.selected = true;
    typeSel.appendChild(o);
  });
  typeField.appendChild(typeSel);
  modal.appendChild(typeField);

  // 設定エリア
  const configDiv = document.createElement('div');
  configDiv.id = 'vr-config';
  modal.appendChild(configDiv);

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
      configDiv.innerHTML = _fieldSelect('プロパティ1', 'vr-prop1', props, rule.config.property) +
        _fieldSelect('比較演算子', 'vr-op', operators.map(o => o.key), rule.config.operator) +
        _fieldSelect('プロパティ2', 'vr-prop2', props, rule.config.compareProperty);
    } else if (type === 'reference_exists') {
      const relProps = props.filter(p => { const pt = getPropertyTypes(dbPath)?.[p]; return pt && (pt.type === 'relation' || pt.type === 'multi-relation'); });
      configDiv.innerHTML = _fieldSelect('リレーションプロパティ', 'vr-relprop', relProps, rule.config.relationProperty);
    } else if (type === 'cross_db_range') {
      configDiv.innerHTML = _fieldSelect('プロパティ', 'vr-prop1', props, rule.config.property) +
        _fieldSelect('演算子', 'vr-op', operators.map(o => o.key), rule.config.operator) +
        '<div class="field"><label>参照先シートパス</label><input id="vr-targetdb" type="text" value="' + esc(rule.config.targetDb || '') + '" placeholder="例: ストーリー/アーク"></div>' +
        '<div class="field"><label>参照先プロパティ</label><input id="vr-targetprop" type="text" value="' + esc(rule.config.targetProperty || '') + '"></div>' +
        _fieldSelect('マッチリレーション', 'vr-matchrel', props, rule.config.matchRelation);
    } else if (type === 'required') {
      configDiv.innerHTML = _fieldSelect('プロパティ', 'vr-prop1', props, rule.config.property) +
        '<div class="field"><label>対象ステータス（空=全て）</label><input id="vr-status" type="text" value="' + esc(rule.config.statusFilter || '') + '" placeholder="例: 採用"></div>';
    }
  }
  typeSel.addEventListener('change', renderConfig);
  renderConfig();

  // ボタン
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'margin-top:16px;display:flex;justify-content:flex-end;gap:8px;';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.dataset.e2eId = 'validation-editor-cancel';
  cancelBtn.addEventListener('click', () => { overlay.remove(); showValidationRulesModal(dbPath); });
  btnRow.appendChild(cancelBtn);
  const saveBtn = document.createElement('button');
  saveBtn.textContent = '保存';
  saveBtn.className = 'primary';
  saveBtn.dataset.e2eId = 'validation-editor-save';
  saveBtn.addEventListener('click', () => {
    rule.label = nameInput.value.trim() || rule.type;
    rule.type = typeSel.value;
    rule.config = _collectRuleConfig(rule.type);
    const rules = getValidationRules(dbPath);
    const idx = rules.findIndex(r => r.id === rule.id);
    if (idx >= 0) rules[idx] = rule; else rules.push(rule);
    setValidationRules(dbPath, rules);
    overlay.remove();
    showValidationRulesModal(dbPath);
    showStatus('ルールを保存しました');
  });
  btnRow.appendChild(saveBtn);
  modal.appendChild(btnRow);

  overlay.appendChild(modal);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
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
      targetDb: document.getElementById('vr-targetdb')?.value || '',
      targetProperty: document.getElementById('vr-targetprop')?.value || '',
      matchRelation: document.getElementById('vr-matchrel')?.value || '',
    };
  } else if (type === 'required') {
    return {
      property: document.getElementById('vr-prop1')?.value || '',
      statusFilter: document.getElementById('vr-status')?.value || '',
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
