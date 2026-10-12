# GatherBite

**An AI agent that orders food for a group — and proves the order is correct before anyone pays.**

Ordering pizza for a group is a constraint problem disguised as a chore. Twelve people, three of them
vegetarian, one gluten-free, a $90 budget, and a store that may or may not still be delivering. An LLM
is good at *proposing* an order that satisfies all of that. It is not trustworthy at *confirming* one —
it will happily assure you the vegetarians are covered when they are not.

GatherBite splits those two jobs apart. A **Planner** proposes. A **Verifier** checks. Nothing reaches
a cart until the checks pass.

---

## Architecture: propose, then verify

The core design rule is that **the component that proposes an order is never the component that
approves it**, and the final gate is not a language model at all.

```
   group requirements
   (attendees, dietary groups, budget, preferences)
             │
             ▼
   ┌─────────────────────┐
   │   Planner Agent     │  LLM (tool-calling loop)
   │  proposes candidate │  reads live menus, store hours, prices
   └─────────┬───────────┘
             │  candidate order
             ▼
   ┌─────────────────────┐
   │  Verifier Agent     │  LLM, isolated — sees only an evidence bundle
   │  APPROVE / REJECT   │  output constrained to a strict schema
   └─────────┬───────────┘
             │
             ▼
   ┌─────────────────────┐
   │ Deterministic gate  │  plain TypeScript. No model judgment.
   │  verifyPlan()       │  slice math, dietary coverage, budget, item existence
   └─────────┬───────────┘
             │ verified only
             ▼
   ┌─────────────────────┐
   │  Cart preparation   │  re-verified before AND after execution
   └─────────────────────┘
```

### The layers

**1. Planner Agent** — [`src/lib/agents/dominosPlanner.ts`](src/lib/agents/dominosPlanner.ts)

A tool-calling loop (Vercel AI SDK `ToolLoopAgent`) that reads live store snapshots, catalogs, and
serviceability data, then proposes a candidate order. It has no authority to approve its own work.

**2. Verifier Agent** — [`src/lib/agents/dominosVerifier.ts`](src/lib/agents/dominosVerifier.ts)

A separate agent that receives a **candidate evidence bundle** rather than the planner's reasoning, so
it cannot inherit the planner's assumptions. Its output is constrained by a Zod discriminated union in
[`verifierGuard.ts`](src/lib/agents/verifierGuard.ts) — the only shapes it can return are:

- `APPROVE` with exactly one supporting reason, or
- `REJECT` with a disposition of `ADAPT_ORDER`, `TRY_ANOTHER_STORE`, or `TERMINAL`

A malformed or creative response is rejected by the schema, not interpreted.

**3. Deterministic verification** — [`src/lib/verify.ts`](src/lib/verify.ts)

The final gate contains no LLM judgment whatsoever. It is arithmetic and lookups against trusted menu
data:

| Check | Failure code |
| --- | --- |
| Enough slices for every attendee | `INSUFFICIENT_TOTAL_SLICES` |
| Each dietary group is covered | `INSUFFICIENT_GROUP_COVERAGE` |
| Order fits the budget, fees included | `OVER_BUDGET` |
| Every item exists in the real menu | `INVALID_ITEM_REFERENCE` |
| The restrictions are satisfiable at all | `DIETARY_COVERAGE_IMPOSSIBLE` |

### Fail-closed by design

Unknown is not a pass. If live data is missing, a price cannot be read, or dietary evidence is
inconclusive, the result stays `insufficient-data` and is never upgraded into an approval. The system
would rather tell you it does not know than invent a number — missing prices stay `null` instead of
becoming `0`, and unproven dietary compatibility can never reach `FULLY_VIABLE`.

### Bounded retries

[`agentLoop.ts`](src/lib/gatherbite/agentLoop.ts) stops model work at deterministic boundaries only: a
verified candidate, a provably impossible request, or three attempts. A failed-but-adaptable candidate
keeps the loop open; nothing else does.

### Verification survives execution

Cart preparation re-verifies before execution, compares the *actual* observed cart against the approved
candidate with an independent comparator, then verifies again afterward. An executor that claims its own
result is verified is never trusted at face value.

---

## Tests

**532 passing, 0 failing**, across the ten suites in the `npm test` chain.

```
verify ................. 18      new-restrictions ...... 35
scoring ................ 20      dominos ............... 84
order-input-schema ..... 15      dominos-dietary ....... 47
food-buffer ............ 28      gatherbite ............ 41
add-buffer ............. 22      gatherbite-final ..... 222
```

The suites are behavioral rather than incidental: they assert that unknown data cannot be upgraded to a
pass, that tampered prices, methods, and stores are caught before execution, that a hung verifier call is
aborted rather than awaited forever, and that the retry contract holds even when nothing succeeds.

The repository contains additional `.test.ts` files beyond the default chain; `npm test` runs the ten
listed above.

---

## Tech stack

| | |
| --- | --- |
| Framework | Next.js 16.4.0 (App Router) |
| UI | React 19.2.8, Tailwind CSS 4 |
| Language | TypeScript 5 |
| Agents | Vercel AI SDK v7 (`ai`) — `ToolLoopAgent` |
| Models | Groq (`openai/gpt-oss-120b`) by default; OpenRouter supported |
| Validation | Zod 4 |
| Tests | `tsx` + `node:test` |
| Lint | ESLint 9 |

---

## Running locally

### Prerequisites

- **Node.js 20+** (developed on v24)
- A **Groq API key** — free at [console.groq.com](https://console.groq.com)

### Setup

```bash
git clone https://github.com/Yosef-dev116/gatherbite.git
cd gatherbite
npm install
```

Create `.env.local` in the project root:

```bash
GROQ_API_KEY=your-groq-api-key-here
```

> `.env.local` is gitignored. Never commit real keys.

### Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Run the tests

```bash
npm test
```

The suite is fully deterministic — it uses fixtures and needs **no API key and no network access**, so
you can verify the whole verification pipeline before configuring any model provider.

Run a single suite:

```bash
npm run test:verify
```

### Other commands

```bash
npm run build
```

```bash
npm run lint
```

```bash
npm run eval:verifier
```

### Optional environment variables

| Variable | Purpose |
| --- | --- |
| `GROQ_API_KEY` | Groq API key (default provider) |
| `GATHERBITE_MODEL_PROVIDER` | Set to `openrouter` to use OpenRouter instead of Groq |
| `OPENROUTER_API_KEY` | Required when the provider is `openrouter` |
| `OPENROUTER_MODEL` | OpenRouter model id (default `openrouter/free`) |
| `GATHERBITE_VERIFIER_MODEL` | Override the verifier model independently of the planner |

---

## Project layout

```
src/
  app/                     Next.js App Router pages and API routes
    api/gatherbite/        main evaluation endpoint (+ streaming, cart preparation)
  components/              React UI — requirements form, verification journey, results
  lib/
    agents/                Planner and Verifier agents, verifier guard, eval harness
    gatherbite/            orchestrator, contracts, agent loop, ranking, events
    restaurants/           Domino's and Little Caesars data adapters
    cart/                  cart executor, comparator, fallback
    verify.ts              deterministic verification gate
agent/                     standalone tool-calling agent (eve runtime)
docs/                      design specs, demo runbook, deployment checklist
```

## Release status

GatherBite is an installable web release candidate, not a native iOS build. The
current live recommendation path also fails closed while official candidate-bound
checkout pricing is unavailable. See the
[production checklist](docs/deployment/gatherbite-production-checklist.md) and
[App Store readiness assessment](docs/deployment/app-store-readiness.md) for the
verified blockers and release path.

## License

[MIT](LICENSE) © 2026 Yosef Mekonnen
