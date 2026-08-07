// =====================================================================
// gb-backlinks.js — §12.5 バックリンク表示 + 全ファイルバックリンク(計画書§11 Phase5)
// 計画書: app/docs/debuglist-calendar-linkage-plan.md §12.5
//         app/docs/file-reference-integrity-and-backlinks-plan-2026-07-31.md §11
//
// 2系統の呼び出しをサポートする:
//   1. レガシー経路: render(pathString, container) — GET /backlinks?target=
//      （エントリ/ページ単一パス文字列。既存呼び出し元・既存E2Eをそのまま維持）
//   2. OptionTargetContext経路: render({targets, selectionRevision}, container)
//      — POST /backlinks/query（全ファイル種別・複数選択・索引カバレッジ対応）
// パスベース運用。リネーム追従なし（R13 確定）→ リンク切れは可視化。
// =====================================================================
(function () {
  'use strict';

  let _currentTarget = null;    // レガシー経路の現在対象（文字列）。stale応答破棄に使用
  let _currentRenderArg = null; // 直近の render() 引数（再構築ボタンの再取得に使用）

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _resolveBacklinkOpenType(item) {
    const entryType = item?.entry_type || '';
    if (entryType === 'settings-entry') return 'entity';
    if (entryType === 'settings-db') return 'pivot';
    if (entryType === 'board') return 'board';
    const path = String(item?.source_path || '').replace(/\\/g, '/');
    if (_folderNoteDbPath(path)) return 'pivot';
    const lower = path.toLowerCase();
    if (lower.endsWith('.mel-scenario') || lower.endsWith('.scriptnote.json')) return 'scriptnote';
    if (lower.endsWith('.mel-sheet') || lower.endsWith('.smart-db.json')) return 'smart-db';
    if (lower.endsWith('.mel-timer') || lower.endsWith('.timer.json')) return 'timer';
    if (lower.endsWith('.mel-board') || lower.endsWith('.board.json') || lower.endsWith('.canvas.json')) return 'board';
    const ext = (path.split('.').pop() || '').toLowerCase();
    if (ext === 'board') return 'board';
    if (ext === 'csv') return 'csv';
    if (ext === 'html' || ext === 'htm') return 'html';
    if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'avif'].includes(ext)) return 'image';
    if (['mp4', 'webm', 'ogv', 'mov', 'avi'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'].includes(ext)) return 'audio';
    return 'page';
  }

  function _folderNoteDbPath(path) {
    const safePath = String(path || '').replace(/\\/g, '/');
    const parts = safePath.split('/').filter(Boolean);
    if (parts.length < 2) return '';
    const file = parts[parts.length - 1] || '';
    if (!file.toLowerCase().endsWith('.md')) return '';
    const stem = file.slice(0, -3);
    const folder = parts[parts.length - 2] || '';
    if (stem !== folder) return '';
    return parts.slice(0, -1).join('/');
  }

  // 順方向変換（_folderNoteDbPath の逆）: DBフォルダの現在pathから、対応する
  // フォルダノート(.md)のpathを組み立てる。シート(DB)選択時にバックリンクの
  // 対象pathとして使う（計画書§11.1、選択対象の取り違え解消の一環）。
  function dbFolderNotePath(dbPath) {
    const safePath = String(dbPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (!safePath) return '';
    const name = safePath.split('/').pop() || safePath;
    return safePath + '/' + name + '.md';
  }

  function _resolveBacklinkOpenPath(item, openType) {
    const path = String(item?.source_path || '').replace(/\\/g, '/');
    if (openType === 'pivot') return _folderNoteDbPath(path) || path;
    return path;
  }

  function _openBacklink(item) {
    if (!item || !item.exists) return;
    const openType = _resolveBacklinkOpenType(item);
    const path = _resolveBacklinkOpenPath(item, openType);
    if (!path) return;
    const name = item.display_name || path.split('/').pop().replace(/\.md$/, '');
    try {
      if (typeof navOpen === 'function') {
        navOpen({
          type: openType,
          label: name,
          path,
          mediaType: openType === 'image' || openType === 'video' || openType === 'audio' ? openType : '',
        });
      } else if (openType === 'entity' && typeof selectEntity === 'function') {
        selectEntity(path);
      } else if (openType === 'pivot' && typeof selectDatabase === 'function') {
        selectDatabase(path);
      } else if (typeof openPage === 'function') {
        openPage(name, path);
      }
    } catch (e) { console.warn('[backlinks] open failed', e); }
  }

  function _typeLabel(linkType) {
    return linkType === 'body' ? '本文' : (linkType === 'url-prop' ? 'URL' : (linkType || ''));
  }

  // 単一参照元が複数箇所から対象を参照している場合の出現数表示
  // （計画書§7.1「UIは参照元単位へ集約し、出現数を表示する」）。
  function _metaHtml(item) {
    const locations = Array.isArray(item.locations) && item.locations.length
      ? item.locations
      : (item.link_type != null ? [{ link_type: item.link_type, location: item.link_location }] : []);
    if (!locations.length) return '';
    if (locations.length === 1) {
      const loc = locations[0];
      const locStr = loc.location ? ` / ${_esc(loc.location)}` : '';
      return `<div class="gb-backlink-meta">${_esc(_typeLabel(loc.link_type))}${locStr}</div>`;
    }
    const typeLabels = [...new Set(locations.map(loc => _typeLabel(loc.link_type)))].filter(Boolean);
    return `<div class="gb-backlink-meta">${locations.length}箇所${typeLabels.length ? `（${_esc(typeLabels.join('、'))}）` : ''}</div>`;
  }

  function _countBadgeHtml(item) {
    const count = Number(item.occurrence_count
      || (Array.isArray(item.locations) ? item.locations.length : 1)) || 1;
    if (count <= 1) return '';
    return `<span class="gb-backlink-count-badge" title="${count}箇所から参照">${count}件</span>`;
  }

  function _rowHtml(item, idx) {
    const broken = !item.exists;
    const displayName = item.display_name || item.source_path;
    const title = broken ? 'リンク切れ（参照元ファイルが存在しません）' : 'クリックで開く';
    const openType = _resolveBacklinkOpenType(item);
    const openPath = broken ? '' : _resolveBacklinkOpenPath(item, openType);
    const rowClass = broken ? 'gb-backlink-row gb-backlink-row--broken' : 'gb-backlink-row gb-backlink-row--openable';
    const rowAttrs = broken ? '' : ` role="button" tabindex="0" aria-label="${_esc(displayName)}を開く"`;
    const brokenBadge = broken ? `<span class="gb-backlink-broken-badge">(リンク切れ)</span>` : '';
    return `<li data-idx="${idx}" class="${rowClass}" data-e2e-id="backlink-row-${idx + 1}"${rowAttrs}>
        <span class="bl-link gb-backlink-label" data-path="${_esc(openPath)}" data-link-type="${_esc(openType)}" title="${_esc(title)}">${_esc(displayName)}</span>
        ${_countBadgeHtml(item)}
        ${brokenBadge}
        ${_metaHtml(item)}
        <div class="gb-backlink-path">${_esc(item.source_path)}</div>
      </li>`;
  }

  // 索引が不完全な時に「参照0件」を確定した0件のように見せない
  // （計画書 設計原則6・受け入れ条件「索引不完全の0件誤表示0」）。
  function _emptySectionHtml(coverage) {
    const status = coverage && coverage.status ? coverage.status : 'complete';
    if (status !== 'complete') {
      return `<li class="gb-backlinks-empty" data-e2e-id="backlinks-empty-unconfirmed">索引が不完全なため、参照の有無を確定できません</li>`;
    }
    return `<li class="gb-backlinks-empty">このファイルを貼っているファイルはありません</li>`;
  }

  function _coverageNoteHtml(coverage) {
    const status = coverage && coverage.status ? coverage.status : 'complete';
    if (status === 'complete') return '';
    const message = status === 'partial'
      ? '一部のファイルを解析できていません。参照が正しく表示されていない可能性があります。'
      : '索引が最新でない可能性があります。「全体再構築」で更新できます。';
    return `<div class="gb-backlinks-coverage-note" data-e2e-id="backlinks-coverage-note">${_esc(message)}</div>`;
  }

  function _rebuildButtonHtml() {
    return `<button class="gb-btn gb-btn-sm" type="button" data-action="backlinksRebuild" data-e2e-id="backlinks-rebuild" aria-label="バックリンクを全体再構築" title="バックリンクを全体再構築">全体再構築</button>`;
  }

  function _bindRebuildButton(container, onRebuilt) {
    const rbBtn = container.querySelector('[data-action="backlinksRebuild"]');
    if (!rbBtn) return;
    rbBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      rbBtn.disabled = true;
      rbBtn.textContent = '再構築中...';
      try {
        const r = await apiPost('/backlinks/rebuild', {});
        if (r && r.ok) {
          await onRebuilt();
        } else {
          const reason = r?.error || r?.reason || '不明なエラー';
          if (typeof showStatus === 'function') showStatus('バックリンク再構築に失敗しました: ' + reason, true);
        }
      } catch (err) {
        console.warn('[backlinks] rebuild failed', err);
        if (typeof showStatus === 'function') showStatus('バックリンク再構築に失敗しました: ' + (err?.message || err), true);
      } finally {
        rbBtn.disabled = false;
        rbBtn.textContent = '全体再構築';
      }
    });
  }

  function _bindRows(container, items) {
    container.querySelectorAll('.gb-backlink-row--openable').forEach(li => {
      const idx = parseInt(li.dataset.idx, 10);
      const it = items[idx];
      if (!it || !it.exists) return;
      li.addEventListener('click', () => _openBacklink(it));
      li.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        _openBacklink(it);
      });
    });
  }

  // ---- レガシー経路（単一パス文字列、GET /backlinks?target=） ----

  function _renderLegacyList(container, data) {
    const items = (data && data.items) || [];
    const allItems = [];
    const rows = items.length
      ? items.map(it => _rowHtml(it, allItems.push(it) - 1)).join('')
      : `<li class="gb-backlinks-empty">このエントリへの参照はありません</li>`;
    container.innerHTML = `
      <div class="gb-backlinks-header">
        <span class="gb-backlinks-title">バックリンク</span>
        <span class="gb-backlinks-count">${items.length}件</span>
        <span class="gb-backlinks-spacer"></span>
        ${_rebuildButtonHtml()}
      </div>
      <ul class="gb-backlinks-list">${rows}</ul>`;
    _bindRows(container, allItems);
    _bindRebuildButton(container, () => renderBacklinksLegacy(_currentTarget, container));
  }

  async function renderBacklinksLegacy(targetPath, container) {
    if (!container) return;
    _currentTarget = targetPath;
    if (!targetPath) {
      container.innerHTML = `<div style="padding:var(--ui-space-4);color:var(--fg2);">エントリ未選択</div>`;
      return;
    }
    container.innerHTML = `<div style="padding:var(--ui-space-4);color:var(--fg2);">読み込み中...</div>`;
    try {
      const url = '/backlinks?target=' + encodeURIComponent(targetPath);
      const data = await apiFetch(url);
      if (_currentTarget !== targetPath) return; // 遷移していたら破棄
      _renderLegacyList(container, data);
    } catch (e) {
      if (_currentTarget !== targetPath) return;
      container.innerHTML = `<div style="padding:var(--ui-space-4);color:var(--danger,#f44);">取得失敗: ${_esc(String(e))}</div>`;
    }
  }

  // ---- OptionTargetContext経路（全ファイル種別・複数選択、POST /backlinks/query） ----

  function _targetDisplayName(target) {
    const path = String(target?.path || '');
    return path.split('/').pop() || path || '(不明なファイル)';
  }

  function _renderGroupedResult(container, responseData) {
    const targetResults = (responseData && responseData.targets) || [];
    const coverage = responseData && responseData.coverage;
    const allItems = [];
    const totalCount = targetResults.reduce((sum, t) => sum + ((t.items || []).length), 0);
    const showGroupHeaders = targetResults.length > 1;
    const groupsHtml = targetResults.map(targetResult => {
      const items = targetResult.items || [];
      const rows = items.length
        ? items.map(it => _rowHtml(it, allItems.push(it) - 1)).join('')
        : _emptySectionHtml(coverage);
      const groupHeader = showGroupHeaders
        ? `<div class="gb-backlinks-group-header">${_esc(_targetDisplayName(targetResult.target))}<span class="gb-backlinks-count">${items.length}件</span></div>`
        : '';
      return `<div class="gb-backlinks-group">${groupHeader}<ul class="gb-backlinks-list">${rows}</ul></div>`;
    }).join('');
    container.innerHTML = `
      <div class="gb-backlinks-header">
        <span class="gb-backlinks-title">バックリンク</span>
        <span class="gb-backlinks-count">${totalCount}件</span>
        <span class="gb-backlinks-spacer"></span>
        ${_rebuildButtonHtml()}
      </div>
      ${_coverageNoteHtml(coverage)}
      ${groupsHtml}`;
    _bindRows(container, allItems);
    _bindRebuildButton(container, () => renderBacklinksContext(_currentRenderArg, container));
  }

  async function renderBacklinksContext(ctx, container) {
    if (!container) return;
    const targets = (ctx && ctx.targets) || [];
    const revision = ctx ? ctx.selectionRevision : 0;
    if (!targets.length) {
      container.innerHTML = `<div style="padding:var(--ui-space-4);color:var(--fg2);">ファイルが選択されていません</div>`;
      return;
    }
    container.innerHTML = `<div style="padding:var(--ui-space-4);color:var(--fg2);">読み込み中...</div>`;
    const isStale = () => window.GBOptionTargetContext
      && typeof window.GBOptionTargetContext.isCurrentRevision === 'function'
      && !window.GBOptionTargetContext.isCurrentRevision(revision);
    try {
      const data = await apiPost('/backlinks/query', { targets, selectionRevision: revision });
      if (isStale()) return; // 選択が高速に切り替わった場合、遅れて返った旧結果は表示しない
      _renderGroupedResult(container, data);
    } catch (e) {
      if (isStale()) return;
      container.innerHTML = `<div style="padding:var(--ui-space-4);color:var(--danger,#f44);">取得失敗: ${_esc(String(e))}</div>`;
    }
  }

  // ---- 公開API ----

  async function renderBacklinks(targetOrContext, container) {
    if (!container) return;
    _currentRenderArg = targetOrContext;
    if (typeof targetOrContext === 'string' || targetOrContext == null) {
      return renderBacklinksLegacy(targetOrContext, container);
    }
    return renderBacklinksContext(targetOrContext, container);
  }

  async function updateBacklinksFor(path) {
    if (!path) return;
    try {
      await apiPost('/backlinks/update', { path });
    } catch (e) { /* best-effort */ }
  }

  window.GbBacklinks = {
    render: renderBacklinks,
    requestUpdate: updateBacklinksFor,
    getCurrentTarget: () => _currentTarget,
    dbFolderNotePath,
  };
})();
