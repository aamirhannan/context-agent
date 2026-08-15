# Parallel session split — Personalized AI Context Engine

**Master plan:** `docs/superpowers/plans/2026-08-15-personalized-ai-context-engine.md`
**Base branch:** `feat/context-engine-base`
**Planning session:** stays open — does Session 0, then merge + Tasks 11, 12, 13, 15.

Each worker session executes ONLY its own tasks from the master plan, verbatim — the master plan
carries the full test code and implementation code for every task.

---

## The one rule

**Every file has exactly one owning session.** If you find yourself needing to edit a file listed
under another session, STOP and report it in your end summary instead of editing it.

---

## Session 0 — pre-work (already committed to `feat/context-engine-base`)

Shared foundation. All lanes branch from this and treat these files as **read-only**.

| File | Why it is shared |
|---|---|
| `package.json`, `package-lock.json` | every lane would otherwise add deps/scripts → guaranteed conflict |
| `.env.example`, `.gitignore` | shared config |
| `config/registry.yaml` | Lane A and Lane B both read it |
| `config/intents.yaml` | Lane A and Lane B both read it |
| `config/personalization.yaml` | Lane B reads it |
| `config/confidence.yaml` | Lane B reads it |
| `config/services.yaml` | Lane A and Lane D both read it |
| `src/config/index.js` | every lane's tests call `loadConfig()` |
| `test/config.test.js` | belongs with `src/config` |
| `mocks/fixtures/*.json` | Lane D serves them, Lane E seeds from them |
| `mocks/repo/index.js` | the switch Lane D's fixtureRepo and Lane E's pgRepo both plug into |
| this file + the master plan | workers read them |

`package.json` already declares **every** dependency (including `pg`) and **every** script
(`start`, `mocks`, `test`, `dev`, `demo`, `db:seed`). **No worker runs `npm install` or
`npm pkg set`.**

---

## Lane assignments

### Session 1 — Context registry + selector  (master plan Tasks 2, 3) · ~90 min

The graded core of the assignment.

**Owns:**
```
src/engine/contextRegistry.js
src/engine/contextSelector.js
test/contextRegistry.test.js
test/contextSelector.test.js
```

**Acceptance:** `node --test test/contextRegistry.test.js test/contextSelector.test.js` — 18 tests green.

---

### Session 2 — Intent, personalization, confidence  (Tasks 4, 5, 6) · ~95 min

**Owns:**
```
src/engine/intentDetector.js
src/engine/personalization.js
src/engine/confidence.js
test/intentDetector.test.js
test/personalization.test.js
test/confidence.test.js
```

**Acceptance:** `node --test test/intentDetector.test.js test/personalization.test.js test/confidence.test.js` — 25 tests green.

**Note:** `intentDetector` takes the LLM provider as an injected argument. Its tests use inline
stub objects — do NOT import anything from `src/llm/` (that is Session 3's lane).

---

### Session 3 — Prompt builder + LLM providers  (Tasks 7, 8) · ~75 min

**Owns:**
```
src/prompt/promptBuilder.js
src/llm/mockProvider.js
src/llm/openaiProvider.js
src/llm/index.js
test/promptBuilder.test.js
test/mockProvider.test.js
```

**Acceptance:** `node --test test/promptBuilder.test.js test/mockProvider.test.js` — 17 tests green.

---

### Session 4 — Mock upstreams + resilient gateway  (Tasks 9, 10) · ~95 min

**Owns:**
```
src/errors.js
src/gateway/cache.js
src/gateway/httpClient.js
src/gateway/index.js
mocks/server.js
mocks/repo/fixtureRepo.js
test/cache.test.js
test/gateway.test.js
test/mockServer.test.js
```

**Does NOT own:** `mocks/fixtures/*.json` and `mocks/repo/index.js` — both are Session 0 files,
already committed. Read them, do not edit them.

**Acceptance:** `node --test test/cache.test.js test/gateway.test.js test/mockServer.test.js` — 19 tests green.

---

### Session 5 — Postgres mock repository  (Task 14) · ~75 min · OPTIONAL

Phase 2 of the master plan. **Skip this lane if you only want four terminals** — everything else
still ships as a complete submission.

**Owns:**
```
docker-compose.yml
db/schema.sql
db/seed.js
mocks/repo/pgRepo.js
test/pgRepo.test.js
```

**Does NOT own:** `mocks/repo/index.js` (Session 0 — already wired to select `pgRepo` when
`DATABASE_URL` is set), `mocks/fixtures/*.json` (Session 0 — `db/seed.js` reads them),
`package.json` (Session 0 — `pg` is already installed and `db:seed` is already registered).

**Acceptance:** `docker compose up -d && npm run db:seed`, then
`DATABASE_URL=postgres://mynaksh:mynaksh@localhost:5432/mynaksh node --test test/pgRepo.test.js` — 5 tests green.
Also confirm `npm test` (no `DATABASE_URL`) still passes with those tests **skipped**.

---

## Disjointness check

| Session | Files | Overlap |
|---|---|---|
| 0 | 14 shared files | — |
| 1 | 4 | none |
| 2 | 6 | none |
| 3 | 6 | none |
| 4 | 9 | none |
| 5 | 5 | none |

Zero shared files across lanes 1–5. Verified by:

```bash
for n in 1 2 3 4 5; do git diff --name-only feat/context-engine-base..feat/context-engine-s$n; done | sort | uniq -d
```

Must print nothing.

---

## Merge order

Independent lanes, so order barely matters. Merge in dependency-of-consumption order so that a
failure surfaces early:

```
s1 (registry+selector) → s2 (intent/persona/confidence) → s3 (prompt+llm) → s4 (mocks+gateway) → s5 (postgres)
```

Expected conflicts: **none**.

---

## Planning session tail — after all lanes merge

These need every lane present, so they are NOT parallelized:

| Task | Files | Why it is a tail task |
|---|---|---|
| **11** — pipeline runner + stages | `src/observability/logger.js`, `src/pipeline/{runner,stages,index}.js`, `test/pipeline.test.js` | imports from every lane |
| **12** — routes + server | `src/routes/{personalize,debug,health}.js`, `src/server.js`, `test/api.test.js` | needs Task 11 |
| **13** — README + diagrams + demo | `README.md`, `ARCHITECTURE.md`, `scripts/demo.sh` | documents real measured output |
| **15** — trace persistence | `src/store/{db,traceRepo}.js`, `src/routes/requests.js`, `src/server.js`, `test/traceRepo.test.js` | modifies `src/server.js` (Task 12) and `README.md` (Task 13) |

---

## Worker rules

1. Read the master plan and execute **only** your lane's tasks, following its steps in order:
   failing test → confirm it fails → implementation → confirm it passes → commit.
2. The master plan contains the complete test and implementation code. Use it. If you believe a
   snippet is wrong, fix it and **say so in your end summary** — do not silently redesign.
3. **Never** run `npm install` or `npm pkg set`. Dependencies and scripts are already set.
4. **Never** edit a file outside your Owns list.
5. Commit on your own branch only. Do **not** merge, do **not** push, do **not** rebase.
6. Two architectural rules the final verification greps for — do not break them:
   - Nothing under `src/engine/` may `require` from `src/gateway/`, `src/llm/`, `src/store/`, or `express`.
   - No `if (intent === ...)` branching anywhere in `src/` — behaviour comes from config.
7. End with a summary: files changed, test counts, and anything you could not complete and why.
