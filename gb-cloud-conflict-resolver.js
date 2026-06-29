(function () {
  if (window.MeldexCloudConflictResolver) return;

  const SNOOZE_KEY = 'meldex-cloud-conflict-snooze-until';
  const SNOOZE_MS = 60 * 60 * 1000;
  const BINARY_FULL_HASH_MAX_BYTES = 5 * 1024 * 1024;
  let _overlay = null;
  let _conflicts = [];
  let _selectedPath = '';
  let _detailRequestSeq = 0;
  let _conflictTotal = 0;
  let _conflictTruncated = false;

  function _api() {
    return window.MeldexDataAccess;
  }

  function _setStatus(text, isError) {
    const el = _overlay?.querySelector?.('.cloud-conflict-status');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? 'var(--red, #f48771)' : '';
  }

  function _el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = String(text);
    return element;
  }

  function _basename(path) {
    const normalized = String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const index = normalized.lastIndexOf('/');
    return index >= 0 ? normalized.slice(index + 1) : normalized;
  }

  function _isSnoozed() {
    try {
      const until = Number(localStorage.getItem(SNOOZE_KEY) || 0);
      if (!until) return false;
      if (until > Date.now()) return true;
      localStorage.removeItem(SNOOZE_KEY);
    } catch {}
    return false;
  }

  function _hideConflictBanner() {
    const bar = document.getElementById('cloud-mode-banner');
    if (bar?.dataset?.cloudBannerKind === 'health-conflict') bar.remove();
  }

  function snooze() {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    } catch {}
    close();
    _hideConflictBanner();
    if (typeof showStatus === 'function') showStatus('競合解消を後回しにしました');
  }

  function _appendInlineDiff(container, text, otherText) {
    const current = String(text ?? '');
    const other = String(otherText ?? '');
    if (current === other) {
      container.appendChild(document.createTextNode(current));
      return;
    }
    let prefix = 0;
    const minLen = Math.min(current.length, other.length);
    while (prefix < minLen && current[prefix] === other[prefix]) prefix += 1;

    let suffix = 0;
    const currentRest = current.length - prefix;
    const otherRest = other.length - prefix;
    while (
      suffix < currentRest &&
      suffix < otherRest &&
      current[current.length - suffix - 1] === other[other.length - suffix - 1]
    ) {
      suffix += 1;
    }

    if (prefix > 0) container.appendChild(document.createTextNode(current.slice(0, prefix)));
    const changed = current.slice(prefix, current.length - suffix);
    const changedSpan = _el('span', 'cloud-conflict-inline-diff', changed || ' ');
    container.appendChild(changedSpan);
    if (suffix > 0) container.appendChild(document.createTextNode(current.slice(current.length - suffix)));
  }

  function _clearDetail(message) {
    const originalPane = _overlay?.querySelector?.('[data-conflict-pane="original"]');
    const conflictPane = _overlay?.querySelector?.('[data-conflict-pane="conflict"]');
    if (!originalPane || !conflictPane) return;
    originalPane.textContent = '';
    conflictPane.textContent = '';
    if (message) {
      originalPane.appendChild(_el('div', 'cloud-conflict-empty', message));
      conflictPane.appendChild(_el('div', 'cloud-conflict-empty', message));
    }
  }

  function _clearMeta(message) {
    ['original', 'conflict'].forEach((name) => {
      const card = _overlay?.querySelector?.(`[data-conflict-meta="${name}"]`);
      if (!card) return;
      card.textContent = '';
      if (message) card.appendChild(_el('div', 'cloud-conflict-meta-label', message));
    });
  }

  function _renderLines(container, text, otherText, options = {}) {
    container.textContent = '';
    const lines = String(text || '').split(/\r?\n/);
    const otherLines = String(otherText || '').split(/\r?\n/);
    const maxLines = Math.min(Math.max(lines.length, otherLines.length), 2500);
    for (let index = 0; index < maxLines; index += 1) {
      const line = _el('div', 'cloud-conflict-line');
      const currentLine = lines[index] == null ? '' : lines[index];
      const otherLine = otherLines[index] == null ? '' : otherLines[index];
      const different = currentLine !== otherLine;
      if (different) line.classList.add('is-different');
      line.appendChild(_el('span', 'cloud-conflict-line-no', String(index + 1)));
      const textNode = _el('span', 'cloud-conflict-line-text');
      if (different) _appendInlineDiff(textNode, currentLine, otherLine);
      else textNode.textContent = currentLine;
      line.appendChild(textNode);
      container.appendChild(line);
    }
    if (Math.max(lines.length, otherLines.length) > maxLines) {
      container.appendChild(_el('div', 'cloud-conflict-empty', '表示が長いため一部を省略しています'));
    }
    if (options.truncated) {
      container.appendChild(_el('div', 'cloud-conflict-empty', 'ファイルが大きいため、本文プレビューの一部だけを表示しています'));
    }
  }

  async function _sha256Hex(bytes) {
    try {
      if (!globalThis.crypto?.subtle) return '';
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (_) {
      return '';
    }
  }

  function _hexPreview(bytes, limit) {
    const max = Math.min(bytes.length, limit || 512);
    const rows = [];
    for (let offset = 0; offset < max; offset += 16) {
      const chunk = bytes.slice(offset, Math.min(offset + 16, max));
      const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ');
      const ascii = Array.from(chunk).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
      rows.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(47, ' ')}  ${ascii}`);
    }
    if (bytes.length > max) rows.push(`... ${bytes.length - max} bytes 省略`);
    return rows.join('\n');
  }

  async function _binarySideSummary(side, label) {
    if (!side?.exists || !side?.path) return `${label}\nファイルなし`;
    const knownSize = Number(side?.size || 0);
    if (knownSize > BINARY_FULL_HASH_MAX_BYTES) {
      return [
        label,
        `ファイル: ${side.path}`,
        `Content-Type: ${side?.mime || side?.content_type || '不明'}`,
        `サイズ: ${knownSize} bytes`,
        'SHA-256: 大きいため省略',
        '',
        '大きな非テキストファイルのため、本文と先頭バイトの読み込みを省略しています。',
      ].join('\n');
    }
    const response = await fetch(API_BASE + '/file-raw?path=' + encodeURIComponent(side.path));
    if (!response.ok) throw new Error(`${label}を読み込めませんでした: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const hash = await _sha256Hex(bytes);
    return [
      label,
      `ファイル: ${side.path}`,
      `Content-Type: ${response.headers.get('content-type') || '不明'}`,
      `サイズ: ${bytes.length} bytes`,
      `SHA-256: ${hash || '計算不可'}`,
      '',
      '先頭バイト（最大512 bytes）:',
      _hexPreview(bytes, 512) || '(空ファイル)',
    ].join('\n');
  }

  async function _renderBinaryDetail(detail, requestSeq) {
    const [originalText, conflictText] = await Promise.all([
      _binarySideSummary(detail.original, '元ファイル'),
      _binarySideSummary(detail.conflict, '競合コピー'),
    ]);
    if (!_overlay || requestSeq !== _detailRequestSeq) return;
    _renderLines(
      _overlay.querySelector('[data-conflict-pane="original"]'),
      originalText,
      conflictText
    );
    _renderLines(
      _overlay.querySelector('[data-conflict-pane="conflict"]'),
      conflictText,
      originalText
    );
    _setStatus('非テキスト形式のため、メタデータ・SHA-256・先頭バイトで比較しています');
  }

  function _renderConflictList() {
    const list = _overlay.querySelector('.cloud-conflict-list');
    list.textContent = '';
    if (!_conflicts.length) {
      list.appendChild(_el('div', 'cloud-conflict-empty', '競合コピーはありません'));
      return;
    }
    if (_conflictTruncated || _conflictTotal > _conflicts.length) {
      list.appendChild(_el('div', 'cloud-conflict-empty', `表示中: ${_conflicts.length}件 / 検出: ${_conflictTotal || _conflicts.length}件`));
    }
    _conflicts.forEach((item) => {
      const button = _el('button', 'cloud-conflict-list-item');
      button.type = 'button';
      if (item.path === _selectedPath) button.classList.add('active');
      button.appendChild(_el('span', 'cloud-conflict-list-name', item.name || _basename(item.path)));
      button.appendChild(_el('span', 'cloud-conflict-list-path', item.path || ''));
      button.addEventListener('click', () => selectConflict(item.path));
      list.appendChild(button);
    });
  }

  function _setMeta(card, label, side) {
    card.textContent = '';
    card.appendChild(_el('div', 'cloud-conflict-meta-label', label));
    card.appendChild(_el('div', 'cloud-conflict-meta-path', side?.path || 'なし'));
    const detail = side?.exists === false
      ? '元ファイルが見つかりません'
      : `${side?.modified || '更新日時不明'} / ${Number(side?.size || 0)} bytes`;
    card.appendChild(_el('div', 'cloud-conflict-meta-label', detail));
  }

  function _setResolveButtonState(detail, busy = false) {
    const keepOriginal = _overlay?.querySelector?.('[data-conflict-action="keep_original"]');
    const keepConflict = _overlay?.querySelector?.('[data-conflict-action="keep_conflict"]');
    const mergeSqlite = _overlay?.querySelector?.('[data-conflict-action="merge_sqlite_sheet"]');
    const loading = !detail;
    if (keepOriginal) {
      keepOriginal.disabled = busy || loading || detail?.original?.exists === false;
      keepOriginal.title = detail?.original?.exists === false ? '元ファイルが見つからないため選択できません' : '';
    }
    if (keepConflict) {
      keepConflict.disabled = busy || loading || detail?.conflict?.exists === false;
      keepConflict.title = '';
    }
    if (mergeSqlite) {
      mergeSqlite.disabled = busy || loading || !detail?.sqlite_sheet_mergeable || detail?.conflict?.exists === false;
      mergeSqlite.title = detail?.sqlite_sheet_mergeable ? 'SQLiteシートを行単位でマージします' : 'SQLiteシートの競合コピーでのみ使えます';
    }
  }

  function _applyConflictPayload(payload) {
    _conflicts = Array.isArray(payload?.items) ? payload.items : [];
    _conflictTotal = Number(payload?.count || _conflicts.length) || _conflicts.length;
    _conflictTruncated = !!payload?.truncated || _conflictTotal > _conflicts.length;
  }

  async function selectConflict(path) {
    _selectedPath = String(path || '');
    _renderConflictList();
    _setStatus('読み込み中...');
    _setResolveButtonState(null);
    _clearMeta('読み込み中...');
    _clearDetail('読み込み中...');
    const requestSeq = ++_detailRequestSeq;
    try {
      const detail = await _api().requestJson(`/cloud/conflict-detail?path=${encodeURIComponent(_selectedPath)}`);
      if (!_overlay || requestSeq !== _detailRequestSeq) return;
      const originalMeta = _overlay.querySelector('[data-conflict-meta="original"]');
      const conflictMeta = _overlay.querySelector('[data-conflict-meta="conflict"]');
      _setMeta(originalMeta, '元ファイル', detail.original);
      _setMeta(conflictMeta, '競合コピー', detail.conflict);
      if (!detail.text_like) {
        _clearDetail('非テキスト形式の比較情報を読み込み中...');
        await _renderBinaryDetail(detail, requestSeq);
      } else {
        _renderLines(
          _overlay.querySelector('[data-conflict-pane="original"]'),
          detail.original?.content || '',
          detail.conflict?.content || '',
          { truncated: !!detail.original?.truncated }
        );
        _renderLines(
          _overlay.querySelector('[data-conflict-pane="conflict"]'),
          detail.conflict?.content || '',
          detail.original?.content || '',
          { truncated: !!detail.conflict?.truncated }
        );
        const truncated = detail.original?.truncated || detail.conflict?.truncated;
        _setStatus(truncated ? '大きなファイルのため一部プレビューです' : (detail.original?.exists === false ? '元ファイルなし: 競合コピーを残すと通常名へ戻します' : ''));
      }
      _setResolveButtonState(detail);
    } catch (err) {
      if (!_overlay || requestSeq !== _detailRequestSeq) return;
      _clearMeta('詳細を読み込めませんでした');
      _clearDetail('詳細を読み込めませんでした');
      _setStatus(err?.message || String(err), true);
      _setResolveButtonState(null);
    }
  }

  async function _resolve(action) {
    if (!_selectedPath) return;
    const targetPath = _selectedPath;
    const button = _overlay?.querySelector?.(`[data-conflict-action="${action}"]`);
    if (button?.disabled) return;
    const label = action === 'keep_original' ? '元ファイル' : (action === 'merge_sqlite_sheet' ? 'シートのマージ結果' : '競合コピー');
    const ok = confirm(`${label}を残して競合を解消します。解消前のファイルは _meldex/conflict-backups に保存されます。続行しますか？`);
    if (!ok) return;
    _setStatus('解消中...');
    _setResolveButtonState(null, true);
    try {
      await _api().requestJson('/cloud/conflict-resolve', {
        method: 'POST',
        body: { conflict_path: targetPath, action },
      });
      if (_conflictTotal > 0) _conflictTotal = Math.max(0, _conflictTotal - 1);
      _conflicts = _conflicts.filter((item) => item.path !== targetPath);
      if (!_overlay) {
        if (!_conflictTruncated && _conflictTotal <= 0) _hideConflictBanner();
        if (typeof loadOutliner === 'function') loadOutliner().catch(() => {});
        return;
      }
      if (_conflictTruncated && !_conflicts.length) {
        _setStatus('残りの競合を再検索中...');
        const payload = await _api().requestJson('/cloud/conflicts?limit=50');
        _applyConflictPayload(payload);
      }
      _selectedPath = _conflicts.find(item => item.path === _selectedPath)?.path || _conflicts[0]?.path || '';
      _renderConflictList();
      if (_selectedPath) await selectConflict(_selectedPath);
      else {
        _overlay.querySelector('[data-conflict-pane="original"]').textContent = '';
        _overlay.querySelector('[data-conflict-pane="conflict"]').textContent = '';
        if (_conflictTruncated || _conflictTotal > 0) {
          _setStatus('表示分を解消しました。残りの競合を再検索してください', true);
        } else {
          _setStatus('すべての競合を解消しました');
          _hideConflictBanner();
        }
      }
      if (typeof loadOutliner === 'function') loadOutliner().catch(() => {});
    } catch (err) {
      if (_overlay) {
        _setStatus(err?.message || String(err), true);
        if (_selectedPath) selectConflict(_selectedPath).catch(() => {});
      } else if (typeof showStatus === 'function') {
        showStatus('競合解消に失敗しました: ' + (err?.message || String(err)), true);
      }
    }
  }

  function _buildShell() {
    const overlay = _el('div', 'cloud-conflict-resolver-overlay');
    const dialog = _el('section', 'cloud-conflict-resolver');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const header = _el('div', 'cloud-conflict-header');
    header.appendChild(_el('div', 'cloud-conflict-title', 'Dropbox 競合解消'));
    header.appendChild(_el('div', 'cloud-conflict-status', ''));
    const closeBtn = _el('button', 'cloud-conflict-btn', '閉じる');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', close);
    header.appendChild(closeBtn);

    const body = _el('div', 'cloud-conflict-body');
    body.appendChild(_el('div', 'cloud-conflict-list'));

    const detail = _el('div', 'cloud-conflict-detail');
    const meta = _el('div', 'cloud-conflict-meta');
    const originalMeta = _el('div', 'cloud-conflict-meta-card');
    originalMeta.dataset.conflictMeta = 'original';
    const conflictMeta = _el('div', 'cloud-conflict-meta-card');
    conflictMeta.dataset.conflictMeta = 'conflict';
    meta.appendChild(originalMeta);
    meta.appendChild(conflictMeta);

    const compare = _el('div', 'cloud-conflict-compare');
    const originalPane = _el('section', 'cloud-conflict-pane');
    originalPane.appendChild(_el('div', 'cloud-conflict-pane-title', '元ファイル'));
    const originalCode = _el('pre', 'cloud-conflict-code');
    originalCode.dataset.conflictPane = 'original';
    originalPane.appendChild(originalCode);
    const conflictPane = _el('section', 'cloud-conflict-pane');
    conflictPane.appendChild(_el('div', 'cloud-conflict-pane-title', '競合コピー'));
    const conflictCode = _el('pre', 'cloud-conflict-code');
    conflictCode.dataset.conflictPane = 'conflict';
    conflictPane.appendChild(conflictCode);
    compare.appendChild(originalPane);
    compare.appendChild(conflictPane);
    detail.appendChild(meta);
    detail.appendChild(compare);
    body.appendChild(detail);

    const footer = _el('div', 'cloud-conflict-footer');
    const deferBtn = _el('button', 'cloud-conflict-btn', '後回し');
    deferBtn.type = 'button';
    deferBtn.addEventListener('click', snooze);
    const keepOriginalBtn = _el('button', 'cloud-conflict-btn', '元ファイルを残す');
    keepOriginalBtn.type = 'button';
    keepOriginalBtn.dataset.conflictAction = 'keep_original';
    keepOriginalBtn.addEventListener('click', () => _resolve('keep_original'));
    const mergeSqliteBtn = _el('button', 'cloud-conflict-btn', 'シートをマージ');
    mergeSqliteBtn.type = 'button';
    mergeSqliteBtn.dataset.conflictAction = 'merge_sqlite_sheet';
    mergeSqliteBtn.addEventListener('click', () => _resolve('merge_sqlite_sheet'));
    const keepConflictBtn = _el('button', 'cloud-conflict-btn primary', '競合コピーを残す');
    keepConflictBtn.type = 'button';
    keepConflictBtn.dataset.conflictAction = 'keep_conflict';
    keepConflictBtn.addEventListener('click', () => _resolve('keep_conflict'));
    footer.appendChild(deferBtn);
    footer.appendChild(keepOriginalBtn);
    footer.appendChild(mergeSqliteBtn);
    footer.appendChild(keepConflictBtn);

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) close();
    });
    return overlay;
  }

  async function open(seed) {
    if (_overlay) close();
    _overlay = _buildShell();
    document.body.appendChild(_overlay);
    _setStatus('競合を検索中...');
    _setResolveButtonState(null);
    _clearMeta('競合を選択してください');
    _clearDetail('競合を選択してください');
    try {
      const payload = seed?.items ? seed : await _api().requestJson('/cloud/conflicts?limit=50');
      _applyConflictPayload(payload);
      _renderConflictList();
      const initialPath = _conflicts[0]?.path || '';
      if (initialPath) await selectConflict(initialPath);
      else _setStatus('競合コピーはありません');
    } catch (err) {
      _clearDetail('競合一覧を読み込めませんでした');
      _setStatus(err?.message || String(err), true);
    }
  }

  function close() {
    if (_overlay) _overlay.remove();
    _overlay = null;
    _conflicts = [];
    _selectedPath = '';
    _conflictTotal = 0;
    _conflictTruncated = false;
    _detailRequestSeq += 1;
  }

  window.MeldexCloudConflictResolver = {
    open,
    close,
    snooze,
    isSnoozed: _isSnoozed,
  };
})();
