import { defineHook } from "eve/hooks";
import { toolResultFrom } from "eve/tools";
import verifyCandidate from "../tools/verify_candidate";
import approveVerifiedCandidate from "../tools/approve_verified_candidate";

export default defineHook({
  events: {
    "action.result"(event, ctx) {
      try {
        const verification = toolResultFrom(event.data.result, verifyCandidate);
        if (verification) {
          console.info("[GatherBite eve verification]", {
            sessionId: ctx.session.id,
            callId: verification.callId,
            verified: verification.output.verified,
            attempt: verification.output.attempt,
            failures: verification.output.failures,
          });
        }
        const approval = toolResultFrom(event.data.result, approveVerifiedCandidate);
        if (approval) {
          console.info("[GatherBite eve approval]", {
            sessionId: ctx.session.id,
            callId: approval.callId,
            approved: approval.output.approved,
            checkoutPerformed: approval.output.checkoutPerformed,
          });
        }
      } catch (error) {
        console.warn("[GatherBite eve audit hook failed safely]", error);
      }
    },
  },
});
