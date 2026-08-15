const { test, describe } = require('node:test');
const assert = require('node:assert');

const skip = !process.env.DATABASE_URL;

describe('pgRepo', { skip: skip && 'DATABASE_URL not set' }, () => {
  const repo = require('../mocks/repo/pgRepo');
  const today = () => new Date().toISOString().slice(0, 10);

  test('returns a user in the same shape as the fixture repo', async () => {
    const u = await repo.getUser('user_101');
    assert.deepEqual(Object.keys(u).sort(),
      ['birthDetails', 'id', 'language', 'name', 'subscription', 'tonePreference'].sort());
    assert.equal(u.tonePreference, 'motivational');
    // Values, not just keys: a Date->toISOString() round trip silently shifts
    // birth_date a day backwards east of UTC, and shape-only asserts miss it.
    assert.deepEqual(u.birthDetails, { date: '1997-08-15', time: '09:35', place: 'Delhi' });
  });

  test('returns null for an unknown user', async () => {
    assert.equal(await repo.getUser('nobody'), null);
  });

  test('assembles kundli houses into the nested payload shape', async () => {
    const k = await repo.getKundli('user_101');
    assert.equal(k.currentDasha.mahadasha, 'Rahu');
    assert.deepEqual(Object.keys(k.houses).sort(), ['10', '6', '7']);
    assert.equal(k.houses['10'].strength, 'Strong');
  });

  test('returns the horoscope for a given date', async () => {
    const h = await repo.getHoroscope('user_101', today());
    assert.deepEqual(Object.keys(h).sort(), ['career', 'finance', 'health', 'relationship']);
  });

  test('returns panchang keyed by date alone', async () => {
    const p = await repo.getPanchang(today());
    assert.equal(p.date, today());
    assert.equal(p.tithi, 'Shukla Panchami');
  });
});
