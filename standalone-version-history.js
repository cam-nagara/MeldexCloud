/* Standalone Quick Memo / Viewer version list, compare and restore UI. */
(function () {
  'use strict';

  const API_BASE = location.protocol === 'file:' ? 'http://127.0.0.1:8765' : '';

  async function getJson(path) {
    if (typeof window.apiFetch === 'function') return window.apiFetch(path);
    const response = await fetch(API_BASE + '/api' + path);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || payload.error || response.statusText);
    return payload;
  }

  async function postJson(path, body) {
    if (typeof window.apiPost === 'function') return window.apiPost(path, body);
    const response = await fetch(API_BASE + '/api' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || payload.error || response.statusText);
    return payload;
  }

  function installStyles() {
    if (document.getElementById('standalone-version-history-style')) return;
    const style = document.createElement('style');
    style.id = 'standalone-version-history-style';
    style.textContent = `
      .sa-version-overlay{position:fixed;inset:0;z-index:2147483200;background:rgba(0,0,0,.55);display:grid;place-items:center;padding:16px}
      .sa-version-dialog{width:min(760px,100%);max-height:min(760px,92vh);overflow:auto;background:var(--bg2,#202124);color:var(--fg,#eee);border:1px solid var(--border,#555);border-radius:12px;box-shadow:0 18px 60px #0008}
      .sa-version-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border,#555);position:sticky;top:0;background:inherit;z-index:1}
      .sa-version-head strong{flex:1}.sa-version-close,.sa-version-action{min-height:32px;border:1px solid var(--border,#666);border-radius:7px;background:var(--bg3,#303134);color:inherit;padding:5px 10px;cursor:pointer}
      .sa-version-list{display:grid;gap:8px;padding:12px}.sa-version-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;padding:10px;border:1px solid var(--border,#555);border-radius:9px}
      .sa-version-meta{min-width:0}.sa-version-label{font-weight:600;overflow-wrap:anywhere}.sa-version-date{font-size:12px;color:var(--fg2,#aaa);margin-top:3px}.sa-version-actions{display:flex;gap:6px;align-items:center}
      .sa-version-empty,.sa-version-error{padding:20px;color:var(--fg2,#aaa)}.sa-version-error{color:var(--danger,#ff8b8b)}
      .sa-version-compare{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:0 12px 14px}.sa-version-pane{min-width:0}.sa-version-pane h3{font-size:13px;margin:0 0 6px}.sa-version-pane pre{margin:0;max-height:45vh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--bg,#171717);padding:10px;border-radius:8px}
      @media(max-width:640px){.sa-version-row{grid-template-columns:1fr}.sa-version-compare{grid-template-columns:1fr}.sa-version-action{min-height:44px}}
    `;
    document.head.appendChild(style);
  }

  function closeOverlay(overlay) {
    overlay?.remove();
  }

  function makeOverlay(title) {
    installStyles();
    const overlay = document.createElement('div');
    overlay.className = 'sa-version-overlay';
    overlay.dataset.e2eId = 'standalone-version-history';
    overlay.setAttribute('role', 'presentation');
    const dialog = document.createElement('section');
    dialog.className = 'sa-version-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', title);
    const head = document.createElement('header');
    head.className = 'sa-version-head';
    const heading = document.createElement('strong');
    heading.textContent = title;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'sa-version-close';
    close.textContent = '閉じる';
    close.addEventListener('click', () => closeOverlay(overlay));
    head.append(heading, close);
    const body = document.createElement('div');
    body.className = 'sa-version-list';
    dialog.append(head, body);
    overlay.appendChild(dialog);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeOverlay(overlay);
    });
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeOverlay(overlay);
    });
    document.body.appendChild(overlay);
    close.focus();
    return { overlay, dialog, body };
  }

  function showError(body, error) {
    const message = document.createElement('div');
    message.className = 'sa-version-error';
    message.setAttribute('role', 'alert');
    message.textContent = String(error?.message || error || 'バージョンを読み込めませんでした');
    body.replaceChildren(message);
  }

  function showComparison(dialog, savedLabel, savedText, currentText) {
    dialog.querySelector('.sa-version-compare')?.remove();
    const compare = document.createElement('div');
    compare.className = 'sa-version-compare';
    [
      [savedLabel || '保存版', savedText],
      ['現在', currentText],
    ].forEach(([label, text]) => {
      const pane = document.createElement('section');
      pane.className = 'sa-version-pane';
      const heading = document.createElement('h3');
      heading.textContent = label;
      const pre = document.createElement('pre');
      pre.textContent = String(text || '');
      pane.append(heading, pre);
      compare.appendChild(pane);
    });
    dialog.appendChild(compare);
  }

  function renderRows(view, versions, handlers) {
    view.body.replaceChildren();
    if (!Array.isArray(versions) || !versions.length) {
      const empty = document.createElement('div');
      empty.className = 'sa-version-empty';
      empty.textContent = '保存版はまだありません';
      view.body.appendChild(empty);
      return;
    }
    versions.forEach(version => {
      const row = document.createElement('article');
      row.className = 'sa-version-row';
      row.dataset.versionName = String(version.name || '');
      const meta = document.createElement('div');
      meta.className = 'sa-version-meta';
      const label = document.createElement('div');
      label.className = 'sa-version-label';
      label.textContent = String(version.label || (version.auto ? '周期復元ポイント' : version.name) || '復元ポイント');
      const date = document.createElement('div');
      date.className = 'sa-version-date';
      date.textContent = [version.auto ? '周期・自動' : '手動復元ポイント', version.modified || version.created || ''].filter(Boolean).join(' · ');
      meta.append(label, date);
      const actions = document.createElement('div');
      actions.className = 'sa-version-actions';
      [['比較', handlers.compare], ['復元', handlers.restore]].forEach(([text, handler]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sa-version-action';
        button.textContent = text;
        button.dataset.e2eId = `standalone-version-${text === '比較' ? 'compare' : 'restore'}`;
        button.addEventListener('click', () => handler(version, view));
        actions.appendChild(button);
      });
      row.append(meta, actions);
      view.body.appendChild(row);
    });
  }

  async function openViewerAnnotations() {
    const target = window.MeldexViewerAnnotations?.currentTargetPath?.() || '';
    if (!target) throw new Error('アノテートの対象を開いてください');
    const view = makeOverlay('現在の画像・PDFのアノテート復元ポイント');
    try {
      const versions = await getJson('/annotations/versions?target=' + encodeURIComponent(target));
      renderRows(view, versions, {
        compare: async version => {
          try {
            const data = await getJson('/annotations/versions/read?target=' + encodeURIComponent(target) + '&version=' + encodeURIComponent(version.name));
            showComparison(
              view.dialog,
              version.label || version.name,
              JSON.stringify(data.savedAnnotations || [], null, 2),
              JSON.stringify(data.currentAnnotations || [], null, 2),
            );
          } catch (error) { showError(view.body, error); }
        },
        restore: async version => {
          try {
            const current = await getJson('/annotations/versions/read?target=' + encodeURIComponent(target) + '&version=' + encodeURIComponent(version.name));
            if (!window.confirm('このアノテート復元ポイントへ戻しますか？\n現在のアノテートは復元直前の復元ポイントとして残ります。')) return;
            await postJson('/annotations/versions/restore', {
              target,
              version: version.name,
              expectedRevision: current.annotationWriteRevision || '',
            });
            await window.MeldexViewerAnnotations?.load?.();
            closeOverlay(view.overlay);
          } catch (error) { showError(view.body, error); }
        },
      });
    } catch (error) { showError(view.body, error); }
  }

  async function openQuickMemo() {
    const api = window.MeldexQuickMemo;
    await api?.flush?.();
    const target = api?.currentVersionTarget?.() || {};
    if (!target.path) throw new Error('先にクイックメモを保存してください');
    const view = makeOverlay('クイックメモの復元ポイント');
    try {
      const versions = await getJson('/version/list?path=' + encodeURIComponent(target.path));
      renderRows(view, versions, {
        compare: async version => {
          try {
            const data = await getJson('/version/read?path=' + encodeURIComponent(target.path) + '&version=' + encodeURIComponent(version.name));
            const current = typeof data.currentContent === 'string' ? data.currentContent : '';
            showComparison(view.dialog, version.label || version.name, data.content, current);
          } catch (error) { showError(view.body, error); }
        },
        restore: async version => {
          try {
            const data = await getJson('/version/read?path=' + encodeURIComponent(target.path) + '&version=' + encodeURIComponent(version.name));
            if (!window.confirm('この復元ポイントへ戻しますか？\n現在の内容は復元直前の復元ポイントとして残ります。')) return;
            await postJson('/version/restore', {
              path: target.path,
              version: version.name,
              transport_revision: data.transport_revision || { transport: 'local-etag', token: data.etag },
            });
            await api?.reloadCurrentVersion?.();
            closeOverlay(view.overlay);
          } catch (error) { showError(view.body, error); }
        },
      });
    } catch (error) { showError(view.body, error); }
  }

  function bindButton(id, handler) {
    const button = document.getElementById(id);
    if (!button || window.parent !== window) return;
    button.hidden = false;
    if (id === 'quickMemoVersionBtn') {
      button.innerHTML = typeof window.lucide === 'function' ? window.lucide('history', 19) : '履歴';
    }
    button.addEventListener('click', () => handler().catch(error => {
      window.alert(String(error?.message || error));
    }));
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindButton('btn-annotation-versions', openViewerAnnotations);
    bindButton('quickMemoVersionBtn', openQuickMemo);
  });

  window.MeldexStandaloneVersionHistory = { openViewerAnnotations, openQuickMemo };
})();
