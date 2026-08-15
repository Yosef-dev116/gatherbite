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
