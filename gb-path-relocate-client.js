/* gb-path-relocate-client.js
 * move/rename API のレスポンスに含まれる relocate 情報を処理するクライアント側ヘルパ。
 *
 * サーバー側: meldex_path_relocator_service.py が返す report を /api/outliner/move /
 * /api/outliner/rename / /api/entity/rename のレスポンス.relocate に含める:
 *   { rewritten_count, failed_count, rewritten_paths: [...], truncated: bool }
 *
 * このヘルパは:
 *   1. 書き換え件数を status bar に表示
 *   2. 現在開いているタブが書き換え対象だった場合、ディスクから reload する
 */
(function(global){
  'use strict';

  /** レスポンスの relocate 情報を処理する。戻り値: 処理した書き換え件数。 */
  function handleRelocateResponse(res, opts) {
    const info = res && res.relocate;
    if (!info) return 0;
    const count = +info.rewritten_count || 0;
    const failed = +info.failed_count || 0;
    const rewritten = Array.isArray(info.rewritten_paths) ? info.rewritten_paths : [];
    const truncated = !!info.truncated;

    // ステータス通知
    if (typeof showStatus === 'function') {
      if (count > 0 && failed === 0) {
        showStatus((opts?.prefix || '') + count + '件のファイル内参照を自動更新しました');
      } else if (count > 0 && failed > 0) {
        showStatus(`${count}件更新・${failed}件失敗`, true);
      } else if (failed > 0) {
        showStatus(`${failed}件のファイル内参照更新に失敗`, true);
      }
    }

    // 現在開いているタブが書き換え対象なら再読込
    if (count > 0 && (rewritten.length > 0 || truncated)) {
      _reloadIfOpen(rewritten, { truncated });
    }

    return count;
  }

  /** 現在開いているボード/ノート/シナリオ等が rewritten に含まれていたら再読込する。 */
  function _reloadIfOpen(rewrittenPaths, opts) {
    const paths = new Set(rewrittenPaths.map(p => _normalize(p)));
    const truncated = !!opts?.truncated;

    // ボード
    try {
      if (typeof bd !== 'undefined' && bd && bd.path && _matchesRelocatedPath(bd.path, paths, truncated)) {
        if (typeof bdOpenBoard === 'function') {
          if (bd.dirty) {
            clearTimeout(window._bdTimer);
            window._bdTimer = null;
            const draft = (typeof bdToMd === 'function') ? bdToMd() : '';
            if (draft && window.MeldexDraftRecovery?.saveDraft) {
              window.MeldexDraftRecovery.saveDraft(bd.path, draft, '');
            }
            if (typeof showStatus === 'function') {
              showStatus('未保存のボード編集を下書きに退避し、参照更新後の内容を再読み込みします', true, { passiveSave: true });
            }
          }
          const label = bd.path.split('/').pop() || '';
          bdOpenBoard(label, bd.path, { silent: true, skipHighlight: true, skipDirtySave: true });
        }
      }
    } catch {}

    // ノート (gb-app.part03.js で state.currentPagePath を管理)
    try {
      if (typeof state !== 'undefined' && state?.currentPagePath && _matchesRelocatedPath(state.currentPagePath, paths, truncated)) {
        if (typeof openPage === 'function') {
          if (_noteHasUnsavedChanges()) {
            clearTimeout(window._noteAutoSaveTimer);
            window._noteAutoSaveTimer = null;
            const pc = document.getElementById('page-content');
            const md = _noteMarkdownForDraft(pc);
            if (md && window.MeldexDraftRecovery?.saveDraft) {
              window.MeldexDraftRecovery.saveDraft(state.currentPagePath, md, pc?.dataset?.lastSavedMd || '');
            }
            if (typeof showStatus === 'function') {
              showStatus('未保存のノート編集を下書きに退避し、参照更新後の内容を再読み込みします', true, { passiveSave: true });
            }
          }
          const lbl = state.currentPagePath.split('/').pop() || '';
          openPage(lbl, state.currentPagePath, { silent: true, skipHighlight: true, skipDirtySave: true });
        }
      }
    } catch {}

    // シナリオ (ScriptNote) — アクティブコンポーネントの state.scenarioPath を参照
    try {
      const getScriptnote = (typeof getActiveScriptNoteComponent === 'function') ? getActiveScriptNoteComponent : null;
      const snComp = getScriptnote ? getScriptnote() : null;
      const snPath = snComp?.state?.scenarioPath || snComp?.state?.path || '';
      if (snPath && _matchesRelocatedPath(snPath, paths, truncated)) {
        const lbl = snPath.split('/').pop() || '';
        if (snComp && typeof snComp._loadScenario === 'function') {
          if (typeof snComp.restoreState === 'function') snComp.restoreState({ scenarioPath: snPath, label: lbl });
          if (snComp.state) {
            snComp.state.scenarioPath = snPath;
            snComp.state.label = lbl;
          }
          snComp._loadScenario(snPath, { skipNavPush: true, skipRecent: true, skipAutoVersion: true, skipSaveLastView: true, skipStatus: true, forceReload: true });
        } else if (typeof openScenarioInScriptNote === 'function') {
          openScenarioInScriptNote(snPath, lbl, { silent: true, skipHighlight: true, forceReload: true });
        }
      }
    } catch {}
  }

  function _matchesRelocatedPath(path, paths, truncated) {
    const normalized = _normalize(path);
    return !!(normalized && (truncated || paths.has(normalized)));
  }

  function _noteMarkdownForDraft(pc) {
    try {
      if (typeof _noteMarkdownFromEditor === 'function') return _noteMarkdownFromEditor(pc);
      if (!pc || typeof htmlToMd !== 'function') return '';
      pc.querySelectorAll('mark.file-search-highlight').forEach(m => m.replaceWith(...m.childNodes));
      pc.normalize();
      const body = htmlToMd(pc.innerHTML || '');
      return (pc.dataset.frontmatter || '') + body;
    } catch {
      return '';
    }
  }

  function _noteHasUnsavedChanges() {
    try {
      const pc = document.getElementById('page-content');
      if (!pc || pc.dataset.loadFailed === '1') return false;
      if (window._noteAutoSaveTimer) return true;
      if (typeof htmlToMd !== 'function') return false;
      const current = htmlToMd(pc.innerHTML || '');
      const fm = pc.dataset.frontmatter || '';
      const last = pc.dataset.lastSavedMd || '';
      return (fm + current) !== last;
    } catch {
      return true;
    }
  }

  function _normalize(p) {
    if (!p) return '';
    return String(p).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  }

  global.handleRelocateResponse = handleRelocateResponse;
})(typeof window !== 'undefined' ? window : globalThis);
