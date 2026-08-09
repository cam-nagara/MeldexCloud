/* ==============================
   gb-tool-timer.js: TimerComponent
   ============================== */

class TimerComponent extends ToolComponent {
  constructor(paneId, tabId) {
    super(paneId, tabId);
    this.displayMode = 'digital';
    this.timerRunning = false;
    this.totalSeconds = 300;
    this.elapsed = 0;
    this.countUp = false;
    this.timerStarted = false;
    this.timerStartMs = 0;
    this.elapsedAtStart = 0;
    this._timerInterval = null;
    this._resizeObserver = null;
    this._resizeHandler = null;
    this._drawFrame = null;
    this._drawTimeouts = [];
    this._canvas = null;
    this._ctx = null;
  }

  create() {
    this.el = document.createElement('div');
    this.el.className = 'gb-timer-root';
    this.el.style.cssText = 'display:flex;flex-direction:column;flex:1;height:100%;min-height:0;overflow:hidden;background:var(--timer-bg,var(--content-bg,var(--bg)));color:var(--timer-fg,var(--fg));';
    this.el.innerHTML = `
      <div class="gb-timer-top">
        <div class="gb-timer-toolbar-row gb-timer-toolbar-row--main">
          <div class="gb-timer-inputs">
            <span class="gb-num-unit gb-timer-num-unit"><input class="gb-num-input gb-timer-time-input" data-timer-role="hours" type="number" min="0" max="99" step="1" value="0" aria-label="時間" title="タイマーの時間を0から99で設定します"><span class="unit">時間</span></span>
            <span class="gb-num-unit gb-timer-num-unit"><input class="gb-num-input gb-timer-time-input" data-timer-role="minutes" type="number" min="0" max="59" step="1" value="5" aria-label="分" title="タイマーの分を0から59で設定します"><span class="unit">分</span></span>
            <span class="gb-num-unit gb-timer-num-unit"><input class="gb-num-input gb-timer-time-input" data-timer-role="seconds" type="number" min="0" max="59" step="1" value="0" aria-label="秒" title="タイマーの秒を0から59で設定します"><span class="unit">秒</span></span>
            <button class="tb-icon-btn gb-timer-countup-toggle" data-timer-role="countup" data-timer-action="toggleCountUp" type="button" aria-label="カウントアップ" aria-pressed="false" title="0から設定時間まで計測します">${this._icon('arrowUp', 14)}</button>
          </div>
          <div class="tb-spacer"></div>
          <label class="gb-timer-mode-field" title="タイマーの表示形式を切り替えます">
            <span class="gb-timer-toolbar-label">表示</span>
            <select class="gb-select gb-select-sm gb-timer-mode-select" data-timer-role="displayMode" aria-label="表示モード" title="タイマーの表示形式を選択します">
              <option value="digital">デジタル</option>
              <option value="analog">バー（円形）</option>
              <option value="circle">円形</option>
              <option value="bar">バー</option>
            </select>
          </label>
          <button class="tb-icon-btn gb-timer-settings-btn" data-timer-action="openSettings" type="button" aria-label="タイマー設定" title="カレンダー連動、アラーム、保存済みタイマーを設定します">${this._icon('settings', 14)}</button>
        </div>
        <div class="gb-timer-toolbar-row gb-timer-toolbar-row--controls">
          <button class="gb-btn gb-btn-sm" data-timer-action="start" type="button" title="設定した時間でタイマーを開始します">${this._icon('play', 14)} <span>開始</span></button>
          <button class="gb-btn gb-btn-sm" data-timer-action="pause" type="button" title="動作中のタイマーを一時停止します">${this._icon('pause', 14)} <span>一時停止</span></button>
          <button class="gb-btn gb-btn-sm" data-timer-action="reset" type="button" title="経過時間を0に戻します">${this._icon('rotateCcw', 14)} <span>リセット</span></button>
        </div>
      </div>
      <div class="gb-timer-display" style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;">
        <canvas data-timer-role="canvas" style="position:absolute;inset:0;width:100%;height:100%;display:block;"></canvas>
        <div class="gb-timer-display-readout" data-timer-role="readout">05:00</div>
      </div>`;
    this._canvas = this.el.querySelector('[data-timer-role="canvas"]');
    this._ctx = this._canvas.getContext('2d');
    this._bindEvents();
    this._updateControlButtons();
    this._setupResize();
    this._queueInitialDraws();
    return this.el;
  }

  activate() {
    super.activate();
    this._queueInitialDraws();
  }

  destroy() {
    this._pauseTimer();
    if (this._drawFrame) cancelAnimationFrame(this._drawFrame);
    this._drawFrame = null;
    this._drawTimeouts.forEach(id => clearTimeout(id));
    this._drawTimeouts = [];
    if (this._resizeObserver) this._resizeObserver.disconnect();
    this._resizeObserver = null;
    if (this._resizeHandler) window.removeEventListener('resize', this._resizeHandler);
    this._resizeHandler = null;
    super.destroy();
  }

  getState() {
    this._updateElapsedFromClock();
    return {
      displayMode: this.displayMode,
      totalSeconds: this.totalSeconds,
      elapsed: this.elapsed,
      countUp: this.countUp,
      timerRunning: this.timerRunning,
      timerStarted: this.timerStarted,
      elapsedAtStart: this.elapsedAtStart,
      timerStartMs: this.timerStartMs,
    };
  }

  restoreState(savedState) {
    if (!savedState) return;
    this.displayMode = savedState.displayMode || 'digital';
    this.totalSeconds = Number(savedState.totalSeconds) || 300;
    this.elapsed = Math.max(0, Number(savedState.elapsed) || 0);
    this.countUp = !!savedState.countUp;
    this.timerStarted = !!savedState.timerStarted;
    if (savedState.timerRunning) {
      const now = Date.now();
      const savedElapsedAtStart = Number(savedState.elapsedAtStart);
      const savedStartMs = Number(savedState.timerStartMs);
      this.timerRunning = false;
      this.elapsedAtStart = Number.isFinite(savedElapsedAtStart) ? Math.max(0, savedElapsedAtStart) : this.elapsed;
      this.timerStartMs = Number.isFinite(savedStartMs) && savedStartMs > 0 ? savedStartMs : now;
      const elapsedFromClock = Math.max(0, Math.floor((now - this.timerStartMs) / 1000));
      this.elapsed = Math.min(this.totalSeconds, Math.max(this.elapsed, this.elapsedAtStart + elapsedFromClock));
      this._startTicking();
    } else {
      this.elapsedAtStart = this.elapsed;
      this.timerStartMs = 0;
    }
    this._writeControlsFromState();
    this._updateModeButtons();
    this._drawTimer();
  }

  _icon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size) : '';
  }

  _bindEvents() {
    const modeSelect = this.el.querySelector('[data-timer-role="displayMode"]');
    modeSelect?.addEventListener('change', () => {
      this.displayMode = modeSelect.value || 'digital';
      this._updateModeButtons();
      this._drawTimer();
    });
    this.el.querySelectorAll('[data-timer-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.timerAction;
        if (action === 'start') this._startTimer();
        else if (action === 'pause') this._pauseTimer();
        else if (action === 'reset') this._resetTimer();
        else if (action === 'toggleCountUp') {
          this.countUp = !this.countUp;
          this._writeControlsFromState();
          if (!this.timerRunning) {
            this._readControls();
            this._drawTimer();
          }
        } else if (action === 'openSettings') {
          if (typeof this._timerAdvancedShowSettingsDialog === 'function') this._timerAdvancedShowSettingsDialog();
          else if (typeof showStatus === 'function') showStatus('タイマー設定を開けませんでした', true);
        }
      });
    });
    this.el.querySelectorAll('[data-timer-role="hours"], [data-timer-role="minutes"], [data-timer-role="seconds"]').forEach(input => {
      input.addEventListener('input', () => {
        if (!this.timerRunning) {
          this._readControls();
          this._drawTimer();
        }
      });
      input.addEventListener('change', () => {
        if (!this.timerRunning) {
          this._readControls();
          this._drawTimer();
        }
      });
    });
  }

  _setupResize() {
    const display = this.el.querySelector('.gb-timer-display');
    if (window.ResizeObserver && display) {
      this._resizeObserver = new ResizeObserver(() => this._requestDrawTimer());
      this._resizeObserver.observe(display);
    } else {
      this._resizeHandler = () => this._requestDrawTimer();
      window.addEventListener('resize', this._resizeHandler);
    }
  }

  _requestDrawTimer() {
    if (!this.el || !this._canvas) return;
    if (this._drawFrame) cancelAnimationFrame(this._drawFrame);
    this._drawFrame = requestAnimationFrame(() => {
      this._drawFrame = null;
      this._drawTimer();
    });
  }

  _queueInitialDraws() {
    this._requestDrawTimer();
    [0, 50, 150, 350].forEach(ms => {
      const timeoutId = setTimeout(() => {
        this._drawTimeouts = this._drawTimeouts.filter(id => id !== timeoutId);
        if (this.el?.isConnected) this._drawTimer();
      }, ms);
      this._drawTimeouts.push(timeoutId);
    });
  }

  _readControls() {
    const h = parseInt(this.el.querySelector('[data-timer-role="hours"]')?.value, 10) || 0;
    const m = parseInt(this.el.querySelector('[data-timer-role="minutes"]')?.value, 10) || 0;
    const s = parseInt(this.el.querySelector('[data-timer-role="seconds"]')?.value, 10) || 0;
    this.totalSeconds = Math.max(0, h * 3600 + m * 60 + s);
    const countup = this.el.querySelector('[data-timer-role="countup"]');
    this.countUp = countup?.tagName === 'INPUT' ? !!countup.checked : countup?.getAttribute('aria-pressed') === 'true';
  }

  _writeControlsFromState() {
    const h = Math.floor(this.totalSeconds / 3600);
    const m = Math.floor((this.totalSeconds % 3600) / 60);
    const s = this.totalSeconds % 60;
    const hours = this.el?.querySelector('[data-timer-role="hours"]');
    const minutes = this.el?.querySelector('[data-timer-role="minutes"]');
    const seconds = this.el?.querySelector('[data-timer-role="seconds"]');
    const countup = this.el?.querySelector('[data-timer-role="countup"]');
    if (hours) hours.value = String(h);
    if (minutes) minutes.value = String(m);
    if (seconds) seconds.value = String(s);
    if (countup?.tagName === 'INPUT') countup.checked = this.countUp;
    else if (countup) {
      countup.setAttribute('aria-pressed', this.countUp ? 'true' : 'false');
      countup.classList.toggle('active', this.countUp);
      countup.title = this.countUp ? 'カウントアップ中: 0から設定時間まで計測します' : 'カウントアップに切り替えます';
    }
    this._updateModeButtons();
    this._updateControlButtons();
  }

  _updateModeButtons() {
    const mode = ['digital', 'analog', 'circle', 'bar'].includes(this.displayMode) ? this.displayMode : 'digital';
    this.displayMode = mode;
    const select = this.el?.querySelector('[data-timer-role="displayMode"]');
    if (select && select.value !== mode) select.value = mode;
    this.el?.querySelectorAll('[data-timer-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.timerMode === mode);
    });
  }

  _updateControlButtons() {
    const start = this.el?.querySelector('[data-timer-action="start"]');
    const pause = this.el?.querySelector('[data-timer-action="pause"]');
    if (start) start.disabled = !!this.timerRunning;
    if (pause) pause.disabled = !this.timerRunning;
  }

  _updateElapsedFromClock() {
    if (!this.timerRunning) return;
    this.elapsed = this.elapsedAtStart + Math.floor((Date.now() - this.timerStartMs) / 1000);
  }

  _remainingSeconds() {
    return this.countUp ? this.elapsed : Math.max(0, this.totalSeconds - this.elapsed);
  }

  _formatTime(value) {
    const s = Math.max(0, Math.floor(value));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return (h > 0 ? String(h).padStart(2, '0') + ':' : '') + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  }

  _startTimer() {
    if (this.timerRunning) return;
    const prevTotal = this.totalSeconds;
    const prevCountUp = this.countUp;
    this._readControls();
    if (!this.timerStarted || this.totalSeconds !== prevTotal || this.countUp !== prevCountUp || this.elapsed >= this.totalSeconds) {
      this.elapsed = 0;
    }
    if (this.totalSeconds <= 0) return;
    this.elapsedAtStart = this.elapsed;
    this.timerStartMs = Date.now();
    this._startTicking();
  }

  _startTicking() {
    if (this._timerInterval) clearInterval(this._timerInterval);
    this.timerRunning = true;
    this.timerStarted = true;
    this._updateControlButtons();
    const tick = () => {
      this._updateElapsedFromClock();
      if (this.elapsed >= this.totalSeconds) {
        this.elapsed = this.totalSeconds;
        this._pauseTimer();
        this.timerStarted = false;
        this._notifyDone();
      }
      this._drawTimer();
    };
    this._timerInterval = setInterval(tick, 1000);
    tick();
  }

  _pauseTimer() {
    if (this._timerInterval) clearInterval(this._timerInterval);
    this._timerInterval = null;
    this.timerRunning = false;
    this._updateControlButtons();
  }

  _resetTimer() {
    this._pauseTimer();
    this.elapsed = 0;
    this.timerStarted = false;
    this.elapsedAtStart = 0;
    this.timerStartMs = 0;
    this._updateControlButtons();
    this._drawTimer();
  }

  _notifyDone() {
    try { new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU').play().catch(() => {}); } catch {}
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification('タイマー完了', { body: this._formatTime(this.totalSeconds) + ' 経過' }); } catch {}
    }
    if (typeof showStatus === 'function') showStatus('タイマーが完了しました');
  }

  _drawTimer() {
    if (!this._canvas || !this._ctx) return;
    const display = this.el?.querySelector('.gb-timer-display');
    const rect = display?.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect?.width || 320));
    const h = Math.max(1, Math.floor(rect?.height || 240));
    if (this._canvas.width !== w) this._canvas.width = w;
    if (this._canvas.height !== h) this._canvas.height = h;
    const ctx = this._ctx;
    const remaining = this._remainingSeconds();
    const progress = this.totalSeconds > 0 ? Math.max(0, Math.min(1, this.countUp ? this.elapsed / this.totalSeconds : remaining / this.totalSeconds)) : 0;
    const style = getComputedStyle(document.documentElement);
    const fg = style.getPropertyValue('--fg').trim() || '#d4d4d4';
    const accent = style.getPropertyValue('--accent').trim() || '#569cd6';
    const bg3 = style.getPropertyValue('--bg3').trim() || '#2d2d2d';

    ctx.clearRect(0, 0, w, h);
    this._updateReadout(remaining, w, h);
    if (this.displayMode === 'digital') this._drawDigital(ctx, w, h);
    else if (this.displayMode === 'analog') this._drawAnalog(ctx, w, h, remaining, progress, fg, accent, bg3);
    else if (this.displayMode === 'circle') this._drawCircle(ctx, w, h, remaining, progress, accent, bg3);
    else this._drawBar(ctx, w, h, remaining, progress, fg, accent, bg3);
  }

  _updateReadout(remaining, w, h) {
    const readout = this.el?.querySelector('[data-timer-role="readout"]');
    if (!readout) return;
    const size = Math.max(18, Math.min(72, w / 4.4, h / 1.7));
    readout.textContent = this._formatTime(remaining);
    readout.style.fontSize = `${size}px`;
  }

  _drawDigital(_ctx, _w, _h) {
    // The readout is DOM text so it remains visible even when canvas layout is delayed.
  }

  _drawAnalog(ctx, w, h, remaining, progress, fg, accent, bg3) {
    const r = Math.max(6, Math.min(w, h) * 0.36);
    const cx = w / 2;
    const cy = h / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = bg3;
    ctx.lineWidth = Math.max(1, Math.min(4, r * 0.12));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(2, Math.min(8, r * 0.22));
    ctx.stroke();
    ctx.font = `bold ${Math.max(8, r / 2.5)}px monospace`;
    void remaining;
    void fg;
  }

  _drawCircle(ctx, w, h, remaining, progress, accent, bg3) {
    const r = Math.max(6, Math.min(w, h) * 0.36);
    const cx = w / 2;
    const cy = h / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = bg3;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.closePath();
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.72;
    ctx.fill();
    ctx.globalAlpha = 1;
    void remaining;
  }

  _drawBar(ctx, w, h, remaining, progress, fg, accent, bg3) {
    const barH = Math.max(8, Math.min(56, h / 4));
    const barW = w * 0.82;
    const x = (w - barW) / 2;
    const y = h / 2 - barH / 2;
    ctx.fillStyle = bg3;
    ctx.fillRect(x, y, barW, barH);
    ctx.fillStyle = accent;
    ctx.fillRect(x, y, barW * progress, barH);
    void remaining;
    void fg;
  }
}

function openTimerPanel() {
  if (typeof openToolTab === 'function') {
    openToolTab('timer');
    return;
  }
  if (typeof GBTabs !== 'undefined' && typeof GBLayout !== 'undefined' && GBLayout.root) {
    const existing = typeof GBTabs.findPaneWithTab === 'function' ? GBTabs.findPaneWithTab('timer', '') : null;
    if (existing) {
      GBTabs.activateTab(existing.paneId, existing.tabId);
      return;
    }
    const paneId = GBLayout.activePane || GBLayout.findFirstPane?.(GBLayout.root)?.id;
    if (paneId) {
      GBTabs.addTab(paneId, 'タイマー', 'timer', '');
      return;
    }
  }
  if (typeof showStatus === 'function') showStatus('タイマーパネルを初期化できませんでした', true);
  else console.warn('Timer panel could not be opened: pane system is unavailable');
}

registerToolComponent('timer', { cls: TimerComponent, icon: 'timer', label: 'タイマー', multi: false });
window.openTimerPanel = openTimerPanel;
