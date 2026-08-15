import assert from "node:assert/strict";
import test from "node:test";

import { createTimingCollector } from "./timing";

test("timing headers contain durations but no request data", () => {
  const timing = createTimingCollector();
  timing.record({ name: "planner", durationMs: 12.34, description: "Planner" });
  assert.match(timing.serverTiming(), /planner;dur=12.3/);
  assert.equal(timing.serverTiming().includes("address"), false);
});

test("timing collector exposes controlled entries", () => {
  const timing = createTimingCollector();
  timing.record({ name: "dominos-fetch", durationMs: -3, description: "Live data" });
  timing.record({ name: "verifier", durationMs: Number.NaN, description: "Verifier" });
  assert.deepEqual(timing.entries(), [
    { name: "dominos-fetch", durationMs: 0, description: "Domino's live data" },
    { name: "verifier", durationMs: 0, description: "Verification" },
  ]);
});

test("arbitrary timing descriptions cannot enter Server-Timing", () => {
  const timing = createTimingCollector();
  timing.record({ name: "planner", durationMs: 5, description: "123 Main Street, Charlottetown; prompt secret" });
  assert.equal(timing.serverTiming().includes("123 Main Street"), false);
  assert.match(timing.serverTiming(), /desc="Planner"/);
});
