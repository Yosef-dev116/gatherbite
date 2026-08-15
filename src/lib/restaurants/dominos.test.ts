import { getDominosStoreSnapshot } from "./dominos";
import type { DominosStoreSnapshot } from "./dominos";
import { compareDominosStores, classifyDominosStore, describeDominosTradeoff } from "./dominosCompare";
import type { DominosComparisonResult } from "./dominosCompare";

let pass = 0;
let fail = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    pass++;
    console.log(`  ok - ${name}`);
  } else {
    fail++;
    console.error(`  FAIL - ${name}`);
  }
}

// --- Mock fetch helper -----------------------------------------------
type MockRoute = { body?: unknown; status?: number; error?: Error };

function withMockedFetch<T>(routes: Record<string, MockRoute>, fn: () => Promise<T>): Promise<T> {
  const original = global.fetch;
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) throw new Error(`No mock configured for ${url}`);
    const route = routes[key];
    if (route.error) throw route.error;
    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => route.body,
    } as Response;
  }) as typeof fetch;
  return fn().finally(() => {
    global.fetch = original;
  });
}

const PROFILE_URL = "https://order.dominos.ca/power/store/10950/profile";
const MENU_URL = "https://order.dominos.ca/power/store/10950/menu";

function profileFixture(overrides: Record<string, unknown> = {}) {
  return {
    StoreID: "10950",
    AddressDescription: "386 University Ave\nCharlottetown, PE C1A4N5\n",
    IsOpen: true,
    IsOnlineNow: true,
    AllowDeliveryOrders: true,
    AllowCarryoutOrders: true,
    ServiceMethodEstimatedWaitMinutes: { Delivery: { Min: 18, Max: 28 }, Carryout: { Min: 11, Max: 16 } },
    ...overrides,
  };
}

function menuFixture(couponPrice: string, overrides: Record<string, unknown> = {}) {
  return {
    Coupons: {
      "3021": {
        Code: "3021",
        Name: "1 Medium 5 Topping Pizzas",
        Price: couponPrice,
        Tags: { ValidServiceMethods: ["Carryout", "Delivery"], Servings: "8 slices" },
      },
    },
    Products: {
      S_ALFR: {
        Code: "S_ALFR",
        Name: "Chicken Alfredo",
        ProductType: "Pasta",
        DefaultToppings: "Xf=1,D=1",
        Tags: { DefaultVariant: "PINPASCA" },
        Variants: ["PINPASCA"],
      },
    },
    Variants: { PINPASCA: { Code: "PINPASCA", Price: "10.99" } },
    Toppings: { Pasta: { Xf: { Name: "Alfredo Sauce" }, D: { Name: "Chicken" } } },
    ...overrides,
  };
}

/** A real-shaped dietary-neutral snapshot for the pure comparator tests.
 * Default deal is a single, known-8-slice medium pizza. */
function fixtureSnapshot(overrides: Partial<DominosStoreSnapshot>): DominosStoreSnapshot {
  return {
    provider: "dominos",
    storeId: "10950",
    address: "386 University Ave, Charlottetown, PE",
    isOpen: true,
    isOnlineNow: true,
    deliveryAvailable: true,
    carryoutAvailable: true,
    deliveryWaitMinutes: { min: 18, max: 28 },
    carryoutWaitMinutes: { min: 11, max: 16 },
    deals: [{ code: "3021", name: "1 Medium 5 Topping Pizzas", price: 14.99, conditions: "Carryout,Delivery", slices: 8 }],
    products: [],
    variants: [],
    toppingOptions: [],
    fetchedAt: new Date().toISOString(),
    status: "ok",
    errors: [],
    ...overrides,
  };
}

async function run() {
  // --- Scenario 1: normal success — real fields normalized correctly ---
  console.log("Scenario 1: getDominosStoreSnapshot — successful fetch normalizes real data");
  {
    const snapshot = await withMockedFetch(
      { [PROFILE_URL]: { body: profileFixture() }, [MENU_URL]: { body: menuFixture("14.99") } },
      () => getDominosStoreSnapshot("10950")
    );
    check("status is ok", snapshot.status === "ok");
    check("provider is dominos", snapshot.provider === "dominos");
    check("address trimmed from real data", snapshot.address === "386 University Ave\nCharlottetown, PE C1A4N5");
    check("isOpen true", snapshot.isOpen === true);
    check("deliveryWaitMinutes parsed", snapshot.deliveryWaitMinutes?.min === 18 && snapshot.deliveryWaitMinutes?.max === 28);
    check("carryoutWaitMinutes parsed", snapshot.carryoutWaitMinutes?.min === 11 && snapshot.carryoutWaitMinutes?.max === 16);
    check("deal price parsed as a real number, not hardcoded", snapshot.deals[0]?.price === 14.99);
    check("deal conditions reflect real ValidServiceMethods", snapshot.deals[0]?.conditions === "Carryout,Delivery");
    check("deal slice count parsed from real Servings text", snapshot.deals[0]?.slices === 8);
    check(
      "product toppings resolved to real names via the store's own topping index",
      JSON.stringify(snapshot.products[0]?.toppings) === JSON.stringify(["Alfredo Sauce", "Chicken"])
    );
    check("product price comes from its real default variant", snapshot.products[0]?.priceInfoIfAvailable === 10.99);
    check("product retains exact default topping codes", JSON.stringify(snapshot.products[0]?.defaultToppingCodes) === JSON.stringify(["Xf", "D"]));
    check("product retains exact variant codes", JSON.stringify(snapshot.products[0]?.variantCodes) === JSON.stringify(["PINPASCA"]));
    check("variant is retained as configurable data", snapshot.variants?.[0]?.code === "PINPASCA" && snapshot.variants[0]?.priceCad === 10.99);
    check("topping options retain exact codes and categories", snapshot.toppingOptions?.some((topping) => topping.code === "D" && topping.name === "Chicken" && topping.category === "Pasta") === true);
    check("no errors on a clean fetch", snapshot.errors.length === 0);
  }

  // --- Scenario 2: partial data — one endpoint fails ---
  console.log("Scenario 2: partial data (profile fails, menu succeeds)");
  {
    const snapshot = await withMockedFetch(
      { [PROFILE_URL]: { error: new Error("network error") }, [MENU_URL]: { body: menuFixture("14.99") } },
      () => getDominosStoreSnapshot("10950")
    );
    check("status is partial", snapshot.status === "partial");
    check("one error recorded", snapshot.errors.length === 1);
    check("address unknown (null), not fabricated", snapshot.address === null);
    check("isOpen unknown (null), not assumed true or false", snapshot.isOpen === null);
    check("menu-derived data still present", snapshot.deals.length === 1);
  }

  // --- Scenario 3: total endpoint failure ---
  console.log("Scenario 3: endpoint failure — both requests fail");
  {
    const snapshot = await withMockedFetch(
      { [PROFILE_URL]: { error: new Error("network error") }, [MENU_URL]: { status: 500 } },
      () => getDominosStoreSnapshot("10950")
    );
    check("status is failed", snapshot.status === "failed");
    check("two errors recorded", snapshot.errors.length === 2);
    check("HTTP status failure produces a readable error", snapshot.errors.some((e) => e.includes("HTTP 500")));
    check("deals empty, not crashed", snapshot.deals.length === 0);
    check("products empty, not crashed", snapshot.products.length === 0);
    check("getDominosStoreSnapshot never throws", true);
  }

  // --- Scenario 4: two fully viable stores with different prices ---
  console.log("Scenario 4: two fully viable stores, different real prices, full-group pizza capacity");
  {
    const cheaper = fixtureSnapshot({
      storeId: "10953",
      deals: [{ code: "3021", name: "1 Medium 5 Topping Pizzas", price: 13.99, conditions: "Carryout,Delivery", slices: 8 }],
      deliveryWaitMinutes: { min: 15, max: 25 },
    });
    const pricier = fixtureSnapshot({ storeId: "10950" });
    const results = compareDominosStores([pricier, cheaper], { people: 18, budget: 150 });
    check("both stores returned, not just one winner", results.length === 2);
    check("pricier store is FULLY_VIABLE", results[0].classification === "FULLY_VIABLE");
    check("cheaper store is FULLY_VIABLE", results[1].classification === "FULLY_VIABLE");
    // 54 slices required -> 7 pizzas of 8 slices (56 total) at each store's real unit price.
    check("pricier total = 7 x $14.99 = $104.93", results[0].estimatedTotalCad === 104.93);
    check("cheaper total = 7 x $13.99 = $97.93", results[1].estimatedTotalCad === 97.93);
    check("quantity reflects real capacity math, not a single coupon price", results[0].dealUsed?.quantity === 7);
  }

  // --- Scenario 5: one cheaper but slower store ---
  console.log("Scenario 5: one cheaper-but-slower store vs one pricier-but-faster store");
  {
    const cheaperSlower = fixtureSnapshot({
      storeId: "A",
      deals: [{ code: "X", name: "1 Medium Deal", price: 10, conditions: "Delivery", slices: 8 }],
      deliveryWaitMinutes: { min: 18, max: 28 },
    });
    const pricierFaster = fixtureSnapshot({
      storeId: "B",
      deals: [{ code: "X", name: "1 Medium Deal", price: 20, conditions: "Delivery", slices: 8 }],
      deliveryWaitMinutes: { min: 10, max: 15 },
    });
    const results = compareDominosStores([cheaperSlower, pricierFaster], { people: 18, budget: 150 });
    const a = results.find((r) => r.storeId === "A")!;
    const b = results.find((r) => r.storeId === "B")!;
    check("both classified FULLY_VIABLE - the tradeoff is a presentation decision, not a forced winner", a.classification === "FULLY_VIABLE" && b.classification === "FULLY_VIABLE");
    check("A is genuinely cheaper", a.estimatedTotalCad! < b.estimatedTotalCad!);
    check("A is genuinely slower (higher max wait)", a.waitMinutes!.max > b.waitMinutes!.max);
  }

  // --- Scenario 6: one closed/unavailable store ---
  console.log("Scenario 6: one closed/unavailable store returned alongside a viable one");
  {
    const closed = fixtureSnapshot({ storeId: "closed-store", isOpen: false });
    const open = fixtureSnapshot({ storeId: "open-store" });
    const results = compareDominosStores([closed, open], { people: 18, budget: 150 });
    check("both stores still returned", results.length === 2);
    const closedResult = results.find((r) => r.storeId === "closed-store")!;
    const openResult = results.find((r) => r.storeId === "open-store")!;
    check("closed store classified CLOSED_OR_UNAVAILABLE", closedResult.classification === "CLOSED_OR_UNAVAILABLE");
    check("closed store gets no fabricated price", closedResult.estimatedTotalCad === null);
    check("open store still FULLY_VIABLE", openResult.classification === "FULLY_VIABLE");
  }

  // --- Scenario 7: endpoint failure / unknown status never yields a price-based classification ---
  console.log("Scenario 7: unknown/failed data never falls through to a price-based guess");
  {
    const failed = fixtureSnapshot({ status: "failed", errors: ["Profile fetch failed: network error", "Menu fetch failed: HTTP 500"], deals: [] });
    const result = classifyDominosStore(failed, { people: 18, budget: 100 });
    check("classified INSUFFICIENT_UNKNOWN_DATA", result.classification === "INSUFFICIENT_UNKNOWN_DATA");
    check("reason surfaces the real fetch errors", result.reason!.includes("network error"));

    const partialUnknownOpen = fixtureSnapshot({ status: "partial", isOpen: null, isOnlineNow: null, errors: ["Profile fetch failed: timed out"] });
    const partialResult = classifyDominosStore(partialUnknownOpen, { people: 18, budget: 100 });
    check(
      "partial data with unknown open-status is INSUFFICIENT_UNKNOWN_DATA, not assumed open or closed",
      partialResult.classification === "INSUFFICIENT_UNKNOWN_DATA"
    );
  }

  // --- Scenario 8: dietary groups present -> INSUFFICIENT_DIETARY_DATA ---
  console.log("Scenario 8: dietary input causes INSUFFICIENT_DIETARY_DATA, not a compatibility guess");
  {
    const snapshot = fixtureSnapshot({});
    const result = classifyDominosStore(snapshot, { people: 18, budget: 150, hasDietaryGroups: true });
    check("classification is INSUFFICIENT_DIETARY_DATA", result.classification === "INSUFFICIENT_DIETARY_DATA");
    check("no price/deal is claimed when dietary data is insufficient", result.estimatedTotalCad === null && result.dealUsed === null);
    check("dietary-unknown takes priority over an otherwise-affordable price", true);
  }

  // --- Extra: over budget, and service-method deal filtering ---
  console.log("Extra: over-budget classification and service-method-specific deal filtering");
  {
    const snapshot = fixtureSnapshot({ deals: [{ code: "X", name: "1 Medium Deal", price: 50, conditions: "Carryout,Delivery", slices: 8 }] });
    const result = classifyDominosStore(snapshot, { people: 1, budget: 20 }); // 3 slices required -> 1 pizza -> $50
    check("classified VIABLE_BUT_OVER_BUDGET", result.classification === "VIABLE_BUT_OVER_BUDGET");
    check("reason explains the real overage", result.reason!.includes("50.00") && result.reason!.includes("20.00"));

    const deliveryOnly = fixtureSnapshot({ deals: [{ code: "Y", name: "1 Medium Delivery-only deal", price: 10, conditions: "Delivery", slices: 8 }] });
    const carryoutRequest = classifyDominosStore(deliveryOnly, { people: 18, budget: 100, servicePreference: "carryout" });
    check(
      "a deal not valid for the requested service method is not used - fails closed, not FULLY_VIABLE by accident",
      carryoutRequest.classification === "INSUFFICIENT_UNKNOWN_DATA"
    );
  }

  // === New: Pizza Only capacity rule ===================================

  // --- Scenario 9: drinks/dips cannot make a group viable ---
  console.log("Scenario 9: drinks/dips cannot independently satisfy group food requirements");
  {
    const drinksOnly = fixtureSnapshot({
      deals: [{ code: "8464", name: "2 500ml Drinks and 2 Dip Cups", price: 5.99, conditions: "Carryout,Delivery", slices: null }],
    });
    const result = classifyDominosStore(drinksOnly, { people: 18, budget: 100 });
    check("a cheap non-pizza deal never yields FULLY_VIABLE", result.classification !== "FULLY_VIABLE");
    check("classified INSUFFICIENT_UNKNOWN_DATA, not silently skipped", result.classification === "INSUFFICIENT_UNKNOWN_DATA");
    check("no price/deal fabricated from the drinks coupon", result.estimatedTotalCad === null && result.dealUsed === null);
    check("reason references Pizza Only / slice count, not a hidden guess", result.reason!.toLowerCase().includes("pizza"));
  }

  // --- Scenario 10: pizza capacity must satisfy people x 3, not just a cheap unit price ---
  console.log("Scenario 10: capacity must cover the whole group, not just one cheap unit");
  {
    const snapshot = fixtureSnapshot({
      deals: [{ code: "3021", name: "1 Medium 5 Topping Pizzas", price: 14.99, conditions: "Carryout,Delivery", slices: 8 }],
    });
    // A single unit ($14.99) looks affordable against a $20 budget, but 18
    // people need 54 slices -> 7 units -> $104.93, which does NOT fit.
    const overBudgetOnRealTotal = classifyDominosStore(snapshot, { people: 18, budget: 20 });
    check(
      "cheapest coupon alone is never enough - the full-group total is what's checked",
      overBudgetOnRealTotal.classification === "VIABLE_BUT_OVER_BUDGET"
    );

    const enoughBudget = classifyDominosStore(snapshot, { people: 18, budget: 150 });
    check("with enough budget for the real total, it's FULLY_VIABLE", enoughBudget.classification === "FULLY_VIABLE");
    check("required capacity is people x 3 = 54 slices", enoughBudget.dealUsed!.totalSlices >= 54);
    check("quantity is the real ceiling division (7), not guessed", enoughBudget.dealUsed!.quantity === 7);
  }

  // --- Scenario 11: unknown pizza capacity fails closed (real parsing rules) ---
  console.log("Scenario 11: unknown/ambiguous pizza capacity is never invented");
  {
    const menu = {
      Coupons: {
        single: { Code: "3203", Name: "1 Medium 2 Topping Pan Pizza", Price: "14.99", Tags: { Servings: "8 slices" } },
        fraction: { Code: "4191", Name: "1 Large Feast Pizza", Price: "20.99", Tags: { ServingSize: "1/8 pizza" } },
        bundled: {
          Code: "3076",
          Name: "1 Medium 3 Topping Pizza and Domino's Pizza Cheesy Bread",
          Price: "19.99",
          Tags: { Servings: "8 slices; 2pcs bread" },
        },
        multiPizza: {
          Code: "3275",
          Name: "2 Medium Pizzas With 6-Toppings Combined & 1 Cheesy Bread",
          Price: "29.99",
          Tags: { Servings: "8 slices; 2pcs bread" },
        },
        nonPizza: { Code: "8464", Name: "2 500ml Drinks and 2 Dip Cups", Price: "5.99", Tags: {} },
      },
      Products: {},
      Variants: {},
      Toppings: {},
    };
    const snapshot = await withMockedFetch({ [PROFILE_URL]: { body: profileFixture() }, [MENU_URL]: { body: menu } }, () =>
      getDominosStoreSnapshot("10950")
    );
    const byCode = Object.fromEntries(snapshot.deals.map((d) => [d.code, d]));
    check("a clean single-pizza 'N slices' string is trusted", byCode["3203"].slices === 8);
    check("a clean single-pizza '1/N pizza' fraction is trusted", byCode["4191"].slices === 8);
    check("a bundled serving string (pizza + bread) is NOT trusted - ambiguous scope", byCode["3076"].slices === null);
    check("a named multi-pizza bundle is NOT trusted even with serving text", byCode["3275"].slices === null);
    check("a non-pizza item with no serving data is unknown, not zero-capacity-by-accident", byCode["8464"].slices === null);

    const results = compareDominosStores([snapshot], { people: 6, budget: 200 }); // 18 slices required
    // Only "3203" (8 slices) and "4191" (8 slices) are usable; cheapest is 3203.
    check("classification uses only the trusted pizza deals", results[0].classification === "FULLY_VIABLE");
    check("the cheaper of the two trusted deals is chosen", results[0].dealUsed?.code === "3203");
  }

  // === New: tradeoff wording ============================================

  function comparisonResult(overrides: Partial<DominosComparisonResult>): DominosComparisonResult {
    return {
      storeId: "X",
      classification: "FULLY_VIABLE",
      reason: null,
      estimatedTotalCad: 100,
      dealUsed: { code: "3021", name: "1 Medium Pizza", price: 14.99, quantity: 7, totalSlices: 56 },
      waitMinutes: { min: 18, max: 28 },
      ...overrides,
    };
  }

  // --- Scenario 12: same-price tradeoff wording ---
  console.log("Scenario 12: equal price never renders 'Save $0.00' - shows the real time difference instead");
  {
    const a = comparisonResult({ storeId: "A", estimatedTotalCad: 100, waitMinutes: { min: 20, max: 28 } });
    const b = comparisonResult({ storeId: "B", estimatedTotalCad: 100, waitMinutes: { min: 15, max: 22 } });
    const tradeoff = describeDominosTradeoff([a, b]);
    check("kind is same-price-faster, not real-tradeoff with $0 savings", tradeoff.kind === "same-price-faster");
    if (tradeoff.kind === "same-price-faster") {
      check("faster store correctly identified", tradeoff.fasterStoreId === "B");
      check("slower store correctly identified", tradeoff.slowerStoreId === "A");
      check("savings minutes computed from real wait data", tradeoff.savingsMinutes === 6);
    }

    const tied = describeDominosTradeoff([
      comparisonResult({ storeId: "A", estimatedTotalCad: 100, waitMinutes: { min: 18, max: 28 } }),
      comparisonResult({ storeId: "B", estimatedTotalCad: 100, waitMinutes: { min: 18, max: 28 } }),
    ]);
    check("equal price AND equal wait -> no-tradeoff, no fabricated $0/0min savings", tied.kind === "no-tradeoff");
  }

  // --- Scenario 13: cheaper-vs-faster tradeoff still works ---
  console.log("Scenario 13: a genuine price/time tradeoff is still reported correctly");
  {
    const cheaperSlower = comparisonResult({ storeId: "A", estimatedTotalCad: 90, waitMinutes: { min: 18, max: 28 } });
    const pricierFaster = comparisonResult({ storeId: "B", estimatedTotalCad: 110, waitMinutes: { min: 10, max: 15 } });
    const tradeoff = describeDominosTradeoff([cheaperSlower, pricierFaster]);
    check("kind is real-tradeoff", tradeoff.kind === "real-tradeoff");
    if (tradeoff.kind === "real-tradeoff") {
      check("cheaper store identified correctly", tradeoff.cheaperStoreId === "A");
      check("faster store identified correctly", tradeoff.fasterStoreId === "B");
      check("real dollar savings computed", tradeoff.savingsCad === 20);
      check("real minute savings computed", tradeoff.savingsMinutes === 13);
    }
  }

  // --- Scenario 14: dietary success alone never bypasses capacity/budget ---
  console.log("Scenario 14: dietary verification still requires real pizza capacity AND budget");
  {
    // A dietary-safe deal (customizable, no meat needed) with NO known
    // slice capacity - dietary alone must not make this viable.
    const noCapacity = fixtureSnapshot({
      deals: [{ code: "X", name: "1 Medium 2 Topping Pizza", price: 14.99, conditions: "Carryout,Delivery", slices: null }],
    });
    const noCapacityResult = classifyDominosStore(noCapacity, { people: 6, budget: 200, dietaryRestrictions: ["vegetarian"] });
    check(
      "dietary-safe but unknown capacity is INSUFFICIENT_DIETARY_DATA, not FULLY_VIABLE",
      noCapacityResult.classification === "INSUFFICIENT_DIETARY_DATA"
    );

    // Dietary-safe AND known capacity, but budget too tight - still not viable.
    const overBudget = fixtureSnapshot({
      deals: [{ code: "X", name: "1 Medium 2 Topping Pizza", price: 50, conditions: "Carryout,Delivery", slices: 8 }],
    });
    const overBudgetResult = classifyDominosStore(overBudget, { people: 18, budget: 20, dietaryRestrictions: ["vegetarian"] });
    check(
      "dietary-safe + real capacity but over budget is VIABLE_BUT_OVER_BUDGET, not FULLY_VIABLE",
      overBudgetResult.classification === "VIABLE_BUT_OVER_BUDGET"
    );

    // Dietary-safe, real capacity, and enough budget - genuinely FULLY_VIABLE.
    const allGood = fixtureSnapshot({
      deals: [{ code: "X", name: "1 Medium 2 Topping Pizza", price: 14.99, conditions: "Carryout,Delivery", slices: 8 }],
    });
    const allGoodResult = classifyDominosStore(allGood, { people: 6, budget: 100, dietaryRestrictions: ["vegetarian", "noPork"] });
    check("dietary-safe + capacity + budget together -> genuinely FULLY_VIABLE", allGoodResult.classification === "FULLY_VIABLE");
    check("the verified deal is surfaced, not hidden", allGoodResult.dealUsed?.name === "1 Medium 2 Topping Pizza");

    // A fixed-recipe (Feast) deal can't be dietary-verified even though
    // it has known capacity/price - unknown composition excludes it
    // from the dietary-verified pool entirely.
    const feastOnly = fixtureSnapshot({
      deals: [{ code: "F", name: "1 Medium Feast Pizza", price: 16.99, conditions: "Carryout,Delivery", slices: 8 }],
    });
    const feastResult = classifyDominosStore(feastOnly, { people: 6, budget: 100, dietaryRestrictions: ["vegetarian"] });
    check(
      "a Feast deal with unknown composition is excluded from dietary verification -> INSUFFICIENT_DIETARY_DATA",
      feastResult.classification === "INSUFFICIENT_DIETARY_DATA"
    );

    // Legacy hasDietaryGroups (no specific restrictions) behavior is unchanged.
    const legacy = classifyDominosStore(allGood, { people: 6, budget: 100, hasDietaryGroups: true });
    check("legacy hasDietaryGroups without specifics still yields the blanket unknown", legacy.classification === "INSUFFICIENT_DIETARY_DATA");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

run();
