/* gb-board-info-panel.js: ボード選択を共通ファイル情報パネルへ接続する */
(function initMeldexBoardInfoPanel(global) {
  'use strict';

  const STORAGE_KEY = 'gb:board-default-open-target:v1';
  const VALID_TARGETS = new Set(['main', 'right-sidebar']);
  // ボードのリンクカード計画 (2026-08-13) Phase C: 「カードを選ぶと右サイドバーに表示する」の
  // 保存キー。既定の開き先設定 (STORAGE_KEY) と同じ localStorage の仕組みに倣う。
  const SELECT_AUTO_SUBPANEL_KEY = 'gb:board-select-open-subpanel:v1';
  let renderRevision = 0;
  let scheduledHandle = null;

  const escapeHtml = global.MeldexEscape.html;

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
          nodeId: node.id,
          kind: 'embedded',
          label: String(node.text || link),
          typeLabel: 'リンク',
          source: link,
        };
      }
      return { kind: 'file', nodeId: node.id, path: link, type: node.linkType || '', image: !!node.img };
    }
    const sourcePath = String(node.imageSourcePath || '').trim() || imagePathFromUrl(node.img);
    if (sourcePath) return { kind: 'file', nodeId: node.id, path: sourcePath, type: 'image', image: true };
    if (node.img) {
      return {
        nodeId: node.id,
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

  function getSelectAutoSubpanelEnabled() {
    if (typeof global.MeldexBoardSelectAutoSubpanel?.isEnabled === 'function') {
      return global.MeldexBoardSelectAutoSubpanel.isEnabled();
    }
    try {
      const stored = global.localStorage?.getItem(SELECT_AUTO_SUBPANEL_KEY);
      return stored == null ? true : stored !== '0';
    } catch {
      return true;
    }
  }

  function setSelectAutoSubpanelEnabled(value) {
    const next = value !== false;
    if (typeof global.MeldexBoardSelectAutoSubpanel?.setEnabled === 'function') {
      global.MeldexBoardSelectAutoSubpanel.setEnabled(next);
      return;
    }
    try { global.localStorage?.setItem(SELECT_AUTO_SUBPANEL_KEY, next ? '1' : '0'); } catch {}
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
    const autoSubpanelChecked = getSelectAutoSubpanelEnabled();
    return `<section class="bd-detail-section bd-board-open-target-setting" data-e2e-id="bd-board-open-target-setting">`
      + '<div class="bd-detail-section-title">リンクを開く設定</div>'
      + '<label class="bd-detail-field bd-detail-field-wide"><span>ファイルを開く場所</span>'
      + '<select data-bd-default-open-target data-e2e-id="bd-default-open-target">'
      + targets.map(item => (
        `<option value="${escapeHtml(item.value)}"${selected === item.value ? ' selected' : ''}>${escapeHtml(item.label)}</option>`
      )).join('')
      + '</select></label>'
      + '<p class="gb-section-desc">ダブルクリックとカード右端の開くボタンに適用されます。</p>'
      + '<div class="gb-check-help-row">'
      + '<label class="bd-detail-check"><input type="checkbox" data-bd-select-auto-subpanel'
      + ` data-e2e-id="bd-select-auto-subpanel"${autoSubpanelChecked ? ' checked' : ''}><span>カードを選ぶと右サイドバーに表示する</span></label>`
      + (typeof fieldHelp === 'function' ? fieldHelp(
        'リンクを持つカードを1枚だけ選ぶと、右サイドバー（サブパネル）が開いている場合にかぎり、その中身を選んだカードのリンク先へ切り替えます。複数選択・範囲選択・ドラッグ中・カードの文字を編集中は切り替わりません。',
        { e2eId: 'bd-select-auto-subpanel-help' },
      ) : '')
      + '</div>'
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
    host.querySelector('[data-bd-select-auto-subpanel]')?.addEventListener('change', event => {
      setSelectAutoSubpanelEnabled(!!event.currentTarget.checked);
      if (typeof global.showStatus === 'function') global.showStatus('選択時の表示設定を保存しました');
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

  function boardIdentity() {
    return {
      path: String((typeof bd !== 'undefined' && bd?.path) || currentBoardPath() || '').trim(),
      openSeq: Number(typeof bd !== 'undefined' && bd?._openSeq) || 0,
    };
  }

  function targetIsCurrent(snapshot, revision, infoHost) {
    if (revision !== renderRevision || !infoHost?.isConnected || typeof bd === 'undefined') return false;
    const currentPath = String(bd.path || currentBoardPath() || '').trim();
    if (currentPath !== snapshot.boardPath || (Number(bd._openSeq) || 0) !== snapshot.openSeq) return false;
    const node = bd.nodes?.find(candidate => candidate?.id === snapshot.nodeId);
    const current = resolveTarget(node);
    return !!current && current.kind === 'file' && current.path === snapshot.targetPath;
  }

  function relocateLinkedNode(snapshot, revision, infoHost) {
    if (!targetIsCurrent(snapshot, revision, infoHost)) return;
    if (snapshot.image && typeof global.bdRelocateImageNode === 'function') {
      void global.bdRelocateImageNode(snapshot.nodeId);
      return;
    }
    if (typeof global.showLinkInsertModal !== 'function') {
      global.showStatus?.('ファイル選択画面を開けませんでした', true);
      return;
    }
    global.showLinkInsertModal(null, result => {
      if (!result || !targetIsCurrent(snapshot, revision, infoHost)) return;
      const nextPath = result.type === 'file' ? String(result.path || '').trim() : String(result.url || '').trim();
      if (!nextPath) return;
      const node = bd.nodes.find(candidate => candidate?.id === snapshot.nodeId);
      if (!node) return;
      global.bdPushUndo?.();
      node.link = nextPath;
      node.linkType = result.type === 'file' ? String(result.fileType || '') : '';
      if (!node.text || node.text === '無題') node.text = String(result.name || nextPath.split(/[/\\]/).pop() || nextPath);
      if (typeof global.bdRefreshNodesPartial === 'function') {
        global.bdRefreshNodesPartial([node.id], 'relocate-file-link', { detailPanel: true });
      } else {
        global.bdRender?.();
      }
      global.bdDirty?.();
      global.showStatus?.('リンク先のファイルを付け替えました');
    });
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
      ? targets.map(target => `${target.nodeId || ''}:${target.kind}:${target.path || target.source || target.label || ''}`).sort().join('\n')
      : (boardPath ? `board:${boardPath}` : 'empty');
    const tabHost = global.document.getElementById('detail-tab-note-editor');
    if (tabHost?.dataset.bdBoardInfoKey === renderKey && tabHost.querySelector('[data-bd-board-file-info]')) {
      return targets.length > 0;
    }
    const revision = ++renderRevision;
    const identity = boardIdentity();
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
        const snapshot = {
          nodeId: target.nodeId,
          openSeq: identity.openSeq,
          boardPath: identity.path,
          targetPath: target.path,
          image: target.image || target.type === 'image',
        };
        global.MeldexFileInfoPanel.renderInto(infoHost, target.path, {
          isCurrent: () => targetIsCurrent(snapshot, revision, infoHost),
          showTags: true,
          onRelocate: () => relocateLinkedNode(snapshot, revision, infoHost),
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
