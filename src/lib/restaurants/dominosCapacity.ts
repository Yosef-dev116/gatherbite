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
  /** Preserves every declaration when a duplicate id prevents keyed output. */
  groupAllocations: ProtectedSliceGroupAllocation[];
  /** Duplicate identifiers make coverage unprovable and allocation stops. */
  duplicateGroupIds: string[];
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
  const duplicateGroupIds = [...new Set(groups
    .map((group) => group.id)
    .filter((groupId, index, allIds) => allIds.indexOf(groupId) !== index))];
  if (duplicateGroupIds.length > 0) {
    return {
      groups: {},
      groupAllocations: groups.map((group) => ({
        requiredSlices: group.people * SLICES_PER_PERSON,
        allocatedSlices: 0,
        missingSlices: group.people * SLICES_PER_PERSON,
        allocatedSliceIds: [],
      })),
      duplicateGroupIds,
      allocatedSliceIds: new Set<string>(),
    };
  }

  const availableSlices = candidate.pizzas
    .filter((pizza) => pizza.purpose === "dietary-protected")
    .flatMap(stableSlices);
  const allocatedSliceIds = new Set<string>();
  const slots = groups.flatMap((group) => Array.from(
    { length: group.people * SLICES_PER_PERSON },
    (_, index) => ({ key: `${group.id}:${index}`, group }),
  ));
  const slotByKey = new Map(slots.map((slot) => [slot.key, slot]));
  const assignedSliceToSlot = new Map<string, string>();

  /**
   * Deterministic augmenting-path matching. A later constrained group can
   * reclaim its only compatible slice and move an earlier broad group to an
   * alternate slice, which a greedy pass cannot do.
   */
  const assign = (slotKey: string, attemptedSlices: Set<string>, attemptedSlots: Set<string>): boolean => {
    if (attemptedSlots.has(slotKey)) return false;
    attemptedSlots.add(slotKey);
    const slot = slotByKey.get(slotKey);
    if (!slot) return false;

    for (const slice of availableSlices) {
      if (attemptedSlices.has(slice.id) || !isCompatible(slice.pizza, slot.group)) continue;
      attemptedSlices.add(slice.id);
      const previousSlot = assignedSliceToSlot.get(slice.id);
      if (!previousSlot || assign(previousSlot, attemptedSlices, attemptedSlots)) {
        assignedSliceToSlot.set(slice.id, slotKey);
        return true;
      }
    }
    return false;
  };

  for (const slot of slots) {
    assign(slot.key, new Set<string>(), new Set<string>());
  }

  const result: Record<string, ProtectedSliceGroupAllocation> = {};
  const groupAllocations = groups.map((group) => {
    const groupSliceIds = availableSlices
      .filter((slice) => slotByKey.get(assignedSliceToSlot.get(slice.id) ?? "")?.group.id === group.id)
      .map((slice) => slice.id);
    for (const id of groupSliceIds) allocatedSliceIds.add(id);
    const allocation = {
      requiredSlices: group.people * SLICES_PER_PERSON,
      allocatedSlices: groupSliceIds.length,
      missingSlices: Math.max(0, group.people * SLICES_PER_PERSON - groupSliceIds.length),
      allocatedSliceIds: groupSliceIds,
    };
    result[group.id] = allocation;
    return allocation;
  });

  return { groups: result, groupAllocations, duplicateGroupIds, allocatedSliceIds };
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
