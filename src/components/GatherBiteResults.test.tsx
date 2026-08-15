import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DecisionReview } from "./DecisionReview";
import { EvaluationProgress } from "./EvaluationProgress";
import { GatherBiteResults, reduceDecisionState } from "./GatherBiteResults";
import { VerificationJourney } from "./VerificationJourney";
import { VerifiedOptions } from "./VerifiedOptions";
import type {
  CandidateEvidenceBundle,
  CandidateJourney,
  DominosCandidate,
  GatherBiteEvaluation,
  PublicGatherBiteEvent,
  VerifiedDominosOption,
} from "../lib/gatherbite/contracts";

function candidate(id: string, version = 1, storeId = "10950"): DominosCandidate {
  return {
    candidateId: id,
    candidateVersion: version,
    snapshotVersion: `${storeId}:2026-08-15T12:00:00.000Z`,
    storeId,
    serviceMethod: "carryout",
    dealCodes: ["3021"],
    pizzas: [
      {
        lineId: `${id}-protected`, quantity: 1, productCode: "S_PIZZA", variantCode: "12SCREEN",
        sizeCode: "12", crustCode: "HANDTOSS", sauceCode: "X", cheeseCode: "C",
        toppings: [], purpose: "dietary-protected", protectsGroupIds: ["group-vegetarian"],
        trustedSlicesPerPizza: 8,
      },
      {
        lineId: `${id}-general`, quantity: 2, productCode: "S_PIZZA", variantCode: "12SCREEN",
        sizeCode: "12", crustCode: "HANDTOSS", sauceCode: "X", cheeseCode: "C",
        toppings: [{ code: "P", quantity: 1 }], purpose: "general", protectsGroupIds: [],
        trustedSlicesPerPizza: 8,
      },
    ],
    expectedPricing: { subtotalCad: 30, taxCad: 4.5, feesCad: 0, totalCad: 34.5 },
  };
}

function evidence(value: DominosCandidate, capacity: "PASS" | "FAIL" = "PASS"): CandidateEvidenceBundle {
  const pass = (code: string, summary: string, facts: unknown = {}) => ({
    status: "PASS" as const, code, summary, facts, source: "exact evidence",
  });
  return {
    candidateId: value.candidateId,
    candidateVersion: value.candidateVersion,
    snapshotVersion: value.snapshotVersion,
    checks: {
      menuIntegrity: pass("MENU", "Every configured line exists in the live menu."),
      dietary: pass("DIETARY", "Vegetarian group has 8 protected slices.", {
        groups: [{ groupId: "group-vegetarian", requiredSlices: 6, allocatedSlices: 8 }],
      }),
      capacity: capacity === "PASS"
        ? pass("CAPACITY", "24 verified slices cover 6 people.", { requiredSlices: 18, totalSlices: 24 })
        : { status: "FAIL", code: "CAPACITY", summary: "Only 16 of 18 required slices were provided.", facts: { requiredSlices: 18, totalSlices: 16 }, source: "exact evidence" },
      budget: pass("BUDGET", "The complete verified total is $34.50 CAD.", { totalCad: 34.5 }),
      availability: pass("AVAILABLE", "The store is open for carryout.", { waitMinutes: { min: 8, max: 12 } }),
      serviceability: pass("CARRYOUT", "Address serviceability is not required for carryout."),
    },
    preference: {
      requested: ["pepperoni", "veggie"],
      represented: ["pepperoni"],
      unmet: [{ preference: "veggie", reason: "Dietary-protected pizzas were reserved first." }],
    },
    collectedAt: "2026-08-15T12:00:01.000Z",
  };
}

function approved(value: DominosCandidate): CandidateJourney {
  const proof = evidence(value);
  return {
    candidate: value,
    adaptedFromCandidateId: null,
    outcome: {
      status: "DECIDED",
      decision: {
        candidateId: value.candidateId, candidateVersion: value.candidateVersion,
        snapshotVersion: value.snapshotVersion, decision: "APPROVE", disposition: "NONE",
        reasons: ["All hard checks passed."], unknowns: [],
      },
      evidence: proof,
    },
  };
}

function rejected(value: DominosCandidate): CandidateJourney {
  const proof = evidence(value, "FAIL");
  return {
    candidate: value,
    adaptedFromCandidateId: null,
    outcome: {
      status: "DECIDED",
      decision: {
        candidateId: value.candidateId, candidateVersion: value.candidateVersion,
        snapshotVersion: value.snapshotVersion, decision: "REJECT", disposition: "ADAPT_ORDER",
        reasons: ["Only 16 of 18 required slices were provided."], unknowns: [],
      },
      evidence: proof,
    },
  };
}

function option(value: DominosCandidate, reason: string): VerifiedDominosOption {
  const journey = approved(value);
  assert.equal(journey.outcome.status, "DECIDED");
  assert.equal(journey.outcome.decision.decision, "APPROVE");
  return {
    candidate: value,
    decision: journey.outcome.decision,
    evidence: journey.outcome.evidence,
    storeAddress: value.storeId === "10950"
      ? "386 University Ave, Charlottetown, PE"
      : "14 Kinlock Rd Unit 11, Stratford, PE",
    relevantWaitMinutes: { min: 8, max: 12 },
    recommendationReason: reason,
  };
}

test("progress renders only received public events without synthetic percentages or reasoning", () => {
  const events: PublicGatherBiteEvent[] = [
    { type: "stage", stage: "observing", message: "Checking live Domino's options." },
    { type: "candidate", candidateId: "candidate-1", summary: "Planner proposed candidate 1." },
    { type: "decision", candidateId: "candidate-1", decision: "REJECT", reason: "Capacity was insufficient." },
    { type: "stage", stage: "adapting", message: "Planner is adjusting the order." },
  ];
  const html = renderToStaticMarkup(createElement(EvaluationProgress, { events, busy: true }));

  assert.match(html, /aria-live="polite"/);
  for (const message of events.slice(1).map((event) => event.type === "stage" ? event.message : event.type === "candidate" ? event.summary : event.type === "decision" ? event.reason : "")) {
    assert.match(html, new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(html, /Checking live Domino&#x27;s options\./);
  assert.equal(html.includes("%"), false);
  assert.equal(html.includes("thought"), false);
});

test("the real rejection stays open and the adapted candidate points back to it", () => {
  const first = rejected(candidate("candidate-1"));
  const next = approved(candidate("candidate-2", 2));
  next.adaptedFromCandidateId = "candidate-1";
  const html = renderToStaticMarkup(createElement(VerificationJourney, { journeys: [first, next] }));

  assert.match(html, /<details[^>]*open=""/);
  assert.match(html, /Verification Agent rejected/);
  assert.match(html, /Only 16 of 18 required slices were provided/);
  assert.match(html, /2 × 12&quot; HANDTOSS pizza/);
  assert.match(html, /Protected for group-vegetarian/);
  assert.match(html, /Adapted after candidate-1 was rejected/);
  assert.match(html, /Capacity[^<]*<\/span><span[^>]*>Fail/);
  assert.equal(html.includes("chain-of-thought"), false);
});

test("a first-pass approval stays compact and never claims an adaptation happened", () => {
  const html = renderToStaticMarkup(createElement(VerificationJourney, {
    journeys: [approved(candidate("first-pass"))],
  }));

  assert.equal(/<details[^>]*open=""/.test(html), false);
  assert.match(html, /Proposed and independently verified/);
  assert.equal(/adapted|rejected/i.test(html), false);
});

test("recommendation leads while alternatives and rejected checks remain available without auto-selection", () => {
  const recommended = option(candidate("recommended"), "Best verified preference fit and total.");
  const alternative = option(candidate("alternative", 1, "10953"), "Another verified option.");
  const failed = rejected(candidate("rejected"));
  const html = renderToStaticMarkup(createElement(VerifiedOptions, {
    recommended,
    alternatives: [alternative],
    journeys: [failed, approved(recommended.candidate), approved(alternative.candidate)],
    selectedCandidateId: null,
    onSelect: () => undefined,
  }));

  assert.match(html, /GatherBite recommends/);
  assert.match(html, /386 University Ave/);
  assert.match(html, /Carryout/);
  assert.match(html, /\$34\.50 CAD/);
  assert.match(html, /8–12 min/);
  assert.match(html, /Capacity[^<]*<\/span><span[^>]*>Pass/);
  assert.match(html, /See other verified options/);
  assert.match(html, /What else GatherBite checked/);
  assert.match(html, /What else GatherBite checked[\s\S]*Capacity[\s\S]*Fail/);
  assert.match(html, /Select this option/);
  assert.equal(html.includes("Selected option"), false);
  assert.equal(html.includes("Little Caesars"), false);
});

test("no viable result names blockers and safe adjustments without weakening dietary needs", () => {
  const evaluation: GatherBiteEvaluation = {
    recommended: null,
    alternatives: [],
    journeys: [rejected(candidate("rejected"))],
    events: [],
    noViableReason: "Only 16 of 18 required slices were provided.",
  };
  const html = renderToStaticMarkup(createElement(GatherBiteResults, {
    evaluation,
    selectedCandidateId: null,
    cartIntent: "idle",
    onSelect: () => undefined,
    onChangeSelection: () => undefined,
    onPrepareCart: () => undefined,
  }));

  assert.match(html, /No verified option yet/);
  assert.match(html, /Only 16 of 18 required slices were provided/);
  assert.match(html, /Keep every dietary need unchanged/);
  assert.equal(/remove dietary|ignore dietary/i.test(html), false);
});

test("decision review shows the exact approved configuration and keeps checkout human-controlled", () => {
  const selected = option(candidate("selected"), "Best verified preference fit and total.");
  const html = renderToStaticMarkup(createElement(DecisionReview, {
    option: selected,
    cartIntent: "idle",
    onChange: () => undefined,
    onPrepareCart: () => undefined,
  }));

  assert.match(html, /Your decision/);
  assert.match(html, /Store 10950/);
  assert.match(html, /1 × 12&quot; HANDTOSS pizza/);
  assert.match(html, /Sauce X/);
  assert.match(html, /Cheese C/);
  assert.match(html, /Toppings P × 1/);
  assert.match(html, /Protected for group-vegetarian/);
  assert.match(html, /24 verified slices/);
  assert.match(html, /The complete verified total is \$34\.50 CAD/);
  assert.match(html, /Pepperoni/);
  assert.match(html, /Prepare my Domino&#x27;s cart/);
  assert.match(html, /Change selected option/);
  assert.match(html, /You review the official cart and complete payment/);
  assert.equal(html.includes("cart is ready"), false);
});

test("decision state changes selection and resets stale cart intent", () => {
  const selected = reduceDecisionState(
    { selectedCandidateId: null, cartIntent: "idle" },
    { type: "select", candidateId: "first" },
  );
  const preparing = reduceDecisionState(selected, { type: "prepare" });
  const changed = reduceDecisionState(preparing, { type: "select", candidateId: "second" });
  const cleared = reduceDecisionState(changed, { type: "clear" });

  assert.deepEqual(selected, { selectedCandidateId: "first", cartIntent: "idle" });
  assert.deepEqual(preparing, { selectedCandidateId: "first", cartIntent: "requested" });
  assert.deepEqual(changed, { selectedCandidateId: "second", cartIntent: "idle" });
  assert.deepEqual(cleared, { selectedCandidateId: null, cartIntent: "idle" });
});
