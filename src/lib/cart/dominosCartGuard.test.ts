import assert from "node:assert/strict";
import test from "node:test";

import { guardBrowserAction } from "./dominosCartGuard";

test("guardBrowserAction denies every purchase-completing checkout label", () => {
  for (const label of ["Place order", "Pay now", "Complete checkout", "Confirm purchase", "Submit order"]) {
    assert.equal(guardBrowserAction({ kind: "click", label, context: "checkout" }).allowed, false, label);
  }
});

test("guardBrowserAction allows reversible add-to-cart configuration", () => {
  assert.equal(guardBrowserAction({ kind: "click", label: "Add to cart", context: "menu" }).allowed, true);
});

test("guardBrowserAction denies CAPTCHA interaction", () => {
  const byContext = guardBrowserAction({ kind: "click", label: "Verify", context: "captcha" });
  assert.equal(byContext.allowed, false);

  const byLabel = guardBrowserAction({ kind: "click", label: "I'm not a robot", context: "menu" });
  assert.equal(byLabel.allowed, false);
});

test("guardBrowserAction denies credential submission", () => {
  const password = guardBrowserAction({ kind: "type", label: "Password", context: "login" });
  assert.equal(password.allowed, false);

  const cardNumber = guardBrowserAction({ kind: "type", label: "Card number", context: "payment" });
  assert.equal(cardNumber.allowed, false);
});

test("guardBrowserAction denies unclassified checkout-context clicks", () => {
  const result = guardBrowserAction({ kind: "click", label: "Continue", context: "checkout" });
  assert.equal(result.allowed, false);
});

test("guardBrowserAction allows other reversible store/method/address/deal/cart-navigation intents", () => {
  assert.equal(guardBrowserAction({ kind: "click", label: "Select store 10950", context: "store" }).allowed, true);
  assert.equal(guardBrowserAction({ kind: "click", label: "Choose carryout", context: "service-method" }).allowed, true);
  assert.equal(guardBrowserAction({ kind: "type", label: "Enter delivery address", context: "address" }).allowed, true);
  assert.equal(guardBrowserAction({ kind: "click", label: "Apply coupon 3021", context: "deal" }).allowed, true);
  assert.equal(guardBrowserAction({ kind: "click", label: "Remove item", context: "cart" }).allowed, true);
  assert.equal(guardBrowserAction({ kind: "click", label: "View cart", context: "cart-navigation" }).allowed, true);
});

test("guardBrowserAction denies unrecognized contexts by default (fail closed)", () => {
  const result = guardBrowserAction({ kind: "click", label: "Mystery button", context: "unknown-widget" });
  assert.equal(result.allowed, false);
});

test("guardBrowserAction never fabricates approval and always returns a reason", () => {
  const denied = guardBrowserAction({ kind: "click", label: "Pay now", context: "checkout" });
  assert.equal(typeof denied.reason, "string");
  assert.ok(denied.reason.length > 0);

  const allowed = guardBrowserAction({ kind: "click", label: "Add to cart", context: "menu" });
  assert.equal(typeof allowed.reason, "string");
  assert.ok(allowed.reason.length > 0);
});
