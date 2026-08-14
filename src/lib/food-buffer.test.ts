import { verifyPlan } from "./verify";
import { computeFoodBuffer } from "./scoring";
import { MENU_BY_ID } from "./menu";
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

// --- Scenario 1: small buffer -> recommendation shown, and (with a
// generous budget) the suggested extra pizza fits within it.
{
  console.log("Scenario 1: small buffer shows a recommendation that fits the budget");
  const input: BuildOrderInput = { attendees: 18, budget: 100, storeId: "10088", groups: [] };
  const plan: PlanLine[] = [{ itemId: "classic-pepperoni-p37", quantity: 7 }]; // 56 slices, 54 required
  const verification = verifyPlan(plan, input);
  check("baseline order verifies", verification.verified === true);
  check("buffer is exactly 2 slices", verification.totals.totalSlices - verification.totals.requiredSlices === 2);

  const buffer = computeFoodBuffer(input, verification);
  check("bufferSlices matches", buffer.bufferSlices === 2);
  check("a 2-slice buffer is flagged as small", buffer.isSmallBuffer === true);
  check("a real extra item is suggested", buffer.extraItem !== null);
  check("suggested extra item fits the generous budget", buffer.fitsBudget === true);
  check("no over-budget amount when it fits", buffer.overBudgetByCad === 0);
  check("additional cost is a positive real number", buffer.additionalCostCad > 0);
  check(
    "new remaining budget is internally consistent",
    buffer.newRemainingBudgetCad ===
      Math.round((input.budget - (verification.totals.totalCad + buffer.additionalCostCad)) * 100) / 100
  );
  console.log(`  extraItem: ${JSON.stringify(buffer.extraItem)}, +$${buffer.additionalCostCad}`);
}

// --- Scenario 2: healthy buffer (>= 8, one whole extra pizza's worth of
// slack already) -> no unnecessary recommendation.
{
  console.log("Scenario 2: healthy buffer shows no recommendation");
  const input: BuildOrderInput = { attendees: 8, budget: 100, storeId: "10088", groups: [] };
  const plan: PlanLine[] = [{ itemId: "classic-pepperoni-p37", quantity: 4 }]; // 32 slices, 24 required
  const verification = verifyPlan(plan, input);
  check("baseline order verifies", verification.verified === true);
  check("buffer is exactly 8 slices", verification.totals.totalSlices - verification.totals.requiredSlices === 8);

  const buffer = computeFoodBuffer(input, verification);
  check("an 8-slice buffer is NOT flagged as small (boundary)", buffer.isSmallBuffer === false);
  check("no extra item is suggested for a healthy buffer", buffer.extraItem === null);
  check("no additional cost for a healthy buffer", buffer.additionalCostCad === 0);
}

// --- Scenario 3: extra pizza would exceed the budget -> not silently
// added, exact overage amount reported instead.
{
  console.log("Scenario 3: extra pizza exceeds budget");
  const input: BuildOrderInput = { attendees: 8, budget: 33, storeId: "10088", groups: [] };
  const plan: PlanLine[] = [{ itemId: "classic-pepperoni-p37", quantity: 3 }]; // exactly 24 slices, 0 buffer
  const verification = verifyPlan(plan, input);
  check("baseline order verifies within the tight budget", verification.verified === true);
  check("baseline buffer is exactly 0 slices", verification.totals.totalSlices === verification.totals.requiredSlices);

  const buffer = computeFoodBuffer(input, verification);
  check("0 slices is flagged as a small buffer", buffer.isSmallBuffer === true);
  check("a real extra item is still identified", buffer.extraItem !== null);
  check("the extra item does NOT fit the tight budget", buffer.fitsBudget === false);
  check("a positive over-budget amount is reported", buffer.overBudgetByCad > 0);
  check("no additional cost is silently applied when over budget", buffer.additionalCostCad === 0);
  console.log(`  over budget by $${buffer.overBudgetByCad}`);
}

// --- Scenario 4: never an invented individual-slice purchase - any
// suggested extra item must be a real, whole item from the trusted menu.
{
  console.log("Scenario 4: no invented individual-slice purchase");
  const input: BuildOrderInput = { attendees: 18, budget: 100, storeId: "10088", groups: [] };
  const plan: PlanLine[] = [{ itemId: "classic-pepperoni-p37", quantity: 7 }];
  const verification = verifyPlan(plan, input);
  const buffer = computeFoodBuffer(input, verification);

  check("extra item exists for this small-buffer case", buffer.extraItem !== null);
  if (buffer.extraItem) {
    const realItem = MENU_BY_ID[buffer.extraItem.itemId];
    check("extra item id resolves to a real trusted menu entry", realItem !== undefined);
    check("extra item name matches the real menu entry exactly", realItem?.name === buffer.extraItem.name);
    check(
      "extra item slice count matches the real menu entry exactly (a whole pizza, not a partial slice)",
      realItem?.slices === buffer.extraItem.slices
    );
    check("suggested quantity is always exactly 1 whole item, never a fraction", Number.isInteger(buffer.extraItem.slices));
  }
}

// --- Scenario 5: never changes the baseline order's VERIFIED status.
{
  console.log("Scenario 5: buffer computation never mutates the verified baseline");
  const input: BuildOrderInput = { attendees: 18, budget: 100, storeId: "10088", groups: [] };
  const plan: PlanLine[] = [{ itemId: "classic-pepperoni-p37", quantity: 7 }];
  const verification = verifyPlan(plan, input);
  const totalsBefore = JSON.stringify(verification.totals);
  computeFoodBuffer(input, verification);
  check("verification totals are unchanged after computing a buffer", JSON.stringify(verification.totals) === totalsBefore);
  check("verification.verified is still true", verification.verified === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
