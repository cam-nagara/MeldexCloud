/* Responsive tag recovery maintenance UI shared by Desktop and Cloud/PWA. */
(function () {
  'use strict';

  const runtime = {
    root: null,
    job: null,
    stepping: false,
    disposed: false,
    capabilities: null,
    pendingManifest: null,
  };

  function sourceFolder() {
    return String(window.MeldexTagManagement?.sourceFolder?.() || '');
  }

  function payload(extra) {
    const source = sourceFolder();
    return {
      ...(extra || {}),
      ...(source ? { source_folder: source } : {}),
    };
  }

  function scopedUrl(path) {
    const source = sourceFolder();
    if (!source) return path;
    return `${path}${path.includes('?') ? '&' : '?'}source_folder=${encodeURIComponent(source)}`;
  }

  function selectedFilePaths() {
    const context = window.MeldexTagManagement?.targetContext?.() || {};
    return (Array.isArray(context.targets) ? context.targets : [])
      .filter(item => item?.path && !item?.recursive)
      .map(item => String(item.path));
  }

  function selectedSingleFile() {
    const paths = selectedFilePaths();
    if (paths.length !== 1) {
      statusText('復旧IDの操作対象となるファイルを1件選択してください', true);
      return '';
    }
    return paths[0];
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function statusText(message, error) {
    const target = runtime.root?.querySelector('[data-tag-maintenance-message]');
    if (!target) return;
    target.textContent = String(message || '');
    target.dataset.error = error ? '1' : '0';
  }

  function isReadonly() {
    return document.body?.dataset?.cloudReadonly === '1';
  }

  function setBusy(value) {
    runtime.root?.querySelectorAll('[data-tag-maintenance-write]').forEach(button => {
      const isCancel = button.hasAttribute('data-tag-maintenance-cancel');
      const unsupportedEmbedding = button.hasAttribute('data-tag-maintenance-requires-embedding')
        && runtime.capabilities?.embedding === false;
      const unsupportedManifest = button.hasAttribute('data-tag-maintenance-requires-manifest')
        && runtime.capabilities?.manifest === false;
      button.disabled = isReadonly() || unsupportedEmbedding || unsupportedManifest || (!!value && !isCancel);
    });
  }

  function candidateLabel(candidate) {
    const labels = {
      move: '移動候補',
      copy: 'コピー候補',
      missing: '見つからないファイル',
      replacement: '同じ場所の別ファイル',
      ambiguous: '確認が必要',
      discover: '新しく見つかったファイル',
    };
    return labels[candidate?.kind] || '復旧候補';
  }

  function pathSummary(candidate) {
    const oldPath = String(candidate?.old_path || '');
    const newPath = String(candidate?.new_path || '');
    if (oldPath && newPath && oldPath !== newPath) return `${oldPath} → ${newPath}`;
    return oldPath || newPath || '場所を確認できません';
  }

  function reasonText(candidate) {
    const reason = String(candidate?.evidence?.reason || '');
    const labels = {
      'stable-os-id': 'OSのファイル識別子が一致',
      'os-watcher-move': 'OSの移動通知を検出',
      'metadata-fingerprint': 'サイズと更新日時が一致',
      'active-locator-not-seen': '前回の場所に見つからない',
      'same-path-different-os-id': '同じ場所で別の実体を検出',
      'dropbox-stable-id': 'DropboxのファイルIDが一致',
      'dropbox-content-hash': 'Dropboxの内容識別子が一致',
      'dropbox-deleted-entry': 'Dropboxの削除情報を検出',
      'same-path-different-dropbox-id': '同じ場所で別のDropboxファイルを検出',
    };
    return labels[reason] || (
      candidate?.confidence === 'exact'
        ? '一意に判定できました'
        : candidate?.confidence === 'high'
          ? '一致する可能性が高い候補です'
          : '手掛かりが複数あります'
    );
  }

  async function candidateAction(candidate, resolution) {
    setBusy(true);
    try {
      await apiPost(
        `/tag-maintenance/candidates/${encodeURIComponent(candidate.candidate_id)}/apply`,
        payload(resolution ? { resolution } : {}),
      );
      statusText('復旧結果を保存しました');
      await refresh();
    } catch (error) {
      statusText(`復旧できませんでした: ${error?.message || error}`, true);
    } finally {
      setBusy(false);
    }
  }

  async function dismissCandidate(candidate) {
    setBusy(true);
    try {
      await apiPost(
        `/tag-maintenance/candidates/${encodeURIComponent(candidate.candidate_id)}/status`,
        payload({ status: 'dismissed' }),
      );
      statusText('候補を確認済みにしました');
      await refresh();
    } catch (error) {
      statusText(`候補を更新できませんでした: ${error?.message || error}`, true);
    } finally {
      setBusy(false);
    }
  }

  function actionButton(label, action, options) {
    const button = element('button', `gb-btn gb-btn-sm ${options?.primary ? 'primary' : ''}`, label);
    button.type = 'button';
    button.dataset.tagMaintenanceWrite = '1';
    if (options?.e2eId) button.dataset.e2eId = options.e2eId;
    button.addEventListener('click', action);
    return button;
  }

  function renderCandidates(items) {
    const host = runtime.root?.querySelector('[data-tag-maintenance-candidates]');
    if (!host) return;
    host.replaceChildren();
    const candidates = Array.isArray(items) ? items : [];
    if (!candidates.length) {
      host.append(element('div', 'gb-section-desc tag-maintenance-empty', '確認が必要な候補はありません。'));
      return;
    }
    candidates.forEach(candidate => {
      const card = element('article', 'tag-maintenance-candidate');
      const header = element('div', 'tag-maintenance-candidate-head');
      header.append(
        element('strong', '', candidateLabel(candidate)),
        element(
          'span',
          `tag-maintenance-confidence is-${candidate.confidence || 'ambiguous'}`,
          candidate.confidence === 'exact'
            ? '自動判定'
            : candidate.confidence === 'high' ? '高い一致' : '要確認',
        ),
      );
      card.append(
        header,
        element('div', 'tag-maintenance-path', pathSummary(candidate)),
        element('div', 'gb-section-desc', reasonText(candidate)),
      );
      const actions = element('div', 'tag-maintenance-actions');
      if (candidate.kind === 'ambiguous') {
        actions.append(
          actionButton('移動として復旧', () => candidateAction(candidate, 'move'), { primary: true, e2eId: `tag-maintenance-move-${candidate.candidate_id}` }),
          actionButton('コピーとして復旧', () => candidateAction(candidate, 'copy'), { e2eId: `tag-maintenance-copy-${candidate.candidate_id}` }),
          actionButton('別ファイル', () => candidateAction(candidate, 'different'), { e2eId: `tag-maintenance-different-${candidate.candidate_id}` }),
        );
      } else if (candidate.kind === 'missing') {
        actions.append(actionButton('削除済みとして保持', () => candidateAction(candidate, 'missing'), { primary: true, e2eId: `tag-maintenance-missing-${candidate.candidate_id}` }));
      } else if (!['replacement', 'discover'].includes(candidate.kind)) {
        actions.append(actionButton('この内容で復旧', () => candidateAction(candidate), { primary: true, e2eId: `tag-maintenance-apply-${candidate.candidate_id}` }));
      }
      actions.append(actionButton('候補から外す', () => dismissCandidate(candidate), { e2eId: `tag-maintenance-dismiss-${candidate.candidate_id}` }));
      card.append(actions);
      host.append(card);
    });
  }

  async function undoEvent(event) {
    setBusy(true);
    try {
      await apiPost(
        `/tag-maintenance/events/${encodeURIComponent(event.event_id)}/undo`,
        payload({}),
      );
      statusText('直前のタグ変更を取り消しました');
      await refresh();
    } catch (error) {
      statusText(`取り消せませんでした: ${error?.message || error}`, true);
    } finally {
      setBusy(false);
    }
  }

  function renderEvents(items) {
    const host = runtime.root?.querySelector('[data-tag-maintenance-events]');
    if (!host) return;
    host.replaceChildren();
    const events = (Array.isArray(items) ? items : []).slice(0, 8);
    if (!events.length) {
      host.append(element('div', 'gb-section-desc tag-maintenance-empty', '復旧履歴はまだありません。'));
      return;
    }
    events.forEach(event => {
      const row = element('div', 'tag-maintenance-event');
      const description = element('div', '');
      const operationLabels = {
        move: '移動を追従',
        copy: 'コピーへタグを複製',
        delete: '削除情報を保持',
        restore: '復元ファイルへ再接続',
        reconcile: '差分照合で復旧',
        assignment: 'タグを変更',
        discover: 'ファイルを登録',
      };
      description.append(
        element('strong', '', operationLabels[event.operation] || '復旧処理'),
        element('div', 'gb-section-desc', String(event.recorded_at || '')),
      );
      row.append(description);
      if (event.operation === 'assignment' && !event.undone_at) {
        row.append(actionButton('取り消す', () => undoEvent(event), { e2eId: `tag-maintenance-undo-${event.event_id}` }));
      }
      host.append(row);
    });
  }

  function renderSummary(status) {
    const summary = status?.recovery || {};
    const pending = (status?.candidates || [])
      .filter(item => ['pending', 'reopened'].includes(String(item.status || '')))
      .reduce((total, item) => total + Number(item.total || 0), 0);
    const values = {
      events: Number(summary.events || 0),
      pending,
      retries: Number(summary.pending_retries || 0),
      deleted: Number(summary.deleted || 0),
      ambiguous: Number(summary.ambiguous || 0),
    };
    Object.entries(values).forEach(([name, value]) => {
      const target = runtime.root?.querySelector(`[data-tag-maintenance-count="${name}"]`);
      if (target) target.textContent = value.toLocaleString('ja-JP');
    });
    runtime.job = status?.job || null;
    const progress = runtime.root?.querySelector('[data-tag-maintenance-progress]');
    if (progress) {
      const job = runtime.job;
      progress.textContent = job
        ? `状態: ${job.status || '待機'} / 確認済み ${Number(job.scanned || 0).toLocaleString('ja-JP')}件 / 候補 ${Number(job.candidate_count || 0).toLocaleString('ja-JP')}件`
        : '差分照合はまだ実行されていません。';
    }
    const resume = runtime.root?.querySelector('[data-tag-maintenance-resume]');
    const cancel = runtime.root?.querySelector('[data-tag-maintenance-cancel]');
    if (resume) resume.hidden = !runtime.job || !['cancelled', 'paused', 'failed'].includes(runtime.job.status);
    if (cancel) cancel.hidden = !runtime.job || runtime.job.status !== 'running';
    const monitor = Array.isArray(status?.monitors) ? status.monitors[0] : null;
    const monitorText = runtime.root?.querySelector('[data-tag-maintenance-monitor-state]');
    if (monitorText) {
      monitorText.textContent = monitor?.mode === 'cursor'
        ? 'Dropboxの差分履歴を利用'
        : monitor?.enabled
          ? '外部変更の監視中'
          : monitor?.available === false ? '自動監視は利用できません（手動照合は利用可能）' : '自動監視は停止中';
    }
  }

  async function refresh() {
    if (!runtime.root || runtime.disposed) return;
    try {
      const [status, candidates, events, capabilities] = await Promise.all([
        apiFetch(scopedUrl('/tag-maintenance/status'), { silentError: true }),
        apiFetch(scopedUrl('/tag-maintenance/candidates?status=pending&limit=100'), { silentError: true }),
        apiFetch(scopedUrl('/tag-maintenance/events?limit=20'), { silentError: true }),
        apiFetch('/tag-maintenance/portable-uid/capabilities', { silentError: true }),
      ]);
      runtime.capabilities = capabilities || { embedding: false, manifest: false };
      const manifestExport = runtime.root?.querySelector('[data-tag-maintenance-manifest-export]');
      if (manifestExport) manifestExport.disabled = runtime.capabilities.manifest === false;
      renderSummary(status || {});
      renderCandidates(candidates?.items || []);
      renderEvents(events?.items || []);
      if (!navigator.onLine) statusText('オフラインです。表示中の情報は接続時点の内容です。');
      else statusText(isReadonly() ? '閲覧専用です。候補の確認のみできます。' : '必要な時だけ差分照合を実行します。');
    } catch (error) {
      statusText(`保守情報を読み込めませんでした: ${error?.message || error}`, true);
      renderCandidates([]);
      renderEvents([]);
    }
    setBusy(false);
  }

  async function stepUntilReview(job) {
    if (runtime.stepping) return;
    runtime.stepping = true;
    let current = job;
    try {
      while (!runtime.disposed && current?.status === 'running') {
        current = await apiPost(
          `/tag-maintenance/scan/${encodeURIComponent(current.job_id)}/step`,
          payload({ max_items: 200 }),
        );
        runtime.job = current;
        renderSummary({ job: current, recovery: {}, candidates: [] });
        await new Promise(resolve => window.setTimeout(resolve, 0));
      }
      await refresh();
      if (current?.status === 'cancelled') {
        statusText('差分照合を中止しました。続きから再開できます。');
      } else if (['paused', 'failed'].includes(current?.status)) {
        statusText(
          `一部の場所を確認できないため差分照合を一時停止しました。接続やファイルの状態を確認して「続きから再開」を押してください。${current?.last_error ? ` 理由: ${current.last_error}` : ''}`,
          true,
        );
      } else {
        statusText('差分照合が完了しました。候補を確認してください。');
      }
    } catch (error) {
      statusText(`差分照合を続行できませんでした: ${error?.message || error}`, true);
      await refresh();
    } finally {
      runtime.stepping = false;
      setBusy(false);
    }
  }

  async function startScan(force) {
    setBusy(true);
    statusText('外部変更を確認しています…');
    try {
      const job = await apiPost('/tag-maintenance/scan', payload({ force: !!force }));
      runtime.job = job;
      await stepUntilReview(job);
    } catch (error) {
      statusText(`差分照合を開始できませんでした: ${error?.message || error}`, true);
      setBusy(false);
    }
  }

  async function cancelScan() {
    if (!runtime.job?.job_id) return;
    try {
      const job = await apiPost(
        `/tag-maintenance/scan/${encodeURIComponent(runtime.job.job_id)}/cancel`,
        payload({}),
      );
      runtime.job = job;
      statusText('中止を受け付けました');
    } catch (error) {
      statusText(`中止できませんでした: ${error?.message || error}`, true);
    }
  }

  async function resumeScan() {
    if (!runtime.job?.job_id) return;
    setBusy(true);
    try {
      const job = await apiPost(
        `/tag-maintenance/scan/${encodeURIComponent(runtime.job.job_id)}/resume`,
        payload({}),
      );
      await stepUntilReview(job);
    } catch (error) {
      statusText(`再開できませんでした: ${error?.message || error}`, true);
      setBusy(false);
    }
  }

  async function retryPending() {
    setBusy(true);
    try {
      const result = await apiPost('/tag-maintenance/retry', payload({ limit: 20 }));
      statusText(`再試行: 成功 ${Number(result.completed || 0)}件 / 失敗 ${Number(result.failed || 0)}件`);
      await refresh();
    } catch (error) {
      statusText(`再試行できませんでした: ${error?.message || error}`, true);
    } finally {
      setBusy(false);
    }
  }

  async function rebuild(dryRun) {
    setBusy(true);
    try {
      const result = await apiPost('/tag-maintenance/rebuild', payload({ dry_run: !!dryRun }));
      const count = Number(result.repaired ?? result.assignment_count ?? result.assignments ?? 0);
      statusText(dryRun
        ? `整合性確認が完了しました。再構築対象: ${count.toLocaleString('ja-JP')}件`
        : `タグ索引を再構築しました: ${count.toLocaleString('ja-JP')}件`);
      await refresh();
    } catch (error) {
      statusText(`タグ索引を確認できませんでした: ${error?.message || error}`, true);
    } finally {
      setBusy(false);
    }
  }

  async function toggleMonitor(start) {
    setBusy(true);
    try {
      const result = await apiPost(
        `/tag-maintenance/monitor/${start ? 'start' : 'stop'}`,
        payload({}),
      );
      statusText(result?.available === false
        ? '自動監視は利用できません。手動の差分照合をご利用ください。'
        : start ? '外部変更の監視を開始しました' : '外部変更の監視を停止しました');
      await refresh();
    } catch (error) {
      statusText(`監視設定を変更できませんでした: ${error?.message || error}`, true);
    } finally {
      setBusy(false);
    }
  }

  async function writePortableUid(regenerate) {
    const path = selectedSingleFile();
    if (!path) return;
    setBusy(true);
    try {
      const result = await apiPost(
        '/tag-maintenance/portable-uid/write',
        payload({ path, regenerate: !!regenerate }),
      );
      statusText(
        result.changed
          ? `復旧IDを${regenerate ? '再生成' : '追加'}しました。元ファイルは保守バックアップ済みです。`
          : 'このファイルには既に復旧IDがあります。',
      );
    } catch (error) {
      statusText(`復旧IDを保存できませんでした: ${error?.message || error}`, true);
    } finally {
      setBusy(false);
    }
  }

  async function removePortableUid() {
    const path = selectedSingleFile();
    if (!path) return;
    const confirmed = typeof cfConfirm === 'function'
      ? await cfConfirm('選択ファイル内の復旧IDを削除します。タグ自体は削除されません。続行しますか？')
      : window.confirm('選択ファイル内の復旧IDを削除しますか？');
    if (!confirmed) return;
    setBusy(true);
    try {
      const result = await apiPost('/tag-maintenance/portable-uid/remove', payload({ path }));
      statusText(result.changed ? '復旧IDを削除しました。元ファイルは保守バックアップ済みです。' : '復旧IDはありません。');
    } catch (error) {
      statusText(`復旧IDを削除できませんでした: ${error?.message || error}`, true);
    } finally {
      setBusy(false);
    }
  }

  async function writePortableBatch() {
    setBusy(true);
    try {
      const result = await apiPost('/tag-maintenance/portable-uid/batch', payload({ limit: 20 }));
      statusText(
        `復旧ID: 追加 ${Number(result.embedded || 0)}件 / 既存IDを接続 ${Number(result.linked || 0)}件 / 未対応・保留 ${Number(result.skipped || 0)}件`
        + (result.has_more ? '。残りはもう一度実行できます。' : '。対象分が完了しました。'),
      );
    } catch (error) {
      statusText(`復旧IDの一括追加を続行できませんでした: ${error?.message || error}`, true);
    } finally {
      setBusy(false);
    }
  }

  function downloadJson(value, filename) {
    const blob = new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function exportManifest() {
    const paths = selectedFilePaths();
    if (!paths.length) {
      statusText('タグ情報付きで書き出すファイルを選択してください。フォルダ選択ではなくファイルを選びます。', true);
      return;
    }
    setBusy(true);
    try {
      const manifest = await apiPost('/tag-maintenance/manifest/export', payload({ paths }));
      downloadJson(manifest, `meldex-tags-${new Date().toISOString().slice(0, 10)}.json`);
      statusText(`${paths.length.toLocaleString('ja-JP')}件のタグ受け渡しJSONを書き出しました`);
    } catch (error) {
      statusText(`タグ受け渡しJSONを書き出せませんでした: ${error?.message || error}`, true);
    } finally {
      setBusy(false);
    }
  }

  function renderManifestPreview(preview) {
    const host = runtime.root?.querySelector('[data-tag-maintenance-manifest-preview]');
    if (!host) return;
    host.replaceChildren();
    if (!preview) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    host.append(element(
      'div',
      'gb-section-desc',
      `ファイル ${Number(preview.files || 0).toLocaleString('ja-JP')}件（見つからないファイル ${Number(preview.missing_files || 0).toLocaleString('ja-JP')}件） / タグ ${Number(preview.tags || 0).toLocaleString('ja-JP')}件 / グループ ${Number(preview.groups || 0).toLocaleString('ja-JP')}件`,
    ));
    (preview.conflicts || []).forEach(conflict => {
      const row = element('label', 'tag-maintenance-manifest-conflict');
      row.append(element('span', '', `「${conflict.name}」は既存定義と重なります`));
      const select = element('select', 'gb-select');
      select.dataset.manifestConflict = conflict.source_uid;
      const placeholder = element('option', '', '読み込み方法を選択');
      placeholder.value = '';
      select.append(placeholder);
      (conflict.existing || []).forEach(existing => {
        const option = element('option', '', `既存の「${existing.name}」を使う`);
        option.value = `use:${existing.id}`;
        select.append(option);
      });
      const create = element('option', '', '別の定義として追加');
      create.value = 'new';
      select.append(create);
      row.append(select);
      host.append(row);
    });
    const apply = actionButton('確認した内容を読み込む', applyManifest, {
      primary: true,
      e2eId: 'tag-maintenance-manifest-apply',
    });
    host.append(apply);
  }

  async function previewManifestFile(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      statusText('タグ受け渡しJSONが大きすぎます', true);
      return;
    }
    setBusy(true);
    try {
      const manifest = JSON.parse(await file.text());
      const preview = await apiPost('/tag-maintenance/manifest/preview', payload({ manifest }));
      runtime.pendingManifest = manifest;
      renderManifestPreview(preview);
      statusText(preview.can_apply ? '内容を確認して読み込めます' : '重なるタグ・グループの扱いを選択してください');
    } catch (error) {
      runtime.pendingManifest = null;
      renderManifestPreview(null);
      statusText(`タグ受け渡しJSONを確認できませんでした: ${error?.message || error}`, true);
    } finally {
      setBusy(false);
    }
  }

  async function applyManifest() {
    if (!runtime.pendingManifest) return;
    const resolutions = {};
    for (const select of runtime.root.querySelectorAll('[data-manifest-conflict]')) {
      if (!select.value) {
        statusText('重なるタグ・グループの読み込み方法をすべて選択してください', true);
        return;
      }
      resolutions[select.dataset.manifestConflict] = select.value;
    }
    setBusy(true);
    try {
      const result = await apiPost(
        '/tag-maintenance/manifest/import',
        payload({ manifest: runtime.pendingManifest, resolutions }),
      );
      statusText(`タグ情報を読み込みました: ${Number(result.assigned || 0).toLocaleString('ja-JP')}ファイル`);
      runtime.pendingManifest = null;
      renderManifestPreview(null);
    } catch (error) {
      statusText(`タグ情報を読み込めませんでした: ${error?.message || error}`, true);
    } finally {
      setBusy(false);
    }
  }

  function ensureStyles() {
    if (document.getElementById('tag-maintenance-settings-style')) return;
    const style = document.createElement('style');
    style.id = 'tag-maintenance-settings-style';
    style.textContent = `
      .tag-maintenance-summary{display:grid;grid-template-columns:repeat(5,minmax(92px,1fr));gap:8px;margin:10px 0}
      .tag-maintenance-metric{border:1px solid var(--border,#3b3b3b);border-radius:10px;padding:10px;background:var(--bg-secondary,#252525)}
      .tag-maintenance-metric strong{display:block;font-size:1.2rem;margin-top:3px}
      .tag-maintenance-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
      .tag-maintenance-actions .gb-btn{min-height:44px}
      .tag-maintenance-candidate{border:1px solid var(--border,#3b3b3b);border-radius:10px;padding:12px;margin-top:9px;overflow-wrap:anywhere}
      .tag-maintenance-candidate-head,.tag-maintenance-event{display:flex;align-items:center;justify-content:space-between;gap:10px}
      .tag-maintenance-confidence{font-size:.78rem;border-radius:999px;padding:3px 8px;background:var(--bg-tertiary,#303030)}
      .tag-maintenance-confidence.is-exact{color:#82d69b}.tag-maintenance-confidence.is-ambiguous{color:#f2c66d}
      .tag-maintenance-path{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.86rem;margin-top:7px}
      .tag-maintenance-event{min-height:44px;border-top:1px solid var(--border,#3b3b3b);padding:8px 0}
      .tag-maintenance-event .gb-btn{min-height:44px}
      .tag-maintenance-manifest-conflict{display:grid;grid-template-columns:minmax(160px,1fr) minmax(180px,1fr);gap:8px;align-items:center;margin-top:8px}
      .tag-maintenance-manifest-conflict .gb-select{min-height:44px;width:100%}
      [data-tag-maintenance-message][data-error="1"]{color:var(--danger,#e46b6b)}
      @media(max-width:720px){.tag-maintenance-summary{grid-template-columns:repeat(2,minmax(0,1fr))}
        .tag-maintenance-actions{display:grid;grid-template-columns:1fr}.tag-maintenance-actions .gb-btn{width:100%}
        .tag-maintenance-candidate-head{align-items:flex-start}.tag-maintenance-event{align-items:flex-start}
        .tag-maintenance-manifest-conflict{grid-template-columns:1fr}}
    `;
    document.head.append(style);
  }

  function bind(root, selector, action) {
    root.querySelector(selector)?.addEventListener('click', action);
  }

  function render(root) {
    const scope = root?.querySelector ? root : document;
    const container = scope.querySelector('#settings-tag-maintenance');
    if (!container) return;
    runtime.disposed = false;
    runtime.root = container;
    ensureStyles();
    container.innerHTML = `
      <section class="gb-section gb-section--boxed" data-e2e-id="settings-tag-maintenance">
        <div class="gb-section-title">タグのメンテナンス</div>
        <div class="gb-section-desc">Explorer、Finder、制作ソフト、Dropboxで行った移動・コピー・削除を確認し、タグを再接続します。通常の起動やフォルダ切替では走査しません。</div>
        <div class="tag-maintenance-summary">
          <div class="tag-maintenance-metric"><span>復旧履歴</span><strong data-tag-maintenance-count="events">0</strong></div>
          <div class="tag-maintenance-metric"><span>確認待ち</span><strong data-tag-maintenance-count="pending">0</strong></div>
          <div class="tag-maintenance-metric"><span>再試行</span><strong data-tag-maintenance-count="retries">0</strong></div>
          <div class="tag-maintenance-metric"><span>削除済み</span><strong data-tag-maintenance-count="deleted">0</strong></div>
          <div class="tag-maintenance-metric"><span>要確認</span><strong data-tag-maintenance-count="ambiguous">0</strong></div>
        </div>
        <div class="gb-section-desc" data-tag-maintenance-progress>読み込み中…</div>
        <div class="gb-section-desc" data-tag-maintenance-monitor-state></div>
        <div class="tag-maintenance-actions">
          <button type="button" class="gb-btn gb-btn-sm primary" data-e2e-id="tag-maintenance-start" data-tag-maintenance-start data-tag-maintenance-write>外部変更を確認</button>
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="tag-maintenance-resume" data-tag-maintenance-resume data-tag-maintenance-write hidden>続きから再開</button>
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="tag-maintenance-cancel" data-tag-maintenance-cancel data-tag-maintenance-write hidden>中止</button>
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="tag-maintenance-retry" data-tag-maintenance-retry data-tag-maintenance-write>失敗した処理を再試行</button>
        </div>
        <div class="tag-maintenance-actions">
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="tag-maintenance-check" data-tag-maintenance-check data-tag-maintenance-write>タグ索引を確認</button>
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="tag-maintenance-rebuild" data-tag-maintenance-rebuild data-tag-maintenance-write>タグ索引を再構築</button>
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="tag-maintenance-monitor-start" data-tag-maintenance-monitor-start data-tag-maintenance-write>自動監視を開始</button>
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="tag-maintenance-monitor-stop" data-tag-maintenance-monitor-stop data-tag-maintenance-write>自動監視を停止</button>
        </div>
        <div class="gb-section-desc" data-tag-maintenance-message role="status" aria-live="polite"></div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">確認すれば復旧できる候補</div>
        <div data-tag-maintenance-candidates><div class="gb-section-desc">読み込み中…</div></div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">最近の復旧履歴</div>
        <div data-tag-maintenance-events><div class="gb-section-desc">読み込み中…</div></div>
      </section>
      <section class="gb-section gb-section--boxed" data-tag-maintenance-portable-section>
        <div class="gb-section-title">復旧IDとタグ情報の受け渡し</div>
        <div class="gb-section-desc">復旧IDは対応画像へ一度だけ追加する任意機能です。通常のタグ付けではファイルを書き換えません。別の利用者へタグも渡す場合は、JSONを一緒に渡してください。</div>
        <div class="tag-maintenance-actions">
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="tag-maintenance-portable-write" data-tag-maintenance-portable-write data-tag-maintenance-write data-tag-maintenance-requires-embedding>選択ファイルへ復旧IDを追加</button>
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="tag-maintenance-portable-batch" data-tag-maintenance-portable-batch data-tag-maintenance-write data-tag-maintenance-requires-embedding>未設定ファイルへ20件ずつ追加</button>
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="tag-maintenance-portable-regenerate" data-tag-maintenance-portable-regenerate data-tag-maintenance-write data-tag-maintenance-requires-embedding>復旧IDを再生成</button>
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="tag-maintenance-portable-remove" data-tag-maintenance-portable-remove data-tag-maintenance-write data-tag-maintenance-requires-embedding>復旧IDを削除</button>
        </div>
        <div class="tag-maintenance-actions">
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="tag-maintenance-manifest-export" data-tag-maintenance-manifest-export data-tag-maintenance-write data-tag-maintenance-requires-manifest>選択ファイルのタグ情報を書き出す</button>
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="tag-maintenance-manifest-select" data-tag-maintenance-manifest-select data-tag-maintenance-write data-tag-maintenance-requires-manifest>タグ情報JSONを読み込む</button>
          <input type="file" accept="application/json,.json" data-tag-maintenance-manifest-input hidden>
        </div>
        <div data-tag-maintenance-manifest-preview hidden></div>
      </section>`;
    bind(container, '[data-tag-maintenance-start]', () => startScan(false));
    bind(container, '[data-tag-maintenance-resume]', resumeScan);
    bind(container, '[data-tag-maintenance-cancel]', cancelScan);
    bind(container, '[data-tag-maintenance-retry]', retryPending);
    bind(container, '[data-tag-maintenance-check]', () => rebuild(true));
    bind(container, '[data-tag-maintenance-rebuild]', () => rebuild(false));
    bind(container, '[data-tag-maintenance-monitor-start]', () => toggleMonitor(true));
    bind(container, '[data-tag-maintenance-monitor-stop]', () => toggleMonitor(false));
    bind(container, '[data-tag-maintenance-portable-write]', () => writePortableUid(false));
    bind(container, '[data-tag-maintenance-portable-batch]', writePortableBatch);
    bind(container, '[data-tag-maintenance-portable-regenerate]', () => writePortableUid(true));
    bind(container, '[data-tag-maintenance-portable-remove]', removePortableUid);
    bind(container, '[data-tag-maintenance-manifest-export]', exportManifest);
    bind(container, '[data-tag-maintenance-manifest-select]', () => {
      container.querySelector('[data-tag-maintenance-manifest-input]')?.click();
    });
    container.querySelector('[data-tag-maintenance-manifest-input]')?.addEventListener('change', event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      void previewManifestFile(file);
    });
    void refresh();
  }

  window.MeldexTagMaintenanceSettings = {
    refresh,
    render,
  };
})();
