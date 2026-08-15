/* ==============================
   gb-notion-sync.js: Notion同期
   - フォルダ単位の同期（DB + ノート）
   - 複数フォルダ対応
   - 自動同期（5分/15分/30分/1時間）
   ============================== */

(function() {
  'use strict';

  // 自動同期の実行判断・巡回はバックエンド（meldex_import_scheduler.py）が担う。
  let _syncInProgress = false; // 同期の同時実行防止
  let _currentOverlay = null;  // 現在開いているモーダルの参照
  let _currentModalApi = null;
  let _notionModalSeq = 0;
  const _SYNC_LOCK_KEY = 'meldex-notion-sync-lock-v1';
  const _SYNC_LOCK_TTL_MS = 10 * 60 * 1000;
  const _syncClientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function _isCloudMode() {
    return window.MeldexRuntimeAdapter?.isPwaMode?.()
      || ['browser', 'dropbox', 'server'].includes(document.body?.dataset?.cloudMode || '');
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
  // triggerEl: このモーダルを開いた「外側の本来のトリガー要素」。
  // 省略時（外部からの新規オープン）は現在のフォーカス位置を採用する。
  // _refreshNotionSyncSettings からの内部再生成呼び出しでは、直前のモーダルが
  // 保持していたトリガー要素をそのまま引き継ぐ（document.activeElement の
  // 再取得はしない）。再生成は「閉じてすぐ作り直す」ため、その瞬間の
  // document.activeElement は直前のモーダルごと消える内部要素（フォルダ追加
  // ボタン等）になっており、それを拾うと二度と外側へフォーカスを戻せなくなる。
  async function showNotionSyncModal(triggerEl) {
    const opener = (triggerEl instanceof HTMLElement && triggerEl.isConnected)
      ? triggerEl
      : (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    _closeModal();
    const body = document.createElement('div');
    body.id = 'notion-sync-modal-body';
    const descId = `notion-sync-global-status-${_notionModalSeq}`;
    const closeButton = document.createElement('button');
    closeButton.id = 'notion-close-btn';
    closeButton.type = 'button';
    closeButton.className = 'gb-btn gb-btn-sm notion-sync-action';
    closeButton.dataset.e2eId = 'notion-close';
    closeButton.setAttribute('aria-label', 'Notion同期を閉じる');
    closeButton.textContent = '閉じる';
    const modalApi = window.GBUI.createModal({
      id: `notion-sync-${++_notionModalSeq}`,
      title: 'Notion同期',
      body,
      footer: closeButton,
      variant: 'mobile-sheet',
      extraClass: 'notion-sync-modal',
      initialFocus: '#notion-token, #notion-add-folder, #notion-close-btn',
      closeLabel: 'Notion同期を閉じる',
      closeOnEsc: true,
      closeOnOverlay: true,
      // 外側の本来のトリガー要素を明示的に指定する。指定した要素が閉じる時点で
      // 接続済みなら、document.activeElement の暗黙キャプチャより優先される
      // （gb-ui.js の _restoreOpenerFocus 参照）。
      returnFocus: () => (opener && opener.isConnected) ? opener : null,
      onClose: () => {
        if (_currentModalApi === modalApi) _currentModalApi = null;
        if (_currentOverlay === modalApi.overlay) _currentOverlay = null;
      },
    });
    const o = modalApi.overlay;
    o.classList.add('modal-overlay');
    o.dataset.e2eId = 'notion-sync-modal-overlay';
    modalApi.modal.dataset.e2eId = 'notion-sync-modal';
    modalApi.modal.setAttribute('aria-describedby', descId);
    modalApi.header.querySelector('.gb-modal-close')?.setAttribute('data-e2e-id', 'notion-sync-header-close');
    modalApi.footer.classList.add('btn-row', 'notion-sync-footer');
    _currentModalApi = modalApi;
    _currentOverlay = o;
    closeButton.addEventListener('click', () => modalApi.close('close-button'));
    modalApi.open();
    await _renderNotionSyncSettings(body, { modal: true, descId, triggerEl: opener });
    replaceIcons(o);
  }

  async function renderNotionSyncSettings(root) {
    const container = root?.querySelector?.('#notion-sync-settings-container') || root;
    if (!container) return;
    await _renderNotionSyncSettings(container, { modal: false });
  }

  async function _renderNotionSyncSettings(container, options = {}) {
    if (_isCloudMode()) {
      container.textContent = 'Notion同期はデスクトップ版のローカル連携です。クラウド版で制作データを開いている場合も、Notionへの片方向pushはデスクトップ版から実行してください。';
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
      <details class="notion-sync-section" data-e2e-id="notion-integration-section" ${hasToken ? '' : 'open'}>
        <summary class="notion-sync-section-summary" data-e2e-id="notion-integration-summary" aria-label="Notionインテグレーション設定">
          インテグレーション設定
          <span class="${hasToken ? 'notion-sync-state-ok' : 'notion-sync-state-danger'}">${hasToken ? '（接続済み）' : '（未設定）'}</span>
        </summary>
        <div class="notion-sync-help">
          <ol style="padding-left:20px;margin:6px 0;">
            <li><a href="https://www.notion.so/profile/integrations" target="_blank" rel="noopener" data-e2e-id="notion-integrations-link" aria-label="Notion Integrationsをブラウザで開く" style="color:var(--accent2);">Notion Integrations</a> で新規インテグレーションを作成</li>
            <li>トークン（<code>ntn_</code>で始まる文字列）をコピー</li>
            <li>下の欄に貼り付けて保存</li>
            <li>同期したいNotionページで「…」→「コネクト」からインテグレーションを追加</li>
          </ol>
        </div>
        <div class="notion-sync-row notion-sync-token-row">
          <input id="notion-token" class="gb-input notion-sync-input notion-token-input" type="password" placeholder="ntn_..." aria-label="Notionトークン" autocomplete="off" data-e2e-id="notion-token-input">
          <button id="notion-token-save" type="button" class="gb-btn gb-btn-sm notion-sync-action" data-e2e-id="notion-token-save" aria-label="Notionトークンを保存">トークンを保存</button>
          <button id="notion-token-delete" type="button" class="gb-btn gb-btn-sm gb-btn-danger notion-sync-action" data-e2e-id="notion-token-delete" aria-label="Notionトークンを削除" ${hasToken ? '' : 'disabled'}>${lucide('trash2', 12)} トークンを削除</button>
        </div>
        <div id="notion-token-status" class="notion-sync-status-line"></div>
      </details>

      <div style="margin-bottom:12px;">
        <div class="notion-sync-heading-row">
          <div class="notion-sync-heading">Notionに同期するフォルダ</div>
          <button id="notion-add-folder" type="button" class="gb-btn gb-btn-sm notion-sync-action" data-e2e-id="notion-add-folder">${lucide('plus', 12)} フォルダを追加</button>
        </div>
        <div id="notion-folder-list"></div>
      </div>

      <div id="${options.descId || 'notion-sync-global-status'}" class="notion-sync-global-status">Notion 同期は現在『ローカル → Notion 片方向 push 専用』として動作しています。Notion 側で編集した内容はローカルに反映されません（双方向同期は正式版以降）。</div>
    `;
    replaceIcons(container);

    // イベントバインド
    container.querySelector('#notion-token-save')?.addEventListener('click', () => _handleSaveToken(container, options));
    container.querySelector('#notion-token-delete')?.addEventListener('click', () => _handleDeleteToken(container, options));
    container.querySelector('#notion-add-folder')?.addEventListener('click', () => _addFolderEntry('', container, options));

    // 既存フォルダを描画
    _renderFolderList(folders, container, options);
  }

  function _closeModal() {
    if (_currentModalApi) {
      const modalApi = _currentModalApi;
      _currentModalApi = null;
      _currentOverlay = null;
      modalApi.close('programmatic');
      return;
    }
    _currentOverlay?.remove();
    _currentOverlay = null;
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
      container.innerHTML = '<div style="padding:16px;color:var(--fg2);text-align:center;font-size:12px;border:1px dashed var(--border);border-radius:4px;">同期フォルダが設定されていません。<br>「フォルダを追加」またはフォルダツリーのメニューから追加できます。</div>';
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
    card.className = 'notion-folder-card';
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
    const folderSchedule = folder.schedule || (folder.sync_interval > 0 ? { type: 'interval', interval_minutes: folder.sync_interval } : null);
    card.innerHTML = `
      <div class="notion-folder-card-head">
        <span class="notion-folder-card-icon">${lucide('folder', 16)}</span>
        <span class="notion-folder-card-title" title="${esc(folder.path || '')}">${esc(folderName)}</span>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-danger notion-remove-folder notion-sync-action" data-e2e-id="notion-remove-folder" data-notion-card-action="remove" data-notion-card-index="${index}" aria-label="${esc(folderName)}のNotion同期設定を削除">削除</button>
      </div>
      <div class="notion-sync-row">
        <span class="notion-sync-label">フォルダ:</span>
        <input class="gb-input notion-sync-input notion-folder-path" type="text" value="${esc(folder.path || '')}" placeholder="ツリーから選択 or パスを入力" aria-label="Notion同期フォルダパス" data-e2e-id="notion-folder-path-${index}">
        <button type="button" class="gb-btn gb-btn-sm notion-pick-folder notion-sync-action" data-e2e-id="notion-pick-folder" data-notion-card-action="pick-folder" data-notion-card-index="${index}" aria-label="${esc(folderName)}の同期フォルダを選択">${lucide('folderTree', 12)} 選択</button>
      </div>
      <div class="notion-sync-row">
        <span class="notion-sync-label">NotionページURL:</span>
        <input class="gb-input notion-sync-input notion-page-url" type="text" value="${esc(folder.notion_page_url || '')}" placeholder="https://www.notion.so/..." aria-label="NotionページURL" data-e2e-id="notion-page-url-${index}">
        <button type="button" class="gb-btn gb-btn-sm notion-resolve-page notion-sync-action" data-e2e-id="notion-resolve-page" data-notion-card-action="resolve-page" data-notion-card-index="${index}" aria-label="${esc(folderName)}のNotionページを確認">確認</button>
      </div>
      ${notionTitle ? `<div class="notion-page-title-line">Notionページ: <b>${esc(notionTitle)}</b></div>` : ''}
      <div class="notion-sync-controls-row">
        <div class="notion-sync-schedule-container" data-e2e-id="notion-sync-schedule-${index}"></div>
        <div class="notion-sync-inline-field notion-sync-mode-field">
          <span class="notion-sync-label">同期方向:</span>
          <span class="notion-sync-mode-label" data-notion-sync-mode="push">Meldex → Notion（片方向 push 専用）</span>
        </div>
        <span class="notion-last-sync">最終同期: ${lastSync}</span>
      </div>
      <div class="notion-sync-actions-row">
        <button type="button" class="gb-btn gb-btn-sm notion-save-folder notion-sync-action" data-e2e-id="notion-save-folder" data-notion-card-action="save-folder" data-notion-card-index="${index}" aria-label="${esc(folderName)}のNotion同期設定を保存">設定を保存</button>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-primary notion-sync-now notion-sync-action" data-e2e-id="notion-sync-now" data-notion-card-action="sync-now" data-notion-card-index="${index}" aria-label="${esc(folderName)}を今すぐNotionへ同期">${lucide('refreshCw', 12)} 今すぐ同期</button>
        <span class="notion-folder-status"></span>
      </div>
    `;

    // イベントバインド
    card.querySelector('.notion-remove-folder').addEventListener('click', () => _removeFolder(index, root, options));
    card.querySelector('.notion-pick-folder').addEventListener('click', () => _pickFolderFromTree(card));
    card.querySelector('.notion-resolve-page').addEventListener('click', () => _resolveNotionPage(card));
    card.querySelector('.notion-save-folder').addEventListener('click', () => _saveFolderConfigFromCard(card, '設定を保存しました'));
    card.querySelector('.notion-sync-now').addEventListener('click', () => _syncFolder(card, index));
    const schedContainer = card.querySelector('.notion-sync-schedule-container');
    if (schedContainer && window.MeldexScheduler) {
      const w = window.MeldexScheduler.createWidget(schedContainer, folderSchedule, (cfg) => {
        _updateAutoSyncSchedule(card, index, cfg);
      });
      card._scheduleWidget = w;
      w?.setStatusText(_formatScheduleState(folder.schedule_state));
    }
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
      const pickerDescId = `notion-folder-picker-current-${++_notionModalSeq}`;
      const body = document.createElement('div');
      body.className = 'notion-folder-picker-body';
      body.innerHTML = `
        <div class="notion-folder-picker-current-row">
          <span class="notion-sync-label">選択中:</span>
          <code id="${pickerDescId}" class="notion-folder-picker-current">${esc(initialPath || 'ルート')}</code>
        </div>
        <div id="notion-folder-picker-tree" class="notion-folder-picker-tree"></div>
        <div id="notion-folder-picker-status" class="notion-sync-status-line"></div>`;
      const cancelButton = document.createElement('button');
      cancelButton.id = 'notion-folder-picker-cancel';
      cancelButton.type = 'button';
      cancelButton.className = 'gb-btn gb-btn-sm notion-sync-action';
      cancelButton.dataset.e2eId = 'notion-folder-picker-cancel';
      cancelButton.textContent = 'キャンセル';
      const okButton = document.createElement('button');
      okButton.id = 'notion-folder-picker-ok';
      okButton.type = 'button';
      okButton.className = 'gb-btn gb-btn-sm gb-btn-primary notion-sync-action';
      okButton.dataset.e2eId = 'notion-folder-picker-ok';
      okButton.textContent = '選択';
      let closed = false;
      const modalApi = window.GBUI.createModal({
        id: `notion-folder-picker-${_notionModalSeq}`,
        title: 'フォルダを選択',
        body,
        footer: [cancelButton, okButton],
        variant: 'mobile-sheet',
        extraClass: 'notion-folder-picker-modal',
        initialFocus: '[data-notion-folder-path]',
        closeLabel: 'フォルダ選択を閉じる',
        closeOnEsc: true,
        closeOnOverlay: true,
        onClose: () => {
          document.removeEventListener('keydown', onKeyDown, true);
          if (!closed) {
            closed = true;
            resolve(null);
          }
        },
      });
      const overlay = modalApi.overlay;
      overlay.classList.add('modal-overlay');
      overlay.dataset.notionFolderPicker = '1';
      modalApi.modal.dataset.e2eId = 'notion-folder-picker-dialog';
      modalApi.modal.setAttribute('aria-describedby', pickerDescId);
      modalApi.header.querySelector('.gb-modal-close')?.setAttribute('data-e2e-id', 'notion-folder-picker-header-close');
      modalApi.footer.classList.add('btn-row', 'notion-folder-picker-actions');
      modalApi.open();
      replaceIcons(overlay);

      const tree = body.querySelector('#notion-folder-picker-tree');
      const currentEl = body.querySelector(`#${pickerDescId}`);
      const statusEl = body.querySelector('#notion-folder-picker-status');
      let selectedPath = String(initialPath || '');

      const close = value => {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKeyDown, true);
        modalApi.close(value ? 'select' : 'cancel');
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
        row.className = 'notion-folder-picker-row';
        row.setAttribute('role', 'button');
        row.setAttribute('aria-label', `${name || _notionFolderLabel(path)}を選択`);
        row.tabIndex = 0;
        row.dataset.notionFolderPath = path || '';
        row.dataset.depth = String(depth);
        row.style.paddingLeft = `${8 + depth * 16}px`;
        const iconWrap = document.createElement('span');
        iconWrap.className = 'notion-folder-picker-icon';
        iconWrap.innerHTML = typeof lucide === 'function' ? lucide(icon, 12) : '';
        row.appendChild(iconWrap);
        const label = document.createElement('span');
        label.textContent = name || _notionFolderLabel(path);
        label.className = 'notion-folder-picker-label';
        row.appendChild(label);
        row.title = path || 'ルート';
        row.addEventListener('click', () => markSelected(row));
        row.addEventListener('dblclick', () => close({ path: row.dataset.notionFolderPath || '' }));
        row.addEventListener('keydown', event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            close({ path: row.dataset.notionFolderPath || '' });
          } else if (event.key === ' ') {
            event.preventDefault();
            markSelected(row);
          }
        });
        row.addEventListener('mouseenter', () => { if (!row.dataset.selected) row.classList.add('hover'); });
        row.addEventListener('mouseleave', () => { if (!row.dataset.selected) row.classList.remove('hover'); });
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
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'notion-folder-picker-toggle';
            toggle.setAttribute('aria-label', `${folder.name || _notionFolderLabel(path)}を展開`);
            toggle.setAttribute('aria-expanded', 'false');
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
                toggle.setAttribute('aria-expanded', 'false');
                toggle.setAttribute('aria-label', `${folder.name || _notionFolderLabel(path)}を展開`);
                toggle.innerHTML = typeof lucide === 'function' ? lucide('chevronRight', 10) : '>';
                replaceIcons(toggle);
                return;
              }
              await expandFolder(path, depth + 1, row);
              toggle.dataset.expanded = '1';
              toggle.setAttribute('aria-expanded', 'true');
              toggle.setAttribute('aria-label', `${folder.name || _notionFolderLabel(path)}を折りたたむ`);
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
        if (event.key === 'Enter') close({ path: selectedPath });
      };

      tree.innerHTML = '';
      const rootRow = createRow('ルート', '', 0, 'home');
      tree.appendChild(rootRow);
      if (!selectedPath) markSelected(rootRow);
      expandFolder('', 0, rootRow);
      okButton.addEventListener('click', () => close({ path: selectedPath }));
      cancelButton.addEventListener('click', () => close(null));
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
    const schedule = card._scheduleWidget ? card._scheduleWidget.getCurrentConfig() : null;
    const syncMode = 'push';
    const urlChanged = notionUrl !== (card.dataset.notionPageUrl || '');
    const extraPayload = extra || {};

    const update = {
      index,
      path,
      notion_page_url: notionUrl,
      auto_sync: schedule ? schedule.type !== 'off' : false,
      sync_interval: schedule?.interval_minutes || 0,
      sync_mode: syncMode,
      schedule: schedule || undefined,
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
    const overlay = root?.closest?.('.modal-overlay, [data-mobile-dialog-closing="1"], .gb-mobile-dialog-overlay-closing');
    const isClosingMobileSheet = overlay?.dataset?.mobileDialogClosing === '1'
      || overlay?.classList?.contains('gb-mobile-dialog-overlay-closing');
    if (root?.isConnected && !isClosingMobileSheet) {
      _renderNotionSyncSettings(root, options);
      return;
    }
    // 「閉じてすぐ作り直す」再生成。外側の本来のトリガー要素（options.triggerEl）を
    // そのまま引き継ぎ、新しいモーダルの document.activeElement 再取得に頼らない。
    if (options.modal) showNotionSyncModal(options.triggerEl);
  }

  async function _handleDeleteToken(root, options = {}) {
    const statusEl = root?.querySelector?.('#notion-token-status') || document.getElementById('notion-token-status');
    if (!statusEl) return;
    if (!await cfConfirm('Notionトークンを削除しますか？ 自動同期もすべて停止します。', { danger: true, okLabel: '削除' })) return;
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
    if (!await cfConfirm('この同期フォルダ設定を削除しますか？', { danger: true, okLabel: '削除' })) return;
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
      const res = await runBackgroundJob('/notion/sync', { folder_index: index, mode: 'push' }, {
        onProgress: (progress) => {
          statusEl.textContent = formatJobProgress(progress, { unit: '件送信済み', defaultPhase: 'Notionへ送信中' });
          statusEl.style.color = 'var(--accent)';
        },
      });
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

  // === 自動同期スケジュール更新（MeldexScheduler ウィジェットから呼ばれる） ===
  async function _updateAutoSyncSchedule(card, index, scheduleCfg) {
    const statusEl = card?.querySelector?.('.notion-folder-status');
    const isEnabled = scheduleCfg && scheduleCfg.type !== 'off';
    try {
      if (isEnabled) {
        const path = card.querySelector('.notion-folder-path').value.trim();
        const notionUrl = card.querySelector('.notion-page-url').value.trim();
        if (!path) {
          showStatus('自動同期にはフォルダ指定が必要です', true);
          return;
        }
        if (!notionUrl) {
          showStatus('自動同期にはNotionページURLが必要です', true);
          return;
        }
        const cfg = await apiFetch('/notion/config');
        if (!cfg?.has_token) {
          card.dataset.notionHasToken = '0';
          showStatus('自動同期にはNotionトークンの保存が必要です', true);
          return;
        }
        card.dataset.notionHasToken = '1';
        const ready = await _ensureNotionPageReady(card, statusEl);
        if (!ready) {
          showStatus('Notionページを確認できないため、自動同期を無効にしました', true);
          return;
        }
      }
      await _saveFolderConfig(card, {});
      if (isEnabled) {
        const text = window.MeldexScheduler?.nextRunText?.(scheduleCfg) || '';
        showStatus(`自動同期を設定しました: ${text}`);
      } else {
        showStatus('自動同期を無効にしました');
      }
    } catch (e) {
      showStatus('設定の保存に失敗しました', true);
    }
  }

  function _formatScheduleState(state) {
    if (!state) return '';
    const parts = [];
    if (state.next_run_display) parts.push(`次回予定: ${state.next_run_display}`);
    if (state.last_run) {
      const label = state.last_run.status === 'done' ? '成功' : (state.last_run.status === 'error' ? '失敗' : state.last_run.status);
      parts.push(`前回自動実行: ${label}`);
    }
    if (state.needs_attention) parts.push('連続で失敗しています。設定をご確認ください。');
    return parts.join(' / ');
  }

  // 定期実行の実行判断・巡回はバックエンド（meldex_import_scheduler.py）が担うため、
  // ブラウザー側のタイマー管理・自己実行は廃止した（WebClipper・インポート定期実行
  // 計画 2026-08-04「永続スケジューラー」節）。以下は他呼び出し元への互換スタブ。
  function _clearAllAutoSyncTimers() {}

  async function _reconcileTimers() {}

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
