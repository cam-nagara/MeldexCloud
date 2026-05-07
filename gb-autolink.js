/**
 * gb-autolink.js — 自動リンク統一ロジック
 *
 * マッチングロジック、HTML文字列版・DOM直接操作版、リンク辞書管理を統一。
 * ノート、台本、DB、ボード、詳細パネルで同じマッチング結果を保証する。
 */
const MeldexAutoLink = (() => {
  // ── リンク辞書 ──
  let _linkDict = [];
  let _dictLoadSeq = 0;

  async function loadDict(workFolder) {
    const seq = ++_dictLoadSeq;
    try {
      const url = workFolder ? '/link-dict?work=' + encodeURIComponent(workFolder) : '/link-dict';
      const data = await apiFetch(url);
      if (seq === _dictLoadSeq) _linkDict = data.entries || [];
    } catch {
      // 一時的な取得失敗では既存辞書を保持する
    }
    return _linkDict;
  }

  function getDict() { return _linkDict; }
  function setDict(dict) { _dictLoadSeq += 1; _linkDict = dict || []; }

  // ── 共通: テキストノード収集 ──
  function _collectTextNodes(el) {
    const nodes = [];
    for (const child of el.childNodes) {
      if (child.nodeType === 3 && child.textContent) {
        nodes.push(child);
      } else if (child.nodeType === 1
        && !child.classList?.contains('auto-link')
        && !child.dataset?.autoLink
        && !['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(child.tagName)
        && child.tagName !== 'RT'
        && !child.dataset?.autoRuby) {
        nodes.push(..._collectTextNodes(child));
      }
    }
    return nodes;
  }

  // ── 共通: ソート済み辞書を取得 ──
  function _sortedDict() {
    return [..._linkDict].sort((a, b) => b.text.length - a.text.length);
  }

  // ── 共通: span 要素を生成 ──
  function _createLinkSpan(entry, options = {}) {
    const span = document.createElement('span');
    span.className = 'auto-link';
    span.dataset.path = entry.path || '';
    span.dataset.autoLink = 'true';
    if (entry.ruby && !options.suppressRuby) {
      span.dataset.ruby = entry.ruby;
      span.style.position = 'relative';
    }
    span.textContent = entry.text;
    return span;
  }

  function _normalizePathForScope(path) {
    return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  }

  function _isPathInside(filePath, rootPath) {
    const file = _normalizePathForScope(filePath);
    const root = _normalizePathForScope(rootPath);
    return !!file && !!root && (file === root || file.startsWith(root + '/'));
  }

  function _isInWorkFolderScope(filePath) {
    if (typeof getWorkFolder !== 'function') return true;
    const wf = getWorkFolder();
    if (!wf || !filePath) return true;
    const roots = [wf];
    const vaultPath = (typeof state !== 'undefined' && state?.vaultPath) ? String(state.vaultPath) : '';
    if (vaultPath && !/^[A-Za-z]:[\\/]/.test(wf) && !String(wf).startsWith('/')) {
      roots.push(vaultPath.replace(/\\/g, '/') + '/' + String(wf).replace(/^\/+/, ''));
    }
    return roots.some(root => _isPathInside(filePath, root));
  }

  // ── HTML文字列版（ノート、ボード、詳細パネル用） ──
  function applyToHtml(html, filePath) {
    if (!html || _linkDict.length === 0) return html;

    if (!_isInWorkFolderScope(filePath)) return html;

    const div = document.createElement('div');
    div.innerHTML = html;
    _applyToDomInternal(div);
    return div.innerHTML;
  }

  // ── DOM直接操作版（台本用） ──
  function applyToDom(el, filePath) {
    if (!el || _linkDict.length === 0) return;
    if (!_isInWorkFolderScope(filePath)) return;
    // 既存の自動リンクを除去（再適用時の二重表示を防止）
    el.querySelectorAll('[data-auto-link]').forEach(span => {
      span.replaceWith(document.createTextNode(span.textContent));
    });
    el.normalize();
    _applyToDomInternal(el);
  }

  // ── 内部: DOM要素内のテキストノードにリンクを適用 ──
  function _applyToDomInternal(el) {
    const sorted = _sortedDict();
    if (sorted.length === 0) return;
    const textNodes = _collectTextNodes(el);
    for (const tNode of textNodes) {
      const content = tNode.textContent;
      if (!content) continue;
      let matched = false;
      const frag = document.createDocumentFragment();
      let lastIdx = 0;
      while (lastIdx < content.length) {
        let earliest = null;
        for (const entry of sorted) {
          if (!entry.text || entry.text.length < 2) continue;
          const pos = content.indexOf(entry.text, lastIdx);
          if (pos >= 0 && (!earliest || pos < earliest.pos || (pos === earliest.pos && entry.text.length > earliest.entry.text.length))) {
            earliest = { pos, entry };
          }
        }
        if (!earliest) break;
        matched = true;
        if (earliest.pos > lastIdx) frag.appendChild(document.createTextNode(content.slice(lastIdx, earliest.pos)));
        const suppressRuby = !!tNode.parentElement?.closest?.('[data-ruby], ruby');
        frag.appendChild(_createLinkSpan(earliest.entry, { suppressRuby }));
        lastIdx = earliest.pos + earliest.entry.text.length;
      }
      if (matched) {
        if (lastIdx < content.length) frag.appendChild(document.createTextNode(content.slice(lastIdx)));
        tNode.parentNode.replaceChild(frag, tNode);
      }
    }
  }

  // ── stripAutoLinks（auto-link スパンを除去） ──
  function stripFromHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    div.querySelectorAll('.auto-link').forEach(el => {
      el.replaceWith(...el.childNodes);
    });
    let cleaned = div.innerHTML;
    cleaned = cleaned.replace(/&lt;span\s+class="auto-link"[^]*?&gt;([\s\S]*?)&lt;\/span&gt;/g, '$1');
    cleaned = cleaned.replace(/&amp;lt;span\s+class="auto-link"[^]*?&amp;gt;([\s\S]*?)&amp;lt;\/span&amp;gt;/g, '$1');
    return cleaned;
  }

  // ── リンク辞書の debounce 付き再読み込み ──
  let _reloadTimer = null;
  function scheduleReload(delayMs) {
    clearTimeout(_reloadTimer);
    _reloadTimer = setTimeout(async () => {
      _reloadTimer = null;
      const wf = typeof getWorkFolder === 'function' ? getWorkFolder() : '';
      await loadDict(wf);
    }, delayMs || 3000);
  }

  return {
    loadDict,
    getDict,
    setDict,
    applyToHtml,
    applyToDom,
    stripFromHtml,
    scheduleReload,
  };
})();
