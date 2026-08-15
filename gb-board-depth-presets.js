/* gb-board-depth-presets.js: 階層別スタイルのプリセット
   （階層ごとのカードとラインの組み合わせ一式）を保存・適用・名前変更・削除する。 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'meldex-bd-depth-style-presets-v1';
  const MAX_PRESETS = 60;

  let popupEl = null;
  let popupAnchor = null;
  let popupOutsideHandler = null;

  // ============================================================
  //  小さなユーティリティ
  // ============================================================

  // ボード側の識別子は `const bd = {...}` のようにグローバル字句スコープにあり、
  // window のプロパティにはならない。gb-board-immersive.js と同じく素の識別子で参照する。
  function boardState() {
    try {
      if (typeof bd !== 'undefined' && bd && Array.isArray(bd.nodes)) return bd;
    } catch { /* この画面には bd の字句束縛が無い。 */ }
    return global.bd && Array.isArray(global.bd.nodes) ? global.bd : null;
  }

  function status(message, isError) {
    if (typeof showStatus === 'function') showStatus(message, !!isError);
  }

  function escText(value) {
    if (typeof esc === 'function') return esc(value == null ? '' : String(value));
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 保存済みプリセットの色はユーザー入力由来なので、CSS へ埋める前に形式を限定する。
  function safeColor(value, fallback) {
    const raw = String(value == null ? '' : value).trim();
    if (/^#[0-9a-f]{3,8}$/i.test(raw)) return raw;
    return fallback;
  }

  function clone(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
  }

  function normalizeStyles(styles) {
    if (typeof bdNormalizeDepthStyles === 'function') {
      return bdNormalizeDepthStyles(Array.isArray(styles) ? styles : []);
    }
    return Array.isArray(styles) ? clone(styles) || [] : [];
  }

  function currentStyles() {
    const state = boardState();
    if (!state) return [];
    if (typeof bdEnsureDepthStyles === 'function') bdEnsureDepthStyles();
    return normalizeStyles(state.depthStyles || []);
  }

  function makeId() {
    const stamp = Date.now().toString(36);
    const salt = Math.floor(Math.random() * 0x10000).toString(36);
    return `depth-preset-${stamp}-${salt}`;
  }

  // ============================================================
  //  ビルトインプリセット
  // ============================================================
  // ビルトインは削除・上書きできない土台。ユーザーはここから始めて自分の組み合わせを保存する。
  // cardStyleRef / lineStyleRef は「どのスタイルから値を取り込んだか」の目印でしかないため、
  // 値を作り変える派生プリセットでは空にして、実際の値と食い違わないようにする。

  function derive(styles, fn) {
    return styles.map((style, index) => {
      const next = fn({ ...style, line: { ...(style.line || {}) } }, index);
      next.cardStyleRef = '';
      next.lineStyleRef = '';
      return next;
    });
  }

  const BUILTIN_DEFS = [
    {
      id: 'depth-preset-standard',
      name: '標準',
      build: base => base,
    },
    {
      id: 'depth-preset-simple',
      name: 'シンプル（角丸・直角線）',
      build: base => derive(base, (style, index) => {
        style.name = `階層${index + 1}`;
        style.shape = 'rect';
        style.borderRadius = 8;
        style.borderWidth = 2;
        style.fontSize = Math.max(11, 17 - index);
        style.fontBold = index === 0;
        style.line.pathType = 'orthogonal';
        style.line.style = '';
        style.line.arrow = 'end';
        style.line.width = 2;
        return style;
      }),
    },
    {
      id: 'depth-preset-mindmap',
      name: 'マインドマップ（曲線）',
      build: base => derive(base, (style, index) => {
        style.name = index === 0 ? '中心テーマ' : `枝${index}`;
        style.shape = index === 0 ? 'rect' : 'pill';
        style.borderRadius = index === 0 ? 10 : 999;
        style.borderWidth = index === 0 ? 3 : 2;
        style.fontSize = Math.max(11, 18 - index * 2);
        style.fontBold = index <= 1;
        style.line.pathType = 'curve';
        style.line.style = '';
        style.line.arrow = '';
        style.line.width = Math.max(1, 4 - index);
        return style;
      }),
    },
  ];

  function builtinPresets() {
    const base = normalizeStyles([]);
    if (!base.length) return [];
    return BUILTIN_DEFS.map(def => ({
      id: def.id,
      name: def.name,
      builtin: true,
      styles: normalizeStyles(def.build(base.map(style => ({ ...style, line: { ...(style.line || {}) } })))),
    }));
  }

  // ============================================================
  //  保存領域
  // ============================================================

  function readUserPresets() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
    catch { return []; }
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(entry => entry && typeof entry === 'object' && Array.isArray(entry.styles) && entry.styles.length)
      .map(entry => ({
        id: String(entry.id || '') || makeId(),
        name: String(entry.name || '').trim() || '名前のないプリセット',
        builtin: false,
        updatedAt: String(entry.updatedAt || ''),
        styles: entry.styles,
      }))
      .slice(0, MAX_PRESETS);
  }

  function writeUserPresets(presets) {
    try {
      const payload = (presets || []).slice(0, MAX_PRESETS).map(entry => ({
        id: entry.id,
        name: entry.name,
        updatedAt: entry.updatedAt || '',
        styles: entry.styles,
      }));
      if (payload.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      else localStorage.removeItem(STORAGE_KEY);
      return true;
    } catch {
      return false;
    }
  }

  function listPresets() {
    return [...builtinPresets(), ...readUserPresets()];
  }

  function findPreset(id) {
    return listPresets().find(entry => entry.id === id) || null;
  }

  function uniqueName(baseName, excludeId) {
    const trimmed = String(baseName || '').trim() || '階層別スタイル';
    const taken = new Set(listPresets().filter(entry => entry.id !== excludeId).map(entry => entry.name));
    if (!taken.has(trimmed)) return trimmed;
    for (let i = 2; i < 1000; i++) {
      const candidate = `${trimmed} ${i}`;
      if (!taken.has(candidate)) return candidate;
    }
    return trimmed;
  }

  // 現在のボードの階層別スタイルと一致するプリセットを探す。
  // 「今どれを使っているか」をボードファイルへ書き足さずに示せるようにするための比較。
  function fingerprint(styles) {
    return JSON.stringify(normalizeStyles(styles));
  }

  function matchedPresetId() {
    const current = fingerprint(currentStyles());
    if (!current || current === '[]') return '';
    const hit = listPresets().find(entry => fingerprint(entry.styles) === current);
    return hit ? hit.id : '';
  }

  // ============================================================
  //  操作
  // ============================================================

  function applyBoardChange() {
    const state = boardState();
    if (state && typeof bdNormalizeDepthStyles === 'function') {
      state.depthStyles = bdNormalizeDepthStyles(state.depthStyles);
    }
    if (typeof _bdApplyAllAutoStyles === 'function') _bdApplyAllAutoStyles();
    if (typeof bdDirty === 'function') bdDirty();
    if (typeof _bdRenderKeepingDetailTab === 'function') _bdRenderKeepingDetailTab();
    if (typeof bdRefreshBoardToolbar === 'function') bdRefreshBoardToolbar();
    if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
  }

  function applyPreset(id) {
    const preset = findPreset(id);
    const state = boardState();
    if (!preset || !state) return false;
    if (typeof bdPushUndo === 'function') bdPushUndo();
    state.depthStyles = normalizeStyles(preset.styles);
    applyBoardChange();
    status(`階層別スタイル「${preset.name}」を適用しました`);
    return true;
  }

  function saveCurrentAsNew(name) {
    const styles = currentStyles();
    if (!styles.length) return null;
    const presets = readUserPresets();
    if (presets.length >= MAX_PRESETS) {
      status(`プリセットは${MAX_PRESETS}件までです。不要なものを削除してください`, true);
      return null;
    }
    const entry = {
      id: makeId(),
      name: uniqueName(name),
      builtin: false,
      updatedAt: new Date().toISOString(),
      styles,
    };
    presets.push(entry);
    if (!writeUserPresets(presets)) {
      if (typeof global.showStatus === 'function') global.showStatus('プリセットを保存できませんでした', true);
      return null;
    }
    return entry;
  }

  function duplicatePreset(id) {
    const source = findPreset(id);
    if (!source) return null;
    const presets = readUserPresets();
    if (presets.length >= MAX_PRESETS) {
      status(`プリセットは${MAX_PRESETS}件までです。不要なものを削除してください`, true);
      return null;
    }
    const entry = {
      id: makeId(),
      name: uniqueName(`${source.name} のコピー`),
      builtin: false,
      updatedAt: new Date().toISOString(),
      styles: normalizeStyles(source.styles),
    };
    presets.push(entry);
    if (writeUserPresets(presets)) return entry;
    status('プリセットを複製できませんでした', true);
    return null;
  }

  function overwritePreset(id) {
    const presets = readUserPresets();
    const target = presets.find(entry => entry.id === id);
    if (!target) return false;
    const styles = currentStyles();
    if (!styles.length) return false;
    target.styles = styles;
    target.updatedAt = new Date().toISOString();
    return writeUserPresets(presets);
  }

  function renamePreset(id, name) {
    const presets = readUserPresets();
    const target = presets.find(entry => entry.id === id);
    if (!target) return false;
    const nextName = String(name || '').trim();
    if (!nextName) return false;
    target.name = uniqueName(nextName, id);
    target.updatedAt = new Date().toISOString();
    return writeUserPresets(presets);
  }

  function removePreset(id) {
    const presets = readUserPresets();
    const next = presets.filter(entry => entry.id !== id);
    if (next.length === presets.length) return false;
    return writeUserPresets(next);
  }

  // ============================================================
  //  表示
  // ============================================================

  function previewHtml(styles) {
    const chips = (Array.isArray(styles) ? styles : []).slice(0, 7).map((style, index) => {
      const bg = safeColor(style?.bgColor, 'var(--bg2)');
      const border = safeColor(style?.borderColor, 'var(--border)');
      const round = style?.shape === 'pill' || style?.shape === 'ellipse'
        ? '999px'
        : `${Math.min(6, Math.max(0, Math.round(+style?.borderRadius || 0)))}px`;
      const width = Math.max(9, 24 - index * 2);
      return `<span class="bd-depth-preset-chip" style="background:${bg};border-color:${border};border-radius:${round};width:${width}px"></span>`;
    }).join('');
    return `<span class="bd-depth-preset-chips" aria-hidden="true">${chips}</span>`;
  }

  function presetSummary(preset) {
    const count = Array.isArray(preset?.styles) ? preset.styles.length : 0;
    return `${preset?.name || ''}（${count}階層）`;
  }

  function triggerLabel() {
    const activeId = matchedPresetId();
    if (!activeId) return 'プリセット未適用（編集中）';
    const preset = findPreset(activeId);
    return preset ? presetSummary(preset) : 'プリセット未適用（編集中）';
  }

  // ============================================================
  //  ポップアップ
  // ============================================================

  function closePopup(options) {
    const anchor = popupAnchor;
    if (anchor?.setAttribute) anchor.setAttribute('aria-expanded', 'false');
    // 取り残された同種のポップアップも必ず片付ける。
    document.querySelectorAll('.bd-depth-preset-popup').forEach(el => el.remove());
    popupEl = null;
    popupAnchor = null;
    if (popupOutsideHandler) {
      document.removeEventListener('pointerdown', popupOutsideHandler);
      popupOutsideHandler = null;
    }
    if (options?.restoreFocus && anchor?.isConnected && typeof anchor.focus === 'function') {
      if (typeof global.focusMeldexDropdownTrigger === 'function') global.focusMeldexDropdownTrigger(anchor);
      else try { anchor.focus({ preventScroll: true }); } catch { anchor.focus(); }
    }
  }

  function positionPopupAt(anchor) {
    if (!popupEl || !anchor?.getBoundingClientRect) return;
    const rect = anchor.getBoundingClientRect();
    if (typeof global.positionPopup === 'function') {
      global.positionPopup(popupEl, rect, { prefer: 'below', gap: 4 });
      return;
    }
    const zoom = typeof global._getZoom === 'function' ? global._getZoom() : 1;
    popupEl.style.left = (rect.left / zoom) + 'px';
    popupEl.style.top = (rect.bottom / zoom + 4) + 'px';
    if (typeof global.clampPopupToViewport === 'function') global.clampPopupToViewport(popupEl);
  }

  function closeButtonHtml() {
    if (typeof global.meldexDropdownCloseButtonHtml === 'function') {
      return global.meldexDropdownCloseButtonHtml({
        className: 'bd-detail-style-action bd-style-manager-popup-close',
        attr: 'data-bd-depth-preset-close',
      });
    }
    const icon = typeof global.lucide === 'function' ? global.lucide('x', 14) : '×';
    return `<button type="button" class="bd-detail-style-action bd-style-manager-popup-close" data-bd-depth-preset-close title="閉じる" aria-label="閉じる">${icon}</button>`;
  }

  async function askName(message, defaultValue) {
    if (typeof global.cfPrompt === 'function') return await global.cfPrompt(message, defaultValue);
    if (typeof global.prompt === 'function') return global.prompt(message, defaultValue);
    return defaultValue;
  }

  async function askConfirm(message) {
    if (typeof global.cfConfirm === 'function') return await global.cfConfirm(message);
    if (typeof global.confirm === 'function') return global.confirm(message);
    return true;
  }

  function openPopup(anchorEl, options) {
    if (!anchorEl) return;
    global.MeldexBoardStyleManagerPopup?.close?.();
    if (popupEl) {
      const same = popupAnchor === anchorEl;
      closePopup();
      if (same) return;
    }
    const opts = options || {};
    let anchor = anchorEl;
    popupEl = document.createElement('div');
    popupEl.className = 'bd-style-manager-popup bd-depth-preset-popup';
    popupEl.setAttribute('role', 'dialog');
    popupEl.setAttribute('aria-label', '階層別スタイルのプリセット');
    popupEl.setAttribute('aria-modal', 'false');
    popupEl.tabIndex = -1;
    document.body.appendChild(popupEl);
    popupAnchor = anchor;
    anchor.setAttribute('aria-haspopup', 'dialog');
    anchor.setAttribute('aria-expanded', 'true');

    const notify = () => { if (typeof opts.onChange === 'function') opts.onChange(); };

    const self = popupEl;
    const render = () => {
      // 確認ダイアログ待ちなどで既に閉じられたあとの遅延再描画では何もしない。
      // 描画すると positionPopup() が閉じたはずのポップアップを DOM へ戻してしまう。
      if (!popupEl || popupEl !== self) return;
      const presets = listPresets();
      const activeId = matchedPresetId();
      const selectedId = presets.some(entry => entry.id === opts.selectedId)
        ? opts.selectedId
        : (activeId || presets[0]?.id || '');
      opts.selectedId = selectedId;
      const selected = presets.find(entry => entry.id === selectedId) || null;
      const icon = (name, fallback) => (typeof global.lucide === 'function' ? global.lucide(name, 14) : fallback);

      popupEl.innerHTML = `
        <div class="bd-style-manager-popup-list" role="listbox" aria-label="階層別スタイルのプリセット一覧">
          ${presets.map(entry => {
            const label = presetSummary(entry) + (entry.builtin ? '（標準搭載）' : '');
            return `<div class="bd-style-list-item bd-depth-preset-item ${entry.id === selectedId ? 'active' : ''} ${entry.id === activeId ? 'is-applied' : ''}"
              data-bd-depth-preset-id="${escText(entry.id)}" tabindex="0" role="option"
              aria-selected="${entry.id === selectedId ? 'true' : 'false'}"
              title="${escText(label)}" aria-label="${escText(label)}">
              <span class="bd-style-list-preview bd-depth-preset-preview">${previewHtml(entry.styles)}</span>
              <span class="bd-style-list-name">${escText(entry.name)}</span>
              ${entry.id === activeId ? '<span class="bd-style-applied-mark">適用中</span>' : ''}
            </div>`;
          }).join('')}
          ${presets.length ? '' : '<div class="bd-depth-preset-empty">保存されたプリセットはありません</div>'}
        </div>
        <div class="bd-style-manager-popup-actions">
          <button type="button" class="bd-detail-style-action" data-bd-depth-preset-add title="今の階層別スタイルを新しいプリセットとして保存" aria-label="今の階層別スタイルを新しいプリセットとして保存">${icon('plus', '+')}</button>
          <button type="button" class="bd-detail-style-action" data-bd-depth-preset-duplicate title="選択中のプリセットを複製" aria-label="選択中のプリセットを複製" ${selected ? '' : 'disabled'}>${icon('copy', '複製')}</button>
          <button type="button" class="bd-detail-style-action" data-bd-depth-preset-overwrite title="選択中のプリセットを今の内容で上書き" aria-label="選択中のプリセットを今の内容で上書き" ${selected && !selected.builtin ? '' : 'disabled'}>${icon('save', '保存')}</button>
          <button type="button" class="bd-detail-style-action" data-bd-depth-preset-rename title="選択中のプリセットの名前を変更" aria-label="選択中のプリセットの名前を変更" ${selected && !selected.builtin ? '' : 'disabled'}>${icon('pencil', '名前')}</button>
          <button type="button" class="bd-detail-style-action bd-detail-style-action--danger" data-bd-depth-preset-delete title="選択中のプリセットを削除" aria-label="選択中のプリセットを削除" ${selected && !selected.builtin ? '' : 'disabled'}>${icon('trash2', '削除')}</button>
          ${closeButtonHtml()}
        </div>`;

      if (typeof opts.refreshAnchor === 'function') {
        const next = opts.refreshAnchor();
        if (next) {
          anchor = next;
          popupAnchor = next;
          anchor.setAttribute('aria-haspopup', 'dialog');
          anchor.setAttribute('aria-expanded', 'true');
        }
      }
      positionPopupAt(anchor);

      popupEl.querySelectorAll('[data-bd-depth-preset-id]').forEach(item => {
        const activate = () => {
          const id = item.dataset.bdDepthPresetId || '';
          opts.selectedId = id;
          if (applyPreset(id)) notify();
          render();
        };
        item.addEventListener('click', activate);
        item.addEventListener('keydown', event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          activate();
        });
      });

      popupEl.querySelector('[data-bd-depth-preset-add]')?.addEventListener('click', async () => {
        const suggested = uniqueName('階層別スタイル');
        const name = await askName('プリセット名を入力してください', suggested);
        if (name === null || name === undefined) return;
        const entry = saveCurrentAsNew(name);
        if (!entry) return;
        opts.selectedId = entry.id;
        if (typeof global.showStatus === 'function') global.showStatus(`プリセット「${entry.name}」を保存しました`);
        notify();
        render();
      });

      popupEl.querySelector('[data-bd-depth-preset-overwrite]')?.addEventListener('click', async () => {
        if (!selected || selected.builtin) return;
        const ok = await askConfirm(`プリセット「${selected.name}」を今の階層別スタイルで上書きしますか？`);
        if (!ok) return;
        if (!overwritePreset(selected.id)) {
          if (typeof global.showStatus === 'function') global.showStatus('プリセットを上書きできませんでした', true);
          return;
        }
        if (typeof global.showStatus === 'function') global.showStatus(`プリセット「${selected.name}」を上書きしました`);
        notify();
        render();
      });

      popupEl.querySelector('[data-bd-depth-preset-duplicate]')?.addEventListener('click', () => {
        if (!selected) return;
        const entry = duplicatePreset(selected.id);
        if (!entry) return;
        opts.selectedId = entry.id;
        if (typeof global.showStatus === 'function') global.showStatus(`プリセット「${entry.name}」を複製しました`);
        notify();
        render();
      });

      popupEl.querySelector('[data-bd-depth-preset-rename]')?.addEventListener('click', async () => {
        if (!selected || selected.builtin) return;
        const name = await askName('新しいプリセット名を入力してください', selected.name);
        if (name === null || name === undefined) return;
        if (!renamePreset(selected.id, name)) return;
        notify();
        render();
      });

      popupEl.querySelector('[data-bd-depth-preset-delete]')?.addEventListener('click', async () => {
        if (!selected || selected.builtin) return;
        const ok = await askConfirm(`プリセット「${selected.name}」を削除しますか？`);
        if (!ok) return;
        if (!removePreset(selected.id)) return;
        opts.selectedId = '';
        if (typeof global.showStatus === 'function') global.showStatus(`プリセット「${selected.name}」を削除しました`);
        notify();
        render();
      });

      popupEl.querySelector('[data-bd-depth-preset-close]')?.addEventListener('click', () => {
        closePopup({ restoreFocus: true });
      });
    };

    popupEl.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePopup({ restoreFocus: true });
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const items = [...popupEl.querySelectorAll('.bd-depth-preset-item')];
      if (!items.length) return;
      const target = event.target?.closest?.('.bd-depth-preset-item');
      if (!target && event.target !== popupEl) return;
      event.preventDefault();
      const current = items.indexOf(target);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = current < 0 ? (step > 0 ? 0 : items.length - 1) : (current + step + items.length) % items.length;
      items[next].focus();
    });

    render();
    setTimeout(() => {
      popupOutsideHandler = event => {
        if (!popupEl || popupEl !== self) return;
        // 名前入力や削除確認のダイアログ内クリックでは閉じない。
        if (event.target?.closest?.('[aria-modal="true"], dialog[open]')) return;
        if (popupEl.contains(event.target)) return;
        if (popupAnchor && popupAnchor.contains(event.target)) return;
        closePopup();
      };
      document.addEventListener('pointerdown', popupOutsideHandler);
    }, 0);
  }

  // ============================================================
  //  階層別スタイルタブへ差し込むプリセット行
  // ============================================================

  function buildRow(options) {
    const opts = options || {};
    const section = document.createElement('div');
    section.className = 'bd-detail-section bd-depth-preset-section';
    const title = document.createElement('div');
    title.className = 'bd-detail-section-title';
    title.textContent = '階層別スタイルプリセット';
    if (typeof global.fieldHelp === 'function') {
      title.insertAdjacentHTML('beforeend', ' ' + global.fieldHelp(
        '階層ごとのカードとラインの組み合わせを一式でまとめたものです。選ぶとこのボードの階層別スタイル全体が入れ替わります。保存したプリセットはどのボードからでも使えます。'
      ));
    }
    const row = document.createElement('div');
    row.className = 'bd-detail-style-row';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'bd-style-panel-picker bd-depth-preset-picker';
    trigger.setAttribute('data-bd-depth-preset-picker', 'depth');
    trigger.setAttribute('data-e2e-id', 'bd-depth-preset-picker');
    trigger.setAttribute('aria-label', 'プリセットを選ぶ');
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');

    const refresh = () => {
      const activeId = matchedPresetId();
      const preset = activeId ? findPreset(activeId) : null;
      trigger.innerHTML = `<span class="bd-style-picker-preview">${previewHtml(preset ? preset.styles : currentStyles())}</span>`
        + `<span class="bd-style-picker-label">${escText(triggerLabel())}</span>`
        + '<span class="bd-style-picker-caret" aria-hidden="true">▾</span>';
    };
    refresh();

    trigger.addEventListener('click', () => {
      openPopup(trigger, {
        onChange: () => {
          refresh();
          if (typeof opts.onApplied === 'function') opts.onApplied();
        },
        refreshAnchor: () => (typeof opts.refreshAnchor === 'function' ? opts.refreshAnchor() : trigger),
      });
    });

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'bd-detail-style-action';
    saveBtn.setAttribute('data-bd-depth-preset-save', 'true');
    saveBtn.setAttribute('data-e2e-id', 'bd-depth-preset-save');
    saveBtn.title = '今の階層別スタイルを新しいプリセットとして保存';
    saveBtn.setAttribute('aria-label', saveBtn.title);
    saveBtn.innerHTML = typeof global.lucide === 'function' ? global.lucide('plus', 14) : '+';
    saveBtn.addEventListener('click', async () => {
      const name = await askName('プリセット名を入力してください', uniqueName('階層別スタイル'));
      if (name === null || name === undefined) return;
      const entry = saveCurrentAsNew(name);
      if (!entry) return;
      if (typeof global.showStatus === 'function') global.showStatus(`プリセット「${entry.name}」を保存しました`);
      refresh();
    });

    row.append(trigger, saveBtn);
    section.append(title, row);
    return { section, refresh };
  }

  global.MeldexBoardDepthPresets = Object.freeze({
    list: listPresets,
    find: findPreset,
    apply: applyPreset,
    saveCurrentAsNew,
    duplicate: duplicatePreset,
    overwrite: overwritePreset,
    rename: renamePreset,
    remove: removePreset,
    matchedPresetId,
    buildRow,
    openPopup,
    closePopup,
    storageKey: STORAGE_KEY,
  });
})(typeof window !== 'undefined' ? window : globalThis);
