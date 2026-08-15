const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { startMockServer } = require('../mocks/server');
const { createApp } = require('../src/server');
const { loadConfig } = require('../src/config');
const { buildRegistry } = require('../src/engine/contextRegistry');
const { createCache } = require('../src/gateway/cache');

let mocks, server, base, mocksBase, cache;

before(async () => {
  mocks = await startMockServer(0);
  mocksBase = `http://localhost:${mocks.address().port}`;

  const cfg = loadConfig();
  cache = createCache();
  server = createApp({
    cfg,
    registry: buildRegistry(cfg.registry),
    cache,
    baseUrl: mocksBase,
    llm: require('../src/llm/mockProvider'),
    traceRepo: null,
  }).listen(0);
  base = `http://localhost:${server.address().port}`;
});

after(() => { server.close(); mocks.close(); });

beforeEach(async () => {
  cache.clear();
  await fetch(`${mocksBase}/_control/reset`, { method: 'POST' });
});

const post = (path, body) => fetch(base + path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('POST /personalize returns exactly the assignment response shape', async () => {
  const res = await post('/personalize', { userId: 'user_101', question: 'Should I consider changing my job in the next few months?' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['answer', 'confidence', 'sourcesUsed']);
  assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(body.confidence));
  assert.ok(body.answer.length > 0);
});

test('POST /debug/personalization returns the assignment debug contract', async () => {
  const body = await (await post('/debug/personalization', { userId: 'user_101', question: 'Should I consider changing my job?' })).json();
  for (const key of ['intent', 'selectedContext', 'excludedContext', 'language', 'tone']) {
    assert.ok(key in body, `missing ${key}`);
  }
  assert.equal(body.intent, 'career');
  assert.deepEqual(body.excludedContext, ['Relationship Horoscope']);
});

test('all five sample questions are handled', async () => {
  const questions = [
    ['Should I consider changing my job this year?', 'career'],
    ['How does this month look for my relationship?', 'relationship'],
    ['What should I focus on for my health?', 'health'],
    ['What should I prioritize this week?', 'daily_summary'],
    ["Can you summarize today's guidance?", 'daily_summary'],
  ];
  for (const [question, expected] of questions) {
    const body = await (await post('/debug/personalization', { userId: 'user_101', question })).json();
    assert.equal(body.intent, expected, `"${question}" -> expected ${expected}, got ${body.intent}`);
    assert.ok(body.selectedContext.length > 0, `"${question}" selected no context`);
  }
});

test('personalization differs across users for the same question', async () => {
  const q = 'Should I consider changing my job this year?';
  const a = await (await post('/debug/personalization', { userId: 'user_101', question: q })).json();
  const b = await (await post('/debug/personalization', { userId: 'user_202', question: q })).json();
  assert.equal(a.language, 'English');
  assert.equal(b.language, 'Hindi');
  assert.equal(a.maxWords, 250);
  assert.equal(b.maxWords, 120);
  assert.equal(a.tone, 'Motivational');
  assert.equal(b.tone, 'Neutral');
});

test('an invalid body is a 400 with a requestId', async () => {
  const res = await post('/personalize', { userId: 'user_101' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.requestId);
  assert.ok(body.error);
});

test('an unknown user is a 404', async () => {
  const res = await post('/personalize', { userId: 'nobody', question: 'Should I change my job?' });
  assert.equal(res.status, 404);
});

test('a failing upstream still returns 200 with reduced confidence', async () => {
  await fetch(`${mocksBase}/_control/fail`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ service: 'kundli', mode: '500' }),
  });
  const res = await post('/personalize', { userId: 'user_101', question: 'Should I consider changing my job?' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.confidence, 'MEDIUM');
  assert.ok(!body.sourcesUsed.includes('10th House'));
});

test('GET /health reports upstreams and cache stats', async () => {
  const body = await (await fetch(base + '/health')).json();
  assert.equal(body.status, 'ok');
  assert.ok('hitRate' in body.cache);
  assert.ok(body.upstreams);
  assert.equal(body.upstreams.kundli, 'up');
});

test('an unknown route is a 404', async () => {
  assert.equal((await fetch(base + '/nope')).status, 404);
});
