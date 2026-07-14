(function () {
  'use strict';

  function _providerKey(provider) {
    return String(provider || '').trim().toLowerCase() || 'gemini';
  }

  function _friendlyProviderErrorMessage(value) {
    const text = String(value || '').trim();
    const lower = text.toLowerCase();
    if (
      lower.includes('invalid authentication') ||
      lower.includes('invalid api key') ||
      lower.includes('incorrect api key') ||
      lower.includes('api key is invalid') ||
      (lower.includes('401') && (lower.includes('auth') || lower.includes('unauthorized')))
    ) {
      return 'APIキーが無効、またはこのモデルを使う権限がありません。設定 > LLMで該当APIキーを保存し直し、モデルを選び直してから再送信してください。';
    }
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
        const name = _attachmentName(part);
        return `[${part.type === 'document' ? 'PDF' : '添付'}: ${name}]`;
      }).filter(Boolean).join('\n');
    }
    return String(content || '');
  }

  function _dataUrlParts(value) {
    const text = String(value || '');
    const match = /^data:([^;,]+)(;base64)?,(.*)$/i.exec(text);
    if (!match || !match[2]) return null;
    return {
      mimeType: match[1] || 'application/octet-stream',
      data: match[3] || '',
      dataUrl: text,
    };
  }

  function _attachmentDataUrl(part) {
    return String(part?.dataUrl || (String(part?.url || '').startsWith('data:') ? part.url : '') || '');
  }

  function _attachmentName(part) {
    return part?.name || part?.path || part?.url || part?.mimeType || part?.mime || part?.type || 'attachment';
  }

  function _messageParts(content) {
    if (typeof content === 'string') return [{ type: 'text', text: content }];
    if (!Array.isArray(content)) return [{ type: 'text', text: String(content || '') }];
    return content
      .filter(part => part != null)
      .map(part => (typeof part === 'object' ? { ...part } : { type: 'text', text: String(part || '') }));
  }

  function _chatMessages(body) {
    return (Array.isArray(body?.messages) ? body.messages : [])
      .filter(message => message && (message.role === 'user' || message.role === 'assistant'))
      .map(message => ({ role: message.role, text: _messageText(message.content), parts: _messageParts(message.content) }))
      .filter(message => message.text || message.parts.some(part => _attachmentDataUrl(part)));
  }

  function _anthropicContent(parts, fallbackText) {
    const result = [];
    (parts || []).forEach(part => {
      if (!part || typeof part !== 'object') return;
      if (part.type === 'text') {
        const text = String(part.text || '');
        if (text) result.push({ type: 'text', text });
        return;
      }
      const data = _dataUrlParts(_attachmentDataUrl(part));
      if (!data) {
        result.push({ type: 'text', text: `[${part.type === 'document' ? 'PDF' : '添付'}: ${_attachmentName(part)}]` });
        return;
      }
      if (part.type === 'document' || data.mimeType === 'application/pdf') {
        result.push({ type: 'document', source: { type: 'base64', media_type: data.mimeType, data: data.data }, title: String(part.name || 'document') });
        return;
      }
      if (String(data.mimeType || '').startsWith('image/')) {
        result.push({ type: 'image', source: { type: 'base64', media_type: data.mimeType, data: data.data } });
      }
    });
    if (!result.length && fallbackText) result.push({ type: 'text', text: fallbackText });
    return result.length === 1 && result[0].type === 'text' ? result[0].text : result;
  }

  function _openAiChatContent(parts, fallbackText) {
    const result = [];
    (parts || []).forEach(part => {
      if (!part || typeof part !== 'object') return;
      if (part.type === 'text') {
        const text = String(part.text || '');
        if (text) result.push({ type: 'text', text });
        return;
      }
      const data = _dataUrlParts(_attachmentDataUrl(part));
      if (data && String(data.mimeType || '').startsWith('image/')) {
        result.push({ type: 'image_url', image_url: { url: data.dataUrl } });
        return;
      }
      result.push({ type: 'text', text: `[${part.type === 'document' ? 'PDF' : '添付'}: ${_attachmentName(part)}]` });
    });
    if (!result.length && fallbackText) result.push({ type: 'text', text: fallbackText });
    return result.length === 1 && result[0].type === 'text' ? result[0].text : result;
  }

  function _openAiResponsesContent(parts, fallbackText) {
    const result = [];
    (parts || []).forEach(part => {
      if (!part || typeof part !== 'object') return;
      if (part.type === 'text') {
        const text = String(part.text || '');
        if (text) result.push({ type: 'input_text', text });
        return;
      }
      const data = _dataUrlParts(_attachmentDataUrl(part));
      if (data && String(data.mimeType || '').startsWith('image/')) {
        result.push({ type: 'input_image', image_url: data.dataUrl });
        return;
      }
      if (data && (part.type === 'document' || data.mimeType === 'application/pdf')) {
        result.push({ type: 'input_file', filename: String(part.name || 'document.pdf'), file_data: data.dataUrl });
        return;
      }
      result.push({ type: 'input_text', text: `[${part.type === 'document' ? 'PDF' : '添付'}: ${_attachmentName(part)}]` });
    });
    if (!result.length && fallbackText) result.push({ type: 'input_text', text: fallbackText });
    return result;
  }

  function _geminiParts(parts, fallbackText) {
    const result = [];
    (parts || []).forEach(part => {
      if (!part || typeof part !== 'object') return;
      if (part.type === 'text') {
        const text = String(part.text || '');
        if (text) result.push({ text });
        return;
      }
      const data = _dataUrlParts(_attachmentDataUrl(part));
      if (data) {
        result.push({ inlineData: { mimeType: data.mimeType, data: data.data } });
        return;
      }
      result.push({ text: `[${part.type === 'document' ? 'PDF' : '添付'}: ${_attachmentName(part)}]` });
    });
    if (!result.length && fallbackText) result.push({ text: fallbackText });
    return result;
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

  function _isAbortError(err) {
    return err?.name === 'AbortError' || String(err?.message || err || '').toLowerCase().includes('abort');
  }

  const CLIENT_USAGE_LOG_KEY = 'meldex-cloud-chat-usage-log';
  const CLIENT_BUDGET_KEY = 'meldex-cloud-chat-budget';
  const CLIENT_PRICE_PER_MILLION = {
    gemini: {
      default: { input: 0.30, output: 2.50, cache_read: 0.05, cache_write: 0.30 },
      'gemini-3': { input: 2.00, output: 12.00, cache_read: 0.20, cache_write: 2.00 },
      'gemini-2.5-pro': { input: 1.25, output: 10.00, cache_read: 0.31, cache_write: 1.25 },
      'gemini-2.5-flash-lite': { input: 0.10, output: 0.40, cache_read: 0.01, cache_write: 0.10 },
      'gemini-2.5-flash': { input: 0.30, output: 2.50, cache_read: 0.05, cache_write: 0.30 },
    },
    anthropic: {
      default: { input: 3.00, output: 15.00, cache_read: 0.30, cache_write: 3.75 },
      'claude-haiku': { input: 1.00, output: 5.00, cache_read: 0.10, cache_write: 1.25 },
      'claude-sonnet': { input: 3.00, output: 15.00, cache_read: 0.30, cache_write: 3.75 },
      'claude-opus': { input: 5.00, output: 25.00, cache_read: 0.50, cache_write: 6.25 },
    },
    openai: {
      default: { input: 0.75, output: 4.50, cache_read: 0.10, cache_write: 0.75 },
      'gpt-5.5': { input: 5.00, output: 30.00, cache_read: 0.50, cache_write: 5.00 },
      'gpt-5.4-mini': { input: 0.75, output: 4.50, cache_read: 0.10, cache_write: 0.75 },
      'gpt-5.4-nano': { input: 0.15, output: 0.90, cache_read: 0.03, cache_write: 0.15 },
      'gpt-5.4': { input: 2.50, output: 15.00, cache_read: 0.25, cache_write: 2.50 },
    },
  };

  function _priceRate(provider, model) {
    const table = CLIENT_PRICE_PER_MILLION[_providerKey(provider)] || {};
    const modelId = String(model || '').toLowerCase();
    for (const [prefix, rate] of Object.entries(table)) {
      if (prefix !== 'default' && modelId.startsWith(prefix)) return rate;
    }
    return table.default || { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  }

  function _usageTokens(usage) {
    const promptDetails = usage?.prompt_tokens_details || usage?.input_tokens_details || {};
    const cacheRead = Number(
      usage?.cache_read_tokens
      || usage?.cached_tokens
      || promptDetails.cached_tokens
      || usage?.cachedContentTokenCount
      || 0
    ) || 0;
    return {
      input: Number(usage?.input_tokens || usage?.prompt_tokens || usage?.promptTokenCount || 0) || 0,
      output: Number(usage?.output_tokens || usage?.completion_tokens || usage?.candidatesTokenCount || 0) || 0,
      cache_read: cacheRead,
      cache_write: Number(usage?.cache_write_tokens || 0) || 0,
    };
  }

  function _estimateCostUsd(provider, model, usage) {
    const tokens = _usageTokens(usage || {});
    const rate = _priceRate(provider, model);
    return Math.round((
      tokens.input * rate.input
      + tokens.output * rate.output
      + tokens.cache_read * rate.cache_read
      + tokens.cache_write * rate.cache_write
    ) / 1_000_000 * 100_000_000) / 100_000_000;
  }

  function _loadClientBudgetSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CLIENT_BUDGET_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function _loadClientUsageLog() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CLIENT_USAGE_LOG_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter(item => item && typeof item === 'object') : [];
    } catch {
      return [];
    }
  }

  function _saveClientUsageLog(log) {
    try {
      localStorage.setItem(CLIENT_USAGE_LOG_KEY, JSON.stringify((log || []).slice(-2000)));
    } catch {}
  }

  function _usageTotals(log, sessionId) {
    const now = Date.now();
    const dayStart = now - 24 * 60 * 60 * 1000;
    const monthStart = now - 30 * 24 * 60 * 60 * 1000;
    const empty = { cost_usd: 0, input_tokens: 0, output_tokens: 0 };
    const sum = (items) => items.reduce((acc, item) => ({
      cost_usd: acc.cost_usd + Number(item.estimated_cost_usd || 0),
      input_tokens: acc.input_tokens + Number(item.input_tokens || 0),
      output_tokens: acc.output_tokens + Number(item.output_tokens || 0),
    }), { ...empty });
    return {
      day: sum(log.filter(item => Number(item.timestamp || 0) >= dayStart)),
      month: sum(log.filter(item => Number(item.timestamp || 0) >= monthStart)),
      session: sum(log.filter(item => sessionId && item.session_id === sessionId)),
    };
  }

  function _estimatedInputTokens(body) {
    const text = _chatMessages(body).map(message => message.text || '').join('\n');
    return Math.max(1, Math.ceil(text.length / 4));
  }

  function _assertClientBudget(body, provider, model) {
    const settings = _loadClientBudgetSettings();
    const sessionId = String(body?.session_id || '');
    const projectedUsage = {
      input_tokens: _estimatedInputTokens(body),
      output_tokens: Math.floor(_generationNumber(body, 'max_tokens', 8192, 1024, 32768)),
    };
    const projectedCost = _estimateCostUsd(provider, model, projectedUsage);
    const totals = _usageTotals(_loadClientUsageLog(), sessionId);
    const checks = [
      ['daily', 'day', 'daily_budget_usd', 'daily_mode', '日次'],
      ['monthly', 'month', 'monthly_budget_usd', 'monthly_mode', '月次'],
      ['session', 'session', 'session_budget_usd', 'session_mode', 'セッション'],
    ];
    for (const [, totalKey, budgetKey, modeKey, label] of checks) {
      const budget = Number(settings[budgetKey] || 0);
      const mode = String(settings[modeKey] || 'hard');
      if (!budget || mode === 'off') continue;
      const next = Number(totals[totalKey]?.cost_usd || 0) + projectedCost;
      if (next >= budget && mode === 'hard') {
        const err = new Error(`${label}予算 $${budget.toFixed(2)} に達するため、LLM送信を停止しました`);
        err.meldexCode = 'chat_budget_exceeded';
        throw err;
      }
    }
  }

  function _recordClientUsage({ provider, model, usage, sessionId, source }) {
    const tokens = _usageTokens(usage || {});
    if (!tokens.input && !tokens.output && !tokens.cache_read && !tokens.cache_write) return null;
    const record = {
      timestamp: Date.now(),
      provider: _providerKey(provider),
      model: String(model || ''),
      session_id: String(sessionId || ''),
      source: String(source || 'cloud-client'),
      input_tokens: tokens.input,
      output_tokens: tokens.output,
      cache_read_tokens: tokens.cache_read,
      cache_write_tokens: tokens.cache_write,
      estimated_cost_usd: _estimateCostUsd(provider, model, usage),
    };
    const log = _loadClientUsageLog();
    log.push(record);
    _saveClientUsageLog(log);
    return record;
  }

  function clientBudgetStatus(sessionId = '') {
    const settings = _loadClientBudgetSettings();
    const totals = _usageTotals(_loadClientUsageLog(), String(sessionId || ''));
    return { settings, totals, cloud: true };
  }

  function resetClientUsage() {
    _saveClientUsageLog([]);
    return { ok: true, cloud: true };
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
        let errored = false;
        try {
          await start(send);
          send({ type: 'done' });
        } catch (err) {
          if (_isAbortError(err)) {
            errored = true;
            controller.error(err);
            return;
          }
          send({ type: 'error', error: _friendlyProviderErrorMessage(err?.message || String(err)) });
        } finally {
          if (!errored) controller.close();
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

  function _providerStreamError(data, eventType) {
    const type = String(data?.type || eventType || '').toLowerCase();
    const err = data?.error || data?.response?.error || data?.last_error || null;
    const message = err?.message || data?.message || data?.detail || data?.reason || '';
    if (type === 'error' || type.endsWith('.failed') || type.endsWith('.incomplete')) {
      return _friendlyProviderErrorMessage(message || type || 'ストリームエラー');
    }
    if (err && (err.message || err.type || err.code)) {
      return _friendlyProviderErrorMessage(err.message || err.type || err.code);
    }
    return '';
  }

  async function _readSse(response, onData) {
    if (!response.ok) throw new Error(await _providerError(response));
    if (!response.body) throw new Error('ストリームを開始できませんでした');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = '';
    let dataLines = [];
    const dispatch = () => {
      if (!dataLines.length) {
        eventType = '';
        return;
      }
      const dataText = dataLines.join('\n').trim();
      const currentEvent = eventType;
      eventType = '';
      dataLines = [];
      if (!dataText || dataText === '[DONE]') return;
      let data = null;
      try { data = JSON.parse(dataText); } catch { return; }
      const errorMessage = _providerStreamError(data, currentEvent);
      if (errorMessage) throw new Error(errorMessage);
      onData(data);
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line) {
          dispatch();
          continue;
        }
        if (line.startsWith('event:')) {
          eventType = line.slice(6).trim();
          continue;
        }
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
    }
    if (buffer.trim()) {
      const line = buffer.trimEnd();
      if (line.startsWith('event:')) eventType = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    dispatch();
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
        content: _anthropicContent(message.parts, message.text),
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
      content: _openAiResponsesContent(message.parts, message.text),
    }));
  }

  function _collectOpenAiAnnotations(data) {
    const result = [];
    const add = value => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(add);
        return;
      }
      result.push(value);
    };
    add(data?.annotation);
    add(data?.annotations);
    add(data?.item?.annotations);
    add(data?.output?.annotations);
    (data?.item?.content || []).forEach(part => add(part?.annotations));
    (data?.output?.content || []).forEach(part => add(part?.annotations));
    (data?.response?.output || []).forEach(item => (item?.content || []).forEach(part => add(part?.annotations)));
    return result;
  }

  function _sendOpenAiAnnotationCitations(data, send, seen) {
    _collectOpenAiAnnotations(data).forEach(annotation => {
      const citation = annotation.url_citation || annotation;
      const url = citation.url || citation.uri || '';
      if (!url || seen.has(url)) return;
      seen.add(url);
      send({ type: 'citation', citation: { url, title: citation.title || url, provider: 'openai' } });
    });
  }

  async function _streamOpenAi(body, apiKey, send, signal) {
    const model = _defaultModel('openai', body.model);
    const messages = [];
    const system = String(body.system_prompt || '').trim();
    if (system) messages.push({ role: 'system', content: system });
    _chatMessages(body).forEach(message => {
      messages.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content: _openAiChatContent(message.parts, message.text) });
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
    let sawResponseEvent = false;
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
        sawResponseEvent = true;
        const delta = data.choices?.[0]?.delta?.content;
        if (delta) send({ type: 'text_delta', content: delta });
        if (data.usage) send({ type: 'usage', usage: data.usage });
      });
    };
    let lastError = null;
    for (let retry = 0; retry < 6; retry += 1) {
      try {
        await request();
        return;
      } catch (err) {
        lastError = err;
        const text = String(err?.message || err).toLowerCase();
        if (sawResponseEvent) throw err;
        let changed = false;
        if (payload.reasoning_effort && (text.includes('reasoning') || text.includes('effort'))) {
          delete payload.reasoning_effort;
          send({ type: 'internal_notice', content: 'このOpenAIモデルは思考設定に未対応のため、思考設定なしで続行します。' });
          changed = true;
        } else if (payload.max_tokens && text.includes('max_tokens')) {
          payload.max_completion_tokens = payload.max_tokens;
          delete payload.max_tokens;
          send({ type: 'internal_notice', content: 'このOpenAIモデルのトークン上限指定に合わせて再送信します。' });
          changed = true;
        } else if (payload.max_completion_tokens && text.includes('max_completion_tokens')) {
          delete payload.max_completion_tokens;
          changed = true;
        } else if (payload.stream_options && text.includes('stream_options')) {
          delete payload.stream_options;
          changed = true;
        } else if (Object.prototype.hasOwnProperty.call(payload, 'temperature') && text.includes('temperature')) {
          delete payload.temperature;
          changed = true;
        } else if (Object.prototype.hasOwnProperty.call(payload, 'top_p') && text.includes('top_p')) {
          delete payload.top_p;
          changed = true;
        }
        if (changed) continue;
        throw err;
      }
    }
    if (lastError) throw lastError;
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
    const seenCitations = new Set();
    let sawResponseEvent = false;
    const request = async () => {
      let sawEvent = false;
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
        sawResponseEvent = true;
        const type = String(data?.type || '');
        _sendOpenAiAnnotationCitations(data, send, seenCitations);
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
      return sawEvent;
    };
    let lastError = null;
    for (let retry = 0; retry < 6; retry += 1) {
      try {
        await request();
        return;
      } catch (err) {
        lastError = err;
        const text = String(err?.message || err).toLowerCase();
        let changed = false;
        if (payload.tools?.some(tool => tool.type === 'code_interpreter') && (text.includes('code_interpreter') || text.includes('code'))) {
          payload.tools = payload.tools.filter(tool => tool.type !== 'code_interpreter');
          if (!payload.tools.length) delete payload.tools;
          send({ type: 'internal_notice', content: 'このOpenAIモデルはコード実行に未対応のため、コード実行なしで続行します。' });
          changed = true;
        } else if (payload.tools?.some(tool => tool.type === 'web_search_preview') && (text.includes('web_search') || text.includes('tool'))) {
          payload.tools = payload.tools.filter(tool => tool.type !== 'web_search_preview');
          if (!payload.tools.length) delete payload.tools;
          send({ type: 'internal_notice', content: 'このOpenAIモデルはWeb検索に未対応のため、検索なしで続行します。' });
          changed = true;
        } else if (payload.reasoning && (text.includes('reasoning') || text.includes('effort'))) {
          delete payload.reasoning;
          send({ type: 'internal_notice', content: 'このOpenAIモデルは思考設定に未対応のため、思考設定なしで続行します。' });
          changed = true;
        } else if (Object.prototype.hasOwnProperty.call(payload, 'temperature') && text.includes('temperature')) {
          delete payload.temperature;
          changed = true;
        } else if (Object.prototype.hasOwnProperty.call(payload, 'top_p') && text.includes('top_p')) {
          delete payload.top_p;
          changed = true;
        } else if (payload.max_output_tokens && text.includes('max_output_tokens')) {
          delete payload.max_output_tokens;
          changed = true;
        }
        if (changed) continue;
        send({ type: 'internal_notice', content: 'OpenAI Responses APIのネイティブ機能が利用できないため、通常チャットで続行します。' });
        return _streamOpenAi({ ...body, allow_code_execution: false, allow_web_search: false }, apiKey, send, signal);
      }
    }
    if (lastError) throw lastError;
  }

  async function _streamGemini(body, apiKey, send, signal) {
    const model = _defaultModel('gemini', body.model);
    const contents = _chatMessages(body).map(message => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: _geminiParts(message.parts, message.text),
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
      const model = _defaultModel(provider, requestBody.model);
      _assertClientBudget(requestBody, provider, model);
      let latestUsage = null;
      const trackedSend = payload => {
        if (payload?.type === 'usage' && payload.usage) latestUsage = payload.usage;
        send(payload);
      };
      const recordUsage = () => {
        const record = _recordClientUsage({
          provider,
          model,
          usage: latestUsage,
          sessionId: requestBody.session_id,
          source: 'cloud-client',
        });
        if (record) trackedSend({ type: 'usage_recorded', usage: record });
      };
      if (provider === 'anthropic') {
        await _streamAnthropic(requestBody, apiKey, trackedSend, options.signal);
        recordUsage();
        return;
      }
      if (provider === 'openai') {
        if (_requestFlag(requestBody, 'allow_code_execution', false) || _requestFlag(requestBody, 'allow_web_search', true)) {
          await _streamOpenAiResponses(requestBody, apiKey, trackedSend, options.signal);
          recordUsage();
          return;
        }
        await _streamOpenAi(requestBody, apiKey, trackedSend, options.signal);
        recordUsage();
        return;
      }
      await _streamGemini(requestBody, apiKey, trackedSend, options.signal);
      recordUsage();
    });
  }

  window.MeldexLlmClient = {
    clientBudgetStatus,
    resetClientUsage,
    streamChatAsResponse,
  };
})();
