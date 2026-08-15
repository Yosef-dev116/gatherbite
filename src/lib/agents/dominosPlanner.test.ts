import assert from "node:assert/strict";
import test from "node:test";

import { APICallError, type LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";

import type {
  CandidateEvidenceBundle,
  DominosCandidate,
  GatherBiteInput,
  VerificationDecision,
  VerificationOutcome,
} from "../gatherbite/contracts";
import type { VerifyCandidateInput, VerifyCandidateDeps } from "./dominosVerifier";
import type { DominosStoreSnapshot } from "../restaurants/dominos";
import { buildDominosCatalog } from "../restaurants/dominosCatalog";
import {
  runDominosPlanner,
  serializeDominosObservationForPlanner,
  type DominosObservationContext,
  type PlannerDependencies,
} from "./dominosPlanner";

const FETCHED_AT = "2026-08-15T12:00:00.000Z";
const fakeInput: GatherBiteInput = {
  attendees: 6,
  budgetCad: 100,
  serviceMethod: "carryout",
  groups: [],
  pizzaPreferences: ["cheese", "pepperoni"],
};

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
      toppings: ["Pizza Sauce", "Cheese", "Pepperoni"],
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
      { code: "P", name: "Pepperoni", category: "Pizza" },
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

function candidate(id: string, version = 1): DominosCandidate {
  return {
    candidateId: id,
    candidateVersion: version,
    snapshotVersion: `10950:${FETCHED_AT}`,
    storeId: "10950",
    serviceMethod: "carryout",
    dealCodes: [],
    pizzas: [{
      lineId: `${id}-line`,
      quantity: 3,
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
    expectedPricing: { subtotalCad: null, taxCad: null, feesCad: null, totalCad: null },
  };
}

function evidence(forCandidate: DominosCandidate): CandidateEvidenceBundle {
  return {
    candidateId: forCandidate.candidateId,
    candidateVersion: forCandidate.candidateVersion,
    snapshotVersion: forCandidate.snapshotVersion,
    checks: Object.fromEntries(
      ["menuIntegrity", "dietary", "capacity", "budget", "availability", "serviceability"].map((key) => [key, {
        status: "PASS",
        code: `${key.toUpperCase()}_PASS`,
        summary: `${key} passed`,
        facts: {},
        source: "exact test evidence",
      }]),
    ) as CandidateEvidenceBundle["checks"],
    preference: { requested: [], represented: [], unmet: [] },
    collectedAt: "2026-08-15T12:01:00.000Z",
  };
}

function decided(forCandidate: DominosCandidate, decision: "APPROVE" | "REJECT", disposition: VerificationDecision["disposition"] = "NONE"): VerificationOutcome {
  const verdict: VerificationDecision = decision === "APPROVE"
    ? {
        candidateId: forCandidate.candidateId,
        candidateVersion: forCandidate.candidateVersion,
        snapshotVersion: forCandidate.snapshotVersion,
        decision,
        disposition: "NONE",
        reasons: ["All exact hard-constraint evidence passes."],
        unknowns: [],
      }
    : {
        candidateId: forCandidate.candidateId,
        candidateVersion: forCandidate.candidateVersion,
        snapshotVersion: forCandidate.snapshotVersion,
        decision,
        disposition: disposition === "NONE" ? "ADAPT_ORDER" : disposition,
        reasons: ["Exact evidence rejected this candidate."],
        unknowns: [],
      };
  return { status: "DECIDED", decision: verdict, evidence: evidence(forCandidate) };
}

const mockUsage: LanguageModelV4GenerateResult["usage"] = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function toolCalls(calls: Array<{ name: "observeDominosOptions"; input?: object } | { name: "verifyCandidate"; input: DominosCandidate }>): LanguageModelV4GenerateResult {
  return {
    content: calls.map((call, index) => ({
      type: "tool-call" as const,
      toolCallId: `call-${index + 1}`,
      toolName: call.name,
      input: JSON.stringify(call.input ?? {}),
    })),
    finishReason: { unified: "tool-calls", raw: "tool_calls" },
    usage: mockUsage,
    warnings: [],
  };
}

function textResult(text = "Done"): LanguageModelV4GenerateResult {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: mockUsage,
    warnings: [],
  };
}

function scriptedModel(results: LanguageModelV4GenerateResult[]): MockLanguageModelV4 {
  let index = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const result = results[index++];
      assert.ok(result, `unexpected Planner provider call ${index}`);
      return result;
    },
  });
}

function dependencies(
  model: LanguageModel,
  verifyCandidate: (input: VerifyCandidateInput | null, deps: VerifyCandidateDeps) => Promise<VerificationOutcome>,
  overrides: Partial<PlannerDependencies> = {},
): PlannerDependencies {
  return {
    model,
    observationPromise: Promise.resolve(observation()),
    verifyCandidate,
    ...overrides,
  };
}

test("Planner prose cannot create a candidate, invoke verification, or retain an approval", async () => {
  let verifierCalls = 0;
  const model = scriptedModel([textResult("APPROVE: everything is definitely valid")]);

  const result = await runDominosPlanner(fakeInput, dependencies(model, async () => {
    verifierCalls += 1;
    throw new Error("must not run");
  }));

  assert.equal(verifierCalls, 0);
  assert.equal(result.verificationAttempts, 0);
  assert.deepEqual(result.journeys, []);
  assert.equal(result.terminal, false);
});

test("Planner forwards the request abort signal to its model call", async () => {
  const controller = new AbortController();
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      assert.equal(options.abortSignal, controller.signal);
      return textResult();
    },
  });

  const result = await runDominosPlanner(fakeInput, dependencies(model, async () => {
    throw new Error("must not run");
  }, { abortSignal: controller.signal }));
  assert.equal(result.terminal, false, "an assertion thrown inside the mock provider must not be swallowed as a passing test");
});

test("two tool-verified approvals are retained and stop the loop with at most two verifier calls in flight", async () => {
  const first = candidate("candidate-1");
  const second = candidate("candidate-2");
  const model = scriptedModel([
    toolCalls([{ name: "observeDominosOptions" }]),
    toolCalls([
      { name: "verifyCandidate", input: first },
      { name: "verifyCandidate", input: second },
    ]),
  ]);
  let active = 0;
  let peak = 0;
  let started = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });

  const result = await runDominosPlanner(fakeInput, dependencies(model, async (request) => {
    assert.ok(request);
    active += 1;
    started += 1;
    peak = Math.max(peak, active);
    if (started === 2) release();
    await gate;
    active -= 1;
    return decided(request.candidate, "APPROVE");
  }));

  assert.equal(peak, 2);
  assert.equal(result.verificationAttempts, 2);
  assert.deepEqual(result.journeys.map((journey) => journey.candidate.candidateId), ["candidate-1", "candidate-2"]);
  assert.equal(result.journeys.every((journey) => journey.outcome.status === "DECIDED" && journey.outcome.decision.decision === "APPROVE"), true);
  assert.equal(model.doGenerateCalls.length, 2, "two approvals must prevent an unnecessary model round");
});

test("parallel verifier decisions are emitted in candidate admission order", async () => {
  const first = candidate("candidate-1");
  const second = candidate("candidate-2");
  const model = scriptedModel([
    toolCalls([{ name: "observeDominosOptions" }]),
    toolCalls([
      { name: "verifyCandidate", input: first },
      { name: "verifyCandidate", input: second },
    ]),
  ]);
  const decisions: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

  await runDominosPlanner(fakeInput, dependencies(model, async (request, verifierDeps) => {
    assert.ok(request);
    if (request.candidate.candidateId === "candidate-1") await firstGate;
    else releaseFirst();
    const outcome = decided(request.candidate, "APPROVE");
    verifierDeps.onEvent?.({ type: "decision", candidateId: request.candidate.candidateId, decision: "APPROVE", reason: "verified" });
    return outcome;
  }, {
    onEvent: (event) => {
      if (event.type === "decision") decisions.push(event.candidateId);
    },
  }));

  assert.deepEqual(decisions, ["candidate-1", "candidate-2"]);
});

test("one versioned adaptation is linked only to structured ADAPT_ORDER evidence", async () => {
  const original = candidate("candidate-1");
  const adapted = candidate("candidate-1", 2);
  const model = scriptedModel([
    toolCalls([{ name: "observeDominosOptions" }]),
    toolCalls([{ name: "verifyCandidate", input: original }]),
    toolCalls([{ name: "verifyCandidate", input: adapted }]),
    textResult(),
  ]);

  const result = await runDominosPlanner(fakeInput, dependencies(model, async (request) => {
    assert.ok(request);
    return request.candidate.candidateVersion === 1
      ? decided(request.candidate, "REJECT", "ADAPT_ORDER")
      : decided(request.candidate, "APPROVE");
  }));

  assert.equal(result.verificationAttempts, 2);
  assert.equal(result.journeys.length, 2);
  assert.equal(result.journeys[1]?.adaptedFromCandidateId, original.candidateId);
  assert.equal(result.journeys[1]?.outcome.status === "DECIDED" && result.journeys[1].outcome.decision.decision, "APPROVE");
});

test("a higher-version candidate cannot create its own adaptation authority", async () => {
  const ungroundedAdaptation = candidate("candidate-1", 2);
  const model = scriptedModel([
    toolCalls([{ name: "observeDominosOptions" }]),
    toolCalls([{ name: "verifyCandidate", input: ungroundedAdaptation }]),
    textResult(),
  ]);
  let verifierCalls = 0;

  const result = await runDominosPlanner(fakeInput, dependencies(model, async () => {
    verifierCalls += 1;
    throw new Error("must not run");
  }));

  assert.equal(verifierCalls, 0);
  assert.equal(result.verificationAttempts, 0);
  assert.deepEqual(result.journeys, []);
});

test("an adaptation must retain the structured rejection's candidate identity", async () => {
  const original = candidate("candidate-1");
  const mismatched = candidate("candidate-2", 2);
  const model = scriptedModel([
    toolCalls([{ name: "observeDominosOptions" }]),
    toolCalls([{ name: "verifyCandidate", input: original }]),
    toolCalls([{ name: "verifyCandidate", input: mismatched }]),
    textResult(),
  ]);
  let verifierCalls = 0;

  const result = await runDominosPlanner(fakeInput, dependencies(model, async (request) => {
    verifierCalls += 1;
    assert.ok(request);
    return decided(request.candidate, "REJECT", "ADAPT_ORDER");
  }));

  assert.equal(verifierCalls, 1);
  assert.equal(result.verificationAttempts, 1);
  assert.deepEqual(result.journeys.map((journey) => journey.candidate.candidateId), [original.candidateId]);
});

test("parallel follow-ups consume only the single approved adaptation path", async () => {
  const original = candidate("candidate-1");
  const firstAdaptation = candidate("candidate-1", 2);
  const secondAdaptation = candidate("candidate-2", 2);
  const model = scriptedModel([
    toolCalls([{ name: "observeDominosOptions" }]),
    toolCalls([{ name: "verifyCandidate", input: original }]),
    toolCalls([
      { name: "verifyCandidate", input: firstAdaptation },
      { name: "verifyCandidate", input: secondAdaptation },
    ]),
    textResult(),
  ]);
  let verifierCalls = 0;

  const result = await runDominosPlanner(fakeInput, dependencies(model, async (request) => {
    verifierCalls += 1;
    assert.ok(request);
    return decided(request.candidate, "REJECT", "ADAPT_ORDER");
  }));

  assert.equal(verifierCalls, 2, "one initial candidate plus one adaptation may be verified");
  assert.equal(result.verificationAttempts, 2);
  assert.equal(result.journeys.filter((journey) => journey.adaptedFromCandidateId !== null).length, 1);
});

test("a TERMINAL verifier disposition stops without another Planner round", async () => {
  const proposed = candidate("candidate-terminal");
  const model = scriptedModel([
    toolCalls([{ name: "observeDominosOptions" }]),
    toolCalls([{ name: "verifyCandidate", input: proposed }]),
  ]);

  const result = await runDominosPlanner(fakeInput, dependencies(model, async (request) => {
    assert.ok(request);
    return decided(request.candidate, "REJECT", "TERMINAL");
  }));

  assert.equal(result.terminal, true);
  assert.equal(result.verificationAttempts, 1);
  assert.equal(model.doGenerateCalls.length, 2);
});

test("the Planner cannot exceed three verifier operations or one adaptation", async () => {
  const first = candidate("candidate-1");
  const second = candidate("candidate-2");
  const adapted = candidate("candidate-2", 2);
  const model = scriptedModel([
    toolCalls([{ name: "observeDominosOptions" }]),
    toolCalls([
      { name: "verifyCandidate", input: first },
      { name: "verifyCandidate", input: second },
    ]),
    toolCalls([{ name: "verifyCandidate", input: adapted }]),
  ]);

  const result = await runDominosPlanner(fakeInput, dependencies(model, async (request) => {
    assert.ok(request);
    return decided(request.candidate, "REJECT", "ADAPT_ORDER");
  }));

  assert.equal(result.verificationAttempts, 3);
  assert.equal(result.journeys.length, 3);
  assert.equal(result.journeys.filter((journey) => journey.adaptedFromCandidateId !== null).length, 1);
  assert.equal(model.doGenerateCalls.length, 3);
});

test("duplicate and stale candidates fail closed without extra verifier operations", async () => {
  const original = candidate("candidate-1");
  const stale = candidate("candidate-stale", 1);
  stale.snapshotVersion = "10950:stale";
  const model = scriptedModel([
    toolCalls([{ name: "observeDominosOptions" }]),
    toolCalls([{ name: "verifyCandidate", input: original }]),
    toolCalls([
      { name: "verifyCandidate", input: original },
      { name: "verifyCandidate", input: stale },
    ]),
    textResult(),
  ]);
  let verifierCalls = 0;

  const result = await runDominosPlanner(fakeInput, dependencies(model, async (request) => {
    verifierCalls += 1;
    assert.ok(request);
    return decided(request.candidate, "REJECT", "ADAPT_ORDER");
  }));

  assert.equal(verifierCalls, 1);
  assert.equal(result.verificationAttempts, 1);
  assert.equal(result.journeys.length, 1);
});

test("Planner settings stay deterministic, bounded, and limited to one provider retry", async () => {
  let providerAttempts = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      providerAttempts += 1;
      if (providerAttempts === 1) {
        throw new APICallError({
          message: "transient",
          url: "https://example.invalid/planner",
          requestBodyValues: {},
          responseHeaders: { "retry-after": "0" },
          statusCode: 503,
          isRetryable: true,
        });
      }
      return textResult();
    },
  });

  const result = await runDominosPlanner(fakeInput, dependencies(model, async () => {
    throw new Error("must not run");
  }));

  assert.equal(result.verificationAttempts, 0);
  assert.equal(model.doGenerateCalls.length, 2);
  assert.equal(model.doGenerateCalls.every((call) => call.temperature === 0), true);
  assert.equal(model.doGenerateCalls.every((call) => call.tools?.filter((entry) => entry.type === "function").length === 2), true);
});

test("public events contain only bounded stages and candidate summaries", async () => {
  const privateMarker = "1 Private Lane, private note, private prompt, provider token";
  const proposed = candidate("candidate-public");
  const events: unknown[] = [];
  const timings: unknown[] = [];
  const model = scriptedModel([
    toolCalls([{ name: "observeDominosOptions" }]),
    toolCalls([{ name: "verifyCandidate", input: proposed }]),
    textResult(privateMarker),
  ]);

  await runDominosPlanner(
    { ...fakeInput, groups: [{ id: "private-group", people: 1, restrictions: ["vegetarian"], notes: privateMarker }] },
    dependencies(model, async (request, deps) => {
      assert.ok(request);
      const outcome = decided(request.candidate, "APPROVE");
      if (outcome.status === "DECIDED") {
        deps.onEvent?.({
          type: "decision",
          candidateId: request.candidate.candidateId,
          decision: outcome.decision.decision,
          reason: outcome.decision.reasons[0],
        });
      }
      return outcome;
    }, {
      onEvent: (event) => events.push(event),
      onTiming: (entry) => timings.push(entry),
    }),
  );

  const publicOutput = JSON.stringify({ events, timings });
  assert.doesNotMatch(publicOutput, /Private Lane|private note|private prompt|provider token/i);
  assert.deepEqual((timings as Array<{ name: string }>).map((entry) => entry.name), ["planner"]);
  assert.equal((events as Array<{ type: string }>).some((event) => event.type === "candidate"), true);
  assert.equal((events as Array<{ type: string }>).some((event) => event.type === "decision"), true);
});

test("Planner observation exposes one authoritative compact catalog without duplicate menu arrays", () => {
  const serialized = serializeDominosObservationForPlanner(observation());
  const store = serialized.stores[0];

  assert.ok(store);
  assert.equal("products" in store, false);
  assert.equal("variants" in store, false);
  assert.equal("toppingOptions" in store, false);
  assert.equal("deals" in store, false);
  assert.deepEqual(store.catalog?.products.map(({ id }) => id), ["S_PIZZA"]);
  assert.deepEqual(store.catalog?.variants.map(({ code }) => code), ["12SCREEN"]);
  assert.deepEqual(store.catalog?.toppings.map(({ code }) => code), ["X", "C", "P"]);
  assert.deepEqual(store.catalog?.deals.map(({ code }) => code), []);
});
