/* ==============================
   gb-tool-timer-advanced.js: Timer panel automation and presets
   ============================== */

(() => {
  if (typeof TimerComponent === 'undefined') return;

  const SETTINGS_KEY = 'gb:timer-advanced-settings';
  const PRESETS_KEY = 'gb:timer-presets';
  const TIMER_HISTORY_SCOPE = 'timer:settings';
  const CALENDAR_POLL_MS = 30000;
  const CALENDAR_START_WINDOW_MS = 120000;
  const LOUD_ALARM_NAME = 'alarm';
  const CUSTOM_ALARM_NAME = 'custom';
  const DEFAULT_SETTINGS = Object.freeze({
    calendarEnabled: false,
    calendarId: '',
    alarmSound: LOUD_ALARM_NAME,
    alarmCustomName: '',
    alarmCustomDataUrl: '',
    alarmVolume: 70,
    countdownEnabled: true,
    countdownVoice: false,
    countdownEvery10: true,
    countdownEvery5: false,
    countdownLast10: false,
    repeatSingle: false,
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
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
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
    return MeldexEscape.html(value);
  }

  function _timerIcon(name, size = 14) {
    return typeof lucide === 'function' ? lucide(name, size) : '';
  }

  function _timerClampInt(value, min, max, fallback) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function _timerConfirm(message, options) {
    if (typeof cfConfirm === 'function') return cfConfirm(message, options);
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
    ['calendarEnabled', 'countdownEnabled', 'countdownVoice', 'countdownEvery10', 'countdownEvery5', 'countdownLast10', 'repeatSingle']
      .forEach(key => { next[key] = !!next[key]; });
    next.calendarId = String(next.calendarId || '');
    next.alarmCustomName = String(next.alarmCustomName || '');
    next.alarmCustomDataUrl = String(next.alarmCustomDataUrl || '').startsWith('data:audio/') ? String(next.alarmCustomDataUrl) : '';
    if (next.alarmCustomDataUrl && !next.alarmCustomName) next.alarmCustomName = '設定した音源';
    if (String(next.alarmSound || '') === 'none') next.alarmSound = 'none';
    else if (String(next.alarmSound || '') === CUSTOM_ALARM_NAME) next.alarmSound = CUSTOM_ALARM_NAME;
    else next.alarmSound = LOUD_ALARM_NAME;
    if (next.countdownEnabled && next.countdownLast10) next.countdownLast10 = false;
    return next;
  }

  function _timerNormalizeItem(item, fallbackName) {
    const seconds = Math.max(1, Number(item?.totalSeconds) || 300);
    return {
      id: item?.id || _timerId('timer'),
      name: String(item?.name || fallbackName || 'タイマー'),
      totalSeconds: seconds,
      countUp: !!item?.countUp,
      displayMode: ['digital', 'analog', 'circle', 'bar'].includes(item?.displayMode) ? item.displayMode : 'digital',
      alarmSound: item?.alarmSound === 'none' ? 'none' : item?.alarmSound === CUSTOM_ALARM_NAME ? CUSTOM_ALARM_NAME : item?.alarmSound ? LOUD_ALARM_NAME : undefined,
      countdownEnabled: item?.countdownEnabled === undefined ? undefined : !!item.countdownEnabled,
      countdownVoice: item?.countdownVoice === undefined ? undefined : !!item.countdownVoice,
      countdownEvery10: item?.countdownEvery10 === undefined ? undefined : !!item.countdownEvery10,
      countdownEvery5: item?.countdownEvery5 === undefined ? undefined : !!item.countdownEvery5,
      countdownLast10: item?.countdownLast10 === undefined ? undefined : !!item.countdownLast10,
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
    this._timerAdvancedClearPendingAutoStart?.();
    this._timerAdvancedClearCountdownTimers?.();
    this._timerAdvancedStopAlarmAudio?.();
    this._timerAdvancedCancelSpeech?.();
    this._timerAdvancedStopCalendarPolling?.();
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
    this._timerAdvancedScheduleCountdowns?.();
  };

  const baseStartTimer = TimerComponent.prototype._startTimer;
  TimerComponent.prototype._startTimer = function() {
    this._timerAdvancedClearPendingAutoStart?.();
    this._timerAdvancedCancelSpeech?.();
    this._timerAdvancedTimerSource = this._timerAdvancedNextStartSource || 'manual';
    this._timerAdvancedNextStartSource = '';
    return baseStartTimer.call(this);
  };

  const basePauseTimer = TimerComponent.prototype._pauseTimer;
  TimerComponent.prototype._pauseTimer = function() {
    this._timerAdvancedClearPendingAutoStart?.();
    this._timerAdvancedClearCountdownTimers?.();
    this._timerAdvancedStopAlarmAudio?.();
    this._timerAdvancedCancelSpeech?.();
    return basePauseTimer.call(this);
  };

  const baseUpdateElapsed = TimerComponent.prototype._updateElapsedFromClock;
  TimerComponent.prototype._updateElapsedFromClock = function() {
    baseUpdateElapsed.call(this);
    this._timerAdvancedCheckCountdown?.();
  };

  const baseResetTimer = TimerComponent.prototype._resetTimer;
  TimerComponent.prototype._resetTimer = function() {
    this._timerAdvancedClearPendingAutoStart?.();
    this._timerAdvancedStopAlarmAudio?.();
    baseResetTimer.call(this);
    this._timerAdvancedActiveLabel = '';
    this._timerAdvancedTimerSource = '';
    this._timerAdvancedResetCountdownState();
    this._timerAdvancedSyncControls?.();
  };

  TimerComponent.prototype._timerAdvancedInit = function() {
    this._timerAdvancedSettings = _timerNormalizeSettings(_timerReadJson(SETTINGS_KEY, DEFAULT_SETTINGS));
    this._timerPresets = _timerReadItems(PRESETS_KEY);
    this._timerCalendars = [];
    this._timerCalendarStartedKeys = this._timerCalendarStartedKeys || new Set();
    this._timerAdvancedCountdownKeys = new Set();
    this._timerAdvancedCountdownTimers = [];
    this._timerAdvancedPreviousRemaining = null;
    this._timerAdvancedActiveLabel = this._timerAdvancedActiveLabel || '';
    this._timerAdvancedAutoStartTimer = null;
    this._timerAdvancedAlarmAudio = null;
    this._timerAdvancedTimerSource = this._timerAdvancedTimerSource || '';
    this._timerAdvancedNextStartSource = '';
  };

  TimerComponent.prototype._timerAdvancedReloadFromStorage = function(changedKeys) {
    const changed = changedKeys instanceof Set ? changedKeys : new Set(changedKeys || []);
    if (changed.has(SETTINGS_KEY)) {
      this._timerAdvancedSettings = _timerNormalizeSettings(_timerReadJson(SETTINGS_KEY, DEFAULT_SETTINGS));
    }
    if (changed.has(PRESETS_KEY)) {
      this._timerPresets = _timerReadItems(PRESETS_KEY);
    }
    this._timerAdvancedSyncControls();
    this._timerAdvancedRenderPresets();
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
      this._timerAdvancedModal.querySelector('.gb-timer-settings-modal')?.focus?.();
      return;
    }
    if (typeof window.GBUI?.createModal !== 'function') {
      throw new Error('タイマー設定を初期化できませんでした。');
    }
    const body = document.createElement('div');
    body.innerHTML = this._timerAdvancedHtml();
    const modalApi = window.GBUI.createModal({
      id: 'timer-settings',
      title: 'タイマー設定',
      body: [...body.childNodes],
      variant: 'standard',
      extraClass: 'gb-timer-settings-modal',
      geometryKey: 'timer-settings',
      minWidth: '0',
      initialFocus: '[data-timer-setting], [data-timer-action]',
      returnFocus: document.activeElement,
      closeLabel: 'タイマー設定を閉じる',
      closeOnEsc: true,
      closeOnOverlay: true,
      onClose: () => {
        this._timerAdvancedModal = null;
      },
    });
    const overlay = modalApi.overlay;
    overlay.classList.add('modal-overlay', 'gb-timer-settings-overlay');
    overlay.dataset.timerSettingsModal = '1';
    overlay.dataset.e2eId = 'timer-settings-overlay';
    overlay._timerSettingsModalApi = modalApi;
    modalApi.modal.dataset.gbTooltipDisabled = 'true';
    modalApi.modal.dataset.e2eId = 'timer-settings-dialog';
    modalApi.header.classList.add('gb-timer-settings-header');
    modalApi.body.classList.add('gb-timer-settings-body');
    const closeButton = modalApi.header.querySelector('.gb-modal-close');
    if (closeButton) {
      closeButton.classList.add('tb-icon-btn');
      closeButton.dataset.timerSettingsClose = '';
      closeButton.dataset.e2eId = 'timer-settings-close';
      closeButton.title = 'タイマー設定を閉じます';
    }
    this._timerAdvancedModal = overlay;
    const panel = this._timerAdvancedPanelRoot();
    this._timerAdvancedBindEvents(panel);
    this._timerAdvancedRenderCalendars();
    this._timerAdvancedRenderPresets();
    this._timerAdvancedSyncControls();
    this._timerAdvancedLoadCalendars();
    if (typeof replaceIcons === 'function') replaceIcons();
    modalApi.open();
  };

  TimerComponent.prototype._timerAdvancedCloseSettingsDialog = function() {
    const overlay = this._timerAdvancedModal;
    if (!overlay) return false;
    const closed = overlay._timerSettingsModalApi?.close?.('programmatic');
    if (!overlay._timerSettingsModalApi) {
      overlay.remove?.();
      this._timerAdvancedModal = null;
      return true;
    }
    return closed;
  };

  TimerComponent.prototype._timerAdvancedHtml = function() {
    return `
      <div class="gb-timer-advanced" data-timer-advanced>
        <section class="gb-timer-panel-section">
          <div class="gb-timer-panel-title">${_timerIcon('calendarClock', 14)} カレンダー連動</div>
          <div class="gb-timer-row">
            <label class="gb-timer-check" title="選択したカレンダーの開始時刻に合わせてタイマーを開始します"><input data-timer-setting="calendarEnabled" type="checkbox"> 有効</label>
            <select class="gb-select gb-timer-calendar-select" data-timer-calendar-select data-e2e-id="timer-calendar-select" aria-label="連動カレンダー" title="タイマーと連動するカレンダーを選択します"></select>
            <button class="tb-icon-btn" type="button" data-timer-action="refreshCalendars" aria-label="カレンダー一覧を更新" title="カレンダー一覧を再取得します">${_timerIcon('refreshCw', 14)}</button>
            <span class="gb-timer-muted" data-timer-calendar-status></span>
          </div>
        </section>
        <section class="gb-timer-panel-section">
          <div class="gb-timer-panel-title">${_timerIcon('bell', 14)} アラームとカウントダウン</div>
          <div class="gb-timer-row">
            <select class="gb-select" data-timer-setting="alarmSound" aria-label="アラーム音" title="タイマー完了時に鳴らす音を選択します">
              <option value="alarm">警報音</option>
              <option value="custom">設定した音源</option>
              <option value="none">なし</option>
            </select>
            <label class="gb-timer-range" title="アラーム音の音量を調整します">音量 <input type="range" min="0" max="100" step="5" data-timer-setting="alarmVolume"><span data-timer-volume-label></span></label>
            <button class="tb-icon-btn" type="button" data-timer-action="testAlarm" aria-label="アラーム音を試聴" title="現在のアラーム音を試聴します">${_timerIcon('volume2', 14)}</button>
          </div>
          <div class="gb-timer-row gb-timer-alarm-source-row">
            <button class="gb-btn gb-btn-xs" type="button" data-timer-action="chooseAlarmSource" aria-label="アラーム音源を選択" title="アラームに使う音源ファイルを選択します">${_timerIcon('music', 13)} 音源を選択</button>
            <button class="tb-icon-btn" type="button" data-timer-action="clearAlarmSource" aria-label="設定した音源を削除" title="設定した音源を削除します">${_timerIcon('x', 13)}</button>
            <span class="gb-timer-source-name" data-timer-alarm-source-name></span>
            <input class="gb-timer-alarm-file" data-timer-alarm-file type="file" accept="audio/*" aria-label="アラーム音源ファイル">
          </div>
          <div class="gb-timer-row gb-timer-row--wrap">
            <label class="gb-timer-check" title="通知を合成音声で読み上げます"><input data-timer-setting="countdownVoice" type="checkbox"> 音声で通知</label>
            <label class="gb-timer-check" title="残り時間の節目を通知します"><input data-timer-setting="countdownEnabled" type="checkbox"> カウントダウン</label>
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
      </div>`;
  };

  TimerComponent.prototype._timerAdvancedBindEvents = function(panel) {
    panel = panel || this._timerAdvancedPanelRoot();
    if (!panel || panel._timerAdvancedBound) return;
    panel._timerAdvancedBound = true;
    panel.addEventListener('click', e => this._timerAdvancedHandleClick(e));
    panel.addEventListener('change', e => this._timerAdvancedHandleSettingChange(e));
    panel.addEventListener('change', e => this._timerAdvancedHandleAlarmFile(e));
    panel.addEventListener('input', e => this._timerAdvancedHandleSettingInput(e));
  };

  TimerComponent.prototype._timerAdvancedHandleClick = async function(e) {
    const btn = e.target.closest('[data-timer-action]');
    if (!btn) return;
    const action = btn.dataset.timerAction;
    const id = btn.dataset.timerPresetId;
    if (action === 'refreshCalendars') this._timerAdvancedLoadCalendars();
    else if (action === 'testAlarm') this._timerAdvancedPlayAlarm();
    else if (action === 'chooseAlarmSource') this._timerAdvancedChooseAlarmSource();
    else if (action === 'clearAlarmSource') this._timerAdvancedClearAlarmSource();
    else if (action === 'savePreset') this._timerAdvancedSavePreset();
    else if (action === 'loadPreset') this._timerAdvancedApplyItem(this._timerPresets.find(item => item.id === id), false, { settingsHistoryLabel: 'タイマー: プリセット読み込み' });
    else if (action === 'startPreset') this._timerAdvancedApplyItem(this._timerPresets.find(item => item.id === id), true, { settingsHistoryLabel: 'タイマー: プリセット開始' });
    else if (action === 'deletePreset') await this._timerAdvancedDeletePreset(id);
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
    if (key === 'countdownEnabled' && value) this._timerAdvancedSettings.countdownLast10 = false;
    if (key === 'countdownLast10' && value) this._timerAdvancedSettings.countdownEnabled = false;
    this._timerAdvancedSettings = _timerNormalizeSettings(this._timerAdvancedSettings);
    this._timerAdvancedSyncControls();
    this._timerAdvancedSaveSettings({ skipHistory: true });
    if (!transient) {
      const before = this._timerAdvancedSettingsHistoryBefore;
      this._timerAdvancedSettingsHistoryBefore = null;
      _timerPushStorageHistory('タイマー: 拡張設定変更', before, [SETTINGS_KEY], key);
    }
    if (key === 'calendarEnabled' || key === 'calendarId') this._timerAdvancedReconcileCalendarPolling();
    if (key === 'alarmSound' && value === CUSTOM_ALARM_NAME && !this._timerAdvancedSettings.alarmCustomDataUrl
      && typeof this._timerAdvancedChooseAlarmSource === 'function') {
      this._timerAdvancedChooseAlarmSource();
    }
    if (key.startsWith('countdown')) {
      this._timerAdvancedResetCountdownState();
      if (this.timerRunning) this._timerAdvancedScheduleCountdowns();
    }
  };

  TimerComponent.prototype._timerAdvancedSetSettingDisabled = function(panel, key, disabled) {
    const input = panel?.querySelector?.(`[data-timer-setting="${key}"]`);
    if (!input) return;
    input.disabled = !!disabled;
    const label = input.closest?.('.gb-timer-check, .gb-timer-range');
    label?.classList?.toggle?.('is-disabled', !!disabled);
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
    const sourceLabel = panel.querySelector('[data-timer-alarm-source-name]');
    if (sourceLabel) sourceLabel.textContent = settings.alarmCustomName ? `設定音源: ${settings.alarmCustomName}` : '設定音源なし';
    const clearSourceBtn = panel.querySelector('[data-timer-action="clearAlarmSource"]');
    if (clearSourceBtn) clearSourceBtn.disabled = !settings.alarmCustomDataUrl;
    const nameInput = panel.querySelector('[data-timer-preset-name]');
    if (nameInput && !nameInput.value) nameInput.value = this._timerAdvancedActiveLabel || '';
    const voiceEnabled = !!settings.countdownVoice;
    const intervalEnabled = voiceEnabled && !!settings.countdownEnabled;
    const last10Enabled = voiceEnabled && !!settings.countdownLast10;
    this._timerAdvancedSetSettingDisabled(panel, 'countdownEnabled', !voiceEnabled || last10Enabled);
    this._timerAdvancedSetSettingDisabled(panel, 'countdownEvery10', !intervalEnabled);
    this._timerAdvancedSetSettingDisabled(panel, 'countdownEvery5', !intervalEnabled);
    this._timerAdvancedSetSettingDisabled(panel, 'countdownLast10', !voiceEnabled || intervalEnabled);
  };

  TimerComponent.prototype._timerAdvancedSaveSettings = function(options = {}) {
    const before = options.skipHistory ? null : _timerCaptureStorageHistory([SETTINGS_KEY]);
    if (!_timerWriteJson(SETTINGS_KEY, this._timerAdvancedSettings || DEFAULT_SETTINGS)) {
      if (typeof showStatus === 'function') showStatus('タイマー設定を保存できませんでした');
      return false;
    }
    if (!options.skipHistory) {
      _timerPushStorageHistory(options.label || 'タイマー: 拡張設定変更', before, [SETTINGS_KEY], options.detail || '');
    }
    return true;
  };

  TimerComponent.prototype._timerAdvancedCurrentItem = function(name) {
    this._readControls();
    return _timerNormalizeItem({
      id: _timerId('timer'),
      name: name || this._timerAdvancedActiveLabel || `タイマー ${this._formatTime(this.totalSeconds)}`,
      totalSeconds: this.totalSeconds,
      countUp: this.countUp,
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
    list.innerHTML = this._timerPresets.map(item => {
      const itemId = _timerEsc(item.id);
      const itemName = _timerEsc(item.name);
      return `
      <div class="gb-timer-preset-item" data-timer-preset-id="${itemId}">
        <div class="gb-timer-item-main">
          <span class="gb-timer-item-name">${itemName}</span>
          <span class="gb-timer-muted">${this._formatTime(item.totalSeconds)}</span>
        </div>
        <button class="tb-icon-btn" type="button" data-timer-action="loadPreset" data-timer-preset-id="${itemId}" aria-label="${itemName}を読み込み" title="${itemName}を読み込み">${_timerIcon('download', 14)}</button>
        <button class="tb-icon-btn" type="button" data-timer-action="startPreset" data-timer-preset-id="${itemId}" aria-label="${itemName}を開始" title="${itemName}を開始">${_timerIcon('play', 14)}</button>
        <button class="tb-icon-btn" type="button" data-timer-action="deletePreset" data-timer-preset-id="${itemId}" aria-label="${itemName}を削除" title="${itemName}を削除">${_timerIcon('trash2', 14)}</button>
      </div>`;
    }).join('');
    if (typeof replaceIcons === 'function') replaceIcons();
  };

  TimerComponent.prototype._timerAdvancedApplyItem = function(item, start, options = {}) {
    if (!item) return;
    const normalized = _timerNormalizeItem(item);
    this._timerAdvancedClearPendingAutoStart();
    this._timerAdvancedCancelSpeech();
    if (this.timerRunning || this._timerInterval) this._pauseTimer();
    this.totalSeconds = normalized.totalSeconds;
    this.countUp = !!normalized.countUp;
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
    if (start) this._timerAdvancedStartTimerAs(options.source || 'preset');
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
    if (!await _timerConfirm(`タイマー設定「${item.name}」を削除しますか？`, { danger: true, okLabel: '削除' })) return;
    const before = _timerCaptureStorageHistory([PRESETS_KEY]);
    this._timerPresets = this._timerPresets.filter(preset => preset.id !== id);
    _timerWriteJson(PRESETS_KEY, this._timerPresets);
    _timerPushStorageHistory('タイマー: プリセット削除', before, [PRESETS_KEY], item.name);
    this._timerAdvancedRenderPresets();
  };

  TimerComponent.prototype._timerAdvancedClearPendingAutoStart = function() {
    if (this._timerAdvancedAutoStartTimer) {
      clearTimeout(this._timerAdvancedAutoStartTimer);
      this._timerAdvancedAutoStartTimer = null;
    }
  };

  TimerComponent.prototype._timerAdvancedScheduleAutoStart = function(callback) {
    this._timerAdvancedClearPendingAutoStart();
    this._timerAdvancedAutoStartTimer = setTimeout(() => {
      this._timerAdvancedAutoStartTimer = null;
      callback();
    }, 700);
  };

  TimerComponent.prototype._timerAdvancedCancelSpeech = function() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch {}
    }
  };

  TimerComponent.prototype._timerAdvancedStartTimerAs = function(source) {
    this._timerAdvancedNextStartSource = source || 'manual';
    this._startTimer();
  };

  TimerComponent.prototype._timerAdvancedResetCountdownState = function() {
    this._timerAdvancedClearCountdownTimers?.();
    this._timerAdvancedCountdownKeys = new Set();
    this._timerAdvancedPreviousRemaining = null;
  };

  TimerComponent.prototype._timerAdvancedClearCountdownTimers = function() {
    (this._timerAdvancedCountdownTimers || []).forEach(timerId => clearTimeout(timerId));
    this._timerAdvancedCountdownTimers = [];
  };

  TimerComponent.prototype._timerAdvancedCountdownThresholds = function() {
    const settings = this._timerAdvancedSettings || DEFAULT_SETTINGS;
    if (!settings.countdownVoice || this.countUp || this.totalSeconds <= 0) return [];
    const thresholds = new Set();
    if (settings.countdownEnabled && settings.countdownEvery10) {
      for (let s = 600; s < this.totalSeconds; s += 600) thresholds.add(s);
    }
    if (settings.countdownEnabled && settings.countdownEvery5) {
      for (let s = 300; s < this.totalSeconds; s += 300) thresholds.add(s);
    }
    if (settings.countdownLast10) {
      for (let s = 10; s >= 1; s -= 1) {
        if (s <= this.totalSeconds) thresholds.add(s);
      }
    }
    return [...thresholds].sort((a, b) => b - a);
  };

  TimerComponent.prototype._timerAdvancedPreciseRemainingSeconds = function() {
    if (!this.timerRunning || !this.timerStartMs) return this._remainingSeconds();
    const preciseElapsed = this.elapsedAtStart + Math.max(0, (Date.now() - this.timerStartMs) / 1000);
    return this.countUp ? preciseElapsed : Math.max(0, this.totalSeconds - preciseElapsed);
  };

  TimerComponent.prototype._timerAdvancedScheduleCountdowns = function() {
    this._timerAdvancedClearCountdownTimers();
    if (!this.timerRunning || this.countUp) return;
    const currentRemaining = this._timerAdvancedPreciseRemainingSeconds();
    this._timerAdvancedCountdownThresholds().forEach(threshold => {
      const key = String(threshold);
      if (this._timerAdvancedCountdownKeys.has(key)) return;
      if (threshold > currentRemaining) return;
      const delayMs = Math.max(0, Math.round((currentRemaining - threshold) * 1000));
      const timerId = setTimeout(() => {
        this._timerAdvancedCountdownTimers = (this._timerAdvancedCountdownTimers || []).filter(id => id !== timerId);
        if (!this.timerRunning || this.countUp || this._timerAdvancedCountdownKeys.has(key)) return;
        this._timerAdvancedCountdownKeys.add(key);
        this._timerAdvancedAnnounceCountdown(threshold);
      }, delayMs);
      this._timerAdvancedCountdownTimers.push(timerId);
    });
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
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(speechMessage);
        utterance.lang = 'ja-JP';
        utterance.rate = seconds <= 10 ? 1.25 : 0.98;
        window.speechSynthesis.speak(utterance);
      } catch {}
    }
    if (typeof showStatus === 'function') showStatus(message);
  };

  TimerComponent.prototype._timerAdvancedPlayAlarm = function(sound, volume) {
    const name = sound || this._timerAdvancedSettings?.alarmSound || DEFAULT_SETTINGS.alarmSound;
    if (name === 'none') return;
    const vol = Math.max(0, Math.min(1, (volume ?? this._timerAdvancedSettings?.alarmVolume ?? 70) / 100));
    if (name === CUSTOM_ALARM_NAME && typeof this._timerAdvancedPlayCustomAlarm === 'function') {
      this._timerAdvancedPlayCustomAlarm(volume);
      return;
    }
    try {
      this._timerAdvancedStopAlarmAudio?.();
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const master = ctx.createGain();
      master.gain.value = vol * 0.42;
      master.connect(ctx.destination);
      const tones = [];
      for (let i = 0; i < 12; i += 1) {
        const start = i * 0.22;
        tones.push([i % 2 ? 1320 : 1760, start, 0.17, 'square']);
        tones.push([i % 2 ? 660 : 880, start, 0.17, 'sawtooth']);
      }
      tones.forEach(([freq, start, length, type]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type || 'square';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(1, ctx.currentTime + start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + length);
        osc.connect(gain);
        gain.connect(master);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + length + 0.04);
      });
      setTimeout(() => ctx.close().catch(() => {}), 3200);
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
    const source = this._timerAdvancedTimerSource || 'manual';
    if (source !== 'calendar' && this._timerAdvancedSettings?.repeatSingle && !this.countUp && this.totalSeconds > 0) {
      this._timerAdvancedScheduleAutoStart(() => {
        if (!this.timerRunning) this._startTimer();
      });
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
    this._timerAdvancedStartTimerAs('calendar');
    if (typeof showStatus === 'function') {
      showStatus(`カレンダー連動: ${this._timerAdvancedActiveLabel} のタイマーを開始しました`);
    }
  };
})();
