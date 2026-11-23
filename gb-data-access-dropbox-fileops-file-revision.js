/* Dropbox Cloud file identity/revision helpers continuation (hoisted declarations used by the /file routes in part02). */
    function _preserveNoteTextFormat(text, original) {
      const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '';
      original = original.replace(/^\uFEFF/, '');
      text = String(text).replace(/^\uFEFF/, '');
      const endings = original.match(/\r\n|\r|\n/g) || [];
      if (!endings.length) return bom + text;
      const counts = new Map();
      for (const ending of endings) counts.set(ending, (counts.get(ending) || 0) + 1);
      const majority = [...counts].sort((a, b) => b[1] - a[1])[0][0];
      const normalized = text.replace(/\r\n?/g, '\n');
      if (counts.size === 1) return bom + normalized.replace(/\n/g, majority);
      const split = value => (value.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) || []).filter(Boolean)
        .map(line => { const end = /(?:\r\n|\r|\n)$/.exec(line)?.[0] || ''; return [line.slice(0, line.length - end.length), end]; });
      const old = split(original), next = split(normalized);
      const result = next.map(line => line[1] ? majority : '');
      const keep = (a, b) => { if (result[b]) result[b] = old[a][1] || majority; };
      // Match unchanged edges and unique lines (patience anchors). Repeated-line
      // gaps of equal size keep their positional endings; new lines use majority.
      // Uniform files, including large notes, take the linear fast path above.
      const segments = [[0, old.length, 0, next.length]];
      while (segments.length) {
        let [a, b, c, d] = segments.pop();
        while (a < b && c < d && old[a][0] === next[c][0]) keep(a++, c++);
        while (a < b && c < d && old[b-1][0] === next[d-1][0]) keep(--b, --d);
        if (a === b || c === d) continue;
        const indices = (rows, start, end) => {
          const map = new Map();
          for (let i = start; i < end; i++) map.set(rows[i][0], map.has(rows[i][0]) ? -1 : i);
          return map;
        };
        const left = indices(old, a, b), right = indices(next, c, d), pairs = [];
        for (const [line, i] of left) if (i >= 0 && right.get(line) >= 0) pairs.push([i, right.get(line)]);
        const tails = [], previous = [];
        for (let i = 0; i < pairs.length; i++) {
          let lo = 0, hi = tails.length;
          while (lo < hi) { const mid = (lo + hi) >>> 1; if (pairs[tails[mid]][1] < pairs[i][1]) lo = mid + 1; else hi = mid; }
          previous[i] = lo ? tails[lo-1] : -1; tails[lo] = i;
        }
        if (!tails.length) { if (b-a === d-c) for (let i = 0; i < b-a; i++) keep(a+i, c+i); continue; }
        const anchors = [];
        for (let i = tails[tails.length-1]; i >= 0; i = previous[i]) anchors.push(pairs[i]);
        for (const [i, j] of anchors.reverse()) { segments.push([a, i, c, j]); keep(i, j); a = i+1; c = j+1; }
        segments.push([a, b, c, d]);
      }
      return bom + next.map((line, i) => line[0] + result[i]).join('');
    }

    function _pwaFileTransport() {
      return window.MeldexRuntimeAdapter?.isBrowserMode?.() ? 'browser-local' : 'dropbox-rev';
    }

    async function _fileIdentityAndRevision(provider, filePath, entry, etag, writeMeta, fileContent) {
      let meta = writeMeta?.meta || writeMeta || null;
      if (!meta?.id && typeof provider?.getMetadata === 'function') {
        meta = await provider.getMetadata(filePath).catch(() => meta);
      }
      if (!meta?.id) {
        const stat = typeof provider?.statPath === 'function'
          ? await provider.statPath(filePath).catch(() => null)
          : null;
        meta = stat?.meta || meta;
      }
      const token = String(etag || '');
      const providerId = String(meta?.id || '');
      const identity = window.MeldexDocumentIdentity;
      let content = fileContent;
      if (content == null && identity?.formatForPath?.(filePath) && typeof provider?.readText === 'function') {
        content = await provider.readText(filePath).catch(() => '');
      }
      const identityContent = /\.md$/i.test(filePath) ? String(content || '').replace(/\r\n?/g, '\n') : content;
      const identityFormat = identity?.formatForPath?.(filePath, identityContent);
      const documentId = identityFormat
        ? String(identity?.readDocumentId?.(String(identityContent || ''), identityFormat) || '')
        : '';
      return {
        etag: token,
        transport_revision: { transport: _pwaFileTransport(), token },
        ...(documentId ? {
          document_id: documentId,
          document_key: `document:${documentId}`,
        } : {}),
        ...(providerId ? {
          provider_id: providerId,
          ...(!documentId ? { document_key: `dropbox-item:${providerId}` } : {}),
        } : {}),
      };
    }

    function _throwPreconditionRequired(filePath, currentEtag) {
      const error = new Error('既存ファイルを更新するには読込時のrevisionが必要です');
      error.status = 428;
      error.code = 'precondition_required';
      error.meldexCode = 'precondition_required';
      error.detail = {
        code: 'precondition_required',
        path: _normalizeFolderPath(filePath),
        current_etag: String(currentEtag || ''),
      };
      throw error;
    }

    function _dropboxTransportRevisionToken(bodyValue) {
      const expectedTransport = _pwaFileTransport();
      const revision = bodyValue?.transport_revision || bodyValue?.transportRevision || '';
      let transport = '';
      let token = '';
      if (revision && typeof revision === 'object') {
        transport = String(revision.transport || revision.kind || expectedTransport);
        token = String(revision.token || revision.revision || revision.etag || '').trim();
      } else {
        const raw = String(revision || '').trim();
        if (raw.startsWith('local-etag:')) transport = 'local-etag';
        else if (raw.startsWith('browser-local:')) {
          transport = 'browser-local';
          token = raw.slice('browser-local:'.length);
        }
        else if (raw.startsWith('dropbox-rev:')) {
          transport = 'dropbox-rev';
          token = raw.slice('dropbox-rev:'.length);
        } else {
          transport = expectedTransport;
          token = raw;
        }
      }
      if (transport && transport !== expectedTransport) {
        const error = new Error('異なる保存経路のrevisionは使用できません');
        error.status = 400; error.code = 'transport_mismatch'; error.meldexCode = 'transport_mismatch';
        error.detail = { code: 'transport_mismatch', expected_transport: expectedTransport, actual_transport: transport };
        throw error;
      }
      return token;
    }

    async function _readFileSnapshot(provider, filePath, entry) {
      if (typeof provider.readBytesSnapshot === 'function') {
        const snapshot = await provider.readBytesSnapshot(filePath);
        return { bytes: snapshot.bytes, etag: String(snapshot.revision || '') };
      }
      if (typeof provider.readBytesFresh === 'function') {
        const snapshot = await provider.readBytesFresh(filePath);
        return { bytes: snapshot.bytes, etag: String(snapshot.revision || '') };
      }
      const before = await _fileEtag(provider, filePath, entry);
      const bytes = new TextEncoder().encode(await provider.readText(filePath));
      const after = await _fileEtag(provider, filePath, entry);
      if (!before || before !== after) _throwEtagConflict(filePath, before, after);
      return { bytes, etag: after };
    }

    function _savedNoteMetadata(filePath, content) {
      content = String(content || '').replace(/\r\n?/g, '\n');
      if (window.MeldexDocumentIdentity?.formatForPath?.(filePath, content) !== 'note') return {};
      return { saved_frontmatter: /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content)?.[0] || '' };
    }
