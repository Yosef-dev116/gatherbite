# GatherBite Final Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a production-quality Domino’s-first GatherBite flow in which a Planner Agent proposes real orders, a separate Verification Agent approves or rejects them using exact evidence tools, rejected candidates are adapted, verified options remain human-selectable, and the selected order reaches a legitimate prepared cart or the strongest exact-order fallback.

**Architecture:** Keep the current Vercel AI SDK `ToolLoopAgent` and Groq production stack. Add immutable request-scoped Domino’s observations, structured candidates, verifier-as-tool delegation, parallel exact evidence, approved-only ranking, and a separately bounded cart-execution phase. Preserve the Little Caesars engine and isolated Eve spike, but remove both from the normal main-page path.

**Tech Stack:** Next.js 16.3.1 App Router and Route Handlers, React 19.2.8, TypeScript 5 strict mode, Vercel AI SDK 7.0.65, `@ai-sdk/groq` 4.0.28, Zod 4.4.3, Node 24, native `fetch`/`ReadableStream`, Tailwind CSS 4, existing `tsx` test runner.

This is one master execution plan with four sequential phase gates because the candidate, evidence, agent, presentation, and cart contracts are shared across the phases. The phase boundaries preserve the approved sub-project decomposition without allowing incompatible parallel designs.

## Global Constraints

- The approved design at `docs/superpowers/specs/2026-08-14-gatherbite-hackathon-final-design.md` is authoritative.
- Do not reset to `6564ea2`; preserve the current working implementation.
- Obtain explicit user approval before the baseline checkpoint commit and later commits.
- Use `superpowers:using-git-worktrees` before implementation after the checkpoint exists.
- Read relevant installed Next.js 16 docs before Route Handler or streaming edits. Use Node.js runtime; Edge runtime is deprecated.
- Keep production on Vercel AI SDK. Do not import or migrate the Eve spike under `/agent`.
- Domino’s is the only normal final provider. Keep Little Caesars code/tests intact and out of the normal request path.
- Only the separate Verification Agent may return `APPROVE` or `REJECT`.
- Exact facts and arithmetic come from tools. The protocol guard may veto, but never create, approval.
- Only `SAFE` dietary evidence passes. `CONTAINS`, `MAY_CONTAIN`, and `UNKNOWN` fail closed.
- Pizza is the only trusted capacity model, at three slices per attendee.
- Never infer unrestricted attendees as `attendees - sum(dietary group counts)`.
- Preferences are optional and soft: Cheese, Pepperoni, Veggie, Meat lovers. They never alter dietary-protected pizza.
- Delivery and Either collect the minimum proven address fields; Carryout does not. Either is the default.
- Budget, dietary, capacity, availability, serviceability, and menu integrity are hard constraints.
- Do not claim partnership, medical safety, a known wait/price that is unknown, or a prepared cart that was not prepared.
- Never automate payment/submission or bypass CAPTCHA, authentication, origin protections, or anti-bot controls.
- No new provider, database, auth, notification, arbitrary meal-capacity work, or unrelated refactor.
- Add no dependency unless cart evidence proves it necessary and the user approves the dependency diff.
- Do not log addresses, credentials, cookies, browser tokens, full prompts, or private reasoning.
- Use red-green-refactor. Each task ends with an independently reviewable checkpoint.
- Network-dependent checks stay outside deterministic `npm test`.

## Locked File Structure

| Path | Responsibility |
|---|---|
| `src/lib/gatherbite/contracts.ts` | Final input, candidate, evidence, verdict, result, and event schemas/types |
| `src/lib/gatherbite/events.ts` | Privacy-safe event sink and NDJSON encoder/parser |
| `src/lib/gatherbite/timing.ts` | Stage timing and `Server-Timing` serialization |
| `src/lib/gatherbite/ranking.ts` | Approved-only recommendation and alternatives |
| `src/lib/gatherbite/normalize.ts` | Domino’s-first presentation model |
| `src/lib/gatherbite/orchestrator.ts` | Request-scoped observation, Planner loop, retries, and result assembly |
| `src/lib/agents/dominosPlanner.ts` | Top-level Planner Agent |
| `src/lib/agents/dominosVerifier.ts` | Separate Verification Agent invocation |
| `src/lib/agents/verifierGuard.ts` | Fail-closed decision consistency guard |
| `src/lib/restaurants/dominos.ts` | Live profile/menu adapter |
| `src/lib/restaurants/dominosCatalog.ts` | Configurable product/deal/topping index |
| `src/lib/restaurants/dominosServiceability.ts` | Official address/store evidence |
| `src/lib/restaurants/dominosPreferences.ts` | Soft intent to live configuration |
| `src/lib/restaurants/dominosCapacity.ts` | Trusted capacity and protected-slice allocation |
| `src/lib/restaurants/dominosEvidence.ts` | Parallel exact hard-check collection |
| `src/lib/pricing/peiTax.ts` | Versioned official PEI tax evidence where a quote omits tax |
| `src/lib/cart/*` | Cart contracts, comparison, guard, fallback, executor, and optional browser agent |
| `src/app/api/gatherbite/route.ts` | JSON evaluation endpoint |
| `src/app/api/gatherbite/stream/route.ts` | NDJSON evaluation event stream |
| `src/app/api/gatherbite/cart/prepare/route.ts` | Revalidation, cart preparation, and actual-cart verification |
| `src/components/GroupRequirementsForm.tsx` | Minimal progressive organizer input |
| `src/components/EvaluationProgress.tsx` | Real lifecycle stages |
| `src/components/VerificationJourney.tsx` | Candidate rejection/adaptation trail |
| `src/components/VerifiedOptions.tsx` | Recommendation and alternatives |
| `src/components/DecisionReview.tsx` | Human selection and exact review |
| `src/components/CartPreparation.tsx` | Cart progress, handoff, blockers, and fallback |

Keep `src/lib/gatherbite.ts` as a compatibility boundary until existing tests/debug pages no longer depend on its current exports.

---

## Phase 0 — Preserve the Baseline and Resolve Live Cart Facts

### Task 1: Create the recoverable checkpoint and isolated worktree

**Files:**
- Modify only if absent: `.gitignore`
- Inspect: every path from `git status --short`
- Verify: existing repository scripts

**Interfaces:**
- Consumes: current known-working dirty tree.
- Produces: `checkpoint/gatherbite-unified-baseline` and isolated `feature/gatherbite-hackathon-final` worktree.

- [ ] **Step 1: Audit without changing state**

Run:

```powershell
git status --short
git diff --stat
git diff --check
rg -n --hidden --glob '!node_modules/**' --glob '!.git/**' --glob '!.next/**' --glob '!.output/**' "(api[_-]?key|secret|token|cookie|authorization).{0,20}[:=]" .
```

Expected: intended source/config only; no environment files, browser state, or credentials.

- [ ] **Step 2: Ignore local worktrees if needed**

Add exactly when absent:

```gitignore
# isolated Superpowers worktrees
/.worktrees/
```

- [ ] **Step 3: Re-run the baseline**

```powershell
npx tsc --noEmit
npm run test
npm run lint
npm run build
git diff --check
```

Expected: all existing suites pass, including the previously verified 297 production checks.

- [ ] **Step 4: Present audit and diff to the user**

Do not commit until the user explicitly approves checkpoint contents.

- [ ] **Step 5: Create the approved checkpoint**

```powershell
git switch -c checkpoint/gatherbite-unified-baseline
git add --all
git commit -m "chore: checkpoint unified GatherBite baseline"
```

- [ ] **Step 6: Create the feature worktree**

Invoke `superpowers:using-git-worktrees`, then create branch `feature/gatherbite-hackathon-final` from the checkpoint at the skill-selected safe path.

- [ ] **Step 7: Verify the clean worktree**

Run the five commands from Step 3 inside it. Expected: exit 0 and clean status.

### Task 2: Perform bounded Domino’s cart, quote, and serviceability research

**Files:**
- Create: `docs/research/2026-08-14-dominos-cart-feasibility.md`
- Create: `src/lib/restaurants/fixtures/dominos-configurable-menu.fixture.ts`
- Create: `src/lib/cart/fixtures/dominos-cart.fixture.ts`

**Interfaces:**
- Consumes: official public Domino’s guest ordering flow and a public/non-sensitive PEI test address.
- Produces: one execution-mode decision plus token-free menu/cart fixtures and proven serviceability/pricing facts.

- [ ] **Step 1: Create the report with this fixed matrix**

```markdown
# Domino’s Cart Feasibility — 2026-08-14

## Safety boundary
- Guest flow only
- No payment/submission
- No CAPTCHA/auth/access-control bypass
- No session secrets recorded

## Capabilities
| Capability | Result | Evidence | Deployed consequence |
|---|---|---|---|
| Address serviceability | UNKNOWN | Not tested | Delivery cannot pass |
| Store/service selection | UNKNOWN | Not tested | No execution claim |
| Configurable identifiers | UNKNOWN | Not tested | No executable candidate |
| Quote with tax/fees | UNKNOWN | Not tested | Budget cannot pass |
| Cart creation | UNKNOWN | Not tested | Guided fallback |
| Session transfer | UNKNOWN | Not tested | Preparation not claimable |
| Supported deep link | UNKNOWN | Not tested | Official root only |

## Selected mode
Decision: guided-handoff
Reason: Default until a stronger mode is proven.
```

- [ ] **Step 2: Exercise the official flow from a deployed-equivalent runtime**

Before using any HireFlow-configured browser service, confirm the plaintext credentials surfaced during design inspection have been rotated. Configure replacement credentials only as server/local environment variables; do not copy HireFlow’s MCP file or values into this repository.

In a fresh guest session, test Delivery and Carryout, address submission, store selection, one current pizza deal, one exact configurable pizza, cart inspection, and navigation persistence. Capture a fresh page/accessibility snapshot after every action. Stop before checkout/payment.

- [ ] **Step 3: Test transfer without cookie injection**

Determine whether a remote/server-created guest cart opens in a separate organizer browser through an official continuation URL or supported token. Mark success only when the exact official cart transfers without exporting/injecting cookies.

- [ ] **Step 4: Test official deep-link parameters**

Record which store, postal, service-method, and coupon state actually persists. Opening the locator is not cart preparation.

- [ ] **Step 5: Select exactly one mode**

```text
transferable-browser = exact official cart plus secure takeover proven
supported-deep-link  = no transferable cart, but useful official state persists
guided-handoff       = neither stronger mode is reliable
```

Guided fallback is implemented regardless of the selected stronger mode.

- [ ] **Step 6: Create minimal sanitized fixtures**

Export only the real-shaped fields required for one configurable pizza, variant, crust, sauce, cheese, topping set, deal, trusted slices, and matching cart totals. Include `sourceObservedAt` and `storeId`. Exclude addresses, cookies, headers, and tokens.

- [ ] **Step 7: Verify and review the decision**

```powershell
npx tsc --noEmit
git diff --check -- docs/research src/lib/restaurants/fixtures src/lib/cart/fixtures
```

Review the selected mode with the user before mode-specific cart code.

- [ ] **Step 8: Commit after approval**

```powershell
git add docs/research/2026-08-14-dominos-cart-feasibility.md src/lib/restaurants/fixtures/dominos-configurable-menu.fixture.ts src/lib/cart/fixtures/dominos-cart.fixture.ts
git commit -m "docs: record Domino's cart feasibility"
```

---

## Phase 1 — Contracts, Evidence, and Separate Agents

### Task 3: Add final GatherBite schemas and remove overlap assumptions

**Files:**
- Create: `src/lib/gatherbite/contracts.ts`
- Create: `src/lib/gatherbite/contracts.test.ts`
- Create: `src/lib/gatherbite-final.test.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/scoring.ts`
- Modify: `src/lib/scoring.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing restriction/group/preference types.
- Produces: `GatherBiteInputSchema`, candidate/evidence/verdict/result schemas, and new-test aggregator.

- [ ] **Step 1: Write failing input tests**

```ts
test("Carryout needs no address", () => {
  assert.equal(GatherBiteInputSchema.safeParse({
    attendees: 18, budgetCad: 120, serviceMethod: "carryout", groups: [], pizzaPreferences: [],
  }).success, true);
});

test("Either requires address", () => {
  assert.equal(GatherBiteInputSchema.safeParse({
    attendees: 18, budgetCad: 120, groups: [], pizzaPreferences: [],
  }).success, false);
});

test("dietary groups may overlap", () => {
  assert.equal(GatherBiteInputSchema.safeParse({
    attendees: 4, budgetCad: 100, serviceMethod: "carryout",
    groups: [
      { id: "a", people: 4, restrictions: ["vegetarian"] },
      { id: "b", people: 4, restrictions: ["noPork"] },
    ], pizzaPreferences: ["pepperoni"],
  }).success, true);
});
```

- [ ] **Step 2: Confirm failure**

Run this command: `npx tsx --test src/lib/gatherbite/contracts.test.ts`.
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement input schemas**

```ts
export const ServiceMethodSchema = z.enum(["delivery", "carryout", "either"]);

export const DeliveryAddressSchema = z.object({
  street: z.string().trim().min(3).max(120),
  unit: z.string().trim().max(30).optional(),
  city: z.string().trim().min(2).max(80),
  province: z.literal("PE"),
  postalCode: z.string().trim().toUpperCase().regex(/^[A-Z]\d[A-Z][ -]?\d[A-Z]\d$/),
});

export const DietaryGroupSchema = z.object({
  id: z.string().min(1),
  people: z.number().int().min(1).max(200),
  restrictions: z.array(z.enum(ALL_RESTRICTIONS as [Restriction, ...Restriction[]])).min(1),
  notes: z.string().trim().max(200).optional(),
});

export const DietaryGroupsSchema = z.array(DietaryGroupSchema).max(10);
export const PizzaPreferencesSchema = z.array(
  z.enum(ALL_PIZZA_PREFERENCES as [PizzaPreference, ...PizzaPreference[]]),
).max(ALL_PIZZA_PREFERENCES.length);

export const GatherBiteInputSchema = z.object({
  attendees: z.number().int().min(1).max(200),
  budgetCad: z.number().positive().max(5000),
  serviceMethod: ServiceMethodSchema.default("either"),
  deliveryAddress: DeliveryAddressSchema.optional(),
  groups: DietaryGroupsSchema,
  pizzaPreferences: PizzaPreferencesSchema.default([]),
}).superRefine((value, ctx) => {
  if (value.serviceMethod !== "carryout" && !value.deliveryAddress) {
    ctx.addIssue({ code: "custom", path: ["deliveryAddress"], message: "Delivery address is required for Delivery or Either." });
  }
});

export type DeliveryAddress = z.infer<typeof DeliveryAddressSchema>;
export type GatherBiteInput = z.infer<typeof GatherBiteInputSchema>;
```

Use these exact shared shapes and matching Zod schemas:

```ts
export type EvidenceStatus = "PASS" | "FAIL" | "UNKNOWN";
export interface EvidenceCheck<TFacts = unknown> {
  status: EvidenceStatus;
  code: string;
  summary: string;
  facts: TFacts;
  source: string;
}

export interface PreferenceEvidence {
  requested: PizzaPreference[];
  represented: PizzaPreference[];
  unmet: Array<{ preference: PizzaPreference; reason: string }>;
}

export interface CandidatePizza {
  lineId: string;
  quantity: number;
  productCode: string;
  variantCode: string;
  sizeCode: string;
  crustCode: string;
  sauceCode: string | null;
  cheeseCode: string | null;
  toppings: Array<{ code: string; quantity: number }>;
  purpose: "dietary-protected" | "general";
  protectsGroupIds: string[];
  trustedSlicesPerPizza: number;
}

export interface DominosCandidate {
  candidateId: string;
  candidateVersion: number;
  snapshotVersion: string;
  storeId: string;
  serviceMethod: "delivery" | "carryout";
  dealCodes: string[];
  pizzas: CandidatePizza[];
  expectedPricing: {
    subtotalCad: number | null;
    taxCad: number | null;
    feesCad: number | null;
    totalCad: number | null;
  };
}

export interface CandidateEvidenceBundle {
  candidateId: string;
  candidateVersion: number;
  snapshotVersion: string;
  checks: {
    menuIntegrity: EvidenceCheck;
    dietary: EvidenceCheck;
    capacity: EvidenceCheck;
    budget: EvidenceCheck;
    availability: EvidenceCheck;
    serviceability: EvidenceCheck;
  };
  preference: PreferenceEvidence;
  collectedAt: string;
}

export type VerificationDecision =
  | { candidateId: string; candidateVersion: number; snapshotVersion: string; decision: "APPROVE"; disposition: "NONE"; reasons: string[]; unknowns: [] }
  | { candidateId: string; candidateVersion: number; snapshotVersion: string; decision: "REJECT"; disposition: "ADAPT_ORDER" | "TRY_ANOTHER_STORE" | "TERMINAL"; reasons: string[]; unknowns: string[] };

export type VerificationOutcome =
  | { status: "DECIDED"; decision: VerificationDecision; evidence: CandidateEvidenceBundle }
  | { status: "VERIFIER_ERROR"; reason: string; evidence: CandidateEvidenceBundle | null };

export interface VerifiedDominosOption {
  candidate: DominosCandidate;
  decision: Extract<VerificationDecision, { decision: "APPROVE" }>;
  evidence: CandidateEvidenceBundle;
  relevantWaitMinutes: WaitMinutes | null;
  recommendationReason: string;
}

export interface CandidateJourney {
  candidate: DominosCandidate;
  outcome: VerificationOutcome;
  adaptedFromCandidateId: string | null;
}

export interface GatherBiteEvaluation {
  recommended: VerifiedDominosOption | null;
  alternatives: VerifiedDominosOption[];
  journeys: CandidateJourney[];
  events: PublicGatherBiteEvent[];
  noViableReason: string | null;
}

export type PublicGatherBiteEvent =
  | { type: "stage"; stage: "observing" | "planning" | "verifying" | "adapting" | "comparing"; message: string }
  | { type: "candidate"; candidateId: string; summary: string }
  | { type: "decision"; candidateId: string; decision: "APPROVE" | "REJECT"; reason: string }
  | { type: "complete"; result: GatherBiteEvaluation }
  | { type: "error"; message: string };
```

- [ ] **Step 4: Rename the label, not the storage key**

Set `PIZZA_PREFERENCE_LABELS.meatHeavy` to `"Meat lovers"`.

- [ ] **Step 5: Remove unrestricted-person inference from buffer scoring**

When dietary groups exist, a suggested buffer item must satisfy every group’s restrictions. If no common item exists, return no buffer. Do not modify `verifyPlan`.

- [ ] **Step 6: Register new tests**

`src/lib/gatherbite-final.test.ts` imports every new `node:test` module from this plan. Add:

```json
"test:gatherbite-final": "tsx --test src/lib/gatherbite-final.test.ts"
```

Append it to the existing `test` chain without removing current suites.

- [ ] **Step 7: Run tests**

```powershell
npm run test:scoring
npm run test:gatherbite-final
npx tsc --noEmit
```

Expected: pass.

- [ ] **Step 8: Commit after approval**

```powershell
git add src/lib/gatherbite/contracts.ts src/lib/gatherbite/contracts.test.ts src/lib/gatherbite-final.test.ts src/lib/types.ts src/lib/scoring.ts src/lib/scoring.test.ts package.json
git commit -m "feat: define final GatherBite contracts"
```

### Task 4: Add privacy-safe events and reusable timing

**Files:**
- Create: `src/lib/gatherbite/events.ts`
- Create: `src/lib/gatherbite/events.test.ts`
- Create: `src/lib/gatherbite/timing.ts`
- Create: `src/lib/gatherbite/timing.test.ts`
- Modify: `src/lib/gatherbite-final.test.ts`

**Interfaces:**
- Consumes: `PublicGatherBiteEvent`.
- Produces: `EventSink`, `createEventCollector`, `encodeNdjsonEvent`, `createNdjsonParser`, and `createTimingCollector`.

- [ ] **Step 1: Write failing tests**

```ts
test("split NDJSON chunks reassemble", () => {
  const parser = createNdjsonParser();
  assert.deepEqual(parser.push('{"type":"stage"'), []);
  assert.equal(parser.push('}\n').length, 1);
});

test("timing headers contain durations but no request data", () => {
  const timing = createTimingCollector();
  timing.record({ name: "planner", durationMs: 12.34, description: "Planner" });
  assert.match(timing.serverTiming(), /planner;dur=12.3/);
  assert.equal(timing.serverTiming().includes("address"), false);
});
```

- [ ] **Step 2: Confirm failure**

Run this command: `npm run test:gatherbite-final`.
Expected: FAIL on missing modules.

- [ ] **Step 3: Implement constrained interfaces**

```ts
export type EventSink = (event: PublicGatherBiteEvent) => void;

export function publicEvaluationError(error: unknown): Extract<PublicGatherBiteEvent, { type: "error" }>;

export interface TimingEntry {
  name: string;
  durationMs: number;
  description: string;
}
```

Events accept public IDs, line summaries, checks, reasons, and stages only. They do not accept arbitrary prompts, addresses, cookies, headers, or reasoning.

- [ ] **Step 4: Run and pass**

```powershell
npm run test:gatherbite-final
npx tsc --noEmit
```

- [ ] **Step 5: Commit after approval**

```powershell
git add src/lib/gatherbite/events.ts src/lib/gatherbite/events.test.ts src/lib/gatherbite/timing.ts src/lib/gatherbite/timing.test.ts src/lib/gatherbite-final.test.ts
git commit -m "feat: add safe GatherBite events and timing"
```

### Task 5: Normalize the configurable Domino’s catalogue and serviceability

**Files:**
- Modify: `src/lib/restaurants/dominos.ts`
- Modify: `src/lib/restaurants/dominos.test.ts`
- Create: `src/lib/restaurants/dominosCatalog.ts`
- Create: `src/lib/restaurants/dominosCatalog.test.ts`
- Create: `src/lib/restaurants/dominosServiceability.ts`
- Create: `src/lib/restaurants/dominosServiceability.test.ts`
- Create: `src/lib/pricing/peiTax.ts`
- Create: `src/lib/pricing/peiTax.test.ts`
- Modify: `src/lib/gatherbite-final.test.ts`

**Interfaces:**
- Consumes: sanitized fixtures and Task 2’s proven serviceability/quote mechanism.
- Produces: `buildDominosCatalog`, `checkDominosServiceability`, and trusted price/tax evidence.

- [ ] **Step 1: Write failing catalogue tests**

Against the sanitized real-shaped fixture, assert:

```ts
assert.equal(catalog.toppingsByCode.get("P")?.name, "Pepperoni");
assert.equal(catalog.productsByCode.get("S_TEST")?.defaultToppingCodes.includes("P"), true);
assert.equal(catalog.variantsByCode.get("12SCREEN")?.priceCad, 14.99);
assert.equal(catalog.dealsByCode.get("3203")?.trustedSlices, 8);
assert.equal(catalog.dealsByCode.get("MULTI")?.trustedSlices, null);
```

- [ ] **Step 2: Write failing serviceability and price tests**

Cover `SERVICEABLE`, `NOT_SERVICEABLE`, and `UNKNOWN`, plus Carryout without address. Test a live official quote as highest-confidence total. Test versioned PEI HST calculation only when every pre-tax component and taxability are known; any unknown fee keeps total unknown.

- [ ] **Step 3: Confirm failure**

```powershell
npm run test:dominos
npm run test:gatherbite-final
```

Expected: new modules/assertions fail.

- [ ] **Step 4: Extend snapshot types without weakening current parsing**

```ts
export interface DominosToppingOption {
  code: string;
  name: string;
  category: string | null;
}

export interface DominosVariant {
  code: string;
  productCode: string | null;
  sizeCode: string | null;
  crustCode: string | null;
  priceCad: number | null;
}
```

Extend products with `defaultToppingCodes`, `variantCodes`, and only component identifiers proven by the fixture. Preserve current resolved topping names and deal-slice behavior. Never derive codes from display names.

- [ ] **Step 5: Implement the immutable catalogue**

```ts
export interface DominosCatalog {
  storeId: string;
  snapshotVersion: string;
  productsByCode: ReadonlyMap<string, DominosProduct>;
  variantsByCode: ReadonlyMap<string, DominosVariant>;
  toppingsByCode: ReadonlyMap<string, DominosToppingOption>;
  dealsByCode: ReadonlyMap<string, DominosDeal>;
}

export function buildDominosCatalog(snapshot: DominosStoreSnapshot): DominosCatalog;

export async function observeSupportedDominosStores(
  storeIds: readonly string[],
  onTiming?: DominosTimingObserver,
  signal?: AbortSignal,
): Promise<readonly DominosStoreSnapshot[]>;
```

Use `storeId:fetchedAt` as the initial snapshot version. Observe stores with `Promise.all` so both start together. Empty/duplicate identifiers are excluded and recorded as parser errors.

- [ ] **Step 6: Implement official serviceability**

```ts
export interface ServiceabilityLookup {
  (address: DeliveryAddress, signal: AbortSignal): Promise<{ storeIds: string[]; observedAt: string }>;
}

export async function checkDominosServiceability(
  address: DeliveryAddress | undefined,
  method: ServiceMethod,
  deps: { lookup: ServiceabilityLookup; signal?: AbortSignal },
): Promise<DominosServiceabilityResult>;

export type DominosPriceEvidence =
  | { status: "KNOWN"; kind: "LIVE_QUOTE" | "TRUSTED_CALCULATION"; subtotalCad: number; taxCad: number; feesCad: number; totalCad: number; source: string; observedAt: string }
  | { status: "UNKNOWN"; kind: "UNKNOWN"; subtotalCad: number | null; taxCad: null; feesCad: null; totalCad: null; source: string; observedAt: string };
```

Use the exact Task 2 mechanism. If no legitimate machine-callable lookup exists, production returns `UNKNOWN` with the recorded reason; Carryout remains evaluable. Never infer delivery range by distance.

- [ ] **Step 7: Implement trusted tax evidence**

```ts
export const PEI_HST_RATE = 0.15;
export function calculatePeiHst(subtotalCad: number): {
  taxCad: number;
  totalCad: number;
  source: string;
  effectiveDate: string;
};
```

Set `source` to `https://www.princeedwardisland.ca/en/information/finance/harmonized-sales-tax-hst` and record the source’s stated effective basis plus a separate source-check date in tests/fixtures. Prefer a live official quote whenever available.

- [ ] **Step 8: Run regression tests**

```powershell
npm run test:dominos
npm run test:dominos-dietary
npm run test:gatherbite-final
npx tsc --noEmit
```

Expected: pass.

- [ ] **Step 9: Commit after approval**

```powershell
git add src/lib/restaurants/dominos.ts src/lib/restaurants/dominos.test.ts src/lib/restaurants/dominosCatalog.ts src/lib/restaurants/dominosCatalog.test.ts src/lib/restaurants/dominosServiceability.ts src/lib/restaurants/dominosServiceability.test.ts src/lib/pricing/peiTax.ts src/lib/pricing/peiTax.test.ts src/lib/gatherbite-final.test.ts
git commit -m "feat: normalize Domino's configuration and serviceability"
```

### Task 6: Implement protected-slice allocation and soft preference configuration

**Files:**
- Create: `src/lib/restaurants/dominosCapacity.ts`
- Create: `src/lib/restaurants/dominosCapacity.test.ts`
- Create: `src/lib/restaurants/dominosPreferences.ts`
- Create: `src/lib/restaurants/dominosPreferences.test.ts`
- Modify: `src/lib/gatherbite-final.test.ts`

**Interfaces:**
- Consumes: candidate, catalogue, dietary groups, and preferences.
- Produces: `allocateProtectedSlices`, `checkTotalPizzaCapacity`, and `configureGeneralPreferences`.

- [ ] **Step 1: Write failing capacity tests**

```ts
const allocation = allocateProtectedSlices(candidate, [
  { id: "veg", people: 2, restrictions: ["vegetarian"] },
  { id: "pork", people: 2, restrictions: ["noPork"] },
], compatibility);
assert.equal(allocation.groups.veg.allocatedSlices, 6);
assert.equal(allocation.groups.pork.allocatedSlices, 6);
assert.equal(allocation.allocatedSliceIds.size, 12);
```

Also prove drinks, sides, and ambiguous bundles supply zero capacity and total required slices remain `attendees * 3`.

- [ ] **Step 2: Write failing preference tests**

Prove Pepperoni, Veggie, and Meat lovers use current topping codes; protected lines are unchanged; unavailable intent produces an unmet reason without invalidation; blank preferences choose the lowest-cost simple capacity-sufficient general configuration.

- [ ] **Step 3: Confirm failure**

Run this command: `npm run test:gatherbite-final`.
Expected: FAIL on missing modules.

- [ ] **Step 4: Implement conservative slice allocation**

```ts
export function allocateProtectedSlices(
  candidate: DominosCandidate,
  groups: DietaryGroupInput[],
  isCompatible: (pizza: CandidatePizza, group: DietaryGroupInput) => boolean,
): ProtectedSliceAllocation;

export function checkTotalPizzaCapacity(
  candidate: DominosCandidate,
  attendees: number,
): EvidenceCheck<CapacityFacts>;
```

Represent slices with stable IDs derived from line, pizza unit, and slice position. A protected slice can be allocated to only one separate group and counts once toward total capacity.

- [ ] **Step 5: Implement preference mapping**

```ts
export function configureGeneralPreferences(
  candidate: DominosCandidate,
  catalog: DominosCatalog,
  preferences: PizzaPreference[],
  avoidanceNotes: string[],
): { candidate: DominosCandidate; evidence: PreferenceEvidence };
```

Use explicit canonical live-name/code sets. Never edit `purpose: "dietary-protected"`. Distribute requested intents across general pizzas in input order and record represented/unmet reasons.

- [ ] **Step 6: Run tests**

```powershell
npm run test:dominos-dietary
npm run test:gatherbite-final
npx tsc --noEmit
```

- [ ] **Step 7: Commit after approval**

```powershell
git add src/lib/restaurants/dominosCapacity.ts src/lib/restaurants/dominosCapacity.test.ts src/lib/restaurants/dominosPreferences.ts src/lib/restaurants/dominosPreferences.test.ts src/lib/gatherbite-final.test.ts
git commit -m "feat: allocate protected pizza and map preferences"
```

### Task 7: Implement parallel exact candidate evidence

**Files:**
- Create: `src/lib/restaurants/dominosEvidence.ts`
- Create: `src/lib/restaurants/dominosEvidence.test.ts`
- Modify: `src/lib/restaurants/dominosDietary.ts`
- Modify: `src/lib/restaurants/dominosDietary.test.ts`
- Modify: `src/lib/gatherbite-final.test.ts`

**Interfaces:**
- Consumes: candidate, catalogue, groups, live snapshot, serviceability, and price evidence.
- Produces: `collectCandidateEvidence(context): Promise<CandidateEvidenceBundle>`.

- [ ] **Step 1: Write failing table tests**

Create cases where exactly one check is `FAIL` or `UNKNOWN`:

```ts
for (const key of ["menuIntegrity", "dietary", "capacity", "budget", "availability", "serviceability"] as const) {
  const evidence = await collectCandidateEvidence(makeContextWithFailure(key));
  assert.notEqual(evidence.checks[key].status, "PASS");
}
```

Include `MAY_CONTAIN`, unknown crust, stale snapshot, insufficient protected/total slices, unknown fee, closed store, and unserviceable address.

- [ ] **Step 2: Confirm failure**

Run this command: `npm run test:gatherbite-final`.
Expected: FAIL on missing collector.

- [ ] **Step 3: Add configured-pizza dietary evaluation**

```ts
export function evaluateConfiguredDominosPizza(
  components: ConfiguredPizzaComponents,
  restrictions: Restriction[],
): DietaryEvaluation;
```

Reuse curated profiles. Preserve existing `evaluateDominosDietary` and `evaluateDominosDeal` exports.

- [ ] **Step 4: Implement the fan-out**

```ts
export interface CandidateEvidenceContext {
  input: GatherBiteInput;
  candidate: DominosCandidate;
  snapshot: DominosStoreSnapshot;
  catalog: DominosCatalog;
  serviceability: DominosServiceabilityResult;
  priceEvidence: DominosPriceEvidence;
  collectedAt: string;
}

export async function collectCandidateEvidence(context: CandidateEvidenceContext) {
  const settled = await Promise.allSettled([
    checkMenuIntegrity(context),
    checkDietaryCoverage(context),
    checkCapacity(context),
    checkBudget(context),
    checkAvailability(context),
    checkServiceability(context),
  ]);
  return normalizeSettledEvidence(context, settled);
}
```

Every rejected promise becomes explicit `UNKNOWN`. The bundle contains no aggregate approval field.

- [ ] **Step 5: Run tests**

```powershell
npm run test:dominos-dietary
npm run test:gatherbite-final
npx tsc --noEmit
```

- [ ] **Step 6: Commit after approval**

```powershell
git add src/lib/restaurants/dominosEvidence.ts src/lib/restaurants/dominosEvidence.test.ts src/lib/restaurants/dominosDietary.ts src/lib/restaurants/dominosDietary.test.ts src/lib/gatherbite-final.test.ts
git commit -m "feat: collect exact Domino's candidate evidence"
```

### Task 8: Add the separate Verification Agent and fail-closed guard

**Files:**
- Modify: `src/lib/groq.ts`
- Create: `src/lib/agents/verifierGuard.ts`
- Create: `src/lib/agents/verifierGuard.test.ts`
- Create: `src/lib/agents/dominosVerifier.ts`
- Create: `src/lib/agents/dominosVerifier.test.ts`
- Modify: `src/lib/gatherbite-final.test.ts`

**Interfaces:**
- Consumes: candidate/evidence context and `collectCandidateEvidence`.
- Produces: `runDominosVerifier(input, deps): Promise<VerificationOutcome>`.

- [ ] **Step 1: Write failing guard tests**

```ts
assert.equal(guardVerificationDecision(approveDecision, evidenceWithUnknown).status, "VERIFIER_ERROR");
assert.equal(guardVerificationDecision(rejectDecision, allPassingEvidence).decision.decision, "REJECT");
```

The guard must never upgrade rejection.

- [ ] **Step 2: Write failing invocation tests**

With fake model/collector dependencies, prove one candidate causes exactly one separate verifier runner call, evidence executes before verdict, and no candidate causes no call.

- [ ] **Step 3: Confirm failure**

Run this command: `npm run test:gatherbite-final`.
Expected: FAIL on missing modules.

- [ ] **Step 4: Export explicit models**

```ts
export const PLANNER_MODEL = groq("openai/gpt-oss-120b");
export const VERIFIER_MODEL = groq(process.env.GATHERBITE_VERIFIER_MODEL ?? "openai/gpt-oss-120b");
```

The environment variable stays server-only.

- [ ] **Step 5: Implement the Verifier**

```ts
export interface VerifyCandidateInput {
  candidate: DominosCandidate;
  evidenceContext: CandidateEvidenceContext;
}

export interface VerifyCandidateDeps {
  model: LanguageModel;
  collectEvidence: typeof collectCandidateEvidence;
  onEvent?: EventSink;
  onTiming?: (entry: TimingEntry) => void;
}

export async function runDominosVerifier(
  input: VerifyCandidateInput,
  deps: VerifyCandidateDeps,
): Promise<VerificationOutcome>;
```

Use `ToolLoopAgent`, `tool`, `Output.object`, Zod output, deterministic temperature, one provider retry, and a four-step cap. Expose only `gatherCandidateEvidence`; store the returned bundle in invocation closure. If the tool was never called, return `VERIFIER_ERROR`.

- [ ] **Step 6: Implement the guard**

Check candidate/version/snapshot identity and require every applicable hard check to be `PASS` for model-issued `APPROVE`. An inconsistency returns `VERIFIER_ERROR`, never `REJECT` or `APPROVE` fabricated by the guard.

- [ ] **Step 7: Run fake-model tests**

```powershell
npm run test:gatherbite-final
npx tsc --noEmit
```

No live Groq calls occur in deterministic tests.

- [ ] **Step 8: Commit after approval**

```powershell
git add src/lib/groq.ts src/lib/agents/verifierGuard.ts src/lib/agents/verifierGuard.test.ts src/lib/agents/dominosVerifier.ts src/lib/agents/dominosVerifier.test.ts src/lib/gatherbite-final.test.ts
git commit -m "feat: add independent Domino's Verification Agent"
```

### Task 9: Add the Planner Agent and bounded verifier-as-tool loop

**Files:**
- Create: `src/lib/agents/dominosPlanner.ts`
- Create: `src/lib/agents/dominosPlanner.test.ts`
- Create: `src/lib/gatherbite/agentLoop.ts`
- Create: `src/lib/gatherbite/agentLoop.test.ts`
- Modify: `src/lib/gatherbite-final.test.ts`

**Interfaces:**
- Consumes: request-scoped observation promise and `runDominosVerifier`.
- Produces: `runDominosPlanner(input, deps): Promise<PlannerRunResult>`.

- [ ] **Step 1: Write failing loop tests**

Cover no candidate/no Verifier, approval retention, `ADAPT_ORDER` feedback and adaptation, `TERMINAL` stop, three-verification cap, at most two verifier calls in flight, and inability for Planner prose to create approval.

- [ ] **Step 2: Confirm failure**

Run this command: `npm run test:gatherbite-final`.
Expected: FAIL on missing Planner/loop.

- [ ] **Step 3: Implement state**

```ts
export interface DominosAgentLoopState {
  verificationAttempts: number;
  approvedCandidateIds: Set<string>;
  terminal: boolean;
}

export function shouldStopDominosLoop(state: DominosAgentLoopState): boolean {
  return state.terminal || state.verificationAttempts >= 3 || state.approvedCandidateIds.size >= 2;
}
```

- [ ] **Step 4: Implement Planner tools and prompt**

`observeDominosOptions` awaits the already-started promise. `verifyCandidate` accepts `DominosCandidateSchema`, invokes the separate Verifier, emits public events, and returns the outcome. The Planner has no import/reference to exact evidence functions.

Instructions require real IDs, protected pizza first, preferences only on general pizza, at most two initial candidates, verification for every candidate, adaptation only from rejection evidence, and no self-approval.

- [ ] **Step 5: Implement the bounded agent**

Use these boundaries:

```ts
export interface DominosObservationContext {
  snapshots: readonly DominosStoreSnapshot[];
  catalogs: ReadonlyMap<string, DominosCatalog>;
  serviceability: DominosServiceabilityResult;
  observedAt: string;
}

export interface PlannerDependencies {
  model: LanguageModel;
  observationPromise: Promise<DominosObservationContext>;
  verifyCandidate: typeof runDominosVerifier;
  onEvent?: EventSink;
  onTiming?: (entry: TimingEntry) => void;
}

export interface PlannerRunResult {
  journeys: CandidateJourney[];
  verificationAttempts: number;
  terminal: boolean;
}

export async function runDominosPlanner(
  input: GatherBiteInput,
  deps: PlannerDependencies,
): Promise<PlannerRunResult>;
```

Use `PLANNER_MODEL`, deterministic temperature, one provider retry, `stepCountIs(12)`, and `shouldStopDominosLoop`. Parse candidate/outcome history only from tool calls/results; ignore free-text validity claims.

- [ ] **Step 6: Run tests**

```powershell
npm run test:gatherbite-final
npx tsc --noEmit
```

- [ ] **Step 7: Commit after approval**

```powershell
git add src/lib/agents/dominosPlanner.ts src/lib/agents/dominosPlanner.test.ts src/lib/gatherbite/agentLoop.ts src/lib/gatherbite/agentLoop.test.ts src/lib/gatherbite-final.test.ts
git commit -m "feat: delegate Domino's candidates to verifier"
```

### Task 10: Rank, normalize, orchestrate, and expose JSON evaluation

**Files:**
- Create: `src/lib/gatherbite/ranking.ts`
- Create: `src/lib/gatherbite/ranking.test.ts`
- Create: `src/lib/gatherbite/normalize.ts`
- Create: `src/lib/gatherbite/normalize.test.ts`
- Create: `src/lib/gatherbite/orchestrator.ts`
- Create: `src/lib/gatherbite/orchestrator.test.ts`
- Create: `src/lib/gatherbite/retry.ts`
- Create: `src/lib/gatherbite/retry.test.ts`
- Modify: `src/lib/gatherbite.ts`
- Modify: `src/lib/gatherbite.test.ts`
- Modify: `src/app/api/gatherbite/route.ts`
- Modify: `src/lib/gatherbite-final.test.ts`

**Interfaces:**
- Consumes: Planner run, Verifier outcomes, live/serviceability dependencies, timing, and events.
- Produces: `rankApprovedDominosOptions`, `normalizeDominosEvaluation`, `evaluateGatherBite`, and JSON endpoint.

- [ ] **Step 1: Write failing ranking/normalization tests**

```ts
const ranked = rankApprovedDominosOptions([approvedA, rejectedB, approvedC], preferences);
assert.equal(ranked.recommended?.candidateId, "A");
assert.deepEqual(ranked.alternatives.map((x) => x.candidateId), ["C"]);
```

Add cases for preference representation, verified total, excess slices, known wait, max wait, and stable-ID tie-breaking. Normalize exact lines, all hard statuses, method-specific wait, unmet preferences, rejected journey, and unknown values. Assert no Little Caesars option appears.

- [ ] **Step 2: Write failing orchestration tests**

With injected fakes prove:

- supported stores start concurrently and fetch once;
- serviceability starts concurrently when required;
- Planner and Verifier use one immutable observation version;
- Little Caesars is never invoked;
- rejection/adaptation events stay candidate-ordered;
- recommendation and alternatives survive;
- transient/terminal failures remain honest.
- a transient operation runs at most twice and a hard rejection is never passed to transport retry;
- the overall abort deadline cancels store/model work.

- [ ] **Step 3: Confirm failure**

```powershell
npm run test:gatherbite
npm run test:gatherbite-final
```

Expected: new modules fail.

- [ ] **Step 4: Implement approved-only ranking**

Apply exact priority: preference representation, lower verified total, less excess capacity, known wait, lower comparable maximum wait, stable ID. Unknown wait is never zero. Return `recommended: null` if nothing is approved.

- [ ] **Step 5: Implement normalization**

Return one recommendation, alternatives, rejected journeys, exact configured lines, protected allocations, verified totals, checks, relevant wait, preference result, and public events. Keep current `src/lib/gatherbite.ts` exports/re-exports for debug compatibility.

- [ ] **Step 6: Implement the request-scoped orchestrator**

```ts
export interface GatherBiteDependencies {
  observeStores: typeof observeSupportedDominosStores;
  checkServiceability: typeof checkDominosServiceability;
  runPlanner: typeof runDominosPlanner;
  now: () => number;
}

export async function evaluateGatherBite(
  input: GatherBiteInput,
  deps: GatherBiteDependencies,
  onEvent?: EventSink,
): Promise<GatherBiteEvaluation>;
```

Add:

```ts
export async function withOneTransientRetry<T>(
  operation: (attempt: 1 | 2) => Promise<T>,
  isTransient: (error: unknown) => boolean,
): Promise<T>;
```

Start observations immediately after validation, build one immutable context, and reuse it. Apply one retry only to classified transport failures and use one overall abort deadline. Record per-store, Planner, Verifier, evidence, ranking, and total timings.

- [ ] **Step 7: Replace main JSON route orchestration**

Parse `GatherBiteInputSchema`, call `evaluateGatherBite`, return validation reasons and `Server-Timing`. Remove the sum-of-groups rejection from this route. Do not import/call `buildOrder`.

- [ ] **Step 8: Run full tests**

```powershell
npm run test
npx tsc --noEmit
```

Expected: all old and new tests pass; Little Caesars remains independently valid.

- [ ] **Step 9: Commit after approval**

```powershell
git add src/lib/gatherbite/ranking.ts src/lib/gatherbite/ranking.test.ts src/lib/gatherbite/normalize.ts src/lib/gatherbite/normalize.test.ts src/lib/gatherbite/orchestrator.ts src/lib/gatherbite/orchestrator.test.ts src/lib/gatherbite/retry.ts src/lib/gatherbite/retry.test.ts src/lib/gatherbite.ts src/lib/gatherbite.test.ts src/app/api/gatherbite/route.ts src/lib/gatherbite-final.test.ts
git commit -m "feat: orchestrate Domino's-first GatherBite evaluation"
```

### Task 11: Stream real progress with JSON fallback

**Files:**
- Create: `src/app/api/gatherbite/stream/route.ts`
- Create: `src/lib/gatherbite/stream.test.ts`
- Modify: `src/lib/gatherbite/events.ts`
- Modify: `src/lib/gatherbite-final.test.ts`

**Interfaces:**
- Consumes: `evaluateGatherBite`, `EventSink`, and NDJSON helpers.
- Produces: `POST /api/gatherbite/stream`; JSON route stays available.

- [ ] **Step 1: Write failing stream tests**

Use a testable handler factory. Assert stage records precede the final record, every line parses, errors are typed public events, cancellation propagates, and submitted address bytes never appear.

- [ ] **Step 2: Confirm failure**

Run this command: `npm run test:gatherbite-final`.
Expected: FAIL on missing handler.

- [ ] **Step 3: Implement native NDJSON streaming**

Follow installed Next.js 16 Route Handler docs:

```ts
const stream = new ReadableStream<Uint8Array>({
  start(controller) {
    const send: EventSink = (event) => controller.enqueue(encodeNdjsonEvent(event));
    void evaluateGatherBite(input, deps, send)
      .then((result) => send({ type: "complete", result }))
      .catch((error) => send(publicEvaluationError(error)))
      .finally(() => controller.close());
  },
});
```

Return `application/x-ndjson; charset=utf-8`, `Cache-Control: no-store`, and request-abort propagation.

- [ ] **Step 4: Run tests/build**

```powershell
npm run test:gatherbite-final
npx tsc --noEmit
npm run build
```

- [ ] **Step 5: Commit after approval**

```powershell
git add src/app/api/gatherbite/stream/route.ts src/lib/gatherbite/stream.test.ts src/lib/gatherbite/events.ts src/lib/gatherbite-final.test.ts
git commit -m "feat: stream real GatherBite evaluation events"
```

---

## Phase 2 — Domino’s-First Organizer Experience

### Task 12: Build the minimal progressive organizer form

**Files:**
- Create: `src/components/GroupRequirementsForm.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: final input contracts and stream/JSON endpoints.
- Produces: valid organizer input, public event state, final evaluation state, selection state, and cart state.

- [ ] **Step 1: Record acceptance checklist**

```text
[ ] Empty people/budget on first load
[ ] Either selected by default
[ ] Address shown for Delivery/Either only
[ ] Carryout works without address
[ ] No dietary group until Add dietary need
[ ] Optional preference chips include Meat lovers
[ ] No Night Shift, PEI IT Alliance, Little Caesars, fixed-store, or debug copy
[ ] Primary CTA is Find my verified order
[ ] Mobile/keyboard usable
```

- [ ] **Step 2: Implement `GroupRequirementsForm`**

Use string state for blank numbers, accessible service-method fieldset, fixed `province: "PE"`, conditional street/unit/city/postal, an “Add dietary need” action, and preference buttons with `aria-pressed`. Validate with `GatherBiteInputSchema`. Never compare summed group counts to attendees.

- [ ] **Step 3: Reduce `page.tsx` to the workflow shell**

Hold input, events, evaluation, selected candidate, and cart state. Read NDJSON with `createNdjsonParser`. Fall back to JSON only if streaming fails before any event arrives, avoiding duplicate evaluations.

- [ ] **Step 4: Correct branding/metadata**

Use only:

```text
GatherBite
The AI agent that figures out how to feed your group.
```

Describe evidence-backed coordination without partnership or medical claims.

- [ ] **Step 5: Verify locally**

```powershell
npx tsc --noEmit
npm run lint
npm run build
```

Use the local browser at desktop/mobile widths and complete the checklist.

- [ ] **Step 6: Commit after approval**

```powershell
git add src/components/GroupRequirementsForm.tsx src/app/page.tsx src/app/globals.css src/app/layout.tsx
git commit -m "feat: simplify Domino's-first organizer input"
```

### Task 13: Render the Magic Pass, recommendation, and human decision

**Files:**
- Create: `src/components/EvaluationProgress.tsx`
- Create: `src/components/VerificationJourney.tsx`
- Create: `src/components/VerifiedOptions.tsx`
- Create: `src/components/DecisionReview.tsx`
- Modify: `src/components/GatherBiteResults.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: events, candidate journeys, recommendation, alternatives, and selected candidate.
- Produces: honest progress, retained rejection, recommendation-first options, exact final review, and change-selection behavior.

- [ ] **Step 1: Implement real progress**

Render only received events with `aria-live="polite"`: observing, planning, verifying, rejected, adapting, approved, comparing. No percentages, timer-synthesized stages, or chain-of-thought.

- [ ] **Step 2: Implement `VerificationJourney`**

Show proposed exact lines, Verification Agent verdict, check statuses, concrete reason, and adapted-candidate relationship. Keep rejected candidates. Auto-open a journey containing a rejection; keep first-pass success compact.

- [ ] **Step 3: Implement recommendation-first options**

Show recommended store/address, method, exact order, verified total, relevant wait, preference result, recommendation reason, and compact Capacity/Dietary/Budget/Availability checks. Do not auto-select. Place approved alternatives and rejected/unknown checks in separate disclosures.

- [ ] **Step 4: Implement no-viable and final review**

No-viable state shows blockers/unknowns and safe adjustments without weakening dietary constraints. `DecisionReview` shows exact configuration, protected allocations, total, method, wait, preferences, “Change selected option,” and “Prepare my Domino’s cart.”

- [ ] **Step 5: Add useful motion only**

Use 150–250 ms CSS transitions for candidate entry, rejection, adaptation, approval, selection, and expansion. Add `prefers-reduced-motion` overrides. Do not add Anime.js unless CSS cannot express an approved state.

- [ ] **Step 6: Verify selection/accessibility**

In the local browser, select recommendation, switch alternative, inspect rejected evidence, exercise keyboard focus, mobile layout, and reduced motion. Confirm exact review updates and no Little Caesars content appears.

- [ ] **Step 7: Run quality checks**

```powershell
npx tsc --noEmit
npm run lint
npm run build
git diff --check
```

- [ ] **Step 8: Commit after approval**

```powershell
git add src/components/EvaluationProgress.tsx src/components/VerificationJourney.tsx src/components/VerifiedOptions.tsx src/components/DecisionReview.tsx src/components/GatherBiteResults.tsx src/app/page.tsx src/app/globals.css
git commit -m "feat: complete the verified organizer decision flow"
```

---

## Phase 3 — Prepared Cart or Strongest Legitimate Fallback

### Task 14: Add cart contracts, strict comparison, safety guard, and guided fallback

**Files:**
- Create: `src/lib/cart/contracts.ts`
- Create: `src/lib/cart/dominosCartComparator.ts`
- Create: `src/lib/cart/dominosCartComparator.test.ts`
- Create: `src/lib/cart/dominosCartGuard.ts`
- Create: `src/lib/cart/dominosCartGuard.test.ts`
- Create: `src/lib/cart/dominosCartFallback.ts`
- Create: `src/lib/cart/dominosCartFallback.test.ts`
- Modify: `src/lib/gatherbite-final.test.ts`

**Interfaces:**
- Consumes: approved candidate and Task 2 official-link evidence.
- Produces: `ActualDominosCart`, `CartComparison`, `SafeBrowserAction`, `guardBrowserAction`, and `buildGuidedHandoff`.

- [ ] **Step 1: Write strict comparison tests**

Start from matching expected/actual fixtures. Independently mutate store, method, product, quantity, size, crust, sauce, cheese, topping, coupon, subtotal, tax, fee, total, capacity, and dietary configuration. Every mutation must produce a named mismatch.

- [ ] **Step 2: Write browser guard tests**

```ts
for (const label of ["Place order", "Pay now", "Complete checkout", "Confirm purchase", "Submit order"]) {
  assert.equal(guardBrowserAction({ kind: "click", label, context: "checkout" }).allowed, false);
}
assert.equal(guardBrowserAction({ kind: "click", label: "Add to cart", context: "menu" }).allowed, true);
```

Also deny CAPTCHA interaction, credential submission, and unclassified checkout clicks.

- [ ] **Step 3: Write guided fallback tests**

Assert official URL, only proven persisted parameters, exact lines, complete-copy text, per-line text, remaining actions, and wording that never says “prepared.”

- [ ] **Step 4: Confirm failure**

Run this command: `npm run test:gatherbite-final`.
Expected: FAIL on missing cart modules.

- [ ] **Step 5: Implement contracts/comparator**

```ts
export type CartPreparationStatus =
  | "PREPARED_AND_OBSERVED"
  | "PREPARED_AND_VERIFIED"
  | "NEEDS_HUMAN_CAPTCHA"
  | "NEEDS_HUMAN_LOGIN"
  | "CART_MISMATCH"
  | "SESSION_NOT_TRANSFERABLE"
  | "AUTOMATION_UNAVAILABLE"
  | "TIMED_OUT"
  | "FALLBACK_READY";

export interface ActualCartItem {
  productCode: string | null;
  variantCode: string | null;
  quantity: number;
  sizeCode: string | null;
  crustCode: string | null;
  sauceCode: string | null;
  cheeseCode: string | null;
  toppings: Array<{ code: string; quantity: number }>;
}

export interface ActualDominosCart {
  storeId: string | null;
  serviceMethod: "delivery" | "carryout" | null;
  items: ActualCartItem[];
  couponCodes: string[];
  subtotalCad: number | null;
  taxCad: number | null;
  feesCad: number | null;
  totalCad: number | null;
  observedAt: string;
}

export interface PrepareCartInput {
  candidate: DominosCandidate;
  organizerInput: GatherBiteInput;
}

export interface CartPreparationResult {
  status: CartPreparationStatus;
  actualCart: ActualDominosCart | null;
  comparison: CartComparison | null;
  handoffUrl: string | null;
  fallback: GuidedOrderHandoff;
  reason: string | null;
}

export interface DominosCartExecutor {
  prepare(input: PrepareCartInput): Promise<CartPreparationResult>;
}

export function compareDominosCart(
  expected: DominosCandidate,
  actual: ActualDominosCart,
): CartComparison;
```

Comparison is strict and never accepts substitutions or extra items.

- [ ] **Step 6: Implement safe intents and fallback**

Allow only reversible store, method, address, deal, add/edit/remove configuration, and cart-navigation intents. Deny by semantic purpose plus page context. Build the strongest Task 2-proven official URL plus exact guide.

- [ ] **Step 7: Run tests**

```powershell
npm run test:gatherbite-final
npx tsc --noEmit
```

- [ ] **Step 8: Commit after approval**

```powershell
git add src/lib/cart src/lib/gatherbite-final.test.ts
git commit -m "feat: add safe cart comparison and fallback"
```

### Task 15: Implement the selected bounded cart executor

**Files:**
- Create: `src/lib/cart/dominosCartExecutor.ts`
- Create: `src/lib/cart/dominosCartExecutor.test.ts`
- Conditional create for `transferable-browser`: `src/lib/cart/dominosCartAgent.ts`
- Conditional create for `transferable-browser`: `src/lib/cart/dominosCartAgent.test.ts`
- Modify: `src/lib/gatherbite-final.test.ts`

**Interfaces:**
- Consumes: Task 2 mode, safe actions, approved manifest, and official driver/deep-link evidence.
- Produces: `createDominosCartExecutor(config)` and bounded result in every mode.

- [ ] **Step 1: Write state-machine tests**

Cover:

```text
NOT_STARTED → PREPARING → PREPARED_AND_OBSERVED
NOT_STARTED → PREPARING → NEEDS_HUMAN_CAPTCHA
NOT_STARTED → PREPARING → NEEDS_HUMAN_LOGIN
NOT_STARTED → PREPARING → CART_MISMATCH
NOT_STARTED → PREPARING → SESSION_NOT_TRANSFERABLE
NOT_STARTED → PREPARING → TIMED_OUT
every non-success → FALLBACK_READY
```

Assert one session, one initial build, one corrective rebuild, at most three attempts per recoverable step, immediate CAPTCHA stop, and hard timeout.

- [ ] **Step 2: Confirm failure**

Run this command: `npm run test:gatherbite-final`.
Expected: FAIL on missing executor.

- [ ] **Step 3: Implement the mode factory**

```ts
export interface BrowserSnapshot {
  url: string;
  title: string;
  pageKind: "locator" | "menu" | "configuration" | "cart" | "checkout" | "captcha" | "login" | "unknown";
  controls: Array<{ role: string; label: string; disabled: boolean }>;
  cart: ActualDominosCart | null;
}

export interface BrowserDriver {
  snapshot(): Promise<BrowserSnapshot>;
  perform(action: SafeBrowserAction): Promise<void>;
  handoffUrl(): Promise<string | null>;
  close(): Promise<void>;
}

export function createDominosCartExecutor(config: {
  mode: "transferable-browser" | "supported-deep-link" | "guided-handoff";
  browserDriver?: BrowserDriver;
  timeoutMs: number;
}): DominosCartExecutor;
```

Guided mode always returns an exact guide. Deep-link mode returns only proven state plus the guide. Browser mode is enabled only if secure organizer takeover was proven.

- [ ] **Step 4: Implement the browser specialist only when proven**

Create a bounded `ToolLoopAgent` with only `snapshotOfficialPage`, `performSafeAction`, and `readOfficialCart`. `performSafeAction` must call the guard. The agent cannot access Planner, dietary, capacity, budget, or payment tools and stops at cart review.

The driver follows the exact public flow/session handoff from Task 2. If it requires a new dependency, present package, security, bundle, and deployment impact and obtain approval before installation.

For every meaningful action, the agent must read a fresh official-page snapshot before acting, perform one guarded action, read a new snapshot, and verify the expected transition. Redirects, store/method changes, dynamic configuration, and reauthentication invalidate prior element references. CAPTCHA and failed authentication stop immediately rather than consuming the three-attempt recovery budget.

- [ ] **Step 5: Implement automatic fallback**

Every blocked, timed-out, unavailable, mismatch, or non-transferable result includes `buildGuidedHandoff(expected)`.

- [ ] **Step 6: Test deterministically and live without purchase**

Run deterministic tests. Then prepare one guest cart from the preview environment, inspect it, verify transfer when browser mode is selected, and stop before payment.

- [ ] **Step 7: Commit after approval**

```powershell
git add src/lib/cart/dominosCartExecutor.ts src/lib/cart/dominosCartExecutor.test.ts src/lib/gatherbite-final.test.ts
git commit -m "feat: add bounded Domino's cart execution"
```

When browser mode is selected, include `dominosCartAgent.ts` and its test in the commit.

### Task 16: Revalidate selection, verify the actual cart, and finish cart UX

**Files:**
- Create: `src/lib/cart/prepareCart.ts`
- Create: `src/lib/cart/prepareCart.test.ts`
- Create: `src/app/api/gatherbite/cart/prepare/route.ts`
- Create: `src/components/CartPreparation.tsx`
- Modify: `src/components/DecisionReview.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/lib/gatherbite-final.test.ts`

**Interfaces:**
- Consumes: untrusted client-selected candidate, live observations, Verifier, executor, comparator, and fallback.
- Produces: `prepareSelectedDominosCart`, cart endpoint, and final human handoff states.

- [ ] **Step 1: Write tamper/reverification tests**

Changing returned quantity, topping, store, method, or price must not reach execution without a fresh separate Verification Agent approval. A matching actual cart receives a fresh Verification Agent call; a mismatch never returns `PREPARED_AND_VERIFIED`.

- [ ] **Step 2: Confirm failure**

Run this command: `npm run test:gatherbite-final`.
Expected: FAIL on missing preparation service.

- [ ] **Step 3: Implement preparation service**

```ts
export interface PrepareCartDependencies {
  refreshObservation: (input: GatherBiteInput) => Promise<DominosObservationContext>;
  verifyCandidate: typeof runDominosVerifier;
  executor: DominosCartExecutor;
  compareCart: typeof compareDominosCart;
  verifyActualCart: typeof runDominosVerifier;
}

export type CartEventSink = (event: {
  type: "cart-stage" | "cart-blocked" | "cart-complete";
  message: string;
}) => void;

export async function prepareSelectedDominosCart(
  candidateInput: unknown,
  input: GatherBiteInput,
  deps: PrepareCartDependencies,
  onEvent?: CartEventSink,
): Promise<CartPreparationResult>;
```

Parse candidate, refresh applicable live data, invoke the separate Verifier, and execute only after `APPROVE`. Compare official cart strictly and invoke the Verifier over actual-cart evidence. Return `PREPARED_AND_VERIFIED` only when both pass.

After a zero-mismatch comparison, convert the complete observed cart into a fresh `DominosCandidate` using observed store, method, products, configurations, quantities, coupons, and totals; increment `candidateVersion`; and collect evidence against the refreshed snapshot. Do not fill missing actual-cart fields from the expected manifest. Any missing field is a mismatch and stops before this Verifier call.

- [ ] **Step 4: Implement the route**

Use Node.js Route Handler and `Cache-Control: no-store`. Abort downstream work on request cancellation. Return only public events/results and never log address or payload.

- [ ] **Step 5: Implement `CartPreparation`**

Show actual stages: store selection, deal, configuration, cart read, independent verification. Render explicit CAPTCHA, login, mismatch, timeout, non-transferable, and fallback states.

Success: “Continue to Domino’s checkout.”

Fallback: “Open Domino’s with my order guide.”
Always: “Review the official cart and complete payment yourself.”

- [ ] **Step 6: Run local and preview checks**

```powershell
npm run test:gatherbite-final
npx tsc --noEmit
npm run lint
npm run build
```

Verify success or honest fallback locally and in preview. Stop before payment.

- [ ] **Step 7: Commit after approval**

```powershell
git add src/lib/cart/prepareCart.ts src/lib/cart/prepareCart.test.ts src/app/api/gatherbite/cart/prepare/route.ts src/components/CartPreparation.tsx src/components/DecisionReview.tsx src/app/page.tsx src/lib/gatherbite-final.test.ts
git commit -m "feat: verify and hand off the official Domino's cart"
```

---

## Phase 4 — Reliability, Live Proof, Deployment, and Stop Condition

### Task 17: Evaluate verifier models and protect latency/privacy

**Files:**
- Create: `src/lib/agents/verifierEval.ts`
- Create: `src/lib/agents/verifierEval.test.ts`
- Create: `scripts/run-verifier-eval.ts`
- Create: `scripts/check-gatherbite-live.ts`
- Modify: `package.json`
- Modify: `src/lib/gatherbite-final.test.ts`

**Interfaces:**
- Consumes: fixed candidates/evidence and deployed URL.
- Produces: deterministic guard suite, opt-in model equivalence report, and privacy-safe timing check.

- [ ] **Step 1: Define fixed eval cases**

Include valid candidates; each hard failure; combined failures; stale/unknown evidence; malformed output; adversarial IDs; preference conflict; insufficient protected slices; over-budget; unavailable/serviceability failure.

- [ ] **Step 2: Implement deterministic tests**

Assert expected decision/disposition and zero false approvals from the guard. These run without network.

- [ ] **Step 3: Implement opt-in live model runner**

Run repeated cases against current and faster proposed model. Print case ID, expected/actual decision, schema success, latency, and usage only. Exit non-zero on false approval, fail-open unknown, disposition mismatch, or worse schema reliability.

- [ ] **Step 4: Implement deployed timing check**

POST a user-supplied safe request and print `Server-Timing`, total duration, option count, and public decision sequence. Keep address in memory and out of output.

- [ ] **Step 5: Add scripts**

```json
"eval:verifier": "tsx scripts/run-verifier-eval.ts",
"test:live": "tsx scripts/check-gatherbite-live.ts"
```

Do not append either network script to `npm test`.

- [ ] **Step 6: Select model from evidence**

Keep `openai/gpt-oss-120b` unless the faster model has zero false approvals, equivalent fail-closed behavior, reliable schemas, and materially lower deployed latency.

- [ ] **Step 7: Commit after approval**

```powershell
git add src/lib/agents/verifierEval.ts src/lib/agents/verifierEval.test.ts scripts/run-verifier-eval.ts scripts/check-gatherbite-live.ts package.json src/lib/gatherbite-final.test.ts
git commit -m "test: evaluate verifier accuracy and latency"
```

### Task 18: Lock the real Magic Pass, deployment, and product documentation

**Files:**
- Create: `docs/demo/gatherbite-demo-runbook.md`
- Create: `docs/deployment/gatherbite-production-checklist.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: preview deployment, live data, selected cart mode, model eval, and timing scripts.
- Produces: reproducible normal request, safe fallback path, deployment config, and judge/user-facing truth.

- [ ] **Step 1: Find a normal live request**

Use main-page inputs and current public data. Favor non-obvious evidence unavailable to Planner: curated topping evidence, protected-slice shortage, configuration price, or serviceability. Never instruct Planner to make a bad candidate.

- [ ] **Step 2: Meet the rehearsal criterion**

Complete five consecutive deployed runs:

```text
real input → live candidate → REJECT → evidence → Planner adaptation
→ APPROVE → recommendation → selection → cart/fallback handoff
```

If data changes, find/revalidate another ordinary request. Never add a preset or fake event.

- [ ] **Step 3: Write the runbook**

Record entered values, expected public events/result range, cart mode, timings, no-viable recovery request, public-data/dietary wording, and payment stop.

- [ ] **Step 4: Write deployment checklist**

Include server-only `GROQ_API_KEY`, optional `GATHERBITE_VERIFIER_MODEL`, approved browser variables, preview/production URLs, Node runtime, host duration, stream check, cart capability, secret scan, and guided-fallback rollback.

- [ ] **Step 5: Update README**

Document product purpose, architecture, setup, deterministic/live commands, public-data wording, human boundary, provider/capacity limits, and isolated Eve experiment. Remove Night Shift as product identity.

- [ ] **Step 6: Review against rubric/Q&A**

Cover agent need, solver boundary, public endpoint risk, dietary trust, no-viable behavior, bounded retries, cart truth, payment boundary, provider extensibility, framework choice, and Planner contribution.

- [ ] **Step 7: Commit after approval**

```powershell
git add docs/demo/gatherbite-demo-runbook.md docs/deployment/gatherbite-production-checklist.md README.md
git commit -m "docs: lock GatherBite production demo and deployment"
```

### Task 19: Complete independent review and final verification

**Files:**
- Modify only paths required by reproduced review findings.
- Verify: repository plus preview/production flow.

**Interfaces:**
- Consumes: Tasks 1–18.
- Produces: reviewed, tested, deployed GatherBite and completion evidence.

- [ ] **Step 1: Request architecture/code review**

Invoke `superpowers:requesting-code-review`. Target authority separation, stale evidence, fail-open behavior, duplicate fetches, retry caps, PII, client tampering, and irreversible browser actions.

- [ ] **Step 2: Process findings**

Invoke `superpowers:receiving-code-review`. Reproduce accepted findings with failing tests before fixes. Reject scope/safety regressions with evidence.

- [ ] **Step 3: Run the clean-worktree gate**

```powershell
npx tsc --noEmit
npm run test
npm run lint
npm run build
git diff --check
git status --short
```

Expected: exit 0; only intentional reviewed changes.

- [ ] **Step 4: Run deployed live checklist**

```text
[ ] Carryout against both supported stores
[ ] Valid Delivery serviceability
[ ] Invalid Delivery fails honestly
[ ] Either may select Carryout when Delivery fails
[ ] Current menu/deal/configuration parses
[ ] Wait shown or Unknown
[ ] At least one live fully approved option
[ ] Five consecutive genuine Magic Pass runs
[ ] Selection can change
[ ] Exact review is correct
[ ] Cart prepared/verified or fallback honest
[ ] CAPTCHA/login/session hands off safely
[ ] Desktop/mobile/keyboard/reduced-motion pass
[ ] No payment/submission
```

- [ ] **Step 5: Record performance**

Record live observation, Planner, Verifier, evidence, adaptation, total evaluation, and cart times. Target approximately six seconds for warm clean approval and twelve seconds for reject/adapt. Present deviations for explicit acceptance rather than hiding them.

- [ ] **Step 6: Verify before completion**

Invoke `superpowers:verification-before-completion`; rerun commands fresh and cite actual output.

- [ ] **Step 7: Report**

Use exactly:

```text
BUILT
TESTED
LIVE CHECKS
TIMING
CART MODE
KNOWN LIMITATIONS
FILES CHANGED
NEXT
```

When every done condition is met, `NEXT` says: “Stop building for the judged demo.”

- [ ] **Step 8: Offer branch completion choices**

Invoke `superpowers:finishing-a-development-branch`. Do not merge, commit, or remove worktrees without explicit user choice.

---

## Traceability

| Requirement | Tasks |
|---|---|
| Recoverable checkpoint | 1 |
| Bounded cart/session investigation and fallback | 2, 14–16 |
| Final input, Either, conditional address | 3, 12 |
| No unrestricted-headcount inference | 3, 6, 10, 12 |
| Configurable live catalogue | 5 |
| Official serviceability/all-in pricing | 5, 7 |
| Protected dietary allocation and soft preferences | 6, 7 |
| Separate Verification Agent/exact tools | 7, 8 |
| Planner cannot approve; bounded adaptation | 9 |
| Recommendation plus alternatives | 10, 13 |
| No Little Caesars in normal flow | 10, 13 |
| Actual progress without chain-of-thought | 4, 11, 13 |
| Human decision and exact review | 13 |
| Actual-cart comparison/payment boundary | 14–16 |
| Faster model only after proof | 17 |
| Genuine no-preset Magic Pass | 18 |
| Full automated/live/deployment verification | 19 |

## Execution Order and Review Gates

Execute strictly in numeric order. Stop for review after Tasks 2, 5, 9, 11, 13, 16, and 19. Task 2 selects a cart capability but never removes guided fallback. Task 15 follows the evidence-backed branch. No production UI cart claim is enabled before Task 16 verifies actual behavior.
