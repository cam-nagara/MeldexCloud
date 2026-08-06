/* gb-reference-codecs.js
 *
 * ファイル参照整合性・削除警告・全ファイルバックリンク実装計画 Phase 3。
 * 計画書: app/docs/file-reference-integrity-and-backlinks-plan-2026-07-31.md
 *         §6.5(共通コーデック)
 * Phase0監査: app/docs/file-reference-integrity-phase0-2026-08-01/notes.md
 *
 * Python側の正本 `meldex_reference_codecs.py`（JSON_REFERENCE_PATH_KEYS /
 * is_json_reference_path_key / is_external_reference）を、Cloud/Dropbox環境
 * (gb-data-access.part01.js の `_relocateReferences` 等）が使う判定として
 * JSへ移植する。キー台帳・判定アルゴリズムはPython側と1対1で対応させ、
 * `app/tests/test_meldex_reference_codec_parity.py` が両者の一致を機械的に
 * 固定する（どちらかを変更したら必ずもう片方も直すこと。ズレを検知する
 * テストが存在する）。
 *
 * 「動作を変えずに一元化」ではなく「意図的な拡大」であることに注意:
 * `gb-data-access.part01.js` の `_relocateReferences` は、移植前は固定19
 * キーのみを認識する独立実装だった（例: `imageSourcePath` のような
 * camelCase合成キーを認識できなかった）。本モジュールへの置き換えにより、
 * Python側と同じ「末尾一致・snake_case正規化」を含む判定へ広がる
 * （superset。認識するキーが増える方向にのみ変わる）。
 */
(function () {
  'use strict';

  // 旧 meldex_backlinks_service._BACKLINKS_JSON_PATH_KEYS のスナップショット
  // (camelCase中心・21キー)。
  var LEGACY_BACKLINKS_JSON_PATH_KEYS = [
    'path', 'filePath', 'targetPath', 'sourcePath', 'linkPath', 'notePath',
    'entryPath', 'dbPath', 'folderPath', 'boardPath', 'calendarPath',
    'scriptnotePath', 'imagePath', 'mediaPath', 'audioPath', 'videoPath',
    'attachmentPath', 'attachment', 'href', 'src', 'url',
  ];

  // 旧 meldex_path_relocator_service._JSON_PATH_KEYS のスナップショット
  // (snake_case中心)。
  var LEGACY_RELOCATOR_JSON_PATH_KEYS = [
    'path', 'file_path', 'filepath', 'target_path', 'source_path', 'link', 'links',
    'url', 'href', 'src', 'source', 'target', 'image', 'images', 'thumbnail', 'thumb',
    'background', 'bg', 'cover', 'icon', 'avatar', 'attachment', 'attachments', 'file',
    'files', 'audio', 'video', 'media', 'pdf', 'embed', 'resource',
  ];

  // 統合後の正本キー集合(和集合)。Python側 JSON_REFERENCE_PATH_KEYS と
  // 同一の47件になる（test_meldex_reference_codec_parity.pyが件数・集合の
  // 一致を確認する）。
  var JSON_REFERENCE_PATH_KEYS = Array.from(new Set(
    LEGACY_BACKLINKS_JSON_PATH_KEYS.concat(LEGACY_RELOCATOR_JSON_PATH_KEYS),
  )).sort();
  var JSON_REFERENCE_PATH_KEYS_SET = new Set(JSON_REFERENCE_PATH_KEYS);

  /**
   * camelCase・PascalCase・snake_case・混在ケースを lower_snake_case へ
   * 正規化する。Python側 `_to_snake_case` と同一のアルゴリズム。
   */
  function toSnakeCase(key) {
    var text = String(key == null ? '' : key);
    var parts = [];
    var prevIsLowerOrDigit = false;
    for (var i = 0; i < text.length; i += 1) {
      var ch = text[i];
      var isUpper = ch !== ch.toLowerCase() && ch === ch.toUpperCase();
      if (isUpper && prevIsLowerOrDigit) parts.push('_');
      parts.push(ch.toLowerCase());
      var lower = ch.toLowerCase();
      prevIsLowerOrDigit = (lower === ch && /[a-z0-9]/.test(ch));
    }
    var normalized = parts.join('').replace(/[^a-z0-9]+/g, '_');
    return normalized.replace(/^_+|_+$/g, '');
  }

  var JSON_REFERENCE_PATH_KEYS_SNAKE = new Set(
    JSON_REFERENCE_PATH_KEYS.map(function (key) { return toSnakeCase(key); }),
  );

  /**
   * JSONのキー名がパス的参照を持ちうるキーかどうかを判定する
   * （Python側 `is_json_reference_path_key` と同一のアルゴリズム）。
   *
   * - 生の文字列、または先頭1文字だけ小文字化した文字列が正本集合に含まれる
   * - 完全小文字化した文字列が(区切り文字の有無を問わず)'path' で終わる
   * - snake_case正規化した文字列が正本集合のsnake_case版に含まれる、または
   *   '_path'/'_url' で終わる
   */
  function isJsonReferencePathKey(key) {
    if (!key) return false;
    var raw = String(key);
    var loweredFirst = raw.length ? raw[0].toLowerCase() + raw.slice(1) : raw;
    if (JSON_REFERENCE_PATH_KEYS_SET.has(raw) || JSON_REFERENCE_PATH_KEYS_SET.has(loweredFirst)) {
      return true;
    }
    if (raw.toLowerCase().endsWith('path')) return true;
    var normalized = toSnakeCase(raw);
    if (JSON_REFERENCE_PATH_KEYS_SNAKE.has(normalized)) return true;
    return normalized.endsWith('_path') || normalized.endsWith('_url');
  }

  var EXTERNAL_REFERENCE_PREFIXES = [
    'http://', 'https://', 'mailto:', 'ftp://',
    'javascript:', 'data:', '#', 'tel:',
  ];

  /**
   * URL/mailto等の外部参照、または非パス文字列かどうかを判定する
   * （Python側 `is_external_reference` と同一のロジック）。
   */
  function isExternalReference(value) {
    if (!value) return false;
    var lowered = String(value).trim().toLowerCase();
    return EXTERNAL_REFERENCE_PREFIXES.some(function (prefix) {
      return lowered.indexOf(prefix) === 0;
    });
  }

  window.MeldexReferenceCodecs = {
    CODEC_VERSION: 1,
    JSON_REFERENCE_PATH_KEYS: JSON_REFERENCE_PATH_KEYS,
    isJsonReferencePathKey: isJsonReferencePathKey,
    isExternalReference: isExternalReference,
    _toSnakeCase: toSnakeCase,
  };
})();
