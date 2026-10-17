/* メッセージ内のversion 1アンケート。旧版でもMarkdownとして読める追加形式。 */
(function () {
  'use strict';
  const safeId = /^[A-Za-z0-9_-]{8,80}$/;
  function normalize(value) {
    const kind = value?.kind === undefined ? 'survey' : value.kind;
    if (!value || value.version !== 1 || typeof value.id !== 'string' || !safeId.test(value.id) || !['survey', 'quiz', 'vote'].includes(kind)
      || typeof value.question !== 'string' || !value.question.trim() || value.question.length > 1000
      || !Array.isArray(value.options) || value.options.length < 2 || value.options.length > 4
      || value.options.some(item => typeof item !== 'string' || !item.trim() || item.length > 200)) throw new Error('アンケートの形式が不正です');
    const poll = { version: 1, id: value.id, kind, question: value.question.trim(), options: value.options.map(item => item.trim()), anonymous: kind === 'vote' || value.anonymous !== false };
    if (new Set(poll.options).size !== poll.options.length) throw new Error('選択肢を重複させないでください');
    if (poll.kind === 'quiz') {
      if (poll.options.length !== 4 || !Number.isInteger(value.answer) || value.answer < 0 || value.answer > 3) throw new Error('四択クイズの正解が不正です');
      poll.answer = value.answer;
    }
    return poll;
  }
  function extract(text) {
    const match = String(text || '').match(/^```meldex-poll\s*\n([\s\S]*?)\n```/m);
    if (!match) throw new Error('アンケートが見つかりません');
    return normalize(JSON.parse(match[1]));
  }
  function result(poll, ballots, voter) {
    const counts = poll.options.map(() => 0);
    let choice = null;
    ballots.forEach(([token, ballot]) => {
      if (!ballot || ballot.version !== 1 || !Number.isInteger(ballot.choice) || ballot.choice < 0 || ballot.choice >= counts.length) throw new Error('投票データを読み込めません。更新して再試行してください');
      counts[ballot.choice]++;
      if (token === voter) choice = ballot.choice;
    });
    const total = counts.reduce((a, b) => a + b, 0);
    const output = { ok: true, counts, total, choice, leaders: counts.map((n, i) => total && n === Math.max(...counts) ? i : -1).filter(i => i >= 0) };
    if (choice !== null && poll.kind === 'quiz') Object.assign(output, { answer: poll.answer, correct: choice === poll.answer });
    return output;
  }
  function randomId() { return crypto.randomUUID().replaceAll('-', ''); }
  function tokenFor(key) {
    const storageKey = 'chat-poll-voter:' + key;
    let token = localStorage.getItem(storageKey);
    if (!safeId.test(token || '')) { token = randomId(); localStorage.setItem(storageKey, token); }
    return token;
  }
  function createCard(value, context = {}) {
    let poll;
    try { poll = normalize(value); } catch { return null; }
    const card = document.createElement('section');
    card.className = 'chat-poll';
    card.setAttribute('aria-label', poll.kind === 'quiz' ? '四択クイズ' : 'アンケート');
    const title = document.createElement('strong');
    title.textContent = poll.question;
    const hint = document.createElement('small');
    hint.textContent = context.message ? (poll.anonymous ? '無記名・同じブラウザーから1票' : '同じブラウザーから1票') : '選択するとAIへの回答を送信します';
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    const choices = document.createElement('div');
    choices.className = 'chat-poll-choices';
    const footer = document.createElement('div');
    footer.className = 'chat-poll-footer';
    footer.appendChild(status);
    card.append(title, hint, choices, footer);
    let busy = false;
    let state = null;
    let aiChoice = null;
    let requestVersion = 0;
    let voter = '';
    const room = context.room;
    const messageId = context.message?.id;
    // 非同期の回答が別ルーム・別ワークスペースに流れ込まないよう、入口を固定する。
    const endpoint = context.message ? _chatApiPath('/collab/poll') : '';
    const payload = context.message ? _chatPostPayload({ room, message_id: messageId, from: getUsername() }) : null;
    try { if (endpoint) voter = tokenFor(endpoint + ':' + room + ':' + messageId + ':' + poll.id); }
    catch { status.textContent = 'ブラウザーの保存領域を利用できないため回答できません'; busy = true; }
    function paint(next) {
      state = next;
      choices.replaceChildren();
      poll.options.forEach((option, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'gb-btn chat-poll-choice';
        button.textContent = option + (next ? ` — ${next.counts[index]}票` : '');
        button.disabled = busy || next?.choice != null || aiChoice != null;
        button.setAttribute('aria-pressed', (next?.choice ?? aiChoice) === index ? 'true' : 'false');
        button.addEventListener('click', () => answer(index));
        choices.appendChild(button);
      });
      if (next) {
        status.textContent = `${next.total}票`;
        if (next.choice != null) status.textContent += '・回答済み';
        if (typeof next.correct === 'boolean') status.textContent += next.correct ? '・正解！' : `・正解: ${poll.options[next.answer]}`;
        if (poll.kind === 'vote' && next.total) status.textContent += next.leaders.length > 1 ? '・同票' : `・最多: ${poll.options[next.leaders[0]]}`;
      }
      if (aiChoice != null) status.textContent = '回答送信済み';
    }
    async function refresh() {
      if (!endpoint || !voter || busy) return;
      const version = ++requestVersion;
      try {
        const query = new URLSearchParams({ room, message_id: messageId, voter });
        const next = await apiFetch(endpoint + (endpoint.includes('?') ? '&' : '?') + query);
        if (version === requestVersion) paint(next);
      } catch (error) { if (version === requestVersion) status.textContent = '集計を取得できません: ' + (error?.message || error); }
    }
    async function answer(index) {
      if (busy || state?.choice != null || aiChoice != null) return;
      ++requestVersion;
      busy = true; paint(state);
      let failure = '';
      try {
        if (endpoint) {
          state = await apiPost(endpoint, { ...payload, voter, choice: index });
        } else {
          const input = document.getElementById('chat-input');
          if (!input || input.value.trim() || (typeof _chatState !== 'undefined' && _chatState.streaming)) throw new Error('入力中のメッセージを送信してから回答してください');
          input.value = `「${poll.question}」への回答: ${poll.options[index]}`;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          if (await chatSend({ fromButton: true }) === false) throw new Error('回答を送信できませんでした。入力欄から再送信してください');
          aiChoice = index;
        }
      } catch (error) { failure = '回答できません: ' + (error?.message || error); }
      finally { busy = false; paint(state); if (failure) status.textContent = failure; }
    }
    paint(null);
    if (endpoint) {
      const refreshButton = document.createElement('button');
      refreshButton.type = 'button'; refreshButton.className = 'gb-btn gb-btn-xs'; refreshButton.textContent = '集計を更新';
      refreshButton.addEventListener('click', refresh); footer.appendChild(refreshButton);
      queueMicrotask(refresh);
    }
    return card;
  }
  function openComposer() {
    if (typeof _teamCurrentRoom === 'undefined' || !_teamCurrentRoom) { showStatus('先にルームを選択してください', true); return; }
    const room = _teamCurrentRoom;
    const draftId = randomId();
    const endpoint = _chatApiPath('/collab/send');
    const basePayload = _chatPostPayload({ room, from: getUsername() });
    const overlay = document.createElement('div');
    overlay.className = 'gb-dialog-overlay chat-poll-dialog-overlay';
    const dialog = document.createElement('form');
    dialog.className = 'gb-dialog chat-poll-dialog';
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', 'アンケートを作成');
    dialog.innerHTML = '<h3>アンケートを作成</h3><label>種類<select name="kind" class="gb-input"><option value="survey">アンケート</option><option value="quiz">四択クイズ</option><option value="vote">無記名投票・多数決</option></select></label><label>質問<input name="question" class="gb-input" maxlength="1000" required></label>'
      + '<div class="chat-poll-option-fields">' + [1, 2, 3, 4].map(i => `<label>選択肢${i}<input name="option${i}" class="gb-input" maxlength="200" ${i < 3 ? 'required' : ''}></label>`).join('') + '</div>'
      + '<label data-quiz-answer hidden>正解<select name="answer" class="gb-input"><option value="0">選択肢1</option><option value="1">選択肢2</option><option value="2">選択肢3</option><option value="3">選択肢4</option></select></label><p>回答者名は記録しません。同じブラウザーから1票です。</p><div role="status"></div><div class="chat-poll-dialog-actions"><button type="button" class="gb-btn" data-cancel>キャンセル</button><button type="submit" class="gb-btn gb-btn-primary">投稿</button></div>';
    const previousFocus = document.activeElement;
    const close = () => { overlay.remove(); previousFocus?.focus?.(); };
    dialog.querySelector('[data-cancel]').addEventListener('click', close);
    dialog.elements.kind.addEventListener('change', () => {
      const quiz = dialog.elements.kind.value === 'quiz';
      dialog.querySelector('[data-quiz-answer]').hidden = !quiz;
      dialog.elements.option3.required = quiz; dialog.elements.option4.required = quiz;
    });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const fields = Array.from(dialog.querySelectorAll('input,select,button')).filter(el => !el.closest('[hidden]') && !el.disabled);
        const next = (fields.indexOf(document.activeElement) + (event.shiftKey ? -1 : 1) + fields.length) % fields.length;
        event.preventDefault(); fields[next]?.focus();
      }
    });
    dialog.addEventListener('submit', async event => {
      event.preventDefault();
      const submit = dialog.querySelector('[type="submit"]');
      if (submit.disabled) return;
      try {
        const options = [1, 2, 3, 4].map(i => dialog.elements['option' + i].value.trim());
        const poll = normalize({ version: 1, id: draftId, kind: dialog.elements.kind.value, question: dialog.elements.question.value, options: options.filter(Boolean), answer: Number(dialog.elements.answer.value), anonymous: true });
        submit.disabled = true;
        await apiPost(endpoint, { ...basePayload, text: '```meldex-poll\n' + JSON.stringify(poll) + '\n```' });
        close();
        if (_teamCurrentRoom === room) await loadTeamMessages();
      } catch (error) { dialog.querySelector('[role="status"]').textContent = String(error?.message || error); submit.disabled = false; }
    });
    overlay.appendChild(dialog); document.body.appendChild(overlay); dialog.elements.question.focus();
  }
  window.MeldexChatPolls = { normalize, extract, result, createCard, openComposer, safeId };
})();
