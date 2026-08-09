function updateNoteToc() {
  const pc = document.getElementById('page-content');
  const toc = document.getElementById('note-toc');
  if (!pc || !toc) return;

  const headings = pc.querySelectorAll('h1, h2, h3, h4, h5, h6');
  if (headings.length === 0) {
    toc.innerHTML = '<div class="note-toc-empty">見出しがありません</div>';
    return;
  }

  let html = '';
  headings.forEach((h, i) => {
    const level = parseInt(h.tagName[1]);
    const text = h.textContent.trim() || '(無題)';
    // 見た目（インデント・色・省略）とホバーは gb-tools.part01.part02.css の
    // .note-toc-item / .note-toc-level-N に持たせる。インラインstyleでハイライトすると、
    // ポインタが乗ったまま目次を作り直したときに mouseleave が来ず消えなくなる。
    html += `<button type="button" class="note-toc-item note-toc-level-${level}" data-note-toc-level="${level}" data-note-toc-index="${i}"`
      + ` data-e2e-id="note-toc-item-${i}" title="${esc(text)}">${esc(text)}</button>`;
  });
  toc.innerHTML = html;
  // 目次はDOMごと差し替わるため、テーマの適用対象マークを付け直す。
  // これを省くとテーマ側のホバー色だけが失効する。
  try { window.MeldexThemeManager?.applyThemeUiApplications?.(null, { forceTargets: true }); } catch (_) { /* テーマ未初期化 */ }
  toc.querySelectorAll('[data-note-toc-index]').forEach(item => {
    item.addEventListener('click', () => {
      const index = Number(item.dataset.noteTocIndex);
      const target = document.querySelectorAll('#page-content h1,#page-content h2,#page-content h3,#page-content h4,#page-content h5,#page-content h6')[index];
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

/* ==============================
   エントリページ描画 (グリッド + 編集 UI + D&D 並べ替え + 親DBリンク)
   ============================== */
function _entityParentDir(entityPath) {
  if (!entityPath) return '';
  const i = entityPath.lastIndexOf('/');
  return i >= 0 ? entityPath.substring(0, i) : '';
}

function _entityPropControlId(prefix, propName) {
  const suffix = Array.from(String(propName || 'property'))
    .map(ch => /[A-Za-z0-9_-]/.test(ch) ? ch : ch.codePointAt(0).toString(16))
    .join('-')
    .replace(/-+/g, '-')
    .slice(0, 80) || 'property';
  return `${prefix}-${suffix}`;
}

// エントリ単位のプロパティ並び順 (DB ごとに共有)
function getEntryPropOrder(dbPath) {
  if (typeof getDbViewConfig !== 'function' || !dbPath) return null;
  return getDbViewConfig(dbPath).entryPropOrder || null;
}
function setEntryPropOrder(dbPath, order) {
  if (typeof getDbViewConfig !== 'function' || !dbPath) return;
  const c = getDbViewConfig(dbPath);
  c.entryPropOrder = order;
  if (typeof saveDbViewConfig === 'function') saveDbViewConfig(dbPath, c);
}

function _showEntryPropInlineAdd(valuesEl, grid, data, entityPath, propName, options) {
  const opts = options || {};
  const parentDb = opts.parentDb || _entityParentDir(entityPath);
  const lockMsg = parentDb && typeof checkColumnEditable === 'function'
    ? checkColumnEditable(parentDb, propName)
    : '';
  if (lockMsg) { showStatus(lockMsg); return; }
  if (!valuesEl || valuesEl.querySelector('.entry-prop-inline-add')) {
    valuesEl?.querySelector?.('.entry-prop-inline-add input')?.focus();
    return;
  }
  if (parentDb && typeof getStatusEnabled === 'function' && !getStatusEnabled(parentDb) && valuesEl.querySelector('.cell-value')) {
    showStatus('このシートは1セル1値運用です（ステータス機能オフ）');
    return;
  }

  // カラー列は、テキスト入力ではなく共通カラーパレットで色を選んで追加する。
  const _ptcAdd = (parentDb && typeof getPropertyTypes === 'function') ? getPropertyTypes(parentDb)[propName] : null;
  if (_ptcAdd?.type === 'color' && typeof openColorPalette === 'function') {
    let saved = false;
    let saveTimer = null;
    openColorPalette(valuesEl, '', (color) => {
      if (saved) return;
      const hex = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(color || '').trim()) ? color.trim() : '';
      clearTimeout(saveTimer);
      if (!hex) return;
      // ライブ変更のたびに保存せず、色が落ち着いてから1回だけ候補値を追加する
      saveTimer = setTimeout(async () => {
        if (saved) return;
        saved = true;
        try {
          await _apiPostValue(entityPath, propName, hex, '採用', '');
          const fresh = await apiFetch('/entity?path=' + encodeURIComponent(entityPath)).catch(() => null);
          if (fresh && fresh.properties) renderEntityPropsGridInto(grid, fresh, entityPath, opts);
          else {
            if (!Array.isArray(data.properties[propName])) data.properties[propName] = [];
            data.properties[propName].push({ property: propName, value: hex, status: '採用', note: '', file: entityPath });
            renderEntityPropsGridInto(grid, data, entityPath, opts);
          }
        } catch (e) { showStatus('候補値の追加に失敗しました', true); }
      }, 300);
    });
    return;
  }

  const statusOn = !parentDb || typeof getStatusEnabled !== 'function' || getStatusEnabled(parentDb);
  const row = document.createElement('div');
  row.className = 'entry-prop-inline-add';
  row.style.cssText = 'display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:4px;';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = '値を入力';
  input.style.cssText = 'flex:1 1 160px;min-width:120px;padding:3px 6px;background:var(--bg2);color:var(--fg);border:1px solid var(--accent);border-radius:3px;font-size:12px;';
  row.appendChild(input);

  let statusSelect = null;
  if (statusOn) {
    statusSelect = document.createElement('select');
    statusSelect.style.cssText = 'width:auto;padding:3px 6px;font-size:12px;';
    ['案', '採用', 'ボツ', '掲載済み'].forEach(status => {
      const opt = document.createElement('option');
      opt.value = status;
      opt.textContent = status;
      if (status === '案') opt.selected = true;
      statusSelect.appendChild(opt);
    });
    row.appendChild(statusSelect);
  }

  const noteInput = document.createElement('input');
  noteInput.type = 'text';
  noteInput.placeholder = '備考';
  noteInput.style.cssText = 'flex:1 1 120px;min-width:100px;padding:3px 6px;background:var(--bg2);color:var(--fg);border:1px solid var(--border);border-radius:3px;font-size:12px;';
  row.appendChild(noteInput);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'gb-btn gb-btn-sm';
  saveBtn.title = '候補値を追加';
  saveBtn.setAttribute('aria-label', '候補値を追加');
  saveBtn.innerHTML = typeof lucide === 'function' ? lucide('check', 14) : '追加';
  row.appendChild(saveBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'gb-btn gb-btn-sm';
  cancelBtn.title = 'キャンセル';
  cancelBtn.setAttribute('aria-label', 'キャンセル');
  cancelBtn.innerHTML = typeof lucide === 'function' ? lucide('x', 14) : '取消';
  row.appendChild(cancelBtn);

  const cancel = () => row.remove();
  const submit = async () => {
    const value = input.value.trim();
    if (!value) { showStatus('値を入力してください', true); input.focus(); return; }
    const status = statusSelect ? statusSelect.value : '採用';
    const note = noteInput.value.trim();
    saveBtn.disabled = true;
    try {
      await _apiPostValue(entityPath, propName, value, status, note);
      showStatus('候補値を追加しました');
      const fresh = await apiFetch('/entity?path=' + encodeURIComponent(entityPath)).catch(() => null);
      if (fresh && fresh.properties) {
        renderEntityPropsGridInto(grid, fresh, entityPath, opts);
      } else {
        if (!Array.isArray(data.properties[propName])) data.properties[propName] = [];
        data.properties[propName].push({ property: propName, value, status, note, file: entityPath });
        renderEntityPropsGridInto(grid, data, entityPath, opts);
      }
    } catch (e) {
      saveBtn.disabled = false;
      showStatus('候補値の追加に失敗しました', true);
    }
  };

  saveBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', cancel);
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  valuesEl.appendChild(row);
  input.focus();
}

// プロパティグリッドを指定 container に描画する共通関数 (entity-view と詳細パネルで共有)
function renderEntityPropsGridInto(grid, data, entityPath, options) {
  if (!grid) return;
  const opts = options || {};
  const parentDb = opts.parentDb || _entityParentDir(entityPath);
  const propTypes = opts.propTypes || (typeof getPropertyTypes === 'function' ? getPropertyTypes(parentDb) : null) || {};
  const allProps = Object.keys(data.properties || {});
  const layout = typeof getPropertyLayout === 'function'
    ? getPropertyLayout(parentDb, allProps)
    : { order: getEntryPropOrder(parentDb) || [...allProps].sort(), hidden: [], groups: [] };
  const groupedProps = typeof applyPropertyLayout === 'function'
    ? applyPropertyLayout(allProps, layout)
    : [{ title: '', props: layout.order || allProps }];
  const propNames = groupedProps.flatMap(group => group.props || []);
  const layoutEditMode = typeof isPropertyLayoutEditMode === 'function' && isPropertyLayoutEditMode(parentDb);
  grid.innerHTML = '';
  // grid container にもクラスを付けて CSS が当たるように
  grid.classList.add('entity-props-grid-container');

  // 開閉状態・列幅は dbPath (エントリの親フォルダ) 単位で view_config に保存する。
  // フルページ/サブパネル/モバイルドロワーいずれもこの共通関数を経由するため自動的に反映される。
  const viewState = typeof _entityPropsViewState === 'function'
    ? _entityPropsViewState(parentDb, entityPath)
    : { collapsed: false, colWidth: 300 };
  grid.style.setProperty('--entity-prop-col-width', viewState.colWidth + 'px');
  // ヘッダーの表示可否は「プロパティが1つも定義されていないか」で判定する (allProps基準)。
  // レイアウト編集で全プロパティを非表示にしただけの場合はヘッダー(と並び替えツールバーへの導線)を残す。
  if (typeof _buildEntityPropsHeader === 'function') {
    grid.appendChild(_buildEntityPropsHeader(grid, data, entityPath, options, parentDb, allProps.length > 0, viewState));
  }

  // プロパティ本体 (並び替えツールバー + グループ見出し + カード)。閉じている間は丸ごと隠す。
  // display:contents にすることで、このラッパー自体はグリッドのレイアウトに関与せず、
  // 子要素 (カード等) が引き続き外側グリッドの直接の子として複数列に配置される。
  const body = document.createElement('div');
  body.className = 'entity-props-body';
  body.dataset.e2eId = 'entity-props-body';
  body.style.display = viewState.collapsed ? 'none' : 'contents';
  grid.appendChild(body);

  if (typeof renderPropertyLayoutToolbar === 'function') {
    renderPropertyLayoutToolbar(grid, data, entityPath, options, body);
  }
  groupedProps.forEach(group => {
    if (group.title) {
      const title = document.createElement('h4');
      title.className = 'gb-prop-group-title';
      title.textContent = group.title;
      body.appendChild(title);
    }
    (group.props || []).forEach(propName => {
    const card = document.createElement('div');
    card.className = 'entry-prop-card' + (layoutEditMode ? ' layout-editing' : '');
    card.dataset.propName = propName;
    // カード自体は draggable にしない。専用ハンドル（entry-prop-drag-handle）だけで
    // 並べ替えられるようにし、値要素の文字選択（gb-entity-props-selection.js）と
    // ゴーストカードが競合しないようにする（シート表示・ビュー状態・エントリ操作の
    // 改善計画 2026-08-04。行ドラッグハンドル row-drag-handle と同じ慣行）。
    card.draggable = false;
    let dragHandle = null;
    const nameEl = document.createElement('div');
    nameEl.className = 'entry-prop-name';
    if (layoutEditMode) {
      dragHandle = document.createElement('span');
      dragHandle.className = 'entry-prop-drag-handle';
      dragHandle.draggable = true;
      dragHandle.title = 'ドラッグして並べ替え';
      dragHandle.dataset.e2eId = _entityPropControlId('entry-prop-drag', propName);
      dragHandle.setAttribute('role', 'button');
      dragHandle.setAttribute('aria-label', 'ドラッグして並べ替え: ' + propName);
      dragHandle.innerHTML = typeof lucide === 'function' ? lucide('gripVertical', 14) : '☰';
      dragHandle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      nameEl.appendChild(dragHandle);
    }
    // 各列名の前に列タイプのアイコンを表示する
    if (typeof lucide === 'function' && typeof getPropertyTypeIcon === 'function') {
      const typeIcon = document.createElement('span');
      typeIcon.className = 'entry-prop-type-icon';
      typeIcon.setAttribute('aria-hidden', 'true');
      typeIcon.innerHTML = lucide(getPropertyTypeIcon(propTypes[propName]?.type), 14);
      nameEl.appendChild(typeIcon);
    }
    const nameText = document.createElement('span');
    nameText.className = 'entry-prop-name-text';
    nameText.textContent = propName;
    nameEl.appendChild(nameText);
    card.appendChild(nameEl);
    const valuesEl = document.createElement('div');
    valuesEl.className = 'entry-prop-values cell-values';
    const values = filterValues(data.properties[propName] || []);
    const ptc = propTypes[propName];
    // ロールアップ/数式型は保存値でなくその場の計算結果を1つだけ表示する（表セルと同じ見え方）。
    // 未変換の生値が複数残っていても計算結果は1本にまとめ、値が無くても空の計算結果を表示する。
    const isComputedProp = ptc?.type === 'rollup' || ptc?.type === 'formula';
    const renderValues = isComputedProp
      ? [values[0] || { value: '', status: '採用' }]
      : (ptc?.type === 'image' && values.length === 0)
        ? [{ value: '', status: '採用', file: entityPath, property: propName, candidate_index: null }]
        : values;
    renderValues.forEach(val => {
      let valEl;
      if (typeof createTypedValueElement === 'function' && ptc) {
        valEl = createTypedValueElement(val, entityPath, propName, 'small', ptc, {
          entityData: data.properties,
          propTypes,
        });
      } else if (typeof createValueElement === 'function') {
        valEl = createValueElement(val, entityPath, propName);
      }
      if (valEl) valuesEl.appendChild(valEl);
      if (val.relations && val.relations.length > 0) {
        const relDiv = document.createElement('div');
        relDiv.className = 'relation-links';
        relDiv.style.marginLeft = '12px';
        val.relations.forEach(r => {
          const link = document.createElement('span');
          link.className = 'relation-link';
          link.textContent = (r.entity || '') + (r.role ? ' (' + r.role + ')' : '');
          link.addEventListener('click', (e) => { e.stopPropagation(); navigateToEntity(r.entity); });
          relDiv.appendChild(link);
        });
        valuesEl.appendChild(relDiv);
      }
    });
    if (layoutEditMode) {
      const hideBtn = document.createElement('button');
      hideBtn.type = 'button';
      hideBtn.className = 'gb-prop-hide-btn';
      hideBtn.title = '列一覧から非表示';
      hideBtn.dataset.e2eId = _entityPropControlId('entity-prop-hide', propName);
      hideBtn.dataset.propName = propName;
      hideBtn.innerHTML = typeof lucide === 'function' ? lucide('eyeOff', 12) : '非表示';
      hideBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const next = typeof getPropertyLayout === 'function' ? getPropertyLayout(parentDb, allProps) : layout;
        next.hidden = Array.from(new Set([...(next.hidden || []), propName]));
        if (!await savePropertyLayout(parentDb, next)) return;
        renderEntityPropsGridInto(grid, data, entityPath, options);
      });
      valuesEl.appendChild(hideBtn);
    }
    // ロールアップ/数式型は計算結果であり候補値を追加できないため、＋ボタンは出さない
    // （シート表側の _nonValueTypes 除外と同じ扱い）。1セル1値で運用するシート（制作管理）
    // も同様に出さない — 押しても _showEntryPropInlineAdd が拒否する空振りボタンになり、
    // シート表側と見た目が食い違うため（シート表: gb-db-table.part02.js の _allowAdd）。
    const _hideAddButton = parentDb && typeof hidesCandidateStatusUi === 'function'
      && hidesCandidateStatusUi(parentDb);
    if (!isComputedProp && !_hideAddButton) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'cell-add-btn';
      addBtn.dataset.e2eId = _entityPropControlId('entity-prop-add', propName);
      addBtn.dataset.propName = propName;
      addBtn.innerHTML = typeof lucide === 'function' ? lucide('plus', 14) : '+';
      addBtn.title = '候補値を追加';
      addBtn.setAttribute('aria-label', '候補値を追加');
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        _showEntryPropInlineAdd(valuesEl, grid, data, entityPath, propName, options);
      });
      // ＋（候補値を追加）は独立行ではなく、値群の末尾（最後の値と同じ行）にインライン配置する。
      const lastValueEl = !layoutEditMode
        ? Array.from(valuesEl.children).reverse().find(el => el.classList && el.classList.contains('cell-value'))
        : null;
      if (lastValueEl) {
        const tail = document.createElement('div');
        tail.className = 'entry-prop-value-tail';
        valuesEl.insertBefore(tail, lastValueEl);
        tail.appendChild(lastValueEl);
        tail.appendChild(addBtn);
      } else {
        valuesEl.appendChild(addBtn);
      }
    }
    card.appendChild(valuesEl);

    // D&D 並べ替え (DB 単位の順序保存。同 DB のすべてのエントリ表示で共有)
    // dragstart/dragend はドラッグ操作を実際に開始できる要素（専用ハンドル）へ付ける。
    // dragover/dragleave/drop はドロップ先判定なのでカード全体のままでよい
    // （ハンドル以外の場所へドロップしても、そのカードの位置へ挿入される）。
    if (dragHandle) {
      dragHandle.addEventListener('dragstart', (e) => {
        if (!layoutEditMode) return;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/x-meldex-entry-prop', propName);
        card.classList.add('dragging');
      });
      dragHandle.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        grid.querySelectorAll('.entry-prop-card.drag-over-left, .entry-prop-card.drag-over-right')
          .forEach(el => el.classList.remove('drag-over-left', 'drag-over-right'));
      });
    }
    card.addEventListener('dragover', (e) => {
      if (!layoutEditMode) return;
      if (!e.dataTransfer.types.includes('text/x-meldex-entry-prop')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = card.getBoundingClientRect();
      const isLeft = (e.clientX - rect.left) < rect.width / 2;
      card.classList.toggle('drag-over-left', isLeft);
      card.classList.toggle('drag-over-right', !isLeft);
    });
    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over-left', 'drag-over-right');
    });
    card.addEventListener('drop', async (e) => {
      if (!layoutEditMode) return;
      e.preventDefault();
      const fromName = e.dataTransfer.getData('text/x-meldex-entry-prop');
      const isLeft = card.classList.contains('drag-over-left');
      card.classList.remove('drag-over-left', 'drag-over-right');
      if (!fromName || fromName === propName) return;
      const arr = propNames.filter(n => n !== fromName);
      const idx = arr.indexOf(propName);
      const insertIdx = idx >= 0 ? idx + (isLeft ? 0 : 1) : arr.length;
      arr.splice(insertIdx, 0, fromName);
      if (parentDb) {
        const next = typeof getPropertyLayout === 'function' ? getPropertyLayout(parentDb, allProps) : { order: arr, hidden: [], groups: [] };
        next.order = arr;
        if (typeof savePropertyLayout === 'function' && !await savePropertyLayout(parentDb, next)) return;
        else setEntryPropOrder(parentDb, arr);
      }
      // 同じ container を再描画 (entity-view からも詳細パネルからも呼べる)
      renderEntityPropsGridInto(grid, data, entityPath, options);
    });
    body.appendChild(card);
  });
  });
}

// エントリ自由記述の保存先/方式を決定する。
// - entityPathが.mdで終わる（新形式=1エントリ1ファイル）: /value経由、entry_revisionでCAS
// - それ以外（旧形式=フォルダ型エントリ）: 実体は ep + '/_freetext.md' への/file保存、etagでCAS
function _entityFreeTextTarget(entityPath) {
  const path = String(entityPath || '');
  if (!path) return { path: '', mode: 'file' };
  return path.endsWith('.md') ? { path, mode: 'value' } : { path: path + '/_freetext.md', mode: 'file' };
}

function _entityFreeTextShowConflictPending(hostEl, entityPath, documentKey) {
  window.MeldexConflictPendingBanner?.show?.(documentKey, {
    label: '競合を保留中',
    e2eId: 'entity-freetext-conflict-pending-banner',
    onConfirm: () => {
      _entityFreeTextReviewConflict(hostEl, entityPath, documentKey)
        .catch(() => showStatus('エントリ本文の競合確認に失敗しました', true));
    },
  });
}

function _entityFreeTextRestoreConflictReview(hostEl, entityPath, documentKey, record) {
  const coordinator = window.MeldexDocumentSaveCoordinator;
  if (coordinator && record) {
    const current = coordinator.getConflict?.(documentKey);
    if (!current || current.generation !== record.generation) return;
    coordinator.restoreConflict?.(documentKey, record);
  }
  _entityFreeTextShowConflictPending(hostEl, entityPath, documentKey);
}

async function _entityFreeTextReviewConflict(hostEl, entityPath, documentKey) {
  const coordinator = window.MeldexDocumentSaveCoordinator;
  const record = coordinator?.requestConflictReview?.(documentKey) || null;
  if (coordinator && !record) return;
  const generation = record?.generation ?? null;
  const target = _entityFreeTextTarget(entityPath);
  const localMd = hostEl && typeof htmlToMd === 'function'
    ? htmlToMd(hostEl.innerHTML)
    : String(record?.localMd || '');
  window.MeldexConflictPendingBanner?.hide?.(documentKey);
  const keepLocal = typeof cfConfirm === 'function'
    ? await cfConfirm('このエントリ本文は他の場所で更新されています。今の編集内容で上書きしますか？（キャンセルすると最新版を読み込み、今の編集内容は下書きに残ります）')
    : false;
  try {
    if (!hostEl || hostEl.dataset.entityPath !== entityPath) {
      _entityFreeTextRestoreConflictReview(hostEl, entityPath, documentKey, record);
      return;
    }
    if (keepLocal) {
      const result = target.mode === 'value'
        ? await apiPut('/value?path=' + encodeURIComponent(target.path), {
            new_body: localMd,
            skip_if_missing: true,
          })
        : await apiPut('/file?path=' + encodeURIComponent(target.path), {
            content: localMd,
            force_overwrite: true,
          });
      const resolved = coordinator?.resolveConflict?.(documentKey, generation);
      if (coordinator && !resolved) {
        throw new Error('エントリ本文の競合状態が更新されたため、上書き結果を確定できません');
      }
      hostEl.dataset.lastSavedMd = localMd;
      if (target.mode === 'value') {
        hostEl.dataset.lastSavedRevision = (result?.revision != null)
          ? String(result.revision)
          : hostEl.dataset.lastSavedRevision || '';
      } else {
        hostEl.dataset.lastSavedEtag = result?.etag || hostEl.dataset.lastSavedEtag || '';
        if (result?.transport_revision && coordinator?.normalizeTransportRevision) {
          hostEl.dataset.lastSavedTransportRevision = coordinator.normalizeTransportRevision(
            coordinator.currentTransportName(),
            result.transport_revision,
          );
        }
      }
      coordinator?.bindDocumentIdentity?.(target.path, result || {});
      if (resolved) window.MeldexConflictPendingBanner?.hide?.(documentKey);
      await window.MeldexDraftRecovery?.markSynced?.(target.path);
      showStatus('自分の編集でエントリ本文を上書き保存しました');
      return;
    }

    await window.MeldexDraftRecovery?.saveDraft?.(
      target.path,
      localMd,
      hostEl.dataset.lastSavedEtag || hostEl.dataset.lastSavedRevision || '',
    );
    const latest = await apiFetch('/entity?path=' + encodeURIComponent(entityPath));
    if (!hostEl || hostEl.dataset.entityPath !== entityPath) {
      _entityFreeTextRestoreConflictReview(hostEl, entityPath, documentKey, record);
      return;
    }
    const latestMd = String(latest?.page_content || '');
    hostEl.innerHTML = latestMd.trim() && typeof mdToHtml === 'function'
      ? (typeof applyAutoLinks === 'function'
          ? applyAutoLinks(mdToHtml(latestMd, { basePath: entityPath }), entityPath)
          : mdToHtml(latestMd))
      : '';
    hostEl.dataset.lastSavedMd = latestMd;
    hostEl.dataset.lastSavedRevision = (latest?.revision != null) ? String(latest.revision) : '';
    hostEl.dataset.lastSavedEtag = latest?.freetext_etag || '';
    hostEl.dataset.lastSavedTransportRevision = '';
    const resolved = coordinator?.resolveConflict?.(documentKey, generation);
    if (coordinator && !resolved) {
      throw new Error('エントリ本文の競合状態が更新されたため、再読込結果を確定できません');
    }
    if (resolved) window.MeldexConflictPendingBanner?.hide?.(documentKey);
    _bindEntityFreeTextParticipant(hostEl, entityPath);
    showStatus('最新版のエントリ本文を読み込みました');
  } catch (error) {
    _entityFreeTextRestoreConflictReview(hostEl, entityPath, documentKey, record);
    throw error;
  }
}

// /api/entity のrevisionは新形式エントリの論理版、/api/file の
// transport_revisionは実ファイルの保存先固有版で役割が異なる。参加登録時は
// metadata_onlyのidentityだけを文書キー統合へ使い、/valueのCASへファイルetagを
// 流用しない。旧形式の_freetext.mdだけは同じ/file経路なので読込etagも保持する。
function _bindEntityFreeTextParticipant(hostEl, entityPath) {
  const coordinator = window.MeldexDocumentSaveCoordinator;
  const target = _entityFreeTextTarget(entityPath);
  if (!coordinator || !hostEl || !target.path) return;
  const provisionalKey = coordinator.documentKeyForPath(target.path);
  coordinator.registerParticipant(provisionalKey, hostEl);
  if (coordinator.isConflictPending?.(provisionalKey)) {
    _entityFreeTextShowConflictPending(hostEl, entityPath, provisionalKey);
  }
  Promise.resolve(apiFetch(
    '/file?path=' + encodeURIComponent(target.path) + '&metadata_only=true',
    { silentError: true },
  )).then((metadata) => {
    if (!metadata || hostEl.dataset.entityPath !== entityPath) return;
    const documentKey = coordinator.bindDocumentIdentity?.(target.path, metadata) || provisionalKey;
    coordinator.registerParticipant(documentKey, hostEl);
    if (target.mode === 'file' && metadata.transport_revision && coordinator.normalizeTransportRevision) {
      hostEl.dataset.lastSavedTransportRevision = coordinator.normalizeTransportRevision(
        coordinator.currentTransportName(),
        metadata.transport_revision,
      );
    }
    if (coordinator.isConflictPending?.(documentKey)) {
      _entityFreeTextShowConflictPending(hostEl, entityPath, documentKey);
    }
  }).catch(() => {
    // 新規の旧形式エントリ本文では _freetext.md がまだ無い。初回保存の
    // create_onlyで生成するため、metadata 404は表示や入力を妨げない。
  });
}

// 工程2-C項目5・6: エントリ自由記述の保存を保存コーディネーター経由へ接続する。
// メインパネル（ft.oninput/onblur）とタブ/パネル切替flush（flushPendingEditorAutosave）の
// 双方から呼ばれる共有関数にすることで、同じ文書に対する保存経路の分断を無くす。
// hostEl は dataset.lastSavedMd / lastSavedRevision / lastSavedEtag を保持する
// contenteditable要素（メインパネルの#entity-freetext、モバイルドロワーの本文editor等）。
async function _saveEntityFreeText(hostEl, entityPath, md, opts) {
  const target = _entityFreeTextTarget(entityPath);
  if (!target.path) return true;
  const coordinator = window.MeldexDocumentSaveCoordinator;
  const revision = (hostEl && hostEl.dataset && hostEl.dataset.lastSavedRevision) || '';
  const transportRevision = (hostEl && hostEl.dataset && hostEl.dataset.lastSavedTransportRevision) || '';
  const etag = (hostEl && hostEl.dataset && hostEl.dataset.lastSavedEtag) || '';
  if (!coordinator) {
    // コーディネーター未ロード時のフォールバック（従来の直接呼び出し。旧シグネチャ互換）。
    const res = target.mode === 'value'
      ? await apiPut('/value?path=' + encodeURIComponent(target.path), {
          new_body: md,
          skip_if_missing: true,
          ...(revision !== '' ? { base_revision: Number(revision) } : {}),
        })
      : await apiPut('/file?path=' + encodeURIComponent(target.path), {
          content: md,
          ...((transportRevision || etag) ? {
            if_match_etag: etag,
            transport_revision: transportRevision,
            skip_if_missing: true,
          } : {
            create_only: true,
          }),
        });
    if (typeof _handleFreeTextSkippedMissingSave === 'function' && _handleFreeTextSkippedMissingSave(res)) return false;
    return true;
  }
  const documentKey = coordinator.documentKeyForPath(target.path);
  if (hostEl) coordinator.registerParticipant(documentKey, hostEl);
  const guardedTransportRevision = transportRevision || etag;
  const sendFn = (previousResult) => (target.mode === 'value'
    ? apiPut('/value?path=' + encodeURIComponent(target.path), {
        new_body: md, skip_if_missing: true,
        ...((previousResult?.revision ?? revision) !== ''
          ? { base_revision: Number(previousResult?.revision ?? revision) }
          : {}),
      })
    : apiPut('/file?path=' + encodeURIComponent(target.path), {
        content: md,
        ...((previousResult?.transport_revision || previousResult?.etag || guardedTransportRevision) ? {
          if_match_etag: coordinator.revisionTokenForWrite(
            previousResult?.transport_revision || previousResult?.etag || guardedTransportRevision,
          ),
          transport_revision: previousResult?.transport_revision
            || previousResult?.etag
            || guardedTransportRevision,
          skip_if_missing: true,
        } : {
          create_only: true,
        }),
      }));
  try {
    const res = await coordinator.requestSave(documentKey, hostEl, target.path, md, sendFn, {
      reason: (opts && opts.reason) || 'entity-freetext',
    });
    if (res && res.conflictPending) return false;
    if (typeof _handleFreeTextSkippedMissingSave === 'function' && _handleFreeTextSkippedMissingSave(res)) return false;
    if (hostEl && hostEl.dataset && hostEl.dataset.entityPath === entityPath) {
      hostEl.dataset.lastSavedMd = (res && res.savedMd != null) ? res.savedMd : md;
      if (target.mode === 'value') hostEl.dataset.lastSavedRevision = (res && res.revision != null) ? String(res.revision) : revision;
      else {
        hostEl.dataset.lastSavedEtag = (res && res.etag) || etag;
        if (res?.transport_revision && coordinator.normalizeTransportRevision) {
          hostEl.dataset.lastSavedTransportRevision = coordinator.normalizeTransportRevision(
            coordinator.currentTransportName(),
            res.transport_revision,
          );
        }
      }
    }
    if (res) coordinator.bindDocumentIdentity?.(target.path, res);
    return true;
  } catch (error) {
    if (error?.status === 409 || error?.meldexCode === 'etag_conflict') {
      coordinator.reportConflict(documentKey, {
        path: target.path,
        localMd: md,
        localEtag: target.mode === 'value' ? revision : etag,
        serverDetail: (error && error.meldexDetail && typeof error.meldexDetail === 'object') ? error.meldexDetail : null,
      });
      _entityFreeTextShowConflictPending(hostEl, entityPath, documentKey);
    }
    throw error;
  }
}

function _setEntityCreateActionButton(button, iconName, label) {
  if (!button) return;
  button.type = 'button';
  button.className = 'entity-create-action-btn';
  button.setAttribute('aria-label', label);
  button.textContent = '';
  if (typeof lucide === 'function') {
    const icon = document.createElement('span');
    icon.className = 'entity-create-action-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = lucide(iconName, 14);
    button.appendChild(icon);
  }
  const text = document.createElement('span');
  text.className = 'entity-create-action-label';
  text.textContent = label;
  button.appendChild(text);
}

function renderEntityPage(data) {
  // data = {entity, properties: {propName: [{value, status, note, file, ...}]}, page_content}
  if (window.MeldexEntityDetail?.mount) {
    const entityPath = state.currentEntityPath;
    const controller = window.MeldexEntityDetail.mount({
      root: document.getElementById('entity-view'),
      path: entityPath,
      surface: 'main',
      data,
    });
    controller.ready.then((mounted) => {
      if (!mounted || state.currentEntityPath !== entityPath) return;
      if (typeof _renderEntityActions === 'function') _renderEntityActions(data, entityPath);
      if (typeof _renderEntityBacklinks === 'function') _renderEntityBacklinks(data, entityPath);
    });
    return;
  }
  document.getElementById('entity-title').textContent = data.entity || '';

  const entityPath = state.currentEntityPath;
  const parentDb = _entityParentDir(entityPath);

  // 親 DB へのリンク
  const linkBox = document.getElementById('entity-parent-link');
  if (linkBox) {
    linkBox.innerHTML = '';
    if (parentDb) {
      const parentName = parentDb.split('/').pop() || parentDb;
      const a = document.createElement('a');
      a.textContent = '← ' + parentName;
      a.title = parentDb;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof selectDatabase === 'function') selectDatabase(parentDb);
      });
      linkBox.appendChild(a);
    }
  }

  // プロパティグリッド描画 (共通関数を使用)
  const grid = document.getElementById('entity-props-grid');
  if (grid) {
    renderEntityPropsGridInto(grid, data, entityPath, { parentDb });
  }

  // ノートエリア (entity-freetext): page_content が空なら隠して「ノートを作成」ボタン表示
  const ft = document.getElementById('entity-freetext');
  const noteBtnBox = document.getElementById('entity-create-note-btn');
  const rtToolbar = document.getElementById('entity-rt-toolbar');
  const rawContent = data.page_content || '';
  const hasNote = rawContent.trim() !== '';
  if (ft) ft.dataset.entityNoteCreated = hasNote ? '1' : '0';
  if (noteBtnBox) {
    noteBtnBox.innerHTML = '';
    const chatBtn = document.createElement('button');
    _setEntityCreateActionButton(chatBtn, 'messageSquare', 'チャットを作成');
    chatBtn.dataset.e2eId = 'entity-create-chat';
    chatBtn.addEventListener('click', () => {
      if (typeof window.openEntityChatForPath === 'function') {
        window.openEntityChatForPath(entityPath);
      } else if (typeof openFileChat === 'function') {
        openFileChat(entityPath);
      }
    });
    if (!hasNote) {
      ft.style.display = 'none';
      if (rtToolbar) rtToolbar.style.display = 'none';
      const btn = document.createElement('button');
      _setEntityCreateActionButton(btn, 'filePlus', 'ノートを作成');
      btn.dataset.e2eId = 'entity-create-note';
      btn.addEventListener('click', () => {
        // ノートを作成: 空のコンテンツで初期化、エディタを表示
        ft.style.display = '';
        ft.dataset.entityNoteCreated = '1';
        if (rtToolbar) rtToolbar.style.display = '';
        ft.innerHTML = '<p><br></p>';
        noteBtnBox.style.display = 'none';
        // 即時保存 (空ノートを作成)
        const ep = ft.dataset.entityPath;
        if (ep) {
          _saveEntityFreeText(ft, ep, '', { reason: 'entity-freetext-create' }).catch(() => { showStatus('自由記述の作成に失敗しました', true); });
        }
        ft.focus();
      });
      noteBtnBox.appendChild(btn);
      noteBtnBox.appendChild(chatBtn);
      noteBtnBox.style.display = '';
    } else {
      noteBtnBox.appendChild(chatBtn);
      noteBtnBox.style.display = '';
      ft.style.display = '';
      if (rtToolbar) rtToolbar.style.display = '';
    }
  }

  // Free text (with auto-links)
  ft.dataset.entityPath = entityPath;
  // 工程2-C項目5・6: 読込直後の保存済みbaseline（内容+revision/etag）をdatasetへ保持し、
  // 文書ID単位のarbiterへ参加登録する（新形式=revision、旧形式=freetext_etagのどちらか）。
  ft.dataset.lastSavedMd = hasNote ? rawContent : '';
  ft.dataset.lastSavedRevision = (data.revision != null) ? String(data.revision) : '';
  ft.dataset.lastSavedEtag = data.freetext_etag || '';
  ft.dataset.lastSavedTransportRevision = '';
  _bindEntityFreeTextParticipant(ft, entityPath);
  // Markdown→HTML変換してからauto-link適用 (rawContent は冒頭で取得済み)
  if (hasNote) {
    const ftHtml = applyAutoLinks(mdToHtml(rawContent, { basePath: entityPath }), entityPath);
    ft.innerHTML = ftHtml;
  } else {
    // ノート未作成時はエディタ自体を非表示にしているため innerHTML 不要
    ft.innerHTML = '';
  }

  if (ft._autoLinkHandler) ft.removeEventListener('click', ft._autoLinkHandler);
  if (ft._autoLinkDblHandler) { ft.removeEventListener('dblclick', ft._autoLinkDblHandler); ft._autoLinkDblHandler = null; }
  ft._autoLinkHandler = function(e) {
    const link = e.target.closest('.auto-link');
    if (link) { e.preventDefault(); onAutoLinkClick(link, e); }
  };
  ft.addEventListener('click', ft._autoLinkHandler);

  // 自動保存タイマー（2秒デバウンス）
  ft.oninput = function() {
    clearTimeout(window._ftAutoSaveTimer);
    window._ftAutoSaveTimer = setTimeout(() => {
      if (ft.textContent.trim() === '自由記述エリア（クリックして編集）') return;
      const md = htmlToMd(ft.innerHTML);
      const ep = ft.dataset.entityPath;
      if (!ep) return;
      _saveEntityFreeText(ft, ep, md, { reason: 'entity-freetext-auto' }).catch(() => { showStatus('自由記述の自動保存に失敗しました', true); });
    }, 2000);
  };

  ft.onblur = async function() {
    clearTimeout(window._ftAutoSaveTimer);
    if (this.textContent.trim() === '自由記述エリア（クリックして編集）') return;
    // 検索ハイライトのmarkタグを除去
    this.querySelectorAll('mark.file-search-highlight').forEach(m => m.replaceWith(...m.childNodes));
    this.normalize();

    const md = htmlToMd(this.innerHTML);

    const ep = this.dataset.entityPath;
    if (!ep) return;
    try {
      const saved = await _saveEntityFreeText(this, ep, md, { reason: 'entity-freetext-blur' });
      if (!saved) return;
      showStatus('自由記述を保存しました', false, { passiveSave: true });
      this.innerHTML = applyAutoLinks(mdToHtml(md, { basePath: ep }), ep);
    } catch (e) { showStatus('自由記述の保存に失敗しました', true); }
  };

  // DBアクションボタン + バックリンク表示（gb-db-actions.js）
  if (typeof _renderEntityActions === 'function') _renderEntityActions(data, entityPath);
  if (typeof _renderEntityBacklinks === 'function') _renderEntityBacklinks(data, entityPath);
}

/* ==============================
   カスタムアンドゥ（execCommandが効かないDOM操作用）
   ============================== */
/* ヒストリー（Undo/Redo）→ gb-history.js に移動 */

// 既存のcontenteditable用カスタムundo
const _CUSTOM_UNDO_MAX = 50;
function _pushCustomUndo(editable) {
  if (!editable._customUndoStack) editable._customUndoStack = [];
  if (!editable._customRedoStack) editable._customRedoStack = [];
  editable._customUndoStack.push(editable.innerHTML);
  if (editable._customUndoStack.length > _CUSTOM_UNDO_MAX) editable._customUndoStack.shift();
  editable._customRedoStack.length = 0; // redo履歴をクリア
  editable._lastCustomOp = true;
  editable._customUndoInputPending = true;
}

let _customUndoInProgress = false; // dispatchEvent中のinputリスナーを抑制
document.addEventListener('keydown', function(e) {
  if (!e.ctrlKey) return;
  const editable = document.activeElement;
  if (!editable || editable.contentEditable !== 'true') return;

  // Ctrl+Z: カスタムアンドゥ（直前がカスタム操作の場合のみ）
  if (e.key === 'z' && !e.shiftKey && editable._lastCustomOp && editable._customUndoStack && editable._customUndoStack.length > 0) {
    e.preventDefault();
    // innerHTML の総入れ替えはスクロール位置を捨てるため、前後で退避・復元する
    const scroll = window.MeldexNoteRuby?.captureScroll?.(editable);
    editable._customRedoStack.push(editable.innerHTML);
    editable.innerHTML = editable._customUndoStack.pop();
    editable._lastCustomOp = editable._customUndoStack.length > 0;
    _customUndoInProgress = true;
    editable.dispatchEvent(new Event('input', { bubbles: true }));
    _customUndoInProgress = false;
    window.MeldexNoteRuby?.restoreScroll?.(scroll);
    return;
  }
  // Ctrl+Y / Ctrl+Shift+Z: カスタムリドゥ
  if ((e.key === 'y' || (e.key === 'z' && e.shiftKey)) && editable._customRedoStack && editable._customRedoStack.length > 0) {
    e.preventDefault();
    const scroll = window.MeldexNoteRuby?.captureScroll?.(editable);
    editable._customUndoStack.push(editable.innerHTML);
    editable.innerHTML = editable._customRedoStack.pop();
    editable._lastCustomOp = true;
    _customUndoInProgress = true;
    editable.dispatchEvent(new Event('input', { bubbles: true }));
    _customUndoInProgress = false;
    window.MeldexNoteRuby?.restoreScroll?.(scroll);
    return;
  }
}, true); // captureフェーズで先に処理

// 通常の入力でカスタムフラグをクリア（以降のCtrl+Zはネイティブアンドゥに委譲）
document.addEventListener('input', function(e) {
  if (_customUndoInProgress) return; // カスタムundo/redoの自動保存トリガーは無視
  const editable = e.target;
  if (editable && editable.contentEditable === 'true') {
    if (editable._customUndoInputPending) {
      editable._customUndoInputPending = false;
      editable._lastCustomOp = true;
      return;
    }
    editable._lastCustomOp = false;
  }
});

/* ==============================
   リッチテキスト
   ============================== */
let rtTarget = null;
let rtSavedSelection = null;

function _rtEditableFromNode(node) {
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  const editable = el?.closest?.('#page-content, #entity-freetext, #dp-editable, .meldex-entity-detail-editor') || null;
  if (!editable || editable.contentEditable !== 'true') return null;
  return editable;
}

function _rtSelectionEditable(range) {
  const editable = _rtEditableFromNode(range?.commonAncestorContainer);
  if (!editable || !range) return null;
  if (!editable.contains(range.startContainer) || !editable.contains(range.endContainer)) return null;
  return editable;
}

function rtCaptureSelectionFromToolbar() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0).cloneRange();
  const editable = _rtSelectionEditable(range);
  if (!editable) return false;
  rtSavedSelection = range;
  rtTarget = editable;
  return true;
}

function rtRestoreSelection() {
  if (rtTarget && !rtTarget.isConnected) {
    rtTarget = null;
    rtSavedSelection = null;
    return;
  }
  if (rtTarget) rtTarget.focus();
  if (rtSavedSelection && _rtSelectionEditable(rtSavedSelection)) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(rtSavedSelection);
  }
}

function _rtEnsureEditableSelection() {
  rtRestoreSelection();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const editable = _rtSelectionEditable(range);
  if (!editable) return null;
  rtTarget = editable;
  rtSavedSelection = range.cloneRange();
  return editable;
}

function _rtBlockAtSelection(editable) {
  const sel = window.getSelection();
  if (!editable || !sel || sel.rangeCount === 0) return null;
  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  const block = node?.closest?.('h1,h2,h3,h4,h5,h6,p,div,blockquote,pre,li');
  if (!block || block === editable || !editable.contains(block)) return null;
  if (block.tagName === 'PRE' || block.closest('table, pre, code')) return null;
  return block;
}

function _rtReplaceBlockTag(block, tag) {
  if (!block || block.tagName === tag) return block;
  const next = document.createElement(tag.toLowerCase());
  while (block.firstChild) next.appendChild(block.firstChild);
  block.replaceWith(next);
  return next;
}

function _rtPlaceCaretInBlock(block) {
  if (!block) return;
  if (!block.childNodes.length) block.appendChild(document.createElement('br'));
  const range = document.createRange();
  range.selectNodeContents(block);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  rtSavedSelection = range.cloneRange();
}

function _rtDispatchEditableInput(editable) {
  if (!editable) return;
  editable.dispatchEvent(new Event('input', { bubbles: true }));
  const toc = document.getElementById('note-toc');
  if (toc && toc.style.display !== 'none' && typeof updateNoteToc === 'function') updateNoteToc();
}

function _rtClearNoteTitleAtSelection(editable) {
  const block = _rtBlockAtSelection(editable);
  if (!block) return;
  block.classList.remove('note-title');
  delete block.dataset.noteTitle;
}

function _rtApplyNoteTitle() {
  const editable = _rtEnsureEditableSelection();
  if (!editable) return;
  if (typeof _pushCustomUndo === 'function') _pushCustomUndo(editable);
  let block = _rtBlockAtSelection(editable);
  if (!block) {
    document.execCommand('formatBlock', false, 'H1');
    block = _rtBlockAtSelection(editable);
  }
  if (!block) return;
  block = _rtReplaceBlockTag(block, 'H1');
  block.classList.add('note-title');
  block.dataset.noteTitle = '1';
  _rtPlaceCaretInBlock(block);
  _rtDispatchEditableInput(editable);
}

function rtCmd(cmd, value) {
  const editable = _rtEnsureEditableSelection();
  if (!editable) return;
  document.execCommand(cmd, false, value || null);
  if (cmd === 'formatBlock') _rtClearNoteTitleAtSelection(editable);
}

function rtColor(cmd, value) {
  if (!_rtEnsureEditableSelection()) return;
  document.execCommand(cmd, false, value);
}

function openRtColorPalette(anchorEl, cmd) {
  if (!anchorEl || typeof openColorPalette !== 'function') return;
  const currentColor = getColorSwatchValue(anchorEl, anchorEl.dataset.rtColor || '');
  openColorPalette(anchorEl, currentColor, (color) => {
    const appliedColor = color || anchorEl.dataset.rtColor || (cmd === 'hiliteColor' ? '#1e1e1e' : '#d4d4d4');
    document.querySelectorAll(`.rt-color-swatch[data-rt-cmd="${cmd}"]`).forEach((swatch) => {
      swatch.dataset.rtColor = appliedColor;
      setColorSwatchValue(swatch, appliedColor);
    });
    rtColor(cmd, appliedColor);
  });
}

function syncRtToolbarColorSwatches(root) {
  (root || document).querySelectorAll('.rt-color-swatch').forEach((swatch) => {
    const color = swatch.dataset.rtColor || getColorSwatchValue(swatch, '');
    setColorSwatchValue(swatch, color);
  });
}

function rtHeading(tag) {
  if (!tag) return;
  if (String(tag).toUpperCase() === 'TITLE') {
    _rtApplyNoteTitle();
    return;
  }
  const editable = _rtEnsureEditableSelection();
  if (!editable) return;
  document.execCommand('formatBlock', false, tag);
  _rtClearNoteTitleAtSelection(editable);
}

function showRtToolbar(show) {
  const el = document.getElementById('rt-toolbar');
  if (el) el.style.display = show ? '' : 'none';
}

setTimeout(() => syncRtToolbarColorSwatches(), 0);

// === コールアウトブロック ===
const CALLOUT_PRESETS = [
  { icon: 'lightbulb', color: '#e6a700', type: '', label: 'ヒント' },
  { icon: 'circleAlert', color: '#3898ec', type: 'info', label: '情報' },
  { icon: 'alertTriangle', color: '#ecb438', type: 'warning', label: '注意' },
  { icon: 'zap', color: '#ec3838', type: 'danger', label: '重要' },
  { icon: 'checkSquare', color: '#38b450', type: 'success', label: '完了' },
  { icon: 'pencil', color: '', type: '', label: '注釈' },
  { icon: 'messageSquare', color: '#9b59b6', type: '', label: '考察' },
  { icon: 'crosshair', color: '#e67e22', type: '', label: '目標' },
  { icon: 'mapPin', color: '#e74c3c', type: '', label: 'ピン' },
  { icon: 'bookmark', color: '#1abc9c', type: '', label: 'ブックマーク' },
];

function insertNoteTable(rows = 3, cols = 3) {
  const editable = document.activeElement?.closest('#page-content, #entity-freetext, #dp-editable')
                || document.getElementById('page-content');
  if (!editable) return;
  editable.focus();
  // 既存セレクションがあればそこに挿入、無ければ末尾に追加
  let html = '<table><thead><tr>';
  for (let c = 0; c < cols; c++) html += '<th>列' + (c + 1) + '</th>';
  html += '</tr></thead><tbody>';
  for (let r = 0; r < rows - 1; r++) {
    html += '<tr>';
    for (let c = 0; c < cols; c++) html += '<td></td>';
    html += '</tr>';
  }
  html += '</tbody></table><p><br></p>';
  // execCommand で挿入 (undo 対応)
  if (document.queryCommandSupported && document.queryCommandSupported('insertHTML')) {
    document.execCommand('insertHTML', false, html);
  } else {
    editable.insertAdjacentHTML('beforeend', html);
  }
  editable.dispatchEvent(new Event('input'));
}

function insertCallout() {
  const editable = document.activeElement?.closest('#page-content, #entity-freetext, #dp-editable');
  if (!editable) return;
  const insertRange = (rtTarget === editable && rtSavedSelection && _rtSelectionEditable(rtSavedSelection))
    ? rtSavedSelection.cloneRange()
    : null;
  const btns = document.querySelectorAll('[data-action="insertCallout()"]');
  let btn = null;
  for (const b of btns) { if (b.offsetParent !== null) { btn = b; break; } }
  if (typeof GBIconAssets === 'undefined') {
    _insertCalloutBlock(editable, 'lightbulb', '', '#e6a700', insertRange);
    return;
  }
  GBIconAssets.openPicker({
    title: 'コールアウトアイコン',
    className: 'callout-picker',
    anchorEl: btn || editable,
    includeLucide: true,
    includeNoto: true,
    presets: CALLOUT_PRESETS.map((p) => ({ ...p, spec: p.icon })),
    onSelect: (spec, item) => {
      _insertCalloutBlock(editable, spec, item?.type || '', item?.color || '', insertRange);
    },
  });
}

function _insertCalloutBlock(editable, iconName, type, color, insertRange) {
  editable.focus();
  if (insertRange && _rtSelectionEditable(insertRange)) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(insertRange);
  }
  const cls = type ? ' callout-' + type : '';
  const colorStyle = color ? ' style="color:' + esc(color) + ';"' : '';
  const spec = typeof GBIconAssets !== 'undefined' ? GBIconAssets.normalizeSpec(iconName || 'lightbulb') : iconName;
  const iconHtml = typeof GBIconAssets !== 'undefined' ? GBIconAssets.render(spec, 20) : lucide(iconName, 20);
  const html = `<div class="callout-block${cls}" contenteditable="false"><span class="callout-icon" data-icon="${esc(spec)}"${color ? ' data-color="' + esc(color) + '"' : ''} title="アイコンをクリックして変更"${colorStyle}>${iconHtml}</span><div class="callout-body" contenteditable="true">ここにテキストを入力...</div></div><p><br></p>`;
  document.execCommand('insertHTML', false, html);
  setTimeout(() => {
    const blocks = editable.querySelectorAll('.callout-block');
    const last = blocks[blocks.length - 1];
    if (last) {
      const body = last.querySelector('.callout-body');
      if (body) { body.focus(); const s = window.getSelection(); s.selectAllChildren(body); s.collapseToEnd(); }
    }
  }, 50);
}

function _calloutPresetForSpec(spec) {
  if (typeof GBIconAssets === 'undefined') {
    return CALLOUT_PRESETS.find(p => p.icon === spec) || null;
  }
  return CALLOUT_PRESETS.find(p => GBIconAssets.sameSpec(p.icon, spec)) || null;
}

function _dispatchCalloutInput(iconEl) {
  const editable = iconEl?.closest?.('#page-content, #entity-freetext, #dp-editable');
  if (editable) editable.dispatchEvent(new Event('input', { bubbles: true }));
}

// コールアウトアイコンクリックで変更（Lucide + Noto Emoji + 色選択）
document.addEventListener('click', (e) => {
  const iconEl = e.target.closest('.callout-icon');
  if (!iconEl) return;
  e.preventDefault();
  if (typeof GBIconAssets === 'undefined') return;

  function applyIcon(spec, color) {
    const normalized = GBIconAssets.normalizeSpec(spec);
    iconEl.innerHTML = GBIconAssets.render(normalized, 20);
    iconEl.dataset.icon = normalized;
    iconEl.dataset.color = color || '';
    iconEl.style.color = color || '';
    const block = iconEl.closest('.callout-block');
    // プリセットに一致するtypeがあれば適用
    if (block) {
      const preset = _calloutPresetForSpec(normalized);
      block.className = 'callout-block' + (preset?.type ? ' callout-' + preset.type : '');
    }
    _dispatchCalloutInput(iconEl);
  }

  GBIconAssets.openPicker({
    title: 'コールアウトアイコン',
    className: 'callout-picker',
    anchorEl: iconEl,
    current: iconEl.dataset.icon || '',
    includeLucide: true,
    includeNoto: true,
    presets: CALLOUT_PRESETS.map((p) => ({ ...p, spec: p.icon })),
    onSelect: (spec, item) => applyIcon(spec, item?.color || iconEl.dataset.color || ''),
    extraFooter: () => {
      const colorWrap = document.createElement('div');
      colorWrap.style.cssText = 'padding-top:6px;border-top:1px solid var(--border);display:flex;align-items:center;gap:6px;flex-shrink:0;';
      colorWrap.innerHTML = '<span style="font-size:11px;color:var(--fg2);">色</span>';
      if (typeof createInlineColorGrid === 'function') {
        const curColor = iconEl.dataset.color || '';
        const cg = createInlineColorGrid(curColor, (c) => {
          iconEl.style.color = c || '';
          iconEl.dataset.color = c || '';
          _dispatchCalloutInput(iconEl);
        });
        cg.style.cssText += 'max-width:320px;';
        colorWrap.appendChild(cg);
      }
      return colorWrap;
    },
  });
});

// エントリ用リッチテキストツールバーを初期化（メインと同じボタン構成）
function _shouldAllowToolbarMouseDefault(target) {
  const editable = target?.closest?.('[contenteditable="true"], [contenteditable="plaintext-only"], [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
  if (editable) return true;
  const tag = target?.tagName;
  if (tag === 'SELECT' || tag === 'OPTION') return true;
  if (tag === 'INPUT') {
    const type = String(target.type || '').toLowerCase();
    return ['color', 'range', 'number', 'text', 'search'].includes(type);
  }
  if (tag === 'TEXTAREA') return true;
  return false;
}

(function() {
  const src = document.getElementById('rt-toolbar');
  const dst = document.getElementById('entity-rt-toolbar');
  if (!src || !dst) return;
  dst.innerHTML = src.innerHTML;
  // イベントを複製（data-actionはインラインなのでそのまま動く）
  // mousedownでフォーカスを奪わないようにする
  dst.addEventListener('mousedown', function(e) {
    rtCaptureSelectionFromToolbar();
    if (_shouldAllowToolbarMouseDefault(e.target)) return;
    e.preventDefault();
  });
})();

document.getElementById('rt-toolbar').addEventListener('mousedown', function(e) {
  rtCaptureSelectionFromToolbar();
  if (_shouldAllowToolbarMouseDefault(e.target)) return;
  e.preventDefault();
});

// page-view内の専用ツールバー（#page-rt-toolbar）にも同じmousedownハンドラ
{
  const pageRtTb = document.getElementById('page-rt-toolbar');
  if (pageRtTb) pageRtTb.addEventListener('mousedown', function(e) {
    rtCaptureSelectionFromToolbar();
    if (_shouldAllowToolbarMouseDefault(e.target)) return;
    e.preventDefault();
  });
}

document.addEventListener('focusin', function(e) {
  if (e.target.id === 'entity-freetext' || e.target.id === 'page-content' || e.target.id === 'dp-editable') {
    rtTarget = e.target;
  }
});
// ツールバーはshowViewで表示/非表示を制御（focusoutでは閉じない）

/* ==============================
   自動リンク
   ============================== */
// linkDict は MeldexAutoLink に委譲。互換性のためゲッターを提供
let linkDict = typeof MeldexAutoLink !== 'undefined' ? MeldexAutoLink.getDict() : [];

// 作品フォルダ設定
const WORK_FOLDER_KEY = 'outliner-work-folder';
const WORK_FOLDER_ID_KEY = 'outliner-work-folder-id';
function getWorkFolder() {
  // file_id から最新パスを解決（gb-app.js より先に呼ばれる可能性があるためガード）
  const fid = localStorage.getItem(WORK_FOLDER_ID_KEY);
  if (fid && typeof _fileIdToPath === 'function') {
    const resolved = _fileIdToPath(fid);
    if (resolved) return resolved;
  }
  return localStorage.getItem(WORK_FOLDER_KEY) || '';
}
function setWorkFolder(path) {
  if (path) {
    localStorage.setItem(WORK_FOLDER_KEY, path);
    const fid = typeof _pathToFileId === 'function' ? _pathToFileId(path) : '';
    if (fid) localStorage.setItem(WORK_FOLDER_ID_KEY, fid);
  } else {
    localStorage.removeItem(WORK_FOLDER_KEY);
    localStorage.removeItem(WORK_FOLDER_ID_KEY);
  }
}

async function loadLinkDict() {
  if (typeof MeldexAutoLink !== 'undefined') {
    await MeldexAutoLink.loadDict(getWorkFolder());
    linkDict = MeldexAutoLink.getDict();
  } else {
    try {
      const work = getWorkFolder();
      const url = work ? '/link-dict?work=' + encodeURIComponent(work) : '/link-dict';
      const data = await apiFetch(url);
      linkDict = data.entries || [];
    } catch (e) { linkDict = []; }
  }
}

function applyAutoLinks(html, filePath, options = {}) {
  if (typeof MeldexAutoLink !== 'undefined') return MeldexAutoLink.applyToHtml(html, filePath, options);
  return html;
}

function stripAutoLinks(html) {
  if (typeof MeldexAutoLink !== 'undefined') return MeldexAutoLink.stripFromHtml(html);
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('.auto-link').forEach(el => el.replaceWith(...el.childNodes));
  return div.innerHTML;
}

/* ==============================
   Markdown ↔ HTML 変換
   ============================== */
// options.basePath: 本文が属するノートのパス。相対メディアパス（WebClipperのクリップ本文など）を
// 解決する基準になる。省略した場合は従来どおり src をそのまま出力する。
function mdToHtml(md, options) {
  if (!md) return '';
  const _prevMediaBasePath = _mdMediaBasePath;
  _mdMediaBasePath = String((options && options.basePath) || '');
  try {
