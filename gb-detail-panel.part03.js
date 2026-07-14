/* gb-detail-panel.part03.js */

function _fsRefreshRowPreview(row, adapter) {
  if (!row || !row._fsRowData || typeof _fsBuildRowPreview !== 'function') return;
  const oldPreview = row.querySelector(':scope > .cs-row-preview');
  if (!oldPreview) return;
  oldPreview.replaceWith(_fsBuildRowPreview(row._fsRowData, adapter || row._fsAdapter));
}

function _fsNotifyFieldChanged(anchor, field, adapter, value) {
  const row = anchor?.closest?.('.gb-fmt-popup-row');
  if (!row) return;
  if (field?.preview === 'fontSample') _fsUpdateFontSample(row, value);
  _fsRefreshRowPreview(row, adapter);
}

function _dpApplyNoteFileStyle(body, fm) {
  if (!body) return;
  const style = (typeof _parseFileStyleFromFrontmatter === 'function' ? _parseFileStyleFromFrontmatter(fm || '') : null)
    || (typeof _getDefaultFileStyle === 'function' ? _getDefaultFileStyle('page') : null)
    || {};
  if (typeof applyFileStyleToElement === 'function') {
    applyFileStyleToElement(style, body, 'page-content');
  }
  const root = body.closest?.('#rp-detail, [id^="detail-panel-"], .modal');
  const titleEl = root?.querySelector?.('#split-right-title');
  if (titleEl && typeof applyPageTitleStyleToElement === 'function') {
    applyPageTitleStyleToElement(style, titleEl);
  }
}

// カレンダーイベントフォームを詳細パネルに表示
function _showCalEventInDetailPanel(ev, calendars, defaultStart, defaultEnd, defaultAllDay, ownerComponent) {
  const el = _resolveDetailEl({ modal: true });
  if (!el) return;
  el._calComponent = ownerComponent || document.getElementById('rp-calendar')?._calComponent || null;
  const pos = _getDetailPanelCfg().position || 'right';
  el.style.display = '';

  const now = new Date();
  const _localISO = d => { const p = n => String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const isEdit = !!ev?.id;
  const startVal = isEdit ? ev.start?.substring(0,16) : (defaultStart || _localISO(now));
  const endVal = isEdit ? (ev.end || '').substring(0,16) : (defaultEnd || _localISO(new Date(now.getTime()+3600000)));
  const isAllDay = isEdit ? ev.all_day : !!defaultAllDay;
  const defaultCalendarId = !isEdit && ownerComponent?._calendarIdForNewEvent ? ownerComponent._calendarIdForNewEvent() : '';
  const calOpts = (calendars || []).map(c => `<option value="${esc(c.id)}" ${(ev?.calendar_id===c.id || (!isEdit && c.id===defaultCalendarId))?'selected':''}>${esc(c.name)}</option>`).join('');

  el.innerHTML = '';
  el.appendChild(_buildDpHeader(isEdit ? 'イベント編集' : '新規イベント', pos));

  const body = document.createElement('div');
  body.className = 'dp-event-form';
  body.innerHTML = `
    <div class="dp-field"><label for="dp-cal-title">タイトル</label><input id="dp-cal-title" class="gb-input" data-e2e-id="dp-cal-title" type="text" value="${esc(ev?.title || '')}" placeholder="イベント名"></div>
    <div class="dp-field"><label class="gb-check dp-event-check" for="dp-cal-allday"><input id="dp-cal-allday" class="gb-checkbox" data-e2e-id="dp-cal-allday" type="checkbox" ${isAllDay?'checked':''}><span>終日</span></label></div>
    <div class="dp-field"><label for="dp-cal-start">開始</label><input id="dp-cal-start" class="gb-input" data-e2e-id="dp-cal-start" type="datetime-local" value="${startVal}" ${isAllDay?'disabled':''}></div>
    <div class="dp-field"><label for="dp-cal-end">終了</label><input id="dp-cal-end" class="gb-input" data-e2e-id="dp-cal-end" type="datetime-local" value="${endVal}" ${isAllDay?'disabled':''}></div>
    ${calOpts ? `<div class="dp-field"><label for="dp-cal-calendar">カレンダー</label><select id="dp-cal-calendar" class="gb-select" data-e2e-id="dp-cal-calendar">${calOpts}</select></div>` : ''}
    <div class="dp-field"><span class="dp-field-label">色</span><button type="button" id="dp-cal-color" class="gb-color-swatch gb-color-swatch--field" data-e2e-id="dp-cal-color" data-color="${esc(ev?.color || '#569cd6')}" title="イベント色" aria-label="イベント色"></button></div>
    <div class="dp-field"><label for="dp-cal-location">場所</label><input id="dp-cal-location" class="gb-input" data-e2e-id="dp-cal-location" type="text" value="${esc(ev?.location || '')}"></div>
    <div class="dp-field"><label for="dp-cal-url">URL</label><input id="dp-cal-url" class="gb-input" data-e2e-id="dp-cal-url" type="url" value="${esc(ev?.url || '')}" placeholder="https://..."></div>
    <div class="dp-field"><label for="dp-cal-desc">説明</label><textarea id="dp-cal-desc" class="gb-textarea gb-textarea-sm" data-e2e-id="dp-cal-desc" rows="3">${esc(ev?.description || '')}</textarea></div>
    <div class="dp-cal-actions">
      ${isEdit ? `<button type="button" id="dp-cal-delete" class="gb-btn gb-btn-sm gb-btn-danger" data-e2e-id="dp-cal-delete">削除</button>` : ''}
      ${isEdit ? `<button type="button" id="dp-cal-comment-list" class="gb-btn gb-btn-sm" data-e2e-id="dp-cal-comment-list">コメント一覧</button>` : ''}
      ${isEdit ? `<button type="button" id="dp-cal-add-comment" class="gb-btn gb-btn-sm" data-e2e-id="dp-cal-add-comment">コメントを追加</button>` : ''}
      <span class="dp-cal-spacer"></span>
      <button type="button" id="dp-cal-save" class="gb-btn gb-btn-sm gb-btn-primary" data-e2e-id="dp-cal-save">${isEdit ? '更新' : '作成'}</button>
    </div>
  `;
  el.appendChild(body);

  const allDay = body.querySelector('#dp-cal-allday');
  const startInput = body.querySelector('#dp-cal-start');
  const endInput = body.querySelector('#dp-cal-end');
  const applyAllDayState = () => {
    const checked = !!allDay?.checked;
    [startInput, endInput].forEach(input => {
      if (!input) return;
      input.disabled = checked;
      input.classList.toggle('is-disabled', checked);
    });
  };
  allDay?.addEventListener('change', applyAllDayState);
  applyAllDayState();

  const colorSwatch = body.querySelector('#dp-cal-color');
  bindColorSwatch(colorSwatch, () => getColorSwatchValue(colorSwatch, ev?.color || '#569cd6'), (nextColor) => {
    setColorSwatchValue(colorSwatch, nextColor || '#569cd6');
  });
  // Audit-P1 H-6: イベント編集時のコメント追加（target_kind='calendar_event'）。
  // target_ref = { file: calendar_id || '_calendar', eventId: ev.id } で管理。
  if (isEdit && ev?.id) {
    const addBtn = body.querySelector('#dp-cal-add-comment');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        if (typeof addCommentHere !== 'function') return;
        const calId = (ev.calendar_id || '_calendar');
        addCommentHere({
          targetKind: 'calendar_event',
          filePath: calId,
          targetRef: { file: calId, eventId: ev.id },
          snapshot: (ev.title || '').trim().slice(0, 120),
        }, { anchorEl: addBtn });
      });
    }
    const listBtn = body.querySelector('#dp-cal-comment-list');
    if (listBtn) {
      listBtn.addEventListener('click', () => {
        const calId = (ev.calendar_id || '_calendar');
        if (typeof CommentBadges !== 'undefined' && typeof CommentBadges.openPanelForFileComments === 'function') {
          CommentBadges.openPanelForFileComments(calId);
        }
      });
    }
    body.querySelector('#dp-cal-delete')?.addEventListener('click', () => _dpCalDelete(ev.id));
  }
  body.querySelector('#dp-cal-save')?.addEventListener('click', () => _dpCalSave(isEdit ? ev.id : ''));
  setTimeout(() => body.querySelector('#dp-cal-title')?.focus(), 50);
}

async function _dpCalSave(editId) {
  // Phase C: CalendarComponentに直接undo記録を依頼
  const formRoot = document.getElementById('dp-cal-title')?.closest('.modal, #rp-detail, [id^="detail-panel-"]');
  const calComponent = formRoot?._calComponent || document.getElementById('rp-calendar')?._calComponent || null;
  if (calComponent) calComponent.pushUndo(editId ? 'イベント編集' : 'イベント作成');
  const data = {
    title: document.getElementById('dp-cal-title')?.value || '',
    start: document.getElementById('dp-cal-start')?.value || '',
    end: document.getElementById('dp-cal-end')?.value || '',
    all_day: document.getElementById('dp-cal-allday')?.checked ? 1 : 0,
    color: getColorSwatchValue(document.getElementById('dp-cal-color'), ''),
    location: document.getElementById('dp-cal-location')?.value || '',
    url: document.getElementById('dp-cal-url')?.value || '',
    description: document.getElementById('dp-cal-desc')?.value || '',
    calendar_id: document.getElementById('dp-cal-calendar')?.value || '',
    user: getUsername(),
  };
  try {
    if (editId) await apiPut('/cal/events/' + editId, data);
    else await apiPost('/cal/events', data);
    showStatus('イベントを保存しました');
    // Phase C: CalendarComponentに直接リロードを通知
    if (calComponent) calComponent.reload();
    _hideDetailPanel();
  } catch { showStatus('保存に失敗', true); }
}

async function _dpCalDelete(id) {
  if (!await cfConfirm('このイベントを削除しますか？')) return;
  // Phase C: CalendarComponentに直接undo記録を依頼
  const formRoot = document.getElementById('dp-cal-title')?.closest('.modal, #rp-detail, [id^="detail-panel-"]');
  const calComponent = formRoot?._calComponent || document.getElementById('rp-calendar')?._calComponent || null;
  if (calComponent) calComponent.pushUndo('イベント削除');
  // 削除前に calendar_id を拾っておく（対象絞り込み用）
  let calId = '';
  try {
    if (calComponent?._events) {
      const evRef = calComponent._events.find(x => x.id === id);
      calId = evRef?.calendar_id || '';
    }
  } catch (_) {}
  try {
    await apiFetch('/cal/events/' + id, { method: 'DELETE' });
    // Audit-P1 H-6: 削除成功後に紐付いたコメントを孤児化（target_kind='calendar_event'）
    apiPost('/annotations/orphan-by-target', {
      target_kind: 'calendar_event',
      target_file: calId || '_calendar',
      item_id: id,
      cascade_container: true,
    }).catch(() => {});
    showStatus('削除しました');
    // Phase C: CalendarComponentに直接リロードを通知
    if (calComponent) calComponent.reload();
    _hideDetailPanel();
  } catch { showStatus('削除に失敗', true); }
}

async function openInSplitView(label, path) {
  if (!await _dpSavePending()) return;
  const el = _resolveDetailEl();
  if (!el) return;
  el.style.display = '';
  _splitPath = path;
  _splitDirty = false;

  _ensureDetailTabShell(el);
  // タブ構造がない旧レイアウトの場合はフラットに構築（モーダル等のフォールバック）
  const noteEditor = el.querySelector('#detail-tab-note-editor');
  if (!noteEditor) {
    const pos = _getDetailPanelCfg().position || 'right';
    _removeStaleDpEditables(el);
    el.innerHTML = '';
    el.appendChild(_buildDpHeader(label || path.split('/').pop(), pos));
    const legacyBody = document.createElement('div');
    legacyBody.id = 'dp-editable';
    legacyBody.contentEditable = 'true';
    legacyBody.style.cssText = 'flex:1;padding:12px;overflow-y:auto;overscroll-behavior:contain;line-height:1.7;outline:none;font-size:12px;color:var(--page-text-fg,var(--fg));background:var(--page-text-bg,var(--content-bg,var(--bg)));';
    legacyBody.dataset.path = path;
    legacyBody.dataset.frontmatter = '';
    legacyBody.dataset.entityMode = '';
    legacyBody.innerHTML = '<span style="color:var(--fg2)">読み込み中...</span>';
    el.appendChild(legacyBody);
    _dpBindAutoSave(legacyBody);
    _dpLoadFileInto(legacyBody, path);
    return;
  }

  // 他ツールのタブを隠し、note-editorをアクティブ化
  if (typeof showBoardTabs === 'function') showBoardTabs(false);
  if (typeof hideBoardNoteTab === 'function') hideBoardNoteTab();
  if (typeof showCalendarDetailTabs === 'function') showCalendarDetailTabs(false);
  if (typeof hideScriptnoteDetailTabs === 'function') hideScriptnoteDetailTabs();
  if (typeof showDbTabs === 'function') showDbTabs(false);
  if (typeof showNoteTabs === 'function') showNoteTabs(true);
  if (typeof switchDetailTab === 'function') {
    switchDetailTab(typeof _resolveDetailTabForType === 'function'
      ? _resolveDetailTabForType('page', 'note-editor')
      : 'note-editor');
  }

  const titleEl = el.querySelector('#split-right-title');
  if (titleEl) titleEl.textContent = label || path.split('/').pop();

  // 既存の dp-editable を全削除（自動保存タイマーもクリア）
  _removeStaleDpEditables(el);
  noteEditor.innerHTML = '';
  const body = document.createElement('div');
  body.id = 'dp-editable';
  body.contentEditable = 'true';
  body.style.cssText = 'flex:1;padding:12px;overflow-y:auto;overscroll-behavior:contain;line-height:1.7;outline:none;font-size:12px;color:var(--page-text-fg,var(--fg));background:var(--page-text-bg,var(--content-bg,var(--bg)));';
  body.dataset.path = path;
  body.dataset.frontmatter = '';
  body.dataset.entityMode = '';
  body.innerHTML = '<span style="color:var(--fg2)">読み込み中...</span>';
  noteEditor.appendChild(body);
  _dpBindAutoSave(body);
  _dpLoadFileInto(body, path);
}

function _dpLoadFileInto(body, path) {
  const loadSeq = ++_splitLoadSeq;
  body.dataset.loadSeq = String(loadSeq);
  body.contentEditable = 'false';
  apiFetch('/file?path=' + encodeURIComponent(path)).then(data => {
    if (body.dataset.loadSeq !== String(loadSeq) || body.dataset.path !== path || _splitDirty) return;
    let md = data.content || '';
    const fmMatch = md.match(/^---\n[\s\S]*?\n---\n?/);
    const fm = fmMatch ? fmMatch[0] : '';
    if (fm) md = md.substring(fm.length);
    body.dataset.frontmatter = fm;
    _dpApplyNoteFileStyle(body, fm);
    const html = md.trim() ? applyAutoLinks(mdToHtml(md), path) : '';
    body.innerHTML = html || '<span style="color:var(--fg2)">内容がありません</span>';
    body.contentEditable = 'true';
  }).catch(() => {
    if (body.dataset.loadSeq !== String(loadSeq) || body.dataset.path !== path || _splitDirty) return;
    body.innerHTML = '<span style="color:var(--fg2)">読み込みに失敗しました</span>';
    body.contentEditable = 'true';
  });
}

// エントリ詳細はオプションパネルではなくサブパネルに表示する。
async function openEntityInSplit(entityPath, entityName) {
  if (!entityPath) return false;
  if (!await _dpSavePending()) return false;
  const name = entityName || entityPath.split('/').pop().replace(/\.md$/, '');
  _splitPath = entityPath;
  _splitDirty = false;
  if (window.MeldexCloudMobileSideDrawer?.openEntity?.(entityPath, name)) return true;
  if (typeof GBSubPanel !== 'undefined' && typeof GBSubPanel.open === 'function') {
    return GBSubPanel.open('entity', { path: entityPath, label: name });
  }
  if (typeof selectEntity === 'function') {
    await selectEntity(entityPath);
    return true;
  }
  return false;
}

// 独立詳細パネル用ヘッダー生成
function _buildDpHeader(title, pos) {
  const header = document.createElement('div');
  header.className = 'dp-detail-header';
  header.innerHTML = `<span id="split-right-title" class="dp-detail-title">${esc(title)}</span>
    <button type="button" class="gb-btn gb-btn-xs gb-btn-icon gb-btn-quiet" data-e2e-id="detail-panel-close" aria-label="詳細パネルを閉じる" title="閉じる">${lucide('x', 12)}</button>`;
  header.querySelector('[data-e2e-id="detail-panel-close"]')?.addEventListener('click', () => _hideDetailPanel());
  return header;
}

// 残留dp-editable要素を削除し、未発火の自動保存タイマーもクリアする
function _removeStaleDpEditables(root) {
  const scope = root || document;
  scope.querySelectorAll('#dp-editable').forEach(n => {
    if (n._autoSaveTimer) { clearTimeout(n._autoSaveTimer); n._autoSaveTimer = null; }
    n.remove();
  });
}

// 独立詳細パネルの編集エリアに自動保存+ドロップハンドラをバインド
function _dpBindAutoSave(el) {
  el.addEventListener('input', () => {
    _splitDirty = true;
    const autoVersionPath = el.dataset?.path || '';
    if (autoVersionPath && el._autoVersionPath !== autoVersionPath && typeof startAutoVersion === 'function') {
      startAutoVersion(autoVersionPath, 'file');
      el._autoVersionPath = autoVersionPath;
    }
    if (autoVersionPath && typeof markAutoVersionDirty === 'function') markAutoVersionDirty();
    // パネル固有のタイマー（グローバル共有を避ける）
    clearTimeout(el._autoSaveTimer);
    el._autoSaveTimer = setTimeout(() => { if (_splitDirty) _dpSave(el); }, 2000);
  });
  el.addEventListener('blur', () => { if (_splitDirty) _dpSave(el); });
  if (typeof setupEditableDropHandler === 'function') setupEditableDropHandler(el);
  // コンテキストメニュー（#dp-editable 用）を動的バインド。
  // global-contextmenu-refactor-plan.md に従い、document 委譲からコンテナ委譲へ移行。
  if (typeof bindNoteEditorContextMenu === 'function') bindNoteEditorContextMenu(el);
  if (typeof bindTableCellContextMenu === 'function') bindTableCellContextMenu(el);
}

// 独立詳細パネルの編集内容を保存
function _dpIsPlaceholderOnly(el) {
  if (!el || el.childNodes.length > 1) return false;
  const span = el.querySelector('span[style*="color:var(--fg2)"]');
  if (!span || span !== el.firstElementChild) return false;
  const text = (span.textContent || '').trim();
  return text === '内容がありません' || text === '読み込み中...' || text === '読み込みに失敗しました' || text === 'クリックして自由記述を編集';
}

function _dpBuildSavePayload(el) {
  if (!el) return null;
  const path = el.dataset.path;
  if (!path) return null;
  if (_dpIsPlaceholderOnly(el)) return null;
  let md = htmlToMd(el.innerHTML);
  const fm = el.dataset.frontmatter || '';
  if (fm) md = fm + md;
  return { path, content: md, html: el.innerHTML };
}

async function _dpSave(el) {
  if (!el) el = document.getElementById('dp-editable');
  if (!el || !_splitDirty) return true;
  const payload = _dpBuildSavePayload(el);
  if (!payload) {
    _splitDirty = false;
    return true;
  }
  try {
    await apiPut('/file?path=' + encodeURIComponent(payload.path), { content: payload.content, skip_if_missing: true });
    if (el.dataset.path === payload.path && el.innerHTML === payload.html) _splitDirty = false;
    return true;
  } catch (e) {
    if (typeof showStatus === 'function') showStatus('オプションの保存に失敗しました', true);
    return false;
  }
}

// 未保存内容があれば保存してからパネルを切り替え
async function _dpSavePending() {
  const el = document.getElementById('dp-editable');
  if (!el || !_splitDirty) return true;
  return _dpSave(el);
}

// 旧互換
function resetSplitPropsPanel() {}

async function closeSplitView() {
  if (!await _dpSavePending()) return false;
  _hideDetailPanel();
  _splitPath = '';
  return true;
}

async function clearDetailPanel() {
  if (!await _dpSavePending()) return false;
  _hideDetailPanel();
  _splitPath = '';
  _splitDirty = false;
  return true;
}

function saveSplitContent() {
  return _dpSave();
}

// スプリットビューのドロップハンドラ設定（v5.0: split-right-contentは廃止、dp-editableは動的に作成されるため_dpBindAutoSave内で設定）

function toggleSplitView() {
  // 後方互換: toggleRightPanel + 詳細タブ
  toggleRightPanel();
}

// ボードのカードからリンク先を開く
function bdOpenNodeLink(nodeId) {
  const n = bd.nodes.find(v => v.id === nodeId);
  if (!n || !n.link) return false;
  if (typeof _bdOpenLinkedTarget === 'function') _bdOpenLinkedTarget(n);
  else {
    const label = n.text || n.link.split('/').pop();
    openInSplitView(label, n.link);
  }
  return true;
}


// ボードのリンク付きカード選択時にノートタブで内容を表示
let _boardNotePath = '';
let _boardNoteDirty = false;
let _boardNoteLoadSeq = 0;

async function openBoardNoteTab(label, path) {
  if (!path) return;
  // ノートタブを表示
  document.querySelectorAll('.detail-tab-board-note').forEach(t => { t.hidden = false; });

  // 既に同じパスが表示中なら切り替えのみ
  if (_boardNotePath === path) {
    switchDetailTab('board-note');
    return;
  }

  // 前回のノートを保存
  if (!await _saveBoardNote()) return;

  _boardNotePath = path;
  _boardNoteDirty = false;
  const loadSeq = ++_boardNoteLoadSeq;

  const body = document.getElementById('board-note-editable');
  if (!body) return;
  body.contentEditable = 'false';
  body.dataset.boardNoteLoadSeq = String(loadSeq);
  body.innerHTML = '<span style="color:var(--fg2)">読み込み中...</span>';
  body.dataset.frontmatter = '';

  apiFetch('/file?path=' + encodeURIComponent(path)).then(data => {
    if (loadSeq !== _boardNoteLoadSeq || _boardNotePath !== path || body.dataset.boardNoteLoadSeq !== String(loadSeq) || _boardNoteDirty) return;
    let md = data.content || '';
    const fmMatch = md.match(/^---\n[\s\S]*?\n---\n?/);
    const fm = fmMatch ? fmMatch[0] : '';
    if (fm) md = md.substring(fm.length);
    body.dataset.frontmatter = fm;
    _dpApplyNoteFileStyle(body, fm);
    body.innerHTML = md.trim() ? applyAutoLinks(mdToHtml(md), path) : '<span style="color:var(--fg2)">内容がありません</span>';
    body.contentEditable = 'true';
    _boardNoteDirty = false;
  }).catch(() => {
    if (loadSeq !== _boardNoteLoadSeq || _boardNotePath !== path || body.dataset.boardNoteLoadSeq !== String(loadSeq) || _boardNoteDirty) return;
    body.innerHTML = '<span style="color:var(--fg2)">読み込みに失敗しました</span>';
    body.contentEditable = 'true';
  });

  // 自動保存バインド
  body.oninput = () => { _boardNoteDirty = true; };
  if (body._boardNoteSaveTimer) clearInterval(body._boardNoteSaveTimer);
  // body が DOM から外れたら interval を自己クリーンアップして孤児化を防ぐ
  body._boardNoteSaveTimer = setInterval(() => {
    if (!body.isConnected) {
      clearInterval(body._boardNoteSaveTimer);
      body._boardNoteSaveTimer = null;
      return;
    }
    _saveBoardNote();
  }, 3000);

  switchDetailTab('board-note');
}

function _buildBoardNoteSavePayload(body) {
  if (!body || !_boardNotePath) return null;
  if (_dpIsPlaceholderOnly(body)) return null;
  const fm = body.dataset.frontmatter || '';
  const md = htmlToMd(body.innerHTML);
  return { path: _boardNotePath, content: fm + md, html: body.innerHTML };
}

async function _saveBoardNote() {
  if (!_boardNoteDirty || !_boardNotePath) return true;
  const body = document.getElementById('board-note-editable');
  if (!body) return true;
  const payload = _buildBoardNoteSavePayload(body);
  if (!payload) return true;
  try {
    await apiPut('/file?path=' + encodeURIComponent(payload.path), { content: payload.content, skip_if_missing: true });
    if (_boardNotePath === payload.path && body.innerHTML === payload.html) _boardNoteDirty = false;
    return true;
  } catch (e) {
    if (typeof showStatus === 'function') showStatus('ボードノートの保存に失敗しました', true);
    return false;
  }
}

function hideBoardNoteTab() {
  const finalizeHide = () => {
    _boardNotePath = '';
    _boardNoteDirty = false;
    const body = document.getElementById('board-note-editable');
    if (body && body._boardNoteSaveTimer) {
      clearInterval(body._boardNoteSaveTimer);
      body._boardNoteSaveTimer = null;
    }
    document.querySelectorAll('.detail-tab-board-note').forEach(t => { t.hidden = true; });
    if (_currentDetailTab === 'board-note') {
      // board-note が閉じられた時、表示中のカード/ライン タブがあればそこへ、
      // 無ければテーマ (file-style) にフォールバックする。
      const cardTab = document.querySelector('.detail-tab-board-card');
      const lineTab = document.querySelector('.detail-tab-board-line');
      const cardVisible = cardTab && !cardTab.hidden;
      const lineVisible = lineTab && !lineTab.hidden;
      const fileStyleTab = document.querySelector('.detail-tab-file-style');
      const fileStyleVisible = fileStyleTab && !fileStyleTab.hidden;
      const next = cardVisible ? 'board-card'
        : lineVisible ? 'board-line'
        : fileStyleVisible ? 'file-style'
        : null;
      switchDetailTab(next);
    }
  };
  if (_boardNoteDirty && _boardNotePath) {
    _saveBoardNote().then(ok => { if (ok) finalizeHide(); });
    return;
  }
  finalizeHide();
}
