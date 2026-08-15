import { z } from "zod";
import { defineTool } from "eve/tools";
import { buildDominosRequirements } from "../../src/lib/gatherbite";
import { getDominosStoreSnapshot } from "../../src/lib/restaurants/dominos";
import { compareDominosStores } from "../../src/lib/restaurants/dominosCompare";
import { gatherBiteState } from "../lib/orchestration-state";

const STORE_IDS = ["10950", "10953"];

export default defineTool({
  description: "Fetch live Domino's store/menu/deal/wait data and run the existing deterministic comparison.",
  inputSchema: z.object({}),
  async execute() {
    const requirements = gatherBiteState.get().requirements;
    if (!requirements) {
      throw new Error("Call set_group_requirements before requesting restaurant data.");
    }
    const snapshots = await Promise.all(STORE_IDS.map((storeId) => getDominosStoreSnapshot(storeId)));
    const results = compareDominosStores(snapshots, buildDominosRequirements(requirements));
    gatherBiteState.update((state) => ({ ...state, dominos: { snapshots, results } }));
    return {
      fetchedAt: snapshots.map((snapshot) => ({ storeId: snapshot.storeId, fetchedAt: snapshot.fetchedAt })),
      results,
      note: "Only FULLY_VIABLE results may proceed to approval; unknown data remains fail-closed.",
    };
  },
});
