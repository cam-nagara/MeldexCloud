  // 改行コード正規化（CRLF→LF）
  md = md.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // フロントマター（YAML）を除去
  md = md.replace(/^---\n[\s\S]*?\n---\n?/, '');
  // 注釈用 line-id マーカーをセンチネル化。リスト/見出し/引用の場合はマーカー記号の直後へ、
  // その他は単独行としてブロック前に残し、末尾で span 化 → 隣接ブロックへ移送する。
  md = md.replace(/^<!--nl:([A-Za-z0-9_-]+)-->\r?\n([^\n]*)/gm, (m, id, nextLine) => {
    const sen = '\x02NLID:' + id + '\x02';
    const listM = nextLine.match(/^(\s*(?:[*\-+]|\d+\.)\s+)(.*)$/);
    if (listM) return listM[1] + sen + listM[2];
    const hM = nextLine.match(/^(#{1,6}\s+)(.*)$/);
    if (hM) return hM[1] + sen + hM[2];
    const qM = nextLine.match(/^(>\s*)(.*)$/);
    if (qM) return qM[1] + sen + qM[2];
    return sen + '\n' + nextLine;
  });

  const lines = md.split('\n');
  let html = '';
  let inCodeBlock = false, codeLang = '';
  let inTable = false, _tableRowCount = 0;
  let pendingTableLayout = null;
  let pendingNoteTitle = false;
  const headingSlugCounts = new Map();
  // リストネスト管理: スタックで深度・種別を追跡
  const listStack = []; // [{ type: 'ul'|'ol', indent: number }, ...]

  function closeListAll() {
    while (listStack.length > 0) {
      const t = listStack.pop();
      html += t.type === 'ul' ? '</ul>' : '</ol>';
    }
  }
  function adjustListDepth(indent, type) {
    // 現在の深度より浅くなった分だけ閉じる
    while (listStack.length > 0) {
      const top = listStack[listStack.length - 1];
      if (top.indent > indent) {
        listStack.pop();
        html += top.type === 'ul' ? '</ul>' : '</ol>';
      } else if (top.indent === indent && top.type !== type) {
        // 同深度でリスト種別が変わった場合は閉じて開き直す
        listStack.pop();
        html += top.type === 'ul' ? '</ul>' : '</ol>';
        break;
      } else {
        break;
      }
    }
    // スタックが空、または現在の深度より浅い場合は新しいリストを開く
    if (listStack.length === 0 || listStack[listStack.length - 1].indent < indent) {
      html += type === 'ul' ? '<ul>' : '<ol>';
      listStack.push({ type, indent });
    }
  }

  function splitMarkdownTableRow(line) {
    const cells = [];
    let cell = '';
    for (let i = 1; i < line.length - 1; i++) {
      const ch = line[i];
      if (ch === '\\' && i + 1 < line.length - 1) {
        const next = line[i + 1];
        if (next === '|') { cell += '|'; i++; continue; }
        cell += ch + next; i++; continue;
      }
      if (ch === '|') {
        cells.push(cell.trim());
        cell = '';
      } else {
        cell += ch;
      }
    }
    cells.push(cell.trim());
    return cells;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // コードブロック
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        html += '</code></pre>';
        inCodeBlock = false;
      } else {
        closeListAll();
        codeLang = line.slice(3).trim();
        html += `<pre style="background:var(--bg3);padding:8px;border-radius:4px;overflow-x:auto;font-size:13px;"${codeLang ? ` data-lang="${esc(codeLang)}"` : ''}><code>`;
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      html += esc(line) + '\n';
      continue;
    }

    const tableLayoutMatch = line.match(/^<!--table-layout:(.+)-->\s*$/);
    if (tableLayoutMatch) {
      try {
        pendingTableLayout = JSON.parse(tableLayoutMatch[1]);
      } catch {
        pendingTableLayout = null;
      }
      continue;
    }

    // テーブル
    if (line.match(/^\|.*\|$/)) {
      closeListAll();
      // 区切り行（|---|---|）はスキップ
      if (line.match(/^\|[\s\-:|]+\|$/)) continue;
      const cells = splitMarkdownTableRow(line);
      if (!inTable) {
        const layoutJson = pendingTableLayout ? esc(JSON.stringify(pendingTableLayout)) : '';
        const hasWidths = Array.isArray(pendingTableLayout?.colWidths) && pendingTableLayout.colWidths.some(width => Number(width) > 0);
        html += `<table style="border-collapse:collapse;width:100%;margin:8px 0;${hasWidths ? 'table-layout:fixed;' : ''}"${layoutJson ? ` data-note-table-layout="${layoutJson}" data-note-table-resized="1"` : ''}>`;
        if (hasWidths) {
          html += '<colgroup>' + cells.map((_, ci) => {
            const rawWidth = Number(pendingTableLayout.colWidths[ci]) || 0;
            const width = rawWidth > 0 ? Math.max(40, rawWidth) : 0;
            return width ? `<col style="width:${width}px;">` : '<col>';
          }).join('') + '</colgroup>';
        }
        inTable = true;
        _tableRowCount = 0;
      }
      const tag = _tableRowCount === 0 ? 'th' : 'td';
      const rowHeight = Array.isArray(pendingTableLayout?.rowHeights)
        ? Math.max(24, Number(pendingTableLayout.rowHeights[_tableRowCount]) || 0)
        : 0;
      _tableRowCount++;
      const rowStyle = rowHeight ? ` style="height:${rowHeight}px;"` : '';
      const cellHeight = rowHeight ? `height:${rowHeight}px;` : '';
      html += `<tr${rowStyle}>` + cells.map(c => `<${tag} style="border:1px solid var(--border);padding:4px 8px;${cellHeight}">${inlinemd(c)}</${tag}>`).join('') + '</tr>';
      continue;
    }
    if (inTable) { html += '</table>'; inTable = false; pendingTableLayout = null; }

    // details/summary タグはそのまま通す
    const trimmed = line.trim();
    if (/^<details>$/i.test(trimmed) || /^<\/details>$/i.test(trimmed)) {
      closeListAll(); html += line + '\n'; continue;
    }
    if (/^<summary>(.*)<\/summary>$/i.test(trimmed)) {
      const inner = trimmed.match(/^<summary>(.*)<\/summary>$/i)[1];
      html += `<summary>${inlinemd(inner)}</summary>\n`; continue;
    }
    if (/^<!--\s*title\s*-->$/i.test(trimmed)) {
      closeListAll();
      pendingNoteTitle = true;
      continue;
    }

    // 空行
    if (trimmed === '') { closeListAll(); html += '<div><br></div>'; continue; }
