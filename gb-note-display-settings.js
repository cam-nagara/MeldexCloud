/* gb-note-display-settings.js — ノートのファイルごとの表示設定（2026-11-21）。
 *
 * - 自動リンク・自動ルビのオン/オフ（ツールバーの切り替え）
 * - ルビの表示設定（シナリオと同じ共通部品 MeldexRubySettingsUI の項目）
 *
 * どちらもノートのフロントマターへ保存する（別の端末・Cloudでも同じになる）:
 *
 *   meldex_display:
 *     auto_links: true
 *     auto_ruby: false
 *   ruby_presentation:
 *     sizePercent: 50
 *     ...
 *
 * 旧版はフロントマターを文字列のまま保って保存するので、これらのブロックは旧版でも消えない。
 * 書字方向だけはノートの縦書き（MeldexNoteWritingMode）と同じものなので、ファイルへは保存しない。
 *
 * ノート本文を出す面（ノート・トピックの自由記述・詳細パネル・ボードのノート・フロートパネル・
 * 右サイドバーのビューワー・スマホのドロワー）は、読み込み時に applyToHost() を呼んで、
 * そのファイルの状態を登録し、ルビの表示設定を本文へ当てる。
 */
(function (global) {
  'use strict';

  var DISPLAY_KEY = 'meldex_display';
  var RUBY_KEY = 'ruby_presentation';
  var RUBY_FIELDS = ['sizePercent', 'gapEm', 'letterSpacingEm', 'lineHeight', 'align', 'smallKana', 'fontPreset', 'defaultStyle'];
  var NOTE_HOST_SELECTOR = '#page-content, [data-editor-local-id="page-content"], #entity-freetext, #dp-editable, #board-note-editable, '
    + '.gb-subpanel-entity-note, .gb-preview-entity-note, .cloud-mobile-side-drawer-editable';

  function _blockRegex(key) {
    return new RegExp('^' + key + ':[ \\t]*\\r?\\n(?:[ \\t]+[A-Za-z_][A-Za-z0-9_]*:[^\\n]*\\r?\\n?)*', 'm');
  }

  function _scalar(raw) {
    var value = String(raw == null ? '' : raw).trim();
    if (!value) return '';
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
    if (value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
      try { return JSON.parse(value); } catch (_) { return value.slice(1, -1); }
    }
    if (value.charAt(0) === "'" && value.charAt(value.length - 1) === "'") return value.slice(1, -1).replace(/''/g, "'");
    return value;
  }

  function readBlock(frontmatter, key) {
    var match = String(frontmatter || '').match(_blockRegex(key));
    if (!match) return null;
    var out = {};
    match[0].split(/\r?\n/).slice(1).forEach(function (line) {
      var m = line.match(/^[ \t]+([A-Za-z_][A-Za-z0-9_]*):(.*)$/);
      if (m) out[m[1]] = _scalar(m[2]);
    });
    return out;
  }

  function _yamlValue(value) {
    if (value === true || value === false) return String(value);
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return JSON.stringify(String(value == null ? '' : value));
  }

  // フロントマター文字列の key ブロックを置き換える（values が空なら取り除く）。
  function writeBlock(frontmatter, key, values) {
    var fm = String(frontmatter || '');
    var entries = Object.keys(values || {}).filter(function (k) {
      return values[k] !== undefined && values[k] !== null && values[k] !== '';
    });
    var yaml = entries.length
      ? key + ':\n' + entries.map(function (k) { return '  ' + k + ': ' + _yamlValue(values[k]) + '\n'; }).join('')
      : '';
    var re = _blockRegex(key);
    if (re.test(fm)) {
      fm = fm.replace(re, yaml);
    } else if (yaml) {
      if (/^---\r?\n/.test(fm)) fm = fm.replace(/\r?\n---\r?\n?$/, '\n' + yaml + '---\n');
      else fm = '---\n' + yaml + '---\n';
    }
    if (fm.replace(/^---\r?\n\s*---\r?\n?$/, '').trim() === '') fm = '';
    return fm;
  }

  function _layers() { var l = global.MeldexDisplayLayers; return l && typeof l.registerApp === 'function' ? l : null; }
  function _model() { return global.MeldexRubyPresentation || null; }

  function readDisplayRaw(frontmatter) {
    var block = readBlock(frontmatter, DISPLAY_KEY) || {};
    return { autoLinks: block.auto_links, autoRuby: block.auto_ruby };
  }

  function displayStateFromFrontmatter(frontmatter) {
    var layers = _layers();
    var raw = readDisplayRaw(frontmatter);
    return layers ? layers.normalizeFileState(raw) : { autoLinks: raw.autoLinks === true, autoRuby: raw.autoRuby === true };
  }

  function writeDisplayState(frontmatter, next) {
    return writeBlock(frontmatter, DISPLAY_KEY, { auto_links: !!next.autoLinks, auto_ruby: !!next.autoRuby });
  }

  // ── ルビの表示設定 ──
  function noteRubyDefaults() {
    var model = _model();
    return model && typeof model.getGlobalDefaults === 'function' ? model.getGlobalDefaults('note') : null;
  }

  function rubyPresentationFromFrontmatter(frontmatter) {
    var model = _model();
    if (!model) return null;
    var stored = readBlock(frontmatter, RUBY_KEY) || {};
    var presentation = model.normalize(stored, noteRubyDefaults() || undefined);
    presentation.writingMode = global.MeldexNoteWritingMode?.isActive?.() ? 'vertical' : 'horizontal';
    delete presentation.compatibility;
    return presentation;
  }

  function writeRubyPresentation(frontmatter, presentation) {
    var values = {};
    RUBY_FIELDS.forEach(function (key) { if (presentation && presentation[key] !== undefined) values[key] = presentation[key]; });
    return writeBlock(frontmatter, RUBY_KEY, values);
  }

  // ノート本文のルビ表示へ設定を当てる（CSSの変数と属性）。
  function applyRubyPresentation(bodyHost, presentation) {
    var model = _model();
    if (!bodyHost || !bodyHost.style || !presentation || !model) return;
    // 本体のノート本文（#page-content）にはインラインstyleを置かない（縦書きの外部CSSが効かなくなる）。
    // 本文を包む枠へ変数と属性を当て、子孫の本文へ継承させる。
    var isMainBody = bodyHost.id === 'page-content' || bodyHost.dataset?.editorLocalId === 'page-content';
    var host = (isMainBody && bodyHost.closest?.('.note-editor-body')) || bodyHost;
    _appliedPresentation.set(bodyHost, presentation);
    var sizeRatio = Math.max(0.05, Number(presentation.sizePercent) / 100 || 0.5);
    host.style.setProperty('--note-ruby-size', sizeRatio + 'em');
    // 間隔は親文字の大きさが基準。ルビの疑似要素の em はルビの文字の大きさなので換算する。
    host.style.setProperty('--note-ruby-gap', ((Number(presentation.gapEm) || 0) / sizeRatio) + 'em');
    host.style.setProperty('--note-ruby-letter-spacing', Math.max(0, Number(presentation.letterSpacingEm) || 0) + 'em');
    host.style.setProperty('--note-ruby-line-height', String(presentation.lineHeight));
    host.style.setProperty('--note-ruby-font-family', (model.FONT_PRESETS && model.FONT_PRESETS[presentation.fontPreset]) || 'inherit');
    host.dataset.rubyAlign = presentation.align;
    host.dataset.rubySmallKana = presentation.smallKana;
    host.dataset.rubyDefaultStyle = presentation.defaultStyle;
    refreshRubyNodes(host);
  }

  function refreshRubyNodes(host) {
    var model = _model();
    if (!host || !host.querySelectorAll || !model) return;
    var owner = host.closest ? host.closest('[data-ruby-small-kana]') : null;
    var fullsize = (owner || host).dataset.rubySmallKana === 'fullsize';
    host.querySelectorAll('[data-ruby]').forEach(function (node) {
      var source = node.getAttribute('data-ruby') || '';
      var rendered = fullsize ? model.fullsizeKana(source) : source;
      if (node.getAttribute('data-ruby-rendered') !== rendered) node.setAttribute('data-ruby-rendered', rendered);
    });
    scheduleLayout(host);
  }

  // ルビの配置（グループ・モノ・熟語の配り方、隣のルビとの衝突の解決）をシナリオと同じ計算で求め、
  // 本文のルビへCSS変数で書く（MeldexRubyPresentation.layoutRubySpans。2026-11-21）。
  var _layoutTimers = new WeakMap();
  // 本文の要素ごとに、最後に当てたルビの表示設定（配置の計算はこれを使う）。
  var _appliedPresentation = new WeakMap();

  function _bodiesOf(host) {
    if (!host || !host.querySelectorAll) return [];
    if (host.matches && host.matches(NOTE_HOST_SELECTOR)) return [host];
    return Array.prototype.slice.call(host.querySelectorAll(NOTE_HOST_SELECTOR));
  }

  function layoutRuby(host) {
    var model = _model();
    if (!model || typeof model.layoutRubySpans !== 'function') return;
    _bodiesOf(host).forEach(function (body) {
      if (!body.isConnected) return;
      var spans = Array.prototype.slice.call(body.querySelectorAll('[data-ruby]'))
        .filter(function (span) { return !span.closest('.sn2-text, .sn2-custom-text'); });
      if (!spans.length) return;
      var presentation = _appliedPresentation.get(body) || rubyPresentationFromFrontmatter(body.dataset.frontmatter || '');
      spans.forEach(function (span) {
        var kind = span.getAttribute('data-ruby-style-source');
        var current = span.getAttribute('data-ruby-style');
        if (kind === 'default' || ['group', 'mono', 'jukugo'].indexOf(current) < 0) {
          span.setAttribute('data-ruby-style', presentation.defaultStyle);
          span.setAttribute('data-ruby-style-source', 'default');
        }
      });
      var isVertical = !!(body.classList.contains('vertical-writing') || body.closest('.vertical-writing'));
      var zoom = typeof _getZoom === 'function' ? _getZoom() : 1;
      model.layoutRubySpans(spans, {
        presentation: presentation,
        isVertical: isVertical,
        zoom: zoom,
        prefix: '--note-ruby',
        cellOf: function (span) { return span.closest('td, th') || body; },
      });
      spans.forEach(function (span) { span.style.setProperty('--note-ruby-text-align', 'start'); });
    });
  }

  // 本文を描いた直後（同じ処理の中で中身を入れ替える呼び出し元が多い）にまとめて1回配置する。
  function scheduleLayout(host) {
    if (!host || typeof setTimeout !== 'function') return;
    clearTimeout(_layoutTimers.get(host));
    _layoutTimers.set(host, setTimeout(function () {
      _layoutTimers.delete(host);
      layoutRuby(host);
    }, 0));
  }

  function hostPath(host) {
    return String(host?.dataset?.path || host?.dataset?.entityPath || '');
  }

  // 読み込んだノートの状態を登録し、ルビの表示設定を本文へ当てる。
  function applyToHost(host, path, frontmatter) {
    var p = String(path || hostPath(host) || '');
    var layers = _layers();
    if (p && layers) {
      layers.setFileState(p, displayStateFromFrontmatter(frontmatter));
      // 別のノートへ切り替えた時もツールバーの表示をこのノートの状態へ合わせる。
      layers.refreshControls();
    }
    applyRubyPresentation(host, rubyPresentationFromFrontmatter(frontmatter));
    scheduleLayout(host);
  }

  // ── ツールバーの切り替え（本体のノート） ──
  function _pageHostForButton(btn) {
    var view = btn && btn.closest ? btn.closest('[data-editor-host], #page-view') : null;
    var pc = view ? view.querySelector('[data-editor-local-id="page-content"], #page-content') : null;
    return pc || global.GBEditorHost?.element?.('page-content') || document.getElementById('page-content');
  }

  function _canWrite(pc) {
    if (!pc || !pc.dataset.path) return false;
    if (pc.dataset.loadFailed === '1') {
      if (typeof showStatus === 'function') showStatus('ノートを読み込めていないため、切り替えを保存できません', true);
      return false;
    }
    if (pc.contentEditable === 'false') {
      if (typeof showStatus === 'function') showStatus('ロック中または読み取り専用のため変更できません', true);
      return false;
    }
    return true;
  }

  // フロントマターを書き換えて保存する。保存できなければ元に戻す。
  async function _commitFrontmatter(pc, nextFrontmatter) {
    var path = pc.dataset.path;
    var previous = pc.dataset.frontmatter || '';
    if (previous === nextFrontmatter) return true;
    pc.dataset.frontmatter = nextFrontmatter;
    pc._noteEditSerializeCache = null;
    try { pc.dispatchEvent(new Event('input')); } catch (_) {}
    if (typeof global._runNoteAutoSave === 'function' || typeof _runNoteAutoSave === 'function') {
      var run = typeof _runNoteAutoSave === 'function' ? _runNoteAutoSave : global._runNoteAutoSave;
      try { await run(pc, path, { skipHistory: true }); } catch (_) {}
      var serialize = typeof _noteMarkdownFromEditor === 'function' ? _noteMarkdownFromEditor : null;
      var saved = pc.dataset.path === path && (!serialize || serialize(pc) === pc.dataset.lastSavedMd);
      if (!saved && pc.dataset.path === path) {
        pc.dataset.frontmatter = previous;
        pc._noteEditSerializeCache = null;
        if (typeof showStatus === 'function') showStatus('ノートに保存できませんでした', true);
        return false;
      }
    }
    return true;
  }

  function _historyScope(path) {
    return path ? 'page:' + String(path).replace(/\\/g, '/').replace(/^\/+/, '') : '';
  }

  // 自動リンク・自動ルビを描き直す（本文の辞書由来の表示を外して付け直す）。
  function rerenderHost(pc, path) {
    if (!pc || typeof MeldexAutoLink === 'undefined') return;
    var scroll = global.MeldexNoteRuby?.captureScroll?.(pc);
    MeldexAutoLink.applyToDom(pc, path);
    refreshRubyNodes(pc);
    global.MeldexNoteEmptyPrompt?.sync?.(pc);
    global.MeldexNoteRuby?.restoreScroll?.(scroll);
  }

  function _setDisplayOnHost(pc, path, next) {
    var nextFm = writeDisplayState(pc.dataset.frontmatter || '', next);
    return _commitFrontmatter(pc, nextFm).then(function (ok) {
      if (!ok) return false;
      _layers()?.setFileState(path, next);
      rerenderHost(pc, path);
      return true;
    });
  }

  function registerToolbar() {
    var layers = _layers();
    if (!layers || registerToolbar.done) return;
    registerToolbar.done = true;
    layers.registerApp('page', {
      supportsAutoRuby: true,
      pathForButton: function (btn) { return _pageHostForButton(btn)?.dataset?.path || ''; },
      write: async function (path, next, btn, previous) {
        var pc = _pageHostForButton(btn);
        if (!_canWrite(pc) || pc.dataset.path !== path) return false;
        var before = { html: pc.innerHTML, frontmatter: pc.dataset.frontmatter || '',
          selection: typeof _customUndoSelection === 'function' ? _customUndoSelection(pc) : null };
        var ok = await _setDisplayOnHost(pc, path, next);
        if (ok && typeof _pushCustomUndo === 'function') {
          // 本文にフォーカスしたCtrl+Zと同じ履歴へ、本文と設定を一緒に記録する。
          _pushCustomUndo(pc, before);
          pc._customUndoInputPending = false;
          if (typeof _syncScopedNoteUndoState === 'function') _syncScopedNoteUndoState(pc, _scopedNoteUndoState(pc));
        } else if (ok && typeof historyPush === 'function') {
          var label = previous && previous.autoLinks !== next.autoLinks ? '自動リンクの切り替え' : '自動ルビの切り替え';
          var apply = function (target) {
            return function () {
              var host = global.GBEditorHost?.element?.('page-content') || document.getElementById('page-content');
              if (!host || host.dataset.path !== path) return false;
              return _setDisplayOnHost(host, path, target).then(function () { layers.refreshControls(); });
            };
          };
          historyPush(label, apply(previous), apply(next), _historyScope(path), '');
        }
        return ok;
      },
    });
  }

  // ── ルビの表示設定（オプションパネルのルビタブ・テーマ） ──
  // 共通部品 MeldexRubySettingsUI.createEditorSettings はシナリオのエディタと同じ形の
  // 相手（doc / _pushUndo / _render / _markDirty）を受け取るので、ノート用の相手を作る。
  var _rubyEditors = new WeakMap();

  function _currentPageHost() {
    return global.GBEditorHost?.element?.('page-content') || document.getElementById('page-content');
  }

  function rubySettingsEditor(host) {
    var pc = host || _currentPageHost();
    if (!pc || !pc.dataset.path || !_model()) return null;
    var path = pc.dataset.path;
    var cached = _rubyEditors.get(pc);
    var presentation = rubyPresentationFromFrontmatter(pc.dataset.frontmatter || '');
    if (cached && cached.path === path) {
      cached.doc.rubyPresentation = presentation;
      cached.doc.editor.viewMode = presentation.writingMode;
      return cached.editor;
    }
    var doc = { rubyPresentation: presentation, editor: { viewMode: presentation.writingMode }, rows: [] };
    var before = null;
    var editor = {
      doc: doc,
      host: pc,
      _readOnly: pc.contentEditable === 'false',
      _pushUndo: function () { before = pc.dataset.frontmatter || ''; },
      _render: function () {
        var p = doc.rubyPresentation || {};
        var wantVertical = p.writingMode === 'vertical';
        var writingMode = global.MeldexNoteWritingMode;
        if (writingMode && writingMode.isActive() !== wantVertical && typeof global.toggleNoteVertical === 'function') {
          global.toggleNoteVertical();
        } else if (writingMode && writingMode.isActive() !== wantVertical && typeof writingMode.applyState === 'function') {
          writingMode.applyState(wantVertical);
        }
        applyRubyPresentation(pc, p);
      },
      _markDirty: function () {
        if (!_canWrite(pc) || pc.dataset.path !== path) {
          var restored = rubyPresentationFromFrontmatter(pc.dataset.frontmatter || '');
          doc.rubyPresentation = restored;
          applyRubyPresentation(pc, restored);
          return false;
        }
        var prevFm = before != null ? before : (pc.dataset.frontmatter || '');
        before = null;
        var nextFm = writeRubyPresentation(pc.dataset.frontmatter || '', doc.rubyPresentation);
        _commitFrontmatter(pc, nextFm).then(function (ok) {
          if (!ok) {
            var restored = rubyPresentationFromFrontmatter(pc.dataset.frontmatter || '');
            doc.rubyPresentation = restored;
            applyRubyPresentation(pc, restored);
            _notifyRubyChange(doc);
            return;
          }
          if (typeof historyPush === 'function' && prevFm !== nextFm) {
            var restore = function (fm) {
              return function () {
                var host = _currentPageHost();
                if (!host || host.dataset.path !== path) return false;
                var target = writeRubyPresentation(host.dataset.frontmatter || '', rubyPresentationFromFrontmatter(fm));
                return _commitFrontmatter(host, target).then(function () {
                  var p = rubyPresentationFromFrontmatter(host.dataset.frontmatter || '');
                  doc.rubyPresentation = p;
                  applyRubyPresentation(host, p);
                  _notifyRubyChange(doc);
                });
              };
            };
            historyPush('ルビの表示設定の変更', restore(prevFm), restore(nextFm), _historyScope(path), '');
          }
        });
        return true;
      },
    };
    _rubyEditors.set(pc, { path: path, doc: doc, editor: editor });
    return editor;
  }

  function _notifyRubyChange(doc) {
    try { global.dispatchEvent(new CustomEvent('meldex:ruby-presentation-change', { detail: { doc: doc, field: '' } })); } catch (_) {}
  }

  // 全体の既定値（設定ダイアログ）が変わったら、保存値を持たない項目の見た目を合わせ直す。
  function refreshAllHosts() {
    document.querySelectorAll(NOTE_HOST_SELECTOR).forEach(function (host) {
      if (!host.isConnected) return;
      applyRubyPresentation(host, rubyPresentationFromFrontmatter(host.dataset.frontmatter || ''));
    });
  }

  function init() {
    registerToolbar();
    global.addEventListener?.('meldex:ruby-presentation-defaults-change', function (event) {
      if (event?.detail?.scope && event.detail.scope !== 'note') return;
      refreshAllHosts();
    });
    global.addEventListener?.('meldex:note-writing-mode-changed', function () {
      scheduleLayout(_currentPageHost());
      var pc = _currentPageHost();
      var cached = pc ? _rubyEditors.get(pc) : null;
      if (cached) {
        cached.doc.rubyPresentation = rubyPresentationFromFrontmatter(pc.dataset.frontmatter || '');
        cached.doc.editor.viewMode = cached.doc.rubyPresentation.writingMode;
        _notifyRubyChange(cached.doc);
      }
    });
    try {
      // 本文の字形が届いてから測り直す（字形の差し替えで親文字の幅が変わるため）。
      document.fonts?.ready?.then(function () { refreshAllHosts(); });
    } catch (_) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.MeldexNoteDisplaySettings = {
    DISPLAY_KEY: DISPLAY_KEY,
    RUBY_KEY: RUBY_KEY,
    readBlock: readBlock,
    writeBlock: writeBlock,
    displayStateFromFrontmatter: displayStateFromFrontmatter,
    writeDisplayState: writeDisplayState,
    rubyPresentationFromFrontmatter: rubyPresentationFromFrontmatter,
    writeRubyPresentation: writeRubyPresentation,
    applyRubyPresentation: applyRubyPresentation,
    refreshRubyNodes: refreshRubyNodes,
    layoutRuby: layoutRuby,
    scheduleLayout: scheduleLayout,
    applyToHost: applyToHost,
    rerenderHost: rerenderHost,
    rubySettingsEditor: rubySettingsEditor,
    refreshAllHosts: refreshAllHosts,
    registerToolbar: registerToolbar,
  };
})(typeof window !== 'undefined' ? window : globalThis);
