/**
 * Settings copy for the native iPhone, iPad, and Android Web Clipper.
 * Store links are intentionally omitted until signed public builds exist.
 */
(function attachMobileWebClipSettings(global) {
  'use strict';

  function render() {
    return `
      <section class="gb-section gb-section--boxed" data-settings-view="web-clipper" data-e2e-id="settings-mobile-webclip">
        <div class="gb-section-title">モバイル版（iPhone・iPad・Android）</div>
        <div class="gb-section-desc">
          Safari・Chromeなどの共有からMeldexへ送ると、ページ本文を取得してDropboxの「Web Clipper」へ保存します。
          Safariでは表示中のページを優先し、その他のブラウザでは共有されたURLをMeldexが開き直して取得します。
        </div>
        <div class="gb-section-desc" style="margin-top:8px;">
          ログインが必要なページや取得を拒否するページは、本文の一部またはURLのみの保存になります。画像とPDFも共有できます。
        </div>
      </section>`;
  }

  global.MeldexMobileWebClipSettings = Object.freeze({ render });
})(window);
