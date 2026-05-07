/* ==============================
   gb-scriptnote-clipstudio.js: Clip Studio / SEP 連携

   gb-scriptnote-editor.js から WebSocket 接続とコピー送信まわりを分離。
   ============================== */

let _sn2SepWs = null;
let _sn2SepConnected = false;
let _sn2SepConnecting = false;
let _sn2SepRefCount = 0;
let _sn2SepReconnectTimer = null;
let _sn2SepToken = '';
let _sn2SepTokenPromise = null;

function _sn2SepAcquire() {
  _sn2SepRefCount++;
  if (_sn2SepRefCount === 1) _sn2SepConnect();
}

function _sn2SepRelease() {
  _sn2SepRefCount = Math.max(0, _sn2SepRefCount - 1);
  if (_sn2SepRefCount === 0) {
    if (_sn2SepReconnectTimer) { clearTimeout(_sn2SepReconnectTimer); _sn2SepReconnectTimer = null; }
    try { _sn2SepWs?.close(); } catch {}
    _sn2SepWs = null;
    _sn2SepConnected = false;
    _sn2SepConnecting = false;
  }
}

async function _sn2FetchSepToken() {
  if (_sn2SepToken) return _sn2SepToken;
  if (_sn2SepTokenPromise) return _sn2SepTokenPromise;
  _sn2SepTokenPromise = fetch((typeof API_BASE !== 'undefined' ? API_BASE : '') + '/sep-token', { cache: 'no-store' })
    .then(async res => {
      if (!res.ok) throw new Error('SEP token unavailable');
      const data = await res.json();
      const token = String(data?.token || '').trim();
      if (!token) throw new Error('SEP token missing');
      _sn2SepToken = token;
      return token;
    })
    .finally(() => { _sn2SepTokenPromise = null; });
  return _sn2SepTokenPromise;
}

function _sn2SepUrl(token) {
  const wsPort = new URLSearchParams(location.search).get('port') || location.port || '8001';
  const host = location.hostname || 'localhost';
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return protocol + '//' + host + ':' + wsPort + '/ws/sep?token=' + encodeURIComponent(token);
}

function _sn2SepConnect() {
  if (_sn2SepWs && (_sn2SepWs.readyState === WebSocket.OPEN || _sn2SepWs.readyState === WebSocket.CONNECTING)) return;
  if (_sn2SepRefCount === 0) return;
  if (_sn2SepConnecting) return;
  _sn2SepConnecting = true;
  try {
    _sn2FetchSepToken().then(token => {
      if (_sn2SepRefCount === 0) { _sn2SepConnecting = false; return; }
      _sn2SepWs = new WebSocket(_sn2SepUrl(token));
      _sn2SepWs.onopen = () => { _sn2SepConnected = true; _sn2SepConnecting = false; };
      _sn2SepWs.onclose = () => {
        _sn2SepConnected = false;
        _sn2SepConnecting = false;
        if (_sn2SepRefCount > 0) {
          if (_sn2SepReconnectTimer) clearTimeout(_sn2SepReconnectTimer);
          _sn2SepReconnectTimer = setTimeout(() => { _sn2SepReconnectTimer = null; _sn2SepConnect(); }, 3000);
        }
      };
      _sn2SepWs.onerror = () => { _sn2SepConnected = false; _sn2SepConnecting = false; };
      _sn2SepWs.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          const w = document.getElementById('sb-warn') || document.getElementById('sb-msg');
          const colorMap = { countdown: 'var(--orange)', progress: 'var(--accent2)', done: 'var(--green)', status: 'var(--fg2)', error: 'var(--red)' };
          if (w) {
            if (msg.type === 'countdown') w.textContent = `クリスタへ送信: ${msg.seconds}秒後にペースト開始...`;
            else w.textContent = msg.message || '';
            if (w.id === 'sb-warn') w.style.display = w.textContent ? '' : 'none';
            w.style.color = colorMap[msg.type] || '';
            if (msg.type === 'done') setTimeout(() => {
              w.textContent = '';
              w.style.color = '';
              if (w.id === 'sb-warn') w.style.display = 'none';
            }, 3000);
          }
          _sn2UpdateRunningDialog(msg);
        } catch {}
      };
    }).catch(() => {
      _sn2SepConnected = false;
      _sn2SepConnecting = false;
    });
  } catch { _sn2SepConnected = false; _sn2SepConnecting = false; }
}

function _sn2GetActiveEditor() {
  if (typeof GBLayout !== 'undefined' && typeof getComponentInstance === 'function') {
    const paneId = GBLayout.activePane;
    if (paneId) {
      const pane = GBLayout.findNode(GBLayout.root, paneId);
      if (pane?.node) {
        const tab = pane.node.tabs?.[pane.node.activeTabIndex];
        if (tab) {
          const comp = getComponentInstance(tab.id);
          if (comp?._editor?.doc) return comp._editor;
        }
      }
    }
  }
  return null;
}

const _sn2Editors = {};

function _sn2EditorByScope(scope) {
  if (scope) {
    if (!scope.startsWith('scriptnote:')) return _sn2GetActiveEditor();
    const key = scope.slice('scriptnote:'.length);
    if (key && _sn2Editors[key]?.doc) return _sn2Editors[key];
    if (key) {
      const byScopeId = Object.values(_sn2Editors)
        .find(editor => editor?.doc && editor._historyScopeId === key);
      if (byScopeId) return byScopeId;
    }
    return null;
  }
  return _sn2GetActiveEditor();
}

function _captureScriptnoteState(scope) {
  const editor = _sn2EditorByScope(scope);
  if (!editor?.doc) return null;
  editor._syncAllFromDom();
  return editor._takeSnapshot();
}

function _restoreScriptnoteState(snapshot, scope) {
  if (!snapshot) return;
  const editor = _sn2EditorByScope(scope);
  if (!editor?.doc) return;
  editor._applySnapshot(snapshot);
}

async function _sn2ConfirmIncludeAffix() {
  return await cfConfirm('テキストの前後設定（「」（）等）を含めますか？');
}

function _sn2RowsForClipStudio(editor) {
  const rows = Array.isArray(editor?.doc?.rows) ? editor.doc.rows : [];
  let selectedIds = null;
  if (typeof editor?._getVisibleSelectedIds === 'function') {
    selectedIds = editor._getVisibleSelectedIds();
  } else if (editor?._rowSelection instanceof Set) {
    selectedIds = editor._rowSelection;
  }
  if (selectedIds?.size) {
    const selectedRows = rows.filter(row => selectedIds.has(row.id));
    if (selectedRows.length) return selectedRows;
  }
  return rows;
}

function sn2CopyForClipStudio() {
  const editor = _sn2GetActiveEditor();
  if (!editor?.doc) {
    if (typeof showStatus === 'function') showStatus('シナリオが開かれていません', true);
    return;
  }

  _sn2SepConnect();

  if (_sn2SepConnected && _sn2SepWs && _sn2SepWs.readyState === WebSocket.OPEN) {
    _sn2ShowSepDialog(editor);
    return;
  }

  _sn2ConfirmIncludeAffix().then((includeAffixCb) => {
    const doc = editor.doc;
    const calc = editor._calcPagePanel();
    const rows = _sn2RowsForClipStudio(editor);
    let out = '';
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowIndex = doc.rows.indexOf(r);
      const nextIndex = i < rows.length - 1 ? doc.rows.indexOf(rows[i + 1]) : -1;
      const charaR = r.role ? doc.characters?.find(c => !c.isDefault && c.name === r.role) : null;
      if (charaR?.isBreak) { out += '←\r\n'; continue; }
      let plainText = _sn2StripRubyToPlain(r.text || '');
      if (includeAffixCb && plainText) {
        const affix = _sn2GetTextAffix(editor, r.role);
        plainText = (affix.before || '') + plainText + (affix.after || '');
      }
      if (plainText) out += plainText + '\r\n';
      if (nextIndex >= 0 && calc[rowIndex] && calc[nextIndex] && calc[nextIndex].page !== calc[rowIndex].page) {
        out += '\r\n';
      }
    }
    navigator.clipboard.writeText(out).then(() => {
      if (typeof showStatus === 'function') showStatus('クリスタ用テキストをコピーしました');
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = out;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      if (typeof showStatus === 'function') showStatus('クリスタ用テキストをコピーしました');
    });
  });
}

function _sn2ShowSepDialog(editor) {
  const doc = editor.doc;
  const selectedRows = _sn2RowsForClipStudio(editor);
  const hasSelection = selectedRows.length > 0 && selectedRows.length < doc.rows.length;
  const allChecked = hasSelection ? '' : ' checked';
  const selectedOption = hasSelection
    ? `<label style="cursor:pointer;font-size:13px;"><input type="radio" name="sn2-sep-range" value="selected" checked> 選択範囲（${selectedRows.length}行）</label>`
    : '';
  const o = document.createElement('div');
  o.className = 'modal-overlay';
  o.innerHTML = `<div class="modal" style="min-width:350px;"><h3>クリスタへ送信</h3>
    <div class="field"><label>送信範囲</label><div style="display:flex;gap:8px;margin:4px 0;">
      <label style="cursor:pointer;font-size:13px;"><input type="radio" name="sn2-sep-range" value="all"${allChecked}> 全行（${doc.rows.length}行）</label>${selectedOption}</div></div>
    <div class="field"><label style="cursor:pointer;font-size:13px;display:flex;align-items:center;gap:4px;"><input type="checkbox" id="sn2-sep-include-affix"> テキストの前後設定（「」（）等）を含める</label></div>
    <div class="field"><label style="cursor:pointer;font-size:13px;display:flex;align-items:center;gap:4px;"><input type="checkbox" id="sn2-sep-include-summary"> プロット行も出力する</label></div>
    <div class="field"><label style="cursor:pointer;font-size:13px;display:flex;align-items:center;gap:4px;"><input type="checkbox" id="sn2-sep-include-break-text"> 区切り行のテキストも出力する</label></div>
    <div class="field"><label style="cursor:pointer;font-size:13px;display:flex;align-items:center;gap:4px;"><input type="checkbox" id="sn2-sep-skip-blank"> 空白行を出力しない</label></div>
    <div id="sn2-sep-countdown-slot"></div>
    <div id="sn2-sep-break-wait-slot"></div>
    <p id="sn2-sep-help" style="color:var(--fg2);font-size:13px;margin:8px 0;">「送信」を押した後、カウントダウン中にクリスタのストーリーエディタをクリックしてください。</p>
    <div id="sn2-sep-status" style="display:none;margin:8px 0;padding:8px;background:var(--bg2,rgba(0,0,0,0.05));border-radius:4px;font-size:13px;color:var(--fg1);min-height:1.4em;"></div>
    <div class="btn-row"><button data-sn2-role="cancel" data-action="this.closest('.modal-overlay').remove()">キャンセル</button>
    <button data-sn2-role="stop" data-action="_sn2StopSep()" style="background:var(--red);color:var(--ui-fg-strong);border-color:var(--red);">中断</button>
    <button class="primary" data-sn2-role="send" data-action="_sn2StartSep()">送信</button></div></div>`;
  document.body.appendChild(o);
  const slot = o.querySelector('#sn2-sep-countdown-slot');
  if (slot && window.GBUI && typeof window.GBUI.buildNumInput === 'function') {
    slot.replaceWith(window.GBUI.buildNumInput({
      label: 'カウントダウン',
      value: 5,
      unit: '秒',
      min: 1,
      max: 60,
      attrs: { id: 'sn2-sep-countdown' }
    }));
  } else if (slot) {
    slot.outerHTML = '<div class="field"><label>カウントダウン（秒）</label><input id="sn2-sep-countdown" type="number" min="1" max="60" value="5"></div>';
  }
  const breakWaitSlot = o.querySelector('#sn2-sep-break-wait-slot');
  if (breakWaitSlot && window.GBUI && typeof window.GBUI.buildNumInput === 'function') {
    breakWaitSlot.replaceWith(window.GBUI.buildNumInput({
      label: 'ページ送り後の待機',
      value: 1.0,
      unit: '秒',
      min: 0,
      max: 10,
      step: 0.1,
      attrs: { id: 'sn2-sep-break-wait' }
    }));
  } else if (breakWaitSlot) {
    breakWaitSlot.outerHTML = '<div class="field"><label>ページ送り後の待機（秒）</label><input id="sn2-sep-break-wait" type="number" min="0" max="10" step="0.1" value="1.0"></div>';
  }
  o._sn2Editor = editor;
}

function _sn2GetTextAffix(editor, role) {
  const chara = role
    ? editor.doc.characters?.find(c => !c.isDefault && c.name === role)
    : editor.doc.characters?.find(c => c.isDefault);
  const ts = chara?.textStyle || {};
  const before = ts.textBefore ?? chara?.textBefore ?? '';
  const after = ts.textAfter ?? chara?.textAfter ?? '';
  return { before, after };
}

function _sn2StartSep() {
  const overlay = document.querySelector('.modal-overlay');
  const editor = overlay?._sn2Editor || _sn2GetActiveEditor();
  if (!editor?.doc) return;
  const countdown = parseInt(document.getElementById('sn2-sep-countdown')?.value) || 5;
  const breakWaitRaw = parseFloat(document.getElementById('sn2-sep-break-wait')?.value);
  const breakWait = Number.isFinite(breakWaitRaw) ? Math.max(0, Math.min(10, Math.round(breakWaitRaw * 10) / 10)) : 1.0;
  const includeAffix = !!document.getElementById('sn2-sep-include-affix')?.checked;
  const includeSummary = !!document.getElementById('sn2-sep-include-summary')?.checked;
  const includeBreakText = !!document.getElementById('sn2-sep-include-break-text')?.checked;
  const skipBlank = !!document.getElementById('sn2-sep-skip-blank')?.checked;
  const doc = editor.doc;
  const range = document.querySelector('input[name="sn2-sep-range"]:checked')?.value || 'all';
  const sourceRows = range === 'selected' ? _sn2RowsForClipStudio(editor) : doc.rows;
  const flagSets = typeof editor._getRoleFlagSets === 'function'
    ? editor._getRoleFlagSets()
    : { breakNames: new Set(), summaryNames: new Set() };
  const breakNames = flagSets.breakNames || new Set();
  const summaryNames = flagSets.summaryNames || new Set();
  // 「見開き」フラグが立ったタイプ名の集合
  const spreadNames = new Set();
  (doc.characters || []).forEach(c => {
    if (c.isDefault) return;
    if (!c.name) return;
    if (c.isSpread) spreadNames.add(c.name);
  });
  // 「見開き」ONの区切り行が連続したとき、偶数回目はページ送りをスルーしてコマ送り扱いにする。
  // 連続は「区切り行だけを抽出した並び」で数え、他の行を挟んでも継続する。
  // 見開きOFFの区切り行が現れたら連続カウントをリセット。
  let spreadRun = 0;
  const rows = [];
  for (const r of sourceRows) {
    const role = r.role || '';
    const isBreak = !!role && breakNames.has(role);
    const isSummary = !!role && summaryNames.has(role);
    const isSpread = !!role && spreadNames.has(role);
    if (isSummary && !includeSummary) continue;
    let plainText = _sn2StripRubyToPlain(r.text || '');
    if (includeAffix && plainText) {
      const affix = _sn2GetTextAffix(editor, role);
      plainText = (affix.before || '') + plainText + (affix.after || '');
    }
    // 「空白行を出力しない」: 区切り/プロットではなく、キャラ名も本文も空の行を除外
    if (skipBlank && !isBreak && !isSummary && !role && !plainText) continue;
    let kind = 'normal';
    if (isBreak) {
      if (isSpread) {
        spreadRun++;
        // 連続2,4,6…回目（偶数回目）はページ送りをスルーしてコマ送りへ。
        // 「区切り行のテキストも出力する」ON かつ本文ありならテキストも出力する
        if (spreadRun % 2 === 0) {
          const breakText = (includeBreakText && plainText) ? plainText : '';
          rows.push({ kind: 'normal', character: '', text: breakText });
          continue;
        }
      } else {
        spreadRun = 0;
      }
      kind = 'pageBreak';
    } else if (isSummary) {
      kind = 'summary';
    }
    // 区切り行のテキストは「区切り行のテキストも出力する」ON のときだけ送信
    const outText = isBreak ? (includeBreakText ? plainText : '') : plainText;
    rows.push({
      kind,
      character: isBreak ? '' : role,
      text: outText,
    });
  }
  // 全ページ出力（range==='all'）のとき、先頭ページの区切り行ではページ送りしない
  if (range === 'all') {
    const firstBreakIdx = rows.findIndex(row => row.kind === 'pageBreak');
    if (firstBreakIdx >= 0) {
      const first = rows[firstBreakIdx];
      if (includeBreakText && first.text) {
        // テキストがあれば通常行扱いで先頭ページ先頭にペースト
        first.kind = 'normal';
        first.character = '';
      } else {
        // テキストがない or オプションOFF → 先頭の区切り行ごと除去
        rows.splice(firstBreakIdx, 1);
      }
    }
  }
  if (!_sn2SepWs || _sn2SepWs.readyState !== WebSocket.OPEN) {
    if (typeof showStatus === 'function') showStatus('クリスタ連携が切断されています。再接続してから送信してください', true);
    _sn2SepConnect();
    return;
  }
  try {
    _sn2SepWs.send(JSON.stringify({ command: 'paste', rows, countdown, breakWait }));
    _sn2EnterRunningMode(overlay);
  } catch {
    if (typeof showStatus === 'function') showStatus('クリスタ連携への送信に失敗しました', true);
  }
}

// 送信中は元のダイアログを閉じ、画面全体を覆う警告オーバーレイに切り替える
function _sn2EnterRunningMode(dialogOverlay) {
  try { dialogOverlay?.remove(); } catch {}
  // 既に警告オーバーレイが出ていれば再利用
  let ov = document.getElementById('sn2-sep-running-overlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.id = 'sn2-sep-running-overlay';
  Object.assign(ov.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(0,0,0,0.78)',
    color: 'var(--ui-fg-strong,#fff)',
    zIndex: '99999',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'auto',
  });
  const box = document.createElement('div');
  Object.assign(box.style, {
    minWidth: '340px',
    maxWidth: '560px',
    padding: '28px 32px',
    background: 'var(--bg1,#222)',
    border: '2px solid var(--red,#d44)',
    borderRadius: '8px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
    textAlign: 'center',
    color: 'var(--fg1,#fff)',
  });
  const title = document.createElement('div');
  title.textContent = 'クリスタへ送信中';
  Object.assign(title.style, { fontSize: '18px', fontWeight: 'bold', marginBottom: '8px', color: 'var(--red,#f66)' });
  box.appendChild(title);
  const warn = document.createElement('div');
  warn.textContent = 'ペーストが完了するまで、マウス・キーボード・他ウィンドウ等、一切の操作をしないでください。';
  Object.assign(warn.style, { fontSize: '14px', lineHeight: '1.5', margin: '4px 0 16px', color: 'var(--fg1,#fff)' });
  box.appendChild(warn);
  const status = document.createElement('div');
  status.id = 'sn2-sep-running-status';
  status.textContent = '送信準備中...';
  Object.assign(status.style, { fontSize: '14px', margin: '16px 0', padding: '10px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', minHeight: '1.4em' });
  box.appendChild(status);
  const btnRow = document.createElement('div');
  Object.assign(btnRow.style, { display: 'flex', justifyContent: 'center', marginTop: '8px' });
  const stopBtn = document.createElement('button');
  stopBtn.type = 'button';
  stopBtn.textContent = '中断';
  Object.assign(stopBtn.style, {
    background: 'var(--red,#d44)', color: 'var(--ui-fg-strong,#fff)',
    border: '1px solid var(--red,#d44)', padding: '8px 24px', borderRadius: '4px',
    fontSize: '14px', fontWeight: 'bold', cursor: 'pointer',
  });
  stopBtn.addEventListener('click', () => { _sn2StopSep(); });
  btnRow.appendChild(stopBtn);
  box.appendChild(btnRow);
  ov.appendChild(box);
  document.body.appendChild(ov);
  return ov;
}

function _sn2UpdateRunningDialog(msg) {
  const ov = document.getElementById('sn2-sep-running-overlay');
  if (!ov) return;
  const statusEl = ov.querySelector('#sn2-sep-running-status');
  if (statusEl && msg) {
    if (msg.type === 'countdown') statusEl.textContent = `${msg.seconds}秒後にペースト開始...`;
    else if (msg.type === 'progress') statusEl.textContent = msg.message || `ペースト中... ${msg.current}/${msg.total}`;
    else if (msg.type === 'status') statusEl.textContent = msg.message || '';
    else if (msg.type === 'done') statusEl.textContent = msg.message || 'ペースト完了';
    else if (msg.type === 'error') statusEl.textContent = `エラー: ${msg.message || ''}`;
  }
  const isAborted = msg && msg.type === 'status' && typeof msg.message === 'string' && /中断されました/.test(msg.message);
  if (msg && (msg.type === 'done' || msg.type === 'error' || isAborted)) {
    setTimeout(() => { ov.remove(); }, 1500);
  }
}

function _sn2StopSep() {
  if (_sn2SepWs && _sn2SepWs.readyState === WebSocket.OPEN) {
    _sn2SepWs.send(JSON.stringify({ command: 'stop' }));
  }
  const running = document.getElementById('sn2-sep-running-overlay');
  if (running) {
    const statusEl = running.querySelector('#sn2-sep-running-status');
    if (statusEl) statusEl.textContent = '中断要求を送信しました...';
    return;
  }
  // 送信前のキャンセル: 送信ダイアログを閉じる
  document.querySelector('.modal-overlay')?.remove();
}
