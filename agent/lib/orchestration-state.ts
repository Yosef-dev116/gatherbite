import { defineState } from "eve/context";
import type { BuildOrderInput } from "../../src/lib/types";
import type { DominosStoreSnapshot } from "../../src/lib/restaurants/dominos";
import type { DominosComparisonResult } from "../../src/lib/restaurants/dominosCompare";
import type { VerifiedCandidateReview } from "./candidate-verification";

export interface GatherBiteEveState {
  requirements: BuildOrderInput | null;
  dominos: {
    snapshots: DominosStoreSnapshot[];
    results: DominosComparisonResult[];
  } | null;
  verificationAttempts: number;
  lastVerified: VerifiedCandidateReview | null;
}

export const gatherBiteState = defineState<GatherBiteEveState>("gatherbite.spike", () => ({
  requirements: null,
  dominos: null,
  verificationAttempts: 0,
  lastVerified: null,
}));
