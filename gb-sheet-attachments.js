/* gb-sheet-attachments.js:
   シート添付ファイル（新方式）の命名・形式判定の共通規則。
   デスクトップ版はサーバー側（meldex_sheet_attachments.py）が同じ規則で処理する。
   クラウド版はサーバーを持たないため、この規則をブラウザ側で適用する。
   **両者の規則がずれると、同じファイルを貼っても端末ごとに保存名が変わる**ので、
   片方を変えたらもう片方も必ず合わせること。 */
(function (global) {
  'use strict';

  // シートフォルダ内に作る添付フォルダの既定名（利用者に見える名前）
  const ATTACHMENT_FOLDER_NAME = '添付ファイル';
  // シートのフォルダノートへ記録するフィールド名。記録があるフォルダだけを
  // 行（エントリ）の一覧から除外する。
  const ATTACHMENT_FOLDER_FIELD = 'attachment_folder';

  const IMAGE_EXTS = ['png', 'jpg', 'gif', 'webp'];
  const VIDEO_EXTS = ['mp4', 'webm', 'mov'];
  const DOCUMENT_EXTS = ['pdf'];

  const KIND_BY_EXT = {};
  IMAGE_EXTS.forEach(ext => { KIND_BY_EXT[ext] = 'image'; });
  VIDEO_EXTS.forEach(ext => { KIND_BY_EXT[ext] = 'video'; });
  DOCUMENT_EXTS.forEach(ext => { KIND_BY_EXT[ext] = 'pdf'; });

  const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;
  const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;
  const RESERVED_STEMS = new Set(['CON', 'PRN', 'AUX', 'NUL']
    .concat(Array.from({ length: 9 }, (_, i) => 'COM' + (i + 1)))
    .concat(Array.from({ length: 9 }, (_, i) => 'LPT' + (i + 1))));
  const MAX_STEM_LENGTH = 80;
  const MAX_DUPLICATE_SUFFIX = 999;

  class AttachmentError extends Error {}

  function basename(rawName) {
    return String(rawName || '').replace(/\\/g, '/').split('/').pop() || '';
  }

  // pathlib と同じ扱いにするため、先頭ドットは拡張子とみなさない
  function splitExtension(rawName) {
    const name = basename(rawName);
    const dot = name.lastIndexOf('.');
    if (dot <= 0) return [name, ''];
    return [name.slice(0, dot), name.slice(dot + 1)];
  }

  function normalizeExt(ext) {
    const normalized = String(ext || '').trim().toLowerCase().replace(/^\./, '');
    if (normalized === 'jpeg') return 'jpg';
    if (normalized === 'qt') return 'mov';
    return normalized;
  }

  function mediaKindForExt(ext) {
    return KIND_BY_EXT[normalizeExt(ext)] || 'file';
  }

  function _contentTypeMatches(contentType, ext) {
    const type = String(contentType || '').toLowerCase();
    if (ext === 'jpg') return type.includes('jpeg') || type.includes('jpg');
    if (ext === 'mov') return type.includes('quicktime') || type.includes('mov');
    if (ext === 'pdf') return type.includes('pdf');
    return type.includes(ext);
  }

  function _startsWith(bytes, signature, offset) {
    const start = offset || 0;
    if (bytes.length < start + signature.length) return false;
    for (let i = 0; i < signature.length; i++) {
      if (bytes[start + i] !== signature[i]) return false;
    }
    return true;
  }

  /** 中身（マジックナンバー）から拡張子を決める。名前の拡張子と食い違えば拒否する。 */
  function detectContentExt(bytes, filename, contentType) {
    let detected = '';
    if (_startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) detected = 'png';
    else if (_startsWith(bytes, [0xff, 0xd8, 0xff])) detected = 'jpg';
    else if (_startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) detected = 'gif';
    else if (_startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && _startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) detected = 'webp';
    else if (_startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) detected = 'pdf';
    else if (_startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) detected = 'webm';
    else if (_startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
      const brand = String.fromCharCode(bytes[8] || 0, bytes[9] || 0).toLowerCase();
      detected = brand === 'qt' ? 'mov' : 'mp4';
    } else {
      const head = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 512))).trimStart().toLowerCase();
      if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) {
        throw new AttachmentError('SVG画像はアップロードできません');
      }
    }
    if (!detected) throw new AttachmentError('画像・動画・PDFファイルのみ添付できます');

    const nameExt = normalizeExt(splitExtension(filename)[1]);
    const known = Object.prototype.hasOwnProperty.call(KIND_BY_EXT, nameExt);
    if (known && nameExt !== detected) {
      throw new AttachmentError('ファイルの拡張子と内容が一致しません');
    }
    const declared = String(contentType || '').trim();
    if (!known && declared && !_contentTypeMatches(declared, detected)) {
      throw new AttachmentError('ファイルの種類を確認できません');
    }
    return detected;
  }

  /** 元のファイル名から、そのまま置ける安全な基本名（拡張子なし）を作る。 */
  function sanitizeAttachmentStem(rawName) {
    let stem = splitExtension(String(rawName || '').normalize('NFC'))[0];
    stem = stem.replace(CONTROL_CHARS, '').replace(INVALID_FILENAME_CHARS, '_');
    stem = stem.trim().replace(/^\.+|\.+$/g, '').trim();
    if (!stem) return '';
    if (RESERVED_STEMS.has(stem.toUpperCase())) stem = stem + '_';
    if (stem.length > MAX_STEM_LENGTH) stem = stem.slice(0, MAX_STEM_LENGTH).trimEnd();
    return stem;
  }

  function _pad(value, width) {
    return String(value).padStart(width || 2, '0');
  }

  /** クリップボード貼り付けなど元の名前が無い場合の自動命名。 */
  function fallbackAttachmentStem(kind, now) {
    const date = now instanceof Date ? now : new Date();
    const stamp = date.getFullYear() + '-' + _pad(date.getMonth() + 1) + '-' + _pad(date.getDate())
      + ' ' + _pad(date.getHours()) + _pad(date.getMinutes()) + _pad(date.getSeconds());
    const label = kind === 'video' ? '貼り付け動画' : (kind === 'pdf' ? '貼り付けPDF' : '貼り付け画像');
    return label + ' ' + stamp;
  }

  function buildAttachmentFilename(rawName, ext, now) {
    const normalizedExt = normalizeExt(ext);
    const stem = sanitizeAttachmentStem(rawName) || fallbackAttachmentStem(mediaKindForExt(normalizedExt), now);
    return stem + '.' + normalizedExt;
  }

  /**
   * 同名衝突を避けた保存名を決める。
   * `probe(name)` は `{exists, sameContent}` を返す関数（存在判定と内容一致判定）。
   */
  async function resolveAttachmentFilename(filename, probe) {
    const [stem, ext] = splitExtension(filename);
    const suffix = ext ? '.' + ext : '';
    const first = await probe(filename);
    if (!first || !first.exists) return { filename, reused: false };
    if (first.sameContent) return { filename, reused: true };
    for (let index = 2; index <= MAX_DUPLICATE_SUFFIX; index++) {
      const candidate = stem + ' (' + index + ')' + suffix;
      const found = await probe(candidate);
      if (!found || !found.exists) return { filename: candidate, reused: false };
      if (found.sameContent) return { filename: candidate, reused: true };
    }
    throw new AttachmentError('同じ名前のファイルが多すぎます。ファイル名を変えてから添付してください');
  }

  function attachmentFolderNameFromFrontmatter(frontmatter) {
    if (!frontmatter || typeof frontmatter !== 'object') return '';
    const raw = frontmatter[ATTACHMENT_FOLDER_FIELD];
    if (typeof raw !== 'string') return '';
    const name = basename(raw.trim());
    if (!name || name === '.' || name === '..') return '';
    return name;
  }

  function rawUrlForPath(path) {
    return '/api/file-raw?path=' + encodeURIComponent(String(path || '').replace(/\\/g, '/'));
  }

  function thumbUrlForPath(path, size) {
    const px = Math.max(64, Math.min(1024, parseInt(size, 10) || 256));
    return '/api/thumbnail?path=' + encodeURIComponent(String(path || '').replace(/\\/g, '/')) + '&size=' + px;
  }

  async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(v => v.toString(16).padStart(2, '0')).join('');
  }

  // 「名前.種別.拡張子」の複合拡張子。`.board.md` のように末尾が .md でも
  // エントリではないものがあるため、単純な拡張子判定より先に見る。
  const COMPOUND_SUFFIXES = [
    '.scriptnote.json', '.scenario.json',
    '.timer.json', '.calendar.json', '.board.md',
  ];
  // シートの中へ置いてよい項目か。シートの実体はフォルダなので、
  // ボード・シナリオ・画像などを入れると「シートの中にボードがある」状態になる。
  // サーバー側 meldex_api_outliner.reject_non_entry_into_sheet と同じ規則。
  // フォルダは許可する（旧形式のエントリ＝フォルダ、および添付ファイル用サブフォルダ）。
  // 添付ファイルはシート直下ではなく `<シート>/添付ファイル/` へ入るため対象外。
  function itemFitsInSheet(item) {
    const type = String(item?.type || '').toLowerCase();
    if (['folder', 'database', 'calendar', 'entity'].includes(type)) return true;
    const raw = String(item?.path || item?.name || '').replace(/\\/g, '/');
    const name = raw.replace(/\/+$/, '').split('/').pop() || '';
    if (!name) return true;
    const lower = name.toLowerCase();
    if (COMPOUND_SUFFIXES.some(suffix => lower.endsWith(suffix))) return false;
    const dot = lower.lastIndexOf('.');
    if (dot <= 0) return true;
    return lower.slice(dot) === '.md';
  }

  global.MeldexSheetAttachments = {
    ATTACHMENT_FOLDER_NAME,
    ATTACHMENT_FOLDER_FIELD,
    COMPOUND_SUFFIXES,
    itemFitsInSheet,
    IMAGE_EXTS,
    VIDEO_EXTS,
    DOCUMENT_EXTS,
    AttachmentError,
    attachmentFolderNameFromFrontmatter,
    buildAttachmentFilename,
    detectContentExt,
    fallbackAttachmentStem,
    mediaKindForExt,
    rawUrlForPath,
    resolveAttachmentFilename,
    sanitizeAttachmentStem,
    sha256Hex,
    splitExtension,
    thumbUrlForPath,
  };
})(window);
