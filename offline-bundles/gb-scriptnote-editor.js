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
      const prevCalc = prevVisibleCalc;
      const rowEl = this._buildRowEl(this.doc.rows[i], i, calc[i], mergeDisplay, prevRow, prevCalc, customCols, cols);
      allRowEls.push(rowEl);
      allRowCalcs.push(calc[i]);
      prevVisibleRow = this.doc.rows[i];
      prevVisibleCalc = calc[i];
    }
    // 見開き区切り線: 次ページ先頭行の手前に区切り属性を付与
    if (sb?.enabled && allRowEls.length > 0) {
      const sbStart = sb.start ?? 1;
      const sbEvery = sb.every ?? 2;
      if (sbEvery > 0) {
        for (let j = 0; j < allRowEls.length - 1; j++) {
          const pg = allRowCalcs[j]?.page;
          const nextPg = allRowCalcs[j + 1]?.page;
          if (pg != null && nextPg != null && pg !== nextPg && (pg - sbStart) % sbEvery === 0 && pg >= sbStart) {
            allRowEls[j + 1].dataset.spreadBorder = 'true';
          }
        }
      }
    }

    if (!wrapMode) {
      // === 折り返しOFF ===
      // scroll直下にヘッダー（sticky）、その後にeditor
      scroll.appendChild(header);
      allRowEls.forEach(el => editor.appendChild(el));
      scroll.appendChild(editor);
    } else {
      // === 折り返しON: JSで段を手動分割 ===
      // 一旦仮レンダリングして行の高さ/幅を測定
      // 縦書き時は仮レンダリングでも縦書きレイアウトにする
      if (viewMode === 'vertical') {
        editor.style.display = 'flex';
        editor.style.flexDirection = 'row-reverse';
        editor.style.alignItems = 'flex-start';
        editor.style.width = 'max-content';
      }
      allRowEls.forEach(el => editor.appendChild(el));
      scroll.appendChild(editor);
      this.host.innerHTML = '';
      this.host.appendChild(scroll);

      // 段の最大サイズ = scrollの高さ（横書き）or 幅（縦書き）
      // CSS zoom 下で offsetHeight/clientHeight がブラウザ間で不整合な値を返す
      // 問題を避けるため、getBoundingClientRect + _getZoom() で CSS ピクセルに
      // 正規化してから packing 計算する。
      const zPack = typeof _getZoom === 'function' ? _getZoom() : 1;
      const measureWrapViewportSize = () => {
        const rect = scroll.getBoundingClientRect();
        const rectSize = (viewMode === 'vertical' ? rect.width : rect.height) / zPack;
        const clientSize = viewMode === 'vertical' ? scroll.clientWidth : scroll.clientHeight;
        if (Number.isFinite(clientSize) && clientSize > 0) return Math.min(rectSize, clientSize);
        return rectSize;
      };
      const wrapFitGuard = 2;
      const maxSize = measureWrapViewportSize();
      let verticalMeasureHeader = null;
      if (viewMode === 'vertical') {
        verticalMeasureHeader = buildHeader(false);
        verticalMeasureHeader.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;';
        scroll.appendChild(verticalMeasureHeader);
        const headerHeight = verticalMeasureHeader.getBoundingClientRect().height / zPack;
        if (headerHeight > 0) {
          allRowEls.forEach(el => { el.style.height = headerHeight + 'px'; });
        }
      }
      // ヘッダーサイズ: 縦書きではヘッダーの幅（行と同じ方向で場所を取る）
      // 仮測定ではなく、固定値を使う（ヘッダーの実幅は行のレイアウト確定後でないと正確に測れない）
      const headerSize = viewMode === 'vertical' ? 40 : 28;
      const availSize = Math.max(maxSize - headerSize - wrapFitGuard, 100);

      const applyVerticalWrapSizing = () => {
        if (viewMode !== 'vertical') return;
        const zV = typeof _getZoom === 'function' ? _getZoom() : 1;
        editor.querySelectorAll('.sn2-column-group').forEach(group => {
          const h = group.querySelector('.sn2-header');
          if (!h) return;
          const hH = h.getBoundingClientRect().height / zV;
          group.querySelectorAll('.sn2-row').forEach(r => {
            r.style.height = hH + 'px';
            const txt = r.querySelector('.sn2-text');
            if (txt) {
              const rW = r.getBoundingClientRect().width / zV;
              const scrollW = txt.scrollWidth;
              if (scrollW > rW) {
                r.style.minWidth = Math.ceil(scrollW) + 'px';
              }
            }
          });
        });
      };
      const rebuildWrapColumns = (columnsToBuild) => {
        while (editor.firstChild) editor.removeChild(editor.firstChild);
        columnsToBuild.forEach(colRows => {
          const group = document.createElement('div');
          group.className = 'sn2-column-group';
          group.appendChild(buildHeader(false));
          colRows.forEach(el => group.appendChild(el));
          editor.appendChild(group);
        });
        setColVars(editor);
      };
      const packWrapColumns = (sizes, availableSize) => {
        const packed = [[]];
        let current = 0;
        for (let i = 0; i < allRowEls.length; i++) {
          const rowSize = Math.max(1, Math.ceil(sizes[i] || 1));
          if (current + rowSize > availableSize && packed[packed.length - 1].length > 0) {
            packed.push([]);
            current = 0;
          }
          packed[packed.length - 1].push(allRowEls[i]);
          current += rowSize;
        }
        return packed;
      };
      const wrapColumnSignature = (columnsToCheck) => columnsToCheck
        .map(colRows => colRows.map(row => row.dataset.rowId || '').join(','))
        .join('|');
      const currentWrapColumnSignature = () => wrapColumnSignature([...editor.querySelectorAll('.sn2-column-group')]
        .map(group => [...group.querySelectorAll(':scope > .sn2-row')]));
      const measureWrapMargins = (el) => {
        const style = getComputedStyle(el);
        const before = parseFloat(viewMode === 'vertical' ? style.marginRight : style.marginTop) || 0;
        const after = parseFloat(viewMode === 'vertical' ? style.marginLeft : style.marginBottom) || 0;
        return { before, after, total: before + after };
      };
      const measureWrapOuterSize = (el) => {
        const rect = el.getBoundingClientRect();
        const margins = measureWrapMargins(el);
        const bodySize = (viewMode === 'vertical' ? rect.width : rect.height) / zPack;
        return Math.ceil(Math.max(bodySize + margins.total, 1));
      };
      const repackVerticalWrapFromFinalWidths = () => {
        if (viewMode !== 'vertical') return false;
        scroll.scrollLeft = 0;
        applyVerticalWrapSizing();
        return true;
      };
      const measureWrapOverflowAmounts = () => {
        const zV = typeof _getZoom === 'function' ? _getZoom() : 1;
        const currentScrollRect = scroll.getBoundingClientRect();
        if (viewMode === 'vertical') {
          const visibleRight = Math.min(
            currentScrollRect.right,
            currentScrollRect.left + (((scroll.clientWidth || currentScrollRect.width / zV) * zV))
          );
          return [...editor.querySelectorAll('.sn2-column-group > .sn2-row')].map(row => {
            const rect = row.getBoundingClientRect();
            return Math.max(0, currentScrollRect.left - rect.left, rect.right - visibleRight);
          }).filter(amount => amount > 1);
        }
        const visibleBottom = Math.min(
          currentScrollRect.bottom,
          currentScrollRect.top + (((scroll.clientHeight || currentScrollRect.height / zV) * zV))
        );
        return [...editor.querySelectorAll('.sn2-column-group > .sn2-row')].map(row => {
          const rect = row.getBoundingClientRect();
          return Math.max(0, currentScrollRect.top - rect.top, rect.bottom - visibleBottom);
        }).filter(amount => amount > 1);
      };
      const repackWrapFromFinalSizes = (force = false) => {
        if (viewMode === 'vertical') repackVerticalWrapFromFinalWidths();
        const overflowAmounts = measureWrapOverflowAmounts();
        if (!force && !overflowAmounts.length) return false;
        const zV = typeof _getZoom === 'function' ? _getZoom() : 1;
        const firstHeader = editor.querySelector('.sn2-column-group .sn2-header');
        const measuredHeaderSize = firstHeader
          ? (viewMode === 'vertical' ? firstHeader.getBoundingClientRect().width : firstHeader.getBoundingClientRect().height) / zV
          : headerSize;
        const currentMaxSize = measureWrapViewportSize();
        const baseAvailSize = Math.max(currentMaxSize - Math.ceil(measuredHeaderSize) - wrapFitGuard, 100);
        const finalRowSizes = allRowEls.map(measureWrapOuterSize);
        const packedColumns = packWrapColumns(finalRowSizes, baseAvailSize);
        const needsRebuild = overflowAmounts.length || currentWrapColumnSignature() !== wrapColumnSignature(packedColumns);
        if (!needsRebuild) return false;
        rebuildWrapColumns(packedColumns);
        if (viewMode === 'vertical') repackVerticalWrapFromFinalWidths();
        const remainingOverflow = measureWrapOverflowAmounts();
        if (remainingOverflow.length) {
          const overflowGuard = Math.ceil(Math.max(...remainingOverflow) / zV) + wrapFitGuard;
          const adjustedAvailSize = Math.max(baseAvailSize - overflowGuard, 100);
          if (adjustedAvailSize < baseAvailSize) {
            rebuildWrapColumns(packWrapColumns(finalRowSizes, adjustedAvailSize));
            if (viewMode === 'vertical') repackVerticalWrapFromFinalWidths();
          }
        }
        return true;
      };
      const resetVerticalWrapHorizontalPosition = () => {
        if (viewMode !== 'vertical') return;
        scroll.scrollLeft = 0;
      };
      const settleWrapPacking = (forceFirstPass = false) => {
        for (let pass = 0; pass < 4; pass += 1) {
          if (!repackWrapFromFinalSizes(forceFirstPass && pass === 0)) break;
        }
        resetVerticalWrapHorizontalPosition();
      };

      // 各行のサイズを測定（CSS ピクセルに正規化）
      const measureWrapRowSize = (el) => {
        let size = measureWrapOuterSize(el);
        if (viewMode === 'vertical') {
          // 縦書きは最終行高を先に適用してから実効幅を測る。
          // 行高未確定の scrollWidth を使うと長文方向の値になり、段が2行程度で折れる。
          const margins = measureWrapMargins(el);
          size = Math.max(size, (el.scrollWidth || 0) + margins.total);
          const txt = el.querySelector('.sn2-text');
          if (txt) {
            const textBodyWidth = txt.scrollWidth || 0;
            const textOuterWidth = textBodyWidth + margins.total;
            if (textOuterWidth > size) {
              el.style.minWidth = Math.ceil(textBodyWidth) + 'px';
              size = Math.max(textOuterWidth, measureWrapOuterSize(el));
            }
          }
        }
        return Math.ceil(Math.max(size, 1));
      };
      const rowSizes = allRowEls.map(measureWrapRowSize);

      // 段に分割
      const columns = packWrapColumns(rowSizes, availSize);

      // editorを再構築: 各段 = column-group div（ヘッダー + 行）
      // 子要素をdetach（参照を保持したまま除去）
      rebuildWrapColumns(columns);
      if (verticalMeasureHeader) verticalMeasureHeader.remove();
      // 仮レンダリング用のスタイルをリセット
      editor.style.removeProperty('display');
      editor.style.removeProperty('flex-direction');
      editor.style.removeProperty('align-items');
      editor.style.removeProperty('width');
      settleWrapPacking(true);
      this._bind();
      this._adjustRubySpacing();
      settleWrapPacking(true);
      // 縦書き折り返し: 各段のヘッダー高さを測定し行に適用 + テキスト幅拡張
      if (viewMode === 'vertical') {
        requestAnimationFrame(() => {
          settleWrapPacking(true);
        });
      }
      this._setupPanSpacer(scroll, editor, viewMode);
      // スクロール位置を復元
      scroll.scrollTop = savedScrollTop;
      scroll.scrollLeft = viewMode === 'vertical' ? 0 : savedScrollLeft;
      if (viewMode === 'vertical') resetVerticalWrapHorizontalPosition();
      // 折り返し表示でも行コメントバッジを通常表示と同じタイミングで再描画する
      if (this._path && typeof CommentBadges !== 'undefined') {
        try { CommentBadges.refreshScriptnote(this._path, this.host); } catch {}
      }
      this._setupWrapResizeObserver(scroll, viewMode, wrapMode);
      return;
    }

    this.host.innerHTML = '';
    this.host.appendChild(scroll);
    this._bind();
    this._adjustRubySpacing();
    // 縦書き: ヘッダーの高さを測定し行に適用（ヘッダーと行の下端を揃える）
    // + テキストが折り返して幅が必要な行はmin-widthを拡張
    if (viewMode === 'vertical') {
      requestAnimationFrame(() => {
        const h = scroll.querySelector('.sn2-header');
        if (!h) return;
        const zV = typeof _getZoom === 'function' ? _getZoom() : 1;
        const hH = h.getBoundingClientRect().height / zV;
        scroll.querySelectorAll('.sn2-row').forEach(r => {
          r.style.height = hH + 'px';
          const txt = r.querySelector('.sn2-text');
          if (txt) {
            const rW = r.getBoundingClientRect().width / zV;
            const scrollW = txt.scrollWidth;
            if (scrollW > rW) {
              r.style.minWidth = scrollW + 'px';
            }
          }
        });
      });
    }
    this._setupPanSpacer(scroll, editor, viewMode);
    // スクロール位置を復元
    scroll.scrollTop = savedScrollTop;
    scroll.scrollLeft = savedScrollLeft;
    // Phase 2e-ii: 行コメントバッジを描画
    if (this._path && typeof CommentBadges !== 'undefined') {
      try { CommentBadges.refreshScriptnote(this._path, this.host); } catch {}
    }
  }

  // 右ドラッグパン用の余白スペーサーを設置する。
  // editor の content box には一切影響しないよう、絶対配置で
  // editor の右下から +60vw, +60vh の位置に1pxの不可視要素を置く。
  // これによりスクロール領域だけが拡張される。
  // 縦書き行リバースモードでは editor の最終flex子として水平
  // スペーサーも追加し、視覚的な左方向にもパン可能にする。
  _setupPanSpacer(scroll, editor, viewMode) {
    if (!scroll || !editor) return;
    // 既存のスペーサーをすべて除去（再描画時の蓄積防止）
    scroll.querySelectorAll('.sn2-pan-spacer').forEach(el => el.remove());
    editor.querySelectorAll(':scope > .sn2-pan-spacer-inline').forEach(el => el.remove());
    // 縦書き row-reverse モード: 視覚的左方向の余白用の inline スペーサー
    const wrapMode = !!this.doc.editor?.wrapMode;
    if (viewMode === 'vertical' && !wrapMode) {
      const inline = document.createElement('div');
      inline.className = 'sn2-pan-spacer-inline';
      inline.style.cssText = 'flex-shrink:0;width:60vw;height:1px;pointer-events:none;background:transparent;';
      editor.appendChild(inline);
    }
    // 横書き折り返しモード: 表の右側にさらにパン余白を追加
    if (wrapMode && viewMode !== 'vertical') {
      const inline = document.createElement('div');
      inline.className = 'sn2-pan-spacer-inline';
      inline.style.cssText = 'flex-shrink:0;width:60vw;height:1px;pointer-events:none;background:transparent;';
      editor.appendChild(inline);
    }
    // 全モード共通: editor の右下に絶対配置スペーサー
    const absSpacer = document.createElement('div');
    absSpacer.className = 'sn2-pan-spacer';
    scroll.appendChild(absSpacer);
    // レイアウト確定後に位置を計算
    const place = () => {
      if (!editor.isConnected || !absSpacer.isConnected) return;
      const wPx = Math.round(window.innerWidth * 0.6);
      const hPx = Math.round(window.innerHeight * 0.6);
      const right = editor.offsetLeft + editor.offsetWidth;
      const bottom = editor.offsetTop + editor.offsetHeight;
      absSpacer.style.left = (right + wPx) + 'px';
      absSpacer.style.top = (bottom + hPx) + 'px';
    };
    requestAnimationFrame(() => {
      place();
      // 折り返しモードや縦書きモードでは2フレーム目に再計算（高さ調整後の位置を反映）
      requestAnimationFrame(place);
    });
  }

  _buildRowEl(row, idx, calc, mergeDisplay = false, prevRow = null, prevCalc = null, customCols = null, visibleCols = null) {
    if (!customCols) customCols = this._getCustomColumns();
    const el = document.createElement('div');
    el.className = 'sn2-row';
    el.dataset.rowId = row.id;
    // 枠線設定（タイプごとのオプション設定で制御）
    const chara = row.role
      ? this.doc.characters.find(c => !c.isDefault && c.name === row.role)
      : this.doc.characters.find(c => c.isDefault);
    // dataset.kind: 'blank' (空ロール), 'break' (区切り), 'summary' (プロット), 'action', 'heading', 'dialogue'
    let kind = 'dialogue';
    if (!row.role) kind = 'blank';
    else if (chara?.isSummary) kind = 'summary';
    else if (chara?.isBreak) kind = 'break';
    else if (['dialogue', 'action', 'heading'].includes(chara?.kind)) kind = chara.kind;
    el.dataset.kind = kind;
    const showOutline = !!chara?.outline;
    if (showOutline) {
      el.dataset.outline = 'true';
      // タイプ固有の枠線色・太さをCSS変数で設定
      if (chara?.outlineColor) el.style.setProperty('--sn2-outline-color', chara.outlineColor);
      if (chara?.outlineWidth) el.style.setProperty('--sn2-outline-width', chara.outlineWidth + 'px');
    }
    // まとめ表示: 前行と同じガター値やタイプ値なら非表示フラグ
    const mergeGutter = mergeDisplay && prevRow && calc && idx > 0;
    const mergeRole = mergeDisplay && prevRow && prevRow.role === row.role && row.role;
    const visCols = { _handle: true, _gutter: true, _gutter2: true, _role: true, _status: !!this.doc.editor?.statusEnabled, _text: true, ...(this.doc.editor?.visibleStandardColumns || {}) };
    if (!this.doc.editor?.statusEnabled) visCols._status = false;

    // 列間枠線: どの列の右側に枠線を表示するかを判定
    const colBorderSet = this._getColumnBorderSet();
    const appendCell = (colId, cell) => {
      if (!cell) return;
      cell.dataset.colId = colId;
      el.appendChild(cell);
    };

    // チェックボックス + ドラッグハンドル（ハンドルdiv内にチェックボックスを配置）
    if (visCols._handle !== false) {
      const rowId = row.id;
      const handle = document.createElement('div');
      handle.className = 'sn2-handle';
      // 注意: HTML5 draggable は使わない (ドラッグ中 wheel がブロックされるため)。
      // pointer events ベースの自前ドラッグ (_bind 内) で移動を実装する。
      handle.title = 'ドラッグで移動';
      handle.addEventListener('click', (ev) => {
        if (this._suppressRowCheckClick) {
          ev.preventDefault();
          ev.stopPropagation();
          return;
        }
        ev.stopPropagation();
        this._toggleRowSelection(rowId, idx, ev.shiftKey, ev.ctrlKey || ev.metaKey);
      });
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'sn2-row-check';
      cb.dataset.e2eId = `sn-row-${rowId}-select`;
      cb.checked = this._rowSelection?.has(rowId) || false;
      cb.title = '行を選択（Shift+クリックで範囲選択）';
      cb.setAttribute('aria-label', `行を選択: ${idx + 1}`);
      cb.addEventListener('click', (ev) => {
        if (this._suppressRowCheckClick) {
          ev.preventDefault();
          ev.stopPropagation();
          return;
        }
        ev.stopPropagation();
        this._toggleRowSelection(rowId, idx, ev.shiftKey, ev.ctrlKey || ev.metaKey);
      });
      handle.appendChild(cb);
      const gripText = document.createElement('span');
      gripText.textContent = '⠿';
      gripText.style.cssText = 'pointer-events:none;';
      handle.appendChild(gripText);
      appendCell('_handle', handle);
    }

    // ガター（大区切り：ページ番号等）
    const gutter = visCols._gutter !== false ? document.createElement('div') : null;
    if (gutter) gutter.className = 'sn2-gutter';
    // ガター2（小区切り：コマ番号等）
    const gutter2 = visCols._gutter2 !== false ? document.createElement('div') : null;
    if (gutter2) gutter2.className = 'sn2-gutter sn2-gutter2';
    // 配置設定を取得するヘルパー
    const stdSettings = this.doc.editor?.standardColumnSettings || {};
    const getColSettings = (colId) => {
      if (colId.startsWith('_')) return stdSettings[colId] || {};
      const cd = customCols.find(c => c.id === colId);
      return cd || {};
    };
    const cc = this.doc.editor?.countConfig || {};
    if (gutter) {
      if (calc) {
        const gutterText = this._formatGutterPrimary(calc);
        const prevGutterText = (mergeGutter && prevCalc) ? this._formatGutterPrimary(prevCalc) : '';
        const showGutterText = !(mergeGutter && gutterText === prevGutterText);
        gutter.textContent = showGutterText ? gutterText : '';
        // countConfigスタイルはdata属性に保存し、_applyRowStyleで参照する
        if (showGutterText && cc.primaryStyle) {
          const gs = cc.primaryStyle;
          if (gs.bgColor) gutter.dataset.ccBg = gs.bgColor;
          if (gs.textColor) gutter.dataset.ccColor = gs.textColor;
          if (gs.fontWeight) gutter.dataset.ccWeight = gs.fontWeight;
          if (gs.fontSize) gutter.dataset.ccSize = gs.fontSize;
        }
      }
      const gutterSt = getColSettings('_gutter');
      if (gutterSt.align) gutter.style.textAlign = gutterSt.align;
      if (gutterSt.valign) gutter.dataset.valign = gutterSt.valign;
      if (colBorderSet.has('_gutter')) gutter.dataset.colBorderRight = '';
      appendCell('_gutter', gutter);
    }
    if (gutter2) {
      if (calc) {
        const gutter2Text = this._formatGutterSecondary(calc);
        const prevGutter2Text = (mergeGutter && prevCalc) ? this._formatGutterSecondary(prevCalc) : '';
        const showGutter2Text = !(mergeGutter && gutter2Text === prevGutter2Text);
        gutter2.textContent = showGutter2Text ? gutter2Text : '';
        if (showGutter2Text && cc.secondaryStyle) {
          const gs = cc.secondaryStyle;
          if (gs.bgColor) gutter2.dataset.ccBg = gs.bgColor;
          if (gs.textColor) gutter2.dataset.ccColor = gs.textColor;
          if (gs.fontWeight) gutter2.dataset.ccWeight = gs.fontWeight;
          if (gs.fontSize) gutter2.dataset.ccSize = gs.fontSize;
        }
      }
      const gutter2St = getColSettings('_gutter2');
      if (gutter2St.align) gutter2.style.textAlign = gutter2St.align;
      if (gutter2St.valign) gutter2.dataset.valign = gutter2St.valign;
      if (colBorderSet.has('_gutter2')) gutter2.dataset.colBorderRight = '';
      appendCell('_gutter2', gutter2);
    }

    // タイプボタン
    let roleBtn = null;
    if (visCols._role !== false) {
      roleBtn = document.createElement('button');
      roleBtn.className = 'sn2-role-btn';
      roleBtn.type = 'button';
      roleBtn.textContent = mergeRole ? '' : (row.role || '');
      roleBtn.title = 'クリックで選択、ダブルクリックでタイプ変更';
      roleBtn.setAttribute('aria-label', `タイプ: ${row.role || '未設定'}`);
      roleBtn.tabIndex = 0;
      roleBtn.dataset.rowId = row.id;
      roleBtn.dataset.e2eId = `sn-row-${row.id}-role`;
      const roleSt = getColSettings('_role');
      if (roleSt.align) roleBtn.style.textAlign = roleSt.align;
      if (roleSt.valign) roleBtn.dataset.valign = roleSt.valign;
      if (colBorderSet.has('_role')) roleBtn.dataset.colBorderRight = '';
      appendCell('_role', roleBtn);
    }

    let statusBtn = null;
    if (visCols._status !== false && this.doc.editor?.statusEnabled) {
      statusBtn = document.createElement('button');
      statusBtn.className = 'sn2-status-btn';
      statusBtn.type = 'button';
      statusBtn.dataset.rowId = row.id;
      statusBtn.dataset.e2eId = `sn-row-${row.id}-status`;
      const statusSt = getColSettings('_status');
      if (statusSt.align) statusBtn.style.justifyContent = statusSt.align === 'right' ? 'flex-end' : statusSt.align === 'center' ? 'center' : 'flex-start';
      if (statusSt.valign) statusBtn.dataset.valign = statusSt.valign;
      if (colBorderSet.has('_status')) statusBtn.dataset.colBorderRight = '';
      if (typeof this._renderRowStatusButton === 'function') this._renderRowStatusButton(statusBtn, row);
      statusBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this._showRowStatusMenu?.(statusBtn, row, el);
      });
      appendCell('_status', statusBtn);
    }

    // テキスト
    let textDiv = null;
    if (visCols._text !== false) {
      textDiv = document.createElement('div');
      textDiv.className = 'sn2-text';
      textDiv.contentEditable = 'true';
      textDiv.dataset.rowId = row.id;
      textDiv.dataset.e2eId = `sn-row-${row.id}-text`;
      // 再描画をまたいでテキストセル範囲選択の表示を復元する
      if (this._textCellSelection?.has(row.id)) textDiv.classList.add('sn2-text-cell-selected');
      // ルビマークアップ {漢字|ルビ} をDOMに復元。エスケープ（\{ \| \} \\）を逆変換する
      const rowText = row.text || '';
      const manualLinkFrag = rowText && rowText.includes('](ml:') && typeof this._buildManualLinkFragment === 'function'
        ? this._buildManualLinkFragment(rowText)
        : null;
      if (manualLinkFrag) {
        textDiv.appendChild(manualLinkFrag);
      } else if (rowText && rowText.includes('{') && rowText.includes('|')) {
        const frag = document.createDocumentFragment();
        let last = 0;
        const re = _sn2NewRubyRegex();
        let m;
        while ((m = re.exec(rowText)) !== null) {
          if (m.index > last) frag.appendChild(document.createTextNode(_sn2UnescapeScriptNotePlainText(rowText.slice(last, m.index))));
          const span = document.createElement('span');
          span.dataset.ruby = _sn2UnescapeRubyText(m[2]);
          span.textContent = _sn2UnescapeRubyText(m[1]);
          frag.appendChild(span);
          last = m.index + m[0].length;
        }
        if (last < rowText.length) frag.appendChild(document.createTextNode(_sn2UnescapeScriptNotePlainText(rowText.slice(last))));
        textDiv.appendChild(frag);
      } else {
        textDiv.textContent = _sn2UnescapeScriptNotePlainText(rowText);
      }
      // 自動リンク（linkDict ルビ含む）→ シナリオ固有ルビの順で適用
      this._applyAutoLinks(textDiv);
      this._applyAutoRuby(textDiv);
      // D&D: フォルダツリー等からのドロップでリンク名テキストを挿入
      this._setupTextCellDrop(textDiv);
    }
    if (textDiv) {
      const textSt = getColSettings('_text');
      if (textSt.align) textDiv.dataset.align = textSt.align;
      if (textSt.valign) textDiv.dataset.valign = textSt.valign;
      if (textSt.overflow) textDiv.dataset.overflow = textSt.overflow;
      if (colBorderSet.has('_text')) textDiv.dataset.colBorderRight = '';
      appendCell('_text', textDiv);
    }

    // カスタム列
    if (!row.columns) row.columns = {};
    customCols.forEach(col => {
      const cell = document.createElement('div');
      cell.className = 'sn2-custom-cell';
      cell.dataset.colId = col.id;
      const isVMode = this.doc.editor?.viewMode === 'vertical';
      if (isVMode) {
        cell.style.height = `var(--sn2-vcol-${col.id}, ${col.width || 80}px)`;
      } else {
        cell.style.width = `var(--sn2-col-${col.id}, ${col.width || 80}px)`;
      }
      // 配置設定
      if (col.align) cell.dataset.align = col.align;
      if (col.valign) cell.dataset.valign = col.valign;
      const val = row.columns[col.id] ?? '';
      const colControlLabel = `${col.label || col.id || '列'}列`;
      if (col.type === 'number') {
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.className = 'sn2-custom-input';
        inp.dataset.e2eId = `sn-row-${row.id}-custom-${col.id}`;
        inp.setAttribute('aria-label', colControlLabel);
        inp.title = colControlLabel;
        inp.value = val;
        inp.addEventListener('change', () => {
          this._pushUndo('列値変更');
          const rawValue = inp.value;
          const numericValue = Number(rawValue);
          row.columns[col.id] = rawValue === '' ? '' : (Number.isFinite(numericValue) ? numericValue : '');
          this._markDirty({ skipUndo: true });
        });
        cell.appendChild(inp);
        // 単位表示
        if (col.unit) {
          const unitSpan = document.createElement('span');
          unitSpan.className = 'sn2-custom-unit';
          unitSpan.textContent = col.unit;
          cell.appendChild(unitSpan);
        }
      } else if (col.type === 'select' && Array.isArray(col.options)) {
        const sel = document.createElement('select');
        sel.className = 'sn2-custom-select';
        sel.dataset.e2eId = `sn-row-${row.id}-custom-${col.id}`;
        sel.setAttribute('aria-label', colControlLabel);
        sel.title = colControlLabel;
        col.options.forEach(opt => { const o = document.createElement('option'); o.value = opt; o.textContent = opt; sel.appendChild(o); });
        sel.value = val;
        sel.addEventListener('change', () => { this._pushUndo('列値変更'); row.columns[col.id] = sel.value; this._markDirty({ skipUndo: true }); });
        cell.appendChild(sel);
      } else {
        const inp = document.createElement('div');
        inp.className = 'sn2-custom-text';
        inp.contentEditable = 'true';
        inp.dataset.e2eId = `sn-row-${row.id}-custom-${col.id}`;
        inp.setAttribute('aria-label', colControlLabel);
        inp.title = colControlLabel;
        inp.textContent = val;
        this._applyAutoLinks(inp);
        this._applyAutoRuby(inp);
        if (col.overflow) inp.dataset.overflow = col.overflow;
        inp.addEventListener('input', () => {
          if (typeof this._scheduleAutoDecorate === 'function') this._scheduleAutoDecorate(inp);
        });
        inp.addEventListener('focusout', () => { this._pushUndo('列値変更'); row.columns[col.id] = inp.textContent || ''; this._markDirty({ skipUndo: true }); });
        cell.appendChild(inp);
      }
      if (colBorderSet.has(col.id)) cell.dataset.colBorderRight = '';
      appendCell(col.id, cell);
    });

    if (Array.isArray(visibleCols) && visibleCols.length) {
      visibleCols.map(col => col.id).forEach(colId => {
        const cell = Array.from(el.children).find(child => child.dataset?.colId === colId);
        if (cell) el.appendChild(cell);
      });
    }

    // 右端スペーサー（テキスト列が固定幅の場合、行の残り部分をページ背景色に）
    const spacer = document.createElement('div');
    spacer.className = 'sn2-row-spacer';
    el.appendChild(spacer);

    // キャラスタイル適用
    this._applyRowStyle(el, row.role);

    // 縦書き: 連続半角英数字を縦中横(tcy)で横組みブロック化
    if (this.doc.editor?.viewMode === 'vertical') {
      el.querySelectorAll('.sn2-gutter').forEach(c => this._wrapTcy(c, 'sn2-tcy-wide'));
      el.querySelectorAll('.sn2-role-btn, .sn2-custom-text').forEach(c => this._wrapTcy(c));
      if (textDiv) this._wrapTcy(textDiv);
    }

    return el;
  }

  // 連続半角英数字/記号をsn2-tcyスパンで囲む（縦中横）
  // テキストセル内のカーソル位置を「改行を含まない連続テキストの文字オフセット」
  // として取得する。DOM を書き換えても復元できるよう、span ラップや改行非依存
  // な安定座標にする。<br> は改行 1 文字としてカウントする。
  _getTextOffset(textEl) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return -1;
    const range = sel.getRangeAt(0);
    if (!textEl.contains(range.startContainer) && range.startContainer !== textEl) return -1;
    let offset = 0;
    let found = false;
    if (range.startContainer === textEl) {
      for (let i = 0; i < range.startOffset && i < textEl.childNodes.length; i++) {
        offset += this._textLenWithBr(textEl.childNodes[i]);
      }
      return offset;
    }
    const walk = (node) => {
      if (found) return;
      if (node === range.startContainer) {
        if (node.nodeType === 3) {
          offset += range.startOffset;
        } else {
          // element ノードがコンテナの場合: その要素の最初の startOffset 個分の
          // 子要素のテキスト長を加算
          for (let i = 0; i < range.startOffset && i < node.childNodes.length; i++) {
            offset += this._textLenWithBr(node.childNodes[i]);
          }
        }
        found = true;
        return;
      }
      if (node.nodeType === 3) {
        offset += node.textContent.length;
        return;
      }
      if (node.nodeType === 1) {
        if (node.tagName === 'BR') { offset += 1; return; }
        for (const c of node.childNodes) {
          walk(c);
          if (found) return;
        }
      }
    };
    for (const c of textEl.childNodes) { walk(c); if (found) break; }
    return found ? offset : -1;
  }

  _textLenWithBr(node) {
    if (node.nodeType === 3) return node.textContent.length;
    if (node.nodeType === 1) {
      if (node.tagName === 'BR') return 1;
      let len = 0;
      for (const c of node.childNodes) len += this._textLenWithBr(c);
      return len;
    }
    return 0;
  }

  // _getTextOffset で取得したオフセットを使ってカーソルを復元する
  _setTextOffset(textEl, offset) {
    if (offset < 0) return;
    let remaining = offset;
    let placed = false;
    const walk = (node) => {
      if (placed) return;
      if (node.nodeType === 3) {
        if (remaining <= node.textContent.length) {
          const range = document.createRange();
          range.setStart(node, remaining);
          range.collapse(true);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          placed = true;
          return;
        }
        remaining -= node.textContent.length;
        return;
      }
      if (node.nodeType === 1) {
        if (node.tagName === 'BR') {
          if (remaining === 0) {
            // BR の直前
            const range = document.createRange();
            range.setStartBefore(node);
            range.collapse(true);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            placed = true;
            return;
          }
          remaining -= 1;
          return;
        }
        for (const c of node.childNodes) {
          walk(c);
          if (placed) return;
        }
      }
    };
    for (const c of textEl.childNodes) { walk(c); if (placed) break; }
    if (!placed) {
      // 末尾にフォールバック
      this._focusText(textEl, 'end');
    }
  }

  _rangeWithinElement(range, el) {
    if (!range || !el) return false;
    return (range.startContainer === el || el.contains(range.startContainer))
      && (range.endContainer === el || el.contains(range.endContainer));
  }

  // デバウンス付きで自動ルビ/自動リンク/縦中横を再適用する。
  // 選択範囲がある場合はスキップ (ユーザー操作を邪魔しないため)。
  _scheduleAutoDecorate(textEl, delay = 200) {
    if (!textEl) return;
    if (!this._autoDecorateTimers) this._autoDecorateTimers = new WeakMap();
    const prev = this._autoDecorateTimers.get(textEl);
    if (prev) clearTimeout(prev);
    const run = () => {
      this._autoDecorateTimers.delete(textEl);
      if (this._imeComposing) return;
      const sel = window.getSelection();
      // 非 collapsed 選択中はスキップ (選択範囲が壊れる)
      if (sel && sel.rangeCount && !sel.isCollapsed) return;
      // textEl がまだ DOM に接続されている必要がある
      if (!textEl.isConnected) return;
      const offset = this._getTextOffset(textEl);
      // 既存装飾を剥がして text node を結合してから再適用する
      textEl.querySelectorAll('[data-auto-ruby], [data-auto-link], .sn2-tcy, .sn2-tcy-wide').forEach(span => {
        // data-ruby などユーザー定義のルビ span は剥がさない
        if (span.dataset && span.dataset.ruby && !span.dataset.autoRuby) return;
        if (span.classList.contains('auto-link') && !span.dataset?.autoLink) return;
        span.replaceWith(document.createTextNode(span.textContent));
      });
      textEl.normalize();
      this._applyAutoLinks(textEl);
      this._applyAutoRuby(textEl);
      if (this.doc?.editor?.viewMode === 'vertical') {
        this._wrapTcy(textEl);
      }
      if (offset >= 0) this._setTextOffset(textEl, offset);
      // カスタムキャレットも更新
      if (this._caretSelChangeHandler) this._caretSelChangeHandler();
    };
    if (delay > 0) {
      this._autoDecorateTimers.set(textEl, setTimeout(run, delay));
    } else {
      run();
    }
  }

  _wrapTcy(el, tcyCls = 'sn2-tcy') {
    const walk = (node) => {
      if (node.nodeType !== 3) return; // テキストノードのみ
      const text = node.textContent;
      // 連続する半角英数字・記号（スペース除く）を検出
      const re = /[a-zA-Z0-9!?.,;:'"()&%$#@+\-*/=<>[\]{}]+/g;
      let m, parts = [], last = 0;
      while ((m = re.exec(text)) !== null) {
        if (m.index > last) parts.push({ text: text.slice(last, m.index), tcy: false });
        parts.push({ text: m[0], tcy: true });
        last = m.index + m[0].length;
      }
      if (!parts.length) return;
      if (last < text.length) parts.push({ text: text.slice(last), tcy: false });
      const frag = document.createDocumentFragment();
      parts.forEach(p => {
        if (p.tcy) {
          const span = document.createElement('span');
          span.className = tcyCls;
          span.textContent = p.text;
          frag.appendChild(span);
        } else {
          frag.appendChild(document.createTextNode(p.text));
        }
      });
      node.parentNode.replaceChild(frag, node);
    };
    // 直接の子テキストノードのみ処理（span[data-ruby]等の中は触らない）
    [...el.childNodes].forEach(walk);
  }

  // === 行タイプ判定 ===

  // 設定駆動方針: タイプ名による暗黙判定は撤廃。空ロールのみ 'blank'、それ以外は 'dialogue'
  _detectKind(role) {
    if (!role) return 'blank';
    const r = String(role).trim();
    if (!r) return 'blank';
    return 'dialogue';
  }

  // 旧データ移行用: タイプ名から旧 kind を推測する（loadDoc 内の一回だけ使用）
  _legacyDetectKindByName(name) {
    if (!name) return 'blank';
    const r = String(name).trim();
    if (!r) return 'blank';
    const breaks = ['めくり', '改ページ', '白紙', '見開き', '巻頭カラー', 'トビラ絵', '場面転換', '暗転', '幕間'];
    if (breaks.includes(r)) return 'break';
    if (r === 'プロット') return 'summary';
    if (typeof PAGE_SETTINGS !== 'undefined' && Array.isArray(PAGE_SETTINGS) && PAGE_SETTINGS.includes(r)) return 'heading';
    const headings = ['柱', 'シーン', '○', 'シーン見出し', '第一幕', '第二幕', '第三幕', '場'];
    if (headings.some(h => r.startsWith(h)) || /^\d+\s*[.．]/.test(r)) return 'heading';
    if (typeof SPECIAL_CHARA !== 'undefined' && Array.isArray(SPECIAL_CHARA) && SPECIAL_CHARA.includes(r)) return 'action';
    const actions = ['ト書き', 'ト', '動作', '説明', 'N', 'ナレーション', 'ナレ', 'SE', 'ME', 'M',
                     'コマ外注釈', '擬音', 'モノローグ', '心の声', 'BGM', 'テロップ', '（間）',
                     '地の文', '独白', '傍白', '歌', '群衆'];
    if (actions.includes(r)) return 'action';
    return 'dialogue';
  }

  // === イベント ===

  _bind() {
    if (this._bound) return;
    this._bound = true;
    const host = this.host;

    // === ホイール/矩形選択/行コピー/右ドラッグパン → gb-scriptnote-interactions.js に移動 ===
    this._bindInteractionEvents(host);

    // === セルナビゲーション: クリックは「アクティブ化」のみ（即編集しない） ===
    // キャプチャフェーズで先に処理する。実際のmousedown→クリックの間にブラウザが
    // contentEditableへキャレットを置くが、この click ハンドラで contentEditable を
    // false に戻すため、同一フレーム内で「編集開始」の見た目には遷移しない。
    host.addEventListener('click', (e) => {
      const textEl = e.target.closest?.('.sn2-text, .sn2-custom-text');
      if (textEl && host.contains(textEl)) {
        const rowEl = textEl.closest('.sn2-row');
        if (!rowEl) return;
        const rowId = rowEl.dataset.rowId;
        const colId = textEl.dataset.colId || (textEl.closest('.sn2-custom-cell')?.dataset.colId) || '_text';
        if (this._cellEditMode && this._activeCellRowId === rowId && this._activeCellColId === colId) return;
        this._setActiveCell(rowId, colId, false);
        return;
      }
      const nativeCtrl = e.target.closest?.('.sn2-custom-input, .sn2-custom-select');
      if (nativeCtrl) {
        const customCell = nativeCtrl.closest('.sn2-custom-cell');
        const rowEl = nativeCtrl.closest('.sn2-row');
        if (!customCell || !rowEl || !host.contains(customCell)) return;
        const rowId = rowEl.dataset.rowId;
        const colId = customCell.dataset.colId;
        if (this._activeCellRowId === rowId && this._activeCellColId === colId) return;
        if (this._activeCellRowId) this._clearActiveCell?.();
        this._activeCellRowId = rowId;
        this._activeCellColId = colId;
        this._cellEditMode = true;
        customCell.classList.add('sn2-cell-active');
        nativeCtrl.focus();
      }
    }, true);

    host.addEventListener('dblclick', (e) => {
      const textEl = e.target.closest?.('.sn2-text, .sn2-custom-text');
      if (!textEl || !host.contains(textEl)) return;
      const rowEl = textEl.closest('.sn2-row');
      if (!rowEl) return;
      const rowId = rowEl.dataset.rowId;
      const colId = textEl.dataset.colId || (textEl.closest('.sn2-custom-cell')?.dataset.colId) || '_text';
      this._setActiveCell(rowId, colId, true);
    });

    // カスタムキャレット（太い線）
    let caretEl = null;
    // ブラウザの range.getClientRects() が 0 サイズを返すケース
    // (空セル / 改行直後 / DOM ミューテーション直後) の補完計算
    const computeFallbackRect = (range, textEl) => {
      const startContainer = range.startContainer;
      const startOffset = range.startOffset;
      const isVert = this.doc.editor?.viewMode === 'vertical';
      // TCY (tate-chu-yoko) 内のキャレットは縦書きモードでも横書きと同じ縦線にする
      let isInsideTcy = false;
      if (isVert && startContainer) {
        const el = startContainer.nodeType === 3 ? startContainer.parentElement : startContainer;
        isInsideTcy = !!(el?.closest?.('.sn2-tcy') || el?.closest?.('.sn2-tcy-wide'));
      }
      const effectiveVert = isVert && !isInsideTcy;
      const cs = getComputedStyle(textEl);
      // getComputedStyle は CSS ピクセル (ズーム未適用) を返すが、
      // getBoundingClientRect は CSS zoom 適用後の描画座標を返すため、
      // 加減算時は必ず _getZoom() を掛けて同じ座標系に揃える。
      const zFb = typeof _getZoom === 'function' ? _getZoom() : 1;
      const lineH = ((parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) * 1.6) || 16)) * zFb;
      const padTop = (parseFloat(cs.paddingTop) || 0) * zFb;
      const padLeft = (parseFloat(cs.paddingLeft) || 0) * zFb;
      const padRight = (parseFloat(cs.paddingRight) || 0) * zFb;
      const tr = textEl.getBoundingClientRect();
      // 横書きカーソル(縦線)を rect の右側に置くヘルパー
      const caretAfter = (r) => effectiveVert
        ? { left: r.left, top: r.bottom, right: r.right, bottom: r.bottom + 2, width: r.width, height: 2 }
        : { left: r.right, top: r.top, right: r.right + 2, bottom: r.bottom, width: 2, height: r.height };
      // 横書きカーソル(縦線)を rect の左側に置くヘルパー
      const caretBefore = (r) => effectiveVert
        ? { left: r.left, top: r.top, right: r.right, bottom: r.top + 2, width: r.width, height: 2 }
        : { left: r.left, top: r.top, right: r.left + 2, bottom: r.bottom, width: 2, height: r.height };
      // 1 文字分の rect を取得するヘルパー
      const charRect = (textNode, from, to) => {
        try {
          const r2 = document.createRange();
          r2.setStart(textNode, from);
          r2.setEnd(textNode, to);
          const r2rect = r2.getClientRects()[0] || r2.getBoundingClientRect();
          if (r2rect && (r2rect.width || r2rect.height)) return r2rect;
        } catch (e) {}
        return null;
      };
      // === Case A: startContainer がテキストノード ===
      if (startContainer.nodeType === 3) {
        // オフセット > 0: 1 文字戻した rect の右側にカーソル
        if (startOffset > 0) {
          const r = charRect(startContainer, startOffset - 1, startOffset);
          if (r) return caretAfter(r);
        }
        // オフセット 0: 先頭文字がある場合は左側にカーソル
        if (startContainer.length > 0) {
          const r = charRect(startContainer, 0, 1);
          if (r) return caretBefore(r);
        }
        // 空テキストノードの場合、prev/next をたどる
      }
      // === Case B: 直前の子要素を特定 ===
      let prev = null;
      if (startContainer.nodeType === 1 && startOffset > 0) {
        prev = startContainer.childNodes[startOffset - 1];
      } else if (startContainer.nodeType === 3) {
        prev = startContainer.previousSibling;
      }
      // prev がテキストノードなら最後の文字の右側にカーソル
      if (prev && prev.nodeType === 3 && prev.length > 0) {
        const r = charRect(prev, prev.length - 1, prev.length);
        if (r) return caretAfter(r);
      }
      // prev が BR なら次の行の先頭にカーソル
      if (prev && prev.nodeType === 1 && prev.tagName === 'BR') {
        const prr = prev.getBoundingClientRect();
        if (effectiveVert) {
          const x = prr.left - lineH;
          const y = tr.top + padTop;
          return { left: x, top: y, right: x + lineH, bottom: y + 16, width: lineH, height: 16 };
        }
        const x = tr.left + padLeft;
        const y = prr.bottom;
        return { left: x, top: y, right: x + 2, bottom: y + lineH, width: 2, height: lineH };
      }
      // それ以外（空セル等）: textEl の左上(横書き) / 右上(縦書き)
      if (effectiveVert) {
        const x = tr.right - padRight - lineH;
        const y = tr.top + padTop;
        return { left: x, top: y, right: x + lineH, bottom: y + 16, width: lineH, height: 16 };
      }
      const x = tr.left + padLeft;
      const y = tr.top + padTop;
      return { left: x, top: y, right: x + 2, bottom: y + lineH, width: 2, height: lineH };
    };

    const updateCaret = () => {
      const sel = window.getSelection();
      if (!sel?.isCollapsed || !sel.rangeCount) { if (caretEl) caretEl.style.display = 'none'; return; }
      const textEl = sel.anchorNode?.nodeType === 3
        ? sel.anchorNode.parentElement?.closest?.('.sn2-text')
        : sel.anchorNode?.closest?.('.sn2-text');
      if (!textEl || !host.contains(textEl)) { if (caretEl) caretEl.style.display = 'none'; return; }
      // 重要: caretEl は contenteditable な textEl の中ではなく、親の .sn2-row に置く。
      // textEl の子にすると caretEl が editable content として扱われ、入力文字が
      // caretEl に紛れ込んだり位置がずれたりする。
      const row = textEl.closest('.sn2-row');
      if (!row) { if (caretEl) caretEl.style.display = 'none'; return; }
      const range = sel.getRangeAt(0);
      let rect = range.getClientRects()[0] || range.getBoundingClientRect();
      // rect が 0 サイズなら推定で補完してカーソルを必ず表示する
      if (!rect || (!rect.height && !rect.width)) {
        rect = computeFallbackRect(range, textEl);
      }
      if (!rect) { if (caretEl) caretEl.style.display = 'none'; return; }
      const rowRect = row.getBoundingClientRect();
      const z = typeof _getZoom === 'function' ? _getZoom() : 1;
      if (!caretEl) {
        caretEl = document.createElement('div');
        caretEl.className = 'sn2-custom-caret';
      }
      if (caretEl.parentElement !== row) row.appendChild(caretEl);
      const isVert = this.doc.editor?.viewMode === 'vertical';
      // TCY (tate-chu-yoko) 内のキャレットは縦書きモードでも横書きと同じ縦線にする
      let isInsideTcy = false;
      if (isVert && sel.anchorNode) {
        const el = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
        isInsideTcy = !!(el?.closest?.('.sn2-tcy') || el?.closest?.('.sn2-tcy-wide'));
      }
      const dx = (rect.left - rowRect.left) / z;
      const dy = (rect.top - rowRect.top) / z;
      if (isVert && !isInsideTcy) {
        // 縦書き: キャレットは横線
        caretEl.style.left = dx + 'px';
        caretEl.style.top = dy + 'px';
        caretEl.style.width = (rect.width || 16) / z + 'px';
        caretEl.style.height = '';
      } else {
        // 横書き or 縦中横内: キャレットは縦線
        caretEl.style.left = dx + 'px';
        caretEl.style.top = dy + 'px';
        caretEl.style.height = (rect.height || 16) / z + 'px';
        caretEl.style.width = '';
      }
      caretEl.style.display = '';
      caretEl.style.animation = 'none';
      caretEl.offsetHeight; // reflow — 点滅リセット
      caretEl.style.animation = '';
    };
    // 前回のリスナーを解除（タブ開閉によるリーク防止）
    if (this._caretSelChangeHandler) document.removeEventListener('selectionchange', this._caretSelChangeHandler);
    this._caretSelChangeHandler = updateCaret;
    document.addEventListener('selectionchange', updateCaret);
    // focusout 時は同期で隠さず、次フレームで本当に host 外に出たかを再確認する
    // (セル間のフォーカス移動中に瞬間的に隠れる現象の回避)
    host.addEventListener('focusout', () => {
      setTimeout(() => {
        const ae = document.activeElement;
        if (!host.contains(ae) && caretEl) caretEl.style.display = 'none';
      }, 0);
    });

    // IME 変換中は DOM を書き換えない (変換が切れるため)
    this._imeComposing = false;
    host.addEventListener('compositionstart', (e) => {
      this._imeComposing = true;
      const text = e.target.closest?.('.sn2-text');
      if (text && typeof this._beginTextInputUndo === 'function') this._beginTextInputUndo('編集');
    });
    host.addEventListener('compositionend', (e) => {
      this._imeComposing = false;
      // 変換確定後にデバウンスなしで 1 度再適用
      const text = e.target.closest?.('.sn2-text');
      if (text) {
        this._scheduleTextCellLiveResize?.(text);
        this._scheduleAutoDecorate(text, 0);
      }
    });

    host.addEventListener('beforeinput', (e) => {
      const text = e.target.closest?.('.sn2-text');
      if (!text || e.isComposing) return;
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') return;
      if (typeof this._beginTextInputUndo === 'function') this._beginTextInputUndo('編集');
    });

    host.addEventListener('input', (e) => {
      const text = e.target.closest?.('.sn2-text');
      if (!text) return;
      this._dirty = true;
      this._scheduleSave();
      // 編集のたびに自動ルビ/自動リンク/縦中横を再適用 (デバウンス)
      // IME 変換中はスキップ (compositionend 側で拾う)
      this._scheduleTextCellLiveResize?.(text);
      if (!this._imeComposing) this._scheduleAutoDecorate(text);
      // カーソルが見えるようスクロール追従（改行時にのみ重い処理を実行）
      if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
        requestAnimationFrame(() => {
          const sel = window.getSelection();
          if (!sel?.rangeCount || !sel.isCollapsed) return;
          const r = sel.getRangeAt(0);
          const marker = document.createElement('span');
          marker.style.cssText = 'display:inline;';
          r.insertNode(marker);
          marker.scrollIntoView({ block: 'nearest', behavior: 'instant' });
          const markerParent = marker.parentNode;
          const markerIndex = markerParent ? Array.prototype.indexOf.call(markerParent.childNodes, marker) : -1;
          marker.remove();
          // マーカー除去後にselectionを復元
          if (markerParent && markerIndex >= 0) {
            const restoreRange = document.createRange();
            restoreRange.setStart(markerParent, Math.min(markerIndex, markerParent.childNodes.length));
            restoreRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(restoreRange);
          }
        });
      } else {
        // settleWrapPacking は別メソッドのローカル const のため、ここからは参照できない。
        // ファイル分割前は同じスコープに居たが、現状のコード構造では到達不可能。
        // ReferenceError を防ぐため typeof で存在チェックしてから呼ぶ。
        // （未到達時は折り返し再パックが走らないが、次のフル再レンダリングで反映される）
        requestAnimationFrame(() => {
          if (typeof settleWrapPacking === 'function') settleWrapPacking();
        });
      }
    });

    host.addEventListener('keydown', (e) => {
      if (e.isComposing) return;

      // アクティブセル（クリックで強調表示のみ・未編集）に対する矢印/Tab/Enter/Escapeは
      // ここでナビゲーションとして処理する。編集中のセルや無関係のターゲットには影響しない。
      if (typeof this._isActiveNonEditingTarget === 'function' && this._isActiveNonEditingTarget(e.target)) {
        if (this._handleNavigationKeydown(e)) return;
      }

      // ネイティブコントロール（数値入力・選択肢）が編集中のとき、Escape/Tab/Enterでセル編集を抜ける
      if (this._cellEditMode && this._activeCellRowId) {
        const nativeCtrl = e.target.closest?.('.sn2-custom-input, .sn2-custom-select');
        if (nativeCtrl) {
          if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey)) {
            e.preventDefault(); e.stopPropagation();
            nativeCtrl.blur();
            const wrapperEl = this._getCellElement(this._activeCellRowId, this._activeCellColId);
            this._cellEditMode = false;
            if (wrapperEl) { wrapperEl.classList.add('sn2-cell-active'); wrapperEl.tabIndex = 0; wrapperEl.focus(); }
            return;
          }
          if (e.key === 'Tab') {
            e.preventDefault(); e.stopPropagation();
            nativeCtrl.blur();
            this._cellEditMode = false;
            this._navigateCell(e.shiftKey ? 'prev-col' : 'next-col');
            return;
          }
        }
      }

      const roleKeyTarget = e.target.closest?.('.sn2-role-btn');
      if (roleKeyTarget && typeof this._handleRoleCellKeydown === 'function' && this._handleRoleCellKeydown(roleKeyTarget, e)) return;

      // Ctrl+Z / Ctrl+Y (undo/redo) — テキスト内外どちらでも動作
      const lk = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && lk === 'z' && !e.shiftKey) {
        if (typeof runMeldexShortcutById === 'function' && runMeldexShortcutById('scenario.undo', e)) return;
        e.preventDefault(); this.undo(); return;
      }
      if ((e.ctrlKey || e.metaKey) && (lk === 'y' || (lk === 'z' && e.shiftKey))) {
        if (typeof runMeldexShortcutById === 'function' && runMeldexShortcutById('scenario.redo', e)) return;
        e.preventDefault(); this.redo(); return;
      }
      // Ctrl+R: ルビ入力
      if ((e.ctrlKey || e.metaKey) && lk === 'r') {
        if (typeof runMeldexShortcutById === 'function' && runMeldexShortcutById('scenario.ruby', e)) return;
        e.preventDefault(); this._insertRuby(); return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (lk === 'f' || lk === 'h')) {
        const shortcutId = lk === 'h' ? 'scenario.replace' : 'scenario.search';
        if (typeof runMeldexShortcutById === 'function' && runMeldexShortcutById(shortcutId, e)) return;
        e.preventDefault();
        const searchBtn = this.host?.closest?.('.gb-se-root')?.querySelector?.('[data-sn-action="search"]') || null;
        this._showSearchReplacePopup?.(searchBtn);
        return;
      }
      // Ctrl+D: 行選択・テキスト選択を解除
      if ((e.ctrlKey || e.metaKey) && lk === 'd' && !e.shiftKey && !e.altKey) {
        if (typeof runMeldexShortcutById === 'function' && runMeldexShortcutById('scenario.deselectAll', e)) return;
        e.preventDefault();
        if (this._rowSelection?.size) this._clearRowSelection();
        if (this._textCellSelection?.size) this._clearTextCellSelection?.();
        this._lastSelectedIdx = -1;
        const dsel = window.getSelection();
        if (dsel?.rangeCount && !dsel.isCollapsed) dsel.collapseToStart();
        return;
      }
      // Alt+下: テキスト選択時にルビ設定を開く
      if (e.altKey && e.key === 'ArrowDown' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && sel.rangeCount) {
          const textEl = sel.anchorNode?.parentElement?.closest?.('.sn2-text');
          if (textEl) { e.preventDefault(); this._insertRuby(); return; }
        }
      }

      // PageUp/PageDown: 折り返しOFF時にスクロール
      if ((e.key === 'PageUp' || e.key === 'PageDown') && !this.doc.editor?.wrapMode) {
        const sc = host.querySelector('.sn2-scroll');
        if (sc) {
          e.preventDefault();
          const isV = this.doc.editor?.viewMode === 'vertical';
          const activeText = e.target.closest?.('.sn2-text');
          const caretOffset = activeText ? this._getTextOffset(activeText) : -1;
          const scRect = sc.getBoundingClientRect();
          const textRect = activeText?.getBoundingClientRect?.() || null;
          const probeX = textRect
            ? Math.min(scRect.right - 8, Math.max(scRect.left + 8, textRect.left + Math.min(24, textRect.width || 24)))
            : scRect.left + Math.min(scRect.width / 2, 48);
          const probeY = textRect
            ? Math.min(scRect.bottom - 8, Math.max(scRect.top + 8, textRect.top + Math.min(18, textRect.height || 18)))
            : scRect.top + Math.min(scRect.height / 2, 48);
          const amount = (isV ? sc.clientWidth : sc.clientHeight) * 0.8;
          if (isV) sc.scrollLeft += e.key === 'PageUp' ? amount : -amount;
          else sc.scrollTop += e.key === 'PageUp' ? -amount : amount;
          if (activeText) {
            requestAnimationFrame(() => {
              let nextText = document.elementFromPoint(probeX, probeY)?.closest?.('.sn2-text') || null;
              if (!nextText || !sc.contains(nextText)) {
                nextText = [...sc.querySelectorAll('.sn2-text')].find((el) => {
                  const rect = el.getBoundingClientRect();
                  return rect.bottom > scRect.top && rect.top < scRect.bottom && rect.right > scRect.left && rect.left < scRect.right;
                }) || null;
              }
              if (nextText) {
                nextText.focus();
                if (caretOffset >= 0) this._setTextOffset(nextText, Math.min(caretOffset, this._textLenWithBr(nextText)));
              }
            });
          }
        }
        return;
      }

      // Ctrl+上下: 行入れ替え（縦書き時はCtrl+右/左）
      const isVert = this.doc.editor?.viewMode === 'vertical';
      const swapPrevKey = isVert ? 'ArrowRight' : 'ArrowUp';
      const swapNextKey = isVert ? 'ArrowLeft' : 'ArrowDown';
      if ((e.ctrlKey || e.metaKey) && (e.key === swapPrevKey || e.key === swapNextKey)) {
        const shortcutId = e.key === swapPrevKey ? 'scenario.moveUp' : 'scenario.moveDown';
        if (typeof runMeldexShortcutById === 'function' && runMeldexShortcutById(shortcutId, e)) return;
        const text = e.target.closest?.('.sn2-text');
        if (!text) return;
        e.preventDefault();
        const row = text.closest('.sn2-row');
        if (!row) return;
        const rowId = row.dataset.rowId;
        const idx = this.doc.rows.findIndex(r => r.id === rowId);
        if (idx < 0) return;
        const dir = e.key === swapPrevKey ? -1 : 1;
        // フィルタで非表示の行をスキップ
        let targetIdx = idx + dir;
        while (targetIdx >= 0 && targetIdx < this.doc.rows.length) {
          const targetRow = this.doc.rows[targetIdx];
          if (this._isRoleVisible(targetRow.role, targetRow.status || '')) break;
          targetIdx += dir;
        }
        if (targetIdx < 0 || targetIdx >= this.doc.rows.length) return;
        this._pushUndo('行入れ替え');
        // スワップ前にtargetのIDを保存
        const targetRowId = this.doc.rows[targetIdx].id;
        const tmp = this.doc.rows[idx];
        this.doc.rows[idx] = this.doc.rows[targetIdx];
        this.doc.rows[targetIdx] = tmp;
        this._calcCache = null;
        // DOM操作のみで行を入れ替え（_render()を避けて軽量化）
        const targetRow = this.host?.querySelector(`.sn2-row[data-row-id="${targetRowId}"]`);
        if (row && targetRow && !this._filterRoles) {
          // フィルタなし: DOM操作のみで軽量入れ替え
          if (dir === -1) row.parentNode.insertBefore(row, targetRow);
          else row.parentNode.insertBefore(row, targetRow.nextSibling);
          // ガター更新
          this._updateGuttersFrom(Math.min(idx, targetIdx));
          // ハイライトアニメーション
          row.classList.add('sn2-swap-highlight');
          setTimeout(() => row.classList.remove('sn2-swap-highlight'), 400);
        } else {
          // フィルタ有効時はDOM行数とデータ行数がずれるので全体再描画
          this._render();
        }
        this._markDirty({ skipUndo: true });
        // 移動先の行にフォーカス（_render()後はDOMが再構築されるためIDで検索）
        requestAnimationFrame(() => {
          const curRow = this.host?.querySelector(`.sn2-row[data-row-id="${rowId}"]`);
          const newText = curRow?.querySelector('.sn2-text');
          if (!newText) return;
          // フォーカスが既にnewText内にあれば再フォーカスしない（カーソル位置を保つ）
          const csel = window.getSelection();
          const inText = csel?.anchorNode && newText.contains(csel.anchorNode);
          if (!inText) this._focusText(newText, 'start');
          // DOM移動直後はlayoutが確定していないことがあるため、
          // 二重rAFで確実に layout 後にカスタムキャレットを再描画する
          if (this._caretSelChangeHandler) this._caretSelChangeHandler();
          requestAnimationFrame(() => {
            if (this._caretSelChangeHandler) this._caretSelChangeHandler();
          });
        });
        return;
      }

      // テキストセル範囲選択中の Delete/Backspace: 行削除ではなく選択セルの内容をクリアする
      if ((e.key === 'Delete' || e.key === 'Backspace')
          && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
          && this._textCellSelection?.size
          && typeof this._clearSelectedTextCells === 'function') {
        e.preventDefault();
        this._clearSelectedTextCells();
        return;
      }

      const text = e.target.closest?.('.sn2-text');
      if (!text) return;
      // アクティブセルのみ（非編集中）の場合、旧来のテキスト編集キー処理
      // （Enter分割・Backspace/Delete行結合・Shift+Delete行削除等）は行わない。
      // 矢印/Tab/Enter/Escapeはホストのkeydownルーティングでナビゲーションが処理済み。
      if (typeof this._isActiveNonEditingTarget === 'function' && this._isActiveNonEditingTarget(text)) return;
      const isVertical = this.doc.editor?.viewMode === 'vertical';

      if (e.key === 'Enter' && !e.shiftKey && !(e.ctrlKey || e.metaKey)) {
        if (this._cellEditMode && typeof this._exitEditMode === 'function') {
          e.preventDefault();
          this._exitEditMode();
          return;
        }
        if (typeof runMeldexShortcutById === 'function' && runMeldexShortcutById('scenario.addRow', e)) return;
        e.preventDefault();
        const splitOffset = this._getTextOffset(text);
        this._pushUndo('行追加');
        this._splitRow(text, { keepRole: false, visibleOffset: splitOffset });
        return;
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        if (typeof runMeldexShortcutById === 'function' && runMeldexShortcutById('scenario.addRowSameType', e)) return;
        e.preventDefault();
        const splitOffset = this._getTextOffset(text);
        this._pushUndo('同タイプ行追加');
        this._splitRow(text, { keepRole: true, visibleOffset: splitOffset });
        return;
      }
      // Shift+Enter: 明示的に<br>を挿入して改行（ブラウザデフォルトに任せない）
      if (e.key === 'Enter' && e.shiftKey) {
        if (typeof runMeldexShortcutById === 'function' && runMeldexShortcutById('scenario.newline', e)) return;
        e.preventDefault();
        const sel = window.getSelection();
        if (!sel?.rangeCount) return;
        const range = sel.getRangeAt(0);
        if (!this._rangeWithinElement(range, text)) return;
        this._pushUndo('セル内改行');
        // 旧実装は dataset.before / dataset.after が設定されていると先頭・末尾での Shift+Enter を弾いていたが、
        // これらの affix は CSS の ::before / ::after 疑似要素なので <br> を挿入しても視覚順序は変わらない (常に affix の内側で改行される)。
        // ユーザー要望によりこの早期 return を撤廃し、末尾を含むあらゆる位置で改行を許可する。
        range.deleteContents();
        const br = document.createElement('br');
        range.insertNode(br);
        // <br>の後にカーソルを移動
        range.setStartAfter(br);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        // <br>が末尾なら trailing <br> を追加して空行を可視化（番兵）
        // カーソルは挿入brの直後＝trailing brの直前を指すため、新しい空行に表示される
        // insertNode がテキスト末尾で分割した場合に残る空テキストノードはスキップして判定
        let needsTrailingBr = true;
        for (let n = br.nextSibling; n; n = n.nextSibling) {
          if (n.nodeType === 3 && !n.textContent) continue; // 空テキストノードは無視
          if (n.nodeType === 1 && n.tagName === 'BR') { needsTrailingBr = false; break; } // 既存の番兵
          needsTrailingBr = false; // 何か可視コンテンツあり
          break;
        }
        if (needsTrailingBr) {
          text.appendChild(document.createElement('br'));
        }
        // 高さ自動調整のためリフロートリガー
        text.style.height = 'auto';
        this._syncRowFromDom(text, { skipUndo: true });
        this._scheduleTextCellLiveResize?.(text);
        // スクロール追従とカスタムキャレット再描画
        requestAnimationFrame(() => {
          const r2 = sel.getRangeAt(0);
          if (!this._rangeWithinElement(r2, text)) return;
          const marker = document.createElement('span');
          r2.insertNode(marker);
          marker.scrollIntoView({ block: 'nearest', behavior: 'instant' });
          const markerParent = marker.parentNode;
          const markerIndex = markerParent ? Array.prototype.indexOf.call(markerParent.childNodes, marker) : -1;
          marker.remove();
          if (markerParent && markerIndex >= 0) {
            const restoreRange = document.createRange();
            restoreRange.setStart(markerParent, Math.min(markerIndex, markerParent.childNodes.length));
            restoreRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(restoreRange);
          } else {
            sel.collapseToEnd();
          }
          // 末尾改行直後の空行は range.getClientRects() が 0 になりがちなので
          // 二重 rAF で layout 後に確実にカスタムキャレットを更新する
          if (this._caretSelChangeHandler) this._caretSelChangeHandler();
          requestAnimationFrame(() => {
            if (this._caretSelChangeHandler) this._caretSelChangeHandler();
          });
        });
        return;
      }

      // Tab: タイプ↔テキスト切り替え
      if (e.key === 'Tab') {
        if (typeof runMeldexShortcutById === 'function' && runMeldexShortcutById('scenario.tab', e)) return;
        e.preventDefault();
        const row = text.closest('.sn2-row');
        if (!row) return;
        const roleBtn = row.querySelector('.sn2-role-btn');
        if (roleBtn) this._showRoleMenu(roleBtn);
        return;
      }

      const roleFocusKey = isVertical ? 'ArrowUp' : 'ArrowLeft';
      if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && e.key === roleFocusKey) {
        e.preventDefault();
        const row = text.closest('.sn2-row');
        const roleBtn = row?.querySelector('.sn2-role-btn');
        const rowId = row?.dataset.rowId || '';
        const idx = this.doc.rows.findIndex(r => r.id === rowId);
        if (roleBtn && idx >= 0) {
          this._selectRoleCell?.(rowId, idx);
          roleBtn.focus();
          roleBtn.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        }
        return;
      }

      // 行間移動: 横書き=ArrowUp/Down、縦書き=ArrowLeft/Right
      // 非Shift: 2段階移動 (1) セル内で先頭/末尾へ移動 → (2) 既に境界なら隣のセルへ
      // Shift押下時: セル境界に達したら行選択を拡張、それ以外はブラウザのデフォルト
      const prevKey = isVertical ? 'ArrowRight' : 'ArrowUp';
      const nextKey = isVertical ? 'ArrowLeft' : 'ArrowDown';
      if (e.key === prevKey || e.key === nextKey) {
        const isPrev = e.key === prevKey;
        // Alt+矢印: 5 行スキップしてフォーカス移動 (フィルタ非表示はスキップ)
        if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          const curRow = text.closest('.sn2-row');
          const curRowId = curRow?.dataset.rowId;
          const curIdx = this.doc.rows.findIndex(r => r.id === curRowId);
          if (curIdx < 0) return;
          const dir = isPrev ? -1 : 1;
          let remaining = 5;
          let nextIdx = curIdx;
          while (remaining > 0) {
            let probe = nextIdx + dir;
            while (probe >= 0 && probe < this.doc.rows.length) {
              const rr = this.doc.rows[probe];
              if (this._isRoleVisible(rr.role || '', rr.status || '')) break;
              probe += dir;
            }
            if (probe < 0 || probe >= this.doc.rows.length) break;
            nextIdx = probe;
            remaining--;
          }
          if (nextIdx === curIdx) return;
          const nextRowEl = this.host?.querySelector(`.sn2-row[data-row-id="${this.doc.rows[nextIdx].id}"]`);
          const nextText = nextRowEl?.querySelector('.sn2-text');
          if (nextText) {
            this._focusText(nextText, isPrev ? 'end' : 'start');
            nextText.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
          }
          return;
        }
        if (e.shiftKey) {
          // Shift+矢印: セル境界に達したらテキストセル範囲選択を拡張、それ以外はブラウザのデフォルトに任せる
          const sel = window.getSelection();
          if (!sel?.rangeCount) return;
          // focusが属するセルを起点にする（複数セル選択時はfocusが別セルにいる）
          const focusText = sel.focusNode?.nodeType === 1
            ? sel.focusNode.closest?.('.sn2-text') || text
            : sel.focusNode?.parentElement?.closest?.('.sn2-text') || text;
          if (!this._isAtBoundary(focusText, isPrev, true)) return;
          e.preventDefault();
          const curRow = focusText.closest('.sn2-row');
          if (!curRow) return;
          const curRowId = curRow.dataset.rowId;
          const curIdx = this.doc.rows.findIndex(r => r.id === curRowId);
          if (curIdx < 0) return;
          if (!this._textCellSelection) this._textCellSelection = new Set();
          // アンカー検証: _textCellAnchorIdx が現在の選択に含まれていなければ curRow を新アンカーにする
          const anchorRow = (this._textCellAnchorIdx >= 0) ? this.doc.rows[this._textCellAnchorIdx] : null;
          let anchorIdx;
          if (anchorRow && this._textCellSelection.has(anchorRow.id)) {
            anchorIdx = this._textCellAnchorIdx;
          } else {
            this._textCellAnchorIdx = curIdx;
            anchorIdx = curIdx;
          }
          // 次の行を探す（フィルタ非表示はスキップ）
          const dir = isPrev ? -1 : 1;
          let nextIdx = curIdx + dir;
          while (nextIdx >= 0 && nextIdx < this.doc.rows.length) {
            const rr = this.doc.rows[nextIdx];
            if (this._isRoleVisible(rr.role || '', rr.status || '')) break;
            nextIdx += dir;
          }
          if (nextIdx < 0 || nextIdx >= this.doc.rows.length) return;
          // アンカー〜nextIdx の連続範囲で選択を再構築（排他制御とUI更新は _setTextCellRange 側で行う）
          if (typeof this._setTextCellRange === 'function') this._setTextCellRange(anchorIdx, nextIdx);
          // 次の行のテキストにフォーカス移動（境界端に置く）
          const nextRowEl = this.host?.querySelector(`.sn2-row[data-row-id="${this.doc.rows[nextIdx].id}"]`);
          const nextText = nextRowEl?.querySelector('.sn2-text');
          if (nextText) {
            this._focusText(nextText, isPrev ? 'end' : 'start');
            nextText.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
          }
          return;
        }
        // 非Shift: 視覚的境界行 + 絶対先頭/末尾の判定で 3 段階に分岐
        // (1) 境界行でない (複数行セルの中間行): ブラウザのデフォルト (1 行移動)
        // (2) 境界行 + 絶対先頭/末尾でない: セルの先頭/末尾へジャンプ
        // (3) 境界行 + 絶対先頭/末尾: 隣のセルへ移動
        if (!this._isAtBoundary(text, isPrev)) {
          // 境界行でない: ブラウザに任せる (preventDefault しない)
          return;
        }
        // 境界行内: 絶対先頭/末尾チェック
        // _focusText が range を (textNode, 0) に設定するため、container が
        // element の場合と text node の場合で compareBoundaryPoints が
        // equal を返さない。ここでは (text, 0) から現在位置まで (または
        // 現在位置から text の末端まで) の実テキスト長で判定する。
        const csel = window.getSelection();
        if (!csel?.rangeCount) return;
        const crange = csel.getRangeAt(0);
        let atAbsoluteEdge;
        try {
          const logicalLen = typeof this._logicalTextLenWithBr === 'function'
            ? this._logicalTextLenWithBr(text)
            : this._textLenWithBr(text);
          const caretOffset = this._getTextOffset(text);
          if (caretOffset >= 0) {
            atAbsoluteEdge = isPrev ? caretOffset <= 0 : caretOffset >= logicalLen;
          } else if (isPrev) {
            const ref = document.createRange();
            ref.setStart(text, 0);
            ref.setEnd(crange.startContainer, crange.startOffset);
            atAbsoluteEdge = ref.toString().length === 0;
          } else {
            const ref = document.createRange();
            ref.selectNodeContents(text);
            ref.setStart(crange.endContainer, crange.endOffset);
            atAbsoluteEdge = ref.toString().length === 0;
          }
        } catch (err) { atAbsoluteEdge = false; }
        e.preventDefault();
        if (!atAbsoluteEdge) {
          // 境界行内だが先頭/末尾でない: セルの絶対先頭/末尾へジャンプ
          this._focusText(text, isPrev ? 'start' : 'end');
          return;
        }
        // 既に絶対先頭/末尾: 隣のセルへ移動
        const row = text.closest('.sn2-row');
        let next = isPrev ? row?.previousElementSibling : row?.nextElementSibling;
        // nextがヘッダーや存在しない場合、段を跨いで移動
        if (!next || !next.classList.contains('sn2-row')) {
          next = this._findAdjacentRow(row, isPrev);
        }
        if (!next) return;
        const nextText = next.querySelector('.sn2-text');
        if (nextText) this._focusText(nextText, isPrev ? 'end' : 'start');
        return;
      }

      // PageUp/PageDown: 前後の段に移動（折り返しモード時）
      // 縦書き: PageUp=右の段、PageDown=左の段
      if (e.key === 'PageUp' || e.key === 'PageDown') {
        const isPrev = e.key === 'PageUp';
        const colGroup = text.closest('.sn2-column-group');
        if (!colGroup) return; // 折り返しOFFでは段なし
        e.preventDefault();
        const adjGroup = isPrev ? colGroup.previousElementSibling : colGroup.nextElementSibling;
        if (!adjGroup || !adjGroup.classList.contains('sn2-column-group')) return;
        const caretOffset = this._getTextOffset(text);
        const currentRows = [...colGroup.querySelectorAll('.sn2-row')];
        const currentRow = text.closest('.sn2-row');
        const currentIndex = Math.max(0, currentRows.indexOf(currentRow));
        const rows = adjGroup.querySelectorAll('.sn2-row');
        const target = rows[Math.min(currentIndex, Math.max(0, rows.length - 1))];
        const targetText = target?.querySelector('.sn2-text');
        if (targetText) {
          targetText.focus();
          if (caretOffset >= 0) this._setTextOffset(targetText, Math.min(caretOffset, this._textLenWithBr(targetText)));
          else this._focusText(targetText, isPrev ? 'end' : 'start');
          targetText.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        }
        return;
      }

      if (e.key === 'Backspace') {
        const sel = window.getSelection();
        if (!sel || !sel.isCollapsed) return;
        if ((sel.anchorNode === text && sel.anchorOffset === 0) ||
            (sel.anchorNode === text.firstChild && sel.anchorOffset === 0) ||
            (!text.textContent && !text.firstChild)) {
          e.preventDefault();
          this._pushUndo('行結合');
          this._mergeWithPrev(text);
          return;
        }
      }

      if (e.key === 'Delete' && !e.shiftKey) {
        const sel = window.getSelection();
        if (!sel || !sel.isCollapsed) return;
        // sel.anchorNode は null / 空テキストノードの末尾など NPE を起こしうるので null チェックを先に入れる
        const anchor = sel.anchorNode;
        const atEnd = (!text.textContent)
          || (!anchor)
          || (anchor === text && sel.anchorOffset >= text.childNodes.length)
          || (anchor.nodeType === 3 && sel.anchorOffset >= (anchor.length || 0) && !anchor.nextSibling);
        if (atEnd) {
          e.preventDefault();
          // セル末尾の改行 (\n / <br>) があればまずそれを削除する。
          // これがないと、text-after ("」" 等) が改行の後ろに描画されて
          // ユーザーから「Delete が効かない」ように見える。
          if (this._hasTrailingLineBreak(text)) {
            this._pushUndo('改行削除');
            this._removeTrailingLineBreak(text);
            this._syncRowFromDom(text);
            this._focusText(text, 'end');
            return;
          }
          this._pushUndo('行結合');
          this._mergeWithNext(text);
          return;
        }
      }

      // Shift+Delete: 現在行を削除
      if (e.key === 'Delete' && e.shiftKey) {
        if (typeof runMeldexShortcutById === 'function' && runMeldexShortcutById('scenario.deleteRow', e)) return;
        e.preventDefault();
        const row = text.closest('.sn2-row');
        if (!row) return;
        const rowId = row.dataset.rowId;
        const idx = this.doc.rows.findIndex(r => r.id === rowId);
        if (idx < 0) return;
        // 最後の1行は削除しない
        if (this.doc.rows.length <= 1) return;
        this._pushUndo('行削除');
        this.doc.rows.splice(idx, 1);
        this._calcCache = null;
        // 隣の行にフォーカス
        const focusIdx = Math.min(idx, this.doc.rows.length - 1);
        const focusId = this.doc.rows[focusIdx].id;
        this._render();
        this._markDirty({ skipUndo: true });
        const focusDeletedNeighbor = () => {
          const nextEl = this.host?.querySelector(`.sn2-row[data-row-id="${focusId}"] .sn2-text`);
          if (nextEl) {
            this._focusText(nextEl, 'start');
            document.dispatchEvent(new Event('selectionchange'));
            if (this._caretSelChangeHandler) this._caretSelChangeHandler();
          }
        };
        focusDeletedNeighbor();
        requestAnimationFrame(focusDeletedNeighbor);
        return;
      }
    });

    // Ctrl+Shift+V: keydownでフラグを立て、pasteハンドラでセル内ペーストに切り替える
    this._pasteInCellFlag = false;
    host.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
        this._pasteInCellFlag = true;
        // pasteイベントが発火しなかった場合のフォールバックリセット
        setTimeout(() => { this._pasteInCellFlag = false; }, 200);
      }
    }, true); // captureフェーズで先に処理

    // pasteハンドラ: 改行で行を分割（空白行はタイプなし空行として追加）
    // Ctrl+Shift+V: セル内改行として貼り付け（行分割しない）
    host.addEventListener('paste', (e) => {
      const textEl = e.target.closest?.('.sn2-text');
      if (!textEl) return;
      e.preventDefault();
      const activeSel = window.getSelection();
      const activeRange = activeSel?.rangeCount ? activeSel.getRangeAt(0) : null;
      const pasteInCell = !!this._pasteInCellFlag;
      this._pasteInCellFlag = false;
      if (activeRange && !this._rangeWithinElement(activeRange, textEl)) return;
      const plain = (e.clipboardData?.getData('text/plain') || '').replace(/\r\n?/g, '\n');
      if (!plain) return;
      // Ctrl+Shift+V（フラグ）または単一行: セル内にそのまま挿入
      const lines = plain.split('\n');
      if (pasteInCell || lines.length <= 1) {
        const sel = activeSel || window.getSelection();
        if (!sel?.rangeCount) return;
        const range = activeRange || sel.getRangeAt(0);
        this._pushUndo(pasteInCell ? 'セル内貼り付け' : '貼り付け');
        range.deleteContents();
        range.insertNode(document.createTextNode(plain));
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
        this._syncRowFromDom(textEl, { skipUndo: true });
        this._scheduleTextCellLiveResize?.(textEl);
        return;
      }
      // 複数行: 現在行にカーソル前後のテキストを分割し、残りの行を新規追加
      this._pushUndo('複数行ペースト');
      const pasteSel = activeSel || window.getSelection();
      if (activeRange && pasteSel && !pasteSel.isCollapsed) {
        activeRange.deleteContents();
        activeRange.collapse(false);
        pasteSel.removeAllRanges();
        pasteSel.addRange(activeRange);
      }
      this._syncRowFromDom(textEl, { skipUndo: true });
      const pasteCaretOffset = this._getTextOffset(textEl);
      const rowId = textEl.dataset.rowId;
      const idx = this.doc.rows.findIndex(r => r.id === rowId);
      if (idx < 0) return;
      const currentRow = this.doc.rows[idx];
      const sel = window.getSelection();
      let visibleOffset = _sn2StripRubyToPlain(currentRow.text).length;
      if (pasteCaretOffset >= 0) {
        visibleOffset = pasteCaretOffset;
      } else if (sel?.isCollapsed && sel.rangeCount) {
        const pos = this._getTextOffset(textEl);
        if (pos >= 0) visibleOffset = pos;
      }
      const [beforeText, afterText] = _sn2SplitRawTextByVisibleOffset(currentRow.text, visibleOffset);
      const escapedLines = lines.map(line => _sn2EscapeScriptNotePlainText(line));
      // 最初の行は現在行に追加
      currentRow.text = beforeText + escapedLines[0];
      let newStatus = currentRow.status || '';
      if (this._filterStatuses && this._filterStatuses.size === 1) {
        newStatus = [...this._filterStatuses][0];
      }
      // 中間行と最終行を新規行として挿入
      const newRows = [];
      for (let i = 1; i < lines.length; i++) {
        const isLast = i === lines.length - 1;
        const lineText = isLast ? escapedLines[i] + afterText : escapedLines[i];
        newRows.push({
          id: `sn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: lineText ? currentRow.role : '', // 空白行はタイプなし
          status: newStatus,
          text: lineText,
          columns: {},
        });
      }
      this.doc.rows.splice(idx + 1, 0, ...newRows);
      this._calcCache = null;
      this._render();
      this._markDirty({ skipUndo: true });
      // 最後に追加した行にフォーカス
      const focusLastPastedRow = () => {
        const lastRow = newRows[newRows.length - 1];
        const lastEl = this.host?.querySelector(`.sn2-row[data-row-id="${lastRow.id}"]`);
        const lastText = lastEl?.querySelector('.sn2-text');
        if (lastText) {
          this._focusText(lastText, 'end');
          document.dispatchEvent(new Event('selectionchange'));
          if (this._caretSelChangeHandler) this._caretSelChangeHandler();
        }
      };
      focusLastPastedRow();
      requestAnimationFrame(focusLastPastedRow);
    });

    host.addEventListener('click', (e) => {
      // 自動リンククリック
      const autoLink = e.target.closest?.('.auto-link');
      if (autoLink) {
        const isEditingLink = typeof this._isEditingAutoLinkTarget === 'function'
          ? this._isEditingAutoLinkTarget(autoLink)
          : false;
        if (!isEditingLink && typeof onAutoLinkClick === 'function') {
          e.preventDefault();
          onAutoLinkClick(autoLink, e);
        }
        return;
      }
      const roleBtn = e.target.closest?.('.sn2-role-btn');
      if (roleBtn) {
        e.preventDefault();
        e.stopPropagation();
        this._handleRoleCellClick?.(roleBtn, e);
        return;
      }
      // ハンドルクリック時はD&Dのみ（クリックは何もしない）
    });

    host.addEventListener('dblclick', (e) => {
      const roleBtn = e.target.closest?.('.sn2-role-btn');
      if (!roleBtn) return;
      e.preventDefault();
      e.stopPropagation();
      this._showRoleMenu(roleBtn);
    });

    // テキスト列の右クリックメニュー（＋長押しでも同メニュー）
    const _onScriptnoteRoleCtx = (e) => {
      const roleBtn = e.target.closest?.('.sn2-role-btn');
      if (!roleBtn) return;
      e.preventDefault();
      e.stopPropagation();
      this._showRoleCellContextMenu?.(roleBtn, e);
    };
    host.addEventListener('contextmenu', _onScriptnoteRoleCtx);

    // テキスト列の右クリックメニュー（＋長押しでも同メニュー）
    const _onScriptnoteTextCtx = (e) => {
      const textEl = e.target.closest?.('.sn2-text');
      if (!textEl) return;
      e.preventDefault();
      // 既存ポップアップを閉じる
      document.querySelectorAll('.sn2-context-menu, .sn2-header-popup').forEach(el => el.remove());
      const sel = window.getSelection();
      const hasSelection = sel && !sel.isCollapsed && sel.rangeCount > 0;
      // 選択範囲を保存（メニュー操作で選択が失われる対策）
      const savedRange = hasSelection ? sel.getRangeAt(0).cloneRange() : null;
      const savedText = hasSelection ? sel.toString().trim() : '';
      const commentAnchorEl = {
        getBoundingClientRect: () => {
          const x = Number.isFinite(e.clientX) && e.clientX > 0 ? e.clientX : textEl.getBoundingClientRect().left;
          const y = Number.isFinite(e.clientY) && e.clientY > 0 ? e.clientY : textEl.getBoundingClientRect().top;
          return { left: x, right: x, top: y, bottom: y, width: 0, height: 0 };
        },
      };
      const menu = document.createElement('div');
      menu.className = 'sn2-context-menu sn2-header-popup';
      menu.setAttribute('role', 'menu');
      const mkItem = (label, action, enabled = true, actionId = '') => {
        const btn = document.createElement('button');
        btn.className = 'sn2-header-popup-item';
        btn.type = 'button';
        btn.setAttribute('role', 'menuitem');
        if (actionId) {
          btn.dataset.sn2TextMenuAction = actionId;
          btn.dataset.e2eId = `sn2-text-menu-${actionId}`;
        }
        btn.textContent = label;
        btn.disabled = !enabled;
        if (!enabled) btn.setAttribute('aria-disabled', 'true');
        btn.addEventListener('click', () => {
          menu.remove();
          // 選択範囲を復元してからアクションを実行
          if (savedRange) { sel.removeAllRanges(); sel.addRange(savedRange); }
          action();
        });
        return btn;
      };
      menu.appendChild(mkItem('💬 コメントを追加', () => {
        if (typeof addCommentHere !== 'function') return;
        let override = null;
        try {
          if (typeof CommentBadges !== 'undefined' && typeof CommentBadges.detectCommentContext === 'function') {
            override = CommentBadges.detectCommentContext(textEl);
          }
        } catch (_) { override = null; }
        if (!override || override.targetKind === 'none') {
          const row = textEl.closest?.('.sn2-row[data-row-id]');
          const rowId = row?.dataset?.rowId || '';
          const filePath = this._path || this.doc?.source?.path || '';
          if (rowId && filePath) {
            override = {
              targetKind: 'scriptnote_line',
              filePath,
              targetRef: { file: filePath, lineId: rowId },
              snapshot: (textEl.textContent || '').trim().slice(0, 120),
            };
          }
        }
        addCommentHere(override || undefined, { anchorEl: commentAnchorEl });
      }, true, 'add-comment'));
      menu.appendChild(mkItem('コメント一覧を開く', () => {
        const filePath = this._path || this.doc?.source?.path || '';
        if (filePath && typeof CommentBadges !== 'undefined' && typeof CommentBadges.openPanelForFileComments === 'function') {
          CommentBadges.openPanelForFileComments(filePath);
        }
      }, true, 'open-comments'));
      menu.appendChild(mkItem('ルビ設定…', () => this._insertRuby(), hasSelection, 'ruby'));
      menu.appendChild(mkItem('リンクを挿入...', () => {
        if (typeof showLinkInsertModal === 'function') {
          showLinkInsertModal(savedRange, (result) => {
            if (!textEl.isConnected) return;
            if (typeof this._insertLinkResultIntoText === 'function') { this._insertLinkResultIntoText(textEl, savedRange, result); return; }
            const s = window.getSelection();
            if (result.type === 'file') {
              // savedRange を復元してファイル名を挿入
              if (savedRange) { s.removeAllRanges(); s.addRange(savedRange); }
              this._pushUndo('リンク挿入');
              document.execCommand('insertText', false, result.name);
              // linkDict に追加
              if (typeof linkDict !== 'undefined' && Array.isArray(linkDict)) {
                if (!linkDict.some(d => d.text === result.name && d.path === result.path)) {
                  linkDict.push({ text: result.name, path: result.path });
                }
              }
              this._syncRowFromDom(textEl, { skipUndo: true });
              this._applyAutoLinks(textEl);
            } else if (result.type === 'url') {
              if (savedRange) { s.removeAllRanges(); s.addRange(savedRange); }
              this._pushUndo('リンク挿入');
              document.execCommand('createLink', false, result.url);
              this._syncRowFromDom(textEl, { skipUndo: true });
            }
          });
        }
      }, true, 'insert-link'));
      menu.appendChild(mkItem('切り取り', () => document.execCommand('cut'), hasSelection, 'cut'));
      menu.appendChild(mkItem('コピー', () => document.execCommand('copy'), hasSelection, 'copy'));
      menu.appendChild(mkItem('貼り付け', async () => {
        try {
          const text = await navigator.clipboard.readText();
          const s = window.getSelection();
          if (s?.rangeCount && !this._rangeWithinElement(s.getRangeAt(0), textEl)) return;
          this._pushUndo('貼り付け');
          document.execCommand('insertText', false, text);
          this._syncRowFromDom(textEl, { skipUndo: true });
        } catch { document.execCommand('paste'); }
      }, true, 'paste'));
      menu.appendChild(mkItem('セル内に貼り付け', async () => {
        try {
          const clipText = await navigator.clipboard.readText();
          if (!clipText) return;
          const s = window.getSelection();
          if (!s?.rangeCount) return;
          const r = s.getRangeAt(0);
          if (!this._rangeWithinElement(r, textEl)) return;
          this._pushUndo('セル内貼り付け');
          r.deleteContents();
          r.insertNode(document.createTextNode(clipText));
          r.collapse(false);
          s.removeAllRanges();
          s.addRange(r);
          this._syncRowFromDom(textEl, { skipUndo: true });
        } catch { /* clipboard API unavailable */ }
      }, true, 'paste-in-cell'));
      menu.style.cssText = 'position:fixed;z-index:10000;min-width:140px;';
      const clickRect = { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY };
      positionPopup(menu, clickRect);
      setTimeout(() => {
        const closeCtx = (ev) => {
          if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', closeCtx); }
        };
        document.addEventListener('pointerdown', closeCtx);
      }, 0);
    };
    host.addEventListener('contextmenu', _onScriptnoteTextCtx);
    if (typeof addLongPressHandler === 'function') {
      addLongPressHandler(host, _onScriptnoteTextCtx);
    }

    host.addEventListener('focusout', (e) => {
      const text = e.target.closest?.('.sn2-text');
      if (!text) return;
      requestAnimationFrame(() => {
        if (!text.isConnected || !this.host?.contains(text)) return;
        this._syncRowFromDom(text, { skipUndo: true });
        if (typeof this._endTextInputUndo === 'function') this._endTextInputUndo();
      });
    });

    // === 行ドラッグ (pointer events 版) ===
    // HTML5 drag API は仕様上ドラッグ中に wheel イベントをターゲットに届けない
    // (Notion や他モダンエディタが独自実装する理由)。pointer events で自前実装
    // すれば wheel イベントは通常通り動作する。
    // - pointerdown on .sn2-handle: 待機状態。click が動くよう preventDefault は
    //   しない
    // - pointermove: 閾値を超えたらドラッグ開始。ゴースト表示 + 挿入インジ
    //   ケーター + 端オートスクロール
    // - pointerup: ドラッグ中なら drop 実行。ドラッグしていなければ click が
    //   通るので既存の行選択トグルが動く
    let pdragPending = false;
    let pdragActive = false;
    let pdragRowIds = [];
    let pdragStartX = 0, pdragStartY = 0;
    let pdragPointerId = 0;
    let pdragGhost = null;
    let pdragAutoScrollRaf = null;
    let pdragLastClientX = 0, pdragLastClientY = 0;
    const PDRAG_THRESHOLD = 4;

    const pdragAutoScrollStep = () => {
      if (!pdragActive) { pdragAutoScrollRaf = null; return; }
      const sc = document.elementFromPoint(pdragLastClientX, pdragLastClientY)?.closest?.('.sn2-scroll');
      if (!sc || !host.contains(sc)) {
        pdragAutoScrollRaf = requestAnimationFrame(pdragAutoScrollStep);
        return;
      }
      const rect = sc.getBoundingClientRect();
      const edge = 80;
      const maxSpeed = 22;
      const speedFor = (dist) => maxSpeed * Math.min(1, Math.max(0, dist / edge));
      const isVertMode = this.doc.editor?.viewMode === 'vertical';
      const isWrap = !!this.doc.editor?.wrapMode;
      let sx = 0, sy = 0;
      if (pdragLastClientX < rect.left + edge) sx = -speedFor(rect.left + edge - pdragLastClientX);
      else if (pdragLastClientX > rect.right - edge) sx = speedFor(pdragLastClientX - (rect.right - edge));
      if (pdragLastClientY < rect.top + edge) sy = -speedFor(rect.top + edge - pdragLastClientY);
      else if (pdragLastClientY > rect.bottom - edge) sy = speedFor(pdragLastClientY - (rect.bottom - edge));
      if (isVertMode && isWrap) {
        if (sc.scrollLeft !== 0) sc.scrollLeft = 0;
        if (sy !== 0) sc.scrollBy({ top: sy });
      } else if (isVertMode || (isWrap && !isVertMode)) {
        if (sx !== 0) sc.scrollBy({ left: sx });
        else if (sy !== 0) sc.scrollBy({ top: sy });
      } else {
        if (sy !== 0) sc.scrollBy({ top: sy });
        else if (sx !== 0) sc.scrollBy({ left: sx });
      }
      pdragAutoScrollRaf = requestAnimationFrame(pdragAutoScrollStep);
    };

    const pdragCleanup = () => {
      pdragPending = false;
      pdragActive = false;
      pdragRowIds = [];
      if (pdragGhost) { pdragGhost.remove(); pdragGhost = null; }
      if (pdragAutoScrollRaf != null) { cancelAnimationFrame(pdragAutoScrollRaf); pdragAutoScrollRaf = null; }
      host.querySelectorAll('.sn2-row').forEach(r => r.classList.remove('sn2-dragging', 'sn2-drop-above', 'sn2-drop-below'));
      try { host.releasePointerCapture(pdragPointerId); } catch {}
    };

    host.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const handle = e.target.closest?.('.sn2-handle');
      if (!handle) return;
      // チェックボックスクリックはドラッグ対象外
      if (e.target.closest?.('.sn2-row-check')) return;
      const row = handle.closest('.sn2-row');
      if (!row) return;
      pdragPending = true;
      pdragStartX = e.clientX;
      pdragStartY = e.clientY;
      pdragPointerId = e.pointerId;
      const startId = row.dataset.rowId;
      if (this._rowSelection?.size > 1 && this._rowSelection.has(startId)) {
        const sel = this._rowSelection;
        pdragRowIds = this.doc.rows.filter(r => sel.has(r.id)).map(r => r.id);
      } else {
        pdragRowIds = [startId];
      }
      // preventDefault はしない — click が通って _toggleRowSelection が動くように
    });

    host.addEventListener('pointermove', (e) => {
      if (pdragPending && !pdragActive) {
        if (e.pointerId !== pdragPointerId) return;
        const dx = e.clientX - pdragStartX;
        const dy = e.clientY - pdragStartY;
        if (Math.abs(dx) + Math.abs(dy) < PDRAG_THRESHOLD) return;
        // ドラッグ開始
        pdragActive = true;
        try { host.setPointerCapture(pdragPointerId); } catch {}
        const idSet = new Set(pdragRowIds);
        host.querySelectorAll('.sn2-row').forEach(r => {
          if (idSet.has(r.dataset.rowId)) r.classList.add('sn2-dragging');
        });
        // ゴースト表示
        pdragGhost = document.createElement('div');
        pdragGhost.className = 'sn2-pdrag-ghost';
        pdragGhost.textContent = pdragRowIds.length > 1 ? `${pdragRowIds.length} 行を移動` : '行を移動';
        pdragGhost.style.cssText = 'position:fixed;pointer-events:none;z-index:10000;background:var(--accent, #4a90d9);color:white;padding:4px 10px;border-radius:4px;font-size:12px;opacity:0.9;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
        document.body.appendChild(pdragGhost);
      }
      if (!pdragActive) return;
      e.preventDefault();
      pdragLastClientX = e.clientX;
      pdragLastClientY = e.clientY;
      // ゴースト位置更新
      if (pdragGhost) {
        pdragGhost.style.left = (e.clientX + 12) + 'px';
        pdragGhost.style.top = (e.clientY + 12) + 'px';
      }
      // ドロップインジケーター更新
      host.querySelectorAll('.sn2-row').forEach(r => r.classList.remove('sn2-drop-above', 'sn2-drop-below'));
      const overEl = document.elementFromPoint(e.clientX, e.clientY);
      const overRow = overEl?.closest?.('.sn2-row');
      if (overRow && host.contains(overRow) && !pdragRowIds.includes(overRow.dataset.rowId)) {
        const rect = overRow.getBoundingClientRect();
        const isVertMode = this.doc.editor?.viewMode === 'vertical';
        if (isVertMode) {
          // 縦書き: 左右で判定 (画面右側 = 手前 = above)
          overRow.classList.add(e.clientX > rect.left + rect.width / 2 ? 'sn2-drop-above' : 'sn2-drop-below');
        } else {
          overRow.classList.add(e.clientY < rect.top + rect.height / 2 ? 'sn2-drop-above' : 'sn2-drop-below');
        }
      }
      // 端オートスクロールを起動 (初回のみ)
      if (pdragAutoScrollRaf == null) {
        pdragAutoScrollRaf = requestAnimationFrame(pdragAutoScrollStep);
      }
    });

    host.addEventListener('pointerup', (e) => {
      if (!pdragActive) {
        // ドラッグ未開始 (通常クリック): cleanup のみ
        pdragPending = false;
        pdragRowIds = [];
        return;
      }
      if (e.pointerId !== pdragPointerId) return;
      // ドロップ実行
      const overEl = document.elementFromPoint(e.clientX, e.clientY);
      const targetRow = overEl?.closest?.('.sn2-row');
      if (targetRow && host.contains(targetRow) && !pdragRowIds.includes(targetRow.dataset.rowId)) {
        const targetId = targetRow.dataset.rowId;
        const rect = targetRow.getBoundingClientRect();
        const isVertMode = this.doc.editor?.viewMode === 'vertical';
        const insertAfter = isVertMode
          ? e.clientX < rect.left + rect.width / 2
          : e.clientY >= rect.top + rect.height / 2;
        this._pushUndo(pdragRowIds.length > 1 ? '行移動（複数）' : '行移動');
        const draggedSet = new Set(pdragRowIds);
        const moved = pdragRowIds.map(id => this.doc.rows.find(r => r.id === id)).filter(Boolean);
        for (let i = this.doc.rows.length - 1; i >= 0; i--) {
          if (draggedSet.has(this.doc.rows[i].id)) this.doc.rows.splice(i, 1);
        }
        let insertAt = this.doc.rows.findIndex(r => r.id === targetId);
        if (insertAt < 0) insertAt = this.doc.rows.length;
        else if (insertAfter) insertAt++;
        this.doc.rows.splice(insertAt, 0, ...moved);
        this._calcCache = null;
        this._render();
        this._markDirty();
      }
      pdragCleanup();
      // ドラッグ完了後の click をキャンセル (行選択トグルが誤発火するのを防ぐ)
      const suppressClick = (ev) => { ev.stopPropagation(); ev.preventDefault(); document.removeEventListener('click', suppressClick, true); };
      document.addEventListener('click', suppressClick, true);
      // 保険: click が発火しなかった場合に備えて次フレームで解除
      setTimeout(() => document.removeEventListener('click', suppressClick, true), 50);
    });
    host.addEventListener('pointercancel', () => { if (pdragActive || pdragPending) pdragCleanup(); });
  }

  // 段を跨いで隣接する行を取得（折り返しモードでcolumn-groupを越える）
  _findAdjacentRow(currentRow, isPrev) {
    const colGroup = currentRow.closest('.sn2-column-group');
    if (!colGroup) return null;
    const adjGroup = isPrev ? colGroup.previousElementSibling : colGroup.nextElementSibling;
    if (!adjGroup || !adjGroup.classList.contains('sn2-column-group')) return null;
    const rows = adjGroup.querySelectorAll('.sn2-row');
    if (!rows.length) return null;
    return isPrev ? rows[rows.length - 1] : rows[0];
  }

  _isAtBoundary(textEl, isPrev, allowSelection) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    if (!sel.isCollapsed && !allowSelection) return false;
    // テキスト先頭/末尾のプレーンテキスト判定（rectが取れない場合のフォールバック）
    // 選択中はfocusNode/focusOffsetで判定（anchorは選択の開始点なので移動先ではない）
    const useNode = allowSelection && !sel.isCollapsed ? sel.focusNode : sel.anchorNode;
    const useOff = allowSelection && !sel.isCollapsed ? sel.focusOffset : sel.anchorOffset;
    const isAtTextStart = () => {
      if (useNode === textEl && useOff === 0) return true;
      if (useNode === textEl.firstChild && useOff === 0) return true;
      let first = textEl.firstChild;
      while (first && first.nodeType === 1) first = first.firstChild;
      return first && useNode === first && useOff === 0;
    };
    const isAtTextEnd = () => {
      if (useNode === textEl && useOff >= textEl.childNodes.length) return true;
      if (useNode.nodeType === 3 && useOff >= useNode.length && !useNode.nextSibling) return true;
      let last = textEl.lastChild;
      while (last && last.nodeType === 1) last = last.lastChild;
      return last && useNode === last && useOff >= last.length;
    };
    const logicalOffset = this._getTextOffset(textEl);
    if (logicalOffset >= 0) {
      const logicalLen = typeof this._logicalTextLenWithBr === 'function'
        ? this._logicalTextLenWithBr(textEl)
        : this._textLenWithBr(textEl);
      if (isPrev && logicalOffset <= 0) return true;
      if (!isPrev && logicalOffset >= logicalLen) return true;
    }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const elRect = textEl.getBoundingClientRect();
    const cs = getComputedStyle(textEl);
    const isVertical = this.doc.editor?.viewMode === 'vertical';

    if (isVertical) {
      if (elRect.width <= 0) return true;
      const padRight = parseFloat(cs.paddingRight) || 0;
      const padLeft = parseFloat(cs.paddingLeft) || 0;
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.6;
      const contentWidth = elRect.width - padRight - padLeft;
      if (contentWidth <= lh * 1.5) {
        if (allowSelection) return isPrev ? isAtTextStart() : isAtTextEnd();
        return true;
      }
      // rect が取れない場合はテキスト先頭/末尾で判定
      if (rect.width <= 0 && rect.height <= 0) return isPrev ? isAtTextStart() : isAtTextEnd();
      if (isPrev) return rect.right > elRect.right - padRight - lh;
      return rect.left < elRect.left + padLeft + lh;
    }
    // 横書き
    if (elRect.height <= 0) return true;
    const padTop = parseFloat(cs.paddingTop) || 0;
    const padBot = parseFloat(cs.paddingBottom) || 0;
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.6;
    const contentHeight = elRect.height - padTop - padBot;
    if (contentHeight <= lh * 1.5) {
      if (allowSelection) return isPrev ? isAtTextStart() : isAtTextEnd();
      return true;
    }
    // rect が取れない場合はテキスト先頭/末尾で判定
    if (rect.width <= 0 && rect.height <= 0) return isPrev ? isAtTextStart() : isAtTextEnd();
    if (isPrev) return rect.top < elRect.top + padTop + lh;
    return rect.bottom > elRect.bottom - padBot - lh;
  }

  _focusText(textEl, place = 'start') {
    textEl.focus();
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    // Chromium の range.getClientRects() は (element, 0) のような要素基準の
    // 位置だとテキストノード基準と異なる rect を返すことがあり、CSS zoom 時に
    // カスタムキャレットの位置がずれる。テキストノードが存在する場合はそれを
    // 基準にして、ネイティブのキャレット測定と同じパスを踏ませる。
    const walker = document.createTreeWalker(textEl, NodeFilter.SHOW_TEXT);
    let targetNode = null;
    let targetOffset = 0;
    if (place === 'start') {
      targetNode = walker.nextNode();
      targetOffset = 0;
    } else {
      let last = null;
      let node;
      while ((node = walker.nextNode())) last = node;
      targetNode = last;
      targetOffset = last ? last.nodeValue.length : 0;
    }
    if (targetNode) {
      range.setStart(targetNode, targetOffset);
      range.collapse(true);
    } else {
      // 空セル: 従来通り要素を指定
      range.selectNodeContents(textEl);
      range.collapse(place === 'start');
    }
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // === 行操作 ===

  _splitRow(textEl, opts) {
    const row = textEl.closest('.sn2-row');
    if (!row) return;
    const rowId = row.dataset.rowId;
    const idx = this.doc.rows.findIndex(r => r.id === rowId);
    if (idx < 0) return;

    // ルビ対応: DOMを同期してからテキストを分割
    this._syncRowFromDom(textEl, { skipUndo: true });
    const fullText = this.doc.rows[idx].text;
    const sel = window.getSelection();
    let beforeText = fullText, afterText = '';
    const providedVisibleOffset = Number.isFinite(opts?.visibleOffset) ? opts.visibleOffset : -1;
    if (providedVisibleOffset >= 0 || (sel && sel.isCollapsed && sel.rangeCount > 0)) {
      const visibleOffset = providedVisibleOffset >= 0 ? providedVisibleOffset : this._getTextOffset(textEl);
      if (visibleOffset >= 0) {
        [beforeText, afterText] = _sn2SplitRawTextByVisibleOffset(fullText, visibleOffset);
      }
    }

    this.doc.rows[idx].text = beforeText;

    // タイプ決定: keepRole=trueなら同じタイプ、falseなら空（なし）
    // フィルタで1タイプだけ表示中ならそのタイプを使用
    let newRole = opts?.keepRole ? this.doc.rows[idx].role : '';
    if (this._filterRoles && this._filterRoles.size === 1) {
      newRole = [...this._filterRoles][0];
    }
    let newStatus = this.doc.rows[idx].status || '';
    if (this._filterStatuses && this._filterStatuses.size === 1) {
      newStatus = [...this._filterStatuses][0];
    }
    const newRow = { id: `sn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: newRole, status: newStatus, text: afterText, columns: {} };
    this.doc.rows.splice(idx + 1, 0, newRow);
    this._calcCache = null;
    // ルビ対応: 全体再描画で正しくDOMを構築
    this._render();
    this._markDirty({ skipUndo: true });
    // 新しい行にフォーカス。E2E/高速操作では rAF だけだと次操作が先行するため即時にも反映する。
    const focusNewRow = () => {
      const newRowEl = this.host?.querySelector(`.sn2-row[data-row-id="${newRow.id}"]`);
      const newText = newRowEl?.querySelector('.sn2-text');
      if (newText) {
        this._focusText(newText, 'start');
        document.dispatchEvent(new Event('selectionchange'));
        if (this._caretSelChangeHandler) this._caretSelChangeHandler();
      }
    };
    focusNewRow();
    requestAnimationFrame(focusNewRow);
  }

  _mergeWithPrev(textEl) {
    const row = textEl.closest('.sn2-row');
    if (!row) return;
    let prev = row.previousElementSibling;
    // 折り返しモード: 段の最初の行なら前の段の最後の行を探す
    if (!prev || !prev.classList.contains('sn2-row')) prev = this._findAdjacentRow(row, true);
    if (!prev) return;
    const prevText = prev.querySelector('.sn2-text');
    if (!prevText) return;

    const rowId = row.dataset.rowId;
    const prevId = prev.dataset.rowId;
    const idx = this.doc.rows.findIndex(r => r.id === rowId);
    const prevIdx = this.doc.rows.findIndex(r => r.id === prevId);
    if (idx < 0 || prevIdx < 0) return;

    // ルビ対応: DOM同期してからテキスト結合
    this._syncRowFromDom(prevText, { skipUndo: true });
    this._syncRowFromDom(textEl, { skipUndo: true });
    const cursorPos = this.doc.rows[prevIdx].text.length;
    this.doc.rows[prevIdx].text += this.doc.rows[idx].text;
    this.doc.rows.splice(idx, 1);
    this._calcCache = null;
    this._render();
    this._markDirty({ skipUndo: true });
    // 結合位置にカーソル
    const focusMergedRow = () => {
      const newPrevEl = this.host?.querySelector(`.sn2-row[data-row-id="${prevId}"]`);
      const newPrevText = newPrevEl?.querySelector('.sn2-text');
      if (newPrevText) this._focusTextAt(newPrevText, cursorPos);
    };
    focusMergedRow();
    requestAnimationFrame(focusMergedRow);
  }

  // セル末尾に改行 (\n / <br>) があるかを判定する (DOM 変更なし)
  _hasTrailingLineBreak(textEl) {
    if (!textEl) return false;
    let last = textEl.lastChild;
    while (last && last.nodeType === 3 && last.textContent === '') {
      last = last.previousSibling;
    }
    if (!last) return false;
    if (last.nodeType === 3 && last.textContent.endsWith('\n')) return true;
    if (last.nodeType === 1 && last.tagName === 'BR') return true;
    return false;
  }

  _isTerminalSentinelBrNode(node, root) {
    if (!node || node.nodeType !== 1 || node.tagName !== 'BR' || !root) return false;
    let next = node.nextSibling;
    while (next && next.nodeType === 3 && next.textContent === '') next = next.nextSibling;
    if (next) return false;
    let prev = node.previousSibling;
    while (prev && prev.nodeType === 3 && prev.textContent === '') prev = prev.previousSibling;
    return !!(prev && prev.nodeType === 1 && prev.tagName === 'BR' && root.contains(prev));
  }

  _logicalTextLenWithBr(textEl) {
    if (!textEl) return 0;
    const total = this._textLenWithBr(textEl);
    let last = textEl.lastChild;
    while (last && last.nodeType === 3 && last.textContent === '') last = last.previousSibling;
    return this._isTerminalSentinelBrNode(last, textEl) ? Math.max(0, total - 1) : total;
  }

  // セル末尾の末尾改行 (\n / <br>) を 1 段階ぶん削除する。
  // - 最後の text node の末尾が \n ならそれを削除
  // - 最後の子が <br> なら削除。直前も <br> (sentinel との組) なら両方削除して
  //   可視的な改行が 1 回で消えるようにする
  // 何か削除した場合は true を返す
  _removeTrailingLineBreak(textEl) {
    if (!textEl) return false;
    // 末尾の空 text node を掃除
    let last = textEl.lastChild;
    while (last && last.nodeType === 3 && last.textContent === '') {
      const prev = last.previousSibling;
      last.remove();
      last = prev;
    }
    if (!last) return false;
    // 末尾が \n で終わる text node
    if (last.nodeType === 3 && last.textContent.endsWith('\n')) {
      last.textContent = last.textContent.slice(0, -1);
      return true;
    }
    // 末尾が <br>
    if (last.nodeType === 1 && last.tagName === 'BR') {
      const prev = last.previousSibling;
      last.remove();
      // Shift+Enter は <br> (ユーザー改行) + <br> (sentinel) のペアを作るので、
      // 末尾 <br> の前も <br> ならペアとみなして両方削除する
      if (prev && prev.nodeType === 1 && prev.tagName === 'BR') {
        prev.remove();
      }
      return true;
    }
    return false;
  }

  _mergeWithNext(textEl) {
    const row = textEl.closest('.sn2-row');
    if (!row) return;
    let next = row.nextElementSibling;
    // 折り返しモード: 段の最後の行なら次の段の最初の行を探す
    if (!next || !next.classList.contains('sn2-row')) next = this._findAdjacentRow(row, false);
    if (!next) return;
    const nextText = next.querySelector('.sn2-text');
    if (!nextText) return;

    const rowId = row.dataset.rowId;
    const nextId = next.dataset.rowId;
    const idx = this.doc.rows.findIndex(r => r.id === rowId);
    const nextIdx = this.doc.rows.findIndex(r => r.id === nextId);
    if (idx < 0 || nextIdx < 0) return;

    // ルビ対応: DOM同期してからテキスト結合
    this._syncRowFromDom(textEl, { skipUndo: true });
    this._syncRowFromDom(nextText, { skipUndo: true });
    const cursorPos = this.doc.rows[idx].text.length;
    this.doc.rows[idx].text += this.doc.rows[nextIdx].text;
    this.doc.rows.splice(nextIdx, 1);
    this._calcCache = null;
    this._render();
    this._markDirty({ skipUndo: true });
    const focusMergedRow = () => {
      const newRowEl = this.host?.querySelector(`.sn2-row[data-row-id="${rowId}"]`);
      const newText = newRowEl?.querySelector('.sn2-text');
      if (newText) this._focusTextAt(newText, cursorPos);
    };
    focusMergedRow();
    requestAnimationFrame(focusMergedRow);
  }

  _focusTextAt(textEl, offset) {
    textEl.focus();
    this._setTextOffset(textEl, offset);
    document.dispatchEvent(new Event('selectionchange'));
    if (this._caretSelChangeHandler) this._caretSelChangeHandler();
  }

  _updateGuttersFrom(startIdx) {
    const calc = this._calcPagePanel();
    const cc = this.doc.editor?.countConfig || {};
    const rows = this.host.querySelectorAll('.sn2-row');
    const isVert = this.doc.editor?.viewMode === 'vertical';
    const mergeDisplay = !!this.doc.editor?.mergeDisplay;
    const clearCc = (el) => { delete el.dataset.ccBg; delete el.dataset.ccColor; delete el.dataset.ccWeight; delete el.dataset.ccSize; };
    const setCc = (el, gs) => { if (gs.bgColor) el.dataset.ccBg = gs.bgColor; if (gs.textColor) el.dataset.ccColor = gs.textColor; if (gs.fontWeight) el.dataset.ccWeight = gs.fontWeight; if (gs.fontSize) el.dataset.ccSize = gs.fontSize; };
    let prevVisibleCalc = null;
    for (const rowEl of rows) {
      const rowId = rowEl.dataset.rowId;
      const docIdx = this.doc.rows.findIndex(r => r.id === rowId);
      if (docIdx < 0) continue;
      const rowCalc = calc[docIdx];
      if (!rowCalc) continue;
      const prevCalc = prevVisibleCalc;
      if (docIdx >= startIdx) {
        // 大区切り（primary）
        const gutter = rowEl.querySelector('.sn2-gutter:not(.sn2-gutter2)');
        if (gutter) {
          const gutterText = this._formatGutterPrimary(rowCalc);
          const prevGutterText = (mergeDisplay && prevCalc) ? this._formatGutterPrimary(prevCalc) : '';
          const showGutterText = !(mergeDisplay && gutterText === prevGutterText);
          gutter.textContent = showGutterText ? gutterText : '';
          // 縦書き: 半角英数字を縦中横に再ラップ (textContent 設定で tcy span が消えるため)
          if (isVert) this._wrapTcy(gutter, 'sn2-tcy-wide');
          clearCc(gutter);
          if (showGutterText && cc.primaryStyle) setCc(gutter, cc.primaryStyle);
        }
        // 小区切り（secondary）
        const gutter2 = rowEl.querySelector('.sn2-gutter2');
        if (gutter2) {
          const gutter2Text = this._formatGutterSecondary(rowCalc);
          const prevGutter2Text = (mergeDisplay && prevCalc) ? this._formatGutterSecondary(prevCalc) : '';
          const showGutter2Text = !(mergeDisplay && gutter2Text === prevGutter2Text);
          gutter2.textContent = showGutter2Text ? gutter2Text : '';
          if (isVert) this._wrapTcy(gutter2, 'sn2-tcy-wide');
          clearCc(gutter2);
          if (showGutter2Text && cc.secondaryStyle) setCc(gutter2, cc.secondaryStyle);
        }
        // スタイル再適用
        const row = this.doc.rows[docIdx];
        if (row) this._applyRowStyle(rowEl, row.role);
      }
      prevVisibleCalc = rowCalc;
    }
  }

  // === タイプ選択メニュー → gb-scriptnote-menu.js に移動 ===

  // === DOM同期 ===

  _beginTextInputUndo(label = '編集') {
    if (!this._textInputUndoOpen) {
      this._pushUndo(label);
      this._textInputUndoOpen = true;
    }
    if (this._textInputUndoTimer) clearTimeout(this._textInputUndoTimer);
    this._textInputUndoTimer = setTimeout(() => {
      this._textInputUndoTimer = null;
      this._textInputUndoOpen = false;
    }, 1000);
  }

  _endTextInputUndo() {
    if (this._textInputUndoTimer) {
      clearTimeout(this._textInputUndoTimer);
      this._textInputUndoTimer = null;
    }
    this._textInputUndoOpen = false;
  }

  _syncRowFromDom(textEl, options = {}) {
    const rowId = textEl.dataset.rowId;
    const row = this.doc.rows.find(r => r.id === rowId);
    if (!row) return;
    // ルビスパンを {漢字|ルビ} 形式に変換（自動ルビはスキップ）。
    // プレーンテキスト部分は `\` `{` `|` `}` をエスケープして保存する（復元時に逆変換される）。
    let text = '';
    const walk = (node) => {
      if (node.nodeType === 3) { text += _sn2EscapeScriptNotePlainText(node.textContent); return; }
      if (node.nodeType === 1) {
        if (node.dataset?.manualLink && node.dataset?.path && typeof this._formatManualLinkMarkup === 'function') {
          text += this._formatManualLinkMarkup(node.textContent, node.dataset.path);
          return;
        }
        // 自動ルビ・自動リンクはテキストのみ出力（マークアップを保存しない）
        if (node.dataset?.autoRuby || node.dataset?.autoLink) { text += _sn2EscapeScriptNotePlainText(node.textContent); return; }
        if (node.dataset?.ruby) {
          text += `{${_sn2EscapeRubyText(node.textContent)}|${_sn2EscapeRubyText(node.dataset.ruby)}}`;
          return;
        }
        if (node.tagName === 'BR') {
          if (!this._isTerminalSentinelBrNode(node, textEl)) text += '\n';
          return;
        }
        node.childNodes.forEach(walk);
      }
    };
    textEl.childNodes.forEach(walk);
    text = text.replace(/\u00A0/g, ' ');
    if (row.text !== text) {
      const wasEmpty = !row.text;
      const nowEmpty = !text;
      row.text = text;
      if (wasEmpty !== nowEmpty) this._calcCache = null;
      this._markDirty(options.skipUndo ? { skipUndo: true } : {});
    }
  }

  _syncAllFromDom() {
    if (!this.host) return;
    // sync-from-dom の最中に _markDirty → _pushUndo → _syncAllFromDom の再発火ループが
    // 起きないようガードフラグで抑制する
    this._inSyncingFromDom = true;
    try {
      this.host.querySelectorAll('.sn2-text').forEach(el => this._syncRowFromDom(el));
    } finally {
      this._inSyncingFromDom = false;
    }
  }

  // ルビの字間調整: 対象文字列の幅/高さに収まるルビは字間を広げ、収まらないルビは中央揃えではみ出す
  _adjustRubySpacing() {
    if (!this.host) return;
    const rubyEm = this.doc?.editor?.rubyFontSize || 0.55;
    const isVertical = this.doc?.editor?.viewMode === 'vertical';
    const spans = this.host.querySelectorAll('.sn2-text [data-ruby]');
    if (!spans.length) return;
    // 一括測定用の隠しコンテナ
    const measurer = document.createElement('div');
    measurer.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;white-space:nowrap;line-height:1;';
    if (isVertical) { measurer.style.writingMode = 'vertical-rl'; measurer.style.textOrientation = 'upright'; }
    this.host.appendChild(measurer);
    // CSS zoom による二重スケーリング防止: getBoundingClientRect() は zoom 後の値を返すが、
    // letter-spacing の CSS px 値は zoom で再スケーリングされるため、zoom で割って CSS 座標系に変換する
    const z = typeof _getZoom === 'function' ? _getZoom() : 1;
    spans.forEach(span => {
      // センタリングは CSS auto margin で処理するため、ここでは letter-spacing のみ設定
      const baseSizeRaw = isVertical ? span.getBoundingClientRect().height : span.getBoundingClientRect().width;
      const baseSize = baseSizeRaw / z;
      const rubyText = span.dataset.ruby;
      if (!rubyText || baseSize <= 0) {
        span.style.removeProperty('--sn2-ruby-ls');
        span.style.marginLeft = '';
        span.style.marginTop = '';
        return;
      }
      const numChars = [...rubyText].length;
      const spanFontSize = parseFloat(getComputedStyle(span).fontSize);
      const temp = document.createElement('span');
      temp.style.cssText = `font-size:${spanFontSize * rubyEm}px;line-height:1;`;
      temp.textContent = rubyText;
      measurer.appendChild(temp);
      const rubyNatSizeRaw = isVertical ? temp.getBoundingClientRect().height : temp.getBoundingClientRect().width;
      const rubyNatSize = rubyNatSizeRaw / z;
      temp.remove();
      const effectiveSize = baseSize * 0.9;
      if (numChars > 1 && rubyNatSize < effectiveSize) {
        // ルビが対象文字列幅に収まる: 字間を広げて対象文字列の90%幅に合わせる
        const ls = (effectiveSize - rubyNatSize) / numChars;
        span.style.setProperty('--sn2-ruby-ls', ls + 'px');
      } else {
        // 収まらない or 1文字: 字間なし（中央揃えではみ出す）
        span.style.removeProperty('--sn2-ruby-ls');
      }
      // ルビ(::after)は auto margin で中央揃えされ、対象文字列より広い場合は左右
      // （縦書きは上下）に均等にはみ出す。base span は position:relative の基準枠だが
      // 通常フローに参加する実体でもあるため、はみ出し量の半分を margin として
      // base span 側に確保し、前方テキストとの重なりを防ぐ
      if (rubyNatSize > baseSize) {
        const overflow = (rubyNatSize - baseSize) / 2;
        span.style[isVertical ? 'marginTop' : 'marginLeft'] = overflow + 'px';
      } else {
        span.style.marginLeft = '';
        span.style.marginTop = '';
      }
    });
    measurer.remove();
  }

  // 自動ルビルールをテキスト要素に適用（表示のみ、data-auto-ruby属性で識別）
  _applyAutoRuby(textEl) {
    const rules = this.doc?.rubyRules;
    // 既存の自動ルビを除去（再適用時の二重表示を防止）
    textEl.querySelectorAll('[data-auto-ruby]').forEach(span => {
      span.replaceWith(document.createTextNode(span.textContent));
    });
    textEl.normalize();
    if (!rules || !rules.length) return;
    // 既にルビが付いているテキストを避けるため、テキストノードのみを対象にする
    const textNodes = [];
    const collectTextNodes = (node) => {
      if (node.nodeType === 3 && node.textContent) textNodes.push(node);
      else if (node.nodeType === 1 && !node.dataset?.ruby && !node.dataset?.autoRuby) {
        node.childNodes.forEach(collectTextNodes);
      }
    };
    collectTextNodes(textEl);
    for (const tNode of textNodes) {
      let content = tNode.textContent;
      let matched = false;
      const frag = document.createDocumentFragment();
      let lastIdx = 0;
      // 全ルールをテキスト内で検索（先に見つかった位置優先）
      while (lastIdx < content.length) {
        let earliest = null;
        for (const rule of rules) {
          if (!rule.text || !rule.ruby) continue;
          const pos = content.indexOf(rule.text, lastIdx);
          if (pos >= 0 && (!earliest || pos < earliest.pos || (pos === earliest.pos && rule.text.length > earliest.rule.text.length))) {
            earliest = { pos, rule };
          }
        }
        if (!earliest) break;
        matched = true;
        if (earliest.pos > lastIdx) frag.appendChild(document.createTextNode(content.slice(lastIdx, earliest.pos)));
        const span = document.createElement('span');
        span.dataset.ruby = earliest.rule.ruby;
        span.dataset.autoRuby = 'true';
        span.textContent = earliest.rule.text;
        frag.appendChild(span);
        lastIdx = earliest.pos + earliest.rule.text.length;
      }
      if (matched) {
        if (lastIdx < content.length) frag.appendChild(document.createTextNode(content.slice(lastIdx)));
        tNode.parentNode.replaceChild(frag, tNode);
      }
    }
  }

  // D&D: テキストセルへのファイル/ノードドロップハンドラ
  _setupTextCellDrop(textDiv) {
    textDiv.addEventListener('dragover', (e) => {
      if (MeldexDnD.isPanelDnD(e.dataTransfer.types, e.ctrlKey)) return;
      if (!e.dataTransfer.types.includes('application/x-meldex-node') &&
          !e.dataTransfer.types.includes('application/x-annotation') &&
          !e.dataTransfer.types.includes('application/x-cal-event')) return;
      e.preventDefault();
      e.stopPropagation();
      MeldexDnD.showDropCaret(textDiv, e);
    });
    textDiv.addEventListener('dragleave', (e) => {
      if (!textDiv.contains(e.relatedTarget)) MeldexDnD.hideDropCaret(textDiv);
    });
    textDiv.addEventListener('drop', (e) => {
      if (MeldexDnD.isPanelDnD(e.dataTransfer.types, e.ctrlKey)) return;
      e.preventDefault();
      e.stopPropagation();
      MeldexDnD.hideDropCaret(textDiv);
      MeldexDnD.setCaretFromPoint(e);

      const nodeData = MeldexDnD.parseMeldexNode(e);
      if (nodeData) {
        if (typeof this._insertLinkResultIntoText === 'function') {
          this._insertLinkResultIntoText(textDiv, null, { type: 'file', name: nodeData.name, path: nodeData.path });
          return;
        }
        // ファイル名テキストを挿入し、linkDict に登録して自動リンク化
        const { name, path } = nodeData;
        this._pushUndo('リンク挿入');
        document.execCommand('insertText', false, name);
        if (typeof linkDict !== 'undefined' && Array.isArray(linkDict)) {
          if (!linkDict.some(d => d.text === name && d.path === path)) {
            linkDict.push({ text: name, path });
          }
        }
        this._syncRowFromDom(textDiv, { skipUndo: true });
        this._applyAutoLinks(textDiv);
        return;
      }

      const annData = e.dataTransfer.getData('application/x-annotation');
      if (annData) {
        try {
          const ann = JSON.parse(annData);
          this._pushUndo('注釈テキスト挿入');
          document.execCommand('insertText', false, ann.text || '[メモ]');
          this._syncRowFromDom(textDiv, { skipUndo: true });
        } catch {}
        return;
      }

      const calData = e.dataTransfer.getData('application/x-cal-event');
      if (calData) {
        const text = e.dataTransfer.getData('text/plain') || '[イベント]';
        this._pushUndo('イベントテキスト挿入');
        document.execCommand('insertText', false, text);
        this._syncRowFromDom(textDiv, { skipUndo: true });
        return;
      }
    });
  }

  // 自動リンク（linkDict）をテキスト要素に適用（表示のみ、data-auto-link属性で識別）
  _applyAutoLinks(textEl) {
    if (typeof MeldexAutoLink !== 'undefined') {
      MeldexAutoLink.applyToDom(textEl, this._path || this.doc?.source?.path || '');
    }
  }

  _markDirty(options = {}) {
    this._dirty = true;
    this._scheduleSave();
    // sync-from-dom の最中（= 既に _pushUndo 処理中のフラッシュ経路）では
    // デバウンス undo を仕込み直さない。再発火ループ防止。
    if (this._inSyncingFromDom) return;
    // テキスト入力のundoは500msデバウンス（skipUndo指定時はスキップ）
    if (!options.skipUndo) {
      if (this._undoTimer) clearTimeout(this._undoTimer);
      this._undoTimer = setTimeout(() => { this._undoTimer = null; this._pushUndo('編集'); }, 500);
    }
  }

  _scheduleSave() {
    if (typeof markAutoVersionDirty === 'function') markAutoVersionDirty();
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => { this._saveTimer = null; this.save(); }, 2000);
  }

  // === Undo/Redo → gb-scriptnote-history.js に移動 ===

  // === 行の複数選択 → gb-scriptnote-selection.js に移動 ===

  // === 詳細パネル → gb-scriptnote-detail.js に移動 ===
  // === 列リサイズ・カスタム列 → gb-scriptnote-columns.js に移動 ===

  // === フィルタ → gb-scriptnote-filter.js に移動 ===

  // === ルビ ===

  _insertRuby() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const text = sel.toString().trim();
    if (!text) return;
    const range = sel.getRangeAt(0);
    const textEl = range.startContainer.closest?.('.sn2-text') || range.startContainer.parentElement?.closest?.('.sn2-text');
    if (!textEl || !this._rangeWithinElement(range, textEl)) return;
    if (typeof this._closeRubyPopup === 'function') this._closeRubyPopup({ restoreFocus: false });
    // ルビ入力ポップアップ
    const popup = document.createElement('div');
    popup.className = 'sn2-header-popup sn2-ruby-popup';
    popup.dataset.e2eId = 'sn2-ruby-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'false');
    popup.setAttribute('aria-labelledby', 'sn2-ruby-label');

    const title = document.createElement('div');
    title.id = 'sn2-ruby-label';
    title.className = 'sn2-ruby-popup-title';
    title.dataset.e2eId = 'sn2-ruby-label';
    title.textContent = `「${text.slice(0, 20)}」にルビを設定`;

    const mainRow = document.createElement('div');
    mainRow.className = 'sn2-ruby-popup-main';
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'sn2-ruby-input';
    input.className = 'gb-input-sm sn2-ruby-popup-input';
    input.dataset.e2eId = 'sn2-ruby-input';
    input.placeholder = 'ルビを入力...';
    input.setAttribute('aria-label', '選択文字のルビ');
    const okButton = document.createElement('button');
    okButton.type = 'button';
    okButton.id = 'sn2-ruby-ok';
    okButton.className = 'gb-btn gb-btn-sm gb-btn-primary primary sn2-ruby-popup-ok';
    okButton.dataset.e2eId = 'sn2-ruby-ok';
    okButton.textContent = '設定';
    mainRow.append(input, okButton);

    const optionRow = document.createElement('div');
    optionRow.className = 'sn2-ruby-popup-options';
    const addRuleLabel = document.createElement('label');
    addRuleLabel.className = 'gb-check sn2-ruby-popup-check';
    addRuleLabel.dataset.e2eId = 'sn2-ruby-add-rule-label';
    const addRuleInput = document.createElement('input');
    addRuleInput.type = 'checkbox';
    addRuleInput.id = 'sn2-ruby-add-rule';
    addRuleInput.className = 'gb-checkbox';
    addRuleInput.dataset.e2eId = 'sn2-ruby-add-rule';
    const addRuleText = document.createElement('span');
    addRuleText.textContent = '自動ルビルールにも追加';
    addRuleLabel.append(addRuleInput, addRuleText);
    const autoButton = document.createElement('button');
    autoButton.type = 'button';
    autoButton.id = 'sn2-ruby-auto';
    autoButton.className = 'gb-btn gb-btn-sm gb-btn-quiet sn2-ruby-popup-auto';
    autoButton.dataset.e2eId = 'sn2-ruby-auto';
    autoButton.textContent = '読み取得';
    optionRow.append(addRuleLabel, autoButton);
    popup.append(title, mainRow, optionRow);
    const rr = range.getBoundingClientRect();
    popup.style.cssText += 'position:fixed;z-index:10000;min-width:240px;';
    positionPopup(popup, rr);
    input.focus();
    let closeHandler = null;
    let keyHandler = null;
    const restoreFocus = () => {
      if (!textEl?.isConnected) return;
      try { textEl.focus({ preventScroll: true }); }
      catch { textEl.focus(); }
    };
    const closeRubyPopup = (options = {}) => {
      popup.remove();
      if (closeHandler) document.removeEventListener('pointerdown', closeHandler);
      if (keyHandler) document.removeEventListener('keydown', keyHandler);
      if (this._rubyPopup === popup) {
        this._rubyPopup = null;
        this._closeRubyPopup = null;
      }
      if (options.restoreFocus !== false) {
        restoreFocus();
        requestAnimationFrame(restoreFocus);
      }
    };
    this._rubyPopup = popup;
    this._closeRubyPopup = closeRubyPopup;
    const apply = (ruby) => {
      if (!ruby) { closeRubyPopup(); return; }
      const addRule = addRuleInput.checked;
      // テキスト内にルビマークアップを挿入: {漢字|ルビ}
      if (textEl) {
        this._pushUndo('ルビ設定');
        // 選択範囲を削除してルビスパンを挿入（インラインstyleはCSSに任せる）
        range.deleteContents();
        const rubyNode = document.createElement('span');
        rubyNode.dataset.ruby = ruby;
        rubyNode.textContent = text;
        range.insertNode(rubyNode);
        // insertNodeが作る空テキストノードを除去して改行を防止
        textEl.normalize();
        sel.removeAllRanges();
        const newRange = document.createRange();
        newRange.setStartAfter(rubyNode);
        newRange.collapse(true);
        sel.addRange(newRange);
        // DOMからrow.textに同期（ルビマークアップ {漢字|ルビ} をrow.textに保存）
        this._syncRowFromDom(textEl, { skipUndo: true });
        // 自動ルビルールにも追加
        if (addRule) {
          if (!this.doc.rubyRules) this.doc.rubyRules = [];
          const exists = this.doc.rubyRules.some(r => r.text === text && r.ruby === ruby);
          if (!exists) this.doc.rubyRules.push({ text, ruby, auto: true });
        }
        this._markDirty({ skipUndo: true });
      }
      closeRubyPopup();
    };
    okButton.addEventListener('click', () => apply(input.value.trim()));
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        apply(input.value.trim());
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        closeRubyPopup();
      }
    });
    autoButton.addEventListener('click', async () => {
      try {
        const res = await apiFetch('/ruby?text=' + encodeURIComponent(text));
        if (res?.ruby) input.value = res.ruby;
        else if (typeof showStatus === 'function') showStatus('自動ルビの取得に失敗しました', true);
      } catch (err) {
        if (typeof showStatus === 'function') showStatus('自動ルビエラー: ' + err.message, true);
      }
    });
    closeHandler = (ev) => { if (!popup.contains(ev.target)) closeRubyPopup(); };
    keyHandler = (ev) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      closeRubyPopup();
    };
    document.addEventListener('keydown', keyHandler);
    setTimeout(() => document.addEventListener('pointerdown', closeHandler), 0);
  }

  // === 破棄 ===

  destroy() {
    this._closeRoleMenu();
    if (typeof this._closeRubyPopup === 'function') this._closeRubyPopup({ restoreFocus: false });
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    if (this._undoTimer) { clearTimeout(this._undoTimer); this._undoTimer = null; }
    if (this._textInputUndoTimer) { clearTimeout(this._textInputUndoTimer); this._textInputUndoTimer = null; }
    if (typeof this._teardownWrapResizeObserver === 'function') this._teardownWrapResizeObserver();
    if (typeof this._stopRowBulkBarGuard === 'function') this._stopRowBulkBarGuard();
    // エディタレジストリから除去
    if (typeof _sn2Editors !== 'undefined') {
      const registeredPath = this._sn2RegisteredPath || this._path;
      const registeredScopeId = this._sn2RegisteredScopeId || this._historyScopeId;
      if (registeredPath && _sn2Editors[registeredPath] === this) delete _sn2Editors[registeredPath];
      if (registeredScopeId && _sn2Editors[registeredScopeId] === this) delete _sn2Editors[registeredScopeId];
    }
    if (this._caretSelChangeHandler) { document.removeEventListener('selectionchange', this._caretSelChangeHandler); this._caretSelChangeHandler = null; }
    if (this._copyHandler) { document.removeEventListener('copy', this._copyHandler); this._copyHandler = null; }
    if (typeof this._dragSelectionDocCleanup === 'function') {
      this._dragSelectionDocCleanup();
      this._dragSelectionDocCleanup = null;
    }
    // document.body上のフロートバー・一時UIを除去
    document.querySelectorAll('.sn2-row-bulk-bar, .gb-fmt-popup--bulk-edit, .sn2-drag-select-rect').forEach(el => el.remove());
    // テキストセル範囲選択の表示クラスを除去（セル要素自体は残す。他インスタンスに影響しないようhost配下に限定）
    this.host?.querySelectorAll('.sn2-text-cell-selected').forEach(el => el.classList.remove('sn2-text-cell-selected'));
    if (this.host) this.host.innerHTML = '';
    this._bound = false;
  }
}

// Clip Studio / SEP 連携は gb-scriptnote-clipstudio.js に分離
