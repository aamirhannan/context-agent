// Pure except for the injected provider. No imports from gateway/llm/store.

const FALLBACK_INTENT = 'general';

function scoreIntent(question, match) {
  const lower = question.toLowerCase();
  let hits = 0;
  for (const keyword of match.keywords) {
    if (new RegExp(`\\b${keyword}\\b`, 'i').test(lower)) hits += 1;
  }
  for (const pattern of match.patterns) {
    if (new RegExp(pattern, 'i').test(lower)) hits += 2; // patterns are stronger evidence
  }
  return hits;
}

/**
 * Deterministic tier. Returns the highest-scoring intent, or null when nothing
 * matched. `general` is never returned here — it is a fallback, not a match.
 */
function detectByRules(question, intentsConfig) {
  const scored = [];
  for (const [name, intent] of Object.entries(intentsConfig.intents)) {
    if (name === FALLBACK_INTENT) continue;
    const hits = scoreIntent(question, intent.match);
    if (hits > 0) scored.push({ name, hits });
  }
  if (scored.length === 0) return null;

  const top = Math.max(...scored.map((s) => s.hits));
  const leaders = scored.filter((s) => s.hits === top);

  // A tie is ambiguity, not a decision. "Will my marriage work out?" scores 1 for
  // career ("work") and 1 for relationship ("marriage"); picking by declaration
  // order would silently answer the wrong question. Escalate to the LLM instead —
  // resolving genuinely ambiguous phrasing is exactly what that tier is for.
  if (leaders.length > 1) return null;

  return { intent: leaders[0].name, score: 1, method: 'rule' };
}

/**
 * Hybrid: rules first (free, deterministic), LLM only for the ambiguous tail,
 * `general` when the LLM is unavailable or answers with an unknown intent.
 */
async function detectIntent(question, intentsConfig, llmProvider) {
  const ruled = detectByRules(question, intentsConfig);
  if (ruled) return ruled;

  const names = Object.keys(intentsConfig.intents);

  if (llmProvider && typeof llmProvider.classifyIntent === 'function') {
    try {
      const result = await llmProvider.classifyIntent(question, names);
      if (result && names.includes(result.intent)) {
        return { intent: result.intent, score: result.score, method: 'llm' };
      }
    } catch {
      // fall through — an unavailable classifier must never fail the request
    }
  }

  return { intent: FALLBACK_INTENT, score: 0.4, method: 'fallback' };
}

module.exports = { detectByRules, detectIntent, FALLBACK_INTENT };
