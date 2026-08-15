const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { startMockServer } = require('../mocks/server');
const { loadConfig } = require('../src/config');
const { createCache } = require('../src/gateway/cache');
const { buildRegistry } = require('../src/engine/contextRegistry');
const mockProvider = require('../src/llm/mockProvider');
const { run, PLAN, EXECUTE, buildContext, toPlanResponse, toAnswerResponse } = require('../src/pipeline');

const cfg = loadConfig();
let server;
let deps;

before(async () => {
  server = await startMockServer(0);
  deps = {
    cfg,
    registry: buildRegistry(cfg.registry),
    cache: createCache(),
    baseUrl: `http://localhost:${server.address().port}`,
    llm: mockProvider,
  };
});

after(() => server.close());

beforeEach(async () => {
  deps.cache.clear();
  await fetch(`${deps.baseUrl}/_control/reset`, { method: 'POST' });
});

const inject = (service, mode) => fetch(`${deps.baseUrl}/_control/fail`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ service, mode }),
});

const plan = (question, userId = 'user_101') =>
  run(PLAN, buildContext({ userId, question, requestId: 'req_test', deps }));

const full = (question, userId = 'user_101', over = {}) =>
  run([...PLAN, ...EXECUTE], buildContext({ userId, question, requestId: 'req_test', deps: { ...deps, ...over } }));

test('PLAN produces intent, selection, persona and prompt', async () => {
  const { ctx, trace } = await plan('Should I consider changing my job?');
  assert.equal(ctx.intent, 'career');
  assert.equal(ctx.intentMethod, 'rule');
  assert.equal(ctx.persona.maxWords, 250);
  assert.ok(ctx.prompt.system && ctx.prompt.user);
  assert.equal(trace.length, PLAN.length);
});

test('every PLAN stage is traced with a duration', async () => {
  const { trace } = await plan('Should I consider changing my job?');
  assert.deepEqual(trace.map((t) => t.stage),
    ['fetch_context', 'detect_intent', 'select_context', 'resolve_persona', 'build_prompt']);
  for (const entry of trace) {
    assert.equal(entry.ok, true);
    assert.equal(typeof entry.ms, 'number');
  }
});

test('PLAN never invokes the LLM generate method', async () => {
  let generated = false;
  const spy = { ...mockProvider, generate: async (...a) => { generated = true; return mockProvider.generate(...a); } };
  await run(PLAN, buildContext({ userId: 'user_101', question: 'Should I change my job?', requestId: 'r', deps: { ...deps, llm: spy } }));
  assert.equal(generated, false, '/debug must be LLM-free');
});

test('PLAN + EXECUTE produces the client response', async () => {
  const { ctx } = await full('Should I consider changing my job?');
  const body = toAnswerResponse(ctx);
  assert.deepEqual(Object.keys(body).sort(), ['answer', 'confidence', 'sourcesUsed']);
  assert.equal(body.confidence, 'HIGH');
  assert.ok(body.sourcesUsed.includes('Career Horoscope'));
});

test('the debug body matches the assignment contract and adds detail', async () => {
  const { ctx, trace } = await plan('Should I consider changing my job?');
  const body = toPlanResponse(ctx, trace);
  assert.equal(body.intent, 'career');
  assert.equal(body.language, 'English');
  assert.equal(body.tone, 'Motivational');
  assert.deepEqual(body.excludedContext, ['Relationship Horoscope']);
  assert.ok(body.selectedContext.includes('10th House'));
  assert.ok(body.expectedConfidence);
  assert.ok(Array.isArray(body.trace));
  assert.ok(body.promptPreview.reductionPct > 0);
});

test('debug output equals the plan half of a full run', async () => {
  const a = await plan('Should I consider changing my job?');
  const b = await full('Should I consider changing my job?');
  assert.deepEqual(
    toPlanResponse(a.ctx, a.trace).selectedContext,
    toPlanResponse(b.ctx, b.trace.slice(0, PLAN.length)).selectedContext,
  );
});

test('a failing upstream degrades the answer instead of failing it', async () => {
  await inject('kundli', '500');
  const { ctx } = await full('Should I consider changing my job?');
  const body = toAnswerResponse(ctx);
  assert.equal(body.confidence, 'MEDIUM');
  assert.ok(!body.sourcesUsed.includes('10th House'));
});

test('zero resolvable context skips the LLM entirely', async () => {
  for (const service of ['kundli', 'horoscope', 'panchang']) await inject(service, '500');
  let generated = false;
  const spy = { ...mockProvider, generate: async (...a) => { generated = true; return mockProvider.generate(...a); } };
  const { ctx } = await full('Should I change my job?', 'user_101', { llm: spy });
  assert.equal(generated, false, 'must not ask the model to answer without grounding');
  assert.equal(toAnswerResponse(ctx).confidence, 'LOW');
  assert.deepEqual(toAnswerResponse(ctx).sourcesUsed, []);
});

test('a non-critical stage failure is traced without aborting the run', async () => {
  const stages = [
    { name: 'ok', critical: true, fn: async () => ({ a: 1 }) },
    { name: 'boom', critical: false, fn: async () => { throw new Error('nope'); } },
    { name: 'after', critical: true, fn: async () => ({ b: 2 }) },
  ];
  const { ctx, trace } = await run(stages, {});
  assert.equal(ctx.b, 2);
  assert.equal(trace[1].ok, false);
  assert.equal(trace[1].error, 'nope');
});

test('a critical stage failure throws with the partial trace attached', async () => {
  const stages = [
    { name: 'ok', critical: true, fn: async () => ({ a: 1 }) },
    { name: 'boom', critical: true, fn: async () => { throw new Error('fatal'); } },
  ];
  await assert.rejects(() => run(stages, {}), (err) => {
    assert.equal(err.name, 'PipelineError');
    assert.equal(err.trace.length, 2);
    return true;
  });
});

test('bounded escalation adds excluded context once when the model reports insufficient', async () => {
  let calls = 0;
  const stubborn = {
    ...mockProvider,
    generate: async (prompt, opts) => {
      calls += 1;
      const r = await mockProvider.generate(prompt, opts);
      return { ...r, sufficient: calls === 1 ? false : true };
    },
  };
  const { ctx } = await full('Should I consider changing my job?', 'user_101', { llm: stubborn });
  assert.equal(calls, 2, 'exactly one escalation, never more');
  assert.equal(ctx.escalated, true);
});
