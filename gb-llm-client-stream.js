(function () {
  'use strict';

  function _providerKey(provider) {
    return String(provider || '').trim().toLowerCase() || 'gemini';
  }

  function _friendlyProviderErrorMessage(value) {
    const text = String(value || '').trim();
    const lower = text.toLowerCase();
    if (lower.includes('insufficient_quota') || lower.includes('exceeded your current quota')) {
      return 'OpenAI APIの利用枠または請求設定の上限に達しています。Meldex内の使用額表示とは別に、OpenAI Platform側のクレジット・請求設定・利用上限を確認してください。';
    }
    if (lower.includes('rate_limit') || lower.includes('rate limit')) {
      return 'AIサービス側の短時間の利用制限に達しました。少し時間を置いてから再送信してください。';
    }
    return text;
  }

  function _messageText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map(part => {
        if (!part || typeof part !== 'object') return '';
        if (part.type === 'text') return String(part.text || '');
        const name = part.name || part.path || part.url || part.mimeType || part.type || 'attachment';
        return `[${part.type === 'document' ? 'PDF' : '添付'}: ${name}]`;
      }).filter(Boolean).join('\n');
    }
    return String(content || '');
  }

  function _chatMessages(body) {
    return (Array.isArray(body?.messages) ? body.messages : [])
      .filter(message => message && (message.role === 'user' || message.role === 'assistant'))
      .map(message => ({ role: message.role, text: _messageText(message.content) }))
      .filter(message => message.text);
  }

  function _generationNumber(body, key, fallback, min, max) {
    const value = Number(body?.[key]);
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, value));
  }

  function _requestFlag(body, key, defaultValue) {
    if (!body || !(key in body)) return !!defaultValue;
    const value = body[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      return !['', '0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
    }
    return !!value;
  }

  function _reasoningLevel(body) {
    const value = String(body?.reasoning_level || 'off').trim().toLowerCase();
    return ['off', 'standard', 'max'].includes(value) ? value : 'off';
  }

  function _reasoningBudget(level) {
    return level === 'max' ? 16000 : 2000;
  }

  function _anthropicThinkingLimits(level, maxTokens) {
    const adjustedMax = Math.max(2048, Math.floor(Number(maxTokens) || 8192));
    const budget = Math.min(_reasoningBudget(level), adjustedMax - 1024);
    return {
      maxTokens: adjustedMax,
      budgetTokens: Math.max(1024, budget),
    };
  }

  function _cloneChatMessage(message) {
    if (!message || typeof message !== 'object') return message;
    const clone = { ...message };
    if (Array.isArray(message.content)) {
      clone.content = message.content.map(part => (part && typeof part === 'object') ? { ...part } : part);
    }
    return clone;
  }

  function _fallbackCompressionSummary(messages) {
    const userLines = [];
    const assistantLines = [];
    (messages || []).forEach(message => {
      const text = _messageText(message?.content || '').trim().replace(/\s+/g, ' ');
      if (!text) return;
      if (message?.role === 'user' && userLines.length < 12) userLines.push('- ' + text.slice(0, 160));
      else if (message?.role === 'assistant' && assistantLines.length < 8) assistantLines.push('- ' + text.slice(0, 160));
    });
    const parts = ['これまでの会話の要約:'];
    if (userLines.length) parts.push('ユーザーの主な依頼:', ...userLines);
    if (assistantLines.length) parts.push('アシスタントの主な回答:', ...assistantLines);
    parts.push('以後の応答では、この要約と直近の会話を優先して文脈を引き継ぐ。');
    return parts.join('\n');
  }

  function _prepareClientStreamBody(body, send) {
    const source = body || {};
    const messages = Array.isArray(source.messages) ? source.messages : [];
    if (!_requestFlag(source, 'allow_auto_compress', false) || messages.length <= 50) return source;
    const keepCount = Math.max(4, Math.min(16, messages.length - 1));
    const oldMessages = messages.slice(0, messages.length - keepCount).map(message => ({
      ..._cloneChatMessage(message),
      compressed: true,
    }));
    const tailMessages = messages.slice(messages.length - keepCount).map(message => _cloneChatMessage(message));
    const summaryMessage = {
      role: 'assistant',
      content: _fallbackCompressionSummary(oldMessages),
      msg_id: 'summary_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      compressed_summary: true,
      original_message_count: oldMessages.length,
      original_messages: oldMessages,
    };
    send({
      type: 'compression',
      summary_message: summaryMessage,
      original_count: oldMessages.length,
      kept_count: tailMessages.length,
    });
    return { ...source, messages: [summaryMessage, ...tailMessages] };
  }

  function _sseResponse(start) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = payload => controller.enqueue(encoder.encode('data: ' + JSON.stringify(payload) + '\n\n'));
        try {
          await start(send);
          send({ type: 'done' });
        } catch (err) {
          send({ type: 'error', error: _friendlyProviderErrorMessage(err?.message || String(err)) });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  }

  async function _providerError(response) {
    let text = '';
    try {
      const data = await response.clone().json();
      text = data?.error?.message || data?.detail || data?.message || '';
    } catch {
      try { text = await response.text(); } catch {}
    }
    return _friendlyProviderErrorMessage(text || `HTTP ${response.status}`);
  }

  async function _readSse(response, onData) {
    if (!response.ok) throw new Error(await _providerError(response));
    if (!response.body) throw new Error('ストリームを開始できませんでした');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line.startsWith('data:')) continue;
        const dataText = line.slice(5).trim();
        if (!dataText || dataText === '[DONE]') continue;
        try { onData(JSON.parse(dataText)); } catch {}
      }
    }
  }

  function _defaultModel(provider, model) {
    if (model) return model;
    if (provider === 'anthropic') return 'claude-sonnet-4-6';
    if (provider === 'openai') return 'gpt-5.4-mini';
    return 'gemini-2.5-flash';
  }

  async function _streamAnthropic(body, apiKey, send, signal) {
    const model = _defaultModel('anthropic', body.model);
    const maxTokens = Math.floor(_generationNumber(body, 'max_tokens', 8192, 1024, 32768));
    const reasoningLevel = _reasoningLevel(body);
    const payload = {
      model,
      system: String(body.system_prompt || ''),
      messages: _chatMessages(body).map(message => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.text,
      })),
      max_tokens: maxTokens,
      stream: true,
    };
    if (reasoningLevel !== 'off') {
      const limits = _anthropicThinkingLimits(reasoningLevel, maxTokens);
      payload.max_tokens = limits.maxTokens;
      payload.thinking = { type: 'enabled', budget_tokens: limits.budgetTokens };
    } else {
      payload.temperature = _generationNumber(body, 'temperature', 0.7, 0, 1);
      if (Number.isFinite(Number(body.top_p))) payload.top_p = _generationNumber(body, 'top_p', 1, 0, 1);
    }
    const tools = [];
    if (_requestFlag(body, 'allow_web_search', true)) {
      tools.push({ type: 'web_search_20250305', name: 'web_search', max_uses: 5 });
    }
    if (_requestFlag(body, 'allow_code_execution', false)) {
      tools.push({ type: 'code_execution_20250522', name: 'code_execution' });
    }
    if (tools.length) payload.tools = tools;
    const handleData = data => {
      if (data.type === 'content_block_start' && data.content_block?.type === 'server_tool_use') {
        send({ type: 'code_exec_start', language: 'python', code: String(data.content_block.input || data.content_block.code || '') });
      }
      if (data.type === 'content_block_start' && data.content_block?.type === 'tool_use') {
        send({ type: 'tool_start', name: data.content_block.name || 'tool' });
      }
      if (data.type === 'content_block_start' && data.content_block?.type === 'code_execution_tool_result') {
        const result = data.content_block || {};
        const text = result.content || result.stdout || result.result || '';
        if (text) send({ type: 'code_exec_stdout', content: String(text) });
        send({ type: 'code_exec_done', exit_code: Number(result.exit_code || 0) || 0 });
      }
      if (data.type === 'content_block_delta' && data.delta?.text) send({ type: 'text_delta', content: data.delta.text });
      if (data.type === 'content_block_delta' && data.delta?.partial_json && _requestFlag(body, 'allow_code_execution', false)) {
        send({ type: 'code_exec_stdout', content: String(data.delta.partial_json) });
      }
      if (data.type === 'content_block_delta' && (data.delta?.thinking || data.delta?.summary)) {
        send({ type: 'thinking_delta', content: String(data.delta.thinking || data.delta.summary) });
      }
      if (data.type === 'message_delta' && data.usage) send({ type: 'usage', usage: data.usage });
    };
    const request = async () => {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        signal,
        body: JSON.stringify(payload),
      });
      await _readSse(res, handleData);
    };
    let lastError = null;
    for (let retry = 0; retry < 4; retry += 1) {
      try {
        await request();
        return;
      } catch (err) {
        lastError = err;
        const text = String(err?.message || err).toLowerCase();
        if (payload.tools?.some(tool => tool.type === 'code_execution_20250522') && text.includes('code')) {
          payload.tools = payload.tools.filter(tool => tool.type !== 'code_execution_20250522');
          if (!payload.tools.length) delete payload.tools;
          send({ type: 'internal_notice', content: 'このClaudeモデルはコード実行に未対応のため、コード実行なしで続行します。' });
          continue;
        }
        if (payload.tools?.some(tool => tool.type === 'web_search_20250305') && (text.includes('web_search') || text.includes('tool'))) {
          payload.tools = payload.tools.filter(tool => tool.type !== 'web_search_20250305');
          if (!payload.tools.length) delete payload.tools;
          send({ type: 'internal_notice', content: 'このClaudeモデルはWeb検索に未対応のため、検索なしで続行します。' });
          continue;
        }
        if (payload.thinking && (text.includes('thinking') || text.includes('budget') || text.includes('temperature'))) {
          delete payload.thinking;
          payload.temperature = _generationNumber(body, 'temperature', 0.7, 0, 1);
          if (Number.isFinite(Number(body.top_p))) payload.top_p = _generationNumber(body, 'top_p', 1, 0, 1);
          send({ type: 'internal_notice', content: 'このClaudeモデルは思考設定に未対応のため、思考設定なしで続行します。' });
          continue;
        }
        throw err;
      }
    }
    if (lastError) throw lastError;
  }

  function _openAiResponsesInput(body) {
    return _chatMessages(body).map(message => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: [{ type: 'input_text', text: message.text }],
    }));
  }

  async function _streamOpenAi(body, apiKey, send, signal) {
    const model = _defaultModel('openai', body.model);
    const messages = [];
    const system = String(body.system_prompt || '').trim();
    if (system) messages.push({ role: 'system', content: system });
    _chatMessages(body).forEach(message => {
      messages.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content: message.text });
    });
    const payload = {
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: _generationNumber(body, 'temperature', 0.7, 0, 2),
      max_tokens: Math.floor(_generationNumber(body, 'max_tokens', 8192, 1024, 32768)),
    };
    if (Number.isFinite(Number(body.top_p))) payload.top_p = _generationNumber(body, 'top_p', 1, 0, 1);
    const reasoningLevel = _reasoningLevel(body);
    if (reasoningLevel !== 'off') payload.reasoning_effort = reasoningLevel === 'max' ? 'high' : 'medium';
    const request = async () => {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
        },
        signal,
        body: JSON.stringify(payload),
      });
      await _readSse(res, data => {
        const delta = data.choices?.[0]?.delta?.content;
        if (delta) send({ type: 'text_delta', content: delta });
        if (data.usage) send({ type: 'usage', usage: data.usage });
      });
    };
    try {
      await request();
    } catch (err) {
      if (payload.reasoning_effort) {
        delete payload.reasoning_effort;
        send({ type: 'internal_notice', content: 'このOpenAIモデルは思考設定に未対応のため、思考設定なしで続行します。' });
        await request();
        return;
      }
      throw err;
    }
  }

  async function _streamOpenAiResponses(body, apiKey, send, signal) {
    const model = _defaultModel('openai', body.model);
    const tools = [];
    if (_requestFlag(body, 'allow_code_execution', false)) {
      tools.push({ type: 'code_interpreter', container: { type: 'auto' } });
    }
    if (_requestFlag(body, 'allow_web_search', true)) tools.push({ type: 'web_search_preview' });
    const payload = {
      model,
      instructions: String(body.system_prompt || ''),
      input: _openAiResponsesInput(body),
      stream: true,
      max_output_tokens: Math.floor(_generationNumber(body, 'max_tokens', 8192, 1024, 32768)),
    };
    if (tools.length) payload.tools = tools;
    if (Number.isFinite(Number(body.temperature))) payload.temperature = _generationNumber(body, 'temperature', 0.7, 0, 2);
    if (Number.isFinite(Number(body.top_p))) payload.top_p = _generationNumber(body, 'top_p', 1, 0, 1);
    const reasoningLevel = _reasoningLevel(body);
    if (reasoningLevel !== 'off') payload.reasoning = { effort: reasoningLevel === 'max' ? 'high' : 'medium' };
    let emittedCodeStart = false;
    let sawEvent = false;
    try {
      const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
        },
        signal,
        body: JSON.stringify(payload),
      });
      await _readSse(res, data => {
        sawEvent = true;
        const type = String(data?.type || '');
        if (type === 'response.output_text.delta' && data.delta) {
          send({ type: 'text_delta', content: String(data.delta) });
          return;
        }
        if (type === 'response.web_search_call.in_progress') send({ type: 'tool_start', name: 'web_search' });
        if (type.includes('code_interpreter')) {
          const delta = data.delta;
          const code = typeof delta === 'string' ? delta : (delta?.code || delta?.input || '');
          if (code && !emittedCodeStart) {
            emittedCodeStart = true;
            send({ type: 'code_exec_start', language: 'python', code: String(code) });
          }
          const outputs = Array.isArray(data.outputs) ? data.outputs : (data.output ? [data.output] : []);
          outputs.forEach(output => {
            if (!output || typeof output !== 'object') return;
            const text = output.text || output.logs || '';
            if (text) send({ type: 'code_exec_stdout', content: String(text) });
            const imageUrl = output.image_url || output.url || '';
            if (imageUrl) send({ type: 'code_exec_image', url: imageUrl, name: output.name || 'image.png' });
          });
        }
        if (type === 'response.completed') {
          if (emittedCodeStart) send({ type: 'code_exec_done', exit_code: 0 });
          const usage = data.usage || data.response?.usage || null;
          if (usage) send({ type: 'usage', usage });
        }
      });
    } catch (err) {
      if (sawEvent) throw err;
      send({ type: 'internal_notice', content: 'OpenAI Responses APIのネイティブ機能が利用できないため、通常チャットで続行します。' });
      return _streamOpenAi({ ...body, allow_code_execution: false, allow_web_search: false }, apiKey, send, signal);
    }
  }

  async function _streamGemini(body, apiKey, send, signal) {
    const model = _defaultModel('gemini', body.model);
    const contents = _chatMessages(body).map(message => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.text }],
    }));
    const payload = {
      contents,
      generationConfig: {
        temperature: _generationNumber(body, 'temperature', 0.7, 0, 2),
        maxOutputTokens: Math.floor(_generationNumber(body, 'max_tokens', 8192, 1024, 32768)),
      },
    };
    const system = String(body.system_prompt || '').trim();
    if (system) payload.systemInstruction = { parts: [{ text: system }] };
    if (Number.isFinite(Number(body.top_p))) payload.generationConfig.topP = _generationNumber(body, 'top_p', 1, 0, 1);
    const tools = [];
    if (_requestFlag(body, 'allow_web_search', true)) tools.push({ google_search: {} });
    if (_requestFlag(body, 'allow_code_execution', false)) tools.push({ code_execution: {} });
    if (tools.length) payload.tools = tools;
    const reasoningLevel = _reasoningLevel(body);
    if (reasoningLevel !== 'off') {
      payload.generationConfig.thinkingConfig = { thinkingBudget: _reasoningBudget(reasoningLevel) };
    }
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model)
      + ':streamGenerateContent?alt=sse&key=' + encodeURIComponent(apiKey);
    const handleData = data => {
      const parts = data.candidates?.[0]?.content?.parts || [];
      parts.forEach(part => {
        const executable = part?.executableCode || part?.executable_code;
        if (executable?.code) {
          send({ type: 'code_exec_start', language: String(executable.language || 'python').toLowerCase(), code: String(executable.code) });
        }
        const result = part?.codeExecutionResult || part?.code_execution_result;
        if (result) {
          if (result.output) send({ type: 'code_exec_stdout', content: String(result.output) });
          const outcome = String(result.outcome || '').toLowerCase();
          send({ type: 'code_exec_done', exit_code: !outcome || outcome === 'ok' || outcome === 'outcome_ok' ? 0 : 1 });
        }
      });
      const text = parts.map(part => part?.text || '').join('');
      if (text) send({ type: 'text_delta', content: text });
      const grounding = data.candidates?.[0]?.groundingMetadata || data.candidates?.[0]?.grounding_metadata;
      (grounding?.groundingChunks || grounding?.grounding_chunks || []).forEach(chunk => {
        const web = chunk?.web || chunk?.retrievedContext || chunk?.retrieved_context || {};
        if (web.uri) send({ type: 'citation', citation: { url: web.uri, title: web.title || web.uri, provider: 'gemini' } });
      });
      if (data.usageMetadata) send({ type: 'usage', usage: data.usageMetadata });
    };
    const request = async () => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify(payload),
      });
      await _readSse(res, handleData);
    };
    let lastError = null;
    for (let retry = 0; retry < 4; retry += 1) {
      try {
        await request();
        return;
      } catch (err) {
        lastError = err;
        const text = String(err?.message || err).toLowerCase();
        if (payload.tools?.some(tool => tool.code_execution) && (text.includes('code_execution') || text.includes('codeexecution'))) {
          payload.tools = payload.tools.filter(tool => !tool.code_execution);
          if (!payload.tools.length) delete payload.tools;
          send({ type: 'internal_notice', content: 'このGeminiモデルはコード実行に未対応のため、コード実行なしで続行します。' });
          continue;
        }
        if (payload.tools?.some(tool => tool.google_search) && (text.includes('google_search') || text.includes('tool'))) {
          payload.tools = payload.tools.filter(tool => !tool.google_search);
          if (!payload.tools.length) delete payload.tools;
          send({ type: 'internal_notice', content: 'このGeminiモデルはWeb検索に未対応のため、検索なしで続行します。' });
          continue;
        }
        if (payload.generationConfig?.thinkingConfig && (text.includes('thinking') || text.includes('budget'))) {
          delete payload.generationConfig.thinkingConfig;
          send({ type: 'internal_notice', content: 'このGeminiモデルは思考設定に未対応のため、思考設定なしで続行します。' });
          continue;
        }
        throw err;
      }
    }
    if (lastError) throw lastError;
  }

  async function streamChatAsResponse(body, options = {}) {
    const augmentedBody = await window.MeldexKnowledgePromptBuilder?.augmentChatBody?.(body || {}).catch(() => body) || body;
    const provider = _providerKey(augmentedBody?.provider);
    const apiKey = await window.MeldexLlmKeys?.getForProvider?.(provider);
    if (!apiKey) {
      return new Response(JSON.stringify({ detail: 'APIキーが未設定です。設定ダイアログのLLMタブで、この端末用のAPIキーを保存してください。' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return _sseResponse(async send => {
      const requestBody = _prepareClientStreamBody(augmentedBody, send);
      if (provider === 'anthropic') return _streamAnthropic(requestBody, apiKey, send, options.signal);
      if (provider === 'openai') {
        if (_requestFlag(requestBody, 'allow_code_execution', false) || _requestFlag(requestBody, 'allow_web_search', true)) {
          return _streamOpenAiResponses(requestBody, apiKey, send, options.signal);
        }
        return _streamOpenAi(requestBody, apiKey, send, options.signal);
      }
      return _streamGemini(requestBody, apiKey, send, options.signal);
    });
  }

  window.MeldexLlmClient = {
    streamChatAsResponse,
  };
})();
