/* 値セルUI・ドロップダウン共通 — gb-database.js から分離 */

function _cellUiValueToString(value) {
  return value == null ? '' : String(value);
}

function _cellUiIsComposing(e) {
  return !!(e && (e.isComposing || e.keyCode === 229));
}

function _cellUiConsumeImeBoundaryKey(e) {
  if (!e) return false;
  const justEnded = e.target?.dataset?.dbImeJustEnded === '1'
    || e.currentTarget?.dataset?.dbImeJustEnded === '1';
  if (!justEnded) return false;
  if (['Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Spacebar', 'Escape'].includes(e.key)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
  }
  return true;
}

function _cellUiNormalizePath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function _dbCellInteractiveE2eToken(value) {
  return String(value == null ? '' : value)
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'item';
}

function _dbCellInteractiveE2eId(kind, entityPath, propName, value) {
  return [
    'db-cell',
    _dbCellInteractiveE2eToken(kind),
    _dbCellInteractiveE2eToken(entityPath),
    _dbCellInteractiveE2eToken(propName),
    _dbCellInteractiveE2eToken(value),
  ].join('-');
}

function _dbApplyCellInteractiveLinkA11y(link, kind, entityPath, propName, value) {
  if (!link) return;
  link.dataset.e2eId = _dbCellInteractiveE2eId(kind, entityPath, propName, value);
  link.setAttribute('aria-label', `${propName || 'URL'}を開く`);
}

function _cellUiDbPathForEntity(entityPath) {
  if (typeof _dbPathFromEntityPath === 'function') return _dbPathFromEntityPath(entityPath);
  const parts = _cellUiNormalizePath(entityPath).split('/');
  parts.pop();
  return parts.join('/');
}

function _cellUiEntityNameFromPath(entityPath) {
  const leaf = _cellUiNormalizePath(entityPath).split('/').pop() || '';
  return leaf.replace(/\.(md|json)$/i, '');
}

function _cellUiCssEscapeAttr(value) {
  const text = String(value || '');
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(text);
  return text.replace(/["\\]/g, '\\$&');
}

function _cellUiResolveRenderedCell(editedTd, entityPath, propName, root) {
  if (editedTd?.isConnected) return editedTd;
  const entityName = editedTd?.closest?.('tr')?.dataset?.entityName || _cellUiEntityNameFromPath(entityPath);
  if (!entityName || !propName) return editedTd || null;
  const selector = 'tr[data-entity-name="' + _cellUiCssEscapeAttr(entityName) + '"] td[data-prop-name="' + _cellUiCssEscapeAttr(propName) + '"]';
  const roots = [];
  if (root?.querySelector) roots.push(root);
  const pane = editedTd?.closest?.('.gb-pane');
  if (pane?.querySelector && pane !== root) roots.push(pane);
  roots.push(document);
  for (const candidateRoot of roots) {
    if (candidateRoot !== document && candidateRoot?.isConnected === false) continue;
    const cell = candidateRoot?.querySelector?.(selector);
    if (cell) return cell;
  }
  return editedTd || null;
}

function _cellUiScheduleAfterPaint(task) {
  let ran = false;
  const run = () => {
    if (ran) return;
    ran = true;
    try {
      const result = task?.();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {}
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(run));
    setTimeout(run, 160);
  } else {
    setTimeout(run, 0);
  }
}

async function _cellUiRecoverMutationFailure(dbPath, ctx, error, actionLabel) {
  const detail = error?.message || String(error || '不明なエラー');
  if (typeof showStatus === 'function') showStatus(`${actionLabel || '保存'}に失敗: ${detail}`, true);
  if (!dbPath || typeof selectDatabase !== 'function') return;
  try {
    await selectDatabase(dbPath, ctx || undefined, { silent: true });
  } catch {}
}

function _cellUiColumnLockMessage(dbPath, propName, ctx) {
  return (typeof checkColumnEditable === 'function') ? checkColumnEditable(dbPath, propName, ctx) : '';
}

function _cellUiCanQuickRename(ptc) {
  const type = String(ptc?.type || 'text');
  return type === 'text' || type === 'furigana';
}

function _cellUiIsDeletableCandidate(val, entityPath) {
  if (val?.candidate_index != null) return true;
  if (!val?.file) return false;
  return _cellUiNormalizePath(val.file) !== _cellUiNormalizePath(entityPath);
}

function _cellUiRelationIds(value) {
  return String(value || '').split(',').map(s => s.trim()).filter(Boolean);
}

async function _cellUiSelfPairRelationContext(dbPath, entityPath, ptc) {
  if (!dbPath || !ptc || ptc.relationDb !== '' || !ptc.pairWith) return null;
  const entityName = _cellUiEntityNameFromPath(entityPath);
  let pivotData = (typeof state !== 'undefined' && state.currentDbPath === dbPath) ? state.pivotData : null;
  if (!pivotData && typeof apiFetch === 'function') {
    try { pivotData = await apiFetch('/pivot?path=' + encodeURIComponent(dbPath)); } catch {}
  }
  const sourceId = pivotData?.entities?.[entityName]?._id || entityName;
  return { relDb: dbPath, pairPropName: ptc.pairWith, sourceId };
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
  const dbPath = _cellUiDbPathForEntity(entityPath) || ((typeof state !== 'undefined' && state?.currentDbPath) ? state.currentDbPath : '');
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

function _cellUiShouldRenderMultiSelectTags(propName, valueText) {
  const text = String(valueText || '');
  return propName.startsWith('タグ') || propName === 'tags' || (text.includes(',') && text.split(',').every(s => s.trim().length < 30));
}

function _cellUiRenderMultiSelectTags(container, val, entityPath, propName) {
  if (!container) return false;
  const rawText = _cellUiValueToString(val?.value);
  if (!_cellUiShouldRenderMultiSelectTags(propName, rawText)) return false;
  const tags = rawText.split(',').map(s => s.trim()).filter(Boolean);
  if (tags.length <= 1) return false;
  container.className = 'multi-select-tags';
  container.textContent = '';
  tags.forEach(t => {
    const tag = document.createElement('span');
    tag.className = 'multi-select-tag';
    tag.textContent = t;
    if (_cellUiApplyAutoLinks(tag, t, entityPath)) {
      tag.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_cellUiHandleAutoLinkClick(e)) return;
        startInlineEdit(container, val, entityPath, propName);
      });
    } else {
      tag.addEventListener('click', (e) => {
        e.stopPropagation();
        startInlineEdit(container, val, entityPath, propName);
      });
    }
    container.appendChild(tag);
  });
  container.addEventListener('click', (e) => {
    if (_cellUiHandleAutoLinkClick(e)) return;
    e.stopPropagation();
    startInlineEdit(container, val, entityPath, propName);
  });
  return true;
}

function createValueElement(val, entityPath, propName, thumbSize, options = {}) {
  const dbPath = options.dbPath || _cellUiDbPathForEntity(entityPath) || state.currentDbPath || '';
  if (val && entityPath) val.entry_path = _cellUiNormalizePath(entityPath);
  const filterMode = options.filter ?? options.ctx?.filter ?? (dbPath === state.currentDbPath ? state.filter : 'disabled');
  const row = document.createElement('div');
  row.className = 'cell-value' + (val.status === 'ボツ' ? ' status-botsu' : '');
  row.style.position = 'relative';
  _setupCellValueDrag(row, val, entityPath, propName);

  // ホバー時の「...」メニューボタン
  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'cell-value-more';
  moreBtn.style.cssText = 'position:absolute;right:28px;top:50%;transform:translateY(-50%);display:none;cursor:pointer;padding:0 2px;color:var(--fg2);font-size:11px;background:var(--bg3);border:0;border-radius:3px;z-index:2;';
  moreBtn.innerHTML = lucide('ellipsis', 12);
  moreBtn.title = 'メニュー';
  moreBtn.setAttribute('aria-label', '候補値のメニュー');
  moreBtn.dataset.e2eId = _dbCellInteractiveE2eId(
    'value-more',
    entityPath,
    propName,
    val?.candidate_index ?? val?.value,
  );
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    _showValueContextMenu(e, val, entityPath, propName);
  });
  row.appendChild(moreBtn);
  row.addEventListener('mouseenter', () => { moreBtn.style.display = ''; });
  row.addEventListener('mouseleave', () => { moreBtn.style.display = 'none'; });

  // Status dot（採用状況フィルタ無効時 or DB側でステータス機能 OFF の場合は非表示）。
  // ただし候補値が2つ以上あるセル（forceStatusDot）は、区別のためステータス機能OFFでも表示する。
  if ((filterMode !== 'disabled' && getStatusEnabled(dbPath)) || options.forceStatusDot) {
    const dot = document.createElement('span');
    dot.className = 'status-dot';
    const _stColor = _getStatusColor(val.status, dbPath);
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
    _dbApplyCellInteractiveLinkA11y(link, 'url', entityPath, propName, v);
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
    const imagePath = entityPath + '/' + v;
    const rawSrc = '/api/file-raw?path=' + encodeURIComponent(imagePath);
    const thumbPx = thumbSize === 'large' ? 320 : 160;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.fetchPriority = 'low';
    img.src = '/api/thumbnail?path=' + encodeURIComponent(imagePath) + '&size=' + thumbPx;
    img.alt = v;
    img.onerror = () => {
      if (img.dataset.rawFallback !== '1') {
        img.dataset.rawFallback = '1';
        img.src = rawSrc;
        return;
      }
      img.replaceWith(document.createTextNode(v));
    };
    img.addEventListener('click', (e) => { e.stopPropagation(); });
    row.appendChild(img);
    return row;
  }

  // マルチセレクト判定（カンマ区切り値）
  if (_cellUiShouldRenderMultiSelectTags(propName, v)) {
    const tagContainer = document.createElement('div');
    if (_cellUiRenderMultiSelectTags(tagContainer, val, entityPath, propName)) {
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
  const currentDbPath = _cellUiDbPathForEntity(entityPath) || state.currentDbPath || '';
  const currentCtx = typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(e?.target || null, { dbPath: currentDbPath })
    : null;
  const _ptc = currentDbPath ? getPropertyTypes(currentDbPath, currentCtx)[propName] : null;
  const lockMsg = _cellUiColumnLockMessage(currentDbPath, propName, currentCtx);
  // 上部にリネーム入力欄: 値テキストを変更
  if (typeof _addMenuRenameInput === 'function' && !lockMsg && _cellUiCanQuickRename(_ptc)) {
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
        else if (currentDbPath) selectDatabase(currentDbPath, currentCtx || undefined, { silent: true });
      } catch (e) {
        await _cellUiRecoverMutationFailure(currentDbPath, currentCtx, e, '保存');
      }
    }, { placeholder: '値を変更...' });
  }
  // relation型の場合: 「リンク先を開く」を追加
  if (_ptc && (_ptc.type === 'relation' || _ptc.type === 'multi-relation') && val.value) {
    // 自己参照判定: relationDb === '' (空文字) のみ自己参照。undefinedは単に未設定
    const isSelfRef = (_ptc.relationDb === '');
    const relDb = typeof _dbResolveRelationDbPath === 'function'
      ? _dbResolveRelationDbPath(currentDbPath, _ptc)
      : (isSelfRef ? currentDbPath : (_ptc.relationDb || ''));
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
          navigateToEntity(name || idOrName, relDb, currentCtx);
        });
        sub.appendChild(openItem);
        const rightItem = document.createElement('div');
        rightItem.className = 'gb-context-menu-item';
        rightItem.innerHTML = lucide('layers-2', 14) + ' フロートパネルで開く';
        rightItem.addEventListener('click', async () => {
          menu.remove();
          let name = idOrName;
          if (typeof _resolveRelationName === 'function' && relDb) {
            name = await _resolveRelationName(idOrName, relDb);
          }
          const path = typeof _entityPath === 'function' ? _entityPath(relDb, name || idOrName) : '';
          if (path && typeof openLinkInSubPanel === 'function') openLinkInSubPanel(path, name || idOrName, { linkType: 'entity', sourcePaneId });
          else navigateToEntity(name || idOrName, relDb, currentCtx);
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
  // link型: 「リンク先を変更」を追加
  if (_ptc && _ptc.type === 'link') {
    const changeItem = document.createElement('div');
    changeItem.className = 'gb-context-menu-item';
    changeItem.innerHTML = lucide('folderTree', 14) + ' リンク先を変更...';
    changeItem.addEventListener('click', () => {
      const anchorForRefresh = e?.target || null;
      menu.remove();
      if (typeof startDbLinkCellPick === 'function') {
        startDbLinkCellPick(val, entityPath, propName, currentDbPath, currentCtx, anchorForRefresh);
      }
    });
    menu.appendChild(changeItem);
    const linkSep = document.createElement('div');
    linkSep.className = 'gb-context-menu-sep';
    menu.appendChild(linkSep);
  }
  // コメントを追加（Phase 2e-iii）
  {
    const cmtItem = document.createElement('div');
    cmtItem.className = 'gb-context-menu-item';
    cmtItem.innerHTML = '💬 コメントを追加';
    cmtItem.addEventListener('click', () => {
      menu.remove();
      if (typeof addCommentHere !== 'function') return;
      const dbPath = currentDbPath || '';
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
      const dbPath = currentDbPath || '';
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
  delItem.innerHTML = lucide('trash2', 14) + ' 候補値を削除';
  delItem.addEventListener('click', async () => {
    menu.remove();
    if (lockMsg) { showStatus(lockMsg, true); return; }
    if (!_cellUiIsDeletableCandidate(val, entityPath)) {
      showStatus('削除できる候補値がありません', true);
      return;
    }
    if (typeof cfConfirm === 'function') {
      const ok = await cfConfirm('この候補値を削除しますか？');
      if (!ok) return;
    } else if (typeof window !== 'undefined' && !window.confirm('この候補値を削除しますか？')) {
      return;
    }
    try {
      const bidirectionalCtx = (_ptc && (_ptc.type === 'relation' || _ptc.type === 'multi-relation') && _ptc.bidirectional)
        ? { entityPath, propName, ptc: _ptc }
        : null;
      const relationValue = _cellUiValueToString(val.value);
      const savedStatus = val.status || '案';
      const savedNote = val.note || '';
      const savedRichHtml = _dbRichHtmlForValue(val);
      const pairCtx = (_ptc && (_ptc.type === 'relation' || _ptc.type === 'multi-relation'))
        ? await _cellUiSelfPairRelationContext(currentDbPath, entityPath, _ptc)
        : null;
      const pairIds = pairCtx ? _cellUiRelationIds(relationValue) : [];
      let currentVal = { ...val };
      let cascadeClears = [];
      const pairRollbackOps = [];
      let bidirectionalOp = null;
      try {
        if (_ptc && (_ptc.type === 'relation' || _ptc.type === 'multi-relation')
            && typeof _clearCascadeDependentValues === 'function') {
          cascadeClears = await _clearCascadeDependentValues(entityPath, propName, relationValue, '', { dbPath: currentDbPath, ctx: currentCtx });
        }
        if (pairCtx && typeof _syncPairRelation === 'function') {
          for (const id of pairIds) {
            const op = await _syncPairRelation(pairCtx.relDb, id, pairCtx.pairPropName, pairCtx.sourceId, false);
            if (op?.undo) pairRollbackOps.push(op.undo);
          }
        }
        if (bidirectionalCtx && typeof _applyBidirectionalRelationSync === 'function') {
          bidirectionalOp = await _applyBidirectionalRelationSync({
            sourceDbPath: currentDbPath,
            entityPath,
            propName,
            ptc: _ptc,
            oldValue: relationValue,
            newValue: '',
          });
        }
        const candIdx = val.candidate_index;
        if (candIdx != null) {
          await _apiPutValue(val, { _delete: true });
        } else if (val.file) {
          await apiPost('/outliner/delete', { path: val.file });
        }
      } catch (err) {
        if (bidirectionalOp?.undo) {
          try { await bidirectionalOp.undo(); } catch (rollbackError) {
            console.error('候補値削除の双方向リレーション復旧に失敗:', rollbackError, err);
          }
        }
        for (let i = pairRollbackOps.length - 1; i >= 0; i -= 1) {
          try { await pairRollbackOps[i](); } catch (rollbackError) {
            console.error('候補値削除の自己リレーション復旧に失敗:', rollbackError, err);
          }
        }
        if (cascadeClears.length && typeof _restoreCascadeDependentValues === 'function') {
          try {
            await _restoreCascadeDependentValues(entityPath, cascadeClears, { dbPath: currentDbPath, ctx: currentCtx });
          } catch (rollbackError) {
            console.error('候補値削除のカスケード値復旧に失敗:', rollbackError, err);
          }
        }
        throw err;
      }
      historyPush('候補値削除: ' + propName + '=' + relationValue,
        async () => {
          const result = await _apiPostValue(entityPath, propName, relationValue, savedStatus, savedNote, savedRichHtml);
          if (result) {
            currentVal = {
              file: result.path || currentVal.file,
              entry_path: entityPath,
              property: propName,
              candidate_index: result.candidate_index,
              value: relationValue,
              status: savedStatus,
              note: savedNote,
            };
            if (savedRichHtml) currentVal.rich_html = savedRichHtml;
          }
          if (pairCtx && typeof _syncPairRelation === 'function') {
            for (const id of pairIds) await _syncPairRelation(pairCtx.relDb, id, pairCtx.pairPropName, pairCtx.sourceId, true);
          }
          if (bidirectionalCtx && typeof _applyBidirectionalRelationSync === 'function') {
            await _applyBidirectionalRelationSync({
              sourceDbPath: currentDbPath,
              entityPath,
              propName,
              ptc: _ptc,
              oldValue: '',
              newValue: relationValue,
            });
          }
          if (cascadeClears.length && typeof _restoreCascadeDependentValues === 'function') {
            await _restoreCascadeDependentValues(entityPath, cascadeClears, { dbPath: currentDbPath, ctx: currentCtx });
          }
          await selectDatabase(currentDbPath, currentCtx || undefined, { silent: true });
        },
        async () => {
          if (pairCtx && typeof _syncPairRelation === 'function') {
            for (const id of pairIds) await _syncPairRelation(pairCtx.relDb, id, pairCtx.pairPropName, pairCtx.sourceId, false);
          }
          if (bidirectionalCtx && typeof _applyBidirectionalRelationSync === 'function') {
            await _applyBidirectionalRelationSync({
              sourceDbPath: currentDbPath,
              entityPath,
              propName,
              ptc: _ptc,
              oldValue: relationValue,
              newValue: '',
            });
          }
          if (currentVal.candidate_index != null) await _apiPutValue(currentVal, { _delete: true });
          else if (currentVal.file) await apiPost('/outliner/delete', { path: currentVal.file });
          if (cascadeClears.length && typeof _redoCascadeDependentValues === 'function') {
            await _redoCascadeDependentValues(entityPath, cascadeClears, { dbPath: currentDbPath, ctx: currentCtx });
          }
          await selectDatabase(currentDbPath, currentCtx || undefined, { silent: true });
        },
        _dbScope(currentDbPath)
      );
      await selectDatabase(currentDbPath, currentCtx || undefined, { silent: true });
    } catch (err) {
      await _cellUiRecoverMutationFailure(currentDbPath, currentCtx, err, '削除');
    }
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
  const dbPath = _cellUiDbPathForEntity(entityPath) || state.currentDbPath || '';
  const ctx = typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(span, { dbPath })
    : null;
  // 列ロックチェック
  const lockMsg = checkColumnEditable(dbPath, propName);
  if (lockMsg) { showStatus(lockMsg); return; }
  if (span.querySelector('input,textarea,[contenteditable="true"]')) return;
  // user / multi-user 型: クリックでドロップダウンを表示
  const ptc = dbPath ? getPropertyTypes(dbPath, ctx)[propName] : null;
  if (ptc && (ptc.type === 'user' || ptc.type === 'multi-user')) {
    _showUserDropdown(span, val, entityPath, propName, _cellUiValueToString(val.value), ptc.type === 'multi-user', { dbPath, ctx });
    return;
  }
  const old = _cellUiValueToString(val.value);
  const oldRichHtml = _dbRichHtmlForValue(val);
  const editedTd = span.closest('td');
  const editedPos = typeof _cellPos === 'function' ? _cellPos(editedTd) : null;
  const editedFocusSeq = Number(editedPos?.__sourceSeq || editedTd?.dataset?.dbActiveSeq || 0);
  const editedRoot = editedTd?.closest?.('.gb-pane') || editedTd?.closest?.('.gb-pane-content') || document;
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
    if (span.classList?.contains('multi-select-tags') && _cellUiRenderMultiSelectTags(span, { ...val, value: old }, entityPath, propName)) return;
    if (oldRichHtml) span.innerHTML = oldRichHtml;
    else {
      span.textContent = old;
      _cellUiApplyAutoLinks(span, old, entityPath);
    }
  };
  const restoreEditedCellSelection = (afterRender = false, moveTo = null) => {
    const restore = () => {
      const currentActive = typeof _dbCurrentVisualActiveCell === 'function'
        ? _dbCurrentVisualActiveCell()
        : activeCell;
      const currentFocusSeq = Number(currentActive?.dataset?.dbActiveSeq || 0);
      // 保存待ちの間に次の編集・選択が始まった場合、古い保存の遅延復元で
      // 新しいフォーカスやTab移動を上書きしない。
      if (editedFocusSeq > 0 && currentFocusSeq > editedFocusSeq) return;
      if (moveTo && editedPos && typeof _restoreCellPos === 'function') {
        _restoreCellPos(editedPos, moveTo);
        return;
      }
      const target = _cellUiResolveRenderedCell(editedTd, entityPath, propName, editedRoot);
      if (target && typeof setActiveCell === 'function') setActiveCell(target, { scroll: false });
    };
    restore();
    if (!afterRender) return;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restore);
    setTimeout(restore, 80);
  };

  let canceled = false;
  let done = false;
  let composing = false;
  let pendingBlurFinish = false;
  const isFormatSurface = (target) => !!target?.closest?.('.gb-fmt-popup, .gb-palette-popup');

  const finish = async (moveTo = null) => {
    if (done) return;
    done = true;
    document.removeEventListener('pointerdown', outsidePointerDown, true);
    if (canceled) {
      restoreOldDisplay();
      restoreEditedCellSelection();
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
                  entry_path: entityPath,
                  property: propName,
                  candidate_index: result.candidate_index,
                  value: old,
                  status: savedStatus,
                  note: savedNote,
                };
                if (savedRichHtml) currentVal.rich_html = savedRichHtml;
              }
              if (dbPath) selectDatabase(dbPath, ctx || undefined, { silent: true });
            },
            async () => {
              await _apiPutValue(currentVal, { _delete: true });
              if (dbPath) selectDatabase(dbPath, ctx || undefined, { silent: true });
            },
            _dbScope(dbPath)
          );
        }
        // Step 3: 部分更新化 (空文字列 delete) — 削除済み val をローカル pivotData から除去
        if (typeof _removeLocalPivotValue === 'function') _removeLocalPivotValue(val, entityPath, propName);
        if (typeof _refreshAfterCellEdit === 'function') _refreshAfterCellEdit(span, entityPath, propName);
        else if (dbPath) selectDatabase(dbPath, ctx || undefined, { silent: true });
        restoreEditedCellSelection(true, moveTo);
      } catch (e) {
        span.textContent = old;
        restoreEditedCellSelection(true);
        await _cellUiRecoverMutationFailure(dbPath, ctx, e, '削除');
      }
      return;
    }
    if (nextRichHtml) span.innerHTML = nextRichHtml;
    else span.textContent = nv || old;
    restoreEditedCellSelection(false, moveTo);
    if (nv && (nv !== old || nextRichHtml !== oldRichHtml)) {
      const saveRef = { ...val };
      val.value = nv;
      if (nextRichHtml) val.rich_html = nextRichHtml;
      else delete val.rich_html;
      _cellUiScheduleAfterPaint(async () => {
        try {
          await _apiPutValue(saveRef, { new_value: nv, new_rich_html: nextRichHtml });
          if (typeof _syncValueRefAfterSave === 'function') _syncValueRefAfterSave(saveRef, val);
          else if (saveRef.file) val.file = saveRef.file;
          _dbUndoValue(propName + ': ' + old + ' → ' + nv, val, old, nv, oldRichHtml, nextRichHtml);
          showStatus('保存しました', false, { passiveSave: true });
          if (typeof _refreshAfterCellEdit === 'function') _refreshAfterCellEdit(span, entityPath, propName);
          else if (dbPath) selectDatabase(dbPath, ctx || undefined, { silent: true });
          restoreEditedCellSelection(true, moveTo);
        } catch (e) {
          val.value = old;
          if (oldRichHtml) val.rich_html = oldRichHtml;
          else delete val.rich_html;
          restoreOldDisplay();
          restoreEditedCellSelection(true);
          await _cellUiRecoverMutationFailure(dbPath, ctx, e, '保存');
        }
      });
    }
  };

  input.addEventListener('input', () => _cellUiAutosizeTextarea(input));
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => {
    composing = false;
    input.dataset.dbImeJustEnded = '1';
    setTimeout(() => { delete input.dataset.dbImeJustEnded; }, 0);
    if (!pendingBlurFinish) return;
    pendingBlurFinish = false;
    scheduleBlurFinish();
  });
  const scheduleBlurFinish = () => {
    if (composing) {
      pendingBlurFinish = true;
      return;
    }
    setTimeout(() => {
      if (done) return;
      const active = document.activeElement;
      if (active === input || input.contains(active) || isFormatSurface(active)) return;
      finish();
    }, 0);
  };
  const outsidePointerDown = (ev) => {
    if (done || input.contains(ev.target) || isFormatSurface(ev.target)) return;
    if (composing) {
      pendingBlurFinish = true;
      return;
    }
    setTimeout(finish, 0);
  };
  document.addEventListener('pointerdown', outsidePointerDown, true);
  input.addEventListener('blur', scheduleBlurFinish);
  input.addEventListener('keydown', (e) => {
    if (_cellUiIsComposing(e)) return;
    if (_cellUiConsumeImeBoundaryKey(e)) return;
    if (e.key === 'Enter' && (!e.shiftKey || e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); finish(); }
    if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); finish(e.shiftKey ? 'left' : 'right'); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); canceled = true; finish(); }
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
  const dbPath = _cellUiDbPathForEntity(entityPath) || state.currentDbPath || '';
  const ctx = typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(dotEl, { dbPath })
    : null;
  const lockMsg = _cellUiColumnLockMessage(dbPath, propName, ctx);
  if (lockMsg) { showStatus(lockMsg); return; }
  closeAllDropdowns(ctx || dotEl);
  const dd = document.createElement('div');
  dd.className = 'status-dropdown';
  if (ctx?.paneId) dd.dataset.dbPaneId = ctx.paneId;

  const statuses = getStatusList(dbPath);
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
      closeAllDropdowns(ctx || dotEl);
      const oldStatus = val.status || statuses[0]?.name || '案';
      try {
        await _apiPutValue(val, { new_status: st });
        _dbUndoStatus(val, oldStatus, st, { dbPath, ctx, entityPath });
        val.status = st;
        dotEl.style.background = stObj.color;
        dotEl.title = st;
        showStatus('ステータス更新: ' + st);
        // ステータス連動の自動日時入力
        const _ep = entityPath || state.currentEntityPath || val.file || '';
        let autoFilled = false;
        if (_ep && dbPath && typeof _autoFillOnStatusChange === 'function') {
          await _autoFillOnStatusChange(_ep, val.property || '', st, dbPath, { ctx });
          autoFilled = true;
        }
        const currentView = typeof _dbCurrentViewModeForContext === 'function'
          ? _dbCurrentViewModeForContext(ctx, dbPath)
          : (ctx?.viewMode || state.view);
        if (currentView === 'pivot' && dbPath) {
          if (autoFilled) {
            await selectDatabase(dbPath, ctx || undefined, { silent: true });
            return;
          }
          const _td = dotEl.closest('td');
          const _epRow = _td?.closest('tr')?.dataset?.entityName
            ? _entityPath(dbPath, _td.closest('tr').dataset.entityName)
            : (state.currentEntityPath || '');
          const _refreshed = _td && _epRow && typeof _tryRefreshPivotCellLocal === 'function'
            && _tryRefreshPivotCellLocal(_td, _epRow, propName, { dbPath, ctx });
          if (!_refreshed) selectDatabase(dbPath, ctx || undefined, { silent: true });
        }
        else if (state.view === 'entity' && state.currentEntityPath) selectEntity(state.currentEntityPath);
      } catch (e) {
        val.status = oldStatus;
        dotEl.style.background = _getStatusColor(oldStatus, dbPath);
        dotEl.title = oldStatus;
        await _cellUiRecoverMutationFailure(dbPath, ctx, e, 'ステータスの更新');
      }
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
      if (!dd.contains(e.target)) { closeAllDropdowns(ctx || dotEl); document.removeEventListener('pointerdown', closer); }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

function closeAllDropdowns(scope) {
  const paneId = scope?.paneId
    || scope?.dataset?.dbPaneId
    || scope?.dataset?.paneId
    || scope?.closest?.('[data-pane-id]')?.dataset?.paneId
    || '';
  const escapedPaneId = paneId && globalThis.CSS?.escape
    ? CSS.escape(paneId)
    : String(paneId).replace(/["\\]/g, '\\$&');
  const paneRoot = scope?.containerEl
    || (paneId ? document.querySelector(`[data-pane-id="${escapedPaneId}"]`) : null);
  document.querySelectorAll('.status-dropdown, .cell-inline-dd, .user-dropdown').forEach(el => {
    if (paneId && el.dataset.dbPaneId && el.dataset.dbPaneId !== paneId) return;
    if (paneId && !el.dataset.dbPaneId && (!paneRoot || !paneRoot.contains(el))) return;
    try { el.dispatchEvent(new CustomEvent('db-dropdown-cancel')); } catch {}
    el.remove();
  });
}

function _positionCellDropdown(dd, anchorEl, options = {}) {
  if (!dd) return;
  const fallbackAnchor = typeof _dbCurrentVisualActiveCell === 'function' ? _dbCurrentVisualActiveCell() : null;
  const anchor = (anchorEl && anchorEl.isConnected ? anchorEl : null)
    || (fallbackAnchor && fallbackAnchor.isConnected ? fallbackAnchor : null);
  const rect = anchor?.getBoundingClientRect?.();
  const validRect = rect
    && Number.isFinite(rect.left)
    && Number.isFinite(rect.top)
    && Number.isFinite(rect.bottom)
    && rect.width >= 0
    && rect.height >= 0;
  dd.style.position = 'fixed';
  dd.style.visibility = 'hidden';
  if (options.minWidth !== false && validRect) {
    const z = typeof _getZoom === 'function' ? _getZoom() : 1;
    const minWidth = Math.max(Number(options.minWidth || 0), rect.width / z);
    if (minWidth > 0) dd.style.minWidth = minWidth + 'px';
  }
  if (validRect && typeof positionPopup === 'function') {
    positionPopup(dd, rect, { prefer: options.prefer || 'below', gap: options.gap ?? 2 });
    return;
  }
  if (!dd.parentNode) document.body.appendChild(dd);
  const gap = options.gap ?? 2;
  const z = typeof _getZoom === 'function' ? _getZoom() : 1;
  dd.style.left = validRect ? (rect.left / z) + 'px' : gap + 'px';
  dd.style.top = validRect ? (rect.bottom / z + gap) + 'px' : gap + 'px';
  dd.style.visibility = 'visible';
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(dd);
}

// ドロップダウンにキーボードナビゲーションを付与（上下左右キー + Enter）
function _enableDropdownKeyNav(dd, itemSelector) {
  let activeIdx = -1;
  const isNavItemVisible = (el) => {
    if (!el?.isConnected) return false;
    if (el.offsetParent !== null) return true;
    const rects = typeof el.getClientRects === 'function' ? el.getClientRects() : null;
    if (rects && rects.length > 0) return true;
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    return !style || (style.display !== 'none' && style.visibility !== 'hidden');
  };
  const getItems = () => [...dd.querySelectorAll(itemSelector)].filter(isNavItemVisible);
  const activeInputText = (target) => {
    const tag = String(target?.tagName || '').toUpperCase();
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') return '';
    return String(target.value || '').trim();
  };
  const findAddItemIndex = (items, query) => {
    if (!query) return -1;
    const lower = query.toLowerCase();
    return items.findIndex(item => {
      const text = String(item.textContent || '').trim();
      return item.dataset?.ddAdd === '1'
        || (text.includes('追加') && text.toLowerCase().includes(lower));
    });
  };
  const highlight = (items, idx) => {
    items.forEach((el, i) => {
      el.style.outline = i === idx ? '2px solid var(--accent)' : '';
      el.style.outlineOffset = i === idx ? '-2px' : '';
    });
    if (items[idx]) items[idx].scrollIntoView({ block: 'nearest' });
  };
  const setActiveFromItem = (item) => {
    const items = getItems();
    const idx = items.indexOf(item);
    if (idx >= 0) {
      activeIdx = idx;
      highlight(items, activeIdx);
    }
  };
  const bindItems = () => {
    getItems().forEach(item => {
      if (item.dataset.ddNavBound === '1') return;
      item.dataset.ddNavBound = '1';
      item.addEventListener('pointerenter', () => setActiveFromItem(item));
    });
  };
  const ensureInitialActive = () => {
    bindItems();
    const items = getItems();
    if (items.length > 0 && activeIdx < 0) { activeIdx = 0; highlight(items, 0); }
  };
  // 初期状態で先頭をアクティブにする。キー入力が次フレームより先に来ても選択位置を安定させる。
  ensureInitialActive();
  requestAnimationFrame(ensureInitialActive);
  const handler = (e) => {
    if (!document.body.contains(dd)) {
      document.removeEventListener('keydown', handler, true);
      return;
    }
    if (_cellUiIsComposing(e)) return;
    if (_cellUiConsumeImeBoundaryKey(e)) return;
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Tab'].includes(e.key)) return;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.altKey)) return;
    // 検索・新規値入力欄では左右キーを候補移動に奪わず、通常のキャレット移動に任せる。
    // 上下キーと Enter/Tab は候補ナビゲーションとして引き続き扱う。
    const targetTag = String(e.target?.tagName || '').toUpperCase();
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight')
        && (targetTag === 'INPUT' || targetTag === 'TEXTAREA')) return;
    bindItems();
    const items = getItems();
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
    const recordDebug = (phase) => {
      try {
        window.__meldexLastDropdownNav = {
          phase,
          key: e.key,
          activeIdx,
          itemTexts: items.map(item => (item.textContent || '').trim()),
          activeText: items[activeIdx] ? (items[activeIdx].textContent || '').trim() : '',
        };
      } catch {}
    };
    recordDebug('before');
    if (items.length === 0 && e.key !== 'Escape') return;
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      const addIdx = e.key === 'ArrowDown' ? findAddItemIndex(items, activeInputText(e.target)) : -1;
      activeIdx = addIdx >= 0 ? addIdx : Math.min(activeIdx + 1, items.length - 1);
      highlight(items, activeIdx);
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      activeIdx = Math.max(activeIdx - 1, 0);
      highlight(items, activeIdx);
    } else if (e.key === 'ArrowLeft') {
      activeIdx = 0;
      highlight(items, activeIdx);
    } else if (e.key === 'ArrowRight') {
      activeIdx = items.length - 1;
      highlight(items, activeIdx);
    } else if (e.key === 'Enter') {
      if (activeIdx < 0 && items.length) activeIdx = 0;
      const activeItem = items[activeIdx];
      if (activeItem && typeof activeItem._ddActivate === 'function') activeItem._ddActivate();
      else if (activeItem) activeItem.click();
    } else if (e.key === 'Escape') {
      try { dd.dispatchEvent(new CustomEvent('db-dropdown-cancel')); } catch {}
      closeAllDropdowns(dd);
    }
    recordDebug('after');
  };
  document.addEventListener('keydown', handler, true);
  // ドロップダウンが消えたらリスナーを解除
  const cleanup = () => {
    if (!document.body.contains(dd)) {
      document.removeEventListener('keydown', handler, true);
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
