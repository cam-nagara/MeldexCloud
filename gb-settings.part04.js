/* gb-settings.part04.js */
  // 表示サイズ（zoom）
  try {
    const uiScale = document.getElementById('modal-ui-scale')?.value;
    if (uiScale) {
      const nextScale = parseInt(uiScale) || 100;
      const currentScale = parseInt(localStorage.getItem('ui-scale') || '100', 10) || 100;
      // ユーザーが表示サイズを選び直したときだけ「手動」として記録する。設定を開いて
      // 別の項目だけ保存したときに、自動で決まった値を手動値へ格上げしないため。
      applyUIScale(nextScale, nextScale === currentScale ? undefined : { source: 'manual' });
    }
  } catch (e) { console.warn('UIスケール適用失敗:', e); }

  const filterSharedCb = document.getElementById('modal-outliner-filter-shared');
  if (filterSharedCb) {
    if (typeof setOutlinerFilterShared === 'function') setOutlinerFilterShared(filterSharedCb.checked);
    else localStorage.setItem('gb:outliner-filter-shared', filterSharedCb.checked ? '1' : '0');
  }

  const statusbarHiddenCb = document.getElementById('modal-statusbar-hidden');
  if (statusbarHiddenCb) {
    if (statusbarHiddenCb.checked) localStorage.setItem('meldex-statusbar-hidden', '1');
    else localStorage.removeItem('meldex-statusbar-hidden');
    if (typeof applyStatusbarHidden === 'function') applyStatusbarHidden(statusbarHiddenCb.checked);
  }

  const pasteLinkPromptCb = document.getElementById('modal-paste-link-prompt-enabled');
  if (pasteLinkPromptCb) {
    if (pasteLinkPromptCb.checked) localStorage.removeItem('meldex_suppress_folder_paste_link_choice');
    else localStorage.setItem('meldex_suppress_folder_paste_link_choice', 'true');
  }

  // フォルダツリーのサムネイル表示（フォルダツリー改修Phase4）。行高・DOM構造が
  // 変わるため反映には再読込が必要だが、submitSettings()は保存の度に無条件で
  // 末尾でloadOutliner()を呼ぶため、ここでは値の保存だけを行い二重リロードを避ける。
  const treeThumbnailsCb = document.getElementById('modal-tree-thumbnails-enabled');
  if (treeThumbnailsCb) {
    if (window.GBOutlinerThumbnails?.setEnabled) window.GBOutlinerThumbnails.setEnabled(treeThumbnailsCb.checked);
    else localStorage.setItem('gb:tree-thumbnails-enabled', treeThumbnailsCb.checked ? '1' : '0');
  }

  // サムネイルの表示方法（フォルダツリー・シートの画像サムネイル共通）
  const thumbnailFitSelect = document.getElementById('modal-thumbnail-fit');
  if (thumbnailFitSelect) {
    const mode = typeof resolveThumbnailFitMode === 'function' ? resolveThumbnailFitMode(thumbnailFitSelect.value) : (thumbnailFitSelect.value === 'cover' ? 'cover' : 'contain');
    localStorage.setItem('gb:thumbnail-fit', mode);
    if (typeof applyThumbnailFit === 'function') applyThumbnailFit(mode);
  }

  // フォルダツリーのサムネイルサイズ（小/中/大）
  const thumbnailSizeSelect = document.getElementById('modal-tree-thumbnail-size');
  if (thumbnailSizeSelect) {
    const sizeMode = typeof resolveThumbnailSizeMode === 'function' ? resolveThumbnailSizeMode(thumbnailSizeSelect.value) : 'medium';
    localStorage.setItem('gb:tree-thumbnail-size', sizeMode);
    if (typeof applyThumbnailSize === 'function') applyThumbnailSize(sizeMode);
  }

  // フォルダツリーの項目を開く操作（ダブルクリック/クリック）
  const treeOpenClickModeSelect = document.getElementById('modal-tree-open-click-mode');
  if (treeOpenClickModeSelect) {
    localStorage.setItem('gb:tree-open-click-mode', treeOpenClickModeSelect.value === 'single' ? 'single' : 'double');
  }

  // ビューワーのマウスホイール操作
  const viewerWheelModeSelect = document.getElementById('modal-viewer-wheel-mode');
  if (viewerWheelModeSelect) {
    localStorage.setItem('gb:viewer-wheel-mode', viewerWheelModeSelect.value === 'nav' ? 'nav' : 'zoom');
  }
  [
    ['modal-a11y-high-contrast', 'highContrast'],
    ['modal-a11y-reduced-motion', 'reducedMotion'],
    ['modal-a11y-colorblind-safe', 'colorblindSafe'],
  ].forEach(([id, pref]) => {
    const cb = document.getElementById(id);
    if (!cb) return;
    if (window.MeldexAccessibility?.setPreference) {
      window.MeldexAccessibility.setPreference(pref, cb.checked);
    }
  });

  // 自動起動設定
  const autostartCb = document.getElementById('modal-autostart');
  const autostartSection = document.getElementById('settings-autostart-section');
  const autostartSupportedHere = !window.MeldexRuntimeAdapter?.isBrowserDataMode?.();
  if (autostartCb && !autostartSection?.hidden && autostartSupportedHere
    && _settingsDomainIsDirty(settingsOverlay, 'modal-autostart')) {
    const autostartBefore = await apiFetch('/autostart', { silentError: true }).catch(() => null);
    if (!autostartBefore || typeof autostartBefore.enabled !== 'boolean') {
      throw _settingsSaveFailure('autostart', '自動起動の現在値を確認できませんでした');
    }
    settingsExternalRollbacks.push(async () => {
      await apiPost('/autostart', { enabled: autostartBefore.enabled }, { silentError: true });
      autostartCb.checked = autostartBefore.enabled;
    });
    let autostartResult = null;
    try {
      autostartResult = await apiPost('/autostart', { enabled: autostartCb.checked }, { silentError: true });
    } catch (err) {
      autostartResult = null;
    }
    // 実際に登録できたかどうかをトグルの見た目へ反映する。オンにしたつもりが
    // 実際には登録されていない、という食い違いを残さないため。
    autostartCb.checked = !!(autostartResult && autostartResult.enabled);
    if (!autostartResult || autostartResult.ok === false) {
      showStatus('自動起動を設定できませんでした。もう一度お試しください。', true);
      const status = document.getElementById('modal-autostart-status');
      if (status) status.textContent = '設定を保存できませんでした。権限とOSの設定を確認してください。';
      throw _settingsSaveFailure('autostart', '自動起動を設定できませんでした');
    }
    const status = document.getElementById('modal-autostart-status');
    if (status) status.textContent = autostartResult.enabled
      ? '有効です。次回のOS起動時に常駐を開始します。'
      : '無効です。必要な場合はオンにして保存してください。';
  }

  // バージョン管理設定
  const previousVersionConfig = getVersionConfig();
  const nextVersionConfig = typeof collectRestorePointPolicyFromSettings === 'function'
    ? collectRestorePointPolicyFromSettings()
    : previousVersionConfig;
  const restorePointScope = window.MeldexRestorePointPolicySync?.currentScope?.()
    || { kind: 'personal', readOnly: false };
  if (!restorePointScope.readOnly) {
    if (previousVersionConfig?.retention?.mode !== 'days' && nextVersionConfig?.retention?.mode === 'days') {
      const days = Number(nextVersionConfig.retention.days || 0);
      const preview = typeof previewRestorePointRetention === 'function'
        ? await previewRestorePointRetention(nextVersionConfig).catch(() => null)
        : null;
      const previewText = preview
        ? `\n現在開いている対象では ${preview.count}件（約${typeof formatFileSize === 'function' ? formatFileSize(preview.bytes) : preview.bytes + ' bytes'}）が削除予定です。${preview.oldest ? `\n最古: ${new Date(preview.oldest).toLocaleString('ja-JP')}` : ''}`
        : '';
      const confirmed = typeof cfConfirm === 'function'
        ? await cfConfirm(`保持期間を${days}日に変更すると、既存の復元ポイントも期限削除の対象になります。${previewText}\n未表示の文書は次回開いたときに確認して整理します。\n設定を保存しますか？`)
        : window.confirm(`保持期間を${days}日に変更すると、既存の復元ポイントも期限削除の対象になります。${previewText}\n未表示の文書は次回開いたときに確認して整理します。設定を保存しますか？`);
      if (!confirmed) throw _settingsSaveFailure('restore-point-retention', '復元ポイントの保持期間変更をキャンセルしました');
    }
    saveVersionConfig(nextVersionConfig);
    // タイマーを再設定
    if (_autoVersionPath) startAutoVersion(_autoVersionPath, _autoVersionType);
    if (typeof _runPeriodicRestorePoints === 'function') _runPeriodicRestorePoints(new Date()).catch(() => null);
  }

  // ユーザー名保存 + チームプロフィール同期
  const username = document.getElementById('modal-username')?.value?.trim();
  if (username) {
    const oldUsername = getUsername();
    if (oldUsername === username) {
      // 変更のないプロフィールを外部同期し直さない。
    } else {
      localStorage.setItem('meldex-user', JSON.stringify({ name: username }));
    const avatar = localStorage.getItem('meldex-avatar') || '';
    settingsExternalRollbacks.push(async () => {
      if (window.MeldexDropboxProfileSync?.afterLocalProfileChanged) {
        await window.MeldexDropboxProfileSync.afterLocalProfileChanged({ displayName: oldUsername, avatar });
      } else {
        await apiPost('/team/sync', { name: oldUsername, avatar });
      }
    });
    if (window.MeldexDropboxProfileSync?.afterLocalProfileChanged) {
      await window.MeldexDropboxProfileSync.afterLocalProfileChanged({ displayName: username, avatar });
    } else {
      await apiPost('/team/sync', { name: username, avatar });
    }
    pendingOldUsernameCleanup = oldUsername && oldUsername !== username ? oldUsername : '';
    }
  }

  // LLM APIキー保存
  const chatKeys = {};
  const gk = document.getElementById('modal-gemini-key')?.value;
  const ak = document.getElementById('modal-anthropic-key')?.value;
  const ok = document.getElementById('modal-openai-key')?.value;
  if (gk && !gk.startsWith('●')) chatKeys.GEMINI_API_KEY = gk;
  if (ak && !ak.startsWith('●')) chatKeys.ANTHROPIC_API_KEY = ak;
  if (ok && !ok.startsWith('●')) chatKeys.OPENAI_API_KEY = ok;
  if (Object.keys(chatKeys).length > 0) {
    if (!window.MeldexLlmKeys?.setMany || !window.MeldexLlmKeys?.restoreMany) {
      throw new Error('APIキー保存ストアを初期化できませんでした');
    }
    const changedKeyNames = Object.keys(chatKeys);
    const previousKeys = await window.MeldexLlmKeys.getAll({ strict: true });
    settingsExternalRollbacks.push(() => window.MeldexLlmKeys.restoreMany(previousKeys, changedKeyNames));
    await window.MeldexLlmKeys.setMany(chatKeys);
    llmKeysChanged = true;
  }

  const localLlmBaseUrl = document.getElementById('modal-local-llm-base-url')?.value?.trim() || '';
  if (localLlmBaseUrl) localStorage.setItem('chat-local-llm-base-url', localLlmBaseUrl);
  else localStorage.removeItem('chat-local-llm-base-url');
  const localLlmModel = document.getElementById('modal-local-llm-model')?.value?.trim() || '';
  if (localLlmModel) {
    localStorage.setItem('chat-local-llm-model', localLlmModel);
    localStorage.setItem('chat-model:local_llm', localLlmModel);
  } else {
    localStorage.removeItem('chat-local-llm-model');
  }
  const localLlmMcpEnabled = document.getElementById('modal-local-llm-mcp-enabled');
  if (localLlmMcpEnabled) localStorage.setItem('chat-local-llm-mcp-enabled', localLlmMcpEnabled.checked ? '1' : '0');
  if (typeof loadProviderModels === 'function') {
    loadProviderModels('local_llm', { force: true }).catch(() => {});
  }
  if (typeof _chatRefreshApiKeyState === 'function') _chatRefreshApiKeyState().catch(() => {});

  const allowWebSearchCb = document.getElementById('modal-chat-allow-web-search');
  if (allowWebSearchCb) localStorage.setItem('chat-allow-web-search', allowWebSearchCb.checked ? '1' : '0');
  const autoCompressCb = document.getElementById('modal-chat-auto-compress');
  if (autoCompressCb) localStorage.setItem('chat-auto-compress', autoCompressCb.checked ? '1' : '0');
  const allowCodeExecutionCb = document.getElementById('modal-chat-allow-code-execution');
  if (allowCodeExecutionCb) localStorage.setItem('chat-allow-code-execution', allowCodeExecutionCb.checked ? '1' : '0');
  const reasoningLevelEl = document.getElementById('modal-chat-reasoning-level');
  if (reasoningLevelEl) localStorage.setItem('chat-reasoning-level', reasoningLevelEl.value || 'off');
  const paramPresetEl = document.getElementById('modal-chat-param-preset');
  if (paramPresetEl) localStorage.setItem('chat-param-preset', paramPresetEl.value || 'standard');
  ['temperature', 'max-tokens', 'top-p'].forEach(key => {
    const input = document.getElementById('modal-chat-' + key);
    if (!input) return;
    const value = input.value?.trim() || '';
    if (value) localStorage.setItem('chat-' + key, value);
    else localStorage.removeItem('chat-' + key);
  });
  [
    ['modal-chat-custom-about', 'chat-custom-about'],
    ['modal-chat-custom-instructions', 'chat-custom-instructions'],
  ].forEach(([id, key]) => {
    const input = document.getElementById(id);
    if (!input) return;
    const value = input.value?.trim() || '';
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  });
  const sourceFolderForInstruction = typeof _chatSourceFolderValue === 'function' ? _chatSourceFolderValue() : '';
  if (sourceFolderForInstruction) {
    const suffix = ':' + encodeURIComponent(sourceFolderForInstruction);
    [
      ['modal-chat-source-custom-about', 'chat-custom-about' + suffix],
      ['modal-chat-source-custom-instructions', 'chat-custom-instructions' + suffix],
    ].forEach(([id, key]) => {
      const input = document.getElementById(id);
      if (!input) return;
      const value = input.value?.trim() || '';
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    });
  }
  if (typeof saveKnowledgeAutomationSettingsFromModal === 'function') {
    saveKnowledgeAutomationSettingsFromModal(document);
  }

  // ヒストリー設定
  const histMax = parseInt(document.getElementById('modal-history-max')?.value || '50');
  setHistoryMax(Math.max(1, Math.min(200, histMax)));

  // フォルダツリールートを保存
  if (sourceFoldersDirty) {
    if (!await saveOutlinerRoots()) {
      throw new Error('フォルダツリールートの保存に失敗しました');
    }

    await _syncSettingsVaultPathFromOutlinerRoots(_outlinerRoots);

    if (sourceFolderHistoryBefore && typeof pushOutlinerRootsSettingsHistory === 'function'
      && typeof captureOutlinerRootsSettingsSnapshot === 'function') {
      const sourceFolderHistoryAfter = await captureOutlinerRootsSettingsSnapshot().catch(() => null);
      window.__settingsPendingSourceFolderHistory = { before: sourceFolderHistoryBefore, after: sourceFolderHistoryAfter };
    }
    // ソースフォルダの並べ替えを保存した場合、ツリー側に残るルート直下の手動並び順
    // （localStorage['outliner-manual-order']._root）を破棄する。手動並び順はツリー側で
    // 常に優先されるため、破棄しないと設定側で並べ替えた新しい順序がツリーへ反映されない。
    if (window._settingsOutlinerRootsReordered && typeof clearManualOrder === 'function') {
      clearManualOrder('_root');
    }
    window._settingsOutlinerRootsDirty = false;
    window._settingsOutlinerRootsReordered = false;
  }

    // UI設定をサーバーにも永続保存
    await _saveUiConfigToServer();

    const pendingSourceHistory = window.__settingsPendingSourceFolderHistory;

    // 外部保存は、失敗し得るローカル・workspace保存と履歴確定が全て終わった後に
    // 1ドメインだけ実行する。各APIは単一commitであり、
    // ここから先の処理は保存結果を失敗へ戻さない。
    if (pendingTransactionalExternalSave) {
      const externalSaveOk = await pendingTransactionalExternalSave.save();
      if (externalSaveOk === false) throw _settingsSaveFailure(pendingTransactionalExternalSave.domain);
    }

    // 履歴は全domainのcommit成功後だけ追加する。履歴UIの失敗は確定済み設定を
    // 失敗扱いへ戻さず、保存本体とは分離して次回の履歴記録へ委ねる。
    try {
      if (settingsHistoryBefore && typeof _pushSettingsDialogStorageHistory === 'function') {
        _pushSettingsDialogStorageHistory('設定: 共通設定保存', settingsHistoryBefore);
      }
      if (pendingSourceHistory && typeof pushOutlinerRootsSettingsHistory === 'function') {
        pushOutlinerRootsSettingsHistory('設定: ソースフォルダ保存', pendingSourceHistory.before, pendingSourceHistory.after);
      }
    } catch (historyError) {
      console.warn('設定履歴の記録に失敗:', historyError);
    }
    delete window.__settingsPendingSourceFolderHistory;

    // 以後は失敗を保存失敗へ戻さない後処理だけにする。旧プロフィール名の掃除は
    // 新プロフィール・秘密値・OS設定を含む全保存が確定してから行う。
    if (pendingOldUsernameCleanup) {
      try { await _removeOldTeamNameFromAllRoots(pendingOldUsernameCleanup); }
      catch (cleanupError) { console.warn('旧プロフィール名の後処理に失敗:', cleanupError); }
    }
    if (llmKeysChanged && typeof loadProviderModels === 'function') {
      ['gemini', 'anthropic', 'openai'].forEach(provider => {
        loadProviderModels(provider, { force: true }).catch(() => {});
      });
    }
    if (llmKeysChanged && typeof _chatRefreshApiKeyState === 'function') {
      _chatRefreshApiKeyState().catch(() => {});
    }

    // ダイアログを閉じて、保存完了を先にユーザーへ返す。
    // フォルダツリー再読込などの重い後処理は閉じる動作をブロックしない。
    showStatus('設定を保存しました', false, { showSaveDialog: true });
    // ユーザー表示を更新（ユーザー名変更 / アバター設定を反映）
    try { if (typeof updateUserIcon === 'function') updateUserIcon(); } catch {}
    try { if (typeof updateLeftChromeUser === 'function') updateLeftChromeUser(); } catch {}
    // フォルダツリーを再読み込み
    try {
      const outlinerReload = typeof loadOutliner === 'function' ? loadOutliner() : null;
      outlinerReload?.catch?.(() => {});
    } catch {}
    return { ok: true, changedDomains: sourceFoldersDirty ? ['settings', 'source-folders'] : ['settings'] };
  } catch (err) {
    console.error('設定保存エラー:', err);
    delete window.__settingsPendingSourceFolderHistory;
    const rollbackFailures = err?.settingsRollbackFailed
      ? [err?.message || '外部設定の補償に失敗しました']
      : [];
    for (const rollback of settingsExternalRollbacks.reverse()) {
      try { await rollback(); } catch (rollbackError) {
        rollbackFailures.push(rollbackError?.message || String(rollbackError));
        console.error('外部設定のロールバック失敗:', rollbackError);
      }
    }
    if (settingsHistoryBefore) {
      if (typeof restoreLocalStorageSettings !== 'function') {
        rollbackFailures.push('ローカル設定の復元機能を利用できません');
      } else try { restoreLocalStorageSettings(settingsHistoryBefore, () => {}); } catch (rollbackError) {
        rollbackFailures.push(rollbackError?.message || String(rollbackError));
        console.error('設定のロールバック失敗:', rollbackError);
      }
    }
    if (sourceFolderHistoryBefore) {
      if (typeof _restoreOutlinerRootsSettingsSnapshot !== 'function') {
        rollbackFailures.push('ソースフォルダ設定の復元機能を利用できません');
      } else try { await _restoreOutlinerRootsSettingsSnapshot(sourceFolderHistoryBefore); } catch (rollbackError) {
        rollbackFailures.push(rollbackError?.message || String(rollbackError));
        console.error('ソースフォルダのロールバック失敗:', rollbackError);
      }
    }
    const rollbackWarning = rollbackFailures.length
      ? ' 一部の設定を自動復元できませんでした。設定画面を再読込して状態を確認してください。'
      : '';
    showStatus('設定の保存に失敗: ' + (err?.message || err) + rollbackWarning, true);
    return {
      ok: false,
      error: err?.message || String(err),
      failedDomain: err?.settingsDomain || 'unknown',
      rollbackFailed: rollbackFailures.length > 0,
    };
  } finally {
    hideLoading();
  }
}

// 名前変更時、既定フォルダだけでなく可視の全ソースフォルダのチームファイルからも
// 旧名エントリを削除する（複数ソースフォルダ運用で、フォルダごとに残る
// 旧名ゴーストエントリを防ぐ）。1件の失敗でループ全体を止めない。
async function _removeOldTeamNameFromAllRoots(oldUsername) {
  await apiPost('/team/remove', { name: oldUsername }).catch((e) => {
    console.warn('[settings] /team/remove failed (default folder)', e);
  });
  let roots = [];
  try {
    roots = await apiFetch('/outliner-roots');
  } catch (e) {
    console.warn('[settings] /outliner-roots fetch failed while cleaning up old team name', e);
    return;
  }
  const visibleRoots = (Array.isArray(roots) ? roots : []).filter(r => r?.visible && r?.path);
  for (const root of visibleRoots) {
    try {
      await apiPost('/team/remove', { name: oldUsername, folder: root.path });
    } catch (e) {
      console.warn('[settings] /team/remove failed for root', root.path, e);
    }
  }
}

function _isSettingsLocalVaultPath(path) {
  const value = String(path || '').trim();
  if (!value || value === '.') return false;
  if (/^__[^/\\]+__/.test(value)) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  if (/^\\\\[^\\]/.test(value)) return true;
  if (value.startsWith('/')) return true;
  return false;
}

async function _syncSettingsVaultPathFromOutlinerRoots(roots) {
  const localVisible = Array.isArray(roots)
    ? roots.find(root => root && root.visible && _isSettingsLocalVaultPath(root.path))
    : null;
  const nextPath = localVisible ? String(localVisible.path || '').trim() : '';
  const currentVaultPath = (typeof state !== 'undefined' ? state.vaultPath : '') || '';
  if (nextPath === currentVaultPath) return true;
  await apiPut('/vault', { path: nextPath });
  if (typeof state !== 'undefined') state.vaultPath = nextPath;
  return true;
}

/* Notion同期 → gb-notion-sync.js に分離 */
/* ==============================
   ゴミ箱
   ============================== */
function openTrashFromFolderTree() {
  if (typeof showTrashModal === 'function') showTrashModal();
}

async function showTrashModal(options = {}) {
  const returnFocus = options.returnFocus || document.activeElement;
  showTrashModal._returnFocus = returnFocus;
  let items = [];
  let loadError = null;
  let partial = false;
  let partialFailed = 0;
  try {
    const data = await apiFetch('/trash');
    items = Array.isArray(data?.items) ? data.items : [];
    const warnings = Array.isArray(data?.warnings) ? data.warnings : [];
    const reportedFailed = Number(data?.failed);
    const safeReportedFailed = Number.isFinite(reportedFailed) ? Math.max(0, Math.floor(reportedFailed)) : 0;
    partial = data?.partial === true || warnings.length > 0 || safeReportedFailed > 0;
    partialFailed = partial ? Math.min(9999, Math.max(1, warnings.length, safeReportedFailed)) : 0;
  } catch (e) {
    loadError = e;
    if (typeof showStatus === 'function') showStatus('ゴミ箱の読み込みに失敗しました', true);
  }

  function renderList() {
    if (loadError) {
      return `<div style="padding:16px;color:var(--red);text-align:center;">ゴミ箱の読み込みに失敗しました: ${esc(loadError.message || loadError)}</div>`;
    }
    const partialMessage = items.length
      ? `一部の保存元を読み込めませんでした（失敗 ${partialFailed}件）。表示中の項目は操作できます。通信状態とDropboxのアクセス権を確認し、少し待ってからゴミ箱を開き直してください。`
      : `保存元を読み込めなかったため、ゴミ箱が空かどうか確認できませんでした（失敗 ${partialFailed}件）。通信状態とDropboxのアクセス権を確認し、少し待ってからゴミ箱を開き直してください。`;
    const partialHtml = partial
      ? `<div role="alert" style="padding:10px 12px;color:var(--orange);background:color-mix(in srgb,var(--orange) 10%,var(--bg2));border-bottom:1px solid var(--border);line-height:1.5;">${esc(partialMessage)}</div>`
      : '';
    if (items.length === 0) {
      return partialHtml || '<div style="padding:16px;color:var(--fg2);text-align:center;">ゴミ箱は空です</div>';
    }
    let html = partialHtml;
    items.forEach((it, i) => {
      const icon = it.type === 'folder' ? lucide('folder', 18) : lucide('page', 18);
      const info = it.type === 'folder' ? `（${it.size}件）` : '';
      const delDate = it.deleted_at ? new Date(it.deleted_at).toLocaleString('ja-JP') : '';
      const origPath = it.original_path || '';
      const rootName = it.trash_root_name || '';
      html += `<div class="trash-dialog-row" data-e2e-id="trash-dialog-row-${i}">
          <span class="trash-dialog-icon">${icon}</span>
          <div class="trash-dialog-copy">
            <div class="trash-dialog-name">${esc(it.name)}${info}</div>
            <div class="trash-dialog-detail">${rootName ? esc(rootName) + ' / ' : ''}${origPath ? '元: '+esc(origPath) : ''}${delDate ? ' | '+delDate : ''}</div>
          </div>
          <button type="button" class="gb-btn gb-btn-sm" data-trash-restore="${i}" data-e2e-id="trash-dialog-restore-${i}">復元</button>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-danger" data-trash-delete="${i}" data-e2e-id="trash-dialog-delete-${i}">完全に削除</button>
        </div>`;
    });
    return html;
  }
  showTrashModal._activeDialog?.close?.('superseded');
  const body = document.createElement('div');
  body.className = 'trash-dialog-body';
  body.innerHTML = `<div id="trash-list" class="trash-dialog-list" data-e2e-id="trash-dialog-list">${renderList()}</div>
    <div class="gb-section-desc trash-dialog-status" data-e2e-id="trash-dialog-status" aria-live="polite"></div>`;
  const emptyButton = document.createElement('button');
  emptyButton.type = 'button';
  emptyButton.className = 'gb-btn gb-btn-danger';
  emptyButton.dataset.e2eId = 'trash-dialog-empty';
  emptyButton.textContent = 'ゴミ箱を空にする';
  emptyButton.disabled = items.length === 0 || !!loadError;
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'gb-btn';
  closeButton.dataset.e2eId = 'trash-dialog-close';
  closeButton.textContent = '閉じる';
  let busy = false;
  let dialogApi = null;
  const setBusy = value => {
    busy = !!value;
    showTrashModal._busy = busy;
    dialogApi?.overlay?.setAttribute('aria-busy', busy ? 'true' : 'false');
    body.querySelectorAll('button').forEach(button => { button.disabled = busy; });
    emptyButton.disabled = busy || items.length === 0 || !!loadError;
    closeButton.disabled = busy;
  };
  dialogApi = window.GBUI.createModal({
    id: 'trash-dialog',
    title: 'ゴミ箱',
    body,
    footer: [emptyButton, closeButton],
    variant: 'standard',
    extraClass: 'trash-dialog-modal',
    geometryKey: 'trash',
    initialFocus: items.length ? '[data-e2e-id="trash-dialog-restore-0"]' : '[data-e2e-id="trash-dialog-close"]',
    returnFocus,
    onBeforeClose: reason => !busy || reason === 'refresh' || reason === 'complete' || reason === 'superseded',
    onClose: () => {
      if (showTrashModal._activeDialog === dialogApi) showTrashModal._activeDialog = null;
    },
  });
  showTrashModal._activeDialog = dialogApi;
  const o = dialogApi.overlay;
  o.classList.add('modal-overlay');
  o.dataset.trashModal = '1';
  dialogApi.header.querySelector('.gb-modal-close')?.setAttribute('data-e2e-id', 'trash-dialog-close-icon');
  body.querySelectorAll('[data-trash-restore]').forEach(button => button.addEventListener('click', () => trashRestore(Number(button.dataset.trashRestore))));
  body.querySelectorAll('[data-trash-delete]').forEach(button => button.addEventListener('click', () => trashDelete(Number(button.dataset.trashDelete))));
  emptyButton.addEventListener('click', () => trashEmpty());
  closeButton.addEventListener('click', () => dialogApi.close('close-button'));
  window._trashItems = items;
  window._trashModal = o;
  window._setTrashDialogBusy = setBusy;
  window._setTrashDialogStatus = message => {
    const status = body.querySelector('[data-e2e-id="trash-dialog-status"]');
    if (status) status.textContent = message || '';
  };
  dialogApi.open();
}

function _refreshTrashDialog() {
  const returnFocus = showTrashModal._returnFocus;
  showTrashModal._activeDialog?.close?.('refresh');
  return showTrashModal({ returnFocus });
}

async function trashRestore(idx) {
  const item = window._trashItems?.[idx];
  const name = item?.name;
  if (!name) return;
  window._setTrashDialogBusy?.(true);
  try {
    const res = await apiPost('/trash/restore', { name, ...(item.trash_root ? { trash_root: item.trash_root } : {}) });
    showStatus(`「${name}」を復元しました → ${res.restored_to}`);
    window._trashItems.splice(idx, 1);
    await loadOutliner();
    window._setTrashDialogBusy?.(false);
    await _refreshTrashDialog();
  } catch (e) {
    const message = '復元に失敗しました: ' + (e.message || e);
    window._setTrashDialogBusy?.(false);
    window._setTrashDialogStatus?.(message);
    showStatus(message, true);
  }
}

async function trashDelete(idx) {
  const item = window._trashItems?.[idx];
  const name = item?.name;
  if (!name) return;
  const confirmMessage = `「${name}」を完全に削除しますか？この操作は取り消せません。`;
  const impactPath = item?.original_path || '';
  if (!impactPath || typeof MeldexDeleteImpactWarning === 'undefined') {
    showStatus('削除元情報を確認できないため完全削除できません', true);
    return;
  }
  const confirmed = await MeldexDeleteImpactWarning.confirmDeleteWithImpact(
    [{
      path: impactPath,
      kind: item?.type === 'folder' ? 'folder' : 'file',
      physicalPath: item?.trash_path || '',
      ...((item?.assetId || item?.asset_id) ? { assetId: String(item.assetId || item.asset_id) } : {}),
    }],
    confirmMessage,
    { operation: 'permanent' },
  );
  if (!confirmed) return;
  window._setTrashDialogBusy?.(true);
  try {
    await apiPost('/trash/delete', {
      name,
      ...(item.trash_root ? { trash_root: item.trash_root } : {}),
      ...((item.assetId || item.asset_id) ? { assetId: String(item.assetId || item.asset_id) } : {}),
      ...(window.MeldexDeleteImpactWarning?.confirmationPayload?.(confirmed) || {}),
    });
    showStatus(`「${name}」を完全に削除しました`);
    window._trashItems.splice(idx, 1);
    window._setTrashDialogBusy?.(false);
    await _refreshTrashDialog();
  } catch (e) {
    const message = '完全削除に失敗しました: ' + (e.message || e);
    window._setTrashDialogBusy?.(false);
    window._setTrashDialogStatus?.(message);
    showStatus(message, true);
  }
}

async function trashEmpty() {
  const confirmMessage = 'ゴミ箱を空にしますか？この操作は取り消せません。';
  const impactTargets = (window._trashItems || [])
    .filter(item => item?.original_path)
    .map(item => ({
      path: item.original_path,
      kind: item.type === 'folder' ? 'folder' : 'file',
      physicalPath: item.trash_path || '',
      ...((item.assetId || item.asset_id) ? { assetId: String(item.assetId || item.asset_id) } : {}),
    }));
  if (!impactTargets.length) {
    showStatus('ゴミ箱は空です');
    return;
  }
  if (impactTargets.length !== (window._trashItems || []).length
      || typeof MeldexDeleteImpactWarning === 'undefined') {
    showStatus('削除元情報を確認できない項目があるためゴミ箱を空にできません', true);
    return;
  }
  const confirmed = await MeldexDeleteImpactWarning.confirmDeleteWithImpact(
    impactTargets, confirmMessage, { operation: 'permanent' },
  );
  if (!confirmed) return;
  window._setTrashDialogBusy?.(true);
  try {
    await apiPost('/trash/empty', window.MeldexDeleteImpactWarning?.confirmationPayload?.(confirmed) || {});
    showStatus('ゴミ箱を空にしました');
    window._setTrashDialogBusy?.(false);
    await _refreshTrashDialog();
  } catch (e) {
    const message = 'ゴミ箱を空にできませんでした: ' + (e.message || e);
    window._setTrashDialogBusy?.(false);
    window._setTrashDialogStatus?.(message);
    showStatus(message, true);
  }
}

function _formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024 * 1024) return (value / 1024 / 1024 / 1024).toFixed(1) + ' GB';
  if (value >= 1024 * 1024) return (value / 1024 / 1024).toFixed(1) + ' MB';
  if (value >= 1024) return (value / 1024).toFixed(1) + ' KB';
  return value + ' B';
}

async function _loadDataProtectionStatus() {
  return apiFetch('/data-protection/status');
}

async function renderTrashSettings(root) {
  const container = (root?.querySelector ? root : document).querySelector('#trash-settings-container');
  if (!container) return;
  container.innerHTML = `<section class="gb-section gb-section--boxed"><div class="gb-section-title">${lucide('trash2',14)} ゴミ箱</div><div class="gb-section-desc">読み込み中...</div></section>`;
  try {
    const status = await _loadDataProtectionStatus();
    const settings = status.settings || {};
    const retention = Number(settings.trash_retention_days ?? 30);
    const trashRoots = Array.isArray(status.trash?.roots) ? status.trash.roots : [];
    const trashPathHtml = trashRoots.length
      ? trashRoots.map(root => `<div class="gb-section-desc" style="word-break:break-all;">${esc(root.path || '')}: ${root.items || 0}件 / ${_formatBytes(root.bytes || 0)}</div>`).join('')
      : '<div class="gb-section-desc">ゴミ箱フォルダはまだ作成されていません。</div>';
    container.innerHTML = `
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('trash2',14)} ゴミ箱の保持</div>
        <label class="gb-field-row">
          <span class="gb-label">保持日数</span>
          <select id="settings-trash-retention" class="gb-select">
            ${[[7,'7日'],[30,'30日'],[90,'90日'],[0,'無期限']].map(([value, label]) => `<option value="${value}" ${retention === value ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
        <div class="gb-section-desc">現在: ${status.trash?.items || 0}件 / ${_formatBytes(status.trash?.bytes || 0)}</div>
        ${trashPathHtml}
        <div class="gb-section-desc">Dropbox側で削除するとMeldexから復元できません。 ${fieldHelp('Dropbox内のソースフォルダを使う場合、ゴミ箱の中身も同期対象です。')}</div>
        <div class="gb-field-row" style="justify-content:flex-start;">
          <button type="button" class="gb-btn gb-btn-sm" id="settings-trash-save">保持日数を保存</button>
          <button type="button" class="gb-btn gb-btn-sm" id="settings-trash-cleanup">期限切れを削除</button>
          <button type="button" class="gb-btn gb-btn-sm" id="settings-trash-open">復元一覧を開く</button>
        </div>
        <div id="settings-trash-status" class="gb-section-desc"></div>
      </section>`;
    const statusEl = container.querySelector('#settings-trash-status');
    container.querySelector('#settings-trash-save')?.addEventListener('click', async () => {
      const next = Number(container.querySelector('#settings-trash-retention')?.value || 30);
      await apiPut('/data-protection/settings', { trash_retention_days: next });
      statusEl.textContent = '保持日数を保存しました';
    });
    container.querySelector('#settings-trash-cleanup')?.addEventListener('click', async () => {
      const ok = typeof cfConfirm === 'function'
        ? await cfConfirm('期限切れのゴミ箱項目を削除しますか？この操作は元に戻せません。')
        : confirm('期限切れのゴミ箱項目を削除しますか？この操作は元に戻せません。');
      if (!ok) return;
      const next = Number(container.querySelector('#settings-trash-retention')?.value || 30);
      const res = await apiPost('/data-protection/trash-cleanup', { trash_retention_days: next });
      statusEl.textContent = `削除: ${res.deleted || 0}件 / 残り ${_formatBytes(res.bytes || 0)}`;
    });
    container.querySelector('#settings-trash-open')?.addEventListener('click', () => showTrashModal());
  } catch (error) {
    container.innerHTML = `<section class="gb-section gb-section--boxed"><div class="gb-section-title">${lucide('triangleAlert',14)} ゴミ箱</div><div class="gb-section-desc">読み込みに失敗しました: ${esc(error.message || error)}</div></section>`;
  }
}

async function renderDatabaseMaintenanceSettings(root) {
  const container = (root?.querySelector ? root : document).querySelector('#database-maintenance-container');
  if (!container) return;
  container.innerHTML = `<section class="gb-section gb-section--boxed"><div class="gb-section-title">${lucide('database',14)} データベースメンテナンス</div><div class="gb-section-desc">読み込み中...</div></section>`;
  try {
    const status = await _loadDataProtectionStatus();
    const settings = status.settings || {};
    const tables = status.tables || {};
    container.innerHTML = `
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('database',14)} 整合性とバックアップ</div>
        <div class="gb-section-desc">整合性: ${esc(status.integrity?.message || '')}</div>
        <div class="gb-section-desc">バックアップ先: ${esc(status.backupDir || '')}</div>
        <div class="gb-section-desc">最終バックアップ: ${esc(settings.last_db_backup_at || '未実行')}</div>
        <div class="gb-field-row" style="justify-content:flex-start;">
          <button type="button" class="gb-btn gb-btn-sm" id="settings-db-backup">今すぐバックアップ</button>
          <button type="button" class="gb-btn gb-btn-sm" id="settings-db-cleanup">TTLクリーンアップ</button>
          <button type="button" class="gb-btn gb-btn-sm" id="settings-db-export">バックアップを別フォルダへエクスポート</button>
        </div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('clock',14)} 保持期間</div>
        <label class="gb-field-row"><span class="gb-label">操作履歴</span><input id="settings-db-audit-ttl" type="number" min="0" class="gb-input" style="width:90px;" value="${Number(settings.db_audit_log_ttl_days ?? 90)}"><span class="gb-section-desc">日（0で無期限）</span></label>
        <div class="gb-field-row"><span class="gb-label">カレンダーログ</span><span class="gb-section-desc">削除しない</span></div>
        <div class="gb-field-row"><span class="gb-label">LLM利用ログ</span><span class="gb-section-desc">削除しない</span></div>
        <button type="button" class="gb-btn gb-btn-sm" id="settings-db-ttl-save">保持期間を保存</button>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${lucide('table',14)} 現在の件数</div>
        <div class="gb-section-desc">操作履歴: ${tables.db_audit_log || 0} / カレンダー: ${tables.cal_time_entries || 0} / LLM利用: ${tables.chat_usage_log || 0} / 検索ベクトル: ${tables.vault_vec_items || 0}</div>
        <div id="settings-db-maintenance-status" class="gb-section-desc"></div>
      </section>`;
    const statusEl = container.querySelector('#settings-db-maintenance-status');
    container.querySelector('#settings-db-ttl-save')?.addEventListener('click', async () => {
      await apiPut('/data-protection/settings', {
        db_audit_log_ttl_days: Number(container.querySelector('#settings-db-audit-ttl')?.value || 90),
        calendar_log_ttl_days: 0,
        chat_usage_log_ttl_days: 0,
      });
      statusEl.textContent = '保持期間を保存しました';
    });
    container.querySelector('#settings-db-backup')?.addEventListener('click', async () => {
      const res = await apiPost('/data-protection/db-backup', {});
      statusEl.textContent = res.ok ? 'バックアップを作成しました: ' + res.path : 'バックアップはスキップされました';
    });
    container.querySelector('#settings-db-cleanup')?.addEventListener('click', async () => {
      const ok = typeof cfConfirm === 'function'
        ? await cfConfirm('保持期間を過ぎたデータベースログを削除しますか？この操作は元に戻せません。')
        : confirm('保持期間を過ぎたデータベースログを削除しますか？この操作は元に戻せません。');
      if (!ok) return;
      const res = await apiPost('/data-protection/db-cleanup', {});
      statusEl.textContent = 'クリーンアップ完了: ' + JSON.stringify(res.deleted || {});
    });
    container.querySelector('#settings-db-export')?.addEventListener('click', async () => {
      const destination = await cfPrompt('バックアップのエクスポート先フォルダ', status.backupDir || '');
      if (!destination) return;
      const res = await apiPost('/data-protection/export-backup', { destination });
      statusEl.textContent = res.ok ? 'エクスポートしました: ' + res.path : 'エクスポートできませんでした';
    });
  } catch (error) {
    container.innerHTML = `<section class="gb-section gb-section--boxed"><div class="gb-section-title">${lucide('triangleAlert',14)} データベースメンテナンス</div><div class="gb-section-desc">読み込みに失敗しました: ${esc(error.message || error)}</div></section>`;
  }
}

/* ==============================
   バージョン履歴の共有（このPCの版履歴をDropboxの共有保存先へまとめて移す）
   ============================== */
async function runSharedVersionMigration() {
  const btn = document.getElementById('btn-migrate-shared-versions');
  const status = document.getElementById('migrate-shared-versions-status');
  const setStatus = text => { if (status) status.textContent = text; };
  if (btn) btn.disabled = true;
  setStatus('移行中...');
  try {
    const result = typeof runBackgroundJob === 'function'
      ? await runBackgroundJob('/version/migrate-shared', {}, {
          onProgress: job => {
            const done = Number(job?.processed || 0);
            const total = Number(job?.total || 0);
            setStatus(total ? `移行中... ${done}/${total}` : '移行中...');
          },
        })
      : await apiPost('/version/migrate-shared', {});
    const moved = Number(result?.migrated || 0);
    const targets = Number(result?.targets || 0);
    const failed = Number(result?.failed || 0);
    const summary = targets
      ? `${targets}件のファイル・フォルダから${moved}件の版を移しました`
      : '移す対象はありませんでした';
    setStatus(failed ? `${summary}（${failed}件は移せませんでした）` : summary);
    showStatus(summary, failed > 0);
  } catch (e) {
    setStatus('エラー: ' + (e.message || e));
    showStatus('バージョン履歴の移行に失敗しました', true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ==============================
   履歴データのエクスポート
   ============================== */
async function runExportToDb() {
  const btn = document.getElementById('btn-export-to-db');
  const status = document.getElementById('export-to-db-status');
  if (btn) btn.disabled = true;
  if (status) status.textContent = 'エクスポート中...';
  try {
    const res = await apiPost('/export-to-db', {});
    const r = res.results || {};
    // propertyTypes と colOrder を各シートに自動設定
    for (const key of Object.keys(r)) {
      const info = r[key];
      if (!info.dbPath) continue;
      const existing = getDbViewConfig(info.dbPath);
      const cfg = { ...existing };
      // propertyTypes は常に上書き（サーバー側の型定義が正）
      if (info.propertyTypes) cfg.propertyTypes = info.propertyTypes;
      // colOrder / colWidths はユーザーカスタマイズを尊重
      if (info.colOrder && !existing.colOrder) {
        cfg.colOrder = info.colOrder;
        const view = typeof _getCurrentDbViewConfigEntryFromConfig === 'function'
          ? _getCurrentDbViewConfigEntryFromConfig(cfg)
          : null;
        if (view && !Array.isArray(view.colOrder)) view.colOrder = [...info.colOrder];
      }
      saveDbViewConfig(info.dbPath, cfg);
    }
    // サマリー表示
    const lines = [];
    if (r.chat) lines.push('チャット ' + r.chat.count + '件');
    if (r.annotations) lines.push('アノテート ' + r.annotations.count + '件');
    if (r.cal_events) lines.push('イベント ' + r.cal_events.count + '件');
    if (r.tasks) lines.push('タスク ' + r.tasks.count + '件');
    const summary = lines.join('、');
    if (status) status.textContent = 'エクスポート完了: ' + summary;
    showStatus('エクスポート完了: ' + summary);
    // ホームフォルダツリーをリロード
    if (typeof renderHomeFolderTree === 'function') renderHomeFolderTree();
  } catch (e) {
    if (status) status.textContent = 'エラー: ' + (e.message || e);
    showStatus('エクスポートに失敗しました', true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// フォルダツリー・シートの画像サムネイルの表示方法を解決する一元ヘルパー。
// 既定は 'contain'（全体を枠内に収める）。明示的に 'cover' が保存されている場合だけ
// 'cover'（枠いっぱいに切り抜き）を維持する（2026-08-05 既定値変更。分散していた
// `localStorage.getItem('gb:thumbnail-fit') || 'cover'` フォールバックをここへ一元化）。
function resolveThumbnailFitMode(raw) {
  const value = raw !== undefined ? raw : (typeof localStorage !== 'undefined' ? localStorage.getItem('gb:thumbnail-fit') : null);
  return value === 'cover' ? 'cover' : 'contain';
}
if (typeof window !== 'undefined') window.resolveThumbnailFitMode = resolveThumbnailFitMode;

// フォルダツリー・シートの画像サムネイルの表示方法を適用（'cover' = 枠いっぱいに切り抜き / 'contain' = 全体を収める）
function applyThumbnailFit(mode) {
  const resolved = resolveThumbnailFitMode(mode);
  document.documentElement.classList.toggle('thumb-fit-contain', resolved === 'contain');
}
if (typeof window !== 'undefined') window.applyThumbnailFit = applyThumbnailFit;

// フォルダツリーのサムネイルサイズ設定（小/中/大。既定=中）を解決する一元ヘルパー。
// 単一情報源は window.GBOutlinerThumbnails.sizeMode()（gb-outliner-thumbnails.js）。
// 未読込環境（Node単体テスト等）向けに localStorage 直接読みへフォールバックする。
function resolveThumbnailSizeMode(raw) {
  if (raw === 'small' || raw === 'large' || raw === 'medium') return raw;
  if (window.GBOutlinerThumbnails && typeof window.GBOutlinerThumbnails.sizeMode === 'function') {
    return window.GBOutlinerThumbnails.sizeMode();
  }
  const value = typeof localStorage !== 'undefined' ? localStorage.getItem('gb:tree-thumbnail-size') : null;
  return (value === 'small' || value === 'large') ? value : 'medium';
}
if (typeof window !== 'undefined') window.resolveThumbnailSizeMode = resolveThumbnailSizeMode;

// フォルダツリーのサムネイルサイズを適用（html.thumb-size-small / html.thumb-size-large クラス切替。
// 中は追加クラスなし＝gb-tools.part02.part01.cssの:root既定値のまま）
function applyThumbnailSize(mode) {
  const resolved = resolveThumbnailSizeMode(mode);
  document.documentElement.classList.toggle('thumb-size-small', resolved === 'small');
  document.documentElement.classList.toggle('thumb-size-large', resolved === 'large');
}
if (typeof window !== 'undefined') window.applyThumbnailSize = applyThumbnailSize;

// UI設定のサーバー永続保存（localStorageの主要設定をサーバーにバックアップ）
const _UI_CONFIG_KEYS = [
  // UI設定
  'editor-theme', 'editor-theme-name', 'ui-scale', 'ui-scale-source', 'ui-scale-auto-rule', 'meldex-user', 'meldex-statusbar-hidden',
  'meldex-a11y-high-contrast', 'meldex-a11y-reduced-motion', 'meldex-a11y-colorblind-safe', 'meldex-a11y-browser-warning-dismissed',
  'meldex-avatar', 'meldex-avatar-spec', 'meldex-avatar-bg',
  'note-vertical', 'note-heading-indent', 'note-toc-visible',
  'gb:thumbnail-fit', 'gb:tree-thumbnail-size', 'gb:tree-open-click-mode', 'gb:viewer-wheel-mode',
  // カレンダー / チャット
  'gb-cal-start-day', 'gb:clock-enabled', 'gb:outliner-filter-shared', 'chat-provider', 'chat-model', 'chat-allow-web-search', 'chat-auto-compress', 'chat-allow-code-execution', 'chat-recommendations-enabled', 'chat-reasoning-level', 'chat-param-preset', 'chat-temperature', 'chat-max-tokens', 'chat-top-p', 'chat-custom-about', 'chat-custom-instructions', 'chat-local-llm-base-url', 'chat-local-llm-model', 'chat-local-llm-mcp-enabled', 'meldex-wheel-speed',
  'meldex-knowledge-automation-settings-v1',
  // カスタマイズ
  'meldex-custom-shortcuts', 'meldex-custom-colors', 'meldex-standard-palette-adjust', 'meldex-theme-color-set', 'meldex-theme-color-slot-settings', 'meldex-theme-ui-applications', 'meldex-theme-ui-auto-tone',
  // テーマの正本キー。ここから漏れていたため、設定の書き出し／読み込みでテーマだけが
  // 持ち運べず、環境を移ると見た目が既定へ戻っていた（2026-08-07 追加）。
  'meldex-default-theme-id', 'meldex-custom-themes', 'meldex-promoted-initial-theme-sources',
  'meldex-theme-color-extra-slot-settings', 'meldex-theme-use-os-accent', 'meldex-custom-theme-cleanup-version',
  'file-theme-presets', 'gb:hidden-shell-verbs',
];

// 構造化データのキー（ユーザーが時間をかけて構築するデータ）
const _UI_STRUCTURED_KEYS = [
  'gb:workspaces', 'gb:workspace-active', 'gb:layout',
  'gb:app-layouts', 'gb:app-layout-active', 'gb:layout-source',
  'gb:canvas-bg',
  'meldex-favorites', 'outliner-sort', 'outliner-manual-order',
  'outliner-locked-items', 'outliner-node-colors', 'outliner-work-folder', 'outliner-work-folder-id',
  'global-filter', 'gb:outliner-filter-shared-state', 'main-calendar-path', 'main-calendar-id',
  'outliner-expanded', '_file-id-migrated',
  'customDbTemplates',
  'version-config', 'history-max', 'folder-display-config',
];
// dbViewConfig:* 等の動的キーのプレフィックス
const _UI_DYNAMIC_PREFIXES = [
  'dbViewConfig:', 'validationRules:', 'entityTemplates:', 'chat-model:', 'chat-models:', 'chat-custom-about:', 'chat-custom-instructions:',
];
const _SETTINGS_PROFILE_KEYS = ['meldex-user', 'meldex-avatar', 'meldex-avatar-spec', 'meldex-avatar-bg'];
// 「全設定を初期化」が削除できるのは、表示と操作の設定だけ。
// profile/source/workspace/draft/session/作品データ/共有登録/秘密値は専用操作のみで変更する。
const _SETTINGS_RESETTABLE_KEYS = [
  'editor-theme', 'editor-theme-name', 'ui-scale', 'ui-scale-source', 'ui-scale-auto-rule',
  'meldex-statusbar-hidden', 'meldex-a11y-high-contrast', 'meldex-a11y-reduced-motion',
  'meldex-a11y-colorblind-safe', 'note-vertical', 'note-heading-indent', 'note-toc-visible',
  'gb:thumbnail-fit', 'gb:tree-thumbnail-size', 'gb:tree-open-click-mode', 'gb:viewer-wheel-mode',
  'gb-cal-start-day', 'gb:clock-enabled', 'gb:outliner-filter-shared', 'meldex-wheel-speed',
  'meldex-custom-colors', 'meldex-standard-palette-adjust', 'meldex-theme-color-set',
  'meldex-theme-color-slot-settings', 'meldex-theme-ui-applications', 'meldex-theme-ui-auto-tone',
  'meldex-default-theme-id', 'meldex-custom-themes', 'meldex-theme-color-extra-slot-settings',
  'meldex-theme-use-os-accent', 'file-theme-presets', 'gb:hidden-shell-verbs',
  'version-config', 'history-max', 'folder-display-config',
];

function _settingsResetStorageKeys() {
  return _SETTINGS_RESETTABLE_KEYS.slice();
}

function _settingsDialogStorageKeys() {
  const keys = [..._UI_CONFIG_KEYS, ..._UI_STRUCTURED_KEYS];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && _UI_DYNAMIC_PREFIXES.some(p => key.startsWith(p))) keys.push(key);
    }
  } catch {}
  return [...new Set(keys)];
}

function _captureSettingsDialogStorageSnapshot() {
  return typeof captureLocalStorageSettings === 'function'
    ? captureLocalStorageSettings(_settingsDialogStorageKeys())
    : null;
}

function _restoreSettingsDialogStorageAfterHistory(keys) {
  if (!Array.isArray(keys)) return;
  if (keys.includes('ui-scale') && typeof applyUIScale === 'function') {
    applyUIScale(parseInt(localStorage.getItem('ui-scale') || '100', 10) || 100);
  }
  if (keys.includes('meldex-statusbar-hidden') && typeof applyStatusbarHidden === 'function') {
    applyStatusbarHidden(localStorage.getItem('meldex-statusbar-hidden') === '1');
  }
  if (keys.includes('gb:thumbnail-fit') && typeof applyThumbnailFit === 'function') {
    applyThumbnailFit(resolveThumbnailFitMode());
  }
  if (keys.includes('gb:tree-thumbnail-size') && typeof applyThumbnailSize === 'function') {
    applyThumbnailSize(resolveThumbnailSizeMode());
  }
  if (keys.some(key => key === 'editor-theme' || key === 'editor-theme-name' || key.startsWith('meldex-theme-'))) {
    if (typeof loadColorSettings === 'function') loadColorSettings();
  }
  if (keys.some(key => _SETTINGS_PROFILE_KEYS.includes(key))) {
    if (typeof updateUserIcon === 'function') updateUserIcon();
    if (typeof updateLeftChromeUser === 'function') updateLeftChromeUser();
  }
}

function _pushSettingsDialogStorageHistory(label, beforeSnapshot) {
  if (!beforeSnapshot || typeof pushLocalStorageSettingsHistory !== 'function') return false;
  return pushLocalStorageSettingsHistory(
    label || '設定: 共通設定保存',
    beforeSnapshot,
    _captureSettingsDialogStorageSnapshot(),
    '',
    _restoreSettingsDialogStorageAfterHistory
  );
}

async function _saveUiConfigToServer() {
  const config = {};
  // 固定キー
  [..._UI_CONFIG_KEYS, ..._UI_STRUCTURED_KEYS].forEach(key => {
    const v = localStorage.getItem(key);
    if (v != null) config[key] = v;
  });
  // 動的キー（dbViewConfig:パス 等）
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (_UI_DYNAMIC_PREFIXES.some(p => key.startsWith(p))) {
      config[key] = localStorage.getItem(key);
    }
  }
  return apiPut('/ui-config', config);
}

// ページ読み込み時にサーバーからUI設定を復元（localStorageが空の場合のみ）
async function _restoreUiConfigFromServer() {
  try {
    const config = await apiFetch('/ui-config', { silentError: true });
    if (!config || typeof config !== 'object') return;
    let restored = false;
    // 表示サイズだけは「localStorageが空のときだけ復元」では永久に復元されない。
    // 起動処理が応答を待たずに自動判定値を同期的に書き込むため、ここへ来る頃には
    // 必ず値が入っているからである。サーバー側がユーザー自身の選んだ値を持っていて、
    // この端末側がまだ自動判定値のままなら、そちらを優先して上書きする。
    const overwriteKeys = new Set();
    if (String(config['ui-scale-source'] || '') === 'manual'
      && String(localStorage.getItem('ui-scale-source') || '') !== 'manual'
      && config['ui-scale'] != null) {
      overwriteKeys.add('ui-scale');
      overwriteKeys.add('ui-scale-source');
    }
    for (const [key, val] of Object.entries(config)) {
      if (key === 'folder-files-hidden') continue;
      if (val == null) continue;
      if (localStorage.getItem(key) != null && !overwriteKeys.has(key)) continue;
      localStorage.setItem(key, val);
      restored = true;
    }
    if (restored) {
      // 復元した設定を適用
      if (typeof loadColorSettings === 'function') loadColorSettings();
      const scale = localStorage.getItem('ui-scale');
      if (scale && typeof applyUIScale === 'function') applyUIScale(parseInt(scale) || 100);
      if (typeof applyThumbnailFit === 'function') applyThumbnailFit(resolveThumbnailFitMode());
      if (typeof applyThumbnailSize === 'function') applyThumbnailSize(resolveThumbnailSizeMode());
    }
  } catch {}
}
// 起動時: サーバー復元を待たず、既存のローカル設定を即時反映する
if (typeof applyThumbnailFit === 'function') applyThumbnailFit(resolveThumbnailFitMode());
if (typeof applyThumbnailSize === 'function') applyThumbnailSize(resolveThumbnailSizeMode());
_restoreUiConfigFromServer();

/* showNotionSyncModal / saveNotionToken / doNotionSync 等は gb-notion-sync.js に移動 */
