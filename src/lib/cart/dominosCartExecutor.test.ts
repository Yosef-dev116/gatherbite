import assert from "node:assert/strict";
import test from "node:test";

import type { CandidatePizza, DominosCandidate, GatherBiteInput } from "../gatherbite/contracts";
import type { ActualDominosCart, CartPreparationResult, PrepareCartInput } from "./contracts";
import { buildGuidedHandoff } from "./dominosCartFallback";
import type { BrowserDriver, BrowserSnapshot } from "./dominosCartExecutor";
import { createDominosCartExecutor } from "./dominosCartExecutor";

function pizza(overrides: Partial<CandidatePizza> = {}): CandidatePizza {
  return {
    lineId: "line-1",
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
    ...overrides,
  };
}

function candidate(overrides: Partial<DominosCandidate> = {}): DominosCandidate {
  return {
    candidateId: "cand-1",
    candidateVersion: 1,
    snapshotVersion: "10950:2026-08-15T03:14:17.698Z",
    storeId: "10950",
    serviceMethod: "carryout",
    dealCodes: ["3021"],
    pizzas: [pizza()],
    expectedPricing: { subtotalCad: 22.5, taxCad: 3.38, feesCad: 0, totalCad: 25.88 },
    ...overrides,
  };
}

function organizerInput(): GatherBiteInput {
  return {
    attendees: 8,
    budgetCad: 100,
    serviceMethod: "carryout",
    groups: [],
    pizzaPreferences: [],
  };
}

function prepareInput(overrides: Partial<PrepareCartInput> = {}): PrepareCartInput {
  return { candidate: candidate(), organizerInput: organizerInput(), ...overrides };
}

function matchingCart(): ActualDominosCart {
  return {
    storeId: "10950",
    serviceMethod: "carryout",
    items: [{
      productCode: "S_PIZZA",
      variantCode: "12SCREEN",
      quantity: 2,
      sizeCode: "12",
      crustCode: "HANDTOSS",
      sauceCode: "X",
      cheeseCode: "C",
      toppings: [{ code: "P", quantity: 1 }],
    }],
    couponCodes: ["3021"],
    subtotalCad: 22.5,
    taxCad: 3.38,
    feesCad: 0,
    totalCad: 25.88,
    observedAt: "2026-08-15T04:00:00.000Z",
  };
}

function mismatchedCart(): ActualDominosCart {
  const cart = matchingCart();
  cart.storeId = "99999";
  return cart;
}

function snapshot(overrides: Partial<BrowserSnapshot> = {}): BrowserSnapshot {
  return {
    url: "https://www.dominos.ca/en/pages/order/?route=1",
    title: "Domino's",
    pageKind: "configuration",
    controls: [],
    cart: null,
    ...overrides,
  };
}

interface FakeDriverConfig {
  snapshots: BrowserSnapshot[];
  performThrows?: number; // number of leading perform() calls that throw before succeeding
  handoffUrl?: string | null;
}

interface FakeDriver extends BrowserDriver {
  calls: { snapshot: number; perform: number; close: number; handoffUrl: number };
  performedActions: Array<{ kind: string; label: string; context: string }>;
}

function createFakeDriver(config: FakeDriverConfig): FakeDriver {
  const snapshots = [...config.snapshots];
  const calls = { snapshot: 0, perform: 0, close: 0, handoffUrl: 0 };
  const performedActions: Array<{ kind: string; label: string; context: string }> = [];
  let performThrowsRemaining = config.performThrows ?? 0;

  return {
    calls,
    performedActions,
    async snapshot() {
      calls.snapshot += 1;
      const next = snapshots.shift();
      if (!next) throw new Error("fake driver ran out of scripted snapshots");
      return next;
    },
    async perform(action) {
      calls.perform += 1;
      performedActions.push(action);
      if (performThrowsRemaining > 0) {
        performThrowsRemaining -= 1;
        throw new Error("transient automation failure");
      }
    },
    async handoffUrl() {
      calls.handoffUrl += 1;
      return config.handoffUrl ?? null;
    },
    async close() {
      calls.close += 1;
    },
  };
}

const nonSuccessResults: CartPreparationResult[] = [];

test("NOT_STARTED -> PREPARING -> PREPARED_AND_OBSERVED: matching cart and a transferable session succeed", async () => {
  const driver = createFakeDriver({
    snapshots: [
      snapshot({ pageKind: "configuration" }),
      snapshot({ pageKind: "cart", cart: matchingCart() }),
    ],
    handoffUrl: "https://www.dominos.ca/en/pages/order/?route=1&handoff=abc",
  });
  const executor = createDominosCartExecutor({ mode: "transferable-browser", browserDriver: driver, timeoutMs: 10_000 });

  const result = await executor.prepare(prepareInput());

  assert.equal(result.status, "PREPARED_AND_OBSERVED");
  assert.deepEqual(result.actualCart, matchingCart());
  assert.equal(result.comparison?.matches, true);
  assert.equal(result.handoffUrl, "https://www.dominos.ca/en/pages/order/?route=1&handoff=abc");
  assert.deepEqual(result.fallback, buildGuidedHandoff(candidate()));

  // One session, one initial build: exactly one perform() call, driver closed exactly once.
  assert.equal(driver.calls.perform, 1);
  assert.equal(driver.calls.close, 1);
});

test("NOT_STARTED -> PREPARING -> NEEDS_HUMAN_CAPTCHA: stops immediately without any guarded action attempt", async () => {
  const driver = createFakeDriver({
    snapshots: [snapshot({ pageKind: "captcha" })],
  });
  const executor = createDominosCartExecutor({ mode: "transferable-browser", browserDriver: driver, timeoutMs: 10_000 });

  const result = await executor.prepare(prepareInput());

  assert.equal(result.status, "NEEDS_HUMAN_CAPTCHA");
  assert.equal(driver.calls.perform, 0, "CAPTCHA must stop immediately, never consuming the recovery budget");
  assert.equal(driver.calls.close, 1);
  assert.deepEqual(result.fallback, buildGuidedHandoff(candidate()));
  nonSuccessResults.push(result);
});

test("NOT_STARTED -> PREPARING -> NEEDS_HUMAN_LOGIN: stops immediately without any guarded action attempt", async () => {
  const driver = createFakeDriver({
    snapshots: [snapshot({ pageKind: "login" })],
  });
  const executor = createDominosCartExecutor({ mode: "transferable-browser", browserDriver: driver, timeoutMs: 10_000 });

  const result = await executor.prepare(prepareInput());

  assert.equal(result.status, "NEEDS_HUMAN_LOGIN");
  assert.equal(driver.calls.perform, 0, "failed authentication must stop immediately, never consuming the recovery budget");
  assert.equal(driver.calls.close, 1);
  assert.deepEqual(result.fallback, buildGuidedHandoff(candidate()));
  nonSuccessResults.push(result);
});

test("NOT_STARTED -> PREPARING -> CART_MISMATCH: one initial build plus exactly one corrective rebuild, still mismatched", async () => {
  const driver = createFakeDriver({
    snapshots: [
      snapshot({ pageKind: "configuration" }),
      snapshot({ pageKind: "cart", cart: mismatchedCart() }),
      snapshot({ pageKind: "configuration" }),
      snapshot({ pageKind: "cart", cart: mismatchedCart() }),
    ],
  });
  const executor = createDominosCartExecutor({ mode: "transferable-browser", browserDriver: driver, timeoutMs: 10_000 });

  const result = await executor.prepare(prepareInput());

  assert.equal(result.status, "CART_MISMATCH");
  assert.equal(result.comparison?.matches, false);
  assert.deepEqual(result.actualCart, mismatchedCart());
  // Exactly two build phases: one initial build, one corrective rebuild — never more.
  assert.equal(driver.calls.perform, 2);
  assert.equal(driver.calls.close, 1);
  assert.deepEqual(result.fallback, buildGuidedHandoff(candidate()));
  nonSuccessResults.push(result);
});

test("NOT_STARTED -> PREPARING -> SESSION_NOT_TRANSFERABLE: cart matches but no handoff URL is available", async () => {
  const driver = createFakeDriver({
    snapshots: [
      snapshot({ pageKind: "configuration" }),
      snapshot({ pageKind: "cart", cart: matchingCart() }),
    ],
    handoffUrl: null,
  });
  const executor = createDominosCartExecutor({ mode: "transferable-browser", browserDriver: driver, timeoutMs: 10_000 });

  const result = await executor.prepare(prepareInput());

  assert.equal(result.status, "SESSION_NOT_TRANSFERABLE");
  assert.equal(result.comparison?.matches, true);
  assert.equal(result.handoffUrl, null);
  assert.deepEqual(result.fallback, buildGuidedHandoff(candidate()));
  nonSuccessResults.push(result);
});

test("NOT_STARTED -> PREPARING -> TIMED_OUT: a hard timeout stops preparation without any driver interaction", async () => {
  const driver = createFakeDriver({ snapshots: [snapshot({ pageKind: "cart", cart: matchingCart() })] });
  const executor = createDominosCartExecutor({ mode: "transferable-browser", browserDriver: driver, timeoutMs: -1 });

  const result = await executor.prepare(prepareInput());

  assert.equal(result.status, "TIMED_OUT");
  assert.equal(driver.calls.snapshot, 0);
  assert.equal(driver.calls.perform, 0);
  assert.equal(driver.calls.close, 1, "the session must still be closed even after a timeout");
  assert.deepEqual(result.fallback, buildGuidedHandoff(candidate()));
  nonSuccessResults.push(result);
});

test("every non-success result carries the exact guided-handoff fallback (FALLBACK_READY guarantee)", () => {
  assert.ok(nonSuccessResults.length >= 5, "expected the non-success scenarios above to have run first");
  for (const result of nonSuccessResults) {
    assert.notEqual(result.status, "PREPARED_AND_OBSERVED");
    assert.deepEqual(result.fallback, buildGuidedHandoff(candidate()));
  }
});

test("a recoverable step retries a transient perform() failure up to three attempts before succeeding", async () => {
  const driver = createFakeDriver({
    snapshots: [
      snapshot({ pageKind: "configuration" }),
      snapshot({ pageKind: "cart", cart: matchingCart() }),
    ],
    performThrows: 2,
    handoffUrl: "https://www.dominos.ca/en/pages/order/?route=1&handoff=xyz",
  });
  const executor = createDominosCartExecutor({ mode: "transferable-browser", browserDriver: driver, timeoutMs: 10_000 });

  const result = await executor.prepare(prepareInput());

  assert.equal(result.status, "PREPARED_AND_OBSERVED");
  assert.equal(driver.calls.perform, 3, "should retry the failing step up to three attempts total");
});

test("a recoverable step gives up after exhausting three attempts, never looping forever", async () => {
  const driver = createFakeDriver({
    snapshots: [snapshot({ pageKind: "configuration" })],
    performThrows: 99,
  });
  const executor = createDominosCartExecutor({ mode: "transferable-browser", browserDriver: driver, timeoutMs: 10_000 });

  const result = await executor.prepare(prepareInput());

  assert.equal(driver.calls.perform, 3, "must bound retries at three attempts and stop");
  assert.notEqual(result.status, "PREPARED_AND_OBSERVED");
  assert.deepEqual(result.fallback, buildGuidedHandoff(candidate()));
  assert.equal(driver.calls.close, 1);
});

test("guided-handoff mode always returns FALLBACK_READY immediately with no browser or network action attempted", async () => {
  const driver = createFakeDriver({ snapshots: [] });
  const executor = createDominosCartExecutor({ mode: "guided-handoff", browserDriver: driver, timeoutMs: 10_000 });

  const result = await executor.prepare(prepareInput());

  assert.equal(result.status, "FALLBACK_READY");
  assert.equal(result.actualCart, null);
  assert.deepEqual(result.fallback, buildGuidedHandoff(candidate()));
  assert.equal(driver.calls.snapshot, 0);
  assert.equal(driver.calls.perform, 0);
  assert.equal(driver.calls.close, 0);
});

test("guided-handoff mode works with no browserDriver configured at all", async () => {
  const executor = createDominosCartExecutor({ mode: "guided-handoff", timeoutMs: 10_000 });
  const result = await executor.prepare(prepareInput());
  assert.equal(result.status, "FALLBACK_READY");
  assert.deepEqual(result.fallback, buildGuidedHandoff(candidate()));
});

test("supported-deep-link mode returns only proven state (none) plus the guide: immediate FALLBACK_READY", async () => {
  const driver = createFakeDriver({ snapshots: [] });
  const executor = createDominosCartExecutor({ mode: "supported-deep-link", browserDriver: driver, timeoutMs: 10_000 });

  const result = await executor.prepare(prepareInput());

  assert.equal(result.status, "FALLBACK_READY");
  assert.equal(result.actualCart, null);
  assert.deepEqual(result.fallback, buildGuidedHandoff(candidate()));
  assert.equal(driver.calls.snapshot, 0);
  assert.equal(driver.calls.close, 0);
});

test("transferable-browser mode without a configured driver reports automation unavailable, never claims success", async () => {
  const executor = createDominosCartExecutor({ mode: "transferable-browser", timeoutMs: 10_000 });
  const result = await executor.prepare(prepareInput());

  assert.equal(result.status, "AUTOMATION_UNAVAILABLE");
  assert.equal(result.actualCart, null);
  assert.deepEqual(result.fallback, buildGuidedHandoff(candidate()));
});

test("never claims a prepared cart when the driver observed a mismatch, even though a cart object exists", async () => {
  const driver = createFakeDriver({
    snapshots: [
      snapshot({ pageKind: "configuration" }),
      snapshot({ pageKind: "cart", cart: mismatchedCart() }),
      snapshot({ pageKind: "configuration" }),
      snapshot({ pageKind: "cart", cart: mismatchedCart() }),
    ],
  });
  const executor = createDominosCartExecutor({ mode: "transferable-browser", browserDriver: driver, timeoutMs: 10_000 });
  const result = await executor.prepare(prepareInput());

  assert.notEqual(result.status, "PREPARED_AND_OBSERVED");
  assert.notEqual(result.status, "PREPARED_AND_VERIFIED");
});
