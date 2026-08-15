/**
 * Sanitized real-shaped fields observed from Domino's Canada public menu data.
 * This is not a dietary claim and does not prove that the coupon price is an
 * all-in quote. There are deliberately no addresses, headers, cookies, tokens,
 * or customer/session identifiers in this fixture.
 */
export const DOMINOS_CONFIGURABLE_MENU_FIXTURE = {
  sourceObservedAt: "2026-08-15T03:14:17.698Z",
  storeId: "10950",
  product: {
    code: "S_PIZZA",
    name: "Pizza",
    productType: "Pizza",
    defaultVariantCode: "14SCREEN",
    variantCodes: [
      "10SCREEN",
      "P10IGFZA",
      "12THIN",
      "12SCREEN",
      "12HTTPIZ",
      "12SFFPIZ",
      "P12IPAZA",
      "14THIN",
      "14SCREEN",
      "14HTTPIZ",
    ],
    defaultToppings: [
      { code: "X", quantity: 1 },
      { code: "C", quantity: 1 },
    ],
  },
  variant: {
    code: "12SCREEN",
    name: '12" Hand Tossed',
    productCode: "S_PIZZA",
    size: { code: "12", name: 'Medium (12")' },
    crust: { code: "HANDTOSS", name: "Hand Tossed" },
    menuPriceCad: 14.99,
    trustedSlices: 8,
    servingEvidence: {
      servings: "8 slices",
      servingSize: "1/8 pizza",
    },
  },
  sauce: { code: "X", name: "Pizza Sauce" },
  cheese: { code: "C", name: "Cheese" },
  toppings: [
    { code: "P", name: "Pepperoni" },
    { code: "S", name: "Sausage" },
    { code: "B", name: "Beef Crumble" },
    { code: "K", name: "Bacon Strip Crumble" },
    { code: "R", name: "Black Olives" },
    { code: "G", name: "Green Pepper" },
    { code: "M", name: "Mushroom" },
    { code: "O", name: "Onion" },
    { code: "T", name: "Tomatoes" },
    { code: "Sp", name: "Baby Spinach" },
    { code: "Rp", name: "Roasted Red Peppers" },
  ],
  deal: {
    code: "3021",
    name: "1 Medium 5 Topping Pizzas",
    displayedPriceCad: 14.99,
    serviceMethods: ["carryout", "delivery"],
    maximumToppings: 5,
    trustedSlices: null,
    exactVariantEligibility: "UNKNOWN",
  },
} as const;
