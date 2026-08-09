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
    };
  }

  function _normalizeTargets(raw) {
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : [raw];
    return list.map(_normalizeOneTarget).filter(Boolean);
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
    _targets = _normalizeTargets(raw);
    _origin = origin ? String(origin) : '';
    _selectionRevision += 1;
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

  global.GBOptionTargetContext = Object.freeze({
    set: setOptionTarget,
    clear: clearOptionTarget,
    get: getOptionTarget,
    revision: getSelectionRevision,
    isCurrentRevision: isCurrentRevision,
  });
})(typeof window !== 'undefined' ? window : globalThis);
