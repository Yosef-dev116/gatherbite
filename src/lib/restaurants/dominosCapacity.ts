import type { DominosCandidate, CandidatePizza, EvidenceCheck } from "../gatherbite/contracts";
import type { DietaryGroupInput } from "../types";

const SLICES_PER_PERSON = 3;

export interface ProtectedSliceGroupAllocation {
  requiredSlices: number;
  allocatedSlices: number;
  missingSlices: number;
  allocatedSliceIds: string[];
}

export interface ProtectedSliceAllocation {
  groups: Record<string, ProtectedSliceGroupAllocation>;
  /** A Set makes accidental reuse across group coverage checks observable. */
  allocatedSliceIds: Set<string>;
}

export interface CapacityFacts {
  requiredSlices: number;
  trustedPizzaSlices: number;
  zeroCapacityLineIds: string[];
}

function trustedSliceCount(pizza: CandidatePizza): number {
  return Number.isInteger(pizza.trustedSlicesPerPizza) && pizza.trustedSlicesPerPizza > 0
    ? pizza.trustedSlicesPerPizza
    : 0;
}

function stableSlices(pizza: CandidatePizza): Array<{ id: string; pizza: CandidatePizza }> {
  const slices: Array<{ id: string; pizza: CandidatePizza }> = [];
  const perPizza = trustedSliceCount(pizza);
  const quantity = Number.isInteger(pizza.quantity) && pizza.quantity > 0 ? pizza.quantity : 0;

  for (let unit = 0; unit < quantity; unit += 1) {
    for (let slice = 0; slice < perPizza; slice += 1) {
      slices.push({ id: `${pizza.lineId}:${unit}:${slice}`, pizza });
    }
  }
  return slices;
}

/**
 * Allocates evidence-backed pizza slices to each declared dietary group in
 * declaration order. Group counts are intentionally not merged: without
 * attendee identities, sharing a slice between separate restrictions would
 * invent overlap that the request never established.
 */
export function allocateProtectedSlices(
  candidate: DominosCandidate,
  groups: DietaryGroupInput[],
  isCompatible: (pizza: CandidatePizza, group: DietaryGroupInput) => boolean,
): ProtectedSliceAllocation {
  const availableSlices = candidate.pizzas.flatMap(stableSlices);
  const allocatedSliceIds = new Set<string>();
  const result: Record<string, ProtectedSliceGroupAllocation> = {};

  for (const group of groups) {
    const requiredSlices = group.people * SLICES_PER_PERSON;
    const groupSliceIds: string[] = [];

    for (const slice of availableSlices) {
      if (groupSliceIds.length >= requiredSlices) break;
      if (
        allocatedSliceIds.has(slice.id)
        || slice.pizza.purpose !== "dietary-protected"
        || !isCompatible(slice.pizza, group)
      ) continue;
      allocatedSliceIds.add(slice.id);
      groupSliceIds.push(slice.id);
    }

    result[group.id] = {
      requiredSlices,
      allocatedSlices: groupSliceIds.length,
      missingSlices: Math.max(0, requiredSlices - groupSliceIds.length),
      allocatedSliceIds: groupSliceIds,
    };
  }

  return { groups: result, allocatedSliceIds };
}

/**
 * Capacity is pizza-only for the current product. Lines with no explicit,
 * positive slice evidence contribute zero; their price or apparent bundle
 * contents never substitute for feeding evidence.
 */
export function checkTotalPizzaCapacity(
  candidate: DominosCandidate,
  attendees: number,
): EvidenceCheck<CapacityFacts> {
  const requiredSlices = attendees * SLICES_PER_PERSON;
  const zeroCapacityLineIds: string[] = [];
  let trustedPizzaSlices = 0;

  for (const pizza of candidate.pizzas) {
    const perPizza = trustedSliceCount(pizza);
    const quantity = Number.isInteger(pizza.quantity) && pizza.quantity > 0 ? pizza.quantity : 0;
    if (perPizza === 0 || quantity === 0) {
      zeroCapacityLineIds.push(pizza.lineId);
      continue;
    }
    trustedPizzaSlices += perPizza * quantity;
  }

  const facts = { requiredSlices, trustedPizzaSlices, zeroCapacityLineIds };
  if (trustedPizzaSlices >= requiredSlices) {
    return {
      status: "PASS",
      code: "SUFFICIENT_TOTAL_PIZZA_SLICES",
      summary: `${trustedPizzaSlices} trusted pizza slices cover the ${requiredSlices} required slices.`,
      facts,
      source: "Candidate pizza lines with explicit trusted slice evidence",
    };
  }

  return {
    status: "FAIL",
    code: "INSUFFICIENT_TOTAL_PIZZA_SLICES",
    summary: `${trustedPizzaSlices} trusted pizza slices do not cover the ${requiredSlices} required slices.`,
    facts,
    source: "Candidate pizza lines with explicit trusted slice evidence",
  };
}
