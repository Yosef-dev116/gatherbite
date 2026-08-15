/**
 * Sanitized outcome of a non-purchasing Domino's Canada price-order request.
 * It records the fail-closed quote boundary: the item and coupon were accepted
 * for validation, but no cart or all-in amounts were returned.
 */
export const DOMINOS_CART_FIXTURE = {
  sourceObservedAt: "2026-08-15T03:14:17.698Z",
  storeId: "10950",
  serviceMethod: "carryout",
  request: {
    product: {
      code: "12SCREEN",
      quantity: 1,
      options: [
        { code: "X", quantity: 1 },
        { code: "C", quantity: 1 },
        { code: "P", quantity: 1 },
      ],
      selectedToppings: [{ code: "P", name: "Pepperoni", quantity: 1 }],
      trustedSlicesEach: 8,
    },
    couponCodes: ["3021"],
  },
  response: {
    overallStatus: -1,
    orderStatus: -1,
    statusCode: "StoreConnectionError",
    productStatus: 0,
    couponStatusCodes: ["Fulfilled"],
    amounts: {
      subtotalCad: null,
      taxCad: null,
      deliveryFeeCad: null,
      otherFeesCad: null,
      totalCad: null,
    },
  },
  evidence: {
    officialCartCreated: false,
    exactCartObserved: false,
    selectedToppingQuoteSucceeded: false,
    allInQuoteProven: false,
    sessionTransferProven: false,
    deepLinkStateProven: false,
    matchingCartTotals: null,
  },
} as const;
