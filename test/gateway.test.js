const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { startMockServer } = require('../mocks/server');
const { loadConfig } = require('../src/config');
const { createCache } = require('../src/gateway/cache');
const { fetchAll } = require('../src/gateway');

const servicesConfig = loadConfig().services.services;
let server;
let baseUrl;
let cache;

before(async () => {
  server = await startMockServer(0);
  baseUrl = `http://localhost:${server.address().port}`;
});
after(() => server.close());
beforeEach(async () => {
  cache = createCache();
  await fetch(`${baseUrl}/_control/reset`, { method: 'POST' });
});

const inject = (service, mode) => fetch(`${baseUrl}/_control/fail`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ service, mode }),
});

test('fetches all four services and reports them fresh', async () => {
  const r = await fetchAll('user_101', { cache, servicesConfig, baseUrl });
  assert.ok(r.bundle.user && r.bundle.kundli && r.bundle.horoscope && r.bundle.panchang);
  assert.deepEqual(r.sourceStates, { kundli: 'fresh', horoscope: 'fresh', panchang: 'fresh' });
  assert.deepEqual(r.degradations, []);
});

test('fetches concurrently, not serially', async () => {
  const started = Date.now();
  await fetchAll('user_101', { cache, servicesConfig, baseUrl });
  const serialFloor = Object.values(servicesConfig).reduce((a, s) => a + s.timeoutMs, 0);
  assert.ok(Date.now() - started < serialFloor, 'elapsed time must be well under the sum of all timeouts');
});

test('one failing service does not prevent the others', async () => {
  await inject('kundli', '500');
  const r = await fetchAll('user_101', { cache, servicesConfig, baseUrl });
  assert.equal(r.bundle.kundli, undefined);
  assert.ok(r.bundle.horoscope, 'horoscope still resolved');
  assert.equal(r.sourceStates.kundli, 'missing');
  assert.ok(r.degradations.some((d) => d.includes('kundli')));
});

test('a user 404 is flagged distinctly from an outage', async () => {
  const r = await fetchAll('nobody', { cache, servicesConfig, baseUrl });
  assert.equal(r.userMissing, true);
});

test('serves stale cache when the upstream fails afterwards', async () => {
  await fetchAll('user_101', { cache, servicesConfig, baseUrl });   // warm
  cache.set('kundli:user_101', { lagna: 'Libra' }, -1, 999999);      // force stale
  await inject('kundli', '500');
  const r = await fetchAll('user_101', { cache, servicesConfig, baseUrl });
  assert.equal(r.bundle.kundli.lagna, 'Libra');
  assert.equal(r.sourceStates.kundli, 'stale');
});

test('a warm cache avoids a second upstream round trip', async () => {
  await fetchAll('user_101', { cache, servicesConfig, baseUrl });
  await inject('kundli', '500');
  const r = await fetchAll('user_101', { cache, servicesConfig, baseUrl });
  assert.equal(r.sourceStates.kundli, 'fresh', 'served from the fresh cache, upstream never consulted');
});

test('panchang is cached globally by date, not per user', async () => {
  await fetchAll('user_101', { cache, servicesConfig, baseUrl });
  const keys = cache.stats().size;
  await fetchAll('user_202', { cache, servicesConfig, baseUrl });
  assert.equal(cache.stats().size, keys + 3, 'user/kundli/horoscope added; panchang reused');
});

test('a timeout is survived and reported', async () => {
  await inject('panchang', 'timeout');
  const r = await fetchAll('user_101', { cache, servicesConfig, baseUrl });
  assert.equal(r.sourceStates.panchang, 'missing');
  assert.ok(r.degradations.some((d) => d.includes('panchang')));
});
