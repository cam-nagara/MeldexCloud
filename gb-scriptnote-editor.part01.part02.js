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
      const measureWrapViewportSize = () => {
        const rect = scroll.getBoundingClientRect();
        const rectSize = (viewMode === 'vertical' ? rect.width : rect.height) / zPack;
        const clientSize = viewMode === 'vertical' ? scroll.clientWidth : scroll.clientHeight;
        if (Number.isFinite(clientSize) && clientSize > 0) return Math.min(rectSize, clientSize);
        return rectSize;
      };
      const wrapFitGuard = 2;
      const maxSize = measureWrapViewportSize();
      let verticalMeasureHeader = null;
      if (viewMode === 'vertical') {
        verticalMeasureHeader = buildHeader(false, 'measure');
        verticalMeasureHeader.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;';
        scroll.appendChild(verticalMeasureHeader);
        const headerHeight = verticalMeasureHeader.getBoundingClientRect().height / zPack;
        if (headerHeight > 0) {
          allRowEls.forEach(el => { el.style.height = headerHeight + 'px'; });
        }
      }
      // ヘッダーサイズ: 縦書きではヘッダーの幅（行と同じ方向で場所を取る）
      // 仮測定ではなく、固定値を使う（ヘッダーの実幅は行のレイアウト確定後でないと正確に測れない）
      const headerSize = viewMode === 'vertical' ? 40 : 28;
      const availSize = Math.max(maxSize - headerSize - wrapFitGuard, 100);

      const applyVerticalWrapSizing = () => {
        if (viewMode !== 'vertical') return;
        const zV = typeof _getZoom === 'function' ? _getZoom() : 1;
        editor.querySelectorAll('.sn2-column-group').forEach(group => {
          const h = group.querySelector('.sn2-header');
          if (!h) return;
          const hH = h.getBoundingClientRect().height / zV;
          group.querySelectorAll('.sn2-row').forEach(r => {
            r.style.height = hH + 'px';
            const txt = r.querySelector('.sn2-text');
            if (txt) {
              const rW = r.getBoundingClientRect().width / zV;
              const scrollW = txt.scrollWidth;
              if (scrollW > rW) {
                r.style.minWidth = Math.ceil(scrollW) + 'px';
              }
            }
          });
        });
      };
      const rebuildWrapColumns = (columnsToBuild) => {
        while (editor.firstChild) editor.removeChild(editor.firstChild);
        columnsToBuild.forEach((colRows, groupIndex) => {
          const group = document.createElement('div');
          group.className = 'sn2-column-group';
          group.appendChild(buildHeader(false, groupIndex === 0 ? '' : `wrap-${groupIndex + 1}`));
          colRows.forEach(el => group.appendChild(el));
          editor.appendChild(group);
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
      const repackVerticalWrapFromFinalWidths = () => {
        if (viewMode !== 'vertical') return false;
        scroll.scrollLeft = 0;
        applyVerticalWrapSizing();
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
      const repackWrapFromFinalSizes = (force = false) => {
        if (viewMode === 'vertical') repackVerticalWrapFromFinalWidths();
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
        const packedColumns = packWrapColumns(finalRowSizes, baseAvailSize);
        const needsRebuild = overflowAmounts.length || currentWrapColumnSignature() !== wrapColumnSignature(packedColumns);
        if (!needsRebuild) return false;
        rebuildWrapColumns(packedColumns);
        if (viewMode === 'vertical') repackVerticalWrapFromFinalWidths();
        const remainingOverflow = measureWrapOverflowAmounts();
        if (remainingOverflow.length) {
          const overflowGuard = Math.ceil(Math.max(...remainingOverflow) / zV) + wrapFitGuard;
          const adjustedAvailSize = Math.max(baseAvailSize - overflowGuard, 100);
          if (adjustedAvailSize < baseAvailSize) {
            rebuildWrapColumns(packWrapColumns(finalRowSizes, adjustedAvailSize));
            if (viewMode === 'vertical') repackVerticalWrapFromFinalWidths();
          }
        }
        return true;
      };
      const resetVerticalWrapHorizontalPosition = () => {
        if (viewMode !== 'vertical') return;
        scroll.scrollLeft = 0;
      };
      const settleWrapPacking = (forceFirstPass = false) => {
        for (let pass = 0; pass < 4; pass += 1) {
          if (!repackWrapFromFinalSizes(forceFirstPass && pass === 0)) break;
        }
        resetVerticalWrapHorizontalPosition();
      };

      // 各行のサイズを測定（CSS ピクセルに正規化）
      const measureWrapRowSize = (el) => {
        let size = measureWrapOuterSize(el);
        if (viewMode === 'vertical') {
          // 縦書きは最終行高を先に適用してから実効幅を測る。
          // 行高未確定の scrollWidth を使うと長文方向の値になり、段が2行程度で折れる。
          const margins = measureWrapMargins(el);
          size = Math.max(size, (el.scrollWidth || 0) + margins.total);
          const txt = el.querySelector('.sn2-text');
          if (txt) {
            const textBodyWidth = txt.scrollWidth || 0;
            const textOuterWidth = textBodyWidth + margins.total;
            if (textOuterWidth > size) {
              el.style.minWidth = Math.ceil(textBodyWidth) + 'px';
              size = Math.max(textOuterWidth, measureWrapOuterSize(el));
            }
          }
        }
        return Math.ceil(Math.max(size, 1));
      };
      const rowSizes = allRowEls.map(measureWrapRowSize);

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
      settleWrapPacking(true);
      this._bind();
      this._applyReadOnlyDom();
      this._adjustRubySpacing();
      settleWrapPacking(true);
      // 縦書き折り返し: 各段のヘッダー高さを測定し行に適用 + テキスト幅拡張
      if (viewMode === 'vertical') {
        requestAnimationFrame(() => {
          settleWrapPacking(true);
