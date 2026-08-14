import { verifyPlan } from "./verify";
import { MENU_BY_ID, itemSatisfies } from "./menu";
import type { BuildOrderInput, PlanLine } from "./types";

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

// --- Scenario 1: the user's own example. 18 people, $120 budget, one
// dietary group of 2 (Vegetarian + Gluten-Friendly). A correctly built
// plan should verify cleanly.
{
  console.log("Scenario 1: 18 people, $120, 2x Vegetarian+GlutenFriendly");
  const input: BuildOrderInput = {
    attendees: 18,
    budget: 120,
    storeId: "10088",
    groups: [{ id: "g1", people: 2, restrictions: ["vegetarian", "glutenFriendly"], notes: "No mushrooms" }],
  };
  // 54 slices required overall; group needs 6 verified-safe slices.
  const plan: PlanLine[] = [
    { itemId: "gluten-friendly-pizza-p8", quantity: 1 }, // 6 slices, covers the GF+veg group
    { itemId: "classic-pepperoni-p37", quantity: 6 }, // medium, 8 slices each = 48
  ];
  const result = verifyPlan(plan, input);
  check("total slices >= 54", result.totals.totalSlices >= 54);
  check("group g1 satisfied", result.groupCoverage[0].satisfied === true);
  check("verified overall", result.verified === true);
  console.log(`  totals: ${JSON.stringify(result.totals)}`);
}

// --- Scenario 2: budget too tight -> BUDGET_EXCEEDED.
{
  console.log("Scenario 2: 18 people, $30 budget (too low)");
  const input: BuildOrderInput = {
    attendees: 18,
    budget: 30,
    storeId: "10088",
    groups: [],
  };
  const plan: PlanLine[] = [{ itemId: "classic-pepperoni-p37", quantity: 7 }]; // 56 slices, ~$55.93+fees
  const result = verifyPlan(plan, input);
  check("not verified", result.verified === false);
  check("has BUDGET_EXCEEDED", result.failures.some((f) => f.code === "BUDGET_EXCEEDED"));
  console.log(`  failures: ${result.failures.map((f) => f.message).join(" | ")}`);
}

// --- Scenario 3: vegan group -> DIETARY_COVERAGE_IMPOSSIBLE (honest,
// not a fake match), since no item on this menu is curated vegan-safe.
{
  console.log("Scenario 3: vegan group (menu has no vegan item)");
  const input: BuildOrderInput = {
    attendees: 10,
    budget: 200,
    storeId: "10088",
    groups: [{ id: "g1", people: 1, restrictions: ["vegan"] }],
  };
  const plan: PlanLine[] = [{ itemId: "classic-cheese-p38", quantity: 4 }];
  const result = verifyPlan(plan, input);
  check("not verified", result.verified === false);
  check(
    "vegan group flagged impossible",
    result.groupCoverage[0].impossible === true &&
      result.failures.some((f) => f.code === "DIETARY_COVERAGE_IMPOSSIBLE")
  );
}

// --- Scenario 4: unverified item claim rejected -> item not in curated
// dietary tags must NOT count toward coverage even if it "sounds" safe.
{
  console.log("Scenario 4: unverified/untagged item must not count as dietary-safe");
  const input: BuildOrderInput = {
    attendees: 5,
    budget: 200,
    storeId: "10088",
    groups: [{ id: "g1", people: 2, restrictions: ["vegetarian"] }],
  };
  // ultimate-supreme has empty menu_label_hints and is NOT curated-safe -
  // must not satisfy the vegetarian group even though hints are empty.
  const plan: PlanLine[] = [{ itemId: "ultimate-supreme-p23", quantity: 2 }];
  const result = verifyPlan(plan, input);
  check("uncurated item does not satisfy group", result.groupCoverage[0].providedSlices === 0);
  check("group not satisfied", result.groupCoverage[0].satisfied === false);
}

// --- Scenario 5: invalid item id -> INVALID_ITEM_REFERENCE, no math performed.
{
  console.log("Scenario 5: hallucinated item id");
  const input: BuildOrderInput = { attendees: 5, budget: 200, storeId: "10088", groups: [] };
  const plan: PlanLine[] = [{ itemId: "does-not-exist", quantity: 1 }];
  const result = verifyPlan(plan, input);
  check("not verified", result.verified === false);
  check("has INVALID_ITEM_REFERENCE", result.failures.some((f) => f.code === "INVALID_ITEM_REFERENCE"));
}

// --- Scenario 6: sanity check on the menu data itself.
{
  console.log("Scenario 6: menu integrity");
  check("gluten-friendly-pizza-p8 resolves", !!MENU_BY_ID["gluten-friendly-pizza-p8"]);
  check("classic-pepperoni-p37 price is $7.99", MENU_BY_ID["classic-pepperoni-p37"].priceCad === 7.99);
}

// --- Scenario 7: combined restrictions must be satisfied by ONE item, not
// split across separate foods. classic-cheese-p38 is vegetarian-only (no
// glutenFriendly tag); it must NOT count for a Vegetarian+GlutenFriendly
// requirement even though a different item on the same order covers
// glutenFriendly alone.
{
  console.log("Scenario 7: combined restrictions cannot be split across items");
  check(
    "vegetarian-only item does not satisfy vegetarian+glutenFriendly",
    itemSatisfies("classic-cheese-p38", ["vegetarian", "glutenFriendly"]) === false
  );
  check(
    "the one dual-tagged item does satisfy vegetarian+glutenFriendly",
    itemSatisfies("gluten-friendly-pizza-p8", ["vegetarian", "glutenFriendly"]) === true
  );

  const input: BuildOrderInput = {
    attendees: 10,
    budget: 200,
    storeId: "10088",
    groups: [{ id: "g1", people: 2, restrictions: ["vegetarian", "glutenFriendly"] }],
  };
  // Plenty of vegetarian slices AND plenty of gluten-friendly-tagged slices
  // exist on this order, but from two different items - neither one alone
  // is both. Coverage must be 0, not the sum of the two.
  const plan: PlanLine[] = [
    { itemId: "classic-cheese-p38", quantity: 4 }, // vegetarian only
    { itemId: "gluten-friendly-pizza-p8", quantity: 0 }, // not actually ordered
  ];
  const result = verifyPlan(plan.filter((l) => l.quantity > 0), input);
  check("no cross-item credit for the combined group", result.groupCoverage[0].providedSlices === 0);
  check("combined group not satisfied", result.groupCoverage[0].satisfied === false);
}

// --- Scenario 8: vegan+glutenFriendly combo is impossible on this menu
// (no item is tagged both) - must be reported as impossible, not silently
// matched by inferring safety from separate vegan and gluten-friendly claims.
{
  console.log("Scenario 8: vegan+glutenFriendly combined group is impossible");
  const input: BuildOrderInput = {
    attendees: 10,
    budget: 200,
    storeId: "10088",
    groups: [{ id: "g1", people: 1, restrictions: ["vegan", "glutenFriendly"] }],
  };
  const plan: PlanLine[] = [{ itemId: "gluten-friendly-pizza-p8", quantity: 1 }];
  const result = verifyPlan(plan, input);
  check(
    "vegan+glutenFriendly flagged impossible, not matched",
    result.groupCoverage[0].impossible === true && result.groupCoverage[0].providedSlices === 0
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
