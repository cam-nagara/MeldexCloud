  // gb-production-management-cloud-entry-format.js: 全タスクシート横断のエントリ列挙、
  // エントリ→API応答行への整形（production_internal の合流を含む）、シートエイリアス・
  // タスクシート名判定などの小さな共通ヘルパーを担当する（責務単位分割 2026-08-12。旧
  // gb-production-management.part02.js の一部）。
  //
  // gb-production-management.part01.js から続く共有クロージャ（IIFEの raw
  // concatenation）に属し、このファイル自体は自前のIIFEを持たない。読み込み順は
  // gb-production-management.js を参照。

  async function _pmCloudListAllTaskEntries(provider, internals) {
    const all = [];
    const seenKeys = new Set();
    const migratedLegacyPaths = new Set();
    const sheets = await _pmCloudTaskSheetNames(provider, internals);
    const orderedSheets = [...sheets.filter(sheet => sheet !== 'タスクリスト'), ...sheets.filter(sheet => sheet === 'タスクリスト')];
    for (const sheet of orderedSheets) {
      const entries = await _pmCloudListEntries(provider, internals, sheet);
      entries.forEach(entry => {
        if (sheet === 'タスクリスト' && migratedLegacyPaths.has(entry.path)) return;
        const key = _pmCloudPropValue(entry.frontmatter, '作成キー');
        if (key && seenKeys.has(key)) return;
        if (key) seenKeys.add(key);
        if (sheet !== 'タスクリスト' && entry.frontmatter?.migrated_from) migratedLegacyPaths.add(String(entry.frontmatter.migrated_from));
        all.push({ ...entry, sheet });
      });
    }
    return all;
  }

  function _pmCloudEntryRow(entry) {
    const properties = {};
    Object.keys(entry?.frontmatter?.properties || {}).forEach(prop => {
      properties[prop] = _pmCloudPropValue(entry.frontmatter, prop);
    });
    // production_internal の値も一覧・詳細パネル・サイドバー（gb-tool-calendar-production-
    // sidebar.js の階層レベル表示・編集フォーム等）が読めるようにここで合流させる
    // （制作管理UX改善計画 2026-08-04 §5-1）。列一覧・列タイプ設定・フィルタ候補は
    // property_types 宣言（＝スキーマ）で決まるため、ここに含めても列としては出てこない。
    const internal = entry?.frontmatter?.production_internal;
    if (internal && typeof internal === 'object') {
      Object.entries(internal).forEach(([name, value]) => {
        if (!(name in properties) && value !== null && value !== undefined && value !== '') {
          properties[name] = String(value);
        }
      });
    }
    const sheet = String(entry?.sheet || entry?.frontmatter?.category || '');
    return {
      id: String(entry?.frontmatter?.id || ''),
      name: String(entry?.name || ''),
      path: String(entry?.path || ''),
      sheet,
      sheet_name: sheet,
      modified: String(entry?.frontmatter?.modified || ''),
      entry_revision: _pmCloudEntryRevision(entry?.frontmatter),
      transport_revision: entry?.transportRevision || null,
      properties,
    };
  }

  function _pmCloudEntryRevision(frontmatter) {
    const value = Number(frontmatter?.meldex_revision || 0);
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  }

  function _pmCloudTransportName() {
    return window.MeldexDocumentSaveCoordinator?.currentTransportName?.() || 'browser-local';
  }

  function _pmCloudFallbackTransportToken(parsed) {
    return _pmHash(JSON.stringify({ frontmatter: parsed?.frontmatter || {}, body: parsed?.body || '' }));
  }

  async function _pmCloudEntryTransportRevision(provider, path, parsed) {
    let token = '';
    if (typeof provider?.getMetadata === 'function') {
      try { token = String((await provider.getMetadata(path))?.revision || ''); } catch (_error) {}
    }
    return { transport: _pmCloudTransportName(), token: token || _pmCloudFallbackTransportToken(parsed) };
  }

  function _pmCloudPropValue(fm, prop) {
    // 制作管理UX改善計画（2026-08-04）§5-1: タスクリストの内部専用列は production_internal
    // を優先し、旧データ（properties に残ったまま）はフォールバックで読める。
    if (PM_INTERNAL_METADATA_PROPERTIES.has(prop)) {
      const internal = fm && fm.production_internal;
      if (internal && typeof internal === 'object' && Object.prototype.hasOwnProperty.call(internal, prop)) {
        const value = internal[prop];
        if (value !== null && value !== undefined && value !== '') return String(value);
      }
    }
    const values = fm?.properties?.[prop] || [];
    const list = Array.isArray(values) ? values : [values];
    const found = list.find(v => v && (v.status === '採用' || v.status === '掲載済み')) || list[0];
    return found && typeof found === 'object' ? String(found.value || '') : String(found || '');
  }

  // 「staff」エイリアス（→スタッフリスト）は廃止済み（アカウント一元管理
  // 計画書 Phase 4）。スタッフは正本「スタッフ管理シート」（window.MeldexUserRegistry）
  // 経由に統合され、制作管理のシート契約は 13→12 になった。
  const PM_CLOUD_SHEET_ALIASES = Object.freeze({ tasks: 'タスクリスト', works: '作品リスト', targets: '作業対象リスト', contents: '作業内容リスト', scales: '作業規模リスト', schedule: 'スケジュール', templates: 'タスクテンプレート' });
  const PM_CLOUD_TEMPLATE_FIELDS = new Set(['タスク名', '単位レベル1', '単位レベル2', '単位レベル3', '作業対象リスト', '作業内容リスト', '作業規模リスト', '対象数', '担当者', '目標作業時間_値', '対象色', '優先度', '備考']);
  const PM_CLOUD_LEVEL_COUNTERPART = Object.freeze({ '単位レベル1': '中分類', '中分類': '単位レベル1', '単位レベル2': '小分類', '小分類': '単位レベル2', '単位レベル3': '詳細分類', '詳細分類': '単位レベル3' });

  function _pmCloudError(status, message) { const error = new Error(message); error.status = status; return error; }
  function _pmCloudNormalizePath(value) { return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''); }
  function _pmCloudSheetAlias(value) { const raw = String(value || 'タスクリスト').trim(); return PM_CLOUD_SHEET_ALIASES[raw] || raw; }
  function _pmCloudIsTaskSheetName(value) {
    const name = String(value || '');
    return name === 'タスクリスト' || (name.startsWith(PM_TASK_SHEET_PREFIX) && !name.startsWith('タスクリスト_旧形式バックアップ'));
  }
  function _pmCloudPlainValue(value) {
    const item = Array.isArray(value) ? value[0] : value;
    return String(item && typeof item === 'object' ? item.value || '' : item == null ? '' : item).trim();
  }
  function _pmCloudClone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
