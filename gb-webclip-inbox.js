/* URL-only mobile intake. Page/media retrieval runs on the desktop, never here. */
(function (global) {
  'use strict';
  const PREFIX = 'meldex:webclip-inbox:draft:';
  const INBOX = 'Web Clipper/受信箱';
  let activeDraft = null;
  let draftId = '';
  let busy = false;
  let ui = null;

  function normalizeUrl(value) {
    const raw = String(value || '').trim();
    if (!raw || raw.length > 8192 || /[\s\x00-\x1f\x7f]/.test(raw)) throw new Error('ページのURLを入力してください');
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('HTTPまたはHTTPSのページURLを指定してください');
    parsed.hash = '';
    return parsed.href;
  }

  async function keyForUrl(value) {
    const bytes = new TextEncoder().encode(normalizeUrl(value));
    const digest = await global.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function isReceiver() {
    const params = new URLSearchParams(location.search);
    return params.get('webclip') === '1' || ['clip_url', 'clip_text', 'clip_title'].some(key => params.has(key));
  }

  function receiverUrl() {
    const cloud = document.documentElement.hasAttribute('data-standalone-cloud') || global.MeldexRuntimeAdapter?.getMode?.() === 'dropbox';
    const base = cloud ? document.baseURI : (global.MeldexCloudRuntimeConfig?.cloudPublicUrl || 'https://cam-nagara.github.io/MeldexCloud/');
    return new URL('apps/quick-memo/?webclip=1', new URL('./', base)).href;
  }

  function incoming(params) {
    const text = params.get('clip_text') || '';
    const raw = params.get('clip_url') || text.match(/https?:\/\/[^\s<>"']+/i)?.[0]
      || (params.get('clip_title') || '').match(/^https?:\/\/\S+$/i)?.[0] || '';
    return { url: raw, title: (params.get('clip_title') || '').slice(0, 300) };
  }

  function status(message, error = false) {
    if (!ui) return;
    ui.status.textContent = String(message);
    ui.status.dataset.error = error ? '1' : '0';
  }

  function persist() {
    try { localStorage.setItem(PREFIX + draftId, JSON.stringify(activeDraft)); return true; }
    catch { status('端末に保留できません。画面を閉じずに送信してください', true); return false; }
  }

  function textOf(value) { return typeof value === 'string' ? value : String(value?.content || ''); }
  function missing(error) { return Number(error?.status || error?.status_code) === 404; }
  function cleanTitle(value) { return String(value || '').replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 300); }

  async function ensureFolder(cloud, parent, name) {
    const children = await cloud.browse(parent, { detail: false });
    const existing = children.find(item => String(item.name || item.path?.split('/').pop()) === name);
    if (existing) {
      if (existing.type !== 'folder' && existing.kind !== 'directory' && existing.kind !== 'folder' && existing.is_dir !== true) throw new Error(name + 'はフォルダではありません');
      return parent + '/' + name;
    }
    try { await cloud.createFolder(parent, name); }
    catch (error) {
      if (Number(error?.status || error?.status_code) !== 409) throw error;
      const latest = await cloud.browse(parent, { detail: false });
      if (!latest.some(item => String(item.name || item.path?.split('/').pop()) === name && ['folder', 'directory'].includes(item.type || item.kind))) throw error;
    }
    return parent + '/' + name;
  }

  async function submit(cloud, draft, rootId) {
    await cloud.ensureReady({ requireConnection: true });
    const root = cloud.getRoots().find(item => item.id === rootId);
    if (!root?.path) throw new Error('PC版にも登録したDropboxフォルダを選択してください');
    if (draft.root && draft.root !== root.path) throw new Error('保留中のURLは送信時に選んだフォルダへ再送してください');
    const url = normalizeUrl(draft.url);
    const key = await keyForUrl(url);
    const path = root.path.replace(/\/$/, '') + '/' + INBOX + '/web-' + key + '.url';
    draft.root = root.path;
    draft.url = url;
    if (draft === activeDraft) persist();
    let parent = await ensureFolder(cloud, root.path, 'Web Clipper');
    await ensureFolder(cloud, parent, '受信箱');
    const content = '[InternetShortcut]\nURL=' + url + '\nTitle=' + cleanTitle(draft.title) + '\n';
    try { await cloud.writeText(path, content, { create_only: true }); }
    catch (error) {
      if (Number(error?.status || error?.status_code) !== 409) throw error;
      const previous = textOf(await cloud.readText(path));
      if (!/^\[InternetShortcut\]\r?\n/i.test(previous) || previous.match(/^URL=(.*)$/m)?.[1]?.trim() !== url) throw error;
    }
    draft.path = path;
    draft.sent = true;
    return path;
  }

  async function refreshResult() {
    if (!activeDraft?.path) return;
    try {
      const cloud = global.MeldexStandaloneCloud;
      const root = cloud.getRoots().find(item => item.path === activeDraft.root);
      if (!root) throw new Error('送信時のDropboxフォルダへ接続してください');
      const path = activeDraft.path.replace(/\/web-([a-f0-9]{64})\.url$/, '/取得結果/web-$1.txt');
      const text = textOf(await cloud.readText(path));
      const state = text.match(/^status\s*=\s*(.+)$/m)?.[1]?.trim();
      const message = text.match(/^message\s*=\s*(.*)$/m)?.[1]?.trim();
      status(state === 'saved' ? 'PC版Meldexで取得済みです' : state === 'partial'
        ? message || '本文は保存済みですが、一部の画像・動画を取得できませんでした'
        : 'PC版Meldexで再試行待ちです。' + (message ? ' ' + message : ''));
    } catch (error) {
      status(missing(error) ? '受信箱に保存済みです。PC版Meldexの起動後に取得します' : error?.message || error, !missing(error));
    }
  }

  function refreshConnection() {
    if (!ui) return;
    const cloud = global.MeldexStandaloneCloud;
    const connected = cloud?.getStatus?.().connected === true;
    ui.auth.hidden = connected;
    const previous = ui.roots.value;
    ui.roots.replaceChildren();
    const roots = cloud?.getRoots?.() || [];
    for (const root of roots) {
      const option = document.createElement('option');
      option.value = root.id;
      option.textContent = root.name || root.label || root.path;
      option.selected = activeDraft?.root ? activeDraft.root === root.path : root.id === (previous || cloud.getActiveRoot()?.id);
      ui.roots.appendChild(option);
    }
    if (connected && !roots.length) {
      const option = document.createElement('option');
      option.textContent = 'Cloud版MeldexでDropboxフォルダを登録してください';
      option.value = '';
      ui.roots.appendChild(option);
    }
    ui.send.disabled = !connected || !roots.length || busy;
  }

  async function open() {
    const params = new URLSearchParams(location.search);
    draftId = /^[a-zA-Z0-9-]{8,80}$/.test(params.get('draft') || '') ? params.get('draft') : global.crypto.randomUUID();
    try { activeDraft = JSON.parse(localStorage.getItem(PREFIX + draftId) || 'null'); } catch { activeDraft = null; }
    activeDraft = activeDraft && typeof activeDraft === 'object' ? activeDraft : incoming(params);
    const host = document.getElementById('editorView');
    host.className = 'qm-shell webclip-inbox';
    document.querySelectorAll('.qm-create-wrap, #listView').forEach(node => { node.hidden = true; });
    host.replaceChildren();
    host.innerHTML = `<h1>Web受信箱</h1>
      <p>URLをDropboxへ送り、PC版Meldexの起動中に本文・画像・取得できる動画を保存します。PC停止中の分は次回起動時に取得します。</p>
      <label>ページURL<input id="clip-url" type="url" inputmode="url" autocomplete="url" placeholder="https://…"></label>
      <label>タイトル（任意）<input id="clip-title" type="text" maxlength="300"></label>
      <div id="clip-auth"><button id="clip-connect" type="button">Dropboxに接続</button>
        <label>接続コード<input id="clip-code" type="text" autocomplete="off" spellcheck="false"></label><button id="clip-exchange" type="button">コードで接続</button></div>
      <label>保存先<select id="clip-roots" aria-label="保存先のDropboxフォルダ"></select></label>
      <p>PC版Meldexにも登録してあるDropboxフォルダを選んでください。</p>
      <button id="clip-settings" type="button">Cloud版Meldexで保存先を設定</button>
      <button id="clip-send" type="button" disabled>Web受信箱へ送る</button>
      <button id="clip-result" type="button">取得結果を確認</button>
      <p id="clip-status" role="status" aria-live="polite"></p>
      <details><summary>iPhoneの共有メニューに追加する</summary><ol>
        <li>「ショートカット」で新規作成し、名前を「Meldexに保存」にします。「共有シートに表示」をONにして、入力の種類を「URL」にします。</li>
        <li>「URLエンコード」アクションで「ショートカットの入力」をエンコードします。</li>
        <li>「テキスト」に下の送信先URLを入れ、末尾にエンコードしたURLの変数を追加します。</li>
        <li>「URLを開く」に、その「テキスト」を指定します。Chromeの共有から「Meldexに保存」を選び、開いた画面で送信します。</li>
      </ol><label>ショートカットの送信先URL<input id="clip-shortcut" readonly></label><button id="clip-copy" type="button">送信先URLをコピー</button></details>
      <details><summary>Androidの共有メニューに追加する</summary><p>Cloud版MeldexをChromeのメニューからアプリとしてインストールしてください。ページの共有先でMeldexを選び、ここで送信します。</p></details>
      <p>ログインが必要なページや分割配信・DRM動画などは取得できない場合があります。</p>`;
    ui = Object.fromEntries(['url', 'title', 'auth', 'connect', 'code', 'exchange', 'roots', 'send', 'result', 'status', 'shortcut', 'copy', 'settings'].map(name => [name, document.getElementById('clip-' + name)]));
    document.title = 'Web受信箱 — Meldex';
    ui.url.value = String(activeDraft.url || '');
    ui.title.value = String(activeDraft.title || '');
    ui.shortcut.value = receiverUrl() + '&clip_url=';
    if (persist()) history.replaceState(null, '', location.pathname + '?webclip=1&draft=' + draftId);
    for (const input of [ui.url, ui.title]) input.addEventListener('input', () => {
      if (activeDraft.sent) activeDraft = {};
      activeDraft.url = ui.url.value;
      activeDraft.title = ui.title.value;
      persist();
    });
    ui.send.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      refreshConnection();
      status('受信箱へ送信しています…');
      try {
        activeDraft.url = ui.url.value;
        activeDraft.title = ui.title.value;
        await submit(global.MeldexStandaloneCloud, activeDraft, ui.roots.value);
        persist();
        status('受信箱に保存しました。PC版Meldexの起動中に取得します');
      } catch (error) { status('送信できませんでした。画面を開き直して再送できます。' + (error?.message || error), true); }
      finally { busy = false; refreshConnection(); }
    });
    ui.result.addEventListener('click', () => {
      if (!activeDraft.sent) return status('送信してから取得結果を確認できます');
      refreshResult();
    });
    ui.connect.addEventListener('click', async () => {
      const popup = global.open('about:blank', '_blank');
      try {
        const auth = await global.MeldexStandaloneCloud.beginManualAuth();
        if (!popup) throw new Error('ポップアップを許可してから接続してください');
        popup.opener = null;
        popup.location.replace(auth.authorizationUrl);
      } catch (error) { popup?.close(); status(error?.message || error, true); }
    });
    ui.exchange.addEventListener('click', async () => {
      try { await global.MeldexStandaloneCloud.exchangeManualCode(ui.code.value.trim()); ui.code.value = ''; refreshConnection(); }
      catch (error) { status(error?.message || error, true); }
    });
    ui.copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(ui.shortcut.value); status('ショートカットの送信先URLをコピーしました'); }
      catch { ui.shortcut.select(); status('送信先URLを選択しました。コピーしてください'); }
    });
    ui.settings.addEventListener('click', () => global.open(new URL('../../Meldex.html', receiverUrl()).href, '_blank', 'noopener'));
    for (const name of ['meldex:standalone-cloud-ready', 'meldex:standalone-auth-changed', 'meldex:standalone-root-changed']) global.addEventListener(name, refreshConnection);
    try { await global.MeldexStandaloneCloud?.init?.(); refreshConnection(); }
    catch (error) { status(error?.message || error, true); }
    if (activeDraft.sent) status('受信箱に送信済みです。取得結果を確認できます');
  }

  global.MeldexWebClipInbox = Object.freeze({ isReceiver, receiverUrl, normalizeUrl, keyForUrl, incoming, submit, open });
})(window);
