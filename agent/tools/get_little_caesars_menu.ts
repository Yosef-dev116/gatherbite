import { z } from "zod";
import { defineTool } from "eve/tools";
import { FEE_STRUCTURE, menuForAgent } from "../../src/lib/menu";
import { gatherBiteState } from "../lib/orchestration-state";

export default defineTool({
  description: "Return the trusted Little Caesars candidate menu and fee data used by the existing verifier.",
  inputSchema: z.object({}),
  execute() {
    if (!gatherBiteState.get().requirements) {
      throw new Error("Call set_group_requirements before requesting restaurant data.");
    }
    return {
      store: "Little Caesars store 10088 snapshot",
      items: menuForAgent(),
      fees: FEE_STRUCTURE,
      warning: "Availability and wait time are not present in the trusted Little Caesars data.",
    };
  },
});
