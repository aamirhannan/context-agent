const { z } = require('zod');
const { run, PLAN, EXECUTE, buildContext, toAnswerResponse } = require('../pipeline');
const { ValidationError } = require('../errors');
const { forRequest } = require('../observability/logger');

const bodySchema = z.object({
  userId: z.string().min(1),
  question: z.string().min(1).max(2000),
});

module.exports = (deps) => async (req, res, next) => {
  const log = forRequest(req.requestId);

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return next(new ValidationError(`${issue.path.join('.')}: ${issue.message}`));
  }

  const startedAt = performance.now();

  try {
    const { ctx, trace } = await run(
      [...PLAN, ...EXECUTE],
      buildContext({ ...parsed.data, requestId: req.requestId, deps }),
    );

    res.json(toAnswerResponse(ctx));

    // One structured line per request, carrying the whole trace. This single
    // log satisfies the request/latency/prompt-size logging requirements.
    log.info({
      userId: ctx.userId,
      intent: ctx.intent,
      intentMethod: ctx.intentMethod,
      confidence: ctx.confidence.band,
      tokens: {
        available: ctx.selection.budget.available,
        sent: ctx.selection.budget.sent,
        reductionPct: ctx.selection.budget.reductionPct,
        promptEst: ctx.prompt.estTokens,
      },
      ms: {
        ...Object.fromEntries(trace.map((t) => [t.stage, t.ms])),
        total: Number((performance.now() - startedAt).toFixed(1)),
      },
      degradations: ctx.degradations,
      escalated: ctx.escalated,
    }, 'personalize');

    // Fire and forget: an audit write must never turn a good answer into a 500.
    if (deps.traceRepo) {
      deps.traceRepo.save(ctx, trace)
        .catch((err) => log.warn({ err: err.message }, 'trace persist failed'));
    }
  } catch (err) {
    next(err);
  }
};
