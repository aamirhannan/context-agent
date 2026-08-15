# Personalized AI Context Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a backend service that sits between four astrological microservices and an LLM, selecting only the relevant context for a user's question and returning a grounded, personalized answer.

**Architecture:** A deterministic composite pipeline split into `plan()` (fetch → detect intent → select context → resolve persona → build prompt) and `execute()` (generate → assemble). `POST /personalize` runs both halves; `POST /debug/personalization` runs only `plan()`, so the debug endpoint is structurally incapable of drifting from the real pipeline. All context selection is driven by two YAML files validated at boot; `src/engine/` is pure functions with no I/O imports.

**Tech Stack:** Node.js 26 · Express 4 · plain CommonJS JavaScript · Zod (config + boundary validation) · pino (structured logging) · js-yaml · OpenAI SDK · `node:test` + `node:assert` (zero-dependency test runner) · PostgreSQL 16 via Docker (Phase 2, optional)

**Spec:** `docs/superpowers/specs/2026-08-15-personalized-ai-context-engine-design.md`

---

## Global Constraints

- **Language:** plain JavaScript, CommonJS (`require`/`module.exports`). No TypeScript, no `"type": "module"`.
- **Node:** 26.x. Use built-in `fetch`, `crypto.randomUUID()`, `AbortSignal.timeout()`, `node:test`. Do not add `node-fetch`, `uuid`, `jest`, or `vitest`.
- **Dependency budget:** `express`, `zod`, `pino`, `js-yaml`, `openai`, `dotenv`, plus `pg` in Phase 2 only. `pino-pretty` as devDependency. Nothing else.
- **Dependency rule (enforced by review):** files under `src/engine/` MUST NOT `require` anything from `src/gateway/`, `src/llm/`, `src/store/`, or `express`. Engine modules take plain data and return plain data.
- **Config is the source of truth:** intent→context mappings live in `config/*.yaml`, never in JavaScript conditionals. No `if (intent === 'career')` anywhere in `src/`.
- **Context IDs** are the 11 stable IDs listed in Task 2. Config references IDs only — never service names or JSON paths.
- **`npm start` must work with zero infrastructure** — no Docker, no Postgres, no API key. `LLM_PROVIDER` defaults to `mock`, mock repo defaults to fixtures.
- **Commit after every task.** Conventional commit prefixes (`feat:`, `test:`, `chore:`, `docs:`).
- **Every non-200 response must carry `requestId`.**

## Time budget (~10 working hours, Sunday 12:00 deadline)

| Phase | Tasks | Est. | Status if clock runs out |
|---|---|---|---|
| **Phase 1 — graded core** | 1–13 | ~7.5h | Must ship. This alone is a complete submission. |
| **Phase 2 — optional tail** | 14–15 | ~2h | Droppable. README already documents fixture mode as the default. |

If you fall behind, cut in this order: Task 15 → Task 14 → Task 12's optional cases. **Never cut Task 13 (README + diagrams)** — it is a named deliverable.

---

## File Structure

```
config/
  registry.yaml            11 context items: id, label, source, path, render, estTokens
  intents.yaml             6 intents: match rules, primary, secondary, exclude
  personalization.yaml     tone instructions, language names, length by subscription, defaults
  confidence.yaml          scoring weights, caps, band thresholds
  services.yaml            per-upstream url/timeout/retries/backoff + cache TTLs
src/
  config/index.js          load + Zod-validate all YAML at boot; cross-check IDs
  engine/
    contextRegistry.js     build ID→entry map; resolve+render one item from a bundle
    contextSelector.js     (primary ∪ secondary) − exclude; budget; reasons
    intentDetector.js      rule scoring; LLM fallback; general fallback
    personalization.js     userProfile → {language, tone, maxWords}
    confidence.js          factors → {band, score, factors, caps}
  prompt/promptBuilder.js  selected items + persona + question → {system, user, estTokens}
  gateway/
    cache.js               TTL Map with stale-while-error + stats
    httpClient.js          fetch with timeout, retry on 5xx/timeout, never on 4xx
    index.js               fetchAll(userId) — Promise.allSettled over 4 services
  llm/
    mockProvider.js        deterministic; no network; used by all tests
    openaiProvider.js      OpenAI structured outputs
    index.js               env-var provider selection
  pipeline/
    runner.js              ~40-line stage runner producing a trace
    stages.js              PLAN and EXECUTE stage arrays
  routes/
    personalize.js  debug.js  health.js
  observability/logger.js  pino + request-scoped child
  errors.js                typed errors + Express error middleware
  server.js                wiring
mocks/
  server.js                real HTTP server for the 4 upstreams + failure injection
  repo/index.js            DATABASE_URL ? pgRepo : fixtureRepo
  repo/fixtureRepo.js
  fixtures/users.json kundli.json horoscope.json panchang.json
test/
  *.test.js
```

---

# PHASE 1 — GRADED CORE

---

### Task 1: Project scaffold + config loading with boot-time validation

**Est: 50 min**

**Files:**
- Create: `package.json`, `.env.example`, `.gitignore`
- Create: `config/registry.yaml`, `config/intents.yaml`, `config/personalization.yaml`, `config/confidence.yaml`, `config/services.yaml`
- Create: `src/config/index.js`
- Test: `test/config.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `loadConfig()` → `{ registry: {items: Array}, intents: Object, personalization: Object, confidence: Object, services: Object }`. Throws `Error` with a descriptive message on any validation failure. Every later task calls `loadConfig()` once at boot.

- [ ] **Step 1: Initialize the project**

```bash
npm init -y
npm pkg set name="mynaksh-context-engine" version="1.0.0" main="src/server.js"
npm pkg set scripts.start="node src/server.js"
npm pkg set scripts.mocks="node mocks/server.js"
npm pkg set scripts.test="node --test test/"
npm pkg set scripts.dev="node --watch src/server.js"
npm install express zod pino js-yaml openai dotenv
npm install --save-dev pino-pretty
```

- [ ] **Step 2: Write `config/registry.yaml`**

```yaml
items:
  - id: kundli.lagna
    label: "Lagna"
    source: kundli
    path: "lagna"
    render: "Lagna (ascendant): {value}"
    estTokens: 8

  - id: kundli.moonSign
    label: "Moon Sign"
    source: kundli
    path: "moonSign"
    render: "Moon sign: {value}"
    estTokens: 8

  - id: kundli.dasha
    label: "Current Dasha"
    source: kundli
    path: "currentDasha"
    render: "Current Dasha - Mahadasha {mahadasha}, Antardasha {antardasha}"
    estTokens: 20

  - id: kundli.house.6
    label: "6th House"
    source: kundli
    path: "houses.6"
    render: "6th House - lord {lord}, strength {strength}"
    estTokens: 16

  - id: kundli.house.7
    label: "7th House"
    source: kundli
    path: "houses.7"
    render: "7th House - lord {lord}, strength {strength}"
    estTokens: 16

  - id: kundli.house.10
    label: "10th House"
    source: kundli
    path: "houses.10"
    render: "10th House - lord {lord}, strength {strength}"
    estTokens: 16

  - id: horoscope.career
    label: "Career Horoscope"
    source: horoscope
    path: "career"
    render: "Career outlook: {value}"
    estTokens: 20

  - id: horoscope.finance
    label: "Finance Horoscope"
    source: horoscope
    path: "finance"
    render: "Finance outlook: {value}"
    estTokens: 20

  - id: horoscope.health
    label: "Health Horoscope"
    source: horoscope
    path: "health"
    render: "Health outlook: {value}"
    estTokens: 20

  - id: horoscope.relationship
    label: "Relationship Horoscope"
    source: horoscope
    path: "relationship"
    render: "Relationship outlook: {value}"
    estTokens: 20

  - id: panchang.today
    label: "Today's Panchang"
    source: panchang
    path: "."
    render: "Today - Tithi {tithi}, Nakshatra {nakshatra}, Yoga {yoga}, Karana {karana}"
    estTokens: 28
```

- [ ] **Step 3: Write `config/intents.yaml`**

```yaml
threshold: 0.6

intents:
  career:
    match:
      keywords: [job, career, work, promotion, salary, boss, office, business, interview, appraisal, resign]
      patterns: ["chang.*job", "switch.*compan", "quit.*work", "new.*role"]
    primary:   [horoscope.career, kundli.house.10]
    secondary: [kundli.dasha, panchang.today]
    exclude:   [horoscope.relationship]

  relationship:
    match:
      keywords: [relationship, partner, marriage, love, spouse, wife, husband, girlfriend, boyfriend, romance, dating]
      patterns: ["my.*partner", "get.*married"]
    primary:   [horoscope.relationship, kundli.house.7]
    secondary: [kundli.moonSign, kundli.dasha]
    exclude:   [horoscope.career]

  health:
    match:
      keywords: [health, fitness, illness, sick, sleep, energy, body, medical, wellness, diet, exercise]
      patterns: ["feel.*tired", "my.*health"]
    primary:   [horoscope.health, kundli.house.6]
    secondary: [kundli.moonSign, panchang.today]
    exclude:   [horoscope.finance]

  finance:
    match:
      keywords: [money, finance, investment, wealth, savings, loan, debt, property, stocks, income]
      patterns: ["invest.*in", "buy.*property"]
    primary:   [horoscope.finance]
    secondary: [kundli.dasha, kundli.lagna]
    exclude:   [horoscope.relationship]

  daily_summary:
    match:
      keywords: [today, tomorrow, summarize, summary, guidance, prioritize, priority, week, focus]
      patterns: ["today.*guidance", "summar.*today", "prioriti.*(week|today)"]
    primary:   [panchang.today]
    secondary: [horoscope.career, horoscope.health, kundli.dasha]
    exclude:   []

  general:
    match:
      keywords: []
      patterns: []
    primary: [kundli.lagna, kundli.moonSign, kundli.dasha, kundli.house.6, kundli.house.7,
              kundli.house.10, horoscope.career, horoscope.finance, horoscope.health,
              horoscope.relationship, panchang.today]
    secondary: []
    exclude:   []
```

- [ ] **Step 4: Write `config/personalization.yaml`**

```yaml
tone:
  motivational: "Encouraging and action-oriented. Speak in second person. Open with an affirmation."
  neutral: "Balanced and factual. Neither alarming nor effusive."
  direct: "Blunt and concise. Lead with the conclusion, then the reasoning."

language:
  en: English
  hi: Hindi

length:
  free: 120
  premium: 250

defaults:
  language: en
  tone: neutral
  subscription: free
```

- [ ] **Step 5: Write `config/confidence.yaml`**

```yaml
weights:
  intentConfidence: 0.4
  primaryCoverage: 0.4
  sourceHealth: 0.2

intentScoreByMethod:
  rule: 1.0
  fallback: 0.4

sourceHealthScore:
  fresh: 1.0
  stale: 0.6
  missing: 0.0

caps:
  fallbackIntent: 0.7
  insufficient: 0.5
  noPrimaryCoverage: 0.4

bands:
  high: 0.8
  medium: 0.5
```

- [ ] **Step 6: Write `config/services.yaml`**

```yaml
budgetTokens: 400

escalation:
  enabled: true

services:
  user:
    path: "/users/{userId}"
    timeoutMs: 500
    retries: 2
    backoffMs: 100
    cacheTtlMs: 300000
    cacheStaleMaxMs: 3600000
  kundli:
    path: "/kundli/{userId}"
    timeoutMs: 800
    retries: 2
    backoffMs: 100
    cacheTtlMs: 3600000
    cacheStaleMaxMs: 86400000
  horoscope:
    path: "/horoscope/{userId}"
    timeoutMs: 600
    retries: 2
    backoffMs: 100
    cacheTtlMs: 21600000
    cacheStaleMaxMs: 86400000
  panchang:
    path: "/panchang"
    timeoutMs: 400
    retries: 1
    backoffMs: 100
    cacheTtlMs: 21600000
    cacheStaleMaxMs: 86400000
```

- [ ] **Step 7: Write the failing test**

Create `test/config.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { loadConfig, validateConfig } = require('../src/config');

test('loadConfig returns all five config sections', () => {
  const cfg = loadConfig();
  assert.ok(Array.isArray(cfg.registry.items));
  assert.equal(cfg.registry.items.length, 11);
  assert.ok(cfg.intents.intents.career);
  assert.ok(cfg.personalization.tone.motivational);
  assert.ok(cfg.confidence.weights);
  assert.ok(cfg.services.services.kundli);
});

test('every context ID referenced by an intent exists in the registry', () => {
  const cfg = loadConfig();
  const ids = new Set(cfg.registry.items.map((i) => i.id));
  for (const [name, intent] of Object.entries(cfg.intents.intents)) {
    for (const key of ['primary', 'secondary', 'exclude']) {
      for (const id of intent[key]) {
        assert.ok(ids.has(id), `intents.${name}.${key} references unknown id '${id}'`);
      }
    }
  }
});

test('validateConfig rejects an intent referencing an unknown context ID', () => {
  const bad = {
    registry: { items: [{ id: 'a.b', label: 'A', source: 'kundli', path: 'x', render: '{value}', estTokens: 1 }] },
    intents: { threshold: 0.6, intents: { career: { match: { keywords: [], patterns: [] }, primary: ['nope.id'], secondary: [], exclude: [] } } },
    personalization: { tone: { neutral: 'x' }, language: { en: 'English' }, length: { free: 100, premium: 200 }, defaults: { language: 'en', tone: 'neutral', subscription: 'free' } },
    confidence: { weights: { intentConfidence: 0.4, primaryCoverage: 0.4, sourceHealth: 0.2 }, intentScoreByMethod: { rule: 1, fallback: 0.4 }, sourceHealthScore: { fresh: 1, stale: 0.6, missing: 0 }, caps: { fallbackIntent: 0.7, insufficient: 0.5, noPrimaryCoverage: 0.4 }, bands: { high: 0.8, medium: 0.5 } },
    services: { budgetTokens: 400, escalation: { enabled: true }, services: {} },
  };
  assert.throws(() => validateConfig(bad), /unknown context id 'nope.id'/);
});

test('registry sources are limited to the three context services', () => {
  const cfg = loadConfig();
  const allowed = new Set(['kundli', 'horoscope', 'panchang']);
  for (const item of cfg.registry.items) {
    assert.ok(allowed.has(item.source), `${item.id} has non-context source '${item.source}'`);
  }
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/config'`

- [ ] **Step 9: Implement `src/config/index.js`**

```js
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { z } = require('zod');

const CONFIG_DIR = path.join(__dirname, '..', '..', 'config');

const registrySchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    source: z.enum(['kundli', 'horoscope', 'panchang']),
    path: z.string().min(1),
    render: z.string().min(1),
    estTokens: z.number().int().positive(),
  })).min(1),
});

const intentSchema = z.object({
  match: z.object({
    keywords: z.array(z.string()),
    patterns: z.array(z.string()),
  }),
  primary: z.array(z.string()),
  secondary: z.array(z.string()),
  exclude: z.array(z.string()),
});

const intentsSchema = z.object({
  threshold: z.number().min(0).max(1),
  intents: z.record(z.string(), intentSchema),
});

const personalizationSchema = z.object({
  tone: z.record(z.string(), z.string()),
  language: z.record(z.string(), z.string()),
  length: z.record(z.string(), z.number().int().positive()),
  defaults: z.object({
    language: z.string(),
    tone: z.string(),
    subscription: z.string(),
  }),
});

const confidenceSchema = z.object({
  weights: z.object({
    intentConfidence: z.number(),
    primaryCoverage: z.number(),
    sourceHealth: z.number(),
  }),
  intentScoreByMethod: z.object({ rule: z.number(), fallback: z.number() }),
  sourceHealthScore: z.object({ fresh: z.number(), stale: z.number(), missing: z.number() }),
  caps: z.object({
    fallbackIntent: z.number(),
    insufficient: z.number(),
    noPrimaryCoverage: z.number(),
  }),
  bands: z.object({ high: z.number(), medium: z.number() }),
});

const servicesSchema = z.object({
  budgetTokens: z.number().int().positive(),
  escalation: z.object({ enabled: z.boolean() }),
  services: z.record(z.string(), z.object({
    path: z.string(),
    timeoutMs: z.number().int().positive(),
    retries: z.number().int().min(0),
    backoffMs: z.number().int().min(0),
    cacheTtlMs: z.number().int().min(0),
    cacheStaleMaxMs: z.number().int().min(0),
  })),
});

function readYaml(name) {
  const file = path.join(CONFIG_DIR, `${name}.yaml`);
  try {
    return yaml.load(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`failed to read config/${name}.yaml: ${err.message}`);
  }
}

function parseOrThrow(schema, value, name) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`invalid config/${name}.yaml at '${issue.path.join('.')}': ${issue.message}`);
  }
  return result.data;
}

// Cross-file checks that a per-file schema cannot express.
function validateConfig(cfg) {
  const ids = new Set(cfg.registry.items.map((i) => i.id));

  const seen = new Set();
  for (const item of cfg.registry.items) {
    if (seen.has(item.id)) throw new Error(`duplicate context id '${item.id}' in registry.yaml`);
    seen.add(item.id);
  }

  for (const [name, intent] of Object.entries(cfg.intents.intents)) {
    for (const key of ['primary', 'secondary', 'exclude']) {
      for (const id of intent[key]) {
        if (!ids.has(id)) {
          throw new Error(`unknown context id '${id}' in intents.${name}.${key}`);
        }
      }
    }
  }

  if (!cfg.intents.intents.general) {
    throw new Error("intents.yaml must define a 'general' intent as the fallback");
  }

  const tones = new Set(Object.keys(cfg.personalization.tone));
  if (!tones.has(cfg.personalization.defaults.tone)) {
    throw new Error(`defaults.tone '${cfg.personalization.defaults.tone}' is not a defined tone`);
  }

  return cfg;
}

let cached = null;

function loadConfig({ force = false } = {}) {
  if (cached && !force) return cached;
  const cfg = {
    registry: parseOrThrow(registrySchema, readYaml('registry'), 'registry'),
    intents: parseOrThrow(intentsSchema, readYaml('intents'), 'intents'),
    personalization: parseOrThrow(personalizationSchema, readYaml('personalization'), 'personalization'),
    confidence: parseOrThrow(confidenceSchema, readYaml('confidence'), 'confidence'),
    services: parseOrThrow(servicesSchema, readYaml('services'), 'services'),
  };
  cached = validateConfig(cfg);
  return cached;
}

module.exports = { loadConfig, validateConfig };
```

- [ ] **Step 10: Run test to verify it passes**

Run: `npm test`
Expected: PASS — 4 tests

- [ ] **Step 11: Write `.env.example` and `.gitignore`**

`.env.example`:
```
PORT=3000
MOCKS_PORT=4000
UPSTREAM_BASE_URL=http://localhost:4000
LLM_PROVIDER=mock
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
LOG_LEVEL=info
# Phase 2 — leave unset to run mocks from JSON fixtures
# DATABASE_URL=postgres://mynaksh:mynaksh@localhost:5432/mynaksh
```

`.gitignore`:
```
node_modules/
.env
*.log
```

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: project scaffold with boot-validated YAML config"
```

---

### Task 2: Context registry — resolve and render one item

**Est: 35 min**

**Files:**
- Create: `src/engine/contextRegistry.js`
- Test: `test/contextRegistry.test.js`

**Interfaces:**
- Consumes: `loadConfig()` from Task 1
- Produces:
  - `buildRegistry(registryConfig)` → `Map<string, entry>`
  - `resolveItem(entry, bundle)` → `{ id, label, text, estTokens }` or `null` when unresolvable
  - `availableTokens(registry, bundle)` → `number` — total tokens if everything resolvable were sent. Task 4 uses this for `reductionPct`.

- [ ] **Step 1: Write the failing test**

Create `test/contextRegistry.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { loadConfig } = require('../src/config');
const { buildRegistry, resolveItem, availableTokens } = require('../src/engine/contextRegistry');

const BUNDLE = {
  kundli: {
    lagna: 'Libra',
    moonSign: 'Scorpio',
    currentDasha: { mahadasha: 'Rahu', antardasha: 'Mars' },
    houses: { 6: { lord: 'Jupiter', strength: 'Average' }, 7: { lord: 'Mars', strength: 'Weak' }, 10: { lord: 'Moon', strength: 'Strong' } },
  },
  horoscope: {
    career: 'Networking may bring new opportunities.',
    finance: 'Avoid risky investments.',
    health: 'Prioritize proper sleep.',
    relationship: 'Communication with your partner improves.',
  },
  panchang: { date: '2026-08-15', tithi: 'Shukla Panchami', nakshatra: 'Rohini', yoga: 'Siddhi', karana: 'Bava' },
};

const registry = buildRegistry(loadConfig().registry);

test('buildRegistry indexes all 11 items by ID', () => {
  assert.equal(registry.size, 11);
  assert.ok(registry.has('kundli.house.10'));
});

test('renders a nested object item using its template variables', () => {
  const item = resolveItem(registry.get('kundli.house.10'), BUNDLE);
  assert.equal(item.label, '10th House');
  assert.equal(item.text, '10th House - lord Moon, strength Strong');
  assert.equal(item.estTokens, 16);
});

test('renders a scalar item using {value}', () => {
  const item = resolveItem(registry.get('horoscope.career'), BUNDLE);
  assert.equal(item.text, 'Career outlook: Networking may bring new opportunities.');
});

test('renders a whole-source item when path is "."', () => {
  const item = resolveItem(registry.get('panchang.today'), BUNDLE);
  assert.match(item.text, /Tithi Shukla Panchami/);
  assert.match(item.text, /Karana Bava/);
});

test('returns null when the source is entirely missing', () => {
  assert.equal(resolveItem(registry.get('kundli.house.10'), { horoscope: BUNDLE.horoscope }), null);
});

test('returns null when the path is missing from an otherwise present source', () => {
  const partial = { ...BUNDLE, kundli: { lagna: 'Libra' } };
  assert.equal(resolveItem(registry.get('kundli.house.10'), partial), null);
});

test('returns null when a render variable is absent rather than emitting "undefined"', () => {
  const partial = { ...BUNDLE, kundli: { ...BUNDLE.kundli, houses: { 10: { lord: 'Moon' } } } };
  assert.equal(resolveItem(registry.get('kundli.house.10'), partial), null);
});

test('availableTokens sums every resolvable item', () => {
  const total = availableTokens(registry, BUNDLE);
  assert.equal(total, 192);
  assert.ok(availableTokens(registry, { horoscope: BUNDLE.horoscope }) < total);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/contextRegistry.test.js`
Expected: FAIL — `Cannot find module '../src/engine/contextRegistry'`

- [ ] **Step 3: Implement `src/engine/contextRegistry.js`**

```js
// Pure. No I/O, no imports from gateway/llm/store.

function getPath(obj, dottedPath) {
  if (dottedPath === '.') return obj;
  return dottedPath.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function buildRegistry(registryConfig) {
  return new Map(registryConfig.items.map((item) => [item.id, item]));
}

/**
 * Resolve one registry entry against a fetched bundle and render it to text.
 * Returns null if the source is absent, the path is absent, or any render
 * variable is missing — a partially rendered line is worse than no line.
 */
function resolveItem(entry, bundle) {
  if (!entry) return null;
  const sourceData = bundle[entry.source];
  if (sourceData == null) return null;

  const raw = getPath(sourceData, entry.path);
  if (raw == null) return null;

  const vars = typeof raw === 'object' ? raw : { value: raw };

  let missing = false;
  const text = entry.render.replace(/\{(\w+)\}/g, (_match, key) => {
    if (vars[key] == null) { missing = true; return ''; }
    return String(vars[key]);
  });
  if (missing) return null;

  return { id: entry.id, label: entry.label, text, estTokens: entry.estTokens };
}

/** Total tokens if every resolvable item were sent — the denominator for reductionPct. */
function availableTokens(registry, bundle) {
  let total = 0;
  for (const entry of registry.values()) {
    const item = resolveItem(entry, bundle);
    if (item) total += item.estTokens;
  }
  return total;
}

module.exports = { buildRegistry, resolveItem, availableTokens, getPath };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/contextRegistry.test.js`
Expected: PASS — 8 tests. If `availableTokens` asserts a different number, sum the `estTokens` in `config/registry.yaml` and correct the expected value in the test.

- [ ] **Step 5: Commit**

```bash
git add src/engine/contextRegistry.js test/contextRegistry.test.js
git commit -m "feat: context registry with ID resolution and rendering"
```

---

### Task 3: Context selector — the core of the assignment

**Est: 55 min**

**Files:**
- Create: `src/engine/contextSelector.js`
- Test: `test/contextSelector.test.js`

**Interfaces:**
- Consumes: `buildRegistry`, `resolveItem`, `availableTokens` from Task 2
- Produces: `selectContext({ intentConfig, registry, bundle, budgetTokens })` →
  ```js
  {
    selected:    [{ id, label, text, estTokens }],
    excluded:    [{ id, label, reason: 'intent_rule' }],
    notSelected: [{ id, label, reason: 'not_relevant' | 'upstream_unavailable' }],
    unavailable: [{ id, label, source }],
    budget:      { available: number, sent: number, reductionPct: number },
    primaryCoverage: number   // 0..1 — Task 6 consumes this
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `test/contextSelector.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { loadConfig } = require('../src/config');
const { buildRegistry } = require('../src/engine/contextRegistry');
const { selectContext } = require('../src/engine/contextSelector');

const cfg = loadConfig();
const registry = buildRegistry(cfg.registry);
const BUDGET = cfg.services.budgetTokens;

const BUNDLE = {
  kundli: {
    lagna: 'Libra', moonSign: 'Scorpio',
    currentDasha: { mahadasha: 'Rahu', antardasha: 'Mars' },
    houses: { 6: { lord: 'Jupiter', strength: 'Average' }, 7: { lord: 'Mars', strength: 'Weak' }, 10: { lord: 'Moon', strength: 'Strong' } },
  },
  horoscope: { career: 'Networking may bring new opportunities.', finance: 'Avoid risky investments.', health: 'Prioritize proper sleep.', relationship: 'Communication with your partner improves.' },
  panchang: { tithi: 'Shukla Panchami', nakshatra: 'Rohini', yoga: 'Siddhi', karana: 'Bava' },
};

const sel = (intentName, bundle = BUNDLE, budgetTokens = BUDGET) =>
  selectContext({ intentConfig: cfg.intents.intents[intentName], registry, bundle, budgetTokens });

test('career selects primary + secondary and nothing else', () => {
  const r = sel('career');
  const ids = r.selected.map((s) => s.id).sort();
  assert.deepEqual(ids, ['horoscope.career', 'kundli.dasha', 'kundli.house.10', 'panchang.today'].sort());
});

test('career reports Relationship Horoscope as a deliberate exclusion', () => {
  const r = sel('career');
  assert.deepEqual(r.excluded.map((e) => e.label), ['Relationship Horoscope']);
  assert.equal(r.excluded[0].reason, 'intent_rule');
});

test('excludedContext is the explicit list only, not every unselected item', () => {
  const r = sel('career');
  assert.equal(r.excluded.length, 1);
  assert.ok(r.notSelected.length > 1, 'the implicit remainder belongs in notSelected');
});

test('relationship, health and finance match the assignment mapping', () => {
  assert.deepEqual(sel('relationship').selected.map((s) => s.id).sort(),
    ['horoscope.relationship', 'kundli.house.7', 'kundli.moonSign', 'kundli.dasha'].sort());
  assert.deepEqual(sel('health').selected.map((s) => s.id).sort(),
    ['horoscope.health', 'kundli.house.6', 'kundli.moonSign', 'panchang.today'].sort());
  assert.deepEqual(sel('finance').selected.map((s) => s.id).sort(),
    ['horoscope.finance', 'kundli.dasha', 'kundli.lagna'].sort());
});

test('general selects every resolvable item', () => {
  assert.equal(sel('general').selected.length, 11);
});

test('exclude wins over secondary when an ID appears in both', () => {
  const conflicted = { match: { keywords: [], patterns: [] }, primary: ['horoscope.career'], secondary: ['kundli.dasha'], exclude: ['kundli.dasha'] };
  const r = selectContext({ intentConfig: conflicted, registry, bundle: BUNDLE, budgetTokens: BUDGET });
  assert.ok(!r.selected.some((s) => s.id === 'kundli.dasha'));
  assert.ok(r.excluded.some((e) => e.id === 'kundli.dasha'));
});

test('an unavailable source removes its items and lowers primaryCoverage', () => {
  const r = sel('career', { horoscope: BUNDLE.horoscope, panchang: BUNDLE.panchang });
  assert.ok(!r.selected.some((s) => s.id === 'kundli.house.10'));
  assert.ok(r.unavailable.some((u) => u.id === 'kundli.house.10'));
  assert.equal(r.primaryCoverage, 0.5);
});

test('primaryCoverage is 1 when all primary items resolve, 0 when none do', () => {
  assert.equal(sel('career').primaryCoverage, 1);
  assert.equal(sel('career', { panchang: BUNDLE.panchang }).primaryCoverage, 0);
});

test('over budget trims from the secondary tail and never drops primary', () => {
  const r = sel('career', BUNDLE, 40);
  const ids = r.selected.map((s) => s.id);
  assert.ok(ids.includes('horoscope.career'), 'primary must survive');
  assert.ok(ids.includes('kundli.house.10'), 'primary must survive');
  assert.ok(!ids.includes('panchang.today'), 'secondary tail trimmed first');
  assert.ok(r.notSelected.some((n) => n.id === 'panchang.today' && n.reason === 'budget'));
});

test('budget reports available, sent and reduction percentage', () => {
  const r = sel('career');
  assert.equal(r.budget.sent, r.selected.reduce((a, s) => a + s.estTokens, 0));
  assert.ok(r.budget.available > r.budget.sent);
  assert.equal(r.budget.reductionPct, Math.round((1 - r.budget.sent / r.budget.available) * 100));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/contextSelector.test.js`
Expected: FAIL — `Cannot find module '../src/engine/contextSelector'`

- [ ] **Step 3: Implement `src/engine/contextSelector.js`**

```js
// Pure. No I/O, no imports from gateway/llm/store.
const { resolveItem, availableTokens } = require('./contextRegistry');

/**
 * selected = (primary ∪ secondary) − exclude
 *
 * Exclude always wins. Primary is never dropped for budget — missing primary
 * is a confidence signal (Task 6), not a budgeting one.
 */
function selectContext({ intentConfig, registry, bundle, budgetTokens }) {
  const excludeIds = new Set(intentConfig.exclude);
  const primaryIds = intentConfig.primary.filter((id) => !excludeIds.has(id));
  const secondaryIds = intentConfig.secondary.filter(
    (id) => !excludeIds.has(id) && !primaryIds.includes(id),
  );

  const excluded = [];
  const notSelected = [];
  const unavailable = [];

  const resolve = (id) => {
    const entry = registry.get(id);
    const item = resolveItem(entry, bundle);
    if (!item) unavailable.push({ id, label: entry.label, source: entry.source });
    return item;
  };

  const primary = primaryIds.map(resolve).filter(Boolean);
  const secondary = secondaryIds.map(resolve).filter(Boolean);

  const primaryCoverage = primaryIds.length === 0 ? 1 : primary.length / primaryIds.length;

  // Budget: primary is protected; trim the secondary tail until it fits.
  let sent = primary.reduce((a, s) => a + s.estTokens, 0);
  const keptSecondary = [];
  for (const item of secondary) {
    if (sent + item.estTokens <= budgetTokens) {
      keptSecondary.push(item);
      sent += item.estTokens;
    } else {
      notSelected.push({ id: item.id, label: item.label, reason: 'budget' });
    }
  }

  const selected = [...primary, ...keptSecondary];
  const selectedIds = new Set(selected.map((s) => s.id));

  // Deliberate exclusions — the contrastive list the debug endpoint reports.
  for (const id of intentConfig.exclude) {
    const entry = registry.get(id);
    excluded.push({ id, label: entry.label, reason: 'intent_rule' });
  }

  // Everything else: the implicit remainder, reported in detail only.
  for (const entry of registry.values()) {
    if (selectedIds.has(entry.id) || excludeIds.has(entry.id)) continue;
    if (notSelected.some((n) => n.id === entry.id)) continue;
    const isUnavailable = unavailable.some((u) => u.id === entry.id);
    notSelected.push({
      id: entry.id,
      label: entry.label,
      reason: isUnavailable ? 'upstream_unavailable' : 'not_relevant',
    });
  }

  const available = availableTokens(registry, bundle);

  return {
    selected,
    excluded,
    notSelected,
    unavailable,
    primaryCoverage,
    budget: {
      available,
      sent,
      reductionPct: available === 0 ? 0 : Math.round((1 - sent / available) * 100),
    },
  };
}

module.exports = { selectContext };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/contextSelector.test.js`
Expected: PASS — 10 tests

- [ ] **Step 5: Commit**

```bash
git add src/engine/contextSelector.js test/contextSelector.test.js
git commit -m "feat: config-driven context selection with budget and exclusion reasons"
```

---

### Task 4: Intent detector — rules with LLM fallback

**Est: 40 min**

**Files:**
- Create: `src/engine/intentDetector.js`
- Test: `test/intentDetector.test.js`

**Interfaces:**
- Consumes: `cfg.intents` from Task 1
- Produces:
  - `detectByRules(question, intentsConfig)` → `{ intent, score, method: 'rule' }` or `null`
  - `detectIntent(question, intentsConfig, llmProvider)` → `Promise<{ intent, score, method: 'rule'|'llm'|'fallback' }>`
  - `llmProvider` must expose `classifyIntent(question, intentNames)` → `Promise<{ intent, score }>` (built in Task 8). Pass `null` to skip the LLM entirely.

- [ ] **Step 1: Write the failing test**

Create `test/intentDetector.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { loadConfig } = require('../src/config');
const { detectByRules, detectIntent } = require('../src/engine/intentDetector');

const intentsConfig = loadConfig().intents;

test('matches career from an explicit keyword', () => {
  const r = detectByRules('Should I consider changing my job this year?', intentsConfig);
  assert.equal(r.intent, 'career');
  assert.equal(r.method, 'rule');
  assert.equal(r.score, 1);
});

test('matches relationship, health and finance from keywords', () => {
  assert.equal(detectByRules('How does this month look for my relationship?', intentsConfig).intent, 'relationship');
  assert.equal(detectByRules('What should I focus on for my health?', intentsConfig).intent, 'health');
  assert.equal(detectByRules('Should I invest in property now?', intentsConfig).intent, 'finance');
});

test('matches daily_summary for temporally scoped questions', () => {
  assert.equal(detectByRules("Can you summarize today's guidance?", intentsConfig).intent, 'daily_summary');
});

test('returns null for a question with no signal', () => {
  assert.equal(detectByRules('Tell me something interesting.', intentsConfig), null);
});

test('never matches the general intent by rule — general is a fallback only', () => {
  const r = detectByRules('general', intentsConfig);
  assert.ok(r === null || r.intent !== 'general');
});

test('detectIntent escalates to the LLM when rules find nothing', async () => {
  const calls = [];
  const provider = {
    classifyIntent: async (q, names) => { calls.push({ q, names }); return { intent: 'career', score: 0.82 }; },
  };
  const r = await detectIntent('Tell me something interesting.', intentsConfig, provider);
  assert.equal(r.intent, 'career');
  assert.equal(r.method, 'llm');
  assert.equal(r.score, 0.82);
  assert.equal(calls.length, 1);
});

test('detectIntent does NOT call the LLM when rules match', async () => {
  let called = false;
  const provider = { classifyIntent: async () => { called = true; return { intent: 'health', score: 1 }; } };
  const r = await detectIntent('Should I change my job?', intentsConfig, provider);
  assert.equal(r.method, 'rule');
  assert.equal(called, false, 'rule-resolved questions must not incur an LLM call');
});

test('detectIntent falls back to general when the LLM throws', async () => {
  const provider = { classifyIntent: async () => { throw new Error('upstream down'); } };
  const r = await detectIntent('Tell me something interesting.', intentsConfig, provider);
  assert.equal(r.intent, 'general');
  assert.equal(r.method, 'fallback');
  assert.equal(r.score, 0.4);
});

test('detectIntent falls back to general when no provider is supplied', async () => {
  const r = await detectIntent('Tell me something interesting.', intentsConfig, null);
  assert.equal(r.intent, 'general');
  assert.equal(r.method, 'fallback');
});

test('detectIntent rejects an LLM answer that is not a configured intent', async () => {
  const provider = { classifyIntent: async () => ({ intent: 'astrophysics', score: 0.9 }) };
  const r = await detectIntent('Tell me something interesting.', intentsConfig, provider);
  assert.equal(r.intent, 'general');
  assert.equal(r.method, 'fallback');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/intentDetector.test.js`
Expected: FAIL — `Cannot find module '../src/engine/intentDetector'`

- [ ] **Step 3: Implement `src/engine/intentDetector.js`**

```js
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
  let best = null;
  for (const [name, intent] of Object.entries(intentsConfig.intents)) {
    if (name === FALLBACK_INTENT) continue;
    const hits = scoreIntent(question, intent.match);
    if (hits > 0 && (!best || hits > best.hits)) best = { name, hits };
  }
  return best ? { intent: best.name, score: 1, method: 'rule' } : null;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/intentDetector.test.js`
Expected: PASS — 10 tests

- [ ] **Step 5: Commit**

```bash
git add src/engine/intentDetector.js test/intentDetector.test.js
git commit -m "feat: hybrid intent detection with rule tier and LLM fallback"
```

---

### Task 5: Personalization resolver

**Est: 25 min**

**Files:**
- Create: `src/engine/personalization.js`
- Test: `test/personalization.test.js`

**Interfaces:**
- Consumes: `cfg.personalization` from Task 1
- Produces: `resolvePersona(userProfile, personalizationConfig)` → `{ language, languageName, tone, toneInstruction, maxWords, usedDefaults: boolean }`. `userProfile` may be `null` when the User service is unreachable.

- [ ] **Step 1: Write the failing test**

Create `test/personalization.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { loadConfig } = require('../src/config');
const { resolvePersona } = require('../src/engine/personalization');

const pcfg = loadConfig().personalization;

test('resolves language, tone and length from a full profile', () => {
  const p = resolvePersona({ language: 'en', tonePreference: 'motivational', subscription: 'premium' }, pcfg);
  assert.equal(p.languageName, 'English');
  assert.equal(p.tone, 'motivational');
  assert.match(p.toneInstruction, /Encouraging/);
  assert.equal(p.maxWords, 250);
  assert.equal(p.usedDefaults, false);
});

test('free subscription gets the shorter length', () => {
  assert.equal(resolvePersona({ language: 'hi', tonePreference: 'neutral', subscription: 'free' }, pcfg).maxWords, 120);
});

test('maps hi to Hindi', () => {
  assert.equal(resolvePersona({ language: 'hi', tonePreference: 'neutral', subscription: 'free' }, pcfg).languageName, 'Hindi');
});

test('falls back to defaults when the profile is null', () => {
  const p = resolvePersona(null, pcfg);
  assert.equal(p.languageName, 'English');
  assert.equal(p.tone, 'neutral');
  assert.equal(p.maxWords, 120);
  assert.equal(p.usedDefaults, true);
});

test('falls back per-field for unknown values rather than throwing', () => {
  const p = resolvePersona({ language: 'kl', tonePreference: 'sarcastic', subscription: 'platinum' }, pcfg);
  assert.equal(p.languageName, 'English');
  assert.equal(p.tone, 'neutral');
  assert.equal(p.maxWords, 120);
  assert.equal(p.usedDefaults, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/personalization.test.js`
Expected: FAIL — `Cannot find module '../src/engine/personalization'`

- [ ] **Step 3: Implement `src/engine/personalization.js`**

```js
// Pure. No I/O, no imports from gateway/llm/store.

/**
 * Turn a user profile into response configuration.
 * A null profile (User service unreachable) yields defaults with usedDefaults=true,
 * which Task 6 folds into the confidence score.
 */
function resolvePersona(userProfile, cfg) {
  const profile = userProfile || {};
  let usedDefaults = !userProfile;

  const langKey = cfg.language[profile.language] ? profile.language : cfg.defaults.language;
  if (langKey !== profile.language) usedDefaults = true;

  const toneKey = cfg.tone[profile.tonePreference] ? profile.tonePreference : cfg.defaults.tone;
  if (toneKey !== profile.tonePreference) usedDefaults = true;

  const subKey = cfg.length[profile.subscription] != null ? profile.subscription : cfg.defaults.subscription;
  if (subKey !== profile.subscription) usedDefaults = true;

  return {
    language: langKey,
    languageName: cfg.language[langKey],
    tone: toneKey,
    toneInstruction: cfg.tone[toneKey],
    maxWords: cfg.length[subKey],
    usedDefaults,
  };
}

module.exports = { resolvePersona };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/personalization.test.js`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/engine/personalization.js test/personalization.test.js
git commit -m "feat: personalization resolver with per-field defaults"
```

---

### Task 6: Confidence scoring

**Est: 30 min**

**Files:**
- Create: `src/engine/confidence.js`
- Test: `test/confidence.test.js`

**Interfaces:**
- Consumes: `cfg.confidence` from Task 1; `primaryCoverage` from Task 3; `method` from Task 4
- Produces: `computeConfidence({ intentMethod, intentScore, primaryCoverage, sourceStates, sufficient }, cfg)` → `{ band: 'HIGH'|'MEDIUM'|'LOW', score, factors, caps }`.
  `sourceStates` is `{ kundli: 'fresh'|'stale'|'missing', horoscope: ..., panchang: ... }` — only the sources the selection needed.
  `sufficient` is `true`/`false`/`null` (`null` on the debug path, which has no LLM verdict).

- [ ] **Step 1: Write the failing test**

Create `test/confidence.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { loadConfig } = require('../src/config');
const { computeConfidence } = require('../src/engine/confidence');

const ccfg = loadConfig().confidence;
const ALL_FRESH = { kundli: 'fresh', horoscope: 'fresh', panchang: 'fresh' };

const band = (over) => computeConfidence({
  intentMethod: 'rule', intentScore: 1, primaryCoverage: 1,
  sourceStates: ALL_FRESH, sufficient: true, ...over,
}, ccfg).band;

test('rule intent with all context fresh is HIGH', () => {
  assert.equal(band({}), 'HIGH');
});

test('losing a secondary-only source stays HIGH', () => {
  assert.equal(band({ sourceStates: { kundli: 'fresh', horoscope: 'fresh', panchang: 'missing' } }), 'HIGH');
});

test('losing half of primary drops to MEDIUM', () => {
  assert.equal(band({ primaryCoverage: 0.5, sourceStates: { kundli: 'missing', horoscope: 'fresh', panchang: 'fresh' } }), 'MEDIUM');
});

test('a fallback intent is capped below HIGH even with perfect context', () => {
  assert.equal(band({ intentMethod: 'fallback', intentScore: 0.4 }), 'MEDIUM');
});

test('sufficient=false caps at MEDIUM', () => {
  assert.equal(band({ sufficient: false }), 'MEDIUM');
});

test('zero primary coverage is LOW', () => {
  assert.equal(band({ primaryCoverage: 0, sourceStates: { kundli: 'missing', horoscope: 'missing', panchang: 'fresh' } }), 'LOW');
});

test('two sources down is LOW', () => {
  assert.equal(band({ primaryCoverage: 0, sourceStates: { kundli: 'missing', horoscope: 'missing' } }), 'LOW');
});

test('stale cache scores between fresh and missing', () => {
  const stale = computeConfidence({ intentMethod: 'rule', intentScore: 1, primaryCoverage: 1, sourceStates: { kundli: 'stale' }, sufficient: true }, ccfg);
  const fresh = computeConfidence({ intentMethod: 'rule', intentScore: 1, primaryCoverage: 1, sourceStates: { kundli: 'fresh' }, sufficient: true }, ccfg);
  assert.ok(stale.score < fresh.score);
});

test('records the contributing factors and any caps applied', () => {
  const r = computeConfidence({ intentMethod: 'fallback', intentScore: 0.4, primaryCoverage: 1, sourceStates: ALL_FRESH, sufficient: false }, ccfg);
  assert.equal(r.factors.primaryCoverage, 1);
  assert.ok(r.caps.includes('fallbackIntent'));
  assert.ok(r.caps.includes('insufficient'));
});

test('a null sufficient (debug path) applies no sufficiency cap', () => {
  const r = computeConfidence({ intentMethod: 'rule', intentScore: 1, primaryCoverage: 1, sourceStates: ALL_FRESH, sufficient: null }, ccfg);
  assert.equal(r.band, 'HIGH');
  assert.ok(!r.caps.includes('insufficient'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/confidence.test.js`
Expected: FAIL — `Cannot find module '../src/engine/confidence'`

- [ ] **Step 3: Implement `src/engine/confidence.js`**

```js
// Pure. No I/O, no imports from gateway/llm/store.

/**
 * confidence = 0.4*intent + 0.4*primaryCoverage + 0.2*sourceHealth, then capped.
 * Weights, caps and band thresholds all live in config/confidence.yaml.
 * Returns the contributing factors so every band has a recorded reason.
 */
function computeConfidence({ intentMethod, intentScore, primaryCoverage, sourceStates, sufficient }, cfg) {
  const intentConfidence = intentMethod === 'llm'
    ? intentScore
    : cfg.intentScoreByMethod[intentMethod] ?? intentScore;

  const states = Object.values(sourceStates || {});
  const sourceHealth = states.length === 0
    ? 1
    : states.reduce((a, s) => a + (cfg.sourceHealthScore[s] ?? 0), 0) / states.length;

  const w = cfg.weights;
  let score = w.intentConfidence * intentConfidence
    + w.primaryCoverage * primaryCoverage
    + w.sourceHealth * sourceHealth;

  const caps = [];
  const applyCap = (name, limit) => {
    if (score > limit) { score = limit; caps.push(name); }
  };

  if (intentMethod === 'fallback') applyCap('fallbackIntent', cfg.caps.fallbackIntent);
  if (sufficient === false) applyCap('insufficient', cfg.caps.insufficient);
  if (primaryCoverage === 0) applyCap('noPrimaryCoverage', cfg.caps.noPrimaryCoverage);

  const band = score >= cfg.bands.high ? 'HIGH' : score >= cfg.bands.medium ? 'MEDIUM' : 'LOW';

  return {
    band,
    score: Number(score.toFixed(3)),
    factors: { intentConfidence, primaryCoverage, sourceHealth },
    caps,
  };
}

module.exports = { computeConfidence };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/confidence.test.js`
Expected: PASS — 10 tests

- [ ] **Step 5: Commit**

```bash
git add src/engine/confidence.js test/confidence.test.js
git commit -m "feat: deterministic confidence scoring with recorded factors"
```

---

### Task 7: Prompt builder + grounding contract

**Est: 35 min**

**Files:**
- Create: `src/prompt/promptBuilder.js`
- Test: `test/promptBuilder.test.js`

**Interfaces:**
- Consumes: `selected` from Task 3, `persona` from Task 5
- Produces:
  - `buildPrompt({ selected, persona, question })` → `{ system, user, estTokens, chars }` — **no `bundle` parameter, by design**
  - `validateSources(claimed, selected, primaryLabels)` → `{ sourcesUsed: string[], hallucinated: string[], fellBack: boolean }`

- [ ] **Step 1: Write the failing test**

Create `test/promptBuilder.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildPrompt, validateSources } = require('../src/prompt/promptBuilder');

const SELECTED = [
  { id: 'horoscope.career', label: 'Career Horoscope', text: 'Career outlook: Networking may bring new opportunities.', estTokens: 20 },
  { id: 'kundli.house.10', label: '10th House', text: '10th House - lord Moon, strength Strong', estTokens: 16 },
];
const PERSONA = { languageName: 'English', tone: 'motivational', toneInstruction: 'Encouraging and action-oriented.', maxWords: 250 };
const QUESTION = 'Should I consider changing my job?';

test('buildPrompt does not accept a bundle — only resolved items', () => {
  assert.equal(buildPrompt.length, 1, 'single destructured argument');
  const src = buildPrompt.toString();
  assert.ok(!src.includes('bundle'), 'prompt builder must not reference the fetched bundle');
});

test('includes every selected item, labelled', () => {
  const p = buildPrompt({ selected: SELECTED, persona: PERSONA, question: QUESTION });
  assert.ok(p.user.includes('[Career Horoscope]'));
  assert.ok(p.user.includes('[10th House]'));
  assert.ok(p.user.includes('lord Moon, strength Strong'));
});

test('excluded context never appears in the prompt', () => {
  const p = buildPrompt({ selected: SELECTED, persona: PERSONA, question: QUESTION });
  assert.ok(!p.user.includes('Relationship'));
  assert.ok(!p.user.includes('Avoid risky investments'));
});

test('carries the persona into the system prompt', () => {
  const p = buildPrompt({ selected: SELECTED, persona: PERSONA, question: QUESTION });
  assert.ok(p.system.includes('English'));
  assert.ok(p.system.includes('Encouraging and action-oriented.'));
  assert.ok(p.system.includes('250'));
});

test('states the grounding rules', () => {
  const p = buildPrompt({ selected: SELECTED, persona: PERSONA, question: QUESTION });
  assert.match(p.system, /ONLY the context/i);
  assert.match(p.system, /[Nn]ever invent/);
});

test('reports prompt size for logging', () => {
  const p = buildPrompt({ selected: SELECTED, persona: PERSONA, question: QUESTION });
  assert.ok(p.chars > 0);
  assert.equal(p.estTokens, Math.ceil(p.chars / 4));
});

test('validateSources keeps only labels that were actually sent', () => {
  const r = validateSources(['Career Horoscope', 'Relationship Horoscope'], SELECTED, ['Career Horoscope']);
  assert.deepEqual(r.sourcesUsed, ['Career Horoscope']);
  assert.deepEqual(r.hallucinated, ['Relationship Horoscope']);
  assert.equal(r.fellBack, false);
});

test('validateSources falls back to primary labels when nothing survives', () => {
  const r = validateSources(['Made Up Source'], SELECTED, ['Career Horoscope']);
  assert.deepEqual(r.sourcesUsed, ['Career Horoscope']);
  assert.equal(r.fellBack, true);
});

test('validateSources tolerates a missing or non-array claim', () => {
  assert.equal(validateSources(undefined, SELECTED, ['Career Horoscope']).fellBack, true);
  assert.equal(validateSources('nope', SELECTED, ['Career Horoscope']).fellBack, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/promptBuilder.test.js`
Expected: FAIL — `Cannot find module '../src/prompt/promptBuilder'`

- [ ] **Step 3: Implement `src/prompt/promptBuilder.js`**

```js
// Receives ONLY resolved+rendered items. The fetched bundle is deliberately
// out of scope here, so excluded context is unreachable rather than merely unused.

const SYSTEM_TEMPLATE = `You are an astrology guidance assistant for MyNaksh.

GROUNDING
- Use ONLY the context provided in the user message.
- Never invent placements, dashas, nakshatras, or dates.
- If the context is insufficient to answer well, say so plainly and set sufficient=false.
- Never mention that any context was withheld or excluded.

STYLE
- Language: {languageName}
- Tone: {toneInstruction}
- Length: at most {maxWords} words.

OUTPUT
Return JSON with keys: answer (string), sourcesUsed (array of the exact bracketed
labels you relied on), sufficient (boolean), missingInfo (string or null).`;

function buildPrompt({ selected, persona, question }) {
  const system = SYSTEM_TEMPLATE
    .replace('{languageName}', persona.languageName)
    .replace('{toneInstruction}', persona.toneInstruction)
    .replace('{maxWords}', String(persona.maxWords));

  const contextBlock = selected.length
    ? selected.map((s) => `[${s.label}] ${s.text}`).join('\n')
    : '(no context available)';

  const user = `QUESTION: ${question}\n\nCONTEXT:\n${contextBlock}`;

  const chars = system.length + user.length;
  return { system, user, chars, estTokens: Math.ceil(chars / 4) };
}

/**
 * The model may only credit sources that were actually sent. Anything else is
 * dropped and reported. An empty intersection falls back to the primary labels
 * so the client never receives an empty sourcesUsed for an answered question.
 */
function validateSources(claimed, selected, primaryLabels) {
  const sent = new Set(selected.map((s) => s.label));
  const list = Array.isArray(claimed) ? claimed : [];

  const sourcesUsed = list.filter((label) => sent.has(label));
  const hallucinated = list.filter((label) => !sent.has(label));

  if (sourcesUsed.length === 0) {
    const fallback = primaryLabels.filter((label) => sent.has(label));
    return { sourcesUsed: fallback, hallucinated, fellBack: true };
  }
  return { sourcesUsed, hallucinated, fellBack: false };
}

module.exports = { buildPrompt, validateSources };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/promptBuilder.test.js`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
git add src/prompt/promptBuilder.js test/promptBuilder.test.js
git commit -m "feat: prompt builder with structural grounding and source validation"
```

---

### Task 8: LLM providers — mock and OpenAI behind one interface

**Est: 40 min**

**Files:**
- Create: `src/llm/mockProvider.js`, `src/llm/openaiProvider.js`, `src/llm/index.js`
- Test: `test/mockProvider.test.js`

**Interfaces:**
- Consumes: `{ system, user }` from Task 7
- Produces: both providers expose the identical interface —
  - `name` → `string`
  - `generate({ system, user }, { maxWords })` → `Promise<{ answer, sourcesUsed, sufficient, missingInfo, model, latencyMs }>`
  - `classifyIntent(question, intentNames)` → `Promise<{ intent, score }>`
  - `src/llm/index.js` exports `getProvider()` → the provider chosen by `LLM_PROVIDER`

- [ ] **Step 1: Write the failing test**

Create `test/mockProvider.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/mockProvider.test.js`
Expected: FAIL — `Cannot find module '../src/llm/mockProvider'`

- [ ] **Step 3: Implement `src/llm/mockProvider.js`**

```js
// A first-class implementation, not a stub: deterministic, offline, and
// contract-identical to openaiProvider so every test can run with no API key.

const LABEL_RE = /^\[([^\]]+)\]\s*(.*)$/;

function parseContext(user) {
  const [, contextBlock = ''] = user.split('CONTEXT:\n');
  return contextBlock
    .split('\n')
    .map((line) => line.match(LABEL_RE))
    .filter(Boolean)
    .map((m) => ({ label: m[1], text: m[2] }));
}

async function generate({ system, user }, { maxWords }) {
  const started = Date.now();
  const items = parseContext(user);
  const question = (user.match(/QUESTION: (.*)/) || [, ''])[1];

  if (items.length === 0) {
    return {
      answer: 'I could not access enough of your chart to answer this reliably right now. Please try again shortly.',
      sourcesUsed: [],
      sufficient: false,
      missingInfo: 'no context items were available',
      model: 'mock-1',
      latencyMs: Date.now() - started,
    };
  }

  const body = [
    `Regarding "${question}" —`,
    ...items.map((i) => `${i.label} indicates: ${i.text}.`),
    'Weigh these signals together and act deliberately rather than abruptly.',
  ].join(' ');

  const words = body.split(/\s+/);
  const answer = words.length > maxWords ? words.slice(0, maxWords).join(' ') : body;

  return {
    answer,
    sourcesUsed: items.map((i) => i.label),
    sufficient: true,
    missingInfo: null,
    model: 'mock-1',
    latencyMs: Date.now() - started,
  };
}

// Deterministic keyword lean so the fallback tier is demonstrable offline.
async function classifyIntent(question, intentNames) {
  const lower = question.toLowerCase();
  const leanings = [
    ['career', ['job', 'work', 'career', 'promotion']],
    ['relationship', ['partner', 'love', 'marriage', 'relationship']],
    ['health', ['health', 'sleep', 'rest', 'energy', 'fitness']],
    ['finance', ['money', 'invest', 'wealth', 'savings']],
    ['daily_summary', ['today', 'week', 'summar', 'prioriti', 'focus']],
  ];
  for (const [intent, words] of leanings) {
    if (intentNames.includes(intent) && words.some((w) => lower.includes(w))) {
      return { intent, score: 0.75 };
    }
  }
  return { intent: 'general', score: 0.55 };
}

module.exports = { name: 'mock', generate, classifyIntent };
```

- [ ] **Step 4: Implement `src/llm/openaiProvider.js`**

```js
const OpenAI = require('openai');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

let client = null;
function getClient() {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    sourcesUsed: { type: 'array', items: { type: 'string' } },
    sufficient: { type: 'boolean' },
    missingInfo: { type: ['string', 'null'] },
  },
  required: ['answer', 'sourcesUsed', 'sufficient', 'missingInfo'],
  additionalProperties: false,
};

async function generate({ system, user }) {
  const started = Date.now();
  const res = await getClient().chat.completions.create({
    model: MODEL,
    temperature: 0.6,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'grounded_answer', strict: true, schema: ANSWER_SCHEMA },
    },
  });

  const parsed = JSON.parse(res.choices[0].message.content);
  return { ...parsed, model: MODEL, latencyMs: Date.now() - started };
}

const INTENT_SCHEMA = {
  type: 'object',
  properties: { intent: { type: 'string' }, score: { type: 'number' } },
  required: ['intent', 'score'],
  additionalProperties: false,
};

async function classifyIntent(question, intentNames) {
  const res = await getClient().chat.completions.create({
    model: MODEL,
    temperature: 0,
    messages: [
      { role: 'system', content: `Classify the user's astrology question into exactly one of: ${intentNames.join(', ')}. Score is your confidence from 0 to 1.` },
      { role: 'user', content: question },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'intent_classification', strict: true, schema: INTENT_SCHEMA },
    },
  });
  return JSON.parse(res.choices[0].message.content);
}

module.exports = { name: 'openai', generate, classifyIntent };
```

- [ ] **Step 5: Implement `src/llm/index.js`**

```js
// The only place a concrete provider is named. Nothing downstream imports
// 'openai' or any provider-specific type — swapping providers is one env var.
function getProvider() {
  if (process.env.LLM_PROVIDER === 'openai') return require('./openaiProvider');
  return require('./mockProvider');
}

module.exports = { getProvider };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test test/mockProvider.test.js`
Expected: PASS — 8 tests

- [ ] **Step 7: Commit**

```bash
git add src/llm test/mockProvider.test.js
git commit -m "feat: swappable LLM provider with deterministic offline mock"
```

---

### Task 9: Mock upstream HTTP server with failure injection

**Est: 40 min**

**Files:**
- Create: `mocks/fixtures/users.json`, `mocks/fixtures/kundli.json`, `mocks/fixtures/horoscope.json`, `mocks/fixtures/panchang.json`
- Create: `mocks/repo/fixtureRepo.js`, `mocks/repo/index.js`, `mocks/server.js`
- Test: `test/mockServer.test.js`

**Interfaces:**
- Produces:
  - An HTTP server on `MOCKS_PORT` (default 4000) serving `GET /users/:userId`, `GET /kundli/:userId`, `GET /horoscope/:userId`, `GET /panchang`
  - Failure injection: `POST /_control/fail` `{ service, mode }` where mode is `'500' | 'timeout' | 'off'`; `POST /_control/reset`
  - Repo contract: `getUser(id)`, `getKundli(id)`, `getHoroscope(id, date)`, `getPanchang(date)` — each returns an object or `null`
  - `startMockServer(port)` → `Promise<http.Server>` for tests

- [ ] **Step 1: Write the fixtures**

`mocks/fixtures/users.json` — three contrasting users, which the personalization demo needs:

```json
{
  "user_101": { "id": "user_101", "name": "Aarav Sharma", "language": "en", "subscription": "premium", "tonePreference": "motivational", "birthDetails": { "date": "1997-08-15", "time": "09:35", "place": "Delhi" } },
  "user_202": { "id": "user_202", "name": "Meera Iyer", "language": "hi", "subscription": "free", "tonePreference": "neutral", "birthDetails": { "date": "1992-03-02", "time": "18:10", "place": "Chennai" } },
  "user_303": { "id": "user_303", "name": "Rohan Gupta", "language": "en", "subscription": "premium", "tonePreference": "direct", "birthDetails": { "date": "2001-11-27", "time": "04:45", "place": "Pune" } }
}
```

`mocks/fixtures/kundli.json`:

```json
{
  "user_101": { "lagna": "Libra", "moonSign": "Scorpio", "currentDasha": { "mahadasha": "Rahu", "antardasha": "Mars" }, "houses": { "6": { "lord": "Jupiter", "strength": "Average" }, "7": { "lord": "Mars", "strength": "Weak" }, "10": { "lord": "Moon", "strength": "Strong" } } },
  "user_202": { "lagna": "Cancer", "moonSign": "Pisces", "currentDasha": { "mahadasha": "Jupiter", "antardasha": "Saturn" }, "houses": { "6": { "lord": "Saturn", "strength": "Strong" }, "7": { "lord": "Saturn", "strength": "Average" }, "10": { "lord": "Mars", "strength": "Weak" } } },
  "user_303": { "lagna": "Aries", "moonSign": "Leo", "currentDasha": { "mahadasha": "Venus", "antardasha": "Mercury" }, "houses": { "6": { "lord": "Mercury", "strength": "Weak" }, "7": { "lord": "Venus", "strength": "Strong" }, "10": { "lord": "Saturn", "strength": "Average" } } }
}
```

`mocks/fixtures/horoscope.json`:

```json
{
  "user_101": { "career": "Networking may bring new opportunities.", "finance": "Avoid risky investments.", "health": "Prioritize proper sleep.", "relationship": "Communication with your partner improves." },
  "user_202": { "career": "Steady progress rewards patience this week.", "finance": "A pending payment is likely to clear.", "health": "Hydration and routine matter more than intensity.", "relationship": "An old misunderstanding finds resolution." },
  "user_303": { "career": "A senior colleague notices your recent work.", "finance": "Review recurring expenses before committing.", "health": "Lower back strain responds well to rest.", "relationship": "Give space before seeking answers." }
}
```

`mocks/fixtures/panchang.json` — note `date` is filled in at request time so "today" is always today:

```json
{ "tithi": "Shukla Panchami", "nakshatra": "Rohini", "yoga": "Siddhi", "karana": "Bava" }
```

- [ ] **Step 2: Write the failing test**

Create `test/mockServer.test.js`:

```js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startMockServer } = require('../mocks/server');

let server;
let base;

before(async () => {
  server = await startMockServer(0);
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

test('serves a user', async () => {
  const res = await fetch(`${base}/users/user_101`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.name, 'Aarav Sharma');
  assert.equal(body.tonePreference, 'motivational');
});

test('returns 404 for an unknown user', async () => {
  assert.equal((await fetch(`${base}/users/nobody`)).status, 404);
});

test('serves kundli with the three specified houses', async () => {
  const body = await (await fetch(`${base}/kundli/user_101`)).json();
  assert.deepEqual(Object.keys(body.houses).sort(), ['10', '6', '7']);
  assert.equal(body.houses['10'].strength, 'Strong');
});

test('serves all four horoscope domains', async () => {
  const body = await (await fetch(`${base}/horoscope/user_101`)).json();
  assert.deepEqual(Object.keys(body).sort(), ['career', 'finance', 'health', 'relationship']);
});

test('panchang needs no userId and reports today', async () => {
  const body = await (await fetch(`${base}/panchang`)).json();
  assert.equal(body.date, new Date().toISOString().slice(0, 10));
  assert.equal(body.tithi, 'Shukla Panchami');
});

test('failure injection makes a service return 500, and reset restores it', async () => {
  await fetch(`${base}/_control/fail`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ service: 'kundli', mode: '500' }),
  });
  assert.equal((await fetch(`${base}/kundli/user_101`)).status, 500);
  assert.equal((await fetch(`${base}/horoscope/user_101`)).status, 200, 'other services unaffected');

  await fetch(`${base}/_control/reset`, { method: 'POST' });
  assert.equal((await fetch(`${base}/kundli/user_101`)).status, 200);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/mockServer.test.js`
Expected: FAIL — `Cannot find module '../mocks/server'`

- [ ] **Step 4: Implement `mocks/repo/fixtureRepo.js`**

```js
const users = require('../fixtures/users.json');
const kundli = require('../fixtures/kundli.json');
const horoscope = require('../fixtures/horoscope.json');
const panchang = require('../fixtures/panchang.json');

module.exports = {
  name: 'fixtures',
  async getUser(id) { return users[id] || null; },
  async getKundli(id) { return kundli[id] || null; },
  async getHoroscope(id) { return horoscope[id] || null; },
  async getPanchang(date) { return { date, ...panchang }; },
};
```

- [ ] **Step 5: Implement `mocks/repo/index.js`**

```js
// Postgres when DATABASE_URL is set, JSON fixtures otherwise.
// This is what keeps `npm start` working with zero infrastructure.
module.exports = process.env.DATABASE_URL
  ? require('./pgRepo')
  : require('./fixtureRepo');
```

- [ ] **Step 6: Implement `mocks/server.js`**

```js
const express = require('express');
const repo = require('./repo');

const today = () => new Date().toISOString().slice(0, 10);

function createApp() {
  const app = express();
  app.use(express.json());

  // service -> 'off' | '500' | 'timeout'
  const failures = { user: 'off', kundli: 'off', horoscope: 'off', panchang: 'off' };

  app.post('/_control/fail', (req, res) => {
    const { service, mode } = req.body || {};
    if (!(service in failures)) return res.status(400).json({ error: 'unknown service' });
    failures[service] = mode || 'off';
    res.json({ ok: true, failures });
  });

  app.post('/_control/reset', (_req, res) => {
    for (const key of Object.keys(failures)) failures[key] = 'off';
    res.json({ ok: true, failures });
  });

  // Applies the injected failure for a service, if any.
  const guard = (service) => (req, res, next) => {
    if (failures[service] === '500') return res.status(500).json({ error: 'injected failure' });
    if (failures[service] === 'timeout') return; // never respond — client timeout fires
    next();
  };

  const send = (res, data) => (data ? res.json(data) : res.status(404).json({ error: 'not found' }));

  app.get('/users/:userId', guard('user'), async (req, res) => send(res, await repo.getUser(req.params.userId)));
  app.get('/kundli/:userId', guard('kundli'), async (req, res) => send(res, await repo.getKundli(req.params.userId)));
  app.get('/horoscope/:userId', guard('horoscope'), async (req, res) => send(res, await repo.getHoroscope(req.params.userId, today())));
  app.get('/panchang', guard('panchang'), async (_req, res) => send(res, await repo.getPanchang(today())));

  return app;
}

function startMockServer(port = Number(process.env.MOCKS_PORT) || 4000) {
  return new Promise((resolve) => {
    const server = createApp().listen(port, () => resolve(server));
  });
}

if (require.main === module) {
  startMockServer().then((s) => {
    console.log(`[mocks] repo=${repo.name} listening on http://localhost:${s.address().port}`);
  });
}

module.exports = { createApp, startMockServer };
```

- [ ] **Step 7: Run test to verify it passes**

Run: `node --test test/mockServer.test.js`
Expected: PASS — 6 tests

- [ ] **Step 8: Commit**

```bash
git add mocks test/mockServer.test.js
git commit -m "feat: mock upstream services over real HTTP with failure injection"
```

---

### Task 10: Gateway — cache, resilient HTTP client, concurrent fetch

**Est: 55 min**

**Files:**
- Create: `src/errors.js`, `src/gateway/cache.js`, `src/gateway/httpClient.js`, `src/gateway/index.js`
- Test: `test/cache.test.js`, `test/gateway.test.js`

**Interfaces:**
- Consumes: `cfg.services` from Task 1; the mock server from Task 9
- Produces:
  - `src/errors.js`: `UpstreamError`, `LlmError`, `ValidationError`, `NotFoundError`, `PipelineError` (each with `.status`)
  - `createCache()` → `{ get(key), set(key, value, ttlMs, staleMaxMs), stats(), clear() }`; `get` returns `{ value, fresh }` or `null`
  - `fetchWithPolicy(url, { timeoutMs, retries, backoffMs })` → `Promise<Object>` — throws `UpstreamError` (with `.status`) after exhausting retries
  - `fetchAll(userId, { cache, servicesConfig, baseUrl })` → `Promise<{ bundle, sourceStates, degradations, userMissing }>`
    - `bundle` = `{ user?, kundli?, horoscope?, panchang? }` — only successful sources present
    - `sourceStates` = `{ kundli: 'fresh'|'stale'|'missing', ... }` for the three context services
    - `userMissing` = `true` only on a genuine 404

- [ ] **Step 1: Write the failing cache test**

Create `test/cache.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { createCache } = require('../src/gateway/cache');

test('returns a fresh hit inside the TTL', () => {
  const c = createCache();
  c.set('k', { a: 1 }, 1000, 5000);
  const hit = c.get('k');
  assert.deepEqual(hit.value, { a: 1 });
  assert.equal(hit.fresh, true);
});

test('returns a stale hit past the TTL but inside staleMaxMs', () => {
  const c = createCache();
  c.set('k', { a: 1 }, -1, 5000); // already expired
  const hit = c.get('k');
  assert.equal(hit.fresh, false);
  assert.deepEqual(hit.value, { a: 1 });
});

test('returns null past staleMaxMs', () => {
  const c = createCache();
  c.set('k', { a: 1 }, -10, -5);
  assert.equal(c.get('k'), null);
});

test('returns null for an unknown key', () => {
  assert.equal(createCache().get('nope'), null);
});

test('tracks hits, misses, size and hitRate', () => {
  const c = createCache();
  c.set('k', 1, 1000, 5000);
  c.get('k'); c.get('k'); c.get('missing');
  const s = c.stats();
  assert.equal(s.hits, 2);
  assert.equal(s.misses, 1);
  assert.equal(s.size, 1);
  assert.equal(s.hitRate, 0.67);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test test/cache.test.js`
Expected: FAIL — `Cannot find module '../src/gateway/cache'`

- [ ] **Step 3: Implement `src/errors.js`**

```js
class AppError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.details = details;
  }
}

class ValidationError extends AppError { constructor(m, d) { super(m, 400, d); } }
class NotFoundError extends AppError { constructor(m, d) { super(m, 404, d); } }
class UpstreamError extends AppError { constructor(m, d) { super(m, 502, d); } }
class LlmError extends AppError { constructor(m, d) { super(m, 503, d); } }

class PipelineError extends AppError {
  constructor(cause, trace) {
    super(cause.message, cause.status || 500, { stage: trace?.at(-1)?.stage });
    this.cause = cause;
    this.trace = trace;
  }
}

module.exports = { AppError, ValidationError, NotFoundError, UpstreamError, LlmError, PipelineError };
```

- [ ] **Step 4: Implement `src/gateway/cache.js`**

```js
// ponytail: unbounded Map; swap for lru-cache if entry count ever matters.

function createCache() {
  const store = new Map();
  let hits = 0;
  let misses = 0;

  return {
    /** Returns { value, fresh } or null. A stale entry is still returned — the
     *  caller decides whether to use it (stale-while-error). */
    get(key) {
      const entry = store.get(key);
      if (!entry) { misses += 1; return null; }
      const age = Date.now() - entry.storedAt;
      if (age > entry.staleMaxMs) { store.delete(key); misses += 1; return null; }
      hits += 1;
      return { value: entry.value, fresh: age <= entry.ttlMs };
    },

    set(key, value, ttlMs, staleMaxMs) {
      store.set(key, { value, ttlMs, staleMaxMs, storedAt: Date.now() });
    },

    stats() {
      const total = hits + misses;
      return { hits, misses, size: store.size, hitRate: total ? Number((hits / total).toFixed(2)) : 0 };
    },

    clear() { store.clear(); hits = 0; misses = 0; },
  };
}

module.exports = { createCache };
```

- [ ] **Step 5: Run the cache test to verify it passes**

Run: `node --test test/cache.test.js`
Expected: PASS — 5 tests

- [ ] **Step 6: Write the failing gateway test**

Create `test/gateway.test.js`:

```js
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { startMockServer } = require('../mocks/server');
const { loadConfig } = require('../src/config');
const { createCache } = require('../src/gateway/cache');
const { fetchAll } = require('../src/gateway');

const servicesConfig = loadConfig().services.services;
let server;
let baseUrl;
let cache;

before(async () => {
  server = await startMockServer(0);
  baseUrl = `http://localhost:${server.address().port}`;
});
after(() => server.close());
beforeEach(async () => {
  cache = createCache();
  await fetch(`${baseUrl}/_control/reset`, { method: 'POST' });
});

const inject = (service, mode) => fetch(`${baseUrl}/_control/fail`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ service, mode }),
});

test('fetches all four services and reports them fresh', async () => {
  const r = await fetchAll('user_101', { cache, servicesConfig, baseUrl });
  assert.ok(r.bundle.user && r.bundle.kundli && r.bundle.horoscope && r.bundle.panchang);
  assert.deepEqual(r.sourceStates, { kundli: 'fresh', horoscope: 'fresh', panchang: 'fresh' });
  assert.deepEqual(r.degradations, []);
});

test('fetches concurrently, not serially', async () => {
  const started = Date.now();
  await fetchAll('user_101', { cache, servicesConfig, baseUrl });
  const serialFloor = Object.values(servicesConfig).reduce((a, s) => a + s.timeoutMs, 0);
  assert.ok(Date.now() - started < serialFloor, 'elapsed time must be well under the sum of all timeouts');
});

test('one failing service does not prevent the others', async () => {
  await inject('kundli', '500');
  const r = await fetchAll('user_101', { cache, servicesConfig, baseUrl });
  assert.equal(r.bundle.kundli, undefined);
  assert.ok(r.bundle.horoscope, 'horoscope still resolved');
  assert.equal(r.sourceStates.kundli, 'missing');
  assert.ok(r.degradations.some((d) => d.includes('kundli')));
});

test('a user 404 is flagged distinctly from an outage', async () => {
  const r = await fetchAll('nobody', { cache, servicesConfig, baseUrl });
  assert.equal(r.userMissing, true);
});

test('serves stale cache when the upstream fails afterwards', async () => {
  await fetchAll('user_101', { cache, servicesConfig, baseUrl });   // warm
  cache.set('kundli:user_101', { lagna: 'Libra' }, -1, 999999);      // force stale
  await inject('kundli', '500');
  const r = await fetchAll('user_101', { cache, servicesConfig, baseUrl });
  assert.equal(r.bundle.kundli.lagna, 'Libra');
  assert.equal(r.sourceStates.kundli, 'stale');
});

test('a warm cache avoids a second upstream round trip', async () => {
  await fetchAll('user_101', { cache, servicesConfig, baseUrl });
  await inject('kundli', '500');
  const r = await fetchAll('user_101', { cache, servicesConfig, baseUrl });
  assert.equal(r.sourceStates.kundli, 'fresh', 'served from the fresh cache, upstream never consulted');
});

test('panchang is cached globally by date, not per user', async () => {
  await fetchAll('user_101', { cache, servicesConfig, baseUrl });
  const keys = cache.stats().size;
  await fetchAll('user_202', { cache, servicesConfig, baseUrl });
  assert.equal(cache.stats().size, keys + 3, 'user/kundli/horoscope added; panchang reused');
});

test('a timeout is survived and reported', async () => {
  await inject('panchang', 'timeout');
  const r = await fetchAll('user_101', { cache, servicesConfig, baseUrl });
  assert.equal(r.sourceStates.panchang, 'missing');
  assert.ok(r.degradations.some((d) => d.includes('panchang')));
});
```

- [ ] **Step 7: Run it and confirm it fails**

Run: `node --test test/gateway.test.js`
Expected: FAIL — `Cannot find module '../src/gateway'`

- [ ] **Step 8: Implement `src/gateway/httpClient.js`**

```js
const { UpstreamError } = require('../errors');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Retries on 5xx and timeouts with jittered backoff. Never retries a 4xx —
 * a 404 will still be a 404 on the third attempt.
 */
async function fetchWithPolicy(url, { timeoutMs, retries, backoffMs }) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });

      if (res.status >= 400 && res.status < 500) {
        throw new UpstreamError(`${url} returned ${res.status}`, { status: res.status, retryable: false });
      }
      if (!res.ok) {
        throw new UpstreamError(`${url} returned ${res.status}`, { status: res.status, retryable: true });
      }
      return await res.json();
    } catch (err) {
      lastError = err;
      const retryable = err.details?.retryable !== false;
      if (!retryable || attempt === retries) break;
      await sleep(backoffMs * (attempt + 1) + Math.floor(Math.random() * backoffMs));
    }
  }

  if (lastError instanceof UpstreamError) throw lastError;
  throw new UpstreamError(`${url} failed: ${lastError?.message || 'unknown error'}`, { retryable: true });
}

module.exports = { fetchWithPolicy };
```

- [ ] **Step 9: Implement `src/gateway/index.js`**

```js
const { z } = require('zod');
const { fetchWithPolicy } = require('./httpClient');

const today = () => new Date().toISOString().slice(0, 10);

// Upstreams are a trust boundary too. A malformed payload degrades cleanly
// instead of interpolating `undefined` into a prompt.
const schemas = {
  user: z.object({ id: z.string() }).passthrough(),
  kundli: z.object({ lagna: z.string() }).passthrough(),
  horoscope: z.object({}).passthrough(),
  panchang: z.object({ tithi: z.string() }).passthrough(),
};

const CONTEXT_SOURCES = ['kundli', 'horoscope', 'panchang'];

function cacheKey(service, userId) {
  if (service === 'panchang') return `panchang:${today()}`;          // global, not per user
  if (service === 'horoscope') return `horoscope:${userId}:${today()}`;
  return `${service}:${userId}`;
}

async function fetchOne(service, userId, { cache, servicesConfig, baseUrl }) {
  const cfg = servicesConfig[service];
  const key = cacheKey(service, userId);

  const cached = cache.get(key);
  if (cached?.fresh) return { service, value: cached.value, state: 'fresh' };

  const url = baseUrl + cfg.path.replace('{userId}', encodeURIComponent(userId));

  try {
    const raw = await fetchWithPolicy(url, cfg);
    const value = schemas[service].parse(raw);
    cache.set(key, value, cfg.cacheTtlMs, cfg.cacheStaleMaxMs);
    return { service, value, state: 'fresh' };
  } catch (err) {
    if (cached) return { service, value: cached.value, state: 'stale', error: err }; // stale-while-error
    return { service, value: null, state: 'missing', error: err };
  }
}

/** Concurrent fan-out. One failing service never prevents the others. */
async function fetchAll(userId, deps) {
  const services = Object.keys(deps.servicesConfig);

  const settled = await Promise.allSettled(
    services.map((service) => fetchOne(service, userId, deps)),
  );

  const bundle = {};
  const sourceStates = {};
  const degradations = [];
  let userMissing = false;

  for (const outcome of settled) {
    if (outcome.status === 'rejected') {
      degradations.push(`unexpected failure: ${outcome.reason?.message}`);
      continue;
    }
    const { service, value, state, error } = outcome.value;

    if (value != null) bundle[service] = value;
    if (CONTEXT_SOURCES.includes(service)) sourceStates[service] = state;

    if (state !== 'fresh') {
      degradations.push(`${service}: ${state}${error ? ` (${error.message})` : ''}`);
    }
    if (service === 'user' && state === 'missing' && error?.details?.status === 404) {
      userMissing = true;
    }
  }

  return { bundle, sourceStates, degradations, userMissing };
}

module.exports = { fetchAll, cacheKey };
```

- [ ] **Step 10: Run the gateway test to verify it passes**

Run: `node --test test/gateway.test.js`
Expected: PASS — 8 tests

- [ ] **Step 11: Commit**

```bash
git add src/errors.js src/gateway test/cache.test.js test/gateway.test.js
git commit -m "feat: resilient concurrent gateway with TTL cache and stale-while-error"
```

---

### Task 11: Pipeline runner + stages

**Est: 55 min**

**Files:**
- Create: `src/observability/logger.js`, `src/pipeline/runner.js`, `src/pipeline/stages.js`
- Test: `test/pipeline.test.js`

**Interfaces:**
- Consumes: everything from Tasks 2–10
- Produces:
  - `run(stages, ctx)` → `Promise<{ ctx, trace }>`; throws `PipelineError` carrying the partial trace when a `critical` stage fails
  - `PLAN` (5 stages) and `EXECUTE` (2 stages) arrays
  - `buildContext({ userId, question, requestId, deps })` → the initial `ctx`
  - `toPlanResponse(ctx, trace)` → the `/debug/personalization` body
  - `toAnswerResponse(ctx)` → the `/personalize` body

- [ ] **Step 1: Implement `src/observability/logger.js`**

```js
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
});

const forRequest = (requestId) => logger.child({ requestId });

module.exports = { logger, forRequest };
```

- [ ] **Step 2: Write the failing test**

Create `test/pipeline.test.js`:

```js
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

const plan = (question, userId = 'user_101') =>
  run(PLAN, buildContext({ userId, question, requestId: 'req_test', deps }));

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
  const { ctx } = await run([...PLAN, ...EXECUTE], buildContext({ userId: 'user_101', question: 'Should I consider changing my job?', requestId: 'r', deps }));
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
});

test('debug output equals the plan half of a full run', async () => {
  const a = await plan('Should I consider changing my job?');
  const b = await run([...PLAN, ...EXECUTE], buildContext({ userId: 'user_101', question: 'Should I consider changing my job?', requestId: 'r', deps }));
  assert.deepEqual(toPlanResponse(a.ctx, a.trace).selectedContext, toPlanResponse(b.ctx, b.trace.slice(0, PLAN.length)).selectedContext);
});

test('a failing upstream degrades the answer instead of failing it', async () => {
  await fetch(`${deps.baseUrl}/_control/fail`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ service: 'kundli', mode: '500' }),
  });
  const { ctx } = await run([...PLAN, ...EXECUTE], buildContext({ userId: 'user_101', question: 'Should I consider changing my job?', requestId: 'r', deps }));
  const body = toAnswerResponse(ctx);
  assert.equal(body.confidence, 'MEDIUM');
  assert.ok(!body.sourcesUsed.includes('10th House'));
});

test('zero resolvable context skips the LLM entirely', async () => {
  for (const service of ['kundli', 'horoscope', 'panchang']) {
    await fetch(`${deps.baseUrl}/_control/fail`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ service, mode: '500' }),
    });
  }
  let generated = false;
  const spy = { ...mockProvider, generate: async (...a) => { generated = true; return mockProvider.generate(...a); } };
  const { ctx } = await run([...PLAN, ...EXECUTE], buildContext({ userId: 'user_101', question: 'Should I change my job?', requestId: 'r', deps: { ...deps, llm: spy } }));
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
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `node --test test/pipeline.test.js`
Expected: FAIL — `Cannot find module '../src/pipeline'`

- [ ] **Step 4: Implement `src/pipeline/runner.js`**

```js
const { PipelineError } = require('../errors');

/**
 * Runs an ordered list of stages, merging each stage's output into ctx and
 * recording a trace entry per stage. Deliberately a plain function: no hooks,
 * no middleware, no event bus.
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
```

- [ ] **Step 5: Implement `src/pipeline/stages.js`**

```js
const { fetchAll } = require('../gateway');
const { detectIntent } = require('../engine/intentDetector');
const { selectContext } = require('../engine/contextSelector');
const { resolvePersona } = require('../engine/personalization');
const { computeConfidence } = require('../engine/confidence');
const { buildPrompt, validateSources } = require('../prompt/promptBuilder');
const { NotFoundError } = require('../errors');

function buildContext({ userId, question, requestId, deps }) {
  return { userId, question, requestId, deps };
}

const PLAN = [
  {
    name: 'fetch_context',
    critical: true,
    fn: async (ctx) => {
      const r = await fetchAll(ctx.userId, {
        cache: ctx.deps.cache,
        servicesConfig: ctx.deps.cfg.services.services,
        baseUrl: ctx.deps.baseUrl,
      });
      if (r.userMissing) throw new NotFoundError(`user '${ctx.userId}' not found`);
      return r;
    },
    trace: (ctx) => ({ sources: ctx.sourceStates, degradations: ctx.degradations }),
  },

  {
    name: 'detect_intent',
    critical: false,
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
      // detect_intent is non-critical; if it failed, fall back here.
      const intent = ctx.intent || 'general';
      const intentConfig = ctx.deps.cfg.intents.intents[intent];
      const selection = selectContext({
        intentConfig,
        registry: ctx.deps.registry,
        bundle: ctx.bundle,
        budgetTokens: ctx.deps.cfg.services.budgetTokens,
      });
      const primaryLabels = intentConfig.primary
        .map((id) => ctx.deps.registry.get(id).label);
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
    trace: (ctx) => ({ language: ctx.persona?.languageName, tone: ctx.persona?.tone, maxWords: ctx.persona?.maxWords }),
  },

  {
    name: 'build_prompt',
    critical: true,
    fn: async (ctx) => {
      const persona = ctx.persona || resolvePersona(null, ctx.deps.cfg.personalization);
      return { persona, prompt: buildPrompt({ selected: ctx.selection.selected, persona, question: ctx.question }) };
    },
    trace: (ctx) => ({ estTokens: ctx.prompt.estTokens, chars: ctx.prompt.chars }),
  },
];

const EXECUTE = [
  {
    name: 'llm_generate',
    critical: true,
    fn: async (ctx) => {
      // Never ask the model to answer without grounding.
      if (ctx.selection.selected.length === 0) {
        return {
          generation: {
            answer: 'I could not access enough of your chart to answer this reliably right now. Please try again shortly.',
            sourcesUsed: [], sufficient: false, missingInfo: 'no context available',
            model: 'none', latencyMs: 0,
          },
          escalated: false,
          llmSkipped: true,
        };
      }

      let generation = await ctx.deps.llm.generate(ctx.prompt, { maxWords: ctx.persona.maxWords });
      let escalated = false;
      let prompt = ctx.prompt;

      // Bounded escalation, max depth 1.
      const canEscalate = ctx.deps.cfg.services.escalation.enabled
        && generation.sufficient === false
        && ctx.selection.excluded.length > 0;

      if (canEscalate) {
        const { resolveItem } = require('../engine/contextRegistry');
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

      return { generation, escalated, prompt, llmSkipped: false };
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

function toPlanResponse(ctx, trace) {
  const expected = computeConfidence({
    intentMethod: ctx.intentMethod || 'fallback',
    intentScore: ctx.intentScore ?? 0.4,
    primaryCoverage: ctx.selection.primaryCoverage,
    sourceStates: ctx.sourceStates,
    sufficient: null,                        // no LLM verdict on the debug path
  }, ctx.deps.cfg.confidence);

  return {
    // the assignment's contract, exactly
    intent: ctx.intent,
    selectedContext: ctx.selection.selected.map((s) => s.label),
    excludedContext: ctx.selection.excluded.map((e) => e.label),
    language: ctx.persona.languageName,
    tone: titleCase(ctx.persona.tone),

    // additional explanation
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
    promptPreview: {
      estTokens: ctx.prompt.estTokens,
      availableTokens: ctx.selection.budget.available,
      sentTokens: ctx.selection.budget.sent,
      reductionPct: ctx.selection.budget.reductionPct,
    },
    trace,
  };
}

module.exports = { PLAN, EXECUTE, buildContext, toAnswerResponse, toPlanResponse };
```

- [ ] **Step 6: Create `src/pipeline/index.js`**

```js
const { run } = require('./runner');
const stages = require('./stages');

module.exports = { run, ...stages };
```

- [ ] **Step 7: Run the pipeline test to verify it passes**

Run: `node --test test/pipeline.test.js`
Expected: PASS — 10 tests

- [ ] **Step 8: Commit**

```bash
git add src/pipeline src/observability test/pipeline.test.js
git commit -m "feat: traced composite pipeline with plan/execute split"
```

---

### Task 12: HTTP routes, error middleware, server wiring

**Est: 45 min**

**Files:**
- Create: `src/routes/personalize.js`, `src/routes/debug.js`, `src/routes/health.js`, `src/server.js`
- Test: `test/api.test.js`

**Interfaces:**
- Consumes: Tasks 10–11
- Produces: `createApp(deps)` → an Express app; `startServer(port)` → `Promise<http.Server>`

- [ ] **Step 1: Write the failing test**

Create `test/api.test.js`:

```js
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { startMockServer } = require('../mocks/server');
const { createApp } = require('../src/server');
const { loadConfig } = require('../src/config');
const { buildRegistry } = require('../src/engine/contextRegistry');
const { createCache } = require('../src/gateway/cache');

let mocks, server, base, mocksBase, cache;

before(async () => {
  mocks = await startMockServer(0);
  mocksBase = `http://localhost:${mocks.address().port}`;

  const cfg = loadConfig();
  cache = createCache();
  const deps = {
    cfg,
    registry: buildRegistry(cfg.registry),
    cache,
    baseUrl: mocksBase,
    llm: require('../src/llm/mockProvider'),
    traceRepo: null,
  };

  server = createApp(deps).listen(0);
  base = `http://localhost:${server.address().port}`;
});

after(() => { server.close(); mocks.close(); });

beforeEach(async () => {
  cache.clear();
  await fetch(`${mocksBase}/_control/reset`, { method: 'POST' });
});

const post = (path, body) => fetch(base + path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('POST /personalize returns exactly the assignment response shape', async () => {
  const res = await post('/personalize', { userId: 'user_101', question: 'Should I consider changing my job in the next few months?' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['answer', 'confidence', 'sourcesUsed']);
  assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(body.confidence));
});

test('POST /debug/personalization returns the assignment debug contract', async () => {
  const body = await (await post('/debug/personalization', { userId: 'user_101', question: 'Should I consider changing my job?' })).json();
  for (const key of ['intent', 'selectedContext', 'excludedContext', 'language', 'tone']) {
    assert.ok(key in body, `missing ${key}`);
  }
  assert.equal(body.intent, 'career');
  assert.deepEqual(body.excludedContext, ['Relationship Horoscope']);
});

test('all five sample questions are handled', async () => {
  const questions = [
    ['Should I consider changing my job this year?', 'career'],
    ['How does this month look for my relationship?', 'relationship'],
    ['What should I focus on for my health?', 'health'],
    ['What should I prioritize this week?', 'daily_summary'],
    ["Can you summarize today's guidance?", 'daily_summary'],
  ];
  for (const [question, expected] of questions) {
    const body = await (await post('/debug/personalization', { userId: 'user_101', question })).json();
    assert.equal(body.intent, expected, `"${question}" → expected ${expected}, got ${body.intent}`);
    assert.ok(body.selectedContext.length > 0);
  }
});

test('personalization differs across users for the same question', async () => {
  const q = 'Should I consider changing my job this year?';
  const a = await (await post('/debug/personalization', { userId: 'user_101', question: q })).json();
  const b = await (await post('/debug/personalization', { userId: 'user_202', question: q })).json();
  assert.equal(a.language, 'English');
  assert.equal(b.language, 'Hindi');
  assert.equal(a.maxWords, 250);
  assert.equal(b.maxWords, 120);
  assert.equal(a.tone, 'Motivational');
  assert.equal(b.tone, 'Neutral');
});

test('an invalid body is a 400 with a requestId', async () => {
  const res = await post('/personalize', { userId: 'user_101' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.requestId);
  assert.ok(body.error);
});

test('an unknown user is a 404', async () => {
  const res = await post('/personalize', { userId: 'nobody', question: 'Should I change my job?' });
  assert.equal(res.status, 404);
});

test('a failing upstream still returns 200 with reduced confidence', async () => {
  await fetch(`${mocksBase}/_control/fail`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ service: 'kundli', mode: '500' }),
  });
  const res = await post('/personalize', { userId: 'user_101', question: 'Should I consider changing my job?' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.confidence, 'MEDIUM');
  assert.ok(!body.sourcesUsed.includes('10th House'));
});

test('GET /health reports upstreams and cache stats', async () => {
  const body = await (await fetch(base + '/health')).json();
  assert.equal(body.status, 'ok');
  assert.ok('hitRate' in body.cache);
  assert.ok(body.upstreams);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test test/api.test.js`
Expected: FAIL — `Cannot find module '../src/server'`

- [ ] **Step 3: Implement `src/routes/personalize.js`**

```js
const { z } = require('zod');
const { run, PLAN, EXECUTE, buildContext, toAnswerResponse } = require('../pipeline');
const { ValidationError } = require('../errors');
const { forRequest } = require('../observability/logger');

const bodySchema = z.object({
  userId: z.string().min(1),
  question: z.string().min(1).max(2000),
});

module.exports = (deps) => async (req, res, next) => {
  const requestId = req.requestId;
  const log = forRequest(requestId);

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ValidationError(parsed.error.issues[0].message, { path: parsed.error.issues[0].path }));
  }

  const startedAt = performance.now();
  try {
    const { ctx, trace } = await run(
      [...PLAN, ...EXECUTE],
      buildContext({ ...parsed.data, requestId, deps }),
    );

    const body = toAnswerResponse(ctx);
    res.json(body);

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

    if (deps.traceRepo) {
      deps.traceRepo.save(ctx, trace).catch((err) => log.warn({ err: err.message }, 'trace persist failed'));
    }
  } catch (err) {
    next(err);
  }
};
```

- [ ] **Step 4: Implement `src/routes/debug.js`**

```js
const { z } = require('zod');
const { run, PLAN, buildContext, toPlanResponse } = require('../pipeline');
const { ValidationError } = require('../errors');

const bodySchema = z.object({
  userId: z.string().min(1),
  question: z.string().min(1).max(2000),
});

// Runs the PLAN half of the very same stage array /personalize uses.
// It cannot drift, and it never invokes the LLM for generation.
module.exports = (deps) => async (req, res, next) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new ValidationError(parsed.error.issues[0].message, { path: parsed.error.issues[0].path }));
  }
  try {
    const { ctx, trace } = await run(PLAN, buildContext({ ...parsed.data, requestId: req.requestId, deps }));
    res.json(toPlanResponse(ctx, trace));
  } catch (err) {
    next(err);
  }
};
```

- [ ] **Step 5: Implement `src/routes/health.js`**

```js
module.exports = (deps) => async (_req, res) => {
  const services = Object.entries(deps.cfg.services.services);

  const upstreams = Object.fromEntries(await Promise.all(services.map(async ([name, cfg]) => {
    const url = deps.baseUrl + cfg.path.replace('{userId}', 'user_101');
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(cfg.timeoutMs) });
      return [name, r.ok ? 'up' : `http_${r.status}`];
    } catch {
      return [name, 'down'];
    }
  })));

  res.json({
    status: 'ok',
    provider: deps.llm.name,
    upstreams,
    cache: deps.cache.stats(),
  });
};
```

- [ ] **Step 6: Implement `src/server.js`**

```js
require('dotenv').config();

const express = require('express');
const { randomUUID } = require('node:crypto');
const { loadConfig } = require('./config');
const { buildRegistry } = require('./engine/contextRegistry');
const { createCache } = require('./gateway/cache');
const { getProvider } = require('./llm');
const { logger, forRequest } = require('./observability/logger');
const { AppError, PipelineError } = require('./errors');

function createApp(deps) {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  app.use((req, _res, next) => { req.requestId = randomUUID(); next(); });

  app.get('/health', require('./routes/health')(deps));
  app.post('/personalize', require('./routes/personalize')(deps));
  app.post('/debug/personalization', require('./routes/debug')(deps));
  if (deps.traceRepo) {
    app.get('/debug/requests/:requestId', require('./routes/requests')(deps));
  }

  app.use((_req, res) => res.status(404).json({ error: 'not found' }));

  // Single place where an error becomes a status code.
  app.use((err, req, res, _next) => {
    const cause = err instanceof PipelineError ? err.cause : err;
    const status = cause instanceof AppError ? cause.status : 500;
    if (status >= 500) forRequest(req.requestId).error({ err: cause.message, stage: err.details?.stage }, 'request failed');
    else forRequest(req.requestId).warn({ err: cause.message }, 'request rejected');
    res.status(status).json({ error: cause.message, requestId: req.requestId });
  });

  return app;
}

function buildDeps() {
  const cfg = loadConfig(); // throws at boot on invalid config
  return {
    cfg,
    registry: buildRegistry(cfg.registry),
    cache: createCache(),
    baseUrl: process.env.UPSTREAM_BASE_URL || 'http://localhost:4000',
    llm: getProvider(),
    traceRepo: null, // wired in Task 15
  };
}

function startServer(port = Number(process.env.PORT) || 3000) {
  const deps = buildDeps();
  return new Promise((resolve) => {
    const server = createApp(deps).listen(port, () => {
      logger.info({ port, provider: deps.llm.name, upstream: deps.baseUrl }, 'context engine listening');
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer().catch((err) => { logger.fatal({ err: err.message }, 'failed to start'); process.exit(1); });
}

module.exports = { createApp, buildDeps, startServer };
```

- [ ] **Step 7: Run the API test to verify it passes**

Run: `node --test test/api.test.js`
Expected: PASS — 8 tests

- [ ] **Step 8: Run the whole suite and start the app end to end**

```bash
npm test
npm run mocks &          # terminal 1
npm start                # terminal 2
curl -s localhost:3000/health | jq
curl -s -X POST localhost:3000/personalize -H 'content-type: application/json' \
  -d '{"userId":"user_101","question":"Should I consider changing my job in the next few months?"}' | jq
curl -s -X POST localhost:3000/debug/personalization -H 'content-type: application/json' \
  -d '{"userId":"user_101","question":"Should I consider changing my job in the next few months?"}' | jq
```

Expected: all tests pass; both endpoints return the documented shapes.

- [ ] **Step 9: Commit**

```bash
git add src/routes src/server.js test/api.test.js
git commit -m "feat: personalize, debug and health endpoints with typed error handling"
```

---

### Task 13: README, architecture diagram, run instructions, demo scripts

**Est: 60 min** — **never cut this; it is a named deliverable.**

**Files:**
- Create: `README.md`, `ARCHITECTURE.md`, `scripts/demo.sh`
- Modify: `package.json` (add `demo` script)

**Interfaces:**
- Consumes: everything
- Produces: the submission's documentation

- [ ] **Step 1: Write `scripts/demo.sh`**

```bash
#!/usr/bin/env bash
# Demonstrates the three graded behaviours: personalization, token reduction, degradation.
set -euo pipefail
API=${API:-http://localhost:3000}
MOCKS=${MOCKS:-http://localhost:4000}
Q='Should I consider changing my job in the next few months?'

ask() { curl -s -X POST "$API/$1" -H 'content-type: application/json' \
        -d "{\"userId\":\"$2\",\"question\":\"$3\"}"; }

echo "=== 1. Same question, three users ==="
for u in user_101 user_202 user_303; do
  echo "--- $u"
  ask debug/personalization "$u" "$Q" | jq '{intent, language, tone, maxWords, selectedContext, excludedContext}'
done

echo; echo "=== 2. Token reduction by intent ==="
for q in "$Q" "What should I focus on for my health?" "Can you summarize today's guidance?"; do
  echo "--- $q"
  ask debug/personalization user_101 "$q" | jq '{intent, promptPreview}'
done

echo; echo "=== 3. Graceful degradation: Kundli service down ==="
ask personalize user_101 "$Q" | jq '{confidence, sourcesUsed}'
curl -s -X POST "$MOCKS/_control/fail" -H 'content-type: application/json' \
  -d '{"service":"kundli","mode":"500"}' > /dev/null
echo "--- kundli now returning 500"
ask personalize user_101 "$Q" | jq '{confidence, sourcesUsed}'
curl -s -X POST "$MOCKS/_control/reset" > /dev/null
echo "--- restored"
```

```bash
chmod +x scripts/demo.sh
npm pkg set scripts.demo="./scripts/demo.sh"
```

- [ ] **Step 2: Write `ARCHITECTURE.md`**

Copy the Mermaid diagrams verbatim from spec §4 (component diagram), §5 (Level 0 and Level 1 data flow), and §14 (ER diagram), each under its own heading, with the one-paragraph explanation that precedes it in the spec.

- [ ] **Step 3: Write `README.md`**

Required sections, in this order:

1. **What this is** — one paragraph: the layer between four astrological services and an LLM.
2. **Run instructions** — both modes, exactly:
   ```bash
   # Zero infrastructure (default)
   npm install
   cp .env.example .env
   npm run mocks     # terminal 1 — upstream services on :4000
   npm start         # terminal 2 — context engine on :3000
   npm test
   npm run demo

   # With a real LLM
   # set OPENAI_API_KEY and LLM_PROVIDER=openai in .env, then npm start

   # With Postgres (optional — Task 14)
   docker compose up -d
   npm run db:seed
   DATABASE_URL=postgres://mynaksh:mynaksh@localhost:5432/mynaksh npm run mocks
   ```
3. **Endpoints** — `/personalize`, `/debug/personalization`, `/health` (+ `/debug/requests/:id` if Task 15 shipped), each with a real request/response pair copied from an actual run.
4. **Architecture** — link to `ARCHITECTURE.md`; explain the `plan()`/`execute()` split and why the debug endpoint cannot drift.
5. **The Personalization Engine** — the context registry, `intents.yaml`, and the extensibility table from spec §17.
6. **How context is optimized** — the five reduction mechanisms and a measured before/after table from a real `npm run demo` run. Paste actual numbers, not estimates.
7. **Confidence** — the formula and the scenario table from spec §11.
8. **Assumptions** — including: Panchang is global per date; `birthDetails` is deliberately excluded from LLM context as PII and redundant with the kundli; the Kundli payload exposes only houses 6/7/10, so `finance` has no house context.
9. **Trade-offs** — the full table from spec §18, each with its revisit trigger. Lead with deterministic-vs-agentic.
10. **What I intentionally simplified / production concerns left out / what another day would add** — spec §19 verbatim.
11. **Requirements traceability** — the tables from spec §21.

- [ ] **Step 4: Verify the README's commands actually work**

Run every command block in a clean shell, in order, from a fresh `git clone` into a temp directory. Fix anything that fails. A README with a broken run instruction is worse than no README.

- [ ] **Step 5: Commit**

```bash
git add README.md ARCHITECTURE.md scripts/demo.sh package.json
git commit -m "docs: README, architecture diagrams, run instructions and demo script"
```

---

**PHASE 1 COMPLETE — this is a submittable assignment.** Stop here if the clock demands it.

---

# PHASE 2 — OPTIONAL TAIL

---

### Task 14: Postgres-backed mock repository

**Est: 75 min**

**Files:**
- Create: `docker-compose.yml`, `db/schema.sql`, `db/seed.js`, `mocks/repo/pgRepo.js`
- Modify: `package.json` (add `db:seed`)
- Test: `test/pgRepo.test.js`

**Interfaces:**
- Produces: `pgRepo` implementing the identical contract as `fixtureRepo` — `getUser(id)`, `getKundli(id)`, `getHoroscope(id, date)`, `getPanchang(date)`. `mocks/repo/index.js` already selects it when `DATABASE_URL` is set; no change needed there.

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: mynaksh
      POSTGRES_PASSWORD: mynaksh
      POSTGRES_DB: mynaksh
    ports: ["5432:5432"]
    volumes:
      - ./db/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mynaksh"]
      interval: 3s
      retries: 10
```

- [ ] **Step 2: Write `db/schema.sql`**

```sql
create table if not exists users (
  id               text primary key,
  name             text not null,
  language         text not null,
  subscription     text not null,
  tone_preference  text not null,
  birth_date       date,
  birth_time       time,
  birth_place      text
);

create table if not exists kundli (
  user_id     text primary key references users(id) on delete cascade,
  lagna       text not null,
  moon_sign   text not null,
  mahadasha   text not null,
  antardasha  text not null
);

-- Supports all twelve houses; only 6, 7 and 10 are seeded, matching the brief.
create table if not exists kundli_houses (
  user_id   text not null references users(id) on delete cascade,
  house     int  not null check (house between 1 and 12),
  lord      text not null,
  strength  text not null,
  primary key (user_id, house)
);

create table if not exists horoscope (
  user_id       text not null references users(id) on delete cascade,
  for_date      date not null,
  career        text not null,
  finance       text not null,
  health        text not null,
  relationship  text not null,
  primary key (user_id, for_date)
);

-- No user_id: panchang is global for a given date.
create table if not exists panchang (
  for_date   date primary key,
  tithi      text not null,
  nakshatra  text not null,
  yoga       text not null,
  karana     text not null
);

create table if not exists requests (
  request_id        uuid primary key,
  user_id           text,
  question          text,
  intent            text,
  intent_method     text,
  intent_score      numeric,
  confidence        text,
  selected_context  text[],
  excluded_context  jsonb,
  available_tokens  int,
  prompt_tokens     int,
  reduction_pct     int,
  total_ms          int,
  llm_ms            int,
  sufficient        boolean,
  missing_info      text,
  degradations      text[],
  context_bundle    jsonb,
  prompt_text       text,
  trace             jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists requests_user_created_idx on requests (user_id, created_at desc);
create index if not exists requests_intent_idx on requests (intent);
```

- [ ] **Step 3: Write `db/seed.js`**

```js
require('dotenv').config();
const { Client } = require('pg');
const users = require('../mocks/fixtures/users.json');
const kundli = require('../mocks/fixtures/kundli.json');
const horoscope = require('../mocks/fixtures/horoscope.json');
const panchang = require('../mocks/fixtures/panchang.json');

const DAYS = 30;

const dateOffset = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  for (const u of Object.values(users)) {
    await client.query(
      `insert into users (id, name, language, subscription, tone_preference, birth_date, birth_time, birth_place)
       values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (id) do nothing`,
      [u.id, u.name, u.language, u.subscription, u.tonePreference, u.birthDetails.date, u.birthDetails.time, u.birthDetails.place],
    );
  }

  for (const [userId, k] of Object.entries(kundli)) {
    await client.query(
      `insert into kundli (user_id, lagna, moon_sign, mahadasha, antardasha)
       values ($1,$2,$3,$4,$5) on conflict (user_id) do nothing`,
      [userId, k.lagna, k.moonSign, k.currentDasha.mahadasha, k.currentDasha.antardasha],
    );
    for (const [house, v] of Object.entries(k.houses)) {
      await client.query(
        `insert into kundli_houses (user_id, house, lord, strength)
         values ($1,$2,$3,$4) on conflict (user_id, house) do nothing`,
        [userId, Number(house), v.lord, v.strength],
      );
    }
  }

  // A month either side so temporal questions have real data.
  for (const [userId, h] of Object.entries(horoscope)) {
    for (let n = -DAYS; n <= DAYS; n += 1) {
      await client.query(
        `insert into horoscope (user_id, for_date, career, finance, health, relationship)
         values ($1,$2,$3,$4,$5,$6) on conflict (user_id, for_date) do nothing`,
        [userId, dateOffset(n), h.career, h.finance, h.health, h.relationship],
      );
    }
  }

  for (let n = -DAYS; n <= DAYS; n += 1) {
    await client.query(
      `insert into panchang (for_date, tithi, nakshatra, yoga, karana)
       values ($1,$2,$3,$4,$5) on conflict (for_date) do nothing`,
      [dateOffset(n), panchang.tithi, panchang.nakshatra, panchang.yoga, panchang.karana],
    );
  }

  const { rows } = await client.query('select count(*)::int as n from users');
  console.log(`seeded — ${rows[0].n} users, ${DAYS * 2 + 1} days of horoscope and panchang`);
  await client.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
```

```bash
npm install pg
npm pkg set scripts["db:seed"]="node db/seed.js"
```

- [ ] **Step 4: Write the failing test**

Create `test/pgRepo.test.js` — skips itself when Postgres is not configured, so the suite stays green without Docker:

```js
const { test, describe } = require('node:test');
const assert = require('node:assert');

const skip = !process.env.DATABASE_URL;

describe('pgRepo', { skip: skip && 'DATABASE_URL not set' }, () => {
  const repo = require('../mocks/repo/pgRepo');
  const today = () => new Date().toISOString().slice(0, 10);

  test('returns a user in the same shape as the fixture repo', async () => {
    const u = await repo.getUser('user_101');
    assert.deepEqual(Object.keys(u).sort(),
      ['birthDetails', 'id', 'language', 'name', 'subscription', 'tonePreference'].sort());
    assert.equal(u.tonePreference, 'motivational');
  });

  test('returns null for an unknown user', async () => {
    assert.equal(await repo.getUser('nobody'), null);
  });

  test('assembles kundli houses into the nested payload shape', async () => {
    const k = await repo.getKundli('user_101');
    assert.equal(k.currentDasha.mahadasha, 'Rahu');
    assert.deepEqual(Object.keys(k.houses).sort(), ['10', '6', '7']);
    assert.equal(k.houses['10'].strength, 'Strong');
  });

  test('returns the horoscope for a given date', async () => {
    const h = await repo.getHoroscope('user_101', today());
    assert.deepEqual(Object.keys(h).sort(), ['career', 'finance', 'health', 'relationship']);
  });

  test('returns panchang keyed by date alone', async () => {
    const p = await repo.getPanchang(today());
    assert.equal(p.date, today());
    assert.equal(p.tithi, 'Shukla Panchami');
  });
});
```

- [ ] **Step 5: Bring up Postgres and confirm the test fails**

```bash
docker compose up -d
sleep 5
npm run db:seed
DATABASE_URL=postgres://mynaksh:mynaksh@localhost:5432/mynaksh node --test test/pgRepo.test.js
```

Expected: FAIL — `Cannot find module '../mocks/repo/pgRepo'`

- [ ] **Step 6: Implement `mocks/repo/pgRepo.js`**

```js
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

// Returns the exact payload shapes the assignment specifies, so pgRepo and
// fixtureRepo are interchangeable behind mocks/repo/index.js.
module.exports = {
  name: 'postgres',

  async getUser(id) {
    const { rows } = await pool.query('select * from users where id = $1', [id]);
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      name: r.name,
      language: r.language,
      subscription: r.subscription,
      tonePreference: r.tone_preference,
      birthDetails: {
        date: r.birth_date ? r.birth_date.toISOString().slice(0, 10) : null,
        time: r.birth_time,
        place: r.birth_place,
      },
    };
  },

  async getKundli(id) {
    const { rows } = await pool.query('select * from kundli where user_id = $1', [id]);
    if (!rows[0]) return null;
    const k = rows[0];
    const { rows: houseRows } = await pool.query(
      'select house, lord, strength from kundli_houses where user_id = $1 order by house', [id],
    );
    return {
      lagna: k.lagna,
      moonSign: k.moon_sign,
      currentDasha: { mahadasha: k.mahadasha, antardasha: k.antardasha },
      houses: Object.fromEntries(houseRows.map((h) => [String(h.house), { lord: h.lord, strength: h.strength }])),
    };
  },

  async getHoroscope(id, date) {
    const { rows } = await pool.query(
      'select career, finance, health, relationship from horoscope where user_id = $1 and for_date = $2',
      [id, date],
    );
    return rows[0] || null;
  },

  async getPanchang(date) {
    const { rows } = await pool.query(
      'select tithi, nakshatra, yoga, karana from panchang where for_date = $1', [date],
    );
    return rows[0] ? { date, ...rows[0] } : null;
  },

  async close() { await pool.end(); },
};
```

- [ ] **Step 7: Run the test to verify it passes, then confirm both modes work**

```bash
DATABASE_URL=postgres://mynaksh:mynaksh@localhost:5432/mynaksh node --test test/pgRepo.test.js
npm test                                          # fixture mode — pgRepo tests skip
DATABASE_URL=postgres://... npm run mocks &       # postgres mode
curl -s localhost:4000/kundli/user_101 | jq
```

Expected: pgRepo tests pass under `DATABASE_URL`, skip without it; both repo modes serve identical payload shapes.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml db mocks/repo/pgRepo.js package.json package-lock.json test/pgRepo.test.js
git commit -m "feat: postgres-backed mock repository with docker compose and seed"
```

---

### Task 15: Trace persistence + request retrieval endpoint

**Est: 45 min**

**Files:**
- Create: `src/store/db.js`, `src/store/traceRepo.js`, `src/routes/requests.js`
- Modify: `src/server.js:buildDeps` (wire `traceRepo` when `DATABASE_URL` is set)
- Test: `test/traceRepo.test.js`

**Interfaces:**
- Consumes: the `requests` table from Task 14; `ctx` and `trace` from Task 11
- Produces:
  - `traceRepo.save(ctx, trace)` → `Promise<void>` — called fire-and-forget, never awaited on the request path
  - `traceRepo.get(requestId)` → `Promise<Object|null>`
  - `GET /debug/requests/:requestId`

- [ ] **Step 1: Write the failing test**

Create `test/traceRepo.test.js`:

```js
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

  test('get returns null for an unknown request id', async () => {
    assert.equal(await traceRepo.get(randomUUID()), null);
  });

  test('save rejects rather than throwing synchronously, so callers can swallow it', async () => {
    await assert.rejects(() => traceRepo.save({ requestId: 'not-a-uuid' }, []));
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `DATABASE_URL=postgres://mynaksh:mynaksh@localhost:5432/mynaksh node --test test/traceRepo.test.js`
Expected: FAIL — `Cannot find module '../src/store/traceRepo'`

- [ ] **Step 3: Implement `src/store/db.js`**

```js
const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  return pool;
}

module.exports = { getPool };
```

- [ ] **Step 4: Implement `src/store/traceRepo.js`**

```js
const { getPool } = require('./db');

const SQL = `
insert into requests (
  request_id, user_id, question, intent, intent_method, intent_score, confidence,
  selected_context, excluded_context, available_tokens, prompt_tokens, reduction_pct,
  total_ms, llm_ms, sufficient, missing_info, degradations,
  context_bundle, prompt_text, trace
) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
on conflict (request_id) do nothing`;

/**
 * Called fire-and-forget after the response is sent. Never awaited on the
 * request path — an audit write must not turn a good answer into a 500.
 */
async function save(ctx, trace) {
  const totalMs = trace.reduce((a, t) => a + (t.ms || 0), 0);

  await getPool().query(SQL, [
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
```

- [ ] **Step 5: Implement `src/routes/requests.js`**

```js
const { NotFoundError } = require('../errors');

module.exports = (deps) => async (req, res, next) => {
  try {
    const row = await deps.traceRepo.get(req.params.requestId);
    if (!row) throw new NotFoundError(`no stored request '${req.params.requestId}'`);
    res.json(row);
  } catch (err) {
    next(err);
  }
};
```

- [ ] **Step 6: Wire it into `src/server.js`**

Replace the `traceRepo: null` line in `buildDeps()` with:

```js
    traceRepo: process.env.DATABASE_URL ? require('./store/traceRepo') : null,
```

- [ ] **Step 7: Run the test to verify it passes, then check end to end**

```bash
DATABASE_URL=postgres://mynaksh:mynaksh@localhost:5432/mynaksh node --test test/traceRepo.test.js
npm test    # still green without DATABASE_URL — these tests skip

DATABASE_URL=postgres://mynaksh:mynaksh@localhost:5432/mynaksh npm run mocks &
DATABASE_URL=postgres://mynaksh:mynaksh@localhost:5432/mynaksh npm start &
RID=$(curl -s -X POST localhost:3000/personalize -H 'content-type: application/json' \
  -d '{"userId":"user_101","question":"Should I consider changing my job?"}' -D - -o /dev/null | true)
# take the requestId from the pino log line, then:
curl -s localhost:3000/debug/requests/<requestId> | jq '{intent, confidence, reduction_pct}'
```

Expected: the stored record returns with the intent, confidence and token reduction from that call.

- [ ] **Step 8: Add the analytics query to the README**

Add under the observability section:

```sql
-- Which intents are under-served by the current context config?
select intent, count(*) filter (where sufficient = false) as insufficient, count(*) as total
from requests group by intent order by insufficient desc;

-- Average token reduction by intent — the evidence for "optimize what you send"
select intent, round(avg(reduction_pct)) as avg_reduction_pct from requests group by intent;
```

- [ ] **Step 9: Commit**

```bash
git add src/store src/routes/requests.js src/server.js test/traceRepo.test.js README.md
git commit -m "feat: persist pipeline traces and expose stored request retrieval"
```

---

## Final verification (run before zipping)

- [ ] `npm test` passes from a clean clone with no `.env`, no Docker, no API key
- [ ] `npm run mocks` + `npm start` + `npm run demo` all work following only the README
- [ ] `POST /personalize` returns exactly `{answer, confidence, sourcesUsed}` — no extra keys
- [ ] `POST /debug/personalization` contains all five keys from the assignment's example
- [ ] All five sample questions resolve to a sensible intent with non-empty `selectedContext`
- [ ] Killing an upstream still yields `200` with reduced confidence
- [ ] `grep -rn "if (intent" src/` returns nothing — the engine is config-driven
- [ ] `grep -rln "require.*\(gateway\|llm\|store\|express\)" src/engine/` returns nothing — the dependency rule holds
- [ ] README contains Assumptions, Trade-offs, what was simplified, and production concerns left out
