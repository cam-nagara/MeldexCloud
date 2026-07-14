/* ==============================
   gb-tool-timer-custom-alarm.js: custom alarm source for timer
   ============================== */

(() => {
  if (typeof TimerComponent === 'undefined') return;

  const SETTINGS_KEY = 'gb:timer-advanced-settings';
  const TIMER_HISTORY_SCOPE = 'timer:settings';
  const LOUD_ALARM_NAME = 'alarm';
  const CUSTOM_ALARM_NAME = 'custom';
  const MAX_CUSTOM_ALARM_BYTES = 3 * 1024 * 1024;

  function _timerCustomStorageKeys(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    return [...new Set(list.filter(Boolean))];
  }

  function _timerCustomCaptureHistory(keys) {
    if (typeof captureLocalStorageSettings !== 'function') return null;
    if (typeof isLocalStorageSettingsHistorySuppressed === 'function'
      && isLocalStorageSettingsHistorySuppressed()) return null;
    return captureLocalStorageSettings(_timerCustomStorageKeys(keys));
  }

  function _timerCustomRefreshPanelsAfterHistory(keys) {
    const changed = new Set(_timerCustomStorageKeys(keys));
    if (typeof forEachComponent !== 'function') return;
    forEachComponent(component => {
      if (!component || !(component instanceof TimerComponent)) return;
      component._timerAdvancedReloadFromStorage?.(changed);
    });
  }

  function _timerCustomPushHistory(label, beforeSnapshot, keys, detail) {
    if (!beforeSnapshot || typeof historyPush !== 'function'
      || typeof captureLocalStorageSettings !== 'function'
      || typeof restoreLocalStorageSettings !== 'function'
      || typeof _normalizeLocalStorageSettingsSnapshots !== 'function') return false;
    const keyList = _timerCustomStorageKeys(keys);
    const snapshots = _normalizeLocalStorageSettingsSnapshots(beforeSnapshot, captureLocalStorageSettings(keyList));
    let beforeKey = '';
    let afterKey = '';
    try {
      beforeKey = JSON.stringify(snapshots.before);
      afterKey = JSON.stringify(snapshots.after);
    } catch {}
    if (beforeKey && beforeKey === afterKey) return false;
    historyPush(
      label || 'タイマー: 音源設定変更',
      () => restoreLocalStorageSettings(snapshots.before, _timerCustomRefreshPanelsAfterHistory),
      () => restoreLocalStorageSettings(snapshots.after, _timerCustomRefreshPanelsAfterHistory),
      TIMER_HISTORY_SCOPE,
      detail || '音源設定'
    );
    return true;
  }

  function _timerCustomReadFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('audio file read failed'));
      reader.readAsDataURL(file);
    });
  }

  function _timerCustomShowStatus(message) {
    if (typeof showStatus === 'function') showStatus(message);
  }

  function _timerCustomSettings(component, patch = {}) {
    const current = component._timerAdvancedSettings || {};
    const next = { ...current, ...patch };
    next.alarmCustomName = String(next.alarmCustomName || '');
    next.alarmCustomDataUrl = String(next.alarmCustomDataUrl || '').startsWith('data:audio/')
      ? String(next.alarmCustomDataUrl)
      : '';
    if (String(next.alarmSound || '') !== 'none' && String(next.alarmSound || '') !== CUSTOM_ALARM_NAME) {
      next.alarmSound = LOUD_ALARM_NAME;
    }
    if (next.alarmCustomDataUrl && !next.alarmCustomName) next.alarmCustomName = '設定した音源';
    return next;
  }

  function _timerCustomSave(component) {
    if (typeof component._timerAdvancedSaveSettings === 'function') {
      return component._timerAdvancedSaveSettings({ skipHistory: true });
    }
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(component._timerAdvancedSettings || {}));
      return true;
    } catch {
      _timerCustomShowStatus('タイマー設定を保存できませんでした');
      return false;
    }
  }

  TimerComponent.prototype._timerAdvancedHandleAlarmFile = async function(e) {
    const input = e.target.closest('input[data-timer-alarm-file]');
    if (!input) return;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!String(file.type || '').startsWith('audio/')) {
      _timerCustomShowStatus('音声ファイルを選択してください');
      return;
    }
    if (file.size > MAX_CUSTOM_ALARM_BYTES) {
      _timerCustomShowStatus('音源ファイルは3MB以下にしてください');
      return;
    }
    const beforeHistory = _timerCustomCaptureHistory([SETTINGS_KEY]);
    const beforeSettings = { ...(this._timerAdvancedSettings || {}) };
    try {
      const dataUrl = await _timerCustomReadFileAsDataUrl(file);
      if (!dataUrl.startsWith('data:audio/')) throw new Error('invalid audio data');
      this._timerAdvancedSettings = _timerCustomSettings(this, {
        alarmSound: CUSTOM_ALARM_NAME,
        alarmCustomName: file.name || '設定した音源',
        alarmCustomDataUrl: dataUrl,
      });
      if (!_timerCustomSave(this)) {
        this._timerAdvancedSettings = beforeSettings;
        this._timerAdvancedSyncControls?.();
        return;
      }
      _timerCustomPushHistory('タイマー: 音源設定変更', beforeHistory, [SETTINGS_KEY], file.name || '');
      this._timerAdvancedSyncControls?.();
      _timerCustomShowStatus('アラーム音源を設定しました');
    } catch {
      this._timerAdvancedSettings = beforeSettings;
      this._timerAdvancedSyncControls?.();
      _timerCustomShowStatus('音源ファイルを読み込めませんでした');
    }
  };

  TimerComponent.prototype._timerAdvancedChooseAlarmSource = function() {
    this._timerAdvancedPanelRoot?.()?.querySelector?.('[data-timer-alarm-file]')?.click?.();
  };

  TimerComponent.prototype._timerAdvancedClearAlarmSource = function() {
    const before = _timerCustomCaptureHistory([SETTINGS_KEY]);
    this._timerAdvancedStopAlarmAudio?.();
    this._timerAdvancedSettings = _timerCustomSettings(this, {
      alarmSound: this._timerAdvancedSettings?.alarmSound === CUSTOM_ALARM_NAME ? LOUD_ALARM_NAME : this._timerAdvancedSettings?.alarmSound,
      alarmCustomName: '',
      alarmCustomDataUrl: '',
    });
    if (_timerCustomSave(this)) {
      _timerCustomPushHistory('タイマー: 音源設定削除', before, [SETTINGS_KEY], '設定した音源');
      _timerCustomShowStatus('設定した音源を削除しました');
    }
    this._timerAdvancedSyncControls?.();
  };

  TimerComponent.prototype._timerAdvancedStopAlarmAudio = function() {
    const audio = this._timerAdvancedAlarmAudio;
    this._timerAdvancedAlarmAudio = null;
    if (!audio) return;
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {}
  };

  TimerComponent.prototype._timerAdvancedPlayCustomAlarm = function(volume) {
    const settings = this._timerAdvancedSettings || {};
    const src = String(settings.alarmCustomDataUrl || '');
    if (!src.startsWith('data:audio/')) {
      _timerCustomShowStatus('アラーム音源が設定されていません');
      this._timerAdvancedPlayAlarm?.(LOUD_ALARM_NAME, volume);
      return;
    }
    try {
      this._timerAdvancedStopAlarmAudio();
      const audio = new Audio(src);
      audio.volume = Math.max(0, Math.min(1, (volume ?? settings.alarmVolume ?? 70) / 100));
      this._timerAdvancedAlarmAudio = audio;
      audio.addEventListener('ended', () => {
        if (this._timerAdvancedAlarmAudio === audio) this._timerAdvancedAlarmAudio = null;
      }, { once: true });
      audio.play().catch(() => _timerCustomShowStatus('アラーム音源を再生できませんでした'));
      setTimeout(() => {
        if (this._timerAdvancedAlarmAudio === audio) this._timerAdvancedStopAlarmAudio();
      }, 12000);
    } catch {
      _timerCustomShowStatus('アラーム音源を再生できませんでした');
    }
  };
})();
