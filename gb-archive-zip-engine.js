/**
 * gb-archive-zip-engine.js
 *
 * クラウド版（サーバー無しのブラウザ直結モード）でZIPの圧縮・解凍・閲覧を実現する
 * 自己完結ZIPエンジン。外部CDN・外部ライブラリは使わない。
 *
 * - 圧縮(deflate)は CompressionStream('deflate-raw') / DecompressionStream('deflate-raw')
 *   というブラウザ標準APIを使う。非対応環境では無圧縮(store)へフォールバックする
 *   （圧縮できないだけで、圧縮・解凍そのものは失敗させない）。
 * - ZIPコンテナ（ローカルヘッダ・セントラルディレクトリ・EOCD・CRC32）は自前実装。
 * - 安全上限はデスクトップ版 app/meldex_archive_service.py の定数と一致させている
 *   （app/tests/test_meldex_archive_zip_engine_parity.py で機械的に照合）。
 * - ZIP64（4GB超・65535件超）には対応しない。検出したら明示エラーにする
 *   （このエンジンの上限はいずれも2GB/2万件のため、ZIP64が必要な場面は無い）。
 */
(function (root) {
  'use strict';

  // ---- デスクトップ版と揃える安全上限（app/meldex_archive_service.py 参照） ----
  const MAX_MEMBER_COUNT = 20000;
  const MAX_MEMBER_BYTES = 512 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
  const MAX_COMPRESSION_RATIO = 1000;
  const RATIO_CHECK_MIN_SIZE = 100 * 1024 * 1024;

  const SIG_LOCAL_HEADER = 0x04034b50;
  const SIG_CENTRAL_HEADER = 0x02014b50;
  const SIG_EOCD = 0x06054b50;
  const ZIP64_MARKER = 0xffffffff;

  class MeldexArchiveError extends Error {
    constructor(message, opts) {
      super(message);
      this.name = 'MeldexArchiveError';
      this.status = (opts && opts.status) || 400;
      this.code = (opts && opts.code) || 'archive_error';
    }
  }

  // ---- CRC32 ----
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = (CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  // ---- deflate/inflate 対応検出 ----
  let _capabilityCache = null;
  function capabilities() {
    if (_capabilityCache) return _capabilityCache;
    let deflate = false;
    try {
      deflate = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
    } catch (_) {
      deflate = false;
    }
    _capabilityCache = { deflate };
    return _capabilityCache;
  }

  async function _bytesToStreamBuffer(bytes, StreamCtor, format) {
    const source = new Blob([bytes]).stream().pipeThrough(new StreamCtor(format));
    const buffer = await new Response(source).arrayBuffer();
    return new Uint8Array(buffer);
  }

  async function deflateRaw(bytes) {
    return _bytesToStreamBuffer(bytes, CompressionStream, 'deflate-raw');
  }

  /** 解凍後サイズがヘッダの自己申告と食い違う攻撃（ZIP爆弾）を、実際の
   * 展開量を数えながら止める。Response#arrayBuffer() は全読み終わるまで
   * 待つため、ヘッダを偽っての際限ない展開を防げない。 */
  async function inflateRawCapped(bytes, capBytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      let step;
      try {
        step = await reader.read();
      } catch (error) {
        throw new MeldexArchiveError('破損または未対応のZIPファイルです: ' + (error?.message || error), {
          code: 'corrupt_zip',
        });
      }
      if (step.done) break;
      total += step.value.length;
      if (total > capBytes) {
        try { await reader.cancel(); } catch (_) { /* 中断できなくても致命的ではない */ }
        throw new MeldexArchiveError('ZIP内のファイルの展開後サイズが上限を超えています', {
          code: 'member_too_large',
          status: 413,
        });
      }
      chunks.push(step.value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  // ---- ZIP内パスの安全性検査（デスクトップ版 _normalize_member と同じ規則） ----
  function normalizeMemberPath(raw, opts) {
    const allowRoot = !!(opts && opts.allowRoot);
    let value = String(raw == null ? '' : raw).replace(/\\/g, '/').trim();
    if (allowRoot && !value) return '';
    if (!value || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
      throw new MeldexArchiveError('安全でないZIP内パスです', { code: 'unsafe_path' });
    }
    const parts = value.replace(/\/+$/, '').split('/').filter(Boolean);
    if (!parts.length || parts.some((part) => part === '.' || part === '..')) {
      throw new MeldexArchiveError('安全でないZIP内パスです', { code: 'unsafe_path' });
    }
    return parts.join('/');
  }

  // 外部属性の上位16bitはUnixモード。symlinkは S_IFLNK (0o120000)。
  // デスクトップ版と同じくホストOS種別に関わらず機械的に判定する。
  function isSymlinkExternalAttr(externalAttr) {
    const mode = (externalAttr >>> 16) & 0xffff;
    return (mode & 0xf000) === 0xa000;
  }

  function _extToMime(name) {
    const dot = name.lastIndexOf('.');
    const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
    const table = {
      png: 'image/png', apng: 'image/apng', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      jfif: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
      bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon',
      pdf: 'application/pdf',
      mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
      mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4',
      txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
      html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript',
    };
    return table[ext] || 'application/octet-stream';
  }

  function _entryType(name, isDir) {
    if (isDir) return 'archive-folder';
    const dot = name.lastIndexOf('.');
    const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
    if (['.png', '.apng', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.avif'].includes(ext)) return 'image';
    if (ext === '.pdf') return 'document';
    if (['.mp4', '.webm', '.mov', '.mkv'].includes(ext)) return 'video';
    if (['.mp3', '.wav', '.flac', '.m4a', '.ogg'].includes(ext)) return 'audio';
    return 'archive-file';
  }

  // ---- 小さなバイナリ読み取りヘルパー ----
  class _Reader {
    constructor(bytes) {
      this.bytes = bytes;
      this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }

    u16(offset) { return this.view.getUint16(offset, true); }

    u32(offset) { return this.view.getUint32(offset, true); }

    text(offset, length) {
      return new TextDecoder('utf-8', { fatal: false }).decode(this.bytes.subarray(offset, offset + length));
    }
  }

  function _findEocd(bytes) {
    const maxCommentLength = 65535;
    const searchStart = Math.max(0, bytes.length - 22 - maxCommentLength);
    for (let offset = bytes.length - 22; offset >= searchStart; offset -= 1) {
      if (
        bytes[offset] === 0x50 && bytes[offset + 1] === 0x4b
        && bytes[offset + 2] === 0x05 && bytes[offset + 3] === 0x06
      ) {
        return offset;
      }
    }
    return -1;
  }

  function _dosDateTimeToIso(dosDate, dosTime) {
    const year = ((dosDate >> 9) & 0x7f) + 1980;
    const month = (dosDate >> 5) & 0x0f;
    const day = dosDate & 0x1f;
    const hour = (dosTime >> 11) & 0x1f;
    const minute = (dosTime >> 5) & 0x3f;
    const second = (dosTime & 0x1f) * 2;
    try {
      return new Date(Date.UTC(year, Math.max(0, month - 1), Math.max(1, day), hour, minute, second)).toISOString();
    } catch (_) {
      return new Date(0).toISOString();
    }
  }

  /**
   * ZIPバイト列を検証しながら解析する。デスクトップ版の
   * `_validated_members` と同じ安全検査（項目数・単一/合計展開後サイズ・
   * 異常圧縮率・暗号化・symlink・危険パス・重複）を行い、違反があれば
   * MeldexArchiveError を投げる。
   */
  async function parseZip(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new MeldexArchiveError('ZIPデータの形式が不正です');
    const eocdOffset = _findEocd(bytes);
    if (eocdOffset < 0) throw new MeldexArchiveError('破損または未対応のZIPファイルです', { code: 'corrupt_zip' });
    const reader = new _Reader(bytes);
    const totalEntries = reader.u16(eocdOffset + 10);
    const centralDirSize = reader.u32(eocdOffset + 12);
    const centralDirOffset = reader.u32(eocdOffset + 16);
    if (totalEntries === 0xffff || centralDirSize === ZIP64_MARKER || centralDirOffset === ZIP64_MARKER) {
      throw new MeldexArchiveError('この形式のZIP（ZIP64）には対応していません', { code: 'zip64_unsupported' });
    }
    if (totalEntries > MAX_MEMBER_COUNT) {
      throw new MeldexArchiveError(`ZIP内の項目数が上限を超えています (${MAX_MEMBER_COUNT}件まで)`, {
        code: 'too_many_members', status: 413,
      });
    }

    const members = new Map();
    const seenKeys = new Set();
    let totalUncompressed = 0;
    let cursor = centralDirOffset;
    for (let index = 0; index < totalEntries; index += 1) {
      if (cursor + 46 > bytes.length || reader.u32(cursor) !== SIG_CENTRAL_HEADER) {
        throw new MeldexArchiveError('破損または未対応のZIPファイルです', { code: 'corrupt_zip' });
      }
      const versionMadeBy = reader.u16(cursor + 4);
      const flags = reader.u16(cursor + 8);
      const method = reader.u16(cursor + 10);
      const modTime = reader.u16(cursor + 12);
      const modDate = reader.u16(cursor + 14);
      const memberCrc32 = reader.u32(cursor + 16);
      const compressedSize = reader.u32(cursor + 20);
      const uncompressedSize = reader.u32(cursor + 24);
      const nameLength = reader.u16(cursor + 28);
      const extraLength = reader.u16(cursor + 30);
      const commentLength = reader.u16(cursor + 32);
      const externalAttr = reader.u32(cursor + 38);
      const localHeaderOffset = reader.u32(cursor + 42);
      if (
        compressedSize === ZIP64_MARKER || uncompressedSize === ZIP64_MARKER
        || localHeaderOffset === ZIP64_MARKER
      ) {
        throw new MeldexArchiveError('この形式のZIP（ZIP64）には対応していません', { code: 'zip64_unsupported' });
      }
      const rawName = reader.text(cursor + 46, nameLength);
      cursor += 46 + nameLength + extraLength + commentLength;

      const isDir = rawName.endsWith('/');
      const name = normalizeMemberPath(rawName, { allowRoot: false });
      const key = name.toLowerCase();
      if (seenKeys.has(key)) {
        throw new MeldexArchiveError(`重複したZIP内パスがあります: ${name}`, { code: 'duplicate_member' });
      }
      seenKeys.add(key);

      if (flags & 0x1) {
        throw new MeldexArchiveError('暗号化されたZIPは扱えません', { code: 'encrypted_zip' });
      }
      if (isSymlinkExternalAttr(externalAttr)) {
        throw new MeldexArchiveError('シンボリックリンクを含むZIPは扱えません', { code: 'symlink_member' });
      }
      if (uncompressedSize > MAX_MEMBER_BYTES) {
        throw new MeldexArchiveError(`ZIP内のファイルが大きすぎます: ${name}`, {
          code: 'member_too_large', status: 413,
        });
      }
      totalUncompressed += uncompressedSize;
      if (totalUncompressed > MAX_TOTAL_BYTES) {
        throw new MeldexArchiveError('ZIPの展開後サイズが上限を超えています', {
          code: 'total_too_large', status: 413,
        });
      }
      if (
        uncompressedSize > RATIO_CHECK_MIN_SIZE && compressedSize > 0
        && uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO
      ) {
        throw new MeldexArchiveError(`異常な圧縮率のファイルがあります: ${name}`, {
          code: 'suspicious_ratio', status: 413,
        });
      }
      if (method !== 0 && method !== 8) {
        throw new MeldexArchiveError(`未対応の圧縮方式のファイルがあります: ${name}`, {
          code: 'unsupported_method',
        });
      }

      members.set(name, {
        name,
        isDir,
        method,
        crc32: memberCrc32,
        compressedSize,
        uncompressedSize,
        size: uncompressedSize,
        localHeaderOffset,
        modifiedIso: _dosDateTimeToIso(modDate, modTime),
        versionMadeBy,
      });
    }
    return { members };
  }

  /** メンバー1件のバイト列を復元し、CRC32を検証してから返す。 */
  async function extractMember(bytes, memberInfo) {
    const reader = new _Reader(bytes);
    const offset = memberInfo.localHeaderOffset;
    if (offset + 30 > bytes.length || reader.u32(offset) !== SIG_LOCAL_HEADER) {
      throw new MeldexArchiveError('破損または未対応のZIPファイルです', { code: 'corrupt_zip' });
    }
    const nameLength = reader.u16(offset + 26);
    const extraLength = reader.u16(offset + 28);
    const dataStart = offset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + memberInfo.compressedSize;
    if (dataEnd > bytes.length) {
      throw new MeldexArchiveError('破損または未対応のZIPファイルです', { code: 'corrupt_zip' });
    }
    const compressed = bytes.subarray(dataStart, dataEnd);
    let data;
    if (memberInfo.method === 0) {
      data = compressed.slice();
    } else if (!capabilities().deflate) {
      throw new MeldexArchiveError('このブラウザは圧縮ZIPの解凍に対応していません', { code: 'deflate_unsupported' });
    } else {
      data = await inflateRawCapped(compressed, MAX_MEMBER_BYTES);
    }
    if (crc32(data) !== memberInfo.crc32) {
      throw new MeldexArchiveError(`壊れたZIPです（CRC不一致): ${memberInfo.name}`, { code: 'crc_mismatch' });
    }
    return data;
  }

  // ---- ZIP書き込み ----
  class _ByteWriter {
    constructor() {
      this.chunks = [];
      this.length = 0;
    }

    push(bytes) {
      this.chunks.push(bytes);
      this.length += bytes.length;
      return this;
    }

    u16(value) {
      const buffer = new Uint8Array(2);
      new DataView(buffer.buffer).setUint16(0, value & 0xffff, true);
      return this.push(buffer);
    }

    u32(value) {
      const buffer = new Uint8Array(4);
      new DataView(buffer.buffer).setUint32(0, value >>> 0, true);
      return this.push(buffer);
    }

    text(value) {
      return this.push(new TextEncoder().encode(value));
    }

    toBytes() {
      const out = new Uint8Array(this.length);
      let offset = 0;
      for (const chunk of this.chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
      }
      return out;
    }
  }

  function _dosDateTime(date) {
    const d = date || new Date();
    const dosTime = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f);
    const dosDate = (((Math.max(0, d.getFullYear() - 1980)) & 0x7f) << 9)
      | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
    return { dosTime, dosDate };
  }

  /**
   * entries: [{ name: 'a/b.txt', data: Uint8Array }, ...]
   * ディレクトリの明示エントリは作らない（デスクトップ版の圧縮も同じ仕様で、
   * ファイルだけを辿って書き込む＝空フォルダは保存されない）。
   * 戻り値: 完成したZIP全体のUint8Array。書き込みは呼び出し側が最後に
   * 一度だけ確定パスへ書く（未完成ZIPが残らない設計）。
   */
  async function buildZip(entries) {
    const now = new Date();
    const { dosTime, dosDate } = _dosDateTime(now);
    const useDeflate = capabilities().deflate;
    const central = [];
    const body = new _ByteWriter();

    for (const entry of entries) {
      const nameBytes = new TextEncoder().encode(entry.name.replace(/\\/g, '/'));
      const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data || []);
      const dataCrc = crc32(data);
      let method = 0;
      let payload = data;
      if (useDeflate && data.length > 0) {
        try {
          const compressed = await deflateRaw(data);
          if (compressed.length < data.length) {
            method = 8;
            payload = compressed;
          }
        } catch (_) {
          // 圧縮に失敗しても無圧縮で続行する（サイレント失敗にはしない。
          // 呼び出し側の圧縮結果には method=0 が反映されるだけで、機能は止めない）
          method = 0;
          payload = data;
        }
      }
      const localHeaderOffset = body.length;
      body.u32(SIG_LOCAL_HEADER);
      body.u16(20); // version needed
      body.u16(0); // flags
      body.u16(method);
      body.u16(dosTime);
      body.u16(dosDate);
      body.u32(dataCrc);
      body.u32(payload.length);
      body.u32(data.length);
      body.u16(nameBytes.length);
      body.u16(0); // extra length
      body.push(nameBytes);
      body.push(payload);

      central.push({
        nameBytes, method, dosTime, dosDate, crc: dataCrc,
        compressedSize: payload.length, uncompressedSize: data.length, localHeaderOffset,
      });
    }

    const centralWriter = new _ByteWriter();
    for (const item of central) {
      centralWriter.u32(SIG_CENTRAL_HEADER);
      centralWriter.u16(20); // version made by
      centralWriter.u16(20); // version needed
      centralWriter.u16(0); // flags
      centralWriter.u16(item.method);
      centralWriter.u16(item.dosTime);
      centralWriter.u16(item.dosDate);
      centralWriter.u32(item.crc);
      centralWriter.u32(item.compressedSize);
      centralWriter.u32(item.uncompressedSize);
      centralWriter.u16(item.nameBytes.length);
      centralWriter.u16(0); // extra length
      centralWriter.u16(0); // comment length
      centralWriter.u16(0); // disk number start
      centralWriter.u16(0); // internal attr
      centralWriter.u32(0); // external attr
      centralWriter.u32(item.localHeaderOffset);
      centralWriter.push(item.nameBytes);
    }

    const centralOffset = body.length;
    const out = new _ByteWriter();
    out.push(body.toBytes());
    out.push(centralWriter.toBytes());
    out.u32(SIG_EOCD);
    out.u16(0); // disk number
    out.u16(0); // start disk
    out.u16(central.length);
    out.u16(central.length);
    out.u32(centralWriter.length);
    out.u32(centralOffset);
    out.u16(0); // comment length
    return out.toBytes();
  }

  /**
   * `provider`（端末内保存／Dropboxの両バックエンドで共通の File System
   * Access API 互換ハンドル抽象）から archivePath のZIPを読み、member を
   * 復元して返す。/archive/browse・/archive/file ルートと、img/video/iframe
   * のsrc書き換え（gb-cloud-file-url.js）の両方から共有で使う。
   */
  async function readArchiveMemberViaProvider(provider, archivePath, member) {
    if (!provider) throw new MeldexArchiveError('保存先を利用できません', { status: 500, code: 'no_provider' });
    const normalizedArchivePath = String(archivePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalizedArchivePath.toLowerCase().endsWith('.zip')) {
      throw new MeldexArchiveError('ZIPファイルが見つかりません', { status: 404, code: 'not_a_zip' });
    }
    let handle;
    try {
      handle = await provider.getFileHandle(normalizedArchivePath, { create: false });
    } catch (_) {
      throw new MeldexArchiveError('ZIPファイルが見つかりません', { status: 404, code: 'archive_not_found' });
    }
    const file = await handle.getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = await parseZip(bytes);
    const normalizedMember = normalizeMemberPath(member, { allowRoot: false });
    const info = parsed.members.get(normalizedMember);
    if (!info || info.isDir) {
      throw new MeldexArchiveError('ZIP内のファイルが見つかりません', { status: 404, code: 'member_not_found' });
    }
    const data = await extractMember(bytes, info);
    const leaf = normalizedMember.split('/').pop() || normalizedMember;
    return { bytes: data, name: leaf, mime: _extToMime(leaf), member: normalizedMember };
  }

  root.MeldexArchiveZipEngine = {
    LIMITS: {
      MAX_MEMBER_COUNT,
      MAX_MEMBER_BYTES,
      MAX_TOTAL_BYTES,
      MAX_COMPRESSION_RATIO,
      RATIO_CHECK_MIN_SIZE,
    },
    MeldexArchiveError,
    capabilities,
    crc32,
    normalizeMemberPath,
    isSymlinkExternalAttr,
    parseZip,
    extractMember,
    buildZip,
    readArchiveMemberViaProvider,
    entryType: _entryType,
    mimeForName: _extToMime,
  };
})(typeof window !== 'undefined' ? window : globalThis);
