/**
 * Pure, deterministic comparison logic for Domino's store snapshots.
 * Takes already-fetched snapshots in — no network calls here, so this is
 * trivially unit-testable with fixture data.
 *
 * PIZZA ONLY (current hackathon scope): only deals with a trusted,
 * real, single-pizza slice count (DominosDeal.slices) can ever count
 * toward feeding a group. Drinks, dips, desserts, sides, chicken,
 * pasta, sandwiches, and ambiguous multi-pizza bundles never
 * independently satisfy `requiredSlices = people * 3` — they're simply
 * excluded from capacity consideration, not treated as unsafe. This is
 * deliberately narrower than a full "what can this store actually feed
 * this group" answer; later modes (Pizza + Sides, Full Meal) can widen
 * the capacity pool without changing this function's shape — the pool
 * a store can draw feeding-capacity from is intentionally the only
 * thing that would need to change.
 */

import { round2 } from "../verify";
import { evaluateDominosDeal } from "./dominosDietary";
import type { DominosDeal, DominosStoreSnapshot, WaitMinutes } from "./dominos";
import type { Restriction } from "../types";

const SLICES_PER_PERSON = 3;

export type ServiceMethodPreference = "delivery" | "carryout" | "either";

export interface DominosComparisonRequirements {
  people: number;
  budget: number;
  servicePreference?: ServiceMethodPreference;
  /** Legacy coarse flag: true if dietary groups exist but the specific
   * restrictions aren't known to the caller. Still yields the blanket
   * INSUFFICIENT_DIETARY_DATA, since there's nothing to verify against.
   * Superseded by `dietaryRestrictions` below when the caller has them. */
  hasDietaryGroups?: boolean;
  /** Specific structured restrictions to verify, if known. When
   * non-empty, real bounded verification is attempted via
   * dominosDietary.ts (curated from Domino's own Canadian Nutrition
   * Guide) instead of the blanket unknown response. Restrictions this
   * module has no curated data for still correctly come back
   * INSUFFICIENT_DIETARY_DATA rather than a guess. */
  dietaryRestrictions?: Restriction[];
}

export type DominosClassification =
  | "FULLY_VIABLE"
  | "VIABLE_BUT_OVER_BUDGET"
  | "CLOSED_OR_UNAVAILABLE"
  | "INSUFFICIENT_DIETARY_DATA"
  | "INSUFFICIENT_UNKNOWN_DATA";

export interface DominosDealUsed {
  code: string;
  name: string;
  /** Price of ONE unit of this deal. */
  price: number;
  quantity: number;
  totalSlices: number;
}

export interface DominosComparisonResult {
  storeId: string;
  classification: DominosClassification;
  reason: string | null;
  /** Total estimated cost for enough of dealUsed to meet requiredSlices. */
  estimatedTotalCad: number | null;
  dealUsed: DominosDealUsed | null;
  waitMinutes: WaitMinutes | null;
}

interface PizzaPlan {
  deal: DominosDeal & { price: number; slices: number };
  quantity: number;
  totalCad: number;
  totalSlices: number;
}

/** Among deals with a trusted single-pizza slice count, finds the
 * cheapest way to reach requiredSlices by repeating one deal — the same
 * "no external optimizer, just cheapest-per-unit" spirit as the Little
 * Caesars budget estimator. Deals without a known slice count (drinks,
 * dips, sides, ambiguous bundles, etc.) are never considered. */
function findCheapestSufficientPizzaPlan(
  deals: DominosDeal[],
  requiredSlices: number,
  servicePreference: ServiceMethodPreference | undefined
): PizzaPlan | null {
  const pizzaDeals = deals.filter(
    (d): d is DominosDeal & { price: number; slices: number } => d.price !== null && d.slices !== null && d.slices > 0
  );
  const applicable =
    !servicePreference || servicePreference === "either"
      ? pizzaDeals
      : pizzaDeals.filter((d) => d.conditions?.toLowerCase().includes(servicePreference));

  if (applicable.length === 0) return null;

  let best: PizzaPlan | null = null;
  for (const deal of applicable) {
    const quantity = Math.max(1, Math.ceil(requiredSlices / deal.slices));
    const totalCad = round2(quantity * deal.price);
    const totalSlices = quantity * deal.slices;
    if (!best || totalCad < best.totalCad) {
      best = { deal, quantity, totalCad, totalSlices };
    }
  }
  return best;
}

function relevantWait(snapshot: DominosStoreSnapshot, servicePreference: ServiceMethodPreference | undefined): WaitMinutes | null {
  if (servicePreference === "carryout") return snapshot.carryoutWaitMinutes;
  return snapshot.deliveryWaitMinutes; // default/display convention for "delivery" and "either"
}

/** Classifies a single store. Exported alongside the batch version below
 * since callers sometimes have exactly one snapshot to check. */
export function classifyDominosStore(
  snapshot: DominosStoreSnapshot,
  requirements: DominosComparisonRequirements
): DominosComparisonResult {
  const waitMinutes = relevantWait(snapshot, requirements.servicePreference);

  if (snapshot.status === "failed") {
    return {
      storeId: snapshot.storeId,
      classification: "INSUFFICIENT_UNKNOWN_DATA",
      reason: snapshot.errors.join("; ") || "Live store data could not be fetched.",
      estimatedTotalCad: null,
      dealUsed: null,
      waitMinutes,
    };
  }

  // Unknown (null) open/online status — e.g. the profile endpoint failed
  // while the menu endpoint succeeded (status "partial") — must not be
  // silently treated as "assume open." Viability is explicitly one of
  // the few fields this comparison is allowed to use, so if we can't
  // confirm it, the result is unknown, not a price-based guess.
  if (snapshot.isOpen === null || snapshot.isOnlineNow === null) {
    return {
      storeId: snapshot.storeId,
      classification: "INSUFFICIENT_UNKNOWN_DATA",
      reason: snapshot.errors.join("; ") || "Store open/online status could not be confirmed from live data.",
      estimatedTotalCad: null,
      dealUsed: null,
      waitMinutes,
    };
  }

  if (snapshot.isOpen === false || snapshot.isOnlineNow === false) {
    return {
      storeId: snapshot.storeId,
      classification: "CLOSED_OR_UNAVAILABLE",
      reason: "Store is not currently open/online per its own live status.",
      estimatedTotalCad: null,
      dealUsed: null,
      waitMinutes,
    };
  }

  const wantsDelivery = requirements.servicePreference === "delivery";
  const wantsCarryout = requirements.servicePreference === "carryout";
  if (wantsDelivery && snapshot.deliveryAvailable === false) {
    return {
      storeId: snapshot.storeId,
      classification: "CLOSED_OR_UNAVAILABLE",
      reason: "Store does not currently offer delivery.",
      estimatedTotalCad: null,
      dealUsed: null,
      waitMinutes,
    };
  }
  if (wantsCarryout && snapshot.carryoutAvailable === false) {
    return {
      storeId: snapshot.storeId,
      classification: "CLOSED_OR_UNAVAILABLE",
      reason: "Store does not currently offer carryout.",
      estimatedTotalCad: null,
      dealUsed: null,
      waitMinutes,
    };
  }

  const dietaryRestrictions = requirements.dietaryRestrictions ?? [];

  if (dietaryRestrictions.length === 0 && requirements.hasDietaryGroups) {
    // Legacy path: dietary groups exist but we weren't told which
    // restrictions - nothing to verify against, so still unknown.
    return {
      storeId: snapshot.storeId,
      classification: "INSUFFICIENT_DIETARY_DATA",
      reason: "Domino's has no curated dietary-restriction data yet — compatibility is unknown, not confirmed or denied.",
      estimatedTotalCad: null,
      dealUsed: null,
      waitMinutes,
    };
  }

  const requiredSlices = requirements.people * SLICES_PER_PERSON;

  // Dietary verification narrows the candidate pool BEFORE capacity/
  // budget are checked - dietary success alone can never make an
  // otherwise-invalid order viable, because the exact same capacity and
  // budget logic below still has to pass on whatever survives the filter.
  const dealsToConsider =
    dietaryRestrictions.length > 0
      ? snapshot.deals.filter((deal) => evaluateDominosDeal(deal.name, dietaryRestrictions).satisfiesAll)
      : snapshot.deals;

  const plan = findCheapestSufficientPizzaPlan(dealsToConsider, requiredSlices, requirements.servicePreference);
  if (!plan) {
    if (dietaryRestrictions.length > 0) {
      return {
        storeId: snapshot.storeId,
        classification: "INSUFFICIENT_DIETARY_DATA",
        reason:
          "No live pizza deal could be verified against the curated Domino's dietary data for the requested restriction(s) and slice capacity together — evidence is incomplete, so this is not assumed viable.",
        estimatedTotalCad: null,
        dealUsed: null,
        waitMinutes,
      };
    }
    return {
      storeId: snapshot.storeId,
      classification: "INSUFFICIENT_UNKNOWN_DATA",
      reason:
        "No live pizza deal with a trusted, known slice count was found for the requested service method — feeding capacity for this group is unknown, not assumed (Pizza Only: drinks, dips, sides, and ambiguous multi-pizza bundles don't count).",
      estimatedTotalCad: null,
      dealUsed: null,
      waitMinutes,
    };
  }

  const withinBudget = plan.totalCad <= requirements.budget;
  return {
    storeId: snapshot.storeId,
    classification: withinBudget ? "FULLY_VIABLE" : "VIABLE_BUT_OVER_BUDGET",
    reason: withinBudget
      ? null
      : `Cheapest sufficient pizza order (${plan.quantity} × ${plan.deal.name} = $${plan.totalCad.toFixed(2)}) exceeds the $${requirements.budget.toFixed(2)} budget.`,
    estimatedTotalCad: plan.totalCad,
    dealUsed: { code: plan.deal.code, name: plan.deal.name, price: plan.deal.price, quantity: plan.quantity, totalSlices: plan.totalSlices },
    waitMinutes,
  };
}

/**
 * Classifies every given snapshot and returns ALL of them — this never
 * picks a single "winner"; a cheaper/faster store must never outrank one
 * that can't actually satisfy the request.
 */
export function compareDominosStores(
  snapshots: DominosStoreSnapshot[],
  requirements: DominosComparisonRequirements
): DominosComparisonResult[] {
  return snapshots.map((snapshot) => classifyDominosStore(snapshot, requirements));
}

/**
 * Describes the real tradeoff (if any) between the FULLY_VIABLE stores in
 * a comparison result set. Never forces a single winner: if the cheaper
 * store is also not slower, there's no genuine tradeoff to present, and
 * if fewer than two stores are fully viable there's nothing to compare.
 * When prices are equal, never renders a "Save $0.00" line — that's not
 * a real saving, so it's represented as its own distinct case.
 */
export type DominosTradeoff =
  | { kind: "real-tradeoff"; cheaperStoreId: string; fasterStoreId: string; savingsCad: number; savingsMinutes: number }
  | { kind: "same-price-faster"; fasterStoreId: string; slowerStoreId: string; savingsMinutes: number }
  | { kind: "no-tradeoff"; winnerStoreId: string }
  | { kind: "not-applicable" };

export function describeDominosTradeoff(results: DominosComparisonResult[]): DominosTradeoff {
  const viable = results.filter(
    (r): r is DominosComparisonResult & { estimatedTotalCad: number } =>
      r.classification === "FULLY_VIABLE" && r.estimatedTotalCad !== null
  );
  if (viable.length < 2) return { kind: "not-applicable" };

  const [cheaper, other] = [...viable].sort((a, b) => a.estimatedTotalCad - b.estimatedTotalCad);
  const priceDiff = round2(other.estimatedTotalCad - cheaper.estimatedTotalCad);
  const cheaperWaitMax = cheaper.waitMinutes?.max;
  const otherWaitMax = other.waitMinutes?.max;
  const knownWaits = cheaperWaitMax != null && otherWaitMax != null;

  if (priceDiff === 0) {
    if (knownWaits && cheaperWaitMax !== otherWaitMax) {
      const cheaperIsFaster = cheaperWaitMax < otherWaitMax;
      return {
        kind: "same-price-faster",
        fasterStoreId: cheaperIsFaster ? cheaper.storeId : other.storeId,
        slowerStoreId: cheaperIsFaster ? other.storeId : cheaper.storeId,
        savingsMinutes: Math.abs(cheaperWaitMax - otherWaitMax),
      };
    }
    return { kind: "no-tradeoff", winnerStoreId: cheaper.storeId };
  }

  if (knownWaits && otherWaitMax < cheaperWaitMax) {
    return {
      kind: "real-tradeoff",
      cheaperStoreId: cheaper.storeId,
      fasterStoreId: other.storeId,
      savingsCad: priceDiff,
      savingsMinutes: cheaperWaitMax - otherWaitMax,
    };
  }
  return { kind: "no-tradeoff", winnerStoreId: cheaper.storeId };
}
