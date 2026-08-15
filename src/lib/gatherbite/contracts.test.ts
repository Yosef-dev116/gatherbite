import assert from "node:assert/strict";
import test from "node:test";

import { GatherBiteInputSchema } from "./contracts";

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
