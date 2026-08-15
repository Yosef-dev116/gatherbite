import assert from "node:assert/strict";
import test from "node:test";

import {
  createEventCollector,
  createNdjsonParser,
  encodeNdjsonEvent,
  publicEvaluationError,
} from "./events";

function completeEventWithFacts(facts: unknown) {
  const candidate = {
    candidateId: "c1",
    candidateVersion: 1,
    snapshotVersion: "snapshot-1",
    storeId: "10950",
    serviceMethod: "carryout" as const,
    dealCodes: ["deal-1"],
    pizzas: [{
      lineId: "line-1",
      quantity: 1,
      productCode: "pizza",
      variantCode: "variant",
      sizeCode: "large",
      crustCode: "hand-tossed",
      sauceCode: null,
      cheeseCode: null,
      toppings: [],
      purpose: "general" as const,
      protectsGroupIds: [],
      trustedSlicesPerPizza: 8,
    }],
    expectedPricing: { subtotalCad: 10, taxCad: 1.5, feesCad: 0, totalCad: 11.5 },
  };
  const checks = Object.fromEntries([
    "menuIntegrity",
    "dietary",
    "capacity",
    "budget",
    "availability",
    "serviceability",
  ].map((name) => [name, { status: "PASS", code: "OK", summary: "Checked", facts, source: "test" }]));
  const evidence = {
    candidateId: "c1",
    candidateVersion: 1,
    snapshotVersion: "snapshot-1",
    checks,
    preference: { requested: [], represented: [], unmet: [] },
    collectedAt: "2026-08-15T00:00:00.000Z",
  };
  const decision = {
    candidateId: "c1",
    candidateVersion: 1,
    snapshotVersion: "snapshot-1",
    decision: "APPROVE" as const,
    disposition: "NONE" as const,
    reasons: [],
    unknowns: [] as [],
  };
  return {
    type: "complete" as const,
    result: {
      recommended: null,
      alternatives: [{ candidate, decision, evidence, relevantWaitMinutes: null, recommendationReason: "Verified" }],
      journeys: [],
      events: [],
      noViableReason: null,
    },
  };
}

test("split NDJSON chunks reassemble", () => {
  const parser = createNdjsonParser();
  assert.deepEqual(parser.push('{"type":"stage","stage":"observing","message":"Watching"'), []);
  const events = parser.push('}\n');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { type: "stage", stage: "observing", message: "Watching" });
});

test("NDJSON parser preserves multiple complete lines and trailing data", () => {
  const parser = createNdjsonParser();
  const first = parser.push(
    '{"type":"stage","stage":"planning","message":"Planning"}\n{"type":"candidate","candidateId":"c1","summary":"Pizza"}\n{"type":"stage","stage":"verifying","message":"partial',
  );
  assert.equal(first.length, 2);
  assert.deepEqual(parser.push(' verification"}\n'), [
    { type: "stage", stage: "verifying", message: "partial verification" },
  ]);
});

test("event collector emits only public event values", () => {
  const collector = createEventCollector();
  const event = { type: "candidate", candidateId: "c1", summary: "2 pizzas" } as const;
  collector.emit(event);
  assert.deepEqual(collector.events(), [event]);
  collector.emit({ type: "stage", stage: "verifying", message: "Checking" });
  assert.equal(collector.events().length, 2);
});

test("encoding is one NDJSON line", () => {
  const event = { type: "stage", stage: "observing", message: "Observing" } as const;
  assert.equal(new TextDecoder().decode(encodeNdjsonEvent(event)), `${JSON.stringify(event)}\n`);
});

test("parser rejects malformed and extra-field records without leaking parser details", () => {
  const parser = createNdjsonParser();
  assert.throws(
    () => parser.push('{"type":"stage","stage":"observing","message":"private address 1 Main St","private":"secret"}\n'),
    { message: "Invalid public GatherBite event." },
  );
  assert.throws(
    () => parser.push('{"type":"unknown","prompt":"private"}\n'),
    { message: "Invalid public GatherBite event." },
  );
});

test("complete events reject unknown fields nested in the public result", () => {
  const parser = createNdjsonParser();
  const event = {
    type: "complete",
    result: {
      recommended: null,
      alternatives: [],
      journeys: [],
      events: [{
        type: "stage",
        stage: "observing",
        message: "Watching",
        privatePrompt: "do not serialize",
      }],
      noViableReason: null,
    },
  };
  assert.throws(
    () => parser.push(`${JSON.stringify(event)}\n`),
    { message: "Invalid public GatherBite event." },
  );
});

test("complete events reject non-empty evidence facts at the stream boundary", () => {
  const parser = createNdjsonParser();
  const event = completeEventWithFacts({ address: "123 Main Street" });
  assert.throws(
    () => parser.push(`${JSON.stringify(event)}\n`),
    { message: "Invalid public GatherBite event." },
  );
});

test("complete event encoding redacts facts before transport", () => {
  const event = completeEventWithFacts({ prompt: "private", address: "123 Main Street" }) as unknown as Parameters<typeof encodeNdjsonEvent>[0];
  const encoded = new TextDecoder().decode(encodeNdjsonEvent(event));
  assert.equal(encoded.includes("123 Main Street"), false);
  assert.equal(encoded.includes('"facts":{}'), true);
});

test("parser preserves a UTF-8 character split across byte chunks", () => {
  const encoded = new TextEncoder().encode('{"type":"stage","stage":"observing","message":"Café"}\n');
  const parser = createNdjsonParser();
  const splitAt = encoded.indexOf(0xc3) + 1;
  assert.deepEqual(parser.push(encoded.slice(0, splitAt)), []);
  assert.deepEqual(parser.push(encoded.slice(splitAt)), [
    { type: "stage", stage: "observing", message: "Café" },
  ]);
});

test("evaluation errors are generic and do not leak thrown data", () => {
  const event = publicEvaluationError(new Error("private prompt address secret"));
  assert.deepEqual(event, { type: "error", message: "GatherBite could not complete this evaluation." });
  assert.equal(JSON.stringify(event).includes("private"), false);
});
