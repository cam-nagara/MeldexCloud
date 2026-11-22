/**
 * gb-autolink.js — 自動リンク統一ロジック
 *
 * マッチングロジック、HTML文字列版・DOM直接操作版、リンク辞書管理を統一。
 * ノート、台本、DB、ボード、詳細パネルで同じマッチング結果を保証する。
 */
const MeldexDisplayLayers = window.MeldexDisplayLayers || (() => {
  // コメント表示は従来どおりアプリ全体で1つの値。
  // 自動リンク・自動ルビはファイルごとの値で、各アプリが自分のファイルに保存する（2026-11-21）。
  // 旧版（v0.7.528以前）がここに保存していた全体共通の autoLinks は、自分の値を一度も
  // 保存していないファイルの初期値としてだけ読む（この端末で今まで見えていた表示を変えないため）。
  const STORAGE_KEY = 'meldex.displayLayers.v1';
  const DEFAULTS = { comments: false };
  const FILE_LAYERS = ['autoLinks', 'autoRuby'];
  const LABELS = { autoLinks: '自動リンク', autoRuby: '自動ルビ', comments: 'コメント表示' };
  const ICONS = { autoLinks: 'externalLink', autoRuby: 'furigana', comments: 'messageSquare' };
  let _state = null;
  const _scopes = new Map();
  const _resolvers = [];
  const _apps = new Map();

  function _read() {
    if (_state) return _state;
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      _state = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
    } catch {
      _state = { ...DEFAULTS };
    }
    return _state;
  }

  function _write(next) {
    _state = { ...DEFAULTS, ...next };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_state)); } catch {}
    refreshControls();
    try { window.dispatchEvent(new CustomEvent('meldex-display-layers-change', { detail: { ..._state } })); } catch {}
  }

  // 同じファイルを絶対パスと保存先からの相対パスの両方で呼ぶ面があるので、保存先の分を取り除いて比べる。
  function normalizePath(path) {
    let key = String(path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    let vault = '';
    try { vault = (typeof state !== 'undefined' && state?.vaultPath) ? String(state.vaultPath) : ''; } catch {}
    vault = vault.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    if (vault && key.startsWith(vault + '/')) key = key.slice(vault.length + 1);
    return key.replace(/^\/+/, '');
  }

  // 旧版の全体共通の値（自分の値を保存していないファイルの初期値）。
  function legacyAutoLinks() {
    return _read().autoLinks === true;
  }

  // 旧版は自動リンクにルビも付けていたので、旧版で自動リンクを見ていた端末では自動ルビもオンで始める。
  function defaultFileState(options = {}) {
    const legacy = legacyAutoLinks();
    return {
      autoLinks: legacy,
      autoRuby: options.supportsAutoRuby === false ? false : (legacy || options.autoRubyDefault === true),
    };
  }

  function _bool(value) {
    if (value === true || value === false) return value;
    if (value === 1 || value === '1' || value === 'true' || value === 'on') return true;
    if (value === 0 || value === '0' || value === 'false' || value === 'off') return false;
    return undefined;
  }

  // 保存値（欠けた項目は初期値）からファイルの状態を作る。
  function normalizeFileState(raw, options = {}) {
    const base = defaultFileState(options);
    const source = raw && typeof raw === 'object' ? raw : {};
    const autoLinks = _bool(source.autoLinks);
    const autoRuby = _bool(source.autoRuby);
    return {
      autoLinks: autoLinks === undefined ? base.autoLinks : autoLinks,
      autoRuby: options.supportsAutoRuby === false ? false : (autoRuby === undefined ? base.autoRuby : autoRuby),
    };
  }

  function hasStoredState(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return _bool(source.autoLinks) !== undefined || _bool(source.autoRuby) !== undefined;
  }

  // アプリが開いたファイルの状態を登録する。表示（自動リンク・自動ルビの適用）はこの値を見る。
  function setFileState(path, fileState, options = {}) {
    const key = normalizePath(path);
    if (!key) return null;
    const next = normalizeFileState(fileState, options);
    const prev = _scopes.get(key)?.state;
    _scopes.set(key, { state: next, supportsAutoRuby: options.supportsAutoRuby !== false });
    if (!prev || prev.autoLinks !== next.autoLinks || prev.autoRuby !== next.autoRuby) refreshControls();
    return { ...next };
  }

  function clearFileState(path) {
    _scopes.delete(normalizePath(path));
  }

  function registerResolver(fn) {
    if (typeof fn === 'function' && !_resolvers.includes(fn)) _resolvers.push(fn);
  }

  function stateFor(path) {
    const key = normalizePath(path);
    if (key) {
      const entry = _scopes.get(key);
      if (entry) return { ...entry.state };
      for (const resolve of _resolvers) {
        try {
          const resolved = resolve(path, key);
          if (resolved && typeof resolved === 'object') return { autoLinks: !!resolved.autoLinks, autoRuby: !!resolved.autoRuby };
        } catch {}
      }
    }
    // 登録の無いファイル（ノートを出す面の一部）は、自分の値を保存していないノートと同じ初期値。
    return defaultFileState();
  }

  function isEnabled(layer, path) {
    if (layer === 'comments') return !!_read().comments;
    if (!FILE_LAYERS.includes(layer)) return false;
    if (arguments.length < 2) {
      // ファイルを指定しない問い合わせ（辞書の更新後に今のファイルを描き直すか等）は、
      // どれか1つでもオンのファイルがあるか、または初期値がオンかで答える。
      if (defaultFileState()[layer]) return true;
      for (const entry of _scopes.values()) if (entry.state[layer]) return true;
      return false;
    }
    return !!stateFor(path)[layer];
  }

  function _reloadCurrentView() {
    try {
      if (typeof reloadCurrentOpenFile === 'function') {
        reloadCurrentOpenFile();
        return;
      }
    } catch {}
    try {
      if (typeof state !== 'undefined' && state.currentPagePath && typeof openPage === 'function') {
        openPage(document.getElementById('page-title')?.textContent || state.currentPagePath, state.currentPagePath, { skipNavPush: true });
      }
    } catch {}
  }

  // 全体共通の層（コメント表示）。自動リンクを指定した場合は、旧版の全体の値
  // （自分の値を保存していないファイルの初期値）を書き換える。
  function setLayer(layer, enabled, options = {}) {
    if (layer !== 'comments' && layer !== 'autoLinks') return;
    const next = { ..._read(), [layer]: !!enabled };
    _write(next);
    if (!options.silent) _reloadCurrentView();
  }

  function toggleLayer(layer) {
    setLayer(layer, !isEnabled(layer));
  }

  // ── ツールバーの切り替えボタン ──
  // adapter: { pathForButton(btn) -> ファイルのパス,
  //            write(path, nextState, btn, previousState) -> Promise<boolean>（ファイルへの保存と描き直し）,
  //            supportsAutoRuby: boolean }
  function registerApp(app, adapter) {
    if (!app || !adapter) return;
    _apps.set(String(app), adapter);
    refreshControls();
  }

  function _buttonPath(btn) {
    const adapter = _apps.get(btn?.dataset?.displayLayerApp || '');
    if (!adapter || typeof adapter.pathForButton !== 'function') return '';
    try { return String(adapter.pathForButton(btn) || ''); } catch { return ''; }
  }

  function buttonHtml(layer, app) {
    const label = LABELS[layer] || layer;
    const e2e = `${app}-display-${layer === 'autoLinks' ? 'autolinks' : layer === 'autoRuby' ? 'autoruby' : layer}`;
    return `<button type="button" class="tb-icon-btn gb-display-layer-btn" data-display-layer="${layer}" data-display-layer-app="${app}"`
      + ` data-e2e-id="${e2e}" aria-pressed="false" title="${label}: オフ" aria-label="${label}"`
      + ` data-action="MeldexDisplayLayers.toggleFromButton(this)"><span class="ico ico-${ICONS[layer]}"></span></button>`;
  }

  // 右領域（.tb-spacer の直後）の先頭に置く「自動リンク → 自動ルビ → 区切り」。
  function toolbarButtonsHtml(app, options = {}) {
    return buttonHtml('autoLinks', app)
      + (options.autoRuby ? buttonHtml('autoRuby', app) : '')
      + '<div class="sep gb-display-layer-sep"></div>';
  }

  function _applyButtonState(btn, layer, enabled, available) {
    const label = LABELS[layer] || layer;
    btn.classList.toggle('active', !!enabled);
    btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    const title = `${label}: ${enabled ? 'オン' : 'オフ'}`;
    if (btn.hasAttribute('data-gb-native-title')) btn.setAttribute('data-gb-native-title', title);
    else btn.title = title;
    if (available === false) btn.setAttribute('aria-disabled', 'true');
    else btn.removeAttribute('aria-disabled');
  }

  function refreshControls() {
    const globalState = _read();
    document.querySelectorAll('[data-display-layer]').forEach(btn => {
      const layer = btn.dataset.displayLayer;
      if (layer === 'comments') {
        _applyButtonState(btn, layer, !!globalState.comments);
        return;
      }
      if (!FILE_LAYERS.includes(layer)) return;
      const path = _buttonPath(btn);
      _applyButtonState(btn, layer, path ? !!stateFor(path)[layer] : false, !!path);
    });
  }

  async function toggleFromButton(btn) {
    const layer = btn?.dataset?.displayLayer;
    if (layer === 'comments') { toggleLayer('comments'); return true; }
    if (!FILE_LAYERS.includes(layer)) return false;
    const app = btn.dataset.displayLayerApp || '';
    const path = _buttonPath(btn);
    if (!_apps.get(app) || !path) {
      if (typeof showStatus === 'function') showStatus('ファイルを開くと切り替えられます', true);
      return false;
    }
    return setForFile(app, path, { [layer]: !stateFor(path)[layer] }, btn);
  }

  // ファイルの状態を変えて保存する（保存に失敗したら元に戻す）。
  async function setForFile(app, path, patch, btn) {
    const adapter = _apps.get(String(app || ''));
    if (!adapter || !path) return false;
    const options = { supportsAutoRuby: adapter.supportsAutoRuby !== false };
    const previous = stateFor(path);
    const next = normalizeFileState({ ...previous, ...(patch || {}) }, options);
    if (next.autoLinks === previous.autoLinks && next.autoRuby === previous.autoRuby) return true;
    setFileState(path, next, options);
    let ok = false;
    try {
      ok = await adapter.write(path, next, btn, previous);
    } catch (error) {
      console.warn('[Meldex] 自動リンク・自動ルビの切り替えを保存できませんでした', error);
      ok = false;
    }
    if (ok === false) {
      setFileState(path, previous, options);
      refreshControls();
      return false;
    }
    refreshControls();
    try {
      window.dispatchEvent(new CustomEvent('meldex-display-layers-change', { detail: { app, path, state: { ...next } } }));
    } catch {}
    return true;
  }

  function scheduleIdle(fn, timeout = 800) {
    if (typeof requestIdleCallback === 'function') {
      return requestIdleCallback(fn, { timeout });
    }
    return setTimeout(fn, 0);
  }

  document.addEventListener('DOMContentLoaded', refreshControls);
  setTimeout(refreshControls, 0);

  return {
    STORAGE_KEY,
    FILE_LAYERS,
    getState: () => ({ ..._read() }),
    isEnabled,
    setLayer,
    toggleLayer,
    refreshControls,
    scheduleIdle,
    normalizePath,
    legacyAutoLinks,
    defaultFileState,
    normalizeFileState,
    hasStoredState,
    setFileState,
    clearFileState,
    registerResolver,
    stateFor,
    registerApp,
    buttonHtml,
    toolbarButtonsHtml,
    toggleFromButton,
    setForFile,
  };
})();
window.MeldexDisplayLayers = MeldexDisplayLayers;

const MeldexAutoLink = (() => {
  // ── リンク辞書 ──
  let _linkDict = [];
  let _dictLoadSeq = 0;
  let _dictScope = '';
  let _dictRevision = 0;

  function _normalizeDictScope(workFolder) {
    return String(workFolder || '').replace(/\\/g, '/').replace(/\/+$/, '');
  }

  function _currentWorkFolderScope() {
    const wf = typeof getWorkFolder === 'function' ? getWorkFolder() : '';
    return _normalizeDictScope(wf);
  }

  function _ensureActiveWorkFolderScope(filePath) {
    if (typeof getWorkFolder !== 'function') return;
    const folder = getWorkFolder(filePath);
    const scope = _normalizeDictScope(folder);
    // 非アクティブ面の描画で、現在の作品の辞書を取り替えない。
    if (scope !== _currentWorkFolderScope() || scope === _dictScope) return;
    // loadDict は開始時にscopeを更新し、世代番号で古い応答を拒否する。
    // 読込後の既存通知が現在のファイルへ自動リンクを再適用する。
    void loadDict(folder);
  }

  function _isCloudLinkDictUnavailable() {
    return false;
  }

  function _notifyDictChanged(scope) {
    _dictRevision += 1;
    try {
      window.dispatchEvent(new CustomEvent('meldex-autolink-dict-change', {
        detail: { scope, revision: _dictRevision },
      }));
    } catch {}
    if (!MeldexDisplayLayers.isEnabled('autoLinks') && !MeldexDisplayLayers.isEnabled('autoRuby')) return;
    MeldexDisplayLayers.scheduleIdle(() => {
      try {
        if (typeof reloadCurrentOpenFile === 'function') reloadCurrentOpenFile();
      } catch {}
    }, 1000);
  }

  function _normalizeDictEntries(entries) {
    if (!Array.isArray(entries)) return [];
    return entries
      .filter(entry => entry && typeof entry.text === 'string' && entry.text.length >= 2)
      .map(entry => ({
        ...entry,
        text: entry.text,
        path: typeof entry.path === 'string' ? entry.path : '',
        ruby: typeof entry.ruby === 'string' ? entry.ruby : '',
      }));
  }

  // 辞書の中身の比較用。同じ配列を何度も比べるため結果を覚えておく。
  const _dictSignatures = new WeakMap();
  function _dictSignature(entries) {
    if (!Array.isArray(entries)) return '';
    if (_dictSignatures.has(entries)) return _dictSignatures.get(entries);
    let signature = '';
    try { signature = JSON.stringify(entries); } catch { signature = String(Math.random()); }
    _dictSignatures.set(entries, signature);
    return signature;
  }

  async function loadDict(workFolder) {
    const seq = ++_dictLoadSeq;
    const scope = _normalizeDictScope(workFolder);
    if (_isCloudLinkDictUnavailable()) {
      _dictScope = scope;
      _linkDict = [];
      _notifyDictChanged(scope);
      return _linkDict;
    }
    if (scope !== _dictScope) {
      _dictScope = scope;
      _linkDict = [];
      _notifyDictChanged(scope);
    }
    try {
      const url = workFolder ? '/link-dict?work=' + encodeURIComponent(workFolder) : '/link-dict';
      const data = await apiFetch(url);
      if (seq === _dictLoadSeq) {
        const next = _normalizeDictEntries(data.entries);
        // 中身も範囲も変わらない読み直しでは通知しない。通知は開いているファイルの
        // 再読み込みを起こし、シートの再読み込みはまた辞書の読み直しを予約するため、
        // 毎回通知すると数秒おきに辞書の作り直しとシートの再描画が止まらなくなっていた。
        const changed = scope !== _dictScope || _dictSignature(next) !== _dictSignature(_linkDict);
        _dictScope = scope;
        _linkDict = next;
        if (changed) _notifyDictChanged(scope);
      }
    } catch {
      // 一時的な取得失敗では既存辞書を保持する。同じ作業範囲の再読込失敗なら空にしない。
      if (seq === _dictLoadSeq && scope !== _dictScope) {
        _dictScope = scope;
        _linkDict = [];
        _notifyDictChanged(scope);
      }
    }
    return _linkDict;
  }

  function getDict() { return _linkDict; }
  function setDict(dict) {
    _dictLoadSeq += 1;
    _dictScope = _currentWorkFolderScope();
    _linkDict = _normalizeDictEntries(dict);
    _notifyDictChanged(_dictScope);
  }

  // ── 共通: テキストノード収集 ──
  function _collectTextNodes(el) {
    const nodes = [];
    const skippedTags = new Set(['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'CODE', 'PRE', 'KBD', 'SAMP', 'RT']);
    for (const child of el.childNodes) {
      if (child.nodeType === 3 && child.textContent) {
        nodes.push(child);
      } else if (child.nodeType === 1
        && !child.classList?.contains('auto-link')
        && !child.dataset?.autoLink
        && !skippedTags.has(child.tagName)
        && !child.dataset?.autoRuby) {
        nodes.push(..._collectTextNodes(child));
      }
    }
    return nodes;
  }

  // ── 共通: ソート済み辞書を取得 ──
  function _sortedDict() {
    return _normalizeDictEntries(_linkDict).sort((a, b) => b.text.length - a.text.length);
  }

  // ── 共通: span 要素を生成 ──
  // 自動リンクのリンクにはルビを付けない。自動ルビもオンの時だけ、辞書のルビを
  // リンクの上に付ける（ルビはリンクと同じ色になる）。
  function _createLinkSpan(entry, options = {}) {
    const span = document.createElement('span');
    span.className = 'auto-link';
    span.dataset.path = entry.path || '';
    span.dataset.autoLink = 'true';
    if (options.autoRuby && entry.ruby && !options.suppressRuby) {
      span.dataset.ruby = entry.ruby;
      span.style.position = 'relative';
    }
    span.textContent = entry.text;
    return span;
  }

  // 自動リンクがオフで自動ルビだけがオンの時の、リンクなしのルビ。本文の色・装飾は変えない。
  function _createRubySpan(entry) {
    const span = document.createElement('span');
    span.className = 'auto-ruby';
    span.dataset.autoRuby = 'dict';
    span.dataset.ruby = entry.ruby;
    span.textContent = entry.text;
    return span;
  }

  // 描く時の状態。呼び出し側が state を渡せばそれを、無ければ表示中のファイル
  // （displayPath。省略時は filePath）の状態を使う。force は旧呼び出し（自動リンクを強制）の互換。
  function _effectiveState(filePath, options = {}) {
    if (options.state && typeof options.state === 'object') {
      return { autoLinks: !!options.state.autoLinks, autoRuby: !!options.state.autoRuby };
    }
    const target = options.displayPath || filePath;
    const st = typeof MeldexDisplayLayers.stateFor === 'function'
      ? MeldexDisplayLayers.stateFor(target)
      : { autoLinks: !!MeldexDisplayLayers.isEnabled?.('autoLinks', target), autoRuby: !!MeldexDisplayLayers.isEnabled?.('autoRuby', target) };
    return options.force ? { ...st, autoLinks: true } : st;
  }

  // 辞書が付けた表示（リンク・リンクなしのルビ）を外す。シナリオの自動ルビルールの表示は残す。
  function strip(el) {
    if (!el?.querySelectorAll) return;
    const nodes = el.querySelectorAll('[data-auto-link], [data-auto-ruby="dict"]');
    if (!nodes.length) return;
    nodes.forEach(span => {
      span.replaceWith(document.createTextNode(span.textContent));
    });
    el.normalize();
  }

  function _normalizePathForScope(path) {
    return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  }

  function _isPathInside(filePath, rootPath) {
    const file = _normalizePathForScope(filePath);
    const root = _normalizePathForScope(rootPath);
    return !!file && !!root && (file === root || file.startsWith(root + '/'));
  }

  function _isInWorkFolderScope(filePath) {
    if (typeof getWorkFolder !== 'function') return true;
    const wf = getWorkFolder(filePath);
    if (_dictScope !== _normalizeDictScope(wf)) return false;
    if (!wf || !filePath) return true;
    const roots = [wf];
    const files = [filePath];
    const vaultPath = (typeof state !== 'undefined' && state?.vaultPath) ? String(state.vaultPath) : '';
    if (vaultPath && !/^[A-Za-z]:[\\/]/.test(wf) && !String(wf).startsWith('/')) {
      roots.push(vaultPath.replace(/\\/g, '/') + '/' + String(wf).replace(/^\/+/, ''));
    }
    if (vaultPath && !/^(?:[A-Za-z]:[\\/]|\/)/.test(String(filePath))) {
      files.push(vaultPath.replace(/\\/g, '/') + '/' + String(filePath));
    }
    return files.some(file => roots.some(root => _isPathInside(file, root)));
  }

  // ── HTML文字列版（ノート、ボード、詳細パネル用） ──
  function applyToHtml(html, filePath, options = {}) {
    const st = _effectiveState(filePath, options);
    if (!st.autoLinks && !st.autoRuby) return html;
    _ensureActiveWorkFolderScope(filePath);
    if (!html || _linkDict.length === 0) return html;

    if (!_isInWorkFolderScope(filePath)) return html;

    const div = document.createElement('div');
    div.innerHTML = html;
    _applyToDomInternal(div, st);
    return div.innerHTML;
  }

  // ── DOM直接操作版（シナリオ・シート・CSV・ノートの再適用用） ──
  // 既存の辞書由来の表示を外してから、ファイルの状態どおりに付け直す（オフなら外すだけ）。
  function applyToDom(el, filePath, options = {}) {
    if (!el) return;
    const st = _effectiveState(filePath, options);
    strip(el);
    if (!st.autoLinks && !st.autoRuby) return;
    _ensureActiveWorkFolderScope(filePath);
    if (_linkDict.length === 0) return;
    if (!_isInWorkFolderScope(filePath)) return;
    _applyToDomInternal(el, st);
  }

  // ── 内部: DOM要素内のテキストノードにリンク・ルビを適用 ──
  function _applyToDomInternal(el, st) {
    // 自動リンクがオフの時は、ルビのある語だけが対象（ルビの無い語は本文のまま）。
    const sorted = _sortedDict().filter(entry => st.autoLinks || (st.autoRuby && entry.ruby));
    if (sorted.length === 0) return;
    const textNodes = _collectTextNodes(el);
    for (const tNode of textNodes) {
      const content = tNode.textContent;
      if (!content) continue;
      let matched = false;
      const frag = document.createDocumentFragment();
      let lastIdx = 0;
      while (lastIdx < content.length) {
        let earliest = null;
        for (const entry of sorted) {
          if (!entry.text || entry.text.length < 2) continue;
          const pos = content.indexOf(entry.text, lastIdx);
          if (pos >= 0 && (!earliest || pos < earliest.pos || (pos === earliest.pos && entry.text.length > earliest.entry.text.length))) {
            earliest = { pos, entry };
          }
        }
        if (!earliest) break;
        matched = true;
        if (earliest.pos > lastIdx) frag.appendChild(document.createTextNode(content.slice(lastIdx, earliest.pos)));
        const suppressRuby = !!tNode.parentElement?.closest?.('[data-ruby], ruby');
        if (st.autoLinks) {
          frag.appendChild(_createLinkSpan(earliest.entry, { suppressRuby, autoRuby: st.autoRuby }));
        } else if (!suppressRuby) {
          frag.appendChild(_createRubySpan(earliest.entry));
        } else {
          frag.appendChild(document.createTextNode(earliest.entry.text));
        }
        lastIdx = earliest.pos + earliest.entry.text.length;
      }
      if (matched) {
        if (lastIdx < content.length) frag.appendChild(document.createTextNode(content.slice(lastIdx)));
        tNode.parentNode.replaceChild(frag, tNode);
      }
    }
  }

  // ── stripAutoLinks（auto-link スパンを除去） ──
  function stripFromHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    div.querySelectorAll('.auto-link, [data-auto-ruby="dict"]').forEach(el => {
      el.replaceWith(...el.childNodes);
    });
    let cleaned = div.innerHTML;
    cleaned = cleaned.replace(/&lt;span\s+class="auto-link"[^]*?&gt;([\s\S]*?)&lt;\/span&gt;/g, '$1');
    cleaned = cleaned.replace(/&amp;lt;span\s+class="auto-link"[^]*?&amp;gt;([\s\S]*?)&amp;lt;\/span&amp;gt;/g, '$1');
    return cleaned;
  }

  // ── リンク辞書の debounce 付き再読み込み ──
  let _reloadTimer = null;
  function scheduleReload(delayMs) {
    clearTimeout(_reloadTimer);
    _reloadTimer = setTimeout(async () => {
      _reloadTimer = null;
      const wf = typeof getWorkFolder === 'function' ? getWorkFolder() : '';
      await loadDict(wf);
    }, delayMs || 3000);
  }

  return {
    loadDict,
    getDict,
    setDict,
    applyToHtml,
    applyToDom,
    strip,
    stripFromHtml,
    scheduleReload,
  };
})();
