import type { PizzaPreference } from "../types";
import type {
  CandidateJourney,
  GatherBiteEvaluation,
  PublicGatherBiteEvent,
} from "./contracts";
import { rankApprovedDominosOptions } from "./ranking";
import type { DominosOptionPresentationSource } from "./ranking";

const EMPTY_REASON = "GatherBite could not verify a Domino's option from the available live data.";
const VERIFIER_REASON = "Verification could not complete safely for the available Domino's option.";

function noViableReason(journeys: readonly CandidateJourney[]): string {
  for (const journey of journeys) {
    if (journey.outcome.status === "DECIDED" && journey.outcome.decision.decision === "REJECT") {
      return journey.outcome.decision.reasons[0] ?? EMPTY_REASON;
    }
    if (journey.outcome.status === "VERIFIER_ERROR") return VERIFIER_REASON;
  }
  return EMPTY_REASON;
}
/**
 * Presents the immutable Planner/Verifier history without upgrading an
 * UNKNOWN or rejected candidate. Configured lines and exact check statuses
 * stay attached to their verifier-issued outcomes.
 */
export function normalizeDominosEvaluation(
  journeys: readonly CandidateJourney[],
  preferences: readonly PizzaPreference[],
  events: readonly PublicGatherBiteEvent[],
  presentationSources: ReadonlyMap<string, DominosOptionPresentationSource> = new Map(),
): GatherBiteEvaluation {
  const ranked = rankApprovedDominosOptions(journeys, preferences, presentationSources);
  return {
    recommended: ranked.recommended,
    alternatives: ranked.alternatives,
    journeys: [...journeys],
    events: [...events],
    noViableReason: ranked.recommended ? null : noViableReason(journeys),
  };
}
