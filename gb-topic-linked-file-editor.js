/* Editors owned by a topic's linked-file tabs; never redirect the main pane. */
(function () {
  'use strict';
  let sequence = 0;

  function mount(root, item, entryPath, options = {}) {
    const id = 'topic-link-' + (++sequence);
    let instance = null;
    let ownership = null;
    let disposed = false;
    let flushEditor = async () => true;
    const cleanup = [];
    const ready = (async () => {
      const listing = await apiFetch('/sheet-entry/attachments?entry_path=' + encodeURIComponent(entryPath));
      const resolved = listing?.attachments?.find(value => value.id === item.id);
      const path = resolved?.client_path || item.path;
      const kind = (!item.kind || item.kind === 'file') && /\.md$/i.test(path) ? 'note' : item.kind;
      const access = await window.MeldexEntityDetail.resolveReadOnly(path, options.readOnly);
      root.dataset.readOnly = access.readOnly ? '1' : '0';
      if (disposed) return false;
      if (access.readOnly) {
        const stop = event => { event.preventDefault(); event.stopImmediatePropagation(); };
        for (const type of ['beforeinput', 'paste', 'cut', 'drop', 'change']) root.addEventListener(type, stop, true);
        root.addEventListener('click', event => {
          if (event.target.closest('[data-allow-readonly="1"],[role="tab"]')) return;
          if (event.target.closest('button,input,select,textarea,[contenteditable="true"]')) stop(event);
        }, true);
        root.addEventListener('keydown', event => {
          if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Tab', 'Escape'].includes(event.key)
              && !((event.ctrlKey || event.metaKey) && ['c', 'a'].includes(event.key.toLowerCase()))) stop(event);
        }, true);
      }
      function bindHost(ctx, activate, syncDetail) {
        const kindName = ({ note: 'page', sheet: 'database', scenario: 'scriptnote' })[kind] || kind;
        ownership = window.GBEditorHost?.register(root, {
          editorId: id, path, kind: kindName, label: item.name,
          surface: options.surface || (root.closest('.gb-subpanel') ? 'subpanel' : 'main'),
          ctx, activate, syncDetail, flush: () => flushEditor(),
          component: instance,
          onPathRename: kindName === 'database' ? (oldPath, newPath) => instance.onPathRename?.(oldPath, newPath) : null,
          reload: async (reloadOptions = {}) => {
            if (!reloadOptions.skipFlush && await flushEditor() === false) return false;
            if (kindName === 'database') return instance.refresh();
            if (kindName === 'scriptnote') return instance._loadScenario(ownership.host.path, { skipNavPush: true, silent: true });
            if (kindName === 'board') return instance.reload();
            if (kindName === 'page') return openPage(item.name, ownership.host.path, { containerEl: root.querySelector('[data-editor-local-id=page-content]'),
              skipShowView: true, skipGlobalUi: true, skipStateView: true, skipNavPush: true, skipSaveLastView: true, skipRecent: true, skipHighlight: true, skipHistoryScope: true });
            return false;
          },
          historyScope: () => {
            const currentPath = ownership?.host.path || path;
            return kindName === 'scriptnote' ? instance?._editor?._historyScope?.() :
              kindName === 'database' && typeof _dbViewConfigHistoryScope === 'function' ? _dbViewConfigHistoryScope(currentPath) :
              kindName === 'board' && typeof _bdHistoryScope === 'function' ? _bdHistoryScope(currentPath) :
              (kindName === 'page' ? 'page:' : kindName === 'database' ? 'db:' : kindName + ':') + currentPath.replace(/^\/+/, '');
          },
        });
      }
      if (kind === 'chat' || kind === 'folder' || /(?:^|\/)\_chat\/llm\//.test(path)) {
        const notice = document.createElement('p');
        notice.textContent = 'この種類はトピック内での編集を終了しました。';
        const open = document.createElement('button');
        open.type = 'button'; open.className = 'gb-btn'; open.dataset.allowReadonly = '1';
        open.textContent = 'メインパネルで開く';
        open.addEventListener('click', () => window.MeldexSheetEntryAttachments.openAttachment(item, entryPath));
        root.append(notice, open);
        return true;
      }
      if (kind === 'sheet' || kind === 'database') {
        instance = window.MeldexProductionSheetEmbed.create({ idSuffix: id });
        const bar = window.GBEditorHost.toolbar('tb-db', id);
        root.appendChild(bar);
        instance.mount(root);
        root._dbPaneContext = instance.ctx;
        bar._dbPaneContext = instance.ctx;
        const title = bar.querySelector('[data-editor-local-id=toolbar-category]');
        if (title) title.textContent = item.name;
        bindHost(instance.ctx, null, null);
        flushEditor = async () => {
          const currentPath = ownership?.host.path || path;
          // 新規行を保存してから、その行の改名・セル更新の完了を待つ。
          if (typeof waitForPendingDbEntityCreates === 'function') await waitForPendingDbEntityCreates(currentPath);
          if (typeof waitForPendingDbValueMutations === 'function' && await waitForPendingDbValueMutations(currentPath) === false) return false;
          if (typeof flushPendingDbPropertySettings === 'function') await flushPendingDbPropertySettings(currentPath);
          if (typeof flushPendingDbViewConfigBackendSave === 'function') await flushPendingDbViewConfigBackendSave(currentPath);
          return true;
        };
        return await instance.open(path);
      }
      if (kind === 'scenario' || kind === 'board') {
        const type = kind === 'scenario' ? 'scriptnote' : 'board';
        instance = createToolComponent(type, id, id, { embedded: true, interaction: access.readOnly ? 'read-only' : 'editable' });
        if (typeof setComponentInstance === 'function') setComponentInstance(id, instance);
        instance.state = { ...instance.state, [kind === 'scenario' ? 'scenarioPath' : 'boardPath']: path, label: item.name };
        instance._skipDetailSync = true;
        instance.mount(root);
        if (typeof replaceIcons === 'function') replaceIcons(instance.el);
        bindHost(null, () => instance.activate(), () => instance._syncDetailPanel?.());
        if (kind === 'scenario') {
          const loaded = await instance._loadScenario(path, {
            skipNavPush: true, skipRecent: true, skipSaveLastView: true, skipStatus: true, silent: true,
          });
          if (loaded === false) throw new Error('シナリオを読み込めませんでした');
        } else {
          instance.activate();
          if (instance._boardLoadPending && await instance._boardLoadPending === false) throw new Error('ボードを読み込めませんでした');
          // CanvasComponent owns the shared runtime handoff and per-editor dump.
          root.addEventListener('wheel', event => {
            ownership?.activate();
            if (instance.onEmbeddedWheel?.({ mode: event.ctrlKey || event.metaKey ? 'zoom' : 'pan', deltaX: event.deltaX, deltaY: event.deltaY }, event)) {
              event.preventDefault(); event.stopPropagation();
            }
          }, { capture: true, passive: false });
        }
        flushEditor = async () => {
          if (typeof instance.flush === 'function') return await instance.flush();
          if (typeof instance.flushPendingSave === 'function') return await instance.flushPendingSave();
          if (kind === 'board' && typeof bd !== 'undefined') {
            const ownsRuntime = typeof CanvasComponent !== 'undefined' && CanvasComponent._runtimeOwner === instance;
            if (!ownsRuntime && !instance._bdDump?.bd?.dirty) return true;
            if (ownsRuntime && !bd.dirty) return true;
            instance.activate();
            if (bd.dirty) return await bdSave();
          }
          return true;
        };
        return true;
      }
      if (kind === 'note' || /\.md$/i.test(path)) {
        const toolbar = window.GBEditorHost.toolbar('page-rt-toolbar', id);
        const title = toolbar.querySelector('[data-editor-local-id=page-title]');
        if (title) { title.textContent = item.name; title.contentEditable = access.readOnly ? 'false' : 'true'; }
        const editor = document.createElement('div');
        editor.className = 'meldex-entity-linked-note meldex-entity-detail-editor';
        editor.dataset.editorLocalId = 'page-content';
        editor.dataset.e2eId = 'entity-linked-note-editor';
        editor.contentEditable = 'false';
        const ctx = { paneId: id, pagePath: path, viewMode: 'page', containerEl: root, strictRoot: true };
        bindHost(ctx, null, null);
        if (title && typeof initPageTitle === 'function') initPageTitle(title, {
          getPath: () => ctx.pagePath,
          onRenamed: ({ newPath, label, result }) => {
            const oldPath = ctx.pagePath;
            ctx.pagePath = newPath;
            editor.dataset.path = newPath;
            if (ownership) { ownership.host.path = newPath; ownership.host.label = label; }
            if (typeof renameAppPathReferences === 'function') renameAppPathReferences(oldPath, newPath, { label, etag: result.etag, titleOnly: !!result.title_only, type: 'page' });
          },
        });
        root.dataset.editorLocalId = 'page-view';
        const body = document.createElement('div'); body.className = 'note-editor-body';
        const toc = document.createElement('div'); toc.dataset.editorLocalId = 'note-toc'; toc.id = 'note-toc-' + id; toc.style.display = 'none';
        const resize = document.createElement('div'); resize.dataset.editorLocalId = 'note-toc-resize'; resize.id = 'note-toc-resize-' + id; resize.style.display = 'none';
        resize.setAttribute('role', 'separator'); resize.setAttribute('aria-label', '目次幅を調整'); resize.tabIndex = 0;
        body.append(toc, resize, editor);
        root.append(toolbar, body);
        if (typeof initNoteTocResize === 'function') initNoteTocResize(root);
        window.MeldexNoteStatusFilter?.bindButtons?.(root);
        const ok = await openPage(item.name, path, {
          containerEl: editor, skipShowView: true, skipGlobalUi: true, skipStateView: true,
          skipNavPush: true, skipSaveLastView: true, skipRecent: true, skipHighlight: true, skipHistoryScope: true,
        });
        editor.contentEditable = access.readOnly || ok === false ? 'false' : 'true';
        toolbar.querySelectorAll('button').forEach(button => { button.disabled = access.readOnly || ok === false; });
        flushEditor = async () => {
          if (access.readOnly) return true;
          await _runNoteAutoSave(editor);
          return !window.MeldexNoteSaveAdapter?.isConflictPending?.(ctx.pagePath)
            && window.MeldexNoteSaveAdapter.isUnchanged(editor, _noteMarkdownFromEditor(editor));
        };
        return ok;
      }
      if (kind === 'folder' && typeof openFolder === 'function') {
        return await openFolder(item.name, path, { containerEl: root, skipShowView: true, skipGlobalUi: true, skipNavPush: true, skipSaveLastView: true, skipHighlight: true, silent: true });
      }
      const media = document.createElement(/\.(mp4|webm|mov)$/i.test(path) ? 'video' : /\.(png|jpe?g|webp|gif|svg)$/i.test(path) ? 'img' : 'iframe');
      media.className = 'meldex-entity-linked-media';
      media.src = window.MeldexResourceUrl?.fileRaw?.(path) || '/api/file-raw?path=' + encodeURIComponent(path);
      media.title = item.name; media.alt = item.name;
      if (media.tagName === 'VIDEO') media.controls = true;
      if (media.tagName === 'IFRAME') media.setAttribute('sandbox', '');
      root.appendChild(media);
      return true;
    })().then(ok => {
      if (ok === false && !disposed) throw new Error('リンク先の表示に失敗しました');
      return ok;
    }).catch(error => {
      root.dataset.loadFailed = '1';
      const notice = document.createElement('div');
      notice.className = 'meldex-entity-detail-loading';
      notice.textContent = 'リンク先を読み込めませんでした: ' + (error.userMessage || error.message || error);
      root.appendChild(notice);
      const retry = document.createElement('button');
      retry.type = 'button'; retry.className = 'gb-btn'; retry.textContent = '再試行';
      retry.dataset.allowReadonly = '1';
      retry.addEventListener('click', () => {
        root.closest('.meldex-entity-attachments-section')?.querySelectorAll('[role="tab"]').forEach(tab => {
          if (tab.dataset.attachmentId === item.id) tab.click();
        });
      });
      root.appendChild(retry);
      return false;
    });
    return {
      ready,
      get failed() { return root.dataset.loadFailed === '1'; },
      flush: async () => { await ready; try { return await flushEditor() !== false; } catch (error) {
        if (typeof showStatus === 'function') showStatus('リンク先の保存に失敗しました: ' + (error.userMessage || error.message || error), true);
        return false;
      } },
      activate: () => { ownership?.activate(); instance?.activate?.(); },
      deactivate: () => instance?.deactivate?.(),
      dispose: async () => {
        await ready;
        try { if (await flushEditor() === false) return false; }
        catch (error) {
          if (typeof showStatus === 'function') showStatus('リンク先の保存に失敗しました: ' + (error.userMessage || error.message || error), true);
          return false;
        }
        disposed = true;
        ownership?.dispose();
        cleanup.forEach(remove => remove());
        if (instance && typeof getComponentInstance === 'function' && getComponentInstance(id) === instance) removeComponentInstance(id, { skipFlush: true });
        else instance?.destroy?.({ skipFlush: true });
        return true;
      },
    };
  }

  window.MeldexTopicLinkedEditor = { mount };
})();
