  // シナリオ
  try {
    if (typeof _sn2Editors !== 'undefined' && _sn2Editors[file]?.host) {
      CommentBadges.refreshScriptnote(file, _sn2Editors[file].host);
    }
  } catch {}
  // ボード
  try {
    if (typeof bd !== 'undefined' && bd?.path === file) {
      const bdContainer = document.getElementById('bd-nodes');
      if (bdContainer) CommentBadges.refreshBoard(file, bdContainer);
    }
  } catch {}
  // シート
  try {
    if (typeof state !== 'undefined' && state.currentDbPath === file) {
      const tbl = document.querySelector('#pivot-table') || document.querySelector('table.pivot-table');
      if (tbl) CommentBadges.refreshSheet(file, tbl);
    }
  } catch {}
  // カレンダー
  try {
    if (typeof CommentBadges.refreshVisibleCalendar === 'function') {
      CommentBadges.refreshVisibleCalendar();
    }
  } catch {}
}

async function _toggleResolveComment(c) {
  try {
    const body = { resolved: c.resolved ? 0 : 1 };
    if (typeof _putAnnotationWithHistory === 'function') {
      await _putAnnotationWithHistory(c.id, body, '注釈: 解決状態変更', c.id);
    } else {
      await apiPut('/annotations/' + encodeURIComponent(c.id), body);
    }
    _invalidateCommentBadgesFor(c);
    loadRpAnnotationList();
  } catch { showStatus('更新に失敗', true); }
}

async function _deleteComment(c) {
  if (!_rpCanDeleteAnnotation(c)) {
    showStatus('注釈の削除はソースフォルダの管理者だけが行えます', true);
    return;
  }
  if (!await cfConfirm('このコメントを削除しますか？')) return;
  try {
    const before = typeof _fetchAnnotationHistoryRow === 'function'
      ? await _fetchAnnotationHistoryRow(c.id).catch(() => null)
      : null;
    await apiDelete('/annotations/' + encodeURIComponent(c.id));
    if (typeof _pushAnnotationHistory === 'function') _pushAnnotationHistory('注釈: 削除', before, null, c.id);
    _invalidateCommentBadgesFor(c);
    loadRpAnnotationList();
  } catch { showStatus('削除に失敗', true); }
}

function _rpEscSel(value) {
  const text = String(value || '');
  return (window.CSS && CSS.escape) ? CSS.escape(text) : text.replace(/["\\]/g, '\\$&');
}

function _flashRpCommentTarget(target) {
  if (!target) return;
  target.scrollIntoView({ block: 'center', inline: 'center' });
  const prevOutline = target.style.outline;
  const prevOutlineOffset = target.style.outlineOffset;
  target.style.outline = '2px solid var(--accent)';
  target.style.outlineOffset = '2px';
  setTimeout(() => {
    target.style.outline = prevOutline;
    target.style.outlineOffset = prevOutlineOffset;
  }, 1600);
}

function _findCalendarEventTarget(eventId) {
  if (!eventId) return null;
  return document.querySelector(`.gb-cal-day-event[data-event-id="${_rpEscSel(eventId)}"], .gb-cal-clock-event-slice[data-event-id="${_rpEscSel(eventId)}"]`);
}

function _jumpToCalendarEvent(eventId) {
  const focus = () => {
    const target = _findCalendarEventTarget(eventId);
    if (!target) return false;
    _flashRpCommentTarget(target);
    try {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    } catch {}
    return true;
  };
  if (focus()) return;
  if (typeof openRightPanelTab === 'function') {
    try { openRightPanelTab('calendar'); } catch {}
  } else if (typeof toggleRightPanelTab === 'function') {
    try { toggleRightPanelTab('calendar'); } catch {}
  }
  setTimeout(focus, 450);
}

function _rpCommentTargetKind(c) {
  const ref = c?.target_ref || {};
  return String(c?.target_kind || ref.container?.kind || '');
}

function _rpCommentNavType(c, file) {
  const kind = _rpCommentTargetKind(c);
  if (kind === 'sheet_cell' || kind === 'sheet_col') return 'pivot';
  if (/\.board\.md$/i.test(file)) return 'board';
  if (/\.(?:scriptnote|scenario)\.json$/i.test(file)) return 'scriptnote';
  if (/\.calendar\.json$/i.test(file)) return 'calendar';
  if (/\.smart-db\.json$/i.test(file)) return 'smart-db';
  return 'page';
}

// コメント対象へジャンプ（Phase 2e-ii でバッジと連動・本実装）
function _jumpToCommentTarget(c) {
  const ref = c?.target_ref || {};
  if (c?.target_kind === 'calendar_event') {
    _jumpToCalendarEvent(ref.eventId);
    return;
  }
  if (c?.target_kind === 'text_range' && ref.container?.kind === 'calendar_event') {
    _jumpToCalendarEvent(ref.container.id);
    return;
  }
  const file = c.target_ref?.file || c.target_path || '';
  if (!file) return;
  if (typeof navOpen === 'function') {
    const label = file.split(/[\\/]/).pop() || file;
    const type = _rpCommentNavType(c, file);
    try { navOpen({ type, label, path: file }); } catch {}
  }
  setTimeout(() => {
    let target = null;
    if (c.target_kind === 'text_range') {
      target = c.id ? document.querySelector(`mark.cmt-highlight[data-cmt-id="${_rpEscSel(c.id)}"]`) : null;
      const cont = ref.container || {};
      if (!target && (cont.kind === 'note_line' || cont.kind === 'scriptnote_line') && cont.id) {
        target = document.querySelector(`span._nl-id[data-line-id="${_rpEscSel(cont.id)}"]`)?.parentElement
          || document.querySelector(`.sn2-row[data-row-id="${_rpEscSel(cont.id)}"]`);
      } else if (!target && cont.kind === 'board_card' && cont.id) {
        target = document.querySelector(`#bdn-${_rpEscSel(cont.id)}, .bd-node[data-card-id="${_rpEscSel(cont.id)}"]`);
      } else if (!target && cont.kind === 'board_line' && cont.id) {
        target = document.querySelector(`.bd-conn-hit[data-conn-id="${_rpEscSel(cont.id)}"], .bd-conn-path[data-conn-id="${_rpEscSel(cont.id)}"]`);
      } else if (!target && cont.kind === 'sheet_cell' && cont.entryId && cont.colId) {
        const row = document.querySelector(`tr[data-entity-name="${_rpEscSel(cont.entryId)}"]`);
        target = row?.querySelector(`td[data-prop-name="${_rpEscSel(cont.colId)}"]`) || row;
      }
    } else if ((c.target_kind === 'note_line' || c.target_kind === 'scriptnote_line') && ref.lineId) {
      target = document.querySelector(`span._nl-id[data-line-id="${_rpEscSel(ref.lineId)}"]`)?.parentElement
        || document.querySelector(`.sn2-row[data-row-id="${_rpEscSel(ref.lineId)}"]`);
    } else if (c.target_kind === 'board_card' && ref.cardId) {
      target = document.querySelector(`#bdn-${_rpEscSel(ref.cardId)}, .bd-node[data-card-id="${_rpEscSel(ref.cardId)}"]`);
    } else if (c.target_kind === 'board_line' && ref.lineId) {
      target = document.querySelector(`.bd-conn-hit[data-conn-id="${_rpEscSel(ref.lineId)}"], .bd-conn-path[data-conn-id="${_rpEscSel(ref.lineId)}"]`);
    } else if (c.target_kind === 'sheet_cell' && ref.entryId && ref.colId) {
      const row = document.querySelector(`tr[data-entity-name="${_rpEscSel(ref.entryId)}"]`);
      target = row?.querySelector(`td[data-prop-name="${_rpEscSel(ref.colId)}"]`) || row;
    }
    if (!target) return;
    _flashRpCommentTarget(target);
  }, 350);
}

// 新規コメント作成（§5.2.1: target_kind='none' で作成）
async function newRpComment() {
  const text = await cfPrompt('新規コメントの本文を入力:');
  if (text == null || !text.trim()) return;
  const cur = String((typeof getAnnotationTarget === 'function') ? (getAnnotationTarget() || '') : '');
  try {
    const res = await apiPost('/annotations', {
      type: 'comment',
      target_path: cur || '',
      target_kind: 'none',
      body: text,
      data: { type: 'comment', text: text },
    });
    if (res?.id && typeof _pushAnnotationCreateHistory === 'function') {
      _pushAnnotationCreateHistory(res.id, '注釈: コメント追加', cur || '').catch(() => {});
    }
    if (cur) _invalidateCommentBadgesFor({ target_path: cur });
    // 追加直後は「状態: 全て」ならすぐ見える。未解決でも未解決扱いで見えるはず
    loadRpAnnotationList();
  } catch { showStatus('コメント作成に失敗', true); }
}

// 簡易リスト（stroke/marker/lasso/sticky 向け）
function _renderSimpleAnnotationList(container, items) {
  if (!container.children.length) container.innerHTML = '';
  const h = document.createElement('div');
  h.style.cssText = 'margin-top:6px;padding:4px 6px;color:var(--fg2);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;';
  h.textContent = 'その他';
  container.appendChild(h);
  items.forEach(a => {
    const div = document.createElement('div');
    div.style.cssText = 'padding:6px 8px;border-bottom:1px solid var(--border);font-size:12px;cursor:pointer;';
    const path = (a.target_path || '').split('/').pop() || '(不明)';
    const text = a.data?.text ? a.data.text.substring(0, 60) : (a.type || 'stroke');
    const time = a.created_at ? new Date(a.created_at).toLocaleString('ja') : '';
    div.innerHTML = `<div style="font-weight:bold;color:var(--fg);">${esc(text)}</div>
      <div style="color:var(--fg2);font-size:11px;">${esc(path)} · ${esc(a.user||'')} · ${time}</div>`;
    container.appendChild(div);
  });
}

// 右パネル: 付箋一覧
async function loadRpStickyList() {
  const type = document.getElementById('rp-ann-type');
  if (type) type.value = 'sticky';
  if (typeof openRightPanelTab === 'function') openRightPanelTab('annotation');
  else await loadRpAnnotationList();
}

// 右パネルリサイズ（v5.0: ペインシステムのスプリッターで代替されるが、互換用に残す）
(function() {
  const handle = document.getElementById('right-resize-handle');
  const panel = document.getElementById('right-panel');
  if (!handle || !panel) return; // v5.0: ペインシステムでは非表示のためスキップ
  let startX, startW, maxW;

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startW = panel.offsetWidth;
    // ドラッグ開始時に最大幅を固定（振動防止）
    maxW = document.getElementById('main-area').offsetWidth - 300;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = 'none');
    document.addEventListener('pointermove', onDrag);
    document.addEventListener('pointerup', onUp);
  });

  function onDrag(e) {
    const dx = startX - e.clientX;
    const newW = Math.max(200, Math.min(startW + dx, maxW));
    panel.style.width = newW + 'px';
  }

  function onUp() {
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = '');
    document.removeEventListener('pointermove', onDrag);
    document.removeEventListener('pointerup', onUp);
    localStorage.setItem('right-panel-width', panel.offsetWidth);
  }
})();

/* ==============================
   チャット機能
   ============================== */
/* チャット機能は gb-right-panel-chat.js に分離 */
function openCalendar() {
  // メインカレンダーが設定されていればメインパネルで開く
  const mainCalId = localStorage.getItem('main-calendar-id');
  let mainCalPath = mainCalId ? _fileIdToPath(mainCalId) : '';
  if (!mainCalPath) mainCalPath = localStorage.getItem('main-calendar-path') || '';
  if (mainCalPath) {
    const label = mainCalPath.split('/').pop().replace(/\.json$/, '');
    openCalendarFile(label, mainCalPath);
  } else {
    toggleRightPanelTab('calendar');
  }
}

// 注釈パネルのフィルタ入力にリロードを接続（Phase 2e-i）
(function _setupRpAnnotationFilters() {
  function wire() {
    const search = document.getElementById('rp-ann-search');
    const view = document.getElementById('rp-ann-view');
    const sort = document.getElementById('rp-ann-sort');
    const type = document.getElementById('rp-ann-type');
    const scope = document.getElementById('rp-ann-scope');
    const status = document.getElementById('rp-ann-status');
    const user = document.getElementById('rp-ann-user');
    if (!search || search.dataset.rpBound) return;
    search.dataset.rpBound = '1';
    if (view) view.value = localStorage.getItem('rp-ann-view-mode') || 'preview';
    if (sort) sort.value = localStorage.getItem('rp-ann-sort-mode') || 'modified-desc';
    let tid = 0;
    const clearTargetFilter = () => { delete search.dataset.targetFilter; };
    search.addEventListener('input', () => { clearTargetFilter(); clearTimeout(tid); tid = setTimeout(loadRpAnnotationList, 200); });
    if (view) view.addEventListener('change', () => { localStorage.setItem('rp-ann-view-mode', view.value || 'preview'); loadRpAnnotationList(); });
    if (sort) sort.addEventListener('change', () => { localStorage.setItem('rp-ann-sort-mode', sort.value || 'modified-desc'); loadRpAnnotationList(); });
    if (type) type.addEventListener('change', () => { clearTargetFilter(); loadRpAnnotationList(); });
    if (scope) scope.addEventListener('change', () => { clearTargetFilter(); loadRpAnnotationList(); });
    if (status) status.addEventListener('change', () => { clearTargetFilter(); loadRpAnnotationList(); });
    if (user) user.addEventListener('change', () => { clearTargetFilter(); loadRpAnnotationList(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
