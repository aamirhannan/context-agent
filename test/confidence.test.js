const { test } = require('node:test');
const assert = require('node:assert');
const { loadConfig } = require('../src/config');
const { computeConfidence } = require('../src/engine/confidence');

const ccfg = loadConfig().confidence;
const ALL_FRESH = { kundli: 'fresh', horoscope: 'fresh', panchang: 'fresh' };

const band = (over) => computeConfidence({
  intentMethod: 'rule', intentScore: 1, primaryCoverage: 1,
  sourceStates: ALL_FRESH, sufficient: true, ...over,
}, ccfg).band;

test('rule intent with all context fresh is HIGH', () => {
  assert.equal(band({}), 'HIGH');
});

test('losing a secondary-only source stays HIGH', () => {
  assert.equal(band({ sourceStates: { kundli: 'fresh', horoscope: 'fresh', panchang: 'missing' } }), 'HIGH');
});

test('losing half of primary drops to MEDIUM', () => {
  assert.equal(band({ primaryCoverage: 0.5, sourceStates: { kundli: 'missing', horoscope: 'fresh', panchang: 'fresh' } }), 'MEDIUM');
});

test('a fallback intent is capped below HIGH even with perfect context', () => {
  assert.equal(band({ intentMethod: 'fallback', intentScore: 0.4 }), 'MEDIUM');
});

test('sufficient=false caps at MEDIUM', () => {
  assert.equal(band({ sufficient: false }), 'MEDIUM');
});

test('zero primary coverage is LOW', () => {
  assert.equal(band({ primaryCoverage: 0, sourceStates: { kundli: 'missing', horoscope: 'missing', panchang: 'fresh' } }), 'LOW');
});

test('two sources down is LOW', () => {
  assert.equal(band({ primaryCoverage: 0, sourceStates: { kundli: 'missing', horoscope: 'missing' } }), 'LOW');
});

test('stale cache scores between fresh and missing', () => {
  const stale = computeConfidence({ intentMethod: 'rule', intentScore: 1, primaryCoverage: 1, sourceStates: { kundli: 'stale' }, sufficient: true }, ccfg);
  const fresh = computeConfidence({ intentMethod: 'rule', intentScore: 1, primaryCoverage: 1, sourceStates: { kundli: 'fresh' }, sufficient: true }, ccfg);
  assert.ok(stale.score < fresh.score);
});

test('records the contributing factors and any caps applied', () => {
  const r = computeConfidence({ intentMethod: 'fallback', intentScore: 0.4, primaryCoverage: 1, sourceStates: ALL_FRESH, sufficient: false }, ccfg);
  assert.equal(r.factors.primaryCoverage, 1);
  assert.ok(r.caps.includes('fallbackIntent'));
  assert.ok(r.caps.includes('insufficient'));
});

test('a null sufficient (debug path) applies no sufficiency cap', () => {
  const r = computeConfidence({ intentMethod: 'rule', intentScore: 1, primaryCoverage: 1, sourceStates: ALL_FRESH, sufficient: null }, ccfg);
  assert.equal(r.band, 'HIGH');
  assert.ok(!r.caps.includes('insufficient'));
});
