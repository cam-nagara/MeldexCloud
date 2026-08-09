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
            if (msg.type === 'countdown') w.textContent = `CLIP STUDIO PAINTへ送信: ${msg.seconds}秒後にペースト開始...`;
            else w.textContent = msg.message || '';
            if (w.id === 'sb-warn') w.style.display = w.textContent ? '' : 'none';
            w.style.color = colorMap[msg.type] || '';
            // 接続済み/進行中/完了などの通常状態は失敗ではないため、
            // 「エラー: 」表示（#sb-warn[data-status-kind="error"] / #sb-msg[data-status-kind="error"]、
            // gb-accessibility.css）を誤って出さないよう、実際の失敗時のみ error 扱いにする。
            if (msg.type === 'error') {
              w.dataset.statusKind = 'error';
              if (w.id === 'sb-msg') w.setAttribute('aria-label', 'エラー: ' + w.textContent);
            } else {
              delete w.dataset.statusKind;
              if (w.id === 'sb-msg') w.removeAttribute('aria-label');
            }
            if (msg.type === 'done') setTimeout(() => {
              w.textContent = '';
              w.style.color = '';
              delete w.dataset.statusKind;
              if (w.id === 'sb-msg') w.removeAttribute('aria-label');
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
  if (typeof editor._syncAllFromDom === 'function') editor._syncAllFromDom();

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
      const effectiveRole = globalThis.GBScriptNoteRoleModel?.getEffectiveRole?.(doc, r);
      const charaR = effectiveRole?.type || effectiveRole?.style
        || (r.role ? doc.characters?.find(c => !c.isDefault && c.name === r.role) : null);
      if (charaR?.isBreak || charaR?.kind === 'break') { out += '←\r\n'; continue; }
      let plainText = _sn2StripRubyToPlain(r.text || '');
      if (includeAffixCb && plainText) {
        const affix = _sn2GetTextAffix(editor, r);
        plainText = (affix.before || '') + plainText + (affix.after || '');
      }
      if (plainText) out += plainText + '\r\n';
      if (nextIndex >= 0 && calc[rowIndex] && calc[nextIndex] && calc[nextIndex].page !== calc[rowIndex].page) {
        out += '\r\n';
      }
    }
    const onCopied = () => {
      if (typeof showStatus === 'function') showStatus('CLIP STUDIO PAINT用テキストをコピーしました');
    };
    const fallbackCopy = () => {
      const ta = document.createElement('textarea');
      ta.className = 'sn2-clipstudio-copy-buffer';
      ta.setAttribute('aria-hidden', 'true');
      ta.tabIndex = -1;
      ta.readOnly = true;
      ta.value = out;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      ta.remove();
      onCopied();
    };
    const clipboard = (typeof navigator !== 'undefined') ? navigator.clipboard : null;
    if (clipboard?.writeText) clipboard.writeText(out).then(onCopied).catch(fallbackCopy);
    else fallbackCopy();
  });
}

function _sn2ShowSepDialog(editor) {
  const doc = editor.doc;
  const selectedRows = _sn2RowsForClipStudio(editor);
  const hasSelection = selectedRows.length > 0 && selectedRows.length < doc.rows.length;
  const allChecked = hasSelection ? '' : ' checked';
  const selectedOption = hasSelection
    ? `<label class="sn2-sep-choice"><input type="radio" name="sn2-sep-range" value="selected" checked> 選択範囲（${selectedRows.length}行）</label>`
    : '';
  const o = document.createElement('div');
  o.className = 'modal-overlay';
  o.dataset.sn2Dialog = 'clipstudio-send';
  o.innerHTML = `<div class="modal sn2-sep-modal" role="dialog" aria-modal="true" aria-labelledby="sn2-sep-title"><h3 id="sn2-sep-title">CLIP STUDIO PAINTへ送信 ${fieldHelp('「送信」を押した後、カウントダウン中にCLIP STUDIO PAINTのストーリーエディタをクリックしてください')}</h3>
    <div class="field"><label>送信範囲</label><div class="sn2-sep-range-row">
      <label class="sn2-sep-choice"><input type="radio" name="sn2-sep-range" value="all"${allChecked}> 全行（${doc.rows.length}行）</label>${selectedOption}</div></div>
    <div class="field"><label class="sn2-sep-choice"><input type="checkbox" id="sn2-sep-include-affix"> テキストの前後設定（「」（）等）を含める</label></div>
    <div class="field"><label class="sn2-sep-choice"><input type="checkbox" id="sn2-sep-include-summary"> プロット行も出力する</label></div>
    <div class="field"><label class="sn2-sep-choice"><input type="checkbox" id="sn2-sep-include-break-text"> 区切り行のテキストも出力する</label></div>
    <div class="field"><label class="sn2-sep-choice"><input type="checkbox" id="sn2-sep-skip-blank"> 空白行を出力しない</label></div>
    <div id="sn2-sep-countdown-slot"></div>
    <div id="sn2-sep-break-wait-slot"></div>
    <div id="sn2-sep-status" class="sn2-sep-status"></div>
    <div class="btn-row"><button type="button" class="cancel-btn" data-sn2-role="cancel">キャンセル</button>
    <button type="button" class="sn2-sep-stop-btn" data-sn2-role="stop">中断</button>
    <button type="button" class="primary ok-btn" data-sn2-role="send">送信</button></div></div>`;
  document.body.appendChild(o);
  const slot = o.querySelector('#sn2-sep-countdown-slot');
  if (slot && window.GBUI && typeof window.GBUI.buildNumInput === 'function') {
    const control = window.GBUI.buildNumInput({
      label: 'カウントダウン',
      value: 5,
      unit: '秒',
      min: 1,
      max: 60,
      attrs: { id: 'sn2-sep-countdown' }
    });
    control?.classList?.add('sn2-sep-field');
    slot.replaceWith(control);
  } else if (slot) {
    slot.outerHTML = '<div class="field sn2-sep-field"><label for="sn2-sep-countdown">カウントダウン（秒）</label><input id="sn2-sep-countdown" class="sn2-sep-number" type="number" min="1" max="60" value="5"></div>';
  }
  const breakWaitSlot = o.querySelector('#sn2-sep-break-wait-slot');
  if (breakWaitSlot && window.GBUI && typeof window.GBUI.buildNumInput === 'function') {
    const control = window.GBUI.buildNumInput({
      label: 'ページ送り後の待機',
      value: 1.0,
      unit: '秒',
      min: 0,
      max: 10,
      step: 0.1,
      attrs: { id: 'sn2-sep-break-wait' }
    });
    control?.classList?.add('sn2-sep-field');
    breakWaitSlot.replaceWith(control);
  } else if (breakWaitSlot) {
    breakWaitSlot.outerHTML = '<div class="field sn2-sep-field"><label for="sn2-sep-break-wait">ページ送り後の待機（秒）</label><input id="sn2-sep-break-wait" class="sn2-sep-number" type="number" min="0" max="10" step="0.1" value="1.0"></div>';
  }
  o._sn2Editor = editor;
  o.querySelector('[data-sn2-role="cancel"]')?.addEventListener('click', () => { o.remove(); });
  o.querySelector('[data-sn2-role="stop"]')?.addEventListener('click', () => { _sn2StopSep(); });
  o.querySelector('[data-sn2-role="send"]')?.addEventListener('click', () => { _sn2StartSep(); });
  window.GBModalShell?.enhanceOverlay?.(o);
}

function _sn2GetTextAffix(editor, roleOrRow) {
  const role = typeof roleOrRow === 'object' ? String(roleOrRow?.role || '') : String(roleOrRow || '');
  const chara = globalThis.GBScriptNoteRoleModel?.getEffectiveStyle?.(editor.doc, roleOrRow)
    || (role
      ? editor.doc.characters?.find(c => !c.isDefault && c.name === role)
      : editor.doc.characters?.find(c => c.isDefault));
  const ts = chara?.textStyle || {};
  const before = ts.textBefore ?? chara?.textBefore ?? '';
  const after = ts.textAfter ?? chara?.textAfter ?? '';
  return { before, after };
}

function _sn2StartSep() {
  const overlay = document.querySelector('.modal-overlay[data-sn2-dialog="clipstudio-send"]') || document.querySelector('.modal-overlay');
  const editor = overlay?._sn2Editor || _sn2GetActiveEditor();
  if (!editor?.doc) return;
  if (typeof editor._syncAllFromDom === 'function') editor._syncAllFromDom();
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
  // 「見開き」ONの区切り行が連続したとき、偶数回目はページ送りをスルーしてコマ送り扱いにする。
  // 連続は「区切り行だけを抽出した並び」で数え、他の行を挟んでも継続する。
  // 見開きOFFの区切り行が現れたら連続カウントをリセット。
  let spreadRun = 0;
  const rows = [];
  for (const r of sourceRows) {
    const role = r.role || '';
    const effectiveRole = globalThis.GBScriptNoteRoleModel?.getEffectiveRole?.(doc, r);
    const roleType = effectiveRole?.type || effectiveRole?.style || null;
    const isBreak = !!role && !!(roleType?.isBreak || roleType?.kind === 'break');
    const isSummary = !!role && !!(roleType?.isSummary || roleType?.kind === 'summary');
    const isSpread = !!role && !!roleType?.isSpread;
    if (isSummary && !includeSummary) continue;
    let plainText = _sn2StripRubyToPlain(r.text || '');
    if (includeAffix && plainText) {
      const affix = _sn2GetTextAffix(editor, r);
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
    if (rows[0]?.kind === 'pageBreak') {
      const first = rows[0];
      if (includeBreakText && first.text) {
        // テキストがあれば通常行扱いで先頭ページ先頭にペースト
        first.kind = 'normal';
        first.character = '';
      } else {
        // テキストがない or オプションOFF → 先頭の区切り行ごと除去
        rows.shift();
      }
    }
  }
  if (!_sn2SepWs || _sn2SepWs.readyState !== WebSocket.OPEN) {
    if (typeof showStatus === 'function') showStatus('CLIP STUDIO PAINT連携が切断されています。再接続してから送信してください', true);
    _sn2SepConnect();
    return;
  }
  try {
    _sn2SepWs.send(JSON.stringify({ command: 'paste', rows, countdown, breakWait }));
    _sn2EnterRunningMode(overlay);
  } catch {
    if (typeof showStatus === 'function') showStatus('CLIP STUDIO PAINT連携への送信に失敗しました', true);
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
  ov.className = 'sn2-sep-running-overlay';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-labelledby', 'sn2-sep-running-title');
  const box = document.createElement('div');
  box.className = 'sn2-sep-running-box';
  const title = document.createElement('div');
  title.id = 'sn2-sep-running-title';
  title.className = 'sn2-sep-running-title';
  title.textContent = 'CLIP STUDIO PAINTへ送信中';
  box.appendChild(title);
  const warn = document.createElement('div');
  warn.className = 'sn2-sep-running-warning';
  warn.textContent = 'ペーストが完了するまで、マウス・キーボード・他ウィンドウ等、一切の操作をしないでください。';
  box.appendChild(warn);
  const status = document.createElement('div');
  status.id = 'sn2-sep-running-status';
  status.className = 'sn2-sep-running-status';
  status.textContent = '送信準備中...';
  box.appendChild(status);
  const btnRow = document.createElement('div');
  btnRow.className = 'sn2-sep-running-actions';
  const stopBtn = document.createElement('button');
  stopBtn.type = 'button';
  stopBtn.className = 'sn2-sep-running-stop';
  stopBtn.textContent = '中断';
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
  document.querySelector('.modal-overlay[data-sn2-dialog="clipstudio-send"]')?.remove();
}
