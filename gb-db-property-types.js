/* gb-db-property-types.js: split loader stub */
if (typeof __loadSplitScript !== 'function') throw new Error('gb-split-loader.js is not loaded');
(function (global) {
  const types = [
    { type: 'text', label: 'テキスト', icon: 'alignLeft' },
    { type: 'number', label: '数値', icon: 'hash' },
    { type: 'select', label: 'セレクト', icon: 'tag' },
    { type: 'multi-select', label: 'マルチセレクト', icon: 'tags' },
    { type: 'checkbox', label: 'チェックボックス', icon: 'checkSquare' },
    { type: 'date', label: '日時', icon: 'calendar' },
    { type: 'url', label: 'URL', icon: 'globe' },
    { type: 'image', label: '画像', icon: 'image' },
    { type: 'relation', label: 'リレーション（単一）', icon: 'link2' },
    { type: 'multi-relation', label: 'リレーション（複数）', icon: 'link' },
    { type: 'user', label: 'ユーザー', icon: 'user' },
    { type: 'multi-user', label: 'マルチユーザー', icon: 'users' },
    { type: 'formula', label: '数式', icon: 'sigma' },
    { type: 'rollup', label: 'ロールアップ', icon: 'sigma' },
    { type: 'button', label: 'ボタン', icon: 'play' },
    { type: 'multi-source-relation', label: 'マルチソースリレーション', icon: 'database' },
    { type: 'chat', label: 'チャット', icon: 'messagesSquare' },
  ];
  global.PROPERTY_TYPES = Object.freeze(types.map(t => Object.freeze({ ...t })));
  global.getPropertyTypeDefinitions = function getPropertyTypeDefinitions() {
    return global.PROPERTY_TYPES.map(t => ({ ...t }));
  };
  global.getPropertyTypeDefinition = function getPropertyTypeDefinition(type) {
    return global.PROPERTY_TYPES.find(t => t.type === type) || null;
  };
  global.getPropertyTypeMenuItems = function getPropertyTypeMenuItems() {
    return global.getPropertyTypeDefinitions().filter(t => ![
      'multi-select',
      'multi-relation',
      'multi-user',
      'chat',
    ].includes(t.type));
  };
  global.getPropertyTypeIcon = function getPropertyTypeIcon(type) {
    return global.getPropertyTypeDefinition(type)?.icon || 'alignLeft';
  };
  global.getPropertyTypeLabel = function getPropertyTypeLabel(type) {
    return global.getPropertyTypeDefinition(type)?.label || type || 'テキスト';
  };
  global.getPropertyTypeUiBaseType = function getPropertyTypeUiBaseType(type) {
    if (type === 'multi-select') return 'select';
    if (type === 'multi-relation') return 'relation';
    if (type === 'multi-user') return 'user';
    if (type === 'chat') return 'text';
    return type || 'text';
  };
  global.getPropertyTypeMultiplicity = function getPropertyTypeMultiplicity(type) {
    return ['multi-select', 'multi-relation', 'multi-user'].includes(type) ? 'multiple' : 'single';
  };
  global.isPropertyTypeMultiplicityBase = function isPropertyTypeMultiplicityBase(type) {
    return ['select', 'relation', 'user'].includes(type);
  };
  global.composePropertyTypeFromUi = function composePropertyTypeFromUi(baseType, multiplicity) {
    const base = global.getPropertyTypeUiBaseType(baseType);
    if (multiplicity === 'multiple') {
      if (base === 'select') return 'multi-select';
      if (base === 'relation') return 'multi-relation';
      if (base === 'user') return 'multi-user';
    }
    return base || 'text';
  };
  global.renderPropertyTypeOptions = function renderPropertyTypeOptions(currentType) {
    const selectedType = global.getPropertyTypeUiBaseType(currentType || 'text');
    return global.getPropertyTypeMenuItems().map(t => {
      const selected = t.type === selectedType ? ' selected' : '';
      return '<option value="' + t.type + '"' + selected + '>' + t.label + '</option>';
    }).join('\n');
  };
})(window);
__loadSplitScript('gb-db-property-types.js', [
  'gb-db-property-types.part01.js',
  'gb-db-property-types.part02.js',
]);
