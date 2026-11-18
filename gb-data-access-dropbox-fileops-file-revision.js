/* Dropbox Cloud file identity/revision helpers continuation (hoisted declarations used by the /file routes in part02). */
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
      const identityFormat = identity?.formatForPath?.(filePath, content);
      const documentId = identityFormat
        ? String(identity?.readDocumentId?.(String(content || ''), identityFormat) || '')
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
      if (window.MeldexDocumentIdentity?.formatForPath?.(filePath, content) !== 'note') return {};
      return { saved_frontmatter: /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content)?.[0] || '' };
    }
