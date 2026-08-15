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

test("request-derived metric names cannot enter Server-Timing", () => {
  const timing = createTimingCollector();
  timing.record({ name: "planner_123-main-street", durationMs: 8, description: "Planner" });
  assert.equal(timing.entries().length, 0);
  assert.equal(timing.serverTiming(), "");
});

test("fixed supported-store profile and menu timings remain observable without request data", () => {
  const timing = createTimingCollector();
  timing.record({ name: "dom_10950_profile", durationMs: 9, description: "private description" });
  timing.record({ name: "dom_10953_menu", durationMs: 10, description: "private description" });
  timing.record({ name: "dom_99999_menu", durationMs: 11, description: "private description" });
  assert.deepEqual(timing.entries().map(({ name }) => name), ["dom_10950_profile", "dom_10953_menu"]);
  assert.equal(timing.serverTiming().includes("private description"), false);
});
