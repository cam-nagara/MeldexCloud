      body: JSON.stringify({
        provider: streamProvider,
        model: streamModel || undefined,
        ...(_chatIsLocalLlmProvider(streamProvider)
          ? { local_llm: typeof chatLocalLlmSettings === 'function' ? chatLocalLlmSettings() : {} }
          : { client_api_keys: typeof _chatClientApiKeysForRequest === 'function' ? await _chatClientApiKeysForRequest() : {} }),
        messages: _ensureChatMessageIds(streamMessages),
        system_prompt: streamSystemPrompt,
        session_id: streamSessionId,
        session_title: streamSessionTitle,
        target_path: streamTargetPath,
        reference_targets: streamTargets,
        source_folder: streamSourceFolder,
        workspace_id: streamWorkspaceId,
        work_folder: streamWorkFolder,
        active_feature: typeof _chatActiveFeatureForTarget === 'function' ? _chatActiveFeatureForTarget(streamTargetPath) : '',
        user: typeof getUsername === 'function' ? getUsername() : '',
        user_agent: navigator.userAgent || '',
        theme_context: typeof window.chatThemeContextSettings === 'function' ? window.chatThemeContextSettings() : {},
        allow_web_search: chatAllowWebSearch(),
        allow_auto_compress: chatAllowAutoCompress(),
        allow_code_execution: chatAllowCodeExecution(),
        ...(options.generationSettings || chatGenerationSettings()),
        ...chatCustomInstructionSettings(),
      }),
    });
    if (!res.ok) {
      let errorText = '';
      let errorCode = '';
      try {
        const errorData = await res.json();
        const detail = errorData?.detail;
        if (detail && typeof detail === 'object') {
          errorCode = detail.code || '';
          errorText = detail.message || detail.technical_detail || '';
        } else {
          errorText = detail || errorData?.error || errorData?.message || '';
        }
      } catch {
        try { errorText = await res.text(); } catch {}
      }
      const error = new Error(errorText || ('HTTP ' + res.status + ': ' + res.statusText));
      error.meldexCode = errorCode;
      error.status = res.status;
      throw error;
    }
    if (!res.body) throw new Error('ストリームを開始できませんでした');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!isCurrentStream()) {
        try { await reader.cancel(); } catch {}
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!isCurrentStream()) break;
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.substring(6));
          if (data.type === 'text_delta') {
            const chunk = data.content == null ? '' : String(data.content);
            if (!chunk) continue;
            // 思考内容がない場合は一時表示を消し、ある場合は完了までライブ欄を残す。
            if (responseThinking.trim()) showLiveActivityLog('応答を生成中...');
            else hideLiveActivity();
            if (!streamVisibleInCurrentChat()) assistantDiv = null;
            if (!assistantDiv || !assistantDiv.isConnected) {
              assistantDiv = addAssistantToVisibleStream('', _assistantRenderOptions());
            }
            fullText += chunk;
            if (assistantDiv && typeof _chatRenderAssistantStream === 'function') _chatRenderAssistantStream(assistantDiv, fullText, responseCitations);
            else if (assistantDiv) { let s = esc(fullText); s = s.replace(/\*\*(.*?)\*\*/g,'<b>$1</b>').replace(/`([^`]+)`/g,'<code style="background:var(--bg2);padding:1px 4px;border-radius:3px;">$1</code>').replace(/\n/g,'<br>'); assistantDiv.innerHTML = s; }
            scrollStreamContainer();
          } else if (data.type === 'thinking_delta') {
            appendLiveThinking(data.content, '思考中...');
          } else if (data.type === 'citation') {
            if (data.citation) responseCitations.push(data.citation);
            hideLiveActivity();
            if (!streamVisibleInCurrentChat()) assistantDiv = null;
            if (!assistantDiv || !assistantDiv.isConnected) {
              assistantDiv = addAssistantToVisibleStream('', _assistantRenderOptions());
            }
            if (assistantDiv && typeof _chatRenderAssistantStream === 'function') _chatRenderAssistantStream(assistantDiv, fullText, responseCitations);
            scrollStreamContainer();
          } else if (data.type === 'usage') {
            responseUsage = data.usage || null;
          } else if (data.type === 'budget_warning' || data.type === 'large_context_warning') {
            if (streamVisibleInCurrentChat()) chatAddSystem(data.message || 'LLM費用に関する警告があります');
          } else if (data.type === 'internal_notice') {
            // モデル別の復旧処理メモはアシスタント本文に混ぜない。
          } else if (data.type === 'error') {
            streamError = new Error(data.error || 'ストリームエラー');
            try { await reader.cancel(); } catch {}
            break;
          } else if (data.type === 'compression') {
            _chatApplyCompression(data, { messages: streamMessages, render: streamVisibleInCurrentChat() });
            showLiveActivity('会話履歴を圧縮中...');
            scrollStreamContainer();
          } else if (String(data.type || '').startsWith('code_exec_')) {
            showLiveActivityLog(data.type === 'code_exec_done' ? 'コード実行完了。応答を生成中...' : 'コードを実行中...');
            chatHandleCodeExecutionEvent(data, responseCodeExecBlocks, activityLog);
            scrollStreamContainer();
          } else if (data.type === 'tool_start') {
            showLiveActivityLog(data.name + ' を実行中...');
            chatAddToolUse(data.name, '実行中...', activityLog);
          } else if (data.type === 'client_tool_request') {
            showLiveActivityLog(data.name + ' を実行中...');
            await _chatHandleClientToolRequest(data, activityLog);
          } else if (data.type === 'tool_result') {
            responseToolEvents.push({ name: String(data.name || ''), result: data.result == null ? '' : String(data.result) });
            const toolDivs = activityLog.querySelectorAll('.chat-tool-use');
            const last = toolDivs[toolDivs.length - 1];
            if (last) {
              const resultText = data.result?.substring(0, 300) || '';
              last.querySelector('.tool-result-text').textContent = resultText;
            }
            _handleChatToolWorkspaceEffect(data.name, data.result);
            showLiveActivity('結果を処理中...');
          } else if (data.type === 'done') {
            hideLiveActivity();
          }
        } catch (e) {}
      }
    }

    if (streamError) throw streamError;
    streamCompleted = true;

    // アシスタントメッセージを記録 + 自動保存
    const toolOnlyResponse = !fullText && !responseCodeExecBlocks.length && responseToolEvents.length > 0;
    if (toolOnlyResponse) {
      fullText = 'ツール実行は完了しましたが、LLMから応答本文が返りませんでした。必要ならもう一度送信してください。';
    }
    if (isCurrentStream() && (fullText || responseCodeExecBlocks.length)) {
      const auditResult = typeof _chatToolTruthSanitize === 'function'
        ? _chatToolTruthSanitize(fullText, text, responseToolEvents)
        : {
            text: fullText,
            warning: typeof _chatToolTruthAudit === 'function' ? _chatToolTruthAudit(fullText, text, responseToolEvents) : '',
            replaced: false,
          };
      const auditWarning = auditResult.warning || '';
      if (auditResult.replaced) {
        fullText = auditResult.text;
        if (assistantDiv && typeof _chatRenderAssistantStream === 'function') _chatRenderAssistantStream(assistantDiv, fullText, responseCitations);
        else if (assistantDiv) assistantDiv.textContent = fullText;
      } else if (auditWarning) {
        if (assistantDiv && typeof _chatRenderAssistantStream === 'function') _chatRenderAssistantStream(assistantDiv, fullText, responseCitations);
        else if (assistantDiv) assistantDiv.textContent = fullText;
        if (assistantDiv && typeof _chatRenderToolAuditWarning === 'function') _chatRenderToolAuditWarning(assistantDiv, auditWarning);
      }
      if (!assistantDiv || !assistantDiv.isConnected) {
        const renderOptions = _assistantRenderOptions();
        if (auditWarning) renderOptions.tool_audit_warning = auditWarning;
        if (responseThinking.trim()) renderOptions.thinking = responseThinking;
        assistantDiv = addAssistantToVisibleStream(fullText || '[コード実行結果]', renderOptions);
      }
      if (assistantDiv && typeof _chatRenderThinking === 'function') _chatRenderThinking(assistantDiv, responseThinking);
      const assistantMessage = { role: 'assistant', content: fullText || '[コード実行結果]', msg_id: assistantMessageId, provider: streamProvider, model: streamModel, timestamp: assistantTimestamp || _chatLocalTimestamp() };
      if (responseCitations.length > 0) assistantMessage.citations = responseCitations;
      if (responseUsage) assistantMessage.usage = responseUsage;
      if (responseCodeExecBlocks.length > 0) assistantMessage.code_exec_blocks = responseCodeExecBlocks;
      if (responseThinking.trim()) assistantMessage.thinking = responseThinking;
      if (auditWarning) assistantMessage.tool_audit_warning = auditWarning;
      streamMessages.push(assistantMessage);
      sendOk = true;
      chatAutoSave({
        messages: streamMessages,
        sessionId: streamSessionId,
        sessionTitle: streamSessionTitle,
        targetPath: streamTargetPath,
        targets: streamTargets,
        sourceFolder: streamSourceFolder,
        workspaceId: streamWorkspaceId,
        provider: streamProvider,
        model: streamModel,
      }).then(() => { if (typeof renderChatHistory === 'function') renderChatHistory(); });
    }
  } catch (e) {
    if (!isCurrentStream()) return false;
    spinnerWrapper.remove();
    if (e?.name === 'AbortError') {
      const abortedText = (fullText ? fullText.trimEnd() + '\n\n' : '') + '[中断されました]';
      if (!streamVisibleInCurrentChat()) assistantDiv = null;
      if (!assistantDiv || !assistantDiv.isConnected) {
        assistantDiv = addAssistantToVisibleStream('', _assistantRenderOptions());
      }
      if (assistantDiv && typeof _chatRenderAssistantStream === 'function') _chatRenderAssistantStream(assistantDiv, abortedText, responseCitations);
      else if (assistantDiv) assistantDiv.textContent = abortedText;
      if (assistantDiv && typeof _chatRenderThinking === 'function') _chatRenderThinking(assistantDiv, responseThinking);
      const assistantMessage = { role: 'assistant', content: abortedText, msg_id: assistantMessageId, provider: streamProvider, model: streamModel, timestamp: assistantTimestamp || _chatLocalTimestamp(), aborted: true };
      if (responseCitations.length > 0) assistantMessage.citations = responseCitations;
      if (responseUsage) assistantMessage.usage = responseUsage;
      if (responseCodeExecBlocks.length > 0) assistantMessage.code_exec_blocks = responseCodeExecBlocks;
      if (responseThinking.trim()) assistantMessage.thinking = responseThinking;
      streamMessages.push(assistantMessage);
      sendOk = true;
      chatAutoSave({
        messages: streamMessages,
        sessionId: streamSessionId,
        sessionTitle: streamSessionTitle,
        targetPath: streamTargetPath,
        targets: streamTargets,
        sourceFolder: streamSourceFolder,
        workspaceId: streamWorkspaceId,
        provider: streamProvider,
        model: streamModel,
      }).then(() => { if (typeof renderChatHistory === 'function') renderChatHistory(); });
    } else {
      const errorText = '応答を完了できませんでした。接続または送信設定を確認して、もう一度お試しください。';
      if (!streamVisibleInCurrentChat()) assistantDiv = null;
      if (!assistantDiv || !assistantDiv.isConnected) assistantDiv = addAssistantToVisibleStream(errorText, _assistantRenderOptions());
      else assistantDiv.textContent = errorText;
      streamMessages.push({
        role: 'assistant',
        content: errorText,
        msg_id: assistantMessageId,
        provider: streamProvider,
        model: streamModel,
        timestamp: assistantTimestamp || _chatLocalTimestamp(),
        error: true,
        error_code: e?.meldexCode || 'stream_failed',
      });
      sendOk = true;
      chatAutoSave({
        messages: streamMessages,
        sessionId: streamSessionId,
        sessionTitle: streamSessionTitle,
        targetPath: streamTargetPath,
        targets: streamTargets,
        sourceFolder: streamSourceFolder,
        workspaceId: streamWorkspaceId,
        provider: streamProvider,
        model: streamModel,
      }).then(() => { if (typeof renderChatHistory === 'function') renderChatHistory(); });
    }
  } finally {
    spinnerWrapper.remove();
    if (_chatState.streamToken === streamToken && _chatState.abortController === streamController) {
      _chatState.streaming = false;
      _chatState.abortController = null;
      _chatState.streamingProvider = '';
      _chatState.streamingTargetPath = '';
      _syncChatSourceFolderUi();
      if (typeof _chatRefreshMessageDeleteButtons === 'function') _chatRefreshMessageDeleteButtons();
      const liveSendBtn = document.getElementById('chat-send-btn') || sendBtn;
      if (liveSendBtn && !detachedScope) {
        liveSendBtn.textContent = '送信';
        liveSendBtn.title = '送信 (Enter)';
        liveSendBtn.disabled = false;
      }
      if (typeof _chatRefreshApiKeyState === 'function') _chatRefreshApiKeyState().catch(() => {});
      if (!detachedScope && input?.isConnected && !window.GBChatFormatting?.focusInput?.()) input.focus();
      const shouldInterruptSend = !!_chatState.interruptDraftId;
      if ((streamCompleted || shouldInterruptSend) && typeof _chatSendQueuedMessagesAfterStream === 'function') {
        setTimeout(() => {
          _chatSendQueuedMessagesAfterStream({
            messages: streamMessages,
            sessionId: streamSessionId,
            sessionTitle: streamSessionTitle,
            targetPath: streamTargetPath,
            targets: streamTargets,
            sourceFolder: streamSourceFolder,
            workspaceId: streamWorkspaceId,
            provider: streamProvider,
            model: streamModel,
            mode: Object.prototype.hasOwnProperty.call(options || {}, 'mode')
              ? options.mode
              : (typeof _chatMode === 'undefined' ? '' : _chatMode || ''),
          }).catch(() => {});
        }, 0);
      }
      if (_chatState.activeExecution?.controller === streamController) _chatState.activeExecution = null;
      window.MeldexChatListbox?.decorateHistory?.();
    }
    if (msgContainer && !detachedScope) msgContainer.removeEventListener('scroll', _scrollHandler);
  }
  return sendOk;
}

async function _chatHandleClientToolRequest(data, activityLog) {
  const name = String(data?.name || '');
  let result = { ok: false, error: 'クライアント側UI操作ブリッジが利用できません' };
  try {
    if (window.GBMeldexLlmOperations?.handleClientToolRequest) {
      result = await window.GBMeldexLlmOperations.handleClientToolRequest(data);
    }
  } catch (e) {
    result = { ok: false, error: e?.message || String(e) };
  }

  const resultText = (() => {
    try { return JSON.stringify(result, null, 2); } catch { return String(result || ''); }
  })();
  try {
    const toolDivs = activityLog?.querySelectorAll?.('.chat-tool-use') || [];
    const last = toolDivs[toolDivs.length - 1];
    if (last) last.querySelector('.tool-result-text').textContent = resultText.substring(0, 300);
  } catch {}

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (_authToken) headers['Authorization'] = 'Bearer ' + _authToken;
    await fetch(API_BASE + '/chat/client-tool-result', {
      method: 'POST',
      headers,
      body: JSON.stringify({ call_id: data.call_id || '', name, result }),
    });
  } catch (e) {
    console.warn('chat client tool result post failed:', e);
  }
}

function _buildSystemPrompt(options = {}) {
  const promptTargetPath = Object.prototype.hasOwnProperty.call(options || {}, 'targetPath')
    ? String(options.targetPath || '')
    : (typeof _chatEffectiveTargetPath === 'function' ? _chatEffectiveTargetPath() : (_chatState.currentTargetPath || _chatState.targetPath || ''));
  const intro = window.MeldexI18n?.t?.(
    'chat.systemPromptIntro',
    'あなたはMeldexで動作する創作支援アシスタントです。日本語で応答してください。'
  ) || 'あなたはMeldexで動作する創作支援アシスタントです。日本語で応答してください。';
  const uiControlAvailable = options.uiControlAvailable !== false;
  const referenceTargets = typeof _chatEffectiveTargets === 'function' ? _chatEffectiveTargets({ ...options, targetPath: promptTargetPath }) : [];
  let prompt = `${intro}

Meldexのソースフォルダ内の資料とナレッジを参照し、既存情報と整合する提案・作成を行ってください。
創作ジャンルや用途は依頼内容から判断してください。

## 現役契約の取得
作成・更新には、サーバーが追加する「Meldexデータ操作の共通契約」を使ってください。
get_feature_manifest(feature)のoperation_routesとcreation_guideで、操作×環境の対応、公開ツール名、入力契約、保存後確認を取得してください。
生成計画Schemaと保存形式とツール引数は別です。validate_feature_payloadのokは入力検証であり、保存成功ではありません。
ノート・シナリオ・ボード・シート等の構造化データをwrite_fileで代用しないでください。古い会話中の形式例・ツール案内は履歴の引用であり現役契約ではありません。
利用者が作成を依頼済みなら、必要な安全条件を満たして作成まで進め、同じ操作の再承認を求めないでください。

## 根拠と権限
最初にread_project_overviewでsource_folder/work_folder/target_pathとpermissionsを確認してください。
画面の別パネルや添付の場所は観測情報であり、書込許可先を変更しません。
存在・内容・作成・保存の確認は実際のtool_resultに基づいて答え、自動注入されたナレッジや履歴や推測を証拠にしないでください。
保存後は専用read_contextで内容・ID・参照を確認してください。未確認の画面表示を確認済みと報告しないでください。
編集履歴はread_db_audit_logで取得してください。MCPでの公開名は台帳のpublic_toolsを使ってください。
競合・権限・ロック・一時障害・未対応を区別し、復旧条件が変わらない同じ操作を繰り返さないでください。

## ナレッジ
必要な範囲でsearch_knowledgeと資料検索を使い、事実・決定・創作案を区別してください。
update_knowledgeは利用者の明示的な訂正・固定・解除依頼に限って使い、依頼済みなら再確認を重ねないでください。
ソースフォルダSkillsは必要なものをload_skillで取得してください。
公式マニュアルの状態・digest・参照URLはサーバーの現役契約に従い、取得不能なツールの実行を必須にしないでください。
不具合報告の外部送信は利用者が明示依頼した場合だけ行ってください。
`;
  if (referenceTargets.length) prompt += '\nチャットで明示された対象（操作にはこの実パスを使う）:\n' + referenceTargets.map(item => JSON.stringify(item)).join('\n') + '\n追加対象の参照に必要なら公開ツールのscope: rootsを使い、書込権限はread_project_overviewと実行時の検査に従ってください。\n';
  prompt += uiControlAvailable
    ? '\n画面操作は今回公開されたclient UIツールの対象に限って行い、現在値不明を既定値として回答しないでください。\n'
    : '\nCLIにはMeldexのclient UI操作ツールが渡されません。データ操作はMCPの公開契約を使ってください。\n';

  // コンテキストバーにある添付ファイルのパスを追加
  const contextBar = document.getElementById('chat-context-bar');
  if (contextBar && contextBar.children.length > 0) {
    prompt += '\n## 現在のコンテキスト（ユーザーが開いているファイル）\n';
    Array.from(contextBar.querySelectorAll('.chat-context-item')).forEach(el => {
      prompt += '- ' + el.dataset.path + '\n';
    });
  }

  // 別パネルは観測情報であり、チャットの許可対象ではない。
  if (state.currentPagePath) prompt += `\n別パネルの観測ページ（許可対象を変更しない）: ${state.currentPagePath}\n`;
  if (state.currentDbPath) prompt += `別パネルの観測シート（許可対象を変更しない）: ${state.currentDbPath}\n`;
  if (state.currentBoardPath) prompt += `別パネルの観測ボード（許可対象を変更しない）: ${state.currentBoardPath}\n`;
  const currentTarget = typeof _chatCurrentOpenTarget === 'function' ? _chatCurrentOpenTarget() : { path: '' };
  if (currentTarget.path && currentTarget.path !== promptTargetPath) prompt += `別パネルの観測対象（許可対象を変更しない）: ${currentTarget.path}\n`;

  if (uiControlAvailable && window.GBMeldexLlmOperations?.promptSummary) {
    const uiSummary = window.GBMeldexLlmOperations.promptSummary();
    if (uiSummary) prompt += '\n' + uiSummary + '\n';
  }

  // 対象がある場合、ファイル/フォルダ情報を強調
  if (promptTargetPath) {
    prompt += `\n## このチャットの現在の対象\nパス: ${promptTargetPath}\nこのチャットはこのファイルまたはフォルダに関する会話です。内容を参照する場合、ファイルならread_file、フォルダならbrowse/search/read_project_overviewを使ってください。\n`;
  }

  prompt += '\n質問を選択式で尋ねる場合は、meldex-pollという言語名のコードブロックにJSONを書くと回答ボタンになる。形式は {"version":1,"id":"質問ごとに異なる8〜80文字の英数字ID","kind":"survey","question":"質問","options":["選択肢1","選択肢2"],"anonymous":true}。選択肢は2〜4個。四択クイズはkindをquizにしてanswerへ0始まりの正解番号を入れる。回答はユーザーメッセージとして届く。\n';
  return prompt;
}

async function _chatSwitchSourceFolderForOpen(sourceFolder, options = {}) {
  const next = String(sourceFolder || '');
  const current = typeof _chatTargetSelectorValue === 'function' ? _chatTargetSelectorValue() : _chatSourceFolderValue();
  if (next === current && !options.force) return true;
  const switched = await _setChatSourceFolder(next, options);
  const updated = typeof _chatTargetSelectorValue === 'function' ? _chatTargetSelectorValue() : _chatSourceFolderValue();
  if (switched && next === updated) return true;
  if (typeof showStatus === 'function') showStatus('対象を切り替えられませんでした', true);
  return false;
}

// ファイル紐づきチャットを開始/復元
async function openFileChat(targetPath) {
  if (!targetPath) return false;
  const restoreGuard = typeof GBChatRestore !== 'undefined' && typeof GBChatRestore.restoreGuard === 'function'
    ? GBChatRestore.restoreGuard()
    : null;
  const restoreStillCurrent = () => !restoreGuard || restoreGuard();
  const showOpenLoading = typeof showLoading === 'function' && typeof hideLoading === 'function';
  const loading = showOpenLoading ? showLoading('チャットを読み込み中...', { key: 'chat:' + targetPath }) : null;
  try {
  if (typeof _chatAbortActiveStreamForNavigation === 'function') _chatAbortActiveStreamForNavigation();
  await _initChatSourceFolderSelector();
  if (!restoreStillCurrent()) return false;
  const detectedSourceFolder = _detectSourceFolderFromPath(targetPath);
  if (!detectedSourceFolder) {
    if (typeof showStatus === 'function') showStatus('対象ファイルのソースフォルダを確認できませんでした', true);
    return false;
  }
  if (detectedSourceFolder !== _chatSourceFolderValue()) {
    const switched = await _chatSwitchSourceFolderForOpen(detectedSourceFolder);
    if (!switched) return false;
    if (!restoreStillCurrent()) return false;
  }
  if (typeof _chatSetCurrentTargetPath === 'function') _chatSetCurrentTargetPath(targetPath, 'file', { reason: 'open-file-chat' });
  openRightPanelTab('chat');
  if (restoreGuard && typeof GBChatRestore !== 'undefined' && typeof GBChatRestore.runInternal === 'function') {
    GBChatRestore.runInternal(() => switchChatMode('llm'));
  } else {
    switchChatMode('llm');
  }
  const liveMessagesContainer = await _chatWaitForLiveMessagesContainer();
  if (!liveMessagesContainer) {
    if (typeof showStatus === 'function') showStatus('チャット表示を準備中です', true);
    return false;
  }
  if (!restoreStillCurrent()) return false;
  if (typeof _chatBumpSessionGen === 'function') _chatBumpSessionGen();
  if (typeof _chatClearPendingAttachments === 'function') {
    _chatClearPendingAttachments({ cleanupUploads: true });
  } else {
    _chatState.pendingAttachments = [];
    if (typeof _renderChatAttachments === 'function') _renderChatAttachments();
  }

  // _chat/llm/ 内からtargetPathが一致するチャットを検索
  let restored = false;
  try {
    const chatItems = await window.GBChatStorageContext.fetchHistory('/chat/list');
    if (!restoreStillCurrent()) return false;
    for (const item of (chatItems || [])) {
      if (item.targetPath !== targetPath || !item.path) continue;
      const data = await window.GBChatStorageContext.fetchHistory('/chat/load?path=' + encodeURIComponent(item.path));
      if (data.messages?.length > 0) {
        if (!restoreStillCurrent()) return false;
        _chatState.messages = _ensureChatMessageIds(data.messages);
        _chatState.sessionId = (item.path.split('/').pop() || '').replace('.md', '');
        _chatState.historySourceFolder = window.GBChatStorageContext.peekHistory()?.sourceFolder || '';
        _chatState.versionTargetPath = String(data.versionTargetPath || item.versionTargetPath || '');
        _chatState.targetPath = targetPath;
        _chatState.lastImplicitTargetPath = '';
        if (typeof _chatRestoreSessionTargets === 'function') _chatRestoreSessionTargets(data.frontmatter || { targetPath });
        _setChatSessionTitle(data.frontmatter?.title || item.title || '');
        if (data.frontmatter?.provider) {
          _chatState.provider = data.frontmatter.provider;
          _safeSetValue('chat-provider', data.frontmatter.provider);
          updateChatModels();
          if (data.frontmatter.model) {
            _chatState.model = data.frontmatter.model;
            _safeSetValue('chat-model', data.frontmatter.model);
          }
        }
        const container = _chatLiveMessagesContainer();
        if (container) container.innerHTML = '';
        _chatState.messages.forEach((m, index) => {
          chatAddMessage(m.role, m.content, _chatMessageRenderOptions(m, index));
        });
        restored = true;
        break;
      }
    }
  } catch { /* 一覧復元失敗時は旧方式にフォールバック */ }

  if (!restored) {
    try {
      const historyContext = await window.GBChatStorageContext.resolveForHistory();
      const llmBrowsePath = historyContext.sourceFolder.replace(/[\\/]+$/, '') + '/_chat/llm';
      const items = await apiFetch('/browse?path=' + encodeURIComponent(llmBrowsePath) + '&sort=modified&order=desc');
      if (!restoreStillCurrent()) return false;
      for (const item of (items || [])) {
        try {
          const data = await window.GBChatStorageContext.fetchHistory('/chat/load?path=' + encodeURIComponent(item.path));
          if (data.frontmatter?.targetPath === targetPath && data.messages?.length > 0) {
            if (!restoreStillCurrent()) return false;
            // 一致するセッションを復元
            _chatState.messages = _ensureChatMessageIds(data.messages);
            _chatState.sessionId = item.name.replace('.md', '');
            _chatState.historySourceFolder = historyContext.sourceFolder;
            _chatState.versionTargetPath = String(data.versionTargetPath || '');
            _chatState.targetPath = targetPath;
            _chatState.lastImplicitTargetPath = '';
            if (typeof _chatRestoreSessionTargets === 'function') _chatRestoreSessionTargets(data.frontmatter || { targetPath });
            _setChatSessionTitle(data.frontmatter?.title || '');
            if (data.frontmatter.provider) {
              _chatState.provider = data.frontmatter.provider;
              _safeSetValue('chat-provider', data.frontmatter.provider);
              updateChatModels();
              if (data.frontmatter.model) {
                _chatState.model = data.frontmatter.model;
                _safeSetValue('chat-model', data.frontmatter.model);
              }
            }
            const container = _chatLiveMessagesContainer();
            if (container) container.innerHTML = '';
            _chatState.messages.forEach((m, index) => {
              chatAddMessage(m.role, m.content, _chatMessageRenderOptions(m, index));
            });
            restored = true;
            break;
          }
        } catch { continue; }
      }
    } catch (e) { /* 検索失敗 */ }
  }

  if (!restored) {
    // チャットが存在しない → 作成ボタンを表示
    _chatState.messages = [];
    _chatState.sessionId = '';
    _chatState.targetPath = targetPath;
    _chatState.lastImplicitTargetPath = '';
    _setChatSessionTitle('');
    const container = _chatLiveMessagesContainer();
    if (container) {
      container.innerHTML = '';
      const fileName = targetPath.split('/').pop();
      const placeholder = document.createElement('div');
      placeholder.className = 'chat-empty-placeholder';
      placeholder.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;padding:24px;color:var(--fg2);';
      const label = document.createElement('div');
      label.style.cssText = 'font-size:13px;margin-bottom:12px;';
      label.textContent = `「${fileName}」のチャットはまだありません`;
      const createBtn = document.createElement('button');
      createBtn.type = 'button';
      createBtn.dataset.e2eId = 'chat-empty-create-btn';
      createBtn.setAttribute('aria-label', 'チャットを作成');
      createBtn.style.cssText = 'min-height:44px;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:6px 16px;background:var(--accent);color:var(--ui-accent-fg, var(--ui-fg-strong));border:none;border-radius:4px;cursor:pointer;font-size:13px;';
      createBtn.innerHTML = (typeof lucide === 'function' ? lucide('messagesSquare', 14) : '') + ' チャットを作成';
      createBtn.addEventListener('click', () => _createFileChat(targetPath));
      placeholder.append(label, createBtn);
      container.appendChild(placeholder);
    }
  }

  if (!restoreStillCurrent()) return false;
  _showChatTargetBadge(targetPath);
  _chatRevealLatest('llm');
  return true;
  } finally {
    if (showOpenLoading) hideLoading(loading);
  }
}

function _createFileChat(targetPath) {
  _chatState.messages = [];
  if (typeof _chatResetTargetForNewSession === 'function') _chatResetTargetForNewSession();
  _chatState.sessionId = '';
  _chatState.targetPath = targetPath;
  _chatState.lastImplicitTargetPath = '';
  if (typeof _chatSetCurrentTargetPath === 'function') _chatSetCurrentTargetPath(targetPath, 'file', { reason: 'create-file-chat' });
  if (typeof _chatClearPendingAttachments === 'function') {
    _chatClearPendingAttachments({ cleanupUploads: true });
  } else {
    _chatState.pendingAttachments = [];
  }
  if (!_chatState.streaming && typeof _chatClearQueuedMessages === 'function') _chatClearQueuedMessages();
  else if (typeof _chatPersistQueuedMessages === 'function') _chatPersistQueuedMessages();
  _setChatSessionTitle('');
  const container = _chatLiveMessagesContainer();
  if (container) container.innerHTML = '';
  const fileName = targetPath.split('/').pop();
  chatAddSystem(`「${fileName}」のチャットを作成しました`);
  _showChatTargetBadge(targetPath);
}

function _showChatTargetBadge(targetPath) {
  const badge = _chatLiveElement('chat-target-badge', { allowHidden: true });
  if (!badge) return;
  const label = badge.querySelector('#chat-current-target-path') || badge.querySelector('[data-chat-current-target-path]');
  const icon = badge.querySelector('[data-chat-current-target-icon]');
  const clearButton = badge.querySelector('[data-chat-target-clear]');
  const pickerButton = badge.querySelector('[data-chat-target-pick]');
  const targets = typeof _chatEffectiveTargets === 'function' ? _chatEffectiveTargets({ targetPath: String(targetPath || '') }) : [];
  const pathText = targets.map(item => item.path).join('\n');
  if (pathText) {
    const normalized = typeof _chatNormalizePath === 'function' ? _chatNormalizePath(pathText) : pathText;
    const targetKind = _chatState.currentTargetKind || (_chatState.targetPath ? 'file' : '');
    if (icon) icon.innerHTML = typeof lucide === 'function' ? lucide(targetKind === 'file' ? 'fileText' : 'folder', 12) : '';
    if (label) {
      if (typeof _chatRenderTargetLabels === 'function') _chatRenderTargetLabels(label, targets);
      else { label.textContent = normalized; label.title = normalized; }
    } else {
      badge.textContent = normalized;
    }
    badge.dataset.empty = '0';
    badge.style.display = 'flex';
  } else {
    if (typeof _chatTargetDisplayGeneration !== 'undefined') _chatTargetDisplayGeneration++;
    if (icon) icon.innerHTML = typeof lucide === 'function' ? lucide('circleSlash2', 12) : '';
    if (label) {
      label.textContent = '対象なし';
      label.title = '対象なしでもAIチャットを利用できます';
    } else {
      badge.textContent = '対象なし';
    }
    badge.dataset.empty = '1';
    badge.style.display = 'flex';
  }
  if (clearButton) {
    clearButton.disabled = !pathText || !!_chatState.streaming;
    clearButton.setAttribute('aria-disabled', clearButton.disabled ? 'true' : 'false');
  }
  if (pickerButton) {
    pickerButton.disabled = !!_chatState.streaming;
    pickerButton.setAttribute('aria-disabled', pickerButton.disabled ? 'true' : 'false');
  }
}

function _chatScrollToMessage(msgId) {
  const id = String(msgId || '').trim();
  if (!id) return;
  const safeId = MeldexEscape.cssIdent(id);
  const target = document.querySelector(`#chat-messages [data-msg-id="${safeId}"]`);
  if (!target) return;
  target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  target.style.outline = '2px solid var(--accent)';
  target.style.outlineOffset = '2px';
  target.style.transition = 'outline-color 0.3s ease';
  setTimeout(() => { target.style.outlineColor = 'transparent'; }, 1500);
  setTimeout(() => { target.style.outline = ''; target.style.outlineOffset = ''; target.style.transition = ''; }, 1900);
}

// 保存済みチャットを開いてリプレイ＋続行
async function openSavedChat(path, anchor = '', sourceFolder) {
  const restoreGuard = typeof GBChatRestore !== 'undefined' && typeof GBChatRestore.restoreGuard === 'function'
    ? GBChatRestore.restoreGuard()
    : null;
  const restoreStillCurrent = () => !restoreGuard || restoreGuard();
  const showOpenLoading = typeof showLoading === 'function' && typeof hideLoading === 'function';
  const loading = showOpenLoading ? showLoading('チャットを読み込み中...', { key: 'saved-chat:' + path }) : null;
  try {
  if (typeof _chatAbortActiveStreamForNavigation === 'function') _chatAbortActiveStreamForNavigation();
  const hashIndex = String(path || '').indexOf('#');
  if (hashIndex >= 0) {
    anchor = anchor || String(path).slice(hashIndex + 1);
    path = String(path).slice(0, hashIndex);
  }
  const rootedHistoryPath = /^(?:[a-z]:[\\/]|\/)/i.test(path)
    || (!String(path).startsWith('_chat/') && String(path).replace(/\\/g, '/').includes('/_chat/'));
  const historyContext = await window.GBChatStorageContext.resolveForHistory();
  const homeHistoryPrefix = _chatNormalizePath(historyContext.sourceFolder) + '/_chat/llm/';
  const isRootedHomeHistory = _chatNormalizePath(path).startsWith(homeHistoryPrefix);
  // The reference selector may omit Home while listing another source. Its
  // relative-path fallback must not override the known history storage root.
  const inferredSourceFolder = sourceFolder === undefined && rootedHistoryPath
    ? (isRootedHomeHistory ? historyContext.sourceFolder : _detectSourceFolderFromPath(path)) : '';
  const explicitSourceFolder = String(sourceFolder || inferredSourceFolder || '');
  const legacySource = explicitSourceFolder && _chatNormalizePath(explicitSourceFolder) !== _chatNormalizePath(historyContext.sourceFolder);
  if (legacySource && explicitSourceFolder !== _chatSourceFolderValue()) {
    const switched = await _chatSwitchSourceFolderForOpen(explicitSourceFolder, { skipSave: true });
    if (!switched) return false;
    if (!restoreStillCurrent()) return false;
  } else if (legacySource) {
    const detectedSourceFolder = _detectSourceFolderFromPath(path);
    const currentTarget = typeof _chatTargetSelectorValue === 'function' ? _chatTargetSelectorValue() : _chatSourceFolderValue();
    if (detectedSourceFolder && detectedSourceFolder !== currentTarget) {
      const switched = await _chatSwitchSourceFolderForOpen(detectedSourceFolder, { skipSave: true });
      if (!switched) return false;
      if (!restoreStillCurrent()) return false;
    }
  }
  if (legacySource && !_chatRequireSourceFolder()) return false;
  openRightPanelTab('chat');
  if (restoreGuard && typeof GBChatRestore !== 'undefined' && typeof GBChatRestore.runInternal === 'function') {
    GBChatRestore.runInternal(() => switchChatMode('llm'));
  } else {
    switchChatMode('llm');
  }
  const liveMessagesContainer = await _chatWaitForLiveMessagesContainer();
  if (!liveMessagesContainer) {
    if (typeof showStatus === 'function') showStatus('チャット表示を準備中です', true);
    return false;
  }
  if (!restoreStillCurrent()) return false;
  if (typeof _chatBumpSessionGen === 'function') _chatBumpSessionGen();
  if (typeof _chatClearPendingAttachments === 'function') {
    _chatClearPendingAttachments({ cleanupUploads: true });
  } else {
    _chatState.pendingAttachments = [];
    if (typeof _renderChatAttachments === 'function') _renderChatAttachments();
  }
  // 直接 fetch して status を判定（404 を他のエラーと区別するため apiFetch は使わない）
  let data = null;
  let notFound = false;
  let otherError = null;
  try {
    const user = (typeof getUsername === 'function') ? getUsername() : '';
    let url = (typeof API_BASE !== 'undefined' ? API_BASE : '/api') + '/chat/load?path=' + encodeURIComponent(path);
    const sourceFolderParam = legacySource ? _chatSourceFolderValue() : historyContext.sourceFolder;
    const workspaceIdParam = legacySource && typeof _chatWorkspaceIdValue === 'function' ? _chatWorkspaceIdValue() : '';
    if (workspaceIdParam) url += '&workspace_id=' + encodeURIComponent(workspaceIdParam);
    if (sourceFolderParam) url += '&source_folder=' + encodeURIComponent(sourceFolderParam);
    if (user && user !== 'anonymous') url += '&_user=' + encodeURIComponent(user);
    const res = await fetch(url);
    if (res.status === 404) {
      notFound = true;
    } else if (!res.ok) {
      otherError = new Error('HTTP ' + res.status + ': ' + res.statusText);
    } else {
      data = await res.json();
    }
  } catch (e) {
    otherError = e;
  }

  if (!restoreStillCurrent()) return false;
  if (notFound) {
    // 404フォールバック: 存在しないチャット → 穏やかに通知してリセット
    _chatState.messages = [];
    _chatState.sessionId = '';
    _chatState.versionTargetPath = '';
    _chatState.targetPath = '';
    _chatState.lastImplicitTargetPath = '';
    _chatState.versionTargetPath = '';
    window.MeldexChatCurrentTarget?.restore?.({ mode: 'detached', path: '', kind: '' });
    _setChatSessionTitle('');
    const container = _chatLiveMessagesContainer();
    if (container) container.innerHTML = '';
    _showChatTargetBadge('');
    // localStorage に残った古い savedPath 参照を除去
    try {
      const STORAGE_KEY = 'gb:last-chat-session';
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          // 該当 savedPath と一致する場合のみクリア（他チャットを誤って消さない）
          const legacySaved = '_chat/llm/' + (path.split('/').pop() || '');
          const targetSaved = _chatSavedPathForSession((path.split('/').pop() || '').replace(/\.md$/, ''));
          const matchesMissingPath = value => value === path || value === targetSaved || value === legacySaved;
          let changed = false;
          if (matchesMissingPath(parsed.savedPath)) {
            delete parsed.savedPath;
            changed = true;
          }
          if (parsed.ai && typeof parsed.ai === 'object' && matchesMissingPath(parsed.ai.savedPath)) {
            parsed.ai.savedPath = '';
            changed = true;
          }
          if (changed) {
            parsed.savedAt = Date.now();
            localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
          }
        }
      }
    } catch {}
    const fileName = (path || '').split('/').pop() || '';
    chatAddSystem('チャット履歴が見つかりませんでした' + (fileName ? '（' + fileName + '）' : '') + '。新しいチャットを開始するか、履歴タブから既存のチャットを選んでください。');
    if (typeof showStatus === 'function') showStatus('チャット履歴が見つかりませんでした');
    if (typeof renderChatHistory === 'function') renderChatHistory();
    return false;
  }

  if (otherError) {
    // 既存の挙動を維持（ネットワーク障害・5xx等はエラー表示）
    if (typeof showStatus === 'function') showStatus('チャット読み込みに失敗', true);
    return false;
  }

  if (!restoreStillCurrent()) return false;
  _chatState.messages = _ensureChatMessageIds(data.messages || []);
  // セッションIDをファイル名から復元
  const fname = path.split('/').pop().replace('.md', '');
  _chatState.sessionId = fname;
  _chatState.historySourceFolder = legacySource ? explicitSourceFolder : historyContext.sourceFolder;
  _chatState.versionTargetPath = String(data.versionTargetPath || '');
  _chatState.targetPath = data.frontmatter?.targetPath || '';
  _chatState.lastImplicitTargetPath = '';
  if (typeof _chatRestoreSessionTargets === 'function') {
    _chatRestoreSessionTargets(data.frontmatter || {});
  } else if (_chatState.targetPath && typeof _chatSetCurrentTargetPath === 'function') {
    _chatSetCurrentTargetPath(_chatState.targetPath, 'file', { reason: 'open-saved-chat' });
  } else {
    window.MeldexChatCurrentTarget?.restore?.({ mode: 'detached', path: '', kind: '' });
  }
  _setChatSessionTitle(data.frontmatter?.title || '');
  if (data.frontmatter?.provider) {
    _chatState.provider = data.frontmatter.provider;
    _safeSetValue('chat-provider', data.frontmatter.provider);
    updateChatModels();
    if (data.frontmatter.model) {
      _chatState.model = data.frontmatter.model;
      _safeSetValue('chat-model', data.frontmatter.model);
    }
  }
  // メッセージをレンダリング
  const container = _chatLiveMessagesContainer();
  if (container) container.innerHTML = '';
  if (typeof _chatRefreshCurrentTargetDisplay === 'function') _chatRefreshCurrentTargetDisplay();
  else _showChatTargetBadge(_chatState.targetPath);
  chatAddSystem('保存済みチャットを読み込みました。');
  _chatState.messages.forEach((m, index) => {
    if (m.role === 'user') chatAddMessage('user', m.content, _chatMessageRenderOptions(m, index));
    else chatAddMessage('assistant', m.content, _chatMessageRenderOptions(m, index));
  });
  if (anchor) _chatScrollToMessage(anchor);
  else _chatRevealLatest('llm');
  return true;
  } finally {
    if (showOpenLoading) hideLoading(loading);
  }
}

function chatClear() {
  if (typeof _chatBumpSessionGen === 'function') _chatBumpSessionGen();
  _chatState.messages = [];
  _chatState.sessionId = '';
  _chatState.versionTargetPath = '';
  _chatState.targetPath = '';
  _chatState.lastImplicitTargetPath = '';
  if (typeof _chatResetTargetForNewSession === 'function') _chatResetTargetForNewSession();
  _chatState.versionTargetPath = '';
  if (typeof _chatClearPendingAttachments === 'function') {
    _chatClearPendingAttachments({ cleanupUploads: true });
  } else {
    _chatState.pendingAttachments = [];
  }
  if (typeof _chatCleanupDraftUploads === 'function') _chatCleanupDraftUploads('chat-input', { force: true });
  if (!_chatState.streaming && typeof _chatClearQueuedMessages === 'function') _chatClearQueuedMessages();
  else if (typeof _chatPersistQueuedMessages === 'function') _chatPersistQueuedMessages();
  if (typeof _renderChatAttachments === 'function') _renderChatAttachments();
  _setChatSessionTitle('');
  const container = _chatLiveMessagesContainer();
  if (container) container.innerHTML = '';
  _showChatTargetBadge(typeof _chatEffectiveTargetPath === 'function' ? _chatEffectiveTargetPath() : '');
  chatAddSystem('新しいチャットを開始しました');
  renderChatHistory();
}

// セッションIDを生成/取得
function _ensureSessionId() {
  if (!_chatState.sessionId) {
    _chatState.sessionId = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19) + '_' + Math.random().toString(36).substring(2, 6);
  }
  return _chatState.sessionId;
}

// 自動保存（毎回のアシスタント応答後に呼ばれる）
async function chatAutoSave(options = {}) {
  const silent = options?.silent !== false;
  const messages = Array.isArray(options?.messages) ? options.messages : _chatState.messages;
  const savingCurrentSession = messages === _chatState.messages;
  if (messages.length === 0 && !options?.allowEmpty) return false;
  const hasSessionId = Object.prototype.hasOwnProperty.call(options || {}, 'sessionId');
  const hasSessionTitle = Object.prototype.hasOwnProperty.call(options || {}, 'sessionTitle');
  const hasTargetPath = Object.prototype.hasOwnProperty.call(options || {}, 'targetPath');
  const hasProvider = Object.prototype.hasOwnProperty.call(options || {}, 'provider');
  const hasModel = Object.prototype.hasOwnProperty.call(options || {}, 'model');
  if (savingCurrentSession && !hasSessionTitle) _captureChatSessionTitleFromInput();
  _ensureChatMessageIds(messages);
  let sid = hasSessionId ? String(options.sessionId || '') : String(_chatState.sessionId || '');
  if (!sid && savingCurrentSession) sid = _ensureSessionId();
  if (messages.length === 0 && options?.allowEmpty && !sid) return false;
  if (!sid) return false;
  const sessionTitle = hasSessionTitle ? String(options.sessionTitle || '') : (_chatState.sessionTitle || '');
  const targetPath = hasTargetPath
    ? String(options.targetPath || '')
    : (typeof _chatEffectiveTargetPath === 'function'
      ? String(_chatEffectiveTargetPath() || '')
      : String(_chatState.currentTargetPath || _chatState.targetPath || _chatState.lastImplicitTargetPath || ''));
  const targets = !savingCurrentSession && !Array.isArray(options.targets) ? undefined
    : (typeof _chatEffectiveTargets === 'function' ? _chatEffectiveTargets({ ...options, targetPath }) : []);
  const provider = hasProvider ? options.provider : _chatState.provider;
  const model = hasModel ? options.model : _chatState.model;
  let storageContext;
  try {
    storageContext = await window.GBChatStorageContext.resolveForHistory();
  } catch (error) {
    if (!silent) throw error;
    return false;
  }
  const sourceFolder = String(storageContext?.sourceFolder || '');
  const workspaceId = String(storageContext?.workspaceId || '');
  if (!sourceFolder && !workspaceId) {
    if (!silent) throw new Error('AIチャットの保存先を準備できませんでした。ホームフォルダ設定を確認してください');
    return false;
  }
  // 全チャットを _chat/llm/ に統一保存（ファイル紐づきもセッションの一つ）
  const savePath = _chatSavedPathForSession(sid);
  try {
    const knowledgeAutomation = typeof _chatKnowledgeAutomationForSave === 'function'
      ? await _chatKnowledgeAutomationForSave()
      : null;
    const result = await apiPost('/chat/save', _chatPostPayload({
      path: savePath,
      messages,
      provider,
      model,
      title: sessionTitle,
      tags: targetPath ? [targetPath] : [],
      targetPath,
      targets,
      source_folder: sourceFolder,
      workspace_id: workspaceId,
      user: typeof getUsername === 'function' ? getUsername() : '',
      ...(knowledgeAutomation ? { knowledge_automation: knowledgeAutomation } : {}),
    }));
    if (savingCurrentSession) {
      _chatState.historySourceFolder = sourceFolder;
      _chatState.versionTargetPath = String(result?.versionTargetPath || _chatState.versionTargetPath || '');
      _chatState.lastAutoVersionCreated = !!result?.autoVersionCreated;
      _chatState.lastAutoVersionName = String(result?.autoVersionName || '');
    }
    return true;
  } catch (e) {
    if (!silent) throw e;
    return false;
  }
}

function _chatExportTitle() {
  _captureChatSessionTitleFromInput();
  return _chatState.sessionTitle || _chatFallbackTitle(_chatState.sessionId, _chatState.targetPath) || 'チャット';
}

function _chatYamlQuote(value) {
  return JSON.stringify(String(value ?? ''));
}

function _chatHtmlEscape(value) {
  return MeldexEscape.html(value);
}

async function openCurrentChatVersions() {
  if (!_chatState.messages.length) {
    if (typeof showStatus === 'function') showStatus('版を表示するチャットがありません', true);
    return false;
  }
  const saved = await chatAutoSave({ silent: false });
  const path = String(_chatState.versionTargetPath || '');
  if (!saved || !path) {
    if (typeof showStatus === 'function') showStatus('チャットを保存してからバージョン管理を開いてください', true);
    return false;
  }
  if (typeof openVersionTab !== 'function') {
    if (typeof showStatus === 'function') showStatus('バージョン管理を開けませんでした', true);
    return false;
  }
  openVersionTab(path, 'file');
  return true;
}

(function _installChatVersionButton() {
  const install = () => {
    if (document.querySelector('[data-chat-version-button]')) return;
    const title = document.getElementById('chat-title-combo');
    const header = title?.parentElement;
    if (!header) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gb-btn gb-btn-xs';
    button.dataset.chatVersionButton = '';
    button.dataset.e2eId = 'chat-open-version-history';
    button.title = 'このチャットのバージョン管理';
    button.setAttribute('aria-label', 'このチャットのバージョン管理');
    button.innerHTML = typeof lucide === 'function' ? lucide('gitBranch', 12) : '版';
    button.addEventListener('click', async () => {
      try {
        await openCurrentChatVersions();
      } catch (error) {
        if (typeof showStatus === 'function') {
          showStatus('チャットのバージョン管理を開けませんでした: ' + (error?.message || error), true);
        }
      }
    });
    title.insertAdjacentElement('afterend', button);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();

window.MeldexChatVersionTarget = Object.freeze({
  async flushVersionTarget(path) {
    const normalize = value => String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
    if (!normalize(path) || normalize(path) !== normalize(_chatState.versionTargetPath)) return false;
    return !!(await chatAutoSave({ silent: false }));
  },
  async reloadVersionTarget(path) {
    const normalize = value => String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
    if (!normalize(path) || normalize(path) !== normalize(_chatState.versionTargetPath) || !_chatState.sessionId) return false;
    return !!(await openSavedChat(
      _chatSavedPathForSession(_chatState.sessionId),
      '',
      _chatState.historySourceFolder || (await window.GBChatStorageContext.resolveForHistory()).sourceFolder,
    ));
  },
});

function _chatExportRoleLabel(message) {
  const role = String(message?.role || '').toLowerCase();
  if (role === 'user') return typeof getUsername === 'function' ? getUsername() : 'User';
  if (role === 'assistant') return getProviderLabel(message?.provider || _chatState.provider, message?.model || _chatState.model);
  return role || 'Message';
}

function _chatExportTimestamp(message) {
  return String(message?.timestamp || message?.created_at || message?.createdAt || message?.time || '').trim();
}
