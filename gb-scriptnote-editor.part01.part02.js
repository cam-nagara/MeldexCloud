      const prevCalc = prevVisibleCalc;
      const rowEl = this._buildRowEl(this.doc.rows[i], i, calc[i], mergeDisplay, prevRow, prevCalc, customCols, cols);
      allRowEls.push(rowEl);
      allRowCalcs.push(calc[i]);
      prevVisibleRow = this.doc.rows[i];
      prevVisibleCalc = calc[i];
    }
    // 見開き区切り線: 指定ページ番号の最後の行に区切り属性を付与
    if (sb?.enabled && allRowEls.length > 0) {
      const sbStart = sb.start ?? 1;
      const sbEvery = sb.every ?? 2;
      if (sbEvery > 0) {
        for (let j = 0; j < allRowEls.length - 1; j++) {
          const pg = allRowCalcs[j]?.page;
          const nextPg = allRowCalcs[j + 1]?.page;
          if (pg != null && nextPg != null && pg !== nextPg && (pg - sbStart) % sbEvery === 0 && pg >= sbStart) {
            allRowEls[j].dataset.spreadBorder = 'true';
          }
        }
      }
    }

    if (!wrapMode) {
      // === 折り返しOFF ===
      // scroll直下にヘッダー（sticky）、その後にeditor
      scroll.appendChild(header);
      allRowEls.forEach(el => editor.appendChild(el));
      scroll.appendChild(editor);
    } else {
      // === 折り返しON: JSで段を手動分割 ===
      // 一旦仮レンダリングして行の高さ/幅を測定
      // 縦書き時は仮レンダリングでも縦書きレイアウトにする
      if (viewMode === 'vertical') {
        editor.style.display = 'flex';
        editor.style.flexDirection = 'row-reverse';
        editor.style.alignItems = 'flex-start';
        editor.style.width = 'max-content';
      }
      allRowEls.forEach(el => editor.appendChild(el));
      scroll.appendChild(editor);
      this.host.innerHTML = '';
      this.host.appendChild(scroll);

      // 段の最大サイズ = scrollの高さ（横書き）or 幅（縦書き）
      // CSS zoom 下で offsetHeight/clientHeight がブラウザ間で不整合な値を返す
      // 問題を避けるため、getBoundingClientRect + _getZoom() で CSS ピクセルに
      // 正規化してから packing 計算する。
      const zPack = typeof _getZoom === 'function' ? _getZoom() : 1;
      const scrollRect = scroll.getBoundingClientRect();
      const maxSize = (viewMode === 'vertical' ? scrollRect.width : scrollRect.height) / zPack;
      // ヘッダーサイズ: 縦書きではヘッダーの幅（行と同じ方向で場所を取る）
      // 仮測定ではなく、固定値を使う（ヘッダーの実幅は行のレイアウト確定後でないと正確に測れない）
      const headerSize = viewMode === 'vertical' ? 40 : 28;
      const availSize = Math.max(maxSize - headerSize, 100);

      // 各行のサイズを測定（CSS ピクセルに正規化）
      const rowSizes = allRowEls.map(el => {
        const r = el.getBoundingClientRect();
        return (viewMode === 'vertical' ? r.width : r.height) / zPack;
      });

      // 段に分割
      const columns = [[]];
      let currentSize = 0;
      for (let i = 0; i < allRowEls.length; i++) {
        if (currentSize + rowSizes[i] > availSize && columns[columns.length - 1].length > 0) {
          columns.push([]);
          currentSize = 0;
        }
        columns[columns.length - 1].push(allRowEls[i]);
        currentSize += rowSizes[i];
      }

      // editorを再構築: 各段 = column-group div（ヘッダー + 行）
      // 子要素をdetach（参照を保持したまま除去）
      while (editor.firstChild) editor.removeChild(editor.firstChild);
      // 仮レンダリング用のスタイルをリセット
      editor.style.removeProperty('display');
      editor.style.removeProperty('flex-direction');
      editor.style.removeProperty('align-items');
      editor.style.removeProperty('width');
      columns.forEach(colRows => {
        const group = document.createElement('div');
        group.className = 'sn2-column-group';
        // 段ごとにヘッダーを追加
        const h = buildHeader(false);
        group.appendChild(h);
        colRows.forEach(el => group.appendChild(el));
        editor.appendChild(group);
      });

      // CSS変数を再設定
      setColVars(editor);
      this._bind();
      this._adjustRubySpacing();
      // 縦書き折り返し: 各段のヘッダー高さを測定し行に適用 + テキスト幅拡張
      if (viewMode === 'vertical') {
        requestAnimationFrame(() => {
          const zV = typeof _getZoom === 'function' ? _getZoom() : 1;
          editor.querySelectorAll('.sn2-column-group').forEach(group => {
            const h = group.querySelector('.sn2-header');
            if (!h) return;
            // getBoundingClientRect + zoom 正規化で CSS ピクセル値を得る
            const hH = h.getBoundingClientRect().height / zV;
            group.querySelectorAll('.sn2-row').forEach(r => {
              r.style.height = hH + 'px';
              const txt = r.querySelector('.sn2-text');
              if (txt) {
                const rRect = r.getBoundingClientRect();
                // scrollWidth は CSS ピクセル (zoom 非依存) を返すので
                // getBoundingClientRect は zV で割って同じ単位に揃える
