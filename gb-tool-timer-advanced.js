/* ==============================
   gb-tool-timer-advanced.js: Timer panel automation and presets
   ============================== */

(() => {
  if (typeof TimerComponent === 'undefined') return;

  const SETTINGS_KEY = 'gb:timer-advanced-settings';
  const PRESETS_KEY = 'gb:timer-presets';
  const SEQUENCE_KEY = 'gb:timer-sequence';
  const TIMER_HISTORY_SCOPE = 'timer:settings';
  const CALENDAR_POLL_MS = 30000;
  const CALENDAR_START_WINDOW_MS = 120000;
  const DEFAULT_SETTINGS = Object.freeze({
    calendarEnabled: false,
    calendarId: '',
    alarmSound: 'beep',
    alarmVolume: 70,
    countdownEnabled: true,
    countdownVoice: false,
    countdownEvery10: true,
    countdownEvery5: false,
    countdownLast10: true,
    repeatSingle: false,
    repeatList: false,
  });

  function _timerReadJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '');
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function _timerWriteJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function _timerStorageHistoryKeys(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    return [...new Set(list.filter(Boolean))];
  }

  function _timerCaptureStorageHistory(keys) {
    if (typeof captureLocalStorageSettings !== 'function') return null;
    if (typeof isLocalStorageSettingsHistorySuppressed === 'function'
      && isLocalStorageSettingsHistorySuppressed()) return null;
    return captureLocalStorageSettings(_timerStorageHistoryKeys(keys));
  }

  function _timerStorageHistoryDetail(keys) {
    const labels = {
      [SETTINGS_KEY]: '拡張設定',
      [PRESETS_KEY]: '保存済みタイマー',
      [SEQUENCE_KEY]: '実行リスト',
    };
    return _timerStorageHistoryKeys(keys).map(key => labels[key] || key).join(' / ');
  }

  function _timerRefreshPanelsAfterHistory(keys) {
    const changed = new Set(_timerStorageHistoryKeys(keys));
    if (typeof forEachComponent !== 'function') return;
    forEachComponent(component => {
      if (!component || !(component instanceof TimerComponent)) return;
      if (typeof component._timerAdvancedReloadFromStorage === 'function') {
        component._timerAdvancedReloadFromStorage(changed);
      }
    });
  }

  function _timerPushStorageHistory(label, beforeSnapshot, keys, detail) {
    if (!beforeSnapshot || typeof historyPush !== 'function'
      || typeof captureLocalStorageSettings !== 'function'
      || typeof restoreLocalStorageSettings !== 'function'
      || typeof _normalizeLocalStorageSettingsSnapshots !== 'function') return false;
    const keyList = _timerStorageHistoryKeys(keys);
    const snapshots = _normalizeLocalStorageSettingsSnapshots(beforeSnapshot, captureLocalStorageSettings(keyList));
    let beforeKey = '';
    let afterKey = '';
    try {
      beforeKey = JSON.stringify(snapshots.before);
      afterKey = JSON.stringify(snapshots.after);
    } catch {}
    if (beforeKey && beforeKey === afterKey) return false;
    historyPush(
      label || 'タイマー: 設定変更',
      () => restoreLocalStorageSettings(snapshots.before, _timerRefreshPanelsAfterHistory),
      () => restoreLocalStorageSettings(snapshots.after, _timerRefreshPanelsAfterHistory),
      TIMER_HISTORY_SCOPE,
      detail || _timerStorageHistoryDetail(keyList)
    );
    return true;
  }

  function _timerId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function _timerEsc(value) {
    return typeof esc === 'function' ? esc(value) : String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]);
  }

  function _timerIcon(name, size = 14) {
    return typeof lucide === 'function' ? lucide(name, size) : '';
  }

  function _timerClampInt(value, min, max, fallback) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function _timerConfirm(message) {
    if (typeof cfConfirm === 'function') return cfConfirm(message);
    return Promise.resolve(window.confirm(message));
  }

  function _timerUser() {
    try { return JSON.parse(localStorage.getItem('meldex-user') || '{}').name || 'anonymous'; } catch { return 'anonymous'; }
  }

  function _timerLocalDateTime(date) {
    const d = date || new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }

  function _timerFormatHuman(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const parts = [];
    if (h) parts.push(`${h}時間`);
    if (m) parts.push(`${m}分`);
    if (sec || !parts.length) parts.push(`${sec}秒`);
    return parts.join('');
  }

  function _timerNormalizeSettings(raw) {
    const next = { ...DEFAULT_SETTINGS, ...(raw || {}) };
    next.alarmVolume = _timerClampInt(next.alarmVolume, 0, 100, DEFAULT_SETTINGS.alarmVolume);
    ['calendarEnabled', 'countdownEnabled', 'countdownVoice', 'countdownEvery10', 'countdownEvery5', 'countdownLast10', 'repeatSingle', 'repeatList']
      .forEach(key => { next[key] = !!next[key]; });
    next.calendarId = String(next.calendarId || '');
    next.alarmSound = ['none', 'beep', 'chime', 'bell'].includes(next.alarmSound) ? next.alarmSound : DEFAULT_SETTINGS.alarmSound;
    return next;
  }

  function _timerNormalizeItem(item, fallbackName) {
    const seconds = Math.max(1, Number(item?.totalSeconds) || 300);
    return {
      id: item?.id || _timerId('timer'),
      name: String(item?.name || fallbackName || 'タイマー'),
      totalSeconds: seconds,
      countUp: false,
      displayMode: ['digital', 'analog', 'circle', 'bar'].includes(item?.displayMode) ? item.displayMode : 'digital',
      alarmSound: ['none', 'beep', 'chime', 'bell'].includes(item?.alarmSound) ? item.alarmSound : undefined,
      countdownEnabled: item?.countdownEnabled === undefined ? undefined : !!item.countdownEnabled,
      countdownVoice: item?.countdownVoice === undefined ? undefined : !!item.countdownVoice,
      countdownEvery10: item?.countdownEvery10 === undefined ? undefined : !!item.countdownEvery10,
      countdownEvery5: item?.countdownEvery5 === undefined ? undefined : !!item.countdownEvery5,
      countdownLast10: item?.countdownLast10 === undefined ? undefined : !!item.countdownLast10,
      sourcePresetId: item?.sourcePresetId ? String(item.sourcePresetId) : '',
    };
  }

  function _timerReadItems(key) {
    const raw = _timerReadJson(key, []);
    return Array.isArray(raw) ? raw.map((item, idx) => _timerNormalizeItem(item, `タイマー ${idx + 1}`)) : [];
  }

  function _timerStartOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function _timerEndOfDay(date) {
    const d = _timerStartOfDay(date);
    d.setDate(d.getDate() + 1);
    return d;
  }

  const baseCreate = TimerComponent.prototype.create;
  TimerComponent.prototype.create = function() {
    const el = baseCreate.call(this);
    this._timerAdvancedInit();
    this._timerAdvancedMount();
    this._timerAdvancedSyncControls();
    this._timerAdvancedReconcileCalendarPolling();
    return el;
  };

  const baseDestroy = TimerComponent.prototype.destroy;
  TimerComponent.prototype.destroy = function() {
    this._timerAdvancedStopCalendarPolling?.();
    this._timerAdvancedCancelSequence?.();
    this._timerAdvancedCloseSettingsDialog?.();
    baseDestroy.call(this);
  };

  const baseActivate = TimerComponent.prototype.activate;
  TimerComponent.prototype.activate = function() {
    baseActivate.call(this);
    if (typeof historySetScope === 'function') historySetScope(TIMER_HISTORY_SCOPE);
  };

  const baseGetState = TimerComponent.prototype.getState;
  TimerComponent.prototype.getState = function() {
    return {
      ...baseGetState.call(this),
      advancedSettings: this._timerAdvancedSettings || _timerNormalizeSettings(_timerReadJson(SETTINGS_KEY, DEFAULT_SETTINGS)),
      activeTimerLabel: this._timerAdvancedActiveLabel || '',
    };
  };

  const baseRestoreState = TimerComponent.prototype.restoreState;
  TimerComponent.prototype.restoreState = function(savedState) {
    baseRestoreState.call(this, savedState);
    if (savedState?.advancedSettings) {
      this._timerAdvancedSettings = _timerNormalizeSettings({ ...this._timerAdvancedSettings, ...savedState.advancedSettings });
      this._timerAdvancedSaveSettings({ skipHistory: true });
    }
    this._timerAdvancedActiveLabel = savedState?.activeTimerLabel || this._timerAdvancedActiveLabel || '';
    this._timerAdvancedSyncControls?.();
    this._timerAdvancedReconcileCalendarPolling?.();
  };

  const baseStartTicking = TimerComponent.prototype._startTicking;
  TimerComponent.prototype._startTicking = function() {
    const fresh = !this.timerStarted || this.elapsed <= 0;
    if (fresh) this._timerAdvancedResetCountdownState();
    baseStartTicking.call(this);
  };

  const baseUpdateElapsed = TimerComponent.prototype._updateElapsedFromClock;
  TimerComponent.prototype._updateElapsedFromClock = function() {
    baseUpdateElapsed.call(this);
    this._timerAdvancedCheckCountdown?.();
  };

  const baseResetTimer = TimerComponent.prototype._resetTimer;
  TimerComponent.prototype._resetTimer = function() {
    this._timerAdvancedCancelSequence?.();
    baseResetTimer.call(this);
    this._timerAdvancedActiveLabel = '';
    this._timerAdvancedResetCountdownState();
    this._timerAdvancedSyncControls?.();
  };

  TimerComponent.prototype._timerAdvancedInit = function() {
    this._timerAdvancedSettings = _timerNormalizeSettings(_timerReadJson(SETTINGS_KEY, DEFAULT_SETTINGS));
    this._timerPresets = _timerReadItems(PRESETS_KEY);
    this._timerSequence = _timerReadItems(SEQUENCE_KEY);
    this._timerCalendars = [];
    this._timerCalendarStartedKeys = this._timerCalendarStartedKeys || new Set();
    this._timerAdvancedCountdownKeys = new Set();
    this._timerAdvancedPreviousRemaining = null;
    this._timerAdvancedSequenceRunning = false;
    this._timerAdvancedSequenceIndex = -1;
    this._timerAdvancedDragIndex = -1;
    this._timerAdvancedActiveLabel = this._timerAdvancedActiveLabel || '';
  };

  TimerComponent.prototype._timerAdvancedReloadFromStorage = function(changedKeys) {
    const changed = changedKeys instanceof Set ? changedKeys : new Set(changedKeys || []);
    if (changed.has(SETTINGS_KEY)) {
      this._timerAdvancedSettings = _timerNormalizeSettings(_timerReadJson(SETTINGS_KEY, DEFAULT_SETTINGS));
    }
    if (changed.has(PRESETS_KEY)) {
      this._timerPresets = _timerReadItems(PRESETS_KEY);
    }
    if (changed.has(SEQUENCE_KEY)) {
      this._timerSequence = _timerReadItems(SEQUENCE_KEY);
      if (!this._timerSequence.length) this._timerAdvancedCancelSequence();
      else if (this._timerAdvancedSequenceIndex >= this._timerSequence.length) {
        this._timerAdvancedSequenceIndex = this._timerSequence.length - 1;
      }
    }
    this._timerAdvancedSyncControls();
    this._timerAdvancedRenderPresets();
    this._timerAdvancedRenderSequence();
    this._timerAdvancedReconcileCalendarPolling();
  };

  TimerComponent.prototype._timerAdvancedMount = function() {
    this._timerAdvancedModal = null;
  };

  TimerComponent.prototype._timerAdvancedPanelRoot = function() {
    return this._timerAdvancedModal?.querySelector?.('[data-timer-advanced]')
      || this.el?.querySelector?.('[data-timer-advanced]')
      || null;
  };

  TimerComponent.prototype._timerAdvancedShowSettingsDialog = function() {
    if (this._timerAdvancedModal?.isConnected) {
      this._timerAdvancedModal.querySelector('[data-timer-settings-close]')?.focus?.();
      return;
    }
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay gb-timer-settings-overlay';
    overlay.dataset.timerSettingsModal = '1';
    overlay.innerHTML = `
      <div class="modal gb-timer-settings-modal" role="dialog" aria-modal="true" aria-label="タイマー設定">
        <div class="gb-timer-settings-header">
          <h3>${_timerIcon('settings', 18)} タイマー設定</h3>
          <button class="tb-icon-btn" type="button" data-timer-settings-close aria-label="閉じる" title="タイマー設定を閉じます">${_timerIcon('x', 14)}</button>
        </div>
        <div class="modal-body gb-timer-settings-body">
          ${this._timerAdvancedHtml()}
        </div>
      </div>`;
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.closest('[data-timer-settings-close]')) {
        this._timerAdvancedCloseSettingsDialog();
      }
    });
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape') this._timerAdvancedCloseSettingsDialog();
    });
    document.body.appendChild(overlay);
    this._timerAdvancedModal = overlay;
    const panel = this._timerAdvancedPanelRoot();
    this._timerAdvancedBindEvents(panel);
    this._timerAdvancedRenderCalendars();
    this._timerAdvancedRenderPresets();
    this._timerAdvancedRenderSequence();
    this._timerAdvancedSyncControls();
    this._timerAdvancedLoadCalendars();
    if (typeof replaceIcons === 'function') replaceIcons();
    overlay.querySelector('[data-timer-settings-close]')?.focus?.();
  };

  TimerComponent.prototype._timerAdvancedCloseSettingsDialog = function() {
    this._timerAdvancedModal?.remove?.();
    this._timerAdvancedModal = null;
  };

  TimerComponent.prototype._timerAdvancedHtml = function() {
    return `
      <div class="gb-timer-advanced" data-timer-advanced>
        <section class="gb-timer-panel-section">
          <div class="gb-timer-panel-title">${_timerIcon('calendarClock', 14)} カレンダー連動</div>
          <div class="gb-timer-row">
            <label class="gb-timer-check" title="選択したカレンダーの開始時刻に合わせてタイマーを開始します"><input data-timer-setting="calendarEnabled" type="checkbox"> 有効</label>
            <select class="gb-select gb-timer-calendar-select" data-timer-calendar-select data-e2e-id="timer-calendar-select" aria-label="連動カレンダー" title="タイマーと連動するカレンダーを選択します"></select>
            <button class="tb-icon-btn" type="button" data-timer-action="refreshCalendars" title="カレンダー一覧を再取得します">${_timerIcon('refreshCw', 14)}</button>
            <span class="gb-timer-muted" data-timer-calendar-status></span>
          </div>
        </section>
        <section class="gb-timer-panel-section">
          <div class="gb-timer-panel-title">${_timerIcon('bell', 14)} アラームとカウントダウン</div>
          <div class="gb-timer-row">
            <select class="gb-select" data-timer-setting="alarmSound" aria-label="アラーム音" title="タイマー完了時に鳴らす音を選択します">
              <option value="beep">ビープ</option>
              <option value="chime">チャイム</option>
              <option value="bell">ベル</option>
              <option value="none">なし</option>
            </select>
            <label class="gb-timer-range" title="アラーム音の音量を調整します">音量 <input type="range" min="0" max="100" step="5" data-timer-setting="alarmVolume"><span data-timer-volume-label></span></label>
            <button class="tb-icon-btn" type="button" data-timer-action="testAlarm" title="現在のアラーム音を試聴します">${_timerIcon('volume2', 14)}</button>
          </div>
          <div class="gb-timer-row gb-timer-row--wrap">
            <label class="gb-timer-check" title="残り時間の節目を通知します"><input data-timer-setting="countdownEnabled" type="checkbox"> カウントダウン</label>
            <label class="gb-timer-check" title="通知を合成音声で読み上げます"><input data-timer-setting="countdownVoice" type="checkbox"> 音声で通知</label>
            <label class="gb-timer-check" title="残り10分ごとに通知します"><input data-timer-setting="countdownEvery10" type="checkbox"> 10分刻み</label>
            <label class="gb-timer-check" title="残り5分ごとに通知します"><input data-timer-setting="countdownEvery5" type="checkbox"> 5分刻み</label>
            <label class="gb-timer-check" title="残り10秒から1秒まで数字を通知します"><input data-timer-setting="countdownLast10" type="checkbox"> ラスト10秒</label>
          </div>
        </section>
        <section class="gb-timer-panel-section">
          <div class="gb-timer-panel-title">${_timerIcon('listChecks', 14)} 保存済みタイマー</div>
          <div class="gb-timer-row">
            <input class="gb-input gb-timer-name-input" data-timer-preset-name data-e2e-id="timer-preset-name" type="text" placeholder="設定名" title="保存済みタイマーに登録する名前を入力します">
            <button class="gb-btn gb-btn-xs" type="button" data-timer-action="savePreset" title="現在の時間、表示、通知設定を保存します">${_timerIcon('save', 13)} 保存</button>
            <label class="gb-timer-check" title="カウントダウン完了後に同じタイマーを再開始します"><input data-timer-setting="repeatSingle" type="checkbox"> 現在のタイマーを繰り返す</label>
          </div>
          <div class="gb-timer-preset-list" data-timer-preset-list></div>
        </section>
        <section class="gb-timer-panel-section">
          <div class="gb-timer-panel-title">${_timerIcon('listStart', 14)} 実行リスト</div>
          <div class="gb-timer-row">
            <button class="gb-btn gb-btn-xs gb-btn-primary" type="button" data-timer-action="runSequence" title="実行リストの先頭から順番に開始します">${_timerIcon('play', 13)} リスト実行</button>
            <button class="gb-btn gb-btn-xs" type="button" data-timer-action="stopSequence" title="実行リストの連続実行を停止します">${_timerIcon('square', 13)} 停止</button>
            <button class="gb-btn gb-btn-xs" type="button" data-timer-action="nextSequence" title="次のタイマーへ進みます">${_timerIcon('skipForward', 13)} 次へ</button>
            <button class="gb-btn gb-btn-xs" type="button" data-timer-action="clearSequence" title="実行リストを空にします">${_timerIcon('trash2', 13)} クリア</button>
            <label class="gb-timer-check" title="最後まで実行した後に先頭へ戻ります"><input data-timer-setting="repeatList" type="checkbox"> リスト全体を繰り返す</label>
          </div>
          <div class="gb-timer-sequence-list" data-timer-sequence-list></div>
        </section>
      </div>`;
  };

  TimerComponent.prototype._timerAdvancedBindEvents = function(panel) {
    panel = panel || this._timerAdvancedPanelRoot();
    if (!panel || panel._timerAdvancedBound) return;
    panel._timerAdvancedBound = true;
    panel.addEventListener('click', e => this._timerAdvancedHandleClick(e));
    panel.addEventListener('change', e => this._timerAdvancedHandleSettingChange(e));
    panel.addEventListener('input', e => this._timerAdvancedHandleSettingInput(e));
    panel.addEventListener('dragstart', e => this._timerAdvancedHandleDragStart(e));
    panel.addEventListener('dragover', e => this._timerAdvancedHandleDragOver(e));
    panel.addEventListener('drop', e => this._timerAdvancedHandleDrop(e));
    panel.addEventListener('dragend', () => {
      this._timerAdvancedDragIndex = -1;
      panel.querySelectorAll?.('.gb-timer-sequence-item.is-dragging').forEach(row => row.classList.remove('is-dragging'));
    });
  };

  TimerComponent.prototype._timerAdvancedHandleClick = async function(e) {
    const btn = e.target.closest('[data-timer-action]');
    if (!btn) return;
    const action = btn.dataset.timerAction;
    const id = btn.dataset.timerPresetId;
    const index = btn.dataset.timerSequenceIndex === undefined ? -1 : parseInt(btn.dataset.timerSequenceIndex, 10);
    if (action === 'refreshCalendars') this._timerAdvancedLoadCalendars();
    else if (action === 'testAlarm') this._timerAdvancedPlayAlarm();
    else if (action === 'savePreset') this._timerAdvancedSavePreset();
    else if (action === 'loadPreset') this._timerAdvancedApplyItem(this._timerPresets.find(item => item.id === id), false, { settingsHistoryLabel: 'タイマー: プリセット読み込み' });
    else if (action === 'startPreset') this._timerAdvancedApplyItem(this._timerPresets.find(item => item.id === id), true, { settingsHistoryLabel: 'タイマー: プリセット開始' });
    else if (action === 'addPresetToSequence') this._timerAdvancedAddPresetToSequence(id);
    else if (action === 'deletePreset') await this._timerAdvancedDeletePreset(id);
    else if (action === 'runSequence') this._timerAdvancedRunSequence(0);
    else if (action === 'stopSequence') this._timerAdvancedStopSequence();
    else if (action === 'nextSequence') this._timerAdvancedRunNextSequenceItem();
    else if (action === 'clearSequence') await this._timerAdvancedClearSequence();
    else if (action === 'runSequenceItem') this._timerAdvancedRunSequence(index);
    else if (action === 'deleteSequenceItem') await this._timerAdvancedDeleteSequenceItem(index);
  };

  TimerComponent.prototype._timerAdvancedHandleSettingChange = function(e) {
    const input = e.target.closest('[data-timer-setting], [data-timer-calendar-select]');
    if (!input) return;
    this._timerAdvancedUpdateSettingFromInput(input);
  };

  TimerComponent.prototype._timerAdvancedHandleSettingInput = function(e) {
    const input = e.target.closest('input[type="range"][data-timer-setting]');
    if (!input) return;
    this._timerAdvancedUpdateSettingFromInput(input, true);
  };

  TimerComponent.prototype._timerAdvancedUpdateSettingFromInput = function(input, transient) {
    const key = input.dataset.timerSetting || (input.matches('[data-timer-calendar-select]') ? 'calendarId' : '');
    if (!key) return;
    if (transient) {
      if (!this._timerAdvancedSettingsHistoryBefore) {
        this._timerAdvancedSettingsHistoryBefore = _timerCaptureStorageHistory([SETTINGS_KEY]);
      }
    } else if (!this._timerAdvancedSettingsHistoryBefore) {
      this._timerAdvancedSettingsHistoryBefore = _timerCaptureStorageHistory([SETTINGS_KEY]);
    }
    let value = input.type === 'checkbox' ? !!input.checked : input.value;
    if (key === 'alarmVolume') value = _timerClampInt(value, 0, 100, DEFAULT_SETTINGS.alarmVolume);
    this._timerAdvancedSettings[key] = value;
    this._timerAdvancedSettings = _timerNormalizeSettings(this._timerAdvancedSettings);
    this._timerAdvancedSyncControls();
    this._timerAdvancedSaveSettings({ skipHistory: true });
    if (!transient) {
      const before = this._timerAdvancedSettingsHistoryBefore;
      this._timerAdvancedSettingsHistoryBefore = null;
      _timerPushStorageHistory('タイマー: 拡張設定変更', before, [SETTINGS_KEY], key);
    }
    if (key === 'calendarEnabled' || key === 'calendarId') this._timerAdvancedReconcileCalendarPolling();
  };

  TimerComponent.prototype._timerAdvancedSyncControls = function() {
    const panel = this._timerAdvancedPanelRoot();
    if (!panel) return;
    const settings = this._timerAdvancedSettings || _timerNormalizeSettings(_timerReadJson(SETTINGS_KEY, DEFAULT_SETTINGS));
    panel.querySelectorAll('[data-timer-setting]').forEach(input => {
      const key = input.dataset.timerSetting;
      if (!(key in settings)) return;
      if (input.type === 'checkbox') input.checked = !!settings[key];
      else input.value = String(settings[key]);
    });
    const calSel = panel.querySelector('[data-timer-calendar-select]');
    if (calSel) calSel.value = settings.calendarId || '';
    const volumeLabel = panel.querySelector('[data-timer-volume-label]');
    if (volumeLabel) volumeLabel.textContent = `${settings.alarmVolume}%`;
    const nameInput = panel.querySelector('[data-timer-preset-name]');
    if (nameInput && !nameInput.value) nameInput.value = this._timerAdvancedActiveLabel || '';
    this._timerAdvancedRenderSequence();
  };

  TimerComponent.prototype._timerAdvancedSaveSettings = function(options = {}) {
    const before = options.skipHistory ? null : _timerCaptureStorageHistory([SETTINGS_KEY]);
    _timerWriteJson(SETTINGS_KEY, this._timerAdvancedSettings || DEFAULT_SETTINGS);
    if (!options.skipHistory) {
      _timerPushStorageHistory(options.label || 'タイマー: 拡張設定変更', before, [SETTINGS_KEY], options.detail || '');
    }
  };

  TimerComponent.prototype._timerAdvancedCurrentItem = function(name) {
    this._readControls();
    return _timerNormalizeItem({
      id: _timerId('timer'),
      name: name || this._timerAdvancedActiveLabel || `タイマー ${this._formatTime(this.totalSeconds)}`,
      totalSeconds: this.totalSeconds,
      countUp: false,
      displayMode: this.displayMode,
      alarmSound: this._timerAdvancedSettings.alarmSound,
      countdownEnabled: this._timerAdvancedSettings.countdownEnabled,
      countdownVoice: this._timerAdvancedSettings.countdownVoice,
      countdownEvery10: this._timerAdvancedSettings.countdownEvery10,
      countdownEvery5: this._timerAdvancedSettings.countdownEvery5,
      countdownLast10: this._timerAdvancedSettings.countdownLast10,
    });
  };

  TimerComponent.prototype._timerAdvancedSavePreset = function() {
    const input = this._timerAdvancedPanelRoot()?.querySelector?.('[data-timer-preset-name]');
    const name = String(input?.value || '').trim() || `タイマー ${this._formatTime(this.totalSeconds)}`;
    const item = this._timerAdvancedCurrentItem(name);
    const before = _timerCaptureStorageHistory([PRESETS_KEY]);
    this._timerPresets.push(item);
    _timerWriteJson(PRESETS_KEY, this._timerPresets);
    _timerPushStorageHistory('タイマー: プリセット保存', before, [PRESETS_KEY], item.name);
    if (input) input.value = '';
    this._timerAdvancedRenderPresets();
    if (typeof showStatus === 'function') showStatus('タイマー設定を保存しました');
  };

  TimerComponent.prototype._timerAdvancedRenderPresets = function() {
    const list = this._timerAdvancedPanelRoot()?.querySelector?.('[data-timer-preset-list]');
    if (!list) return;
    if (!this._timerPresets.length) {
      list.innerHTML = '<div class="gb-timer-empty">保存済みタイマーはありません</div>';
      return;
    }
    list.innerHTML = this._timerPresets.map(item => `
      <div class="gb-timer-preset-item" data-timer-preset-id="${_timerEsc(item.id)}">
        <div class="gb-timer-item-main">
          <span class="gb-timer-item-name">${_timerEsc(item.name)}</span>
          <span class="gb-timer-muted">${this._formatTime(item.totalSeconds)}</span>
        </div>
        <button class="tb-icon-btn" type="button" data-timer-action="loadPreset" data-timer-preset-id="${_timerEsc(item.id)}" title="読み込み">${_timerIcon('download', 14)}</button>
        <button class="tb-icon-btn" type="button" data-timer-action="startPreset" data-timer-preset-id="${_timerEsc(item.id)}" title="開始">${_timerIcon('play', 14)}</button>
        <button class="tb-icon-btn" type="button" data-timer-action="addPresetToSequence" data-timer-preset-id="${_timerEsc(item.id)}" title="実行リストに追加">${_timerIcon('listPlus', 14)}</button>
        <button class="tb-icon-btn" type="button" data-timer-action="deletePreset" data-timer-preset-id="${_timerEsc(item.id)}" title="削除">${_timerIcon('trash2', 14)}</button>
      </div>`).join('');
    if (typeof replaceIcons === 'function') replaceIcons();
  };

  TimerComponent.prototype._timerAdvancedApplyItem = function(item, start, options = {}) {
    if (!item) return;
    const normalized = _timerNormalizeItem(item);
    if (this.timerRunning || this._timerInterval) this._pauseTimer();
    this.totalSeconds = normalized.totalSeconds;
    this.countUp = false;
    this.displayMode = normalized.displayMode;
    this.elapsed = 0;
    this.elapsedAtStart = 0;
    this.timerStarted = false;
    this.timerStartMs = 0;
    this._timerAdvancedActiveLabel = normalized.name;
    this._timerAdvancedApplyItemSettings(normalized, options);
    this._writeControlsFromState();
    this._updateModeButtons();
    this._timerAdvancedSyncControls();
    this._drawTimer();
    if (start) this._startTimer();
  };

  TimerComponent.prototype._timerAdvancedApplyItemSettings = function(item, options = {}) {
    const before = options.skipSettingsHistory ? null : _timerCaptureStorageHistory([SETTINGS_KEY]);
    ['alarmSound', 'countdownEnabled', 'countdownVoice', 'countdownEvery10', 'countdownEvery5', 'countdownLast10'].forEach(key => {
      if (item[key] !== undefined) this._timerAdvancedSettings[key] = item[key];
    });
    this._timerAdvancedSettings = _timerNormalizeSettings(this._timerAdvancedSettings);
    this._timerAdvancedSaveSettings({ skipHistory: true });
    if (!options.skipSettingsHistory) {
      _timerPushStorageHistory(
        options.settingsHistoryLabel || 'タイマー: プリセット適用',
        before,
        [SETTINGS_KEY],
        item.name || ''
      );
    }
  };

  TimerComponent.prototype._timerAdvancedDeletePreset = async function(id) {
    const item = this._timerPresets.find(preset => preset.id === id);
    if (!item) return;
    if (!await _timerConfirm(`タイマー設定「${item.name}」を削除しますか？`)) return;
    const before = _timerCaptureStorageHistory([PRESETS_KEY, SEQUENCE_KEY]);
    this._timerPresets = this._timerPresets.filter(preset => preset.id !== id);
    this._timerSequence = this._timerSequence.filter(seq => seq.sourcePresetId !== id);
    _timerWriteJson(PRESETS_KEY, this._timerPresets);
    _timerWriteJson(SEQUENCE_KEY, this._timerSequence);
    _timerPushStorageHistory('タイマー: プリセット削除', before, [PRESETS_KEY, SEQUENCE_KEY], item.name);
    this._timerAdvancedRenderPresets();
    this._timerAdvancedRenderSequence();
  };

  TimerComponent.prototype._timerAdvancedAddPresetToSequence = function(id) {
    const item = this._timerPresets.find(preset => preset.id === id);
    if (!item) return;
    const before = _timerCaptureStorageHistory([SEQUENCE_KEY]);
    this._timerSequence.push({ ..._timerNormalizeItem(item), id: _timerId('seq'), sourcePresetId: id });
    _timerWriteJson(SEQUENCE_KEY, this._timerSequence);
    _timerPushStorageHistory('タイマー: 実行リスト追加', before, [SEQUENCE_KEY], item.name);
    this._timerAdvancedRenderSequence();
  };

  TimerComponent.prototype._timerAdvancedRenderSequence = function() {
    const list = this._timerAdvancedPanelRoot()?.querySelector?.('[data-timer-sequence-list]');
    if (!list) return;
    if (!this._timerSequence.length) {
      list.innerHTML = '<div class="gb-timer-empty">実行リストは空です</div>';
      return;
    }
    list.innerHTML = this._timerSequence.map((item, index) => `
      <div class="gb-timer-sequence-item${index === this._timerAdvancedSequenceIndex && this._timerAdvancedSequenceRunning ? ' is-active' : ''}" draggable="true" data-timer-sequence-index="${index}">
        <span class="gb-timer-drag-handle" title="ドラッグで並べ替え">${_timerIcon('gripVertical', 14)}</span>
        <div class="gb-timer-item-main">
          <span class="gb-timer-item-name">${_timerEsc(item.name)}</span>
          <span class="gb-timer-muted">${this._formatTime(item.totalSeconds)}</span>
        </div>
        <button class="tb-icon-btn" type="button" data-timer-action="runSequenceItem" data-timer-sequence-index="${index}" title="ここから実行">${_timerIcon('play', 14)}</button>
        <button class="tb-icon-btn" type="button" data-timer-action="deleteSequenceItem" data-timer-sequence-index="${index}" title="削除">${_timerIcon('trash2', 14)}</button>
      </div>`).join('');
    if (typeof replaceIcons === 'function') replaceIcons();
  };

  TimerComponent.prototype._timerAdvancedRunSequence = function(index) {
    if (!this._timerSequence.length) return;
    const startIndex = Math.max(0, Math.min(this._timerSequence.length - 1, Number(index) || 0));
    this._timerAdvancedSequenceRunning = true;
    this._timerAdvancedSequenceIndex = startIndex;
    this._timerAdvancedRunCurrentSequenceItem();
  };

  TimerComponent.prototype._timerAdvancedRunCurrentSequenceItem = function() {
    const item = this._timerSequence[this._timerAdvancedSequenceIndex];
    if (!item) {
      this._timerAdvancedStopSequence(false);
      return;
    }
    this._timerAdvancedApplyItem(item, true, { skipSettingsHistory: true });
    this._timerAdvancedRenderSequence();
  };

  TimerComponent.prototype._timerAdvancedRunNextSequenceItem = function() {
    if (!this._timerSequence.length) return;
    if (!this._timerAdvancedSequenceRunning) {
      this._timerAdvancedRunSequence(0);
      return;
    }
    this._timerAdvancedSequenceIndex += 1;
    if (this._timerAdvancedSequenceIndex >= this._timerSequence.length) {
      if (this._timerAdvancedSettings.repeatList) this._timerAdvancedSequenceIndex = 0;
      else {
        this._timerAdvancedStopSequence(false);
        return;
      }
    }
    this._timerAdvancedRunCurrentSequenceItem();
  };

  TimerComponent.prototype._timerAdvancedStopSequence = function(pauseTimer = true) {
    this._timerAdvancedSequenceRunning = false;
    this._timerAdvancedSequenceIndex = -1;
    if (pauseTimer) this._pauseTimer();
    this._timerAdvancedRenderSequence();
  };

  TimerComponent.prototype._timerAdvancedCancelSequence = function() {
    this._timerAdvancedSequenceRunning = false;
    this._timerAdvancedSequenceIndex = -1;
  };

  TimerComponent.prototype._timerAdvancedDeleteSequenceItem = async function(index) {
    if (index < 0 || index >= this._timerSequence.length) return;
    const item = this._timerSequence[index];
    if (!await _timerConfirm(`実行リストから「${item.name}」を削除しますか？`)) return;
    const before = _timerCaptureStorageHistory([SEQUENCE_KEY]);
    this._timerSequence.splice(index, 1);
    if (this._timerAdvancedSequenceRunning && index <= this._timerAdvancedSequenceIndex) {
      this._timerAdvancedSequenceIndex -= 1;
    }
    if (this._timerAdvancedSequenceIndex >= this._timerSequence.length) this._timerAdvancedSequenceIndex = this._timerSequence.length - 1;
    _timerWriteJson(SEQUENCE_KEY, this._timerSequence);
    _timerPushStorageHistory('タイマー: 実行リスト削除', before, [SEQUENCE_KEY], item.name);
    this._timerAdvancedRenderSequence();
  };

  TimerComponent.prototype._timerAdvancedClearSequence = async function() {
    if (!this._timerSequence.length) return;
    if (!await _timerConfirm('実行リストをすべて削除しますか？')) return;
    const before = _timerCaptureStorageHistory([SEQUENCE_KEY]);
    this._timerAdvancedStopSequence(false);
    this._timerSequence = [];
    _timerWriteJson(SEQUENCE_KEY, this._timerSequence);
    _timerPushStorageHistory('タイマー: 実行リストクリア', before, [SEQUENCE_KEY], '実行リスト');
    this._timerAdvancedRenderSequence();
  };

  TimerComponent.prototype._timerAdvancedHandleDragStart = function(e) {
    const row = e.target.closest('[data-timer-sequence-index]');
    if (!row) return;
    this._timerAdvancedDragIndex = parseInt(row.dataset.timerSequenceIndex, 10);
    row.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(this._timerAdvancedDragIndex));
  };

  TimerComponent.prototype._timerAdvancedHandleDragOver = function(e) {
    if (e.target.closest('[data-timer-sequence-index]')) e.preventDefault();
  };

  TimerComponent.prototype._timerAdvancedHandleDrop = function(e) {
    const row = e.target.closest('[data-timer-sequence-index]');
    if (!row) return;
    e.preventDefault();
    const from = this._timerAdvancedDragIndex;
    const to = parseInt(row.dataset.timerSequenceIndex, 10);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return;
    const before = _timerCaptureStorageHistory([SEQUENCE_KEY]);
    const [moved] = this._timerSequence.splice(from, 1);
    this._timerSequence.splice(to, 0, moved);
    if (this._timerAdvancedSequenceIndex === from) this._timerAdvancedSequenceIndex = to;
    else if (from < this._timerAdvancedSequenceIndex && to >= this._timerAdvancedSequenceIndex) this._timerAdvancedSequenceIndex -= 1;
    else if (from > this._timerAdvancedSequenceIndex && to <= this._timerAdvancedSequenceIndex) this._timerAdvancedSequenceIndex += 1;
    _timerWriteJson(SEQUENCE_KEY, this._timerSequence);
    _timerPushStorageHistory('タイマー: 実行リスト並べ替え', before, [SEQUENCE_KEY], moved?.name || '');
    this._timerAdvancedRenderSequence();
  };

  TimerComponent.prototype._timerAdvancedResetCountdownState = function() {
    this._timerAdvancedCountdownKeys = new Set();
    this._timerAdvancedPreviousRemaining = null;
  };

  TimerComponent.prototype._timerAdvancedCountdownThresholds = function() {
    const settings = this._timerAdvancedSettings || DEFAULT_SETTINGS;
    if (!settings.countdownEnabled || this.countUp || this.totalSeconds <= 0) return [];
    const thresholds = new Set();
    if (settings.countdownEvery10) {
      for (let s = 600; s < this.totalSeconds; s += 600) thresholds.add(s);
    }
    if (settings.countdownEvery5) {
      for (let s = 300; s < this.totalSeconds; s += 300) thresholds.add(s);
    }
    if (settings.countdownLast10) {
      for (let s = 10; s >= 1; s -= 1) {
        if (s < this.totalSeconds) thresholds.add(s);
      }
    }
    return [...thresholds].sort((a, b) => b - a);
  };

  TimerComponent.prototype._timerAdvancedCheckCountdown = function() {
    if (!this.timerRunning || this.countUp) return;
    const remaining = this._remainingSeconds();
    const previous = this._timerAdvancedPreviousRemaining;
    this._timerAdvancedPreviousRemaining = remaining;
    if (previous === null || previous === undefined) return;
    this._timerAdvancedCountdownThresholds().forEach(threshold => {
      const key = String(threshold);
      if (this._timerAdvancedCountdownKeys.has(key)) return;
      if (previous > threshold && remaining <= threshold) {
        this._timerAdvancedCountdownKeys.add(key);
        this._timerAdvancedAnnounceCountdown(threshold);
      }
    });
  };

  TimerComponent.prototype._timerAdvancedAnnounceCountdown = function(seconds) {
    const message = `残り${_timerFormatHuman(seconds)}`;
    const speechMessage = seconds <= 10 ? String(seconds) : message;
    if (this._timerAdvancedSettings.countdownVoice && 'speechSynthesis' in window) {
      try {
        const utterance = new SpeechSynthesisUtterance(speechMessage);
        utterance.lang = 'ja-JP';
        utterance.rate = seconds <= 10 ? 1.05 : 0.95;
        window.speechSynthesis.speak(utterance);
      } catch {}
    }
    if (typeof showStatus === 'function') showStatus(message);
  };

  TimerComponent.prototype._timerAdvancedPlayAlarm = function(sound, volume) {
    const name = sound || this._timerAdvancedSettings?.alarmSound || DEFAULT_SETTINGS.alarmSound;
    if (name === 'none') return;
    const vol = Math.max(0, Math.min(1, (volume ?? this._timerAdvancedSettings?.alarmVolume ?? 70) / 100));
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const master = ctx.createGain();
      master.gain.value = vol * 0.18;
      master.connect(ctx.destination);
      const tones = {
        beep: [[880, 0, 0.22], [660, 0.28, 0.22]],
        chime: [[784, 0, 0.18], [988, 0.2, 0.28], [1175, 0.5, 0.35]],
        bell: [[523, 0, 0.18], [659, 0.18, 0.18], [784, 0.36, 0.42], [523, 0.86, 0.2]],
      }[name] || [[880, 0, 0.22]];
      tones.forEach(([freq, start, length]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = name === 'bell' ? 'triangle' : 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(1, ctx.currentTime + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + length);
        osc.connect(gain);
        gain.connect(master);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + length + 0.04);
      });
      setTimeout(() => ctx.close().catch(() => {}), 1800);
    } catch {}
  };

  TimerComponent.prototype._notifyDone = function() {
    this._timerAdvancedPlayAlarm();
    const label = this._timerAdvancedActiveLabel ? `${this._timerAdvancedActiveLabel} ` : '';
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification('タイマー完了', { body: `${label}${this._formatTime(this.totalSeconds)} 経過` }); } catch {}
    }
    if (typeof showStatus === 'function') showStatus(`${label}タイマーが完了しました`);
    this._timerAdvancedHandleTimerDone();
  };

  TimerComponent.prototype._timerAdvancedHandleTimerDone = function() {
    if (this._timerAdvancedSequenceRunning) {
      setTimeout(() => this._timerAdvancedRunNextSequenceItem(), 700);
      return;
    }
    if (this._timerAdvancedSettings?.repeatSingle && !this.countUp && this.totalSeconds > 0) {
      setTimeout(() => {
        if (!this.timerRunning) this._startTimer();
      }, 700);
    }
  };

  TimerComponent.prototype._timerAdvancedLoadCalendars = async function() {
    const status = this._timerAdvancedPanelRoot()?.querySelector?.('[data-timer-calendar-status]');
    if (status) status.textContent = '読込中...';
    try {
      const calendars = await apiFetch('/cal/calendars?user=' + encodeURIComponent(_timerUser()));
      this._timerCalendars = Array.isArray(calendars) ? calendars : [];
      this._timerAdvancedRenderCalendars();
      if (status) status.textContent = this._timerCalendars.length ? '' : 'カレンダーなし';
    } catch {
      this._timerCalendars = [];
      this._timerAdvancedRenderCalendars();
      if (status) status.textContent = '取得失敗';
    }
  };

  TimerComponent.prototype._timerAdvancedRenderCalendars = function() {
    const select = this._timerAdvancedPanelRoot()?.querySelector?.('[data-timer-calendar-select]');
    if (!select) return;
    const current = this._timerAdvancedSettings?.calendarId || '';
    const options = ['<option value="">カレンダーを選択</option>', '<option value="__all__">すべてのカレンダー</option>'];
    (this._timerCalendars || []).forEach(cal => {
      options.push(`<option value="${_timerEsc(cal.id)}">${_timerEsc(cal.name || '無題カレンダー')}</option>`);
    });
    select.innerHTML = options.join('');
    select.value = [...select.options].some(opt => opt.value === current) ? current : '';
  };

  TimerComponent.prototype._timerAdvancedReconcileCalendarPolling = function() {
    if (this._timerAdvancedSettings?.calendarEnabled && this._timerAdvancedSettings.calendarId) {
      this._timerAdvancedStartCalendarPolling();
    } else {
      this._timerAdvancedStopCalendarPolling();
    }
  };

  TimerComponent.prototype._timerAdvancedStartCalendarPolling = function() {
    if (this._timerCalendarPollTimer) return;
    this._timerAdvancedCheckCalendarEvents();
    this._timerCalendarPollTimer = setInterval(() => this._timerAdvancedCheckCalendarEvents(), CALENDAR_POLL_MS);
  };

  TimerComponent.prototype._timerAdvancedStopCalendarPolling = function() {
    if (this._timerCalendarPollTimer) clearInterval(this._timerCalendarPollTimer);
    this._timerCalendarPollTimer = null;
  };

  TimerComponent.prototype._timerAdvancedCheckCalendarEvents = async function() {
    const settings = this._timerAdvancedSettings || DEFAULT_SETTINGS;
    if (!settings.calendarEnabled || !settings.calendarId || typeof apiFetch !== 'function') return;
    const now = new Date();
    const start = _timerLocalDateTime(_timerStartOfDay(now));
    const end = _timerLocalDateTime(_timerEndOfDay(now));
    try {
      const events = await apiFetch('/cal/events?start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end) + '&user=' + encodeURIComponent(_timerUser()));
      const event = (Array.isArray(events) ? events : []).find(ev => this._timerAdvancedShouldStartEvent(ev, now));
      if (!event) return;
      this._timerAdvancedStartFromCalendarEvent(event, now);
    } catch {}
  };

  TimerComponent.prototype._timerAdvancedShouldStartEvent = function(ev, now) {
    if (!ev || !ev.start || ev.all_day) return false;
    const selected = this._timerAdvancedSettings.calendarId;
    if (selected !== '__all__' && ev.calendar_id !== selected) return false;
    const start = new Date(ev.start);
    if (Number.isNaN(start.getTime())) return false;
    const end = ev.end ? new Date(ev.end) : new Date(start.getTime() + 3600000);
    if (Number.isNaN(end.getTime()) || end <= now) return false;
    const delta = now.getTime() - start.getTime();
    if (delta < 0 || delta > CALENDAR_START_WINDOW_MS) return false;
    const key = `${ev.id || ev.title}:${ev.start}`;
    if (this._timerCalendarStartedKeys.has(key)) return false;
    this._timerCalendarStartedKeys.add(key);
    return true;
  };

  TimerComponent.prototype._timerAdvancedStartFromCalendarEvent = function(ev, now) {
    const start = new Date(ev.start);
    const end = ev.end ? new Date(ev.end) : new Date(start.getTime() + 3600000);
    const seconds = Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 1000));
    if (this.timerRunning || this._timerInterval) this._pauseTimer();
    this._timerAdvancedCancelSequence();
    this._timerAdvancedActiveLabel = ev.title || 'カレンダーイベント';
    this.totalSeconds = seconds;
    this.elapsed = 0;
    this.countUp = false;
    this.timerStarted = false;
    this.elapsedAtStart = 0;
    this.timerStartMs = 0;
    this._writeControlsFromState();
    this._timerAdvancedSyncControls();
    this._drawTimer();
    this._startTimer();
    if (typeof showStatus === 'function') {
      showStatus(`カレンダー連動: ${this._timerAdvancedActiveLabel} のタイマーを開始しました`);
    }
  };
})();
