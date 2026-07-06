/* gb-board-image-drop-mode.js: image file drop storage mode */
(function (global) {
  'use strict';

  const MODE_EMBED = 'embed';
  const MODE_LINK = 'link';
  const KEY_MAIN = 'meldex-board-image-drop-mode';
  const KEY_STANDALONE = 'meldex-board-image-drop-mode-standalone';
  let modeChangePromise = null;

  function isStandaloneBoardApp() {
    if (!global || typeof document === 'undefined') return false;
    if (global.MeldexBoardStandalone) return true;
    if (document.body?.classList?.contains('bsa-board-ready')) return true;
    if (document.getElementById('board-standalone-shell')) return true;
    try {
      return String(global.location?.pathname || '').includes('board-standalone');
    } catch (e) {
      return false;
    }
  }

  function defaultImageDropMode() {
    return isStandaloneBoardApp() ? MODE_EMBED : MODE_LINK;
  }

  function storageKey() {
    return isStandaloneBoardApp() ? KEY_STANDALONE : KEY_MAIN;
  }

  function normalizeImageDropMode(mode) {
    const value = String(mode || '').trim().toLowerCase();
    if (value === MODE_EMBED) return MODE_EMBED;
    if (value === MODE_LINK) return MODE_LINK;
    return '';
  }

  function getImageDropMode() {
    if (typeof localStorage !== 'undefined') {
      try {
        const saved = normalizeImageDropMode(localStorage.getItem(storageKey()));
        if (saved) return saved;
      } catch (e) {}
    }
    return defaultImageDropMode();
  }

  function storeImageDropMode(mode) {
    const next = normalizeImageDropMode(mode) || defaultImageDropMode();
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem(storageKey(), next); } catch (e) {}
    }
    return next;
  }

  function imageDropModeLabel(mode) {
    return normalizeImageDropMode(mode) === MODE_EMBED
      ? 'ファイルに埋め込む'
      : '画像ファイルへのリンク';
  }

  function boardState() {
    if (global.bd && Array.isArray(global.bd.nodes)) return global.bd;
    if (typeof bd !== 'undefined' && bd && Array.isArray(bd.nodes)) return bd;
    return null;
  }

  function imageNodes() {
    return (boardState()?.nodes || []).filter(node => node && node.img);
  }

  function isDataUrl(value) {
    return /^data:/i.test(String(value || '').trim());
  }

  function safeDecode(value) {
    try { return decodeURIComponent(String(value || '').replace(/\+/g, '%20')); }
    catch (e) { return String(value || ''); }
  }

  function rawImagePath(value) {
    const raw = String(value || '').trim();
    if (!raw || isDataUrl(raw)) return '';
    try {
      const parsed = new URL(raw, global.location?.href || 'http://localhost/');
      if (/\/(?:api\/)?(?:file-raw|media\/file)$/i.test(parsed.pathname)) {
        return String(parsed.searchParams.get('path') || '').replace(/\\/g, '/');
      }
    } catch (e) {}
    const match = raw.match(/\/(?:api\/)?(?:file-raw|media\/file)\?[^#]*?\bpath=([^&#]+)/i);
    return match ? safeDecode(match[1]).replace(/\\/g, '/') : '';
  }

  function nodeLinkPath(node) {
    return String(node?.link || node?.imageSourcePath || rawImagePath(node?.img) || '').trim().replace(/\\/g, '/');
  }

  function nodeActiveLinkPath(node) {
    return String(node?.link || rawImagePath(node?.img) || '').trim().replace(/\\/g, '/');
  }

  function rememberImageSourcePath(node, path) {
    const sourcePath = String(path || '').trim().replace(/\\/g, '/');
    if (node && sourcePath) node.imageSourcePath = sourcePath;
    return sourcePath;
  }

  function fileRawUrl(path) {
    const base = typeof global.API_BASE === 'string' ? global.API_BASE : (isStandaloneBoardApp() ? '/api' : '');
    return base + '/file-raw?path=' + encodeURIComponent(String(path || '').replace(/\\/g, '/'));
  }

  function filenamePart(path) {
    return String(path || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
  }

  function mimeExtension(dataUrl) {
    const mime = (/^data:([^;,]+)/i.exec(String(dataUrl || '')) || [])[1] || '';
    const map = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/bmp': '.bmp',
      'image/svg+xml': '.svg',
      'image/avif': '.avif',
      'image/x-icon': '.ico',
      'image/vnd.microsoft.icon': '.ico',
    };
    return map[mime.toLowerCase()] || '.png';
  }

  function sanitizeFilename(name) {
    return String(name || 'image')
      .replace(/[\r\n]+/g, ' ')
      .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_')
      .replace(/^[. ]+|[. ]+$/g, '')
      || 'image';
  }

  function filenameForNode(node, index, dataUrl, filenameHint) {
    const fromText = String(node?.text || '').split('\n')[0].trim();
    const fromHint = filenameHint ? sanitizeFilename(filenameHint) : '';
    const fromPath = filenamePart(nodeLinkPath(node));
    let name = sanitizeFilename(fromText || fromHint || fromPath || ('image-' + (index + 1)));
    if (!/\.[a-z0-9]{2,8}$/i.test(name)) name += mimeExtension(dataUrl);
    return name;
  }

  function boardUploadDir() {
    const path = String(boardState()?.path || '').replace(/\\/g, '/');
    const slash = path.lastIndexOf('/');
    return slash >= 0 ? path.slice(0, slash) : '';
  }

  function blobToDataUrl(blob) {
    if (typeof FileReader === 'function') {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = event => resolve(String(event.target?.result || reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('画像を読み込めませんでした'));
        reader.readAsDataURL(blob);
      });
    }
    if (blob && typeof blob.arrayBuffer === 'function' && typeof Buffer !== 'undefined') {
      return blob.arrayBuffer().then(buffer => {
        const type = blob.type || 'application/octet-stream';
        return 'data:' + type + ';base64,' + Buffer.from(buffer).toString('base64');
      });
    }
    return Promise.reject(new Error('画像を読み込めませんでした'));
  }

  async function fetchUrlAsDataUrl(url) {
    if (typeof fetch !== 'function') throw new Error('画像を読み込めませんでした');
    const response = await fetch(url, { cache: 'no-store' });
    if (!response?.ok) throw new Error('画像ファイルを読み込めませんでした');
    return blobToDataUrl(await response.blob());
  }

  async function imagePathToDataUrl(path) {
    const relPath = String(path || '').replace(/\\/g, '/');
    if (relPath && global.BoardStandaloneFS && typeof global.BoardStandaloneFS.readFileAsDataUrl === 'function') {
      return global.BoardStandaloneFS.readFileAsDataUrl(relPath);
    }
    return fetchUrlAsDataUrl(fileRawUrl(relPath));
  }

  async function imagePathExists(path) {
    const relPath = String(path || '').trim().replace(/\\/g, '/');
    if (!relPath) return false;
    try {
      await imagePathToDataUrl(relPath);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function nodeImageToDataUrl(node) {
    if (isDataUrl(node?.img)) return String(node.img);
    const path = nodeLinkPath(node);
    if (path) return imagePathToDataUrl(path);
    return fetchUrlAsDataUrl(String(node?.img || ''));
  }

  function boardRequestToken() {
    const state = boardState();
    return {
      path: String(state?.path || ''),
      openSeq: Number(state?._openSeq) || 0,
    };
  }

  function isSameBoardToken(token) {
    const state = boardState();
    return !!state
      && String(state.path || '') === token.path
      && ((Number(state._openSeq) || 0) === token.openSeq);
  }

  async function cleanupUploads(paths) {
    const targets = [...new Set((paths || []).filter(Boolean))];
    if (!targets.length) return;
    const jobs = targets.map(path => {
      if (typeof global.apiPost === 'function') return global.apiPost('/outliner/delete', { path }, { silentError: true });
      if (typeof global.apiFetch === 'function') {
        return global.apiFetch('/outliner/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          silentError: true,
          body: JSON.stringify({ path }),
        });
      }
      return Promise.resolve();
    });
    await Promise.allSettled(jobs);
  }

  function refreshBoardAfterImageModeChange(changedIds) {
    if (typeof global.bdRender === 'function') global.bdRender();
    if (typeof global.bdDrawConns === 'function') global.bdDrawConns();
    if (typeof global.bdDrawFrames === 'function') global.bdDrawFrames();
    if (typeof global.bdSyncBoardUi === 'function') global.bdSyncBoardUi(true);
    if (typeof global.bdMarkExtrasDirty === 'function') {
      global.bdMarkExtrasDirty({ minimap: true, boardUi: true, comments: changedIds || [] }, 'image-drop-mode');
    }
    if (typeof global.bdDirty === 'function') global.bdDirty();
  }

  async function convertImagesToEmbed(nodes, token) {
    const targets = nodes.filter(node => node.img && !isDataUrl(node.img));
    if (!targets.length) return 0;
    const changes = [];
    for (const node of targets) {
      changes.push({ node, path: nodeLinkPath(node), dataUrl: await nodeImageToDataUrl(node) });
    }
    if (!isSameBoardToken(token)) throw new Error('別のボードに切り替わったため、変換を中止しました');
    if (typeof global.bdPushUndo === 'function') global.bdPushUndo();
    changes.forEach(({ node, path, dataUrl }) => {
      node.img = dataUrl;
      if (!node.text && path) node.text = filenamePart(path);
      node.link = '';
      node.linkType = 'image';
      rememberImageSourcePath(node, path);
    });
    refreshBoardAfterImageModeChange(changes.map(change => change.node.id).filter(Boolean));
    return changes.length;
  }

  async function uploadImageDataUrl(node, index, dataUrl, filenameHint) {
    if (typeof global.apiFetch !== 'function') throw new Error('画像ファイルを保存できませんでした');
    const result = await global.apiFetch('/upload-file?path=' + encodeURIComponent(boardUploadDir()), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: dataUrl, filename: filenameForNode(node, index, dataUrl, filenameHint) }),
    });
    if (!result?.ok || !result.path) throw new Error('画像ファイルを保存できませんでした');
    return String(result.path).replace(/\\/g, '/');
  }

  async function linkChangeForNode(node, index, uploadedPaths) {
    const currentPath = nodeLinkPath(node);
    if (currentPath) {
      if (!isDataUrl(node?.img) || await imagePathExists(currentPath)) {
        return { node, path: currentPath, uploaded: false };
      }
      const dataUrl = await nodeImageToDataUrl(node);
      const path = await uploadImageDataUrl(node, index, dataUrl);
      uploadedPaths.push(path);
      return { node, path, uploaded: true, missingSource: currentPath };
    }
    const dataUrl = await nodeImageToDataUrl(node);
    const path = await uploadImageDataUrl(node, index, dataUrl);
    uploadedPaths.push(path);
    return { node, path, uploaded: true };
  }

  async function convertImagesToLink(nodes, token) {
    const targets = nodes.filter(node => {
      if (!node.img) return false;
      const path = nodeLinkPath(node);
      return !path || node.link !== path || node.img !== fileRawUrl(path) || node.linkType !== 'image';
    });
    if (!targets.length) return 0;
    const uploadedPaths = [];
    try {
      const changes = [];
      for (let index = 0; index < targets.length; index += 1) {
        changes.push(await linkChangeForNode(targets[index], index, uploadedPaths));
      }
      if (!isSameBoardToken(token)) throw new Error('別のボードに切り替わったため、変換を中止しました');
      if (typeof global.bdPushUndo === 'function') global.bdPushUndo();
      changes.forEach(({ node, path }) => {
        node.link = path;
        node.linkType = 'image';
        node.img = fileRawUrl(path);
        rememberImageSourcePath(node, path);
      });
      refreshBoardAfterImageModeChange(changes.map(change => change.node.id).filter(Boolean));
      return changes.length;
    } catch (error) {
      await cleanupUploads(uploadedPaths);
      throw error;
    }
  }

  async function convertCurrentBoardImages(mode) {
    const state = boardState();
    if (!state) return 0;
    const nodes = imageNodes();
    if (!nodes.length) return 0;
    const token = boardRequestToken();
    if (mode === MODE_EMBED) return convertImagesToEmbed(nodes, token);
    return convertImagesToLink(nodes, token);
  }

  async function applyImageDropMode(mode) {
    const next = normalizeImageDropMode(mode) || defaultImageDropMode();
    const previous = getImageDropMode();
    const label = imageDropModeLabel(next);
    if (modeChangePromise) {
      if (typeof global.showStatus === 'function') global.showStatus('画像追加方式を切り替え中です');
      return modeChangePromise;
    }
    modeChangePromise = (async () => {
      try {
        if (imageNodes().length && typeof global.showStatus === 'function') {
          global.showStatus('画像追加方式を切り替えています: ' + label);
        }
        const changed = await convertCurrentBoardImages(next);
        storeImageDropMode(next);
        if (typeof global.showStatus === 'function') {
          const suffix = changed ? '（' + changed + '件変換）' : '';
          global.showStatus('画像追加方式: ' + label + suffix);
        }
        return next;
      } catch (error) {
        storeImageDropMode(previous);
        if (typeof global.showStatus === 'function') {
          global.showStatus('画像追加方式を切り替えられませんでした: ' + (error?.message || error), true);
        }
        return previous;
      } finally {
        modeChangePromise = null;
      }
    })();
    return modeChangePromise;
  }

  function setImageDropMode(mode) {
    return applyImageDropMode(mode);
  }

  function toggleImageDropMode() {
    return setImageDropMode(getImageDropMode() === MODE_EMBED ? MODE_LINK : MODE_EMBED);
  }

  function missingImagePathLabel(node) {
    return nodeActiveLinkPath(node) || nodeLinkPath(node);
  }

  async function promptRelocateImageSource(node) {
    const currentPath = missingImagePathLabel(node);
    const picker = global.BoardStandaloneFS && typeof global.BoardStandaloneFS.pickImageFile === 'function'
      ? global.BoardStandaloneFS.pickImageFile
      : null;
    if (picker) {
      try {
        const picked = await picker(currentPath);
        if (picked) return picked;
      } catch (error) {
        if (typeof global.showStatus === 'function') {
          global.showStatus('画像ファイルを選択できませんでした: ' + (error?.message || error), true);
        }
      }
    }
    const promptFn = typeof global.cfPrompt === 'function'
      ? global.cfPrompt
      : ((message, defaultValue) => Promise.resolve(global.prompt ? global.prompt(message, defaultValue) : null));
    const path = await promptFn('画像ファイルの新しい場所を入力してください', currentPath, { okLabel: '再指定' });
    if (path == null || String(path).trim() === '') return null;
    return { path: String(path).trim().replace(/\\/g, '/') };
  }

  async function buildRelocatedImageChange(node, source) {
    const mode = getImageDropMode();
    const picked = source && typeof source === 'object' ? source : { path: source };
    let path = String(picked.path || picked.relPath || '').trim().replace(/\\/g, '/');
    let dataUrl = String(picked.dataUrl || picked.data || '').trim();
    const name = String(picked.name || filenamePart(path) || filenamePart(missingImagePathLabel(node)) || '').trim();

    if (mode === MODE_EMBED) {
      if (!dataUrl) dataUrl = await imagePathToDataUrl(path);
      if (!dataUrl) throw new Error('画像ファイルを読み込めませんでした');
      return {
        img: dataUrl,
        link: '',
        linkType: 'image',
        imageSourcePath: path || '',
        text: node?.text || name,
      };
    }

    if (path && !await imagePathExists(path)) {
      if (!dataUrl) throw new Error('画像ファイルを読み込めませんでした');
      path = '';
    }
    if (!path && dataUrl) path = await uploadImageDataUrl(node, 0, dataUrl, name);
    if (!path) throw new Error('画像ファイルの場所を取得できませんでした');
    return {
      img: fileRawUrl(path),
      link: path,
      linkType: 'image',
      imageSourcePath: path,
      text: node?.text || name,
    };
  }

  async function relocateImageNode(nodeId, source) {
    const state = boardState();
    const node = state?.nodes?.find(item => item && item.id === nodeId);
    if (!node || !node.img) return false;
    const picked = source == null ? await promptRelocateImageSource(node) : source;
    if (!picked) return false;
    const token = boardRequestToken();
    let next;
    try {
      next = await buildRelocatedImageChange(node, picked);
    } catch (error) {
      if (typeof global.showStatus === 'function') {
        global.showStatus('画像ファイルを再指定できませんでした: ' + (error?.message || error), true);
      }
      return false;
    }
    if (!isSameBoardToken(token)) {
      if (typeof global.showStatus === 'function') global.showStatus('別のボードに切り替わったため、画像の再指定を中止しました', true);
      return false;
    }
    if (typeof global.bdPushUndo === 'function') global.bdPushUndo();
    node.img = next.img;
    node.link = next.link;
    node.linkType = next.linkType;
    if (Object.prototype.hasOwnProperty.call(next, 'imageSourcePath')) {
      if (next.imageSourcePath) node.imageSourcePath = next.imageSourcePath;
      else delete node.imageSourcePath;
    }
    if (!node.text && next.text) node.text = next.text;
    node._imageLoadError = false;
    delete node._imageLoadErrorAt;
    refreshBoardAfterImageModeChange([node.id].filter(Boolean));
    if (typeof global.showStatus === 'function') global.showStatus('画像ファイルを再指定しました');
    return true;
  }

  global.bdNormalizeImageDropMode = normalizeImageDropMode;
  global.bdGetImageDropMode = getImageDropMode;
  global.bdSetImageDropMode = setImageDropMode;
  global.bdToggleImageDropMode = toggleImageDropMode;
  global.bdImageDropModeLabel = imageDropModeLabel;
  global.bdImageNodeLinkPath = nodeLinkPath;
  global.bdImageMissingPathLabel = missingImagePathLabel;
  global.bdRelocateImageNode = relocateImageNode;
  global.bdConvertCurrentBoardImagesForDropMode = convertCurrentBoardImages;
})(window);
