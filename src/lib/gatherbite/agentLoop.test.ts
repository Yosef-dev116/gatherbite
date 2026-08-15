import assert from "node:assert/strict";
import test from "node:test";

import type { LanguageModel } from "ai";

import type {
  DominosCandidate,
  GatherBiteInput,
  VerificationOutcome,
} from "./contracts";
import type { DominosStoreSnapshot } from "../restaurants/dominos";
import { buildDominosCatalog } from "../restaurants/dominosCatalog";
import type { DominosServiceabilityResult } from "../restaurants/dominosServiceability";
import type { DominosObservationContext } from "../agents/dominosPlanner";
import type {
  VerifyCandidateDeps,
  VerifyCandidateInput,
} from "../agents/dominosVerifier";
import {
  shouldStopDominosLoop,
  verifyObservedDominosCandidate,
} from "./agentLoop";

const FETCHED_AT = "2026-08-15T12:00:00.000Z";

function snapshot(): DominosStoreSnapshot {
  return {
    provider: "dominos",
    storeId: "10950",
    address: "386 University Ave, Charlottetown, PE",
    isOpen: true,
    isOnlineNow: true,
    deliveryAvailable: true,
    carryoutAvailable: true,
    deliveryWaitMinutes: { min: 14, max: 24 },
    carryoutWaitMinutes: { min: 9, max: 14 },
    deals: [],
    products: [{
      id: "S_PIZZA",
      name: "Pizza",
      category: "Pizza",
      toppings: ["Pizza Sauce", "Cheese"],
      defaultToppingCodes: ["X", "C"],
      variantCodes: ["12SCREEN"],
      priceInfoIfAvailable: 14.99,
    }],
    variants: [{
      code: "12SCREEN",
      productCode: "S_PIZZA",
      sizeCode: "12",
      crustCode: "HANDTOSS",
      priceCad: 14.99,
      trustedSlices: 8,
    }],
    toppingOptions: [
      { code: "X", name: "Pizza Sauce", category: "Sauce" },
      { code: "C", name: "Cheese", category: "Cheese" },
    ],
    fetchedAt: FETCHED_AT,
    status: "ok",
    errors: [],
  };
}

function observation(): DominosObservationContext {
  const liveSnapshot = snapshot();
  return {
    snapshots: [liveSnapshot],
    catalogs: new Map([[liveSnapshot.storeId, buildDominosCatalog(liveSnapshot)]]),
    serviceability: {
      status: "SERVICEABLE",
      applicability: "NOT_REQUIRED",
      storeIds: [],
      observedAt: FETCHED_AT,
      source: "Not applicable to carryout",
      reason: "A delivery address is not required for carryout.",
    },
    observedAt: "2026-08-15T12:01:00.000Z",
  };
}

function input(): GatherBiteInput {
  return {
    attendees: 2,
    budgetCad: 50,
    serviceMethod: "carryout",
    groups: [],
    pizzaPreferences: ["cheese"],
  };
}

function candidate(overrides: Partial<DominosCandidate> = {}): DominosCandidate {
  return {
    candidateId: "candidate-1",
    candidateVersion: 1,
    snapshotVersion: `10950:${FETCHED_AT}`,
    storeId: "10950",
    serviceMethod: "carryout",
    dealCodes: [],
    pizzas: [{
      lineId: "line-1",
      quantity: 1,
      productCode: "S_PIZZA",
      variantCode: "12SCREEN",
      sizeCode: "12",
      crustCode: "HANDTOSS",
      sauceCode: "X",
      cheeseCode: "C",
      toppings: [],
      purpose: "general",
      protectsGroupIds: [],
      trustedSlicesPerPizza: 8,
    }],
    expectedPricing: {
      subtotalCad: 14.99,
      taxCad: 2.25,
      feesCad: 0,
      totalCad: 17.24,
    },
    ...overrides,
  };
}

test("the loop stops only at a terminal verdict, three attempts, or two distinct approvals", () => {
  assert.equal(shouldStopDominosLoop({
    verificationAttempts: 2,
    approvedCandidateIds: new Set(["candidate-1"]),
    terminal: false,
  }), false);
  assert.equal(shouldStopDominosLoop({
    verificationAttempts: 2,
    approvedCandidateIds: new Set(),
    terminal: true,
  }), true);
  assert.equal(shouldStopDominosLoop({
    verificationAttempts: 3,
    approvedCandidateIds: new Set(),
    terminal: false,
  }), true);
  assert.equal(shouldStopDominosLoop({
    verificationAttempts: 2,
    approvedCandidateIds: new Set(["candidate-1", "candidate-2"]),
    terminal: false,
  }), true);
});

test("the orchestration boundary supplies live context but never trusts Planner expected pricing", async () => {
  let receivedDeps: VerifyCandidateDeps | null = null;
  const verified: VerificationOutcome = {
    status: "VERIFIER_ERROR",
    reason: "Verification could not complete safely.",
    evidence: null,
  };
  const verify = async (
    request: VerifyCandidateInput | null,
    deps: VerifyCandidateDeps,
  ): Promise<VerificationOutcome> => {
    assert.ok(request);
    receivedDeps = deps;
    const evidence = await deps.collectEvidence(request.evidenceContext);
    assert.equal(evidence.checks.budget.status, "UNKNOWN");
    assert.equal(request.evidenceContext.priceEvidence.status, "UNKNOWN");
    assert.equal(request.evidenceContext.priceEvidence.subtotalCad, null);
    assert.equal(request.evidenceContext.priceEvidence.totalCad, null);
    return verified;
  };

  const result = await verifyObservedDominosCandidate({
    input: input(),
    candidate: candidate(),
    observation: observation(),
    verifierModel: "fake:verifier" as LanguageModel,
    verifyCandidate: verify,
  });

  assert.deepEqual(result, verified);
  assert.ok(receivedDeps);
});

test("a stale or unobserved candidate fails closed before any verifier model call", async () => {
  let calls = 0;
  const privateMarker = "private-provider-error-and-address";
  const result = await verifyObservedDominosCandidate({
    input: input(),
    candidate: candidate({ snapshotVersion: "10950:stale" }),
    observation: observation(),
    verifierModel: "fake:verifier" as LanguageModel,
    verifyCandidate: async () => {
      calls += 1;
      throw new Error(privateMarker);
    },
  });

  assert.equal(calls, 0);
  assert.equal(result.status, "VERIFIER_ERROR");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(privateMarker));
  assert.doesNotMatch(JSON.stringify(result), /University Ave/i);
});

test("a model-controlled candidate identifier cannot carry free-form private text into public events", async () => {
  let calls = 0;
  const result = await verifyObservedDominosCandidate({
    input: input(),
    candidate: candidate({ candidateId: "1 Private Lane, note=allergy" }),
    observation: observation(),
    verifierModel: "fake:verifier" as LanguageModel,
    verifyCandidate: async () => {
      calls += 1;
      throw new Error("must not run");
    },
  });

  assert.equal(calls, 0);
  assert.equal(result.status, "VERIFIER_ERROR");
});

test("delivery evidence is retained as an exact observation rather than inferred by the Planner", async () => {
  const liveObservation = observation();
  liveObservation.serviceability = {
    status: "SERVICEABLE",
    applicability: "REQUIRED",
    storeIds: ["10950"],
    observedAt: FETCHED_AT,
    source: "Official lookup",
    reason: "Official lookup returned the store.",
  } satisfies DominosServiceabilityResult;
  let serviceability: DominosServiceabilityResult | null = null;

  await verifyObservedDominosCandidate({
    input: { ...input(), serviceMethod: "either", deliveryAddress: {
      street: "1 Test Street",
      city: "Charlottetown",
      province: "PE",
      postalCode: "C1A 1A1",
    } },
    candidate: candidate({ serviceMethod: "delivery" }),
    observation: liveObservation,
    verifierModel: "fake:verifier" as LanguageModel,
    verifyCandidate: async (request) => {
      assert.ok(request);
      serviceability = request.evidenceContext.serviceability;
      return { status: "VERIFIER_ERROR", reason: "test", evidence: null };
    },
  });

  assert.strictEqual(serviceability, liveObservation.serviceability);
});
