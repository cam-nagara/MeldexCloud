/* Shared location editor for table cells and topic property layouts. */
const MeldexSheetLocation = (() => {
  const D = () => MeldexLocationData;
  function button(label, action) {
    const el = document.createElement('button'); el.type = 'button'; el.className = 'gb-btn'; el.textContent = label;
    el.onclick = action; return el;
  }
  function editable(anchor, dbPath, propName, ctx) {
    if (!anchor?.isConnected || ctx && ctx.dbPath !== dbPath) throw new Error('元のシートを開いてから編集し直してください');
    const reason = _cellUiWriteBlockedMessage(ctx) || _cellUiColumnLockMessage(dbPath, propName, ctx);
    if (reason || _cellUiRuntimeReadOnly(anchor)) throw new Error(reason || '閲覧専用のため変更できません');
    if (getPropertyTypes(dbPath, ctx)?.[propName]?.type !== 'location') throw new Error('列の種類が変わりました。編集し直してください');
  }
  async function open(value, link) {
    const originPane = typeof GBLayout !== 'undefined' ? GBLayout.activePane : null;
    const activeTab = () => {
      const pane = originPane && GBLayout.findNode(GBLayout.root, originPane)?.node;
      return pane?.tabs?.[pane.activeTabIndex]?.id;
    };
    const originTab = activeTab();
    const loc = D().parse(value, link);
    if (!link?.path) {
      const [lng, lat] = loc.point;
      window.open('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(lat + ',' + lng), '_blank', 'noopener'); return;
    }
    const loaded = await apiFetch('/file?path=' + encodeURIComponent(link.path));
    const doc = MeldexMapDocument.parse(loaded.content), point = D().resolve(loc, link, doc, link.path);
    if (!point) throw new Error('参照先の地図または地点が変わりました。場所を設定し直してください');
    if (originPane && (GBLayout.activePane !== originPane || activeTab() !== originTab)) return false;
    if (!await openMapApp(link.path, link.label || doc.title)) return;
    forEachComponent(component => {
      if (component instanceof MapAppComponent && component._active && component.path === D().canonicalPath(link.path, state.vaultPath)) {
        const live = component.store.doc, currentPoint = D().resolve(loc, link, live, component.path);
        if (!currentPoint) throw new Error('参照先の地図または地点が変わりました。場所を設定し直してください');
        const feature = live.features.find(f => f.id === loc.feature_id);
        if (feature) { component._select(feature.id); component.view.focus(feature); }
        else component.view.map.panTo(component.view.latlng(currentPoint));
      }
    });
  }
  function editCell(anchor, entityPath, propName, val, options = {}) {
    const dbPath = options.dbPath || _cellUiDbPathForEntity(entityPath), ctx = options.ctx || _valueEditorContext(entityPath, anchor, dbPath);
    try { editable(anchor, dbPath, propName, ctx); } catch (error) { showStatus(error.message, true); return; }
    if (anchor._locationDialog) { anchor._locationDialog.modal.focus(); return; }
    const entityName = anchor.closest?.('tr[data-entity-name]')?.dataset.entityName;
    const entity = ctx?.pivotData?.entities?.[entityName];
    let projected = null;
    try {
      if (val?._topicCanonicalOnly && val._topicValueMissing) projected = { ...val, _topicCandidateList: false };
      else if (!val && entity?._topicCanonicalOnly) projected = window.MeldexTopicPlacementUI.emptyProjectedValue(dbPath, entity, propName);
    }
    catch (error) { showStatus(error.message, true); return; }
    let old = null;
    try { if (val) old = D().parse(val.value, val.link); } catch (_) {
      try { if (JSON.parse(val.value)?.fileType === 'meldex-location') { showStatus('この場所は未対応の形式です。対応するMeldexで開いてください', true); return; } } catch (_) {}
    }
    let active = true, saving = false, request = 0, mapDoc = null;
    let link = val?.link ? { ...val.link } : null, mapId = old?.map_id || null, featureId = old?.feature_id || null;
    const save = button('場所を保存', async () => {
      if (saving) return;
      saving = true; save.disabled = true; dialog.body.inert = true; request++;
      try {
        editable(anchor, dbPath, propName, ctx);
        if (![x, y].every(input => input.value.trim() && input.reportValidity())) throw new Error('2つの座標を入力してください');
        let loc = { ...(old || {}), fileType: 'meldex-location', schema_version: 1, coordinate_system: system.value,
          label: label.value, point: [Number(x.value), Number(y.value)], map_id: mapId, feature_id: featureId };
        if (link?.path) {
          const loaded = await apiFetch('/file?path=' + encodeURIComponent(link.path));
          if (!active) return;
          const doc = MeldexMapDocument.parse(loaded.content), point = D().resolve(loc, link, doc, link.path);
          if (!point) throw new Error('参照先の地図または地点が変わりました。選び直してください');
          loc.point = point;
        }
        const value = D().encode(loc, link);
        editable(anchor, dbPath, propName, ctx);
        saving = true; save.disabled = true;
        const metadata = link ? { ...link, type: 'file', fileType: 'map' } : null;
        const refresh = () => selectDatabase(dbPath, ctx || undefined, { silent: true });
        if (projected) {
          const candidate = { value, status: getStatusEnabled(dbPath) ? '案' : '採用', note: '', candidate_id: MeldexMapDocument.id(), ...(metadata ? { link: metadata } : {}) };
          await _apiPutValue(projected, { _append_candidate: candidate });
          let ref = { ...projected, _topicCandidateList: true, _topicCandidateOriginal: candidate, candidate_id: candidate.candidate_id, value };
          historyPush('場所を追加: ' + propName, async () => { await _apiPutValue(ref, { _delete: true }); await refresh(); }, async () => {
            const next = { ...candidate, candidate_id: MeldexMapDocument.id() };
            await _apiPutValue(projected, { _append_candidate: next });
            ref = { ...ref, candidate_id: next.candidate_id, _topicCandidateOriginal: next }; await refresh();
          }, _dbScopeForPath(dbPath));
        } else if (val?._topicCanonicalOnly && !val._topicCandidateList) {
          const previous = val.value;
          const candidate = { value, status: val.status || '採用', note: val.note || '', candidate_id: MeldexMapDocument.id(), ...(metadata ? { link: metadata } : {}) };
          const next = [candidate];
          await _apiPutValue(val, { new_value: next, _expected_value: previous });
          historyPush('場所を設定: ' + propName,
            async () => { await _apiPutValue(val, { new_value: previous, _expected_value: next }); await refresh(); },
            async () => { await _apiPutValue(val, { new_value: next, _expected_value: previous }); await refresh(); }, _dbScopeForPath(dbPath));
        } else if (val) {
          const previous = val.value, previousLink = val.link ? { ...val.link } : null;
          await _apiPutValue(val, { new_value: value, new_link: metadata });
          val.value = value; if (metadata) val.link = metadata; else delete val.link;
          _dbUndoValue('場所を変更: ' + propName, val, previous, value, undefined, undefined,
            { dbPath, ctx, oldUpdates: { new_link: previousLink }, newUpdates: { new_link: metadata } });
        } else {
          const status = getStatusEnabled(dbPath) ? '案' : '採用';
          const result = await _apiPostValue(entityPath, propName, value, status, '', '', { link: metadata });
          let ref = { file: result.path || result.file, entry_path: entityPath, property: propName,
            candidate_id: result.candidate_id, candidate_index: result.candidate_index, entry_id: result.entry_id };
          historyPush('場所を追加: ' + propName, async () => { await _apiPutValue(ref, { _delete: true }); await refresh(); }, async () => {
            const result = await _apiPostValue(entityPath, propName, value, status, '', '', { link: metadata });
            ref = { ...ref, file: result.path || result.file, candidate_id: result.candidate_id, candidate_index: result.candidate_index, entry_id: result.entry_id }; await refresh();
          }, typeof _dbScopeForPath === 'function' ? _dbScopeForPath(dbPath) : 'db:' + dbPath);
        }
        saving = false; dialog.close('saved'); await refresh(); showStatus('場所を保存しました');
      } catch (error) { message.textContent = error.userMessage || error.message; }
      finally { saving = false; save.disabled = false; dialog.body.inert = false; }
    });
    const cancel = button('キャンセル', () => dialog.close('cancel'));
    const dialog = GBUI.createModal({ title: '場所を編集 — ' + propName, footer: [cancel, save], returnFocus: () => anchor,
      onBeforeClose: () => !saving, onClose: () => { active = false; request++; delete anchor._locationDialog; } });
    anchor._locationDialog = dialog;
    const field = (caption, value = '', type = 'text') => {
      const wrap = document.createElement('label'); wrap.className = 'gb-map-field';
      const title = document.createElement('span'); title.textContent = caption;
      const input = document.createElement('input'); input.type = type; input.value = value; input.setAttribute('aria-label', caption);
      wrap.append(title, input); dialog.body.appendChild(wrap); return { input, title };
    };
    const label = field('場所の名前', old?.label || (val?.value || '')).input;
    const systemLabel = document.createElement('label'); systemLabel.textContent = '座標の種類';
    const system = document.createElement('select'); system.setAttribute('aria-label', '座標の種類');
    system.add(new Option('緯度経度', 'world')); system.add(new Option('創作座標', 'local')); system.value = old?.coordinate_system || 'world';
    systemLabel.appendChild(system); dialog.body.appendChild(systemLabel);
    const mapPath = field('参照先マップ', link?.path || '').input; mapPath.readOnly = true;
    const feature = document.createElement('select'); feature.setAttribute('aria-label', 'マップの地点'); dialog.body.appendChild(feature);
    const xf = field('経度 / X', old?.point[0] ?? '', 'number'), yf = field('緯度 / Y', old?.point[1] ?? '', 'number'), x = xf.input, y = yf.input;
    x.step = y.step = 'any'; x.required = y.required = true;
    const sync = () => {
      const world = system.value === 'world'; x.min = world ? -180 : -1e7; x.max = world ? 180 : 1e7; y.min = world ? -85.051129 : -1e7; y.max = world ? 85.051129 : 1e7;
      xf.title.textContent = world ? '経度' : 'X'; yf.title.textContent = world ? '緯度' : 'Y';
    };
    const fillFeatures = () => {
      feature.replaceChildren(new Option('座標を直接指定', ''));
      for (const f of mapDoc?.features || []) if (['pin', 'label'].includes(f.kind)) feature.add(new Option(f.label || '名前なし', f.id));
      feature.value = featureId || ''; feature.disabled = !mapDoc;
    };
    const chooseMap = async path => {
      path = D().canonicalPath(path, state.vaultPath);
      const token = ++request, loaded = await apiFetch('/file?path=' + encodeURIComponent(path));
      if (!active || token !== request) return;
      const doc = MeldexMapDocument.parse(loaded.content);
      if (!doc.meldex?.document_id) throw new Error('文書IDを持つマップを選んでください');
      mapDoc = doc; link = { path, label: doc.display_title || doc.title, type: 'file', fileType: 'map' }; mapId = doc.meldex.document_id;
      system.value = doc.coordinate_system; mapPath.value = path; featureId = null; feature.value = ''; x.value = y.value = '';
      sync(); fillFeatures();
    };
    dialog.body.append(button('マップを選択', () => MeldexLinkModal.show(null, async chosen => {
      if (chosen.type !== 'file' || !chosen.path?.toLowerCase().endsWith('.mel-map')) { message.textContent = 'マップファイルを選んでください'; return; }
      try { await chooseMap(chosen.path); } catch (error) { if (active) message.textContent = error.message; }
    })), button('マップの参照を解除', () => { request++; link = null; mapId = featureId = null; mapDoc = null; mapPath.value = ''; fillFeatures(); }));
    feature.onchange = () => {
      featureId = feature.value || null; const f = mapDoc?.features.find(f => f.id === featureId);
      if (f) { [x.value, y.value] = f.points[0]; if (!label.value) label.value = f.label; }
    };
    x.oninput = y.oninput = () => { featureId = null; feature.value = ''; };
    system.onchange = () => { request++; link = null; mapId = featureId = null; mapDoc = null; mapPath.value = ''; x.value = y.value = ''; fillFeatures(); sync(); };
    const message = document.createElement('p'); message.setAttribute('role', 'status'); message.textContent = '創作座標には参照先マップが必要です。マップの地点を選ぶと、その地点の移動に追従します。'; dialog.body.appendChild(message);
    sync(); fillFeatures(); dialog.open(); label.focus();
    if (link?.path) {
      const token = ++request;
      apiFetch('/file?path=' + encodeURIComponent(link.path)).then(loaded => {
        if (!active || request !== token) return;
        mapDoc = MeldexMapDocument.parse(loaded.content); fillFeatures();
      }).catch(error => { if (active && request === token) message.textContent = error.message; });
    }
  }
  function valueElement(val, entityPath, propName, options) {
    const wrap = document.createElement('span'); wrap.className = 'db-location-controls';
    let loc = null; try { loc = D().parse(val.value, val.link); } catch (_) {}
    const edit = button(loc ? loc.label || loc.point.join(', ') : '場所を設定: ' + String(val.value || ''), () => editCell(edit, entityPath, propName, val, options));
    edit.classList.add('value-text', 'db-location-value'); wrap.appendChild(edit);
    if (loc) {
      const map = button(val.link?.path ? 'マップで開く' : 'Googleマップで開く', async event => {
        event.stopPropagation(); try { await open(val.value, val.link); } catch (error) { showStatus(error.message, true); }
      }); map.classList.add('db-location-open'); wrap.appendChild(map);
    }
    return wrap;
  }
  return Object.freeze({ editCell, valueElement, open });
})();
