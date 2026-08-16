const { test } = require('node:test');
const assert = require('node:assert');
const { loadConfig } = require('../src/config');
const { buildRegistry } = require('../src/engine/contextRegistry');
const { selectContext } = require('../src/engine/contextSelector');

const cfg = loadConfig();
const registry = buildRegistry(cfg.registry);
const BUDGET = cfg.services.budgetTokens;

const BUNDLE = {
  kundli: {
    lagna: 'Libra', moonSign: 'Scorpio',
    currentDasha: { mahadasha: 'Rahu', antardasha: 'Mars' },
    houses: { 6: { lord: 'Jupiter', strength: 'Average' }, 7: { lord: 'Mars', strength: 'Weak' }, 10: { lord: 'Moon', strength: 'Strong' } },
  },
  horoscope: { career: 'Networking may bring new opportunities.', finance: 'Avoid risky investments.', health: 'Prioritize proper sleep.', relationship: 'Communication with your partner improves.' },
  panchang: { tithi: 'Shukla Panchami', nakshatra: 'Rohini', yoga: 'Siddhi', karana: 'Bava' },
};

const sel = (intentName, bundle = BUNDLE, budgetTokens = BUDGET) =>
  selectContext({ intentConfig: cfg.intents.intents[intentName], registry, bundle, budgetTokens });

test('career selects primary + secondary and nothing else', () => {
  const r = sel('career');
  const ids = r.selected.map((s) => s.id).sort();
  assert.deepEqual(ids, ['horoscope.career', 'kundli.dasha', 'kundli.house.10', 'panchang.today'].sort());
});

test('career reports Relationship Horoscope as a deliberate exclusion', () => {
  const r = sel('career');
  assert.deepEqual(r.excluded.map((e) => e.label), ['Relationship Horoscope']);
  assert.equal(r.excluded[0].reason, 'intent_rule');
});

test('excludedContext is the explicit list only, not every unselected item', () => {
  const r = sel('career');
  assert.equal(r.excluded.length, 1);
  assert.ok(r.notSelected.length > 1, 'the implicit remainder belongs in notSelected');
});

test('relationship, health and finance match the assignment mapping', () => {
  assert.deepEqual(sel('relationship').selected.map((s) => s.id).sort(),
    ['horoscope.relationship', 'kundli.house.7', 'kundli.moonSign', 'kundli.dasha'].sort());
  assert.deepEqual(sel('health').selected.map((s) => s.id).sort(),
    ['horoscope.health', 'kundli.house.6', 'kundli.moonSign', 'panchang.today'].sort());
  assert.deepEqual(sel('finance').selected.map((s) => s.id).sort(),
    ['horoscope.finance', 'kundli.dasha', 'kundli.lagna'].sort());
});

test('general selects every resolvable item', () => {
  assert.equal(sel('general').selected.length, 11);
});

test('exclude wins over secondary when an ID appears in both', () => {
  const conflicted = { match: { keywords: [], patterns: [] }, primary: ['horoscope.career'], secondary: ['kundli.dasha'], exclude: ['kundli.dasha'] };
  const r = selectContext({ intentConfig: conflicted, registry, bundle: BUNDLE, budgetTokens: BUDGET });
  assert.ok(!r.selected.some((s) => s.id === 'kundli.dasha'));
  assert.ok(r.excluded.some((e) => e.id === 'kundli.dasha'));
});

test('an unavailable source removes its items and lowers primaryCoverage', () => {
  const r = sel('career', { horoscope: BUNDLE.horoscope, panchang: BUNDLE.panchang });
  assert.ok(!r.selected.some((s) => s.id === 'kundli.house.10'));
  assert.ok(r.unavailable.some((u) => u.id === 'kundli.house.10'));
  assert.equal(r.primaryCoverage, 0.5);
});

test('primaryCoverage is 1 when all primary items resolve, 0 when none do', () => {
  assert.equal(sel('career').primaryCoverage, 1);
  assert.equal(sel('career', { panchang: BUNDLE.panchang }).primaryCoverage, 0);
});

test('over budget trims from the secondary tail and never drops primary', () => {
  const r = sel('career', BUNDLE, 40);
  const ids = r.selected.map((s) => s.id);
  assert.ok(ids.includes('horoscope.career'), 'primary must survive');
  assert.ok(ids.includes('kundli.house.10'), 'primary must survive');
  assert.ok(!ids.includes('panchang.today'), 'secondary tail trimmed first');
  assert.ok(r.notSelected.some((n) => n.id === 'panchang.today' && n.reason === 'budget'));
});

test('budget reports available, sent and reduction percentage', () => {
  const r = sel('career');
  assert.equal(r.budget.sent, r.selected.reduce((a, s) => a + s.estTokens, 0));
  assert.ok(r.budget.available > r.budget.sent);
  assert.equal(r.budget.reductionPct, Math.round((1 - r.budget.sent / r.budget.available) * 100));
});
