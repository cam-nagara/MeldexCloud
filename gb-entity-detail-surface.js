/* Shared editable entity detail surface for main and right-sidebar panels. */
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

  function firstPropertyValue(data, name) {
    const values = data?.properties?.[name];
    for (const item of Array.isArray(values) ? values : []) {
      const value = String(item?.value ?? item ?? '').trim();
      if (value) return value;
    }
    return '';
  }

  function htmlSnapshotPath(data) {
    const path = firstPropertyValue(data, 'HTML');
    return /\.html?(?:$|[?#])/i.test(path) ? path.replace(/\\/g, '/') : '';
  }

  function fileRawUrl(path) {
    if (/^(?:https?:|data:|blob:|\/api\/)/i.test(path)) return path;
    return window.MeldexResourceUrl?.fileRaw?.(path, {static_preview: 1}) || '/api/file-raw?path=' + encodeURIComponent(path) + '&static_preview=1';
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

  function stripIds(root, surface) {
    root.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    // DOM の id は同時表示面で重複できないため除去する。一方 data-e2e-id は
    // 表示面をまたぐ製品契約であり、呼び出し側が各 surface の root 内へ
    // スコープして参照する。ここで接頭辞を付けると、右サイドバーだけ
    // プロパティ・リンクファイル・作成操作を特定できなくなる。
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
    if (document.body?.dataset?.cloudQuotaBlocked === '1') {
      return { readOnly: true, reason: '容量上限のため編集できません' };
    }
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
      staticContent: false,
      attachmentRefreshSeq: 0,
      titleSaving: null,
      titleFailed: false,
    };

    async function save() {
      if (state.disposed) return false;
      if (state.saving && !await state.saving.catch(() => false)) return false;
      if (state.staticContent || !state.dirty) return true;
      if (!state.editor || state.root.dataset.readOnly === '1') return state.root.dataset.readOnly === '1';
      clearTimeout(state.timer);
      state.timer = 0;
      const savingSeq = state.changeSeq;
      const markdown = typeof htmlToMd === 'function' ? htmlToMd(state.editor.innerHTML) : state.editor.textContent;
      state.saving = Promise.resolve(_saveEntityFreeText(
        state.editor,
        state.path,
        markdown,
        { reason: 'entity-detail-surface' },
      ))
        .then(saved => {
          if (saved) {
            if (state.data && state.editor?.dataset.lastSavedRevision) {
              state.data.revision = Number(state.editor.dataset.lastSavedRevision);
              state.data.page_content = state.editor.dataset.lastSavedMd || '';
            }
            if (state.changeSeq === savingSeq) state.dirty = false;
          }
          return !!saved;
        })
        .finally(() => { state.saving = null; });
      return state.saving;
    }

    async function flush() {
      clearTimeout(state.timer);
      state.timer = 0;
      if (state.saving) await state.saving.catch(() => {});
      if (state.titleSaving && !await state.titleSaving) return false;
      if (state.titleFailed) return false;
      const links = root.querySelector('.meldex-entity-attachments-section');
      if (links?._linkedFiles && !await links._linkedFiles.flush()) return false;
      if (state.defaultForm && !await state.defaultForm.flush()) return false;
      return save();
    }

    async function dispose() {
      if (state.disposed) return true;
      if (!await flush().catch(() => false)) return false;
      if (await root.querySelector('.meldex-entity-attachments-section')?._linkedFiles?.dispose?.() === false) return false;
      state.disposed = true;
      clearTimeout(state.timer);
      if (root._meldexEntityDetailController === controller) delete root._meldexEntityDetailController;
      return true;
    }

    async function refreshAttachmentsOnly(selectedId) {
      const refreshSeq = ++state.attachmentRefreshSeq;
      try {
        const refreshed = await apiFetch('/entity?path=' + encodeURIComponent(state.path), { silentError: true });
        if (state.disposed || root.dataset.meldexEntityDetail !== id || refreshSeq !== state.attachmentRefreshSeq) {
          return false;
        }
        const currentSection = root.querySelector('.meldex-entity-attachments-section');
        if (!currentSection
          || typeof MeldexSheetEntryAttachments === 'undefined'
          || typeof MeldexSheetEntryAttachments.renderEntryAttachmentsSection !== 'function') {
          return false;
        }
        if (currentSection._linkedFiles && !await currentSection._linkedFiles.dispose()) return false;
        const nextSectionData = {
          ...(state.data || {}),
          entry_attachments: Array.isArray(refreshed?.entry_attachments) ? refreshed.entry_attachments : [],
          revision: refreshed?.revision ?? state.data?.revision,
        };
        const staging = document.createElement('div');
        MeldexSheetEntryAttachments.renderEntryAttachmentsSection(staging, nextSectionData, state.path, {
          readOnly: root.dataset.readOnly === '1',
          surface: state.surface,
          onReload: refreshAttachmentsOnly,
          beforeMutation: flush,
          selectedId: typeof selectedId === 'string' ? selectedId : currentSection.dataset.selectedAttachment,
        });
        if (state.disposed || root.dataset.meldexEntityDetail !== id || refreshSeq !== state.attachmentRefreshSeq) {
          return false;
        }
        const nextSection = staging.firstElementChild;
        if (!nextSection) return false;
        currentSection.replaceWith(nextSection);
        // 添付操作でもエントリrevisionは進む。ただし別端末が本文を更新していた
        // 場合まで本文側のCAS基準を進めると、その変更を次回保存で上書きできて
        // しまう。取得本文が現在の保存済みbaselineと一致し、保存処理も進行中で
        // ない時だけ、添付操作によるrevision更新として追随する。
        const bodyBaselineUnchanged = !state.saving
          && refreshed?.page_content != null
          && String(refreshed.page_content) === String(state.editor?.dataset.lastSavedMd || '');
        state.data = {
          ...(state.data || {}),
          entry_attachments: nextSectionData.entry_attachments,
          ...(bodyBaselineUnchanged && refreshed?.revision != null ? { revision: refreshed.revision } : {}),
          ...(bodyBaselineUnchanged && refreshed?.freetext_etag ? { freetext_etag: refreshed.freetext_etag } : {}),
        };
        if (bodyBaselineUnchanged && state.editor && refreshed?.revision != null) {
          state.editor.dataset.lastSavedRevision = String(refreshed.revision);
        }
        if (bodyBaselineUnchanged && state.editor && refreshed?.freetext_etag) {
          state.editor.dataset.lastSavedEtag = String(refreshed.freetext_etag);
        }
        if (typeof replaceIcons === 'function') replaceIcons();
        return true;
      } catch (error) {
        if (!state.disposed && root.dataset.meldexEntityDetail === id && typeof showStatus === 'function') {
          showStatus('リンク一覧を再読み込みできませんでした: ' + (error?.userMessage || error?.message || error), true);
        }
        return false;
      }
    }

    async function render() {
      // 全面再描画を開始した時点で、旧DOM向けの添付一覧応答を無効化する。
      state.attachmentRefreshSeq += 1;
      root.dataset.meldexEntityDetail = id;
      root.dataset.surface = state.surface;
      root.dataset.path = state.path;
      root.replaceChildren();
      const loading = document.createElement('div');
      loading.className = 'meldex-entity-detail-loading';
      loading.textContent = 'トピックを読み込み中...';
      root.appendChild(loading);

      const parent = parentDir(state.path);
      const [data, meta, access] = await Promise.all([
        state.data || apiFetch('/entity?path=' + encodeURIComponent(state.path)),
        parent ? apiFetch('/db-metadata?include_form=true&path=' + encodeURIComponent(parent), { silentError: true }).catch(() => null) : null,
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
        parentButton.dataset.e2eId = 'entity-detail-parent-link';
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
      title.dataset.e2eId = 'entity-detail-title';
      title.contentEditable = access.readOnly ? 'false' : 'plaintext-only';
      title.setAttribute('role', 'textbox');
      title.setAttribute('aria-label', 'トピック名');
      title.setAttribute('aria-multiline', 'false');
      let savedTitle = title.textContent;
      let cancellingTitle = false;
      title.addEventListener('keydown', event => {
        if (event.isComposing) return;
        if (event.key === 'Enter' || event.key === 'Escape') {
          event.preventDefault();
          if (event.key === 'Escape') { cancellingTitle = true; title.textContent = savedTitle; state.titleFailed = false; }
          title.blur();
        }
      });
      title.addEventListener('blur', () => {
        const next = title.textContent.replace(/[\r\n]+/g, ' ').trim();
        if (cancellingTitle || !next || next === savedTitle || root.dataset.readOnly === '1') {
          cancellingTitle = false;
          state.titleFailed = false;
          title.textContent = savedTitle;
          return;
        }
        title.contentEditable = 'false';
        state.titleFailed = false;
        state.titleSaving = (async () => {
          try {
            if (!await save()) throw new Error('本文を保存できませんでした');
            const renamed = await window.GbDbEntryIdentity.rename({
              path: state.path, dbPath: parent, oldName: savedTitle, newName: next,
              entryId: state.data?.entry_id || state.data?.id, ctx: options.ctx,
            });
            if (renamed?.ok === false) throw new Error('名前を変更できませんでした');
            savedTitle = next;
            state.data.entity = next;
            // 表示名変更は同じ論理パス・IDを維持する。保存基準だけ取り直す。
            await refreshAttachmentsOnly();
            return true;
          } catch (error) {
            state.titleFailed = true;
            if (typeof showStatus === 'function') showStatus('トピック名の保存に失敗しました: ' + (error.userMessage || error.message || error), true);
            return false;
          } finally {
            title.textContent = state.titleFailed ? next : savedTitle;
            title.contentEditable = root.dataset.readOnly === '1' ? 'false' : 'plaintext-only';
            state.titleSaving = null;
          }
        })();
      });
      if (state.surface === 'main') title.id = 'entity-title';
      root.appendChild(title);

      const actions = document.createElement('div');
      actions.className = 'meldex-entity-detail-actions';
      if (state.surface === 'main') actions.id = 'entity-create-note-btn';
      // 旧・専用コピー用ボタンは廃止した（シート表示・ビュー状態・エントリ操作の改善計画
      // 2026-08-04）。列一覧内の文字選択に応じたコピーポップアップ（gb-entity-props-selection.js）
      // に置き換わったため、専用ボタンは不要になった。
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
      if (actions.childElementCount) root.appendChild(actions);

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
          ctx: options.ctx,
        });
      }

      state.defaultForm = await window.MeldexSheetDefaultForm?.mount(grid, data, state.path, meta, {
        parentDb: parent, readOnly: access.readOnly, ctx: options.ctx, beforeWrite: save, onRevision: revision => {
          if (state.editor && !state.dirty && !state.saving
            && String(data.page_content || '') === (state.editor.dataset.lastSavedMd || '')) {
            state.editor.dataset.lastSavedRevision = String(revision);
          }
        },
      });
      if (state.disposed || root.dataset.meldexEntityDetail !== id) return false;

      if (typeof MeldexSheetEntryAttachments !== 'undefined' && typeof MeldexSheetEntryAttachments.renderEntryAttachmentsSection === 'function') {
        MeldexSheetEntryAttachments.renderEntryAttachmentsSection(root, data, state.path, {
          readOnly: access.readOnly,
          surface: state.surface,
          onReload: refreshAttachmentsOnly,
          beforeMutation: flush,
        });
      }

      const snapshotPath = htmlSnapshotPath(data);

      if (snapshotPath) {
        state.staticContent = true;
        const preview = document.createElement('section');
        preview.className = 'meldex-entity-detail-webclip';
        const previewBar = document.createElement('div');
        previewBar.className = 'meldex-entity-detail-webclip-toolbar';
        const previewLabel = document.createElement('span');
        previewLabel.textContent = 'HTMLスナップショット';
        const openSnapshot = document.createElement('a');
        openSnapshot.href = fileRawUrl(snapshotPath);
        openSnapshot.target = '_blank';
        openSnapshot.rel = 'noopener noreferrer';
        openSnapshot.dataset.meldexBrowserNavigation = '1';
        openSnapshot.textContent = '別画面で開く';
        const frame = document.createElement('iframe');
        frame.className = 'meldex-entity-detail-webclip-frame';
        frame.title = '保存したHTML';
        frame.src = fileRawUrl(snapshotPath);
        frame.setAttribute('sandbox', 'allow-same-origin allow-popups');
        previewBar.append(previewLabel, openSnapshot);
        preview.append(previewBar, frame);
        root.appendChild(preview);
        applyReadOnly(root, true, access.reason || '保存したHTMLを表示しています');
        if (state.surface !== 'main') stripIds(root, state.surface);
        delete root.dataset.loadFailed;
        return true;
      }

      const raw = String(data?.page_content || '');
      // 旧トピックの本文は保全する。空のトピックには暗黙のノートを作らない。
      if (!raw.trim()) {
        if (state.surface !== 'main') stripIds(root, state.surface);
        applyReadOnly(root, access.readOnly, access.reason);
        delete root.dataset.loadFailed;
        if (typeof replaceIcons === 'function') replaceIcons();
        return true;
      }
      const editor = document.createElement('div');
      editor.className = 'meldex-entity-detail-editor';
      editor.dataset.e2eId = 'entity-detail-editor';
      if (state.surface === 'main') editor.id = 'entity-freetext';
      editor.setAttribute('contenteditable', access.readOnly ? 'false' : 'true');
      editor.dataset.entityPath = state.path;
      editor.dataset.lastSavedMd = raw;
      editor.dataset.lastSavedRevision = (data?.revision != null) ? String(data.revision) : '';
      editor.dataset.lastSavedEtag = data?.freetext_etag || '';
      editor.dataset.lastSavedTransportRevision = '';
      editor.innerHTML = raw.trim() && typeof mdToHtml === 'function'
        ? (typeof applyAutoLinks === 'function' ? applyAutoLinks(mdToHtml(raw, { basePath: state.path }), state.path) : mdToHtml(raw))
        : '';
      // 旧クイックメモの自動見出しは表示だけ隠す。保存原文は保持する。
      if (data.quick_memo_legacy_title === true && /^# [^\r\n]+(?:\r?\n|$)/.test(raw)) {
        const heading = editor.firstElementChild;
        if (heading?.tagName === 'H1') heading.hidden = true;
      }
      state.editor = editor;
      if (typeof _bindEntityFreeTextParticipant === 'function') {
        _bindEntityFreeTextParticipant(editor, state.path);
      }
      const toolbar = buildToolbar(editor);
      if (state.surface === 'main') toolbar.id = 'entity-rt-toolbar';
      root.appendChild(toolbar);
      root.appendChild(editor);

      // 新規ファイル作成は「ファイルを追加」メニューへ集約する。

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
            if (typeof showStatus === 'function') showStatus('トピック本文の自動保存に失敗しました', true);
          });
        }, 2000);
      });
      editor.addEventListener('blur', () => {
        flush().then(saved => {
          if (saved && typeof showStatus === 'function') showStatus('トピック本文を保存しました', false, { passiveSave: true });
        }).catch(() => {
          if (typeof showStatus === 'function') showStatus('トピック本文の保存に失敗しました', true);
        });
      });

      if (state.surface !== 'main') stripIds(root, state.surface);
      applyReadOnly(root, access.readOnly, access.reason);
      delete root.dataset.loadFailed;
      if (typeof replaceIcons === 'function') replaceIcons();
      return true;
    }

    async function rerender() {
      try {
        if (!await flush()) return false;
        const refreshed = await apiFetch('/entity?path=' + encodeURIComponent(state.path));
        if (await root.querySelector('.meldex-entity-attachments-section')?._linkedFiles?.dispose?.() === false) return false;
        state.data = refreshed;
        return render();
      } catch (error) {
        if (typeof showStatus === 'function') showStatus('トピックを再表示できませんでした: ' + (error.userMessage || error.message || error), true);
        return false;
      }
    }
    const controller = { get editor() { return state.editor; }, flush, dispose, rerender, ready: null };
    controller.ready = Promise.resolve(previousDispose).catch(() => false).then(saved => {
      if (saved === false) return false;
      root._meldexEntityDetailController = controller;
      return render();
    }).catch(error => {
      if (!state.disposed) {
        root.replaceChildren();
        root.dataset.loadFailed = '1';
        const message = document.createElement('div');
        message.className = 'meldex-entity-detail-loading';
        message.textContent = 'トピックを読み込めませんでした';
        root.appendChild(message);
      }
      console.error('[entity-detail] render failed', error);
      return false;
    });
    return controller;
  }

  // 直接エントリを描画するCloudモバイル経路も、同じ閲覧専用・編集ロック判定を
  // 再利用できるよう公開する。判定の二重実装を作らない。
  window.MeldexEntityDetail = { mount, resolveReadOnly };
})();
