import assert from "node:assert/strict";
import test from "node:test";

import type { CandidateEvidenceBundle, CandidateJourney, DominosCandidate, VerificationOutcome } from "./contracts";
import { normalizeDominosEvaluation } from "./normalize";

function candidate(id: string, method: "delivery" | "carryout" = "carryout"): DominosCandidate {
  return {
    candidateId: id, candidateVersion: 1, snapshotVersion: "10950:2026-08-15T12:00:00.000Z",
    storeId: "10950", serviceMethod: method, dealCodes: [],
    pizzas: [
      { lineId: `${id}-protected`, quantity: 1, productCode: "S_PIZZA", variantCode: "12SCREEN", sizeCode: "12", crustCode: "HANDTOSS", sauceCode: "X", cheeseCode: "C", toppings: [], purpose: "dietary-protected", protectsGroupIds: ["veg"], trustedSlicesPerPizza: 8 },
      { lineId: `${id}-general`, quantity: 2, productCode: "S_PIZZA", variantCode: "12SCREEN", sizeCode: "12", crustCode: "HANDTOSS", sauceCode: "X", cheeseCode: "C", toppings: [{ code: "P", quantity: 1 }], purpose: "general", protectsGroupIds: [], trustedSlicesPerPizza: 8 },
    ],
    expectedPricing: { subtotalCad: 30, taxCad: 4.5, feesCad: 0, totalCad: 34.5 },
  };
}

function evidence(value: DominosCandidate, budgetStatus: "PASS" | "UNKNOWN" = "PASS"): CandidateEvidenceBundle {
  const check = (status: "PASS" | "FAIL" | "UNKNOWN", code: string, facts: unknown = {}) => ({ status, code, summary: `${code} summary`, facts, source: "exact test evidence" });
  return {
    candidateId: value.candidateId, candidateVersion: 1, snapshotVersion: value.snapshotVersion,
    checks: {
      menuIntegrity: check("PASS", "MENU"),
      dietary: check("PASS", "DIETARY", { groups: [{ groupId: "veg", requiredSlices: 6, allocatedSlices: 8, missingSlices: 0 }] }),
      capacity: check("PASS", "CAPACITY", { requiredSlices: 18, totalSlices: 24 }),
      budget: check(budgetStatus, budgetStatus === "PASS" ? "BUDGET" : "ALL_IN_TOTAL_UNKNOWN", budgetStatus === "PASS" ? { totalCad: 34.5 } : { totalCad: null }),
      availability: check("PASS", "AVAILABLE", { waitMinutes: value.serviceMethod === "carryout" ? { min: 8, max: 12 } : { min: 20, max: 30 } }),
      serviceability: check("PASS", "SERVICEABLE"),
    },
    preference: { requested: ["pepperoni", "veggie"], represented: ["pepperoni"], unmet: [{ preference: "veggie", reason: "No general pizza remained." }] },
    collectedAt: "2026-08-15T12:01:00.000Z",
  };
}

function journey(value: DominosCandidate, approved: boolean, budgetStatus: "PASS" | "UNKNOWN" = "PASS"): CandidateJourney {
  const proof = evidence(value, budgetStatus);
  const outcome: VerificationOutcome = approved
    ? { status: "DECIDED", decision: { candidateId: value.candidateId, candidateVersion: 1, snapshotVersion: value.snapshotVersion, decision: "APPROVE", disposition: "NONE", reasons: ["All hard checks pass."], unknowns: [] }, evidence: proof }
    : { status: "DECIDED", decision: { candidateId: value.candidateId, candidateVersion: 1, snapshotVersion: value.snapshotVersion, decision: "REJECT", disposition: "TERMINAL", reasons: ["The all-in total is unknown."], unknowns: ["budget"] }, evidence: proof };
  return { candidate: value, outcome, adaptedFromCandidateId: null };
}

test("normalization retains exact configured lines, hard checks, relevant wait, preferences, and rejected journeys", () => {
  const approved = journey(candidate("approved"), true);
  const rejected = journey(candidate("rejected", "delivery"), false, "UNKNOWN");
  const events = [{ type: "decision" as const, candidateId: "rejected", decision: "REJECT" as const, reason: "The all-in total is unknown." }];

  const normalized = normalizeDominosEvaluation([rejected, approved], ["pepperoni", "veggie"], events);

  assert.equal(normalized.recommended?.candidate.candidateId, "approved");
  assert.deepEqual(normalized.recommended?.candidate.pizzas[0]?.protectsGroupIds, ["veg"]);
  assert.deepEqual(normalized.recommended?.candidate.pizzas[1]?.toppings, [{ code: "P", quantity: 1 }]);
  assert.equal(normalized.recommended?.evidence.checks.capacity.status, "PASS");
  assert.equal(normalized.recommended?.evidence.checks.budget.facts && (normalized.recommended.evidence.checks.budget.facts as { totalCad: number }).totalCad, 34.5);
  assert.deepEqual(normalized.recommended?.relevantWaitMinutes, { min: 8, max: 12 });
  assert.deepEqual(normalized.recommended?.evidence.preference.unmet, [{ preference: "veggie", reason: "No general pizza remained." }]);
  assert.deepEqual(normalized.journeys.map(({ candidate: value }) => value.candidateId), ["rejected", "approved"]);
  assert.equal(normalized.journeys[0]?.outcome.status === "DECIDED" && normalized.journeys[0].outcome.evidence.checks.budget.status, "UNKNOWN");
  assert.deepEqual(normalized.events, events);
  assert.equal(JSON.stringify(normalized).includes("little-caesars"), false);
});
test("normalization keeps every approved option and explains an honestly empty result", () => {
  const first = journey(candidate("first"), true);
  const second = journey(candidate("second"), true);
  const viable = normalizeDominosEvaluation([first, second], [], []);
  assert.equal(viable.recommended !== null, true);
  assert.equal(viable.alternatives.length, 1);
  assert.equal(viable.noViableReason, null);

  const unknown = normalizeDominosEvaluation([journey(candidate("unknown"), false, "UNKNOWN")], [], []);
  assert.equal(unknown.recommended, null);
  assert.equal(unknown.noViableReason, "The all-in total is unknown.");

  const empty = normalizeDominosEvaluation([], [], []);
  assert.equal(empty.noViableReason, "GatherBite could not verify a Domino's option from the available live data.");
});
