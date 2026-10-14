(function (global) {
  'use strict';

  const SCHEMA = 'meldex-portable-knowledge/v1';
  // デスクトップ・Cloud・スマホで共有する定義(自動ナレッジ化の対象範囲計画
  // 2026-08-13 Phase 4-4「3面の定義共有」)。正本は
  // app/meldex_knowledge_index_definitions.py。値を変更する場合は必ず両方を
  // 同時に更新すること(app/tests/test_meldex_knowledge_index_definitions_parity.py
  // が両ファイルの値を静的に比較して固定する)。
  // `.scriptnote` はファイルの実拡張子ではなく、`extension()` が
  // `*.scriptnote.json` を正規化した内部トークン(下記参照)。デスクトップ側は
  // `Path.suffix` が素で `.json` を返すため対応するトークンを持たない。
  const TEXT_EXTENSIONS = new Set([
    '.md', '.markdown', '.txt', '.csv', '.tsv', '.json', '.yaml', '.yml',
    '.mel-board', '.mel-sheet', '.mel-scenario', '.mel-timer', '.scriptnote',
  ]);
  const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.svg', '.tiff', '.tif']);
  // `_`/`.`始まりでなくても常に除外するフォルダ名(小文字)。
  const ALWAYS_EXCLUDED_DIR_NAMES = new Set(['__pycache__', 'node_modules', 'dist', 'build']);
  // `_`始まりフォルダのうち、例外的に索引対象へ含めるフォルダ名(小文字)。
  const INDEXABLE_PRIVATE_DIR_NAMES = new Set(['_chat', '_knowledge', '_skills']);
  const SENSITIVE_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|private[_-]?key|client[_-]?secret)/i;

  function normalizePath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/').replace(/\/$/, '');
  }

  function basename(path) {
    return normalizePath(path).split('/').pop() || '';
  }

  function extension(path) {
    const name = basename(path).toLowerCase();
    if (name.endsWith('.scriptnote.json')) return '.scriptnote';
    const index = name.lastIndexOf('.');
    return index >= 0 ? name.slice(index) : '';
  }

  function hash(value) {
    let result = 2166136261;
    for (const character of String(value || '')) {
      result ^= character.codePointAt(0);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(16).padStart(8, '0');
  }

  function documentId(path, rootId = 'active-storage') {
    return `portable:${hash(`${rootId}\0${normalizePath(path).toLowerCase()}`)}`;
  }

  function isExcludedDirName(name) {
    const lower = String(name || '').toLowerCase();
    if (!lower) return false;
    if (ALWAYS_EXCLUDED_DIR_NAMES.has(lower)) return true;
    // デスクトップ側(meldex_fts_index._skip_dir_name)と同じ規則: `_`/`.`始まりの
    // フォルダは既定で除外し、INDEXABLE_PRIVATE_DIR_NAMES だけ例外にする。
    // これにより `_screenshots`(検証用撮影専用)・`_trash`・`_scheduler_shared`等の
    // 個人管理フォルダが、Cloud/スマホ側でだけ索引される穴を塞ぐ
    // (自動ナレッジ化の対象範囲計画 2026-08-13 §2.5「デスクトップとCloudで
    // 対象範囲が食い違っている」)。
    if ((lower.startsWith('_') || lower.startsWith('.')) && !INDEXABLE_PRIVATE_DIR_NAMES.has(lower)) return true;
    return false;
  }

  function shouldSkipPath(path) {
    const normalized = normalizePath(path);
    if (normalized.split('/').some(part => isExcludedDirName(part))) return true;
    return /(?:^|\/)(?:secrets?|credentials?|tokens?|api[-_]?keys?)(?:\.|\/|$)/i.test(normalized);
  }

  function isSupported(path) {
    const ext = extension(path);
    return TEXT_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext);
  }

  function kindForPath(path) {
    const ext = extension(path);
    if (IMAGE_EXTENSIONS.has(ext)) return 'image';
    if (ext === '.mel-board') return 'board';
    if (ext === '.mel-sheet' || ext === '.csv' || ext === '.tsv') return 'sheet';
    if (ext === '.mel-scenario') return 'scenario';
    if (ext === '.scriptnote') return 'scriptnote';
    if (ext === '.mel-timer') return 'unsupported';
    return 'note';
  }

  function _primitive(value) {
    return ['string', 'number', 'boolean'].includes(typeof value) && String(value).trim();
  }

  function _jsonLines(value, prefix = '', lines = [], depth = 0) {
    if (lines.length >= 4000 || depth > 8 || value == null) return lines;
    if (_primitive(value)) {
      lines.push(prefix ? `${prefix}: ${String(value)}` : String(value));
      return lines;
    }
    if (Array.isArray(value)) {
      value.slice(0, 1000).forEach((item, index) => _jsonLines(item, `${prefix}[${index}]`, lines, depth + 1));
      return lines;
    }
    if (typeof value === 'object') {
      Object.entries(value).slice(0, 1000).forEach(([key, item]) => {
        const nextPrefix = prefix ? `${prefix}.${key}` : key;
        if (SENSITIVE_KEY.test(key)) lines.push(`${nextPrefix}: [非公開]`);
        else _jsonLines(item, nextPrefix, lines, depth + 1);
      });
    }
    return lines;
  }

  function _relationshipRecords(value, nodes = [], edges = [], seen = new Set(), depth = 0) {
    if (!value || typeof value !== 'object' || depth > 7 || seen.has(value)) return { nodes, edges };
    seen.add(value);
    if (Array.isArray(value)) {
      value.slice(0, 2000).forEach(item => _relationshipRecords(item, nodes, edges, seen, depth + 1));
      return { nodes, edges };
    }
    const id = value.id ?? value.cardId ?? value.nodeId ?? value.uuid;
    const label = value.title ?? value.name ?? value.text ?? value.label;
    if (id != null && label != null && nodes.length < 3000) {
      nodes.push({ id: String(id), label: String(label).slice(0, 500), type: String(value.type || value.kind || 'item') });
    }
    const from = value.from ?? value.source ?? value.fromId ?? value.sourceId;
    const to = value.to ?? value.target ?? value.toId ?? value.targetId;
    if (from != null && to != null && edges.length < 5000) {
      edges.push({
        from: String(typeof from === 'object' ? (from.id ?? from.cardId ?? '') : from),
        to: String(typeof to === 'object' ? (to.id ?? to.cardId ?? '') : to),
        label: String(value.label || value.text || value.type || 'related').slice(0, 300),
        type: String(value.type || 'relation').slice(0, 80),
      });
    }
    Object.values(value).forEach(item => _relationshipRecords(item, nodes, edges, seen, depth + 1));
    return { nodes, edges };
  }

  function _chunks(text) {
    const clean = _redactSecrets(text).replace(/\u0000/g, '').trim().slice(0, 750000);
    if (!clean) return [];
    const paragraphs = clean.split(/\n{2,}/).map(value => value.trim()).filter(Boolean);
    const result = [];
    let buffer = '';
    for (const paragraph of paragraphs) {
      if (result.length >= 256) break;
      if (buffer && buffer.length + paragraph.length + 2 > 1400) {
        result.push({ id: `chunk-${result.length}`, order: result.length, text: buffer });
        buffer = '';
      }
      buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
      while (buffer.length > 1800 && result.length < 256) {
        result.push({ id: `chunk-${result.length}`, order: result.length, text: buffer.slice(0, 1400) });
        buffer = buffer.slice(1400);
      }
    }
    if (buffer && result.length < 256) result.push({ id: `chunk-${result.length}`, order: result.length, text: buffer });
    return result;
  }

  function _redactSecrets(value) {
    return String(value || '')
      .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[非公開]')
      .replace(/\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, '[非公開]')
      .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, '[非公開]')
      .replace(/\bAKIA[A-Z0-9]{12,}\b/g, '[非公開]')
      .replace(/(^|\n)(\s*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|private[_-]?key|client[_-]?secret)\s*[:=]\s*)[^\n]+/gi, '$1$2[非公開]');
  }

  function createArtifact(input = {}) {
    const path = normalizePath(input.path);
    const kind = kindForPath(path);
    const rawText = String(input.text || '');
    let extractedText = rawText;
    let structure = { nodes: [], edges: [] };
    const warnings = [];
    if (kind === 'image') {
      extractedText = basename(path).replace(/[-_]+/g, ' ');
    } else if (['.json', '.mel-board', '.mel-sheet', '.mel-scenario', '.mel-timer', '.scriptnote'].includes(extension(path))) {
      try {
        const parsed = JSON.parse(rawText);
        extractedText = _jsonLines(parsed).join('\n');
        structure = _relationshipRecords(parsed);
      } catch {
        warnings.push('構造JSONとして読めなかったため、本文として索引化しました');
      }
    }
    const contentHash = hash(rawText || extractedText || `${input.size || 0}:${input.modified || ''}`);
    const revision = `portable-v1:${contentHash}:${Number(input.size || rawText.length || 0)}`;
    const docId = documentId(path, input.rootId);
    return {
      schema: SCHEMA,
      document_id: docId,
      revision,
      source_path: path,
      root_id: String(input.rootId || 'active-storage'),
      kind,
      visibility: String(input.visibility || 'workspace'),
      owner_id: String(input.ownerId || ''),
      workspace_id: String(input.workspaceId || ''),
      extractor: 'meldex-portable-browser',
      extractor_version: '1',
      text_chunks: _chunks(extractedText),
      nodes: structure.nodes,
      edges: structure.edges,
      images: kind === 'image' ? [{ path, name: basename(path), searchable_by: 'filename-or-hub-clip' }] : [],
      source_refs: [{ path, kind }],
      warnings,
      metadata: {
        title: basename(path),
        source_modified: String(input.modified || ''),
        source_modified_ms: Number(input.modifiedMs || Date.parse(input.modified || '') || 0),
        source_size: Number(input.size || rawText.length || 0),
        generated_at: new Date().toISOString(),
        portable: true,
      },
    };
  }

  function createAnnotationArtifact(annotation = {}, options = {}) {
    const annId = String(annotation.id || '').trim();
    const targetPath = normalizePath(annotation.target_path || annotation.targetPath || '');
    const bodyText = String(annotation.body || annotation.text || annotation.content || '').trim();
    const annType = String(annotation.type || 'comment');
    const rootId = String(options.rootId || 'active-storage');
    const docId = `portable:annotation:${hash(`${rootId}\0${targetPath}\0${annId}`)}`;
    const contentHash = hash(`${annId}:${targetPath}:${bodyText}:${annType}`);
    const revision = `portable-ann-v1:${contentHash}:${bodyText.length}`;

    const nodes = annId ? [{
      id: annId,
      label: (bodyText || annType || 'アノテート').slice(0, 500),
      type: 'annotation',
    }] : [];

    const edges = (annId && targetPath) ? [{
      from: targetPath,
      to: annId,
      label: 'アノテート',
      type: 'annotates',
    }] : [];

    const textChunks = bodyText ? _chunks(bodyText) : [];

    return {
      schema: SCHEMA,
      document_id: docId,
      revision,
      source_path: targetPath,
      root_id: rootId,
      kind: 'annotation',
      visibility: String(options.visibility || 'workspace'),
      owner_id: String(options.ownerId || ''),
      workspace_id: String(options.workspaceId || ''),
      extractor: 'meldex-portable-browser-annotation',
      extractor_version: '1',
      text_chunks: textChunks,
      nodes,
      edges,
      images: [],
      source_refs: [{ path: targetPath, kind: 'annotation' }],
      warnings: [],
      metadata: {
        title: `アノテート (${basename(targetPath) || targetPath})`,
        target_path: targetPath,
        annotation_id: annId,
        annotation_type: annType,
        author: String(annotation.user || ''),
        created_at: String(annotation.created || ''),
        modified_at: String(annotation.modified || ''),
        portable: true,
      },
    };
  }

  function tokens(value) {
    const normalized = String(value || '').normalize('NFKC').toLowerCase();
    const result = new Set(normalized.match(/[a-z0-9_]{2,}|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{1,}/gu) || []);
    const compact = normalized.replace(/[\s\p{P}\p{S}]+/gu, '');
    for (let index = 0; index + 1 < compact.length && index < 400; index += 1) result.add(compact.slice(index, index + 2));
    return [...result].slice(0, 300);
  }

  function scoreArtifact(artifact, query) {
    const queryTokens = tokens(query);
    if (!queryTokens.length) return { score: 0, snippets: [] };
    const title = String(artifact?.metadata?.title || artifact?.source_path || '').toLowerCase();
    const chunks = (artifact?.text_chunks || []).map(chunk => String(chunk.text || ''));
    const haystack = `${title}\n${chunks.join('\n')}\n${JSON.stringify(artifact?.nodes || [])}\n${JSON.stringify(artifact?.edges || [])}`.normalize('NFKC').toLowerCase();
    let score = 0;
    queryTokens.forEach(token => {
      if (title.includes(token)) score += 7;
      if (haystack.includes(token)) score += token.length > 1 ? 2 : 0.5;
    });
    if (haystack.includes(String(query || '').normalize('NFKC').toLowerCase())) score += 12;
    const snippets = chunks
      .map(text => ({ text, hits: queryTokens.reduce((sum, token) => sum + (text.toLowerCase().includes(token) ? 1 : 0), 0) }))
      .filter(item => item.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 3)
      .map(item => item.text.slice(0, 500));
    return { score, snippets };
  }

  global.MeldexPortableKnowledgeContract = Object.freeze({
    SCHEMA,
    TEXT_EXTENSIONS,
    IMAGE_EXTENSIONS,
    ALWAYS_EXCLUDED_DIR_NAMES,
    INDEXABLE_PRIVATE_DIR_NAMES,
    normalizePath,
    basename,
    extension,
    hash,
    documentId,
    isExcludedDirName,
    shouldSkipPath,
    isSupported,
    kindForPath,
    createArtifact,
    createAnnotationArtifact,
    tokens,
    scoreArtifact,
  });
})(typeof self !== 'undefined' ? self : window);
