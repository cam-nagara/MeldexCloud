/* gb-csv-conversion.js: CSVから新規Meldexシートを作る共通ウィザード。 */
(function (root) {
  'use strict';

  let active = null;

  function normalizePath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  }

  function fileStem(filename) {
    const leaf = String(filename || 'CSV').split(/[\\/]/).pop() || 'CSV';
    return leaf.replace(/\.csv$/i, '').trim() || 'CSV';
  }

  function uniqueHeaders(values, count) {
    const source = Array.from({ length: count }, (_, index) => values?.[index] ?? '');
    return root.MeldexCsv.uniqueHeaders(source);
  }

  function deriveColumns(rows, hasHeader, supplied) {
    const table = Array.isArray(rows) ? rows : [];
    const count = table.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
    const headers = hasHeader && table.length
      ? uniqueHeaders(table[0], count)
      : uniqueHeaders([], count);
    const inferred = root.MeldexCsv.inferColumns(
      hasHeader ? [headers].concat(table.slice(1)) : [headers].concat(table),
      true
    );
    return inferred.map((column, index) => {
      const existing = supplied?.[index] || {};
      return {
        name: String(existing.name || column.name),
        type: ['text', 'number', 'formula'].includes(existing.type) ? existing.type : column.type,
        formula: String(existing.formula || column.formula || ''),
        warning: String(existing.warning || column.warning || ''),
      };
    });
  }

  function close(result) {
    if (!active) return;
    const current = active;
    active = null;
    current.backdrop.remove();
    current.dialog.remove();
    current.resolve(result);
  }

  function rowElement(column, index) {
    const row = document.createElement('tr');
    row.dataset.columnIndex = String(index);
    const nameCell = document.createElement('td');
    const name = document.createElement('input');
    name.type = 'text';
    name.value = column.name;
    name.setAttribute('aria-label', `列${index + 1}の名前`);
    name.dataset.field = 'name';
    nameCell.appendChild(name);
    const typeCell = document.createElement('td');
    const type = document.createElement('select');
    type.dataset.field = 'type';
    type.setAttribute('aria-label', `列${index + 1}のタイプ`);
    [
      ['text', 'テキスト'],
      ['number', '数値'],
      ['formula', 'Meldex数式'],
    ].forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      type.appendChild(option);
    });
    type.value = column.type;
    typeCell.appendChild(type);
    const formulaCell = document.createElement('td');
    const formula = document.createElement('input');
    formula.type = 'text';
    formula.value = column.formula;
    formula.placeholder = '=prop("単価") * prop("数量")';
    formula.dataset.field = 'formula';
    formula.setAttribute('aria-label', `列${index + 1}の数式`);
    formula.hidden = column.type !== 'formula';
    type.addEventListener('change', () => { formula.hidden = type.value !== 'formula'; });
    formulaCell.appendChild(formula);
    const warningCell = document.createElement('td');
    warningCell.textContent = column.warning;
    warningCell.title = column.warning;
    row.append(nameCell, typeCell, formulaCell, warningCell);
    return row;
  }

  function renderColumns(dialog, columns) {
    const body = dialog.querySelector('.csv-convert-columns tbody');
    body.textContent = '';
    columns.forEach((column, index) => body.appendChild(rowElement(column, index)));
    const select = dialog.querySelector('[name="item-column"]');
    const previous = Number(select.value || 0);
    select.textContent = '';
    columns.forEach((column, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = column.name;
      select.appendChild(option);
    });
    select.value = String(Math.min(previous, Math.max(0, columns.length - 1)));
  }

  function readColumns(dialog) {
    return Array.from(dialog.querySelectorAll('.csv-convert-columns tbody tr')).map(row => ({
      name: row.querySelector('[data-field="name"]').value.trim(),
      type: row.querySelector('[data-field="type"]').value,
      formula: row.querySelector('[data-field="formula"]').value.trim(),
    }));
  }

  function validateColumns(columns) {
    const used = new Set();
    columns.forEach((column, index) => {
      if (!column.name) throw new Error(`列${index + 1}の名前を入力してください`);
      if (used.has(column.name)) throw new Error(`列名「${column.name}」が重複しています`);
      used.add(column.name);
      if (column.type === 'formula' && !root.MeldexCsv.isMeldexFormula(column.formula)) {
        throw new Error(`列「${column.name}」にはMeldex数式を入力してください`);
      }
    });
  }

  function pathParts(csvPath, filename, parentOverride) {
    const normalized = normalizePath(csvPath);
    const parent = parentOverride != null
      ? normalizePath(parentOverride)
      : normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '';
    return { parent, name: fileStem(filename || normalized) };
  }

  async function submit(options, dialog) {
    const columns = readColumns(dialog);
    validateColumns(columns);
    const parent = normalizePath(dialog.querySelector('[name="destination-parent"]').value);
    const sheetName = dialog.querySelector('[name="sheet-name"]').value.trim();
    if (!sheetName) throw new Error('シート名を入力してください');
    if (/[<>:"/\\|?*\x00-\x1f]/.test(sheetName) || sheetName === '.' || sheetName === '..') {
      throw new Error('シート名に使用できない文字が含まれています');
    }
    const mode = dialog.querySelector('[name="mode"]').value;
    const dbPath = mode === 'append'
      ? normalizePath(dialog.querySelector('[name="append-path"]').value)
      : normalizePath(parent ? `${parent}/${sheetName}` : sheetName);
    if (!dbPath) throw new Error('保存先を指定してください');
    const body = {
      mode,
      db_path: dbPath,
      filename: options.filename || 'CSV.csv',
      has_header: dialog.querySelector('[name="has-header"]').checked,
      item_name_column: Number(dialog.querySelector('[name="item-column"]').value || 0),
      columns,
      delimiter: options.dialect?.delimiter || ',',
      encoding: options.dialect?.encoding || 'utf-8',
      bom: options.dialect?.bom === true,
      if_match_etag: options.sourceEtag || '',
    };
    if (options.csvPath) body.csv_path = options.csvPath;
    else body.content = options.content != null
      ? String(options.content)
      : root.MeldexCsv.serialize(options.rows || [], options.dialect);

    const submitButton = dialog.querySelector('[data-command="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = '変換中...';
    try {
      const result = await apiPost('/import-csv', body);
      if (!result?.ok) throw new Error('変換を完了できませんでした');
      if (typeof options.onCreated === 'function') {
        await options.onCreated(result);
      } else {
        if (typeof loadOutliner === 'function') await loadOutliner();
        if (typeof selectDatabase === 'function') await selectDatabase(result.path);
      }
      const additions = [];
      if (result.completed_name_count) additions.push(`項目名補完 ${result.completed_name_count}件`);
      if (result.renamed_count) additions.push(`重複名調整 ${result.renamed_count}件`);
      const suffix = additions.length ? `（${additions.join('、')}）` : '';
      if (typeof showStatus === 'function') showStatus(`シートを作成しました: ${result.imported_count || 0}件${suffix}`);
      close(result);
      return result;
    } finally {
      if (active) {
        submitButton.disabled = false;
        submitButton.textContent = 'シートを作成';
      }
    }
  }

  function open(options) {
    if (!root.MeldexCsv) return Promise.reject(new Error('CSV解析機能を読み込めませんでした'));
    if (active) close(null);
    const value = options || {};
    const rows = Array.isArray(value.rows)
      ? value.rows
      : root.MeldexCsv.parse(String(value.content || ''), value.dialect).rows;
    if (!rows.length) return Promise.reject(new Error('CSVにデータがありません'));
    const hasHeader = value.hasHeader !== false;
    let columns = deriveColumns(rows, hasHeader, value.columns);
    const parts = pathParts(value.csvPath, value.filename, value.destinationParent);
    const backdrop = document.createElement('div');
    backdrop.className = 'csv-convert-backdrop';
    const dialog = document.createElement('section');
    dialog.className = 'csv-convert-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'csv-convert-title');
    dialog.innerHTML =
      '<h2 id="csv-convert-title">Meldexシートに変換</h2>' +
      '<div class="csv-convert-grid">' +
      '<label for="csv-destination-parent">保存先フォルダー</label>' +
      '<input id="csv-destination-parent" name="destination-parent" type="text">' +
      '<label for="csv-sheet-name">シート名</label>' +
      '<input id="csv-sheet-name" name="sheet-name" type="text">' +
      '<label for="csv-convert-mode">作成方法</label>' +
      '<select id="csv-convert-mode" name="mode"><option value="create">別名で新規作成</option><option value="append">既存シートへ追加</option></select>' +
      '<label for="csv-append-path" data-append-only hidden>追加先シート</label>' +
      '<input id="csv-append-path" name="append-path" type="text" data-append-only hidden>' +
      '<label for="csv-has-header">見出し</label>' +
      '<label><input id="csv-has-header" name="has-header" type="checkbox" checked> 1行目を列名として使う</label>' +
      '<label for="csv-item-column">項目名に使う列</label>' +
      '<select id="csv-item-column" name="item-column"></select>' +
      '</div>' +
      '<div class="csv-convert-columns"><table><thead><tr><th>列名</th><th>タイプ</th><th>数式</th><th>注意</th></tr></thead><tbody></tbody></table></div>' +
      '<div class="csv-dialog-actions"><button type="button" data-command="cancel">キャンセル</button><button type="button" data-command="submit">シートを作成</button></div>';
    dialog.querySelector('[name="destination-parent"]').value = parts.parent;
    dialog.querySelector('[name="sheet-name"]').value = parts.name;
    dialog.querySelector('[name="has-header"]').checked = hasHeader;
    renderColumns(dialog, columns);
    dialog.querySelector('[name="mode"]').addEventListener('change', event => {
      const append = event.currentTarget.value === 'append';
      dialog.querySelectorAll('[data-append-only]').forEach(element => { element.hidden = !append; });
      dialog.querySelector('[data-command="submit"]').textContent = append ? '既存シートへ追加' : 'シートを作成';
    });
    dialog.querySelector('[name="has-header"]').addEventListener('change', event => {
      columns = deriveColumns(rows, event.currentTarget.checked, readColumns(dialog));
      renderColumns(dialog, columns);
    });
    backdrop.addEventListener('click', () => close(null));
    dialog.querySelector('[data-command="cancel"]').addEventListener('click', () => close(null));
    dialog.querySelector('[data-command="submit"]').addEventListener('click', async () => {
      try {
        await submit({ ...value, rows }, dialog);
      } catch (error) {
        if (typeof showStatus === 'function') showStatus(error?.message || 'CSV変換に失敗しました', true);
      }
    });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(null);
      }
    });
    document.body.append(backdrop, dialog);
    dialog.querySelector('[name="sheet-name"]').focus();
    return new Promise(resolve => {
      active = { backdrop, dialog, resolve };
    });
  }

  async function openFile(file, options) {
    if (!file) return null;
    const bytes = await file.arrayBuffer();
    const view = new Uint8Array(bytes);
    const bom = view.length >= 3 && view[0] === 0xEF && view[1] === 0xBB && view[2] === 0xBF;
    let content;
    let encoding = bom ? 'utf-8-bom' : 'utf-8';
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      content = new TextDecoder('shift_jis', { fatal: true }).decode(bytes);
      encoding = 'cp932';
    }
    const parsed = root.MeldexCsv.parse(content, { encoding, bom });
    return open({
      ...(options || {}),
      content,
      rows: parsed.rows,
      dialect: parsed.dialect,
      filename: file.name,
    });
  }

  root.MeldexCsvConversion = Object.freeze({ open, openFile, close });
})(typeof window !== 'undefined' ? window : globalThis);
