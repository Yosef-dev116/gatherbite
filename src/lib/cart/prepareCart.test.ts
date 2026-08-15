import assert from "node:assert/strict";
import test from "node:test";

import type {
  CandidatePizza,
  DominosCandidate,
  GatherBiteInput,
  VerificationOutcome,
} from "../gatherbite/contracts";
import type { DominosObservationContext } from "../agents/dominosPlanner";
import type { DominosStoreSnapshot } from "../restaurants/dominos";
import { buildDominosCatalog } from "../restaurants/dominosCatalog";
import type { VerifyCandidateInput } from "../agents/dominosVerifier";
import type {
  ActualDominosCart,
  CartPreparationResult,
  DominosCartExecutor,
  PrepareCartInput,
} from "./contracts";
import { compareDominosCart } from "./dominosCartComparator";
import { buildGuidedHandoff } from "./dominosCartFallback";
import {
  InvalidCartCandidateError,
  prepareSelectedDominosCart,
  type CartEventSink,
  type PrepareCartDependencies,
} from "./prepareCart";

const FETCHED_AT = "2026-08-15T12:00:00.000Z";
const POST_FETCHED_AT = "2026-08-15T12:05:00.000Z";

function snapshot(fetchedAt: string): DominosStoreSnapshot {
  return {
    provider: "dominos",
    storeId: "10950",
    address: "386 University Ave, Charlottetown, PE",
    isOpen: true,
    isOnlineNow: true,
    deliveryAvailable: true,
    carryoutAvailable: true,
    deliveryWaitMinutes: { min: 14, max: 24 },
    carryoutWaitMinutes: { min: 9, max: 14 },
    deals: [{ code: "3021", name: "Deal", price: null, conditions: null, slices: null }],
    products: [{
      id: "S_PIZZA",
      name: "Pizza",
      category: "Pizza",
      toppings: ["Pizza Sauce", "Cheese"],
      defaultToppingCodes: ["X", "C"],
      variantCodes: ["12SCREEN"],
      priceInfoIfAvailable: 14.99,
    }],
    variants: [{
      code: "12SCREEN",
      productCode: "S_PIZZA",
      sizeCode: "12",
      crustCode: "HANDTOSS",
      priceCad: 14.99,
      trustedSlices: 8,
    }],
    toppingOptions: [
      { code: "X", name: "Pizza Sauce", category: "Sauce" },
      { code: "C", name: "Cheese", category: "Cheese" },
      { code: "P", name: "Pepperoni", category: "Topping" },
    ],
    fetchedAt,
    status: "ok",
    errors: [],
  };
}

/** A second, alternate-catalog snapshot with no explicit slice evidence for its variant. */
function snapshotWithUnknownSlices(fetchedAt: string): DominosStoreSnapshot {
  const base = snapshot(fetchedAt);
  return {
    ...base,
    variants: [{ ...base.variants![0]!, trustedSlices: null }],
  };
}

function observationFrom(storeSnapshot: DominosStoreSnapshot): DominosObservationContext {
  return {
    snapshots: [storeSnapshot],
    catalogs: new Map([[storeSnapshot.storeId, buildDominosCatalog(storeSnapshot)]]),
    serviceability: {
      status: "SERVICEABLE",
      applicability: "NOT_REQUIRED",
      storeIds: [],
      observedAt: storeSnapshot.fetchedAt,
      source: "Not applicable to carryout",
      reason: "A delivery address is not required for carryout.",
    },
    observedAt: storeSnapshot.fetchedAt,
  };
}

function twoStoreObservation(fetchedAt: string): DominosObservationContext {
  const first = snapshot(fetchedAt);
  const second: DominosStoreSnapshot = { ...snapshot(fetchedAt), storeId: "10953", address: "14 Kinlock Rd Unit 11, Stratford, PE" };
  return {
    snapshots: [first, second],
    catalogs: new Map([
      [first.storeId, buildDominosCatalog(first)],
      [second.storeId, buildDominosCatalog(second)],
    ]),
    serviceability: {
      status: "SERVICEABLE",
      applicability: "NOT_REQUIRED",
      storeIds: [],
      observedAt: fetchedAt,
      source: "Not applicable to carryout",
      reason: "A delivery address is not required for carryout.",
    },
    observedAt: fetchedAt,
  };
}

function pizza(overrides: Partial<CandidatePizza> = {}): CandidatePizza {
  return {
    lineId: "line-1",
    quantity: 2,
    productCode: "S_PIZZA",
    variantCode: "12SCREEN",
    sizeCode: "12",
    crustCode: "HANDTOSS",
    sauceCode: "X",
    cheeseCode: "C",
    toppings: [{ code: "P", quantity: 1 }],
    purpose: "general",
    protectsGroupIds: [],
    trustedSlicesPerPizza: 8,
    ...overrides,
  };
}

function candidate(overrides: Partial<DominosCandidate> = {}): DominosCandidate {
  return {
    candidateId: "cand-1",
    candidateVersion: 1,
    snapshotVersion: `10950:${FETCHED_AT}`,
    storeId: "10950",
    serviceMethod: "carryout",
    dealCodes: ["3021"],
    pizzas: [pizza()],
    expectedPricing: { subtotalCad: 22.5, taxCad: 3.38, feesCad: 0, totalCad: 25.88 },
    ...overrides,
  };
}

function organizerInput(): GatherBiteInput {
  return {
    attendees: 8,
    budgetCad: 100,
    serviceMethod: "carryout",
    groups: [],
    pizzaPreferences: [],
  };
}

function matchingActualCart(): ActualDominosCart {
  return {
    storeId: "10950",
    serviceMethod: "carryout",
    items: [{
      productCode: "S_PIZZA",
      variantCode: "12SCREEN",
      quantity: 2,
      sizeCode: "12",
      crustCode: "HANDTOSS",
      sauceCode: "X",
      cheeseCode: "C",
      toppings: [{ code: "P", quantity: 1 }],
    }],
    couponCodes: ["3021"],
    subtotalCad: 22.5,
    taxCad: 3.38,
    feesCad: 0,
    totalCad: 25.88,
    observedAt: POST_FETCHED_AT,
  };
}

function mismatchedActualCart(): ActualDominosCart {
  const cart = matchingActualCart();
  return { ...cart, storeId: "99999" };
}

function approveOutcome(theCandidate: DominosCandidate): VerificationOutcome {
  return {
    status: "DECIDED",
    decision: {
      candidateId: theCandidate.candidateId,
      candidateVersion: theCandidate.candidateVersion,
      snapshotVersion: theCandidate.snapshotVersion,
      decision: "APPROVE",
      disposition: "NONE",
      reasons: ["All hard checks passed."],
      unknowns: [],
    },
    evidence: {
      candidateId: theCandidate.candidateId,
      candidateVersion: theCandidate.candidateVersion,
      snapshotVersion: theCandidate.snapshotVersion,
      checks: {
        menuIntegrity: { status: "PASS", code: "MENU", summary: "ok", facts: {}, source: "test" },
        dietary: { status: "PASS", code: "DIETARY", summary: "ok", facts: {}, source: "test" },
        capacity: { status: "PASS", code: "CAPACITY", summary: "ok", facts: {}, source: "test" },
        budget: { status: "PASS", code: "BUDGET", summary: "ok", facts: {}, source: "test" },
        availability: { status: "PASS", code: "AVAILABILITY", summary: "ok", facts: {}, source: "test" },
        serviceability: { status: "PASS", code: "SERVICEABILITY", summary: "ok", facts: {}, source: "test" },
      },
      preference: { requested: [], represented: [], unmet: [] },
      collectedAt: POST_FETCHED_AT,
    },
  };
}

function rejectOutcome(theCandidate: DominosCandidate, reason: string): VerificationOutcome {
  const approved = approveOutcome(theCandidate);
  assert.equal(approved.status, "DECIDED");
  return {
    status: "DECIDED",
    decision: {
      candidateId: theCandidate.candidateId,
      candidateVersion: theCandidate.candidateVersion,
      snapshotVersion: theCandidate.snapshotVersion,
      decision: "REJECT",
      disposition: "TERMINAL",
      reasons: [reason],
      unknowns: [],
    },
    evidence: approved.evidence,
  };
}

function fakeExecutor(prepareImpl: (input: PrepareCartInput) => Promise<CartPreparationResult>): DominosCartExecutor {
  return { prepare: prepareImpl };
}

function executorObserving(actualCart: ActualDominosCart | null, handoffUrl: string | null = null): DominosCartExecutor {
  return fakeExecutor(async ({ candidate: expected }) => ({
    status: actualCart ? "PREPARED_AND_OBSERVED" : "AUTOMATION_UNAVAILABLE",
    actualCart,
    comparison: null,
    handoffUrl,
    fallback: buildGuidedHandoff(expected),
    reason: actualCart ? null : "No cart could be observed.",
  }));
}

interface TrackedDeps {
  deps: PrepareCartDependencies;
  calls: {
    refreshObservation: number;
    verifyCandidate: number;
    executorPrepare: number;
    verifyActualCart: number;
  };
}

function buildDeps(overrides: {
  preObservation?: DominosObservationContext | (() => Promise<DominosObservationContext>);
  postObservation?: DominosObservationContext;
  preVerifyOutcome?: (input: VerifyCandidateInput | null) => VerificationOutcome | Promise<VerificationOutcome>;
  executor?: DominosCartExecutor;
  postVerifyOutcome?: (input: VerifyCandidateInput | null) => VerificationOutcome | Promise<VerificationOutcome>;
} = {}): TrackedDeps {
  const calls = { refreshObservation: 0, verifyCandidate: 0, executorPrepare: 0, verifyActualCart: 0 };
  const preObservation = overrides.preObservation ?? observationFrom(snapshot(FETCHED_AT));
  const postObservation = overrides.postObservation ?? observationFrom(snapshot(POST_FETCHED_AT));
  let refreshCount = 0;

  const refreshObservation = async (): Promise<DominosObservationContext> => {
    calls.refreshObservation += 1;
    refreshCount += 1;
    if (refreshCount === 1) {
      return typeof preObservation === "function" ? preObservation() : preObservation;
    }
    return postObservation;
  };

  const verifyCandidate = async (
    verifyInput: VerifyCandidateInput | null,
  ): Promise<VerificationOutcome> => {
    calls.verifyCandidate += 1;
    if (overrides.preVerifyOutcome) return overrides.preVerifyOutcome(verifyInput);
    return verifyInput ? approveOutcome(verifyInput.candidate) : { status: "VERIFIER_ERROR", reason: "no candidate", evidence: null };
  };

  const verifyActualCart = async (
    verifyInput: VerifyCandidateInput | null,
  ): Promise<VerificationOutcome> => {
    calls.verifyActualCart += 1;
    if (overrides.postVerifyOutcome) return overrides.postVerifyOutcome(verifyInput);
    return verifyInput ? approveOutcome(verifyInput.candidate) : { status: "VERIFIER_ERROR", reason: "no candidate", evidence: null };
  };

  const executor = overrides.executor ?? fakeExecutor(async () => {
    throw new Error("executor.prepare should not be reachable in this test");
  });

  const wrappedExecutor: DominosCartExecutor = {
    prepare: async (executorInput) => {
      calls.executorPrepare += 1;
      return executor.prepare(executorInput);
    },
  };

  return {
    deps: {
      refreshObservation,
      verifyCandidate,
      executor: wrappedExecutor,
      compareCart: compareDominosCart,
      verifyActualCart,
    },
    calls,
  };
}

test("a malformed candidate never validates and execution never runs", async () => {
  const { deps, calls } = buildDeps({
    executor: fakeExecutor(async () => { throw new Error("must not run"); }),
  });

  await assert.rejects(
    () => prepareSelectedDominosCart({ not: "a candidate" }, organizerInput(), deps),
    InvalidCartCandidateError,
  );
  assert.equal(calls.refreshObservation, 0);
  assert.equal(calls.verifyCandidate, 0);
  assert.equal(calls.executorPrepare, 0);
});

test("full success: fresh pre-verify APPROVE, matching actual cart, fresh post-verify APPROVE -> PREPARED_AND_VERIFIED", async () => {
  const expected = candidate();
  const { deps, calls } = buildDeps({
    executor: executorObserving(matchingActualCart(), "https://www.dominos.ca/en/pages/order/?route=1&handoff=abc"),
  });
  const events: Array<{ type: string; message: string }> = [];
  const onEvent: CartEventSink = (event) => events.push(event);

  const result = await prepareSelectedDominosCart(expected, organizerInput(), deps, onEvent);

  assert.equal(result.status, "PREPARED_AND_VERIFIED");
  assert.deepEqual(result.actualCart, matchingActualCart());
  assert.equal(result.comparison?.matches, true);
  assert.equal(result.handoffUrl, "https://www.dominos.ca/en/pages/order/?route=1&handoff=abc");
  assert.deepEqual(result.fallback, buildGuidedHandoff(expected));
  assert.equal(result.reason, null);

  // Two fresh independent verifications: pre-execution and post-execution.
  assert.equal(calls.verifyCandidate, 1);
  assert.equal(calls.verifyActualCart, 1);
  assert.equal(calls.refreshObservation, 2);
  assert.equal(calls.executorPrepare, 1);

  assert.ok(events.some((event) => event.type === "cart-complete"));
  assert.ok(events.some((event) => event.type === "cart-stage"));
});

for (const [label, tamper] of [
  ["quantity", (c: DominosCandidate) => ({ ...c, pizzas: [{ ...c.pizzas[0]!, quantity: 99 }] })],
  ["topping", (c: DominosCandidate) => ({ ...c, pizzas: [{ ...c.pizzas[0]!, toppings: [{ code: "H", quantity: 1 }] }] })],
  ["store", (c: DominosCandidate) => ({ ...c, storeId: "10953" })],
  ["method", (c: DominosCandidate) => ({ ...c, serviceMethod: "delivery" as const })],
  ["price", (c: DominosCandidate) => ({ ...c, expectedPricing: { ...c.expectedPricing, totalCad: 999 } })],
] as const) {
  test(`tampered ${label}: a fresh Verifier REJECT never reaches executor.prepare and never returns PREPARED_AND_VERIFIED`, async () => {
    const tampered = tamper(candidate());
    const { deps, calls } = buildDeps({
      preVerifyOutcome: (verifyInput) => rejectOutcome(verifyInput!.candidate, `Tampered ${label} failed live evidence.`),
      executor: fakeExecutor(async () => { throw new Error("executor.prepare must never run after a REJECT"); }),
    });

    const result = await prepareSelectedDominosCart(tampered, organizerInput(), deps);

    assert.notEqual(result.status, "PREPARED_AND_VERIFIED");
    // A store tamper points at a store the fresh observation never saw, so
    // candidateMatchesObservation fails closed before even calling
    // deps.verifyCandidate — a stronger defense than a REJECT verdict, but
    // still zero executions either way.
    assert.equal(calls.executorPrepare, 0);
    assert.equal(calls.verifyActualCart, 0);
    assert.deepEqual(result.fallback, buildGuidedHandoff(tampered));
  });
}

test("tampered store bound to a real observed store still requires and gets a fresh Verifier REJECT before execution", async () => {
  const base = candidate();
  // Also tampering snapshotVersion to correctly bind to the (different) real
  // store 10953 mimics a more sophisticated tamper attempt than simply
  // changing storeId, and confirms the fresh Verifier call itself — not just
  // the snapshot-binding guard — is what stops this candidate.
  const tampered: DominosCandidate = { ...base, storeId: "10953", snapshotVersion: `10953:${FETCHED_AT}` };
  const { deps, calls } = buildDeps({
    preObservation: twoStoreObservation(FETCHED_AT),
    preVerifyOutcome: (verifyInput) => rejectOutcome(verifyInput!.candidate, "Tampered store failed live evidence."),
    executor: fakeExecutor(async () => { throw new Error("executor.prepare must never run after a REJECT"); }),
  });

  const result = await prepareSelectedDominosCart(tampered, organizerInput(), deps);

  assert.notEqual(result.status, "PREPARED_AND_VERIFIED");
  assert.equal(calls.verifyCandidate, 1, "a store pointed at a genuinely observed store must reach the fresh Verifier call");
  assert.equal(calls.executorPrepare, 0);
  assert.deepEqual(result.fallback, buildGuidedHandoff(tampered));
});

test("a VERIFIER_ERROR on the pre-execution check also blocks execution", async () => {
  const expected = candidate();
  const { deps, calls } = buildDeps({
    preVerifyOutcome: () => ({ status: "VERIFIER_ERROR", reason: "context error", evidence: null }),
    executor: fakeExecutor(async () => { throw new Error("must not run"); }),
  });

  const result = await prepareSelectedDominosCart(expected, organizerInput(), deps);

  assert.notEqual(result.status, "PREPARED_AND_VERIFIED");
  assert.equal(calls.executorPrepare, 0);
});

test("a matching actual cart triggers a fresh independent Verifier call over the observed cart", async () => {
  const expected = candidate();
  const { deps, calls } = buildDeps({
    executor: executorObserving(matchingActualCart()),
  });

  await prepareSelectedDominosCart(expected, organizerInput(), deps);

  assert.equal(calls.verifyActualCart, 1);
});

test("a mismatched actual cart is caught by the independent comparator and never reaches the post-execution Verifier", async () => {
  const expected = candidate();
  const { deps, calls } = buildDeps({
    executor: executorObserving(mismatchedActualCart()),
  });

  const result = await prepareSelectedDominosCart(expected, organizerInput(), deps);

  assert.equal(result.status, "CART_MISMATCH");
  assert.equal(result.comparison?.matches, false);
  assert.notEqual(result.status, "PREPARED_AND_VERIFIED");
  assert.equal(calls.verifyActualCart, 0, "a mismatch must stop before the post-execution Verifier call");
  assert.deepEqual(result.fallback, buildGuidedHandoff(expected));
});

test("a post-execution Verifier REJECT never returns PREPARED_AND_VERIFIED even though the cart matched structurally", async () => {
  const expected = candidate();
  const { deps, calls } = buildDeps({
    executor: executorObserving(matchingActualCart()),
    postVerifyOutcome: (verifyInput) => rejectOutcome(verifyInput!.candidate, "Fresh evidence failed a hard check."),
  });

  const result = await prepareSelectedDominosCart(expected, organizerInput(), deps);

  assert.notEqual(result.status, "PREPARED_AND_VERIFIED");
  assert.equal(calls.verifyActualCart, 1);
  assert.deepEqual(result.fallback, buildGuidedHandoff(expected));
});

test("missing live trusted-slice evidence for the observed variant stops before the post-execution Verifier call", async () => {
  const expected = candidate();
  const { deps, calls } = buildDeps({
    postObservation: observationFrom(snapshotWithUnknownSlices(POST_FETCHED_AT)),
    executor: executorObserving(matchingActualCart()),
  });

  const result = await prepareSelectedDominosCart(expected, organizerInput(), deps);

  assert.notEqual(result.status, "PREPARED_AND_VERIFIED");
  assert.equal(calls.verifyActualCart, 0, "missing evidence must stop before the post-execution Verifier call");
});

test("a non-success executor result (e.g. CAPTCHA) is propagated as-is and never reaches comparison or post-verification", async () => {
  const expected = candidate();
  const captchaResult: CartPreparationResult = {
    status: "NEEDS_HUMAN_CAPTCHA",
    actualCart: null,
    comparison: null,
    handoffUrl: null,
    fallback: buildGuidedHandoff(expected),
    reason: "The official page presented a CAPTCHA.",
  };
  const { deps, calls } = buildDeps({
    executor: fakeExecutor(async () => captchaResult),
  });

  const result = await prepareSelectedDominosCart(expected, organizerInput(), deps);

  assert.equal(result.status, "NEEDS_HUMAN_CAPTCHA");
  assert.equal(calls.verifyActualCart, 0);
});

test("a failed live-data refresh before verification blocks without ever calling the Verifier or executor", async () => {
  const expected = candidate();
  const { deps, calls } = buildDeps({
    preObservation: () => Promise.reject(new Error("network down")),
    executor: fakeExecutor(async () => { throw new Error("must not run"); }),
  });

  const result = await prepareSelectedDominosCart(expected, organizerInput(), deps);

  assert.equal(result.status, "AUTOMATION_UNAVAILABLE");
  assert.equal(calls.verifyCandidate, 0);
  assert.equal(calls.executorPrepare, 0);
  assert.deepEqual(result.fallback, buildGuidedHandoff(expected));
});

test("the observed-cart candidate carries an incremented candidateVersion and the refreshed snapshot binding", async () => {
  const expected = candidate();
  let capturedObservedCandidate: DominosCandidate | null = null;
  const { deps } = buildDeps({
    executor: executorObserving(matchingActualCart()),
    postVerifyOutcome: (verifyInput) => {
      capturedObservedCandidate = verifyInput!.candidate;
      return approveOutcome(verifyInput!.candidate);
    },
  });

  await prepareSelectedDominosCart(expected, organizerInput(), deps);

  assert.ok(capturedObservedCandidate);
  const observedCandidate = capturedObservedCandidate as DominosCandidate;
  assert.equal(observedCandidate.candidateVersion, expected.candidateVersion + 1);
  assert.equal(observedCandidate.snapshotVersion, `10950:${POST_FETCHED_AT}`);
  assert.equal(observedCandidate.pizzas[0]!.lineId, expected.pizzas[0]!.lineId);
  assert.equal(observedCandidate.pizzas[0]!.purpose, expected.pizzas[0]!.purpose);
});
