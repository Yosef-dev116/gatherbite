import assert from "node:assert/strict";
import test from "node:test";

import type {
  CandidateEvidenceBundle,
  DominosCandidate,
  VerificationDecision,
} from "../gatherbite/contracts";
import { guardVerificationDecision } from "./verifierGuard";

const candidate: DominosCandidate = {
  candidateId: "candidate-1",
  candidateVersion: 2,
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
  expectedPricing: {
    subtotalCad: 14.99,
    taxCad: 2.25,
    feesCad: 0,
    totalCad: 17.24,
  },
};

function evidence(status: "PASS" | "FAIL" | "UNKNOWN" = "PASS"): CandidateEvidenceBundle {
  const check = (code: string) => ({
    status,
    code,
    summary: `${code} ${status.toLowerCase()}`,
    facts: {},
    source: "exact test evidence",
  });
  return {
    candidateId: candidate.candidateId,
    candidateVersion: candidate.candidateVersion,
    snapshotVersion: candidate.snapshotVersion,
    checks: {
      menuIntegrity: check("MENU"),
      dietary: check("DIETARY"),
      capacity: check("CAPACITY"),
      budget: check("BUDGET"),
      availability: check("AVAILABILITY"),
      serviceability: check("SERVICEABILITY"),
    },
    preference: { requested: [], represented: [], unmet: [] },
    collectedAt: "2026-08-15T12:01:00.000Z",
  };
}

function approve(overrides: Partial<Extract<VerificationDecision, { decision: "APPROVE" }>> = {}): VerificationDecision {
  return {
    candidateId: candidate.candidateId,
    candidateVersion: candidate.candidateVersion,
    snapshotVersion: candidate.snapshotVersion,
    decision: "APPROVE",
    disposition: "NONE",
    reasons: ["All exact hard-constraint evidence passes."],
    unknowns: [],
    ...overrides,
  };
}

function reject(): VerificationDecision {
  return {
    candidateId: candidate.candidateId,
    candidateVersion: candidate.candidateVersion,
    snapshotVersion: candidate.snapshotVersion,
    decision: "REJECT",
    disposition: "ADAPT_ORDER",
    reasons: ["Capacity evidence failed."],
    unknowns: [],
  };
}

test("APPROVE fails closed when any exact hard check is UNKNOWN or FAIL", () => {
  for (const status of ["UNKNOWN", "FAIL"] as const) {
    const exactEvidence = evidence();
    exactEvidence.checks.dietary = {
      ...exactEvidence.checks.dietary,
      status,
    };
    const result = guardVerificationDecision(approve(), exactEvidence, candidate);
    assert.equal(result.status, "VERIFIER_ERROR");
  }
});

test("the guard never upgrades or replaces a model-issued REJECT", () => {
  const decision = reject();
  const result = guardVerificationDecision(decision, evidence(), candidate);

  assert.equal(result.status, "DECIDED");
  assert.deepEqual(result.decision, decision);
  assert.equal(result.decision.decision, "REJECT");
});

test("candidate, evidence, and decision identity must match exactly", () => {
  const wrongEvidence = { ...evidence(), snapshotVersion: "different-snapshot" };
  const wrongDecision = approve({ candidateId: "different-candidate" });

  assert.equal(guardVerificationDecision(approve(), wrongEvidence, candidate).status, "VERIFIER_ERROR");
  assert.equal(guardVerificationDecision(wrongDecision, evidence(), candidate).status, "VERIFIER_ERROR");
});

test("absent evidence and malformed model output are verifier errors", () => {
  assert.equal(guardVerificationDecision(approve(), null, candidate).status, "VERIFIER_ERROR");
  const missingCheck = evidence() as unknown as Record<string, unknown>;
  missingCheck.checks = { ...(missingCheck.checks as Record<string, unknown>) };
  delete (missingCheck.checks as Record<string, unknown>).budget;
  assert.equal(guardVerificationDecision(approve(), missingCheck, candidate).status, "VERIFIER_ERROR");
  assert.equal(guardVerificationDecision({ decision: "APPROVE" }, evidence(), candidate).status, "VERIFIER_ERROR");
});
