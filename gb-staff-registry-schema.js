/* ==============================
   gb-staff-registry-schema.js: スタッフ管理シート（正本）のスキーマ定義

   ユーザーアカウント一元管理 計画書 Phase 1
   （docs/user-account-unification-plan-2026-07-18.md §5.1）

   Pythonの meldex_staff_registry_schema.py と1:1で対応する。
   test_meldex_staff_registry_schema_contract.py が両者の一致を検査する
   （gb-production-management-schema-definitions.js と
   meldex_production_schema.py の契約テストと同型）。
   ============================== */
(function () {
  'use strict';

  const REGISTRY_MARKER_KEY = 'meldex_registry';
  const REGISTRY_MARKER_VALUE = 'staff-v1';
  const DEFAULT_SHEET_NAME = 'スタッフ管理';
  const PERMISSION_OPTIONS = ['管理者', 'メンバー', '閲覧'];
  const USER_KEY_PROPERTY = 'スタッフ';
  const DISPLAY_NAME_PROPERTY = '表示名';
  const USER_META_KEY = 'meldex_user';
  const USER_META_SCHEMA_VERSION = 1;
  const USER_TYPE_ACCOUNT = 'account';
  const USER_TYPE_VIRTUAL = 'virtual';
  const USER_TYPES = [USER_TYPE_ACCOUNT, USER_TYPE_VIRTUAL];

  const date = (withTime = false) => ({ type: 'date', ...(withTime ? { withTime: true } : {}) });

  // 必須列（保護対象）。列名 → プロパティ型設定。
  const REQUIRED_PROPERTY_TYPES = {
    'スタッフ': { type: 'user' },
    '表示名': { type: 'text' },
    '権限': { type: 'select', options: [...PERMISSION_OPTIONS] },
    '作業可能時間': { type: 'text' },
    '休憩時間': { type: 'text' },
    '標準時間単価': { type: 'number' },
    '休日': { type: 'text' },
    '参加開始日': date(false),
    '参加終了日': date(false),
    '外部カレンダーURL（Google）': { type: 'url' },
    '外部カレンダーURL（CalDAV）': { type: 'url' },
    '同期有効': { type: 'checkbox' },
    '備考': { type: 'text' },
  };

  const REQUIRED_PROPERTY_ORDER = Object.keys(REQUIRED_PROPERTY_TYPES);

  function isRequiredProperty(propName) {
    return Object.prototype.hasOwnProperty.call(REQUIRED_PROPERTY_TYPES, String(propName || ''));
  }

  function isStaffRegistryFrontmatter(frontmatter) {
    return !!frontmatter && typeof frontmatter === 'object'
      && frontmatter[REGISTRY_MARKER_KEY] === REGISTRY_MARKER_VALUE;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  window.MeldexStaffRegistrySchema = deepFreeze({
    REGISTRY_MARKER_KEY,
    REGISTRY_MARKER_VALUE,
    DEFAULT_SHEET_NAME,
    PERMISSION_OPTIONS,
    USER_KEY_PROPERTY,
    DISPLAY_NAME_PROPERTY,
    USER_META_KEY,
    USER_META_SCHEMA_VERSION,
    USER_TYPE_ACCOUNT,
    USER_TYPE_VIRTUAL,
    USER_TYPES,
    REQUIRED_PROPERTY_TYPES,
    REQUIRED_PROPERTY_ORDER,
    isRequiredProperty,
    isStaffRegistryFrontmatter,
  });
})();
