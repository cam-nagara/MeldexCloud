/* Standalone form definitions share sheet data and the topic-layout contract. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MeldexFormDocument = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  function parse(text) {
    const doc = typeof text === 'string' ? JSON.parse(text.replace(/^\uFEFF/, '')) : clone(text);
    if (!object(doc) || doc.fileType !== 'meldex-form') throw new Error('フォームファイルではありません');
    if (doc.schema_version !== 1) throw new Error('未対応のフォーム形式です。対応するMeldexで開いてください');
    if (Number(doc.formConfig?.schemaVersion) > 1 || Number(doc.layout?.formConfig?.schemaVersion) > 1)
      throw new Error('未対応のフォーム設定です。対応するMeldexで開いてください');
    if (!object(doc.sheet) || typeof doc.sheet.path !== 'string'
      || doc.layout != null && (!object(doc.layout) || !Array.isArray(doc.layout.cells))
      || doc.formConfig != null && !object(doc.formConfig)) throw new Error('フォームの定義が不正です');
    return doc;
  }
  function create(title = '無題') {
    return { fileType: 'meldex-form', schema_version: 1, title,
      sheet: { path: '' }, layout: null, formConfig: { mode: 'entry' } };
  }
  // A failed save retains both the draft and the original etag. Never retry a
  // conflict with the server's etag: that would overwrite another editor.
  class Store {
    constructor(doc, etag, write, changed = () => {}) {
      this.doc = parse(doc); this.etag = etag; this.write = write; this.changed = changed;
      this.revision = 0; this.savedRevision = 0; this.error = null; this.pending = null;
    }
    get dirty() { return this.revision !== this.savedRevision; }
    update(mutator) {
      const next = clone(this.doc);
      if (mutator(next) === false) return false;
      parse(next);
      if (JSON.stringify(next) === JSON.stringify(this.doc)) return false;
      this.doc = next; this.revision++; this.error = null; this.changed(this);
      return true;
    }
    async save() {
      if (this.pending) { await this.pending; return !this.error && (!this.dirty || this.save()); }
      if (!this.dirty) return true;
      const revision = this.revision, content = JSON.stringify(this.doc, null, 2);
      this.pending = (async () => {
        try {
          const result = await this.write(content, this.etag);
          if (!result?.etag) throw new Error('保存結果を確認できませんでした');
          this.etag = result.etag; this.savedRevision = revision; this.error = null;
        } catch (error) { this.error = error; }
      })();
      this.changed(this); await this.pending; this.pending = null; this.changed(this);
      return !this.error && (!this.dirty || this.save());
    }
  }
  return Object.freeze({ parse, create, Store, clone });
});
