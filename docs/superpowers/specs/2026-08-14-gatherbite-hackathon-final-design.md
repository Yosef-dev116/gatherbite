# GatherBite Hackathon Final Design

**Status:** Approved design
**Date:** 2026-08-14
**Product:** GatherBite
**Core line:** “GatherBite — the AI agent that figures out how to feed your group.”

## 1. Purpose

GatherBite solves the group-food coordination problem that comes before checkout. An organizer describes the group once, including attendance, budget, dietary needs, preferences, and fulfilment intent. GatherBite observes current restaurant data, proposes concrete orders, independently verifies hard constraints, adapts rejected candidates, recommends the best verified option, and prepares the selected restaurant cart as far as legitimately possible. The organizer remains responsible for final review, payment, and order submission.

The hackathon implementation remains pizza-first because pizza is the only food category with a trusted serving-capacity model. Domino’s is the primary final-demo provider because the project already has live public store, menu, deal, price, availability, and wait data for supported PEI stores.

The central product principle is:

> The AI proposes. It doesn’t decide blindly.

The memorable demo moment is a real candidate that looks plausible, is rejected by an independent Verification Agent using exact evidence, is adapted by the Planner Agent, and then passes.

## 2. Design inputs and judging constraints

This design treats the supplied hackathon judging rubric as an explicit product constraint:

- **Agent design:** purposeful multi-step planning, appropriate tools, and bounded loops.
- **Problem fit:** a real organizer problem that would be useful outside the hackathon.
- **Technical execution:** a live end-to-end workflow with rate-limit, retry, and bad-input handling.
- **Honesty and guardrails:** sourced evidence, visible uncertainty, and a stop before irreversible action.
- **Demo and story:** one memorable, understandable rejection-and-recovery moment.

The hackathon inspiration materials also reinforce a browser runner that performs reversible work but stops before irreversible confirmation. The HireFlow reference project contributes the following browser-execution patterns:

- prepare structured data before opening the browser;
- use the official/owner-controlled site;
- inspect fresh page state before and after every meaningful action;
- treat the visible official page as the source of truth;
- isolate one browser session per task;
- bound retries and recovery cycles;
- stop immediately for CAPTCHA, failed authentication, or session failure;
- never submit the final irreversible action;
- keep credentials and browser state disposable and out of Git.

## 3. Current baseline and preservation requirements

The repository is based on historical commit `6564ea2`, with substantial known-working uncommitted improvements after that commit. Those changes must be preserved. They currently include:

- a unified GatherBite main page;
- a production Vercel AI SDK `ToolLoopAgent` using Groq;
- a bounded Little Caesars proposal/verification loop;
- live Domino’s store/menu/deal data;
- curated Domino’s dietary evidence;
- deterministic pizza capacity, budget, dietary, scoring, and normalization logic;
- provider result cards, selection, and final review;
- performance instrumentation and concurrent provider fetches;
- an isolated Eve spike under `/agent`;
- 297 passing production tests, clean typecheck, lint, build, and diff checks at the last verified baseline.

The implementation must not reset to `6564ea2`, delete the working Little Caesars engine, or migrate production to Eve.

## 4. Scope decomposition

The final work is intentionally split into four sequential specifications rather than one large implementation:

1. **Domino’s cart/session feasibility**
   - Establish what the deployed GatherBite app can legitimately prepare and transfer.
   - Determine official serviceability, product configuration, quote, cart, and session behavior.
   - Produce a hard go/no-go result for each execution tier.

2. **Planner–Verifier architecture and Domino’s candidates**
   - Implement the separate Planner and Verification Agent responsibilities.
   - Add exact evidence tools, candidate manifests, preferences, service intent, serviceability, retries, and ranking.

3. **Cart preparation or strongest legitimate fallback**
   - Implement the best proven execution tier.
   - Compare the actual cart against the approved manifest.
   - Fall back automatically and honestly when full preparation is not transferable.

4. **Domino’s-first UX, Magic Pass, deployment, and stabilization**
   - Simplify the main journey.
   - Make real rejection/adaptation visible.
   - Rehearse the deployed flow, complete review gates, and stop building.

Later specifications may not assume an earlier feasibility question succeeded.

## 5. Product scope

### 5.1 In scope

- Domino’s-first group pizza planning.
- People, maximum budget, dietary groups, optional pizza preferences, fulfilment intent, and delivery address where required.
- Delivery, Carryout, or Either, defaulting to Either.
- Live public Domino’s data for supported stores.
- A separate Planner Agent and Verification Agent.
- Exact evidence tools for hard facts and arithmetic.
- Bounded rejection/adaptation.
- One recommended verified option with other verified alternatives retained.
- Cart preparation through a legitimate official customer flow where feasible.
- A strong exact-order fallback where full cart/session handoff is not feasible.
- Human selection, review, payment, and final submission.

### 5.2 Out of scope

- Pizza Pizza, Uber Eats, Skip, DoorDash, or additional providers.
- Arbitrary non-pizza meal-capacity models.
- New dietary restriction types.
- Authentication or organization administration.
- A database unless a proven cart mechanism strictly requires durable state.
- Notifications.
- Payment automation or order submission.
- CAPTCHA solving, access-control bypass, cookie injection, or anti-bot circumvention.
- An Eve or Mastra production migration.
- A polling or voting system.
- A manual pizza/cart builder.
- A demo preset or staged rejection in the main UI.
- Unrelated refactors or decorative dependencies.

## 6. Provider strategy

Domino’s is the sole provider shown in the normal final user experience. Little Caesars remains in the repository as fallback and provider-extensibility evidence, with its existing agent, verification, scoring, and debug paths preserved. The main GatherBite route does not spend Little Caesars model latency when evaluating the Domino’s-first experience.

The product describes Domino’s integration accurately as **live public data**. It does not claim a formal partnership or supported third-party integration.

The supported PEI stores currently include:

- Store 10950, 386 University Ave, Charlottetown.
- Store 10953, 14 Kinlock Rd Unit 11, Stratford.

Store eligibility for delivery must ultimately come from the tested official serviceability flow, not distance inference or a hardcoded assumption.

## 7. Agent architecture

### 7.1 High-level flow

```text
Organizer requirements
        ↓
GatherBite Planner Agent
        ↓
Live Domino’s observation tools
        ↓
Structured candidate order
        ↓
verifyCandidate delegation tool
        ↓
Separate Verification Agent/model invocation
        ↓
Exact evidence tools
        ↓
APPROVE or REJECT
        ↓
Planner adapts or approved options are ranked
        ↓
Human selects
        ↓
Cart preparation
        ↓
Expected-cart versus actual-cart verification
        ↓
Human reviews and pays
```

The selected architecture is **verifier-as-tool delegation**. The top-level Vercel AI SDK `ToolLoopAgent` remains the Planner/Orchestrator. Its `verifyCandidate` tool executor invokes a genuinely separate Verification Agent/model call.

### 7.2 Planner Agent responsibilities

The Planner Agent may:

- read organizer requirements;
- call live Domino’s observation tools;
- inspect raw store, menu, product, topping, deal, price, availability, and wait facts;
- propose complete candidate manifests;
- receive structured verifier rejections;
- adapt candidate quantities, configurations, deals, stores, or service methods;
- propose an optional meaningful alternative;
- explain preference tradeoffs using verified results.

The Planner Agent may not:

- approve its own candidate;
- call the Verifier’s hard-constraint evidence tools directly;
- declare dietary compatibility, capacity sufficiency, budget correctness, availability, serviceability, or final verification;
- upgrade a rejected or unknown result;
- silently relax dietary requirements or other hard constraints.

### 7.3 Verification Agent responsibilities

The Verification Agent is a separate model invocation for each candidate. It must:

- inspect one complete, versioned candidate;
- call the exact evidence tool before deciding;
- independently review all hard evidence;
- return structured `APPROVE` or `REJECT`;
- identify whether a rejection supports order adaptation, another store, or a terminal stop;
- return concrete evidence and reasons to the Planner.

Only the Verification Agent may return `APPROVE` or `REJECT`.

The model does not perform arithmetic or infer ingredient facts. It interprets typed evidence returned by exact tools. A fail-closed protocol guard may veto an internally inconsistent approval, but it can never create an approval by itself.

### 7.4 Verification result

The conceptual result is:

```ts
interface VerificationDecision {
  candidateId: string;
  candidateVersion: number;
  snapshotVersion: string;
  decision: "APPROVE" | "REJECT";
  disposition: "ADAPT_ORDER" | "TRY_ANOTHER_STORE" | "TERMINAL";
  checks: {
    menuIntegrity: EvidenceCheck;
    dietary: EvidenceCheck;
    capacity: EvidenceCheck;
    budget: EvidenceCheck;
    availability: EvidenceCheck;
    serviceability: EvidenceCheck;
  };
  preference: PreferenceEvidence;
  reasons: string[];
  unknowns: string[];
}
```

Malformed, stale, or evidence-inconsistent output becomes a system-level verifier error or unknown result. It never becomes approval.

## 8. Evidence architecture

The Verification Agent receives a single typed tool such as:

```text
gatherCandidateEvidence(candidateId, candidateVersion)
```

The tool fans out internally to separately tested exact functions:

```text
menu/configuration integrity ──┐
dietary coverage ──────────────┤
pizza capacity ────────────────┤
budget and pricing ────────────┼─→ immutable evidence bundle
availability ──────────────────┤
delivery serviceability ───────┤
service/deal eligibility ──────┘
```

Independent checks run concurrently with `Promise.allSettled`. A failed check remains explicit `UNKNOWN` evidence.

The evidence tool provides exact facts and per-check states but not the aggregate final verdict. Approval remains a Verification Agent responsibility.

### 8.1 Hard approval rule

A candidate may be approved only when all applicable hard checks have trustworthy passing evidence:

- every referenced product and configuration exists in the observed menu;
- every dietary group has enough allocated compatible pizza slices;
- the complete order has at least three trusted pizza slices per attendee;
- the relevant total is within budget;
- the store is open and online;
- the selected service method is enabled and applicable to the deal;
- delivery serviceability is proven when delivery is selected;
- the candidate and evidence use the same immutable snapshot version.

Preferences do not participate in approval.

## 9. Candidate manifest

The Planner proposes a cart-executable manifest rather than a coupon description:

```ts
interface DominosCandidate {
  candidateId: string;
  candidateVersion: number;
  snapshotVersion: string;
  storeId: string;
  serviceMethod: "delivery" | "carryout";
  dealCodes: string[];
  pizzas: Array<{
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
  }>;
  expectedPricing: {
    subtotalCad: number | null;
    taxCad: number | null;
    feesCad: number | null;
    totalCad: number | null;
  };
}
```

Exact identifiers may be refined by the feasibility investigation, but these invariants remain:

- deal application and pizza configuration are separate;
- every pizza uses real store-specific identifiers;
- a coupon does not imply toppings;
- missing values remain unknown;
- ambiguous multi-pizza bundles do not receive inferred capacity;
- non-pizza items cannot satisfy feeding capacity.

## 10. Candidate construction semantics

The Planner constructs candidates in this order:

1. Select an eligible store and service method.
2. Configure dietary-protected pizzas.
3. Allocate sufficient trusted slices to each dietary group.
4. Fill the remaining total-capacity gap with general pizzas.
5. Apply optional preferences only to general pizzas.
6. Fit the configurations into applicable live deals.
7. Submit the complete candidate for independent verification.

GatherBite never calculates an unrestricted attendee count as total attendees minus summed dietary groups. Separate dietary groups may conceptually overlap because attendee identities do not exist in the schema.

For conservative capacity accounting, a protected slice is not double-allocated between separate groups. This may order more protected food than an identity-aware system would, but it avoids underfeeding when groups are distinct. Protected slices also count once toward total group capacity.

Within one group, all restrictions use AND semantics. Separate groups are not merged automatically into one combined restriction set.

## 11. Dietary evidence

The existing curated Domino’s Canada dietary evidence model remains authoritative for supported restrictions:

- Vegetarian
- Vegan
- Gluten-Friendly
- Dairy-Free
- No Pork
- No Beef
- No Chicken
- No Egg
- No Soy
- No Mustard

Evidence states remain:

- `SAFE`
- `CONTAINS`
- `MAY_CONTAIN`
- `UNKNOWN`

Only `SAFE` satisfies a restriction. `CONTAINS`, `MAY_CONTAIN`, `UNKNOWN`, an unrecognized component, an unproven customization, or missing component data fails closed.

Every protected pizza is evaluated across its selected crust, sauce, cheese or proven cheese removal, toppings, and the group’s complete restriction set.

“Gluten-Friendly” is not a celiac-safety or medical-allergy guarantee. The UI and pitch must not make unsupported medical claims.

Free-text notes such as “no mushrooms” may guide exact configuration, but they do not create new medical restriction types. Unconfirmed notes are labelled as such.

## 12. Pizza preferences

The optional organizer preferences are:

- Cheese
- Pepperoni
- Veggie
- Meat lovers

The existing internal `meatHeavy` identifier may remain temporarily for backward compatibility while the user-facing label changes to “Meat lovers.”

A deterministic preference configurator maps intent to current live product and topping identifiers:

| Preference | Supported intent translation |
|---|---|
| Cheese | A live cheese/default-cheese pizza configuration without inferred specialty toppings |
| Pepperoni | A live Pepperoni or explicitly supported pepperoni topping code |
| Veggie | Available vegetable toppings such as onions, green peppers, mushrooms, tomatoes, spinach, or olives |
| Meat lovers | Multiple explicitly identified live meat toppings such as pepperoni, sausage, bacon, or beef |

These are taste mappings, not dietary claims. “Veggie” does not prove vegetarian compatibility, and “Meat lovers” does not infer species or allergen safety.

The configurator:

- uses only current live products and topping codes;
- never assumes a coupon already contains a topping;
- never modifies a dietary-protected pizza;
- distributes multiple preferences automatically across general pizzas;
- chooses quantities, sizes, deals, and configurations without exposing a cart builder;
- returns structured preference-fulfilment evidence.

If no preference is supplied, GatherBite optimizes approved configurations for value, capacity fit, configuration simplicity, and available wait evidence.

If a preference is unavailable, deal-incompatible, dietary-incompatible, or too expensive, the otherwise valid candidate survives and the limitation is explained.

## 13. Service method and address semantics

The organizer selects:

- Delivery
- Carryout
- Either, as the default

Delivery and Either collect the minimum address fields required by the proven official serviceability mechanism. Carryout does not require a delivery address. Fixed context such as province or country should not become unnecessary input.

Delivery approval requires:

- official serviceability evidence for the address and store;
- open and online store status;
- delivery enabled;
- delivery-compatible deal and configuration.

Carryout approval requires:

- open and online store status;
- carryout enabled;
- carryout-compatible deal and configuration.

Either produces method-specific candidates. An unserviceable delivery candidate does not reject an otherwise valid carryout candidate. Unknown delivery serviceability is not treated as deliverable.

Wait time is displayed when known. Because no deadline is currently a user constraint, unknown wait time does not itself reject an otherwise available candidate. Unknown availability does reject.

## 14. Budget semantics

Budget is a hard constraint and refers to the relevant order total. Approval requires supported evidence for applicable components:

- configured products and discounts;
- quantity;
- taxes;
- delivery or service fees;
- minimum-order conditions.

A coupon subtotal alone is not described as a proven all-in total. If delivery fees or other required components cannot be established, the budget check remains unknown and the candidate cannot receive full approval.

For Either, GatherBite may prefer a fully priced carryout candidate over delivery with unknown fees. The feasibility investigation must determine whether an official quote or real cart can supply missing price evidence.

## 15. Ranking and recommendation

Only approved candidates enter ranking. The deterministic ordering is:

1. greater confirmed preference representation;
2. lower verified total;
3. less excess pizza capacity;
4. known wait over unknown wait;
5. shorter comparable maximum wait;
6. stable store/candidate identifier as the final tie-breaker.

The best option is visually recommended with a short evidence-backed reason. It is not automatically selected. All other approved alternatives remain available beneath it.

Rejected and insufficient-data store candidates remain accessible under secondary disclosure without cluttering the organizer’s primary decision.

## 16. Latency and retry design

### 16.1 Shared live observation

At request start, GatherBite creates one request-scoped immutable Domino’s observation promise covering eligible stores and required live facts. The Planner’s observation tool awaits that existing promise. Verification reuses the same versioned data rather than fetching it again.

- Store observations run concurrently.
- Profile and menu fetches remain concurrent per store.
- Dietary evidence and normalized product/topping indexes are built once.
- Live availability, waits, serviceability, and prices are not hidden behind a long-lived cache.
- Static curated dietary evidence may remain process-cached because it is repository-versioned data.

### 16.2 Candidate and model budgets

- At most two initial ordered candidates.
- At most two initial verifier invocations concurrently.
- At most one Planner adaptation generation.
- At most three Verification Agent invocations during evaluation.
- No verifier invocation without a complete candidate.
- No retry after approval.
- No blind retry for a hard rejection.
- No further adaptation after request-level terminal impossibility.

### 16.3 Technical retry behavior

Technical failures are separate from candidate rejection:

- one short retry for transient live-data or model transport failure;
- respect provider retry timing when supplied;
- retry the same immutable input;
- one structured-output repair attempt for malformed verifier output;
- a second failure returns verifier error or insufficient data;
- no blind retry for CAPTCHA, authentication, anti-bot, or cart-session barriers;
- a hard deadline prevents a hung demo request.

### 16.4 Model choice

The proven Planner model is initially used for both agents. A faster secondary verifier model is adopted only if repeated evaluation shows:

- zero false approvals;
- equivalent hard-constraint verdicts;
- equivalent fail-closed unknown behavior;
- reliable structured output;
- no degradation in rejection/adaptation cases;
- materially lower deployed latency.

Accuracy takes precedence over speed.

### 16.5 Performance targets

Targets are validated deployment outcomes, not assumed guarantees:

- live observation approximately 1.5 seconds or less;
- normal warm approval approximately 6 seconds or less;
- genuine rejection/adaptation approximately 12 seconds or less;
- deterministic evidence processing negligible relative to network/model work;
- no Little Caesars model invocation in the normal main route.

## 17. Observability

Instrumentation covers:

- live-data total and per-store duration;
- Planner rounds;
- each Verification Agent invocation;
- evidence tool total and individual check durations;
- adaptation;
- normalization and ranking;
- total evaluation;
- cart preparation separately.

Timing headers and logs omit delivery addresses, browser sessions, credentials, cookies, and unnecessary dietary detail. UI events expose only real tool actions, candidate summaries, evidence outcomes, and structured decisions—never private reasoning.

## 18. Cart execution

### 18.1 Human boundaries

The first human action selects an approved option and authorizes reversible cart preparation. The second human boundary is final review, payment, and order submission on Domino’s.

### 18.2 Execution priority

The feasibility spike tests, in order:

1. a supported transferable official cart or session;
2. the official browser flow with legitimate secure human takeover;
3. a supported store/service/coupon deep link;
4. an exact guided-order handoff.

Full cart preparation is successful only if the deployed GatherBite app can prepare the cart and let the organizer continue in that exact official customer session. A server-only cart that cannot be inherited is not success.

### 18.3 Cart Execution Agent

If browser interaction is required, a narrow Cart Execution Agent is justified as a genuine specialist. It receives only the approved immutable manifest, the official starting URL, an ephemeral session, and safe browser tools.

It may select the service method and store, provide the already-approved address, apply deals, add and configure exact pizzas, inspect the cart, and correct its own reversible execution mistakes.

It may not change the plan, substitute products, reinterpret dietary needs, accept price changes, enter payment details, or submit the order.

A guarded browser wrapper exposes safe intents and blocks controls whose semantic purpose or page context indicates payment, purchase confirmation, or final order submission.

### 18.4 Snapshot-driven browser workflow

```text
Inspect current official page
→ perform one meaningful action
→ obtain fresh page state
→ verify the expected transition
→ continue
```

Fresh state is required after service selection, address submission, store selection, coupon application, pizza addition, configuration changes, redirects, dynamic page updates, and cart navigation.

### 18.5 Execution limits

- one ephemeral browser session per organizer-triggered preparation;
- one initial build;
- at most one corrective rebuild;
- at most three inspect–act–recheck attempts per recoverable step;
- immediate stop for CAPTCHA or access-control barriers;
- hard wall-clock deadline;
- no automatic restart when existing state can be verified and resumed.

This second user-triggered phase has a separate bounded recovery budget from evaluation.

## 19. Actual-cart verification

The official cart is normalized into an immutable observation containing:

- store;
- service method;
- configured items and quantities;
- coupon codes;
- subtotal, taxes, fees, and total;
- observation timestamp.

A deterministic comparator checks the actual cart against the approved manifest across store, method, product, size, crust, sauce, cheese, toppings, quantity, deal, capacity, dietary configuration, price, fees, total, and budget.

The actual-cart evidence then receives a fresh Verification Agent verdict. The UI says “Cart prepared and verified” only after that approval.

GatherBite never silently accepts a mismatch. It may correct one clear execution mistake. Otherwise it stops, shows the exact difference, and either returns evidence to the Planner for a bounded re-plan and re-verification or activates the fallback.

## 20. Cart fallback

If transferable cart preparation is not legitimate or reliable, GatherBite deploys the strongest proven handoff:

- official store-specific order destination where supported;
- selected service method;
- verified store and address;
- exact deals and coupon codes;
- exact pizza quantities and configurations;
- one-click copy for the entire order;
- per-line copy controls;
- a short ordered checklist matching the official site;
- visible verified price evidence and explicit unknown components;
- a primary “Open Domino’s with my order guide” action.

Fallback wording states exactly what was preselected and what remains. It never says the cart is prepared when it is not.

Structured cart states include prepared and verified, needs human login, needs human CAPTCHA, cart mismatch, non-transferable session, unavailable automation, timeout, and fallback ready.

## 21. Privacy and security

- Delivery addresses are collected only for Delivery or Either.
- Addresses are sent only to services necessary for serviceability or execution.
- Use of an external browser provider must be disclosed because the address would pass through it.
- Browser state and sessions are ephemeral and isolated.
- No address, cookie, token, credential, or payment data enters logs or Git.
- Guest checkout is preferred.
- GatherBite does not collect Domino’s credentials.
- CAPTCHA, authentication failure, and anti-bot systems trigger human handoff rather than bypass.
- No payment data is entered and no order is submitted automatically.

## 22. Domino’s-first UX

### 22.1 Main form

The main page asks only for people, maximum total budget, fulfilment intent, conditional delivery address, optional dietary groups, and optional preferences.

Defaults:

- Either service method;
- no dietary groups;
- no preferences;
- no preloaded demo attendee count, budget, or address.

Suggested preference prompt:

> What does your group like? Optional — pick any. GatherBite chooses the pizzas, quantities, deals, and configurations.

The primary CTA is “Find my verified order.”

The main page removes Night Shift framing, Little Caesars references, fixed supported-store prose, implementation explanations, and debug navigation.

### 22.2 Honest evaluation progress

The UI displays actual lifecycle stages:

- checking address and live stores;
- reading current menus and deals;
- Planner proposed a candidate;
- independent Verification Agent checking evidence;
- adjusting after rejection;
- comparing verified options.

A thin typed event stream may deliver real events as they occur while retaining the existing JSON result contract as a fallback. There are no fake progress percentages, invented reasoning messages, or artificial delays.

### 22.3 Magic Pass

The rejected candidate remains visible with the concrete evidence that prevented ordering. The UI then shows that the Planner received the evidence, changed the order, and sent a new candidate to the independent Verifier.

Only actual candidate manifests, tool events, evidence, and structured verdicts are shown. The rejection is framed as protection, not an application error.

If the first candidate passes, GatherBite shows a clean approval. It never manufactures a rejection.

There is no preset or hidden demo mode. A private developer runbook records one ordinary request that repeatedly produces a genuine Domino’s rejection and adaptation using current live data. The scenario must be revalidated before judging and must pass five consecutive deployed rehearsals.

### 22.4 Results hierarchy

One dominant “GatherBite recommends” card shows:

- store and address;
- service method;
- exact order;
- verified total or clearly labelled limitation;
- relevant wait;
- capacity;
- dietary result;
- preference handling;
- a short recommendation reason.

Hard checks use compact visible statuses:

```text
Capacity ✓   Dietary ✓   Budget ✓   Availability ✓
```

Details are expandable. Other approved options sit beneath “See other verified options.” Rejected and insufficient-data stores remain under “What else GatherBite checked.”

If nothing passes, the UI explains the primary blocker and safe next actions without weakening dietary constraints automatically.

### 22.5 Your decision

The recommended option is not automatically selected. Selecting any approved option visibly marks it and opens a final review containing the exact configured order, store, method, total, capacity, dietary allocation, preference result, and wait.

The organizer can change the selection.

The primary action is “Prepare my Domino’s cart.” After successful actual-cart verification, it becomes “Continue to Domino’s checkout.” If fallback is active, it becomes “Open Domino’s with my order guide.”

The human-control message remains concise: the organizer reviews the official cart and completes payment.

### 22.6 Visual design and accessibility

The existing warm palette, rounded cards, typography, and status colors remain. The goal is simplification and hierarchy rather than redesign.

Useful CSS transitions communicate candidate arrival, rejection, adaptation, approval, selection, final-review expansion, and cart state. They last roughly 150–250 ms, never delay the workflow, and respect `prefers-reduced-motion`. Anime.js is added only if CSS cannot express a required state transition.

The experience is one-column on mobile, keyboard-accessible, text-labelled rather than color-only, and uses polite live-region announcements for evaluation progress.

## 23. Error handling

Errors are classified by responsibility:

- **Input error:** concise organizer-facing correction.
- **Live observation failure:** explicit store/provider unknown, never guessed.
- **Candidate rejection:** concrete evidence and retry disposition.
- **Verifier transport/schema failure:** one repair/retry, then fail closed.
- **Terminal impossibility:** stop and explain the unresolved constraint.
- **Cart execution mistake:** one bounded correction.
- **Cart mismatch:** stop, show the difference, and re-plan only within budget.
- **CAPTCHA/login/session blocker:** request human takeover or activate fallback.
- **Infrastructure timeout:** preserve verified order and activate fallback.

No failure path silently purchases, substitutes, weakens a restriction, or hides unknown data.

## 24. Testing strategy

All existing 297 production tests remain required. New implementation follows test-driven development.

### 24.1 Unit coverage

Add focused tests for:

- conditional address and service-method validation;
- candidate and snapshot versioning;
- no inferred unrestricted-attendee count;
- conservative protected-slice allocation;
- live preference mapping and protected-line immutability;
- blank-preference autonomous optimization;
- exact dietary, capacity, budget, availability, and serviceability tools;
- `MAY_CONTAIN` and `UNKNOWN` fail-closed behavior;
- no non-pizza capacity;
- verifier protocol guard;
- no candidate/no verifier invocation;
- maximum candidate and retry budgets;
- approved-only ranking with retained alternatives;
- unknown-preserving normalization;
- expected-versus-actual cart comparison;
- irreversible-action browser guard;
- CAPTCHA, login, timeout, and session states;
- privacy-safe logging.

### 24.2 Model evaluation

Evaluate the Verification Agent with valid cases, every hard failure, combined failures, stale and unknown evidence, malformed tool output, adversarial identifiers, tempting preference conflicts, insufficient protected slices, over-budget totals, and unavailable stores.

The faster verifier model requires zero false approvals and equivalent fail-closed behavior over repeated runs.

### 24.3 Integration coverage

Using immutable fixtures, verify:

- one live observation per request;
- concurrent store observations and evidence checks;
- valid first-pass approval;
- rejection, feedback, adaptation, and approval;
- terminal stop;
- Either falling back from unserviceable delivery to carryout;
- best recommendation with retained alternatives;
- Domino’s-only main results;
- Little Caesars remaining independently valid.

### 24.4 Live coverage

Network-dependent tests remain separate from deterministic `npm test`. The deployed checklist covers Carryout, valid and invalid Delivery, Either, live menu/deal parsing, wait display, one viable current order, cart or fallback, actual-cart comparison, mobile, reduced motion, and no purchase.

The Magic Pass scenario must pass five consecutive deployed rehearsals.

## 25. Deployment and quality gates

Use a preview deployment before the final demo deployment. Model and browser credentials remain server-only. Required Next.js runtime and duration settings must be verified against the installed Next 16 documentation before coding.

Browser execution must be proven from the deployed environment. If it is unavailable or non-transferable, the fallback must activate automatically; a half-working cart button is not shipped.

Final production verification is:

```text
npx tsc --noEmit
npm run test
npm run lint
npm run build
git diff --check
```

The isolated Eve experiment is not a production dependency or release gate.

## 26. Git and development workflow

Before major implementation:

1. inspect status and diff summary;
2. scan intended files for secrets;
3. confirm environment files and browser state are excluded;
4. rerun the baseline quality suite;
5. obtain explicit approval for a checkpoint commit;
6. create `checkpoint/gatherbite-unified-baseline` containing the known-working state;
7. create an isolated `feature/gatherbite-hackathon-final` branch/worktree;
8. execute the four specs sequentially with test and review checkpoints.

No automatic commit or reset occurs without the agreed checkpoint procedure. Parallel agents, if used, receive independent tasks and never modify the same state concurrently.

Before completion, use the Superpowers code-review and verification workflows. Final claims must cite fresh command output and deployed live checks.

## 27. Feasibility questions that remain intentionally open

These are investigation outputs, not permission to invent behavior:

- Which official address/serviceability flow can be called reliably from the deployed app?
- Which live identifiers fully specify product, variant, size, crust, sauce, cheese, and toppings?
- Can configuration-specific taxes, fees, and totals be quoted before cart creation?
- Is there a supported cart/deep-link/session mechanism that transfers to the organizer’s browser?
- Can a legitimate remote browser session be handed over securely?
- Which of Playwright, a remote browser provider, or an official deep link is the smallest reliable execution mechanism?
- Which normal live group request produces a repeatable, genuine Domino’s rejection/adaptation without staging?

Each question has a bounded investigation. Failure at a higher execution tier triggers the next legitimate fallback rather than stopping the project.

## 28. Definition of done

GatherBite is complete for the hackathon when:

1. Domino’s is the sole provider in the normal user journey.
2. Little Caesars remains intact but hidden from that journey.
3. Planner and Verification Agent are separate model invocations.
4. The Planner cannot approve its own candidate.
5. Only the Verification Agent returns `APPROVE` or `REJECT`.
6. Exact evidence tools own facts and arithmetic.
7. Unknown evidence fails closed.
8. Service method and delivery serviceability are real.
9. Preferences automatically configure only general pizzas.
10. Dietary-protected food cannot be displaced.
11. Capacity remains pizza-only and budget remains a hard gate.
12. One best verified option is recommended and alternatives remain visible.
13. A normal real request repeatedly produces the genuine Domino’s Magic Pass.
14. The organizer can select, review, and change an option.
15. Full cart preparation works legitimately, or the strongest proven fallback is deployed.
16. A prepared official cart is compared with the approved plan.
17. Payment and final submission remain human-controlled.
18. The main page is calm, concise, accessible, and mobile-friendly.
19. Evaluation meets accepted deployed latency targets.
20. Existing and new automated tests pass.
21. Critical live browser flows pass.
22. A recoverable Git checkpoint exists.
23. The production deployment and demo runbook are rehearsed.
24. The pitch can explain agent value, evidence, live-data limits, failure behavior, provider risk, and human control honestly.
25. No remaining work is required for the judged demo.

At that point, GatherBite stops adding features.
