/* ==============================
   gb-production-external-sync-cloud.js: 制作管理「外部カレンダーへ送信」のCloud対応（Google送信のみ）

   制作管理UX改善計画（2026-08-04）§4-4。Phase 5 のCloud外部カレンダー連携基盤
   （gb-cal-oauth-browser.js のブラウザ完結PKCE認証、接続中のDropboxワークスペース内
   `_calendar/google_calendar_auth.json` へのトークン保存。gb-cal-cloud-sync.js が
   個人カレンダーの双方向同期のために書き込む場所と同一）に乗る。CalDAV送信
   （ローカルサーバー常駐が必要）はDesktop限定のまま。ここではGoogle分のみ扱う。

   このファイルは gb-cal-cloud-sync.js を直接編集しない（別レーンの成果物のため）。
   トークン読み書きは同じ _calendar/google_calendar_auth.json を対象に、必要な最小限を
   ここへ複製する（gb-production-recalc-engine-cloud-adapter.js が
   RECALC_INTERNAL_METADATA_PROPERTIES を複製するのと同じ方針）。

   送信対象: 正本『スタッフ管理シート』で「同期有効」かつ「外部カレンダーURL（Google）」が
   設定されているスタッフの production-task イベント + 勤務シフト（type=work）イベント
   （Desktop meldex_production_external_sync._production_external_events と同じ抽出条件）。
   Googleイベントの id は Desktop _google_event_id と同一アルゴリズム（uuid5(NAMESPACE_URL,
   raw).hex、RFC 4122のSHA-1ベース名前空間UUID）のJS実装で決定的に作る（コミット前レビュー
   指摘 #9）。同一スタッフ・同一タスクをDesktop/Cloudどちらから送信しても同じGoogleイベント
   IDになるため、再送信は新規作成ではなく上書き更新になり、Google側への二重登録を防ぐ
   （両実装比較テストで同一IDを保証する。test_meldex_production_external_sync_uuid5_parity.py
   参照）。
   ============================== */
(function () {
  'use strict';

  const CAL_DIR = '_calendar';
  const GOOGLE_AUTH_FILE = 'google_calendar_auth.json';
  const TOKEN_EARLY_REFRESH_MS = 60 * 1000;

  function _oauth() {
    const api = window.MeldexCalOAuthBrowser;
    if (!api) throw new Error('gb-cal-oauth-browser.js が読み込まれていません');
    return api;
  }

  function _authPath(internals) {
    return internals._joinPath(CAL_DIR, GOOGLE_AUTH_FILE);
  }

  async function _readAuth(provider, internals) {
    return (await internals._readJsonSafe(provider, _authPath(internals), null)) || null;
  }

  async function _writeAuth(provider, internals, payload) {
    await internals._directoryHandle(provider, CAL_DIR, true);
    await provider.writeJson(_authPath(internals), payload);
  }

  // gb-cal-cloud-sync.js の _googleAccessToken と同じ意味論（早期リフレッシュ・失効時の
  // 再認証導線）。未接続/失効時は例外を投げずnullを返す（呼び出し元が「案内」を返せるように）。
  async function _accessToken(provider, internals) {
    const auth = await _readAuth(provider, internals);
    if (!auth?.refresh_token) return null;
    if (auth.access_token && Number(auth.expires_at || 0) > Date.now() + TOKEN_EARLY_REFRESH_MS) return auth;
    try {
      const refreshed = await _oauth().google.refreshToken({
        refreshToken: auth.refresh_token, clientId: auth.client_id, clientSecret: auth.client_secret,
      });
      const next = {
        ...auth,
        access_token: refreshed.access_token,
        expires_at: Date.now() + Math.max(60, Number(refreshed.expires_in || 3600)) * 1000,
        refresh_token: refreshed.refresh_token || auth.refresh_token,
      };
      await _writeAuth(provider, internals, next);
      return next;
    } catch {
      await _writeAuth(provider, internals, { ...auth, access_token: '', refresh_token: '', expires_at: 0 }).catch(() => {});
      return null;
    }
  }

  // Desktop _google_calendar_id と同じ抽出規則（?src=/?cid= クエリ、無ければ末尾セグメント）。
  function googleCalendarIdFromUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      const src = url.searchParams.get('src') || url.searchParams.get('cid');
      if (src) return decodeURIComponent(src).trim();
      const tail = url.pathname.split('/').filter(Boolean).pop();
      if (tail) return decodeURIComponent(tail).trim();
    } catch { /* raw自体をカレンダーIDとして扱う（URL形式でない直接指定） */ }
    return raw;
  }

  async function _loadEnabledStaff() {
    const registry = window.MeldexUserRegistry;
    if (!registry?.listStaff) return [];
    let rows = [];
    try { rows = await registry.listStaff({ force: true }); } catch { rows = []; }
    return (rows || [])
      .filter(row => row && row.sync_enabled && String(row.user || '').trim())
      .map(row => ({ name: String(row.user).trim(), google_url: String(row.google_url || '').trim() }));
  }

  function _withinRange(event, dateFrom, dateTo) {
    if (dateFrom && String(event.end || event.start || '') < dateFrom) return false;
    if (dateTo) {
      const upper = /^\d{4}-\d{2}-\d{2}$/.test(dateTo) ? dateTo + 'T23:59:59' : dateTo;
      if (String(event.start || '') > upper) return false;
    }
    return true;
  }

  // Desktop _production_external_events と同じ抽出条件（production-task 全件 + 勤務シフトのみ）。
  async function _staffEvents(provider, internals, deps, staffName, dateFrom, dateTo) {
    const events = await deps.readCalendarStore(provider, internals, 'events');
    const shifts = await deps.readCalendarStore(provider, internals, 'shifts').catch(() => []);
    const workShiftIds = new Set((shifts || []).filter(s => (s?.type || 'work') === 'work').map(s => String(s?.id || '')));
    return (events || []).filter(event => {
      if (String(event?.user || '') !== staffName) return false;
      const source = String(event?.calendar_source || '');
      if (source === 'production-task') return _withinRange(event, dateFrom, dateTo);
      if (source === 'shift' && workShiftIds.has(String(event?.external_id || ''))) return _withinRange(event, dateFrom, dateTo);
      return false;
    });
  }

  // コミット前レビュー指摘 #9: Desktop _google_event_id と同一アルゴリズムのuuid5(SHA-1
  // ベースの名前空間UUID、RFC 4122)実装。Python uuid.NAMESPACE_URL は仕様で固定された
  // 16バイト値（6ba7b811-9dad-11d1-80b4-00c04fd430c8）なのでここに複製する。
  const UUID_NAMESPACE_URL_BYTES = new Uint8Array([
    0x6b, 0xa7, 0xb8, 0x11, 0x9d, 0xad, 0x11, 0xd1,
    0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30, 0xc8,
  ]);

  function _bytesToHex(bytes) {
    return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Python uuid.uuid5(namespace, name).hex のJS実装。RFC 4122: SHA-1(namespace || name) の
  // 先頭16バイトに対しversion(5)・variant(RFC 4122)ビットを立てて32桁16進文字列にする。
  async function _uuid5Hex(namespaceBytes, name) {
    const nameBytes = new TextEncoder().encode(name);
    const combined = new Uint8Array(namespaceBytes.length + nameBytes.length);
    combined.set(namespaceBytes, 0);
    combined.set(nameBytes, namespaceBytes.length);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', combined));
    const bytes = digest.slice(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
    return _bytesToHex(bytes);
  }

  async function _googleEventId(staffName, event) {
    const raw = `production-google:${staffName}:${event?.id || event?.external_id || event?.title || ''}`;
    return 'm' + (await _uuid5Hex(UUID_NAMESPACE_URL_BYTES, raw));
  }

  // gb-cal-cloud-sync.js の _localAllDayEndToGoogle と同じ意味論（排他的終了日+1日）を複製する。
  function _localAllDayEndToGoogleDate(startIso, endIso) {
    const dateOnly = value => String(value || '').slice(0, 10);
    const addDays = (dateStr, days) => {
      const parts = dateOnly(dateStr).split('-').map(Number);
      if (parts.length !== 3 || parts.some(n => Number.isNaN(n))) return dateStr;
      const utc = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
      utc.setUTCDate(utc.getUTCDate() + days);
      return utc.toISOString().slice(0, 10);
    };
    const base = endIso || startIso;
    const startDay = dateOnly(startIso);
    let endDay = dateOnly(base);
    if (endDay < startDay) endDay = startDay;
    return addDays(endDay, 1);
  }

  function _googleEventBody(eventId, staffName, event) {
    const withSeconds = value => (String(value || '').length === 16 ? value + ':00' : value);
    const body = {
      id: eventId,
      summary: event.title || '無題',
      description: `${event.description || ''}\nMeldex 制作管理`,
      extendedProperties: {
        private: { meldexSource: event.calendar_source || '', meldexEventId: event.id || '', meldexStaff: staffName },
      },
    };
    if (event.location) body.location = event.location;
    if (Number(event.all_day)) {
      body.start = { date: String(event.start || '').slice(0, 10) };
      body.end = { date: _localAllDayEndToGoogleDate(event.start, event.end || event.start) };
    } else {
      const now = new Date().toISOString();
      body.start = { dateTime: withSeconds(event.start) || now, timeZone: 'Asia/Tokyo' };
      body.end = { dateTime: withSeconds(event.end || event.start) || now, timeZone: 'Asia/Tokyo' };
    }
    return body;
  }

  async function _pushEvent(accessToken, calendarId, body) {
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
    const updateResponse = await fetch(`${base}/${encodeURIComponent(body.id)}`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (updateResponse.ok) return 'updated';
    const insertResponse = await fetch(base, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!insertResponse.ok) {
      const detail = await insertResponse.json().catch(() => null);
      const error = new Error(detail?.error?.message || `Google APIエラー(${insertResponse.status})`);
      error.status = insertResponse.status;
      throw error;
    }
    return 'pushed';
  }

  // deps は gb-production-management.part02.js の _pmRecalcEngineDeps() をそのまま渡せる
  // （readCalendarStore だけを使う）。
  async function syncGoogle(provider, internals, deps, body) {
    const dateFrom = String(body?.date_from || '').trim();
    const dateTo = String(body?.date_to || '').trim();
    const result = { ok: true, staff: 0, events: 0, caldav_synced: 0, google_pushed: 0, google_updated: 0, skipped: 0, cloud: true };
    const auth = await _accessToken(provider, internals);
    if (!auth?.access_token) {
      return { ...result, message: 'Googleカレンダー連携を設定してください' };
    }
    const staffRows = await _loadEnabledStaff();
    for (const staff of staffRows) {
      const calendarId = googleCalendarIdFromUrl(staff.google_url);
      if (!calendarId) { result.skipped += 1; continue; }
      const events = await _staffEvents(provider, internals, deps, staff.name, dateFrom, dateTo);
      result.staff += 1;
      result.events += events.length;
      for (const event of events) {
        const eventId = await _googleEventId(staff.name, event);
        const googleBody = _googleEventBody(eventId, staff.name, event);
        const outcome = await _pushEvent(auth.access_token, calendarId, googleBody);
        if (outcome === 'updated') result.google_updated += 1; else result.google_pushed += 1;
      }
    }
    return result;
  }

  window.MeldexProductionExternalSyncCloud = Object.freeze({
    syncGoogle,
    googleCalendarIdFromUrl,
    // Desktop/Cloud のGoogleイベントID決定的生成が一致することを確認するテスト用に公開
    // （コミット前レビュー指摘 #9。test_meldex_production_external_sync_uuid5_parity.py）。
    googleEventId: _googleEventId,
  });
})();
