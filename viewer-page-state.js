/* Shared, file-scoped viewer preferences and spread geometry. No document reloads. */
(function () {
  'use strict';
  const prefix = 'meldex:viewer-page-state:v1:';
  // 表示モードは「単ページ」「見開き」の2つ、進む方向は別の設定（2026-11-27 利用者の依頼）。
  const MODES = ['single', 'spread'];
  const DIRECTIONS = ['up', 'down', 'left', 'right'];
  // 旧版の保存値（single / spread=見開き_右へ / manga=見開き_左へ）。
  const LEGACY_MODES = ['single', 'spread', 'manga'];
  function read(identity) {
    try { return JSON.parse(localStorage.getItem(prefix + identity) || '{}') || {}; }
    catch (_) { return {}; }
  }
  function write(identity, patch) {
    try {
      localStorage.setItem(prefix + identity, JSON.stringify({ ...read(identity), ...patch }));
      return true;
    } catch (_) { return false; }
  }
  // 見開きで右から左へめくるか。旧値 manga と 進む方向「左へ」が該当する。
  function rightToLeft(mode, direction) {
    return mode === 'manga' || (mode !== 'single' && direction === 'left');
  }
  function leadingBlank(mode, firstSide, direction) {
    return mode !== 'single' && firstSide !== (rightToLeft(mode, direction) ? 'right' : 'left');
  }
  function defaultMode(identity, legacy) {
    if (!LEGACY_MODES.includes(legacy)) return 'single';
    try {
      const key = 'meldex:viewer-page-legacy-owner:v1';
      const owner = localStorage.getItem(key);
      if (!owner) localStorage.setItem(key, identity);
      return !owner || owner === identity ? legacy : 'single';
    } catch (_) { return 'single'; }
  }
  // 保存値を「表示モード＋進む方向」へ読み替える。旧値は同じ見え方へ移し、知らない値は単ページ・右へに戻す。
  function resolve(saved, fallbackMode) {
    const raw = LEGACY_MODES.includes(saved?.mode) ? saved.mode
      : (LEGACY_MODES.includes(fallbackMode) ? fallbackMode : 'single');
    const direction = DIRECTIONS.includes(saved?.direction) ? saved.direction : (raw === 'manga' ? 'left' : 'right');
    return { mode: raw === 'single' ? 'single' : 'spread', direction };
  }
  // 旧版へ戻しても同じ見開きの向きで開けるよう、mode には旧版が読める値を残す。
  function storedMode(mode, direction) {
    if (mode === 'single') return 'single';
    return direction === 'left' ? 'manga' : 'spread';
  }
  function pdfStart(index, mode, firstSide, direction) {
    if (mode === 'single') return index;
    const offset = leadingBlank(mode, firstSide, direction) ? 1 : 0;
    return index < offset ? 0 : offset + Math.floor((index - offset) / 2) * 2;
  }
  // 左右の端のページ送り領域を押した時の向き。矢印キーと同じく進む方向に従う（「左へ」なら左端で次へ、右端で前へ）。
  // 上へ・下へ・右へ は従来どおり左端で前へ、右端で次へ。
  function edgeStep(side, direction) {
    const forwardIsLeft = direction === 'left';
    return (side === 'left') === forwardIsLeft ? 'next' : 'prev';
  }
  window.MeldexViewerPageState = {
    MODES, DIRECTIONS, read, write, leadingBlank, pdfStart, defaultMode, resolve, storedMode, rightToLeft, edgeStep,
  };
})();
