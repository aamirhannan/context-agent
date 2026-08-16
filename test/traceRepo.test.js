const { test, describe } = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');

const skip = !process.env.DATABASE_URL;

describe('traceRepo', { skip: skip && 'DATABASE_URL not set' }, () => {
  const traceRepo = require('../src/store/traceRepo');

  const makeCtx = (requestId) => ({
    requestId,
    userId: 'user_101',
    question: 'Should I change my job?',
    intent: 'career',
    intentMethod: 'rule',
    intentScore: 1,
    bundle: { kundli: { lagna: 'Libra' } },
    degradations: [],
    selection: {
      selected: [{ id: 'horoscope.career', label: 'Career Horoscope', text: 'x', estTokens: 20 }],
      excluded: [{ id: 'horoscope.relationship', label: 'Relationship Horoscope', reason: 'intent_rule' }],
      budget: { available: 192, sent: 20, reductionPct: 90 },
    },
    prompt: { system: 's', user: 'u', estTokens: 40 },
    generation: { sufficient: true, missingInfo: null, latencyMs: 120 },
    confidence: { band: 'HIGH' },
  });

  test('saves and retrieves a request record', async () => {
    const id = randomUUID();
    await traceRepo.save(makeCtx(id), [{ stage: 'fetch_context', ok: true, ms: 12 }]);
    const row = await traceRepo.get(id);
    assert.equal(row.request_id, id);
    assert.equal(row.intent, 'career');
    assert.equal(row.confidence, 'HIGH');
    assert.deepEqual(row.selected_context, ['Career Horoscope']);
    assert.equal(row.reduction_pct, 90);
    assert.equal(row.trace[0].stage, 'fetch_context');
  });

  test('stores enough to reproduce the request', async () => {
    const id = randomUUID();
    await traceRepo.save(makeCtx(id), []);
    const row = await traceRepo.get(id);
    assert.deepEqual(row.context_bundle, { kundli: { lagna: 'Libra' } });
    assert.match(row.prompt_text, /^s\n\n---\n\nu$/);
  });

  test('get returns null for an unknown request id', async () => {
    assert.equal(await traceRepo.get(randomUUID()), null);
  });

  test('save rejects rather than throwing synchronously, so callers can swallow it', async () => {
    await assert.rejects(() => traceRepo.save({ ...makeCtx('not-a-uuid') }, []));
  });
});
