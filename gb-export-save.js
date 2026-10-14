/* gb-export-save.js: エクスポート保存ダイアログ共通 helper */

const MeldexExportSave = (() => {
  const RESERVED_WINDOWS_NAMES = new Set([
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
  ]);
  const LARGE_BLOB_PICKER_THRESHOLD = 8 * 1024 * 1024;
  const ASSET_BASE_TOKEN = '__MELDEX_ASSET_BASE__';

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

  function _isBrowserDataContext() {
    try { return !!window.MeldexRuntimeAdapter?.isBrowserDataMode?.(); }
    catch { return false; }
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

  async function _saveTextWithBrowserPicker(content, initialfile, options = {}) {
    const blob = new Blob([options.bom ? '\uFEFF' + String(content || '') : String(content || '')], {
      type: options.mime || 'text/html;charset=utf-8',
    });
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: initialfile });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        _notifyManualSaveSuccess(options.okMessage || '保存しました');
        return { ok: true, path: handle.name || initialfile, etag: '', browser_destination: 'file-picker' };
      } catch (error) {
        if (error?.name === 'AbortError') {
          if (typeof showStatus === 'function') showStatus(options.cancelMessage || '保存をキャンセルしました');
          return false;
        }
      }
    }
    if (!_downloadBlobDirect(blob, initialfile)) {
      if (typeof showStatus === 'function') showStatus(options.errorMessage || '保存に失敗しました', true);
      return false;
    }
    _notifyManualSaveSuccess((options.okMessage || '保存しました') + '（ダウンロード: ' + initialfile + '）');
    return { ok: true, path: initialfile, etag: '', browser_destination: 'download' };
  }

  function _validatePublicationPackage(publicationPackage) {
    const html = String(publicationPackage?.html || '');
    const assets = Array.isArray(publicationPackage?.assets) ? publicationPackage.assets : [];
    const names = new Set();
    for (const asset of assets) {
      const name = String(asset?.name || '');
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(name) || name.includes('..')) {
        throw new Error('公開資産のファイル名が安全ではありません');
      }
      if (names.has(name.toLowerCase())) throw new Error('公開資産のファイル名が重複しています');
      if (!(asset.blob instanceof Blob) || Number(asset.size) !== asset.blob.size
        || !/^[0-9a-f]{64}$/.test(String(asset.sha256 || ''))) {
        throw new Error('公開資産manifestの整合性を確認できません');
      }
      names.add(name.toLowerCase());
      if (!html.includes(`${ASSET_BASE_TOKEN}/${name}`)) {
        throw new Error('公開HTMLと資産manifestの参照が一致しません');
      }
    }
    const refs = Array.from(html.matchAll(/__MELDEX_ASSET_BASE__\/([A-Za-z0-9][A-Za-z0-9._-]{0,159})/g), match => match[1]);
    if (refs.some(name => !names.has(name.toLowerCase()))) {
      throw new Error('公開HTMLにmanifest未登録の資産があります');
    }
    return { html, assets };
  }

  async function _publicationGeneration(html, assets) {
    if (!globalThis.crypto?.subtle) throw new Error('公開packageの整合性hashを計算できません');
    const parts = [String(html)];
    [...assets].sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(asset => {
      parts.push('\0asset\0', String(asset.name), '\0', String(asset.sha256));
    });
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('')));
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('').slice(0, 24);
  }

  function _splitStem(fileName) {
    const safe = _sanitizeFileName(fileName || '公開.html', '公開.html', 180);
    const match = safe.match(/(\.[^.]+)$/);
    return { fileName: safe, stem: match ? safe.slice(0, -match[1].length) : safe };
  }

  async function _materializePublicationPackage(publicationPackage, fileName) {
    const { html, assets } = _validatePublicationPackage(publicationPackage);
    const { fileName: safeFileName, stem } = _splitStem(fileName);
    const generation = await _publicationGeneration(html, assets);
    const assetDirectory = `${stem}.assets`;
    return {
      html: html.replaceAll(ASSET_BASE_TOKEN, `${assetDirectory}/${generation}`),
      assets,
      fileName: safeFileName,
      assetDirectory,
      generation,
    };
  }

  async function _blobBase64(blob) {
    const reader = new FileReader();
    const dataUrl = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('公開資産を読み込めませんでした'));
      reader.readAsDataURL(blob);
    });
    return dataUrl.split(',', 2)[1] || '';
  }

  async function _blobSha256(blob) {
    if (!globalThis.crypto?.subtle?.digest) throw new Error('公開資産の整合性hashを確認できません');
    const digest = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  }

  async function _verifyPublicationAssetHandle(handle, asset) {
    if (!handle || typeof handle.getFile !== 'function') {
      throw new Error(`公開資産の保存後検証に対応していません: ${asset.name}`);
    }
    const saved = await handle.getFile();
    if (Number(saved?.size) !== Number(asset.size) || await _blobSha256(saved) !== asset.sha256) {
      throw new Error(`公開資産の保存後検証に失敗しました: ${asset.name}`);
    }
  }

  async function _publicationAssetPayload(assets) {
    const payload = [];
    for (const asset of assets) {
      payload.push({
        name: asset.name,
        mime: asset.mime || asset.blob.type || 'application/octet-stream',
        size: asset.size,
        sha256: asset.sha256,
        content_base64: await _blobBase64(asset.blob),
      });
    }
    return payload;
  }

  async function _directoryHasFile(directory, name) {
    try { await directory.getFileHandle(name, { create: false }); return true; }
    catch { return false; }
  }

  async function _uniqueHtmlFileName(directory, requested) {
    const split = splitFileName(requested, '公開', '.html');
    if (!await _directoryHasFile(directory, split.initialfile)) return split.initialfile;
    const stem = split.initialfile.slice(0, -split.extension.length);
    for (let index = 2; index <= 9999; index += 1) {
      const candidate = `${stem} (${index})${split.extension}`;
      if (!await _directoryHasFile(directory, candidate)) return candidate;
    }
    throw new Error('同名の公開packageが多すぎるため保存できません');
  }

  async function _savePublicationPackageBrowser(publicationPackage, initialfile, options) {
    const checked = _validatePublicationPackage(publicationPackage);
    if (!checked.assets.length) {
      return _saveTextWithBrowserPicker(checked.html, initialfile, options);
    }
    if (typeof window.showDirectoryPicker === 'function') {
      try {
        const directory = await window.showDirectoryPicker({ mode: 'readwrite' });
        const chosenName = await _uniqueHtmlFileName(directory, initialfile);
        const materialized = await _materializePublicationPackage(checked, chosenName);
        const assetRoot = await directory.getDirectoryHandle(materialized.assetDirectory, { create: true });
        const generationRoot = await assetRoot.getDirectoryHandle(materialized.generation, { create: true });
        for (const asset of materialized.assets) {
          const handle = await generationRoot.getFileHandle(asset.name, { create: true });
          const writable = await handle.createWritable();
          await writable.write(asset.blob);
          await writable.close();
          await _verifyPublicationAssetHandle(handle, asset);
        }
        // HTMLを最後に確定する。途中失敗時は旧HTMLを上書きせず、未参照の世代だけが残る。
        const htmlHandle = await directory.getFileHandle(materialized.fileName, { create: true });
        const htmlWritable = await htmlHandle.createWritable();
        await htmlWritable.write(new Blob([
          options?.bom ? '\uFEFF' + materialized.html : materialized.html,
        ], { type: 'text/html;charset=utf-8' }));
        await htmlWritable.close();
        _notifyManualSaveSuccess(options?.okMessage || 'HTML packageを保存しました');
        return {
          ok: true,
          path: materialized.fileName,
          etag: '',
          browser_destination: 'directory-picker',
          publication_assets: {
            count: materialized.assets.length,
            total_bytes: materialized.assets.reduce((sum, asset) => sum + asset.size, 0),
            directory: materialized.assetDirectory,
            generation: materialized.generation,
          },
        };
      } catch (error) {
        if (error?.name === 'AbortError') {
          if (typeof showStatus === 'function') showStatus(options?.cancelMessage || '保存をキャンセルしました');
          return false;
        }
        if (typeof showStatus === 'function') showStatus(options?.errorMessage || error?.message || '保存に失敗しました', true);
        return false;
      }
    }
    if (typeof window.MeldexArchiveZipEngine?.buildZip !== 'function') {
      if (typeof showStatus === 'function') showStatus('このブラウザでは複数ファイルのHTML packageを安全に保存できません', true);
      return false;
    }
    const materialized = await _materializePublicationPackage(checked, initialfile);
    const entries = [{ name: materialized.fileName, data: new TextEncoder().encode(materialized.html) }];
    for (const asset of materialized.assets) {
      entries.push({
        name: `${materialized.assetDirectory}/${materialized.generation}/${asset.name}`,
        data: new Uint8Array(await asset.blob.arrayBuffer()),
      });
    }
    const zipBytes = await window.MeldexArchiveZipEngine.buildZip(entries);
    const zipName = `${materialized.fileName.replace(/\.html?$/i, '')}-html-package.zip`;
    if (!_downloadBlobDirect(new Blob([zipBytes], { type: 'application/zip' }), zipName)) return false;
    _notifyManualSaveSuccess('HTML packageをZIPで保存しました。展開して利用してください。');
    return { ok: true, path: zipName, etag: '', browser_destination: 'package-download' };
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
    if (_isBrowserDataContext()) {
      const { initialfile } = splitFileName(
        options.initialfile || options.filename || '',
        options.title || options.fallbackTitle || '無題',
        options.extension || '.txt'
      );
      return _saveTextWithBrowserPicker(content, initialfile, options);
    }
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
      ...(options.publishContext ? { publish_context: options.publishContext } : {}),
      ...(options.operationId ? { operation_id: String(options.operationId) } : {}),
    }, {
      ok: options.okMessage || '保存しました',
      cancel: options.cancelMessage || '保存をキャンセルしました',
      error: options.errorMessage || '保存に失敗しました',
    });
  }

  async function saveTextDirect(path, content, options = {}) {
    if (_isBrowserDataContext()) {
      return saveText(content, { ...options, initialfile: guessNameFromPath(path, '公開.html') });
    }
    try {
      const res = await apiPost('/save-file-direct', {
        path,
        content: options.bom ? '\uFEFF' + String(content || '') : String(content || ''),
        allow_register: !!options.allowRegister,
        ...(options.ifMatchEtag ? { if_match_etag: String(options.ifMatchEtag) } : {}),
        ...(options.createOnly ? { create_only: true } : {}),
        ...(options.publishContext ? { publish_context: options.publishContext } : {}),
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

  async function savePublicationPackage(publicationPackage, options = {}) {
    const fallbackExtension = options.extension || '.html';
    const { initialfile, extension } = splitFileName(
      options.initialfile || options.filename || '',
      options.title || options.fallbackTitle || '公開',
      fallbackExtension
    );
    if (_isBrowserDataContext() || _isStandaloneContext()) {
      return _savePublicationPackageBrowser(publicationPackage, initialfile, options);
    }
    const checked = _validatePublicationPackage(publicationPackage);
    return _showDialog({
      title: options.dialogTitle || 'HTML packageとして保存',
      initialfile,
      defaultextension: extension,
      filetypes: options.filetypes || [['HTMLファイル', '*.html'], ['すべてのファイル', '*.*']],
      content: options.bom ? '\uFEFF' + checked.html : checked.html,
      publication_assets: await _publicationAssetPayload(checked.assets),
      register_publish_path: !!options.registerPublishPath,
      ...(options.publishContext ? { publish_context: options.publishContext } : {}),
      ...(options.operationId ? { operation_id: String(options.operationId) } : {}),
    }, {
      ok: options.okMessage || 'HTML packageを保存しました',
      cancel: options.cancelMessage || '保存をキャンセルしました',
      error: options.errorMessage || 'HTML packageの保存に失敗しました',
    });
  }

  async function savePublicationPackageDirect(path, publicationPackage, options = {}) {
    if (_isBrowserDataContext() || _isStandaloneContext()) {
      return savePublicationPackage(publicationPackage, {
        ...options,
        initialfile: guessNameFromPath(path, '公開.html'),
      });
    }
    const checked = _validatePublicationPackage(publicationPackage);
    try {
      const res = await apiPost('/save-file-direct', {
        path,
        content: options.bom ? '\uFEFF' + checked.html : checked.html,
        publication_assets: await _publicationAssetPayload(checked.assets),
        ...(options.ifMatchEtag ? { if_match_etag: String(options.ifMatchEtag) } : {}),
        ...(options.createOnly ? { create_only: true } : {}),
        ...(options.publishContext ? { publish_context: options.publishContext } : {}),
      });
      if (res?.ok) {
        _notifyManualSaveSuccess((options.okMessage || '公開HTMLを更新しました') + ': ' + res.path);
        return res;
      }
      return false;
    } catch (error) {
      if (typeof showStatus === 'function') showStatus(options.errorMessage || error?.message || '公開HTMLの更新に失敗しました', true);
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
    if (_isBrowserDataContext()) {
      // Cloud/PWA ではデスクトップ専用の保存APIへ到達させない。Blobの大きさに
      // かかわらず browser picker を優先し、利用できない場合はdownloadへ落とす。
      const pickerResult = await _saveBlobWithBrowserPicker(blob, initialfile, {
        ok: options.okMessage || '保存しました',
        cancel: options.cancelMessage || '保存をキャンセルしました',
        error: options.errorMessage || '保存に失敗しました',
      });
      if (pickerResult !== null) return pickerResult;
      return _standaloneSaveBlob(blob, { ...options, initialfile });
    }
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
    savePublicationPackage,
    savePublicationPackageDirect,
    saveBlob,
    saveUrl,
  };

})();

if (typeof window !== 'undefined') {
  window.MeldexExportSave = MeldexExportSave;
}
