const { test } = require('node:test');
const assert = require('node:assert');
const { loadConfig, validateConfig } = require('../src/config');

test('loadConfig returns all five config sections', () => {
  const cfg = loadConfig();
  assert.ok(Array.isArray(cfg.registry.items));
  assert.equal(cfg.registry.items.length, 11);
  assert.ok(cfg.intents.intents.career);
  assert.ok(cfg.personalization.tone.motivational);
  assert.ok(cfg.confidence.weights);
  assert.ok(cfg.services.services.kundli);
});

test('every context ID referenced by an intent exists in the registry', () => {
  const cfg = loadConfig();
  const ids = new Set(cfg.registry.items.map((i) => i.id));
  for (const [name, intent] of Object.entries(cfg.intents.intents)) {
    for (const key of ['primary', 'secondary', 'exclude']) {
      for (const id of intent[key]) {
        assert.ok(ids.has(id), `intents.${name}.${key} references unknown id '${id}'`);
      }
    }
  }
});

test('validateConfig rejects an intent referencing an unknown context ID', () => {
  const bad = {
    registry: { items: [{ id: 'a.b', label: 'A', source: 'kundli', path: 'x', render: '{value}', estTokens: 1 }] },
    intents: { threshold: 0.6, intents: { career: { match: { keywords: [], patterns: [] }, primary: ['nope.id'], secondary: [], exclude: [] } } },
    personalization: { tone: { neutral: 'x' }, language: { en: 'English' }, length: { free: 100, premium: 200 }, defaults: { language: 'en', tone: 'neutral', subscription: 'free' } },
    confidence: { weights: { intentConfidence: 0.4, primaryCoverage: 0.4, sourceHealth: 0.2 }, intentScoreByMethod: { rule: 1, fallback: 0.4 }, sourceHealthScore: { fresh: 1, stale: 0.6, missing: 0 }, caps: { fallbackIntent: 0.7, insufficient: 0.5, noPrimaryCoverage: 0.4 }, bands: { high: 0.8, medium: 0.5 } },
    services: { budgetTokens: 400, escalation: { enabled: true }, services: {} },
  };
  assert.throws(() => validateConfig(bad), /unknown context id 'nope.id'/);
});

test('validateConfig rejects a duplicate context id', () => {
  const item = { id: 'a.b', label: 'A', source: 'kundli', path: 'x', render: '{value}', estTokens: 1 };
  const bad = {
    registry: { items: [item, { ...item }] },
    intents: { threshold: 0.6, intents: { general: { match: { keywords: [], patterns: [] }, primary: [], secondary: [], exclude: [] } } },
    personalization: { tone: { neutral: 'x' }, language: { en: 'English' }, length: { free: 100, premium: 200 }, defaults: { language: 'en', tone: 'neutral', subscription: 'free' } },
    confidence: { weights: { intentConfidence: 0.4, primaryCoverage: 0.4, sourceHealth: 0.2 }, intentScoreByMethod: { rule: 1, fallback: 0.4 }, sourceHealthScore: { fresh: 1, stale: 0.6, missing: 0 }, caps: { fallbackIntent: 0.7, insufficient: 0.5, noPrimaryCoverage: 0.4 }, bands: { high: 0.8, medium: 0.5 } },
    services: { budgetTokens: 400, escalation: { enabled: true }, services: {} },
  };
  assert.throws(() => validateConfig(bad), /duplicate context id 'a.b'/);
});

test('registry sources are limited to the three context services', () => {
  const cfg = loadConfig();
  const allowed = new Set(['kundli', 'horoscope', 'panchang']);
  for (const item of cfg.registry.items) {
    assert.ok(allowed.has(item.source), `${item.id} has non-context source '${item.source}'`);
  }
});

test('a general fallback intent is defined', () => {
  assert.ok(loadConfig().intents.intents.general);
});
