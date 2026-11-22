let _statusProgressHandle = null;
let _statusProgressIdleTimer = 0;

function _isStatusProgressMessage(text, isError, options) {
  if (options?.progress === true) return true;
  if (options?.progress === false || isError || !text) return false;
  const core = text.replace(_STATUS_PROGRESS_ELLIPSIS_RE, '');
  if (core !== text) return /中|して(?:い|お)|ています|ており|準備/.test(core);
  return /中(?:です)?$/.test(text);
}

function _statusProgressApi() {
  const api = typeof window !== 'undefined' ? window.MeldexOperationProgress : null;
  return api && typeof api.begin === 'function' ? api : null;
}

function _statusProgressLabel(text) {
  return String(text || '').replace(_STATUS_PROGRESS_ELLIPSIS_RE, '').trim() || '処理中';
}

function _beginStatusProgress(api, text) {
  const label = _statusProgressLabel(text);
  const current = _statusProgressHandle;
  const state = current?.getState?.();
  if (current && state && !api.isTerminalStatus?.(state.status)) current.update({ label });
  else _statusProgressHandle = api.begin({ kind: 'status-progress', label, delayMs: 250 });
  clearTimeout(_statusProgressIdleTimer);
  // 終わりの知らせが来ない処理（保存のダイアログを閉じた等）でも、処理パネルに残り続けない。
  _statusProgressIdleTimer = setTimeout(() => _endStatusProgress('', false), _STATUS_PROGRESS_IDLE_MS);
}

function _endStatusProgress(text, isError) {
  const handle = _statusProgressHandle;
  if (!handle) return;
  _statusProgressHandle = null;
  clearTimeout(_statusProgressIdleTimer);
  if (isError) handle.fail({ error: text || '失敗しました' });
  else handle.succeed(text ? { summary: text } : {});
}

// 長い処理（HTMLの作成など）を処理パネルに出しながら実行する。開始直後から表示し、終わったら閉じる。
async function runWithProgress(label, task, options = {}) {
  const api = _statusProgressApi();
  const handle = api ? api.begin({ kind: options.kind || 'operation', label: label || '処理中', showImmediately: options.showImmediately !== false, delayMs: options.delayMs }) : null;
  if (!handle && typeof showStatus === 'function') showStatus((label || '処理中') + '...', false, { progress: false });
  try {
    const result = await task(handle);
    const state = handle?.getState?.();
    if (handle && state && !api.isTerminalStatus?.(state.status)) {
      if (result === false) handle.cancelled?.({});
      else handle.succeed(options.summary ? { summary: options.summary } : {});
    }
    return result;
  } catch (error) {
    handle?.fail?.(error instanceof Error ? error : { error: String(error?.message || error || '失敗しました') });
    throw error;
  }
}
if (typeof window !== 'undefined') window.runWithProgress = runWithProgress;

function showStatus(msg, isError, options) {
  const el = document.getElementById('sb-msg');
  const text = String(msg || '');
  if (_isStatusProgressMessage(text, isError, options)) {
    const api = _statusProgressApi();
    if (api) { _beginStatusProgress(api, text); return; }
  } else if (text || isError) {
    _endStatusProgress(text, isError);
  }
  if (!el) {
    console.log((isError ? 'ERROR: ' : '') + text);
    if (_isSaveSuccessStatusMessage(text, isError, options)) _queueSaveDialog(text);
    return;
  }
  el.textContent = text;
  el.style.color = isError ? 'var(--red)' : 'var(--fg2)';
  if (text) {
    el.dataset.statusKind = isError ? 'error' : 'success';
    el.setAttribute('aria-label', (isError ? 'エラー: ' : '状態: ') + text);
  } else {
    delete el.dataset.statusKind;
    el.removeAttribute('aria-label');
  }
  _showMobileStatusToast(text, !!isError);
  if (isError) {
    setTimeout(() => {
      if (el.textContent === text) {
        el.textContent = '';
        delete el.dataset.statusKind;
        el.removeAttribute('aria-label');
      }
    }, 5000);
  } else if (_isSaveSuccessStatusMessage(text, isError, options)) {
    _queueSaveDialog(text);
  }
}
window.showStatus = showStatus;

function getCssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function rgbToHex(rgb) {
  if (!rgb || rgb.startsWith('#')) return rgb || '#000000';
  const m = rgb.match(/(\d+)/g);
  if (!m || m.length < 3) return '#000000';
  return '#' + m.slice(0,3).map(n => parseInt(n).toString(16).padStart(2,'0')).join('');
}

// ============================================================
// 定数
// ============================================================
const FILE_TYPE_LABELS = {
  folder: 'フォルダ', database: 'シート', pivot: 'シート', page: 'ノート', scenario: '旧シナリオ', scriptnote: 'シナリオ', board: 'ボード', calendar: 'カレンダー',
  entity: 'ページ', chat: 'チャット',
  image: '画像', video: '動画', audio: '音声', html: 'HTML', csv: 'CSV',
  psd: 'Photoshop', clip: 'CLIP STUDIO', '3d': '3D', document: '文書',
  'form-app': 'フォーム', archive: 'アーカイブ', app: 'アプリ', unknown: 'ファイル',
};

const NATIVE_TYPES = new Set(['form-app','page','board','calendar','image','video','audio','html','csv','database','entity','folder','scriptnote','scenario','chat']);

const PALETTE_COLORS = [
  '#ffffff','#d4d4d4','#ababab','#808080','#545454','#2b2b2b','#000000',
  '#cf9b9b','#cfc39b','#b4cf9b','#9bcfaa','#9bcccf','#9ba4cf','#b89bcf','#cf9bbd',
  '#9e4f4f','#9e8c4f','#759e4f','#4f9e65','#4f9a9e','#4f5e9e','#7c4f9e','#9e4f84',
  '#4f2828','#4f4628','#3b4f28','#284f33','#284d4f','#282f4f','#3e284f','#4f2842',
];

const PALETTE_BG_COLORS = [
  '#544040','#544940','#545040','#445440','#40544c','#404c54','#434054','#504054',
  '#493232','#493d32','#494632','#394932','#32493f','#323d49','#393249','#463249',
  '#3d2c2c','#3d342c','#3d3a2c','#313d2c','#2c3d35','#2c343d','#312c3d','#3a2c3d',
];

// ============================================================
// Lucide Icons (ISC License)
// ============================================================
const LUCIDE = {
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  moreHorizontal: '<circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/><circle cx="5" cy="12" r="1" fill="currentColor"/>',
  moreVertical: '<circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="5" r="1" fill="currentColor"/><circle cx="12" cy="19" r="1" fill="currentColor"/>',
  folderPen: '<path d="M8.4 10.6a2 2 0 0 1 3 3L6 19l-4 1 1-4Z"/><path d="M2 11.5V5a2 2 0 0 1 2-2h3.9a2 2 0 0 0 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9.5"/>',
  folderTree: '<path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M3 5a2 2 0 0 0 2 2h3"/><path d="M3 3v13a2 2 0 0 0 2 2h3"/>',
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  page: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  db: '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
  scenario: '<path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/>',
  sync: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  calendarSync: '<path d="M11 10v4h4"/><path d="m11 14 1.535-1.605a5 5 0 0 1 8 1.5"/><path d="M16 2v4"/><path d="m21 18-1.535 1.605a5 5 0 0 1-8-1.5"/><path d="M21 22v-4h-4"/><path d="M21 8.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4.3"/><path d="M3 10h4"/><path d="M8 2v4"/>',
  arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  filePlus: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/><path d="M12 18v-6"/>',
  menu: '<path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h16"/>',
  mousePointer: '<path d="M12.586 12.586 19 19"/><path d="M3.688 3.037a.497.497 0 0 0-.651.651l6.5 15.999a.501.501 0 0 0 .947-.062l1.569-6.083a2 2 0 0 1 1.448-1.479l6.124-1.579a.5.5 0 0 0 .063-.947z"/>',
  creditCard: '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
  spline: '<circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><path d="M5 17A12 12 0 0 1 17 5"/>',
  // アノテートフロートパレット改修計画2026-08-13 §1-3・§3-a: 折れ線ツールのアイコンを
  // spline（曲線）から activity（角のはっきりした折れ線）へ差し替えるために追加。
  // パス値は vendor/lucide-icons.js の LUCIDE_FULL['activity'] と同一。
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  funnel: '<path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"/>',
  panelLeft: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  panelRight: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
  // ビューワー残課題修正計画 2026-08-04: 反転2種・回転を共通アイコン置換表へ登録
  // （既存のビューワー固有直接描画回避を撤去するため。パス値はvendor/lucide-icons.jsの
  // flipHorizontal2 / flipVertical2 / rotateCw と同一）。
  flipHorizontal2: '<path d="m3 7 5 5-5 5V7"/><path d="m21 7-5 5 5 5V7"/><path d="M12 20v2"/><path d="M12 14v2"/><path d="M12 8v2"/><path d="M12 2v2"/>',
  flipVertical2: '<path d="m17 3-5 5-5-5h10"/><path d="m17 21-5-5-5 5h10"/><path d="M4 12H2"/><path d="M10 12H8"/><path d="M16 12h-2"/><path d="M22 12h-2"/>',
  rotateCw: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  type: '<path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/>',
  typeOutline: '<path d="M14 16.5a.5.5 0 0 0 .5.5h.5a2 2 0 0 1 0 4H9a2 2 0 0 1 0-4h.5a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5V8a2 2 0 0 1-4 0V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 1-4 0v-.5a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5Z"/>',
  trash2: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  command: '<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0 0-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  entry: '<rect x="2" y="6" width="20" height="12" rx="2"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  table: '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/><path d="M8 7h6"/>',
  board: '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M12 8v4"/><path d="M8 16l4-4"/><path d="M16 16l-4-4"/>',
  brush: '<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>',
  paintBucket: '<path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2a2 2 0 0 0 2.8 0Z"/><path d="m5 2 5 5"/><path d="M2 13h15"/><path d="M22 17a5 5 0 0 1-10 0c0-2 5-7 5-7s5 5 5 7Z"/>',
  penTool: '<path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z"/><path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18"/><path d="m2.3 2.3 7.286 7.286"/><circle cx="11" cy="11" r="2"/>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  fileText: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  disc: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2"/>',
  fileQuestion: '<path d="M12 17h.01"/><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M9.1 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3"/>',
  layoutGrid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  layoutList: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/><path d="M14 4h7"/><path d="M14 9h7"/><path d="M14 15h7"/><path d="M14 20h7"/>',
  externalLink: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  columns: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  refreshCw: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  rotateCcw: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  minus: '<path d="M5 12h14"/>',
  arrowLeftS: '<path d="m15 18-6-6 6-6"/>',
  arrowRightS: '<path d="m9 18 6-6-6-6"/>',
  hash: '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
  checkSquare: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  tags: '<path d="m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4L17 19"/><path d="M9.586 5.586A2 2 0 0 0 8.172 5H3a1 1 0 0 0-1 1v5.172a2 2 0 0 0 .586 1.414L8.29 18.29a2.426 2.426 0 0 0 3.42 0l3.58-3.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="6.5" cy="9.5" r=".5" fill="currentColor"/>',
  link2: '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>',
  // 自動ルビの切り替え（親文字の上にルビの線）
  furigana: '<path d="M8 3h8"/><path d="M6 9h12"/><path d="M12 9v12"/><path d="M9 21h6"/>',
  alignLeft: '<line x1="21" x2="3" y1="6" y2="6"/><line x1="15" x2="3" y1="12" y2="12"/><line x1="17" x2="3" y1="18" y2="18"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  sigma: '<path d="M18 6H7.5l4.244 6L7.5 18H18"/>',
  messageSquare: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
  highlighter: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  eraser: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  lasso: '<path d="M7 22a5 5 0 0 1-2-4"/><path d="M7 16.93c.96.43 1.96.74 2.99.91"/><path d="M3.34 14A6.8 6.8 0 0 1 2 10c0-4.42 4.48-8 10-8s10 3.58 10 8-4.48 8-10 8a12 12 0 0 1-3.34-.46"/>',
  stickyNote: '<path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/>',
  squarePen: '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>',
  clipboardList: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  crosshair: '<circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/>',
  save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
  folderOpen: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  gitBranch: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  // Phase 1: テンプレート/チャート用アイコン
  barChart2: '<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>',
  layoutTemplate: '<rect width="18" height="7" x="3" y="3" rx="1"/><rect width="9" height="7" x="3" y="14" rx="1"/><rect width="5" height="7" x="16" y="14" rx="1"/>',
  lightbulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  mapPin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  bookOpen: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  package: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7"/><path d="m7.5 4.27 9 5.15"/>',
  skull: '<circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><path d="M8 20v2h8v-2"/><path d="m12.5 17-.5-1-.5 1h1z"/><path d="M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20"/>',
  alertTriangle: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  rows3: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  layoutDashboard: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  databaseSearch: '<ellipse cx="12" cy="5.5" rx="9" ry="3.5"/><path d="M3 12a9 3.5 0 0 0 5.16 3.18"/><path d="M3 5.5v13c0 1.93 4.03 3.5 9 3.5"/><path d="M21 5.5v4"/><circle cx="17.5" cy="16.5" r="3.5"/><path d="m21 20-1.5-1.5"/>',
  presentation: '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>',
  messagesSquare: '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4c0-1.1.9-2 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
  galleryThumbnails: '<rect width="18" height="14" x="3" y="3" rx="2"/><path d="M4 21h1"/><path d="M9 21h1"/><path d="M14 21h1"/><path d="M19 21h1"/>',
  clapperboard: '<path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  // v5.23: アイコン統一で追加
  settings2: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  slidersHorizontal: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  messageCircle: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  unlock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  circleAlert: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  circleX: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronUp: '<path d="m18 15-6-6-6 6"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  starOff: '<path d="M8.34 8.34 2 9.27l5 4.87L5.82 21 12 17.77 18.18 21l-.59-3.43"/><path d="M18.42 12.76 22 9.27l-6.91-1L12 2l-1.44 2.91"/><line x1="2" x2="22" y1="2" y2="22"/>',
  gripVertical: '<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
  maximize2: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/>',
  minimize2: '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" x2="21" y1="10" y2="3"/><line x1="3" x2="10" y1="21" y2="14"/>',
  square: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
  circle: '<circle cx="12" cy="12" r="10"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  helpCircle: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/>',
  circleDot: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>',
  circlePlus: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  ellipsis: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  arrowUpDown: '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  tvMinimal: '<rect width="18" height="14" x="3" y="3" rx="2"/><path d="M4 21h1"/><path d="M9 21h1"/><path d="M14 21h1"/><path d="M19 21h1"/>',
  lockOpen: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  // アイコン整備 v0.5.130（icon-implementation-plan §1）
  bookOpenText: '<path d="M12 7v14"/><path d="M16 12h2"/><path d="M16 8h2"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/><path d="M6 12h2"/><path d="M6 8h2"/>',
  folderDot: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><circle cx="12" cy="13" r="1"/>',
  folderOpenDot: '<path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/><circle cx="14" cy="15" r="1"/>',
  alignHorizontalJustifyStart: '<rect width="6" height="14" x="6" y="5" rx="2"/><rect width="6" height="10" x="16" y="7" rx="2"/><path d="M2 2v20"/>',
  alignHorizontalJustifyCenter: '<rect width="6" height="14" x="2" y="5" rx="2"/><rect width="6" height="10" x="16" y="7" rx="2"/><path d="M12 2v20"/>',
  alignHorizontalJustifyEnd: '<rect width="6" height="14" x="2" y="5" rx="2"/><rect width="6" height="10" x="12" y="7" rx="2"/><path d="M22 2v20"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  arrowDown: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  folderPlus: '<path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  // ツールバー統一 v0.5.131 (toolbar-unification-plan §4-2)
  bold: '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>',
  italic: '<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>',
  underline: '<path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" x2="20" y1="20" y2="20"/>',
  strikethrough: '<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/>',
  list: '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
  listOrdered: '<line x1="10" x2="21" y1="6" y2="6"/><line x1="10" x2="21" y1="12" y2="12"/><line x1="10" x2="21" y1="18" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  quote: '<path d="M16 3a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2v-4a2 2 0 0 1 2-2V5a4 4 0 0 0-4 4v6a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"/><path d="M8 3a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6v-4a2 2 0 0 1 2-2V5a4 4 0 0 0-4 4v6a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"/>',
  heading: '<path d="M6 12h12"/><path d="M6 20V4"/><path d="M18 20V4"/>',
  wrapText: '<line x1="3" y1="6" x2="21" y2="6"/><path d="M3 12h15a3 3 0 1 1 0 6h-4"/><polyline points="16 16 14 18 16 20"/><line x1="3" y1="18" x2="10" y2="18"/>',
  calendarPlus: '<path d="M8 2v4"/><path d="M16 2v4"/><path d="M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8"/><path d="M3 10h18"/><path d="M16 19h6"/><path d="M19 16v6"/>',
  listChecks: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  zoomIn: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>',
  zoomOut: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  timer: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
  calendarDays: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>',
  calendarRange: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M3 10h18"/><path d="M8 2v4"/><path d="M17 14h-6"/><path d="M13 18H7"/><path d="M7 14h.01"/><path d="M17 18h.01"/>',
  bookmarkPlus: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/><line x1="12" x2="12" y1="7" y2="13"/><line x1="15" x2="9" y1="10" y2="10"/>',
  clipboardCheck: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  // 書式系追加 v0.5.147（書字方向・インデント・引用の専用アイコン）
  textAlignStart: '<path d="M15 12H3"/><path d="M17 18H3"/><path d="M21 6H3"/>',
  kanban: '<path d="M6 5v11"/><path d="M12 5v6"/><path d="M18 5v14"/>',
  indentIncrease: '<polyline points="3 8 7 12 3 16"/><line x1="21" x2="11" y1="12" y2="12"/><line x1="21" x2="11" y1="6" y2="6"/><line x1="21" x2="11" y1="18" y2="18"/>',
  textQuote: '<path d="M17 6H3"/><path d="M21 12H8"/><path d="M21 18H8"/><path d="M3 12v6"/>',
  pipette: '<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>',
  // 取り消し・やり直しボタン展開 v0.6.196（undo-redo-toolbar-plan フェーズ1-3）
  undo2: '<path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />',
  redo2: '<path d="m15 14 5-5-5-5" /><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" />',
  workflow: '<rect width="8" height="8" x="3" y="3" rx="2" /><path d="M7 11v4a2 2 0 0 0 2 2h4" /><rect width="8" height="8" x="13" y="13" rx="2" />',
};
// gb-icon-assets.js (hasLucideName) が独自アイコン (page / db / scenario 等) を
// 解決できるよう、curated LUCIDE を window に公開する。これが無いと
// GBIconAssets.render() がテキストフォールバックに落ちてボタンアイコンが壊れる。
if (typeof window !== 'undefined') window.LUCIDE = LUCIDE;

function lucide(name, size) {
  size = size || 14;
  let paths = LUCIDE[name];
  if (paths == null && typeof window !== 'undefined' && window.LUCIDE_FULL) {
    paths = window.LUCIDE_FULL[name];
  }
  paths = paths || '';
  // アイコン名は保存データ（ビュー設定等）から来ることがあるため、属性へは安全な文字だけを書く。
  const safeName = String(name ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  size = String(size).replace(/[^0-9A-Za-z.%]/g, '') || 14;
  return `<svg data-icon="${safeName}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;">${paths}</svg>`;
}

// メニュー選択状態アイコン
function radioMark(selected) {
  return selected ? '<span style="color:var(--accent);">' + lucide('check', 12) + '</span> ' : '　';
}

// サブメニュー展開矢印（▸の代替）
function submenuArrow() {
  return '<span style="float:right;opacity:0.5;margin-left:8px;line-height:1;">' + lucide('chevronRight', 10) + '</span>';
}

const UI_TYPE_ICONS = {
  folder: 'folder',
  database: 'db',
  entity: 'entry',
  page: 'page',
  scenario: 'scenario',
  scriptnote: 'bookOpenText',
  board: 'presentation',
  calendar: 'calendar',
  preview: 'tvMinimal',
  subpanel: 'panelRightDashed',
  detail: 'slidersHorizontal',
  info: 'info',
  information: 'info',
  backlinks: 'fileSymlink',
  'file-theme': 'palette',
  chat: 'messagesSquare',
  tags: 'tag',
  annotation: 'squarePen',
  sticky: 'clipboardList', 'form-app': 'clipboardList',
  map: 'map',
  history: 'history',
  media: 'galleryThumbnails',
  html: 'globe',
  csv: 'table',
  pivot: 'db',
  gallery: 'db',
  kanban: 'db',
  timeline: 'db',
  chart: 'db',
  graph: 'db',
  compare: 'columns',
  outliner: 'folderTree',
  welcome: 'folder',
};

function uiTypeIconName(type) {
  return UI_TYPE_ICONS[type] || '';
}

// 主要アプリツールバー左端のアプリアイコン＝メインメニューボタン（UI共通ルール19「ツールバー」）。
// どのアプリを開いているかを一目で見分けるため、タブ・フォルダツリーと同じ種別アイコンを
// uiTypeIconName() から引き、ツールバーの他のアイコンより大きく出す。押すと、そのアプリの
// メインメニュー（旧☰メニューと同じ項目）を開く。☰ボタンと「フォルダツリーで表示」ボタンは置かない。
const UI_TOOLBAR_APP_ICON_LABELS = {
  database: 'シート',
  page: 'ノート',
  scriptnote: 'シナリオ',
  board: 'ボード',
  calendar: 'スケジュール',
  'form-app': 'フォーム',
  map: 'マップ',
  csv: 'CSV',
  folder: 'フォルダ',
  media: 'ビューワー',
  'quick-memo': 'クイックメモ',
};
const UI_TOOLBAR_APP_ICON_EXTRA = { 'quick-memo': 'notebookPen' };
const UI_TOOLBAR_APP_ICON_SIZE = 24;
const UI_TOOLBAR_MAIN_MENU_TITLE = 'メインメニュー';

function toolbarAppIconName(type) {
  return uiTypeIconName(type) || UI_TOOLBAR_APP_ICON_EXTRA[type] || '';
}

// メインメニューボタンの右下に付けるメニューの印。左隣のファイルアイコン（既定ではアプリと同じ種別のアイコン）と
// 役割を見分けられるようにする（2026-11-21。同じアイコンが2つ並んでいた）。寸法は変えない（重ねて表示する）。
function toolbarMainMenuCaretHtml() {
  return `<span class="tb-main-menu-caret" aria-hidden="true">${lucide('chevronDown', 10)}</span>`;
}

function toolbarMainMenuLabel(type) {
  const label = UI_TOOLBAR_APP_ICON_LABELS[String(type ?? '')] || '';
  return label ? `${label}のメインメニュー` : UI_TOOLBAR_MAIN_MENU_TITLE;
}

// options.menu: 旧☰と同じ showToolMenu(event, toolType) を開く種別。省略時は toolType=type。
// options.menu === false の時だけ、操作を持たない目印（role="img"）を返す（現役の呼び出しはない）。
function toolbarAppIconHtml(type, options) {
  const key = String(type ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  const name = toolbarAppIconName(key);
  const svg = name ? lucide(name, UI_TOOLBAR_APP_ICON_SIZE) : '';
  if (options?.menu === false) {
    const label = UI_TOOLBAR_APP_ICON_LABELS[key] || '';
    return `<span class="tb-app-icon" data-app-icon="${key}" role="img" aria-label="${label}">${svg}</span>`;
  }
  const menuType = String(options?.menu || key).replace(/[^A-Za-z0-9_-]/g, '');
  const action = options?.action === false ? '' : ` data-action="showToolMenu(event,'${menuType}')"`;
  return `<button type="button" class="tb-app-icon tb-main-menu-btn tool-menu-btn" data-app-icon="${key}" data-main-menu="${menuType}" data-gb-tooltip-key="toolbar.mainMenu"`
    + ` title="${UI_TOOLBAR_MAIN_MENU_TITLE}" aria-label="${toolbarMainMenuLabel(key)}" aria-haspopup="menu" aria-expanded="false"${action}>${svg}${toolbarMainMenuCaretHtml()}</button>`;
}

// JSで組むツールバー用。onClick を渡すとその処理で開く（マップ・フォームのように部品を渡す場合）。
function toolbarAppIconElement(type, options) {
  const template = document.createElement('template');
  const onClick = typeof options?.onClick === 'function' ? options.onClick : null;
  template.innerHTML = toolbarAppIconHtml(type, onClick ? { ...options, action: false } : options);
  const el = template.content.firstElementChild;
  if (el && onClick) el.addEventListener('click', onClick);
  return el;
}

// 静的HTMLに置いた空の .tb-app-icon を埋める。メインメニューボタン（button）の名前・状態も揃える。
function hydrateToolbarAppIcons(root) {
  const scope = root?.querySelectorAll ? root : document;
  const nodes = [];
  if (scope.matches?.('.tb-app-icon[data-app-icon]')) nodes.push(scope);
  scope.querySelectorAll('.tb-app-icon[data-app-icon]').forEach(el => nodes.push(el));
  nodes.forEach(el => {
    const key = el.getAttribute('data-app-icon') || '';
    if (!el.querySelector('svg')) {
      const name = toolbarAppIconName(key);
      if (name) el.innerHTML = lucide(name, UI_TOOLBAR_APP_ICON_SIZE);
    }
    if (el.tagName === 'BUTTON') {
      // 同じ値でも書くと変更通知が積まれる（あふれ判定等の監視と押し合う）ため、足りない時だけ書く。
      if (!el.classList.contains('tb-main-menu-btn')) el.classList.add('tb-main-menu-btn');
      if (!el.querySelector('.tb-main-menu-caret')) el.insertAdjacentHTML('beforeend', toolbarMainMenuCaretHtml());
      if (!el.dataset.gbTooltipKey) el.dataset.gbTooltipKey = 'toolbar.mainMenu';
      if (!el.getAttribute('title')) el.setAttribute('title', UI_TOOLBAR_MAIN_MENU_TITLE);
      if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', toolbarMainMenuLabel(key));
      if (!el.hasAttribute('aria-haspopup')) el.setAttribute('aria-haspopup', 'menu');
      if (!el.hasAttribute('aria-expanded')) el.setAttribute('aria-expanded', 'false');
      return;
    }
    if (!el.hasAttribute('role')) el.setAttribute('role', 'img');
    if (!el.getAttribute('aria-label') && UI_TOOLBAR_APP_ICON_LABELS[key]) el.setAttribute('aria-label', UI_TOOLBAR_APP_ICON_LABELS[key]);
  });
}
if (typeof window !== 'undefined') {
  window.toolbarAppIconHtml = toolbarAppIconHtml;
  window.toolbarAppIconElement = toolbarAppIconElement;
  window.toolbarMainMenuLabel = toolbarMainMenuLabel;
  window.hydrateToolbarAppIcons = hydrateToolbarAppIcons;
}

function fileTypeIcon(type, size) {
  const map = {
    image: 'image', video: 'video', audio: 'audio',
    psd: 'brush', clip: 'penTool', '3d': 'box', document: 'fileText',
    archive: 'archive', app: 'settings', unknown: 'fileQuestion',
  };
  return lucide(uiTypeIconName(type) || map[type] || 'fileQuestion', size || 36);
}

function replaceIcons(root) {
  const scope = root?.querySelectorAll ? root : document;
  hydrateToolbarAppIcons(scope);
  scope.querySelectorAll('.ico').forEach(el => {
    const cls = el.className;
    let name = '';
    if (cls.includes('ico-folderTree')) name = 'folderTree';
    else if (cls.includes('ico-folderPen')) name = 'folderPen';
    else if (cls.includes('ico-folderOpen')) name = 'folderOpen';
    else if (cls.includes('ico-folder')) name = 'folder';
    else if (cls.includes('ico-page')) name = 'page';
    else if (cls.includes('ico-db')) name = 'db';
    else if (cls.includes('ico-scenario')) name = 'scenario';
    else if (cls.includes('ico-databaseSearch')) name = 'databaseSearch';
    else if (cls.includes('ico-command')) name = 'command';
    else if (cls.includes('ico-search')) name = 'search';
    else if (cls.includes('ico-bookOpenText')) name = 'bookOpenText';
    else if (cls.includes('ico-book')) name = 'book';
    else if (cls.includes('ico-download')) name = 'download';
    else if (cls.includes('ico-globe')) name = 'globe';
    else if (cls.includes('ico-upload')) name = 'upload';
    else if (cls.includes('ico-board')) name = 'presentation';
    else if (cls.includes('ico-preview') || cls.includes('ico-tvMinimal')) name = 'tvMinimal';
    else if (cls.includes('ico-detail')) name = 'slidersHorizontal';
    else if (cls.includes('ico-info')) name = 'info';
    else if (cls.includes('ico-settings2') || cls.includes('ico-slidersHorizontal')) name = 'slidersHorizontal';
    else if (cls.includes('ico-gear') || cls.includes('ico-settings')) name = 'settings';
    else if (cls.includes('ico-sync')) name = 'sync';
    else if (cls.includes('ico-panelRight')) name = 'panelRight';
    else if (cls.includes('ico-panelLeft')) name = 'panelLeft';
    else if (cls.includes('ico-listCollapse')) name = 'listCollapse';
    // ビューワー残課題修正計画 2026-08-04: 反転2種・回転（ビューワーの左右反転/上下反転/回転ボタン）
    else if (cls.includes('ico-flipHorizontal2')) name = 'flipHorizontal2';
    else if (cls.includes('ico-flipVertical2')) name = 'flipVertical2';
    else if (cls.includes('ico-rotateCw')) name = 'rotateCw';
    else if (cls.includes('ico-layoutGrid')) name = 'layoutDashboard';
    else if (cls.includes('ico-layoutList')) name = 'layoutList';
    else if (cls.includes('ico-externalLink')) name = 'externalLink';
    else if (cls.includes('ico-filter')) name = 'filter';
    else if (cls.includes('ico-copy')) name = 'copy';
    else if (cls.includes('ico-arrowUpDown')) name = 'arrowUpDown';
    else if (cls.includes('ico-arrowUp')) name = 'arrowUp';
    else if (cls.includes('ico-arrowDown')) name = 'arrowDown';
    else if (cls.includes('ico-play')) name = 'play';
    else if (cls.includes('ico-refreshCw')) name = 'refreshCw';
    else if (cls.includes('ico-minus')) name = 'minus';
    else if (cls.includes('ico-columns3') || cls.includes('ico-columns')) name = 'columns';
    else if (cls.includes('ico-clock')) name = 'clock';
    else if (cls.includes('ico-arrowLeftS')) name = 'arrowLeftS';
    else if (cls.includes('ico-arrowRightS')) name = 'arrowRightS';
    else if (cls.includes('ico-pencil')) name = 'pencil';
    else if (cls.includes('ico-highlighter')) name = 'highlighter';
    else if (cls.includes('ico-lasso')) name = 'lasso';
    else if (cls.includes('ico-square')) name = 'square';
    else if (cls.includes('ico-eraser')) name = 'eraser';
    else if (cls.includes('ico-stickyNote')) name = 'stickyNote';
    else if (cls.includes('ico-squarePen')) name = 'squarePen';
    else if (cls.includes('ico-clipboardList')) name = 'clipboardList';
    else if (cls.includes('ico-trash2')) name = 'trash2';
    else if (cls.includes('ico-crosshair')) name = 'crosshair';
    else if (cls.includes('ico-save')) name = 'save';
    else if (cls.includes('ico-bot')) name = 'bot';
    else if (cls.includes('ico-users')) name = 'users';
    else if (cls.includes('ico-user')) name = 'user';
    else if (cls.includes('ico-messagesSquare') || cls.includes('ico-messageSquare')) name = 'messagesSquare';
    else if (cls.includes('ico-paperclip')) name = 'paperclip';
    else if (cls.includes('ico-mic')) name = 'mic';
    else if (cls.includes('ico-fileText')) name = 'fileText';
    else if (cls.includes('ico-calendarPlus')) name = 'calendarPlus';
    else if (cls.includes('ico-calendarDays')) name = 'calendarDays';
    else if (cls.includes('ico-calendarRange')) name = 'calendarRange';
    else if (cls.includes('ico-calendarSync')) name = 'calendarSync';
    else if (cls.includes('ico-calendar')) name = 'calendar';
    else if (cls.includes('ico-arrowRight')) name = 'arrowRight';
    else if (cls.includes('ico-arrowLeft')) name = 'arrowLeft';
    else if (cls.includes('ico-filePlus')) name = 'filePlus';
    else if (cls.includes('ico-plus')) name = 'plus';
    else if (cls.includes('ico-eyeOff')) name = 'eyeOff';
    else if (cls.includes('ico-eye')) name = 'eye';
    else if (cls.includes('ico-camera')) name = 'camera';
    else if (cls.includes('ico-gitBranch')) name = 'gitBranch';
    else if (cls.includes('ico-history')) name = 'history';
    else if (cls.includes('ico-x')) name = 'x';
    else if (cls.includes('ico-chevronDown')) name = 'chevronDown';
    else if (cls.includes('ico-chevronRight')) name = 'chevronRight';
    else if (cls.includes('ico-chevronLeft')) name = 'chevronLeft';
    else if (cls.includes('ico-lightbulb')) name = 'lightbulb';
    else if (cls.includes('ico-menu')) name = 'menu';
    else if (cls.includes('ico-checkSquare')) name = 'checkSquare';
    else if (cls.includes('ico-unlock')) name = 'unlock';
    else if (cls.includes('ico-lock')) name = 'lock';
    else if (cls.includes('ico-alignLeft')) name = 'alignLeft';
    else if (cls.includes('ico-helpCircle')) name = 'helpCircle';
    // ツールバー統一 v0.5.131 (toolbar-unification-plan §4-2)
    else if (cls.includes('ico-bold')) name = 'bold';
    else if (cls.includes('ico-italic')) name = 'italic';
    else if (cls.includes('ico-underline')) name = 'underline';
    else if (cls.includes('ico-strikethrough')) name = 'strikethrough';
    else if (cls.includes('ico-listOrdered')) name = 'listOrdered';
    else if (cls.includes('ico-list')) name = 'list';
    else if (cls.includes('ico-quote')) name = 'quote';
    else if (cls.includes('ico-heading')) name = 'heading';
    else if (cls.includes('ico-wrapText')) name = 'wrapText';
    else if (cls.includes('ico-listChecks')) name = 'listChecks';
    else if (cls.includes('ico-zoomIn')) name = 'zoomIn';
    else if (cls.includes('ico-zoomOut')) name = 'zoomOut';
    // ico-maximize2 は ico-maximize の部分文字列一致で全画面アイコンに化けるため、先に判定する
    // （ビューワーのフィットボタン初期表示バグ修正 2026-08-04）
    else if (cls.includes('ico-maximize2')) name = 'maximize2';
    else if (cls.includes('ico-maximize')) name = 'maximize';
    else if (cls.includes('ico-fileCog')) name = 'fileCog';
    else if (cls.includes('ico-timer')) name = 'timer';
    else if (cls.includes('ico-layoutTemplate')) name = 'layoutTemplate';
    else if (cls.includes('ico-rows3')) name = 'rows3';
    else if (cls.includes('ico-bookmarkPlus')) name = 'bookmarkPlus';
    else if (cls.includes('ico-bookmark')) name = 'bookmark';
    else if (cls.includes('ico-clipboardCheck')) name = 'clipboardCheck';
    else if (cls.includes('ico-disc')) name = 'disc';
    else if (cls.includes('ico-funnel')) name = 'funnel';
    else if (cls.includes('ico-scanText')) name = 'scanText';
    else if (cls.includes('ico-textCursorInput')) name = 'textCursorInput';
    else if (cls.includes('ico-type')) name = 'type';
    else if (cls.includes('ico-table')) name = 'table';
    // 右レール タグパネル等のタグアイコン（ico-tags は ico-tag より前に置く）
    else if (cls.includes('ico-tags')) name = 'tags';
    else if (cls.includes('ico-tag')) name = 'tag';
    // v0.5.147 書字方向・インデント・引用
    else if (cls.includes('ico-textAlignStart')) name = 'textAlignStart';
    else if (cls.includes('ico-kanban')) name = 'kanban';
    else if (cls.includes('ico-indentIncrease')) name = 'indentIncrease';
    else if (cls.includes('ico-textQuote')) name = 'textQuote';
    // 取り消し・やり直しボタン展開 v0.6.196
    else if (cls.includes('ico-undo2')) name = 'undo2';
    else if (cls.includes('ico-redo2')) name = 'redo2';
    // 単独アプリパリティ v0.6.200（シナリオ/ボードのエクスポートメニュー用アイコン）
    else if (cls.includes('ico-image')) name = 'image';
    // クイックメモの作成メニュー「動画」(ico-video)が未登録で空アイコンになっていたため追加。
    else if (cls.includes('ico-video')) name = 'video';
    else if (cls.includes('ico-fileCode')) name = 'fileCode';
    else if (cls.includes('ico-clipboardCopy')) name = 'clipboardCopy';
    // 管理者AIの稼働表示とワークスペースチャットの整理 計画 Phase 4: 「管理者AIに依頼」
    // ボタン(ico-terminal)が未登録で常に空アイコンになっていたため追加。
    else if (cls.includes('ico-terminal')) name = 'terminal';
    // ツールバーの自動ルビの切り替え（2026-11-21）
    else if (cls.includes('ico-furigana')) name = 'furigana';
    if (name) {
      // ツールバー内のアイコンは 16px に統一 (toolbar-unification-plan §2-2)
      const inToolbar = el.closest('.gb-toolbar, .tb-icon-btn, .tb-text-btn');
      const iconSize = inToolbar ? 16 : 18;
      const html = lucide(name, iconSize);
      // 同じ絵がすでに描かれていれば描き直さない。描き直すと押している最中のボタンの中身が差し替わり、
      // クリックが届かなくなる（オプションの描き直しなどページ全体を対象にした呼び出しで起きていた）。
      if (el._gbIcoHtml === html && el._gbIcoNode && el.firstElementChild === el._gbIcoNode && el.childNodes.length === 1) return;
      el.innerHTML = html;
      el._gbIcoHtml = html;
      el._gbIcoNode = el.firstElementChild;
      // ツールバー外の旧互換アイコンだけインラインサイズを補完する
      if (!inToolbar) {
        el.style.width = '18px';
        el.style.height = '18px';
        el.style.display = 'inline-block';
      }
    }
  });
}

// ============================================================
// テーマ
// ============================================================

// 親ウィンドウ（Meldex）からテーマを継承
function inheritParentTheme() {
  try {
    const parentComputed = window.parent.getComputedStyle(window.parent.document.documentElement);
    const themeVars = ['--bg', '--bg2', '--bg3', '--bg4', '--fg', '--fg2', '--accent', '--accent2', '--border', '--red', '--green', '--orange', '--blue', '--selection', '--link-fg', '--page-link-fg', '--ui-header-fg', '--ui-header-bg', '--ui-header-font', '--ui-toolbar-fg', '--ui-toolbar-bg', '--ui-toolbar-font', '--ui-muted-font', '--ui-hover-fg', '--ui-hover-bg', '--ui-fg-strong', '--ui-selection-fg', '--ui-selection-bg', '--ui-range-fill-bg', '--ui-range-track-bg', '--db-th-font', '--db-entity-font', '--db-cell-font'];
    themeVars.forEach(v => {
      const val = parentComputed.getPropertyValue(v).trim();
      if (val) document.documentElement.style.setProperty(v, val);
    });
  } catch(e) { /* cross-origin or same window */ }
}

// テーマをAPI経由で取得（iframe以外の単独起動用）
// テーマは editor-theme-name で管理されているため、meldex-theme-vars は不要
async function loadThemeFromServer() {
  try {
    const manager = window.MeldexThemeManager;
    if (!manager?.applyDefaultTheme) return;
    const themeId = typeof manager.getDefaultThemeId === 'function'
      ? manager.getDefaultThemeId()
      : (localStorage.getItem('meldex-default-theme-id') || localStorage.getItem('editor-theme-name') || '');
    manager.applyDefaultTheme(themeId, { silent: true, preserveStoredThemeUi: true, skipHistory: true });
  } catch (error) {
    try { console.warn('テーマを復元できませんでした', error); } catch {}
  }
}

// ============================================================
// 初期化ヘルパー
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  // 親がMeldexならテーマ継承、単独起動ならlocalStorageから復元
  if (window.parent !== window) {
    inheritParentTheme();
  } else {
    loadThemeFromServer();
  }
  // アイコン置換
  replaceIcons();
});


/* === meldex-core.part02.js === */
/* meldex-core.part02.js */
function closeColHeaderMenu() {
  document.querySelectorAll('.gb-context-menu').forEach(el => el.remove());
}

function _normalizeCoreAnnotationOpacity(value, fallback = 1) {
  const opacity = Number(value);
  if (!Number.isFinite(opacity)) return fallback;
  return Math.max(0, Math.min(1, opacity));
}

function _coreAnnotationDistanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  if (!dx && !dy) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function _coreAnnotationElementHit(el, x, y, tolerance = 10) {
  try {
    const point = new DOMPoint(x, y);
    if (typeof el.isPointInStroke === 'function' && el.isPointInStroke(point)) return true;
    if (typeof el.isPointInFill === 'function' && el.isPointInFill(point)) return true;
  } catch {}
  if (el?.tagName?.toLowerCase?.() === 'rect') {
    const rx = Number(el.getAttribute('x')) || 0;
    const ry = Number(el.getAttribute('y')) || 0;
    const rw = Number(el.getAttribute('width')) || 0;
    const rh = Number(el.getAttribute('height')) || 0;
    return x >= rx - tolerance && x <= rx + rw + tolerance && y >= ry - tolerance && y <= ry + rh + tolerance;
  }
  if (typeof el.getTotalLength === 'function' && typeof el.getPointAtLength === 'function') {
    try {
      const total = el.getTotalLength();
      const step = Math.max(4, total / 80);
      for (let pos = 0; pos <= total; pos += step) {
        const a = el.getPointAtLength(pos);
        const b = el.getPointAtLength(Math.min(total, pos + step));
        if (_coreAnnotationDistanceToSegment(x, y, a.x, a.y, b.x, b.y) <= tolerance) return true;
      }
    } catch {}
  }
  const points = (el.getAttribute('points') || '').trim().split(/\s+/)
    .map(pair => pair.split(',').map(Number))
    .filter(pair => Number.isFinite(pair[0]) && Number.isFinite(pair[1]));
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (b && _coreAnnotationDistanceToSegment(x, y, a[0], a[1], b[0], b[1]) <= tolerance) return true;
  }
  return false;
}

// ============================================================
// iframe内蔵メモエンジン
// ============================================================

/**
 * initIframeMarkup(): iframe内にメモオーバーレイを設置
 * 親からpostMessageでツール状態を受信し、描画結果を親に送信
 * 親側は ann-markup-sync / ann-markup-save で同期
 */
function initIframeMarkup(scrollContainer, options = {}) {
  const _svgNS = 'http://www.w3.org/2000/svg';
  const _widthDefaults = { pen: 3, marker: 12, eraser: 14 };
  function _loadToolWidths() {
    try {
      const saved = JSON.parse(localStorage.getItem('meldex-ann-tool-widths') || '{}');
      return {
        pen: Math.max(1, Math.min(16, Number(saved.pen) || _widthDefaults.pen)),
        marker: Math.max(4, Math.min(40, Number(saved.marker) || _widthDefaults.marker)),
        eraser: Math.max(4, Math.min(48, Number(saved.eraser) || _widthDefaults.eraser)),
      };
    } catch { return { ..._widthDefaults }; }
  }
  let _ann = { active: false, tool: 'pen', color: '#c48080', opacity: 1, widths: _loadToolWidths(), drawing: false, path: [], pressures: [], targetPath: '', anchor: null };

  // オーバーレイSVG作成
  const host = scrollContainer || document.body;
  const boardWorld = (host?.id === 'bd-canvas' || host?.dataset?.bdRole === 'canvas')
    ? (host.querySelector('[data-bd-role="world"]') || host.querySelector('#bd-world'))
    : null;
  const wrapper = boardWorld || host;
  const boardMode = !!boardWorld || wrapper?.id === 'bd-world' || wrapper?.dataset?.bdRole === 'world';
  if (host._annBridge) { Object.assign(host._annBridge.options || {}, options); return host._annBridge; }
  if (wrapper._annBridge) {
    Object.assign(wrapper._annBridge.options || {}, options);
    if (host !== wrapper) host._annBridge = wrapper._annBridge;
    return wrapper._annBridge;
  }
  wrapper.style.position = wrapper.style.position || 'relative';
  const svg = document.createElementNS(_svgNS, 'svg');
  svg.id = 'iframe-ann-overlay';
  svg.style.touchAction = 'none';
  svg.setAttribute('style', 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:9999;pointer-events:none;overflow:visible;touch-action:none;');
  const hitRect = document.createElementNS(_svgNS, 'rect');
  hitRect.setAttribute('width', '100%'); hitRect.setAttribute('height', '100%');
  hitRect.setAttribute('fill', 'transparent');
  svg.appendChild(hitRect);
  const layer = document.createElementNS(_svgNS, 'g');
  layer.id = 'iframe-ann-layer';
  svg.appendChild(layer);
  const notesLayer = document.createElement('div');
  notesLayer.className = 'ann-note-layer';
  notesLayer.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:10000;';
  wrapper.appendChild(svg);
  wrapper.appendChild(notesLayer);

  // SVGサイズ更新
  let _surfaceBounds = { left: 0, top: 0, width: 1, height: 1 };
  function _computeSurfaceBounds() {
    if (!boardMode) {
      return {
        left: 0,
        top: 0,
        width: Math.max(wrapper.scrollWidth || 0, wrapper.clientWidth || 0, 1),
        height: Math.max(wrapper.scrollHeight || 0, wrapper.clientHeight || 0, 1),
      };
    }
    const viewportW = Math.max(host.clientWidth || 0, host.offsetWidth || 0, 1);
    const viewportH = Math.max(host.clientHeight || 0, host.offsetHeight || 0, 1);
    const zoom = (typeof bd !== 'undefined') ? Math.max(0.1, bd.zoom || 1) : 1;
    const panX = (typeof bd !== 'undefined') ? (Number(bd.panX) || 0) : 0;
    const panY = (typeof bd !== 'undefined') ? (Number(bd.panY) || 0) : 0;
    let visibleLeft = -panX / zoom;
    let visibleTop = -panY / zoom;
    let visibleRight = visibleLeft + viewportW / zoom;
    let visibleBottom = visibleTop + viewportH / zoom;
    if (typeof host.getBoundingClientRect === 'function') {
      try {
        const r = host.getBoundingClientRect();
        const pts = [
          _boardClientToWorld(r.left, r.top),
          _boardClientToWorld(r.right, r.top),
          _boardClientToWorld(r.right, r.bottom),
          _boardClientToWorld(r.left, r.bottom),
        ].filter(pt => Number.isFinite(pt?.x) && Number.isFinite(pt?.y));
        if (pts.length) {
          visibleLeft = Math.min(...pts.map(pt => pt.x));
          visibleTop = Math.min(...pts.map(pt => pt.y));
          visibleRight = Math.max(...pts.map(pt => pt.x));
          visibleBottom = Math.max(...pts.map(pt => pt.y));
        }
      } catch (_) {}
    }
    const pad = 256;
    const left = Math.floor(Math.min(0, visibleLeft) - pad);
    const top = Math.floor(Math.min(0, visibleTop) - pad);
    const right = Math.ceil(Math.max(wrapper.scrollWidth || 0, wrapper.clientWidth || 0, visibleRight, viewportW / zoom) + pad);
    const bottom = Math.ceil(Math.max(wrapper.scrollHeight || 0, wrapper.clientHeight || 0, visibleBottom, viewportH / zoom) + pad);
    return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
  }
  function _applyNotePosition(note, data) {
    if (!note || !data) return;
    note.style.left = ((Number(data.x) || 0) - _surfaceBounds.left) + 'px';
    note.style.top = ((Number(data.y) || 0) - _surfaceBounds.top) + 'px';
  }
  function _boardClientToWorld(clientX, clientY) {
    const targetCanvas = host || wrapper;
    if (!targetCanvas) return { x: clientX, y: clientY };
    const local = (typeof bdClientToCanvasLocal === 'function')
      ? bdClientToCanvasLocal(clientX, clientY, targetCanvas)
      : (() => {
          const r = targetCanvas.getBoundingClientRect();
          return { x: clientX - r.left, y: clientY - r.top };
        })();
    let lx = local.x;
    let ly = local.y;
    if (typeof bd !== 'undefined' && bd.rotation) {
      const cx = targetCanvas.clientWidth / 2;
      const cy = targetCanvas.clientHeight / 2;
      lx -= cx;
      ly -= cy;
      const rad = -bd.rotation * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rx = lx * cos - ly * sin;
      const ry = lx * sin + ly * cos;
      lx = rx + cx;
      ly = ry + cy;
    }
