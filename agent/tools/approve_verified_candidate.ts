import { z } from "zod";
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { gatherBiteState } from "../lib/orchestration-state";

export default defineTool({
  description: "Pause for explicit human approval of the last deterministically verified candidate. Never orders or pays.",
  inputSchema: z.object({ candidateId: z.string().min(1) }),
  approval: always(),
  execute({ candidateId }) {
    const verified = gatherBiteState.get().lastVerified;
    if (!verified || verified.id !== candidateId) {
      return {
        approved: false,
        reason: "The candidate no longer matches the last deterministic verification. Verify it again before approval.",
        candidate: null,
        checkoutPerformed: false,
      };
    }
    return {
      approved: true,
      reason: "The organizer approved this verified option. External checkout remains a separate human action.",
      candidate: verified,
      checkoutPerformed: false,
    };
  },
});
