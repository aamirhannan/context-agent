const { fetchAll } = require('../gateway');
const { detectIntent } = require('../engine/intentDetector');
const { selectContext } = require('../engine/contextSelector');
const { resolveItem } = require('../engine/contextRegistry');
const { resolvePersona } = require('../engine/personalization');
const { computeConfidence } = require('../engine/confidence');
const { buildPrompt, validateSources } = require('../prompt/promptBuilder');
const { NotFoundError } = require('../errors');

function buildContext({ userId, question, requestId, deps }) {
  return { userId, question, requestId, deps };
}

// ---------------------------------------------------------------------------
// PLAN — everything up to and including the prompt. No answer generation.
// /debug/personalization runs exactly this array, so it cannot drift from
// /personalize: it is the same stages, one slice shorter.
// ---------------------------------------------------------------------------
const PLAN = [
  {
    name: 'fetch_context',
    critical: true,
    fn: async (ctx) => {
      const result = await fetchAll(ctx.userId, {
        cache: ctx.deps.cache,
        servicesConfig: ctx.deps.cfg.services.services,
        baseUrl: ctx.deps.baseUrl,
      });
      // A missing user is a client error; an unreachable user service is not.
      if (result.userMissing) throw new NotFoundError(`user '${ctx.userId}' not found`);
      return result;
    },
    trace: (ctx) => ({ sources: ctx.sourceStates, degradations: ctx.degradations }),
  },

  {
    name: 'detect_intent',
    critical: false, // a classifier outage must never fail the request
    fn: async (ctx) => {
      const r = await detectIntent(ctx.question, ctx.deps.cfg.intents, ctx.deps.llm);
      return { intent: r.intent, intentScore: r.score, intentMethod: r.method };
    },
    trace: (ctx) => ({ intent: ctx.intent, method: ctx.intentMethod, score: ctx.intentScore }),
  },

  {
    name: 'select_context',
    critical: true,
    fn: async (ctx) => {
      // detect_intent is non-critical, so cover the case where it threw.
      const intent = ctx.intent || 'general';
      const intentConfig = ctx.deps.cfg.intents.intents[intent];
      const selection = selectContext({
        intentConfig,
        registry: ctx.deps.registry,
        bundle: ctx.bundle,
        budgetTokens: ctx.deps.cfg.services.budgetTokens,
      });
      const primaryLabels = intentConfig.primary.map((id) => ctx.deps.registry.get(id).label);
      return { intent, intentConfig, selection, primaryLabels };
    },
    trace: (ctx) => ({
      selected: ctx.selection.selected.map((s) => s.label),
      excluded: ctx.selection.excluded.map((e) => e.label),
      budget: ctx.selection.budget,
    }),
  },

  {
    name: 'resolve_persona',
    critical: false,
    fn: async (ctx) => ({
      persona: resolvePersona(ctx.bundle.user, ctx.deps.cfg.personalization),
    }),
    trace: (ctx) => ({
      language: ctx.persona?.languageName,
      tone: ctx.persona?.tone,
      maxWords: ctx.persona?.maxWords,
      usedDefaults: ctx.persona?.usedDefaults,
    }),
  },

  {
    name: 'build_prompt',
    critical: true,
    fn: async (ctx) => {
      const persona = ctx.persona || resolvePersona(null, ctx.deps.cfg.personalization);
      return {
        persona,
        prompt: buildPrompt({ selected: ctx.selection.selected, persona, question: ctx.question }),
      };
    },
    trace: (ctx) => ({ estTokens: ctx.prompt.estTokens, chars: ctx.prompt.chars }),
  },
];

// ---------------------------------------------------------------------------
// EXECUTE — generation and assembly.
// ---------------------------------------------------------------------------
const NO_CONTEXT_ANSWER =
  'I could not access enough of your chart to answer this reliably right now. Please try again shortly.';

const EXECUTE = [
  {
    name: 'llm_generate',
    critical: true,
    fn: async (ctx) => {
      // Never ask the model to answer without grounding — a confident,
      // ungrounded reading is the exact failure the grounding rules prevent.
      if (ctx.selection.selected.length === 0) {
        return {
          generation: {
            answer: NO_CONTEXT_ANSWER,
            sourcesUsed: [],
            sufficient: false,
            missingInfo: 'no context available',
            model: 'none',
            latencyMs: 0,
          },
          escalated: false,
          llmSkipped: true,
        };
      }

      let generation = await ctx.deps.llm.generate(ctx.prompt, { maxWords: ctx.persona.maxWords });
      let prompt = ctx.prompt;
      let escalated = false;

      // Bounded escalation, max depth 1. The only loop in the system: it
      // captures self-correction without the cost of an open agentic graph.
      const canEscalate = ctx.deps.cfg.services.escalation.enabled
        && generation.sufficient === false
        && ctx.selection.excluded.length > 0;

      if (canEscalate) {
        const extra = ctx.selection.excluded
          .map((e) => resolveItem(ctx.deps.registry.get(e.id), ctx.bundle))
          .filter(Boolean);

        if (extra.length) {
          prompt = buildPrompt({
            selected: [...ctx.selection.selected, ...extra],
            persona: ctx.persona,
            question: ctx.question,
          });
          generation = await ctx.deps.llm.generate(prompt, { maxWords: ctx.persona.maxWords });
          escalated = true;
        }
      }

      return { generation, prompt, escalated, llmSkipped: false };
    },
    trace: (ctx) => ({
      model: ctx.generation.model,
      llmMs: ctx.generation.latencyMs,
      sufficient: ctx.generation.sufficient,
      escalated: ctx.escalated,
      skipped: ctx.llmSkipped,
    }),
  },

  {
    name: 'assemble',
    critical: true,
    fn: async (ctx) => {
      const validation = validateSources(
        ctx.generation.sourcesUsed,
        ctx.selection.selected,
        ctx.primaryLabels,
      );
      const confidence = computeConfidence({
        intentMethod: ctx.intentMethod || 'fallback',
        intentScore: ctx.intentScore ?? 0.4,
        primaryCoverage: ctx.selection.primaryCoverage,
        sourceStates: ctx.sourceStates,
        sufficient: ctx.generation.sufficient,
      }, ctx.deps.cfg.confidence);
      return { validation, confidence };
    },
    trace: (ctx) => ({
      confidence: ctx.confidence.band,
      score: ctx.confidence.score,
      caps: ctx.confidence.caps,
      hallucinatedSources: ctx.validation.hallucinated,
    }),
  },
];

function toAnswerResponse(ctx) {
  return {
    answer: ctx.generation.answer,
    confidence: ctx.confidence.band,
    sourcesUsed: ctx.validation.sourcesUsed,
  };
}

const titleCase = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * The assignment's debug contract at top level, with additional explanation
 * below it. Their keys are never broken — this is a superset, not a rewrite.
 */
function toPlanResponse(ctx, trace) {
  const expected = computeConfidence({
    intentMethod: ctx.intentMethod || 'fallback',
    intentScore: ctx.intentScore ?? 0.4,
    primaryCoverage: ctx.selection.primaryCoverage,
    sourceStates: ctx.sourceStates,
    sufficient: null, // no LLM verdict exists on the debug path
  }, ctx.deps.cfg.confidence);

  return {
    intent: ctx.intent,
    selectedContext: ctx.selection.selected.map((s) => s.label),
    excludedContext: ctx.selection.excluded.map((e) => e.label),
    language: ctx.persona.languageName,
    tone: titleCase(ctx.persona.tone),

    maxWords: ctx.persona.maxWords,
    requestId: ctx.requestId,
    intentMethod: ctx.intentMethod,
    expectedConfidence: expected.band,
    exclusionReasons: [
      ...ctx.selection.excluded.map((e) => ({ label: e.label, reason: e.reason })),
      ...ctx.selection.notSelected
        .filter((n) => n.reason !== 'not_relevant')
        .map((n) => ({ label: n.label, reason: n.reason })),
    ],
    degradations: ctx.degradations,
    // Context figures and whole-prompt figures are different denominators;
    // name them so nobody reads a 56% reduction against a 249-token prompt.
    promptPreview: {
      contextAvailableTokens: ctx.selection.budget.available,
      contextSentTokens: ctx.selection.budget.sent,
      contextReductionPct: ctx.selection.budget.reductionPct,
      fullPromptEstTokens: ctx.prompt.estTokens,
    },
    trace,
  };
}

module.exports = { PLAN, EXECUTE, buildContext, toAnswerResponse, toPlanResponse };
