/* ==============================
   gb-option-target-context.js
   OptionTargetContext（計画書 §11.1）

   計画書: app/docs/file-reference-integrity-and-backlinks-plan-2026-07-31.md §11.1
   Phase 5委任: app/docs/file-reference-integrity-phase0-2026-08-01/notes.md §4「5a」

   オプションパネル（バックリンク等）が「今どのファイルを対象にしているか」を
   保持する単一の情報源。従来は state.currentEntityPath || state.currentPagePath ||
   state.currentFilePath という固定優先順位のフォールバックで解決していたため、
   フォルダパネルで一般ファイル（画像・PDF等）を選択しても state.currentFilePath
   が誰からも更新されず、以前開いていたノート/エントリの古い選択対象がそのまま
   バックリンクに表示され続ける不具合があった（AGENT_INBOX.md
   「ファイル参照整合性・削除警告・全ファイルバックリンクを実装する」の課題記述）。

   本モジュールは「最後に選択された対象」を選択元を問わず一箇所へ集約し、
   固定優先順位ではなく選択の新しさ（selectionRevision）で解決する。
   ============================== */
(function (global) {
  'use strict';

  // { targets: [{path, assetId, scopeId, fileType, kind}], selectionRevision, origin }
  let _targets = [];
  let _selectionRevision = 0;
  let _origin = '';

  function _normalizeOneTarget(raw) {
    if (!raw) return null;
    const path = typeof raw === 'string' ? raw : raw.path;
    if (!path) return null;
    return {
      path: String(path),
      assetId: raw.assetId ? String(raw.assetId) : '',
      scopeId: raw.scopeId ? String(raw.scopeId) : '',
      fileType: raw.fileType ? String(raw.fileType) : '',
      kind: raw.kind ? String(raw.kind) : 'file',
      contextPath: raw.contextPath ? String(raw.contextPath) : '',
    };
  }

  function _normalizeTargets(raw) {
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : [raw];
    return list.map(_normalizeOneTarget).filter(Boolean);
  }

  function _sameTargets(left, right) {
    if (left.length !== right.length) return false;
    return left.every(function (target, index) {
      const other = right[index];
      return !!other
        && target.path === other.path
        && target.assetId === other.assetId
        && target.scopeId === other.scopeId
        && target.fileType === other.fileType
        && target.kind === other.kind
        && target.contextPath === other.contextPath;
    });
  }

  /**
   * 現在の選択対象を置き換える。
   * @param {*} raw 単一ターゲット（{path,...}または文字列）、ターゲット配列、
   *   または未選択を表す null/undefined/空配列。
   * @param {string} origin 選択元の識別子（'folder-panel' | 'note-open' |
   *   'entity-select' | 'database-select' 等）。デバッグ・テスト用。
   * @returns {number} 更新後の selectionRevision
   */
  function setOptionTarget(raw, origin) {
    const nextTargets = _normalizeTargets(raw);
    const nextOrigin = origin ? String(origin) : '';
    // レスポンシブUIの再配置や独立パネルの再描画は、同じ対象を再通知することがある。
    // 実対象が変わっていない再通知でselectionRevisionを進めると、公開やバックリンクの
    // 正当な非同期処理を「対象切替」と誤判定するため、同値setは冪等に扱う。
    if (_sameTargets(_targets, nextTargets)) {
      _origin = nextOrigin || _origin;
      return _selectionRevision;
    }
    _targets = nextTargets;
    _origin = nextOrigin;
    _selectionRevision += 1;
    try {
      global.document?.dispatchEvent?.(new CustomEvent('meldex:option-target-changed', {
        detail: getOptionTarget(),
      }));
    } catch {}
    return _selectionRevision;
  }

  function clearOptionTarget(origin) {
    return setOptionTarget(null, origin);
  }

  /** 現在の選択対象を返す（呼び出し元が変更できないようコピーを返す）。 */
  function getOptionTarget() {
    return {
      targets: _targets.map(function (t) { return Object.assign({}, t); }),
      selectionRevision: _selectionRevision,
      origin: _origin,
    };
  }

  function getSelectionRevision() {
    return _selectionRevision;
  }

  /** 指定の revision が現在の選択と一致するか（非同期応答の破棄判定用）。 */
  function isCurrentRevision(revision) {
    return revision === _selectionRevision;
  }

  function _basename(value) {
    const normalized = String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
    return normalized.split('/').pop() || normalized;
  }

  function describeOptionTarget(rawContext, options) {
    const ctx = rawContext && Array.isArray(rawContext.targets) ? rawContext : getOptionTarget();
    const targets = Array.isArray(ctx.targets) ? ctx.targets : [];
    const config = options || {};
    if (config.scopeLabel) {
      return {
        kind: 'scope',
        label: String(config.scopeLabel),
        title: String(config.scopeTitle || config.scopeLabel),
        count: 0,
        path: '',
      };
    }
    if (targets.length > 1) {
      return {
        kind: 'multiple',
        label: `複数選択（${targets.length}件）`,
        title: targets.map(target => target.contextPath || target.path || '').filter(Boolean).join('\n'),
        count: targets.length,
        path: '',
      };
    }
    const target = targets[0];
    if (!target) {
      return {
        kind: 'empty',
        label: 'ファイルが選択されていません',
        title: 'ファイルが選択されていません',
        count: 0,
        path: '',
      };
    }
    const path = String(target.contextPath || target.path || '');
    return {
      kind: target.kind || 'file',
      label: _basename(path) || path,
      title: path,
      count: 1,
      path,
    };
  }

  function renderTargetHeader(container, rawContext, options) {
    if (!container) return null;
    let header = container.querySelector?.(':scope > [data-context-target-header]') || null;
    if (!header) {
      header = global.document?.createElement?.('div') || null;
      if (!header) return null;
      header.className = 'gb-context-target-header';
      header.dataset.contextTargetHeader = '1';
      header.innerHTML = '<div class="gb-context-target-header__caption"></div><div class="gb-context-target-header__name"></div>';
      container.prepend(header);
    }
    const descriptor = describeOptionTarget(rawContext, options);
    const caption = header.querySelector('.gb-context-target-header__caption');
    const name = header.querySelector('.gb-context-target-header__name');
    if (caption) caption.textContent = String(options?.caption || '対象');
    if (name) {
      name.textContent = descriptor.label;
      name.title = descriptor.title || descriptor.label;
      name.setAttribute('aria-label', descriptor.title || descriptor.label);
    }
    header.dataset.contextTargetKind = descriptor.kind;
    header.title = descriptor.title || descriptor.label;
    return descriptor;
  }

  global.GBOptionTargetContext = Object.freeze({
    set: setOptionTarget,
    clear: clearOptionTarget,
    get: getOptionTarget,
    describe: describeOptionTarget,
    renderHeader: renderTargetHeader,
    revision: getSelectionRevision,
    isCurrentRevision: isCurrentRevision,
  });
})(typeof window !== 'undefined' ? window : globalThis);
