const { z } = require('zod');
const { run, PLAN, buildContext, toPlanResponse } = require('../pipeline');
const { ValidationError } = require('../errors');

const bodySchema = z.object({
  userId: z.string().min(1),
  question: z.string().min(1).max(2000),
});

/**
 * Runs the PLAN half of the very same stage array /personalize uses.
 * It cannot drift from the real pipeline, and it never invokes the LLM for
 * answer generation — that is structural, not a convention.
 */
module.exports = (deps) => async (req, res, next) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return next(new ValidationError(`${issue.path.join('.')}: ${issue.message}`));
  }

  try {
    const { ctx, trace } = await run(
      PLAN,
      buildContext({ ...parsed.data, requestId: req.requestId, deps }),
    );
    res.json(toPlanResponse(ctx, trace));
  } catch (err) {
    next(err);
  }
};
