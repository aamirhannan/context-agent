const { PipelineError } = require('../errors');

/**
 * Runs an ordered list of stages, merging each stage's output into ctx and
 * recording one trace entry per stage.
 *
 * Deliberately a plain function: no hooks, no middleware, no event bus. This
 * single mechanism satisfies four separate requirements at once — debug-endpoint
 * explainability, request logging, latency logging, and prompt-size logging.
 *
 * A non-critical stage that throws is traced and skipped; the run continues
 * degraded. A critical stage that throws aborts with the partial trace attached,
 * so a failed request is still explainable.
 */
async function run(stages, ctx) {
  const trace = [];
  let current = ctx;

  for (const stage of stages) {
    const startedAt = performance.now();
    try {
      const output = await stage.fn(current);
      current = { ...current, ...output };
      trace.push({
        stage: stage.name,
        ok: true,
        ms: Number((performance.now() - startedAt).toFixed(1)),
        detail: stage.trace ? stage.trace(current) : undefined,
      });
    } catch (err) {
      trace.push({
        stage: stage.name,
        ok: false,
        ms: Number((performance.now() - startedAt).toFixed(1)),
        error: err.message,
      });
      if (stage.critical) throw new PipelineError(err, trace);
    }
  }

  return { ctx: current, trace };
}

module.exports = { run };
