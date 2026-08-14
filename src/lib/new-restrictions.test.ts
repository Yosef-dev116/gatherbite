import { verifyPlan } from "./verify";
import { itemSatisfies, anyMenuItemSatisfies, MENU_ITEMS } from "./menu";
import { estimateMinimumWorkableBudget, addBufferItem } from "./scoring";
import type { BuildOrderInput, PlanLine, Restriction } from "./types";

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

// --- No Pork: positive and negative ---
{
  console.log("No Pork");
  check("classic-cheese (no meat topping) satisfies No Pork", itemSatisfies("classic-cheese-p38", ["noPork"]) === true);
  check(
    "classic-pepperoni (has a meat topping, no verified breakdown) does NOT satisfy No Pork",
    itemSatisfies("classic-pepperoni-p37", ["noPork"]) === false
  );
}

// --- No Beef: positive and negative ---
{
  console.log("No Beef");
  check("classic-cheese satisfies No Beef", itemSatisfies("classic-cheese-p38", ["noBeef"]) === true);
  check(
    "classic-pepperoni does NOT satisfy No Beef",
    itemSatisfies("classic-pepperoni-p37", ["noBeef"]) === false
  );
}

// --- No Chicken: positive and negative ---
{
  console.log("No Chicken");
  check("classic-cheese satisfies No Chicken", itemSatisfies("classic-cheese-p38", ["noChicken"]) === true);
  check(
    "bbq-chicken (named chicken topping) does NOT satisfy No Chicken",
    itemSatisfies("bbq-chicken-p35", ["noChicken"]) === false
  );
}

// --- No Egg / No Soy / No Mustard: no trustworthy data exists for any
// item on this menu, so every one of these must fail closed - this is
// the correct, intentional outcome, not a bug. ---
{
  console.log("No Egg / No Soy / No Mustard: fail closed (no fabricated positive data)");
  const noDataRestrictions: Restriction[] = ["noEgg", "noSoy", "noMustard"];
  for (const restriction of noDataRestrictions) {
    const anySatisfies = MENU_ITEMS.some((item) => itemSatisfies(item.id, [restriction]));
    check(`no item on the whole menu is tagged ${restriction}`, anySatisfies === false);
    check(`anyMenuItemSatisfies([${restriction}]) is false`, anyMenuItemSatisfies([restriction]) === false);
  }
  // Fail-closed applies even to an item that DOES have other curated tags -
  // having some verified data doesn't make unrelated claims "probably fine".
  check(
    "classic-cheese has real tags but is still NOT tagged noEgg",
    itemSatisfies("classic-cheese-p38", ["noEgg"]) === false
  );
}

// --- No Pork + No Chicken: AND semantics, not split across two foods ---
{
  console.log("No Pork + No Chicken combined - one food must satisfy both, not two different foods");
  check(
    "classic-cheese alone satisfies noPork+noChicken together",
    itemSatisfies("classic-cheese-p38", ["noPork", "noChicken"]) === true
  );

  const input: BuildOrderInput = {
    attendees: 4,
    budget: 200,
    storeId: "10088",
    groups: [{ id: "g1", people: 2, restrictions: ["noPork", "noChicken"] }],
  };
  // A naive reading might think "pepperoni has no named chicken" + "chicken
  // pizza has no named pork" together cover both restrictions. They do not:
  // neither item is curated-safe for either restriction (no verified
  // ingredient breakdown), so neither contributes any coverage.
  const wrongPlan: PlanLine[] = [
    { itemId: "classic-pepperoni-p37", quantity: 2 },
    { itemId: "bbq-chicken-p35", quantity: 2 },
  ];
  const wrongResult = verifyPlan(wrongPlan, input);
  check("splitting the restriction across two different foods earns zero credit", wrongResult.groupCoverage[0].providedSlices === 0);
  check("the group is correctly NOT satisfied", wrongResult.groupCoverage[0].satisfied === false);

  const rightPlan: PlanLine[] = [
    { itemId: "classic-cheese-p38", quantity: 4 }, // 32 slices, satisfies both on its own
  ];
  const rightResult = verifyPlan(rightPlan, input);
  check("one item that genuinely satisfies both restrictions covers the group", rightResult.groupCoverage[0].satisfied === true);
}

// --- Gluten-Friendly + No Pork (+ No Chicken): the task's own example
// combination, using a real trusted item that carries all three tags. ---
{
  console.log("Gluten-Friendly + No Pork (+ No Chicken) combined restriction");
  check(
    "the Gluten Friendly Pizza satisfies Gluten-Friendly + No Pork + No Chicken together",
    itemSatisfies("gluten-friendly-pizza-p8", ["glutenFriendly", "noPork", "noChicken"]) === true
  );
  check(
    "classic-cheese (not gluten-friendly-tagged) does NOT satisfy that combination",
    itemSatisfies("classic-cheese-p38", ["glutenFriendly", "noPork", "noChicken"]) === false
  );

  const input: BuildOrderInput = {
    attendees: 10,
    budget: 200,
    storeId: "10088",
    groups: [{ id: "g1", people: 2, restrictions: ["glutenFriendly", "noPork", "noChicken"] }],
  };
  const plan: PlanLine[] = [
    { itemId: "gluten-friendly-pizza-p8", quantity: 1 }, // 6 slices - exactly required
    { itemId: "classic-pepperoni-p37", quantity: 4 }, // pads the rest of the order, not this group
  ];
  const result = verifyPlan(plan, input);
  check("group g1 is satisfied by the Gluten Friendly Pizza alone", result.groupCoverage[0].satisfied === true);
  check("coverage comes only from the GF pizza (6 slices), not the padding pepperoni", result.groupCoverage[0].providedSlices === 6);
  check("the overall order still verifies", result.verified === true);
}

// --- A multi-restriction combination that IS genuinely impossible on
// this menu (each restriction alone has coverage, but no single real
// item satisfies both together). ---
{
  console.log("Multi-restriction impossible case");
  check("vegetarian alone is possible", anyMenuItemSatisfies(["vegetarian"]) === true);
  check("no vegetarian item is also tagged noMustard", anyMenuItemSatisfies(["vegetarian", "noMustard"]) === false);

  const input: BuildOrderInput = {
    attendees: 6,
    budget: 300,
    storeId: "10088",
    groups: [{ id: "g1", people: 2, restrictions: ["vegetarian", "noMustard"] }],
  };
  const plan: PlanLine[] = [{ itemId: "classic-cheese-p38", quantity: 3 }];
  const result = verifyPlan(plan, input);
  check("g1 is flagged impossible, not partially matched", result.groupCoverage[0].impossible === true);
  check(
    "the failure is DIETARY_COVERAGE_IMPOSSIBLE",
    result.failures.some((f) => f.code === "DIETARY_COVERAGE_IMPOSSIBLE")
  );
}

// --- Arbitrary Notes text must never grant deterministic dietary
// verification - only the structured restrictions checkboxes count. ---
{
  console.log("Notes text cannot substitute for a structured restriction");
  const input: BuildOrderInput = {
    attendees: 6,
    budget: 200,
    storeId: "10088",
    groups: [{ id: "g1", people: 2, restrictions: [], notes: "no pork please, allergic" }],
  };
  // A real pepperoni (pork) pizza - if Notes text were treated as a
  // deterministic guarantee, this would have to fail. It must not: an
  // empty structured `restrictions` array means no dietary requirement
  // was actually declared, regardless of what the free-text note says.
  const plan: PlanLine[] = [{ itemId: "classic-pepperoni-p37", quantity: 3 }];
  const result = verifyPlan(plan, input);
  check(
    "a group with no structured restrictions is trivially satisfied regardless of Notes text",
    result.groupCoverage[0].satisfied === true
  );
  check(
    "itemSatisfies ignores notes entirely - only the restrictions array matters",
    itemSatisfies("classic-pepperoni-p37", []) === true
  );
}

// --- Budget shortfall vs dietary impossibility still correctly
// distinguished for the new restrictions. ---
{
  console.log("Budget shortfall vs dietary impossibility (new restrictions)");
  const satisfiableButExpensive = estimateMinimumWorkableBudget({
    attendees: 18,
    groups: [{ id: "g1", people: 2, restrictions: ["noPork"] }],
  });
  check("No Pork alone is satisfiable - a real minimum estimate exists", satisfiableButExpensive !== null);

  const impossible = estimateMinimumWorkableBudget({
    attendees: 18,
    groups: [{ id: "g1", people: 2, restrictions: ["noEgg"] }],
  });
  check("No Egg is dietary-impossible - no budget estimate exists at any price", impossible === null);
}

// --- Buffer add + Undo restores the exact original order, even when the
// baseline order includes a new-restriction dietary group. ---
{
  console.log("Buffer add + Undo with a new-restriction dietary group");
  const input: BuildOrderInput = {
    attendees: 12,
    budget: 150,
    storeId: "10088",
    groups: [{ id: "g1", people: 2, restrictions: ["noPork", "noChicken"] }],
  };
  const baseLines: PlanLine[] = [{ itemId: "classic-cheese-p38", quantity: 5 }]; // 40 slices, covers g1 and the total
  const before = verifyPlan(baseLines, input);
  check("baseline with the new restriction verifies", before.verified === true);

  const beforeSnapshot = JSON.stringify(before.totals);
  const { verification: withExtra } = addBufferItem(baseLines, "classic-cheese-p38", input);
  check("adding the buffer item still verifies", withExtra.verified === true);
  check("planned slices increased after adding", withExtra.totals.totalSlices > before.totals.totalSlices);

  // "Undo" = re-verify the untouched original lines, exactly like the UI does.
  const afterUndo = verifyPlan(baseLines, input);
  check("undo reproduces the exact original totals", JSON.stringify(afterUndo.totals) === beforeSnapshot);
  check("g1's dietary coverage is restored exactly too", afterUndo.groupCoverage[0].providedSlices === before.groupCoverage[0].providedSlices);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
