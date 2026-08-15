import { verifyPlan } from "./verify";
import { computeFoodBuffer, pickBestVerifiedPlan, estimateMinimumWorkableBudget, scoreGeneralPreferenceAlignment } from "./scoring";
import type { VerifiedCandidate } from "./scoring";
import type { BuildOrderInput, PlanLine, Restriction, VerifyResult } from "./types";

let pass = 0;
let fail = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    pass++;
    console.log(`  ok - ${name}`);
  } else {
    fail++;
    console.error(`  FAIL - ${name}`);
  }
}

// --- Scenario 1: multiple valid (verified) plans exist for the same
// request; the cheaper, lower-waste plan must win, even though the
// pricier/wastier one is scored second (order must not matter).
{
  console.log("Scenario 1: cheaper/lower-waste verified plan wins");
  const input: BuildOrderInput = { attendees: 8, budget: 200, storeId: "10088", groups: [] };
  // Plan A: exactly 24 slices, no waste, cheapest per-slice item.
  const planA: PlanLine[] = [{ itemId: "classic-pepperoni-p37", quantity: 3 }];
  // Plan B: 32 slices (8 excess) using a pricier item - both more
  // expensive AND more wasteful than plan A.
  const planB: PlanLine[] = [{ itemId: "classic-cheese-p38", quantity: 4 }];

  const resultA = verifyPlan(planA, input);
  const resultB = verifyPlan(planB, input);
  check("plan A verifies", resultA.verified === true);
  check("plan B verifies", resultB.verified === true);
  check("plan A is cheaper than plan B", resultA.totals.totalCad < resultB.totals.totalCad);
  check(
    "plan A has less waste than plan B",
    resultA.totals.totalSlices - resultA.totals.requiredSlices <
      resultB.totals.totalSlices - resultB.totals.requiredSlices
  );

  const candidates: VerifiedCandidate[] = [
    { lines: planB, verification: resultB }, // pricier one listed first on purpose
    { lines: planA, verification: resultA },
  ];
  const best = pickBestVerifiedPlan(candidates);
  check("the cheaper/lower-waste plan A is picked regardless of order", best?.lines[0].itemId === "classic-pepperoni-p37");
}

// --- Scenario 2: scoring never rescues an invalid plan - only verified
// candidates are ever eligible.
{
  console.log("Scenario 2: unverified candidates are never picked");
  const input: BuildOrderInput = { attendees: 20, budget: 5, storeId: "10088", groups: [] };
  const tooExpensive: PlanLine[] = [{ itemId: "classic-pepperoni-p37", quantity: 8 }];
  const result = verifyPlan(tooExpensive, input);
  check("candidate correctly fails hard verification", result.verified === false);
  const best = pickBestVerifiedPlan([{ lines: tooExpensive, verification: result }]);
  check("no candidate is picked when none verified", best === null);
}

// --- Scenario 3: bundle-value tie-break only applies when cost and
// waste are otherwise equal (priority 3, smallest weight).
{
  console.log("Scenario 3: bundle bonus only breaks true ties");
  const base: VerifyResult = {
    verified: true,
    failures: [],
    totals: {
      totalSlices: 24,
      requiredSlices: 24,
      subtotalCad: 20,
      feesCad: 5,
      totalCad: 25,
      budgetCad: 200,
      remainingBudgetCad: 175,
    },
    groupCoverage: [],
    bundlesUsed: [],
  };
  const withoutBundle: VerifiedCandidate = { lines: [{ itemId: "a", quantity: 1 }], verification: base };
  const withBundle: VerifiedCandidate = {
    lines: [{ itemId: "b", quantity: 1 }],
    verification: { ...base, bundlesUsed: ["Some Bundle"] },
  };
  const best = pickBestVerifiedPlan([withoutBundle, withBundle]);
  check("equal cost + equal waste: the bundle plan wins the tiebreak", best?.lines[0].itemId === "b");

  const cheaperNoBundle: VerifiedCandidate = {
    lines: [{ itemId: "c", quantity: 1 }],
    verification: { ...base, totals: { ...base.totals, totalCad: 24.99 } },
  };
  const bestWithRealCostDiff = pickBestVerifiedPlan([cheaperNoBundle, withBundle]);
  check(
    "a real cost difference still beats the bundle bonus",
    bestWithRealCostDiff?.lines[0].itemId === "c"
  );
}

// --- Scenario 4: budget-too-low case produces an exact, real shortfall
// number (the user's own 18-person / 2x Vegetarian+GlutenFriendly
// example, whose cheapest verified total is already known to be $74.23).
{
  console.log("Scenario 4: exact budget shortfall");
  const input = {
    attendees: 18,
    groups: [{ id: "g1", people: 2, restrictions: ["vegetarian", "glutenFriendly"] as Restriction[] }],
  };
  const estimate = estimateMinimumWorkableBudget(input);
  check("a minimum workable estimate exists", estimate !== null);
  check("minimum workable budget is exactly $74.23", estimate?.totalCad === 74.23);

  const currentBudget = 50;
  const shortfall = Math.round((estimate!.totalCad - currentBudget) * 100) / 100;
  check("shortfall is exactly $24.23", shortfall === 24.23);
}

// --- Scenario 5: dietary-impossible must NOT produce a budget
// suggestion, at any budget - a vegan group can never be satisfied by
// this menu regardless of how much money is available.
{
  console.log("Scenario 5: dietary-impossible never suggests more budget");
  const input = {
    attendees: 10,
    groups: [{ id: "g1", people: 1, restrictions: ["vegan"] as Restriction[] }],
  };
  const estimate = estimateMinimumWorkableBudget(input);
  check("no workable estimate exists for an impossible dietary group", estimate === null);
}

// --- Scenario 6: preferences rank only already-verified candidates.
{
  console.log("Scenario 6: soft preference ranking never rescues an invalid plan");
  const generousInput: BuildOrderInput = { attendees: 4, budget: 100, storeId: "10088", groups: [] };
  const cheaperNonPreferred: PlanLine[] = [{ itemId: "classic-pepperoni-p37", quantity: 2 }];
  const pricierPreferred: PlanLine[] = [{ itemId: "3-meat-treat-p2", quantity: 2 }];
  const cheaperVerification = verifyPlan(cheaperNonPreferred, generousInput);
  const preferredVerification = verifyPlan(pricierPreferred, generousInput);
  const preferredBest = pickBestVerifiedPlan(
    [
      { lines: cheaperNonPreferred, verification: cheaperVerification },
      { lines: pricierPreferred, verification: preferredVerification },
    ],
    ["meatHeavy"],
    []
  );
  check("both candidates pass hard verification first", cheaperVerification.verified && preferredVerification.verified);
  check("the represented preference can influence choice within the verified pool", preferredBest?.lines[0].itemId === "3-meat-treat-p2");

  const tightInput: BuildOrderInput = { ...generousInput, budget: 24 };
  const cheaperTight = verifyPlan(cheaperNonPreferred, tightInput);
  const preferredTight = verifyPlan(pricierPreferred, tightInput);
  const safeBest = pickBestVerifiedPlan(
    [
      { lines: pricierPreferred, verification: preferredTight },
      { lines: cheaperNonPreferred, verification: cheaperTight },
    ],
    ["meatHeavy"],
    []
  );
  check("the preferred plan is rejected by the hard budget gate", preferredTight.verified === false);
  check("an invalid preferred plan can never beat a verified plan", safeBest?.lines[0].itemId === "classic-pepperoni-p37");
}

// --- Scenario 7: no attendee-overlap inference. Any line that could be
// relied upon by a structured dietary group is excluded from preference
// scoring in its entirety.
{
  console.log("Scenario 7: dietary-capable lines are protected from preference scoring");
  const groups = [{ id: "g1", people: 2, restrictions: ["vegetarian"] as Restriction[] }];
  const protectedCheese = scoreGeneralPreferenceAlignment(
    [{ itemId: "classic-cheese-p38", quantity: 3 }],
    ["cheese"],
    groups
  );
  check("a cheese line that may carry vegetarian coverage earns no preference credit", protectedCheese.represented.length === 0 && protectedCheese.matchingGeneralSlices === 0);

  const generalPepperoni = scoreGeneralPreferenceAlignment(
    [
      { itemId: "classic-cheese-p38", quantity: 1 },
      { itemId: "classic-pepperoni-p37", quantity: 2 },
    ],
    ["pepperoni"],
    groups
  );
  check("a line that cannot cover that dietary group may represent a general preference", generalPepperoni.represented.includes("pepperoni") && generalPepperoni.matchingGeneralSlices === 16);
}

// --- Scenario 8: dietary group counts describe restrictions, not unique
// attendees. A buffer can only be suggested when one real item satisfies
// every group's restrictions; it must never infer a general pool by
// subtracting the overlapping group counts from attendees.
{
  console.log("Scenario 8: overlapping dietary groups never create inferred unrestricted attendees");
  const verification: VerifyResult = {
    verified: true,
    failures: [],
    totals: {
      totalSlices: 12,
      requiredSlices: 12,
      subtotalCad: 20,
      feesCad: 5,
      totalCad: 25,
      budgetCad: 100,
      remainingBudgetCad: 75,
    },
    groupCoverage: [],
    bundlesUsed: [],
  };
  const buffer = computeFoodBuffer(
    {
      attendees: 4,
      budget: 100,
      groups: [
        { id: "vegan", people: 4, restrictions: ["vegan"] },
        { id: "vegetarian", people: 4, restrictions: ["vegetarian"] },
      ],
    },
    verification
  );
  check("overlapping dietary groups do not imply negative or unrestricted attendees", buffer.extraItem === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
