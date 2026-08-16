const { test } = require('node:test');
const assert = require('node:assert');
const { loadConfig } = require('../src/config');
const { buildRegistry, resolveItem, availableTokens } = require('../src/engine/contextRegistry');

const BUNDLE = {
  kundli: {
    lagna: 'Libra',
    moonSign: 'Scorpio',
    currentDasha: { mahadasha: 'Rahu', antardasha: 'Mars' },
    houses: { 6: { lord: 'Jupiter', strength: 'Average' }, 7: { lord: 'Mars', strength: 'Weak' }, 10: { lord: 'Moon', strength: 'Strong' } },
  },
  horoscope: {
    career: 'Networking may bring new opportunities.',
    finance: 'Avoid risky investments.',
    health: 'Prioritize proper sleep.',
    relationship: 'Communication with your partner improves.',
  },
  panchang: { date: '2026-08-15', tithi: 'Shukla Panchami', nakshatra: 'Rohini', yoga: 'Siddhi', karana: 'Bava' },
};

const registry = buildRegistry(loadConfig().registry);

test('buildRegistry indexes all 11 items by ID', () => {
  assert.equal(registry.size, 11);
  assert.ok(registry.has('kundli.house.10'));
});

test('renders a nested object item using its template variables', () => {
  const item = resolveItem(registry.get('kundli.house.10'), BUNDLE);
  assert.equal(item.label, '10th House');
  assert.equal(item.text, '10th House - lord Moon, strength Strong');
  assert.equal(item.estTokens, 16);
});

test('renders a scalar item using {value}', () => {
  const item = resolveItem(registry.get('horoscope.career'), BUNDLE);
  assert.equal(item.text, 'Career outlook: Networking may bring new opportunities.');
});

test('renders a whole-source item when path is "."', () => {
  const item = resolveItem(registry.get('panchang.today'), BUNDLE);
  assert.match(item.text, /Tithi Shukla Panchami/);
  assert.match(item.text, /Karana Bava/);
});

test('returns null when the source is entirely missing', () => {
  assert.equal(resolveItem(registry.get('kundli.house.10'), { horoscope: BUNDLE.horoscope }), null);
});

test('returns null when the path is missing from an otherwise present source', () => {
  const partial = { ...BUNDLE, kundli: { lagna: 'Libra' } };
  assert.equal(resolveItem(registry.get('kundli.house.10'), partial), null);
});

test('returns null when a render variable is absent rather than emitting "undefined"', () => {
  const partial = { ...BUNDLE, kundli: { ...BUNDLE.kundli, houses: { 10: { lord: 'Moon' } } } };
  assert.equal(resolveItem(registry.get('kundli.house.10'), partial), null);
});

test('availableTokens sums every resolvable item', () => {
  const total = availableTokens(registry, BUNDLE);
  assert.equal(total, 192);
  assert.ok(availableTokens(registry, { horoscope: BUNDLE.horoscope }) < total);
});
