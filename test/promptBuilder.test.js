const { test } = require('node:test');
const assert = require('node:assert');
const { buildPrompt, validateSources } = require('../src/prompt/promptBuilder');

const SELECTED = [
  { id: 'horoscope.career', label: 'Career Horoscope', text: 'Career outlook: Networking may bring new opportunities.', estTokens: 20 },
  { id: 'kundli.house.10', label: '10th House', text: '10th House - lord Moon, strength Strong', estTokens: 16 },
];
const PERSONA = { languageName: 'English', tone: 'motivational', toneInstruction: 'Encouraging and action-oriented.', maxWords: 250 };
const QUESTION = 'Should I consider changing my job?';

test('buildPrompt does not accept a bundle — only resolved items', () => {
  assert.equal(buildPrompt.length, 1, 'single destructured argument');
  const src = buildPrompt.toString();
  assert.ok(!src.includes('bundle'), 'prompt builder must not reference the fetched bundle');
});

test('includes every selected item, labelled', () => {
  const p = buildPrompt({ selected: SELECTED, persona: PERSONA, question: QUESTION });
  assert.ok(p.user.includes('[Career Horoscope]'));
  assert.ok(p.user.includes('[10th House]'));
  assert.ok(p.user.includes('lord Moon, strength Strong'));
});

test('excluded context never appears in the prompt', () => {
  const p = buildPrompt({ selected: SELECTED, persona: PERSONA, question: QUESTION });
  assert.ok(!p.user.includes('Relationship'));
  assert.ok(!p.user.includes('Avoid risky investments'));
});

test('carries the persona into the system prompt', () => {
  const p = buildPrompt({ selected: SELECTED, persona: PERSONA, question: QUESTION });
  assert.ok(p.system.includes('English'));
  assert.ok(p.system.includes('Encouraging and action-oriented.'));
  assert.ok(p.system.includes('250'));
});

test('states the grounding rules', () => {
  const p = buildPrompt({ selected: SELECTED, persona: PERSONA, question: QUESTION });
  assert.match(p.system, /ONLY the context/i);
  assert.match(p.system, /[Nn]ever invent/);
});

test('reports prompt size for logging', () => {
  const p = buildPrompt({ selected: SELECTED, persona: PERSONA, question: QUESTION });
  assert.ok(p.chars > 0);
  assert.equal(p.estTokens, Math.ceil(p.chars / 4));
});

test('validateSources keeps only labels that were actually sent', () => {
  const r = validateSources(['Career Horoscope', 'Relationship Horoscope'], SELECTED, ['Career Horoscope']);
  assert.deepEqual(r.sourcesUsed, ['Career Horoscope']);
  assert.deepEqual(r.hallucinated, ['Relationship Horoscope']);
  assert.equal(r.fellBack, false);
});

test('validateSources falls back to primary labels when nothing survives', () => {
  const r = validateSources(['Made Up Source'], SELECTED, ['Career Horoscope']);
  assert.deepEqual(r.sourcesUsed, ['Career Horoscope']);
  assert.equal(r.fellBack, true);
});

test('validateSources tolerates a missing or non-array claim', () => {
  assert.equal(validateSources(undefined, SELECTED, ['Career Horoscope']).fellBack, true);
  assert.equal(validateSources('nope', SELECTED, ['Career Horoscope']).fellBack, true);
});
