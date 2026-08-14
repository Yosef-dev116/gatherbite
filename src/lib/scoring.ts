import { MENU_BY_ID, MENU_ITEMS, FEE_STRUCTURE, itemSatisfies } from "./menu";
import { round2, verifyPlan } from "./verify";
import type { BuildOrderInput, FoodBuffer, MenuItem, OrderLine, PlanLine, VerifyResult } from "./types";

const SLICES_PER_PERSON = 3;

/* ---------------------------------------------------------------------
 * Part 1: deterministic best-plan scoring.
 *
 * This never decides whether a plan is valid — verifyPlan's hard gates
 * are untouched and remain the only authority on that. This only ranks
 * plans that have ALREADY passed every hard gate, so the agent can
 * compare a small, bounded number of valid candidates and hand back the
 * best one instead of just "whichever passed first."
 *
 * Priority order: 1) lower total cost, 2) fewer excess slices beyond the
 * required minimum, 3) a small preference for a plan that used a real
 * bundle/deal item, applied only when cost and waste are tied.
 * ------------------------------------------------------------------- */

export interface VerifiedCandidate {
  lines: PlanLine[];
  verification: VerifyResult;
}

interface ScoredCandidate {
  candidate: VerifiedCandidate;
  totalCad: number;
  excessSlices: number;
  hasBundle: boolean;
}

function compareScored(a: ScoredCandidate, b: ScoredCandidate): number {
  const costDiff = a.totalCad - b.totalCad;
  if (Math.abs(costDiff) >= 0.005) return costDiff; // lower cost wins

  const wasteDiff = a.excessSlices - b.excessSlices;
  if (wasteDiff !== 0) return wasteDiff; // fewer excess slices wins

  if (a.hasBundle !== b.hasBundle) return a.hasBundle ? -1 : 1; // small bundle-value bonus
  return 0;
}

/** Picks the best of a small set of already-verified candidates. Returns
 * null if none of the candidates were actually verified — scoring never
 * rescues an invalid plan. */
export function pickBestVerifiedPlan(candidates: VerifiedCandidate[]): VerifiedCandidate | null {
  const scored: ScoredCandidate[] = candidates
    .filter((c) => c.verification.verified)
    .map((c) => ({
      candidate: c,
      totalCad: c.verification.totals.totalCad,
      excessSlices: Math.max(0, c.verification.totals.totalSlices - c.verification.totals.requiredSlices),
      hasBundle: c.verification.bundlesUsed.length > 0,
    }));

  if (scored.length === 0) return null;
  scored.sort(compareScored);
  return scored[0].candidate;
}

/* ---------------------------------------------------------------------
 * Part 2: budget-shortfall estimation.
 *
 * A simple greedy fill (no external optimization library): for each
 * dietary group, use enough of the cheapest-per-slice curated-safe item
 * to cover it; fill any remaining slices with the cheapest-per-slice
 * item on the whole menu. This is a deterministic, real-menu-only
 * estimate of the cheapest possible order, used only to tell the user
 * whether more budget would actually fix things.
 * ------------------------------------------------------------------- */

export interface MinimumBudgetEstimate {
  totalCad: number;
  lines: PlanLine[];
}

function cheapestPerSlice(pool: MenuItem[]): MenuItem {
  return pool.reduce((best, item) => (item.priceCad / item.slices < best.priceCad / best.slices ? item : best));
}

/**
 * Returns the cheapest deterministic estimate of a dietary-safe,
 * slice-sufficient order, or null if some dietary group can never be
 * satisfied by any real item on this menu at any price (a
 * dietary-impossible case — budget can't fix that, so callers must not
 * suggest raising it).
 */
export function estimateMinimumWorkableBudget(
  input: Pick<BuildOrderInput, "attendees" | "groups">
): MinimumBudgetEstimate | null {
  const requiredSlices = input.attendees * SLICES_PER_PERSON;
  const quantities = new Map<string, number>();
  let slicesSoFar = 0;

  function addSlices(itemId: string, neededSlices: number) {
    if (neededSlices <= 0) return;
    const item = MENU_BY_ID[itemId];
    const quantity = Math.ceil(neededSlices / item.slices);
    quantities.set(itemId, (quantities.get(itemId) ?? 0) + quantity);
    slicesSoFar += quantity * item.slices;
  }

  for (const group of input.groups) {
    if (group.restrictions.length === 0) continue;
    const candidates = MENU_ITEMS.filter((item) => itemSatisfies(item.id, group.restrictions));
    if (candidates.length === 0) return null;
    addSlices(cheapestPerSlice(candidates).id, group.people * SLICES_PER_PERSON);
  }

  const remaining = Math.max(0, requiredSlices - slicesSoFar);
  if (remaining > 0) {
    addSlices(cheapestPerSlice(MENU_ITEMS).id, remaining);
  }

  const lines: PlanLine[] = Array.from(quantities.entries()).map(([itemId, quantity]) => ({
    itemId,
    quantity,
  }));

  const subtotalCad = lines.reduce((sum, l) => sum + MENU_BY_ID[l.itemId].priceCad * l.quantity, 0);
  const serviceFee = subtotalCad * (FEE_STRUCTURE.service_fee_percent / 100);
  const smallOrderFee =
    subtotalCad > 0 && subtotalCad < FEE_STRUCTURE.small_order_threshold_cad ? FEE_STRUCTURE.small_order_fee_cad : 0;
  const feesCad = round2(FEE_STRUCTURE.delivery_fee_cad + serviceFee + smallOrderFee);
  const totalCad = round2(subtotalCad + feesCad);

  return { totalCad, lines };
}

/* ---------------------------------------------------------------------
 * Part 3: post-verification food buffer.
 *
 * Purely informational — computed from an ALREADY-VERIFIED order and
 * never fed back into it, so it can never change that order's VERIFIED
 * status. Only ever proposes a real, whole menu item (no invented
 * individual-slice purchase); the cheapest-per-slice pick already
 * naturally prefers whole pizzas over the menu's few small items,
 * since those cost far more per slice on this real menu.
 * ------------------------------------------------------------------- */

/** Below this many spare slices, the buffer is considered thin enough to
 * flag - i.e. less than one more whole pizza's worth of slack. */
const SMALL_BUFFER_THRESHOLD_SLICES = 8;

/**
 * Computes an optional post-verification safety buffer for an already
 * verified order. Read-only: takes the verified totals as input and
 * never mutates or re-verifies the order itself.
 */
export function computeFoodBuffer(
  input: Pick<BuildOrderInput, "attendees" | "groups" | "budget">,
  verification: VerifyResult
): FoodBuffer {
  const bufferSlices = verification.totals.totalSlices - verification.totals.requiredSlices;
  const isSmallBuffer = bufferSlices < SMALL_BUFFER_THRESHOLD_SLICES;

  const empty: FoodBuffer = {
    bufferSlices,
    isSmallBuffer,
    extraItem: null,
    additionalCostCad: 0,
    newRemainingBudgetCad: verification.totals.remainingBudgetCad,
    fitsBudget: true,
    overBudgetByCad: 0,
  };
  if (!isSmallBuffer) return empty;

  // Respect existing dietary requirements where relevant: if everyone
  // present belongs to a dietary group (no unrestricted attendees), a
  // generic pizza would be a useless buffer, so pick one that's actually
  // safe for at least one of the groups present instead.
  const groupPeopleSum = input.groups.reduce((sum, g) => sum + g.people, 0);
  const hasUnrestrictedAttendees = input.attendees - groupPeopleSum > 0;
  const pool = hasUnrestrictedAttendees
    ? MENU_ITEMS
    : MENU_ITEMS.filter((item) => input.groups.some((g) => itemSatisfies(item.id, g.restrictions)));

  if (pool.length === 0) return empty; // defensive: no eligible real item to suggest

  const extra = cheapestPerSlice(pool);
  const newSubtotal = verification.totals.subtotalCad + extra.priceCad;
  const newServiceFee = newSubtotal * (FEE_STRUCTURE.service_fee_percent / 100);
  const newSmallOrderFee =
    newSubtotal > 0 && newSubtotal < FEE_STRUCTURE.small_order_threshold_cad ? FEE_STRUCTURE.small_order_fee_cad : 0;
  const newFeesCad = round2(FEE_STRUCTURE.delivery_fee_cad + newServiceFee + newSmallOrderFee);
  const newTotalCad = round2(newSubtotal + newFeesCad);

  const fitsBudget = newTotalCad <= input.budget;
  // additionalCostCad and newRemainingBudgetCad only carry a real value
  // when the extra item actually fits - the buffer is never silently
  // "applied" (in the data, not just the UI) when it would go over budget.
  const additionalCostCad = fitsBudget ? round2(newTotalCad - verification.totals.totalCad) : 0;
  const overBudgetByCad = fitsBudget ? 0 : round2(newTotalCad - input.budget);
  const newRemainingBudgetCad = fitsBudget
    ? round2(input.budget - newTotalCad)
    : verification.totals.remainingBudgetCad;

  return {
    bufferSlices,
    isSmallBuffer,
    extraItem: { itemId: extra.id, name: extra.name, slices: extra.slices },
    additionalCostCad,
    newRemainingBudgetCad,
    fitsBudget,
    overBudgetByCad,
  };
}

/* ---------------------------------------------------------------------
 * Part 4: applying the optional buffer item.
 *
 * Turns the buffer suggestion into a real, deterministic recalculation
 * of the displayed order — one more real menu item appended to the
 * existing plan, re-verified from scratch with the exact same
 * verifyPlan used everywhere else. Nothing here touches the agent, the
 * scoring priorities, or the 3-slices/person baseline; it only ever
 * runs after a plan is already verified, and it can be reversed by
 * simply not applying it (nothing is mutated in place).
 * ------------------------------------------------------------------- */

/** Converts plan lines into the display-ready OrderLine shape used by
 * the result UI (same mapping the agent uses for its own final order). */
export function linesToOrderLines(lines: PlanLine[]): OrderLine[] {
  return lines.map((line) => {
    const item = MENU_BY_ID[line.itemId];
    return {
      itemId: line.itemId,
      name: item?.name ?? line.itemId,
      quantity: line.quantity,
      unitPriceCad: item?.priceCad ?? 0,
      lineTotalCad: (item?.priceCad ?? 0) * line.quantity,
      slices: (item?.slices ?? 0) * line.quantity,
    };
  });
}

/**
 * Appends exactly one unit of a real trusted menu item to an existing
 * plan and re-verifies the combined plan from scratch. Returns both the
 * fresh VerifyResult and the new plan lines so the caller can render an
 * up-to-date order; never mutates the original lines array.
 */
export function addBufferItem(
  baseLines: PlanLine[],
  extraItemId: string,
  input: BuildOrderInput
): { lines: PlanLine[]; verification: VerifyResult } {
  const lines: PlanLine[] = [...baseLines, { itemId: extraItemId, quantity: 1 }];
  return { lines, verification: verifyPlan(lines, input) };
}
