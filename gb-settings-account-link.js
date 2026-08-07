/**
 * Meldex 設定画面: 「ユーザー」パネルのマイプロフィール節に、名前・アイコンが
 * 他端末・クラウド版と共通かどうかの状態行を表示する。
 *
 * - 共有プロフィール（gb-dropbox-profile-sync.js）が使える環境で、名前とアイコンが
 *   既に他端末と紐づいている場合は「共通です」の一言を出す。
 * - Dropbox未接続などで共有プロフィール自体が使えない場合は「この端末だけの設定」
 *   と案内する。
 * - 自己同定ラダー（gb-profile-identity.js）が曖昧（unlinked）と判定した場合は、
 *   クラウド版で既に存在するプロフィール候補をインラインで選ばせる（ポップアップに
 *   しない。UI共通ルール: 選ぶだけの単純な一覧は都度モーダルを開かず、その場に置く）。
 * - 候補を選んだ直後に「クラウド版の設定／この端末の設定」のどちらの名前・アイコンを
 *   使うかをその場で選ばせる。どちらを選んでも以後は同じ1つの共有プロフィールに
 *   統合される。「この端末の設定」は、ローカルの名前・アイコンを選んだ共有
 *   プロフィールへ保存し、クラウド版・他端末にも反映する。
 *   候補が1件しか無い場合は「候補を選ぶ」段階に選択の意味が無い（唯一の候補しか
 *   選べず、この端末側の選択肢が無いように見えてしまう）ため、その中間画面は
 *   省略し、最初からこの2択を直接表示する（この場合「戻る」は出さず、代わりに
 *   分離登録ボタンをこの画面に出す）。
 * - 自己同定ラダー経由でリンク済み（OAuth接続済みを除く）の場合は「別のプロフィールに
 *   切り替える」を出す。押すと記憶（rememberedキー）を消し、直近に把握している候補
 *   一覧をその場で描画する。自動再解決に任せると表示名一致で即座に元の相手へ
 *   再連携してしまうため、切り替え操作の直後だけは自己同定ラダーを呼ばない。
 *
 * 判定情報が取得できない場合（モジュール未読込・想定外の例外）は、状態行を
 * 静かに非表示にする（設定画面の他の項目には影響させない）。
 *
 * window.MeldexSettingsAccountLink として公開する:
 *   - renderStatusLine(container): 状態行（+曖昧時の候補選択UI）を描画
 */
(function () {
  'use strict';

  if (window.MeldexSettingsAccountLink) return;

  const LINKED_METHODS = new Set(['oauth', 'remembered', 'single-entry', 'name-match', 'local-created']);

  const TEXT_LINKED = 'この名前とアイコンは、同じDropboxを使っている他の端末・クラウド版・ホーム画面に追加した単独アプリと共通です。';
  const TEXT_UNAVAILABLE = 'この名前とアイコンは今のところこの端末だけの設定です。';
  const TEXT_UNAVAILABLE_HELP = '保存先にDropboxのフォルダを使うと、他の端末やクラウド版と共通になります。';
  const TEXT_AMBIGUOUS = 'クラウド版で設定したプロフィールが見つかりました。この端末で使う名前とアイコンを選んでください。';
  const TEXT_REGISTER_NEW = '別人として新しいプロフィールを登録する';
  const TEXT_REGISTER_NEW_HELP = '候補とは統合されず、この端末専用の新しいプロフィールになります。';
  const TEXT_SWITCH_PROFILE = '別のプロフィールに切り替える';
  const TEXT_DIRECTION = 'どちらの名前とアイコンを使いますか？';
  const TEXT_DIRECTION_HELP = 'どちらを選んでも、以後この端末とクラウド版・他の端末は同じ1つのプロフィールになります。「この端末の設定」を選ぶと、今の名前とアイコンがクラウド版・他の端末にも反映されます。';
  const TEXT_USE_CLOUD_SUFFIX = '（クラウド版の設定）';
  const TEXT_USE_LOCAL_SUFFIX = '（この端末の設定）';
  const TEXT_BACK = '戻る';

  // UI共通ルール: 説明文はツールチップに集約する。この関数は共通ヘルパー
  // fieldHelp() を安全に呼び出すラッパー（この file 専用の手作りNode実行
  // テストハーネスが fieldHelp をスタブしていないため、未定義時は何も出さずに
  // 済ませる。実アプリでは meldex-core.js 経由で常に定義済み）。
  function _accountLinkHelp(text) {
    return typeof fieldHelp === 'function' ? fieldHelp(text) : '';
  }

  // 候補行のchevronアイコン用。fieldHelpと同じ理由で、Lucideが未読込の
  // Node手作りテストハーネスでも落ちないようtypeofガードする。
  function _icon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 14) : '';
  }

  function _injectStyles() {
    if (document.getElementById('msal-styles')) return;
    const style = document.createElement('style');
    style.id = 'msal-styles';
    style.textContent = `
      .msal-status-line{margin-top:10px;padding-top:10px;border-top:1px solid var(--border);}
      .msal-candidate-list{display:flex;flex-direction:column;gap:6px;margin-top:8px;}
      .msal-candidate-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--fg);cursor:pointer;text-align:left;width:100%;font:inherit;}
      .msal-candidate-row:hover,.msal-candidate-row:focus-visible{border-color:var(--accent);background:color-mix(in srgb, var(--accent) 10%, var(--bg2));outline:none;}
      .msal-candidate-avatar{width:24px;height:24px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;font-size:12px;font-weight:bold;color:var(--fg2);}
      .msal-candidate-avatar img{width:100%;height:100%;object-fit:cover;}
      .msal-candidate-name{font-size:13px;color:var(--fg);}
      .msal-candidate-suffix{font-size:12px;color:var(--fg2);}
      .msal-candidate-hint{margin-left:auto;padding-left:8px;display:inline-flex;align-items:center;color:var(--fg2);flex-shrink:0;}
      .msal-candidate-hint-text{font-size:12px;}
      .msal-register-new-row{margin-top:8px;justify-content:flex-start;}
      .msal-switch-row{margin-top:8px;justify-content:flex-start;}
    `;
    document.head.appendChild(style);
  }

  function _statusLineWrap(container) {
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'msal-status-line';
    container.appendChild(wrap);
    return wrap;
  }

  function _descNode(text, helpText) {
    const desc = document.createElement('div');
    desc.className = 'gb-section-desc';
    if (helpText) {
      desc.innerHTML = `${text} ${_accountLinkHelp(helpText)}`;
    } else {
      desc.textContent = text;
    }
    return desc;
  }

  // 共有プロフィールが使える環境かどうか、直近の自己同定結果（曖昧/紐づけ済み）
  // を1つにまとめて判定する。gb-dropbox-profile-sync.js / gb-profile-identity.js
  // が未読込・判定不能の場合は null を返し、呼び出し側が状態行を非表示にする。
  async function _computeLinkStatus() {
    const sync = window.MeldexDropboxProfileSync;
    if (!sync) return null;
    const shouldUseSharedProfileFn = sync._internals?.shouldUseSharedProfile;
    const canUseShared = typeof shouldUseSharedProfileFn === 'function' ? await shouldUseSharedProfileFn() : false;
    if (!canUseShared) return { kind: 'unavailable' };

    // 起動時解決がまだの場合に備え、ここで一度解決を試みる（既に成功済みなら
    // キャッシュされたPromiseがそのまま返るため、重複実行のコストは小さい）。
    try { await sync.resolveStartupProfile?.(); } catch { /* 失敗しても以降の判定を続ける */ }

    // OAuth接続済み（クラウド版）は自己同定ラダーを経由しないため、getLinkState()
    // では拾えない。accountIdキャッシュの有無で「リンク済み」を直接判定する。
    if (sync.getCachedAccountId?.()) return { kind: 'linked', method: 'oauth' };

    const state = sync.getLinkState?.();
    if (!state || !state.method) return null;
    if (state.method === 'unlinked') return { kind: 'ambiguous', state };
    if (LINKED_METHODS.has(state.method)) return { kind: 'linked', method: state.method, state };
    return null;
  }

  // 記憶を消し、直近に把握している候補一覧をそのまま候補選択UIとして描画する。
  // renderStatusLine() 経由の自動再解決（_computeLinkStatus → resolveStartupProfile）
  // に任せると、表示名が一致していれば同じ相手へ即座に再連携してしまい、切り替えの
  // 導線として機能しないため、ここでは resolveKey 等を一切呼ばない。
  function _switchProfile(container, candidates) {
    const identity = window.MeldexProfileIdentity;
    try {
      identity?.forgetKey?.();
      // 切り替え前のアカウント向けに記録された「ローカル更新時刻」を持ち越さない。
      // 持ち越すと、次に選ぶ相手の共有プロフィールへの反映判定（鍵一致ガード）を
      // 素通りして、選んだ相手のプロフィールを自端末の古いデータで上書きしてしまう
      // （gb-dropbox-profile-sync.js の _isLocalProfileNewer 参照）。
      window.MeldexDropboxProfileSync?.clearLocalUpdateMarker?.();
      // 起動時解決の結果キャッシュも捨てる。捨てないと、この後の候補選択で
      // resolveStartupProfile() が切り替え前の結果をそのまま返し、選び直した
      // プロフィールが反映されない。
      window.MeldexDropboxProfileSync?.resetStartupResolution?.();
    } catch (e) {
      try { console.warn('[gb-settings-account-link] forgetKey failed', e); } catch { /* noop */ }
    }
    _renderAmbiguous(container, { method: 'switch', key: null, candidates });
  }

  function _renderLinked(container, status) {
    const wrap = _statusLineWrap(container);
    wrap.appendChild(_descNode(TEXT_LINKED));
    // OAuth接続済み（クラウド版）は account_id が定まっているため自己同定ラダーを
    // 経由しない。切り替え先という概念自体が無いため導線を出さない。
    if (status?.method === 'oauth') return;
    const candidates = Array.isArray(status?.state?.candidates) ? status.state.candidates : [];
    const switchRow = document.createElement('div');
    switchRow.className = 'gb-field-row msal-switch-row';
    const switchBtn = document.createElement('button');
    switchBtn.type = 'button';
    switchBtn.className = 'gb-btn gb-btn-sm';
    switchBtn.textContent = TEXT_SWITCH_PROFILE;
    switchBtn.addEventListener('click', () => _switchProfile(container, candidates));
    switchRow.appendChild(switchBtn);
    wrap.appendChild(switchRow);
  }

  function _renderUnavailable(container) {
    const wrap = _statusLineWrap(container);
    wrap.appendChild(_descNode(TEXT_UNAVAILABLE, TEXT_UNAVAILABLE_HELP));
  }

  function _candidateAvatarNode(candidate) {
    const av = document.createElement('span');
    av.className = 'msal-candidate-avatar';
    const avatar = String(candidate?.avatar || '').trim();
    if (avatar) {
      const img = document.createElement('img');
      img.src = avatar;
      img.alt = '';
      av.appendChild(img);
    } else {
      av.textContent = String(candidate?.displayName || '?').charAt(0).toUpperCase();
    }
    return av;
  }

  // 候補行がクリックできることを見た目で示す右端のヒント（chevronアイコン、
  // 未読込環境では文字ラベルにフォールバック）。
  function _candidateHintNode() {
    const hint = document.createElement('span');
    hint.setAttribute('aria-hidden', 'true');
    const glyph = _icon('chevronRight', 14);
    if (glyph) {
      hint.className = 'msal-candidate-hint';
      hint.innerHTML = glyph;
    } else {
      hint.className = 'msal-candidate-hint msal-candidate-hint-text';
      hint.textContent = '選ぶ';
    }
    return hint;
  }

  // マイプロフィール節の表示（ユーザー名入力欄・アバタープレビュー）を、
  // 直近に反映されたローカル値（localStorage）へ再同期する。
  // 共有プロフィール適用自体（_applyProfileToLocal）はヘッダーアイコン等の
  // 更新まで済ませているため、ここでは設定ダイアログ固有のフィールドだけを扱う。
  function _refreshProfileFormFields() {
    try {
      const usernameInput = document.getElementById('modal-username');
      if (usernameInput && typeof getUsername === 'function') usernameInput.value = getUsername();
      const avatarEl = document.getElementById('settings-my-avatar');
      if (avatarEl) {
        const avatar = (() => {
          try { return localStorage.getItem('meldex-avatar') || ''; } catch { return ''; }
        })();
        if (typeof _setSettingsAvatarPreview === 'function') {
          _setSettingsAvatarPreview(avatarEl, avatar);
        } else if (!avatar) {
          avatarEl.textContent = '';
        }
        const bg = typeof _getAvatarBgColor === 'function' ? _getAvatarBgColor() : '#000000';
        avatarEl.style.background = bg;
      }
    } catch (e) {
      try { console.warn('[gb-settings-account-link] failed to refresh profile fields', e); } catch { /* noop */ }
    }
  }

  async function _selectCandidate(key, container) {
    const identity = window.MeldexProfileIdentity;
    const sync = window.MeldexDropboxProfileSync;
    if (!identity || !sync || !key) return;
    identity.rememberKey(key);
    // 選び直したキーと紐付かない古い「ローカル更新時刻」を持ち越さない。
    // 持ち越すと、切り替え前のアカウント向けに記録された更新時刻が鍵一致ガード
    // を素通りし、選んだ相手の共有プロフィールを自端末の名前・アイコンで上書き
    // してしまう（gb-dropbox-profile-sync.js の _isLocalProfileNewer 参照）。
    sync.clearLocalUpdateMarker?.();
    // 選び直したキーで解決し直すため、成功済みのキャッシュを先に捨てる。
    sync.resetStartupResolution?.();
    try {
      await sync.resolveStartupProfile?.();
    } catch (e) {
      try { console.warn('[gb-settings-account-link] resolveStartupProfile failed after selecting candidate', e); } catch { /* noop */ }
    }
    _refreshProfileFormFields();
    await renderStatusLine(container);
  }

  // 「この端末の設定を使う」: 選んだ共有プロフィール（クラウド版で作られたエントリ）
  // へ、この端末の名前・アイコンを保存して統合する。ユーザーが明示的に選んだ
  // 上書きであり、_selectCandidate が防いでいる「古いローカル更新時刻の持ち越しに
  // よる事故上書き」とは別経路。そのためここでは clearLocalUpdateMarker() を呼ばず、
  // afterLocalProfileChanged() が rememberKey 済みの新キーへ紐付けた新しい更新時刻を
  // 記録する（gb-dropbox-profile-sync.js の _markLocalProfile / _isLocalProfileNewer 参照）。
  async function _selectCandidateKeepLocal(key, container) {
    const identity = window.MeldexProfileIdentity;
    const sync = window.MeldexDropboxProfileSync;
    if (!identity || !sync || !key) return;
    identity.rememberKey(key);
    // 選び直したキーで解決し直すため、成功済みのキャッシュを先に捨てる。
    sync.resetStartupResolution?.();
    try {
      await sync.afterLocalProfileChanged?.({ accountId: key });
    } catch (e) {
      try { console.warn('[gb-settings-account-link] keep-local merge failed', e); } catch { /* noop */ }
    }
    try {
      await sync.resolveStartupProfile?.();
    } catch (e) {
      try { console.warn('[gb-settings-account-link] resolveStartupProfile failed after keep-local merge', e); } catch { /* noop */ }
    }
    _refreshProfileFormFields();
    await renderStatusLine(container);
  }

  // 候補を選んだ直後（または候補が1件で中間の候補選択画面を省略した直後）の
  // 「どちらの名前とアイコンを使いますか？」の2択をインラインで描画する。
  // どちらを選んでも同じ1つの共有プロフィールへ統合される。
  //
  // options.showBack: 中間の候補選択画面（_renderAmbiguous）を経由してここへ来た
  //   場合はtrue（既定）で「戻る」を出す。候補が1件でその中間画面自体を省略した
  //   場合はfalseを渡す。戻る先が無いため「戻る」は出さず、代わりに「今の設定の
  //   まま新しく登録する」相当のボタンをこの画面に出す（省略すると、そのボタンへ
  //   到達する手段がなくなるため）。
  function _renderDirectionChoice(container, candidate, state, options) {
    const showBack = !options || options.showBack !== false;
    const wrap = _statusLineWrap(container);
    wrap.appendChild(_descNode(TEXT_DIRECTION, TEXT_DIRECTION_HELP));

    const list = document.createElement('div');
    list.className = 'msal-candidate-list';

    const makeRow = (profileLike, suffix, onClick) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'msal-candidate-row';
      row.appendChild(_candidateAvatarNode(profileLike));
      const name = document.createElement('span');
      name.className = 'msal-candidate-name';
      name.textContent = profileLike?.displayName || '（表示名未設定）';
      row.appendChild(name);
      const suffixEl = document.createElement('span');
      suffixEl.className = 'msal-candidate-suffix';
      suffixEl.textContent = suffix;
      row.appendChild(suffixEl);
      row.appendChild(_candidateHintNode());
      row.addEventListener('click', onClick);
      return row;
    };

    list.appendChild(makeRow(candidate, TEXT_USE_CLOUD_SUFFIX, () => _selectCandidate(candidate?.key, container)));

    const localAvatar = (() => {
      try { return localStorage.getItem('meldex-avatar') || ''; } catch { return ''; }
    })();
    const localProfile = {
      displayName: typeof getUsername === 'function' ? getUsername() : '',
      avatar: localAvatar,
    };
    list.appendChild(makeRow(localProfile, TEXT_USE_LOCAL_SUFFIX, () => _selectCandidateKeepLocal(candidate?.key, container)));

    wrap.appendChild(list);

    if (showBack) {
      const backRow = document.createElement('div');
      backRow.className = 'gb-field-row msal-switch-row';
      const backBtn = document.createElement('button');
      backBtn.type = 'button';
      backBtn.className = 'gb-btn gb-btn-sm';
      backBtn.textContent = TEXT_BACK;
      backBtn.addEventListener('click', () => _renderAmbiguous(container, state));
      backRow.appendChild(backBtn);
      wrap.appendChild(backRow);
    } else {
      wrap.appendChild(_buildRegisterNewRow(container));
    }
  }

  async function _registerAsNew(container, btn) {
    const identity = window.MeldexProfileIdentity;
    const sync = window.MeldexDropboxProfileSync;
    if (!identity || !sync) return;
    if (btn) btn.disabled = true;
    try {
      const newKey = typeof identity.createLocalKey === 'function'
        ? identity.createLocalKey()
        : ('local:' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)));
      identity.rememberKey(newKey);
      // 新しいキーで解決し直すため、成功済みのキャッシュを先に捨てる。
      sync.resetStartupResolution?.();
      await sync.saveCurrentProfile?.({ accountId: newKey });
      try { await sync.resolveStartupProfile?.(); } catch { /* 次回起動時に再試行される */ }
      _refreshProfileFormFields();
      await renderStatusLine(container);
    } catch (e) {
      try { console.warn('[gb-settings-account-link] register as new failed', e); } catch { /* noop */ }
      if (btn) btn.disabled = false;
    }
  }

  // 「別人として新しいプロフィールを登録する」ボタン行を組み立てる。統合せず
  // 分離登録する操作であることをツールチップで補足する（基本UIに長文を
  // 直接置かないため）。候補一覧画面（_renderAmbiguous）と、候補1件で中間画面を
  // 省略した場合の2択画面（_renderDirectionChoice）の両方から使う共通部品。
  function _buildRegisterNewRow(container) {
    const registerRow = document.createElement('div');
    registerRow.className = 'gb-field-row msal-register-new-row';
    const registerBtn = document.createElement('button');
    registerBtn.type = 'button';
    registerBtn.className = 'gb-btn gb-btn-sm';
    registerBtn.textContent = TEXT_REGISTER_NEW;
    registerBtn.addEventListener('click', () => _registerAsNew(container, registerBtn));
    registerRow.appendChild(registerBtn);
    const help = _accountLinkHelp(TEXT_REGISTER_NEW_HELP);
    if (help) {
      const helpWrap = document.createElement('span');
      helpWrap.innerHTML = help;
      registerRow.appendChild(helpWrap);
    }
    return registerRow;
  }

  function _renderAmbiguous(container, state) {
    const candidates = Array.isArray(state?.candidates) ? state.candidates : [];
    // 候補が1件だけの場合、「候補を選ぶ」という分岐自体に選択の意味が無い
    // （唯一の候補ボタンしか押せず、他に選べる相手がいないように見えてしまう。
    // 実際のユーザー報告: この端末側の選択肢が無いように見える）。中間の候補
    // 選択画面を省略し、最初から「どちらの名前とアイコンを使いますか？」の
    // 2択を表示する。候補が2件以上のときだけ従来どおり2段階にする。
    if (candidates.length === 1) {
      _renderDirectionChoice(container, candidates[0], state, { showBack: false });
      return;
    }

    const wrap = _statusLineWrap(container);
    wrap.appendChild(_descNode(TEXT_AMBIGUOUS));

    const list = document.createElement('div');
    list.className = 'msal-candidate-list';
    candidates.forEach((candidate) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'msal-candidate-row';
      row.appendChild(_candidateAvatarNode(candidate));
      const name = document.createElement('span');
      name.className = 'msal-candidate-name';
      name.textContent = candidate?.displayName || candidate?.key || '（表示名未設定）';
      row.appendChild(name);
      row.appendChild(_candidateHintNode());
      // 即統合せず、どちらの名前・アイコンを使うかの2択（_renderDirectionChoice）を
      // 先に出す。キーの無い異常データはここで弾く（従来は _selectCandidate 内のガード）。
      row.addEventListener('click', () => {
        if (!candidate?.key) return;
        _renderDirectionChoice(container, candidate, state);
      });
      list.appendChild(row);
    });
    wrap.appendChild(list);

    wrap.appendChild(_buildRegisterNewRow(container));
  }

  async function renderStatusLine(container) {
    if (!container) return;
    _injectStyles();
    let status;
    try {
      status = await _computeLinkStatus();
    } catch (e) {
      container.innerHTML = '';
      return;
    }
    if (!status) {
      container.innerHTML = '';
      return;
    }
    if (status.kind === 'unavailable') {
      _renderUnavailable(container);
      return;
    }
    if (status.kind === 'linked') {
      _renderLinked(container, status);
      return;
    }
    if (status.kind === 'ambiguous') {
      _renderAmbiguous(container, status.state);
      return;
    }
    container.innerHTML = '';
  }

  window.MeldexSettingsAccountLink = {
    renderStatusLine,
  };
})();
