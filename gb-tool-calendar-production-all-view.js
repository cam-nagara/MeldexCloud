/* gb-tool-calendar-production-all-view.js
 * スケジュール タスクリスト面の「すべて」タブ用に、全作品のタスクリストシートを
 * 縦に積んで一括表示する独立モジュール。各作品ブロックは MeldexProductionSheetEmbed の
 * 独立インスタンスなので、通常の作品別タブと同じようにその場で編集できる。
 *
 * 集約用の実シートは存在しないため（作品別シートが正）、読み取り専用の合成表ではなく
 * 「作品ごとの生きたシート表を順に並べる」方式を取る。行の仮想化は CSS の
 * content-visibility が担うので、内側の表スクロールを止めて外側の縦スクロールへ
 * 一本化しても描画コストは増えない。
 */
(function () {
  'use strict';

  function _sanitizeIdPart(raw) {
    return String(raw || '').replace(/[^\p{L}\p{N}_-]+/gu, '-');
  }

  function _logError(instance, message, error) {
    console.error('[MeldexProductionAllView] ' + message + ': ' + (instance?.idSuffix || '(unmounted)'), error || '');
  }

  // 埋め込みシートは1画面用の flex/overflow 設定（インラインstyle）を持つため、
  // 縦積み用に「内容の高さで伸びて、スクロールは外側へ委ねる」形へ上書きする。
  function _relaxEmbedLayout(containerEl) {
    if (!containerEl) return;
    containerEl.style.height = 'auto';
    containerEl.style.flex = 'none';
    containerEl.style.overflow = 'visible';
    const viewContainer = containerEl.querySelector('.db-view-container');
    if (viewContainer) {
      viewContainer.style.flex = 'none';
      viewContainer.style.minHeight = 'auto';
      viewContainer.style.overflow = 'visible';
    }
    const pivotView = containerEl.querySelector('.pivot-view');
    if (pivotView) {
      pivotView.style.flex = 'none';
      pivotView.style.minHeight = 'auto';
      pivotView.style.overflow = 'visible';
    }
  }

  function _buildSection(instance, sheet) {
    if (!window.MeldexProductionSheetEmbed) {
      _logError(instance, 'MeldexProductionSheetEmbed が未定義です。読み込み順序を確認してください');
      return null;
    }
    const section = document.createElement('section');
    section.className = 'gb-production-all-section';
    section.dataset.e2eId = 'gb-production-all-section-' + _sanitizeIdPart(sheet.sheet_name);

    const title = document.createElement('h3');
    title.className = 'gb-production-all-section-title';
    section.appendChild(title);

    const embedHost = document.createElement('div');
    embedHost.className = 'gb-production-all-section-embed';
    section.appendChild(embedHost);

    instance._embedSeq += 1;
    const embed = window.MeldexProductionSheetEmbed.create({
      // シート名は日本語主体で embed 側の ASCII サニタイズだと衝突するため、
      // 連番でインスタンスIDを一意化する（DOM id 重複防止）。
      idSuffix: instance.idSuffix + '-sec' + instance._embedSeq,
    });
    const containerEl = embed.mount(embedHost);
    _relaxEmbedLayout(containerEl);

    return { sheet, section, titleEl: title, embed };
  }

  function _syncTitle(record) {
    const label = record.sheet.work_title || record.sheet.sheet_name;
    record.titleEl.textContent = label;
    record.section.setAttribute('aria-label', `${label} のタスクリスト`);
  }

  function _embedReady(record) {
    const path = record.sheet.dir;
    return !!path
      && record.embed.getCurrentPath() === path
      && record.embed.ctx?.dbPath === path
      && !!record.embed.ctx?.pivotData;
  }

  async function _open(instance, sheets, opts) {
    if (instance._destroyed || !instance._mounted) return false;
    const list = (Array.isArray(sheets) ? sheets : []).filter(sheet => sheet && sheet.sheet_name && sheet.dir);
    const seq = ++instance._openSeq;

    // 消えたシートのブロックを破棄
    const nextNames = new Set(list.map(sheet => sheet.sheet_name));
    [...instance._sections.keys()].forEach(name => {
      if (nextNames.has(name)) return;
      const record = instance._sections.get(name);
      try { record.embed.destroy(); } catch (error) { _logError(instance, 'ブロックの破棄に失敗しました: ' + name, error); }
      record.section.remove();
      instance._sections.delete(name);
    });

    instance._emptyEl.hidden = list.length > 0;

    // 並び順どおりにブロックを用意して並べ替える
    const records = [];
    list.forEach(sheet => {
      let record = instance._sections.get(sheet.sheet_name);
      if (!record) {
        record = _buildSection(instance, sheet);
        if (!record) return;
        instance._sections.set(sheet.sheet_name, record);
      }
      record.sheet = sheet;
      _syncTitle(record);
      instance._containerEl.appendChild(record.section);
      records.push(record);
    });

    // 読み込みは直列にして API・描画の同時多発を避ける（作品数は少数の想定）
    let allOk = true;
    for (const record of records) {
      if (seq !== instance._openSeq || instance._destroyed) return false;
      try {
        if (_embedReady(record)) {
          if (opts?.refresh === true) allOk = (await record.embed.refresh()) && allOk;
        } else {
          allOk = (await record.embed.open(record.sheet.dir, {
            forceReload: record.embed.getCurrentPath() === record.sheet.dir,
          })) && allOk;
        }
        _relaxEmbedLayout(record.embed.containerEl);
      } catch (error) {
        _logError(instance, 'タスクリストの読み込みに失敗しました: ' + record.sheet.sheet_name, error);
        allOk = false;
      }
    }
    return allOk;
  }

  async function _refresh(instance) {
    if (instance._destroyed || !instance._mounted) return false;
    const results = await Promise.all([...instance._sections.values()].map(async record => {
      try {
        return await record.embed.refresh();
      } catch (error) {
        _logError(instance, '再読み込みに失敗しました: ' + record.sheet.sheet_name, error);
        return false;
      }
    }));
    [...instance._sections.values()].forEach(record => _relaxEmbedLayout(record.embed.containerEl));
    return results.every(Boolean);
  }

  function create(options) {
    const idSuffix = String(options?.idSuffix || 'production-all').replace(/[^a-zA-Z0-9_-]+/g, '-');
    const instance = {
      idSuffix,
      _mounted: false,
      _destroyed: false,
      _openSeq: 0,
      _embedSeq: 0,
      _containerEl: null,
      _emptyEl: null,
      _sections: new Map(),
    };

    instance.isMounted = function () { return instance._mounted && !instance._destroyed; };

    instance.mount = function (hostEl) {
      if (instance._destroyed) {
        _logError(instance, 'destroy 済みインスタンスは再マウントできません');
        return null;
      }
      if (instance._mounted) return instance._containerEl;
      if (!hostEl || typeof hostEl.appendChild !== 'function') {
        _logError(instance, 'mount先のホスト要素が不正です');
        return null;
      }
      const container = document.createElement('div');
      container.className = 'gb-production-all-view';
      container.dataset.e2eId = 'gb-production-all-view';
      const empty = document.createElement('p');
      empty.className = 'gb-production-all-empty';
      empty.textContent = 'タスクリストがありません。「＋」から作品のタスクリストを追加できます。';
      empty.hidden = true;
      container.appendChild(empty);
      hostEl.appendChild(container);
      instance._containerEl = container;
      instance._emptyEl = empty;
      instance._mounted = true;
      return container;
    };

    instance.open = function (sheets, opts) { return _open(instance, sheets, opts); };
    instance.refresh = function () { return _refresh(instance); };

    instance.setVisible = function (visible) {
      // 非表示でも DOM から外さない（埋め込みシートの ctx 解決が containerEl の
      // document 接続を前提にしているため。sheet-embed 側の注意書きと同じ制約）。
      if (instance._containerEl) instance._containerEl.style.display = visible ? 'flex' : 'none';
    };

    instance.getSelectedEntryPaths = function () {
      const paths = [];
      instance._sections.forEach(record => {
        try { paths.push(...(record.embed.getSelectedEntryPaths() || [])); }
        catch (error) { _logError(instance, '選択エントリの取得に失敗しました: ' + record.sheet.sheet_name, error); }
      });
      return paths;
    };

    instance.destroy = function () {
      if (instance._destroyed) return;
      instance._destroyed = true;
      instance._openSeq += 1;
      instance._sections.forEach(record => {
        try { record.embed.destroy(); } catch (error) { _logError(instance, 'ブロックの破棄に失敗しました: ' + record.sheet.sheet_name, error); }
      });
      instance._sections.clear();
      instance._containerEl?.remove();
      instance._containerEl = null;
      instance._emptyEl = null;
      instance._mounted = false;
    };

    return instance;
  }

  window.MeldexProductionAllView = Object.freeze({ create });
})();
