import assert from "node:assert/strict";
import test from "node:test";

import type {
  CandidatePizza,
  DominosCandidate,
  EvidenceStatus,
  GatherBiteInput,
} from "../gatherbite/contracts";
import type { DominosStoreSnapshot } from "./dominos";
import { buildDominosCatalog } from "./dominosCatalog";
import {
  collectCandidateEvidence,
  type CandidateEvidenceContext,
} from "./dominosEvidence";
import type {
  DominosPriceEvidence,
  DominosServiceabilityResult,
} from "./dominosServiceability";

const FETCHED_AT = "2026-08-15T12:00:00.000Z";
const COLLECTED_AT = "2026-08-15T12:01:00.000Z";

function snapshot(): DominosStoreSnapshot {
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
    deals: [{
      code: "3021",
      name: "1 Medium 5 Topping Pizzas",
      price: 14.99,
      conditions: "Carryout,Delivery",
      slices: null,
    }],
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
      { code: "O", name: "Onions", category: "Pizza" },
      { code: "P", name: "Pepperoni", category: "Pizza" },
      { code: "RANCH", name: "Buttermilk Ranch", category: "Sauce" },
    ],
    fetchedAt: FETCHED_AT,
    status: "ok",
    errors: [],
  };
}

function pizza(overrides: Partial<CandidatePizza> = {}): CandidatePizza {
  return {
    lineId: "protected-1",
    quantity: 1,
    productCode: "S_PIZZA",
    variantCode: "12SCREEN",
    sizeCode: "12",
    crustCode: "HANDTOSS",
    sauceCode: "X",
    cheeseCode: "C",
    toppings: [{ code: "O", quantity: 1 }],
    purpose: "dietary-protected",
    protectsGroupIds: ["no-pork"],
    trustedSlicesPerPizza: 8,
    ...overrides,
  };
}

function candidate(overrides: Partial<DominosCandidate> = {}): DominosCandidate {
  return {
    candidateId: "candidate-1",
    candidateVersion: 1,
    snapshotVersion: `10950:${FETCHED_AT}`,
    storeId: "10950",
    serviceMethod: "carryout",
    dealCodes: [],
    pizzas: [pizza()],
    expectedPricing: {
      subtotalCad: 14.99,
      taxCad: 2.25,
      feesCad: 0,
      totalCad: 17.24,
    },
    ...overrides,
  };
}

function input(overrides: Partial<GatherBiteInput> = {}): GatherBiteInput {
  return {
    attendees: 2,
    budgetCad: 50,
    serviceMethod: "carryout",
    groups: [{ id: "no-pork", people: 1, restrictions: ["noPork"] }],
    pizzaPreferences: [],
    ...overrides,
  };
}

function knownPrice(): DominosPriceEvidence {
  return {
    status: "KNOWN",
    kind: "TRUSTED_CALCULATION",
    subtotalCad: 14.99,
    taxCad: 2.25,
    feesCad: 0,
    totalCad: 17.24,
    source: "Complete official components and PEI HST",
    observedAt: FETCHED_AT,
  };
}

function carryoutServiceability(): DominosServiceabilityResult {
  return {
    status: "SERVICEABLE",
    applicability: "NOT_REQUIRED",
    storeIds: [],
    observedAt: FETCHED_AT,
    source: "Not applicable to carryout",
    reason: "A delivery address is not required for carryout.",
  };
}

function context(
  mutate?: (value: CandidateEvidenceContext) => CandidateEvidenceContext,
): CandidateEvidenceContext {
  const liveSnapshot = snapshot();
  const value: CandidateEvidenceContext = {
    input: input(),
    candidate: candidate(),
    snapshot: liveSnapshot,
    catalog: buildDominosCatalog(liveSnapshot),
    serviceability: carryoutServiceability(),
    priceEvidence: knownPrice(),
    collectedAt: COLLECTED_AT,
  };
  return mutate ? mutate(value) : value;
}

function rebuild(value: CandidateEvidenceContext): CandidateEvidenceContext {
  return { ...value, catalog: buildDominosCatalog(value.snapshot) };
}

test("a fully grounded candidate returns six independent passing checks", async () => {
  const evidence = await collectCandidateEvidence(context());

  assert.deepEqual(
    Object.fromEntries(Object.entries(evidence.checks).map(([key, check]) => [key, check.status])),
    {
      menuIntegrity: "PASS",
      dietary: "PASS",
      capacity: "PASS",
      budget: "PASS",
      availability: "PASS",
      serviceability: "PASS",
    },
  );
  assert.equal("decision" in evidence, false);
});

test("each hard check can independently prevent a passing evidence bundle", async () => {
  const cases: Array<{
    key: keyof Awaited<ReturnType<typeof collectCandidateEvidence>>["checks"];
    expected: EvidenceStatus;
    make: () => CandidateEvidenceContext;
  }> = [
    {
      key: "menuIntegrity",
      expected: "FAIL",
      make: () => context((value) => ({
        ...value,
        candidate: candidate({ pizzas: [pizza({ productCode: "NOT_LIVE" })] }),
      })),
    },
    {
      key: "dietary",
      expected: "FAIL",
      make: () => context((value) => ({
        ...value,
        input: input({ groups: [{ id: "no-pork", people: 3, restrictions: ["noPork"] }] }),
      })),
    },
    {
      key: "capacity",
      expected: "FAIL",
      make: () => context((value) => ({ ...value, input: input({ attendees: 3 }) })),
    },
    {
      key: "budget",
      expected: "FAIL",
      make: () => context((value) => ({ ...value, input: input({ budgetCad: 10 }) })),
    },
    {
      key: "availability",
      expected: "FAIL",
      make: () => context((value) => rebuild({
        ...value,
        snapshot: { ...value.snapshot, isOpen: false },
      })),
    },
    {
      key: "serviceability",
      expected: "FAIL",
      make: () => context((value) => ({
        ...value,
        input: input({
          serviceMethod: "delivery",
          deliveryAddress: {
            street: "10 Test Street",
            city: "Charlottetown",
            province: "PE",
            postalCode: "C1A 1A1",
          },
        }),
        candidate: candidate({ serviceMethod: "delivery" }),
        serviceability: {
          status: "NOT_SERVICEABLE",
          applicability: "REQUIRED",
          storeIds: [],
          observedAt: FETCHED_AT,
          source: "Domino's official store-locator flow",
          reason: "No serviceable store was returned.",
        },
      })),
    },
  ];

  for (const scenario of cases) {
    const evidence = await collectCandidateEvidence(scenario.make());
    assert.equal(evidence.checks[scenario.key].status, scenario.expected, scenario.key);
    for (const [key, check] of Object.entries(evidence.checks)) {
      if (key !== scenario.key) assert.equal(check.status, "PASS", `${scenario.key} must not change ${key}`);
    }
  }
});

test("dietary evidence fails closed for MAY_CONTAIN and UNKNOWN crust facts", async () => {
  const mayContain = await collectCandidateEvidence(context((value) => ({
    ...value,
    input: input({ groups: [{ id: "mustard", people: 1, restrictions: ["noMustard"] }] }),
    candidate: candidate({
      pizzas: [pizza({
        sauceCode: "RANCH",
        toppings: [],
        protectsGroupIds: ["mustard"],
      })],
    }),
  })));
  assert.equal(mayContain.checks.dietary.status, "FAIL");
  assert.match(JSON.stringify(mayContain.checks.dietary.facts), /MAY_CONTAIN/);

  const unknownCrust = await collectCandidateEvidence(context((value) => {
    const changed = {
      ...value,
      input: input({ groups: [{ id: "gf", people: 1, restrictions: ["glutenFriendly"] }] }),
      candidate: candidate({
        pizzas: [pizza({ crustCode: "MYSTERY", protectsGroupIds: ["gf"] })],
      }),
      snapshot: {
        ...value.snapshot,
        variants: value.snapshot.variants?.map((variant) => ({ ...variant, crustCode: "MYSTERY" })),
      },
    };
    return rebuild(changed);
  }));
  assert.equal(unknownCrust.checks.menuIntegrity.status, "PASS");
  assert.equal(unknownCrust.checks.dietary.status, "UNKNOWN");
});

test("stale snapshots and incomplete all-in price evidence remain UNKNOWN", async () => {
  const stale = await collectCandidateEvidence(context((value) => ({
    ...value,
    collectedAt: "2026-08-15T12:10:01.000Z",
  })));
  assert.equal(stale.checks.menuIntegrity.status, "UNKNOWN");

  const unknownFee = await collectCandidateEvidence(context((value) => ({
    ...value,
    priceEvidence: {
      status: "UNKNOWN",
      kind: "UNKNOWN",
      subtotalCad: 14.99,
      taxCad: null,
      feesCad: null,
      totalCad: null,
      source: "Official quote unavailable",
      observedAt: FETCHED_AT,
      reason: "A required fee is unknown.",
    },
  })));
  assert.equal(unknownFee.checks.budget.status, "UNKNOWN");
});

test("a known deal without proven variant eligibility remains UNKNOWN", async () => {
  const evidence = await collectCandidateEvidence(context((value) => ({
    ...value,
    candidate: candidate({ dealCodes: ["3021"] }),
  })));

  assert.equal(evidence.checks.menuIntegrity.status, "UNKNOWN");
  assert.match(evidence.checks.menuIntegrity.summary, /deal eligibility/i);
});

test("a rejected evidence promise becomes explicit UNKNOWN without leaking its error", async () => {
  const value = context();
  const productsByCode = new Proxy(value.catalog.productsByCode, {
    get() {
      throw new Error("private-token-that-must-not-leak");
    },
  });
  const evidence = await collectCandidateEvidence({
    ...value,
    catalog: { ...value.catalog, productsByCode },
  });

  assert.equal(evidence.checks.menuIntegrity.status, "UNKNOWN");
  assert.doesNotMatch(JSON.stringify(evidence), /private-token-that-must-not-leak/);
});

test("preferences stay soft and private request fields never enter evidence", async () => {
  const evidence = await collectCandidateEvidence(context((value) => ({
    ...value,
    input: input({
      pizzaPreferences: ["pepperoni"],
      groups: [{
        id: "no-pork",
        people: 1,
        restrictions: ["noPork"],
        notes: "private-note-marker",
      }],
    }),
  })));

  assert.equal(evidence.preference.represented.length, 0);
  assert.equal(evidence.preference.unmet.length, 1);
  assert.equal(Object.values(evidence.checks).every((check) => check.status === "PASS"), true);
  assert.doesNotMatch(JSON.stringify(evidence), /private-note-marker|10 Test Street/);
});
