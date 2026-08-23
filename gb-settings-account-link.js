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
 * - クラウド版（Dropboxへ接続済み）でも、デスクトップ版が先に作ったプロフィールが
 *   残っている場合は同じ2択を出す。表示名が違っても本人が選べば1つにまとまる
 *   （自動では統合しない。別人のプロフィールを勝手に取り込まないため）。
 *   「別々のプロフィールのままにする」を選ぶと、以後そのプロフィールについては
 *   このお知らせを出さない。
 * - 統合（2択のどちらか・切り替え後の候補選択）を確定したら、それまで使っていた
 *   この端末専用プロフィールへ「引き継ぎ先」を記録し、以後どちらの端末から見ても
 *   1つのプロフィールに見えるようにする。「別人として新しいプロフィールを登録する」
 *   では記録しない（分けたい意思の表明なので統合してはならない）。
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
  const TEXT_DESKTOP_FOUND = 'デスクトップ版で設定したプロフィールが見つかりました。1つにまとめる場合は、使う名前とアイコンを選んでください。';
  const TEXT_USE_DESKTOP_SUFFIX = '（デスクトップ版の設定）';
  const TEXT_KEEP_SEPARATE = '別々のプロフィールのままにする';
  const TEXT_KEEP_SEPARATE_HELP = '統合せず、デスクトップ版とこの端末で別々の名前とアイコンを使い続けます。次からこのお知らせは出ません。';
  const TEXT_DESKTOP_FOUND_NOTICE = 'デスクトップ版のプロフィールが見つかりました';

  // 「別々のままにする」を選んだプロフィールを記録する（この端末のみ）。
  // 統合を促すお知らせを毎回出し続けないための抑止キー。gb-profile-identity.js の
  // 初回通知（meldex-profile-link-notice-shown）と同じ方式。
  const MERGE_DISMISSED_KEY = 'meldex-profile-merge-dismissed';
  const MERGE_NOTICE_SHOWN_KEY = 'meldex-profile-merge-notice-shown';

  function _readDismissedMergeKeys() {
    try {
      const raw = JSON.parse(localStorage.getItem(MERGE_DISMISSED_KEY) || '[]');
      return Array.isArray(raw) ? raw.map((key) => String(key)) : [];
    } catch {
      return [];
    }
  }

  function _rememberDismissedMergeKey(key) {
    const value = String(key || '').trim();
    if (!value) return;
    try {
      const keys = _readDismissedMergeKeys();
      if (keys.includes(value)) return;
      keys.push(value);
      localStorage.setItem(MERGE_DISMISSED_KEY, JSON.stringify(keys));
    } catch { /* 保存できなくてもお知らせが出続けるだけなので握りつぶす */ }
  }

  function _notifyDesktopProfileFoundOnce() {
    try {
      if (localStorage.getItem(MERGE_NOTICE_SHOWN_KEY) === '1') return;
      localStorage.setItem(MERGE_NOTICE_SHOWN_KEY, '1');
      if (typeof window.showStatus === 'function') window.showStatus(TEXT_DESKTOP_FOUND_NOTICE, false);
    } catch { /* noop */ }
  }

  function _currentUsername() {
    return typeof getUsername === 'function' ? String(getUsername() || '').trim() : '';
  }

  // UI共通ルール: 説明文はツールチップに集約する。この関数は共通ヘルパー
  // fieldHelp() を安全に呼び出すラッパー（この file 専用の手作りNode実行
  // テストハーネスが fieldHelp をスタブしていないため、未定義時は何も出さずに
  // 済ませる。実アプリでは meldex-core.js 経由で常に定義済み）。
  function _accountLinkHelp(text, e2eId) {
    if (typeof fieldHelp !== 'function') return '';
    return fieldHelp(text, e2eId ? { e2eId } : undefined);
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

  function _descNode(text, helpText, helpE2eId) {
    const desc = document.createElement('div');
    desc.className = 'gb-section-desc';
    if (helpText) {
      desc.innerHTML = `${text} ${_accountLinkHelp(helpText, helpE2eId)}`;
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

  // 統合の確定時に、参加者名簿の旧名の行を今の名前の行へ移す。
  // これを省くと、プロフィールを1つにまとめても名簿には同じ人が2行残り続ける。
  // 表示されている全ての保存先に対して行う（保存先ごとに別々の名簿がある）。
  async function _transferTeamMemberRow(previousDisplayNames) {
    const name = _currentUsername();
    if (!name || name === 'anonymous') return;
    if (typeof apiPost !== 'function') return;
    const previousNames = Array.from(new Set(
      (Array.isArray(previousDisplayNames) ? previousDisplayNames : [previousDisplayNames])
        .map((value) => String(value || '').trim())
        .filter((value) => value && value !== name && value !== 'anonymous'),
    ));
    if (!previousNames.length) return;
    const sync = window.MeldexDropboxProfileSync;
    const payload = (previousName, extra) => (sync?.teamSyncPayload?.({ name, previousName, ...(extra || {}) })
      || { name, previousName, ...(extra || {}) });
    let roots = [];
    try {
      if (typeof apiFetch === 'function') roots = await apiFetch('/outliner-roots');
    } catch (e) {
      try { console.warn('[gb-settings-account-link] failed to list roots for team merge', e); } catch { /* noop */ }
    }
    const visible = (Array.isArray(roots) ? roots : []).filter((root) => root?.visible && root?.path);
    for (const previousName of previousNames) {
      if (!visible.length) {
        await apiPost('/team/merge', payload(previousName)).catch((e) => {
          try { console.warn('[gb-settings-account-link] /team/merge failed (default folder)', e); } catch { /* noop */ }
        });
        continue;
      }
      for (const root of visible) {
        await apiPost('/team/merge', payload(previousName, { folder: root.path })).catch((e) => {
          try { console.warn('[gb-settings-account-link] /team/merge failed', root.path, e); } catch { /* noop */ }
        });
      }
    }
  }

  // 統合の確定時に、それまで使っていたプロフィールへ「引き継ぎ先」を記録する。
  // これを省くと、乗り換えただけで旧プロフィールが生き残り、候補一覧・共有判定の
  // 人数・参加者名簿に同じ人が二重に残り続ける。
  //
  // 記録するのはこの端末専用プロフィール（'local:'）だけ。実在のDropboxアカウントに
  // 紐づくプロフィールは他の端末・他人が今も使っている可能性があるため、ここで
  // 引き継ぎ済みにしてはならない（判定は MeldexDropboxProfileSync 側でも行う）。
  async function _mergeAbandonedProfile(previousKey, nextKey, options) {
    const sync = window.MeldexDropboxProfileSync;
    const from = String(previousKey || '').trim();
    const to = String(nextKey || '').trim();
    if (!sync || typeof sync.mergeProfileInto !== 'function') return null;
    if (!from || !to || from === to || !from.startsWith('local:')) return null;
    // 統合で「使われなくなる名前」は経路によって違う:
    //   - 相手の名前を採用 → 統合前に使っていた自分の名前が余る
    //   - 自分の名前を採用 → 相手のプロフィールが名簿に残していた名前が余る
    // どちらも拾えるよう、統合前の名前と旧エントリの名前の両方を候補として渡す
    // （現在の名前と同じものは _transferTeamMemberRow 側で除かれる）。
    // options.staleName は呼び出し側が知っている「余る名前」。表示名の反映が
    // 先に済んでいる経路では、ここで読む現在の名前は既に新しい方になっている。
    const nameBeforeMerge = _currentUsername();
    try {
      const result = await sync.mergeProfileInto(from, to, options);
      if (result?.changed) {
        await _transferTeamMemberRow([
          result.fromDisplayName,
          nameBeforeMerge,
          options?.staleName,
        ]);
      }
      return result;
    } catch (e) {
      try { console.warn('[gb-settings-account-link] merge previous profile failed', e); } catch { /* noop */ }
      return null;
    }
  }

  // 記憶を消し、直近に把握している候補一覧をそのまま候補選択UIとして描画する。
  // renderStatusLine() 経由の自動再解決（_computeLinkStatus → resolveStartupProfile）
  // に任せると、表示名が一致していれば同じ相手へ即座に再連携してしまい、切り替えの
  // 導線として機能しないため、ここでは resolveKey 等を一切呼ばない。
  function _switchProfile(container, candidates, previousKey) {
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
    // previousKey（切り替え前に使っていたプロフィール）は、この後の候補選択で
    // 統合を確定したときに「引き継ぎ元」として使う。forgetKey() の後では
    // 自己同定ラダーから取り直せないため、ここで持ち回る。
    _renderAmbiguous(container, { method: 'switch', key: null, candidates, previousKey });
  }

  // クラウド版（OAuth接続済み）から見て、デスクトップ版が先に作ったまま残っている
  // プロフィールを返す。表示名が一致しないと自動では引き継がれないため、ここで
  // 拾って本人に選ばせる。既に「別々のままにする」を選んだものは返さない。
  async function _findDesktopOnlyProfiles(currentKey) {
    const sync = window.MeldexDropboxProfileSync;
    if (typeof sync?.listProfileCandidates !== 'function') return [];
    let listed = null;
    try {
      listed = await sync.listProfileCandidates();
    } catch (e) {
      try { console.warn('[gb-settings-account-link] listProfileCandidates failed', e); } catch { /* noop */ }
      return [];
    }
    if (!listed?.ok || !Array.isArray(listed.candidates)) return [];
    const dismissed = _readDismissedMergeKeys();
    return listed.candidates.filter((candidate) => {
      const key = String(candidate?.key || '');
      return key.startsWith('local:') && key !== currentKey && !dismissed.includes(key);
    });
  }

  // 統合せず別々のままにする（分離登録と同じ「分けたい意思」の表明なので、
  // 引き継ぎ先の記録も名簿の移送も行わない）。
  async function _keepProfilesSeparate(candidateKey, container) {
    _rememberDismissedMergeKey(candidateKey);
    await renderStatusLine(container);
  }

  async function _confirmDesktopMerge(candidate, container, adoptContent) {
    const sync = window.MeldexDropboxProfileSync;
    const toKey = String(sync?.getCachedAccountId?.() || '').trim();
    if (!toKey || !candidate?.key) return;
    await _mergeAbandonedProfile(candidate.key, toKey, {
      adoptContent: !!adoptContent,
      staleName: adoptContent ? '' : candidate.displayName,
    });
    _refreshProfileFormFields();
    await renderStatusLine(container);
  }

  // クラウド版の2択。どちらを選んでも1つのプロフィールへまとまる。統合先のキーは
  // OAuthのaccount_idで固定されているため、選ぶのは「どちらの名前とアイコンを残すか」。
  function _renderDesktopMergeChoice(wrap, container, candidate, options) {
    wrap.appendChild(_descNode(
      TEXT_DESKTOP_FOUND,
      TEXT_DIRECTION_HELP,
      'settings-account-link-direction-help',
    ));

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

    list.appendChild(makeRow(candidate, TEXT_USE_DESKTOP_SUFFIX, () => _confirmDesktopMerge(candidate, container, true)));

    const localAvatar = (() => {
      try { return localStorage.getItem('meldex-avatar') || ''; } catch { return ''; }
    })();
    list.appendChild(makeRow(
      { displayName: _currentUsername(), avatar: localAvatar },
      TEXT_USE_LOCAL_SUFFIX,
      () => _confirmDesktopMerge(candidate, container, false),
    ));
    wrap.appendChild(list);

    const keepRow = document.createElement('div');
    keepRow.className = 'gb-field-row msal-register-new-row';
    const keepBtn = document.createElement('button');
    keepBtn.type = 'button';
    keepBtn.className = 'gb-btn gb-btn-sm';
    keepBtn.textContent = TEXT_KEEP_SEPARATE;
    keepBtn.addEventListener('click', () => _keepProfilesSeparate(candidate?.key, container));
    keepRow.appendChild(keepBtn);
    const help = _accountLinkHelp(TEXT_KEEP_SEPARATE_HELP, 'settings-account-link-keep-separate-help');
    if (help) {
      const helpWrap = document.createElement('span');
      helpWrap.innerHTML = help;
      keepRow.appendChild(helpWrap);
    }
    wrap.appendChild(keepRow);

    // 候補一覧から入ってきた場合だけ「戻る」を出す（選び直せるようにする）。
    if (typeof options?.onBack === 'function') {
      const backRow = document.createElement('div');
      backRow.className = 'gb-field-row msal-switch-row';
      const backBtn = document.createElement('button');
      backBtn.type = 'button';
      backBtn.className = 'gb-btn gb-btn-sm';
      backBtn.textContent = TEXT_BACK;
      backBtn.addEventListener('click', options.onBack);
      backRow.appendChild(backBtn);
      wrap.appendChild(backRow);
    }
  }

  // 候補が2件以上ある場合は、どのプロフィールと1つにするかを先に選ばせる。
  function _renderDesktopMergeCandidates(wrap, container, candidates) {
    wrap.appendChild(_descNode(TEXT_DESKTOP_FOUND));
    const list = document.createElement('div');
    list.className = 'msal-candidate-list';
    candidates.forEach((candidate) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'msal-candidate-row';
      row.appendChild(_candidateAvatarNode(candidate));
      const name = document.createElement('span');
      name.className = 'msal-candidate-name';
      name.textContent = candidate?.displayName || '（表示名未設定）';
      row.appendChild(name);
      row.appendChild(_candidateHintNode());
      row.addEventListener('click', () => {
        if (!candidate?.key) return;
        const nextWrap = _statusLineWrap(container);
        nextWrap.appendChild(_descNode(TEXT_LINKED));
        _renderDesktopMergeChoice(nextWrap, container, candidate, {
          onBack: () => {
            const backWrap = _statusLineWrap(container);
            backWrap.appendChild(_descNode(TEXT_LINKED));
            _renderDesktopMergeCandidates(backWrap, container, candidates);
          },
        });
      });
      list.appendChild(row);
    });
    wrap.appendChild(list);
  }

  async function _renderLinked(container, status) {
    const wrap = _statusLineWrap(container);
    wrap.appendChild(_descNode(TEXT_LINKED));
    // OAuth接続済み（クラウド版）は account_id が定まっているため自己同定ラダーを
    // 経由しない。切り替え先という概念自体は無いが、デスクトップ版が先に作った
    // プロフィールが残っている場合だけ、1つにまとめるかどうかをその場で選ばせる。
    if (status?.method === 'oauth') {
      const currentKey = String(window.MeldexDropboxProfileSync?.getCachedAccountId?.() || '').trim();
      const candidates = await _findDesktopOnlyProfiles(currentKey);
      if (!candidates.length) return;
      _notifyDesktopProfileFoundOnce();
      if (candidates.length === 1) _renderDesktopMergeChoice(wrap, container, candidates[0]);
      else _renderDesktopMergeCandidates(wrap, container, candidates);
      return;
    }
    const candidates = Array.isArray(status?.state?.candidates) ? status.state.candidates : [];
    const switchRow = document.createElement('div');
    switchRow.className = 'gb-field-row msal-switch-row';
    const switchBtn = document.createElement('button');
    switchBtn.type = 'button';
    switchBtn.className = 'gb-btn gb-btn-sm';
    switchBtn.textContent = TEXT_SWITCH_PROFILE;
    switchBtn.addEventListener('click', () => _switchProfile(container, candidates, status?.state?.key));
    switchRow.appendChild(switchBtn);
    wrap.appendChild(switchRow);
  }

  function _renderUnavailable(container) {
    const wrap = _statusLineWrap(container);
    wrap.appendChild(_descNode(
      TEXT_UNAVAILABLE,
      TEXT_UNAVAILABLE_HELP,
      'settings-account-link-unavailable-help',
    ));
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

  async function _selectCandidate(key, container, state) {
    const identity = window.MeldexProfileIdentity;
    const sync = window.MeldexDropboxProfileSync;
    if (!identity || !sync || !key) return;
    // 表示名が候補のものへ差し替わる前に、今この端末が名簿へ登録している名前を
    // 控えておく（統合後にこの名前の行が余るため）。
    const nameBeforeSelect = _currentUsername();
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
    await _mergeAbandonedProfile(state?.previousKey, key, { staleName: nameBeforeSelect });
    _refreshProfileFormFields();
    await renderStatusLine(container);
  }

  // 「この端末の設定を使う」: 選んだ共有プロフィール（クラウド版で作られたエントリ）
  // へ、この端末の名前・アイコンを保存して統合する。ユーザーが明示的に選んだ
  // 上書きであり、_selectCandidate が防いでいる「古いローカル更新時刻の持ち越しに
  // よる事故上書き」とは別経路。そのためここでは clearLocalUpdateMarker() を呼ばず、
  // afterLocalProfileChanged() が rememberKey 済みの新キーへ紐付けた新しい更新時刻を
  // 記録する（gb-dropbox-profile-sync.js の _markLocalProfile / _isLocalProfileNewer 参照）。
  // options.staleName: 統合によって名簿で使われなくなる相手側の表示名。
  async function _selectCandidateKeepLocal(key, container, state, staleName) {
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
    await _mergeAbandonedProfile(state?.previousKey, key, { staleName });
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
    wrap.appendChild(_descNode(
      TEXT_DIRECTION,
      TEXT_DIRECTION_HELP,
      'settings-account-link-direction-help',
    ));

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

    list.appendChild(makeRow(candidate, TEXT_USE_CLOUD_SUFFIX, () => _selectCandidate(candidate?.key, container, state)));

    const localAvatar = (() => {
      try { return localStorage.getItem('meldex-avatar') || ''; } catch { return ''; }
    })();
    const localProfile = {
      displayName: typeof getUsername === 'function' ? getUsername() : '',
      avatar: localAvatar,
    };
    list.appendChild(makeRow(localProfile, TEXT_USE_LOCAL_SUFFIX, () => _selectCandidateKeepLocal(candidate?.key, container, state, candidate?.displayName)));

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
    const help = _accountLinkHelp(
      TEXT_REGISTER_NEW_HELP,
      'settings-account-link-register-new-help',
    );
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
      await _renderLinked(container, status);
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
