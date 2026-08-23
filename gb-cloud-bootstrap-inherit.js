// Dropbox接続後の初回セットアップで、共有設定（ソースフォルダの一覧）に
// デスクトップ版が既に登録したフォルダがあれば案内し、1クリックで
// そのまま引き継いで開始できる導線を追加するモジュール。
//
// gb-cloud-bootstrap.js の Dropbox接続セットアップモーダル（_showDropboxSetupModal）
// が overlay を組み立てた直後にフックとして呼ばれる想定。本体の続行処理は
// 再実装せず、既存の「この設定で開始」ボタン（#cloud-continue）をそのまま
// クリックすることで再利用する。
(function () {
  'use strict';

  function _registry() {
    return window.MeldexSourceFolderRegistry;
  }

  function _auth() {
    return window.MeldexDropboxAuth;
  }

  function _esc(text) {
    return MeldexEscape.html(text);
  }

  async function _isConnected() {
    try {
      const session = await _auth()?.getSession?.();
      return !!session?.refreshToken;
    } catch {
      return false;
    }
  }

  // 台帳（型付き管理レコード /MeldexSettings/system/v1/folder-associations/source-folders.json、
  // または旧形式ファイル /MeldexSettings/_meldex/source-folders.v1.json）が
  // Dropbox上に実在するかどうかを軽量に確認する。
  //
  // loadRegistry() はこれらが存在しない場合でも、初回起動用に
  // vaultPath から1件だけ暫定の候補を合成して返す仕様になっている
  // （デスクトップ版を一度も使っていない完全新規ユーザーでも roots.length
  // が 0 にならない）。そのままだと「デスクトップ版で使っているフォルダが
  // 見つかりました」という案内が、実際には何も登録していない新規ユーザーにも
  // 表示されてしまう。ここでは案内の対象を「本当にデスクトップ版が台帳へ
  // 書き込み済みのケース」に限定するため、先に台帳そのものの実在確認を行う。
  // 管理レコードを優先し、無ければ旧形式ファイルを見る（loadRegistry() の
  // 読み取り優先順位と同じ）。
  async function _remoteRegistryFileExists() {
    const registry = _registry();
    const auth = _auth();
    if (!auth?.apiRpc) return false;
    // 管理レコード（home）→ 旧形式（home）→ 旧形式（team_root。チームアカウントで
    // 旧デスクトップが team_root 名前空間だけに台帳を残しているケース。registry 側の
    // _migrateLegacyTeamRegistry と同じフォールバック順）の3候補を順に確認する。
    const candidates = [
      { path: registry?.managedRegistryDropboxPath?.() },
      { path: registry?.registryDropboxPath?.() },
      { path: registry?.registryDropboxPath?.(), namespaceKind: 'team_root' },
    ].filter((candidate) => !!candidate.path);
    for (const candidate of candidates) {
      try {
        await auth.apiRpc(
          'files/get_metadata',
          {
            path: candidate.path,
            include_deleted: false,
            include_has_explicit_shared_members: false,
          },
          candidate.namespaceKind ? { namespaceKind: candidate.namespaceKind } : undefined,
        );
        return true;
      } catch {
        // 次の候補へ（存在しない・アクセス不可はどちらも「この経路では見つからない」扱い）
      }
    }
    return false;
  }

  async function _loadInheritableRoots() {
    const registry = _registry();
    if (!registry?.loadRegistry) return [];
    if (!(await _remoteRegistryFileExists())) return [];
    try {
      const data = await registry.loadRegistry({ writeIfMissing: false });
      return (data?.roots || []).filter((root) => root && !root.deleted);
    } catch (err) {
      console.warn('[MeldexCloudBootstrapInherit] failed to load source folder registry', err);
      return [];
    }
  }

  function _findAnchorSection(overlay) {
    const input = overlay.querySelector('#cloud-vault-path');
    return input ? input.closest('section') : null;
  }

  function _rootLabel(root) {
    return String(root?.name || root?.dropboxPath || '').trim();
  }

  function _buildSectionHtml(roots) {
    const names = roots.map(_rootLabel).filter(Boolean);
    const shown = names.slice(0, 5);
    const restCount = names.length - shown.length;
    const items = shown.map((name) => `<li>${_esc(name)}</li>`).join('');
    const moreItem = restCount > 0 ? `<li>ほか${restCount}件</li>` : '';
    return `
      <div style="font-size:15px;font-weight:700;margin-bottom:8px;color:#d4d4d4;">デスクトップ版で使っているソースフォルダが見つかりました（${roots.length}件）</div>
      <ul style="margin:0 0 12px;padding-left:20px;font-size:13px;color:#bdbdbd;line-height:1.7;">${items}${moreItem}</ul>
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;">
        <button id="cloud-inherit-continue" type="button" class="gb-btn gb-btn-primary" style="padding:8px 14px;border:none;border-radius:6px;background:#356b4d;color:#fff;cursor:pointer;">このフォルダを引き継いで開始</button>
        <a id="cloud-inherit-dismiss" href="#" style="font-size:12px;color:#9dbfae;text-decoration:underline;">別のフォルダを選ぶ</a>
      </div>
    `;
  }

  async function renderInheritSection(overlay) {
    if (!overlay || typeof overlay.querySelector !== 'function') return;
    // 多重挿入ガード（同じ overlay に対して二重に呼ばれても1つしか出さない）。
    if (overlay.dataset.meldexInheritChecked === '1') return;
    overlay.dataset.meldexInheritChecked = '1';

    if (!(await _isConnected())) return;
    const roots = await _loadInheritableRoots();
    if (!roots.length) return;
    // 非同期待ちの間にモーダルが閉じられている場合は何もしない。
    if (!overlay.isConnected) return;
    if (overlay.querySelector('#cloud-inherit-section')) return;

    const anchor = _findAnchorSection(overlay);
    const continueButton = overlay.querySelector('#cloud-continue');
    if (!anchor || !anchor.parentNode || !continueButton) return;

    const section = document.createElement('section');
    section.id = 'cloud-inherit-section';
    section.className = 'meldex-cloud-setup-section';
    section.style.cssText = 'border:1px solid #356b4d;border-radius:10px;padding:14px 16px;margin-bottom:14px;background:#182620;';
    section.innerHTML = _buildSectionHtml(roots);
    anchor.parentNode.insertBefore(section, anchor);
    anchor.style.display = 'none';

    section.querySelector('#cloud-inherit-continue')?.addEventListener('click', (event) => {
      event.preventDefault();
      // 既存の「この設定で開始」処理をそのまま呼び出す（再実装しない）。
      // vault パスの入力は要求せず、既定値のまま既存の互換チェックを通す。
      continueButton.click();
    });
    section.querySelector('#cloud-inherit-dismiss')?.addEventListener('click', (event) => {
      event.preventDefault();
      section.remove();
      anchor.style.display = '';
    });
  }

  window.MeldexCloudBootstrapInherit = {
    renderInheritSection,
  };
})();
