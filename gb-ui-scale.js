/* gb-ui-scale.js — 表示サイズ（画面全体の拡大率）の決め方を1か所へ集約する。
 *
 * 表示サイズには2つの出どころがある:
 *   - 自動: 初回起動時に端末の画面から決めた値
 *   - 手動: ユーザーが設定ダイアログ / Ctrl+ホイールで選んだ値
 *
 * 自動値だけは判定ルールを見直したときに付け直す必要があり、手動値は絶対に触らない。
 * この2つを区別する記録が無かったため、過去に自動で焼き付いた拡大率が永久に残り、
 * デスクトップ版とクラウド版で同じ100%指定でも大きさが食い違っていた
 * （表示サイズはブラウザのズームとは別レイヤーで掛け算されるため、ブラウザ側を
 *   100%にしても打ち消せない）。
 */
(function (global) {
  'use strict';

  if (global.MeldexUIScale) return;

  const SCALE_KEY = 'ui-scale';
  const SOURCE_KEY = 'ui-scale-source';
  const RULE_KEY = 'ui-scale-auto-rule';

  // 自動判定ルールの版番号。ルールを変えたらここを上げる。過去に自動で決まった値
  // だけが、新しいルールで一度だけ付け直される（手動値は版番号に関係なく不変）。
  const AUTO_RULE_VERSION = 2;

  function _screenMetrics() {
    return {
      width: Number(global.screen && global.screen.width) || 0,
      dpr: Number(global.devicePixelRatio) || 1,
      touch: Number(global.navigator && global.navigator.maxTouchPoints) > 0,
    };
  }

  // 版1（〜v0.7.166）: 4K相当を125%へ拡大していた。移行の判定にだけ使う。
  function _autoScaleRule1(m) {
    if (m.width <= 768) return 100;
    if (m.width <= 1366 && m.touch) return 110;
    if (m.width >= 2560 && m.dpr <= 1.5) return 125;
    return 100;
  }

  // 版2（現行）: 4K相当でも拡大しない。デスクトップ版100%・ブラウザ100%と同じ
  // 大きさで表示されるようにする。タッチ操作の端末だけは押しやすさのため少し広げる。
  function _autoScaleRule2(m) {
    if (m.width <= 768) return 100;
    if (m.width <= 1366 && m.touch) return 110;
    return 100;
  }

  function detectAutoScale(rule) {
    const m = _screenMetrics();
    return (Number(rule) || AUTO_RULE_VERSION) <= 1 ? _autoScaleRule1(m) : _autoScaleRule2(m);
  }

  function _read(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function _write(key, value) {
    // プライベートモード等で保存できない場合でも、表示自体は続行させる
    try { localStorage.setItem(key, String(value)); } catch { /* 保存できなくても表示は継続 */ }
  }

  function markSource(source) {
    if (source !== 'manual' && source !== 'auto') return;
    _write(SOURCE_KEY, source);
    if (source === 'auto') _write(RULE_KEY, AUTO_RULE_VERSION);
  }

  function getSource() {
    const value = _read(SOURCE_KEY);
    return (value === 'manual' || value === 'auto') ? value : '';
  }

  // 出どころが記録される前からある環境の分類。保存値が「当時のルールがこの端末へ
  // 返す値」と完全に一致する場合だけ自動値とみなす。少しでも違えば、ユーザーが
  // 自分で選んだ値として扱い一切触らない。
  function classifyLegacyStoredScale(storedScale) {
    return storedScale === _autoScaleRule1(_screenMetrics()) ? 'auto' : 'manual';
  }

  /**
   * 起動時に適用すべき表示サイズを返す。必要なら保存値の付け直しも行う。
   */
  function resolveStartupScale() {
    const stored = _read(SCALE_KEY);

    if (stored === null) {
      const auto = detectAutoScale(AUTO_RULE_VERSION);
      _write(SCALE_KEY, auto);
      markSource('auto');
      return auto;
    }

    const storedScale = parseInt(stored, 10) || 100;
    let source = getSource();
    if (!source) {
      source = classifyLegacyStoredScale(storedScale);
      _write(SOURCE_KEY, source);
    }
    if (source === 'manual') return storedScale;

    const appliedRule = parseInt(_read(RULE_KEY), 10) || 1;
    if (appliedRule >= AUTO_RULE_VERSION) return storedScale;

    const auto = detectAutoScale(AUTO_RULE_VERSION);
    _write(SCALE_KEY, auto);
    markSource('auto');
    return auto;
  }

  global.MeldexUIScale = {
    AUTO_RULE_VERSION,
    SCALE_KEY,
    SOURCE_KEY,
    RULE_KEY,
    detectAutoScale,
    classifyLegacyStoredScale,
    resolveStartupScale,
    markSource,
    getSource,
  };
})(typeof window !== 'undefined' ? window : globalThis);
