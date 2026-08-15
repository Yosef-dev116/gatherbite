# GatherBite demo runbook

Status: honest working document for the hackathon judged demo. It records what
was actually observed against the live deployment, not what was hoped for.
Where a section describes something that has not yet been observed, it is
labelled **"expected, not yet observed"** and must not be read as a completed
rehearsal.

Deployed URL: `https://gatherbite-hackathon-final.vercel.app`

## 1. The example live request

This is the same request already used for the one live check performed
against the deployment (see Section 2). It contains no delivery address and
no PII — safe to reuse verbatim, safe to type in front of judges.

Enter these values on the main page (`GroupRequirementsForm`, the single
form on `/`):

| Field | Value |
|---|---|
| People | `4` |
| Maximum total budget (CAD) | `80` |
| Fulfilment | `Carryout` (address fields do not appear) |
| Dietary need — click "Add dietary need" once | People: `2`, restriction: `Vegetarian` |
| What does your group like? | `Pepperoni` |

Press **"Find my verified order."**

This is exactly the `GatherBiteInput` the deployed app already received:

```json
{
  "attendees": 4,
  "budgetCad": 80,
  "serviceMethod": "carryout",
  "groups": [{ "id": "vegetarian", "people": 2, "restrictions": ["vegetarian"] }],
  "pizzaPreferences": ["pepperoni"]
}
```

It is also the built-in `DEFAULT_SAFE_REQUEST` in `scripts/check-gatherbite-live.ts`,
so `npm run test:live -- --url=https://gatherbite-hackathon-final.vercel.app`
reproduces it from the command line without retyping anything.

This request was chosen deliberately: a mixed group with a real dietary
constraint (vegetarian, verified against the curated Domino's dietary
evidence — not a made-up rule) and a real taste preference (pepperoni,
applied only to the general, non-protected pizzas), well inside a normal
$80 carryout budget for 4 people. It asks GatherBite to do real work — protect
2 vegetarian slices, fill remaining capacity, honor a preference on the
unprotected pizzas, and price the whole order — using only current live
Domino's data. Nothing about it instructs the Planner to build a bad
candidate; any rejection that occurs must come from genuine live evidence,
never a staged input.

## 2. What live evidence DID confirm

One live check has been run against the deployment (not fabricated, not
re-run since — this section reports that single result exactly):

```
npm run test:live -- --url=https://gatherbite-hackathon-final.vercel.app
```

using the default safe request above. Observed:

- `status: 200`
- The `Server-Timing` header was present and contained real per-store spans —
  `dom_10950_profile`, `dom_10950_menu`, `dom_10953_profile`, `dom_10953_menu`,
  a `dominos;dur=233` total, and an `observation;dur=235` total. These are
  genuine live Domino's store/menu fetches for both supported PEI stores
  (10950 Charlottetown, 10953 Stratford) — proof the deployment reaches real
  Domino's data, not a mock.
- `planner;dur=1455.5` then failed. The result was `option count: 0` with an
  empty decision sequence (`decisionSequence: []`).
- The evaluation's `noViableReason` was the exact string
  `"GatherBite could not verify a Domino's option from the available live
  data."` (see Section 5 for what produces this string).
- The response's `events` array contained a `{"type":"error","message":
  "GatherBite could not complete planning."}` entry — the public, no-detail
  error event, not a stack trace or internal error.

Separately, `GET /` returned `200` and `GET /api/gatherbite` returned `405`
(expected — that route only accepts `POST`), confirming the app itself is up
and routed correctly.

This was NOT re-run for this document. Do not present it as a repeated or
five-times-verified result — see Section 3.

## 3. The blocker — why Step 2's rehearsal did not happen

The plan's rehearsal criterion (five consecutive deployed runs producing a
genuine reject → adapt → approve sequence) **was not attempted and cannot
currently be performed.** This is a known, external, reproducible blocker,
not a code defect discovered late.

**Root cause (confirmed by direct reproduction, not re-run for this
document):** the Planner's live-catalog prompt, built in
`src/lib/agents/dominosPlanner.ts` (which serializes the full live Domino's
catalog — products, variants, toppings, deals — for the tool-calling loop),
requires approximately **41,516 tokens** per request. The connected Groq
account is on the **on-demand/free tier, capped at 8,000 TPM (tokens per
minute)**. Every live Planner call therefore fails with:

```
AI_APICallError: Request too large for model openai/gpt-oss-120b ...
tokens per minute (TPM): Limit 8000, Requested 41516
```

This is a **Groq account-tier limit, not a code defect** — the identical
request path works token-for-token below the cap, and basic model
connectivity and tool-free calls succeed. The failure is specific to the
size of the live-catalog payload the Planner must see to make a grounded
proposal.

**Explicit ruling in force for this deployment:**

- A Groq Dev Tier upgrade (which would raise the TPM cap) is currently
  unavailable due to Groq's own capacity constraints — checked, not assumed.
- The reviewed Planner/catalog-serialization architecture
  (`src/lib/agents/dominosPlanner.ts`, `serializeDominosObservationForPlanner`,
  and the rest of the Tasks 6/7 evidence pipeline) is **not modified** to
  route around this. That code is already reviewed and locked; changing it
  now would need its own fix-and-review cycle with no time left before the
  deadline.
- Therefore the five-consecutive-run rehearsal is **blocked**, not skipped
  by choice. It is documented here as exactly that, with no invented run
  data anywhere in this file.

**What this means for a judge hitting the live demo right now:** an ordinary
request will currently fail at the Planner step and land on the graceful
"No verified option yet" screen (Section 5) rather than ever reaching a
reject/adapt/approve sequence. It will not crash and will not show a stack
trace or an internal error. See
`docs/deployment/gatherbite-production-checklist.md` for how this is framed
as a known issue there too.

**A second, independent blocker: no candidate can ever reach APPROVE, even
with unlimited Groq capacity.** The Groq TPM cap above is not the only
reason the rehearsal cannot complete — raising it would surface a second,
structural blocker immediately. In production, every planning-path
verification builds `priceEvidence` hardcoded to `status: "UNKNOWN"`
(`src/lib/gatherbite/agentLoop.ts`, lines 87-97: "Candidate expectedPricing
is a proposal, never evidence. Task 9 has no official candidate-bound quote
source, so budget must remain UNKNOWN."). `resolveDominosPriceEvidence`
(`src/lib/restaurants/dominosServiceability.ts`) is the only function in this
codebase that can ever produce `status: "KNOWN"`, and it is never called from
any production code path — it is referenced only from
`src/lib/restaurants/dominosServiceability.test.ts`. Because price evidence
is always `UNKNOWN`, `checkBudget` (`src/lib/restaurants/dominosEvidence.ts`)
always returns the `ALL_IN_TOTAL_UNKNOWN` finding, and because budget is a
hard constraint, `verifierGuard.ts`'s APPROVE gate — which requires every
check in the evidence bundle to be `PASS` (line 108: `if
(Object.values(evidence.checks).some((check) => check.status !== "PASS"))`)
— can never pass. This is not a bug: it is the honest, deliberate consequence
of Task 2's finding that no proven candidate-bound official Domino's quote
mechanism exists. But it means the TPM cap is not "the" blocker — it is one
of two independent blockers, and resolving only the TPM cap would not, by
itself, produce a working reject → adapt → approve sequence.

## 4. What the rehearsal would look like if both blockers were resolved (expected, not yet observed)

The following is the exact shape the five-run rehearsal is designed to
produce, built from the real types in `src/lib/gatherbite/contracts.ts` and
the real output format of `scripts/check-gatherbite-live.ts`. **No run below
has actually happened.** This section exists so the mechanism can be
verified by reading real code paths, and so a future session can recognize
success once **both** blockers from Section 3 are lifted: the Groq TPM
constraint (higher tier, or a trimmed catalog payload) **and** a proven
candidate-bound official Domino's price-quote mechanism wired into
production evidence collection (today, only the Groq TPM cap has any
prospect of being "unblocked" — the missing quote source has no known path
to resolution and would need its own design and review cycle).

A successful run's public event stream (`PublicGatherBiteEvent[]`, exactly
as defined in `contracts.ts`) would look like:

```json
{"type":"stage","stage":"observing","message":"..."}
{"type":"stage","stage":"planning","message":"..."}
{"type":"candidate","candidateId":"c1","summary":"..."}
{"type":"stage","stage":"verifying","message":"..."}
{"type":"decision","candidateId":"c1","decision":"REJECT","reason":"..."}
{"type":"stage","stage":"adapting","message":"Adapting from exact rejection evidence."}
{"type":"candidate","candidateId":"c1","summary":"..."}
{"type":"decision","candidateId":"c1","decision":"APPROVE","reason":"..."}
{"type":"stage","stage":"comparing","message":"..."}
{"type":"complete","result":{ "...": "GatherBiteEvaluation" }}
```

And `scripts/check-gatherbite-live.ts`'s summary of that same run would
print:

```
status: 200
Server-Timing: dom_10950_profile;dur=..., dom_10950_menu;dur=..., dom_10953_profile;dur=..., dom_10953_menu;dur=..., dominos;dur=..., observation;dur=..., planner;dur=..., verifier;dur=..., ...
total duration: <ms>
option count: 1
decision sequence: [{"candidateId":"c1","decision":"REJECT"},{"candidateId":"c1","decision":"APPROVE"}]
```

The rejection would be evidence a Planner cannot see in advance — favor
non-obvious live facts such as curated topping dietary evidence, a
protected-slice shortage, a live configuration price, or delivery
serviceability, per the plan's Step 1 guidance — never an instruction that
forces a bad candidate. The Planner may submit at most two initial
candidates and at most one adapted candidate (`adaptationUsed` in
`dominosPlanner.ts`), so the sequence above (one candidate id, one REJECT,
one APPROVE) is the maximum-length real trajectory, not an arbitrary
example.

**To re-attempt this rehearsal in a future session:** both Section 3 blockers
must be resolved first, not just one. (1) Raise the Groq account's TPM cap
(via a real Dev Tier upgrade or a proven lower-token catalog serialization
change reviewed on its own), **and** (2) wire a proven candidate-bound
official Domino's price-quote mechanism into production evidence collection
so `checkBudget` can return something other than `ALL_IN_TOTAL_UNKNOWN` (this
requires design and review work beyond this deployment — there is no
existing production code path that produces `KNOWN` price evidence today).
Only after both are true, run
`npm run test:live -- --url=https://gatherbite-hackathon-final.vercel.app`
five consecutive times against the deployed app and record each run's actual
`decision sequence` output here, replacing this section with real data.

## 5. The no-viable-request fallback

When no candidate is approved, `GatherBiteEvaluation.recommended` is `null`
and `noViableReason` is populated (`src/lib/gatherbite/normalize.ts`):

- If the most recent journey was a hard `REJECT`, `noViableReason` is that
  rejection's first reason string.
- If the most recent journey ended in a verifier system error,
  `noViableReason` is `"Verification could not complete safely for the
  available Domino's option."`
- Otherwise (including the empty-journeys case observed in Section 2 — the
  Planner never produced a candidate at all), `noViableReason` is
  `"GatherBite could not verify a Domino's option from the available live
  data."`

The UI (`src/components/GatherBiteResults.tsx`, the `NoViableResult`
component) renders this as a calm, dedicated card — not an error page:

> **No verified option yet**
> GatherBite stopped instead of guessing: *{noViableReason}*

followed by a "Safe adjustments to try" list (raise the budget, try
Carryout/Either, try again later, dietary needs are never weakened
automatically). This is exactly what a judge sees right now on the deployed
app for the example request in Section 1, because of the two blockers in
Section 3 (the Groq TPM cap, and the always-`UNKNOWN` production price
evidence).

## 6. Cart mode currently in effect

Cart mode is locked to **`guided-handoff`** for this deployment. Per the
Task 15 ruling (`.superpowers/sdd/2026-08-14-gatherbite-hackathon-final/progress.md`):

> Task 15: Ruling: cart mode is locked to `guided-handoff` per Task 2's
> evidence (`docs/research/2026-08-14-dominos-cart-feasibility.md`: "Selected
> mode: guided-handoff... Exact official cart creation, secure session
> takeover, and useful deep-link state were not reproduced"). The executor
> factory keeps the plan's full `mode` union and `BrowserDriver`/
> browser-specialist interfaces so the type contract matches the plan, but
> only `guided-handoff` gets real behavior; `supported-deep-link` and
> `transferable-browser` are not exercised (no proof exists to back them).

In practice this means `createDominosCartExecutor` (`src/lib/cart/dominosCartExecutor.ts`)
always returns `{ status: "FALLBACK_READY", fallback: buildGuidedHandoff(candidate), actualCart: null, comparison: null, handoffUrl: null }`
with zero browser/network interaction. `"transferable-browser"`'s full bounded
state machine exists and is unit-tested against a fake in-memory driver, but
is dormant — never invoked against a real browser session in production, and
not claimed to be.

When an organizer clicks "Prepare my Domino's cart" on an approved option,
they see the guided fallback: exact store, service method, deals, pizza
quantities/configurations, per-line and whole-order copy controls, verified
price evidence, and a primary **"Open Domino's with my order guide"** action
(`src/components/CartPreparation.tsx`). The copy underneath reads "Review the
official cart and complete payment yourself." GatherBite never claims
"Cart prepared" language for guided-handoff — that phrasing is reserved for
the (currently dormant) `PREPARED_AND_OBSERVED`/`PREPARED_AND_VERIFIED`
states, which require a real transferable browser session this deployment
does not use.

## 7. Public-data and dietary trust wording (verbatim, from the UI)

Main page header (`src/app/page.tsx`):

> Tell us what your group needs. GatherBite checks live public restaurant
> data and independently verifies the hard constraints before you decide.

Main page footer:

> Live public data can change. GatherBite does not claim a restaurant
> partnership or medical allergy safety, and never completes payment for you.

Dietary section subhead (`src/components/GroupRequirementsForm.tsx`):

> Add only what applies. Each need is verified independently from trusted
> evidence.

These three lines are the entirety of GatherBite's dietary/data-trust claim
in the shipped UI. No stronger language (e.g. "certified," "guaranteed
allergen-free," "official partner") exists anywhere in the app.

## 8. The payment/submission stop

Final review copy (`src/components/DecisionReview.tsx`):

> You review the official cart and complete payment. GatherBite never
> submits or pays for an order.

And on the cart-preparation screen (`src/components/CartPreparation.tsx`):

> Review the official cart and complete payment yourself.

No code path in this repository enters payment details or submits an order.
The guided-handoff fallback (Section 6) is the only cart-preparation path
this deployment exercises, and it stops at "open Domino's with my order
guide" — the organizer does everything from there on Domino's own site.

## Rubric Self-Check

Short, direct answers to the questions judges are likely to ask.

**Agent need (why two agents, not one).** A single model both proposing and
approving its own order can rationalize past a hard constraint (dietary,
budget, capacity) under pressure to "find something." Splitting Planner and
Verification Agent into two separate model invocations means the Planner's
own prose has no approval authority — only a fresh call to a genuinely
separate Verification Agent, working from typed evidence, can return
`APPROVE`/`REJECT` (`src/lib/agents/dominosPlanner.ts`,
`src/lib/agents/dominosVerifier.ts`). This is the same principle a two-person
approval process uses for any consequential decision.

**Solver boundary (deterministic code vs. model judgment).** All hard facts
and arithmetic — dietary evidence lookup, slice-capacity counting, budget
totals, availability, serviceability — are computed by exact, independently
tested TypeScript functions fanned out from `gatherCandidateEvidence`
(`src/lib/gatherbite/orchestrator.ts` and the evidence modules it calls). The
Verification Agent's only job is to read that typed evidence and decide
`APPROVE`/`REJECT`; it never performs arithmetic or infers an ingredient
fact itself. A fail-closed protocol guard (`verifierGuard`) can veto an
internally inconsistent approval, but it can never manufacture one.

**Public endpoint risk.** There is currently no rate limiting or abuse
protection on `/api/gatherbite`, `/api/gatherbite/stream`, or
`/api/gatherbite/cart/prepare` (confirmed by inspection — no
rate-limit/throttle code exists anywhere in `src/`). This is a real gap: an
unauthenticated caller could drive Groq token spend by hammering these
routes. It is acceptable for a time-boxed hackathon deployment but would need
addressing (e.g. Vercel Firewall rate limiting, per-IP throttling) before any
real usage.

**Dietary trust (why fail-closed).** Only the `SAFE` evidence state satisfies
a restriction. `CONTAINS`, `MAY_CONTAIN`, `UNKNOWN`, an unrecognized
component, or missing component data all fail the check. Getting an
allergen/restriction wrong is a real-world harm a "best guess" architecture
cannot justify; failing closed means an unproven case blocks the order
instead of silently passing it.

**No-viable behavior (what a judge sees).** Never a crash, stack trace, or
blank state. `recommended: null` renders the dedicated "No verified option
yet" card with the exact `noViableReason` string and a concrete "safe
adjustments" list (Section 5). This is what the live deployment currently
shows for the example request, because of the two independent blockers in
Section 3 (the Groq TPM cap, and the always-`UNKNOWN` production price
evidence — either alone would be enough to prevent an APPROVE).

**Bounded retries (Planner's adaptation limit).** The Planner may propose at
most two initial version-1 candidates and, only after a structured REJECT
with `disposition: "ADAPT_ORDER"`, exactly one adapted higher-version
candidate (`adaptationUsed` boolean in `dominosPlanner.ts`; enforced again by
`stepCountIs(12)` as an outer tool-loop cap). There is no blind retry loop.

**Cart truth (never claims a prepared cart that wasn't).** The guided-handoff
executor never returns `PREPARED_AND_OBSERVED` or `PREPARED_AND_VERIFIED` —
those states are reserved for a real, proven transferable browser session,
which this deployment does not have (Section 6). Even the dormant
`transferable-browser` state machine only reports success after comparing
the actual observed cart against the approved manifest and obtaining a real
`handoffUrl()`; a structural mismatch is `CART_MISMATCH`, never a silent
pass.

**Payment boundary.** No code path enters payment details or submits an
order (Section 8). The organizer completes checkout on Domino's own site.

**Provider extensibility (why Domino's-only for now).** Domino's is the only
provider with live public store, menu, deal, price, availability, and wait
data this project has integrated and evidence-tested. Little Caesars remains
intact in the repository (`src/lib/agent.ts` and related files) as
provider-extensibility evidence and a working fallback engine, but the
normal GatherBite journey does not spend its model latency — it is not part
of the Domino's-first main route.

**Framework choice.** Next.js App Router on Vercel with the Vercel AI SDK's
`ToolLoopAgent` over Groq (`openai/gpt-oss-120b`) was chosen for a
production-shaped, deployable, live tool-calling agent with minimal new
infrastructure. The isolated Eve spike under `/agent` (`agent/`,
`package.json`'s `eve:*`/`test:eve-spike` scripts) explored an alternative
durable-agent runtime as a proof-of-concept only; it was never wired into the
production route and is not a release dependency — kept isolated
specifically so evaluating it never risked the shipped Next.js path.
