import assert from "node:assert/strict";
import test from "node:test";

import type { DominosCandidate, CandidatePizza } from "../gatherbite/contracts";
import { buildDominosCatalog } from "./dominosCatalog";
import { configureGeneralPreferences } from "./dominosPreferences";
import { DOMINOS_CONFIGURABLE_MENU_FIXTURE } from "./fixtures/dominos-configurable-menu.fixture";
import type { DominosStoreSnapshot } from "./dominos";

function pizza(lineId: string, purpose: CandidatePizza["purpose"]): CandidatePizza {
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
    purpose,
    protectsGroupIds: purpose === "dietary-protected" ? ["vegetarian"] : [],
    trustedSlicesPerPizza: 8,
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
    expectedPricing: { subtotalCad: 29.98, taxCad: 4.5, feesCad: 0, totalCad: 34.48 },
  };
}

function catalog() {
  const fixture = DOMINOS_CONFIGURABLE_MENU_FIXTURE;
  const snapshot: DominosStoreSnapshot = {
    provider: "dominos",
    storeId: fixture.storeId,
    address: null,
    isOpen: true,
    isOnlineNow: true,
    deliveryAvailable: true,
    carryoutAvailable: true,
    deliveryWaitMinutes: null,
    carryoutWaitMinutes: null,
    deals: [],
    products: [{
      id: fixture.product.code,
      name: fixture.product.name,
      category: fixture.product.productType,
      toppings: null,
      defaultToppingCodes: ["X", "C"],
      variantCodes: ["12SCREEN"],
      priceInfoIfAvailable: fixture.variant.menuPriceCad,
    }],
    variants: [{
      code: "12SCREEN",
      productCode: fixture.product.code,
      sizeCode: "12",
      crustCode: "HANDTOSS",
      priceCad: fixture.variant.menuPriceCad,
      trustedSlices: 8,
    }],
    toppingOptions: [
      { code: "C", name: "Cheese", category: "Cheese" },
      ...fixture.toppings.map((topping) => ({ ...topping, category: "Pizza" })),
    ],
    fetchedAt: fixture.sourceObservedAt,
    status: "ok",
    errors: [],
  };
  return buildDominosCatalog(snapshot);
}

test("configureGeneralPreferences maps real live Pepperoni, Veggie, and Meat lovers codes only to general pizzas", () => {
  const original = candidate([
    pizza("protected", "dietary-protected"),
    pizza("pepperoni", "general"),
    pizza("veggie", "general"),
    pizza("meat-lovers", "general"),
  ]);
  const protectedBefore = structuredClone(original.pizzas[0]);

  const result = configureGeneralPreferences(original, catalog(), ["pepperoni", "veggie", "meatHeavy"], []);

  assert.deepEqual(result.evidence.represented, ["pepperoni", "veggie", "meatHeavy"]);
  assert.deepEqual(result.evidence.unmet, []);
  assert.deepEqual(result.candidate.pizzas[0], protectedBefore);
  assert.deepEqual(result.candidate.pizzas[1]?.toppings, [{ code: "P", quantity: 1 }]);
  assert.deepEqual(result.candidate.pizzas[2]?.toppings, [
    { code: "G", quantity: 1 },
    { code: "M", quantity: 1 },
    { code: "O", quantity: 1 },
  ]);
  assert.deepEqual(result.candidate.pizzas[3]?.toppings, [
    { code: "P", quantity: 1 },
    { code: "S", quantity: 1 },
    { code: "B", quantity: 1 },
    { code: "K", quantity: 1 },
  ]);
  assert.deepEqual(original.pizzas[1]?.toppings, [], "the input candidate must not be mutated");
});

test("configureGeneralPreferences records an unavailable intent without invalidating a viable candidate", () => {
  const original = candidate([pizza("general", "general")]);
  const noPepperoniCatalog = catalog();
  const toppings = [...noPepperoniCatalog.toppingsByCode].filter(([code]) => code !== "P");
  const unavailableCatalog = {
    ...noPepperoniCatalog,
    toppingsByCode: new Map(toppings),
  };

  const result = configureGeneralPreferences(original, unavailableCatalog, ["pepperoni"], []);

  assert.deepEqual(result.evidence.represented, []);
  assert.deepEqual(result.evidence.unmet, [
    { preference: "pepperoni", reason: "Pepperoni is not available in this live store catalogue." },
  ]);
  assert.deepEqual(result.candidate, original);
});

test("configureGeneralPreferences records an avoidance-conflicting intent as unmet", () => {
  const original = candidate([pizza("general", "general")]);

  const result = configureGeneralPreferences(original, catalog(), ["meatHeavy"], ["no pork"]);

  assert.deepEqual(result.evidence.represented, []);
  assert.deepEqual(result.evidence.unmet, [
    { preference: "meatHeavy", reason: "Meat lovers conflicts with the organizer's avoidance note: no pork." },
  ]);
  assert.deepEqual(result.candidate, original);
});

test("configureGeneralPreferences leaves a capacity-sufficient general order simple when no preference is supplied", () => {
  const original = candidate([pizza("general-a", "general"), pizza("general-b", "general")]);

  const result = configureGeneralPreferences(original, catalog(), [], []);

  assert.deepEqual(result.evidence, { requested: [], represented: [], unmet: [] });
  assert.deepEqual(result.candidate, original);
  assert.notEqual(result.candidate, original);
  assert.equal(result.candidate.expectedPricing.totalCad, 34.48);
});
