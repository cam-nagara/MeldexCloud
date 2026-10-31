/* ノートの操作履歴を文書単位で保存・復元する。 */
(function initMeldexNoteHistory(global) {
  'use strict';

  function normalizePath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  }

  function scope(path) {
    return `page:${normalizePath(path)}`;
  }

  function matchingHosts(path) {
    const normalized = normalizePath(path);
    // 公開設定・ツリー等にもdata-pathがある。本文ホストだけを保存・ロック・復元する。
    return Array.from(global.document?.querySelectorAll?.('#page-content[data-path], #dp-editable[data-path], #entity-freetext[data-path], .meldex-entity-detail-editor[data-path]') || [])
      .filter((host) => normalizePath(host?.dataset?.path) === normalized && host?.dataset?.loadFailed !== '1');
  }

  async function waitForHost(path, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    let hosts = matchingHosts(path);
    while (!hosts.length && Date.now() < deadline) {
      await new Promise((resolve) => global.setTimeout(resolve, 30));
      hosts = matchingHosts(path);
    }
    return hosts;
  }

  function assertHostsAreSaved(path, hosts) {
    const adapter = global.MeldexNoteSaveAdapter;
    if (typeof adapter?.serialize !== 'function') return;
    for (const host of hosts) {
      let liveMarkdown;
      try {
        liveMarkdown = adapter.serialize(host);
      } catch {
        throw new Error('ノートの編集中内容を確認できないため、履歴の復元を中止しました');
      }
      if (liveMarkdown !== (host.dataset?.lastSavedMd || '')) {
        throw new Error('同じノートに未保存の編集があるため、先に保存してから履歴を復元してください');
      }
    }
  }

  function partitionHostsAfterRestore(path, hosts, originals = new Map(), result = null) {
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
      const unchanged = original != null ? (liveMarkdown === original || liveMarkdown === acknowledged) : liveMarkdown === baseline;
      if (liveMarkdown === null || !unchanged) {
        dirty.push({ host, liveMarkdown, baseline });
      } else {
        clean.push(host);
      }
    });
    dirty.forEach(({ liveMarkdown, baseline }) => {
      if (liveMarkdown !== null) global.MeldexDraftRecovery?.queueDraft?.(path, liveMarkdown, baseline);
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
      return { host, editable, islands, path: host.dataset?.path, generation: host._openPageLoadSeq };
    });
  }

  function unlockHosts(locks) {
    locks.forEach(({ host, editable, islands, path, generation }) => {
      if (host && editable !== null && host.dataset?.path === path && host._openPageLoadSeq === generation) {
        host.contentEditable = editable;
        (islands || []).forEach(island => { if (host.contains(island)) island.contentEditable = 'true'; });
      }
    });
  }

  function renderHost(host, path, markdown, result) {
    if (!host || normalizePath(host.dataset?.path) !== normalizePath(path)) return;
    const savedMarkdown = result?.savedMd != null ? result.savedMd : markdown;
    if (!global.MeldexNoteSaveAdapter?.renderSavedMarkdownIntoCleanHost?.(host, path, savedMarkdown)) {
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

  async function restore(path, markdown) {
    // 「すべて」履歴から別タブへ移動した直後はopenPage()が非同期読込中になり得る。
    // 対象ホストのpath確定を待ってからDOMと保存先を同じ版へ戻す。
    const hosts = await waitForHost(path);
    assertHostsAreSaved(path, hosts);
    const originals = new Map(hosts.map(host => [host, global.MeldexNoteSaveAdapter?.serialize?.(host)]));
    const locks = lockHosts(hosts);
    try {
      const host = hosts[0] || null;
      let result;
      if (host && global.MeldexNoteSaveAdapter?.performSave) {
        result = await global.MeldexNoteSaveAdapter.performSave(host, path, markdown, { reason: 'history' });
      } else {
        const current = await global.apiFetch('/file?path=' + encodeURIComponent(path));
        result = await global.apiPut('/file?path=' + encodeURIComponent(path), {
          content: markdown,
          if_match_etag: current?.etag || '',
          transport_revision: current?.transport_revision || '',
          skip_if_missing: true,
        });
      }
      if (result?.conflictPending || result?.skipped || result?.missing) {
        throw new Error('ノートの履歴を保存先へ反映できませんでした');
      }
      // 保存待ち中に同じノートを別パネルで開くことがある。途中参加ホストを再検査し、
      // 未保存入力があればDOMを上書きせずドラフトへ保護する。
      const latestHosts = partitionHostsAfterRestore(path, matchingHosts(path), originals, result);
      latestHosts.clean.forEach((item) => renderHost(item, path, markdown, result));
      if (!latestHosts.dirty.length) await global.MeldexDraftRecovery?.markSynced?.(path);
      global.markAutoVersionDirty?.(path, 'file');
      return true;
    } finally {
      unlockHosts(locks);
    }
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

  global.MeldexNoteHistory = Object.freeze({ scope, restore, recordSavedEdit });
})(window);
