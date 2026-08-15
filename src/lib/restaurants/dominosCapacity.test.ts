import assert from "node:assert/strict";
import test from "node:test";

import type { DominosCandidate, CandidatePizza } from "../gatherbite/contracts";
import type { DietaryGroupInput } from "../types";
import { allocateProtectedSlices, checkTotalPizzaCapacity } from "./dominosCapacity";

function pizza(lineId: string, slices: number, protectsGroupIds: string[] = []): CandidatePizza {
  return {
    lineId,
    quantity: 1,
    productCode: "S_PIZZA",
    variantCode: "12SCREEN",
    sizeCode: "12",
    crustCode: "HANDTOSS",
    sauceCode: "X",
    cheeseCode: "C",
    toppings: [],
    purpose: protectsGroupIds.length > 0 ? "dietary-protected" : "general",
    protectsGroupIds,
    trustedSlicesPerPizza: slices,
  };
}

function candidate(pizzas: CandidatePizza[]): DominosCandidate {
  return {
    candidateId: "candidate-1",
    candidateVersion: 1,
    snapshotVersion: "10950:2026-08-15T00:00:00.000Z",
    storeId: "10950",
    serviceMethod: "carryout",
    dealCodes: [],
    pizzas,
    expectedPricing: { subtotalCad: 30, taxCad: 4.5, feesCad: 0, totalCad: 34.5 },
  };
}

const overlappingGroups: DietaryGroupInput[] = [
  { id: "veg", people: 2, restrictions: ["vegetarian"] },
  { id: "pork", people: 2, restrictions: ["noPork"] },
];

test("allocateProtectedSlices gives each overlapping dietary group distinct stable slices", () => {
  const order = candidate([
    pizza("vegetarian-pizza", 6, ["veg"]),
    pizza("no-pork-pizza", 6, ["pork"]),
  ]);

  const allocation = allocateProtectedSlices(
    order,
    overlappingGroups,
    (line, group) => line.protectsGroupIds.includes(group.id),
  );

  assert.equal(allocation.groups.veg.allocatedSlices, 6);
  assert.equal(allocation.groups.pork.allocatedSlices, 6);
  assert.equal(allocation.allocatedSliceIds.size, 12);
  assert.deepEqual([...allocation.allocatedSliceIds], [
    "vegetarian-pizza:0:0",
    "vegetarian-pizza:0:1",
    "vegetarian-pizza:0:2",
    "vegetarian-pizza:0:3",
    "vegetarian-pizza:0:4",
    "vegetarian-pizza:0:5",
    "no-pork-pizza:0:0",
    "no-pork-pizza:0:1",
    "no-pork-pizza:0:2",
    "no-pork-pizza:0:3",
    "no-pork-pizza:0:4",
    "no-pork-pizza:0:5",
  ]);
});

test("allocateProtectedSlices never shares a dietary-protected slice between separate group requirements", () => {
  const order = candidate([pizza("shared-compatible", 6, ["veg", "pork"])]);

  const allocation = allocateProtectedSlices(
    order,
    overlappingGroups,
    (line, group) => line.protectsGroupIds.includes(group.id),
  );

  assert.equal(allocation.groups.veg.allocatedSlices, 6);
  assert.equal(allocation.groups.pork.allocatedSlices, 0);
  assert.equal(allocation.groups.pork.missingSlices, 6);
  assert.equal(allocation.allocatedSliceIds.size, 6);
});

test("allocateProtectedSlices does not rely on a general pizza for dietary coverage", () => {
  const order = candidate([pizza("general-compatible", 6)]);

  const allocation = allocateProtectedSlices(order, [overlappingGroups[0]!], () => true);

  assert.equal(allocation.groups.veg.allocatedSlices, 0);
  assert.equal(allocation.groups.veg.missingSlices, 6);
});

test("checkTotalPizzaCapacity counts only trusted pizza slices and retains the full attendee requirement", () => {
  const order = candidate([
    pizza("known-pizza", 8),
    { ...pizza("drink", 0), productCode: "DRINK" } as CandidatePizza,
    { ...pizza("side", 0), productCode: "BREAD" } as CandidatePizza,
    { ...pizza("ambiguous-bundle", 0), productCode: "AMBIGUOUS_BUNDLE" } as CandidatePizza,
  ]);

  const evidence = checkTotalPizzaCapacity(order, 4);

  assert.equal(evidence.status, "FAIL");
  assert.equal(evidence.code, "INSUFFICIENT_TOTAL_PIZZA_SLICES");
  assert.equal(evidence.facts.requiredSlices, 12);
  assert.equal(evidence.facts.trustedPizzaSlices, 8);
  assert.deepEqual(evidence.facts.zeroCapacityLineIds, ["drink", "side", "ambiguous-bundle"]);
});
