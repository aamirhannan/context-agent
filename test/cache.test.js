const { test } = require('node:test');
const assert = require('node:assert');
const { createCache } = require('../src/gateway/cache');

test('returns a fresh hit inside the TTL', () => {
  const c = createCache();
  c.set('k', { a: 1 }, 1000, 5000);
  const hit = c.get('k');
  assert.deepEqual(hit.value, { a: 1 });
  assert.equal(hit.fresh, true);
});

test('returns a stale hit past the TTL but inside staleMaxMs', () => {
  const c = createCache();
  c.set('k', { a: 1 }, -1, 5000); // already expired
  const hit = c.get('k');
  assert.equal(hit.fresh, false);
  assert.deepEqual(hit.value, { a: 1 });
});

test('returns null past staleMaxMs', () => {
  const c = createCache();
  c.set('k', { a: 1 }, -10, -5);
  assert.equal(c.get('k'), null);
});

test('returns null for an unknown key', () => {
  assert.equal(createCache().get('nope'), null);
});

test('tracks hits, misses, size and hitRate', () => {
  const c = createCache();
  c.set('k', 1, 1000, 5000);
  c.get('k'); c.get('k'); c.get('missing');
  const s = c.stats();
  assert.equal(s.hits, 2);
  assert.equal(s.misses, 1);
  assert.equal(s.size, 1);
  assert.equal(s.hitRate, 0.67);
});
