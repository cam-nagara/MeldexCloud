      const target = document.getElementById('bdn-' + ctx.targetRef.cardId);
      if (target) return target;
    }
    if (kind === 'board_line' && ctx?.targetRef?.lineId) {
      const target = document.querySelector(`.bd-conn-hit[data-conn-id="${cssEscape(ctx.targetRef.lineId)}"]`)
        || document.querySelector(`.bd-conn-path[data-conn-id="${cssEscape(ctx.targetRef.lineId)}"]`);
      if (target) return target;
    }
    if (kind === 'sheet_cell' && ctx?.targetRef?.entryId && ctx?.targetRef?.colId) {
      const target = document.querySelector(`tr[data-entity-name="${cssEscape(ctx.targetRef.entryId)}"] td[data-prop-name="${cssEscape(ctx.targetRef.colId)}"]`);
      if (target) return target;
    }
    if (kind === 'calendar_event' && ctx?.targetRef?.eventId) {
      const target = document.querySelector(`.gb-cal-day-event[data-event-id="${cssEscape(ctx.targetRef.eventId)}"], .gb-cal-clock-event-slice[data-event-id="${cssEscape(ctx.targetRef.eventId)}"]`);
      if (target) return target;
    }
    if (kind === 'text_range' && container) {
      if (container.kind === 'board_card' && container.id) {
        const target = document.getElementById('bdn-' + container.id);
        if (target) return target;
      }
      if (container.kind === 'board_line' && container.id) {
        const target = document.querySelector(`.bd-conn-hit[data-conn-id="${cssEscape(container.id)}"]`)
          || document.querySelector(`.bd-conn-path[data-conn-id="${cssEscape(container.id)}"]`);
        if (target) return target;
      }
      if (container.kind === 'sheet_cell' && container.entryId && container.colId) {
        const target = document.querySelector(`tr[data-entity-name="${cssEscape(container.entryId)}"] td[data-prop-name="${cssEscape(container.colId)}"]`);
        if (target) return target;
      }
      if (container.kind === 'calendar_event' && container.id) {
        const target = document.querySelector(`.gb-cal-day-event[data-event-id="${cssEscape(container.id)}"], .gb-cal-clock-event-slice[data-event-id="${cssEscape(container.id)}"]`);
        if (target) return target;
      }
      if (container.kind === 'scriptnote_line' && container.id) {
        const target = document.querySelector(`.sn2-row[data-row-id="${cssEscape(container.id)}"]`);
        if (target) return target;
      }
      if (container.kind === 'note_line' && container.id) {
        const target = document.querySelector(`span._nl-id[data-line-id="${cssEscape(container.id)}"]`)?.parentElement;
        if (target) return target;
      }
    }
    const sel = window.getSelection && window.getSelection();
    const node = sel?.anchorNode || null;
    const el = node && (node.nodeType === 3 ? node.parentElement : node);
    if (el instanceof HTMLElement) return el;
    if (active && active !== document.body) return active;
    return document.body;
  }

  // コメント追加（UIプロンプト経由）
  // override: detectCommentContext() の代わりに使うコンテキスト（右クリックメニュー経由用）
  // opts.anchorEl: インライン textarea の配置基準。未指定時も現在の選択/フォーカス付近に表示する。
  async function addCommentHere(override, opts) {
    opts = opts || {};
    const ctx = override || detectCommentContext();
    const kindLabel = ({
      note_line: 'ノート行', scriptnote_line: 'シナリオ行',
      board_card: 'ボードカード', sheet_cell: 'シートのセル',
      board_line: 'ボードライン',
      calendar_event: 'カレンダーイベント',
      text_range: '選択範囲', none: '未紐付',
    })[ctx.targetKind] || ctx.targetKind;
    let body = null;
    body = await _promptInlineComment(opts.anchorEl || _commentPromptAnchorFromContext(ctx), '', kindLabel);
    if (body == null || !body.trim()) return;
    try {
      const payload = {
        type: 'comment',
        target_path: ctx.filePath || '',
        target_kind: ctx.targetKind,
        body: body,
        data: { type: 'comment', text: body },
      };
      if (ctx.targetRef) payload.target_ref = ctx.targetRef;
      if (ctx.snapshot) payload.target_snapshot = ctx.snapshot;
      const res = await apiPost('/annotations', payload);
      if (res?.id && typeof _pushAnnotationCreateHistory === 'function') {
        _pushAnnotationCreateHistory(res.id, '注釈: コメント追加', ctx.filePath || '').catch(() => {});
      }
      if (ctx.filePath) invalidate(ctx.filePath);
      // 現在開いている関連エディタのバッジを更新
      if (ctx.filePath) {
        const pc = document.getElementById('page-content');
        if (pc && pc.dataset.path === ctx.filePath) refreshNote(ctx.filePath, pc);
        try {
          if (typeof _sn2Editors !== 'undefined' && _sn2Editors[ctx.filePath]) {
            refreshScriptnote(ctx.filePath, _sn2Editors[ctx.filePath].host);
          }
        } catch {}
        // ボード
        try {
          if (typeof bd !== 'undefined' && bd?.path === ctx.filePath) {
            const bdContainer = document.getElementById('bd-nodes');
            if (bdContainer) refreshBoard(ctx.filePath, bdContainer);
          }
        } catch {}
        // シート
        try {
          if (typeof state !== 'undefined' && state.currentDbPath === ctx.filePath) {
            const tbl = document.querySelector('#pivot-table') || document.querySelector('table.pivot-table');
            if (tbl) refreshSheet(ctx.filePath, tbl);
          }
        } catch {}
        // カレンダー
        try {
          if (ctx.targetKind === 'calendar_event' || ctx.targetRef?.container?.kind === 'calendar_event') {
            refreshVisibleCalendarCommentBadges();
          }
        } catch {}
      }
      // 注釈パネルが開いていれば一覧を更新
      if (typeof loadRpAnnotationList === 'function') {
        const panel = document.getElementById('right-panel');
        if (panel?.classList.contains('open')) loadRpAnnotationList();
      }
      if (typeof showStatus === 'function') showStatus(`コメントを追加 (${kindLabel})`);
    } catch {
      if (typeof showStatus === 'function') showStatus('コメント追加に失敗', true);
    }
  }

  // Alt+Shift+C のキー捕捉は GB_SHORTCUTS（'global.addComment'）へ統合済み

  window.CommentBadges = {
    refreshNote, refreshScriptnote, refreshBoard, refreshSheet, refreshCalendar,
    refreshVisibleCalendar: refreshVisibleCalendarCommentBadges,
    getBoardLineCount,
    invalidate, fetchComments, buildCountMap,
    refreshFileIndicator,
    detectCommentContext, addCommentHere, openPanelForFileComments,
    openPanelForTarget: _openPanelForTarget,
  };
  window.addCommentHere = addCommentHere;
})();
