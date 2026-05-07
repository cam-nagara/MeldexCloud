/* ==============================
   gb-db-actions.js: DBアクションボタン + バックリンク集約表示
   依存: gb-database.js, gb-editor.js, meldex-core.js
   ============================== */

function _padDbActionDatePart(n) {
  return String(n).padStart(2, '0');
}

function _formatDbActionDate(date, includeTime) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  const base = `${d.getFullYear()}-${_padDbActionDatePart(d.getMonth() + 1)}-${_padDbActionDatePart(d.getDate())}`;
  if (!includeTime) return base;
  return `${base}T${_padDbActionDatePart(d.getHours())}:${_padDbActionDatePart(d.getMinutes())}:${_padDbActionDatePart(d.getSeconds())}`;
}

// === テンプレート変数展開 ===
function _expandTemplate(template, entryName, properties) {
  if (!template || typeof template !== 'string') return template || '';
  const propMap = properties && typeof properties === 'object' ? properties : {};
  const propNames = Object.keys(propMap).sort((a, b) => b.length - a.length);
  const propValue = (propName) => {
    const vals = propMap[propName];
    if (!Array.isArray(vals)) return '';
    const adopted = vals.find(v => v.status === '採用' || v.status === '掲載済み');
    const picked = adopted || vals[0];
    return picked?.value == null ? '' : String(picked.value);
  };
  let result = '';
  for (let i = 0; i < template.length;) {
    if (template[i] !== '$') {
      result += template[i++];
      continue;
    }
    if (template.startsWith('$entry_name', i)) { result += entryName || ''; i += '$entry_name'.length; continue; }
    if (template.startsWith('$user', i)) { result += typeof getUsername === 'function' ? getUsername() : 'anonymous'; i += '$user'.length; continue; }
    if (template.startsWith('$today', i)) { result += _formatDbActionDate(new Date(), false); i += '$today'.length; continue; }
    if (template.startsWith('$now', i)) { result += _formatDbActionDate(new Date(), true); i += '$now'.length; continue; }
    if (template.startsWith('$prop:', i)) {
      const start = i + '$prop:'.length;
      let end = start;
      while (end < template.length && template[end] !== '$' && !/\s/.test(template[end])) end++;
      const token = template.slice(start, end);
      const propName = propNames.find(name => token === name || token.startsWith(name));
      if (propName) {
        result += propValue(propName) + token.slice(propName.length);
      }
      i = end;
      continue;
    }
    result += template[i++];
  }
  return result;
}

function _safeDbActionIconName(iconName) {
  const name = String(iconName || '').trim();
  return /^[A-Za-z][A-Za-z0-9-]{0,48}$/.test(name) ? name : '';
}

function _dbActionValueTarget(path) {
  return String(path || '').toLowerCase().endsWith('.md')
    ? { entry_path: path }
    : { folder_path: path };
}

function _normalizeDbActionPath(path) {
  const parts = String(path || '').replace(/\\/g, '/').split('/');
  const out = [];
  parts.forEach(part => {
    if (!part || part === '.') return;
    if (part === '..') out.pop();
    else out.push(part);
  });
  return out.join('/');
}

function _resolveDbActionRelativePath(baseDbPath, relativePath) {
  const raw = String(relativePath || '').trim().replace(/\\/g, '/');
  if (!raw) return String(baseDbPath || '');
  if (/^[A-Za-z]:\//.test(raw) || raw.startsWith('/')) return raw;
  const dbPath = String(baseDbPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const dbParent = dbPath.replace(/\/[^/]*$/, '');
  const base = raw.startsWith('./') || raw.startsWith('../') ? dbPath : dbParent;
  return _normalizeDbActionPath((base ? base + '/' : '') + raw);
}

// === エントリ詳細にアクションボタンを表示 ===
function _renderEntityActions(data, entityPath) {
  const container = document.getElementById('entity-freetext');
  if (!container) return;
  container.parentElement.querySelector('.db-action-bar')?.remove();

  const meta = state.dbMetadata;
  if (!meta || !meta.actions || meta.actions.length === 0) return;

  let bar = container.parentElement.querySelector('.db-action-bar');
  bar = document.createElement('div');
  bar.className = 'db-action-bar';
  bar.style.cssText = 'padding:8px 0;display:flex;gap:8px;flex-wrap:wrap;';

  meta.actions.forEach(action => {
    const btn = document.createElement('button');
    btn.style.cssText = 'display:flex;align-items:center;gap:4px;padding:4px 12px;background:var(--accent);color:var(--ui-fg-strong);border:none;border-radius:4px;cursor:pointer;font-size:13px;';
    const safeIcon = _safeDbActionIconName(action.icon);
    if (safeIcon && typeof lucide === 'function') btn.innerHTML = lucide(safeIcon, 14);
    const label = document.createElement('span');
    label.textContent = action.label || 'アクション';
    btn.appendChild(label);
    btn.addEventListener('click', () => _showDbActionModal(action, data, entityPath));
    bar.appendChild(btn);
  });

  container.parentElement.insertBefore(bar, container);
}

// === アクションモーダル表示 ===
function _showDbActionModal(action, data, entityPath) {
  const entryName = data.entity || '';
  const properties = data.properties || {};

  let html = '<div class="modal-overlay"><div class="modal" style="width:500px;max-height:80vh;overflow:auto;">';
  html += `<h3 style="margin:0 0 12px;">${esc(action.label || 'アクション実行')}</h3>`;

  // エントリ本文（操作手順等）をプレビュー表示
  if (data.page_content) {
    html += `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:8px;margin-bottom:12px;font-size:13px;max-height:200px;overflow-y:auto;">${mdToHtml(data.page_content)}</div>`;
  }

  // auto_copy のプレビュー
  if (action.auto_copy) {
    html += '<div style="font-size:12px;color:var(--fg2);margin-bottom:8px;">自動コピー項目:</div>';
    html += '<table style="font-size:12px;width:100%;margin-bottom:12px;">';
    for (const [key, tmpl] of Object.entries(action.auto_copy)) {
      const val = _expandTemplate(tmpl, entryName, properties);
      html += `<tr><td style="padding:2px 8px 2px 0;color:var(--fg2);">${esc(key)}</td><td>${esc(val)}</td></tr>`;
    }
    html += '</table>';
  }

  // input_fields
  if (action.input_fields && action.input_fields.length > 0) {
    html += '<div style="font-size:12px;color:var(--fg2);margin-bottom:4px;">入力項目:</div>';
    action.input_fields.forEach((field, i) => {
      html += `<div style="margin-bottom:8px;"><label style="font-size:12px;color:var(--fg2);">${esc(field.property)}${field.required ? ' *' : ''}</label>`;
      if (field.type === 'select' && field.options) {
        html += `<select data-field-index="${i}" class="gb-select" style="width:100%;">`;
        html += '<option value="">-- 選択 --</option>';
        field.options.forEach(opt => { html += `<option value="${esc(opt)}">${esc(opt)}</option>`; });
        html += '</select>';
      } else {
        html += `<input data-field-index="${i}" type="text" placeholder="${esc(field.placeholder || '')}" style="width:100%;padding:4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;box-sizing:border-box;">`;
      }
      html += '</div>';
    });
  }

  html += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">';
  html += '<button class="modal-cancel" style="padding:4px 16px;cursor:pointer;">キャンセル</button>';
  html += '<button class="modal-exec primary" style="padding:4px 16px;cursor:pointer;">実行</button>';
  html += '</div></div></div>';

  const overlay = document.createElement('div');
  overlay.innerHTML = html;
  const el = overlay.firstChild;
  document.body.appendChild(el);

  el.querySelector('.modal-cancel').addEventListener('click', () => el.remove());
  el.querySelector('.modal-exec').addEventListener('click', async () => {
    // バリデーション
    const inputValues = {};
    if (action.input_fields) {
      for (let i = 0; i < action.input_fields.length; i++) {
        const field = action.input_fields[i];
        const input = el.querySelector('[data-field-index="' + i + '"]');
        const val = input ? input.value.trim() : '';
        if (field.required && !val) {
          showStatus(field.property + ' は必須です', true);
          input?.focus();
          return;
        }
        inputValues[field.property] = val;
      }
    }
    await _executeDbAction(action, data, entityPath, inputValues);
    el.remove();
  });
}

// === アクション実行 ===
async function _executeDbAction(action, data, entityPath, inputValues) {
  const entryName = data.entity || '';
  const properties = data.properties || {};

  // target_db パス解決（現在のDB相対）
  const dbPath = state.currentDbPath || '';
  const targetDb = _resolveDbActionRelativePath(dbPath, action.target_db || '');

  // エントリ名テンプレート展開 + サニタイズ
  let newEntryName = _expandTemplate(action.entry_name || entryName, entryName, properties);
  newEntryName = newEntryName.replace(/[\\/:*?"<>|]/g, '_');
  const valueWrites = [];
  if (action.auto_copy) {
    for (const [propName, tmpl] of Object.entries(action.auto_copy)) {
      const val = _expandTemplate(tmpl, entryName, properties);
      if (val) valueWrites.push({ property: propName, value: val });
    }
  }
  for (const [propName, val] of Object.entries(inputValues || {})) {
    if (val) valueWrites.push({ property: propName, value: val });
  }

  let newEntityPath = '';
  try {
    // エントリ作成
    const created = await apiPost('/entity/create', { parent_path: targetDb, name: newEntryName });

    // auto_copy プロパティ設定
    // /api/value は entry_path (新形式 .md) または folder_path (旧形式) を期待する。
    // create_entity は新旧形式どちらでも path を返す。未返却時だけ従来推定にフォールバックする。
    newEntityPath = (created && (created.path || created.entry_path))
      || (targetDb + '/' + newEntryName + '.md');
    // §12.1 Phase 0: autoFillOnCreate 適用（R8: auto_copy で指定されるプロパティはスキップ）
    if (typeof _autoFillOnCreate === 'function'
        && (typeof _shouldRunFrontendAutoFillOnCreate !== 'function' || _shouldRunFrontendAutoFillOnCreate(created))) {
      const overrides = {};
      for (const k of Object.keys(action.auto_copy || {})) overrides[k] = true;
      try { await _autoFillOnCreate(targetDb, newEntityPath, overrides); } catch {}
    }
    // auto_copy / input_fields プロパティ設定
    for (const item of valueWrites) {
      await apiPost('/value', { ..._dbActionValueTarget(newEntityPath), property: item.property, value: item.value, status: '採用', note: '' });
    }

    showStatus((action.label || 'アクション') + ' 完了: ' + newEntryName);
    // ターゲットDBが現在のDBなら再読み込み
    if (targetDb === (state.currentDbPath || '')) {
      selectDatabase(targetDb);
    }
  } catch (e) {
    if (newEntityPath) {
      try { await apiPost('/outliner/delete', { path: newEntityPath }); } catch {}
    }
    showStatus('アクション失敗: ' + (e.message || e), true);
  }
}

// === エントリ詳細にバックリンク表示 ===
async function _renderEntityBacklinks(data, entityPath) {
  const container = document.getElementById('entity-freetext');
  if (!container) return;
  const parent = container.parentElement;

  // 既存のバックリンクセクションを除去
  parent.querySelectorAll('.db-backlinks-section').forEach(s => s.remove());

  const meta = state.dbMetadata;
  if (!meta || !meta.backlinks || meta.backlinks.length === 0) return;

  const entryName = data.entity || '';
  const properties = data.properties || {};

  for (const bl of meta.backlinks) {
    const dbPath = state.currentDbPath || '';
    const sourceDb = _resolveDbActionRelativePath(dbPath, bl.source_db || '');
    const matchValue = _expandTemplate(bl.match_value || '', entryName, properties);

    try {
      const result = await apiFetch('/backlinks?source_db=' + encodeURIComponent(sourceDb)
        + '&match_property=' + encodeURIComponent(bl.match_property || '')
        + '&match_value=' + encodeURIComponent(matchValue));

      // エントリが切り替わっていたら描画をスキップ（race condition防止）
      if (state.currentEntityPath !== entityPath) return;

      const section = document.createElement('div');
      section.className = 'db-backlinks-section';
      section.style.cssText = 'margin-top:12px;border-top:1px solid var(--border);padding-top:8px;';

      const entries = Array.isArray(result?.entries) ? result.entries : [];
      let header = `<div style="font-size:13px;font-weight:bold;color:var(--fg2);margin-bottom:6px;">${esc(bl.label || 'バックリンク')} (${entries.length})</div>`;
      section.innerHTML = header;

      if (entries.length === 0) {
        section.innerHTML += '<div style="font-size:12px;color:var(--fg2);padding:4px 0;">(なし)</div>';
      } else {
        const displayProps = bl.display_properties || [];
        let tableHtml = '<table style="font-size:12px;width:100%;border-collapse:collapse;">';
        tableHtml += '<thead><tr>';
        displayProps.forEach(p => { tableHtml += `<th style="text-align:left;padding:3px 6px;border-bottom:1px solid var(--border);color:var(--fg2);">${esc(p)}</th>`; });
        tableHtml += '</tr></thead><tbody>';
        entries.forEach(entry => {
          tableHtml += '<tr>';
          displayProps.forEach(p => {
            tableHtml += `<td style="padding:3px 6px;border-bottom:1px solid var(--border);">${esc(entry[p] || '')}</td>`;
          });
          tableHtml += '</tr>';
        });
        tableHtml += '</tbody></table>';
        section.innerHTML += tableHtml;
      }

      parent.appendChild(section);
    } catch (e) { console.warn('backlinks fetch failed:', bl.source_db, e); }
  }
}

// === ピボットにバックリンク集約列を追加 ===
async function _appendBacklinkSummaryColumns(ctx) {
  const meta = state.dbMetadata;
  if (!meta || !meta.backlinks) return;

  const backlinkDefs = meta.backlinks.filter(bl => bl.summary_property);
  if (backlinkDefs.length === 0) return;

  const dbPath = ctx.dbPath || state.currentDbPath || '';
  const dbDir = dbPath.replace(/[/\\][^/\\]*$/, '');
  const table = _paneEl(ctx, '#pivot-table') || document.getElementById('pivot-table');
  if (!table) return;
  const renderToken = ctx?._renderToken;
  table.querySelectorAll('[data-backlink-summary="true"]').forEach(el => el.remove());

  for (const bl of backlinkDefs) {
    const sourceDb = dbDir + '/' + (bl.source_db || '').replace(/^\.\//, '');
    try {
      const result = await apiFetch('/backlinks/summary?source_db=' + encodeURIComponent(sourceDb)
        + '&match_property=' + encodeURIComponent(bl.match_property || '')
        + '&summary_property=' + encodeURIComponent(bl.summary_property || ''));
      if (ctx && renderToken && ctx._renderToken !== renderToken) return;

      const summary = result.summary || {};
      // ピボットテーブルに列を追加
      // ヘッダーに列追加
      const thead = table.querySelector('thead tr');
      if (!thead) continue;
      const th = document.createElement('th');
      th.dataset.backlinkSummary = 'true';
      th.textContent = bl.label || bl.summary_property;
      th.style.cssText = 'padding:4px 8px;font-size:12px;white-space:nowrap;';
      thead.appendChild(th);

      // 各行に集約データ追加
      const rows = table.querySelectorAll('tbody tr[data-entity-name]');
      rows.forEach(row => {
        const nameCell = row.querySelector('.entity-name-label');
        const entityName = nameCell ? nameCell.textContent.trim() : '';
        const td = document.createElement('td');
        td.dataset.backlinkSummary = 'true';
        td.style.cssText = 'padding:4px 8px;font-size:12px;';
        const counts = summary[entityName];
        if (counts) {
          td.innerHTML = Object.entries(counts)
            .map(([val, cnt]) => `<span style="margin-right:6px;">${esc(val)}:${cnt}</span>`)
            .join('');
        } else {
          td.innerHTML = '<span style="color:var(--fg2);">(未着手)</span>';
        }
        row.appendChild(td);
      });

      // tfoot にも空セル追加
      const tfoot = table.querySelector('tfoot tr');
      if (tfoot) {
        const td = document.createElement('td');
        td.dataset.backlinkSummary = 'true';
        td.style.cssText = 'padding:4px 8px;';
        tfoot.appendChild(td);
      }
    } catch (e) { console.warn('backlink summary failed:', bl.source_db, e); }
  }
}
