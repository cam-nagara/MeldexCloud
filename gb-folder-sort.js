/* フォルダツリーとフォルダパネルで共有する並び替え契約。 */
const FOLDER_SORT_OPTIONS = Object.freeze([
  { label: 'マニュアル', sort: 'manual', order: 'asc' },
  { label: '名前 ↑', sort: 'name', order: 'asc' },
  { label: '名前 ↓', sort: 'name', order: 'desc' },
  { label: '種類 ↑', sort: 'type', order: 'asc' },
  { label: '種類 ↓', sort: 'type', order: 'desc' },
  { label: '更新日時 ↑', sort: 'modified', order: 'asc' },
  { label: '更新日時 ↓', sort: 'modified', order: 'desc' },
  { label: '作成日時 ↑', sort: 'created', order: 'asc' },
  { label: '作成日時 ↓', sort: 'created', order: 'desc' },
  { label: 'サイズ ↑', sort: 'size', order: 'asc' },
  { label: 'サイズ ↓', sort: 'size', order: 'desc' },
]);
const FOLDER_SORT_COLLATOR = new Intl.Collator('ja', {
  numeric: true,
  sensitivity: 'base',
  ignorePunctuation: true,
});

function getFolderSortOptions() {
  return FOLDER_SORT_OPTIONS.map(option => ({ ...option }));
}

function _folderSortDateValue(item, key) {
  const raw = key === 'created'
    ? (item?.created || item?.created_at || item?.modified || item?.mtime || '')
    : (item?.modified || item?.mtime || item?.created || item?.created_at || '');
  const parsed = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareItemsForFolderSort(a, b, sort = 'name', order = 'asc') {
  const folderRank = item => (item?.type === 'folder' || item?.type === 'database' ? 0 : 1);
  const rankDiff = folderRank(a) - folderRank(b);
  if (rankDiff) return rankDiff;
  let result = 0;
  if (sort === 'created' || sort === 'modified') {
    result = _folderSortDateValue(a, sort) - _folderSortDateValue(b, sort);
  } else if (sort === 'size') {
    result = Number(a?.size || 0) - Number(b?.size || 0);
  } else if (sort === 'type') {
    result = FOLDER_SORT_COLLATOR.compare(String(a?.type || a?.ext || ''), String(b?.type || b?.ext || ''));
  } else if (sort === 'createdBy' || sort === 'modifiedBy') {
    const fallbackKey = sort === 'createdBy' ? 'created_by' : 'modified_by';
    result = FOLDER_SORT_COLLATOR.compare(
      String(a?.[sort] || a?.[fallbackKey] || ''),
      String(b?.[sort] || b?.[fallbackKey] || ''),
    );
  } else {
    result = FOLDER_SORT_COLLATOR.compare(String(a?.name || ''), String(b?.name || ''));
  }
  if (result && order === 'desc') result *= -1;
  return result
    || FOLDER_SORT_COLLATOR.compare(String(a?.name || ''), String(b?.name || ''))
    || FOLDER_SORT_COLLATOR.compare(String(a?.path || ''), String(b?.path || ''));
}
