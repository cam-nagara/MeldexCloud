(function () {
  'use strict';

  const internals = window.__MeldexPwaDataAccessInternals;
  if (!internals) return;

  const { _normalizeFolderPath } = internals;
  const RUNS_PATH = '_knowledge/extraction_runs.json';
  const DEFAULT_STATUS = '(未設定)';
  const EXTRACTION_MODEL = 'claude-haiku-4-5-20251001';
  const EXTRACTION_DEFAULT_MODELS = {
    anthropic: 'claude-haiku-4-5-20251001',
    openai: 'gpt-5.4-mini',
    gemini: 'gemini-2.5-flash',
  };
  const PROVIDER_KEY_NAMES = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    gemini: 'GEMINI_API_KEY',
  };
  const EXTRACTION_TYPES = new Set(['fact', 'decision', 'preference', 'correction', 'team_consensus']);
  const HEURISTIC_PREFIXES = {
    '事実': 'fact',
    '設定': 'fact',
    '決定': 'decision',
    '方針': 'decision',
    '確定': 'decision',
    '好み': 'preference',
    '嗜好': 'preference',
    '訂正': 'correction',
    '修正': 'correction',
    '変更': 'correction',
    '合意': 'team_consensus',
  };
  const DIRECTIVE_RE = /(記憶して|覚えて|覚えといて|保存して|登録して|ルールとして|方針として|合意として|好みとして|訂正として)/;
  const TASTE_SCOPE_KEYWORDS = {
    character: ['キャラ', '人物', '主人公', 'ヒロイン', '口調', '内面', '関係'],
    plot: ['展開', '事件', '伏線', '葛藤', '対立', '選択', '回収', '転換'],
    dialogue: ['セリフ', '台詞', '会話', '説明セリフ', '独白', '口調'],
    structure: ['構造', '章', '起承転結', '構成', '導入', '結末'],
    theme: ['テーマ', '主題', '罪', '救済', '成長', '喪失'],
    pacing: ['テンポ', 'ページ', '間', '尺', '場面'],
    visual: ['絵', '画', 'コマ', '構図', '視覚', '見せる', '表情'],
    world: ['世界', '舞台', '設定', '時代', '場所', 'ルール'],
  };

  const EXTRACTION_SYSTEM_PROMPT = (
    'このチャットログから、後続セッションに継承すべき知識だけをJSON配列で抽出してください。' +
    '対象typeは fact / decision / preference / correction / team_consensus。' +
    '各項目は type, subject, statement, reasoning, confidence, source_msg_id を持つ。' +
    '雑談、挨拶、了解応答、一過性の感情は除外してください。'
  );

  function _isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function _nowIso() {
    return new Date().toISOString();
  }

  function _normPath(value) {
    return typeof _normalizeFolderPath === 'function'
      ? _normalizeFolderPath(value || '')
      : String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  }

  function _asBool(value, fallback = false) {
    if (value === true || value === 1 || value === '1') return true;
    if (value === false || value === 0 || value === '0') return false;
    const text = String(value == null ? '' : value).trim().toLowerCase();
    if (text === 'true') return true;
    if (text === 'false') return false;
    return fallback;
  }

  function _cleanText(value, limit = 1200) {
    return String(value || '')
      .replace(/\r/g, '\n')
      .split(/\s+/)
      .join(' ')
      .trim()
      .replace(/^[\s　\-・]+|[\s　。.!！?？]+$/g, '')
      .slice(0, limit);
  }

  function _chatMessageText(content) {
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

  function _messageId(message, index) {
    for (const key of ['msg_id', 'message_id', 'id']) {
      const value = String(message?.[key] || '').trim();
      if (value) return value;
    }
    return 'msg-' + String(index).padStart(4, '0');
  }

  function _normalizeMessages(messages) {
    return (Array.isArray(messages) ? messages : [])
      .filter(message => _isObject(message))
      .map((message, index) => ({
        ...message,
        role: String(message.role || 'user'),
        content: message.content == null ? '' : message.content,
        msg_id: _messageId(message, index + 1),
      }));
  }

  function _subjectFromStatement(statement) {
    const text = _cleanText(statement, 160);
    for (const sep of ['について', 'は', 'を', 'に', 'が', 'の']) {
      if (!text.includes(sep)) continue;
      const head = text.split(sep, 1)[0].trim().replace(/^[\s　・:：、。]+|[\s　・:：、。]+$/g, '');
      if (head.length >= 1 && head.length <= 80) return head;
    }
    return text.slice(0, 60) || '未分類';
  }

  function _chatScope(chatPath) {
    const path = _normPath(chatPath);
    if (path.includes('/dm/') || path.startsWith('_chat/dm/')) return 'personal';
    if (path.includes('/general/') || path.includes('/group/') || path.startsWith('_chat/general/') || path.startsWith('_chat/group/')) return 'team';
    return 'personal';
  }

  function _allowsTarget(settings, sourceFolder) {
    if (!_isObject(settings)) return { allowed: true, reason: '' };
    if (settings.enabled === false) return { allowed: false, reason: 'knowledge_automation_disabled' };

    const targets = _isObject(settings.targets) ? settings.targets : {};
    const sourceFolderNorm = _normPath(sourceFolder);
    if (sourceFolderNorm) {
      const sources = Array.isArray(targets.sources) ? targets.sources : [];
      if (!sources.length) return { allowed: true, reason: '' };
      const selected = sources.some(item => _isObject(item) && item.enabled === true && _normPath(item.path) === sourceFolderNorm);
      return selected
        ? { allowed: true, reason: '' }
        : { allowed: false, reason: 'knowledge_automation_source_not_selected' };
    }

    const home = _isObject(targets.home) ? targets.home : {};
    if (home.enabled === true) return { allowed: true, reason: '' };
    if (!Object.keys(home).length && !targets.sources) return { allowed: true, reason: '' };
    return { allowed: false, reason: 'knowledge_automation_home_not_selected' };
  }

  function _parseFrontmatter(raw) {
    const text = String(raw || '');
    const match = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) return {};
    const fm = {};
    match[1].split(/\r?\n/).forEach(line => {
      const idx = line.indexOf(':');
      if (idx <= 0) return;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (!key) return;
      if (!value) {
        fm[key] = '';
        return;
      }
      try { fm[key] = JSON.parse(value); }
      catch { fm[key] = value.replace(/^['"]|['"]$/g, ''); }
    });
    return fm;
  }

  async function _sourceStatus(provider, body) {
    const targetPath = _normPath(body?.targetPath || body?.target_path || body?.frontmatter?.targetPath || '');
    if (!targetPath) return { source_status: DEFAULT_STATUS, canonical_source_path: '' };
    const raw = await provider.readText(targetPath).catch(() => '');
    const fm = _parseFrontmatter(raw);
    const status = _cleanText(
      fm.status || fm.source_status || fm.sourceStatus || fm['状態'] || fm['ステータス'] || DEFAULT_STATUS,
      80,
    ) || DEFAULT_STATUS;
    return { source_status: status, canonical_source_path: targetPath };
  }

  async function _isLearnable(provider, sourceStatus) {
    const payload = await window.MeldexKnowledgeCloudStore?.listStatusPolicies?.(provider).catch(() => null);
    const policies = Array.isArray(payload?.policies) ? payload.policies : [];
    const policy = policies.find(item => item.status_value === sourceStatus) || policies.find(item => item.status_value === DEFAULT_STATUS);
    if (!policy) return true;
    return _asBool(policy.learnable, true);
  }

  async function _sha256(text) {
    const source = String(text || '');
    if (window.crypto?.subtle && window.TextEncoder) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
      return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
    let hash = 2166136261;
    for (let i = 0; i < source.length; i += 1) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return 'fnv1a-' + (hash >>> 0).toString(16).padStart(8, '0');
  }

  async function _contentHash(messages, sourceStatus) {
    const payload = JSON.stringify(messages.map(message => ({
      role: message.role || '',
      content: _chatMessageText(message.content),
    })));
    return _sha256(payload + '\nstatus:' + String(sourceStatus || ''));
  }

  async function _readRuns(provider) {
    const data = await provider.readJson(RUNS_PATH, { runs: [] }).catch(() => ({ runs: [] }));
    return { runs: Array.isArray(data?.runs) ? data.runs : [] };
  }

  async function _hasRun(provider, sourceFolder, chatPath, contentHash) {
    const store = await _readRuns(provider);
    const sourceKey = _normPath(sourceFolder);
    const chatKey = _normPath(chatPath);
    return store.runs.some(run => _normPath(run.source_folder) === sourceKey && _normPath(run.chat_path) === chatKey && run.content_hash === contentHash);
  }

  async function _recordRun(provider, { sourceFolder, chatPath, contentHash, status, itemCount, mode, error }) {
    const store = await _readRuns(provider);
    const sourceKey = _normPath(sourceFolder);
    const chatKey = _normPath(chatPath);
    const next = store.runs.filter(run => !(_normPath(run.source_folder) === sourceKey && _normPath(run.chat_path) === chatKey && run.content_hash === contentHash));
    next.unshift({
      source_folder: sourceKey,
      chat_path: chatKey,
      content_hash: contentHash,
      status: String(status || 'completed'),
      item_count: Number(itemCount || 0),
      mode: String(mode || ''),
      error: String(error || '').slice(0, 500),
      created: _nowIso(),
    });
    await provider.ensureDirectory?.('_knowledge').catch(() => {});
    await provider.writeJson(RUNS_PATH, { runs: next.slice(0, 500), updated: _nowIso() });
  }

  function _heuristicTypeAndStatement(text, scope) {
    const stripped = _cleanText(text, 1200);
    if (!stripped) return null;
    const match = stripped.match(/^(事実|設定|決定|方針|確定|好み|嗜好|訂正|修正|変更|合意)\s*[:：]\s*(.+)$/);
    if (match) {
      let itemType = HEURISTIC_PREFIXES[match[1]] || 'fact';
      if (itemType === 'team_consensus' && scope !== 'team') itemType = 'decision';
      return { type: itemType, statement: _cleanText(match[2], 1200) };
    }
    if (stripped.includes('で確定') || stripped.includes('に決定') || stripped.includes('方針')) return { type: 'decision', statement: stripped };
    if (stripped.includes('好き') || stripped.includes('好み') || stripped.includes('避けたい')) return { type: 'preference', statement: stripped };
    if (stripped.includes('ではなく') || stripped.includes('じゃなく') || stripped.includes('訂正')) return { type: 'correction', statement: stripped };
    return null;
  }

  function _extractHeuristic(messages, scope) {
    const items = [];
    messages.forEach((message, index) => {
      if (message.role !== 'user') return;
      const text = _chatMessageText(message.content);
      String(text || '').split(/[\n。]+/).forEach(line => {
        const parsed = _heuristicTypeAndStatement(line, scope);
        if (!parsed?.statement) return;
        items.push({
          type: parsed.type,
          subject: _subjectFromStatement(parsed.statement),
          statement: parsed.statement,
          reasoning: 'チャット内の明示表現から抽出',
          confidence: 0.72,
          source_msg_id: _messageId(message, index + 1),
        });
      });
    });
    return items;
  }

  function _chatLogForLlm(messages) {
    return messages.map((message, index) => {
      const role = message.role === 'user' ? 'User' : 'Assistant';
      return `### ${role} (${_messageId(message, index + 1)})\n${_chatMessageText(message.content).slice(0, 8000)}`;
    }).join('\n\n');
  }

  function _extractJsonText(text) {
    let raw = String(text || '').trim();
    if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    try { return JSON.parse(raw); } catch {}
    const match = raw.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (!match) return [];
    try { return JSON.parse(match[1]); } catch { return []; }
  }

  function _normalizeLlmItems(value) {
    const list = _isObject(value) ? (value.items || value.knowledge_items || []) : value;
    if (!Array.isArray(list)) return [];
    const items = [];
    list.forEach(item => {
      if (!_isObject(item)) return;
      const type = String(item.type || '').trim();
      const statement = _cleanText(item.statement, 1200);
      if (!EXTRACTION_TYPES.has(type) || !statement) return;
      items.push({
        type,
        subject: _cleanText(item.subject, 160) || _subjectFromStatement(statement),
        statement,
        reasoning: _cleanText(item.reasoning, 1000),
        confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : 0.5,
        source_msg_id: _cleanText(item.source_msg_id, 120),
      });
    });
    return items;
  }

  function _automationProviderAndModel(settings) {
    if (!_isObject(settings)) return { provider: 'anthropic', model: EXTRACTION_MODEL };
    let provider = String(settings.provider || 'anthropic').trim().toLowerCase();
    if (!EXTRACTION_DEFAULT_MODELS[provider]) provider = 'anthropic';
    const model = String(settings.model || '').trim() || EXTRACTION_DEFAULT_MODELS[provider];
    return { provider, model };
  }

  async function _apiKeyForProvider(provider, settings) {
    const keyName = PROVIDER_KEY_NAMES[provider] || PROVIDER_KEY_NAMES.anthropic;
    const inlineKey = _isObject(settings?.api_keys) ? String(settings.api_keys[keyName] || '').trim() : '';
    if (inlineKey) return inlineKey;
    return String(await window.MeldexLlmKeys?.getForProvider?.(provider).catch(() => '') || '').trim();
  }

  async function _postJson(url, headers, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body || {}),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`LLM extraction failed: HTTP ${response.status} ${detail.slice(0, 160)}`.trim());
    }
    return response.json();
  }

  function _anthropicText(response) {
    return (Array.isArray(response?.content) ? response.content : [])
      .map(block => String(block?.text || ''))
      .filter(Boolean)
      .join('\n');
  }

  function _openAiText(response) {
    return String(response?.choices?.[0]?.message?.content || '');
  }

  function _geminiText(response) {
    const parts = response?.candidates?.[0]?.content?.parts || [];
    return (Array.isArray(parts) ? parts : []).map(part => String(part?.text || '')).filter(Boolean).join('\n');
  }

  async function _extractWithProvider(providerName, apiKey, messages, model) {
    if (!apiKey) return [];
    const chatLog = _chatLogForLlm(messages);
    if (providerName === 'openai') {
      const response = await _postJson('https://api.openai.com/v1/chat/completions', {
        Authorization: 'Bearer ' + apiKey,
      }, {
        model,
        max_tokens: 2048,
        temperature: 0,
        messages: [
          { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
          { role: 'user', content: chatLog },
        ],
      });
      return _normalizeLlmItems(_extractJsonText(_openAiText(response)));
    }
    if (providerName === 'gemini') {
      const response = await _postJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {}, {
        contents: [{ role: 'user', parts: [{ text: chatLog }] }],
        systemInstruction: { parts: [{ text: EXTRACTION_SYSTEM_PROMPT }] },
        generationConfig: { maxOutputTokens: 2048, temperature: 0 },
      });
      return _normalizeLlmItems(_extractJsonText(_geminiText(response)));
    }
    const response = await _postJson('https://api.anthropic.com/v1/messages', {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    }, {
      model,
      max_tokens: 2048,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: chatLog }],
    });
    return _normalizeLlmItems(_extractJsonText(_anthropicText(response)));
  }

  function _isDirective(text) {
    const source = String(text || '');
    if (!DIRECTIVE_RE.test(source)) return false;
    if (source.includes('保存して') && !/(記憶|覚え|ルール|方針|合意|好み|訂正|決定)/.test(source)) return false;
    return true;
  }

  function _stripDirectiveText(text) {
    let source = _cleanText(text, 2400);
    for (const sep of ['：', ':']) {
      const idx = source.indexOf(sep);
      if (idx > 0 && _isDirective(source.slice(0, idx)) && source.slice(idx + 1).trim()) {
        return _cleanText(source.slice(idx + 1), 1200);
      }
    }
    source = source.replace(/^(これは|これを|この内容を|以下を|次を)\s*/, '');
    source = source.replace(/(を)?(グローバル|全体|作品|この作品|ソースフォルダ|個人|私の|チーム)?(ルール|方針|合意|好み|訂正|決定)?として(記憶|保存|登録|覚え)(して|て|といて)?$/, '');
    source = source.replace(/(記憶して|覚えて|覚えといて|保存して|登録して)$/, '');
    source = source.replace(/^(グローバル|全体|作品|この作品|ソースフォルダ|個人|私の|チーム)(ルール|方針|合意|好み|訂正|決定)?として\s*/, '');
    return _cleanText(source, 1200);
  }

  function _ruleScope(text) {
    if (/(グローバル|全体ルール|全体のルール)/.test(text)) return 'global';
    if (text.includes('ソースフォルダ')) return 'source_folder';
    if (/(個人ルール|私のルール|自分のルール)/.test(text)) return 'personal';
    if (text.includes('チーム')) return 'team';
    return 'project';
  }

  function _looksLikeRule(text) {
    return /(ルール|方針|必ず|今後|守って|従って|グローバル)/.test(String(text || ''));
  }

  function _classification(text, statement) {
    if (/(好みとして|私の好み|好き|避けたい|重視)/.test(text)) return { kind: 'taste', scope: 'personal' };
    if (text.includes('訂正')) return { kind: 'knowledge:correction', scope: 'project' };
    if (/(チーム合意|合意として)/.test(text)) return { kind: 'knowledge:team_consensus', scope: 'team' };
    if (/(決定|確定)/.test(text)) return { kind: 'knowledge:decision', scope: 'project' };
    if (_looksLikeRule(text) || _looksLikeRule(statement)) return { kind: 'rule', scope: _ruleScope(text) };
    return { kind: 'knowledge:decision', scope: 'project' };
  }

  function _inferTasteScope(text) {
    const source = String(text || '');
    for (const [scope, words] of Object.entries(TASTE_SCOPE_KEYWORDS)) {
      if (words.some(word => source.includes(word))) return scope;
    }
    return 'other';
  }

  async function _saveExplicitMemoryDirectives(provider, { sourceFolder, chatPath, messages, sourceStatus, canonicalSourcePath }) {
    const saved = { chat_rules: [], knowledge_items: [], taste_principles: [] };
    const store = window.MeldexKnowledgeCloudStore;
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (message.role !== 'user') continue;
      const text = _chatMessageText(message.content);
      if (!_isDirective(text)) continue;
      const statement = _stripDirectiveText(text) || _cleanText(text, 1200);
      if (!statement) continue;
      const sourceMsgId = _messageId(message, index + 1);
      const { kind, scope } = _classification(text, statement);
      if (kind === 'rule' && typeof store?.createChatRule === 'function') {
        const created = await store.createChatRule(provider, {
          scope,
          title: _subjectFromStatement(statement),
          body: statement,
          priority: scope === 'global' ? 10 : 50,
          enabled: true,
          pinned: true,
          source_chat_path: chatPath,
          source_msg_id: sourceMsgId,
          created_by: 'explicit',
        });
        saved.chat_rules.push(created.rule);
        continue;
      }
      if (kind === 'taste' && typeof store?.createTastePrinciple === 'function') {
        const principle = await store.createTastePrinciple(provider, {
          type: 'preference',
          scope: _inferTasteScope(statement),
          rule: statement,
          rationale: 'チャットでユーザーが明示的に好みとして記憶するよう指定',
          source_path: `__chat__/${chatPath || 'current'}#${sourceMsgId}`,
          source_excerpt: statement,
          user_weight: 2.0,
          learned_weight: 1.0,
          user_pinned: true,
        });
        saved.taste_principles.push(principle.item);
        const item = await store.createKnowledgeItem(provider, {
          source_folder: sourceFolder,
          source_chat_path: chatPath,
          source_msg_id: sourceMsgId,
          type: 'preference',
          subject: _subjectFromStatement(statement),
          statement,
          reasoning: 'チャットでユーザーが明示的に好みとして記憶するよう指定',
          confidence: 1.0,
          scope: 'personal',
          source_status: sourceStatus,
          canonical_source_path: canonicalSourcePath,
          pinned: true,
          user_edited: true,
        });
        saved.knowledge_items.push(item.item);
        continue;
      }
      const itemType = kind.split(':', 2)[1] || 'decision';
      const item = await store.createKnowledgeItem(provider, {
        source_folder: sourceFolder,
        source_chat_path: chatPath,
        source_msg_id: sourceMsgId,
        type: itemType,
        subject: _subjectFromStatement(statement),
        statement,
        reasoning: 'チャットでユーザーが明示的に記憶するよう指定',
        confidence: 1.0,
        scope,
        source_status: sourceStatus,
        canonical_source_path: canonicalSourcePath,
        pinned: true,
        user_edited: true,
      });
      saved.knowledge_items.push(item.item);
      if (item.item?.type === 'correction') await _supersedeRelated(provider, item.item);
    }
    saved.count = saved.chat_rules.length + saved.knowledge_items.length + saved.taste_principles.length;
    return saved;
  }

  async function _supersedeRelated(provider, correctionItem) {
    const store = window.MeldexKnowledgeCloudStore;
    if (!correctionItem?.id || !correctionItem?.subject || typeof store?.listKnowledgeItems !== 'function' || typeof store?.updateKnowledgeItem !== 'function') return;
    const existing = await store.listKnowledgeItems(provider, { q: correctionItem.subject, include_superseded: true, include_deleted: false }).catch(() => null);
    const candidates = (existing?.items || [])
      .filter(item => Number(item.id) !== Number(correctionItem.id))
      .filter(item => !item.superseded_by && item.type !== 'correction')
      .filter(item => String(item.subject || '') === String(correctionItem.subject || ''))
      .slice(0, 5);
    for (const item of candidates) {
      await store.updateKnowledgeItem(provider, item.id, { superseded_by: correctionItem.id }).catch(() => null);
    }
  }

  async function _saveExtractedItems(provider, { items, sourceFolder, chatPath, scope, sourceStatus, canonicalSourcePath }) {
    const saved = [];
    const seen = new Set();
    for (const item of items) {
      const key = [item.type, item.subject, item.statement, item.source_msg_id].join('\n');
      if (seen.has(key)) continue;
      seen.add(key);
      const created = await window.MeldexKnowledgeCloudStore.createKnowledgeItem(provider, {
        ...item,
        source_folder: sourceFolder,
        source_chat_path: chatPath,
        scope,
        source_status: sourceStatus,
        canonical_source_path: canonicalSourcePath,
        user_edited: false,
      });
      saved.push(created.item);
      if (created.item?.type === 'correction') await _supersedeRelated(provider, created.item);
    }
    return saved;
  }

  async function extractAfterChatSave(provider, body = {}) {
    const store = window.MeldexKnowledgeCloudStore;
    if (!store?.createKnowledgeItem) return { ok: false, error: 'クラウドナレッジストアが初期化されていません' };
    if (store.role?.() !== 'owner') {
      return { ok: false, error: '管理者権限がないためナレッジ更新をスキップしました' };
    }

    const settings = _isObject(body.knowledge_automation) ? body.knowledge_automation : null;
    const sourceFolder = _normPath(body.source_folder || body.sourceFolder || '');
    const allowed = _allowsTarget(settings, sourceFolder);
    if (!allowed.allowed) return { ok: true, skipped: true, reason: allowed.reason };

    const messages = _normalizeMessages(body.messages);
    const chatPath = _normPath(body.path || body.chat_path || '');
    if (!messages.length || !chatPath) return { ok: true, skipped: true, reason: 'empty_chat' };

    const status = await _sourceStatus(provider, body);
    const sourceStatus = status.source_status || DEFAULT_STATUS;
    const contentHash = await _contentHash(messages, sourceStatus);
    if (await _hasRun(provider, sourceFolder, chatPath, contentHash)) {
      return { ok: true, skipped: true, reason: 'already_extracted', item_count: 0 };
    }

    if (!(await _isLearnable(provider, sourceStatus))) {
      await _recordRun(provider, {
        sourceFolder,
        chatPath,
        contentHash,
        status: 'skipped',
        itemCount: 0,
        mode: 'policy',
        error: 'learnable=0',
      }).catch(() => {});
      return { ok: true, skipped: true, reason: 'source_status_not_learnable', source_status: sourceStatus, item_count: 0 };
    }

    const explicit = await _saveExplicitMemoryDirectives(provider, {
      sourceFolder,
      chatPath,
      messages,
      sourceStatus,
      canonicalSourcePath: status.canonical_source_path || '',
    });

    const scope = _chatScope(chatPath);
    const { provider: providerName, model } = _automationProviderAndModel(settings);
    const apiKey = await _apiKeyForProvider(providerName, settings);
    let mode = 'heuristic';
    let items = [];
    let fallbackError = '';
    try {
      items = await _extractWithProvider(providerName, apiKey, messages, model);
      if (items.length) mode = providerName;
    } catch (error) {
      fallbackError = error?.message || String(error);
      items = [];
    }
    if (!items.length) items = _extractHeuristic(messages, scope);

    const saved = await _saveExtractedItems(provider, {
      items,
      sourceFolder,
      chatPath,
      scope,
      sourceStatus,
      canonicalSourcePath: status.canonical_source_path || '',
    });
    const itemCount = saved.length + Number(explicit.count || 0);
    await _recordRun(provider, {
      sourceFolder,
      chatPath,
      contentHash,
      status: fallbackError ? 'fallback' : 'completed',
      itemCount,
      mode,
      error: fallbackError,
    }).catch(() => {});
    return {
      ok: true,
      skipped: false,
      mode,
      provider: mode !== 'heuristic' ? providerName : '',
      model: mode !== 'heuristic' ? model : '',
      source_status: sourceStatus,
      item_count: itemCount,
      items: saved,
      explicit,
      fallback_error: fallbackError,
    };
  }

  window.MeldexKnowledgeCloudExtractor = {
    EXTRACTION_SYSTEM_PROMPT,
    extractAfterChatSave,
  };
})();
