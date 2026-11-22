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
    if (kind === 'map_feature' && ctx?.targetRef?.featureId) {
      const target = document.querySelector(`.gb-map-app [data-map-feature-id="${cssEscape(ctx.targetRef.featureId)}"]`)
        || document.querySelector('.gb-map-app .gb-map-inspector, .gb-map-app');
      if (target) return target;
    }
    if (kind === 'form_field' && ctx?.targetRef?.field) {
      const target = document.querySelector(`.gb-form-app [data-form-field="${cssEscape(ctx.targetRef.field)}"]`);
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
      map_feature: 'マップの地点・図形', form_field: 'フォームの項目',
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
        await _pushAnnotationCreateHistory(res.id, 'アノテート: コメント追加', ctx.filePath || '').catch(() => {});
      }
      if (ctx.filePath) invalidate(ctx.filePath);
      // Adding a comment is an explicit request to see its anchor immediately.
      window.MeldexDisplayLayers?.setLayer?.('comments', true, { silent: true });
      // 現在開いている関連エディタのバッジを更新
      if (ctx.filePath) {
        const pc = document.getElementById('page-content');
        if (pc && pc.dataset.path === ctx.filePath) {
          // The anchor may have assigned a new line ID. Advance the editor's
          // serialization revision and save it through the usual autosave path.
          if (pc.isContentEditable) pc.dispatchEvent(new Event('input', { bubbles: true }));
          refreshNote(ctx.filePath, pc);
        }
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
        // マップ・フォーム
        try { refreshOpenMapsAndForms(ctx.filePath); } catch {}
      }
      // アノテートパネルが開いていれば一覧を更新
      if (typeof loadRpAnnotationList === 'function') {
        const panel = document.getElementById('right-panel');
        if (panel?.classList.contains('open')) loadRpAnnotationList();
      }
      if (typeof showStatus === 'function') showStatus(`コメントを追加 (${kindLabel})`);
    } catch (error) {
      // 原因を画面に出す（以前は理由なしで「失敗」とだけ出し、ボードのラインのコメントの失敗の原因が分からなかった）。
      if (typeof showStatus === 'function') showStatus('コメント追加に失敗: ' + String(error?.message || error || '不明なエラー').slice(0, 160), true);
    }
  }

  // === マップ・フォーム ===
  // マップは地点一覧の行、フォームは項目に件数を出す。押すとその対象のコメントだけを一覧に出す。
  async function refreshMap(app) {
    const root = app?.placeList;
    const filePath = app?.path || '';
    if (!root || !filePath) return;
    if (!_isCommentLayerEnabled()) { root.querySelectorAll('.cmt-badge').forEach(el => el.remove()); return; }
    const items = await fetchComments(filePath);
    if (app.path !== filePath || !root.isConnected) return;
    const counts = buildCountMap(items).map_feature;
    root.querySelectorAll('[data-map-feature-id]').forEach(row => {
      const featureId = row.dataset.mapFeatureId;
      _ensureBadge(row, counts.get(featureId) || 0, () => _openPanelForTarget(filePath, 'map_feature', { file: filePath, featureId }));
    });
  }

  async function refreshForm(app) {
    const root = app?.surface || app?.el;
    const filePath = app?.path || '';
    if (!root || !filePath) return;
    if (!_isCommentLayerEnabled()) { root.querySelectorAll('[data-form-field] > .cmt-badge').forEach(el => el.remove()); return; }
    const items = await fetchComments(filePath);
    if (app.path !== filePath || !root.isConnected) return;
    const counts = buildCountMap(items).form_field;
    root.querySelectorAll('[data-form-field]').forEach(fieldEl => {
      const field = fieldEl.dataset.formField;
      _ensureBadge(fieldEl, counts.get(field) || 0, () => _openPanelForTarget(filePath, 'form_field', { file: filePath, field }));
    });
  }

  function refreshOpenMapsAndForms(filePath) {
    document.querySelectorAll('.gb-map-app').forEach(el => { if (el._gbMapApp?.path === filePath) refreshMap(el._gbMapApp).catch(() => {}); });
    document.querySelectorAll('.gb-form-app').forEach(el => { if (el._gbFormApp?.path === filePath) refreshForm(el._gbFormApp).catch(() => {}); });
  }

  // Alt+Shift+C のキー捕捉は GB_SHORTCUTS（'global.addComment'）へ統合済み

  window.CommentBadges = {
    refreshNote, refreshScriptnote, refreshBoard, refreshSheet, refreshCalendar, refreshMap, refreshForm, refreshOpenMapsAndForms,
    refreshVisibleCalendar: refreshVisibleCalendarCommentBadges,
    getBoardLineCount,
    invalidate, fetchComments, buildCountMap,
    refreshFileIndicator,
    detectCommentContext, addCommentHere, openPanelForFileComments,
    openPanelForTarget: _openPanelForTarget,
    openPanelForHighlight,
  };
  window.addCommentHere = addCommentHere;
})();
