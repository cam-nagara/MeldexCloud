(function () {
  'use strict';

  const nav = document.getElementById('manual-navigation');
  const search = document.getElementById('manual-search');
  const searchStatus = document.getElementById('manual-search-status');
  const sidebar = document.getElementById('manual-sidebar');
  const tocToggle = document.getElementById('manual-toc-toggle');
  const sidebarClose = document.getElementById('manual-sidebar-close');
  const articles = Array.from(document.querySelectorAll('.manual-article'));
  const navItems = Array.from(document.querySelectorAll('.manual-nav-item'));
  const articleByPath = new Map(articles.map(article => [article.dataset.manualPath, article]));
  const navItemByPath = new Map(navItems.map(item => [item.dataset.manualPath, item]));
  const searchable = articles.map(article => ({
    article,
    path: article.dataset.manualPath || '',
    text: `${article.dataset.manualTitle || ''} ${article.textContent || ''}`.toLocaleLowerCase('ja'),
  }));

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
    document.title = `${target.dataset.manualTitle || 'Meldex マニュアル'} | Meldex`;
    if (options?.updateHash !== false) setHash(target.dataset.manualPath, section || '', options?.replaceHash);
    if (options?.scroll !== false) requestAnimationFrame(() => scrollToSection(target, section));
    navItemByPath.get(target.dataset.manualPath)?.scrollIntoView({ block: 'nearest' });
    closeSidebar();
  }

  function normalizeQuery(value) {
    return String(value || '').trim().toLocaleLowerCase('ja').replace(/\s+/g, ' ');
  }

  function applySearch() {
    const query = normalizeQuery(search?.value);
    const terms = query ? query.split(' ') : [];
    let count = 0;
    searchable.forEach(entry => {
      const visible = terms.every(term => entry.text.includes(term));
      const item = navItemByPath.get(entry.path);
      if (item) item.hidden = !visible;
      if (visible) count += 1;
    });
    document.querySelectorAll('.manual-nav-group').forEach(group => {
      group.hidden = !Array.from(group.querySelectorAll('.manual-nav-item')).some(item => !item.hidden);
    });
    if (searchStatus) searchStatus.textContent = query ? `${count}件見つかりました` : '';
  }

  nav?.addEventListener('click', event => {
    const item = event.target.closest('.manual-nav-item');
    if (!item) return;
    selectDocument(item.dataset.manualPath, '', { updateHash: true });
  });

  document.addEventListener('click', event => {
    const link = event.target.closest('a[data-manual-link]');
    if (!link) return;
    event.preventDefault();
    selectDocument(link.dataset.manualLink, link.dataset.manualSection || '', { updateHash: true });
  });

  search?.addEventListener('input', applySearch);
  search?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      const first = navItems.find(item => !item.hidden);
      if (first) selectDocument(first.dataset.manualPath, '', { updateHash: true });
    }
    if (event.key === 'Escape') {
      search.value = '';
      applySearch();
    }
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
  const initial = parseHash();
  selectDocument(initial.path, initial.section, { updateHash: !initial.path, replaceHash: true, scroll: false });
}());
