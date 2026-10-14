/* ==============================
   gb-user-picker.js: ユーザー選択ピッカーの共通モジュール

   ユーザーアカウント一元管理 計画書 Phase 3（§5.8 ピッカー統一）

   6箇所に重複していた候補ユーザー一覧の実装（`/team`・`/auth/users` の
   マージ）を `getCandidates()` に集約する。候補 = 正本「スタッフ管理シート」
   （MeldexUserRegistry.listStaff）+ ワークスペースメンバーのマージ。
   制作管理はPhase 4で正本へ完全統合済みだが、ワークスペースメンバーの
   マージ自体は「ワークスペースに参加済みだが正本未登録（fill-only同期が
   まだ走っていない等）」のユーザーを候補から漏らさないための恒常的な設計
   であり、Phase 4完了後も残す（計画書 §5.4・§5.8）。
   `/auth/users` への参照はここで無くなる。

   `open()` は既存 `_showUserDropdown`（gb-db-value-editors.part03.js）を
   母体に一般化した共通ポップアップ（検索・複数選択・自由入力対応）。
   UI共通ルール（meldex-ui-common-rules-2026-07-01.md）に従い、位置決めは
   positionPopup()/_positionCellDropdown() を使い、選択以外の操作（複数選択の
   確定・解除）を持つため閉じるボタンを備える。
   ============================== */
(function () {
  'use strict';

  function _isActiveLeftStaffRow(row) {
    const today = new Date().toISOString().slice(0, 10);
    return !!(row && row.active_to && String(row.active_to) <= today);
  }

  // 候補ユーザー一覧を取得する（正本 + ワークスペースメンバーのマージ）。
  // 6箇所の重複実装（/team・/auth/users のマージ）の統一先。
  async function getCandidates(opts) {
    const options = opts || {};
    const seen = new Set();
    const result = [];
    const add = (name, extra) => {
      const trimmed = String(name || '').trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      result.push(Object.assign({ name: trimmed, display: trimmed, role: '', has_avatar: false, user_type: 'account' }, extra || {}));
    };

    if (typeof getUsername === 'function') {
      const me = getUsername();
      if (me && me !== 'anonymous') add(me);
    }

    try {
      if (window.MeldexUserRegistry) {
        const staff = await window.MeldexUserRegistry.listStaff(options.force ? { force: true } : {});
        staff.forEach((row) => {
          if (_isActiveLeftStaffRow(row)) return; // 離脱者は選択候補から外す（計画書§5.6）
          add(row.user || row.display, {
            id: row.user_id || '',
            display: row.display || row.user || '',
            role: row.role || '',
            user_type: row.user_type || 'account',
            workspace_ids: Array.isArray(row.workspace_ids) ? row.workspace_ids.slice() : [],
          });
        });
      }
    } catch (e) { /* 正本シート未設定時は無視して次の候補源へ */ }

    try {
      if (window.MeldexWorkspaces?.load) {
        const workspaces = await window.MeldexWorkspaces.load({ force: false });
        (Array.isArray(workspaces) ? workspaces : []).forEach((workspace) => {
          (workspace.members || []).forEach((member) => add(member?.name, { role: member?.role || '' }));
        });
      }
    } catch (e) { /* ワークスペース未使用時は無視 */ }

    (options.extraCandidates || []).forEach((name) => add(name));
    return result;
  }

  function _pickerAvatarHtml(name) {
    if (typeof _userAvatarSmall === 'function') return _userAvatarSmall(name);
    return '';
  }

  function _pickerEsc(text) {
    return MeldexEscape.html(text);
  }

  // 共通ユーザー選択ポップアップ。
  // opts: { multi, value, onCommit, onCancel, onClose, allowFreeText, extraCandidates,
  //         candidates（省略時は getCandidates() で取得）, useCellPositioning }
  async function open(anchor, opts) {
    const options = opts || {};
    document.querySelectorAll('.gb-user-picker-dd').forEach((el) => el.remove());

    const candidates = options.candidates || await getCandidates(options);
    const isMulti = !!options.multi;
    const currentValue = options.value == null ? '' : String(options.value);
    const selected = new Set(
      isMulti && currentValue ? currentValue.split(',').map((s) => s.trim()).filter(Boolean) : []
    );
    if (!isMulti && currentValue) selected.add(currentValue.trim());

    const dd = document.createElement('div');
    dd.className = 'cell-inline-dd gb-user-picker-dd';
    dd.style.cssText = 'position:fixed;z-index:9999;min-width:200px;max-height:320px;overflow-y:auto;background:var(--ui-popup-bg, var(--bg2));border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.3);padding:4px;';
    dd.addEventListener('pointerdown', (e) => e.stopPropagation());
    dd.addEventListener('click', (e) => e.stopPropagation());

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = options.allowFreeText ? 'ユーザーを検索・入力...' : 'ユーザーを検索...';
    searchInput.style.cssText = 'width:100%;padding:4px 8px;font-size:12px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;margin-bottom:4px;box-sizing:border-box;';
    dd.appendChild(searchInput);

    let closer = null;
    function closeDropdown() {
      if (dd.parentNode) dd.remove();
      if (closer) { document.removeEventListener('pointerdown', closer); closer = null; }
      if (typeof options.onClose === 'function') options.onClose();
    }
    function commitSingle(name) {
      closeDropdown();
      if (typeof options.onCommit === 'function') options.onCommit(name);
    }
    function commitMulti() {
      closeDropdown();
      if (typeof options.onCommit === 'function') options.onCommit([...selected].join(', '));
    }

    function renderList(filter) {
      dd.querySelectorAll('.user-option,.user-confirm-btn,.user-clear-btn,.user-empty-msg,.user-freetext-btn').forEach((el) => el.remove());
      const filtered = filter
        ? candidates.filter((u) => u.name.toLowerCase().includes(filter.toLowerCase()))
        : candidates;

      if (!filtered.length) {
        const msg = document.createElement('div');
        msg.className = 'user-empty-msg';
        msg.style.cssText = 'padding:8px;color:var(--fg2);font-size:12px;text-align:center;';
        msg.textContent = options.allowFreeText ? '一致するユーザーがいません（そのまま入力できます）' : '該当するユーザーがいません';
        dd.appendChild(msg);
      }

      filtered.forEach((u) => {
        const item = document.createElement('div');
        item.className = 'user-option';
        const isSelected = selected.has(u.name);
        item.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 8px;cursor:pointer;border-radius:3px;font-size:12px;'
          + (isSelected ? 'background:var(--accent);color:var(--ui-accent-fg, var(--ui-fg-strong));' : '');
        const userKind = u.user_type === 'virtual' ? '仮ユーザー' : (u.role || '');
        item.innerHTML = (isMulti ? '<span style="font-size:11px;">' + (isSelected ? '✓' : '　') + '</span> ' : '')
          + _pickerAvatarHtml(u.name) + ' ' + _pickerEsc(u.display || u.name)
          + '<span style="margin-left:auto;font-size:10px;color:' + (isSelected ? 'color-mix(in srgb, var(--ui-fg-strong) 70%, transparent)' : 'var(--fg2)') + ';">' + _pickerEsc(userKind) + '</span>';
        item.addEventListener('mouseover', () => { if (!isSelected) item.style.background = 'var(--bg3)'; });
        item.addEventListener('mouseout', () => { if (!isSelected) item.style.background = ''; });
        item.addEventListener('click', () => {
          if (isMulti) {
            if (selected.has(u.name)) selected.delete(u.name);
            else selected.add(u.name);
            renderList(searchInput.value);
          } else {
            commitSingle(u.name);
          }
        });
        dd.appendChild(item);
      });

      const trimmedFilter = String(filter || '').trim();
      if (options.allowFreeText && trimmedFilter && !candidates.some((u) => u.name === trimmedFilter)) {
        const freeItem = document.createElement('div');
        freeItem.className = 'user-freetext-btn dd-nav-item';
        freeItem.style.cssText = 'padding:4px 8px;cursor:pointer;font-size:12px;color:var(--accent);border-top:1px solid var(--border);margin-top:4px;';
        freeItem.textContent = `"${trimmedFilter}" をそのまま使う`;
        freeItem.addEventListener('click', () => {
          if (isMulti) { selected.add(trimmedFilter); searchInput.value = ''; renderList(''); }
          else commitSingle(trimmedFilter);
        });
        dd.appendChild(freeItem);
      }

      if (isMulti) {
        const confirmBtn = document.createElement('div');
        confirmBtn.className = 'user-confirm-btn dd-nav-item';
        confirmBtn.style.cssText = 'padding:4px 8px;margin-top:4px;text-align:center;cursor:pointer;font-size:12px;color:var(--accent);border-top:1px solid var(--border);font-weight:bold;';
        confirmBtn.textContent = '✓ 確定';
        confirmBtn.addEventListener('click', commitMulti);
        dd.appendChild(confirmBtn);
      }

      if (!isMulti && currentValue) {
        const clearBtn = document.createElement('div');
        clearBtn.className = 'user-clear-btn';
        clearBtn.style.cssText = 'padding:4px 8px;text-align:center;cursor:pointer;font-size:11px;color:var(--fg2);border-top:1px solid var(--border);margin-top:4px;';
        clearBtn.textContent = '選択を解除';
        clearBtn.addEventListener('click', () => commitSingle(''));
        dd.appendChild(clearBtn);
      }
    }

    searchInput.addEventListener('input', () => renderList(searchInput.value));
    renderList('');

    // 選択以外の操作（複数選択の確定・解除・自由入力）を持つため、
    // UI共通ルールに従い閉じるボタンを備える。
    if (isMulti || options.allowFreeText || currentValue) {
      if (typeof attachMeldexDropdownCloseButton === 'function') {
        dd.insertAdjacentHTML('beforeend', typeof meldexDropdownCloseButtonHtml === 'function' ? meldexDropdownCloseButtonHtml() : '');
        attachMeldexDropdownCloseButton(dd, () => {
          closeDropdown();
          if (typeof focusMeldexDropdownTrigger === 'function' && anchor) focusMeldexDropdownTrigger(anchor);
        });
      }
    }

    if (options.useCellPositioning && typeof _positionCellDropdown === 'function') {
      _positionCellDropdown(dd, anchor, { gap: 2, minWidth: 200 });
    } else {
      document.body.appendChild(dd);
      const anchorRect = anchor && typeof anchor.getBoundingClientRect === 'function' ? anchor.getBoundingClientRect() : anchor;
      if (typeof positionPopup === 'function' && anchorRect) {
        positionPopup(dd, anchorRect);
      } else if (typeof clampPopupToViewport === 'function') {
        clampPopupToViewport(dd);
      }
    }

    if (typeof _enableDropdownKeyNav === 'function') {
      _enableDropdownKeyNav(dd, '.user-option,.user-confirm-btn,.user-clear-btn,.user-freetext-btn');
    }
    searchInput.focus();

    setTimeout(() => {
      closer = (ev) => {
        if (!dd.contains(ev.target)) {
          closeDropdown();
          if (typeof options.onCancel === 'function') options.onCancel();
        }
      };
      document.addEventListener('pointerdown', closer);
    }, 0);

    return dd;
  }

  window.MeldexUserPicker = { getCandidates, open };
})();
