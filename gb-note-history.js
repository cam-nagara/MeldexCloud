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
    return Array.from(global.document?.querySelectorAll?.('[data-path]') || [])
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

  function partitionHostsAfterRestore(path, hosts) {
    const adapter = global.MeldexNoteSaveAdapter;
    if (typeof adapter?.serialize !== 'function') return { clean: hosts, dirty: [] };
    const clean = [];
    const dirty = [];
    hosts.forEach((host) => {
      let liveMarkdown = null;
      try { liveMarkdown = adapter.serialize(host); } catch {}
      const baseline = host.dataset?.lastSavedMd || '';
      if (liveMarkdown === null || liveMarkdown !== baseline) {
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
      host.contentEditable = 'false';
      return { host, editable };
    });
  }

  function unlockHosts(locks) {
    locks.forEach(({ host, editable }) => {
      if (host && editable !== null) host.contentEditable = editable;
    });
  }

  function renderHost(host, path, markdown, result) {
    if (!host || normalizePath(host.dataset?.path) !== normalizePath(path)) return;
    if (!global.MeldexNoteSaveAdapter?.renderSavedMarkdownIntoCleanHost?.(host, path, markdown)) {
      throw new Error('ノートの表示を安全に更新できないため、再読込してください');
    }
    host.dataset.lastSavedMd = result?.savedMd != null ? result.savedMd : markdown;
    if (result?.etag) host.dataset.lastSavedEtag = result.etag;
    if (result?.transport_revision) host.dataset.lastSavedTransportRevision = result.transport_revision;
    global.MeldexImageLoading?.trackAll?.(host);
  }

  async function restore(path, markdown) {
    // 「すべて」履歴から別タブへ移動した直後はopenPage()が非同期読込中になり得る。
    // 対象ホストのpath確定を待ってからDOMと保存先を同じ版へ戻す。
    const hosts = await waitForHost(path);
    assertHostsAreSaved(path, hosts);
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
      const latestHosts = partitionHostsAfterRestore(path, matchingHosts(path));
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
