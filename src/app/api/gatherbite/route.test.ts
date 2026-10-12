import assert from "node:assert/strict";
import test from "node:test";

import type {
  CandidateJourney,
  DominosCandidate,
  GatherBiteEvaluation,
  GatherBiteInput,
} from "@/lib/gatherbite/contracts";
import { createGatherBitePostHandler } from "./route";

const empty: GatherBiteEvaluation = {
  recommended: null, alternatives: [], journeys: [], events: [],
  noViableReason: "No verified option.",
};

function candidateFixture(): DominosCandidate {
  return {
    candidateId: "c1",
    candidateVersion: 1,
    snapshotVersion: "10950:2026-08-15T12:00:00.000Z",
    storeId: "10950",
    serviceMethod: "carryout",
    dealCodes: [],
    pizzas: [{
      lineId: "l1",
      quantity: 1,
      productCode: "S_PIZZA",
      variantCode: "12SCREEN",
      sizeCode: "12",
      crustCode: "HANDTOSS",
      sauceCode: "X",
      cheeseCode: "C",
      toppings: [],
      purpose: "general",
      protectsGroupIds: [],
      trustedSlicesPerPizza: 8,
    }],
    expectedPricing: { subtotalCad: 14.99, taxCad: 2.25, feesCad: 0, totalCad: 17.24 },
  };
}

/** A journey whose evidence carries non-empty `facts` — exactly what the
 * stream route's redaction already strips before transport. */
function journeyWithFacts(): CandidateJourney {
  const theCandidate = candidateFixture();
  return {
    candidate: theCandidate,
    adaptedFromCandidateId: null,
    outcome: {
      status: "DECIDED",
      decision: {
        candidateId: theCandidate.candidateId,
        candidateVersion: theCandidate.candidateVersion,
        snapshotVersion: theCandidate.snapshotVersion,
        decision: "REJECT",
        disposition: "TERMINAL",
        reasons: ["Budget could not be verified."],
        unknowns: [],
      },
      evidence: {
        candidateId: theCandidate.candidateId,
        candidateVersion: theCandidate.candidateVersion,
        snapshotVersion: theCandidate.snapshotVersion,
        checks: {
          menuIntegrity: { status: "PASS", code: "MENU", summary: "ok", facts: {}, source: "test" },
          dietary: { status: "PASS", code: "DIETARY", summary: "ok", facts: {}, source: "test" },
          capacity: { status: "PASS", code: "CAPACITY", summary: "ok", facts: {}, source: "test" },
          budget: {
            status: "UNKNOWN",
            code: "ALL_IN_TOTAL_UNKNOWN",
            summary: "unknown",
            facts: { budgetCad: 100, leakMarker: "private-fact-leak-marker" },
            source: "test",
          },
          availability: { status: "PASS", code: "AVAILABILITY", summary: "ok", facts: {}, source: "test" },
          serviceability: { status: "PASS", code: "SERVICEABILITY", summary: "ok", facts: {}, source: "test" },
        },
        preference: { requested: [], represented: [], unmet: [] },
        collectedAt: "2026-08-15T12:00:00.000Z",
      },
    },
  };
}

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
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(received[0]?.groups.length, 2);
  assert.match(response.headers.get("server-timing") ?? "", /total;dur=12.3;desc="GatherBite evaluation"/);
  assert.equal(JSON.stringify(await response.json()).includes("little-caesars"), false);
});

test("the JSON route redacts evidence facts the same way the stream route already does", async () => {
  const withFacts: GatherBiteEvaluation = {
    recommended: null,
    alternatives: [],
    journeys: [journeyWithFacts()],
    events: [],
    noViableReason: "No verified option.",
  };
  const post = createGatherBitePostHandler(async () => withFacts);
  const response = await post(new Request("http://localhost/api/gatherbite", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ attendees: 4, budgetCad: 100, serviceMethod: "carryout", groups: [], pizzaPreferences: [] }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json() as GatherBiteEvaluation;

  const checks = body.journeys[0]!.outcome.evidence!.checks;
  for (const check of Object.values(checks)) {
    assert.deepEqual(check.facts, {});
  }
  assert.doesNotMatch(JSON.stringify(body), /private-fact-leak-marker/);

  // Non-fact fields must survive redaction untouched.
  assert.equal(body.journeys[0]!.outcome.status, "DECIDED");
  const decision = body.journeys[0]!.outcome.status === "DECIDED" ? body.journeys[0]!.outcome.decision : null;
  assert.equal(decision?.decision, "REJECT");
  assert.deepEqual(decision?.reasons, ["Budget could not be verified."]);
  assert.equal(checks.budget.status, "UNKNOWN");
  assert.equal(checks.budget.code, "ALL_IN_TOTAL_UNKNOWN");
});

test("malformed JSON is a concise input error and never exposes parser text", async () => {
  const post = createGatherBitePostHandler(async () => empty);
  const response = await post(new Request("http://localhost/api/gatherbite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Please check your inputs and try again." });
});

test("oversized JSON is rejected before evaluation", async () => {
  let calls = 0;
  const post = createGatherBitePostHandler(async () => { calls += 1; return empty; });
  const response = await post(new Request("http://localhost/api/gatherbite", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": "70000",
    },
    body: "{}",
  }));

  assert.equal(response.status, 413);
  assert.equal(calls, 0);
  assert.deepEqual(await response.json(), { error: "Request body is too large." });
});
