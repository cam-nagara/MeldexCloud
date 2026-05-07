  search.oninput = () => renderList(search.value);
  dd.appendChild(listDiv);

  // 確定ボタン
  const doneBtn = document.createElement('div');
  doneBtn.style.cssText = 'padding:4px 8px;text-align:center;cursor:pointer;font-size:12px;font-weight:bold;color:var(--accent);border-top:1px solid var(--border);margin-top:4px;';
  doneBtn.innerHTML = lucide('check', 12) + ' 確定';
  doneBtn.addEventListener('click', () => { dd.remove(); if (state.currentDbPath) selectDatabase(state.currentDbPath); });
  dd.appendChild(doneBtn);

  const rect = anchor.getBoundingClientRect();
  const _zr = _getZoom();
  dd.style.position = 'fixed'; dd.style.left = (rect.left / _zr) + 'px'; dd.style.top = (rect.bottom / _zr + 2) + 'px';
  document.body.appendChild(dd);
  clampPopupToViewport(dd);
  _enableDropdownKeyNav(dd, '.dd-nav-item');
  search.focus();

  setTimeout(() => {
    const closer = (e) => {
      if (!dd.contains(e.target)) { dd.remove(); document.removeEventListener('pointerdown', closer); if (state.currentDbPath) selectDatabase(state.currentDbPath); }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

// マルチソースリレーション自動収集
async function _autoCollectMultiSourceRelation(entityName, entityData, ptc, dbPath) {
  const results = [];
  const pts = getPropertyTypes(dbPath);

  for (const src of (ptc.sources || [])) {
    if (!src.db) continue;
    try {
      const map = await _getRelationMap(src.db);
      if (!_msrPivotCache[src.db]) {
        _msrPivotCache[src.db] = await apiFetch('/pivot?path=' + encodeURIComponent(src.db));
      }
      const pivotData = _msrPivotCache[src.db];
      const remoteEntities = pivotData.entities || {};

      for (const [remoteName, remoteData] of Object.entries(remoteEntities)) {
        const remoteId = remoteData._id || remoteName;
        let allMatch = true;

        for (const rule of (src.matchRules || [])) {
          if (!rule.myProp || !rule.remoteProp) { allMatch = false; break; }

          // 自DBの値
          const myVals = entityData[rule.myProp] || [];
          const myAdopted = myVals.find(v => v.status === '採用' || v.status === '掲載済み') || myVals[0];
          let myVal = myAdopted?.value || '';

          // 参照先DBの値
          const remoteVals = remoteData[rule.remoteProp] || [];
          const remoteAdopted = remoteVals.find(v => v.status === '採用' || v.status === '掲載済み') || remoteVals[0];
          let remoteVal = remoteAdopted?.value || '';

          if (!myVal || !remoteVal) { allMatch = false; break; }

          // 日付型 or 日付形式の値は日付部分のみで比較
          const myPtc = pts[rule.myProp];
          const isDateLike = (s) => /^\d{4}[-/]\d{2}[-/]\d{2}/.test(s);
          if ((myPtc && myPtc.type === 'date') || (isDateLike(myVal) && isDateLike(remoteVal))) {
            myVal = myVal.substring(0, 10);
            remoteVal = remoteVal.substring(0, 10);
          }

          if (myVal !== remoteVal) { allMatch = false; break; }
        }

        if (allMatch && (src.matchRules || []).length > 0) {
          results.push({ db: src.db, id: remoteId, name: remoteName, label: src.label || src.db.split('/').pop() });
        }
      }
    } catch (e) { console.warn('MSR自動収集エラー:', src.db, e); }
  }
  return results;
}

// MSR自動収集用のpivotキャッシュ（_autoCollectAllMsrProps実行中のみ有効）
let _msrPivotCache = {};

// 全マルチソースリレーションプロパティの自動収集
async function _autoCollectAllMsrProps(dbPath, ctx) {
  _msrPivotCache = {}; // 実行開始時にクリア
  const pts = getPropertyTypes(dbPath);
  const data = ctx.pivotData || state.pivotData;
  if (!pts || !data?.entities) return;

  const msrProps = Object.entries(pts).filter(([_, cfg]) =>
    cfg.type === 'multi-source-relation' && cfg.mode === 'auto'
  );
  if (msrProps.length === 0) return;

  for (const entityName of Object.keys(data.entities)) {
    const entityData = data.entities[entityName];
    for (const [propName, ptc] of msrProps) {
      try {
        const collected = await _autoCollectMultiSourceRelation(entityName, entityData, ptc, dbPath);
        const newValue = collected.map(r => r.db + '::' + r.id).join(', ');

        const vals = entityData[propName] || [];
        const currentValue = vals.length > 0 ? vals[0].value : '';
        if (newValue === currentValue) continue;

        const entityPath = _entityPath(dbPath, entityName);
        if (vals.length > 0) {
          await _apiPutValue(vals[0], { new_value: newValue });
        } else if (newValue) {
          await _apiPostValue(entityPath, propName, newValue, '採用', '');
        }
      } catch (e) { console.warn('MSR自動収集エラー:', entityName, propName, e); }
    }
  }
  _msrPivotCache = {}; // 実行完了時にクリア
}

// チャットプロパティ: エントリに紐づくチャットを作成
async function _createEntityChat(entityPath, val, propName) {
  // セッションID生成
  const now = new Date();
  const pad = (n, d=2) => String(n).padStart(d, '0');
  const sessionId = now.getFullYear() + pad(now.getMonth()+1) + pad(now.getDate()) + '_' +
    pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()) + '_' +
    Math.random().toString(36).slice(2, 6);
  if (typeof _initChatSourceFolderSelector === 'function') await _initChatSourceFolderSelector();
  const sourceFolder = typeof _detectSourceFolderFromPath === 'function' ? _detectSourceFolderFromPath(entityPath) : '';
  const chatPath = typeof _chatSavedPathForSession === 'function' ? _chatSavedPathForSession(sessionId) : ('_chat/llm/' + sessionId + '.md');

  // 空のチャットファイルを保存
  const entityName = entityPath.replace(/\.md$/, '').split('/').pop();
  try {
    const message = { role: 'system', content: 'エントリ「' + entityName + '」のチャット' };
    if (typeof _ensureChatMessageId === 'function') _ensureChatMessageId(message);
    await apiPost('/chat/save', {
      path: chatPath,
      source_folder: sourceFolder,
      provider: localStorage.getItem('chat-provider') || 'gemini',
      model: localStorage.getItem('chat-model') || '',
      messages: [message],
      targetPath: entityPath,
      user: typeof getUsername === 'function' ? getUsername() : '',
    });
  } catch (e) { showStatus('チャット作成に失敗', true); return; }

  // プロパティ値にチャットパスを追加
  const currentPaths = (val?.value || '').split(',').map(s => s.trim()).filter(Boolean);
  currentPaths.push(chatPath);
  const newValue = currentPaths.join(', ');
  try {
    if (val?.file) {
      await _apiPutValue(val, { new_value: newValue });
      val.value = newValue;
    } else {
      await _apiPostValue(entityPath, propName, newValue, '採用', '');
    }
  } catch (e) {
    showStatus('チャットは作成されましたが、エントリへの紐付け保存に失敗: ' + (e?.message || e), true);
    _openEntityChat(chatPath, sourceFolder);
    if (state.currentDbPath) selectDatabase(state.currentDbPath);
    return;
  }

  showStatus('チャットを作成しました');
  // チャットを開く
  _openEntityChat(chatPath, sourceFolder);
  // DB再描画
  if (state.currentDbPath) selectDatabase(state.currentDbPath);
}

// チャットプロパティ: 保存済みチャットを開く
function _openEntityChat(chatPath, sourceFolder) {
  // 右パネルを開く（閉じていれば）
  const rp = document.getElementById('right-panel');
  if (rp && rp.classList.contains('collapsed')) {
    const toggle = document.getElementById('btn-right-panel');
    if (toggle) toggle.click();
  }
  // openSavedChat が右パネルのチャットタブを開いてロードする
  if (typeof openSavedChat === 'function') {
    openSavedChat(chatPath, '', sourceFolder);
  }
}

// エントリ単位のチャット起動フック
// 汎用: エントリパスから既存または新規のチャットを開始する
// - 右パネルを開き、openFileChat で targetPath 紐付きチャットを復元または作成
window.openEntityChatForPath = async function openEntityChatForPath(entityPath) {
  if (!entityPath) return;
  const rp = document.getElementById('right-panel');
  if (rp && rp.classList.contains('collapsed')) {
    const toggle = document.getElementById('btn-right-panel');
    if (toggle) toggle.click();
  }
  if (typeof openFileChat === 'function') {
    await openFileChat(entityPath);
  }
};
window.openEntityAiChat = window.openEntityChatForPath;

// ユーザープロパティ: 小型アバター
function _userAvatarSmall(username) {
  // team avatar → auth avatar → フォールバック（頭文字）の順で試す
  return '<img src="/api/team/avatar/' + encodeURIComponent(username) + '" '
    + 'style="width:16px;height:16px;border-radius:50%;object-fit:cover;vertical-align:middle;" '
    + 'onerror="this.onerror=null;this.src=\'/api/auth/avatar/' + encodeURIComponent(username) + '\';this.addEventListener(\'error\',()=>{this.style.display=\'none\';this.nextElementSibling.style.display=\'inline-flex\';},{once:true});">'
    + '<span style="display:none;width:16px;height:16px;border-radius:50%;background:var(--accent);color:var(--ui-fg-strong);font-size:9px;font-weight:bold;align-items:center;justify-content:center;vertical-align:middle;">'
    + esc((username || '?')[0].toUpperCase()) + '</span>';
}

// ユーザー選択ドロップダウン
async function _showUserDropdown(anchor, val, entityPath, propName, currentValue, isMulti) {
  document.querySelectorAll('.user-dropdown').forEach(el => el.remove());

  // チームメンバー（優先）+ 旧auth users（後方互換）をマージ
  let users = [];
  const seen = new Set();
  try {
    const team = await apiFetch('/team');
    if (Array.isArray(team)) {
      team.forEach(m => { if (m.name && !seen.has(m.name)) { seen.add(m.name); users.push({ name: m.name, role: m.role || 'editor', has_avatar: !!m.has_avatar }); } });
    }
  } catch {}
  try {
    const authUsers = await apiFetch('/auth/users');
    if (Array.isArray(authUsers)) {
      authUsers.forEach(u => { if (u.name && !seen.has(u.name)) { seen.add(u.name); users.push(u); } });
    }
  } catch {}

  const dd = document.createElement('div');
  dd.className = 'cell-inline-dd user-dropdown';
  dd.style.cssText = 'position:fixed;z-index:9999;min-width:180px;max-height:300px;overflow-y:auto;background:var(--ui-popup-bg, var(--bg2));border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.3);padding:4px;';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'ユーザーを検索...';
  searchInput.style.cssText = 'width:100%;padding:4px 8px;font-size:12px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;margin-bottom:4px;box-sizing:border-box;';
  dd.appendChild(searchInput);

  const selected = new Set(
    isMulti && currentValue ? currentValue.split(',').map(s => s.trim()).filter(Boolean) : []
  );
  if (!isMulti && currentValue) selected.add(currentValue.trim());

  function renderList(filter) {
    dd.querySelectorAll('.user-option,.user-confirm-btn,.user-clear-btn,.user-empty-msg').forEach(el => el.remove());

    if (users.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'user-empty-msg';
      msg.style.cssText = 'padding:8px;color:var(--fg2);font-size:12px;text-align:center;';
      msg.textContent = 'ユーザーが登録されていません。設定 → チームメンバーから追加してください';
      dd.appendChild(msg);
      return;
    }

    const filtered = filter
      ? users.filter(u => u.name.toLowerCase().includes(filter.toLowerCase()))
      : users;

    filtered.forEach(u => {
      const item = document.createElement('div');
      item.className = 'user-option';
      const isSelected = selected.has(u.name);
      item.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 8px;cursor:pointer;border-radius:3px;font-size:12px;'
        + (isSelected ? 'background:var(--accent);color:var(--ui-fg-strong);' : '');
      item.innerHTML = (isMulti ? '<span style="font-size:11px;">' + (isSelected ? '\u2713' : '\u3000') + '</span> ' : '')
        + _userAvatarSmall(u.name) + ' ' + esc(u.name)
        + '<span style="margin-left:auto;font-size:10px;color:' + (isSelected ? 'color-mix(in srgb, var(--ui-fg-strong) 70%, transparent)' : 'var(--fg2)') + ';">' + esc(u.role || '') + '</span>';
      item.addEventListener('mouseover', () => { if (!isSelected) item.style.background = 'var(--bg3)'; });
      item.addEventListener('mouseout', () => { if (!isSelected) item.style.background = ''; });
      item.addEventListener('click', () => {
        if (isMulti) {
          if (selected.has(u.name)) selected.delete(u.name);
          else selected.add(u.name);
          renderList(searchInput.value);
        } else {
          _saveUserValue(val, entityPath, propName, u.name, anchor);
          dd.remove();
        }
      });
      dd.appendChild(item);
    });

    if (isMulti) {
      const confirmBtn = document.createElement('div');
      confirmBtn.className = 'user-confirm-btn';
      confirmBtn.style.cssText = 'padding:4px 8px;margin-top:4px;text-align:center;cursor:pointer;font-size:12px;color:var(--accent);border-top:1px solid var(--border);font-weight:bold;';
      confirmBtn.textContent = '\u2713 確定';
      confirmBtn.addEventListener('click', () => {
        _saveUserValue(val, entityPath, propName, [...selected].join(', '), anchor);
        dd.remove();
      });
      dd.appendChild(confirmBtn);
    }

    if (!isMulti && currentValue) {
      const clearBtn = document.createElement('div');
      clearBtn.className = 'user-clear-btn';
      clearBtn.style.cssText = 'padding:4px 8px;text-align:center;cursor:pointer;font-size:11px;color:var(--fg2);border-top:1px solid var(--border);margin-top:4px;';
      clearBtn.textContent = '選択を解除';
      clearBtn.addEventListener('click', () => {
        _saveUserValue(val, entityPath, propName, '', anchor);
        dd.remove();
      });
      dd.appendChild(clearBtn);
    }
  }

  searchInput.addEventListener('input', () => renderList(searchInput.value));
  renderList('');

  const rect = anchor.getBoundingClientRect();
  const _zu = _getZoom();
  dd.style.left = (rect.left / _zu) + 'px';
  dd.style.top = (rect.bottom / _zu + 2) + 'px';
  document.body.appendChild(dd);
  clampPopupToViewport(dd);
  _enableDropdownKeyNav(dd, '.user-option');
  searchInput.focus();

  setTimeout(() => {
    document.addEventListener('pointerdown', function closer(ev) {
      if (!dd.contains(ev.target)) {
        if (isMulti) {
          _saveUserValue(val, entityPath, propName, [...selected].join(', '), anchor);
        }
        dd.remove();
        document.removeEventListener('pointerdown', closer);
      }
    });
  }, 0);
}

async function _saveUserValue(val, entityPath, propName, newValue, anchorEl) {
  if (newValue === (val?.value || '')) return;
  try {
    if (val) {
      await _apiPutValue(val, { new_value: newValue });
      val.value = newValue;
    } else {
      await _apiPostValue(entityPath, propName, newValue, '採用', '');
    }
    // Step 3: 部分更新化 (user/multi-user)
    // val が null (新規追加) の場合は新しいエントリ行が必要なのでフルリロード
    if (!val) {
      if (state.currentDbPath) await selectDatabase(state.currentDbPath, undefined, { silent: true });
    } else {
      _refreshAfterCellEdit(anchorEl, entityPath, propName);
    }
  } catch {}
}

// ペアリレーション自動反映
// sourceId を targetEntity の pairProp に追加/除去する
async function _syncPairRelation(dbPath, targetId, pairPropName, sourceId, adding) {
  const map = await _getRelationMap(dbPath);
  const targetName = map.idToName[targetId] || targetId;
  const targetPath = _entityPath(dbPath, targetName);
  try {
    const targetData = await apiFetch('/pivot?path=' + encodeURIComponent(dbPath));
    const entData = targetData.entities?.[targetName];
    if (!entData) return;
    const pairVals = entData[pairPropName] || [];
    const pairVal = pairVals[0];
    if (!pairVal) {
      // ペアプロパティに値がまだない場合は新規作成
      if (adding) {
        await _apiPostValue(targetPath, pairPropName, sourceId, '採用', '');
      }
      return;
    }
    const currentIds = (pairVal.value || '').split(',').map(s => s.trim()).filter(Boolean);
    if (adding) {
      if (!currentIds.includes(sourceId)) currentIds.push(sourceId);
    } else {
      const idx = currentIds.indexOf(sourceId);
      if (idx >= 0) currentIds.splice(idx, 1);
    }
    await _apiPutValue(pairVal, { new_value: currentIds.join(', ') });
  } catch (e) { console.warn('ペアリレーション同期に失敗:', e); }
}

// 循環参照チェック（A→B→C→Aを検出）
async function _checkCircularDependency(dbPath, sourceId, targetId, propName) {
  const visited = new Set([sourceId]);
  const queue = [targetId];
  try {
    const data = await apiFetch('/pivot?path=' + encodeURIComponent(dbPath));
    const map = await _getRelationMap(dbPath);
    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) return true; // 循環検出
      visited.add(current);
      const name = map.idToName[current] || current;
      const entData = data.entities?.[name];
      if (!entData) continue;
      const vals = entData[propName] || [];
      const v = vals[0]?.value || '';
      v.split(',').map(s => s.trim()).filter(Boolean).forEach(id => {
        if (!visited.has(id)) queue.push(id);
      });
    }
  } catch {}
  return false;
}

// リレーションドロップダウン（参照先DBのエントリ一覧）
async function _showRelationDropdown(el, val, entityPath, propName, ptc, isMulti) {
  closeAllDropdowns();
  const isSelfRef = (ptc.relationDb === '' && ptc.relationDb !== undefined);
  const relDb = isSelfRef ? state.currentDbPath : (ptc.relationDb || '');
  if (!relDb) { showStatus('参照先シートが設定されていません。プロパティ型設定で指定してください。', true); return; }

  // 参照先DBのエントリ一覧（ID付き）を取得
  let entryList = []; // { name, id }
  let refEntities = {};
  try {
    const map = await _getRelationMap(relDb);
    refEntities = map.entities || {};
    entryList = Object.entries(map.idToName).map(([id, name]) => ({ name, id }));
  } catch { showStatus('参照先シートの読み込みに失敗: ' + relDb, true); return; }

  // カスケード絞り込み
  if (ptc.cascadeFrom) {
    const parentValue = _getCurrentEntityValue(entityPath, ptc.cascadeFrom);
    if (parentValue) {
      entryList = entryList.filter(entry => {
        const entData = refEntities[entry.name];
        if (!entData) return false;
        const cascadeVals = entData[ptc.cascadeKey] || [];
        return cascadeVals.some(v => {
          const val = v.value || '';
          return val.split(',').map(s => s.trim()).includes(parentValue);
        });
      });
    }
  }
  // 自己参照時: 自分自身を除外
  if (isSelfRef && entityPath) {
    const selfName = entityPath.replace(/\.md$/, '').split('/').pop();
    const selfMap = _relationCache[relDb];
    const selfId = selfMap ? (selfMap.nameToId[selfName] || selfName) : selfName;
    entryList = entryList.filter(e => e.id !== selfId && e.name !== selfName);
  }
  entryList.sort((a, b) => a.name.localeCompare(b.name));

  const dd = document.createElement('div');
  dd.className = 'status-dropdown';
  dd.style.cssText = 'max-height:300px;overflow-y:auto;min-width:200px;';

  // 検索ボックス
  const search = document.createElement('input');
  search.type = 'text'; search.placeholder = 'エントリを検索...';
  search.style.cssText = 'width:100%;padding:4px 6px;margin-bottom:4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;font-size:12px;';
  dd.appendChild(search);

  const currentVals = isMulti ? ((val?.value) || '').split(',').map(s => s.trim()).filter(Boolean) : [(val?.value) || ''];
  let didChange = false;

  const listDiv = document.createElement('div');
  const renderList = (filter) => {
    listDiv.innerHTML = '';
    const filtered = filter ? entryList.filter(e => e.name.toLowerCase().includes(filter.toLowerCase())) : entryList;
    filtered.forEach(entry => {
      const isSelected = currentVals.includes(entry.id) || currentVals.includes(entry.name);
      const item = document.createElement('div');
      item.className = 'dd-nav-item';
      item.style.cssText = 'padding:4px 8px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px;';
      if (isSelected) item.style.background = 'rgba(86,156,214,0.15)';
      item.onmouseenter = () => { item.style.background = 'var(--bg4)'; };
      item.onmouseleave = () => { item.style.background = isSelected ? 'rgba(86,156,214,0.15)' : ''; };
      if (isMulti) {
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = isSelected;
        item.appendChild(cb);
      }
      item.appendChild(document.createTextNode(entry.name));
      item.addEventListener('click', async () => {
        const oldVal = val.value || '';
        const hasPair = ptc.pairWith && isSelfRef;
        const bidirectionalCtx = ptc.bidirectional ? { entityPath, propName, ptc } : null;
        let selfId = '';
        if (hasPair) {
          const selfName = entityPath.replace(/\.md$/, '').split('/').pop();
          const selfMap = _relationCache[relDb];
          selfId = selfMap ? (selfMap.nameToId[selfName] || selfName) : selfName;
        }
        if (isMulti) {
          const idx = currentVals.findIndex(v => v === entry.id || v === entry.name);
          const adding = idx < 0;
          const nextVals = [...currentVals];
          if (idx >= 0) nextVals.splice(idx, 1); else nextVals.push(entry.id);
          const nv = nextVals.join(', ');
          let cascadeClears = [];
          try {
            cascadeClears = await _clearCascadeDependentValues(entityPath, propName, oldVal, nv);
          } catch (e) {
            showStatus('カスケード依存値の更新に失敗: ' + (e?.message || e), true);
            return;
          }
          try {
            await _apiPutValue(val, { new_value: nv });
          } catch (e) {
            await _restoreCascadeDependentValues(entityPath, cascadeClears);
            showStatus('リレーション値の保存に失敗: ' + (e?.message || e), true);
            if (state.currentDbPath) selectDatabase(state.currentDbPath, undefined, { silent: true });
            return;
          }
          currentVals.splice(0, currentVals.length, ...nextVals);
          _upsertLocalPivotValue(entityPath, propName, val, nv);
          didChange = true;
          if (hasPair) {
            _relationCache[relDb] = null;
            await _syncPairRelation(relDb, entry.id, ptc.pairWith, selfId, adding);
            if (adding) {
              const circular = await _checkCircularDependency(relDb, selfId, entry.id, propName);
              if (circular) showStatus('⚠ 循環依存が検出されました', true);
            }
          }
          if (bidirectionalCtx && typeof _applyBidirectionalRelationSync === 'function') {
            try {
              await _applyBidirectionalRelationSync({
                sourceDbPath: state.currentDbPath,
                entityPath,
                propName,
                ptc,
                oldValue: oldVal,
                newValue: nv,
              });
            } catch (e) {
              showStatus('双方向リレーションの同期に失敗: ' + (e?.message || e), true);
            }
          }
          // Undo: ペア込みで両方戻す
          _dbUndoPairValue(propName, val, oldVal, nv, hasPair ? relDb : null, hasPair ? entry.id : null, hasPair ? ptc.pairWith : null, selfId, !hasPair ? false : (idx < 0), null, entityPath, cascadeClears, bidirectionalCtx);
          renderList(search.value);
        } else {
          if (oldVal === entry.id || oldVal === entry.name) { closeDropdown(); return; }
          let cascadeClears = [];
          try {
            cascadeClears = await _clearCascadeDependentValues(entityPath, propName, oldVal, entry.id);
          } catch (e) {
            showStatus('カスケード依存値の更新に失敗: ' + (e?.message || e), true);
            return;
          }
          try {
            await _apiPutValue(val, { new_value: entry.id });
          } catch (e) {
            await _restoreCascadeDependentValues(entityPath, cascadeClears);
            showStatus('リレーション値の保存に失敗: ' + (e?.message || e), true);
            if (state.currentDbPath) selectDatabase(state.currentDbPath, undefined, { silent: true });
            return;
          }
          _upsertLocalPivotValue(entityPath, propName, val, entry.id);
          didChange = true;
          if (hasPair) {
            _relationCache[relDb] = null;
            if (oldVal) await _syncPairRelation(relDb, oldVal, ptc.pairWith, selfId, false);
            await _syncPairRelation(relDb, entry.id, ptc.pairWith, selfId, true);
          }
          if (bidirectionalCtx && typeof _applyBidirectionalRelationSync === 'function') {
            try {
              await _applyBidirectionalRelationSync({
                sourceDbPath: state.currentDbPath,
                entityPath,
                propName,
                ptc,
                oldValue: oldVal,
                newValue: entry.id,
              });
            } catch (e) {
              showStatus('双方向リレーションの同期に失敗: ' + (e?.message || e), true);
            }
          }
          _dbUndoPairValue(propName, val, oldVal, entry.id, hasPair ? relDb : null, hasPair ? entry.id : null, hasPair ? ptc.pairWith : null, selfId, true, hasPair ? oldVal : null, entityPath, cascadeClears, bidirectionalCtx);
          closeDropdown();
          await _finalizeRelationCellUpdate(el, entityPath, propName, ptc, cascadeClears.map(c => c.propName));
        }
      });
      listDiv.appendChild(item);
    });
  };
  renderList('');
  search.oninput = () => renderList(search.value);
  dd.appendChild(listDiv);

  // 複数選択の確定ボタン
  if (isMulti) {
    const doneBtn = document.createElement('div');
    doneBtn.style.cssText = 'padding:4px 8px;text-align:center;cursor:pointer;font-size:12px;font-weight:bold;color:var(--accent);border-top:1px solid var(--border);margin-top:4px;';
    doneBtn.innerHTML = lucide('check', 12) + ' 確定';
    doneBtn.addEventListener('click', async () => {
      closeDropdown();
      if (didChange) {
        const cascadeProps = _getCascadeDependents(propName).map(dep => dep.propName);
        await _finalizeRelationCellUpdate(el, entityPath, propName, ptc, cascadeProps);
      }
    });
    dd.appendChild(doneBtn);
  }

  let closer = null;
  const closeDropdown = () => {
    if (dd.parentNode) dd.remove();
    if (closer) {
      document.removeEventListener('pointerdown', closer);
      closer = null;
    }
  };
  const rect = el.getBoundingClientRect();
  const _zr = _getZoom();
  dd.style.position = 'fixed'; dd.style.left = (rect.left / _zr) + 'px'; dd.style.top = (rect.bottom / _zr + 2) + 'px';
  document.body.appendChild(dd);
  clampPopupToViewport(dd);
  _enableDropdownKeyNav(dd, '.dd-nav-item');
  search.focus();

  setTimeout(() => {
    closer = async (e) => {
      if (!dd.contains(e.target)) {
        closeDropdown();
        if (isMulti && didChange) {
          const cascadeProps = _getCascadeDependents(propName).map(dep => dep.propName);
          await _finalizeRelationCellUpdate(el, entityPath, propName, ptc, cascadeProps);
        }
      }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

// Select型ドロップダウン
function showSelectDropdown(el, val, entityPath, propName, options) {
  const lockMsg = checkColumnEditable(state.currentDbPath, propName);
  if (lockMsg) { showStatus(lockMsg); return; }
  closeAllDropdowns();
  const dd = document.createElement('div');
  dd.className = 'status-dropdown';

  // 解除（値をクリア）
  const clearItem = document.createElement('div');
  clearItem.className = 'status-dropdown-item';
  clearItem.style.cssText = 'color:var(--fg2);font-style:italic;';
  clearItem.textContent = '解除';
  clearItem.addEventListener('click', async () => {
    closeAllDropdowns();
    if (val.value) {
      const oldVal = val.value;
      try {
        await _apiPutValue(val, { _delete: true });
        _dbUndoValue(propName + ': ' + oldVal + ' → (解除)', val, oldVal, '');
        // Step 3: 部分更新化 (select 解除) — 削除済み val をローカル pivotData から除去
        _removeLocalPivotValue(val, entityPath, propName);
        _refreshAfterCellEdit(el, entityPath, propName);
      } catch (e) {}
    }
  });
  dd.appendChild(clearItem);

  options.forEach(opt => {
    const item = document.createElement('div');
    item.className = 'status-dropdown-item';
    item.textContent = opt;
    if (val.value === opt) item.classList.add('selected');
    item.addEventListener('click', async () => {
      closeAllDropdowns();
      if (opt !== val.value) {
        const oldVal = val.value || '';
        try {
          await _apiPutValue(val, { new_value: opt });
          _dbUndoValue(propName + ': ' + oldVal + ' → ' + opt, val, oldVal, opt);
          val.value = opt;
          // Step 3: 部分更新化 (select 値変更)
          _refreshAfterCellEdit(el, entityPath, propName);
        } catch (e) {}
      }
    });
    dd.appendChild(item);
  });

  const rect = el.getBoundingClientRect();
  const _zs = _getZoom();
  dd.style.position = 'fixed';
  dd.style.left = (rect.left / _zs) + 'px';
  dd.style.top = (rect.bottom / _zs + 2) + 'px';
  document.body.appendChild(dd);
  clampPopupToViewport(dd);
  _enableDropdownKeyNav(dd, '.status-dropdown-item');
  setTimeout(() => {
    const closer = (e) => {
      if (!dd.contains(e.target)) { closeAllDropdowns(); document.removeEventListener('pointerdown', closer); }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}


function _showAutoFillStatusInput(dbPath, propName, ptc, currentValue) {
  closeColHeaderMenu();
  // インラインモーダル（prompt()禁止のため）
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="width:350px;padding:16px;">
      <div style="font-size:14px;font-weight:bold;margin-bottom:8px;">ステータス連動設定</div>
      <div style="font-size:12px;color:var(--fg2);margin-bottom:12px;">
        どのステータスに変更されたとき、この日付プロパティに現在日時を自動入力しますか？<br>
        空にすると自動入力を解除します。
      </div>
      <input id="_autoFillStatusInput" type="text" value="${esc(currentValue)}" placeholder="例: 撮影済み, 確認済み"
        style="width:100%;padding:6px 8px;font-size:13px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;box-sizing:border-box;margin-bottom:12px;">
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button style="padding:4px 12px;font-size:12px;cursor:pointer;background:var(--bg3);color:var(--fg);border:1px solid var(--border);border-radius:4px;"
          data-action="this.closest('.modal-overlay').remove()">キャンセル</button>
        <button id="_autoFillStatusOk" style="padding:4px 12px;font-size:12px;cursor:pointer;background:var(--accent);color:var(--ui-fg-strong);border:none;border-radius:4px;">設定</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const input = document.getElementById('_autoFillStatusInput');
  input.focus();
  input.select();

  const confirm = () => {
    const val = input.value.trim();
    const newPtc = { ...ptc };
    if (val) {
      newPtc.autoFillOnStatus = val;
    } else {
      delete newPtc.autoFillOnStatus;
    }
    setPropertyType(dbPath, propName, newPtc);
    showStatus(val ? 'ステータス「' + val + '」で自動入力' : '自動入力を解除');
    overlay.remove();
  };

  document.getElementById('_autoFillStatusOk').addEventListener('click', confirm);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirm(); });
}
