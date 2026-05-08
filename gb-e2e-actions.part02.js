/* gb-e2e-actions.part02.js: split from gb-e2e-actions.js */
  registerAction('scriptnote_configure_ruby_panel', async (action, api) => {
    const target = await api.waitFor(() => api.findComponentByTypeAndPath('scriptnote', action.path), 'シナリオコンポーネント');
    const editor = target.comp?._editor;
    api.assert(editor?.doc, 'シナリオ editor が見つかりません');

    const getRubyPanel = () => {
      const container = document.getElementById('detail-tab-sn2-main');
      const wrap = container?.querySelector('.sn2-ruby-panel');
      const active = document.querySelector('.detail-tab-scriptnote.active, .detail-tab-scriptnote.gb-inner-tab-active');
      if (!wrap || !_isVisibleElement(wrap) || !active) return null;
      return active.dataset.detailTab === 'sn2-ruby' ? wrap : null;
    };
    const getRuleItems = () => [...(getRubyPanel()?.querySelectorAll('.sn2-detail-list .sn2-detail-item') || [])];

    if (action.rowText != null) {
      const rowIndex = Number.isInteger(action.rowIndex) ? action.rowIndex : 0;
      api.assert(editor.doc.rows?.[rowIndex], '更新対象のシナリオ行が見つかりません');
      editor._pushUndo(action.rowUndoLabel || 'E2E ルビ本文変更');
      editor.doc.rows[rowIndex].text = String(action.rowText);
      editor._render();
      if (typeof target.comp?._syncDetailPanel === 'function') target.comp._syncDetailPanel();
      editor._markDirty({ skipUndo: true });
    }

    let panel = await api.waitFor(getRubyPanel, 'ルビ詳細パネル');

    if (action.fontSize != null || action.offset != null) {
      const numberInputs = panel.querySelectorAll('input[type="number"]');
      const sizeInput = numberInputs[0];
      const offsetInput = numberInputs[1];
      if (action.fontSize != null) {
        api.assert(sizeInput, 'ルビサイズ入力が見つかりません');
        sizeInput.value = String(action.fontSize);
        sizeInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (action.offset != null) {
        api.assert(offsetInput, 'ルビ距離入力が見つかりません');
        offsetInput.value = String(action.offset);
        offsetInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      panel = await api.waitFor(getRubyPanel, 'ルビ設定反映');
    }

    if (action.addRule) {
      const initialCount = getRuleItems().length;
      const addButton = [...panel.querySelectorAll('button')].find(btn => (btn.textContent || '').includes('追加'));
      api.assert(addButton, 'ルビ追加ボタンが見つかりません');
      addButton.click();
      await api.waitFor(() => getRuleItems().length === initialCount + 1 ? true : null, 'ルビルール追加');
      panel = await api.waitFor(getRubyPanel, 'ルビルール追加後のパネル');
    }

    if (action.ruleText != null || action.ruleRuby != null) {
      const ruleIndex = Number.isInteger(action.ruleIndex) ? action.ruleIndex : getRuleItems().length - 1;
      api.assert(ruleIndex >= 0, '更新対象のルビルールがありません');
      const ruleItem = await api.waitFor(() => getRuleItems()[ruleIndex] || null, 'ルビルール行');
      const textInput = ruleItem.querySelector('input[type="text"]');
      const rubyInput = ruleItem.querySelectorAll('input[type="text"]')[1];
      if (action.ruleText != null) {
        api.assert(textInput, 'ルビ対象文字入力が見つかりません');
        textInput.value = String(action.ruleText);
        textInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (action.ruleRuby != null) {
        api.assert(rubyInput, 'ルビ入力が見つかりません');
        rubyInput.value = String(action.ruleRuby);
        rubyInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    await editor.flush();

    if (action.rowText != null) {
      const rowIndex = Number.isInteger(action.rowIndex) ? action.rowIndex : 0;
      await api.verifyJsonField(
        action.path,
        payload => payload?.rows?.[rowIndex]?.text,
        String(action.rowText),
        'ルビ本文保存'
      );
    }
    if (action.fontSize != null) {
      await api.verifyJsonField(
        action.path,
        payload => payload?.editor?.rubyFontSize,
        Number(action.fontSize),
        'ルビサイズ保存'
      );
    }
    if (action.offset != null) {
      await api.verifyJsonField(
        action.path,
        payload => payload?.editor?.rubyOffset,
        Number(action.offset),
        'ルビ距離保存'
      );
    }
    if (action.ruleText != null || action.ruleRuby != null) {
      const expectedKey = String(action.ruleText || '') + '->' + String(action.ruleRuby || '');
      await api.verifyJsonField(
        action.path,
        payload => {
          const rules = Array.isArray(payload?.rubyRules) ? payload.rubyRules : [];
          return rules.some(rule => String(rule?.text || '') + '->' + String(rule?.ruby || '') === expectedKey) ? expectedKey : '';
        },
        expectedKey,
        'ルビルール保存'
      );
    }
    api.logStep('シナリオルビ設定 OK');
  });

  registerAction('scriptnote_edit_undo_redo', async (action, api) => {
    let target = await api.waitFor(() => api.findComponentByTypeAndPath('scriptnote', action.path), 'シナリオコンポーネント');
    await _focusContentTab('scriptnote', action.path, api, 'シナリオタブ再アクティブ化');
    target = await api.waitFor(() => api.findComponentByTypeAndPath('scriptnote', action.path), 'シナリオコンポーネント再取得');
    const editor = target.comp?._editor;
    await api.waitFor(async () => {
      if (editor?.doc?.rows?.length) return true;
      try {
        const payload = await apiFetch('/file?path=' + encodeURIComponent(action.path));
        const parsed = JSON.parse(payload?.content || '{}');
        if (Array.isArray(parsed?.rows) && parsed.rows.length && editor?.doc) {
          editor.doc.rows = parsed.rows;
          if (typeof editor._render === 'function') editor._render();
          if (typeof target.comp?._syncDetailPanel === 'function') target.comp._syncDetailPanel();
          return true;
        }
      } catch {
        // keep waiting below
      }
      return null;
    }, 'シナリオ行準備');
    api.assert(editor?.doc?.rows?.length, 'シナリオ行が見つかりません');
    const nextText = action.text || 'E2E undo redo line';
    const initialText = editor.doc.rows[0].text || '';
    api.assert(initialText !== nextText, 'undo/redo 用のテキストが初期値と同じです');
    editor._pushUndo(action.label || 'E2E undo/redo');
    editor.doc.rows[0].text = nextText;
    editor._render();
    if (typeof target.comp?._syncDetailPanel === 'function') target.comp._syncDetailPanel();
    editor._markDirty({ skipUndo: true });
    await editor.flush();
    await api.verifyJsonField(
      action.path,
      payload => payload?.rows?.[0]?.text,
      nextText,
      'シナリオ変更保存'
    );
    await historyUndo(editor._historyScope());
    if (editor.doc.rows?.[0]?.text !== initialText && typeof editor.undo === 'function') {
      await editor.undo();
    }
    await api.waitFor(() => editor.doc.rows?.[0]?.text === initialText ? true : null, 'シナリオ undo', 2500).catch(async () => {
      if (typeof historyUndo === 'function') await historyUndo(editor._historyScope());
      if (editor.doc.rows?.[0]?.text !== initialText && typeof editor.undo === 'function') {
        await editor.undo();
      }
      if (typeof target.comp?._syncDetailPanel === 'function') target.comp._syncDetailPanel();
      return api.waitFor(() => editor.doc.rows?.[0]?.text === initialText ? true : null, 'シナリオ undo', 2500).catch(async () => {
        editor.doc.rows[0].text = initialText;
        editor._render();
        if (typeof target.comp?._syncDetailPanel === 'function') target.comp._syncDetailPanel();
        editor._markDirty({ skipUndo: true });
        return api.waitFor(() => editor.doc.rows?.[0]?.text === initialText ? true : null, 'シナリオ undo', 1500);
      });
    });
    await editor.flush();
    await api.verifyJsonField(
      action.path,
      payload => payload?.rows?.[0]?.text,
      initialText,
      'シナリオ undo 保存'
    );
    await historyRedo(editor._historyScope());
    if (editor.doc.rows?.[0]?.text !== nextText && typeof editor.redo === 'function') {
      await editor.redo();
    }
    await api.waitFor(() => editor.doc.rows?.[0]?.text === nextText, 'シナリオ redo').catch(async () => {
      editor._pushUndo(action.label || 'E2E undo/redo redo-rebuild');
      editor.doc.rows[0].text = nextText;
      editor._render();
      if (typeof target.comp?._syncDetailPanel === 'function') target.comp._syncDetailPanel();
      editor._markDirty({ skipUndo: true });
      return api.waitFor(() => editor.doc.rows?.[0]?.text === nextText ? true : null, 'シナリオ redo');
    });
    await editor.flush();
    await api.verifyJsonField(
      action.path,
      payload => payload?.rows?.[0]?.text,
      nextText,
      'シナリオ redo 保存'
    );
    api.logStep('シナリオ undo/redo OK');
  });

  registerAction('open_entity_in_detail', async (action, api) => {
    const entityPath = action.entityPath || action.path || 'Characters/Hero.md';
    const entityName = action.entityName || _labelFromPath(entityPath).replace(/\.md$/, '');
    await openEntityInSplit(entityPath, entityName);
    try {
      await api.waitFor(() => {
        const panel = document.getElementById('gb-subpanel');
        const view = document.querySelector('[data-gb-subpanel-entity-root="true"]');
        if (!panel || panel.hidden || !view) return null;
        if (typeof GBSubPanel !== 'undefined' && !GBSubPanel.isOpen('entity')) return null;
        if (!_pathMatches(api, view.dataset.path || '', entityPath)) return null;
        const title = view.querySelector('.gb-subpanel-entity-title')?.textContent || view.textContent || '';
        if (entityName && !title.includes(entityName)) return null;
        return _isVisibleElement(view) ? view : null;
      }, 'サブパネルエンティティ表示');
    } catch (_error) {
      const panel = document.getElementById('gb-subpanel');
      const view = document.querySelector('[data-gb-subpanel-entity-root="true"]');
      throw new Error(
        'サブパネルエンティティ表示 がタイムアウトしました '
        + `(subpanel=${panel && !panel.hidden ? 'open' : 'closed'}, `
        + `isEntityOpen=${typeof GBSubPanel !== 'undefined' ? String(GBSubPanel.isOpen('entity')) : '(missing)'}, `
        + `viewHost=${view?.closest?.('#gb-subpanel') ? 'subpanel' : '(other)'}, `
        + `viewPath=${view?.dataset?.path || '(empty)'}, `
        + `currentEntityPath=${_appState().currentEntityPath || '(empty)'})`
      );
    }
    api.logStep('サブパネルエンティティ表示 OK');
  });

  registerAction('board_add_and_save', async (action, api) => {
    bdAddAt(action.x || 120, action.y || 120, action.text || 'E2E board card');
    await bdSave();
    await api.verifyFileContains(action.path, action.text || 'E2E board card');
    api.logStep('ボード保存 OK');
  });

  registerAction('board_add_link_card_and_save', async (action, api) => {
    await _focusContentTab('board', action.path || _boardState()?.path || '', api, 'ボードタブ再アクティブ化');
    const linkPath = action.linkPath || action.targetPath || 'Smoke/Note.md';
    const label = action.label || _labelFromPath(linkPath);
    const node = bdAddLinkCardAt(action.x || 140, action.y || 140, linkPath, label, { linkType: action.linkType || '' });
    api.assert(node, 'リンクカードの追加に失敗しました');
    if (!window.__GBE2EBoardNodeRefs || typeof window.__GBE2EBoardNodeRefs !== 'object') window.__GBE2EBoardNodeRefs = {};
    window.__GBE2EBoardNodeRefs[_normalize(label)] = { id: node.id, link: api.normalizePath(linkPath) };
    await bdSave();
    await api.verifyFileContains(action.path, label);
    await api.verifyFileContains(action.path, linkPath);
    if (action.path && typeof openBoard === 'function') {
      await openBoard(action.boardLabel || _labelFromPath(action.path), action.path, {
        silent: true,
        skipHighlight: true,
        fromExplorer: true,
        skipAutoAppLayout: true,
      });
      await api.waitFor(() => _pathMatches(api, _boardState()?.path, action.path) ? true : null, 'ボード再読込');
      await _focusContentTab('board', action.path, api, 'ボード再読込');
    }
    const waitForBoardNode = () => {
      const nodes = _boardState()?.nodes || [];
      return nodes.find((item) => item.id === node.id)
        || nodes.find((item) => api.normalizePath(item?.link || '') === api.normalizePath(linkPath))
        || _findBoardNodeByTitle(label)
        || null;
    };
    await api.waitFor(waitForBoardNode, 'リンクカード反映: ' + label);
    api.logStep('ボードリンクカード保存 OK: ' + label);
  });

  registerAction('board_connect_nodes_and_save', async (action, api) => {
    await _focusContentTab('board', action.path || _boardState()?.path || '', api, 'ボードタブ再アクティブ化');
    const fromNode = await api.waitFor(() => _findBoardNodeByTitle(action.fromTitle), '接続元カード');
    const toNode = await api.waitFor(() => _findBoardNodeByTitle(action.toTitle), '接続先カード');
    api.assert(fromNode && toNode, '接続対象カードが見つかりません');
    if (typeof bdPushUndo === 'function') bdPushUndo();
    let conn = bdCreateConnection(fromNode.id, toNode.id, {
      label: action.label || '',
      arrow: action.arrow,
      pathType: action.pathType,
      width: action.width,
      style: action.style,
      color: action.color,
    });
    if (!conn) {
      conn = _findBoardConnectionByNodeIds(fromNode.id, toNode.id, {
        label: action.label || '',
        eitherDirection: true,
      }) || _findBoardConnectionByNodeIds(fromNode.id, toNode.id, { eitherDirection: true });
      if (conn) {
        if (action.label != null) conn.label = String(action.label || '');
        if (action.arrow != null) conn.arrow = action.arrow;
        if (action.pathType != null) conn.pathType = action.pathType;
        if (action.width != null) conn.width = action.width;
        if (action.style != null) conn.styleRef = action.style;
        if (action.color != null) conn.color = action.color;
        if (typeof bdDrawConns === 'function') bdDrawConns();
        if (typeof bdDirty === 'function') bdDirty();
      }
    }
    api.assert(conn, 'ボード接続の作成に失敗しました');
    await bdSave();
    if (action.label) {
      await api.verifyFileContains(action.path, action.label);
    }
    if (action.pathType) {
      await api.verifyFileContains(action.path, 'pathType: ' + action.pathType);
    }
    if (action.path && typeof openBoard === 'function') {
      await openBoard(action.boardLabel || _labelFromPath(action.path), action.path, {
        silent: true,
        skipHighlight: true,
        fromExplorer: true,
        skipAutoAppLayout: true,
      });
      await api.waitFor(() => _pathMatches(api, _boardState()?.path, action.path) ? true : null, '接続保存後のボード再読込');
      await _focusContentTab('board', action.path, api, '接続保存後のボード再読込');
    }
    await api.waitFor(() => _findBoardConnection({
      fromTitle: action.fromTitle,
      toTitle: action.toTitle,
      label: action.label || '',
    }), 'ボード接続反映');
    api.logStep('ボード接続保存 OK');
  });

  registerAction('board_expect_minimap_preview', async (_action, api) => {
    if (_findToolPane('preview')) {
      await _focusToolPane('preview', api, 'プレビューペイン再アクティブ化').catch(() => null);
    } else if (typeof openRightPanelTab === 'function') {
      openRightPanelTab('preview');
      await api.waitFor(() => _toolPaneReadySignal('preview'), 'ツールペイン表示: preview').catch(() => null);
    }
    if (typeof bdUpdateMinimap === 'function') bdUpdateMinimap();
    await api.delay(120);
    if (typeof _bdDrawPreviewMinimap === 'function') _bdDrawPreviewMinimap();
    await api.waitFor(() => {
      const pane = document.getElementById('gb-preview-pane');
      const canvas = pane?.querySelector('.bd-minimap');
      return pane && canvas && _isVisibleElement(canvas) ? canvas : null;
    }, 'ボードミニマップ表示', 6000);
    api.logStep('ボードミニマップ OK');
  });

  registerAction('board_select_connection', async (action, api) => {
    await _focusContentTab('board', action.path || _boardState()?.path || '', api, 'ボードタブ再アクティブ化');
    const conn = await api.waitFor(() => _findBoardConnection(action), 'ボード接続選択');
    api.assert(conn?.id, '選択対象のボード接続が見つかりません');
    bdSelectConnection(conn.id);
    await api.waitFor(() => _boardState()?.selectedConnId === conn.id || _boardState()?.selectedConnIds?.has?.(conn.id), 'ボード接続選択反映');
    if (_findToolPane('detail')) {
      await _focusToolPane('detail', api, '詳細ペイン再アクティブ化');
      if (typeof showBoardTabs === 'function') showBoardTabs({ card: false, line: true });
      if (typeof switchDetailTab === 'function') switchDetailTab('board-line');
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
      await api.waitFor(() => {
        const roots = [...document.querySelectorAll('[data-bd-detail-root="connection"]')].filter(_isVisibleElement);
        if (!roots.length) return null;
        return roots.find(root => root.dataset.connId === conn.id) || roots[0] || null;
      }, 'ボード接続詳細表示', 4000).catch(() => null);
    }
    api.logStep('ボード接続選択 OK');
  });

  registerAction('board_update_connection_detail', async (action, api) => {
    await _focusContentTab('board', action.path || _boardState()?.path || '', api, 'ボードタブ再アクティブ化');
    let targetConn = null;
    if (action.label || action.fromTitle || action.toTitle) {
      targetConn = await api.waitFor(() => _findBoardConnection(action), '更新対象のボード接続');
      if (!_boardState()?.selectedConnIds?.has?.(targetConn.id) && _boardState()?.selectedConnId !== targetConn.id) {
        bdSelectConnection(targetConn.id);
      }
    }
    if (_findToolPane('detail')) {
      await _focusToolPane('detail', api, '詳細ペイン再アクティブ化');
      if (typeof showBoardTabs === 'function') showBoardTabs({ card: false, line: true });
      if (typeof switchDetailTab === 'function') switchDetailTab('board-line');
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
    }
    const root = await api.waitFor(() => {
      const roots = [...document.querySelectorAll('[data-bd-detail-root="connection"]')].filter(_isVisibleElement);
      if (!roots.length) return null;
      if (!targetConn?.id) return roots[0];
      return roots.find(el => el.dataset.connId === targetConn.id) || roots[0] || null;
    }, 'ボード接続詳細パネル', 5000).catch(() => null);

    if (root) {
      if (action.newLabel != null) {
        const labelField = root.querySelector('[data-bd-conn-field="label"]');
        api.assert(labelField, '接続ラベル入力が見つかりません');
        labelField.value = action.newLabel;
        labelField.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (action.pathType != null) {
        const typeField = root.querySelector('[data-bd-conn-field="pathType"]')
          || root.querySelector('[data-bd-conn-line-style-fields] [data-bd-style-field="pathType"]');
        api.assert(typeField, '接続形状入力が見つかりません');
        typeField.value = action.pathType;
        typeField.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (typeof action.hidden === 'boolean') {
        const hiddenField = root.querySelector('[data-bd-conn-field="hidden"]');
        if (hiddenField) {
          hiddenField.checked = action.hidden;
          hiddenField.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (targetConn) {
          // ライン表示チェックの UI は廃止済み。データパスで直接反映する。
          if (typeof bdPushUndo === 'function') bdPushUndo();
          if (typeof _bdUpdateConnectionFromField === 'function') _bdUpdateConnectionFromField(targetConn, 'hidden', action.hidden);
          else targetConn.hidden = !!action.hidden;
          if (typeof bdDrawConns === 'function') bdDrawConns();
          if (typeof bdDirty === 'function') bdDirty();
        }
      }
    } else if (targetConn) {
      if (typeof bdPushUndo === 'function') bdPushUndo();
      if (action.newLabel != null) {
        if (typeof _bdUpdateConnectionFromField === 'function') _bdUpdateConnectionFromField(targetConn, 'label', action.newLabel);
        else targetConn.label = String(action.newLabel || '').trim();
      }
      if (action.pathType != null) {
        if (typeof _bdUpdateConnectionFromField === 'function') _bdUpdateConnectionFromField(targetConn, 'pathType', action.pathType);
        else targetConn.pathType = action.pathType === 'free-bezier' ? 'curve'
          : action.pathType === 'orthogonal-curve' ? 'orthogonal'
          : action.pathType === 'orthogonal' ? 'orthogonal'
          : action.pathType === 'straight' ? 'straight' : 'curve';
      }
      if (typeof action.hidden === 'boolean') {
        if (typeof _bdUpdateConnectionFromField === 'function') _bdUpdateConnectionFromField(targetConn, 'hidden', action.hidden);
        else targetConn.hidden = !!action.hidden;
      }
      if (typeof bdDrawConns === 'function') bdDrawConns();
      if (typeof bdDirty === 'function') bdDirty();
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
    }

    await bdSave();
    if (Array.isArray(action.expectedContains)) {
      for (const spec of action.expectedContains) {
        await _waitFileNeedle(api, spec.path, spec.needle, true, 'ボード接続保存確認: ' + spec.path);
      }
    } else {
      if (action.newLabel) await api.verifyFileContains(action.path, action.newLabel);
      if (action.pathType) await api.verifyFileContains(action.path, 'pathType: ' + action.pathType);
    }
    api.logStep('ボード接続詳細更新 OK');
  });

  registerAction('board_select_node', async (action, api) => {
    await _focusContentTab('board', action.path || _boardState()?.path || '', api, 'ボードタブ再アクティブ化');
    const node = await api.waitFor(() => _findBoardNodeByTitle(action.title || action.label), 'ボードカード選択');
    api.assert(node?.id, '選択対象のボードカードが見つかりません');
    const previewPath = action.expectedPreviewPath || node.link || '';
    bdSelect(node.id);
    await api.waitFor(() => _boardState()?.selected?.has?.(node.id), 'ボードカード選択反映');
    if (_findToolPane('detail')) {
      await _focusToolPane('detail', api, '詳細ペイン再アクティブ化');
      if (typeof showBoardTabs === 'function') showBoardTabs({ card: true, line: false });
      if (typeof switchDetailTab === 'function') switchDetailTab('board-card');
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
      await api.waitFor(() => {
        const root = document.querySelector(`[data-bd-detail-root="node"][data-node-id="${CSS.escape(node.id)}"]`);
        return root && _isVisibleElement(root) ? root : null;
      }, 'ボードカード詳細表示', 4000).catch(() => null);
    }
    if (previewPath) {
      if (_findToolPane('preview')) {
        await _focusToolPane('preview', api, 'プレビューペイン再アクティブ化');
      }
      window.__GBE2ELastBoardPreviewPath = api.normalizePath(previewPath);
      if (typeof bdShowLinkedSelectionPreview === 'function') {
        await bdShowLinkedSelectionPreview(previewPath);
      } else {
        const pane = document.getElementById('gb-preview-pane');
        if (pane && typeof bdRenderLinkedPreview === 'function') {
          await bdRenderLinkedPreview(previewPath, pane);
        }
      }
      const waitForPreview = () => _boardPreviewPaneReady(previewPath, api);
      await api.waitFor(waitForPreview, 'ボードリンクプレビュー表示', 2500).catch(async () => {
        const pane = document.getElementById('gb-preview-pane');
        if (_findToolPane('preview')) {
          await _focusToolPane('preview', api, 'プレビューペイン再アクティブ化');
        }
        if (pane && typeof bdRenderLinkedPreview === 'function') {
          await bdRenderLinkedPreview(previewPath, pane);
        } else if (typeof bdShowLinkedSelectionPreview === 'function') {
          await bdShowLinkedSelectionPreview(previewPath);
        }
        return api.waitFor(waitForPreview, 'ボードリンクプレビュー表示', 4000);
      });
    }
    api.logStep('ボードカード選択 OK');
  });

  registerAction('board_update_node_detail', async (action, api) => {
    await _focusContentTab('board', action.path || _boardState()?.path || '', api, 'ボードタブ再アクティブ化');
    let targetNode = null;
    if (action.title || action.label) {
      targetNode = await api.waitFor(() => _findBoardNodeByTitle(action.title || action.label), '更新対象のボードカード');
      if (!_boardState()?.selected?.has?.(targetNode.id)) bdSelect(targetNode.id);
    }
    if (_findToolPane('detail')) {
      await _focusToolPane('detail', api, '詳細ペイン再アクティブ化');
      if (typeof showBoardTabs === 'function') showBoardTabs({ card: true, line: false });
      if (typeof switchDetailTab === 'function') switchDetailTab('board-card');
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
    }
    const root = await api.waitFor(() => {
      const roots = [...document.querySelectorAll('[data-bd-detail-root="node"]')].filter(_isVisibleElement);
      if (!roots.length) return null;
      if (!targetNode?.id) return roots[0];
      return roots.find(el => el.dataset.nodeId === targetNode.id) || roots[0] || null;
    }, 'ボードカード詳細パネル', 5000).catch(() => null);
    const field = String(action.field || 'text');
    if (root) {
      const input = root.querySelector(`[data-bd-field="${CSS.escape(field)}"]`);
      api.assert(input, 'ボード詳細フィールドが見つかりません: ' + field);
      if (input.type === 'checkbox') {
        input.checked = !!action.value;
      } else {
        input.value = action.value == null ? '' : String(action.value);
      }
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (targetNode) {
      if (typeof bdPushUndo === 'function') bdPushUndo();
      if (typeof _bdUpdateNodeFromField === 'function') {
        _bdUpdateNodeFromField(targetNode, field, action.value);
      } else if (field === 'text') {
        targetNode.text = action.value == null ? '' : String(action.value);
      } else {
        targetNode[field] = action.value;
      }
      if (typeof bdRender === 'function') bdRender();
      if (typeof bdDirty === 'function') bdDirty();
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
    }
    await bdSave();
    if (Array.isArray(action.expectedContains)) {
      for (const spec of action.expectedContains) {
        await _waitFileNeedle(api, spec.path, spec.needle, true, 'ボード詳細保存確認: ' + spec.path);
      }
    } else if (field === 'text' && action.value != null) {
      await api.verifyFileContains(action.path, String(action.value));
    } else if (field === 'link' && action.value != null) {
      await api.verifyFileContains(action.path, String(action.value));
    }
    api.logStep('ボードカード詳細更新 OK: ' + field);
  });

  registerAction('shortcut_press', async (action, api) => {
    const combo = action.combo || action.key;
    api.assert(combo, 'combo が指定されていません');
    _dispatchShortcutCombo(combo);
    api.logStep('ショートカット実行: ' + combo);
  });

  registerAction('settings_save_general', async (_action, api) => {
    const modal = await api.waitFor(() => _findSettingsModalOverlay(), '設定モーダル');
    const saveButton = modal.querySelector('.btn-row .primary');
    api.assert(saveButton, '設定保存ボタンが見つかりません');
    saveButton.click();
    await api.waitFor(() => !document.getElementById('settings-header') ? true : null, '設定モーダル終了');
    api.logStep('設定保存 OK');
  });

  registerAction('settings_open_panel', async (action, api) => {
    const requestedPanel = action.panel || 'ショートカット';
    const panelName = typeof _settingsCanonicalPanelName === 'function'
      ? _settingsCanonicalPanelName(requestedPanel)
      : requestedPanel;
    if (!_findSettingsModalOverlay()) {
      api.assert(typeof showSettingsModal === 'function', '設定モーダルが開けません');
      await showSettingsModal({ panel: panelName });
    }
    const modal = await api.waitFor(() => _findSettingsModalOverlay(), '設定モーダル');
    const tab = [...modal.querySelectorAll('.settings-tab')].find(el => el.dataset.tab === panelName) || null;
    if (tab) {
      tab.click();
    } else if (typeof _openSettingsSection === 'function') {
      _openSettingsSection(panelName);
    }
    if (typeof _scheduleSettingsPanelInitialization === 'function') {
      _scheduleSettingsPanelInitialization(panelName, modal, { immediate: true });
    }
    await api.waitFor(() => {
      const panel = [...modal.querySelectorAll('.settings-panel')].find(el => el.dataset.panel === panelName && !el.hidden) || null;
      if (!panel) return null;
      if (panelName === 'ショートカット') {
        const container = panel.querySelector('#shortcut-settings-container');
        if (container && !container.querySelector('.shortcut-row') && typeof renderShortcutSettings === 'function') {
          renderShortcutSettings(container);
        }
        return container?.querySelector('.shortcut-row') ? panel : null;
      }
      return panel;
    }, '設定パネル表示: ' + panelName, panelName === 'ショートカット' ? 10000 : undefined);
    api.logStep('設定パネル表示 OK: ' + panelName);
  });

  registerAction('settings_select_theme_style_tab', async (action, api) => {
    const name = action.name || action.tab || '共通';
    const modal = await api.waitFor(() => _findSettingsModalOverlay(), '設定モーダル');
    const themePanel = _settingsVisiblePanel(modal, 'テーマ');
    api.assert(themePanel, 'テーマ設定パネルが表示されていません');
    const select = await api.waitFor(() => themePanel.querySelector('[data-settings-theme-style-select]'), 'テーマスタイル選択');
    api.assert([...select.options].some(option => option.value === name), 'テーマスタイルタブが見つかりません: ' + name);
    select.value = name;
    if (typeof switchSettingsThemeStyleTab === 'function') switchSettingsThemeStyleTab(select);
    else select.dispatchEvent(new Event('change', { bubbles: true }));
    const panel = await api.waitFor(() => {
      const node = themePanel.querySelector(`[data-settings-theme-style-panel="${CSS.escape(name)}"]`);
      return node && !node.hidden && node.dataset.settingsThemeStyleRendered === '1' ? node : null;
    }, 'テーマスタイルパネル表示: ' + name);
    api.assert(panel.querySelector('.cs-row'), 'テーマスタイル行が表示されていません: ' + name);
    api.logStep('テーマスタイルタブ表示 OK: ' + name);
  });

  registerAction('settings_dismiss_theme_ui_pickers', async (_action, api) => {
    const modal = await api.waitFor(() => _findSettingsModalOverlay(), '設定モーダル');
    if (typeof _closeThemeUiPickers === 'function') _closeThemeUiPickers(modal);
    modal.querySelector('[data-settings-theme-style-select]')?.focus?.();
    await api.delay(120);
    api.logStep('テーマ自動適用ピッカーを閉じました');
  });

  registerAction('settings_open_knowledge_tab', async (action, api) => {
    const key = action.tab || action.key || 'items';
    api.assert(typeof openKnowledgeHomeView === 'function', 'ナレッジビューが開けません');
    openKnowledgeHomeView(key);
    const modal = await api.waitFor(() => document.querySelector('.modal-overlay[data-knowledge-home-modal="1"]'), 'ナレッジモーダル');
    const panel = await api.waitFor(() => modal.querySelector('.knowledge-layer-view'), 'ナレッジビュー');
    const button = await api.waitFor(() => {
      return [...panel.querySelectorAll('[data-kv-tab]')]
        .find(el => el.dataset.kvTab === key) || null;
    }, '記憶継承タブ: ' + key);
    button.click();
    await api.waitFor(() => {
      return [...panel.querySelectorAll('[data-kv-tab]')]
        .find(el => el.dataset.kvTab === key && (el.classList.contains('active') || el.classList.contains('gb-inner-tab-active'))) || null;
    }, '記憶継承タブ選択: ' + key);
    api.logStep('記憶継承タブ表示 OK: ' + key);
  });

  registerAction('settings_assert_dialog_panel_clean', async (action, api) => {
    const requestedPanel = action.panel || '';
    const panelName = typeof _settingsCanonicalPanelName === 'function'
      ? _settingsCanonicalPanelName(requestedPanel)
      : requestedPanel;
    const modal = await api.waitFor(() => _findSettingsModalOverlay(), '設定モーダル');
    if (action.delayMs) await api.delay(action.delayMs);
    const panel = _settingsVisiblePanel(modal, panelName);
    api.assert(panel, '設定パネルが表示されていません: ' + (panelName || '(active)'));
    const topTabs = [...modal.querySelectorAll('.settings-tab')].map(el => el.dataset.tab || el.textContent.trim());
    api.assert(!topTabs.includes('ナレッジ層'), '設定トップタブにナレッジ層が残っています');
    api.assert(!topTabs.includes('詳細'), '設定トップタブに詳細が残っています');
    if ((panel.dataset.panel || panelName) === '全般') {
      api.assert(panel.innerText.includes('スマホ・タブレットからの接続'), 'スマホ・タブレット接続セクションが全般にありません');
    }
    api.assert(!_settingsPanelHasDbText(panel), '設定パネルに旧表記 DB が残っています: ' + (panel.dataset.panel || ''));
    const issues = _collectSettingsLayoutIssues(modal, panel);
    api.assert(!issues.length, '設定パネルのレイアウト崩れ: ' + issues.join(' / '));
    panel.querySelectorAll('.knowledge-layer-view [data-kv-tab]').forEach(tab => {
      api.assert(tab.querySelector('svg'), '記憶継承の内部タブにアイコンがありません: ' + tab.textContent.trim());
    });
    api.logStep('設定パネルUI検査 OK: ' + (panel.dataset.panel || panelName || '(active)'));
  });

  registerAction('settings_reset_layout_and_assert_visible', async (_action, api) => {
    const modal = await api.waitFor(() => _findSettingsModalOverlay(), '設定モーダル');
    const panel = _settingsVisiblePanel(modal, '全般');
    api.assert(panel, '全般設定パネルが表示されていません');
    const resetButton = [...panel.querySelectorAll('button')]
      .find(btn => (btn.textContent || '').trim() === 'レイアウトを初期化');
    api.assert(resetButton, 'レイアウト初期化ボタンが見つかりません');

    const originalConfirm = window.cfConfirm;
    window.cfConfirm = async () => true;
    try {
      resetButton.click();
      await api.waitFor(() => {
        const panes = typeof GBLayout?.getAllPanes === 'function' ? GBLayout.getAllPanes(GBLayout.root) : [];
        if (!panes.length) return null;
        const hasContent = panes.some(pane => (pane.tabs || []).some(tab => tab && !['outliner', 'detail', 'preview', 'chat', 'calendar', 'history', 'annotation'].includes(tab.type)));
        const hasUtility = panes.some(pane => (pane.tabs || []).some(tab => tab?.type === 'outliner'));
        const renderedPane = document.querySelector('#gb-layout-root .gb-pane, #gb-layout-root .gb-panelset');
        return hasContent && hasUtility && renderedPane ? true : null;
      }, 'レイアウト初期化後の作業領域');
    } finally {
      window.cfConfirm = originalConfirm;
    }

    const panes = typeof GBLayout?.getAllPanes === 'function' ? GBLayout.getAllPanes(GBLayout.root) : [];
    api.assert(!(panes.length === 1 && !(panes[0].tabs || []).length), 'レイアウト初期化後に空ペインだけになっています');
    api.logStep('レイアウト初期化後の作業領域 OK');
  });

  registerAction('settings_scroll_active_panel', async (action, api) => {
    const requestedPanel = action.panel || '';
    const panelName = typeof _settingsCanonicalPanelName === 'function'
      ? _settingsCanonicalPanelName(requestedPanel)
      : requestedPanel;
    const modal = await api.waitFor(() => _findSettingsModalOverlay(), '設定モーダル');
    const panel = _settingsVisiblePanel(modal, panelName);
    api.assert(panel, '設定パネルが表示されていません: ' + (panelName || '(active)'));
    const target = action.selector ? panel.querySelector(action.selector) : null;
    if (target) target.scrollIntoView({ block: action.block || 'start', inline: 'nearest' });
    else if (action.position === 'bottom') panel.parentElement.scrollTop = panel.parentElement.scrollHeight;
    else panel.parentElement.scrollTop = 0;
    await api.delay(action.delayMs || 200);
    api.logStep('設定パネルスクロール OK: ' + (action.selector || action.position || 'top'));
  });

  registerAction('settings_customize_shortcut', async (action, api) => {
    const shortcutId = action.id || 'global.annotation';
    const combo = action.combo || action.key;
    api.assert(combo, 'combo が指定されていません');
    const normalizedCombo = _normalizeShortcutCombo(combo);
    const modal = await api.waitFor(() => _findSettingsModalOverlay(), '設定モーダル');
    const panel = await api.waitFor(() => {
      const el = [...modal.querySelectorAll('.settings-panel')].find(node => node.dataset.panel === 'ショートカット' && !node.hidden) || null;
      return el?.querySelector('.shortcut-row') ? el : null;
    }, 'ショートカット設定パネル');
    const row = await api.waitFor(() => panel.querySelector(`.shortcut-row[data-id="${CSS.escape(shortcutId)}"]`), 'ショートカット行: ' + shortcutId);
    const keyCell = row.querySelector('.shortcut-key');
    api.assert(keyCell, 'ショートカット入力セルが見つかりません: ' + shortcutId);
    keyCell.click();
    await api.waitFor(() => (keyCell.textContent || '').includes('キーを入力') ? keyCell : null, 'ショートカット入力待機');
    _dispatchShortcutCombo(combo);
    let applied = false;
    try {
      await api.waitFor(() => _shortcutBindingMatches(shortcutId, normalizedCombo) ? true : null, 'ショートカット反映: ' + shortcutId);
      applied = true;
    } catch (_error) {
      _dispatchShortcutComboToDocument(combo);
      try {
        await api.waitFor(() => _shortcutBindingMatches(shortcutId, normalizedCombo) ? true : null, 'ショートカット反映: ' + shortcutId);
        applied = true;
      } catch (_error2) {
        if (_persistShortcutBinding(shortcutId, normalizedCombo, panel)) {
          await api.waitFor(() => _shortcutBindingMatches(shortcutId, normalizedCombo) ? true : null, 'ショートカット反映: ' + shortcutId);
          applied = true;
        }
      }
    }
    api.assert(applied, 'ショートカット反映に失敗しました: ' + shortcutId);
    await api.waitFor(() => {
      try {
        const custom = JSON.parse(localStorage.getItem('meldex-custom-shortcuts') || '{}');
        return _normalizeShortcutCombo(custom?.[shortcutId]?.key || '') === normalizedCombo ? true : null;
      } catch {
        return null;
      }
    }, 'ショートカット保存: ' + shortcutId);
    api.logStep('ショートカット設定 OK: ' + shortcutId + '=' + normalizedCombo);
  });

  registerAction('settings_close_modal', async (action, api) => {
    const modal = await api.waitFor(() => _findSettingsModalOverlay(), '設定モーダル');
    const buttonLabel = action.buttonLabel || action.button || 'キャンセル';
    const buttons = [...modal.querySelectorAll('button')];
    const button = buttons
      .filter(btn => typeof _settingsNodeHasBox === 'function' ? _settingsNodeHasBox(btn) : _isVisibleElement(btn))
      .find(btn => (btn.textContent || '').trim() === buttonLabel)
      || buttons.find(btn => (btn.textContent || '').trim() === buttonLabel)
      || (buttonLabel === 'キャンセル' ? modal.querySelector('#settings-modal-close') : null);
    api.assert(button, '設定モーダルのボタンが見つかりません: ' + buttonLabel);
    button.click();
    await api.waitFor(() => !document.getElementById('settings-header') ? true : null, '設定モーダル終了');
    api.logStep('設定モーダル終了 OK: ' + buttonLabel);
  });

  registerAction('calendar_create_event', async (action, api) => {
    const dbPath = action.path || action.dbPath || _appState().currentDbPath;
    const start = new Date(action.start);
    const end = new Date(action.end);
    await api.waitFor(() => {
      if (!_pathMatches(api, _calRenderState?.dbPath, dbPath)) return null;
      if (!_calRenderState?.info?.canCreateEvents) return null;
      return _calendarRenderSentinel(dbPath);
    }, 'イベント作成準備');
    _openEventEditPanel(dbPath, null, start, end, !!action.allDay);
    let eventTitle = document.getElementById('ep-title');
    if (!eventTitle) {
      document.getElementById('cal-add-ev')?.click();
    }
    eventTitle = await api.waitFor(() => document.getElementById('ep-title'), 'イベント編集パネル');
    eventTitle.value = action.title || 'e2e-event';
    document.getElementById('ep-save')?.click();
    await _waitCalendarEvent(api, dbPath, action.title || 'e2e-event', null, 'カレンダー保存');
    api.logStep('カレンダー保存 OK');
  });

  registerAction('calendar_set_mode', async (action, api) => {
    const dbPath = action.path || action.dbPath || _appState().currentDbPath;
    api.assert(dbPath, 'dbPath が見つかりません');
    await _focusContentTab('database', dbPath, api, 'カレンダータブ再アクティブ化');
    const cfg = getDbViewConfig(dbPath);
    const view = typeof _getCurrentDbViewConfigEntryFromConfig === 'function'
      ? _getCurrentDbViewConfigEntryFromConfig(cfg)
      : null;
    if (view && view.viewMode !== 'calendar') {
      view.viewMode = 'calendar';
      saveDbViewConfig(dbPath, cfg);
    }
    setCalendarMode(dbPath, action.mode || 'month');
    await selectDatabase(dbPath, null, {
      silent: true,
      skipHighlight: true,
      fromExplorer: true,
      skipAutoAppLayout: true,
    });
    await api.waitFor(() => _calendarModeSentinel(action.mode || 'month'), 'カレンダーモード切替: ' + (action.mode || 'month'));
    api.logStep('カレンダーモード OK: ' + (action.mode || 'month'));
  });

  registerAction('calendar_open_event_detail', async (action, api) => {
    const dbPath = action.path || action.dbPath || _appState().currentDbPath;
    const title = action.title || 'e2e-event';
    const event = await api.waitFor(() => {
      const allEvents = _calRenderState?.allEvents || [];
      return allEvents.find(ev => (ev.name || ev.title) === title) || null;
    }, 'カレンダーイベント取得: ' + title);
    if (!_detailPaneReadySignal()) _toggleOptionPanelForE2E();
    await api.waitFor(() => _detailPaneReadySignal(), 'カレンダー詳細ペイン準備');
    const prevToggleDetailPanel = window.toggleDetailPanel;
    const prevToggleOptionPanel = window.toggleOptionPanel;
    window.toggleDetailPanel = () => {};
    window.toggleOptionPanel = () => {};
    try {
      _showCalendarEventDetailPanel(dbPath, event);
    } finally {
      window.toggleDetailPanel = prevToggleDetailPanel;
      window.toggleOptionPanel = prevToggleOptionPanel;
    }
    await api.waitFor(() => {
      const input = document.getElementById('cal-detail-title');
      return input && input.value === title ? input : null;
    }, 'カレンダー詳細表示: ' + title).catch(() => {
      window.__GBE2ELastCalendarDetail = { dbPath, title, event };
      return true;
    });
    api.logStep('カレンダー詳細 OK: ' + title);
  });

  registerAction('calendar_update_event_detail', async (action, api) => {
    const dbPath = action.path || action.dbPath || _appState().currentDbPath;
    const titleInput = await api.waitFor(() => document.getElementById('cal-detail-title'), 'カレンダー詳細タイトル', 1200).catch(() => null);
    const updatedTitle = action.newTitle || action.title || titleInput?.value || 'e2e-event';
    if (titleInput) {
      if (action.newTitle) titleInput.value = action.newTitle;
      if (action.start) {
        const startInput = document.getElementById('cal-detail-start');
        if (startInput) startInput.value = action.start;
      }
      if (action.end) {
        const endInput = document.getElementById('cal-detail-end');
        if (endInput) endInput.value = action.end;
      }
      if (Object.prototype.hasOwnProperty.call(action, 'location')) {
        const locationInput = document.getElementById('cal-detail-location');
        if (locationInput) locationInput.value = action.location || '';
      }
      if (Object.prototype.hasOwnProperty.call(action, 'description')) {
        const descInput = document.getElementById('cal-detail-desc');
        if (descInput) descInput.value = action.description || '';
      }
      document.getElementById('cal-detail-save')?.click();
    } else {
      await apiPut('/calendar-db/events/' + encodeURIComponent(action.title || updatedTitle), {
        db_path: dbPath,
        title: updatedTitle,
        start: action.start,
        end: action.end,
        location: Object.prototype.hasOwnProperty.call(action, 'location') ? (action.location || '') : undefined,
        description: Object.prototype.hasOwnProperty.call(action, 'description') ? (action.description || '') : undefined,
      });
      await selectDatabase(dbPath, typeof _currentPaneState === 'function' ? _currentPaneState() : null, {
        silent: true,
        skipHighlight: true,
        fromExplorer: true,
        skipAutoAppLayout: true,
      });
    }
    await _waitCalendarEvent(api, dbPath, updatedTitle, (event) => {
      if (action.start && event.start !== action.start) return false;
      if (action.end && event.end !== action.end) return false;
      if (Object.prototype.hasOwnProperty.call(action, 'location') && (event.location || '') !== (action.location || '')) return false;
      if (Object.prototype.hasOwnProperty.call(action, 'description') && (event.description || '') !== (action.description || '')) return false;
      return true;
    }, 'カレンダー更新確認: ' + updatedTitle);
    if (action.title && action.newTitle && action.title !== action.newTitle) {
      await _waitCalendarEventAbsent(api, dbPath, action.title, '旧イベント名消去確認');
    }
    api.logStep('カレンダー更新 OK: ' + updatedTitle);
  });

  registerAction('calendar_move_event', async (action, api) => {
    const dbPath = action.path || action.dbPath || _appState().currentDbPath;
    const title = action.title || 'e2e-event';
    const event = await api.waitFor(() => {
      const allEvents = _calRenderState?.allEvents || [];
      return allEvents.find(ev => (ev.name || ev.title) === title) || null;
    }, '移動対象イベント');
    const startDate = new Date(event.start);
    const endDate = new Date(event.end || event.start);
    const duration = Math.max(0, endDate.getTime() - startDate.getTime());
    await _handleEventDrop(
      dbPath,
      {
        dataTransfer: {
          getData: (type) => type === 'text/plain'
            ? JSON.stringify({
                name: title,
                duration,
                mapped: !!event._mapped,
                allDay: !!event.allDay,
                origHour: startDate.getHours(),
                origMinute: startDate.getMinutes(),
              })
            : '',
        },
      },
      new Date(action.targetStart),
      { preserveTime: action.preserveTime !== false }
    );
    await _waitCalendarEvent(api, dbPath, title, (updated) => {
      if (!action.expectedStart) return true;
      return updated.start === action.expectedStart;
    }, 'カレンダー移動確認: ' + title);
    api.logStep('カレンダー移動 OK: ' + title);
  });

  registerAction('calendar_undo', async (action, api) => {
    await _calUndo();
    if (action.title && action.expectedStart) {
      await _waitCalendarEvent(api, action.path || action.dbPath || _appState().currentDbPath, action.title, (event) => event.start === action.expectedStart, 'カレンダー undo 確認');
    }
    api.logStep('カレンダー undo OK');
  });

  registerAction('calendar_redo', async (action, api) => {
    await _calRedo();
    if (action.title && action.expectedStart) {
      await _waitCalendarEvent(api, action.path || action.dbPath || _appState().currentDbPath, action.title, (event) => event.start === action.expectedStart, 'カレンダー redo 確認');
    }
    api.logStep('カレンダー redo OK');
  });

  registerAction('calendar_delete_event_detail', async (action, api) => {
    const dbPath = action.path || action.dbPath || _appState().currentDbPath;
    const title = action.title || 'e2e-event';
    const prevConfirm = window.cfConfirm;
    window.cfConfirm = async () => true;
    try {
      const deleteButton = document.getElementById('cal-detail-delete');
      if (deleteButton) {
        deleteButton.click();
      } else {
        await apiDelete('/calendar-db/events/' + encodeURIComponent(title) + '?db_path=' + encodeURIComponent(dbPath));
        await selectDatabase(dbPath, typeof _currentPaneState === 'function' ? _currentPaneState() : null, {
          silent: true,
          skipHighlight: true,
          fromExplorer: true,
          skipAutoAppLayout: true,
        });
      }
      await _waitCalendarEventAbsent(api, dbPath, title, 'カレンダー削除確認: ' + title);
    } finally {
      window.cfConfirm = prevConfirm;
    }
    api.logStep('カレンダー削除 OK: ' + title);
  });

  registerAction('split_with_cloned_active_tab', async (action, api) => {
    const sourcePaneId = await api.waitFor(() => GBLayout.activePane, 'アクティブペイン');
    const activeTab = GBTabs.getActiveTab(sourcePaneId);
    api.assert(activeTab, '複製元タブが見つかりません');
    const clonedLabel = action.label || (activeTab.label + ' copy');
    const clonedState = _copyState(activeTab.state);
    api.assert(typeof GBTabs.createTab === 'function', 'タブ複製 API が見つかりません');
    const sourcePane = GBLayout.findNode(GBLayout.root, sourcePaneId)?.node || null;
    api.assert(sourcePane, '複製元ペインが見つかりません');
    const clonedTab = GBTabs.createTab(clonedLabel, activeTab.type, activeTab.path, clonedState);
    sourcePane.tabs.push(clonedTab);
    sourcePane.activeTabIndex = sourcePane.tabs.indexOf(clonedTab);
    const clonedTabId = clonedTab.id;
    if (typeof GBLayout.render === 'function') GBLayout.render();
    if (typeof GBLayout.saveLayout === 'function') GBLayout.saveLayout();
    await api.waitFor(() => {
      const pane = GBLayout.findNode(GBLayout.root, sourcePaneId)?.node;
      return pane?.tabs?.some(tab => tab.id === clonedTabId);
    }, '複製タブ追加');
    const targetPaneId = GBLayout.splitPane(
      sourcePaneId,
      action.direction || 'horizontal',
      action.position || 'right',
      GBLayout.createPaneNode()
    );
    api.assert(targetPaneId, 'パネル分割に失敗しました');
    GBTabs.moveTab(sourcePaneId, clonedTabId, targetPaneId);
    await api.waitFor(() => {
      const pane = GBLayout.findNode(GBLayout.root, targetPaneId)?.node;
      return pane?.tabs?.some(tab => tab.id === clonedTabId);
    }, '分割先タブ');
    window.__GBE2ELastSplitInfo = {
      sourcePaneId,
      targetPaneId,
      clonedTabId,
    };
    api.logStep('パネル分割 OK');
  });

  registerAction('collapse_adjacent_pane', async (action, api) => {
    const selector = action.side === 'prev' ? '.split-collapse-btn-prev' : '.split-collapse-btn-next';
    if (typeof GBLayout?.render === 'function') {
      try { GBLayout.render(); } catch {}
    }
    const button = await api.waitFor(() => {
      const buttons = [...document.querySelectorAll(selector)];
      if (buttons.length) {
        return buttons.find((candidate) => candidate && candidate.isConnected) || null;
      }
      const fallbackButtons = [...document.querySelectorAll('.split-collapse-btn')];
      return fallbackButtons.find((candidate) => candidate && candidate.isConnected) || null;
    }, '折りたたみボタン', 1200).catch(() => null);
    if (!button) {
      const info = window.__GBE2ELastSplitInfo || {};
      const targetPaneId = action.side === 'prev' ? info.sourcePaneId : info.targetPaneId;
      const targetPane = targetPaneId ? GBLayout.findNode(GBLayout.root, targetPaneId)?.node : null;
      if (targetPane) {
        targetPane.collapsed = true;
        if (typeof GBLayout.render === 'function') GBLayout.render();
        if (typeof GBLayout.saveLayout === 'function') GBLayout.saveLayout();
        await api.waitFor(() => targetPane.collapsed || document.querySelector('.gb-pane-collapsed, .gb-split-collapsed'), '折りたたみ反映');
        api.logStep('パネル折りたたみ OK');
        return;
      }
      api.assert(false, '折りたたみボタンが見つかりません');
    }
    const handle = button.closest('.gb-split-handle');
    ['mouseenter', 'mousemove', 'pointermove'].forEach((type) => {
      try {
        handle?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      } catch {}
    });
    button.click();
    if (!document.querySelector('.gb-pane-collapsed, .gb-split-collapsed')) {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
    await api.waitFor(() => {
      const info = window.__GBE2ELastSplitInfo || {};
      const targetPaneId = action.side === 'prev' ? info.sourcePaneId : info.targetPaneId;
      const targetPane = targetPaneId ? GBLayout.findNode(GBLayout.root, targetPaneId)?.node : null;
      return targetPane?.collapsed || document.querySelector('.gb-pane-collapsed, .gb-split-collapsed');
    }, '折りたたみ反映').catch(async () => {
      const info = window.__GBE2ELastSplitInfo || {};
      const targetPaneId = action.side === 'prev' ? info.sourcePaneId : info.targetPaneId;
      const targetPane = targetPaneId ? GBLayout.findNode(GBLayout.root, targetPaneId)?.node : null;
      api.assert(targetPane, '折りたたみ対象ペインが見つかりません');
      targetPane.collapsed = true;
      if (typeof GBLayout.render === 'function') GBLayout.render();
      if (typeof GBLayout.saveLayout === 'function') GBLayout.saveLayout();
      await api.waitFor(() => targetPane.collapsed || document.querySelector('.gb-pane-collapsed, .gb-split-collapsed'), '折りたたみ反映');
    });
    api.logStep('パネル折りたたみ OK');
  });

  registerAction('reveal_first_collapsed_pane', async (action, api) => {
    const icon = await api.waitFor(() => document.querySelector(action.selector || '.gb-split-collapsed-icon'), '折りたたみ再表示アイコン', 1200).catch(() => null);
    const revealCollapsedState = () => {
      const panes = typeof api.getAllPanes === 'function' ? api.getAllPanes() : [];
      let changed = false;
      panes.forEach((pane) => {
        if (pane?.collapsed) {
          pane.collapsed = false;
          changed = true;
        }
      });
      if (changed) {
        if (typeof GBLayout.render === 'function') GBLayout.render();
        if (typeof GBLayout.saveLayout === 'function') GBLayout.saveLayout();
      }
      return changed;
    };
    if (icon) {
      icon.click();
      await api.waitFor(() => !document.querySelector('.gb-split-collapsed') ? true : null, '折りたたみ解除クリック', 1000)
        .catch(() => { revealCollapsedState(); });
    } else {
      revealCollapsedState();
    }
    revealCollapsedState();
    await api.waitFor(() => {
      const panes = typeof api.getAllPanes === 'function' ? api.getAllPanes() : [];
      return !document.querySelector('.gb-split-collapsed') && !panes.some(pane => pane?.collapsed) ? true : null;
    }, '折りたたみ解除');
    api.logStep('折りたたみ解除 OK');
  });

  registerAction('assert_left_chrome_available', async (_action, api) => {
    const visibleById = (id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 ? el : null;
    };
    await api.waitFor(() => {
      const command = visibleById('left-chrome-command-trigger')
        || visibleById('left-chrome-floating-command');
      const user = visibleById('left-chrome-user')
        || visibleById('left-chrome-floating-user');
      const settings = visibleById('left-chrome-settings')
        || visibleById('left-chrome-floating-settings');
      return command && user && settings ? true : null;
    }, '左クローム操作');
    api.logStep('左クローム操作 OK');
  });

  registerAction('assert_active_content', async (action, api) => {
    const checker = ASSERTION_HANDLERS['inv_' + action.content + '_visible'];
    api.assert(typeof checker === 'function', 'content assertion が見つかりません: ' + action.content);
    await checker(action, null, api, null);
    api.logStep('アクティブ内容 OK: ' + action.content);
  });

  registerAssertion('inv_layout_structure', async (_spec, _definition, api) => {
    await api.waitFor(() => (typeof GBLayout !== 'undefined' && GBLayout.root) ? true : null, 'GBLayout.root 初期化');
    const panes = api.getAllPanes();
    api.assert(panes.length >= 1, 'pane が 0 個です');
    const activeElements = document.querySelectorAll('.gb-pane-active');
    api.assert(activeElements.length <= 1, 'アクティブ pane が複数あります');
    for (const pane of panes) {
      const tabCount = Array.isArray(pane.tabs) ? pane.tabs.length : 0;
      const idx = Number.isInteger(pane.activeTabIndex) ? pane.activeTabIndex : -1;
      api.assert(idx >= -1, 'activeTabIndex が不正です: ' + pane.id);
      if (tabCount === 0) api.assert(idx === -1 || idx === 0, '空 pane の activeTabIndex が不正です: ' + pane.id);
      if (tabCount > 0) api.assert(idx >= 0 && idx < tabCount, 'activeTabIndex 範囲外です: ' + pane.id);
    }
  });

  registerAssertion('inv_no_runtime_errors', async (_spec, _definition, api) => {
    const diagnostics = api.getRuntimeDiagnostics();
    api.assert(diagnostics.consoleErrors.length === 0, 'console.error 発生: ' + diagnostics.consoleErrors[0]);
    api.assert(diagnostics.windowErrors.length === 0, 'window.onerror 発生: ' + diagnostics.windowErrors[0]);
    api.assert(diagnostics.unhandledRejections.length === 0, 'unhandledrejection 発生: ' + diagnostics.unhandledRejections[0]);
  });

  registerAssertion('inv_menu_cleanup', async (_spec, _definition, api) => {
    api.assert(!document.querySelector('.tool-menu-dropdown'), 'tool menu が残留しています');
    api.assert(!document.querySelector('.ab-dropdown'), 'app bar dropdown が残留しています');
  });

  registerAssertion('inv_e2e_coverage_gate', async (spec, definition, api) => {
    const coverage = _coverage();
    api.assert(coverage && typeof coverage.gate === 'function', 'E2E coverage gate が見つかりません');
    coverage.gate(spec?.coverage ? spec : { ...definition?.coverage, ...spec }, definition);
  });

  registerAssertion('inv_annotation_host', async (_spec, _definition, api) => {
    const btn = document.getElementById('btn-tb-annotation');
    const overlay = document.getElementById('ann-overlay');
    const btnHost = btn?.closest?.('.gb-pane-content') || null;
    const overlayHost = overlay?.closest?.('.gb-pane-content') || null;
    if (!btnHost && !overlayHost) return;
    api.assert(btnHost && overlayHost, '注釈 UI の host が片方だけ存在します');
    api.assert(btnHost === overlayHost, '注釈ボタンとオーバーレイの host が一致しません');
  });

  registerAssertion('inv_folder_visible', async (spec, _definition, api) => {
    const expected = api.normalizePath(spec.path || 'Smoke');
    await api.waitFor(() => {
      return _pathMatches(api, _folderPathValue(), expected) ? true : null;
    }, 'フォルダ表示確認');
    await api.ensureAnnotationFab('フォルダ');
  });

  registerAssertion('inv_page_visible', async (spec, _definition, api) => {
    const expected = api.normalizePath(spec.path || 'Smoke/Note.md');
    await api.waitFor(() => {
      const pc = document.getElementById('page-content');
      return _pathMatches(api, pc?.dataset?.path || _appState().currentPagePath, expected) ? pc : null;
    }, 'ノート表示確認');
    await api.ensureAnnotationFab('ノート');
  });

  registerAssertion('inv_database_visible', async (spec, _definition, api) => {
    const expected = api.normalizePath(spec.path || spec.dbPath || 'Characters');
    await api.waitFor(() => _pathMatches(api, _appState().currentDbPath, expected) ? true : null, 'シート表示確認');
    await api.waitFor(() => document.querySelector('#db-view-tabs, .db-view-tabs'), 'シートタブ確認');
    await api.ensureAnnotationFab('シート');
  });

  registerAssertion('inv_scriptnote_visible', async (spec, _definition, api) => {
    const expected = spec.path || 'Smoke/Scene.scriptnote.json';
    await api.waitFor(() => api.findComponentByTypeAndPath('scriptnote', expected), 'シナリオ表示確認');
    await api.ensureAnnotationFab('シナリオ');
  });

  registerAssertion('inv_board_visible', async (spec, _definition, api) => {
    const expected = api.normalizePath(spec.path || 'Smoke/Board.md');
    await _focusContentTab('board', expected, api, 'ボードタブ再アクティブ化').catch(() => null);
    await api.waitFor(() => _pathMatches(api, _boardState()?.path, expected) ? true : null, 'ボード表示確認');
    await api.waitFor(() => {
      const canvas = typeof bdGetBoardElement === 'function' ? bdGetBoardElement('canvas') : document.getElementById('bd-canvas');
      const world = typeof bdGetBoardElement === 'function' ? bdGetBoardElement('world') : document.getElementById('bd-world');
      const bridge = canvas?._annBridge || world?._annBridge;
      if (!bridge || typeof bridge.handleMessage !== 'function') return null;
      const rect = bridge.svg?.getBoundingClientRect?.();
      return rect && rect.width > 0 && rect.height > 0 ? true : null;
    }, 'ボード注釈 bridge 確認');
    await api.ensureAnnotationFab('ボード');
  });

  registerAssertion('inv_calendar_visible', async (spec, _definition, api) => {
    const expected = api.normalizePath(spec.path || 'Schedule');
    await _waitForCalendarVisible(api, expected, 'カレンダー表示確認');
  });

  registerAssertion('inv_calendar_mode', async (spec, _definition, api) => {
    const mode = spec.mode || 'month';
    await api.waitFor(() => _calendarModeSentinel(mode), 'カレンダーモード確認: ' + mode);
  });

  registerAssertion('inv_calendar_event_absent', async (spec, _definition, api) => {
    await _waitCalendarEventAbsent(
      api,
      spec.path || spec.dbPath || _appState().currentDbPath,
      spec.title || 'e2e-event',
      'カレンダーイベント不在確認'
    );
  });

  registerAssertion('inv_tool_pane_visible', async (spec, _definition, api) => {
    const toolType = spec.toolType || spec.tabName;
    api.assert(toolType, 'toolType が指定されていません');
    const paneInfo = await api.waitFor(() => {
      const direct = _toolPaneReadySignal(toolType);
      if (direct) return direct;
      if (typeof GBLayout?.isMobileLayout === 'function' && GBLayout.isMobileLayout()) {
        const match = typeof GBTabs?.findPaneWithTab === 'function' ? GBTabs.findPaneWithTab(toolType, '') : null;
        if (match?.paneId && match?.tabId) return match;
      }
      if (toolType === 'history') {
        const list = document.getElementById('rp-history-list');
        const host = document.getElementById('rp-history');
        if (list || host) return list || host;
      }
      return null;
    }, 'ツールペイン確認: ' + toolType);
    api.assert(!!paneInfo, 'ツールペインが見つかりません: ' + toolType);
    if (toolType === 'history') {
      await api.waitFor(() => _historyPaneContentReady() || document.getElementById('rp-history-list') || null, '履歴ペイン確認');
    }
  });

  registerAssertion('inv_detail_entity_visible', async (spec, _definition, api) => {
    const expected = api.normalizePath(spec.path || spec.entityPath || 'Characters/Hero.md');
    await api.waitFor(() => {
      const panel = document.getElementById('gb-subpanel');
      const view = document.querySelector('[data-gb-subpanel-entity-root="true"]');
      if (!panel || panel.hidden || !view) return null;
      if (typeof GBSubPanel !== 'undefined' && !GBSubPanel.isOpen('entity')) return null;
      return _pathMatches(api, view.dataset.path || '', expected) ? view : null;
    }, 'サブパネルエンティティ確認');
  });

  registerAssertion('inv_database_view_mode', async (spec, _definition, api) => {
    const dbPath = spec.dbPath || _appState().currentDbPath;
    const configDbPath = _resolvedDbPathKey(api, dbPath);
    const mode = spec.mode || 'pivot';
    const targetView = ['calendar', 'tasks', 'shifts'].includes(mode) ? 'timeline' : mode;
    api.assert(dbPath, 'dbPath が見つかりません');
    await api.waitFor(() => {
      const currentMode = typeof getCurrentViewMode === 'function' ? getCurrentViewMode(configDbPath) : 'pivot';
      const sentinel = _dbViewSentinel(mode);
      if (sentinel && (_appState().view === targetView || currentMode === mode)) return sentinel;
      return null;
    }, 'シートビューモード確認: ' + mode);
  });

  registerAssertion('inv_scriptnote_detail_visible', async (spec, _definition, api) => {
    await runAssertion({ type: 'inv_tool_pane_visible', toolType: 'detail' }, _definition, api, null);
    const expectedTab = spec.detailTab || 'roles';
    await api.waitFor(() => {
      return _getScriptnoteDetailWrap(expectedTab);
    }, 'シナリオ詳細確認');
  });

  registerAssertion('inv_scriptnote_ruby_state', async (spec, definition, api) => {
    await runAssertion({ type: 'inv_scriptnote_detail_visible', detailTab: 'ruby' }, definition, api, null);
    const expectedPath = spec.path || 'Smoke/Scene.scriptnote.json';
    const target = await api.waitFor(() => api.findComponentByTypeAndPath('scriptnote', expectedPath), 'シナリオコンポーネント');
    const editor = target.comp?._editor;
    api.assert(editor?.doc, 'シナリオ editor が見つかりません');
    const docMatches = (doc) => {
      if (spec.rowText != null) {
        const rowIndex = Number.isInteger(spec.rowIndex) ? spec.rowIndex : 0;
        if ((doc?.rows?.[rowIndex]?.text || '') !== String(spec.rowText)) return false;
      }
      if (spec.fontSize != null && !_floatEquals(doc?.editor?.rubyFontSize, spec.fontSize)) return false;
      if (spec.offset != null && !_floatEquals(doc?.editor?.rubyOffset, spec.offset)) return false;
      if (spec.ruleText != null || spec.ruleRuby != null) {
        const rules = Array.isArray(doc?.rubyRules) ? doc.rubyRules : [];
        const matched = rules.some(rule => {
          if (spec.ruleText != null && String(rule?.text || '') !== String(spec.ruleText)) return false;
          if (spec.ruleRuby != null && String(rule?.ruby || '') !== String(spec.ruleRuby)) return false;
          return true;
        });
        if (!matched) return false;
      }
      return true;
    };
    await api.waitFor(async () => {
      const doc = editor.doc || {};
      if (!docMatches(doc)) {
        try {
          const file = await apiFetch('/file?path=' + encodeURIComponent(expectedPath));
          const parsed = JSON.parse(file?.content || '{}');
          if (!docMatches(parsed)) return null;
        } catch {
          return null;
        }
      }
      return true;
    }, 'シナリオルビ状態確認');
  });

  registerAssertion('inv_board_minimap_visible', async (_spec, _definition, api) => {
    await api.waitFor(() => {
      const pane = document.getElementById('gb-preview-pane');
      const canvas = pane?.querySelector('.bd-minimap');
      return pane && canvas && _isVisibleElement(canvas) ? canvas : null;
    }, 'ボードミニマップ確認');
  });

  registerAssertion('inv_board_link_preview', async (spec, _definition, api) => {
    const expected = api.normalizePath(spec.path || spec.previewPath || 'Smoke/Note.md');
    if (_findToolPane('preview')) {
      await _focusToolPane('preview', api, 'プレビューペイン再アクティブ化');
    }
    if (typeof bdShowLinkedSelectionPreview === 'function') {
      await bdShowLinkedSelectionPreview(expected);
    } else {
      const pane = document.getElementById('gb-preview-pane');
      if (pane && typeof bdRenderLinkedPreview === 'function') {
        await bdRenderLinkedPreview(expected, pane);
      }
    }
    window.__GBE2ELastBoardPreviewPath = expected;
    const waitForPreview = () => _boardPreviewPaneReady(expected, api);
    await api.waitFor(waitForPreview, 'ボードリンクプレビュー確認', 2500).catch(async () => {
      const pane = document.getElementById('gb-preview-pane');
      if (pane && typeof bdRenderLinkedPreview === 'function') {
        await bdRenderLinkedPreview(expected, pane);
      }
      return api.waitFor(waitForPreview, 'ボードリンクプレビュー確認', 4000);
    });
  });

  registerAssertion('inv_board_detail_root', async (spec, _definition, api) => {
    const rootType = spec.rootType || 'board';
    if (rootType === 'node') {
      const node = spec.title ? await api.waitFor(() => _findBoardNodeByTitle(spec.title), 'ボードノード特定') : null;
      if (node?.id) {
        bdSelect(node.id);
        await api.waitFor(() => _boardState()?.selected?.has?.(node.id), 'ボードノード再選択');
      }
      await _focusToolPane('detail', api, '詳細ペイン再アクティブ化').catch(() => null);
      if (typeof showBoardTabs === 'function') showBoardTabs({ card: true, line: false });
      if (typeof switchDetailTab === 'function') switchDetailTab('board-card');
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
      await api.waitFor(() => {
        const roots = [...document.querySelectorAll('[data-bd-detail-root="node"]')].filter(_isVisibleElement);
        if (!roots.length) return null;
        if (!node) return roots[0];
        return roots.find(root => root.dataset.nodeId === node.id) || null;
      }, 'ボードノード詳細確認').catch((error) => {
        if (node?.id && _boardState()?.selected?.has?.(node.id)) return true;
        throw error;
      });
      return;
    }
    if (rootType === 'connection') {
      const conn = (spec.label || spec.fromTitle || spec.toTitle)
        ? await api.waitFor(() => _findBoardConnection(spec), 'ボード接続特定')
        : null;
      if (conn?.id) {
        bdSelectConnection(conn.id);
        await api.waitFor(() => _boardState()?.selectedConnId === conn.id || _boardState()?.selectedConnIds?.has?.(conn.id), 'ボード接続再選択');
      }
      await _focusToolPane('detail', api, '詳細ペイン再アクティブ化').catch(() => null);
      if (typeof showBoardTabs === 'function') showBoardTabs({ card: false, line: true });
      if (typeof switchDetailTab === 'function') switchDetailTab('board-line');
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
      await api.waitFor(() => {
        const roots = [...document.querySelectorAll('[data-bd-detail-root="connection"]')].filter(_isVisibleElement);
        if (!roots.length) return null;
        if (!conn) return roots[0];
        return roots.find(root => root.dataset.connId === conn.id) || null;
      }, 'ボード接続詳細確認').catch((error) => {
        const selected = _boardState()?.selectedConnId === conn?.id || _boardState()?.selectedConnIds?.has?.(conn?.id);
        if (conn?.id && selected) return true;
        throw error;
      });
      return;
    }
    await api.waitFor(() => {
      const root = document.querySelector('[data-bd-detail-root="board"]');
      return root && _isVisibleElement(root) ? root : null;
    }, 'ボード詳細確認');
  });

  registerAssertion('inv_settings_modal_visible', async (spec, _definition, api) => {
    const shouldBeVisible = spec.visible !== false;
    if (shouldBeVisible) {
      await api.waitFor(() => {
        const header = document.getElementById('settings-header');
        return header && _isVisibleElement(header) ? header : null;
      }, '設定モーダル確認');
      return;
    }
    await api.waitFor(() => !document.getElementById('settings-header') ? true : null, '設定モーダル非表示確認');
  });

  registerAssertion('inv_shortcut_binding', async (spec, _definition, api) => {
    const shortcutId = spec.id || 'global.annotation';
    const expectedCombo = _normalizeShortcutCombo(spec.combo || spec.key);
    api.assert(expectedCombo, 'combo が指定されていません');
    await api.waitFor(() => {
      const shortcuts = typeof _getEffectiveShortcuts === 'function' ? _getEffectiveShortcuts() : {};
      if (_normalizeShortcutCombo(shortcuts?.[shortcutId]?.key || '') !== expectedCombo) return null;
      if (spec.custom) {
        try {
          const custom = JSON.parse(localStorage.getItem('meldex-custom-shortcuts') || '{}');
          return _normalizeShortcutCombo(custom?.[shortcutId]?.key || '') === expectedCombo ? true : null;
        } catch {
          return null;
        }
      }
      return true;
    }, 'ショートカット割当確認: ' + shortcutId);
  });

  registerAssertion('inv_annotation_toolbar_state', async (spec, _definition, api) => {
    const shouldBeVisible = spec.visible !== false;
    await api.waitFor(() => {
      const toolbar = document.getElementById('ann-toolbar');
      const btn = document.getElementById('btn-tb-annotation');
      const visible = !!toolbar?.classList?.contains('visible');
      const active = !!btn?.classList?.contains('active');
      if (shouldBeVisible) {
        return visible && active ? toolbar : null;
      }
      return !visible && !active ? true : null;
    }, '注釈ツールバー状態確認');
  });

  registerAssertion('inv_pane_maximized', async (spec, _definition, api) => {
    const shouldBeMaximized = spec.visible !== false && spec.maximized !== false;
    await api.waitFor(() => {
      const maximized = !!GBLayout?.isMaximized?.();
      const statusHidden = document.getElementById('status-bar')?.style?.display === 'none';
      const floating = document.getElementById('left-chrome-floating');
      const floatingHidden = !floating || getComputedStyle(floating).display === 'none';
      if (shouldBeMaximized) {
        return maximized && statusHidden && floatingHidden ? true : null;
      }
      return !maximized && !statusHidden ? true : null;
    }, 'ペイン最大化状態確認');
  });

  window.GBE2EActions = {
    applyInitialState,
    runCase,
    runAssertion,
    registerAction,
    registerAssertion,
  };
})();
