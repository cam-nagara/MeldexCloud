/* ==============================
   gb-db-search.js: シート横断構造検索
   全シートのエントリ名+プロパティ値をフリーワードで横断検索
   ============================== */

/**
 * シート横断検索を実行する
 * @param {string} query - 検索キーワード
 * @param {string} scope - 特定シートパス（空=全シート）
 * @returns {Promise<object>} smart-dbレスポンス
 */
async function doDbSearch(query, scope) {
  if (!query) return { entities: [] };
  const params = new URLSearchParams({ q: query, filters: '[]' });
  if (scope) params.set('scope', scope);
  return await apiFetch('/smart-db?' + params.toString());
}

/* --- 検索モーダル --- */

/**
 * シート横断検索モーダルを表示
 */
function showDbSearchModal(options) {
  const opts = options || {};
  const preferredScope = opts.scope === 'current' ? (state.currentDbPath || '') : (opts.scope || '');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '100';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.cssText = 'width:750px;max-width:92vw;max-height:85vh;display:flex;flex-direction:column;';

  // ヘッダー
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-shrink:0;';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'シート横断検索...（エントリ名・プロパティ値）';
  input.style.cssText = 'flex:1;padding:6px 10px;font-size:14px;background:var(--bg3);color:var(--fg);border:1px solid var(--border);border-radius:4px;';

  const scopeSelect = document.createElement('select');
  scopeSelect.style.cssText = 'padding:4px 8px;font-size:12px;background:var(--bg3);color:var(--fg);border:1px solid var(--border);border-radius:4px;';
  const optAll = document.createElement('option');
  optAll.value = '';
  optAll.textContent = '全シート';
  scopeSelect.appendChild(optAll);
  // 既知のDBを列挙（フォルダツリーのルートから探索）
  _populateDbScopeOptions(scopeSelect);
  if (preferredScope && !Array.from(scopeSelect.options).some(opt => opt.value === preferredScope)) {
    const optCurrent = document.createElement('option');
    optCurrent.value = preferredScope;
    optCurrent.textContent = '現在のシート';
    scopeSelect.insertBefore(optCurrent, scopeSelect.options[1] || null);
  }
  if (preferredScope) {
    scopeSelect.value = preferredScope;
  }

  header.appendChild(input);
  header.appendChild(scopeSelect);
  modal.appendChild(header);

  // 結果エリア
  const resultArea = document.createElement('div');
  resultArea.style.cssText = 'flex:1;overflow-y:auto;min-height:200px;';
  resultArea.innerHTML = '<div style="text-align:center;padding:40px;color:var(--fg2);">キーワードを入力してEnterで検索</div>';
  modal.appendChild(resultArea);

  // フッター
  const footer = document.createElement('div');
  footer.style.cssText = 'margin-top:8px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;';
  const statusSpan = document.createElement('span');
  statusSpan.style.cssText = 'font-size:12px;color:var(--fg2);';
  footer.appendChild(statusSpan);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;';
  const exportBtn = document.createElement('button');
  exportBtn.textContent = 'CSVエクスポート';
  exportBtn.style.display = 'none';
  exportBtn.addEventListener('click', () => _exportDbSearchCsv(lastResults));
  btnRow.appendChild(exportBtn);
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '閉じる';
  closeBtn.addEventListener('click', () => overlay.remove());
  btnRow.appendChild(closeBtn);
  footer.appendChild(btnRow);
  modal.appendChild(footer);

  let lastResults = [];
  let searchSeq = 0;

  // 検索実行
  async function doSearch() {
    const q = input.value.trim();
    const seq = ++searchSeq;
    if (!q) {
      lastResults = [];
      exportBtn.style.display = 'none';
      resultArea.innerHTML = '<div style="text-align:center;padding:40px;color:var(--fg2);">キーワードを入力してEnterで検索</div>';
      statusSpan.textContent = '';
      return;
    }
    lastResults = [];
    exportBtn.style.display = 'none';
    statusSpan.textContent = '検索中...';
    resultArea.innerHTML = '';
    try {
      const data = await doDbSearch(q, scopeSelect.value);
      if (seq !== searchSeq) return;
      lastResults = data.entities || [];
      _renderDbSearchResults(resultArea, lastResults, q);
      statusSpan.textContent = lastResults.length + '件（' + (data.total_dbs_scanned || '?') + 'シート検索）';
      exportBtn.style.display = lastResults.length > 0 ? '' : 'none';
    } catch (e) {
      if (seq !== searchSeq) return;
      lastResults = [];
      exportBtn.style.display = 'none';
      resultArea.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red,#d16969);">検索エラー</div>';
      statusSpan.textContent = 'エラー';
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
    if (e.key === 'Escape') overlay.remove();
  });

  overlay.appendChild(modal);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  setTimeout(() => input.focus(), 50);
}

/* --- 結果描画 --- */

function _renderDbSearchResults(container, results, query) {
  if (results.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--fg2);">一致するエントリなし</div>';
    return;
  }

  const qLower = query.toLowerCase();

  results.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'db-search-result';

    // エントリ名 + シート名
    const titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = 'font-weight:bold;font-size:13px;';
    nameSpan.innerHTML = _highlightMatch(entry.name, qLower);
    titleRow.appendChild(nameSpan);
    const dbBadge = document.createElement('span');
    dbBadge.style.cssText = 'font-size:10px;background:var(--bg4);color:var(--fg2);padding:1px 6px;border-radius:8px;';
    dbBadge.textContent = (entry.root_name ? entry.root_name + '/' : '') + entry.db_name;
    titleRow.appendChild(dbBadge);
    item.appendChild(titleRow);

    // マッチしたプロパティプレビュー
    const props = entry.matched_props || {};
    const propKeys = Object.keys(props).slice(0, 5);
    if (propKeys.length > 0) {
      const propDiv = document.createElement('div');
      propDiv.style.cssText = 'font-size:11px;color:var(--fg2);margin-top:4px;line-height:1.5;';
      propKeys.forEach(pn => {
        const vals = props[pn] || [];
        const valTexts = vals.slice(0, 3).map(v => v.value || '').filter(Boolean);
        if (valTexts.length > 0) {
          const line = document.createElement('div');
          line.innerHTML = '<b>' + esc(pn) + ':</b> ' + _highlightMatch(valTexts.join(', '), qLower);
          propDiv.appendChild(line);
        }
      });
      item.appendChild(propDiv);
    }

    // クリック → 遷移
    item.addEventListener('click', () => {
      document.querySelector('.modal-overlay')?.remove();
      if (entry.db_path) {
        selectDatabase(entry.db_path).then(() => {
          if (entry.path && typeof selectEntity === 'function') {
            selectEntity(entry.path);
          }
        });
      }
    });

    container.appendChild(item);
  });
}

function _highlightMatch(text, qLower) {
  const escaped = esc(text);
  const qEsc = esc(qLower);
  try {
    return escaped.replace(new RegExp(qEsc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
      m => '<span style="background:var(--accent);color:var(--ui-fg-strong);padding:0 2px;border-radius:2px;">' + m + '</span>');
  } catch { return escaped; }
}

/* --- DBスコープ選択肢を列挙 --- */

function _populateDbScopeOptions(select) {
  // フォルダツリーのツリーからDB型ノードを収集（_nodeDataベース）
  const seen = new Set();
  document.querySelectorAll('#outliner-tree .tree-node').forEach(node => {
    const nd = node._nodeData;
    if (!nd || nd.type !== 'database' || !nd.path) return;
    if (seen.has(nd.path)) return;
    seen.add(nd.path);
    const opt = document.createElement('option');
    opt.value = nd.path;
    opt.textContent = nd.name || nd.path.split('/').pop();
    select.appendChild(opt);
  });
}

/* --- CSVエクスポート --- */

async function _exportDbSearchCsv(results) {
  if (!results || results.length === 0) return;

  // 全プロパティ名を収集
  const allProps = new Set();
  results.forEach(entry => {
    Object.keys(entry.matched_props || {}).forEach(p => allProps.add(p));
  });
  const propList = [...allProps];

  // CSV生成
  const rows = [];
  const header = ['エントリ名', 'シート名', 'ルート', ...propList];
  rows.push(header.map(h => '"' + h.replace(/"/g, '""') + '"').join(','));

  results.forEach(entry => {
    const row = [
      entry.name,
      entry.db_name,
      entry.root_name || '',
    ];
    propList.forEach(p => {
      const vals = (entry.matched_props || {})[p] || [];
      row.push(vals.map(v => v.value || '').join('; '));
    });
    rows.push(row.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(','));
  });

  if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveText !== 'function') {
    showStatus('保存ダイアログを初期化できませんでした', true);
    return;
  }
  await MeldexExportSave.saveText(rows.join('\n'), {
    filename: 'db-search-results.csv',
    extension: '.csv',
    dialogTitle: '検索結果CSVとして保存',
    filetypes: [['CSVファイル', '*.csv'], ['すべてのファイル', '*.*']],
    bom: true,
    okMessage: '検索結果CSVを保存しました',
    errorMessage: '検索結果CSVの保存に失敗しました',
  });
}
