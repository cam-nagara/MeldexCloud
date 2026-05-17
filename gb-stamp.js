/* gb-stamp.js - chat stamp picker and inline rendering */

const STAMP_REGEX = /::stamp:([A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)*)::/g;

function _stampFallbackToEmoji(spec) {
  const raw = String(spec || '').replace(/^noto:/i, '').replace(/^emoji:/i, '').replace(/^twemoji:/i, '');
  if (typeof GBIconAssets !== 'undefined' && /^[0-9a-f_-]+$/i.test(raw)) {
    return GBIconAssets.codeToEmoji(raw) || '?';
  }
  return '?';
}

function stampToImg(spec, size) {
  const nextSize = size || 28;
  if (typeof GBIconAssets !== 'undefined') {
    return GBIconAssets.render(spec, nextSize, { className: 'stamp-rendered' });
  }
  return `<span class="stamp-rendered" style="font-size:${nextSize}px;vertical-align:middle;">${_stampFallbackToEmoji(spec)}</span>`;
}

function renderStamps(text) {
  return String(text || '').replace(STAMP_REGEX, (_, spec) => stampToImg(spec, 28));
}

function isStampOnly(text) {
  const value = String(text || '');
  const stripped = value.replace(STAMP_REGEX, '').trim();
  return stripped === '' && /::stamp:[A-Za-z0-9:_-]+::/.test(value);
}

const STAMP_COMMON_CODES = new Set([
  '1F44D', '1F44F', '1F44B', '1F44C', '1F64F', '1F91D', '1FAF6',
  '1F600', '1F602', '1F60D', '1F62D', '1F914', '1F973',
  '1F389', '2728', '1F525', '2705', '274C', '2757', '2764', '1F49C', '1F4AA',
]);

const STAMP_HEART_CODES = new Set(['2763', '2764', '1F48B', '1F48C', '1F5A4', '1F90D', '1F90E', '1FA75', '1FA76', '1FA77', '1FA79']);
const STAMP_REACTION_CODES = new Set(['261D', '2705', '270A', '270B', '270C', '270D', '2728', '274C', '2753', '2754', '2755', '2757', '1F389', '1F4AA', '1F4A2', '1F4A3', '1F4A4', '1F4AF', '1F525']);

function _stampBaseCode(item) {
  return String(item?.code || '').split('-')[0].toUpperCase();
}

function _stampBaseNumber(item) {
  const base = parseInt(_stampBaseCode(item), 16);
  return Number.isFinite(base) ? base : -1;
}

function _stampCodeIn(item, min, max) {
  const base = _stampBaseNumber(item);
  return base >= min && base <= max;
}

function _stampIsCommon(item) {
  return STAMP_COMMON_CODES.has(_stampBaseCode(item));
}

function _stampIsFace(item) {
  return _stampCodeIn(item, 0x1F600, 0x1F64F) || _stampCodeIn(item, 0x1FAE0, 0x1FAEF) || ['2639', '263A'].includes(_stampBaseCode(item));
}

function _stampIsReaction(item) {
  const base = _stampBaseCode(item);
  return _stampIsCommon(item)
    || STAMP_REACTION_CODES.has(base)
    || _stampCodeIn(item, 0x1F44A, 0x1F450)
    || _stampCodeIn(item, 0x1F64C, 0x1F64F)
    || _stampCodeIn(item, 0x1F90C, 0x1F91F)
    || _stampCodeIn(item, 0x1FAF0, 0x1FAF8);
}

function _stampIsHeart(item) {
  const base = _stampBaseNumber(item);
  return STAMP_HEART_CODES.has(_stampBaseCode(item)) || (base >= 0x1F493 && base <= 0x1F49F);
}

function _stampIsPersonOrHand(item) {
  return _stampCodeIn(item, 0x1F466, 0x1F487)
    || _stampCodeIn(item, 0x1F64B, 0x1F64F)
    || _stampCodeIn(item, 0x1F90C, 0x1F93F)
    || _stampCodeIn(item, 0x1F9B5, 0x1F9DF)
    || _stampCodeIn(item, 0x1FAF0, 0x1FAF8)
    || ['261D', '270A', '270B', '270C', '270D'].includes(_stampBaseCode(item));
}

function _stampIsFood(item) {
  return _stampCodeIn(item, 0x1F32D, 0x1F37F) || _stampCodeIn(item, 0x1F950, 0x1F96F) || _stampCodeIn(item, 0x1FAD0, 0x1FADF);
}

function _stampIsNature(item) {
  return _stampCodeIn(item, 0x1F300, 0x1F343)
    || _stampCodeIn(item, 0x1F400, 0x1F43F)
    || _stampCodeIn(item, 0x1F980, 0x1F9AE)
    || _stampCodeIn(item, 0x1FAB0, 0x1FABF)
    || _stampCodeIn(item, 0x2600, 0x26C5);
}

function _stampIsActivity(item) {
  return _stampCodeIn(item, 0x1F380, 0x1F3FF) || _stampCodeIn(item, 0x1FA70, 0x1FA8F) || ['26BD', '26BE', '26F3', '26F7', '26F8', '26F9'].includes(_stampBaseCode(item));
}

function _stampIsSymbol(item) {
  return _stampCodeIn(item, 0x2000, 0x2BFF) || _stampCodeIn(item, 0x1F170, 0x1F251) || _stampCodeIn(item, 0x1F500, 0x1F5FF) || _stampCodeIn(item, 0x1F7E0, 0x1F7EB);
}

function _stampIsOther(item) {
  return !(_stampIsCommon(item) || _stampIsFace(item) || _stampIsReaction(item) || _stampIsHeart(item)
    || _stampIsPersonOrHand(item) || _stampIsFood(item) || _stampIsNature(item) || _stampIsActivity(item) || _stampIsSymbol(item));
}

function _stampPickerSources() {
  return [
    { id: 'stamp-common', label: '定番', type: 'noto', filter: _stampIsCommon },
    { id: 'stamp-face', label: '表情', type: 'noto', filter: _stampIsFace },
    { id: 'stamp-reaction', label: '反応', type: 'noto', filter: _stampIsReaction },
    { id: 'stamp-heart', label: 'ハート', type: 'noto', filter: _stampIsHeart },
    { id: 'stamp-person', label: '人・手', type: 'noto', filter: _stampIsPersonOrHand },
    { id: 'stamp-food', label: '食べ物', type: 'noto', filter: _stampIsFood },
    { id: 'stamp-nature', label: '自然', type: 'noto', filter: _stampIsNature },
    { id: 'stamp-activity', label: '活動', type: 'noto', filter: _stampIsActivity },
    { id: 'stamp-symbol', label: '記号', type: 'noto', filter: _stampIsSymbol },
    { id: 'stamp-other', label: 'その他', type: 'noto', filter: _stampIsOther },
  ];
}

function renderStampsLarge(text) {
  return String(text || '').replace(STAMP_REGEX, (_, spec) => stampToImg(spec, 48));
}

function showStampPicker(targetInput, onSelect) {
  if (typeof GBIconAssets === 'undefined' || typeof GBIconAssets.openPicker !== 'function') return;
  document.querySelectorAll('.stamp-picker').forEach((picker) => picker.remove());
  GBIconAssets.openPicker({
    title: 'スタンプ',
    className: 'stamp-picker',
    anchorEl: targetInput,
    includeLucide: false,
    includeNoto: true,
    sources: _stampPickerSources(),
    defaultSource: 'stamp-common',
    hideAllTab: true,
    pageSize: 96,
    itemSize: 24,
    placeholder: 'スタンプを検索',
    onSelect: (spec) => {
      if (typeof onSelect === 'function') onSelect(GBIconAssets.normalizeSpec(spec));
    },
  });
}

function onStampBtnClick(inputId) {
  const input = document.getElementById(inputId);
  const btn = input?.parentElement?.querySelector('.stamp-btn');
  showStampPicker(btn || input, (spec) => {
    const stampText = '::stamp:' + spec + '::';
    if (input?.tagName === 'TEXTAREA') {
      const pos = input.selectionStart ?? input.value.length;
      input.value = input.value.slice(0, pos) + stampText + input.value.slice(pos);
      input.focus();
      input.selectionStart = input.selectionEnd = pos + stampText.length;
    }
  });
}

function onStampSend(inputId, sendFn) {
  const input = document.getElementById(inputId);
  const btn = input?.parentElement?.querySelector('.stamp-btn');
  showStampPicker(btn || input, (spec) => {
    if (!input) return;
    input.value = '::stamp:' + spec + '::';
    if (typeof sendFn === 'function') sendFn();
  });
}
