/* 端末の圧縮ソフト。Cloudは既存のZIP経路だけを使う。 */
(function (global) {
  'use strict';
  const builtin = { id: 'meldex', name: 'Meldex内蔵 ZIP', compress_formats: ['zip'], extract_formats: ['zip', 'tar', 'tar.gz', 'tar.bz2', 'tar.xz', 'tgz', 'tbz2', 'txz'] };
  let catalog = null;
  let loading = null;
  const desktop = () => !global.MeldexRuntimeAdapter?.isBrowserDataMode?.()
    && (typeof _settingsDesktopFeaturesAvailable !== 'function' || _settingsDesktopFeaturesAvailable())
    && !['browser', 'dropbox'].includes(document.body?.dataset?.cloudMode || '')
    && /Windows/i.test(navigator.userAgent);
  const esc = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const help = text => typeof fieldHelp === 'function' ? fieldHelp(text) : '';
  async function load(refresh = false) {
    if (!desktop()) return null;
    if (catalog && !refresh) return catalog;
    if (!loading || refresh) {
      const path = '/archive/tools' + (refresh ? '?refresh=true' : '');
      loading = (typeof runBackgroundQuery === 'function'
        ? runBackgroundQuery(path, { label: '圧縮形式の確認', operationProgress: false, cancellable: false })
        : apiFetch(path, { silentError: true }))
        .then(data => {
          data.settings.tools = data.settings.tools.map(tool => {
            const current = data.detected.find(row => row.id === tool.id);
            return { ...tool, ...current, available: current?.available === true };
          });
          catalog = data; return data;
        }).finally(() => { loading = null; });
    }
    return loading;
  }
  function toolsFor(operation, items) {
    const cloud = global.MeldexRuntimeAdapter?.isBrowserDataMode?.();
    const tools = [builtin, ...(desktop() ? (catalog?.settings?.tools || []).filter(t => t.available !== false) : [])];
    const compatible = tools.filter(tool => tool[operation + '_formats']?.length && (operation === 'compress' || items.every(item => tool.extract_formats.some(ext => String(item.path).toLowerCase().endsWith('.' + ext)))));
    const defaultId = catalog?.settings?.[operation + '_default'] || 'meldex';
    return compatible.filter(t => !cloud || t.id === 'meldex' && (operation === 'compress' || items.every(i => /\.zip$/i.test(i.path))))
      .sort((a, b) => Number(b.id === defaultId) - Number(a.id === defaultId));
  }

  async function refreshAffected(result) {
    const canonical = path => String(path || '').split(String.fromCharCode(92)).join('/').replace(new RegExp('/+$'), '');
    const parent = result.parent || canonical(result.path).split('/').slice(0, -1).join('/');
    const normalize = path => canonical(path).toLowerCase();
    const key = normalize(parent);
    const descriptor = result.entry || { name: result.name || canonical(result.path).split('/').pop(), type: result.is_dir ? 'folder' : 'archive', ext: result.is_dir ? '' : '.zip' };
    const entryFor = path => ({ ...descriptor, path: canonical(path) + '/' + descriptor.name });
    const treeNodes = Array.from(document.querySelectorAll('.tree-node')).filter(node => normalize(node._nodeData?.path || node.dataset.path) === key);
    for (const node of treeNodes) {
      const path = node._nodeData?.path || node.dataset.path;
      const children = node.querySelector(':scope > .tree-children');
      if (!children) continue;
      const entry = entryFor(path);
      const virtual = global.GBOutlinerVirtualRender;
      if (virtual?.isVirtualContainer?.(children)) { virtual.insertItems(children, [entry]); continue; }
      if (children.dataset.loaded !== 'true') continue;
      const existing = new Map(Array.from(children.querySelectorAll(':scope > .tree-node')).filter(child => child._nodeData?.path).map(child => [normalize(child._nodeData.path), child]));
      if (existing.has(normalize(entry.path))) continue;
      const items = [...existing.values()].map(child => child._nodeData).concat([entry]);
      const sort = getSortForFolder(path);
      const ordered = sort.sort === 'manual' ? _sortItemsByManualOrder(items, path) : items.sort((a, b) => compareItemsForFolderSort(a, b, sort.sort, sort.order));
      const index = ordered.indexOf(entry);
      const next = ordered.slice(index + 1).map(item => existing.get(normalize(item.path))).find(Boolean);
      children.insertBefore(createTreeNodeFromBrowse(entry), next || null);
    }
    const current = typeof _folderPath === 'undefined' ? '' : _folderPath;
    if (current && (normalize(current) === key || key.endsWith('/' + normalize(current))) && typeof _folderApplyCreatedItems === 'function') {
      _folderApplyCreatedItems([entryFor(current)]);
    }
  }

  function optionsFor(tool, operation) {
    if (operation === 'compress' && tool.compress_formats.length > 1 || tool.password || operation === 'compress' && tool.split) {
      return new Promise(resolve => {
        const body = document.createElement('div');
        body.innerHTML = `${operation === 'compress' ? `<label class="gb-field"><span class="gb-label">形式</span><select class="gb-select" name="format">${tool.compress_formats.map(fmt => `<option>${esc(fmt)}</option>`).join('')}</select></label>` : ''}
          ${tool.password ? '<label class="gb-field"><span class="gb-label">パスワード</span><input class="gb-input" name="password" type="password" autocomplete="new-password"></label>' : ''}
          ${operation === 'compress' && tool.split ? `<label class="gb-field"><span class="gb-label">分割サイズ ${help('空欄で分割なし。100m、1g のように指定します。分割片は1つのフォルダにまとめて保存します。')}</span><input class="gb-input" name="split" placeholder="100m"></label>` : ''}
          `;
        const start = document.createElement('button'); start.className = 'gb-btn gb-btn-primary'; start.textContent = '実行';
        const cancel = document.createElement('button'); cancel.className = 'gb-btn'; cancel.textContent = 'キャンセル';
        const modal = GBUI.createModal({ title: tool.name + (operation === 'compress' ? 'で圧縮' : 'で解凍'), body, footer: [cancel, start], onClose: () => resolve(null) });
        cancel.onclick = () => modal.close();
        start.onclick = () => {
          const values = Object.fromEntries(Array.from(body.querySelectorAll('input, select'), input => [input.name, input.value]));
          resolve(values); modal.close();
        };
        modal.open();
      });
    }
    return Promise.resolve({});
  }

  async function run(operation, items, tool) {
    if (!desktop()) return operation === 'compress' ? compressFolderItems(items) : extractArchiveItems(items);
    try {
      if (tool?.id !== 'meldex') await load();
      tool ||= toolsFor(operation, items)[0];
      if (!tool) throw new Error('この形式に対応する圧縮ソフトを設定してください');
      const options = await optionsFor(tool, operation);
      if (!options) return;
      const targets = operation === 'compress' ? [items] : items.map(item => [item]);
      const results = [];
      const failures = [];
      const reservation = typeof historyReserve === 'function' ? historyReserve('フォルダ: ' + (operation === 'compress' ? '圧縮' : '解凍'), '') : null;
      try {
        for (const group of targets) {
          let result;
          let cancelled = null;
          try {
            result = await runBackgroundJob('/archive/run', { operation, tool_id: tool.id, paths: group.map(i => i.path), ...options }, {
              label: operation === 'compress' ? '圧縮しています' : '解凍しています', operationKind: 'archive', operationDelayMs: 0, pollIntervalMs: 200,
              successMessage: operation === 'compress' ? '圧縮しました' : '解凍しました',
            });
          } catch (error) {
            if (error?.name === 'AbortError') {
              result = error.jobStatus?.result;
              if (!result?.path) throw error;
              cancelled = error;
              cancelled.message = '中止要求の直前に保存が完了しました。保存済みの結果は残しています';
            } else { failures.push(error); continue; }
          }
          results.push(result);
          const register = () => typeof pushCreatedOutlinerItemHistory === 'function' && pushCreatedOutlinerItemHistory({ path: result.path, kind: result.is_dir ? 'folder' : 'file' }, 'フォルダ: ' + (operation === 'compress' ? '圧縮' : '解凍'), { scope: '' });
          if (reservation) reservation.capture(register); else register();
          try { await refreshAffected(result); }
          catch { showStatus('保存しました。フォルダの表示を更新できませんでした', true); }
          if (cancelled) throw cancelled;
        }
      } finally { reservation?.cancel(); }
      if (failures.length) {
        const reason = failures[0]?.userMessage || failures[0]?.message || '処理できませんでした';
        showStatus(targets.length === 1 ? (operation === 'compress' ? '圧縮に失敗しました: ' : '解凍に失敗しました: ') + reason : `${results.length}件を完了、${failures.length}件に失敗しました: ${reason}`, true);
      } else if (operation === 'extract' && results.length > 1) showStatus(`${results.length}件をすべて解凍しました`);
      else showStatus((operation === 'compress' ? '圧縮しました: ' : '解凍しました: ') + results.map(r => r.name).join('、'));
      return results;
    } catch (error) {
      showStatus(error?.userMessage || error?.message || '処理に失敗しました', error?.name !== 'AbortError');
    }
  }

  function appendMenu(menu, items, close) {
    if (!desktop() || menu.dataset.archiveTools === '1' || !items?.length || items.some(i => !i.path || i.archive_path)) return;
    menu.dataset.archiveTools = '1';
    const panels = [];
    const render = () => {
      // Other actions (including the pending OS group) may have been added
      // since the first render. Refresh the archive group in its original slot.
      const next = panels[panels.length - 1]?.nextSibling || null;
      panels.splice(0).forEach(node => node.remove());
      for (const operation of ['compress', 'extract']) {
        const tools = toolsFor(operation, items);
        if (!tools.length) continue;
        const label = operation === 'compress' ? '圧縮' : '解凍';
        const panel = _outlinerCreateSubmenu(label);
        const before = new Set(menu.children);
        _outlinerAppendSubmenu(menu, label, 'archive', panel);
        const added = Array.from(menu.children).filter(node => !before.has(node));
        added.forEach(node => menu.insertBefore(node, next));
        panels.push(...added);
        tools.forEach(tool => _outlinerAppendMenuItem(panel, { label: tool.name, action: () => { close?.(); return run(operation, items, tool); } }));
      }
    };
    render();
    load().then(() => { if (menu.isConnected) render(); }).catch(() => {});
  }

  function renderSettings(modal) {
    if (!desktop()) return;
    const panel = modal.querySelector('.settings-panel[data-panel="全般"]');
    if (!panel || panel.querySelector('[data-archive-settings]')) return;
    const section = document.createElement('section');
    section.className = 'gb-section gb-section--boxed settings-section-wide';
    section.dataset.settingsView = 'archive-tools'; section.dataset.archiveSettings = '1'; section.hidden = modal.dataset.settingsActivePageId !== 'archive-tools';
    section.innerHTML = '<div role="status">圧縮ソフトを確認しています...</div>';
    panel.appendChild(section);
    async function paint(refresh) {
      try {
        const data = await load(refresh);
        if (!section.isConnected) return;
        const saved = data.settings;
        const selected = new Set(saved.tools.map(t => t.id));
        section.innerHTML = `<div class="gb-section-title">圧縮・解凍ソフト ${help('このWindows端末だけの設定です。選んだ実行ファイルを画面を開かず使います。Meldex内蔵ZIPは常に表示されます。')}</div>
          <div data-archive-list></div>
          ${['compress', 'extract'].map(op => `<label class="gb-field"><span class="gb-label">${op === 'compress' ? '圧縮' : '解凍'}の既定</span><select class="gb-select" name="${op}_default"></select></label>`).join('')}
          <div class="gb-section-title">カスタム ${help('実行ファイルの絶対パスと、引数ごとのJSON配列を指定します。{inputs} は複数の入力、{archive} は解凍元、{output} は一時出力先です。画面を開かない引数を指定してください。')}</div>
          <label class="gb-check"><input type="checkbox" name="custom_enabled"><span>カスタムを表示する</span></label>
          ${[['custom_name', '表示名'], ['custom_executable', '実行ファイル'], ['custom_compress_args', '圧縮の引数'], ['custom_extract_args', '解凍の引数'], ['custom_compress_formats', '圧縮できる形式'], ['custom_extract_formats', '解凍できる形式']].map(([id, label]) => `<label class="gb-field"><span class="gb-label">${label}</span><input class="gb-input" name="${id}"></label>`).join('')}
          <div class="gb-field-row"><button class="gb-btn" type="button" data-archive-rescan>再検出</button><button class="gb-btn gb-btn-primary" type="button" data-archive-save>適用</button></div><div role="status" data-archive-status></div>`;
        const list = section.querySelector('[data-archive-list]');
        for (const tool of data.detected.filter(t => t.id !== 'custom')) {
          const row = document.createElement('div'); row.className = 'gb-check-help-row';
          row.innerHTML = `<label class="gb-check"><input type="checkbox" data-tool-id="${esc(tool.id)}" ${selected.has(tool.id) ? 'checked' : ''} ${(tool.available && (tool.compress_formats.length || tool.extract_formats.length)) || selected.has(tool.id) ? '' : 'disabled'}><span>${esc(tool.name)}${tool.status_label ? ` — ${esc(tool.status_label)}` : ''}</span></label>${help(tool.executable + ' / ' + (tool.reason || (!tool.available ? '実行ファイルが見つかりません。選択を解除して適用できます。' : `圧縮: ${tool.compress_formats.join('、')} / 解凍: ${tool.extract_formats.join('、')}${tool.password ? ' / パスワード対応' : ''}${tool.split ? ' / 分割対応' : ''}`)))}`;
          list.appendChild(row);
        }
        const custom = saved.tools.find(t => t.id === 'custom');
        section.querySelector('[name="custom_enabled"]').checked = !!custom;
        for (const field of ['name', 'executable', 'compress_args', 'extract_args']) section.querySelector(`[name="custom_${field}"]`).value = custom ? (Array.isArray(custom[field]) ? JSON.stringify(custom[field]) : custom[field]) : '';
        for (const op of ['compress', 'extract']) section.querySelector(`[name="custom_${op}_formats"]`).value = (custom?.[op + '_formats'] || ['zip']).join(',');
        function defaults() {
          const ids = new Set(Array.from(section.querySelectorAll('[data-tool-id]:checked'), input => input.dataset.toolId));
          const rows = [builtin, ...data.detected.filter(t => ids.has(t.id) && t.available)];
          if (section.querySelector('[name="custom_enabled"]').checked) rows.push({ id: 'custom', name: 'カスタム', compress_formats: ['zip'], extract_formats: ['zip'] });
          for (const op of ['compress', 'extract']) {
            const select = section.querySelector(`[name="${op}_default"]`);
            const value = select.value || saved[op + '_default'];
            const compatible = rows.filter(t => t[op + '_formats'].length);
            select.replaceChildren(...compatible.map(t => new Option(t.name, t.id)));
            select.value = compatible.some(t => t.id === value) ? value : 'meldex';
          }
        }
        defaults(); section.onchange = defaults;
        section.querySelector('[data-archive-rescan]').onclick = () => paint(true);
        section.querySelector('[data-archive-save]').onclick = async event => {
          const button = event.currentTarget; button.disabled = true;
          const status = section.querySelector('[data-archive-status]');
          try {
            const payload = { selected: Array.from(section.querySelectorAll('[data-tool-id]:checked'), input => input.dataset.toolId) };
            for (const op of ['compress', 'extract']) payload[op + '_default'] = section.querySelector(`[name="${op}_default"]`).value;
            if (section.querySelector('[name="custom_enabled"]').checked) {
              payload.custom = {};
              for (const field of ['name', 'executable', 'compress_args', 'extract_args']) {
                const value = section.querySelector(`[name="custom_${field}"]`).value;
                payload.custom[field] = field.endsWith('_args') ? JSON.parse(value) : value;
              }
              for (const op of ['compress', 'extract']) payload.custom[op + '_formats'] = section.querySelector(`[name="custom_${op}_formats"]`).value.toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
            }
            const result = await apiPost('/archive/tools/settings', payload, { silentError: true });
            catalog.settings = result.settings; status.textContent = '設定を保存しました';
          } catch (error) { status.textContent = error instanceof SyntaxError ? '引数をJSON配列で入力してください' : error?.message || '設定を保存できませんでした'; }
          finally { button.disabled = false; }
        };
      } catch (error) { section.textContent = error?.message || 'ソフトを検出できませんでした'; }
    }
    paint(false);
  }
  const observer = new MutationObserver(() => document.querySelectorAll('.settings-modal').forEach(renderSettings));
  async function resumeJobs() {
    if (!desktop() || typeof runBackgroundJob !== 'function') return;
    try {
      const data = await apiFetch('/jobs?category=archive&active_only=1', { silentError: true });
      for (const job of data.jobs || []) {
        if (global.MeldexOperationProgress?.findByPersistentJobId(job.id)) continue;
        runBackgroundJob('/archive/run', {}, { resumeJobId: job.id, operationKind: 'archive', label: job.label || '圧縮・解凍', successMessage: (job.label || '圧縮・解凍') + 'が完了しました', operationDelayMs: 0, pollIntervalMs: 200 })
          .then(async result => {
            if (!result.path) return;
            if (typeof pushCreatedOutlinerItemHistory === 'function') pushCreatedOutlinerItemHistory({ path: result.path, kind: result.is_dir ? 'folder' : 'file' }, 'フォルダ: 圧縮・解凍', { scope: '' });
            await refreshAffected(result);
          }).catch(error => showStatus(error?.message || '処理の結果を確認できませんでした', error?.name !== 'AbortError'));
      }
    } catch { /* 次の画面起動時に再確認できる。未確認を成功にしない。 */ }
  }
  function start() { observer.observe(document.documentElement, { childList: true, subtree: true }); document.querySelectorAll('.settings-modal').forEach(renderSettings); resumeJobs(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  global.MeldexArchiveTools = { desktop, load, toolsFor, run, appendMenu, renderSettings, refreshAffected };
})(window);
