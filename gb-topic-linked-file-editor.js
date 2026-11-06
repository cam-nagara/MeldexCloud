/* Editors owned by a topic's linked-file tabs; never redirect the main pane. */
(function () {
  'use strict';
  let sequence = 0;

  function mount(root, item, entryPath, options = {}) {
    const id = 'topic-link-' + (++sequence);
    let instance = null;
    let disposed = false;
    let flushEditor = async () => true;
    const cleanup = [];
    const ready = (async () => {
      const listing = await apiFetch('/sheet-entry/attachments?entry_path=' + encodeURIComponent(entryPath));
      const resolved = listing?.attachments?.find(value => value.id === item.id);
      const path = resolved?.client_path || item.path;
      const kind = item.kind;
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
      if (kind === 'sheet' || kind === 'database') {
        instance = window.MeldexProductionSheetEmbed.create({ idSuffix: id });
        instance.mount(root);
        flushEditor = async () => {
          // 新規行を保存してから、その行の改名・セル更新の完了を待つ。
          if (typeof waitForPendingDbEntityCreates === 'function') await waitForPendingDbEntityCreates(path);
          if (typeof waitForPendingDbValueMutations === 'function' && await waitForPendingDbValueMutations(path) === false) return false;
          if (typeof flushPendingDbPropertySettings === 'function') await flushPendingDbPropertySettings(path);
          if (typeof flushPendingDbViewConfigBackendSave === 'function') await flushPendingDbViewConfigBackendSave(path);
          return true;
        };
        return await instance.open(path);
      }
      if (kind === 'scenario' || kind === 'board') {
        const type = kind === 'scenario' ? 'scriptnote' : 'board';
        instance = createToolComponent(type, id, id, { embedded: true, interaction: access.readOnly ? 'read-only' : 'editable' });
        instance.state = { ...instance.state, [kind === 'scenario' ? 'scenarioPath' : 'boardPath']: path, label: item.name };
        instance._skipDetailSync = true;
        instance.mount(root);
        if (kind === 'scenario') {
          const loaded = await instance._loadScenario(path, {
            skipNavPush: true, skipRecent: true, skipSaveLastView: true, skipStatus: true, silent: true,
          });
          if (loaded === false) throw new Error('シナリオを読み込めませんでした');
        } else {
          instance.activate();
          if (instance._boardLoadPending && await instance._boardLoadPending === false) throw new Error('ボードを読み込めませんでした');
          // The Board engine has one active model. Retain this component's dump
          // before another surface takes it, and restore it before an edit.
          const remember = event => {
            if (!root.contains(event.target) && typeof bd !== 'undefined' && bd.path === path && typeof bdDumpState === 'function') {
              instance._bdDump = bdDumpState();
            }
          };
          const activate = () => {
            if (typeof bd !== 'undefined' && bd.path === path) instance._bdDump = null;
            instance.activate();
          };
          document.addEventListener('pointerdown', remember, true);
          root.addEventListener('pointerdown', activate, true);
          root.addEventListener('wheel', event => {
            activate();
            if (instance.onEmbeddedWheel?.({ mode: event.ctrlKey || event.metaKey ? 'zoom' : 'pan', deltaX: event.deltaX, deltaY: event.deltaY }, event)) {
              event.preventDefault(); event.stopPropagation();
            }
          }, { capture: true, passive: false });
          cleanup.push(() => document.removeEventListener('pointerdown', remember, true));
        }
        flushEditor = async () => {
          if (typeof instance.flush === 'function') return await instance.flush();
          if (typeof instance.flushPendingSave === 'function') return await instance.flushPendingSave();
          if (kind === 'board' && typeof bd !== 'undefined' && bd.path === path && bd.dirty) return await bdSave();
          return true;
        };
        return true;
      }
      if (kind === 'chat' || /(?:^|\/)\_chat\/llm\//.test(path)) {
        const chatEditor = await mountChat(root, path, access);
        flushEditor = chatEditor.flush;
        instance = chatEditor;
        return true;
      }
      if (kind === 'note' || /\.md$/i.test(path)) {
        const toolbar = document.createElement('div');
        toolbar.className = 'gb-toolbar meldex-entity-detail-toolbar';
        const editor = document.createElement('div');
        editor.className = 'meldex-entity-linked-note meldex-entity-detail-editor';
        editor.dataset.e2eId = 'entity-linked-note-editor';
        // 読込が終わるまで入力させない。非同期のopenPageが先行入力を上書きしないようにする。
        editor.contentEditable = 'false';
        for (const [label, command] of [['太字', 'bold'], ['斜体', 'italic'], ['箇条書き', 'insertUnorderedList']]) {
          const button = document.createElement('button');
          button.type = 'button'; button.textContent = label; button.disabled = true;
          button.addEventListener('mousedown', event => event.preventDefault());
          button.addEventListener('click', () => { editor.focus(); document.execCommand(command); });
          toolbar.appendChild(button);
        }
        root.append(toolbar, editor);
        const ok = await openPage(item.name, path, {
          containerEl: editor, skipShowView: true, skipGlobalUi: true, skipStateView: true,
          skipNavPush: true, skipSaveLastView: true, skipRecent: true, skipHighlight: true, skipHistoryScope: true,
        });
        editor.contentEditable = access.readOnly || ok === false ? 'false' : 'true';
        toolbar.querySelectorAll('button').forEach(button => { button.disabled = access.readOnly || ok === false; });
        flushEditor = async () => {
          if (access.readOnly) return true;
          await _runNoteAutoSave(editor);
          return !window.MeldexNoteSaveAdapter?.isConflictPending?.(path)
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
      activate: () => instance?.activate?.(),
      deactivate: () => instance?.deactivate?.(),
      dispose: async () => {
        await ready;
        try { if (await flushEditor() === false) return false; }
        catch (error) {
          if (typeof showStatus === 'function') showStatus('リンク先の保存に失敗しました: ' + (error.userMessage || error.message || error), true);
          return false;
        }
        disposed = true;
        cleanup.forEach(remove => remove());
        instance?.destroy?.({ skipFlush: true });
        return true;
      },
    };
  }

  async function mountChat(root, path, access) {
    // /chat/load supplies the canonical message model. Bind it to the same file
    // generation as /file so edits cannot overwrite a concurrent chat session.
    const file = await apiFetch('/file?path=' + encodeURIComponent(path));
    const source = String(path).replace(/\\/g, '/').match(/^(.+)\/_chat\/llm\//)?.[1] || '';
    const chat = await apiFetch('/chat/load?path=' + encodeURIComponent(path)
      + (/^(?:[a-z]:\/|\/)/i.test(source) ? '&source_folder=' + encodeURIComponent(source) : ''));
    const check = await apiFetch('/file?path=' + encodeURIComponent(path));
    if (file.etag !== check.etag) throw new Error('チャットが更新されました。タブを開き直してください');
    const messages = structuredClone(chat.messages || []);
    let baseline = file.content;
    let etag = file.etag;
    let dirty = false;
    let timer = 0;
    let saving = Promise.resolve(true);
    function serialize() {
      const match = baseline.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      if (!match) throw new Error('チャットのメタデータを読み取れません');
      const lines = match[1].split(/\r?\n/);
      const start = lines.findIndex(line => /^messages:/.test(line));
      if (start >= 0) {
        let end = start + 1;
        while (end < lines.length && !/^[^\s#-][^\r\n]*?:(?:\s|$)/.test(lines[end])) end += 1;
        lines.splice(start, end - start);
      }
      lines.push('messages: ' + JSON.stringify(messages));
      const body = messages.map(message => '## ' + (message.role === 'assistant' ? 'Assistant' : 'User') + '\n\n'
        + (Array.isArray(message.content) ? message.content.filter(part => part.type === 'text').map(part => part.text || '').join('\n') : message.content || '')).join('\n\n');
      return '---\n' + lines.join('\n') + '\n---\n\n' + body + '\n';
    }
    function flush() {
      clearTimeout(timer);
      saving = saving.catch(() => false).then(async () => {
        if (!dirty || access.readOnly) return true;
        const content = serialize();
        const result = await apiPut('/file?path=' + encodeURIComponent(path), { content, if_match_etag: etag });
        if (result?.ok === false || result?.missing || result?.skipped || !result?.etag) {
          throw new Error('チャットの保存を確認できませんでした。入力を保持しています');
        }
        baseline = content;
        etag = result.etag;
        if (serialize() === content) {
          dirty = false;
          await window.MeldexDraftRecovery?.markSynced?.(path, content);
        }
        return true;
      });
      return saving;
    }
    function schedule() {
      dirty = true;
      void window.MeldexDraftRecovery?.saveDraft?.(path, serialize(), baseline);
      clearTimeout(timer);
      timer = setTimeout(() => flush().catch(error => {
        if (typeof showStatus === 'function') showStatus('チャットの保存に失敗しました: ' + (error.userMessage || error.message || error), true);
      }), 1000);
    }
    const conversation = document.createElement('div');
    conversation.className = 'meldex-entity-linked-chat';
    function renderMessage(message) {
      const label = document.createElement('label');
      label.textContent = ({ assistant: 'アシスタント', user: 'ユーザー', system: 'システム', tool: 'ツール' })[message.role] || message.role;
      function textInput(value, update) {
        const input = document.createElement('textarea');
        input.value = String(value || ''); input.readOnly = access.readOnly;
        input.dataset.e2eId = 'entity-linked-chat-message';
        input.addEventListener('input', () => { update(input.value); schedule(); });
        input.addEventListener('blur', () => flush().catch(() => {}));
        label.appendChild(input);
      }
      if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === 'text') textInput(part.text, value => { part.text = value; });
          else {
            const attachment = document.createElement('div');
            attachment.textContent = part.name || part.filename || (part.type === 'image_url' ? '画像' : '添付ファイル');
            label.appendChild(attachment);
          }
        }
      } else textInput(message.content, value => { message.content = value; });
      conversation.appendChild(label);
    }
    messages.forEach(renderMessage);
    root.appendChild(conversation);
    if (!access.readOnly) {
      const add = document.createElement('button');
      add.type = 'button'; add.className = 'gb-btn'; add.textContent = 'メッセージを追加';
      add.dataset.action = 'add-message';
      add.addEventListener('click', () => {
        const message = { role: 'user', content: '', id: crypto.randomUUID() };
        messages.push(message); renderMessage(message); schedule();
        conversation.lastElementChild.querySelector('textarea').focus();
      });
      root.appendChild(add);
    }
    const beforeUnload = event => {
      if (!dirty) return;
      void window.MeldexDraftRecovery?.saveDraft?.(path, serialize(), baseline);
      void flush().catch(() => {});
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return { flush, destroy: () => { clearTimeout(timer); window.removeEventListener('beforeunload', beforeUnload); } };
  }
  window.MeldexTopicLinkedEditor = { mount };
})();
