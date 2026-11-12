/* gb-scriptnote-template-picker.js: シナリオのテンプレート選択（共通のサムネイル選択画面）。
 *
 * ツールバーのテンプレートボタン・管理ボタン・モバイル編集バーのどこから開いても、この画面を使う。
 * 適用は従来の #scenario-note-layout-select の change 経路（取り消し記録・再描画込み）へ渡す。
 * 自分のテンプレートの保存・複製・並べ替え・削除は既存の保存処理（設定の取り消し記録つき）を使う。
 */
(function initScriptNoteTemplatePicker(global) {
  'use strict';

  const BUILTIN = [
    { id: 'manga', name: 'マンガシナリオ', description: 'ページとコマで区切り、セリフ・ト書き・モノローグを書き分けるマンガ向けの書式。',
      sample: [['h2', 'P1'], ['line', 'コマ1　教室・放課後'], ['line', 'ト書き：窓の外を見る主人公'], ['say', '主人公「……まだ帰らないの？」'], ['line', 'コマ2'], ['say', 'ヒロイン「もう少しだけ」']] },
    { id: 'drama', name: 'ドラマ・映画シナリオ', description: '柱（場所・時間）、ト書き、台詞で構成する映像向けの書式。',
      sample: [['h2', '○ 駅前・夜'], ['line', '　雨が降っている。'], ['say', '主人公「待った？」'], ['say', 'ヒロイン「ううん、今来たところ」'], ['line', '　二人、歩き出す。']] },
    { id: 'afureko', name: 'アフレコシナリオ', description: 'タイムと役名を左に置き、収録で読みやすい台詞の並びにする書式。',
      sample: [['h2', 'Aパート'], ['say', '00:12　主人公　行くぞ！'], ['say', '00:15　相棒　　おう！'], ['line', '00:18　（SE：爆発音）'], ['say', '00:20　主人公　間に合え……！']] },
    { id: 'stage', name: '舞台シナリオ', description: '場・登場人物・台詞・動作の指示（ト書き）を舞台上演向けに並べる書式。',
      sample: [['h2', '第一場　公園'], ['line', '（明転。ベンチに主人公）'], ['say', '主人公　ここに来るのも久しぶりだ。'], ['line', '（ヒロイン、上手より登場）'], ['say', 'ヒロイン　やっぱりここにいた。']] },
  ];

  function readCustom() {
    const names = typeof global._snToolPresetNames === 'function'
      ? global._snToolPresetNames(global.SN2_TEMPLATE_STORAGE_KEY || 'sn2-templates', global.SN2_TEMPLATE_ORDER_STORAGE_KEY || 'sn2-templates-order')
      : [];
    const data = typeof global._snToolReadJsonObject === 'function' ? global._snToolReadJsonObject('sn2-templates') : {};
    return names.filter(name => Object.prototype.hasOwnProperty.call(data, name)).map(name => ({ name, value: data[name] || {} }));
  }

  function renderSample(host, sample, options = {}) {
    const page = document.createElement('div');
    page.className = 'gb-tpl-doc';
    if (options.vertical) {
      page.style.writingMode = 'vertical-rl';
      page.style.padding = '7% 8%';
    }
    sample.forEach(([kind, text]) => {
      const row = document.createElement('div');
      row.className = kind === 'h2' ? 'gb-tpl-doc-h2' : 'gb-tpl-doc-line';
      if (kind === 'say') row.style.fontWeight = '600';
      row.textContent = text;
      page.appendChild(row);
    });
    host.appendChild(page);
  }

  // 名前入力ダイアログを二重に開かない（連打・二度押し対策）。
  function nameDialogOpen() {
    return !!document.querySelector('[data-e2e-id="scriptnote-name-overlay"]');
  }

  function items() {
    const builtins = BUILTIN.map(item => ({
      id: item.id, name: item.name, description: item.description, builtin: true, badge: '初期搭載',
      category: 'builtin', categoryLabel: '初期搭載',
      renderThumbnail: host => renderSample(host, item.sample),
    }));
    const custom = readCustom().map(({ name, value }) => {
      const base = BUILTIN.find(item => item.id === value.layoutMode) || BUILTIN[0];
      const vertical = (value.editor?.viewMode || value.viewMode || value.rubyPresentation?.writingMode) === 'vertical';
      return {
        id: 'custom:' + name, name, builtin: false, badge: 'カスタム', category: 'custom', categoryLabel: 'カスタム',
        description: `「${base.name}」をもとにした書式${vertical ? '（縦書き）' : ''}。タイプの書式とエディタ設定を保存しています。`,
        renderThumbnail: host => renderSample(host, base.sample, { vertical }),
      };
    });
    return [...builtins, ...custom];
  }

  function install() {
    // class 宣言はwindowのプロパティにならないため、素の識別子で参照する。
    const Component = typeof ScriptNoteComponent !== 'undefined' ? ScriptNoteComponent : global.ScriptNoteComponent;
    if (!Component?.prototype || Component.prototype._showTemplatePicker) return;

    Component.prototype._currentTemplateId = function currentTemplateId() {
      const select = this.el?.querySelector('#scenario-note-layout-select');
      return select?.value || this._editor?.doc?.layoutMode || 'manga';
    };

    Component.prototype._syncTemplateButton = function syncTemplateButton() {
      const button = this.el?.querySelector('[data-sn-action="templatePicker"]');
      if (!button) return;
      const id = this._currentTemplateId();
      const label = id.startsWith('custom:') ? id.slice(7) : (BUILTIN.find(item => item.id === id)?.name || 'テンプレート');
      const text = button.querySelector('.sn2-template-button-label');
      if (text) text.textContent = label;
      button.title = `テンプレート: ${label}`;
      button.setAttribute('aria-label', `テンプレート: ${label}`);
    };

    Component.prototype._showTemplatePicker = function showTemplatePicker() {
      if (!global.MeldexTemplatePicker) {
        if (typeof global.showStatus === 'function') global.showStatus('テンプレート選択画面を読み込めませんでした', true);
        return false;
      }
      this._refreshTemplateSelect?.();
      const cfgKind = 'template';
      const custom = item => !item.builtin;
      const nameOf = item => item.id.slice(7);
      const after = ctx => { ctx.refresh(items()); this._syncTemplateButton(); };
      global.MeldexTemplatePicker.open({
        id: 'scriptnote-templates',
        title: 'シナリオテンプレート',
        items: items(),
        selectedId: this._currentTemplateId(),
        currentId: this._currentTemplateId(),
        primaryAction: {
          label: '適用',
          when: () => !!this._editor?.doc,
          run: item => {
            const select = this.el?.querySelector('#scenario-note-layout-select');
            if (!select || !this._editor?.doc) throw new Error('シナリオを開いてから適用してください');
            if (![...select.options].some(option => option.value === item.id)) this._refreshTemplateSelect?.();
            select.value = item.id;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            this._syncTemplateButton();
            if (typeof global.showStatus === 'function') global.showStatus(`テンプレート「${item.name}」を適用しました`);
            return true;
          },
        },
        itemActions: [
          { label: '複製', when: custom, e2eId: 'scriptnote-templates-duplicate', run: (item, ctx) => {
            if (nameDialogOpen()) return false;
            this._duplicateManagedPreset(cfgKind, nameOf(item), () => after(ctx));
            return false;
          } },
          { label: '前へ', when: custom, e2eId: 'scriptnote-templates-up', run: (item, ctx) => {
            this._moveManagedPreset(cfgKind, nameOf(item), -1, () => after(ctx));
            ctx.select(item.id);
            return false;
          } },
          { label: '後へ', when: custom, e2eId: 'scriptnote-templates-down', run: (item, ctx) => {
            this._moveManagedPreset(cfgKind, nameOf(item), 1, () => after(ctx));
            ctx.select(item.id);
            return false;
          } },
          { label: '削除', danger: true, when: custom, e2eId: 'scriptnote-templates-delete', run: async (item, ctx) => {
            await this._deleteManagedPreset(cfgKind, nameOf(item), () => after(ctx));
            return false;
          } },
        ],
      });
      return true;
    };
  }

  // 取り消し・やり直しで書式が戻った時、ツールバーの表示（隠れた選択欄とボタン）を本体へ合わせる。
  global.addEventListener?.('meldex:scriptnote-history-restored', event => {
    const editor = event?.detail?.editor;
    const layoutMode = editor?.doc?.layoutMode;
    if (!layoutMode || !editor?.host) return;
    const roots = [...document.querySelectorAll('[data-sn-action="templatePicker"]')]
      .map(button => button.closest('.gb-pane-content, [data-pane-id], .tab-content') || button.parentElement?.parentElement)
      .filter(root => root && root.contains(editor.host));
    roots.forEach(root => {
      const select = root.querySelector('#scenario-note-layout-select');
      if (select && [...select.options].some(option => option.value === layoutMode)) select.value = layoutMode;
      const button = root.querySelector('[data-sn-action="templatePicker"]');
      const label = BUILTIN.find(item => item.id === (select?.value || layoutMode))?.name
        || (String(select?.value || '').startsWith('custom:') ? select.value.slice(7) : 'テンプレート');
      const text = button?.querySelector('.sn2-template-button-label');
      if (text) text.textContent = label;
      button?.setAttribute('title', `テンプレート: ${label}`);
      button?.setAttribute('aria-label', `テンプレート: ${label}`);
    });
  });

  install();
  global.MeldexScriptNoteTemplatePicker = Object.freeze({ install, builtins: () => BUILTIN.map(item => ({ ...item })) });
}(typeof globalThis !== 'undefined' ? globalThis : window));
