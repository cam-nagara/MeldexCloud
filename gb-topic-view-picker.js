/* Existing/new Sheet and Board picker for note embed references. */
(function initMeldexTopicViewPicker(global) {
  'use strict';

  const MIME = 'application/x-meldex-topic-view+json';
  const TYPES = Object.freeze({ sheet: ['database'], board: ['board'] });

  function _leaf(path) {
    return String(path || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || '無題';
  }

  function _logicalPath(selection) {
    return global.GBFolderPicker?.toSourceRelativePath?.(selection) || String(selection?.path || '');
  }

  function _relativePath(selection) {
    const path = String(selection?.path || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const root = String(selection?.rootPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (!root || (path !== root && !path.startsWith(root + '/'))) return '';
    return path === root ? '' : path.slice(root.length + 1);
  }

  async function _post(path, body) {
    if (typeof global.apiFetch !== 'function') throw new Error('ビューの読み込みAPIへ接続できません');
    return global.apiFetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), silentError: true,
    });
  }

  function _viewRows(viewDocument, resourceType) {
    const rows = resourceType === 'sheet' ? viewDocument?.sheetViews : viewDocument?.boardViews;
    return (Array.isArray(rows) ? rows : []).filter(row => row && typeof row === 'object');
  }

  function _rowViewId(view) {
    return String(view?.viewId || view?.sheetViewId || view?.boardViewId || '').trim();
  }

  async function _chooseViewId(viewDocument, resourceType, preferredViewId) {
    const rows = _viewRows(viewDocument, resourceType);
    const requested = String(preferredViewId || (resourceType === 'sheet'
      ? viewDocument?.activeSheetViewId : viewDocument?.activeBoardViewId)
      || viewDocument?.activeView || '');
    if (requested && rows.some(row => _rowViewId(row) === requested)) return requested;
    if (rows.length <= 1 || !global.GBUI?.createModal || typeof global.document === 'undefined') {
      return _rowViewId(rows[0]);
    }
    return new Promise(resolve => {
      const body = global.document.createElement('div');
      const label = global.document.createElement('label');
      label.textContent = '表示するビュー';
      const select = global.document.createElement('select');
      select.className = 'gb-select'; select.setAttribute('aria-label', '移動先のビュー');
      rows.forEach((row, index) => {
        const option = global.document.createElement('option');
        option.value = _rowViewId(row);
        option.textContent = String(row.name || row.label || row.title || `ビュー ${index + 1}`);
        select.appendChild(option);
      });
      label.appendChild(select); body.appendChild(label);
      const choose = global.document.createElement('button');
      choose.type = 'button'; choose.className = 'gb-btn gb-btn-primary'; choose.textContent = 'このビューを選択';
      const cancel = global.document.createElement('button');
      cancel.type = 'button'; cancel.className = 'gb-btn'; cancel.textContent = 'キャンセル';
      let settled = false;
      const modal = global.GBUI.createModal({
        id: 'meldex-topic-target-view', title: '移動先のビュー', body,
        footer: [cancel, choose], variant: 'mobile-sheet',
        onClose: () => { if (!settled) resolve(''); },
      });
      const finish = value => { settled = true; modal.close('submit'); resolve(value); };
      choose.addEventListener('click', () => finish(select.value));
      cancel.addEventListener('click', () => finish(''));
      modal.open();
    });
  }

  async function _blockFrom(viewDocument, resourceType, selection, archiveRelativePath, preferredViewId) {
    const viewId = await _chooseViewId(viewDocument, resourceType, preferredViewId);
    if (!viewDocument?.documentId || !viewId) {
      throw new Error('選択した項目には埋め込み可能なビューがありません');
    }
    const logicalPath = _logicalPath(selection);
    const openType = resourceType === 'sheet' ? 'pivot' : 'board';
    const title = String(selection?.name || _leaf(logicalPath));
    return {
      schemaVersion: 1,
      blockId: global.crypto?.randomUUID?.() || ('embed-' + Date.now().toString(36)),
      resourceType,
      sourceId: String(selection.sourceId),
      documentId: String(viewDocument.documentId),
      viewId,
      legacyPath: logicalPath,
      dbPath: resourceType === 'sheet' ? logicalPath : undefined,
      boardPath: resourceType === 'board' ? logicalPath : undefined,
      archiveRelativePath: String(archiveRelativePath || ''),
      display: { header: 'compact', height: 420, interaction: 'editable' },
      fallback: {
        title,
        openUri: '/?open=' + encodeURIComponent(openType) + '&path=' + encodeURIComponent(logicalPath),
      },
    };
  }

  async function resolveSelection(selection, resourceType) {
    if (!TYPES[resourceType]) throw new Error('選択できるのはシートまたはボードです');
    if (!selection?.sourceId) throw new Error('ソースフォルダ内の項目を選択してください');
    const relativePath = _relativePath(selection);
    if (!relativePath) throw new Error('選択した項目のソース内相対パスを確認できません');
    if (/\.mel-(?:sheet|board)$/i.test(relativePath)) {
      try {
        const opened = await _post('/topic-views/migration/open', {
          sourceId: selection.sourceId, relativePath,
        });
        if (opened?.viewDocument) {
          return await _blockFrom(opened.viewDocument, resourceType, selection, relativePath,
            selection?.viewId || selection?.currentViewId);
        }
      } catch (_) {
        // Legacy JSON files used the same suffix; the additive migration below is authoritative.
      }
    }
    const migrated = await _post('/topic-migrations/open', {
      sourceId: selection.sourceId, relativePath,
    });
    const migration = migrated?.migration;
    const document = migration?.viewDocument;
    const archiveRelativePath = migration?.archiveRelativePath;
    if (!document || !archiveRelativePath) throw new Error('ビュー参照の作成結果を確認できません');
    const registered = await _post('/topic-views/migration/open', {
      sourceId: selection.sourceId, relativePath: archiveRelativePath, legacyPath: relativePath,
    });
    const verified = registered?.viewDocument;
    if (!verified || verified.documentId !== document.documentId) {
      throw new Error('作成したビューの読み戻し確認に失敗しました');
    }
    return _blockFrom(verified, resourceType, selection, archiveRelativePath,
      selection?.viewId || selection?.currentViewId);
  }

  async function _selectionForPath(path) {
    const normalized = String(path || '').replace(/\\/g, '/');
    const roots = await global.GBFolderPicker?.loadRoots?.({ includeHome: false, includeSources: true });
    const matched = (roots || []).find((root) => {
      const rootPath = String(root.rootPath || root.path || '').replace(/\\/g, '/').replace(/\/+$/, '');
      const rootName = String(root.name || _leaf(rootPath));
      return normalized === rootPath || normalized.startsWith(rootPath + '/')
        || normalized === rootName || normalized.startsWith(rootName + '/');
    });
    if (!matched) throw new Error('項目のソースフォルダを確認できません');
    const rootPath = String(matched.rootPath || matched.path).replace(/\\/g, '/').replace(/\/+$/, '');
    const rootName = String(matched.name || _leaf(rootPath));
    const absolute = normalized === rootName || normalized.startsWith(rootName + '/')
      ? rootPath + normalized.slice(rootName.length) : normalized;
    return {
      path: absolute, name: _leaf(normalized), rootPath,
      rootName, rootKind: 'source', sourceId: matched.sourceId || '', kind: 'file',
    };
  }

  async function resolveTransferPayload(payload) {
    if (payload?.kind !== 'meldex-topic-view-selection-v1') return null;
    const selection = await _selectionForPath(payload.path);
    selection.name = payload.label || selection.name;
    try {
      return await resolveSelection(selection, payload.resourceType);
    } catch (error) {
      global.showStatus?.(String(error?.message || error), true);
      return null;
    }
  }

  async function openExisting(resourceType, current) {
    if (!global.GBFolderPicker?.pickFolder) throw new Error('項目選択を開けません');
    const selection = await global.GBFolderPicker.pickFolder({
      title: resourceType === 'sheet' ? '埋め込むシートを選択' : '埋め込むボードを選択',
      selectFiles: true, fileTypes: TYPES[resourceType], includeHome: false,
      includeSources: true, includeWorkspaces: false,
      initialPath: current?.legacyPath || '', emptyText: '選択できる項目がありません。',
    });
    if (!selection) return null;
    return resolveSelection(selection, resourceType);
  }

  async function requestCreate(resourceType) {
    const folder = await global.GBFolderPicker?.pickFolder?.({
      title: '作成先フォルダを選択', includeHome: false, includeSources: true,
      includeWorkspaces: false,
    });
    if (!folder) return null;
    const type = resourceType === 'sheet' ? 'database' : 'board';
    const parentPath = _logicalPath(folder);
    const event = new CustomEvent('meldex-note-request-create-view', {
      cancelable: true,
      detail: { resourceType, type, parentPath, select: (selection) => resolveSelection(selection, resourceType) },
    });
    global.dispatchEvent(event);
    if (!event.defaultPrevented && typeof global.addItemAt === 'function') {
      await global.addItemAt(parentPath, type);
      global.showStatus?.('作成した項目をフォルダツリーで確認してから、もう一度「既存から選択」で指定してください');
    }
    return null;
  }

  function _choice(resourceType) {
    if (!global.GBUI?.createModal || typeof document === 'undefined') {
      return Promise.resolve('existing');
    }
    return new Promise((resolve) => {
      const body = document.createElement('div');
      const help = document.createElement('p');
      help.textContent = '既存の項目を選ぶか、新しい項目を作成します。元のファイルは変更・削除されません。';
      body.appendChild(help);
      const existing = document.createElement('button'); existing.type = 'button';
      existing.className = 'gb-btn gb-btn-primary'; existing.textContent = '既存から選択';
      const create = document.createElement('button'); create.type = 'button';
      create.className = 'gb-btn'; create.textContent = resourceType === 'sheet' ? '新しいシートを作成' : '新しいボードを作成';
      let settled = false;
      const modal = global.GBUI.createModal({
        id: 'meldex-topic-view-picker-choice', title: '埋め込むビュー', body,
        footer: [existing, create], variant: 'mobile-sheet',
        onClose: () => { if (!settled) resolve(null); },
      });
      const finish = (value) => { settled = true; modal.close('submit'); resolve(value); };
      existing.addEventListener('click', () => finish('existing'));
      create.addEventListener('click', () => finish('create'));
      modal.open();
    });
  }

  async function open(options) {
    const resourceType = options?.resourceType;
    const choice = await _choice(resourceType);
    if (choice === 'create') return requestCreate(resourceType);
    if (choice !== 'existing') return null;
    try { return await openExisting(resourceType, options?.current); }
    catch (error) { global.showStatus?.(String(error?.message || error), true); return null; }
  }

  function transferPayloadForNode(node) {
    const resourceType = node?.type === 'database' ? 'sheet'
      : node?.type === 'board' ? 'board' : '';
    if (!resourceType || !node?.path) return null;
    return { kind: 'meldex-topic-view-selection-v1', resourceType, path: node.path, label: node.name || _leaf(node.path) };
  }

  function _bindDragSource() {
    document.addEventListener('dragstart', (event) => {
      const node = event.target?.closest?.('.tree-node')?._nodeData;
      const payload = transferPayloadForNode(node);
      if (payload && event.dataTransfer) event.dataTransfer.setData(MIME, JSON.stringify(payload));
    }, true);
  }

  if (typeof document !== 'undefined') _bindDragSource();
  global.MeldexTopicViewPicker = {
    MIME, open, openExisting, requestCreate, resolveSelection, resolveTransferPayload,
    transferPayloadForNode, relativePath: _relativePath, blockFromDocument: _blockFrom,
  };
})(typeof window !== 'undefined' ? window : globalThis);
