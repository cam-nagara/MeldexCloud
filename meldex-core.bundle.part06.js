    '同期設定': 'calendarSync',
    '新規リンクトピック: ノート': 'link2',
    '新規リンクトピック: シート': 'link2',
    '新規リンクトピック: ボード': 'link2',
    '既存ファイルへのリンクトピック': 'link2',
    'ツール': 'wrench',
    '重複画像を検出': 'scanSearch',
    'このフォルダで重複検出': 'scanSearch',
    '画像インデックスを作成': 'fileSearch',
    'このフォルダのインデックス作成': 'fileSearch',
    'この階層を閉じる': 'chevronsDownUp',
    'リネーム': 'pencil',
    'パスを変更': 'folderPen',
    'ワークスペースの管理': 'settings',
    'システム保護': 'shield',
    'プロパティ': 'info',
    'チャットを開く': 'messageSquare',
    '比較': 'columns',
  });
  // 色見本が先頭に付く行（色設定）は色見本をアイコンとして扱う。読み込み中の一時表示は付けない。
  const ICONLESS = Object.freeze(new Set(['(なし)', '（なし）', '設定する', '解除する', 'OS メニュー 読み込み中']));

  function normalizeLabel(label) {
    let text = String(label ?? '').replace(/\s+/g, ' ').trim();
    text = text.replace(/^[✓✔]\s*/, '');
    text = text.replace(/(?:\.\.\.|…)$/, '').trim();
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
