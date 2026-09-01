// ユーザー管理シート（内部互換名: スタッフ管理）のセクション表示。
// ユーザーアカウント一元管理 計画書 Phase 1（§5.7）。
// 一覧はアイコン+表示名+権限バッジのみ（編集UIは置かず正本シートへ誘導する。
// 「何かを追加する時にダイアログで設定を強要しない」原則により、未設定時も
// ダイアログは出さず、一覧を開いた時点で無ダイアログ自動作成する）。
async function _renderStaffRegistrySettings() {
  const listEl = document.getElementById('settings-staff-list');
  const locationEl = document.getElementById('settings-staff-location');
  if (!listEl || typeof window.MeldexUserRegistry === 'undefined' || !window.MeldexUserRegistry) return;
  listEl.innerHTML = '<div class="gb-section-desc">読み込み中...</div>';
  try {
    let config = await window.MeldexUserRegistry.getConfig();
    let staff;
    let duplicates;
    if (!config.path) {
      // 未設定なら初回アクセスとしてここで無ダイアログ自動作成する（計画書§5.1）。
      const ensured = await window.MeldexUserRegistry.ensure();
      config = { path: ensured.path || '', updated: ensured.updated || '' };
      staff = ensured.staff || [];
      duplicates = ensured.duplicates || [];
    } else {
      staff = await window.MeldexUserRegistry.listStaff({ force: true });
      duplicates = window.MeldexUserRegistry.listDuplicatesSync();
    }
    if (locationEl) {
      const staffLocationPath = config.path || '（未設定）';
      locationEl.style.whiteSpace = 'nowrap';
      locationEl.style.overflow = 'hidden';
      // 長いパスは実効幅に収めて「先頭…末尾ファイル名」形式で中略表示する
      if (typeof applyMiddleEllipsis === 'function') applyMiddleEllipsis(locationEl, staffLocationPath);
      else locationEl.textContent = staffLocationPath;
    }
    listEl.innerHTML = '';
    if (!staff.length) {
      listEl.innerHTML = '<div class="gb-section-desc">ユーザーがいません</div>';
    }
    const myName = typeof getUsername === 'function' ? getUsername() : '';
    const duplicateUsers = new Set((duplicates || []).map(d => d.user));
    for (const row of staff) {
      const item = document.createElement('div');
      item.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);';
      const isLeft = !!row.active_to && row.active_to <= new Date().toISOString().slice(0, 10);
      if (isLeft) item.style.opacity = '0.55';
      const av = document.createElement('div');
      av.style.cssText = 'width:24px;height:24px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;';
      const avatarUrl = window.MeldexDataAccess?.team?.avatarUrl?.(row.user) || (`${API_BASE}/team/avatar/${encodeURIComponent(row.user)}`);
      av.innerHTML = `<img src="${esc(avatarUrl)}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.textContent='${esc((row.display || row.user || '?').charAt(0).toUpperCase())}';">`;
      item.appendChild(av);
      const nameSpan = document.createElement('span');
      nameSpan.style.cssText = 'flex:1 1 0;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      nameSpan.textContent = (row.display || row.user) + (row.user === myName ? '（自分）' : '') + (duplicateUsers.has(row.user) ? ' ⚠' : '');
      nameSpan.title = duplicateUsers.has(row.user) ? '同じユーザーが複数のユーザー行に設定されています' : nameSpan.textContent;
      item.appendChild(nameSpan);
      const typeBadge = document.createElement('span');
      typeBadge.style.cssText = 'font-size:10px;padding:1px 6px;border-radius:8px;background:var(--bg3);color:var(--fg2);flex-shrink:0;';
      typeBadge.textContent = row.user_type === 'virtual' ? '仮ユーザー' : 'アカウント';
      typeBadge.title = row.user_type === 'virtual' ? 'ログイン不可・制作管理専用' : 'ログインとワークスペースアクセスに利用できます';
      item.appendChild(typeBadge);
      if (isLeft) {
        const leftBadge = document.createElement('span');
        leftBadge.style.cssText = 'font-size:10px;padding:1px 6px;border-radius:8px;background:var(--bg4);color:var(--fg2);flex-shrink:0;';
        leftBadge.textContent = '離脱';
        item.appendChild(leftBadge);
      }
      listEl.appendChild(item);
    }
  } catch (e) {
    listEl.innerHTML = '<div style="color:var(--fg2);">読み込みエラー</div>';
  }
}

async function loadFileLockListForSettings() {
  const el = document.getElementById('settings-file-lock-list');
  if (!el) return;
  el.innerHTML = '<div class="gb-section-desc">読み込み中...</div>';
  try {
    if (typeof _ensureRoleLoaded === 'function') await _ensureRoleLoaded();
    if (typeof _ensureLocksLoaded === 'function') await _ensureLocksLoaded({ force: true });
    const data = await apiFetch('/file-lock');
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    if (!entries.length) {
      el.innerHTML = '<div class="gb-section-desc">編集ロック中の項目はありません</div>';
      return;
    }
    const canUnlock = typeof isFileLockOwner === 'function' && isFileLockOwner();
    el.innerHTML = '';
    for (const entry of entries) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);';
      const body = document.createElement('div');
      body.style.cssText = 'flex:1;min-width:0;';
      const path = document.createElement('div');
      path.style.cssText = 'font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      path.textContent = entry.path || entry.normalized_path || '';
      path.title = path.textContent;
      body.appendChild(path);
      const meta = document.createElement('div');
      meta.className = 'gb-section-desc';
      const parts = [];
      if (entry.lock_reason) parts.push('理由: ' + entry.lock_reason);
      if (entry.locked_by) parts.push('設定者: ' + entry.locked_by);
      if (entry.locked_at) parts.push(String(entry.locked_at).replace('T', ' ').substring(0, 16));
      meta.textContent = parts.join(' / ') || '理由なし';
      body.appendChild(meta);
      row.appendChild(body);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gb-btn gb-btn-xs';
      btn.textContent = canUnlock ? '解除' : '閲覧のみ';
      btn.disabled = !canUnlock;
      btn.addEventListener('click', async () => {
        if (!canUnlock) return;
        try {
          await apiFetch('/file-lock?path=' + encodeURIComponent(entry.path || ''), { method: 'DELETE' });
          if (typeof _ensureLocksLoaded === 'function') await _ensureLocksLoaded({ force: true });
          if (typeof refreshOutliner === 'function') await refreshOutliner();
          window.MeldexFileLockBadge?.refreshAll?.();
          await loadFileLockListForSettings();
          showStatus('編集ロックを解除しました');
        } catch {
          showStatus('編集ロック解除に失敗しました', true);
        }
      });
      row.appendChild(btn);
      el.appendChild(row);
    }
  } catch {
    el.innerHTML = '<div style="color:var(--fg2);">読み込みエラー</div>';
  }
}

// _showEditUserModal, addUserFromSettings, removeUserFromSettings, doLogout,
// loadUserListForSettings, _renderTeamMemberRows は廃止
// （ユーザー管理はマイプロフィール + スタッフ管理シートの表示に統合。
// ユーザーアカウント一元管理 計画書 Phase 1、2026-07-19）

function _replaceChildrenWithText(el, text) {
  if (!el) return null;
  el.textContent = '';
  const span = document.createElement('span');
  span.textContent = text;
  el.appendChild(span);
  return span;
}

function _setAvatarImageNode(el, src, styleText) {
  if (!el) return null;
  el.textContent = '';
  const img = document.createElement('img');
  img.src = String(src || '');
  img.alt = '';
  img.style.cssText = styleText || 'width:100%;height:100%;object-fit:cover;';
  el.appendChild(img);
  return img;
}

async function _saveAvatarDataUrl(dataUrl, iconSpec) {
  localStorage.setItem('meldex-avatar', dataUrl);
  if (iconSpec) localStorage.setItem('meldex-avatar-spec', iconSpec);
  else localStorage.removeItem('meldex-avatar-spec');
  updateUserIcon();
  const preview = document.getElementById('settings-my-avatar');
  if (preview) _setAvatarImageNode(preview, dataUrl);
  if (window.MeldexDropboxProfileSync?.afterLocalProfileChanged) {
    await window.MeldexDropboxProfileSync.afterLocalProfileChanged({ avatar: dataUrl, avatarSpec: iconSpec || '' });
  } else {
    try { await apiPost('/team/sync', { name: getUsername(), avatar: dataUrl }); } catch {}
  }
}

async function chooseAvatarIcon(anchorEl) {
  if (typeof GBIconAssets === 'undefined') {
    document.getElementById('avatar-upload-input')?.click();
    return;
  }
  GBIconAssets.openPicker({
    title: 'ユーザーアイコン',
    className: 'avatar-icon-picker',
    anchorEl: anchorEl || document.getElementById('settings-my-avatar'),
    current: localStorage.getItem('meldex-avatar-spec') || '',
    includeLucide: true,
    includeNoto: true,
    onSelect: async (spec) => {
      const normalized = GBIconAssets.normalizeSpec(spec);
      const dataUrl = GBIconAssets.toAvatarDataUrl(normalized, {
        bg: typeof _getAvatarBgColor === 'function' ? _getAvatarBgColor() : '#000000',
        fg: '#d4d4d4',
      });
      await _saveAvatarDataUrl(dataUrl, normalized);
      showStatus('アイコンを更新しました');
    },
  });
}

async function refreshAvatarIconColor(color) {
  const spec = localStorage.getItem('meldex-avatar-spec');
  if (!spec || typeof GBIconAssets === 'undefined') return;
  const bg = typeof _normalizeAvatarBgColor === 'function' ? _normalizeAvatarBgColor(color) : (color || '#000000');
  const dataUrl = GBIconAssets.toAvatarDataUrl(spec, { bg, fg: '#d4d4d4' });
  await _saveAvatarDataUrl(dataUrl, spec);
}

async function uploadAvatar(input) {
  const file = input.files?.[0];
  if (!file) return;
  // 画像を128x128にリサイズしてからチームファイルに同期
  const img = new Image();
  const objUrl = URL.createObjectURL(file);
  img.onload = async () => {
    try {
      const canvas = document.createElement('canvas');
      const size = 128;
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      // 中央トリミング
      const s = Math.min(img.width, img.height);
      const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
      ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
      const dataUrl = canvas.toDataURL('image/png');
      // localStorageにキャッシュ
      await _saveAvatarDataUrl(dataUrl, '');
      showStatus('アイコンを更新しました');
    } catch(e) {
      showStatus('アイコンの処理に失敗しました', true);
    } finally {
      URL.revokeObjectURL(objUrl);
    }
  };
  img.onerror = () => {
    URL.revokeObjectURL(objUrl);
    showStatus('画像を読み込めませんでした', true);
  };
  img.src = objUrl;
  input.value = '';
}

async function removeAvatar() {
  localStorage.removeItem('meldex-avatar');
  localStorage.removeItem('meldex-avatar-spec');
  updateUserIcon();
  const preview = document.getElementById('settings-my-avatar');
  if (preview) {
    preview.style.background = typeof _getAvatarBgColor === 'function' ? _getAvatarBgColor() : '#000000';
    const span = _replaceChildrenWithText(preview, getUsername().charAt(0).toUpperCase());
    if (span) span.style.cssText = 'font-size:20px;font-weight:bold;color:var(--fg2);';
  }
  try {
    if (window.MeldexDropboxProfileSync?.afterLocalProfileChanged) {
      await window.MeldexDropboxProfileSync.afterLocalProfileChanged({ avatar: '', avatarSpec: '' });
    } else {
      await apiPost('/team/sync', { name: getUsername(), avatar: '' });
    }
    // チームファイルからアバター削除完了
    showStatus('アイコンを削除しました');
  } catch(e) {
    showStatus('アイコン削除の同期に失敗しました', true);
  }
}

// ユーザーアイコンを更新
function updateUserIcon() {
  const el = document.getElementById('btn-' + 'user');
  const localName = getUsername();
  if (el) {
    el.title = localName || 'ユーザー';
    // localStorageのアバターを即座に表示
    const cachedAvatar = localStorage.getItem('meldex-avatar');
    if (cachedAvatar) {
      _setAvatarImageNode(el, cachedAvatar, 'width:24px;height:24px;border-radius:50%;object-fit:cover;');
    } else {
      const ch = (localName || '?').charAt(0).toUpperCase();
      const avBg = typeof _getAvatarBgColor === 'function' ? _getAvatarBgColor() : '#000000';
      const span = _replaceChildrenWithText(el, ch);
      if (span) {
        span.className = 'user-avatar-bg';
        span.style.cssText = `display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:${avBg};font-size:12px;font-weight:bold;color:var(--fg2);`;
      }
    }
  }
  if (typeof updateLeftChromeUser === 'function') updateLeftChromeUser();
}

// ユーザーアバターHTML（チャットフキダシ用）
function getUserAvatarHtml(username, size) {
  size = size || 20;
  const fallbackChar = MeldexEscape.html((username || '?').charAt(0).toUpperCase());
  const baseStyle = `display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;flex-shrink:0;`;
  const rawSrc = window.MeldexDataAccess?.team?.avatarUrl?.(username || 'anonymous', {}) || `${API_BASE}/team/avatar/${encodeURIComponent(username)}?t=0`;
  const src = MeldexEscape.attr(rawSrc);
  return `<span style="${baseStyle}">
    <img src="${src}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex';">
    <span style="display:none;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;background:var(--bg4);font-size:${Math.round(size*0.55)}px;font-weight:bold;color:var(--fg2);">${fallbackChar}</span>
  </span>`;
}

// 旧認証関数（generatePassword, addUser, removeUser, doLogout）は廃止済み

function _syncSettingsModalOverlayForPanel(modalOrOverlay, panelName) {
  const overlay = modalOrOverlay?.classList?.contains?.('modal-overlay')
    ? modalOrOverlay
    : modalOrOverlay?.closest?.('.modal-overlay') || document.querySelector('.modal-overlay[data-settings-modal="1"]');
  if (!overlay) return;
  overlay.classList.remove('no-dim');
  delete overlay.dataset.settingsPreviewMode;
}

function _ensureSettingsThemePanelVisible(panelName, root) {
  const canonical = typeof _settingsCanonicalPanelName === 'function' ? _settingsCanonicalPanelName(panelName || '') : panelName;
  const panels = typeof _settingsLegacyPanelsForName === 'function' ? _settingsLegacyPanelsForName(panelName) : [canonical];
  if (!panels.includes('テーマ') || typeof ensureSettingsThemePanel !== 'function') return;
  const scope = root?.closest?.('.modal') || root || document;
  const panel = scope.querySelector?.('.settings-panel[data-panel="テーマ"]');
  if (panel) ensureSettingsThemePanel(panel);
}

const _SETTINGS_PANEL_INIT_DATA_KEYS = {
  '全般': 'settingsInitGeneral',
  'テーマ': 'settingsInitTheme',
  'LLM': 'settingsInitLlm',
  'LLMコスト': 'settingsInitChatCost',
  'フィードバック': 'settingsInitFeedbackForm',
  'ユーザー': 'settingsInitUsers',
  'ワークスペース': 'settingsInitWorkspaces',
  '取り込み': 'settingsInitExternalImport',
  '拡張機能': 'settingsInitExtensions',
  'ショートカット': 'settingsInitShortcuts',
  'ゴミ箱': 'settingsInitTrash',
  'データベース': 'settingsInitDatabaseMaintenance',
};

function _scheduleSettingsPanelInitialization(panelName, root, options = {}) {
  const panelNames = typeof _settingsLegacyPanelsForName === 'function'
    ? _settingsLegacyPanelsForName(panelName, options)
    : [];
  const targets = panelNames.length
    ? panelNames
    : [typeof _settingsCanonicalPanelName === 'function' ? _settingsCanonicalPanelName(panelName || '') : panelName];
  targets.filter(Boolean).forEach(targetPanel => _scheduleSettingsLegacyPanelInitialization(targetPanel, root, options));
}

function _scheduleSettingsLegacyPanelInitialization(panelName, root, options = {}) {
  const canonical = typeof _settingsCanonicalPanelName === 'function' ? _settingsCanonicalPanelName(panelName || '') : panelName;
  const key = _SETTINGS_PANEL_INIT_DATA_KEYS[canonical];
  if (!key) return;
  const overlay = root?.classList?.contains?.('modal-overlay')
    ? root
    : root?.closest?.('.modal-overlay') || document.querySelector('.modal-overlay[data-settings-modal="1"]');
  const modal = overlay?.querySelector?.('.modal') || root?.closest?.('.modal');
  if (!modal || modal.dataset[key] === '1') return;
  modal.dataset[key] = '1';
  const retryPanelInitialization = () => {
    if (!modal.isConnected) return;
    const retryKey = key + 'RetryCount';
    const count = parseInt(modal.dataset[retryKey] || '0', 10) || 0;
    if (count > 60) return;
    modal.dataset[retryKey] = String(count + 1);
    delete modal.dataset[key];
    setTimeout(() => _scheduleSettingsPanelInitialization(canonical, modal, options), 120);
  };
  const clearPanelInitializationRetry = () => {
    delete modal.dataset[key + 'RetryCount'];
  };
  const run = () => {
    if (!modal.isConnected) return;
    if (canonical === '全般') {
      if (typeof loadOutlinerRootsForSettings === 'function') loadOutlinerRootsForSettings();
      if (typeof loadStorageInfoForSettings === 'function') loadStorageInfoForSettings();
      if (typeof loadHomeFolderSharingStatusForSettings === 'function') loadHomeFolderSharingStatusForSettings();
      if (typeof loadSettingsTransferStatusForSettings === 'function') loadSettingsTransferStatusForSettings();
      if (typeof updateRestorePointScheduleSettingsVisibility === 'function') updateRestorePointScheduleSettingsVisibility();
      if (typeof loadDefaultAppAssociationsForSettings === 'function') loadDefaultAppAssociationsForSettings();
      if (typeof _loadAutostartStateForSettings === 'function') _loadAutostartStateForSettings();
      window.MeldexSettingsCloudLink?.renderStatusCard?.(modal.querySelector('#settings-cloud-link-card'));
      return;
    }
    if (canonical === 'テーマ') {
      _ensureSettingsThemePanelVisible(canonical, modal);
      return;
    }
    if (canonical === 'LLM') {
      if (typeof _loadLlmConfigForSettings === 'function') _loadLlmConfigForSettings();
      if (typeof renderKnowledgeAutomationSettings === 'function') renderKnowledgeAutomationSettings(modal);
      if (typeof renderAutoTagSettings === 'function') renderAutoTagSettings(modal);
      return;
    }
    if (canonical === 'LLMコスト') {
      if (typeof renderChatCostSettings === 'function') renderChatCostSettings(modal);
      return;
    }
    if (canonical === 'フィードバック' && typeof renderMeldexFeedbackPanel === 'function') {
      renderMeldexFeedbackPanel(modal);
      if (typeof renderMeldexFeedbackSettingsPanel === 'function') renderMeldexFeedbackSettingsPanel(modal);
      return;
    }
    if (canonical === 'ユーザー') {
      if (typeof _renderStaffRegistrySettings === 'function') _renderStaffRegistrySettings();
      if (typeof loadFileLockListForSettings === 'function') loadFileLockListForSettings();
      window.MeldexSettingsAccountLink?.renderStatusLine?.(modal.querySelector('#settings-account-link-status'));
      return;
    }
    if (canonical === 'ワークスペース') {
      if (typeof settingsInitWorkspaces === 'function') settingsInitWorkspaces(modal);
      return;
    }
    if (canonical === '取り込み') {
      if (typeof renderExternalImportSettings === 'function') renderExternalImportSettings(modal);
      if (typeof renderXBookmarksSettings === 'function') renderXBookmarksSettings(modal);
      if (typeof renderXAccountPostsSettings === 'function') renderXAccountPostsSettings(modal);
      return;
    }
    if (canonical === '拡張機能' && typeof _loadExtensionStatus === 'function') {
      if (typeof renderNotionSyncSettings === 'function') renderNotionSyncSettings(modal);
      if (typeof loadWebClipperSetupForSettings === 'function') loadWebClipperSetupForSettings();
      _loadExtensionStatus();
      return;
    }
    if (canonical === 'ショートカット') {
      const container = modal.querySelector('#shortcut-settings-container');
      if (!container || typeof renderShortcutSettings !== 'function' || typeof _getEffectiveShortcuts !== 'function') {
        retryPanelInitialization();
        return;
      }
      try {
        renderShortcutSettings(container);
      } catch (error) {
        try { console.warn('[settings] shortcut panel initialization retry', error); } catch {}
        retryPanelInitialization();
        return;
      }
      if (!container.querySelector('.shortcut-row')) {
        retryPanelInitialization();
        return;
      }
      clearPanelInitializationRetry();
      return;
    }
    if (canonical === 'ゴミ箱') {
      if (typeof renderTrashSettings === 'function') renderTrashSettings(modal);
      return;
    }
    if (canonical === 'データベース') {
      if (typeof renderDatabaseMaintenanceSettings === 'function') renderDatabaseMaintenanceSettings(modal);
      window.MeldexTagMaintenanceSettings?.render?.(modal);
      window.MeldexDuplicateMonitor?.renderSettings?.(modal);
      return;
    }
  };
  if (options.immediate === true) {
    run();
    return;
  }
  let queued = false;
  const queueRun = () => {
    if (queued) return;
    queued = true;
    setTimeout(run, 0);
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(queueRun);
    setTimeout(queueRun, 50);
  } else {
    queueRun();
  }
}

function _renderSettingsSubtabs(modal, target) {
  const header = modal?.querySelector?.('#settings-subtab-header');
  if (!header) return;
  header.hidden = true;
  header.innerHTML = '';
}

function _syncSettingsTreeSelection(modal, target) {
  if (!modal || !target) return;
  const tabHeader = modal.querySelector('#settings-tab-header');
  if (!tabHeader) return;

  // ツリーノード（子ページを持つカテゴリ）の展開と選択同期
  tabHeader.querySelectorAll('.settings-sidebar-tree-node').forEach(node => {
    const isTargetTab = node.dataset.treeTab === target.tabId;
    const parentBtn = node.querySelector('.settings-sidebar-parent-tab');

    if (isTargetTab) {
      _setSettingsTreeNodeExpanded(node, true);
    } else {
      if (parentBtn) {
        parentBtn.classList.remove('active', 'gb-inner-tab-active');
      }
    }

    // 親は開閉操作、子は現在ページの選択を表す。同時に強調しない。
    parentBtn?.classList.remove('active', 'gb-inner-tab-active');
    parentBtn?.removeAttribute('aria-current');

    // サブページボタンのアクティブ同期
    node.querySelectorAll('.settings-sidebar-subpage').forEach(subpage => {
      const isSubActive = isTargetTab && subpage.dataset.settingsPage === target.pageId;
      subpage.classList.toggle('active', isSubActive);
      subpage.classList.toggle('gb-inner-tab-active', isSubActive);
      if (isSubActive) subpage.setAttribute('aria-current', 'page');
      else subpage.removeAttribute('aria-current');
    });
  });

  // 単一ページカテゴリのタブ同期
  tabHeader.querySelectorAll('.settings-sidebar-tab:not(.settings-sidebar-parent-tab)').forEach(t => {
    const active = t.dataset.tab === target.tabId;
    t.classList.toggle('gb-inner-tab-active', active);
    t.classList.toggle('active', active);
    if (active) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });

  // キーボードイベントの初期化
  _wireSettingsTreeKeyboard(tabHeader);
}

function _setSettingsTreeNodeExpanded(node, expanded) {
  if (!node) return;
  const open = expanded === true;
  node.classList.toggle('expanded', open);
  const parentBtn = node.querySelector('.settings-sidebar-parent-tab');
  const subpages = node.querySelector('.settings-sidebar-subpages');
  const chevron = node.querySelector('.settings-tree-chevron');
  if (parentBtn) parentBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (subpages) subpages.style.display = open ? '' : 'none';
  if (chevron && typeof lucide === 'function') chevron.innerHTML = lucide(open ? 'chevronDown' : 'chevronRight', 12);
}

function _wireSettingsTreeKeyboard(tabHeader) {
  if (!tabHeader || tabHeader.__gbTreeKeyboardWired) return;
  tabHeader.__gbTreeKeyboardWired = true;

  tabHeader.addEventListener('keydown', (e) => {
    const focusable = Array.from(tabHeader.querySelectorAll('.settings-sidebar-tab, .settings-sidebar-subpage')).filter(el => {
      return el.offsetParent !== null && !el.disabled;
    });
    const currentIndex = focusable.indexOf(document.activeElement);
    if (currentIndex === -1) return;

    const current = focusable[currentIndex];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = focusable[(currentIndex + 1) % focusable.length];
      next?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = focusable[(currentIndex - 1 + focusable.length) % focusable.length];
      prev?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusable[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      focusable[focusable.length - 1]?.focus();
    } else if (e.key === 'ArrowRight') {
      const node = current.closest('.settings-sidebar-tree-node');
      if (node && current.classList.contains('settings-sidebar-parent-tab')) {
        e.preventDefault();
        _setSettingsTreeNodeExpanded(node, true);
        const firstChild = node.querySelector('.settings-sidebar-subpage');
        firstChild?.focus();
      }
    } else if (e.key === 'ArrowLeft') {
      if (current.classList.contains('settings-sidebar-subpage')) {
        e.preventDefault();
        const parentBtn = current.closest('.settings-sidebar-tree-node')?.querySelector('.settings-sidebar-parent-tab');
        parentBtn?.focus();
      } else {
        const node = current.closest('.settings-sidebar-tree-node');
        if (node && node.classList.contains('expanded')) {
          e.preventDefault();
          _setSettingsTreeNodeExpanded(node, false);
        }
      }
    }
  });
}

function selectSettingsTreeSubpage(el) {
  if (!el) return;
  const tabId = el.dataset.settingsTab;
  const pageId = el.dataset.settingsPage;
  _openSettingsSection(tabId, el.closest('.modal') || el.closest('.settings-modal'), { pageId });
}
window.selectSettingsTreeSubpage = selectSettingsTreeSubpage;

function _showSettingsNavigationTarget(modal, target) {
  if (!modal || !target) return;
  const panelNames = new Set(typeof _settingsLegacyPanelsForName === 'function' ? _settingsLegacyPanelsForName(target) : []);
  modal.querySelectorAll('.settings-panel').forEach(p => {
    p.hidden = !panelNames.has(p.dataset.panel);
    p.style.display = '';
  });
  // 再描画後のフィルタ掛け直し用に現在のタブ/サブタブを記録（part05 の _settingsThemeReapplyNavigationView が参照）
  modal.dataset.settingsActiveTabId = target.tabId || '';
  modal.dataset.settingsActivePageId = target.pageId || '';
  _renderSettingsSubtabs(modal, target);
  _syncSettingsTreeSelection(modal, target);
  // テーマパネルは遅延描画のため、view フィルタより先に中身を確定させる
  _ensureSettingsThemePanelVisible(target.tabId, modal);
  if (typeof _applySettingsNavigationView === 'function') _applySettingsNavigationView(modal, target);
  _syncSettingsModalOverlayForPanel(modal, target.tabId);
  _scheduleSettingsPanelInitialization(target, modal, { immediate: true });
  const headerText = modal.querySelector('#settings-header-text');
  if (headerText) headerText.textContent = typeof _settingsNavigationDisplayName === 'function'
    ? _settingsNavigationDisplayName(target.tabId, { pageId: target.pageId })
    : (target.pageLabel || target.tabId);
  window.MeldexSettingsDialogController?.get?.(modal)?.syncCurrentPage?.(target);
}

function switchSettingsTab(el) {
  const target = typeof resolveSettingsNavigationTarget === 'function'
    ? resolveSettingsNavigationTarget(el.dataset.tab)
    : { tabId: (typeof _settingsCanonicalPanelName === 'function' ? _settingsCanonicalPanelName(el.dataset.tab) : el.dataset.tab), panels: [el.dataset.tab] };
  const tabName = target.tabId;
  const node = el.closest('.settings-sidebar-tree-node');
  if (node && el.classList.contains('settings-sidebar-parent-tab')) {
    const expanded = node.classList.contains('expanded');
    _setSettingsTreeNodeExpanded(node, !expanded);
    if (expanded) return;
  }
  try {
    window.MeldexDiagnostics?.recordOperation?.('設定タブを開く', { settingsPanel: tabName });
  } catch {}
  _showSettingsNavigationTarget(el.closest('.modal') || el.closest('.settings-modal'), target);
}

// モバイル: セクションドリルダウン
function _settingsModalFromRoot(root) {
  if (root?.classList?.contains?.('settings-modal')) return root;
  if (root?.classList?.contains?.('modal-overlay')) return root.querySelector?.('.settings-modal');
  return root?.querySelector?.('.settings-modal')
    || root?.closest?.('.modal-overlay')?.querySelector?.('.settings-modal')
    || document.querySelector('.modal-overlay[data-settings-modal="1"] .settings-modal');
}

// モバイル: セクションドリルダウン
function _openSettingsSection(panelName, root, options = {}) {
  const modal = _settingsModalFromRoot(root);
  if (!modal) return;
  const controller = window.MeldexSettingsDialogController?.get?.(modal);
  if (controller && options.fromController !== true) return controller.open(panelName, options);
  const target = typeof resolveSettingsNavigationTarget === 'function'
    ? resolveSettingsNavigationTarget(panelName, options)
    : { tabId: (typeof _settingsCanonicalPanelName === 'function' ? _settingsCanonicalPanelName(panelName) : panelName), panels: [panelName] };
  panelName = target.tabId;
  try {
    window.MeldexDiagnostics?.recordOperation?.('設定タブを開く', { settingsPanel: panelName });
  } catch {}
  const navList = modal.querySelector('#settings-nav-list');
  if (navList) navList.hidden = true;
  _showSettingsNavigationTarget(modal, target);
  const btnRow = modal.querySelector(':scope > .gb-modal-footer[data-settings-dialog-footer="1"], :scope > .gb-modal-shell-footer[data-settings-dialog-footer="1"]');
  if (btnRow) btnRow.hidden = false;
  const backBtn = modal.querySelector('#settings-back-btn');
  if (backBtn) backBtn.hidden = false;
  const headerText = modal.querySelector('#settings-header-text');
  if (headerText) {
    headerText.textContent = typeof _settingsPanelDisplayName === 'function'
      ? _settingsPanelDisplayName(target.tabId, { pageId: target.pageId })
      : panelName;
  }
}
function _backToSettingsList(root) {
  const modal = _settingsModalFromRoot(root);
  if (!modal) return;
  const controller = window.MeldexSettingsDialogController?.get?.(modal);
  if (controller) return controller.back();
  modal.querySelectorAll('.settings-panel').forEach(p => { p.hidden = true; p.style.display = ''; });
  const btnRow = modal.querySelector(':scope > .gb-modal-footer[data-settings-dialog-footer="1"], :scope > .gb-modal-shell-footer[data-settings-dialog-footer="1"]');
  if (btnRow) btnRow.hidden = true;
  const navList = modal.querySelector('#settings-nav-list');
  if (navList) navList.hidden = false;
  const subtabHeader = modal.querySelector('#settings-subtab-header');
  if (subtabHeader) {
    subtabHeader.hidden = true;
    subtabHeader.innerHTML = '';
  }
  const backBtn = modal.querySelector('#settings-back-btn');
  if (backBtn) backBtn.hidden = true;
  const headerText = modal.querySelector('#settings-header-text');
  if (headerText) headerText.innerHTML = '<span class="ico ico-settings"></span> 設定';
  _syncSettingsModalOverlayForPanel(modal, '');
  replaceIcons(modal);
}

// 拡張機能ごとの手順ノート（配布版でインストールボタンを出せない時の誘導先）。
const MELDEX_EXTENSION_GUIDES = {
  pillow: { title: '画像ツールの設定', path: '03_設定と連携/画像ツールの設定.md' },
  clip: { title: '画像ツールの設定', path: '03_設定と連携/画像ツールの設定.md' },
  caldav: { title: 'CalDAVカレンダー同期の設定', path: '03_設定と連携/CalDAVカレンダー同期の設定.md' },
};

function openExtensionInstallGuide(key) {
  const guide = MELDEX_EXTENSION_GUIDES[key];
  if (!guide) return;
  if (typeof closeSettingsModalRestoringTheme === 'function') closeSettingsModalRestoringTheme();
  window.MeldexPublicManual?.open?.(guide.path);
}

async function _loadExtensionStatus() {
  const el = document.getElementById('ext-status');
  if (!el) return;
  el.innerHTML = '<span style="color:var(--fg2);">読み込み中...</span>';
  try {
    const status = await apiFetch('/extensions/status');
    // 凍結ビルド（配布版のexe）では sys.executable がMeldex本体を指すため
    // pip installが成立しない（③）。このPCに本体と同じ版のPythonが入っていれば
    // そちらを使って導入できるので、その場合だけボタンを出す。見つからない場合は
    // 押しても何も起きないボタンを残さず、手順ノートへの誘導へ差し替える。
    const externalPython = status.external_python || {};
    const canUseExternalPython = !!status.frozen && !!externalPython.available;
    const frozen = !!status.frozen && !canUseExternalPython;
    const externalPythonNote = canUseExternalPython
      ? `このPCの Python ${esc(externalPython.version || '')} を使って導入します`
      : '';
    const missingPythonReason = (!!status.frozen && !canUseExternalPython)
      ? (externalPython.reason || '配布版では自動インストールできません')
      : '';
    const exts = [
      { key: 'pillow', name: 'Pillow（画像処理）', desc: '重複画像検出に必要', size: '~3MB', installed: status.pillow },
      { key: 'clip', name: 'CLIP（画像類似検索）', desc: 'テキストで画像を検索。Pillowも同時にインストールされます', size: '~2GB', installed: status.clip },
      { key: 'caldav', name: 'CalDAV（カレンダー同期）', desc: 'iPhone/Thunderbird等とカレンダーを双方向同期', size: '~5MB', installed: status.caldav },
    ];
    el.innerHTML = exts.map(ext => {
      let action;
      if (ext.installed) {
        action = `<span style="color:var(--green);font-size:12px;font-weight:bold;">${lucide('check', 12)} インストール済み</span>`;
      } else if (frozen) {
        action = `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
          <span style="font-size:11px;color:var(--fg2);text-align:right;">${esc(missingPythonReason)}</span>
          <button data-action="openExtensionInstallGuide('${ext.key}')" style="padding:4px 14px;font-size:12px;background:var(--bg3);color:var(--fg);border:1px solid var(--border);border-radius:4px;cursor:pointer;">導入手順を見る</button>
        </div>`;
      } else {
        const note = externalPythonNote
          ? `<span style="font-size:11px;color:var(--fg2);text-align:right;">${externalPythonNote}</span>`
          : '';
        action = `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">${note}<button data-action="_installExtension('${ext.key}', this)" style="padding:4px 14px;font-size:12px;background:var(--accent);color:var(--ui-accent-fg, var(--ui-fg-strong));border:none;border-radius:4px;cursor:pointer;">インストール</button></div>`;
      }
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px;margin-bottom:6px;border:1px solid var(--border);border-radius:4px;background:var(--bg2);">
      <div style="flex:1;">
        <div style="font-weight:bold;font-size:13px;color:var(--fg);">${ext.name}</div>
        <div style="font-size:11px;color:var(--fg2);">${ext.desc}</div>
              <div style="font-size:11px;color:var(--fg2);">ファイルサイズ: ${ext.size}</div>
      </div>
      ${action}
    </div>`;
    }).join('');

    // CalDAVが有効なら接続情報を表示
    if (status.caldav) {
      try {
        const info = await apiFetch('/caldav/info');
        el.innerHTML += `<div style="padding:8px;margin-top:8px;border:1px solid var(--accent);border-radius:4px;background:var(--bg2);">
          <div style="font-weight:bold;font-size:13px;color:var(--accent);margin-bottom:6px;">CalDAV接続情報</div>
          <div style="font-size:12px;color:var(--fg);margin-bottom:4px;">URL: <code style="background:var(--bg);padding:2px 6px;border-radius:3px;user-select:all;">${esc(info.url)}</code></div>
          <div style="font-size:11px;color:var(--fg2);margin-bottom:2px;">iPhone: ${esc(info.instructions.iphone)}</div>
          <div style="font-size:11px;color:var(--fg2);margin-bottom:2px;">Thunderbird: ${esc(info.instructions.thunderbird)}</div>
          <div style="font-size:11px;color:var(--fg2);">Google: ${esc(info.instructions.google)}</div>
          <div style="margin-top:6px;display:flex;gap:6px;">
            <button data-action="apiPost('/caldav/sync-to-ics').then(r=>showStatus('同期完了: '+r.synced+'件'))" style="font-size:11px;padding:3px 10px;background:var(--bg3);color:var(--fg2);border:1px solid var(--border);border-radius:3px;cursor:pointer;">Meldex → CalDAV同期</button>
            <button data-action="apiPost('/caldav/sync-from-ics',{user:(typeof getUsername==='function'?getUsername():'')}).then(r=>showStatus('取込: '+r.imported+'件, 更新: '+r.updated+'件'))" style="font-size:11px;padding:3px 10px;background:var(--bg3);color:var(--fg2);border:1px solid var(--border);border-radius:3px;cursor:pointer;">CalDAV → Meldex同期</button>
          </div>
        </div>`;
      } catch {}
    }
  } catch {
    el.innerHTML = '<span style="color:var(--red);">ステータスの取得に失敗しました</span>';
  }
}

async function _installExtension(key, btn) {
  btn.disabled = true;
  btn.textContent = 'インストール中...';
  btn.style.background = 'var(--bg4)';
  btn.style.color = 'var(--fg2)';
  try {
    const res = await runBackgroundJob('/extensions/install', { extension: key }, {
      onProgress: (progress) => {
        const label = (progress && progress.message) || 'インストール中...';
        btn.textContent = label.length > 24 ? 'インストール中...' : label;
      },
    });
    if (res.ok) {
      btn.innerHTML = lucide('check', 12) + ' 完了（再起動で有効）';
      btn.style.background = 'var(--green)';
      btn.style.color = '#fff';
      showStatus(res.message);
    } else {
      btn.textContent = '失敗';
      btn.style.background = 'var(--red)';
      btn.style.color = '#fff';
      showStatus('インストール失敗: ' + res.error, true);
    }
  } catch (e) {
    btn.textContent = 'エラー';
    btn.style.background = 'var(--red)';
    btn.style.color = '#fff';
    showStatus('インストールエラー: ' + (e.message || e), true);
  }
}

const SETTINGS_RESET_HISTORY_SESSION_KEY = 'meldex:settings-reset-history';

function _captureAllLocalStorageSettings(extraKeys = []) {
  if (typeof captureLocalStorageSettings !== 'function') return null;
  const resetKeys = typeof _settingsResetStorageKeys === 'function' ? _settingsResetStorageKeys() : [];
  const keys = new Set([...resetKeys, ...(Array.isArray(extraKeys) ? extraKeys.filter(Boolean) : [])]);
  return captureLocalStorageSettings([...keys]);
}

async function _captureSettingsResetSnapshot(extraStorageKeys = []) {
  const [sourceFolders, uiConfig] = await Promise.all([
    typeof captureOutlinerRootsSettingsSnapshot === 'function'
      ? captureOutlinerRootsSettingsSnapshot().catch(() => null)
      : Promise.resolve(null),
    typeof apiFetch === 'function'
      ? apiFetch('/ui-config')
      : Promise.resolve({}),
  ]);
  return {
    storage: _captureAllLocalStorageSettings(extraStorageKeys),
    sourceFolders,
    uiConfig: uiConfig || {},
  };
}

async function _restoreSettingsResetSnapshot(snapshot) {
  if (!snapshot) return false;
  const rollbackStorage = _captureAllLocalStorageSettings(snapshot.storage?.keys || []);
  let currentUiConfig = null;
  if (typeof apiFetch === 'function') currentUiConfig = await apiFetch('/ui-config');
  const storageSnapshot = snapshot.storage;
  try {
    if (storageSnapshot && typeof restoreLocalStorageSettings === 'function') {
      restoreLocalStorageSettings(storageSnapshot, keys => {
        if (typeof _restoreSettingsDialogStorageAfterHistory === 'function') {
          _restoreSettingsDialogStorageAfterHistory(keys);
        }
      });
    }
    if (typeof apiPut === 'function') await apiPut('/ui-config', snapshot.uiConfig || {});
    return true;
  } catch (error) {
    if (rollbackStorage && typeof restoreLocalStorageSettings === 'function') {
      restoreLocalStorageSettings(rollbackStorage, () => {});
    }
    if (currentUiConfig && typeof apiPut === 'function') {
      try { await apiPut('/ui-config', currentUiConfig); } catch {}
    }
    throw error;
  }
}

async function _registerPendingSettingsResetHistory() {
  let raw = '';
  try { raw = sessionStorage.getItem(SETTINGS_RESET_HISTORY_SESSION_KEY) || ''; } catch {}
  if (!raw) return;
  try { sessionStorage.removeItem(SETTINGS_RESET_HISTORY_SESSION_KEY); } catch {}
  let payload = null;
  try { payload = JSON.parse(raw); } catch {}
  const before = payload?.before;
  if (!before || typeof historyPush !== 'function') return;
  const beforeKeys = before.storage?.keys || Object.keys(before.storage?.storage || {});
  const after = await _captureSettingsResetSnapshot(beforeKeys);
  let beforeStorage = before.storage;
  let afterStorage = after.storage;
  if (typeof _normalizeLocalStorageSettingsSnapshots === 'function') {
    const normalized = _normalizeLocalStorageSettingsSnapshots(before.storage, after.storage);
    beforeStorage = normalized.before;
    afterStorage = normalized.after;
  }
  const undoSnapshot = { ...before, storage: beforeStorage };
  const redoSnapshot = { ...after, storage: afterStorage };
  historyPush(
    '設定: 全設定初期化',
    () => _restoreSettingsResetSnapshot(undoSnapshot),
    () => _restoreSettingsResetSnapshot(redoSnapshot),
    'settings:reset',
    'リセット前の設定を復元'
  );
}

function _schedulePendingSettingsResetHistoryRegistration() {
  let attempts = 0;
  const run = () => {
    if (typeof historyPush !== 'function' && attempts < 20) {
      attempts += 1;
      setTimeout(run, 250);
      return;
    }
    _registerPendingSettingsResetHistory().catch(() => {});
  };
  setTimeout(run, 250);
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _schedulePendingSettingsResetHistoryRegistration, { once: true });
  } else {
    _schedulePendingSettingsResetHistoryRegistration();
  }
}

// 他の端末（デスクトップ版・クラウド版）と共有中のフォルダが実在するかを判定する。
// 判定できない場合（クラウド版、通信失敗など）は false を返し、追加の確認は出さない。
async function _settingsResetHasSharedSourceFolders() {
  try {
    if (window.MeldexRuntimeAdapter?.isBrowserDataMode?.()) return false;
    if (typeof apiFetch !== 'function') return false;
    const status = await apiFetch('/dropbox-link/status', { silentError: true });
    const roots = Array.isArray(status?.roots) ? status.roots : [];
    return roots.some(root => root?.state === 'shared');
  } catch {
    return false;
  }
}

async function resetAllSettings() {
  // 共有中のフォルダが実在する場合のみ、登録には影響しないことを追加で確認する
  // （共有していない大多数のユーザーには無関係な文言のため、該当時のみ表示）。
  if (await _settingsResetHasSharedSourceFolders() && typeof cfConfirm === 'function') {
    const proceed = await cfConfirm('他の端末と共有しているフォルダの登録には影響しません。このまま初期化を続けますか？');
    if (!proceed) return { ok: false, cancelled: true };
  }
  let beforeReset = null;
  try {
    beforeReset = await _captureSettingsResetSnapshot();
    const resetKeys = typeof _settingsResetStorageKeys === 'function' ? _settingsResetStorageKeys() : [];
    resetKeys.forEach(key => localStorage.removeItem(key));
    await _saveUiConfigToServer();
    try {
      sessionStorage.setItem(SETTINGS_RESET_HISTORY_SESSION_KEY, JSON.stringify({ before: beforeReset, at: Date.now() }));
    } catch {}
    location.reload();
    return { ok: true, changedKeys: resetKeys };
  } catch (error) {
    let rollbackFailed = false;
    if (beforeReset) {
      try { await _restoreSettingsResetSnapshot(beforeReset); } catch (rollbackError) {
        rollbackFailed = true;
        console.error('設定初期化のロールバック失敗:', rollbackError);
      }
    }
    const message = rollbackFailed
      ? '設定を初期化できず、自動復元にも失敗しました。設定画面を再読込して状態を確認してください。'
      : '設定を初期化できませんでした。内容は保持されています。';
    showStatus(message, true);
    return { ok: false, error: error?.message || String(error), rollbackFailed };
  }
}

function _settingsSaveFailure(domain, message) {
  const error = new Error(message || '設定を保存できませんでした');
  error.settingsDomain = domain || 'unknown';
  return error;
}

function _focusInvalidSettingsInput(input) {
  if (!input) return;
  input.setAttribute?.('aria-invalid', 'true');
  const view = input.closest?.('[data-settings-view]')?.dataset?.settingsView?.split(/\s+/)?.[0] || '';
  if (view && typeof getSettingsNavigationTabs === 'function') {
    const tab = getSettingsNavigationTabs().find(item => item.pages?.some(page => page.view === view));
    const page = tab?.pages?.find(item => item.view === view);
    if (tab && page) _openSettingsSection(tab.id, input.closest('.settings-modal'), { pageId: page.id, forcePage: true });
  }
  input.focus?.();
}

function _preflightSettingsSave() {
  const username = document.getElementById('modal-username');
  if (username && !String(username.value || '').trim()) {
    _focusInvalidSettingsInput(username);
    return { ok: false, failedDomain: 'profile', error: 'ユーザー名を入力してください' };
  }
  const numericFields = [
    ['modal-version-max', 1, 200], ['modal-history-max', 1, 200],
    ['modal-chat-temperature', 0, 2], ['modal-chat-max-tokens', 1, 1000000],
    ['modal-chat-top-p', 0, 1],
  ];
  for (const [id, min, max] of numericFields) {
    const input = document.getElementById(id);
    if (!input) continue;
    const raw = String(input.value || '').trim();
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value < min || value > max || input.checkValidity?.() === false) {
      _focusInvalidSettingsInput(input);
      return { ok: false, failedDomain: 'validation', error: `${input.getAttribute('aria-label') || input.name || id}の値が範囲外です` };
    }
  }
  return { ok: true };
}

function _settingsDomainIsDirty(overlay, prefixes) {
  const dirty = overlay?.__settingsDirtyControlIds;
  if (!(dirty instanceof Set)) return true;
  const list = Array.isArray(prefixes) ? prefixes : [prefixes];
  return [...dirty].some(id => list.some(prefix => id === prefix || id.startsWith(prefix)));
}

async function submitSettings() {
  const preflight = _preflightSettingsSave();
  if (!preflight.ok) {
    showStatus(preflight.error, true);
    return preflight;
  }
  showLoading('設定を保存中...');
  let settingsHistoryBefore = null;
  let sourceFolderHistoryBefore = null;
  let sourceFoldersDirty = false;
  const settingsExternalRollbacks = [];
  let pendingTransactionalExternalSave = null;
  let pendingOldUsernameCleanup = '';
  let llmKeysChanged = false;
  try {
  const settingsOverlay = document.querySelector('.modal-overlay[data-settings-modal="1"]');
  settingsHistoryBefore = typeof _captureSettingsDialogStorageSnapshot === 'function'
    ? _captureSettingsDialogStorageSnapshot()
    : null;
  sourceFoldersDirty = !!window._settingsOutlinerRootsDirty;
  sourceFolderHistoryBefore = sourceFoldersDirty && typeof captureOutlinerRootsSettingsSnapshot === 'function'
    ? await captureOutlinerRootsSettingsSnapshot()
    : null;
  const hasDirtyControls = settingsOverlay?.__settingsDirtyControlIds instanceof Set
    ? settingsOverlay.__settingsDirtyControlIds.size > 0
    : true;
  const themeDirty = typeof _settingsThemeIsDirty === 'function' && _settingsThemeIsDirty();
  if (!hasDirtyControls && !themeDirty && !sourceFoldersDirty) {
    showStatus('変更された設定はありません');
    return { ok: true, changedDomains: [] };
  }
  const transactionalExternalSaves = [];
  if (_settingsDomainIsDirty(settingsOverlay, 'publish-') && typeof savePublishSettingsFromPanel === 'function') {
    const publishContext = typeof createPublishContextSnapshot === 'function' ? createPublishContextSnapshot() : null;
    if (!publishContext) throw _settingsSaveFailure('publish', '公開設定の対象を確認できませんでした');
    transactionalExternalSaves.push({
      domain: 'publish',
      save: () => savePublishSettingsFromPanel(settingsOverlay, publishContext),
    });
  }
  if (_settingsDomainIsDirty(settingsOverlay, ['chat-budget-', 'modal-chat-budget-']) && typeof saveChatCostSettingsFromSettingsDialog === 'function') {
    transactionalExternalSaves.push({
      domain: 'chat-cost',
      save: () => saveChatCostSettingsFromSettingsDialog(settingsOverlay, { silent: true }),
    });
  }
  if (_settingsDomainIsDirty(settingsOverlay, ['auto-tag-', 'at-']) && typeof saveAutoTagSettingsFromSettingsDialog === 'function') {
    transactionalExternalSaves.push({
      domain: 'auto-tag',
      save: () => saveAutoTagSettingsFromSettingsDialog(settingsOverlay, { silent: true }),
    });
  }
  if (_settingsDomainIsDirty(settingsOverlay, ['cli-chat-', 'modal-cli-', 'settings-workspace-cli-'])
    && typeof saveCliChatSettingsFromSettingsDialog === 'function') {
    transactionalExternalSaves.push({
      domain: 'cli-chat',
      save: () => saveCliChatSettingsFromSettingsDialog(settingsOverlay, {
        silent: true,
        skipReload: true,
        backgroundChatRefresh: true,
        propagateRollbackFailure: true,
      }),
    });
  }
  if (transactionalExternalSaves.length > 1) {
    throw _settingsSaveFailure(
      'external-settings',
      '外部保存を伴う設定はデータ保護のため1種類ずつ保存してください',
    );
  }
  pendingTransactionalExternalSave = transactionalExternalSaves[0] || null;
  // select の change が未発火でも、保存前に共通フォントをテーマ変数へ確定する。
  const fontFamilyInput = document.getElementById('modal-font-family');
  if (fontFamilyInput && typeof settingsThemeApplyCommonFont === 'function') settingsThemeApplyCommonFont(fontFamilyInput.value || '');

  // テーマ編集があれば、設定ダイアログの保存ボタンでも選択中テーマへ反映する。
  if (typeof settingsThemeSaveFromSettingsDialog === 'function') {
    const themeSaveOk = await settingsThemeSaveFromSettingsDialog({ skipRefresh: true });
    if (themeSaveOk === false) throw _settingsSaveFailure('theme');
  }

  // テーマをlocalStorageに保存。失敗時は他の設定を書き込む前に中断する。
  if (typeof saveColorSettings === 'function' && saveColorSettings() === false) throw _settingsSaveFailure('theme');
