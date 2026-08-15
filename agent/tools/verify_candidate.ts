import { z } from "zod";
import { defineTool } from "eve/tools";
import {
  verifyDominosCandidate,
  verifyLittleCaesarsCandidate,
  type SpikeCandidate,
} from "../lib/candidate-verification";
import { gatherBiteState } from "../lib/orchestration-state";

const CandidateSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("little-caesars"),
    lines: z.array(z.object({ itemId: z.string().min(1), quantity: z.number().int().positive() })).min(1),
  }),
  z.object({
    provider: z.literal("dominos"),
    storeId: z.string().min(1),
    dealCode: z.string().min(1),
    quantity: z.number().int().positive(),
  }),
]);

export default defineTool({
  description: "Run the unchanged deterministic verifier on one exact candidate. A model cannot override this result.",
  inputSchema: CandidateSchema,
  execute(candidate) {
    const state = gatherBiteState.get();
    if (!state.requirements) {
      throw new Error("Call set_group_requirements before verification.");
    }
    if (state.verificationAttempts >= 3) {
      return {
        verified: false,
        attempt: state.verificationAttempts,
        failures: ["The three-attempt spike limit has been reached; return the deterministic rejections to the organizer."],
        review: null,
      };
    }

    const typedCandidate = candidate as SpikeCandidate;
    const outcome = typedCandidate.provider === "little-caesars"
      ? verifyLittleCaesarsCandidate(state.requirements, typedCandidate.lines)
      : verifyDominosCandidate(state.requirements, state.dominos, typedCandidate);
    const attempt = state.verificationAttempts + 1;
    gatherBiteState.update((current) => ({
      ...current,
      verificationAttempts: attempt,
      lastVerified: outcome.verified ? outcome.review : null,
    }));

    return {
      verified: outcome.verified,
      attempt,
      failures: outcome.failures,
      review: outcome.review,
    };
  },
});
