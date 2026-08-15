import assert from "node:assert/strict";
import test from "node:test";

import type { CandidatePizza, DominosCandidate } from "../gatherbite/contracts";
import { buildGuidedHandoff } from "./dominosCartFallback";

const OFFICIAL_URL = "https://www.dominos.ca/en/pages/order/?route=1";

function pizza(overrides: Partial<CandidatePizza> = {}): CandidatePizza {
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

function candidate(overrides: Partial<DominosCandidate> = {}): DominosCandidate {
  return {
    candidateId: "cand-1",
    candidateVersion: 1,
    snapshotVersion: "10950:2026-08-15T03:14:17.698Z",
    storeId: "10950",
    serviceMethod: "carryout",
    dealCodes: ["3021"],
    pizzas: [pizza()],
    expectedPricing: { subtotalCad: 14.99, taxCad: null, feesCad: null, totalCad: null },
    ...overrides,
  };
}

test("buildGuidedHandoff opens exactly the Task 2-proven official order URL, with no other query parameters", () => {
  const handoff = buildGuidedHandoff(candidate());
  assert.equal(handoff.officialUrl, OFFICIAL_URL);
});

test("buildGuidedHandoff produces an exact per-line description for every candidate pizza", () => {
  const two = candidate({
    pizzas: [
      pizza({ lineId: "a" }),
      pizza({ lineId: "b", quantity: 2, crustCode: "GLUTENFREE", sauceCode: null, cheeseCode: null, toppings: [] }),
    ],
  });
  const handoff = buildGuidedHandoff(two);
  assert.equal(handoff.itemLines.length, 2);

  const firstLine = handoff.itemLines[0];
  for (const token of ["S_PIZZA", "12SCREEN", "HANDTOSS", "X", "C", "P"]) {
    assert.ok(firstLine.includes(token), `expected first line to include ${token}: ${firstLine}`);
  }

  const secondLine = handoff.itemLines[1];
  assert.ok(secondLine.includes("GLUTENFREE"), secondLine);
  assert.ok(secondLine.includes("2"), secondLine);
});

test("buildGuidedHandoff states which price fields are known and which remain unknown", () => {
  const handoff = buildGuidedHandoff(candidate());
  const joined = handoff.lines.join("\n");
  assert.ok(joined.includes("14.99"), joined);
  assert.ok(/tax/i.test(joined) && /unknown/i.test(joined), joined);
});

test("buildGuidedHandoff lists remaining organizer actions and a non-empty complete-copy text block", () => {
  const handoff = buildGuidedHandoff(candidate());
  assert.ok(handoff.remainingActions.length > 0);
  assert.equal(typeof handoff.completeCopyText, "string");
  assert.ok(handoff.completeCopyText.length > 0);
  assert.ok(handoff.completeCopyText.includes(handoff.officialUrl));
  for (const line of handoff.itemLines) {
    assert.ok(handoff.completeCopyText.includes(line));
  }
});

test("buildGuidedHandoff never claims the cart was prepared", () => {
  const handoff = buildGuidedHandoff(candidate());
  const haystack = [
    handoff.lines.join(" "),
    handoff.itemLines.join(" "),
    handoff.remainingActions.join(" "),
    handoff.completeCopyText,
  ].join(" ").toLowerCase();
  assert.equal(haystack.includes("prepared"), false, haystack);
});

test("buildGuidedHandoff states the official URL is not preloaded with store, address, or cart state", () => {
  const handoff = buildGuidedHandoff(candidate());
  const joined = handoff.lines.join(" ").toLowerCase();
  assert.ok(joined.includes("does not preload"), joined);
});

test("buildGuidedHandoff includes the coupon code to enter when the candidate has one", () => {
  const handoff = buildGuidedHandoff(candidate());
  const joined = handoff.lines.join(" ");
  assert.ok(joined.includes("3021"), joined);
});

test("buildGuidedHandoff says no coupon applies when the candidate has none", () => {
  const handoff = buildGuidedHandoff(candidate({ dealCodes: [] }));
  const joined = handoff.lines.join(" ").toLowerCase();
  assert.ok(joined.includes("no coupon"), joined);
});
