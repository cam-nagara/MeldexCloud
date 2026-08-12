/* gb-board-info-panel.js: ボード選択を共通ファイル情報パネルへ接続する */
(function initMeldexBoardInfoPanel(global) {
  'use strict';

  const STORAGE_KEY = 'gb:board-default-open-target:v1';
  const VALID_TARGETS = new Set(['main', 'right-sidebar']);
  let renderRevision = 0;
  let scheduledHandle = null;

  function escapeHtml(value) {
    if (typeof global.esc === 'function') return global.esc(String(value == null ? '' : value));
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isExternal(value) {
    return /^(?:https?:|mailto:|tel:)/i.test(String(value || '').trim());
  }

  function imagePathFromUrl(value) {
    const raw = String(value || '').trim();
    if (!raw || /^data:/i.test(raw)) return '';
    try {
      const url = new URL(raw, global.location?.href || 'http://localhost/');
      if (!/\/(?:file-raw|thumbnail)$/.test(url.pathname)) return '';
      return String(url.searchParams.get('path') || '').trim();
    } catch {
      return '';
    }
  }

  function resolveTarget(node) {
    if (!node) return null;
    const link = String(node.link || '').trim();
    if (link) {
      if (isExternal(link)) {
        return {
          kind: 'embedded',
          label: String(node.text || link),
          typeLabel: 'リンク',
          source: link,
        };
      }
      return { kind: 'file', path: link, type: node.linkType || '' };
    }
    const sourcePath = String(node.imageSourcePath || '').trim() || imagePathFromUrl(node.img);
    if (sourcePath) return { kind: 'file', path: sourcePath, type: 'image' };
    if (node.img) {
      return {
        kind: 'embedded',
        label: String(node.text || '埋め込み画像'),
        typeLabel: '埋め込み画像',
        source: /^data:/i.test(String(node.img)) ? '' : String(node.img),
        width: Number(node._imgNaturalW) || 0,
        height: Number(node._imgNaturalH) || 0,
      };
    }
    return null;
  }

  function getDefaultTarget() {
    const routed = global.MeldexBoardOpenTarget?.getDefault?.();
    if (routed === 'float' || routed === 'sidebar') return 'right-sidebar';
    if (VALID_TARGETS.has(routed)) return routed;
    try {
      const stored = global.localStorage?.getItem(STORAGE_KEY);
      return stored === 'float' || stored === 'sidebar' ? 'right-sidebar' : (VALID_TARGETS.has(stored) ? stored : 'right-sidebar');
    } catch {
      return 'right-sidebar';
    }
  }

  function setDefaultTarget(value) {
    const target = value === 'float' || value === 'sidebar' ? 'right-sidebar' : (VALID_TARGETS.has(value) ? value : 'right-sidebar');
    if (global.MeldexBoardOpenTarget?.setDefault) {
      global.MeldexBoardOpenTarget.setDefault(target);
      return;
    }
    try { global.localStorage?.setItem(STORAGE_KEY, target); } catch {}
  }

  function availableTargets() {
    const routed = global.MeldexBoardOpenTarget?.getAvailableTargets?.();
    const normalized = (Array.isArray(routed) ? routed : [])
      .map(item => ({
        value: String(item?.value || '').trim(),
        label: String(item?.label || '').trim(),
      }))
      .filter(item => VALID_TARGETS.has(item.value) && item.label);
    return normalized.length
      ? normalized
      : [
          { value: 'main', label: 'メインパネル' },
          { value: 'right-sidebar', label: '右サイドバー' },
        ];
  }

  function settingsHtml() {
    const targets = availableTargets();
    const stored = getDefaultTarget();
    const selected = targets.some(item => item.value === stored) ? stored : targets[0].value;
    return `<section class="bd-detail-section bd-board-open-target-setting" data-e2e-id="bd-board-open-target-setting">`
      + '<div class="bd-detail-section-title">リンクを開く設定</div>'
      + '<label class="bd-detail-field bd-detail-field-wide"><span>ファイルを開く場所</span>'
      + '<select data-bd-default-open-target data-e2e-id="bd-default-open-target">'
      + targets.map(item => (
        `<option value="${escapeHtml(item.value)}"${selected === item.value ? ' selected' : ''}>${escapeHtml(item.label)}</option>`
      )).join('')
      + '</select></label>'
      + '<p class="gb-section-desc">ダブルクリックとカード右端の開くボタンに適用されます。</p>'
      + '</section>';
  }

  function ensureShell(renderKey) {
    const host = global.document.getElementById('detail-tab-note-editor');
    if (!host) return null;
    host.hidden = false;
    host.innerHTML = `<div class="bd-board-information" data-e2e-id="bd-board-information">`
      + '<div data-bd-board-file-info></div>'
      + settingsHtml()
      + '</div>';
    host.dataset.bdBoardInfoKey = renderKey || '';
    host.querySelector('[data-bd-default-open-target]')?.addEventListener('change', event => {
      setDefaultTarget(event.currentTarget.value);
      if (typeof global.showStatus === 'function') global.showStatus('ファイルを開く場所を保存しました');
    });
    return host.querySelector('[data-bd-board-file-info]');
  }

  function selectedNodes(fallbackNode) {
    if (typeof bd === 'undefined' || !(bd.selected instanceof Set)) {
      return fallbackNode ? [fallbackNode] : [];
    }
    if (fallbackNode && bd.selected.size <= 1) return [fallbackNode];
    const nodes = [];
    for (const candidate of bd.nodes) {
      if (!bd.selected.has(candidate.id)) continue;
      nodes.push(candidate);
      if (nodes.length === bd.selected.size) break;
    }
    if (!nodes.length && fallbackNode) nodes.push(fallbackNode);
    return nodes;
  }

  function currentBoardPath() {
    const currentState = typeof state !== 'undefined' ? state : global.state;
    return String(currentState?.currentBoardPath || '').trim();
  }

  function cancelScheduled() {
    if (scheduledHandle == null) return;
    if (typeof global.cancelIdleCallback === 'function') global.cancelIdleCallback(scheduledHandle);
    else global.clearTimeout(scheduledHandle);
    scheduledHandle = null;
  }

  function scheduleTask(task) {
    cancelScheduled();
    if (typeof global.requestIdleCallback === 'function') {
      scheduledHandle = global.requestIdleCallback(() => {
        scheduledHandle = null;
        task();
      }, { timeout: 120 });
    } else {
      scheduledHandle = global.setTimeout(() => {
        scheduledHandle = null;
        task();
      }, 0);
    }
  }

  function render(node) {
    const nodes = selectedNodes(node);
    const targets = nodes.map(resolveTarget).filter(Boolean);
    const boardPath = currentBoardPath();
    const renderKey = targets.length
      ? targets.map(target => `${target.kind}:${target.path || target.source || target.label || ''}`).sort().join('\n')
      : (boardPath ? `board:${boardPath}` : 'empty');
    const tabHost = global.document.getElementById('detail-tab-note-editor');
    if (tabHost?.dataset.bdBoardInfoKey === renderKey && tabHost.querySelector('[data-bd-board-file-info]')) {
      return targets.length > 0;
    }
    const revision = ++renderRevision;
    const infoHost = ensureShell(renderKey);
    if (!infoHost) return false;
    if (!targets.length) {
      if (boardPath && global.MeldexFileInfoPanel?.renderInto) {
        void global.MeldexFileInfoPanel.renderInto(infoHost, boardPath, {
          isCurrent: () => revision === renderRevision && infoHost.isConnected,
          showTags: true,
          type: 'board',
          typeLabel: 'ボード',
        });
        return true;
      }
      infoHost.innerHTML = '<div class="gb-empty-placeholder">ボードの保存先情報を取得できませんでした。</div>';
      return false;
    }
    infoHost.innerHTML = '<div class="folder-multi-info-loading">ファイル情報を読み込んでいます...</div>';
    scheduleTask(() => {
      if (revision !== renderRevision || !infoHost.isConnected) return;
      const fileTargets = targets.filter(target => target.kind === 'file');
      if (fileTargets.length > 1 && global.MeldexFolderMultiInfo?.renderInto) {
        global.MeldexFolderMultiInfo.renderInto(
          infoHost,
          fileTargets.map(target => ({ path: target.path, type: target.type || 'file' })),
          { isCurrent: () => revision === renderRevision && infoHost.isConnected },
        );
        return;
      }
      const target = targets[0];
      if (target.kind === 'file' && global.MeldexFileInfoPanel?.renderInto) {
        global.MeldexFileInfoPanel.renderInto(infoHost, target.path, {
          isCurrent: () => revision === renderRevision && infoHost.isConnected,
          showTags: true,
        });
        return;
      }
      global.MeldexFileInfoPanel?.renderEmbedded?.(infoHost, target);
    });
    return true;
  }

  function hasInformation(node) {
    return !!resolveTarget(node) || !!currentBoardPath();
  }

  function cancel() {
    renderRevision += 1;
    cancelScheduled();
    const infoHost = global.document.querySelector('[data-bd-board-file-info]');
    global.MeldexFileInfoPanel?.cancel?.(infoHost);
  }

  global.MeldexBoardInfoPanel = Object.freeze({
    render,
    cancel,
    hasInformation,
    resolveTarget,
  });
})(window);
