import assert from "node:assert/strict";
import test from "node:test";

import type {
  CandidateEvidenceBundle,
  CandidateJourney,
  DominosCandidate,
  VerificationDecision,
} from "./contracts";
import { rankApprovedDominosOptions } from "./ranking";

function candidate(candidateId: string, storeId = "10950"): DominosCandidate {
  return {
    candidateId,
    candidateVersion: 1,
    snapshotVersion: `${storeId}:2026-08-15T12:00:00.000Z`,
    storeId,
    serviceMethod: "carryout",
    dealCodes: [],
    pizzas: [{
      lineId: `${candidateId}-line`, quantity: 3, productCode: "S_PIZZA", variantCode: "12SCREEN",
      sizeCode: "12", crustCode: "HANDTOSS", sauceCode: "X", cheeseCode: "C", toppings: [],
      purpose: "general", protectsGroupIds: [], trustedSlicesPerPizza: 8,
    }],
    expectedPricing: { subtotalCad: 30, taxCad: 4.5, feesCad: 0, totalCad: 34.5 },
  };
}

function evidence(
  value: DominosCandidate,
  options: { total?: number; required?: number; provided?: number; represented?: string[]; wait?: { min: number; max: number } | null } = {},
): CandidateEvidenceBundle {
  const pass = (code: string, facts: unknown = {}) => ({ status: "PASS" as const, code, summary: "passed", facts, source: "exact test evidence" });
  return {
    candidateId: value.candidateId,
    candidateVersion: value.candidateVersion,
    snapshotVersion: value.snapshotVersion,
    checks: {
      menuIntegrity: pass("MENU"),
      dietary: pass("DIETARY"),
      capacity: pass("CAPACITY", { requiredSlices: options.required ?? 18, totalSlices: options.provided ?? 24 }),
      budget: pass("BUDGET", { totalCad: options.total ?? 34.5 }),
      availability: pass("AVAILABLE", { waitMinutes: options.wait === undefined ? { min: 8, max: 12 } : options.wait }),
      serviceability: pass("SERVICEABLE"),
    },
    preference: {
      requested: ["cheese", "pepperoni"],
      represented: (options.represented ?? []) as CandidateEvidenceBundle["preference"]["represented"],
      unmet: [],
    },
    collectedAt: "2026-08-15T12:01:00.000Z",
  };
}

function journey(
  id: string,
  options: Parameters<typeof evidence>[1] & { approved?: boolean; storeId?: string } = {},
): CandidateJourney {
  const value = candidate(id, options.storeId);
  const proof = evidence(value, options);
  const decision: VerificationDecision = options.approved === false
    ? { candidateId: id, candidateVersion: 1, snapshotVersion: value.snapshotVersion, decision: "REJECT", disposition: "ADAPT_ORDER", reasons: ["rejected"], unknowns: [] }
    : { candidateId: id, candidateVersion: 1, snapshotVersion: value.snapshotVersion, decision: "APPROVE", disposition: "NONE", reasons: ["approved"], unknowns: [] };
  return { candidate: value, outcome: { status: "DECIDED", decision, evidence: proof }, adaptedFromCandidateId: null };
}

test("ranking excludes rejected candidates and retains every approved alternative", () => {
  const ranked = rankApprovedDominosOptions([
    journey("A", { represented: ["cheese", "pepperoni"] }),
    journey("B", { approved: false }),
    journey("C", { represented: ["cheese"] }),
  ]);

  assert.equal(ranked.recommended?.candidate.candidateId, "A");
  assert.deepEqual(ranked.alternatives.map(({ candidate }) => candidate.candidateId), ["C"]);
});

test("ranking applies the approved deterministic priority in order", () => {
  assert.equal(rankApprovedDominosOptions([
    journey("less-preferred", { total: 20, represented: ["cheese"] }),
    journey("more-preferred", { total: 40, represented: ["cheese", "pepperoni"] }),
  ]).recommended?.candidate.candidateId, "more-preferred");

  assert.equal(rankApprovedDominosOptions([
    journey("expensive", { total: 40 }), journey("cheap", { total: 30 }),
  ]).recommended?.candidate.candidateId, "cheap");

  assert.equal(rankApprovedDominosOptions([
    journey("excess", { provided: 32 }), journey("tight", { provided: 24 }),
  ]).recommended?.candidate.candidateId, "tight");

  assert.equal(rankApprovedDominosOptions([
    journey("unknown-wait", { wait: null }), journey("known-wait", { wait: { min: 20, max: 30 } }),
  ]).recommended?.candidate.candidateId, "known-wait");

  assert.equal(rankApprovedDominosOptions([
    journey("slow", { wait: { min: 5, max: 30 } }), journey("fast", { wait: { min: 10, max: 20 } }),
  ]).recommended?.candidate.candidateId, "fast");

  assert.equal(rankApprovedDominosOptions([
    journey("B", { storeId: "10953" }), journey("A", { storeId: "10950" }),
  ]).recommended?.candidate.candidateId, "A");
});

test("ranking returns no recommendation when nothing has verifier approval", () => {
  const ranked = rankApprovedDominosOptions([journey("A", { approved: false })]);
  assert.equal(ranked.recommended, null);
  assert.deepEqual(ranked.alternatives, []);
});
