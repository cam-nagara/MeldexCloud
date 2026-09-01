(function (global) {
  'use strict';

  function text(tag, value, className) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = String(value ?? '');
    return el;
  }

  function confirmRestore() {
    const message = 'この版の設定へ復元しますか？\n現在の設定は復元前の版として残し、反映後に画面を再読み込みします。';
    if (typeof global.cfConfirm === 'function') {
      return global.cfConfirm(message, { okLabel: '復元' });
    }
    return new Promise(resolve => {
      if (typeof showConfirmDialog !== 'function') return resolve(false);
      showConfirmDialog(message, () => resolve(true), () => resolve(false));
    });
  }

  const SAFE_DESCRIPTORS = {
    'editor-theme-name': { label: 'テーマ', format: 'text' },
    'ui-scale': { label: '表示サイズ', format: 'percent' },
    'meldex-statusbar-hidden': { label: 'ステータスバー', format: 'hidden' },
    'note-vertical': { label: '縦書き', format: 'boolean' },
    'note-heading-indent': { label: '見出しのインデント', format: 'boolean' },
    'note-toc-visible': { label: '目次', format: 'boolean' },
    'history-max': { label: '履歴の保持数', format: 'number' },
    'version-config': { label: 'バージョン管理', format: 'changed' },
  };
  const SECRET_OR_PRIVATE_KEY = /(secret|token|api.?key|password|passphrase|credential|private|owner.?key|path|folder|workspace|source|vault)/i;

  function safeChange(change) {
    const key = String(change?.key || '');
    if (!key || SECRET_OR_PRIVATE_KEY.test(key)) return null;
    const descriptor = SAFE_DESCRIPTORS[key];
    if (!descriptor) return { label: 'その他の設定', format: 'changed', versionValue: null, currentValue: null };
    return { ...descriptor, versionValue: change.versionValue, currentValue: change.currentValue };
  }

  function valueText(value, format) {
    if (format === 'changed') return '変更あり';
    if (format === 'boolean') return String(value) === 'true' || String(value) === '1' ? 'オン' : 'オフ';
    if (format === 'hidden') return String(value) === 'true' || String(value) === '1' ? '非表示' : '表示';
    if (format === 'percent') return /^\d{1,3}$/.test(String(value || '')) ? `${value}%` : '変更あり';
    if (format === 'number') return /^\d+$/.test(String(value || '')) ? String(value) : '変更あり';
    const raw = typeof value === 'string' ? value : '';
    return raw && raw.length <= 80 && !/[{}\[\]\\/]/.test(raw) ? raw : (raw ? '変更あり' : '（なし）');
  }

  function applyRestoredConfig(config, previousConfig) {
    const desired = config && typeof config === 'object' ? config : {};
    const previous = previousConfig && typeof previousConfig === 'object' ? previousConfig : {};
    const keys = [...new Set([...Object.keys(previous), ...Object.keys(desired)])];
    const rollback = new Map(keys.map(key => [key, localStorage.getItem(key)]));
    try {
      keys.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(desired, key) && desired[key] != null) {
          localStorage.setItem(key, String(desired[key]));
        } else {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      rollback.forEach((value, key) => {
        try {
          if (value == null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        } catch {}
      });
      throw error;
    }
  }

  async function openUiConfigVersionDialog() {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const body = document.createElement('div');
    body.className = 'gb-settings-version-history';
    body.dataset.e2eId = 'settings-version-history-body';
    const status = text('div', '設定の版を読み込んでいます…', 'gb-section-desc');
    status.setAttribute('role', 'status');
    body.appendChild(status);
    const close = text('button', '閉じる', 'gb-btn gb-btn-sm');
    close.type = 'button';
    const dialog = window.GBUI.createModal({
      id: 'settings-version-history-dialog',
      title: '設定のバージョン',
      body,
      footer: close,
      variant: 'standard',
      extraClass: 'settings-version-history-modal',
      geometryKey: 'settings-version-history',
      minWidth: '0',
      initialFocus: close,
      returnFocus: opener,
    });
    dialog.overlay.dataset.e2eId = 'settings-version-history-overlay';
    close.dataset.e2eId = 'settings-version-history-close';
    const headerClose = dialog.modal.querySelector('.gb-modal-close');
    if (headerClose) headerClose.dataset.e2eId = 'settings-version-history-header-close';
    dialog.modal.style.width = 'min(720px, calc(100vw - 24px))';
    close.addEventListener('click', () => dialog.close('complete'));
    dialog.open();
    try {
      const listed = await apiFetch('/ui-config/history');
      body.replaceChildren();
      const versions = Array.isArray(listed?.versions) ? listed.versions : [];
      if (!versions.length) {
        body.appendChild(text('div', 'まだ設定の版はありません。設定を変更して保存すると自動で残ります。', 'gb-section-desc'));
        return;
      }
      for (const version of versions) {
        const row = document.createElement('section');
        row.className = 'gb-section gb-section--boxed';
        row.dataset.versionId = String(version.versionId || '');
        row.appendChild(text('div', version.label || '設定変更前', 'gb-section-title'));
        row.appendChild(text('div', `${new Date(version.createdAt || 0).toLocaleString()}・${version.actor || '利用者'}`, 'gb-section-desc'));
        const actions = document.createElement('div');
        actions.className = 'gb-field-row';
        const compare = text('button', '変更内容を見る', 'gb-btn gb-btn-sm');
        compare.type = 'button';
        const restore = text('button', 'この版へ復元', 'gb-btn gb-btn-sm');
        restore.type = 'button';
        const stableVersionId = String(version.versionId || '').replace(/[^a-z0-9_-]+/gi, '-');
        compare.dataset.e2eId = `settings-version-compare-${stableVersionId}`;
        restore.dataset.e2eId = `settings-version-restore-${stableVersionId}`;
        const details = text('div', '', 'gb-section-desc');
        details.hidden = true;
        compare.addEventListener('click', async () => {
          compare.disabled = true;
          try {
            const result = await apiFetch(`/ui-config/history/${encodeURIComponent(version.versionId)}`);
            row._settingsVersionCompare = result;
            const changes = Array.isArray(result?.changes) ? result.changes : [];
            details.replaceChildren();
            details.appendChild(text('div', changes.length ? `${changes.length}項目が現在と異なります。` : '現在の設定と同じです。'));
            changes.map(safeChange).filter(Boolean).forEach(change => {
              const item = document.createElement('div');
              item.appendChild(text('strong', change.label));
              item.appendChild(text('div', `この版: ${valueText(change.versionValue, change.format)}`));
              item.appendChild(text('div', `現在: ${valueText(change.currentValue, change.format)}`));
              details.appendChild(item);
            });
            details.hidden = false;
            row.dataset.currentRevision = String(result?.currentRevision || '');
          } catch (error) {
            details.textContent = error?.message || '変更内容を読み込めませんでした。';
            details.hidden = false;
          } finally {
            compare.disabled = false;
          }
        });
        restore.addEventListener('click', async () => {
          if (!(await confirmRestore())) return;
          restore.disabled = true;
          try {
            let currentRevision = row.dataset.currentRevision;
            if (!currentRevision) {
              const compared = await apiFetch(`/ui-config/history/${encodeURIComponent(version.versionId)}`);
              row._settingsVersionCompare = compared;
              currentRevision = String(compared?.currentRevision || '');
            }
            const result = await apiPost(`/ui-config/history/${encodeURIComponent(version.versionId)}/restore`, {
              expectedRevision: currentRevision,
            });
            applyRestoredConfig(result?.config, row._settingsVersionCompare?.current);
            location.reload();
          } catch (error) {
            details.textContent = error?.message || '設定を復元できませんでした。';
            details.hidden = false;
            restore.disabled = false;
          }
        });
        actions.append(compare, restore);
        row.append(actions, details);
        body.appendChild(row);
      }
    } catch (error) {
      status.textContent = error?.message || '設定の版を読み込めませんでした。';
    }
  }

  global.openUiConfigVersionDialog = openUiConfigVersionDialog;
})(typeof globalThis !== 'undefined' ? globalThis : window);
