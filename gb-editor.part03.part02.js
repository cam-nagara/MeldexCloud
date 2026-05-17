      const widgets = (obj.views?.dashboard?.widgets || []).length;
      return `スマートシート — フィルタ${filters}件` + (widgets ? `\nダッシュボード: ウィジェット${widgets}件` : '') + (obj.sourceDb ? `\nソース: ${obj.sourceDb.split('/').pop()}` : '');
    }
    // キャンバス（フロントマター付きMarkdown→JSONではないが念のため）
    return '';
  } catch { return ''; }
}

// リンクツールチップ
let tooltipEl = null;
let tooltipTimer = null;
let tooltipCache = {};

let _tooltipLink = null; // 現在ツールチップ表示中のリンク要素
let _tooltipSuppressedLink = null;

function _isAutoLinkTooltipSuppressed(link) {
  if (!_tooltipSuppressedLink) return false;
  if (!document.documentElement.contains(_tooltipSuppressedLink)) {
    _tooltipSuppressedLink = null;
    return false;
  }
  return link === _tooltipSuppressedLink || _tooltipSuppressedLink.contains(link);
}

function _clearAutoLinkTooltipSuppression() {
  _tooltipSuppressedLink = null;
}

function _queueAutoLinkTooltip(linkOrTarget) {
  const linkTarget = linkOrTarget?.path ? linkOrTarget : _resolveContextLinkTarget(linkOrTarget);
  const link = linkTarget?.element;
  if (!link || !linkTarget?.path) return;
  if (_tooltipSuppressedLink && !_tooltipSuppressedLink.contains(link)) _clearAutoLinkTooltipSuppression();
  if (_isAutoLinkTooltipSuppressed(link)) return;
  if (link === _tooltipLink) return; // 同じリンク上なら何もしない
  clearTimeout(tooltipTimer);
  removeTooltip();

  const path = linkTarget.path;
  if (!path) return;
  _tooltipLink = link;

  tooltipTimer = setTimeout(async () => {
    tooltipTimer = null;
    if (!tooltipCache[path]) {
      const fname = path.split(/[/\\]/).pop();
      const ext = fname.includes('.') ? fname.split('.').pop().toLowerCase() : '';
      if (/^(https?:|mailto:)/i.test(path)) {
        tooltipCache[path] = { title: linkTarget.label || fname || path, props: path };
      } else {
      try {
        const res = await fetch(API_BASE + '/entity?path=' + encodeURIComponent(path));
        if (!res.ok) throw new Error();
        const data = await res.json();
        const props = data.properties || {};
        const lines = [];
        for (const [k, vals] of Object.entries(props)) {
          const adopted = vals.find(v => v.status === '採用' || v.status === '掲載済み');
          if (adopted) lines.push(`${k}: ${adopted.value}`);
        }
        if (lines.length > 0) {
          tooltipCache[path] = { title: data.entity, props: lines.slice(0, 6).join('\n') };
        } else {
          // エンティティだがプロパティなし（DBフォルダ等）— エンティティ数を取得
          try {
            const params = new URLSearchParams({
              scope: path,
              filters: JSON.stringify([{ property: '' }]),
            });
            const [dbData, meta] = await Promise.all([
              apiFetch('/smart-db?' + params.toString()),
              apiFetch('/db-metadata?path=' + encodeURIComponent(path)),
            ]);
            const entityCount = Number(dbData.total_entities_scanned ?? dbData.entities?.length ?? 0);
            const propNames = Object.keys(meta.property_types || {}).slice(0, 5);
            const summary = `${entityCount}件のエントリ` + (propNames.length ? `\n項目: ${propNames.join(', ')}` : '');
            tooltipCache[path] = { title: data.entity || fname, props: summary };
          } catch {
            tooltipCache[path] = { title: data.entity || fname, props: data.page_content ? data.page_content.substring(0, 150).replace(/\n/g, ' ') : '' };
          }
        }
      } catch (e) {
        // entity APIが失敗: ファイルタイプ別に表示
        const imgExts = ['jpg','jpeg','png','gif','webp','svg','bmp','avif','ico'];
        const binaryExts = ['pdf','clip','psd','ai','zip','rar','7z','exe','dll','doc','docx','xls','xlsx','pptx'];
        if (imgExts.includes(ext)) {
          const url = (typeof API_BASE !== 'undefined' ? API_BASE : '') + '/file-raw?path=' + encodeURIComponent(path);
          tooltipCache[path] = { title: fname, props: '', img: url };
        } else if (binaryExts.includes(ext)) {
          tooltipCache[path] = { title: fname, props: '' };
        } else {
          try {
            const fd = await apiFetch('/file?path=' + encodeURIComponent(path));
            const raw = fd.content || '';
            // JSON（シナリオ/キャンバス/スマートDB/ダッシュボード）は要約表示
            if (ext === 'json') {
              tooltipCache[path] = { title: fname, props: _summarizeJson(raw) };
            } else {
              // テキストファイル: フロントマター除去して冒頭表示
              const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
              tooltipCache[path] = { title: fname, props: body.substring(0, 200).replace(/\n/g, ' ') };
            }
          } catch { tooltipCache[path] = { title: fname, props: '' }; }
        }
      }
      }
    }

    if (_tooltipLink !== link || !document.documentElement.contains(link)) return;
    const info = tooltipCache[path];
    removeTooltip();
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'link-tooltip';
    let ttHtml = `<div class="lt-title">${_linkIcon(path)} ${esc(info.title)}</div>`;
    if (info.img) ttHtml += `<img src="${info.img}" style="max-width:200px;max-height:120px;border-radius:4px;margin-top:4px;">`;
    else if (info.props) ttHtml += `<div class="lt-props">${esc(info.props).replace(/\n/g, '<br>')}</div>`;
    tooltipEl.innerHTML = ttHtml;

    const rect = link.getBoundingClientRect();
    const z = _getZoom();
    tooltipEl.style.left = (rect.left / z) + 'px';
    tooltipEl.style.top = (rect.bottom / z + 4) + 'px';
    document.body.appendChild(tooltipEl);

    if (typeof clampPopupToViewport === 'function') {
      clampPopupToViewport(tooltipEl);
    } else {
      const tr = tooltipEl.getBoundingClientRect();
      if (tr.right > window.innerWidth) tooltipEl.style.left = (Math.max(8, window.innerWidth - tr.width - 8) / z) + 'px';
      if (tr.bottom > window.innerHeight) tooltipEl.style.top = (Math.max(8, rect.top - tr.height - 4) / z) + 'px';
      const clamped = tooltipEl.getBoundingClientRect();
      if (clamped.left < 0) tooltipEl.style.left = (8 / z) + 'px';
      if (clamped.top < 0) tooltipEl.style.top = (8 / z) + 'px';
    }
  }, 400);
}

document.addEventListener('mouseover', (e) => {
  const linkTarget = _resolveContextLinkTarget(e.target);
  if (!linkTarget?.element) {
    // リンク外に出たら消す
    clearTimeout(tooltipTimer);
    removeTooltip();
    _clearAutoLinkTooltipSuppression();
    return;
  }
  _queueAutoLinkTooltip(linkTarget);
});

document.addEventListener('pointermove', (e) => {
  if (!_tooltipLink && !tooltipEl && !tooltipTimer) return;
  const linkTarget = _resolveContextLinkTarget(e.target);
  const link = linkTarget?.element || null;
  if (tooltipEl) {
    removeTooltip({ suppressLink: _tooltipLink });
    if (linkTarget) _queueAutoLinkTooltip(linkTarget);
    return;
  }
  if (!link) {
    removeTooltip();
    return;
  }
  if (_tooltipLink && link !== _tooltipLink && !_tooltipLink.contains(link)) {
    removeTooltip();
    _queueAutoLinkTooltip(linkTarget);
  }
});

document.addEventListener('mouseout', (e) => {
  if (!_tooltipSuppressedLink) return;
  if (!(e.relatedTarget instanceof Node) || !_tooltipSuppressedLink.contains(e.relatedTarget)) {
    _clearAutoLinkTooltipSuppression();
  }
});

// スクロールやクリック時にもツールチップを消す
document.addEventListener('scroll', removeTooltip, true);
document.addEventListener('click', removeTooltip, true);

function removeTooltip(options = {}) {
  const suppressLink = options.suppressLink || null;
  clearTimeout(tooltipTimer);
  tooltipTimer = null;
  if (suppressLink && document.documentElement.contains(suppressLink)) {
    _tooltipSuppressedLink = suppressLink;
  }
  _tooltipLink = null;
  if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
}

/* ==============================
   ファイル内検索・置換（Ctrl+F）
   ============================== */
let _fileSearchMatches = [];
let _fileSearchIdx = -1;
let _fileSearchLastQuery = '';
let _fileSearchLastRoot = null;

function openFileSearch() {
  const bar = document.getElementById('file-search-bar');
  bar.classList.add('open');
  const q = document.getElementById('fsb-query');
  const r = document.getElementById('fsb-replace');
  q.value = ''; r.value = '';
  q.rows = 1; r.rows = 1;
  q.classList.remove('multiline'); r.classList.remove('multiline');
  document.getElementById('fsb-count').textContent = '';
  _fileSearchMatches = [];
  _fileSearchIdx = -1;
  _fileSearchLastQuery = '';
  _fileSearchLastRoot = null;
  q.focus();
}

// 検索/置換テキストエリアのキーイベントと複数行自動拡張
document.addEventListener('DOMContentLoaded', () => {
  const q = document.getElementById('fsb-query');
  const r = document.getElementById('fsb-replace');
  if (!q || !r) return;

  function autoResize(ta) {
    const lines = ta.value.split('\n').length;
    if (lines > 1) { ta.rows = Math.min(lines, 5); ta.classList.add('multiline'); }
