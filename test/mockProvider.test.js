const { test } = require('node:test');
const assert = require('node:assert');
const mock = require('../src/llm/mockProvider');
const { getProvider } = require('../src/llm');

const PROMPT = {
  system: 'Language: English\nTone: Encouraging.\nLength: at most 250 words.',
  user: 'QUESTION: Should I change my job?\n\nCONTEXT:\n[Career Horoscope] Networking may bring new opportunities.\n[10th House] lord Moon, strength Strong',
};

test('generate returns the full provider contract', async () => {
  const r = await mock.generate(PROMPT, { maxWords: 250 });
  for (const key of ['answer', 'sourcesUsed', 'sufficient', 'missingInfo', 'model', 'latencyMs']) {
    assert.ok(key in r, `missing key ${key}`);
  }
  assert.equal(typeof r.answer, 'string');
  assert.ok(r.answer.length > 0);
});

test('generate cites only labels present in the prompt', async () => {
  const r = await mock.generate(PROMPT, { maxWords: 250 });
  assert.deepEqual(r.sourcesUsed.sort(), ['10th House', 'Career Horoscope']);
});

test('generate is deterministic', async () => {
  const a = await mock.generate(PROMPT, { maxWords: 250 });
  const b = await mock.generate(PROMPT, { maxWords: 250 });
  assert.equal(a.answer, b.answer);
});

test('generate respects maxWords', async () => {
  const r = await mock.generate(PROMPT, { maxWords: 20 });
  assert.ok(r.answer.split(/\s+/).length <= 20);
});

test('generate reports insufficient when no context was supplied', async () => {
  const r = await mock.generate({ system: PROMPT.system, user: 'QUESTION: x\n\nCONTEXT:\n(no context available)' }, { maxWords: 250 });
  assert.equal(r.sufficient, false);
  assert.deepEqual(r.sourcesUsed, []);
});

test('classifyIntent returns a configured intent name with a score', async () => {
  const names = ['career', 'relationship', 'health', 'finance', 'daily_summary', 'general'];
  const r = await mock.classifyIntent('Should I prioritize rest this week?', names);
  assert.ok(names.includes(r.intent));
  assert.ok(r.score >= 0 && r.score <= 1);
});

test('getProvider defaults to the mock provider', () => {
  delete process.env.LLM_PROVIDER;
  assert.equal(getProvider().name, 'mock');
});

test('both providers expose the same interface surface', () => {
  const openai = require('../src/llm/openaiProvider');
  assert.deepEqual(
    Object.keys(mock).sort(),
    Object.keys(openai).sort(),
  );
});
