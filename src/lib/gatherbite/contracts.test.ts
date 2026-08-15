import assert from "node:assert/strict";
import test from "node:test";

import { DominosCandidateSchema, GatherBiteInputSchema } from "./contracts";

function basePizza(overrides: Record<string, unknown> = {}) {
  return {
    lineId: "line-1",
    quantity: 1,
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

function baseCandidate(overrides: Record<string, unknown> = {}) {
  return {
    candidateId: "cand-1",
    candidateVersion: 1,
    snapshotVersion: "10950:2026-08-15T12:00:00.000Z",
    storeId: "10950",
    serviceMethod: "carryout",
    dealCodes: [],
    pizzas: [basePizza()],
    expectedPricing: { subtotalCad: 14.99, taxCad: 2.25, feesCad: 0, totalCad: 17.24 },
    ...overrides,
  };
}

test("Carryout needs no address", () => {
  assert.equal(GatherBiteInputSchema.safeParse({
    attendees: 18,
    budgetCad: 120,
    serviceMethod: "carryout",
    groups: [],
    pizzaPreferences: [],
  }).success, true);
});

test("Either requires address", () => {
  assert.equal(GatherBiteInputSchema.safeParse({
    attendees: 18,
    budgetCad: 120,
    groups: [],
    pizzaPreferences: [],
  }).success, false);
});

test("dietary groups may overlap", () => {
  assert.equal(GatherBiteInputSchema.safeParse({
    attendees: 4,
    budgetCad: 100,
    serviceMethod: "carryout",
    groups: [
      { id: "a", people: 4, restrictions: ["vegetarian"] },
      { id: "b", people: 4, restrictions: ["noPork"] },
    ],
    pizzaPreferences: ["pepperoni"],
  }).success, true);
});

test("duplicate dietary group identifiers are rejected before verification", () => {
  const result = GatherBiteInputSchema.safeParse({
    attendees: 4,
    budgetCad: 100,
    serviceMethod: "carryout",
    groups: [
      { id: "same", people: 2, restrictions: ["vegetarian"] },
      { id: "same", people: 2, restrictions: ["noPork"] },
    ],
    pizzaPreferences: [],
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.issues.some((issue) => issue.message.includes("Duplicate dietary group identifier")), true);
  }
});

test("a candidate within bounds parses successfully", () => {
  assert.equal(DominosCandidateSchema.safeParse(baseCandidate()).success, true);
});

test("an oversized pizzas array fails Zod parsing before reaching any downstream logic (100-line bound, matching dominosEvidence's MAX_PIZZA_LINES)", () => {
  const oversized = baseCandidate({
    pizzas: Array.from({ length: 101 }, (_, index) => basePizza({ lineId: `line-${index}` })),
  });
  const result = DominosCandidateSchema.safeParse(oversized);
  assert.equal(result.success, false);

  const atBound = baseCandidate({
    pizzas: Array.from({ length: 100 }, (_, index) => basePizza({ lineId: `line-${index}` })),
  });
  assert.equal(DominosCandidateSchema.safeParse(atBound).success, true);
});

test("an oversized toppings array on a single pizza line fails Zod parsing (10-topping bound)", () => {
  const oversized = baseCandidate({
    pizzas: [basePizza({
      toppings: Array.from({ length: 11 }, (_, index) => ({ code: `T${index}`, quantity: 1 })),
    })],
  });
  const result = DominosCandidateSchema.safeParse(oversized);
  assert.equal(result.success, false);

  const atBound = baseCandidate({
    pizzas: [basePizza({
      toppings: Array.from({ length: 10 }, (_, index) => ({ code: `T${index}`, quantity: 1 })),
    })],
  });
  assert.equal(DominosCandidateSchema.safeParse(atBound).success, true);
});

test("an oversized dealCodes array fails Zod parsing (200-deal bound)", () => {
  const oversized = baseCandidate({
    dealCodes: Array.from({ length: 201 }, (_, index) => `DEAL${index}`),
  });
  const result = DominosCandidateSchema.safeParse(oversized);
  assert.equal(result.success, false);

  const atBound = baseCandidate({
    dealCodes: Array.from({ length: 200 }, (_, index) => `DEAL${index}`),
  });
  assert.equal(DominosCandidateSchema.safeParse(atBound).success, true);
});
