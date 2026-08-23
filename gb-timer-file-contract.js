/* ==============================
   gb-timer-file-contract.js: .mel-timer / .timer.json 共通ファイル契約
   ============================== */
(function (global) {
  'use strict';

  function _plainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function titleFromPath(path) {
    const name = String(path || '').replace(/\\/g, '/').split('/').pop() || 'タイマー';
    return name.replace(/(\.mel-timer|\.timer\.json)$/i, '') || 'タイマー';
  }

  function normalizePayload(value) {
    const payload = _plainObject(value);
    const nestedTimer = _plainObject(payload.timer);
    const timer = Object.keys(nestedTimer).length > 0 ? nestedTimer : payload;
    return {
      payload,
      timer: { ...timer },
      name: String(payload.name || '').trim(),
      style: { ..._plainObject(payload.style) },
    };
  }

  function parse(text) {
    let parsed;
    try {
      parsed = JSON.parse(String(text == null ? '' : text));
    } catch (error) {
      const invalid = new Error('タイマーファイルのJSONを読み取れません');
      invalid.cause = error;
      throw invalid;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('タイマーファイルの内容が不正です');
    }
    return normalizePayload(parsed);
  }

  function build(sourcePayload, timerState, options) {
    const source = _plainObject(sourcePayload);
    const sourceTimer = _plainObject(source.timer);
    const opts = options || {};
    return {
      ...source,
      type: 'meldex-timer',
      version: source.version || 1,
      name: String(opts.name || '').trim() || String(source.name || '').trim() || titleFromPath(opts.path),
      timer: { ...sourceTimer, ..._plainObject(timerState) },
    };
  }

  function stringify(sourcePayload, timerState, options) {
    return JSON.stringify(build(sourcePayload, timerState, options), null, 2) + '\n';
  }

  global.MeldexTimerFileContract = Object.freeze({
    titleFromPath,
    normalizePayload,
    parse,
    build,
    stringify,
  });
})(typeof window !== 'undefined' ? window : globalThis);
