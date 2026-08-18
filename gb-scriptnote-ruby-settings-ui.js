/* gb-scriptnote-ruby-settings-ui.js: shared RubyPresentation settings UI */
(function (global) {
  'use strict';

  const MODEL = () => global.MeldexRubyPresentation;
  const FIELD_DEFS = Object.freeze([
    { key: 'writingMode', label: '書字方向', type: 'select', options: [['horizontal', '横書き'], ['vertical', '縦書き']] },
    { key: 'sizePercent', label: 'サイズ（親文字比%）', type: 'number', min: 5, max: 200, step: 5, unit: '%' },
    { key: 'gapEm', label: '親文字との間隔', type: 'number', min: -2, max: 4, step: 0.05, unit: 'em' },
    { key: 'letterSpacingEm', label: 'ルビの字間', type: 'number', min: -2, max: 3, step: 0.05, unit: 'em' },
    { key: 'lineHeight', label: 'ルビ行の行間', type: 'number', min: 0.5, max: 5, step: 0.1, unit: '倍' },
    { key: 'align', label: '配置方法', type: 'select', options: [['center', '中付き'], ['start', '肩付き']] },
    { key: 'smallKana', label: '小書き仮名', type: 'select', options: [['keep', '小書きのまま'], ['fullsize', '直音に変換']] },
    { key: 'fontPreset', label: 'ルビ用フォント', type: 'select', options: [['inherit', '本文と同じ'], ['sans-jp', '日本語ゴシック'], ['serif-jp', '日本語明朝'], ['gothic-jp', '読みやすいゴシック']] },
    { key: 'defaultStyle', label: 'ルビ種類', type: 'select', options: [['group', 'グループ'], ['mono', 'モノ'], ['jukugo', '熟語']] },
  ]);

  function numberValue(raw) {
    if (typeof raw === 'number') return raw;
    const parsed = Number(String(raw ?? '').trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  function controlValue(control, def) {
    if (def.type !== 'number') return String(control.value || '');
    return numberValue(control.value);
  }

  function makeOption(value, label, current) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = value === current;
    return option;
  }

  function refreshControl(control, def, presentation) {
    const value = presentation?.[def.key];
    control.value = value == null ? '' : String(value);
  }

  function syncWritingModeButtons(editor, presentation) {
    const root = editor?.host?.closest?.('.gb-scriptnote-root');
    if (!root?.querySelector) return;
    root.querySelector('#btn-horizontal')?.classList.toggle('active', presentation.writingMode === 'horizontal');
    root.querySelector('#btn-vertical')?.classList.toggle('active', presentation.writingMode === 'vertical');
  }

  function createField(editor, def, scope) {
    const row = document.createElement('label');
    row.className = 'sn2-ruby-field sn2-ruby-presentation-field';
    const label = document.createElement('span');
    label.className = 'sn2-ruby-field-label';
    label.textContent = def.label;
    row.appendChild(label);

    const control = document.createElement(def.type === 'select' ? 'select' : 'input');
    control.className = def.type === 'select'
      ? 'gb-select gb-select-sm sn2-ruby-presentation-control'
      : 'gb-num-input sn2-ruby-number-input sn2-ruby-presentation-control';
    control.dataset.rubyPresentationField = def.key;
    control.dataset.e2eId = `${scope}-ruby-${def.key}`;
    control.setAttribute('aria-label', def.label);
    control.title = def.label;
    if (def.type === 'select') {
      def.options.forEach(([value, text]) => control.appendChild(makeOption(value, text, '')));
    } else {
      control.type = 'number';
      control.min = String(def.min);
      control.max = String(def.max);
      control.step = String(def.step);
    }
    refreshControl(control, def, MODEL().ensureDocument(editor.doc));
    control.addEventListener('change', () => {
      const nextValue = controlValue(control, def);
      if (nextValue === null) {
        refreshControl(control, def, MODEL().ensureDocument(editor.doc));
        return;
      }
      editor._pushUndo?.(`ルビ${def.label}変更`);
      const presentation = MODEL().updateDocument(editor.doc, { [def.key]: nextValue });
      syncWritingModeButtons(editor, presentation);
      editor._render?.();
      editor._markDirty?.({ skipUndo: true });
      try {
        global.dispatchEvent?.(new CustomEvent('meldex:ruby-presentation-change', {
          detail: { doc: editor.doc, field: def.key },
        }));
      } catch (_) {}
    });
    row.appendChild(control);
    if (def.unit) {
      const unit = document.createElement('span');
      unit.className = 'sn2-ruby-unit';
      unit.textContent = def.unit;
      row.appendChild(unit);
    }
    return { row, control };
  }

  function createEditorSettings(editor, options = {}) {
    if (!editor?.doc || !MODEL()) return document.createElement('div');
    const scope = String(options.scope || 'scriptnote');
    const root = document.createElement('div');
    root.className = 'sn2-ruby-settings sn2-ruby-presentation-settings';
    root.dataset.rubyPresentationScope = scope;
    const controls = new Map();
    FIELD_DEFS.forEach(def => {
      const built = createField(editor, def, scope);
      controls.set(def.key, built.control);
      root.appendChild(built.row);
    });
    const compatibility = MODEL().ensureDocument(editor.doc).compatibility;
    if (compatibility?.useLegacySize || compatibility?.useLegacyGap) {
      const note = document.createElement('p');
      note.className = 'sn2-ruby-compatibility-note';
      note.dataset.e2eId = `${scope}-ruby-legacy-compatibility`;
      note.innerHTML = `旧文書の見た目を維持中です ${fieldHelp('サイズまたは間隔を変更すると、その項目だけ新しい方式へ切り替わります', { e2eId: `${scope}-ruby-legacy-help` })}`;
      root.appendChild(note);
    }
    const refresh = event => {
      if (root.isConnected === false) {
        global.removeEventListener?.('meldex:ruby-presentation-change', refresh);
        return;
      }
      if (event?.detail?.doc && event.detail.doc !== editor.doc) return;
      const presentation = MODEL().ensureDocument(editor.doc);
      FIELD_DEFS.forEach(def => refreshControl(controls.get(def.key), def, presentation));
    };
    global.addEventListener?.('meldex:ruby-presentation-change', refresh);
    return root;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]));
  }

  function globalSettingsHtml() {
    const values = MODEL().getGlobalDefaults();
    const fields = FIELD_DEFS.map(def => {
      const attrs = `data-ruby-presentation-global-field="${esc(def.key)}" data-onchange="_meldexRubyPresentationGlobalChanged(this)" aria-label="${esc(def.label)}" title="${esc(def.label)}"`;
      let control;
      if (def.type === 'select') {
        const options = def.options.map(([value, label]) => `<option value="${esc(value)}"${values[def.key] === value ? ' selected' : ''}>${esc(label)}</option>`).join('');
        control = `<select class="gb-select gb-select-sm sn2-ruby-presentation-control" ${attrs}>${options}</select>`;
      } else {
        control = `<input type="number" class="cs-width-input cs-number-input sn2-ruby-presentation-control" min="${esc(def.min)}" max="${esc(def.max)}" step="${esc(def.step)}" value="${esc(values[def.key])}" ${attrs}>`;
      }
      return `<label class="cs-row-group cs-row-group--number sn2-ruby-presentation-global-field"><span class="cs-row-group-label">${esc(def.label)}</span>${control}${def.unit ? `<span class="cs-number-unit">${esc(def.unit)}</span>` : ''}</label>`;
    }).join('');
    return `<div class="cs-row cs-row--ruby-presentation"><span class="cs-row-label">ルビ表示</span><div class="sn2-ruby-presentation-global" data-e2e-id="settings-ruby-presentation-defaults">${fields}</div></div>`;
  }

  function globalChanged(control) {
    const key = control?.dataset?.rubyPresentationGlobalField;
    const def = FIELD_DEFS.find(item => item.key === key);
    if (!def) return;
    const value = controlValue(control, def);
    if (value === null) {
      control.value = String(MODEL().getGlobalDefaults()[key]);
      return;
    }
    const next = MODEL().setGlobalDefaults({ [key]: value });
    control.value = String(next[key]);
  }

  global.MeldexRubySettingsUI = Object.freeze({
    FIELD_DEFS,
    createEditorSettings,
    globalSettingsHtml,
  });
  global._meldexRubyPresentationGlobalChanged = globalChanged;
})(typeof window !== 'undefined' ? window : globalThis);
