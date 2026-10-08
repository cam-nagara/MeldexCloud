/* タグ辞書のプリセット絞り込み・同梱プリセット導入UI。 */
(function () {
  'use strict';

  function filteredTags(state) {
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
      visible: matches,
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
    search.addEventListener('compositionstart', () => {
      search.dataset.composing = '1';
    });
    search.addEventListener('compositionend', event => {
      delete search.dataset.composing;
      onFilterInput(search, event);
    });
    search.addEventListener('input', event => {
      if (event.isComposing || search.dataset.composing === '1') return;
      onFilterInput(search, event);
    });

    const details = document.createElement('details');
    details.className = 'gb-tag-management-presets';
    details.dataset.e2eId = 'tag-management-preset-filter-section';
    details.open = !!state.presetFiltersOpen;
    const summary = document.createElement('summary');
    const selectedNames = state.selectedPresetNames || [];
    summary.textContent = selectedNames.length
      ? `タグ一覧の絞り込み（${selectedNames.join('＋')}）`
      : `タグ一覧の絞り込み（全${(state.presetNames || []).length}プリセット）`;
    summary.title = 'タグ一覧の表示だけを絞り込みます。自動タグ付けで使うプリセットは、下の自動タグ付け欄で選びます。';
    details.appendChild(summary);
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;padding:6px 0;';
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'タグ一覧をプリセットで絞り込み');
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
    details.addEventListener('toggle', () => {
      state.presetFiltersOpen = details.open;
    });
    fragment.appendChild(details);
    fragment.appendChild(search);
    return fragment;
  }

  function renderBuiltinPresets(options) {
    const { state, textButton, safeKeyPart, onInstall } = options;
    const section = document.createElement('section');
    section.className = 'gb-tag-management-builtins';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'gb-tag-management-builtins-toggle';
    toggle.dataset.e2eId = 'tag-management-builtins-toggle';
    toggle.textContent = '同梱プリセットを導入・更新';
    toggle.setAttribute('aria-label', '同梱プリセットを導入・更新');
    const list = document.createElement('div');
    list.className = 'gb-tag-management-builtin-list';
    list.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding-top:6px;';
    const setOpen = open => {
      state.builtinPresetsOpen = !!open;
      list.hidden = !state.builtinPresetsOpen;
      toggle.setAttribute('aria-expanded', state.builtinPresetsOpen ? 'true' : 'false');
    };
    toggle.addEventListener('click', () => setOpen(!state.builtinPresetsOpen));
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
    section.append(toggle, list);
    setOpen(state.builtinPresetsOpen);
    return section;
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
      window.invalidateAutoTagBundleCache?.();
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

  function updateAutoTagTargetLabel(target, targets, path, recursive) {
    target.dataset.tagAutoTargetLabel = '1';
    if (targets.length > 1) {
      const recursiveCount = targets.filter(item => item.recursive).length;
      target.textContent = `選択項目: ${targets.length.toLocaleString('ja-JP')}件`
        + (recursiveCount ? `（フォルダ${recursiveCount.toLocaleString('ja-JP')}件は配下も対象）` : '');
      const previewPaths = targets.slice(0, 20).map(item => item.path);
      target.title = previewPaths.join('\n')
        + (targets.length > previewPaths.length ? `\nほか${(targets.length - previewPaths.length).toLocaleString('ja-JP')}件` : '');
      return;
    }
    target.textContent = (recursive ? 'フォルダ内すべて: ' : '対象: ') + path;
    target.title = path;
  }

  function normalizeAutoTagTargetPath(value) {
    let current = value;
    for (let depth = 0; depth < 3; depth += 1) {
      if (typeof current === 'string') return current.trim();
      if (!current || typeof current !== 'object') return '';
      const next = current.path ?? current.absolute_path ?? current.absolutePath
        ?? current.full_path ?? current.fullPath ?? current.value;
      if (next === current) return '';
      current = next;
    }
    return typeof current === 'string' ? current.trim() : '';
  }

  function renderAutoTagExecutionSection(options = {}) {
    if (window.isAutoTagRuntimeAvailable?.() !== true) return null;
    const seen = new Set();
    const targets = (Array.isArray(options.targets) && options.targets.length
      ? options.targets
      : [{ path: options.path, recursive: options.recursive }])
      .map(item => ({
        path: normalizeAutoTagTargetPath(item),
        recursive: typeof item === 'object' ? !!item?.recursive : false,
      }))
      .filter(item => {
        if (!item.path || seen.has(item.path)) return false;
        seen.add(item.path);
        return true;
      });
    const firstTarget = targets[0] || { path: '', recursive: false };
    const path = firstTarget.path;
    const recursive = firstTarget.recursive;
    let targetHash = 2166136261;
    targets.forEach(item => {
      const value = item.path + (item.recursive ? '\u0001' : '\u0000');
      for (let index = 0; index < value.length; index += 1) {
        targetHash ^= value.charCodeAt(index);
        targetHash = Math.imul(targetHash, 16777619);
      }
    });
    const targetSignature = `${targets.length}:${(targetHash >>> 0).toString(16)}:${options.mutationBlocked ? 'blocked' : 'ready'}`;
    const section = options.existing || document.createElement('section');
    section.className = 'gb-tag-auto-run-section';
    section.dataset.tagAutoRunSection = '1';
    section.dataset.e2eId = 'tag-auto-run-section';
    section.style.cssText = 'padding:0 0 8px;';
    if (
      !options.force
      && section.dataset.targetSignature === targetSignature
    ) {
      return section;
    }
    section.dataset.targetPath = path;
    section.dataset.recursive = recursive ? '1' : '0';
    section.dataset.targetSignature = targetSignature;
    const existingHost = section.querySelector?.('[data-tag-auto-run-host]');
    const existingTarget = section.querySelector?.('[data-tag-auto-target-label]');
    if (!options.force && path && !options.mutationBlocked && existingHost && existingTarget) {
      updateAutoTagTargetLabel(existingTarget, targets, path, recursive);
      window.updateAutoTagRunPanelTargets?.(existingHost, path, {
        recursive,
        targets,
        label: options.label || (targets.length > 1 ? `${targets.length}件の選択項目` : ''),
      });
      return section;
    }
    section.replaceChildren();
    if (!path) {
      const empty = document.createElement('div');
      empty.className = 'gb-section-desc';
      empty.style.padding = '8px 4px';
      empty.textContent = '自動タグ付けするファイルまたはフォルダを選択してください。';
      section.appendChild(empty);
      return section;
    }
    if (options.mutationBlocked) {
      const blocked = document.createElement('div');
      blocked.className = 'gb-section-desc';
      blocked.style.cssText = 'padding:8px;color:var(--warning,#d8a22e);';
      blocked.textContent = options.mutationWarning
        || 'タグ辞書の同期競合を解消してから自動タグ付けを実行してください。';
      section.appendChild(blocked);
      return section;
    }
    const target = document.createElement('div');
    target.className = 'gb-section-desc';
    target.style.cssText = 'padding:6px 4px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    updateAutoTagTargetLabel(target, targets, path, recursive);
    const host = document.createElement('div');
    host.dataset.tagAutoRunHost = '1';
    host.dataset.e2eId = 'tag-auto-run-host';
    section.append(target, host);
    queueMicrotask(() => window.renderAutoTagRunPanel?.(host, path, {
      recursive,
      targets,
      label: options.label || (targets.length > 1 ? `${targets.length}件の選択項目` : ''),
    }));
    return section;
  }

  window.MeldexTagPresetUI = {
    filteredTags,
    renderPresetControls,
    renderBuiltinPresets,
    renderFilterSummary,
    installBuiltinPreset,
    runAutoTagForFolder,
    renderAutoTagExecutionSection,
    normalizeAutoTagTargetPath,
  };
})();
