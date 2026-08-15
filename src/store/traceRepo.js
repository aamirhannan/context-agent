const { getPool } = require('./db');

const INSERT = `
insert into requests (
  request_id, user_id, question, intent, intent_method, intent_score, confidence,
  selected_context, excluded_context, available_tokens, prompt_tokens, reduction_pct,
  total_ms, llm_ms, sufficient, missing_info, degradations,
  context_bundle, prompt_text, trace
) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
on conflict (request_id) do nothing`;

/**
 * One row per request — not one row per stage. Fields worth aggregating on are
 * promoted to columns; everything else stays in jsonb.
 *
 * Called fire-and-forget after the response is sent. Never awaited on the
 * request path: an audit write must not turn a good answer into a 500.
 */
async function save(ctx, trace) {
  const totalMs = trace.reduce((acc, t) => acc + (t.ms || 0), 0);

  await getPool().query(INSERT, [
    ctx.requestId,
    ctx.userId,
    ctx.question,
    ctx.intent,
    ctx.intentMethod,
    ctx.intentScore,
    ctx.confidence?.band,
    ctx.selection.selected.map((s) => s.label),
    JSON.stringify(ctx.selection.excluded),
    ctx.selection.budget.available,
    ctx.prompt.estTokens,
    ctx.selection.budget.reductionPct,
    Math.round(totalMs),
    ctx.generation?.latencyMs ?? null,
    ctx.generation?.sufficient ?? null,
    ctx.generation?.missingInfo ?? null,
    ctx.degradations,
    JSON.stringify(ctx.bundle),
    `${ctx.prompt.system}\n\n---\n\n${ctx.prompt.user}`,
    JSON.stringify(trace),
  ]);
}

async function get(requestId) {
  const { rows } = await getPool().query('select * from requests where request_id = $1', [requestId]);
  return rows[0] || null;
}

module.exports = { save, get };
