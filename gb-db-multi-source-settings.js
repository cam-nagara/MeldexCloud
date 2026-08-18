/* マルチソースリレーション列のソース設定UI */

let _msrSourceIdSequence = 0;

function _msrCreateSourceId() {
  _msrSourceIdSequence += 1;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return 'msr-' + crypto.randomUUID();
  }
  return 'msr-' + Date.now().toString(36) + '-' + _msrSourceIdSequence.toString(36);
}

function _msrLegacySourceId(source, index) {
  const kind = source?.kind === 'relation' ? 'relation' : 'sheet';
  const seed = [kind, source?.db || '', source?.relationProp || '', source?.label || '', index].join('|');
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 'msr-legacy-' + (hash >>> 0).toString(36);
}

function _msrNormalizeSourcesForEditor(sources) {
  return (Array.isArray(sources) ? sources : []).map((src, index) => ({
    ...src,
    sourceId: src?.sourceId || _msrLegacySourceId(src, index),
    kind: src?.kind === 'relation' ? 'relation' : 'sheet',
  }));
}

function _msrSameDbPath(a, b) {
  const normalize = typeof _dbNormalizePath === 'function'
    ? _dbNormalizePath
    : value => String(value || '').replace(/\\/g, '/').replace(/^\.\/+|\/+$/g, '');
  return normalize(a || '') === normalize(b || '');
}

async function _loadMsrRelationPropCandidates(row, sourceDb, currentDbPath, selectedProp) {
  const select = row.querySelector('.msr-relation-prop');
  const warning = row.querySelector('.msr-relation-warning');
  if (!select || !warning) return;
  select.innerHTML = '';
  const addOption = (value, label) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  };
  addOption(selectedProp || '', sourceDb ? '読み込み中...' : (selectedProp || '先に対象シートを選択'));
  select.disabled = true;
  warning.textContent = '';
  if (!sourceDb) {
    if (selectedProp) warning.textContent = '対象シートが未設定です。現在の参照列は変更していません。';
    return;
  }

  try {
    const metadata = await apiFetch('/db-metadata?path=' + encodeURIComponent(sourceDb));
    if (!row.isConnected || row.querySelector('.msr-db-input')?.value?.trim() !== sourceDb) return;
    const propertyTypes = metadata?.property_types || metadata?.propertyTypes || {};
    const candidates = Object.entries(propertyTypes)
      .filter(([, cfg]) => cfg && (cfg.type === 'relation' || cfg.type === 'multi-relation'))
      .filter(([, cfg]) => {
        const resolved = typeof _dbResolveRelationDbPath === 'function'
          ? _dbResolveRelationDbPath(sourceDb, cfg)
          : (cfg.relationDb || '');
        return _msrSameDbPath(resolved, currentDbPath);
      })
      .map(([name]) => name);
    select.innerHTML = '';
    addOption('', '参照列を選択');
    candidates.forEach(name => addOption(name, name));
    if (selectedProp && !candidates.includes(selectedProp)) {
      addOption(selectedProp, selectedProp + '（現在の設定・無効）');
      warning.textContent = '現在の参照列は、このシートを参照していません。設定を確認してください。';
    }
    select.value = selectedProp || '';
    select.disabled = false;
    if (!candidates.length && !selectedProp) {
      warning.textContent = '現在のシートを参照する列がありません。';
    }
  } catch (error) {
    select.innerHTML = '';
    addOption(selectedProp || '', selectedProp || '参照列を読み込めませんでした');
    select.value = selectedProp || '';
    warning.textContent = '参照列を読み込めませんでした。現在の設定は変更していません。';
  }
}

function _msrSourceKindRow(source) {
  const row = document.createElement('div');
  row.className = 'msr-field-row';
  const label = document.createElement('span');
  label.textContent = 'ソース種別:';
  const select = document.createElement('select');
  select.className = 'msr-kind-select';
  [['sheet', 'シート'], ['relation', 'リレーション参照元']].forEach(([value, text]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    option.selected = source.kind === value;
    select.appendChild(option);
  });
  row.append(label, select);
  return { row, select };
}

function _msrSourceDbRow(source, scope) {
  const row = document.createElement('div');
  row.className = 'msr-field-row';
  row.innerHTML = '<span>シート:</span>';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'msr-db-input';
  input.value = source.db || '';
  input.placeholder = '例: 開発/デバッグリスト';
  row.appendChild(input);
  _attachDbPicker(input, _ptState(scope)?.dbPath);
  return { row, input };
}

function _msrAppendRelationPropEditor(host, source, dbInput, stateInfo) {
  const row = document.createElement('div');
  row.className = 'msr-field-row';
  const label = document.createElement('span');
  label.textContent = '参照列:';
  const select = document.createElement('select');
  select.className = 'msr-relation-prop';
  const warning = document.createElement('div');
  warning.className = 'msr-relation-warning pt-hint';
  row.append(label, select);
  host.append(row, warning);

  const currentDbPath = stateInfo.dbPath || state.currentDbPath || '';
  _loadMsrRelationPropCandidates(host, source.db || '', currentDbPath, source.relationProp || '');
  let loadTimer = null;
  const reloadCandidates = () => {
    clearTimeout(loadTimer);
    loadTimer = setTimeout(() => {
      _loadMsrRelationPropCandidates(
        host,
        dbInput.value.trim(),
        currentDbPath,
        select.value || source.relationProp || ''
      );
    }, 150);
  };
  dbInput.addEventListener('input', reloadCandidates);
  dbInput.addEventListener('change', reloadCandidates);
}

function _msrAppendLabelEditor(host, source) {
  const row = document.createElement('div');
  row.className = 'msr-field-row';
  row.innerHTML = '<span>ラベル:</span>';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'msr-label-input';
  input.value = source.label || '';
  input.placeholder = '(シート名から自動生成)';
  row.appendChild(input);
  host.appendChild(row);
}

function _msrRuleRow(rule, sourceIndex, ruleIndex, mode, scope) {
  const row = document.createElement('div');
  row.className = 'msr-rule-row';
  const stateInfo = _ptState(scope);
  const rawProps = stateInfo.pivotData?.properties || [];
  const props = typeof filterDeletedDbProperties === 'function'
    ? filterDeletedDbProperties(stateInfo.dbPath || state.currentDbPath || '', rawProps)
    : rawProps;
  const mySelect = document.createElement('select');
  mySelect.className = 'msr-my-prop';
  props.forEach(prop => {
    const option = document.createElement('option');
    option.value = prop;
    option.textContent = prop;
    option.selected = prop === rule.myProp;
    mySelect.appendChild(option);
  });
  row.appendChild(mySelect);
  row.appendChild(document.createTextNode(' = 参照先の '));
  const remoteInput = document.createElement('input');
  remoteInput.type = 'text';
  remoteInput.className = 'msr-remote-prop';
  remoteInput.value = rule.remoteProp || '';
  remoteInput.placeholder = '列名';
  row.appendChild(remoteInput);
  const remove = document.createElement('button');
  remove.innerHTML = lucide('x', 12);
  remove.className = 'pt-small-btn';
  remove.addEventListener('click', () => {
    const sources = _collectMsrSources(scope);
    sources[sourceIndex].matchRules.splice(ruleIndex, 1);
    _renderMsrSources(sources, mode, scope);
  });
  row.appendChild(remove);
  return row;
}

function _msrAppendRulesEditor(host, source, sourceIndex, mode, scope) {
  if (mode !== 'auto' || source.kind === 'relation') return;
  const rules = document.createElement('div');
  rules.className = 'msr-rules';
  const label = document.createElement('div');
  label.className = 'msr-rules-label';
  label.textContent = 'マッチ条件:';
  rules.appendChild(label);
  (source.matchRules || []).forEach((rule, ruleIndex) => {
    rules.appendChild(_msrRuleRow(rule, sourceIndex, ruleIndex, mode, scope));
  });
  const add = document.createElement('button');
  add.textContent = '+ 条件を追加';
  add.className = 'pt-small-btn';
  add.addEventListener('click', () => {
    const sources = _collectMsrSources(scope);
    if (!sources[sourceIndex].matchRules) sources[sourceIndex].matchRules = [];
    sources[sourceIndex].matchRules.push({ myProp: '', remoteProp: '' });
    _renderMsrSources(sources, mode, scope);
  });
  rules.appendChild(add);
  host.appendChild(rules);
}

function _msrAppendSourceActions(host, sourceIndex, mode, scope, kindSelect) {
  const remove = document.createElement('button');
  remove.innerHTML = lucide('x', 12) + ' ソース削除';
  remove.className = 'pt-small-btn muted';
  remove.addEventListener('click', () => {
    const sources = _collectMsrSources(scope);
    sources.splice(sourceIndex, 1);
    _renderMsrSources(sources, mode, scope);
  });
  host.appendChild(remove);
  kindSelect.addEventListener('change', () => {
    const sources = _collectMsrSources(scope);
    sources[sourceIndex].kind = kindSelect.value;
    if (kindSelect.value === 'relation') delete sources[sourceIndex].matchRules;
    else delete sources[sourceIndex].relationProp;
    _renderMsrSources(sources, mode, scope);
  });
}

// マルチソースリレーション設定UI描画
function _renderMsrSources(sources, mode, root) {
  const scope = _ptResolveRoot(root);
  const container = _ptGet('pt-msr-sources', scope);
  if (!container) return;
  container.innerHTML = '';
  const stateInfo = _ptState(scope);

  _msrNormalizeSourcesForEditor(sources).forEach((source, index) => {
    const host = document.createElement('div');
    host.className = 'msr-source-row';
    host.dataset.sourceId = source.sourceId;
    const kind = _msrSourceKindRow(source);
    host.appendChild(kind.row);
    const db = _msrSourceDbRow(source, scope);
    host.appendChild(db.row);
    if (source.kind === 'relation') _msrAppendRelationPropEditor(host, source, db.input, stateInfo);
    _msrAppendLabelEditor(host, source);
    _msrAppendRulesEditor(host, source, index, mode, scope);
    _msrAppendSourceActions(host, index, mode, scope, kind.select);
    container.appendChild(host);
  });
}

// マルチソースリレーション設定をUIから収集
function _collectMsrSources(root) {
  const container = _ptGet('pt-msr-sources', root);
  if (!container) return [];
  const sources = [];
  container.querySelectorAll('.msr-source-row').forEach(row => {
    const kind = row.querySelector('.msr-kind-select')?.value === 'relation' ? 'relation' : 'sheet';
    const source = {
      sourceId: row.dataset.sourceId || _msrCreateSourceId(),
      kind,
      db: row.querySelector('.msr-db-input')?.value?.trim() || '',
      label: row.querySelector('.msr-label-input')?.value?.trim() || '',
    };
    if (kind === 'relation') {
      source.relationProp = row.querySelector('.msr-relation-prop')?.value || '';
      sources.push(source);
      return;
    }
    const matchRules = [];
    row.querySelectorAll('.msr-rules > div:not(:last-child)').forEach(ruleRow => {
      if (!ruleRow.querySelector('.msr-my-prop')) return;
      matchRules.push({
        myProp: ruleRow.querySelector('.msr-my-prop')?.value || '',
        remoteProp: ruleRow.querySelector('.msr-remote-prop')?.value || '',
      });
    });
    if (matchRules.length) source.matchRules = matchRules;
    sources.push(source);
  });
  return sources;
}
