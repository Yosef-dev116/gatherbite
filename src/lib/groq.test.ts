import assert from "node:assert/strict";
import { test } from "node:test";

test("GATHERBITE_MODEL_PROVIDER unset resolves models via the Groq provider (default path preserved)", async () => {
  delete process.env.GATHERBITE_MODEL_PROVIDER;
  const { PLANNER_MODEL, VERIFIER_MODEL } = await import("./groq");
  assert.equal(typeof PLANNER_MODEL === "object" && PLANNER_MODEL.provider, "groq.chat");
  assert.equal(typeof VERIFIER_MODEL === "object" && VERIFIER_MODEL.provider, "groq.chat");
});
