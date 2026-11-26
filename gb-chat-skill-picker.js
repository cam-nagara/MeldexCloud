/* gb-chat-skill-picker.js
 * AIチャット入力欄の「＋」メニュー（ファイル添付・スキルの選択と実行・スキル管理）。
 * 選んだスキルは入力欄の上に「使用スキル」チップで表示し、送信した発言へ
 * skills: [名前] と本文先頭の「【スキル: 名前】」目印を付けて送る。
 * サーバー側（meldex_skills.explicit_skill_names_from_messages）が目印を読み、
 * スキル本文を今回の依頼へ必ず適用する指示として注入する（通常チャット・CLIチャット共通）。
 * 入力欄で「/スキル名 追加の指示」と書いて送信しても同じスキルを使える。
 */
(function () {
  'use strict';

  const MARKER_PREFIX = '【スキル: ';
  const MARKER_SUFFIX = '】';
  const MARKER_RE = /^\s*【スキル[:：]\s*(.+?)\s*】\s*$/;
  const DEFAULT_RUN_TEXT = 'このスキルを実行してください。';
  const CACHE_TTL_MS = 30000;
  const CONSULT_TEXT = '新しいスキルを作りたいです。目的と使う場面を伝えるので、必要なことを質問しながら、名前・説明・トリガー・本文の案を作ってください。合意してから保存してください。\n\n目的: ';

  const state = {
    selected: null, // { name, description }
    cache: { sourceFolder: '', items: [], loadedAt: 0, pending: null },
  };

  function sourceFolder() {
    return typeof _chatSourceFolderValue === 'function' ? String(_chatSourceFolderValue() || '') : '';
  }

  // Cloud版（PWA/Dropbox/ブラウザ保存）にはスキルの保存先APIが無いため、スキル関連の項目を無効にする。
  function skillsAvailable() {
    const runtime = window.MeldexRuntimeAdapter;
    if (runtime?.isPwaMode?.()) return false;
    return !['browser', 'dropbox', 'server'].includes(document.body?.dataset?.cloudMode || '');
  }

  function markerFor(name) {
    return MARKER_PREFIX + String(name || '').trim() + MARKER_SUFFIX;
  }

  // 本文先頭の「【スキル: 名前】」行を取り除いた残りと、そこに書かれていた名前を返す。
  function splitMarkers(text) {
    const lines = String(text || '').split('\n');
    const names = [];
    while (lines.length) {
      const match = MARKER_RE.exec(lines[0]);
      if (!match) break;
      names.push(match[1]);
      lines.shift();
    }
    return { names, rest: lines.join('\n').trim() };
  }

  async function loadSkills(options = {}) {
    if (!skillsAvailable()) return [];
    const folder = sourceFolder();
    if (!folder) return [];
    const cache = state.cache;
    const fresh = cache.sourceFolder === folder && Date.now() - cache.loadedAt < CACHE_TTL_MS;
    if (fresh && !options.force) return cache.items;
    if (cache.pending && cache.sourceFolder === folder) return cache.pending;
    cache.sourceFolder = folder;
    cache.pending = (async () => {
      try {
        const res = await apiFetch('/skills?source_folder=' + encodeURIComponent(folder));
        if (cache.sourceFolder !== folder) return [];
        cache.items = Array.isArray(res?.skills) ? res.skills : [];
        cache.loadedAt = Date.now();
        return cache.items;
      } finally {
        cache.pending = null;
      }
    })();
    return cache.pending;
  }

  function cachedSkills() {
    return state.cache.sourceFolder === sourceFolder() ? state.cache.items : [];
  }

  /* ---------- 入力欄上の「使用スキル」チップ ---------- */

  function ensureBar() {
    let bar = document.getElementById('chat-skill-bar');
    if (bar) return bar;
    const anchor = document.getElementById('chat-attachments-bar');
    if (!anchor?.parentNode) return null;
    bar = document.createElement('div');
    bar.id = 'chat-skill-bar';
    bar.dataset.e2eId = 'chat-skill-bar';
    bar.style.cssText = 'display:none;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;font-size:11px;';
    anchor.parentNode.insertBefore(bar, anchor);
    return bar;
  }

  function renderChip() {
    const bar = ensureBar();
    if (!bar) return;
    bar.replaceChildren();
    const skill = state.selected;
    if (!skill) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    const chip = document.createElement('span');
    chip.className = 'gb-tag-chip';
    chip.dataset.e2eId = 'chat-skill-chip';
    chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;max-width:100%;';
    const label = document.createElement('span');
    label.textContent = '使用スキル: ' + skill.name;
    label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:240px;';
    if (skill.description) label.setAttribute('data-gb-tooltip', skill.description);
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.dataset.e2eId = 'chat-skill-chip-clear';
    close.setAttribute('aria-label', 'スキルの選択を解除');
    close.setAttribute('data-gb-tooltip', 'スキルの選択を解除');
    close.style.cssText = 'background:transparent;color:var(--fg2);border:none;cursor:pointer;padding:0 2px;font-size:13px;line-height:1;';
    close.addEventListener('click', () => clearSelection());
    chip.append(label, close);
    bar.appendChild(chip);
  }

  function select(skill) {
    const name = String(skill?.name || '').trim();
    if (!name) return;
    state.selected = { name, description: String(skill.description || '') };
    renderChip();
    if (!window.GBChatFormatting?.focusInput?.()) document.getElementById('chat-input')?.focus?.();
  }

  function clearSelection() {
    state.selected = null;
    renderChip();
  }

  /* ---------- 送信時の変換 ---------- */

  // 送信前に呼ぶ。スキルが関係しない送信なら null を返す（送信内容は変えない）。
  // 関係する場合は、目印付きの本文と skills を返す。選択の解除は commitSend で行う。
  function prepareSend(rawText) {
    const raw = String(rawText || '').trim();
    let name = state.selected?.name || '';
    let rest = raw;
    if (name) {
      const parsed = splitMarkers(raw);
      if (parsed.names.some(item => item.toLowerCase() === name.toLowerCase())) rest = parsed.rest;
    } else if (raw.startsWith('/')) {
      // 「/スキル名 追加の指示」。長い名前から照合し、名前の直後は空白・改行・末尾に限る。
      const names = cachedSkills().map(item => String(item?.name || '')).filter(Boolean)
        .sort((a, b) => b.length - a.length);
      const lower = raw.toLowerCase();
      const hit = names.find(item => {
        const head = '/' + item.toLowerCase();
        return lower.startsWith(head) && (lower.length === head.length || /\s/.test(lower[head.length]));
      });
      if (!hit) return null;
      name = hit;
      rest = raw.slice(hit.length + 1).trim();
    } else {
      return null;
    }
    return { text: markerFor(name) + '\n' + (rest || DEFAULT_RUN_TEXT), skills: [name] };
  }

  function commitSend() {
    clearSelection();
  }

  function onInput(event) {
    const value = String(event?.target?.value || '');
    if (value.startsWith('/') && skillsAvailable()) loadSkills().catch(() => {});
  }

  /* ---------- 「＋」メニュー ---------- */

  function anchorRect(anchor) {
    const rect = anchor?.getBoundingClientRect?.();
    return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null;
  }

  function openManage() {
    if (window.GBChatSkills?.open) window.GBChatSkills.open();
    else if (typeof showStatus === 'function') showStatus('スキル管理を読み込み中です。少し待ってから開き直してください。', true);
  }

  function startConsultation() {
    const input = document.getElementById('chat-input');
    window.GBChatSkills?.close?.();
    if (!input) return false;
    // スキル管理画面から呼ばれてチャット入力欄が見えていない時だけ、右サイドバーのチャットを開く。
    if (!input.offsetParent && typeof window.openRightPanelTab === 'function') {
      try { window.openRightPanelTab('chat'); } catch {}
    }
    if (!window.GBChatFormatting?.replaceInputSource?.(CONSULT_TEXT)) {
      input.value = CONSULT_TEXT;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (window.GBChatFormatting?.syncInput) window.GBChatFormatting.syncInput();
    }
    if (!window.GBChatFormatting?.focusInput?.({ atEnd: true })) input.focus();
    try { input.setSelectionRange(input.value.length, input.value.length); } catch {}
    return true;
  }

  function setItemTooltips(menu, tooltips) {
    if (!menu) return;
    Object.entries(tooltips).forEach(([e2eId, text]) => {
      const el = menu.querySelector(`[data-e2e-id="${e2eId}"]`);
      if (!el || !text) return;
      el.setAttribute('data-gb-tooltip', text);
      el.setAttribute('aria-description', text);
    });
  }

  function openComposerMenu(event) {
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
    const anchor = event?.target?.closest?.('button') || event?.currentTarget || document.querySelector('[data-chat-composer-plus]');
    const rect = anchorRect(anchor);
    const available = skillsAvailable();
    const unavailable = 'Cloud版ではスキルを使えません';
    const menu = window.MeldexContextMenuUI?.openAt?.({
      ariaLabel: '追加メニュー',
      e2eId: 'chat-composer-plus-menu',
      anchorRect: rect,
      restoreFocus: anchor,
      items: [
        { label: 'ファイルを添付', icon: 'paperclip', e2eId: 'chat-plus-attach', action: () => chatAttachmentPick() },
        { type: 'separator' },
        { label: 'スキルを使う…', icon: 'puzzle', e2eId: 'chat-plus-skill', disabled: !available, action: () => openSkillList(anchor) },
        { label: 'チャットで相談してスキルを作る', icon: 'messageSquare', e2eId: 'chat-plus-skill-consult', disabled: !available, action: () => startConsultation() },
        { label: 'スキルを管理…', icon: 'settings', e2eId: 'chat-plus-skill-manage', disabled: !available, action: () => openManage() },
      ],
    });
    if (!menu) {
      chatAttachmentPick();
      return null;
    }
    setItemTooltips(menu, {
      'chat-plus-attach': '画像やPDFを添付します',
      'chat-plus-skill': available ? '選んだスキルを次の送信で必ず使います。入力欄で「/スキル名」と書いても使えます' : unavailable,
      'chat-plus-skill-consult': available ? 'AIと相談しながら新しいスキルを作ります' : unavailable,
      'chat-plus-skill-manage': available ? 'スキルの一覧・作成・編集・削除' : unavailable,
    });
    return menu;
  }

  async function openSkillList(anchor) {
    if (!skillsAvailable()) return null;
    if (!sourceFolder()) {
      if (typeof showStatus === 'function') showStatus('フォルダツリーで対象フォルダを選択すると、そのフォルダのスキルを使えます', true);
      return null;
    }
    let skills;
    try {
      skills = await loadSkills({ force: true });
    } catch (error) {
      if (typeof showStatus === 'function') showStatus('スキルを読み込めませんでした: ' + (error?.message || error), true);
      return null;
    }
    const selectedName = state.selected?.name || '';
    const tooltips = {};
    const items = skills.map((skill, index) => {
      const e2eId = 'chat-skill-option-' + index;
      const triggers = Array.isArray(skill.triggers) ? skill.triggers.join('、') : String(skill.triggers || '');
      tooltips[e2eId] = [skill.description, triggers ? 'トリガー: ' + triggers : ''].filter(Boolean).join('\n');
      return {
        label: skill.name,
        icon: skill.name === selectedName ? 'check' : 'puzzle',
        e2eId,
        action: () => select(skill),
      };
    });
    if (!items.length) items.push({ label: 'スキルはまだありません', disabled: true, e2eId: 'chat-skill-option-empty' });
    items.push({ type: 'separator' });
    if (selectedName) items.push({ label: 'スキルの選択を解除', icon: 'x', e2eId: 'chat-skill-option-clear', action: () => clearSelection() });
    items.push({ label: 'チャットで相談してスキルを作る', icon: 'messageSquare', e2eId: 'chat-skill-option-consult', action: () => startConsultation() });
    items.push({ label: 'スキルを管理…', icon: 'settings', e2eId: 'chat-skill-option-manage', action: () => openManage() });
    const menu = window.MeldexContextMenuUI?.openAt?.({
      ariaLabel: 'スキルを選択',
      e2eId: 'chat-skill-list-menu',
      anchorRect: anchorRect(anchor),
      restoreFocus: anchor,
      items,
    });
    setItemTooltips(menu, tooltips);
    return menu;
  }

  function bindInput() {
    const input = document.getElementById('chat-input');
    if (!input || input.dataset.skillPickerBound === '1') return;
    input.dataset.skillPickerBound = '1';
    input.addEventListener('input', onInput);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindInput, { once: true });
  else bindInput();

  window.chatComposerPlusMenu = openComposerMenu;
  window.GBChatSkillPicker = Object.freeze({
    openComposerMenu,
    openSkillList,
    select,
    clearSelection,
    selected: () => (state.selected ? { ...state.selected } : null),
    prepareSend,
    commitSend,
    startConsultation,
    skillsAvailable,
    markerFor,
    splitMarkers,
    invalidate: () => { state.cache.loadedAt = 0; },
  });
})();
