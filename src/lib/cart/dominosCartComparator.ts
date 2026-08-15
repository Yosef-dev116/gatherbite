import type { CandidatePizza, DominosCandidate } from "../gatherbite/contracts";
import type {
  ActualCartItem,
  ActualDominosCart,
  CartComparison,
  CartMismatch,
  CartMismatchField,
} from "./contracts";

const PRICE_TOLERANCE_CAD = 0.005;

function mismatch(
  field: CartMismatchField,
  lineId: string | null,
  message: string,
  expected: unknown,
  actual: unknown,
): CartMismatch {
  return { field, lineId, message, expected, actual };
}

function numbersEqual(expected: number | null, actual: number | null): boolean {
  if (expected === null || actual === null) return expected === actual;
  return Math.abs(expected - actual) <= PRICE_TOLERANCE_CAD;
}

function sortedJoin(values: readonly string[]): string {
  return [...values].sort().join("|");
}

function toppingsEqual(
  expected: CandidatePizza["toppings"],
  actual: ActualCartItem["toppings"],
): boolean {
  if (expected.length !== actual.length) return false;
  const key = (topping: { code: string; quantity: number }) => `${topping.code}:${topping.quantity}`;
  return sortedJoin(expected.map(key)) === sortedJoin(actual.map(key));
}

/**
 * A mismatch on a dietary-protected line is reported as "dietary" rather
 * than its underlying field, because any discrepancy on a line protecting a
 * group's restriction is safety-critical regardless of which attribute
 * changed.
 */
function fieldFor(pizza: CandidatePizza, base: CartMismatchField): CartMismatchField {
  return pizza.purpose === "dietary-protected" ? "dietary" : base;
}

function compareLine(expected: CandidatePizza, actual: ActualCartItem, mismatches: CartMismatch[]): void {
  if (expected.productCode !== actual.productCode) {
    mismatches.push(mismatch(
      fieldFor(expected, "product"), expected.lineId,
      `Product code mismatch on "${expected.lineId}".`, expected.productCode, actual.productCode,
    ));
  }
  if (expected.variantCode !== actual.variantCode) {
    mismatches.push(mismatch(
      fieldFor(expected, "variant"), expected.lineId,
      `Variant code mismatch on "${expected.lineId}".`, expected.variantCode, actual.variantCode,
    ));
  }
  if (expected.quantity !== actual.quantity) {
    mismatches.push(mismatch(
      fieldFor(expected, "quantity"), expected.lineId,
      `Quantity mismatch on "${expected.lineId}".`, expected.quantity, actual.quantity,
    ));
  }
  if (expected.sizeCode !== actual.sizeCode) {
    mismatches.push(mismatch(
      fieldFor(expected, "size"), expected.lineId,
      `Size mismatch on "${expected.lineId}".`, expected.sizeCode, actual.sizeCode,
    ));
  }
  if (expected.crustCode !== actual.crustCode) {
    mismatches.push(mismatch(
      fieldFor(expected, "crust"), expected.lineId,
      `Crust mismatch on "${expected.lineId}".`, expected.crustCode, actual.crustCode,
    ));
  }
  if (expected.sauceCode !== actual.sauceCode) {
    mismatches.push(mismatch(
      fieldFor(expected, "sauce"), expected.lineId,
      `Sauce mismatch on "${expected.lineId}".`, expected.sauceCode, actual.sauceCode,
    ));
  }
  if (expected.cheeseCode !== actual.cheeseCode) {
    mismatches.push(mismatch(
      fieldFor(expected, "cheese"), expected.lineId,
      `Cheese mismatch on "${expected.lineId}".`, expected.cheeseCode, actual.cheeseCode,
    ));
  }
  if (!toppingsEqual(expected.toppings, actual.toppings)) {
    mismatches.push(mismatch(
      fieldFor(expected, "topping"), expected.lineId,
      `Topping mismatch on "${expected.lineId}".`, expected.toppings, actual.toppings,
    ));
  }
}

/**
 * Strict, deterministic protocol check comparing an approved candidate
 * against an actual observed Domino's cart. Never accepts substitutions or
 * extra items: every field is compared independently, and any structural
 * difference in item count is reported too. This is not verification
 * authority — only the separate Verification Agent may APPROVE/REJECT; this
 * function only detects and names mismatches.
 */
export function compareDominosCart(
  expected: DominosCandidate,
  actual: ActualDominosCart,
): CartComparison {
  const mismatches: CartMismatch[] = [];

  if (expected.storeId !== actual.storeId) {
    mismatches.push(mismatch("store", null, "Store mismatch.", expected.storeId, actual.storeId));
  }
  if (expected.serviceMethod !== actual.serviceMethod) {
    mismatches.push(mismatch("method", null, "Service method mismatch.", expected.serviceMethod, actual.serviceMethod));
  }
  if (sortedJoin(expected.dealCodes) !== sortedJoin(actual.couponCodes)) {
    mismatches.push(mismatch("coupon", null, "Coupon codes mismatch.", expected.dealCodes, actual.couponCodes));
  }
  if (!numbersEqual(expected.expectedPricing.subtotalCad, actual.subtotalCad)) {
    mismatches.push(mismatch("subtotal", null, "Subtotal mismatch.", expected.expectedPricing.subtotalCad, actual.subtotalCad));
  }
  if (!numbersEqual(expected.expectedPricing.taxCad, actual.taxCad)) {
    mismatches.push(mismatch("tax", null, "Tax mismatch.", expected.expectedPricing.taxCad, actual.taxCad));
  }
  if (!numbersEqual(expected.expectedPricing.feesCad, actual.feesCad)) {
    mismatches.push(mismatch("fee", null, "Fees mismatch.", expected.expectedPricing.feesCad, actual.feesCad));
  }
  if (!numbersEqual(expected.expectedPricing.totalCad, actual.totalCad)) {
    mismatches.push(mismatch("total", null, "Total mismatch.", expected.expectedPricing.totalCad, actual.totalCad));
  }

  const expectedTotalQuantity = expected.pizzas.reduce((sum, pizza) => sum + pizza.quantity, 0);
  const actualTotalQuantity = actual.items.reduce((sum, item) => sum + item.quantity, 0);
  if (expectedTotalQuantity !== actualTotalQuantity) {
    mismatches.push(mismatch(
      "capacity",
      null,
      `Expected ${expectedTotalQuantity} total pizza(s) but the actual cart has ${actualTotalQuantity}.`,
      expectedTotalQuantity,
      actualTotalQuantity,
    ));
  }

  const lineCount = Math.max(expected.pizzas.length, actual.items.length);
  for (let index = 0; index < lineCount; index += 1) {
    const expectedLine = expected.pizzas[index];
    const actualLine = actual.items[index];
    if (!expectedLine) {
      mismatches.push(mismatch(
        "capacity", null,
        `Actual cart contains an extra item at position ${index + 1} not present in the expected candidate.`,
        null, actualLine,
      ));
      continue;
    }
    if (!actualLine) {
      mismatches.push(mismatch(
        "capacity", expectedLine.lineId,
        `Expected item "${expectedLine.lineId}" is missing from the actual cart.`,
        expectedLine, null,
      ));
      continue;
    }
    compareLine(expectedLine, actualLine, mismatches);
  }

  return { matches: mismatches.length === 0, mismatches };
}
