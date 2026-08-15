/* Retry-stable operation IDs for duplicate/save-as requests. */
(function (global) {
  const pending = new Map();
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).filter(key => key !== 'operation_id').sort()
      .map(key => [key, canonical(value[key])]));
  }
  global.MeldexStableCopyOperationIds = Object.freeze({
    prepare(path, body) {
      const payload = body && typeof body === 'object' ? body : {};
      if (payload.operation_id) return { body: payload, key: '' };
      const key = `${String(path || '')}\u0000${JSON.stringify(canonical(payload))}`;
      const operationId = pending.get(key) || crypto.randomUUID();
      pending.set(key, operationId);
      while (pending.size > 256) pending.delete(pending.keys().next().value);
      return { body: { ...payload, operation_id: operationId }, key };
    },
    complete(key) { if (key) pending.delete(key); },
  });
})(window);
