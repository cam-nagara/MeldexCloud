    text = text.replace(/\s*[（(][^（）()]*(?:件|枚)[）)]$/, '').trim();
    return text;
  }

  function resolve(label) {
    const key = normalizeLabel(label);
    if (!key || ICONLESS.has(key)) return '';
    return ICONS[key] || '';
  }

  // 既に描画済みのメニューで、アイコンの無い項目へ対応表のアイコンを足す。
  // 位置合わせの共通処理（positionPopup / clampPopupToViewport）から呼ばれる。何度呼んでもよい。
  function decorate(menu) {
    if (!menu?.querySelectorAll || typeof lucide !== 'function') return;
    if (!menu.matches?.('.gb-context-menu, .ab-dropdown') && !menu.querySelector?.('.gb-context-menu-item')) return;
    menu.querySelectorAll('.gb-context-menu-item, .ab-dropdown-item').forEach((row) => {
      if (row.dataset.menuIconResolved === '1') return;
      row.dataset.menuIconResolved = '1';
      if (row.querySelector('svg, img, .menu-icon, [data-icon], .gb-color-swatch')) return;
      const labelEl = row.querySelector('.menu-label');
      const name = resolve(labelEl ? labelEl.textContent : row.textContent);
      if (!name) return;
      const icon = document.createElement('span');
      icon.className = 'menu-icon';
      icon.dataset.menuIconSource = 'shared';
      icon.innerHTML = lucide(name, 14);
      row.insertBefore(icon, row.firstChild);
    });
  }

  if (typeof window !== 'undefined') {
    window.MeldexMenuIcons = Object.freeze({ icons: ICONS, iconless: ICONLESS, normalizeLabel, resolve, decorate });
  }
})();
