/* 値セルUI・ドロップダウン共通 — gb-database.js から分離 */

function _cellUiValueToString(value) {
  return value == null ? '' : String(value);
}

function _dbRichEscapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _dbRichComparableText(text) {
  return String(text == null ? '' : text)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _dbRichPlainTextToHtml(text) {
  return _dbRichEscapeHtml(text).replace(/\r\n?/g, '\n').replace(/\n/g, '<br>');
}

function _dbRichStyleValueSafe(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const lower = raw.toLowerCase().replace(/\s+/g, '');
  return !lower.includes('url(')
    && !lower.includes('expression(')
    && !lower.includes('javascript:')
    && !lower.includes('behavior:')
    && !raw.includes('<')
    && !raw.includes('>');
}

function _dbRichCopySafeStyles(source, target) {
  if (!source?.style || !target?.style) return;
  const styleProps = [
    'color',
    'backgroundColor',
    'fontSize',
    'fontFamily',
    'fontWeight',
    'fontStyle',
    'webkitTextStrokeColor',
    'webkitTextStrokeWidth',
    'paintOrder',
    'textDecorationLine',
    'textDecorationColor',
    'borderLeft',
    'paddingLeft',
  ];
  styleProps.forEach(prop => {
    const value = source.style[prop];
    if (value && _dbRichStyleValueSafe(value)) target.style[prop] = value;
  });
}

function _dbRichSanitizeHtml(rawHtml) {
  const raw = String(rawHtml || '');
  if (!raw || typeof document === 'undefined') return '';
  const template = document.createElement('template');
  template.innerHTML = raw;
  const out = document.createElement('div');
  const allowedInline = new Set(['span', 'b', 'strong', 'i', 'em', 'u']);
  const blocked = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'svg', 'math']);

  const appendChildren = (source, parent) => {
    Array.from(source.childNodes || []).forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        parent.appendChild(document.createTextNode(node.textContent || ''));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = String(node.tagName || '').toLowerCase();
      if (blocked.has(tag)) return;
      if (tag === 'br') {
        parent.appendChild(document.createElement('br'));
        return;
      }
      if (tag === 'div' || tag === 'p') {
        if (parent.childNodes.length) parent.appendChild(document.createElement('br'));
        appendChildren(node, parent);
        return;
      }
      if (!allowedInline.has(tag)) {
        if (tag === 'font') {
          const cleanFont = document.createElement('span');
          const color = node.getAttribute('color') || '';
          const face = node.getAttribute('face') || '';
          if (_dbRichStyleValueSafe(color)) cleanFont.style.color = color;
          if (_dbRichStyleValueSafe(face)) cleanFont.style.fontFamily = face;
          _dbRichCopySafeStyles(node, cleanFont);
          appendChildren(node, cleanFont);
          if (cleanFont.childNodes.length) parent.appendChild(cleanFont);
          return;
        }
        appendChildren(node, parent);
        return;
      }
      const clean = document.createElement(tag);
      _dbRichCopySafeStyles(node, clean);
      appendChildren(node, clean);
      if (clean.childNodes.length) parent.appendChild(clean);
    });
  };

  appendChildren(template.content, out);
  return out.innerHTML;
}

function _dbRichTextFromSanitizedHtml(sanitizedHtml) {
  if (!sanitizedHtml || typeof document === 'undefined') return '';
  const div = document.createElement('div');
  div.innerHTML = sanitizedHtml;
  const collect = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = String(node.tagName || '').toLowerCase();
    if (tag === 'br') return ' ';
    const text = Array.from(node.childNodes || []).map(collect).join('');
    return (tag === 'div' || tag === 'p') ? (' ' + text + ' ') : text;
  };
  return collect(div);
}

function _dbRichHtmlForValue(val) {
  const sanitized = _dbRichSanitizeHtml(val?.rich_html || '');
  if (!sanitized) return '';
  const htmlText = _dbRichComparableText(_dbRichTextFromSanitizedHtml(sanitized));
  const valueText = _dbRichComparableText(_cellUiValueToString(val?.value));
  return htmlText && htmlText === valueText ? sanitized : '';
}

function _dbRichHtmlHasFormatting(sanitizedHtml) {
  if (!sanitizedHtml || typeof document === 'undefined') return false;
  const div = document.createElement('div');
  div.innerHTML = sanitizedHtml;
  return !!div.querySelector('[style], b, strong, i, em, u');
}

function _dbRichTextFromEditable(editor) {
  const text = typeof editor?.innerText === 'string' ? editor.innerText : (editor?.textContent || '');
  return String(text || '').replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n');
}

function _dbRichAppendValuePreview(parent, vals, options = {}) {
  if (!parent) return;
  const sep = options.separator == null ? ', ' : String(options.separator);
  (vals || []).forEach((val, index) => {
    if (index > 0) parent.appendChild(document.createTextNode(sep));
    const richHtml = _dbRichHtmlForValue(val);
    const span = document.createElement('span');
    span.className = richHtml ? 'db-rich-value-preview' : 'db-plain-value-preview';
    if (richHtml) span.innerHTML = richHtml;
    else span.textContent = _cellUiValueToString(val?.value);
    parent.appendChild(span);
  });
}

function _setupCellValueDrag(row, val, entityPath, propName) {
  row.draggable = true;
  row.dataset.cvDragValue = _cellUiValueToString(val.value);
  row.dataset.cvDragEntityPath = entityPath;
  row.dataset.cvDragPropName = propName;
}

function _cellUiAutoLinkScopePath(entityPath) {
  const dbPath = (typeof state !== 'undefined' && state?.currentDbPath) ? state.currentDbPath : '';
  return dbPath || entityPath || '';
}

function _cellUiApplyAutoLinks(el, rawText, entityPath) {
  if (!el || typeof MeldexAutoLink === 'undefined' || String(rawText || '').length < 2) return false;
  MeldexAutoLink.applyToDom(el, _cellUiAutoLinkScopePath(entityPath));
  return !!el.querySelector('.auto-link');
}

function _cellUiClosestFromEvent(e, selector) {
  const target = e?.target;
  return target && typeof target.closest === 'function' ? target.closest(selector) : null;
}

function _cellUiHandleAutoLinkClick(e) {
  const al = _cellUiClosestFromEvent(e, '.auto-link');
  if (!al || typeof onAutoLinkClick !== 'function') return false;
  e.stopPropagation();
  onAutoLinkClick(al, e);
  return true;
}

// document レベルの委譲ハンドラ (1 回だけ登録)
function _ensureCellValueDragDelegate() {
  if (globalThis.__gbCellValueDragInstalled) return;
  document.addEventListener('dragstart', (e) => {
    const row = _cellUiClosestFromEvent(e, '.cell-value[draggable]');
    if (!row || row.dataset.cvDragEntityPath === undefined) return;
    e.stopPropagation();
    const value = row.dataset.cvDragValue || '';
    const entityPath = row.dataset.cvDragEntityPath || '';
    const propName = row.dataset.cvDragPropName || '';
    const label = propName + ': ' + value;
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', value);
    e.dataTransfer.setData('application/x-meldex-node', JSON.stringify({
      name: label, path: entityPath, type: 'entity'
    }));
    row.classList.add('dragging');
  });
  document.addEventListener('dragend', (e) => {
    const row = _cellUiClosestFromEvent(e, '.cell-value[draggable]');
    if (row) row.classList.remove('dragging');
  });
  globalThis.__gbCellValueDragInstalled = true;
}
// 即時登録 (gb-database.js ロード時に有効化)
if (typeof document !== 'undefined') _ensureCellValueDragDelegate();

function createValueElement(val, entityPath, propName, thumbSize) {
  const row = document.createElement('div');
  row.className = 'cell-value' + (val.status === 'ボツ' ? ' status-botsu' : '');
  row.style.position = 'relative';
  _setupCellValueDrag(row, val, entityPath, propName);

  // ホバー時の「...」メニューボタン
  const moreBtn = document.createElement('span');
  moreBtn.className = 'cell-value-more';
  moreBtn.style.cssText = 'position:absolute;right:2px;top:50%;transform:translateY(-50%);display:none;cursor:pointer;padding:0 2px;color:var(--fg2);font-size:11px;background:var(--bg3);border-radius:3px;z-index:1;';
  moreBtn.innerHTML = lucide('ellipsis', 12);
  moreBtn.title = 'メニュー';
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    _showValueContextMenu(e, val, entityPath, propName);
  });
  row.appendChild(moreBtn);
  row.addEventListener('mouseenter', () => { moreBtn.style.display = ''; });
  row.addEventListener('mouseleave', () => { moreBtn.style.display = 'none'; });

  // Status dot（採用状況フィルタ無効時 or DB側でステータス機能 OFF の場合は非表示）
  if (state.filter !== 'disabled' && getStatusEnabled(state.currentDbPath)) {
    const dot = document.createElement('span');
    dot.className = 'status-dot';
    const _stColor = _getStatusColor(val.status, state.currentDbPath);
    dot.style.background = _stColor;
    dot.title = val.status || '案';
    dot.addEventListener('click', (e) => { e.stopPropagation(); showStatusDropdown(dot, val, entityPath, propName); });
    row.appendChild(dot);
  }

  const v = _cellUiValueToString(val.value);

  // URL判定
  if (/^https?:\/\/\S+$/.test(v)) {
    const link = document.createElement('a');
    link.className = 'value-url';
    link.href = v;
    link.target = '_blank';
    link.rel = 'noopener';
    // ドメインだけ表示
    try { link.textContent = new URL(v).hostname + '…'; } catch { link.textContent = v; }
    link.addEventListener('click', (e) => e.stopPropagation());
    row.appendChild(link);
    return row;
  }

  // 画像サムネイル判定
  if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(v)) {
    const img = document.createElement('img');
    img.className = 'cell-thumbnail' + (thumbSize === 'large' ? ' large' : '');
    img.src = '/api/file-raw?path=' + encodeURIComponent(entityPath + '/' + v);
    img.alt = v;
    img.onerror = () => { img.replaceWith(document.createTextNode(v)); };
    img.addEventListener('click', (e) => { e.stopPropagation(); });
    row.appendChild(img);
    return row;
  }

  // マルチセレクト判定（カンマ区切り値）
  if (propName.startsWith('タグ') || propName === 'tags' || (v.includes(',') && v.split(',').every(s => s.trim().length < 30))) {
    const tags = v.split(',').map(s => s.trim()).filter(Boolean);
    if (tags.length > 1) {
      const tagContainer = document.createElement('div');
      tagContainer.className = 'multi-select-tags';
      tags.forEach(t => {
        const tag = document.createElement('span');
        tag.className = 'multi-select-tag';
        tag.textContent = t;
        if (_cellUiApplyAutoLinks(tag, t, entityPath)) {
          tag.addEventListener('click', (e) => { _cellUiHandleAutoLinkClick(e); });
        }
        tagContainer.appendChild(tag);
      });
      row.appendChild(tagContainer);
      return row;
    }
  }

  // 通常テキスト（カスタム数値単位対応）
  const txt = document.createElement('span');
  txt.className = 'value-text';
  const richHtml = _dbRichHtmlForValue(val);
  if (richHtml) {
    txt.classList.add('value-text--rich');
    txt.innerHTML = richHtml;
  } else {
    txt.textContent = v;
  }
  // DB セル内の自動リンク適用
  if (_cellUiApplyAutoLinks(txt, v, entityPath)) {
    // auto-link がある場合はクリックハンドラを分岐
    txt.addEventListener('click', (e) => {
      if (_cellUiHandleAutoLinkClick(e)) return;
      startInlineEdit(txt, val, entityPath, propName);
    });
  } else {
    txt.addEventListener('click', () => startInlineEdit(txt, val, entityPath, propName));
  }
  row.appendChild(txt);

  // 数値+単位: frontmatterにunit指定がある場合は表示（将来拡張用。現状はnoteフィールドに"unit:ページ"形式で指定可）
  if (val.note && val.note.startsWith('unit:')) {
    const unit = document.createElement('span');
    unit.className = 'value-unit';
    unit.textContent = val.note.substring(5);
    row.appendChild(unit);
  }

  return row;
}

function _showValueContextMenu(e, val, entityPath, propName) {
  document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  const sourcePaneId = e?.target?.closest?.('.gb-pane')?.dataset?.paneId || '';
  // 上部にリネーム入力欄: 値テキストを変更
  if (typeof _addMenuRenameInput === 'function') {
    const old = _cellUiValueToString(val.value);
    const oldRichHtml = _dbRichHtmlForValue(val);
    const _menuAnchor = e?.target || null;
    _addMenuRenameInput(menu, old, async (newValue) => {
      try {
        await _apiPutValue(val, { new_value: newValue, new_rich_html: '' });
        if (typeof _dbUndoValue === 'function') _dbUndoValue(propName + ': ' + old + ' → ' + newValue, val, old, newValue, oldRichHtml, '');
        val.value = newValue;
        delete val.rich_html;
        showStatus('保存しました', false, { passiveSave: true });
        // Step 3: 部分更新化 (コンテキストメニュー値変更) — _refreshAfterCellEdit がフォールバックも内包
        if (typeof _refreshAfterCellEdit === 'function') _refreshAfterCellEdit(_menuAnchor, entityPath, propName);
        else if (state.currentDbPath) selectDatabase(state.currentDbPath, undefined, { silent: true });
      } catch (e) { showStatus('保存に失敗', true); }
    }, { placeholder: '値を変更...' });
  }
  // relation型の場合: 「リンク先を開く」を追加
  const _ptc = state.currentDbPath ? getPropertyTypes(state.currentDbPath)[propName] : null;
  if (_ptc && (_ptc.type === 'relation' || _ptc.type === 'multi-relation') && val.value) {
    // 自己参照判定: relationDb === '' (空文字) のみ自己参照。undefinedは単に未設定
    const isSelfRef = (_ptc.relationDb === '');
    const relDb = isSelfRef ? state.currentDbPath : (_ptc.relationDb || '');
    // multi-relationで複数IDがある場合は各IDを個別にメニュー項目として展開
    // relDbが解決できない場合は「リンク先を開く」を表示しない
    const ids = relDb ? String(val.value).split(',').map(s => s.trim()).filter(Boolean) : [];
    if (ids.length > 0) {
      ids.forEach(idOrName => {
        const wrapper = document.createElement('div');
        const relItem = document.createElement('div');
        relItem.className = 'gb-context-menu-item';
        const labelSpan = document.createElement('span');
        labelSpan.textContent = idOrName;
        relItem.innerHTML = lucide('link2', 14) + ' ';
        relItem.appendChild(labelSpan);
        relItem.insertAdjacentHTML('beforeend', submenuArrow());
        const sub = document.createElement('div');
        sub.className = 'gb-context-menu gb-context-submenu';
        sub.style.display = 'none';
        const openItem = document.createElement('div');
        openItem.className = 'gb-context-menu-item';
        openItem.innerHTML = lucide('externalLink', 14) + ' リンク先を開く';
        openItem.addEventListener('click', async () => {
          menu.remove();
          let name = idOrName;
          if (typeof _resolveRelationName === 'function' && relDb) {
            name = await _resolveRelationName(idOrName, relDb);
          }
          navigateToEntity(name || idOrName, relDb);
        });
        sub.appendChild(openItem);
        const rightItem = document.createElement('div');
        rightItem.className = 'gb-context-menu-item';
        rightItem.innerHTML = lucide('layers-2', 14) + ' サブパネルで開く';
        rightItem.addEventListener('click', async () => {
          menu.remove();
          let name = idOrName;
          if (typeof _resolveRelationName === 'function' && relDb) {
            name = await _resolveRelationName(idOrName, relDb);
          }
          const path = typeof _entityPath === 'function' ? _entityPath(relDb, name || idOrName) : '';
          if (path && typeof openLinkInSubPanel === 'function') openLinkInSubPanel(path, name || idOrName, { linkType: 'entity', sourcePaneId });
          else navigateToEntity(name || idOrName, relDb);
        });
        sub.appendChild(rightItem);
        attachHoverSubmenu(relItem, sub);
        wrapper.appendChild(relItem);
        wrapper.appendChild(sub);
        if (typeof _resolveRelationName === 'function' && relDb) {
          _resolveRelationName(idOrName, relDb).then(name => { labelSpan.textContent = name || idOrName; });
        }
        menu.appendChild(wrapper);
      });
      // セパレータ
      const sep = document.createElement('div');
      sep.className = 'gb-context-menu-sep';
      menu.appendChild(sep);
    }
  }
  // コメントを追加（Phase 2e-iii）
  {
    const cmtItem = document.createElement('div');
    cmtItem.className = 'gb-context-menu-item';
    cmtItem.innerHTML = '💬 コメントを追加';
    cmtItem.addEventListener('click', () => {
      menu.remove();
      if (typeof addCommentHere !== 'function') return;
      const dbPath = state.currentDbPath || '';
      // entityPath は "DBパス/エントリ名.md" 等のフルパス。tr.dataset.entityName と一致させるため
      // 拡張子を剥いだ basename を entryId にする
      let entityName = (entityPath || '').split('/').pop() || '';
      entityName = entityName.replace(/\.(md|json)$/i, '');
      const snap = _cellUiValueToString(val?.value).trim().slice(0, 120);
      addCommentHere({
        targetKind: 'sheet_cell', filePath: dbPath,
        targetRef: { file: dbPath, entryId: entityName, colId: propName },
        snapshot: snap,
      }, { anchorEl: e?.target || menu });
    });
    menu.appendChild(cmtItem);
    const cmtListItem = document.createElement('div');
    cmtListItem.className = 'gb-context-menu-item';
    cmtListItem.innerHTML = 'コメント一覧を開く';
    cmtListItem.addEventListener('click', () => {
      menu.remove();
      const dbPath = state.currentDbPath || '';
      if (dbPath && typeof CommentBadges !== 'undefined' && typeof CommentBadges.openPanelForFileComments === 'function') {
        CommentBadges.openPanelForFileComments(dbPath);
      }
    });
    menu.appendChild(cmtListItem);
    const _sep = document.createElement('div');
    _sep.className = 'gb-context-menu-sep';
    menu.appendChild(_sep);
  }
  // 削除
  const delItem = document.createElement('div');
  delItem.className = 'gb-context-menu-item';
  delItem.style.color = 'var(--red)';
  delItem.innerHTML = lucide('trash2', 14) + ' 削除';
  delItem.addEventListener('click', async () => {
    menu.remove();
    if (typeof cfConfirm === 'function') {
      const ok = await cfConfirm('この候補値を削除しますか？');
      if (!ok) return;
    } else if (typeof window !== 'undefined' && !window.confirm('この候補値を削除しますか？')) {
      return;
    }
    try {
      const currentDbPath = state.currentDbPath;
      const bidirectionalCtx = (_ptc && (_ptc.type === 'relation' || _ptc.type === 'multi-relation') && _ptc.bidirectional)
        ? { entityPath, propName, ptc: _ptc }
        : null;
      let cascadeClears = [];
      if (_ptc && (_ptc.type === 'relation' || _ptc.type === 'multi-relation')
          && typeof _clearCascadeDependentValues === 'function') {
        cascadeClears = await _clearCascadeDependentValues(entityPath, propName, _cellUiValueToString(val.value), '');
      }
      if (bidirectionalCtx && typeof _applyBidirectionalRelationSync === 'function') {
        await _applyBidirectionalRelationSync({
          sourceDbPath: currentDbPath,
          entityPath,
          propName,
          ptc: _ptc,
          oldValue: _cellUiValueToString(val.value),
          newValue: '',
        });
      }
      const candIdx = val.candidate_index;
      if (candIdx != null) {
        await _apiPutValue(val, { _delete: true });
      } else if (val.file) {
        await apiPost('/outliner/delete', { path: val.file });
      }
      historyPush('候補値削除: ' + propName + '=' + _cellUiValueToString(val.value),
        async () => {
          await _apiPostValue(entityPath, propName, _cellUiValueToString(val.value), val.status || '案', val.note || '');
          if (bidirectionalCtx && typeof _applyBidirectionalRelationSync === 'function') {
            await _applyBidirectionalRelationSync({
              sourceDbPath: currentDbPath,
              entityPath,
              propName,
              ptc: _ptc,
              oldValue: '',
              newValue: _cellUiValueToString(val.value),
            });
          }
          if (cascadeClears.length && typeof _restoreCascadeDependentValues === 'function') {
            await _restoreCascadeDependentValues(entityPath, cascadeClears);
          }
          await selectDatabase(currentDbPath, undefined, { silent: true });
        },
        async () => {
          if (bidirectionalCtx && typeof _applyBidirectionalRelationSync === 'function') {
            await _applyBidirectionalRelationSync({
              sourceDbPath: currentDbPath,
              entityPath,
              propName,
              ptc: _ptc,
              oldValue: _cellUiValueToString(val.value),
              newValue: '',
            });
          }
          if (val.candidate_index != null) await _apiPutValue(val, { _delete: true });
          else if (val.file) await apiPost('/outliner/delete', { path: val.file });
          if (cascadeClears.length && typeof _redoCascadeDependentValues === 'function') {
            await _redoCascadeDependentValues(entityPath, cascadeClears);
          }
          await selectDatabase(currentDbPath, undefined, { silent: true });
        },
        _dbScope()
      );
      await selectDatabase(currentDbPath, undefined, { silent: true });
    } catch (err) { showStatus('削除に失敗: ' + (err.message || err), true); }
  });
  menu.appendChild(delItem);
  // 位置
  const _z = parseFloat(document.documentElement.style.zoom) || 1;
  menu.style.left = (e.clientX / _z) + 'px';
  menu.style.top = (e.clientY / _z) + 'px';
  document.body.appendChild(menu);
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  setTimeout(() => {
    const closer = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', closer); } };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

/* ==============================
   インライン編集
   ============================== */
function startInlineEdit(span, val, entityPath, propName) {
  // 列ロックチェック
  const lockMsg = checkColumnEditable(state.currentDbPath, propName);
  if (lockMsg) { showStatus(lockMsg); return; }
  if (span.querySelector('input,textarea,[contenteditable="true"]')) return;
  // user / multi-user 型: クリックでドロップダウンを表示
  const ptc = state.currentDbPath ? getPropertyTypes(state.currentDbPath)[propName] : null;
  if (ptc && (ptc.type === 'user' || ptc.type === 'multi-user')) {
    _showUserDropdown(span, val, entityPath, propName, _cellUiValueToString(val.value), ptc.type === 'multi-user');
    return;
  }
  const old = _cellUiValueToString(val.value);
  const oldRichHtml = _dbRichHtmlForValue(val);
  const input = document.createElement('span');
  input.className = 'value-input value-input--textarea value-rich-editor';
  input.setAttribute('contenteditable', 'true');
  input.setAttribute('role', 'textbox');
  input.setAttribute('aria-multiline', 'true');
  input.innerHTML = oldRichHtml || _dbRichPlainTextToHtml(old);
  span.textContent = '';
  span.appendChild(input);
  _cellUiAutosizeTextarea(input);
  input.focus();
  const selection = window.getSelection?.();
  if (selection) {
    const range = document.createRange();
    range.selectNodeContents(input);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  const restoreOldDisplay = () => {
    span.textContent = '';
    if (oldRichHtml) span.innerHTML = oldRichHtml;
    else span.textContent = old;
  };

  let canceled = false;
  let done = false;
  const isFormatSurface = (target) => !!target?.closest?.('.gb-fmt-popup, .gb-palette-popup');

  const finish = async () => {
    if (done) return;
    done = true;
    document.removeEventListener('pointerdown', outsidePointerDown, true);
    if (canceled) {
      restoreOldDisplay();
      return;
    }
    const nv = _dbRichTextFromEditable(input).trim();
    const sanitizedRichHtml = _dbRichSanitizeHtml(input.innerHTML);
    const nextRichHtml = _dbRichHtmlHasFormatting(sanitizedRichHtml) ? sanitizedRichHtml : '';
    // 空文字列で確定 → 候補値を削除
    if (!nv && old) {
      // 入力要素を即座に消して見た目をクリア
      span.textContent = '';
      try {
        await _apiPutValue(val, { _delete: true });
        showStatus('削除しました');
        // 値削除の Undo: _dbUndoValue は _apiPutValue で書き戻すが、削除済みファイルへの
        // PUT は失敗するため、専用の undo (再作成) / redo (再削除) を組む
        // currentVal は redo 時に削除する対象。undo の都度、再作成された新しいファイルに更新する
        const dbPath = state.currentDbPath;
        const savedStatus = val.status || '採用';
        const savedNote = val.note || '';
        const savedRichHtml = oldRichHtml;
        let currentVal = { ...val };
        if (typeof historyPush === 'function') {
          historyPush('値削除: ' + propName + '=' + old,
            async () => {
              const result = await _apiPostValue(entityPath, propName, old, savedStatus, savedNote, savedRichHtml);
              if (result) {
                currentVal = {
                  file: result.path || currentVal.file,
                  property: propName,
                  candidate_index: result.candidate_index,
                  value: old,
                  status: savedStatus,
                  note: savedNote,
                };
                if (savedRichHtml) currentVal.rich_html = savedRichHtml;
              }
              if (dbPath) selectDatabase(dbPath, undefined, { silent: true });
            },
            async () => {
              await _apiPutValue(currentVal, { _delete: true });
              if (dbPath) selectDatabase(dbPath, undefined, { silent: true });
            },
            _dbScope()
          );
        }
        // Step 3: 部分更新化 (空文字列 delete) — 削除済み val をローカル pivotData から除去
        if (typeof _removeLocalPivotValue === 'function') _removeLocalPivotValue(val, entityPath, propName);
        if (typeof _refreshAfterCellEdit === 'function') _refreshAfterCellEdit(span, entityPath, propName);
        else if (state.currentDbPath) selectDatabase(state.currentDbPath, undefined, { silent: true });
      } catch (e) {
        span.textContent = old;
      }
      return;
    }
    if (nextRichHtml) span.innerHTML = nextRichHtml;
    else span.textContent = nv || old;
    if (nv && (nv !== old || nextRichHtml !== oldRichHtml)) {
      try {
        await _apiPutValue(val, { new_value: nv, new_rich_html: nextRichHtml });
        _dbUndoValue(propName + ': ' + old + ' → ' + nv, val, old, nv, oldRichHtml, nextRichHtml);
        val.value = nv;
        if (nextRichHtml) val.rich_html = nextRichHtml;
        else delete val.rich_html;
        showStatus('保存しました', false, { passiveSave: true });
        if (typeof _refreshAfterCellEdit === 'function') _refreshAfterCellEdit(span, entityPath, propName);
        else if (state.currentDbPath) selectDatabase(state.currentDbPath, undefined, { silent: true });
      } catch (e) {
        restoreOldDisplay();
      }
    }
  };

  input.addEventListener('input', () => _cellUiAutosizeTextarea(input));
  const scheduleBlurFinish = () => {
    setTimeout(() => {
      if (done) return;
      const active = document.activeElement;
      if (active === input || input.contains(active) || isFormatSurface(active)) return;
      finish();
    }, 0);
  };
  const outsidePointerDown = (ev) => {
    if (done || input.contains(ev.target) || isFormatSurface(ev.target)) return;
    setTimeout(finish, 0);
  };
  document.addEventListener('pointerdown', outsidePointerDown, true);
  input.addEventListener('blur', scheduleBlurFinish);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (!e.shiftKey || e.ctrlKey || e.metaKey)) { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); canceled = true; input.blur(); }
  });
}

function _cellUiAutosizeTextarea(input) {
  if (!input) return;
  const lineHeight = parseFloat(getComputedStyle(input).lineHeight) || 18;
  const maxHeight = Math.max(lineHeight * 10 + 8, 80);
  input.style.height = 'auto';
  const nextHeight = Math.min(input.scrollHeight, maxHeight);
  input.style.height = nextHeight + 'px';
  input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

/* ==============================
   ステータスドロップダウン
   ============================== */
function showStatusDropdown(dotEl, val, entityPath, propName) {
  // 列ロックチェック
  const lockMsg = checkColumnEditable(state.currentDbPath, propName);
  if (lockMsg) { showStatus(lockMsg); return; }
  closeAllDropdowns();
  const dd = document.createElement('div');
  dd.className = 'status-dropdown';

  const statuses = getStatusList(state.currentDbPath);
  statuses.forEach(stObj => {
    const st = stObj.name;
    const item = document.createElement('div');
    item.className = 'status-dropdown-item';
    const d = document.createElement('span');
    d.style.cssText = 'width:8px;height:8px;border-radius:50%;display:inline-block;';
    d.style.background = stObj.color;
    item.appendChild(d);
    item.appendChild(document.createTextNode(' ' + st));
    if (val.status === st) item.classList.add('selected');
    item.addEventListener('click', async () => {
      closeAllDropdowns();
      const oldStatus = val.status || statuses[0]?.name || '案';
      try {
        await _apiPutValue(val, { new_status: st });
        _dbUndoStatus(val, oldStatus, st);
        val.status = st;
        dotEl.style.background = stObj.color;
        dotEl.title = st;
        showStatus('ステータス更新: ' + st);
        // ステータス連動の自動日時入力
        const _ep = entityPath || state.currentEntityPath || val.file || '';
        if (_ep && state.currentDbPath) _autoFillOnStatusChange(_ep, val.property || '', st, state.currentDbPath);
        if (state.view === 'pivot' && state.currentDbPath) {
          const _td = dotEl.closest('td');
          const _epRow = _td?.closest('tr')?.dataset?.entityName
            ? _entityPath(state.currentDbPath, _td.closest('tr').dataset.entityName)
            : (state.currentEntityPath || '');
          const _refreshed = _td && _epRow && typeof _tryRefreshPivotCellLocal === 'function'
            && _tryRefreshPivotCellLocal(_td, _epRow, propName);
          if (!_refreshed) selectDatabase(state.currentDbPath, undefined, { silent: true });
        }
        else if (state.view === 'entity' && state.currentEntityPath) selectEntity(state.currentEntityPath);
      } catch (e) { /* error shown */ }
    });
    dd.appendChild(item);
  });

  const rect = dotEl.getBoundingClientRect();
  const _z = _getZoom();
  dd.style.position = 'fixed';
  dd.style.left = (rect.left / _z) + 'px';
  dd.style.top = (rect.bottom / _z + 2) + 'px';
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

function closeAllDropdowns() {
  document.querySelectorAll('.status-dropdown, .user-dropdown').forEach(el => el.remove());
}

// ドロップダウンにキーボードナビゲーションを付与（上下キー + Enter）
function _enableDropdownKeyNav(dd, itemSelector) {
  let activeIdx = -1;
  const getItems = () => [...dd.querySelectorAll(itemSelector)].filter(el => el.offsetParent !== null);
  const highlight = (items, idx) => {
    items.forEach((el, i) => {
      el.style.outline = i === idx ? '2px solid var(--accent)' : '';
      el.style.outlineOffset = i === idx ? '-2px' : '';
    });
    if (items[idx]) items[idx].scrollIntoView({ block: 'nearest' });
  };
  // 初期状態で先頭をアクティブに
  requestAnimationFrame(() => {
    const items = getItems();
    if (items.length > 0) { activeIdx = 0; highlight(items, 0); }
  });
  const handler = (e) => {
    const items = getItems();
    if (items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, items.length - 1);
      highlight(items, activeIdx);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      highlight(items, activeIdx);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[activeIdx]) items[activeIdx].click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeAllDropdowns();
    }
  };
  document.addEventListener('keydown', handler);
  // ドロップダウンが消えたらリスナーを解除
  const cleanup = () => {
    if (!document.body.contains(dd)) {
      document.removeEventListener('keydown', handler);
      observer?.disconnect?.();
    }
  };
  const filter = (mutation) => !document.body.contains(dd)
    || Array.from(mutation.removedNodes || []).some((node) => node === dd || !!node.contains?.(dd));
  const observer = window.GBMutationBus
    ? window.GBMutationBus.subscribe('db-cell-dropdown-' + Math.random().toString(36).slice(2), { filter, callback: cleanup, throttle: 30 })
    : new MutationObserver(cleanup);
  if (!window.GBMutationBus) observer.observe(document.body, { childList: true, subtree: true });
}
