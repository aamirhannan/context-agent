// ponytail: unbounded Map; swap for lru-cache if entry count ever matters.

function createCache() {
  const store = new Map();
  let hits = 0;
  let misses = 0;

  return {
    /** Returns { value, fresh } or null. A stale entry is still returned — the
     *  caller decides whether to use it (stale-while-error). */
    get(key) {
      const entry = store.get(key);
      if (!entry) { misses += 1; return null; }
      const age = Date.now() - entry.storedAt;
      if (age > entry.staleMaxMs) { store.delete(key); misses += 1; return null; }
      hits += 1;
      return { value: entry.value, fresh: age <= entry.ttlMs };
    },

    set(key, value, ttlMs, staleMaxMs) {
      store.set(key, { value, ttlMs, staleMaxMs, storedAt: Date.now() });
    },

    stats() {
      const total = hits + misses;
      return { hits, misses, size: store.size, hitRate: total ? Number((hits / total).toFixed(2)) : 0 };
    },

    clear() { store.clear(); hits = 0; misses = 0; },
  };
}

module.exports = { createCache };
