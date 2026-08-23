(function () {
  'use strict';

  const ROOT = '制作管理';
  const relation = (target, multiple = false) => ({
    type: multiple ? 'multi-relation' : 'relation',
    target,
    relationDb: `${ROOT}/シート/${target}`,
  });
  const date = (range = false, withTime = true) => ({
    type: 'date',
    ...(withTime ? { withTime: true } : {}),
    ...(range ? { range: true } : {}),
  });

  const PRIORITY_OPTIONS = ['低', '通常', '高', '最優先'];
  const GRANULARITY_OPTIONS = ['階層単位', '見開き単位', 'ページ単位', 'コマ単位'];
  const PRESET_OPTIONS = ['汎用', 'マンガ'];
  const SCHEDULE_TYPE_OPTIONS = ['シフト', '休み', '作業予定'];
  const TASK_GENERATION_OPTIONS = ['未作成', '作成中', '作成済み', '失敗'];
  const PAGE_RANGE_OPTION_SOURCE = {
    kind: 'row-page-range',
    mode: 'single',
    countProperty: 'ページ数',
    fallbackCount: 99,
  };
  const SPREAD_RANGE_OPTION_SOURCE = {
    ...PAGE_RANGE_OPTION_SOURCE,
    mode: 'spread',
    sideProperty: '開始ページの位置',
    defaultSide: '左ページ',
  };

  const PROPERTY_TYPES = {
    '作品リスト': {
      'ページ数': { type: 'number' },
      '開始ページの位置': { type: 'select', options: ['左ページ', '右ページ'] },
      '見開きページ': { type: 'multi-select', optionSource: SPREAD_RANGE_OPTION_SOURCE },
      'カラーページ': { type: 'multi-select', optionSource: PAGE_RANGE_OPTION_SOURCE },
      '作業作成粒度': { type: 'select', options: GRANULARITY_OPTIONS },
      '階層数': { type: 'number' },
      '階層ラベル': { type: 'text' },
      'プリセット種別': { type: 'select', options: PRESET_OPTIONS },
      '作業期間': date(true),
      '状況': { type: 'select' },
      '担当者': { type: 'user' },
      'タスク生成': { type: 'select', options: TASK_GENERATION_OPTIONS },
      '生成ページ数': { type: 'number' },
      '生成コマ数': { type: 'number' },
      'タスクリスト': relation('タスクリスト', true),
      'タスクリストシート': { type: 'text' },
      'スケジュール': relation('スケジュール', true),
      '備考': { type: 'text' },
    },
    // 制作管理UX改善計画（2026-08-04）§5-1: 階層パス/階層ラベル/単位レベル1〜5/
    // プリセット種別/作業作成粒度/ページソート値/作成キー/元テンプレートID/作業予定区間は
    // 内部専用列のため列定義（property_types）から外し、エントリfrontmatterの
    // production_internal: へ移した（列一覧・列タイプ設定・フィルタ候補に一切出ない）。
    // 一覧・詳細パネルは _pmCloudEntryRow がproduction_internalを合流させるため読める。
    'タスクリスト': {
      '作品タイトル': relation('作品リスト'),
      'ページ': { type: 'multi-select' },
      'コマ': { type: 'multi-select' },
      '作業対象リスト': relation('作業対象リスト'),
      '作業内容リスト': relation('作業内容リスト'),
      '作業規模リスト': relation('作業規模リスト'),
      '対象数': { type: 'number' },
      '状況': { type: 'select' },
      '優先度': { type: 'select', options: PRIORITY_OPTIONS },
      '担当者': { type: 'user' },
      '開始日時': date(),
      '完了日時': date(),
      '作業予定日時': date(true),
      '作業予定時間': { type: 'number' },
      '目標作業時間_値': { type: 'number' },
      '目標作業時間': { type: 'text' },
      '作業時間_実績': { type: 'number' },
      '実績作業時間': { type: 'number' },
      '作業参加者': { type: 'text' },
      '再計算ロック': { type: 'checkbox' },
      '担当者固定': { type: 'checkbox' },
      'シフト固定': { type: 'checkbox' },
      '親タスクID': { type: 'text' },
      'チェックリスト': { type: 'text' },
      'シフト割当不能理由': { type: 'text' },
      '対象色': { type: 'text' },
      '備考': { type: 'text' },
    },
    'タスクテンプレート': {
      'テンプレート名': { type: 'text' },
      'タスク名': { type: 'text' },
      '単位レベル1': { type: 'text' },
      '単位レベル2': { type: 'text' },
      '単位レベル3': { type: 'text' },
      '作業対象リスト': relation('作業対象リスト'),
      '作業内容リスト': relation('作業内容リスト'),
      '作業規模リスト': relation('作業規模リスト'),
      '対象数': { type: 'number' },
      '担当者': { type: 'user' },
      '目標作業時間_値': { type: 'number' },
      '対象色': { type: 'text' },
      '優先度': { type: 'select', options: PRIORITY_OPTIONS },
      '備考': { type: 'text' },
    },
    '作業対象リスト': {
      '基準作業時間': { type: 'number' },
      '対応する作業内容': relation('作業内容リスト', true),
      '対象色': { type: 'text' },
      '備考': { type: 'text' },
    },
    '作業内容リスト': {
      '表示名': { type: 'text' },
      '作業順': { type: 'number' },
      'カテゴリ': { type: 'text' },
      '作業時間倍率': { type: 'number' },
      '担当者候補': { type: 'multi-user' },
      '対応する作業対象': relation('作業対象リスト', true),
      '備考': { type: 'text' },
    },
    '作業規模リスト': {
      '作業時間倍率': { type: 'number' },
      '備考': { type: 'text' },
    },
    // 「スタッフリスト」シート（制作管理ルートごとのスタッフ一覧）は
    // アカウント一元管理 計画書 Phase 4 で廃止し、全体で1枚の正本
    // 「スタッフ管理シート」（gb-staff-registry-schema.js）へ統合した。
    // 13→12シート契約変更（破壊的変更・メジャー境界リリース）。
    // 「自動シフト調整設定」シートは制作管理UX改善計画（2026-08-04）§5-2で廃止した
    // （実行エンジン未実装のため）。既存ワークスペースのフォルダは削除せず、
    // 単に管理対象（この定義）から外すだけの非破壊変更。11シート契約。
    'スケジュール': {
      '予定名': { type: 'text' },
      '種別': { type: 'select', options: SCHEDULE_TYPE_OPTIONS },
      '担当者': { type: 'user' },
      '予定日時': date(true),
      '開始時刻': { type: 'text' },
      '終了時刻': { type: 'text' },
      '作品タイトル': relation('作品リスト'),
      'タスクリスト': relation('タスクリスト'),
      'カレンダーID': { type: 'text' },
      '作成キー': { type: 'text' },
      '備考': { type: 'text' },
    },
    '勤怠情報': {
      'スタッフ名': { type: 'user' },
      '日付': date(false, false),
      '出勤日時': date(),
      '退勤日時': date(),
      '実績日時': date(true),
      '休憩': { type: 'text' },
      '実績時間': { type: 'number' },
      '作成キー': { type: 'text' },
      '備考': { type: 'text' },
    },
    'スケジュール アーカイブ': {
      '予定名': { type: 'text' },
      '種別': { type: 'select', options: SCHEDULE_TYPE_OPTIONS },
      '担当者': { type: 'user' },
      '予定日時': date(true),
      '作成キー': { type: 'text' },
      '備考': { type: 'text' },
    },
    'タスクリスト アーカイブ': {
      '作品タイトル': relation('作品リスト'),
      'ページ': { type: 'multi-select' },
      'コマ': { type: 'multi-select' },
      '階層パス': { type: 'text' },
      '階層ラベル': { type: 'text' },
      '状況': { type: 'select' },
      '作業予定日時': date(true),
      '作業予定区間': { type: 'text' },
      '作成キー': { type: 'text' },
      '備考': { type: 'text' },
    },
    'データソース': {
      '役割': { type: 'text' },
      '対象シート': { type: 'text' },
      '有効': { type: 'checkbox' },
      '説明': { type: 'text' },
    },
  };

  const TASK_PROPERTY_TYPES = PROPERTY_TYPES['タスクリスト'];
  const SEEDS = {
    '作業内容リスト': [
      ['企画', { '表示名': '企画', '作業順': '10', '作業時間倍率': '1' }],
      ['準備', { '表示名': '準備', '作業順': '20', '作業時間倍率': '1' }],
      ['ネーム', { '表示名': 'ネーム', '作業順': '25', '作業時間倍率': '1' }],
      ['下描き', { '表示名': '下描き', '作業順': '30', '作業時間倍率': '1' }],
      ['3D配置', { '表示名': '3D配置', '作業順': '35', '作業時間倍率': '1' }],
      ['ペン入れ', { '表示名': 'ペン入れ', '作業順': '40', '作業時間倍率': '1' }],
      ['仕上げ', { '表示名': '仕上げ', '作業順': '50', '作業時間倍率': '1' }],
      ['制作', { '表示名': '制作', '作業順': '30', '作業時間倍率': '1' }],
      ['確認', { '表示名': '確認', '作業順': '40', '作業時間倍率': '1' }],
      ['修正', { '表示名': '修正', '作業順': '50', '作業時間倍率': '1' }],
      ['完了処理', { '表示名': '完了処理', '作業順': '60', '作業時間倍率': '1' }],
    ],
    '作業対象リスト': [
      ['全体', { '基準作業時間': '1' }],
      ['主要部分', { '基準作業時間': '1' }],
      ['詳細部分', { '基準作業時間': '0.75' }],
      ['補助部分', { '基準作業時間': '0.5' }],
      ['高難度部分', { '基準作業時間': '1.5' }],
    ],
    '作業規模リスト': [
      ['小', { '作業時間倍率': '0.5' }],
      ['標準', { '作業時間倍率': '1' }],
      ['大', { '作業時間倍率': '1.5' }],
      ['特大', { '作業時間倍率': '2' }],
    ],
  };

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  window.MeldexProductionSchemaDefinitions = deepFreeze({ PROPERTY_TYPES, TASK_PROPERTY_TYPES, SEEDS });
})();
