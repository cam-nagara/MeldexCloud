/* タグ辞書のプリセット絞り込み・同梱プリセット導入UI。 */
(function () {
  'use strict';

  function filteredTags(state, visibleLimit) {
    const selected = new Set(
      (state.selectedPresetNames || []).map(name => String(name).toLocaleLowerCase('ja')),
    );
    const query = String(state.filterText || '').trim().toLocaleLowerCase('ja');
    const matches = (state.tags || []).filter(tag => {
      if (selected.size && !(tag.presets || []).some(name => selected.has(String(name).toLocaleLowerCase('ja')))) {
        return false;
      }
      if (!query) return true;
      return [tag.name, ...(tag.aliases || []), ...(tag.presets || [])]
        .some(value => String(value || '').toLocaleLowerCase('ja').includes(query));
    });
    return {
      all: matches,
      visible: matches.slice(0, Math.max(1, Number(visibleLimit) || 1)),
    };
  }

  function renderPresetControls(options) {
    const { state, onFilterInput, onPresetToggle } = options;
    const fragment = document.createDocumentFragment();
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'gb-input gb-tag-management-filter';
    search.placeholder = 'タグ名・別名・プリセットを検索';
    search.value = state.filterText || '';
    search.dataset.e2eId = 'tag-management-filter';
    search.setAttribute('aria-label', 'タグ辞書を検索');
    search.addEventListener('input', () => onFilterInput(search));
    fragment.appendChild(search);

    const details = document.createElement('details');
    details.className = 'gb-tag-management-presets';
    details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = `自動タグプリセット（${(state.presetNames || []).length}件・複数選択可）`;
    summary.title = '選択したプリセットのタグだけを表示します。タグ自体は削除されません。';
    details.appendChild(summary);
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;padding:6px 0;';
    if (!(state.presetNames || []).length) {
      const empty = document.createElement('span');
      empty.className = 'gb-section-desc';
      empty.textContent = 'プリセット所属はまだありません';
      list.appendChild(empty);
    }
    (state.presetNames || []).forEach((name, index) => {
      const label = document.createElement('label');
      label.className = 'at-preset-option';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = (state.selectedPresetNames || []).includes(name);
      input.dataset.e2eId = `tag-management-preset-filter-${index + 1}`;
      input.addEventListener('change', () => onPresetToggle(name, input.checked));
      label.append(input, document.createTextNode(name));
      list.appendChild(label);
    });
    details.appendChild(list);
    fragment.appendChild(details);
    return fragment;
  }

  function renderBuiltinPresets(options) {
    const { state, textButton, safeKeyPart, onInstall } = options;
    const details = document.createElement('details');
    details.className = 'gb-tag-management-builtins';
    const summary = document.createElement('summary');
    summary.textContent = '同梱プリセットを導入・更新';
    details.appendChild(summary);
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding-top:6px;';
    (state.builtinPresets || []).forEach(item => {
      const row = document.createElement('div');
      row.className = 'gb-section gb-section--boxed';
      row.style.cssText = 'padding:7px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 8px;';
      const text = document.createElement('div');
      const counts = `${Number(item.installed_tag_count || 0).toLocaleString('ja-JP')} / ${Number(item.bundled_tag_count || 0).toLocaleString('ja-JP')}タグ`;
      const runtimeNote = item.local_only
        ? '・ローカル画像AI向け（CLIの1,000件上限を超えます）'
        : '';
      const name = document.createElement('strong');
      name.textContent = String(item.name || '');
      const summaryText = document.createElement('small');
      summaryText.style.cssText = 'display:block;color:var(--fg2);';
      summaryText.textContent = String(item.summary || '');
      const countText = document.createElement('small');
      countText.textContent = counts + runtimeNote;
      text.append(name, summaryText, countText);
      const button = textButton(
        item.installed ? '更新' : '導入',
        item.installed ? 'refresh-cw' : 'download',
        () => onInstall(item),
        `tag-management-install-preset-${safeKeyPart(item.id)}`,
      );
      button.disabled = !item.available || !!state.installingPresetId;
      if (state.installingPresetId === item.id) button.textContent = '処理中…';
      row.append(text, button);
      list.appendChild(row);
    });
    details.appendChild(list);
    return details;
  }

  function renderFilterSummary(state, filtered) {
    const summary = document.createElement('div');
    summary.className = 'gb-section-desc';
    summary.style.cssText = 'padding:0 2px 7px;';
    const selected = (state.selectedPresetNames || []).length
      ? `・${state.selectedPresetNames.join('＋')}`
      : '・全プリセット';
    summary.textContent = `${filtered.all.length.toLocaleString('ja-JP')} / ${(state.tags || []).length.toLocaleString('ja-JP')}タグ${selected}`;
    return summary;
  }

  async function installBuiltinPreset(item, options) {
    const { state, render, refresh, reportError } = options;
    if (!item?.id || state.installingPresetId) return;
    state.installingPresetId = item.id;
    render();
    try {
      const startPath = '/auto-tag/presets/' + encodeURIComponent(item.id) + '/install';
      const result = typeof runBackgroundJob === 'function'
        ? await runBackgroundJob(startPath, {}, {
          onProgress(progress) {
            if (typeof showStatus === 'function' && progress?.message) showStatus(progress.message);
          },
        })
        : await window.MeldexGlobalTags?.installAutoTagPreset?.(item.id, {});
      window.MeldexGlobalTags?.invalidateTagsCatalogCache?.();
      await refresh(false);
      if (typeof showStatus === 'function') {
        showStatus(result?.message || `「${item.name}」を自動タグ辞書へ統合しました`);
      }
    } catch (error) {
      reportError(error, `「${item.name}」を導入できませんでした`);
    } finally {
      state.installingPresetId = '';
      render();
    }
  }

  async function runAutoTagForFolder(path, options) {
    const { confirmAsync, api, refresh, reportError } = options;
    if (!path) {
      if (typeof showStatus === 'function') showStatus('フォルダを開いてから実行してください', true);
      return;
    }
    if (!await confirmAsync('現在のフォルダ内のファイルへ自動タグ付けを実行しますか？\n設定で選んだAI・モデルと自動タグ辞書を使います。')) return;
    try {
      if (typeof showStatus === 'function') showStatus('自動タグ付けをバックグラウンドで開始します…');
      const result = await api().autoTag({ path, recursive: false });
      if (result?.background || result?.job_id) {
        if (typeof showStatus === 'function') showStatus('自動タグ付けをバックグラウンドで開始しました');
      } else if (result?.stopped) {
        if (typeof showStatus === 'function') showStatus('自動タグ付けを中断しました: ' + (result.warning || result.reason || ''), true);
      } else if (typeof showStatus === 'function') {
        showStatus((result?.total || 0) + '件に自動タグ付けしました');
      }
      await refresh(false);
      if (typeof renderFolderGrid === 'function') renderFolderGrid();
    } catch (error) {
      reportError(error, '自動タグ付けに失敗しました');
    }
  }

  window.MeldexTagPresetUI = {
    filteredTags,
    renderPresetControls,
    renderBuiltinPresets,
    renderFilterSummary,
    installBuiltinPreset,
    runAutoTagForFolder,
  };
})();
