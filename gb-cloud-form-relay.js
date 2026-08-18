/* 公開フォーム クラウド中継アダプタの共通入口 */

const MeldexCloudFormRelay = (() => {
  const adapters = new Map();

  function register(name, adapter) {
    if (!name || !adapter) return;
    adapters.set(name, adapter);
  }

  function get(name) {
    return adapters.get(name) || null;
  }

  async function submit(name, payload, options) {
    const adapter = get(name);
    if (!adapter || typeof adapter.submit !== 'function') {
      throw new Error('クラウド中継アダプタが未設定です: ' + name);
    }
    return adapter.submit(payload, options || {});
  }

  return { register, get, submit };
})();
