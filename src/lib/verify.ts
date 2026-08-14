import { MENU_BY_ID, FEE_STRUCTURE, itemSatisfies, anyMenuItemSatisfies } from "./menu";
import type {
  BuildOrderInput,
  PlanLine,
  VerifyResult,
  VerifyFailure,
  GroupCoverage,
} from "./types";

const SLICES_PER_PERSON = 3;

/**
 * Deterministic verification. No LLM judgment is involved anywhere in
 * this function — every check is plain TypeScript arithmetic and lookups
 * against the trusted menu + curated dietary dataset.
 */
export function verifyPlan(plan: PlanLine[], input: BuildOrderInput): VerifyResult {
  const failures: VerifyFailure[] = [];

  // Check 5: every referenced item must exist in the trusted menu data.
  for (const line of plan) {
    if (!MENU_BY_ID[line.itemId]) {
      failures.push({
        code: "INVALID_ITEM_REFERENCE",
        message: `INVALID_ITEM_REFERENCE: "${line.itemId}" does not exist in the store 10088 menu.`,
      });
    }
  }
  if (failures.length > 0) {
    return {
      verified: false,
      failures,
      totals: {
        totalSlices: 0,
        requiredSlices: input.attendees * SLICES_PER_PERSON,
        subtotalCad: 0,
        feesCad: 0,
        totalCad: 0,
        budgetCad: input.budget,
        remainingBudgetCad: input.budget,
      },
      groupCoverage: [],
      bundlesUsed: [],
    };
  }

  const resolvedLines = plan
    .filter((line) => line.quantity > 0)
    .map((line) => ({ line, item: MENU_BY_ID[line.itemId] }));

  // Check 1: total slices.
  const totalSlices = resolvedLines.reduce(
    (sum, { line, item }) => sum + item.slices * line.quantity,
    0
  );
  const requiredSlices = input.attendees * SLICES_PER_PERSON;
  if (totalSlices < requiredSlices) {
    failures.push({
      code: "INSUFFICIENT_TOTAL_SLICES",
      message: `INSUFFICIENT_TOTAL_SLICES: plan provides ${totalSlices} slices; ${input.attendees} attendees need ${requiredSlices}.`,
    });
  }

  // Check 2 & 4: per-group dietary coverage, using only the curated trusted tags.
  const groupCoverage: GroupCoverage[] = input.groups.map((group) => {
    const requiredGroupSlices = group.people * SLICES_PER_PERSON;
    const providedSlices = resolvedLines
      .filter(({ item }) => itemSatisfies(item.id, group.restrictions))
      .reduce((sum, { line, item }) => sum + item.slices * line.quantity, 0);
    const impossible = !anyMenuItemSatisfies(group.restrictions);
    const satisfied = providedSlices >= requiredGroupSlices;

    if (!satisfied) {
      failures.push({
        code: impossible ? "DIETARY_COVERAGE_IMPOSSIBLE" : "DIETARY_COVERAGE_FAILED",
        groupId: group.id,
        message: impossible
          ? `DIETARY_COVERAGE_IMPOSSIBLE: no item at store ${input.storeId} is verified-safe for [${group.restrictions.join(
              ", "
            )}]. ${group.people} attendee(s) cannot be covered by this menu.`
          : `DIETARY_COVERAGE_FAILED: ${group.people} ${group.restrictions.join(
              "+"
            )} attendee(s) require ${requiredGroupSlices} suitable slices; plan provides ${providedSlices} verified suitable slices.`,
      });
    }

    return {
      groupId: group.id,
      restrictions: group.restrictions,
      peopleCount: group.people,
      requiredSlices: requiredGroupSlices,
      providedSlices,
      satisfied,
      impossible,
    };
  });

  // Check 3: budget, using the trusted fee structure from the snapshot.
  const subtotalCad = resolvedLines.reduce(
    (sum, { line, item }) => sum + item.priceCad * line.quantity,
    0
  );
  const serviceFee = subtotalCad * (FEE_STRUCTURE.service_fee_percent / 100);
  const smallOrderFee =
    subtotalCad > 0 && subtotalCad < FEE_STRUCTURE.small_order_threshold_cad
      ? FEE_STRUCTURE.small_order_fee_cad
      : 0;
  const feesCad = round2(FEE_STRUCTURE.delivery_fee_cad + serviceFee + smallOrderFee);
  const totalCad = round2(subtotalCad + feesCad);

  if (totalCad > input.budget) {
    failures.push({
      code: "BUDGET_EXCEEDED",
      message: `BUDGET_EXCEEDED: plan totals $${totalCad.toFixed(2)}, exceeding the $${input.budget.toFixed(
        2
      )} budget by $${(totalCad - input.budget).toFixed(2)}.`,
    });
  }

  const bundlesUsed = resolvedLines.filter(({ item }) => item.isBundle).map(({ item }) => item.name);

  return {
    verified: failures.length === 0,
    failures,
    totals: {
      totalSlices,
      requiredSlices,
      subtotalCad: round2(subtotalCad),
      feesCad,
      totalCad,
      budgetCad: input.budget,
      remainingBudgetCad: round2(input.budget - totalCad),
    },
    groupCoverage,
    bundlesUsed,
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
