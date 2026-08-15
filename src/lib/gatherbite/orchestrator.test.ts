import assert from "node:assert/strict";
import test from "node:test";

import type { PlannerRunResult } from "../agents/dominosPlanner";
import type { DominosStoreSnapshot } from "../restaurants/dominos";
import type { DominosServiceabilityResult } from "../restaurants/dominosServiceability";
import type { CandidateEvidenceBundle, CandidateJourney, DominosCandidate, GatherBiteInput } from "./contracts";
import { evaluateGatherBite, type GatherBiteDependencies } from "./orchestrator";

const fetchedAt = "2026-08-15T12:00:00.000Z";
const input: GatherBiteInput = {
  attendees: 6, budgetCad: 100, serviceMethod: "either",
  deliveryAddress: { street: "1 Test St", city: "Charlottetown", province: "PE", postalCode: "C1A1A1" },
  groups: [], pizzaPreferences: ["pepperoni"],
};

function snapshot(storeId: string): DominosStoreSnapshot {
  return {
    provider: "dominos", storeId, address: `${storeId} public address`, isOpen: true, isOnlineNow: true,
    deliveryAvailable: true, carryoutAvailable: true, deliveryWaitMinutes: { min: 20, max: 30 },
    carryoutWaitMinutes: { min: 8, max: 12 }, deals: [],
    products: [{ id: "S_PIZZA", name: "Pizza", category: "Pizza", toppings: ["Pizza Sauce", "Cheese", "Pepperoni"], defaultToppingCodes: ["X", "C"], variantCodes: ["12SCREEN"], priceInfoIfAvailable: 14.99 }],
    variants: [{ code: "12SCREEN", name: '12" Hand Tossed', productCode: "S_PIZZA", sizeCode: "12", crustCode: "HANDTOSS", priceCad: 14.99, trustedSlices: 8 }],
    toppingOptions: [{ code: "X", name: "Pizza Sauce", category: "Sauce" }, { code: "C", name: "Cheese", category: "Cheese" }, { code: "P", name: "Pepperoni", category: "Pizza" }],
    fetchedAt, status: "ok", errors: [],
  };
}

function serviceability(): DominosServiceabilityResult {
  return { status: "SERVICEABLE", applicability: "REQUIRED", storeIds: ["10950", "10953"], observedAt: fetchedAt, source: "official test lookup", reason: "serviceable" };
}

function candidate(id: string, storeId: string): DominosCandidate {
  return {
    candidateId: id, candidateVersion: 1, snapshotVersion: `${storeId}:${fetchedAt}`, storeId, serviceMethod: "carryout", dealCodes: [],
    pizzas: [{ lineId: `${id}-line`, quantity: 3, productCode: "S_PIZZA", variantCode: "12SCREEN", sizeCode: "12", crustCode: "HANDTOSS", sauceCode: "X", cheeseCode: "C", toppings: [{ code: "P", quantity: 1 }], purpose: "general", protectsGroupIds: [], trustedSlicesPerPizza: 8 }],
    expectedPricing: { subtotalCad: 30, taxCad: 4.5, feesCad: 0, totalCad: 34.5 },
  };
}

function approved(value: DominosCandidate): CandidateJourney {
  const pass = (code: string, facts: unknown = {}) => ({ status: "PASS" as const, code, summary: "pass", facts, source: "exact test evidence" });
  const evidence: CandidateEvidenceBundle = {
    candidateId: value.candidateId, candidateVersion: 1, snapshotVersion: value.snapshotVersion,
    checks: { menuIntegrity: pass("MENU"), dietary: pass("DIETARY"), capacity: pass("CAPACITY", { requiredSlices: 18, totalSlices: 24 }), budget: pass("BUDGET", { totalCad: 34.5 }), availability: pass("AVAILABLE", { waitMinutes: { min: 8, max: 12 } }), serviceability: pass("SERVICEABLE") },
    preference: { requested: ["pepperoni"], represented: ["pepperoni"], unmet: [] }, collectedAt: fetchedAt,
  };
  return { candidate: value, outcome: { status: "DECIDED", decision: { candidateId: value.candidateId, candidateVersion: 1, snapshotVersion: value.snapshotVersion, decision: "APPROVE", disposition: "NONE", reasons: ["approved"], unknowns: [] }, evidence }, adaptedFromCandidateId: null };
}

function dependencies(overrides: Partial<GatherBiteDependencies> = {}): GatherBiteDependencies {
  return {
    supportedStoreIds: ["10950", "10953"],
    observeStores: async (ids) => ids.map(snapshot),
    checkServiceability: async () => serviceability(),
    runPlanner: async () => ({ journeys: [], verificationAttempts: 0, terminal: false }),
    plannerModel: null as never,
    verifyCandidate: null as never,
    now: () => Date.parse("2026-08-15T12:01:00.000Z"),
    deadlineMs: 2_000,
    ...overrides,
  };
}

test("store observation and serviceability start concurrently, fetch once, and share one immutable observation with Planner", async () => {
  const started: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let storeCalls = 0;
  let serviceCalls = 0;
  let plannerCalls = 0;

  const resultPromise = evaluateGatherBite(input, dependencies({
    observeStores: async (ids) => { storeCalls += 1; started.push("stores"); if (started.length === 2) release(); await gate; return ids.map(snapshot); },
    checkServiceability: async () => { serviceCalls += 1; started.push("serviceability"); if (started.length === 2) release(); await gate; return serviceability(); },
    runPlanner: async (_request, deps): Promise<PlannerRunResult> => {
      plannerCalls += 1;
      const first = await deps.observationPromise;
      const second = await deps.observationPromise;
      assert.equal(first, second);
      assert.equal(first.catalogs.get("10950")?.snapshotVersion, `10950:${fetchedAt}`);
      assert.throws(() => (first.catalogs as Map<string, unknown>).set("bad", {}), /read.only|immutable/i);
      return { journeys: [approved(candidate("one", "10950")), approved(candidate("two", "10953"))], verificationAttempts: 2, terminal: false };
    },
  }));

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(new Set(started), new Set(["stores", "serviceability"]));
  const result = await resultPromise;
  assert.equal(storeCalls, 1);
  assert.equal(serviceCalls, 1);
  assert.equal(plannerCalls, 1);
  assert.equal(result.recommended !== null, true);
  assert.equal(result.recommended?.storeAddress, "10950 public address");
  assert.equal(result.recommended?.displayLines[0]?.productName, "Pizza");
  assert.equal(result.recommended?.displayLines[0]?.variantName, '12" Hand Tossed');
  assert.equal(result.recommended?.displayLines[0]?.toppings[0]?.name, "Pepperoni");
  assert.equal(result.alternatives.length, 1);
  assert.equal(JSON.stringify(result).includes("little-caesars"), false);
});

test("retained provider references cannot mutate the immutable observation or diverge it from catalogs", async () => {
  const retained = snapshot("10950");
  let inspected = false;
  await evaluateGatherBite(input, dependencies({
    supportedStoreIds: ["10950"],
    observeStores: async () => [retained],
    runPlanner: async (_request, deps) => {
      const observed = await deps.observationPromise;
      retained.address = "mutated private address";
      retained.products[0]!.name = "Mutated product";
      retained.products[0]!.defaultToppingCodes = ["BAD"];
      retained.products.push({ id: "BAD", name: "Bad", category: "Pizza", toppings: [], defaultToppingCodes: [], variantCodes: [], priceInfoIfAvailable: 0 });
      retained.variants![0]!.priceCad = 999;
      retained.toppingOptions!.push({ code: "BAD", name: "Bad", category: "Pizza" });
      retained.errors.push("mutated error");

      const immutable = observed.snapshots[0]!;
      assert.equal(immutable.address, "10950 public address");
      assert.equal(immutable.products[0]?.name, "Pizza");
      assert.deepEqual(immutable.products[0]?.defaultToppingCodes, ["X", "C"]);
      assert.equal(immutable.products.length, 1);
      assert.equal(immutable.variants?.[0]?.priceCad, 14.99);
      assert.equal(immutable.toppingOptions?.length, 3);
      assert.deepEqual(immutable.errors, []);
      assert.equal(observed.catalogs.get("10950")?.productsByCode.get("S_PIZZA")?.name, "Pizza");
      assert.equal(observed.catalogs.get("10950")?.variantsByCode.get("12SCREEN")?.priceCad, 14.99);
      assert.throws(() => immutable.products.push(retained.products[0]!), TypeError);
      assert.throws(() => (immutable.products[0]!.defaultToppingCodes as string[]).push("BAD"), TypeError);
      inspected = true;
      return { journeys: [], verificationAttempts: 0, terminal: false };
    },
  }));
  assert.equal(inspected, true, "orchestration must not swallow this mutation regression as a passing test");
});

test("candidate rejection and adaptation events remain in emitted candidate order", async () => {
  const emitted: string[] = [];
  await evaluateGatherBite(input, dependencies({
    runPlanner: async (_request, deps) => {
      deps.onEvent?.({ type: "candidate", candidateId: "first", summary: "first" });
      deps.onEvent?.({ type: "decision", candidateId: "first", decision: "REJECT", reason: "capacity" });
      deps.onEvent?.({ type: "stage", stage: "adapting", message: "adapting" });
      deps.onEvent?.({ type: "candidate", candidateId: "second", summary: "second" });
      deps.onEvent?.({ type: "decision", candidateId: "second", decision: "APPROVE", reason: "verified" });
      return { journeys: [approved(candidate("second", "10950"))], verificationAttempts: 2, terminal: false };
    },
  }), (event) => {
    if (event.type === "candidate" || event.type === "decision") emitted.push(`${event.type}:${event.candidateId}`);
    if (event.type === "stage" && event.stage === "adapting") emitted.push("stage:adapting");
  });
  assert.deepEqual(emitted, ["candidate:first", "decision:first", "stage:adapting", "candidate:second", "decision:second"]);
});

test("transient store transport failures retry once while structured terminal results are returned honestly", async () => {
  let calls = 0;
  const result = await evaluateGatherBite(input, dependencies({
    observeStores: async (ids) => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("temporary"), { statusCode: 503 });
      return ids.map(snapshot);
    },
    runPlanner: async () => ({ journeys: [], verificationAttempts: 0, terminal: true }),
  }));
  assert.equal(calls, 2);
  assert.equal(result.recommended, null);
  assert.equal(typeof result.noViableReason, "string");
});

test("the overall deadline aborts observation and Planner/model work and fails closed", async () => {
  let observedAbort = false;
  let plannerAbort = false;
  const result = await evaluateGatherBite(input, dependencies({
    deadlineMs: 15,
    observeStores: async (_ids, _timing, signal) => new Promise((resolve) => {
      assert.ok(signal);
      signal.addEventListener("abort", () => { observedAbort = true; resolve([]); }, { once: true });
    }),
    runPlanner: async (_request, deps) => new Promise((resolve) => {
      deps.abortSignal?.addEventListener("abort", () => {
        plannerAbort = true;
        resolve({ journeys: [], verificationAttempts: 0, terminal: true });
      }, { once: true });
    }),
  }));
  assert.equal(observedAbort, true);
  assert.equal(plannerAbort, true);
  assert.equal(result.recommended, null);
  assert.equal(result.events.some((event) => event.type === "error"), true);
});

test("normal no-candidate completion aborts eager observation work that Planner never consumed", async () => {
  let observedAbort = false;
  await evaluateGatherBite(input, dependencies({
    observeStores: async (_ids, _timing, signal) => new Promise((resolve) => {
      assert.ok(signal);
      signal.addEventListener("abort", () => { observedAbort = true; resolve([]); }, { once: true });
    }),
    runPlanner: async () => ({ journeys: [], verificationAttempts: 0, terminal: false }),
  }));
  assert.equal(observedAbort, true);
});

test("an external request abort reaches observation and Planner/model work without replacing the internal deadline", async () => {
  const requestController = new AbortController();
  let observedAbort = false;
  let plannerAbort = false;
  const resultPromise = evaluateGatherBite(input, dependencies({
    deadlineMs: 2_000,
    observeStores: async (_ids, _timing, signal) => new Promise((resolve) => {
      signal?.addEventListener("abort", () => { observedAbort = true; resolve([]); }, { once: true });
    }),
    runPlanner: async (_request, deps) => new Promise((resolve) => {
      deps.abortSignal?.addEventListener("abort", () => {
        plannerAbort = true;
        resolve({ journeys: [], verificationAttempts: 0, terminal: true });
      }, { once: true });
    }),
  }), undefined, requestController.signal);

  requestController.abort();
  await assert.rejects(resultPromise, { name: "AbortError", message: "GatherBite evaluation was cancelled." });
  assert.equal(observedAbort, true);
  assert.equal(plannerAbort, true);
});
