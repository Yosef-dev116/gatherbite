# GatherBite

**The AI agent that figures out how to feed your group.**

GatherBite solves the group-food coordination problem that comes before
checkout. An organizer describes their group once — attendance, budget,
dietary needs, taste preferences, and how they want the food fulfilled.
GatherBite reads current live restaurant data, proposes a concrete order,
independently verifies every hard constraint, adapts a rejected candidate,
and recommends the best verified option. **The organizer stays in control of
the final review, payment, and order submission — GatherBite never completes
either.**

The central product principle:

> The AI proposes. It doesn't decide blindly.

## Why pizza, why Domino's

The hackathon implementation is pizza-first because pizza is the only food
category this project has a trusted serving-capacity model for (trusted
slices per pizza, per attendee). **Domino's is the sole provider in the
normal user journey** because the project has live public store, menu, deal,
price, availability, and wait data for two supported PEI stores (10950
Charlottetown, 386 University Ave; 10953 Stratford, 14 Kinlock Rd Unit 11).
GatherBite describes this integration honestly as **live public data** — it
does not claim a formal partnership or a supported third-party integration
with Domino's.

Little Caesars remains in the codebase (`src/lib/agent.ts` and related
files) as a working fallback engine and provider-extensibility evidence, but
the normal Domino's-first journey does not spend its model latency — it is
not part of the main route.

## Architecture

### Planner and Verifier are separate agents, on purpose

A single model that both proposes and approves its own order can rationalize
past a hard constraint under pressure to "find something." GatherBite splits
this into two genuinely separate model invocations:

- **Planner Agent** (`src/lib/agents/dominosPlanner.ts`) reads organizer
  requirements, calls live Domino's observation tools, and proposes a
  complete candidate order. It may adapt a rejected candidate, but **it
  cannot approve its own work** — its prose has no approval authority.
- **Verification Agent** (`src/lib/agents/dominosVerifier.ts`) is invoked as
  a separate model call for every candidate. It inspects one versioned
  candidate, calls an exact evidence tool, and is the **only** part of the
  system allowed to return `APPROVE` or `REJECT`.

The Planner submits at most two initial candidates and, only after a
structured rejection that supports adaptation, exactly one adapted
candidate. There is no blind retry loop.

### What's deterministic code vs. what's model judgment

All hard facts and arithmetic — dietary evidence lookup, pizza-slice
capacity counting, budget totals, store availability, delivery
serviceability — are computed by exact, independently tested TypeScript
functions, fanned out concurrently and returned as a typed evidence bundle
(`src/lib/gatherbite/orchestrator.ts` and the evidence modules it calls). The
Verification Agent's only job is to read that typed evidence and decide
`APPROVE`/`REJECT` — it never performs arithmetic or infers an ingredient
fact itself. A fail-closed protocol guard can veto an internally
inconsistent approval, but it can never manufacture one.

### Dietary evidence is fail-closed

Every dietary check resolves to one of four states: `SAFE`, `CONTAINS`,
`MAY_CONTAIN`, or `UNKNOWN`. **Only `SAFE` satisfies a restriction.**
`CONTAINS`, `MAY_CONTAIN`, `UNKNOWN`, an unrecognized ingredient, or missing
component data all fail the check and block the order. Getting an
allergen/restriction wrong is a real-world harm a "best guess" architecture
cannot justify, so an unproven case is always treated as unsafe rather than
silently passed. "Gluten-Friendly" is explicitly not a celiac-safety or
medical-allergy guarantee, and the UI does not claim one.

### The pizza capacity model

Capacity is pizza-only — non-pizza items never count toward feeding a group.
Every dietary group gets its own protected pizzas with enough trusted slices
allocated before any general-preference pizza is added, and a protected
slice is never displaced or double-counted away to satisfy a different
group. The complete order must provide at least three trusted slices per
attendee. Preferences (cheese, pepperoni, veggie, meat lovers) are taste
mappings applied only to general pizzas — they never participate in
approval and never touch a dietary-protected line.

## Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Requires a `GROQ_API_KEY` in your environment
(server-only — never expose it to the client) for the Planner/Verifier model
calls; see `docs/deployment/gatherbite-production-checklist.md` for the full
environment variable reference for the deployed instance.

## Testing

### Deterministic — part of `npm test`, no network calls

```bash
npm test
```

which runs, in order:

```
test:verify → test:scoring → test:input → test:buffer → test:add-buffer
→ test:restrictions → test:dominos → test:dominos-dietary → test:gatherbite
→ test:gatherbite-final
```

Each is independently runnable (e.g. `npm run test:gatherbite-final`). These
cover input validation, scoring, capacity/budget/dietary logic, the
Domino's-specific dietary evidence model, and the full Planner/Verifier/cart
pipeline against fixtures — no live Domino's or Groq calls are made.

### Live / network-dependent — opt-in only, never part of `npm test`

```bash
npm run eval:verifier   # scripts/run-verifier-eval.ts — live model comparison, needs GROQ_API_KEY
npm run test:live       # scripts/check-gatherbite-live.ts — hits an already-deployed URL
```

`npm run test:live` requires `--url=<deployment>` (or `GATHERBITE_LIVE_URL`)
and never guesses a target. It prints only response-derived facts (HTTP
status, the `Server-Timing` header, total duration, option count, and the
public decision sequence) — never a request body or private reasoning.

## The human decision boundary

GatherBite recommends. A human always decides. Concretely:

- The best verified option is visually recommended with a short
  evidence-backed reason, but it is **not automatically selected** — the
  organizer picks an option, and can change their pick.
- Selecting an option opens a final review of the exact configured order,
  store, method, total, capacity, and dietary allocation before anything
  else happens.
- Cart preparation, when triggered, produces a guided order guide (see
  below) — it **never enters payment details and never submits an order.**
  From the shipped UI: *"You review the official cart and complete payment.
  GatherBite never submits or pays for an order."*

## Public-data and dietary trust wording

This is the entirety of GatherBite's data/dietary trust claim, verbatim from
the shipped UI (`src/app/page.tsx`, `src/components/GroupRequirementsForm.tsx`):

> Tell us what your group needs. GatherBite checks live public restaurant
> data and independently verifies the hard constraints before you decide.
>
> Live public data can change. GatherBite does not claim a restaurant
> partnership or medical allergy safety, and never completes payment for you.
>
> Add only what applies. Each need is verified independently from trusted
> evidence.

## Cart preparation — guided-handoff only, honestly

Cart mode is currently locked to `guided-handoff`
(`src/lib/cart/dominosCartExecutor.ts`), per a deliberate ruling: Task 2's
live research into official cart creation, secure session takeover, and
deep-link state found no reproducible evidence to support a stronger
execution tier. GatherBite therefore always produces an exact order guide —
store, service method, deals, pizza configuration, verified price evidence,
and per-line/whole-order copy controls — with a primary "Open Domino's with
my order guide" action, rather than claiming a prepared or transferred cart
that was never actually built. The full state machine for a real browser
session exists and is unit-tested against a fake driver, but is dormant in
production until real transfer capability is proven.

## Provider and capacity limits

- **Domino's only, for now.** It's the only provider with live public data
  this project has integrated and evidence-tested. Adding another provider
  is a real extension point, not a hardcoded assumption — Little Caesars'
  parallel, independently working engine already demonstrates the pattern.
- **Pizza-only capacity model.** No other food category has a trusted
  serving-capacity model implemented yet.
- **Known current limitation — Groq TPM cap.** The Planner's live-catalog
  prompt runs to roughly 41,500 tokens per request, and the connected Groq
  account is currently capped at 8,000 tokens-per-minute (on-demand tier),
  so live Planner calls on the deployed instance presently fail with a
  `Request too large` error from Groq — an external account-tier limit, not
  a code defect. The app handles this gracefully: it never crashes, and
  instead shows its normal "No verified option yet" explanation. See
  `docs/demo/gatherbite-demo-runbook.md` and
  `docs/deployment/gatherbite-production-checklist.md` for the full detail
  and numbers.

## The isolated Eve experiment

`/agent` (`agent/agent.ts`, `agent/instructions.md`,
`agent/spike.test.ts`, and the `eve:info` / `eve:build` / `eve:dev` /
`test:eve-spike` scripts in `package.json`) is an **isolated spike**
exploring Vercel's `eve` durable-agent runtime as an alternative
orchestration approach — not part of the shipped product. It was never wired
into the production Next.js route, is not a build or release dependency, and
is not exercised by `npm test`. It stayed isolated specifically so
evaluating it never put the shipped Domino's-first path at risk.

## Learn more

This is a Next.js App Router project deployed on Vercel, using the Vercel AI
SDK's `ToolLoopAgent` over Groq (`openai/gpt-oss-120b`) for both the Planner
and Verification Agent. See `docs/superpowers/specs/2026-08-14-gatherbite-hackathon-final-design.md`
for the full approved product/architecture design.
