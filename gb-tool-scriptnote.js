/* ==============================
   gb-tool-scriptnote.js: シナリオエディタ v2 (軽量段落ベース)
   シナリオエンジンに依存しない、Word方式の段落エディタ
   ============================== */

function _sn2IsFreshBlankDoc(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  return Array.isArray(parsed.rows) && parsed.rows.length === 0
    && Array.isArray(parsed.characters) && parsed.characters.length === 0
    && (!Array.isArray(parsed.scenarioTypes) || parsed.scenarioTypes.length === 0)
    && Array.isArray(parsed.notes) && parsed.notes.length === 0
    && !parsed?.source?.importedFrom;
}

function _sn2ExpandDefaultFileStyle(parsed) {
  if (!_sn2IsFreshBlankDoc(parsed)) return;
  if (typeof _getDefaultFileStyle !== 'function') return;
  const defaults = _getDefaultFileStyle('scriptnote');
  const style = (typeof _filterScriptnoteFileStyle === 'function')
    ? _filterScriptnoteFileStyle(defaults)
    : {};
  if (!Object.keys(style).length) return;
  const current = (typeof _filterScriptnoteFileStyle === 'function')
    ? _filterScriptnoteFileStyle(parsed.editor || {})
    : {};
  const hasExplicitStyle = Object.entries(current).some(([key, value]) => {
    if (key === 'wrapMode' && value === true) return false;
    return true;
  });
  if (hasExplicitStyle) return;
  parsed.editor = parsed.editor || {};
  Object.assign(parsed.editor, JSON.parse(JSON.stringify(style)));
}

// サーバーから読んだシナリオの本文を解釈する。BOM（UTF-8 の先頭印）を除き、シナリオの拡張子
// （.mel-scenario / .scriptnote.json）で fileType の無い現行形（rows の配列を持つ）は、ほかの
// 読込（AI の文脈読込・一覧の判定）と同じくシナリオとして扱う（S5。保存時に fileType が付く）。
function _sn2ParseScenarioContent(content, path = '') {
  const text = String(content || '{}').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(text || '{}');
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    && !Object.prototype.hasOwnProperty.call(parsed, 'fileType')
    && Array.isArray(parsed.rows)
    && /\.(?:mel-scenario|scriptnote\.json)$/i.test(String(path || ''))
    && typeof SCRIPTNOTE_FILE_TYPE === 'string') {
    parsed.fileType = SCRIPTNOTE_FILE_TYPE;
  }
  return parsed;
}

// フォルダツリーの行は絶対パスを持つことがあり、エディタのパス（ワークスペース相対）と一致しない。
// 同じファイルを指すツリーの行のパスを返す（完全一致、または末尾が「/相対パス」で一意な時だけ）。
function _sn2TreePathsForFile(path) {
  const norm = value => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const wanted = norm(path).toLowerCase();
  if (!wanted) return [];
  const found = new Set();
  document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node, #body-workspaces .tree-node').forEach((node) => {
    const raw = node._nodeData?.path;
    if (!raw) return;
    const key = norm(raw).toLowerCase();
    if (key === wanted || key.endsWith('/' + wanted)) found.add(raw);
  });
  const paths = Array.from(found);
  const exact = paths.filter(p => norm(p).toLowerCase() === wanted);
  if (exact.length) return exact;
  const distinct = new Set(paths.map(p => norm(p).toLowerCase()));
  return distinct.size === 1 ? paths : [];
}

// 改名・移動（oldPath → newPath）に合わせて、開いているファイルのパス current を付け替える。
// 相対パス（ワークスペース相対）と絶対パスの表記違いも、フォルダの区切りで末尾が一致すれば同じとみなす。
// 戻り値: { path: 新しいパス（current と同じ表記の種類）, exact: ファイル自体の改名か } または null
function _sn2MapRenamedFilePath(current, oldPath, newPath) {
  const norm = value => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const cur = norm(current);
  const from = norm(oldPath);
  const to = norm(newPath);
  if (!cur || !from || !to) return null;
  const lower = value => value.toLowerCase();
  const isAbs = value => /^(?:[a-z]:\/|\/|__dropbox_root__\/[^/]+(?:\/|$))/i.test(value);
  // 同じ表記どうし
  if (lower(cur) === lower(from)) return { path: to, exact: true };
  if (lower(cur).startsWith(lower(from) + '/')) return { path: to + cur.slice(from.length), exact: false };
  // current が相対・oldPath が絶対: oldPath の末尾が current の先頭部分（フォルダの区切り）と一致する
  if (!isAbs(cur) && isAbs(from)) {
    const cuts = [];
    for (let i = 0; i < cur.length; i++) if (cur[i] === '/') cuts.push(i);
    cuts.push(cur.length);
    for (const cut of cuts) {
      const head = cur.slice(0, cut);
      if (!lower(from).endsWith('/' + lower(head))) continue;
      const base = from.slice(0, from.length - head.length);
      if (!lower(to).startsWith(lower(base))) continue;
      return { path: to.slice(base.length) + cur.slice(cut), exact: cut === cur.length };
    }
    return null;
  }
  // current が絶対・oldPath が相対: current のフォルダの区切りで oldPath と末尾が一致する
  if (isAbs(cur) && !isAbs(from) && !isAbs(to)) {
    // 一致する位置が1つだけの時に限る（同じ名前のフォルダが途中にあると取り違えるため）
    const lc = lower(cur);
    const needle = '/' + lower(from);
    const hits = [];
    let at = lc.indexOf(needle);
    while (at >= 0) {
      const end = at + needle.length;
      if (end === lc.length || lc[end] === '/') hits.push(at);
      at = lc.indexOf(needle, at + 1);
    }
    if (hits.length === 1) {
      const end = hits[0] + needle.length;
      return { path: cur.slice(0, hits[0] + 1) + to + cur.slice(end), exact: end === lc.length };
    }
  }
  return null;
}

const SN2_TEMPLATE_STORAGE_KEY = 'sn2-templates';
const SN2_TEMPLATE_ORDER_STORAGE_KEY = 'sn2-templates-order';
const SN2_FILTER_PRESETS_STORAGE_KEY = 'sn2-filter-presets';
const SN2_FILTER_PRESETS_ORDER_STORAGE_KEY = 'sn2-filter-presets-order';
const SN2_TOOL_STORAGE_HISTORY_SCOPE = 'settings:scriptnote';

function _snToolStorageHistoryKeys(keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  return [...new Set(list.filter(Boolean))];
}

function _snToolCaptureStorageHistory(keys) {
  if (typeof captureLocalStorageSettings !== 'function') return null;
  if (typeof isLocalStorageSettingsHistorySuppressed === 'function'
    && isLocalStorageSettingsHistorySuppressed()) return null;
  return captureLocalStorageSettings(_snToolStorageHistoryKeys(keys));
}

function _snToolStorageHistoryDetail(keys) {
  const labels = {
    [SN2_TEMPLATE_STORAGE_KEY]: 'テンプレート',
    [SN2_TEMPLATE_ORDER_STORAGE_KEY]: 'テンプレートの並び順',
    [SN2_FILTER_PRESETS_STORAGE_KEY]: 'フィルタプリセット',
    [SN2_FILTER_PRESETS_ORDER_STORAGE_KEY]: 'フィルタプリセットの並び順',
  };
  return _snToolStorageHistoryKeys(keys).map(key => labels[key] || key).join(' / ');
}

function _snToolRefreshStorageAfterHistory(keys) {
  const changed = new Set(_snToolStorageHistoryKeys(keys));
  if (typeof forEachComponent !== 'function') return;
  forEachComponent(component => {
    if (!component || typeof component._refreshTemplateSelect !== 'function') return;
    const templateChanged = changed.has(SN2_TEMPLATE_STORAGE_KEY) || changed.has(SN2_TEMPLATE_ORDER_STORAGE_KEY);
    const filterChanged = changed.has(SN2_FILTER_PRESETS_STORAGE_KEY) || changed.has(SN2_FILTER_PRESETS_ORDER_STORAGE_KEY);
    if (templateChanged) component._refreshTemplateSelect();
    if (filterChanged && typeof component._refreshFilterPresets === 'function') {
      component._refreshFilterPresets();
    }
  });
}

function _snToolPushStorageHistory(label, beforeSnapshot, keys, detail) {
  if (!beforeSnapshot || typeof historyPush !== 'function'
    || typeof captureLocalStorageSettings !== 'function'
    || typeof restoreLocalStorageSettings !== 'function'
    || typeof _normalizeLocalStorageSettingsSnapshots !== 'function') return false;
  const keyList = _snToolStorageHistoryKeys(keys);
  const snapshots = _normalizeLocalStorageSettingsSnapshots(beforeSnapshot, captureLocalStorageSettings(keyList));
  let beforeKey = '';
  let afterKey = '';
  try {
    beforeKey = JSON.stringify(snapshots.before);
    afterKey = JSON.stringify(snapshots.after);
  } catch {}
  if (beforeKey && beforeKey === afterKey) return false;
  historyPush(
    label || 'シナリオ: プリセット変更',
    () => restoreLocalStorageSettings(snapshots.before, _snToolRefreshStorageAfterHistory),
    () => restoreLocalStorageSettings(snapshots.after, _snToolRefreshStorageAfterHistory),
    SN2_TOOL_STORAGE_HISTORY_SCOPE,
    detail || _snToolStorageHistoryDetail(keyList)
  );
  return true;
}

// 端末に保存した設定（テンプレート・フィルタ・行セット等）が読めない時、空として扱うと
// 次の保存で元の内容が上書きされて消える。上書きの前に一度だけ別キーへ退避する。
function _snPreserveUnreadableStorage(key, raw) {
  if (raw == null || raw === '') return;
  try {
    const backupKey = key + '.unreadable-backup';
    if (localStorage.getItem(backupKey) == null) localStorage.setItem(backupKey, String(raw));
    console.warn('[scriptnote] 端末の保存設定を読めないため、元の内容を ' + backupKey + ' へ退避しました');
  } catch {}
}

function _snToolReadJsonObject(key) {
  let raw = null;
  try {
    raw = localStorage.getItem(key);
    const value = JSON.parse(raw || '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {}
  _snPreserveUnreadableStorage(key, raw);
  return {};
}

function _snToolReadJsonArray(key) {
  let raw = null;
  try {
    raw = localStorage.getItem(key);
    const value = JSON.parse(raw || '[]');
    if (Array.isArray(value)) return value.filter(item => typeof item === 'string' && item);
  } catch {}
  _snPreserveUnreadableStorage(key, raw);
  return [];
}

function _snToolPresetNames(storageKey, orderKey) {
  const data = _snToolReadJsonObject(storageKey);
  const keys = Object.keys(data);
  const ordered = _snToolReadJsonArray(orderKey).filter(name => Object.prototype.hasOwnProperty.call(data, name));
  return [...ordered, ...keys.filter(name => !ordered.includes(name))];
}

function _snToolFilteredPresetOrder(names, data) {
  const seen = new Set();
  return names.filter(name => typeof name === 'string' && name
    && (!data || Object.prototype.hasOwnProperty.call(data, name))
    && !seen.has(name) && seen.add(name));
}

function _snToolWriteStorageAtomically(entries) {
  const changes = entries.map(([key, value]) => ({ key, value: String(value), before: localStorage.getItem(key) }));
  const written = [];
  try {
    changes.forEach(change => {
      localStorage.setItem(change.key, change.value);
      written.push(change);
    });
  } catch (error) {
    for (let index = written.length - 1; index >= 0; index--) {
      const change = written[index];
      try {
        if (change.before === null) localStorage.removeItem(change.key);
        else localStorage.setItem(change.key, change.before);
      } catch (rollbackError) {
        console.error(`プリセット設定 ${change.key} のロールバックに失敗しました:`, rollbackError);
      }
    }
    throw error;
  }
}

function _snToolWritePresetOrder(orderKey, names, data) {
  localStorage.setItem(orderKey, JSON.stringify(_snToolFilteredPresetOrder(names, data)));
}

function _snToolClone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function _snToolUniquePresetName(base, names) {
  const existing = new Set(names);
  let name = `${base || 'プリセット'} のコピー`;
  let index = 2;
  while (existing.has(name)) name = `${base || 'プリセット'} のコピー${index++}`;
  return name;
}

// ツールバーの自動リンク・自動ルビの切り替え（シナリオのファイルの editor.autoLinks / editor.autoRuby に保存）。
// gb-autolink.js はこのファイルより後に読まれるので、最初のシナリオを開く時に登録する。
let _snDisplayLayersRegistered = false;
function _snRegisterDisplayLayers() {
  if (_snDisplayLayersRegistered || !(typeof globalThis.MeldexDisplayLayers?.registerApp === 'function')) return;
  _snDisplayLayersRegistered = true;
  MeldexDisplayLayers.registerApp('scriptnote', {
    supportsAutoRuby: true,
    pathForButton(btn) {
      const comp = btn?.closest?.('.gb-scriptnote-root')?._scriptNoteComponent;
      return comp?._editor?._path || comp?._editor?.doc?.source?.path || '';
    },
    async write(path, next, btn) {
      const comp = btn?.closest?.('.gb-scriptnote-root')?._scriptNoteComponent;
      const editor = comp?._editor;
      if (!editor?.doc) return false;
      if (editor._readOnly) {
        if (typeof showStatus === 'function') showStatus('編集ロック中のため変更できません', true);
        return false;
      }
      const prev = editor.doc.editor || {};
      const label = prev.autoLinks !== next.autoLinks ? '自動リンクの切り替え' : '自動ルビの切り替え';
      editor._pushUndo?.(label);
      editor.doc.editor = { ...prev, autoLinks: !!next.autoLinks, autoRuby: !!next.autoRuby };
      editor._render?.();
      return editor._markDirty?.({ skipUndo: true }) !== false;
    },
  });
}

class ScriptNoteComponent extends ToolComponent {
  constructor(paneId, tabId) {
    super(paneId, tabId);
    this._editor = null;
    this._toolbarBound = false;
    this._fileLockChangeHandler = () => this._syncReadOnlyFromFileLock();
    window.addEventListener?.('meldex:file-locks-updated', this._fileLockChangeHandler);
    this._historyRestoredHandler = event => {
      if (event.detail?.editor !== this._editor) return;
      const titleInput = this.el?.querySelector('#title-input');
      if (titleInput) titleInput.value = this._editor.doc.title || '';
      this._syncEditorToggleButtons();
    };
    window.addEventListener?.('meldex:scriptnote-history-restored', this._historyRestoredHandler);
  }

  create() {
    this.el = document.createElement('div');
    this.el.className = 'gb-se-root gb-scriptnote-root';
    _snRegisterDisplayLayers();
    this.el.innerHTML = ScriptNoteComponent._buildHTML();
    this.el._scriptNoteComponent = this;
    // SEP WebSocket の参照カウントを増やす（最初のコンポーネントで接続開始）
    if (typeof _sn2SepAcquire === 'function') _sn2SepAcquire();
    return this.el;
  }

  static _buildHTML() {
    return `
<div id="se-toolbar" class="gb-toolbar gb-toolbar-main">
  ${typeof toolbarAppIconHtml === 'function' ? toolbarAppIconHtml('scriptnote') : ''}
  ${window.MeldexFileIcons?.toolbarIconHtml?.('scriptnote') ?? ''}
  <input id="title-input" class="title-input tb-file-title tb-file-title--input" placeholder="シナリオタイトル" aria-label="シナリオタイトル" value="">
  <button type="button" class="tb-text-btn sn2-template-button" data-sn-action="templatePicker" title="テンプレート" aria-label="テンプレート" aria-haspopup="dialog"><span class="ico ico-layoutTemplate"></span><span class="sn2-template-button-label">マンガシナリオ</span></button>
  <select id="scenario-note-layout-select" class="tb-select sn2-toolbar-layout-select" title="テンプレート" aria-label="テンプレート" hidden>
    <option value="manga">マンガシナリオ</option>
    <option value="drama">ドラマ・映画シナリオ</option>
    <option value="afureko">アフレコシナリオ</option>
    <option value="stage">舞台シナリオ</option>
  </select>
  <button type="button" class="tb-icon-btn" data-sn-action="manageTemplates" title="テンプレートを管理" aria-label="テンプレートを管理"><span class="ico ico-listChecks"></span></button>
  <div class="sep"></div>
  <button type="button" class="tb-icon-btn" data-sn-action="undo" title="元に戻す (Ctrl+Z)" aria-label="元に戻す" data-undo-button><span class="ico ico-undo2"></span></button>
  <button type="button" class="tb-icon-btn" data-sn-action="redo" title="やり直し (Ctrl+Y)" aria-label="やり直し" data-redo-button><span class="ico ico-redo2"></span></button>
  <div class="sep"></div>
  <button type="button" class="tb-icon-btn active" data-sn-action="horizontal" id="btn-horizontal" title="横書き" aria-label="横書き" aria-pressed="true"><span class="ico ico-textAlignStart"></span></button>
  <button type="button" class="tb-icon-btn" data-sn-action="vertical" id="btn-vertical" title="縦書き" aria-label="縦書き" aria-pressed="false"><span class="ico ico-kanban"></span></button>
  <button type="button" class="tb-icon-btn" data-sn-action="wrap" id="btn-wrap" title="折返し" aria-label="折返し" aria-pressed="false"><span class="ico ico-wrapText"></span></button>
  <button type="button" class="tb-icon-btn" data-sn-action="mergeDisplay" id="btn-merge-display" title="前行と同じタイプ/ガター値を省略表示（まとめて表示）" aria-label="まとめ表示" aria-pressed="false"><span class="ico ico-rows3"></span></button>
  <div class="sep"></div>
  <button type="button" class="tb-text-btn" data-sn-action="addColumn" title="列を追加"><span class="ico ico-plus"></span>列</button>
  <div class="tb-spacer"></div>
  ${typeof globalThis.MeldexDisplayLayers?.registerApp === 'function' ? MeldexDisplayLayers.toolbarButtonsHtml('scriptnote', { autoRuby: true }) : ''}
  <button type="button" class="tb-icon-btn" data-sn-action="filter" id="btn-filter" title="タイプ/採用状況でフィルタ" aria-label="タイプ/採用状況でフィルタ"><span class="ico ico-funnel"></span></button>
  <div class="sep"></div>
  <button type="button" class="tb-icon-btn" data-sn-action="reload" title="ファイルを再読み込み" aria-label="ファイルを再読み込み"><span class="ico ico-refreshCw"></span></button>
  <button type="button" class="tb-icon-btn" data-sn-action="search" title="テキスト列を検索・置換" aria-label="テキスト列を検索・置換"><span class="ico ico-search"></span></button>
  <button type="button" class="tb-icon-btn gb-toolbar-option-panel-btn" data-sn-action="detail" id="btn-detail" title="オプションを開く" aria-label="オプションを開く"><span class="ico ico-slidersHorizontal"></span></button>
</div>
<div class="sn2-main" style="display:flex;flex:1;overflow:hidden;min-height:0;">
  <div id="scenario-note-surface" style="display:flex;flex:1;overflow:hidden;"></div>
</div>`;
  }

  // フォルダツリー等での改名・移動の追従（renameAppPathReferences が全コンポーネントへ呼ぶ）。
  // パスごとのエディタの登録（_sn2Editors）は1パスに1エディタで、同じシナリオを2つのパネルで
  // 開いた時の2つ目や、相対パスで開いたエディタ（ツリーは絶対パス）は追従から漏れていた（S3）。
  // 登録の付け替えで追従されないエディタだけを、ここで新しいパスへ移す。
  onPathRename(oldPath, newPath, options = {}) {
    const editor = this._editor;
    if (!editor?.doc) return;
    const current = editor._path || '';
    if (!current) return;
    const registry = typeof _sn2Editors !== 'undefined' ? _sn2Editors : null;
    const mapRenamed = typeof _mapRenamedPath === 'function' ? _mapRenamedPath : null;
    // 登録の付け替えで追従されるエディタは、二重に動かさない
    if (registry && mapRenamed && Object.keys(registry).some(key => registry[key] === editor
      && mapRenamed(key, oldPath, newPath) !== key)) return;
    const renamed = _sn2MapRenamedFilePath(current, oldPath, newPath);
    if (!renamed || renamed.path === current) return;
    const mapped = renamed.path;
    // ファイル自体の改名か（親フォルダの改名・移動ならタイトルは変えない）
    const renamedFile = renamed.exact;
    if (registry) {
      if (registry[current] === editor) delete registry[current];
      if (!registry[mapped]?.doc) registry[mapped] = editor;
      editor._sn2RegisteredPath = registry[mapped] === editor ? mapped : '';
    }
    editor._path = mapped;
    if (this.state?.scenarioPath === current || !this.state?.scenarioPath) this.state.scenarioPath = mapped;
    const label = Object.prototype.hasOwnProperty.call(options || {}, 'label') ? options.label : null;
    if (renamedFile && label != null) {
      if (editor.doc.title !== label) editor.doc.title = label;
      this.state.label = label;
      const titleInput = this.el?.querySelector?.('#title-input');
      // value の代入は change を起こさない（改名をもう一度送らない）
      if (titleInput && titleInput.value !== label) titleInput.value = label;
      if (options.etag) {
        editor._lastSavedEtag = options.etag;
        if (editor._lastSavedTransportRevision) editor._lastSavedTransportRevision = options.transport_revision || options.etag;
      }
    }
    const coordinator = window.MeldexDocumentSaveCoordinator;
    try {
      if (coordinator?.registerParticipant) coordinator.registerParticipant(coordinator.documentKeyForPath(mapped), editor);
    } catch (_) {}
    // 自分のタブの保存先と名前も合わせる
    const paneInfo = (typeof GBLayout !== 'undefined') ? GBLayout.findNode?.(GBLayout.root, this.paneId) : null;
    const ownTab = paneInfo?.node?.tabs?.find?.(tab => tab.id === this.tabId) || null;
    if (ownTab) {
      if (ownTab.path === current) ownTab.path = mapped;
      if (ownTab.state && typeof ownTab.state === 'object' && ownTab.state.scenarioPath === current) ownTab.state.scenarioPath = mapped;
      if (renamedFile && label != null) {
        ownTab.label = label;
        if (ownTab.state && typeof ownTab.state === 'object') ownTab.state.label = label;
      }
      try {
        GBLayout.refreshPaneTabs?.(this.paneId);
        GBLayout.saveLayout?.();
      } catch (_) {}
    }
    try { window.MeldexFileLockBadge?.apply?.(this.el?.querySelector?.('#title-input'), mapped); } catch (_) {}
  }

  activate() {
    super.activate();
    this._bindToolbar();
    const paneInfo = (typeof GBLayout !== 'undefined')
      ? GBLayout.findNode?.(GBLayout.root, this.paneId)
      : null;
    const ownTab = paneInfo?.node?.tabs?.find?.(tab => tab.id === this.tabId)
      || paneInfo?.node?.tabs?.[paneInfo?.node?.activeTabIndex]
      || null;
    if (ownTab?.type === 'scriptnote') {
      this.state.scenarioPath = ownTab.state?.scenarioPath || ownTab.path || this.state.scenarioPath || '';
      this.state.label = ownTab.state?.label || ownTab.label || this.state.label || '';
    }
    const isPaneActive = this.paneId === (typeof GBLayout !== 'undefined' ? GBLayout.activePane : this.paneId);
    // ヒストリースコープ設定
    if (this._editor?.doc && typeof historySetScope === 'function') {
      historySetScope(this._editor._historyScope());
    }
    if (this.state.scenarioPath) {
      if (!this._editor?.doc || this._editor?._path !== this.state.scenarioPath) {
        const passiveLoadOpts = {
          bridgeLoad: true,
          skipNavPush: true,
          skipRecent: true,
          skipAutoVersion: true,
          skipSaveLastView: true,
          silent: true,
          skipStatus: true,
        };
        const loadPath = this.state.scenarioPath;
        this._lastLoadError = null;
        const loading = this._loadScenario(loadPath, isPaneActive ? {} : passiveLoadOpts);
        if (!isPaneActive) {
          // 非アクティブなパネルの読込は表示を出さない設定で行うが、失敗まで黙ると
          // 空のパネルだけが残るため、どのシナリオが読めなかったかを知らせる。
          Promise.resolve(loading).then(loaded => loaded, error => {
            this._lastLoadError = error;
            return false;
          }).then(loaded => {
            // 新しい読込に追い越された場合（エラーなしの false）は失敗ではない。
            if (loaded !== false || !this._lastLoadError) return;
            const name = String(loadPath).split(/[\\/]/).pop() || loadPath;
            const reason = this._lastLoadError?.message || this._lastLoadError || '';
            if (typeof showStatus === 'function') {
              showStatus(`別のパネルのシナリオ「${name}」を読み込めませんでした${reason ? `: ${reason}` : ''}`, true);
            }
          });
        }
        return;
      }
    } else if (!this._editor?.doc) {
      // scenarioPath が空でも、単独版の「新規シナリオ」等で既にドキュメントが
      // メモリ上にロード済みの場合は空状態で上書きしない（未保存の新規文書を保持する）。
      this._renderEmptyState();
    }
    // 詳細パネルをシナリオエディタ用に切り替え（非アクティブペインではスキップ）
    if (this._skipDetailSync !== true && this._editor) this._syncDetailPanel({ reuseCurrent: true });
  }

  deactivate() {
    super.deactivate();
    if (this._editor) this._editor.flush();
    // 注: 詳細パネルのタブはdeactivate時に消さない（別ペインからの操作を可能にする）
    // destroy()時のみ_restoreDetailPanel()を呼ぶ
  }

  destroy(options = {}) {
    // destroy()内でPromiseを投げっぱなしにすると409/保存失敗より先にDOMと
    // 下書きを破棄する。呼出元は共通safe removalでflushをawaitした証明を渡す。
    if (this._editor && options.skipFlush !== true) {
      if (typeof showStatus === 'function') {
        showStatus('シナリオの保存確認前には画面を破棄できません', true);
      }
      return false;
    }
    if (this._editor) { this._editor.destroy(); this._editor = null; }
    window.removeEventListener?.('meldex:file-locks-updated', this._fileLockChangeHandler);
    window.removeEventListener?.('meldex:scriptnote-history-restored', this._historyRestoredHandler);
    this._restoreDetailPanel();
    // SEP WebSocket の参照カウントを減らす（最後のコンポーネント破棄で WS を閉じる）
    if (typeof _sn2SepRelease === 'function') _sn2SepRelease();
    super.destroy();
    return true;
  }

  _syncReadOnlyFromFileLock() {
    const path = this._editor?._path || this.state?.scenarioPath || '';
    let locked = false;
    try { locked = !!(path && typeof isItemLocked === 'function' && isItemLocked(path)); } catch {}
    this._editor?.setReadOnly?.(locked);
    if (!this.el) return locked;
    this.el.dataset.fileReadOnly = locked ? 'true' : 'false';
    const title = this.el.querySelector?.('#title-input');
    const layout = this.el.querySelector?.('#scenario-note-layout-select');
    // 電話幅ではタイトル用ツールバーが隠れるため、表示中のビュー選択欄にも同じ鍵の印を出す。
    const viewSelect = this.el.querySelector?.('.gb-view-tabs-select');
    if (viewSelect && viewSelect.dataset.lockBadgePath !== path) window.MeldexFileLockBadge?.apply?.(viewSelect, path);
    viewSelect?._fileLockBadgeEl?.classList?.add('sn2-mobile-lock-badge');
    if (title) title.disabled = locked;
    if (layout) layout.disabled = locked;
    const mutationActions = new Set([
      'manageTemplates', 'undo', 'redo', 'horizontal', 'vertical',
      'wrap', 'mergeDisplay', 'addColumn', 'search',
    ]);
    const actionControls = this.el.querySelectorAll?.('[data-sn-action]') || [];
    actionControls.forEach((button) => {
      if (mutationActions.has(button.dataset.snAction || '')) button.disabled = locked;
    });
    return locked;
  }

  _syncEditorToggleButtons() {
    if (!this.el || !this._editor?.doc) return;
    const editorState = this._editor.doc.editor || {};
    const states = {
      '#btn-horizontal': (editorState.viewMode || 'horizontal') === 'horizontal',
      '#btn-vertical': editorState.viewMode === 'vertical',
      '#btn-wrap': !!editorState.wrapMode,
      '#btn-merge-display': !!editorState.mergeDisplay,
    };
    Object.entries(states).forEach(([selector, pressed]) => {
      const button = this.el.querySelector(selector);
      if (!button) return;
      button.classList.toggle('active', pressed);
      button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    });
  }

  // 遷移前flush契約（計画書「閲覧・編集・保存」節）。gb-subpanel.js /
  // gb-subpanel.js が対象置換・戻る/進む・閉じる・メインパネル昇格の前に
  // getComponentInstance(tabId).flush() として汎用的に呼び出す。保留中の
  // 自動保存タイマーを即座に実行し、保存の成否(true/false)を返す。
  // 実体は ScriptNoteEditor.prototype.flush()（DOM同期→dirtyならsave()）で、
  // 保存共通契約(gb-document-save-coordinator.js)経由の保存キューに乗る。
  async flush() {
    if (!this._editor) return true;
    return this._editor.flush();
  }

  async prepareForClose() {
    const editor = this._editor;
    if (!editor) return true;
    const path = editor._path;
    let saved = false;
    try { saved = await editor.flush(); } catch (_) {}
    if (this._editor !== editor || editor._path !== path) return false;
    if (saved !== false && !editor._dirty) return true;
    // サーバ保存とは区別する。端末への保管が完了した場合だけ破棄を許可する。
    return editor.preserveDraftForClose();
  }

  handleKeyDown(e) {
    // 軽量エディタはブラウザデフォルト動作を活用するため、ここでは何もしない
    return false;
  }

  restoreState(s) {
    super.restoreState(s);
    if (!s) return;
    this.state.scenarioPath = s.scenarioPath || '';
    this.state.label = s.label || '';
    this.state.noteLayoutMode = s.noteLayoutMode || '';
  }

  getState() {
    // getState は _beforeRender から呼ばれるため、保存は行わずDOM同期のみ
    if (this._editor) this._editor._syncAllFromDom();
    return {
      scenarioPath: this.state.scenarioPath || '',
      label: this.state.label || '',
      noteLayoutMode: this._editor?.doc?.layoutMode || this.state.noteLayoutMode || '',
    };
  }

  _hasLoadedScenarioPath(path) {
    return !!(path && this._editor?.doc && this._editor._path === path);
  }

  _hasRenderedScriptNoteDom() {
    const host = this.el?.querySelector?.('#scenario-note-surface') || null;
    return !!host?.querySelector?.('.sn2-editor');
  }

  _renderEmptyState() {
    const host = this.el?.querySelector('#scenario-note-surface');
    if (!host) return;
    host.innerHTML = `
      <div class="sn2-scroll" style="display:flex;flex:1;align-items:center;justify-content:center;">
        <div style="max-width:420px;padding:24px 28px;border:1px solid var(--border);border-radius:10px;background:var(--bg2);color:var(--fg2);line-height:1.7;">
          <div style="font-size:16px;font-weight:700;color:var(--fg);margin-bottom:8px;">シナリオファイル未読込</div>
          <div style="font-size:13px;">左上のメニューから「開く...」を実行してください。</div>
        </div>
      </div>`;
  }

  _syncDetailPanel(options = {}) {
    const scenarioPath = this._editor?._path || this.state.scenarioPath || '';
    // 別パネルを開くための再配置で、同じ対象の表示中の詳細を作り直さない。
    // 明示の更新、対象・内容・ロック・表示タブが変わった時は従来どおり同期する。
    if (options?.reuseCurrent === true && this._editor
      && window._detailScriptNoteTabId === this.tabId
      && (this._editor._detailActiveTab || 'roles') === 'roles') {
      const current = document.getElementById('detail-tab-sn2-main');
      const panel = current?.querySelector('.sn2-detail-wrap');
      const targets = window.GBOptionTargetContext?.get?.()?.targets;
      const sameTarget = !window.GBOptionTargetContext?.get || (targets?.length === 1
        && targets[0].path === scenarioPath && targets[0].kind === 'scriptnote');
      if (sameTarget && current && !current.hidden && current.style.display !== 'none'
        && panel && !panel.hidden && panel.style.display !== 'none'
        && this._editor._canReuseRoleManagementPanel?.(panel)) return;
    }
    if (this._editor) window._detailScriptNoteTabId = this.tabId;
    if (scenarioPath) {
      const revision = window.GBOptionTargetContext?.set({ path: scenarioPath, kind: 'scriptnote' }, 'scriptnote-open');
      if (this._editor?.doc
        && document.querySelector('.gb-tool-file-theme')
        && !document.querySelector('.gb-tool-file-theme [data-file-theme-panel="scriptnote"]')) {
        // 初回activate中はcomponent registryへの登録がまだ終わっていない。
        // 登録後のフレームで、同じ対象の読込完了を独立パネルへ通知する。
        requestAnimationFrame(() => {
          if (window.GBOptionTargetContext?.isCurrentRevision?.(revision)
            && !document.querySelector('.gb-tool-file-theme [data-file-theme-panel="scriptnote"]')) {
            document.dispatchEvent(new CustomEvent('meldex:option-target-changed', { detail: window.GBOptionTargetContext.get() }));
          }
        });
      }
    }
    // タブシェルが未生成の場合は確保する（初回起動時の保険）
    const rpDetail = document.getElementById('rp-detail');
    if (rpDetail && typeof _ensureDetailTabShell === 'function') _ensureDetailTabShell(rpDetail);
    const container = document.getElementById('detail-tab-sn2-main');
    if (!container) return;
    // 他エディタのタブを非表示
    if (typeof showBoardTabs === 'function') showBoardTabs(false);
    if (typeof showCalendarDetailTabs === 'function') showCalendarDetailTabs(false);
    if (typeof showNoteTabs === 'function') showNoteTabs(false);
    if (typeof showFileInfoTab === 'function') showFileInfoTab(true);
    if (scenarioPath && typeof renderFileInfoDetailTab === 'function') {
      void renderFileInfoDetailTab(scenarioPath, null, { type: 'scriptnote', typeLabel: 'シナリオ' });
    }
    if (typeof showDbTabs === 'function') showDbTabs(false);
    if (typeof showPublishDetailTab === 'function') showPublishDetailTab(false);
    if (typeof showNoteRubyDetailTab === 'function') showNoteRubyDetailTab(false);
    if (typeof showFileStyleTab === 'function') showFileStyleTab(true);
    if (typeof renderFileStyleTab === 'function') renderFileStyleTab('scriptnote');
    // シナリオ用タブを追加
    this._ensureScriptnoteDetailTabs();
    // シナリオ専用コンテナにシナリオパネルを描画
    if (this._editor) {
      let panel = container.querySelector('.sn2-detail-wrap');
      if (!panel) {
        panel = document.createElement('div');
        panel.className = 'sn2-detail-wrap';
        panel.style.cssText = 'flex:1;overflow:hidden;display:flex;flex-direction:column;';
        container.appendChild(panel);
      }
      panel.style.display = 'flex';
      const activeTab = this._editor._detailActiveTab || 'roles';
      if (activeTab === 'style') {
        if (typeof renderFileStyleTab === 'function') renderFileStyleTab('scriptnote');
      } else if (activeTab === 'ruby' && typeof this._editor.renderRubyPanel === 'function') {
        this._editor.renderRubyPanel(panel);
      } else if (activeTab === 'theme' && typeof this._editor.renderThemePanel === 'function') {
        this._editor.renderThemePanel(panel);
      } else if (activeTab === 'rowset' && typeof this._editor.renderRowsetPanel === 'function') {
        this._editor.renderRowsetPanel(panel);
      } else {
        this._editor.renderDetailPanel(panel);
      }
    }
    // シナリオのアクティブタブに切り替え
    const activeTab = this._editor?._detailActiveTab || 'roles';
    if (typeof switchDetailTab === 'function') switchDetailTab(activeTab === 'style' ? 'file-style' : 'sn2-' + activeTab);
  }

  _ensureScriptnoteDetailTabs() {
    const tabBar = document.getElementById('detail-tab-bar');
    if (!tabBar) return;
    tabBar.querySelectorAll('.detail-tab-scriptnote').forEach(el => el.remove());
    const styleTab = tabBar.querySelector('[data-detail-tab="file-style"]');
    if (styleTab && !styleTab.dataset.scriptnoteBound) {
      styleTab.dataset.scriptnoteBound = '1';
      styleTab.addEventListener('click', () => {
        if (!document.querySelector('.detail-tab-scriptnote')) return;
        const comp = (typeof getActiveScriptNoteComponent === 'function') ? getActiveScriptNoteComponent() : null;
        if (!comp?._editor || typeof comp._syncDetailPanel !== 'function') return;
        comp._editor._detailActiveTab = 'style';
        comp._syncDetailPanel();
      });
    }
    const tabs = [
      { id: 'sn2-roles', label: 'タイプ管理' },
      { id: '__style__', label: 'テーマ' },
      { id: 'sn2-theme', label: '表示' },
      { id: 'sn2-ruby', label: 'ルビ' },
      { id: 'sn2-rowset', label: '行セット' },
    ];
    tabs.forEach(t => {
      if (t.id === '__style__') {
        if (styleTab) tabBar.appendChild(styleTab);
        return;
      }
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'gb-inner-tab detail-tab detail-tab-scriptnote';
      el.dataset.detailTab = t.id;
      el.setAttribute('role', 'tab');
      el.setAttribute('aria-selected', 'false');
      el.textContent = t.label;
      el.dataset.action = `switchDetailTab('${t.id}')`;
      el.addEventListener('click', () => {
        const comp = (typeof getActiveScriptNoteComponent === 'function') ? getActiveScriptNoteComponent() : this;
        if (!comp?._editor || typeof comp._syncDetailPanel !== 'function') return;
        comp._editor._detailActiveTab = t.id === 'sn2-ruby' ? 'ruby' : t.id === 'sn2-theme' ? 'theme' : t.id === 'sn2-rowset' ? 'rowset' : 'roles';
        comp._syncDetailPanel();
      });
      tabBar.appendChild(el);
    });
  }

  _hideScriptnoteDetailTabs() {
    document.querySelectorAll('.detail-tab-scriptnote').forEach(el => el.remove());
  }

  _restoreDetailPanel() {
    const ownsDetail = window._detailScriptNoteTabId === this.tabId;
    if (!ownsDetail) return;
    this._hideScriptnoteDetailTabs();
    if (ownsDetail) window._detailScriptNoteTabId = '';
    if (ownsDetail && typeof showFileStyleTab === 'function') showFileStyleTab(false);
    const container = document.getElementById('detail-tab-sn2-main');
    if (!container) return;
    const wrap = container.querySelector('.sn2-detail-wrap');
    if (wrap) wrap.remove();
    container.style.display = 'none';
  }

  _openDetailPanel() {
    if (typeof _openDetailRightPanel === 'function') {
      if (_openDetailRightPanel(this.paneId) === false) return;
    } else if (typeof openRightPanelTab === 'function') openRightPanelTab('detail', this.paneId);
    this._syncDetailPanel();
  }

  _refreshTemplateSelect() {
    const sel = this.el?.querySelector('#scenario-note-layout-select');
    if (!sel) return;
    // 既存のカスタムオプションを除去
    sel.querySelectorAll('option[value^="custom:"]').forEach(o => o.remove());
    _snToolPresetNames(SN2_TEMPLATE_STORAGE_KEY, SN2_TEMPLATE_ORDER_STORAGE_KEY).forEach(name => {
      const opt = document.createElement('option');
      opt.value = 'custom:' + name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    // 現在のlayoutModeに合わせて選択
    if (this._editor?.doc?.layoutMode) sel.value = this._editor.doc.layoutMode;
    this._syncTemplateButton?.();
  }

  _showTitleRenameModal() {
    const titleInput = this.el?.querySelector('#title-input');
    if (!titleInput || !this._editor?.doc) {
      if (typeof showStatus === 'function') showStatus('タイトルを変更できませんでした', true);
      return false;
    }
    this._showNameModal({
      title: 'タイトルを変更',
      label: 'タイトル',
      placeholder: 'シナリオタイトル',
      value: titleInput.value || this._editor.doc.title || '',
      okText: '変更',
      onSubmit: name => {
        titleInput.value = name;
        titleInput.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      },
    });
    return true;
  }

  _showToolbarSelectModal({ sourceSelector, title, label, okText = '適用', dialog = 'toolbar-select' }) {
    const source = this.el?.querySelector(sourceSelector);
    if (!source) {
      if (typeof showStatus === 'function') showStatus(`${label || '項目'}を選択できませんでした`, true);
      return false;
    }
    const owner = document.activeElement;
    const selectId = `sn2-${dialog}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-select`;
    const options = [...source.options].map(opt => (
      `<option value="${esc(opt.value)}">${esc(opt.textContent || opt.label || opt.value)}</option>`
    )).join('');
    const content = document.createElement('div');
    content.innerHTML = `<label class="sn2-preset-field" for="${selectId}"><span class="sn2-preset-label">${esc(label)}</span><select id="${selectId}" class="gb-select sn2-toolbar-modal-select" data-e2e-id="scriptnote-toolbar-select-input">${options}</select></label>`;
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button'; cancelButton.className = 'gb-btn gb-btn-sm cancel-btn'; cancelButton.textContent = 'キャンセル';
    const okButton = document.createElement('button');
    okButton.type = 'button'; okButton.className = 'gb-btn gb-btn-sm gb-btn-primary primary ok-btn'; okButton.textContent = okText;
    // 安定ID と名前（S31）
    cancelButton.dataset.e2eId = 'scriptnote-toolbar-select-cancel';
    cancelButton.setAttribute('aria-label', `${title}をキャンセル`);
    okButton.dataset.e2eId = 'scriptnote-toolbar-select-apply';
    okButton.setAttribute('aria-label', `${title}: ${okText}`);
    const modalApi = window.GBUI.createModal({
      id: 'scriptnote-toolbar-select', title, body: [...content.childNodes], footer: [cancelButton, okButton],
      variant: 'standard', geometryKey: 'scriptnote-toolbar-select', minWidth: '0', initialFocus: '.sn2-toolbar-modal-select',
      returnFocus: owner, closeLabel: `${title}を閉じる`, closeOnEsc: true, closeOnOverlay: true,
    });
    const overlay = modalApi.overlay;
    const panel = modalApi.modal;
    overlay.dataset.sn2Dialog = dialog;
    overlay.dataset.e2eId = 'scriptnote-toolbar-select-overlay';
    panel.dataset.e2eId = 'scriptnote-toolbar-select-dialog';
    panel.classList.add('sn2-preset-modal', 'sn2-toolbar-select-modal');
    modalApi.body.classList.add('sn2-preset-modal-body');
    modalApi.footer.classList.add('sn2-preset-modal-actions');
    globalThis.GBScriptNoteDialogUI?.applyCompactTargets?.(panel);
    const select = panel.querySelector('.sn2-toolbar-modal-select');
    if (select) select.value = source.value;
    const apply = () => {
      if (!select) return;
      source.value = select.value;
      source.dispatchEvent(new Event('change', { bubbles: true }));
      modalApi.close('apply');
    };
    cancelButton.addEventListener('click', () => modalApi.close('cancel'));
    okButton.addEventListener('click', apply);
    modalApi.open();
    return true;
  }

  _showTemplateSelectModal() {
    this._refreshTemplateSelect();
    if (typeof this._showTemplatePicker === 'function') return this._showTemplatePicker();
    return this._showToolbarSelectModal({
      sourceSelector: '#scenario-note-layout-select',
      title: 'テンプレート選択',
      label: 'テンプレート',
      dialog: 'toolbar-template-select',
    });
  }

  _showFilterPresetSelectModal() {
    this._refreshFilterPresets();
    return this._showToolbarSelectModal({
      sourceSelector: '#sn-filter-preset',
      title: 'フィルタプリセット',
      label: 'フィルタプリセット',
      dialog: 'toolbar-filter-preset',
    });
  }

  _bindToolbar() {
    if (this._toolbarBound || !this.el) return;
    this._toolbarBound = true;
    this.el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-sn-action]');
      if (!btn) return;
      const action = btn.dataset.snAction;
      if (action === 'detail') { this._openDetailPanel(); return; }
      if (action === 'undo') { if (this._editor) this._editor.undo(); return; }
      if (action === 'redo') { if (this._editor) this._editor.redo(); return; }
      if (action === 'horizontal' || action === 'vertical') {
        if (!this._editor?.doc) return;
        this._editor._pushUndo('表示方向変更');
        if (typeof MeldexRubyPresentation !== 'undefined' && typeof MeldexRubyPresentation.updateDocument === 'function') {
          MeldexRubyPresentation.updateDocument(this._editor.doc, { writingMode: action });
        } else {
          this._editor.doc.editor.viewMode = action;
          if (this._editor.doc.rubyPresentation && typeof this._editor.doc.rubyPresentation === 'object') {
            this._editor.doc.rubyPresentation.writingMode = action;
          }
        }
        this._editor._render();
        this._editor._markDirty();
        this._syncEditorToggleButtons();
        window.dispatchEvent(new CustomEvent('meldex:ruby-presentation-change', {
          detail: { doc: this._editor.doc, field: 'writingMode' },
        }));
        return;
      }
      if (action === 'wrap') {
        if (!this._editor?.doc) return;
        this._editor._pushUndo('折り返し切替');
        this._editor.doc.editor.wrapMode = !this._editor.doc.editor.wrapMode;
        this._editor._render();
        this._editor._markDirty();
        this._syncEditorToggleButtons();
        return;
      }
      if (action === 'mergeDisplay') {
        if (!this._editor?.doc) return;
        if (!this._editor.doc.editor) this._editor.doc.editor = {};
        this._editor._pushUndo('まとめ表示切替');
        this._editor.doc.editor.mergeDisplay = !this._editor.doc.editor.mergeDisplay;
        this._editor._render();
        this._editor._markDirty();
        this._syncEditorToggleButtons();
        // 詳細パネルのテーマタブチェックボックスも同期
        const detailCb = document.querySelector('input[data-setting="mergeDisplay"]');
        if (detailCb) detailCb.checked = !!this._editor.doc.editor.mergeDisplay;
        return;
      }
      if (action === 'addColumn') {
        if (!this._editor) return;
        this._editor._addCustomColumn();
        return;
      }
      if (action === 'filter') {
        if (!this._editor) return;
        this._editor._showFilterMenu(btn);
        return;
      }
      if (action === 'search') {
        if (!this._editor) return;
        this._editor._showSearchReplacePopup?.(btn);
        return;
      }
      if (action === 'reload') {
        if (!this._editor?._path) return;
        const reloadEditor = this._editor;
        const savedDetailTab = reloadEditor._detailActiveTab;
        const reloadPath = reloadEditor._path;
        const reloadLoadSeq = this._loadSeq;
        const isCurrentReload = () => this._editor === reloadEditor
          && reloadEditor._path === reloadPath && this._loadSeq === reloadLoadSeq;
        (async () => {
          const coordinator = window.MeldexDocumentSaveCoordinator;
          const documentKey = coordinator?.documentKeyForPath?.(reloadPath) || reloadPath;
          if (coordinator?.isConflictPending?.(documentKey)) {
            await reloadEditor._reviewConflict?.(reloadPath, documentKey);
            return;
          }
          if (reloadEditor._saveTimer) {
            clearTimeout(reloadEditor._saveTimer);
            reloadEditor._saveTimer = null;
          }
          if (reloadEditor._dirty && typeof reloadEditor.save === 'function') {
            const saved = await reloadEditor.save();
            if (!isCurrentReload()) return;
            if (!saved || reloadEditor._dirty) {
              showStatus('未保存の変更があるため再読込を中止しました', true);
              return;
            }
          }
          if (!isCurrentReload()) return;
          const loaded = await this._loadScenario(reloadPath, { skipNavPush: true, skipRecent: true, skipAutoVersion: true });
          if (loaded !== false && savedDetailTab && this._editor === reloadEditor
            && reloadEditor._path === reloadPath) reloadEditor._detailActiveTab = savedDetailTab;
        })();
        return;
      }
      if (action === 'saveFilter') {
        this._addFilterPreset({ allowOverwrite: true });
        return;
      }
      if (action === 'manageFilters') {
        this._showPresetManager('filter');
        return;
      }
      if (action === 'manageTemplates' || action === 'templatePicker') {
        if (typeof this._showTemplatePicker === 'function') this._showTemplatePicker();
        else this._showPresetManager('template');
        return;
      }
    });
    const noteLayoutSel = this.el.querySelector('#scenario-note-layout-select');
    if (noteLayoutSel) {
      this._refreshTemplateSelect();
      noteLayoutSel.addEventListener('change', async () => {
        const val = noteLayoutSel.value;
        if (!this._editor?.doc) return;
        const previous = this._editor.doc.templateId || this._editor.doc.layoutMode || 'manga';
        try {
          if (typeof this._applyScriptNoteTemplate !== 'function') throw new Error('テンプレート適用処理を読み込めませんでした');
          await this._applyScriptNoteTemplate(val);
          if (typeof showStatus === 'function') showStatus('シナリオテンプレートを適用しました');
        } catch (error) {
          noteLayoutSel.value = previous;
          if (typeof showStatus === 'function') showStatus('テンプレートを適用できませんでした: ' + (error?.message || error), true);
        }
      });
    }
    const titleInput = this.el.querySelector('#title-input');
    // Enter で確定して入力を終える（日本語変換中の Enter は変換の確定なので除外）
    if (titleInput) titleInput.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        titleInput.blur();
      }
    });
    const handleTitleChange = async () => {
      const editor = this._editor;
      if (editor?.doc) {
        const previousTitle = editor.doc.title || '';
        // 直前の変更でタイトルもファイル名も確定済みなら何もしない（同じ入力の change が重なった時に、
        // 改名済みの旧パスへ2回目の改名を送って「見つかりません」になっていた。S8）
        if (titleInput.value === previousTitle) {
          const storageNameFn = window.GBPathUtils?.displayTitle?.storageName;
          const stemNow = String(editor._path || '').split(/[\\/]/).pop().replace(/\.(?:mel-scenario|scenario\.json|scriptnote\.json|json)$/i, '');
          if (!previousTitle.trim() || typeof storageNameFn !== 'function' || storageNameFn(previousTitle.trim()) === stemNow) return;
        }
        const newTitle = titleInput.value.trim();
        const oldPath = editor._path;
        // ファイル名も変える操作は、本文のタイトルだけを戻す履歴にしない。
        // 通信中に行われた本文編集より先に履歴の位置を予約する。
        editor._pushUndo('タイトル変更');
        const titleHistory = newTitle && oldPath && typeof historyReserve === 'function'
          && typeof _outlinerApplyRenameSuccess === 'function'
          ? historyReserve('タイトル変更', editor._historyScope(), '', { preserveRedoOnCancel: true }) : null;
        editor.doc.title = titleInput.value;
        editor._markDirty({ skipUndo: !!titleHistory });
        if (titleHistory) editor._lastPushedSnap = editor._takeSnapshot();
        // タイトル変更をファイル名にも反映
        if (newTitle && oldPath) {
          // ツリーの行は絶対パスを持つことがあるため、同じファイルを指す行のパスも名前の変更の対象にする（S8）
          const treeAliases = _sn2TreePathsForFile(oldPath).filter(p => p !== oldPath);
          const showTreeLabel = (label) => {
            if (typeof applyOptimisticRenameLabel !== 'function') return;
            applyOptimisticRenameLabel(oldPath, label, 'scriptnote');
            treeAliases.forEach(p => applyOptimisticRenameLabel(p, label, 'scriptnote'));
          };
          // 通信を待たずに、フォルダツリーとタブの名前を先に変える（失敗したら戻す）
          if (newTitle !== previousTitle) showTreeLabel(newTitle);
          try {
            // 1) 表示中の文書は自動保存と同じ列でタイトルを確定する（並走すると409になる）。
            let res = await apiPost('/outliner/rename', { old_path: oldPath, new_name: newTitle, type: 'scriptnote', title_only: true }, { scriptnoteEditor: editor });
            const storageName = window.GBPathUtils?.displayTitle?.storageName;
            const currentStem = String(oldPath).split(/[\\/]/).pop().replace(/\.(?:mel-scenario|scenario\.json|scriptnote\.json|json)$/i, '');
            const needsFileRename = res?.new_path === oldPath && typeof storageName === 'function' && storageName(newTitle) !== currentStem;
            // タイトルを続けて変えた場合は、後続の change が改名を引き継ぐ。
            if (editor.doc?.title !== newTitle) return;
            if (this._editor !== editor || editor._path !== oldPath) {
              // 1段目（タイトル保存）の後で表示中のシナリオが切り替わった。別の保存と競合し得るため
              // ファイル名は変えず、先に変えたツリー・タブの名前を実際のファイル名へ戻して知らせる。
              if (needsFileRename) {
                if (editor._path === oldPath && newTitle !== previousTitle) showTreeLabel(currentStem);
                if (typeof showStatus === 'function') {
                  showStatus('タイトルは保存しましたが、表示中のシナリオが切り替わったためファイル名は変更していません。もう一度タイトルを確定すると変更できます', true);
                }
              }
              return;
            }
            // 2) タイトル＝ファイル名。保存済みの状態でファイル名を新しいタイトルへ変える。
            let switchedAfterFileRename = false;
            let releaseFileRename = null;
            try {
            if (needsFileRename) {
              // ファイル名の変更中に旧名へ保存すると、移動と重なって見つからない・版の不一致（競合）になる。
              // 先にこのエディタの保存を落ち着かせ、変更中に来た保存は変更後のパスと版の印で送る
              // （save() が _fileRenamePending を待つ）。
              const saveCoordinator = window.MeldexDocumentSaveCoordinator;
              const renameKey = saveCoordinator?.documentKeyForPath?.(oldPath);
              for (let waited = 0; renameKey && waited < 5000
                && saveCoordinator.hasUnsettledSaveFrom?.(renameKey, editor); waited += 50) {
                await new Promise(resolve => setTimeout(resolve, 50));
              }
              editor._fileRenamePending = new Promise(resolve => { releaseFileRename = resolve; });
              res = await apiPost('/outliner/rename', { old_path: oldPath, new_name: newTitle, type: 'scriptnote' });
              if (editor._path !== oldPath) {
                if (typeof showStatus === 'function') {
                  showStatus('ファイル名は変更しましたが、同時に別の変更があったため画面へ反映できませんでした。フォルダツリーから開き直してください', true);
                }
                return;
              }
              // ファイルは既に新しい名前へ移っている。表示が切り替わっていても、このエディタの保存先と
              // ツリーは新しい名前へ合わせる（旧名へ保存して別ファイルを作らないため）。
              switchedAfterFileRename = this._editor !== editor;
            }
            if (res?.new_path) {
              // エディタのパスとレジストリを更新
              if (typeof _sn2Editors !== 'undefined') {
                delete _sn2Editors[oldPath];
                _sn2Editors[res.new_path] = editor;
                if (editor._historyScopeId) _sn2Editors[editor._historyScopeId] = editor;
              }
              editor._path = res.new_path;
              if (res.new_path !== oldPath) {
                // ファイル名の変更で版の印が変わる。この後の保存の基準を新しい印へ合わせ、保存の調整役にも
                // 新しいパスで登録する。改名の追従（onPathRename）は、ここで先にパスを付け替えたエディタを
                // 「追従済み」として飛ばすため、印を古いまま残すと次の保存（取り消しを含む）が誤って競合になる。
                if (res.etag) {
                  editor._lastSavedEtag = res.etag;
                  if (editor._lastSavedTransportRevision) editor._lastSavedTransportRevision = res.transport_revision || res.etag;
                }
                try {
                  const coordinator = window.MeldexDocumentSaveCoordinator;
                  if (coordinator?.registerParticipant) coordinator.registerParticipant(coordinator.documentKeyForPath(res.new_path), editor);
                } catch (_) {}
              }
              if (!switchedAfterFileRename) this.state.scenarioPath = res.new_path;
              window.dispatchEvent(new CustomEvent('meldex:file-path-renamed', {
                detail: { oldPath, newPath: res.new_path, type: 'scriptnote' },
              }));
              if (!switchedAfterFileRename) window.MeldexFileLockBadge?.apply?.(titleInput, res.new_path);
              if (typeof renameAppPathReferences === 'function') {
                // 開いている画面は作り直さない（パネル全体の描き直しで、改名の直後にクリックした本文の
                // フォーカスが外れていた。S26。フォルダツリーの改名と同じ扱い）
                renameAppPathReferences(oldPath, res.new_path, { label: newTitle, fileId: res.file_id, etag:res.etag, titleOnly:res.title_only, type: 'scriptnote', preserveMountedViews: true });
              }
              // タブ名を更新
              if (!switchedAfterFileRename && typeof GBTabs !== 'undefined' && this.tabId) GBTabs.setTabLabel?.(this.tabId, newTitle);
              // フォルダツリーのノード名を更新
              if (typeof _renameTreeNode === 'function') {
                // 絶対パスの行は、同じフォルダの新しいファイル名（拡張子つき）へ付け替える
                const newBase = String(res.new_path).split(/[\\/]/).pop();
                treeAliases.forEach((aliasPath) => {
                  const cut = Math.max(aliasPath.lastIndexOf('/'), aliasPath.lastIndexOf('\\'));
                  _renameTreeNode(aliasPath, (cut >= 0 ? aliasPath.slice(0, cut + 1) : '') + newBase, newTitle, res.file_id);
                });
                if (!treeAliases.length) _renameTreeNode(oldPath, res.new_path, newTitle, res.file_id);
              }
              if (titleHistory) {
                _outlinerApplyRenameSuccess(oldPath, res.new_path, newTitle, res.file_id,
                  { type: 'scriptnote', path: oldPath, name: previousTitle }, previousTitle, {
                    historyOnly: true, skipStatus: true, historyReservation: titleHistory,
                    etag: res.etag, titleOnly: res.title_only,
                    onHistoryApplied: title => {
                      // 改名の履歴を、後続の本文Undoへ重ねて記録しない。
                      if (editor._lastPushedSnap) {
                        const snapshot = JSON.parse(editor._lastPushedSnap);
                        snapshot.title = title;
                        editor._lastPushedSnap = JSON.stringify(snapshot);
                      }
                    },
                  });
              }
            }
            } finally {
              // パスと版の印を付け替えた後（失敗時も）に、待たせていた保存を通す。
              if (releaseFileRename) {
                editor._fileRenamePending = null;
                releaseFileRename();
              }
            }
          } catch (e) {
            // タイトル＝ファイル名（v0.7.495）を優先し、ファイル名を変えられなかった時はタイトルも
            // 元に戻す（2026-11-18 ユーザー判断）。先に変えたツリーとタブの名前も元のファイル名へ戻す。
            // 失敗を待つ間にタイトルを打ち直した場合は、その新しい入力を消さない。
            if (newTitle !== previousTitle && editor._path === oldPath && editor.doc?.title === titleInput.value) {
              editor.doc.title = previousTitle;
              titleInput.value = previousTitle;
              const fileStem = String(oldPath).split(/[\\/]/).pop().replace(/\.(?:mel-scenario|scenario\.json|scriptnote\.json|json)$/i, '');
              showTreeLabel(previousTitle || fileStem);
            }
            if (typeof showStatus === 'function') showStatus('ファイル名の変更に失敗: ' + (e.message || e), true);
          } finally {
            if (titleHistory && !titleHistory.finished) {
              titleHistory.cancel();
              if (editor._lastPushedSnap) {
                const snapshot = JSON.parse(editor._lastPushedSnap);
                snapshot.title = editor.doc.title;
                editor._lastPushedSnap = JSON.stringify(snapshot);
              }
            }
          }
        }
      }
    };
    // タイトルの確定（change）は1件ずつ順に処理する。並走すると、先の改名の結果を待たずに
    // 後の処理が旧パスで改名・保存を始めてしまう（S8）
    if (titleInput) titleInput.addEventListener('change', () => {
      const run = () => handleTitleChange().catch(() => {});
      this._titleChangeChain = (this._titleChangeChain || Promise.resolve()).then(run, run);
      return this._titleChangeChain;
    });
    // フィルタプリセットのドロップダウン
    const filterPresetSel = this.el.querySelector('#sn-filter-preset');
    if (filterPresetSel) {
      this._refreshFilterPresets();
      filterPresetSel.addEventListener('change', () => {
        const val = filterPresetSel.value;
        if (!this._editor) { filterPresetSel.value = '__all__'; return; }
        if (val === '__all__') {
          // フィルタ解除（すべて表示）
          this._editor._filterRoles = null;
          this._editor._hideRoles = null;
          this._editor._filterStatuses = null;
          this._editor._hideStatuses = null;
          this._editor._render();
          this.el.querySelector('#btn-filter')?.classList.remove('active');
          this._activeFilterPreset = '__all__';
          filterPresetSel.value = '__all__';
          return;
        }
        const presets = _snToolReadJsonObject(SN2_FILTER_PRESETS_STORAGE_KEY);
        const preset = presets[val];
        if (preset) {
          // 新形式: { visible: [...]|null, hidden: [...] }、旧形式: [...] (whitelist のみ)
          if (Array.isArray(preset)) {
            this._editor._filterRoles = new Set(preset);
            this._editor._hideRoles = null;
            this._editor._filterStatuses = null;
            this._editor._hideStatuses = null;
          } else {
            this._editor._filterRoles = preset.visible ? new Set(preset.visible) : null;
            this._editor._hideRoles = (preset.hidden && preset.hidden.length) ? new Set(preset.hidden) : null;
            this._editor._filterStatuses = Object.prototype.hasOwnProperty.call(preset, 'visibleStatuses') && preset.visibleStatuses !== null
              ? new Set(preset.visibleStatuses || [])
              : null;
            this._editor._hideStatuses = (preset.hiddenStatuses && preset.hiddenStatuses.length) ? new Set(preset.hiddenStatuses) : null;
          }
          if (!this._editor.doc?.editor?.statusEnabled) {
            this._editor._filterStatuses = null;
            this._editor._hideStatuses = null;
          }
          this._editor._render();
          const hasAny = !!this._editor._filterRoles
            || !!(this._editor._hideRoles && this._editor._hideRoles.size)
            || (!!this._editor.doc?.editor?.statusEnabled && !!this._editor._filterStatuses)
            || (!!this._editor.doc?.editor?.statusEnabled && !!(this._editor._hideStatuses && this._editor._hideStatuses.size));
          this.el.querySelector('#btn-filter')?.classList.toggle('active', hasAny);
          this._activeFilterPreset = val;
          filterPresetSel.value = val; // 選択中のプリセット名を維持
        }
      });
    }
  }

  _showNameModal({ title, label, placeholder, value = '', okText = '登録', onSubmit, returnFocus, onClose }) {
    const owner = returnFocus || document.activeElement;
    const inputId = `sn2-preset-name-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-input`;
    const content = document.createElement('div');
    content.innerHTML = `<div class="sn2-preset-status" role="status" aria-live="polite"></div><label class="sn2-preset-field" for="${inputId}"><span class="sn2-preset-label">${esc(label)}</span><input id="${inputId}" type="text" class="gb-input sn2-preset-name" data-e2e-id="scriptnote-name-input" placeholder="${esc(placeholder || '')}" value="${esc(value)}"></label>`;
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button'; cancelButton.className = 'gb-btn gb-btn-sm cancel-btn'; cancelButton.textContent = 'キャンセル';
    const okButton = document.createElement('button');
    okButton.type = 'button'; okButton.className = 'gb-btn gb-btn-sm gb-btn-primary primary ok-btn'; okButton.textContent = okText;
    // 安定ID と名前（S31）
    cancelButton.dataset.e2eId = 'scriptnote-name-cancel';
    cancelButton.setAttribute('aria-label', `${title}をキャンセル`);
    okButton.dataset.e2eId = 'scriptnote-name-submit';
    okButton.setAttribute('aria-label', `${title}: ${okText}`);
    let busy = false;
    const modalApi = window.GBUI.createModal({
      id: 'scriptnote-name', title, body: [...content.childNodes], footer: [cancelButton, okButton],
      variant: 'standard', geometryKey: 'scriptnote-name', minWidth: '0', initialFocus: '.sn2-preset-name',
      returnFocus: owner, closeLabel: `${title}を閉じる`, closeOnEsc: true, closeOnOverlay: true,
      onBeforeClose: () => !busy,
      onClose: reason => onClose?.(reason),
    });
    const overlay = modalApi.overlay;
    const panel = modalApi.modal;
    overlay.dataset.sn2Dialog = 'preset-name';
    overlay.dataset.e2eId = 'scriptnote-name-overlay';
    panel.dataset.e2eId = 'scriptnote-name-dialog';
    panel.classList.add('sn2-preset-modal');
    modalApi.body.classList.add('sn2-preset-modal-body');
    modalApi.footer.classList.add('sn2-preset-modal-actions');
    globalThis.GBScriptNoteDialogUI?.applyCompactTargets?.(panel);
    const input = panel.querySelector('.sn2-preset-name');
    const status = panel.querySelector('.sn2-preset-status');
    const setBusy = next => {
      busy = next;
      panel.setAttribute('aria-busy', next ? 'true' : 'false');
      okButton.disabled = next;
      cancelButton.disabled = next;
    };
    const submit = async () => {
      if (busy) return;
      const name = input.value.trim();
      if (!name) return;
      setBusy(true);
      status.textContent = '';
      try {
        const accepted = await onSubmit?.(name);
        if (accepted === false) { setBusy(false); return; }
        setBusy(false);
        modalApi.close('submit');
      } catch (error) {
        console.error('プリセット名の保存に失敗しました:', error);
        status.textContent = '保存できませんでした。入力内容を保ったまま再試行できます。';
        if (typeof showStatus === 'function') showStatus('保存できませんでした。もう一度お試しください', true);
        setBusy(false);
      }
    };
    okButton.addEventListener('click', submit);
    cancelButton.addEventListener('click', () => modalApi.close('cancel'));
    input.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      submit();
    });
    modalApi.open();
    input.select();
    return true;
  }

  _managedPresetConfig(kind) {
    const template = kind === 'template';
    return {
      kind,
      storageKey: template ? SN2_TEMPLATE_STORAGE_KEY : SN2_FILTER_PRESETS_STORAGE_KEY,
      orderKey: template ? SN2_TEMPLATE_ORDER_STORAGE_KEY : SN2_FILTER_PRESETS_ORDER_STORAGE_KEY,
      title: template ? 'テンプレート管理' : 'フィルタプリセット管理',
      itemLabel: template ? 'テンプレート' : 'フィルタプリセット',
      emptyText: template ? '登録済みテンプレートはありません' : '登録済みフィルタプリセットはありません',
    };
  }

  _reservedPresetName(kind, name) {
    if (kind === 'template') return name.startsWith('custom:') || ['manga', 'drama', 'afureko', 'stage'].includes(name);
    return name === '__all__' || name === '__delete__' || name === '__custom__' || name === 'すべて表示';
  }

  _currentFilterPresetValue() {
    if (!this._editor) return null;
    const filterRoles = this._editor._filterRoles;
    const hideRoles = this._editor._hideRoles;
    const filterStatuses = this._editor._filterStatuses;
    const hideStatuses = this._editor._hideStatuses;
    const hasFilter = !!filterRoles;
    const hasHide = !!(hideRoles && hideRoles.size);
    const hasStatusFilter = !!filterStatuses;
    const hasStatusHide = !!(hideStatuses && hideStatuses.size);
    if (!hasFilter && !hasHide && !hasStatusFilter && !hasStatusHide) return null;
    return {
      visible: hasFilter ? [...filterRoles] : null,
      hidden: hasHide ? [...hideRoles] : [],
      visibleStatuses: hasStatusFilter ? [...filterStatuses] : null,
      hiddenStatuses: hasStatusHide ? [...hideStatuses] : [],
    };
  }

  _savePresetValue(kind, name, value, { allowOverwrite = false, label, onSaved } = {}) {
    const cfg = this._managedPresetConfig(kind);
    const data = _snToolReadJsonObject(cfg.storageKey);
    if (this._reservedPresetName(kind, name)) { if (typeof showStatus === 'function') showStatus('この名前は予約済みです', true); return false; }
    if (!allowOverwrite && Object.prototype.hasOwnProperty.call(data, name)) { if (typeof showStatus === 'function') showStatus('同じ名前がすでにあります', true); return false; }
    const beforeStorage = _snToolCaptureStorageHistory([cfg.storageKey, cfg.orderKey]);
    const order = _snToolPresetNames(cfg.storageKey, cfg.orderKey);
    const storedValue = _snToolClone(value);
    if (kind === 'template') {
      const now = new Date().toISOString();
      storedValue.createdAt = data[name]?.createdAt || now;
      storedValue.updatedAt = now;
    }
    data[name] = storedValue;
    if (!order.includes(name)) order.push(name);
    _snToolWriteStorageAtomically([
      [cfg.storageKey, JSON.stringify(data)],
      [cfg.orderKey, JSON.stringify(_snToolFilteredPresetOrder(order, data))],
    ]);
    _snToolPushStorageHistory(label, beforeStorage, [cfg.storageKey, cfg.orderKey], name);
    this._refreshManagedPresetUi(kind);
    onSaved?.();
    return true;
  }

  _addTemplatePreset(options = {}) {
    if (!this._editor?.doc) return false;
    return this._showNameModal({
      title: options.title || 'テンプレート登録',
      label: 'テンプレート名',
      placeholder: 'マイテンプレート',
      okText: options.okText || '登録',
      onClose: options.onClose,
      onSubmit: name => {
        const value = globalThis.GBScriptNoteRoleModel?.createTemplate
          ? globalThis.GBScriptNoteRoleModel.createTemplate(this._editor.doc)
          : {
            layoutMode: this._editor.doc.layoutMode,
            editor: _snToolClone(this._editor.doc.editor || {}),
            scenarioTypes: _snToolClone(this._editor.doc.scenarioTypes || []),
            rubyPresentation: _snToolClone(this._editor.doc.rubyPresentation || {}),
          };
        const saved = this._savePresetValue('template', name, value, {
          allowOverwrite: options.allowOverwrite,
          label: 'シナリオ: テンプレート登録',
          onSaved: options.onSaved,
        });
        if (saved && typeof showStatus === 'function') showStatus(`テンプレート「${name}」を登録しました`);
        return saved;
      },
    });
  }

  _addFilterPreset(options = {}) {
    const value = this._currentFilterPresetValue();
    if (!value) { if (typeof showStatus === 'function') showStatus('フィルタが未設定です'); return false; }
    return this._showNameModal({
      title: options.title || 'フィルタプリセット登録',
      label: 'プリセット名',
      placeholder: 'キャラのみ',
      okText: options.okText || '登録',
      onClose: options.onClose,
      onSubmit: name => {
        const saved = this._savePresetValue('filter', name, value, {
          allowOverwrite: options.allowOverwrite,
          label: 'シナリオ: フィルタプリセット登録',
          onSaved: options.onSaved,
        });
        if (saved && typeof showStatus === 'function') showStatus(`フィルタプリセット「${name}」を登録しました`);
        return saved;
      },
    });
  }

  _showPresetManager(kind) {
    const cfg = this._managedPresetConfig(kind);
    const owner = document.activeElement;
    const content = document.createElement('div');
    content.innerHTML = `<div class="sn2-preset-manager-status" role="status" aria-live="polite"></div>
      <button type="button" class="tb-text-btn sn2-preset-manager-add" data-pm-add aria-label="${esc(cfg.itemLabel)}を追加"><span class="ico ico-plus"></span>追加</button>
      <div class="sn2-preset-manager-list" data-pm-list></div>`;
    const closeButton = document.createElement('button');
    closeButton.type = 'button'; closeButton.className = 'gb-btn gb-btn-sm cancel-btn'; closeButton.textContent = '閉じる';
    let busy = false, childOpen = false;
    const modalApi = window.GBUI.createModal({
      id: 'scriptnote-preset-manager', title: cfg.title, body: [...content.childNodes], footer: [closeButton],
      variant: 'standard', geometryKey: 'scriptnote-preset-manager', minWidth: '0', initialFocus: '[data-pm-add]',
      returnFocus: owner, closeLabel: `${cfg.title}を閉じる`, closeOnEsc: true, closeOnOverlay: true,
      onBeforeClose: () => !busy && !childOpen,
    });
    const overlay = modalApi.overlay;
    const panel = modalApi.modal;
    overlay.dataset.sn2Dialog = 'preset-manager';
    overlay.dataset.e2eId = 'scriptnote-preset-manager-overlay';
    panel.dataset.e2eId = 'scriptnote-preset-manager-dialog';
    panel.classList.add('sn2-preset-manager-modal');
    modalApi.body.classList.add('sn2-preset-manager-body');
    modalApi.footer.classList.add('sn2-preset-modal-actions');
    globalThis.GBScriptNoteDialogUI?.applyCompactTargets?.(panel);
    const list = panel.querySelector('[data-pm-list]');
    const status = panel.querySelector('.sn2-preset-manager-status');
    const addButton = panel.querySelector('[data-pm-add]');
    const render = () => {
      const names = _snToolPresetNames(cfg.storageKey, cfg.orderKey);
      list.innerHTML = '';
      if (!names.length) {
        const empty = document.createElement('div');
        empty.className = 'sn2-preset-manager-empty';
        empty.textContent = cfg.emptyText;
        list.appendChild(empty);
        return;
      }
      names.forEach((name, index) => {
        const row = document.createElement('div');
        row.className = 'sn2-preset-manager-row';
        row.dataset.pmName = name;
        const title = document.createElement('div');
        title.className = 'sn2-preset-manager-title';
        title.textContent = name;
        const tools = document.createElement('div');
        tools.className = 'sn2-preset-manager-tools';
        [['copy', '複製', 'ico-copy'], ['up', '上へ', 'ico-arrowUp'], ['down', '下へ', 'ico-arrowDown'], ['delete', '削除', 'ico-trash2']].forEach(([action, titleText, icon]) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = action === 'delete' ? 'tb-icon-btn sn2-preset-manager-btn sn2-preset-manager-btn--delete' : 'tb-icon-btn sn2-preset-manager-btn';
          btn.dataset.pmAction = action;
          btn.title = titleText;
          btn.setAttribute('aria-label', `${titleText}: ${name}`);
          btn.disabled = (action === 'up' && index === 0) || (action === 'down' && index === names.length - 1);
          btn.innerHTML = `<span class="ico ${icon}"></span>`;
          tools.appendChild(btn);
        });
        row.append(title, tools);
        list.appendChild(row);
      });
      if (typeof replaceIcons === 'function') replaceIcons(list);
      if (busy) list.querySelectorAll('button').forEach(button => { button.disabled = true; });
      // render()は一覧行をinnerHTMLごと作り直すため、初期化時に一度だけ行った
      // applyCompactTargetsではこの後に生成される行内ボタン（複製/上/下/削除）へ
      // タップ領域クラスが付かない。行を作り直すたびに再適用する。
      globalThis.GBScriptNoteDialogUI?.applyCompactTargets?.(panel);
    };
    const setBusy = next => {
      busy = next;
      panel.setAttribute('aria-busy', next ? 'true' : 'false');
      addButton.disabled = next;
      closeButton.disabled = next;
      if (next) list.querySelectorAll('button').forEach(button => { button.disabled = true; });
      else render();
    };
    const showMutationFailure = error => {
      console.error(`${cfg.itemLabel}の更新に失敗しました:`, error);
      status.textContent = '保存できませんでした。内容を保ったまま再試行できます。';
      if (typeof showStatus === 'function') showStatus('保存できませんでした。もう一度お試しください', true);
    };
    addButton.addEventListener('click', () => {
      if (busy || childOpen) return;
      childOpen = true;
      const opts = {
        allowOverwrite: false, okText: '追加', onSaved: render, title: cfg.itemLabel + '追加',
        onClose: () => { childOpen = false; },
      };
      const opened = kind === 'template' ? this._addTemplatePreset(opts) : this._addFilterPreset(opts);
      if (opened === false) childOpen = false;
    });
    list.addEventListener('click', async event => {
      const btn = event.target.closest('[data-pm-action]');
      const name = btn?.closest('[data-pm-name]')?.dataset.pmName;
      if (!btn || !name || busy || childOpen) return;
      const action = btn.dataset.pmAction;
      let deleteResult = false;
      if (action === 'copy') {
        childOpen = true;
        const opened = this._duplicateManagedPreset(kind, name, render, () => { childOpen = false; });
        if (opened === false) childOpen = false;
      }
      try {
        if (action === 'up' || action === 'down') {
          this._moveManagedPreset(kind, name, action === 'up' ? -1 : 1, render);
          const movedRow = [...list.querySelectorAll('[data-pm-name]')].find(item => item.dataset.pmName === name);
          const sameAction = movedRow?.querySelector(`[data-pm-action="${action}"]`);
          const oppositeAction = movedRow?.querySelector(`[data-pm-action="${action === 'up' ? 'down' : 'up'}"]`);
          const focusTarget = !sameAction?.disabled ? sameAction : (!oppositeAction?.disabled ? oppositeAction : movedRow?.querySelector('[data-pm-action="copy"]'));
          focusTarget?.focus?.();
        }
        if (action === 'delete') {
          setBusy(true);
          deleteResult = await this._deleteManagedPreset(kind, name, render);
          status.textContent = '';
        }
      } catch (error) {
        showMutationFailure(error);
      } finally {
        if (action === 'delete') {
          setBusy(false);
          const sameRow = [...list.querySelectorAll('[data-pm-name]')].find(item => item.dataset.pmName === name);
          const focusTarget = deleteResult
            ? list.querySelector('[data-pm-action]') || addButton
            : sameRow?.querySelector('[data-pm-action="delete"]') || addButton;
          focusTarget?.focus?.();
        }
      }
    });
    closeButton.addEventListener('click', () => modalApi.close('close'));
    render();
    if (typeof replaceIcons === 'function') replaceIcons(overlay);
    modalApi.open();
    return true;
  }

  _duplicateManagedPreset(kind, name, onSaved, onClose) {
    const cfg = this._managedPresetConfig(kind);
    const data = _snToolReadJsonObject(cfg.storageKey);
    if (!Object.prototype.hasOwnProperty.call(data, name)) return false;
    let savedCopyName = '';
    const returnFocus = () => {
      const manager = document.querySelector('[data-e2e-id="scriptnote-preset-manager-dialog"]');
      const targetName = savedCopyName || name;
      const row = [...(manager?.querySelectorAll('[data-pm-name]') || [])]
        .find(item => item.dataset.pmName === targetName);
      return row?.querySelector('[data-pm-action="copy"]') || manager?.querySelector('[data-pm-add]');
    };
    return this._showNameModal({
      title: cfg.itemLabel + '複製',
      label: cfg.itemLabel + '名',
      placeholder: name,
      value: _snToolUniquePresetName(name, Object.keys(data)),
      okText: '複製',
      returnFocus,
      onClose,
      onSubmit: copyName => {
        const beforeStorage = _snToolCaptureStorageHistory([cfg.storageKey, cfg.orderKey]);
        const nextData = _snToolReadJsonObject(cfg.storageKey);
        if (!Object.prototype.hasOwnProperty.call(nextData, name)) return false;
        if (this._reservedPresetName(kind, copyName) || Object.prototype.hasOwnProperty.call(nextData, copyName)) {
          if (typeof showStatus === 'function') showStatus('この名前は使えません', true);
          return false;
        }
        const order = _snToolPresetNames(cfg.storageKey, cfg.orderKey).filter(item => item !== copyName);
        order.splice(Math.max(0, order.indexOf(name)) + 1, 0, copyName);
        nextData[copyName] = _snToolClone(nextData[name]);
        if (kind === 'template') {
          const now = new Date().toISOString();
          nextData[copyName].createdAt = now;
          nextData[copyName].updatedAt = now;
        }
        _snToolWriteStorageAtomically([
          [cfg.storageKey, JSON.stringify(nextData)],
          [cfg.orderKey, JSON.stringify(_snToolFilteredPresetOrder(order, nextData))],
        ]);
        _snToolPushStorageHistory('シナリオ: ' + cfg.itemLabel + '複製', beforeStorage, [cfg.storageKey, cfg.orderKey], copyName);
        this._refreshManagedPresetUi(kind);
        savedCopyName = copyName;
        onSaved?.();
        if (typeof showStatus === 'function') showStatus(`${cfg.itemLabel}「${copyName}」を複製しました`);
        return true;
      },
    });
  }

  _moveManagedPreset(kind, name, dir, onSaved) {
    const cfg = this._managedPresetConfig(kind);
    const data = _snToolReadJsonObject(cfg.storageKey);
    const order = _snToolPresetNames(cfg.storageKey, cfg.orderKey);
    const index = order.indexOf(name);
    const nextIndex = index + dir;
    if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return;
    const beforeStorage = _snToolCaptureStorageHistory([cfg.storageKey, cfg.orderKey]);
    [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
    _snToolWritePresetOrder(cfg.orderKey, order, data);
    _snToolPushStorageHistory('シナリオ: ' + cfg.itemLabel + '並べ替え', beforeStorage, [cfg.storageKey, cfg.orderKey], name);
    this._refreshManagedPresetUi(kind);
    onSaved?.();
  }

  async _deleteManagedPreset(kind, name, onSaved) {
    const cfg = this._managedPresetConfig(kind);
    if (!Object.prototype.hasOwnProperty.call(_snToolReadJsonObject(cfg.storageKey), name)) return false;
    if (typeof cfConfirm === 'function' && !await cfConfirm(`プリセット「${name}」を削除しますか？`, { danger: true, okLabel: '削除' })) return false;
    if (typeof cfConfirm !== 'function' && typeof confirm === 'function' && !confirm(`プリセット「${name}」を削除しますか？`)) return false;
    const data = _snToolReadJsonObject(cfg.storageKey);
    if (!Object.prototype.hasOwnProperty.call(data, name)) return false;
    const beforeStorage = _snToolCaptureStorageHistory([cfg.storageKey, cfg.orderKey]);
    const order = _snToolPresetNames(cfg.storageKey, cfg.orderKey);
    delete data[name];
    _snToolWriteStorageAtomically([
      [cfg.storageKey, JSON.stringify(data)],
      [cfg.orderKey, JSON.stringify(_snToolFilteredPresetOrder(order, data))],
    ]);
    if (kind === 'filter' && this._activeFilterPreset === name) this._clearActiveFilterPreset();
    const deleteLabel = kind === 'template' ? 'シナリオ: テンプレート削除' : 'シナリオ: フィルタプリセット削除';
    _snToolPushStorageHistory(deleteLabel, beforeStorage, [cfg.storageKey, cfg.orderKey], name);
    this._refreshManagedPresetUi(kind);
    onSaved?.();
    if (typeof showStatus === 'function') showStatus(`${cfg.itemLabel}「${name}」を削除しました`);
    return true;
  }

  _clearActiveFilterPreset() {
    if (!this._editor) return;
    this._editor._filterRoles = null;
    this._editor._hideRoles = null;
    this._editor._filterStatuses = null;
    this._editor._hideStatuses = null;
    this._editor._render();
    this.el?.querySelector('#btn-filter')?.classList.remove('active');
    this._activeFilterPreset = '__all__';
  }

  _refreshManagedPresetUi(kind) {
    if (kind === 'template') this._refreshTemplateSelect();
    else this._refreshFilterPresets();
  }

  _refreshFilterPresets() {
    const sel = this.el?.querySelector('#sn-filter-preset');
    if (!sel) return;
    const presets = _snToolReadJsonObject(SN2_FILTER_PRESETS_STORAGE_KEY);
    while (sel.options.length > 1) sel.remove(1);
    _snToolPresetNames(SN2_FILTER_PRESETS_STORAGE_KEY, SN2_FILTER_PRESETS_ORDER_STORAGE_KEY).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    if (this._activeFilterPreset && Object.prototype.hasOwnProperty.call(presets, this._activeFilterPreset)) sel.value = this._activeFilterPreset;
    else sel.value = '__all__';
  }

  _syncTabStateFromScenario() {
    const path = this._editor?._path || this.state.scenarioPath || '';
    const label = this.state.label || this._editor?.doc?.title || (path ? path.split('/').pop().replace(/\.\w+$/, '') : '');
    if (path) this.state.scenarioPath = path;
    if (label) this.state.label = label;
    if (typeof GBTabs !== 'undefined' && this.tabId && label) {
      GBTabs.setTabLabel?.(this.tabId, label);
    }
    if (typeof GBLayout === 'undefined' || !this.paneId || !this.tabId) return;
    const paneInfo = GBLayout.findNode?.(GBLayout.root, this.paneId);
    const tab = paneInfo?.node?.tabs?.find?.(item => item.id === this.tabId) || null;
    if (!tab) return;
    if (path) tab.path = path;
    if (label) tab.label = label;
    tab.state = {
      ...(tab.state || {}),
      scenarioPath: path,
      label,
      noteLayoutMode: this.state.noteLayoutMode || tab.state?.noteLayoutMode || '',
    };
    GBLayout.saveLayout?.();
  }

  async _loadScenario(path, options = {}) {
    const nextPath = path || '';
    const coordinator = window.MeldexDocumentSaveCoordinator;
    const documentKey = coordinator && nextPath ? coordinator.documentKeyForPath(nextPath) : nextPath;
    // 競合確認からの明示的な再読込だけが保留状態を解除できる。
    // 通常のタブ再表示・別パネルでの同一ファイル読込では、他の編集面が保持する
    // 未保存競合を勝手に解決しない。
    const conflictGeneration = Object.prototype.hasOwnProperty.call(options, 'conflictGeneration')
      ? options.conflictGeneration
      : null;
    const loadSeq = (this._loadSeq || 0) + 1;
    this._loadSeq = loadSeq;
    const isStaleLoad = () => this._loadSeq !== loadSeq;
    const previousPath = this._editor?._path || this.state.scenarioPath || '';
    const previousLabel = this.state.label || this._editor?.doc?.title || (previousPath ? previousPath.split('/').pop().replace(/\.\w+$/, '') : '');
    const fallbackLabel = nextPath ? nextPath.split('/').pop().replace(/\.\w+$/, '') : '';
    // 通常の対象切替では、現行シナリオのIME/DOM入力とautosaveを確定してから
    // 次のファイルを読む。競合レビューからの再読込は直前に回復用下書きを明示保存
    // しているため、conflictGeneration付き経路だけこのflushを重ねない。
    if (previousPath && nextPath !== previousPath && conflictGeneration == null && this._editor) {
      const flushed = await this.flush();
      if (flushed === false) {
        if (typeof showStatus === 'function') {
          showStatus('シナリオを保存できなかったため、切り替えを中止しました', true);
        }
        return false;
      }
      if (isStaleLoad()) return false;
    }
    const showGlobalLoading = !options.silent && !options.skipGlobalUi
      && typeof showLoading === 'function' && typeof hideLoading === 'function';
    const loading = showGlobalLoading ? showLoading('シナリオを読み込み中...', { key: 'scenario:' + nextPath }) : null;
    try {
      await window.MeldexCloudAssets?.load('scenario');
      if (isStaleLoad()) return false;
      const data = await apiFetch('/file?path=' + encodeURIComponent(nextPath));
      if (isStaleLoad()) return false;
      const content = data.content || '{}';
      if (showGlobalLoading && typeof showLoadingBeforeHeavyWork === 'function') {
        await showLoadingBeforeHeavyWork(content, '大きいシナリオを描画中...', { loading });
        if (isStaleLoad()) return false;
      }
      let parsed = _sn2ParseScenarioContent(content, nextPath);
      let etag = data.etag || '';
      let identity = data;
      let restoredDraft = false;
      const key = coordinator?.bindDocumentIdentity?.(nextPath, data) || documentKey;
      const pending = conflictGeneration == null ? coordinator?.getConflict?.(key) : null;
      if (pending) {
        // 閉じた競合タブを開き直した時も、レビュー対象は利用者の未保存内容。
        // 最新サーバ本文をローカル内容として上書き候補にしない。
        const current = this._editor?._path === nextPath && this._editor?._dirty ? this._editor : null;
        const drafts = current ? [] : await window.MeldexDraftRecovery?.listDrafts?.() || [];
        if (isStaleLoad()) return false;
        const draft = drafts.find(item => (coordinator?.documentKeyForPath?.(item.path) || item.path) === key);
        const local = current ? JSON.stringify(current.collectDoc()) : draft?.content || pending.localMd;
        if (local) {
          const recovered = JSON.parse(local);
          if (typeof isScriptNoteFileDoc !== 'function' || isScriptNoteFileDoc(recovered)) {
            parsed = recovered;
            etag = current?._lastSavedEtag || draft?.lastSyncedAt || pending.localEtag || '';
            identity = { ...data, transport_revision: current?._lastSavedTransportRevision || pending.localEtag || etag };
            restoredDraft = true;
          }
        }
      }
      _sn2ExpandDefaultFileStyle(parsed);

      if (typeof isScriptNoteFileDoc === 'function' && !isScriptNoteFileDoc(parsed)) {
        throw new Error('シナリオ形式ファイルではありません。旧シナリオからインポートしてください。');
      }

      const host = this.el?.querySelector?.('#scenario-note-surface');
      if (!host) throw new Error('シナリオエディタの表示先が見つかりません');

      // エディタ初期化
      if (!this._editor) {
        this._editor = new ScriptNoteEditor(host);
      } else {
        this._editor.host = host;
        host.__meldexScriptNoteEditor = this._editor;
      }
      const loaded = this._editor.loadDoc(parsed, nextPath, etag, conflictGeneration, identity);
      if (!loaded) {
        throw new Error('競合状態が更新されたため、再読込を中止しました');
      }
      if (restoredDraft) this._editor._dirty = true;
      // ツールバー直下のビュータブ（絞り込みと操作単位をファイル内のビューとして切り替える）
      this._editor._mountScenarioViewTabs?.(this.el?.querySelector?.('#se-toolbar'));
      this.state.scenarioPath = nextPath;
      this.state.label = parsed.title || fallbackLabel;
      this._syncReadOnlyFromFileLock();

      // UI反映
      const titleInput = this.el?.querySelector?.('#title-input');
      if (titleInput) titleInput.value = parsed.title || '';
      window.MeldexFileLockBadge?.apply?.(titleInput, nextPath);
      const layoutSel = this.el?.querySelector?.('#scenario-note-layout-select');
      if (layoutSel) layoutSel.value = parsed.layoutMode || 'manga';
      this.state.noteLayoutMode = parsed.layoutMode || 'manga';
      this._syncTabStateFromScenario();
      this._syncEditorToggleButtons();

      // ナビゲーション登録
      if (!options.skipSaveLastView && typeof saveLastView === 'function') {
        saveLastView({ type: 'scriptnote', label: this.state.label || nextPath.split('/').pop(), path: nextPath });
      }
      if (!options.skipNavPush && typeof navPush === 'function') {
        const _navEntry = { type: 'scriptnote', label: this.state.label || nextPath.split('/').pop(), path: nextPath };
        navPush(_navEntry);
      }
      if (!options.skipRecent && typeof addRecent === 'function') {
        addRecent(this.state.label || nextPath.split('/').pop(), nextPath, 'scriptnote');
      }
      if (!options.skipAutoVersion && typeof startAutoVersion === 'function') startAutoVersion(nextPath, 'file');
      // ヒストリースコープ設定
      if (typeof historySetScope === 'function') historySetScope(this._editor._historyScope());
      if (this._skipDetailSync !== true && this._active) this._syncDetailPanel();
      // 詳細欄の初期描画が補う既定の表示設定も、読込直後の基準へ含める。
      // 含めないと未編集でも「編集」が履歴へ割り込み、ファイル複製の取り消しが
      // 元のシナリオまで保存し直してしまう。
      this._editor._lastPushedSnap = this._editor._takeSnapshot();
      // アノテートフローティング UI を再評価（targetPath を新ファイルに合わせ、ボタン表示を更新）
      // showView 経由ではコンポーネントタイプは早期 return するため、ここで明示的に呼ぶ
      if (typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.mountFloatingAnnotationUi === 'function') {
        GBPaneBridge.mountFloatingAnnotationUi();
      }
      if (this.el) delete this.el.dataset.loadFailed;
      if (!options.skipStatus && typeof showStatus === 'function') showStatus('シナリオを読み込みました');
      return true;
    } catch (err) {
      this._lastLoadError = err;
      if (this.el) this.el.dataset.loadFailed = '1';
      if (!this._editor?.doc) {
        this.state.scenarioPath = '';
        this.state.label = '';
        this._renderEmptyState();
        this._syncTabStateFromScenario();
      } else {
        this.state.scenarioPath = this._editor._path || previousPath;
        this.state.label = this._editor.doc?.title || previousLabel;
        this.state.noteLayoutMode = this._editor.doc?.layoutMode || this.state.noteLayoutMode || '';
        this._syncTabStateFromScenario();
      }
      if (!options.skipStatus && typeof showStatus === 'function') showStatus('シナリオの読み込みに失敗: ' + err.message, true);
      return false;
    } finally {
      if (showGlobalLoading) {
        hideLoading(loading);
      }
    }
  }
}

registerToolComponent('scriptnote', { cls: ScriptNoteComponent, icon: 'bookOpenText', label: 'シナリオ', multi: true, requiresViewLock: true });
