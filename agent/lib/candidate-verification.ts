import { LITTLE_CAESARS_ORDER_URL, MENU_BY_ID } from "../../src/lib/menu";
import { verifyPlan } from "../../src/lib/verify";
import type { BuildOrderInput, PlanLine, VerifyResult } from "../../src/lib/types";
import type { DominosStoreSnapshot, WaitMinutes } from "../../src/lib/restaurants/dominos";
import type { DominosComparisonResult } from "../../src/lib/restaurants/dominosCompare";

export type SpikeCandidate =
  | { provider: "little-caesars"; lines: PlanLine[] }
  | { provider: "dominos"; storeId: string; dealCode: string; quantity: number };

export interface VerifiedCandidateReview {
  id: string;
  provider: "little-caesars" | "dominos";
  restaurant: string;
  storeId: string;
  order: Array<{
    itemId: string;
    name: string;
    quantity: number;
    lineTotalCad: number | null;
    totalSlices: number | null;
  }>;
  totalCad: number;
  capacity: string;
  dietary: string;
  availability: string;
  wait: {
    delivery: WaitMinutes | null;
    carryout: WaitMinutes | null;
  };
  externalOrderUrl: string | null;
}

export interface SpikeVerificationResult {
  verified: boolean;
  failures: string[];
  review: VerifiedCandidateReview | null;
  deterministicResult: VerifyResult | DominosComparisonResult | null;
}

export interface CachedDominosEvaluation {
  snapshots: DominosStoreSnapshot[];
  results: DominosComparisonResult[];
}

function canonicalLines(lines: PlanLine[]): PlanLine[] {
  return [...lines]
    .filter((line) => line.quantity > 0)
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
}

export function verifyLittleCaesarsCandidate(
  requirements: BuildOrderInput,
  lines: PlanLine[]
): SpikeVerificationResult {
  const canonical = canonicalLines(lines);
  const result = verifyPlan(canonical, requirements);
  if (!result.verified) {
    return {
      verified: false,
      failures: result.failures.map((failure) => failure.message),
      review: null,
      deterministicResult: result,
    };
  }

  const order = canonical.map((line) => {
    const item = MENU_BY_ID[line.itemId];
    return {
      itemId: line.itemId,
      name: item.name,
      quantity: line.quantity,
      lineTotalCad: Math.round(item.priceCad * line.quantity * 100) / 100,
      totalSlices: item.slices * line.quantity,
    };
  });
  const key = canonical.map((line) => `${line.itemId}x${line.quantity}`).join("+");

  return {
    verified: true,
    failures: [],
    deterministicResult: result,
    review: {
      id: `little-caesars:${requirements.storeId}:${key}:${result.totals.totalCad.toFixed(2)}`,
      provider: "little-caesars",
      restaurant: "Little Caesars",
      storeId: requirements.storeId,
      order,
      totalCad: result.totals.totalCad,
      capacity: `${result.totals.totalSlices} slices verified for a ${result.totals.requiredSlices}-slice requirement.`,
      dietary: requirements.groups.length === 0
        ? "No dietary restrictions requested."
        : "Every dietary group has sufficient coverage from deterministically tagged items.",
      availability: "Unknown: this provider has no trusted live availability feed.",
      wait: { delivery: null, carryout: null },
      externalOrderUrl: LITTLE_CAESARS_ORDER_URL,
    },
  };
}

export function verifyDominosCandidate(
  requirements: BuildOrderInput,
  evaluation: CachedDominosEvaluation | null,
  candidate: Extract<SpikeCandidate, { provider: "dominos" }>
): SpikeVerificationResult {
  if (!evaluation) {
    return {
      verified: false,
      failures: ["Domino's live data has not been fetched, so the candidate cannot be verified."],
      review: null,
      deterministicResult: null,
    };
  }

  const result = evaluation.results.find((entry) => entry.storeId === candidate.storeId);
  const snapshot = evaluation.snapshots.find((entry) => entry.storeId === candidate.storeId);
  if (!result || !snapshot) {
    return {
      verified: false,
      failures: [`No cached live Domino's evaluation exists for store ${candidate.storeId}.`],
      review: null,
      deterministicResult: result ?? null,
    };
  }
  if (result.classification !== "FULLY_VIABLE" || !result.dealUsed || result.estimatedTotalCad === null) {
    return {
      verified: false,
      failures: [result.reason ?? `Store ${candidate.storeId} is ${result.classification}; it is not a fully verified option.`],
      review: null,
      deterministicResult: result,
    };
  }
  if (result.dealUsed.code !== candidate.dealCode || result.dealUsed.quantity !== candidate.quantity) {
    return {
      verified: false,
      failures: [
        `Candidate does not match the deterministic sufficient plan: use ${result.dealUsed.quantity} x ${result.dealUsed.code}.`,
      ],
      review: null,
      deterministicResult: result,
    };
  }

  return {
    verified: true,
    failures: [],
    deterministicResult: result,
    review: {
      id: `dominos:${candidate.storeId}:${candidate.dealCode}:${candidate.quantity}:${result.estimatedTotalCad.toFixed(2)}`,
      provider: "dominos",
      restaurant: "Domino's",
      storeId: candidate.storeId,
      order: [{
        itemId: result.dealUsed.code,
        name: result.dealUsed.name,
        quantity: result.dealUsed.quantity,
        lineTotalCad: result.estimatedTotalCad,
        totalSlices: result.dealUsed.totalSlices,
      }],
      totalCad: result.estimatedTotalCad,
      capacity: `${result.dealUsed.totalSlices} trusted slices verified for a ${requirements.attendees * 3}-slice requirement.`,
      dietary: requirements.groups.length === 0
        ? "No dietary restrictions requested."
        : "The deal passed the existing deterministic Domino's dietary verifier for every requested restriction.",
      availability: "Live store data confirmed this option was open, online, and available for the requested service method.",
      wait: {
        delivery: snapshot.deliveryWaitMinutes,
        carryout: snapshot.carryoutWaitMinutes,
      },
      externalOrderUrl: null,
    },
  };
}
