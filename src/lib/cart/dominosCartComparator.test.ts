import assert from "node:assert/strict";
import test from "node:test";

import type { CandidatePizza, DominosCandidate } from "../gatherbite/contracts";
import type { ActualCartItem, ActualDominosCart, CartMismatchField } from "./contracts";
import { compareDominosCart } from "./dominosCartComparator";

const GENERAL_LINE_ID = "general-1";
const DIETARY_LINE_ID = "dietary-1";

function generalPizza(): CandidatePizza {
  return {
    lineId: GENERAL_LINE_ID,
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
  };
}

function dietaryPizza(): CandidatePizza {
  return {
    lineId: DIETARY_LINE_ID,
    quantity: 1,
    productCode: "S_PIZZA",
    variantCode: "12SCREEN",
    sizeCode: "12",
    crustCode: "GLUTENFREE",
    sauceCode: "X",
    cheeseCode: "C",
    toppings: [],
    purpose: "dietary-protected",
    protectsGroupIds: ["gf-1"],
    trustedSlicesPerPizza: 6,
  };
}

function expectedCandidate(): DominosCandidate {
  return {
    candidateId: "cand-1",
    candidateVersion: 1,
    snapshotVersion: "10950:2026-08-15T03:14:17.698Z",
    storeId: "10950",
    serviceMethod: "carryout",
    dealCodes: ["3021"],
    pizzas: [generalPizza(), dietaryPizza()],
    expectedPricing: { subtotalCad: 44.97, taxCad: 6.75, feesCad: 0, totalCad: 51.72 },
  };
}

function actualItemFrom(pizza: CandidatePizza): ActualCartItem {
  return {
    productCode: pizza.productCode,
    variantCode: pizza.variantCode,
    quantity: pizza.quantity,
    sizeCode: pizza.sizeCode,
    crustCode: pizza.crustCode,
    sauceCode: pizza.sauceCode,
    cheeseCode: pizza.cheeseCode,
    toppings: pizza.toppings.map((topping) => ({ ...topping })),
  };
}

function matchingActualCart(): ActualDominosCart {
  return {
    storeId: "10950",
    serviceMethod: "carryout",
    items: [actualItemFrom(generalPizza()), actualItemFrom(dietaryPizza())],
    couponCodes: ["3021"],
    subtotalCad: 44.97,
    taxCad: 6.75,
    feesCad: 0,
    totalCad: 51.72,
    observedAt: "2026-08-15T03:20:00.000Z",
  };
}

function assertMismatchField(actual: ActualDominosCart, field: CartMismatchField, label: string): void {
  const comparison = compareDominosCart(expectedCandidate(), actual);
  assert.equal(comparison.matches, false, `expected a mismatch for ${label}`);
  assert.ok(
    comparison.mismatches.some((mismatch) => mismatch.field === field),
    `expected a "${field}" mismatch for ${label}, got: ${JSON.stringify(comparison.mismatches.map((m) => m.field))}`,
  );
}

test("compareDominosCart reports a match for an identical actual cart", () => {
  const comparison = compareDominosCart(expectedCandidate(), matchingActualCart());
  assert.equal(comparison.matches, true);
  assert.deepEqual(comparison.mismatches, []);
});

test("compareDominosCart reports a named mismatch for every mutated field", () => {
  const cases: Array<{ label: string; field: CartMismatchField; mutate: (cart: ActualDominosCart) => void }> = [
    { label: "store", field: "store", mutate: (cart) => { cart.storeId = "99999"; } },
    { label: "method", field: "method", mutate: (cart) => { cart.serviceMethod = "delivery"; } },
    { label: "product", field: "product", mutate: (cart) => { cart.items[0].productCode = "OTHER_PRODUCT"; } },
    { label: "variant", field: "variant", mutate: (cart) => { cart.items[0].variantCode = "14SCREEN"; } },
    { label: "quantity", field: "quantity", mutate: (cart) => { cart.items[0].quantity = 3; } },
    { label: "size", field: "size", mutate: (cart) => { cart.items[0].sizeCode = "14"; } },
    { label: "crust", field: "crust", mutate: (cart) => { cart.items[0].crustCode = "THIN"; } },
    { label: "sauce", field: "sauce", mutate: (cart) => { cart.items[0].sauceCode = "BBQ"; } },
    { label: "cheese", field: "cheese", mutate: (cart) => { cart.items[0].cheeseCode = null; } },
    { label: "topping", field: "topping", mutate: (cart) => { cart.items[0].toppings = []; } },
    { label: "coupon", field: "coupon", mutate: (cart) => { cart.couponCodes = []; } },
    { label: "subtotal", field: "subtotal", mutate: (cart) => { cart.subtotalCad = 10; } },
    { label: "tax", field: "tax", mutate: (cart) => { cart.taxCad = 1; } },
    { label: "fee", field: "fee", mutate: (cart) => { cart.feesCad = 5; } },
    { label: "total", field: "total", mutate: (cart) => { cart.totalCad = 999; } },
    { label: "capacity", field: "capacity", mutate: (cart) => { cart.items = [cart.items[0]]; } },
    { label: "dietary configuration", field: "dietary", mutate: (cart) => { cart.items[1].crustCode = "HANDTOSS"; } },
  ];

  for (const { label, field, mutate } of cases) {
    const cart = matchingActualCart();
    mutate(cart);
    assertMismatchField(cart, field, label);
  }
});

test("compareDominosCart never accepts an extra unexpected item", () => {
  const cart = matchingActualCart();
  cart.items.push(actualItemFrom(generalPizza()));
  const comparison = compareDominosCart(expectedCandidate(), cart);
  assert.equal(comparison.matches, false);
});

test("compareDominosCart never accepts a missing item as a match", () => {
  const cart = matchingActualCart();
  cart.items.pop();
  const comparison = compareDominosCart(expectedCandidate(), cart);
  assert.equal(comparison.matches, false);
});
