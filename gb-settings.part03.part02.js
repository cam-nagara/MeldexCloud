// スタッフ管理シート（正本）のセクション表示。
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
      listEl.innerHTML = '<div class="gb-section-desc">スタッフがいません</div>';
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
      nameSpan.title = duplicateUsers.has(row.user) ? '同じユーザーが複数のスタッフ行に設定されています' : nameSpan.textContent;
      item.appendChild(nameSpan);
      const roleBadge = document.createElement('span');
      roleBadge.style.cssText = 'font-size:10px;padding:1px 6px;border-radius:8px;background:var(--bg3);color:var(--fg2);flex-shrink:0;';
      roleBadge.textContent = row.role || '（権限未設定）';
      item.appendChild(roleBadge);
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
  const fallbackChar = (typeof esc === 'function' ? esc((username || '?').charAt(0).toUpperCase()) : String((username || '?').charAt(0).toUpperCase()).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const baseStyle = `display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;flex-shrink:0;`;
  const rawSrc = window.MeldexDataAccess?.team?.avatarUrl?.(username || 'anonymous', {}) || `${API_BASE}/team/avatar/${encodeURIComponent(username)}?t=0`;
  const src = typeof esc === 'function' ? esc(rawSrc) : String(rawSrc).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
  const canonical = typeof _settingsCanonicalPanelName === 'function' ? _settingsCanonicalPanelName(panelName || '') : panelName;
  const target = typeof resolveSettingsNavigationTarget === 'function' ? resolveSettingsNavigationTarget(panelName || canonical) : null;
  const isThemePanel = canonical === 'テーマ' || target?.tabId === 'テーマ' || (target?.panels || []).includes('テーマ');
  overlay.classList.toggle('no-dim', isThemePanel);
  overlay.dataset.settingsPreviewMode = isThemePanel ? 'theme' : '';
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
  'Discord Bot': 'settingsInitDiscordBot',
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
      if (typeof loadMobileAccessUrlsForSettings === 'function') loadMobileAccessUrlsForSettings();
      if (typeof loadSettingsTransferStatusForSettings === 'function') loadSettingsTransferStatusForSettings();
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
    if (canonical === 'Discord Bot') {
      if (typeof renderDiscordBotSettings === 'function') renderDiscordBotSettings(modal);
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
  const pages = Array.isArray(target?.tab?.pages) ? target.tab.pages : [];
  if (pages.length <= 1) {
    header.hidden = true;
    header.innerHTML = '';
    return;
  }
  header.hidden = false;
  header.innerHTML = pages.map(page => `
    <button type="button" class="settings-subtab${page.id === target.pageId ? ' active' : ''}"
      data-settings-tab="${esc(target.tabId)}"
      data-settings-page="${esc(page.id)}"
      data-e2e-id="settings-subtab-${esc(target.tabId)}-${esc(page.id)}">${esc(page.label)}</button>
  `).join('');
  header.querySelectorAll('[data-settings-page]').forEach(button => {
    button.addEventListener('click', () => {
      _openSettingsSection(button.dataset.settingsTab, modal, { pageId: button.dataset.settingsPage });
    });
  });
}

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
  // テーマパネルは遅延描画のため、view フィルタより先に中身を確定させる
  _ensureSettingsThemePanelVisible(target.tabId, modal);
  if (typeof _applySettingsNavigationView === 'function') _applySettingsNavigationView(modal, target);
  _syncSettingsModalOverlayForPanel(modal, target.tabId);
  _scheduleSettingsPanelInitialization(target, modal, { immediate: true });
}

function switchSettingsTab(el) {
  const target = typeof resolveSettingsNavigationTarget === 'function'
    ? resolveSettingsNavigationTarget(el.dataset.tab)
    : { tabId: (typeof _settingsCanonicalPanelName === 'function' ? _settingsCanonicalPanelName(el.dataset.tab) : el.dataset.tab), panels: [el.dataset.tab] };
  const tabName = target.tabId;
  try {
    window.MeldexDiagnostics?.recordOperation?.('設定タブを開く', { settingsPanel: tabName });
  } catch {}
  // タブヘッダー (gb-inner-tab-active クラス切替、旧インライン style をクリア)
  const tabHeader = el.closest('#settings-tab-header') || el.parentElement;
  tabHeader.querySelectorAll('.settings-tab').forEach(t => {
    const active = t.dataset.tab === tabName;
    t.classList.toggle('gb-inner-tab-active', active);
    t.classList.toggle('active', active);
    t.style.borderBottomColor = '';
    t.style.color = '';
    t.style.fontWeight = '';
  });
  _showSettingsNavigationTarget(el.closest('.modal'), target);
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
  modal.querySelectorAll('.settings-tab').forEach(tab => {
    const active = tab.dataset.tab === target.tabId;
    tab.classList.toggle('gb-inner-tab-active', active);
    tab.classList.toggle('active', active);
  });
  const btnRow = modal.querySelector('.btn-row');
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
  modal.querySelectorAll('.settings-panel').forEach(p => { p.hidden = true; p.style.display = ''; });
  const btnRow = modal.querySelector('.btn-row');
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

async function _loadExtensionStatus() {
  const el = document.getElementById('ext-status');
  if (!el) return;
  el.innerHTML = '<span style="color:var(--fg2);">読み込み中...</span>';
  try {
    const status = await apiFetch('/extensions/status');
    const exts = [
      { key: 'pillow', name: 'Pillow（画像処理）', desc: '重複画像検出に必要', size: '~3MB', installed: status.pillow },
      { key: 'clip', name: 'CLIP（画像類似検索）', desc: 'テキストで画像を検索。Pillowも同時にインストールされます', size: '~2GB', installed: status.clip },
      { key: 'caldav', name: 'CalDAV（カレンダー同期）', desc: 'iPhone/Thunderbird等とカレンダーを双方向同期', size: '~5MB', installed: status.caldav },
    ];
    el.innerHTML = exts.map(ext => `<div style="display:flex;align-items:center;gap:10px;padding:8px;margin-bottom:6px;border:1px solid var(--border);border-radius:4px;background:var(--bg2);">
      <div style="flex:1;">
        <div style="font-weight:bold;font-size:13px;color:var(--fg);">${ext.name}</div>
        <div style="font-size:11px;color:var(--fg2);">${ext.desc}</div>
              <div style="font-size:11px;color:var(--fg2);">ファイルサイズ: ${ext.size}</div>
      </div>
      ${ext.installed
        ? `<span style="color:var(--green);font-size:12px;font-weight:bold;">${lucide('check', 12)} インストール済み</span>`
        : `<button data-action="_installExtension('${ext.key}', this)" style="padding:4px 14px;font-size:12px;background:var(--accent);color:var(--ui-accent-fg, var(--ui-fg-strong));border:none;border-radius:4px;cursor:pointer;">インストール</button>`
      }
    </div>`).join('');

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
  const keys = new Set(Array.isArray(extraKeys) ? extraKeys.filter(Boolean) : []);
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) keys.add(key);
    }
  } catch {}
  return captureLocalStorageSettings([...keys]);
}

async function _captureSettingsResetSnapshot(extraStorageKeys = []) {
  const [sourceFolders, uiConfig] = await Promise.all([
    typeof captureOutlinerRootsSettingsSnapshot === 'function'
      ? captureOutlinerRootsSettingsSnapshot().catch(() => null)
      : Promise.resolve(null),
    typeof apiFetch === 'function'
      ? apiFetch('/ui-config').catch(() => ({}))
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
  const storageSnapshot = snapshot.storage;
  if (storageSnapshot && typeof restoreLocalStorageSettings === 'function') {
    restoreLocalStorageSettings(storageSnapshot, keys => {
      if (typeof _restoreSettingsDialogStorageAfterHistory === 'function') {
        _restoreSettingsDialogStorageAfterHistory(keys);
      }
    });
  }
  if (typeof apiPut === 'function') {
    try { await apiPut('/ui-config', snapshot.uiConfig || {}); } catch {}
  }
  if (snapshot.sourceFolders && typeof _restoreOutlinerRootsSettingsSnapshot === 'function') {
    await _restoreOutlinerRootsSettingsSnapshot(snapshot.sourceFolders);
  } else if (typeof loadOutliner === 'function') {
    try { await loadOutliner(); } catch {}
  }
  return true;
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
    if (!proceed) return;
  }
  const beforeReset = await _captureSettingsResetSnapshot();
  try {
    sessionStorage.setItem(SETTINGS_RESET_HISTORY_SESSION_KEY, JSON.stringify({ before: beforeReset, at: Date.now() }));
  } catch {}
  localStorage.clear();
  // サーバー側の設定もクリア。フォルダの登録（共有フォルダの一覧）はここでは初期化しない —
  // 空リストを送ると他の端末・クラウド版のフォルダ一覧にも削除が伝わってしまうため。
  try { await apiPut('/ui-config', {}); } catch {}
  try { await apiPut('/vault', { path: '' }); } catch {}
  location.reload();
}

async function submitSettings() {
  showLoading('設定を保存中...');
  try {
  const settingsOverlay = document.querySelector('.modal-overlay[data-settings-modal="1"]');
  const settingsHistoryBefore = typeof _captureSettingsDialogStorageSnapshot === 'function'
    ? _captureSettingsDialogStorageSnapshot()
    : null;
  // select の change が未発火でも、保存前に共通フォントをテーマ変数へ確定する。
  const fontFamilyInput = document.getElementById('modal-font-family');
  if (fontFamilyInput && typeof settingsThemeApplyCommonFont === 'function') settingsThemeApplyCommonFont(fontFamilyInput.value || '');

  // テーマ編集があれば、設定ダイアログの保存ボタンでも選択中テーマへ反映する。
  if (typeof settingsThemeSaveFromSettingsDialog === 'function') {
    const themeSaveOk = await settingsThemeSaveFromSettingsDialog({ skipRefresh: true });
    if (themeSaveOk === false) return;
  }

  // テーマをlocalStorageに保存。失敗時は他の設定を書き込む前に中断する。
  if (typeof saveColorSettings === 'function' && saveColorSettings() === false) return;

  if (typeof savePublishSettingsFromPanel === 'function') {
    const publishSaveOk = await savePublishSettingsFromPanel(settingsOverlay);
    if (publishSaveOk === false) return;
  }

  if (typeof saveDiscordBotSettingsFromSettingsDialog === 'function') {
    const discordSaveOk = await saveDiscordBotSettingsFromSettingsDialog({ silent: true, skipRender: true });
    if (discordSaveOk === false) return;
  }

  if (typeof saveChatCostSettingsFromSettingsDialog === 'function') {
    const chatCostSaveOk = await saveChatCostSettingsFromSettingsDialog(settingsOverlay, { silent: true });
    if (chatCostSaveOk === false) return;
  }
