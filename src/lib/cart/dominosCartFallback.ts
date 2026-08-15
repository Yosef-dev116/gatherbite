import type { CandidatePizza, DominosCandidate } from "../gatherbite/contracts";
import type { GuidedOrderHandoff } from "./contracts";

/**
 * The only official order entry URL Task 2's evidence proved works
 * (`docs/research/2026-08-14-dominos-cart-feasibility.md`). No store,
 * session, coupon, or deep-link query parameter was proven to prefill
 * anything, so this is the only URL the guide may open.
 */
const OFFICIAL_ORDER_URL = "https://www.dominos.ca/en/pages/order/?route=1";

function formatMoney(value: number | null): string {
  return value === null ? "unknown — not proven by official evidence" : `$${value.toFixed(2)} CAD`;
}

function describeToppings(toppings: CandidatePizza["toppings"]): string {
  if (toppings.length === 0) return "no extra toppings";
  return `toppings ${toppings.map((topping) => `${topping.code} x${topping.quantity}`).join(", ")}`;
}

function describeLine(pizza: CandidatePizza, index: number): string {
  const sauce = pizza.sauceCode ?? "none";
  const cheese = pizza.cheeseCode ?? "none";
  return `Pizza ${index + 1} (qty ${pizza.quantity}): product ${pizza.productCode}, variant ${pizza.variantCode}, `
    + `size ${pizza.sizeCode}, crust ${pizza.crustCode}, sauce ${sauce}, cheese ${cheese}, ${describeToppings(pizza.toppings)}.`;
}

/**
 * Builds the manual, non-purchasing order guide an organizer follows to
 * recreate an approved candidate themselves. It never claims a cart was
 * prepared, and it never claims the official URL is preloaded with store,
 * address, or cart state — only the exact root order URL is proven, and it
 * carries no persisted parameters.
 */
export function buildGuidedHandoff(candidate: DominosCandidate): GuidedOrderHandoff {
  const itemLines = candidate.pizzas.map((pizza, index) => describeLine(pizza, index));

  const couponLine = candidate.dealCodes.length > 0
    ? `Coupon code(s) to enter: ${candidate.dealCodes.join(", ")}.`
    : "No coupon code applies.";

  const priceLines = [
    `Known menu subtotal: ${formatMoney(candidate.expectedPricing.subtotalCad)}.`,
    `Tax: ${formatMoney(candidate.expectedPricing.taxCad)}.`,
    `Fees: ${formatMoney(candidate.expectedPricing.feesCad)}.`,
    `Total: ${formatMoney(candidate.expectedPricing.totalCad)}.`,
  ];

  const headline = "Domino's manual order guide — recreate this yourself; no completed order exists.";
  const storeLine = `Store ${candidate.storeId}, service method ${candidate.serviceMethod}.`;
  const urlLine = `Open the official order page yourself: ${OFFICIAL_ORDER_URL}. `
    + "It does not preload this store, address, or cart contents — every step below must be entered manually.";

  const lines = [headline, storeLine, couponLine, ...priceLines, urlLine, ...itemLines];

  const remainingActions = [
    `Open ${OFFICIAL_ORDER_URL} yourself.`,
    `Select store ${candidate.storeId} and ${candidate.serviceMethod} in the official flow.`,
    "Add each pizza above using the exact product, variant, size, crust, sauce, cheese, and topping codes shown.",
    candidate.dealCodes.length > 0
      ? `Enter coupon code(s) ${candidate.dealCodes.join(", ")}.`
      : "No coupon code to enter.",
    "Confirm subtotal, tax, fees, and total yourself in the official flow — any amount not listed above was never proven.",
    "Review and submit the order yourself. GatherBite never submits payment or places an order.",
  ];

  const completeCopyText = [
    ...lines,
    "",
    "Remaining steps:",
    ...remainingActions,
  ].join("\n");

  return { officialUrl: OFFICIAL_ORDER_URL, lines, itemLines, remainingActions, completeCopyText };
}
