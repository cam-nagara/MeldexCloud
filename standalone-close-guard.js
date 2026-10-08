/* standalone-close-guard.js: 共通保存契約とブラウザー/ネイティブ終了保護。 */
(function (root) {
  'use strict';

  const extras = new Map();
  let running = null;

  function draftContracts() {
    return root.MeldexStandaloneLocalDrafts?.getInstances?.() || [];
  }

  function contracts() {
    const combined = new Map();
    draftContracts().forEach(contract => combined.set(contract.appId || contract.id, contract));
    extras.forEach((contract, id) => {
      const draft = combined.get(id);
      combined.set(id, draft ? { ...draft, ...contract, draft } : contract);
    });
    return Array.from(combined.values());
  }

  function normalizeState(contract) {
    const value = contract?.getCloseState?.() || {};
    return {
      appId: String(value.appId || contract?.appId || contract?.id || ''),
      state: String(value.state || 'clean'),
      pendingLocal: !!value.pendingLocal,
      saving: !!value.saving,
      failed: !!value.failed,
      unnamed: !!value.unnamed,
      hasSnapshot: !!value.hasSnapshot,
      hasFinalDestination: value.hasFinalDestination !== false,
      shouldWarn: !!value.shouldWarn,
      message: String(value.message || ''),
    };
  }

  function getCloseState() {
    const items = contracts().map(normalizeState);
    const blocking = items.filter(item => item.shouldWarn);
    return {
      items,
      blocking,
      canClose: blocking.length === 0,
      shouldWarn: blocking.length > 0,
      message: blocking.map(item => item.message).filter(Boolean).join('\n'),
    };
  }

  async function callContract(contract, method) {
    const direct = contract?.[method];
    if (typeof direct === 'function') return direct.call(contract);
    const draft = contract?.draft;
    if (typeof draft?.[method] === 'function') return draft[method]();
    return true;
  }

  async function flushLocal() {
    const results = await Promise.all(contracts().map(contract => callContract(contract, 'flushLocal')));
    return results.every(value => value !== false);
  }

  async function flushFinal() {
    const results = await Promise.all(contracts().map(contract => callContract(contract, 'flushFinal')));
    return results.every(value => value !== false);
  }

  function notify(message, error) {
    if (typeof root.showStatus === 'function') root.showStatus(message, !!error);
    else if (error) console.error(message);
  }

  async function saveUnnamed() {
    const blocking = contracts().filter(contract => normalizeState(contract).unnamed);
    for (const contract of blocking) {
      if (typeof contract.saveAs !== 'function') {
        notify('ファイル未作成です。メニューの「名前を付けて保存」を実行してください', true);
        return false;
      }
      const saved = await contract.saveAs();
      if (saved === false || saved == null) {
        notify('保存をキャンセルしました。編集画面へ戻ります', false);
        return false;
      }
    }
    return true;
  }

  async function prepareClose(reason) {
    if (running) return running;
    running = (async () => {
      for (const contract of contracts()) {
        if (typeof contract.prepareClose === 'function') {
          const prepared = await contract.prepareClose(reason || 'close');
          if (prepared === false) return false;
        }
      }
      if (!await flushLocal()) {
        notify('端末への保存に失敗したため、閉じません。空き容量と権限を確認して再試行してください', true);
        return false;
      }
      if (!await saveUnnamed()) return false;
      const named = contracts().filter(contract => normalizeState(contract).hasFinalDestination);
      const results = await Promise.all(named.map(contract => callContract(contract, 'flushFinal')));
      if (results.some(value => value === false)) {
        notify('ファイルへの保存を完了できなかったため、閉じません', true);
        return false;
      }
      return getCloseState().canClose;
    })().finally(() => { running = null; });
    return running;
  }

  function isTransitionAction(label) {
    return /新規|開く|再読み込み|別ファイル|終了|閉じ/.test(String(label || ''));
  }

  function installActionGuard() {
    const previous = root.runStandaloneFileAction;
    if (typeof previous !== 'function' || previous._meldexCloseGuard) return;
    const guarded = async function (label, action) {
      if (isTransitionAction(label) && !await prepareClose('action')) return null;
      return previous(label, action);
    };
    guarded._meldexCloseGuard = true;
    root.runStandaloneFileAction = guarded;
  }

  function beforeUnload(event) {
    const closeState = getCloseState();
    if (!closeState.shouldWarn) return;
    event.preventDefault();
    event.returnValue = '';
  }

  function nativeCloseRequest() {
    const closeState = getCloseState();
    if (!closeState.shouldWarn) return true;
    prepareClose('native-close').then(ok => {
      notify(ok
        ? '保存が完了しました。もう一度閉じてください'
        : '保存が完了していないため、アプリを閉じません', !ok);
    });
    return false;
  }

  function register(contract) {
    const id = String(contract?.appId || contract?.id || '');
    if (!id) throw new Error('終了保護のappIdが必要です');
    extras.set(id, { ...contract, appId: id });
    root.dispatchEvent(new CustomEvent('meldex:standalone-save-contract', { detail: { appId: id } }));
    return () => extras.delete(id);
  }

  root.addEventListener('beforeunload', beforeUnload);
  root.addEventListener('pagehide', () => { flushLocal(); });
  root.addEventListener('meldex:standalone-save-contract', installActionGuard);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installActionGuard, { once: true });
  } else installActionGuard();

  root.MeldexStandaloneCloseGuard = Object.freeze({
    register,
    getCloseState,
    hasPendingChanges: () => getCloseState().shouldWarn,
    saveNow: flushLocal,
    flushLocal,
    flushFinal,
    prepareClose,
    nativeCloseRequest,
    nativeCloseState: getCloseState,
  });
  root.dispatchEvent(new CustomEvent('meldex:standalone-close-guard-ready'));
})(typeof window !== 'undefined' ? window : globalThis);
