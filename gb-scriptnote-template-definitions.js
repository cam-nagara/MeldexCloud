/* gb-scriptnote-template-definitions.js: 版付きシナリオ書式の正本。
 * 編集画面、テンプレートカード、印刷レイアウトは同じ定義を参照する。
 */
(function initScriptNoteTemplateDefinitions(global) {
  'use strict';

  const VERSION = 1;
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const sources = {
    drama: ['https://www.eiren.org/kido/', 'data/page-setup-presets/scriptnote/drama-kido-a4l-20x40.json'],
    afureko: ['https://www.scenarioprint.com/dubbing.html', 'data/page-setup-presets/scriptnote/afureko-b5-2col.json'],
    stage: ['https://www.scenario.co.jp/online/37018/', 'data/page-setup-presets/scriptnote/stage-print-b5-20x20.json'],
    manga: ['data/page-setup-presets/scriptnote/manga-a4-h-modern.json'],
  };

  const common = {
    templateVersion: VERSION,
    binding: 'right',
    writingMode: 'vertical-rl',
    textOrientation: 'mixed',
    punctuation: 'ja',
    pageNumber: { enabled: true, position: 'outside-bottom', start: 1 },
    pagination: { avoidOrphanHeading: true, keepRoleWithDialogue: true, manualBreakKind: 'pageBreak' },
  };

  const definitions = [
    {
      id: 'manga', name: 'マンガシナリオ', purpose: 'マンガのページ・コマ構成', sourceRefs: sources.manga,
      description: 'ページとコマ、セリフ、ト書き、モノローグを編集する横書き中心の書式。',
      layoutMode: 'manga', writingMode: 'horizontal-tb', binding: 'left',
      paper: { size: 'A4', orientation: 'portrait', widthMm: 210, heightMm: 297 },
      margin: { topMm: 18, bottomMm: 18, innerMm: 18, outerMm: 18 },
      grid: { charsPerLine: 40, linesPerPage: 36, fontSizePt: 10.5, lineSpacingPt: 16 },
      fonts: { body: 'Yu Gothic', heading: 'Yu Gothic', fallback: ['Noto Sans JP', 'sans-serif'] },
      sample: [['heading', 'P1'], ['cut', 'コマ1　教室・放課後'], ['action', '窓の外を見る主人公'], ['dialogue', '主人公「……まだ帰らないの？」']],
    },
    {
      id: 'drama', name: 'ドラマ・映画シナリオ', purpose: '劇場映画・映像脚本の応募／決定稿', sourceRefs: sources.drama,
      description: 'A4横、右綴じ、縦書き20字×40行。柱、ト書き、役名、台詞を一括設定します。',
      layoutMode: 'drama',
      paper: { size: 'A4', orientation: 'landscape', widthMm: 297, heightMm: 210 },
      margin: { topMm: 33, bottomMm: 33, innerMm: 36, outerMm: 33 },
      grid: { charsPerLine: 20, linesPerPage: 40, fontSizePt: 10.5, lineSpacingPt: 16.35 },
      fonts: { body: 'Yu Mincho', heading: 'HG Gothic M', fallback: ['Noto Serif JP', 'MS Mincho', 'serif'] },
      paragraph: { pillarIndentChars: 0, actionIndentChars: 3, roleIndentChars: 0, dialogueWrapIndentChars: 1 },
      sections: ['cover', 'synopsis', 'characterList', 'body'],
      sample: [['heading', '○ 駅前・夜'], ['action', '　雨が降っている。'], ['dialogue', '主人公「待った？」'], ['dialogue', 'ヒロイン「ううん、今来たところ」']],
    },
    {
      id: 'afureko', name: 'アフレコシナリオ', purpose: '声優収録用アフレコ台本', sourceRefs: sources.afureko,
      description: 'B5縦、右綴じ、縦書き。C／画面／M／音声の区画とカット罫線を適用します。',
      layoutMode: 'afureko',
      paper: { size: 'B5', orientation: 'portrait', widthMm: 182, heightMm: 257 },
      margin: { topMm: 25, bottomMm: 30, innerMm: 24, outerMm: 24 },
      grid: { charsPerLine: 18, linesPerPage: 18, fontSizePt: 12, lineSpacingPt: 28 },
      fonts: { body: 'Noto Serif JP', heading: 'Noto Sans JP', fallback: ['Yu Mincho', 'MS Mincho', 'serif'] },
      bands: [
        { id: 'cut', label: 'C', ratio: 0.10 }, { id: 'picture', label: '画面', ratio: 0.30 },
        { id: 'music', label: 'M', ratio: 0.10 }, { id: 'voice', label: '音声', ratio: 0.50 },
      ],
      rules: { cutBorder: true, repeatBandHeader: true, repeatRoleOnPageBreak: true },
      sample: [['heading', 'C 12'], ['picture', '主人公が振り向く'], ['music', 'M IN'], ['dialogue', '主人公「行くぞ！」']],
    },
    {
      id: 'stage', name: '舞台シナリオ', purpose: '舞台脚本の応募原稿／製本台本', sourceRefs: sources.stage,
      description: 'B5横、右綴じ、縦書き20字×20行。幕／場、ト書き、役名、音響・照明指示を適用します。',
      layoutMode: 'stage',
      paper: { size: 'B5', orientation: 'landscape', widthMm: 257, heightMm: 182 },
      margin: { topMm: 29, bottomMm: 29, innerMm: 26, outerMm: 26 },
      grid: { charsPerLine: 20, linesPerPage: 20, fontSizePt: 10.5, lineSpacingPt: 16 },
      fonts: { body: 'Yu Mincho', heading: 'Yu Mincho', fallback: ['Noto Serif JP', 'MS Mincho', 'serif'] },
      paragraph: { headingIndentChars: 0, actionIndentChars: 4, roleIndentChars: 0, dialogueWrapIndentChars: 1 },
      marks: { stageLeft: '上手', stageRight: '下手', music: 'M', sound: 'SE', lighting: '照明' },
      sample: [['heading', '第一幕　第一場'], ['action', '（明転。主人公、上手より登場）'], ['dialogue', '主人公「ここにいたのか」'], ['cue', 'SE　遠雷']],
    },
  ].map(item => Object.freeze({ ...common, ...item, templateVersion: VERSION }));

  const byId = new Map(definitions.map(item => [item.id, item]));

  function validate(definition) {
    if (!definition || !definition.id || !definition.layoutMode) throw new Error('シナリオテンプレートの識別情報がありません');
    if (!Number.isInteger(definition.templateVersion) || definition.templateVersion < 1) throw new Error('シナリオテンプレートの版が不正です');
    if (!definition.paper || !Number.isFinite(definition.paper.widthMm) || !Number.isFinite(definition.paper.heightMm)) throw new Error('シナリオテンプレートの用紙設定が不正です');
    if (!definition.grid || !Number.isFinite(definition.grid.charsPerLine) || !Number.isFinite(definition.grid.linesPerPage)) throw new Error('シナリオテンプレートの文字数・行数が不正です');
    if (!['vertical-rl', 'horizontal-tb'].includes(definition.writingMode)) throw new Error('シナリオテンプレートの組方向が不正です');
    if (!Array.isArray(definition.sourceRefs) || !definition.sourceRefs.length) throw new Error('シナリオテンプレートの根拠資料がありません');
    return definition;
  }

  function definition(id) {
    const value = byId.get(String(id || ''));
    return value ? clone(validate(value)) : null;
  }

  function prepareBuiltin(doc, id) {
    const spec = definition(id);
    if (!spec) throw new Error('指定された初期搭載テンプレートが見つかりません');
    const next = clone(doc || {});
    next.layoutMode = spec.layoutMode;
    next.templateId = spec.id;
    next.templateVersion = spec.templateVersion;
    next.templatePurpose = spec.purpose;
    next.templateSourceRefs = clone(spec.sourceRefs);
    next.pageSettings = clone(spec);
    next.editor = { ...(next.editor || {}), viewMode: spec.writingMode === 'vertical-rl' ? 'vertical' : 'horizontal' };
    next.rubyPresentation = { ...(next.rubyPresentation || {}), writingMode: next.editor.viewMode };
    const validation = global.GBScriptNoteRoleModel?.validateDocument?.(next);
    if (validation && !validation.valid) throw new Error(`テンプレート検査に失敗しました: ${validation.errors.join(' / ')}`);
    return { doc: next, definition: spec };
  }

  function prepareCustom(doc, template) {
    if (!template || typeof template !== 'object' || Array.isArray(template)) throw new Error('カスタムテンプレートが壊れています');
    const next = clone(doc || {});
    if (global.GBScriptNoteRoleModel?.applyTemplate) global.GBScriptNoteRoleModel.applyTemplate(next, clone(template));
    else {
      if (template.layoutMode) next.layoutMode = String(template.layoutMode);
      if (template.editor && typeof template.editor === 'object') next.editor = clone(template.editor);
      if (template.rubyPresentation && typeof template.rubyPresentation === 'object') next.rubyPresentation = clone(template.rubyPresentation);
    }
    const validation = global.GBScriptNoteRoleModel?.validateDocument?.(next);
    if (validation && !validation.valid) throw new Error(`カスタムテンプレート検査に失敗しました: ${validation.errors.join(' / ')}`);
    return { doc: next, definition: null };
  }

  function commit(target, prepared) {
    if (!target || !prepared?.doc) throw new Error('テンプレートの適用先を確認できません');
    const next = clone(prepared.doc);
    Object.keys(target).forEach(key => delete target[key]);
    Object.assign(target, next);
    return target;
  }

  function renderThumbnail(specOrId, host) {
    const spec = typeof specOrId === 'string' ? definition(specOrId) : clone(specOrId);
    validate(spec);
    const page = document.createElement('div');
    page.className = 'gb-tpl-doc sn-print-paper';
    page.dataset.templateId = spec.id;
    page.dataset.templateVersion = String(spec.templateVersion);
    page.style.aspectRatio = `${spec.paper.widthMm} / ${spec.paper.heightMm}`;
    page.style.writingMode = spec.writingMode;
    page.style.fontFamily = [spec.fonts?.body, ...(spec.fonts?.fallback || [])].filter(Boolean).join(',');
    page.style.setProperty('--sn-page-inner-mm', String(spec.margin?.innerMm || 20));
    (spec.bands || []).forEach(band => {
      const label = document.createElement('span'); label.className = 'sn-print-band-label'; label.textContent = band.label; page.appendChild(label);
    });
    (spec.sample || []).forEach(([kind, text]) => {
      const row = document.createElement('div');
      row.className = `gb-tpl-doc-line sn-print-row sn-print-row--${kind}`;
      row.textContent = text;
      page.appendChild(row);
    });
    host.appendChild(page);
  }

  definitions.forEach(validate);
  global.MeldexScriptNoteTemplateDefinitions = Object.freeze({
    VERSION,
    all: () => definitions.map(clone),
    get: definition,
    validate,
    prepareBuiltin,
    prepareCustom,
    commit,
    renderThumbnail,
  });
}(typeof globalThis !== 'undefined' ? globalThis : window));
