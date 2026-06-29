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
        ...chatGenerationSettings(),
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
        sourceFolder: streamSourceFolder,
        workspaceId: streamWorkspaceId,
        provider: streamProvider,
        model: streamModel,
      }).then(() => { if (typeof renderChatHistory === 'function') renderChatHistory(); });
    } else if (streamVisibleInCurrentChat()) {
      chatAddSystem('エラー: ' + (e?.message || e));
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
      if (streamCompleted && typeof _chatSendQueuedMessagesAfterStream === 'function') {
        setTimeout(() => {
          _chatSendQueuedMessagesAfterStream({
            messages: streamMessages,
            sessionId: streamSessionId,
            sessionTitle: streamSessionTitle,
            targetPath: streamTargetPath,
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
  let prompt = `${intro}

Meldexはマンガ・小説・脚本・ゲーム・音楽・映像・ブログ・学術論文など、創作全般を補助する統合ワークスペースです。ユーザーのソースフォルダ内のノート、シート、シナリオ、ボード、チャット履歴、ナレッジ層を参照し、既存情報と矛盾しない提案・整理・作成を行ってください。

## あなたの役割

1. **ナレッジに基づいた応答**: search_knowledge/search/read_file/read_database/browseでソースフォルダを調査し、既存のナレッジに整合した提案をする
2. **積極的な創作物の作成**: ユーザーが「シナリオを作って」「キャラクターシートを作って」「構想ボードを作って」等と依頼したら、Meldexの機能を駆使して**実際にファイルを作成**する（ノート/シナリオ/ボードはwrite_file、シートはcreate_sheet→set_property_type→create_entity→add_valueを使う）
3. **最適な機能の選択**: 内容に応じて、どのMeldex機能（シナリオ/シート/ボード/カレンダー/通常のMarkdownノート）が最適かを判断し、ユーザーに説明しつつ作成する
4. **ジャンル中立**: ユーザーの創作ジャンルや用途を勝手に限定せず、依頼内容と既存ナレッジから判断する

## ナレッジの多層構造

Meldexのチャットでは、次の層を矛盾なく扱ってください。

1. **ソースフォルダ Skills**: \`_skills/\` 配下の専門ルール。必要なら load_skill(name) で本文を読む。ユーザー定義ルールより優先。
2. **ユーザー定義ルール**: ルールボタンで管理される個人ルール。Skillsと矛盾しない範囲で尊重する。
3. **ナレッジ層**: 過去チャットから抽出された fact / decision / preference / correction / team_consensus。関連項目は自動注入され、追加で search_knowledge(query) でも探せる。ただし自動注入ナレッジは参考情報であり、存在確認・場所確認・作成更新完了の証拠にはしない。
4. **ステータス別ポリシー**: 掲載済み・確定など canonical 扱いの項目は変更不可。内部確定は矛盾させない。調整可能項目はユーザー指示があれば提案・変更できる。
5. **ファイル検索層**: read_project_overview を最初に呼び、search(query) は既定で現在の対象フォルダ内を検索する。対象外の確認が必要な場合だけ scope: source / roots / all を明示し、必要に応じて read_file / read_database / read_*_context で原文または構造化contextを読む。
6. **現在のコンテキスト**: ユーザーが開いているファイル、添付、直近メッセージ。上位ルールや canonical と矛盾する場合は、矛盾を報告する。

ナレッジ層の項目を修正する場合、ユーザーが明確に訂正・固定・解除を求めたときだけ update_knowledge を使ってください。canonical や保護された項目は勝手に上書きしないでください。

## Meldex の主要機能と使い分け

### 1. シナリオ (.scriptnote.json)
脚本・セリフ構成・小説のプロット・対話形式のコンテンツに使用。
**形式（JSON）**:
\`\`\`json
{
  "title": "タイトル",
  "rows": [
    {"id":"r1","pageSetting":"めくり","character":"","text":""},
    {"id":"r2","pageSetting":"","character":"","text":"シーン見出しやト書きなど"},
    {"id":"r3","pageSetting":"","character":"登場人物名","text":"セリフ内容"}
  ],
  "settings": {"modeName":"小説","viewMode":"horizontal"}
}
\`\`\`
- **pageSetting**: 改ページ系制御（"めくり"/"改ページ"/"シーン見出し"/"柱"など、空文字も可）
- **character**: 発話者名（"ト書き"/"プロット"等の特殊値もあり）
- **text**: セリフまたは説明文
- modeName候補: "マンガ脚本" / "映像脚本" / "小説" / "舞台脚本" / "ゲームシナリオ" 等。ユーザーの用途に合わせて選ぶ
- idは任意のユニークID（短いランダム文字列）

### 2. シート (構造化エントリ)
キャラクター設定・用語集・アイテム一覧・楽曲リスト・参考文献・タスク管理など、**複数のエントリを構造化して管理**するもの全般に使用。
**新形式の構造**:
\`\`\`
シートフォルダ/
  シートフォルダ.md          ← type: settings-db（新規シートはエントリ実体をSQLiteに保存）
  エントリ名.md              ← エントリ操作用の論理パス（物理ファイルとは限らない）
\`\`\`
- set_property_type で列/型/リレーションを設定 → create_entity でエントリ作成 → add_value でプロパティ値を追加
- 新形式シートで add_value を使うときは、create_entity の戻り値 path（例: \`キャラ表/主人公.md\`）を folder_path に使う。シートフォルダだけを folder_path に渡さない。エントリ名指定で更新する場合は db_path + entity を使う
- プロパティ型・選択肢・リレーション・数式・ロールアップは set_property_type で設定する。フォームビューの項目/必須/ラベルは configure_form_view、公開フォーム送信は configure_public_form で設定する
- 「追加しました」「登録しました」と言う前に read_database で対象シートを読み、目的のエントリとプロパティ値が実際に返っていることを確認する
- プロパティ値のstatus: "案"/"採用"/"ボツ"/"掲載済み" 等
- 旧形式のエントリフォルダにも対応しているが、新規作成では新形式を優先
- タイムラインは独立ファイルではなく、date型プロパティを持つ通常シートのビュー。開始日/終了日/状態などを set_property_type で整え、必要に応じてUI操作でビュー設定する
- キャラクター表を作る場合は、年齢・誕生日・身長・体格・カップサイズ・体重・B/W/Hなど、テンプレートの数式/プロパティを欠落させない

### 3. ボード (.mel-board / 既存 .board.md)
マインドマップ・構想図・ストーリーボード・組織図・フローチャート・年表・関係図など、**カードとラインで視覚化**する情報に使用。
新規作成では .mel-board を優先する。既存 .board.md は互換形式として読み書きできる。
**形式（Markdownフロントマター + 見出しカード）**:
\`\`\`markdown
---
type: board
ids:
  "主人公": "n1"
  "ライバル": "n2"
positions:
  "主人公": {x: 100, y: 100}
  "ライバル": {x: 300, y: 100}
sizes:
  "主人公": {w: 160, h: 72}
  "ライバル": {w: 160, h: 72}
connections:
  - {from: "主人公", to: "ライバル", label: "対立", arrow: "end"}
---
# 主人公
目標と悩み

# ライバル
対立軸
\`\`\`
- cards を nodes 配列だけに詰め込まない。positions / ids / sizes と本文の見出しカードを合わせて作る。リンクカードやスタイル情報を追加する場合も、既存ファイルの構造を読んでから壊さず更新する

### 4. スマートシート (.smart-db.json)
複数シートの横断ビュー・絞り込み・ダッシュボードに使用。実データ本体ではなく、参照元とビュー設定を持つJSON。
**基本構造**:
\`\`\`json
{
  "type": "smart-db",
  "title": "スマートシート名",
  "sources": [{"kind": "sheet", "path": "Characters"}],
  "views": [],
  "activeView": "table"
}
\`\`\`
- 通常シートに入れるべきエントリを .smart-db.json に直接書かない。先に create_sheet / create_entity / add_value で元シートを作る

### 5. カレンダーDB
イベント・スケジュール・締切管理・学習計画など、**日時情報を伴う管理**に使用。
read_databaseで取得可能（calendar_db: trueフラグあり）。

### 6. 通常のMarkdownノート (.md)
上記に当てはまらない自由記述（世界観設定・あらすじ・エッセイ・注釈・ドキュメント等）。

## ツール（Function Calling）

- **read_file(path)**: ファイル内容を読み取る
- **write_file(path, content)**: ファイルに書き込む（新規/上書き）。フロントマターは維持
- **create_sheet(path, title)**: シート本体を作成する。キャラ表、用語集、一覧表などのシート作成依頼では、最初にこれを使う
- **create_entity(parent_path, name)**: シートにエントリを作成。戻り値 path を add_value の folder_path に使う
- **set_property_type(db_path, property, type, ...)**: シートのプロパティ型・選択肢・リレーション・数式・ロールアップを設定
- **add_value(folder_path, property, value, status)**: エントリにプロパティ値を追加。新形式では create_entity の戻り値 path または db_path + entity を指定
- **configure_form_view(db_path, fields, required, ...)**: ブラウザ側のフォームビュー項目・必須・ラベル・説明を設定
- **configure_public_form(db_path, enabled, ...)**: 公開フォーム送信設定を保存
- **search(query)**: 全文検索
- **browse(path)**: フォルダ内一覧（空でルート）
- **read_database(path)**: DBの全エントリ・プロパティを一括取得
- **read_db_audit_log(path, since, until, ...)**: 編集履歴と変更レコードを読み、誰がいつ何を変えたかを確認する
- **create_folder(path, name)**: フォルダ作成
- **rename(path, new_name)**: リネーム
- **delete(path)**: ゴミ箱に移動
- **load_skill(name)**: ソースフォルダ Skills の本文を読み込む
- **search_knowledge(query, limit)**: 過去チャットから抽出されたナレッジを検索する
- **update_knowledge(id, ...)**: ナレッジ項目を訂正・固定・解除する
- **add_debug_report(...)**: ユーザーが明示的に不具合報告を依頼したときだけ使う
- **llm_list_ui_controls(query, include_hidden, limit)**: 現在のMeldex画面にある操作可能なUI要素をselector付きで一覧する。オプションパネルのポップアップ内のチェックボックスやドロップダウンも、表示後にこのツールで確認する
- **llm_ui_action(selector, action, value, checked, path, label)**: Meldex UIを実際に操作する。actionは click / set_value / set_checked / toggle / select / contextmenu / focus。selectorが不明な時はlabelでラベル検索できる。設定変更はUndo/Redoとヒストリーに記録される

## ツール実行の事実性ルール

- ファイル、フォルダ、シート、ノート、パス、Meldex UI、ナレッジ項目、記憶、ルール、設定の存在確認・中身確認・作成・更新・登録・リネーム・削除・移動・保存について、ツール結果なしに「確認しました」「存在します」「作成しました」「登録しました」「リネーム完了です」などと断言しない
- 自動注入されたナレッジ、会話履歴、要約、推測は存在確認・場所確認・更新完了の証拠ではない。確認手段がない場合は、確認できないと答える
- 存在確認や場所確認を求められたら、browse/read_file/read_database/read_db_audit_log/search_knowledge/load_skill/llm_list_ui_controls のいずれかを実行し、返ってきた tool_result に基づいて答える。search は候補発見用であり、存在確認の最終証拠として単独では使わない
- シートの編集履歴に関する質問（「いつ誰が直したか」「最近変更されたセル」「先週の修正一覧」等）には、必ず read_db_audit_log を呼ぶ。read_database で現在値を見ても誰がいつ変えたかは分からない。時間範囲が曖昧な場合（「最近」「先週」等）は適切な since / until を補完し、結果が 0 件なら推測せず履歴がないと答える。
- 作成・更新・リネーム・削除・移動・保存を求められたら、write_file/create_sheet/create_entity/add_value/set_property_type/configure_public_form/configure_form_view/create_folder/rename/delete/update_knowledge/add_debug_report/llm_ui_action の tool_result が ok であることを確認してから完了報告する
- ツール結果がエラー、空、未実行、または対象不一致の場合は、成功したように言わず、確認できなかった事実と次に必要な操作だけを短く伝える

## Meldex機能の詳細解説について

ユーザーがMeldexの使い方・機能・操作手順について質問した場合、**マニュアルフォルダ** \`MeldexHome/マニュアル/\` の該当ドキュメントをread_fileで読んでから解説してください。推測で答えず、マニュアルに基づいた正確な情報を提供してください。

主なマニュアル:
- **Meldex マニュアル.md** / **01_はじめに/クイックスタート.md** / **01_はじめに/画面の見方.md** / **01_はじめに/UI用語ガイド.md**
- **02_ツール別ガイド/フォルダツリー マニュアル.md** / **ノートエディタ マニュアル.md** / **シナリオエディタ マニュアル.md** / **シート マニュアル.md** / **スマートシート マニュアル.md**
- **02_ツール別ガイド/ボード マニュアル.md** / **カレンダー マニュアル.md** / **オプションパネル マニュアル.md** / **パネルレイアウト マニュアル.md** / **バージョン管理 マニュアル.md**
- **03_設定と連携/LLM設定.md** / **03_設定と連携/チャットLLM ツールガイド.md** / **03_設定と連携/LLMプライバシーガイド.md**
- **03_設定と連携/Chrome拡張機能の設定.md** / **CalDAVカレンダー同期の設定.md** / **画像ツールの設定.md** / **スマホ・タブレットからの利用.md**
- **04_サポート/よくある質問.md** / **トラブルシューティング集.md** / **既知の不具合.md** / **スクリーンショットの撮り方.md** / **ショートカット一覧/**

機能名・用語はマニュアル内の正式名称に従い、古い呼称（台本、データベース、メモ等）をユーザー向け説明に使わないでください。

## デバッグ・テスト支援

ユーザーがMeldexのテスター・バグ報告者として作業している場合、以下をサポート。関連情報は **04_サポート/トラブルシューティング集.md** や **04_サポート/既知の不具合.md** を参照。

### Meldex-QA 共有フォルダの構成
- \`テストケース/\` — テスト項目マスターDB（読み取り専用として扱う）
- \`テスト実績/\` — テスト結果記録先DB（テスターが書き込む）
- \`バグ報告/\` — バグ報告蓄積DB（タスクトレイの常駐アプリから自動送信される）
- \`テストデータ/\` — テスト用サンプルファイル群

### バグ報告作成支援
ユーザーが症状を説明したら、**良いバグ報告**の形式に整える手伝いをする:
- 操作手順（1-2-3の具体的ステップ）
- 実際に起きた症状（事実ベース、「おかしい」等の主観表現を避ける）
- 期待結果との差
- 再現性（毎回/条件付き/1回のみ）
- 環境（OS・ブラウザ・Meldexバージョン）

重要度判定: 致命的（クラッシュ・データ消失）/ 高（主要機能不可）/ 中（不便）/ 低（細かい不具合）

### テストケース作成支援
ユーザーが新機能のテストケースを考える際、以下の観点でリストアップ:
- 正常系（期待通りの操作）
- 異常系（想定外の入力・エラー処理）
- 境界値（最大/最小/ゼロ/空）
- 並行操作（複数の作業領域・複数ユーザー）
- UI確認（表示崩れ・レスポンシブ）

テストケースDBへの登録は create_entity + add_value で可能。

### テスト実績の集計支援
read_databaseで \`Meldex-QA/テスト実績/\` を読み、以下を提供:
- 機能別NG件数 / 未実行テストケース一覧
- テスター別進捗 / NG→修正済み再テスト未完了項目

### 既存バグとの重複チェック
新規の症状報告の前に、searchで \`Meldex-QA/バグ報告/\` を検索し類似報告がないか確認する。

## 作業指針

1. **まず調査**: 新規作成の依頼でも、まずsearch/browseで既存の関連ナレッジを確認し、整合性を取る
2. **形式を選択**: 依頼内容から最適な機能（シナリオ/シート/ボード/ノート）を選び、理由をユーザーに説明してから作成する
3. **実作成の確認**: 「作成しました」「登録しました」「完成しました」と言う前に、write_file / create_sheet / set_property_type / create_entity / add_value / configure_form_view / configure_public_form のツール結果が ok であることを確認し、必要なら browse/read_file/read_database でリンク先の存在を確認する。存在確認できないリンクを完成物として提示しない
4. **段階的提案**: 大規模な作成（シナリオ全体・シート全体）の前に、構成案・キャラクター案・章立て等をテキストで提示し、ユーザーの了承を得てから実ファイルを作成する
5. **既存の尊重**: 既存ファイルを大きく変更する場合は、read_fileで現状を確認し、差分をユーザーに示してから書き込む
6. **フロントマター保全**: .mdファイルの先頭にある\`---\`で囲まれたYAMLフロントマターは絶対に壊さない
7. **保護ファイル**: editor-config.json / .env.chat / _users.json / _permissions.json は編集不可
8. **ジャンル中立**: ユーザーの創作ジャンル（マンガ・小説・学術・ビジネス文書等）を勝手に決めつけず、依頼内容と既存ナレッジから判断する
9. **マニュアル参照**: 機能質問にはマニュアルを読んで正確に答える。憶測で答えない
10. **Meldex UI操作**: ユーザーがアプリ操作を依頼したら、必要に応じて llm_list_ui_controls で対象を確認し、llm_ui_action で操作する。ポップアップ内の細かいチェックボックスやドロップダウンも対象にする。クリックでポップアップを開いた後、必要なら再度 llm_list_ui_controls を使って内部のUIを確認する。selectorが見つからない場合だけlabel検索を使う
11. **編集ロック厳守**: ロック中のファイル/フォルダに対する編集・リネーム・削除・移動・保存・値追加は絶対に実行しない。UI操作で編集対象がある場合は path を付け、ツール結果がロックエラーならそこで停止してユーザーに報告する
`;

  // コンテキストバーにある添付ファイルのパスを追加
  const contextBar = document.getElementById('chat-context-bar');
  if (contextBar && contextBar.children.length > 0) {
    prompt += '\n## 現在のコンテキスト（ユーザーが開いているファイル）\n';
    Array.from(contextBar.querySelectorAll('.chat-context-item')).forEach(el => {
      prompt += '- ' + el.dataset.path + '\n';
    });
  }

  // 現在開いているビューの情報を追加
  if (state.currentPagePath) prompt += `\n現在開いているページ: ${state.currentPagePath}\n`;
  if (state.currentDbPath) prompt += `現在開いているシート: ${state.currentDbPath}\n`;
  if (state.currentBoardPath) prompt += `現在開いているボード: ${state.currentBoardPath}\n`;
  const currentTarget = typeof _chatCurrentOpenTarget === 'function' ? _chatCurrentOpenTarget() : { path: '' };
  if (currentTarget.path && currentTarget.path !== promptTargetPath) prompt += `現在開いている対象: ${currentTarget.path}\n`;

  if (window.GBMeldexLlmOperations?.promptSummary) {
    const uiSummary = window.GBMeldexLlmOperations.promptSummary();
    if (uiSummary) prompt += '\n' + uiSummary + '\n';
  }

  // 対象がある場合、ファイル/フォルダ情報を強調
  if (promptTargetPath) {
    prompt += `\n## このチャットの現在の対象\nパス: ${promptTargetPath}\nこのチャットはこのファイルまたはフォルダに関する会話です。内容を参照する場合、ファイルならread_file、フォルダならbrowse/search/read_project_overviewを使ってください。\n`;
  }

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
  if (showOpenLoading) showLoading('チャットを読み込み中...');
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
    const chatItems = await apiFetch(_chatApiPath('/chat/list'));
    if (!restoreStillCurrent()) return false;
    for (const item of (chatItems || [])) {
      if (item.targetPath !== targetPath || !item.path) continue;
      const data = await apiFetch(_chatApiPath('/chat/load?path=' + encodeURIComponent(item.path)));
      if (data.messages?.length > 0) {
        if (!restoreStillCurrent()) return false;
        _chatState.messages = _ensureChatMessageIds(data.messages);
        _chatState.sessionId = (item.path.split('/').pop() || '').replace('.md', '');
        _chatState.targetPath = targetPath;
        _chatState.lastImplicitTargetPath = '';
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
      const llmBrowsePath = _chatSourceFolderValue()
        ? (_chatSourceFolderValue().replace(/[\\/]+$/, '') + '/_chat/llm')
        : '_chat/llm';
      const items = await apiFetch('/browse?path=' + encodeURIComponent(llmBrowsePath) + '&sort=modified&order=desc');
      if (!restoreStillCurrent()) return false;
      for (const item of (items || [])) {
        try {
          const data = await apiFetch(_chatApiPath('/chat/load?path=' + encodeURIComponent(item.path)));
          if (data.frontmatter?.targetPath === targetPath && data.messages?.length > 0) {
            if (!restoreStillCurrent()) return false;
            // 一致するセッションを復元
            _chatState.messages = _ensureChatMessageIds(data.messages);
            _chatState.sessionId = item.name.replace('.md', '');
            _chatState.targetPath = targetPath;
            _chatState.lastImplicitTargetPath = '';
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
      createBtn.style.cssText = 'padding:6px 16px;background:var(--accent);color:var(--ui-fg-strong);border:none;border-radius:4px;cursor:pointer;font-size:13px;';
      createBtn.innerHTML = (typeof lucide === 'function' ? lucide('messagesSquare', 14) : '') + ' チャットを作成';
      createBtn.addEventListener('click', () => _createFileChat(targetPath));
      placeholder.append(label, createBtn);
      container.appendChild(placeholder);
    }
  }

  if (!restoreStillCurrent()) return false;
  _showChatTargetBadge(targetPath);
  return true;
  } finally {
    if (showOpenLoading) hideLoading();
  }
}

function _createFileChat(targetPath) {
  _chatState.messages = [];
  _chatState.sessionId = '';
  _chatState.targetPath = targetPath;
  _chatState.lastImplicitTargetPath = '';
  if (typeof _chatSetCurrentTargetPath === 'function') _chatSetCurrentTargetPath(targetPath, 'file', { reason: 'create-file-chat' });
  if (typeof _chatClearPendingAttachments === 'function') {
    _chatClearPendingAttachments({ cleanupUploads: true });
  } else {
    _chatState.pendingAttachments = [];
  }
  if (typeof _chatClearQueuedMessages === 'function') _chatClearQueuedMessages();
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
  const pathText = String(targetPath || '').trim();
  if (pathText) {
    const normalized = typeof _chatNormalizePath === 'function' ? _chatNormalizePath(pathText) : pathText;
    const targetKind = _chatState.currentTargetKind || (_chatState.targetPath ? 'file' : '');
    if (icon) icon.innerHTML = typeof lucide === 'function' ? lucide(targetKind === 'file' ? 'fileText' : 'folder', 12) : '';
    if (label) {
      label.textContent = normalized;
      label.title = normalized;
    } else {
      badge.textContent = normalized;
    }
    badge.dataset.empty = '0';
    badge.style.display = 'flex';
  } else {
    if (icon) icon.innerHTML = typeof lucide === 'function' ? lucide('folder', 12) : '';
    if (label) {
      label.textContent = '未選択';
      label.title = 'フォルダツリーで対象を選択してください';
    } else {
      badge.textContent = '未選択';
    }
    badge.dataset.empty = '1';
    badge.style.display = 'flex';
  }
}

function _chatScrollToMessage(msgId) {
  const id = String(msgId || '').trim();
  if (!id) return;
  const safeId = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&');
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
  if (showOpenLoading) showLoading('チャットを読み込み中...');
  try {
  if (typeof _chatAbortActiveStreamForNavigation === 'function') _chatAbortActiveStreamForNavigation();
  const hashIndex = String(path || '').indexOf('#');
  if (hashIndex >= 0) {
    anchor = anchor || String(path).slice(hashIndex + 1);
    path = String(path).slice(0, hashIndex);
  }
  const explicitSourceFolder = String(sourceFolder || '');
  if (sourceFolder !== undefined && explicitSourceFolder && explicitSourceFolder !== _chatSourceFolderValue()) {
    const switched = await _chatSwitchSourceFolderForOpen(explicitSourceFolder, { skipSave: true });
    if (!switched) return false;
    if (!restoreStillCurrent()) return false;
  } else {
    const detectedSourceFolder = _detectSourceFolderFromPath(path);
    const currentTarget = typeof _chatTargetSelectorValue === 'function' ? _chatTargetSelectorValue() : _chatSourceFolderValue();
    if (detectedSourceFolder && detectedSourceFolder !== currentTarget) {
      const switched = await _chatSwitchSourceFolderForOpen(detectedSourceFolder, { skipSave: true });
      if (!switched) return false;
      if (!restoreStillCurrent()) return false;
    }
  }
  if (!_chatRequireSourceFolder()) return false;
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
    const sourceFolderParam = _chatSourceFolderValue();
    const workspaceIdParam = typeof _chatWorkspaceIdValue === 'function' ? _chatWorkspaceIdValue() : '';
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
    _chatState.targetPath = '';
    _chatState.lastImplicitTargetPath = '';
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
        if (parsed && typeof parsed === 'object' && parsed.savedPath) {
          // 該当 savedPath と一致する場合のみクリア（他チャットを誤って消さない）
          const legacySaved = '_chat/llm/' + (path.split('/').pop() || '');
          const targetSaved = _chatSavedPathForSession((path.split('/').pop() || '').replace(/\.md$/, ''));
          if (parsed.savedPath === path || parsed.savedPath === targetSaved || parsed.savedPath === legacySaved) {
            delete parsed.savedPath;
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
  _chatState.targetPath = data.frontmatter?.targetPath || '';
  _chatState.lastImplicitTargetPath = '';
  if (_chatState.targetPath && typeof _chatSetCurrentTargetPath === 'function') {
    _chatSetCurrentTargetPath(_chatState.targetPath, 'file', { reason: 'open-saved-chat' });
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
  _showChatTargetBadge(_chatState.targetPath);
  chatAddSystem('保存済みチャットを読み込みました。');
  _chatState.messages.forEach((m, index) => {
    if (m.role === 'user') chatAddMessage('user', m.content, _chatMessageRenderOptions(m, index));
    else chatAddMessage('assistant', m.content, _chatMessageRenderOptions(m, index));
  });
  if (anchor) _chatScrollToMessage(anchor);
  return true;
  } finally {
    if (showOpenLoading) hideLoading();
  }
}

function chatClear() {
  if (typeof _chatBumpSessionGen === 'function') _chatBumpSessionGen();
  _chatState.messages = [];
  _chatState.sessionId = '';
  _chatState.targetPath = '';
  _chatState.lastImplicitTargetPath = '';
  if (typeof _chatClearPendingAttachments === 'function') {
    _chatClearPendingAttachments({ cleanupUploads: true });
  } else {
    _chatState.pendingAttachments = [];
  }
  if (typeof _chatCleanupDraftUploads === 'function') _chatCleanupDraftUploads('chat-input', { force: true });
  if (typeof _chatClearQueuedMessages === 'function') _chatClearQueuedMessages();
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
  const hasSourceFolder = Object.prototype.hasOwnProperty.call(options || {}, 'sourceFolder');
  const hasWorkspaceId = Object.prototype.hasOwnProperty.call(options || {}, 'workspaceId');
  if (savingCurrentSession && !hasSessionTitle) _captureChatSessionTitleFromInput();
  _ensureChatMessageIds(messages);
  let sid = hasSessionId ? String(options.sessionId || '') : String(_chatState.sessionId || '');
  if (!sid && savingCurrentSession) sid = _ensureSessionId();
  if (messages.length === 0 && options?.allowEmpty && !sid) return false;
  if (!sid) return false;
  const sessionTitle = hasSessionTitle ? String(options.sessionTitle || '') : (_chatState.sessionTitle || '');
  const targetPath = hasTargetPath ? String(options.targetPath || '') : String((typeof _chatEffectiveTargetPath === 'function' ? _chatEffectiveTargetPath() : '') || _chatState.currentTargetPath || _chatState.targetPath || _chatState.lastImplicitTargetPath || '');
  const provider = hasProvider ? options.provider : _chatState.provider;
  const model = hasModel ? options.model : _chatState.model;
  const sourceFolder = hasSourceFolder ? String(options.sourceFolder || '') : _chatSourceFolderValue();
  const workspaceId = hasWorkspaceId ? String(options.workspaceId || '') : (hasSourceFolder ? '' : (typeof _chatWorkspaceIdValue === 'function' ? _chatWorkspaceIdValue() : ''));
  if (!sourceFolder && !workspaceId) {
    if (!silent) throw new Error('フォルダツリーで対象フォルダまたはファイルを選択してください');
    return false;
  }
  // 全チャットを _chat/llm/ に統一保存（ファイル紐づきもセッションの一つ）
  const savePath = _chatSavedPathForSession(sid);
  try {
    const knowledgeAutomation = typeof _chatKnowledgeAutomationForSave === 'function'
      ? await _chatKnowledgeAutomationForSave()
      : null;
    await apiPost('/chat/save', _chatPostPayload({
      path: savePath,
      messages,
      provider,
      model,
      title: sessionTitle,
      tags: targetPath ? [targetPath] : [],
      targetPath,
      source_folder: sourceFolder,
      workspace_id: workspaceId,
      user: typeof getUsername === 'function' ? getUsername() : '',
      ...(knowledgeAutomation ? { knowledge_automation: knowledgeAutomation } : {}),
    }));
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
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _chatExportRoleLabel(message) {
  const role = String(message?.role || '').toLowerCase();
  if (role === 'user') return typeof getUsername === 'function' ? getUsername() : 'User';
  if (role === 'assistant') return getProviderLabel(message?.provider || _chatState.provider, message?.model || _chatState.model);
  return role || 'Message';
}

function _chatExportTimestamp(message) {
  return String(message?.timestamp || message?.created_at || message?.createdAt || message?.time || '').trim();
}
