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
  _dbTplProp.text('ふりがな'), _dbTplProp.text('一人称'), _dbTplProp.text('名前_アルファベット表記'),
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
      _dbTplProp.text('ふりがな'),
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
      _dbTplProp.text('ふりがな'), _dbTplProp.number('アーク番号'), _dbTplProp.number('開始話'), _dbTplProp.number('終了話'),
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
      _dbTplProp.text('ふりがな'), _dbTplProp.text('地域'), _dbTplProp.select('スケール', ['部屋','建物','街区','都市','地域','国','大陸','世界','異界']),
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
      _dbTplProp.text('ふりがな'), _dbTplProp.select('種類', ['政府','企業','秘密結社','学校','軍事','宗教','犯罪組織','自治組織','その他']),
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
      _dbTplProp.text('ふりがな'), _dbTplProp.select('種類', ['武器','防具','道具','素材','鍵','証拠','象徴物','消耗品','その他']),
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
      _dbTplProp.text('ふりがな'), _dbTplProp.select('種別', ['怪物','亜人','霊体','機械','人工生命','敵組織員','災害','その他']),
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
      _dbTplProp.text('ふりがな'), _dbTplProp.text('特徴'), _dbTplProp.text('身体的特徴'), _dbTplProp.text('文化'), _dbTplProp.text('社会構造'),
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
      _dbTplProp.text('ふりがな'), _dbTplProp.number('年表順'), _dbTplProp.text('時期'),
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
      _dbTplProp.text('ふりがな'), _dbTplProp.number('発生話'), _dbTplProp.select('種類', ['殺人','盗難','陰謀','事故','失踪','怪異','その他']),
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
      _dbTplProp.text('ふりがな'), _dbTplProp.select('階層', ['メイン','並行世界','上位世界','下位世界','夢・仮想','異界']),
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
  return ['pivot', 'gallery', 'kanban', 'calendar', 'timeline', 'chart', 'graph', 'form'].includes(value)
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
  const originalConfig = getDbViewConfig(dbPath);
  const c = _cloneTemplateData(originalConfig) || {};
  const applied = [];
  const skipped = [];
  const historyKeys = _dbTemplateStorageKeys(dbPath, !!(template.entityTemplates && template.entityTemplates.length > 0));
  const historyBefore = opts?.skipHistory ? null : _captureDbTemplateStorage(historyKeys);

  // 1. プロパティ型を設定
  if (!c.propertyTypes) c.propertyTypes = {};
  template.properties.forEach(p => {
    if (!overwrite && c.propertyTypes[p.name]) {
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
  _applyDbTemplateViewFields(c, template, overwrite);

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

  return { applied, skipped, backendSavePromise };
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
  };
}

/* --- テンプレートギャラリーUI --- */

/**
 * テンプレートギャラリーモーダルを表示
 */
function showTemplateGalleryModal(dbPath) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.dbTemplateModal = 'gallery';
  overlay.style.zIndex = '120';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.cssText = 'width:720px;max-width:90vw;max-height:80vh;display:flex;flex-direction:column;';

  // ヘッダー
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;';
  const h3 = document.createElement('h3');
  h3.textContent = 'シートテンプレート';
  h3.style.margin = '0';
  header.appendChild(h3);
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = lucide('x', 16);
  closeBtn.style.cssText = 'background:none;border:none;color:var(--fg2);cursor:pointer;';
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // コンテンツ（左: フィルタ、右: カード）
  const content = document.createElement('div');
  content.style.cssText = 'display:flex;gap:16px;flex:1;overflow:hidden;';

  // 左サイドバー
  const sidebar = document.createElement('div');
  sidebar.style.cssText = 'width:120px;flex-shrink:0;display:flex;flex-direction:column;gap:4px;';
  let currentTier = 'all';

  const tierFilters = [
    { key: 'all', label: 'すべて' },
    { key: '1', label: 'Tier 1' },
    { key: '2', label: 'Tier 2' },
    { key: '3', label: 'Tier 3' },
    { key: 'custom', label: 'カスタム' },
  ];

  tierFilters.forEach(tf => {
    const btn = document.createElement('button');
    btn.textContent = tf.label;
    btn.className = 'template-tier-btn' + (tf.key === 'all' ? ' active' : '');
    btn.dataset.tier = tf.key;
    btn.addEventListener('click', () => {
      currentTier = tf.key;
      sidebar.querySelectorAll('.template-tier-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderTemplateCards();
    });
    sidebar.appendChild(btn);
  });
  content.appendChild(sidebar);

  // 右: カードグリッド
  const grid = document.createElement('div');
  grid.className = 'template-grid';
  content.appendChild(grid);
  modal.appendChild(content);

  // フッター: カスタムテンプレート作成ボタン
  const footer = document.createElement('div');
  footer.style.cssText = 'margin-top:12px;display:flex;justify-content:flex-end;gap:8px;';
  const createBtn = document.createElement('button');
  createBtn.textContent = '+ 現在のシートからテンプレート作成';
  createBtn.addEventListener('click', () => {
    overlay.remove();
    showCreateTemplateModal(dbPath);
  });
  footer.appendChild(createBtn);
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '閉じる';
  cancelBtn.addEventListener('click', () => overlay.remove());
  footer.appendChild(cancelBtn);
  modal.appendChild(footer);

  overlay.appendChild(modal);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  function renderTemplateCards() {
    grid.innerHTML = '';
    const templates = getAllTemplates();
    const filtered = templates.filter(t => {
      if (currentTier === 'all') return true;
      if (currentTier === 'custom') return t.tier === 0;
      return t.tier === Number(currentTier);
    });

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'テンプレートがありません';
      empty.style.cssText = 'color:var(--fg2);padding:20px;';
      grid.appendChild(empty);
      return;
    }

    filtered.forEach(tmpl => {
