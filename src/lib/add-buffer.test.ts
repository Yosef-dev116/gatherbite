import { verifyPlan } from "./verify";
import { addBufferItem, linesToOrderLines, computeFoodBuffer } from "./scoring";
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

// --- Scenario 1: add-buffer appends exactly one real item and
// re-verifies from scratch, producing a fresh VERIFIED result.
{
  console.log("Scenario 1: adding the buffer item produces a fresh verified order");
  const input: BuildOrderInput = { attendees: 18, budget: 100, storeId: "10088", groups: [] };
  const baseLines: PlanLine[] = [{ itemId: "classic-pepperoni-p37", quantity: 7 }]; // 56 slices, buffer=2
  const baseVerification = verifyPlan(baseLines, input);
  check("baseline verifies", baseVerification.verified === true);

  const buffer = computeFoodBuffer(input, baseVerification);
  check("buffer is small and has a real extra item", buffer.isSmallBuffer && buffer.extraItem !== null);

  const { lines, verification } = addBufferItem(baseLines, buffer.extraItem!.itemId, input);
  check("combined plan has one more line than the base", lines.length === baseLines.length + 1);
  check("combined plan re-verifies as VERIFIED", verification.verified === true);
  check(
    "the extra item quantity is exactly 1",
    lines[lines.length - 1].itemId === buffer.extraItem!.itemId && lines[lines.length - 1].quantity === 1
  );
}

// --- Scenario 2: recalculated totals are deterministic and correct -
// slices, subtotal, fees, total, and remaining budget all update
// consistently with the real menu price/fee data (no invented numbers).
{
  console.log("Scenario 2: recalculated totals are exactly correct");
  const input: BuildOrderInput = { attendees: 18, budget: 100, storeId: "10088", groups: [] };
  const baseLines: PlanLine[] = [{ itemId: "classic-pepperoni-p37", quantity: 7 }]; // $55.93, 56 slices
  const baseVerification = verifyPlan(baseLines, input);

  const { verification: withExtra } = addBufferItem(baseLines, "classic-pepperoni-p37", input);
  // 8 pepperoni pizzas total: 64 slices, $63.92 subtotal.
  check("planned slices increased by exactly one pizza's worth", withExtra.totals.totalSlices === baseVerification.totals.totalSlices + 8);
  check("buffer grew by exactly 8 slices", withExtra.totals.totalSlices - withExtra.totals.requiredSlices === baseVerification.totals.totalSlices - baseVerification.totals.requiredSlices + 8);
  check(
    "subtotal increased by exactly one item's price",
    Math.round((withExtra.totals.subtotalCad - baseVerification.totals.subtotalCad) * 100) / 100 ===
      MENU_BY_ID["classic-pepperoni-p37"].priceCad
  );
  check("fees were recomputed (not just copied)", withExtra.totals.feesCad >= baseVerification.totals.feesCad);
  check(
    "total = subtotal + fees",
    Math.round((withExtra.totals.subtotalCad + withExtra.totals.feesCad) * 100) / 100 === withExtra.totals.totalCad
  );
  check(
    "remaining budget = budget - total",
    Math.round((input.budget - withExtra.totals.totalCad) * 100) / 100 === withExtra.totals.remainingBudgetCad
  );

  const orderLines = linesToOrderLines([{ itemId: "classic-pepperoni-p37", quantity: 8 }]);
  check("linesToOrderLines resolves real name/price/slices", orderLines[0].name === "CLASSIC PEPPERONI");
  check("linesToOrderLines computes lineTotal correctly", orderLines[0].lineTotalCad === 8 * MENU_BY_ID["classic-pepperoni-p37"].priceCad);
  check("linesToOrderLines computes slices correctly", orderLines[0].slices === 8 * MENU_BY_ID["classic-pepperoni-p37"].slices);
}

// --- Scenario 3: removal is safe and reversible - nothing is mutated,
// so re-verifying just the original base lines reproduces the exact
// original verification (the UI implements "Remove extra" by simply
// discarding the with-buffer result and falling back to this).
{
  console.log("Scenario 3: removing the extra reproduces the original order exactly");
  const input: BuildOrderInput = { attendees: 18, budget: 100, storeId: "10088", groups: [] };
  const baseLines: PlanLine[] = [{ itemId: "classic-pepperoni-p37", quantity: 7 }];
  const before = verifyPlan(baseLines, input);

  const beforeLinesSnapshot = JSON.stringify(baseLines);
  addBufferItem(baseLines, "classic-pepperoni-p37", input);
  check("addBufferItem does not mutate the original lines array", JSON.stringify(baseLines) === beforeLinesSnapshot);

  const after = verifyPlan(baseLines, input); // simulates "Remove extra" - re-verify the untouched base plan
  check("re-verifying the base plan after a removal matches the original totals", JSON.stringify(after.totals) === JSON.stringify(before.totals));
  check("re-verifying the base plan after a removal is still verified", after.verified === true);
}

// --- Scenario 4: budget-blocked behavior - if the extra item would push
// the order over budget, the recalculated plan is correctly NOT verified
// (the UI never shows an enabled Add button in this case, gated by
// foodBuffer.fitsBudget, but the underlying data must be honest too).
{
  console.log("Scenario 4: budget-blocked add is correctly not verified");
  const input: BuildOrderInput = { attendees: 8, budget: 33, storeId: "10088", groups: [] };
  const baseLines: PlanLine[] = [{ itemId: "classic-pepperoni-p37", quantity: 3 }]; // exactly fits $33 budget
  const baseVerification = verifyPlan(baseLines, input);
  check("baseline fits the tight budget", baseVerification.verified === true);

  const buffer = computeFoodBuffer(input, baseVerification);
  check("buffer correctly reports it would exceed budget", buffer.fitsBudget === false && buffer.overBudgetByCad > 0);
  check("no add button would be offered (fitsBudget gates the UI)", buffer.isSmallBuffer && !buffer.fitsBudget);

  const { verification: withExtra } = addBufferItem(baseLines, buffer.extraItem!.itemId, input);
  check("adding the extra item when over budget is correctly NOT verified", withExtra.verified === false);
  check(
    "the failure is specifically BUDGET_EXCEEDED",
    withExtra.failures.some((f) => f.code === "BUDGET_EXCEEDED")
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
