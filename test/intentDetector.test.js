const { test } = require('node:test');
const assert = require('node:assert');
const { loadConfig } = require('../src/config');
const { detectByRules, detectIntent } = require('../src/engine/intentDetector');

const intentsConfig = loadConfig().intents;

test('matches career from an explicit keyword', () => {
  const r = detectByRules('Should I consider changing my job this year?', intentsConfig);
  assert.equal(r.intent, 'career');
  assert.equal(r.method, 'rule');
  assert.equal(r.score, 1);
});

test('matches relationship, health and finance from keywords', () => {
  assert.equal(detectByRules('How does this month look for my relationship?', intentsConfig).intent, 'relationship');
  assert.equal(detectByRules('What should I focus on for my health?', intentsConfig).intent, 'health');
  assert.equal(detectByRules('Should I invest in property now?', intentsConfig).intent, 'finance');
});

test('matches daily_summary for temporally scoped questions', () => {
  assert.equal(detectByRules("Can you summarize today's guidance?", intentsConfig).intent, 'daily_summary');
});

test('returns null for a question with no signal', () => {
  assert.equal(detectByRules('Tell me something interesting.', intentsConfig), null);
});

test('never matches the general intent by rule — general is a fallback only', () => {
  const r = detectByRules('general', intentsConfig);
  assert.ok(r === null || r.intent !== 'general');
});

test('detectIntent escalates to the LLM when rules find nothing', async () => {
  const calls = [];
  const provider = {
    classifyIntent: async (q, names) => { calls.push({ q, names }); return { intent: 'career', score: 0.82 }; },
  };
  const r = await detectIntent('Tell me something interesting.', intentsConfig, provider);
  assert.equal(r.intent, 'career');
  assert.equal(r.method, 'llm');
  assert.equal(r.score, 0.82);
  assert.equal(calls.length, 1);
});

test('detectIntent does NOT call the LLM when rules match', async () => {
  let called = false;
  const provider = { classifyIntent: async () => { called = true; return { intent: 'health', score: 1 }; } };
  const r = await detectIntent('Should I change my job?', intentsConfig, provider);
  assert.equal(r.method, 'rule');
  assert.equal(called, false, 'rule-resolved questions must not incur an LLM call');
});

test('detectIntent falls back to general when the LLM throws', async () => {
  const provider = { classifyIntent: async () => { throw new Error('upstream down'); } };
  const r = await detectIntent('Tell me something interesting.', intentsConfig, provider);
  assert.equal(r.intent, 'general');
  assert.equal(r.method, 'fallback');
  assert.equal(r.score, 0.4);
});

test('detectIntent falls back to general when no provider is supplied', async () => {
  const r = await detectIntent('Tell me something interesting.', intentsConfig, null);
  assert.equal(r.intent, 'general');
  assert.equal(r.method, 'fallback');
});

test('detectIntent rejects an LLM answer that is not a configured intent', async () => {
  const provider = { classifyIntent: async () => ({ intent: 'astrophysics', score: 0.9 }) };
  const r = await detectIntent('Tell me something interesting.', intentsConfig, provider);
  assert.equal(r.intent, 'general');
  assert.equal(r.method, 'fallback');
});

test('a rule tie escalates instead of picking by declaration order', () => {
  // "work" scores 1 for career, "marriage" scores 1 for relationship.
  // Declaration order must not silently decide this.
  assert.equal(detectByRules('Will my marriage work out?', intentsConfig), null);
});

test('an unambiguous winner still resolves by rule', () => {
  const r = detectByRules('Will my marriage survive this year?', intentsConfig);
  assert.equal(r.intent, 'relationship');
  assert.equal(r.method, 'rule');
});

test('a pattern hit outweighs a single competing keyword', () => {
  // career scores 3 (kw:job + pattern chang.*job), health scores 1 (kw:sick).
  const r = detectByRules('Should I change my job? I am sick of it.', intentsConfig);
  assert.equal(r.intent, 'career');
});

test('a genuine multi-domain question escalates rather than guessing', () => {
  // "change my job for my health" scores 3 for career AND 3 for health.
  // Neither answer is right on its own, so the rule tier declines to choose.
  assert.equal(detectByRules('Should I change my job for my health?', intentsConfig), null);
});
