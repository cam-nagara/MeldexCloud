(function () {
  'use strict';

  const nav = document.getElementById('manual-navigation');
  const search = document.getElementById('manual-search');
  const searchStatus = document.getElementById('manual-search-status');
  const versionSelect = document.getElementById('manual-version-select');
  const versionStatus = document.getElementById('manual-version-status');
  const sidebar = document.getElementById('manual-sidebar');
  const tocToggle = document.getElementById('manual-toc-toggle');
  const sidebarClose = document.getElementById('manual-sidebar-close');
  const articles = Array.from(document.querySelectorAll('.manual-article'));
  const navItems = Array.from(document.querySelectorAll('.manual-nav-item'));
  const navSections = Array.from(document.querySelectorAll('.manual-nav-section'));
  const navDocuments = Array.from(document.querySelectorAll('.manual-nav-document'));
  const navGroups = Array.from(document.querySelectorAll('.manual-nav-group'));
  const articleByPath = new Map(articles.map(article => [article.dataset.manualPath, article]));
  const navItemByPath = new Map(navItems.map(item => [item.dataset.manualPath, item]));
  const navDocumentByPath = new Map(navDocuments.map(document => {
    const item = document.querySelector('.manual-nav-item');
    return [item?.dataset.manualPath || '', document];
  }));
  const searchable = navItems
    .map(item => articleByPath.get(item.dataset.manualPath))
    .filter(Boolean)
    .map(article => ({
      article,
      path: article.dataset.manualPath || '',
      text: `${article.dataset.manualTitle || ''} ${article.textContent || ''}`.toLocaleLowerCase('ja'),
    }));
  let searchMode = false;
  const currentVersion = String(document.body.dataset.manualVersion || '').trim();
  const manualRoot = new URL(document.body.dataset.manualRoot || './', window.location.href);

  function validVersionEntry(entry) {
    return entry
      && typeof entry.version === 'string'
      && typeof entry.label === 'string'
      && typeof entry.url === 'string'
      && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(entry.version)
      && !/^(?:[a-z]+:|\/\/|\/)/i.test(entry.url)
      && !entry.url.split('/').includes('..');
  }

  async function loadManualVersions() {
    if (!versionSelect || !currentVersion) return;
    try {
      const response = await fetch(new URL('manual-versions.json', manualRoot), { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const entries = Array.isArray(payload?.versions) ? payload.versions.filter(validVersionEntry) : [];
      if (payload?.type !== 'meldex-public-manual-versions' || payload?.schema_version !== 1 || !entries.length) {
        throw new Error('unexpected manual version manifest');
      }
      versionSelect.replaceChildren(...entries.map(entry => {
        const option = document.createElement('option');
        option.value = entry.version;
        option.textContent = entry.label;
        option.dataset.url = entry.url;
        return option;
      }));
      if (!entries.some(entry => entry.version === currentVersion)) {
        const option = document.createElement('option');
        option.value = currentVersion;
        option.textContent = `v${currentVersion}`;
        option.dataset.url = window.location.pathname;
        versionSelect.append(option);
      }
      versionSelect.value = currentVersion;
      versionSelect.disabled = entries.length < 2;
      if (versionStatus) versionStatus.textContent = '';
    } catch (error) {
      versionSelect.value = currentVersion;
      versionSelect.disabled = true;
      if (versionStatus) versionStatus.textContent = 'バージョン一覧を読み込めませんでした';
    } finally {
      versionSelect.setAttribute('aria-busy', 'false');
    }
  }

  function parseHash() {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return {
      path: params.get('path') || '',
      section: params.get('section') || '',
    };
  }

  function setHash(path, section, replace) {
    const params = new URLSearchParams();
    params.set('path', path);
    if (section) params.set('section', section);
    const next = `#${params.toString()}`;
    if (replace) window.history.replaceState(null, '', next);
    else window.history.pushState(null, '', next);
  }

  function closeSidebar() {
    document.body.classList.remove('manual-sidebar-open');
    tocToggle?.setAttribute('aria-expanded', 'false');
    if (tocToggle) tocToggle.textContent = '目次を開く';
  }

  function scrollToSection(article, section) {
    if (!section) {
      article.scrollIntoView({ block: 'start' });
      return;
    }
    const heading = Array.from(article.querySelectorAll('[data-manual-anchor]'))
      .find(node => node.dataset.manualAnchor === section);
    (heading || article).scrollIntoView({ block: 'start' });
  }

  function selectDocument(path, section, options) {
    const target = articleByPath.get(path) || articles[0];
    if (!target) return;
    articles.forEach(article => article.classList.toggle('is-active', article === target));
    navItems.forEach(item => {
      const active = item.dataset.manualPath === target.dataset.manualPath;
      item.classList.toggle('is-active', active);
      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    navSections.forEach(item => {
      const active = item.dataset.manualPath === target.dataset.manualPath
        && Boolean(section)
        && item.dataset.manualSection === section;
      item.classList.toggle('is-active', active);
      if (active) item.setAttribute('aria-current', 'location');
      else item.removeAttribute('aria-current');
    });
    document.title = `${target.dataset.manualTitle || 'Meldex マニュアル'} | Meldex`;
    const currentItem = navItemByPath.get(target.dataset.manualPath);
    const currentGroup = currentItem?.closest('.manual-nav-group');
    const currentDocument = currentItem?.closest('.manual-nav-document');
    if (currentGroup) currentGroup.open = true;
    if (currentDocument?.tagName === 'DETAILS') currentDocument.open = true;
    if (options?.updateHash !== false) setHash(target.dataset.manualPath, section || '', options?.replaceHash);
    if (options?.scroll !== false) requestAnimationFrame(() => scrollToSection(target, section));
    currentItem?.scrollIntoView({ block: 'nearest' });
    closeSidebar();
  }

  function normalizeQuery(value) {
    return String(value || '').trim().toLocaleLowerCase('ja').replace(/\s+/g, ' ');
  }

  function applySearch() {
    const query = normalizeQuery(search?.value);
    const terms = query ? query.split(' ') : [];
    const wasSearching = searchMode;
    if (query && !wasSearching) {
      navGroups.forEach(group => {
        group.dataset.manualOpenBeforeSearch = String(group.open);
      });
    }
    let count = 0;
    searchable.forEach(entry => {
      const visible = terms.every(term => entry.text.includes(term));
      const document = navDocumentByPath.get(entry.path);
      if (document) document.hidden = !visible;
      if (visible) count += 1;
    });
    navGroups.forEach(group => {
      const hasVisibleItem = Array.from(group.querySelectorAll('.manual-nav-document')).some(document => !document.hidden);
      group.hidden = !hasVisibleItem;
      if (query && hasVisibleItem) group.open = true;
      if (!query && wasSearching) {
        group.open = group.dataset.manualOpenBeforeSearch === 'true';
        delete group.dataset.manualOpenBeforeSearch;
      }
    });
    searchMode = Boolean(query);
    if (searchStatus) searchStatus.textContent = query ? `${count}件見つかりました` : '';
  }

  nav?.addEventListener('click', event => {
    const sectionItem = event.target.closest('.manual-nav-section');
    if (sectionItem) {
      selectDocument(sectionItem.dataset.manualPath, sectionItem.dataset.manualSection || '', { updateHash: true });
      return;
    }
    const item = event.target.closest('.manual-nav-item');
    if (!item) return;
    if (item.matches('summary.manual-nav-document-toggle')) {
      const document = item.closest('.manual-nav-document');
      const wasOpen = Boolean(document?.open);
      event.preventDefault();
      selectDocument(item.dataset.manualPath, '', { updateHash: true });
      if (document) document.open = !wasOpen;
      return;
    }
    selectDocument(item.dataset.manualPath, '', { updateHash: true });
  });

  document.addEventListener('click', event => {
    const link = event.target.closest('a[data-manual-link]');
    if (!link) return;
    event.preventDefault();
    selectDocument(link.dataset.manualLink, link.dataset.manualSection || '', { updateHash: true });
  });

  search?.addEventListener('input', applySearch);
  search?.addEventListener('search', applySearch);
  search?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      const first = navItems.find(item => !item.closest('.manual-nav-document')?.hidden);
      if (first) selectDocument(first.dataset.manualPath, '', { updateHash: true });
    }
    if (event.key === 'Escape') {
      search.value = '';
      applySearch();
    }
  });

  versionSelect?.addEventListener('change', () => {
    if (!versionSelect.value || versionSelect.value === currentVersion) return;
    const option = versionSelect.selectedOptions[0];
    const target = option?.dataset.url;
    if (!target) return;
    const destination = new URL(target, manualRoot);
    destination.hash = window.location.hash;
    window.location.assign(destination.href);
  });

  tocToggle?.addEventListener('click', () => {
    const open = document.body.classList.toggle('manual-sidebar-open');
    tocToggle.setAttribute('aria-expanded', String(open));
    tocToggle.textContent = open ? '目次を閉じる' : '目次を開く';
    if (open) search?.focus();
  });

  sidebarClose?.addEventListener('click', () => {
    closeSidebar();
    tocToggle?.focus();
  });

  window.addEventListener('hashchange', () => {
    const state = parseHash();
    selectDocument(state.path, state.section, { updateHash: false });
  });

  document.addEventListener('keydown', event => {
    if (event.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) {
      event.preventDefault();
      search?.focus();
    }
    if (event.key === 'Escape' && document.body.classList.contains('manual-sidebar-open')) closeSidebar();
  });

  document.documentElement.classList.add('manual-ready');
  void loadManualVersions();
  const initial = parseHash();
  selectDocument(initial.path, initial.section, { updateHash: !initial.path, replaceHash: true, scroll: false });
}());
