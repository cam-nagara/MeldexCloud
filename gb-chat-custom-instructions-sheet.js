/* Custom instructions through Sheet form */

const CHAT_CUSTOM_INSTRUCTIONS_DB_NAME = 'カスタムインストラクション';
const CHAT_CUSTOM_INSTRUCTIONS_ROLE = 'chat-custom-instructions';

function _chatCustomInstructionPropertyTypes() {
  return {
    設定名: { type: 'text' },
    利用範囲: { type: 'select', options: ['全体', '現在のソースフォルダ'] },
    私について: { type: 'long-text' },
    '作品・ジャンル・読者': { type: 'long-text' },
    回答方針: { type: 'long-text' },
    '口調・文体': { type: 'long-text' },
    '好み・避けたいこと': { type: 'long-text' },
    必ず確認してほしいこと: { type: 'long-text' },
    その他の指示: { type: 'long-text' },
  };
}

function _chatCustomInstructionFormConfig() {
  return {
    id: 'meldex-chat-custom-instructions-form',
    fields: ['設定名', '利用範囲', '私について', '作品・ジャンル・読者', '回答方針', '口調・文体', '好み・避けたいこと', '必ず確認してほしいこと', 'その他の指示'],
    required: ['利用範囲'],
    descriptions: {
      利用範囲: 'Meldex全体で使う指示か、現在のソースフォルダだけで使う指示かを選びます。',
      私について: '役割、創作ジャンル、作業スタイル、前提知識など。',
      '作品・ジャンル・読者': '扱っている作品、ジャンル、想定読者、媒体、制約など。',
      回答方針: '提案時に重視してほしい観点、確認の深さ、避けたい判断など。',
      '口調・文体': '返答の文体、呼び方、説明の粒度、箇条書きの好みなど。',
      '好み・避けたいこと': '好きな方向性、避けたい表現、NG例など。',
      必ず確認してほしいこと: '毎回チェックしてほしい整合性、世界観、制約、作業ルールなど。',
      その他の指示: '上の項目に入らない常時指示。',
    },
    placeholders: {
      設定名: '例: 長期連載プロット相談用',
      私について: '例: 長編作品や企画の構成を作っています。',
      回答方針: '例: まず矛盾やリスクを指摘し、その後で代案を出してください。',
    },
    labels: {},
    submitLabel: 'カスタムインストラクションに反映',
    successMessage: 'カスタムインストラクションに反映しました。',
    headerTitle: 'チャット用カスタムインストラクション',
    headerDescription: 'チャットで常に考慮してほしい前提や応答方針を項目別に入力します。',
    mode: 'answer',
    entityNameProp: '設定名',
    customInstructionsRelay: true,
  };
}

function _chatCustomInstructionViewConfig() {
  return {
    currentViewIdx: 0,
    propertyTypes: _chatCustomInstructionPropertyTypes(),
    savedViews: [
      { name: '入力フォーム', viewMode: 'form', typeSpecific: { form: { formConfig: _chatCustomInstructionFormConfig() } } },
    ],
  };
}

function _chatCustomInstructionDbNotePath(dbPath) {
  const name = String(dbPath || CHAT_CUSTOM_INSTRUCTIONS_DB_NAME).split('/').pop() || CHAT_CUSTOM_INSTRUCTIONS_DB_NAME;
  return String(dbPath || CHAT_CUSTOM_INSTRUCTIONS_DB_NAME).replace(/\/$/, '') + '/' + name + '.md';
}

async function _chatCustomInstructionNoteExists(dbPath) {
  try {
    await apiFetch('/file?path=' + encodeURIComponent(_chatCustomInstructionDbNotePath(dbPath)));
    return true;
  } catch (_) {
    return false;
  }
}

function _applyChatCustomInstructionViewConfig(dbPath) {
  try {
    const key = typeof getDbViewConfigStorageKey === 'function'
      ? getDbViewConfigStorageKey(dbPath)
      : 'dbViewConfig:' + dbPath;
    const current = JSON.parse(localStorage.getItem(key) || '{}') || {};
    localStorage.setItem(key, JSON.stringify({ ...current, ..._chatCustomInstructionViewConfig() }));
  } catch (_) {}
}

async function _saveChatCustomInstructionMetadata(dbPath) {
  await apiPut('/db-metadata?path=' + encodeURIComponent(dbPath), {
    type: 'settings-db',
    category: CHAT_CUSTOM_INSTRUCTIONS_DB_NAME,
    roles: [CHAT_CUSTOM_INSTRUCTIONS_ROLE],
    property_types: _chatCustomInstructionPropertyTypes(),
  });
}

async function ensureChatCustomInstructionSheet() {
  let dbPath = CHAT_CUSTOM_INSTRUCTIONS_DB_NAME;
  let metadataSaved = false;
  if (!await _chatCustomInstructionNoteExists(dbPath)) {
    try {
      await _saveChatCustomInstructionMetadata(dbPath);
      metadataSaved = true;
    } catch (_) {
      const res = await apiPost('/outliner/add', { type: 'database', label: CHAT_CUSTOM_INSTRUCTIONS_DB_NAME, parent: '' });
      dbPath = res?.node?.path || dbPath;
    }
  }
  if (!metadataSaved) await _saveChatCustomInstructionMetadata(dbPath);
  _applyChatCustomInstructionViewConfig(dbPath);
  document.querySelector('.modal-overlay[data-settings-modal="1"]')?.remove();
  if (typeof refreshOutliner === 'function') refreshOutliner();
  if (typeof selectDatabase === 'function') await selectDatabase(dbPath, undefined, { silent: true });
  if (typeof showStatus === 'function') showStatus('カスタムインストラクション入力フォームを開きました');
  return dbPath;
}

function _chatCustomInstructionSection(label, value) {
  const text = String(value || '').trim();
  return text ? `【${label}】\n${text}` : '';
}

function _setChatCustomInstructionValue(key, value) {
  const text = String(value || '').trim();
  if (text) localStorage.setItem(key, text);
  else localStorage.removeItem(key);
}

async function applyChatCustomInstructionsFromForm(fields, cfg) {
  const data = fields || {};
  const about = [
    _chatCustomInstructionSection('私について', data['私について']),
    _chatCustomInstructionSection('作品・ジャンル・読者', data['作品・ジャンル・読者']),
    _chatCustomInstructionSection('好み・避けたいこと', data['好み・避けたいこと']),
  ].filter(Boolean).join('\n\n');
  const instructions = [
    _chatCustomInstructionSection('回答方針', data['回答方針']),
    _chatCustomInstructionSection('口調・文体', data['口調・文体']),
    _chatCustomInstructionSection('必ず確認してほしいこと', data['必ず確認してほしいこと']),
    _chatCustomInstructionSection('その他の指示', data['その他の指示']),
  ].filter(Boolean).join('\n\n');
  const wantsSource = String(data['利用範囲'] || '').trim() === '現在のソースフォルダ';
  const source = typeof _chatSourceFolderValue === 'function' ? _chatSourceFolderValue() : '';
  const suffix = wantsSource && source ? ':' + encodeURIComponent(source) : '';
  _setChatCustomInstructionValue('chat-custom-about' + suffix, about);
  _setChatCustomInstructionValue('chat-custom-instructions' + suffix, instructions);
  if (typeof showStatus === 'function') {
    showStatus(suffix ? 'ソースフォルダ用カスタムインストラクションを反映しました' : '全体用カスタムインストラクションを反映しました');
  }
  return { ok: true, scope: suffix ? 'source' : 'global', formConfig: cfg || null };
}

window.ensureChatCustomInstructionSheet = ensureChatCustomInstructionSheet;
window.applyChatCustomInstructionsFromForm = applyChatCustomInstructionsFromForm;
