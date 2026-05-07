(function () {
  'use strict';

  function _messageText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map(part => {
        if (!part || typeof part !== 'object') return '';
        if (part.type === 'text') return String(part.text || '');
        return String(part.name || part.path || part.url || part.type || '');
      }).filter(Boolean).join('\n');
    }
    return String(content || '');
  }

  function _lastUserText(body) {
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'user') return _messageText(messages[index].content);
    }
    return '';
  }

  function _truthy(value) {
    return value === true || value === 1 || value === '1' || String(value || '').toLowerCase() === 'true';
  }

  function _policyMap(policies) {
    const map = new Map();
    (policies || []).forEach(policy => map.set(String(policy.status_value || ''), policy));
    return map;
  }

  function _canUseKnowledge(item, policies) {
    const status = String(item?.source_status || '(未設定)') || '(未設定)';
    const policy = policies.get(status) || policies.get('(未設定)');
    if (!policy) return true;
    return _truthy(policy.llm_reference) && _truthy(policy.chat_response);
  }

  function _line(value, max) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max || 500);
  }

  function _knowledgeReliability(item, policies) {
    const status = String(item?.source_status || '(未設定)') || '(未設定)';
    const policy = policies.get(status) || policies.get('(未設定)') || {};
    if (_truthy(item?.is_canonical) || _truthy(policy.is_canonical)) return 'canon';
    if (_truthy(policy.override_protection)) return 'protected';
    return 'adjustable';
  }

  function _knowledgeSection(items, policies) {
    if (!items.length) return '';
    return [
      '## Meldex記憶継承（参考ナレッジ）',
      'この節は自動検索された参考情報です。canon/protected以外を確定事実として断言しないでください。ファイル/フォルダ/UI/ナレッジ項目の存在・場所・作成更新完了は、この節だけで確認済み扱いにしないでください。',
      'adjustable の項目に基づく場合は、草稿・未確定・参考情報であることを本文で明示してください。',
      ...items.map(item => {
        const status = _line(item.source_status || '(未設定)', 40);
        const reliability = _knowledgeReliability(item, policies);
        const confidence = Number.isFinite(Number(item.confidence)) ? Number(item.confidence).toFixed(2) : '0.00';
        const source = _line(item.canonical_source_path || item.source_file_path || item.source_chat_path || '', 160);
        const sourceText = source ? ` / source=${source}` : '';
        return `- [id=${_line(item.id, 24)}; ${_line(item.type, 24)}; ${reliability}; status=${status}; confidence=${confidence}${sourceText}] ${_line(item.subject, 80)}: ${_line(item.statement, 700)}`;
      }),
    ].join('\n');
  }

  function _rulesSection(rules) {
    const enabled = (rules || []).filter(rule => rule.enabled !== false && !rule.deleted_at && rule.body);
    if (!enabled.length) return '';
    return [
      '## ユーザー定義チャットルール',
      ...enabled.slice(0, 20).map(rule => `- ${_line(rule.title || rule.scope || 'rule', 80)}: ${_line(rule.body, 800)}`),
    ].join('\n');
  }

  function _tasteSection(settings, principles) {
    if (!settings?.enabled) return '';
    const items = (principles || []).filter(item => !item.deleted_at && item.rule);
    if (!items.length) return '';
    return [
      '## 感性原則',
      ...items.slice(0, 12).map(item => `- [${_line(item.scope || item.type, 40)}] ${_line(item.rule, 500)}`),
    ].join('\n');
  }

  function _memorySection(items) {
    const directives = (items || []).filter(item => !item.deleted_at && item.statement);
    if (!directives.length) return '';
    return [
      '## 明示メモリ指令',
      ...directives.slice(0, 12).map(item => `- ${_line(item.statement, 500)}`),
    ].join('\n');
  }

  async function buildForChat(body, options = {}) {
    const store = window.MeldexKnowledgeCloudStore;
    const provider = options.provider || await window.MeldexStorageAdapter?.getProvider?.();
    if (!store || !provider) return '';
    const query = _lastUserText(body);
    const [knowledge, rules, policies, tasteSettings, taste, memory] = await Promise.all([
      store.searchKnowledgeItems(provider, query, 10).catch(() => ({ results: [] })),
      store.listChatRules(provider).catch(() => ({ rules: [] })),
      store.listStatusPolicies(provider).catch(() => ({ policies: [] })),
      store.getTasteSettings(provider).catch(() => ({ settings: { enabled: false } })),
      store.listTastePrinciples(provider, { limit: 20 }).catch(() => ({ items: [] })),
      store.listMemoryDirectives(provider).catch(() => ({ items: [] })),
    ]);
    const policiesByStatus = _policyMap(policies.policies || []);
    const knowledgeItems = (knowledge.results || []).filter(item => _canUseKnowledge(item, policiesByStatus));
    const sections = [
      _knowledgeSection(knowledgeItems, policiesByStatus),
      _rulesSection(rules.rules || []),
      _tasteSection(tasteSettings.settings || tasteSettings, taste.items || []),
      _memorySection(memory.items || []),
    ].filter(Boolean);
    if (!sections.length) return '';
    return [
      '以下はMeldexの共有ナレッジです。ユーザーの指示と矛盾しない範囲で参照してください。',
      '共有ナレッジ、会話履歴、要約、推測は、ファイル/フォルダ/UI/ナレッジ項目の存在確認・場所確認・作成更新完了の証拠ではありません。確認手段がない場合は、確認できないと答えてください。',
      sections.join('\n\n'),
    ].join('\n\n');
  }

  async function augmentChatBody(body, options = {}) {
    const addition = await buildForChat(body, options);
    if (!addition) return body;
    const current = String(body?.system_prompt || '').trim();
    return {
      ...(body || {}),
      system_prompt: current ? `${current}\n\n${addition}` : addition,
      meldex_knowledge_prompt: addition,
    };
  }

  window.MeldexKnowledgePromptBuilder = {
    buildForChat,
    augmentChatBody,
  };
})();
