/* gb-db-template-entity-layouts.js: シートテンプレートの entityLayouts（エントリレイアウト）
   サニタイズ / エクスポート / マージ適用 / 画像の選択同梱。
   gb-db-template-views.js（savedViews）と同じ「専用ファイル + typeofガード +
   未ロード時は entityLayouts 無しの旧経路へ自動フォールバック」の型に合わせる。 */
'use strict';

/* レイアウト1件をテンプレートへ持ち出せる形に正規化する。
   正規化は gb-db-entity-layout.js の共通関数へ委譲（未ロード環境ではシャローコピー）。 */
function _dbTemplateSanitizeEntityLayout(layout) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return null;
  if (typeof _elNormalizeLayout === 'function') return _elNormalizeLayout(JSON.parse(JSON.stringify(layout)));
  return JSON.parse(JSON.stringify(layout));
}

/* エクスポート: cfg.entityLayouts をサニタイズして返す（無ければ null）。
   アップロード画像は既定でパス参照のみ（バイナリ同梱は embedDbTemplateEntityLayoutImages で
   ユーザーが明示選択したセルだけ dataUri を付ける。localStorage容量への配慮）。 */
function exportDbTemplateEntityLayouts(cfg) {
  const layouts = Array.isArray(cfg?.entityLayouts) ? cfg.entityLayouts : [];
  const sanitized = layouts.map(_dbTemplateSanitizeEntityLayout).filter(Boolean);
  return sanitized.length ? sanitized : null;
}

/* テンプレート内の「アップロード画像を使う画像セル」を列挙する（作成モーダルの同梱チェックリスト用） */
function listDbTemplateEntityLayoutUploadImages(template) {
  const out = [];
  (Array.isArray(template?.entityLayouts) ? template.entityLayouts : []).forEach(layout => {
    (Array.isArray(layout?.cells) ? layout.cells : []).forEach(cell => {
      if (cell?.type === 'image' && cell.image?.source === 'upload' && (cell.image.path || cell.image.url)) {
        out.push({
          layoutName: String(layout.name || ''),
          cellId: String(cell.id || ''),
          path: String(cell.image.path || ''),
          cell,
        });
      }
    });
  });
  return out;
}

const DB_TEMPLATE_IMAGE_EMBED_MAX_BYTES = 500 * 1024;

/* 選択されたセルの画像を dataUri としてテンプレートへ同梱する。
   500KBを超える画像は同梱せずスキップ（localStorageの容量保護）。 */
async function embedDbTemplateEntityLayoutImages(template, selectedCellIds) {
  const selected = new Set(Array.isArray(selectedCellIds) ? selectedCellIds : []);
  const result = { embedded: 0, skipped: 0 };
  if (!selected.size) return result;
  for (const item of listDbTemplateEntityLayoutUploadImages(template)) {
    if (!selected.has(item.cellId)) continue;
    try {
      const url = (typeof fileRawUrl === 'function' && item.path) ? fileRawUrl(item.path) : (item.cell.image.url || '');
      if (!url) { result.skipped += 1; continue; }
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      if (blob.size > DB_TEMPLATE_IMAGE_EMBED_MAX_BYTES) {
        result.skipped += 1;
        continue;
      }
      const dataUri = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('read error'));
        reader.readAsDataURL(blob);
      });
      item.cell.image = { ...item.cell.image, dataUri };
      result.embedded += 1;
    } catch {
      result.skipped += 1;
    }
  }
  return result;
}

/* 適用: 既存レイアウトと名前が一致するものは加算スキップ（savedViewsの方針に合わせる。
   overwrite 時は同名の中身を置き換える）。追加分は id をすべて振り直し、タブ順の末尾へ足す。
   結果は cfg._dbTemplateEntityLayoutsResult = { added, skipped } に格納する。 */
function _applyDbTemplateEntityLayouts(cfg, template, overwrite) {
  const incoming = Array.isArray(template?.entityLayouts) ? template.entityLayouts : [];
  if (incoming.length === 0) return false;
  const genId = (prefix) => (typeof _elGenId === 'function'
    ? _elGenId(prefix)
    : prefix + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1679616).toString(36));
  const state = typeof _elNormalizeState === 'function'
    ? _elNormalizeState(cfg)
    : {
      layouts: Array.isArray(cfg.entityLayouts) ? cfg.entityLayouts : [],
      tabOrder: Array.isArray(cfg.entityTabOrder) && cfg.entityTabOrder.length ? cfg.entityTabOrder : ['columns'],
      currentTab: cfg.currentEntityTab || 'columns',
    };
  let added = 0;
  let skipped = 0;
  incoming.forEach(raw => {
    const layout = _dbTemplateSanitizeEntityLayout(raw);
    if (!layout) return;
    const existing = state.layouts.find(l => String(l?.name || '') === layout.name);
    if (existing) {
      if (!overwrite) {
        skipped += 1;
        return;
      }
      // overwrite: 同名レイアウトの中身を置き換える（idとタブ位置は既存を維持）
      existing.canvasSize = layout.canvasSize;
      existing.theme = layout.theme;
      existing.cells = (layout.cells || []).map(cell => ({ ...cell, id: genId('cell') }));
      added += 1;
      return;
    }
    const clone = JSON.parse(JSON.stringify(layout));
    clone.id = genId('el');
    clone.cells = (clone.cells || []).map(cell => ({ ...cell, id: genId('cell') }));
    state.layouts.push(clone);
    state.tabOrder.push(clone.id);
    added += 1;
  });
  cfg.entityLayouts = state.layouts;
  cfg.entityTabOrder = state.tabOrder;
  cfg.currentEntityTab = state.currentTab;
  cfg._dbTemplateEntityLayoutsResult = { added, skipped };
  return true;
}
