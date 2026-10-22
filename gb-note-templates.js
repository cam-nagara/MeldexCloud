/* Reusable Markdown notes. Sheet defaults are durable snapshots of a template. */
(function () {
  'use strict';
  const key = 'meldex-note-templates-v1';
  const endpoint = '/personal-preferences/note-templates';
  const clone = value => JSON.parse(JSON.stringify(value));
  function currentContent(editor) {
    const markdown = typeof _noteMarkdownFromEditorNonDestructive === 'function' ? _noteMarkdownFromEditorNonDestructive(editor) : htmlToMd(editor.innerHTML);
    const frontmatter = editor.dataset.frontmatter || '';
    return frontmatter && markdown.startsWith(frontmatter) ? markdown.slice(frontmatter.length) : markdown;
  }
  function validate(value) {
    if (!value || value.schemaVersion !== 1 || typeof value.name !== 'string'
      || !value.name.trim() || typeof value.content !== 'string'
      || typeof value.id !== 'string' || !value.id.trim()) throw new Error('未対応または不正なノートテンプレートです');
    return clone(value);
  }
  function validateList(templates) {
    if (!Array.isArray(templates)) throw new Error('ノートテンプレート一覧が不正です');
    const result = templates.map(validate);
    if (new Set(result.map(item => item.id)).size !== result.length) throw new Error('ノートテンプレートのIDが重複しています');
    return result;
  }
  async function load(options = {}) {
    const remote = options.deviceOnly ? { available: false } : await apiFetch(endpoint, { silentError: true }).catch(error => {
      if (window.MeldexStandaloneFS && Number(error.status || error.statusCode || error.response?.status) === 404) return { available: false };
      throw error;
    });
    if (remote.available) {
      if (remote.payload && remote.payload.schemaVersion !== 1) throw new Error('未対応のノートテンプレート一覧です');
      const templates = validateList(remote.payload ? remote.payload.templates : []);
      return { templates, payload: remote.payload, remote: true, revision: remote.revision, deviceAvailable: localStorage.getItem(key) != null };
    }
    const storageRevision = localStorage.getItem(key);
    const saved = JSON.parse(storageRevision || '{"templates":[]}');
    if (saved.schemaVersion != null && saved.schemaVersion !== 1 || !Array.isArray(saved.templates)) throw new Error('未対応または不正なノートテンプレート一覧です');
    return { templates: validateList(saved.templates), payload: saved, remote: false, storageRevision };
  }
  async function persist(library, templates) {
    if (library.remote) {
      const result = await apiFetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: { ...library.payload, schemaVersion: 1, templates }, expectedRevision: library.revision || null }) });
      if (!result.ok) throw new Error('テンプレートを保存できませんでした。一覧を開き直してください');
      library.revision = result.revision;
    } else {
      const write = () => {
        if (localStorage.getItem(key) !== library.storageRevision) throw new Error('テンプレート一覧が変更されています。開き直してください');
        const text = JSON.stringify({ ...library.payload, schemaVersion: 1, templates }); localStorage.setItem(key, text); library.storageRevision = text;
      };
      if (navigator.locks?.request) await navigator.locks.request(key, write); else write();
    }
    library.templates = templates;
  }
  function button(label, run) {
    const el = document.createElement('button'); el.type = 'button'; el.className = 'gb-btn'; el.textContent = label;
    el.addEventListener('click', run); return el;
  }
  function confirmAction(message) {
    if (!window.MeldexStandaloneFS) return cfConfirm(message);
    return new Promise(resolve => {
      let accepted = false;
      const body = document.createElement('p'); body.textContent = message;
      const cancel = button('キャンセル', () => modal.close('cancel'));
      const accept = button('決定', () => { accepted = true; modal.close('confirm'); });
      const modal = GBUI.createModal({ title: '確認', body, footer: [cancel, accept],
        variant: 'standard', initialFocus: cancel, onClose: () => resolve(accepted) });
      modal.open();
    });
  }
  async function show(options = {}) {
    const editor = options.editor || document.getElementById('page-content');
    const path = editor?.dataset.path;
    // Capture the source before the asynchronous library read can switch the active file.
    const sourceContent = options.registerCurrent && editor ? currentContent(editor) : '';
    const sourceName = String(path || '').split(/[\\/]/).pop()?.replace(/\.md$/i, '') || 'ノート';
    const library = await load({ deviceOnly: options.deviceOnly });
    const metadata = options.dbPath ? await apiFetch('/db-metadata?path=' + encodeURIComponent(options.dbPath)) : null;
    const body = document.createElement('div'); body.className = 'note-template-dialog';
    const select = document.createElement('select'); select.className = 'gb-select'; select.setAttribute('aria-label', 'ノートテンプレート');
    const name = document.createElement('input'); name.className = 'gb-input'; name.setAttribute('aria-label', 'テンプレート名');
    const content = document.createElement('textarea'); content.className = 'gb-input'; content.rows = 12;
    content.style.cssText = 'width:100%;height:240px;min-height:160px;box-sizing:border-box;resize:vertical'; content.setAttribute('aria-label', 'テンプレート本文（Markdown）');
    const status = document.createElement('p'); status.setAttribute('role', 'status');
    const help = document.createElement('p'); help.textContent = options.dbPath
      ? 'このシートで今後作成するトピックに、選択したノートの内容をコピーします。既存トピックは変更しません。'
      : '現在のノートから登録できます。本文はMarkdownで編集できます。';
    body.append(help, GBUI.createField({ label: 'ノートテンプレート', input: select }),
      GBUI.createField({ label: 'テンプレート名', input: name }),
      GBUI.createField({ label: 'テンプレート本文（Markdown）', input: content }), status);
    const location = document.createElement('p'); location.textContent = '保存先: ' + (library.remote ? '個人設定' : 'この端末'); body.prepend(location);
    const fill = id => {
      select.replaceChildren(new Option('新しいテンプレート', ''));
      library.templates.forEach(item => select.add(new Option(item.name, item.id)));
      select.value = id || '';
    };
    fill();
    if (options.registerCurrent) { name.value = sourceName; content.value = sourceContent; }
    select.addEventListener('change', () => {
      const item = library.templates.find(item => item.id === select.value);
      name.value = item?.name || ''; content.value = item?.content || '';
    });
    let busy = false;
    const run = fn => async () => {
      if (busy) return; busy = true; status.textContent = '';
      const controls = [...modal.modal.querySelectorAll('input,textarea,select,button')].map(control => [control, control.disabled]);
      controls.forEach(([control]) => { control.disabled = true; });
      try { await fn(); } catch (error) { status.textContent = error.userMessage || error.message; }
      finally { busy = false; controls.forEach(([control, disabled]) => { control.disabled = disabled; }); }
    };
    const save = button('テンプレートを保存', run(async () => {
      const item = validate({ ...library.templates.find(item => item.id === select.value), schemaVersion: 1,
        id: select.value || crypto.randomUUID(), name: name.value.trim(), content: content.value });
      if (library.templates.some(other => other.name === item.name && other.id !== item.id)) throw new Error('同名のテンプレートがあります');
      await persist(library, [...library.templates.filter(other => other.id !== item.id), item]); fill(item.id); status.textContent = '保存しました';
    }));
    const remove = button('テンプレートを削除', run(async () => {
      if (!select.value) return;
      if (!await confirmAction('選択したノートテンプレートを削除しますか？')) return;
      await persist(library, library.templates.filter(item => item.id !== select.value));
      fill(); name.value = ''; content.value = ''; status.textContent = '削除しました';
    }));
    const use = button(options.dbPath ? 'シートに設定' : 'ノートに適用', run(async () => {
      const item = library.templates.find(item => item.id === select.value);
      if (!item) throw new Error('保存済みのテンプレートを選択してください');
      if (name.value.trim() !== item.name || content.value !== item.content) throw new Error('変更したテンプレートを保存してから適用してください');
      if (options.dbPath) {
        await saveSheetDefault(options.dbPath, item, metadata.schema_revision || 0);
      } else {
        if (!editor?.isConnected || editor.dataset.path !== path || editor.contentEditable === 'false') throw new Error('適用先のノートを開き直してください');
        if (!await confirmAction('ノート本文を選択したテンプレートに置き換えますか？')) return;
        if (!editor.isConnected || editor.dataset.path !== path || editor.contentEditable === 'false') throw new Error('適用先が変わりました');
        editor.focus(); const range = document.createRange(); range.selectNodeContents(editor);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        document.execCommand('insertHTML', false, mdToHtml(item.content, { basePath: path }));
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }
      modal.close('applied');
    }));
    const footer = [save, remove];
    if (library.deviceAvailable || options.deviceOnly) {
      footer.unshift(button(options.deviceOnly ? '個人設定のテンプレートに戻る' : 'この端末のテンプレートを開く', run(async () => {
        const item = library.templates.find(item => item.id === select.value);
        const dirty = name.value.trim() !== (item?.name || '') || content.value !== (item?.content || '');
        if (dirty && !await confirmAction('保存していないテンプレートの変更を破棄して保存先を切り替えますか？')) return;
        await modal.close('switched');
        await show({ ...options, deviceOnly: !options.deviceOnly, registerCurrent: false });
      })));
    }
    if (options.dbPath) {
      status.textContent = '設定中: ' + (metadata.note_template?.name || 'なし');
      footer.push(button('シートの設定を解除', run(async () => { await saveSheetDefault(options.dbPath, null, metadata.schema_revision || 0); modal.close('applied'); })));
    } else if (editor) {
      footer.unshift(button('現在のノートから作成', () => {
        select.value = ''; name.value = ''; content.value = currentContent(editor); name.focus();
      }));
    }
    footer.push(use);
    const modal = GBUI.createModal({ id: 'note-templates', title: options.dbPath ? 'シートのノートテンプレート' : options.registerCurrent ? 'テンプレートに登録' : 'ノートテンプレート',
      body, footer, variant: 'standard', geometryKey: 'note-templates', initialFocus: options.registerCurrent ? name : select,
      onBeforeClose: reason => !busy || reason === 'applied' || reason === 'switched' });
    modal.open();
  }
  async function saveSheetDefault(path, template, revision) {
    const payload = { note_template: template ? validate(template) : null };
    if (window.GbDbSchemaMutation?.saveMetadata) {
      await window.GbDbSchemaMutation.saveMetadata(path, payload, { dbPath: path, dbMetadata: { schema_revision: revision } });
    } else {
      await apiPut('/db-metadata?path=' + encodeURIComponent(path), { ...payload,
        expected_schema_revision: revision, operation_id: crypto.randomUUID() });
    }
    showStatus(template ? '新規トピックのノートテンプレートを設定しました' : 'ノートテンプレートの設定を解除しました');
  }
  window.MeldexNoteTemplates = Object.freeze({ show, load, validate });
})();
