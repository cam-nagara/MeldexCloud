(function () {
  'use strict';

  window._archiveBrowseContext = null;

  function virtualPath(archivePath, member) {
    return 'zip:' + archivePath + '!/' + String(member || '');
  }

  function archiveFileUrl(item) {
    return '/api/archive/file?path=' + encodeURIComponent(item.archive_path)
      + '&member=' + encodeURIComponent(item.archive_member);
  }

  function archiveViewerUrl(item) {
    return '/viewer?archive=' + encodeURIComponent(item.archive_path)
      + '&member=' + encodeURIComponent(item.archive_member);
  }

  function updateReadOnlyBadge(visible) {
    document.getElementById('folder-archive-readonly-badge')?.remove();
    if (!visible) return;
    const title = document.getElementById('folder-title');
    if (!title?.parentElement) return;
    const badge = document.createElement('span');
    badge.id = 'folder-archive-readonly-badge';
    badge.className = 'gb-badge';
    badge.style.cssText = 'margin-left:8px;white-space:nowrap;';
    badge.textContent = 'ZIP内は読み取り専用';
    title.after(badge);
  }

  async function openArchiveFolder(archivePath, member, opts) {
    const options = opts || {};
    const normalizedMember = String(member || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const path = virtualPath(archivePath, normalizedMember);
    if (!options.skipShowView && typeof showView === 'function') showView('folder');
    if (typeof showLoading === 'function' && !options.silent) showLoading('ZIPの内容を読み込み中...');
    try {
      const data = await apiFetch('/archive/browse?path=' + encodeURIComponent(archivePath)
        + '&member=' + encodeURIComponent(normalizedMember), { silentError: true });
      window._archiveBrowseContext = {
        archivePath: data.archive_path || archivePath,
        member: data.member || '',
        virtualPath: path,
      };
      _folderPath = path;
      _folderItems = Array.isArray(data.items) ? data.items : [];
      _folderSelected = null;
      _folderSelectedItems = [];
      const title = data.name || String(archivePath).split(/[\\/]/).pop() || 'ZIP';
      document.getElementById('folder-title').textContent = title;
      const currentTitle = document.getElementById('current-title');
      if (currentTitle && !options.skipGlobalUi) currentTitle.textContent = title;
      updateReadOnlyBadge(true);
      if (typeof registerFileTypes === 'function') registerFileTypes(_folderItems);
      renderFolderGrid({ resetScrollTop: true });
      if (!options.skipNavPush && typeof navPush === 'function') {
        navPush({
          type: 'archive',
          label: title,
          path,
          archivePath: data.archive_path || archivePath,
          member: data.member || '',
        });
      }
      if (!options.skipSaveLastView && typeof saveLastView === 'function') {
        saveLastView({
          type: 'archive',
          label: title,
          path,
          archivePath: data.archive_path || archivePath,
          member: data.member || '',
        });
      }
      if (typeof showStatus === 'function' && !options.skipGlobalUi) {
        showStatus('ZIP内は読み取り専用です');
      }
      return true;
    } catch (error) {
      if (typeof showStatus === 'function') {
        showStatus('ZIPを開けませんでした: ' + (error?.userMessage || error?.message || error), true);
      }
      return false;
    } finally {
      if (typeof hideLoading === 'function' && !options.silent) hideLoading();
    }
  }

  function openArchiveItem(item) {
    if (!item?.archive_path || !item?.archive_member) return false;
    if (item.is_dir || item.type === 'folder') {
      openArchiveFolder(item.archive_path, item.archive_member);
      return true;
    }
    if (item.type === 'image' || (item.type === 'document' && /\.pdf$/i.test(item.name || ''))) {
      openViewer(archiveViewerUrl(item));
      return true;
    }
    if (item.type === 'video' || item.type === 'audio') {
      openMedia(item.name, item.path, item.type, { rawUrl: archiveFileUrl(item), skipHighlight: true });
      return true;
    }
    openViewer(archiveFileUrl(item), { skipHighlight: true });
    return true;
  }

  function showArchiveItemContextMenu(event, item) {
    event.preventDefault();
    document.querySelectorAll('.gb-context-menu').forEach(menu => menu.remove());
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'gb-context-menu-item';
    open.textContent = '開く';
    open.addEventListener('click', () => {
      menu.remove();
      if (item?.archive_path) openArchiveItem(item);
    });
    const info = document.createElement('div');
    info.className = 'gb-context-menu-item disabled';
    info.textContent = 'ZIP内は読み取り専用';
    menu.append(open, info);
    const rect = { left: event.clientX, right: event.clientX, top: event.clientY, bottom: event.clientY };
    if (typeof positionPopup === 'function') positionPopup(menu, rect, { prefer: 'below', gap: 4 });
    else {
      menu.style.left = event.clientX + 'px';
      menu.style.top = event.clientY + 'px';
      document.body.appendChild(menu);
    }
    setTimeout(() => {
      const close = click => {
        if (menu.contains(click.target)) return;
        menu.remove();
        document.removeEventListener('pointerdown', close);
      };
      document.addEventListener('pointerdown', close);
    }, 0);
  }

  window.openArchiveFolder = openArchiveFolder;
  window.openArchiveItem = openArchiveItem;
  window.showArchiveItemContextMenu = showArchiveItemContextMenu;
  window.MeldexArchiveBrowser = {
    openFolder: openArchiveFolder,
    openItem: openArchiveItem,
    fileUrl: archiveFileUrl,
    viewerUrl: archiveViewerUrl,
    clear() {
      window._archiveBrowseContext = null;
      updateReadOnlyBadge(false);
    },
  };
})();
