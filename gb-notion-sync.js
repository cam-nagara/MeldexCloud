/* ==============================
   gb-notion-sync.js: Notion同期
   - フォルダ単位の同期（DB + ノート）
   - 複数フォルダ対応
   - 自動同期（5分/15分/30分/1時間）
   ============================== */

(function() {
  'use strict';

  // === 自動同期タイマー管理 ===
  const _autoSyncTimers = {}; // { timerKey: intervalId }
  let _syncInProgress = false; // 同期の同時実行防止
  let _currentOverlay = null;  // 現在開いているモーダルの参照
  const _SYNC_LOCK_KEY = 'meldex-notion-sync-lock-v1';
  const _SYNC_LOCK_TTL_MS = 10 * 60 * 1000;
  const _syncClientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function _isCloudMode() {
    return window.MeldexRuntimeAdapter?.isDropboxMode?.()
      || document.body?.dataset?.cloudMode === 'dropbox';
  }

  function _nowMs() {
    return Date.now();
  }

  function _readSyncLock() {
    try {
      const raw = localStorage.getItem(_SYNC_LOCK_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function _acquireSyncLock(reason) {
    const token = `${_syncClientId}-${_nowMs()}`;
    try {
      const lock = _readSyncLock();
      if (lock?.expiresAt && lock.expiresAt > _nowMs() && lock.owner !== _syncClientId) return null;
      localStorage.setItem(_SYNC_LOCK_KEY, JSON.stringify({
        owner: _syncClientId,
        token,
        reason: reason || 'sync',
        expiresAt: _nowMs() + _SYNC_LOCK_TTL_MS,
      }));
      const current = _readSyncLock();
      return current?.token === token ? token : null;
    } catch (_) {
      return token;
    }
  }

  function _releaseSyncLock(token) {
    if (!token) return;
    try {
      const lock = _readSyncLock();
      if (!lock || lock.owner === _syncClientId || lock.token === token) {
        localStorage.removeItem(_SYNC_LOCK_KEY);
      }
    } catch (_) {}
  }

  function _countValue(value) {
    if (Array.isArray(value)) return value.length;
    const number = Number(value || 0);
    return Number.isFinite(number) ? number : 0;
  }

  function _syncResultParts(res) {
    const parts = [];
    if (_countValue(res?.pushed)) parts.push(`Push: ${_countValue(res.pushed)}件`);
    if (_countValue(res?.skipped)) parts.push(`スキップ: ${_countValue(res.skipped)}件`);
    if (_countValue(res?.conflicts)) parts.push(`競合: ${_countValue(res.conflicts)}件`);
    if (_countValue(res?.errors)) parts.push(`エラー: ${_countValue(res.errors)}件`);
    if (_countValue(res?.tmp_cleaned)) parts.push(`tmp削除: ${_countValue(res.tmp_cleaned)}件`);
    return parts;
  }

  function _syncResultHasIssues(res) {
    return _countValue(res?.errors) > 0 || _countValue(res?.error_messages) > 0 || _countValue(res?.conflicts) > 0;
  }

  function _syncResultErrorMessage(res) {
    const messages = Array.isArray(res?.error_messages) ? res.error_messages.filter(Boolean).slice(0, 2) : [];
    return messages.length ? `: ${messages.join(' / ')}` : '';
  }

  // === Notion同期設定UI ===
  async function showNotionSyncModal() {
    const o = document.createElement('div');
    o.className = 'modal-overlay';
    _currentOverlay = o;
    o.innerHTML = `<div class="modal" style="min-width:620px;max-width:720px;max-height:85vh;overflow-y:auto;">
      <h3>${lucide('refreshCw', 16)} Notion同期</h3>
      <div id="notion-sync-modal-body"></div>
    </div>`;

    document.body.appendChild(o);
    replaceIcons(o);
    await _renderNotionSyncSettings(o.querySelector('#notion-sync-modal-body'), { modal: true });
  }

  async function renderNotionSyncSettings(root) {
    const container = root?.querySelector?.('#notion-sync-settings-container') || root;
    if (!container) return;
    await _renderNotionSyncSettings(container, { modal: false });
  }

  async function _renderNotionSyncSettings(container, options = {}) {
    if (_isCloudMode()) {
      container.textContent = 'Notion同期はMeldex Cloud BETAでは未対応です。デスクトップ版でローカルからNotionへの片方向pushを使用してください。';
      return;
    }
    let cfg = {};
    try { cfg = await apiFetch('/notion/config'); } catch (e) {
      showStatus('Notion設定の読み込みに失敗しました', true);
    }

    const folders = cfg.folders || [];
    const hasToken = cfg.has_token || false;
    container.dataset.notionHasToken = hasToken ? '1' : '0';

    container.innerHTML = `
      <details style="margin-bottom:12px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:4px;" ${hasToken ? '' : 'open'}>
        <summary style="font-size:13px;font-weight:bold;cursor:pointer;color:var(--fg);">
          インテグレーション設定
          <span style="font-size:12px;font-weight:normal;color:${hasToken ? 'var(--green)' : 'var(--red)'};">${hasToken ? '（接続済み）' : '（未設定）'}</span>
        </summary>
        <div style="margin-top:8px;font-size:12px;color:var(--fg2);line-height:1.6;">
          <ol style="padding-left:20px;margin:6px 0;">
            <li><a href="https://www.notion.so/profile/integrations" target="_blank" rel="noopener" data-e2e-id="notion-integrations-link" style="color:var(--accent2);">Notion Integrations</a> で新規インテグレーションを作成</li>
            <li>トークン（<code>ntn_</code>で始まる文字列）をコピー</li>
            <li>下の欄に貼り付けて保存</li>
            <li>同期したいNotionページで「…」→「コネクト」からインテグレーションを追加</li>
          </ol>
        </div>
        <div style="display:flex;gap:4px;margin-top:6px;">
          <input id="notion-token" type="password" placeholder="ntn_..." style="flex:1;font-size:12px;font-family:monospace;">
          <button id="notion-token-save" style="font-size:12px;">トークンを保存</button>
          <button id="notion-token-delete" style="font-size:12px;color:var(--red);background:none;border:1px solid var(--border);border-radius:3px;" ${hasToken ? '' : 'disabled'}>${lucide('trash2', 12)} トークンを削除</button>
        </div>
        <div id="notion-token-status" style="font-size:12px;margin-top:4px;"></div>
      </details>

      <div style="margin-bottom:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div style="font-size:13px;font-weight:bold;color:var(--fg);">Notionに同期するフォルダ</div>
          <button id="notion-add-folder" style="font-size:12px;padding:3px 10px;">${lucide('plus', 12)} フォルダを追加</button>
        </div>
        <div id="notion-folder-list"></div>
      </div>

      <div id="notion-sync-global-status" style="margin-bottom:8px;font-size:12px;color:var(--fg2);">Notion 同期は現在『ローカル → Notion 片方向 push 専用』として動作しています。Notion 側で編集した内容はローカルに反映されません（双方向同期は正式版以降）。</div>
      ${options.modal ? `<div class="btn-row">
        <button id="notion-close-btn" style="">閉じる</button>
      </div>` : ''}
    `;
    replaceIcons(container);

    // イベントバインド
    container.querySelector('#notion-token-save')?.addEventListener('click', () => _handleSaveToken(container, options));
    container.querySelector('#notion-token-delete')?.addEventListener('click', () => _handleDeleteToken(container, options));
    container.querySelector('#notion-add-folder')?.addEventListener('click', () => _addFolderEntry('', container, options));
    container.querySelector('#notion-close-btn')?.addEventListener('click', () => _closeModal());

    // 既存フォルダを描画
    _renderFolderList(folders, container, options);
  }

  function _closeModal() {
    if (_currentOverlay) {
      _currentOverlay.remove();
      _currentOverlay = null;
    }
  }

  // === トークン保存 + 自動リロード ===
  async function _handleSaveToken(root, options = {}) {
    const input = root?.querySelector?.('#notion-token') || document.getElementById('notion-token');
    const statusEl = root?.querySelector?.('#notion-token-status') || document.getElementById('notion-token-status');
    if (!input || !statusEl) return;
    const token = input.value.trim();
    if (!token) {
      statusEl.textContent = 'トークンを入力してください';
      statusEl.style.color = 'var(--red)';
      return;
    }
    try {
      await apiPut('/notion/config', { api_token: token });
      statusEl.textContent = 'トークンを保存しました。リロードします...';
      statusEl.style.color = 'var(--green)';
      input.value = '';
      if (typeof showSaveDialog === 'function') {
        await showSaveDialog('トークンを保存しました。リロードします...', { status: false });
        location.reload();
      } else {
        setTimeout(() => location.reload(), 800);
      }
    } catch (e) {
      statusEl.textContent = '保存失敗: ' + (e.message || e);
      statusEl.style.color = 'var(--red)';
    }
  }

  // === フォルダリスト描画 ===
  function _renderFolderList(folders, root, options = {}) {
    const container = root?.querySelector?.('#notion-folder-list') || document.getElementById('notion-folder-list');
    if (!container) return;

    if (folders.length === 0) {
      container.innerHTML = '<div style="padding:16px;color:var(--fg2);text-align:center;font-size:12px;border:1px dashed var(--border);border-radius:4px;">同期フォルダが設定されていません。<br>「フォルダを追加」またはツリーの右クリックメニューから追加できます。</div>';
      return;
    }

    container.innerHTML = '';
    folders.forEach((f, i) => {
      container.appendChild(_createFolderCard(f, i, root, options));
    });
  }

  // === フォルダカード生成 ===
  function _createFolderCard(folder, index, root, options = {}) {
    const card = document.createElement('div');
    card.style.cssText = 'padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:4px;margin-bottom:8px;';
    card.dataset.index = index;
    card.dataset.folderPath = folder.path || '';
    card.dataset.notionPageUrl = folder.notion_page_url || '';
    card.dataset.notionPageId = folder.notion_page_id || '';
    card.dataset.notionPageTitle = folder.notion_page_title || '';
    card.dataset.syncMode = 'push';
    card.dataset.notionHasToken = root?.dataset?.notionHasToken || '';

    const folderName = folder.path ? folder.path.split(/[/\\]/).pop() : '（未選択）';
    const notionTitle = folder.notion_page_title || '';
    const lastSync = folder.last_sync ? new Date(folder.last_sync).toLocaleString('ja-JP') : '未同期';
    const syncInterval = folder.sync_interval || 0;

    const intervalOptions = [
      { value: 0, label: '手動のみ' },
      { value: 5, label: '5分' },
      { value: 15, label: '15分' },
      { value: 30, label: '30分' },
      { value: 60, label: '1時間' },
    ];
    const intervalSelect = intervalOptions.map(o =>
      `<option value="${o.value}" ${syncInterval === o.value ? 'selected' : ''}>${o.label}</option>`
    ).join('');
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="font-size:14px;">${lucide('folder', 16)}</span>
        <span style="font-size:13px;font-weight:bold;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(folder.path || '')}">${esc(folderName)}</span>
        <button class="notion-remove-folder" style="font-size:11px;padding:1px 6px;color:var(--red);background:none;border:1px solid var(--border);border-radius:3px;cursor:pointer;">削除</button>
      </div>
      <div style="display:flex;gap:4px;align-items:center;margin-bottom:6px;">
        <span style="font-size:12px;color:var(--fg2);white-space:nowrap;">フォルダ:</span>
        <input class="notion-folder-path" type="text" value="${esc(folder.path || '')}" placeholder="ツリーから選択 or パスを入力" style="flex:1;font-size:12px;">
        <button class="notion-pick-folder" style="font-size:11px;padding:2px 8px;">${lucide('folderTree', 12)} 選択</button>
      </div>
      <div style="display:flex;gap:4px;align-items:center;margin-bottom:6px;">
        <span style="font-size:12px;color:var(--fg2);white-space:nowrap;">NotionページURL:</span>
        <input class="notion-page-url" type="text" value="${esc(folder.notion_page_url || '')}" placeholder="https://www.notion.so/..." style="flex:1;font-size:12px;">
        <button class="notion-resolve-page" style="font-size:11px;padding:2px 8px;">確認</button>
      </div>
      ${notionTitle ? `<div style="font-size:12px;color:var(--fg2);margin-bottom:6px;">Notionページ: <b style="color:var(--fg);">${esc(notionTitle)}</b></div>` : ''}
      <div class="notion-sync-controls-row" style="display:flex;gap:10px;align-items:center;margin-bottom:6px;flex-wrap:wrap;">
        <label class="notion-sync-inline-field" style="display:inline-flex;align-items:center;gap:6px;min-width:0;">
          <span style="font-size:12px;color:var(--fg2);white-space:nowrap;">自動同期:</span>
          <select class="notion-sync-interval gb-select gb-select-sm" style="width:auto;min-width:112px;">${intervalSelect}</select>
        </label>
        <div class="notion-sync-inline-field" style="display:inline-flex;align-items:center;gap:6px;min-width:0;flex:1 1 220px;">
          <span style="font-size:12px;color:var(--fg2);white-space:nowrap;">同期方向:</span>
          <span class="notion-sync-mode-label" data-notion-sync-mode="push" style="font-size:12px;color:var(--fg);white-space:nowrap;">Meldex → Notion（片方向 push 専用）</span>
        </div>
        <span style="font-size:11px;color:var(--fg2);margin-left:auto;white-space:nowrap;">最終同期: ${lastSync}</span>
      </div>
      <div style="display:flex;gap:4px;">
        <button class="notion-save-folder" style="font-size:12px;padding:3px 10px;background:none;border:1px solid var(--border);border-radius:3px;cursor:pointer;">設定を保存</button>
        <button class="notion-sync-now" style="font-size:12px;padding:3px 12px;background:var(--accent);color:var(--ui-fg-strong);border:none;border-radius:3px;cursor:pointer;">${lucide('refreshCw', 12)} 今すぐ同期</button>
        <span class="notion-folder-status" style="font-size:12px;color:var(--fg2);align-self:center;margin-left:8px;"></span>
      </div>
    `;

    // イベントバインド
    card.querySelector('.notion-remove-folder').addEventListener('click', () => _removeFolder(index, root, options));
    card.querySelector('.notion-pick-folder').addEventListener('click', () => _pickFolderFromTree(card));
    card.querySelector('.notion-resolve-page').addEventListener('click', () => _resolveNotionPage(card));
    card.querySelector('.notion-save-folder').addEventListener('click', () => _saveFolderConfigFromCard(card, '設定を保存しました'));
    card.querySelector('.notion-sync-now').addEventListener('click', () => _syncFolder(card, index));
    card.querySelector('.notion-sync-interval').addEventListener('change', (e) => _updateAutoSync(card, index, parseInt(e.target.value)));
    card.querySelectorAll('.notion-folder-path, .notion-page-url').forEach(input => {
      input.addEventListener('change', () => _saveFolderConfigFromCard(card, '設定を保存しました'));
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          input.blur();
          _saveFolderConfigFromCard(card, '設定を保存しました');
        }
      });
    });

    return card;
  }

  // === フォルダツリーから選択 ===
  async function _pickFolderFromTree(card) {
    try {
      const input = card.querySelector('.notion-folder-path');
      const selected = window.GBFolderPicker?.pickFolder
        ? await window.GBFolderPicker.pickFolder({
            title: 'Notion同期するフォルダを選択',
            initialPath: input?.value || '',
          })
        : await _showNotionFolderTreePicker(input?.value || '');
      if (selected?.path !== undefined && input) {
        input.value = selected.path;
        const saved = await _saveFolderConfig(card, {});
        showStatus((saved ? 'フォルダを選択しました: ' : 'フォルダを選択しました。保存に失敗しました: ') + (selected.path || 'ルート'));
      }
    } catch (e) {
      showStatus('フォルダ選択に失敗しました', true);
    }
  }

  function _notionCssEscape(value) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function _notionFolderLabel(path) {
    const text = String(path || '').trim();
    if (!text) return 'ルート';
    return text.split(/[/\\]/).filter(Boolean).pop() || text;
  }

  function _showNotionFolderTreePicker(initialPath = '') {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.dataset.notionFolderPicker = '1';
      overlay.innerHTML = `<div class="modal" style="width:520px;height:560px;max-width:min(92vw,520px);">
        <h3 style="display:flex;align-items:center;gap:8px;">${lucide('folderTree', 16)} フォルダを選択</h3>
        <div style="display:flex;flex-direction:column;gap:8px;min-height:0;flex:1;">
          <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--fg2);">
            <span style="white-space:nowrap;">選択中:</span>
            <code id="notion-folder-picker-current" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--fg);">${esc(initialPath || 'ルート')}</code>
          </div>
          <div id="notion-folder-picker-tree" style="flex:1;min-height:0;overflow:auto;border:1px solid var(--border);border-radius:4px;background:var(--bg);padding:4px;"></div>
          <div id="notion-folder-picker-status" style="min-height:16px;font-size:12px;color:var(--fg2);"></div>
        </div>
        <div class="btn-row">
          <button id="notion-folder-picker-cancel" type="button">キャンセル</button>
          <button id="notion-folder-picker-ok" type="button" class="primary">選択</button>
        </div>
      </div>`;
      document.body.appendChild(overlay);
      replaceIcons(overlay);

      const tree = overlay.querySelector('#notion-folder-picker-tree');
      const currentEl = overlay.querySelector('#notion-folder-picker-current');
      const statusEl = overlay.querySelector('#notion-folder-picker-status');
      let selectedPath = String(initialPath || '');
      let closed = false;

      const close = value => {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKeyDown, true);
        overlay.remove();
        resolve(value);
      };
      const setStatus = (message, error = false) => {
        if (!statusEl) return;
        statusEl.textContent = message || '';
        statusEl.style.color = error ? 'var(--red)' : 'var(--fg2)';
      };
      const markSelected = row => {
        tree.querySelectorAll('[data-notion-folder-path]').forEach(el => {
          delete el.dataset.selected;
          el.style.background = '';
          el.style.color = '';
        });
        row.dataset.selected = '1';
        row.style.background = 'var(--accent)';
        row.style.color = 'var(--ui-fg-strong)';
        selectedPath = row.dataset.notionFolderPath || '';
        currentEl.textContent = selectedPath || 'ルート';
      };
      const createRow = (name, path, depth, icon = 'folder') => {
        const row = document.createElement('div');
        row.dataset.notionFolderPath = path || '';
        row.dataset.depth = String(depth);
        row.style.cssText = `padding:5px 8px 5px ${8 + depth * 16}px;cursor:pointer;font-size:12px;white-space:nowrap;display:flex;align-items:center;gap:5px;border-radius:3px;min-height:28px;`;
        const iconWrap = document.createElement('span');
        iconWrap.style.cssText = 'width:14px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;';
        iconWrap.innerHTML = typeof lucide === 'function' ? lucide(icon, 12) : '';
        row.appendChild(iconWrap);
        const label = document.createElement('span');
        label.textContent = name || _notionFolderLabel(path);
        label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;';
        row.appendChild(label);
        row.title = path || 'ルート';
        row.addEventListener('click', () => markSelected(row));
        row.addEventListener('dblclick', () => close({ path: row.dataset.notionFolderPath || '' }));
        row.addEventListener('mouseenter', () => { if (!row.dataset.selected) row.style.background = 'var(--bg3)'; });
        row.addEventListener('mouseleave', () => { if (!row.dataset.selected) row.style.background = ''; });
        return row;
      };
      const expandFolder = async (parentPath, depth, parentRow) => {
        let insertAfter = parentRow || null;
        setStatus('読み込み中...');
        try {
          const data = await apiFetch('/browse?path=' + encodeURIComponent(parentPath || '') + '&folders_only=1&sort=name&order=asc');
          const folders = (Array.isArray(data) ? data : (data.items || [])).filter(item => item.type === 'folder');
          for (const folder of folders) {
            const path = folder.path || '';
            if (tree.querySelector(`[data-notion-folder-path="${_notionCssEscape(path)}"]`)) continue;
            const row = createRow(folder.name, path, depth + 1, 'folder');
            const toggle = document.createElement('span');
            toggle.style.cssText = 'cursor:pointer;opacity:0.7;width:12px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;';
            toggle.innerHTML = typeof lucide === 'function' ? lucide('chevronRight', 10) : '>';
            toggle.addEventListener('click', async event => {
              event.stopPropagation();
              const expanded = toggle.dataset.expanded === '1';
              if (expanded) {
                const rowDepth = Number(row.dataset.depth || 0);
                let next = row.nextElementSibling;
                while (next && Number(next.dataset.depth || 0) > rowDepth) {
                  const remove = next;
                  next = next.nextElementSibling;
                  remove.remove();
                }
                toggle.dataset.expanded = '0';
                toggle.innerHTML = typeof lucide === 'function' ? lucide('chevronRight', 10) : '>';
                replaceIcons(toggle);
                return;
              }
              await expandFolder(path, depth + 1, row);
              toggle.dataset.expanded = '1';
              toggle.innerHTML = typeof lucide === 'function' ? lucide('chevronDown', 10) : 'v';
              replaceIcons(toggle);
            });
            row.prepend(toggle);
            if (insertAfter?.nextSibling) tree.insertBefore(row, insertAfter.nextSibling);
            else tree.appendChild(row);
            if (path === selectedPath) markSelected(row);
            insertAfter = row;
          }
          replaceIcons(tree);
          setStatus(folders.length ? '' : 'この階層にフォルダはありません。');
        } catch (error) {
          setStatus('フォルダ一覧の取得に失敗しました: ' + (error?.message || error), true);
        }
      };
      const onKeyDown = event => {
        if (event.key === 'Escape') close(null);
        if (event.key === 'Enter') close({ path: selectedPath });
      };

      tree.innerHTML = '';
      const rootRow = createRow('ルート', '', 0, 'home');
      tree.appendChild(rootRow);
      if (!selectedPath) markSelected(rootRow);
      expandFolder('', 0, rootRow);
      overlay.querySelector('#notion-folder-picker-ok')?.addEventListener('click', () => close({ path: selectedPath }));
      overlay.querySelector('#notion-folder-picker-cancel')?.addEventListener('click', () => close(null));
      overlay.addEventListener('click', event => { if (event.target === overlay) close(null); });
      document.addEventListener('keydown', onKeyDown, true);
    });
  }

  // === NotionページURL解決 ===
  async function _resolveNotionPage(card) {
    const url = card.querySelector('.notion-page-url').value.trim();
    if (!url) { showStatus('URLを入力してください', true); return; }

    const statusEl = card.querySelector('.notion-folder-status');
    statusEl.textContent = '確認中...';
    statusEl.style.color = 'var(--fg2)';

    try {
      const res = await apiPost('/notion/resolve-page', { url });
      if (res.title) {
        statusEl.textContent = 'Notionページ: ' + res.title;
        statusEl.style.color = 'var(--green)';
        await _saveFolderConfig(card, { notion_page_title: res.title, notion_page_id: res.page_id });
      } else {
        statusEl.textContent = 'ページが見つかりません';
        statusEl.style.color = 'var(--red)';
      }
    } catch (e) {
      statusEl.textContent = '確認失敗: ' + (e.message || e);
      statusEl.style.color = 'var(--red)';
    }
  }

  // === フォルダ設定を保存 ===
  async function _saveFolderConfig(card, extra) {
    const index = parseInt(card.dataset.index);
    const path = card.querySelector('.notion-folder-path').value.trim();
    const notionUrl = card.querySelector('.notion-page-url').value.trim();
    const interval = parseInt(card.querySelector('.notion-sync-interval').value);
    const syncMode = 'push';
    const urlChanged = notionUrl !== (card.dataset.notionPageUrl || '');
    const extraPayload = extra || {};

    const update = {
      index,
      path,
      notion_page_url: notionUrl,
      auto_sync: interval > 0,
      sync_interval: interval,
      sync_mode: syncMode,
      ...extraPayload,
    };
    if (urlChanged && !Object.prototype.hasOwnProperty.call(extraPayload, 'notion_page_id')) {
      update.notion_page_id = '';
      update.notion_page_title = '';
    }

    try {
      await apiPost('/notion/update-folder', update);
      card.dataset.folderPath = path;
      card.dataset.notionPageUrl = notionUrl;
      if (Object.prototype.hasOwnProperty.call(update, 'notion_page_id')) {
        card.dataset.notionPageId = update.notion_page_id || '';
      }
      if (Object.prototype.hasOwnProperty.call(update, 'notion_page_title')) {
        card.dataset.notionPageTitle = update.notion_page_title || '';
      }
      card.dataset.syncMode = syncMode;
      // 設定変更の path 移動 / auto_sync ON/OFF にタイマーを追従させる
      await _reconcileTimers();
      return true;
    } catch (e) {
      showStatus('フォルダ設定の保存に失敗しました', true);
      return false;
    }
  }

  async function _saveFolderConfigFromCard(card, successMessage) {
    const statusEl = card?.querySelector?.('.notion-folder-status');
    if (statusEl) {
      statusEl.textContent = '保存中...';
      statusEl.style.color = 'var(--fg2)';
    }
    const saved = await _saveFolderConfig(card, {});
    if (statusEl) {
      statusEl.textContent = saved ? (successMessage || '保存しました') : '保存に失敗しました';
      statusEl.style.color = saved ? 'var(--green)' : 'var(--red)';
    }
    return saved;
  }

  function _refreshNotionSyncSettings(root, options = {}) {
    if (root?.isConnected) {
      _renderNotionSyncSettings(root, options);
      return;
    }
    if (options.modal) showNotionSyncModal();
  }

  async function _handleDeleteToken(root, options = {}) {
    const statusEl = root?.querySelector?.('#notion-token-status') || document.getElementById('notion-token-status');
    if (!statusEl) return;
    if (!await cfConfirm('Notionトークンを削除しますか？ 自動同期もすべて停止します。')) return;
    try {
      _clearAllAutoSyncTimers();
      await apiDelete('/notion/token');
      statusEl.textContent = 'トークンを削除しました。自動同期を停止しました。';
      statusEl.style.color = 'var(--green)';
      await _reconcileTimers();
      if (typeof showStatus === 'function') showStatus('Notionトークンを削除しました');
      if (options.modal) _closeModal();
      _refreshNotionSyncSettings(root, options);
    } catch (e) {
      statusEl.textContent = '削除失敗: ' + (e.message || e);
      statusEl.style.color = 'var(--red)';
    }
  }

  // === フォルダ追加 ===
  async function _addFolderEntry(path, root, options = {}) {
    try {
      await apiPost('/notion/add-folder', { path: path || '' });
      await _reconcileTimers();
      if (options.modal) _closeModal();
      _refreshNotionSyncSettings(root, options);
    } catch (e) {
      showStatus('フォルダ追加に失敗: ' + (e.message || e), true);
    }
  }

  // === フォルダ削除 ===
  async function _removeFolder(index, root, options = {}) {
    if (!await cfConfirm('この同期フォルダ設定を削除しますか？')) return;
    try {
      // 削除対象のパスを事前取得してからタイマーを片付ける
      let removedPath = '';
      try {
        const cfg = await apiFetch('/notion/config');
        const f = (cfg.folders || [])[index];
        if (f) removedPath = f.path || '';
      } catch {}
      await apiPost('/notion/remove-folder', { index });
      // 残りのフォルダについても index 詰めでドリフトしている可能性があるので再構築
      await _reconcileTimers();
      if (options.modal) _closeModal();
      _refreshNotionSyncSettings(root, options);
    } catch (e) {
      showStatus('削除に失敗しました', true);
    }
  }

  // === 手動同期実行 ===
  async function _syncFolder(card, index) {
    if (_syncInProgress) {
      showStatus('他の同期が実行中です。完了をお待ちください。', true);
      return;
    }

    const path = card.querySelector('.notion-folder-path').value.trim();
    const notionUrl = card.querySelector('.notion-page-url').value.trim();
    const statusEl = card.querySelector('.notion-folder-status');

    if (!path) { statusEl.textContent = 'フォルダを指定してください'; statusEl.style.color = 'var(--red)'; return; }
    if (!notionUrl) { statusEl.textContent = 'NotionページURLを指定してください'; statusEl.style.color = 'var(--red)'; return; }

    const ready = await _ensureNotionPageReady(card, statusEl);
    if (!ready) return;
    const lockToken = _acquireSyncLock('manual');
    if (!lockToken) {
      statusEl.textContent = '別ウィンドウでNotion同期中です';
      statusEl.style.color = 'var(--red)';
      showStatus('別ウィンドウでNotion同期中です。完了後に再試行してください。', true);
      return;
    }

    _syncInProgress = true;
    statusEl.textContent = '同期中...';
    statusEl.style.color = 'var(--accent)';

    const syncBtn = card.querySelector('.notion-sync-now');
    syncBtn.disabled = true;

    try {
      const res = await apiPost('/notion/sync', { folder_index: index, mode: 'push' });
      const parts = _syncResultParts(res);
      const hasIssues = _syncResultHasIssues(res);
      statusEl.textContent = (hasIssues ? '同期に確認が必要 — ' : '同期完了 — ') + (parts.join(', ') || '変更なし') + _syncResultErrorMessage(res);
      statusEl.style.color = hasIssues ? 'var(--red)' : 'var(--green)';
      showStatus((hasIssues ? 'Notion同期に未完了の項目があります: ' : 'Notion同期しました: ') + path.split(/[/\\]/).pop(), hasIssues);
      if (typeof loadOutliner === 'function') await loadOutliner();
    } catch (e) {
      statusEl.textContent = '同期失敗: ' + (e.message || e);
      statusEl.style.color = 'var(--red)';
    } finally {
      _syncInProgress = false;
      _releaseSyncLock(lockToken);
      syncBtn.disabled = false;
    }
  }

  async function _ensureNotionPageReady(card, statusEl) {
    const notionUrl = card.querySelector('.notion-page-url').value.trim();
    const urlChanged = notionUrl !== (card.dataset.notionPageUrl || '');
    const hasResolvedPage = !!card.dataset.notionPageId;
    if (!urlChanged && hasResolvedPage) {
      return _saveFolderConfig(card, {});
    }
    statusEl.textContent = 'Notionページを確認中...';
    statusEl.style.color = 'var(--fg2)';
    try {
      const res = await apiPost('/notion/resolve-page', { url: notionUrl });
      if (!res.page_id) {
        statusEl.textContent = 'Notionページを確認できません';
        statusEl.style.color = 'var(--red)';
        return false;
      }
      return _saveFolderConfig(card, {
        notion_page_title: res.title || '',
        notion_page_id: res.page_id,
      });
    } catch (e) {
      statusEl.textContent = '確認失敗: ' + (e.message || e);
      statusEl.style.color = 'var(--red)';
      return false;
    }
  }

  // === 自動同期設定更新 ===
  async function _updateAutoSync(card, index, intervalMinutes) {
    const select = card?.querySelector?.('.notion-sync-interval');
    const statusEl = card?.querySelector?.('.notion-folder-status');
    const disableAutoSync = async (message) => {
      if (select) select.value = '0';
      if (statusEl) {
        statusEl.textContent = message;
        statusEl.style.color = 'var(--red)';
      }
      await _saveFolderConfig(card, {});
      showStatus(message, true);
    };
    try {
      if (intervalMinutes > 0) {
        const path = card.querySelector('.notion-folder-path').value.trim();
        const notionUrl = card.querySelector('.notion-page-url').value.trim();
        if (!path) {
          await disableAutoSync('自動同期にはフォルダ指定が必要です');
          return;
        }
        if (!notionUrl) {
          await disableAutoSync('自動同期にはNotionページURLが必要です');
          return;
        }
        const cfg = await apiFetch('/notion/config');
        if (!cfg?.has_token) {
          card.dataset.notionHasToken = '0';
          await disableAutoSync('自動同期にはNotionトークンの保存が必要です');
          return;
        }
        card.dataset.notionHasToken = '1';
        const ready = await _ensureNotionPageReady(card, statusEl);
        if (!ready) {
          await disableAutoSync('Notionページを確認できないため、自動同期を無効にしました');
          return;
        }
      }
      const saved = intervalMinutes > 0 ? true : await _saveFolderConfig(card, {});
      if (!saved) return;

      if (intervalMinutes > 0) {
        showStatus(`自動同期を${intervalMinutes}分間隔に設定しました`);
      } else {
        showStatus('自動同期を無効にしました');
      }
    } catch (e) {
      showStatus('設定の保存に失敗しました', true);
    }
  }

  function _timerKey(index, folder) {
    return [index, folder.path || '', folder.notion_page_id || '', folder.notion_page_url || ''].join('\u001f');
  }

  // === 自動同期タイマー管理（設定行単位でキー管理） ===
  function _resetAutoSyncTimer(timerKey, folder, intervalMinutes) {
    if (!folder?.path) return; // 空パスは登録しない
    if (_autoSyncTimers[timerKey]) {
      clearInterval(_autoSyncTimers[timerKey]);
      delete _autoSyncTimers[timerKey];
    }
    if (intervalMinutes > 0) {
      _autoSyncTimers[timerKey] = setInterval(() => {
        _autoSyncExecute(timerKey);
      }, intervalMinutes * 60 * 1000);
    }
  }

  function _clearAllAutoSyncTimers() {
    Object.keys(_autoSyncTimers).forEach(k => {
      clearInterval(_autoSyncTimers[k]);
      delete _autoSyncTimers[k];
    });
  }

  // === タイマー一覧を現在の config と突き合わせて再構築 ===
  async function _reconcileTimers() {
    try {
      const cfg = await apiFetch('/notion/config');
      const folders = cfg.folders || [];
      const aliveKeys = new Set();
      folders.forEach((f, index) => {
        const p = f.path || '';
        if (!p) return;
        const key = _timerKey(index, f);
        aliveKeys.add(key);
        if (f.auto_sync && f.sync_interval > 0 && cfg.has_token && f.notion_page_id) {
          // 設定変更が無くても clearInterval → setInterval で冪等に更新
          _resetAutoSyncTimer(key, f, f.sync_interval);
        } else if (_autoSyncTimers[key]) {
          clearInterval(_autoSyncTimers[key]);
          delete _autoSyncTimers[key];
        }
      });
      // config に存在しなくなった設定行のタイマーは片付ける
      Object.keys(_autoSyncTimers).forEach(k => {
        if (!aliveKeys.has(k)) {
          clearInterval(_autoSyncTimers[k]);
          delete _autoSyncTimers[k];
        }
      });
    } catch (e) {
      console.warn('Notion auto-sync reconcile failed:', e);
    }
  }

  async function _autoSyncExecute(timerKey) {
    if (_syncInProgress) return; // 他の同期中はスキップ
    const lockToken = _acquireSyncLock('auto');
    if (!lockToken) return;
    // 実行時点で最新の config から設定行の index を再解決（ドリフト対策）
    let currentIndex = -1;
    let folders = [];
    try {
      const cfg = await apiFetch('/notion/config');
      folders = cfg.folders || [];
      currentIndex = folders.findIndex((f, index) => _timerKey(index, f) === timerKey);
      const folder = currentIndex >= 0 ? folders[currentIndex] : null;
      if (currentIndex < 0 || !cfg.has_token || !folder?.notion_page_id) {
        // 該当設定行が削除されていた。自分のタイマーも片付ける
        if (_autoSyncTimers[timerKey]) {
          clearInterval(_autoSyncTimers[timerKey]);
          delete _autoSyncTimers[timerKey];
        }
        _releaseSyncLock(lockToken);
        return;
      }
    } catch (e) {
      console.warn('Notion auto-sync config fetch failed for', timerKey, e);
      _releaseSyncLock(lockToken);
      return;
    }
    _syncInProgress = true;
    try {
      const res = await apiPost('/notion/sync', { folder_index: currentIndex, mode: 'push' });
      const total = _countValue(res.pushed);
      if (_syncResultHasIssues(res)) {
        showStatus(`Notion自動同期に未完了の項目があります${_syncResultErrorMessage(res)}`, true);
        return;
      }
      if (total > 0) {
        showStatus(`Notion自動同期: ${total}件の変更を同期しました`);
        if (typeof loadOutliner === 'function') await loadOutliner();
      }
    } catch (e) {
      console.warn('Notion auto-sync failed for', timerKey, e);
    } finally {
      _syncInProgress = false;
      _releaseSyncLock(lockToken);
    }
  }

  // === 起動時の自動同期タイマー初期化 ===
  async function _initAutoSync() {
    if (_isCloudMode()) {
      _clearAllAutoSyncTimers();
      return;
    }
    await _reconcileTimers();
  }

  // === 右クリックメニューから呼ばれる: フォルダをNotion同期に追加 ===
  async function addNotionSyncFolder(folderPath) {
    try {
      await apiPost('/notion/add-folder', { path: folderPath });
      showStatus(`「${folderPath.split(/[/\\]/).pop()}」をNotion同期フォルダに追加しました`);
      showNotionSyncModal();
    } catch (e) {
      showStatus('追加に失敗: ' + (e.message || e), true);
    }
  }

  // === 初期化 ===
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initAutoSync);
  } else {
    setTimeout(_initAutoSync, 2000);
  }

  // グローバル公開
  window.showNotionSyncModal = showNotionSyncModal;
  window.renderNotionSyncSettings = renderNotionSyncSettings;
  window.addNotionSyncFolder = addNotionSyncFolder;
  window.clearNotionAutoSyncTimers = _clearAllAutoSyncTimers;

})();
