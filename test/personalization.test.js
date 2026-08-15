const { test } = require('node:test');
const assert = require('node:assert');
const { loadConfig } = require('../src/config');
const { resolvePersona } = require('../src/engine/personalization');

const pcfg = loadConfig().personalization;

test('resolves language, tone and length from a full profile', () => {
  const p = resolvePersona({ language: 'en', tonePreference: 'motivational', subscription: 'premium' }, pcfg);
  assert.equal(p.languageName, 'English');
  assert.equal(p.tone, 'motivational');
  assert.match(p.toneInstruction, /Encouraging/);
  assert.equal(p.maxWords, 250);
  assert.equal(p.usedDefaults, false);
});

test('free subscription gets the shorter length', () => {
  assert.equal(resolvePersona({ language: 'hi', tonePreference: 'neutral', subscription: 'free' }, pcfg).maxWords, 120);
});

test('maps hi to Hindi', () => {
  assert.equal(resolvePersona({ language: 'hi', tonePreference: 'neutral', subscription: 'free' }, pcfg).languageName, 'Hindi');
});

test('falls back to defaults when the profile is null', () => {
  const p = resolvePersona(null, pcfg);
  assert.equal(p.languageName, 'English');
  assert.equal(p.tone, 'neutral');
  assert.equal(p.maxWords, 120);
  assert.equal(p.usedDefaults, true);
});

test('falls back per-field for unknown values rather than throwing', () => {
  const p = resolvePersona({ language: 'kl', tonePreference: 'sarcastic', subscription: 'platinum' }, pcfg);
  assert.equal(p.languageName, 'English');
  assert.equal(p.tone, 'neutral');
  assert.equal(p.maxWords, 120);
  assert.equal(p.usedDefaults, true);
});
