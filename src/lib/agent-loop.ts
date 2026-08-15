import type { VerifyResult } from "./types";

export interface AgentLoopState {
  verifyAttempts: number;
  hasVerifiedCandidate: boolean;
  hasTerminalImpossibleResult: boolean;
}

export function recordAgentVerification(state: AgentLoopState, result: VerifyResult): void {
  state.verifyAttempts += 1;
  state.hasVerifiedCandidate ||= result.verified;
  state.hasTerminalImpossibleResult ||=
    !result.verified &&
    result.failures.length > 0 &&
    result.failures.every((failure) => failure.code === "DIETARY_COVERAGE_IMPOSSIBLE");
}

/**
 * Failed, adaptable candidates keep the retry loop. More model work stops
 * only after deterministic success/impossibility or the three-attempt cap.
 */
export function shouldStopAgentLoop(state: AgentLoopState): boolean {
  return state.hasVerifiedCandidate || state.hasTerminalImpossibleResult || state.verifyAttempts >= 3;
}
