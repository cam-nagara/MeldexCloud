
    // 見出し（アイコン記法対応: ## :iconName: テキスト）
    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      closeListAll();
      const lv = hm[1].length;
      let content = hm[2];
      content = content.replace(/^:([a-zA-Z][a-zA-Z0-9-]*):/, (match, iconName) => {
        if (typeof LUCIDE !== 'undefined' && LUCIDE[iconName] && typeof lucide === 'function') {
          return `<span class="heading-icon">${lucide(iconName, lv <= 2 ? 20 : 16)}</span> `;
        }
        return match; // 存在しないアイコン名はテキストとして保持
      });
      const titleAttrs = pendingNoteTitle ? ' class="note-title" data-note-title="1"' : '';
      html += `<h${lv}${titleAttrs}>${inlinemd(content)}</h${lv}>`;
      pendingNoteTitle = false;
      continue;
    }

    // 水平線
    if (line.match(/^(-{3,}|\*{3,}|_{3,})$/)) { closeListAll(); html += '<hr>'; continue; }

    // コールアウト: > [!iconName #color type] テキスト（後続の > 行も本文に含める）
    // 形式: > [!lightbulb #e6a700 warning] テキスト  or  > [!💡 info] テキスト（旧emoji互換）
    const calloutMatch = line.match(/^>\s*\[!([^\s\]]+)\s*(#[0-9a-fA-F]{3,8})?\s*(info|warning|danger|success)?\]\s*(.*)$/);
    if (calloutMatch) {
      closeListAll();
      const cIconRaw = calloutMatch[1], cColor = calloutMatch[2] || '', cType = calloutMatch[3] || '', cTextParts = [calloutMatch[4]];
      while (i + 1 < lines.length && lines[i + 1].startsWith('> ')) {
        i++;
        cTextParts.push(lines[i].slice(2));
      }
      const cls = cType ? ' callout-' + cType : '';
      const cBody = cTextParts.map(t => inlinemd(t)).join('<br>');
      const colorStyle = cColor ? ' style="color:' + esc(cColor) + ';"' : '';
      const cIconSpec = typeof GBIconAssets !== 'undefined' ? GBIconAssets.normalizeSpec(cIconRaw) : cIconRaw;
      const cIconHtml = typeof GBIconAssets !== 'undefined' ? GBIconAssets.render(cIconSpec, 20) : (typeof lucide === 'function' ? lucide(cIconRaw, 20) : esc(cIconRaw));
      const iconHtml = `<span class="callout-icon" data-icon="${esc(cIconSpec)}"${cColor ? ' data-color="' + esc(cColor) + '"' : ''}${colorStyle}>${cIconHtml}</span>`;
      html += `<div class="callout-block${cls}" contenteditable="false">${iconHtml}<div class="callout-body" contenteditable="true">${cBody}</div></div>`;
      continue;
    }
    // 引用（複数行をまとめて1つの<blockquote>に + 出典行検出）
    if (line.startsWith('> ')) {
      closeListAll();
      const quoteLines = [line.slice(2)];
      while (i + 1 < lines.length && lines[i + 1].startsWith('> ')) {
        i++;
        quoteLines.push(lines[i].slice(2));
      }
      const lastLine = quoteLines[quoteLines.length - 1];
      const citeMatch = lastLine.match(/^—\s+(.+)$/);
      if (citeMatch) {
        const bodyLines = quoteLines.slice(0, -1);
        const citeContent = inlinemd(citeMatch[1]);
        html += `<blockquote><div class="quote-body">${bodyLines.map(l => inlinemd(l)).join('<br>')}</div><cite class="quote-cite">${citeContent}</cite></blockquote>`;
      } else {
        html += `<blockquote>${quoteLines.map(l => inlinemd(l)).join('<br>')}</blockquote>`;
      }
      continue;
    }

    // リスト（箇条書き）
    const ulm = line.match(/^(\s*)[*\-+]\s+(.*)$/);
    if (ulm) {
      const indent = ulm[1].length;
      adjustListDepth(indent, 'ul');
      html += `<li>${inlinemd(ulm[2])}</li>`;
      continue;
    }
    // リスト（番号付き）
    const olm = line.match(/^(\s*)\d+\.\s+(.*)$/);
    if (olm) {
      const indent = olm[1].length;
      adjustListDepth(indent, 'ol');
      html += `<li>${inlinemd(olm[2])}</li>`;
      continue;
    }

    closeListAll();
    // 通常段落
    html += `<div>${inlinemd(line)}</div>`;
  }

  closeListAll();
  if (inCodeBlock) html += '</code></pre>';
  if (inTable) html += '</table>';
  // センチネルを隠し span に復元
  html = html.replace(/\x02NLID:([A-Za-z0-9_-]+)\x02/g, '<span class="_nl-id" data-line-id="$1" contenteditable="false" style="display:none;"></span>');
  // 注釈用 line-id span を、その直後のブロック先頭に移送する（<span._nl-id> を内包する空 <div> を潰す）
  try {
    const _tmp = document.createElement('div');
    _tmp.innerHTML = html;
    const _holders = [..._tmp.children].filter(el =>
      el.tagName === 'DIV' && el.children.length === 1 && el.firstElementChild?.classList?.contains('_nl-id') && el.textContent.trim() === ''
    );
    _holders.forEach(holder => {
      const span = holder.firstElementChild;
      const next = holder.nextElementSibling;
      if (next) {
        next.insertBefore(span, next.firstChild);
        holder.remove();
      }
    });
    html = _tmp.innerHTML;
  } catch (_) {}
  return html;
}

// MD から <!--nl:ID--> を抽出して Set で返す。
function _extractNoteLineIds(md) {
  const ids = new Set();
  if (!md) return ids;
  const re = /<!--nl:([A-Za-z0-9_-]+)-->/g;
  let m;
  while ((m = re.exec(md)) !== null) ids.add(m[1]);
  return ids;
}

// 保存前後の MD を比較し、削除された line-id の注釈を孤児化する。
async function _orphanRemovedNoteLines(prevMd, currMd, filePath) {
  try {
    const prevIds = _extractNoteLineIds(prevMd);
    const currIds = _extractNoteLineIds(currMd);
    const removed = [...prevIds].filter(id => !currIds.has(id));
    if (removed.length > 0) {
      await Promise.all(removed.map(id =>
        apiPost('/annotations/orphan-by-target', {
          target_kind: 'note_line',
          target_file: filePath,
          item_id: id,
          cascade_container: true,
        }).catch(() => {})
      ));
    }
    // Audit-P1 H-1: 保存完了後にコメントバッジキャッシュを無効化し、
    // 現在開いているノートのバッジを再描画する。自動保存の 2 秒タイマー後に
    // 3 秒 TTL キャッシュが効いて古いバッジが残ることを防ぐ。
    if (typeof CommentBadges !== 'undefined' && filePath) {
      try {
        CommentBadges.invalidate(filePath);
        const pc = document.getElementById('page-content');
        if (pc && pc.dataset.path === filePath) {
          CommentBadges.refreshNote(filePath, pc);
        }
      } catch (_) {}
    }
  } catch (_) {}
}

// ブロック要素から line-id を取得。未設定なら新規採番して挿入する（Y案: 遅延付与）。
function getOrAssignNoteLineId(blockEl) {
  if (!blockEl) return '';
  let span = [...blockEl.children].find(c => c.classList?.contains('_nl-id'));
  if (span && blockEl.firstElementChild === span) return span.dataset.lineId || '';
  const id = 'nl-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  if (!span) {
    span = document.createElement('span');
    span.className = '_nl-id';
    span.setAttribute('contenteditable', 'false');
    span.style.display = 'none';
    span.dataset.lineId = id;
  } else {
    span.remove();
  }
  blockEl.insertBefore(span, blockEl.firstChild);
  return span.dataset.lineId;
}

// パスからファイルタイプアイコンを推定して返す
function _linkIcon(path) {
  const fname = path.split(/[/\\]/).pop();
  const ext = fname.includes('.') ? fname.split('.').pop().toLowerCase() : '';
  const IMG = ['png','jpg','jpeg','gif','webp','svg','bmp','avif','ico'];
  const VID = ['mp4','webm','mov','avi','mkv'];
  const AUD = ['mp3','wav','ogg','flac','m4a','aac'];
  if (!ext) return lucide('db', 12);
  if (ext === 'md') return lucide('file', 12);
  if (ext === 'json') return lucide('fileText', 12);
  if (IMG.includes(ext)) return lucide('image', 12);
  if (VID.includes(ext)) return lucide('video', 12);
  if (AUD.includes(ext)) return lucide('audio', 12);
  if (ext === 'pdf') return lucide('fileText', 12);
  return lucide('file', 12);
}

// インラインMarkdown変換
function inlinemd(text) {
  let s = esc(text);
  // キーキャップ記法: [[Ctrl]] → <kbd>Ctrl</kbd>（インラインコードの前に処理）
  s = s.replace(/\[\[([^\]]+?)\]\]/g, '<kbd>$1</kbd>');
  // インラインコード
  s = s.replace(/`([^`]+)`/g, '<code style="background:var(--bg3);padding:1px 4px;border-radius:2px;font-size:0.9em;">$1</code>');
  // 太字+斜体
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>');
  // 太字
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  // 斜体
  s = s.replace(/\*(.+?)\*/g, '<i>$1</i>');
  // 取り消し線
  s = s.replace(/~~(.+?)~~/g, '<s>$1</s>');
  // 画像（リンクより先に処理。!が先にリンクとしてマッチするのを防止）
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, altFull, src) => {
    // 拡張alt解析: ![alt|w=300|path=...](src)
    const parts = altFull.split('|');
    const alt = parts[0];
    let w = 0, dataPath = '';
    for (let i = 1; i < parts.length; i++) {
      if (parts[i].startsWith('w=')) w = parseInt(parts[i].slice(2));
      if (parts[i].startsWith('path=')) dataPath = parts[i].slice(5);
    }
    const wStyle = w ? `width:${w}px;` : 'max-width:100%;';
    if (dataPath || src.includes('/file-raw?')) {
      // embed-media構造を復元（リサイズハンドル対応）— altFull/srcは既にesc済み
      return `<div class="embed-media" contenteditable="false" data-path="${dataPath}" data-name="${alt}"><img src="${src}" alt="${alt}" style="${wStyle}"></div>`;
    }
    return `<img src="${src}" alt="${alt}" style="${wStyle}">`;
  });
  // リンク: 外部URLはaタグ、内部パスはauto-linkスパン（エスケープ済み\]と\)に対応）
  s = s.replace(/\[((?:[^\]\\]|\\.)+)\]\(((?:&lt;.*?&gt;|<.*?>|(?:[^)\\]|\\.)+))\)/g, (m, text, href) => {
    // htmlToMdがエスケープした\]と\)を復元
    const cleanText = text.replace(/\\([\])])/g, '$1');
    let cleanHref = href.replace(/\\([\])])/g, '$1');
    if (cleanHref.startsWith('&lt;') && cleanHref.endsWith('&gt;')) cleanHref = cleanHref.slice(4, -4);
    else if (cleanHref.startsWith('<') && cleanHref.endsWith('>')) cleanHref = cleanHref.slice(1, -1);
    if (cleanHref.startsWith('http://') || cleanHref.startsWith('https://') || cleanHref.startsWith('mailto:')) {
      return `<a href="${cleanHref}" style="color:var(--accent2);">${cleanText}</a>`;
    }
    // ファイルタイプアイコン: テキストがファイル名風またはパスが拡張子なし（DBフォルダ）の場合に付与
    // エンティティ自動リンク（テキスト=エンティティ名、パス=.mdファイル）にはアイコンを付けない
    const _pf = cleanHref.split(/[/\\]/).pop();
    const _pe = _pf.includes('.') ? _pf.split('.').pop().toLowerCase() : '';
    const _knownExt = ['md','json','txt','csv','html','pdf','png','jpg','jpeg','gif','webp','svg','bmp','avif','ico','mp4','webm','mov','avi','mkv','mp3','wav','ogg','flac','m4a','aac','clip','psd','zip'];
    const _textExt = cleanText.trim().includes('.') ? cleanText.trim().split('.').pop().toLowerCase() : '';
    const _showIco = !_pe || _knownExt.includes(_textExt);
    const ico = _showIco ? _linkIcon(cleanHref) + ' ' : '';
    return `<span class="auto-link" data-path="${cleanHref}" style="color:var(--accent);text-decoration:underline;cursor:pointer;">${ico}${cleanText}</span>`;
  });
  // ルビ記法: {漢字|ルビ} → data-ruby属性のspanで表示
  // ルビ部分はひらがな・カタカナ・漢字・英数字のみ（プログラムの{x|y}との誤判定を防止）
  s = s.replace(/\{([^|{}]+)\|([\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBFa-zA-Z0-9\u30FC\u3005\u3006\u3007ー\s]+)\}/g, '<span data-ruby="$2" style="position:relative;">$1</span>');
  return s;
}

// HTML→Markdown変換
// 空行は \x00BLANK\x00 マーカーで管理し、最終段階でブロック境界\nと結合して\n\nを生成する。
// これにより、ブロック要素の末尾\n + 空行\n\n = \n\n\n → 圧縮で消失、という問題を回避する。
function htmlToMd(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  const BLANK = '\x00BLANK\x00';

  function tablePixelStyle(value) {
    const n = parseFloat(String(value || '').replace('px', ''));
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  }

  function tableLayoutForMarkdown(table) {
    const cols = [...table.querySelectorAll(':scope > colgroup > col')];
    const firstRow = table.rows?.[0];
    const colWidths = firstRow ? [...firstRow.cells].map((cell, index) => {
      return tablePixelStyle(cols[index]?.style?.width) || tablePixelStyle(cell.style.width);
    }) : [];
    const rowHeights = [...(table.rows || [])].map(row => {
      const firstCell = row.cells?.[0];
      return tablePixelStyle(row.style.height) || tablePixelStyle(firstCell?.style?.height);
    });
    const hasLayout = colWidths.some(Boolean) || rowHeights.some(Boolean);
    if (!hasLayout) return '';
    const payload = {
      colWidths: colWidths.map(width => width || null),
      rowHeights: rowHeights.map(height => height || null),
    };
    return '<!--table-layout:' + JSON.stringify(payload) + '-->\n';
  }

  function tableCellMarkdown(text) {
    return String(text || '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
  }

  // ブロック要素の先頭が _nl-id span であれば <!--nl:ID--> を返す。テキストが先にある場合は無効扱い（Q3: 結合時の後段ID喪失）。
  function _nlIdMarker(node) {
    const first = node.firstChild;
    if (first && first.nodeType === 1 && first.classList?.contains('_nl-id')) {
      const id = first.dataset?.lineId;
      if (id) return '<!--nl:' + id + '-->\n';
    }
    return '';
  }

  function walk(node) {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return '';

    const tag = node.tagName;
    // コピーボタン・テーブル操作ボタン・セル編集inputはスキップ
    if (node.classList?.contains('copy-btn') || node.classList?.contains('table-add-row') || node.classList?.contains('table-add-col')) return '';
    if (node.classList?.contains('cell-edit')) return node.value || '';
    // DETAILS/SUMMARY/H1-H6は子ノードを個別に走査するため、childrenの事前計算をスキップ
    const _needsChildren = !['DETAILS','SUMMARY','H1','H2','H3','H4','H5','H6','KBD','BLOCKQUOTE','LI'].includes(tag);
    const children = _needsChildren ? [...node.childNodes].map(walk).join('') : '';

    switch (tag) {
      case 'KBD': return '[[' + node.textContent + ']]';
      case 'DETAILS': {
        let md = '<details>\n';
        for (const child of node.childNodes) md += walk(child);
        md += '</details>\n\n';
        return md;
      }
      case 'SUMMARY': {
        let text = '';
        for (const child of node.childNodes) text += walk(child);
        return '<summary>' + text.trim() + '</summary>\n';
      }
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
        const level = parseInt(tag[1]);
        let text = '';
        for (const child of node.childNodes) {
          if (child.classList?.contains('heading-icon')) {
            const svg = child.querySelector('svg');
            const iconName = svg?.dataset?.icon || '';
            if (iconName) text += ':' + iconName + ': ';
            continue;
          }
          text += walk(child);
        }
        const titleMarker = (node.classList?.contains('note-title') || node.dataset?.noteTitle === '1') ? '<!--title-->\n' : '';
        return titleMarker + _nlIdMarker(node) + '#'.repeat(level) + ' ' + text.trim() + '\n';
      }
      case 'B': case 'STRONG': return '**' + children + '**';
      case 'I': case 'EM': return '*' + children + '*';
      case 'S': case 'DEL': return '~~' + children + '~~';
      case 'U': return children; // Markdownに下線はない
      case 'CODE':
        if (node.parentElement?.tagName === 'PRE') return children;
        return '`' + children + '`';
      case 'PRE': {
        const lang = node.dataset?.lang || '';
        const codeText = children.endsWith('\n') ? children.slice(0, -1) : children;
        return _nlIdMarker(node) + '```' + lang + '\n' + codeText + '\n```\n';
      }
      case 'BLOCKQUOTE': {
        const _nlMk = _nlIdMarker(node);
        // quote-body/quote-cite構造がある場合（出典付き引用）
        const qBody = node.querySelector('.quote-body');
        const qCite = node.querySelector('.quote-cite');
        if (qBody || qCite) {
          let quoteText = '';
          if (qBody) {
            const bodyMd = [...qBody.childNodes].map(n => {
              if (n.tagName === 'BR') return '\n';
              return walk(n);
            }).join('');
            quoteText += bodyMd.split('\n').map(l => '> ' + l.trim()).join('\n') + '\n';
          }
          if (qCite) {
            quoteText += '> — ' + [...qCite.childNodes].map(walk).join('').trim() + '\n';
          }
          return _nlMk + quoteText;
        }
        // 出典なし引用（テキスト + <br> 混在）
        const rawMd = [...node.childNodes].map(n => {
          if (n.tagName === 'BR') return '\n';
          return walk(n);
        }).join('');
        return _nlMk + rawMd.split('\n').map(l => '> ' + l.trim()).join('\n') + '\n';
      }
      case 'HR': return '---\n';
      case 'BR': return '\n';
      case 'UL': return children;
      case 'OL': return children;
      case 'LI': {
        const parent = node.parentElement;
        // ネスト深度を計算（親のUL/OLを辿る）
        let depth = 0;
        let p = parent;
        while (p) {
          if (p.tagName === 'UL' || p.tagName === 'OL') depth++;
          p = p.parentElement;
        }
        const indent = '  '.repeat(Math.max(0, depth - 1));
        // LI内のテキスト部分とネストされたリスト部分を分離
        let textParts = [];
        let nestedList = '';
        for (const child of node.childNodes) {
          if (child.nodeType === 1 && (child.tagName === 'UL' || child.tagName === 'OL')) {
            nestedList += walk(child);
          } else if (child.nodeType === 1 && child.tagName === 'BR') {
            textParts.push('\n');
          } else {
            const c = walk(child);
            if (c.trim()) textParts.push(c.trim());
          }
        }
        // BR由来の改行を空白区切りに変換（Markdown LI内では改行=行分離になるため）
        const text = textParts.join(' ').replace(/ ?\n ?/g, ' ');
        const _liMk = _nlIdMarker(node);
        if (parent?.tagName === 'OL') {
          const idx = [...parent.children].indexOf(node) + 1;
          return _liMk + indent + idx + '. ' + text + '\n' + nestedList;
        }
        return _liMk + indent + '- ' + text + '\n' + nestedList;
      }
      case 'A': {
        const href = node.getAttribute('href');
        return href ? '[' + children.replace(/\]/g, '\\]') + '](' + href.replace(/\)/g, '\\)') + ')' : children;
      }
      case 'TABLE': {
        const rows = node.querySelectorAll('tr');
        if (rows.length === 0) return children;
        let md = tableLayoutForMarkdown(node);
        rows.forEach((tr, ri) => {
          const cells = [...tr.querySelectorAll('th, td')].map(c => tableCellMarkdown(walk(c).trim()));
          md += '| ' + cells.join(' | ') + ' |\n';
          if (ri === 0) md += '| ' + cells.map(() => '---').join(' | ') + ' |\n';
        });
        return md;  // 最終行の\nで終わるため追加不要
      }
      case 'TR': case 'TH': case 'TD': return children;
      case 'DIV': case 'P': {
        // コールアウトブロック → Markdown変換
        if (node.classList.contains('callout-block')) {
          const iconEl = node.querySelector('.callout-icon');
          // data-icon属性があればLucide名、なければtextContent（旧emoji互換）
          const icon = iconEl?.dataset?.icon || iconEl?.textContent || 'lightbulb';
          const color = iconEl?.dataset?.color || '';
          const bodyNode = node.querySelector('.callout-body');
          const body = bodyNode ? [...bodyNode.childNodes].map(walk).join('').trim() : '';
          const typeMatch = [...node.classList].find(c => c.startsWith('callout-') && c !== 'callout-block');
          const type = typeMatch ? typeMatch.replace('callout-', '') : '';
          const bodyLines = body.split('\n');
          const firstLine = `> [!${icon}${color ? ' ' + color : ''}${type ? ' ' + type : ''}] ${bodyLines[0]}`;
          const restLines = bodyLines.slice(1).map(l => '> ' + l).join('\n');
          return firstLine + (restLines ? '\n' + restLines : '') + '\n';
        }
        const trimmed = children.trim();
        // 空のdiv/p（<div><br></div>等）→ 空行マーカー
        if (!trimmed || trimmed === '\n') return BLANK;
        return _nlIdMarker(node) + trimmed + '\n';
      }
      case 'SPAN':
        // 注釈用 line-id span は MD に直接出力しない（ブロック先頭なら _nlIdMarker 経由で親側から emit される）
        if (node.classList?.contains('_nl-id')) return '';
        // コメントバッジ（Phase 2e-ii）は UI 装飾なので保存しない
        if (node.classList?.contains('cmt-badge')) return '';
        // auto-linkスパン: data-pathがあればMarkdownリンクとして保存
        if (node.classList?.contains('auto-link')) {
          const linkPath = node.dataset?.path;
          if (linkPath) {
            // SVGアイコンのtextContentが混入しないようclone後に除去
            const _cl = node.cloneNode(true);
            _cl.querySelectorAll('svg').forEach(s => s.remove());
            const linkText = _cl.textContent.trim().replace(/\]/g, '\\]');
            const safePath = linkPath.replace(/\)/g, '\\)');
            return `[${linkText}](${safePath})`;
          }
          return children;
        }
        // data-ruby属性付きspan → ルビ記法に変換
        if (node.dataset && node.dataset.ruby) {
          return `{${children}|${node.dataset.ruby}}`;
        }
        return children;
      case 'MARK':
        if (node.classList?.contains('cmt-highlight')) return children;
        return children;
      case 'IMG': {
        const src = node.getAttribute('src') || '';
        const alt = node.getAttribute('alt') || '';
        const w = node.style.width ? parseInt(node.style.width) : (node.getAttribute('width') ? parseInt(node.getAttribute('width')) : 0);
        const embedDiv = node.closest('.embed-media');
        const dataPath = embedDiv?.dataset?.path || '';
        // 幅・パス情報を保存: ![alt|w=300|path=...](src)
        let extra = '';
        if (w) extra += '|w=' + w;
        if (dataPath) extra += '|path=' + dataPath;
        return `![${alt}${extra}](${src})`;
      }
      case 'RUBY': {
        const base = [...node.childNodes].filter(n => n.nodeName !== 'RT' && n.nodeName !== 'RP').map(walk).join('');
        const rt = node.querySelector('rt');
        const ruby = rt ? rt.textContent : '';
        return ruby ? `{${base}|${ruby}}` : base;
      }
      case 'RT': return '';
      case 'SECTION': return children; // heading-sectionは中身だけ出力
      default:
        // data-ruby属性付きspan → ルビ記法に変換
        if (node.dataset && node.dataset.ruby) {
          return `{${children}|${node.dataset.ruby}}`;
        }
        return children;
    }
  }

  let md = walk(div);

  // 空行マーカーを改行に変換
  // \nBLANK → \n\n（ブロック末尾\n + 空行 = Markdown空行1つ）
  md = md.split('\n' + BLANK).join('\n\n');
  // 残余マーカー（連続空行の2つ目以降）→ 改行に変換
  md = md.split(BLANK).join('\n');

  // ゼロ幅スペース除去（ルビ境界）
  md = md.replace(/\u200B/g, '');
  // 注: \n{3,}圧縮は行わない（ユーザーが意図的に追加した複数空行を保持するため）
  return md.trim() + '\n';
}

// パスを解決（絶対パスはそのまま、相対パスはvaultまたは現在のファイル基準で解決）
function _resolveAutoLinkPath(filePath) {
  if (!filePath) return filePath;
  if (/^(https?:|mailto:)/i.test(filePath)) return filePath;
  // Windowsの絶対パス（D:/ 等）またはUnix絶対パス（/で始まる）
  if (/^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('/')) return filePath;
  // vaultパスがあればvault基準で解決
  if (state.vaultPath && !filePath.startsWith('./') && !filePath.startsWith('../')) {
    return state.vaultPath.replace(/\\/g, '/') + '/' + filePath;
  }
  // 相対パス: 現在のファイルのディレクトリを先頭に付加
  const pc = document.getElementById('page-content');
  const currentPath = (pc && pc.dataset.path)
    || state.currentPagePath
    || state.currentBoardPath
    || window._embeddedFilePath
    || '';
  const dir = currentPath.replace(/[/\\][^/\\]*$/, '');
  if (!dir) return filePath;
  const rel = filePath.startsWith('./') ? filePath.slice(2) : filePath;
  return dir + '/' + rel;
}

/**
 * 統一リンクオープン関数 — 全リンク種別（自動リンク、手動リンク、ボードリンクカード等）で使用
 * @param {string} filePath - リンク先パス（絶対 or 相対）
 * @param {string} [name] - 表示ラベル（省略時はファイル名）
 * @param {object} [options] - { ctrlKey: boolean }
 */
async function openLink(filePath, name, options) {
  if (!filePath) return;
  if (/^(https?:|mailto:)/i.test(filePath)) {
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(filePath, '_blank', 'noopener');
    } else if (typeof location !== 'undefined') {
      location.href = filePath;
    }
    return;
  }
  const label = name || filePath.split(/[/\\]/).pop();
  if (typeof flushPendingEditorAutosave === 'function') await flushPendingEditorAutosave();
  await _openLinkInCurrentTab(filePath, label);
}

async function openLinkInSubPanel(filePath, name, options) {
  if (!filePath) return;
  const label = name || filePath.split(/[/\\]/).pop();
  if (typeof flushPendingEditorAutosave === 'function') await flushPendingEditorAutosave();
  if (typeof openLinkedPathInSubPanel === 'function') {
    return openLinkedPathInSubPanel(filePath, label, options || {});
  }
  return _openLinkInCurrentTab(filePath, label);
}

function openLinkInRightPane(filePath, name, options) {
  return openLinkInSubPanel(filePath, name, options);
}

async function _openLinkInCurrentTab(filePath, name) {
  const ext = filePath.includes('.') ? filePath.split('.').pop().toLowerCase() : '';
  const imgExts = ['jpg','jpeg','png','gif','webp','svg','bmp','ico','avif'];
  const mediaExts = ['mp4','webm','mov','avi','mp3','wav','ogg','flac','aac'];
  if (ext === 'md') {
    // DB内エントリかどうか判定
    const parent = filePath.replace(/[/\\][^/\\]+$/, '');
    let isDbEntry = false;
    try {
      const meta = await apiFetch('/db-metadata?path=' + encodeURIComponent(parent));
      if (meta && meta.property_types && Object.keys(meta.property_types).length > 0) isDbEntry = true;
    } catch {}
    if (isDbEntry && typeof selectDatabase === 'function' && typeof selectEntity === 'function') {
      await selectDatabase(parent);
      await selectEntity(filePath);
    } else {
      await openPage(name, filePath);
    }
  } else if (ext === 'board') {
    if (typeof openBoard === 'function') await openBoard(name, filePath);
  } else if (ext === 'csv') {
    if (typeof openCsvFile === 'function') openCsvFile(name, filePath);
  } else if (ext === 'html' || ext === 'htm') {
    if (typeof openHtmlFile === 'function') openHtmlFile(name, filePath);
  } else if (ext === 'pdf') {
    if (typeof openViewer === 'function') openViewer('/viewer?pdf=' + encodeURIComponent(filePath));
  } else if (imgExts.includes(ext)) {
    if (typeof openMedia === 'function') openMedia(name, filePath, 'image');
  } else if (mediaExts.includes(ext)) {
    const mtype = ['mp3','wav','ogg','flac','aac'].includes(ext) ? 'audio' : 'video';
    if (typeof openMedia === 'function') openMedia(name, filePath, mtype);
  } else if (ext === 'scriptnote.json' || filePath.endsWith('.scriptnote.json')) {
    if (typeof openScenarioInScriptNote === 'function') openScenarioInScriptNote(filePath, name);
  } else if (!ext || ext === 'json') {
    // フォルダ or DB
    if (typeof selectEntity === 'function') await selectEntity(filePath);
    else await openPage(name, filePath);
  } else {
    await openPage(name, filePath);
  }
  // ビューワーにもプレビュー表示
  _updateLinkedPreview(filePath);
  _showFileInfoInDetailPanel(filePath);
}

// 旧API互換: onAutoLinkClick → サブパネルオープンに委譲
function onAutoLinkClick(el, e) {
  const filePath = _resolveAutoLinkPath(el.dataset.path);
  if (!filePath) return;
  if (filePath.replace(/\\/g, '/').includes('_chat/llm/') && filePath.includes('#')) {
    const hashIndex = filePath.indexOf('#');
    if (typeof openSavedChat === 'function') {
      openSavedChat(filePath.slice(0, hashIndex), filePath.slice(hashIndex + 1));
      return;
    }
  }
  const name = el.textContent.replace(/^[\s]*/, '').trim() || filePath.split(/[/\\]/).pop();
  openLinkInSubPanel(filePath, name, {
    linkType: el.dataset.linkType || el.dataset.type || '',
    sourcePaneId: el.closest('.gb-pane')?.dataset?.paneId || '',
  });
}

// ダブルクリックは現在のパネルでリンク先を開く
function onAutoLinkDblClick(el) {
  const filePath = _resolveAutoLinkPath(el.dataset.path);
  if (!filePath) return;
  const name = el.textContent.replace(/^[\s]*/, '').trim() || filePath.split(/[/\\]/).pop();
  openLink(filePath, name);
}

function _contextLinkLabel(el, fallbackPath) {
  const text = (el?.textContent || '').replace(/^[\s]*/, '').trim();
  return text || String(fallbackPath || '').split(/[/\\]/).pop() || String(fallbackPath || '');
}

function _relationLinkEntityName(el) {
  const explicit = String(el?.dataset?.entityName || '').trim();
  if (explicit) return explicit;
  return String(el?.textContent || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function _resolveContextLinkTarget(rawTarget) {
  const target = rawTarget?.closest ? rawTarget : rawTarget?.parentElement;
  if (!target) return null;
  const sourcePaneId = target.closest('.gb-pane')?.dataset?.paneId || '';

  const autoLink = target.closest('.auto-link[data-path]');
  if (autoLink) {
    const path = _resolveAutoLinkPath(autoLink.dataset.path || '');
    if (!path) return null;
    return { path, label: _contextLinkLabel(autoLink, path), linkType: autoLink.dataset.linkType || autoLink.dataset.type || '', sourcePaneId, element: autoLink };
  }

  const chatLink = target.closest('.chat-md-link[data-chat-link-target]');
  if (chatLink) {
    const path = String(chatLink.dataset.chatLinkTarget || '').trim();
    if (!path) return null;
    return {
      path,
      label: _contextLinkLabel(chatLink, path),
      linkType: chatLink.dataset.linkType || '',
      sourcePaneId,
      element: chatLink,
      openAction: () => {
        if (typeof openChatMarkdownTarget === 'function') openChatMarkdownTarget(path);
        else openLink(path, _contextLinkLabel(chatLink, path));
      },
    };
  }

  const chatPropLink = target.closest('.chat-prop-link');
  if (chatPropLink) {
    const path = String(chatPropLink.dataset.chatPropPath || chatPropLink.getAttribute('title') || '').trim();
    if (!path) return null;
    return {
      path,
      label: _contextLinkLabel(chatPropLink, path),
      linkType: 'chat',
      sourcePaneId,
      element: chatPropLink,
      openAction: () => {
        if (typeof _openEntityChat === 'function') _openEntityChat(path);
        else openLink(path, _contextLinkLabel(chatPropLink, path));
      },
    };
  }

  const backlink = target.closest('.bl-link[data-path]');
  if (backlink) {
    const path = String(backlink.dataset.path || '').trim();
    if (!path) return null;
    return {
      path,
      label: _contextLinkLabel(backlink, path),
      linkType: backlink.dataset.linkType || '',
      sourcePaneId,
      element: backlink,
    };
  }

  const relationLink = target.closest('.relation-link');
  if (relationLink) {
    const dbPath = relationLink.dataset.dbPath || (typeof state !== 'undefined' ? state.currentDbPath : '') || '';
    const entityName = _relationLinkEntityName(relationLink);
    if (!dbPath || !entityName || typeof _entityPath !== 'function') return null;
    return { path: _entityPath(dbPath, entityName), label: entityName, linkType: 'entity', sourcePaneId, element: relationLink };
  }

  const anchor = target.closest('a[href]');
  if (anchor && !anchor.closest('.gb-context-menu')) {
    const path = anchor.getAttribute('href') || '';
    if (!path || path === '#' || /^javascript:/i.test(path)) return null;
    const editableHost = anchor.closest('[contenteditable="true"]');
    return { path, label: _contextLinkLabel(anchor, path), linkType: anchor.dataset.linkType || '', sourcePaneId, anchorEl: anchor, editableHost, element: anchor };
  }
  return null;
}

function _unlinkContextAnchor(linkTarget) {
  const anchor = linkTarget?.anchorEl;
  const editable = linkTarget?.editableHost;
  if (!anchor || !editable || !anchor.isConnected) return;
  if (typeof _pushCustomUndo === 'function') _pushCustomUndo(editable);
  const textNode = document.createTextNode(anchor.textContent || '');
  anchor.replaceWith(textNode);
  const range = document.createRange();
  range.setStartAfter(textNode);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  editable.dispatchEvent(new Event('input', { bubbles: true }));
  editable.focus();
}

function _showLinkContextMenu(e, linkTarget) {
  if (!linkTarget?.path) return;
  removeTooltip();
  if (typeof closeColHeaderMenu === 'function') closeColHeaderMenu();
  document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  const addItem = (icon, label, action) => {
    const item = document.createElement('div');
    item.className = 'gb-context-menu-item';
    item.innerHTML = (typeof lucide === 'function' ? lucide(icon, 14) : '') + ' ' + label;
    item.addEventListener('click', () => {
      menu.remove();
      action();
    });
    menu.appendChild(item);
  };
  addItem('externalLink', 'リンク先を開く', () => {
    if (typeof linkTarget.openAction === 'function') linkTarget.openAction();
    else openLink(linkTarget.path, linkTarget.label);
  });
  addItem('layers-2', 'サブパネルで開く', () => openLinkInSubPanel(linkTarget.path, linkTarget.label, {
    linkType: linkTarget.linkType || '',
    sourcePaneId: linkTarget.sourcePaneId || '',
  }));
  if (linkTarget.anchorEl && linkTarget.editableHost) {
    const sep = document.createElement('div');
    sep.className = 'gb-context-menu-sep';
    menu.appendChild(sep);
    addItem('unlink', 'リンクを解除', () => _unlinkContextAnchor(linkTarget));
  }

  document.body.appendChild(menu);
  const anchorRect = { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY };
  if (typeof positionPopup === 'function') {
    positionPopup(menu, anchorRect);
  } else {
    const z = typeof _getZoom === 'function' ? _getZoom() : 1;
    menu.style.left = (e.clientX / z) + 'px';
    menu.style.top = (e.clientY / z) + 'px';
  }
  setTimeout(() => {
    const closer = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('pointerdown', closer, true);
      }
    };
    document.addEventListener('pointerdown', closer, true);
  }, 0);
}

document.addEventListener('contextmenu', (e) => {
  const linkTarget = _resolveContextLinkTarget(e.target);
  if (!linkTarget) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  e.stopPropagation();
  _showLinkContextMenu(e, linkTarget);
}, true);

let _linkActivationTimer = null;
let _linkActivationToken = 0;

function _openContextLinkCurrent(linkTarget) {
  if (!linkTarget?.path) return;
  if (typeof linkTarget.openAction === 'function') {
    linkTarget.openAction();
    return;
  }
  openLink(linkTarget.path, linkTarget.label);
}

function _openContextLinkSubPanel(linkTarget) {
  if (!linkTarget?.path) return;
  openLinkInSubPanel(linkTarget.path, linkTarget.label, {
    linkType: linkTarget.linkType || '',
    sourcePaneId: linkTarget.sourcePaneId || '',
  });
}

function _consumeUnifiedLinkEvent(e, linkTarget) {
  if (!linkTarget?.path) return false;
  e.preventDefault();
  e.stopImmediatePropagation();
  e.stopPropagation();
  removeTooltip();
  return true;
}

document.addEventListener('click', (e) => {
  if (e.button !== 0) return;
  const linkTarget = _resolveContextLinkTarget(e.target);
  if (!_consumeUnifiedLinkEvent(e, linkTarget)) return;
  if (e.detail > 1) {
    ++_linkActivationToken;
    clearTimeout(_linkActivationTimer);
    _linkActivationTimer = null;
    return;
  }
  const token = ++_linkActivationToken;
  clearTimeout(_linkActivationTimer);
  _linkActivationTimer = setTimeout(() => {
    if (token !== _linkActivationToken) return;
    _openContextLinkSubPanel(linkTarget);
  }, 320);
}, true);

document.addEventListener('dblclick', (e) => {
  if (e.button !== 0) return;
  const linkTarget = _resolveContextLinkTarget(e.target);
  if (!_consumeUnifiedLinkEvent(e, linkTarget)) return;
  ++_linkActivationToken;
  clearTimeout(_linkActivationTimer);
  _linkActivationTimer = null;
  _openContextLinkCurrent(linkTarget);
}, true);

// 詳細パネルにファイルのメタ情報を表示
async function _showFileInfoInDetailPanel(filePath) {
  const fileName = filePath.split(/[/\\]/).pop();
  const ext = fileName.split('.').pop().toLowerCase();
  try {
    const meta = await fetch(API_BASE + '/file-meta?path=' + encodeURIComponent(filePath)).then(r => r.ok ? r.json() : null).catch(() => null);
    const folderPath = filePath.replace(/[/\\][^/\\]+$/, '');
    const folderName = folderPath.split(/[/\\]/).pop();
    const typeLabel = ext === 'md' ? 'ノート' : ext === 'json' ? 'シナリオ/シート' : ext === 'board' ? 'ボード' : ext;
    let html = `<div style="padding:12px;">`;
    html += `<div style="font-size:15px;font-weight:bold;margin-bottom:12px;display:flex;align-items:center;gap:6px;">${lucide(_fileIcon(ext),16)} ${esc(fileName)}</div>`;
    html += `<table style="font-size:13px;color:var(--fg2);width:100%;border-collapse:collapse;">`;
    html += `<tr><td style="padding:4px 8px 4px 0;color:var(--fg2);white-space:nowrap;">種類</td><td style="padding:4px 0;">${esc(typeLabel)}</td></tr>`;
    html += `<tr><td style="padding:4px 8px 4px 0;color:var(--fg2);white-space:nowrap;">フォルダ</td><td style="padding:4px 0;"><span class="auto-link" data-path="${esc(folderPath)}" style="color:var(--accent);cursor:pointer;">${esc(folderName)}</span></td></tr>`;
    html += `<tr><td style="padding:4px 8px 4px 0;color:var(--fg2);white-space:nowrap;">パス</td><td style="padding:4px 0;word-break:break-all;font-size:11px;">${esc(filePath)}</td></tr>`;
    if (meta) {
      if (meta.created) html += `<tr><td style="padding:4px 8px 4px 0;color:var(--fg2);white-space:nowrap;">作成日時</td><td style="padding:4px 0;">${new Date(meta.created).toLocaleString('ja-JP')}</td></tr>`;
      if (meta.modified) html += `<tr><td style="padding:4px 8px 4px 0;color:var(--fg2);white-space:nowrap;">更新日時</td><td style="padding:4px 0;">${new Date(meta.modified).toLocaleString('ja-JP')}</td></tr>`;
      if (meta.size != null) html += `<tr><td style="padding:4px 8px 4px 0;color:var(--fg2);white-space:nowrap;">サイズ</td><td style="padding:4px 0;">${_formatFileSize(meta.size)}</td></tr>`;
    }
    html += `</table></div>`;
    if (typeof showDetailPanel === 'function') showDetailPanel(html);
  } catch {
    // ファイル情報取得失敗時も基本情報を表示（entity APIフォールバックは不要）
    if (typeof showDetailPanel === 'function') {
      showDetailPanel(`<div style="padding:12px;"><div style="font-size:15px;font-weight:bold;margin-bottom:8px;">${lucide('fileText',16)} ${esc(fileName)}</div><div style="font-size:12px;color:var(--fg2);">${esc(filePath)}</div></div>`);
    }
  }
}

/* linked preview helper は gb-editor-preview.js に分離 */

// JSON ファイルの要約生成（シナリオ/キャンバス/スマートDB）
function _summarizeJson(raw) {
  try {
    const obj = JSON.parse(raw);
    // シナリオ
    if (Array.isArray(obj.rows)) {
      const chars = (obj.characters || []).map(c => c.name).join(', ');
      return `シナリオ — ${obj.rows.length}行` + (chars ? `\nキャラ: ${chars}` : '') + (obj.title ? `\nタイトル: ${obj.title}` : '');
    }
    // スマートDB
    if (obj.type === 'smart-db') {
      const filters = (obj.filters || []).length;
