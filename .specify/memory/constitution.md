<!--
SYNC IMPACT REPORT (temporary scratch — remove before committing the amended constitution)

Version change: none → 1.0.0
Bump rationale: Initial ratification. No prior constitution existed; the file was the unmodified
scaffold with all placeholder tokens intact. First concrete adoption is 1.0.0, not a MAJOR bump
from a previous version.

Modified principles: none (no prior principles existed)

Added sections:
  - Core Principles I–VII (all new)
  - Technology and Safety Constraints (SECTION_2)
  - Development Workflow and Quality Gates (SECTION_3)
  - Governance

Removed sections: none

Placeholder resolution:
  - PROJECT_NAME                → GatherBite
  - PRINCIPLE_1..5_NAME/_DESC   → Principles I–V; template extended to VII to cover all six
                                  non-negotiables supplied in the product brief plus the testing bar
  - SECTION_2_NAME/_CONTENT     → Technology and Safety Constraints
  - SECTION_3_NAME/_CONTENT     → Development Workflow and Quality Gates
  - GOVERNANCE_RULES            → Governance section body
  - GUIDANCE_FILE               → AGENTS.md (exists at repository root)
  - CONSTITUTION_VERSION        → 1.0.0
  - RATIFICATION_DATE           → 2026-10-12 (adoption date of this document; the principles it
                                  encodes have governed the code since the 2026-08-14 initial commit,
                                  but were previously undocumented)
  - LAST_AMENDED_DATE           → 2026-10-12

Follow-up TODOs / deferred items:
  - TODO(COVERAGE_TOOLING): Principle VII sets a >90% unit coverage floor. The repository currently
    runs `tsx` + `node:test` with no coverage instrumentation (no c8/nyc/vitest coverage), so the
    floor is unmeasurable today. Either add instrumentation or amend the principle.
  - TODO(STACK_DELTA): The Technology and Safety Constraints section records the brief's target
    stack (React Native/Expo, tRPC, Prisma, PostgreSQL, Clerk, Stripe). None of it exists yet —
    the repository is a Next.js 16 web app whose restaurant data comes from fixtures. The section
    is written as a forward-looking target and marks what is live vs. not. Revisit on each phase.
  - TODO(DETOX_SCOPE): Principle VII's Detox E2E requirement is inert until an Expo app exists.
-->

# GatherBite Constitution

## Core Principles

### I. Proposal and Approval Are Never the Same Component (NON-NEGOTIABLE)

The component that proposes an order MUST NOT be the component that approves it. A planner's output
is a *candidate*, never a decision.

The verifier MUST receive a candidate evidence bundle rather than the planner's reasoning, prose, or
confidence claims, so that it cannot inherit the planner's assumptions. Any code path that lets a
proposing component mark its own output approved — directly, or by passing a `verified: true` flag
downstream — is a violation regardless of test results.

This extends past the first approval: an executor that reports its own result as verified MUST be
re-checked by an independent comparator against the approved candidate.

**Rationale**: An LLM is good at proposing an order that satisfies a constraint set and untrustworthy
at confirming one. It will assure you the vegetarians are covered when they are not. Separating the
two roles is the only structural defense against that failure mode.

### II. The Final Gate Is Deterministic Code (NON-NEGOTIABLE)

The last check before anything reaches a cart, a payment, or a user as an approval MUST be plain
TypeScript containing no model judgment: arithmetic, lookups, and schema validation against trusted
data.

Model output MUST be constrained at the boundary by a schema that admits only decision shapes the
system can act on. A malformed, hedged, or creative response MUST be rejected by the schema, never
parsed for intent or salvaged by a second prompt.

LLM verification is a *filter in front of* the deterministic gate, never a substitute for it. No
feature may ship whose correctness rests on a model agreeing with itself.

**Rationale**: Determinism is what makes a guarantee a guarantee. Slice counts, dietary coverage,
budget totals, and item existence are decidable by computation; delegating them to a model converts a
provable property into a probable one.

### III. Fail Closed (NON-NEGOTIABLE)

Unknown is not a pass. When evidence is insufficient, the result MUST be `REJECTED` or
`insufficient-data`, and that state MUST NOT be upgraded into an approval anywhere downstream.

Specifically:

- Missing or unreadable data MUST stay `null`. It MUST NOT be defaulted to `0`, `""`, `true`, or an
  empty collection in order to let a check proceed.
- Unproven dietary compatibility MUST NOT reach a fully-viable verdict.
- A timeout, abort, network failure, or parse failure is a rejection, not a retry-until-approved.
- Degraded paths MUST reduce what the system *claims*, never what it *checks*.

**Rationale**: The expensive failure is not "GatherBite could not decide" — a user can act on that.
It is a confident approval built on data nobody had.

### IV. Allergen and Ingredient Claims Require Evidence (NON-NEGOTIABLE)

The system MUST NOT assume ingredients and MUST NOT infer allergens without evidence.

A dietary or allergen conclusion MUST trace to retrieved menu or ingredient data, with its source
recorded. Inference from an item's name, cuisine, category, price, or visual similarity to another
item is NOT evidence. Model world-knowledge about what a dish "usually" contains is NOT evidence.

Where ingredient data is partial, the system MUST surface the gap as a gap — missing-ingredient
detection and confidence scoring MUST be explicit outputs, not hidden inside a pass/fail boolean. A
confidence score below the configured threshold MUST hard-block via the verifier.

**Rationale**: "Pesto is usually vegetarian" is how someone with a pine-nut allergy gets hurt. The
only safe source for an ingredient fact is the ingredient data.

### V. Every Agent Action Is Auditable

Each agent run MUST persist its inputs, outputs, the evidence it was given, and the decision it
reached, in a form that lets a human reconstruct *why* a specific order was approved or rejected
after the fact.

Audit records MUST be written for rejections and failures, not just successes, and MUST NOT be the
same mutable record the agent reads from. Verification results MUST be stored as first-class data
alongside the order they govern.

**Rationale**: A safety claim you cannot reconstruct is a safety claim you cannot defend — to a user
who got the wrong food, or to anyone reviewing the system.

### VI. Allergy Safety Outranks Every Other Constraint

When constraints conflict, the resolution order is fixed and MUST NOT be reordered by configuration,
prompt, or user request:

1. Allergy and dietary safety
2. Order integrity (item existence, quantity and serving math, cart matches what was approved)
3. Budget
4. Preferences, cuisine, variety, and optimization

A cheaper, faster, or better-liked order that weakens an allergy guarantee MUST be rejected. Budget
pressure MUST NOT relax a dietary check; the correct output is "this cannot be done within budget,"
never a quiet downgrade.

**Rationale**: Every other constraint in this product is about satisfaction. This one is about harm.
They are not tradeable against each other, so the code must not offer the trade.

### VII. Tests Prove Invariants (NON-NEGOTIABLE)

Tests MUST assert the behavior the principles promise, not merely execute the lines that implement
it. A suite that reaches its coverage number without proving that unknown data cannot become a pass
has not met this principle.

Required bars:

- **Unit tests**: >90% coverage. See TODO(COVERAGE_TOOLING) — instrumentation does not exist yet, so
  this is currently unenforceable and MUST be made measurable before it is claimed as met.
- **Integration tests**: every critical workflow — session creation, preference collection, planning,
  verification, approval, checkout.
- **E2E tests**: Detox, once a React Native app exists. Inert until then.
- **AI verification tests**: allergy edge cases, budget edge cases, and menu-mutation scenarios
  (a menu that changes between planning and checkout) are mandatory categories, not optional extras.
- The deterministic suite MUST run with no API key and no network access.

**Rationale**: These invariants are only real if a failing test appears when they break. Fixture-based
determinism is what lets the whole verification pipeline be checked before any model provider is
configured.

## Technology and Safety Constraints

**Currently live** (verify against the repository before planning, not against this list):
Next.js 16 App Router, React 19, TypeScript 5, Tailwind CSS 4, Vercel AI SDK v7 (`ToolLoopAgent`),
Zod 4 for boundary schemas, Groq (`openai/gpt-oss-120b`) as default model provider with OpenRouter
supported, `tsx` + `node:test`, ESLint 9. Restaurant and menu data comes from fixtures.

**Target stack** (from the product brief; mostly not yet built — see TODO(STACK_DELTA)):

| Layer | Choice |
| --- | --- |
| Mobile | React Native, Expo, TypeScript |
| Backend | Next.js API, tRPC |
| Data | PostgreSQL, Prisma |
| Auth | Clerk |
| Realtime | LiveKit or Supabase Realtime |
| Payments | Stripe |
| Notifications | OneSignal |
| Maps | Google Maps |
| Analytics | PostHog |
| Observability | OpenTelemetry, Sentry |
| Infrastructure | Vercel, Supabase, Cloudflare |

Deviating from the target stack for a given phase is permitted but MUST be recorded in that phase's
plan with its reasoning. Silent substitution is not.

**Security requirements.** The following are constraints on every phase that touches user data,
money, or agent execution: RBAC, audit logging, encryption at rest and in transit, managed secrets
(never committed — `.env.local` stays gitignored), signed webhooks, rate limiting, abuse prevention,
and fraud detection. Row-level security MUST be part of the schema design, not retrofitted.

**Agent execution constraints.** Model work MUST stop at deterministic boundaries only — a verified
candidate, a provably impossible request, or an explicit attempt ceiling. "Keep trying until it
approves" is forbidden; an unbounded or approval-seeking retry loop violates Principles I and III
together. A hung model call MUST be aborted, not awaited.

## Development Workflow and Quality Gates

**Spec-driven flow.** Material work moves through Spec Kit: `/speckit-specify` →
(`/speckit-clarify`) → `/speckit-plan` → `/speckit-tasks` → (`/speckit-analyze`) →
`/speckit-implement`. A phase plan MUST state which principles it touches and how it satisfies them.

**Gates before merge:**

1. `npm test` passes — the full chain, no skipped suites.
2. `npm run lint` and `npm run build` pass.
3. Any change to the planner/verifier split, the deterministic gate, fail-closed handling, or
   allergen evidence handling carries a test that fails without the change.
4. New or changed agent behavior is covered by `npm run eval:verifier` where applicable.

**Review expectations.** A reviewer MUST be able to answer, for any change touching the order path:
what proposes, what approves, what the final deterministic check is, and what happens when the data
is missing. If the diff makes that hard to answer, the diff is the problem.

**Scope discipline.** Prototype shortcuts are not acceptable in the order path — planning,
verification, and checkout are production surfaces from day one. Shortcuts elsewhere MUST be marked
in-code and surfaced in the phase's plan rather than left to be discovered.

## Governance

This constitution supersedes other practices, conventions, and preferences in this repository. Where
a style guide, a prior commit, or an agent instruction conflicts with a principle here, the principle
wins.

**Amendment procedure.** Amendments MUST be proposed as a change to this file, stating the principle
affected, the reason, and the migration path for code that the amendment makes non-compliant. A
principle marked NON-NEGOTIABLE MAY be amended, but weakening or removing one is a MAJOR version
change and MUST document what replaces the guarantee it provided.

**Versioning policy.** Semantic versioning:

- **MAJOR** — a principle is removed or redefined in a backward-incompatible way.
- **MINOR** — a principle or section is added, or guidance is materially expanded.
- **PATCH** — clarification, wording, or non-semantic refinement.

**Compliance review.** Every PR and review MUST verify compliance with the principles the change
touches. Added complexity MUST be justified in the phase plan. Unresolved `TODO(...)` items in this
file are open governance debt and MUST be re-examined at each milestone rather than aging silently.

Runtime development guidance for agents working in this repository lives in `AGENTS.md`.

**Version**: 1.0.0 | **Ratified**: 2026-10-12 | **Last Amended**: 2026-10-12
