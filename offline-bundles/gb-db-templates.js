/* ==============================
   gb-db-templates.js: DBテンプレートシステム
   Tier 1-3の組み込みテンプレート + カスタムテンプレート
   ============================== */

/* --- 組み込みテンプレート定義 --- */

const DB_TEMPLATE_SHEET = Object.freeze({
  char: 'キャラ',
  foreshadow: '伏線',
  arc: 'アーク',
  episode: 'エピソード',
  idea: 'アイデア',
  world: '世界設定',
  location: '舞台',
  organization: '組織',
  terminology: '用語',
  ability: '能力・魔法',
  item: 'アイテム',
  creature: 'クリーチャー・敵',
  race: '種族',
  history: '歴史イベント',
  incident: '事件',
  verse: 'バース',
  reference: '参考資料',
});

function _dbTplRelationType(type, targetSheet, reverseProp, opts = {}) {
  const out = { type, relationDb: '' };
  if (targetSheet) out.relationTemplate = targetSheet;
  if (reverseProp) {
    out.bidirectional = true;
    out.bidirectionalProp = reverseProp;
  }
  ['pairWith', 'dependencyDirection', 'cascadeFrom', 'cascadeKey'].forEach(key => {
    if (opts[key]) out[key] = opts[key];
  });
  return out;
}

const _dbTplProp = {
  text: name => ({ name, type: { type: 'text' } }),
  furigana: name => ({ name, type: { type: 'furigana' } }),
  number: name => ({ name, type: { type: 'number' } }),
  date: name => ({ name, type: { type: 'date' } }),
  checkbox: name => ({ name, type: { type: 'checkbox' } }),
  select: (name, options) => ({ name, type: { type: 'select', options } }),
  multiSelect: (name, options) => ({ name, type: { type: 'multi-select', options } }),
  url: name => ({ name, type: { type: 'url' } }),
  relation: (name, targetSheet = '', reverseProp = '', opts = {}) => ({ name, type: _dbTplRelationType('relation', targetSheet, reverseProp, opts) }),
  multiRelation: (name, targetSheet = '', reverseProp = '', opts = {}) => ({ name, type: _dbTplRelationType('multi-relation', targetSheet, reverseProp, opts) }),
  formula: (name, formula) => ({ name, type: { type: 'formula', formula } }),
};

function _dbTplFormulaSwitch(expr, cases, fallback = '0', quoteCase = true) {
  return cases.reduceRight((acc, [key, value]) => {
    const rhs = typeof value === 'number' ? String(value) : value;
    const test = quoteCase ? `${expr} == "${key}"` : `${expr} == ${key}`;
    return `if(${test}, ${rhs}, ${acc})`;
  }, fallback);
}

function _dbTplDateRangeSwitch(monthExpr, dayExpr, cases, fallback = '""') {
  return cases.reduceRight((acc, [startMonth, startDay, endMonth, endDay, label]) => {
    const test = `or(and(${monthExpr} == ${startMonth}, ${dayExpr} >= ${startDay}), and(${monthExpr} == ${endMonth}, ${dayExpr} <= ${endDay}))`;
    return `if(${test}, "${label}", ${acc})`;
  }, fallback);
}

const _CHAR_BODY_TYPES = ['痩せ型','美容体重','標準','ぽっちゃり(細)','ぽっちゃり','肥満','筋肉質','マッチョ','ゴリマッチョ'];
const _CHAR_CUPS = ['なし','AAA','AA','A','B','C','D','E','F','G','H','I','J','K','L'];
const _CHAR_WEIGHT_BMI_FORMULA = _dbTplFormulaSwitch('prop("体型")', [
  ['痩せ型', 18], ['美容体重', 19.5], ['ぽっちゃり(細)', 22], ['ぽっちゃり', 25],
  ['筋肉質', 25], ['マッチョ', 25], ['肥満', 35], ['ゴリマッチョ', 35],
], '21');
const _CHAR_UNDER_COEF_FORMULA = _dbTplFormulaSwitch('prop("体型")', [
  ['美容体重', 0.97], ['ぽっちゃり(細)', 0.9], ['痩せ型', 1.05], ['ぽっちゃり', 1.1],
  ['筋肉質', 1.1], ['マッチョ', 1.1], ['肥満', 1.2], ['ゴリマッチョ', 1.5],
], '1');
const _CHAR_WAIST_COEF_FORMULA = _dbTplFormulaSwitch('prop("体型")', [
  ['美容体重', 0.97], ['ぽっちゃり(細)', 0.9], ['痩せ型', 1.1], ['ぽっちゃり', 1.2],
  ['筋肉質', 1.4], ['マッチョ', 1.4], ['肥満', 'if(prop("性別") == "男", 1.6, 1.8)'], ['ゴリマッチョ', 1.3],
], '1');
const _CHAR_HIP_COEF_FORMULA = _dbTplFormulaSwitch('prop("体型")', [
  ['美容体重', 'if(prop("性別") == "男", 1, 1.05)'], ['ぽっちゃり(細)', 0.9], ['痩せ型', 1.05], ['ぽっちゃり', 1.1],
  ['筋肉質', 1.1], ['マッチョ', 1.1], ['肥満', 1.2], ['ゴリマッチョ', 1.4],
], '1');
const _CHAR_CUP_CM_FORMULA = _dbTplFormulaSwitch('prop("カップ")', [
  ['A', 10], ['B', 12.5], ['C', 15], ['D', 17.5], ['E', 20], ['F', 22.5],
  ['G', 25], ['H', 27.5], ['I', 30], ['J', 32.5], ['K', 35], ['L', 37.5],
], '0');
const _CHAR_CUP_KG_FORMULA = _dbTplFormulaSwitch('prop("カップ")', [
  ['A', 0.32], ['B', 0.45], ['C', 0.53], ['D', 0.75], ['E', 1], ['F', 1.18],
  ['G', 2.12], ['H', 3], ['I', 4], ['J', 5], ['K', 6], ['L', 7],
], '0');
const _CHAR_UNDER_BASE_FORMULA = `prop("身長cm") * if(prop("性別") == "男", 0.53, 0.432) * ${_CHAR_UNDER_COEF_FORMULA}`;
const _CHAR_WAIST_BASE_FORMULA = `prop("身長cm") * if(prop("性別") == "男", 0.44, 0.37) * ${_CHAR_WAIST_COEF_FORMULA}`;
const _CHAR_HIP_BASE_FORMULA = `prop("身長cm") * if(prop("性別") == "男", 0.51, 0.54) * ${_CHAR_HIP_COEF_FORMULA}`;
const _CHAR_AGE_FORMULA = 'if(or(empty(prop("生年月日_西暦")), empty(prop("基準年月日_西暦"))), "", year(prop("基準年月日_西暦")) - year(prop("生年月日_西暦")) - if(or(month(prop("基準年月日_西暦")) < month(prop("生年月日_西暦")), and(month(prop("基準年月日_西暦")) == month(prop("生年月日_西暦")), day(prop("基準年月日_西暦")) < day(prop("生年月日_西暦")))), 1, 0))';
const _CHAR_ETO_FORMULA = `if(empty(prop("生年月日_西暦")), "", let("n", mod(year(prop("生年月日_西暦")), 12), ${_dbTplFormulaSwitch('n', [[0, '"申"'], [1, '"酉"'], [2, '"戌"'], [3, '"亥"'], [4, '"子"'], [5, '"丑"'], [6, '"寅"'], [7, '"卯"'], [8, '"辰"'], [9, '"巳"'], [10, '"午"'], [11, '"未"']], '""', false)}))`;
const _CHAR_ZODIAC_FORMULA = `if(empty(prop("生年月日_西暦")), "", let("m", month(prop("生年月日_西暦")), "d", day(prop("生年月日_西暦")), ${_dbTplDateRangeSwitch('m', 'd', [
  [3, 21, 4, 19, '牡羊座'], [4, 20, 5, 20, '牡牛座'], [5, 21, 6, 21, '双子座'],
  [6, 22, 7, 22, '蟹座'], [7, 23, 8, 22, '獅子座'], [8, 23, 9, 22, '乙女座'],
  [9, 23, 10, 23, '天秤座'], [10, 24, 11, 22, '蠍座'], [11, 23, 12, 21, '射手座'],
  [12, 22, 1, 19, '山羊座'], [1, 20, 2, 18, '水瓶座'], [2, 19, 3, 20, '魚座'],
])}))`;
const _CHAR_TEMPLATE_PROPERTIES = [
  _dbTplProp.furigana('ふりがな'), _dbTplProp.text('一人称'), _dbTplProp.text('名前_アルファベット表記'),
  _dbTplProp.text('名前の由来'), _dbTplProp.text('本名'), _dbTplProp.text('異名'), _dbTplProp.text('異名_オリジナル'),
  _dbTplProp.date('生年月日_西暦'), _dbTplProp.date('基準年月日_西暦'), _dbTplProp.formula('年齢', _CHAR_AGE_FORMULA),
  _dbTplProp.formula('干支', _CHAR_ETO_FORMULA), _dbTplProp.formula('12星座', _CHAR_ZODIAC_FORMULA), _dbTplProp.select('性別', ['男','女','その他']), _dbTplProp.select('血液型', ['A','B','O','AB','不明']),
  _dbTplProp.number('身長cm'), _dbTplProp.select('体型', _CHAR_BODY_TYPES), _dbTplProp.select('カップ', _CHAR_CUPS),
  _dbTplProp.formula('体重kg', `if(empty(prop("身長cm")), "", round(((prop("身長cm") * prop("身長cm") * ${_CHAR_WEIGHT_BMI_FORMULA} / 10000) + ${_CHAR_CUP_KG_FORMULA}) * 10) / 10)`),
  _dbTplProp.formula('アンダーcm', `if(empty(prop("身長cm")), "", round((${_CHAR_UNDER_BASE_FORMULA}) * 10) / 10)`),
  _dbTplProp.formula('バストcm', `if(empty(prop("身長cm")), "", round(((${_CHAR_UNDER_BASE_FORMULA}) + ${_CHAR_CUP_CM_FORMULA}) * 10) / 10)`),
  _dbTplProp.formula('ウエストcm', `if(empty(prop("身長cm")), "", round((${_CHAR_WAIST_BASE_FORMULA}) * 10) / 10)`),
  _dbTplProp.formula('ヒップcm', `if(empty(prop("身長cm")), "", round((${_CHAR_HIP_BASE_FORMULA}) * 10) / 10)`),
  _dbTplProp.text('髪の色'), _dbTplProp.text('髪型'), _dbTplProp.text('瞳の色'), _dbTplProp.text('肌の色'), _dbTplProp.text('外見'),
  _dbTplProp.text('外見シルエット'), _dbTplProp.text('特徴的な傷・装飾'), _dbTplProp.text('くせ・しぐさ'), _dbTplProp.text('固有の小道具'),
  _dbTplProp.text('性格'), _dbTplProp.text('性格核'), _dbTplProp.text('矛盾'), _dbTplProp.text('嘘'), _dbTplProp.text('ゴースト'),
  _dbTplProp.text('WANT'), _dbTplProp.text('NEED'), _dbTplProp.text('オーラ'), _dbTplProp.text('弱点'), _dbTplProp.text('プライド'),
  _dbTplProp.text('過剰ポイント'), _dbTplProp.text('恐れ'), _dbTplProp.text('口調・口癖'), _dbTplProp.select('語彙レベル', ['低い','普通','高い','専門的','古風']),
  _dbTplProp.text('他キャラへの呼称'), _dbTplProp.text('人種'), _dbTplProp.text('出身'),
  _dbTplProp.text('職業'), _dbTplProp.text('生活'), _dbTplProp.text('親の真実'), _dbTplProp.text('正体'),
  _dbTplProp.select('役割', ['主人公','ヒロイン','味方','敵','モブ','メンター']), _dbTplProp.text('悪人'), _dbTplProp.text('悪人名'),
  _dbTplProp.select('キャラアークタイプ', ['正の変化','負の変化','フラット','負の不変','幻滅']),
  _dbTplProp.select('現在状態', ['未登場','登場中','退場','死亡','行方不明','掲載済み']),
  _dbTplProp.text('秘密'), _dbTplProp.text('戦闘能力'), _dbTplProp.text('能力'), _dbTplProp.text('物語的機能'), _dbTplProp.text('動機'), _dbTplProp.text('概要'),
  _dbTplProp.multiRelation('所属', DB_TEMPLATE_SHEET.organization, '構成員'), _dbTplProp.relation('出身地', DB_TEMPLATE_SHEET.location, '出身キャラ'),
  _dbTplProp.multiRelation('関連舞台', DB_TEMPLATE_SHEET.location, '関連キャラ'), _dbTplProp.multiRelation('保有能力', DB_TEMPLATE_SHEET.ability, '使用者'),
  _dbTplProp.multiRelation('所有アイテム', DB_TEMPLATE_SHEET.item, '所有者'), _dbTplProp.multiRelation('登場エピソード', DB_TEMPLATE_SHEET.episode, '登場キャラ'),
  _dbTplProp.relation('種族', DB_TEMPLATE_SHEET.race, '出身キャラ'), _dbTplProp.multiRelation('関連伏線', DB_TEMPLATE_SHEET.foreshadow, '関連キャラ'),
  _dbTplProp.multiRelation('関連アーク', DB_TEMPLATE_SHEET.arc, '関連キャラ'), _dbTplProp.multiRelation('関与事件', DB_TEMPLATE_SHEET.incident, '関係キャラ'),
  _dbTplProp.multiRelation('リーダー担当組織', DB_TEMPLATE_SHEET.organization, 'リーダー'),
  _dbTplProp.number('登場話'), _dbTplProp.text('初登場'), _dbTplProp.text('特徴'), _dbTplProp.multiRelation('人間関係'),
];

const BUILTIN_DB_TEMPLATES = [
  // ===== Tier 1（必須） =====
  {
    id: 'char-basic', name: 'キャラ', tier: 1,
    description: '登場人物の基本情報・身体値の自動計算・役割・人間関係を管理',
    icon: 'user',
    properties: _CHAR_TEMPLATE_PROPERTIES,
    colOrder: ['ふりがな','一人称','年齢','性別','役割','現在状態','キャラアークタイプ','性格核','矛盾','嘘','ゴースト','WANT','NEED','弱点','プライド','所属','出身地','種族','関連舞台','保有能力','所有アイテム','関連伏線','関連アーク','登場エピソード','登場話','特徴','人間関係'],
    colWidths: { 'ふりがな': 120, '一人称': 80, '年齢': 80, '性別': 80, '役割': 100, '現在状態': 100, 'キャラアークタイプ': 130, '性格核': 180, '矛盾': 220, '嘘': 200, 'ゴースト': 200, 'WANT': 180, 'NEED': 180, '弱点': 160, 'プライド': 180, '所属': 160, '出身地': 150, '種族': 130, '関連舞台': 180, '保有能力': 180, '所有アイテム': 180, '関連伏線': 180, '関連アーク': 170, '登場エピソード': 180, '登場話': 80, '特徴': 200, '人間関係': 220 },
    enabledModes: ['pivot','gallery'],
    entityTemplates: [
      { name: '味方キャラ', properties: [{ property: '役割', value: '味方', status: '案' }] },
      { name: '敵キャラ', properties: [{ property: '役割', value: '敵', status: '案' }] },
    ],
    countTypes: { '登場話': 'count', '役割': 'count', '性別': 'count', '現在状態': 'count' },
  },
  {
    id: 'foreshadow', name: '伏線', tier: 1,
    description: '伏線の仕込みと回収を追跡',
    icon: 'eye',
    properties: [
      _dbTplProp.furigana('ふりがな'),
      _dbTplProp.select('種類', ['セリフ','ビジュアル','構造','キャラクター','赤ニシン']),
      _dbTplProp.number('仕込み話'), _dbTplProp.multiRelation('仕込みエピソード', DB_TEMPLATE_SHEET.episode, '仕込み伏線'),
      _dbTplProp.text('仕込み方法'), _dbTplProp.text('カモフラージュ'),
      _dbTplProp.number('回収話'), _dbTplProp.multiRelation('回収エピソード', DB_TEMPLATE_SHEET.episode, '回収伏線'),
      _dbTplProp.text('回収方法'), _dbTplProp.select('回収状態', ['未仕込み','仕込み済み','部分回収','完全回収','放棄']),
      _dbTplProp.select('重要度', ['低','中','高','最重要']), _dbTplProp.select('読者認知度', ['気づいていない','薄々','確信']),
      _dbTplProp.checkbox('赤ニシンフラグ'), _dbTplProp.select('距離', ['短距離','中距離','長距離']),
      _dbTplProp.multiRelation('関連キャラ', DB_TEMPLATE_SHEET.char, '関連伏線'),
      _dbTplProp.multiRelation('関連アーク', DB_TEMPLATE_SHEET.arc, '関連伏線'),
      _dbTplProp.multiRelation('連動する伏線', DB_TEMPLATE_SHEET.foreshadow),
      _dbTplProp.text('内容'),
    ],
    colOrder: ['種類','仕込み話','仕込みエピソード','回収話','回収エピソード','回収状態','重要度','読者認知度','距離','関連キャラ','関連アーク','内容'],
    colWidths: { '種類': 120, '仕込み話': 80, '仕込みエピソード': 160, '回収話': 80, '回収エピソード': 160, '回収状態': 110, '重要度': 90, '読者認知度': 120, '距離': 90, '関連キャラ': 160, '関連アーク': 150, '内容': 260 },
    enabledModes: ['pivot','kanban'],
    entityTemplates: [],
    countTypes: { '仕込み話': 'count', '回収状態': 'count', '重要度': 'count' },
  },
  {
    id: 'arc', name: 'アーク', tier: 1,
    description: 'ストーリーアークの構造と進行を管理',
    icon: 'gitBranch',
    properties: [
      _dbTplProp.furigana('ふりがな'), _dbTplProp.number('アーク番号'), _dbTplProp.number('開始話'), _dbTplProp.number('終了話'),
      _dbTplProp.select('構造タイプ', ['A:目標達成','B:謎解明','C:対決','D:関係変化','E:自己実現','F:転落']),
      _dbTplProp.text('テーマ'), _dbTplProp.text('主人公の嘘と真実'), _dbTplProp.text('話数配分'), _dbTplProp.text('転換点配置'),
      _dbTplProp.text('概要'), _dbTplProp.text('感情曲線'),
      _dbTplProp.multiRelation('関連キャラ', DB_TEMPLATE_SHEET.char, '関連アーク'),
      _dbTplProp.multiRelation('関連伏線', DB_TEMPLATE_SHEET.foreshadow, '関連アーク'),
      _dbTplProp.multiRelation('エピソード', DB_TEMPLATE_SHEET.episode, '所属アーク'),
      _dbTplProp.multiRelation('前アークからの引継ぎ伏線', DB_TEMPLATE_SHEET.foreshadow),
      _dbTplProp.multiRelation('次アークへの種蒔き', DB_TEMPLATE_SHEET.foreshadow),
      _dbTplProp.select('状態', ['計画中','執筆中','完了']),
    ],
    colOrder: ['アーク番号','開始話','終了話','構造タイプ','テーマ','主人公の嘘と真実','関連キャラ','関連伏線','エピソード','状態'],
    colWidths: { 'アーク番号': 100, '開始話': 80, '終了話': 80, '構造タイプ': 140, 'テーマ': 200, '主人公の嘘と真実': 240, '関連キャラ': 170, '関連伏線': 170, 'エピソード': 170, '状態': 100 },
    enabledModes: ['pivot','timeline'],
    entityTemplates: [],
    countTypes: { '状態': 'count' },
  },
  {
    id: 'episode', name: 'エピソード', tier: 1,
    description: '各話の情報・進捗を管理',
    icon: 'fileText',
    properties: [
      _dbTplProp.number('話数'), _dbTplProp.text('サブタイトル'), _dbTplProp.relation('所属アーク', DB_TEMPLATE_SHEET.arc, 'エピソード'),
      _dbTplProp.text('あらすじ'), _dbTplProp.text('詳細プロット'), _dbTplProp.text('感情曲線'),
      _dbTplProp.select('ヒキ種別', ['逆転','新情報','危機','決断','謎','感情','その他']), _dbTplProp.text('ヒキ内容'),
      _dbTplProp.multiRelation('登場キャラ', DB_TEMPLATE_SHEET.char, '登場エピソード'),
      _dbTplProp.multiRelation('仕込み伏線', DB_TEMPLATE_SHEET.foreshadow, '仕込みエピソード'),
      _dbTplProp.multiRelation('回収伏線', DB_TEMPLATE_SHEET.foreshadow, '回収エピソード'),
      _dbTplProp.multiRelation('舞台', DB_TEMPLATE_SHEET.location, '登場エピソード'),
      _dbTplProp.multiRelation('事件', DB_TEMPLATE_SHEET.incident, '発生エピソード'),
      _dbTplProp.text('カタルシスポイント'), _dbTplProp.text('見せ場'), _dbTplProp.text('ページ配分'),
      _dbTplProp.number('ページ数'), _dbTplProp.select('状態', ['案','ネーム','下描き','完成','掲載済み']), _dbTplProp.date('掲載日'),
    ],
    colOrder: ['話数','サブタイトル','所属アーク','あらすじ','ヒキ種別','登場キャラ','仕込み伏線','回収伏線','舞台','事件','ページ数','状態','掲載日'],
    colWidths: { '話数': 70, 'サブタイトル': 200, '所属アーク': 150, 'あらすじ': 260, 'ヒキ種別': 100, '登場キャラ': 170, '仕込み伏線': 170, '回収伏線': 170, '舞台': 150, '事件': 150, 'ページ数': 80, '状態': 100, '掲載日': 120 },
    enabledModes: ['pivot','kanban','timeline'],
    entityTemplates: [],
    countTypes: { 'ページ数': 'sum', '状態': 'count' },
  },
  {
    id: 'idea', name: 'アイデア', tier: 1,
    description: 'アイデア・ネタの収集と分類',
    icon: 'lightbulb',
    properties: [
      _dbTplProp.text('内容'), _dbTplProp.select('種別', ['キャラ','世界設定','能力','プロット','ビジュアル','セリフ','事件','演出','その他']),
      _dbTplProp.select('優先度', ['高','中','低']), _dbTplProp.select('状態', ['未整理','検討中','採用','保留','ボツ']),
      _dbTplProp.multiRelation('関連キャラ', DB_TEMPLATE_SHEET.char), _dbTplProp.multiRelation('関連エピソード', DB_TEMPLATE_SHEET.episode),
      _dbTplProp.multiRelation('関連世界設定', DB_TEMPLATE_SHEET.world), _dbTplProp.multiRelation('関連資料', DB_TEMPLATE_SHEET.reference),
      _dbTplProp.text('メモ'),
    ],
    colOrder: ['内容','種別','優先度','状態','関連キャラ','関連エピソード','関連世界設定','関連資料','メモ'],
    colWidths: { '内容': 280, '種別': 110, '優先度': 80, '状態': 90, '関連キャラ': 160, '関連エピソード': 160, '関連世界設定': 170, '関連資料': 160, 'メモ': 260 },
    enabledModes: ['pivot','kanban'],
    entityTemplates: [],
    countTypes: { '種別': 'count', '状態': 'count' },
  },

  // ===== Tier 2（ほぼ必須） =====
  {
    id: 'world-setting', name: '世界設定', tier: 2,
    description: '世界観の構成要素を分類・管理',
    icon: 'globe',
    properties: [
      _dbTplProp.select('分類', ['歴史','国家・政治','階級・身分','地理・気候','経済','技術水準','文化','宗教','食べ物','人口','集落・都市','ファンタジック要素','組織・勢力','問題・紛争','言語・教育']),
      _dbTplProp.text('詳細'), _dbTplProp.text('制約条件'), _dbTplProp.text('連鎖関係'), _dbTplProp.select('重要度', ['低','中','高','最重要']),
      _dbTplProp.multiRelation('関連舞台', DB_TEMPLATE_SHEET.location, '所属世界設定'),
      _dbTplProp.multiRelation('関連組織', DB_TEMPLATE_SHEET.organization, '関連世界設定'),
      _dbTplProp.multiRelation('関連能力', DB_TEMPLATE_SHEET.ability, '関連世界設定'),
      _dbTplProp.multiRelation('関連用語', DB_TEMPLATE_SHEET.terminology, '関連世界設定'),
      _dbTplProp.multiRelation('関連歴史イベント', DB_TEMPLATE_SHEET.history, '関連世界設定'),
      _dbTplProp.multiRelation('参考資料', DB_TEMPLATE_SHEET.reference),
      _dbTplProp.text('影響範囲'),
    ],
    colOrder: ['分類','詳細','制約条件','連鎖関係','重要度','関連舞台','関連組織','関連能力','関連用語','影響範囲'],
    colWidths: { '分類': 150, '詳細': 300, '制約条件': 220, '連鎖関係': 220, '重要度': 90, '関連舞台': 170, '関連組織': 170, '関連能力': 170, '関連用語': 170, '影響範囲': 200 },
    enabledModes: ['pivot'],
    entityTemplates: [],
    countTypes: { '分類': 'count', '重要度': 'count' },
  },
  {
    id: 'location', name: '舞台', tier: 2,
    description: '物語の舞台・場所を管理',
    icon: 'mapPin',
    properties: [
      _dbTplProp.furigana('ふりがな'), _dbTplProp.text('地域'), _dbTplProp.select('スケール', ['部屋','建物','街区','都市','地域','国','大陸','世界','異界']),
      _dbTplProp.relation('上位舞台', DB_TEMPLATE_SHEET.location), _dbTplProp.multiRelation('下位舞台', DB_TEMPLATE_SHEET.location),
      _dbTplProp.select('機能', ['生活','学習','労働','政治','宗教','商業','戦闘','移動','隠れ家','監禁','その他']),
      _dbTplProp.text('特徴'), _dbTplProp.text('気候'), _dbTplProp.text('雰囲気・トーン'), _dbTplProp.text('人口規模'),
      _dbTplProp.relation('管理者', DB_TEMPLATE_SHEET.char), _dbTplProp.multiRelation('所属組織', DB_TEMPLATE_SHEET.organization, '拠点'),
      _dbTplProp.multiRelation('登場エピソード', DB_TEMPLATE_SHEET.episode, '舞台'),
      _dbTplProp.multiRelation('出身キャラ', DB_TEMPLATE_SHEET.char, '出身地'),
      _dbTplProp.multiRelation('関連キャラ', DB_TEMPLATE_SHEET.char, '関連舞台'),
      _dbTplProp.relation('所属世界設定', DB_TEMPLATE_SHEET.world, '関連舞台'),
      _dbTplProp.text('インフラ・交通'), _dbTplProp.text('建築様式'), _dbTplProp.text('天然資源'), _dbTplProp.select('推理適性', ['密室','閉鎖空間','群像','追跡','証拠隠蔽','不向き']),
      _dbTplProp.multiRelation('参考資料', DB_TEMPLATE_SHEET.reference),
    ],
    colOrder: ['ふりがな','地域','スケール','機能','特徴','気候','雰囲気・トーン','所属世界設定','所属組織','登場エピソード','出身キャラ','関連キャラ'],
    colWidths: { 'ふりがな': 120, '地域': 120, 'スケール': 100, '機能': 100, '特徴': 250, '気候': 120, '雰囲気・トーン': 160, '所属世界設定': 170, '所属組織': 170, '登場エピソード': 180, '出身キャラ': 170, '関連キャラ': 170 },
    enabledModes: ['pivot','gallery'],
    entityTemplates: [],
    countTypes: { 'スケール': 'count', '機能': 'count' },
  },
  {
    id: 'organization', name: '組織', tier: 2,
    description: '組織・団体の情報を管理',
    icon: 'users',
    properties: [
      _dbTplProp.furigana('ふりがな'), _dbTplProp.select('種類', ['政府','企業','秘密結社','学校','軍事','宗教','犯罪組織','自治組織','その他']),
      _dbTplProp.text('起源'), _dbTplProp.text('目的'), _dbTplProp.text('資金源'), _dbTplProp.text('指導体制'),
      _dbTplProp.number('構成員数'), _dbTplProp.text('構成員の性質'),
      _dbTplProp.relation('リーダー', DB_TEMPLATE_SHEET.char, 'リーダー担当組織'),
      _dbTplProp.multiRelation('構成員', DB_TEMPLATE_SHEET.char, '所属'),
      _dbTplProp.multiRelation('拠点', DB_TEMPLATE_SHEET.location, '所属組織'),
      _dbTplProp.text('階級・部署'), _dbTplProp.text('シンボル'), _dbTplProp.text('勢力関係'), _dbTplProp.text('変質・内部分裂'),
      _dbTplProp.multiRelation('関連世界設定', DB_TEMPLATE_SHEET.world, '関連組織'),
      _dbTplProp.multiRelation('関連エピソード', DB_TEMPLATE_SHEET.episode),
      _dbTplProp.multiRelation('関連組織', DB_TEMPLATE_SHEET.organization),
    ],
    colOrder: ['ふりがな','種類','目的','指導体制','構成員数','リーダー','構成員','拠点','関連世界設定','勢力関係','変質・内部分裂'],
    colWidths: { 'ふりがな': 120, '種類': 120, '目的': 240, '指導体制': 160, '構成員数': 90, 'リーダー': 130, '構成員': 180, '拠点': 170, '関連世界設定': 170, '勢力関係': 220, '変質・内部分裂': 220 },
    enabledModes: ['pivot'],
    entityTemplates: [],
    countTypes: { '種類': 'count' },
  },
  {
    id: 'terminology', name: '用語', tier: 2,
    description: '作品固有の用語を一覧管理',
    icon: 'bookOpen',
    properties: [
      _dbTplProp.text('読み'), _dbTplProp.select('分類', ['固有名詞','技術用語','スラング','制度','地名','能力用語','その他']),
      _dbTplProp.number('初出話'), _dbTplProp.relation('初出エピソード', DB_TEMPLATE_SHEET.episode),
      _dbTplProp.text('説明'), _dbTplProp.text('使用ルール'),
      _dbTplProp.multiRelation('関連世界設定', DB_TEMPLATE_SHEET.world, '関連用語'),
      _dbTplProp.multiRelation('関連キャラ', DB_TEMPLATE_SHEET.char),
      _dbTplProp.multiRelation('関連能力', DB_TEMPLATE_SHEET.ability),
    ],
    colOrder: ['読み','分類','初出話','初出エピソード','説明','関連世界設定','関連キャラ','関連能力'],
    colWidths: { '読み': 120, '分類': 110, '初出話': 80, '初出エピソード': 160, '説明': 300, '関連世界設定': 170, '関連キャラ': 160, '関連能力': 160 },
    enabledModes: ['pivot'],
    entityTemplates: [],
    countTypes: { '分類': 'count' },
  },

  // ===== Tier 3（ジャンル依存） =====
  {
    id: 'ability', name: '能力・魔法', tier: 3,
    description: '特殊能力・魔法体系を管理',
    icon: 'zap',
    properties: [
      _dbTplProp.select('系統', ['身体強化','放出','変化','操作','召喚','空間','時間','精神','情報','治癒','呪い','その他']),
      _dbTplProp.text('1行説明'), _dbTplProp.multiRelation('使用者', DB_TEMPLATE_SHEET.char, '保有能力'),
      _dbTplProp.number('威力'), _dbTplProp.select('応用可能性', ['低','中','高']), _dbTplProp.select('視覚インパクト', ['低','中','高']),
      _dbTplProp.text('発動条件'), _dbTplProp.text('代償'), _dbTplProp.text('制約'), _dbTplProp.text('クールダウン'), _dbTplProp.text('射程・範囲'),
      _dbTplProp.text('回数制限'), _dbTplProp.text('相性制限'), _dbTplProp.text('天敵'), _dbTplProp.text('副作用'),
      _dbTplProp.select('開示タイプ', ['D1:開示ボーナス','D2:推理開示','D3:条件開示','なし']),
      _dbTplProp.select('正体隠しパターン', ['H1:結果だけ提示','H2:ミスリード','H3:段階開示','なし']),
      _dbTplProp.multiRelation('関連アイテム', DB_TEMPLATE_SHEET.item, '関連能力'),
      _dbTplProp.multiRelation('関連世界設定', DB_TEMPLATE_SHEET.world, '関連能力'),
    ],
    colOrder: ['系統','1行説明','使用者','威力','応用可能性','視覚インパクト','発動条件','代償','制約','クールダウン','射程・範囲','開示タイプ','関連世界設定'],
    colWidths: { '系統': 120, '1行説明': 240, '使用者': 170, '威力': 80, '応用可能性': 100, '視覚インパクト': 120, '発動条件': 190, '代償': 190, '制約': 200, 'クールダウン': 140, '射程・範囲': 140, '開示タイプ': 150, '関連世界設定': 170 },
    enabledModes: ['pivot','gallery'],
    entityTemplates: [],
    countTypes: { '系統': 'count', '応用可能性': 'count', '視覚インパクト': 'count' },
  },
  {
    id: 'item', name: 'アイテム', tier: 3,
    description: '重要アイテムの情報を管理',
    icon: 'package',
    properties: [
      _dbTplProp.furigana('ふりがな'), _dbTplProp.select('種類', ['武器','防具','道具','素材','鍵','証拠','象徴物','消耗品','その他']),
      _dbTplProp.text('外見的特徴'), _dbTplProp.multiRelation('所有者', DB_TEMPLATE_SHEET.char, '所有アイテム'),
      _dbTplProp.text('効果'), _dbTplProp.text('物語上の機能'), _dbTplProp.text('入手経緯'), _dbTplProp.select('希少度', ['一般','レア','ユニーク','伝説級']),
      _dbTplProp.multiRelation('関連伏線', DB_TEMPLATE_SHEET.foreshadow),
      _dbTplProp.multiRelation('関連能力', DB_TEMPLATE_SHEET.ability, '関連アイテム'),
      _dbTplProp.relation('初出エピソード', DB_TEMPLATE_SHEET.episode),
    ],
    colOrder: ['ふりがな','種類','外見的特徴','所有者','効果','物語上の機能','関連伏線','関連能力','初出エピソード','希少度'],
    colWidths: { 'ふりがな': 120, '種類': 100, '外見的特徴': 220, '所有者': 170, '効果': 240, '物語上の機能': 220, '関連伏線': 170, '関連能力': 170, '初出エピソード': 160, '希少度': 90 },
    enabledModes: ['pivot','gallery'],
    entityTemplates: [],
    countTypes: { '種類': 'count', '希少度': 'count' },
  },
  {
    id: 'creature', name: 'クリーチャー・敵', tier: 3,
    description: 'モンスター・敵対存在の情報を管理',
    icon: 'skull',
    properties: [
      _dbTplProp.furigana('ふりがな'), _dbTplProp.select('種別', ['怪物','亜人','霊体','機械','人工生命','敵組織員','災害','その他']),
      _dbTplProp.select('脅威度', ['S','A','B','C','D']), _dbTplProp.select('知性', ['本能のみ','低い','人間並み','高い','超越']),
      _dbTplProp.text('モチーフ'), _dbTplProp.text('外見・特性'), _dbTplProp.relation('生息地', DB_TEMPLATE_SHEET.location),
      _dbTplProp.text('弱点'), _dbTplProp.multiRelation('能力', DB_TEMPLATE_SHEET.ability),
      _dbTplProp.multiRelation('関連キャラ', DB_TEMPLATE_SHEET.char), _dbTplProp.relation('初出エピソード', DB_TEMPLATE_SHEET.episode),
    ],
    colOrder: ['ふりがな','種別','脅威度','知性','モチーフ','外見・特性','生息地','弱点','能力','関連キャラ','初出エピソード'],
    colWidths: { 'ふりがな': 120, '種別': 120, '脅威度': 80, '知性': 100, 'モチーフ': 160, '外見・特性': 240, '生息地': 140, '弱点': 200, '能力': 170, '関連キャラ': 160, '初出エピソード': 160 },
    enabledModes: ['pivot','gallery'],
    entityTemplates: [],
    countTypes: { '種別': 'count', '脅威度': 'count', '知性': 'count' },
  },
  {
    id: 'race', name: '種族', tier: 3,
    description: '種族・民族の情報を管理',
    icon: 'users',
    properties: [
      _dbTplProp.furigana('ふりがな'), _dbTplProp.text('特徴'), _dbTplProp.text('身体的特徴'), _dbTplProp.text('文化'), _dbTplProp.text('社会構造'),
      _dbTplProp.text('寿命'), _dbTplProp.text('言語'), _dbTplProp.multiRelation('居住地域', DB_TEMPLATE_SHEET.location),
      _dbTplProp.multiRelation('出身キャラ', DB_TEMPLATE_SHEET.char, '種族'),
      _dbTplProp.multiRelation('関連世界設定', DB_TEMPLATE_SHEET.world),
    ],
    colOrder: ['ふりがな','特徴','身体的特徴','文化','社会構造','寿命','言語','居住地域','出身キャラ','関連世界設定'],
    colWidths: { 'ふりがな': 120, '特徴': 200, '身体的特徴': 200, '文化': 200, '社会構造': 200, '寿命': 100, '言語': 100, '居住地域': 170, '出身キャラ': 170, '関連世界設定': 170 },
    enabledModes: ['pivot'],
    entityTemplates: [],
    countTypes: {},
  },
  {
    id: 'history-event', name: '歴史イベント', tier: 3,
    description: '作品世界の歴史的出来事を管理',
    icon: 'calendar',
    properties: [
      _dbTplProp.furigana('ふりがな'), _dbTplProp.number('年表順'), _dbTplProp.text('時期'),
      _dbTplProp.select('タイプ', ['建国','戦争','災害','発明','事件','制度変更','人物史','その他']),
      _dbTplProp.select('規模', ['世界','国','地域','組織','個人']),
      _dbTplProp.text('原因'), _dbTplProp.text('結果'),
      _dbTplProp.multiRelation('原因イベント', DB_TEMPLATE_SHEET.history), _dbTplProp.multiRelation('結果イベント', DB_TEMPLATE_SHEET.history),
      _dbTplProp.multiRelation('関連キャラ', DB_TEMPLATE_SHEET.char), _dbTplProp.multiRelation('関連舞台', DB_TEMPLATE_SHEET.location),
      _dbTplProp.multiRelation('関連組織', DB_TEMPLATE_SHEET.organization), _dbTplProp.multiRelation('関連世界設定', DB_TEMPLATE_SHEET.world, '関連歴史イベント'),
    ],
    colOrder: ['ふりがな','年表順','時期','タイプ','規模','原因','結果','関連キャラ','関連舞台','関連組織','関連世界設定'],
    colWidths: { 'ふりがな': 120, '年表順': 80, '時期': 120, 'タイプ': 110, '規模': 80, '原因': 220, '結果': 250, '関連キャラ': 150, '関連舞台': 150, '関連組織': 150, '関連世界設定': 170 },
    enabledModes: ['pivot','timeline'],
    entityTemplates: [],
    countTypes: { 'タイプ': 'count', '規模': 'count' },
  },
  {
    id: 'incident', name: '事件', tier: 3,
    description: '事件・トリック・謎を管理（推理物向け）',
    icon: 'alertTriangle',
    properties: [
      _dbTplProp.furigana('ふりがな'), _dbTplProp.number('発生話'), _dbTplProp.select('種類', ['殺人','盗難','陰謀','事故','失踪','怪異','その他']),
      _dbTplProp.relation('舞台', DB_TEMPLATE_SHEET.location), _dbTplProp.relation('犯人', DB_TEMPLATE_SHEET.char),
      _dbTplProp.relation('被害者', DB_TEMPLATE_SHEET.char), _dbTplProp.multiRelation('容疑者', DB_TEMPLATE_SHEET.char),
      _dbTplProp.multiRelation('関係キャラ', DB_TEMPLATE_SHEET.char, '関与事件'),
      _dbTplProp.text('動機'), _dbTplProp.text('トリック'), _dbTplProp.text('証拠・手がかり'), _dbTplProp.text('ミスディレクション'),
      _dbTplProp.multiRelation('関連伏線', DB_TEMPLATE_SHEET.foreshadow),
      _dbTplProp.relation('発生エピソード', DB_TEMPLATE_SHEET.episode, '事件'), _dbTplProp.relation('解決エピソード', DB_TEMPLATE_SHEET.episode),
      _dbTplProp.select('解決状態', ['未解決','捜査中','解決','隠蔽']),
    ],
    colOrder: ['ふりがな','発生話','種類','舞台','犯人','被害者','容疑者','関係キャラ','動機','トリック','証拠・手がかり','ミスディレクション','関連伏線','発生エピソード','解決状態'],
    colWidths: { 'ふりがな': 120, '発生話': 80, '種類': 100, '舞台': 140, '犯人': 120, '被害者': 120, '容疑者': 170, '関係キャラ': 170, '動機': 200, 'トリック': 250, '証拠・手がかり': 240, 'ミスディレクション': 240, '関連伏線': 170, '発生エピソード': 160, '解決状態': 100 },
    enabledModes: ['pivot','kanban'],
    entityTemplates: [],
    countTypes: { '解決状態': 'count' },
  },
  {
    id: 'verse', name: 'バース', tier: 3,
    description: 'マルチバース・階層世界を管理',
    icon: 'layers',
    properties: [
      _dbTplProp.furigana('ふりがな'), _dbTplProp.select('階層', ['メイン','並行世界','上位世界','下位世界','夢・仮想','異界']),
      _dbTplProp.text('ジャンル'), _dbTplProp.text('ルール'), _dbTplProp.text('メインバースとの差分要素'),
      _dbTplProp.multiRelation('登場ヒロイン', DB_TEMPLATE_SHEET.char), _dbTplProp.text('主人公の変身形態'),
      _dbTplProp.multiRelation('含まれる舞台', DB_TEMPLATE_SHEET.location), _dbTplProp.multiRelation('関連世界設定', DB_TEMPLATE_SHEET.world),
      _dbTplProp.multiRelation('接続先', DB_TEMPLATE_SHEET.verse), _dbTplProp.select('状態', ['構想','使用中','完了','保留']),
    ],
    colOrder: ['ふりがな','階層','ジャンル','ルール','メインバースとの差分要素','登場ヒロイン','主人公の変身形態','含まれる舞台','関連世界設定','接続先','状態'],
    colWidths: { 'ふりがな': 120, '階層': 110, 'ジャンル': 140, 'ルール': 250, 'メインバースとの差分要素': 260, '登場ヒロイン': 170, '主人公の変身形態': 180, '含まれる舞台': 170, '関連世界設定': 170, '接続先': 170, '状態': 90 },
    enabledModes: ['pivot'],
    entityTemplates: [],
    countTypes: { '階層': 'count', '状態': 'count' },
  },
  {
    id: 'reference', name: '参考資料', tier: 3,
    description: '実在の場所・人物・文献を管理（閲覧専用）',
    icon: 'bookmark',
    properties: [
      _dbTplProp.select('種類', ['場所','人物','文献','画像','映像','技法','辞書','Web','その他']),
      _dbTplProp.url('URL'), _dbTplProp.text('著者・出典'), _dbTplProp.multiSelect('タグ', ['キャラ','世界設定','推理','演出','能力','資料']),
      _dbTplProp.multiRelation('関連キャラ', DB_TEMPLATE_SHEET.char),
      _dbTplProp.multiRelation('関連舞台', DB_TEMPLATE_SHEET.location),
      _dbTplProp.multiRelation('関連世界設定', DB_TEMPLATE_SHEET.world),
      _dbTplProp.multiRelation('関連エピソード', DB_TEMPLATE_SHEET.episode),
      _dbTplProp.multiRelation('関連用語', DB_TEMPLATE_SHEET.terminology),
      _dbTplProp.text('要点'), _dbTplProp.text('メモ'),
    ],
    colOrder: ['種類','URL','著者・出典','タグ','関連キャラ','関連舞台','関連世界設定','関連エピソード','関連用語','要点','メモ'],
    colWidths: { '種類': 100, 'URL': 220, '著者・出典': 170, 'タグ': 160, '関連キャラ': 160, '関連舞台': 160, '関連世界設定': 170, '関連エピソード': 160, '関連用語': 160, '要点': 260, 'メモ': 250 },
    enabledModes: ['pivot'],
    entityTemplates: [],
    countTypes: { '種類': 'count' },
  },
];

/* --- カスタムテンプレート管理 --- */

const CUSTOM_DB_TEMPLATES_KEY = 'customDbTemplates';

function _dbTemplateStorageKey(prefix, dbPath) {
  const fileId = typeof _pathToFileId === 'function' ? _pathToFileId(dbPath) : '';
  return prefix + (fileId || dbPath || '');
}

function _dbTemplateStorageKeys(dbPath, includeEntityTemplates) {
  const keys = [_dbTemplateStorageKey('dbViewConfig:', dbPath)];
  if (includeEntityTemplates) keys.push(_dbTemplateStorageKey('entityTemplates:', dbPath));
  return keys;
}

function _captureDbTemplateStorage(keys) {
  if (typeof captureLocalStorageSettings !== 'function') return null;
  if (typeof isLocalStorageSettingsHistorySuppressed === 'function'
    && isLocalStorageSettingsHistorySuppressed()) return null;
  return captureLocalStorageSettings(keys);
}

function _refreshDbTemplateHistoryUi(dbPath) {
  if (typeof document !== 'undefined') {
    document.querySelectorAll('[data-db-template-modal]').forEach(el => el.remove());
  }
  if (dbPath && typeof selectDatabase === 'function') {
    Promise.resolve(selectDatabase(dbPath)).catch(() => {});
  }
}

function _dbTemplateViewConfigStorageKey(dbPath) {
  return typeof getDbViewConfigStorageKey === 'function'
    ? getDbViewConfigStorageKey(dbPath)
    : _dbTemplateStorageKey('dbViewConfig:', dbPath);
}

function _dbTemplateConfigFromSnapshot(snapshot, dbPath) {
  const key = _dbTemplateViewConfigStorageKey(dbPath);
  const raw = snapshot?.storage && Object.prototype.hasOwnProperty.call(snapshot.storage, key)
    ? snapshot.storage[key]
    : null;
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; } catch { return {}; }
}

function _dbTemplatePropertyTypesFromSnapshot(snapshot, dbPath) {
  const cfg = _dbTemplateConfigFromSnapshot(snapshot, dbPath);
  return _cloneTemplateData(cfg.propertyTypes || {});
}

function _setDbTemplateMetadataPropertyTypes(dbPath, propertyTypes) {
  const nextTypes = _cloneTemplateData(propertyTypes || {});
  const targetMetadata = typeof _ptMetadataForDbPath === 'function'
    ? _ptMetadataForDbPath(dbPath)
    : ((typeof state !== 'undefined' && state.currentDbPath === dbPath) ? state.dbMetadata : null);
  if (targetMetadata) {
    targetMetadata.property_types = nextTypes;
    if (typeof state !== 'undefined' && state.currentDbPath === dbPath) state.dbMetadata = targetMetadata;
  }
}

function _restoreDbTemplateBackendPropertyTypes(dbPath, snapshot) {
  if (_dbTemplateProductionSchemaLocked(dbPath)) {
    // 表示設定の履歴は戻してよいが、過去snapshotの列型を制作管理へ戻すと
    // relation/date/user契約が壊れる。localStorage側にも現在の型を戻して揃える。
    const currentTypes = _dbTemplateCurrentPropertyTypes(dbPath);
    const cfg = getDbViewConfig(dbPath);
    cfg.propertyTypes = _cloneTemplateData(currentTypes);
    saveDbViewConfig(dbPath, cfg, { skipHistory: true, skipBackend: true });
    _setDbTemplateMetadataPropertyTypes(dbPath, currentTypes);
    if (typeof showProductionManagementSchemaLockedStatus === 'function') {
      showProductionManagementSchemaLockedStatus();
    }
    _refreshDbTemplateHistoryUi(dbPath);
    return Promise.resolve(false);
  }
  const propertyTypes = _dbTemplatePropertyTypesFromSnapshot(snapshot, dbPath);
  _setDbTemplateMetadataPropertyTypes(dbPath, propertyTypes);
  return _saveDbTemplatePropertyTypesToBackend(dbPath, propertyTypes)
    .then(() => _refreshDbTemplateHistoryUi(dbPath))
    .catch(e => {
      console.warn('シートテンプレート履歴復元のプロパティ型保存に失敗:', e);
      if (typeof showStatus === 'function') showStatus('テンプレート履歴の復元に失敗: ' + (e.message || e), true);
      _refreshDbTemplateHistoryUi(dbPath);
    });
}

function _dbTemplateHistoryRestoreHandler(dbPath) {
  if (!dbPath) return null;
  return (_keys, snapshot) => {
    return _restoreDbTemplateBackendPropertyTypes(dbPath, snapshot);
  };
}

function _pushDbTemplateStorageHistory(label, beforeSnapshot, keys, detail, dbPath) {
  if (!beforeSnapshot || typeof pushLocalStorageSettingsHistory !== 'function'
    || typeof captureLocalStorageSettings !== 'function') return false;
  return pushLocalStorageSettingsHistory(
    label || 'シートテンプレート: 設定変更',
    beforeSnapshot,
    captureLocalStorageSettings(keys),
    detail || '',
    _dbTemplateHistoryRestoreHandler(dbPath || '')
  );
}

function _confirmDbTemplate(message) {
  if (typeof cfConfirm === 'function') return cfConfirm(message);
  return Promise.resolve(window.confirm(message));
}

function getCustomTemplates() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_DB_TEMPLATES_KEY)) || []; }
  catch { return []; }
}

function saveCustomTemplates(templates, options = {}) {
  const before = options.skipHistory ? null : _captureDbTemplateStorage([CUSTOM_DB_TEMPLATES_KEY]);
  try {
    localStorage.setItem(CUSTOM_DB_TEMPLATES_KEY, JSON.stringify(templates));
    if (!options.skipHistory) {
      _pushDbTemplateStorageHistory(
        options.label || 'シートテンプレート: カスタムテンプレート変更',
        before,
        [CUSTOM_DB_TEMPLATES_KEY],
        options.detail || '',
        ''
      );
    }
    return true;
  } catch (e) {
    showStatus('カスタムテンプレートの保存に失敗: ' + (e.message || e), true);
    return false;
  }
}

function _cloneTemplateData(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function _dbTemplateNormalizePath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function _dbTemplateSiblingDbPath(dbPath, sheetName) {
  const path = _dbTemplateNormalizePath(dbPath);
  const cleanName = String(sheetName || '').trim().replace(/[\\/]+/g, '・');
  if (!path || !cleanName) return cleanName;
  const slash = path.lastIndexOf('/');
  return (slash >= 0 ? path.slice(0, slash + 1) : '') + cleanName;
}

function _resolveDbTemplatePropertyTypeForPath(typeConfig, dbPath, templateName = '') {
  const out = _cloneTemplateData(typeConfig || {});
  if (!out || (out.type !== 'relation' && out.type !== 'multi-relation')) return out;
  const targetSheet = out.relationTemplate || out.relationSheet || '';
  if (targetSheet) {
    const currentPath = _dbTemplateNormalizePath(dbPath);
    const isSelfReference = String(templateName || '') === String(targetSheet || '');
    const targetPath = isSelfReference ? currentPath : _dbTemplateNormalizePath(_dbTemplateSiblingDbPath(dbPath, targetSheet));
    out.relationDb = isSelfReference || targetPath === currentPath ? '' : targetPath;
    delete out.relationTemplate;
    delete out.relationSheet;
  }
  return out;
}

function _dbTemplateViewLabel(mode) {
  const found = (typeof VIEW_TYPES !== 'undefined' ? VIEW_TYPES : []).find(vt => vt.mode === mode);
  return found?.label || (mode === 'pivot' ? 'テーブル' : String(mode || 'ビュー'));
}

function _dbTemplateNormalizeViewMode(mode) {
  if (typeof _normalizeDbViewModeValue === 'function') return _normalizeDbViewModeValue(mode);
  const value = String(mode || '').trim();
  return ['pivot', 'tree', 'gallery', 'kanban', 'calendar', 'timeline', 'chart', 'graph', 'form'].includes(value)
    ? value
    : 'pivot';
}

function _normalizeDbTemplateView(view, cfg, index) {
  if (typeof _normalizeSavedDbViewForV2 === 'function') {
    return _normalizeSavedDbViewForV2(view, cfg, index);
  }
  return view;
}

function _ensureDbTemplateSavedViewsForModes(cfg, modes) {
  if (!Array.isArray(cfg.savedViews)) cfg.savedViews = [];
  const requested = (Array.isArray(modes) && modes.length ? modes : ['pivot'])
    .map(mode => _dbTemplateNormalizeViewMode(mode));
  if (cfg.savedViews.length === 0) {
    const mode = requested[0] || 'pivot';
    cfg.savedViews.push(_normalizeDbTemplateView({ name: _dbTemplateViewLabel(mode), viewMode: mode }, cfg, 0));
  }
  const existingModes = new Set(cfg.savedViews.map(view => view?.viewMode || 'pivot'));
  requested.forEach(mode => {
    if (existingModes.has(mode)) return;
    cfg.savedViews.push(_normalizeDbTemplateView({ name: _dbTemplateViewLabel(mode), viewMode: mode }, cfg, cfg.savedViews.length));
    existingModes.add(mode);
  });
  if (!Number.isInteger(cfg.currentViewIdx) || cfg.currentViewIdx < 0 || cfg.currentViewIdx >= cfg.savedViews.length) {
    cfg.currentViewIdx = 0;
  }
}

function _applyDbTemplateViewFields(cfg, template, overwrite) {
  _ensureDbTemplateSavedViewsForModes(cfg, template.enabledModes || ['pivot']);
  (cfg.savedViews || []).forEach(view => {
    if (!view || typeof view !== 'object') return;
    if (!Array.isArray(view.colOrder)) view.colOrder = [];
    if (template.colOrder) {
      template.colOrder.forEach(col => {
        if (!view.colOrder.includes(col)) view.colOrder.push(col);
      });
    }
    if (!view.colWidths || typeof view.colWidths !== 'object' || Array.isArray(view.colWidths)) view.colWidths = {};
    if (template.colWidths) {
      Object.entries(template.colWidths).forEach(([k, v]) => {
        if (!view.colWidths[k] || overwrite) view.colWidths[k] = v;
      });
    }
    if (!view.countTypes || typeof view.countTypes !== 'object' || Array.isArray(view.countTypes)) view.countTypes = {};
    if (template.countTypes) {
      Object.entries(template.countTypes).forEach(([k, v]) => {
        if (!view.countTypes[k] || overwrite) view.countTypes[k] = v;
      });
    }
  });
}

function _saveDbTemplatePropertyTypesToBackend(dbPath, propertyTypes) {
  _dbTemplateAssertProductionPropertyTypesUnchanged(dbPath, propertyTypes);
  if (typeof apiPut !== 'function') {
    _setDbTemplateMetadataPropertyTypes(dbPath, propertyTypes);
    return Promise.resolve(true);
  }
  const nextTypes = _cloneTemplateData(propertyTypes || {});
  return apiPut('/db-metadata?path=' + encodeURIComponent(dbPath), { property_types: nextTypes })
    .then(() => {
      _setDbTemplateMetadataPropertyTypes(dbPath, nextTypes);
      return true;
    });
}

function getAllTemplates() {
  return [...BUILTIN_DB_TEMPLATES, ...getCustomTemplates()];
}

/* --- テンプレート適用 --- */

/**
 * DBにテンプレートを適用する（加算方式: 既存設定を破壊しない）
 * @param {string} dbPath - DBフォルダパス
 * @param {object} template - テンプレートオブジェクト
 * @param {object} opts - { overwrite: false }
 * @returns {{ applied: string[], skipped: string[] }} 適用結果
 */
function applyDbTemplate(dbPath, template, opts) {
  const overwrite = opts?.overwrite || false;
  const productionSchemaLocked = _dbTemplateProductionSchemaLocked(dbPath);
  const originalConfig = getDbViewConfig(dbPath);
  const backendTypes = typeof getPropertyTypes === 'function' ? _cloneTemplateData(getPropertyTypes(dbPath) || {}) : {};
  if (Object.keys(backendTypes).length > 0) {
    originalConfig.propertyTypes = _cloneTemplateData(backendTypes);
    saveDbViewConfig(dbPath, originalConfig, { skipHistory: true });
  }
  const c = _cloneTemplateData(originalConfig) || {};
  if (Object.keys(backendTypes).length > 0) c.propertyTypes = backendTypes;
  const applied = [];
  const skipped = [];
  const historyKeys = _dbTemplateStorageKeys(dbPath, !!(template.entityTemplates && template.entityTemplates.length > 0));
  const historyBefore = opts?.skipHistory ? null : _captureDbTemplateStorage(historyKeys);

  // 1. プロパティ型を設定
  if (!c.propertyTypes) c.propertyTypes = {};
  template.properties.forEach(p => {
    const reservedLegacy = productionSchemaLocked
      && window.MeldexProductionSchemaMigration?.reservedLegacyPropertyForPath?.(dbPath, p.name);
    if (reservedLegacy || (c.propertyTypes[p.name] && (productionSchemaLocked || !overwrite))) {
      skipped.push(p.name);
    } else {
      c.propertyTypes[p.name] = _resolveDbTemplatePropertyTypeForPath(p.type, dbPath, template.name);
      applied.push(p.name);
    }
  });

  // 2. 列順序（既存の末尾に追加）
  if (!c.colOrder) c.colOrder = [];
  if (template.colOrder) {
    template.colOrder.forEach(col => {
      if (!c.colOrder.includes(col)) c.colOrder.push(col);
    });
  }

  // 3. 列幅（未設定のみ）
  if (!c.colWidths) c.colWidths = {};
  if (template.colWidths) {
    Object.entries(template.colWidths).forEach(([k, v]) => {
      if (!c.colWidths[k] || overwrite) c.colWidths[k] = v;
    });
  }

  // 4. 旧ビュータイプ候補（旧形式テンプレート互換）
  if (template.enabledModes) {
    if (!c.enabledModes) {
      c.enabledModes = [...template.enabledModes];
    } else {
      template.enabledModes.forEach(m => {
        if (!c.enabledModes.includes(m)) c.enabledModes.push(m);
      });
    }
  }

  // 5. フッター集計タイプ
  if (!c.countTypes) c.countTypes = {};
  if (template.countTypes) {
    Object.entries(template.countTypes).forEach(([k, v]) => {
      if (!c.countTypes[k] || overwrite) c.countTypes[k] = v;
    });
  }
  const usedSavedViewsPath = typeof _applyDbTemplateSavedViews === 'function'
    && _applyDbTemplateSavedViews(c, template, overwrite);
  if (!usedSavedViewsPath) {
    _applyDbTemplateViewFields(c, template, overwrite);
  }
  const viewsResult = c._dbTemplateViewsResult || null;
  delete c._dbTemplateViewsResult;

  // 6. エントリテンプレート（別のlocalStorageキー）
  let existingEntityTemplates = null;
  let nextEntityTemplates = null;
  let backendSavePromise = Promise.resolve(false);
  if (template.entityTemplates && template.entityTemplates.length > 0) {
    existingEntityTemplates = getEntityTemplates(dbPath);
    nextEntityTemplates = _cloneTemplateData(existingEntityTemplates) || [];
    const existingNames = nextEntityTemplates.map(t => t.name);
    template.entityTemplates.forEach(et => {
      if (!existingNames.includes(et.name)) {
        nextEntityTemplates.push(et);
      }
    });
  }

  try {
    if (nextEntityTemplates) saveEntityTemplates(dbPath, nextEntityTemplates);
    saveDbViewConfig(dbPath, c);
    backendSavePromise = _saveDbTemplatePropertyTypesToBackend(dbPath, c.propertyTypes)
      .then(result => {
        if (!opts?.skipHistory) {
          _pushDbTemplateStorageHistory(
            'シートテンプレート: 適用',
            historyBefore,
            historyKeys,
            template.name || '',
            dbPath
          );
        }
        return result;
      })
      .catch(e => {
        try { saveDbViewConfig(dbPath, originalConfig, { skipHistory: true }); } catch {}
        if (nextEntityTemplates) {
          try { saveEntityTemplates(dbPath, existingEntityTemplates || []); } catch {}
        }
        _setDbTemplateMetadataPropertyTypes(dbPath, originalConfig.propertyTypes || {});
        throw e;
      });
  } catch (e) {
    if (nextEntityTemplates) {
      try { saveEntityTemplates(dbPath, existingEntityTemplates || []); } catch {}
    }
    throw e;
  }

  return { applied, skipped, viewsResult, backendSavePromise };
}

/**
 * 現在のDB設定からテンプレートオブジェクトを生成する
 */
function exportDbAsTemplate(dbPath) {
  const c = getDbViewConfig(dbPath);
  const pt = typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath) : (c.propertyTypes || {});
  const properties = Object.entries(pt).map(([name, type]) => ({ name, type }));
  const currentColOrder = typeof getColOrder === 'function' ? getColOrder(dbPath) : null;
  const currentColWidths = typeof getColWidths === 'function' ? getColWidths(dbPath) : null;
  const currentCountTypes = typeof getCountTypes === 'function' ? getCountTypes(dbPath) : null;
  const hasSavedViews = Array.isArray(c.savedViews) && c.savedViews.length > 0;
  const savedViewModes = hasSavedViews
    ? [...new Set(c.savedViews.map(view => _dbTemplateNormalizeViewMode(view?.viewMode || 'pivot')))]
    : null;

  return {
    id: 'custom-' + Date.now(),
    name: '',
    tier: 0,
    description: '',
    icon: 'file',
    properties,
    colOrder: hasSavedViews ? (Array.isArray(currentColOrder) ? currentColOrder : []) : (c.colOrder || []),
    colWidths: hasSavedViews ? (currentColWidths || {}) : (currentColWidths && Object.keys(currentColWidths).length ? currentColWidths : (c.colWidths || {})),
    enabledModes: savedViewModes && savedViewModes.length ? savedViewModes : (c.enabledModes || ['pivot']),
    entityTemplates: getEntityTemplates(dbPath),
    countTypes: hasSavedViews ? (currentCountTypes || {}) : (currentCountTypes && Object.keys(currentCountTypes).length ? currentCountTypes : (c.countTypes || {})),
    savedViews: typeof exportDbTemplateSavedViews === 'function' ? exportDbTemplateSavedViews(c) : null,
  };
}

function _dbTemplateProductionSchemaLocked(dbPath) {
  return typeof isProductionManagementSheetPath === 'function'
    && isProductionManagementSheetPath(dbPath);
}

function _dbTemplateCurrentPropertyTypes(dbPath) {
  const metadata = typeof _ptMetadataForDbPath === 'function' ? _ptMetadataForDbPath(dbPath) : null;
  const backendTypes = metadata?.property_types;
  if (backendTypes && typeof backendTypes === 'object' && Object.keys(backendTypes).length) {
    return _cloneTemplateData(backendTypes);
  }
  return typeof getPropertyTypes === 'function'
    ? _cloneTemplateData(getPropertyTypes(dbPath) || {})
    : {};
}

function _dbTemplateAssertProductionPropertyTypesUnchanged(dbPath, nextTypes) {
  if (!_dbTemplateProductionSchemaLocked(dbPath)) return;
  const currentTypes = _dbTemplateCurrentPropertyTypes(dbPath);
  const candidateTypes = nextTypes && typeof nextTypes === 'object' ? nextTypes : {};
  for (const [name, typeConfig] of Object.entries(currentTypes)) {
    if (!Object.prototype.hasOwnProperty.call(candidateTypes, name)
      || JSON.stringify(candidateTypes[name] || {}) !== JSON.stringify(typeConfig || {})) {
      throw new Error(`制作管理に必要な列「${name}」の種類・設定はテンプレートから変更できません`);
    }
  }
  for (const name of Object.keys(candidateTypes)) {
    if (window.MeldexProductionSchemaMigration?.reservedLegacyPropertyForPath?.(dbPath, name)) {
      throw new Error(`制作管理では旧名称列「${name}」を追加できません。エントリ名を使用してください`);
    }
  }
}
/**
 * テンプレートを適用する
 */
async function _doApplyTemplate(dbPath, tmpl, overlayEl, triggerEl = null) {
  let result;
  try {
    result = applyDbTemplate(dbPath, tmpl);
    if (result.backendSavePromise) await result.backendSavePromise;
  } catch (e) {
    showStatus('テンプレート適用に失敗: ' + (e.message || e), true);
    return;
  }
  _closeDbTemplateOverlay(overlayEl, triggerEl || overlayEl?._dbTemplateTrigger || null);

  let msg = 'テンプレート「' + tmpl.name + '」を適用しました';
  if (result.skipped.length > 0) {
    msg += '（' + result.skipped.length + '件スキップ: 既存の列）';
  }
  if (result.viewsResult && (result.viewsResult.added || result.viewsResult.skipped)) {
    msg += `（ビュー${result.viewsResult.added || 0}件追加`;
    if (result.viewsResult.skipped) msg += `/${result.viewsResult.skipped}件スキップ`;
    msg += '）';
  }
  showStatus(msg);

  // DB再読み込み
  if (typeof selectDatabase === 'function') selectDatabase(dbPath);
}

/* --- テンプレートプレビューモーダル（モバイル: 重ねモーダルとして継続使用） --- */

function showTemplatePreviewModal(tmpl, dbPath, parentOverlay, triggerEl = null) {
  const trigger = _dbTemplateTrigger(triggerEl);
  const seq = Date.now().toString(36) + '-' + Math.floor(Math.random() * 1000).toString(36);
  const titleId = `db-template-preview-title-${seq}`;
  const descId = `db-template-preview-desc-${seq}`;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.dbTemplateModal = 'preview';
  overlay.style.zIndex = '130';

  const modal = document.createElement('div');
  modal.className = 'modal db-template-modal db-template-preview-modal';
  modal.dataset.e2eId = 'db-template-preview-dialog';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', titleId);
  modal.setAttribute('aria-describedby', descId);
  modal.tabIndex = -1;
  _setDbTemplateModalSize(modal, { maxWidth: 500, maxHeight: 680, heightRatio: 0.74, minHeight: 360 });

  // タイトル
  const h3 = document.createElement('h3');
  h3.id = titleId;
  h3.textContent = tmpl.name;
  modal.appendChild(h3);

  const desc = document.createElement('p');
  desc.id = descId;
  desc.textContent = tmpl.description;
  desc.className = 'db-template-description';
  modal.appendChild(desc);

  // ビュー一覧（savedViews があれば詳細表示、無ければ旧形式の推奨ビュー表示）
  modal.appendChild(_buildDbTemplateViewsSummarySection(tmpl));

  // プロパティ一覧テーブル（デスクトップのプレビューペインと共通の構築関数を使用）
  modal.appendChild(_buildDbTemplatePropTable(tmpl));

  // ボタン
  const btnRow = document.createElement('div');
  btnRow.className = 'db-template-footer';
  const cancelBtn = document.createElement('button');
  _setupDbTemplateButton(cancelBtn, 'gb-btn gb-btn-sm', 'db-template-preview-back');
  cancelBtn.textContent = '戻る';
  cancelBtn.addEventListener('click', () => _closeDbTemplateOverlay(overlay, trigger));
  btnRow.appendChild(cancelBtn);
  const applyBtn = document.createElement('button');
  _setupDbTemplateButton(applyBtn, 'gb-btn gb-btn-sm gb-btn-primary primary', 'db-template-preview-apply');
  applyBtn.textContent = '適用';
  applyBtn.addEventListener('click', () => {
    _closeDbTemplateOverlay(overlay, trigger, { restoreFocus: false });
    _doApplyTemplate(dbPath, tmpl, parentOverlay, parentOverlay?._dbTemplateTrigger || trigger);
  });
  btnRow.appendChild(applyBtn);
  modal.appendChild(btnRow);

  overlay.appendChild(modal);
  _showDbTemplateOverlay(overlay, modal, trigger, modal);
}
/* ==============================
   gb-db-template-views.js: シートテンプレートのビュー包含
   savedViews（フィルタ/ソート/型別設定を含む）のサニタイズ・エクスポート・マージ適用を担当する。
   gb-db-templates.part01.js の applyDbTemplate / exportDbAsTemplate から
   typeof ガード付きで呼び出される（本ファイル未ロード時は旧来の enabledModes のみのパスへ
   自動フォールバックする＝ロールバック・部分連結ハーネスの両方に対して安全）。
   ============================== */

/* --- typeSpecific のサブホワイトリスト --- */

function _sanitizeDbTemplateTimelineTypeSpecific(timeline) {
  const src = (timeline && typeof timeline === 'object') ? timeline : {};
  const out = {};
  ['timeProp', 'endProp', 'rowProp', 'scale', 'direction', 'calendarSystemId'].forEach((key) => {
    if (src[key]) out[key] = src[key];
  });
  const stepMinutes = Number(src.timeStepMinutes);
  if (Number.isFinite(stepMinutes) && Math.round(stepMinutes) !== 1) out.timeStepMinutes = Math.round(stepMinutes);
  if (Array.isArray(src.calendarSystems) && src.calendarSystems.length) {
    out.calendarSystems = _cloneTemplateData(src.calendarSystems);
  }
  if (Array.isArray(src.cardProps) && src.cardProps.length) {
    out.cardProps = _cloneTemplateData(src.cardProps);
  }
  const thumbCount = Number(src.cardImageThumbCount);
  if (Number.isFinite(thumbCount) && Math.round(thumbCount) !== 3) out.cardImageThumbCount = Math.round(thumbCount);
  const lineCount = Number(src.cardPropLineCount);
  if (Number.isFinite(lineCount) && Math.round(lineCount) !== 1) out.cardPropLineCount = Math.round(lineCount);
  if (src.colWidths && typeof src.colWidths === 'object' && !Array.isArray(src.colWidths) && Object.keys(src.colWidths).length) {
    out.colWidths = _cloneTemplateData(src.colWidths);
  }
  return out;
}

function _sanitizeDbTemplateTypeSpecific(typeSpecific) {
  const src = (typeSpecific && typeof typeSpecific === 'object') ? typeSpecific : {};
  const out = {};
  if (src.pivot && typeof src.pivot === 'object' && src.pivot.groupBy) {
    out.pivot = { groupBy: src.pivot.groupBy };
  }
  if (src.tree && typeof src.tree === 'object' && Object.keys(src.tree).length) {
    out.tree = _cloneTemplateData(src.tree);
  }
  if (src.kanban && typeof src.kanban === 'object' && src.kanban.groupBy && src.kanban.groupBy !== '_status') {
    out.kanban = { groupBy: src.kanban.groupBy };
  }
  if (src.calendar?.mapping && typeof src.calendar.mapping === 'object' && Object.keys(src.calendar.mapping).length) {
    out.calendar = { mapping: _cloneTemplateData(src.calendar.mapping) };
  }
  if (src.chart && typeof src.chart === 'object' && Object.keys(src.chart).length) {
    out.chart = _cloneTemplateData(src.chart);
  }
  if (src.graph && typeof src.graph === 'object' && Object.keys(src.graph).length) {
    out.graph = _cloneTemplateData(src.graph);
  }
  if (src.form?.formConfig != null) {
    out.form = { formConfig: _cloneTemplateData(src.form.formConfig) };
  }
  if (src.timeline && typeof src.timeline === 'object') {
    const timeline = _sanitizeDbTemplateTimelineTypeSpecific(src.timeline);
    if (Object.keys(timeline).length) out.timeline = timeline;
  }
  return out;
}

/* --- savedView 単体のサニタイズ --- */

/**
 * 保存済みビュー1件をテンプレート保存用にホワイトリスト方式でサニタイズする。
 * 除外: manualOrder（実データ依存のエントリ順）、filter（実行時のクイックフィルタ状態）、
 *       timeline.rowHeights / displayStart / displayEnd（実データ依存の表示状態）
 */
function _sanitizeDbTemplateSavedView(view) {
  if (!view || typeof view !== 'object') return null;
  const out = {};
  out.name = String(view.name || '').trim() || 'ビュー';
  out.viewMode = _dbTemplateNormalizeViewMode(view.viewMode);
  if (Array.isArray(view.hiddenCols) && view.hiddenCols.length) out.hiddenCols = _cloneTemplateData(view.hiddenCols);
  if (Array.isArray(view.pinnedCols) && view.pinnedCols.length) out.pinnedCols = _cloneTemplateData(view.pinnedCols);
  if (Array.isArray(view.colOrder) && view.colOrder.length) out.colOrder = _cloneTemplateData(view.colOrder);
  if (view.colWidths && typeof view.colWidths === 'object' && !Array.isArray(view.colWidths) && Object.keys(view.colWidths).length) {
    out.colWidths = _cloneTemplateData(view.colWidths);
  }
  if (view.countTypes && typeof view.countTypes === 'object' && !Array.isArray(view.countTypes) && Object.keys(view.countTypes).length) {
    out.countTypes = _cloneTemplateData(view.countTypes);
  }
  if (Array.isArray(view.advancedFilters) && view.advancedFilters.length) out.advancedFilters = _cloneTemplateData(view.advancedFilters);
  if (view.columnValueFilters && typeof view.columnValueFilters === 'object' && Object.keys(view.columnValueFilters).length) {
    out.columnValueFilters = _cloneTemplateData(view.columnValueFilters);
  }
  if (view.sortConfig != null) out.sortConfig = _cloneTemplateData(view.sortConfig);
  if (view.conditionalFormat) out.conditionalFormat = true;
  if (view.conditionalColors && typeof view.conditionalColors === 'object' && Object.keys(view.conditionalColors).length) {
    out.conditionalColors = _cloneTemplateData(view.conditionalColors);
  }
  if (view.showFooter) out.showFooter = true;
  if (view.entityColumnPinned === false) out.entityColumnPinned = false;
  if (view.thumbnailSize && view.thumbnailSize !== 'small') out.thumbnailSize = view.thumbnailSize;
  const typeSpecific = _sanitizeDbTemplateTypeSpecific(view.typeSpecific);
  if (Object.keys(typeSpecific).length) out.typeSpecific = typeSpecific;
  return out;
}

/**
 * 現在のビュー設定から、テンプレートへ保存する savedViews 配列を生成する。
 * ビューが無い（または全て空相当）場合は null を返す。
 */
function exportDbTemplateSavedViews(cfg) {
  if (!cfg || !Array.isArray(cfg.savedViews) || !cfg.savedViews.length) return null;
  const sanitized = cfg.savedViews
    .map((view) => _sanitizeDbTemplateSavedView(view))
    .filter(Boolean);
  return sanitized.length ? sanitized : null;
}

/* --- savedViews のマージ適用 --- */

function _dbTemplateSavedViewKey(view) {
  return String(view?.name || '') + ' ' + String(view?.viewMode || 'pivot');
}

function _dbTemplateAppendLegacyViewFields(view, template, overwrite) {
  if (!view || typeof view !== 'object') return;
  if (!Array.isArray(view.colOrder)) view.colOrder = [];
  if (template.colOrder) {
    template.colOrder.forEach((col) => {
      if (!view.colOrder.includes(col)) view.colOrder.push(col);
    });
  }
  if (!view.colWidths || typeof view.colWidths !== 'object' || Array.isArray(view.colWidths)) view.colWidths = {};
  if (template.colWidths) {
    Object.entries(template.colWidths).forEach(([k, v]) => {
      if (!view.colWidths[k] || overwrite) view.colWidths[k] = v;
    });
  }
  if (!view.countTypes || typeof view.countTypes !== 'object' || Array.isArray(view.countTypes)) view.countTypes = {};
  if (template.countTypes) {
    Object.entries(template.countTypes).forEach(([k, v]) => {
      if (!view.countTypes[k] || overwrite) view.countTypes[k] = v;
    });
  }
}

/**
 * テンプレートの savedViews を現在の設定へマージ適用する（加算方式）。
 * - name+viewMode が一致する既存ビューはスキップ（overwrite 時はフィールドを上書き）
 * - name のみ一致する場合は「名前 2」のように連番で一意化して追加
 * - colOrder/colWidths/countTypes の旧形式フィールドの追補は、
 *   適用前から存在していたビューにのみ行う（新規追加ビューはテンプレート側の値をそのまま使う）
 * @returns {boolean} savedViews パスを使ったか（false の場合は呼び出し元が旧パスへフォールバックする）
 */
function _applyDbTemplateSavedViews(cfg, template, overwrite) {
  if (!template || !Array.isArray(template.savedViews)) return false;
  if (!Array.isArray(cfg.savedViews)) cfg.savedViews = [];
  const existingViews = cfg.savedViews.slice();
  const existingByKey = new Map();
  const existingNames = new Set();
  existingViews.forEach((view) => {
    if (!view) return;
    existingByKey.set(_dbTemplateSavedViewKey(view), view);
    existingNames.add(String(view.name || ''));
  });

  let added = 0;
  let skipped = 0;
  template.savedViews.forEach((rawView) => {
    const sanitized = _sanitizeDbTemplateSavedView(rawView);
    if (!sanitized) return;
    const key = _dbTemplateSavedViewKey(sanitized);
    const existing = existingByKey.get(key);
    if (existing) {
      skipped++;
      if (overwrite) {
        const name = existing.name;
        const viewMode = existing.viewMode;
        Object.assign(existing, _cloneTemplateData(sanitized));
        existing.name = name;
        existing.viewMode = viewMode;
        const idx = cfg.savedViews.indexOf(existing);
        cfg.savedViews[idx] = _normalizeDbTemplateView(existing, cfg, idx);
      }
      return;
    }
    let uniqueName = sanitized.name;
    let suffix = 2;
    while (existingNames.has(uniqueName)) {
      uniqueName = sanitized.name + ' ' + suffix;
      suffix++;
    }
    sanitized.name = uniqueName;
    existingNames.add(uniqueName);
    const normalized = _normalizeDbTemplateView(sanitized, cfg, cfg.savedViews.length);
    cfg.savedViews.push(normalized);
    existingByKey.set(_dbTemplateSavedViewKey(normalized), normalized);
    added++;
  });

  // 旧形式フィールド（テンプレート直下の colOrder/colWidths/countTypes）の追補は
  // 「適用前から存在していたビュー」だけに行う。新規追加ビューはテンプレートの
  // savedViews 側にすでに完全な情報を持つため、二重適用しない。
  existingViews.forEach((view) => _dbTemplateAppendLegacyViewFields(view, template, overwrite));

  if (!Number.isInteger(cfg.currentViewIdx) || cfg.currentViewIdx < 0 || cfg.currentViewIdx >= cfg.savedViews.length) {
    cfg.currentViewIdx = 0;
  }
  cfg._dbTemplateViewsResult = { added, skipped };
  return true;
}
/* ==============================
   gb-db-template-gallery-ui.js: シートテンプレートギャラリー（刷新UI）
   検索付きヘッダー + Tierチップ行 + カードグリッド/プレビューペインの2ペイン構成。
   モーダル共通プラミング（開閉・フォーカス復帰・サイズ調整）と、
   プロパティ表・ビュー一覧のプレビュー描画を担当する。
   モバイルでは重ねプレビューモーダル（gb-db-templates.part02.js の showTemplatePreviewModal）を
   引き続き使用する。
   ============================== */

/* --- トリガー・フォーカス復帰ヘルパー --- */

function _dbTemplateTrigger(triggerEl = null) {
  if (triggerEl && typeof triggerEl.focus === 'function') return triggerEl;
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  return active && typeof active.focus === 'function' ? active : null;
}

function _focusDbTemplateTrigger(triggerEl) {
  if (!triggerEl || typeof triggerEl.focus !== 'function' || !triggerEl.isConnected) return;
  try {
    triggerEl.focus({ preventScroll: true });
  } catch {
    try { triggerEl.focus(); } catch {}
  }
}

/* --- モーダル共通プラミング --- */

function _cleanupDbTemplateOverlay(overlay) {
  if (!overlay || typeof overlay._dbTemplateCleanup !== 'function') return;
  overlay._dbTemplateCleanup();
}

function _isTopDbTemplateOverlay(overlay) {
  if (!overlay?.isConnected) return false;
  const overlays = Array.from(document.querySelectorAll('.modal-overlay[data-db-template-modal]'))
    .filter(el => el.isConnected);
  return overlays[overlays.length - 1] === overlay;
}

function _closeDbTemplateOverlay(overlay, triggerEl = null, options = {}) {
  if (!overlay || !overlay.isConnected) return;
  _cleanupDbTemplateOverlay(overlay);
  overlay.remove();
  if (options.restoreFocus === false) return;
  const trigger = triggerEl || overlay._dbTemplateTrigger || null;
  _focusDbTemplateTrigger(trigger);
  setTimeout(() => _focusDbTemplateTrigger(trigger), 0);
  setTimeout(() => _focusDbTemplateTrigger(trigger), 60);
}

function _bindDbTemplateDismiss(overlay, triggerEl = null) {
  if (!overlay) return;
  const onPointerDown = (e) => {
    if (e.target !== overlay) return;
    _closeDbTemplateOverlay(overlay, triggerEl);
  };
  const onKeyDown = (e) => {
    if (e.key !== 'Escape' || !overlay.isConnected) return;
    // アイコンピッカー表示中はEscapeをピッカー側に譲り、テンプレートモーダルを誤って閉じない
    if (document.querySelector('.gb-icon-picker')) return;
    if (!_isTopDbTemplateOverlay(overlay)) return;
    e.preventDefault();
    e.stopPropagation();
    _closeDbTemplateOverlay(overlay, triggerEl);
  };
  overlay.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('keydown', onKeyDown, true);
  overlay._dbTemplateCleanup = () => {
    overlay.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('keydown', onKeyDown, true);
    overlay._dbTemplateCleanup = null;
  };
}

function _dbTemplateViewportSize() {
  const zoom = typeof _getZoom === 'function'
    ? Math.max(0.1, _getZoom() || 1)
    : Math.max(0.1, parseFloat(document.documentElement?.style?.zoom || '') || 1);
  const width = (window.visualViewport?.width || window.innerWidth || document.documentElement?.clientWidth || 800) / zoom;
  const height = (window.visualViewport?.height || window.innerHeight || document.documentElement?.clientHeight || 600) / zoom;
  return { width, height };
}

function _isDbTemplateMobileSheetMode() {
  return document.body?.dataset?.cloudMobile === '1'
    || document.body?.dataset?.mobileUi === '1'
    || document.body?.dataset?.mobileUiLocal === '1'
    || window.MeldexCloudMobileState?.mobile === true;
}

function _setDbTemplateModalSize(modal, opts = {}) {
  if (!modal || _isDbTemplateMobileSheetMode()) return;
  const viewport = _dbTemplateViewportSize();
  const usableWidth = Math.max(260, viewport.width - 32);
  const usableHeight = Math.max(220, viewport.height - 24);
  const maxWidth = Math.max(260, opts.maxWidth || 500);
  modal.style.width = Math.round(Math.min(maxWidth, usableWidth)) + 'px';
  if (!opts.heightRatio && !opts.maxHeight) return;
  let targetHeight = opts.heightRatio ? viewport.height * opts.heightRatio : usableHeight;
  if (opts.maxHeight) targetHeight = Math.min(targetHeight, opts.maxHeight);
  targetHeight = Math.min(targetHeight, usableHeight);
  if (opts.minHeight) targetHeight = Math.max(Math.min(opts.minHeight, usableHeight), targetHeight);
  modal.style.height = Math.round(targetHeight) + 'px';
}

function _showDbTemplateOverlay(overlay, modal, triggerEl = null, focusTarget = null) {
  if (!overlay || !modal) return;
  overlay._dbTemplateTrigger = triggerEl || null;
  _bindDbTemplateDismiss(overlay, triggerEl);
  document.body.appendChild(overlay);
  if (typeof GBModalShell !== 'undefined' && GBModalShell?.enhanceAll) GBModalShell.enhanceAll();
  requestAnimationFrame(() => {
    try {
      (focusTarget || modal)?.focus?.({ preventScroll: true });
    } catch {
      try { (focusTarget || modal)?.focus?.(); } catch {}
    }
  });
}

function _setupDbTemplateButton(button, className, e2eId, ariaLabel = '') {
  if (!button) return button;
  button.type = 'button';
  if (className) button.className = className;
  if (e2eId) button.dataset.e2eId = e2eId;
  if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
  return button;
}

async function _deleteDbCustomTemplateWithConfirm(tmpl, onDeleted) {
  if (!await _confirmDbTemplate('カスタムテンプレート「' + tmpl.name + '」を削除しますか？')) return false;
  const customs = getCustomTemplates().filter(c => c.id !== tmpl.id);
  if (!saveCustomTemplates(customs, { label: 'シートテンプレート: カスタムテンプレート削除', detail: tmpl.name })) return false;
  if (typeof onDeleted === 'function') onDeleted();
  return true;
}

/* --- アイコン表示 --- */

/**
 * テンプレートアイコン（生Lucide名 or spec文字列）を描画する。
 * GBIconAssets 未ロード環境では lucide() へフォールバックする。
 */
function _dbTemplateIconHtml(icon, size) {
  const spec = icon || 'file';
  if (typeof GBIconAssets !== 'undefined' && GBIconAssets?.render) {
    return GBIconAssets.render(spec, size);
  }
  return typeof lucide === 'function' ? lucide(spec, size) : '';
}

/* --- プロパティ表（デスクトップのプレビューペイン・モバイルの重ねモーダルで共用） --- */

function _typeLabel(type) {
  const labels = {
    text: 'テキスト', number: '数値', select: 'セレクト', 'multi-select': 'マルチセレクト',
    'common-tags': '共通タグ', checkbox: 'チェックボックス', date: '日時', url: 'URL', link: 'リンク',
    relation: 'リレーション', 'multi-relation': 'マルチリレーション', formula: '数式', furigana: 'ふりがな',
  };
  return labels[type] || type;
}

function _buildDbTemplatePropTable(tmpl) {
  const table = document.createElement('table');
  table.className = 'db-template-prop-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">列</th>'
    + '<th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">型</th>'
    + '<th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">オプション</th></tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  (tmpl.properties || []).forEach(p => {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.textContent = p.name;
    tdName.className = 'db-template-prop-name';
    tr.appendChild(tdName);

    const tdType = document.createElement('td');
    tdType.textContent = _typeLabel(p.type.type);
    tdType.className = 'db-template-prop-type';
    tr.appendChild(tdType);

    const tdOpts = document.createElement('td');
    tdOpts.className = 'db-template-prop-options';
    if (p.type.options && p.type.options.length > 0) {
      tdOpts.textContent = p.type.options.join(', ');
    } else if (p.type.type === 'relation' || p.type.type === 'multi-relation') {
      const target = p.type.relationTemplate || p.type.relationDb || (p.type.relationDb === '' ? '自シート' : '');
      const reverse = p.type.bidirectionalProp ? ' / 逆: ' + p.type.bidirectionalProp : '';
      tdOpts.textContent = target ? target + reverse : '(リレーション先を要設定)';
    }
    tr.appendChild(tdOpts);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

/* --- ビュー一覧（プレビューペイン・重ねモーダルで共用） --- */

const DB_TEMPLATE_VIEW_MODE_LABELS = { pivot: 'テーブル', tree: 'ツリー', gallery: 'ギャラリー', kanban: 'カンバン', timeline: 'タイムライン', chart: 'チャート' };

function _dbTemplateViewIcon(mode) {
  const found = (typeof VIEW_TYPES !== 'undefined' ? VIEW_TYPES : []).find(vt => vt.mode === mode);
  return found?.icon || 'table';
}

function _dbTemplateViewSummaryParts(view) {
  const parts = [];
  const filterCount = Array.isArray(view?.advancedFilters) ? view.advancedFilters.length : 0;
  if (filterCount > 0) parts.push(`フィルタ${filterCount}件`);
  if (view?.sortConfig) parts.push('並べ替えあり');
  const groupBy = view?.typeSpecific?.pivot?.groupBy || view?.typeSpecific?.kanban?.groupBy;
  if (groupBy) parts.push('グループ: ' + groupBy);
  return parts;
}

/**
 * テンプレートのビュー一覧セクションを構築する。
 * savedViews があれば各ビューの詳細（モード・名前・フィルタ/ソート/グループ概要）を、
 * 無ければ旧形式の「推奨ビュー: …」表示にフォールバックする。
 */
function _buildDbTemplateViewsSummarySection(tmpl) {
  const wrap = document.createElement('div');
  wrap.className = 'db-template-views-summary';
  if (Array.isArray(tmpl.savedViews) && tmpl.savedViews.length) {
    const title = document.createElement('div');
    title.className = 'db-template-views-summary-title';
    title.textContent = 'ビュー';
    wrap.appendChild(title);
    const list = document.createElement('ul');
    list.className = 'db-template-views-summary-list';
    tmpl.savedViews.forEach(view => {
      const li = document.createElement('li');
      li.className = 'db-template-views-summary-item';
      const iconSpan = document.createElement('span');
      iconSpan.className = 'db-template-views-summary-icon';
      iconSpan.innerHTML = _dbTemplateIconHtml(_dbTemplateViewIcon(view?.viewMode), 14);
      li.appendChild(iconSpan);
      const nameSpan = document.createElement('span');
      nameSpan.className = 'db-template-views-summary-name';
      nameSpan.textContent = view?.name || _dbTemplateViewLabel(view?.viewMode);
      li.appendChild(nameSpan);
      const parts = _dbTemplateViewSummaryParts(view);
      if (parts.length) {
        const detail = document.createElement('span');
        detail.className = 'db-template-views-summary-detail';
        detail.textContent = parts.join(' / ');
        li.appendChild(detail);
      }
      list.appendChild(li);
    });
    wrap.appendChild(list);
  } else if (Array.isArray(tmpl.enabledModes) && tmpl.enabledModes.length) {
    const modeDiv = document.createElement('div');
    modeDiv.className = 'db-template-mode-summary';
    modeDiv.textContent = '推奨ビュー: ' + tmpl.enabledModes.map(m => DB_TEMPLATE_VIEW_MODE_LABELS[m] || _dbTemplateViewLabel(m)).join(', ');
    wrap.appendChild(modeDiv);
  }
  return wrap;
}

/* --- テンプレートカード --- */

/**
 * テンプレートカードを構築する。
 * デスクトップ: クリック/Enter/Space でプレビューペインを更新（重ねモーダルは開かない）。
 * モバイル: クリック/Enter/Space で重ねプレビューモーダル（showTemplatePreviewModal）を開く。
 */
function _buildTemplateCard(tmpl, dbPath, ctx = {}) {
  const card = document.createElement('div');
  card.className = 'template-card' + (ctx.selected ? ' is-selected' : '');
  card.dataset.e2eId = 'db-template-card';
  card.dataset.templateId = tmpl.id;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', 'テンプレート「' + (tmpl.name || '') + '」を確認');
  if (!ctx.mobile) card.setAttribute('aria-pressed', ctx.selected ? 'true' : 'false');

  const titleRow = document.createElement('div');
  titleRow.className = 'template-card-title-row';
  const icon = document.createElement('span');
  icon.innerHTML = _dbTemplateIconHtml(tmpl.icon, 18);
  icon.className = 'template-card-icon';
  titleRow.appendChild(icon);
  const name = document.createElement('span');
  name.textContent = tmpl.name;
  name.className = 'template-card-name';
  titleRow.appendChild(name);
  if (tmpl.tier > 0) {
    const badge = document.createElement('span');
    badge.textContent = 'T' + tmpl.tier;
    badge.className = 'template-card-badge';
    titleRow.appendChild(badge);
  }
  card.appendChild(titleRow);

  const desc = document.createElement('div');
  desc.textContent = tmpl.description;
  desc.className = 'template-card-desc';
  card.appendChild(desc);

  const meta = document.createElement('div');
  meta.className = 'template-card-meta';
  const propCount = (tmpl.properties || []).length;
  const viewCount = Array.isArray(tmpl.savedViews) && tmpl.savedViews.length
    ? tmpl.savedViews.length
    : (Array.isArray(tmpl.enabledModes) ? tmpl.enabledModes.length : 0);
  meta.textContent = propCount + '列 · ' + viewCount + 'ビュー';
  card.appendChild(meta);

  const btnRow = document.createElement('div');
  btnRow.className = 'template-card-actions';
  const applyBtn = document.createElement('button');
  _setupDbTemplateButton(applyBtn, 'gb-btn gb-btn-sm gb-btn-primary primary', 'db-template-card-apply', 'テンプレート「' + (tmpl.name || '') + '」を適用');
  applyBtn.textContent = '適用';
  applyBtn.addEventListener('click', e => {
    e.stopPropagation();
    _doApplyTemplate(dbPath, tmpl, ctx.overlay, ctx.overlay?._dbTemplateTrigger || card);
  });
  btnRow.appendChild(applyBtn);

  if (tmpl.tier === 0) {
    const editBtn = document.createElement('button');
    _setupDbTemplateButton(editBtn, 'gb-btn gb-btn-sm', 'db-template-card-edit', 'カスタムテンプレート「' + (tmpl.name || '') + '」を編集');
    editBtn.textContent = '編集';
    editBtn.addEventListener('click', e => {
      e.stopPropagation();
      _closeDbTemplateOverlay(ctx.overlay, ctx.overlay?._dbTemplateTrigger || card, { restoreFocus: false });
      showEditTemplateModal(tmpl, dbPath, ctx.overlay?._dbTemplateTrigger || card);
    });
    btnRow.appendChild(editBtn);

    const delBtn = document.createElement('button');
    _setupDbTemplateButton(delBtn, 'gb-btn gb-btn-sm gb-btn-danger', 'db-template-card-delete', 'カスタムテンプレート「' + (tmpl.name || '') + '」を削除');
    delBtn.textContent = '削除';
    delBtn.addEventListener('click', async e => {
      e.stopPropagation();
      await _deleteDbCustomTemplateWithConfirm(tmpl, ctx.onChanged);
    });
    btnRow.appendChild(delBtn);
  }
  card.appendChild(btnRow);

  const activate = () => {
    if (ctx.mobile) {
      showTemplatePreviewModal(tmpl, dbPath, ctx.overlay, card);
    } else if (typeof ctx.onSelect === 'function') {
      ctx.onSelect();
    }
  };
  card.addEventListener('click', activate);
  card.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    activate();
  });

  return card;
}

/* --- デスクトップ用プレビューペイン --- */

function _renderDbTemplatePreviewPane(pane, tmpl, dbPath, ctx = {}) {
  if (!pane) return;
  pane.innerHTML = '';
  pane.dataset.templateId = tmpl.id;

  const header = document.createElement('div');
  header.className = 'db-template-preview-pane-header';
  const icon = document.createElement('span');
  icon.className = 'db-template-preview-pane-icon';
  icon.innerHTML = _dbTemplateIconHtml(tmpl.icon, 22);
  header.appendChild(icon);
  const name = document.createElement('span');
  name.className = 'db-template-preview-pane-name';
  name.textContent = tmpl.name;
  header.appendChild(name);
  pane.appendChild(header);

  if (tmpl.description) {
    const desc = document.createElement('p');
    desc.className = 'db-template-description';
    desc.textContent = tmpl.description;
    pane.appendChild(desc);
  }

  pane.appendChild(_buildDbTemplateViewsSummarySection(tmpl));

  const propScroll = document.createElement('div');
  propScroll.className = 'db-template-preview-pane-props';
  propScroll.appendChild(_buildDbTemplatePropTable(tmpl));
  pane.appendChild(propScroll);

  if (Array.isArray(tmpl.entityTemplates) && tmpl.entityTemplates.length) {
    const entityDiv = document.createElement('div');
    entityDiv.className = 'db-template-preview-pane-entities';
    entityDiv.textContent = 'エントリ雛形: ' + tmpl.entityTemplates.map(e => e.name).join(', ');
    pane.appendChild(entityDiv);
  }

  const actions = document.createElement('div');
  actions.className = 'db-template-preview-pane-actions';
  const applyBtn = document.createElement('button');
  _setupDbTemplateButton(applyBtn, 'gb-btn gb-btn-sm gb-btn-primary primary', 'db-template-preview-pane-apply', 'テンプレート「' + (tmpl.name || '') + '」を適用');
  applyBtn.textContent = '適用';
  applyBtn.addEventListener('click', () => {
    _doApplyTemplate(dbPath, tmpl, ctx.overlay, ctx.overlay?._dbTemplateTrigger || applyBtn);
  });
  actions.appendChild(applyBtn);

  if (tmpl.tier === 0) {
    const editBtn = document.createElement('button');
    _setupDbTemplateButton(editBtn, 'gb-btn gb-btn-sm', 'db-template-preview-pane-edit', 'カスタムテンプレート「' + (tmpl.name || '') + '」を編集');
    editBtn.textContent = '編集';
    editBtn.addEventListener('click', () => {
      _closeDbTemplateOverlay(ctx.overlay, ctx.overlay?._dbTemplateTrigger || editBtn, { restoreFocus: false });
      showEditTemplateModal(tmpl, dbPath, ctx.overlay?._dbTemplateTrigger || editBtn);
    });
    actions.appendChild(editBtn);

    const delBtn = document.createElement('button');
    _setupDbTemplateButton(delBtn, 'gb-btn gb-btn-sm gb-btn-danger', 'db-template-preview-pane-delete', 'カスタムテンプレート「' + (tmpl.name || '') + '」を削除');
    delBtn.textContent = '削除';
    delBtn.addEventListener('click', async () => {
      await _deleteDbCustomTemplateWithConfirm(tmpl, ctx.onDeleted);
    });
    actions.appendChild(delBtn);
  }
  pane.appendChild(actions);
}

/* --- テンプレートギャラリーモーダル本体 --- */

/**
 * テンプレートギャラリーモーダルを表示する。
 * ヘッダー（タイトル+検索+閉じる）→ Tierチップ行 → 本体（カードグリッド+プレビューペイン）→ フッター。
 * モバイルではプレビューペインを出さず、カード選択で重ねプレビューモーダルを開く。
 */
function showTemplateGalleryModal(dbPath, triggerEl = null) {
  const trigger = _dbTemplateTrigger(triggerEl);
  const seq = Date.now().toString(36) + '-' + Math.floor(Math.random() * 1000).toString(36);
  const titleId = `db-template-gallery-title-${seq}`;
  const descId = `db-template-gallery-desc-${seq}`;
  const isMobile = _isDbTemplateMobileSheetMode();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.dbTemplateModal = 'gallery';
  overlay.style.zIndex = '120';

  const modal = document.createElement('div');
  modal.className = 'modal db-template-modal db-template-gallery-modal';
  modal.dataset.e2eId = 'db-template-gallery-dialog';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', titleId);
  modal.setAttribute('aria-describedby', descId);
  modal.tabIndex = -1;
  _setDbTemplateModalSize(modal, { maxWidth: 1040, maxHeight: 820, heightRatio: 0.85, minHeight: 480 });

  // ヘッダー: タイトル + 検索 + 閉じる
  const header = document.createElement('div');
  header.className = 'db-template-modal-header';
  const h3 = document.createElement('h3');
  h3.id = titleId;
  h3.textContent = 'シートテンプレート';
  header.appendChild(h3);
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'gb-input db-template-search-input';
  searchInput.dataset.e2eId = 'db-template-search-input';
  searchInput.placeholder = 'テンプレートを検索';
  searchInput.setAttribute('aria-label', 'テンプレートを検索（名前・説明・列名）');
  header.appendChild(searchInput);
  const desc = document.createElement('div');
  desc.id = descId;
  desc.className = 'gb-visually-hidden';
  desc.textContent = 'シートに適用するテンプレートを選ぶダイアログ';
  header.appendChild(desc);
  const closeBtn = document.createElement('button');
  _setupDbTemplateButton(closeBtn, 'gb-btn tb-icon-btn db-template-close-btn', 'db-template-gallery-close', '閉じる');
  closeBtn.innerHTML = typeof lucide === 'function' ? lucide('x', 16) : '×';
  closeBtn.addEventListener('click', () => _closeDbTemplateOverlay(overlay, trigger));
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // Tierチップ行（旧: 左サイドバー）
  const tierRow = document.createElement('div');
  tierRow.className = 'db-template-tier-row';
  tierRow.setAttribute('role', 'group');
  tierRow.setAttribute('aria-label', 'テンプレート種別');
  let currentTier = 'all';
  const tierFilters = [
    { key: 'all', label: 'すべて' },
    { key: '1', label: '基本' },
    { key: '2', label: '標準' },
    { key: '3', label: 'ジャンル別' },
    { key: 'custom', label: 'カスタム' },
  ];
  tierFilters.forEach(tf => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = tf.label;
    btn.className = 'template-tier-btn' + (tf.key === 'all' ? ' active' : '');
    btn.dataset.tier = tf.key;
    btn.dataset.e2eId = `db-template-tier-${tf.key}`;
    btn.setAttribute('aria-pressed', tf.key === 'all' ? 'true' : 'false');
    btn.addEventListener('click', () => {
      currentTier = tf.key;
      tierRow.querySelectorAll('.template-tier-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      renderTemplateCards();
    });
    tierRow.appendChild(btn);
  });
  modal.appendChild(tierRow);

  // 本体: カードグリッド + プレビューペイン
  const body = document.createElement('div');
  body.className = 'db-template-body';
  const cardCol = document.createElement('div');
  cardCol.className = 'db-template-card-col';
  const grid = document.createElement('div');
  grid.className = 'template-grid';
  grid.dataset.e2eId = 'db-template-grid';
  cardCol.appendChild(grid);
  body.appendChild(cardCol);

  let previewPane = null;
  if (!isMobile) {
    previewPane = document.createElement('div');
    previewPane.className = 'db-template-preview-pane';
    previewPane.dataset.e2eId = 'db-template-preview-pane';
    body.appendChild(previewPane);
  }
  modal.appendChild(body);

  // フッター: カスタムテンプレート作成
  const footer = document.createElement('div');
  footer.className = 'db-template-footer';
  const createBtn = document.createElement('button');
  _setupDbTemplateButton(createBtn, 'gb-btn gb-btn-sm', 'db-template-create-open');
  createBtn.textContent = '+ 現在のシートからテンプレート作成';
  createBtn.addEventListener('click', () => {
    _closeDbTemplateOverlay(overlay, trigger, { restoreFocus: false });
    showCreateTemplateModal(dbPath, trigger);
  });
  footer.appendChild(createBtn);
  const cancelBtn = document.createElement('button');
  _setupDbTemplateButton(cancelBtn, 'gb-btn gb-btn-sm', 'db-template-gallery-cancel');
  cancelBtn.textContent = '閉じる';
  cancelBtn.addEventListener('click', () => _closeDbTemplateOverlay(overlay, trigger));
  footer.appendChild(cancelBtn);
  modal.appendChild(footer);

  overlay.appendChild(modal);
  _showDbTemplateOverlay(overlay, modal, trigger, modal);

  let searchQuery = '';
  let selectedTemplateId = '';

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim();
    renderTemplateCards();
  });

  function matchesSearch(tmpl, query) {
    if (!query) return true;
    const q = query.toLowerCase();
    if ((tmpl.name || '').toLowerCase().includes(q)) return true;
    if ((tmpl.description || '').toLowerCase().includes(q)) return true;
    return (tmpl.properties || []).some(p => (p.name || '').toLowerCase().includes(q));
  }

  function selectTemplate(tmpl) {
    selectedTemplateId = tmpl.id;
    grid.querySelectorAll('.template-card').forEach(cardEl => {
      const isSelected = cardEl.dataset.templateId === tmpl.id;
      cardEl.classList.toggle('is-selected', isSelected);
      cardEl.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    });
    if (previewPane) {
      _renderDbTemplatePreviewPane(previewPane, tmpl, dbPath, {
        overlay,
        onDeleted: () => renderTemplateCards(),
      });
    }
  }

  function renderTemplateCards() {
    grid.innerHTML = '';
    const templates = getAllTemplates();
    const filtered = templates.filter(t => {
      if (currentTier === 'custom') { if (t.tier !== 0) return false; }
      else if (currentTier !== 'all' && t.tier !== Number(currentTier)) return false;
      return matchesSearch(t, searchQuery);
    });

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'db-template-empty';
      empty.dataset.e2eId = 'db-template-empty';
      empty.textContent = searchQuery
        ? '該当するテンプレートがありません'
        : (currentTier === 'custom' ? 'カスタムテンプレートはまだありません' : 'テンプレートがありません');
      grid.appendChild(empty);
      if (previewPane) {
        previewPane.innerHTML = '';
        delete previewPane.dataset.templateId;
        const hint = document.createElement('div');
        hint.className = 'db-template-preview-empty';
        hint.textContent = 'テンプレートを選ぶとここにプレビューが表示されます';
        previewPane.appendChild(hint);
      }
      return;
    }

    filtered.forEach(tmpl => {
      const card = _buildTemplateCard(tmpl, dbPath, {
        overlay,
        mobile: isMobile,
        selected: tmpl.id === selectedTemplateId,
        onSelect: () => selectTemplate(tmpl),
        onChanged: () => renderTemplateCards(),
      });
      grid.appendChild(card);
    });

    if (!isMobile) {
      const target = filtered.find(t => t.id === selectedTemplateId) || filtered[0];
      if (target) selectTemplate(target);
    }
  }

  renderTemplateCards();
}
/* ==============================
   gb-db-template-editor-ui.js: カスタムテンプレートの作成・編集
   名前/説明に加えてアイコンを共通アイコンポップアップ（GBIconAssets.openPicker）で設定できる。
   作成・編集は同一のフォームモーダルを mode: 'create' | 'edit' で共用する。
   ============================== */

/**
 * アイコンspecを保存用に正規化する。
 * Lucide選択時は生名（旧版の lucide('lucide:x') 空SVG化を避けるため）、
 * Noto選択時は 'noto:HEX' のまま保存する。
 */
function _dbTemplateIconSpecForSave(spec) {
  const normalized = (typeof GBIconAssets !== 'undefined' && GBIconAssets?.normalizeSpec)
    ? GBIconAssets.normalizeSpec(spec)
    : String(spec || '');
  if (!normalized) return 'file';
  return normalized.toLowerCase().startsWith('lucide:') ? normalized.slice(7) : normalized;
}

function _dbTemplateOpenIconPicker(anchorEl, currentIcon, onSelect) {
  if (typeof GBIconAssets === 'undefined' || typeof GBIconAssets.openPicker !== 'function') return;
  GBIconAssets.openPicker({
    title: 'テンプレートアイコンを選択',
    anchorEl,
    current: currentIcon,
    allowReset: true,
    resetLabel: '既定に戻す',
    onSelect: (spec) => onSelect(_dbTemplateIconSpecForSave(spec)),
    onReset: () => onSelect('file'),
  });
}

/**
 * アイコン設定欄を構築する。GBIconAssets 未ロード環境ではボタンを出さず
 * 既定アイコンのまま進める（行き止まりUI禁止）。
 */
function _buildDbTemplateIconField(initialIcon) {
  const field = document.createElement('div');
  field.className = 'field gb-field db-template-icon-field';
  const label = document.createElement('div');
  label.className = 'gb-label';
  label.textContent = 'アイコン';
  field.appendChild(label);

  let currentIcon = initialIcon || 'file';
  const hasIconPicker = typeof GBIconAssets !== 'undefined' && typeof GBIconAssets.openPicker === 'function';

  if (!hasIconPicker) {
    const fallback = document.createElement('div');
    fallback.className = 'db-template-icon-fallback';
    fallback.innerHTML = _dbTemplateIconHtml(currentIcon, 18);
    field.appendChild(fallback);
    return { field, getIcon: () => currentIcon };
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'gb-btn gb-btn-sm db-template-icon-button';
  button.dataset.e2eId = 'db-template-icon-button';
  button.setAttribute('aria-label', 'テンプレートアイコンを選択');
  // gb-dropdown-dismiss.js の「外側クリックで閉じる」対象から自身を除外し、
  // 開いた直後に自分自身のクリックでピッカーが閉じてしまわないようにする
  button.setAttribute('aria-haspopup', 'dialog');
  const iconPreview = document.createElement('span');
  iconPreview.className = 'db-template-icon-button-preview';
  const labelSpan = document.createElement('span');
  labelSpan.className = 'db-template-icon-button-label';
  labelSpan.textContent = 'アイコンを選ぶ';
  button.append(iconPreview, labelSpan);
  const updateButton = () => {
    iconPreview.innerHTML = _dbTemplateIconHtml(currentIcon, 18);
  };
  updateButton();
  button.addEventListener('click', () => {
    _dbTemplateOpenIconPicker(button, currentIcon, (nextIcon) => {
      currentIcon = nextIcon;
      updateButton();
    });
  });
  field.appendChild(button);
  return { field, getIcon: () => currentIcon };
}

/**
 * カスタムテンプレートの作成/編集フォームモーダル本体（両モード共用）。
 * @param {object} options - { mode: 'create'|'edit', dbPath, triggerEl, initialName, initialDescription,
 *   initialIcon, previewText, editNote, onSave(fields): boolean|void }
 */
function _showDbTemplateFormModal(options) {
  const trigger = _dbTemplateTrigger(options.triggerEl);
  const mode = options.mode === 'edit' ? 'edit' : 'create';
  const seq = Date.now().toString(36) + '-' + Math.floor(Math.random() * 1000).toString(36);
  const titleId = `db-template-${mode}-title-${seq}`;
  const descId = `db-template-${mode}-desc-${seq}`;
  const nameId = `db-template-name-${seq}`;
  const detailId = `db-template-desc-${seq}`;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.dbTemplateModal = mode;
  overlay.style.zIndex = '120';

  const modal = document.createElement('div');
  modal.className = 'modal db-template-modal db-template-' + mode + '-modal';
  modal.dataset.e2eId = 'db-template-' + mode + '-dialog';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', titleId);
  modal.setAttribute('aria-describedby', descId);
  modal.tabIndex = -1;
  _setDbTemplateModalSize(modal, { maxWidth: 500, maxHeight: 560, heightRatio: 0.66, minHeight: 400 });

  const h3 = document.createElement('h3');
  h3.id = titleId;
  h3.textContent = mode === 'edit' ? 'カスタムテンプレート編集' : 'カスタムテンプレート作成';
  modal.appendChild(h3);
  const modalDesc = document.createElement('div');
  modalDesc.id = descId;
  modalDesc.className = 'gb-visually-hidden';
  modalDesc.textContent = mode === 'edit'
    ? 'カスタムテンプレートの名前・説明・アイコンを編集するダイアログ'
    : '現在のシート設定をカスタムテンプレートとして保存するダイアログ';
  modal.appendChild(modalDesc);

  const body = document.createElement('div');
  body.className = 'modal-body';

  const iconField = _buildDbTemplateIconField(options.initialIcon);
  body.appendChild(iconField.field);

  // 名前入力
  const nameField = document.createElement('div');
  nameField.className = 'field gb-field';
  const nameLabel = document.createElement('label');
  nameLabel.className = 'gb-label';
  nameLabel.htmlFor = nameId;
  nameLabel.textContent = 'テンプレート名';
  nameField.appendChild(nameLabel);
  const nameInput = document.createElement('input');
  nameInput.id = nameId;
  nameInput.className = 'gb-input';
  nameInput.dataset.e2eId = 'db-template-name-input';
  nameInput.type = 'text';
  nameInput.placeholder = '例: キャラシート（カスタム）';
  nameInput.value = options.initialName || '';
  nameField.appendChild(nameInput);
  body.appendChild(nameField);

  // 説明入力
  const descField = document.createElement('div');
  descField.className = 'field gb-field';
  const descLabel = document.createElement('label');
  descLabel.className = 'gb-label';
  descLabel.htmlFor = detailId;
  descLabel.textContent = '説明';
  descField.appendChild(descLabel);
  const descInput = document.createElement('input');
  descInput.id = detailId;
  descInput.className = 'gb-input';
  descInput.dataset.e2eId = 'db-template-desc-input';
  descInput.type = 'text';
  descInput.placeholder = 'テンプレートの説明';
  descInput.value = options.initialDescription || '';
  descField.appendChild(descInput);
  body.appendChild(descField);

  // プロパティ/ビューのプレビュー概要
  const preview = document.createElement('div');
  preview.className = 'db-template-create-preview';
  preview.textContent = options.previewText || '';
  body.appendChild(preview);

  if (mode === 'edit') {
    const note = document.createElement('div');
    note.className = 'db-template-edit-note';
    note.dataset.e2eId = 'db-template-edit-note';
    if (options.editNote) {
      note.textContent = options.editNote;
    } else {
      note.innerHTML = `名前・説明・アイコンのみ編集できます ${fieldHelp('列とビューは保存時点の内容のまま変更されません')}`;
    }
    body.appendChild(note);
  }
  modal.appendChild(body);

  // ボタン
  const btnRow = document.createElement('div');
  btnRow.className = 'db-template-footer';
  const cancelBtn = document.createElement('button');
  _setupDbTemplateButton(cancelBtn, 'gb-btn gb-btn-sm', 'db-template-' + mode + '-cancel');
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.addEventListener('click', () => _closeDbTemplateOverlay(overlay, trigger));
  btnRow.appendChild(cancelBtn);
  const saveBtn = document.createElement('button');
  _setupDbTemplateButton(saveBtn, 'gb-btn gb-btn-sm gb-btn-primary primary', 'db-template-' + mode + '-save');
  saveBtn.textContent = '保存';
  saveBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) { showStatus('名前を入力してください', true); return; }
    const result = options.onSave({
      name,
      description: descInput.value.trim(),
      icon: iconField.getIcon(),
    });
    if (result === false) return;
    _closeDbTemplateOverlay(overlay, trigger);
  });
  btnRow.appendChild(saveBtn);
  modal.appendChild(btnRow);

  overlay.appendChild(modal);
  _showDbTemplateOverlay(overlay, modal, trigger, nameInput);
}

/**
 * 現在のシートからカスタムテンプレートを作成するダイアログを開く。
 */
function showCreateTemplateModal(dbPath, triggerEl = null) {
  const exported = exportDbAsTemplate(dbPath);
  if (exported.properties.length === 0) {
    showStatus('このシートには列タイプが設定されていません', true);
    return;
  }

  const viewCount = Array.isArray(exported.savedViews) ? exported.savedViews.length : 0;
  const previewText = '含まれる列: ' + exported.properties.map(p => p.name).join(', ')
    + (viewCount ? `（ビュー${viewCount}件を含む）` : '');

  _showDbTemplateFormModal({
    mode: 'create',
    dbPath,
    triggerEl,
    initialName: '',
    initialDescription: '',
    initialIcon: exported.icon || 'file',
    previewText,
    onSave: ({ name, description, icon }) => {
      exported.name = name;
      exported.description = description;
      exported.icon = icon;
      const customs = getCustomTemplates();
      customs.push(exported);
      if (!saveCustomTemplates(customs, { label: 'シートテンプレート: カスタムテンプレート作成', detail: name })) return false;
      showStatus('カスタムテンプレート「' + name + '」を保存しました');
    },
  });
}

/**
 * 既存のカスタムテンプレートの名前・説明・アイコンを編集するダイアログを開く。
 * プロパティ・ビューは保存時点のスナップショットのまま変更しない。
 */
function showEditTemplateModal(tmpl, dbPath, triggerEl = null) {
  if (!tmpl || tmpl.tier !== 0) return;
  const propCount = (tmpl.properties || []).length;
  const viewCount = Array.isArray(tmpl.savedViews) ? tmpl.savedViews.length : 0;
  const previewText = `列${propCount}件` + (viewCount ? ` / ビュー${viewCount}件` : '');

  _showDbTemplateFormModal({
    mode: 'edit',
    dbPath,
    triggerEl,
    initialName: tmpl.name || '',
    initialDescription: tmpl.description || '',
    initialIcon: tmpl.icon || 'file',
    previewText,
    onSave: ({ name, description, icon }) => {
      const customs = getCustomTemplates();
      const idx = customs.findIndex(c => c.id === tmpl.id);
      if (idx < 0) { showStatus('カスタムテンプレートが見つかりません', true); return false; }
      customs[idx] = { ...customs[idx], name, description, icon };
      if (!saveCustomTemplates(customs, { label: 'シートテンプレート: カスタムテンプレート編集', detail: name })) return false;
      showStatus('カスタムテンプレート「' + name + '」を更新しました');
    },
  });
}
