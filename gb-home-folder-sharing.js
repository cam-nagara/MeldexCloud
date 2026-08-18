// ホームフォルダの版間共有（個人ルート追従化） フロントエンド。
//
// 設計方針: app/docs/home-folder-sharing-plan-2026-08-12.md
//
// 責務:
// - 設定「全般」タブのホームフォルダ欄に、共有関連の状態を1行だけ表示する
//   （常時表示せず、共有と判定できた場合のみ）。
// - 起動時・設定画面表示時に、既存ホームの引き継ぎ提案（Phase3 ①）と、
//   ローカル既定に残ったデータの移行確認（Phase3 ②）を1回だけ提示する。
//
// バックエンド: meldex_api_home_folder_sharing.py
(function () {
  'use strict';

  if (window.MeldexHomeFolderSharing) return;

  const SHARED_REASON_LABEL = {
    workspace: '共有ワークスペース',
    team_root: 'チームスペース',
    team_json: '複数人が使うフォルダ',
  };

  let _promptChecked = false;
  let _startupWarningShown = false;

  async function _fetchStatus() {
    try {
      return await apiFetch('/home-folder-sharing/status', { silentError: true });
    } catch (err) {
      console.warn('[MeldexHomeFolderSharing] status fetch failed', err);
      return null;
    }
  }

  async function _fetchCandidate() {
    try {
      return await apiFetch('/home-folder-sharing/inherit-candidate', { silentError: true });
    } catch (err) {
      console.warn('[MeldexHomeFolderSharing] candidate fetch failed', err);
      return null;
    }
  }

  function _renderStatusLine(status) {
    const el = document.getElementById('home-folder-sharing-status');
    if (!el) return;
    if (!status) { el.hidden = true; return; }
    if (status.vaultShared && status.homeSource !== 'explicit') {
      el.hidden = false;
      el.style.color = '';
      el.textContent = 'ルートフォルダが共有のため、ホームは個人の場所に置かれています。';
      return;
    }
    if (status.homeShared) {
      el.hidden = false;
      el.style.color = 'var(--danger)';
      const label = SHARED_REASON_LABEL[status.homeSharedReason] || '共有フォルダ';
      el.textContent = `ホームフォルダが${label}の中にあります。他の人から見える可能性があります。`;
      return;
    }
    el.hidden = true;
  }

  async function loadHomeFolderSharingStatusForSettings() {
    const status = await _fetchStatus();
    _renderStatusLine(status);
    if (status?.homeShared && !_startupWarningShown) {
      _startupWarningShown = true;
      if (typeof showStatus === 'function') {
        showStatus('ホームフォルダが共有フォルダの中にあります。他の人から内容が見える可能性があります。', true);
      }
    }
    _maybeShowInheritOrMigrationPrompt();
    return status;
  }

  async function _maybeShowInheritOrMigrationPrompt() {
    if (_promptChecked) return;
    _promptChecked = true;
    const data = await _fetchCandidate();
    if (!data) return;
    if (data.candidate) {
      _showInheritDialog(data.candidate);
    } else if (data.migration) {
      _showMigrationDialog(data.migration);
    }
  }

  function _applyAdoptedHome(path) {
    const homeInput = document.getElementById('modal-home-folder');
    if (homeInput) homeInput.value = path;
    try {
      window._homeFolderPath = path;
      if (typeof _homeFolderPath !== 'undefined') _homeFolderPath = path; // eslint-disable-line no-undef
    } catch (_) {}
    if (typeof renderHomeFolderTree === 'function') renderHomeFolderTree();
  }

  function _dialogParagraph(text) {
    const p = document.createElement('p');
    p.className = 'meldex-onboarding-copy';
    p.textContent = text;
    return p;
  }

  function _dialogPath(text) {
    const div = document.createElement('div');
    div.className = 'meldex-onboarding-path';
    div.textContent = text;
    return div;
  }

  function _dialogButton(label, primary) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = primary ? 'gb-btn gb-btn-sm gb-btn-primary' : 'gb-btn gb-btn-sm';
    btn.textContent = label;
    return btn;
  }

  function _showInheritDialog(candidate) {
    if (!window.GBUI?.createModal) return;
    let settled = false;
    const content = document.createElement('div');
    content.appendChild(_dialogParagraph('デスクトップ版／クラウド版で使っているホームフォルダが見つかりました。'));
    content.appendChild(_dialogPath(candidate.path));
    content.appendChild(_dialogParagraph('これを使いますか？'));
    const skipBtn = _dialogButton('今のままにする', false);
    const useBtn = _dialogButton('このフォルダを使う', true);
    const controller = window.GBUI.createModal({
      id: 'home-folder-sharing-inherit',
      title: 'ホームフォルダの引き継ぎ',
      body: content,
      footer: [skipBtn, useBtn],
      variant: 'standard',
      onClose: () => {
        if (settled) return;
        settled = true;
        apiPost('/home-folder-sharing/inherit-decision', { decision: 'dismiss' }, { silentError: true }).catch(() => {});
      },
    });
    useBtn.addEventListener('click', async () => {
      settled = true;
      try {
        await apiPost('/home-folder-sharing/inherit-decision', { decision: 'adopt', path: candidate.path });
        _applyAdoptedHome(candidate.path);
        if (typeof showStatus === 'function') showStatus('ホームフォルダを引き継ぎました');
      } catch (err) {
        // apiFetch がエラートーストを既に出しているため、ここでは再表示しない。
      }
      controller.close('use');
    });
    skipBtn.addEventListener('click', () => {
      settled = true;
      apiPost('/home-folder-sharing/inherit-decision', { decision: 'dismiss' }, { silentError: true }).catch(() => {});
      controller.close('skip');
    });
    controller.open();
  }

  function _showMigrationDialog(migration) {
    if (!window.GBUI?.createModal) return;
    let settled = false;
    const content = document.createElement('div');
    content.appendChild(_dialogParagraph('これまで使っていたホームフォルダにデータが残っています。'));
    content.appendChild(_dialogPath(migration.path));
    content.appendChild(_dialogParagraph('コピーして新しいホームフォルダへ引っ越しますか？（元のフォルダは残ります）'));
    const keepBtn = _dialogButton('今のまま使い続ける', false);
    const copyBtn = _dialogButton('コピーして引っ越す', true);
    const controller = window.GBUI.createModal({
      id: 'home-folder-sharing-migration',
      title: 'ホームフォルダの引っ越し',
      body: content,
      footer: [keepBtn, copyBtn],
      variant: 'standard',
      initialFocus: () => keepBtn,
      onClose: () => {
        if (settled) return;
        settled = true;
        apiPost('/home-folder-sharing/migration-decision', { decision: 'dismiss' }, { silentError: true }).catch(() => {});
      },
    });
    copyBtn.addEventListener('click', async () => {
      settled = true;
      try {
        await apiPost('/home-folder-sharing/migration-decision', { decision: 'copy', path: migration.path });
        if (typeof showStatus === 'function') showStatus('データをコピーしました');
      } catch (err) {
        // apiFetch がエラートーストを既に出している。
      }
      controller.close('copy');
    });
    keepBtn.addEventListener('click', async () => {
      settled = true;
      try {
        await apiPost('/home-folder-sharing/migration-decision', { decision: 'keep-old', path: migration.path });
        _applyAdoptedHome(migration.path);
        if (typeof showStatus === 'function') showStatus('今までのホームフォルダを使い続けます');
      } catch (err) {
        // apiFetch がエラートーストを既に出している。
      }
      controller.close('keep-old');
    });
    controller.open();
  }

  async function checkCloudHomeFolderSharing(vaultInfo = {}) {
    try {
      const isTeamRoot = vaultInfo?.namespaceKind === 'team_root' || vaultInfo?.state?.namespaceKind === 'team_root';
      const rootPath = vaultInfo?.path || vaultInfo?.state?.path || '/';
      let isWorkspace = false;

      if (window.MeldexWorkspaceFolderDetect?.isWorkspaceFolder) {
        const detectRes = await window.MeldexWorkspaceFolderDetect.isWorkspaceFolder(rootPath, vaultInfo?.namespaceKind || 'home');
        if (detectRes?.workspace) isWorkspace = true;
      }

      const isShared = isTeamRoot || isWorkspace || !!vaultInfo?.isSharedRoot;
      if (isShared && !_startupWarningShown) {
        _startupWarningShown = true;
        const reason = isTeamRoot ? 'チームスペース' : '共有ワークスペース';
        if (typeof showStatus === 'function') {
          showStatus(`ホームフォルダが${reason}の中にあります。他の人から内容が見える可能性があります。`, true);
        }
      }
      return { shared: isShared, reason: isTeamRoot ? 'team_root' : (isWorkspace ? 'workspace' : '') };
    } catch (err) {
      console.warn('[MeldexHomeFolderSharing] cloud check error', err);
      return { shared: false, error: err };
    }
  }

  window.MeldexHomeFolderSharing = {
    loadHomeFolderSharingStatusForSettings,
    checkCloudHomeFolderSharing,
  };
  window.loadHomeFolderSharingStatusForSettings = loadHomeFolderSharingStatusForSettings;
  window.checkCloudHomeFolderSharing = checkCloudHomeFolderSharing;
})();
