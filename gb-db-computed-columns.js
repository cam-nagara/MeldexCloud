/* ==============================
   gb-db-computed-columns.js: 計算列（読み取り専用・コードが更新する列）の汎用基盤

   制作管理UX改善計画（app/docs/production-management-ux-improvement-plan-2026-08-04.md）
   §5-1 末尾「読み取り専用列の実現には共通シート基盤に『計算列』の列属性が必要」に対応する
   汎用機能。制作管理シートに限らず、どのシートでも使える形で実装する。

   宣言方法（追加のみの後方互換キー。旧版はこのキーを無視して読める）:
     シートのフォルダノート（type: settings-db）のフロントマターに
       computed_props: ["列名", ...]
     を追加すると、その列は「コードが値を更新する読み取り専用列」として扱われる。
     Desktop/Cloud とも GET/PUT の /db-metadata が computed_props をそのまま透過するため、
     フロントは state.dbMetadata.computed_props（getPropertyTypes と同じ経路）から読める。

   ブロック対象（多層防御の最終層。実際の書き込み拒否は Desktop
   meldex_api_database.part02.py の /api/value と Cloud
   gb-data-access-dropbox-expanded.part01.js の _updateValue/_addValue/
   _updateSheetStoreValue/_addSheetStoreValue が担う。ここは UI 層のブロックのみ）:
     - checkColumnEditable() 経由でセルの直接編集開始（インライン編集・グループD&D・
       かんばんD&D）、貼り付け（_dbCellAllowsPaste）、自動入力（_autoFillOnCreate/
       _autoFillOnStatusChange）、一括編集ダイアログの対象列選択（editableProps フィルタ）
       を横断的にブロックする（gb-db-core.js の checkColumnEditable への1フックのみ追加、
       個別ファイルへの追加は行わない）。
     - getSchemaProtectionLevel() 経由で列タイプ設定（削除・列名変更・型変更）をブロック
       する（v0.6.191 必須列保護と同じ経路。'computed' レベルとして統合）。

   内部コード（同期フック・再計算エンジン等がフロントマターを直接書く経路）はこの基盤の
   対象外（それらは /value を通らないため、そもそもここでブロックされない）。
   ============================== */

const COMPUTED_COLUMN_EDIT_BLOCKED_MESSAGE = 'この列は自動計算のため直接編集できません';
const COMPUTED_COLUMN_HEADER_TOOLTIP = '自動計算列です。値はアプリが更新します';

// シートのフォルダノートに宣言された computed_props（列名の配列）を返す。
// getPropertyTypes() と同じ経路（_ptMetadataForDbPath = state.dbMetadata / ctx.dbMetadata）
// で同期的に読む。宣言が無い・型が不正な場合は空配列（後方互換）。
function getComputedProps(dbPath, ctxOverride) {
  const targetPath = dbPath || (typeof state !== 'undefined' ? state.currentDbPath : '') || '';
  if (!targetPath) return [];
  const metadata = typeof _ptMetadataForDbPath === 'function'
    ? _ptMetadataForDbPath(targetPath, ctxOverride)
    : (typeof state !== 'undefined' ? state.dbMetadata : null);
  const raw = metadata && metadata.computed_props;
  if (!Array.isArray(raw)) return [];
  return raw.map(name => String(name || '').trim()).filter(Boolean);
}

function isComputedColumn(dbPath, propName, ctxOverride) {
  if (!propName) return false;
  return getComputedProps(dbPath, ctxOverride).includes(propName);
}

// checkColumnEditable() から呼ばれる。編集不可なら理由メッセージ、編集可なら null を返す
// （checkColumnEditable 自体の戻り値契約と同じ）。
function computedColumnEditBlockedMessage(dbPath, propName, ctxOverride) {
  return isComputedColumn(dbPath, propName, ctxOverride) ? COMPUTED_COLUMN_EDIT_BLOCKED_MESSAGE : null;
}

// getSchemaProtectionLevel() から呼ばれる。既存の 'all' / 'required' と同じ形の
// レベル文字列を返す（'computed' / null）。
function computedColumnSchemaProtectionLevel(dbPath, propName) {
  return isComputedColumn(dbPath, propName) ? 'computed' : null;
}

// 列ヘッダーへ鍵アイコン＋ツールチップを付与する（gb-db-table.part03.js のヘッダー構築の
// 「列ロック / sourceインジケータ」ブロックから1行で呼ばれる）。付与したら true を返す。
function attachComputedColumnHeaderIcon(th, dbPath, propName, ctx) {
  if (!th || !isComputedColumn(dbPath, propName, ctx)) return false;
  th.classList.add('db-computed-header');
  const icon = document.createElement('span');
  icon.className = 'th-lock-icon th-computed-icon';
  icon.style.cssText = 'opacity:0.6;margin-left:4px;flex-shrink:0;';
  icon.innerHTML = typeof lucide === 'function' ? lucide('key', 12) : '';
  icon.title = COMPUTED_COLUMN_HEADER_TOOLTIP;
  icon.setAttribute('aria-label', COMPUTED_COLUMN_HEADER_TOOLTIP);
  th.appendChild(icon);
  return true;
}

// セルへ読み取り専用の薄い背景クラスを付与する（gb-db-table.part02.js の renderEntityCell
// から1行で呼ばれる）。付与したら true を返す。
function applyComputedColumnCellStyle(td, dbPath, propName, ctx) {
  if (!td || !isComputedColumn(dbPath, propName, ctx)) return false;
  td.classList.add('db-cell-computed');
  return true;
}

// 計算列セルの「表示合成」拡張点（production-management-ux-improvement-plan-2026-08-04.md
// §5-1「予定セルの合成表示」向けの安全な拡張点。制作管理に限らず、どの計算列でも使える
// 汎用フックとして実装する）。列名 -> (td, container, entityData, meta) => void の
// 装飾関数を window.MeldexCellDisplayAugment.decorators に登録すると、その列が計算列
// （computed_props宣言済み）である時だけ、値表示コンテナが組み上がった直後に呼ばれる。
// 登録は単純なグローバルオブジェクトへのプロパティ代入のため、このファイルと登録側
// （例: gb-production-management.part02.js）のスクリプト読込順に依存しない（描画時に
// 遅延解決するため、登録側が後から読み込まれても動く）。
function decorateComputedColumnCell(td, container, dbPath, propName, entityData, ctx) {
  if (!td || !container || !isComputedColumn(dbPath, propName, ctx)) return false;
  const decorator = typeof window !== 'undefined'
    ? window.MeldexCellDisplayAugment?.decorators?.[propName]
    : null;
  if (typeof decorator !== 'function') return false;
  try {
    decorator(td, container, entityData, { dbPath, propName, ctx });
    return true;
  } catch (err) {
    console.error('計算列セルの表示合成に失敗しました:', propName, err);
    return false;
  }
}

if (typeof window !== 'undefined') {
  window.MeldexComputedColumns = Object.freeze({
    getComputedProps,
    isComputedColumn,
    editBlockedMessage: computedColumnEditBlockedMessage,
    schemaProtectionLevel: computedColumnSchemaProtectionLevel,
    attachHeaderIcon: attachComputedColumnHeaderIcon,
    applyCellStyle: applyComputedColumnCellStyle,
    decorateCell: decorateComputedColumnCell,
    EDIT_BLOCKED_MESSAGE: COMPUTED_COLUMN_EDIT_BLOCKED_MESSAGE,
    HEADER_TOOLTIP: COMPUTED_COLUMN_HEADER_TOOLTIP,
  });
}
