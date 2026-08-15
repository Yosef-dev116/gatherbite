import assert from "node:assert/strict";
import test from "node:test";

import { getDominosStoreSnapshot, type DominosStoreSnapshot } from "./dominos";
import { buildDominosCatalog, observeSupportedDominosStores } from "./dominosCatalog";
import {
  DOMINOS_CONFIGURABLE_MENU_FIXTURE,
  DOMINOS_CONFIGURABLE_MENU_RAW_FIXTURE,
} from "./fixtures/dominos-configurable-menu.fixture";

function configurableSnapshot(): DominosStoreSnapshot {
  const fixture = DOMINOS_CONFIGURABLE_MENU_FIXTURE;
  return {
    provider: "dominos",
    storeId: fixture.storeId,
    address: "386 University Ave, Charlottetown, PE",
    isOpen: true,
    isOnlineNow: true,
    deliveryAvailable: true,
    carryoutAvailable: true,
    deliveryWaitMinutes: { min: 14, max: 24 },
    carryoutWaitMinutes: { min: 9, max: 14 },
    deals: [
      {
        code: fixture.deal.code,
        name: fixture.deal.name,
        price: fixture.deal.displayedPriceCad,
        conditions: "Carryout,Delivery",
        slices: fixture.deal.trustedSlices,
      },
      {
        code: "AMBIGUOUS",
        name: "2 Medium Pizzas and a Side",
        price: 29.99,
        conditions: "Carryout,Delivery",
        slices: null,
      },
    ],
    products: [
      {
        id: fixture.product.code,
        name: fixture.product.name,
        category: fixture.product.productType,
        toppings: [fixture.sauce.name, fixture.cheese.name],
        defaultToppingCodes: fixture.product.defaultToppings.map(({ code }) => code),
        variantCodes: [...fixture.product.variantCodes],
        priceInfoIfAvailable: fixture.variant.menuPriceCad,
      },
    ],
    variants: [
      {
        code: fixture.variant.code,
        productCode: fixture.variant.productCode,
        sizeCode: fixture.variant.size.code,
        crustCode: fixture.variant.crust.code,
        priceCad: fixture.variant.menuPriceCad,
        trustedSlices: fixture.variant.trustedSlices,
      },
    ],
    toppingOptions: [
      { code: fixture.sauce.code, name: fixture.sauce.name, category: "Sauce" },
      { code: fixture.cheese.code, name: fixture.cheese.name, category: "Cheese" },
      ...fixture.toppings.map((topping) => ({ ...topping, category: "Pizza" })),
    ],
    fetchedAt: fixture.sourceObservedAt,
    status: "ok",
    errors: [],
  };
}

async function parsedConfigurableSnapshot(): Promise<DominosStoreSnapshot> {
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = input.toString();
    return {
      ok: true,
      status: 200,
      json: async () => url.endsWith("/profile")
        ? {
            StoreID: DOMINOS_CONFIGURABLE_MENU_FIXTURE.storeId,
            IsOpen: true,
            IsOnlineNow: true,
            AllowDeliveryOrders: true,
            AllowCarryoutOrders: true,
          }
        : DOMINOS_CONFIGURABLE_MENU_RAW_FIXTURE,
    } as Response;
  }) as typeof fetch;

  try {
    return await getDominosStoreSnapshot(DOMINOS_CONFIGURABLE_MENU_FIXTURE.storeId);
  } finally {
    global.fetch = originalFetch;
  }
}

test("buildDominosCatalog indexes production-parsed configurable identifiers", async () => {
  const fixture = DOMINOS_CONFIGURABLE_MENU_FIXTURE;
  const snapshot = await parsedConfigurableSnapshot();
  const catalog = buildDominosCatalog(snapshot);

  assert.equal(catalog.snapshotVersion, `${fixture.storeId}:${snapshot.fetchedAt}`);
  assert.equal(catalog.toppingsByCode.get("P")?.name, "Pepperoni");
  assert.deepEqual(catalog.productsByCode.get("S_PIZZA")?.defaultToppingCodes, ["X", "C"]);
  assert.equal(catalog.productsByCode.get("S_PIZZA")?.defaultToppingCodes.includes("P"), false);
  assert.equal(catalog.variantsByCode.get("12SCREEN")?.priceCad, 14.99);
  assert.equal(catalog.variantsByCode.get("12SCREEN")?.trustedSlices, 8);
  assert.equal(catalog.dealsByCode.get("3021")?.trustedSlices, null);
});

test("catalogue values and indexes cannot be mutated through the public surface", () => {
  const catalog = buildDominosCatalog(configurableSnapshot());
  const product = catalog.productsByCode.get("S_PIZZA");

  assert.ok(product);
  assert.equal(Object.isFrozen(product), true);
  assert.equal(Object.isFrozen(product.defaultToppingCodes), true);
  assert.equal("set" in catalog.productsByCode, false);
  assert.equal(catalog.dealsByCode.get("AMBIGUOUS")?.trustedSlices, null);
});

test("observeSupportedDominosStores starts unique valid store observations together and records rejected ids", async () => {
  const originalFetch = global.fetch;
  const started: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  global.fetch = (async (input: RequestInfo | URL) => {
    const url = input.toString();
    started.push(url);
    await gate;
    const isProfile = url.endsWith("/profile");
    return {
      ok: true,
      status: 200,
      json: async () => isProfile
        ? { StoreID: url.includes("10950") ? "10950" : "10953" }
        : { Coupons: {}, Products: {}, Variants: {}, Toppings: {} },
    } as Response;
  }) as typeof fetch;

  try {
    const observing = observeSupportedDominosStores(["10950", "", "10950", " 10953 "]);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(started.length, 4, "both endpoints for both stores should start before any resolves");
    release();
    const snapshots = await observing;
    assert.deepEqual(snapshots.map(({ storeId }) => storeId), ["10950", "10953"]);
    assert.equal(snapshots[0]?.errors.some((error) => error.includes("empty store identifier")), true);
    assert.equal(snapshots[0]?.errors.some((error) => error.includes("duplicate store identifier: 10950")), true);
  } finally {
    release();
    global.fetch = originalFetch;
  }
});
