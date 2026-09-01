    row2.appendChild(fmt.makeGroup([fmt.makeLabel('形状'), shpSel]));
    const isRectShape = !style.shape || style.shape === 'rect';
    if (isRectShape) {
      const brInp = fmt.makeNumInput({ title: '角丸', value: style.borderRadius, min: 0, max: 64, onChange: (v) => setField('borderRadius', v == null ? 0 : v) });
      tag('borderRadius')(brInp);
      row2.appendChild(fmt.makeGroup([fmt.makeLabel('角丸'), brInp, fmt.makeLabel('px')]));
    }
    container.appendChild(row2);

    // 選択色・カーソル色はカードスタイル単位ではなくボード全体の設定 (bd.selectionColor / bd.caretColor) に移行。
    // カードスタイル UI からは除外し、ボード詳細パネル (選択なし時) で設定する。

    // --- Row 3 (雲型・トゲ型用): 山の幅 / 山の高さ / ズラし量 / 小山サイズ ---
    //   「張り出し」(cloudSideWidth) は楕円ベースに変更した v0.5.190 以降実際の描画に使われていないため UI から除外。
    if (style.shape === 'cloud' || style.shape === 'thorn' || style.shape === 'thorn-curve' || style.shape === 'fluffy') {
      const row3 = fmt.makeRow({ wrap: true });
      const cbw = fmt.makeNumInput({ title: '山の幅', value: style.cloudBumpWidth ?? 40, min: 8, max: 200, onChange: (v) => setField('cloudBumpWidth', v == null ? 40 : v) });
      tag('cloudBumpWidth')(cbw);
      row3.appendChild(fmt.makeGroup([fmt.makeLabel('山の幅'), cbw, fmt.makeLabel('px')]));
      const cbh = fmt.makeNumInput({ title: '山の高さ', value: style.cloudBumpHeight ?? 16, min: 2, max: 100, onChange: (v) => setField('cloudBumpHeight', v == null ? 16 : v) });
      tag('cloudBumpHeight')(cbh);
      row3.appendChild(fmt.makeGroup([fmt.makeLabel('山の高さ'), cbh, fmt.makeLabel('px')]));
      // ズラし量は 0〜100 (%) の整数で UI 表示し、内部では 0〜1 に正規化
      const offsetPct = Math.round((style.cloudOffset ?? 0.5) * 100);
      const coOff = fmt.makeNumInput({ title: 'ズラし量 (%)', value: offsetPct, min: 0, max: 100, onChange: (v) => setField('cloudOffset', v == null ? 50 : v) });
      tag('cloudOffset')(coOff);
      row3.appendChild(fmt.makeGroup([fmt.makeLabel('ズラし量'), coOff, fmt.makeLabel('%')]));
      // 小山サイズ比率 — メイン山の幅・高さを別々の % で縮小して小山とする。両方 > 0 で小山が現れる。
      const subWPct = Math.max(0, Math.min(100, Math.round(+(style.cloudSubWidthRatio ?? 0))));
      const subWInp = fmt.makeNumInput({ title: '小山の幅 (メイン山に対する %)', value: subWPct, min: 0, max: 100, onChange: (v) => setField('cloudSubWidthRatio', v == null ? 0 : v) });
      tag('cloudSubWidthRatio')(subWInp);
      row3.appendChild(fmt.makeGroup([fmt.makeLabel('小山幅'), subWInp, fmt.makeLabel('%')]));
      const subHPct = Math.max(0, Math.min(100, Math.round(+(style.cloudSubHeightRatio ?? 0))));
      const subHInp = fmt.makeNumInput({ title: '小山の高さ (メイン山に対する %)', value: subHPct, min: 0, max: 100, onChange: (v) => setField('cloudSubHeightRatio', v == null ? 0 : v) });
      tag('cloudSubHeightRatio')(subHInp);
      row3.appendChild(fmt.makeGroup([fmt.makeLabel('小山高'), subHInp, fmt.makeLabel('%')]));
      container.appendChild(row3);
    }
    // リセットボタンは詳細パネルの style-row に移動 (2026-04-18)
    return;
  }

  // kind === 'line'
  // --- Row 1: 色 + 太さ + ライン種 + 矢印 ---
  const lrow1 = fmt.makeRow({ wrap: true });
  lrow1.appendChild(tag('color')(fmt.makeSwatchBg({ title: '色', color: style.color || '', onPick: (c) => setField('color', c) })));
  const colorOpacityInp = fmt.makeNumInput({ title: 'ライン不透明度', value: Math.round(_bdNormalizeStyleOpacity(style.colorOpacity, 1) * 100), min: 0, max: 100, onChange: (v) => setField('colorOpacity', v == null ? 100 : v) });
  tag('colorOpacity')(colorOpacityInp);
  lrow1.appendChild(fmt.makeGroup([fmt.makeLabel('不透明度'), colorOpacityInp, fmt.makeLabel('%')]));
  const lwInp = fmt.makeNumInput({ title: '太さ', value: style.width, min: 0, max: 200, onChange: (v) => setField('width', v == null ? 0 : v) });
  tag('width')(lwInp);
  lrow1.appendChild(fmt.makeGroup([fmt.makeLabel('太さ'), lwInp, fmt.makeLabel('px')]));
  const lstyleSel = fmt.makeSelect({
    opts: [{ v: '', l: '実線' }, { v: 'dashed', l: '破線' }],
    value: style.style === 'dashed' ? 'dashed' : '',
    onChange: (v) => setField('style', v),
  });
  tag('style')(lstyleSel);
  lrow1.appendChild(fmt.makeGroup([fmt.makeLabel('種類'), lstyleSel]));
  const larrowSel = fmt.makeSelect({
    opts: [{ v: '', l: 'なし' }, { v: 'end', l: '順方向' }, { v: 'start', l: '逆方向' }, { v: 'both', l: '双方向' }],
    value: style.arrow || '',
    onChange: (v) => setField('arrow', v),
  });
  tag('arrow')(larrowSel);
  lrow1.appendChild(fmt.makeGroup([fmt.makeLabel('矢印'), larrowSel]));
  container.appendChild(lrow1);

  // --- Row 2: 形状 ---
  const lrow2 = fmt.makeRow({ wrap: true });
  // v0.5.320: pathType は 3 種 (curve/straight/orthogonal) に統合。
  // 旧 free-bezier は curve、旧 orthogonal-curve は orthogonal として表示。
  let curPath = style.pathType || (style.straight ? 'straight' : 'curve');
  if (curPath === 'free-bezier') curPath = 'curve';
  else if (curPath === 'orthogonal-curve') curPath = 'orthogonal';
  const lpathSel = fmt.makeSelect({
    opts: [
      { v: 'curve', l: '曲線' },
      { v: 'straight', l: '直線' },
      { v: 'orthogonal', l: '直角線' },
    ],
    value: curPath,
    onChange: (v) => setField('pathType', v),
  });
  tag('pathType')(lpathSel);
  lrow2.appendChild(fmt.makeGroup([fmt.makeLabel('形状'), lpathSel]));
  // v0.5.320: 直角線のパラメータ (コーナー半径 / 分岐位置)。pathType='orthogonal' のときのみ活性化
  // makeNumInput は整数のみ扱うため、branchRatio は % (5-95) で保持し、保存時に /100 する
  if (curPath === 'orthogonal') {
    const cornerInput = fmt.makeNumInput({ title: 'コーナー半径 (px)', value: Number.isFinite(+style.cornerRadius) ? +style.cornerRadius : 0, min: 0, max: 40, onChange: (v) => setField('cornerRadius', v == null ? 0 : v) });
    tag('cornerRadius')(cornerInput);
    lrow2.appendChild(fmt.makeGroup([fmt.makeLabel('コーナー半径'), cornerInput, fmt.makeLabel('px')]));
    const branchPct = Math.round((Number.isFinite(+style.branchRatio) ? +style.branchRatio : 0.3) * 100);
    const branchInput = fmt.makeNumInput({ title: '分岐位置 (%)', value: branchPct, min: 5, max: 95, onChange: (v) => setField('branchRatio', v == null ? 0.3 : Math.max(0.05, Math.min(0.95, v / 100))) });
    tag('branchRatio')(branchInput);
    lrow2.appendChild(fmt.makeGroup([fmt.makeLabel('分岐位置'), branchInput, fmt.makeLabel('%')]));
  }
  container.appendChild(lrow2);
  // ライン選択色はラインスタイル単位ではなくボード全体の設定 (bd.selectionColor) に移行。

  // --- ラベル（テキスト）のスタイル ---
  const textVisible = style.textVisible !== undefined ? !!style.textVisible : true;
  const textAlongPath = style.textAlongPath !== undefined ? !!style.textAlongPath : false;
  const textAutoFlip = style.textAutoFlip !== undefined ? !!style.textAutoFlip : true;
  const textShadowWidth = Number.isFinite(+style.textShadowWidth) ? +style.textShadowWidth : 0;
  const labelBorderWidth = Number.isFinite(+style.labelBorderWidth) ? +style.labelBorderWidth : 0;

  // --- Row 2.5: テキスト表示オン/オフ (テキスト設定直前に配置) ---
  const lrowTextToggle = fmt.makeRow({ wrap: true });
  const textVisibleCb = tag('textVisible')(fmt.makeCheckbox({
    text: 'テキスト', title: 'テキスト表示', checked: textVisible, onChange: (on) => setField('textVisible', on),
  }));
  lrowTextToggle.appendChild(textVisibleCb);
  container.appendChild(lrowTextToggle);

  // --- Row 3: テキスト書式 (背景 / 枠線色 / 枠線太さ / 文字色 / 太字 / 斜体 / 縁取 / フォント) ---
  // 並び順: 背景色 → 枠線色 → 枠線太さ → 文字色 → 太字 → 斜体 → 縁取(太さ + 色) → フォント
  const lrow3 = fmt.makeRow({ wrap: true });
  lrow3.appendChild(fmt.makeLabel('テキスト'));
  const labelBgSw = tag('labelBgColor')(fmt.makeSwatchBg({ title: 'テキスト背景色', color: style.labelBgColor || '', onPick: (c) => setField('labelBgColor', c) }));
  const labelBorderSw = tag('labelBorderColor')(fmt.makeSwatchBg({ title: 'テキスト枠線色', color: style.labelBorderColor || '', onPick: (c) => setField('labelBorderColor', c) }));
  lrow3.appendChild(labelBgSw);
  lrow3.appendChild(labelBorderSw);
  const labelBorderWInp = fmt.makeNumInput({ title: 'テキスト枠線太さ', value: labelBorderWidth, min: 0, max: 10, onChange: (v) => setField('labelBorderWidth', v == null ? 0 : v) });
  tag('labelBorderWidth')(labelBorderWInp);
  const labelBorderWGroup = fmt.makeGroup([fmt.makeLabel('枠線'), labelBorderWInp, fmt.makeLabel('px')]);
  lrow3.appendChild(labelBorderWGroup);
  lrow3.appendChild(tag('labelTextColor')(fmt.makeSwatchText({ title: 'テキスト文字色', color: style.labelTextColor || '', iconName: 'type', bgColor: style.labelBgColor || '', onPick: (c) => setField('labelTextColor', c) })));
  // ラインテキストの太字 / 斜体
  lrow3.appendChild(tag('fontBold')(fmt.makeToggle({ html: '<b>B</b>', title: '太字', active: !!style.fontBold, onToggle: (on) => setField('fontBold', on) })));
  lrow3.appendChild(tag('fontItalic')(fmt.makeToggle({ html: '<i>I</i>', title: '斜体', active: !!style.fontItalic, onToggle: (on) => setField('fontItalic', on) })));
  // 縁取 (斜体の後ろ、テキスト色・沿線回転とは独立)
  const shadowInp = fmt.makeNumInput({ title: '縁取り太さ', value: textShadowWidth, min: 0, max: 5, onChange: (v) => setField('textShadowWidth', v == null ? 0 : v) });
  tag('textShadowWidth')(shadowInp);
  const shadowColorSw = fmt.makeSwatchBg({ title: 'テキスト縁取り色', color: style.textShadowColor || '', onPick: (c) => setField('textShadowColor', c) });
  tag('textShadowColor')(shadowColorSw);
  lrow3.appendChild(fmt.makeGroup([fmt.makeLabel('縁取'), shadowInp, fmt.makeLabel('px'), shadowColorSw]));
  if (showFontFamily) {
    const lineFontFamilySel = fmt.makeSelect({ opts: _bdFontFamilyOptions(), value: _bdNormalizeFontFamily(style.fontFamily), onChange: (v) => setField('fontFamily', v) });
    lineFontFamilySel.classList.add('bd-font-family-select');
    tag('fontFamily')(lineFontFamilySel);
    lrow3.appendChild(fmt.makeGroup([fmt.makeLabel('フォント'), lineFontFamilySel]));
  }
  container.appendChild(lrow3);
  // 沿線回転 ON のときは labelBgColor / labelBorderColor / labelBorderWidth を非活性化
  // (SVG textPath では背景 / 枠線を描画できない)
  if (textAlongPath) {
    [labelBgSw, labelBorderSw, labelBorderWInp].forEach(el => {
      if (!el) return;
      el.disabled = true;
      el.style.opacity = '0.4';
      el.style.cursor = 'not-allowed';
    });
    labelBgSw.title = 'テキスト背景色 (沿線回転 ON のときは使用されません)';
    labelBorderSw.title = 'テキスト枠線色 (沿線回転 ON のときは使用されません)';
    labelBorderWInp.title = 'テキスト枠線太さ (沿線回転 ON のときは使用されません)';
  }

  // --- Row 4: 沿線回転 / 自動反転 ---
  const lrow4 = fmt.makeRow({ wrap: true });
  const alongCb = tag('textAlongPath')(fmt.makeCheckbox({
    text: '沿線回転', title: '沿線回転', checked: textAlongPath, onChange: (on) => setField('textAlongPath', on),
  }));
  lrow4.appendChild(alongCb);
  const flipCb = tag('textAutoFlip')(fmt.makeCheckbox({
    text: '自動反転', title: '自動反転 (90〜270°で読みやすい向きへ)', checked: textAutoFlip, onChange: (on) => setField('textAutoFlip', on),
  }));
  if (!textAlongPath) flipCb.style.opacity = '0.4';
  lrow4.appendChild(flipCb);
  container.appendChild(lrow4);
  // textVisible=false の時、他のテキスト系項目全体の透明度を下げる (視覚的な非活性化)
  if (!textVisible) {
    [lrow3, lrow4].forEach(row => {
      [...row.children].forEach(el => { el.style.opacity = '0.4'; });
    });
  }

  // 「テキストをラインに合わせる」はボードツールバー（フィルタメニュー）の表示トグルへ移行
  // （D-4、計画書 §4-3-A）
  // リセットボタンは詳細パネルの style-row に移動 (2026-04-18)
}

function bdDepthStyleLabel(index, total) {
  const nextIndex = Math.max(0, index | 0);
  const count = Math.max(1, total | 0);
  if (nextIndex === count - 1) return `深さ${nextIndex}+`;
  return `深さ${nextIndex}`;
}

function bdDepthStyleDisplayName(style, index, total) {
  const custom = String(style?.name || '').trim();
  if (custom) return custom;
  return `階層 ${Math.max(0, index | 0) + 1}`;
}

function _bdDepthStyleTooltip(style, index, total) {
  const label = bdDepthStyleDisplayName(style, index, total) || bdDepthStyleLabel(index, total);
  const fontSize = Math.max(8, +style?.fontSize || 13);
  const width = Math.max(40, +style?.width || 160);
  return `${label}\n文字 ${fontSize}px / 幅 ${width}px`;
}

function _bdDepthStylePreviewHtml(style) {
  const cardHtml = _bdCardStylePreviewHtml({
    bgColor: style?.bgColor || '',
    textColor: style?.textColor || '',
    borderColor: style?.borderColor || '',
    borderWidth: Number.isFinite(+style?.borderWidth) ? +style.borderWidth : 0,
    borderRadius: Number.isFinite(+style?.borderRadius) ? +style.borderRadius : 8,
    fontBold: !!style?.fontBold,
    fontItalic: !!style?.fontItalic,
    fontFamily: style?.fontFamily || '',
    textStrokeColor: style?.textStrokeColor || '',
    textStrokeWidth: Number.isFinite(+style?.textStrokeWidth) ? +style.textStrokeWidth : 0,
    shape: style?.shape || '',
    cloudBumpWidth: Number.isFinite(+style?.cloudBumpWidth) ? +style.cloudBumpWidth : 40,
    cloudBumpHeight: Number.isFinite(+style?.cloudBumpHeight) ? +style.cloudBumpHeight : 16,
    cloudSideWidth: Number.isFinite(+style?.cloudSideWidth) ? +style.cloudSideWidth : 12,
    cloudOffset: Number.isFinite(+style?.cloudOffset) ? +style.cloudOffset : 0.5,
    cloudSubWidthRatio: Number.isFinite(+style?.cloudSubWidthRatio) ? +style.cloudSubWidthRatio : 0,
    cloudSubHeightRatio: Number.isFinite(+style?.cloudSubHeightRatio) ? +style.cloudSubHeightRatio : 0,
  }).replace('Aa', '深');
  // 階層間ラインのプレビューを横に並べる。style.line が空（未設定）でも既定の薄いラインは出す。
  const linePreviewStyle = {
    color: style?.line?.color || '',
    width: Number.isFinite(+style?.line?.width) && +style.line.width > 0 ? +style.line.width : 2,
    style: style?.line?.style || '',
    arrow: style?.line?.arrow || '',
    pathType: style?.line?.pathType || 'curve',
    fontFamily: style?.line?.fontFamily || '',
  };
  const lineHtml = _bdLineStylePreviewHtml(linePreviewStyle);
  return `<span class="bd-depth-preview-group"><span class="bd-depth-preview-swatch">${cardHtml}</span><span class="bd-depth-preview-swatch bd-depth-preview-line">${lineHtml}</span></span>`;
}

function _bdNextStyle(kind, styles) {
  const cardDefaults = typeof bdDefaultCardStylesForBoard === 'function'
    ? bdDefaultCardStylesForBoard(typeof bd !== 'undefined' ? bd : undefined)
    : BD_DEFAULT_CARD_STYLES;
  const lineDefaults = typeof bdDefaultLineStylesForBoard === 'function'
    ? bdDefaultLineStylesForBoard(typeof bd !== 'undefined' ? bd : undefined)
    : BD_DEFAULT_LINE_STYLES;
  const seed = kind === 'card' ? _bdClone(cardDefaults[0]) : _bdClone(lineDefaults[0]);
  const baseName = kind === 'card' ? '新しいトピックスタイル' : '新しいラインスタイル';
  seed.name = _bdMakeUniqueStyleName(baseName, styles);
  seed.id = _bdNormalizeStyleId(`${kind}-style-${Date.now().toString(36)}`, `${kind}-style`);
  styles.push(seed);
  return seed;
}

function _bdApplyAllAutoStyles() {
  if (typeof bdApplyAutoStyle !== 'function') return 0;
  const anchors = bd.nodes.filter(node => node._autoStyle);
  anchors.forEach(node => bdApplyAutoStyle(node.id));
  return anchors.length;
}

// 課題13 (2026-08-14 実機切り分け): 「テーマカラーを階層別スタイルに適用」ボタンは常に
// bd.depthStyles 自体を更新するが、盤面上に _autoStyle (階層別スタイルの起点) を持つ
// カードが1枚もないボードでは、適用対象が無いため盤面の見た目は変わらない
// (プリセット/スタイル管理タブのスワッチ・次に作る新規カードには反映される)。
// 「壊れている」と誤解されないよう、対象0件のときは案内を分けて表示する。
function _bdCountAutoStyleAnchorNodes() {
  return (typeof bd !== 'undefined' && Array.isArray(bd.nodes))
    ? bd.nodes.filter(node => node && node._autoStyle).length
    : 0;
}
function _bdDepthThemeApplyStatusMessage(anchorCount) {
  return anchorCount > 0
    ? 'テーマカラーを階層別スタイルに適用しました'
    : '階層別スタイルが適用されているトピックがありません（プリセットの色は更新されました。トピックに反映するには右クリックメニュー等でトピックを階層別スタイルの起点にしてください）';
}
