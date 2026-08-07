/* standalone-parity-adapter.js
 * ノート / シナリオ / シート単独版で、環境能力・リンク表示先・本体管理機能の
 * 代替導線を共通化する。編集・保存処理には介入しない。
 */
(function initStandaloneParityAdapter(global) {
  'use strict';

  const APP_ENTRY = Object.freeze({
    note: 'note-standalone.html',
    scenario: 'scenario-standalone.html',
    board: 'board-standalone.html',
    sheet: 'sheet-standalone.html',
    timer: 'timer-standalone.html',
    viewer: 'viewer.html',
  });
  const TYPE_APP = Object.freeze({
    page: 'note',
    document: 'note',
    scriptnote: 'scenario',
    scenario: 'scenario',
    board: 'board',
    timer: 'timer',
    pivot: 'sheet',
    database: 'sheet',
    sheet: 'sheet',
    tree: 'sheet',
    gallery: 'sheet',
    kanban: 'sheet',
    timeline: 'sheet',
    chart: 'sheet',
    graph: 'sheet',
    media: 'viewer',
    html: 'viewer',
  });
  const FEATURE_LABELS = Object.freeze({
    file_info: 'ファイル情報',
    publish: '公開',
    backlinks: 'バックリンク',
    annotations_comments: '注釈・コメント',
  });

  let currentConfig = null;
  let optionObserver = null;
  let optionRevision = 0;
  let openDialog = null;
  let linkDialog = null;
  let nativeCapabilitiesPromise = null;

  function text(value) {
    return String(value == null ? '' : value);
  }

  function basename(path) {
    return text(path).replace(/\\/g, '/').split('/').pop() || text(path);
  }

  function isCloud() {
    return global.MeldexStandaloneCloud?.isCloudMode?.() === true
      || global.MeldexRuntimeAdapter?.isCloudMode?.() === true;
  }

  function environment() {
    return isCloud() ? 'cloud_standalone' : 'windows_standalone';
  }

  function isNativeMode() {
    return !isCloud() && new URLSearchParams(global.location?.search || '').get('native') === '1';
  }

  async function nativeCapabilities(refresh) {
    if (!isNativeMode()) return { ok: true, targets: {}, allowedTargets: [] };
    if (!nativeCapabilitiesPromise || refresh) {
      nativeCapabilitiesPromise = Promise.resolve(
        global.apiFetch?.('/standalone/open-target/capabilities', { silentError: true }),
      ).then(payload => {
        if (!payload?.ok || !payload.targets || !Array.isArray(payload.allowedTargets)) {
          throw new Error('起動機能の応答が正しくありません');
        }
        return payload;
      }).catch(error => ({
        ok: false,
        targets: {},
        allowedTargets: [],
        error: { code: 'launcher_unavailable', message: error?.message || 'Meldexの起動機能を利用できません' },
      }));
    }
    return nativeCapabilitiesPromise;
  }

  function classify(capability) {
    const registry = global.MeldexAppCapabilities;
    if (!registry?.classify || !currentConfig?.appId) {
      return {
        status: 'alternative',
        adapter: 'standalone-parity-fallback',
        route: { environment: isCloud() ? 'cloud_main' : 'desktop_main', app: currentConfig?.appId || '' },
        reason: 'この機能はMeldex本体で利用します',
      };
    }
    try {
      return registry.classify(currentConfig.appId, environment(), capability);
    } catch (error) {
      console.error('[standalone-parity] capability lookup failed', error);
      return {
        status: 'alternative',
        adapter: 'standalone-parity-fallback',
        route: { environment: isCloud() ? 'cloud_main' : 'desktop_main', app: currentConfig.appId },
        reason: '環境の機能判定に失敗したためMeldex本体で開きます',
      };
    }
  }

  function resolveTarget(pathOrTarget, hints) {
    const path = text(pathOrTarget?.path || pathOrTarget).trim();
    const label = text(hints?.label || pathOrTarget?.label || basename(path)).trim() || path;
    const linkType = text(hints?.linkType || pathOrTarget?.linkType || pathOrTarget?.type).trim();
    const resolved = global.GBLinkRouter?.resolve?.(path, { label, linkType });
    if (resolved) return resolved;
    return { type: linkType || 'page', path, label, state: {}, recognized: !!path };
  }

  function appForTarget(target) {
    return TYPE_APP[target?.type] || '';
  }

  function canOpenStandalone(target) {
    const targetApp = appForTarget(target);
    return !!targetApp && !(targetApp === 'viewer' && isCloud());
  }

  function standaloneUrl(target) {
    const targetApp = appForTarget(target);
    const entry = APP_ENTRY[targetApp];
    if (!entry || !target?.path) return '';
    const runtime = global.MeldexRuntimeAdapter;
    if (runtime?.resolveAppPath) {
      return runtime.resolveAppPath(entry, { open: target.path, label: target.label || '' });
    }
    const url = new URL(entry, global.location?.href || 'http://localhost/');
    url.searchParams.set('open', target.path);
    if (target.label) url.searchParams.set('label', target.label);
    return url.pathname + url.search;
  }

  function mainUrl(target, handoff) {
    if (!target?.path) {
      return global.MeldexResourceUrl?.appEntry?.() || 'Meldex.html';
    }
    if (typeof global.buildSingleTabWindowUrl === 'function') {
      const built = global.buildSingleTabWindowUrl({
        path: target.path,
        name: target.label || basename(target.path),
        type: target.type || 'page',
      });
      const url = new URL(built, global.location?.href || 'http://localhost/');
      if (handoff?.feature) url.searchParams.set('standaloneFeature', handoff.feature);
      if (handoff?.targetKind) url.searchParams.set('standaloneTargetKind', handoff.targetKind);
      if (handoff?.targetRef) url.searchParams.set('standaloneTargetRef', JSON.stringify(handoff.targetRef));
      if (handoff?.snapshot) url.searchParams.set('standaloneSnapshot', String(handoff.snapshot).slice(0, 1000));
      if (handoff?.action) url.searchParams.set('standaloneFeatureAction', handoff.action);
      return url.pathname + url.search;
    }
    const fallback = global.MeldexResourceUrl?.appEntry?.({
      single: 1,
      open: target.type || 'page',
      path: target.path,
      label: target.label || '',
    }) || ('Meldex.html?single=1&open=' + encodeURIComponent(target.type || 'page')
      + '&path=' + encodeURIComponent(target.path)
      + '&label=' + encodeURIComponent(target.label || ''));
    const url = new URL(fallback, global.location?.href || 'http://localhost/');
    if (handoff?.feature) url.searchParams.set('standaloneFeature', handoff.feature);
    if (handoff?.targetKind) url.searchParams.set('standaloneTargetKind', handoff.targetKind);
    if (handoff?.targetRef) url.searchParams.set('standaloneTargetRef', JSON.stringify(handoff.targetRef));
    if (handoff?.snapshot) url.searchParams.set('standaloneSnapshot', String(handoff.snapshot).slice(0, 1000));
    if (handoff?.action) url.searchParams.set('standaloneFeatureAction', handoff.action);
    return url.pathname + url.search;
  }

  function openWindow(url) {
    let opened = null;
    try {
      opened = global.open?.(url, '_blank');
      if (opened) opened.opener = null;
    } catch (error) { opened = null; }
    if (!opened) {
      global.showStatus?.('新しいウィンドウを開けませんでした。ポップアップを許可して再試行してください', true);
      return false;
    }
    return true;
  }

  async function openNativeTarget(target, destination, handoff) {
    const targetApp = destination === 'main' ? 'main' : appForTarget(target);
    const capabilities = await nativeCapabilities();
    const targetCapability = capabilities.targets?.[targetApp];
    if (!targetApp
        || !capabilities.ok
        || !capabilities.allowedTargets.includes(targetApp)
        || targetCapability?.available !== true) {
      global.showStatus?.(
        targetCapability?.reason || capabilities.error?.message || '対応するアプリがインストールされていません',
        true,
      );
      return false;
    }
    try {
      const result = await global.apiPost('/standalone/open-target', {
        target: targetApp,
        path: target?.path || '',
        type: target?.type || '',
        label: target?.label || '',
        handoff: handoff || {},
      });
      if (result?.ok === false) throw new Error(result.error?.message || '対象アプリを起動できませんでした');
      return true;
    } catch (error) {
      global.showStatus?.(error?.message || '対象アプリを起動できませんでした', true);
      return false;
    }
  }

  function makeButton(label, e2eId, primary) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = primary ? 'gb-btn gb-btn-primary' : 'gb-btn';
    button.textContent = label;
    button.dataset.e2eId = e2eId;
    button.style.minWidth = '44px';
    button.style.minHeight = '44px';
    return button;
  }

  function closeOverlay(kind, restoreFocus) {
    const record = kind === 'link' ? linkDialog : openDialog;
    if (!record) return;
    record.overlay.remove();
    if (kind === 'link') linkDialog = null;
    else openDialog = null;
    if (restoreFocus?.isConnected) {
      try { restoreFocus.focus({ preventScroll: true }); } catch (error) { restoreFocus.focus?.(); }
    }
  }

  function createOverlay(kind, title, description) {
    closeOverlay(kind);
    const focusReturn = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay standalone-parity-overlay';
    overlay.dataset.e2eId = `standalone-parity-${kind}-overlay`;
    const dialog = document.createElement('div');
    dialog.className = 'modal standalone-parity-dialog';
    dialog.dataset.e2eId = `standalone-parity-${kind}-dialog`;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', title);
    dialog.tabIndex = -1;
    dialog.style.maxWidth = 'min(520px, calc(100vw - 24px))';
    dialog.style.maxHeight = 'min(720px, calc(100vh - 24px))';
    dialog.style.overflow = 'auto';
    const heading = document.createElement('h2');
    heading.textContent = title;
    heading.style.margin = '0 0 8px';
    heading.style.fontSize = '18px';
    const message = document.createElement('p');
    message.textContent = description || '';
    message.dataset.e2eId = `standalone-parity-${kind}-message`;
    message.style.margin = '0 0 16px';
    dialog.append(heading, message);
    overlay.appendChild(dialog);
    overlay.addEventListener('pointerdown', event => {
      if (event.target === overlay) closeOverlay(kind, focusReturn);
    });
    overlay.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeOverlay(kind, focusReturn);
    });
    document.body.appendChild(overlay);
    const record = { overlay, dialog, message, focusReturn };
    if (kind === 'link') linkDialog = record;
    else openDialog = record;
    global.GBModalShell?.enhanceOverlay?.(overlay);
    queueMicrotask(() => dialog.focus());
    return record;
  }

  async function openTarget(targetInput, destination, hints) {
    const target = resolveTarget(targetInput, hints);
    if (!target.path) {
      global.showStatus?.('リンク先が指定されていません', true);
      return false;
    }
    if (destination === 'float') {
      if (typeof currentConfig?.openFloat !== 'function') {
        global.showStatus?.('この画面では副画面を利用できません', true);
        return false;
      }
      return await currentConfig.openFloat(target, hints) !== false;
    }
    if (destination === 'main') {
      return isNativeMode() ? openNativeTarget(target, 'main', hints) : openWindow(mainUrl(target, hints));
    }
    if (appForTarget(target) === 'viewer' && isCloud()) {
      return openWindow(mainUrl(target, hints));
    }
    if (!target.recognized || !appForTarget(target)) {
      showOpenTargetDialog(target, target.recognized
        ? 'この形式は単独アプリ内では表示できません。Meldex本体で開いてください。'
        : 'このファイル形式を単独アプリで表示できません。Meldex本体なら対応アプリを確認できます。');
      return false;
    }
    if (destination === 'new') {
      return isNativeMode() ? openNativeTarget(target, 'new', hints) : openWindow(standaloneUrl(target));
    }
    if (destination === 'current') {
      const targetApp = appForTarget(target);
      if (targetApp === currentConfig?.appId && typeof currentConfig.openCurrent === 'function') {
        if (typeof currentConfig.canReplaceCurrent !== 'function') {
          throw new Error('現在の編集内容を安全に切り替える準備ができていません');
        }
        if (!await currentConfig.canReplaceCurrent(target)) return false;
        await currentConfig.openCurrent(target.path, target);
        return true;
      }
      const url = standaloneUrl(target);
      if (!url) return openWindow(mainUrl(target, hints));
      global.location.assign(url);
      return true;
    }
    return false;
  }

  function showOpenTargetDialog(targetInput, reason) {
    const target = resolveTarget(targetInput);
    const supportedStandalone = canOpenStandalone(target) && target.recognized !== false;
    const record = createOverlay(
      'open',
      '表示先を選択',
      reason || `${target.label || basename(target.path)} をどこに表示するか選んでください。`,
    );
    const actions = document.createElement('div');
    actions.style.display = 'grid';
    actions.style.gap = '8px';
    if (supportedStandalone) {
      const current = makeButton('現在の画面で開く', 'standalone-open-current', true);
      const separate = makeButton('新しいウィンドウで開く', 'standalone-open-new', false);
      current.addEventListener('click', () => {
        closeOverlay('open', record.focusReturn);
        Promise.resolve(openTarget(target, 'current')).catch(error => global.showStatus?.(error?.message || error, true));
      });
      separate.addEventListener('click', () => {
        closeOverlay('open', record.focusReturn);
        openTarget(target, 'new');
      });
      actions.append(current, separate);
    }
    const main = makeButton('Meldex本体で開く', 'standalone-open-main', !supportedStandalone);
    const back = makeButton('戻る', 'standalone-open-back', false);
    main.addEventListener('click', () => {
      closeOverlay('open', record.focusReturn);
      openTarget(target, 'main');
    });
    back.addEventListener('click', () => closeOverlay('open', record.focusReturn));
    actions.append(main, back);
    record.dialog.appendChild(actions);
    return true;
  }

  async function pickLinkTarget() {
    if (isCloud() && global.MeldexStandaloneWorkspaceTree?.pickOpen) {
      return global.MeldexStandaloneWorkspaceTree.pickOpen({ title: 'リンク先を検索' });
    }
    throw new Error('Meldexファイル検索を利用してください');
  }

  function linkResultForPath(path) {
    const resolved = resolveTarget(path);
    const fileType = resolved.type === 'scriptnote' ? 'scenario'
      : resolved.type === 'pivot' ? 'database'
        : resolved.type;
    return { type: 'file', name: resolved.label || basename(path), path, fileType };
  }

  function showLinkDialog(savedRange, callback) {
    const record = createOverlay(
      'link',
      'リンクを挿入',
      'Meldex内のファイルを検索するか、外部URLを入力してください。',
    );
    const selected = document.createElement('div');
    selected.dataset.e2eId = 'standalone-link-selected';
    selected.style.minHeight = '24px';
    selected.style.marginBottom = '8px';
    selected.style.wordBreak = 'break-all';
    selected.textContent = 'ファイルは選択されていません';
    const error = document.createElement('div');
    error.dataset.e2eId = 'standalone-link-error';
    error.setAttribute('role', 'alert');
    error.style.color = 'var(--danger, #f66)';
    error.style.minHeight = '20px';
    const pick = makeButton('Meldexファイルを検索', 'standalone-link-pick', false);
    pick.hidden = !isCloud();
    let pickedResult = null;
    pick.addEventListener('click', async () => {
      error.textContent = '';
      try {
        const picked = await pickLinkTarget();
        if (!picked?.path) return;
        pickedResult = linkResultForPath(picked.path);
        selected.textContent = pickedResult.path;
      } catch (cause) {
        error.textContent = 'リンク先を選べませんでした: ' + (cause?.message || cause);
      }
    });
    const searchLabel = document.createElement('label');
    searchLabel.textContent = 'Meldexファイルを検索';
    searchLabel.htmlFor = 'standalone-link-search';
    const search = document.createElement('input');
    search.id = 'standalone-link-search';
    search.className = 'gb-input';
    search.type = 'search';
    search.placeholder = 'ファイル名またはパス';
    search.dataset.e2eId = 'standalone-link-search';
    search.style.width = '100%';
    search.style.minHeight = '44px';
    const results = document.createElement('div');
    results.dataset.e2eId = 'standalone-link-results';
    results.setAttribute('role', 'listbox');
    results.style.display = 'grid';
    results.style.gap = '4px';
    results.style.maxHeight = '240px';
    results.style.overflow = 'auto';
    let candidates = [];
    const renderCandidates = () => {
      const query = search.value.trim().toLocaleLowerCase('ja');
      results.replaceChildren();
      candidates
        .filter(item => !query || `${item.name || ''} ${item.path || ''}`.toLocaleLowerCase('ja').includes(query))
        .slice(0, 100)
        .forEach(item => {
          const row = makeButton(item.name || basename(item.path), 'standalone-link-result', false);
          row.setAttribute('role', 'option');
          row.title = item.path;
          row.style.textAlign = 'left';
          row.addEventListener('click', () => {
            pickedResult = linkResultForPath(item.path);
            selected.textContent = pickedResult.path;
            results.querySelectorAll('[role="option"]').forEach(option => {
              option.setAttribute('aria-selected', option === row ? 'true' : 'false');
            });
          });
          results.appendChild(row);
        });
      if (!results.children.length) {
        const empty = document.createElement('div');
        empty.textContent = query ? '一致するファイルはありません' : 'リンクにできるファイルはありません';
        empty.style.color = 'var(--fg2)';
        empty.style.padding = '8px';
        results.appendChild(empty);
      }
    };
    search.addEventListener('input', renderCandidates);
    Promise.resolve(global.apiFetch?.('/global-index'))
      .then(payload => {
        const files = Array.isArray(payload) ? payload : payload?.files;
        candidates = (Array.isArray(files) ? files : [])
          .map(item => typeof item === 'string'
            ? { path: item, name: basename(item) }
            : { path: text(item?.path), name: text(item?.name || basename(item?.path)) })
          .filter(item => item.path);
        renderCandidates();
      })
      .catch(cause => {
        error.textContent = 'ファイル一覧を読み込めませんでした: ' + (cause?.message || cause);
        renderCandidates();
      });
    const label = document.createElement('label');
    label.textContent = '外部URL';
    label.htmlFor = 'standalone-link-url';
    const input = document.createElement('input');
    input.id = 'standalone-link-url';
    input.className = 'gb-input';
    input.type = 'url';
    input.placeholder = 'https://...';
    input.dataset.e2eId = 'standalone-link-url';
    input.style.width = '100%';
    input.style.minHeight = '44px';
    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.flexWrap = 'wrap';
    actions.style.gap = '8px';
    actions.style.marginTop = '12px';
    const insert = makeButton('リンクを挿入', 'standalone-link-insert', true);
    const back = makeButton('戻る', 'standalone-link-back', false);
    insert.addEventListener('click', () => {
      const url = input.value.trim();
      let result = pickedResult;
      if (url) {
        try {
          const parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url);
          if (!['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) throw new Error();
          result = { type: 'url', url: parsed.href };
        } catch (cause) {
          error.textContent = '安全なURLを入力してください';
          return;
        }
      }
      if (!result) {
        error.textContent = 'リンク先を選択するかURLを入力してください';
        return;
      }
      closeOverlay('link', record.focusReturn);
      callback?.(result, savedRange || null);
    });
    back.addEventListener('click', () => closeOverlay('link', record.focusReturn));
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        insert.click();
      }
    });
    record.dialog.append(searchLabel, search, results, pick, selected, label, input, error, actions);
    actions.append(insert, back);
    queueMicrotask(() => pick.focus());
  }

  function fallbackPanelHtml(feature, classification, path) {
    const label = FEATURE_LABELS[feature] || feature;
    const reason = classification?.reason || `${label}はこの単独版ではMeldex本体から利用します。`;
    const routeReason = classification?.route?.reason || '';
    const pathMessage = path ? '' : '対象ファイルを保存または開いた後に利用できます。';
    return `<div data-standalone-feature-fallback="${feature}" style="padding:16px;display:grid;gap:12px;">`
      + `<div style="font-weight:600;">${label}</div>`
      + `<div style="color:var(--fg2);line-height:1.6;">${global.esc?.(reason) || reason}</div>`
      + (routeReason ? `<div style="color:var(--fg2);line-height:1.6;">${global.esc?.(routeReason) || routeReason}</div>` : '')
      + (pathMessage ? `<div style="color:var(--warning,#e9b44c);">${pathMessage}</div>` : '')
      + `<button type="button" class="gb-btn gb-btn-primary" data-standalone-open-main="${feature}" `
      + `style="min-height:44px;">Meldex本体で開く</button></div>`;
  }

  function ensureOptionFeature(feature, path) {
    const bar = document.getElementById('detail-tab-bar');
    const detail = document.getElementById('rp-detail');
    if (!bar || !detail) return null;
    const id = `standalone-${feature.replace(/_/g, '-')}`;
    let button = bar.querySelector(`[data-detail-tab="${id}"]`);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'gb-inner-tab detail-tab';
      button.dataset.detailTab = id;
      button.dataset.e2eId = `detail-tab-${id}`;
      button.setAttribute('role', 'tab');
      button.textContent = FEATURE_LABELS[feature] || feature;
      button.style.minHeight = '44px';
      bar.appendChild(button);
    }
    button.hidden = false;
    let panel = document.getElementById(`detail-tab-${id}`);
    if (!panel) {
      panel = document.createElement('div');
      panel.id = `detail-tab-${id}`;
      panel.className = 'gb-panel-body-scroll';
      panel.hidden = true;
      detail.appendChild(panel);
    }
    const activate = event => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      bar.querySelectorAll('[data-detail-tab]').forEach(item => {
        item.classList.toggle('active', item === button);
        item.setAttribute('aria-selected', item === button ? 'true' : 'false');
      });
      detail.querySelectorAll(':scope > [id^="detail-tab-"]').forEach(item => {
        item.hidden = item !== panel;
      });
      panel.hidden = false;
    };
    if (button.dataset.standaloneBound !== '1') {
      button.dataset.standaloneBound = '1';
      button.addEventListener('click', activate);
    }
    panel.querySelector('[data-standalone-open-main]')?.addEventListener('click', () => {
      const target = resolveTarget(path, { label: currentConfig?.getLabel?.() || basename(path) });
      if (target.path) openTarget(target, 'main', { feature });
      else openWindow(mainUrl(null));
    });
    return { button, panel, activate };
  }

  async function renderOptionFeature(feature, path, revision) {
    const parts = ensureOptionFeature(feature, path);
    if (!parts || revision !== optionRevision) return;
    const capability = feature === 'annotations_comments' ? 'annotations_comments' : feature;
    const classification = classify(capability);
    if (feature === 'file_info' && classification.status === 'available'
        && global.MeldexFileInfoPanel?.renderInto) {
      if (!path) {
        await global.MeldexFileInfoPanel.renderInto(parts.panel, '', { showTags: false });
        return;
      }
      try {
        const metadata = await global.apiFetch?.('/file-meta?path=' + encodeURIComponent(path), { silentError: true });
        if (revision !== optionRevision) return;
        await global.MeldexFileInfoPanel.renderInto(parts.panel, path, {
          showTags: false,
          preloadedMeta: { ...(metadata || {}), embedded: metadata?.embedded ?? null },
        });
        return;
      } catch (cause) {
        parts.panel.innerHTML = fallbackPanelHtml(feature, {
          status: 'alternative',
          reason: 'この単独ランタイムでは作成日時・更新日時・ファイルサイズを取得できません。',
          route: { reason: '完全なファイル情報はMeldex本体で確認してください。' },
        }, path);
        parts.panel.querySelector('[data-standalone-open-main]')?.addEventListener('click', () => {
          openTarget(
            resolveTarget(path, { label: currentConfig?.getLabel?.() || basename(path) }),
            'main',
            { feature },
          );
        });
        return;
      }
    }
    parts.panel.innerHTML = fallbackPanelHtml(feature, classification, path);
    parts.panel.querySelector('[data-standalone-open-main]')?.addEventListener('click', () => {
      const target = resolveTarget(path, { label: currentConfig?.getLabel?.() || basename(path) });
      if (target.path) openTarget(target, 'main', { feature });
      else openWindow(mainUrl(null));
    });
  }

  async function syncOptionFeatures() {
    const path = text(currentConfig?.getPath?.()).trim();
    const revision = ++optionRevision;
    await Promise.all([
      renderOptionFeature('file_info', path, revision),
      renderOptionFeature('publish', path, revision),
      renderOptionFeature('backlinks', path, revision),
      renderOptionFeature('annotations_comments', path, revision),
    ]);
  }

  function watchOptionPanel() {
    optionObserver?.disconnect();
    const detail = document.getElementById('rp-detail');
    if (!detail) return;
    optionObserver = new MutationObserver(() => {
      if (document.getElementById('detail-tab-standalone-file-info')) return;
      queueMicrotask(() => syncOptionFeatures().catch(error => console.error('[standalone-parity] option sync failed', error)));
    });
    optionObserver.observe(detail, { childList: true, subtree: true });
  }

  async function openOptionFeature(feature, path) {
    await syncOptionFeatures();
    const targetPath = text(path || currentConfig?.getPath?.()).trim();
    const parts = ensureOptionFeature(feature, targetPath);
    if (!parts) {
      showOpenTargetDialog(resolveTarget(targetPath), `${FEATURE_LABELS[feature] || feature}はMeldex本体で利用できます。`);
      return false;
    }
    if (targetPath) {
      const shell = document.querySelector('.sa-shell');
      shell?.classList.remove('sa-options-collapsed');
      document.querySelectorAll('[data-e2e-id$="-option-panel-button"]').forEach(button => {
        button.setAttribute('aria-pressed', 'true');
      });
    }
    parts.activate();
    return true;
  }

  function installGlobalOpeners() {
    global.openLink = function (path, label, options) {
      return showOpenTargetDialog(resolveTarget(path, { label, linkType: options?.linkType || options?.type }));
    };
    global.openLinkInFloatPanel = global.openLink;
    global.openLinkInRightPane = global.openLink;
    global.openLinkInMainPane = function (path, label, options) {
      return openTarget(resolveTarget(path, { label, linkType: options?.linkType || options?.type }), 'main');
    };
    global.openLinkStandalone = global.openLink;
    global.openViewer = function (path, label) {
      return showOpenTargetDialog(resolveTarget(path, { label }));
    };
    global.openMedia = function (label, path, mediaType) {
      return showOpenTargetDialog(resolveTarget(path, { label, linkType: mediaType }));
    };
    global._showFileInfoInDetailPanel = function (_label, path) {
      return openOptionFeature('file_info', path);
    };
    global.addCommentHere = function (override) {
      const path = text(override?.filePath || currentConfig?.getPath?.()).trim();
      const target = resolveTarget(path, { label: currentConfig?.getLabel?.() || basename(path) });
      return openWindow(mainUrl(target, {
        feature: 'annotations_comments',
        targetKind: override?.targetKind || '',
        targetRef: override?.targetRef || null,
        snapshot: override?.snapshot || '',
        action: 'add',
      }));
    };
    global.CommentBadges = global.CommentBadges || {
      openPanelForFileComments(path) {
        return openWindow(mainUrl(resolveTarget(path), { feature: 'annotations_comments' }));
      },
    };
  }

  function init(options) {
    currentConfig = { ...(options || {}) };
    if (!currentConfig.appId) throw new Error('standalone parity adapter requires appId');
    installGlobalOpeners();
    global.showLinkInsertModal = showLinkDialog;
    watchOptionPanel();
    return {
      classify,
      environment,
      openTarget,
      capabilities: nativeCapabilities,
      showOpenTargetDialog,
      showLinkDialog,
      syncOptionFeatures,
      openOptionFeature,
    };
  }

  function startMainFeatureHandoff() {
    const params = new URLSearchParams(global.location?.search || '');
    const feature = text(params.get('standaloneFeature')).trim();
    if (!feature) return;
    const path = text(params.get('path')).trim();
    const targetKind = text(params.get('standaloneTargetKind')).trim();
    const snapshot = text(params.get('standaloneSnapshot'));
    const action = text(params.get('standaloneFeatureAction')).trim();
    let targetRef = null;
    try { targetRef = JSON.parse(params.get('standaloneTargetRef') || 'null'); } catch {}
    const normalizedPath = value => text(value).replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
    const targetIsActive = () => {
      const wanted = normalizedPath(path);
      if (!wanted) return true;
      const candidates = [
        document.getElementById('page-content')?.dataset?.path,
        document.getElementById('bd-canvas')?.dataset?.path,
      ];
      try {
        if (typeof state !== 'undefined') {
          candidates.push(state.currentPagePath, state.currentDbPath, state.currentBoardPath, state.currentEntityPath);
        }
      } catch {}
      try {
        const tab = typeof GBTabs !== 'undefined' ? GBTabs.getActiveTab?.(typeof GBLayout !== 'undefined' ? GBLayout.activePane : undefined) : null;
        candidates.push(
          tab?.path,
          tab?.state?.pagePath,
          tab?.state?.dbPath,
          tab?.state?.smartDbPath,
          tab?.state?.boardPath,
          tab?.state?.scenarioPath,
          tab?.state?.scriptnotePath,
        );
      } catch {}
      return candidates.some(candidate => normalizedPath(candidate) === wanted);
    };
    let attempts = 0;
    const run = () => {
      attempts += 1;
      try {
        if (feature === 'annotations_comments') {
          if (action === 'add' && typeof global.addCommentHere === 'function') {
            global.addCommentHere({ filePath: path, targetKind, targetRef, snapshot });
            return;
          }
          if (global.CommentBadges?.openPanelForTarget && targetKind) {
            global.CommentBadges.openPanelForTarget(path, targetKind, targetRef || { file: path });
            return;
          }
          if (global.CommentBadges?.openPanelForFileComments) {
            global.CommentBadges.openPanelForFileComments(path);
            return;
          }
        } else if (feature === 'file_info' && typeof global._showFileInfoInDetailPanel === 'function') {
          global._showFileInfoInDetailPanel(basename(path), path);
          return;
        } else if (['publish', 'backlinks'].includes(feature)
            && targetIsActive()
            && typeof global.switchDetailTab === 'function') {
          global.switchDetailTab(feature);
          return;
        }
      } catch (error) {
        console.warn('[standalone-parity] 本体機能への引き継ぎを再試行します', error);
      }
      if (attempts < 240) {
        global.setTimeout(run, 250);
        return;
      }
      const label = FEATURE_LABELS[feature] || feature;
      global.showStatus?.(
        `対象ファイルの読み込みに時間がかかったため「${label}」を自動で開けませんでした。`
          + `読み込み完了後にオプションパネルから「${label}」を選び直してください。`,
        true,
      );
    };
    global.setTimeout(run, 700);
  }

  global.MeldexStandaloneParity = Object.freeze({
    init,
    classify,
    environment,
    resolveTarget,
    canOpenStandalone,
    openTarget,
    capabilities: nativeCapabilities,
    showOpenTargetDialog,
    showLinkDialog,
    syncOptionFeatures,
    openOptionFeature,
  });
  if (document.readyState === 'loading') {
    global.addEventListener('DOMContentLoaded', startMainFeatureHandoff, { once: true });
  } else {
    startMainFeatureHandoff();
  }
})(window);
