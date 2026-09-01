/* ==============================
   gb-compare.js: ファイル比較ビュー
   2ファイルの並列表示＋行単位の差分ハイライト
   ============================== */

const SIMPLE_DIFF_MIN_LOOKAHEAD = 2000;
const SIMPLE_DIFF_MAX_LOOKAHEAD = 20000;
const COMPARE_LARGE_FILE_SKIP_BYTES = 5 * 1024 * 1024;
const COMPARE_BINARY_PREVIEW_BYTES = 512;
const COMPARE_TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'js', 'mjs', 'cjs', 'css', 'html',
  'htm', 'xml', 'yaml', 'yml', 'log', 'py', 'ts', 'tsx', 'jsx', 'vue', 'svelte',
  'ini', 'cfg', 'conf', 'toml', 'sql', 'svg', 'ics', 'vtt', 'srt',
]);
const COMPARE_BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tif', 'tiff', 'heic',
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'mp3', 'wav', 'flac', 'ogg', 'm4a',
  'pdf', 'zip', '7z', 'rar', 'tar', 'gz', 'bz2', 'xz', 'psd', 'ai', 'clip',
  'blend', 'exe', 'dll', 'bin', 'dat',
]);

/**
 * 比較ビューを開く
 * @param {string} pathA - 左側ファイルパス
 * @param {string} pathB - 右側ファイルパス
 * @param {object} [opts] - opts.containerEl: 描画先を明示指定（省略時はメイン画面の #compare-view 単一実体）。
 *   opts.skipShowView: メイン画面のビュー切替をしない（サブパネル等、独立した描画先へ渡す場合に使う）
 */
async function openCompareView(pathA, pathB, opts) {
  const openOpts = opts || {};
  if (!openOpts.skipShowView) {
    if (typeof GBPaneBridge !== 'undefined' && GBPaneBridge.initialized && typeof navPush === 'function') {
      navPush({
        type: 'compare',
        label: '比較',
        path: `compare:${pathA}|${pathB}`,
        pathA,
        pathB,
      });
    }
    showView('compare');
  }
  const container = openOpts.containerEl || document.getElementById('compare-view');
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
  const meta = await _fetchCompareMeta(path);
  if (_shouldSkipCompareRawFetch(path, meta)) {
    return {
      mode: 'binary',
      content: await _binaryCompareSummary(path, null, '', meta),
    };
  }
  const response = await fetch(API_BASE + '/file-raw?path=' + encodeURIComponent(path));
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  const contentType = response.headers.get('content-type') || '';
  const bytes = new Uint8Array(await response.arrayBuffer());
  const decoded = _decodeCompareText(bytes, contentType, path);
  if (decoded?.text != null && _looksTextLike(decoded.text, contentType)) {
    return { mode: 'text', content: decoded.text, encoding: decoded.encoding };
  }
  return {
    mode: 'binary',
    content: await _binaryCompareSummary(path, bytes, contentType, meta),
  };
}

async function _fetchCompareMeta(path) {
  try {
    const response = await fetch(API_BASE + '/file-meta?path=' + encodeURIComponent(path));
    if (!response?.ok || typeof response.json !== 'function') return null;
    const meta = await response.json();
    const size = Number(meta?.size);
    return Number.isFinite(size) ? { ...meta, size } : meta;
  } catch (_) {
    return null;
  }
}

function _decodeUtf8(bytes) {
  return _decodeWithEncoding(bytes, 'utf-8');
}

function _decodeWithEncoding(bytes, encoding) {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch (_) {
    return null;
  }
}

function _comparePathExtension(path) {
  const name = String(path || '').split(/[\\/]/).pop() || '';
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function _contentTypeCharset(contentType) {
  const match = String(contentType || '').match(/charset\s*=\s*([^;\s]+)/i);
  return match ? match[1].replace(/^["']|["']$/g, '').toLowerCase() : '';
}

function _shouldTryLegacyTextDecode(contentType, path) {
  const type = String(contentType || '').toLowerCase();
  if (type.startsWith('text/') || /json|xml|javascript|csv|markdown|yaml/.test(type)) return true;
  return COMPARE_TEXT_EXTENSIONS.has(_comparePathExtension(path));
}

function _isLikelyTextPath(path) {
  return COMPARE_TEXT_EXTENSIONS.has(_comparePathExtension(path));
}

function _shouldSkipCompareRawFetch(path, meta) {
  const size = Number(meta?.size);
  if (!Number.isFinite(size) || size <= COMPARE_LARGE_FILE_SKIP_BYTES) return false;
  const ext = _comparePathExtension(path);
  if (COMPARE_BINARY_EXTENSIONS.has(ext)) return true;
  return !_isLikelyTextPath(path);
}

function _looksLikeUtf16(bytes, littleEndian) {
  const sample = bytes?.slice ? bytes.slice(0, Math.min(bytes.length, 512)) : [];
  if (!sample || sample.length < 4) return false;
  let zeroSlots = 0;
  let printableSlots = 0;
  const zeroOffset = littleEndian ? 1 : 0;
  const charOffset = littleEndian ? 0 : 1;
  for (let i = zeroOffset; i < sample.length; i += 2) {
    if (sample[i] === 0) zeroSlots++;
  }
  for (let i = charOffset; i < sample.length; i += 2) {
    const b = sample[i];
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126)) printableSlots++;
  }
  return zeroSlots >= Math.max(2, Math.floor(sample.length / 4)) && printableSlots >= Math.max(1, zeroSlots / 2);
}

function _decodeCompareText(bytes, contentType, path) {
  const encodings = [];
  const push = (encoding) => {
    const key = String(encoding || '').trim().toLowerCase();
    if (key && !encodings.includes(key)) encodings.push(key);
  };
  const legacyText = _shouldTryLegacyTextDecode(contentType, path);
  const charset = _contentTypeCharset(contentType);
  if (legacyText) {
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) push('utf-8');
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) push('utf-16le');
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) push('utf-16be');
  }
  push(charset);
  if (legacyText && !charset) {
    if (_looksLikeUtf16(bytes, true)) push('utf-16le');
    if (_looksLikeUtf16(bytes, false)) push('utf-16be');
  }
  push('utf-8');
  if (legacyText) {
    push('utf-16le');
    push('utf-16be');
    push('shift_jis');
  }
  for (const encoding of encodings) {
    const text = _decodeWithEncoding(bytes, encoding);
    if (text != null && _looksTextLike(text, contentType)) return { text, encoding };
  }
  return null;
}

function _looksTextLike(text, contentType) {
  const type = String(contentType || '').toLowerCase();
  if (!text) return true;
  if (text.includes('\u0000')) return false;
  const controls = text.split('').filter(ch => {
    const code = ch.charCodeAt(0);
    return code < 32 && ch !== '\n' && ch !== '\r' && ch !== '\t';
  }).length;
  if (controls / Math.max(text.length, 1) >= 0.01) return false;
  if (type.startsWith('text/') || /json|xml|javascript|csv|markdown|yaml/.test(type)) return true;
  return true;
}

async function _binaryCompareSummary(path, bytes, contentType, meta) {
  const hasBytes = bytes instanceof Uint8Array;
  const size = hasBytes ? bytes.length : Number(meta?.size || 0);
  const hash = hasBytes ? await _sha256Hex(bytes) : '';
  const preview = hasBytes ? _hexPreview(bytes, COMPARE_BINARY_PREVIEW_BYTES) : '';
  const lines = [
    '[バイナリ/非テキスト形式]',
    `Content-Type: ${contentType || '不明'}`,
    `ファイルサイズ: ${Number.isFinite(size) ? size : '不明'} bytes`,
    `SHA-256: ${hasBytes ? (hash || '計算不可') : '未計算（大きいファイルのため省略）'}`,
    '',
    '先頭バイト（最大512 bytes）:',
    hasBytes ? (preview || '(空ファイル)') : '(大きいファイルのため先頭バイト取得を省略)',
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

function _splitCompareRows(text) {
  const source = String(text ?? '');
  if (!source) return [{ text: '', ending: '' }];
  const rows = [];
  const re = /([^\r\n]*)(\r\n|\r|\n|$)/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    const line = match[1] || '';
    const ending = match[2] || '';
    if (!line && !ending && match.index === source.length) break;
    rows.push({ text: line, ending });
    if (!ending) break;
  }
  return rows.length ? rows : [{ text: '', ending: '' }];
}

function _newlineMarker(ending) {
  if (ending === '\r\n') return ' [CRLF]';
  if (ending === '\r') return ' [CR]';
  if (ending === '\n') return ' [LF]';
  return ' [EOF]';
}

function _lineEndingsDiffer(rowsA, rowsB) {
  const max = Math.max(rowsA.length, rowsB.length);
  for (let i = 0; i < max; i++) {
    if ((rowsA[i]?.ending || '') !== (rowsB[i]?.ending || '')) return true;
  }
  return false;
}

function _prepareCompareLines(textA, textB) {
  const rowsA = _splitCompareRows(textA);
  const rowsB = _splitCompareRows(textB);
  const showNewlineMarkers = _lineEndingsDiffer(rowsA, rowsB);
  const toLines = rows => rows.map(row => row.text + (showNewlineMarkers ? _newlineMarker(row.ending) : ''));
  return { linesA: toLines(rowsA), linesB: toLines(rowsB), showNewlineMarkers };
}

/**
 * 比較ビュー全体を描画
 */
function _renderCompareView(container, pathA, pathB, textA, textB, options) {
  container.innerHTML = '';

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
  const { linesA, linesB, showNewlineMarkers } = _prepareCompareLines(textA, textB);
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
  if (showNewlineMarkers) {
    const newlineMode = document.createElement('span');
    newlineMode.className = 'compare-stats';
    newlineMode.textContent = '改行コード差分を表示';
    header.appendChild(newlineMode);
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
  const syncLineHeights = () => _syncCompareLineHeights(panelA, panelB);
  syncLineHeights();
  requestAnimationFrame(syncLineHeights);
  if (container._compareResizeCleanup) container._compareResizeCleanup();
  window.addEventListener('resize', syncLineHeights);
  container._compareResizeCleanup = () => window.removeEventListener('resize', syncLineHeights);

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

function _syncCompareLineHeights(panelA, panelB) {
  const linesA = Array.from(panelA?.children || []);
  const linesB = Array.from(panelB?.children || []);
  const max = Math.min(linesA.length, linesB.length);
  for (let i = 0; i < max; i++) {
    const a = linesA[i];
    const b = linesB[i];
    if (!a || !b) continue;
    a.style.minHeight = '';
    b.style.minHeight = '';
    const h = Math.max(
      a.getBoundingClientRect?.().height || a.scrollHeight || 0,
      b.getBoundingClientRect?.().height || b.scrollHeight || 0,
    );
    if (h > 0) {
      a.style.minHeight = h + 'px';
      b.style.minHeight = h + 'px';
    }
  }
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
  const lookahead = Math.min(
    SIMPLE_DIFF_MAX_LOOKAHEAD,
    Math.max(SIMPLE_DIFF_MIN_LOOKAHEAD, Math.ceil(Math.max(linesA.length, linesB.length) * 0.05)),
  );
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

function _compareTextUnits(text) {
  return Array.from(String(text ?? ''));
}

/**
 * 変更行の中で、具体的にどの部分が変わったかをハイライト表示
 */
function _renderInlineDiff(elA, elB, textA, textB) {
  const charsA = _compareTextUnits(textA);
  const charsB = _compareTextUnits(textB);
  // 共通プレフィックス・サフィックスを検出
  let prefix = 0;
  while (prefix < charsA.length && prefix < charsB.length && charsA[prefix] === charsB[prefix]) prefix++;
  let suffixA = charsA.length, suffixB = charsB.length;
  while (suffixA > prefix && suffixB > prefix && charsA[suffixA - 1] === charsB[suffixB - 1]) { suffixA--; suffixB--; }

  const commonPre = charsA.slice(0, prefix).join('');
  const diffPartA = charsA.slice(prefix, suffixA).join('');
  const diffPartB = charsB.slice(prefix, suffixB).join('');
  const commonSuf = charsA.slice(suffixA).join('');

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
  const modalId = 'compare-file-modal-' + Date.now().toString(36);
  const hintId = modalId + '-hint';
  const body = document.createElement('div');
  body.className = 'compare-file-modal-body';

  // ファイルA
  const fieldA = document.createElement('div');
  fieldA.className = 'field';
  const inputAId = modalId + '-a';
  const labelA = document.createElement('label');
  labelA.htmlFor = inputAId;
  labelA.textContent = 'ファイルA（左側）';
  fieldA.appendChild(labelA);
  const inputA = document.createElement('input');
  inputA.id = inputAId;
  inputA.className = 'gb-input';
  inputA.type = 'text';
  inputA.dataset.gbPathInput = '1';
  inputA.value = preselectedPath || '';
  inputA.placeholder = 'パスを入力（例: プロット/第1話/候補A.md）';
  fieldA.appendChild(inputA);
  body.appendChild(fieldA);

  // ファイルB
  const fieldB = document.createElement('div');
  fieldB.className = 'field';
  const inputBId = modalId + '-b';
  const labelB = document.createElement('label');
  labelB.htmlFor = inputBId;
  labelB.textContent = 'ファイルB（右側）';
  fieldB.appendChild(labelB);
  const inputB = document.createElement('input');
  inputB.id = inputBId;
  inputB.className = 'gb-input';
  inputB.type = 'text';
  inputB.dataset.gbPathInput = '1';
  inputB.placeholder = 'パスを入力（例: プロット/第1話/候補B.md）';
  fieldB.appendChild(inputB);
  body.appendChild(fieldB);

  const hint = document.createElement('div');
  hint.id = hintId;
  hint.style.cssText = 'font-size:11px;color:var(--fg2);margin-bottom:12px;';
  hint.textContent = 'フォルダツリーのファイルメニューから「比較...」を選んでも開けます。非テキスト形式はメタデータと先頭バイトで比較します。';
  body.appendChild(hint);

  // ボタン
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'gb-btn gb-btn-sm cancel-btn';
  cancelBtn.textContent = 'キャンセル';
  const compareBtn = document.createElement('button');
  compareBtn.type = 'button';
  compareBtn.textContent = '比較';
  compareBtn.className = 'gb-btn gb-btn-sm gb-btn-primary primary ok-btn';
  let busy = false;
  const modalApi = window.GBUI.createModal({
    id: modalId,
    title: 'ファイル比較',
    body,
    footer: [cancelBtn, compareBtn],
    variant: 'standard',
    geometryKey: 'compare-file-modal',
    minWidth: '0',
    initialFocus: preselectedPath ? inputB : inputA,
    closeLabel: 'ファイル比較を閉じる',
    closeOnEsc: true,
    closeOnOverlay: true,
    resizable: true,
    onBeforeClose: () => !busy,
  });
  const { overlay, modal } = modalApi;
  overlay.classList.add('modal-overlay', 'compare-modal-overlay');
  overlay.dataset.e2eId = 'compare-file-modal-overlay';
  overlay._compareFileModalApi = modalApi;
  modal.classList.add('modal', 'compare-file-modal');
  modal.dataset.e2eId = 'compare-file-modal-dialog';
  modal.style.cssText = 'width:min(500px,calc(100vw - 24px));max-width:100%;overflow:hidden;';
  modal.setAttribute('aria-describedby', hintId);
  const setBusy = (next) => {
    busy = !!next;
    modal.setAttribute('aria-busy', busy ? 'true' : 'false');
    compareBtn.disabled = busy;
  };
  cancelBtn.addEventListener('click', () => modalApi.close('cancel'));
  compareBtn.addEventListener('click', async () => {
    if (busy) return;
    const a = inputA.value.trim();
    const b = inputB.value.trim();
    if (!a || !b) { showStatus('両方のファイルパスを入力してください', true); return; }
    setBusy(true);
    try {
      const ok = await openCompareView(a, b);
      if (ok) {
        setBusy(false);
        modalApi.close('compared');
      }
      else showStatus('比較に失敗しました。パスを確認してください', true);
    } catch (error) {
      console.error('ファイル比較に失敗しました:', error);
      showStatus('比較に失敗しました。パスを確認してください', true);
    } finally {
      if (modalApi.isOpen()) setBusy(false);
    }
  });
  modalApi.open();
}
