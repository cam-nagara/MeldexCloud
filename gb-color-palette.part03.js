// ============================================================
// 個人カラーストア（PC内共有・Meldex本体/単独アプリ間の同期）
// ビューワー安定化・共通UI計画書「4. 共通カスタムカラー」対応。
// getCustomColors()/saveCustomColor()/removeCustomColor() は既存どおり
// localStorage を同期キャッシュとして即座に反映し続け、永続化の共有先
// （%LOCALAPPDATA%\Meldex\custom-color-sets.json）への反映だけを
// バックグラウンドで非同期に行う。GETが一時的に失敗した場合は
// _personalColorsApiAvailable=false のまま GB_PERSONAL_COLORS_INIT_RETRY_SUPPRESS_MS
// の間だけlocalStorageのみで動作し、その後の色の追加/削除操作で自動的に再試行する
// （セッション中ずっと固定フォールバックにはしない）。ローカルAPIを持たない
// Cloud/静的版など、明確な404を受け取った場合だけ
// _personalColorsApiPermanentlyUnavailable=true とし、以後はセッション中
// localStorageのみで動作する（恒久フォールバック）。
// ============================================================
const GB_PERSONAL_COLORS_API_PATH = '/personal/custom-colors';
const GB_PERSONAL_COLORS_MIGRATED_KEY = '_gb-colors-server-migrated';
const GB_PERSONAL_COLORS_SCHEMA_VERSION = 1;
const GB_PERSONAL_COLORS_EXPORT_FILENAME_PREFIX = 'meldex-custom-colors';
const GB_PERSONAL_COLORS_INIT_RETRY_SUPPRESS_MS = 30000;

let _personalColorsApiAvailable = null; // null=未確認 / true=利用可 / false=利用不可（一時的な失敗を含む）
let _personalColorsApiPermanentlyUnavailable = false; // true=明確な404でAPI自体が無いと確認済み（以後は再試行しない）
let _personalColorsInitFailedAt = 0; // 直近の初期化失敗時刻(ms)。短時間の連続リトライを避ける抑止に使う
let _personalColorsRevision = null;
let _personalColorsSyncChain = Promise.resolve();
let _personalColorsSyncPending = false; // 実行待ちの同期要求が既にあるか（連続呼び出しの合流用）
let _personalColorsInitPromise = null;

// #RRGGBB以外（transparent/rgba/不正値）を読み飛ばしつつ重複排除する。
// 共有ストア（meldex_personal_colors.py）の正規化と同じ意味論。
function _personalColorsNormalizeList(colors) {
  const seen = new Set();
  const out = [];
  (Array.isArray(colors) ? colors : []).forEach((c) => {
    const hex = _colorValueToHex(c);
    if (!hex) return;
    const key = hex.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(key);
  });
  return out;
}

function _personalColorsApiUsable() {
  return typeof apiFetch === 'function' && _personalColorsApiAvailable !== false;
}

async function _fetchPersonalColorsRecord() {
  return apiFetch(GB_PERSONAL_COLORS_API_PATH, { method: 'GET', silentError: true, skipBrowseCache: true });
}

// baseRevision省略時（undefined）はnull（＝ストア未作成を期待）として送る。
// 背景保存は常にsilentError（トーストで邪魔しない。失敗はconsole.warnのみ）。
async function _putPersonalColorsRecord(colors, baseRevision, options) {
  return apiFetch(GB_PERSONAL_COLORS_API_PATH, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: GB_PERSONAL_COLORS_SCHEMA_VERSION,
      baseRevision: baseRevision === undefined ? null : baseRevision,
      colors,
    }),
    silentError: options?.silentError !== false,
  });
}

function _adoptPersonalColorsRecord(record, options) {
  if (!record || !Array.isArray(record.colors)) return;
  _personalColorsRevision = record.revision == null ? null : record.revision;
  if (options?.applyToLocal === false) return;
  // mergeWithLocal: レコード（サーバー由来。通常は既にローカルとマージ済みの内容）を
  // 先頭に置き、ローカルにしか無い色（レコード算出後に別の編集が割り込んで積まれた分）
  // だけを末尾に足す。全置換ではなく和集合にすることで、書き戻しの間に積まれた
  // 別の編集を消さない。
  const next = options?.mergeWithLocal
    ? _personalColorsNormalizeList([...record.colors, ...getCustomColors()])
    : _personalColorsNormalizeList(record.colors);
  _saveCustomColors(next, { skipHistory: true, skipServerSync: true });
}

// 初回のみ実行される起動時同期: サーバー到達性を確認し、未移行なら
// localStorageの色を共有ストアへ重複なく統合する（既存移行と同じ「一度だけ」方式）。
// GETが失敗した場合はキャッシュした初期化Promiseを破棄し、次回のユーザー操作
// （色の追加/削除など）で再試行できるようにする。ただし失敗直後
// GB_PERSONAL_COLORS_INIT_RETRY_SUPPRESS_MS 以内の呼び出しは即座に諦めて
// 連続リトライ（無限ループ）を避ける。明確な404だけは恒久フォールバックとする。
function _ensurePersonalColorsInit() {
  if (_personalColorsApiPermanentlyUnavailable) return Promise.resolve();
  if (_personalColorsInitPromise) return _personalColorsInitPromise;
  if (_personalColorsApiAvailable === false
    && (Date.now() - _personalColorsInitFailedAt) < GB_PERSONAL_COLORS_INIT_RETRY_SUPPRESS_MS) {
    return Promise.resolve();
  }
  _personalColorsInitPromise = (async () => {
    let record;
    try {
      record = await _fetchPersonalColorsRecord();
    } catch (e) {
      _personalColorsApiAvailable = false;
      _personalColorsInitFailedAt = Date.now();
      if (e?.status === 404) _personalColorsApiPermanentlyUnavailable = true;
      _personalColorsInitPromise = null;
      return;
    }
    if (!record || record.ok === false || !Array.isArray(record.colors)) {
      _personalColorsApiAvailable = false;
      _personalColorsInitFailedAt = Date.now();
      _personalColorsInitPromise = null;
      return;
    }
    _personalColorsApiAvailable = true;
    _personalColorsRevision = record.revision == null ? null : record.revision;

    let migrated = false;
    try { migrated = localStorage.getItem(GB_PERSONAL_COLORS_MIGRATED_KEY) === '1'; } catch {}

    if (migrated) {
      _adoptPersonalColorsRecord(record, { applyToLocal: true });
      return;
    }

    const localColors = getCustomColors();
    const merged = _personalColorsNormalizeList([...record.colors, ...localColors]);
    const sameAsServer = merged.length === record.colors.length
      && merged.every((c, i) => c === record.colors[i]);
    try {
      if (sameAsServer) {
        _adoptPersonalColorsRecord(record, { applyToLocal: true });
      } else {
        const putRecord = await _putPersonalColorsRecord(merged, _personalColorsRevision);
        _adoptPersonalColorsRecord(putRecord, { applyToLocal: true });
      }
      try { localStorage.setItem(GB_PERSONAL_COLORS_MIGRATED_KEY, '1'); } catch {}
    } catch (e) {
      // 初回移行の書き込みに失敗しても致命的ではない（localStorage側の色は
      // そのまま使い続けられる）。移行フラグを立てないため次回起動時に再試行する。
      console.warn('[gb-color-palette] personal colors migration failed:', e);
    }
  })();
  return _personalColorsInitPromise;
}

// 色リストの変更をバックグラウンドで共有ストアへ反映する。呼び出しは
// _personalColorsSyncChain で直列化し、baseRevisionのズレによる取りこぼしを防ぐ。
// 実際に送信するpayloadは実行直前に localStorage（getCustomColors()）から読み直す
// （呼び出し時点のスナップショットをクロージャへ固定しない）。ある同期が409再試行で
// 時間がかかっている間に別の編集が積まれても、その内容を取りこぼさないようにするため。
// 連続呼び出しは「実行待ちの同期要求を1つに合流」させる（_personalColorsSyncPending
// によるコアレス）。ただし実行中の同期には合流できないため、実行中に積まれた編集は
// 新しい同期要求としてチェーンの次に実行される（読み直しにより最新値が送られる）。
// 409（競合）時は最新状態を再取得し、サーバー最新∪ローカル最新でマージして
// 一度だけ再試行する（計画書「公開インターフェースと保存形式 > カスタムカラー」の
// 規約通り）。再試行成功後のローカルへの書き戻しは mergeWithLocal で行い、
// 再試行の実行中に積まれた別の編集（ローカルの直近値）を上書きで消さない。
function _queuePersonalColorsSync() {
  if (_personalColorsApiPermanentlyUnavailable) return;
  if (typeof apiFetch !== 'function') return;
  if (_personalColorsSyncPending) return; // 既に未実行の同期要求があるので合流する
  _personalColorsSyncPending = true;
  _personalColorsSyncChain = _personalColorsSyncChain
    .then(() => _ensurePersonalColorsInit())
    .then(async () => {
      _personalColorsSyncPending = false;
      if (!_personalColorsApiUsable()) return;
      const payload = _personalColorsNormalizeList(getCustomColors());
      try {
        const record = await _putPersonalColorsRecord(payload, _personalColorsRevision);
        _adoptPersonalColorsRecord(record, { applyToLocal: false });
      } catch (e) {
        if (e?.status !== 409) {
          console.warn('[gb-color-palette] personal colors sync failed:', e);
          return;
        }
        try {
          const latest = await _fetchPersonalColorsRecord();
          const merged = _personalColorsNormalizeList([...(latest?.colors || []), ...getCustomColors()]);
          const retryRecord = await _putPersonalColorsRecord(merged, latest?.revision == null ? null : latest.revision);
          _adoptPersonalColorsRecord(retryRecord, { applyToLocal: true, mergeWithLocal: true });
        } catch (retryErr) {
          console.warn('[gb-color-palette] personal colors sync retry failed:', retryErr);
        }
      }
    })
    .catch((e) => {
      _personalColorsSyncPending = false;
      console.warn('[gb-color-palette] personal colors sync chain error:', e);
    });
}

if (typeof apiFetch === 'function') {
  _ensurePersonalColorsInit().catch(() => {});
}

// ============================================================
// カスタムカラーの書き出し・読み込み（.meldex-colors.json）
// ============================================================
function _personalColorsExportDateStamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function _downloadJsonFile(filename, data) {
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 1000);
  } catch (e) {
    if (typeof showStatus === 'function') showStatus('書き出しに失敗しました: ' + e.message, true);
  }
}

// ローカルAPIが使える環境ではサーバーの/export（PC共有ストアの内容）を使い、
// Cloud/静的版等ローカルAPIが無い環境では現在の画面上のカスタムカラーを
// そのまま書き出す（計画書「ローカルAPIを持たないCloud／静的版では、
// ブラウザー内保存とダウンロード／ファイル選択へフォールバックする」）。
async function _exportCustomColorsToFile() {
  // クリック直後は起動時initが未完了(_personalColorsApiAvailable===null)な
  // ことがあるため、可用性判定を待ってから分岐する。
  if (typeof _ensurePersonalColorsInit === 'function') { try { await _ensurePersonalColorsInit(); } catch {} }
  let colors = null;
  let exportedAt = new Date().toISOString();
  if (_personalColorsApiAvailable === true && typeof apiPost === 'function') {
    try {
      const res = await apiPost(GB_PERSONAL_COLORS_API_PATH + '/export', {});
      if (res && Array.isArray(res.colors)) {
        colors = res.colors;
        exportedAt = res.exportedAt || exportedAt;
      }
    } catch (e) {
      console.warn('[gb-color-palette] export via API failed, falling back to local list:', e);
    }
  }
  if (!colors) colors = _personalColorsNormalizeList(getCustomColors());
  const fileBody = { schemaVersion: GB_PERSONAL_COLORS_SCHEMA_VERSION, colors, exportedAt };
  _downloadJsonFile(`${GB_PERSONAL_COLORS_EXPORT_FILENAME_PREFIX}-${_personalColorsExportDateStamp()}.meldex-colors.json`, fileBody);
  if (typeof showStatus === 'function') showStatus(`カスタムカラーを書き出しました（${colors.length}色）`);
}

let _personalColorsImportFileInput = null;
function _promptImportCustomColorsFile() {
  if (!_personalColorsImportFileInput) {
    _personalColorsImportFileInput = document.createElement('input');
    _personalColorsImportFileInput.type = 'file';
    _personalColorsImportFileInput.accept = '.json,.meldex-colors.json,application/json';
    _personalColorsImportFileInput.style.display = 'none';
    _personalColorsImportFileInput.dataset.e2eId = 'color-palette-custom-import-file';
    document.body.appendChild(_personalColorsImportFileInput);
    _personalColorsImportFileInput.addEventListener('change', () => {
      const file = _personalColorsImportFileInput.files && _personalColorsImportFileInput.files[0];
      _personalColorsImportFileInput.value = '';
      if (file) _handleImportCustomColorsFile(file);
    });
  }
  _personalColorsImportFileInput.click();
}

const GB_PERSONAL_COLORS_MAX_IMPORT_RAW_COLORS = 5000;

function _handleImportCustomColorsFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(String(reader.result || ''));
    } catch {
      if (typeof showStatus === 'function') showStatus('読み込みファイルの形式が正しくありません(JSONとして解析できません)', true);
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.colors)) {
      if (typeof showStatus === 'function') showStatus('読み込みファイルにカスタムカラーの一覧がありません', true);
      return;
    }
    if (parsed.colors.length > GB_PERSONAL_COLORS_MAX_IMPORT_RAW_COLORS) {
      if (typeof showStatus === 'function') showStatus('読み込みファイルの色数が多すぎます', true);
      return;
    }
    _showPersonalColorsImportModeDialog((mode) => {
      if (mode) _applyImportedCustomColors(parsed.colors, mode);
    });
  };
  reader.onerror = () => {
    if (typeof showStatus === 'function') showStatus('ファイルを読み込めませんでした', true);
  };
  reader.readAsText(file);
}

// 「追加して読み込む」を既定、「現在のセットを置き換える」も選べるようにする
// （計画書の規約通り）。置き換えは既存のカスタムカラーを失う操作のため、
// 削除相当の確認として3択（キャンセル/追加/置き換え）で提示し、既定フォーカスは
// 非破壊の「追加」に置く。
function _showPersonalColorsImportModeDialog(onChoose) {
  const body = document.createElement('div');
  body.className = 'modal-body';
  body.textContent = '読み込んだカスタムカラーを、現在のセットへ追加しますか、それとも置き換えますか。';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'gb-btn gb-btn-sm cancel-btn';
  cancelBtn.dataset.e2eId = 'color-palette-import-mode-cancel';
  cancelBtn.textContent = 'キャンセル';

  const replaceBtn = document.createElement('button');
  replaceBtn.type = 'button';
  replaceBtn.className = 'gb-btn gb-btn-sm gb-btn-danger danger';
  replaceBtn.dataset.e2eId = 'color-palette-import-mode-replace';
  replaceBtn.textContent = '置き換える';
  replaceBtn.title = '現在のカスタムカラーをすべて削除してから読み込みます';

  const appendBtn = document.createElement('button');
  appendBtn.type = 'button';
  appendBtn.className = 'gb-btn gb-btn-sm gb-btn-primary primary ok-btn';
  appendBtn.dataset.e2eId = 'color-palette-import-mode-append';
  appendBtn.textContent = '追加して読み込む';

  let modalApi = null;
  modalApi = window.GBUI.createModal({
    id: 'color-palette-import-mode',
    title: 'カスタムカラーを読み込む',
    body,
    footer: [cancelBtn, replaceBtn, appendBtn],
    variant: 'standard',
    geometryKey: 'color-palette-import-mode',
    minWidth: '0',
    initialFocus: appendBtn,
    closeLabel: 'カスタムカラーの読み込みを閉じる',
    closeOnEsc: true,
    closeOnOverlay: true,
    resizable: true,
    onClose: (reason) => {
      const mode = reason === 'append' || reason === 'replace' ? reason : null;
      if (typeof onChoose === 'function') onChoose(mode);
    },
  });
  const { overlay, modal } = modalApi;
  overlay.classList.add('modal-overlay');
  overlay.dataset.e2eId = 'color-palette-import-mode-overlay';
  overlay._personalColorsImportModeModalApi = modalApi;
  modal.classList.add('modal', 'gb-palette-import-mode-dialog');
  modal.dataset.e2eId = 'color-palette-import-mode-dialog';
  modal.setAttribute('role', 'alertdialog');
  modal.style.cssText = 'width:min(460px,calc(100vw - 24px));max-width:100%;overflow:hidden;';

  cancelBtn.addEventListener('click', () => modalApi.close('cancel'));
  replaceBtn.addEventListener('click', () => modalApi.close('replace'));
  appendBtn.addEventListener('click', () => modalApi.close('append'));
  modalApi.open();
}

// APIが使える場合はサーバーの/importで追加/置換を確定させ、使えない場合
// （Cloud/静的版フォールバック）はローカルのカスタムカラーへ直接反映する。
async function _applyImportedCustomColors(rawColors, mode) {
  if (typeof _ensurePersonalColorsInit === 'function') { try { await _ensurePersonalColorsInit(); } catch {} }
  const normalized = _personalColorsNormalizeList(rawColors);
  const label = mode === 'replace' ? 'カスタムカラー: ファイルから置き換え' : 'カスタムカラー: ファイルから追加';
  if (_personalColorsApiAvailable === true && typeof apiPost === 'function') {
    try {
      const res = await apiPost(GB_PERSONAL_COLORS_API_PATH + '/import', {
        content: { schemaVersion: GB_PERSONAL_COLORS_SCHEMA_VERSION, colors: normalized },
        mode,
      });
      if (res && Array.isArray(res.colors)) {
        _personalColorsRevision = res.revision == null ? null : res.revision;
        _saveCustomColors(res.colors, { label, skipServerSync: true });
        if (typeof showStatus === 'function') showStatus(`カスタムカラーを読み込みました（${res.colors.length}色）`);
        return;
      }
    } catch (e) {
      console.warn('[gb-color-palette] import via API failed, falling back to local merge:', e);
    }
  }
  const finalColors = mode === 'replace'
    ? normalized
    : _personalColorsNormalizeList([...getCustomColors(), ...normalized]);
  _saveCustomColors(finalColors, { label });
  if (typeof showStatus === 'function') showStatus(`カスタムカラーを読み込みました（${finalColors.length}色）`);
}
