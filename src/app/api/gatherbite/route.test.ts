import assert from "node:assert/strict";
import test from "node:test";

import type { GatherBiteEvaluation, GatherBiteInput } from "@/lib/gatherbite/contracts";
import { createGatherBitePostHandler } from "./route";

const empty: GatherBiteEvaluation = {
  recommended: null, alternatives: [], journeys: [], events: [],
  noViableReason: "No verified option.",
};

test("JSON route validates the new input contract before evaluation", async () => {
  let calls = 0;
  const post = createGatherBitePostHandler(async () => { calls += 1; return empty; });
  const response = await post(new Request("http://localhost/api/gatherbite", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ attendees: 6, budgetCad: 100, serviceMethod: "delivery", groups: [], pizzaPreferences: [] }),
  }));
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
  assert.deepEqual(await response.json(), { error: "Enter a delivery address for Delivery or Either." });
});

test("overlapping dietary-group counts are accepted and the JSON route returns Domino's-first evaluation with timing", async () => {
  const received: GatherBiteInput[] = [];
  const post = createGatherBitePostHandler(async (input, _onEvent, onTiming) => {
    received.push(input);
    onTiming({ name: "total", durationMs: 12.34, description: "private description ignored" });
    return empty;
  });
  const response = await post(new Request("http://localhost/api/gatherbite", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      attendees: 3, budgetCad: 100, serviceMethod: "carryout",
      groups: [
        { id: "vegetarian", people: 3, restrictions: ["vegetarian"] },
        { id: "no-pork", people: 3, restrictions: ["noPork"] },
      ],
      pizzaPreferences: ["pepperoni"],
    }),
  }));
  assert.equal(response.status, 200);
  assert.equal(received[0]?.groups.length, 2);
  assert.match(response.headers.get("server-timing") ?? "", /total;dur=12.3;desc="GatherBite evaluation"/);
  assert.equal(JSON.stringify(await response.json()).includes("little-caesars"), false);
});

test("malformed JSON is a concise input error and never exposes parser text", async () => {
  const post = createGatherBitePostHandler(async () => empty);
  const response = await post(new Request("http://localhost/api/gatherbite", { method: "POST", body: "{" }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Please check your inputs and try again." });
});
