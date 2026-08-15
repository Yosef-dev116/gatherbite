import type { LanguageModel } from "ai";

import type { DominosObservationContext } from "../agents/dominosPlanner";
import {
  runDominosVerifier,
  type VerifyCandidateDeps,
} from "../agents/dominosVerifier";
import {
  DominosCandidateSchema,
  type DominosCandidate,
  type GatherBiteInput,
  type VerificationOutcome,
} from "./contracts";
import type { EventSink } from "./events";
import type { TimingEntry } from "./timing";
import { collectCandidateEvidence } from "../restaurants/dominosEvidence";
import type { DominosPriceEvidence } from "../restaurants/dominosServiceability";

export interface DominosAgentLoopState {
  verificationAttempts: number;
  approvedCandidateIds: Set<string>;
  terminal: boolean;
}

export function shouldStopDominosLoop(state: DominosAgentLoopState): boolean {
  return state.terminal
    || state.verificationAttempts >= 3
    || state.approvedCandidateIds.size >= 2;
}

export function candidateMatchesObservation(
  candidate: DominosCandidate,
  observation: DominosObservationContext,
): boolean {
  const parsed = DominosCandidateSchema.safeParse(candidate);
  if (!parsed.success) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(candidate.candidateId)) return false;

  const snapshot = observation.snapshots.find(({ storeId }) => storeId === candidate.storeId);
  const catalog = observation.catalogs.get(candidate.storeId);
  if (!snapshot || !catalog) return false;

  const observedSnapshotVersion = `${snapshot.storeId}:${snapshot.fetchedAt}`;
  return candidate.snapshotVersion === observedSnapshotVersion
    && catalog.snapshotVersion === observedSnapshotVersion;
}

export interface VerifyObservedDominosCandidateInput {
  input: GatherBiteInput;
  candidate: DominosCandidate;
  observation: DominosObservationContext;
  verifierModel: LanguageModel;
  verifyCandidate: typeof runDominosVerifier;
  onEvent?: EventSink;
  onTiming?: (entry: TimingEntry) => void;
  abortSignal?: AbortSignal;
}

const CONTEXT_ERROR = "Verification could not establish current candidate context.";

/**
 * Owns the exact-evidence boundary. The Planner can request verification, but
 * cannot import or invoke the evidence collector itself.
 */
export async function verifyObservedDominosCandidate({
  input,
  candidate,
  observation,
  verifierModel,
  verifyCandidate,
  onEvent,
  onTiming,
  abortSignal,
}: VerifyObservedDominosCandidateInput): Promise<VerificationOutcome> {
  if (!candidateMatchesObservation(candidate, observation)) {
    return { status: "VERIFIER_ERROR", reason: CONTEXT_ERROR, evidence: null };
  }

  const snapshot = observation.snapshots.find(({ storeId }) => storeId === candidate.storeId);
  const catalog = observation.catalogs.get(candidate.storeId);
  if (!snapshot || !catalog) {
    return { status: "VERIFIER_ERROR", reason: CONTEXT_ERROR, evidence: null };
  }

  // Candidate expectedPricing is a proposal, never evidence. Task 9 has no
  // official candidate-bound quote source, so budget must remain UNKNOWN.
  const priceEvidence: DominosPriceEvidence = {
    status: "UNKNOWN",
    kind: "UNKNOWN",
    subtotalCad: null,
    taxCad: null,
    feesCad: null,
    totalCad: null,
    source: "No candidate-bound official Domino's quote",
    observedAt: observation.observedAt,
    reason: "A candidate-bound official quote was not available for this planning operation.",
  };

  const verifierDeps: VerifyCandidateDeps = {
    model: verifierModel,
    collectEvidence: collectCandidateEvidence,
    onEvent,
    onTiming,
    abortSignal,
  };

  try {
    return await verifyCandidate({
      candidate,
      evidenceContext: {
        input,
        candidate,
        snapshot,
        catalog,
        serviceability: observation.serviceability,
        priceEvidence,
        collectedAt: observation.observedAt,
      },
    }, verifierDeps);
  } catch {
    return { status: "VERIFIER_ERROR", reason: CONTEXT_ERROR, evidence: null };
  }
}
