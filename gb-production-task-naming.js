/* ==============================
   gb-production-task-naming.js: タスクエントリ名の自動生成規則（Cloud側）

   Desktopの meldex_production_task_name_autofill.py（build_task_entry_name の合成規則、
   _should_auto_update_name の判定）と1:1で対応する（production-management-ux-improvement-
   plan-2026-08-04.md §4-3）。この段階では「名前を計算する」純粋な規則だけをここへ置く。
   実際のリネーム（ファイル移動）は gb-production-management.part01.js の
   _pmCloudRenameManagedEntry（手動リネーム時に「タスク名を固定」を立てる）を使う。

   セル編集トリガーの自動リネーム（Desktopの auto_rename_task_entry_after_sheet_edit）は、
   Cloud側の値保存経路（gb-data-access-dropbox-expanded.part01.js の _updateValue 等）が
   フロントマターを常に「編集前の path」へ書き戻す構造のため、値保存フックの中で即座に
   ファイルを移動すると、直後の呼び出し元の書き込みが旧パスへファイルを復活させてしまう
   （二重化する）。安全に実装するには呼び出し元側の変更が要る（別レーンが編集中の
   gb-data-access-dropbox-expanded.part01.js は今回のロック対象で変更不可）ため、この
   フェーズでは「名前計算」と「手動リネーム時の固定」までを実装し、セル編集での即時
   リネームは対象外とする（既知の未達差分としてAGENT_INBOX.md等で追跡）。
   ============================== */
(function () {
  'use strict';

  function adoptedValue(properties, name) {
    const raw = (properties || {})[name];
    if (raw == null) return '';
    const list = Array.isArray(raw) ? raw : [raw];
    for (const status of ['採用', '掲載済み']) {
      for (const candidate of list) {
        if (candidate && typeof candidate === 'object' && String(candidate.status || '') === status) {
          const value = String(candidate.value || '').trim();
          if (value) return value;
        }
      }
    }
    for (const candidate of list) {
      const value = String(candidate && typeof candidate === 'object' ? (candidate.value || '') : (candidate || '')).trim();
      if (value) return value;
    }
    return '';
  }

  function splitValues(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return [];
    return text.split(/[,、\n]+/).map(part => part.trim()).filter(Boolean);
  }

  function normalizePage(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return '';
    if (/^\d+$/.test(text)) return 'p' + String(Number(text)).padStart(4, '0');
    const match = text.match(/^p(\d+)$/i);
    return match ? 'p' + String(Number(match[1])).padStart(4, '0') : text;
  }

  function normalizePanel(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return '';
    if (/^\d+$/.test(text)) return 'c' + String(Number(text)).padStart(2, '0');
    const match = text.match(/^c(\d+)$/i);
    return match ? 'c' + String(Number(match[1])).padStart(2, '0') : text;
  }

  // meldex_production_task_name_autofill.build_task_entry_name のJS移植。
  function buildTaskEntryName(properties) {
    if (!properties || typeof properties !== 'object') return '';
    const work = adoptedValue(properties, '作品タイトル') || adoptedValue(properties, '作品タイトル_話数');
    const pages = splitValues(adoptedValue(properties, 'ページ')).map(normalizePage);
    const panels = splitValues(adoptedValue(properties, 'コマ')).map(normalizePanel);
    const target = adoptedValue(properties, '作業対象リスト') || adoptedValue(properties, '作業対象');
    const content = adoptedValue(properties, '作業内容リスト') || adoptedValue(properties, '作業内容') || adoptedValue(properties, '作業');
    const scale = adoptedValue(properties, '作業規模リスト') || adoptedValue(properties, '作業規模');
    const count = adoptedValue(properties, '対象数');

    const parts = [];
    if (work) parts.push(work);
    if (pages.length) parts.push(pages.slice(0, 3).join('-') + (pages.length > 3 ? '他' : ''));
    if (panels.length) parts.push(panels.slice(0, 3).join('-') + (panels.length > 3 ? '他' : ''));
    if (target) parts.push(target);
    if (content) parts.push(content);
    if (scale && (scale !== '標準' || !parts.length)) parts.push(scale);
    if (count && count !== '1' && count !== '1.0') parts.push(`${count}件`);
    return parts.filter(Boolean).join(' ').trim();
  }

  const PLACEHOLDER_RE = /^(?:無題|Untitled|タスク|Task)(?:[\s_-]?\d+)?$/;

  // 制作管理UX改善計画（2026-08-04）§5-1: 「タスク名を固定」は元々フロントマター直下の
  // フラグだったが、production_internal.task_name_fixed へ統一移動した（Desktop
  // meldex_production_management_support.TASK_NAME_FIXED_INTERNAL_KEY /
  // meldex_production_task_name_autofill._task_name_fixed と同じ優先順位: internal優先・
  // 旧トップレベルはフォールバック）。task_name_auto_generated は今回の移行対象外の
  // ままトップレベル単発フラグ（Desktop TASK_NAME_AUTO_FLAG と同じ）。
  function isTaskNameFixed(frontmatter) {
    const internal = frontmatter && frontmatter.production_internal;
    if (internal && typeof internal === 'object' && 'task_name_fixed' in internal) {
      return !!internal.task_name_fixed;
    }
    return !!(frontmatter && frontmatter['タスク名を固定']);
  }

  // meldex_production_task_name_autofill._should_auto_update_name のJS移植。
  function shouldAutoUpdateName(currentName, frontmatter) {
    if (isTaskNameFixed(frontmatter)) return false;
    if (frontmatter && frontmatter.task_name_auto_generated) return true;
    return PLACEHOLDER_RE.test(String(currentName || ''));
  }

  window.MeldexProductionTaskNaming = { buildTaskEntryName, shouldAutoUpdateName, isTaskNameFixed, adoptedValue };
})();
