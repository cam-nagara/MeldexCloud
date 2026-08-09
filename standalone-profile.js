/* standalone-profile.js
 * クラウド単独アプリ（ノート/シナリオ/シート/タイマー/ボード）共通の
 * ユーザー名・アイコン表示 + 変更用ポップオーバー。
 *
 * 目的（2026-07-20 実装）:
 *   「ホームに追加」で端末ホーム画面に入れるクラウド単独アプリで、現在ユーザーの
 *   名前・アイコンを本体（Meldex Cloud）と共通にし、単独アプリからも変更できるようにする。
 *   これにより gb-file-lock-store.js / gb-active-locks.js の signer / locked_by にも
 *   実際のユーザー名が入るようになる（従来は note/scenario/sheet/timer に
 *   getUsername が未定義で常に空文字だった）。
 *
 * 前提となる既存モジュール（このファイルより前に読み込み済み）:
 *   - standalone-stubs.js（showStatus, positionPopup簡易フォールバック 等）
 *     ※ 実際には meldex-core.js が本物の positionPopup/clampPopupToViewport/esc/_getZoom を
 *       同期XHRで読み込むため、meldex-core.js より後ならこれらは本物が使える。
 *   - standalone-cloud-runtime.js（MeldexStandaloneCloud: isCloudMode/getStatus/getActiveRoot、
 *     apiFetch/apiPost 等の差し替え、meldex:standalone-cloud-ready / meldex:standalone-auth-changed
 *     イベントの発火元）
 *   - gb-dropbox-profile-sync.js（MeldexDropboxProfileSync: resolveStartupProfile /
 *     saveCurrentProfile。プロフィール反映時に window へ 'meldex-profile-updated' を dispatch）
 *   - board-standalone-stubs.js（board のみ。getUsername/getUserAvatarHtml の簡易版を
 *     typeof ガードで既に定義済み。二重定義を避けるため、本ファイルはそれを上書きしない）
 *
 * 読み込み順: 5つの *-standalone.html すべてで standalone-cloud-runtime.js の直後。
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  const LOCAL_USER_KEY = 'meldex-user';
  const LOCAL_AVATAR_KEY = 'meldex-avatar';
  const LOCAL_AVATAR_SPEC_KEY = 'meldex-avatar-spec';
  const LOCAL_AVATAR_BG_KEY = 'meldex-avatar-bg';
  const DEFAULT_AVATAR_BG = '#3a6ea5';
  const AVATAR_UPLOAD_SIZE = 128;

  function _safeGet(key, fallbackValue) {
    try {
      const value = localStorage.getItem(key);
      return value == null ? fallbackValue : value;
    } catch {
      return fallbackValue;
    }
  }

  function _safeSet(key, value) {
    try {
      if (value == null || value === '') localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    } catch { /* localStorageが使えない環境（プライベートモード等）では保存を諦める */ }
  }

  function _safeJsonParse(text, fallbackValue) {
    try {
      return JSON.parse(String(text || ''));
    } catch {
      return fallbackValue;
    }
  }

  function _escText(value) {
    if (typeof window.esc === 'function') return window.esc(value);
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // --- getUsername / getUserAvatarHtml のグローバル定義 ----------------------
  // typeof ガード: board-standalone-stubs.js が先に定義済みの場合はそちらを優先する
  // （board との二重定義回避）。board 版も本ファイルと同じく localStorage の
  // 'meldex-user' を毎回読み直す実装のため、ここで保存した名前は board にもそのまま
  // 反映される。フォールバック値は本体（gb-app.part03.js の getUsername()）と
  // 揃えて 'anonymous' にする（gb-dropbox-profile-sync.js 側が
  // 「name !== 'anonymous'」で有効な名前かどうかを判定しているため、独自の
  // 日本語プレースホルダーを返すと初回起動時に無意味な名前が共有プロフィールへ
  // 書き込まれてしまう）。
  if (typeof window.getUsername !== 'function') {
    window.getUsername = function () {
      const saved = _safeJsonParse(_safeGet(LOCAL_USER_KEY, '{}'), {});
      const name = String(saved?.name || '').trim();
      return name || 'anonymous';
    };
  }

  function _avatarBgColor() {
    const value = _safeGet(LOCAL_AVATAR_BG_KEY, '');
    return /^#[0-9a-f]{6}$/i.test(value) ? value : DEFAULT_AVATAR_BG;
  }

  // 本ファイル専用の内部アバター描画（画像 + 背景色付き頭文字に対応）。
  // グローバル getUserAvatarHtml は typeof ガードのため board では上書きされない
  // （board 独自の頭文字のみ実装が残る）が、本ファイルが作るバッジ/ポップオーバーは
  // 常にこの内部関数を直接使うため、board でも画像アップロードが正しく反映される。
  function _avatarHtml(name, size, muted) {
    const px = Math.max(12, Math.min(64, Number(size) || 16));
    const avatarData = _safeGet(LOCAL_AVATAR_KEY, '');
    if (avatarData) {
      const filter = muted ? 'filter:grayscale(70%) brightness(0.85);' : '';
      return '<img src="' + _escText(avatarData) + '" alt="" style="'
        + 'width:' + px + 'px;height:' + px + 'px;border-radius:50%;'
        + 'object-fit:cover;display:block;' + filter + '">';
    }
    const rawName = String(name || (typeof getUsername === 'function' ? getUsername() : '')).trim();
    const label = (rawName && rawName !== 'anonymous') ? rawName.charAt(0).toUpperCase() : '?';
    const bg = muted ? '#5a5d63' : _avatarBgColor();
    const fg = muted ? '#c7cbd1' : '#ffffff';
    return '<span style="display:flex;align-items:center;justify-content:center;'
      + 'width:' + px + 'px;height:' + px + 'px;border-radius:50%;background:' + bg + ';'
      + 'color:' + fg + ';font-size:' + Math.max(9, Math.round(px * 0.5)) + 'px;font-weight:600;">'
      + _escText(label) + '</span>';
  }

  if (typeof window.getUserAvatarHtml !== 'function') {
    window.getUserAvatarHtml = function (username, size) {
      return _avatarHtml(username, size, false);
    };
  }

  // 表示用の「まだ名前が無い」を判定するヘルパー（gb-dropbox-profile-sync.js の
  // _usableLocalDisplayName() と同じ判定基準）。
  function _displayName() {
    const raw = typeof getUsername === 'function' ? getUsername() : '';
    return raw && raw !== 'anonymous' ? raw : '';
  }

  // --- ここから下は Cloud 単独アプリ（「ホームに追加」導線）専用 -----------------
  // 通常のデスクトップ/exe単独版（file:// やローカルフォルダ運用、Dropbox未接続の
  // 完全ローカル運用）ではバッジ/ポップオーバーは表示しない。
  function _isStandaloneCloud() {
    if (window.MeldexStandaloneCloud?.isCloudMode?.() === true) return true;
    return document.documentElement?.hasAttribute('data-standalone-cloud') === true;
  }

  function _isLocalProfile() {
    return document.body?.dataset?.standaloneProfileLocal === 'true';
  }

  if (!_isStandaloneCloud() && !_isLocalProfile()) return;

  let badgeEl = null;
  let popoverEl = null;
  let insertionObserver = null;
  let outsidePointerHandler = null;
  let popoverKeydownHandler = null;

  function _isConnected() {
    if (_isLocalProfile() && !_isStandaloneCloud()) return true;
    try {
      return window.MeldexStandaloneCloud?.getStatus?.()?.connected === true;
    } catch {
      return false;
    }
  }

  function _renderBadgeContent() {
    if (!badgeEl) return;
    const connected = _isConnected();
    const display = _displayName();
    badgeEl.classList.toggle('sa-profile-badge--guest', !connected);
    badgeEl.title = _isLocalProfile() && !_isStandaloneCloud()
      ? (display || 'ユーザー設定（この端末のみ）')
      : (connected ? (display || 'ユーザー設定') : 'ユーザー設定（Dropbox未接続）');
    badgeEl.setAttribute('aria-label', badgeEl.title);
    badgeEl.innerHTML = _avatarHtml(display, 22, !connected);
  }

  function _createBadge() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sa-profile-badge';
    btn.dataset.saProfileBadge = '1';
    btn.dataset.e2eId = 'sa-profile-badge';
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      _togglePopover(btn);
    });
    return btn;
  }

  function _tryInsertBadge() {
    if (badgeEl && badgeEl.isConnected) return true;

    const explicitSlot = document.querySelector('[data-sa-profile-slot]');
    if (explicitSlot) {
      badgeEl = _createBadge();
      badgeEl.classList.add('sa-icon-btn');
      explicitSlot.appendChild(badgeEl);
      _renderBadgeContent();
      return true;
    }

    // 4アプリ共通: header.sa-toolbar の右端（オプションパネルボタンの隣）。
    const header = document.querySelector('header.sa-toolbar');
    if (header) {
      badgeEl = _createBadge();
      badgeEl.classList.add('sa-icon-btn');
      header.appendChild(badgeEl);
      _renderBadgeContent();
      return true;
    }

    // board: 独自ヘッダーを持たず、上段ツールバー（gb-board-presets.js が動的生成する
    // [data-bd-role="toolbar-top"]）に挿入する。スマホ幅の優先/あふれメニュー化
    // （standalone-mobile-toolbar.js）が既に「...」ボタンを追加済みなら、その手前に置く。
    const boardToolbar = document.querySelector('#board-canvas-root [data-bd-role="toolbar-top"]');
    if (boardToolbar) {
      badgeEl = _createBadge();
      badgeEl.classList.add('tb-icon-btn');
      const moreButton = boardToolbar.querySelector('.sa-mtb-more-btn');
      if (moreButton) boardToolbar.insertBefore(badgeEl, moreButton);
      else boardToolbar.appendChild(badgeEl);
      _renderBadgeContent();
      return true;
    }

    return false;
  }

  // board はツールバーが起動後に動的生成されるため、挿入できるまで MutationObserver で待つ
  // （静かに諦めない）。#board-canvas-root が無い将来の未知アプリ向けの保険として
  // document.body も監視対象に含める。
  function _watchForInsertionPoint() {
    if (_tryInsertBadge()) return;
    if (insertionObserver) return;
    const target = document.getElementById('board-canvas-root') || document.body;
    if (!target) return;
    insertionObserver = new MutationObserver(() => {
      if (_tryInsertBadge() && insertionObserver) {
        insertionObserver.disconnect();
        insertionObserver = null;
      }
    });
    insertionObserver.observe(target, { childList: true, subtree: true });
  }

  // ---- ポップオーバー -------------------------------------------------------

  function _closePopover(options) {
    if (!popoverEl) return;
    const restoreFocus = options?.restoreFocus !== false;
    const node = popoverEl;
    popoverEl = null;
    node.remove();
    if (outsidePointerHandler) {
      document.removeEventListener('pointerdown', outsidePointerHandler, true);
      outsidePointerHandler = null;
    }
    if (popoverKeydownHandler) {
      document.removeEventListener('keydown', popoverKeydownHandler, true);
      popoverKeydownHandler = null;
    }
    badgeEl?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) {
      if (typeof window.focusMeldexDropdownTrigger === 'function') {
        window.focusMeldexDropdownTrigger(badgeEl);
      } else {
        try { badgeEl?.focus?.({ preventScroll: true }); } catch { badgeEl?.focus?.(); }
      }
    }
  }

  function _togglePopover(anchor) {
    if (popoverEl) {
      _closePopover({ restoreFocus: false });
      return;
    }
    _openPopover(anchor);
  }

  async function _saveProfile(overrides) {
    if (_isLocalProfile() && !_isStandaloneCloud()) return;
    const sync = window.MeldexDropboxProfileSync;
    if (typeof sync?.saveCurrentProfile === 'function') {
      try {
        await sync.saveCurrentProfile(overrides || {});
      } catch (error) {
        console.warn('[standalone-profile] saveCurrentProfile failed', error);
      }
    }
    try {
      if (typeof window.apiPost !== 'function') return;
      const folder = window.MeldexStandaloneCloud?.getActiveRoot?.()?.path || '';
      const name = typeof getUsername === 'function' ? getUsername() : 'anonymous';
      const avatar = _safeGet(LOCAL_AVATAR_KEY, '');
      await window.apiPost('/team/sync', { name, avatar, folder });
    } catch (error) {
      console.warn('[standalone-profile] /team/sync failed', error);
    }
  }

  // popoverEl._saProfileRefs は _openPopover() が生成直後に保持する直接参照
  // （クエリセレクタで探し直さない。軽量なNodeハーネスでも検証しやすくするため）。
  function _refreshPopoverPreview() {
    if (!popoverEl) return;
    const refs = popoverEl._saProfileRefs;
    if (!refs) return;
    if (refs.preview) refs.preview.innerHTML = _avatarHtml(_displayName(), 48, false);
    if (refs.nameLabel) refs.nameLabel.textContent = _displayName() || '未設定';
  }

  function _handleNameSave(input) {
    const value = String(input?.value || '').trim();
    if (!value) {
      window.showStatus?.('ユーザー名を入力してください', true);
      return;
    }
    _safeSet(LOCAL_USER_KEY, JSON.stringify({ name: value }));
    _renderBadgeContent();
    _refreshPopoverPreview();
    window.showStatus?.('ユーザー名を更新しました');
    _saveProfile({ displayName: value });
  }

  function _resizeImageToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const objUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = AVATAR_UPLOAD_SIZE;
          canvas.height = AVATAR_UPLOAD_SIZE;
          const ctx = canvas.getContext('2d');
          // 中央トリミング（gb-settings.part03.part02.js の uploadAvatar() と同じ方式）
          const side = Math.min(img.width, img.height);
          const sx = (img.width - side) / 2;
          const sy = (img.height - side) / 2;
          ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_UPLOAD_SIZE, AVATAR_UPLOAD_SIZE);
          resolve(canvas.toDataURL('image/png'));
        } catch (error) {
          reject(error);
        } finally {
          URL.revokeObjectURL(objUrl);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(objUrl);
        reject(new Error('画像を読み込めませんでした'));
      };
      img.src = objUrl;
    });
  }

  async function _handleAvatarUpload(input) {
    const file = input?.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await _resizeImageToDataUrl(file);
      _safeSet(LOCAL_AVATAR_KEY, dataUrl);
      _safeSet(LOCAL_AVATAR_SPEC_KEY, '');
      _renderBadgeContent();
      _refreshPopoverPreview();
      window.showStatus?.('アイコンを更新しました');
      await _saveProfile({ avatar: dataUrl, avatarSpec: '' });
    } catch {
      window.showStatus?.('画像を読み込めませんでした', true);
    } finally {
      input.value = '';
    }
  }

  async function _handleAvatarRemove() {
    _safeSet(LOCAL_AVATAR_KEY, '');
    _safeSet(LOCAL_AVATAR_SPEC_KEY, '');
    _renderBadgeContent();
    _refreshPopoverPreview();
    window.showStatus?.('アイコンを削除しました');
    await _saveProfile({ avatar: '', avatarSpec: '' });
  }

  function _attachCloseButton(popup, anchor) {
    if (typeof window.attachMeldexDropdownCloseButton === 'function') {
      window.attachMeldexDropdownCloseButton(popup, {
        trigger: anchor,
        rowClassName: 'sa-profile-popover-close-row',
        close: () => _closePopover({ restoreFocus: true }),
      });
      return;
    }
    // gb-dropdown-dismiss.js が未読み込みのアプリ（note/scenario/timer）向けの保険。
    const row = document.createElement('div');
    row.className = 'sa-profile-popover-close-row';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'sa-icon-btn';
    closeBtn.title = '閉じる';
    closeBtn.setAttribute('aria-label', '閉じる');
    closeBtn.dataset.e2eId = 'sa-profile-popover-close';
    closeBtn.innerHTML = typeof window.lucide === 'function' ? window.lucide('x', 14) : '&times;';
    closeBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      _closePopover({ restoreFocus: true });
    });
    row.appendChild(closeBtn);
    popup.appendChild(row);
  }

  // 要素はテンプレート文字列(innerHTML)ではなく DOM API で組み立てる。
  // - エスケープ漏れの心配がなくなる（_escText への依存を最小化）
  // - Node ハーネス（軽量な自前DOMモック）でも innerHTML パーサ無しにテストできる
  function _el(tag, props) {
    const node = document.createElement(tag);
    Object.entries(props || {}).forEach(([key, value]) => {
      if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key === 'dataset') Object.entries(value).forEach(([k, v]) => { node.dataset[k] = v; });
      else if (key === 'style') node.style.cssText = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key in node) node[key] = value;
      else node.setAttribute(key, value);
    });
    return node;
  }

  function _openPopover(anchor) {
    const connected = _isConnected();
    const currentName = _displayName();

    const popup = _el('div', {
      className: 'sa-profile-popover user-dropdown',
      dataset: { e2eId: 'sa-profile-popover' },
      role: 'dialog',
      'aria-modal': 'false',
      'aria-label': 'ユーザー設定',
      style: 'position:fixed;z-index:10040;',
    });

    const head = _el('div', { className: 'sa-profile-popover-head' });
    const preview = _el('span', { className: 'sa-profile-popover-preview', dataset: { saProfilePreview: '1' }, html: _avatarHtml(currentName, 48, false) });
    const nameLabel = _el('span', { className: 'sa-profile-popover-name', dataset: { saProfileName: '1' }, text: currentName || '未設定' });
    head.append(preview, nameLabel);

    const desc = _el('p', {
      className: 'sa-profile-popover-desc',
      text: _isLocalProfile() && !_isStandaloneCloud()
        ? 'ここで設定した名前とアイコンは、この端末のクイックメモだけに保存されます。'
        : connected
        ? 'ここで設定した名前とアイコンは、同じDropboxにつないだ Meldex Cloud・他の端末・他の単独アプリでも使われます。'
        : 'Dropboxに接続すると、名前とアイコンが他の端末と共通になります。',
    });

    const fieldLabel = _el('span', { text: 'ユーザー名' });
    const nameInput = _el('input', {
      type: 'text', value: currentName, maxLength: 40, placeholder: '名前を入力',
      dataset: { saProfileNameInput: '1' },
    });
    const field = _el('label', { className: 'sa-field sa-profile-popover-field' });
    field.append(fieldLabel, nameInput);

    const saveBtn = _el('button', {
      type: 'button', className: 'sa-text-btn', text: '保存',
      dataset: { saProfileAction: 'save-name', e2eId: 'sa-profile-save-name' },
      onclick: () => _handleNameSave(nameInput),
    });
    const uploadBtn = _el('button', {
      type: 'button', className: 'sa-text-btn', text: '画像をアップロード',
      dataset: { saProfileAction: 'upload', e2eId: 'sa-profile-upload' },
    });
    const removeBtn = _el('button', {
      type: 'button', className: 'sa-text-btn', text: 'アイコンを削除',
      dataset: { saProfileAction: 'remove', e2eId: 'sa-profile-remove' },
      onclick: () => _handleAvatarRemove(),
    });
    const actions = _el('div', { className: 'sa-profile-popover-actions' });
    actions.append(saveBtn, uploadBtn, removeBtn);

    const fileInput = _el('input', { type: 'file', accept: 'image/*', hidden: true, dataset: { saProfileFileInput: '1' } });
    uploadBtn.addEventListener('click', () => fileInput?.click());
    fileInput.addEventListener('change', () => _handleAvatarUpload(fileInput));
    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        _handleNameSave(nameInput);
      }
    });

    popup.append(head, desc, field, actions, fileInput);
    popup._saProfileRefs = { preview, nameLabel, nameInput };
    document.body.appendChild(popup);

    _attachCloseButton(popup, anchor);

    popoverEl = popup;
    badgeEl?.setAttribute('aria-expanded', 'true');
    if (typeof window.positionPopup === 'function') {
      window.positionPopup(popup, anchor.getBoundingClientRect());
    } else if (typeof window.clampPopupToViewport === 'function') {
      window.clampPopupToViewport(popup);
    }

    outsidePointerHandler = (event) => {
      if (popoverEl && (popoverEl.contains(event.target) || event.target === badgeEl || badgeEl?.contains(event.target))) return;
      _closePopover({ restoreFocus: false });
    };
    popoverKeydownHandler = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        _closePopover({ restoreFocus: true });
      }
    };
    document.addEventListener('pointerdown', outsidePointerHandler, true);
    document.addEventListener('keydown', popoverKeydownHandler, true);
    requestAnimationFrame(() => {
      try { nameInput?.focus({ preventScroll: true }); } catch { nameInput?.focus(); }
    });
  }

  // ---- 起動時プロフィール解決 -------------------------------------------------

  async function _resolveOnReady() {
    if (_isLocalProfile() && !_isStandaloneCloud()) {
      _renderBadgeContent();
      _refreshPopoverPreview();
      return;
    }
    try {
      await window.MeldexDropboxProfileSync?.resolveStartupProfile?.();
    } catch (error) {
      console.warn('[standalone-profile] resolveStartupProfile failed', error);
    }
    _renderBadgeContent();
    _refreshPopoverPreview();
  }

  window.addEventListener('meldex:standalone-cloud-ready', () => {
    _watchForInsertionPoint();
    _resolveOnReady();
  });
  window.addEventListener('meldex:standalone-auth-changed', () => {
    _renderBadgeContent();
    _refreshPopoverPreview();
  });
  window.addEventListener('meldex-profile-updated', () => {
    _renderBadgeContent();
    _refreshPopoverPreview();
  });

  // 4アプリは header.sa-toolbar が静的markupのため、Dropbox接続確認を待たず
  // スクリプト実行時点で即バッジを挿入する（board は上のイベント/observer経由）。
  _watchForInsertionPoint();

  window.MeldexStandaloneProfile = {
    isCloudMode: _isStandaloneCloud,
    renderBadge: _renderBadgeContent,
    _internals: { avatarHtml: _avatarHtml, displayName: _displayName },
  };
})();
