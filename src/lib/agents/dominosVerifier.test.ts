import assert from "node:assert/strict";
import test from "node:test";

import { APICallError, type LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";

import type {
  CandidateEvidenceBundle,
  DominosCandidate,
  VerificationDecision,
} from "../gatherbite/contracts";
import type { CandidateEvidenceContext } from "../restaurants/dominosEvidence";
import {
  runDominosVerifier,
  type VerifierAgentRunner,
  type VerifyCandidateDeps,
} from "./dominosVerifier";

const candidate: DominosCandidate = {
  candidateId: "candidate-1",
  candidateVersion: 1,
  snapshotVersion: "10950:2026-08-15T12:00:00.000Z",
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
  expectedPricing: { subtotalCad: 14.99, taxCad: 2.25, feesCad: 0, totalCad: 17.24 },
};

const passingEvidence: CandidateEvidenceBundle = {
  candidateId: candidate.candidateId,
  candidateVersion: candidate.candidateVersion,
  snapshotVersion: candidate.snapshotVersion,
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

const approveDecision: VerificationDecision = {
  candidateId: candidate.candidateId,
  candidateVersion: candidate.candidateVersion,
  snapshotVersion: candidate.snapshotVersion,
  decision: "APPROVE",
  disposition: "NONE",
  reasons: ["All exact hard-constraint evidence passes."],
  unknowns: [],
};

const fakeModel = "fake:verifier" as LanguageModel;
const evidenceContext = { candidate } as CandidateEvidenceContext;

function deps(runner: VerifierAgentRunner, collectEvidence = async () => passingEvidence): VerifyCandidateDeps {
  return { model: fakeModel, runner, collectEvidence };
}

const mockUsage: LanguageModelV4GenerateResult["usage"] = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function evidenceToolCall(): LanguageModelV4GenerateResult {
  return {
    content: [{
      type: "tool-call",
      toolCallId: "evidence-call-1",
      toolName: "gatherCandidateEvidence",
      input: "{}",
    }],
    finishReason: { unified: "tool-calls", raw: "tool_calls" },
    usage: mockUsage,
    warnings: [],
  };
}

function structuredVerdict(): LanguageModelV4GenerateResult {
  return {
    content: [{ type: "text", text: JSON.stringify(approveDecision) }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: mockUsage,
    warnings: [],
  };
}

function retryableProviderError(): APICallError {
  return new APICallError({
    message: "transient test error",
    url: "https://example.invalid/verifier",
    requestBodyValues: {},
    responseHeaders: { "retry-after": "0" },
    statusCode: 503,
    isRetryable: true,
  });
}

test("the real SDK runner separates tool-capable evidence from the structured no-tools verdict", async () => {
  const sequence: string[] = [];
  let evidenceComplete = false;
  let providerCalls = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async (): Promise<LanguageModelV4GenerateResult> => {
      providerCalls += 1;
      if (providerCalls === 1) {
        sequence.push("evidence-request");
        return evidenceToolCall();
      }
      sequence.push("verdict-request");
      assert.equal(evidenceComplete, true);
      return structuredVerdict();
    },
  });

  const result = await runDominosVerifier(
    { candidate, evidenceContext },
    {
      model,
      collectEvidence: async () => {
        evidenceComplete = true;
        sequence.push("evidence-complete");
        return passingEvidence;
      },
    },
  );

  assert.equal(result.status, "DECIDED");
  assert.equal(model.doGenerateCalls.length, 2);
  assert.deepEqual(sequence, ["evidence-request", "evidence-complete", "verdict-request"]);

  const [evidenceRequest, verdictRequest] = model.doGenerateCalls;
  assert.equal(evidenceRequest.responseFormat?.type === "json", false);
  assert.deepEqual(evidenceRequest.tools?.map((entry) => entry.type === "function" && entry.name), ["gatherCandidateEvidence"]);
  assert.deepEqual(evidenceRequest.toolChoice, { type: "tool", toolName: "gatherCandidateEvidence" });
  assert.equal(evidenceRequest.temperature, 0);
  assert.equal(evidenceRequest.maxOutputTokens, 256);

  assert.equal(verdictRequest.tools?.length ?? 0, 0);
  assert.equal(verdictRequest.responseFormat?.type, "json");
  assert.ok(verdictRequest.responseFormat?.type === "json" && verdictRequest.responseFormat.schema);
  assert.equal(verdictRequest.temperature, 0);
  assert.equal(verdictRequest.maxOutputTokens, 400);
});

test("the real SDK runner permits only one retry in each bounded stage", async () => {
  let providerAttempts = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async (): Promise<LanguageModelV4GenerateResult> => {
      providerAttempts += 1;
      const attempt = providerAttempts;
      if (attempt === 1 || attempt === 3) throw retryableProviderError();
      return attempt === 2 ? evidenceToolCall() : structuredVerdict();
    },
  });

  const result = await runDominosVerifier(
    { candidate, evidenceContext },
    { model, collectEvidence: async () => passingEvidence },
  );

  assert.equal(result.status, "DECIDED");
  assert.equal(model.doGenerateCalls.length, 4);
  assert.equal(model.doGenerateCalls.slice(0, 2).every((call) => (call.tools?.length ?? 0) === 1), true);
  assert.equal(model.doGenerateCalls.slice(2).every((call) => (call.tools?.length ?? 0) === 0), true);

  const alwaysFailing = new MockLanguageModelV4({
    doGenerate: async () => { throw retryableProviderError(); },
  });
  const failed = await runDominosVerifier(
    { candidate, evidenceContext },
    { model: alwaysFailing, collectEvidence: async () => passingEvidence },
  );
  assert.equal(failed.status, "VERIFIER_ERROR");
  assert.equal(alwaysFailing.doGenerateCalls.length, 2);
});

test("the real SDK runner never starts the verdict stage when the evidence tool is omitted", async () => {
  let collectorCalls = 0;
  const model = new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: "APPROVE" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: mockUsage,
      warnings: [],
    },
  });

  const result = await runDominosVerifier(
    { candidate, evidenceContext },
    {
      model,
      collectEvidence: async () => {
        collectorCalls += 1;
        return passingEvidence;
      },
    },
  );

  assert.equal(result.status, "VERIFIER_ERROR");
  assert.equal(model.doGenerateCalls.length, 1);
  assert.equal(collectorCalls, 0);
});

test("one candidate causes exactly one separate runner call and gathers evidence before verdict", async () => {
  const sequence: string[] = [];
  let runnerCalls = 0;
  let collectorCalls = 0;
  const runner: VerifierAgentRunner = async ({ gatherCandidateEvidence }) => {
    runnerCalls += 1;
    sequence.push("runner");
    await gatherCandidateEvidence();
    sequence.push("verdict");
    return approveDecision;
  };

  const result = await runDominosVerifier(
    { candidate, evidenceContext },
    deps(runner, async () => {
      collectorCalls += 1;
      sequence.push("evidence");
      return passingEvidence;
    }),
  );

  assert.equal(runnerCalls, 1);
  assert.equal(collectorCalls, 1);
  assert.deepEqual(sequence, ["runner", "evidence", "verdict"]);
  assert.equal(result.status, "DECIDED");
  assert.equal(result.status === "DECIDED" && result.decision.decision, "APPROVE");
});

test("no candidate causes no verifier runner or evidence call", async () => {
  let runnerCalls = 0;
  let collectorCalls = 0;
  const result = await runDominosVerifier(null, deps(
    async () => {
      runnerCalls += 1;
      return approveDecision;
    },
    async () => {
      collectorCalls += 1;
      return passingEvidence;
    },
  ));

  assert.equal(result.status, "VERIFIER_ERROR");
  assert.equal(runnerCalls, 0);
  assert.equal(collectorCalls, 0);
});

test("a verdict without the evidence tool fails closed", async () => {
  const result = await runDominosVerifier(
    { candidate, evidenceContext },
    deps(async () => approveDecision),
  );

  assert.equal(result.status, "VERIFIER_ERROR");
  assert.equal(result.evidence, null);
});

test("the evidence callback is idempotent within one verifier invocation", async () => {
  let collectorCalls = 0;
  const result = await runDominosVerifier(
    { candidate, evidenceContext },
    deps(async ({ gatherCandidateEvidence }) => {
      const first = await gatherCandidateEvidence();
      const second = await gatherCandidateEvidence();
      assert.strictEqual(first, second);
      return approveDecision;
    }, async () => {
      collectorCalls += 1;
      return passingEvidence;
    }),
  );

  assert.equal(collectorCalls, 1);
  assert.equal(result.status, "DECIDED");
});

test("provider, collector, and protocol failures remain redacted and fail closed", async () => {
  const privateMarker = "private-provider-prompt-and-token";
  const providerFailure = await runDominosVerifier(
    { candidate, evidenceContext },
    deps(async () => { throw new Error(privateMarker); }),
  );
  const collectorFailure = await runDominosVerifier(
    { candidate, evidenceContext },
    deps(async ({ gatherCandidateEvidence }) => {
      await gatherCandidateEvidence();
      return approveDecision;
    }, async () => { throw new Error(privateMarker); }),
  );
  const malformed = await runDominosVerifier(
    { candidate, evidenceContext },
    deps(async ({ gatherCandidateEvidence }) => {
      await gatherCandidateEvidence();
      return { decision: "APPROVE", reasons: [privateMarker] };
    }),
  );

  for (const result of [providerFailure, collectorFailure, malformed]) {
    assert.equal(result.status, "VERIFIER_ERROR");
    assert.doesNotMatch(JSON.stringify(result), new RegExp(privateMarker));
  }
});

test("public events and timing contain only bounded verifier summaries", async () => {
  const events: unknown[] = [];
  const timings: unknown[] = [];
  const result = await runDominosVerifier(
    { candidate, evidenceContext },
    {
      ...deps(async ({ gatherCandidateEvidence }) => {
        await gatherCandidateEvidence();
        return approveDecision;
      }),
      onEvent: (event) => events.push(event),
      onTiming: (entry) => timings.push(entry),
    },
  );

  assert.equal(result.status, "DECIDED");
  assert.deepEqual(events, [
    { type: "stage", stage: "verifying", message: "Checking candidate against exact evidence." },
    { type: "decision", candidateId: candidate.candidateId, decision: "APPROVE", reason: approveDecision.reasons[0] },
  ]);
  assert.equal(timings.length, 2);
  assert.deepEqual((timings as Array<{ name: string }>).map((entry) => entry.name), ["evidence", "verifier"]);
  assert.doesNotMatch(JSON.stringify({ events, timings }), /prompt|token|address/i);
});
