/* gb-export-save.js: エクスポート保存ダイアログ共通 helper */

const MeldexExportSave = (() => {
  const RESERVED_WINDOWS_NAMES = new Set([
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
  ]);
  const LARGE_BLOB_PICKER_THRESHOLD = 8 * 1024 * 1024;

  function _sanitizeFileName(name, fallback = '無題', maxLen = 180) {
    let safe = String(name || fallback)
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/\.\./g, '')
      .trim()
      .replace(/[. ]+$/g, '');
    if (!safe) safe = fallback;
    const match = safe.match(/(\.[^.]+)$/);
    const ext = match ? match[1] : '';
    let stem = ext ? safe.slice(0, -ext.length) : safe;
    if (RESERVED_WINDOWS_NAMES.has(stem.toUpperCase())) stem += '_';
    safe = stem + ext;
    if (safe.length > maxLen) {
      const keep = Math.max(1, maxLen - ext.length);
      safe = stem.slice(0, keep).replace(/[. ]+$/g, '') + ext;
    }
    return safe || fallback;
  }

  function sanitizeTitle(title, fallback = '無題') {
    return _sanitizeFileName(title, fallback, 80);
  }

  function guessNameFromPath(path, fallback = '無題') {
    const raw = String(path || '').replace(/\\/g, '/').split('/').pop() || '';
    return raw || fallback;
  }

  function splitFileName(fileName = '', fallbackTitle = '無題', fallbackExtension = '.bin') {
    const normalized = String(fileName || '').trim();
    if (!normalized) {
      return { initialfile: sanitizeTitle(fallbackTitle, fallbackTitle) + fallbackExtension, extension: fallbackExtension };
    }
    const safeName = _sanitizeFileName(normalized, sanitizeTitle(fallbackTitle, fallbackTitle), 180);
    const match = safeName.match(/(\.[^.]+)$/);
    return {
      initialfile: safeName,
      extension: match ? match[1] : fallbackExtension,
    };
  }

  function _parseContentDispositionFileName(headerValue = '') {
    const src = String(headerValue || '');
    if (!src) return '';
    const utf8Match = src.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
      try { return decodeURIComponent(utf8Match[1]); } catch {}
    }
    const quotedMatch = src.match(/filename\s*=\s*"([^"]+)"/i);
    if (quotedMatch?.[1]) return quotedMatch[1];
    const plainMatch = src.match(/filename\s*=\s*([^;]+)/i);
    return plainMatch?.[1]?.trim() || '';
  }

  function _notifyManualSaveSuccess(message) {
    const text = String(message || '保存しました');
    if (typeof showSaveDialog === 'function') {
      showSaveDialog(text);
      return;
    }
    if (typeof showStatus === 'function') showStatus(text, false, { showSaveDialog: true });
  }

  // 単独アプリ（ノート/シナリオ/シート/タイマー/ボード）判定。
  // これらのページだけが window.MeldexStandaloneFS または window.BoardStandaloneFS を
  // 定義するため、本体 Meldex.html では常に false になる（本体の挙動には影響しない）。
  function _isStandaloneContext() {
    return typeof window !== 'undefined' && !!(window.MeldexStandaloneFS || window.BoardStandaloneFS);
  }

  // 単独アプリには /api/save-file-dialog（サーバー側ネイティブダイアログ）が無いため、
  // ブラウザの通常ダウンロード（Blob URL + <a download>）でファイルを書き出す。
  // 保存先フォルダを選ばせられない点は本体の名前を付けて保存ダイアログに劣るが、
  // Windows単独exe・Cloud静的版・PWAのいずれでも共通に動作する。
  function _downloadBlobDirect(blob, filename) {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || '無題';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 4000);
      return true;
    } catch {
      return false;
    }
  }

  async function _standaloneSaveText(content, options = {}) {
    const fallbackExtension = options.extension || '.txt';
    const { initialfile } = splitFileName(
      options.initialfile || options.filename || '',
      options.title || options.fallbackTitle || '無題',
      fallbackExtension
    );
    const blob = new Blob([options.bom ? '\uFEFF' + String(content || '') : String(content || '')], {
      type: options.mime || 'text/plain;charset=utf-8',
    });
    if (!_downloadBlobDirect(blob, initialfile)) {
      if (typeof showStatus === 'function') showStatus(options.errorMessage || '保存に失敗しました', true);
      return false;
    }
    _notifyManualSaveSuccess((options.okMessage || '保存しました') + '（ダウンロード: ' + initialfile + '）');
    return { ok: true, path: initialfile };
  }

  async function _standaloneSaveBlob(blob, options = {}) {
    const fallbackExtension = options.extension || '.bin';
    const { initialfile } = splitFileName(
      options.initialfile || options.filename || '',
      options.title || options.fallbackTitle || '無題',
      fallbackExtension
    );
    if (!_downloadBlobDirect(blob, initialfile)) {
      if (typeof showStatus === 'function') showStatus(options.errorMessage || '保存に失敗しました', true);
      return false;
    }
    _notifyManualSaveSuccess((options.okMessage || '保存しました') + '（ダウンロード: ' + initialfile + '）');
    return { ok: true, path: initialfile };
  }

  async function _showDialog(payload, messages = {}) {
    try {
      const res = await apiPost('/save-file-dialog', payload);
      if (res?.cancelled) {
        if (typeof showStatus === 'function') showStatus(messages.cancel || '保存をキャンセルしました');
        return false;
      }
      if (res?.ok) {
        _notifyManualSaveSuccess((messages.ok || '保存しました') + ': ' + res.path);
        return res;
      }
      if (typeof showStatus === 'function') showStatus(messages.error || '保存に失敗しました', true);
      return false;
    } catch (err) {
      if (typeof showStatus === 'function') showStatus(messages.error || (err?.message || '保存に失敗しました'), true);
      return false;
    }
  }

  async function saveText(content, options = {}) {
    if (_isStandaloneContext()) return _standaloneSaveText(content, options);
    const fallbackExtension = options.extension || '.txt';
    const { initialfile, extension } = splitFileName(
      options.initialfile || options.filename || '',
      options.title || options.fallbackTitle || '無題',
      fallbackExtension
    );
    return _showDialog({
      title: options.dialogTitle || '書き出して保存',
      initialfile,
      defaultextension: extension,
      filetypes: options.filetypes || [['すべてのファイル', '*.*']],
      content: options.bom ? '\uFEFF' + String(content || '') : String(content || ''),
      register_publish_path: !!options.registerPublishPath,
    }, {
      ok: options.okMessage || '保存しました',
      cancel: options.cancelMessage || '保存をキャンセルしました',
      error: options.errorMessage || '保存に失敗しました',
    });
  }

  async function saveTextDirect(path, content, options = {}) {
    try {
      const res = await apiPost('/save-file-direct', {
        path,
        content: options.bom ? '\uFEFF' + String(content || '') : String(content || ''),
        allow_register: !!options.allowRegister,
      });
      if (res?.ok) {
        _notifyManualSaveSuccess((options.okMessage || '上書き保存しました') + ': ' + res.path);
        return res;
      }
      return false;
    } catch (err) {
      if (typeof showStatus === 'function') showStatus(options.errorMessage || (err?.message || '保存に失敗しました'), true);
      return false;
    }
  }

  async function saveBlob(blob, options = {}) {
    const fallbackExtension = options.extension || '.bin';
    const { initialfile, extension } = splitFileName(
      options.initialfile || options.filename || '',
      options.title || options.fallbackTitle || '無題',
      fallbackExtension
    );
    if (_isStandaloneContext()) {
      // 単独アプリには /api/save-file-dialog が無い。File System Access API
      // (showSaveFilePicker) が使える環境ではファイル名/保存先を選べる方を優先し、
      // 使えない環境（一部のwebview等）は通常のダウンロードにフォールバックする。
      const pickerResult = await _saveBlobWithBrowserPicker(blob, initialfile, {
        ok: options.okMessage || '保存しました',
        cancel: options.cancelMessage || '保存をキャンセルしました',
        error: options.errorMessage || '保存に失敗しました',
      });
      if (pickerResult !== null) return pickerResult;
      return _standaloneSaveBlob(blob, options);
    }
    const pickerThreshold = options.browserPickerThreshold || LARGE_BLOB_PICKER_THRESHOLD;
    if (blob?.size > pickerThreshold) {
      const pickerResult = await _saveBlobWithBrowserPicker(blob, initialfile, {
        ok: options.okMessage || '保存しました',
        cancel: options.cancelMessage || '保存をキャンセルしました',
        error: options.errorMessage || '保存に失敗しました',
      });
      if (pickerResult !== null) return pickerResult;
    }
    let dataUrl = '';
    try {
      const reader = new FileReader();
      dataUrl = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('ファイル内容を読み込めませんでした'));
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      if (typeof showStatus === 'function') showStatus(options.errorMessage || (err?.message || '保存に失敗しました'), true);
      return false;
    }
    return _showDialog({
      title: options.dialogTitle || '書き出して保存',
      initialfile,
      defaultextension: extension,
      filetypes: options.filetypes || [['すべてのファイル', '*.*']],
      content_base64: String(dataUrl || '').split(',')[1] || '',
      binary: true,
    }, {
      ok: options.okMessage || '保存しました',
      cancel: options.cancelMessage || '保存をキャンセルしました',
      error: options.errorMessage || '保存に失敗しました',
    });
  }

  async function _saveBlobWithBrowserPicker(blob, initialfile, messages = {}) {
    if (typeof window === 'undefined' || typeof window.showSaveFilePicker !== 'function') return null;
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: initialfile });
      const writable = await handle.createWritable();
      await blob.stream().pipeTo(writable);
      _notifyManualSaveSuccess(messages.ok || '保存しました');
      return true;
    } catch (err) {
      if (err?.name === 'AbortError') {
        if (typeof showStatus === 'function') showStatus(messages.cancel || '保存をキャンセルしました');
        return false;
      }
      return null;
    }
  }

  async function saveUrl(url, options = {}) {
    try {
      const headers = { ...(options.headers || {}) };
      try {
        if (options.auth !== false && typeof _authToken !== 'undefined' && _authToken && !headers.Authorization) {
          headers.Authorization = 'Bearer ' + _authToken;
        }
      } catch {}
      const res = await fetch(url, { credentials: 'same-origin', headers });
      if (!res.ok) {
        throw new Error(options.errorMessage || `保存元の取得に失敗しました (${res.status})`);
      }
      const headerName = _parseContentDispositionFileName(res.headers.get('content-disposition'));
      const fallbackName = options.filename
        || (sanitizeTitle(options.title || options.fallbackTitle || guessNameFromPath(options.path || '', '無題'), options.fallbackTitle || '無題')
          + (options.extension || '.bin'));
      const blob = await res.blob();
      return saveBlob(blob, {
        ...options,
        filename: headerName || fallbackName,
      });
    } catch (err) {
      if (typeof showStatus === 'function') showStatus(options.errorMessage || (err?.message || '保存に失敗しました'), true);
      return false;
    }
  }

  return {
    sanitizeTitle,
    guessNameFromPath,
    splitFileName,
    saveText,
    saveTextDirect,
    saveBlob,
    saveUrl,
  };

})();

if (typeof window !== 'undefined') {
  window.MeldexExportSave = MeldexExportSave;
}
