/* gb-delete-impact-warning.js
 * ファイル参照整合性・削除警告・全ファイルバックリンク実装計画 Phase 4:
 * 削除確認ダイアログへの被参照警告の統合。
 *
 * 計画書: app/docs/file-reference-integrity-and-backlinks-plan-2026-07-31.md §2.2・§10.1
 * Phase0委任: app/docs/file-reference-integrity-phase0-2026-08-01/notes.md §4「4c」
 *
 * 既存の削除確認ダイアログ(cfConfirm、UI共通ルール「削除は必ず確認ダイアログ」で
 * 既に全削除操作に確認がある)へ、被参照件数の警告を追加するだけの薄いレイヤー。
 * サーバー側の判定・カウントは一切行わず、POST /api/references/delete-impact
 * （meldex_api_reference_delete_impact.py）の結果をそのままDOMへ反映する。
 *
 * 重要: 警告は削除を止めない。cfConfirm自体の「キャンセル/削除」確認は
 * 従来どおり必要（計画書§10.1のtoken/409必須確認フローは本Phaseでは実装しない。
 * 詳細は meldex_api_reference_delete_impact.py 冒頭コメント参照）。
 *
 * [2026-08-01 フェーズB徹底チェック 修正3(b)] 大きなフォルダの削除影響照会は
 * 数百ms〜数秒かかることがある。以前は confirmDeleteWithImpact が照会完了を
 * 待ってから cfConfirm を呼んでいたため、確認ダイアログの表示自体が照会の
 * 遅さに引きずられてブロックされ、さらに照会がタイムアウト/失敗すると
 * 警告なしのまま静かに進んでいた（「遅いほど警告が消える」）。
 * 今は確認ダイアログを即座に表示し、「参照を確認しています…」のプレースホルダー
 * を非同期の実結果へ差し替える。照会失敗時は「参照0件」と偽らず、明示的に
 * 確認できなかった旨を表示する（黙って消さない）。
 */
(function () {
  'use strict';

  // 参照元の内訳表示の上限（計画書§2.2「代表的な参照元」）。API応答の
  // sources 自体も50件で切り詰められているが、UI表示はさらに少なく絞る。
  const NAMES_SHOWN = 3;

  function _isNonEmptyString(value) {
    return typeof value === 'string' && value.trim() !== '';
  }

  function _toDeleteImpactItems(targets) {
    const list = Array.isArray(targets) ? targets : [targets];
    return list
      .map((t) => {
        if (_isNonEmptyString(t)) return { path: t, kind: 'file' };
        if (t && typeof t === 'object' && _isNonEmptyString(t.path)) {
          const item = { path: t.path, kind: t.kind || (t.type === 'folder' ? 'folder' : 'file') };
          // フェーズB徹底チェック 修正1: assetId（改名・移動をまたいで不変の
          // 安定ID）を捨てずにサーバーへ渡す。camelCase/snake_caseどちらの
          // 呼び出し元にも対応する（呼び出し元は現状どちらも持たないことが
          // 多いが、将来 assetId を持つ呼び出し元が現れてもここで欠落しない）。
          const assetId = t.assetId || t.asset_id;
          if (_isNonEmptyString(assetId)) item.assetId = assetId;
          return item;
        }
        return null;
      })
      .filter(Boolean);
  }

  // サーバーへの照会本体。通信失敗・タイムアウト・ok!==true はすべて
  // failed:true として区別する（「参照なし」と黙って丸め込まない。修正3(b)）。
  async function _fetchDeleteImpactWithStatus(items) {
    if (!items.length) return { impact: null, failed: false };
    if (typeof apiPost !== 'function') return { impact: null, failed: true };
    try {
      const result = await apiPost('/api/references/delete-impact', { items }, { silentError: true, timeoutMs: 8000 });
      if (result && result.ok) return { impact: result, failed: false };
      return { impact: null, failed: true };
    } catch (_) {
      return { impact: null, failed: true };
    }
  }

  // targets: パス文字列の配列、または {path, kind, assetId} オブジェクトの配列。
  // 通信失敗時は null を返す（後方互換の公開API。失敗と「確認できたが0件」を
  // 区別したい場合は confirmDeleteWithImpact 側の非同期差し替えを使うこと）。
  async function fetchDeleteImpact(targets) {
    const items = _toDeleteImpactItems(targets);
    const { impact } = await _fetchDeleteImpactWithStatus(items);
    return impact;
  }

  // impact/itemCountから警告本文の子要素を組み立て、box（既存DOM要素）へ
  // 追加する。buildWarningNode（同期一括版）と confirmDeleteWithImpact
  // （非同期プレースホルダー差し替え版）の共通描画ロジック。
  // 戻り値: 実際に何か表示すべき内容があったかどうか（false なら警告不要）。
  function _renderWarningContent(box, impact, itemCount) {
    const sourceCount = Number((impact && impact.sourceFileCount) || 0);
    const incomplete = impact ? impact.complete === false : false;

    if (sourceCount > 0) {
      const headline = document.createElement('div');
      headline.className = 'gb-delete-impact-warning-headline';
      headline.dataset.e2eId = 'delete-impact-warning-headline';
      headline.textContent = itemCount > 1
        ? `削除対象は合計 ${sourceCount} 件のファイルから参照されています`
        : `このファイルは ${sourceCount} 件のファイルから参照されています`;
      box.appendChild(headline);

      const names = (impact.sources || [])
        .map((s) => (s && (s.display_name || s.source_path)) || '')
        .filter(_isNonEmptyString);
      if (names.length) {
        const list = document.createElement('div');
        list.className = 'gb-delete-impact-warning-list';
        list.dataset.e2eId = 'delete-impact-warning-list';
        const shown = names.slice(0, NAMES_SHOWN);
        const restCount = sourceCount - shown.length;
        list.textContent = restCount > 0 ? `${shown.join('、')} ほか${restCount}件` : shown.join('、');
        box.appendChild(list);
      }
    }

    if (incomplete) {
      const note = document.createElement('div');
      note.className = 'gb-delete-impact-warning-incomplete';
      note.dataset.e2eId = 'delete-impact-warning-incomplete';
      note.textContent = '参照の確認が不完全です';
      box.appendChild(note);
    }

    return sourceCount > 0 || incomplete;
  }

  // impact（fetchDeleteImpactの戻り値）から警告DOM要素を組み立てる。
  // 警告が不要（被参照0件かつ索引完全）なら null を返す。
  // itemCount: 削除対象トップレベル項目数（文言の単数/複数切替に使う）。
  function buildWarningNode(impact, itemCount) {
    if (!impact) return null;
    const box = document.createElement('div');
    // gb-confirm-message を継承させることで、cfConfirm/_enhanceCfDialog の
    // aria-describedby 収集にも自動的に含まれる（app/gb-ui.part03.css の
    // .gb-delete-impact-warning が見た目を通常削除と区別する）。
    box.className = 'gb-confirm-message gb-delete-impact-warning';
    box.setAttribute('role', 'note');
    box.dataset.e2eId = 'delete-impact-warning';
    const hasContent = _renderWarningContent(box, impact, itemCount);
    return hasContent ? box : null;
  }

  // 照会中に確認ダイアログへ即座に差し込むプレースホルダー。
  function _buildLoadingNode() {
    const box = document.createElement('div');
    box.className = 'gb-confirm-message gb-delete-impact-warning gb-delete-impact-warning-loading';
    box.setAttribute('role', 'note');
    box.setAttribute('aria-live', 'polite');
    box.dataset.e2eId = 'delete-impact-warning';
    const note = document.createElement('div');
    note.className = 'gb-delete-impact-warning-loading-text';
    note.dataset.e2eId = 'delete-impact-warning-loading';
    note.textContent = '参照を確認しています…';
    box.appendChild(note);
    return box;
  }

  // 非同期の照会結果を、既にダイアログへ挿入済みのプレースホルダーboxへ
  // 差し替える。box自体はDOMへ挿入済みのため、中身を書き換えるだけで表示中の
  // ダイアログへ即座に反映される（cfConfirmはextraNodeを参照渡しでDOMへ
  // 挿入するため）。ダイアログが既に閉じられていた場合（box.isConnected===false）
  // は何もしない。
  function _applyDeleteImpactResult(box, itemCount, impact, failed) {
    if (!box || !box.isConnected) return;
    box.classList.remove('gb-delete-impact-warning-loading');
    box.removeAttribute('aria-live');
    box.innerHTML = '';

    if (failed) {
      // 照会失敗・タイムアウト時は「参照0件」と偽らず、確認できなかった旨を
      // 明示する（修正3(b): 黙って警告を消さない）。
      const note = document.createElement('div');
      note.className = 'gb-delete-impact-warning-incomplete';
      note.dataset.e2eId = 'delete-impact-warning-failed';
      note.textContent = '参照の確認ができませんでした';
      box.appendChild(note);
      return;
    }

    const hasContent = _renderWarningContent(box, impact, itemCount);
    if (!hasContent) {
      // 警告不要と判明 → プレースホルダーごと消して通常の削除確認と同じ
      // 見た目に戻す。
      box.remove();
    }
  }

  // 削除確認ダイアログを、被参照警告つきで表示する共通入口。
  // 既存の cfConfirm(message, options) と同じ戻り値（Promise<boolean>）。
  // targets が空、cfConfirm未読込の場合は従来どおり確認は出す（警告が出せない
  // ことを理由に確認自体を省略しない）。被参照の照会はダイアログ表示を
  // ブロックしない（修正3(b)）。
  async function confirmDeleteWithImpact(targets, message, options) {
    if (typeof cfConfirm !== 'function') return true;
    const items = _toDeleteImpactItems(targets);
    const opts = Object.assign({}, options || {});
    if (!items.length) {
      return cfConfirm(message, opts);
    }

    const placeholder = _buildLoadingNode();
    opts.extraNode = placeholder;
    const confirmPromise = cfConfirm(message, opts);

    _fetchDeleteImpactWithStatus(items).then(({ impact, failed }) => {
      _applyDeleteImpactResult(placeholder, items.length, impact, failed);
    });

    return confirmPromise;
  }

  window.MeldexDeleteImpactWarning = {
    fetchDeleteImpact,
    buildWarningNode,
    confirmDeleteWithImpact,
  };
})();
