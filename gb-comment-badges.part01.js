/**
 * Meldex Comment Badges (Phase 2e-ii)
 *
 * 各エディタ（ノート / シナリオ / ボード / シート）に
 * コメント件数バッジを描画し、クリックで注釈パネルに該当コメントをフィルタ表示する。
 *
 * 使い方:
 *   CommentBadges.refreshNote(filePath, containerEl);
 *   CommentBadges.refreshScriptnote(filePath, hostEl);
 *   CommentBadges.refreshBoard(filePath, containerEl);   // TODO
 *   CommentBadges.refreshSheet(filePath, containerEl);   // TODO
 *
 * コメント作成/編集/削除後は CommentBadges.invalidate(filePath) を呼ぶこと。
 */
(function () {
  const CACHE_TTL_MS = 3000;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  let _cache = { path: '', items: [], ts: 0, inflight: null };
  const _boardLineCountsByPath = new Map();

  function _normalizeRow(a) {
    try {
      a.target_ref = (typeof a.target_ref === 'string' && a.target_ref)
        ? JSON.parse(a.target_ref) : (a.target_ref || null);
    } catch { a.target_ref = null; }
    try {
      a.data = (typeof a.data === 'string' && a.data) ? JSON.parse(a.data) : (a.data || {});
    } catch { a.data = {}; }
    return a;
  }

  async function fetchComments(filePath) {
    if (!filePath) return [];
    const now = Date.now();
    if (_cache.path === filePath && (now - _cache.ts) < CACHE_TTL_MS && !_cache.inflight) {
      return _cache.items;
    }
    if (_cache.path === filePath && _cache.inflight) return _cache.inflight;
    // レース対策: このフェッチが発行された時点の path を保持し、
    // invalidate() で cache がクリアされていたら結果を書き戻さない
    const requestPath = filePath;
    const p = (async () => {
      try {
        const url = '/annotations?ann_type=comment&target=' + encodeURIComponent(filePath) + '&limit=500';
        const raw = await apiFetch(url);
        const items = (raw || []).map(_normalizeRow).filter(a => !a.data?.deleted);
        // invalidate 後に古い結果で上書きしない
        if (_cache.path === requestPath && _cache.inflight === p) {
          _cache = { path: requestPath, items, ts: Date.now(), inflight: null };
        }
        return items;
      } catch {
        if (_cache.path === requestPath && _cache.inflight === p) {
          _cache = { path: requestPath, items: [], ts: Date.now(), inflight: null };
        }
        return [];
      }
    })();
    _cache.path = requestPath;
    _cache.inflight = p;
    return p;
  }

  function invalidate(filePath) {
    if (!filePath || _cache.path === filePath) {
      _cache = { path: '', items: [], ts: 0, inflight: null };
    }
    if (filePath) _boardLineCountsByPath.delete(filePath);
    if (filePath && typeof setTimeout === 'function') {
      setTimeout(() => { refreshFileIndicator(filePath).catch(() => {}); }, 0);
    }
  }

  function _normalizeCommentPath(value) {
    return String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
  }

  function _sameCommentPath(a, b) {
    const left = _normalizeCommentPath(a);
    const right = _normalizeCommentPath(b);
    if (!left || !right) return false;
    return left === right || left.endsWith('/' + right) || right.endsWith('/' + left);
  }

  function _matchesAnyCommentPath(filePath, candidates) {
    return (candidates || []).some(candidate => _sameCommentPath(filePath, candidate));
  }

  function _currentCommentIndicatorTargets() {
    const candidates = [];
    try { candidates.push(document.getElementById('page-content')?.dataset?.path || ''); } catch {}
    try { candidates.push(typeof state !== 'undefined' ? state.currentPagePath || '' : ''); } catch {}
    try { candidates.push(typeof state !== 'undefined' ? state.currentDbPath || '' : ''); } catch {}
    try { candidates.push(typeof bd !== 'undefined' ? bd?.path || '' : ''); } catch {}
    try {
      if (typeof _sn2Editors !== 'undefined') {
        Object.keys(_sn2Editors || {}).forEach(path => candidates.push(path));
      }
    } catch {}
    return candidates.filter(Boolean);
  }

  function _isIndicatorTargetCurrent(filePath) {
    const targets = _currentCommentIndicatorTargets();
    return !targets.length || _matchesAnyCommentPath(filePath, targets);
  }

  function _isRefreshTargetCurrent(filePath, containerEl, kind) {
    const data = containerEl?.dataset || {};
    const explicitTargets = [data.path, data.filePath, data.sourcePath, data.dbPath].filter(Boolean);
    if (explicitTargets.length) return _matchesAnyCommentPath(filePath, explicitTargets);
    try {
      if (containerEl?.isConnected === false) return false;
    } catch {}
    if (kind === 'note') {
      const candidates = [];
      try { candidates.push(document.getElementById('page-content')?.dataset?.path || ''); } catch {}
      try { candidates.push(typeof state !== 'undefined' ? state.currentPagePath || '' : ''); } catch {}
      return !candidates.some(Boolean) || _matchesAnyCommentPath(filePath, candidates);
    }
    if (kind === 'scriptnote') {
      try {
        if (typeof _sn2Editors !== 'undefined') {
          const direct = _sn2Editors[filePath];
          if (direct?.host === containerEl) return true;
          for (const [path, editor] of Object.entries(_sn2Editors || {})) {
            if (editor?.host === containerEl) return _sameCommentPath(filePath, path);
          }
        }
      } catch {}
      return true;
    }
    if (kind === 'board') {
      const boardPath = (() => { try { return typeof bd !== 'undefined' ? bd?.path || '' : ''; } catch { return ''; } })();
      return !boardPath || _sameCommentPath(filePath, boardPath);
    }
    if (kind === 'sheet') {
      const candidates = [];
      try { candidates.push(typeof state !== 'undefined' ? state.currentDbPath || '' : ''); } catch {}
      try { candidates.push(typeof state !== 'undefined' ? state.currentSmartDb?._filePath || '' : ''); } catch {}
      return !candidates.some(Boolean) || _matchesAnyCommentPath(filePath, candidates);
    }
    return true;
  }

  function _isCommentLayerEnabled(options) {
    if (options?.force) return true;
    if (typeof MeldexDisplayLayers === 'undefined') return true;
    return MeldexDisplayLayers.isEnabled('comments');
  }

  function _clearCommentLayer(containerEl) {
    if (!containerEl) return;
    try { _clearNoteCommentHighlights(containerEl); } catch {}
    containerEl.querySelectorAll('.cmt-badge,.cmt-cal-badge,.cmt-cal-clock-badge').forEach(el => el.remove());
    document.querySelectorAll('.bd-line-comment-badge').forEach(el => el.remove());
    containerEl.querySelectorAll('.cmt-line-highlight').forEach(el => el.classList.remove('cmt-line-highlight'));
    containerEl.querySelectorAll('.gb-cal-clock-event-slice').forEach(el => {
      delete el.dataset.commentCount;
      el.style.removeProperty('stroke');
      el.style.removeProperty('stroke-width');
    });
    containerEl.querySelectorAll('.bd-comment-hud').forEach(hud => {
      try { _updateBoardCommentHud(hud, 0); } catch {}
    });
  }

  function _activeCommentCount(items) {
    return (items || []).filter(a => !a.orphan && !a.resolved && !a.data?.deleted).length;
  }

  function _commentBadgeLabel(n) {
    return (n || 0) + '件のコメントを開く';
  }

  function _setCommentBadgeControlAttrs(badge, n) {
    if (!badge) return;
    const label = _commentBadgeLabel(n);
    try { badge.setAttribute('role', 'button'); } catch {}
    try { badge.setAttribute('tabindex', '0'); } catch {}
    try { badge.setAttribute('aria-label', label); } catch {}
    try { badge.tabIndex = 0; } catch {}
  }

  function _handleCommentBadgeKeydown(e, badge) {
    if (!e || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    e.stopPropagation();
    try { badge?._cmtClick?.(); } catch {}
  }

  function _setToolbarIndicator(filePath, count) {
    document.querySelectorAll('[data-display-layer="comments"]').forEach(btn => {
      btn.dataset.commentIndicatorPath = filePath || '';
      let badge = btn.querySelector(':scope > .display-layer-badge');
      if (count <= 0) {
        if (badge) badge.remove();
        return;
      }
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'display-layer-badge';
        badge.style.cssText = 'position:absolute;top:2px;right:2px;min-width:7px;height:7px;padding:0 2px;border-radius:999px;background:var(--accent,#4a90e2);box-shadow:0 0 0 1px var(--bg2);font-size:9px;line-height:10px;color:var(--ui-accent-fg, var(--ui-fg-strong));pointer-events:none;';
        btn.style.position = btn.style.position || 'relative';
        btn.appendChild(badge);
      }
      badge.textContent = count > 9 ? '9+' : '';
      badge.title = count + '件の未解決コメント';
    });
  }

  async function refreshFileIndicator(filePath) {
    if (!filePath) {
      _setToolbarIndicator('', 0);
      return;
    }
    const requestPath = filePath;
    const items = await fetchComments(filePath);
    if (!_isIndicatorTargetCurrent(requestPath)) return;
    _setToolbarIndicator(requestPath, _activeCommentCount(items));
  }

  // コメント一覧から target_kind + アンカー別の未解決件数マップを構築
  function buildCountMap(items) {
    const m = {
      note_line: new Map(),
      scriptnote_line: new Map(),
      board_card: new Map(),
      board_line: new Map(),
      sheet_cell: new Map(),
      calendar_event: new Map(),
    };
    for (const a of items) {
      if (a.orphan || a.resolved) continue;
      const k = a.target_kind;
      const r = a.target_ref || {};
      if ((k === 'note_line' || k === 'scriptnote_line') && r.lineId) {
        const map = m[k];
        map.set(r.lineId, (map.get(r.lineId) || 0) + 1);
      } else if (k === 'board_card' && r.cardId) {
        m.board_card.set(r.cardId, (m.board_card.get(r.cardId) || 0) + 1);
      } else if (k === 'board_line' && r.lineId) {
        m.board_line.set(r.lineId, (m.board_line.get(r.lineId) || 0) + 1);
      } else if (k === 'sheet_cell' && r.entryId && r.colId) {
        const key = r.entryId + '\x00' + r.colId;
        m.sheet_cell.set(key, (m.sheet_cell.get(key) || 0) + 1);
      } else if (k === 'calendar_event' && r.eventId) {
        m.calendar_event.set(r.eventId, (m.calendar_event.get(r.eventId) || 0) + 1);
      }
      // text_range は container 要素のバッジに +1 する（container があれば）
      if (k === 'text_range' && r.container) {
        const c = r.container;
        if ((c.kind === 'note_line' || c.kind === 'scriptnote_line') && c.id) {
          const map = m[c.kind];
          map.set(c.id, (map.get(c.id) || 0) + 1);
        } else if (c.kind === 'board_card' && c.id) {
          m.board_card.set(c.id, (m.board_card.get(c.id) || 0) + 1);
        } else if (c.kind === 'board_line' && c.id) {
          m.board_line.set(c.id, (m.board_line.get(c.id) || 0) + 1);
        } else if (c.kind === 'sheet_cell' && c.entryId && c.colId) {
          const key = c.entryId + '\x00' + c.colId;
          m.sheet_cell.set(key, (m.sheet_cell.get(key) || 0) + 1);
        } else if (c.kind === 'calendar_event' && c.id) {
          m.calendar_event.set(c.id, (m.calendar_event.get(c.id) || 0) + 1);
        }
      }
    }
    return m;
  }

  function _ensureBadge(hostEl, n, onClick) {
    if (!hostEl) return;
    let badge = hostEl.querySelector(':scope > .cmt-badge');
    if (n <= 0) { if (badge) badge.remove(); return; }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'cmt-badge';
      badge.contentEditable = 'false';
      badge.style.cssText = 'display:inline-flex;align-items:center;gap:2px;font-size:10px;padding:0 5px;margin-left:6px;background:var(--accent,#4a90e2);color:var(--ui-accent-fg, var(--ui-fg-strong));border-radius:8px;cursor:pointer;user-select:none;vertical-align:middle;line-height:14px;height:14px;';
      badge.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
      badge.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); try { badge._cmtClick?.(); } catch {} });
      badge.addEventListener('keydown', (e) => _handleCommentBadgeKeydown(e, badge));
      hostEl.appendChild(badge);
    }
    badge.textContent = '💬' + n;
    badge.title = n + '件のコメント';
    _setCommentBadgeControlAttrs(badge, n);
    if (typeof onClick === 'function') badge._cmtClick = onClick;
  }

  function _cssEscape(value) {
    return MeldexEscape.cssIdent(value);
  }

  function _clearNoteCommentHighlights(containerEl) {
    containerEl.querySelectorAll('mark.cmt-highlight').forEach(mark => {
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      mark.remove();
      parent.normalize?.();
    });
    containerEl.querySelectorAll('.cmt-line-highlight').forEach(el => {
      el.classList.remove('cmt-line-highlight');
      delete el.dataset.cmtFile;
      delete el.dataset.cmtLineId;
    });
  }

  function _noteLineBlock(containerEl, lineId) {
    if (!containerEl || !lineId) return null;
    return containerEl.querySelector(`span._nl-id[data-line-id="${_cssEscape(lineId)}"]`)?.parentElement || null;
  }

  function _wrapFirstSnippetInBlock(block, snippet, commentId, filePath) {
    const needle = String(snippet || '').trim();
    if (!block || !needle) return false;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest('mark.cmt-highlight,.cmt-badge,._nl-id')) return NodeFilter.FILTER_REJECT;
        return node.nodeValue && node.nodeValue.includes(needle) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    const node = walker.nextNode();
    if (!node) return false;
    const index = node.nodeValue.indexOf(needle);
    if (index < 0) return false;
    const after = node.splitText(index + needle.length);
    const matched = node.splitText(index);
    const mark = document.createElement('mark');
    mark.className = 'cmt-highlight';
    mark.dataset.cmtId = commentId || '';
    mark.dataset.cmtFile = filePath || '';
    mark.title = 'コメントあり';
    matched.parentNode.insertBefore(mark, after);
    mark.appendChild(matched);
    return true;
  }

  function _applyNoteCommentHighlights(filePath, containerEl, items) {
    (items || []).forEach(a => {
      if (a.orphan || a.resolved || a.data?.deleted) return;
      const ref = a.target_ref || {};
      let block = null;
      if (a.target_kind === 'note_line' && ref.lineId) {
        block = _noteLineBlock(containerEl, ref.lineId);
      } else if (a.target_kind === 'text_range' && ref.container?.kind === 'note_line' && ref.container.id) {
        block = _noteLineBlock(containerEl, ref.container.id);
        const snippet = ref.snippet || a.target_snapshot || '';
        if (_wrapFirstSnippetInBlock(block, snippet, a.id, filePath)) return;
        if (_wrapFirstSnippetInBlock(containerEl, snippet, a.id, filePath)) return;
      }
      if (!block) return;
      block.classList.add('cmt-line-highlight');
      block.dataset.cmtFile = filePath || '';
      block.dataset.cmtLineId = ref.lineId || ref.container?.id || '';
    });
  }

  async function refreshNote(filePath, containerEl, options) {
    if (!containerEl || !filePath) return;
    if (!_isCommentLayerEnabled(options)) {
      _clearCommentLayer(containerEl);
      return;
    }
    const items = await fetchComments(filePath);
    if (!_isRefreshTargetCurrent(filePath, containerEl, 'note')) return;
    _clearNoteCommentHighlights(containerEl);
    _applyNoteCommentHighlights(filePath, containerEl, items);
    const counts = buildCountMap(items).note_line;
    containerEl.querySelectorAll('span._nl-id[data-line-id]').forEach(span => {
      const lid = span.dataset.lineId;
      const block = span.parentElement;
      if (!block) return;
      _ensureBadge(block, counts.get(lid) || 0,
        () => _openPanelForTarget(filePath, 'note_line', { file: filePath, lineId: lid }));
    });
  }

  async function refreshScriptnote(filePath, hostEl, options) {
    if (!hostEl || !filePath) return;
    if (!_isCommentLayerEnabled(options)) {
      _clearCommentLayer(hostEl);
      return;
    }
    const items = await fetchComments(filePath);
    if (!_isRefreshTargetCurrent(filePath, hostEl, 'scriptnote')) return;
    const counts = buildCountMap(items).scriptnote_line;
    hostEl.querySelectorAll('.sn2-row[data-row-id]').forEach(row => {
      const rid = row.dataset.rowId;
      row.classList.toggle('cmt-line-highlight', (counts.get(rid) || 0) > 0);
      _ensureBadge(row, counts.get(rid) || 0,
        () => _openPanelForTarget(filePath, 'scriptnote_line', { file: filePath, lineId: rid }));
    });
  }

  async function refreshBoard(filePath, containerEl, options) {
    if (!containerEl || !filePath) return;
    if (!_isCommentLayerEnabled(options)) {
      _boardLineCountsByPath.delete(filePath);
      _clearCommentLayer(containerEl);
      return;
    }
    const started = typeof bdPerfStart === 'function' ? bdPerfStart('CommentBadges.refreshBoard') : 0;
    const items = await fetchComments(filePath);
    if (!_isRefreshTargetCurrent(filePath, containerEl, 'board')) {
      if (typeof bdPerfEnd === 'function') bdPerfEnd('CommentBadges.refreshBoard', started, 'stale');
      return;
    }
    const maps = buildCountMap(items);
    const counts = maps.board_card;
    _boardLineCountsByPath.set(filePath, maps.board_line);
    const targetIds = options?.cardIds ? new Set(options.cardIds) : null;
    // ボードカード要素は id="bdn-<cardId>" の .bd-node（gb-canvas-engine.js 準拠）
    containerEl.querySelectorAll('.bd-node').forEach(card => {
      const cid = card.dataset.cardId || (card.id && card.id.startsWith('bdn-') ? card.id.slice(4) : '');
      if (!cid) return;
      if (targetIds && !targetIds.has(cid)) return;
      // 2026-04-18: ボードの HUD 化に伴い、旧 .cmt-badge は使用せず新 .bd-comment-hud に一本化
      // する。もし旧バッジが残っていれば削除し、HUD の件数/empty 状態を counts から再計算する。
      const legacyBadge = card.querySelector(':scope > .cmt-badge');
      if (legacyBadge) legacyBadge.remove();
      const hud = card.querySelector(':scope > .bd-comment-hud');
      if (!hud) return;
      const n = counts.get(cid) || 0;
      card.classList.toggle('cmt-line-highlight', n > 0);
      _updateBoardCommentHud(hud, n);
    });
    if (typeof bdPerfEnd === 'function') {
      bdPerfEnd('CommentBadges.refreshBoard', started, targetIds ? `cards=${targetIds.size}` : 'all');
    }
    try {
      if (typeof bd !== 'undefined' && bd?.path === filePath && typeof bdDrawConns === 'function') {
        bdDrawConns({ reason: 'comment-badges' });
      }
    } catch {}
  }

  function getBoardLineCount(lineId, filePath) {
    if (!_isCommentLayerEnabled()) return 0;
    const path = filePath || (typeof bd !== 'undefined' ? bd?.path : '') || '';
    const counts = _boardLineCountsByPath.get(path);
    return counts?.get(lineId) || 0;
  }

  function _updateBoardCommentHud(hud, n) {
    if (n > 0) {
      hud.classList.remove('empty');
      hud.textContent = String(n);
      hud.title = n + '件のコメント';
    } else {
      hud.classList.add('empty');
      hud.innerHTML = typeof lucide === 'function' ? lucide('messageSquarePlus', 10) : '+';
      hud.title = 'コメントを追加';
    }
  }

  // カレンダーイベント要素は小さいため、通常のインラインバッジだと表示が崩れる。
  // 絶対配置の小型バッジを右上にオーバーレイする。
  function _ensureCalendarBadge(hostEl, n, onClick) {
    if (!hostEl) return;
    let badge = hostEl.querySelector(':scope > .cmt-cal-badge');
    if (n <= 0) { if (badge) badge.remove(); return; }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'cmt-cal-badge';
      badge.contentEditable = 'false';
      badge.style.cssText = 'position:absolute;top:-4px;right:-4px;z-index:2;display:inline-flex;align-items:center;justify-content:center;font-size:9px;min-width:14px;height:12px;padding:0 3px;background:var(--accent,#4a90e2);color:var(--ui-accent-fg, var(--ui-fg-strong));border-radius:8px;cursor:pointer;user-select:none;line-height:12px;pointer-events:auto;box-shadow:0 0 0 1px var(--bg2);';
      badge.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
      badge.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); try { badge._cmtClick?.(); } catch {} });
      badge.addEventListener('keydown', (e) => _handleCommentBadgeKeydown(e, badge));
      hostEl.appendChild(badge);
    }
    badge.textContent = '💬' + n;
    badge.title = n + '件のコメント';
    _setCommentBadgeControlAttrs(badge, n);
    if (typeof onClick === 'function') badge._cmtClick = onClick;
  }

  function _clockSliceTitle(hostEl) {
    try {
      return Array.from(hostEl?.children || []).find(el => String(el.tagName || '').toLowerCase() === 'title') || null;
    } catch {
      return null;
    }
  }

  function _ensureClockCalendarBadge(hostEl, n, onClick) {
    if (!hostEl) return;
    let badge = hostEl._cmtClockBadge;
    if (badge && !badge.isConnected) badge = null;
    if (n <= 0) {
      if (badge) badge.remove();
      hostEl._cmtClockBadge = null;
      delete hostEl.dataset.commentCount;
      hostEl.style.removeProperty('stroke');
      hostEl.style.removeProperty('stroke-width');
      const title = _clockSliceTitle(hostEl);
      if (title?.dataset?.baseTitle) title.textContent = title.dataset.baseTitle;
      return;
    }
    hostEl.dataset.commentCount = String(n);
    hostEl.style.stroke = 'var(--annotation-accent, var(--accent))';
    hostEl.style.strokeWidth = '3';
    const title = _clockSliceTitle(hostEl);
    if (title) {
      if (!title.dataset.baseTitle) title.dataset.baseTitle = title.textContent || '予定';
      title.textContent = `${title.dataset.baseTitle} / ${n}件のコメント`;
    }
    if (!badge) {
      badge = document.createElementNS(SVG_NS, 'text');
      badge.classList.add('cmt-cal-clock-badge');
      badge.setAttribute('text-anchor', 'middle');
      badge.setAttribute('dominant-baseline', 'middle');
      badge.setAttribute('font-size', '10');
      badge.setAttribute('font-weight', '700');
      badge.setAttribute('fill', 'var(--ui-fg-strong)');
      badge.setAttribute('paint-order', 'stroke');
      badge.setAttribute('stroke', 'var(--annotation-accent, var(--accent))');
      badge.setAttribute('stroke-width', '3');
      badge.style.cursor = 'pointer';
      badge.style.pointerEvents = 'auto';
      badge.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
      badge.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); try { badge._cmtClick?.(); } catch {} });
      badge.addEventListener('keydown', (e) => _handleCommentBadgeKeydown(e, badge));
      hostEl.parentNode?.appendChild(badge);
      hostEl._cmtClockBadge = badge;
    }
    badge.dataset.eventId = hostEl.dataset.eventId || '';
    badge.textContent = n > 9 ? '9+' : String(n);
    _setCommentBadgeControlAttrs(badge, n);
    badge._cmtClick = typeof onClick === 'function' ? onClick : null;
    try {
      const box = hostEl.getBBox();
      badge.setAttribute('x', String(box.x + (box.width / 2)));
      badge.setAttribute('y', String(box.y + (box.height / 2)));
    } catch {
      badge.setAttribute('x', '128');
      badge.setAttribute('y', '128');
    }
  }

  // Audit-P1 H-6 (残作業): カレンダーイベント要素にコメントバッジを描画する。
  // calendar_event コメントは ev.calendar_id をキーにして保存されるため、
  // カレンダーコンポーネントから見えるイベントの calendar_id 一覧を走査して一括取得する。
  async function refreshCalendar(containerEl, options) {
    if (!containerEl) return;
    if (!_isCommentLayerEnabled(options)) {
      _clearCommentLayer(containerEl);
      return;
    }
    const evEls = [...containerEl.querySelectorAll('.gb-cal-day-event[data-event-id], .gb-cal-clock-event-slice[data-event-id]')];
    if (!evEls.length) return;
    // calendar_id の一覧を抽出
    const calIds = new Set();
    evEls.forEach(el => {
      const cid = el.dataset.calendarId || '_calendar';
      calIds.add(cid);
    });
    // eventId → count の集計
    const counts = new Map();
    await Promise.all([...calIds].map(async (cid) => {
      try {
        const url = '/annotations?ann_type=comment&target=' + encodeURIComponent(cid) + '&limit=500';
        const raw = await apiFetch(url);
        (raw || []).forEach(c => {
          try { c.target_ref = typeof c.target_ref === 'string' ? JSON.parse(c.target_ref) : c.target_ref; } catch { c.target_ref = null; }
          try { c.data = typeof c.data === 'string' ? JSON.parse(c.data) : (c.data || {}); } catch { c.data = {}; }
          if (c.data?.deleted) return;
          if (c.orphan || c.resolved) return;
          let eid = '';
          if (c.target_kind === 'calendar_event') {
            eid = c.target_ref?.eventId || '';
          } else if (c.target_kind === 'text_range' && c.target_ref?.container?.kind === 'calendar_event') {
            eid = c.target_ref.container.id || '';
          }
          if (!eid) return;
          counts.set(eid, (counts.get(eid) || 0) + 1);
        });
      } catch (_) {}
    }));
    evEls.forEach(evEl => {
      const eid = evEl.dataset.eventId;
      const cid = evEl.dataset.calendarId || '_calendar';
      const n = counts.get(eid) || 0;
      evEl.classList.toggle('cmt-line-highlight', n > 0);
      const open = () => _openPanelForTarget(cid, 'calendar_event', { file: cid, eventId: eid });
      if (evEl.classList.contains('gb-cal-clock-event-slice')) {
        _ensureClockCalendarBadge(evEl, n, open);
      } else {
        _ensureCalendarBadge(evEl, n, open);
      }
    });
  }

  function refreshVisibleCalendarCommentBadges() {
    document.querySelectorAll('.gb-cal-content').forEach(container => {
      try { refreshCalendar(container); } catch (_) {}
    });
  }

  async function refreshSheet(filePath, containerEl, options) {
    if (!containerEl || !filePath) return;
    if (!_isCommentLayerEnabled(options)) {
      _clearCommentLayer(containerEl);
      return;
    }
    const items = await fetchComments(filePath);
    if (!_isRefreshTargetCurrent(filePath, containerEl, 'sheet')) return;
    const counts = buildCountMap(items).sheet_cell;
    // renderPivot 準拠: tr[data-entity-name] > td[data-prop-name]
    // entryId=entityName, colId=propName
    containerEl.querySelectorAll('tr[data-entity-name]').forEach(tr => {
      const entryId = tr.dataset.entityName;
      tr.querySelectorAll('td[data-prop-name]').forEach(td => {
        const colId = td.dataset.propName;
        const key = entryId + '\x00' + colId;
        const n = counts.get(key) || 0;
        td.classList.toggle('cmt-line-highlight', n > 0);
        _ensureBadge(td, counts.get(key) || 0,
          () => _openPanelForTarget(filePath, 'sheet_cell', { file: filePath, entryId, colId }));
      });
    });
  }

  // バッジクリック時: 注釈タブを開いて該当コメントを絞り込む
  function _openPanelForTarget(filePath, targetKind, targetRef) {
    const panel = document.getElementById('right-panel');
    const activeTab = document.querySelector('.rp-tab.active')?.dataset.rpTab;
    if (!panel?.classList.contains('open') || activeTab !== 'annotation') {
      if (typeof toggleRightPanelTab === 'function') toggleRightPanelTab('annotation');
      else if (typeof switchRightTab === 'function') switchRightTab('annotation');
    }
    const typeSel = document.getElementById('rp-ann-type'); if (typeSel) typeSel.value = 'comment';
    const scopeSel = document.getElementById('rp-ann-scope'); if (scopeSel) scopeSel.value = 'current';
    const statusSel = document.getElementById('rp-ann-status'); if (statusSel) statusSel.value = 'all';
    const searchEl = document.getElementById('rp-ann-search');
    if (searchEl) {
      searchEl.value = '';
      searchEl.dataset.targetFilter = JSON.stringify({ targetPath: filePath, targetKind, targetRef });
    }
    if (typeof loadRpAnnotationList === 'function') loadRpAnnotationList();
  }

  function openPanelForFileComments(filePath) {
    const panel = document.getElementById('right-panel');
    const activeTab = document.querySelector('.rp-tab.active')?.dataset.rpTab;
    if (!panel?.classList.contains('open') || activeTab !== 'annotation') {
      if (typeof openRightPanelTab === 'function') openRightPanelTab('annotation');
      else if (typeof toggleRightPanelTab === 'function') toggleRightPanelTab('annotation');
      else if (typeof switchRightTab === 'function') switchRightTab('annotation');
    }
    const typeSel = document.getElementById('rp-ann-type'); if (typeSel) typeSel.value = 'comment';
    const scopeSel = document.getElementById('rp-ann-scope'); if (scopeSel) scopeSel.value = 'current';
    const statusSel = document.getElementById('rp-ann-status'); if (statusSel) statusSel.value = 'open';
    const searchEl = document.getElementById('rp-ann-search');
    if (searchEl) {
      searchEl.value = '';
      searchEl.dataset.targetFilter = JSON.stringify({ targetPath: filePath || '' });
    }
    if (typeof loadRpAnnotationList === 'function') loadRpAnnotationList();
  }


  // === Phase 2e-iii + 2f: コメント追加 ===

  // 現在のフォーカス/選択からコメント対象を推定
  // scanOverride: 右クリックメニュー等から明示的に起点 DOM 要素を渡す場合に使用。
  //   省略時は window.getSelection() のアンカー or document.activeElement から推定する。
  // return: { targetKind, filePath, targetRef, snapshot }
  //   targetKind: 'note_line' | 'scriptnote_line' | 'text_range' | 'none'
  function detectCommentContext(scanOverride) {
    const sel = window.getSelection && window.getSelection();
    const selText = (sel && !sel.isCollapsed) ? sel.toString().trim() : '';
    const anchor = sel && sel.anchorNode;
    const startEl = anchor && (anchor.nodeType === 3 ? anchor.parentElement : anchor);
    const active = document.activeElement;
    const scan = scanOverride || startEl || active;

    // 1) ノート系: #page-content 配下
    const pc = document.getElementById('page-content');
    if (pc && scan && pc.contains(scan)) {
      const filePath = pc.dataset.path || (typeof state !== 'undefined' ? state.currentPagePath : '') || '';
      const block = _findNoteLineBlock(scan, pc);
      if (selText) {
        const containerInfo = _noteLineContainerInfo(block);
        return {
          targetKind: 'text_range', filePath,
          targetRef: {
            file: filePath,
            container: containerInfo,
            anchorKind: 'offset',
            snippet: selText.slice(0, 200),
          },
          snapshot: selText.slice(0, 200),
        };
      }
      if (block) {
        // 既存ID優先、無ければ遅延付与
        let lineId = '';
        const span = [...block.children].find(c => c.classList?.contains('_nl-id'));
        if (span && block.firstElementChild === span) lineId = span.dataset.lineId || '';
        if (!lineId && typeof getOrAssignNoteLineId === 'function') {
          lineId = getOrAssignNoteLineId(block);
        }
        if (lineId) {
          return {
            targetKind: 'note_line', filePath,
            targetRef: { file: filePath, lineId },
            snapshot: (block.textContent || '').trim().slice(0, 120),
          };
        }
      }
    }

    // 2a) ボードカード: .bd-node 配下
    const bdCard = scan && scan.closest ? scan.closest('.bd-node') : null;
    if (bdCard && bdCard.id && bdCard.id.startsWith('bdn-')) {
      const cardId = bdCard.dataset.cardId || bdCard.id.slice(4);
      const filePath = (typeof bd !== 'undefined' && bd?.path) || (typeof state !== 'undefined' ? state.currentBoardPath : '') || '';
      if (selText) {
        return {
          targetKind: 'text_range', filePath,
          targetRef: {
            file: filePath,
            container: { kind: 'board_card', id: cardId },
            anchorKind: 'offset',
            snippet: selText.slice(0, 200),
          },
          snapshot: selText.slice(0, 200),
        };
      }
      return {
        targetKind: 'board_card', filePath,
        targetRef: { file: filePath, cardId },
        snapshot: (bdCard.textContent || '').trim().slice(0, 120),
      };
    }

    // 2b) シートセル: td[data-prop-name] > tr[data-entity-name]
    const cellTd = scan && scan.closest ? scan.closest('td[data-prop-name]') : null;
    const entryTr = cellTd && cellTd.closest('tr[data-entity-name]');
    if (cellTd && entryTr) {
      const entryId = entryTr.dataset.entityName;
      const colId = cellTd.dataset.propName;
      const filePath = (typeof state !== 'undefined' ? state.currentDbPath : '') || '';
      if (selText) {
        return {
          targetKind: 'text_range', filePath,
          targetRef: {
            file: filePath,
            container: { kind: 'sheet_cell', entryId, colId },
            anchorKind: 'offset',
            snippet: selText.slice(0, 200),
          },
          snapshot: selText.slice(0, 200),
        };
      }
      return {
        targetKind: 'sheet_cell', filePath,
        targetRef: { file: filePath, entryId, colId },
        snapshot: (cellTd.textContent || '').trim().slice(0, 120),
      };
    }

    // 2c) カレンダーイベント: .gb-cal-day-event / アナログ時計スライス
    const calEv = scan && scan.closest ? scan.closest('.gb-cal-day-event[data-event-id], .gb-cal-clock-event-slice[data-event-id]') : null;
    if (calEv) {
      const eventId = calEv.dataset.eventId;
      const calendarId = calEv.dataset.calendarId || '_calendar';
      const label = (calEv.textContent || '').trim().slice(0, 120);
      if (selText) {
        return {
          targetKind: 'text_range', filePath: calendarId,
          targetRef: {
            file: calendarId,
            container: { kind: 'calendar_event', id: eventId },
            anchorKind: 'offset',
            snippet: selText.slice(0, 200),
          },
          snapshot: selText.slice(0, 200),
        };
      }
      return {
        targetKind: 'calendar_event', filePath: calendarId,
        targetRef: { file: calendarId, eventId },
        snapshot: label,
      };
    }

    // 3) シナリオ系: .sn2-row 配下
    const snRow = scan && scan.closest ? scan.closest('.sn2-row[data-row-id]') : null;
    if (snRow) {
      const host = snRow.closest('[data-sn2-path]') || snRow.closest('.sn2-host');
      const filePath = (host && host.dataset.sn2Path) || _findScriptnotePath(snRow);
      const rowId = snRow.dataset.rowId;
      if (selText) {
        return {
          targetKind: 'text_range', filePath,
          targetRef: {
            file: filePath,
            container: { kind: 'scriptnote_line', id: rowId },
            anchorKind: 'offset',
            snippet: selText.slice(0, 200),
          },
          snapshot: selText.slice(0, 200),
        };
      }
      return {
        targetKind: 'scriptnote_line', filePath,
        targetRef: { file: filePath, lineId: rowId },
        snapshot: (snRow.querySelector('.sn2-text')?.textContent || '').trim().slice(0, 120),
      };
    }

    // 3) フォールバック: 未紐付
    let curPath = (typeof getAnnotationTarget === 'function') ? getAnnotationTarget() : '';
    // 'unknown' 等のフォールバック文字列を弾く（/ を含むパスのみ有効）
    if (curPath && !curPath.includes('/')) curPath = '';
    return { targetKind: 'none', filePath: curPath || '', targetRef: null, snapshot: '' };
  }

  function _findNoteLineBlock(el, stopAt) {
    let cur = el;
    while (cur && cur !== stopAt) {
      if (cur.nodeType === 1 && cur.parentElement === stopAt) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function _noteLineContainerInfo(block) {
    if (!block) return null;
    // 既存の行ID span を探す
    let span = [...block.children].find(c => c.classList?.contains('_nl-id'));
    let lineId = span?.dataset?.lineId || '';
    // 未採番なら遅延付与を試みる
    if (!lineId && typeof getOrAssignNoteLineId === 'function') {
      lineId = getOrAssignNoteLineId(block) || '';
    }
    return lineId ? { kind: 'note_line', id: lineId } : null;
  }

  function _findScriptnotePath(snRow) {
    // _sn2Editors 逆引き
    try {
      if (typeof _sn2Editors !== 'undefined') {
        for (const [p, ed] of Object.entries(_sn2Editors)) {
          if (ed?.host && ed.host.contains(snRow)) return p;
        }
      }
    } catch {}
    return '';
  }

  // Audit-P1 H-5: インライン textarea によるコメント入力。
  // anchorEl の近傍に textarea を表示し、Enter=保存 / ESC=キャンセル / blur=保存 / Shift+Enter=改行。
  function _promptInlineComment(anchorEl, initialText, kindLabel) {
    return new Promise((resolve) => {
      document.querySelectorAll('._inline-comment-input').forEach(el => el.remove());
      const box = document.createElement('div');
      const labelId = 'inline-comment-input-label-' + Date.now().toString(36);
      box.className = '_inline-comment-input gb-inline-comment-popup';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'false');
      box.setAttribute('aria-labelledby', labelId);
      // mousedown で親側の選択破壊を防ぐ
      box.addEventListener('mousedown', (ev) => { if (ev.target.tagName !== 'TEXTAREA') ev.preventDefault(); });
      const label = document.createElement('div');
      label.id = labelId;
      label.className = 'gb-inline-comment-popup-label';
      label.textContent = 'コメントを追加 (対象: ' + (kindLabel || '') + ')';
      box.appendChild(label);
      const ta = document.createElement('textarea');
      ta.className = 'gb-inline-comment-popup-textarea';
      ta.value = initialText || '';
      ta.placeholder = 'Enter=保存, Shift+Enter=改行, ESC=キャンセル';
      ta.setAttribute('aria-label', 'コメント本文');
      box.appendChild(ta);
      document.body.appendChild(box);
      try {
        if (typeof positionPopup === 'function' && anchorEl && typeof anchorEl.getBoundingClientRect === 'function') {
          positionPopup(box, anchorEl.getBoundingClientRect());
        } else if (anchorEl && typeof anchorEl.getBoundingClientRect === 'function') {
          const z = typeof _getZoom === 'function' ? _getZoom() : 1;
          const r = anchorEl.getBoundingClientRect();
          box.style.left = ((r.right + 8) / z) + 'px';
          box.style.top = (r.top / z) + 'px';
          if (typeof clampPopupToViewport === 'function') clampPopupToViewport(box);
        }
      } catch (_) {}
      let resolved = false;
      const finalize = (val) => {
        if (resolved) return;
        resolved = true;
        try { box.remove(); } catch (_) {}
        resolve(val);
      };
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
          e.preventDefault();
          finalize(ta.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finalize(null);
        }
      });
      // blur は Escape 押下での finalize と競合するため次フレームに遅延
      ta.addEventListener('blur', () => { setTimeout(() => finalize(ta.value), 0); });
      setTimeout(() => { try { ta.focus(); } catch (_) {} }, 0);
    });
  }

  function _commentPromptAnchorFromContext(ctx) {
    const cssEscape = MeldexEscape.cssIdent;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const kind = ctx?.targetKind || '';
    const container = ctx?.targetRef?.container || null;
    if ((kind === 'note_line' || kind === 'scriptnote_line') && ctx?.targetRef?.lineId) {
      const target = document.querySelector(`span._nl-id[data-line-id="${cssEscape(ctx.targetRef.lineId)}"]`)?.parentElement
        || document.querySelector(`.sn2-row[data-row-id="${cssEscape(ctx.targetRef.lineId)}"]`);
      if (target) return target;
    }
    if (kind === 'board_card' && ctx?.targetRef?.cardId) {
