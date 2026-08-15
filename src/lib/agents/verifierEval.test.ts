import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateGuardCase,
  evaluateGuardCases,
  hasZeroFalseApprovals,
  LIVE_COMPARABLE_EVAL_CASES,
  VERIFIER_EVAL_CASES,
  type VerifierEvalCategory,
} from "./verifierEval";

const REQUIRED_CATEGORIES: VerifierEvalCategory[] = [
  "valid",
  "preference-conflict",
  "hard-failure",
  "insufficient-capacity",
  "over-budget",
  "unavailable",
  "unserviceable",
  "combined-failure",
  "stale-unknown",
  "malformed-output",
  "adversarial-identity",
];

test("the fixed eval set covers every required category from the task brief", () => {
  const present = new Set(VERIFIER_EVAL_CASES.map((c) => c.category));
  for (const category of REQUIRED_CATEGORIES) {
    assert.equal(present.has(category), true, `missing eval cases for category: ${category}`);
  }
});

test("every fixed eval case id is unique", () => {
  const ids = VERIFIER_EVAL_CASES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every fixed eval case deterministically produces its expected guard outcome", () => {
  const results = evaluateGuardCases();
  const failures = results.filter((result) => !result.matchesExpectation);
  assert.deepEqual(
    failures.map((f) => f.case.id),
    [],
    `unexpected guard outcome(s): ${failures.map((f) => `${f.case.id} -> ${JSON.stringify(f.outcome)}`).join("; ")}`,
  );
});

test("the guard produces zero false approvals across every adversarial or unsafe case", () => {
  const results = evaluateGuardCases();
  const falseApprovals = results.filter((result) => result.isFalseApproval);
  assert.deepEqual(
    falseApprovals.map((f) => f.case.id),
    [],
    "the guard must never approve a candidate an unsafe/adversarial decision attempted to approve",
  );
  assert.equal(hasZeroFalseApprovals(results), true);
});

test("cases marked as false-approval attempts never resolve to DECIDED/APPROVE", () => {
  for (const evalCase of VERIFIER_EVAL_CASES) {
    if (!evalCase.isFalseApprovalAttempt) continue;
    const { outcome } = evaluateGuardCase(evalCase);
    const approved = outcome.status === "DECIDED" && outcome.decision.decision === "APPROVE";
    assert.equal(approved, false, `${evalCase.id} must not be approved`);
  }
});

test("the guard never upgrades a correctly-issued REJECT, even under hard-failure evidence", () => {
  for (const evalCase of VERIFIER_EVAL_CASES) {
    if (!evalCase.id.endsWith("-correct-reject")) continue;
    const { outcome } = evaluateGuardCase(evalCase);
    assert.equal(outcome.status, "DECIDED");
    assert.equal(outcome.status === "DECIDED" && outcome.decision.decision, "REJECT");
  }
});

test("a preference conflict alone never blocks approval when hard checks pass", () => {
  const preferenceCase = VERIFIER_EVAL_CASES.find((c) => c.category === "preference-conflict");
  assert.ok(preferenceCase, "expected a preference-conflict case");
  const { outcome, matchesExpectation } = evaluateGuardCase(preferenceCase!);
  assert.equal(matchesExpectation, true);
  assert.equal(outcome.status, "DECIDED");
  assert.equal(outcome.status === "DECIDED" && outcome.decision.decision, "APPROVE");
});

test("malformed model output and adversarial identity cases are guard-only, not live-comparable", () => {
  for (const evalCase of VERIFIER_EVAL_CASES) {
    if (evalCase.category === "malformed-output" || evalCase.category === "adversarial-identity") {
      assert.equal(evalCase.liveComparable, false, evalCase.id);
    }
  }
  assert.ok(LIVE_COMPARABLE_EVAL_CASES.length > 0);
  for (const evalCase of LIVE_COMPARABLE_EVAL_CASES) {
    assert.ok(evalCase.expectedLiveDecision, `${evalCase.id} must declare an expected live decision`);
  }
});
