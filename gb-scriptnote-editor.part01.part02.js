      const prevCalc = prevVisibleCalc;
      const rowEl = this._buildRowEl(this.doc.rows[i], i, calc[i], mergeDisplay, prevRow, prevCalc, customCols, cols);
      allRowEls.push(rowEl);
      allRowCalcs.push(calc[i]);
      prevVisibleRow = this.doc.rows[i];
      prevVisibleCalc = calc[i];
    }
    // 見開き区切り線: 次ページ先頭行の手前に区切り属性を付与
    if (sb?.enabled && allRowEls.length > 0) {
      const sbStart = sb.start ?? 1;
      const sbEvery = sb.every ?? 2;
      if (sbEvery > 0) {
        for (let j = 0; j < allRowEls.length - 1; j++) {
          const pg = allRowCalcs[j]?.page;
          const nextPg = allRowCalcs[j + 1]?.page;
          if (pg != null && nextPg != null && pg !== nextPg && (pg - sbStart) % sbEvery === 0 && pg >= sbStart) {
            allRowEls[j + 1].dataset.spreadBorder = 'true';
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
      // 前回の描画で測った行サイズ（行の見た目と表示設定が同じ行だけ）を再利用できる時は、
      // 段に分ける前の「全行を並べて測る」仮レンダリングを省く。最終的な段組みは
      // 後の settleWrapPacking が実寸で測り直して確定するため、結果は測った場合と同じになる。
      const wrapSizeGlobalKey = JSON.stringify([
        viewMode, editor.style.cssText, scroll.style.cssText,
        typeof _getZoom === 'function' ? _getZoom() : 1,
      ]);
      const selectedWrapSizeCache = this._findWrapRowSizeCache(wrapSizeGlobalKey);
      const wrapSizeCache = selectedWrapSizeCache?.map || null;
      const wrapRowKeys = allRowEls.map(el => this._wrapRowMeasurementKey(el, viewMode));
      const cachedRowSizes = wrapRowKeys.map(key => wrapSizeCache?.get(key) ?? null);
      const unmeasuredRowIndices = cachedRowSizes.flatMap((size, index) => size == null ? [index] : []);
      let lastFinalRowSizes = null;
      let verticalWrapHeaderHeight = 0;
      const cachedVerticalHeight = viewMode === 'vertical' && wrapSizeCache
        ? Number(selectedWrapSizeCache.verticalHeight) : 0;
      if (cachedVerticalHeight > 0) {
        allRowEls.forEach(el => { el.style.height = cachedVerticalHeight + 'px'; });
      }
      // 一旦仮レンダリングして行の高さ/幅を測定
      // 縦書き時は仮レンダリングでも縦書きレイアウトにする
      if (unmeasuredRowIndices.length) {
        if (viewMode === 'vertical') {
          editor.style.display = 'flex';
          editor.style.flexDirection = 'row-reverse';
          editor.style.alignItems = 'flex-start';
          editor.style.width = 'max-content';
        }
      }
      scroll.appendChild(editor);
      this.host.innerHTML = '';
      this.host.appendChild(scroll);

      // 段の最大サイズ = scrollの高さ（横書き）or 幅（縦書き）
      // CSS zoom 下で offsetHeight/clientHeight がブラウザ間で不整合な値を返す
      // 問題を避けるため、getBoundingClientRect + _getZoom() で CSS ピクセルに
      // 正規化してから packing 計算する。
      const zPack = typeof _getZoom === 'function' ? _getZoom() : 1;
      let lastWrapViewportRectSize = null;
      const measureWrapViewportSize = () => {
        const rect = scroll.getBoundingClientRect();
        lastWrapViewportRectSize = viewMode === 'vertical' ? rect.width : rect.height;
        const rectSize = lastWrapViewportRectSize / zPack;
        const clientSize = viewMode === 'vertical' ? scroll.clientWidth : scroll.clientHeight;
        if (Number.isFinite(clientSize) && clientSize > 0) return Math.min(rectSize, clientSize);
        return rectSize;
      };
      const wrapFitGuard = 2;
      const maxSize = measureWrapViewportSize();
      let verticalMeasureHeader = null;
      if (viewMode === 'vertical' && unmeasuredRowIndices.length) {
        verticalMeasureHeader = buildHeader(false, 'measure');
        verticalMeasureHeader.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;';
        scroll.appendChild(verticalMeasureHeader);
        const headerHeight = verticalMeasureHeader.getBoundingClientRect().height / zPack;
        if (headerHeight > 0) {
          allRowEls.forEach(el => { el.style.height = headerHeight + 'px'; });
        }
      }
      // 表示領域と縦書きの行高を先に確定する。全行を置いてから測ると、
      // 未確定の高さで全文を配置し、直後に同じ全文を配置し直してしまう。
      // 本文は縦横とも最終の段だけに置く。初期の分割は目安に留め、
      // ルビ確定後に全行を実測して分割し直すため、ここで全文を仮配置しない。
      // ヘッダーサイズ: 縦書きではヘッダーの幅（行と同じ方向で場所を取る）
      // 仮測定ではなく、固定値を使う（ヘッダーの実幅は行のレイアウト確定後でないと正確に測れない）
      const headerSize = viewMode === 'vertical' ? 40 : 28;
      const availSize = Math.max(maxSize - headerSize - wrapFitGuard, 100);

      // 読み取りと書き込みを分けてまとめる。行ごとに「書いて測る」を繰り返すと、
      // 1行ごとに画面全体の再レイアウトが走り、行数に比例して重くなる。
      const applyVerticalWrapSizing = (measurements = null) => {
        if (viewMode !== 'vertical') return;
        const zV = typeof _getZoom === 'function' ? _getZoom() : 1;
        const groups = [...editor.querySelectorAll('.sn2-column-group')];
        const headerHeights = groups.map(group => {
          const h = group.querySelector('.sn2-header');
          if (!h) return null;
          if (measurements?.has(h)) return measurements.get(h);
          const height = h.getBoundingClientRect().height / zV;
          measurements?.set(h, height);
          return height;
        });
        verticalWrapHeaderHeight = headerHeights.find(height => height > 0) || 0;
        const groupRows = groups.map((group, index) => (headerHeights[index] == null ? [] : [...group.querySelectorAll('.sn2-row')]));
        groupRows.forEach((rows, index) => rows.forEach(r => {
          const height = headerHeights[index] + 'px';
          // CSSの文字列表現やzoom除算の丸め差で、同じ高さを書き直さない。
          const currentHeight = r.style.height || '';
          if (!currentHeight.endsWith('px') || Math.abs(parseFloat(currentHeight) - headerHeights[index]) >= 0.001) r.style.height = height;
        }));
        const widths = [];
        groupRows.forEach(rows => rows.forEach(r => {
          const txt = r.querySelector('.sn2-text');
          if (txt) widths.push([r, r.getBoundingClientRect().width / zV, txt.scrollWidth]);
        }));
        widths.forEach(([r, rowWidth, scrollW]) => {
          const minWidth = Math.ceil(scrollW) + 'px';
          if (scrollW > rowWidth && r.style.minWidth !== minWidth) r.style.minWidth = minWidth;
        });
      };
      const rebuildWrapColumns = (columnsToBuild) => {
        const groups = [...editor.querySelectorAll(':scope > .sn2-column-group')];
        columnsToBuild.forEach((colRows, groupIndex) => {
          let group = groups[groupIndex];
          if (!group) {
            group = document.createElement('div');
            group.className = 'sn2-column-group';
            group.appendChild(buildHeader(true, groupIndex === 0 ? '' : `wrap-${groupIndex + 1}`));
            editor.appendChild(group);
          }
          colRows.forEach((el, index) => {
            const before = group.children[index + 1] || null;
            if (before === el) return;
            if (window.GBPaneKeepAlive) GBPaneKeepAlive.move(group, el, before);
            else group.insertBefore(el, before);
          });
        });
        [...editor.children].forEach(child => {
          const index = groups.indexOf(child);
          if (!child.classList.contains('sn2-column-group') || index >= columnsToBuild.length) child.remove();
        });
        setColVars(editor);
      };
      const packWrapColumns = (sizes, availableSize) => {
        const packed = [[]];
        let current = 0;
        for (let i = 0; i < allRowEls.length; i++) {
          const rowSize = Math.max(1, Math.ceil(sizes[i] || 1));
          if (current + rowSize > availableSize && packed[packed.length - 1].length > 0) {
            packed.push([]);
            current = 0;
          }
          packed[packed.length - 1].push(allRowEls[i]);
          current += rowSize;
        }
        return packed;
      };
      const wrapColumnSignature = (columnsToCheck) => columnsToCheck
        .map(colRows => colRows.map(row => row.dataset.rowId || '').join(','))
        .join('|');
      const currentWrapColumnSignature = () => wrapColumnSignature([...editor.querySelectorAll('.sn2-column-group')]
        .map(group => [...group.querySelectorAll(':scope > .sn2-row')]));
      const measureWrapMargins = (el) => {
        const style = getComputedStyle(el);
        const before = parseFloat(viewMode === 'vertical' ? style.marginRight : style.marginTop) || 0;
        const after = parseFloat(viewMode === 'vertical' ? style.marginLeft : style.marginBottom) || 0;
        return { before, after, total: before + after };
      };
      const measureWrapOuterSize = (el) => {
        const rect = el.getBoundingClientRect();
        const margins = measureWrapMargins(el);
        const bodySize = (viewMode === 'vertical' ? rect.width : rect.height) / zPack;
        return Math.ceil(Math.max(bodySize + margins.total, 1));
      };
      const repackVerticalWrapFromFinalWidths = (measurements = null) => {
        if (viewMode !== 'vertical') return false;
        applyVerticalWrapSizing(measurements);
        return true;
      };
      const measureWrapOverflowAmounts = () => {
        const zV = typeof _getZoom === 'function' ? _getZoom() : 1;
        const currentScrollRect = scroll.getBoundingClientRect();
        if (viewMode === 'vertical') {
          const visibleRight = Math.min(
            currentScrollRect.right,
            currentScrollRect.left + (((scroll.clientWidth || currentScrollRect.width / zV) * zV))
          );
          return [...editor.querySelectorAll('.sn2-column-group > .sn2-row')].map(row => {
            const rect = row.getBoundingClientRect();
            return Math.max(0, currentScrollRect.left - rect.left, rect.right - visibleRight);
          }).filter(amount => amount > 1);
        }
        const visibleBottom = Math.min(
          currentScrollRect.bottom,
          currentScrollRect.top + (((scroll.clientHeight || currentScrollRect.height / zV) * zV))
        );
        return [...editor.querySelectorAll('.sn2-column-group > .sn2-row')].map(row => {
          const rect = row.getBoundingClientRect();
          return Math.max(0, currentScrollRect.top - rect.top, rect.bottom - visibleBottom);
        }).filter(amount => amount > 1);
      };
      const repackWrapFromFinalSizes = (force = false, measurements = null) => {
        if (viewMode === 'vertical') repackVerticalWrapFromFinalWidths(measurements);
        const overflowAmounts = measureWrapOverflowAmounts();
        if (!force && !overflowAmounts.length) return false;
        const zV = typeof _getZoom === 'function' ? _getZoom() : 1;
        const firstHeader = editor.querySelector('.sn2-column-group .sn2-header');
        const measuredHeaderSize = firstHeader
          ? (viewMode === 'vertical' ? firstHeader.getBoundingClientRect().width : firstHeader.getBoundingClientRect().height) / zV
          : headerSize;
        const currentMaxSize = measureWrapViewportSize();
        const baseAvailSize = Math.max(currentMaxSize - Math.ceil(measuredHeaderSize) - wrapFitGuard, 100);
        const finalRowSizes = allRowEls.map(measureWrapOuterSize);
        lastFinalRowSizes = finalRowSizes;
        const packedColumns = packWrapColumns(finalRowSizes, baseAvailSize);
        const needsRebuild = overflowAmounts.length || currentWrapColumnSignature() !== wrapColumnSignature(packedColumns);
        if (!needsRebuild) return false;
        rebuildWrapColumns(packedColumns);
        if (viewMode === 'vertical') repackVerticalWrapFromFinalWidths(measurements);
        const remainingOverflow = measureWrapOverflowAmounts();
        if (remainingOverflow.length) {
          const overflowGuard = Math.ceil(Math.max(...remainingOverflow) / zV) + wrapFitGuard;
          const adjustedAvailSize = Math.max(baseAvailSize - overflowGuard, 100);
          if (adjustedAvailSize < baseAvailSize) {
            rebuildWrapColumns(packWrapColumns(finalRowSizes, adjustedAvailSize));
            if (viewMode === 'vertical') repackVerticalWrapFromFinalWidths(measurements);
          }
        }
        return true;
      };
      const resetVerticalWrapHorizontalPosition = () => {
        if (viewMode !== 'vertical') return;
        scroll.scrollLeft = 0;
      };
      const settleWrapPacking = (forceFirstPass = false, resetPosition = true, measurements = new Map()) => {
        if (resetPosition) resetVerticalWrapHorizontalPosition();
        for (let pass = 0; pass < 4; pass += 1) {
          if (!repackWrapFromFinalSizes(forceFirstPass && pass === 0, measurements)) break;
        }
      };

      const rowSizes = cachedRowSizes.slice();
      unmeasuredRowIndices.forEach(index => { rowSizes[index] = headerSize; });

      // 段に分割
      const columns = packWrapColumns(rowSizes, availSize);

      // editorを再構築: 各段 = column-group div（ヘッダー + 行）
      // 子要素をdetach（参照を保持したまま除去）
      rebuildWrapColumns(columns);
      if (verticalMeasureHeader) verticalMeasureHeader.remove();
      // 仮レンダリング用のスタイルをリセット
      editor.style.removeProperty('display');
      editor.style.removeProperty('flex-direction');
      editor.style.removeProperty('align-items');
      editor.style.removeProperty('width');
      this._repackWrapForResize = (refreshRows = false) => {
        const top = scroll.scrollTop, left = scroll.scrollLeft;
        if (refreshRows) {
          const byId = new Map([...editor.querySelectorAll('.sn2-row')].map(row => [row.dataset.rowId, row]));
          const current = this.doc.rows.map(row => byId.get(row.id));
          if (current.some(row => !row)) return false;
          allRowEls.splice(0, allRowEls.length, ...current);
        }
        settleWrapPacking(true);
        scroll.scrollTop = top; scroll.scrollLeft = left;
        return true;
      };
      const ownerDocument = this.doc, ownerHost = this.host;
      this._refreshScriptNoteColumnLayout = () => {
        if (this.doc !== ownerDocument || this.host !== ownerHost || !scroll.isConnected
          || !ownerHost.contains(scroll)) return false;
        const specifications = new Map(buildColumns().map(column => [column.id, column]));
        const ids = this._getVisibleColumnIds();
        if (ids.length !== cols.length || new Set(ids).size !== ids.length
          || ids.some(id => !specifications.has(id) || !cols.some(column => column.id === id))) return false;
        const models = new Map(this.doc.rows.map(row => [row.id, row]));
        const rows = allRowEls.map(row => ({ row, model: models.get(row.dataset.rowId), cells: new Map([...row.children]
          .filter(cell => cell.dataset?.colId).map(cell => [cell.dataset.colId, cell])) }));
        if (rows.some(({ model, cells }) => !model || ids.some(id => !cells.has(id)))) return false;
        let nextColumnWidth = null;
        if (viewMode !== 'vertical') {
          const previousWidth = parseFloat(editor.style.getPropertyValue('--sn2-column-width'));
          if (!Number.isFinite(previousWidth) || previousWidth <= 0) return false;
          // 既存の見積りに含まれる非表示列等の幅は保持し、変えた列の差だけ反映する。
          nextColumnWidth = previousWidth + cols.reduce((sum, column) => sum
            + (specifications.get(column.id).width || 300) - (column.width || 300), 0);
          if (nextColumnWidth <= 0) return false;
        }
        const top = scroll.scrollTop, left = scroll.scrollLeft;
        const orderChanged = ids.some((id, index) => cols[index].id !== id);
        cols.splice(0, cols.length, ...ids.map(id => specifications.get(id)));
        rows.forEach(({ row, model, cells }) => {
          // スペーサー等は末尾へ残し、編集欄を同じ要素のまま並べ直す。
          const tail = [...row.children].filter(cell => !cell.dataset?.colId);
          const order = [...ids.map(id => cells.get(id)), ...tail];
          order.forEach((cell, index) => {
            if (row.children[index] === cell) return;
            if (window.GBPaneKeepAlive) GBPaneKeepAlive.move(row, cell, row.children[index] || null);
            else row.insertBefore(cell, row.children[index] || null);
          });
          row.style.removeProperty('min-width');
          if (orderChanged) this._applyRowStyle(row, model.role);
        });
        [...editor.querySelectorAll('.sn2-column-group')].forEach((group, index) => {
          group.querySelector('.sn2-header')?.replaceWith(buildHeader(true, index ? `wrap-${index + 1}` : ''));
        });
        setColVars(scroll); setColVars(editor);
        if (nextColumnWidth !== null) editor.style.setProperty('--sn2-column-width', nextColumnWidth + 'px');
        // 初期配置と同じく、高さを先に決めてルビを測り、全行の配置は最後の1回にする。
        if (viewMode === 'vertical') applyVerticalWrapSizing();
        this._adjustRubySpacing();
        this._repackWrapForResize();
        this._setupPanSpacer(scroll, editor, viewMode);
        scroll.scrollTop = top; scroll.scrollLeft = left;
        return true;
      };
      this._bind();
      this._applyReadOnlyDom();
      // 先に行の高さを決め、ルビ等の寸法が確定してから段を最終配置する。
      // まだ寸法の変わる途中で全行を段組みすると、直後に同じ計測をやり直す。
      // 同期更新中だけ同じ見出しの実寸を共有する。別フレーム・リサイズには持ち越さない。
      const initialHeaderMeasurements = new Map();
      if (viewMode === 'vertical') applyVerticalWrapSizing(initialHeaderMeasurements);
      this._adjustRubySpacing();
      // 新しく作った領域は未スクロール。以後の再配置では従来どおり起点へ戻して測る。
      settleWrapPacking(true, false, initialHeaderMeasurements);
      if (lastFinalRowSizes?.length === wrapRowKeys.length) {
        // Undo/Redoで直前の本文へ戻る時も、その本文の実測寸法を再利用する。
        // 最終配置は上で毎回検査する。異なる表示設定はglobalKeyで分離し、
        // 保持量は現在の行数の3倍までにして、編集履歴全体を溜め込まない。
        const measuredSizes = new Map(wrapSizeCache || []);
        wrapRowKeys.forEach((key, index) => {
          measuredSizes.delete(key);
          measuredSizes.set(key, lastFinalRowSizes[index]);
        });
        const cacheLimit = Math.max(64, wrapRowKeys.length * 3);
        while (measuredSizes.size > cacheLimit) measuredSizes.delete(measuredSizes.keys().next().value);
        this._rememberWrapRowSizeCache({
          globalKey: wrapSizeGlobalKey,
          map: measuredSizes,
          verticalHeight: verticalWrapHeaderHeight,
        });
      }
      // 縦書き折り返し: 各段のヘッダー高さを測定し行に適用 + テキスト幅拡張
      if (viewMode === 'vertical') {
        requestAnimationFrame(() => {
          if (this.doc !== ownerDocument || this.host !== ownerHost || !scroll.isConnected
            || !ownerHost.contains(scroll)) return;
          settleWrapPacking(true);
