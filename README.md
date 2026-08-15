# Personalized AI Context Engine

The intelligence layer between MyNaksh's structured astrological services and an LLM. It gathers
user context from four upstream services, works out what the question is actually about, selects
only the context that matters, personalizes language/tone/length from the user profile, builds an
optimized prompt, and returns a grounded answer with a confidence band and the sources it used.

**It is not a chatbot.** The interesting part is the layer in between — which is where nearly all
of this README is aimed.

---

## Run it

Nothing to install beyond npm. No Docker, no API key, no database required.

```bash
npm install
cp .env.example .env

npm run mocks     # terminal 1 — the four upstream services on :4000
npm start         # terminal 2 — the context engine on :3000

npm test          # 107 tests
npm run demo      # personalization, context optimization, degradation
```

<details>
<summary><b>With a real LLM</b></summary>

```bash
# in .env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

Nothing else changes. The provider is selected in one place (`src/llm/index.js`) and no
provider-specific type crosses that boundary.
</details>

<details>
<summary><b>With Postgres backing the mock services (optional)</b></summary>

```bash
docker compose up -d              # add DB_PORT=5433 if 5432 is taken
export DATABASE_URL=postgres://mynaksh:mynaksh@localhost:5432/mynaksh
npm run db:seed                   # 3 users, 61 days of horoscope and panchang

npm run mocks     # now served from Postgres
npm start         # request traces now persisted; /debug/requests/:id enabled
```

Without `DATABASE_URL` the mocks serve from JSON fixtures and trace persistence is off. Both
paths are tested; the Postgres suites skip automatically when it is not configured.
</details>

---

## Endpoints

### `POST /personalize`

```json
// request
{ "userId": "user_101", "question": "Should I consider changing my job in the next few months?" }
```
```json
// response 200
{
  "answer": "Regarding \"Should I consider changing my job in the next few months?\" — Career Horoscope indicates: Networking may bring new opportunities. 10th House indicates: lord Moon, strength Strong. ...",
  "confidence": "HIGH",
  "sourcesUsed": ["Career Horoscope", "10th House", "Current Dasha", "Today's Panchang"]
}
```

### `POST /debug/personalization`

Runs the same pipeline with generation skipped. Returns the assignment's contract at top level,
with the reasoning below it.

```json
{
  "intent": "career",
  "selectedContext": ["Career Horoscope", "10th House", "Current Dasha", "Today's Panchang"],
  "excludedContext": ["Relationship Horoscope"],
  "language": "English",
  "tone": "Motivational",

  "maxWords": 250,
  "requestId": "0b8e4c3a-8219-4b72-bf66-cf7d407609dd",
  "intentMethod": "rule",
  "expectedConfidence": "HIGH",
  "exclusionReasons": [{ "label": "Relationship Horoscope", "reason": "intent_rule" }],
  "degradations": [],
  "promptPreview": {
    "contextAvailableTokens": 192,
    "contextSentTokens": 84,
    "contextReductionPct": 56,
    "fullPromptEstTokens": 249
  },
  "trace": [
    { "stage": "fetch_context",  "ok": true, "ms": 0.4, "detail": { "sources": { "kundli": "fresh", "horoscope": "fresh", "panchang": "fresh" }, "degradations": [] } },
    { "stage": "detect_intent",  "ok": true, "ms": 0.7, "detail": { "intent": "career", "method": "rule", "score": 1 } },
    { "stage": "select_context", "ok": true, "ms": 0.8, "detail": { "selected": ["Career Horoscope", "10th House", "Current Dasha", "Today's Panchang"], "excluded": ["Relationship Horoscope"], "budget": { "available": 192, "sent": 84, "reductionPct": 56 } } },
    { "stage": "resolve_persona","ok": true, "ms": 0,   "detail": { "language": "English", "tone": "motivational", "maxWords": 250, "usedDefaults": false } },
    { "stage": "build_prompt",   "ok": true, "ms": 0,   "detail": { "estTokens": 249, "chars": 996 } }
  ]
}
```

### `GET /health`
Upstream reachability, cache hit rate, active LLM provider, trace-store status.

### `GET /debug/requests/:requestId`
*(Postgres mode only.)* The complete stored record of any past call — intent, confidence, token
figures, per-stage timings, the exact prompt sent, and the context bundle that produced it. Enough
to reproduce any answer.

---

## Architecture

Full diagrams in **[ARCHITECTURE.md](ARCHITECTURE.md)**. The one idea worth stating here:

> **The pipeline is split into `plan()` and `execute()`.**

```js
const PLAN    = [fetch_context, detect_intent, select_context, resolve_persona, build_prompt];
const EXECUTE = [llm_generate, assemble];

POST /personalize            →  run([...PLAN, ...EXECUTE], ctx)
POST /debug/personalization  →  run(PLAN, ctx)
```

The debug endpoint **cannot drift** from the real pipeline, because it *is* the real pipeline with
the last two stages not called. It is LLM-free by construction, not by a parallel implementation
someone has to keep in sync. There is a test asserting the two produce identical selections.

A ~40-line stage runner records one trace entry per stage. That single mechanism satisfies four
separate requirements at once: debug explainability, request logging, latency logging, and prompt
size logging.

---

## The Personalization Engine

### The context registry

Every item that can ever reach the LLM has a stable ID and one entry in `config/registry.yaml`:

```yaml
- id: kundli.house.10
  label: "10th House"                                   # appears in sourcesUsed
  source: kundli                                        # which upstream provides it
  path: "houses.10"                                     # where to extract it
  render: "10th House - lord {lord}, strength {strength}"
  estTokens: 16
```

The complete universe is **11 items**: 6 from Kundli, 4 from Horoscope, 1 from Panchang.

### Intent configuration

`config/intents.yaml` references **IDs only** — never service names, never JSON paths:

```yaml
career:
  match:
    keywords: [job, career, work, promotion, salary, boss, office, business, interview, appraisal, resign]
    patterns: ["chang.*job", "switch.*compan", "quit.*work", "new.*role"]
  primary:   [horoscope.career, kundli.house.10]
  secondary: [kundli.dasha, panchang.today]
  exclude:   [horoscope.relationship]
```

Six intents. The first four reproduce the assignment's example mapping exactly; `finance` and
`daily_summary` cover the remaining question types.

### Selection

```
selected = (primary ∪ secondary) − exclude
```

**Exclude always wins.** Primary is never dropped for budget — missing primary is a confidence
signal, not a budgeting one. Two distinct kinds of exclusion are tracked:

| | |
|---|---|
| `excludedContext` | the explicit `exclude` list — deliberate and contrastive. *"This looked relevant and I ruled it out."* |
| `notSelected` | the implicit remainder, reason `not_relevant`. Reported in detail only. |

Only the first is interesting, which is why the assignment's own example shows exactly one entry
rather than the seven items a career question doesn't select.

### Extensibility

This is the claim, and it is checkable:

| Change | Files touched | Engine code changed |
|---|---|---|
| Add an intent (`education`, `travel`, `marriage`) | `intents.yaml` — one block | **0** |
| Add a context field | `registry.yaml` + the ID into intents | **0** |
| **Add a whole upstream service** | one client + N registry entries | **0** |
| Add a tone | `personalization.yaml` — one line | **0** |
| Add a language | one line | **0** |
| Swap OpenAI → Claude → mock | one env var | **0** |
| Retune what `career` pulls | reorder IDs in YAML | **0** |

Three things make it hold:

1. **Config references stable IDs**, so storage layout changes never touch config.
2. **Config is Zod-validated at boot**, with cross-file checks. A typo'd ID crashes startup with
   `unknown context id 'kundli.house.11' in intents.career.primary` rather than silently producing
   empty context in production. Config-driven *without* validation just relocates your bugs.
3. **`src/engine/` is pure** — no HTTP, no cache, no LLM, no Express.

```bash
grep -rn "if (intent ===" src/                                    # empty — no intent conditionals
grep -rn "require(.*\(gateway\|llm\|store\|express\)" src/engine/ # empty — engine is pure
```

---

## How context is optimized

Five stacked reductions, largest first:

1. **Intent-based exclusion** — a career question never carries relationship or health horoscopes,
   nor the 6th and 7th houses.
2. **Prose rendering instead of raw JSON.** `{"houses":{"10":{"lord":"Moon","strength":"Strong"}}}`
   becomes `10th House - lord Moon, strength Strong`. Same information, roughly half the tokens,
   and it reads better to the model.
3. **Registry-level pruning** — fields no intent needs have no registry entry, so they cannot leak in.
4. **Token budget with protected primary** — trims the secondary tail only.
5. **No conversation history** — nothing accumulates request over request.

### Measured, not claimed

Real output from `npm run demo`:

| Intent | Available | Sent | Saved | Items | Excluded |
|---|---|---|---|---|---|
| `career` | 192 | 84 | **56%** | 4 | Relationship Horoscope |
| `relationship` | 192 | 64 | **67%** | 4 | Career Horoscope |
| `health` | 192 | 72 | **63%** | 4 | Finance Horoscope |
| `finance` | 192 | 48 | **75%** | 3 | Relationship Horoscope |
| `daily_summary` | 192 | 88 | **54%** | 4 | — |
| `general` | 192 | 192 | 0% | 11 | — |

`general` correctly sends everything — that is the fallback doing its job, not a failure. Every
request logs its own figures, so this is measured per call rather than asserted once.

### Grounding, both directions

Nothing extra goes in: `buildPrompt(selected, persona, question)` takes **no bundle parameter**, so
excluded context is unreachable at prompt-build time rather than merely unused.

Nothing invented comes out: the model's claimed `sourcesUsed` is **intersected** with the labels
actually sent. Anything outside that set is dropped and logged as `hallucinated_source`.

And if zero context resolves, **the LLM is never called** — the service returns a graceful message
at `LOW` confidence rather than producing confident, ungrounded astrology.

---

## Personalization has four axes

| Axis | Source | Effect |
|---|---|---|
| **What context** | intent × registry config | **changes what the answer knows** |
| Language | `user.language` | English / Hindi |
| Tone | `user.tonePreference` | motivational / neutral / direct |
| Depth | `user.subscription` | premium 250 words, free 120 |

Axes 2–4 are prompt decoration. Axis 1 is the one that matters, because it changes the substance
of the answer rather than its style.

Same question, three users (`npm run demo`, section 1):

| User | Language | Tone | Max words |
|---|---|---|---|
| `user_101` | English | Motivational | 250 |
| `user_202` | Hindi | Neutral | 120 |
| `user_303` | English | Direct | 250 |

---

## Confidence

```js
score = 0.4*intentConfidence + 0.4*primaryCoverage + 0.2*sourceHealth

if (intentMethod === 'fallback')  score = min(score, 0.7);  // we did not understand the question
if (sufficient === false)         score = min(score, 0.5);  // the model said so itself
if (primaryCoverage === 0)        score = min(score, 0.4);

band = score >= 0.8 ? 'HIGH' : score >= 0.5 ? 'MEDIUM' : 'LOW';
```

| Factor | Value |
|---|---|
| `intentConfidence` | rule → 1.0 · LLM → the model's score · fallback → 0.4 |
| `primaryCoverage` | fraction of the intent's primary items that resolved |
| `sourceHealth` | over needed sources: fresh 1.0 · stale 0.6 · missing 0 |

Weights and thresholds live in `config/confidence.yaml`. `computeConfidence` is a pure function
with table-driven tests, and the contributing factors plus any caps applied are logged and
persisted — so every band has a recorded *why*.

Real degradation, from `npm run demo` section 3:

| Upstream state | Confidence | Sources used | HTTP |
|---|---|---|---|
| all healthy | **HIGH** | Career Horoscope, 10th House, Current Dasha, Today's Panchang | 200 |
| kundli down | **MEDIUM** | Career Horoscope, Today's Panchang | 200 |
| kundli + horoscope down | **LOW** | Today's Panchang | 200 |

`/debug/personalization` has no LLM verdict, so it reports **`expectedConfidence`** — the
pre-generation band. Honest about the two-phase nature rather than faking a number.

---

## Resilience

```yaml
kundli: { timeoutMs: 800, retries: 2, backoffMs: 100, cacheTtlMs: 3600000, cacheStaleMaxMs: 86400000 }
```

- `Promise.allSettled` over all four services — one dying never kills the others
- Retry on 5xx and timeouts with jittered backoff; **never** on 4xx
- Upstream responses Zod-validated at the gateway, so a malformed payload degrades cleanly instead
  of interpolating `undefined` into a prompt
- **Stale-while-error**: entries survive past TTL up to `staleMaxMs`. On failure, stale data is
  served and flagged, and `sourceHealth` drops to 0.6 — so confidence reflects it automatically
- `panchang` is cached by **date alone**, not per user: it takes no `userId` and is identical for
  everyone on a given day

### Error handling

| Situation | Response |
|---|---|
| Invalid request body | `400` |
| User service **404** | `404` — that user genuinely does not exist |
| User service timeout/5xx | `200` — default persona, confidence degraded |
| Kundli / Horoscope / Panchang fail | `200` — answer from what resolved |
| **Zero context resolved** | `200`, **LLM skipped**, graceful message, `LOW` |
| LLM fails after retry | `503` + `requestId` |
| Invalid configuration | **fails at boot**, never at request time |

Two deliberate decisions. **A missing user and an unreachable user service are different failures**
— the first is a client error, the second is ours, and we can still answer with a default persona.
And the only non-200 paths in the whole service are a nonexistent user, a malformed request, and a
dead LLM.

---

## Observability

One structured pino line per request, carrying the whole trace:

```json
{ "requestId":"0b8e4c3a","userId":"user_101","intent":"career","intentMethod":"rule",
  "confidence":"HIGH","tokens":{"available":192,"sent":84,"reductionPct":56,"promptEst":249},
  "ms":{"fetch_context":0.4,"detect_intent":0.7,"select_context":0.8,"build_prompt":0,
        "llm_generate":0.1,"assemble":0,"total":4},
  "degradations":[],"escalated":false }
```

In Postgres mode every request is also persisted — one row, not one row per stage — with the
aggregatable fields promoted to columns and the rest in `jsonb`. Written **after** the response and
never awaited: an audit insert must not turn a good answer into a 500.

```sql
-- which intents are under-served by the current context config?
select intent,
       count(*) filter (where sufficient = false) as insufficient,
       count(*) as total
from requests group by intent order by insufficient desc;

-- average token reduction by intent
select intent, round(avg(reduction_pct)) as avg_reduction_pct
from requests group by intent;
```

That first query is the feedback loop: the model reports `sufficient: false` and `missingInfo`, so
**the system tells you which of your intent rules are wrong** instead of you having to guess.

---

## Assumptions

- **`birthDetails` is deliberately excluded from LLM context.** It is PII, and it is redundant —
  the kundli is the derived output of that birth data. Excluding it is simultaneously a privacy
  decision and a token optimization.
- **The User service is configuration, not context.** `language`, `tonePreference` and
  `subscription` shape *how* the model answers; they never appear as astrological facts.
- **Panchang is global per date.** It takes no `userId`, so it is cached by date and shared across
  all users.
- **The Kundli payload exposes only houses 6, 7 and 10.** `finance` therefore has no natural house
  context (2nd, 11th) and leans on the finance horoscope, dasha and lagna. This is a gap in the
  given data, not in the design — filling it is one registry entry plus one line of YAML, with zero
  engine changes.
- **Horoscopes are daily**, so they are keyed `(user_id, for_date)` and seeded across a date range.
- Two extra users (`user_202`, `user_303`) were added beyond the one in the brief, because
  demonstrating personalization requires contrast.

---

## Trade-offs

Each with the trigger that would reverse it — that is what makes a trade-off considered rather than
an excuse.

| Decision | Chose | Why | Revisit when |
|---|---|---|---|
| **Agentic graph vs deterministic pipeline** | **Deterministic** | The entire 11-item context universe is fetched concurrently up front. A sufficiency-and-refetch loop would re-request bytes already in memory — it cannot add information, only 4–8× latency and spend. | The corpus becomes unbounded (RAG over shastra texts), or questions become multi-turn or multi-hop |
| Intent: rules vs LLM | Hybrid | Rules resolve the common path for free and deterministically; the LLM handles only the ambiguous tail. Also what keeps `/debug` genuinely LLM-free. | Hinglish / code-switched volume grows |
| Single vs multi-intent | Single + `general` | Matches the brief's single-string `intent`; simpler budgeting and explanation. | "career *and* health?" questions become common |
| Cache: in-memory vs Redis | In-memory | Single instance, and the brief asks for in-memory. | Horizontal scaling — stampedes and cross-instance inconsistency |
| Tokens: estimated vs `tiktoken` | Estimated (`chars/4`) | Avoids a dependency and per-request latency; the budget is soft and the *ratio* is what matters. | Hard context limits or real cost accounting |
| RAG / vector search | **None** | 11 known fields, no corpus. Embeddings would be pure ceremony. | A remedies/shastra corpus or conversation history exists |
| Mocks: HTTP server vs `require(json)` | **Real HTTP server** | Importing fixtures would leave every retry, timeout and partial-failure path unexecuted. Resilience code that never runs is decoration. | Never |
| Trace: response vs store | Both | Response for the debug endpoint, Postgres for durability and analytics. | At volume, traces belong in a separate analytics store |
| Streaming | No | Answers are capped at 250 words. | Longer answers, or perceived latency matters |
| Language: JS vs TS | Plain JS + Zod | Zod recovers boot-time config safety without a build step. | Team scale |
| Postgres required vs optional | **Optional** | `npm start` must work with zero infrastructure — a reviewer who cannot start Docker still sees a working system. | Never |

### On the agentic question specifically

This was the biggest design decision, so it deserves more than a table row.

An agentic retrieval loop exists to solve *"the corpus is too large to fetch whole — decide what to
pull, assess sufficiency, pull more."* That problem does not exist here. The context universe is 11
items across 4 services, and the brief instructs you to fetch all of them concurrently. A second
loop would assess the bundle, decide it needs more, call its tools, and receive **the identical
bytes it already holds.**

The genuinely agentic decision — *is this context sufficient?* — is kept, without the loop: the
generation call returns `sufficient` and `missingInfo` in its structured output. That feeds
confidence scoring, feeds the config-tuning query above, and triggers **one hard-capped escalation**
(max depth 1, only when excluded context actually exists to add). Self-correction, at the cost of
one extra call in the rare case instead of 4–8× on every request.

---

## What I intentionally simplified

- Token counts are estimated (`chars/4`), not tokenized
- `maxWords` is instructed, not enforced by truncation
- Hindi is produced by instruction, not a translation layer
- The in-memory cache is an unbounded `Map` (marked in-code with its upgrade path)
- The intent→context mappings are my reading of the brief's example table; the `finance` mapping in
  particular would want an astrologer's input — which is exactly why it lives in YAML

## Production concerns left out

- No authentication, rate limiting, or quota enforcement
- No retention policy or PII redaction on `requests.context_bundle` / `requests.prompt_text` —
  both contain birth details and would need TTL plus field-level redaction
- Traces are written to the primary database; at real volume they belong in a separate analytics store
- No distributed cache, so horizontal scaling would cause stampedes and cross-instance inconsistency
- No circuit breaker — retries alone can amplify load against a struggling upstream
- No prompt-injection defence on the free-text `question` field
- `/debug/cache/flush` is unauthenticated and therefore mounted only when `NODE_ENV !== 'production'`

## With another day

- `POST /debug/replay` — re-run a stored request deterministically from its saved `context_bundle`
  (the data is already persisted; only the endpoint is missing)
- An eval harness over a labelled question set, scoring context-selection precision and recall.
  This is the real gap: correctness of selection is currently asserted by unit tests over
  hand-written cases, not measured against a corpus
- Weighted multi-intent selection
- Per-upstream circuit breaker
- `tiktoken` for exact budgeting

---

## Testing

107 tests, `node:test`, no framework dependency.

```bash
npm test                                    # 107 pass
DATABASE_URL=postgres://... npm test        # 114 pass (Postgres suites included)
```

`src/engine/` is pure, so the tests that matter most need no mocks at all:

| Suite | What it proves |
|---|---|
| `contextSelector` | question → expected selection for all six intents; exclude beats secondary; budget trims the secondary tail and never primary |
| `confidence` | all six scenarios in the table above, including the caps |
| `promptBuilder` | excluded context cannot appear; hallucinated sources are dropped |
| `gateway` | concurrent fetch, one service down does not block the rest, stale-while-error, panchang cached globally |
| `pipeline` | `/debug` output equals the plan half of a full run; the LLM is never called on the debug path or with zero context; escalation fires **exactly once** |
| `api` | all five sample questions route correctly; a dead upstream still returns 200 |

The degradation tests are the ones that prove the resilience code actually executes — which is why
the mock upstreams are a real HTTP server with failure injection rather than imported JSON.

---

## Requirements traceability

<details>
<summary><b>Functional requirements</b></summary>

| Requirement | Where |
|---|---|
| Fetch upstreams concurrently | `src/gateway/index.js` — `Promise.allSettled` × 4 |
| Retries, timeouts, partial failures | `src/gateway/httpClient.js`, `config/services.yaml` |
| Detect intent (career/relationship/health/finance/general/etc.) | `src/engine/intentDetector.js` — 6 intents, hybrid |
| Config-driven engine choosing context | `config/registry.yaml` + `config/intents.yaml` |
| Personalize language, tone, length from profile | `src/engine/personalization.js` |
| Prompt using **only** selected context | `src/prompt/promptBuilder.js` — no bundle parameter |
| Any LLM provider, or mock | `src/llm/index.js` |
| Return answer, confidence, sourcesUsed | `src/pipeline/stages.js` — `toAnswerResponse` |
| Clean logging, in-memory caching, graceful errors | `src/observability/`, `src/gateway/cache.js`, `src/errors.js` |
</details>

<details>
<summary><b>Personalization Engine — the six questions</b></summary>

| Question | Field | Where |
|---|---|---|
| What is the user's intent? | `intent` | `intentDetector` |
| Which sources are most relevant? | `selectedContext` | `contextSelector` — primary ∪ secondary |
| Which data should be ignored? | `excludedContext` | `contextSelector` — explicit `exclude` |
| What language? | `language` | `personalization` |
| What tone? | `tone` | `personalization` |
| How detailed? | `maxWords` | `personalization` |
</details>

<details>
<summary><b>Technical expectations</b></summary>

| Expectation | Where |
|---|---|
| Clean project structure | `src/` layered with a one-way dependency rule |
| Swappable LLM provider | `src/llm/index.js` — no provider type crosses the boundary |
| Extensible Personalization Engine | the extensibility table above |
| In-memory caching for upstream services | `src/gateway/cache.js` — TTL + stale-while-error |
| Request logging | one pino line per request, `requestId`-scoped |
| Latency logging | per-stage `ms` from the trace runner |
| Prompt size logging | `tokens.{available,sent,reductionPct,promptEst}` |
| Graceful handling of failures | only three non-200 paths exist |
| Clear code organization | `grep` gates in ARCHITECTURE.md |
</details>
