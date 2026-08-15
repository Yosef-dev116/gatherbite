import assert from "node:assert/strict";
import { test } from "node:test";

import { GatherBiteEvaluationSchema } from "./contracts";
import { DEMO_EVALUATION, DEMO_INPUT } from "./demoFixture";

test("DEMO_EVALUATION satisfies the real GatherBiteEvaluation schema with a full REJECT-then-APPROVE journey", () => {
  const parsed = GatherBiteEvaluationSchema.safeParse(DEMO_EVALUATION);
  assert.equal(parsed.success, true);
  assert.notEqual(DEMO_EVALUATION.recommended, null);
  assert.equal(DEMO_EVALUATION.journeys.length, 2);
  assert.equal(DEMO_EVALUATION.journeys[0].outcome.status === "DECIDED" && DEMO_EVALUATION.journeys[0].outcome.decision.decision, "REJECT");
  assert.equal(DEMO_EVALUATION.journeys[1].outcome.status === "DECIDED" && DEMO_EVALUATION.journeys[1].outcome.decision.decision, "APPROVE");
});

test("DEMO_INPUT matches the dietary group and preferences the fixture evidence describes", () => {
  assert.equal(DEMO_INPUT.groups[0].id, "group-vegetarian");
  assert.deepEqual(DEMO_INPUT.pizzaPreferences, ["pepperoni", "veggie"]);
});
