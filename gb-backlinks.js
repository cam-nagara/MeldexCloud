// =====================================================================
// gb-backlinks.js — §12.5 バックリンク表示
// 計画書: app/docs/debuglist-calendar-linkage-plan.md §12.5
// パスベース運用。リネーム追従なし（R13 確定）→ リンク切れは可視化。
// =====================================================================
(function () {
  'use strict';

  let _currentTarget = null;

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

  function _renderList(container, data) {
    const items = (data && data.items) || [];
    const rows = items.length ? items.map((it, idx) => {
      const broken = !it.exists;
      const loc = it.link_location ? ` / ${_esc(it.link_location)}` : '';
      const typeLabel = it.link_type === 'body' ? '本文' : (it.link_type === 'url-prop' ? 'URL' : it.link_type);
      const displayName = it.display_name || it.source_path;
      const title = broken ? 'リンク切れ（参照元ファイルが存在しません）' : 'クリックで開く';
      const openType = _resolveBacklinkOpenType(it);
      const openPath = broken ? '' : _resolveBacklinkOpenPath(it, openType);
      const rowClass = broken ? 'gb-backlink-row gb-backlink-row--broken' : 'gb-backlink-row gb-backlink-row--openable';
      const rowAttrs = broken
        ? ''
        : ` role="button" tabindex="0" aria-label="${_esc(displayName)}を開く"`;
      const brokenBadge = broken
        ? `<span class="gb-backlink-broken-badge">(リンク切れ)</span>` : '';
      return `<li data-idx="${idx}" class="${rowClass}" data-e2e-id="backlink-row-${idx + 1}"${rowAttrs}>
        <span class="bl-link gb-backlink-label" data-path="${_esc(openPath)}" data-link-type="${_esc(openType)}" title="${_esc(title)}">${_esc(displayName)}</span>
        ${brokenBadge}
        <div class="gb-backlink-meta">${_esc(typeLabel)}${loc}</div>
        <div class="gb-backlink-path">${_esc(it.source_path)}</div>
      </li>`;
    }).join('') : `<li class="gb-backlinks-empty">このエントリへの参照はありません</li>`;
    container.innerHTML = `
      <div class="gb-backlinks-header">
        <span class="gb-backlinks-title">バックリンク</span>
        <span class="gb-backlinks-count">${items.length}件</span>
        <span class="gb-backlinks-spacer"></span>
        <button class="gb-btn gb-btn-sm" type="button" data-action="backlinksRebuild" data-e2e-id="backlinks-rebuild" aria-label="バックリンクを全体再構築" title="バックリンクを全体再構築">全体再構築</button>
      </div>
      <ul class="gb-backlinks-list">${rows}</ul>`;
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
    const rbBtn = container.querySelector('[data-action="backlinksRebuild"]');
    if (rbBtn) rbBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      rbBtn.disabled = true;
      rbBtn.textContent = '再構築中...';
      try {
        const r = await apiPost('/backlinks/rebuild', {});
        if (r && r.ok) {
          // 再描画
          await renderBacklinks(_currentTarget, container);
        } else {
          const reason = r?.error || r?.reason || '不明なエラー';
          if (typeof showStatus === 'function') showStatus('バックリンク再構築に失敗しました: ' + reason, true);
        }
      } catch (err) {
        console.warn('[backlinks] rebuild failed', err);
        if (typeof showStatus === 'function') showStatus('バックリンク再構築に失敗しました: ' + (err?.message || err), true);
      }
      finally {
        rbBtn.disabled = false;
        rbBtn.textContent = '全体再構築';
      }
    });
  }

  async function renderBacklinks(targetPath, container) {
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
      _renderList(container, data);
    } catch (e) {
      if (_currentTarget !== targetPath) return;
      container.innerHTML = `<div style="padding:var(--ui-space-4);color:var(--danger,#f44);">取得失敗: ${_esc(String(e))}</div>`;
    }
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
  };
})();
