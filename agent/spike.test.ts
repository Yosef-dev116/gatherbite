import assert from "node:assert/strict";
import { test } from "node:test";
import type { BuildOrderInput } from "../src/lib/types";
import type { DominosStoreSnapshot } from "../src/lib/restaurants/dominos";
import type { DominosComparisonResult } from "../src/lib/restaurants/dominosCompare";
import { verifyDominosCandidate, verifyLittleCaesarsCandidate } from "./lib/candidate-verification";

const requirements: BuildOrderInput = {
  attendees: 4,
  budget: 100,
  storeId: "10088",
  groups: [],
};

test("eve spike delegates Little Caesars acceptance to the existing deterministic verifier", () => {
  const result = verifyLittleCaesarsCandidate(requirements, [
    { itemId: "classic-pepperoni-p37", quantity: 2 },
  ]);
  assert.equal(result.verified, true);
  assert.equal(result.review?.provider, "little-caesars");
  assert.match(result.review?.capacity ?? "", /verified/);
  assert.equal(result.review?.wait.delivery, null);
  assert.match(result.review?.externalOrderUrl ?? "", /^https:\/\//);
});

test("eve spike preserves concrete Little Caesars verifier rejection", () => {
  const result = verifyLittleCaesarsCandidate(
    { ...requirements, attendees: 20, budget: 10 },
    [{ itemId: "classic-pepperoni-p37", quantity: 1 }]
  );
  assert.equal(result.verified, false);
  assert.ok(result.failures.some((failure) => failure.includes("INSUFFICIENT_TOTAL_SLICES")));
  assert.ok(result.failures.some((failure) => failure.includes("BUDGET_EXCEEDED")));
});

function snapshot(): DominosStoreSnapshot {
  return {
    provider: "dominos",
    storeId: "10950",
    address: "Trusted live address",
    isOpen: true,
    isOnlineNow: true,
    deliveryAvailable: true,
    carryoutAvailable: true,
    deliveryWaitMinutes: { min: 20, max: 30 },
    carryoutWaitMinutes: { min: 10, max: 15 },
    deals: [],
    products: [],
    fetchedAt: "2026-08-14T00:00:00.000Z",
    status: "ok",
    errors: [],
  };
}

function viableResult(): DominosComparisonResult {
  return {
    storeId: "10950",
    classification: "FULLY_VIABLE",
    reason: null,
    estimatedTotalCad: 35.98,
    dealUsed: {
      code: "PIZZA-DEAL",
      name: "Live pizza deal",
      price: 17.99,
      quantity: 2,
      totalSlices: 16,
    },
    waitMinutes: { min: 20, max: 30 },
  };
}

test("eve spike only accepts the exact deterministically sufficient Domino's plan", () => {
  const result = verifyDominosCandidate(
    requirements,
    { snapshots: [snapshot()], results: [viableResult()] },
    { provider: "dominos", storeId: "10950", dealCode: "PIZZA-DEAL", quantity: 1 }
  );
  assert.equal(result.verified, false);
  assert.match(result.failures[0], /use 2 x PIZZA-DEAL/);
});

test("eve spike normalizes a fully viable Domino's candidate without inventing an order URL", () => {
  const result = verifyDominosCandidate(
    requirements,
    { snapshots: [snapshot()], results: [viableResult()] },
    { provider: "dominos", storeId: "10950", dealCode: "PIZZA-DEAL", quantity: 2 }
  );
  assert.equal(result.verified, true);
  assert.equal(result.review?.totalCad, 35.98);
  assert.deepEqual(result.review?.wait.delivery, { min: 20, max: 30 });
  assert.equal(result.review?.externalOrderUrl, null);
});

test("eve spike preserves fail-closed Domino's unknown results", () => {
  const unknown = viableResult();
  unknown.classification = "INSUFFICIENT_DIETARY_DATA";
  unknown.reason = "Dietary evidence is incomplete.";
  unknown.estimatedTotalCad = null;
  unknown.dealUsed = null;
  const result = verifyDominosCandidate(
    requirements,
    { snapshots: [snapshot()], results: [unknown] },
    { provider: "dominos", storeId: "10950", dealCode: "PIZZA-DEAL", quantity: 2 }
  );
  assert.equal(result.verified, false);
  assert.deepEqual(result.failures, ["Dietary evidence is incomplete."]);
});
