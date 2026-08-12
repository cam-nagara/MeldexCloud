(function (global) {
  'use strict';

  const stateByRoot = new WeakMap();
  let legacyMigrationPromise = null;

  function _icon(name, size = 14) {
    return typeof global.lucide === 'function' ? global.lucide(name, size) : '';
  }

  function _injectStyle() {
    if (document.getElementById('unified-knowledge-status-style')) return;
    const style = document.createElement('style');
    style.id = 'unified-knowledge-status-style';
    style.textContent = `
      .uks-card{display:grid;gap:12px;margin:10px 0;padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--bg2)}
      .uks-head,.uks-actions,.uks-counts{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .uks-head{justify-content:space-between}.uks-title{font-weight:650;color:var(--fg)}
      .uks-state{display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:3px 9px;border-radius:999px;background:var(--bg3);color:var(--fg2);font-size:12px}
      .uks-state[data-tone="ok"]{color:var(--success,#16803b)}.uks-state[data-tone="error"]{color:var(--danger,#c43b3b)}
      .uks-count{min-width:88px;padding:8px 10px;border-radius:9px;background:var(--bg);border:1px solid var(--border)}
      .uks-count strong{display:block;font-size:18px;color:var(--fg)}.uks-count span{font-size:11px;color:var(--fg2)}
      .uks-message{font-size:12px;line-height:1.55;color:var(--fg2)}.uks-message[data-error="1"]{color:var(--danger,#c43b3b)}
      .uks-actions .gb-btn{min-height:var(--ui-h-touch,44px)!important;white-space:normal}
      @media (max-width:480px){.uks-card{padding:12px}.uks-head{align-items:flex-start}.uks-actions{display:grid;grid-template-columns:1fr;width:100%}.uks-actions .gb-btn{width:100%}.uks-count{flex:1;min-width:0}}
    `;
    document.head.appendChild(style);
  }

  function _shell(root) {
    root.innerHTML = `
      <section class="uks-card" aria-labelledby="uks-title">
        <div class="uks-head">
          <div><div id="uks-title" class="uks-title">${_icon('databaseZap')} 自動ナレッジ索引</div><div class="gb-section-desc">ファイル、シート・ボードの関係、画像候補を端末内で検索できる形にします。Dropbox利用時は再生成可能な軽量断片を端末間で共有します。</div></div>
          <span class="uks-state" data-uks-state role="status">確認中</span>
        </div>
        <div class="uks-counts" data-uks-counts></div>
        <div class="uks-message" data-uks-message aria-live="polite">状態を確認しています…</div>
        <div class="uks-actions">
          <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" aria-label="自動ナレッジ索引の状態を更新" title="自動ナレッジ索引の状態を更新" data-uks-action="refresh" data-e2e-id="settings-knowledge-index-refresh">${_icon('refreshCw')} 状態を更新</button>
          <button type="button" class="gb-btn gb-btn-sm" aria-label="自動ナレッジ索引をバックグラウンドで再構築" title="自動ナレッジ索引をバックグラウンドで再構築" data-uks-action="rebuild" data-e2e-id="settings-knowledge-index-rebuild">${_icon('rotateCcw')} バックグラウンドで再構築</button>
        </div>
      </section>`;
    root.querySelector('[data-uks-action="refresh"]')?.addEventListener('click', () => refresh(root));
    root.querySelector('[data-uks-action="rebuild"]')?.addEventListener('click', () => rebuild(root));
    if (typeof global.replaceIcons === 'function') global.replaceIcons(root);
  }

  function _setMessage(root, message, error = false) {
    const node = root.querySelector('[data-uks-message]');
    if (!node) return;
    node.textContent = String(message || '');
    node.dataset.error = error ? '1' : '0';
  }

  function _setState(root, text, tone = '') {
    const node = root.querySelector('[data-uks-state]');
    if (!node) return;
    node.textContent = String(text || '');
    node.dataset.tone = tone;
  }

  function _renderCounts(root, coverage) {
    const container = root.querySelector('[data-uks-counts]');
    if (!container) return;
    const kinds = coverage?.by_kind || {};
    const imageCount = Number(kinds.image || 0);
    const legacyCount = Number(kinds['legacy-knowledge'] || 0);
    const structureCount = ['sheet', 'smart-sheet', 'board', 'scenario'].reduce((sum, key) => sum + Number(kinds[key] || 0), 0);
    const values = [
      [Number(coverage?.total || 0), '参照可能'],
      [structureCount, '構造データ'],
      [imageCount, '画像'],
      [legacyCount, '記憶継承'],
    ];
    container.replaceChildren(...values.map(([count, label]) => {
      const box = document.createElement('div');
      box.className = 'uks-count';
      const strong = document.createElement('strong');
      strong.textContent = String(count);
      const span = document.createElement('span');
      span.textContent = label;
      box.append(strong, span);
      return box;
    }));
  }

  async function _role() {
    if (typeof global.apiFetch !== 'function') return 'viewer';
    try {
      const me = await global.apiFetch('/auth/me', { silentError: true });
      return String(me?.role || (me?.is_owner ? 'owner' : 'viewer')).toLowerCase();
    } catch {
      return 'viewer';
    }
  }

  async function _migrateLegacyOnce(role) {
    const client = global.MeldexUnifiedKnowledgeClient;
    if (!client?.isAvailable?.() || !['owner', 'admin'].includes(role) || typeof global.apiFetch !== 'function') return null;
    if (legacyMigrationPromise) return legacyMigrationPromise;
    legacyMigrationPromise = (async () => {
      const payload = await global.apiFetch('/knowledge_items?include_superseded=false', { silentError: true });
      return client.migrateLegacyItems(payload?.items || []);
    })();
    try {
      return await legacyMigrationPromise;
    } catch (error) {
      legacyMigrationPromise = null;
      return { error: error?.message || String(error) };
    }
  }

  async function refresh(root) {
    const client = global.MeldexUnifiedKnowledgeClient;
    const portable = !!global.MeldexPortableKnowledge?.isAvailable?.();
    if (!client?.isAvailable?.()) {
      _setState(root, '端末内で利用', 'ok');
      _setMessage(root, 'この保存方式では端末内の索引を使います。Cloud同期サービスを接続すると、同じ権限の端末間で共有できます。');
      root.querySelector('[data-uks-action="rebuild"]')?.setAttribute('hidden', '');
      return;
    }
    const state = stateByRoot.get(root) || {};
    if (state.loading) return;
    state.loading = true;
    stateByRoot.set(root, state);
    _setState(root, '更新中');
    _setMessage(root, '新しい変更を確認しています…');
    try {
      const role = portable ? 'owner' : await _role();
      const rebuildButton = root.querySelector('[data-uks-action="rebuild"]');
      if (rebuildButton) rebuildButton.hidden = !['owner', 'admin'].includes(role);
      await _migrateLegacyOnce(role);
      const coverage = await client.coverage();
      _renderCounts(root, coverage);
      const job = coverage?.latest_job;
      const partialFailures = Number(job?.result?.artifacts?.failed || 0);
      if (job?.state === 'failed') {
        _setState(root, '要確認', 'error');
        _setMessage(root, `前回の再構築に失敗しました。${job.error || '再試行してください。'}`, true);
      } else if (partialFailures > 0) {
        _setState(root, '一部を確認', 'error');
        _setMessage(root, `${partialFailures}件を索引化できませんでした。元ファイルは変更されていません。再構築またはファイル形式を確認してください。`, true);
      } else if (['queued', 'running'].includes(job?.state)) {
        _setState(root, 'バックグラウンド更新中');
        _setMessage(root, '編集はそのまま続けられます。完了後に件数を更新します。');
        clearTimeout(state.pollTimer);
        state.pollTimer = setTimeout(() => root.isConnected && refresh(root), 1500);
      } else {
        _setState(root, '利用可能', 'ok');
        const syncedAt = coverage?.last_sync?.at || job?.updated_at || '';
        const when = syncedAt ? new Date(syncedAt).toLocaleString() : '起動時に自動更新';
        const sharing = portable
          ? (global.MeldexRuntimeAdapter?.isDropboxMode?.()
            ? 'Dropbox内の軽量ナレッジ断片と端末内索引を併用しています。'
            : '索引はこの端末内に保存され、オフラインでも利用できます。')
          : '権限付き共有索引を利用しています。';
        _setMessage(root, `${sharing} 編集内容は待たずに保存され、索引は操作を妨げない時間に追従します。最終確認: ${when}`);
      }
    } catch (error) {
      _setState(root, '接続を確認', 'error');
      _setMessage(root, error?.message || String(error), true);
    } finally {
      state.loading = false;
    }
  }

  async function rebuild(root) {
    const client = global.MeldexUnifiedKnowledgeClient;
    const button = root.querySelector('[data-uks-action="rebuild"]');
    if (!client?.isAvailable?.() || button?.disabled) return;
    if (button) button.disabled = true;
    _setState(root, '開始中');
    _setMessage(root, 'バックグラウンド再構築を開始しています…');
    try {
      await client.rebuild();
      await refresh(root);
    } catch (error) {
      _setState(root, '開始できません', 'error');
      _setMessage(root, error?.message || String(error), true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function mount(root) {
    const target = root?.matches?.('[data-unified-knowledge-status]')
      ? root
      : root?.querySelector?.('[data-unified-knowledge-status]');
    if (!target) return;
    _injectStyle();
    _shell(target);
    if (!target.dataset.portableKnowledgeListener) {
      target.dataset.portableKnowledgeListener = '1';
      global.addEventListener('meldex:portable-knowledge-updated', () => target.isConnected && refresh(target));
    }
    refresh(target);
  }

  global.MeldexUnifiedKnowledgeStatus = Object.freeze({ mount, refresh });
})(window);
