/* Provider-neutral bounded live scan used by Cloud and File System Access. */
(function () {
  'use strict';
  const MAX_FILES = 20000;
  const MAX_BYTES = 256 * 1024 * 1024;

  function isTextLikePath(path) {
    const lower = String(path || '').toLowerCase();
    return /\.(?:md|json|txt|csv|html?|js|css|mel-board|mel-sheet|mel-scenario|mel-timer)$/.test(lower)
      || /\.(?:scriptnote|timer)\.json$/.test(lower);
  }

  function _normalize(items) {
    const normalized = (Array.isArray(items) ? items : []).map(item => ({
      path: String(item?.path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''),
      kind: item?.kind === 'folder' ? 'folder' : 'file',
      assetId: String(item?.assetId || item?.asset_id || ''),
    })).filter(item => item.path);
    if (normalized.some(item => item.path.split('/').some(part => part === '.' || part === '..'))) {
      throw Object.assign(new Error('参照影響の対象pathが不正です'), { status: 503 });
    }
    return normalized;
  }

  async function _sha256(value) {
    if (!globalThis.crypto?.subtle) throw Object.assign(new Error('参照graphを安全に識別できません'), { status: 503 });
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function _canonicalQueryEncoding(value) {
    return String(value || '').replace(/\+/g, '%20')
      .replace(/%[0-9a-f]{2}/gi, token => token.toUpperCase());
  }

  function _countOffsets(content, variants) {
    const offsets = new Set();
    for (const variant of variants) {
      if (!variant) continue;
      for (let offset = 0; (offset = content.indexOf(variant, offset)) >= 0; offset += variant.length) {
        offsets.add(`${offset}:${variant.length}`);
      }
    }
    return offsets.size;
  }

  async function query(options) {
    if (typeof options?.listFiles !== 'function' || typeof options?.readTextBounded !== 'function'
        || typeof options?.statSize !== 'function' || typeof options?.isTextLike !== 'function') {
      throw Object.assign(new Error('参照影響を走査できません'), { status: 503 });
    }
    const requested = _normalize(options.items);
    if (!requested.length) {
      return { ok: true, complete: true, sourceFileCount: 0, occurrenceCount: 0,
        sources: [], truncatedSources: false, unchecked: [],
        coverage: { status: 'complete', mode: 'live-scan' } };
    }
    const listed = await options.listFiles();
    if (!Array.isArray(listed)) throw Object.assign(new Error('参照影響の一覧を取得できません'), { status: 503 });
    const files = [...new Set(listed.map(path => String(path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')))]
      .filter(Boolean).sort();
    if (files.some(path => path.split('/').some(part => part === '.' || part === '..'))
        || files.length > Number(options.maxFiles || MAX_FILES)) {
      throw Object.assign(new Error('参照影響の走査上限を超えました'), { status: 503 });
    }
    const folderPrefixes = requested.filter(row => row.kind === 'folder').map(row => row.path + '/');
    const targets = new Set(requested.filter(row => row.kind === 'file').map(row => row.path));
    requested.filter(row => row.kind === 'folder').forEach(row => targets.add(row.path));
    for (const path of files) {
      if (folderPrefixes.some(prefix => path.startsWith(prefix))) targets.add(path);
    }
    const sources = [];
    let bytes = 0;
    for (const rawPath of files) {
      const path = String(rawPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      if (!path || targets.has(path) || !options.isTextLike(path)) continue;
      const size = Number(await options.statSize(path));
      if (!Number.isFinite(size) || size < 0 || size > Number(options.maxBytes || MAX_BYTES) - bytes) {
        throw Object.assign(new Error('参照影響の読取上限を超えました'), { status: 503 });
      }
      const content = String(await options.readTextBounded(path, Number(options.maxBytes || MAX_BYTES) - bytes) || '');
      const canonicalQueryContent = _canonicalQueryEncoding(content);
      bytes += new TextEncoder().encode(content).byteLength;
      if (bytes > Number(options.maxBytes || MAX_BYTES)) {
        throw Object.assign(new Error('参照影響の読取上限を超えました'), { status: 503 });
      }
      let count = 0;
      const targetCounts = [];
      const targetRecords = [...targets].map(target => ({ target, assetId: requested.find(row => row.path === target)?.assetId || '' }));
      for (const { target, assetId } of targetRecords) {
        const rawCount = _countOffsets(content, [target, assetId]);
        const encoded = [...new Set([encodeURIComponent(target), encodeURI(target)]
          .map(_canonicalQueryEncoding).filter(value => value && value !== target))];
        const targetCount = rawCount + _countOffsets(canonicalQueryContent, encoded);
        if (targetCount) targetCounts.push([target, targetCount]);
        count += targetCount;
      }
      if (count) sources.push({
        source_path: path, source_asset_id: '',
        display_name: options.displayName ? options.displayName(path) : path.split('/').pop(),
        exists: true, entry_type: '', occurrence_count: count, target_counts: targetCounts,
      });
    }
    sources.sort((a, b) => a.source_path.localeCompare(b.source_path, 'ja', { sensitivity: 'base' }));
    const graphRevision = await _sha256(JSON.stringify({
      targets: [...targets].sort(),
      sources: sources.map(row => [row.source_path, row.target_counts]),
    }));
    return {
      ok: true, complete: true, sourceFileCount: sources.length,
      occurrenceCount: sources.reduce((sum, row) => sum + row.occurrence_count, 0),
      sources: sources.slice(0, 50), truncatedSources: sources.length > 50, unchecked: [],
      graphRevision,
      coverage: { status: 'complete', mode: 'live-scan', scannedFiles: files.length, scannedBytes: bytes },
    };
  }
  window.MeldexReferenceImpactLiveScan = Object.freeze({ query, isTextLikePath, MAX_FILES, MAX_BYTES });
})();
