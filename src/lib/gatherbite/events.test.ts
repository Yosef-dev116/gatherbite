import assert from "node:assert/strict";
import test from "node:test";

import {
  createEventCollector,
  createNdjsonParser,
  encodeNdjsonEvent,
  publicEvaluationError,
} from "./events";

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
