/* Add-tag/group dialog with lazy current-dictionary and external-catalog suggestions. */
(function () {
  'use strict';

  const SEARCH_DELAY_MS = 90;
  const JOB_POLL_MS = 350;
  let activeDialog = null;

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = String(text);
    return element;
  }

  function searchKey(value) {
    return String(value || '')
      .normalize('NFKC')
      .replaceAll('_', ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase();
  }

  function currentMatches(items, query) {
    const key = searchKey(query);
    if (!key) return [];
    return (Array.isArray(items) ? items : [])
      .map(item => {
        const keys = [item?.name, ...(item?.aliases || [])].map(searchKey).filter(Boolean);
        const prefix = keys.some(value => value.startsWith(key));
        const contains = keys.some(value => value.includes(key));
        return { item, rank: prefix ? 0 : contains ? 1 : 2 };
      })
      .filter(row => row.rank < 2)
      .sort((left, right) => (
        left.rank - right.rank
        || String(left.item?.name || '').localeCompare(String(right.item?.name || ''), 'ja')
      ))
      .slice(0, 12)
      .map(row => row.item);
  }

  function ensureStyles() {
    if (document.getElementById('tag-catalog-suggestions-style')) return;
    const style = document.createElement('style');
    style.id = 'tag-catalog-suggestions-style';
    style.textContent = `
      .tag-catalog-dialog{width:min(620px,calc(100vw - 24px));max-height:min(720px,calc(100dvh - 24px));display:flex;flex-direction:column;overflow:hidden}
      .tag-catalog-dialog .gb-confirm-input{min-height:44px;width:100%}
      .tag-catalog-results{min-height:72px;max-height:min(430px,48dvh);overflow:auto;margin-top:10px;border:1px solid var(--border,#3b3b3b);border-radius:10px;padding:6px}
      .tag-catalog-heading{font-size:.78rem;color:var(--text-secondary,#aaa);padding:7px 9px 4px}
      .tag-catalog-option{display:flex;width:100%;min-height:44px;align-items:center;justify-content:space-between;gap:12px;border:0;border-radius:8px;padding:8px 10px;background:transparent;color:inherit;text-align:left}
      .tag-catalog-option:hover,.tag-catalog-option[aria-selected="true"]{background:var(--bg-tertiary,#303030)}
      .tag-catalog-option-main{min-width:0}.tag-catalog-option-name{display:block;font-weight:600;overflow-wrap:anywhere}
      .tag-catalog-option-path{display:block;font-size:.78rem;color:var(--text-secondary,#aaa);overflow-wrap:anywhere}
      .tag-catalog-source{flex:0 0 auto;font-size:.72rem;border-radius:999px;padding:3px 7px;background:var(--bg-secondary,#262626)}
      .tag-catalog-status{min-height:24px;padding:6px 3px;color:var(--text-secondary,#aaa);font-size:.82rem}
      .tag-catalog-status[data-error="1"]{color:var(--danger,#e46b6b)}
      .tag-catalog-dialog .gb-confirm-actions{flex-wrap:wrap}.tag-catalog-dialog .gb-confirm-actions .gb-btn{min-height:44px}
      @media(max-width:640px){.tag-catalog-dialog{width:calc(100vw - 12px);max-height:calc(100dvh - 12px)}
        .tag-catalog-results{max-height:52dvh}.tag-catalog-option{align-items:flex-start}
        .tag-catalog-dialog .gb-confirm-actions{display:grid;grid-template-columns:1fr}
        .tag-catalog-dialog .gb-confirm-actions .gb-btn{width:100%}}
    `;
    document.head.append(style);
  }

  async function waitForJob(jobId, isCurrent) {
    for (let attempt = 0; attempt < 240 && isCurrent(); attempt += 1) {
      const job = await apiFetch(`/jobs/${encodeURIComponent(jobId)}`, { silentError: true });
      if (job?.status === 'done') return job;
      if (['error', 'cancelled'].includes(job?.status)) {
        throw new Error(job?.error || '外部タグカタログを準備できませんでした');
      }
      await new Promise(resolve => window.setTimeout(resolve, JOB_POLL_MS));
    }
    throw new Error('外部タグカタログの準備に時間がかかっています。入力し直すと再確認できます');
  }

  function open(options) {
    ensureStyles();
    activeDialog?.cancel?.();
    window.__MeldexTagCatalogSuggestionCancel?.();
    document
      .querySelectorAll('.tag-catalog-dialog [data-e2e-id="tag-catalog-cancel"]')
      .forEach(button => button.click());
    const kind = options?.kind === 'group' ? 'group' : 'tag';
    const label = kind === 'group' ? 'グループ' : 'タグ';
    const current = Array.isArray(options?.current) ? options.current : [];
    const sourceFolder = String(options?.sourceFolder || '');
    const defaultValue = String(options?.defaultValue || '');
    let revision = 0;
    let timer = 0;
    let composing = false;
    let preparedJobId = '';
    let externalItems = [];
    let externalHasMore = false;
    let externalNextOffset = 0;
    let existingItems = [];
    let rows = [];
    let activeIndex = -1;
    let settled = false;
    let cancelDialog = null;

    return new Promise(resolve => {
      const overlay = node('div', 'modal-overlay');
      overlay.style.zIndex = '310';
      const dialog = node('div', 'gb-confirm tag-catalog-dialog');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', `${label}を追加`);
      const title = node('div', 'gb-confirm-message', `${label}を追加`);
      const input = node('input', 'gb-confirm-input');
      input.type = 'text';
      input.value = defaultValue;
      input.placeholder = `${label}名を入力`;
      input.autocomplete = 'off';
      input.dataset.e2eId = 'tag-catalog-suggestion-input';
      const results = node('div', 'tag-catalog-results');
      results.setAttribute('role', 'listbox');
      const status = node('div', 'tag-catalog-status', '入力すると現在の辞書と外部カタログを検索します');
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      const actions = node('div', 'gb-confirm-actions');
      const cancel = node('button', 'gb-btn gb-btn-sm', 'キャンセル');
      cancel.type = 'button';
      cancel.dataset.e2eId = 'tag-catalog-cancel';
      const create = node('button', 'gb-btn gb-btn-sm gb-btn-primary', `この名前で${label}を追加`);
      create.type = 'button';
      create.dataset.e2eId = 'tag-catalog-create-custom';
      actions.append(cancel, create);
      dialog.append(title, input, results, status, actions);
      overlay.append(dialog);
      document.body.append(overlay);

      function finish(value) {
        if (settled) return;
        settled = true;
        revision += 1;
        window.clearTimeout(timer);
        overlay.remove();
        document.removeEventListener('keydown', onDocumentKey);
        if (activeDialog?.overlay === overlay) activeDialog = null;
        if (window.__MeldexTagCatalogSuggestionCancel === cancelDialog) {
          delete window.__MeldexTagCatalogSuggestionCancel;
        }
        options?.restoreFocus?.focus?.();
        resolve(value);
      }

      function setStatus(message, error) {
        status.textContent = String(message || '');
        status.dataset.error = error ? '1' : '0';
      }

      function choose(row) {
        if (!row) return;
        finish({ action: row.source === 'external' ? 'external' : 'existing', item: row });
      }

      function addSection(titleText, items, source) {
        if (!items.length) return;
        results.append(node('div', 'tag-catalog-heading', titleText));
        for (const item of items) {
          const row = { ...item, source };
          const button = node('button', 'tag-catalog-option');
          button.type = 'button';
          button.setAttribute('role', 'option');
          button.dataset.e2eId = `tag-catalog-option-${source}-${row.kind}-${row.catalog_id || row.id || ''}`;
          const description = String(row.description || row.definition?.description || '').trim();
          if (description) button.title = description;
          let holdTimer = 0;
          let describedByHold = false;
          const main = node('span', 'tag-catalog-option-main');
          main.append(
            node('span', 'tag-catalog-option-name', row.name),
            node(
              'span',
              'tag-catalog-option-path',
              row.group_path || (row.aliases?.length ? `別名: ${row.aliases.slice(0, 3).join('、')}` : ''),
            ),
          );
          button.append(
            main,
            node('span', 'tag-catalog-source', source === 'external' ? '外部カタログ' : '現在の辞書'),
          );
          button.addEventListener('pointerdown', event => {
            if (event.pointerType !== 'touch' || !description) return;
            describedByHold = false;
            holdTimer = window.setTimeout(() => {
              describedByHold = true;
              setStatus(description);
            }, 550);
          });
          ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => {
            button.addEventListener(type, () => window.clearTimeout(holdTimer));
          });
          button.addEventListener('click', event => {
            if (describedByHold) {
              event.preventDefault();
              describedByHold = false;
              return;
            }
            choose(row);
          });
          results.append(button);
          rows.push({ ...row, button });
        }
      }

      function renderResults() {
        results.replaceChildren();
        rows = [];
        activeIndex = -1;
        addSection('現在のタグ辞書', existingItems, 'current');
        addSection('外部カタログ', externalItems, 'external');
        if (externalHasMore) {
          const more = node('button', 'gb-btn gb-btn-sm tag-catalog-more', '次の候補を表示');
          more.type = 'button';
          more.dataset.e2eId = 'tag-catalog-load-more';
          more.addEventListener('click', () => {
            const currentRevision = revision;
            more.disabled = true;
            setStatus('次の候補を検索中…');
            searchExternal(input.value.trim(), currentRevision, externalNextOffset, true)
              .catch(error => {
                if (currentRevision !== revision || settled) return;
                renderResults();
                setStatus(`次の候補を検索できませんでした: ${error?.message || error}`, true);
              });
          });
          results.append(more);
        }
        if (!rows.length) {
          results.append(node('div', 'tag-catalog-status', input.value.trim() ? '一致する候補はありません' : '候補検索は入力後に始まります'));
        }
      }

      function moveSelection(delta) {
        if (!rows.length) return;
        activeIndex = (activeIndex + delta + rows.length) % rows.length;
        rows.forEach((row, index) => {
          row.button.setAttribute('aria-selected', index === activeIndex ? 'true' : 'false');
        });
        rows[activeIndex].button.scrollIntoView({ block: 'nearest' });
      }

      async function searchExternal(value, currentRevision, offset = 0, append = false) {
        if (navigator.onLine === false) {
          if (!append) externalItems = [];
          externalHasMore = false;
          externalNextOffset = 0;
          renderResults();
          setStatus('オフラインのため現在の辞書だけを表示しています');
          return;
        }
        const query = new URLSearchParams({
          query: value,
          kind,
          limit: '20',
          offset: String(offset),
        });
        if (sourceFolder) query.set('source_folder', sourceFolder);
        let response = await apiFetch(
          `/external-tag-catalog/suggestions?${query.toString()}`,
          { silentError: true },
        );
        if (currentRevision !== revision || settled) return;
        if (response?.needs_prepare && !preparedJobId) {
          setStatus('外部タグカタログを初回準備しています…');
          const started = await apiPost('/external-tag-catalog/prepare', {});
          preparedJobId = String(started?.job_id || '');
        }
        if (response?.needs_prepare && preparedJobId) {
          const jobId = preparedJobId;
          await waitForJob(jobId, () => currentRevision === revision && !settled);
          if (preparedJobId === jobId) preparedJobId = '';
        }
        if (response?.needs_prepare) {
          response = await apiFetch(
            `/external-tag-catalog/suggestions?${query.toString()}`,
            { silentError: true },
          );
        }
        if (currentRevision !== revision || settled) return;
        const received = Array.isArray(response?.items) ? response.items : [];
        externalItems = append
          ? [...new Map(
              [...externalItems, ...received].map(item => [
                String(item?.candidate_id || `${item?.kind}:${item?.catalog_id}`),
                item,
              ]),
            ).values()]
          : received;
        externalHasMore = response?.has_more === true;
        externalNextOffset = Number(response?.next_offset || (offset + received.length));
        renderResults();
        if (response?.offline) setStatus('オフラインのため現在の辞書だけを表示しています');
        else if (response?.available === false) setStatus('外部カタログは未設定です。現在の辞書だけを表示しています');
        else setStatus(`${rows.length.toLocaleString('ja-JP')}件の候補`);
      }

      function scheduleSearch(allowShortQuery = false) {
        if (composing) return;
        const value = input.value.trim();
        const canSearch = allowShortQuery || [...value].length >= 2;
        revision += 1;
        const currentRevision = revision;
        window.clearTimeout(timer);
        existingItems = canSearch ? currentMatches(current, value) : [];
        externalItems = [];
        externalHasMore = false;
        externalNextOffset = 0;
        renderResults();
        create.disabled = !value;
        if (!value) {
          setStatus('入力すると現在の辞書と外部カタログを検索します');
          return;
        }
        if (!canSearch) {
          setStatus('2文字以上入力すると候補を検索します');
          return;
        }
        setStatus('外部カタログを検索中…');
        timer = window.setTimeout(() => {
          searchExternal(value, currentRevision).catch(error => {
            if (currentRevision !== revision || settled) return;
            externalItems = [];
            renderResults();
            setStatus(`外部カタログを検索できませんでした: ${error?.message || error}`, true);
          });
        }, SEARCH_DELAY_MS);
      }

      function createCustom() {
        const value = input.value.trim();
        if (value) finish({ action: 'custom', value });
      }

      function onDocumentKey(event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(null);
        }
      }

      input.addEventListener('compositionstart', () => { composing = true; });
      input.addEventListener('compositionend', () => {
        composing = false;
        scheduleSearch(true);
      });
      input.addEventListener('input', () => scheduleSearch(false));
      input.addEventListener('keydown', event => {
        if (event.isComposing || composing) return;
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          moveSelection(1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          moveSelection(-1);
        } else if (event.key === 'Enter') {
          event.preventDefault();
          if (activeIndex >= 0) choose(rows[activeIndex]);
          else createCustom();
        }
      });
      create.addEventListener('click', createCustom);
      cancel.addEventListener('click', () => finish(null));
      overlay.addEventListener('click', event => {
        if (event.target === overlay) finish(null);
      });
      document.addEventListener('keydown', onDocumentKey);
      cancelDialog = () => finish(null);
      activeDialog = { overlay, cancel: cancelDialog };
      window.__MeldexTagCatalogSuggestionCancel = cancelDialog;
      create.disabled = !defaultValue.trim();
      renderResults();
      input.focus();
      input.select();
    });
  }

  window.MeldexTagCatalogSuggestions = {
    cancel() {
      activeDialog?.cancel?.();
    },
    currentMatches,
    open,
    searchKey,
  };
})();
