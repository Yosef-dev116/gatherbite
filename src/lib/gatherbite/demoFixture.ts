import type {
  CandidateEvidenceBundle,
  CandidateJourney,
  DominosCandidate,
  GatherBiteEvaluation,
  GatherBiteInput,
  PublicGatherBiteEvent,
  VerifiedDominosOption,
} from "./contracts";

/**
 * DEMO MODE fixture data — reuses the same realistic candidate/evidence shape
 * already proven in GatherBiteResults.test.tsx (reviewed, deterministic).
 * This is simulated data for presentation purposes only: it never touches
 * live Domino's data, a live model call, or the real /api/gatherbite or
 * /api/gatherbite/cart/prepare paths, and it never claims a prepared cart.
 * The production evaluation and cart-preparation paths are entirely
 * unaffected by this module.
 */

export const DEMO_INPUT: GatherBiteInput = {
  attendees: 6,
  budgetCad: 80,
  serviceMethod: "carryout",
  groups: [{ id: "group-vegetarian", people: 2, restrictions: ["vegetarian"] }],
  pizzaPreferences: ["pepperoni", "veggie"],
};

function candidate(id: string, version: number, storeId: string, protectedSlices: number): DominosCandidate {
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
        trustedSlicesPerPizza: protectedSlices,
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

function evidence(value: DominosCandidate, capacityPass: boolean): CandidateEvidenceBundle {
  const pass = (code: string, summary: string, facts: unknown = {}) => ({
    status: "PASS" as const, code, summary, facts, source: "exact evidence" as const,
  });
  return {
    candidateId: value.candidateId,
    candidateVersion: value.candidateVersion,
    snapshotVersion: value.snapshotVersion,
    checks: {
      menuIntegrity: pass("MENU", "Every configured line exists in the live menu."),
      dietary: pass("DIETARY", "Vegetarian group has protected slices.", {
        groups: [{ groupId: "group-vegetarian", requiredSlices: 6, allocatedSlices: capacityPass ? 8 : 6 }],
      }),
      capacity: capacityPass
        ? pass("CAPACITY", "24 verified slices cover 6 people.", { requiredSlices: 18, totalSlices: 24 })
        : { status: "FAIL" as const, code: "CAPACITY", summary: "Only 16 of 18 required slices were provided.", facts: { requiredSlices: 18, totalSlices: 16 }, source: "exact evidence" as const },
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

const rejectedCandidate = candidate("demo-v1", 1, "10950", 6);
const approvedCandidate = candidate("demo-v2", 2, "10950", 8);

const rejectedJourney: CandidateJourney = {
  candidate: rejectedCandidate,
  adaptedFromCandidateId: null,
  outcome: {
    status: "DECIDED",
    decision: {
      candidateId: rejectedCandidate.candidateId, candidateVersion: rejectedCandidate.candidateVersion,
      snapshotVersion: rejectedCandidate.snapshotVersion, decision: "REJECT", disposition: "ADAPT_ORDER",
      reasons: ["Only 16 of 18 required slices were provided."], unknowns: [],
    },
    evidence: evidence(rejectedCandidate, false),
  },
};

const approvedJourney: CandidateJourney = {
  candidate: approvedCandidate,
  adaptedFromCandidateId: rejectedCandidate.candidateId,
  outcome: {
    status: "DECIDED",
    decision: {
      candidateId: approvedCandidate.candidateId, candidateVersion: approvedCandidate.candidateVersion,
      snapshotVersion: approvedCandidate.snapshotVersion, decision: "APPROVE", disposition: "NONE",
      reasons: ["All hard checks passed after adapting the protected pizza size."], unknowns: [],
    },
    evidence: evidence(approvedCandidate, true),
  },
};

const recommendedOption: VerifiedDominosOption = {
  candidate: approvedCandidate,
  decision: {
    candidateId: approvedCandidate.candidateId, candidateVersion: approvedCandidate.candidateVersion,
    snapshotVersion: approvedCandidate.snapshotVersion, decision: "APPROVE", disposition: "NONE",
    reasons: ["All hard checks passed after adapting the protected pizza size."], unknowns: [],
  },
  evidence: evidence(approvedCandidate, true),
  storeAddress: "386 University Ave, Charlottetown, PE",
  displayLines: approvedCandidate.pizzas.map((line) => ({
    lineId: line.lineId,
    quantity: line.quantity,
    productName: "Pizza",
    variantName: '12" Hand Tossed',
    sauceName: "Pizza Sauce",
    cheeseName: "Cheese",
    toppings: line.toppings.map(({ code, quantity }) => ({
      code,
      quantity,
      name: code === "P" ? "Pepperoni" : null,
    })),
  })),
  relevantWaitMinutes: { min: 8, max: 12 },
  recommendationReason: "Adapted after the first candidate came up short on protected capacity, then verified with a $34.50 CAD total.",
};

const demoEvents: PublicGatherBiteEvent[] = [
  { type: "stage", stage: "observing", message: "Checking live Domino's options." },
  { type: "stage", stage: "planning", message: "Planning from live Domino's options." },
  { type: "candidate", candidateId: rejectedCandidate.candidateId, summary: "2 pizzas at Domino's store 10950." },
  { type: "decision", candidateId: rejectedCandidate.candidateId, decision: "REJECT", reason: "Only 16 of 18 required slices were provided." },
  { type: "stage", stage: "adapting", message: "Adapting the order from verifier feedback." },
  { type: "candidate", candidateId: approvedCandidate.candidateId, summary: "3 pizzas at Domino's store 10950." },
  { type: "decision", candidateId: approvedCandidate.candidateId, decision: "APPROVE", reason: "All hard checks passed after adapting the protected pizza size." },
  { type: "stage", stage: "comparing", message: "Comparing verified Domino's options." },
];

export const DEMO_EVALUATION: GatherBiteEvaluation = {
  recommended: recommendedOption,
  alternatives: [],
  journeys: [rejectedJourney, approvedJourney],
  events: demoEvents,
  noViableReason: null,
};
