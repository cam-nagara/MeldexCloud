/* ノートの操作履歴を文書単位で保存・復元する。 */
(function initMeldexNoteHistory(global) {
  'use strict';

  function normalizePath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  }

  function scope(path) {
    return `page:${normalizePath(path)}`;
  }

  function matchingHosts(path, aliases = []) {
    const normalized = new Set([path, ...aliases].map(normalizePath));
    // 公開設定・ツリー等にもdata-pathがある。本文ホストだけを保存・ロック・復元する。
    return Array.from(global.document?.querySelectorAll?.('#page-content[data-path], #dp-editable[data-path], #entity-freetext[data-path], .meldex-entity-detail-editor[data-path]') || [])
      .filter((host) => normalized.has(normalizePath(host?.dataset?.path)) && host?.dataset?.loadFailed !== '1');
  }

  async function waitForHost(path, timeoutMs = 3000, aliases = []) {
    const deadline = Date.now() + timeoutMs;
    let hosts = matchingHosts(path, aliases);
    while (!hosts.length && Date.now() < deadline) {
      await new Promise((resolve) => global.setTimeout(resolve, 30));
      hosts = matchingHosts(path, aliases);
    }
    return hosts;
  }

  function assertHostsAreSaved(path, hosts, retrySave = null) {
    const adapter = global.MeldexNoteSaveAdapter;
    if (typeof adapter?.serialize !== 'function') return;
    for (const host of hosts) {
      let liveMarkdown;
      try {
        liveMarkdown = adapter.serialize(host);
      } catch {
        throw new Error('ノートの編集中内容を確認できないため、履歴の復元を中止しました');
      }
      const clean = typeof adapter.isUnchanged === 'function'
        ? adapter.isUnchanged(host, liveMarkdown, {retrySave:retrySave && {
          ...retrySave,if_match_etag:retrySave.if_match_etag || host.dataset?.lastSavedEtag,
        }}) : liveMarkdown === (host.dataset?.lastSavedMd || '');
      if (!clean) {
        throw new Error('同じノートに未保存の編集があるため、先に保存してから履歴を復元してください');
      }
    }
  }

  function partitionHostsAfterRestore(path, hosts, originals = new Map(), result = null, pending = new Map()) {
    const adapter = global.MeldexNoteSaveAdapter;
    if (typeof adapter?.serialize !== 'function') return { clean: hosts, dirty: [] };
    const clean = [];
    const dirty = [];
    hosts.forEach((host) => {
      let liveMarkdown = null;
      try { liveMarkdown = adapter.serialize(host); } catch {}
      const baseline = host.dataset?.lastSavedMd || '';
      const original = originals.get(host);
      // 保存応答がsourceのfrontmatterを先に進めても、ロック中の本文が元のままなら描画を更新する。
      // 途中参加・未保存の別パネルは従来どおり保護する。
      const body = value => String(value || '').replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
      const acknowledged = original != null && typeof result?.saved_frontmatter === 'string'
        ? result.saved_frontmatter + body(original) : original;
      const painted = pending.get(host);
      const paintedAcknowledged = painted && typeof result?.saved_frontmatter === 'string'
        ? result.saved_frontmatter + body(painted.serialized) : painted?.serialized;
      const unchanged = (painted && (liveMarkdown === painted.serialized || liveMarkdown === paintedAcknowledged))
        || (original != null ? (liveMarkdown === original || liveMarkdown === acknowledged) : liveMarkdown === baseline);
      if (liveMarkdown === null || !unchanged) {
        dirty.push({ host, liveMarkdown, baseline });
      } else {
        clean.push(host);
      }
    });
    dirty.forEach(({ host, liveMarkdown, baseline }) => {
      if (liveMarkdown !== null) global.MeldexDraftRecovery?.queueDraft?.(host?.dataset?.path || path, liveMarkdown, baseline);
    });
    return { clean, dirty };
  }

  function lockHosts(hosts) {
    return hosts.map((host) => {
      if (!host || !('contentEditable' in host)) return { host, editable: null };
      const editable = host.contentEditable;
      const islands = Array.from(host.querySelectorAll?.('[contenteditable="true"]') || []);
      islands.forEach(island => { island.contentEditable = 'false'; });
      host.contentEditable = 'false';
      const token = Symbol('history-restore'), inert = host.inert;
      host._meldexHistoryRestoreLock = token;
      host.inert = true;
      return { host, editable, islands, path: host.dataset?.path, generation: host._openPageLoadSeq, inert, token };
    });
  }

  function unlockHosts(locks) {
    locks.forEach(({ host, editable, islands, path, generation, inert, token }) => {
      if (token && host?._meldexHistoryRestoreLock === token) {
        host.inert = inert; delete host._meldexHistoryRestoreLock;
      }
      if (host && editable !== null && host.dataset?.path === path && host._openPageLoadSeq === generation) {
        host.contentEditable = editable;
        (islands || []).forEach(island => { if (host.contains(island)) island.contentEditable = 'true'; });
      }
    });
  }

  function renderHost(host, path, markdown, result, preservePainted = false) {
    if (!host || normalizePath(host.dataset?.path) !== normalizePath(path)) return;
    const savedMarkdown = result?.savedMd != null ? result.savedMd : markdown;
    const painted = preservePainted && global.MeldexNoteSaveAdapter?.serialize?.(host) === savedMarkdown;
    if (!painted && !global.MeldexNoteSaveAdapter?.renderSavedMarkdownIntoCleanHost?.(host, path, savedMarkdown)) {
      throw new Error('ノートの表示を安全に更新できないため、再読込してください');
    }
    host.dataset.lastSavedMd = savedMarkdown;
    if (result?.etag) host.dataset.lastSavedEtag = result.etag;
    if (result?.transport_revision) {
      const revision = result.transport_revision;
      host.dataset.lastSavedTransportRevision = global.MeldexDocumentSaveCoordinator?.normalizeTransportRevision?.(
        global.MeldexDocumentSaveCoordinator.currentTransportName(), revision,
      ) || (typeof revision === 'string' ? revision : `${revision.transport || 'local-etag'}:${revision.token || revision.etag || ''}`);
    }
    global.MeldexImageLoading?.trackAll?.(host);
  }

  async function restore(path, markdown, options = {}) {
    // 「すべて」履歴から別タブへ移動した直後はopenPage()が非同期読込中になり得る。
    // 対象ホストのpath確定を待ってからDOMと保存先を同じ版へ戻す。
    const hosts = await waitForHost(path, 3000, options.aliases || []);
    assertHostsAreSaved(path, hosts, {
      content:markdown,if_match_etag:options.expectedRevision?.etag,expected_content:options.expectedContent,
    });
    const originals = new Map(hosts.map(host => [host, global.MeldexNoteSaveAdapter?.serialize?.(host)]));
    const locks = lockHosts(hosts), pending = new Map();
    try {
      const host = hosts[0] || null;
      let result;
      const revision = options.expectedRevision;
      const extra = revision ? {
        if_match_etag: revision.etag,
        transport_revision: revision.transport_revision || global.MeldexDocumentSaveCoordinator?.normalizeTransportRevision?.(
          global.MeldexDocumentSaveCoordinator.currentTransportName(), revision.etag,
        ) || revision.etag,
      } : {};
      if (typeof options.expectedContent === 'string') extra.expected_content = options.expectedContent;
      if (host && global.MeldexNoteSaveAdapter?.performSave) {
        const saving = global.MeldexNoteSaveAdapter.performSave(host, path, markdown, { reason: 'history', ...(extra ? {extra} : {}) });
        // Remote persistence can take seconds. Paint the requested state while
        // keeping its old saved baseline, revision and locked editor until ACK.
        if (global.MeldexRuntimeAdapter?.isBrowserDataMode?.()) {
          for (const item of hosts) {
            try {
              if (global.MeldexNoteSaveAdapter.renderSavedMarkdownIntoCleanHost?.(item, item.dataset.path, markdown)) {
                pending.set(item, { serialized:global.MeldexNoteSaveAdapter.serialize(item), path:item.dataset.path,
                  generation:item._openPageLoadSeq });
              }
            } catch {
              // Rendering cannot abandon a write already submitted to storage.
              try { global.MeldexNoteSaveAdapter.renderSavedMarkdownIntoCleanHost?.(item,item.dataset.path,originals.get(item)); } catch {}
            }
          }
        }
        if (pending.size) global.showStatus?.('履歴の変更を保存中...');
        result = await saving;
      } else {
        const current = revision || await global.apiFetch('/file?path=' + encodeURIComponent(path));
        result = await global.apiPut('/file?path=' + encodeURIComponent(path), {
          content: markdown,
          if_match_etag: current?.etag || '',
          transport_revision: current?.transport_revision || '',
          skip_if_missing: true,
          ...(extra || {}),
        });
      }
      if (result?.conflictPending || result?.skipped || result?.missing) {
        throw new Error('ノートの履歴を保存先へ反映できませんでした');
      }
      options.onSaved?.(result);
      // 保存待ち中に同じノートを別パネルで開くことがある。途中参加ホストを再検査し、
      // 未保存入力があればDOMを上書きせずドラフトへ保護する。
      const latestHosts = partitionHostsAfterRestore(path, matchingHosts(path, options.aliases || []), originals, result, pending);
      latestHosts.clean.forEach((item) => renderHost(item, item.dataset?.path || path, markdown, result, pending.has(item)));
      if (!latestHosts.dirty.length) {
        for (const savedPath of new Set([path, ...latestHosts.clean.map(item => item.dataset?.path).filter(Boolean)])) {
          await global.MeldexDraftRecovery?.markSynced?.(savedPath);
        }
      }
      global.markAutoVersionDirty?.(path, 'file');
      return true;
    } catch (error) {
      for (const [item, painted] of pending) {
        if (item.dataset?.path !== painted.path || item._openPageLoadSeq !== painted.generation) continue;
        const current = global.MeldexNoteSaveAdapter?.serialize?.(item);
        if (current === painted.serialized) {
          global.MeldexNoteSaveAdapter?.renderSavedMarkdownIntoCleanHost?.(item, painted.path, originals.get(item));
        } else if (current != null) {
          global.MeldexDraftRecovery?.queueDraft?.(painted.path, current, item.dataset?.lastSavedMd || '');
        }
      }
      throw error;
    } finally {
      unlockHosts(locks);
    }
  }

  function reserveSavedEdit(path) {
    return global.historyReserve?.('ページ編集', scope(path), '保存待ち');
  }

  function recordSavedEdit(path, beforeMarkdown, afterMarkdown, detail) {
    if (typeof global.historyPush !== 'function' || beforeMarkdown === afterMarkdown) return false;
    global.historyPush(
      'ページ編集',
      () => restore(path, beforeMarkdown),
      () => restore(path, afterMarkdown),
      scope(path),
      detail || '内容を更新',
    );
    return true;
  }

  async function restoreExternalCsv(path, content, options) {
    const csv = global.MeldexCsvHost?.getState?.();
    const paths = [path, ...(options.aliases || [])];
    if (csv?.dirty && paths.map(normalizePath).includes(normalizePath(csv.path))) {
      throw new Error('CSVに未保存の編集があるため、先に保存してから履歴を復元してください');
    }
    if (csv?.saving && paths.map(normalizePath).includes(normalizePath(csv.path))) {
      throw new Error('CSVに保存待ちの編集があるため、保存が終わってから履歴を復元してください');
    }
    const revision = options.expectedRevision;
    const transport = revision.transport_revision || global.MeldexDocumentSaveCoordinator?.normalizeTransportRevision?.(
      global.MeldexDocumentSaveCoordinator.currentTransportName(), revision.etag,
    ) || revision.etag;
    const result = await global.apiPut('/file?path=' + encodeURIComponent(path), {
      content, if_match_etag:revision.etag, transport_revision:transport, skip_if_missing:true,
      expected_content:options.expectedContent,
    });
    if (result?.conflictPending || result?.skipped || result?.missing) {
      throw new Error('CSVの履歴を保存先へ反映できませんでした');
    }
    options.onSaved?.(result);
    if (!global.MeldexCsvHost?.applyExternalSavedContent?.(paths, content, result)) {
      await global.reloadOpenFilesAfterExternalMutation?.(paths);
    }
    global.markAutoVersionDirty?.(path, 'file');
    return true;
  }

  function recordExternalSavedEdit(path, beforeMarkdown, afterMarkdown, revision, aliases = []) {
    if (!revision?.etag || typeof global.historyPush !== 'function' || beforeMarkdown === afterMarkdown) return false;
    let expectedRevision = revision;
    let expectedContent = afterMarkdown;
    const csv = /\.csv$/i.test(path);
    const restoreSaved = csv ? restoreExternalCsv : restore;
    const knownRevision = (etag, transport = '') => {
      const coordinator = global.MeldexDocumentSaveCoordinator;
      const token = transport && coordinator?.revisionTokenForWrite
        ? coordinator.revisionTokenForWrite(transport, coordinator.currentTransportName()) : etag;
      return {etag:token || etag,transport_revision:transport};
    };
    const apply = markdown => () => {
      let currentRevision = expectedRevision;
      // A later local edit followed by its undo advances the file revision.
      // Use that acknowledged revision only when its exact saved content still
      // equals the state this history entry expects; a foreign baseline cannot rebase it.
      if (csv) {
        const state = global.MeldexCsvHost?.getState?.();
        if (state?.etag && !state.dirty && !state.saving && state.savedContent === expectedContent
            && [path, ...aliases].map(normalizePath).includes(normalizePath(state.path))) {
          currentRevision = knownRevision(state.etag, state.transport_revision || '');
        }
      } else {
        const host = matchingHosts(path, aliases).find(host => host.dataset?.lastSavedEtag
          && host.dataset.lastSavedMd === expectedContent
          && (typeof global.MeldexNoteSaveAdapter?.isUnchanged === 'function'
            ? global.MeldexNoteSaveAdapter.isUnchanged(host, global.MeldexNoteSaveAdapter.serialize(host))
            : global.MeldexNoteSaveAdapter?.serialize?.(host) === expectedContent));
        if (host) currentRevision = knownRevision(host.dataset.lastSavedEtag, host.dataset.lastSavedTransportRevision || '');
      }
      return restoreSaved(path, markdown, {
        expectedRevision:currentRevision, expectedContent, aliases,
        onSaved: result => {
          if (!result?.etag) throw new Error('保存結果の版を確認できません');
          expectedRevision = knownRevision(result.etag,result.transport_revision || '');
          expectedContent = result.savedMd ?? markdown;
        },
      });
    };
    global.historyPush('AIの変更: ' + String(path).split(/[\\/]/).pop(),
      apply(beforeMarkdown), apply(afterMarkdown), csv ? 'csv:' + path : scope(path), 'AIが保存したファイルの内容');
    return true;
  }

  function applyAcknowledgedCloudChange(change, path, aliases) {
    if (!global.MeldexRuntimeAdapter?.isBrowserDataMode?.() || !change.before_etag) return;
    const adapter = global.MeldexNoteSaveAdapter;
    // The UI decoder may remove a UTF-8 marker and normalize line endings.
    // Compare only those representations; preserve all meaningful whitespace.
    const comparable = text => String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    for (const host of matchingHosts(path, aliases)) {
      if (host.dataset.lastSavedEtag !== change.before_etag) continue;
      const current = adapter?.serialize?.(host), baseline = host.dataset.lastSavedMd || '';
      const clean = typeof adapter?.isUnchanged === 'function' ? adapter.isUnchanged(host, current) : current === baseline;
      if (!clean || comparable(baseline) !== comparable(change.before_content)) continue;
      try {
        renderHost(host,host.dataset.path,change.after_content,{
          etag:change.after_etag,transport_revision:change.after_transport_revision,
        });
      } catch (error) {
        global.showStatus?.('AIの保存結果を表示へ反映できませんでした: '+(error?.message||error),true);
      }
    }
  }

  const seenExternalEdits = new Set();
  global.meldexApplyLlmFileChange = change => {
    if (change?.type !== 'meldex_file_changed' || !change.path || !change.after_etag
        || typeof change.before_content !== 'string' || typeof change.after_content !== 'string') return false;
    const aliases = Array.isArray(change.path_aliases) ? change.path_aliases.filter(path => typeof path === 'string') : [];
    const csvPath = global.MeldexCsvHost?.getState?.().path;
    const path = csvPath && [change.path, ...aliases].map(normalizePath).includes(normalizePath(csvPath))
      ? csvPath : matchingHosts(change.path, aliases)[0]?.dataset?.path || change.path;
    const key = JSON.stringify([normalizePath(change.path),change.seq,change.after_etag]);
    if (seenExternalEdits.has(key)) return false;
    const recorded = recordExternalSavedEdit(path,change.before_content,change.after_content,{etag:change.after_etag},aliases);
    if (recorded) {
      seenExternalEdits.add(key);
      if (seenExternalEdits.size > 200) seenExternalEdits.delete(seenExternalEdits.values().next().value);
      applyAcknowledgedCloudChange(change,path,aliases);
    }
    return recorded;
  };
  global.MeldexNoteHistory = Object.freeze({ scope, restore, reserveSavedEdit, recordSavedEdit, recordExternalSavedEdit });
})(window);
