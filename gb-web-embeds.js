/* gb-web-embeds.js — 動画・SNSポストの共有リンクを表示時だけ埋め込みへ展開する。
 *
 * 保存データ（Markdown本文）は変えない。描画したHTMLに contenteditable=false の
 * .gb-web-embed 要素を足すだけで、htmlToMd はこの要素を読み飛ばす。
 * - ノート本文: URLだけの行（素のURL / [URL](URL)）の下に表示する（mdToHtml・貼り付け・入力時）。
 * - チャット: 発言内の対応リンク（最大3件）を段落の下に表示する。
 * 外部スクリプトはページへ入れず、サムネイル画像か各サービス公式の埋め込みiframeだけを使う。
 * 動画はサムネイル（またはカード）を押した時に初めてプレーヤーを読み込む。
 * 埋め込み要素はテキストノードを持たない（本文検索・行数え・コピーへ混ざらない）。
 */
(function (global) {
  'use strict';

  const MAX_CHAT_EMBEDS = 3;
  const PROVIDER_LABELS = {
    youtube: 'YouTube', niconico: 'ニコニコ動画', vimeo: 'Vimeo', dailymotion: 'Dailymotion',
    tiktok: 'TikTok', x: 'X', instagram: 'Instagram', bluesky: 'Bluesky', threads: 'Threads',
    spotify: 'Spotify', soundcloud: 'SoundCloud',
  };

  function _host(url) {
    return String(url.hostname || '').toLowerCase().replace(/^(www|m|mobile)\./, '');
  }

  function _youtubeStart(url) {
    const raw = url.searchParams.get('t') || url.searchParams.get('start') || '';
    if (/^\d+$/.test(raw)) return Number(raw);
    const m = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!m || !raw) return 0;
    return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
  }

  function _isDarkTheme() {
    try {
      const doc = global.document;
      const bg = global.getComputedStyle?.(doc.body || doc.documentElement)?.backgroundColor || '';
      const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return false;
      return (0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3])) < 128;
    } catch (_) {
      return false;
    }
  }

  // 共有URLを解析する。対応外・不正な形式は null。
  // 返す src/thumbnail は検証済みIDだけから組み立てる（入力URLの断片をそのまま埋めない）。
  function parse(rawUrl) {
    const text = String(rawUrl || '').trim();
    if (!/^https?:\/\/\S+$/i.test(text) || text.length > 2048) return null;
    let url;
    try { url = new URL(text); } catch (_) { return null; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = _host(url);
    const parts = url.pathname.split('/').filter(Boolean);
    const base = { url: url.href, provider: '', kind: '', title: '' };

    // YouTube
    if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
      let id = '';
      let shorts = false;
      if (host === 'youtu.be') id = parts[0] || '';
      else if (parts[0] === 'watch') id = url.searchParams.get('v') || '';
      else if (['shorts', 'live', 'embed', 'v'].includes(parts[0])) { id = parts[1] || ''; shorts = parts[0] === 'shorts'; }
      if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
      const start = _youtubeStart(url);
      return { ...base, provider: 'youtube', kind: 'video', id, aspect: shorts ? 'portrait' : 'wide',
        thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0${start ? '&start=' + start : ''}` };
    }
    // ニコニコ動画
    if (host === 'nicovideo.jp' || host === 'sp.nicovideo.jp' || host === 'nico.ms') {
      const id = host === 'nico.ms' ? (parts[0] || '') : (parts[0] === 'watch' ? (parts[1] || '') : '');
      const m = id.match(/^(sm|nm|so)(\d{1,12})$/);
      if (!m) return null;
      return { ...base, provider: 'niconico', kind: 'video', id, aspect: 'wide',
        thumbnail: m[1] === 'sm' ? `https://nicovideo.cdn.nimg.jp/thumbnails/${m[2]}/${m[2]}` : '',
        src: `https://embed.nicovideo.jp/watch/${id}?autoplay=1` };
    }
    // Vimeo
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      const idIndex = parts.findIndex(p => /^\d{3,12}$/.test(p));
      if (idIndex < 0) return null;
      const id = parts[idIndex];
      const hash = /^[0-9a-f]{6,20}$/i.test(parts[idIndex + 1] || '') ? parts[idIndex + 1] : (url.searchParams.get('h') || '');
      const safeHash = /^[0-9a-f]{6,20}$/i.test(hash) ? hash : '';
      return { ...base, provider: 'vimeo', kind: 'video', id, aspect: 'wide', thumbnail: '',
        src: `https://player.vimeo.com/video/${id}?autoplay=1${safeHash ? '&h=' + safeHash : ''}` };
    }
    // Dailymotion
    if (host === 'dailymotion.com' || host === 'dai.ly') {
      const id = host === 'dai.ly' ? (parts[0] || '') : (parts[0] === 'video' ? String(parts[1] || '').split('_')[0] : '');
      if (!/^[a-zA-Z0-9]{5,12}$/.test(id)) return null;
      return { ...base, provider: 'dailymotion', kind: 'video', id, aspect: 'wide',
        thumbnail: `https://www.dailymotion.com/thumbnail/video/${id}`,
        src: `https://geo.dailymotion.com/player.html?video=${id}&autoplay=1` };
    }
    // TikTok
    if (host === 'tiktok.com') {
      const idx = parts.indexOf('video');
      const id = idx >= 0 ? (parts[idx + 1] || '') : '';
      if (!/^\d{8,25}$/.test(id)) return null;
      return { ...base, provider: 'tiktok', kind: 'video', id, aspect: 'portrait', thumbnail: '',
        src: `https://www.tiktok.com/player/v1/${id}?autoplay=1` };
    }
    // X / Twitter
    if (host === 'x.com' || host === 'twitter.com') {
      const idx = parts.findIndex(p => p === 'status' || p === 'statuses');
      const id = idx >= 0 ? (parts[idx + 1] || '') : '';
      if (!/^\d{5,25}$/.test(id)) return null;
      return { ...base, provider: 'x', kind: 'post', id, height: 520,
        src: `https://platform.twitter.com/embed/Tweet.html?id=${id}&dnt=true&lang=ja${_isDarkTheme() ? '&theme=dark' : ''}` };
    }
    // Instagram
    if (host === 'instagram.com') {
      const idx = parts.findIndex(p => p === 'p' || p === 'reel' || p === 'reels' || p === 'tv');
      const code = idx >= 0 ? (parts[idx + 1] || '') : '';
      if (!/^[A-Za-z0-9_-]{5,40}$/.test(code)) return null;
      const type = parts[idx] === 'reels' ? 'reel' : parts[idx];
      return { ...base, provider: 'instagram', kind: 'post', id: code, height: 600,
        src: `https://www.instagram.com/${type}/${code}/embed/` };
    }
    // Bluesky
    if (host === 'bsky.app') {
      if (parts[0] !== 'profile' || parts[2] !== 'post') return null;
      const actor = decodeURIComponent(parts[1] || '');
      const rkey = parts[3] || '';
      if (!/^[a-z0-9]{6,20}$/i.test(rkey)) return null;
      const isDid = /^did:(plc|web):[A-Za-z0-9._:-]{3,200}$/.test(actor);
      if (!isDid && !/^[A-Za-z0-9.-]{3,253}$/.test(actor)) return null;
      return { ...base, provider: 'bluesky', kind: 'post', id: rkey, actor, height: 420,
        needsResolve: !isDid,
        src: isDid ? `https://embed.bsky.app/embed/${actor}/app.bsky.feed.post/${rkey}` : '' };
    }
    // Threads
    if (host === 'threads.net' || host === 'threads.com') {
      const user = parts[0] || '';
      const code = parts[1] === 'post' ? (parts[2] || '') : '';
      if (!/^@[A-Za-z0-9._]{1,40}$/.test(user) || !/^[A-Za-z0-9_-]{5,40}$/.test(code)) return null;
      return { ...base, provider: 'threads', kind: 'post', id: code, height: 560,
        src: `https://www.threads.com/${user}/post/${code}/embed` };
    }
    // Spotify
    if (host === 'open.spotify.com') {
      const rest = /^intl-[a-z-]+$/i.test(parts[0] || '') ? parts.slice(1) : parts;
      const type = rest[0] || '';
      const id = rest[1] || '';
      if (!['track', 'album', 'playlist', 'episode', 'show', 'artist'].includes(type) || !/^[A-Za-z0-9]{10,40}$/.test(id)) return null;
      return { ...base, provider: 'spotify', kind: 'audio', id, height: (type === 'track' || type === 'episode') ? 152 : 352,
        src: `https://open.spotify.com/embed/${type}/${id}` };
    }
    // SoundCloud
    if (host === 'soundcloud.com') {
      if (parts.length < 2 || ['discover', 'search', 'you', 'stream', 'upload', 'pages'].includes(parts[0])) return null;
      if (!parts.every(p => /^[A-Za-z0-9_.-]+$/.test(p))) return null;
      const clean = `https://soundcloud.com/${parts.join('/')}`;
      return { ...base, provider: 'soundcloud', kind: 'audio', id: parts.join('/'), height: parts[1] === 'sets' ? 450 : 166,
        src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(clean)}&visual=false` };
    }
    return null;
  }

  function _labelFor(info) {
    return PROVIDER_LABELS[info.provider] || info.provider;
  }

  function _makeFrame(info, src) {
    const doc = global.document;
    const frame = doc.createElement('iframe');
    frame.className = 'gb-web-embed-frame';
    frame.src = src;
    frame.loading = 'lazy';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation');
    frame.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write');
    frame.setAttribute('allowfullscreen', '');
    frame.title = `${_labelFor(info)}の埋め込み`;
    if (info.kind !== 'video' && info.height) frame.style.height = info.height + 'px';
    return frame;
  }

  // 埋め込み要素を作る。動画は再生ボタン付きのサムネイル/カード、ポスト・音声はiframe。
  function buildElement(info) {
    const doc = global.document;
    if (!doc || !info) return null;
    const label = _labelFor(info);
    const box = doc.createElement('div');
    box.className = `gb-web-embed gb-web-embed--${info.kind} gb-web-embed--${info.provider}`;
    if (info.aspect === 'portrait') box.classList.add('gb-web-embed--portrait');
    box.contentEditable = 'false';
    box.dataset.gbWebEmbed = '1';
    box.dataset.provider = info.provider;
    box.dataset.providerLabel = label;
    box.dataset.url = info.url;
    if (info.kind === 'video' || info.needsResolve) {
      const poster = doc.createElement('button');
      poster.type = 'button';
      poster.className = 'gb-web-embed-poster';
      poster.dataset.gbWebEmbedAction = 'load';
      poster.setAttribute('aria-label', info.kind === 'video' ? `${label}の動画を再生` : `${label}のポストを表示`);
      poster.title = info.url;
      if (info.thumbnail) {
        const img = doc.createElement('img');
        img.className = 'gb-web-embed-thumb';
        img.src = info.thumbnail;
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        poster.appendChild(img);
      } else {
        poster.classList.add('is-thumb-missing');
      }
      const play = doc.createElement('span');
      play.className = 'gb-web-embed-play';
      play.setAttribute('aria-hidden', 'true');
      poster.appendChild(play);
      box.appendChild(poster);
    } else {
      box.appendChild(_makeFrame(info, info.src));
    }
    return box;
  }

  function htmlFor(url) {
    const el = buildElement(parse(url));
    return el ? el.outerHTML : '';
  }

  // ノートの1行（Markdown）がURLだけなら埋め込みHTMLを返す。素のURLと [URL](URL) を対象にする。
  function htmlForLine(line) {
    const text = String(line || '').replace(/\x02[^\x02]*\x02/g, '').trim();
    if (!text || text.length > 2100) return '';
    let url = '';
    if (/^https?:\/\/\S+$/i.test(text)) url = text;
    else {
      const m = text.match(/^\[([^\]]+)\]\(<?(https?:\/\/[^\s)>]+)>?\)$/);
      if (m && m[1].trim() === m[2]) url = m[2];
    }
    return url ? htmlFor(url) : '';
  }

  function _blockUrl(block) {
    const text = String(block.textContent || '').trim();
    return /^https?:\/\/\S+$/i.test(text) ? text : '';
  }

  // 編集中の本文（#page-content 等）の直下の行を見て、URLだけの行へ埋め込みを付け、
  // URLが消えた/変わった行から古い埋め込みを外す。保存内容は変わらない。
  function decorate(root) {
    if (!root || !root.children) return 0;
    let changed = 0;
    Array.from(root.children).forEach(block => {
      if (!/^(DIV|P)$/.test(block.tagName) || block.classList.contains('gb-web-embed')) {
        if (block.classList?.contains('gb-web-embed')) { block.remove(); changed += 1; }
        return;
      }
      const existing = Array.from(block.querySelectorAll('.gb-web-embed'));
      const info = block.className && !block.classList.contains('note-status-block') ? null : parse(_blockUrl(block));
      if (info && existing.length === 1 && existing[0].parentElement === block && existing[0].dataset.url === info.url) return;
      existing.forEach(el => { el.remove(); changed += 1; });
      if (!info) return;
      const el = buildElement(info);
      if (el) { block.appendChild(el); changed += 1; }
    });
    return changed;
  }

  // チャット発言: 段落内の対応リンクを段落の直後へ並べる（最大3件・同一URLは1回）。
  function decorateChat(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return 0;
    const seen = new Set();
    let count = 0;
    Array.from(root.querySelectorAll('a[href]')).forEach(link => {
      if (count >= MAX_CHAT_EMBEDS || link.closest('pre,code,.gb-web-embed')) return;
      const info = parse(link.getAttribute('href'));
      if (!info || seen.has(info.url)) return;
      seen.add(info.url);
      const block = link.closest('p,li,blockquote,td') || link.parentElement;
      const el = buildElement(info);
      if (!el || !block) return;
      el.classList.add('gb-web-embed--chat');
      block.insertAdjacentElement('afterend', el);
      count += 1;
    });
    return count;
  }

  async function _resolveBlueskySrc(info) {
    const res = await global.fetch(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(info.actor)}`);
    if (!res.ok) throw new Error('resolve failed');
    const data = await res.json();
    const did = String(data?.did || '');
    if (!/^did:(plc|web):[A-Za-z0-9._:-]{3,200}$/.test(did)) throw new Error('invalid did');
    return `https://embed.bsky.app/embed/${did}/app.bsky.feed.post/${info.id}`;
  }

  async function _load(box) {
    if (!box || box.dataset.gbWebEmbedLoading === '1') return;
    // 属性の埋め込み先は信用せず、元URLから毎回組み立て直す。
    const info = parse(box.dataset.url);
    if (!info) return;
    box.dataset.gbWebEmbedLoading = '1';
    try {
      const src = info.needsResolve ? await _resolveBlueskySrc(info) : info.src;
      box.replaceChildren(_makeFrame(info, src));
      box.classList.add('is-playing');
    } catch (_) {
      box.classList.add('is-failed');
      box.querySelector('.gb-web-embed-poster')?.setAttribute('title', '読み込めませんでした。上のリンクから開いてください');
    } finally {
      delete box.dataset.gbWebEmbedLoading;
    }
  }

  function _frameHeightFromMessage(data) {
    let payload = data;
    if (typeof payload === 'string') {
      if (payload.length > 4000 || payload[0] !== '{') return 0;
      try { payload = JSON.parse(payload); } catch (_) { return 0; }
    }
    if (!payload || typeof payload !== 'object') return 0;
    const tw = payload['twttr.embed'];
    if (tw && tw.method === 'twttr.private.resize' && Array.isArray(tw.params)) return Number(tw.params[0]?.height) || 0;
    if (payload.type === 'MEASURE' && payload.details) return Number(payload.details.height) || 0;
    if (typeof payload.height === 'number') return payload.height;
    return 0;
  }

  function _install() {
    const doc = global.document;
    if (!doc || global.__gbWebEmbedsInstalled) return;
    global.__gbWebEmbedsInstalled = true;
    const activate = (event) => {
      const poster = event.target?.closest?.('.gb-web-embed [data-gb-web-embed-action="load"]');
      if (!poster) return false;
      event.preventDefault();
      event.stopPropagation();
      _load(poster.closest('.gb-web-embed'));
      return true;
    };
    doc.addEventListener('click', activate, true);
    doc.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') activate(event);
    }, true);
    // 編集面でのクリックがキャレット移動・選択に化けないようにする
    doc.addEventListener('mousedown', (event) => {
      if (event.target?.closest?.('.gb-web-embed-poster')) event.preventDefault();
    }, true);
    // サムネイル取得に失敗したらカード表示へ切り替える（オフライン・削除済み動画など）
    doc.addEventListener('error', (event) => {
      const img = event.target;
      if (!img || img.tagName !== 'IMG' || !img.classList?.contains('gb-web-embed-thumb')) return;
      img.closest('.gb-web-embed-poster')?.classList.add('is-thumb-missing');
      img.remove();
    }, true);
    // ポスト埋め込みが通知する高さに合わせる（送信元iframeが本ページの埋め込みである時だけ）
    global.addEventListener('message', (event) => {
      if (!event.source || !/^https:\/\/(platform\.twitter\.com|embed\.bsky\.app|www\.instagram\.com|www\.threads\.(com|net))$/.test(String(event.origin || ''))) return;
      const frame = Array.from(doc.querySelectorAll('.gb-web-embed-frame')).find(f => f.contentWindow === event.source);
      if (!frame || frame.closest('.gb-web-embed--video')) return;
      const height = _frameHeightFromMessage(event.data);
      if (height >= 80) frame.style.height = Math.min(Math.round(height), 2400) + 'px';
    });
    // 編集中のノート本文: URL行の追加・変更・削除へ追従する（入力が落ち着いてから1回）
    let timer = 0;
    let pendingRoot = null;
    doc.addEventListener('input', (event) => {
      const root = event.target?.closest?.('#page-content, #entity-freetext');
      if (!root || !root.isContentEditable) return;
      pendingRoot = root;
      if (timer) global.clearTimeout(timer);
      timer = global.setTimeout(() => {
        timer = 0;
        const target = pendingRoot;
        pendingRoot = null;
        if (target && target.isConnected) decorate(target);
      }, 600);
    }, true);
  }

  const api = { parse, buildElement, htmlFor, htmlForLine, decorate, decorateChat, _frameHeightFromMessage };
  global.GBWebEmbeds = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global.document) _install();
})(typeof window !== 'undefined' ? window : globalThis);
