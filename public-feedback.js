(function () {
  'use strict';

  function _setState(node, message, state) {
    if (!node) return;
    node.textContent = message;
    node.dataset.state = state || 'info';
  }

  function _deliveryMessage(delivery) {
    if (delivery?.status === 'sent') {
      return delivery.issueId
        ? `開発者へ送信しました（受付番号: ${delivery.issueId}）。ありがとうございます。`
        : '開発者へ送信しました。ありがとうございます。';
    }
    if (delivery?.status === 'pending') {
      return '通信できないため、このブラウザの送信待ちに保存しました。オンライン復帰後に自動で再送します。';
    }
    return `送信できませんでした。入力内容は残しています。${delivery?.lastError ? ` ${delivery.lastError}` : ''}`;
  }

  function init() {
    const form = document.getElementById('public-feedback-form');
    const status = document.getElementById('public-feedback-status');
    const queueStatus = document.getElementById('public-feedback-queue');
    const submitButton = document.getElementById('public-feedback-submit');
    if (!form || !status || !submitButton) return;

    const runtime = window.MeldexCloudRuntimeConfig || {};
    const config = runtime.debuggerReporting || {};
    const baseUrl = String(config.baseUrl || '').trim().replace(/\/+$/, '');
    const projectSlug = String(config.projectSlug || '').trim();
    const Reporter = window.DebuggerManualReportClient?.ManualReportClient;
    if (typeof Reporter !== 'function' || !baseUrl || !projectSlug) {
      submitButton.disabled = true;
      _setState(status, '現在、送信先を利用できません。Meldex内のフォームをご利用ください。', 'error');
      return;
    }

    let reporter;
    try {
      reporter = new Reporter({
        endpoint: `${baseUrl}/api/v1/public/reports`,
        projectSlug,
        version: String(runtime.version?.semver || 'unknown').slice(0, 100),
        source: 'web',
        component: 'meldex-public-page',
        onDelivery: async (delivery) => {
          _setState(status, _deliveryMessage(delivery), delivery.status === 'sent' ? 'success' : delivery.status);
          const current = reporter?.status?.();
          if (queueStatus && current) {
            queueStatus.textContent = current.pending
              ? `このブラウザの送信待ち: ${current.pending}件`
              : 'このブラウザに送信待ちはありません。';
          }
        },
      });
    } catch (_) {
      submitButton.disabled = true;
      _setState(status, '現在、送信先を利用できません。時間をおいて再度お試しください。', 'error');
      return;
    }
    if (!reporter.configured()) {
      submitButton.disabled = true;
      _setState(status, '現在、送信先を利用できません。時間をおいて再度お試しください。', 'error');
      return;
    }
    reporter.install({ flushWhenOnline: true });
    const initial = reporter.status();
    if (queueStatus) {
      queueStatus.textContent = initial.pending
        ? `このブラウザの送信待ち: ${initial.pending}件（オンライン復帰後に自動再送）`
        : 'このブラウザに送信待ちはありません。';
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const field = name => form.elements.namedItem(name);
      if (field('website')?.value) {
        _setState(status, '送信できませんでした。', 'error');
        return;
      }
      const consent = field('consent');
      if (!consent?.checked) {
        _setState(status, '送信内容の確認にチェックを入れてください。', 'error');
        consent?.focus();
        return;
      }
      const reportType = String(field('reportType')?.value || 'bug');
      const subject = String(field('subject')?.value || '').trim();
      const body = String(field('body')?.value || '').trim();
      const environment = String(field('environment')?.value || '').trim();
      const sections = [`## 件名\n${subject}`, `## 内容\n${body}`];
      if (environment) sections.push(`## 利用環境\n${environment}`);
      sections.push('## 報告経路\nMeldex配布ページ');
      submitButton.disabled = true;
      form.setAttribute('aria-busy', 'true');
      _setState(status, '開発者へ送信しています…', 'pending');
      try {
        const result = await reporter.submit({ reportType, body: sections.join('\n\n') });
        _setState(status, _deliveryMessage(result.delivery), result.delivery?.status === 'sent' ? 'success' : result.delivery?.status || 'error');
        if (result.ok) form.reset();
      } catch (error) {
        _setState(status, `送信できませんでした。入力内容は残しています。 ${error?.message || error}`, 'error');
      } finally {
        submitButton.disabled = false;
        form.removeAttribute('aria-busy');
        const current = reporter.status();
        if (queueStatus) {
          queueStatus.textContent = current.pending
            ? `このブラウザの送信待ち: ${current.pending}件（オンライン復帰後に自動再送）`
            : 'このブラウザに送信待ちはありません。';
        }
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
