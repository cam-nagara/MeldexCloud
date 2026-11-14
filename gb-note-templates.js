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
  // 本文のMarkdownから、サムネイル用の縮小ページを作る（見出し・箇条書き・チェック・本文を数行）。
  function renderDocThumbnail(content, host) {
    const page = document.createElement('div'); page.className = 'gb-tpl-doc';
    const lines = String(content || '').replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean).slice(0, 14);
    if (!lines.length) { const empty = document.createElement('div'); empty.className = 'gb-tpl-doc-line'; empty.textContent = '（本文なし）'; page.appendChild(empty); }
    lines.forEach(line => {
      const row = document.createElement('div');
      let text = line;
      if (/^#\s/.test(line)) { row.className = 'gb-tpl-doc-h1'; text = line.replace(/^#\s+/, ''); }
      else if (/^#{2,6}\s/.test(line)) { row.className = 'gb-tpl-doc-h2'; text = line.replace(/^#{2,6}\s+/, ''); }
      else if (/^[-*+]\s+\[[ xX]\]\s/.test(line)) { row.className = 'gb-tpl-doc-line gb-tpl-doc-check'; text = line.replace(/^[-*+]\s+\[[ xX]\]\s+/, ''); }
      else if (/^([-*+]|\d+\.)\s/.test(line)) { row.className = 'gb-tpl-doc-line gb-tpl-doc-bullet'; text = line.replace(/^([-*+]|\d+\.)\s+/, ''); }
      else { row.className = 'gb-tpl-doc-line'; }
      row.textContent = text.replace(/[*_`~]/g, '');
      page.appendChild(row);
    });
    host.appendChild(page);
  }
  // 名前と本文（Markdown）を編集する小さなダイアログ。保存したテンプレートを返す（取消は null）。
  function openEditor(library, initial, options = {}) {
    return new Promise(resolve => {
      let saved = null;
      let busy = false;
      const body = document.createElement('div'); body.className = 'note-template-dialog';
      const name = document.createElement('input'); name.className = 'gb-input'; name.setAttribute('aria-label', 'テンプレート名');
      const category = document.createElement('input'); category.className = 'gb-input'; category.setAttribute('aria-label', '分類');
      const content = document.createElement('textarea'); content.className = 'gb-input'; content.rows = 12;
      content.style.cssText = 'width:100%;height:240px;min-height:160px;box-sizing:border-box;resize:vertical'; content.setAttribute('aria-label', 'テンプレート本文（Markdown）');
      const status = document.createElement('p'); status.setAttribute('role', 'status');
      const location = document.createElement('p'); location.textContent = '保存先: ' + (library.remote ? '個人設定' : 'この端末');
      name.value = initial?.name || ''; category.value = initial?.categoryLabel || initial?.category || 'カスタム'; content.value = initial?.content || '';
      body.append(location, GBUI.createField({ label: 'テンプレート名', input: name }),
        GBUI.createField({ label: '分類', input: category }),
        GBUI.createField({ label: 'テンプレート本文（Markdown）', input: content }), status);
      const cancel = button('キャンセル', () => modal.close('cancel'));
      const save = button('テンプレートを保存', async () => {
        if (busy) return; busy = true; save.disabled = true; status.textContent = '';
        try {
          const previous = initial?.id ? library.templates.find(other => other.id === initial.id) : null;
          const now = new Date().toISOString();
          const categoryName = category.value.trim() || 'カスタム';
          const item = validate({ ...(previous || {}), schemaVersion: 1,
            id: initial?.id || crypto.randomUUID(), name: name.value.trim(), content: content.value,
            category: categoryName, categoryLabel: categoryName,
            createdAt: previous?.createdAt || now, updatedAt: now });
          if (library.templates.some(other => other.name === item.name && other.id !== item.id)) throw new Error('同名のテンプレートがあります');
          const exists = library.templates.some(other => other.id === item.id);
          await persist(library, exists ? library.templates.map(other => other.id === item.id ? item : other) : [...library.templates, item]);
          saved = item; status.textContent = '保存しました';
        } catch (error) { status.textContent = error.userMessage || error.message; }
        finally { busy = false; save.disabled = false; }
        if (saved) modal.close('saved');
      });
      save.classList.add('gb-btn-primary');
      const modal = GBUI.createModal({ id: 'note-template-editor', title: options.title || 'テンプレートの編集', body, footer: [cancel, save],
        variant: 'standard', geometryKey: 'note-template-editor', initialFocus: name, onBeforeClose: () => !busy, onClose: () => resolve(saved) });
      modal.open();
    });
  }
  async function show(options = {}) {
    const editor = options.editor || window.GBEditorHost?.element('page-content') || document.getElementById('page-content');
    const path = editor?.dataset.path;
    // Capture the source before the asynchronous library read can switch the active file.
    const sourceContent = options.registerCurrent && editor ? currentContent(editor) : '';
    const sourceName = String(path || '').split(/[\\/]/).pop()?.replace(/\.md$/i, '') || 'ノート';
    const library = await load({ deviceOnly: options.deviceOnly });
    if (options.registerCurrent) {
      const saved = await openEditor(library, { name: sourceName, content: sourceContent }, { title: 'テンプレートに登録' });
      if (saved) showStatus(`ノートテンプレート「${saved.name}」を${library.remote ? '個人設定' : 'この端末'}に保存しました`);
      return saved;
    }
    const metadata = options.dbPath ? await apiFetch('/db-metadata?path=' + encodeURIComponent(options.dbPath)) : null;
    const items = () => library.templates.map(item => ({
      ...item, builtin: false, category: item.category || 'カスタム', categoryLabel: item.categoryLabel || item.category || 'カスタム',
      badge: options.dbPath && metadata?.note_template?.id === item.id ? '設定中' : 'ノート',
      description: item.content.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').slice(0, 80) || '',
      renderThumbnail: host => renderDocThumbnail(item.content, host),
    }));
    const footerActions = [];
    if (library.deviceAvailable || options.deviceOnly) {
      footerActions.push({ label: options.deviceOnly ? '個人設定のテンプレートに戻る' : 'この端末のテンプレートを開く', e2eId: 'note-templates-switch', run: async ctx => {
        ctx.close('switched');
        await show({ ...options, deviceOnly: !options.deviceOnly });
        return false;
      } });
    }
    if (options.dbPath) {
      footerActions.push({ label: 'シートの設定を解除', e2eId: 'note-templates-clear-sheet', run: async () => {
        await saveSheetDefault(options.dbPath, null, metadata.schema_revision || 0);
        return true;
      } });
    }
    const picker = window.MeldexTemplatePicker.open({
      id: 'note-templates',
      title: options.dbPath ? 'シートのノートテンプレート' : 'ノートテンプレート',
      items: items(),
      selectedId: options.dbPath ? metadata?.note_template?.id : undefined,
      emptyText: '登録済みのテンプレートはありません。ハンバーガーメニューの「現在のノートからテンプレートを作成...」で作成できます。',
      primaryAction: { label: options.dbPath ? 'シートに設定' : 'ノートに適用', run: async item => {
        const current = library.templates.find(other => other.id === item.id);
        if (!current) throw new Error('保存済みのテンプレートを選択してください');
        if (options.dbPath) {
          await saveSheetDefault(options.dbPath, current, metadata.schema_revision || 0);
          return true;
        }
        if (!editor?.isConnected || editor.dataset.path !== path || editor.contentEditable === 'false') throw new Error('適用先のノートを開き直してください');
        if (!await confirmAction('ノート本文を選択したテンプレートに置き換えますか？')) return false;
        if (!editor.isConnected || editor.dataset.path !== path || editor.contentEditable === 'false') throw new Error('適用先が変わりました');
        editor.focus(); const range = document.createRange(); range.selectNodeContents(editor);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        document.execCommand('insertHTML', false, mdToHtml(current.content, { basePath: path }));
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      } },
      itemActions: [
        { label: '編集', e2eId: 'note-templates-edit', run: async (item, ctx) => {
          const current = library.templates.find(other => other.id === item.id);
          const saved = await openEditor(library, current, { title: 'テンプレートの編集' });
          if (saved) { await ctx.refresh(items()); ctx.select(saved.id); ctx.setStatus('保存しました'); }
          return false;
        } },
        { label: '前へ', e2eId: 'note-templates-up', run: async (item, ctx) => {
          const index = library.templates.findIndex(other => other.id === item.id);
          if (index <= 0) { ctx.setStatus('これ以上前へ移動できません'); return false; }
          const next = library.templates.slice();
          [next[index - 1], next[index]] = [next[index], next[index - 1]];
          await persist(library, next);
          await ctx.refresh(items()); ctx.select(item.id); ctx.setStatus('並び順を変更しました');
          return false;
        } },
        { label: '後へ', e2eId: 'note-templates-down', run: async (item, ctx) => {
          const index = library.templates.findIndex(other => other.id === item.id);
          if (index < 0 || index >= library.templates.length - 1) { ctx.setStatus('これ以上後へ移動できません'); return false; }
          const next = library.templates.slice();
          [next[index], next[index + 1]] = [next[index + 1], next[index]];
          await persist(library, next);
          await ctx.refresh(items()); ctx.select(item.id); ctx.setStatus('並び順を変更しました');
          return false;
        } },
        { label: '削除', danger: true, e2eId: 'note-templates-delete', run: async (item, ctx) => {
          if (!await confirmAction(`ノートテンプレート「${item.name}」を削除しますか？`)) return false;
          await persist(library, library.templates.filter(other => other.id !== item.id));
          await ctx.refresh(items()); ctx.setStatus('削除しました');
          return false;
        } },
      ],
      footerActions,
    });
    picker.setStatus(options.dbPath
      ? '設定中: ' + (metadata?.note_template?.name || 'なし') + ' ／ 保存先: ' + (library.remote ? '個人設定' : 'この端末')
      : '保存先: ' + (library.remote ? '個人設定' : 'この端末'));
    return picker;
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
