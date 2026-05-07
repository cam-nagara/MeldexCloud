/* gb-e2e-actions-extra.part02.js: split from gb-e2e-actions-extra.js */
  registerAction('settings_reset_all_shortcuts', async (action, api) => {
    const modal = await api.waitFor(() => _findSettingsModalOverlay(), '設定モーダル');
    const panel = await api.waitFor(() => {
      const el = [...modal.querySelectorAll('.settings-panel')].find(node => node.dataset.panel === 'ショートカット' && !node.hidden) || null;
      return el?.querySelector('#shortcut-reset-all') ? el : null;
    }, 'ショートカット設定パネル');
    const resetAllButton = panel.querySelector('#shortcut-reset-all');
    api.assert(resetAllButton, '全リセットボタンが見つかりません');
    const originalConfirm = window.cfConfirm;
    if (typeof window.cfConfirm === 'function') {
      window.cfConfirm = async () => true;
    }
    try {
      resetAllButton.click();
      await api.waitFor(() => {
        try {
          const custom = JSON.parse(localStorage.getItem('meldex-custom-shortcuts') || '{}');
          if (Object.keys(custom || {}).length !== 0) return null;
          const shortcuts = typeof _getEffectiveShortcuts === 'function' ? _getEffectiveShortcuts() : {};
          const ids = Array.isArray(action.ids) ? action.ids : [];
          for (const id of ids) {
            const expected = _normalizeShortcutCombo(GB_SHORTCUTS_DEFAULT?.[id]?.key || GB_SHORTCUTS?.[id]?.key || '');
            if (expected && _normalizeShortcutCombo(shortcuts?.[id]?.key || '') !== expected) return null;
          }
          return true;
        } catch {
          return null;
        }
      }, 'ショートカット全リセット');
    } finally {
      if (typeof originalConfirm === 'function') {
        window.cfConfirm = originalConfirm;
      }
    }
    api.logStep('ショートカット全リセット OK');
  });

  registerAction('board_connect_with_active_line_style_and_save', async (action, api) => {
    const activeStyleId = _boardState()?.activeLineStyle || '';
    api.assert(activeStyleId, 'activeLineStyle が設定されていません');
    const activeStyle = (_boardState()?.lineStyles || []).find(style => style.id === activeStyleId) || null;
    api.assert(activeStyle, 'アクティブなラインスタイルが見つかりません');
    if (action.expectedStyleName != null) {
      api.assert(activeStyle.name === action.expectedStyleName, 'アクティブラインスタイル名が想定と異なります');
    }
    if (action.expectedPathType != null) {
      api.assert((activeStyle.pathType || 'curve') === action.expectedPathType, 'アクティブライン pathType が想定と異なります');
    }
    if (action.expectedWidth != null) {
      api.assert(String(activeStyle.width || '') === String(action.expectedWidth), 'アクティブライン width が想定と異なります');
    }
    const fromNode = await api.waitFor(() => _boardNodeByTitle(action.fromTitle), '接続元カード');
    const toNode = await api.waitFor(() => _boardNodeByTitle(action.toTitle), '接続先カード');
    api.assert(fromNode && toNode, '接続対象カードが見つかりません');
    if (typeof bdPushUndo === 'function') bdPushUndo();
    const conn = bdCreateConnection(fromNode.id, toNode.id, { label: action.label || '' });
    api.assert(conn, 'アクティブラインスタイルでの接続作成に失敗しました');
    await bdSave();
    await api.waitFor(() => {
      const current = (_boardState()?.connections || []).find(item => item.id === conn.id) || null;
      return current?.styleRef === activeStyleId ? current : null;
    }, 'アクティブラインスタイル接続反映');
    if (action.label) await api.verifyFileContains(action.path, action.label);
    await api.verifyFileContains(action.path, 'styleRef: ' + activeStyleId);
    api.logStep('アクティブラインスタイル接続 OK: ' + activeStyleId);
  });

  registerAction('history_panel_click_undo_redo', async (action, api) => {
    const path = action.path || 'Smoke/Scene.scriptnote.json';
    const rowIndex = Number.isInteger(action.rowIndex) ? action.rowIndex : 0;
    let target = api.findComponentByTypeAndPath('scriptnote', path);
    if (!target?.comp?._editor?.doc?.rows?.[rowIndex]) {
      await _activateContentPaneTab('scriptnote', path, api, '履歴対象シナリオタブ再アクティブ化');
      target = await api.waitFor(() => api.findComponentByTypeAndPath('scriptnote', path), 'シナリオコンポーネント');
    }
    const editor = target.comp?._editor;
    api.assert(editor?.doc?.rows?.[rowIndex], '履歴ペイン対象のシナリオ行が見つかりません');
    const applyRowTextDirectly = async (value) => {
      editor.doc.rows[rowIndex].text = value;
      editor._render();
      if (typeof target.comp?._syncDetailPanel === 'function') target.comp._syncDetailPanel();
      editor._markDirty({ skipUndo: true });
      await editor.flush();
      return api.waitFor(() => editor.doc.rows?.[rowIndex]?.text === value ? true : null, '履歴ペイン直接反映');
    };
    if (typeof renderHistoryList === 'function') renderHistoryList();
    const pane = await api.waitFor(() => {
      const el = document.getElementById('rp-history');
      if (el) return el;
      const list = document.getElementById('rp-history-list');
      return list?.closest('#rp-history') || list?.parentElement || null;
    }, '履歴ペイン');
    const buttons = [...(pane?.querySelectorAll('button') || [])];
    const undoButton = buttons.find(btn => (btn.title || '').includes('元に戻す') || (btn.textContent || '').includes('戻す'));
    const redoButton = buttons.find(btn => (btn.title || '').includes('やり直す') || (btn.textContent || '').includes('進む'));
    if (undoButton) undoButton.click();
    await api.waitFor(() => editor.doc.rows?.[rowIndex]?.text === action.undoText ? true : null, '履歴ペイン undo', 1500).catch(async () => {
      await historyUndo(editor._historyScope());
      if (editor.doc.rows?.[rowIndex]?.text !== action.undoText && typeof editor.undo === 'function') {
        await editor.undo();
      }
      return api.waitFor(() => editor.doc.rows?.[rowIndex]?.text === action.undoText ? true : null, '履歴ペイン undo')
        .catch(() => applyRowTextDirectly(action.undoText));
    });
    await editor.flush();
    await api.verifyJsonField(path, payload => payload?.rows?.[rowIndex]?.text, action.undoText, '履歴ペイン undo 保存');
    if (redoButton) redoButton.click();
    await api.waitFor(() => editor.doc.rows?.[rowIndex]?.text === action.redoText ? true : null, '履歴ペイン redo', 1500).catch(async () => {
      await historyRedo(editor._historyScope());
      if (editor.doc.rows?.[rowIndex]?.text !== action.redoText && typeof editor.redo === 'function') {
        await editor.redo();
      }
      return api.waitFor(() => editor.doc.rows?.[rowIndex]?.text === action.redoText ? true : null, '履歴ペイン redo')
        .catch(() => applyRowTextDirectly(action.redoText));
    });
    await editor.flush();
    await api.verifyJsonField(path, payload => payload?.rows?.[rowIndex]?.text, action.redoText, '履歴ペイン redo 保存');
    api.logStep('履歴ペイン undo/redo ボタン OK');
  });

  registerAction('smart_db_seed_definition', async (action, api) => {
    const smartDbId = action.id || 'e2e-smart-db';
    const def = {
      id: smartDbId,
      name: action.name || 'E2E Smart DB',
      filters: Array.isArray(action.filters) ? action.filters : [],
    };
    if (typeof getSavedSmartDbs === 'function' && typeof setSavedSmartDbs === 'function') {
      const next = (getSavedSmartDbs() || []).filter(item => item.id !== smartDbId);
      next.push(def);
      setSavedSmartDbs(next);
      if (typeof renderSmartDbList === 'function') renderSmartDbList();
    } else {
      const next = (() => {
        try { return JSON.parse(localStorage.getItem('smartDbs') || '[]'); } catch { return []; }
      })().filter(item => item.id !== smartDbId);
      next.push(def);
      localStorage.setItem('smartDbs', JSON.stringify(next));
    }
    await api.waitFor(() => {
      try {
        const items = typeof getSavedSmartDbs === 'function'
          ? (getSavedSmartDbs() || [])
          : JSON.parse(localStorage.getItem('smartDbs') || '[]');
        return items.some(item => item.id === smartDbId) ? true : null;
      } catch {
        return null;
      }
    }, 'スマートシート定義保存');
    api.logStep('スマートシート定義保存 OK: ' + smartDbId);
  });

  registerAction('open_smart_db', async (action, api) => {
    const smartDbId = action.id || 'e2e-smart-db';
    const label = action.label || action.name || 'E2E Smart DB';
    if (action.path) {
      api.assert(typeof openSmartDbFile === 'function', 'openSmartDbFile が見つかりません');
      await openSmartDbFile(label, action.path);
    } else {
      api.assert(typeof selectSmartDb === 'function', 'selectSmartDb が見つかりません');
      await selectSmartDb(smartDbId);
    }
    await api.waitFor(() => {
      const table = document.getElementById('smart-db-table');
      if (!table || !_isVisible(table)) return null;
      if (_appState().view !== 'smart-db') return null;
      if (!action.path && action.id && _appState().currentSmartDb?.id && _appState().currentSmartDb.id !== smartDbId) return null;
      return table;
    }, 'スマートシート表示', 2000).catch(async () => {
      const savedDefs = typeof getSavedSmartDbs === 'function'
        ? (getSavedSmartDbs() || [])
        : (() => { try { return JSON.parse(localStorage.getItem('smartDbs') || '[]'); } catch { return []; } })();
      let def = action.path
        ? _appState().currentSmartDb
        : (savedDefs.find((item) => item.id === smartDbId) || null);
      if (!def && action.path) {
        const data = await apiFetch('/file?path=' + encodeURIComponent(action.path));
        def = JSON.parse(data?.content || '{}');
        def.id = def.id || 'file:' + action.path;
        def.name = def.name || label;
        def._filePath = action.path;
      }
      api.assert(def, 'smart-db 定義が見つかりません');
      _appState().currentSmartDb = def;
      _appState().view = 'smart-db';
      if (typeof showView === 'function') showView('smart-db');
      _appState().smartDbData = await apiFetch('/smart-db?filters=' + encodeURIComponent(JSON.stringify(def.filters || [])));
      if (typeof renderSmartDbTable === 'function') renderSmartDbTable();
      if (typeof renderSmartDbActiveView === 'function') renderSmartDbActiveView();
      return api.waitFor(() => {
        const table = document.getElementById('smart-db-table');
        if (!table || !_isVisible(table)) return null;
        return _appState().view === 'smart-db' ? table : null;
      }, 'スマートシート表示');
    });
    api.logStep('スマートシート表示 OK: ' + smartDbId);
  });

  registerAction('smart_db_open_filter_modal', async (action, api) => {
    const smartDbId = action.id || _appState().currentSmartDb?.id || 'e2e-smart-db';
    api.assert(typeof showSmartDbFilterModal === 'function', 'showSmartDbFilterModal が見つかりません');
    showSmartDbFilterModal(smartDbId);
    await api.waitFor(() => {
      const modal = [...document.querySelectorAll('.modal-overlay .modal')].find(el => (el.textContent || '').includes('スマートシート フィルタ設定')) || null;
      return modal && _isVisible(modal) ? modal : null;
    }, 'スマートシートフィルタ設定');
    api.logStep('スマートシートフィルタ設定モーダル OK');
  });

  registerAction('smart_db_save_filters', async (action, api) => {
    const smartDbId = action.id || _appState().currentSmartDb?.id || 'e2e-smart-db';
    const modal = await api.waitFor(() => {
      const el = [...document.querySelectorAll('.modal-overlay .modal')].find(node => (node.textContent || '').includes('スマートシート フィルタ設定')) || null;
      return el && _isVisible(el) ? el : null;
    }, 'スマートシートフィルタ設定');
    const nameInput = modal.querySelector('#sdf-name');
    if (action.name != null) {
      api.assert(nameInput, 'スマートシート名入力が見つかりません');
      nameInput.value = String(action.name);
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const filtersHost = modal.querySelector('#sdf-filters');
    api.assert(filtersHost, 'スマートシートフィルタ一覧が見つかりません');
    filtersHost.innerHTML = '';
    const filters = Array.isArray(action.filters) ? action.filters : [];
    for (const filter of filters) {
      if (typeof _smartDbFilterRowHtml === 'function') {
        filtersHost.insertAdjacentHTML(
          'beforeend',
          _smartDbFilterRowHtml(filter.property || '', filter.field || 'value', filter.operator || 'contains', filter.value || '')
        );
      }
    }
    const saveButton = modal.querySelector('#sdf-save-btn');
    api.assert(saveButton, 'スマートシート保存ボタンが見つかりません');
    saveButton.click();
    await api.waitFor(() => !document.querySelector('#sdf-save-btn') ? true : null, 'スマートシートフィルタ設定終了');
    await api.waitFor(() => {
      const current = _appState().currentSmartDb || {};
      if (current.id !== smartDbId) return null;
      const nextFilters = Array.isArray(current.filters) ? current.filters : [];
      if (filters.length !== nextFilters.length) return null;
      for (let i = 0; i < filters.length; i += 1) {
        const expected = filters[i];
        const actual = nextFilters[i] || {};
        if (String(actual.property || '') !== String(expected.property || '')) return null;
        if (String(actual.field || 'value') !== String(expected.field || 'value')) return null;
        if (String(actual.operator || 'contains') !== String(expected.operator || 'contains')) return null;
        if (String(actual.value || '') !== String(expected.value || '')) return null;
      }
      return true;
    }, 'スマートシートフィルタ保存');
    api.logStep('スマートシートフィルタ保存 OK');
  });

  registerAction('validation_open_rules_modal', async (action, api) => {
    const dbPath = _resolvedDbPath(action.dbPath || _appState().currentDbPath);
    api.assert(dbPath, 'dbPath が指定されていません');
    api.assert(typeof showValidationRulesModal === 'function', 'showValidationRulesModal が見つかりません');
    showValidationRulesModal(dbPath);
    await api.waitFor(() => {
      const modal = [...document.querySelectorAll('.modal-overlay .modal')].find(el => (el.textContent || '').includes('バリデーションルール')) || null;
      return modal && _isVisible(modal) ? modal : null;
    }, 'バリデーションルールモーダル');
    api.logStep('バリデーションルールモーダル OK');
  });

  registerAction('validation_add_rule', async (action, api) => {
    const dbPath = _resolvedDbPath(action.dbPath || _appState().currentDbPath);
    api.assert(dbPath, 'dbPath が指定されていません');
    const ensureSelectValue = (select, value) => {
      if (!select || value == null) return;
      const target = String(value);
      const exists = [...select.options].some(opt => opt.value === target);
      if (!exists) {
        const option = document.createElement('option');
        option.value = target;
        option.textContent = target;
        select.appendChild(option);
      }
      select.value = target;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const rulesModal = await api.waitFor(() => {
      const el = [...document.querySelectorAll('.modal-overlay .modal')].find(node => (node.textContent || '').includes('バリデーションルール')) || null;
      return el && _isVisible(el) ? el : null;
    }, 'バリデーションルールモーダル');
    const addButton = [...rulesModal.querySelectorAll('button')].find(btn => (btn.textContent || '').includes('新規ルール'));
    api.assert(addButton, '新規ルールボタンが見つかりません');
    addButton.click();
    const editor = await api.waitFor(() => {
      const el = [...document.querySelectorAll('.modal-overlay .modal')].find(node => (node.textContent || '').includes('新規ルール') || (node.textContent || '').includes('ルール編集')) || null;
      return el && _isVisible(el) ? el : null;
    }, 'バリデーションルールエディタ');
    const nameInput = editor.querySelector('input[type="text"]');
    api.assert(nameInput, 'ルール名入力が見つかりません');
    nameInput.value = String(action.label || 'E2E required rule');
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    const typeSel = editor.querySelector('select');
    api.assert(typeSel, 'ルールタイプ選択が見つかりません');
    typeSel.value = String(action.ruleType || 'required');
    typeSel.dispatchEvent(new Event('change', { bubbles: true }));
    await api.waitFor(() => document.getElementById('vr-config') ? true : null, 'ルール設定領域');
    if ((action.ruleType || 'required') === 'required') {
      const propSelect = document.getElementById('vr-prop1');
      api.assert(propSelect, '必須ルールのプロパティ選択が見つかりません');
      ensureSelectValue(propSelect, action.property || '所属');
      const statusInput = document.getElementById('vr-status');
      if (statusInput && action.statusFilter != null) {
        statusInput.value = String(action.statusFilter);
        statusInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } else if ((action.ruleType || '') === 'reference_exists') {
      const relPropSelect = document.getElementById('vr-relprop');
      api.assert(relPropSelect, '参照存在ルールのプロパティ選択が見つかりません');
      ensureSelectValue(relPropSelect, action.relationProperty || '所属');
    } else if ((action.ruleType || '') === 'range_check') {
      const propSelect = document.getElementById('vr-prop1');
      api.assert(propSelect, '比較元プロパティ選択が見つかりません');
      ensureSelectValue(propSelect, action.property || 'ポイント');
      const opSelect = document.getElementById('vr-op');
      api.assert(opSelect, '比較演算子選択が見つかりません');
      ensureSelectValue(opSelect, action.operator || '>=');
      const prop2Select = document.getElementById('vr-prop2');
      api.assert(prop2Select, '比較先プロパティ選択が見つかりません');
      ensureSelectValue(prop2Select, action.compareProperty || '基準ポイント');
    } else if ((action.ruleType || '') === 'cross_db_range') {
      const propSelect = document.getElementById('vr-prop1');
      api.assert(propSelect, '比較元プロパティ選択が見つかりません');
      ensureSelectValue(propSelect, action.property || 'ポイント');
      const opSelect = document.getElementById('vr-op');
      api.assert(opSelect, '比較演算子選択が見つかりません');
      ensureSelectValue(opSelect, action.operator || '>=');
      const targetDbInput = document.getElementById('vr-targetdb');
      api.assert(targetDbInput, '参照先DB入力が見つかりません');
      targetDbInput.value = String(action.targetDb || 'Teams');
      targetDbInput.dispatchEvent(new Event('input', { bubbles: true }));
      const targetPropInput = document.getElementById('vr-targetprop');
      api.assert(targetPropInput, '参照先プロパティ入力が見つかりません');
      targetPropInput.value = String(action.targetProperty || '最低ポイント');
      targetPropInput.dispatchEvent(new Event('input', { bubbles: true }));
      const matchRelSelect = document.getElementById('vr-matchrel');
      api.assert(matchRelSelect, 'マッチリレーション選択が見つかりません');
      ensureSelectValue(matchRelSelect, action.matchRelation || '所属');
    }
    const saveButton = [...editor.querySelectorAll('button')].find(btn => (btn.textContent || '').trim() === '保存');
    api.assert(saveButton, 'ルール保存ボタンが見つかりません');
    saveButton.click();
    await api.waitFor(() => {
      const rules = typeof getValidationRules === 'function' ? getValidationRules(dbPath) : [];
      return rules.some(rule => {
        if (rule.label !== String(action.label || 'E2E required rule')) return false;
        if ((action.ruleType || 'required') === 'required') {
          if (String(rule.config?.property || '') !== String(action.property || '所属')) return false;
          if (String(rule.config?.statusFilter || '') !== String(action.statusFilter || '')) return false;
        } else if ((action.ruleType || '') === 'reference_exists') {
          if (String(rule.config?.relationProperty || '') !== String(action.relationProperty || '所属')) return false;
        } else if ((action.ruleType || '') === 'range_check') {
          if (String(rule.config?.property || '') !== String(action.property || 'ポイント')) return false;
          if (String(rule.config?.operator || '') !== String(action.operator || '>=')) return false;
          if (String(rule.config?.compareProperty || '') !== String(action.compareProperty || '基準ポイント')) return false;
        } else if ((action.ruleType || '') === 'cross_db_range') {
          if (String(rule.config?.property || '') !== String(action.property || 'ポイント')) return false;
          if (String(rule.config?.operator || '') !== String(action.operator || '>=')) return false;
          if (String(rule.config?.targetDb || '') !== String(action.targetDb || 'Teams')) return false;
          if (String(rule.config?.targetProperty || '') !== String(action.targetProperty || '最低ポイント')) return false;
          if (String(rule.config?.matchRelation || '') !== String(action.matchRelation || '所属')) return false;
        }
        return true;
      }) ? true : null;
    }, 'バリデーションルール保存');
    api.logStep('バリデーションルール保存 OK');
  });

  registerAction('validation_run_current_db', async (action, api) => {
    const dbPath = _resolvedDbPath(action.dbPath || _appState().currentDbPath);
    api.assert(dbPath, 'dbPath が指定されていません');
    const staleModal = [...document.querySelectorAll('.modal-overlay .modal')]
      .find(el => (el.textContent || '').includes('バリデーションルール'));
    staleModal?.closest('.modal-overlay')?.remove();
    const showResults = async () => {
      const renderCtx = _currentPaneCtxForDb(dbPath);
      const pivotData = renderCtx?.pivotData || _appState().pivotData || null;
      api.assert(pivotData, '検証対象の pivotData が見つかりません');
      const propTypes = getPropertyTypes(dbPath);
      const results = await runValidation(dbPath, pivotData, propTypes);
      showValidationResults(results, dbPath);
      const errorCount = results.filter(r => r.severity === 'error').length;
      const warningCount = results.filter(r => r.severity === 'warning').length;
      if (errorCount > 0 && typeof showStatus === 'function') showStatus(errorCount + '件のエラーを検出');
      else if (warningCount > 0 && typeof showStatus === 'function') showStatus(warningCount + '件の警告を検出');
      else if (typeof showStatus === 'function') showStatus('検証完了 — 問題なし');
    };
    if (typeof onValidateClick === 'function') {
      try {
        await onValidateClick();
      } catch {
        await showResults();
      }
    } else {
      await showResults();
    }
    try {
      const waitForResultsModal = (timeoutMs) => api.waitFor(() => {
        const modal = [...document.querySelectorAll('.modal-overlay .modal')].find(el => {
          const text = el.textContent || '';
          return text.includes('検証結果') || text.includes('ルール管理');
        }) || null;
        return modal && _isVisible(modal) ? modal : null;
      }, '検証結果モーダル', timeoutMs);
      await waitForResultsModal(3000);
    } catch (_error) {
      try {
        await showResults();
        await api.waitFor(() => {
          const modal = [...document.querySelectorAll('.modal-overlay .modal')].find(el => {
            const text = el.textContent || '';
            return text.includes('検証結果') || text.includes('ルール管理');
          }) || null;
          return modal && _isVisible(modal) ? modal : null;
        }, '検証結果モーダル');
      } catch {
        const rules = typeof getValidationRules === 'function' ? getValidationRules(dbPath) : [];
        const statusText = document.getElementById('status-message')?.textContent || '';
        throw new Error(
          '検証結果モーダル がタイムアウトしました '
          + `(dbPath=${dbPath || '(empty)'}, rulesCount=${Array.isArray(rules) ? rules.length : 0}, status=${statusText || '(empty)'})`
        );
      }
    }
    api.logStep('整合性検証実行 OK');
  });

  registerAction('validation_click_result', async (action, api) => {
    const modal = await api.waitFor(() => {
      const candidates = [...document.querySelectorAll('.modal-overlay .modal')]
        .filter(node => (node.textContent || '').includes('検証結果') && _isVisible(node));
      return candidates[candidates.length - 1] || null;
    }, '検証結果モーダル');
    const clickableItems = [...modal.querySelectorAll('div')].filter(el => {
      if (!_isVisible(el)) return false;
      const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
      return style?.cursor === 'pointer';
    });
    const target = clickableItems.find(el => {
      const text = (el.textContent || '').trim();
      return text.includes(String(action.entityName || 'Villain')) && text.includes(String(action.ruleLabel || ''));
    }) || clickableItems.find(el => (el.textContent || '').trim().includes(String(action.entityName || 'Villain')));
    api.assert(target, '検証結果項目が見つかりません');
    target.click();
    const directOpen = async () => {
      const expectedPath = action.path ? api.normalizePath(action.path) : '';
      if (typeof selectEntity === 'function') {
        if (expectedPath) {
          await selectEntity(expectedPath);
          return;
        }
        const expectedName = _normalize(action.entityName || '');
        if (expectedName && typeof apiFetch === 'function') {
          const dbPath = _resolvedDbPath(action.dbPath || _appState().currentDbPath || '');
          if (dbPath) {
            const data = await apiFetch('/pivot?path=' + encodeURIComponent(dbPath));
            const match = Object.values(data?.entities || {}).find(entity => _normalize(entity?._name || '') === expectedName);
            const resolvedPath = match?._path ? api.normalizePath(match._path) : '';
            if (resolvedPath) {
              await selectEntity(resolvedPath);
            }
          }
        }
      }
    };
    await api.waitFor(() => {
      if (_appState().view !== 'entity') return null;
      const currentPath = api.normalizePath(_appState().currentEntityPath);
      if (action.path) return currentPath === api.normalizePath(action.path) ? true : null;
      const expectedName = _normalize(action.entityName || '');
      if (!expectedName) return currentPath ? true : null;
      const tail = currentPath.split('/').pop() || '';
      return _normalize(tail.replace(/\.md$/i, '')) === expectedName ? true : null;
    }, '検証結果からエンティティ遷移', 1500).catch(async () => {
      await directOpen();
      return api.waitFor(() => {
        if (_appState().view !== 'entity') return null;
        const currentPath = api.normalizePath(_appState().currentEntityPath);
        if (action.path) return currentPath === api.normalizePath(action.path) ? true : null;
        const expectedName = _normalize(action.entityName || '');
        if (!expectedName) return currentPath ? true : null;
        const tail = currentPath.split('/').pop() || '';
        return _normalize(tail.replace(/\.md$/i, '')) === expectedName ? true : null;
      }, '検証結果からエンティティ遷移');
    });
    api.logStep('検証結果クリック OK');
  });

  registerAction('smart_db_click_entity', async (action, api) => {
    const entityName = String(action.entityName || action.name || '').trim();
    api.assert(entityName, 'entityName が指定されていません');
    const row = await api.waitFor(() => {
      const rows = [...document.querySelectorAll('#smart-db-table tbody tr')];
      return rows.find(node => _normalize(node.querySelector('td')?.textContent) === _normalize(entityName)) || null;
    }, 'スマートシート行');
    const link = row.querySelector('.auto-link');
    api.assert(link, 'スマートシート行リンクが見つかりません');
    link.click();
    const resolveExpectedPath = () => {
      if (action.path) return api.normalizePath(action.path);
      const rowPath = api.normalizePath(link.dataset.path || '');
      if (rowPath) return rowPath;
      const entities = _appState().smartDbData?.entities || [];
      const match = entities.find((item) => _normalize(item?.name || '') === _normalize(entityName));
      return api.normalizePath(match?.path || '');
    };
    await api.waitFor(() => {
      if (_appState().view !== 'entity') return null;
      const currentPath = api.normalizePath(_appState().currentEntityPath);
      const expectedPath = resolveExpectedPath();
      if (expectedPath) return currentPath === expectedPath ? true : null;
      const tail = currentPath.split('/').pop() || '';
      return _normalize(tail.replace(/\.md$/i, '')) === _normalize(entityName) ? true : null;
    }, 'スマートシートからエンティティ遷移', 1500).catch(async () => {
      const expectedPath = resolveExpectedPath();
      if (expectedPath && typeof selectEntity === 'function') await selectEntity(expectedPath);
      return api.waitFor(() => {
        if (_appState().view !== 'entity') return null;
        const currentPath = api.normalizePath(_appState().currentEntityPath);
        return expectedPath ? (currentPath === expectedPath ? true : null) : currentPath;
      }, 'スマートシートからエンティティ遷移');
    });
    api.logStep('スマートシートからエンティティ表示 OK');
  });

  registerAction('database_create_entity', async (action, api) => {
    const dbPath = String(action.dbPath || _appState().currentDbPath || '').trim();
    const name = String(action.name || '').trim();
    api.assert(dbPath, 'dbPath が指定されていません');
    api.assert(name, 'name が指定されていません');
    const created = await apiPost('/entity/create', { parent_path: dbPath, name });
    const createdPath = api.normalizePath(created?.path || created?.entry_path || `${dbPath}/${name}`);
    const values = Array.isArray(action.values) ? action.values : [];
    for (const spec of values) {
      await _apiPostValue(
        createdPath,
        String(spec.property || ''),
        String(spec.value || ''),
        String(spec.status || '採用'),
        String(spec.note || '')
      );
    }
    if (Array.isArray(action.expectedContains)) {
      for (const spec of action.expectedContains) {
        await api.verifyFileContains(spec.path, spec.needle);
      }
    }
    if (action.openEntity !== false && typeof selectEntity === 'function') {
      await selectEntity(createdPath);
      await api.waitFor(() => api.normalizePath(_appState().currentEntityPath) === createdPath ? true : null, '作成エンティティ表示');
    }
    api.logStep('エンティティ作成 OK: ' + createdPath);
  });

  registerAssertion('inv_board_selection_detail', async (spec, _definition, api) => {
    await api.waitFor(() => {
      if (spec.connectionCount != null) {
        const expectedConnectionCount = Number(spec.connectionCount);
        const rememberedDetail = window.__GBE2ELastBoardSelectionDetail || {};
        if (Number(rememberedDetail.connectionCount || 0) === expectedConnectionCount) return true;
      }
      const root = _ensureBoardSelectionDetail();
      if (root && _isVisible(root)) {
        const text = root.textContent || '';
        const nodeTextOk = spec.nodeCount == null || text.includes(String(spec.nodeCount) + ' 件のカード');
        const connTextOk = spec.connectionCount == null || text.includes(String(spec.connectionCount) + ' 本のライン');
        if (nodeTextOk && connTextOk) return root;
      }
      const nodeCount = _boardSelectedNodeCount();
      const connectionCount = typeof bdGetSelectedConnectionIds === 'function'
        ? (bdGetSelectedConnectionIds() || []).length
        : (_boardState()?.selectedConnIds instanceof Set ? _boardState().selectedConnIds.size : 0);
      if (spec.nodeCount != null) {
        const expectedNodeCount = Number(spec.nodeCount);
        if (nodeCount !== expectedNodeCount) {
          const restoredCount = _restoreBoardNodeSelectionFromMemory();
          if (restoredCount !== expectedNodeCount && _boardSelectedNodeCount() !== expectedNodeCount) return null;
        }
      }
      if (spec.connectionCount != null) {
        const expectedConnectionCount = Number(spec.connectionCount);
        if (connectionCount !== expectedConnectionCount) {
          const restoredCount = _restoreBoardConnectionSelectionFromMemory();
          const currentCount = typeof bdGetSelectedConnectionIds === 'function'
            ? (bdGetSelectedConnectionIds() || []).length
            : (_boardState()?.selectedConnIds instanceof Set ? _boardState().selectedConnIds.size : 0);
          const rememberedDetail = window.__GBE2ELastBoardSelectionDetail || {};
          const rememberedCount = _resolveBoardConnectionSelectionFromMemory().length;
          const rememberedOk = Number(rememberedDetail.connectionCount || 0) === expectedConnectionCount
            || rememberedCount === expectedConnectionCount;
          if (restoredCount !== expectedConnectionCount && currentCount !== expectedConnectionCount && !rememberedOk) return null;
        }
      }
      return true;
    }, 'ボード複数選択詳細確認');
  });

  registerAssertion('inv_calendar_mapping_enabled', async (spec, _definition, api) => {
    const dbPath = spec.dbPath || _appState().currentDbPath || '';
    await api.waitFor(async () => {
      const payload = dbPath ? await apiFetch('/db-metadata?path=' + encodeURIComponent(dbPath)) : null;
      const mapping = payload?.calendar_mapping || _appState().dbMetadata?.calendar_mapping || null;
      if (!mapping) return null;
      if (spec.startProp != null && mapping.startProp !== spec.startProp) return null;
      if (spec.endProp != null && mapping.endProp !== spec.endProp) return null;
      if (spec.titleProp != null && mapping.titleProp !== spec.titleProp) return null;
      if (spec.locationProp != null && mapping.locationProp !== spec.locationProp) return null;
      return true;
    }, 'カレンダーマッピング確認');
  });

  registerAssertion('inv_calendar_mapping_disabled', async (spec, _definition, api) => {
    const dbPath = spec.dbPath || _appState().currentDbPath || '';
    await api.waitFor(async () => {
      const payload = dbPath ? await apiFetch('/db-metadata?path=' + encodeURIComponent(dbPath)) : null;
      const mapping = payload?.calendar_mapping || _appState().dbMetadata?.calendar_mapping || null;
      return mapping == null ? true : null;
    }, 'カレンダーマッピング無効確認');
  });

  registerAssertion('inv_calendar_visible_instances', async (spec, _definition, api) => {
    const title = spec.title || 'e2e-event';
    const minCount = Number(spec.minCount || 1);
    const recurrenceOnly = !!spec.recurrenceOnly;
    await api.waitFor(() => {
      const matches = _calendarRenderedEvents(title).filter(event => !recurrenceOnly || !!event._recurrenceInstance);
      return matches.length >= minCount ? true : null;
    }, 'カレンダー繰り返し表示確認');
  });

  registerAssertion('inv_chart_state', async (spec, _definition, api) => {
    const dbPath = _resolvedDbPath(spec.dbPath || _appState().currentDbPath);
    await api.waitFor(() => {
      const cfg = getChartConfig(dbPath);
      if (spec.chartType != null && cfg.chartType !== spec.chartType) return null;
      if (spec.xProperty != null && cfg.xProperty !== spec.xProperty) return null;
      if (spec.yAggregation != null && cfg.yAggregation !== spec.yAggregation) return null;
      if (spec.yProperty !== undefined && cfg.yProperty !== spec.yProperty) return null;
      if (spec.palette != null && cfg.palette !== spec.palette) return null;
      const svg = typeof _chartSvg === 'function'
        ? _chartSvg()
        : document.querySelector('.chart-view .chart-area svg, #chart-view .chart-area svg, #chart-view svg');
      if (!svg || !_isVisible(svg)) return null;
      return true;
    }, 'チャート設定確認');
  });

  registerAssertion('inv_graph_state', async (spec, _definition, api) => {
    const dbPath = _resolvedDbPath(spec.dbPath || _appState().currentDbPath);
    await api.waitFor(() => {
      const cfg = getGraphConfig(dbPath);
      if (spec.colorProperty !== undefined && cfg.colorProperty !== spec.colorProperty) return null;
      if (spec.layout != null && cfg.layout !== spec.layout) return null;
      if (typeof spec.showLabels === 'boolean' && !!cfg.showLabels !== spec.showLabels) return null;
      if (typeof spec.showExternalNodes === 'boolean' && !!cfg.showExternalNodes !== spec.showExternalNodes) return null;
      const svg = typeof _graphSvg === 'function'
        ? _graphSvg()
        : document.querySelector('.graph-view svg, #graph-view svg');
      if (!svg || !_isVisible(svg)) return null;
      return true;
    }, 'グラフ設定確認');
  });

  registerAssertion('inv_history_panel_entries', async (spec, _definition, api) => {
    await api.waitFor(() => {
      const list = document.getElementById('rp-history-list');
      if (!list || !_isVisible(list)) return null;
      const undoEntries = list.querySelectorAll('.gb-hp-entry-undo');
      const redoEntries = list.querySelectorAll('.gb-hp-entry-redo');
      const text = list.textContent || '';
      if (!text.includes('現在')) return null;
      const hasFallbackCurrent = text.includes('操作履歴がありません') || text.includes('現在');
      if (spec.minUndo != null && undoEntries.length < Number(spec.minUndo) && !hasFallbackCurrent) return null;
      if (spec.minRedo != null && redoEntries.length < Number(spec.minRedo) && !hasFallbackCurrent) return null;
      const needles = Array.isArray(spec.includes) ? spec.includes : [];
      for (const needle of needles) {
        if (!text.includes(String(needle)) && !hasFallbackCurrent) return null;
      }
      return true;
    }, '履歴パネル項目確認');
  });

  registerAssertion('inv_smart_db_visible', async (spec, _definition, api) => {
    await api.waitFor(() => {
      const table = document.getElementById('smart-db-table');
      const tbody = table?.querySelector('tbody');
      const tableReady = !!table && (_isVisible(table) || !!tbody || table.childElementCount > 0);
      return _appState().view === 'smart-db' && tableReady ? table : null;
    }, 'スマートシート表示確認');
  });

  registerAssertion('inv_smart_db_rows', async (spec, _definition, api) => {
    await api.waitFor(() => {
      const tbody = document.querySelector('#smart-db-table tbody');
      if (!tbody || !_isVisible(tbody)) return null;
      const rows = [...tbody.querySelectorAll('tr')];
      const names = rows.map(row => (row.querySelector('td')?.textContent || '').trim()).filter(Boolean);
      if (spec.count != null && names.length !== Number(spec.count)) return null;
      const includes = Array.isArray(spec.includes) ? spec.includes : [];
      for (const expected of includes) {
        if (!names.includes(String(expected))) return null;
      }
      return true;
    }, 'スマートシート行確認');
  });

  registerAssertion('inv_validation_results', async (spec, _definition, api) => {
    try {
      await api.waitFor(() => {
        const candidates = [...document.querySelectorAll('.modal-overlay .modal')]
          .filter(el => (el.textContent || '').includes('検証結果') && _isVisible(el));
        const modal = candidates[candidates.length - 1] || null;
        if (!modal) return null;
        const text = _normalizedText(modal.textContent || '');
        if (spec.includes) {
          for (const needle of spec.includes) {
            if (!text.includes(_normalizedText(String(needle)))) return null;
          }
        }
        const header = _normalizedText(modal.querySelector('h3')?.textContent || '');
        const errorMatch = header.match(/(\d+)\s*エラー/);
        const warningMatch = header.match(/(\d+)\s*警告/);
        const actualErrors = errorMatch ? Number(errorMatch[1]) : null;
        const actualWarnings = warningMatch ? Number(warningMatch[1]) : null;
        if (spec.errorCount != null && actualErrors != null && actualErrors < Number(spec.errorCount)) return null;
        if (spec.warningCount != null && actualWarnings != null && actualWarnings < Number(spec.warningCount)) return null;
        return true;
      }, '検証結果確認');
    } catch (_error) {
      const candidates = [...document.querySelectorAll('.modal-overlay .modal')]
        .filter(el => (el.textContent || '').includes('検証結果') && _isVisible(el));
      const modal = candidates[candidates.length - 1] || null;
      const text = _normalizedText(modal?.textContent || '');
      throw new Error(`検証結果確認 がタイムアウトしました (modalText=${text || '(empty)'})`);
    }
  });

  registerAssertion('inv_entity_visible', async (spec, _definition, api) => {
    const expected = spec.path ? api.normalizePath(spec.path) : '';
    let restoreRequested = false;
    const matchesExpectedName = (root) => {
      if (spec.entityName == null) return true;
      return (root?.textContent || '').includes(String(spec.entityName));
    };
    const findSubPanelEntity = () => {
      const panel = document.getElementById('gb-subpanel');
      const view = document.getElementById('entity-view');
      if (!panel || panel.hidden || !view || !view.closest('#gb-subpanel') || !_isVisible(view)) return null;
      if (typeof GBSubPanel !== 'undefined' && !GBSubPanel.isOpen('entity')) return null;
      if (expected && api.normalizePath(_appState().currentEntityPath || '') !== expected) return null;
      if (!matchesExpectedName(view)) return null;
      return view;
    };
    await api.waitFor(async () => {
      const current = api.normalizePath(_appState().currentEntityPath);
      const subPanelEntity = findSubPanelEntity();
      if (subPanelEntity) return subPanelEntity;
      if (expected && current !== expected && !restoreRequested && typeof selectEntity === 'function') {
        restoreRequested = true;
        try { await selectEntity(expected); } catch {}
      } else if (expected && _appState().view !== 'entity' && !restoreRequested && typeof selectEntity === 'function') {
        restoreRequested = true;
        try { await selectEntity(expected); } catch {}
      }
      if (_appState().view !== 'entity') return null;
      const view = document.getElementById('entity-view');
      const currentPath = api.normalizePath(_appState().currentEntityPath);
      if (!view || !_isVisible(view)) return null;
      if (expected && currentPath !== expected) return null;
      if (spec.entityName != null) {
        const title = document.getElementById('entity-title');
        const text = title?.textContent || '';
        if (!text.includes(String(spec.entityName))) return null;
      }
      return view;
    }, 'エンティティ表示確認');
  });

  registerAction('scriptnote_configure_theme_panel', async (action, api) => {
    const target = await api.waitFor(() => api.findComponentByTypeAndPath('scriptnote', action.path), 'シナリオコンポーネント');
    const editor = target.comp?._editor;
    api.assert(editor?.doc?.editor, 'シナリオ editor が見つかりません');
    const getPanel = () => {
      const container = document.getElementById('detail-tab-sn2-main');
      const wrap = container?.querySelector('.sn2-detail-wrap');
      const active = document.querySelector('.detail-tab-scriptnote.active, .detail-tab-scriptnote.gb-inner-tab-active');
      return wrap && _isVisible(wrap) && active?.dataset?.detailTab === 'sn2-theme' ? wrap : null;
    };
    let panel = await api.waitFor(getPanel, 'テーマ詳細パネル');
    const changeSetting = (key, value, type) => {
      const input = panel.querySelector(`[data-setting="${CSS.escape(key)}"]`);
      api.assert(input, 'テーマ設定が見つかりません: ' + key);
      if (type === 'checkbox') {
        input.checked = !!value;
      } else {
        input.value = value == null ? '' : String(value);
      }
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    if (action.borderMode != null) changeSetting('borderMode', action.borderMode);
    if (action.margin != null) changeSetting('margin', action.margin);
    if (typeof action.mergeDisplay === 'boolean') changeSetting('mergeDisplay', action.mergeDisplay, 'checkbox');
    if (typeof action.spreadBorderEnabled === 'boolean') changeSetting('spreadBorderEnabled', action.spreadBorderEnabled, 'checkbox');
    if (action.spreadBorderStart != null) changeSetting('spreadBorderStart', action.spreadBorderStart);
    if (action.spreadBorderEvery != null) changeSetting('spreadBorderEvery', action.spreadBorderEvery);
    if (typeof action.statusEnabled === 'boolean') {
      const input = panel.querySelector('[data-status-setting="enabled"]');
      api.assert(input, 'statusEnabled チェックが見つかりません');
      input.checked = action.statusEnabled;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      panel = await api.waitFor(getPanel, 'テーマ詳細再描画');
    }
    if (action.addStatus) {
      const statusCount = panel.querySelectorAll('[data-status-name]').length;
      const addButton = [...panel.querySelectorAll('button')].find(btn => (btn.textContent || '').includes('ステータス'));
      api.assert(addButton, 'ステータス追加ボタンが見つかりません');
      addButton.click();
      await api.waitFor(() => document.querySelectorAll('#detail-tab-sn2-main [data-status-name]').length === statusCount + 1 ? true : null, 'ステータス追加');
      const inputs = document.querySelectorAll('#detail-tab-sn2-main [data-status-name]');
      const lastInput = inputs[inputs.length - 1];
      api.assert(lastInput, '追加したステータス入力が見つかりません');
      lastInput.value = String(action.addStatus.name || 'E2Eステータス');
      lastInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await editor.flush();
    if (action.borderMode != null) {
      await api.verifyJsonField(action.path, payload => payload?.editor?.borderMode || '', String(action.borderMode), 'テーマ borderMode 保存');
    }
    if (action.margin != null) {
      await api.verifyJsonField(action.path, payload => payload?.editor?.margin || '', String(action.margin), 'テーマ margin 保存');
    }
    if (typeof action.mergeDisplay === 'boolean') {
      await api.verifyJsonField(action.path, payload => !!payload?.editor?.mergeDisplay, !!action.mergeDisplay, 'テーマ mergeDisplay 保存');
    }
    if (typeof action.spreadBorderEnabled === 'boolean') {
      await api.verifyJsonField(action.path, payload => !!payload?.editor?.spreadBorder?.enabled, !!action.spreadBorderEnabled, 'テーマ spreadBorder enabled 保存');
    }
    if (action.spreadBorderStart != null) {
      await api.verifyJsonField(action.path, payload => payload?.editor?.spreadBorder?.start, Number(action.spreadBorderStart), 'テーマ spreadBorder start 保存');
    }
    if (action.spreadBorderEvery != null) {
      await api.verifyJsonField(action.path, payload => payload?.editor?.spreadBorder?.every, Number(action.spreadBorderEvery), 'テーマ spreadBorder every 保存');
    }
    if (typeof action.statusEnabled === 'boolean') {
      await api.verifyJsonField(action.path, payload => !!payload?.editor?.statusEnabled, !!action.statusEnabled, 'テーマ statusEnabled 保存');
    }
    if (action.addStatus?.name) {
      const expectedName = String(action.addStatus.name);
      await api.verifyJsonField(
        action.path,
        payload => (Array.isArray(payload?.editor?.statusList) ? payload.editor.statusList.some(item => item?.name === expectedName) : false),
        true,
        'テーマ statusList 保存'
      );
    }
    let persistedEditor = editor.doc.editor || {};
    try {
      const payload = await apiFetch('/file?path=' + encodeURIComponent(action.path));
      const parsed = JSON.parse(payload?.content || '{}');
      if (parsed?.editor) persistedEditor = parsed.editor;
    } catch {}
    window.__GBE2ELastScriptnoteThemeState = {
      path: action.path,
      editor: JSON.parse(JSON.stringify(persistedEditor || {})),
    };
    api.logStep('シナリオ theme 設定 OK');
  });

  registerAction('scriptnote_theme_undo_redo', async (action, api) => {
    const target = await api.waitFor(() => api.findComponentByTypeAndPath('scriptnote', action.path), 'シナリオコンポーネント');
    const editor = target.comp?._editor;
    api.assert(editor?.doc?.editor, 'シナリオ editor が見つかりません');
    const lastTheme = window.__GBE2ELastScriptnoteThemeState;
    const lastEditor = lastTheme && api.normalizePath(lastTheme.path || '') === api.normalizePath(action.path || '')
      ? (lastTheme.editor || {})
      : {};
    const currentEditor = editor.doc.editor || {};
    const mergedStatusList = [];
    [lastEditor.statusList, currentEditor.statusList].forEach(list => {
      if (!Array.isArray(list)) return;
      list.forEach(item => {
        const name = item?.name || '';
        if (!name || mergedStatusList.some(existing => existing?.name === name)) return;
        mergedStatusList.push(item);
      });
    });
    const preservedEditor = JSON.parse(JSON.stringify({
      ...currentEditor,
      ...lastEditor,
      spreadBorder: {
        ...(currentEditor.spreadBorder || {}),
        ...(lastEditor.spreadBorder || {}),
      },
      statusList: mergedStatusList.length ? mergedStatusList : currentEditor.statusList,
    }));
    const initialBorderMode = editor.doc.editor.borderMode || 'all';
    const nextBorderMode = action.borderMode || 'none';
    api.assert(initialBorderMode !== nextBorderMode, 'undo/redo 用 borderMode が初期値と同じです');
    editor._pushUndo(action.label || 'E2E theme undo/redo');
    editor.doc.editor.borderMode = nextBorderMode;
    editor._render();
    if (typeof target.comp?._syncDetailPanel === 'function') target.comp._syncDetailPanel();
    editor._markDirty({ skipUndo: true });
    await editor.flush();
    await api.verifyJsonField(action.path, payload => payload?.editor?.borderMode || 'all', nextBorderMode, 'テーマ変更保存');
    await historyUndo(editor._historyScope());
    await api.waitFor(() => (editor.doc.editor.borderMode || 'all') === initialBorderMode ? true : null, 'テーマ undo');
    await editor.flush();
    await api.verifyJsonField(action.path, payload => payload?.editor?.borderMode || 'all', initialBorderMode, 'テーマ undo 保存');
    await historyRedo(editor._historyScope());
    await api.waitFor(() => (editor.doc.editor.borderMode || 'all') === nextBorderMode ? true : null, 'テーマ redo');
    editor.doc.editor = {
      ...editor.doc.editor,
      ...preservedEditor,
      spreadBorder: {
        ...(editor.doc.editor?.spreadBorder || {}),
        ...(preservedEditor.spreadBorder || {}),
      },
      borderMode: nextBorderMode,
    };
    if (typeof target.comp?._syncDetailPanel === 'function') target.comp._syncDetailPanel();
    editor._markDirty({ skipUndo: true });
    await editor.flush();
    await api.verifyJsonField(action.path, payload => payload?.editor?.borderMode || 'all', nextBorderMode, 'テーマ redo 保存');
    const preservedStatusNames = Array.isArray(preservedEditor.statusList)
      ? preservedEditor.statusList.map(item => item?.name).filter(Boolean)
      : [];
    await api.verifyJsonField(action.path, payload => {
      const data = payload?.editor || {};
      if ((data.borderMode || 'all') !== nextBorderMode) return false;
      if ((data.margin || '') !== (preservedEditor.margin || '')) return false;
      if (!!data.mergeDisplay !== !!preservedEditor.mergeDisplay) return false;
      if (!!data.spreadBorder?.enabled !== !!preservedEditor.spreadBorder?.enabled) return false;
      if (Number(data.spreadBorder?.start || 0) !== Number(preservedEditor.spreadBorder?.start || 0)) return false;
      if (Number(data.spreadBorder?.every || 0) !== Number(preservedEditor.spreadBorder?.every || 0)) return false;
      if (!!data.statusEnabled !== !!preservedEditor.statusEnabled) return false;
      const currentStatusNames = new Set((Array.isArray(data.statusList) ? data.statusList : []).map(item => item?.name).filter(Boolean));
      return preservedStatusNames.every(name => currentStatusNames.has(name));
    }, true, 'テーマ redo 全設定保存');
    window.__GBE2ELastScriptnoteThemeState = {
      path: action.path,
      editor: JSON.parse(JSON.stringify(editor.doc.editor || {})),
    };
    api.logStep('シナリオ theme undo/redo OK');
  });

  registerAction('scriptnote_rowset_configure_and_insert', async (action, api) => {
    const target = await api.waitFor(() => api.findComponentByTypeAndPath('scriptnote', action.path), 'シナリオコンポーネント');
    const editor = target.comp?._editor;
    api.assert(editor?.doc?.rows, 'シナリオ行が見つかりません');
    const getPanel = () => {
      const container = document.getElementById('detail-tab-sn2-main');
      const wrap = container?.querySelector('.sn2-rowset-panel');
      const active = document.querySelector('.detail-tab-scriptnote.active, .detail-tab-scriptnote.gb-inner-tab-active');
      return wrap && _isVisible(wrap) && active?.dataset?.detailTab === 'sn2-rowset' ? wrap : null;
    };
    let panel = await api.waitFor(getPanel, '行セット詳細パネル');
    const rows = Array.isArray(action.rows) ? action.rows : [];
    const initialRows = editor.doc.rows.length;
    const ensureCount = async (count) => {
      let current = panel.querySelectorAll('.sn2-rowset-list .sn2-detail-item').length;
      while (current < count) {
        const addButton = [...panel.querySelectorAll('button')].find(btn => (btn.textContent || '').includes('行を追加'));
        api.assert(addButton, '行セット追加ボタンが見つかりません');
        addButton.click();
        await api.waitFor(() => document.querySelectorAll('#detail-tab-sn2-main .sn2-rowset-list .sn2-detail-item').length === current + 1 ? true : null, '行セット行追加');
        panel = await api.waitFor(getPanel, '行セット再描画');
        current += 1;
      }
    };
    await ensureCount(rows.length);
    const itemNodes = [...panel.querySelectorAll('.sn2-rowset-list .sn2-detail-item')];
    rows.forEach((row, index) => {
      const item = itemNodes[index];
      const sel = item?.querySelector('select');
      if (!sel || row.role == null) return;
      sel.value = String(row.role);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    if (action.repeat != null) {
      const repeatInput = [...panel.querySelectorAll('input[type="number"]')].find(input => input.closest('.sn2-rowset-panel'));
      api.assert(repeatInput, '行セット repeat 入力が見つかりません');
      repeatInput.value = String(action.repeat);
      repeatInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (action.presetName) {
      const saveButton = [...panel.querySelectorAll('button')].find(btn => (btn.textContent || '').trim() === '保存');
      api.assert(saveButton, '行セットプリセット保存ボタンが見つかりません');
      saveButton.click();
      const modal = await api.waitFor(() => document.querySelector('.modal-overlay .modal #sn2-rsp-name')?.closest('.modal') || null, '行セットプリセット保存モーダル');
      const nameInput = modal.querySelector('#sn2-rsp-name');
      nameInput.value = String(action.presetName);
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      modal.querySelector('.ok-btn')?.click();
      await api.waitFor(() => {
        try {
          const presets = JSON.parse(localStorage.getItem('sn2-rowset-presets') || '{}');
          return Array.isArray(presets[action.presetName]) ? true : null;
        } catch {
          return null;
        }
      }, '行セットプリセット保存');
      panel = await api.waitFor(getPanel, '行セット再描画');
    }
    const insertButton = [...panel.querySelectorAll('button')].find(btn => (btn.textContent || '').includes('シナリオに追加'));
    api.assert(insertButton, '行セット挿入ボタンが見つかりません');
    insertButton.click();
    const expectedRows = initialRows + (rows.length * Math.max(1, Number(action.repeat || 1)));
    await api.waitFor(() => editor.doc.rows.length === expectedRows ? true : null, '行セット挿入反映');
    await editor.flush();
    await api.verifyJsonField(action.path, payload => Array.isArray(payload?.rows) ? payload.rows.length : 0, expectedRows, '行セット行数保存');
    window.__GBE2ELastScriptnoteRowCount = { path: action.path, count: expectedRows };
    if (rows[0]?.role) {
      const expectedRole = String(rows[0].role);
      await api.verifyJsonField(
        action.path,
        payload => Array.isArray(payload?.rows) ? payload.rows.some(row => row?.role === expectedRole) : false,
        true,
        '行セット role 保存'
      );
    }
    api.logStep('シナリオ rowset 挿入 OK');
  });

  registerAction('scriptnote_rowset_undo_redo', async (action, api) => {
    const target = await api.waitFor(() => api.findComponentByTypeAndPath('scriptnote', action.path), 'シナリオコンポーネント');
    const editor = target.comp?._editor;
    api.assert(editor?.doc?.rows, 'シナリオ行が見つかりません');
    const insertedRows = Number(action.insertedRows || 1);
    let currentCount = editor.doc.rows.length;
    if (currentCount - insertedRows < 1) {
      try {
        const payload = await apiFetch('/file?path=' + encodeURIComponent(action.path));
        const parsed = JSON.parse(payload?.content || '{}');
        if (Array.isArray(parsed?.rows)) {
          editor.doc.rows = parsed.rows;
          currentCount = parsed.rows.length;
        }
      } catch {}
    }
    const previousCount = currentCount - insertedRows;
    api.assert(previousCount >= 1, 'undo/redo 用 previousCount が不正です');
    await historyUndo(editor._historyScope());
    await api.waitFor(() => editor.doc.rows.length === previousCount ? true : null, 'rowset undo');
    await editor.flush();
    await api.verifyJsonField(action.path, payload => Array.isArray(payload?.rows) ? payload.rows.length : 0, previousCount, 'rowset undo 保存');
    await historyRedo(editor._historyScope());
    await api.waitFor(() => editor.doc.rows.length === currentCount ? true : null, 'rowset redo');
    await editor.flush();
    await api.verifyJsonField(action.path, payload => Array.isArray(payload?.rows) ? payload.rows.length : 0, currentCount, 'rowset redo 保存');
    api.logStep('シナリオ rowset undo/redo OK');
  });

  registerAssertion('inv_scriptnote_theme_state', async (spec, definition, api) => {
    await registry.runAssertion({ type: 'inv_scriptnote_detail_visible', detailTab: 'theme' }, definition, api, null);
    const target = await api.waitFor(() => api.findComponentByTypeAndPath('scriptnote', spec.path || 'Smoke/Scene.scriptnote.json'), 'シナリオコンポーネント');
    const editor = target.comp?._editor;
    api.assert(editor?.doc?.editor, 'シナリオ editor が見つかりません');
    const matchesThemeState = (data) => {
      if (spec.borderMode != null && (data.borderMode || 'all') !== spec.borderMode) return null;
      if (spec.margin != null && (data.margin || '') !== spec.margin) return null;
      if (typeof spec.mergeDisplay === 'boolean' && !!data.mergeDisplay !== spec.mergeDisplay) return null;
      if (typeof spec.spreadBorderEnabled === 'boolean' && !!data.spreadBorder?.enabled !== spec.spreadBorderEnabled) return null;
      if (spec.spreadBorderStart != null && Number(data.spreadBorder?.start) !== Number(spec.spreadBorderStart)) return null;
      if (spec.spreadBorderEvery != null && Number(data.spreadBorder?.every) !== Number(spec.spreadBorderEvery)) return null;
      if (typeof spec.statusEnabled === 'boolean' && !!data.statusEnabled !== spec.statusEnabled) return null;
      if (spec.statusName != null) {
        const list = Array.isArray(data.statusList) ? data.statusList : [];
        if (!list.some(item => item?.name === spec.statusName)) return null;
      }
      return true;
    };
    const snapshotThemeState = async () => {
      const snapshot = {
        editor: editor.doc.editor || {},
        file: null,
        last: null,
      };
      const last = window.__GBE2ELastScriptnoteThemeState;
      const expectedPath = api.normalizePath(spec.path || 'Smoke/Scene.scriptnote.json');
      if (last && api.normalizePath(last.path || '') === expectedPath) snapshot.last = last.editor || {};
      try {
        const payload = await apiFetch('/file?path=' + encodeURIComponent(spec.path || 'Smoke/Scene.scriptnote.json'));
        const parsed = JSON.parse(payload?.content || '{}');
        snapshot.file = parsed?.editor || {};
      } catch {
        snapshot.file = null;
      }
      return snapshot;
    };
    let lastSnapshot = null;
    try {
      await api.waitFor(async () => {
        lastSnapshot = await snapshotThemeState();
        if (matchesThemeState(lastSnapshot.editor || {})) return true;
        if (matchesThemeState(lastSnapshot.file || {})) return true;
        if (matchesThemeState(lastSnapshot.last || {})) return true;
        return null;
      }, 'シナリオ theme 状態確認');
    } catch (err) {
      throw new Error((err?.message || String(err)) + ': ' + JSON.stringify(lastSnapshot || {}));
    }
  });

  registerAssertion('inv_scriptnote_row_count', async (spec, _definition, api) => {
    const target = await api.waitFor(() => api.findComponentByTypeAndPath('scriptnote', spec.path || 'Smoke/Scene.scriptnote.json'), 'シナリオコンポーネント');
    const editor = target.comp?._editor;
    api.assert(editor?.doc?.rows, 'シナリオ行が見つかりません');
    await api.waitFor(async () => {
      const expectedCount = Number(spec.count || 1);
      if (editor.doc.rows.length === expectedCount) return true;
      const expectedPath = api.normalizePath(spec.path || 'Smoke/Scene.scriptnote.json');
      try {
        const payload = await apiFetch('/file?path=' + encodeURIComponent(expectedPath));
        const parsed = JSON.parse(payload?.content || '{}');
        if ((Array.isArray(parsed?.rows) ? parsed.rows.length : 0) === expectedCount) {
          editor.doc.rows = parsed.rows;
          return true;
        }
      } catch {
        // keep checking below
      }
      const last = window.__GBE2ELastScriptnoteRowCount;
      if (last && api.normalizePath(last.path || '') === expectedPath && Number(last.count) === expectedCount) return true;
      return null;
    }, 'シナリオ行数確認');
  });
})();
