/* ==============================
   gb-compare.js: ファイル比較ビュー
   2ファイルの並列表示＋行単位の差分ハイライト
   ============================== */

/**
 * 比較ビューを開く
 * @param {string} pathA - 左側ファイルパス
 * @param {string} pathB - 右側ファイルパス
 */
async function openCompareView(pathA, pathB) {
  showView('compare');
  const container = document.getElementById('compare-view');
  if (!container) return false;
  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--fg2);">読み込み中...</div>';

  try {
    const [dataA, dataB] = await Promise.all([
      _fetchCompareSide(pathA),
      _fetchCompareSide(pathB),
    ]);
    _renderCompareView(container, pathA, pathB, dataA.content || '', dataB.content || '', {
      modeA: dataA.mode,
      modeB: dataB.mode,
    });
    return true;
  } catch (e) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--red,#d16969);">ファイル取得エラー</div>';
    return false;
  }
}

async function _fetchCompareSide(path) {
  const response = await fetch(API_BASE + '/file-raw?path=' + encodeURIComponent(path));
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  const contentType = response.headers.get('content-type') || '';
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = _decodeUtf8(bytes);
  if (text != null && _looksTextLike(text, contentType)) {
    return { mode: 'text', content: text };
  }
  return {
    mode: 'binary',
    content: await _binaryCompareSummary(path, bytes, contentType),
  };
}

function _decodeUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (_) {
    return null;
  }
}

function _looksTextLike(text, contentType) {
  const type = String(contentType || '').toLowerCase();
  if (type.startsWith('text/') || /json|xml|javascript|csv|markdown|yaml/.test(type)) return true;
  if (!text) return true;
  if (text.includes('\u0000')) return false;
  const controls = text.split('').filter(ch => {
    const code = ch.charCodeAt(0);
    return code < 32 && ch !== '\n' && ch !== '\r' && ch !== '\t';
  }).length;
  return controls / Math.max(text.length, 1) < 0.01;
}

async function _binaryCompareSummary(path, bytes, contentType) {
  const hash = await _sha256Hex(bytes);
  const preview = _hexPreview(bytes, 512);
  const lines = [
    '[バイナリ/非テキスト形式]',
    `ファイル: ${path}`,
    `Content-Type: ${contentType || '不明'}`,
    `サイズ: ${bytes.length} bytes`,
    `SHA-256: ${hash || '計算不可'}`,
    '',
    '先頭バイト（最大512 bytes）:',
    preview || '(空ファイル)',
  ];
  return lines.join('\n');
}

async function _sha256Hex(bytes) {
  try {
    if (!globalThis.crypto?.subtle) return '';
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (_) {
    return '';
  }
}

function _hexPreview(bytes, limit) {
  const max = Math.min(bytes.length, limit || 512);
  const rows = [];
  for (let offset = 0; offset < max; offset += 16) {
    const chunk = bytes.slice(offset, Math.min(offset + 16, max));
    const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(chunk).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
    rows.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(47, ' ')}  ${ascii}`);
  }
  if (bytes.length > max) rows.push(`... ${bytes.length - max} bytes 省略`);
  return rows.join('\n');
}

/**
 * 比較ビュー全体を描画
 */
function _renderCompareView(container, pathA, pathB, textA, textB, options) {
  container.innerHTML = '';
  const normalizedTextA = String(textA || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const normalizedTextB = String(textB || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // ヘッダー
  const header = document.createElement('div');
  header.className = 'compare-header';
  const labelA = document.createElement('span');
  labelA.className = 'compare-label';
  labelA.textContent = pathA.split('/').pop();
  labelA.title = pathA;
  const labelB = document.createElement('span');
  labelB.className = 'compare-label';
  labelB.textContent = pathB.split('/').pop();
  labelB.title = pathB;
  const stats = document.createElement('span');
  stats.className = 'compare-stats';
  header.appendChild(labelA);
  header.appendChild(stats);
  header.appendChild(labelB);
  container.appendChild(header);

  // 差分計算
  const linesA = normalizedTextA.split('\n');
  const linesB = normalizedTextB.split('\n');
  const diff = _computeDiff(linesA, linesB);

  // 統計
  let added = 0, removed = 0, changed = 0;
  diff.forEach(d => {
    if (d.type === 'add') added++;
    else if (d.type === 'remove') removed++;
    else if (d.type === 'change') changed++;
  });
  stats.textContent = '+' + added + ' -' + removed + ' ~' + changed;
  if (options?.modeA === 'binary' || options?.modeB === 'binary') {
    const mode = document.createElement('span');
    mode.className = 'compare-stats';
    mode.textContent = '非テキスト形式はメタデータと先頭バイトで比較';
    header.appendChild(mode);
  }

  // 並列パネル
  const body = document.createElement('div');
  body.className = 'compare-body';

  const panelA = document.createElement('div');
  panelA.className = 'compare-panel';
  const panelB = document.createElement('div');
  panelB.className = 'compare-panel';

  diff.forEach(d => {
    const lineA = document.createElement('div');
    const lineB = document.createElement('div');
    lineA.className = 'compare-line';
    lineB.className = 'compare-line';

    switch (d.type) {
      case 'equal':
        lineA.textContent = d.textA;
        lineB.textContent = d.textB;
        break;
      case 'change':
        lineA.className += ' compare-changed';
        lineB.className += ' compare-changed';
        _renderInlineDiff(lineA, lineB, d.textA, d.textB);
        break;
      case 'remove':
        lineA.className += ' compare-removed';
        lineA.textContent = d.textA;
        lineB.className += ' compare-empty';
        break;
      case 'add':
        lineA.className += ' compare-empty';
        lineB.className += ' compare-added';
        lineB.textContent = d.textB;
        break;
    }

    panelA.appendChild(lineA);
    panelB.appendChild(lineB);
  });

  body.appendChild(panelA);
  body.appendChild(panelB);
  container.appendChild(body);

  // 同期スクロール
  let syncing = false;
  panelA.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true;
    panelB.scrollTop = panelA.scrollTop;
    syncing = false;
  });
  panelB.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true;
    panelA.scrollTop = panelB.scrollTop;
    syncing = false;
  });
}

/* --- 差分アルゴリズム（LCS + 行マッチング） --- */

/**
 * 2つの行配列から差分を計算する
 * @returns {Array<{type: 'equal'|'change'|'add'|'remove', textA: string, textB: string}>}
 */
function _computeDiff(linesA, linesB) {
  // LCS (Longest Common Subsequence) で共通行を特定
  const n = linesA.length, m = linesB.length;

  // メモリ効率のため、短い方の行数が1000を超える場合は簡易比較にフォールバック
  if (n > 1000 || m > 1000) return _simpleDiff(linesA, linesB);

  // LCSテーブル構築
  const dp = Array(n + 1).fill(null).map(() => Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (linesA[i - 1] === linesB[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // バックトレースで差分を構築
  const result = [];
  let i = n, j = m;
  const stack = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) {
      stack.push({ type: 'equal', textA: linesA[i - 1], textB: linesB[j - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: 'add', textA: '', textB: linesB[j - 1] });
      j--;
    } else {
      stack.push({ type: 'remove', textA: linesA[i - 1], textB: '' });
      i--;
    }
  }

  // 逆順を戻す
  stack.reverse();

  return _coalesceDiffStack(stack);
}

function _coalesceDiffStack(stack) {
  const result = [];
  for (let k = 0; k < stack.length; k++) {
    if (stack[k].type !== 'remove' && stack[k].type !== 'add') {
      result.push(stack[k]);
      continue;
    }
    const removes = [];
    const adds = [];
    while (k < stack.length && (stack[k].type === 'remove' || stack[k].type === 'add')) {
      if (stack[k].type === 'remove') removes.push(stack[k]);
      else adds.push(stack[k]);
      k++;
    }
    k--;
    const paired = Math.min(removes.length, adds.length);
    for (let i = 0; i < paired; i++) {
      result.push({ type: 'change', textA: removes[i].textA, textB: adds[i].textB });
    }
    for (let i = paired; i < removes.length; i++) result.push(removes[i]);
    for (let i = paired; i < adds.length; i++) result.push(adds[i]);
  }
  return result;
}

/**
 * 簡易差分（大きいファイル用）— 近傍の同一行をアンカーにして行ずれを吸収する
 */
function _simpleDiff(linesA, linesB) {
  const result = [];
  const lookahead = 80;
  let i = 0, j = 0;
  while (i < linesA.length || j < linesB.length) {
    const a = i < linesA.length ? linesA[i] : null;
    const b = j < linesB.length ? linesB[j] : null;
    if (a !== null && b !== null && a === b) {
      result.push({ type: 'equal', textA: a, textB: b });
      i++; j++;
      continue;
    }
    if (a === null) { result.push({ type: 'add', textA: '', textB: b }); j++; continue; }
    if (b === null) { result.push({ type: 'remove', textA: a, textB: '' }); i++; continue; }

    const bAnchor = _findNextLine(linesB, a, j + 1, lookahead);
    const aAnchor = _findNextLine(linesA, b, i + 1, lookahead);
    if (bAnchor >= 0 && (aAnchor < 0 || (bAnchor - j) <= (aAnchor - i))) {
      while (j < bAnchor) { result.push({ type: 'add', textA: '', textB: linesB[j] }); j++; }
      continue;
    }
    if (aAnchor >= 0) {
      while (i < aAnchor) { result.push({ type: 'remove', textA: linesA[i], textB: '' }); i++; }
      continue;
    }
    result.push({ type: 'change', textA: a, textB: b });
    i++; j++;
  }
  return _coalesceDiffStack(result);
}

function _findNextLine(lines, value, start, limit) {
  const end = Math.min(lines.length, start + limit);
  for (let i = start; i < end; i++) {
    if (lines[i] === value) return i;
  }
  return -1;
}

/* --- インライン差分ハイライト --- */

/**
 * 変更行の中で、具体的にどの部分が変わったかをハイライト表示
 */
function _renderInlineDiff(elA, elB, textA, textB) {
  // 共通プレフィックス・サフィックスを検出
  let prefix = 0;
  while (prefix < textA.length && prefix < textB.length && textA[prefix] === textB[prefix]) prefix++;
  let suffixA = textA.length, suffixB = textB.length;
  while (suffixA > prefix && suffixB > prefix && textA[suffixA - 1] === textB[suffixB - 1]) { suffixA--; suffixB--; }

  const commonPre = textA.substring(0, prefix);
  const diffPartA = textA.substring(prefix, suffixA);
  const diffPartB = textB.substring(prefix, suffixB);
  const commonSuf = textA.substring(suffixA);

  elA.innerHTML = '';
  elB.innerHTML = '';

  if (commonPre) { elA.appendChild(document.createTextNode(commonPre)); elB.appendChild(document.createTextNode(commonPre)); }

  if (diffPartA) {
    const span = document.createElement('span');
    span.className = 'compare-diff-text';
    span.textContent = diffPartA;
    elA.appendChild(span);
  }
  if (diffPartB) {
    const span = document.createElement('span');
    span.className = 'compare-diff-text';
    span.textContent = diffPartB;
    elB.appendChild(span);
  }

  if (commonSuf) { elA.appendChild(document.createTextNode(commonSuf)); elB.appendChild(document.createTextNode(commonSuf)); }
}

/* --- 比較ファイル選択モーダル --- */

/**
 * 比較するファイルを選択するモーダルを表示
 * @param {string} [preselectedPath] - 1つ目のファイルが既に選択されている場合
 */
function showCompareModal(preselectedPath) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.cssText = 'width:500px;max-width:90vw;';

  const h3 = document.createElement('h3');
  h3.textContent = 'ファイル比較';
  h3.style.margin = '0 0 12px 0';
  modal.appendChild(h3);

  // ファイルA
  const fieldA = document.createElement('div');
  fieldA.className = 'field';
  fieldA.innerHTML = '<label>ファイルA（左側）</label>';
  const inputA = document.createElement('input');
  inputA.type = 'text';
  inputA.value = preselectedPath || '';
  inputA.placeholder = 'パスを入力（例: プロット/第1話/候補A.md）';
  fieldA.appendChild(inputA);
  modal.appendChild(fieldA);

  // ファイルB
  const fieldB = document.createElement('div');
  fieldB.className = 'field';
  fieldB.innerHTML = '<label>ファイルB（右側）</label>';
  const inputB = document.createElement('input');
  inputB.type = 'text';
  inputB.placeholder = 'パスを入力（例: プロット/第1話/候補B.md）';
  fieldB.appendChild(inputB);
  modal.appendChild(fieldB);

  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:11px;color:var(--fg2);margin-bottom:12px;';
  hint.textContent = 'フォルダツリーでファイルを右クリック→「比較...」からも開けます。非テキスト形式はメタデータと先頭バイトで比較します。';
  modal.appendChild(hint);

  // ボタン
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.addEventListener('click', () => overlay.remove());
  btnRow.appendChild(cancelBtn);
  const compareBtn = document.createElement('button');
  compareBtn.textContent = '比較';
  compareBtn.className = 'primary';
  compareBtn.addEventListener('click', async () => {
    const a = inputA.value.trim();
    const b = inputB.value.trim();
    if (!a || !b) { showStatus('両方のファイルパスを入力してください', true); return; }
    compareBtn.disabled = true;
    try {
      const ok = await openCompareView(a, b);
      if (ok) overlay.remove();
      else showStatus('比較に失敗しました。パスを確認してください', true);
    } finally {
      compareBtn.disabled = false;
    }
  });
  btnRow.appendChild(compareBtn);
  modal.appendChild(btnRow);

  overlay.appendChild(modal);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  setTimeout(() => (preselectedPath ? inputB : inputA).focus(), 50);
}
