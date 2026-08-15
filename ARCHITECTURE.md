# Architecture

## Component view

The service sits between four astrological microservices and an LLM. `src/engine/` is pure —
it imports nothing from `gateway/`, `llm/`, or `store/`, which is what makes it testable without
mocks and keeps the selection logic honest.

```mermaid
flowchart TB
    Client([Client])

    subgraph API["Personalization Service"]
        Routes["routes/<br/>personalize · debug · health"]
        Runner["pipeline/runner.js<br/>stage runner + trace"]

        subgraph Engine["engine/ — pure, no I/O"]
            Intent["intentDetector"]
            Registry["contextRegistry"]
            Selector["contextSelector"]
            Persona["personalization"]
            Conf["confidence"]
        end

        Prompt["prompt/promptBuilder"]
        Gateway["gateway/<br/>httpClient · cache · 4 clients"]
        LLM["llm/<br/>provider · openai · mock"]
        Store["store/traceRepo"]
    end

    subgraph Mocks["Mock Upstreams (separate process)"]
        MU["/users/:id"]
        MK["/kundli/:id"]
        MH["/horoscope/:id"]
        MP["/panchang"]
    end

    PG[(PostgreSQL)]
    OpenAI([OpenAI API])

    Client --> Routes --> Runner
    Runner --> Gateway
    Runner --> Engine
    Runner --> Prompt --> LLM --> OpenAI
    Runner --> Store --> PG
    Gateway --> MU & MK & MH & MP
    Mocks --> PG
```

## Data flow — level 0

```mermaid
flowchart LR
    U([User]) -->|"userId + question"| PE[Personalization<br/>Engine]
    PE -->|"answer · confidence · sourcesUsed"| U
    PE <-->|"GET /users/:id"| US[User Service]
    PE <-->|"GET /kundli/:id"| KS[Kundli Service]
    PE <-->|"GET /horoscope/:id"| HS[Horoscope Service]
    PE <-->|"GET /panchang"| PS[Panchang Service]
    PE -->|"prompt"| L([LLM Provider])
    L -->|"structured JSON"| PE
    PE -->|"trace"| DB[(Postgres)]
```

## Data flow — level 1, the pipeline

`/personalize` runs `[...PLAN, ...EXECUTE]`. `/debug/personalization` runs `PLAN`. Same array,
one slice shorter — so the debug endpoint cannot drift from the real pipeline, and it is
LLM-free by construction rather than by convention.

```mermaid
flowchart TD
    IN["userId + question"] --> S1

    subgraph PLAN["plan() — no answer generation"]
        S1["1 · fetch_context<br/>Promise.allSettled × 4<br/>cache · timeout · retry"]
        S2["2 · detect_intent<br/>rules → LLM fallback"]
        S3["3 · select_context<br/>primary ∪ secondary − exclude<br/>resolve · budget · render"]
        S4["4 · resolve_persona<br/>language · tone · maxWords"]
        S5["5 · build_prompt<br/>only selected items"]
        S1 --> S2 --> S3 --> S4 --> S5
    end

    subgraph EXEC["execute()"]
        S6["6 · llm_generate<br/>answer · sourcesUsed<br/>sufficient · missingInfo"]
        S7["7 · assemble<br/>intersect sources<br/>compute confidence"]
        S6 --> S7
    end

    S5 --> S6
    S5 -.->|"/debug/personalization<br/>stops here"| DBG["plan + trace"]
    S7 --> OUT["answer · confidence · sourcesUsed"]

    S3 -.->|"zero context resolved"| SKIP["skip LLM<br/>graceful message · LOW"]
    S6 -.->|"sufficient = false<br/>AND excluded available"| S6R["one bounded retry<br/>max depth 1"]
```

## Data model

`panchang` has no `user_id` — it is global for a given date, which is why its cache key is the
date alone. `horoscope` is keyed `(user_id, for_date)` because horoscopes are daily.
`kundli_houses` supports all twelve houses; only 6, 7 and 10 are seeded, matching the payload
the assignment specifies.

The first five tables back the **mock upstream services**. `requests` belongs to the
**personalization service** and stores one row per call.

```mermaid
erDiagram
    USERS ||--|| KUNDLI : "has one"
    USERS ||--o{ KUNDLI_HOUSES : "has many"
    USERS ||--o{ HOROSCOPE : "has one per day"
    USERS ||--o{ REQUESTS : "generates"

    USERS {
        text id PK
        text name
        text language
        text subscription
        text tone_preference
        date birth_date
        time birth_time
        text birth_place
    }
    KUNDLI {
        text user_id PK_FK
        text lagna
        text moon_sign
        text mahadasha
        text antardasha
    }
    KUNDLI_HOUSES {
        text user_id PK_FK
        int house PK
        text lord
        text strength
    }
    HOROSCOPE {
        text user_id PK_FK
        date for_date PK
        text career
        text finance
        text health
        text relationship
    }
    PANCHANG {
        date for_date PK
        text tithi
        text nakshatra
        text yoga
        text karana
    }
    REQUESTS {
        uuid request_id PK
        text user_id
        text question
        text intent
        text intent_method
        text confidence
        text_array selected_context
        jsonb excluded_context
        int available_tokens
        int prompt_tokens
        int reduction_pct
        int total_ms
        int llm_ms
        bool sufficient
        text missing_info
        text_array degradations
        jsonb context_bundle
        text prompt_text
        jsonb trace
        timestamptz created_at
    }
```

## Two roles for storage

| Store | Holds | Why |
|---|---|---|
| **In-memory TTL cache** | upstream responses | the assignment's caching requirement; per-process, no infrastructure |
| **Postgres** | mock seed data + request traces | realistic upstreams and durable observability |

They solve different problems. Postgres never caches upstream responses.

## Module dependency rule

```
routes/  →  pipeline/  →  engine/     (pure)
                       →  gateway/    (I/O)
                       →  prompt/
                       →  llm/        (only place a provider is named)
                       →  store/
```

One direction only. `engine/` sits at the bottom and imports nothing that touches the network,
the filesystem, or a database. Verified mechanically:

```bash
grep -rn "require(.*\(gateway\|llm\|store\|express\)" src/engine/   # must be empty
```
