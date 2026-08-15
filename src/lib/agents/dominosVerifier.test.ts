import assert from "node:assert/strict";
import test from "node:test";

import type { LanguageModel } from "ai";

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
