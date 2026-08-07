/* standalone-secondary-panel.js: Quick Memo / Viewer の内容付き右サイドバー。 */
(function (root) {
  'use strict';

  function storageKey(appId, suffix) {
    return `meldex-${appId}-secondary-panel-${suffix}-v1`;
  }

  function readNumber(key, fallback) {
    try {
      const value = Number(localStorage.getItem(key));
      return Number.isFinite(value) && value > 0 ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function saveValue(key, value) {
    try { localStorage.setItem(key, String(value)); } catch { /* 保存できない環境では画面中だけ維持。 */ }
  }

  function readBool(key, fallback = false) {
    try {
      const value = localStorage.getItem(key);
      return value == null ? fallback : value === '1';
    } catch {
      return fallback;
    }
  }

  function icon(name) {
    if (typeof lucide === 'function') return lucide(name, 16);
    return name === 'x' ? '×' : '';
  }

  function section(title) {
    const element = document.createElement('section');
    element.className = 'sa-secondary-section';
    const heading = document.createElement('h2');
    heading.textContent = title;
    element.appendChild(heading);
    return element;
  }

  function row(label, control) {
    const element = document.createElement('div');
    element.className = 'sa-secondary-row';
    const caption = document.createElement('span');
    caption.textContent = label;
    element.append(caption, control);
    return element;
  }

  function statusElement(text) {
    const value = document.createElement('span');
    value.className = 'sa-secondary-status';
    value.textContent = text;
    return value;
  }

  function actionButton(label, callback) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', callback);
    return button;
  }

  function linkedSelect(source, label) {
    const select = document.createElement('select');
    select.setAttribute('aria-label', label);
    Array.from(source?.options || []).forEach(sourceOption => {
      const option = document.createElement('option');
      option.value = sourceOption.value;
      option.textContent = sourceOption.textContent;
      select.appendChild(option);
    });
    select.value = source?.value || '';
    select.addEventListener('change', () => {
      if (!source) return;
      source.value = select.value;
      source.dispatchEvent(new Event('change', { bubbles: true }));
    });
    source?.addEventListener('change', () => { select.value = source.value; });
    return select;
  }

  function setupShell(appId, buttonHost, buttonClass) {
    if (!buttonHost) return null;
    const button = document.createElement('button');
    button.id = `${appId}-secondary-panel-button`;
    button.type = 'button';
    button.className = buttonClass;
    button.title = '右サイドバーを開く';
    button.setAttribute('aria-label', '右サイドバーを開く');
    button.setAttribute('aria-pressed', 'false');
    button.dataset.gbTooltipKey = 'panel.right.toggle';
    // .ico ico-panelRight のクラス置換（meldex-core.part01.js の replaceIcons()）は本要素が
    // 動的生成される前に一度だけ実行される場合があり反映されないことがあるため、共通アイコン
    // ヘルパー(window.lucide)から直接レンダリングして確実に表示する。
    button.innerHTML = icon('panelRight');
    const profile = buttonHost.querySelector('[data-sa-profile-slot], .qm-profile-slot');
    buttonHost.insertBefore(button, profile || null);

    const scrim = document.createElement('div');
    scrim.className = 'sa-secondary-scrim';
    const panel = document.createElement('aside');
    panel.className = 'sa-secondary-panel';
    panel.setAttribute('aria-label', '右サイドバー');
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML =
      '<div class="sa-secondary-panel-resizer" role="separator" aria-label="右サイドバーの幅を調整" aria-orientation="vertical" tabindex="0"></div>' +
      '<header class="sa-secondary-panel-header"><strong>オプション</strong><button type="button" class="sa-secondary-panel-close" aria-label="右サイドバーを閉じる">' +
      icon('x') + '</button></header><div class="sa-secondary-panel-body"></div>';
    document.body.append(scrim, panel);
    const widthKey = storageKey(appId, 'width');
    panel.style.setProperty('--sa-secondary-width', `${readNumber(widthKey, 340)}px`);
    let lastFocus = null;

    function setOpen(open, persist) {
      const next = !!open;
      if (next) lastFocus = document.activeElement;
      panel.classList.toggle('is-open', next);
      scrim.classList.toggle('is-open', next);
      panel.setAttribute('aria-hidden', next ? 'false' : 'true');
      button.setAttribute('aria-pressed', next ? 'true' : 'false');
      button.title = next ? '右サイドバーを閉じる' : '右サイドバーを開く';
      button.setAttribute('aria-label', button.title);
      if (persist) saveValue(storageKey(appId, 'open'), next ? '1' : '0');
      if (next) panel.querySelector('.sa-secondary-panel-close')?.focus();
      else if (lastFocus?.isConnected) lastFocus.focus();
    }

    button.addEventListener('click', () => setOpen(!panel.classList.contains('is-open'), true));
    panel.querySelector('.sa-secondary-panel-close').addEventListener('click', () => setOpen(false, true));
    scrim.addEventListener('click', () => setOpen(false, true));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && panel.classList.contains('is-open')) {
        event.preventDefault();
        setOpen(false, true);
      }
    }, true);

    const resizer = panel.querySelector('.sa-secondary-panel-resizer');
    resizer.addEventListener('pointerdown', event => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = panel.getBoundingClientRect().width;
      const move = moveEvent => {
        const width = Math.max(260, Math.min(620, startWidth + startX - moveEvent.clientX));
        panel.style.setProperty('--sa-secondary-width', `${width}px`);
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        saveValue(widthKey, Math.round(panel.getBoundingClientRect().width));
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
    resizer.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const delta = event.key === 'ArrowLeft' ? 16 : -16;
      const width = Math.max(260, Math.min(620, panel.getBoundingClientRect().width + delta));
      panel.style.setProperty('--sa-secondary-width', `${width}px`);
      saveValue(widthKey, Math.round(width));
    });
    setOpen(readBool(storageKey(appId, 'open'), false), false);
    return { button, panel, body: panel.querySelector('.sa-secondary-panel-body'), setOpen };
  }

  function setupQuickMemo() {
    const host = document.querySelector('#editorView .qm-header-actions');
    const shell = setupShell('quick-memo', host, 'qm-icon');
    if (!shell) return false;
    const save = section('保存と同期');
    const saveStatus = statusElement(document.getElementById('syncStatus')?.textContent || '端末へ保存します');
    save.appendChild(row('現在の状態', saveStatus));
    const actions = document.createElement('div');
    actions.className = 'sa-secondary-actions';
    actions.append(
      actionButton('今すぐ端末へ保存', () => document.getElementById('saveBtn')?.click()),
      actionButton('Meldexファイルを開く', () => document.getElementById('workspaceBtn')?.click())
    );
    save.appendChild(actions);
    const syncSource = document.getElementById('syncStatus');
    if (syncSource) new MutationObserver(() => { saveStatus.textContent = syncSource.textContent || ''; })
      .observe(syncSource, { childList: true, subtree: true, characterData: true });

    const input = section('入力方法');
    const modeSource = document.getElementById('modeSelect');
    if (modeSource) input.appendChild(row('モード', linkedSelect(modeSource, '入力方法')));
    const modeHint = statusElement('テキスト、ペン、音声の内容を同じ下書きへ保存します');
    input.appendChild(row('保存対象', modeHint));
    shell.body.append(save, input);
    return true;
  }

  function setupViewer() {
    const controls = document.getElementById('controls');
    // #controls は共通ツールバー（.gb-toolbar-viewer）。中に置くボタンも共通の .tb-icon-btn を使い、
    // デスクトップ32px帯・タッチ44px操作領域のトークンをそのまま適用する。
    const shell = setupShell('viewer', controls, 'tb-icon-btn');
    if (!shell) return false;
    const display = section('表示方法');
    const modeSource = document.getElementById('sel-mode');
    if (modeSource) display.appendChild(row('表示モード', linkedSelect(modeSource, '表示モード')));
    const displayActions = document.createElement('div');
    displayActions.className = 'sa-secondary-actions';
    displayActions.append(
      actionButton('画面に合わせる', () => document.getElementById('btn-fit')?.click()),
      actionButton('全画面', () => document.getElementById('btn-fullscreen')?.click())
    );
    display.appendChild(displayActions);

    const slideshow = section('スライドショー');
    const speedSource = document.getElementById('speed');
    const speed = document.createElement('input');
    speed.type = 'range';
    speed.min = speedSource?.min || '0.5';
    speed.max = speedSource?.max || '15';
    speed.step = speedSource?.step || '0.5';
    speed.value = speedSource?.value || '3';
    speed.setAttribute('aria-label', '切替秒数');
    speed.addEventListener('input', () => {
      if (!speedSource) return;
      speedSource.value = speed.value;
      speedSource.dispatchEvent(new Event('input', { bubbles: true }));
      speedSource.dispatchEvent(new Event('change', { bubbles: true }));
    });
    slideshow.appendChild(row('切替秒数', speed));
    const slideshowActions = document.createElement('div');
    slideshowActions.className = 'sa-secondary-actions';
    slideshowActions.appendChild(actionButton('再生 / 一時停止', () => document.getElementById('btn-play')?.click()));
    slideshow.appendChild(slideshowActions);

    const metadata = section('現在のファイル');
    const current = statusElement(document.getElementById('hud-info')?.textContent || 'ファイルを開いてください');
    metadata.appendChild(row('情報', current));
    const infoSource = document.getElementById('hud-info');
    if (infoSource) new MutationObserver(() => { current.textContent = infoSource.textContent || '—'; })
      .observe(infoSource, { childList: true, subtree: true, characterData: true });
    const metadataActions = document.createElement('div');
    metadataActions.className = 'sa-secondary-actions';
    // ツールバーの注釈ボタンは撤去済み（ビューワー安定化計画）。右サイドバーは単独ビューワーの
    // 公開注釈コントローラーへ直接発呼する（右クリックメニュー・Aキーと同じ入口）。
    metadataActions.appendChild(actionButton('注釈を開く', () => window.MeldexViewerAnnotations?.toggle?.()));
    metadata.appendChild(metadataActions);
    shell.body.append(display, slideshow, metadata);
    return true;
  }

  function install() {
    if (document.getElementById('editorView') && document.querySelector('.qm-header-actions')) setupQuickMemo();
    else if (document.getElementById('controls') && document.getElementById('display')) setupViewer();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
  root.MeldexStandaloneSecondaryPanel = Object.freeze({ install });
})(typeof window !== 'undefined' ? window : globalThis);
