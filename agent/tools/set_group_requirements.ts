import { defineTool } from "eve/tools";
import { OrderInputSchema } from "../../src/lib/order-input-schema";
import type { BuildOrderInput } from "../../src/lib/types";
import { gatherBiteState } from "../lib/orchestration-state";

export default defineTool({
  description: "Store the organizer's exact structured group requirements for deterministic evaluation.",
  inputSchema: OrderInputSchema,
  execute(rawInput) {
    const input = rawInput as BuildOrderInput;
    const groupedPeople = input.groups.reduce((sum, group) => sum + group.people, 0);
    if (groupedPeople > input.attendees) {
      throw new Error(
        `Dietary group headcounts (${groupedPeople}) exceed total attendees (${input.attendees}). Correct the structured input.`
      );
    }
    gatherBiteState.update(() => ({
      requirements: input,
      dominos: null,
      verificationAttempts: 0,
      lastVerified: null,
    }));
    return {
      accepted: true,
      requirements: input,
      note: "Dietary groups remain explicit buckets; no unique unrestricted-attendee count was inferred.",
    };
  },
});
