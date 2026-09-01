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
        <div class="gb-separator" style="margin:12px 0;"></div>
        <div class="gb-section-title">共有保存用 owner端末</div>
        <div class="gb-section-desc">信頼済みの所有者端末から、5分で失効する一回限りQRを発行します。新端末はMeldexアプリ内の「端末登録QRを読み取る」からだけ読み取ります。</div>
        <div class="gb-section-desc" style="margin-top:6px;">登録先はQR発行元と同じDropbox所有者アカウントの本人端末に限ります。登録端末はowner署名能力を安全領域へ保持します。紛失時は直ちに失効してください。owner鍵をローテーションすると全登録端末が無効になり、再登録が必要です。</div>
        <div class="gb-field-row" style="justify-content:flex-start;margin-top:8px;">
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="webclip-owner-device-issue">端末登録QRを発行</button>
        </div>
        <div data-webclip-owner-device-result role="status" aria-live="polite"></div>
        <div class="gb-separator" style="margin:12px 0;"></div>
        <div class="gb-section-title">登録済み端末</div>
        <div data-webclip-owner-device-list role="region" aria-label="Web Clipper登録済み端末"></div>
      </section>`;
  }

  function confirmAction(message) {
    if (typeof global.cfConfirm === 'function') return global.cfConfirm(message);
    return Promise.resolve(global.confirm(message));
  }

  async function refreshDevices(section) {
    const host = section?.querySelector?.('[data-webclip-owner-device-list]');
    if (!host) return;
    host.textContent = '端末台帳を確認しています…';
    try {
      const rows = await global.MeldexWebClipOwnerDeviceRegistration?.listDevices?.();
      host.replaceChildren();
      if (!rows?.length) {
        host.textContent = '登録済み端末はありません。';
        return;
      }
      rows.forEach(record => {
        const device = record?.payload || {};
        const row = document.createElement('div');
        row.className = 'gb-field-row';
        row.style.cssText = 'align-items:center;gap:8px;margin-top:8px;';
        const detail = document.createElement('div');
        detail.style.flex = '1';
        const title = document.createElement('div');
        title.textContent = String(device.device_name || '名称未設定の端末');
        const meta = document.createElement('div');
        meta.className = 'gb-section-desc';
        const at = device.registered_at ? new Date(device.registered_at).toLocaleString() : '日時不明';
        meta.textContent = device.status === 'revoked' ? `失効済み / 登録 ${at}` : `有効 / 登録 ${at}`;
        detail.append(title, meta);
        row.appendChild(detail);
        if (device.status !== 'revoked') {
          const revoke = document.createElement('button');
          revoke.type = 'button';
          revoke.className = 'gb-btn gb-btn-sm gb-btn-danger';
          revoke.textContent = '失効';
          revoke.dataset.e2eId = 'webclip-owner-device-revoke';
          revoke.addEventListener('click', async () => {
            if (!await confirmAction(`${String(device.device_name || 'この端末')}を失効します。失効後は共有ワークスペースへ保存できません。続けますか？`)) return;
            revoke.disabled = true;
            try {
              await global.MeldexWebClipOwnerDeviceRegistration.revokeDevice(device.device_id);
              await refreshDevices(section);
            } catch (error) {
              meta.textContent = error?.message || '端末を失効できません。台帳を再読込してください。';
              revoke.disabled = false;
            }
          });
          row.appendChild(revoke);
        }
        host.appendChild(row);
      });
    } catch (error) {
      host.textContent = error?.message || '登録済み端末を確認できません。';
    }
  }

  function bind(root) {
    const section = root?.querySelector?.('[data-e2e-id="settings-mobile-webclip"]');
    if (!section || section.dataset.ownerDeviceBound === '1') return;
    section.dataset.ownerDeviceBound = '1';
    const button = section.querySelector('[data-e2e-id="webclip-owner-device-issue"]');
    const result = section.querySelector('[data-webclip-owner-device-result]');
    button?.addEventListener('click', async () => {
      const accepted = await confirmAction('このQRを読み取った本人所有端末には、共有ワークスペースのowner署名能力が安全領域へ登録されます。QRを第三者へ渡さず、表示後5分以内にMeldexアプリ内スキャナで読み取ってください。発行しますか？');
      if (!accepted) return;
      button.disabled = true;
      if (result) result.textContent = '登録QRを発行しています…';
      try {
        const enrollment = await global.MeldexWebClipOwnerDeviceRegistration?.createEnrollment?.();
        if (!enrollment) throw new Error('端末登録機能を読み込めません');
        result.innerHTML = `<div style="max-width:280px;margin-top:10px;">${enrollment.qrSvg}</div><div class="gb-section-desc">有効期限: ${new Date(enrollment.expiresAt).toLocaleString()}</div>`;
      } catch (error) {
        if (result) result.textContent = error?.message || '登録QRを発行できません';
      } finally {
        button.disabled = false;
      }
    });
    refreshDevices(section);
  }

  global.MeldexMobileWebClipSettings = Object.freeze({ render, bind });
})(window);
