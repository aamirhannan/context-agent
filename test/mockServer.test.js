const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startMockServer } = require('../mocks/server');

let server;
let base;

before(async () => {
  server = await startMockServer(0);
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

test('serves a user', async () => {
  const res = await fetch(`${base}/users/user_101`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.name, 'Aarav Sharma');
  assert.equal(body.tonePreference, 'motivational');
});

test('returns 404 for an unknown user', async () => {
  assert.equal((await fetch(`${base}/users/nobody`)).status, 404);
});

test('serves kundli with the three specified houses', async () => {
  const body = await (await fetch(`${base}/kundli/user_101`)).json();
  assert.deepEqual(Object.keys(body.houses).sort(), ['10', '6', '7']);
  assert.equal(body.houses['10'].strength, 'Strong');
});

test('serves all four horoscope domains', async () => {
  const body = await (await fetch(`${base}/horoscope/user_101`)).json();
  assert.deepEqual(Object.keys(body).sort(), ['career', 'finance', 'health', 'relationship']);
});

test('panchang needs no userId and reports today', async () => {
  const body = await (await fetch(`${base}/panchang`)).json();
  assert.equal(body.date, new Date().toISOString().slice(0, 10));
  assert.equal(body.tithi, 'Shukla Panchami');
});

test('failure injection makes a service return 500, and reset restores it', async () => {
  await fetch(`${base}/_control/fail`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ service: 'kundli', mode: '500' }),
  });
  assert.equal((await fetch(`${base}/kundli/user_101`)).status, 500);
  assert.equal((await fetch(`${base}/horoscope/user_101`)).status, 200, 'other services unaffected');

  await fetch(`${base}/_control/reset`, { method: 'POST' });
  assert.equal((await fetch(`${base}/kundli/user_101`)).status, 200);
});
