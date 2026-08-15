import type {
  CandidateEvidenceBundle,
  CandidatePizza,
  DominosCandidate,
  EvidenceCheck,
  VerificationDecision,
  VerificationOutcome,
} from "../gatherbite/contracts";
import { guardVerificationDecision } from "./verifierGuard";

/**
 * Fixed, deterministic, network-free eval cases for the verifier's protocol
 * guard (`guardVerificationDecision`). Every case is a hand-built
 * `(rawDecision, rawEvidence, expectedCandidate)` triple with a known-correct
 * outcome, following the fixture patterns already used by
 * `verifierGuard.test.ts`, `dominosVerifier.test.ts`, and
 * `dominosEvidence.test.ts`.
 *
 * This module intentionally holds only case definitions and the small
 * guard-accuracy helpers the deterministic tests (and the opt-in live
 * runner) share. It does not call any model or network API.
 */

export type Disposition = "NONE" | "ADAPT_ORDER" | "TRY_ANOTHER_STORE" | "TERMINAL";

export type VerifierEvalCategory =
  | "valid"
  | "preference-conflict"
  | "hard-failure"
  | "insufficient-capacity"
  | "over-budget"
  | "unavailable"
  | "unserviceable"
  | "combined-failure"
  | "stale-unknown"
  | "malformed-output"
  | "adversarial-identity";

export interface VerifierEvalExpectation {
  status: "DECIDED" | "VERIFIER_ERROR";
  decision?: "APPROVE" | "REJECT";
  disposition?: Disposition;
}

export interface VerifierEvalCase {
  id: string;
  category: VerifierEvalCategory;
  description: string;
  candidate: DominosCandidate;
  evidence: CandidateEvidenceBundle;
  /** The exact raw, model-issued decision object under test. */
  rawDecision: unknown;
  /** The guard outcome this exact triple must deterministically produce. */
  expected: VerifierEvalExpectation;
  /**
   * True when `rawDecision` represents a model attempting an unsafe or
   * incorrect APPROVE (whether adversarial or merely wrong) that the guard
   * must veto. Used to audit for zero false approvals across the whole set.
   */
  isFalseApprovalAttempt: boolean;
  /**
   * True when this case's `evidence` is realistic and well-formed enough to
   * also drive a live model's own independent decision (Step 3's model
   * comparison). False for cases that exist purely to exercise the guard's
   * own schema/identity protocol (malformed model output, adversarial
   * identity substitution) — no live model can be prompted to deliberately
   * emit those broken raw shapes, so they are guard-only.
   */
  liveComparable: boolean;
  /** Required when `liveComparable` is true: what a correct model should decide from `evidence` alone. */
  expectedLiveDecision?: "APPROVE" | "REJECT";
}

const SOURCE = "Synthetic fixed eval evidence";

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

/** The realistic, internally-consistent base candidate shared by most cases. */
export const EVAL_CANDIDATE: DominosCandidate = {
  candidateId: "eval-candidate-1",
  candidateVersion: 3,
  snapshotVersion: "10950:2026-08-15T12:00:00.000Z",
  storeId: "10950",
  serviceMethod: "carryout",
  dealCodes: [],
  pizzas: [pizza()],
  expectedPricing: {
    subtotalCad: 29.98,
    taxCad: 4.5,
    feesCad: 0,
    totalCad: 34.48,
  },
};

function check(status: EvidenceCheck["status"], code: string, summary: string, facts: unknown = {}): EvidenceCheck {
  return { status, code, summary, facts, source: SOURCE };
}

function passingChecks(): CandidateEvidenceBundle["checks"] {
  return {
    menuIntegrity: check("PASS", "MENU_LIVE", "All referenced items are on the live catalog."),
    dietary: check("PASS", "DIETARY_CLEAR", "No protected line contains a restricted ingredient."),
    capacity: check("PASS", "CAPACITY_SUFFICIENT", "Trusted slices meet every protected group's need."),
    budget: check("PASS", "PRICE_WITHIN_BUDGET", "Candidate total is within the stated budget."),
    availability: check("PASS", "STORE_OPEN", "Store is open and taking online orders."),
    serviceability: check("PASS", "SERVICEABLE", "Store serviceability confirmed for this request."),
  };
}

function baseEvidence(overrides: Partial<CandidateEvidenceBundle> = {}): CandidateEvidenceBundle {
  return {
    candidateId: EVAL_CANDIDATE.candidateId,
    candidateVersion: EVAL_CANDIDATE.candidateVersion,
    snapshotVersion: EVAL_CANDIDATE.snapshotVersion,
    checks: passingChecks(),
    preference: { requested: [], represented: [], unmet: [] },
    collectedAt: "2026-08-15T12:01:00.000Z",
    ...overrides,
  };
}

function approveDecision(overrides: Partial<Extract<VerificationDecision, { decision: "APPROVE" }>> = {}): VerificationDecision {
  return {
    candidateId: EVAL_CANDIDATE.candidateId,
    candidateVersion: EVAL_CANDIDATE.candidateVersion,
    snapshotVersion: EVAL_CANDIDATE.snapshotVersion,
    decision: "APPROVE",
    disposition: "NONE",
    reasons: ["All exact hard-constraint evidence passes."],
    unknowns: [],
    ...overrides,
  };
}

function rejectDecision(
  disposition: Exclude<Disposition, "NONE">,
  reason: string,
  overrides: Partial<Extract<VerificationDecision, { decision: "REJECT" }>> = {},
): VerificationDecision {
  return {
    candidateId: EVAL_CANDIDATE.candidateId,
    candidateVersion: EVAL_CANDIDATE.candidateVersion,
    snapshotVersion: EVAL_CANDIDATE.snapshotVersion,
    decision: "REJECT",
    disposition,
    reasons: [reason],
    unknowns: [],
    ...overrides,
  };
}

interface FailureFixture {
  checkKey: keyof CandidateEvidenceBundle["checks"];
  category: VerifierEvalCategory;
  status: "FAIL" | "UNKNOWN";
  check: EvidenceCheck;
  disposition: Exclude<Disposition, "NONE">;
  rejectReason: string;
}

const HARD_FAILURES: FailureFixture[] = [
  {
    checkKey: "menuIntegrity",
    category: "hard-failure",
    status: "FAIL",
    check: check("FAIL", "MENU_ITEM_NOT_LIVE", "Referenced product is not on the current live catalog."),
    disposition: "ADAPT_ORDER",
    rejectReason: "Menu integrity evidence failed: a referenced item is no longer live.",
  },
  {
    checkKey: "dietary",
    category: "hard-failure",
    status: "FAIL",
    check: check("FAIL", "DIETARY_CONTAINS", "Protected line contains pepperoni, which conflicts with a noPork restriction.", { relation: "CONTAINS" }),
    disposition: "ADAPT_ORDER",
    rejectReason: "Dietary evidence failed: a protected line contains a restricted ingredient.",
  },
  {
    checkKey: "capacity",
    category: "insufficient-capacity",
    status: "FAIL",
    check: check("FAIL", "CAPACITY_INSUFFICIENT", "Protected slices are insufficient for the vegetarian group: needs 8, has 4.", { neededSlices: 8, trustedSlices: 4 }),
    disposition: "ADAPT_ORDER",
    rejectReason: "Capacity evidence failed: trusted slices do not cover every protected group.",
  },
  {
    checkKey: "budget",
    category: "over-budget",
    status: "FAIL",
    check: check("FAIL", "PRICE_OVER_BUDGET", "Candidate total $46.50 exceeds the stated budget of $40.00.", { totalCad: 46.5, budgetCad: 40 }),
    disposition: "ADAPT_ORDER",
    rejectReason: "Budget evidence failed: the candidate total exceeds the stated budget.",
  },
  {
    checkKey: "availability",
    category: "unavailable",
    status: "FAIL",
    check: check("FAIL", "STORE_CLOSED", "Store 10950 is not open for online orders.", { isOpen: false }),
    disposition: "TRY_ANOTHER_STORE",
    rejectReason: "Availability evidence failed: the store is not currently open.",
  },
  {
    checkKey: "serviceability",
    category: "unserviceable",
    status: "FAIL",
    check: check("FAIL", "NOT_SERVICEABLE", "No serviceable store was returned for the delivery address.", { storeIds: [] }),
    disposition: "TRY_ANOTHER_STORE",
    rejectReason: "Serviceability evidence failed: this store cannot deliver to the address.",
  },
];

function evidenceWithFailure(fixture: FailureFixture): CandidateEvidenceBundle {
  return baseEvidence({ checks: { ...passingChecks(), [fixture.checkKey]: fixture.check } });
}

function scenarioPair(
  idPrefix: string,
  category: VerifierEvalCategory,
  description: string,
  evidence: CandidateEvidenceBundle,
  disposition: Exclude<Disposition, "NONE">,
  rejectReason: string,
): VerifierEvalCase[] {
  return [
    {
      id: `${idPrefix}-correct-reject`,
      category,
      description: `${description}: a correctly-behaving model rejects with a matching disposition.`,
      candidate: EVAL_CANDIDATE,
      evidence,
      rawDecision: rejectDecision(disposition, rejectReason),
      expected: { status: "DECIDED", decision: "REJECT", disposition },
      isFalseApprovalAttempt: false,
      liveComparable: true,
      expectedLiveDecision: "REJECT",
    },
    {
      id: `${idPrefix}-adversarial-approve`,
      category,
      description: `${description}: an unsafe APPROVE attempt over this evidence must be vetoed (zero false approvals).`,
      candidate: EVAL_CANDIDATE,
      evidence,
      rawDecision: approveDecision(),
      expected: { status: "VERIFIER_ERROR" },
      isFalseApprovalAttempt: true,
      liveComparable: false,
    },
  ];
}

const validCase: VerifierEvalCase = {
  id: "valid-approve",
  category: "valid",
  description: "A fully grounded candidate with all six hard checks passing is approved.",
  candidate: EVAL_CANDIDATE,
  evidence: baseEvidence(),
  rawDecision: approveDecision(),
  expected: { status: "DECIDED", decision: "APPROVE", disposition: "NONE" },
  isFalseApprovalAttempt: false,
  liveComparable: true,
  expectedLiveDecision: "APPROVE",
};

const preferenceConflictCase: VerifierEvalCase = {
  id: "preference-conflict-approve",
  category: "preference-conflict",
  description: "An unmet soft pizza preference never blocks approval when every hard check passes.",
  candidate: EVAL_CANDIDATE,
  evidence: baseEvidence({
    preference: {
      requested: ["pepperoni"],
      represented: [],
      unmet: [{ preference: "pepperoni", reason: "The store's live catalog did not offer pepperoni today." }],
    },
  }),
  rawDecision: approveDecision(),
  expected: { status: "DECIDED", decision: "APPROVE", disposition: "NONE" },
  isFalseApprovalAttempt: false,
  liveComparable: true,
  expectedLiveDecision: "APPROVE",
};

const hardFailureCases: VerifierEvalCase[] = HARD_FAILURES.flatMap((fixture) => scenarioPair(
  fixture.checkKey,
  fixture.category,
  `${fixture.checkKey} evidence fails`,
  evidenceWithFailure(fixture),
  fixture.disposition,
  fixture.rejectReason,
));

const combinedFailureEvidence = baseEvidence({
  checks: {
    ...passingChecks(),
    dietary: check("FAIL", "DIETARY_CONTAINS", "Protected line contains a restricted ingredient.", { relation: "CONTAINS" }),
    budget: check("FAIL", "PRICE_OVER_BUDGET", "Candidate total exceeds the stated budget.", { totalCad: 52, budgetCad: 40 }),
  },
});
const combinedFailureCases = scenarioPair(
  "combined-failure",
  "combined-failure",
  "Dietary and budget evidence fail simultaneously",
  combinedFailureEvidence,
  "ADAPT_ORDER",
  "Dietary and budget evidence both failed for this candidate.",
);

const staleUnknownEvidence = baseEvidence({
  checks: {
    ...passingChecks(),
    menuIntegrity: check("UNKNOWN", "SNAPSHOT_STALE", "The live snapshot is older than the evidence freshness window.", { ageMs: 400_000 }),
  },
});
const staleUnknownCases = scenarioPair(
  "stale-unknown",
  "stale-unknown",
  "Menu-integrity evidence is UNKNOWN because the live snapshot is stale",
  staleUnknownEvidence,
  "TERMINAL",
  "Menu integrity evidence is unknown; the live snapshot was stale at collection time.",
);

// Malformed model output: the evidence and identity are fine, but the raw
// decision object itself does not satisfy VerifierDecisionSchema.
const malformedOutputCases: VerifierEvalCase[] = [
  {
    id: "malformed-missing-reasons",
    category: "malformed-output",
    description: "An APPROVE decision missing the required reasons tuple is a schema failure.",
    candidate: EVAL_CANDIDATE,
    evidence: baseEvidence(),
    rawDecision: (() => {
      const withoutReasons = approveDecision() as Record<string, unknown>;
      delete withoutReasons.reasons;
      return withoutReasons;
    })(),
    expected: { status: "VERIFIER_ERROR" },
    isFalseApprovalAttempt: true,
    liveComparable: false,
  },
  {
    id: "malformed-wrong-disposition-for-approve",
    category: "malformed-output",
    description: "An APPROVE decision must carry disposition NONE, never an adaptation disposition.",
    candidate: EVAL_CANDIDATE,
    evidence: baseEvidence(),
    rawDecision: { ...approveDecision(), disposition: "ADAPT_ORDER" },
    expected: { status: "VERIFIER_ERROR" },
    isFalseApprovalAttempt: true,
    liveComparable: false,
  },
  {
    id: "malformed-extra-field",
    category: "malformed-output",
    description: "An unexpected extra field (e.g. a smuggled confidence score) fails the strict decision schema.",
    candidate: EVAL_CANDIDATE,
    evidence: baseEvidence(),
    rawDecision: { ...approveDecision(), confidence: 0.97 },
    expected: { status: "VERIFIER_ERROR" },
    isFalseApprovalAttempt: true,
    liveComparable: false,
  },
  {
    id: "malformed-non-object",
    category: "malformed-output",
    description: "A bare string instead of a structured decision object is a schema failure.",
    candidate: EVAL_CANDIDATE,
    evidence: baseEvidence(),
    rawDecision: "APPROVE",
    expected: { status: "VERIFIER_ERROR" },
    isFalseApprovalAttempt: false,
    liveComparable: false,
  },
  {
    id: "malformed-null",
    category: "malformed-output",
    description: "A null decision (e.g. an empty/failed generation) is a schema failure.",
    candidate: EVAL_CANDIDATE,
    evidence: baseEvidence(),
    rawDecision: null,
    expected: { status: "VERIFIER_ERROR" },
    isFalseApprovalAttempt: false,
    liveComparable: false,
  },
  {
    id: "malformed-unknown-decision-enum",
    category: "malformed-output",
    description: "A decision value outside {APPROVE, REJECT} fails the discriminated union.",
    candidate: EVAL_CANDIDATE,
    evidence: baseEvidence(),
    rawDecision: { ...approveDecision(), decision: "MAYBE" },
    expected: { status: "VERIFIER_ERROR" },
    isFalseApprovalAttempt: false,
    liveComparable: false,
  },
  {
    id: "malformed-reject-empty-reasons",
    category: "malformed-output",
    description: "A REJECT decision must carry exactly one public reason.",
    candidate: EVAL_CANDIDATE,
    evidence: evidenceWithFailure(HARD_FAILURES[1]),
    rawDecision: { ...rejectDecision("ADAPT_ORDER", "placeholder"), reasons: [] },
    expected: { status: "VERIFIER_ERROR" },
    isFalseApprovalAttempt: false,
    liveComparable: false,
  },
  {
    id: "malformed-approve-nonempty-unknowns",
    category: "malformed-output",
    description: "An APPROVE decision must carry an empty unknowns tuple, never leftover unknowns.",
    candidate: EVAL_CANDIDATE,
    evidence: baseEvidence(),
    rawDecision: { ...approveDecision(), unknowns: ["some-unknown-code"] },
    expected: { status: "VERIFIER_ERROR" },
    isFalseApprovalAttempt: true,
    liveComparable: false,
  },
];

// Adversarial identity: the decision object is well-formed on its own, but
// its identity fields do not match the evidence and/or the real candidate —
// exactly the substitution attack the guard's identity binding must catch.
const attackerCandidateId = "attacker-candidate";
const adversarialIdentityCases: VerifierEvalCase[] = [
  {
    id: "adversarial-candidateId-mismatch",
    category: "adversarial-identity",
    description: "A decision claiming a different candidateId than the evidence it was issued against.",
    candidate: EVAL_CANDIDATE,
    evidence: baseEvidence(),
    rawDecision: approveDecision({ candidateId: attackerCandidateId }),
    expected: { status: "VERIFIER_ERROR" },
    isFalseApprovalAttempt: true,
    liveComparable: false,
  },
  {
    id: "adversarial-candidateVersion-mismatch",
    category: "adversarial-identity",
    description: "A decision claiming a stale/future candidateVersion relative to its evidence.",
    candidate: EVAL_CANDIDATE,
    evidence: baseEvidence(),
    rawDecision: approveDecision({ candidateVersion: EVAL_CANDIDATE.candidateVersion + 1 }),
    expected: { status: "VERIFIER_ERROR" },
    isFalseApprovalAttempt: true,
    liveComparable: false,
  },
  {
    id: "adversarial-snapshotVersion-mismatch",
    category: "adversarial-identity",
    description: "A decision bound to a different live-catalog snapshot than the evidence it was issued against.",
    candidate: EVAL_CANDIDATE,
    evidence: baseEvidence(),
    rawDecision: approveDecision({ snapshotVersion: "tampered-snapshot" }),
    expected: { status: "VERIFIER_ERROR" },
    isFalseApprovalAttempt: true,
    liveComparable: false,
  },
  {
    id: "adversarial-evidence-swapped",
    category: "adversarial-identity",
    description: "An honest decision paired with an evidence bundle collected for a different candidate.",
    candidate: EVAL_CANDIDATE,
    evidence: baseEvidence({ candidateId: attackerCandidateId }),
    rawDecision: approveDecision(),
    expected: { status: "VERIFIER_ERROR" },
    isFalseApprovalAttempt: true,
    liveComparable: false,
  },
  {
    id: "adversarial-decision-and-evidence-agree-but-not-the-real-candidate",
    category: "adversarial-identity",
    description: "Decision and evidence agree with each other (a replayed prior approval) but not with the real candidate under verification.",
    candidate: EVAL_CANDIDATE,
    evidence: baseEvidence({ candidateId: attackerCandidateId }),
    rawDecision: approveDecision({ candidateId: attackerCandidateId }),
    expected: { status: "VERIFIER_ERROR" },
    isFalseApprovalAttempt: true,
    liveComparable: false,
  },
];

/** The full fixed eval case set, covering every category in the task brief. */
export const VERIFIER_EVAL_CASES: VerifierEvalCase[] = [
  validCase,
  preferenceConflictCase,
  ...hardFailureCases,
  ...combinedFailureCases,
  ...staleUnknownCases,
  ...malformedOutputCases,
  ...adversarialIdentityCases,
];

/** Cases realistic enough to also replay against a live verifier model (Step 3). */
export const LIVE_COMPARABLE_EVAL_CASES: VerifierEvalCase[] = VERIFIER_EVAL_CASES.filter((c) => c.liveComparable);

export interface VerifierEvalResult {
  case: VerifierEvalCase;
  outcome: VerificationOutcome;
  matchesExpectation: boolean;
  /** True when this was a false-approval attempt (per the case) and the guard failed to veto it. */
  isFalseApproval: boolean;
}

function outcomeMatchesExpectation(outcome: VerificationOutcome, expected: VerifierEvalExpectation): boolean {
  if (outcome.status !== expected.status) return false;
  if (outcome.status === "DECIDED") {
    if (expected.decision && outcome.decision.decision !== expected.decision) return false;
    if (expected.disposition && outcome.decision.disposition !== expected.disposition) return false;
  }
  return true;
}

/** Runs one case through the deterministic, network-free guard and scores it. */
export function evaluateGuardCase(evalCase: VerifierEvalCase): VerifierEvalResult {
  const outcome = guardVerificationDecision(evalCase.rawDecision, evalCase.evidence, evalCase.candidate);
  const matchesExpectation = outcomeMatchesExpectation(outcome, evalCase.expected);
  const isFalseApproval = evalCase.isFalseApprovalAttempt
    && outcome.status === "DECIDED"
    && outcome.decision.decision === "APPROVE";
  return { case: evalCase, outcome, matchesExpectation, isFalseApproval };
}

export function evaluateGuardCases(cases: VerifierEvalCase[] = VERIFIER_EVAL_CASES): VerifierEvalResult[] {
  return cases.map(evaluateGuardCase);
}

export function hasZeroFalseApprovals(results: VerifierEvalResult[]): boolean {
  return results.every((result) => !result.isFalseApproval);
}
