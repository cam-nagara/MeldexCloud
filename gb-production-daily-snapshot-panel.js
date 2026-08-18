/* gb-production-daily-snapshot-panel.js: バージョン管理・カレンダー向け日次記録（production_daily_snapshots）パネル */
(function() {
  'use strict';

  function esc(text) {
    if (text == null) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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
          const endpoint = ws ? `/api/production-management/daily-snapshots?workspace_id=${encodeURIComponent(ws)}` : '/api/production-management/daily-snapshots';
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
      const now = new Date();
      const dateStr = targetDate || now.toISOString().slice(0, 10);
      try {
        if (typeof apiPost === 'function') {
          const res = await apiPost('/api/production-management/daily-snapshots', { target_date: dateStr, workspace_id: workspaceId });
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
      header.innerHTML = `
        <div>
          <strong><span class="gb-icon">📅</span> 制作進行の日次記録</strong>
          <span class="gb-sub-text" style="font-size:12px;color:var(--text-muted, #888);">（過去時点の予定と実績）</span>
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
          if (typeof options.onSelectSnapshot === 'function') {
            options.onSelectSnapshot(snap);
          } else {
            this.showReadOnlySnapshotModal(snap);
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

    showReadOnlySnapshotModal(snapshot) {
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

      const tasksList = snapshot.tasks || [];
      if (tasksList.length === 0) {
        body.innerHTML = '<p style="color:var(--text-muted, #888);">記録されたタスクはありません。</p>';
      } else {
        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.fontSize = '12px';
        table.style.borderCollapse = 'collapse';
        table.innerHTML = `
          <thead>
            <tr style="border-bottom:1px solid var(--border, #ccc);text-align:left;">
              <th style="padding:4px;">タスク</th>
              <th style="padding:4px;">担当者</th>
              <th style="padding:4px;">状況</th>
              <th style="padding:4px;">予定</th>
              <th style="padding:4px;">割当</th>
              <th style="padding:4px;">実績</th>
              <th style="padding:4px;">品質</th>
            </tr>
          </thead>
          <tbody>
            ${tasksList.map(t => `
              <tr style="border-bottom:1px solid var(--border-light, #eee);">
                <td style="padding:4px;">${esc(t.title || t.task_id)}</td>
                <td style="padding:4px;">${esc(t.assignee || '-')}</td>
                <td style="padding:4px;">${esc(t.status || '-')}</td>
                <td style="padding:4px;">${esc(formatTime(t.estimate_seconds))}</td>
                <td style="padding:4px;">${esc(formatTime(t.allocated_seconds))}</td>
                <td style="padding:4px;">${esc(formatTime(t.actual_seconds))}</td>
                <td style="padding:4px;"><span class="gb-quality-badge quality-${esc(t.quality_status)}">${esc(t.quality_status || 'confirmed')}</span></td>
              </tr>
            `).join('')}
          </tbody>
        `;
        body.appendChild(table);
      }

      content.appendChild(body);
      modal.appendChild(content);
      document.body.appendChild(modal);
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
  }

  if (typeof window !== 'undefined') {
    window.MeldexProductionDailySnapshotPanel = MeldexProductionDailySnapshotPanel;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MeldexProductionDailySnapshotPanel;
  }
})();
