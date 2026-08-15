import type { PizzaPreference } from "../types";
import type {
  CandidateJourney,
  EvidenceCheck,
  VerifiedDominosOption,
} from "./contracts";

export interface RankedDominosOptions {
  recommended: VerifiedDominosOption | null;
  alternatives: VerifiedDominosOption[];
}

function numericFact(check: EvidenceCheck, key: string): number | null {
  if (check.facts === null || typeof check.facts !== "object" || Array.isArray(check.facts)) return null;
  const value = (check.facts as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function waitFact(check: EvidenceCheck): { min: number; max: number } | null {
  if (check.facts === null || typeof check.facts !== "object" || Array.isArray(check.facts)) return null;
  const wait = (check.facts as Record<string, unknown>).waitMinutes;
  if (wait === null || typeof wait !== "object" || Array.isArray(wait)) return null;
  const { min, max } = wait as Record<string, unknown>;
  return typeof min === "number" && Number.isFinite(min) && min >= 0
    && typeof max === "number" && Number.isFinite(max) && max >= min
    ? { min, max }
    : null;
}

function approvedOption(
  journey: CandidateJourney,
  storeAddresses: ReadonlyMap<string, string | null>,
): VerifiedDominosOption | null {
  if (journey.outcome.status !== "DECIDED" || journey.outcome.decision.decision !== "APPROVE") return null;
  const represented = journey.outcome.evidence.preference.represented.length;
  const total = numericFact(journey.outcome.evidence.checks.budget, "totalCad");
  return {
    candidate: journey.candidate,
    decision: journey.outcome.decision,
    evidence: journey.outcome.evidence,
    storeAddress: storeAddresses.get(journey.candidate.storeId) ?? null,
    relevantWaitMinutes: waitFact(journey.outcome.evidence.checks.availability),
    recommendationReason: `${represented} preference${represented === 1 ? "" : "s"} represented${total === null ? "" : ` with a verified $${total.toFixed(2)} total`}.`,
  };
}

function preferenceCount(option: VerifiedDominosOption, requested?: readonly PizzaPreference[]): number {
  if (!requested) return option.evidence.preference.represented.length;
  const requestedSet = new Set(requested);
  return option.evidence.preference.represented.filter((preference) => requestedSet.has(preference)).length;
}

function excessSlices(option: VerifiedDominosOption): number {
  const check = option.evidence.checks.capacity;
  const total = numericFact(check, "totalSlices") ?? numericFact(check, "providedSlices");
  const required = numericFact(check, "requiredSlices");
  return total === null || required === null ? Number.POSITIVE_INFINITY : Math.max(0, total - required);
}

function verifiedTotal(option: VerifiedDominosOption): number {
  return numericFact(option.evidence.checks.budget, "totalCad") ?? Number.POSITIVE_INFINITY;
}

function stableId(option: VerifiedDominosOption): string {
  return `${option.candidate.storeId}:${option.candidate.candidateId}:${option.candidate.candidateVersion}`;
}

/** Rank only separately verified approvals; rejected/error journeys never enter the choice set. */
export function rankApprovedDominosOptions(
  journeys: readonly CandidateJourney[],
  requestedPreferences?: readonly PizzaPreference[],
  storeAddresses: ReadonlyMap<string, string | null> = new Map(),
): RankedDominosOptions {
  const approved = journeys.flatMap((journey) => {
    const option = approvedOption(journey, storeAddresses);
    return option ? [option] : [];
  });

  approved.sort((left, right) => {
    const preferenceDifference = preferenceCount(right, requestedPreferences) - preferenceCount(left, requestedPreferences);
    if (preferenceDifference !== 0) return preferenceDifference;

    const priceDifference = verifiedTotal(left) - verifiedTotal(right);
    if (priceDifference !== 0) return priceDifference;

    const capacityDifference = excessSlices(left) - excessSlices(right);
    if (capacityDifference !== 0) return capacityDifference;

    const leftWait = left.relevantWaitMinutes;
    const rightWait = right.relevantWaitMinutes;
    if (leftWait === null && rightWait !== null) return 1;
    if (leftWait !== null && rightWait === null) return -1;
    if (leftWait && rightWait && leftWait.max !== rightWait.max) return leftWait.max - rightWait.max;

    const leftId = stableId(left);
    const rightId = stableId(right);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });

  return { recommended: approved[0] ?? null, alternatives: approved.slice(1) };
}
