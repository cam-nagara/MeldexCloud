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
    if (lower.endsWith('.scriptnote.json')) return 'scriptnote';
    if (lower.endsWith('.smart-db.json')) return 'smart-db';
    if (lower.endsWith('.board.json') || lower.endsWith('.canvas.json')) return 'board';
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
      const title = broken ? 'リンク切れ（参照元ファイルが存在しません）' : 'クリックで開く';
      const style = broken
        ? 'color:var(--fg2);text-decoration:line-through;cursor:default;'
        : 'color:var(--accent);cursor:pointer;text-decoration:underline;';
      const openType = _resolveBacklinkOpenType(it);
      const openPath = broken ? '' : _resolveBacklinkOpenPath(it, openType);
      const brokenBadge = broken
        ? `<span style="font-size:.75em;color:var(--fg2);margin-left:6px;">(リンク切れ)</span>` : '';
      return `<li data-idx="${idx}" style="padding:6px 8px;border-bottom:1px solid var(--border);list-style:none;">
        <span class="bl-link" data-path="${_esc(openPath)}" data-link-type="${_esc(openType)}" style="${style}" title="${_esc(title)}">${_esc(it.display_name || it.source_path)}</span>
        ${brokenBadge}
        <div style="font-size:.75em;color:var(--fg2);margin-top:2px;">${_esc(typeLabel)}${loc}</div>
        <div style="font-size:.7em;color:var(--fg2);font-family:var(--font-mono,monospace);">${_esc(it.source_path)}</div>
      </li>`;
    }).join('') : `<li style="padding:var(--ui-space-4);color:var(--fg2);font-size:.9em;list-style:none;">このエントリへの参照はありません</li>`;
    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;padding:8px var(--ui-space-4);border-bottom:1px solid var(--border);">
        <span style="font-weight:600;">バックリンク</span>
        <span style="color:var(--fg2);font-size:.85em;">${items.length}件</span>
        <span style="flex:1;"></span>
        <button class="gb-btn gb-btn-sm" data-action="backlinksRebuild">全体再構築</button>
      </div>
      <ul style="margin:0;padding:0;">${rows}</ul>`;
    container.querySelectorAll('li').forEach(li => {
      const idx = parseInt(li.dataset.idx, 10);
      const it = items[idx];
      if (!it || !it.exists) return;
      li.addEventListener('click', () => _openBacklink(it));
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
