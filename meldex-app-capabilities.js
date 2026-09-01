(function (root, factory) {
  const registry = factory();
  if (typeof module === 'object' && module.exports) module.exports = registry;
  if (root) root.MeldexAppCapabilities = registry;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STATUS = Object.freeze({
    available: 'available',
    alternative: 'alternative',
    exception: 'exception',
    out_of_scope: 'out_of_scope',
  });

  const APPS = Object.freeze([
    'note',
    'scenario',
    'board',
    'sheet',
    'quick_memo',
    'viewer',
  ]);

  const ENVIRONMENTS = Object.freeze([
    'desktop_main',
    'windows_standalone',
    'cloud_main',
    'cloud_standalone',
    'mobile_cloud',
  ]);

  const CAPABILITIES = Object.freeze([
    'load',
    'edit',
    'save',
    'save_as',
    'export',
    'file_info',
    'file_style',
    'publish',
    'backlinks',
    'annotations_comments',
    'internal_link_selection',
    'main',
    'float',
    'right_sidebar_drawer',
    'open_external_app',
    'drag_drop',
    'clipboard',
    'multiple_import',
    'conflict_detection',
    'edit_lock',
    'move_tracking',
    'offline_save',
    'dropbox_sync',
    'auto_link',
    'version_history',
  ]);

  const DEFINITIONS = Object.freeze({
    apps: APPS,
    environments: ENVIRONMENTS,
    capabilities: CAPABILITIES,
    statuses: Object.freeze(Object.values(STATUS)),
  });

  const EXCEPTION_CAPABILITIES = new Set(['auto_link', 'version_history']);
  const INTEGRATED_ONLY_APPS = new Set(['note', 'scenario', 'board', 'sheet']);
  const STANDALONE_VERSION_HISTORY_APPS = new Set(['quick_memo', 'viewer']);
  const APP_OUT_OF_SCOPE = Object.freeze({
    note: Object.freeze({
      multiple_import: 'ノートは単一文書編集を正本とし複数ファイル一括取込を扱わない',
    }),
    scenario: Object.freeze({
      multiple_import: 'シナリオは単一作品編集を正本とし複数作品一括取込を扱わない',
    }),
    board: Object.freeze({
      publish: 'ボードは編集・書出し対象であり公開ページ生成は製品範囲外',
    }),
    sheet: Object.freeze({
      save_as: 'シートはフォルダ実体を直接編集し別名ファイル保存を行わない',
      multiple_import: 'シートは一件ずつ取込先を確認し複数ファイル一括取込を扱わない',
    }),
    quick_memo: Object.freeze({
      save_as: 'クイックメモは現在の同期先へ即時保存し別名保存を行わない',
      export: 'クイックメモは即時同期を目的とし独立した書出し機能を持たない',
      file_info: 'クイックメモは独立ファイルプロパティパネルを持たない',
      file_style: 'クイックメモは文書スタイルを持たない',
      publish: 'クイックメモは公開コンテンツを生成しない',
      backlinks: 'クイックメモは参照索引の表示対象ではない',
      annotations_comments: 'クイックメモに別系統のアノテートやコメントを重ねない',
      internal_link_selection: 'クイックメモは内部リンク選択UIを持たない',
      drag_drop: 'クイックメモは入力欄へのファイルD&D取込を行わない',
      multiple_import: 'クイックメモは複数ファイル一括取込を扱わない',
      conflict_detection: 'クイックメモは追記同期を使い文書revision競合UIを持たない',
      edit_lock: 'クイックメモは短文追記を共有し排他的な文書編集ロックを取得しない',
      move_tracking: 'クイックメモは固定同期領域を使い編集中ファイル移動を追跡しない',
      right_sidebar_drawer: 'クイックメモは専用のメモ一覧を使い共通右サイドバーを持たない',
    }),
    viewer: Object.freeze({
      file_style: 'ビューワーは元ファイルの表示スタイルを編集しない',
      backlinks: 'ビューワーは参照索引を編集・表示する文書画面ではない',
      internal_link_selection: 'ビューワーは内部リンクを挿入・選択しない',
      clipboard: 'ビューワーは文書内容のコピー・貼り付け編集を行わない',
      multiple_import: 'ビューワーはフォルダー内媒体を閲覧し複数取込を行わない',
      dropbox_sync: '単独ビューワーはローカル媒体を表示しDropbox同期を担当しない',
    }),
  });
  const VIEWER_READ_ONLY_CAPABILITIES = new Set([
    'edit',
    'save',
    'save_as',
    'export',
    'publish',
    'internal_link_selection',
    'conflict_detection',
    'edit_lock',
    'move_tracking',
    'offline_save',
  ]);
  const STANDALONE_MAIN_ALTERNATIVES = new Set([
    'publish',
    'backlinks',
    'annotations_comments',
    'internal_link_selection',
    'float',
  ]);
  const CLOUD_STANDALONE_MAIN_ALTERNATIVES = new Set([
    'publish',
    'backlinks',
    'annotations_comments',
    'internal_link_selection',
    'float',
    'open_external_app',
  ]);
  const MOBILE_ALTERNATIVES = new Set([
    'float',
    'right_sidebar_drawer',
    'open_external_app',
    'drag_drop',
    'multiple_import',
  ]);

  const CAPABILITY_STRATEGIES = Object.freeze({
    load: 'document-loader',
    edit: 'application-editor-engine',
    save: 'document-save-coordinator',
    save_as: 'document-save-as-adapter',
    export: 'application-export-adapter',
    file_info: 'file-metadata-adapter',
    file_style: 'file-style-runtime',
    publish: 'publication-adapter',
    backlinks: 'reference-graph-adapter',
    annotations_comments: 'annotation-comment-adapter',
    internal_link_selection: 'link-selection-router',
    main: 'main-surface-host',
    float: 'float-panel-host',
    right_sidebar_drawer: 'secondary-surface-host',
    open_external_app: 'external-open-router',
    drag_drop: 'drag-drop-adapter',
    clipboard: 'clipboard-adapter',
    multiple_import: 'multi-import-adapter',
    conflict_detection: 'revision-conflict-adapter',
    edit_lock: 'active-edit-lock-adapter',
    move_tracking: 'file-identity-relocation-adapter',
    offline_save: 'offline-draft-outbox-adapter',
    dropbox_sync: 'dropbox-sync-adapter',
    auto_link: 'main-autolink-service',
    version_history: 'main-version-history-service',
  });

  const ADAPTERS = Object.create(null);

  function _defineAdapter(id, definition) {
    if (!id || ADAPTERS[id]) throw new Error(`duplicate or empty adapter definition: ${id}`);
    ADAPTERS[id] = Object.freeze({
      id,
      executable: typeof definition.execute === 'function',
      handlerRequired: definition.handlerRequired === true,
      strategy: definition.strategy,
      nextAction: definition.nextAction || null,
      execute: definition.execute || null,
    });
  }

  for (const environment of ENVIRONMENTS) {
    for (const capability of CAPABILITIES) {
      const id = `implementation:${environment}:${capability}`;
      _defineAdapter(id, {
        handlerRequired: true,
        strategy: `${environment}/${CAPABILITY_STRATEGIES[capability]}`,
      });
    }
  }
  _defineAdapter('route:desktop_main', {
    strategy: 'route-to-desktop-main',
    nextAction: 'デスクトップ版本体で開く',
    execute: route => Object.freeze({ supported: true, route }),
  });
  _defineAdapter('route:cloud_main', {
    strategy: 'route-to-cloud-main',
    nextAction: 'Cloud版本体で開く',
    execute: route => Object.freeze({ supported: true, route }),
  });
  _defineAdapter('route:web-open', {
    strategy: 'web-download-or-associated-app',
    nextAction: 'ダウンロードまたはWebで利用可能なアプリで開く',
    execute: route => Object.freeze({ supported: true, route }),
  });
  for (const capability of MOBILE_ALTERNATIVES) {
    _defineAdapter(`mobile-alternative:${capability}`, {
      strategy: `mobile/${CAPABILITY_STRATEGIES[capability]}`,
      nextAction: capability === 'float'
        ? '全画面副画面またはドロワーで開く'
        : 'タッチ端末用の代替操作を使う',
      execute: route => Object.freeze({ supported: true, route }),
    });
  }
  _defineAdapter('exception:standalone:auto_link', {
    executable: false,
    strategy: 'preserve-autolink-source-data',
    nextAction: '同じファイルをMeldex本体で開く',
  });
  _defineAdapter('exception:standalone:version_history', {
    executable: false,
    strategy: 'preserve-main-version-history',
    nextAction: '同じファイルをMeldex本体で開く',
  });
  _defineAdapter('exception:cloud_browser_local_annotations', {
    executable: false,
    strategy: 'reject-transient-browser-annotation-target',
    nextAction: 'Meldex本体またはWindows単独ビューワーで開く',
  });
  _defineAdapter('scope:viewer-read-only', {
    executable: false,
    strategy: 'viewer-read-only-boundary',
    nextAction: '編集できる対応アプリで開く',
  });
  for (const app of APPS) {
    for (const capability of Object.keys(APP_OUT_OF_SCOPE[app])) {
      _defineAdapter(`scope:${app}:${capability}`, {
        executable: false,
        strategy: `${app}-product-boundary`,
        nextAction: '対応するMeldexアプリで操作する',
      });
    }
  }

  function _assertUniqueList(name, values) {
    if (!Array.isArray(values) || values.length === 0) {
      throw new TypeError(`${name} must be a non-empty array`);
    }
    const seen = new Set();
    for (const value of values) {
      if (typeof value !== 'string' || !value.trim()) {
        throw new TypeError(`${name} contains an empty or non-string value`);
      }
      if (seen.has(value)) throw new Error(`duplicate ${name} value: ${value}`);
      seen.add(value);
    }
  }

  function validateDefinition(definition) {
    if (!definition || typeof definition !== 'object') {
      throw new TypeError('capability definition is required');
    }
    _assertUniqueList('apps', definition.apps);
    _assertUniqueList('environments', definition.environments);
    _assertUniqueList('capabilities', definition.capabilities);
    _assertUniqueList('statuses', definition.statuses);
    const requiredStatuses = Object.values(STATUS);
    for (const status of requiredStatuses) {
      if (!definition.statuses.includes(status)) {
        throw new Error(`missing status: ${status}`);
      }
    }
    return true;
  }

  function _route(environment, app, reason) {
    const targetEnvironment = environment.includes('cloud') ? 'cloud_main' : 'desktop_main';
    return Object.freeze({
      environment: targetEnvironment,
      app,
      reason,
    });
  }

  function _record(status, adapter, route, reason, nextAction) {
    if (!Object.values(STATUS).includes(status)) {
      throw new Error(`unknown capability status: ${status}`);
    }
    if (!adapter || typeof adapter !== 'string' || !ADAPTERS[adapter]) {
      throw new Error(`known capability adapter is required: ${String(adapter)}`);
    }
    if (status === STATUS.alternative && !route) {
      throw new Error(`alternative capability requires a route: ${adapter}`);
    }
    if (status === STATUS.available && ADAPTERS[adapter].handlerRequired !== true
        && ADAPTERS[adapter].executable !== true) {
      throw new Error(`available capability requires a handler contract or executable adapter: ${adapter}`);
    }
    return Object.freeze({
      status,
      adapter,
      route: route || null,
      reason: String(reason || ''),
      nextAction: nextAction || ADAPTERS[adapter].nextAction || null,
    });
  }

  function _exceptionRecord(environment, capability) {
    return _record(
      STATUS.exception,
      `exception:standalone:${capability}`,
      null,
      capability === 'auto_link'
        ? '自動リンクはMeldex本体が表示時に付加する許容例外'
        : '版履歴はMeldex本体の管理サービスに限定する許容例外',
      environment === 'cloud_standalone'
        ? '同じファイルをCloud版本体で開く'
        : '同じファイルをデスクトップ版本体で開く',
    );
  }

  function _viewerReadOnlyRecord(environment, app, capability) {
    const isStandalone = environment === 'windows_standalone' || environment === 'cloud_standalone';
    const route = isStandalone
      ? _route(environment, app, '編集操作が必要な場合は対応するMeldex本体で開く')
      : null;
    return _record(
      STATUS.out_of_scope,
      'scope:viewer-read-only',
      route,
      `ビューワーでは${capability}を製品範囲外とする`,
    );
  }

  function _classificationFor(app, environment, capability) {
    if (INTEGRATED_ONLY_APPS.has(app)
        && (environment === 'windows_standalone' || environment === 'cloud_standalone')) {
      const isCloud = environment === 'cloud_standalone';
      return _record(
        STATUS.out_of_scope,
        isCloud ? 'route:cloud_main' : 'route:desktop_main',
        _route(environment, app, `${app}はMeldex本体の統合ツールとして開く`),
        `${app}の単独版は新規提供せずMeldex本体へ統合する`,
        isCloud ? 'Cloud版本体で開く' : 'デスクトップ版本体で開く',
      );
    }
    if (EXCEPTION_CAPABILITIES.has(capability)
        && !(capability === 'version_history' && STANDALONE_VERSION_HISTORY_APPS.has(app))
        && (environment === 'windows_standalone' || environment === 'cloud_standalone')) {
      return _exceptionRecord(environment, capability);
    }
    const scopeReason = APP_OUT_OF_SCOPE[app][capability];
    if (scopeReason) {
      return _record(
        STATUS.out_of_scope,
        `scope:${app}:${capability}`,
        null,
        scopeReason,
        '対応するMeldexアプリで操作する',
      );
    }
    if (app === 'viewer' && VIEWER_READ_ONLY_CAPABILITIES.has(capability)) {
      return _viewerReadOnlyRecord(environment, app, capability);
    }
    if (app === 'viewer'
        && environment === 'cloud_standalone'
        && capability === 'annotations_comments') {
      return _record(
        STATUS.exception,
        'exception:cloud_browser_local_annotations',
        null,
        'Cloud単独ビューワーのブラウザーローカルファイルには永続的な保存先がないためアノテートを保存しない',
        'アノテートが必要なファイルはMeldex本体またはWindows単独ビューワーで開く',
      );
    }
    if (app === 'viewer'
        && environment === 'windows_standalone'
        && capability === 'annotations_comments') {
      return _record(
        STATUS.available,
        `implementation:${environment}:annotations_comments`,
        null,
        'Windows単独ビューワーのアノテート画面で利用可能',
      );
    }
    if (environment === 'windows_standalone' && STANDALONE_MAIN_ALTERNATIVES.has(capability)) {
      return _record(
        STATUS.alternative,
        'route:desktop_main',
        _route(environment, app, '本体管理の共通機能はデスクトップ版本体で開く'),
        'Windows単独版ではデスクトップ版本体へ明示的に移送する',
      );
    }
    if (environment === 'cloud_standalone' && CLOUD_STANDALONE_MAIN_ALTERNATIVES.has(capability)) {
      return _record(
        STATUS.alternative,
        'route:cloud_main',
        _route(environment, app, '本体管理の共通機能はCloud版本体で開く'),
        'Cloud単独版ではCloud版本体へ明示的に移送する',
      );
    }
    if (environment === 'mobile_cloud' && MOBILE_ALTERNATIVES.has(capability)) {
      return _record(
        STATUS.alternative,
        `mobile-alternative:${capability}`,
        Object.freeze({
          environment: 'mobile_cloud',
          app,
          reason: capability === 'float'
            ? 'フロートの代わりに全画面副画面またはドロワーを使う'
            : 'タッチ端末で同じ意味を持つ操作へ置き換える',
        }),
        'モバイル固有の代替操作を提供する',
      );
    }
    if ((environment === 'cloud_main' || environment === 'cloud_standalone')
        && capability === 'open_external_app') {
      return _record(
        STATUS.alternative,
        'route:web-open',
        Object.freeze({
          environment,
          app,
          reason: 'Webで利用可能なアプリ起動またはダウンロードへ置き換える',
        }),
        'Windows固有の関連付けをWebの明示操作へ置き換える',
      );
    }
    return _record(
      STATUS.available,
      `implementation:${environment}:${capability}`,
      null,
      'この環境で意味的に利用可能',
    );
  }

  function _buildCatalog() {
    const catalog = Object.create(null);
    for (const app of APPS) {
      catalog[app] = Object.create(null);
      for (const environment of ENVIRONMENTS) {
        const profile = Object.create(null);
        for (const capability of CAPABILITIES) {
          profile[capability] = _classificationFor(app, environment, capability);
        }
        catalog[app][environment] = Object.freeze(profile);
      }
      Object.freeze(catalog[app]);
    }
    return Object.freeze(catalog);
  }

  function _requireKnown(kind, value, allowed) {
    if (typeof value !== 'string' || !allowed.includes(value)) {
      throw new RangeError(`unknown ${kind}: ${String(value)}`);
    }
  }

  validateDefinition(DEFINITIONS);
  const CATALOG = _buildCatalog();

  function classify(app, environment, capability) {
    _requireKnown('app', app, APPS);
    _requireKnown('environment', environment, ENVIRONMENTS);
    _requireKnown('capability', capability, CAPABILITIES);
    const result = CATALOG[app][environment][capability];
    if (!result) throw new Error(`missing capability classification: ${app}/${environment}/${capability}`);
    return result;
  }

  function getProfile(app, environment) {
    _requireKnown('app', app, APPS);
    _requireKnown('environment', environment, ENVIRONMENTS);
    return CATALOG[app][environment];
  }

  function supports(app, environment, capability) {
    const status = classify(app, environment, capability).status;
    return status === STATUS.available || status === STATUS.alternative;
  }

  function assertVisibleAction(app, environment, capability, options) {
    const classification = classify(app, environment, capability);
    const settings = options && typeof options === 'object' ? options : {};
    if (settings.visible === false) return false;
    const adapter = ADAPTERS[classification.adapter];
    const hasHandler = typeof settings.handler === 'function';
    const isExecutable = hasHandler || typeof adapter?.execute === 'function';
    const statusSupportsAction = classification.status === STATUS.available
      || classification.status === STATUS.alternative;
    if (statusSupportsAction && isExecutable) {
      return true;
    }
    const missingExecution = statusSupportsAction && !isExecutable;
    const unsupported = Object.freeze({
      supported: false,
      status: classification.status,
      reason: missingExecution
        ? '操作の実処理が接続されていません'
        : classification.reason || 'この環境では操作できません',
      nextAction: (missingExecution ? settings.nextAction : classification.nextAction)
        || classification.route?.reason
        || (missingExecution
          ? '画面を閉じ、実処理が接続された対応画面からやり直してください'
          : '操作を閉じて対応する画面を開いてください'),
      route: classification.route,
    });
    if (settings.development === false) return unsupported;
    const actionId = settings.actionId ? ` (${settings.actionId})` : '';
    const error = new Error(
      !isExecutable && (classification.status === STATUS.available || classification.status === STATUS.alternative)
        ? `visible action${actionId} has no executable handler or adapter: ${classification.adapter}`
        : `visible action${actionId} requires available/alternative capability: `
          + `${app}/${environment}/${capability}=${classification.status}`,
    );
    error.meldexCapabilityResult = unsupported;
    throw error;
  }

  return Object.freeze({
    STATUS,
    APPS,
    ENVIRONMENTS,
    CAPABILITIES,
    ADAPTERS: Object.freeze(ADAPTERS),
    classify,
    getProfile,
    supports,
    assertVisibleAction,
    validateDefinition,
  });
});
