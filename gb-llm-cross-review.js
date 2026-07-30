(function() {
  'use strict';

  const UTILITY_TAB_TYPES = new Set([
    'outliner',
    'detail',
    'preview',
    'chat',
    'calendar',
    'timer',
    'history',
    'annotation',
    'sticky',
    'search',
    'version',
  ]);
  const STATE_LABELS = {
    pending: '未判断',
    accepted: '採用',
    deferred: '保留',
    rejected: '却下',
  };

  let _activeController = null;

  function _api(path, opts) {
    if (typeof apiFetch === 'function') return apiFetch(path, opts);
    const base = typeof API_BASE === 'string' ? API_BASE : '/api';
    return fetch(base + path, opts).then(async res => {
      if (!res.ok) throw new Error(await res.text() || res.statusText);
      return res.json();
    });
  }

  async function _apiStream(path, opts, onEvent) {
    const base = typeof API_BASE === 'string' ? API_BASE : '/api';
    const response = await fetch(base + path, opts);
    if (!response.ok) {
      let detail = '';
      try {
        const payload = await response.clone().json();
        detail = payload?.detail || payload?.error || '';
      } catch {
        try { detail = await response.text(); } catch {}
      }
      throw new Error(detail || ('HTTP ' + response.status));
    }
    const reader = response.body?.getReader?.();
    if (!reader) throw new Error('レビューの進行状況を受信できませんでした');
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const event = JSON.parse(line.slice(6));
        if (typeof onEvent === 'function') onEvent(event);
      }
    }
  }

  function _el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function _tabReviewPath(tab) {
    const direct = String(tab?.path || '').trim();
    if (direct) return direct;
    const st = tab?.state || {};
    for (const key of ['path', 'pagePath', 'dbPath', 'smartDbPath', 'boardPath', 'entityPath', 'mediaPath']) {
      const value = String(st[key] || '').trim();
      if (value) return value;
    }
    return '';
  }

  function _targetFromTab(pane, tab) {
    const path = _tabReviewPath(tab);
    if (!path || UTILITY_TAB_TYPES.has(tab?.type)) return null;
    const activeFeature = _reviewFeatureForTarget(tab?.type, path);
    return {
      path,
      label: String(tab?.label || path || ''),
      type: activeFeature,
      rawType: String(tab?.type || ''),
      paneId: String(pane?.id || ''),
    };
  }

  function _reviewFeatureForTarget(type, path) {
    const raw = String(type || '').trim().toLowerCase();
    const lowerPath = String(path || '').trim().toLowerCase();
    if (['note', 'page', 'editor', 'markdown'].includes(raw)) return 'note';
    if (['sheet', 'database', 'db', 'pivot', 'tree', 'gallery', 'kanban', 'timeline', 'table', 'form'].includes(raw)) return 'sheet';
    if (['smart-sheet', 'smart-db', 'smartdb'].includes(raw)) return 'smart-sheet';
    if (['board', 'canvas'].includes(raw)) return 'board';
    if (['scriptnote', 'scenario'].includes(raw)) return 'scriptnote';
    if (lowerPath.endsWith('.mel-scenario') || lowerPath.endsWith('.scriptnote.json')) return 'scriptnote';
    if (lowerPath.endsWith('.mel-sheet') || lowerPath.endsWith('.smart-db.json')) return 'smart-sheet';
    if (lowerPath.endsWith('.mel-board') || lowerPath.endsWith('.board.md')) return 'board';
    if (lowerPath.endsWith('.md') || lowerPath.endsWith('.txt') || lowerPath.endsWith('.html')) return 'note';
    return raw || 'unknown';
  }

  function _activeContentTargets() {
    if (typeof GBLayout === 'undefined' || !GBLayout.root || typeof GBLayout.getAllPanes !== 'function') return null;
    const panes = GBLayout.getAllPanes(GBLayout.root, { activeOnly: true }) || [];
    const activePane = panes.find(pane => pane.id === GBLayout.activePane) || null;
    const ordered = [...(activePane ? [activePane] : []), ...panes.filter(pane => pane !== activePane)];
    const targets = [];
    const seen = new Set();
    for (const pane of ordered) {
      const tab = pane?.tabs?.[pane.activeTabIndex];
      const target = _targetFromTab(pane, tab);
      if (!target) continue;
      const key = `${target.type}\n${target.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push(target);
    }
    return targets;
  }

  function _normalizeTargetInfo(raw) {
    const path = String(raw?.path || '');
    const rawType = String(raw?.rawType || raw?.type || raw?.active_feature || '');
    return {
      path,
      label: String(raw?.label || raw?.path || ''),
      type: _reviewFeatureForTarget(rawType, path),
      rawType,
      paneId: String(raw?.paneId || raw?.pane_id || ''),
    };
  }

  function _targetInfo() {
    const content = (_activeContentTargets() || [])[0];
    if (content) return content;
    const appState = typeof state !== 'undefined' ? state : {};
    const fallbackPath = appState.currentPagePath || appState.currentDbPath || appState.currentBoardPath || appState.currentEntityPath || '';
    return {
      path: String(fallbackPath || ''),
      label: String(fallbackPath || '').split(/[\\/]/).pop() || '',
      type: '',
    };
  }

  function _targetCandidates(explicitTarget) {
    const list = [];
    const seen = new Set();
    const add = raw => {
      const target = _normalizeTargetInfo(raw);
      if (!target.path) return;
      const key = `${target.type}\n${target.path}`;
      if (seen.has(key)) return;
      seen.add(key);
      list.push(target);
    };
    if (explicitTarget) add(explicitTarget);
    (_activeContentTargets() || []).forEach(add);
    if (!list.length) add(_targetInfo());
    return list;
  }

  function _targetOptionLabel(target) {
    const label = String(target?.label || '').trim() || String(target?.path || '').split(/[\\/]/).pop() || '未選択';
    const path = String(target?.path || '').trim();
    const type = String(target?.type || '').trim();
    const rawType = String(target?.rawType || '').trim();
    const suffix = [rawType && rawType !== type ? `${rawType} -> ${type}` : type, path].filter(Boolean).join(' / ');
    return suffix ? `${label} (${suffix})` : label;
  }

  function _fillTargetSelect(select, candidates, selectedTarget) {
    select.textContent = '';
    if (!candidates.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '対象ファイルがありません';
      select.appendChild(option);
      select.disabled = true;
      return;
    }
    select.disabled = false;
    candidates.forEach((target, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = _targetOptionLabel(target);
      select.appendChild(option);
    });
    const selectedIndex = candidates.findIndex(item => item.path === selectedTarget?.path && item.type === selectedTarget?.type);
    select.value = String(selectedIndex >= 0 ? selectedIndex : 0);
  }

  function _sourceFolderValue() {
    if (typeof _chatSourceFolderValue === 'function') return String(_chatSourceFolderValue() || '');
    return String((typeof state !== 'undefined' ? state.vaultPath : '') || '');
  }

  function _workFolderValue(targetPath) {
    const work = typeof getWorkFolder === 'function' ? String(getWorkFolder() || '') : '';
    if (work) return work;
    return String(targetPath || '').replace(/[\\/][^\\/]*$/, '');
  }

  function _button(label, className) {
    const btn = _el('button', className || 'gb-btn gb-btn-xs', label);
    btn.type = 'button';
    return btn;
  }

  function _shortProgressText(value, maxLength = 260) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 1) + '…';
  }

  function _appendProgress(log, message, kind = '') {
    if (!log || !message) return;
    const row = _el('div', 'llm-review-progress-row', message);
    if (kind) row.dataset.kind = kind;
    log.appendChild(row);
    while (log.children.length > 120) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  function _progressTextFromEvent(event) {
    if (!event || typeof event !== 'object') return '';
    if (event.type === 'created') return `レビューランを作成しました: ${event.run_id || ''}`;
    if (event.type === 'run_start') return `レビューを開始しました（レビュアー ${event.reviewer_count || 0} 件）`;
    if (event.type === 'reviewer_start') return `[${event.reviewer_index}/${event.reviewer_count}] ${event.reviewer_name || event.reviewer_id || 'レビュアー'} を実行中 (${event.provider || 'provider未設定'})`;
    if (event.type === 'reviewer_done') return `[${event.reviewer_index}/${event.reviewer_count}] ${event.reviewer_name || event.reviewer_id || 'レビュアー'} 完了: 指摘 ${event.issue_count || 0} 件`;
    if (event.type === 'merge_start') return '各レビュアーの結果を統合中...';
    if (event.type === 'run_done') {
      const summary = event.summary || {};
      return `レビュー完了: 高 ${summary.high || 0} / 中 ${summary.medium || 0} / 低 ${summary.low || 0}`;
    }
    if (event.type === 'result') return 'レビュー結果を受信しました';
    if (event.type === 'error') return event.error || 'レビューでエラーが発生しました';
    if (event.type === 'provider_event') {
      const providerEvent = event.event || {};
      if (providerEvent.type === 'cli_status') return providerEvent.message || 'CLIを実行中...';
      if (providerEvent.type === 'text_delta') return 'モデル出力: ' + _shortProgressText(providerEvent.content);
      if (providerEvent.type === 'cli_stderr') return 'CLIログ: ' + _shortProgressText(providerEvent.content);
      if (providerEvent.type === 'error') return providerEvent.error || 'CLI実行でエラーが発生しました';
    }
    return '';
  }

  async function _runReviewStream(payload, signal, onEvent) {
    let resultRun = null;
    let streamError = null;
    await _apiStream('/llm-review/run-stream', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, event => {
      if (typeof onEvent === 'function') onEvent(event);
      if (event.type === 'result') resultRun = event.run || null;
      if (event.type === 'error') streamError = new Error(event.error || 'レビューに失敗しました');
    });
    if (streamError) throw streamError;
    if (!resultRun) throw new Error('レビュー結果を受信できませんでした');
    return resultRun;
  }

  function _restoreFocus(el) {
    if (!el || typeof el.focus !== 'function' || !el.isConnected) return;
    try { el.focus({ preventScroll: true }); } catch { el.focus(); }
  }

  function _focusInitialDialogControl(modal) {
    if (!modal?.isConnected) return;
    const focusTarget = modal.querySelector('select:not([disabled]), textarea:not([disabled]), input:not([disabled]), button:not([disabled])') || modal;
    if (typeof focusTarget.focus !== 'function') return;
    try { focusTarget.focus({ preventScroll: true }); } catch { focusTarget.focus(); }
  }

  function _close(overlay, options = {}) {
    if (_activeController) {
      try { _activeController.abort(); } catch {}
      _activeController = null;
    }
    const cleanup = overlay?.__llmReviewCleanup;
    if (typeof cleanup === 'function') cleanup();
    const returnFocus = overlay?.__llmReviewReturnFocus || null;
    overlay?.remove();
    if (options.restoreFocus !== false) setTimeout(() => _restoreFocus(returnFocus), 0);
  }

  function _buildOverlay(options = {}) {
    const overlay = _el('div', 'modal-overlay');
    overlay.dataset.llmReviewDialog = '1';
    overlay.dataset.e2eId = 'llm-review-overlay';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '11000';
    overlay.__llmReviewReturnFocus = options.returnFocus || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const modal = _el('div', 'llm-review-modal modal');
    modal.dataset.e2eId = 'llm-review-dialog';
    modal.tabIndex = -1;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'llm-review-dialog-title');
    modal.setAttribute('aria-describedby', 'llm-review-dialog-status');
    const header = _el('div', 'llm-review-header');
    const title = _el('div', 'llm-review-title', 'LLMレビュー');
    title.id = 'llm-review-dialog-title';
    header.appendChild(title);
    const closeBtn = _button('', 'gb-btn gb-btn-xs gb-btn-icon llm-review-close');
    closeBtn.dataset.e2eId = 'llm-review-close';
    closeBtn.setAttribute('aria-label', 'LLMレビューを閉じる');
    closeBtn.title = '閉じる';
    if (typeof lucide === 'function') closeBtn.insertAdjacentHTML('beforeend', lucide('x', 14));
    else closeBtn.textContent = 'x';
    closeBtn.addEventListener('click', () => _close(overlay));
    header.appendChild(closeBtn);
    const body = _el('div', 'llm-review-body');
    body.dataset.e2eId = 'llm-review-body';
    const footer = _el('div', 'llm-review-footer');
    const status = _el('div', 'llm-review-status');
    status.id = 'llm-review-dialog-status';
    status.dataset.e2eId = 'llm-review-status';
    status.setAttribute('aria-live', 'polite');
    status.style.marginRight = 'auto';
    footer.appendChild(status);
    modal.append(header, body, footer);
    overlay.appendChild(modal);
    const keyHandler = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      _close(overlay);
    };
    overlay.__llmReviewCleanup = () => document.removeEventListener('keydown', keyHandler, true);
    document.addEventListener('keydown', keyHandler, true);
    document.body.appendChild(overlay);
    setTimeout(() => _focusInitialDialogControl(modal), 0);
    return { overlay, body, footer, status };
  }

  function _fillPresetSelect(select, presets) {
    select.textContent = '';
    (presets || []).forEach(preset => {
      const option = document.createElement('option');
      option.value = preset.preset_id || '';
      option.textContent = preset.name || preset.preset_id || '';
      select.appendChild(option);
    });
  }

  function _renderReviewerChecks(container, reviewers, preset) {
    container.textContent = '';
    container.dataset.e2eId = 'llm-review-reviewers';
    const enabled = new Set(preset?.reviewer_ids || []);
    (reviewers || []).forEach(reviewer => {
      const label = _el('label', 'llm-review-check');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = reviewer.reviewer_id || '';
      input.checked = enabled.has(reviewer.reviewer_id);
      input.dataset.e2eId = 'llm-review-reviewer-check';
      const text = _el('span', '', reviewer.name || reviewer.reviewer_id || '');
      label.append(input, text);
      container.appendChild(label);
    });
  }

  function _fillExecutionProviderSelect(select) {
    const options = [
      ['codex', 'Codex CLI'],
      ['gemini_cli', 'Gemini CLI'],
      ['claude_code', 'Claude Code'],
      ['gemini', 'Gemini API'],
      ['openai', 'OpenAI API'],
      ['anthropic', 'Claude API'],
      ['mock', '内蔵テストレビュー'],
    ];
    select.textContent = '';
    options.forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    });
    select.value = 'codex';
  }

  function _selectedReviewerIds(container) {
    return Array.from(container.querySelectorAll('input[type="checkbox"]:checked'))
      .map(input => input.value)
      .filter(Boolean);
  }

  function _normalizeIssueLearningDefault(issue) {
    if (issue && (!issue.accepted_state || issue.accepted_state === 'pending')) {
      issue.apply_to_editor_learning = false;
    }
    return issue;
  }

  function _issuesForRun(run) {
    return (run?.merged?.issues || []).filter(issue => issue?.issue_id).map(_normalizeIssueLearningDefault);
  }

  function _findIssueById(run, issueId) {
    return _issuesForRun(run).find(issue => issue.issue_id === issueId) || null;
  }

  function _acceptedIssueIds(run) {
    return _issuesForRun(run)
      .filter(issue => issue.accepted_state === 'accepted')
      .map(issue => issue.issue_id)
      .filter(Boolean);
  }

  function _severityLabel(value) {
    return { high: '高', medium: '中', low: '低' }[String(value || '').toLowerCase()] || String(value || '中');
  }

  function _confidenceLabel(value) {
    return { high: '高信頼', medium: '中信頼', low: '低信頼' }[String(value || '').toLowerCase()] || '中信頼';
  }

  function _pill(label, value, className) {
    const node = _el('span', className || 'llm-review-pill');
    node.append(_el('span', 'llm-review-pill-label', label), _el('span', '', String(value || '')));
    return node;
  }

  function _renderSummary(summary) {
    const data = summary || {};
    const wrap = _el('div', 'llm-review-summary');
    wrap.appendChild(_el('div', 'llm-review-summary-title', data.headline || 'レビュー結果'));
    const chips = _el('div', 'llm-review-summary-chips');
    [
      ['高', data.high || 0, 'high'],
      ['中', data.medium || 0, 'medium'],
      ['低', data.low || 0, 'low'],
      ['合計', data.total || 0, 'total'],
      ['正本注意', data.canonical_conflict || 0, 'canonical'],
      ['根拠不足', data.evidence_missing || 0, 'evidence'],
      ['伸びしろ', data.creative_opportunity || 0, 'creative'],
    ].forEach(([label, value, kind]) => {
      const chip = _pill(label, value, 'llm-review-pill');
      chip.dataset.kind = kind;
      chips.appendChild(chip);
    });
    wrap.appendChild(chips);
    return wrap;
  }

  function _renderIssueText(label, text) {
    const value = String(text || '').trim();
    if (!value) return null;
    const node = _el('div', 'llm-review-issue-note');
    node.append(_el('div', 'llm-review-issue-note-label', label), _el('div', '', value));
    return node;
  }

  function _renderSourceRefs(refs) {
    const items = Array.isArray(refs) ? refs.filter(Boolean).slice(0, 6) : [];
    if (!items.length) return null;
    const wrap = _el('div', 'llm-review-source-refs');
    wrap.appendChild(_el('div', 'llm-review-source-title', '根拠'));
    items.forEach(ref => {
      const label = String(ref.label || '').trim() || String(ref.path || '').split(/[\\/]/).pop() || '参照';
      const path = String(ref.path || '').trim();
      const feature = String(ref.feature || '').trim();
      wrap.appendChild(_el('div', 'llm-review-source-ref', [label, feature, path].filter(Boolean).join(' / ')));
    });
    return wrap;
  }

  function _feedbackEventId(prefix = 'evt') {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  async function _saveIssueState(run, issue, state, stateReason, applyLearning, eventPrefix = 'evt') {
    const payload = {
      accepted_state: state,
      state_reason: stateReason || '',
      apply_to_editor_learning: !!applyLearning,
      feedback_event_id: _feedbackEventId(eventPrefix),
      source_folder: run.source_folder || '',
      work_folder: run.work_folder || '',
    };
    const updated = await _api(`/llm-review/run/${encodeURIComponent(run.run_id)}/issue/${encodeURIComponent(issue.issue_id)}/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (updated?.run && typeof Object.assign === 'function') Object.assign(run, updated.run);
    return { updated, payload };
  }

  function _renderBulkStateActions(run, status, onStateChange, rerender) {
    const wrap = _el('div', 'llm-review-bulk-actions');
    wrap.dataset.e2eId = 'llm-review-bulk-actions';
    wrap.appendChild(_el('span', 'llm-review-bulk-label', '一括変更'));
    const canPersist = run?.options?.save_results !== false;
    const issueIds = _issuesForRun(run).map(issue => issue.issue_id);
    const actions = [
      ['accepted', '全採用'],
      ['deferred', '全保留'],
      ['rejected', '全却下'],
      ['pending', '全未判断'],
    ];
    actions.forEach(([state, label]) => {
      const btn = _button(label, 'llm-review-state-btn');
      btn.dataset.e2eId = 'llm-review-bulk-state';
      btn.dataset.reviewState = state;
      btn.disabled = !canPersist || !issueIds.length;
      if (!canPersist) btn.title = 'レビュー結果を保存すると一括変更できます';
      btn.addEventListener('click', async () => {
        if (!canPersist || !issueIds.length) return;
        const buttons = Array.from(wrap.querySelectorAll('button'));
        buttons.forEach(item => { item.disabled = true; });
        let ok = 0;
        let failed = 0;
        let learningFailed = 0;
        let lastError = '';
        status.textContent = `${label}を保存中... 0/${issueIds.length}`;
        for (const issueId of issueIds) {
          const issue = _findIssueById(run, issueId) || { issue_id: issueId };
          try {
            const { updated } = await _saveIssueState(run, issue, state, issue.state_reason || '', !!issue.apply_to_editor_learning, 'evt_bulk');
            ok += 1;
            if (updated?.editor_learning_error) learningFailed += 1;
          } catch (err) {
            failed += 1;
            lastError = err?.message || String(err || '');
          }
          status.textContent = `${label}を保存中... ${ok + failed}/${issueIds.length}`;
        }
        if (typeof onStateChange === 'function') onStateChange(run);
        if (typeof rerender === 'function') rerender();
        if (failed) {
          status.textContent = `${label}: ${ok}件保存、${failed}件失敗` + (lastError ? `（最後のエラー: ${lastError}）` : '');
        } else if (learningFailed) {
          status.textContent = `${label}: ${ok}件保存しました（編集学習は ${learningFailed} 件更新できませんでした）`;
        } else {
          status.textContent = `${label}: ${ok}件保存しました`;
        }
      });
      wrap.appendChild(btn);
    });
    return wrap;
  }

  function _renderRunResult(resultPane, run, status, onStateChange) {
    resultPane.textContent = '';
    const summary = run?.merged?.summary || {};
    const canPersist = run?.options?.save_results !== false;
    resultPane.appendChild(_renderSummary(summary));
    if (!canPersist) {
      resultPane.appendChild(_el('div', 'llm-review-meta', '保存しない設定のため、採用状態と改稿案はこの画面では保存されません。'));
    }
    const rerender = () => _renderRunResult(resultPane, run, status, onStateChange);
    resultPane.appendChild(_renderBulkStateActions(run, status, onStateChange, rerender));
    const issuesWrap = _el('div', 'llm-review-results');
    _issuesForRun(run).forEach(issue => {
      issuesWrap.appendChild(_renderIssue(run, issue, status, onStateChange));
    });
    if (!_issuesForRun(run).length) {
      issuesWrap.appendChild(_el('div', 'llm-review-meta', '指摘はありません。'));
    }
    resultPane.appendChild(issuesWrap);
  }

  function _renderIssue(run, issue, status, onStateChange) {
    const card = _el('div', 'llm-review-issue');
    card.dataset.e2eId = 'llm-review-issue';
    card.dataset.severity = issue.severity || 'medium';
    card.appendChild(_el('div', 'llm-review-issue-title', `[${_severityLabel(issue.severity)}] ${issue.issue || ''}`));
    const meta = _el('div', 'llm-review-issue-meta');
    meta.append(
      _pill('観点', issue.category || 'review'),
      _pill('担当', issue.reviewer_id || ''),
      _pill('信頼', _confidenceLabel(issue.confidence))
    );
    card.appendChild(meta);
    card.appendChild(_el('div', 'llm-review-meta', issue.suggestion || ''));
    const impact = _renderIssueText('影響', issue.impact);
    const opportunity = _renderIssueText('伸ばせる点', issue.creative_opportunity);
    const biasNotes = _renderIssueText('注意した偏り', Array.isArray(issue.bias_notes) ? issue.bias_notes.join(' / ') : issue.bias_notes);
    [impact, opportunity, biasNotes, _renderSourceRefs(issue.source_refs)].forEach(node => {
      if (node) card.appendChild(node);
    });
    if ((issue.warnings || []).length) {
      card.appendChild(_el('div', 'llm-review-meta', '警告: ' + issue.warnings.join(' / ')));
    }
    const reason = _el('textarea', 'llm-review-textarea');
    reason.dataset.e2eId = 'llm-review-issue-reason';
    reason.placeholder = '採用理由 / 却下理由';
    reason.value = issue.state_reason || '';
    const learn = _el('label', 'llm-review-check');
    const learnInput = document.createElement('input');
    learnInput.type = 'checkbox';
    learnInput.checked = issue.accepted_state !== 'pending' && !!issue.apply_to_editor_learning;
    learnInput.dataset.e2eId = 'llm-review-issue-learning';
    learn.append(learnInput, _el('span', '', 'この傾向を今後のレビューに反映'));
    const actions = _el('div', 'llm-review-issue-actions');
    actions.dataset.e2eId = 'llm-review-issue-actions';
    Object.entries(STATE_LABELS).forEach(([state, label]) => {
      const btn = _button(label, 'llm-review-state-btn');
      btn.dataset.e2eId = 'llm-review-issue-state';
      btn.dataset.reviewState = state;
      btn.dataset.active = issue.accepted_state === state ? '1' : '0';
      if (run?.options?.save_results === false) {
        btn.disabled = true;
        btn.title = 'レビュー結果を保存すると状態を保存できます';
      }
      btn.addEventListener('click', async () => {
        if (run?.options?.save_results === false) return;
        status.textContent = '状態を保存中...';
        try {
          const { updated, payload } = await _saveIssueState(run, issue, state, reason.value || '', learnInput.checked);
          issue.accepted_state = state;
          issue.state_reason = payload.state_reason;
          issue.apply_to_editor_learning = payload.apply_to_editor_learning;
          actions.querySelectorAll('.llm-review-state-btn').forEach(item => { item.dataset.active = '0'; });
          btn.dataset.active = '1';
          status.textContent = updated.editor_learning_error
            ? '状態は保存しました（編集学習は更新できませんでした: ' + updated.editor_learning_error + '）'
            : updated.editor_learning ? '状態と編集学習を保存しました' : '状態を保存しました';
          if (typeof onStateChange === 'function') onStateChange(updated?.run || run);
        } catch (err) {
          status.textContent = '状態の保存に失敗しました: ' + (err?.message || err);
        }
      });
      actions.appendChild(btn);
    });
    card.append(reason, learn, actions);
    return card;
  }

  async function openLlmCrossReviewDialog(options = {}) {
    const { overlay, body, footer, status } = _buildOverlay({ returnFocus: options.returnFocus });
    const targetCandidates = _targetCandidates(options.target);
    let target = targetCandidates[0] || _normalizeTargetInfo(options.target || _targetInfo());
    const sourceFolder = options.source_folder || _sourceFolderValue();
    let workFolder = options.work_folder || _workFolderValue(target.path);
    const controls = _el('div', 'llm-review-section');
    controls.appendChild(_el('h3', '', '実行設定'));
    const targetLabel = _el('label', 'llm-review-label');
    targetLabel.appendChild(_el('span', '', '対象ファイル'));
    const targetSelect = _el('select', 'llm-review-select');
    targetSelect.dataset.e2eId = 'llm-review-target-select';
    _fillTargetSelect(targetSelect, targetCandidates, target);
    targetLabel.appendChild(targetSelect);
    controls.appendChild(targetLabel);
    const targetMeta = _el('div', 'llm-review-meta', `対象: ${target.path || '未選択'}`);
    const workFolderMeta = _el('div', 'llm-review-meta', `作品フォルダ: ${workFolder || '未設定'}`);
    controls.appendChild(targetMeta);
    controls.appendChild(workFolderMeta);
    const presetLabel = _el('label', 'llm-review-label');
    presetLabel.appendChild(_el('span', '', 'レビュー内容'));
    const presetSelect = _el('select', 'llm-review-select');
    presetSelect.dataset.e2eId = 'llm-review-preset-select';
    presetLabel.appendChild(presetSelect);
    controls.appendChild(presetLabel);
    const priorityLabel = _el('label', 'llm-review-label');
    priorityLabel.appendChild(_el('span', '', '今回の重点'));
    const priority = _el('textarea', 'llm-review-textarea');
    priority.dataset.e2eId = 'llm-review-priority';
    priority.placeholder = '特に見てほしい点';
    priorityLabel.appendChild(priority);
    controls.appendChild(priorityLabel);
    const details = document.createElement('details');
    details.className = 'llm-review-details';
    details.dataset.e2eId = 'llm-review-details';
    const detailsSummary = document.createElement('summary');
    detailsSummary.textContent = '詳細設定';
    detailsSummary.dataset.e2eId = 'llm-review-details-summary';
    details.appendChild(detailsSummary);
    const reviewerBox = _el('div', '');
    details.appendChild(reviewerBox);
    const saveLabel = _el('label', 'llm-review-check');
    const saveInput = document.createElement('input');
    saveInput.type = 'checkbox';
    saveInput.checked = true;
    saveInput.dataset.e2eId = 'llm-review-save-results';
    saveLabel.append(saveInput, _el('span', '', 'レビュー結果を保存'));
    details.appendChild(saveLabel);
    const providerLabel = _el('label', 'llm-review-label');
    providerLabel.appendChild(_el('span', '', '実行エンジン'));
    const executionProvider = _el('select', 'llm-review-select');
    executionProvider.dataset.e2eId = 'llm-review-execution-provider';
    _fillExecutionProviderSelect(executionProvider);
    providerLabel.appendChild(executionProvider);
    details.appendChild(providerLabel);
    controls.appendChild(details);
    const resultPane = _el('div', 'llm-review-section');
    resultPane.appendChild(_el('h3', '', 'レビュー結果'));
    resultPane.appendChild(_el('div', 'llm-review-meta', '実行するとここに指摘が表示されます。'));
    body.append(controls, resultPane);
    let currentRun = null;
    let busy = false;
    const runBtn = _button('実行', 'gb-btn gb-btn-primary');
    const revisionBtn = _button('改稿案作成', 'gb-btn gb-btn-primary');
    const cancelBtn = _button('中止', 'gb-btn');
    runBtn.dataset.e2eId = 'llm-review-run';
    revisionBtn.dataset.e2eId = 'llm-review-revision';
    cancelBtn.dataset.e2eId = 'llm-review-cancel';
    cancelBtn.disabled = true;
    const updateRevisionButton = () => {
      const acceptedIds = _acceptedIssueIds(currentRun);
      const canPersist = currentRun?.options?.save_results !== false;
      const busy = !!_activeController;
      revisionBtn.disabled = !currentRun || !canPersist || !acceptedIds.length || busy;
      if (!currentRun) {
        revisionBtn.title = 'レビュー実行後に利用できます';
      } else if (!canPersist) {
        revisionBtn.title = 'レビュー結果を保存すると本文へ反映できます';
      } else if (!acceptedIds.length) {
        revisionBtn.title = '採用した指摘があると本文へ反映できます';
      } else {
        revisionBtn.title = '採用した指摘に沿って本文を修正し、前後のスナップショットを作成します';
      }
    };
    const handleRunStateChange = updatedRun => {
      if (updatedRun) currentRun = updatedRun;
      updateRevisionButton();
    };
    const setBusy = value => {
      busy = !!value;
      targetSelect.disabled = busy || !targetCandidates.length;
      presetSelect.disabled = busy;
      priority.disabled = busy;
      saveInput.disabled = busy;
      executionProvider.disabled = busy;
      reviewerBox.querySelectorAll('input,button,select,textarea').forEach(el => { el.disabled = busy; });
      runBtn.disabled = busy || !target.path;
      cancelBtn.disabled = !busy;
      updateRevisionButton();
    };
    const updateTargetSelection = () => {
      if (busy) return;
      const index = Number(targetSelect.value);
      target = targetCandidates[index] || _normalizeTargetInfo({});
      if (!options.work_folder) workFolder = _workFolderValue(target.path);
      targetMeta.textContent = `対象: ${target.path || '未選択'}`;
      workFolderMeta.textContent = `作品フォルダ: ${workFolder || '未設定'}`;
      if (currentRun && currentRun.target_path !== target.path) currentRun = null;
      const hasTarget = !!target.path;
      runBtn.disabled = busy || !hasTarget;
      runBtn.title = hasTarget ? '' : 'レビューの対象ファイルを選択してください';
      if (!hasTarget) status.textContent = '対象ファイルが選択されていません';
      updateRevisionButton();
    };
    targetSelect.addEventListener('change', updateTargetSelection);
    updateTargetSelection();
    footer.append(cancelBtn, revisionBtn, runBtn);

    let presetsPayload = null;
    try {
      presetsPayload = await _api('/llm-review/presets');
      _fillPresetSelect(presetSelect, presetsPayload.presets || []);
      const initialPreset = (presetsPayload.presets || [])[0] || {};
      _renderReviewerChecks(reviewerBox, presetsPayload.reviewers || [], initialPreset);
      presetSelect.addEventListener('change', () => {
        const preset = (presetsPayload.presets || []).find(item => item.preset_id === presetSelect.value) || {};
        _renderReviewerChecks(reviewerBox, presetsPayload.reviewers || [], preset);
      });
    } catch (err) {
      status.textContent = 'プリセット取得に失敗しました: ' + (err?.message || err);
    }

    cancelBtn.addEventListener('click', () => {
      if (_activeController) {
        _activeController.abort();
      }
      status.textContent = '中止処理中...';
      updateRevisionButton();
    });

    revisionBtn.addEventListener('click', async () => {
      const acceptedIds = _acceptedIssueIds(currentRun);
      if (!currentRun || !acceptedIds.length) {
        status.textContent = '採用した指摘を選択してください';
        updateRevisionButton();
        return;
      }
      status.textContent = '改稿案を作成し、本文へ反映中...';
      _activeController = new AbortController();
      setBusy(true);
      updateRevisionButton();
      try {
        const result = await _api(`/llm-review/run/${encodeURIComponent(currentRun.run_id)}/revision-apply`, {
          method: 'POST',
          signal: _activeController.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accepted_issue_ids: acceptedIds,
            source_folder: currentRun.source_folder || '',
            work_folder: currentRun.work_folder || '',
          }),
        });
        currentRun.revision_plan = result.plan || null;
        currentRun.revision_application = result.application || null;
        const appliedPath = result.target_path || currentRun.target_path || target.path;
        if (typeof _refreshRestoredVersionTarget === 'function') {
          await Promise.resolve(_refreshRestoredVersionTarget(appliedPath, 'file'));
        }
        if (typeof _refreshVersionViews === 'function') _refreshVersionViews(appliedPath, 'file');
        const beforeVersion = result.application?.before_version || '';
        const afterVersion = result.application?.after_version || '';
        status.textContent = beforeVersion && afterVersion
          ? `本文を修正しました（反映前: ${beforeVersion} / 反映後: ${afterVersion}）`
          : '本文を修正しました';
        if (typeof showStatus === 'function') showStatus('LLMレビューの改稿案を本文へ反映しました');
      } catch (err) {
        status.textContent = err?.name === 'AbortError' ? '中止しました' : '本文反映に失敗しました: ' + (err?.message || err);
      } finally {
        _activeController = null;
        setBusy(false);
        updateRevisionButton();
      }
    });

    runBtn.addEventListener('click', async () => {
      if (!target.path) {
        status.textContent = '対象ファイルを選択してから実行してください';
        return;
      }
      if (!workFolder) {
        status.textContent = '作品フォルダを設定してください';
        return;
      }
      if (!_selectedReviewerIds(reviewerBox).length) {
        status.textContent = 'レビュアーを1人以上選択してください';
        return;
      }
      status.textContent = 'レビューを実行中...';
      currentRun = null;
      _activeController = new AbortController();
      setBusy(true);
      updateRevisionButton();
      try {
        resultPane.textContent = '';
        resultPane.appendChild(_el('h3', '', '進行状況'));
        const progressLog = _el('div', 'llm-review-progress-log');
        resultPane.appendChild(progressLog);
        const run = await _runReviewStream({
          source_folder: sourceFolder,
          work_folder: workFolder,
          target_path: target.path,
          active_feature: _reviewFeatureForTarget(target.type, target.path),
          preset_id: presetSelect.value,
          reviewer_ids: _selectedReviewerIds(reviewerBox),
          user_priority_instruction: priority.value || '',
          options: { save_results: saveInput.checked, independent_review: true, execution_provider: executionProvider.value || 'codex', revision_provider: executionProvider.value || 'codex' },
        }, _activeController.signal, event => {
          const progressText = _progressTextFromEvent(event);
          if (progressText) _appendProgress(progressLog, progressText, event.type === 'error' ? 'error' : '');
          if (event.type === 'reviewer_start') status.textContent = `${event.reviewer_name || event.reviewer_id || 'レビュアー'} を実行中...`;
          if (event.type === 'provider_event' && event.event?.type === 'cli_status') status.textContent = event.event.message || 'CLIを実行中...';
        });
        status.textContent = 'レビュー完了';
        currentRun = run;
        _renderRunResult(resultPane, currentRun, status, handleRunStateChange);
        updateRevisionButton();
      } catch (err) {
        status.textContent = err?.name === 'AbortError' ? '中止しました' : 'レビューに失敗しました: ' + (err?.message || err);
      } finally {
        _activeController = null;
        setBusy(false);
        updateRevisionButton();
      }
    });
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) _close(overlay);
    });
  }

  window.openLlmCrossReviewDialog = openLlmCrossReviewDialog;
})();
