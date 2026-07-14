/* gb-scriptnote-editor.js: 軽量シナリオエディタ v2
   シナリオエンジンに依存しない、Word方式の段落ベースエディタ */

/* ================================
   ルビマークアップのエスケープ
   ================================
   ルビ表記 {漢字|ルビ} と、ユーザーが入力した生の `{` `|` `}` を区別するために
   エスケープ機構を使う。保存時: 生の `\ { | }` を `\\ \{ \| \}` に置き換え。
   復元時: 逆変換する。古いデータ（エスケープなし）も引き続き解釈できるよう、
   正規表現は \{x\|y\} と {x|y} の両方のパターンを受け付ける。 */
function _sn2EscapeRubyText(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/([\\{|}])/g, '\\$1');
}
function _sn2UnescapeRubyText(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/\\([\\{|}])/g, '$1');
}
// ルビマークアップ用の正規表現パターン。内部文字として \{ \| \} \\ のエスケープを許容する
const _SN2_RUBY_PATTERN = '\\{((?:\\\\[\\\\{|}]|[^{|}\\\\])+)\\|((?:\\\\[\\\\{|}]|[^{|}\\\\])+)\\}';
const _SN2_MANUAL_LINK_PATTERN = '\\[((?:\\\\.|[^\\]])+)\\]\\(ml:([^)]+)\\)';
function _sn2NewRubyRegex() { return new RegExp(_SN2_RUBY_PATTERN, 'g'); }
function _sn2NewVisibleMarkupRegex() { return new RegExp(_SN2_RUBY_PATTERN + '|' + _SN2_MANUAL_LINK_PATTERN, 'g'); }
function _sn2EscapeScriptNotePlainText(s) {
  if (typeof s !== 'string') return '';
  return _sn2EscapeRubyText(s).replace(new RegExp(_SN2_MANUAL_LINK_PATTERN, 'g'), (matched) => {
    return matched.replace(/([\[\]])/g, '\\$1');
  });
}
function _sn2UnescapeScriptNotePlainText(s) {
  if (typeof s !== 'string') return '';
  return _sn2UnescapeRubyText(s.replace(/\\([\[\]])/g, '$1'));
}
function _sn2DecodeManualLinkLabel(label) {
  return _sn2UnescapeRubyText(String(label || '').replace(/\\([\[\]\\])/g, '$1'));
}
function _sn2BuildManualLinkMarkup(label, target) {
  const safeLabel = _sn2EscapeRubyText(String(label || '')).replace(/([\\\[\]])/g, '\\$1');
  const encodedTarget = encodeURIComponent(String(target || ''))
    .replace(/[()]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
  return `[${safeLabel}](ml:${encodedTarget})`;
}
// 本文中のルビをプレーンテキストに変換（エスケープの逆変換も行う）
function _sn2StripRubyToPlain(s) {
  if (typeof s !== 'string') return '';
  return _sn2UnescapeScriptNotePlainText(
    s
      .replace(new RegExp(_SN2_MANUAL_LINK_PATTERN, 'g'), (_m, label) => _sn2DecodeManualLinkLabel(label))
      .replace(_sn2NewRubyRegex(), (_m, kanji) => kanji)
  );
}

function _sn2SplitEscapedPlainSegment(raw, visibleOffset) {
  if (visibleOffset <= 0) return ['', raw];
  let rawIndex = 0;
  let visibleIndex = 0;
  while (rawIndex < raw.length && visibleIndex < visibleOffset) {
    const ch = raw[rawIndex];
    const next = raw[rawIndex + 1];
    if (ch === '\\' && next && '\\{|}[]'.includes(next)) rawIndex += 2;
    else rawIndex += 1;
    visibleIndex += 1;
  }
  return [raw.slice(0, rawIndex), raw.slice(rawIndex)];
}

function _sn2BuildRubyMarkup(base, ruby) {
  if (!base) return '';
  if (!ruby) return _sn2EscapeScriptNotePlainText(base);
  return `{${_sn2EscapeRubyText(base)}|${_sn2EscapeRubyText(ruby)}}`;
}

function _sn2CollectVisibleSegments(raw) {
  const segments = [];
  const re = _sn2NewVisibleMarkupRegex();
  let last = 0;
  let match;
  while ((match = re.exec(raw)) !== null) {
    if (match.index > last) segments.push({ type: 'plain', raw: raw.slice(last, match.index) });
    if (match[1] != null) {
      segments.push({
        type: 'ruby',
        raw: match[0],
        plain: _sn2UnescapeRubyText(match[1]),
        ruby: _sn2UnescapeRubyText(match[2]),
      });
    } else {
      let target = match[4] || '';
      try { target = decodeURIComponent(target); } catch {}
      segments.push({
        type: 'manual-link',
        raw: match[0],
        plain: _sn2StripRubyToPlain(_sn2DecodeManualLinkLabel(match[3])),
        target,
      });
    }
    last = match.index + match[0].length;
  }
  if (last < raw.length) segments.push({ type: 'plain', raw: raw.slice(last) });
  return segments;
}

function _sn2SplitRawTextByVisibleOffset(rawText, visibleOffset) {
  const raw = String(rawText || '');
  let remaining = Math.max(0, Number(visibleOffset) || 0);
  let before = '';
  let after = '';
  let done = false;
  const segments = _sn2CollectVisibleSegments(raw);
  segments.forEach((segment) => {
    if (done) {
      after += segment.raw;
      return;
    }
    const plain = (segment.type === 'ruby' || segment.type === 'manual-link')
      ? segment.plain
      : _sn2UnescapeScriptNotePlainText(segment.raw);
    const len = plain.length;
    if (remaining <= 0) {
      after += segment.raw;
      done = true;
      return;
    }
    if (remaining >= len) {
      before += segment.raw;
      remaining -= len;
      return;
    }
    if (segment.type === 'ruby') {
      const baseBefore = plain.slice(0, remaining);
      const baseAfter = plain.slice(remaining);
      const ruby = segment.ruby || '';
      const rubySplit = plain.length ? Math.round((ruby.length * remaining) / plain.length) : 0;
      before += _sn2BuildRubyMarkup(baseBefore, ruby.slice(0, rubySplit));
      after += _sn2BuildRubyMarkup(baseAfter, ruby.slice(rubySplit));
    } else if (segment.type === 'manual-link') {
      const labelBefore = plain.slice(0, remaining);
      const labelAfter = plain.slice(remaining);
      before += labelBefore ? _sn2BuildManualLinkMarkup(labelBefore, segment.target) : '';
      after += labelAfter ? _sn2BuildManualLinkMarkup(labelAfter, segment.target) : '';
    } else {
      const [segBefore, segAfter] = _sn2SplitEscapedPlainSegment(segment.raw, remaining);
      before += segBefore;
      after += segAfter;
    }
    done = true;
  });
  return [before, after];
}

function _sn2ReplaceRawTextByVisibleRange(rawText, startOffset, endOffset, replacement) {
  const [prefixAndMatch, after] = _sn2SplitRawTextByVisibleOffset(rawText, endOffset);
  const [before] = _sn2SplitRawTextByVisibleOffset(prefixAndMatch, startOffset);
  return before + _sn2EscapeScriptNotePlainText(String(replacement || '')) + after;
}

class ScriptNoteEditor {
  constructor(hostEl) {
    this.host = hostEl;
    this.doc = null;
    this._path = '';
    this._dirty = false;
    this._saveTimer = null;
    this._bound = false;
    this._roleMenu = null;
    this._roleMenuRow = null;
    this._roleMenuCloseHandler = null;
    this._calcCache = null;
    this._undoTimer = null;
    this._lastPushedSnap = '';
    this._pushUndoSuppressed = false;
    this._textInputUndoOpen = false;
    this._textInputUndoTimer = null;
    this._wrapResizeObserver = null;
    this._wrapResizeRaf = null;
    this._wrapResizeTimer = null;
    this._wrapResizeWindowHandler = null;
    this._wrapResizeInterval = null;
    this._wrapResizeLastSize = 0;
  }

  // === ドキュメント操作 ===

  loadDoc(parsed, path = '') {
    if (this._undoTimer) { clearTimeout(this._undoTimer); this._undoTimer = null; }
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    const previousRegisteredPath = this._sn2RegisteredPath || '';
    const previousRegisteredScopeId = this._sn2RegisteredScopeId || '';
    this._path = path;
    this._dirty = false;
    this.doc = createScriptNoteDoc(parsed);
    // 削除検知用の行ID スナップショット
    this._lastSavedRowIds = createScriptNoteRowIdSet(this.doc);
    // rowsで使用中のタイプをcharactersに自動登録
    this._syncCharactersFromRows();
    // 役割が空の行に適用するデフォルトタイプを末尾に確保
    this._ensureDefaultChara();
    applyLegacyScriptNoteDocMigrations(this.doc, {
      legacyDetectKindByName: (name) => this._legacyDetectKindByName(name),
    });
    if (typeof this._ensureStatusConfig === 'function') this._ensureStatusConfig();
    this._calcCache = null;
    this._lastPushedSnap = '';
    // テキストセル範囲選択の残留を防止（別ファイルへ切替後に古い選択が再度有効化されるのを防ぐ）
    this._textCellSelection = new Set();
    this._textCellAnchorIdx = -1;
    // エディタレジストリに登録（マルチインスタンス対応）
    if (typeof _sn2Editors !== 'undefined') {
      if (previousRegisteredPath && previousRegisteredPath !== this._path && _sn2Editors[previousRegisteredPath] === this) {
        delete _sn2Editors[previousRegisteredPath];
      }
      if (previousRegisteredScopeId && previousRegisteredScopeId !== this._historyScopeId && _sn2Editors[previousRegisteredScopeId] === this) {
        delete _sn2Editors[previousRegisteredScopeId];
      }
      if (this._path) _sn2Editors[this._path] = this;
      if (this._historyScopeId) _sn2Editors[this._historyScopeId] = this;
      this._sn2RegisteredPath = this._path || '';
      this._sn2RegisteredScopeId = this._historyScopeId || '';
    }
    this._render();
    this._pushUndo('初期状態');
  }

  collectDoc() {
    if (!this.doc) return null;
    this._syncAllFromDom();
    return serializeScriptNoteDoc(this.doc);
  }

  async save() {
    if (!this._path || !this.doc) return true;
    const savePath = this._path;
    const json = JSON.stringify(this.collectDoc(), null, 2);
    const prevIds = this._lastSavedRowIds || new Set();
    const currIds = createScriptNoteRowIdSet(this.doc);
    try {
      const saveResult = await apiPut('/file?path=' + encodeURIComponent(savePath), { content: json, skip_if_missing: true });
      if (saveResult?.skipped || saveResult?.missing) {
        this._dirty = true;
        if (typeof showStatus === 'function') showStatus('保存先が見つかりません。名前を付けて保存してください', true);
        return false;
      }
      const unchanged = this._path === savePath && JSON.stringify(this.collectDoc(), null, 2) === json;
      if (this._path === savePath) {
        this._lastSavedRowIds = currIds;
        if (unchanged) this._dirty = false;
      }
      // 削除された行IDを抽出し、該当コメントを孤児化 (annotation_unification_plan.md §5.3)
      const removed = [...prevIds].filter(id => !currIds.has(id));
      if (removed.length > 0) {
        const path = savePath;
        Promise.all(removed.map(id =>
          apiPost('/annotations/orphan-by-target', {
            target_kind: 'scriptnote_line',
            target_file: path,
            item_id: id,
            cascade_container: true,
          }).catch(() => {})
        ));
      }
      // Audit-P1 H-3: 保存完了後にコメントバッジキャッシュを無効化し、
      // 行並び替え・行挿入・行削除の結果を即座に反映する（3 秒 TTL キャッシュで
      // 古いバッジが残るのを防ぐ）。
      if (typeof CommentBadges !== 'undefined' && this._path === savePath && this.host) {
        try {
          CommentBadges.invalidate(savePath);
          CommentBadges.refreshScriptnote(savePath, this.host);
        } catch (_) {}
      }
      return true;
    } catch (e) {
      if (typeof showStatus === 'function') showStatus('保存失敗: ' + e.message, true);
      return false;
    }
  }

  flush() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    this._syncAllFromDom();
    if (this._dirty) return this.save();
    return Promise.resolve(true);
  }

  // === モード別カウント定義 ===
  // 設定駆動方針: 区切り/プロットの判定はタイプのオプション設定 (chara.isBreak / chara.isSummary)
  // で行う。MODE_COUNT_DEFS は label のデフォルト値の供給だけに使う。

  static get MODE_COUNT_DEFS() {
    if (ScriptNoteEditor._modeCountDefsCache) return ScriptNoteEditor._modeCountDefsCache;
    return (ScriptNoteEditor._modeCountDefsCache = {
      manga:   { primaryLabel: 'p', secondaryLabel: 'コマ' },
      drama:   { primaryLabel: '頁', secondaryLabel: 'カット' },
      afureko: { primaryLabel: '頁', secondaryLabel: 'カット' },
      stage:   { primaryLabel: '頁', secondaryLabel: 'カット' },
    });
  }

  _getCountDef() {
    const mode = this.doc?.layoutMode || 'manga';
    const base = ScriptNoteEditor.MODE_COUNT_DEFS[mode] || ScriptNoteEditor.MODE_COUNT_DEFS.manga;
    const custom = this.doc?.editor?.countConfig || {};
    return {
      primaryLabel: custom.primaryLabel || base.primaryLabel,
      secondaryLabel: custom.secondaryLabel || base.secondaryLabel,
    };
  }

  // chara のオプション設定で区切り/プロットフラグが立っているタイプ名集合を返す
  _getRoleFlagSets() {
    const breakNames = new Set();
    const summaryNames = new Set();
    (this.doc?.characters || []).forEach(c => {
      if (c.isDefault) return;
      if (!c.name) return;
      if (c.isBreak) breakNames.add(c.name);
      if (c.isSummary) summaryNames.add(c.name);
    });
    return { breakNames, summaryNames };
  }

  // === ページ/コマ番号計算 ===

  _calcPagePanel() {
    if (this._calcCache && this._calcCache.length === this.doc.rows.length) return this._calcCache;
    const rows = this.doc.rows;
    const { breakNames, summaryNames } = this._getRoleFlagSets();
    const isBreakRow = (role) => !!role && breakNames.has(role);
    const isSummaryRow = (role) => !!role && summaryNames.has(role);
    const result = [];
    let page = 1, panel = 1;
    for (let i = 0; i < rows.length; i++) {
      const role = rows[i].role;
      const text = rows[i].text;
      const isPageBreak = isBreakRow(role);
      const isPageReset = isPageBreak;
      const isSummary = isSummaryRow(role);

      // ページ番号: 区切り行で+1
      if (i > 0 && isPageBreak) page++;

      // コマ番号: リセットまたはインクリメント
      if (isPageReset || isSummary) {
        panel = 1;
      } else if (i > 0) {
        const prevRole = rows[i - 1].role;
        if (isBreakRow(prevRole) || isSummaryRow(prevRole)) {
          panel = 1;
        } else if (!role && !text) {
          panel++;
        }
      }

      const showPage = isPageBreak || isSummary || (i === 0);
      const showPanel = !isPageBreak && !isSummary && (role || text);
      result.push({ page, panel, showPage, showPanel });
    }
    this._calcCache = result;
    return result;
  }

  _fmtCount(label, num, cfg) {
    const pad = cfg.pad ?? 2;
    const pos = cfg.pos || 'before';
    if (pad === 0) return label; // 0桁 → 単位テキストのみ
    const n = pad > 0 ? String(num).padStart(pad, '0') : String(num);
    if (pos === 'after') return n + label;
    if (pos === 'both') return (cfg.labelBefore ?? label) + n + (cfg.labelAfter ?? label);
    return label + n;
  }

  _formatGutter(calc) {
    if (!calc) return '';
    const def = this._getCountDef();
    const cc = this.doc?.editor?.countConfig || {};
    const parts = [];
    parts.push(this._fmtCount(def.primaryLabel, calc.page, {
      pad: cc.primaryPad ?? cc.padDigits ?? 2,
      pos: cc.primaryPos ?? cc.labelPosition ?? 'before',
      labelBefore: cc.primaryLabelBefore,
      labelAfter: cc.primaryLabelAfter,
    }));
    if (calc.showPanel) parts.push(this._fmtCount(def.secondaryLabel, calc.panel, {
      pad: cc.secondaryPad ?? cc.padDigits ?? 2,
      pos: cc.secondaryPos ?? cc.labelPosition ?? 'before',
      labelBefore: cc.secondaryLabelBefore,
      labelAfter: cc.secondaryLabelAfter,
    }));
    return parts.join(' ');
  }

  _formatGutterPrimary(calc) {
    if (!calc) return '';
    const def = this._getCountDef();
    const cc = this.doc?.editor?.countConfig || {};
    return this._fmtCount(def.primaryLabel, calc.page, {
      pad: cc.primaryPad ?? cc.padDigits ?? 2,
      pos: cc.primaryPos ?? cc.labelPosition ?? 'before',
      labelBefore: cc.primaryLabelBefore,
      labelAfter: cc.primaryLabelAfter,
    });
  }

  _formatGutterSecondary(calc) {
    if (!calc || !calc.showPanel) return '';
    const def = this._getCountDef();
    const cc = this.doc?.editor?.countConfig || {};
    return this._fmtCount(def.secondaryLabel, calc.panel, {
      pad: cc.secondaryPad ?? cc.padDigits ?? 2,
      pos: cc.secondaryPos ?? cc.labelPosition ?? 'before',
      labelBefore: cc.secondaryLabelBefore,
      labelAfter: cc.secondaryLabelAfter,
    });
  }

  // === キャラクタースタイル ===

  // autoColor/autoColorTarget対応: 実効的な背景色・文字色を解決
  _resolveCharaColors(chara, colId) {
    if (!chara) return { bgColor: '', textColor: '' };
    let bg = chara.bgColor || '';
    let fg = chara.textColor || '';
    if (chara.autoColor) {
      // 列ごとのターゲットを取得（オブジェクト形式: { _gutter: 'bg', _role: 'text' }、文字列形式: 'bg'）
      // autoColorが設定済みならデフォルトは'bg'（既存データとの互換性）、未設定時のデフォルトは'none'
      const act = chara.autoColorTarget || 'bg';
      const target = (typeof act === 'object' && colId) ? (act[colId] || 'none') : (typeof act === 'string' ? act : 'bg');
      if (target === 'both') {
        if (!bg) bg = typeof calcBgColor === 'function' ? calcBgColor(chara.autoColor) : chara.autoColor;
        if (!fg) fg = chara.autoColor;
      } else if (target === 'bg') {
        bg = bg || chara.autoColor;
      } else if (target === 'text') {
        fg = fg || chara.autoColor;
      }
    }
    return { bgColor: bg, textColor: fg };
  }

  _getCharaStyle(role) {
    if (!role) return null;
    const chara = this.doc.characters.find(c => !c.isDefault && c.name === role);
    if (!chara) return null;
    const { bgColor, textColor } = this._resolveCharaColors(chara, '_role');
    const rs = chara.roleStyle || {};
    const parts = [];
    if (rs.bgColor || bgColor) parts.push(`background:${rs.bgColor || bgColor}`);
    if (rs.textColor || textColor) parts.push(`color:${rs.textColor || textColor}`);
    if (rs.fontWeight === 'bold') parts.push('font-weight:bold');
    if (rs.fontStyle === 'italic') parts.push('font-style:italic');
    if (rs.fontSize) parts.push(`font-size:${rs.fontSize}px`);
    if (rs.fontFamily) parts.push(`font-family:${rs.fontFamily}`);
    if (rs.textStrokeColor) parts.push(`-webkit-text-stroke-color:${rs.textStrokeColor}`);
    if (rs.textStrokeWidth) parts.push(`-webkit-text-stroke-width:${rs.textStrokeWidth}px`);
    if (rs.leftAccent) parts.push(`box-shadow:inset 3px 0 0 ${rs.accentColor || chara.accentColor || rs.textColor || textColor || 'var(--accent)'}`);
    if (rs.underline) parts.push(`text-decoration:underline;text-decoration-color:${rs.accentColor || chara.accentColor || rs.textColor || textColor || 'var(--accent)'}`);
    return parts.length ? parts.join(';') : null;
  }

  _applyRowStyle(rowEl, role) {
    const textEl = rowEl.querySelector('.sn2-text');
    const roleBtn = rowEl.querySelector('.sn2-role-btn');
    const statusBtn = rowEl.querySelector('.sn2-status-btn');
    const gutterEl = rowEl.querySelector('.sn2-gutter:not(.sn2-gutter2)');
    const gutter2El = rowEl.querySelector('.sn2-gutter2');
    const rowId = rowEl.dataset.rowId;
    const rowData = this.doc?.rows?.find((item) => item.id === rowId) || null;
    const chara = role
      ? this.doc.characters.find(c => !c.isDefault && c.name === role)
      : this.doc.characters.find(c => c.isDefault);
    // 列スタイル設定
    const colStyles = this.doc.editor?.columnStyles || {};
    // スタイル解決: タイプ別設定（具体的）が列全体設定（汎用的）を常に上書き
    const resolve = (colStyle, roleStyle) => {
      const pick = (rVal, cVal) => rVal || cVal || '';
      return {
        bgColor: pick(roleStyle?.bgColor, colStyle?.bgColor),
        textColor: pick(roleStyle?.textColor, colStyle?.textColor),
        fontWeight: pick(roleStyle?.fontWeight, colStyle?.fontWeight),
        fontStyle: pick(roleStyle?.fontStyle, colStyle?.fontStyle),
        fontSize: pick(roleStyle?.fontSize, colStyle?.fontSize),
        fontFamily: pick(roleStyle?.fontFamily, colStyle?.fontFamily),
        textStrokeColor: pick(roleStyle?.textStrokeColor, colStyle?.textStrokeColor),
        textStrokeWidth: pick(roleStyle?.textStrokeWidth, colStyle?.textStrokeWidth),
        leftAccent: roleStyle?.leftAccent || colStyle?.leftAccent || false,
        underline: roleStyle?.underline || colStyle?.underline || false,
        accentColor: pick(roleStyle?.accentColor, colStyle?.accentColor),
      };
    };
    // 背景未設定時はページ背景色にフォールバック（行のhover/focusグレーが透けるのを防止）
    const pageBg = 'var(--sn2-page-bg, var(--content-bg, var(--bg)))';
    const baseTextColor = 'var(--sn2-base-text-color, var(--fg))';
    const setStyle = (el, s, keepAlign) => {
      const align = keepAlign ? el.style.textAlign : '';
      el.style.background = s.bgColor || pageBg;
      el.style.color = s.textColor || baseTextColor;
      el.style.fontWeight = s.fontWeight === 'bold' ? 'bold' : '';
      el.style.fontStyle = s.fontStyle === 'italic' ? 'italic' : '';
      el.style.fontSize = s.fontSize ? s.fontSize + 'px' : '';
      el.style.fontFamily = s.fontFamily || '';
      const accentColor = s.accentColor || s.textColor || 'var(--accent)';
      el.style.webkitTextStrokeColor = s.textStrokeColor || '';
      el.style.webkitTextStrokeWidth = s.textStrokeWidth ? s.textStrokeWidth + 'px' : '';
      el.style.paintOrder = (s.textStrokeColor || s.textStrokeWidth) ? 'stroke fill' : '';
      el.style.boxShadow = s.leftAccent ? `inset 3px 0 0 ${accentColor}` : '';
      el.style.textDecorationLine = s.underline ? 'underline' : '';
      el.style.textDecorationColor = s.underline ? accentColor : '';
      if (align) el.style.textAlign = align;
    };
    // ガターのスタイル適用ヘルパー
    const applyGutterStyle = (el, colStyleKey) => {
      if (!el) return;
      const ec = this._resolveCharaColors(chara, colStyleKey);
      // 列別タイプスタイル（最優先）→ autoColor → 列全体スタイル
      const gs = colStyleKey === '_gutter2' ? (chara?.gutter2Style || {}) : (chara?.gutterStyle || {});
      const roleGutter = { bgColor: gs.bgColor || ec.bgColor, textColor: gs.textColor || ec.textColor, fontWeight: gs.fontWeight, fontStyle: gs.fontStyle, fontSize: gs.fontSize, fontFamily: gs.fontFamily, textStrokeColor: gs.textStrokeColor, textStrokeWidth: gs.textStrokeWidth, leftAccent: gs.leftAccent, underline: gs.underline, accentColor: gs.accentColor };
      const r = resolve(colStyles[colStyleKey], roleGutter);
      const ccBg = el.dataset.ccBg || '';
      const ccColor = el.dataset.ccColor || '';
      const ccWeight = el.dataset.ccWeight || '';
      const ccSize = el.dataset.ccSize || '';
      const align = el.style.textAlign;
      el.style.background = ccBg || r.bgColor || pageBg;
      el.style.color = ccColor || r.textColor || baseTextColor;
      el.style.fontWeight = ccWeight || (r.fontWeight === 'bold' ? 'bold' : '');
      el.style.fontStyle = r.fontStyle === 'italic' ? 'italic' : '';
      el.style.fontSize = ccSize ? ccSize + 'px' : (r.fontSize ? r.fontSize + 'px' : '');
      el.style.fontFamily = r.fontFamily || '';
      const accentColor = r.accentColor || r.textColor || 'var(--accent)';
      el.style.webkitTextStrokeColor = r.textStrokeColor || '';
      el.style.webkitTextStrokeWidth = r.textStrokeWidth ? r.textStrokeWidth + 'px' : '';
      el.style.paintOrder = (r.textStrokeColor || r.textStrokeWidth) ? 'stroke fill' : '';
      el.style.boxShadow = r.leftAccent ? `inset 3px 0 0 ${accentColor}` : '';
      el.style.textDecorationLine = r.underline ? 'underline' : '';
      el.style.textDecorationColor = r.underline ? accentColor : '';
      if (align) el.style.textAlign = align;
    };
    // 行背景は設定しない（ハンドル列はCSS側でページ背景色を使う）
    rowEl.style.background = '';
    // ガター列（大区切り）
    applyGutterStyle(gutterEl, '_gutter');
    // ガター2列（小区切り）
    applyGutterStyle(gutter2El, '_gutter2');
    // タイプ列
    if (roleBtn) {
      const ecRole = this._resolveCharaColors(chara, '_role');
      const rs = chara?.roleStyle || {};
      const roleRole = { bgColor: rs.bgColor || ecRole.bgColor, textColor: rs.textColor || ecRole.textColor, fontWeight: rs.fontWeight, fontStyle: rs.fontStyle, fontSize: rs.fontSize, fontFamily: rs.fontFamily, textStrokeColor: rs.textStrokeColor, textStrokeWidth: rs.textStrokeWidth, leftAccent: rs.leftAccent, underline: rs.underline, accentColor: rs.accentColor || chara?.accentColor };
      setStyle(roleBtn, resolve(colStyles._role, roleRole), true);
    }
    // テキスト列
    if (textEl) {
      const ecText = this._resolveCharaColors(chara, '_text');
      const ts = chara?.textStyle || {};
      const roleText = { bgColor: ts.bgColor || ecText.bgColor, textColor: ts.textColor || ecText.textColor, fontWeight: ts.fontWeight || chara?.fontWeight, fontStyle: ts.fontStyle || chara?.fontStyle, fontSize: ts.fontSize || chara?.fontSize, fontFamily: ts.fontFamily || chara?.fontFamily, textStrokeColor: ts.textStrokeColor || chara?.textStrokeColor, textStrokeWidth: ts.textStrokeWidth || chara?.textStrokeWidth, leftAccent: ts.leftAccent, underline: ts.underline, accentColor: ts.accentColor || chara?.accentColor };
      setStyle(textEl, resolve(colStyles._text, roleText), false);
      textEl.style.paddingLeft = '';
      textEl.style.paddingTop = '';
      if (chara?.indent) {
        const indVal = String(chara.indent).trim();
        const cssVal = /^\d+(\.\d+)?$/.test(indVal) ? indVal + 'em' : indVal;
        const isVert = this.doc.editor?.viewMode === 'vertical';
        if (isVert) textEl.style.paddingTop = cssVal;
        else textEl.style.paddingLeft = cssVal;
      }
      // textStyle を優先、chara レベルにフォールバック（?? で空文字は有効値として扱う）
      const effBefore = ts.textBefore ?? chara?.textBefore;
      if (effBefore) textEl.dataset.before = effBefore; else delete textEl.dataset.before;
      const effAfter = ts.textAfter ?? chara?.textAfter;
      if (effAfter) textEl.dataset.after = effAfter; else delete textEl.dataset.after;
      // タイプ固有の配置・折り返し（textStyle優先、なければcharaレベル。?? で空文字=明示リセットを尊重）
      const effAlign = ts.textAlign ?? chara?.textAlign;
      if (effAlign) textEl.dataset.align = effAlign; else delete textEl.dataset.align;
      const effValign = ts.textValign ?? chara?.textValign;
      if (effValign) textEl.dataset.valign = effValign; else delete textEl.dataset.valign;
      const effOverflow = ts.textOverflow ?? chara?.textOverflow;
      if (effOverflow) textEl.dataset.overflow = effOverflow; else delete textEl.dataset.overflow;
      // テキスト位置オフセット（1列 = 隣接セルの設定幅）
      // 横書き: translateX、縦書き: translateY で描画位置だけをずらす（レイアウト・枠線位置は固定）
      if (chara?.textShiftDir && chara?.textShiftCols) {
        const isVert = this.doc.editor?.viewMode === 'vertical';
        const cols = Number(chara.textShiftCols) || 1;
        const hideCell = (el) => { el.style.visibility = 'hidden'; el.style.background = pageBg; el.style.borderColor = 'transparent'; };
        const cw = this.doc.editor?.columnWidths || {};
        const defaultWidths = { _gutter: 40, _gutter2: 48, _role: 88, _status: 92 };
        const getColW = (colId) => cw[colId] || defaultWidths[colId] || 80;
        let totalPx = 0;
        if (chara.textShiftDir === 'after') {
          const customCells = [...rowEl.querySelectorAll('.sn2-custom-cell')];
          for (let j = 0; j < cols && j < customCells.length; j++) {
            totalPx += getColW(customCells[j].dataset.colId);
            hideCell(customCells[j]);
          }
          // 後にずらす: 横書き=右、縦書き=下
          textEl.style.transform = isVert ? `translateY(${totalPx}px)` : `translateX(${totalPx}px)`;
        } else {
          const leftCells = [
            { el: statusBtn, id: '_status' },
            { el: roleBtn, id: '_role' },
            { el: gutter2El, id: '_gutter2' },
            { el: gutterEl, id: '_gutter' },
          ].filter(c => c.el);
          for (let j = 0; j < cols && j < leftCells.length; j++) {
            totalPx += getColW(leftCells[j].id);
            hideCell(leftCells[j].el);
          }
          if (isVert) {
            // 縦書き: 高さ拡張+translateY+負マージンで下端レイアウトを維持
            textEl.style.setProperty('height', `calc(100% + ${totalPx}px)`, 'important');
            textEl.style.marginBottom = -totalPx + 'px';
            textEl.style.transform = `translateY(-${totalPx}px)`;
          } else {
            // 横書き: 幅拡張+translateX+負マージンで右端レイアウトを維持
            textEl.style.width = `calc(var(--sn2-col-_text, 300px) + ${totalPx}px)`;
            textEl.style.marginRight = -totalPx + 'px';
            textEl.style.transform = `translateX(-${totalPx}px)`;
          }
        }
        textEl.style.marginLeft = '';
      } else {
        textEl.style.transform = '';
        textEl.style.width = '';
        textEl.style.height = '';
        textEl.style.marginLeft = '';
        textEl.style.marginRight = '';
        textEl.style.marginBottom = '';
        // シフト解除時に復元
        [...rowEl.querySelectorAll('.sn2-custom-cell')].forEach(cell => { cell.style.visibility = ''; cell.style.borderColor = ''; });
        if (roleBtn) { roleBtn.style.visibility = ''; roleBtn.style.borderColor = ''; }
        if (gutter2El) { gutter2El.style.visibility = ''; gutter2El.style.borderColor = ''; }
        if (gutterEl) { gutterEl.style.visibility = ''; gutterEl.style.borderColor = ''; }
      }
    }
    if (statusBtn && rowData && typeof this._renderRowStatusButton === 'function') {
      this._renderRowStatusButton(statusBtn, rowData);
    }
    // カスタム列（textShiftで非表示にされたセルはスキップ）
    rowEl.querySelectorAll('.sn2-custom-cell').forEach(cell => {
      if (cell.style.visibility === 'hidden') return;
      const colId = cell.dataset.colId;
      const cs = colStyles[colId] || {};
      const ecCustom = this._resolveCharaColors(chara, colId);
      const rs = chara?.customStyles?.[colId] || {};
      const roleCustom = {
        bgColor: rs.bgColor || ecCustom.bgColor,
        textColor: rs.textColor || ecCustom.textColor,
        fontWeight: rs.fontWeight,
        fontStyle: rs.fontStyle,
        fontSize: rs.fontSize,
        fontFamily: rs.fontFamily,
        textStrokeColor: rs.textStrokeColor,
        textStrokeWidth: rs.textStrokeWidth,
        leftAccent: rs.leftAccent,
        underline: rs.underline,
        accentColor: rs.accentColor,
      };
      const r = resolve(cs, roleCustom);
      cell.style.background = r.bgColor || '';
      cell.style.color = r.textColor || '';
      cell.style.fontWeight = r.fontWeight === 'bold' ? 'bold' : '';
      cell.style.fontStyle = r.fontStyle === 'italic' ? 'italic' : '';
      cell.style.fontSize = r.fontSize ? r.fontSize + 'px' : '';
      cell.style.fontFamily = r.fontFamily || '';
      const accentColor = r.accentColor || r.textColor || 'var(--accent)';
      cell.style.webkitTextStrokeColor = r.textStrokeColor || '';
      cell.style.webkitTextStrokeWidth = r.textStrokeWidth ? r.textStrokeWidth + 'px' : '';
      cell.style.paintOrder = (r.textStrokeColor || r.textStrokeWidth) ? 'stroke fill' : '';
      cell.style.boxShadow = r.leftAccent ? `inset 3px 0 0 ${accentColor}` : '';
      cell.style.textDecorationLine = r.underline ? 'underline' : '';
      cell.style.textDecorationColor = r.underline ? accentColor : '';
    });
  }

  // 列間枠線: どの列の右側に線を引くかのSetを返す
  _getColumnBorderSet() {
    const cb = this.doc.editor?.columnBorders;
    if (!cb) return new Set();
    // 新形式: 配列 ['_gutter', '_role', ...]
    if (Array.isArray(cb)) return new Set(cb);
    // 旧形式: 文字列を変換
    if (cb === 'gutter-role') return new Set(['_gutter']);
    if (cb === 'role-text') return new Set(['_role']);
    if (cb === 'all-cols') {
      const s = new Set(['_gutter', '_gutter2', '_role', '_text']);
      if (this.doc.editor?.statusEnabled) s.add('_status');
      (this.doc.editor?.customColumns || []).forEach(c => s.add(c.id));
      return s;
    }
    return new Set();
  }

  // === レンダリング ===

  _teardownWrapResizeObserver() {
    if (this._wrapResizeObserver) {
      this._wrapResizeObserver.disconnect();
      this._wrapResizeObserver = null;
    }
    if (this._wrapResizeWindowHandler) {
      window.removeEventListener('resize', this._wrapResizeWindowHandler);
      this._wrapResizeWindowHandler = null;
    }
    if (this._wrapResizeInterval != null) {
      clearInterval(this._wrapResizeInterval);
      this._wrapResizeInterval = null;
    }
    if (this._wrapResizeRaf != null) {
      cancelAnimationFrame(this._wrapResizeRaf);
      this._wrapResizeRaf = null;
    }
    if (this._wrapResizeTimer != null) {
      clearTimeout(this._wrapResizeTimer);
      this._wrapResizeTimer = null;
    }
    this._wrapResizeLastSize = 0;
  }

  _setupWrapResizeObserver(scroll, viewMode, wrapMode) {
    this._teardownWrapResizeObserver();
    if (!scroll || !wrapMode) return;
    const isVertical = viewMode === 'vertical';
    const readSize = () => {
      if (!scroll.isConnected) return 0;
      const rect = scroll.getBoundingClientRect();
      const size = isVertical ? rect.width : rect.height;
      return Number.isFinite(size) ? Math.round(size) : 0;
    };
    let lastSize = readSize();
    this._wrapResizeLastSize = lastSize;
    const scheduleRender = () => {
      if (this._wrapResizeTimer != null) return;
      this._wrapResizeTimer = setTimeout(() => {
        this._wrapResizeTimer = null;
        if (!this.host || !this.doc || !scroll.isConnected || !this.host.contains(scroll)) return;
        const state = this.doc.editor || {};
        const currentMode = state.viewMode || 'horizontal';
        if (!state.wrapMode || currentMode !== viewMode) return;
        this._render();
      }, 0);
    };
    const checkSize = () => {
      const nextSize = readSize();
      if (nextSize <= 0 || Math.abs(nextSize - lastSize) < 2) return;
      lastSize = nextSize;
      this._wrapResizeLastSize = nextSize;
      scheduleRender();
    };
    if (typeof ResizeObserver === 'function') {
      this._wrapResizeObserver = new ResizeObserver(checkSize);
      this._wrapResizeObserver.observe(scroll);
      if (this.host && this.host !== scroll) this._wrapResizeObserver.observe(this.host);
      const root = this.host?.closest?.('.gb-scriptnote-root');
      if (root && root !== this.host && root !== scroll) this._wrapResizeObserver.observe(root);
      requestAnimationFrame(checkSize);
    } else {
      this._wrapResizeWindowHandler = checkSize;
      window.addEventListener('resize', this._wrapResizeWindowHandler);
    }
    this._wrapResizeInterval = setInterval(checkSize, 180);
  }

  _getCustomColumns() {
    return Array.isArray(this.doc.editor?.customColumns) ? this.doc.editor.customColumns : [];
  }

  _render() {
    if (!this.host || !this.doc) return;
    this._teardownWrapResizeObserver();
    if (typeof this._sanitizeRowSelection === 'function') this._sanitizeRowSelection();
    // フロートバーを除去（document.body上にあるため host.innerHTML='' では消えない）
    document.querySelectorAll('.sn2-row-bulk-bar').forEach(el => el.remove());
    // スクロール位置を保存（DOM再構築で失われるため）
    const prevScroll = this.host.querySelector('.sn2-scroll');
    const savedScrollTop = prevScroll ? prevScroll.scrollTop : 0;
    const savedScrollLeft = prevScroll ? prevScroll.scrollLeft : 0;
    this._calcCache = null;
    const calc = this._calcPagePanel();
    const viewMode = this.doc.editor?.viewMode || 'horizontal';
    const statusEnabled = !!this.doc.editor?.statusEnabled;
    const wrapMode = !!this.doc.editor?.wrapMode;
    const customCols = this._getCustomColumns();
    const colWidths = this.doc.editor?.columnWidths || {};

    const scroll = document.createElement('div');
    scroll.className = 'sn2-scroll' + (viewMode === 'vertical' ? ' sn2-vertical' : '') + (wrapMode ? ' sn2-wrap' : '');
    if (this.doc.editor?.pageBreakSpacing === false) scroll.classList.add('sn2-no-page-break-spacing');
    // 余白
    const marginRaw = this.doc.editor?.margin || '';
    const marginVal = marginRaw ? (/^\d+$/.test(marginRaw) ? marginRaw + 'px' : marginRaw) : '';
    if (marginVal) scroll.style.setProperty('--sn2-margin', marginVal);
    const editor = document.createElement('div');
    editor.className = 'sn2-editor';
    // 縦書き時のテキスト行数制限
    if (viewMode === 'vertical') {
      const vLines = this.doc.editor?.textWidth || 20;
      editor.style.setProperty('--sn2-vtext-lines', String(vLines));
    }
    // 段組み幅: ヘッダーの幅を基準にする（レンダリング後に測定）
    if (wrapMode && viewMode !== 'vertical') {
      // 一旦仮の値で設定、レンダリング後にヘッダーの実幅で更新
      const estWidth = (colWidths._handle || 20) + (colWidths._gutter || 40) + (colWidths._gutter2 || 48)
        + (colWidths._role || 88) + (statusEnabled ? (colWidths._status || 92) : 0)
        + (colWidths._text || 300) + customCols.reduce((s, c) => s + (colWidths[c.id] || c.width || 80), 0);
      editor.style.setProperty('--sn2-column-width', estWidth + 'px');
    }
    editor.dataset.border = this.doc.editor?.borderMode || 'all';
    editor.style.setProperty('--sn2-border-color', this.doc.editor?.borderColor || 'var(--border)');
    { const bw = String(this.doc.editor?.borderWidth || '1px');
      editor.style.setProperty('--sn2-border-width', /^\d+(\.\d+)?$/.test(bw) ? bw + 'px' : bw);
    }
    if (this.doc.editor?.themeId && typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getThemeById === 'function') {
      const themeVars = MeldexThemeManager.getThemeById(this.doc.editor.themeId)?.ui?.cssVars || {};
      [this.host, scroll, editor].forEach(target => {
        if (!target) return;
        Object.entries(themeVars).forEach(([key, value]) => {
          if (typeof COMMON_THEME_SURFACE_STYLE_KEYS !== 'undefined' && COMMON_THEME_SURFACE_STYLE_KEYS.has(key)) return;
          if (key.startsWith('--')) target.style.setProperty(key, value);
        });
      });
    }
    // テーマ設定
    if (this.doc.editor?.hoverBgColor) editor.style.setProperty('--sn2-hover-bg', this.doc.editor.hoverBgColor);
    if (this.doc.editor?.dropIndicatorColor) editor.style.setProperty('--sn2-drop-color', this.doc.editor.dropIndicatorColor);
    if (this.doc.editor?.spreadBorderColor) editor.style.setProperty('--sn2-spread-border-color', this.doc.editor.spreadBorderColor);
    if (this.doc.editor?.caretColor) editor.style.setProperty('--sn2-caret-color', this.doc.editor.caretColor);
    if (this.doc.editor?.dragSelectColor) editor.style.setProperty('--sn2-drag-select-color', this.doc.editor.dragSelectColor);
    if (this.doc.editor?.selectionColor) scroll.style.setProperty('--sn2-selection-color', this.doc.editor.selectionColor);
    if (this.doc.editor?.selectionTextColor) scroll.style.setProperty('--sn2-selection-fg', this.doc.editor.selectionTextColor);
    if (this.doc.editor?.caretWidth) {
      const cw = String(this.doc.editor.caretWidth);
      editor.style.setProperty('--sn2-caret-width', /^\d+(\.\d+)?$/.test(cw) ? cw + 'px' : cw);
    }
    if (this.doc.editor?.spreadBorderWidth) {
      const sbw = String(this.doc.editor.spreadBorderWidth);
      editor.style.setProperty('--sn2-spread-border-width', /^\d+(\.\d+)?$/.test(sbw) ? sbw + 'px' : sbw);
    }
    if (this.doc.editor?.dropIndicatorWidth) {
      const dw = String(this.doc.editor.dropIndicatorWidth);
      editor.style.setProperty('--sn2-drop-width', /^\d+(\.\d+)?$/.test(dw) ? dw + 'px' : dw);
    }
    // 基本テキスト設定
    if (this.doc.editor?.baseTextColor) scroll.style.setProperty('--sn2-base-text-color', this.doc.editor.baseTextColor);
    if (this.doc.editor?.baseTextFontFamily) scroll.style.setProperty('--sn2-base-text-font-family', this.doc.editor.baseTextFontFamily);
    if (this.doc.editor?.baseTextBold) scroll.style.setProperty('--sn2-base-text-bold', this.doc.editor.baseTextBold);
    if (this.doc.editor?.baseTextItalic) scroll.style.setProperty('--sn2-base-text-italic', this.doc.editor.baseTextItalic);
    if (this.doc.editor?.baseTextFontSize) scroll.style.setProperty('--sn2-base-text-font-size', this.doc.editor.baseTextFontSize + 'px');
    const lineHeight = viewMode === 'vertical'
      ? (this.doc.editor?.baseTextLineHeightV ?? this.doc.editor?.baseTextLineHeightH ?? this.doc.editor?.baseTextLineHeight)
      : (this.doc.editor?.baseTextLineHeightH ?? this.doc.editor?.baseTextLineHeightV ?? this.doc.editor?.baseTextLineHeight);
    if (lineHeight != null && lineHeight !== '') {
      scroll.style.setProperty('--sn2-base-text-line-height', String(lineHeight));
    }
    const letterSpacing = viewMode === 'vertical'
      ? (this.doc.editor?.baseTextLetterSpacingV ?? this.doc.editor?.baseTextLetterSpacingH ?? this.doc.editor?.baseTextLetterSpacing)
      : (this.doc.editor?.baseTextLetterSpacingH ?? this.doc.editor?.baseTextLetterSpacingV ?? this.doc.editor?.baseTextLetterSpacing);
    if (letterSpacing != null && letterSpacing !== '') {
      const ls = String(letterSpacing);
      scroll.style.setProperty('--sn2-base-text-letter-spacing', /^-?\d+(\.\d+)?$/.test(ls) ? ls + 'em' : ls);
    }
    // ルビ設定
    if (this.doc.editor?.rubyFontSize) scroll.style.setProperty('--sn2-ruby-size', this.doc.editor.rubyFontSize + 'em');
    if (this.doc.editor?.rubyOffset != null) scroll.style.setProperty('--sn2-ruby-offset', this.doc.editor.rubyOffset + 'px');

    // ヘッダー生成
    const textWidth = colWidths._text || 0;
    const colLabels = this.doc.editor?.columnLabels || {};
    const countDef = this._getCountDef();
    const defaultLabels = { _gutter: countDef.primaryLabel, _gutter2: countDef.secondaryLabel, _role: 'タイプ', _status: '採用状況', _text: 'テキスト' };
    const visCols = { _handle: true, _gutter: true, _gutter2: true, _role: true, _status: statusEnabled, _text: true, ...(this.doc.editor?.visibleStandardColumns || {}) };
    if (!statusEnabled) visCols._status = false;
    const allStdCols = [
      { id: '_handle', label: '', width: colWidths._handle || 36 },
      { id: '_gutter', label: colLabels._gutter || defaultLabels._gutter, width: colWidths._gutter || 40 },
      { id: '_gutter2', label: colLabels._gutter2 || defaultLabels._gutter2, width: colWidths._gutter2 || 48 },
      { id: '_role', label: colLabels._role || defaultLabels._role, width: colWidths._role || 88 },
      { id: '_status', label: colLabels._status || defaultLabels._status, width: colWidths._status || 92 },
      { id: '_text', label: colLabels._text || defaultLabels._text, width: textWidth },
    ];
    const unsortedCols = [
      ...allStdCols.filter(c => visCols[c.id] !== false),
      ...customCols.map(c => ({ id: c.id, label: c.label || c.id, width: colWidths[c.id] || c.width || 80 })),
    ];
    // columnOrderで並べ替え（_handleは常に先頭）
    const colOrder = this.doc.editor?.columnOrder;
    const cols = colOrder ? (() => {
      const handleCol = unsortedCols.find(c => c.id === '_handle');
      const rest = unsortedCols.filter(c => c.id !== '_handle');
      rest.sort((a, b) => {
        const ai = colOrder.indexOf(a.id), bi = colOrder.indexOf(b.id);
        if (ai >= 0 && bi >= 0) return ai - bi;
        if (ai >= 0) return -1;
        if (bi >= 0) return 1;
        return 0;
      });
      return handleCol ? [handleCol, ...rest] : rest;
    })() : unsortedCols;
    const buildHeader = (withResizer = true) => {
      const h = document.createElement('div');
      h.className = 'sn2-header' + (viewMode === 'vertical' ? ' sn2-header-vertical' : '');
      const safeId = (value) => String(value || 'col').replace(/[^a-zA-Z0-9_-]/g, '-');
      const colLabel = (col) => String(col?.label || defaultLabels[col?.id] || '列').trim() || '列';
      cols.forEach((col, ci) => {
        // リサイザーをセルの前に配置（前のセルとの境界）
        if (withResizer && ci > 0 && cols[ci - 1].id !== '_handle') {
          const resizeCol = cols[ci - 1];
          const resizer = document.createElement('div');
          resizer.className = 'sn2-col-resizer';
          resizer.dataset.colId = resizeCol.id;
          resizer.dataset.e2eId = `sn2-col-resizer-${safeId(resizeCol.id)}`;
          resizer.tabIndex = 0;
          resizer.setAttribute('role', 'separator');
          resizer.setAttribute('aria-orientation', viewMode === 'vertical' ? 'horizontal' : 'vertical');
          resizer.setAttribute('aria-label', `${colLabel(resizeCol)}列の幅を調整`);
          // ドラッグで前のセルのサイズを変える
          resizer.addEventListener('pointerdown', (e) => this._startColResize(e, resizeCol.id, resizer));
          resizer.addEventListener('keydown', (e) => this._handleColResizerKeydown?.(e, resizeCol.id));
          h.appendChild(resizer);
        }
        const cell = document.createElement('div');
        const isTextFlex = col.id === '_text' && !col.width;
        cell.className = 'sn2-header-cell' + (isTextFlex ? ' sn2-header-flex' : '');
        cell.textContent = col.label;
        cell.dataset.colId = col.id;
        cell.dataset.e2eId = `sn2-header-cell-${safeId(col.id)}`;
        if (viewMode === 'vertical' && col.id !== '_handle') this._wrapTcy(cell);
        if (col.width) cell.style.width = viewMode === 'vertical' ? '' : `var(--sn2-col-${col.id}, ${col.width}px)`;
        // ヘッダーセルのD&D並べ替え（_handle以外）
        if (col.id !== '_handle') {
          cell.draggable = true;
          cell.addEventListener('dragstart', (ev) => {
            ev.dataTransfer.effectAllowed = 'move';
            ev.dataTransfer.setData('text/plain', col.id);
            cell.style.opacity = '0.4';
          });
          cell.addEventListener('dragend', () => { cell.style.opacity = ''; });
          cell.addEventListener('dragover', (ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; cell.style.borderBottom = '2px solid var(--blue, #4a90d9)'; });
          cell.addEventListener('dragleave', () => { cell.style.borderBottom = ''; });
          cell.addEventListener('drop', (ev) => {
            ev.preventDefault();
            cell.style.borderBottom = '';
            const dragId = ev.dataTransfer.getData('text/plain');
            if (!dragId || dragId === col.id) return;
            const order = cols.filter(c => c.id !== '_handle').map(c => c.id);
            const fromIdx = order.indexOf(dragId);
            const toIdx = order.indexOf(col.id);
            if (fromIdx < 0 || toIdx < 0) return;
            order.splice(fromIdx, 1);
            order.splice(toIdx, 0, dragId);
            this._pushUndo('列順序変更');
            if (!this.doc.editor) this.doc.editor = {};
            this.doc.editor.columnOrder = order;
            this._render();
            this._markDirty();
          });
        }
        // ハンドル列ヘッダー: クリックで全選択/全解除メニュー
        if (col.id === '_handle') {
          cell.style.cursor = 'pointer';
          cell.title = '選択メニュー';
          cell.tabIndex = 0;
          cell.setAttribute('role', 'button');
          cell.setAttribute('aria-label', '行選択メニュー');
          cell.setAttribute('aria-haspopup', 'menu');
          cell.setAttribute('aria-expanded', 'false');
          cell.dataset.e2eId = 'sn2-header-select-menu-trigger';
          const openSelectMenu = (ev) => {
            ev.stopPropagation();
            document.querySelectorAll('.sn2-header-popup').forEach(el => el.remove());
            document.querySelectorAll('[data-e2e-id="sn2-header-select-menu-trigger"][aria-expanded="true"]').forEach(el => {
              el.setAttribute('aria-expanded', 'false');
            });
            const popup = document.createElement('div');
            popup.id = `sn2-header-select-menu-${Date.now()}`;
            popup.className = 'sn2-header-popup sn2-header-select-popup';
            popup.dataset.e2eId = 'sn2-header-select-menu';
            popup.setAttribute('role', 'menu');
            popup.setAttribute('aria-label', '行選択メニュー');
            let closeHandler = null;
            let escapeHandler = null;
            const closePopup = (restoreFocus = false) => {
              popup.remove();
              cell.setAttribute('aria-expanded', 'false');
              if (closeHandler) {
                document.removeEventListener('pointerdown', closeHandler, true);
                closeHandler = null;
              }
              if (escapeHandler) {
                document.removeEventListener('keydown', escapeHandler, true);
                escapeHandler = null;
              }
              if (restoreFocus) cell.focus();
            };
            const mkBtn = (text, actionId, fn) => {
              const b = document.createElement('button');
              b.className = 'sn2-header-popup-item'; b.type = 'button'; b.textContent = text;
              b.dataset.e2eId = `sn2-header-select-menu-${actionId}`;
              b.setAttribute('role', 'menuitem');
              b.addEventListener('click', () => { closePopup(false); fn(); });
              return b;
            };
            popup.appendChild(mkBtn('全選択', 'select-all', () => this._selectAllRows()));
            popup.appendChild(mkBtn('全選択解除', 'clear', () => this._clearRowSelection()));
            popup.style.cssText = 'position:fixed;z-index:10000;';
            document.body.appendChild(popup);
            cell.setAttribute('aria-expanded', 'true');
            cell.setAttribute('aria-controls', popup.id);
            positionPopup(popup, cell.getBoundingClientRect());
            if (typeof clampPopupToViewport === 'function') clampPopupToViewport(popup);
            closeHandler = (e) => {
              if (!popup.contains(e.target) && e.target !== cell) closePopup(false);
            };
            escapeHandler = (e) => {
              if (e.key !== 'Escape') return;
              e.preventDefault();
              e.stopPropagation();
              closePopup(true);
            };
            document.addEventListener('keydown', escapeHandler, true);
            requestAnimationFrame(() => popup.querySelector('.sn2-header-popup-item')?.focus());
            setTimeout(() => {
              if (popup.isConnected) document.addEventListener('pointerdown', closeHandler, true);
            }, 0);
          };
          cell.addEventListener('click', openSelectMenu);
          cell.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter' && ev.key !== ' ') return;
            ev.preventDefault();
            openSelectMenu(ev);
          });
        }
        // ヘッダーセルのイベント（_handle以外、段ヘッダーでもメニュー表示可）
        if (col.id !== '_handle') {
          let clickTimer = null;
          cell.tabIndex = 0;
          cell.setAttribute('role', 'button');
          cell.setAttribute('aria-haspopup', 'menu');
          cell.setAttribute('aria-expanded', 'false');
          cell.setAttribute('aria-label', `${colLabel(col)}列メニュー`);
          cell.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; return; }
            clickTimer = setTimeout(() => { clickTimer = null; this._showHeaderMenu(cell, col.id); }, 250);
          });
          cell.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter' && ev.key !== ' ') return;
            ev.preventDefault();
            if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
            this._showHeaderMenu(cell, col.id);
          });
          cell.addEventListener('dblclick', (ev) => {
            ev.stopPropagation();
            if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
            // メニューが開いていたら閉じる
            document.querySelectorAll('.sn2-header-popup, .sn2-header-sub-popup').forEach(el => el.remove());
            this._startHeaderLabelEdit(cell, col.id);
          });
          cell.style.cursor = 'pointer';
        }
        h.appendChild(cell);
      });
      // 最後のセル（テキスト or カスタム列）の下端/右端のリサイザー
      if (withResizer && cols.length > 0) {
        const lastCol = cols[cols.length - 1];
        const resizer = document.createElement('div');
        resizer.className = 'sn2-col-resizer';
        resizer.dataset.colId = lastCol.id;
        resizer.dataset.e2eId = `sn2-col-resizer-${safeId(lastCol.id)}`;
        resizer.tabIndex = 0;
        resizer.setAttribute('role', 'separator');
        resizer.setAttribute('aria-orientation', viewMode === 'vertical' ? 'horizontal' : 'vertical');
        resizer.setAttribute('aria-label', `${colLabel(lastCol)}列の幅を調整`);
        resizer.addEventListener('pointerdown', (e) => this._startColResize(e, lastCol.id, resizer));
        resizer.addEventListener('keydown', (e) => this._handleColResizerKeydown?.(e, lastCol.id));
        h.appendChild(resizer);
      }
      // スペーサー（ヘッダーの残り領域をページ背景色に）
      const spacer = document.createElement('div');
      spacer.className = 'sn2-header-spacer';
      h.appendChild(spacer);
      return h;
    };
    const header = buildHeader(true);

    // CSS変数で列幅/高さを設定
    const setColVars = (el) => {
      cols.forEach(col => {
        if (col.width) {
          el.style.setProperty(`--sn2-col-${col.id}`, col.width + 'px');
          if (viewMode === 'vertical') el.style.setProperty(`--sn2-vcol-${col.id}`, col.width + 'px');
        }
      });
      if (textWidth > 0) el.style.setProperty('--sn2-text-flex', '0 0 auto');
    };
    setColVars(scroll);
    setColVars(editor);

    // 全行を生成（フィルタ適用）
    const mergeDisplay = !!this.doc.editor?.mergeDisplay;
    const sb = this.doc.editor?.spreadBorder;
    const allRowEls = [];
    const allRowCalcs = []; // 見開き区切り判定用
    let prevVisibleRow = null;
    let prevVisibleCalc = null;
    for (let i = 0; i < this.doc.rows.length; i++) {
      // フィルタで非表示
      if (!this._isRoleVisible(this.doc.rows[i].role, this.doc.rows[i].status || '')) continue;
      const prevRow = prevVisibleRow;
