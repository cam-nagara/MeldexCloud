  /* gb-chat-markdown.part02.js: チャット内リンクの解決とオープン処理
     （Meldex内パスの候補生成・実在確認、ノート見出しへのスクロール、
     裸書きリンクの実在確認、種別ごとの表示先の振り分け）。 */

  function _pushUniquePath(list, value) {
    const path = String(value || '').trim();
    if (!path) return;
    const key = path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    if (!key || list.some(item => item.key === key)) return;
    list.push({ path, key });
  }

  function _pathHasExtension(path) {
    return !!_extension(path);
  }

  function _pushWorkspacePathVariants(list, path) {
    const clean = String(path || '').trim();
    if (!clean) return;
    _pushUniquePath(list, clean);
    if (_pathHasExtension(clean) || /[\\/]$/.test(clean)) return;
    ['.md', '.mel-board', '.mel-sheet', '.mel-scenario', '.mel-timer', '.scriptnote.json', '.timer.json', '.json', '.csv'].forEach(ext => _pushUniquePath(list, clean + ext));
  }

  function _joinWorkspacePath(root, rel) {
    const base = String(root || '').trim().replace(/[\\\/]+$/, '');
    const child = String(rel || '').trim().replace(/^[\\\/]+/, '');
    return base && child ? (base + '/' + child) : (base || child);
  }

  function _pushWorkspaceResolvedVariants(list, root, target) {
    const rel = String(target || '').trim().replace(/^[\\\/]+/, '');
    if (!rel) return;
    const joined = _joinWorkspacePath(root, rel);
    _pushWorkspacePathVariants(list, joined);
    if (_extension(rel) !== '.md') return;
    const slash = Math.max(rel.lastIndexOf('/'), rel.lastIndexOf('\\'));
    const parent = slash >= 0 ? rel.slice(0, slash) : '';
    const fileName = slash >= 0 ? rel.slice(slash + 1) : rel;
    const stem = fileName.slice(0, -3);
    if (!stem) return;
    const sheetFolder = _joinWorkspacePath(root, _joinWorkspacePath(parent, stem));
    _pushUniquePath(list, sheetFolder);
    _pushUniquePath(list, _joinWorkspacePath(sheetFolder, fileName));
  }

  function _currentChatWorkFolder() {
    try {
      if (typeof _chatEffectiveWorkFolder === 'function') {
        return String(_chatEffectiveWorkFolder() || '').trim();
      }
    } catch {}
    try {
      const snapshot = global.MeldexChatCurrentTarget?.snapshot?.();
      const path = _normalizeSlashPath(snapshot?.path || '');
      if (!path) return '';
      if (snapshot?.kind === 'folder') return path;
      const slash = path.lastIndexOf('/');
      return slash > 0 ? path.slice(0, slash) : '';
    } catch {
      return '';
    }
  }

  function _workspaceTargetStem(path) {
    const name = _basename(path).toLowerCase();
    const suffixes = ['.scriptnote.json', '.timer.json', '.mel-scenario', '.mel-board', '.mel-sheet', '.mel-timer', '.board.md', '.md'];
    const suffix = suffixes.find(value => name.endsWith(value));
    return suffix ? name.slice(0, -suffix.length) : name;
  }

  function _isWorkspaceChildPath(path, root) {
    const cleanPath = _normalizeSlashPath(path).toLowerCase();
    const cleanRoot = _normalizeSlashPath(root).toLowerCase();
    return !!cleanPath && !!cleanRoot && (cleanPath === cleanRoot || cleanPath.startsWith(cleanRoot + '/'));
  }

  function _loadedWorkspacePathCandidates(target, currentFolder) {
    const cleanTarget = _normalizeSlashPath(target);
    const targetKey = cleanTarget.toLowerCase();
    const targetStem = _workspaceTargetStem(cleanTarget);
    if (!targetKey || !targetStem || !global.document?.querySelectorAll) return [];
    const exact = [];
    const byName = [];
    global.document.querySelectorAll('#outliner-tree .tree-node[data-path]').forEach(node => {
      const path = String(node?._nodeData?.path || node?.dataset?.path || '').trim();
      if (!path) return;
      const pathKey = _normalizeSlashPath(path).toLowerCase();
      const nameStem = _workspaceTargetStem(node?._nodeData?.name || path);
      if (pathKey === targetKey || pathKey.endsWith('/' + targetKey)) exact.push(path);
      else if (nameStem === targetStem || _workspaceTargetStem(path) === targetStem) byName.push(path);
    });
    const chooseUnique = matches => {
      const unique = [...new Map(matches.map(path => [_normalizeSlashPath(path).toLowerCase(), path])).values()];
      const contextual = currentFolder ? unique.filter(path => _isWorkspaceChildPath(path, currentFolder)) : [];
      if (contextual.length === 1) return contextual;
      return unique.length === 1 ? unique : [];
    };
    const exactMatch = chooseUnique(exact);
    return exactMatch.length ? exactMatch : chooseUnique(byName);
  }

  // 保存先の一覧は、リンクの確認1件ごとに3回ずつ取り直していた。短い間だけ使い回す。
  const WORKSPACE_ROOTS_REUSE_MS = 10000;
  let _workspaceRootsCache = null;

  function _workspaceRoots() {
    const now = Date.now();
    if (_workspaceRootsCache && now - _workspaceRootsCache.at < WORKSPACE_ROOTS_REUSE_MS) return _workspaceRootsCache.promise;
    const promise = _loadWorkspaceRoots();
    _workspaceRootsCache = { at: now, promise };
    promise.catch(() => { if (_workspaceRootsCache?.promise === promise) _workspaceRootsCache = null; });
    return promise;
  }

  async function _loadWorkspaceRoots() {
    if (typeof apiFetch !== 'function') return [];
    const roots = [];
    const addRoot = (kind, payload) => {
      const path = String(payload?.path || '').trim();
      if (!path) return;
      const key = path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
      if (roots.some(root => root.key === key)) return;
      roots.push({ kind, path, key });
    };
    const [vaultRes, homeRes, outlinerRes] = await Promise.allSettled([
      apiFetch('/vault'),
      apiFetch('/home-folder'),
      apiFetch('/outliner-roots'),
    ]);
    if (vaultRes.status === 'fulfilled') addRoot('vault', vaultRes.value);
    if (homeRes.status === 'fulfilled') addRoot('home', homeRes.value);
    if (outlinerRes.status === 'fulfilled' && Array.isArray(outlinerRes.value)) {
      outlinerRes.value.forEach(root => {
        if (root?.visible === false) return;
        addRoot('source', root);
      });
    }
    return roots;
  }

  function _currentChatSourceRoot() {
    try {
      if (typeof _chatSourceFolderValue === 'function') return String(_chatSourceFolderValue() || '').trim();
    } catch {}
    return '';
  }

  function _rootPrefixedRelative(rootPath, target) {
    const rootName = _basename(rootPath);
    const clean = _normalizeSlashPath(target);
    if (!rootName || !clean) return '';
    if (clean === rootName) return '';
    if (clean.startsWith(rootName + '/')) return clean.slice(rootName.length + 1);
    return '';
  }

  async function _workspacePathCandidates(target) {
    const cleanTarget = _normalizeMarkdownTarget(target).replace(/^meldex:\/\//i, '').replace(/^vault:\/\//i, 'vault:/');
    const candidates = [];
    const roots = await _workspaceRoots();
    const virtual = cleanTarget.match(/^(home|source|vault):\/+(.*)$/i);
    if (virtual) {
      const kind = virtual[1].toLowerCase();
      const rel = virtual[2] || '';
      const preferred = kind === 'home'
        ? roots.find(root => root.kind === 'home')?.path
        : kind === 'source'
          ? (_currentChatSourceRoot() || roots.find(root => root.kind === 'vault')?.path || roots.find(root => root.kind === 'source')?.path)
          : roots.find(root => root.kind === 'vault')?.path;
      if (preferred) _pushWorkspacePathVariants(candidates, _joinWorkspacePath(preferred, rel));
      _pushWorkspacePathVariants(candidates, rel);
      return candidates.map(item => item.path);
    }

    const currentFolder = _currentChatWorkFolder();
    const isBareTarget = !/[\\/]/.test(cleanTarget);
    if (isBareTarget && currentFolder) _pushWorkspaceResolvedVariants(candidates, currentFolder, cleanTarget);
    _loadedWorkspacePathCandidates(cleanTarget, currentFolder).forEach(path => _pushWorkspacePathVariants(candidates, path));
    _pushWorkspacePathVariants(candidates, cleanTarget);
    roots.forEach(root => {
      const rel = _rootPrefixedRelative(root.path, cleanTarget);
      if (rel) _pushWorkspaceResolvedVariants(candidates, root.path, rel);
      _pushWorkspaceResolvedVariants(candidates, root.path, cleanTarget);
    });
    return candidates.map(item => item.path);
  }

  async function _checkWorkspaceCandidate(cleanPath) {
    if (typeof apiFetch !== 'function') return { type: '', exists: false };
    try {
      const resolved = await apiFetch('/check-type?path=' + encodeURIComponent(cleanPath));
      return {
        type: String(resolved?.type || ''),
        exists: resolved?.exists === true || (resolved?.exists == null && String(resolved?.type || '') !== 'unknown'),
      };
    } catch {
      return { type: '', exists: false };
    }
  }

  // 裸書きリンクの実在確認では、同じ候補パスを別のリンクでも何度も問い合わせていた
  // （拡張子違い・ソースフォルダ違いで1件あたり最大百通り近く）。結果を短い間だけ共有する。
  // クリックで開く時は使い回さず、その場で確かめる。
  const CANDIDATE_CHECK_REUSE_MS = 15000;
  const CANDIDATE_CHECK_CACHE_LIMIT = 2000;
  const _candidateChecks = new Map();

  function _checkWorkspaceCandidateReused(cleanPath) {
    const key = String(cleanPath || '').replace(/\\/g, '/').toLowerCase();
    const now = Date.now();
    const cached = _candidateChecks.get(key);
    if (cached && now - cached.at < CANDIDATE_CHECK_REUSE_MS) return cached.promise;
    if (_candidateChecks.size >= CANDIDATE_CHECK_CACHE_LIMIT) {
      const oldest = _candidateChecks.keys().next().value;
      if (oldest !== undefined) _candidateChecks.delete(oldest);
    }
    const promise = _checkWorkspaceCandidate(cleanPath);
    _candidateChecks.set(key, { at: now, promise });
    return promise;
  }

  async function _resolveWorkspaceTarget(target, options = {}) {
    const candidates = await _workspacePathCandidates(target);
    const check = options.reuseChecks ? _checkWorkspaceCandidateReused : _checkWorkspaceCandidate;
    for (const candidate of candidates) {
      const checked = await check(candidate);
      if (checked.exists) return { path: candidate, type: checked.type, exists: true };
    }
    return { path: candidates[0] || target, type: '', exists: false };
  }

  function _normalizeHeadingText(value) {
    return String(value || '').replace(/\s+/g, '').replace(/^[#＃]+/, '').trim().toLowerCase();
  }

  // 見出しを探す範囲。チャット吹き出し自身もMarkdown見出しを描画するため必ず除外する。
  function _noteHeadingSearchRoots() {
    const doc = global.document;
    if (!doc?.querySelectorAll) return [];
    const roots = [];
    const add = (element) => {
      if (!element || roots.includes(element)) return;
      if (element.closest?.('.chat-markdown, .chat-message-bubble')) return;
      roots.push(element);
    };
    add(doc.getElementById('page-content'));
    doc.querySelectorAll('[contenteditable="true"]').forEach(add);
    return roots;
  }

  // `パス#見出し名` の見出し部分を解決する。安定アンカーID（見出しの右クリック
  // 「この見出しへのリンクをコピー」が作る形式）と、見出しの文字そのものの両方を受け付ける。
  // AIは内部IDを知らないため、実運用では文字一致がほぼすべてになる。
  function _findNoteHeadingElement(anchor) {
    const id = String(anchor || '').trim();
    if (!id) return null;
    const headings = [];
    _noteHeadingSearchRoots().forEach(root => {
      root.querySelectorAll?.('h1, h2, h3, h4, h5, h6').forEach(element => {
        if (!headings.includes(element)) headings.push(element);
      });
    });
    if (!headings.length) return null;
    const byId = headings.find(element => element.dataset?.noteHeadingId === id
      || element.dataset?.noteHeadingLegacyId === id
      || element.id === id);
    if (byId) return byId;
    const wanted = _normalizeHeadingText(id);
    if (!wanted) return null;
    return headings.find(element => _normalizeHeadingText(element.textContent) === wanted)
      || headings.find(element => _normalizeHeadingText(element.textContent).startsWith(wanted))
      || null;
  }

  async function _scrollToNoteHeading(anchor, { timeoutMs = 6000 } = {}) {
    const id = String(anchor || '').trim();
    if (!id || !global.document) return false;
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    for (;;) {
      const target = _findNoteHeadingElement(id);
      if (target) {
        try {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch {
          target.scrollIntoView();
        }
        target.classList?.add('chat-link-heading-flash');
        global.setTimeout?.(() => target.classList?.remove('chat-link-heading-flash'), 1600);
        return true;
      }
      if (Date.now() >= deadline) break;
      await new Promise(resolve => global.setTimeout?.(resolve, 120) ?? resolve());
    }
    if (typeof showStatus === 'function') showStatus('リンク先の見出しが見つかりません: ' + id);
    return false;
  }

  // 裸書きリンクの実在確認結果。同じ文字列を毎回問い合わせないためのキャッシュ。
  // 値は true（実在）/ false（実在しない）/ Promise（確認中）。
  const _bareLinkExistence = new Map();
  const BARE_LINK_CACHE_LIMIT = 500;

  function _rememberBareLinkExistence(target, value) {
    if (_bareLinkExistence.size >= BARE_LINK_CACHE_LIMIT) {
      const oldest = _bareLinkExistence.keys().next().value;
      if (oldest !== undefined) _bareLinkExistence.delete(oldest);
    }
    _bareLinkExistence.set(target, value);
  }

  function _demoteBareWorkspaceLink(target) {
    const doc = global.document;
    if (!doc?.querySelectorAll) return;
    doc.querySelectorAll('a.chat-md-link[data-chat-link-bare="true"]').forEach(link => {
      if (link.dataset.chatLinkTarget !== target || !link.parentNode) return;
      link.replaceWith(doc.createTextNode(link.textContent || target));
    });
  }

  // 実在確認は同時に2件までにする。長い会話を開くと数十件が一斉に走り、
  // 本体の処理を占有して画面全体が重くなっていた。
  const BARE_LINK_CHECK_CONCURRENCY = 2;
  const _bareLinkCheckQueue = [];
  let _bareLinkChecksRunning = 0;

  function _runQueuedBareLinkCheck(task) {
    return new Promise((resolve, reject) => {
      _bareLinkCheckQueue.push({ task, resolve, reject });
      _drainBareLinkChecks();
    });
  }

  function _drainBareLinkChecks() {
    while (_bareLinkChecksRunning < BARE_LINK_CHECK_CONCURRENCY && _bareLinkCheckQueue.length) {
      const { task, resolve, reject } = _bareLinkCheckQueue.shift();
      _bareLinkChecksRunning += 1;
      Promise.resolve().then(task).then(resolve, reject).finally(() => {
        _bareLinkChecksRunning -= 1;
        _drainBareLinkChecks();
      });
    }
  }

  // 会話を開いた直後は発言ごとに確認が呼ばれる。少し待って、その間に集まった
  // リンクの候補をすべて1回の問い合わせで確かめる（/api/paths/exist）。使えない環境
  // （クラウド版など）では1件ずつの確認へ戻る。
  const BARE_LINK_BATCH_DELAY_MS = 60;
  const BARE_LINK_BATCH_CHUNK = 400;
  let _bareLinkBatch = null;
  let _bareLinkBatchUnsupported = false;

  async function _pathsExistBatch(paths) {
    const exists = new Set();
    for (let index = 0; index < paths.length; index += BARE_LINK_BATCH_CHUNK) {
      const chunk = paths.slice(index, index + BARE_LINK_BATCH_CHUNK);
      const headers = { 'Content-Type': 'application/json' };
      if (typeof _authToken !== 'undefined' && _authToken) headers.Authorization = 'Bearer ' + _authToken;
      const base = typeof API_BASE === 'string' ? API_BASE : '/api';
      // 書き込み用の送信関数を通すと、成功のたびに画面側の読み込みキャッシュが捨てられるため直接送る。
      const response = await fetch(base + '/paths/exist', { method: 'POST', headers, body: JSON.stringify({ paths: chunk }) });
      if (!response.ok) throw new Error('paths-exist-unavailable');
      const data = await response.json();
      if (!data || typeof data.results !== 'object') throw new Error('paths-exist-unavailable');
      chunk.forEach(path => { if (data.results[path] === true) exists.add(path); });
    }
    return exists;
  }

  async function _flushBareLinkBatch(batch) {
    const entries = [...batch.entries()];
    try {
      if (_bareLinkBatchUnsupported) throw new Error('paths-exist-unavailable');
      const candidateLists = await Promise.all(entries.map(([target]) => _workspacePathCandidates(_splitTargetAnchor(target).path)));
      const exists = await _pathsExistBatch([...new Set(candidateLists.flat())]);
      entries.forEach(([, waiter], index) => waiter.resolve({ exists: candidateLists[index].some(path => exists.has(path)) }));
    } catch (_error) {
      _bareLinkBatchUnsupported = true;
      entries.forEach(([target, waiter]) => {
        _runQueuedBareLinkCheck(() => _resolveWorkspaceTarget(_splitTargetAnchor(target).path, { reuseChecks: true }))
          .then(waiter.resolve, waiter.reject);
      });
    }
  }

  function _checkBareLinkTarget(target) {
    if (!_bareLinkBatch) {
      const batch = new Map();
      _bareLinkBatch = batch;
      global.setTimeout(() => {
        if (_bareLinkBatch === batch) _bareLinkBatch = null;
        _flushBareLinkBatch(batch);
      }, BARE_LINK_BATCH_DELAY_MS);
    }
    const existing = _bareLinkBatch.get(target);
    if (existing) return existing.promise;
    const waiter = {};
    waiter.promise = new Promise((resolve, reject) => { waiter.resolve = resolve; waiter.reject = reject; });
    _bareLinkBatch.set(target, waiter);
    return waiter.promise;
  }

  function _verifyBareWorkspaceLinks(root) {
    if (!root?.querySelectorAll || typeof apiFetch !== 'function') return;
    const links = [...root.querySelectorAll('a.chat-md-link[data-chat-link-bare="true"]')];
    if (!links.length) return;
    const targets = [...new Set(links.map(link => link.dataset.chatLinkTarget).filter(Boolean))];
    targets.forEach(target => {
      const cached = _bareLinkExistence.get(target);
      if (cached === false) {
        _demoteBareWorkspaceLink(target);
        return;
      }
      if (cached !== undefined) return;
      const pending = _checkBareLinkTarget(target)
        .then(resolved => {
          _rememberBareLinkExistence(target, !!resolved?.exists);
          if (!resolved?.exists) _demoteBareWorkspaceLink(target);
          return !!resolved?.exists;
        })
        .catch(() => {
          // 確認できなかった場合はリンクのまま残す（クリック時に改めて解決する）。
          _bareLinkExistence.delete(target);
          return true;
        });
      _rememberBareLinkExistence(target, pending);
    });
  }

  function _activateChatWorkspaceOpenPane() {
    try {
      if (global.GBPaneBridge?.activateFileOpenPane) {
        return global.GBPaneBridge.activateFileOpenPane({ source: 'chat-link' }) || '';
      }
    } catch {}
    return '';
  }

  function _usesWorkspaceOpenPane(type, ext) {
    if (type === 'chat') return false;
    if (['folder', 'database', 'board', 'scriptnote', 'scenario', 'calendar', 'page'].includes(type)) return true;
    if (['.mel-board', '.mel-sheet', '.mel-scenario', '.scriptnote.json', '.csv', '.html', '.htm', '.pdf'].includes(ext)) return true;
    return IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext) || AUDIO_EXTS.has(ext);
  }

  async function _openWorkspacePath(path, anchor) {
    const target = String(path || '').trim();
    if (!target) return false;
    const resolvedTarget = await _resolveWorkspaceTarget(target);
    const cleanPath = resolvedTarget.path;
    const label = _basename(cleanPath);
    const type = resolvedTarget.type;
    if (!resolvedTarget.exists) {
      if (typeof showStatus === 'function') showStatus('リンク先が見つかりません: ' + label, true);
      return false;
    }
    const ext = _extension(cleanPath);
    const targetPaneId = _usesWorkspaceOpenPane(type, ext) ? _activateChatWorkspaceOpenPane() : '';
    const opts = { fromExplorer: true, source: 'chat-link' };
    if (targetPaneId) opts.paneId = targetPaneId;
    try {
      if (type === 'folder') await openFolder(label, cleanPath, opts);
      else if (type === 'database') await selectDatabase(cleanPath, null, opts);
      else if (type === 'board' && typeof openBoard === 'function') await openBoard(label, cleanPath, opts);
      else if ((type === 'scriptnote' || type === 'scenario') && typeof openScenarioInScriptNote === 'function') openScenarioInScriptNote(cleanPath, label, opts);
      else if (type === 'calendar' && typeof openCalendarFile === 'function') await openCalendarFile(label, cleanPath, opts);
      else if (type === 'chat' && typeof openSavedChat === 'function') await openSavedChat(cleanPath);
      else if (type === 'page' && typeof openPage === 'function') await openPage(label, cleanPath, opts);
      else if (ext === '.mel-board' && typeof openBoard === 'function') await openBoard(label, cleanPath, opts);
      else if (ext === '.mel-sheet' && typeof selectDatabase === 'function') await selectDatabase(cleanPath, null, opts);
      else if ((ext === '.mel-scenario' || ext === '.scriptnote.json') && typeof openScenarioInScriptNote === 'function') openScenarioInScriptNote(cleanPath, label, opts);
      else if (ext === '.csv' && typeof openCsvFile === 'function') await openCsvFile(label, cleanPath, opts);
      else if ((ext === '.html' || ext === '.htm') && typeof openHtmlFile === 'function') await openHtmlFile(label, cleanPath, opts);
      else if (ext === '.pdf' && typeof openViewer === 'function') openViewer('/viewer?pdf=' + encodeURIComponent(cleanPath), opts);
      else if (IMAGE_EXTS.has(ext)) {
        if (typeof openViewer === 'function') openViewer('/viewer?file=' + encodeURIComponent(cleanPath), opts);
        else await openNative(cleanPath);
      } else if ((VIDEO_EXTS.has(ext) || AUDIO_EXTS.has(ext)) && typeof openMedia === 'function') {
        await openMedia(label, cleanPath, VIDEO_EXTS.has(ext) ? 'video' : 'audio', opts);
      } else if (typeof openNative === 'function') {
        await openNative(cleanPath);
      } else if (typeof showStatus === 'function') {
        showStatus('リンクを開けませんでした', true);
      }
      // 見出しへのスクロールはノートだけ。シートやボードに `#...` が付いていても
      // 見つからない通知を出さず、ファイルを開くところまでで止める。
      if (anchor && (type === 'page' || ext === '.md' || ext === '.txt')) _scrollToNoteHeading(anchor);
      return true;
    } catch (error) {
      if (typeof showStatus === 'function') showStatus('リンクを開けませんでした: ' + (error?.message || error), true);
      return false;
    }
  }

  async function _openAbsoluteLocalPath(path) {
    const target = String(path || '').trim();
    if (!target) return false;
    try {
      if (typeof apiPost === 'function') {
        const dangerous = /\.(?:exe|com|bat|cmd|ps1|vbs|js|jse|wsf|wsh|msi|msp|scr|lnk|url)$/i.test(target);
        if (dangerous) {
          const confirmed = typeof cfConfirm === 'function'
            ? await cfConfirm('次のPC内ファイルを実行しますか？\n' + target)
            : false;
          if (!confirmed) return false;
        }
        await apiPost('/open-local-path', { path: target, confirmed_dangerous: dangerous });
        if (typeof showStatus === 'function') showStatus('ネイティブアプリで開きました');
        return true;
      }
      if (typeof openNative === 'function') {
        await openNative(target);
        return true;
      }
    } catch (error) {
      if (typeof showStatus === 'function') showStatus('開けませんでした: ' + (error?.message || error), true);
    }
    return false;
  }

  async function openChatMarkdownTarget(rawTarget) {
    const target = _normalizeMarkdownTarget(rawTarget);
    if (!target) return false;
    if (_isWebUrl(target)) {
      global.open(target, '_blank', 'noopener');
      return true;
    }
    const rawPath = _targetFromFileRawUrl(target);
    if (rawPath) return _openWorkspacePath(rawPath);
    if (_isFileUrl(target)) {
      const filePath = _fileUrlToPath(target);
      const roots = await _workspaceRoots();
      return roots.some(root => _isWorkspaceChildPath(filePath, root.path))
        ? _openWorkspacePath(filePath)
        : _openAbsoluteLocalPath(filePath);
    }
    // ここから先は `パス#見出し名` を受け付ける（開いた後にその見出しまでスクロールする）。
    const { path: targetPath, anchor } = _splitTargetAnchor(target);
    if (_isAbsoluteLocalPath(targetPath)) {
      const roots = await _workspaceRoots();
      return roots.some(root => _isWorkspaceChildPath(targetPath, root.path))
        ? _openWorkspacePath(targetPath, anchor)
        : _openAbsoluteLocalPath(targetPath);
    }
    return _openWorkspacePath(targetPath, anchor);
  }

  global.renderChatMarkdown = renderChatMarkdown;
  global.openChatMarkdownTarget = openChatMarkdownTarget;
})(window);
