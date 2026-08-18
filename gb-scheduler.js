/* gb-scheduler.js — 定期自動実行の周期選択UIウィジェット（表示専用）
   分間隔 / 毎日（時刻） / 毎週（曜日+時刻） / 毎月（日+時刻）

   WebClipper・インポート定期実行計画 2026-08-04「永続スケジューラー」節により、
   実行そのもの（setInterval/setTimeoutでの自己実行）はここでは行わない。
   Meldexを開いている間しか動かないブラウザータイマーは、再起動・スリープ・
   画面未表示・予定の取りこぼしに対応できないため廃止した。
   実行判断と次回予定の計算はバックエンド（meldex_import_scheduler.py）が担い、
   共通API（/api/import-schedules）へ委譲する。本ファイルは周期の選択UIと、
   保存前のプレビュー表示（nextRunText）だけを提供する。
   実際に確定した次回予定・前回結果はバックエンドの応答（next_run_display等）を
   表示すること。 */

(function () {
  'use strict';

  const _DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

  // === スケジュール設定の既定値 ===
  function _defaults() {
    return { type: 'off', interval_minutes: 30, time: '09:00', days_of_week: [1], days_of_month: [1] };
  }

  function normalize(raw) {
    const d = _defaults();
    if (!raw || typeof raw !== 'object') return d;
    return {
      type: ['off', 'interval', 'daily', 'weekly', 'monthly'].includes(raw.type) ? raw.type : 'off',
      interval_minutes: Number(raw.interval_minutes) || d.interval_minutes,
      time: /^\d{2}:\d{2}$/.test(raw.time) ? raw.time : d.time,
      days_of_week: Array.isArray(raw.days_of_week) ? raw.days_of_week.filter(n => n >= 0 && n <= 6) : d.days_of_week,
      days_of_month: Array.isArray(raw.days_of_month) ? raw.days_of_month.filter(n => n >= 1 && n <= 31) : d.days_of_month,
    };
  }

  // === 次回実行日時の計算 ===
  function _parseTime(timeStr) {
    const [h, m] = (timeStr || '09:00').split(':').map(Number);
    return { h: h || 0, m: m || 0 };
  }

  function nextRunDate(config) {
    const c = normalize(config);
    const now = new Date();
    if (c.type === 'off') return null;
    if (c.type === 'interval') return new Date(now.getTime() + c.interval_minutes * 60000);

    const { h, m } = _parseTime(c.time);

    if (c.type === 'daily') {
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      return next;
    }

    if (c.type === 'weekly') {
      const days = c.days_of_week.length ? [...c.days_of_week].sort((a, b) => a - b) : [1];
      for (let offset = 0; offset < 8; offset++) {
        const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, h, m, 0);
        if (candidate > now && days.includes(candidate.getDay())) return candidate;
      }
      const first = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, h, m, 0);
      while (!days.includes(first.getDay())) first.setDate(first.getDate() + 1);
      return first;
    }

    if (c.type === 'monthly') {
      const dates = c.days_of_month.length ? [...c.days_of_month].sort((a, b) => a - b) : [1];
      for (let monthOffset = 0; monthOffset < 2; monthOffset++) {
        const year = now.getFullYear();
        const month = now.getMonth() + monthOffset;
        for (const day of dates) {
          const candidate = new Date(year, month, day, h, m, 0);
          if (candidate.getMonth() === ((now.getMonth() + monthOffset) % 12) && candidate > now) return candidate;
        }
      }
      return new Date(now.getFullYear(), now.getMonth() + 2, dates[0], h, m, 0);
    }
    return null;
  }

  function nextRunText(config) {
    const c = normalize(config);
    if (c.type === 'off') return '手動のみ';
    if (c.type === 'interval') {
      if (c.interval_minutes < 60) return `${c.interval_minutes}分ごと`;
      if (c.interval_minutes % 60 === 0) return `${c.interval_minutes / 60}時間ごと`;
      return `${c.interval_minutes}分ごと`;
    }
    const timeStr = c.time || '09:00';
    if (c.type === 'daily') return `毎日 ${timeStr}`;
    if (c.type === 'weekly') {
      const dayNames = (c.days_of_week || []).sort((a, b) => a - b).map(d => _DAY_LABELS[d]).join('・');
      return `毎週${dayNames} ${timeStr}`;
    }
    if (c.type === 'monthly') {
      const dateNames = (c.days_of_month || []).sort((a, b) => a - b).map(d => `${d}日`).join('・');
      return `毎月${dateNames} ${timeStr}`;
    }
    return '';
  }

  // === UI ウィジェット ===
  function createWidget(container, config, onChange) {
    if (!container) return;
    const c = normalize(config);
    // E2E/UI監査用の安定識別子。ホスト側の data-e2e-id（例: notion-sync-schedule-0）を
    // 接頭辞に継承し、無ければ汎用の gb-scheduler を使う
    const idBase = (container.dataset && container.dataset.e2eId) || 'gb-scheduler';

    const wrap = document.createElement('div');
    wrap.className = 'gb-scheduler-widget';

    const typeRow = document.createElement('div');
    typeRow.className = 'gb-scheduler-row';

    const typeLabel = document.createElement('span');
    typeLabel.className = 'gb-scheduler-label';
    typeLabel.textContent = '自動実行:';

    const typeSelect = document.createElement('select');
    typeSelect.className = 'gb-select gb-select-sm gb-scheduler-type';
    typeSelect.dataset.e2eId = idBase + '-type';
    typeSelect.setAttribute('aria-label', '自動実行の種別');
    [
      { value: 'off', label: '手動のみ' },
      { value: 'interval', label: '間隔（分/時間）' },
      { value: 'daily', label: '毎日（時刻指定）' },
      { value: 'weekly', label: '毎週（曜日指定）' },
      { value: 'monthly', label: '毎月（日付指定）' },
    ].forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      if (o.value === c.type) opt.selected = true;
      typeSelect.appendChild(opt);
    });

    typeRow.appendChild(typeLabel);
    typeRow.appendChild(typeSelect);
    wrap.appendChild(typeRow);

    const detailBox = document.createElement('div');
    detailBox.className = 'gb-scheduler-detail';
    wrap.appendChild(detailBox);

    const summaryEl = document.createElement('div');
    summaryEl.className = 'gb-scheduler-summary gb-section-desc';
    wrap.appendChild(summaryEl);

    const statusEl = document.createElement('div');
    statusEl.className = 'gb-scheduler-status gb-section-desc';
    statusEl.dataset.e2eId = idBase + '-status';
    wrap.appendChild(statusEl);

    function getCurrentConfig() {
      const type = typeSelect.value;
      const result = { type };
      if (type === 'interval') {
        const sel = detailBox.querySelector('.gb-scheduler-interval');
        result.interval_minutes = Number(sel?.value) || 30;
      }
      if (['daily', 'weekly', 'monthly'].includes(type)) {
        const timeInput = detailBox.querySelector('.gb-scheduler-time');
        result.time = timeInput?.value || '09:00';
      }
      if (type === 'weekly') {
        result.days_of_week = [];
        detailBox.querySelectorAll('.gb-scheduler-dow:checked').forEach(cb => {
          result.days_of_week.push(Number(cb.value));
        });
        if (!result.days_of_week.length) result.days_of_week = [1];
      }
      if (type === 'monthly') {
        const input = detailBox.querySelector('.gb-scheduler-dom');
        result.days_of_month = (input?.value || '1').split(/[,、\s]+/)
          .map(s => parseInt(s, 10)).filter(n => n >= 1 && n <= 31);
        if (!result.days_of_month.length) result.days_of_month = [1];
      }
      return normalize(result);
    }

    function fireChange() {
      const cfg = getCurrentConfig();
      summaryEl.textContent = nextRunText(cfg);
      if (typeof onChange === 'function') onChange(cfg);
    }

    function renderDetail(type) {
      detailBox.innerHTML = '';
      if (type === 'off') {
        summaryEl.textContent = nextRunText({ type: 'off' });
        return;
      }

      if (type === 'interval') {
        const sel = document.createElement('select');
        sel.className = 'gb-select gb-select-sm gb-scheduler-interval';
        sel.dataset.e2eId = idBase + '-interval';
        sel.setAttribute('aria-label', '実行間隔');
        [5, 10, 15, 30, 60, 120, 360, 720, 1440].forEach(v => {
          const opt = document.createElement('option');
          opt.value = v;
          opt.textContent = v < 60 ? `${v}分` : `${v / 60}時間`;
          if (v === c.interval_minutes) opt.selected = true;
          sel.appendChild(opt);
        });
        sel.addEventListener('change', fireChange);
        detailBox.appendChild(sel);
      }

      if (['daily', 'weekly', 'monthly'].includes(type)) {
        const timeInput = document.createElement('input');
        timeInput.type = 'time';
        timeInput.className = 'gb-input gb-scheduler-time';
        timeInput.dataset.e2eId = idBase + '-time';
        timeInput.setAttribute('aria-label', '実行時刻');
        timeInput.value = c.time || '09:00';
        timeInput.addEventListener('change', fireChange);
        detailBox.appendChild(timeInput);
      }

      if (type === 'weekly') {
        const dowRow = document.createElement('div');
        dowRow.className = 'gb-scheduler-dow-row';
        _DAY_LABELS.forEach((label, i) => {
          const lbl = document.createElement('label');
          lbl.className = 'gb-scheduler-dow-label';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.className = 'gb-scheduler-dow';
          cb.dataset.e2eId = idBase + '-dow-' + i;
          cb.setAttribute('aria-label', label + '曜日に実行');
          cb.value = i;
          cb.checked = (c.days_of_week || []).includes(i);
          cb.addEventListener('change', fireChange);
          lbl.appendChild(cb);
          lbl.appendChild(document.createTextNode(label));
          dowRow.appendChild(lbl);
        });
        detailBox.appendChild(dowRow);
      }

      if (type === 'monthly') {
        const domInput = document.createElement('input');
        domInput.type = 'text';
        domInput.className = 'gb-input gb-scheduler-dom';
        domInput.dataset.e2eId = idBase + '-dom';
        domInput.setAttribute('aria-label', '実行する日付（カンマ区切り）');
        domInput.placeholder = '例: 1, 15';
        domInput.value = (c.days_of_month || [1]).join(', ');
        domInput.addEventListener('change', fireChange);
        detailBox.appendChild(domInput);
      }

      summaryEl.textContent = nextRunText(getCurrentConfig());
    }

    typeSelect.addEventListener('change', () => {
      Object.assign(c, _defaults(), { type: typeSelect.value });
      renderDetail(typeSelect.value);
      fireChange();
    });

    renderDetail(c.type);

    container.innerHTML = '';
    container.appendChild(wrap);
    return {
      getCurrentConfig,
      // バックエンドが確定した次回予定・前回結果を表示する（保存直後や
      // 一覧再読み込み時に、ローカル計算のプレビューではなく信頼できる値へ
      // 差し替えるために使う）。文字列以外を渡すと表示をクリアする。
      setStatusText(text) {
        statusEl.textContent = typeof text === 'string' ? text : '';
      },
    };
  }

  // === CSS ===
  function _injectCSS() {
    if (document.getElementById('gb-scheduler-css')) return;
    const style = document.createElement('style');
    style.id = 'gb-scheduler-css';
    style.textContent = `
      .gb-scheduler-widget { display:flex; flex-direction:column; gap:6px; }
      .gb-scheduler-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .gb-scheduler-label { font-size:12px; color:var(--fg2); white-space:nowrap; min-width:60px; }
      .gb-scheduler-detail { display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-height:0; }
      .gb-scheduler-detail:empty { display:none; }
      .gb-scheduler-summary { font-size:11px; color:var(--fg2); margin:0; }
      .gb-scheduler-status { font-size:11px; color:var(--fg2); margin:0; }
      .gb-scheduler-status:empty { display:none; }
      .gb-scheduler-time { width:100px; font-size:12px; padding:2px 4px; }
      .gb-scheduler-dom { width:120px; font-size:12px; padding:2px 4px; }
      .gb-scheduler-dow-row { display:flex; gap:2px; flex-wrap:wrap; }
      .gb-scheduler-dow-label { display:inline-flex; align-items:center; gap:2px; font-size:11px; color:var(--fg);
        padding:2px 5px; border:1px solid var(--border); border-radius:3px; cursor:pointer; user-select:none; }
      .gb-scheduler-dow-label:has(:checked) { background:var(--accent); color:var(--bg); border-color:var(--accent); }
      .gb-scheduler-dow { display:none; }
    `;
    document.head.appendChild(style);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _injectCSS);
  } else {
    _injectCSS();
  }

  window.MeldexScheduler = { normalize, nextRunDate, nextRunText, createWidget };
})();
