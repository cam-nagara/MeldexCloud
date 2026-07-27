/* Shared editable entity detail surface for main, right-sidebar, and float panels. */
(function () {
  'use strict';

  let instanceSeq = 0;

  function parentDir(path) {
    return String(path || '').replace(/\\/g, '/').replace(/\/[^/]+$/, '');
  }

  function entityName(data, path) {
    return data?.entity || String(path || '').split(/[\\/]/).pop()?.replace(/\.md$/i, '') || '';
  }

  function xPostId(data) {
    const direct = String(data?.post_id || '').trim();
    if (direct) return direct;
    const values = data?.properties?.['ポストID'];
    for (const item of Array.isArray(values) ? values : []) {
      const value = String(item?.value ?? item ?? '').trim();
      if (value) return value;
    }
    return '';
  }

  function icon(name, size = 14) {
    return typeof lucide === 'function' ? lucide(name, size) : '';
  }

  function button(label, iconName, action, e2eId = '') {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'entity-create-action-btn meldex-entity-detail-action';
    el.dataset.e2eId = e2eId || ('entity-detail-action-' + iconName);
    el.setAttribute('aria-label', label);
    el.title = label;
    const iconBox = document.createElement('span');
    iconBox.className = 'entity-create-action-icon';
    iconBox.setAttribute('aria-hidden', 'true');
    iconBox.innerHTML = icon(iconName, 14);
    el.appendChild(iconBox);
    const text = document.createElement('span');
    text.className = 'entity-create-action-label';
    text.textContent = label;
    el.appendChild(text);
    el.addEventListener('click', action);
    return el;
  }

  function selectedTextInside(root) {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return '';
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return '';
    return selection.toString();
  }

  async function copyText(text) {
    if (!text) return false;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.readOnly = true;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  }

  function openChat(path) {
    if (typeof window.openEntityChatForPath === 'function') return window.openEntityChatForPath(path);
    if (typeof window.openEntityAiChat === 'function') return window.openEntityAiChat(path);
    if (typeof openFileChat === 'function') return openFileChat(path);
    if (typeof showStatus === 'function') showStatus('チャットを開けません', true);
  }

  function stripIds(root) {
    root.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
  }

  function applyReadOnly(root, readOnly, reason) {
    root.dataset.readOnly = readOnly ? '1' : '0';
    root.setAttribute('aria-readonly', readOnly ? 'true' : 'false');
    root.querySelectorAll('[contenteditable]').forEach(el => el.setAttribute('contenteditable', readOnly ? 'false' : 'true'));
    root.querySelectorAll('input, textarea, select').forEach(el => {
      if ('readOnly' in el) el.readOnly = readOnly;
      if (el.tagName === 'SELECT') el.disabled = readOnly;
    });
    root.querySelectorAll('button').forEach(el => {
      if (el.dataset.allowReadonly === '1') return;
      el.disabled = readOnly;
      if (readOnly) el.setAttribute('aria-disabled', 'true');
    });
    let notice = root.querySelector('.meldex-entity-detail-readonly');
    if (!readOnly) {
      notice?.remove();
      return;
    }
    if (!notice) {
      notice = document.createElement('div');
      notice.className = 'meldex-entity-detail-readonly';
      notice.setAttribute('role', 'status');
      root.prepend(notice);
    }
    notice.textContent = reason || '読み取り専用です';
  }

  async function resolveReadOnly(path, explicit) {
    if (explicit === true || document.body?.dataset?.cloudReadonly === '1') {
      return { readOnly: true, reason: '閲覧専用のため編集できません' };
    }
    try {
      const result = await apiFetch('/file-lock/check?path=' + encodeURIComponent(path), { silentError: true });
      if (result?.locked) {
        return {
          readOnly: true,
          reason: '編集ロック中' + (result.entry?.lock_reason ? '（' + result.entry.lock_reason + '）' : '') + 'です',
        };
      }
    } catch {}
    return { readOnly: !!explicit, reason: '' };
  }

  function formatButton(label, iconName, command, value) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'tb-icon-btn';
    el.dataset.e2eId = 'entity-detail-format-' + command;
    el.title = label;
    el.setAttribute('aria-label', label);
    el.innerHTML = icon(iconName, 15) || label;
    el.addEventListener('mousedown', event => event.preventDefault());
    el.addEventListener('click', () => document.execCommand(command, false, value || null));
    return el;
  }

  function buildToolbar(editor) {
    const toolbar = document.createElement('div');
    toolbar.className = 'gb-toolbar meldex-entity-detail-toolbar';
    [
      ['太字', 'bold', 'bold'],
      ['斜体', 'italic', 'italic'],
      ['下線', 'underline', 'underline'],
      ['箇条書き', 'list', 'insertUnorderedList'],
      ['番号付きリスト', 'listOrdered', 'insertOrderedList'],
    ].forEach(([label, iconName, command]) => toolbar.appendChild(formatButton(label, iconName, command)));
    const link = formatButton('リンク', 'link', 'createLink');
    link.addEventListener('click', event => {
      event.stopImmediatePropagation();
      const selection = window.getSelection?.();
      const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
      if (typeof showLinkInsertModal === 'function') {
        showLinkInsertModal(range);
      }
    }, true);
    toolbar.appendChild(link);
    toolbar.addEventListener('pointerdown', () => editor.focus(), true);
    return toolbar;
  }

  function mount(rootOrOptions, path, surface, readOnly) {
    const options = rootOrOptions?.nodeType
      ? { root: rootOrOptions, path, surface, readOnly }
      : (rootOrOptions || {});
    const root = options.root;
    if (!root || !options.path) {
      return { ready: Promise.resolve(false), flush: async () => false, dispose: async () => false };
    }
    const previousDispose = root._meldexEntityDetailController?.dispose?.();
    const id = 'entity-detail-' + (++instanceSeq);
    const state = {
      id,
      root,
      path: options.path,
      surface: options.surface || 'main',
      disposed: false,
      dirty: false,
      changeSeq: 0,
      timer: 0,
      saving: null,
      editor: null,
      data: options.data || null,
    };

    async function save() {
      if (state.disposed || !state.editor || state.root.dataset.readOnly === '1') return false;
      clearTimeout(state.timer);
      state.timer = 0;
      if (!state.dirty) return true;
      const savingSeq = state.changeSeq;
      const markdown = typeof htmlToMd === 'function' ? htmlToMd(state.editor.innerHTML) : state.editor.textContent;
      state.saving = Promise.resolve(_saveEntityFreeText(state.path, markdown))
        .then(saved => {
          if (saved && state.changeSeq === savingSeq) state.dirty = false;
          return !!saved;
        })
        .finally(() => { state.saving = null; });
      return state.saving;
    }

    async function flush() {
      clearTimeout(state.timer);
      state.timer = 0;
      if (state.saving) await state.saving.catch(() => {});
      return save();
    }

    async function dispose() {
      if (state.disposed) return true;
      await flush().catch(() => {});
      state.disposed = true;
      clearTimeout(state.timer);
      if (root._meldexEntityDetailController === controller) delete root._meldexEntityDetailController;
      return true;
    }

    async function render() {
      root.dataset.meldexEntityDetail = id;
      root.dataset.surface = state.surface;
      root.dataset.path = state.path;
      root.replaceChildren();
      const loading = document.createElement('div');
      loading.className = 'meldex-entity-detail-loading';
      loading.textContent = 'エントリを読み込み中...';
      root.appendChild(loading);

      const parent = parentDir(state.path);
      const [data, meta, access] = await Promise.all([
        state.data || apiFetch('/entity?path=' + encodeURIComponent(state.path)),
        options.propTypes
          ? Promise.resolve({ property_types: options.propTypes })
          : (parent ? apiFetch('/db-metadata?path=' + encodeURIComponent(parent), { silentError: true }).catch(() => null) : null),
        resolveReadOnly(state.path, options.readOnly),
      ]);
      if (state.disposed || root.dataset.meldexEntityDetail !== id) return false;
      state.data = data || {};
      root.replaceChildren();
      root.classList.add('meldex-entity-detail');

      if (options.showParent !== false && parent) {
        const parentButton = document.createElement('button');
        parentButton.type = 'button';
        parentButton.className = 'gb-subpanel-link-button meldex-entity-detail-parent';
        parentButton.dataset.e2eId = state.surface === 'float'
          ? 'gb-subpanel-entity-parent'
          : 'entity-detail-parent-link';
        parentButton.dataset.allowReadonly = '1';
        parentButton.textContent = '← ' + (parent.split('/').pop() || parent);
        parentButton.title = parent;
        parentButton.setAttribute('aria-label', '親シートを開く');
        parentButton.addEventListener('click', () => {
          if (typeof selectDatabase === 'function') selectDatabase(parent);
        });
        if (state.surface === 'main') parentButton.id = 'entity-parent-link';
        root.appendChild(parentButton);
      }

      const title = document.createElement('h2');
      title.className = 'meldex-entity-detail-title';
      title.textContent = entityName(data, state.path);
      if (state.surface === 'main') title.id = 'entity-title';
      root.appendChild(title);

      const actions = document.createElement('div');
      actions.className = 'meldex-entity-detail-actions';
      if (state.surface === 'main') actions.id = 'entity-create-note-btn';
      actions.appendChild(button('チャットを作成', 'messageSquare', () => openChat(state.path), 'entity-create-chat'));
      const copy = button('選択文字列をコピー', 'copy', async () => {
        const text = selectedTextInside(root) || state.editor?.innerText || '';
        const ok = await copyText(text).catch(() => false);
        if (typeof showStatus === 'function') showStatus(ok ? 'コピーしました' : 'コピーできませんでした', !ok);
      });
      copy.dataset.allowReadonly = '1';
      actions.appendChild(copy);
      const postId = xPostId(data);
      if (postId && typeof window.reimportXBookmarkPost === 'function') {
        actions.appendChild(button('Xからこのポストを再インポート', 'refreshCw', async () => {
          try {
            await flush();
            await window.reimportXBookmarkPost(postId);
            const refreshed = await apiFetch('/entity?path=' + encodeURIComponent(state.path), { silentError: true });
            if (!state.disposed) {
              state.data = refreshed;
              options.data = refreshed;
              await render();
            }
          } catch (error) {
            if (typeof showStatus === 'function') showStatus('再インポートに失敗: ' + (error?.userMessage || error?.message || error), true);
          }
        }));
      }
      root.appendChild(actions);

      const grid = document.createElement('div');
      grid.className = 'meldex-entity-detail-props';
      if (state.surface === 'main') grid.id = 'entity-props-grid';
      root.appendChild(grid);
      if (typeof renderEntityPropsGridInto === 'function') {
        renderEntityPropsGridInto(grid, data, state.path, {
          parentDb: parent,
          propTypes: meta?.property_types || options.propTypes || undefined,
          surface: state.surface,
          readOnly: access.readOnly,
        });
      }

      const raw = String(data?.page_content || '');
      const editor = document.createElement('div');
      editor.className = 'meldex-entity-detail-editor';
      editor.dataset.e2eId = 'entity-detail-editor';
      if (state.surface === 'main') editor.id = 'entity-freetext';
      editor.setAttribute('contenteditable', access.readOnly ? 'false' : 'true');
      editor.dataset.entityPath = state.path;
      editor.innerHTML = raw.trim() && typeof mdToHtml === 'function'
        ? (typeof applyAutoLinks === 'function' ? applyAutoLinks(mdToHtml(raw, { basePath: state.path }), state.path) : mdToHtml(raw))
        : '';
      state.editor = editor;
      const toolbar = buildToolbar(editor);
      if (state.surface === 'main') toolbar.id = 'entity-rt-toolbar';
      root.appendChild(toolbar);
      root.appendChild(editor);

      if (!raw.trim() && !access.readOnly) {
        editor.hidden = true;
        toolbar.hidden = true;
        const createNote = button('ノートを作成', 'filePlus', async () => {
          editor.hidden = false;
          toolbar.hidden = false;
          editor.innerHTML = '<p><br></p>';
          state.dirty = true;
          await flush();
          editor.focus();
          createNote.remove();
        }, 'entity-create-note');
        actions.insertBefore(createNote, actions.firstChild);
      }

      editor.addEventListener('click', event => {
        const link = event.target.closest?.('.auto-link');
        if (!link || typeof onAutoLinkClick !== 'function') return;
        event.preventDefault();
        onAutoLinkClick(link, event);
      });
      editor.addEventListener('input', () => {
        state.dirty = true;
        state.changeSeq += 1;
        clearTimeout(state.timer);
        state.timer = setTimeout(() => {
          save().catch(() => {
            if (typeof showStatus === 'function') showStatus('エントリ本文の自動保存に失敗しました', true);
          });
        }, 2000);
      });
      editor.addEventListener('blur', () => {
        flush().then(saved => {
          if (saved && typeof showStatus === 'function') showStatus('エントリ本文を保存しました', false, { passiveSave: true });
        }).catch(() => {
          if (typeof showStatus === 'function') showStatus('エントリ本文の保存に失敗しました', true);
        });
      });

      if (state.surface !== 'main') stripIds(root);
      applyReadOnly(root, access.readOnly, access.reason);
      if (typeof replaceIcons === 'function') replaceIcons();
      return true;
    }

    const controller = { get editor() { return state.editor; }, flush, dispose, ready: null };
    root._meldexEntityDetailController = controller;
    controller.ready = Promise.resolve(previousDispose).catch(() => false).then(render).catch(error => {
      if (!state.disposed) {
        root.replaceChildren();
        const message = document.createElement('div');
        message.className = 'meldex-entity-detail-loading';
        message.textContent = 'エントリを読み込めませんでした';
        root.appendChild(message);
      }
      console.error('[entity-detail] render failed', error);
      return false;
    });
    return controller;
  }

  window.MeldexEntityDetail = { mount };
})();
