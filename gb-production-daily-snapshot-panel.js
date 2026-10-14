/* gb-production-daily-snapshot-panel.js: バージョン管理・カレンダー向け日次記録（production_daily_snapshots）パネル */
(function() {
  'use strict';

  function esc(text) {
    return MeldexEscape.html(text);
  }

  // 品質状態のユーザー向け表示語（コード上の識別子をそのまま出さない）
  const QUALITY_LABELS = {
    confirmed: '確定',
    incomplete: '打刻不足',
    conflict: '要確認',
    'legacy-manual': '手入力',
    unmeasured: '未計測',
  };

  // 端末の暦日（YYYY-MM-DD）。UTC基準のtoISOStringだと日本時間の午前中に前日扱いになる。
  function todayString() {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }

  function currentBusinessDate(cutoff = '04:00') {
    const now = new Date();
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(cutoff || '04:00').trim());
    const cutoffMinutes = match ? Number(match[1]) * 60 + Number(match[2]) : 240;
    if (now.getHours() * 60 + now.getMinutes() < cutoffMinutes) now.setDate(now.getDate() - 1);
    const pad = value => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  async function automaticStorageReady() {
    const runtime = window.MeldexRuntimeAdapter;
    if (!runtime?.isBrowserDataMode?.()) return true;

    const mode = String(runtime.getMode?.() || '');
    const workspaceState = runtime.getWorkspaceState?.();
    if (!workspaceState || String(workspaceState.kind || '') !== mode) return false;
    if (workspaceState.access === 'viewer' || document.body?.dataset?.cloudReadonly === '1') return false;

    if (runtime.isDropboxMode?.()) {
      const session = await window.MeldexDropboxAuth?.getSession?.().catch(() => null);
      if (!session?.refreshToken) return false;
    }
    return true;
  }

  function formatTime(seconds) {
    if (window.MeldexProductionTimeFormatter?.formatDuration) {
      return window.MeldexProductionTimeFormatter.formatDuration(seconds);
    }
    const s = Number(seconds) || 0;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0 && m > 0) return `${h}時間${m}分`;
    if (h > 0) return `${h}時間`;
    return `${m}分`;
  }

  class MeldexProductionDailySnapshotPanel {
    constructor(options = {}) {
      const defaultProvider = options.provider || (typeof window !== 'undefined' ? (window.meldexFileProvider || window.fileProvider || (window.app && window.app.provider) || (typeof meldexProvider !== 'undefined' ? meldexProvider : null)) : null);
      if (options.store) {
        this.store = options.store;
      } else if (typeof window !== 'undefined' && window.MeldexProductionDailySnapshotStore) {
        this.store = new window.MeldexProductionDailySnapshotStore({ provider: defaultProvider });
      } else {
        this.store = null;
      }
      this.engine = options.engine || (typeof window !== 'undefined' && window.MeldexProductionDailySnapshotEngine ? new window.MeldexProductionDailySnapshotEngine({ snapshotStore: this.store }) : null);
    }

    async fetchSnapshotsFromApi(workspaceId = 'default') {
      try {
        if (typeof apiFetch === 'function') {
          const ws = String(workspaceId || 'default').trim();
          const endpoint = ws ? `/production-management/daily-snapshots?workspace_id=${encodeURIComponent(ws)}` : '/production-management/daily-snapshots';
          const res = await apiFetch(endpoint);
          if (res && res.ok && Array.isArray(res.snapshots)) {
            if (this.store) {
              for (const snap of res.snapshots) {
                if (snap && snap.target_date) {
                  await this.store.saveSnapshot(workspaceId, snap.target_date, snap);
                }
              }
            }
            return res.snapshots;
          } else {
            const msg = res?.error || '日次スナップショットの取得に失敗しました';
            if (typeof showStatus === 'function') showStatus(msg, true);
          }
        } else if (this.store && typeof this.store.loadFromProvider === 'function') {
          const loadRes = await this.store.loadFromProvider(workspaceId);
          if (loadRes && !loadRes.ok) {
            if (typeof showStatus === 'function') showStatus(`日次スナップショット読込エラー: ${loadRes.error}`, true);
          }
        }
      } catch (err) {
        if (typeof showStatus === 'function') showStatus(`日次スナップショット読込エラー: ${err?.message || err}`, true);
      }
      return this.store ? this.store.listSnapshots(workspaceId) : [];
    }

    async createSnapshotViaApi(targetDate = '', workspaceId = 'default') {
      const dateStr = targetDate || todayString();
      try {
        if (typeof apiPost === 'function') {
          const res = await apiPost('/production-management/daily-snapshots', { target_date: dateStr, workspace_id: workspaceId });
          if (res && res.ok && res.snapshot) {
            if (this.store) await this.store.saveSnapshot(workspaceId, dateStr, res.snapshot);
            if (typeof showStatus === 'function') showStatus('日次スナップショットを記録しました');
            return res.snapshot;
          } else {
            const msg = res?.error || '日次スナップショットの保存に失敗しました';
            if (typeof showStatus === 'function') showStatus(msg, true);
          }
        } else if (this.store && this.engine) {
          const built = this.engine.buildDailySnapshot({ workspace_id: workspaceId, target_date: dateStr });
          const saveRes = await this.store.saveSnapshot(workspaceId, dateStr, built);
          if (saveRes && saveRes.ok) {
            if (typeof showStatus === 'function') showStatus('日次スナップショットを記録しました');
            return saveRes.snapshot;
          } else {
            const msg = saveRes?.error || '日次スナップショットの保存に失敗しました';
            if (typeof showStatus === 'function') showStatus(msg, true);
          }
        }
      } catch (err) {
        if (typeof showStatus === 'function') showStatus(`日次スナップショット保存エラー: ${err?.message || err}`, true);
      }
      return null;
    }

    _buildSnapshotListDom(container, snapshots, options) {
      if (!container) return null;
      container.replaceChildren();

      const wrap = document.createElement('div');
      wrap.className = 'gb-production-daily-snapshot-list';
      wrap.dataset.e2eId = 'gb-production-daily-snapshot-list';

      const header = document.createElement('div');
      header.className = 'gb-production-snapshot-header';
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'center';
      // 説明はツールチップへ集約する（基本UIに長文を置かない）
      header.innerHTML = `
        <div style="display:inline-flex;align-items:center;gap:4px;min-width:0;">
          <strong><span class="gb-icon">📅</span> 制作進行の日次記録</strong>
          ${typeof fieldHelp === 'function' ? fieldHelp('過去のある日の割当（カレンダーの予定枠）と実績を、読み取り専用で確認できます。「本日分を記録」で今日の状態を1日分として残せます') : ''}
        </div>
      `;

      const createBtn = document.createElement('button');
      createBtn.type = 'button';
      createBtn.className = 'gb-btn gb-btn-sm gb-btn-primary';
      createBtn.dataset.e2eId = 'gb-production-create-daily-snapshot-btn';
      createBtn.textContent = '本日分を記録';
      createBtn.addEventListener('click', async () => {
        createBtn.disabled = true;
        createBtn.textContent = '記録中...';
        await this.createSnapshotViaApi('', options?.workspaceId || 'default');
        createBtn.disabled = false;
        createBtn.textContent = '本日分を記録';
        this.renderSnapshotList(container, options);
      });
      header.appendChild(createBtn);
      wrap.appendChild(header);

      if (!snapshots || snapshots.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'gb-empty-state';
        empty.style.padding = '12px 8px';
        empty.style.color = 'var(--text-muted, #888)';
        empty.textContent = '保存された日次スナップショットはありません。';
        wrap.appendChild(empty);
        container.appendChild(wrap);
        return wrap;
      }

      const listEl = document.createElement('div');
      listEl.className = 'gb-snapshot-items';
      listEl.style.display = 'flex';
      listEl.style.flexDirection = 'column';
      listEl.style.gap = '6px';
      listEl.style.marginTop = '8px';

      snapshots.slice().reverse().forEach(snap => {
        const item = document.createElement('div');
        item.className = 'gb-snapshot-item';
        item.dataset.e2eId = `snapshot-item-${snap.target_date}`;
        item.dataset.targetDate = snap.target_date;
        item.style.border = '1px solid var(--border, #ccc)';
        item.style.borderRadius = '4px';
        item.style.padding = '6px 8px';
        item.style.cursor = 'pointer';
        item.style.background = 'var(--bg-card, rgba(0,0,0,0.02))';

        const taskCount = snap.tasks?.length || 0;
        const totalEst = snap.tasks?.reduce((sum, t) => sum + (t.estimate_seconds || 0), 0) || 0;
        const totalAct = snap.tasks?.reduce((sum, t) => sum + (t.actual_seconds || 0), 0) || 0;

        item.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>${esc(snap.target_date)}</strong>
            <span class="gb-badge" style="font-size:11px;padding:1px 4px;border-radius:3px;background:var(--accent-subtle, #e0f0ff);color:var(--accent, #0066cc);">
              ${taskCount}タスク
            </span>
          </div>
          <div style="font-size:12px;color:var(--text-muted, #666);margin-top:2px;">
            予定: ${esc(formatTime(totalEst))} / 実績: ${esc(formatTime(totalAct))}
          </div>
        `;

        item.addEventListener('click', () => {
          const compareSnapshot = this._compareTarget(snapshots);
          if (typeof options.onSelectSnapshot === 'function') {
            options.onSelectSnapshot(snap, compareSnapshot);
          } else {
            this.showReadOnlySnapshotModal(snap, Object.assign({}, options, { compareSnapshot }));
          }
        });

        listEl.appendChild(item);
      });

      wrap.appendChild(listEl);
      container.appendChild(wrap);
      return wrap;
    }

    renderSnapshotList(container, options = {}) {
      if (!container) return null;
      const workspaceId = options.workspaceId || 'default';
      const initialSnapshots = this.store ? this.store.listSnapshots(workspaceId) : [];
      const wrap = this._buildSnapshotListDom(container, initialSnapshots, options);

      // API非同期更新
      if (typeof apiFetch === 'function' && options.fetch !== false) {
        this.fetchSnapshotsFromApi(workspaceId).then(apiSnaps => {
          if (apiSnaps && apiSnaps.length > 0) {
            this._buildSnapshotListDom(container, apiSnaps, options);
          }
        }).catch(err => {
          if (typeof showStatus === 'function') showStatus(`日次スナップショット取得エラー: ${err?.message || err}`, true);
        });
      }

      return wrap;
    }

    showReadOnlySnapshotModal(snapshot, options = {}) {
      if (!snapshot) return;
      const modal = document.createElement('div');
      modal.className = 'gb-modal gb-production-snapshot-modal';
      modal.dataset.e2eId = 'gb-production-snapshot-modal';
      modal.style.position = 'fixed';
      modal.style.top = '0';
      modal.style.left = '0';
      modal.style.width = '100vw';
      modal.style.height = '100vh';
      modal.style.background = 'rgba(0,0,0,0.5)';
      modal.style.display = 'flex';
      modal.style.alignItems = 'center';
      modal.style.justifyContent = 'center';
      modal.style.zIndex = '9999';

      const content = document.createElement('div');
      content.className = 'gb-modal-content';
      content.style.background = 'var(--bg-main, #fff)';
      content.style.borderRadius = '8px';
      content.style.width = '90%';
      content.style.maxWidth = '640px';
      content.style.maxHeight = '80vh';
      content.style.overflow = 'auto';
      content.style.padding = '16px';

      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'center';
      header.style.borderBottom = '1px solid var(--border, #ccc)';
      header.style.paddingBottom = '8px';
      header.innerHTML = `
        <div>
          <strong style="font-size:16px;">制作日次記録（${esc(snapshot.target_date)}）</strong>
          <span style="display:inline-block;margin-left:8px;font-size:11px;padding:2px 6px;background:#e2e8f0;border-radius:4px;">読み取り専用</span>
        </div>
      `;

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'gb-btn gb-btn-sm';
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', () => modal.remove());
      header.appendChild(closeBtn);
      content.appendChild(header);

      const body = document.createElement('div');
      body.style.marginTop = '12px';
      this.renderDayView(body, snapshot, options);

      content.appendChild(body);
      modal.appendChild(content);
      document.body.appendChild(modal);
    }

    // ==== 読み取り専用の日次ビュー（予定枠と実績区間を重ねた過去カレンダー） ====

    // 差分の相手（当日の記録。無ければ最新の記録）を選ぶ
    _compareTarget(snapshots) {
      const list = (snapshots || []).filter(s => s && s.target_date);
      if (!list.length) return null;
      const sorted = list.slice().sort((a, b) => String(a.target_date).localeCompare(String(b.target_date)));
      const today = todayString();
      return sorted.find(s => s.target_date === today) || sorted[sorted.length - 1] || null;
    }

    _dayWindow(snapshot) {
      const date = String((snapshot && snapshot.target_date) || '').trim();
      const cutoff = String((snapshot && snapshot.day_cutoff) || '04:00').trim();
      const m = /^(\d{1,2}):(\d{2})$/.exec(cutoff);
      const h = m ? Number(m[1]) : 4;
      const min = m ? Number(m[2]) : 0;
      const startMs = new Date(date + 'T00:00:00').getTime() + ((h * 60 + min) * 60000);
      if (!Number.isFinite(startMs)) return null;
      return { startMs, endMs: startMs + 24 * 3600000, cutoffHour: h, cutoffMinute: min };
    }

    _intervalGeometry(win, startStr, endStr) {
      if (!win) return null;
      const startMs = new Date(String(startStr || '')).getTime();
      if (!Number.isFinite(startMs)) return null;
      const rawEndMs = endStr ? new Date(String(endStr)).getTime() : NaN;
      const open = !Number.isFinite(rawEndMs);
      const endMs = open ? win.endMs : rawEndMs;
      const from = Math.max(win.startMs, Math.min(startMs, win.endMs));
      const to = Math.max(win.startMs, Math.min(endMs, win.endMs));
      if (to <= from) return null;
      const span = win.endMs - win.startMs;
      return {
        left: ((from - win.startMs) / span) * 100,
        width: Math.max(((to - from) / span) * 100, 0.6),
        open,
      };
    }

    _appendAxis(container, win) {
      const axis = document.createElement('div');
      axis.className = 'gb-production-day-axis';
      axis.style.position = 'relative';
      axis.style.height = '16px';
      axis.style.borderBottom = '1px solid var(--border, #ccc)';
      // 狭いパネルでも目盛りが重ならないよう6時間刻みにする
      for (let i = 0; i <= 24; i += 6) {
        const tick = document.createElement('span');
        tick.style.position = 'absolute';
        tick.style.left = ((i / 24) * 100) + '%';
        tick.style.fontSize = '10px';
        tick.style.color = 'var(--text-muted, #888)';
        tick.style.transform = i === 0 ? 'none' : (i === 24 ? 'translateX(-100%)' : 'translateX(-50%)');
        const hour = (win.cutoffHour + i) % 24;
        tick.textContent = String(hour).padStart(2, '0') + '時';
        axis.appendChild(tick);
      }
      container.appendChild(axis);
    }

    _appendTaskRow(container, win, task) {
      // 狭いパネル（バージョン管理パネル）でも時間帯が潰れないよう、
      // 「名前＋実績」を1行目、時間帯を2行目に置く
      const row = document.createElement('div');
      row.className = 'gb-production-day-row';
      row.dataset.e2eId = 'gb-production-day-row-' + (task.task_id || '');
      row.style.padding = '4px 0';

      const head = document.createElement('div');
      head.style.display = 'flex';
      head.style.alignItems = 'baseline';
      head.style.justifyContent = 'space-between';
      head.style.gap = '8px';

      const label = document.createElement('div');
      label.style.flex = '1 1 auto';
      label.style.minWidth = '0';
      label.style.fontSize = '12px';
      label.style.overflow = 'hidden';
      label.style.textOverflow = 'ellipsis';
      label.style.whiteSpace = 'nowrap';
      label.title = (task.title || task.task_id || '') + ' / ' + (task.assignee || '担当者未設定') + ' / ' + (task.status || '');
      label.textContent = task.title || task.task_id || '(名称なし)';
      const meta = document.createElement('span');
      meta.style.color = 'var(--text-muted, #888)';
      meta.style.fontSize = '11px';
      meta.style.marginLeft = '6px';
      meta.textContent = [task.assignee || '担当者なし', task.status || ''].filter(Boolean).join('・');
      label.appendChild(meta);
      head.appendChild(label);

      const track = document.createElement('div');
      track.className = 'gb-production-day-track';
      track.style.position = 'relative';
      track.style.height = '18px';
      track.style.marginTop = '2px';
      track.style.background = 'var(--bg-subtle, rgba(128,128,128,0.08))';
      track.style.borderRadius = '3px';

      (task.scheduled_slots || []).forEach(slot => {
        const geo = this._intervalGeometry(win, slot.start, slot.end);
        if (!geo) return;
        const bar = document.createElement('div');
        bar.className = 'gb-production-day-slot';
        bar.dataset.e2eId = 'gb-production-day-slot';
        bar.style.position = 'absolute';
        bar.style.left = geo.left + '%';
        bar.style.width = geo.width + '%';
        bar.style.top = '1px';
        bar.style.height = '16px';
        bar.style.border = '1px solid var(--accent, #0066cc)';
        bar.style.borderRadius = '3px';
        bar.style.background = 'transparent';
        bar.title = '割当（予定枠）: ' + (slot.start || '') + ' 〜 ' + (slot.end || '');
        track.appendChild(bar);
      });

      (task.day_sessions || []).forEach(sess => {
        const geo = this._intervalGeometry(win, sess.started_at, sess.ended_at);
        if (!geo) return;
        const bar = document.createElement('div');
        bar.className = 'gb-production-day-session';
        bar.dataset.e2eId = 'gb-production-day-session';
        bar.style.position = 'absolute';
        bar.style.left = geo.left + '%';
        bar.style.width = geo.width + '%';
        bar.style.top = '5px';
        bar.style.height = '8px';
        bar.style.borderRadius = '2px';
        bar.style.background = 'var(--accent, #0066cc)';
        const who = sess.participant_display_name || sess.participant_user_id || '';
        if (geo.open) {
          bar.style.opacity = '0.55';
          bar.style.backgroundImage = 'repeating-linear-gradient(45deg, rgba(255,255,255,0.6) 0 3px, transparent 3px 6px)';
          bar.title = '実績: ' + who + ' ' + (sess.started_at || '') + ' 〜（終了打刻なし・未確定）';
        } else {
          bar.title = '実績: ' + who + ' ' + (sess.started_at || '') + ' 〜 ' + (sess.ended_at || '');
        }
        track.appendChild(bar);
      });

      const value = document.createElement('div');
      value.style.flex = '0 0 auto';
      value.style.fontSize = '12px';
      value.style.textAlign = 'right';
      value.style.whiteSpace = 'nowrap';
      value.textContent = '実績 ' + formatTime(task.actual_seconds);
      if (task.quality_status && task.quality_status !== 'confirmed') {
        const badge = document.createElement('span');
        badge.className = 'gb-quality-badge quality-' + task.quality_status;
        badge.style.marginLeft = '6px';
        badge.style.fontSize = '11px';
        badge.textContent = QUALITY_LABELS[task.quality_status] || task.quality_status;
        if (task.quality_reason) badge.title = task.quality_reason;
        value.appendChild(badge);
      }
      head.appendChild(value);
      row.appendChild(head);
      row.appendChild(track);

      container.appendChild(row);
    }

    _appendDiffSection(container, snapshot, compareSnapshot) {
      const section = document.createElement('div');
      section.className = 'gb-production-day-diff';
      section.dataset.e2eId = 'gb-production-day-diff';
      section.style.marginTop = '14px';
      section.style.borderTop = '1px solid var(--border, #ccc)';
      section.style.paddingTop = '8px';
      section.style.fontSize = '12px';

      const title = document.createElement('strong');
      title.textContent = compareSnapshot
        ? '当日（' + compareSnapshot.target_date + '）との差分'
        : '当日との差分';
      section.appendChild(title);

      const listEl = document.createElement('div');
      listEl.style.marginTop = '4px';
      listEl.style.display = 'flex';
      listEl.style.flexDirection = 'column';
      listEl.style.gap = '2px';

      const addLine = text => {
        const line = document.createElement('div');
        line.style.color = 'var(--text-muted, #666)';
        line.textContent = text;
        listEl.appendChild(line);
      };

      if (!compareSnapshot) {
        addLine('本日の記録がまだないため差分を出せません（「本日分を記録」で作成できます）。');
      } else if (compareSnapshot.target_date === snapshot.target_date) {
        addLine('これが最新の記録です。');
      } else {
        const byId = new Map();
        (compareSnapshot.tasks || []).forEach(t => byId.set(String(t.task_id || ''), t));
        let changes = 0;
        (snapshot.tasks || []).forEach(past => {
          const key = String(past.task_id || '');
          const now = byId.get(key);
          const name = past.title || past.task_id || '(名称なし)';
          if (!now) {
            addLine(name + ': 当日の記録にはありません');
            changes += 1;
            return;
          }
          byId.delete(key);
          const parts = [];
          [['予定', 'estimate_seconds'], ['割当', 'allocated_seconds'], ['実績', 'actual_seconds']].forEach(pair => {
            const delta = (Number(now[pair[1]]) || 0) - (Number(past[pair[1]]) || 0);
            if (delta !== 0) parts.push(pair[0] + ' ' + (delta > 0 ? '+' : '−') + formatTime(Math.abs(delta)));
          });
          if ((now.status || '') !== (past.status || '')) parts.push('状況 ' + (past.status || '-') + '→' + (now.status || '-'));
          if ((now.deadline || '') !== (past.deadline || '')) parts.push('締切 ' + (past.deadline || '-') + '→' + (now.deadline || '-'));
          if (parts.length) {
            addLine(name + ': ' + parts.join(' / '));
            changes += 1;
          }
        });
        byId.forEach(now => {
          addLine((now.title || now.task_id || '(名称なし)') + ': この日より後に追加されました');
          changes += 1;
        });
        if (!changes) addLine('この日から変わった項目はありません。');
      }

      section.appendChild(listEl);
      container.appendChild(section);
    }

    renderDayView(container, snapshot, options = {}) {
      if (!container) return null;
      container.replaceChildren();
      const view = document.createElement('div');
      view.className = 'gb-production-day-view';
      view.dataset.e2eId = 'gb-production-day-view';
      view.dataset.targetDate = String((snapshot && snapshot.target_date) || '');

      const head = document.createElement('div');
      head.style.display = 'flex';
      head.style.alignItems = 'center';
      head.style.gap = '8px';
      head.style.marginBottom = '8px';
      if (typeof options.onBack === 'function') {
        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'gb-btn gb-btn-xs';
        back.dataset.e2eId = 'gb-production-day-view-back';
        back.textContent = '← 一覧へ戻る';
        back.addEventListener('click', () => options.onBack());
        head.appendChild(back);
      }
      const heading = document.createElement('strong');
      heading.textContent = '制作日次記録（' + ((snapshot && snapshot.target_date) || '') + '）';
      head.appendChild(heading);
      const ro = document.createElement('span');
      ro.className = 'gb-badge';
      ro.style.fontSize = '11px';
      ro.textContent = '読み取り専用';
      head.appendChild(ro);
      view.appendChild(head);

      const tasks = Array.isArray(snapshot && snapshot.tasks) ? snapshot.tasks : [];
      const sum = key => tasks.reduce((acc, t) => acc + (Number(t[key]) || 0), 0);
      const totals = document.createElement('div');
      totals.dataset.e2eId = 'gb-production-day-totals';
      totals.style.fontSize = '12px';
      totals.style.color = 'var(--text-muted, #666)';
      totals.style.marginBottom = '6px';
      totals.textContent = '予定作業時間 ' + formatTime(sum('estimate_seconds'))
        + ' ／ 割当作業時間 ' + formatTime(sum('allocated_seconds'))
        + ' ／ 実績作業時間 ' + formatTime(sum('actual_seconds'));
      view.appendChild(totals);

      if (!tasks.length) {
        const empty = document.createElement('div');
        empty.style.color = 'var(--text-muted, #888)';
        empty.textContent = '記録されたタスクはありません。';
        view.appendChild(empty);
      } else {
        const win = this._dayWindow(snapshot);
        if (win) {
          this._appendAxis(view, win);
          tasks.forEach(task => this._appendTaskRow(view, win, task));
          const legend = document.createElement('div');
          legend.style.marginTop = '6px';
          legend.style.fontSize = '11px';
          legend.style.color = 'var(--text-muted, #888)';
          legend.textContent = '枠線＝割当（カレンダーの予定枠）／塗り＝実績（勤務外・離席を除いた実作業）／斜線＝終了打刻なし';
          view.appendChild(legend);
        } else {
          const broken = document.createElement('div');
          broken.style.color = 'var(--text-muted, #888)';
          broken.textContent = '日付を読み取れないため時間帯を表示できません。';
          view.appendChild(broken);
        }
      }

      this._appendDiffSection(view, snapshot, options.compareSnapshot || null);
      container.appendChild(view);
      return view;
    }

    static open(options = {}) {
      const panel = new MeldexProductionDailySnapshotPanel(options);
      const modal = document.createElement('div');
      modal.className = 'gb-modal gb-production-snapshot-main-modal';
      modal.dataset.e2eId = 'gb-production-snapshot-main-modal';
      modal.style.position = 'fixed';
      modal.style.top = '0';
      modal.style.left = '0';
      modal.style.width = '100vw';
      modal.style.height = '100vh';
      modal.style.background = 'rgba(0,0,0,0.5)';
      modal.style.display = 'flex';
      modal.style.alignItems = 'center';
      modal.style.justifyContent = 'center';
      modal.style.zIndex = '9998';

      const content = document.createElement('div');
      content.className = 'gb-modal-content';
      content.style.background = 'var(--bg-main, #fff)';
      content.style.borderRadius = '8px';
      content.style.width = '90%';
      content.style.maxWidth = '680px';
      content.style.maxHeight = '85vh';
      content.style.overflow = 'auto';
      content.style.padding = '16px';

      const closeHeader = document.createElement('div');
      closeHeader.style.display = 'flex';
      closeHeader.style.justifyContent = 'flex-end';
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'gb-btn gb-btn-sm';
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', () => modal.remove());
      closeHeader.appendChild(closeBtn);
      content.appendChild(closeHeader);

      const listContainer = document.createElement('div');
      content.appendChild(listContainer);
      modal.appendChild(content);
      document.body.appendChild(modal);

      panel.renderSnapshotList(listContainer, options);
      return modal;
    }

    static async ensureCurrentBusinessDaySnapshot(options = {}) {
      if (typeof apiFetch !== 'function' || typeof apiPost !== 'function') return { ok: false, skipped: true };
      const automatic = options.automatic === true;
      if (automatic && !await automaticStorageReady()) {
        return { ok: false, skipped: true, reason: 'storage-not-ready' };
      }
      const requestOptions = automatic ? { silentError: true } : undefined;
      try {
        const status = await apiFetch('/production-management/status', requestOptions);
        if (!status?.ok || !status.ready) return { ok: false, skipped: true, reason: 'production-not-ready' };
        const workspaceState = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || {};
        const workspaceId = String(
          options.workspaceId || workspaceState.workspaceId || workspaceState.workspace_id || 'default',
        ).trim() || 'default';
        const targetDate = currentBusinessDate(options.dayCutoff || '04:00');
        const existing = await apiFetch(
          `/production-management/daily-snapshots?workspace_id=${encodeURIComponent(workspaceId)}&target_date=${encodeURIComponent(targetDate)}`,
          requestOptions,
        );
        if (!existing?.ok) return existing || { ok: false };
        if (existing.snapshot) return { ok: true, snapshot: existing.snapshot, replayed: true };
        return apiPost('/production-management/daily-snapshots', {
          workspace_id: workspaceId,
          target_date: targetDate,
          day_cutoff: options.dayCutoff || '04:00',
          only_if_missing: true,
        }, requestOptions);
      } catch (error) {
        if (automatic) return { ok: false, skipped: true, reason: 'automatic-check-failed' };
        throw error;
      }
    }
  }

  if (typeof window !== 'undefined') {
    window.MeldexProductionDailySnapshotPanel = MeldexProductionDailySnapshotPanel;
    let automaticDailyPromise = null;
    const ensureDaily = () => {
      if (automaticDailyPromise) return automaticDailyPromise;
      automaticDailyPromise = MeldexProductionDailySnapshotPanel
        .ensureCurrentBusinessDaySnapshot({ automatic: true })
        .catch(error => console.warn('[production-daily-snapshot] automatic snapshot failed:', error))
        .finally(() => { automaticDailyPromise = null; });
      return automaticDailyPromise;
    };
    const bootDaily = () => {
      window.setTimeout(ensureDaily, 3000);
      if (!window.__meldexProductionDailySnapshotTimer) {
        window.__meldexProductionDailySnapshotTimer = window.setInterval(ensureDaily, 15 * 60 * 1000);
      }
    };
    if (typeof document !== 'undefined'
        && typeof window.setTimeout === 'function'
        && typeof window.setInterval === 'function'
        && !(typeof module !== 'undefined' && module.exports)) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootDaily, { once: true });
      else bootDaily();
      document.addEventListener('meldex:mode-changed', ensureDaily);
      document.addEventListener('meldex:production-management-started', ensureDaily);
    }
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MeldexProductionDailySnapshotPanel;
  }
})();
