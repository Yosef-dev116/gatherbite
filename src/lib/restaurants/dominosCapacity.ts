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

  const protectedLines = candidate.pizzas
    .filter((pizza) => pizza.purpose === "dietary-protected")
    .map((pizza) => ({ pizza, slices: stableSlices(pizza) }));
  const allocatedSliceIds = new Set<string>();
  type FlowEdge = { to: number; reverse: number; remaining: number; initial: number };
  const source = 0;
  const groupOffset = 1;
  const lineOffset = groupOffset + groups.length;
  const sink = lineOffset + protectedLines.length;
  const graph: FlowEdge[][] = Array.from({ length: sink + 1 }, () => []);
  const addEdge = (from: number, to: number, capacity: number): FlowEdge => {
    const forward: FlowEdge = { to, reverse: graph[to]!.length, remaining: capacity, initial: capacity };
    const reverse: FlowEdge = { to: from, reverse: graph[from]!.length, remaining: 0, initial: 0 };
    graph[from]!.push(forward);
    graph[to]!.push(reverse);
    return forward;
  };

  for (const [groupIndex, group] of groups.entries()) {
    addEdge(source, groupOffset + groupIndex, group.people * SLICES_PER_PERSON);
  }
  for (const [lineIndex, line] of protectedLines.entries()) {
    addEdge(lineOffset + lineIndex, sink, line.slices.length);
  }

  const groupLineEdges: Array<{ groupIndex: number; lineIndex: number; edge: FlowEdge }> = [];
  for (const [groupIndex, group] of groups.entries()) {
    for (const [lineIndex, line] of protectedLines.entries()) {
      if (!isCompatible(line.pizza, group) || line.slices.length === 0) continue;
      groupLineEdges.push({
        groupIndex,
        lineIndex,
        edge: addEdge(groupOffset + groupIndex, lineOffset + lineIndex, line.slices.length),
      });
    }
  }

  /**
   * Edmonds-Karp over group/line capacities, not individual slices. This has
   * bounded iterative traversal at the request schema's ten-group limit and
   * still finds augmenting paths that reserve a constrained line for a later
   * group.
   */
  while (true) {
    const parent: Array<{ from: number; edgeIndex: number } | null> = Array.from({ length: graph.length }, () => null);
    const visited = Array.from({ length: graph.length }, () => false);
    const queue = [source];
    visited[source] = true;
    for (let cursor = 0; cursor < queue.length && !visited[sink]; cursor += 1) {
      const from = queue[cursor]!;
      for (const [edgeIndex, edge] of graph[from]!.entries()) {
        if (edge.remaining <= 0 || visited[edge.to]) continue;
        visited[edge.to] = true;
        parent[edge.to] = { from, edgeIndex };
        queue.push(edge.to);
        if (edge.to === sink) break;
      }
    }
    if (!visited[sink]) break;

    let amount = Number.POSITIVE_INFINITY;
    for (let node = sink; node !== source;) {
      const step = parent[node]!;
      amount = Math.min(amount, graph[step.from]![step.edgeIndex]!.remaining);
      node = step.from;
    }
    for (let node = sink; node !== source;) {
      const step = parent[node]!;
      const edge = graph[step.from]![step.edgeIndex]!;
      edge.remaining -= amount;
      graph[edge.to]![edge.reverse]!.remaining += amount;
      node = step.from;
    }
  }

  const result: Record<string, ProtectedSliceGroupAllocation> = {};
  const remainingSlicesByLine = protectedLines.map((line) => [...line.slices]);
  const groupAllocations = groups.map((group, groupIndex) => {
    const groupSliceIds: string[] = [];
    for (const groupLine of groupLineEdges.filter((edge) => edge.groupIndex === groupIndex)) {
      const assignedSlices = groupLine.edge.initial - groupLine.edge.remaining;
      if (assignedSlices <= 0) continue;
      groupSliceIds.push(...remainingSlicesByLine[groupLine.lineIndex]!.splice(0, assignedSlices).map((slice) => slice.id));
    }
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
